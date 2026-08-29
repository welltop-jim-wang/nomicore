/**
 * peer-namespace —— peer 侧 target/namespace 控制器（§5/§8/§13）。每个 target 一个
 * 实例：OPEN 决策、bootstrap 导入、sync round 接线、live 订阅、关闭收口、重连投影。
 */
import * as Y from 'yjs';
import type { ReplicationMessage } from '@nomicore/replication-protocol';
import type {
  NamespaceLease,
  NamespaceRegistry,
  ReplicationSession,
} from '@nomicore/namespace-registry';
import { FenceWatchdog, type WatchdogPredicate } from './fence-watchdog.js';
import { namespaceErrorFrame } from './frame-io.js';
import { Memoized } from './lifecycle-queue.js';
import {
  mapEncodeThrow,
  mapRejection,
  mapSessionRefusal,
  terminalStateOf,
  toFinalState,
  type MappingOutcome,
} from './error-mapping.js';
import { RoundAborted, RoundEngine } from './round-engine.js';
import { UpdateChannel } from './update-channel.js';
import type { DataSenderFacet } from './backpressure.js';
import type {
  PeerNamespaceState,
  ReplicationTarget,
  ReplicationTimer,
  ResolvedLimits,
  ResolvedTimeouts,
} from './types.js';

/** 控制器宿主（由 PeerConnectionImpl 实现；指向当前连接的活动出站）。 */
export interface PeerNamespaceHost {
  readonly limits: ResolvedLimits;
  readonly timeouts: ResolvedTimeouts;
  readonly timer: ReplicationTimer;
  readonly registry: NamespaceRegistry;
  readonly hubInstanceId: string;
  /** 控制面帧（含 UPDATE——单 ns 场景直发路径）；返回分配帧序。 */
  sendControl(message: ReplicationMessage): number;
  /** data 帧（UPDATE）发送路径（§6.3，issue #137）：连接级水位闸门 + data 出队。 */
  sendData(namespaceId: string, bytes: Uint8Array): number;
  /** 连接级 data 水位闸门（§4.2，issue #137）。 */
  dataGateOpen(): boolean;
  /** data 入队通知（§4.4 连接总压/wheel 登记，issue #137）。 */
  onDataQueued(namespaceId: string): void;
  /** 请求连接级 drain（§4.5，issue #137）。 */
  requestDataDrain(): void;
  /** 本端连接致命（ACK_STATE_VIOLATION 等）：connection ERROR + close + blocked。 */
  connectionFatal(code: string, wsCloseCode?: number): void;
  /** 连接代际（每次拨号 +1）：异步续体以此判别「连接已断/已重建」的迟到性（§13.4）。 */
  connectionEpoch(): number;
}

type TimerKind = 'open' | 'bootstrap' | 'reconcile' | 'close';

export class PeerNamespaceController {
  readonly target: ReplicationTarget;
  state: PeerNamespaceState = 'targeted';
  intent: 'active' | 'removed' = 'active';

  private lease: NamespaceLease | undefined;
  private session: ReplicationSession | undefined;
  private unsubscribe: (() => void) | undefined;
  private roundCounter = 0;
  private openDeclaredLocal: boolean | undefined;
  private openDeclaredIdentity:
    | Readonly<{ replicationId: string; replicationEpoch: number }>
    | undefined;
  private openOkIdentity:
    | Readonly<{ replicationId: string; replicationEpoch: number }>
    | undefined;
  private pendingApplies = new Set<Promise<unknown>>();
  private pendingResync = false;
  private resyncDeclared = false;
  private timers: Record<TimerKind, unknown | undefined> = {
    open: undefined,
    bootstrap: undefined,
    reconcile: undefined,
    close: undefined,
  };
  private cleanupTail: Promise<void> = Promise.resolve();
  private closeMemo: Memoized | undefined;
  /** R3（SA4）：close 承诺的事件驱动结算器——settleCloseMemo 触发前 removeTarget 的
   *  promise 保持 pending（零轮询环；AC3b closeSettled===false 锚语义）。 */
  private closeSettleResolve: (() => void) | undefined;

  readonly round: RoundEngine;
  readonly channel: UpdateChannel;
  readonly watchdog: FenceWatchdog;
  private readonly onOwnedBound: (bytes: Uint8Array) => void;

  /** 连接级 data 调度面（§6.1/§6.3）：pull 以 state==='live' 为门槛（deferred 队列
   *  仅在 resetForLive 后经 drain 放行——与 #136「flushQueued 只从 onAck/resetForLive
   *  调用」的 live 门逐语义等价）；shed 按通道 live 性分派 §10.2 同构处置。 */
  readonly sendFacet: DataSenderFacet = {
    queuedBytes: () => this.channel.queuedBytes,
    queuedCount: () => this.channel.queuedCount,
    pullAndSendOne: () => (this.state === 'live' ? this.channel.pullAndSendOne() : false),
    discardForConnectionPressure: () => {
      this.channel.discardForConnectionPressure();
      if (this.state === 'live') {
        this.declareLocalResync();
      } else {
        this.pendingResync = true;
      }
    },
  };

  constructor(
    private readonly host: PeerNamespaceHost,
    target: ReplicationTarget,
  ) {
    this.target = target;
    this.onOwnedBound = (bytes: Uint8Array): void => this.onOwnedUpdate(bytes);
    this.round = new RoundEngine({
      role: 'peer',
      send: (message) => this.sendChecked(message),
      encode: (kind, remoteSV) => {
        try {
          const session = this.session;
          if (session === undefined) throw new RoundAborted();
          return kind === 'stateVector'
            ? session.encodeStateVector()
            : session.encodeDiff(remoteSV ?? new Uint8Array(0));
        } catch (err) {
          if (err instanceof RoundAborted) throw err;
          this.applyOutcome(mapEncodeThrow(this.session));
          throw new RoundAborted();
        }
      },
      applyStep2: (update, step2Sequence) => this.applyStep2(update, step2Sequence),
      onViolation: () => {
        this.sendNsError('SYNC_STATE_VIOLATION');
        this.finalize('failed');
      },
      onRoundSettled: () => this.onRoundSettled(),
    });
    this.round.bind(target.namespaceId);
    this.channel = new UpdateChannel({
      limits: host.limits,
      ackTimeoutMs: host.timeouts.ackTimeoutMs,
      sendUpdateFrame: (bytes) => this.sendUpdateFrame(bytes),
      declareLocalResync: () => this.declareLocalResync(),
      notePendingResync: () => {
        this.pendingResync = true;
      },
      onAckTimeout: () => this.onAckTimeoutFired(),
      armTimer: (cb, ms) => host.timer.setTimeout(cb, ms),
      clearTimer: (h) => host.timer.clearTimeout(h),
      dataGateOpen: () => this.host.dataGateOpen(),
      onDataQueued: () => this.host.onDataQueued(this.namespaceId),
      requestDataDrain: () => this.host.requestDataDrain(),
    });
    this.watchdog = new FenceWatchdog({
      role: 'peer',
      session: () => this.session,
      onPredicateEdge: (predicate: WatchdogPredicate) => this.onWatchdogEdge(predicate),
      armTimer: (cb, ms) => host.timer.setTimeout(cb, ms),
      clearTimer: (h) => host.timer.clearTimeout(h),
      idleProbeMs: host.timeouts.ackTimeoutMs,
    });
  }

  get namespaceId(): string {
    return this.target.namespaceId;
  }

  // ─────────────────────────────── OPEN（§5.2） ───────────────────────────────

  startOpen(): void {
    if (this.intent !== 'active' || this.state !== 'targeted') return;
    const epoch = this.host.connectionEpoch();
    this.setState('opening');
    this.armTimer('open');
    void (async () => {
      let result: Awaited<ReturnType<NamespaceRegistry['open']>>;
      try {
        result = await this.host.registry.open(this.target.localOwner, this.namespaceId);
      } catch (err) {
        if (!this.isConnectionDead()) this.finalize('failed');
        return;
      }
      if (this.isConnectionDead() || this.host.connectionEpoch() !== epoch) {
        // B-2c：§13.4「连接已断/已重建」——迟到续体零 wire；若 registry.open 已交付
        // lease，静默回收（不覆盖 this.lease——旧 lease 归属当前/下次连接流程）
        this.releaseLeaseOrNoop(result.ok ? result.lease : undefined);
        return;
      }
      if (!result.ok) {
        if (result.code === 'NAMESPACE_NOT_FOUND') {
          this.openDeclaredLocal = false;
          this.sendChecked({
            kind: 'OPEN_NAMESPACE',
            namespaceId: this.namespaceId,
            hasLocalReplica: false,
          });
          return;
        }
        this.finalize('failed');
        return;
      }
      this.lease = result.lease;
      let replication:
        | Readonly<{ state: 'disabled' }>
        | Readonly<{ state: 'enabled'; replicationId: string; replicationEpoch: number }>;
      try {
        const status = this.lease.getStatus();
        if (status.runtime === null) throw new Error('lease released during open');
        replication = status.runtime.replication;
      } catch (err) {
        this.releaseLeaseOrNoop(this.lease);
        this.lease = undefined;
        this.finalize('failed');
        return;
      }
      if (this.isConnectionDead() || this.host.connectionEpoch() !== epoch) {
        // B-2c：迟到（断开/重建窗口）——零 wire、零迁移；lease 静默回收
        this.releaseLeaseOrNoop(this.lease);
        this.lease = undefined;
        return;
      }
      if (replication.state !== 'enabled') {
        // 本地响亮终局（零 wire 帧；不虚假降级为 bootstrap——ADR 0010）
        this.finalize('failed');
        return;
      }
      this.openDeclaredLocal = true;
      this.openDeclaredIdentity = {
        replicationId: replication.replicationId,
        replicationEpoch: replication.replicationEpoch,
      };
      this.sendChecked({
        kind: 'OPEN_NAMESPACE',
        namespaceId: this.namespaceId,
        hasLocalReplica: true,
        replicationId: replication.replicationId,
        replicationEpoch: replication.replicationEpoch,
      });
    })();
  }

  onOpenOk(message: { mode: 0 | 1; replicationId: string; replicationEpoch: number }): void {
    if (this.state !== 'opening') {
      if (!this.isTerminal()) {
        this.sendNsError('NAMESPACE_STATE_VIOLATION');
        this.finalize('failed');
      }
      return;
    }
    this.clearTimer('open');
    if (message.mode === 0) {
      if (this.openDeclaredLocal !== false) {
        this.sendNsError('NAMESPACE_STATE_VIOLATION');
        this.finalize('failed');
        return;
      }
      this.openOkIdentity = {
        replicationId: message.replicationId,
        replicationEpoch: message.replicationEpoch,
      };
      this.setState('bootstrapping');
      this.armTimer('bootstrap');
      return;
    }
    if (
      this.openDeclaredLocal !== true ||
      this.openDeclaredIdentity === undefined ||
      this.openDeclaredIdentity.replicationId !== message.replicationId ||
      this.openDeclaredIdentity.replicationEpoch !== message.replicationEpoch
    ) {
      this.sendNsError('NAMESPACE_STATE_VIOLATION');
      this.finalize('failed');
      return;
    }
    this.openOkIdentity = {
      replicationId: message.replicationId,
      replicationEpoch: message.replicationEpoch,
    };
    void this.openSessionAndStartRound();
  }

  private async openSessionAndStartRound(): Promise<void> {
    const epoch = this.host.connectionEpoch();
    const opened = await this.tryOpenReplicationSession(epoch);
    if (!opened) return;
    if (this.isConnectionDead() || this.host.connectionEpoch() !== epoch) {
      // R4-3：续体内 epoch 判别——open 在途期断开/重建（state 已离开 disconnected 停留
      // 域时 isConnectionDead 失效）→ 零 wire、零状态机迁移（重连流程接管；session 已
      // 由 tryOpenReplicationSession 静默回收）
      return;
    }
    this.setState('reconciling');
    this.armTimer('reconcile');
    this.startRound();
  }

  private async tryOpenReplicationSession(epoch: number): Promise<boolean> {
    if (this.lease === undefined) return false;
    let result: Awaited<ReturnType<NamespaceLease['openReplicationSession']>>;
    try {
      result = await this.lease.openReplicationSession({
        localRole: 'peer',
        remoteInstanceId: this.host.hubInstanceId,
      });
    } catch {
      if (!this.isConnectionDead()) this.finalize('failed');
      return false;
    }
    if (!result.ok) {
      if (!this.isConnectionDead()) this.finalize('failed');
      return false;
    }
    if (this.isConnectionDead() || this.host.connectionEpoch() !== epoch) {
      // §13.4「连接已断/已重建」：session 开于在途期（R4-1/R4-3）——静默回收
      // （session.close），零 wire、零状态机迁移（state 离开 disconnected 停留域后
      // 由 epoch 比对兜底——Registry carrier FIFO 使释放时 state 恒 'opening'）
      void result.session.close().catch(() => undefined);
      return false;
    }
    this.session = result.session;
    this.subscribe();
    return true;
  }

  // ─────────────────────────────── Bootstrap（§8） ───────────────────────────────

  onBootstrapSnapshot(message: {
    replicationId: string;
    replicationEpoch: number;
    snapshot: Uint8Array;
    sequence: number;
  }): void {
    if (this.state !== 'bootstrapping') {
      if (!this.isTerminal()) {
        this.sendNsError('NAMESPACE_STATE_VIOLATION');
        this.finalize('failed');
      }
      return;
    }
    const expected = this.openOkIdentity;
    if (
      expected === undefined ||
      message.replicationId !== expected.replicationId ||
      message.replicationEpoch !== expected.replicationEpoch
    ) {
      this.sendNsError('NAMESPACE_STATE_VIOLATION');
      this.finalize('failed');
      return;
    }
    const detached = new Y.Doc();
    try {
      Y.applyUpdate(detached, message.snapshot);
    } catch {
      this.sendNsError('BOOTSTRAP_FAILED');
      this.finalize('failed');
      return;
    }
    void (async () => {
      // R4-1：入口捕获 connectionEpoch——导入续体跨重连的迟到判别（isConnectionDead
      // 在 state 离开 disconnected 停留域（'opening'）后失效，必须 epoch 比对；
      // Registry 每-ns carrier FIFO 使释放门闩时 state 恒 'opening'——结构性可达）
      const epoch = this.host.connectionEpoch();
      let importResult: Awaited<ReturnType<NamespaceRegistry['importReplica']>>;
      try {
        importResult = await this.host.registry.importReplica(
          this.target.localOwner,
          this.namespaceId,
          detached,
          { replicationId: message.replicationId, replicationEpoch: message.replicationEpoch },
        );
      } catch {
        if (!this.isConnectionDead()) {
          this.sendNsError('INTERNAL_ERROR');
          this.finalize('failed');
        }
        return;
      }
      if (this.isConnectionDead() || this.host.connectionEpoch() !== epoch) {
        // B-2a/B-2b/R4-1：§13.4「已终局/连接已断/已重建」——导入迟到一律静默回收：
        // lease 立即 release（§8 L361「仅做 lease/session 静默回收」）；零 wire、零状态机
        // 迁移（不 setState('reconciling')、不发 BOOTSTRAP_ACK/STEP1——否则旧续体的
        // 垃圾控制帧先于新 OPEN 落新连接 → hub 无通道 → NAMESPACE_STATE_VIOLATION ×2
        // → ns 永久 failed；重连后由 openActiveTargets 重 OPEN，本地副本已导入 →
        // 按 §5.2 重新判定走 reconcile）
        if (importResult.ok) this.releaseLeaseOrNoop(importResult.lease);
        return;
      }
      if (!importResult.ok) {
        this.sendNsError('BOOTSTRAP_FAILED');
        this.finalize('failed');
        return;
      }
      this.lease = importResult.lease;
      const opened = await this.tryOpenReplicationSession(epoch);
      if (!opened) return;
      this.clearTimer('bootstrap');
      if (this.isConnectionDead() || this.host.connectionEpoch() !== epoch) {
        // B-2b 兜底/R4-1：断开与「导入+session 开」交错竞态的子窗口——session 已开于
        // 在途期（tryOpen 已回滚）或此后终局；cleanup 收口，零 ACK
        return;
      }
      this.sendChecked({
        kind: 'BOOTSTRAP_ACK',
        namespaceId: this.namespaceId,
        ackedSequence: message.sequence,
      });
      this.setState('reconciling');
      this.armTimer('reconcile');
      this.startRound();
    })();
  }

  // ─────────────────────────────── 入站帧（ready 期） ───────────────────────────────

  onSyncStep1(message: { syncRoundId: number; stateVector: Uint8Array; sequence: number }): void {
    if (this.isQuietState()) return; // §9.2 首行：closing/终态静默忽略
    try {
      this.round.onStep1(message);
    } catch (err) {
      if (!(err instanceof RoundAborted)) throw err;
    }
  }

  onSyncStep2(message: {
    syncRoundId: number;
    relatedStep1Sequence: number;
    update: Uint8Array;
    sequence: number;
  }): void {
    if (this.isQuietState()) return;
    try {
      this.round.onStep2(message);
    } catch (err) {
      if (!(err instanceof RoundAborted)) throw err;
    }
  }

  onSyncApplied(message: { syncRoundId: number; ackedSequence: number }): void {
    if (this.isQuietState()) return;
    try {
      this.round.onApplied(message);
    } catch (err) {
      if (!(err instanceof RoundAborted)) throw err;
    }
  }

  onResyncReceived(): void {
    if (this.isQuietState()) return;
    this.channel.markResyncReceived();
    this.setState('needs-resync');
    this.maybeStartRecovery();
  }

  onHubUpdate(message: { update: Uint8Array; sequence: number }): void {
    if (this.isQuietState()) return; // §11.3：closing/终态静默忽略
    const accepted =
      this.state === 'live' ||
      this.state === 'needs-resync' ||
      (this.state === 'reconciling' && this.round.wasLive);
    if (!accepted) {
      // 无生命周期/opening/bootstrapping/首轮 reconciling → 真违例（§7.2 收口）
      this.sendNsError('NAMESPACE_STATE_VIOLATION');
      this.finalize('failed');
      return;
    }
    if (message.update.byteLength > this.host.limits.maxUpdateBytes) {
      this.sendNsError('UPDATE_TOO_LARGE');
      this.finalize('failed');
      return;
    }
    void this.applyRemoteUpdate(message.update, message.sequence);
  }

  onUpdateAck(message: { ackedSequence: number }): void {
    if (this.isQuietState()) return;
    const outcome = this.channel.onAck(message.ackedSequence);
    if (outcome === 'violation') {
      this.host.connectionFatal('ACK_STATE_VIOLATION', 1002);
      return;
    }
    if (outcome === 'ok' && this.state === 'needs-resync') {
      this.maybeStartRecovery();
    }
  }

  onCloseRequest(message: { sequence: number }): void {
    if (this.isQuietState()) return;
    // 对称收口（§13.2）：停接纳 → 等已接纳 apply → session close → lease release → CLOSE_OK
    void (async () => {
      await this.drainPendingApplies();
      await this.closeSessionAndRelease();
      this.sendChecked({
        kind: 'CLOSE_OK',
        namespaceId: this.namespaceId,
        ackedSequence: message.sequence,
      });
      if (this.state !== 'closed') this.setState('closed');
      this.settleCloseMemo();
    })();
  }

  onCloseOk(): void {
    if (this.state === 'closing') {
      // §13.4：closing 期 terminal 帧只推进收口——CLOSE_OK 为收口完成信号（即使在
      // 测试注入帧与出站计数器重叠的序列冲突下仍接受收口，不重复失败）
      this.clearTimer('close');
      this.setState('closed');
      this.settleCloseMemo();
    }
  }

  onIdentityChanged(): void {
    // 零 apply（控制帧不进 sequencer）；本地 META/epoch 不变（AC6 锚）
    if (this.state === 'closing') {
      return; // §13.4：closing 期 terminal 帧只推进收口
    }
    this.finalize('conflicted');
  }

  onErrorFrame(message: { code: string }): void {
    if (this.isQuietState()) return;
    if (this.state === 'closing') {
      // R3/#5d：closing 中 terminal ERROR → 维持 closing（零回发帧）
      return;
    }
    this.finalize(toFinalState(terminalStateOf(message.code)));
  }

  // ─────────────────────────────── removeTarget / 生命周期矩阵（§13.1） ───────────────────────────────

  removeTarget(): Promise<void> {
    if (this.intent === 'removed') {
      return this.closeMemo?.get() ?? Promise.resolve();
    }
    this.intent = 'removed';
    switch (this.state) {
      case 'targeted':
      case 'disconnected':
        // 本地收口：零 wire 帧（§13.1 矩阵）
        this.setState('closed');
        this.settleCloseMemo();
        return this.closeMemo?.get() ?? Promise.resolve();
      case 'opening':
      case 'bootstrapping':
      case 'reconciling':
      case 'live':
      case 'needs-resync':
        this.setState('closing');
        this.armTimer('close');
        this.sendChecked({
          kind: 'CLOSE_NAMESPACE',
          namespaceId: this.namespaceId,
          reasonCode: 'target-removed',
        });
        return this.ensureCloseMemo();
      case 'closing':
        return this.ensureCloseMemo();
      case 'closed':
        return this.closeMemo?.get() ?? Promise.resolve();
      case 'conflicted':
      case 'failed':
        // 立即 resolve；投影迁 closed；零 wire 帧
        this.setState('closed');
        return Promise.resolve();
      default: {
        const never: never = this.state;
        void never;
        return Promise.resolve();
      }
    }
  }

  private ensureCloseMemo(): Promise<void> {
    if (this.closeMemo === undefined) {
      // R3（SA4）：memo body 只做 drain + cleanup——**零轮询环**（G5.2：生产代码不得为
      // 测试可观测性引入魔法常数延迟环）；收口完成由 onCloseOk（关联 CLOSE_OK）/
      // onTimerFired('close')（closeTimeout）/onCloseRequest 完成段的 settleCloseMemo()
      // 事件驱动——settle 显式 resolve 装饰 promise（close 状态未收口前 removeTarget
      // 承诺保持 pending；closeTimeout 兜底保证必有结算点）。
      // gate 在 memo 创建时**同步登记**（executor 仅在其后 await）：settle
      // （CLOSE_OK 早到/closeTimeout/断线）与登记之间零竞态窗口，无不死锁。
      const gate = new Promise<void>((resolve) => {
        this.closeSettleResolve = resolve;
      });
      this.closeMemo = new Memoized(async () => {
        await this.drainPendingApplies();
        await this.closeSessionAndRelease();
        await gate;
      });
    }
    return this.closeMemo.get();
  }

  private settleCloseMemo(): void {
    // R3（SA4）：事件驱动结算——settle 由状态迁移点（CLOSE_OK/closeTimeout/CLOSE 请求
    // 完成段/终局收口）触发；无装饰 promise 挂起时退回既有 trivial-memo 合流。
    if (this.closeSettleResolve !== undefined) {
      const resolve = this.closeSettleResolve;
      this.closeSettleResolve = undefined;
      resolve();
      return;
    }
    if (this.closeMemo === undefined) {
      this.closeMemo = new Memoized(async () => undefined);
    }
    void this.closeMemo.get();
  }

  /** 连接断开（socket 关闭 / 重建）：活跃态/failed → disconnected（target 保留；
   *  §13.3/§14.1：failed 等待连接重建——断线投影 disconnected 后重连重 OPEN）。 */
  onConnectionLost(): void {
    if (this.state === 'closed' || this.state === 'conflicted') return; // 终态保持
    if (this.state === 'closing') {
      this.setState('disconnected');
      this.settleCloseMemo(); // R3：断线 = 关闭承诺兑现（无 CLOSE_OK/closeTimeout 可等）
      return;
    }
    if (this.state === 'failed') {
      this.setState('disconnected');
      return;
    }
    // B-2d：投影先行——cleanup 卡 session.close 屏障（在途 apply 未排空）不得让投影
    // 滞留 live（重连 openActiveTargets 会跳过 live → 永不重 OPEN）；资源收口异步进行
    this.setState('disconnected');
    void this.cleanupResources();
  }

  /** 连接 blocked（fatal）：活跃态投影 disconnected。 */
  onConnectionFatal(): void {
    if (this.isTerminal()) return;
    if (this.state === 'closing') {
      this.settleCloseMemo(); // R3：blocked = 关闭承诺兑现（同步投影先行）
    }
    this.setState('disconnected');
    void this.cleanupResources();
  }

  /** stop()：一律收口为 closed（本地，零 wire）。 */
  onConnectionStopped(): Promise<void> {
    this.intent = 'removed';
    if (!this.isTerminal()) {
      this.setState('closed');
      this.settleCloseMemo(); // R3：stop = 关闭承诺兑现
    }
    return this.cleanupResources();
  }

  /** 连接 ready（重连/重建后）：非终态 target 重新 OPEN。 */
  onConnectionReady(): void {
    if (this.intent !== 'active') return;
    if (this.state === 'disconnected' || this.state === 'failed') {
      this.setState('targeted');
      this.startOpen();
    }
  }

  // ─────────────────────────────── round / live ───────────────────────────────

  private startRound(): void {
    this.roundCounter += 1;
    try {
      this.round.startRound(this.roundCounter);
    } catch (err) {
      if (!(err instanceof RoundAborted)) throw err;
    }
  }

  private onRoundSettled(): void {
    this.clearTimer('reconcile');
    if (this.state !== 'reconciling') {
      // B-1：removeTarget×reconcile 竞态——closing/终态/断开期间迟到的 round 结算
      // 只清 reconcile timer（§5.1 closing 唯一出口 CLOSE_OK/closeTimeout → closed）；
      // §13.4 终态不复活、零状态机迁移——不得 setState('live') 复活被收口（否则
      // CLOSE_OK/close timer 均因仅认 'closing' 而失效，target 永久假活）
      return;
    }
    if (this.pendingResync) {
      this.pendingResync = false;
      this.round.markLive();
      this.startRound(); // §5.3：pendingResync → 不进 live，直接再开 round+1
      return;
    }
    this.round.markLive();
    this.setState('live');
    this.channel.resetForLive();
    this.resyncDeclared = false;
    this.watchdog.onEvent();
  }

  private onAckTimeoutFired(): void {
    if (this.state === 'live' || this.state === 'needs-resync') {
      this.setState('needs-resync');
      this.host.deferTask(() => {
        if (this.state === 'needs-resync') this.maybeStartRecovery();
      });
    }
  }

  private maybeStartRecovery(): void {
    if (this.state !== 'needs-resync') return;
    if (this.channel.inFlightCount > 0) return; // §9.4：窗口收口后
    if (this.round.running) return;
    this.setState('reconciling');
    this.armTimer('reconcile');
    this.startRound();
  }

  private declareLocalResync(): void {
    if (this.resyncDeclared) return;
    this.resyncDeclared = true;
    this.sendChecked({
      kind: 'RESYNC_REQUIRED',
      namespaceId: this.namespaceId,
      reasonCode: 'send-queue-overflow',
    });
    this.setState('needs-resync');
    this.maybeStartRecovery();
  }

  private onWatchdogEdge(_predicate: WatchdogPredicate): void {
    // peer 侧仅 needsResync 边沿生效（fence 结构性不命中——防御判别在帧处理钩子）
    this.channel.markSessionResyncEdge();
    if (this.resyncDeclared) return;
    this.resyncDeclared = true;
    this.sendChecked({
      kind: 'RESYNC_REQUIRED',
      namespaceId: this.namespaceId,
      reasonCode: 'send-queue-overflow',
    });
    this.setState('needs-resync');
    this.maybeStartRecovery();
  }

  private onOwnedUpdate(bytes: Uint8Array): void {
    switch (this.state) {
      case 'live':
        this.channel.deliver(bytes, 'live');
        this.watchdog.onEvent();
        return;
      case 'reconciling':
      case 'bootstrapping':
      case 'needs-resync':
      case 'opening':
        this.channel.deliver(bytes, 'deferred');
        this.watchdog.onEvent();
        return;
      default:
        return; // closing/终态/未开：忽略
    }
  }

  // ─────────────────────────────── apply / 错误映射（§11） ───────────────────────────────

  private sendUpdateFrame(bytes: Uint8Array): number {
    if (bytes.byteLength > this.host.limits.maxUpdateBytes) {
      // 发送侧超限：丢弃并由 round diff 修复（§5.3 丢弃安全性论证）
      return 0;
    }
    try {
      // §6.3 R2（SA2 #7）：sendChecked 同款 try/catch 明确覆盖 host.sendData——
      // OutboundExhaustedError（uint32 耗尽已由 onSequenceExhausted 先行收口连接）
      // 与编码错统一收敛为返回 0 → F4 消费即丢弃。任何异常不得穿越
      // drainData/onAck/onMessage/timer 回调栈成为 uncaught。
      return this.host.sendData(this.namespaceId, bytes);
    } catch {
      return 0;
    }
  }

  private async applyStep2(update: Uint8Array, step2Sequence: number): Promise<'ok' | 'aborted'> {
    const epoch = this.host.connectionEpoch();
    const outcome = await this.applyRemoteUpdate(update, step2Sequence, true);
    if (outcome === 'ok' && this.host.connectionEpoch() === epoch) {
      // §9.1.4：apply 成功 → 发 SYNC_APPLIED（ackedSequence = 收到的 Step2 帧序）；
      // B-2d：连接已重建 → 旧 round 的 Applied 不发（迟到的控制帧不得落新连接）
      this.sendChecked({
        kind: 'SYNC_APPLIED',
        namespaceId: this.namespaceId,
        syncRoundId: this.round.currentRound,
        ackedSequence: step2Sequence,
      });
      return 'ok';
    }
    return outcome === 'ok' ? 'ok' : 'aborted';
  }

  /** 统一 apply 管线（§11.1/§11.3 镜像：UPDATE / Step2 diff）。 */
  private async applyRemoteUpdate(
    update: Uint8Array,
    sequence: number,
    isStep2 = false,
  ): Promise<'ok' | 'failed'> {
    const session = this.session;
    if (session === undefined) {
      if (!this.isTerminal()) this.finalize('failed');
      return 'failed';
    }
    const epoch = this.host.connectionEpoch(); // B-2d：代际捕获——旧连接的迟到 ACK 不得落新连接
    const pending = session.applyRemoteUpdate(update);
    this.pendingApplies.add(pending);
    try {
      const result = await pending;
      if (!result.ok) {
        this.applyOutcome(
          mapSessionRefusal(result.code, this.session, this.runtimeSnapshot(), 'peer'),
        );
        return 'failed';
      }
      if (isStep2) return 'ok'; // SYNC_APPLIED 由 applyStep2 发送（§9.1.4）
      if (this.isQuietState() || this.host.connectionEpoch() !== epoch) {
        return 'ok'; // closing/终态 或 连接已重建（§13.4 迟到纪律）：ACK 不再发出
      }
      this.sendChecked({
        kind: 'UPDATE_ACK',
        namespaceId: this.namespaceId,
        ackedSequence: sequence,
      });
      return 'ok';
    } catch {
      this.applyOutcome(mapRejection(this.session, this.runtimeSnapshot(), 'peer'));
      return 'failed';
    } finally {
      this.pendingApplies.delete(pending);
    }
  }

  private runtimeSnapshot(): Readonly<{
    lifecycle: string;
    fatal: Readonly<{ code: string; message: string }> | null;
  }> | null {
    try {
      const status = this.lease?.getStatus();
      if (status === undefined || status.runtime === null) return null;
      return status.runtime;
    } catch {
      return null;
    }
  }

  private applyOutcome(mapped: MappingOutcome): void {
    switch (mapped.kind) {
      case 'wire':
        this.sendNsError(mapped.code);
        this.finalize(toFinalState(mapped.terminalState));
        return;
      case 'fence':
        // peer 侧防御性对称保留：命中即按 conflicted 终局收口（零 wire）
        this.finalize('conflicted');
        return;
      case 'local':
        this.finalize(toFinalState(mapped.terminalState));
        return;
      default: {
        const never: never = mapped;
        void never;
        return;
      }
    }
  }

  // ─────────────────────────────── 收口 ───────────────────────────────

  private sendNsError(code: string): void {
    this.sendChecked(namespaceErrorFrame(code, this.namespaceId));
  }

  private sendChecked(message: ReplicationMessage): number {
    try {
      return this.host.sendControl(message);
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (typeof code === 'string' && !this.isTerminal()) {
        // codec 编码超限（编码面抛）：同码命名空间 ERROR + failed（§9.1 注记）
        this.sendNsErrorNoWrap(code);
        this.finalize('failed');
      }
      return 0;
    }
  }

  private sendNsErrorNoWrap(code: string): void {
    try {
      this.host.sendControl(namespaceErrorFrame(code, this.namespaceId));
    } catch {
      // 防御：ERROR 帧本身编码失败（极小帧，理论不可达）
    }
  }

  private finalize(state: 'failed' | 'conflicted' | 'closed'): void {
    if (this.isTerminal()) return; // 终态不降级（§12 finalize 同款幂等）
    if (state === 'failed') {
    }
    this.clearAllTimers();
    this.setState(state);
    // E5 终局收口（SA2 R3 / §3.8 裁决 3）：failed/conflicted 也是收口终态——closeMemo
    // 的事件驱动结算不区分终态种类，一律 settle（AC3b/⑤c/⑤d 回归面已核查为零）。
    this.settleCloseMemo();
    void this.cleanupResources();
  }

  private isTerminal(): boolean {
    return this.state === 'closed' || this.state === 'conflicted' || this.state === 'failed';
  }

  /** §13.4「已终局/连接已断」完整语义：终态 + disconnected 投影均属迟到收口域。 */
  private isConnectionDead(): boolean {
    return this.isTerminal() || this.state === 'disconnected';
  }

  /** 迟到续体的静默回收（§8 L361：仅 lease/session 静默回收，零 wire、零迁移）。 */
  private releaseLeaseOrNoop(lease: NamespaceLease | undefined): void {
    if (lease !== undefined) {
      void lease.release().catch(() => undefined);
    }
  }

  private isQuietState(): boolean {
    return (
      this.state === 'closing' ||
      this.state === 'closed' ||
      this.state === 'conflicted' ||
      this.state === 'failed'
    );
  }

  private subscribe(): void {
    if (this.session === undefined) return;
    this.unsubscribe = this.session.subscribeOwnedUpdates(this.onOwnedBound);
    this.watchdog.onEvent();
    this.watchdog.startIdle();
  }

  private async drainPendingApplies(): Promise<void> {
    await Promise.allSettled([...this.pendingApplies]);
  }

  private async closeSessionAndRelease(): Promise<void> {
    const session = this.session;
    const lease = this.lease;
    const unsubscribe = this.unsubscribe;
    if (session !== undefined) {
      await session.close();
    }
    if (this.session === session && this.lease === lease) {
      // B-2d：仅当本 cleanup 持有的是**当前** session/lease 才收口通道级状态——
      // 迟到 cleanup（旧连接 session，跨重连在途 apply 场景）不得摧毁新连接的
      // round/session/频道状态（否则新 round 被 teardown → 旧 Applied(roundId=0)
      // 落到新连接 → hub SYNC_STATE_VIOLATION → 误 failed；AC6 重连修复承诺失效）
      // R4-2：unsubscribe 同批归属——仅退订**本 cleanup 捕获的** listener 句柄
      //（入口捕获；迟到 cleanup 误调新 session 的退订函数 → 新连接 listener 被移除
      // → 上行静默死亡：live 后本地写零 UPDATE 帧、hub 永不收敛，零 wire 信号）
      if (this.unsubscribe === unsubscribe && unsubscribe !== undefined) {
        unsubscribe();
        this.unsubscribe = undefined;
      }
      this.session = undefined;
      this.lease = undefined;
      this.watchdog.teardown();
      this.round.teardown();
      this.channel.teardown();
    }
    if (lease !== undefined) {
      await lease.release().catch(() => undefined);
    }
  }

  private cleanupResources(): Promise<void> {
    const run = this.cleanupTail.then(() => this.closeSessionAndRelease());
    this.cleanupTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  setState(state: PeerNamespaceState): void {
    this.state = state;
  }

  private armTimer(kind: TimerKind): void {
    this.clearTimer(kind);
    const delay =
      kind === 'open'
        ? this.host.timeouts.openTimeoutMs
        : kind === 'bootstrap'
          ? this.host.timeouts.bootstrapTimeoutMs
          : kind === 'reconcile'
            ? this.host.timeouts.reconcileTimeoutMs
            : this.host.timeouts.closeTimeoutMs;
    this.timers[kind] = this.host.timer.setTimeout(() => {
      this.timers[kind] = undefined;
      this.onTimerFired(kind);
    }, delay);
  }

  private clearTimer(kind: TimerKind): void {
    const handle = this.timers[kind];
    if (handle !== undefined) {
      this.host.timer.clearTimeout(handle);
      this.timers[kind] = undefined;
    }
  }

  private clearAllTimers(): void {
    (['open', 'bootstrap', 'reconcile', 'close'] as const).forEach((kind) => this.clearTimer(kind));
  }

  private onTimerFired(kind: TimerKind): void {
    if (this.isTerminal()) return;
    if (kind === 'close') {
      // §13.1：closeTimeout 不再等待 → 本地收口 closed
      if (this.state === 'closing') {
        this.setState('closed');
        this.settleCloseMemo();
        void this.cleanupResources();
      }
      return;
    }
    // §5.1：timeout 只收口 namespace（零 wire 帧）
    this.finalize('failed');
  }
}

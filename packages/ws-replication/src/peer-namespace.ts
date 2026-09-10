/**
 * peer-namespace —— peer 侧 target/namespace 控制器（§5/§8/§13）。每个 target 一个
 * 实例：OPEN 决策、bootstrap 导入、sync round 接线、live 订阅、关闭收口、重连投影。
 */
import * as Y from 'yjs';
import type { ReplicationMessage } from '@nomicore/replication-protocol';
import type {
  NamespaceLease,
  NamespaceRegistry,
  ReplicationSchemaRearmOutcome,
  ReplicationSession,
} from '@nomicore/namespace-registry';
import { FenceWatchdog, type WatchdogPredicate } from './fence-watchdog.js';
import { namespaceErrorFrame } from './frame-io.js';
import { cidField, safeStateVector, sendFailureContext, stableNamespaceCode, stableSchemaRearmCode, stateVectorBytesEqual, stateVectorSafeDigest } from './observer.js';
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
  PeerConnectionState,
  PeerNamespaceState,
  ReplicationNamespaceFailedCause,
  ReplicationObserverEvent,
  ReplicationObserverSchemaRearmCode,
  ReplicationTarget,
  ReplicationTimer,
  ResolvedLimits,
  ResolvedTimeouts,
  UpdateSendFailureDetail,
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
  /** 确定性延后 seam：生产缺省单 microtask，测试可注入显式泵。 */
  deferTask(task: () => void): void;
  /** 本端连接致命（ACK_STATE_VIOLATION 等）：connection ERROR + close + blocked。 */
  connectionFatal(code: string, wsCloseCode?: number): void;
  /** 连接代际（每次拨号 +1）：异步续体以此判别「连接已断/已重建」的迟到性（§13.4）。 */
  connectionEpoch(): number;
  /** issue #254：namespace 以 timer 族超时收口（open/bootstrap/reconcile →
   *  §13.2 `NAMESPACE_TIMEOUT`，retryable=reconnect）且 target 仍活跃时，请求连接层
   *  执行恢复性重建（§16「failed 等待连接重建」——连接仍存活时本端即触发者）。
   *  触发面由调用点保证（仅 onTimerFired 尾部）；连接侧状态/stopping/transport 门
   *  由实现方持有（非 ready 态一律 no-op——既有恢复轨道接管）。 */
  requestConnectionRecovery(namespaceId: string): void;
  /** observer 是否在场（热路径纪律：无 observer 零事件构造/零投影读取/零时钟调用）。 */
  observerPresent(): boolean;
  /** observer 事件分发（隔离语义在 dispatchReplicationObserver 单点）。 */
  emitObserver(event: ReplicationObserverEvent): void;
  /** 连接级受控 observability id（HELLO_ACK 前 undefined）。 */
  connectionId(): string | undefined;
  /** 连接状态投影（issue #231 send-failed 诊断上下文；观测面只读，仅 observer 在场时调用）。 */
  connectionState(): PeerConnectionState;
  /** socket 缓冲未冲刷字节（issue #231）：adapter 可观测 → 有限数值；
   *  缺面/非法 → undefined（事件字段缺失，非 0——0 是真实读数）。 */
  bufferedAmount(): number | undefined;
  /** 单调时源（仅作差；clock 缺省/无 observer 时 undefined）。 */
  now?(): number | undefined;
}

type TimerKind = 'open' | 'bootstrap' | 'reconcile' | 'periodic-reconcile' | 'close';

/** §5.1 timer 族 → resolved 配置字段单映射（armTimer 延迟与 onTimerFired 的
 *  timeoutMs 同源——避免两处级联漂移）。 */
const TIMER_DELAY_FIELD = {
  open: 'openTimeoutMs',
  bootstrap: 'bootstrapTimeoutMs',
  reconcile: 'reconcileTimeoutMs',
  'periodic-reconcile': 'reconcileIntervalMs',
  close: 'closeTimeoutMs',
} as const satisfies Record<TimerKind, keyof ResolvedTimeouts>;

/** issue #256：timer 族超时 → 稳定 cause 单映射（§13.2 `NAMESPACE_TIMEOUT` 本地映射族）。 */
const TIMER_TIMEOUT_CAUSE: Record<
  'open' | 'bootstrap' | 'reconcile',
  ReplicationNamespaceFailedCause
> = {
  open: 'open-timeout',
  bootstrap: 'bootstrap-timeout',
  reconcile: 'reconcile-timeout',
};

/** 排队时（caller 同步栈）捕获的代际资源所有权（§D1，issue #171 Scope 2）：
 *  执行期只处置捕获对象——「先捕获、后处置」，迟到续体不得触碰当前代字段。
 *  R1（SA2 #3）：不含 epoch——代际判别由 runDisposal 的**身份守卫**（session
 *  对象同一性）承担；epoch 比对仅保留于 §D2 收口续体的 wire 副作用门（局部变量）。 */
interface CleanupClaim {
  readonly session: ReplicationSession | undefined;
  readonly lease: NamespaceLease | undefined;
  readonly unsubscribe: (() => void) | undefined;
}

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
    'periodic-reconcile': undefined,
    close: undefined,
  };
  private cleanupTail: Promise<void> = Promise.resolve();
  private closeMemo: Memoized | undefined;
  private closeSequence: number | undefined;
  /** 【issue #287 / ADR 0018 §3】re-arm fatal → 主动 CLOSE_NAMESPACE 的恰一次闩锁。
   *  置位时机 = 本控制器观察到 re-arm fatal outcome 的同步段（发射 observer 事件 + 触发
   *  收口）。语义 = 「对本 namespace 的 fatal 收口动作已启动」——CLOSE_NAMESPACE 恰一帧
   *  （与 `removeTarget` 的幂等合流双保险），后续同 namespace 的迟到 re-arm 失败 outcome
   *  零新帧、零新收口、零新事件（`schema-rearm-failed` 计数不变量 = 每次 re-arm fatal
   *  置位恰一事件；Runtime 侧「同一文本不自动重试」是主要保证，本闩为通道侧同向防御）。 */
  private rearmFatalClosed = false;
  /** R3（SA4）：close 承诺的事件驱动结算器——settleCloseMemo 触发前 removeTarget 的
   *  promise 保持 pending（零轮询环；AC3b closeSettled===false 锚语义）。 */
  private closeSettleResolve: (() => void) | undefined;

  readonly round: RoundEngine;
  readonly channel: UpdateChannel;
  readonly watchdog: FenceWatchdog;
  private readonly onOwnedBound: (bytes: Uint8Array) => void;
  /** 构造期捕获的 observer 在场标记（options 注入后不可变——热路径判空零调用）。 */
  private readonly observerOn: boolean;

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
        this.declareLocalResync('connection-shed');
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
    this.observerOn = host.observerPresent();
    this.onOwnedBound = (bytes: Uint8Array): void => this.onOwnedUpdate(bytes);
    this.round = new RoundEngine({
      role: 'peer',
      send: (message) => {
        const seq = this.sendChecked(message);
        // PN11：出向 Step2 diff 字节（seq>0 时发射——0 = 帧被否决，未出站）
        if (seq > 0 && message.kind === 'SYNC_STEP2' && this.observerOn) {
          const encodedUpdateBytes = message.update.byteLength;
          this.host.emitObserver({
            type: 'sync-step2-sent',
            side: 'peer',
            ...(cidField(this.host.connectionId())),
            namespaceId: this.namespaceId,
            bytes: encodedUpdateBytes,
            // issue #239 append-only：wire roundId 投影 + 长度澄清（恒 === bytes）
            syncRoundId: message.syncRoundId,
            encodedUpdateBytes,
          });
        }
        return seq;
      },
      encode: (kind, remoteSV) => {
        try {
          const session = this.session;
          if (session === undefined) throw new RoundAborted();
          return kind === 'stateVector'
            ? session.encodeStateVector()
            : session.encodeDiff(remoteSV ?? new Uint8Array(0));
        } catch (err) {
          if (err instanceof RoundAborted) throw err;
          this.applyOutcome(mapEncodeThrow(this.session), 'apply-rejected');
          throw new RoundAborted();
        }
      },
      applyStep2: (update, step2Sequence, syncRoundId) =>
        this.applyStep2(update, step2Sequence, syncRoundId),
      onViolation: () => {
        this.sendNsError('SYNC_STATE_VIOLATION');
        this.finalize('failed', 'protocol-violation');
      },
      onRoundSettled: () => this.onRoundSettled(),
    });
    this.round.bind(target.namespaceId);
    this.channel = new UpdateChannel({
      limits: host.limits,
      ackTimeoutMs: host.timeouts.ackTimeoutMs,
      sendUpdateFrame: (bytes) => this.sendUpdateFrame(bytes),
      declareLocalResync: (cause, failureDetail) => this.declareLocalResync(cause, failureDetail),
      noteUpdateDropped: (detail) => this.noteUpdateDropped(detail),
      notePendingResync: () => {
        this.pendingResync = true;
      },
      onAckTimeout: () => this.onAckTimeoutFired(),
      onUpdateAcked: (info) => this.onUpdateAcked(info),
      noteUpdateSent: (info) => this.onUpdateSent(info),
      now: () => this.host.now?.(),
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
        if (!this.isConnectionDead()) this.finalize('failed', 'open-failed');
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
        this.finalize('failed', 'open-failed');
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
        this.finalize('failed', 'open-failed');
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
        this.finalize('failed', 'replication-disabled');
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
      if (this.state === 'disconnected') {
        return; // §D7：GOAWAY drain 窗口（连接存活）迟到的 OPEN_OK —— 静默忽略
      }
      if (!this.isTerminal()) {
        // closing → finalize('failed') 保留（sa7-hardening D6：「closing 期迟到 OPEN_OK
        // → finalize + E5 结算」绿灯锚不动）
        this.sendNsError('NAMESPACE_STATE_VIOLATION');
        this.finalize('failed', 'protocol-violation');
      }
      return;
    }
    this.clearTimer('open');
    if (message.mode === 0) {
      if (this.openDeclaredLocal !== false) {
        this.sendNsError('NAMESPACE_STATE_VIOLATION');
        this.finalize('failed', 'protocol-violation');
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
      this.finalize('failed', 'protocol-violation');
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
      if (!this.isConnectionDead()) this.finalize('failed', 'session-open-failed');
      return false;
    }
    if (!result.ok) {
      if (!this.isConnectionDead()) this.finalize('failed', 'session-open-failed');
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
    // §D5.2（issue #171）：代际重置——新代 session 建成：清上一代残留的
    // round/channel/watchdog 簿记与 closeSequence（旧代 disposal 若仍悬挂，其身份
    // 守卫（§D1）不命中新代 session → 不触碰 aux；残留清理由新代 open 路径自担）。
    // channel.teardown() 置 needsResync=true 与既有断线路径（处置段 teardown）行为
    // 一致：gen1 未发送队列按「断线期间不维持 update outbox」丢弃，恢复由 round diff
    // + 既有 resync 机制修复（与现行断线重连语义逐字同构，非新行为）。
    this.round.teardown();
    this.channel.teardown();
    this.watchdog.teardown();
    this.closeSequence = undefined;
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
      if (this.state === 'disconnected') {
        return; // §D7：GOAWAY drain 窗口迟到的 BOOTSTRAP_SNAPSHOT —— 静默忽略
      }
      if (!this.isTerminal()) {
        this.sendNsError('NAMESPACE_STATE_VIOLATION');
        this.finalize('failed', 'protocol-violation');
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
      this.finalize('failed', 'protocol-violation');
      return;
    }
    const detached = new Y.Doc();
    try {
      Y.applyUpdate(detached, message.snapshot);
    } catch {
      this.sendNsError('BOOTSTRAP_FAILED');
      this.finalize('failed', 'apply-rejected');
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
          this.finalize('failed', 'apply-rejected');
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
        this.finalize('failed', 'apply-refused');
        return;
      }
      this.lease = importResult.lease;
      // PN4：bootstrap 导入字节（成功分支；importResult.ok 已判定、BOOTSTRAP_ACK 之前）
      if (this.observerOn) {
        this.host.emitObserver({
          type: 'bootstrap-imported',
          side: 'peer',
          ...(cidField(this.host.connectionId())),
          namespaceId: this.namespaceId,
          bytes: message.snapshot.byteLength,
        });
      }
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
    if (this.isInboundQuiet()) return; // §9.2 首行 + §D7：closing/终态/失联（GOAWAY drain 窗口）静默忽略
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
    if (this.isInboundQuiet()) return;
    try {
      this.round.onStep2(message);
    } catch (err) {
      if (!(err instanceof RoundAborted)) throw err;
    }
  }

  onSyncApplied(message: { syncRoundId: number; ackedSequence: number }): void {
    if (this.isInboundQuiet()) return;
    try {
      this.round.onApplied(message);
    } catch (err) {
      if (!(err instanceof RoundAborted)) throw err;
    }
  }

  onResyncReceived(): void {
    if (this.isInboundQuiet()) return;
    this.channel.markResyncReceived();
    this.setState('needs-resync');
    this.emitResyncRequired('remote-declared'); // PN6
    this.maybeStartRecovery();
  }

  onHubUpdate(message: { update: Uint8Array; sequence: number }): void {
    if (this.isInboundQuiet()) return; // §11.3 + §D7：closing/终态/失联静默忽略
    const accepted =
      this.state === 'live' ||
      this.state === 'needs-resync' ||
      (this.state === 'reconciling' && this.round.wasLive);
    if (!accepted) {
      // 无生命周期/opening/bootstrapping/首轮 reconciling → 真违例（§7.2 收口）
      this.sendNsError('NAMESPACE_STATE_VIOLATION');
      this.finalize('failed', 'protocol-violation');
      return;
    }
    if (message.update.byteLength > this.host.limits.maxUpdateBytes) {
      this.sendNsError('UPDATE_TOO_LARGE');
      this.finalize('failed', 'protocol-violation');
      return;
    }
    void this.applyRemoteUpdate(message.update, message.sequence);
  }

  onUpdateAck(message: { ackedSequence: number }): void {
    if (this.isInboundQuiet()) return;
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
    this.clearAllTimers(); // §D5：进 closing 即清 open/bootstrap/reconcile 残留 timer（防静默期 fire → finalize('failed')）
    this.setState('closing');
    this.quiesceSync();
    // §D2（issue #171）：对称收口（§13.2）——停接纳 → 等已接纳 apply → 只处置
    // **排队前捕获**的 gen-N session/lease → epoch 门内 CLOSE_OK + closed + settle。
    // R1（SA2 #1）：claim 在 caller 同步栈（onCloseRequest 同步段 quiesceSync 之后）
    // 求值——绝不放进任务 lambda（执行期捕获 = 可杀新代的错代载体）。
    const claim = this.claimForDisposal(); // ★ 排队前捕获（unsubscribe 已由 quiesceSync 清空 → 捕获值 = undefined，句柄已退）
    const epoch = this.host.connectionEpoch();
    void this.enqueueLifecycle(async () => {
      await this.drainPendingApplies(); // §16：已接纳 apply 无条件排空（不取消）
      await this.runDisposal(claim); // 只处置捕获的 gen-N session/lease（身份守卫兜底）
      if (this.host.connectionEpoch() !== epoch) {
        return; // ★ P3 核心：跨代 → 零 CLOSE_OK、零 setState、零 settle（settle 已由断线分支完成）
      }
      this.sendChecked({
        kind: 'CLOSE_OK',
        namespaceId: this.namespaceId,
        ackedSequence: message.sequence, // 本端为 CLOSE_NAMESPACE 接收方 → 回发 CLOSE_OK（协议 §5 Result 语义）
      });
      if (this.state !== 'closed') this.setState('closed');
      this.settleCloseMemo();
    }).catch(() => undefined); // R1（SA2 #7）：fire-and-forget 显式吞错（任务体结构性零 throw，防御 seam 偏差）
  }

  onCloseOk(ackedSequence: number): void {
    if (this.isTerminal() || this.state === 'disconnected') {
      // §13.4 迟到纪律：终态/失联静默（含 GOAWAY drain 窗口——§D7）；承诺已结算，不复活
      return;
    }
    if (this.state === 'closing') {
      if (this.closeSequence !== undefined && ackedSequence === this.closeSequence) {
        // 本端 removeTarget 发出的 CLOSE_NAMESPACE 的关联确认 → 收口完成信号
        this.clearTimer('close');
        this.setState('closed');
        this.settleCloseMemo();
        return;
      }
      // ★ RC5/C4 + R1（SA2 #2）：closing 期其余一切 CLOSE_OK（有 closeSequence 而错配，
      // 或 closeSequence===undefined 即 close 源于 hub 发起的 CLOSE_NAMESPACE——本端从未
      // 发出 CLOSE_NAMESPACE，入站 CLOSE_OK 按定义 unmatched）→ 按库内 ACK 关联权威策略
      // 显式收口，不做任何静默完成（AC4「no silent completion」）
      this.host.connectionFatal('ACK_STATE_VIOLATION', 1002);
      return;
    }
    // 活跃态收到未请求的 CLOSE_OK：peer 全库唯一 CLOSE_NAMESPACE 发送点 = removeTarget
    // （hub 侧发送点为零——hub-connection.ts 将入站 CLOSE_OK 判方向异常）→ 本端未请求
    // 即伪造/错向帧，同款 ACK 关联违例
    this.host.connectionFatal('ACK_STATE_VIOLATION', 1002);
  }

  onIdentityChanged(): void {
    // 零 apply（控制帧不进 sequencer）；本地 META/epoch 不变（AC6 锚）
    if (this.state === 'closing') {
      return; // §13.4：closing 期 terminal 帧只推进收口
    }
    this.emitIdentityConflicted('identity-changed-frame'); // PN8
    this.finalize('conflicted');
  }

  onErrorFrame(message: { code: string }): void {
    if (this.isInboundQuiet()) return; // §D7：closing/终态/失联静默（静默期终局 ERROR 无处置面——连接将死）
    if (this.state === 'closing') {
      // R3/#5d：closing 中 terminal ERROR → 维持 closing（零回发帧）
      return;
    }
    const terminal = toFinalState(terminalStateOf(message.code));
    if (this.observerOn) {
      this.host.emitObserver({
        type: 'namespace-error',
        side: 'peer',
        ...(cidField(this.host.connectionId())),
        namespaceId: this.namespaceId,
        code: stableNamespaceCode(message.code),
        direction: 'received',
        terminalState: terminal,
      });
    }
    // issue #256：对端 ERROR 驱动的终局以 'remote-error' 标记——与本地失败零重复计数
    if (terminal === 'failed') {
      this.finalize('failed', 'remote-error');
    } else {
      this.finalize(terminal);
    }
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
        // ★ F1（SA4 复审，issue #171）：本地结算同样排队处置——GOAWAY drain 窗口
        // （轻量层 onConnectionQuiesce 投影 disconnected + **零处置排队**）内 removeTarget
        // 落入本分支时，若不排队处置，deadline 全量层 onConnectionFatal 将以
        // isTerminal()（closed）早退 → session/lease/watchdog 永久泄漏（AC2 违例；
        // 对 ef19bae 基线回归）。补排 = 与同函数 seq≤0 分支同款：claim 于本同步段
        // 捕获——'targeted' 态为空 → 幂等 no-op；'disconnected' 态 = 本代资源 →
        // 恰一次处置（与 loss 路径已排队处置经幂等 same-promise 兑付）。**不拆**终态
        // 早退门（onConnectionFatal 的 isTerminal() 保护终态控制器免受重复静默投影）。
        void this.cleanupResources().catch(() => undefined);
        return this.closeMemo?.get() ?? Promise.resolve();
      case 'opening':
      case 'bootstrapping':
      case 'reconciling':
      case 'live':
      case 'needs-resync': {
        this.clearAllTimers(); // ★ RC3：清残留 open/bootstrap/reconcile timer（防 closing 期触发 finalize('failed') 污染收口）
        this.setState('closing');
        const seq = this.sendChecked({
          kind: 'CLOSE_NAMESPACE',
          namespaceId: this.namespaceId,
          reasonCode: 'target-removed',
        });
        if (seq > 0) {
          this.closeSequence = seq; // ★ RC4：仅在 CLOSE 确实上线时武装 CLOSE_OK 等待
          this.armTimer('close');
          return this.ensureCloseMemo();
        }
        // ★ RC4/AC3：发送被抑制（connState!=='ready' / 出站未就绪 → sendControl 静默 0）
        // —— CLOSE 未上线即不得等待 CLOSE_OK：本地收口 + 立即结算（不等 closeTimeoutMs）
        this.closeSequence = undefined;
        this.setState('closed');
        this.settleCloseMemo();
        void this.cleanupResources().catch(() => undefined); // R1（SA2 #7）：drain 由 session.close barrier 承担（§16 无条件排空）
        return this.closeMemo?.get() ?? Promise.resolve();
      }
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
      // §D3（issue #171）：claim 于 memo 创建时（= removeTarget 同步段）排队前捕获
      // （R1/SA2 #1）——执行期只处置捕获对象，不读回当前字段。
      const claim = this.claimForDisposal();
      this.closeMemo = new Memoized(async () => {
        await this.enqueueLifecycle(async () => {
          await this.drainPendingApplies();
          await this.runDisposal(claim);
        });
        await gate; // 事件驱动结算（onCloseOk/closeTimeout/断线/blocked/stop/E5 终局）
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
   *  §13.3/§14.1：failed 等待连接重建——断线投影 disconnected 后重连重 OPEN）。
   *  §D5.1（issue #171）：全分支同步段 clearAllTimers + 摘订阅 + 处置排队（claim 化）。 */
  onConnectionLost(): void {
    this.clearTimer('periodic-reconcile');
    if (this.state === 'closed' || this.state === 'conflicted') return; // 终态保持
    this.clearAllTimers(); // ★ RC3：断线同步段清全部 timer（open/bootstrap/reconcile/close）
    this.quiesceSync(); // 同步摘本代 listener（既有）
    if (this.state === 'closing') {
      this.setState('disconnected');
      this.settleCloseMemo(); // R3 既有：断线 = 关闭承诺兑现
      return; // 处置由已排队的 close 续体承担（不变量 I-C，§4.2）
    }
    if (this.state === 'failed') {
      this.setState('disconnected');
      void this.cleanupResources().catch(() => undefined); // finalize 已排队（幂等兑付）；防御性保底
      return;
    }
    // B-2d：投影先行——cleanup 卡 session.close 屏障（在途 apply 未排空）不得让投影
    // 滞留 live（重连 openActiveTargets 会跳过 live → 永不重 OPEN）；资源收口异步进行
    this.setState('disconnected');
    void this.cleanupResources().catch(() => undefined);
  }

  /** §D6（issue #171，R1/SA2 #4 新增）——GOAWAY RESTARTING 收帧同步段的**轻量**静默：
   *  与全量层（onConnectionFatal）的差异 = **零处置排队**。摘订阅（G5 数据面双保险
   *  之一）+ 清 timer + closing 承诺结算 + 投影 disconnected 即止；session/lease 处置
   *  与 aux teardown 留给 deadline 回调（§D6 全量层）或 transport 失联
   *  （onConnectionLost/onConnectionFatal）——处置时点与现状完全一致（D5 计面不变的根据）。 */
  onConnectionQuiesce(): void {
    if (this.isTerminal()) return;
    this.quiesceSync();
    if (this.state === 'closing') {
      // §6.3：deadline 前允许结算 GOAWAY 前已发送的 CLOSE_NAMESPACE；保留 close timer、
      // closing 投影及 settle gate，使关联 CLOSE_OK 仍可完成自然握手。blocked/fatal
      // 则由 onConnectionFatal 显式结算。
      return;
    }
    this.clearAllTimers();
    this.setState('disconnected');
  }

  /** 连接 blocked（fatal）：**全量**静默 = 轻量段 + 处置排队。 */
  onConnectionFatal(): void {
    if (this.isTerminal()) return;
    const wasClosing = this.state === 'closing';
    this.onConnectionQuiesce();
    if (wasClosing) {
      this.clearAllTimers();
      this.setState('disconnected');
      this.settleCloseMemo();
    }
    // closing 分支的补排队 = 有意保底（§4.2 不对称裁决）：不变量 I-C 下幂等零副作用；
    // 安全前提 = R1（SA2 #1）修复后的排队前捕获——claim 在本同步段求值恒为本代资源。
    void this.cleanupResources().catch(() => undefined);
  }

  /** stop()：一律收口为 closed（本地，零 wire）。 */
  onConnectionStopped(): Promise<void> {
    this.clearAllTimers();
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
    this.armTimer('periodic-reconcile');
  }

  private onAckTimeoutFired(): void {
    if (this.state === 'live' || this.state === 'needs-resync') {
      this.clearTimer('periodic-reconcile');
      this.setState('needs-resync');
      this.emitResyncRequired('ack-timeout'); // PN6b：peer 不发 RESYNC_REQUIRED——本地边沿通知
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

  /** Peer-owned one-shot cadence: re-armed only after the namespace returns to live. */
  private startPeriodicReconcile(): void {
    if (this.state !== 'live') return;
    if (this.channel.inFlightCount > 0) {
      this.armTimer('periodic-reconcile');
      return;
    }
    this.clearTimer('periodic-reconcile');
    this.setState('reconciling');
    this.armTimer('reconcile');
    this.startRound();
  }

  private declareLocalResync(
    cause:
      | 'queue-overflow'
      | 'send-failed'
      | 'connection-shed'
      | 'session-fanout-overflow'
      | 'remote-declared'
      | 'ack-timeout',
    failureDetail?: () => UpdateSendFailureDetail,
  ): void {
    if (this.resyncDeclared) return;
    this.clearTimer('periodic-reconcile');
    this.resyncDeclared = true;
    this.sendChecked({
      kind: 'RESYNC_REQUIRED',
      namespaceId: this.namespaceId,
      reasonCode: 'send-queue-overflow',
    });
    this.setState('needs-resync');
    this.emitResyncRequired(cause, failureDetail); // PN5：仅 resyncDeclared false→true 翻转时发射
    this.maybeStartRecovery();
  }

  private onWatchdogEdge(_predicate: WatchdogPredicate): void {
    // §D5.3（issue #171）：静默域零复活——失联/GOAWAY 静默期 watchdog idle 探测命中
    // needsResync 边沿时不得 setState('needs-resync') + 发 RESYNC 帧（跨代/静默域复活
    // + 噪声帧）；hub 侧 declareHubResync 已有同款 isQuietState 门——peer 侧补齐对称
    // 缺口（disconnected 一并入静默域，见 §D7）。
    if (this.isQuietState() || this.state === 'disconnected') return;
    // peer 侧仅 needsResync 边沿生效（fence 结构性不命中——防御判别在帧处理钩子）
    this.channel.markSessionResyncEdge();
    if (this.resyncDeclared) return;
    this.clearTimer('periodic-reconcile');
    this.resyncDeclared = true;
    this.sendChecked({
      kind: 'RESYNC_REQUIRED',
      namespaceId: this.namespaceId,
      reasonCode: 'send-queue-overflow',
    });
    this.setState('needs-resync');
    this.emitResyncRequired('session-fanout-overflow'); // PN5②（自持声明逻辑）
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
      const seq = this.host.sendData(this.namespaceId, bytes);
      // PN10 出向 UPDATE 帧字节事件发射已移至 onUpdateSent（issue #238：sequence +
      // sendQueueMs 需在通道记账后构型——noteUpdateSent 恰一回调；seq>0 才触发）
      return seq;
    } catch {
      return 0;
    }
  }

  /** PN12：本出向 UPDATE 被对端 ACK 收妥（数据来自 UpdateChannel 记账；issue #238：
   *  sequence = 被 ACK 帧序 = wire ackedSequence——与对端 update-applied{sequence}
   *  构成回程闭环）。 */
  private onUpdateAcked(
    info: Readonly<{ bytes: number; latencyMs?: number; sequence: number }>,
  ): void {
    if (!this.observerOn) return;
    this.host.emitObserver({
      type: 'update-acked',
      side: 'peer',
      ...(cidField(this.host.connectionId())),
      namespaceId: this.namespaceId,
      bytes: info.bytes,
      sequence: info.sequence,
      ...(info.latencyMs !== undefined ? { ackLatencyMs: info.latencyMs } : {}),
    });
  }

  /** PN10：本出向 UPDATE 帧实际出站记账事件（issue #238——seq>0 每帧恰一；含帧级
   *  sequence 与发送队列等待差值）。 */
  private onUpdateSent(
    info: Readonly<{ sequence: number; bytes: number; sendQueueMs?: number }>,
  ): void {
    if (!this.observerOn) return;
    this.host.emitObserver({
      type: 'update-sent',
      side: 'peer',
      ...(cidField(this.host.connectionId())),
      namespaceId: this.namespaceId,
      bytes: info.bytes,
      sequence: info.sequence,
      ...(info.sendQueueMs !== undefined ? { sendQueueMs: info.sendQueueMs } : {}),
    });
  }

  private async applyStep2(
    update: Uint8Array,
    step2Sequence: number,
    syncRoundId: number,
  ): Promise<'ok' | 'aborted'> {
    const epoch = this.host.connectionEpoch();
    const outcome = await this.applyRemoteUpdate(update, step2Sequence, true, syncRoundId);
    if (outcome === 'ok' && this.host.connectionEpoch() === epoch) {
      // §9.1.4：apply 成功 → 发 SYNC_APPLIED（ackedSequence = 收到的 Step2 帧序）；
      // B-2d：连接已重建 → 旧 round 的 Applied 不发（迟到的控制帧不得落新连接）
      // §D5.4（issue #171，R1/SA2 #8 裁决 (a) 对称放行）：drain 窗口（连接存活、epoch
      // 未变）内 SYNC_APPLIED 与 UPDATE_ACK 同属「已接纳工作的 ACK」——照常发送，完成
      // 在途 round 收尾（§9.4 L250「已接纳 update 正常 apply/ACK」是协议义务，非新数据）；
      // 重连后 epoch 不符 → 零发送。'disconnected' 照发：连接存活 + epoch 未变 = 在途
      // round 合法收尾（round 结算后的状态推进由 B-1 守卫兜底：state≠'reconciling' →
      // 零迁移、不复活 live）。
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

  /** 统一 apply 管线（§11.1/§11.3 镜像：UPDATE / Step2 diff）。
   *  第四参 `syncRoundId`（issue #239）：isStep2 时恒在（帧携带 wire roundId 的显式
   *  透传投影，D2）——UPDATE 路径（isStep2=false）零投影。 */
  private async applyRemoteUpdate(
    update: Uint8Array,
    sequence: number,
    isStep2 = false,
    syncRoundId?: number,
  ): Promise<'ok' | 'failed'> {
    const session = this.session;
    if (session === undefined) {
      if (!this.isTerminal()) this.finalize('failed', 'session-missing');
      return 'failed';
    }
    const epoch = this.host.connectionEpoch(); // B-2d：代际捕获——旧连接的迟到 ACK 不得落新连接
    // §5.7：在调用 applyRemoteUpdate 前采样，完整覆盖同步接纳与 sequencer 排队；
    // host.now 已经 safeNow 折叠，观测时钟异常不会阻断协议路径。
    const t0 = this.observerOn ? this.host.now?.() : undefined;
    // issue #239：Step2 效果组 before 捕获——帧分发同步段（t0 采样同点、同纪律：
    // 同步读面、sequencer 入队前、完整覆盖排队窗口）；门控 isStep2 && observerOn
    // （无 observer / UPDATE 热路径零新增读取）。捕获 throw → safeStateVector 折叠
    // → undefined → 效果字段组整组缺失，绝不外溢协议路径（§23.4）。
    const svBefore =
      isStep2 && this.observerOn ? safeStateVector(() => session.encodeStateVector()) : undefined;
    const pending = session.applyRemoteUpdate(update);
    this.pendingApplies.add(pending);
    try {
      const result = await pending;
      if (!result.ok) {
        this.applyOutcome(
          mapSessionRefusal(result.code, this.session, this.runtimeSnapshot(), 'peer'),
          'apply-refused',
        );
        return 'failed';
      }
      if (this.observerOn) {
        // issue #239：after 捕获（同 session 引用——provenance = 实际执行该 apply 的
        // session；期间被关闭 → 同步 throw → 折叠 → 效果组整组缺失）+ 效果派生。
        // degraded 判别在结算后才可得：before 已捕获，after/派生照做，效果组在
        // degraded 分支不附着（丢弃）——成本有界（每 Step2 apply 至多 2 次 SV 读取
        // + 2 次 digest；§23.4 纪律）。
        const svAfter =
          svBefore !== undefined
            ? safeStateVector(() => session.encodeStateVector())
            : undefined;
        const svEqual =
          svBefore !== undefined && svAfter !== undefined
            ? stateVectorBytesEqual(svBefore, svAfter)
            : undefined;
        const effect =
          svEqual !== undefined
            ? {
                stateVectorChanged: !svEqual,
                applyEffect: svEqual ? ('noop' as const) : ('changed' as const),
                stateVectorBeforeHash: stateVectorSafeDigest(svBefore!),
                stateVectorAfterHash: stateVectorSafeDigest(svAfter!),
              }
            : undefined;
        // PN7'：每笔成功 apply 恰一事件（§3.1 互斥三选一；degraded 判别仅在 observer 在场读投影）
        const degraded = this.degradedBypassActive();
        if (degraded) {
          this.host.emitObserver({
            type: 'degraded-bypass-applied',
            side: 'peer',
            ...(cidField(this.host.connectionId())),
            namespaceId: this.namespaceId,
            bytes: update.byteLength,
            // issue #238：帧级关联（按既有纪律不携时延字段——F6）
            sequence,
          });
        } else {
          const t1 = this.host.now?.();
          const applyLatencyMs =
            t0 !== undefined && t1 !== undefined ? t1 - t0 : undefined;
          // issue #238：result.stages = 槽内四段差值（registry stageClock 注入时在场；
          // 全 present 或全缺席）；sequence = 触发帧 envelope sequence——三事件面关联键
          const base = {
            side: 'peer',
            ...cidField(this.host.connectionId()),
            namespaceId: this.namespaceId,
            bytes: update.byteLength,
            sequence,
            ...(applyLatencyMs !== undefined ? { applyLatencyMs } : {}),
            ...(result.stages !== undefined ? { ...result.stages } : {}),
          } as const;
          if (isStep2) {
            // issue #239 append-only：wire roundId 投影 + 长度澄清 + 效果字段组
            // （组单命运：effect 整组 spread / 整组缺——绝不部分出现、绝不伪造 noop）
            this.host.emitObserver({
              type: 'sync-diff-applied',
              ...base,
              syncRoundId: syncRoundId!,
              encodedUpdateBytes: update.byteLength,
              ...(effect !== undefined ? effect : {}),
            });
          } else {
            this.host.emitObserver({ type: 'update-applied', ...base });
          }
        }
      }
      // ── issue #287 / ADR 0018 §4：re-arm outcome 的通道侧结算（observer 事件 +
      //    fatal 主动收口）──
      //  位置纪律：apply 槽已结算（ok:true）、`getActiveSchema()` 已切换（安装发生在槽内
      //  R5.6，ADR 0018 §1）之后——§23.4「决策落定后发射」。观察无条件（不因
      //  observerOn/degraded/closing 而静默）：re-arm 是已提交的 Runtime 事实，事件与
      //  收口动作必须与该事实同真——若把它挂进 observer 分支，则「无 observer 时 fatal
      //  渠道不关闭」会让通道停留在旧 tools 继续收敛未校验写（ADR 0018 §3 明文拒绝的
      //  状态）。事件构造本身仍在 emitSchemaRearm* 内部做 observer 缺席短路——「无
      //  observer = 零事件构造/零 live 读取/零时钟调用」纪律不破（§23.1/§23.4）。
      if (result.schemaRearm !== undefined) {
        this.settleSchemaRearm(result.schemaRearm);
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
      this.applyOutcome(mapRejection(this.session, this.runtimeSnapshot(), 'peer'), 'apply-rejected');
      return 'failed';
    } finally {
      this.pendingApplies.delete(pending);
    }
  }

  /**
   * §3.4 peer degraded bypass 判别（零 Registry/Runtime 改动）：apply 成功后读
   * lease.getStatus() 投影——`rootWrite.enabled === false` ∧ runtime 健康（lifecycle
   * 'ready' ∧ fatal null）⟹ bypass 分支（ADR L131-137：认证 Hub→Peer session 仍可
   * memory apply）。仅 observer 在场时调用（热路径纪律：无 observer 零投影读取）。
   * 已知近似性声明（设计 §3.4）：判定在 apply 完成后读投影，状态翻转窗口内产生
   * 单笔误归因——observation 非行为开关，runtime 槽内决策仍是权威事实。
   */
  private degradedBypassActive(): boolean {
    const lease = this.lease;
    if (lease === undefined) return false;
    try {
      const status = lease.getStatus();
      if (status.lease !== 'active' || status.runtime === null) return false;
      const runtime = status.runtime;
      return (
        runtime.lifecycle === 'ready' &&
        runtime.fatal === null &&
        runtime.rootWrite.enabled === false
      );
    } catch {
      return false;
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

  private applyOutcome(
    mapped: MappingOutcome,
    // issue #256：终态原因由调用点提供（拒绝/异常/编码面语义无歧义区分点 = 调用点）；
    // 仅 failed 终局消费（conflicted/closed 忽略）。
    cause: ReplicationNamespaceFailedCause,
  ): void {
    switch (mapped.kind) {
      case 'wire': {
        this.sendNsError(mapped.code);
        const final = toFinalState(mapped.terminalState);
        if (final === 'failed') {
          this.finalize('failed', cause);
        } else {
          this.finalize(final);
        }
        return;
      }
      case 'fence':
        // peer 侧防御性对称保留：命中即按 conflicted 终局收口（零 wire）
        this.emitIdentityConflicted('fence'); // PN9：apply 期围栏
        this.finalize('conflicted');
        return;
      case 'local': {
        const final = toFinalState(mapped.terminalState);
        if (final === 'failed') {
          this.finalize('failed', cause);
        } else {
          this.finalize(final);
        }
        return;
      }
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
    this.emitNsErrorSent(code); // PN2：本端 ns ERROR（稳定码折叠）
  }

  private sendChecked(message: ReplicationMessage): number {
    try {
      return this.host.sendControl(message);
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (typeof code === 'string' && !this.isTerminal()) {
        // codec 编码超限（编码面抛）：同码命名空间 ERROR + failed（§9.1 注记）
        this.sendNsErrorNoWrap(code);
        if (message.kind !== 'ERROR') this.emitNsErrorSent(code); // PN2：编码面失败族；ERROR 自发射路径防双计
        this.finalize('failed', 'send-failed');
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

  private finalize(state: 'failed', cause: ReplicationNamespaceFailedCause, timeoutMs?: number): void;
  private finalize(state: 'conflicted' | 'closed'): void;
  private finalize(
    state: 'failed' | 'conflicted' | 'closed',
    cause?: ReplicationNamespaceFailedCause,
    timeoutMs?: number,
  ): void {
    if (this.isTerminal()) return; // 终态不降级（§12 finalize 同款幂等）
    this.clearAllTimers();
    this.setState(state);
    // issue #256：failed 终态边沿恰一可诊断原因事件（isTerminal 早退保证终态不降级、
    // 不重复——closing 期/终态后迟到的 finalize 调用零事件）；决策落定后发射
    // （setState 之后，§23.4）。
    if (state === 'failed' && cause !== undefined) {
      this.emitNamespaceFailed(cause, timeoutMs);
    }
    // E5 终局收口（SA2 R3 / §3.8 裁决 3）：failed/conflicted 也是收口终态——closeMemo
    // 的事件驱动结算不区分终态种类，一律 settle（AC3b/⑤c/⑤d 回归面已核查为零）。
    this.settleCloseMemo();
    void this.cleanupResources().catch(() => undefined);
  }

  /** issue #256：namespace-failed（cause 闭联合；observer 缺省零事件构造——
   *  cause/timeoutMs 实参 = 稳定字面量/resolved 配置字段，无 live 状态读取、零时钟调用）。 */
  private emitNamespaceFailed(cause: ReplicationNamespaceFailedCause, timeoutMs?: number): void {
    if (!this.observerOn) return;
    this.host.emitObserver({
      type: 'namespace-failed',
      side: 'peer',
      ...(cidField(this.host.connectionId())),
      namespaceId: this.namespaceId,
      cause,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
  }

  // ── issue #287 / ADR 0018 §3–§4：re-arm 通道侧结算（observer 事件 + fatal 主动收口）──

  /**
   * re-arm outcome 的通道侧结算单点（协议 §23.1 第 23/24 型）。
   *
   * 成功（`kind:'applied'`）：恰一 `schema-rearm-applied` 事件——新 semanticFingerprint
   * + 复制来的 updatedAt（诚实缺席 null）。纯格式差异的 fingerprint 不变安装同样发射
   * （ADR 0017「每次提交都推进」对齐，不据 fingerprint 跳过）。
   *
   * 失败（`kind:'failed'`）：恰一 `schema-rearm-failed` 事件（稳定双码之一）+ **本
   * namespace channel 主动 CLOSE_NAMESPACE**（ADR 0018 §3：诚实快速失败、双侧资源立即
   * 释放、`closed` 终态、重连不自动重开、不产生重试循环）。收口动作经既有唯一
   * CLOSE_NAMESPACE 发送点 `removeTarget()`——**不是新机制**：它同时保证「恰一帧」
   * （Memoized 幂等合流 + closing/终态早退）、「不自动重开」（`intent='removed'` 令
   * `onConnectionReady`/`openActiveTargets` 跳过）、「资源立即释放」（drain 已接纳 apply
   * → 处置 session/lease）三个契约。恢复入口保持 ADR 0018 §3 的三条：显式 re-add、
   * reset-replica、进程重启。
   *
   * 形态选择说明：fatal **不**走 `applyOutcome` 的 `kind:'local'` 终局（那会 `finalize`
   * 为 `failed` 终态 + `namespace-failed` 事件——那是「本笔 apply 失败」的语义，而本
   * 事实是「apply 已成功提交、Runtime 已 fatal」）；也**不**走 `kind:'wire'`（那会发
   * namespace ERROR 帧）。ADR 0018 §3 明文动作是 CLOSE_NAMESPACE，故此处直连
   * `removeTarget()`。
   *
   * 静默纪律：observer 缺席 ⇒ 事件构造短路（零字段读取）；收口动作照常执行（re-arm
   * fatal 的通道关闭是行为契约而非观测面——与 §23.1「observer 缺省零事件」不冲突）。
   *
   *  闩锁顺序（issue #287 复审修正）：`rearmFatalClosed` 判定**先于发射与收口**——闩锁
   *  是「恰一」的判据本身，不是收口的附带物。置于发射之后，迟到的第二个 failed outcome
   *  （`closed` 通道仍可接纳迟到的入站 UPDATE 并照常 apply，fatal 重复置位）会产出第二发
   *  `schema-rearm-failed`，与 §23.1 计数不变量「每次 re-arm fatal 置位恰一事件」背离；
   *  本处不依赖「通道已关闭」这一外部性质来保证计数。
   */
  private settleSchemaRearm(outcome: ReplicationSchemaRearmOutcome): void {
    if (outcome.kind === 'applied') {
      this.emitSchemaRearmApplied(outcome.semanticFingerprint, outcome.updatedAt);
      return;
    }
    if (this.rearmFatalClosed) return; // 恰一次：迟到失败 outcome 零新事件、零新帧、零新收口
    this.rearmFatalClosed = true;
    this.emitSchemaRearmFailed(outcome.code);
    void this.removeTarget().catch(() => undefined); // 任务体结构性零 throw（防御 seam 偏差）
  }

  /** 第 23 型：re-arm 安装成功（字段 = §23.3 安全清单内的 fingerprint/updatedAt——
   *  operation 恒 peer、零 schema 文本、零 ROOT、零 live 引用）。 */
  private emitSchemaRearmApplied(semanticFingerprint: string, updatedAt: string | null): void {
    if (!this.observerOn) return;
    this.host.emitObserver({
      type: 'schema-rearm-applied',
      side: 'peer',
      ...(cidField(this.host.connectionId())),
      namespaceId: this.namespaceId,
      semanticFingerprint,
      updatedAt,
    });
  }

  /** 第 24 型：re-arm fatal 置位（code = ADR 0018 §3 稳定双码；稳定 issue 摘要留在
   *  Runtime `getStatus()` fatal 摘要，不入事件——§23.3 禁止 SCHEMA 内容/原始 cause）。 */
  private emitSchemaRearmFailed(code: ReplicationObserverSchemaRearmCode): void {
    if (!this.observerOn) return;
    this.host.emitObserver({
      type: 'schema-rearm-failed',
      side: 'peer',
      ...(cidField(this.host.connectionId())),
      namespaceId: this.namespaceId,
      code: stableSchemaRearmCode(code),
    });
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

  /** §D7（issue #171）：入站帧静默域扩展 `disconnected`——GOAWAY drain 窗口（连接存活）
   *  投影 disconnected 后，迟发数据/同步帧按静默忽略而非 NAMESPACE_STATE_VIOLATION 终局化。 */
  private isInboundQuiet(): boolean {
    return this.isQuietState() || this.state === 'disconnected';
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

  private quiesceSync(): void {
    const unsubscribe = this.unsubscribe;
    if (unsubscribe !== undefined) {
      unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  private async runDisposal(claim: CleanupClaim): Promise<void> {
    const { session, lease, unsubscribe } = claim;
    if (unsubscribe !== undefined) {
      try { unsubscribe(); } catch { /* seam 防御（R1 #7）：退订回调不得使任务体 throw */ }
    }
    if (session !== undefined) await session.close().catch(() => undefined);
    if (lease !== undefined) await lease.release().catch(() => undefined);
    if (this.session === session) {
      // ★ 身份守卫（R1/SA2 #3：替代 epoch 守卫）：自捕获以来未建立新 session
      // （this.session === claim.session）⇒ aux 簿记（watchdog/round/channel）仍归本代，
      // **与连接代际无关**——同时正确覆盖：
      //  - P3（新代已建成 session2 → 不等 → 跳过：新代资源/aux 零触碰）；
      //  - 泄漏面（epoch 已推进但新代永不 open——intent='removed' ∨ 终态：
      //    openActiveTargets 跳过、§D5.2 重置永不发生 ⇒ this.session 保持捕获值
      //    → 照常清字段 + aux teardown，watchdog idle timer（自重武装）/channel 队列/
      //    round 簿记不泄漏——AC2 明文兑付）。
      // session 对象一经释放不复用（Registry 语义），「先不等后复等」不可达，判据健全。
      if (this.lease === lease) this.lease = undefined;
      this.session = undefined;
      if (this.unsubscribe === unsubscribe && unsubscribe !== undefined) this.unsubscribe = undefined;
      this.watchdog.teardown();
      this.round.teardown();
      this.channel.teardown();
    }
  }

  /** 捕获当前代资源所有权（在 caller 同步栈内求值——绝不放进任务 lambda）。 */
  private claimForDisposal(): CleanupClaim {
    return { session: this.session, lease: this.lease, unsubscribe: this.unsubscribe };
  }

  /** 单一生命周期队列原语（Scope 7）：peer 全部生命周期续体经此串行化。
   *  R1（SA2 #7）吞错纪律：任务体结构性零 throw（runDisposal 各步骤局部吞错）；
   *  返回值 run 按原语义 reject 传播给显式 await 的调用方（ensureCloseMemo body）；
   *  fire-and-forget 调用点一律显式 .catch(() => undefined)（§16 caller 表注记）。 */
  private enqueueLifecycle(task: () => Promise<void>): Promise<void> {
    const run = this.cleanupTail.then(task);
    this.cleanupTail = run.then(() => undefined, () => undefined);
    return run;
  }

  /** 等待此前已排队的生命周期清理全部结算；连接层仅用于重拨 barrier。 */
  waitForCleanup(): Promise<void> {
    return this.cleanupTail;
  }

  /** 清理入口（各失联/终局/停止事件调用）。
   *  R1（SA2 #1）：claim 于**排队前**在 caller 同步栈求值——原稿把 claimForDisposal()
   *  写进任务 lambda，等于任务**执行期**才捕获：T1 挂起（drain 屏障）期间 fatal 补排
   *  T2、blocked→re-add 重建 gen2 后 T2 才开始执行 → 捕获到 gen2 字段且 epoch 恒等 →
   *  杀新代（SA2 #1 攻击路径）。排队前求值后 T2 的 claim 恒为 fatal 时刻的本代资源，
   *  执行滞后到任何代际都只处置捕获对象。 */
  private cleanupResources(): Promise<void> {
    const claim = this.claimForDisposal(); // ← 求值点 = 排队前（事件同步段）
    return this.enqueueLifecycle(() => this.runDisposal(claim));
  }

  setState(state: PeerNamespaceState): void {
    if (this.state === state) return;
    const from = this.state;
    this.state = state;
    // PN1：channel FSM 唯一迁移点（同态早退——边沿 exactly-once；初始 'targeted' 无迁移不发射）
    if (this.observerOn) {
      this.host.emitObserver({
        type: 'channel-state-changed',
        side: 'peer',
        ...(cidField(this.host.connectionId())),
        namespaceId: this.namespaceId,
        from,
        to: state,
      });
    }
  }

  // ─────────────────────────────── 观测发射辅助（§3/§4 safe-field） ───────────────────────────────

  /** PN2：namespace-error{direction:'sent'}（稳定码折叠；每次 wire 错误恰一事件）。 */
  private emitNsErrorSent(code: string): void {
    if (!this.observerOn) return;
    this.host.emitObserver({
      type: 'namespace-error',
      side: 'peer',
      ...(cidField(this.host.connectionId())),
      namespaceId: this.namespaceId,
      code: stableNamespaceCode(code),
      direction: 'sent',
    });
  }

  /** PN5/PN6/PN6b：resync-required（cause 闭联合）。issue #231：send-failed 附子因
   *  与安全数值上下文（append-only；其余 cause 零新字段——事件形状逐字节不变）。 */
  private emitResyncRequired(
    cause:
      | 'queue-overflow'
      | 'send-failed'
      | 'connection-shed'
      | 'ack-timeout'
      | 'session-fanout-overflow'
      | 'remote-declared',
    failureDetail?: () => UpdateSendFailureDetail,
  ): void {
    if (!this.observerOn) return;
    // 惰性求值：仅 observer 在场时构造明细（无 observer 零分配/零投影读取）。
    const detail = failureDetail?.();
    this.host.emitObserver({
      type: 'resync-required',
      side: 'peer',
      ...(cidField(this.host.connectionId())),
      namespaceId: this.namespaceId,
      cause,
      ...(detail !== undefined
        ? {
            reason: detail.reason,
            ...sendFailureContext(
              detail,
              this.state,
              this.host.connectionState(),
              this.host.bufferedAmount(),
            ),
          }
        : {}),
    });
  }

  /** issue #231：update-dropped——队列非空时超限项 F4 静默丢弃（不伴随 resync 声明，
   *  R2-1/D4 活性保持）的唯一观测信号。计数不变量见 types.ts 事件注释：每笔超限丢弃
   *  恰一事件（队列已空走 resync-required{update-too-large}，非空走本事件）。 */
  private noteUpdateDropped(failureDetail: () => UpdateSendFailureDetail): void {
    if (!this.observerOn) return;
    const detail = failureDetail();
    this.host.emitObserver({
      type: 'update-dropped',
      side: 'peer',
      ...(cidField(this.host.connectionId())),
      namespaceId: this.namespaceId,
      reason: 'update-too-large',
      ...sendFailureContext(
        detail,
        this.state,
        this.host.connectionState(),
        this.host.bufferedAmount(),
      ),
    });
  }

  /** PN8/PN9：identity-conflicted（via 闭联合）。 */
  private emitIdentityConflicted(
    via: 'open-mismatch' | 'fence' | 'identity-changed-frame',
  ): void {
    if (!this.observerOn) return;
    this.host.emitObserver({
      type: 'identity-conflicted',
      side: 'peer',
      ...(cidField(this.host.connectionId())),
      namespaceId: this.namespaceId,
      via,
    });
  }

  private armTimer(kind: TimerKind): void {
    this.clearTimer(kind);
    const delay = this.host.timeouts[TIMER_DELAY_FIELD[kind]];
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
    (['open', 'bootstrap', 'reconcile', 'periodic-reconcile', 'close'] as const).forEach((kind) => this.clearTimer(kind));
  }

  private onTimerFired(kind: TimerKind): void {
    if (this.isTerminal()) return;
    if (kind === 'periodic-reconcile') {
      this.startPeriodicReconcile();
      return;
    }
    if (kind === 'close') {
      // §13.1：closeTimeout 不再等待 → 本地收口 closed
      if (this.state === 'closing') {
        this.setState('closed');
        this.settleCloseMemo();
        void this.cleanupResources().catch(() => undefined);
      }
      return;
    }
    // §5.1：timeout 只收口 namespace（零 wire 帧）
    // issue #256：timer 族超时附稳定原因 + 配置上限（resolved 配置字段读，非 live 状态
    // 读取/时钟调用）——open/bootstrap/reconcile 三类在单侧日志即可区分。
    this.finalize('failed', TIMER_TIMEOUT_CAUSE[kind], this.host.timeouts[TIMER_DELAY_FIELD[kind]]);
    // issue #254：open/bootstrap/reconcile 超时 = §13.2 `NAMESPACE_TIMEOUT`
    // （retryable=reconnect）——failed 的既定恢复路径是连接重建（§16「等待连接重建」），
    // 而超时本身不拆连接；target 仍活跃（未 remove）而连接仍存活时，重建触发者只能
    // 是本端。分派经宿主面到连接层（其 ready/stopping/transport 门吸收并发与竞态）。
    if (this.intent === 'active') {
      this.host.requestConnectionRecovery(this.namespaceId);
    }
  }
}

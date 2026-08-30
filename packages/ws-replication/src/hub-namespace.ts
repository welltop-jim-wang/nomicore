/**
 * hub-namespace —— hub 侧 per-(connection, namespace) 通道（§7/§8/§9/§11/§12）。
 * OPEN 矩阵（授权 → Registry open → 身份比较 → session）、单帧 bootstrap、round、
 * UPDATE/fanout 订阅、CLOSE 收口、fence one-shot 终结器。
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
import { cidField, stableNamespaceCode } from './observer.js';
import {
  mapEncodeThrow,
  mapRejection,
  mapSessionRefusal,
  terminalStateOf,
  toFinalState,
  type MappingOutcome,
} from './error-mapping.js';
import type { NamespaceAuthorization } from './types.js';
import { RoundAborted, RoundEngine } from './round-engine.js';
import { UpdateChannel } from './update-channel.js';
import type { DataSenderFacet } from './backpressure.js';
import type {
  HubNamespaceState,
  ReplicationObserverEvent,
  ReplicationTimer,
  ResolvedLimits,
  ResolvedTimeouts,
} from './types.js';

/** hub 侧 channel 状态（= 公共投影 HubNamespaceState；包内实现用名）。 */
export type HubChannelState = HubNamespaceState;

/** 通道宿主（由 HubConnectionImpl 实现）。 */
export interface HubChannelHost {
  readonly limits: ResolvedLimits;
  readonly timeouts: ResolvedTimeouts;
  readonly timer: ReplicationTimer;
  readonly registry: NamespaceRegistry;
  readonly instanceId: string;
  peerInstanceId(): string;
  readonly authorize: (
    instanceIdentity: string,
    namespaceId: string,
  ) => Promise<NamespaceAuthorization>;
  sendControl(message: ReplicationMessage): number;
  /** data 帧（UPDATE）发送路径（§6.3，issue #137）：连接级水位闸门 + data 出队。 */
  sendData(namespaceId: string, bytes: Uint8Array): number;
  /** 连接级 data 水位闸门（§4.2，issue #137）。 */
  dataGateOpen(): boolean;
  /** data 入队通知（§4.4 连接总压/wheel 登记，issue #137）。 */
  onDataQueued(namespaceId: string): void;
  /** 请求连接级 drain（§4.5，issue #137）。 */
  requestDataDrain(): void;
  connectionFatal(code: string, wsCloseCode?: number): void;
  /** channel 进入终态（closed/conflicted/failed）的一次性通知——连接 drain 窗口
   *  提前完成观测（issue #174 §4.3）；非 drain 期调用方 no-op。 */
  onChannelSettled(namespaceId: string): void;
  /** observer 是否在场（热路径纪律：无 observer 零事件构造/零投影读取/零时钟调用）。 */
  observerPresent(): boolean;
  /** observer 事件分发（隔离语义在 dispatchReplicationObserver 单点）。 */
  emitObserver(event: ReplicationObserverEvent): void;
  /** 连接级受控 observability id（握手完成前 undefined）。 */
  connectionId(): string | undefined;
  /** 单调时源（仅作差；clock 缺省/无 observer 时 undefined）。 */
  now?(): number | undefined;
}

type TimerKind = 'bootstrap' | 'close';

export class HubNamespaceChannel {
  state: HubChannelState = 'opening';

  private lease: NamespaceLease | undefined;
  private session: ReplicationSession | undefined;
  private unsubscribe: (() => void) | undefined;
  private submitPermission = true;
  private openMode: 0 | 1 | undefined;
  private hubIdentity:
    | Readonly<{ replicationId: string; replicationEpoch: number }>
    | undefined;
  private openWaiters: Array<() => void> = [];
  private openInFlight = false;
  private pendingApplies = new Set<Promise<unknown>>();
  private pendingResync = false;
  private resyncDeclared = false;
  private identityChangedSent = false;
  private bootstrapSnapshotSeq: number | undefined;
  private timers: Record<TimerKind, unknown | undefined> = {
    bootstrap: undefined,
    close: undefined,
  };
  private closeQueue: Promise<void> = Promise.resolve();
  /** issue #174 §4.3 记忆位：终态一次性通知（每 channel 至多一次；重复通知幂等）。 */
  private settledNotified = false;

  readonly round: RoundEngine;
  readonly channel: UpdateChannel;
  readonly watchdog: FenceWatchdog;
  private readonly onOwnedBound: (bytes: Uint8Array) => void;
  /** 构造期捕获的 observer 在场标记（options 注入后不可变——热路径判空零调用）。 */
  private readonly observerOn: boolean;

  /** 连接级 data 调度面（§6.1/§6.3）：pull 以 state==='live' 为门槛；shed 按通道
   *  live 性分派（live → declareHubResync 声明并等待；非 live → pendingResync）。 */
  readonly sendFacet: DataSenderFacet = {
    queuedBytes: () => this.channel.queuedBytes,
    queuedCount: () => this.channel.queuedCount,
    pullAndSendOne: () => (this.state === 'live' ? this.channel.pullAndSendOne() : false),
    discardForConnectionPressure: () => {
      this.channel.discardForConnectionPressure();
      if (this.state === 'live') {
        this.declareHubResync('connection-shed');
      } else {
        this.pendingResync = true;
      }
    },
  };

  constructor(
    private readonly host: HubChannelHost,
    readonly namespaceId: string,
  ) {
    this.observerOn = host.observerPresent();
    this.onOwnedBound = (bytes: Uint8Array): void => this.onOwnedUpdate(bytes);
    this.round = new RoundEngine({
      role: 'hub',
      send: (message) => {
        const seq = this.sendChecked(message);
        // HB10：出向 Step2 diff 字节（seq>0 时发射——0 = 帧被否决，未出站）
        if (seq > 0 && message.kind === 'SYNC_STEP2' && this.observerOn) {
          this.host.emitObserver({
            type: 'sync-step2-sent',
            side: 'hub',
            ...(cidField(this.host.connectionId())),
            namespaceId: this.namespaceId,
            bytes: message.update.byteLength,
          });
        }
        return seq;
      },
      encode: (kind, remoteSV) => {
        try {
          const session = this.session;
          if (session === undefined) throw new RoundAborted();
          const out = kind === 'stateVector'
            ? session.encodeStateVector()
            : session.encodeDiff(remoteSV ?? new Uint8Array(0));
          return out;
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
    this.round.bind(namespaceId);
    this.channel = new UpdateChannel({
      limits: host.limits,
      ackTimeoutMs: host.timeouts.ackTimeoutMs,
      sendUpdateFrame: (bytes) => this.sendUpdateFrame(bytes),
      declareLocalResync: (cause) => this.onLocalResyncEdge(cause),
      notePendingResync: () => {
        this.pendingResync = true;
      },
      onAckTimeout: () => this.onAckTimeoutFired(),
      onUpdateAcked: (info) => this.onUpdateAcked(info),
      now: () => this.host.now?.(),
      armTimer: (cb, ms) => host.timer.setTimeout(cb, ms),
      clearTimer: (h) => host.timer.clearTimeout(h),
      dataGateOpen: () => this.host.dataGateOpen(),
      onDataQueued: () => this.host.onDataQueued(this.namespaceId),
      requestDataDrain: () => this.host.requestDataDrain(),
    });
    this.watchdog = new FenceWatchdog({
      role: 'hub',
      session: () => this.session,
      onPredicateEdge: (predicate: WatchdogPredicate) => this.onWatchdogEdge(predicate),
      armTimer: (cb, ms) => host.timer.setTimeout(cb, ms),
      clearTimer: (h) => host.timer.clearTimeout(h),
      idleProbeMs: host.timeouts.ackTimeoutMs,
    });
  }

  get peerName(): string {
    return this.host.peerInstanceId();
  }

  // ─────────────────────────────── OPEN（§7） ───────────────────────────────

  onOpen(message: {
    hasLocalReplica: boolean;
    replicationId?: string;
    replicationEpoch?: number;
  }): void {
    switch (this.state) {
      case 'closed':
      case 'conflicted':
      case 'failed':
        // I-5：终态不得重开（§7.0b）
        this.sendChecked(namespaceErrorFrame('NAMESPACE_REOPEN_REQUIRES_RECONNECT', this.namespaceId));
        return;
      case 'closing':
        // 合流到收口链：close 完成后以重启错误答复（I-5）
        this.openWaiters.push(() => {
          this.sendChecked(
            namespaceErrorFrame('NAMESPACE_REOPEN_REQUIRES_RECONNECT', this.namespaceId),
          );
        });
        return;
      case 'opening':
        // 合流：把「再答一次 OPEN_OK/ERROR」挂到在途 open 的 Promise 链（AC1 冻结锚：
        // 不重复 authorize、不重复 Registry open）
        this.openWaiters.push(() => undefined);
        return;
      case 'bootstrapping':
      case 'reconciling':
      case 'live':
      case 'needs-resync': {
        // 已建立：立即再答 OPEN_OK（同一身份/mode）
        if (this.openMode !== undefined && this.hubIdentity !== undefined) {
          this.sendChecked(
            this.openOkFrame(this.openMode, this.hubIdentity),
          );
        }
        return;
      }
      default: {
        const never: never = this.state;
        void never;
        return;
      }
    }
  }

  /** 首次 OPEN 的异步流程（连接层在通道创建时调用一次）。 */
  startOpen(message: {
    hasLocalReplica: boolean;
    replicationId?: string;
    replicationEpoch?: number;
  }): void {
    if (this.openInFlight) return;
    this.openInFlight = true;
    this.openWaiters.push(() => undefined);
    void (async () => {
      let authz: NamespaceAuthorization;
      try {
        authz = await this.host.authorize(this.host.peerInstanceId(), this.namespaceId);
      } catch {
        if (this.isOpenAborted()) { this.finishOpenSilently(); return; } // ★ 已静默：不向死连接发 INTERNAL_ERROR
        this.finishOpenError('INTERNAL_ERROR');
        return;
      }
      // D-H1（issue #171 §11.2）：authorize 恢复点**不拦截** registry.open——中止判别
      // 保护资源账目（acquire→release 配对），不保护调用点；authorize 成功后续体进入
      // 取得阶段完整执行，中止判别自 registry.open 恢复点起逐点生效。
      if (!authz.ok || !authz.permissions.read) {
        if (this.isOpenAborted()) { this.finishOpenSilently(); return; } // ★ 同上（未授权不泄露存在性亦适用死连接）
        this.finishOpenError('NAMESPACE_UNAUTHORIZED');
        return;
      }
      let opened: Awaited<ReturnType<NamespaceRegistry['open']>>;
      try {
        opened = await this.host.registry.open(authz.localOwner, this.namespaceId);
      } catch {
        if (this.isOpenAborted()) { this.finishOpenSilently(); return; }
        this.finishOpenError('INTERNAL_ERROR');
        return;
      }
      if (this.isOpenAborted()) {
        // ★ H1 主修复点：registry.open 已交付、尚未赋字 → 显式回收局部 lease（零泄漏）
        this.finishOpenSilently(opened.ok ? opened.lease : undefined);
        return;
      }
      if (!opened.ok) {
        if (this.isOpenAborted()) { this.finishOpenSilently(); return; } // R1 #5：中止 + 拒绝（无资源可回收）
        this.finishOpenError(opened.code === 'NAMESPACE_NOT_FOUND' ? 'NAMESPACE_NOT_FOUND' : 'INTERNAL_ERROR');
        return;
      }
      this.lease = opened.lease;
      let replication:
        | Readonly<{ state: 'disabled' }>
        | Readonly<{ state: 'enabled'; replicationId: string; replicationEpoch: number }>;
      try {
        const status = this.lease.getStatus();
        if (status.runtime === null) throw new Error('lease released during hub open');
        replication = status.runtime.replication;
      } catch {
        if (this.isOpenAborted()) { this.finishOpenSilently(); return; } // R1 #5：lease 已赋字 → 字段回收
        this.finishOpenError('INTERNAL_ERROR');
        return;
      }
      if (this.isOpenAborted()) { this.finishOpenSilently(); return; } // 已赋字：closeSessionAndRelease 兜底回收 this.lease
      if (replication.state !== 'enabled') {
        if (this.isOpenAborted()) { this.finishOpenSilently(); return; } // R1 #5
        this.finishOpenError('REPLICATION_NOT_ENABLED');
        return;
      }
      const hubIdentity = {
        replicationId: replication.replicationId,
        replicationEpoch: replication.replicationEpoch,
      };
      let mode: 0 | 1;
      if (!message.hasLocalReplica) {
        mode = 0;
      } else if (
        message.replicationId === undefined ||
        message.replicationEpoch === undefined ||
        message.replicationId !== hubIdentity.replicationId
      ) {
        if (this.isOpenAborted()) { this.finishOpenSilently(); return; } // R1 #5
        this.emitIdentityConflicted('open-mismatch'); // HB6
        this.finishOpenError('REPLICATION_ID_MISMATCH');
        return;
      } else if (message.replicationEpoch !== hubIdentity.replicationEpoch) {
        if (this.isOpenAborted()) { this.finishOpenSilently(); return; } // R1 #5
        this.emitIdentityConflicted('open-mismatch'); // HB6
        this.finishOpenError('REPLICATION_EPOCH_MISMATCH');
        return;
      } else {
        mode = 1;
      }
      let sessionResult: Awaited<ReturnType<NamespaceLease['openReplicationSession']>>;
      try {
        sessionResult = await this.lease.openReplicationSession({
          localRole: 'hub',
          remoteInstanceId: this.host.peerInstanceId(),
        });
      } catch {
        if (this.isOpenAborted()) { this.finishOpenSilently(); return; }
        this.finishOpenError('INTERNAL_ERROR');
        return;
      }
      if (this.isOpenAborted()) {
        // ★ E2 第二窗口：session 已交付、尚未赋字 → 先关 session 再回收 lease（ADR-0010 L90 次序）
        this.finishOpenSilently(undefined, sessionResult.ok ? sessionResult.session : undefined);
        return;
      }
      if (!sessionResult.ok) {
        if (this.isOpenAborted()) { this.finishOpenSilently(); return; } // R1 #5
        this.finishOpenError(
          sessionResult.code === 'REPLICATION_NOT_ENABLED' ? 'REPLICATION_NOT_ENABLED' : 'INTERNAL_ERROR',
        );
        return;
      }
      this.session = sessionResult.session;
      this.openMode = mode;
      this.hubIdentity = hubIdentity;
      this.submitPermission = authz.permissions.submit;
      this.unsubscribe = this.session.subscribeOwnedUpdates(this.onOwnedBound);
      this.watchdog.onEvent();
      this.watchdog.startIdle();
      this.flushOpenWaitersOk();
      if (mode === 0) {
        this.startBootstrap(hubIdentity);
      } else {
        this.setState('reconciling'); // 等待 peer Step1
      }
    })();
  }

  private openOkFrame(
    mode: 0 | 1,
    identity: Readonly<{ replicationId: string; replicationEpoch: number }>,
  ): ReplicationMessage {
    return {
      kind: 'OPEN_OK',
      namespaceId: this.namespaceId,
      mode,
      replicationId: identity.replicationId,
      replicationEpoch: identity.replicationEpoch,
    };
  }

  private flushOpenWaitersOk(): void {
    const waiters = this.openWaiters;
    this.openWaiters = [];
    if (this.openMode === undefined || this.hubIdentity === undefined) return;
    for (const _waiter of waiters) {
      this.sendChecked(this.openOkFrame(this.openMode, this.hubIdentity));
    }
  }

  private finishOpenError(code: string): void {
    const waiters = this.openWaiters;
    this.openWaiters = [];
    for (const _waiter of waiters) {
      this.sendChecked(namespaceErrorFrame(code, this.namespaceId));
    }
    this.emitNsErrorSent(code); // HB2：每次 wire 错误/终局恰一事件（不按 waiter 数）
    const targetState = toFinalState(terminalStateOf(code));
    if (this.state === 'opening' || !this.isTerminal()) {
      this.setState(targetState);
    }
    void this.closeSessionAndRelease();
    // §4.3 通知入口 3（R2-M5：函数尾部无条件调用；守卫跳过分支同样走到这里——
    // 已终态情形由记忆位吸收）
    this.notifySettled();
  }

  private finishOpenSilently(pendingLease?: NamespaceLease, pendingSession?: ReplicationSession): void {
    // §13.4：终局/连接已静默 → 零 wire、零状态机迁移；对续体局部已取得、尚未赋字的
    // 资源**显式回收**（§D8.4，issue #171 H1/E2——旧实现只回收字段，`opened.lease`
    // 局部值永不 release → 泄漏）。
    this.openWaiters = [];
    if (pendingSession !== undefined) {
      void pendingSession.close().catch(() => undefined); // 先关 session（ADR-0010 L90）
    }
    if (pendingLease !== undefined && pendingLease !== this.lease) {
      void pendingLease.release().catch(() => undefined); // 再释放未赋字 lease（幂等 same-promise）
    }
    void this.closeSessionAndRelease(); // 已赋字段的 lease/session（幂等；hub 侧字段读取安全——通道不跨连接）
  }

  /** §D8.1（issue #171）：open 续体中止判别——终态 ∨ 通道已静默（closing）。
   *  不变量：进入 closing 的唯一出口是终态（收口链 setState('closed') / finishOpenError
   *  在静默域内一律走 silent 分支）——hub 通道不跨连接存活，无需连接计数器；
   *  通道静默态即完备的代际信号。 */
  private isOpenAborted(): boolean {
    return this.isTerminal() || this.state === 'closing';
  }

  // ─────────────────────────────── Bootstrap（§8 hub 侧） ───────────────────────────────

  private startBootstrap(
    _hubIdentity: Readonly<{ replicationId: string; replicationEpoch: number }>,
  ): void {
    try {
      this.setState('bootstrapping');
      let snapshot: Uint8Array;
      try {
        const session = this.session;
        if (session === undefined) {
          this.finalize('failed');
          return;
        }
        // 空 state vector（y-protocols 规范编码 [0]）= 全量快照（§8.1 单帧基线）
        snapshot = session.encodeDiff(new Uint8Array([0]));
      } catch {
        this.applyOutcome(mapEncodeThrow(this.session));
        return;
      }
      if (snapshot.byteLength > this.host.limits.maxBootstrapBytes) {
        // §8 step 2：不分块、不 fallback、零 snapshot 帧（OPEN_OK 已答复——本 ERROR
        // 是 bootstrap 路径的收口信号，直接送达当前连接）
        this.sendNsError('BOOTSTRAP_TOO_LARGE');
        this.finalize('failed');
        return;
      }
      // §8 step 3（R3/#8）：与 encodeDiff 同一同步段之后从自有 lease status **重读**
      let identity2:
        | Readonly<{ state: 'disabled' }>
        | Readonly<{ state: 'enabled'; replicationId: string; replicationEpoch: number }>;
      try {
        const status = this.lease?.getStatus();
        if (status === undefined || status.runtime === null) throw new Error('lease released');
        identity2 = status.runtime.replication;
      } catch {
        this.finishOpenError('INTERNAL_ERROR');
        return;
      }
      if (identity2.state !== 'enabled') {
        this.finishOpenError('INTERNAL_ERROR');
        return;
      }
      const seq = this.sendChecked({
        kind: 'BOOTSTRAP_SNAPSHOT',
        namespaceId: this.namespaceId,
        replicationId: identity2.replicationId,
        replicationEpoch: identity2.replicationEpoch,
        snapshot,
      });
      this.bootstrapSnapshotSeq = seq > 0 ? seq : undefined;
      // HB3：快照字节（seq>0 时发射——0 = 帧被否决，未出站）
      if (seq > 0 && this.observerOn) {
        this.host.emitObserver({
          type: 'bootstrap-snapshot-sent',
          side: 'hub',
          ...(cidField(this.host.connectionId())),
          namespaceId: this.namespaceId,
          bytes: snapshot.byteLength,
        });
      }
      // 帧内身份=重读值（最小化「帧身份 ≠ 快照内容」窗口；§8 step 3 R3/#8）
      void _hubIdentity;
      this.armTimer('bootstrap');
    } catch {
      this.finalize('failed');
    }
  }

  onBootstrapAck(message: { ackedSequence: number }): void {
    if (this.state !== 'bootstrapping') {
      if (!this.isTerminal()) {
        this.sendNsError('NAMESPACE_STATE_VIOLATION');
        this.finalize('failed');
      }
      return;
    }
    if (
      this.bootstrapSnapshotSeq === undefined ||
      message.ackedSequence !== this.bootstrapSnapshotSeq
    ) {
      this.host.connectionFatal('ACK_STATE_VIOLATION', 1002);
      return;
    }
    this.clearTimer('bootstrap');
    this.bootstrapSnapshotSeq = undefined;
    this.setState('reconciling'); // 等待 peer Step1
  }

  // ─────────────────────────────── sync / update / close 帧 ───────────────────────────────

  onSyncStep1(message: { syncRoundId: number; stateVector: Uint8Array; sequence: number }): void {
    if (this.isQuietState()) return;
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

  /** 字段级超限（UPDATE_TOO_LARGE 等；在 decode 成功后由连接层判定移交）。 */
  onFieldViolation(code: string): void {
    if (this.isQuietState()) return;
    this.sendNsError(code);
    this.finalize('failed');
  }

  onUpdate(message: { update: Uint8Array; sequence: number }): void {
    if (this.isQuietState()) return; // §11.1 第 1 步：closing/终态静默忽略
    const accepted =
      this.state === 'live' ||
      this.state === 'needs-resync' ||
      (this.state === 'reconciling' && this.round.wasLive);
    if (!accepted) {
      // 无生命周期/opening/bootstrapping/首轮 reconciling → 真违例（§11.1/§7.2）
      this.sendNsError('NAMESPACE_STATE_VIOLATION');
      this.finalize('failed');
      return;
    }
    if (message.update.byteLength > this.host.limits.maxUpdateBytes) {
      this.sendNsError('UPDATE_TOO_LARGE');
      this.finalize('failed');
      return;
    }
    if (!this.submitPermission) {
      // §11.1 第 2 步：submit 门（UPDATE 专属；Step2 不设门）
      this.sendNsError('NAMESPACE_UNAUTHORIZED');
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
  }

  onCloseRequest(message: { sequence: number }): void {
    if (this.isTerminal() || this.state === 'closing') return;
    // 帧分发同步段即停接纳，消除异步 closeQueue 前继续接收 UPDATE/Step 的竞态窗口。
    this.setState('closing');
    this.clearAllTimers(); // §D8.5（issue #171）：peer 发起 CLOSE 时 open/bootstrap timer 残留同理清理
    this.closeQueue = this.closeQueue.then(async () => {
      if (this.isTerminal()) return;
      // §13.2：停接纳 → 等已接纳 apply → session close → lease release → CLOSE_OK
      await this.drainPendingApplies();
      await this.closeSessionAndRelease();
      if (!this.isTerminal()) {
        this.sendChecked({
          kind: 'CLOSE_OK',
          namespaceId: this.namespaceId,
          ackedSequence: message.sequence,
        });
        this.setState('closed');
        const waiters = this.openWaiters;
        this.openWaiters = [];
        for (const waiter of waiters) waiter();
      }
      // §4.3 通知入口 2（R2-M5：函数尾部无条件调用——CLOSE_OK 后 setState('closed')
      //  才通知，时序正确：自然收口在 CLOSE_OK 已上 wire 后计入 drain 完成）
      this.notifySettled();
    });
  }

  onResyncReceived(): void {
    if (this.isQuietState()) return;
    this.channel.markResyncReceived();
    this.setState('needs-resync');
    this.emitResyncRequired('remote-declared'); // HB8：收 RESYNC_REQUIRED（对端声明本端化）
  }

  onErrorFrame(message: { code: string }): void {
    if (this.isTerminal()) return;
    if (this.state === 'closing') return; // §13.4 迟到纪律
    const terminal = toFinalState(terminalStateOf(message.code));
    if (this.observerOn) {
      this.host.emitObserver({
        type: 'namespace-error',
        side: 'hub',
        ...(cidField(this.host.connectionId())),
        namespaceId: this.namespaceId,
        code: stableNamespaceCode(message.code),
        direction: 'received',
        terminalState: terminal,
      });
    }
    this.finalize(terminal);
  }

  /** 连接关闭同步静默：先停接纳并摘订阅，再异步 drain/释放。 */
  quiesceConnection(): void {
    if (!this.isTerminal() && this.state !== 'closing') this.setState('closing');
    this.clearAllTimers(); // §D8.5（issue #171）：连接静默同步段清 bootstrap 残留 timer（防静默期 fire → finalize('failed') 污染收口链的 setState('closed') 与 CLOSE_OK）
    const unsubscribe = this.unsubscribe;
    if (unsubscribe !== undefined) {
      unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  /** §19 L158 授权撤销：terminating namespace ERROR + failed 终局 + 资源收口。
   *  quiet/终态（closing/closed/conflicted/failed）→ 零副作用 no-op（重复 revoke 幂等）。 */
  terminateUnauthorized(): Promise<void> {
    if (this.isQuietState()) return Promise.resolve();
    this.sendNsError('NAMESPACE_UNAUTHORIZED'); // 既有（:770-772）→ namespaceErrorFrame（带 namespaceId）
    this.finalize('failed'); // 既有（:791-796）：清 timer/终态/收口
    return this.terminationSettled(); // §5.3
  }

  /** 连接关闭（socket 断开 / Hub 停机）：全量 cleanup。 */
  onConnectionClosed(): Promise<void> {
    this.quiesceConnection();
    return this.closeQueue.then(async () => {
      await this.drainPendingApplies();
      await this.settleClose();
      if (!this.isTerminal()) this.setState('closed');
    });
  }

  // ─────────────────────────────── fanout / watchdog ───────────────────────────────

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
        return; // closing/终态：忽略交付
    }
  }

  private onWatchdogEdge(predicate: WatchdogPredicate): void {
    if (predicate === 'fence') {
      this.oneShotTerminal();
      return;
    }
    // session 层溢出边沿（hub 侧，多 peer fan-out 方向）：§12 R4.2 定案——“hub 命中 =
    // 声明 RESYNC_REQUIRED + 等待”（hub 的声明是 peer 发起恢复 round 的唯一通路，§9.4）
    this.channel.markSessionResyncEdge();
    this.declareHubResync('session-fanout-overflow');
  }

  /** §12.2 one-shot 终结器（帧处理钩子与 watchdog 探测合流点；记忆化保证恰一帧）。 */
  private oneShotTerminal(): void {
    if (this.identityChangedSent) return;
    this.identityChangedSent = true;
    let identity:
      | Readonly<{ state: 'disabled' }>
      | Readonly<{ state: 'enabled'; replicationId: string; replicationEpoch: number }>
      | undefined;
    try {
      const status = this.lease?.getStatus();
      if (status !== undefined && status.runtime !== null) {
        identity = status.runtime.replication;
      }
    } catch {
      identity = undefined;
    }
    if (identity !== undefined && identity.state === 'enabled') {
      this.sendChecked({
        kind: 'IDENTITY_CHANGED',
        namespaceId: this.namespaceId,
        replicationId: identity.replicationId,
        replicationEpoch: identity.replicationEpoch,
      });
      this.emitIdentityConflicted('fence'); // HB5：epoch fence
      this.finalize('conflicted');
      return;
    }
    // §12.2 防御分支（理论不可达——bump 槽 E5.5 已同步整替）：disabled/异读 →
    // INTERNAL_ERROR 收口（F7 对齐；不产生 IDENTITY_CHANGED 假码）
    this.sendNsError('INTERNAL_ERROR');
    this.finalize('failed');
  }

  private onLocalResyncEdge(cause: 'queue-overflow' | 'send-failed'): void {
    // hub 侧 update-channel 本地排队溢出（§10.2 判据）：§10.2/§18.4「hub 溢出同机制声明」
    // + §12 R4.2 定案——声明 RESYNC_REQUIRED + 等待 peer 新 round
    this.declareHubResync(cause);
  }

  /** hub 溢出面统一声明（§10.2/§12 R4.2）：发 RESYNC_REQUIRED（一次/恢复周期，记忆化）
   *  → 置 needs-resync → 等待 peer 新 round（round 恒由 peer 发起，§10.5/§10.6）。 */
  private declareHubResync(
    cause:
      | 'queue-overflow'
      | 'send-failed'
      | 'connection-shed'
      | 'ack-timeout'
      | 'session-fanout-overflow',
  ): void {
    if (this.isQuietState()) return;
    if (this.resyncDeclared) return;
    this.resyncDeclared = true;
    this.sendChecked({
      kind: 'RESYNC_REQUIRED',
      namespaceId: this.namespaceId,
      reasonCode: 'send-queue-overflow',
    });
    if (!this.isQuietState()) this.setState('needs-resync');
    this.emitResyncRequired(cause); // HB7：仅 resyncDeclared false→true 翻转时发射
  }

  private onAckTimeoutFired(): void {
    this.declareHubResync('ack-timeout');
  }

  // ─────────────────────────────── apply（§11.1） ───────────────────────────────

  private sendUpdateFrame(bytes: Uint8Array): number {
    if (bytes.byteLength > this.host.limits.maxUpdateBytes) {
      return 0; // 由恢复 round 的 state-vector diff 修复（§10.1 镜像语义）
    }
    try {
      // §6.3 R2（SA2 #7）：see peer-namespace.sendUpdateFrame——异常统一收敛返回 0 → F4。
      const seq = this.host.sendData(this.namespaceId, bytes);
      // 出向 UPDATE 帧字节（seq>0 时发射——0 = 帧被否决，未出站；合并帧报合并后长度）
      if (seq > 0 && this.observerOn) {
        this.host.emitObserver({
          type: 'update-sent',
          side: 'hub',
          ...(cidField(this.host.connectionId())),
          namespaceId: this.namespaceId,
          bytes: bytes.byteLength,
        });
      }
      return seq;
    } catch {
      return 0;
    }
  }

  /** update-acked（hub 出向 UPDATE 被对端 ACK 收妥；数据来自 UpdateChannel 记账）。 */
  private onUpdateAcked(info: Readonly<{ bytes: number; latencyMs?: number }>): void {
    if (!this.observerOn) return;
    this.host.emitObserver({
      type: 'update-acked',
      side: 'hub',
      ...(cidField(this.host.connectionId())),
      namespaceId: this.namespaceId,
      bytes: info.bytes,
      ...(info.latencyMs !== undefined ? { ackLatencyMs: info.latencyMs } : {}),
    });
  }

  private async applyStep2(update: Uint8Array, step2Sequence: number): Promise<'ok' | 'aborted'> {
    const outcome = await this.applyRemoteUpdate(update, step2Sequence, true);
    if (outcome === 'ok') {
      // §9.1.4：apply 成功 → 发 SYNC_APPLIED（ackedSequence = 收到的 Step2 帧序）
      // §D5.4（issue #171，R1/SA2 #8 裁决 (a)）：hub 通道无 'disconnected' 态；
      // closing/终态 = 通道已静默，迟到 SYNC_APPLIED 属 Scope 1「迟到续体零 wire」
      // 家族——补 isQuietState 门（与 peer 侧既有 epoch 门同构：只拦发送，round
      // 结算语义不变——onRoundSettled 的 closing 守卫既有）。
      if (!this.isQuietState()) {
        this.sendChecked({
          kind: 'SYNC_APPLIED',
          namespaceId: this.namespaceId,
          syncRoundId: this.round.currentRound,
          ackedSequence: step2Sequence,
        });
      }
      return 'ok';
    }
    return 'aborted';
  }

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
    // §5.7：在调用 applyRemoteUpdate 前采样，完整覆盖同步接纳与 sequencer 排队；
    // host.now 已经 safeNow 折叠，观测时钟异常不会阻断协议路径。
    const t0 = this.observerOn ? this.host.now?.() : undefined;
    const pending = session.applyRemoteUpdate(update);
    this.pendingApplies.add(pending);
    try {
      const result = await pending;
      if (!result.ok) {
        this.applyOutcome(
          mapSessionRefusal(result.code, this.session, this.runtimeSnapshot(), 'hub'),
        );
        return 'failed';
      }
      if (this.observerOn) {
        // HB9'：每笔成功 apply 恰一事件（hub 无 degraded 判别——结构性不可 bypass）
        const t1 = this.host.now?.();
        const applyLatencyMs =
          t0 !== undefined && t1 !== undefined ? t1 - t0 : undefined;
        const base = {
          side: 'hub',
          ...cidField(this.host.connectionId()),
          namespaceId: this.namespaceId,
          bytes: update.byteLength,
          ...(applyLatencyMs !== undefined ? { applyLatencyMs } : {}),
        } as const;
        if (isStep2) {
          this.host.emitObserver({ type: 'sync-diff-applied', ...base });
        } else {
          this.host.emitObserver({ type: 'update-applied', ...base });
        }
      }
      if (isStep2) return 'ok'; // SYNC_APPLIED 由 applyStep2 发送（§9.1.4）
      if (this.isQuietState()) return 'ok'; // closing/终态：ACK 不再发出
      this.sendChecked({
        kind: 'UPDATE_ACK',
        namespaceId: this.namespaceId,
        ackedSequence: sequence,
      });
      return 'ok';
    } catch {
      this.applyOutcome(mapRejection(this.session, this.runtimeSnapshot(), 'hub'));
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
        this.oneShotTerminal();
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

  private onRoundSettled(): void {
    if (this.pendingResync) {
      this.pendingResync = false;
      // hub 侧「再开 round」恒由 peer 发起（§10.6 等待）；仅做状态与队列清理
    }
    if (this.state !== 'reconciling' && this.state !== 'needs-resync') return;
    this.round.markLive();
    this.setState('live');
    this.channel.resetForLive();
    this.resyncDeclared = false; // 恢复周期完成：恢复声明记忆化清零
    this.watchdog.onEvent();
  }

  // ─────────────────────────────── 收口 ───────────────────────────────

  private sendNsError(code: string): void {
    this.sendChecked(namespaceErrorFrame(code, this.namespaceId));
    this.emitNsErrorSent(code); // HB2：本端 ns ERROR（稳定码折叠）
  }

  private sendChecked(message: ReplicationMessage): number {
    try {
      return this.host.sendControl(message);
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (typeof code === 'string' && !this.isTerminal()) {
        try {
          this.host.sendControl(namespaceErrorFrame(code, this.namespaceId));
        } catch {
          // 防御：ERROR 帧本身编码失败（极小帧，理论不可达）
        }
        if (message.kind !== 'ERROR') this.emitNsErrorSent(code); // HB2：编码面失败族；ERROR 自发射路径防双计
        this.finalize('failed');
      }
      return 0;
    }
  }

  private finalize(state: 'failed' | 'conflicted' | 'closed'): void {
    if (this.isTerminal()) return; // 终态不降级
    this.clearAllTimers();
    this.setState(state);
    void this.settleClose();
    // §4.3 通知入口 1（R2-M5：函数尾部无条件调用——watchdog / violation /
    // terminateUnauthorized / error-mapping 全部经此；已终态早退情形先前入口已通知）
    this.notifySettled();
  }

  /** issue #174 §4.3：终态一次性通知（记忆位保证每 channel 至多一次；重复通知幂等）。 */
  private notifySettled(): void {
    if (this.settledNotified) return;
    this.settledNotified = true;
    this.host.onChannelSettled(this.namespaceId);
  }

  /**
   * §5.3 收口单点（R2 A5 链式追加）：执行幂等清理体并【链式追加】到 cleanupTail——
   * 所有发起方（finalize/terminateUnauthorized/onConnectionClosed）的清理都汇入同一链，
   * 无覆写丢尾（R1 单字段覆写形态在 revoke 与并发 onConnectionClosed 竞争时后写覆写前写，
   * 强度弱于「revoke resolve 即资源已收口」的声称）。存储前归一化（R2 N4）：清理体抛错
   * 时 tail 不 reject——void this.settleClose() 零 floating rejected promise。
   */
  private settleClose(): Promise<void> {
    const op = this.closeSessionAndRelease(); // 幂等：session/unsub/lease 二次调用见 undefined 即跳过
    this.cleanupTail = this.cleanupTail.then(
      () => op, () => op,
    ).then(() => undefined, () => undefined);
    return this.cleanupTail;
  }

  /** §5.3 revoke 结算：吞清理异常（session.close/lease.release 异常在收口链内部分类处理，
   *  不允许冒泡成 revoke rejection——红灯 #7/#8 断言 revoke resolve）。 */
  private terminationSettled(): Promise<void> {
    return this.cleanupTail.then(() => undefined, () => undefined);
  }

  private isTerminal(): boolean {
    return (
      this.state === 'closed' || this.state === 'conflicted' || this.state === 'failed'
    );
  }

  private isQuietState(): boolean {
    return (
      this.state === 'closing' ||
      this.state === 'closed' ||
      this.state === 'conflicted' ||
      this.state === 'failed'
    );
  }

  private async drainPendingApplies(): Promise<void> {
    await Promise.allSettled([...this.pendingApplies]);
  }

  private async closeSessionAndRelease(): Promise<void> {
    const session = this.session;
    const lease = this.lease;
    const unsubscribe = this.unsubscribe;
    // 入口即取得资源所有权并清空投影，保证并发/重复 cleanup 不会二次关闭或释放。
    this.unsubscribe = undefined;
    this.session = undefined;
    this.lease = undefined;
    // 同步摘除订阅并 teardown；即使敌意测试 seam 令 session.close reject，channel 也已
    // 停止接纳与发送，且 finally 仍会释放 lease。生产 ReplicationSession.close 契约恒绿，
    // 这里的防御负责 host 组装边界的异常安全。
    try {
      unsubscribe?.();
    } catch {
      // best-effort：退订异常不得阻断其余资源收口
    }
    this.watchdog.teardown();
    this.round.teardown();
    this.channel.teardown();
    try {
      if (session !== undefined) {
        await session.close();
      }
    } finally {
      if (lease !== undefined) {
        await lease.release().catch(() => undefined);
      }
    }
  }

  private setState(state: HubChannelState): void {
    if (this.state === state) return;
    const from = this.state;
    this.state = state;
    // HB1：channel FSM 唯一迁移点（同态早退——边沿 exactly-once；初始 'opening' 无迁移不发射）
    if (this.observerOn) {
      this.host.emitObserver({
        type: 'channel-state-changed',
        side: 'hub',
        ...(cidField(this.host.connectionId())),
        namespaceId: this.namespaceId,
        from,
        to: state,
      });
    }
  }

  // ─────────────────────────────── 观测发射辅助（§3/§4 safe-field） ───────────────────────────────

  /** HB2：namespace-error{direction:'sent'}（稳定码折叠；每次 wire 错误恰一事件）。 */
  private emitNsErrorSent(code: string): void {
    if (!this.observerOn) return;
    this.host.emitObserver({
      type: 'namespace-error',
      side: 'hub',
      ...(cidField(this.host.connectionId())),
      namespaceId: this.namespaceId,
      code: stableNamespaceCode(code),
      direction: 'sent',
    });
  }

  /** HB7/HB8：resync-required（cause 闭联合）。 */
  private emitResyncRequired(
    cause:
      | 'queue-overflow'
      | 'send-failed'
      | 'connection-shed'
      | 'ack-timeout'
      | 'session-fanout-overflow'
      | 'remote-declared',
  ): void {
    if (!this.observerOn) return;
    this.host.emitObserver({
      type: 'resync-required',
      side: 'hub',
      ...(cidField(this.host.connectionId())),
      namespaceId: this.namespaceId,
      cause,
    });
  }

  /** HB5/HB6：identity-conflicted（via 闭联合）。 */
  private emitIdentityConflicted(
    via: 'open-mismatch' | 'fence' | 'identity-changed-frame',
  ): void {
    if (!this.observerOn) return;
    this.host.emitObserver({
      type: 'identity-conflicted',
      side: 'hub',
      ...(cidField(this.host.connectionId())),
      namespaceId: this.namespaceId,
      via,
    });
  }

  private armTimer(kind: TimerKind): void {
    this.clearTimer(kind);
    const delay = kind === 'bootstrap' ? this.host.timeouts.bootstrapTimeoutMs : this.host.timeouts.closeTimeoutMs;
    this.timers[kind] = this.host.timer.setTimeout(() => {
      this.timers[kind] = undefined;
      if (this.isTerminal()) return;
      if (kind === 'bootstrap') {
        // hub 侧 bootstrap timer：测试惰性；生产语义 = ns 收口
        this.finalize('failed');
      }
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
    (['bootstrap', 'close'] as const).forEach((kind) => this.clearTimer(kind));
  }
}

/** Yjs 引用（快照编码的规范等价形式——session.encodeDiff(∅sv) 已覆盖；保留类型锚）。 */
export type HubDocHandle = Y.Doc;

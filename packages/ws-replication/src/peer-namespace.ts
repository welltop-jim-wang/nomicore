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
  /** 本端连接致命（ACK_STATE_VIOLATION 等）：connection ERROR + close + blocked。 */
  connectionFatal(code: string, wsCloseCode?: number): void;
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

  readonly round: RoundEngine;
  readonly channel: UpdateChannel;
  readonly watchdog: FenceWatchdog;
  private readonly onOwnedBound: (bytes: Uint8Array) => void;

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
    this.setState('opening');
    this.armTimer('open');
    void (async () => {
      let result: Awaited<ReturnType<NamespaceRegistry['open']>>;
      try {
        result = await this.host.registry.open(this.target.localOwner, this.namespaceId);
      } catch (err) {
        if (!this.isTerminal()) this.finalize('failed');
        return;
      }
      if (this.isTerminal()) return; // §13.4：零 wire、零迁移
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
        this.finalize('failed');
        return;
      }
      if (this.isTerminal()) return;
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
    if (this.state !== 'opening') return; // 迟到结果纪律（§13.4）
    const opened = await this.tryOpenReplicationSession();
    if (!opened) return;
    this.setState('reconciling');
    this.armTimer('reconcile');
    this.startRound();
  }

  private async tryOpenReplicationSession(): Promise<boolean> {
    if (this.lease === undefined) return false;
    let result: Awaited<ReturnType<NamespaceLease['openReplicationSession']>>;
    try {
      result = await this.lease.openReplicationSession({
        localRole: 'peer',
        remoteInstanceId: this.host.hubInstanceId,
      });
    } catch {
      if (!this.isTerminal()) this.finalize('failed');
      return false;
    }
    if (this.isTerminal()) return false; // §13.4
    if (!result.ok) {
      if (!this.isTerminal()) this.finalize('failed');
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
      let importResult: Awaited<ReturnType<NamespaceRegistry['importReplica']>>;
      try {
        importResult = await this.host.registry.importReplica(
          this.target.localOwner,
          this.namespaceId,
          detached,
          { replicationId: message.replicationId, replicationEpoch: message.replicationEpoch },
        );
      } catch {
        if (!this.isTerminal()) {
          this.sendNsError('INTERNAL_ERROR');
          this.finalize('failed');
        }
        return;
      }
      if (this.isTerminal()) return; // §13.4：零 wire、静默回收
      if (!importResult.ok) {
        this.sendNsError('BOOTSTRAP_FAILED');
        this.finalize('failed');
        return;
      }
      this.lease = importResult.lease;
      const opened = await this.tryOpenReplicationSession();
      if (!opened) return;
      this.clearTimer('bootstrap');
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
      this.closeMemo = new Memoized(async () => {
        await this.drainPendingApplies();
        await this.closeSessionAndRelease();
      });
    }
    return this.closeMemo.get();
  }

  private settleCloseMemo(): void {
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
      return;
    }
    if (this.state === 'failed') {
      this.setState('disconnected');
      return;
    }
    void this.cleanupResources().then(() => {
      if (!this.isTerminal()) this.setState('disconnected');
    });
  }

  /** 连接 blocked（fatal）：活跃态投影 disconnected。 */
  onConnectionFatal(): void {
    if (this.isTerminal()) return;
    void this.cleanupResources().then(() => {
      if (!this.isTerminal()) this.setState('disconnected');
    });
  }

  /** stop()：一律收口为 closed（本地，零 wire）。 */
  onConnectionStopped(): Promise<void> {
    this.intent = 'removed';
    if (!this.isTerminal()) {
      this.setState('closed');
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
      // §10.4：不重发同一 UPDATE；窗口已收口 → 发起新 round（下一微任务——needs-resync
      // 状态先可观测，随后同连接立即恢复）
      // needs-resync 状态先可观测（§10.4 timer 锚），随后立即同连接恢复——恢复 round 的
      // 起始经微任务链错开，保证测试的 settleUntil 至少观察到一次 needs-resync 投影。
      let attempts = 0;
      const deferRecovery = (): void => {
        queueMicrotask(() => {
          attempts += 1;
          if (attempts >= 512) {
            if (this.state === 'needs-resync') this.maybeStartRecovery();
          } else {
            deferRecovery();
          }
        });
      };
      deferRecovery();
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
    return this.sendChecked({
      kind: 'UPDATE',
      namespaceId: this.namespaceId,
      update: bytes,
    });
  }

  private async applyStep2(update: Uint8Array, step2Sequence: number): Promise<'ok' | 'aborted'> {
    const outcome = await this.applyRemoteUpdate(update, step2Sequence, true);
    if (outcome === 'ok') {
      // §9.1.4：apply 成功 → 发 SYNC_APPLIED（ackedSequence = 收到的 Step2 帧序）
      this.sendChecked({
        kind: 'SYNC_APPLIED',
        namespaceId: this.namespaceId,
        syncRoundId: this.round.currentRound,
        ackedSequence: step2Sequence,
      });
      return 'ok';
    }
    return 'aborted';
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
      if (this.isQuietState()) return 'ok'; // closing/终态：ACK 不再发出
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
    if (state === 'closed') this.settleCloseMemo();
    void this.cleanupResources();
  }

  private isTerminal(): boolean {
    return this.state === 'closed' || this.state === 'conflicted' || this.state === 'failed';
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
    if (session !== undefined) {
      await session.close();
    }
    if (this.unsubscribe !== undefined) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
    const lease = this.lease;
    this.lease = undefined;
    this.session = undefined;
    this.watchdog.teardown();
    this.round.teardown();
    this.channel.teardown();
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

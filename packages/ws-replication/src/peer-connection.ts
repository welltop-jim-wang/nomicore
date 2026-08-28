/**
 * peer-connection —— `createPeerReplication`：连接 FSM + backoff/jitter + 重建编排
 * （§4.3/§4.4/§14）。目标级状态机见 peer-namespace.ts。
 */
import type { DuplexTransport } from './types.js';
import type { ReplicationMessage } from '@nomicore/replication-protocol';
import {
  decodeInbound,
  OutboundQueue,
  connectionErrorFrame,
  namespaceErrorFrame,
} from './frame-io.js';
import { PeerNamespaceController, type PeerNamespaceHost } from './peer-namespace.js';
import { ConnectionSender } from './backpressure.js';
import type { NamespaceRegistry } from '@nomicore/namespace-registry';
import type {
  PeerConnectionState,
  PeerNamespaceState,
  PeerReplication,
  PeerReplicationOptions,
  ReplicationTarget,
  ResolvedBackoff,
  ResolvedLimits,
  ResolvedTimeouts,
} from './types.js';
import type { ReplicationTimer } from './types.js';
import { resolveBackoff, resolveLimits, resolveTimeouts } from './defaults.js';
import { validatePeerOptions, validateLimits, validateTimeouts, validateBackoff } from './validate.js';

const HANDSHAKE_OR_READY: ReadonlySet<PeerConnectionState> = new Set(['handshaking', 'ready']);

export function createPeerReplication(options: PeerReplicationOptions): PeerReplication {
  return new PeerConnectionImpl(options);
}

class PeerConnectionImpl implements PeerReplication {
  private readonly limits: ResolvedLimits;
  private readonly timeouts: ResolvedTimeouts;
  private readonly backoff: ResolvedBackoff;
  private readonly host: PeerNamespaceHost;
  private readonly controllers = new Map<string, PeerNamespaceController>();

  private connStateValue: PeerConnectionState = 'stopped';
  /** 连接代际：每次 dialNow +1——控制器异步续体（startOpen/导入/apply）以此判别
   *  迟到性（§13.4「连接已断」：代理期零 wire、零状态机迁移）。 */
  private connectionEpochValue = 0;
  private transport: DuplexTransport | undefined;
  private outbound: OutboundQueue | undefined;
  /** 连接级发送调度（连接域背压；每连接实例一个，随 transport 生命周期，§6.3）。 */
  private sender: ConnectionSender | undefined;
  private expectedSeq = 1;
  private nonce: Uint8Array | undefined;
  private attempts = 0;
  private helloHandle: unknown | undefined;
  private resetHandle: unknown | undefined;
  private backoffHandle: unknown | undefined;
  private rebuildPending = false;
  private stopping = false;
  private stopTail: Promise<void> = Promise.resolve();

  constructor(private readonly options: PeerReplicationOptions) {
    validatePeerOptions(options);
    const limits = resolveLimits(options.limits);
    const timeouts = resolveTimeouts(options.timeouts);
    const backoff = resolveBackoff(options.backoff);
    validateLimits(limits);
    validateTimeouts(timeouts);
    validateBackoff(backoff);
    this.limits = limits;
    this.timeouts = timeouts;
    this.backoff = backoff;
    this.host = {
      limits,
      timeouts,
      timer: options.timer,
      registry: options.registry,
      hubInstanceId: options.hubInstanceId,
      sendControl: (message) => this.sendControl(message),
      sendData: (namespaceId, bytes) => this.sendData(namespaceId, bytes),
      dataGateOpen: () => this.sender?.dataGateOpen() ?? true,
      onDataQueued: (namespaceId) => this.sender?.onDataQueued(namespaceId),
      requestDataDrain: () => this.sender?.requestDrain(),
      connectionFatal: (code, wsCloseCode) => this.connectionFatal(code, wsCloseCode ?? 1002),
      connectionEpoch: () => this.connectionEpochValue,
    };
    for (const target of options.targets ?? []) {
      this.addTarget(target);
    }
  }

  // ─────────────────────────────── PeerReplication 公共面 ───────────────────────────────

  start(): void {
    if (this.connStateValue !== 'stopped') return; // 幂等
    this.stopping = false;
    this.setState('disconnected');
    this.dialNow();
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopTail;
    this.stopping = true;
    this.clearBackoff();
    this.clearHello();
    this.clearReset();
    this.sender?.teardown(); // §8：poll timer 清零（连接收口必经点）
    const previous = this.connStateValue;
    if (previous === 'stopped') return Promise.resolve();
    this.setState('draining');
    const transport = this.transport;
    if (transport !== undefined && !transport.closed) {
      transport.close(1000, 'replication-stop');
    }
    this.stopTail = Promise.all(
      [...this.controllers.values()].map((controller) => controller.onConnectionStopped()),
    ).then(() => {
      this.setState('stopped');
    });
    return this.stopTail;
  }

  addTarget(target: ReplicationTarget): void {
    const existing = this.controllers.get(target.namespaceId);
    if (existing !== undefined) {
      // 幂等语义：非 blocked 连接 → 合流（零新 OPEN 帧）；blocked → config-change 重建
      if (this.connStateValue === 'blocked' || this.rebuildPending) {
        existing.intent = 'active';
        if (this.isTerminalState(existing.state)) {
          existing.setState('targeted');
        }
        this.requestRebuild('config-change');
        return;
      }
      if (existing.state === 'closed' || existing.state === 'conflicted' || existing.state === 'failed') {
        // §14.1：closed/conflicted/failed 后的重 add → 整连接重建
        existing.intent = 'active';
        existing.setState('targeted');
        this.requestRebuild('re-add');
        return;
      }
      existing.intent = 'active'; // 活跃/opening 中重复 add → 合流
      return;
    }
    const controller = new PeerNamespaceController(this.host, target);
    this.controllers.set(target.namespaceId, controller);
    if (this.connStateValue === 'ready') {
      controller.startOpen();
    } else if (this.connStateValue === 'blocked' || this.connStateValue === 'backoff') {
      // 连接未就绪时新 target：等 ready 后 openActiveTargets 处理（blocked → 重建）
      if (this.connStateValue === 'blocked') {
        this.requestRebuild('config-change');
      }
    }
  }

  removeTarget(namespaceId: string): Promise<void> {
    const controller = this.controllers.get(namespaceId);
    if (controller === undefined) return Promise.resolve(undefined as unknown as void);
    return controller.removeTarget();
  }

  getConnectionState(): PeerConnectionState {
    return this.connStateValue;
  }

  getNamespaceState(namespaceId: string): PeerNamespaceState | undefined {
    return this.controllers.get(namespaceId)?.state;
  }

  // ─────────────────────────────── 连接 FSM ───────────────────────────────

  private dialNow(): void {
    if (this.stopping) return;
    this.clearBackoff();
    this.connectionEpochValue += 1;
    this.setState('connecting');
    let transport: DuplexTransport;
    try {
      transport = this.options.dial();
    } catch {
      this.onTemporaryFailure();
      return;
    }
    this.transport = transport;
    this.outbound = new OutboundQueue(
      (bytes) => {
        if (!this.transportClosed()) transport.send(bytes);
      },
      this.limits,
      () => this.onSequenceExhausted(transport),
      (info) => this.sender?.onEmitted(info),
    );
    // §8：新 sender 创建前旧 sender.teardown()（poll timer 零泄漏；重拨后新 sender
    // 从 clean 态起步——!paused、额度 0、空 wheel、无 timer）。
    this.sender?.teardown();
    this.sender = new ConnectionSender({
      limits: this.limits,
      timer: this.options.timer,
      readBufferedAmount: () => this.readBufferedAmount(),
      emitControl: (message) => this.emitControl(message),
      emitData: (message) => this.emitData(message),
      facetOf: (namespaceId) => this.controllers.get(namespaceId)?.sendFacet,
      isEmitAllowed: () => this.connStateValue === 'ready',
      onBackpressureExhausted: () => this.failConnectionBackpressure(),
    });
    this.expectedSeq = 1;
    this.nonce = this.makeNonce();
    // HELLO 是连接自身握手帧：直发（sendControl 的 ready 状态门不适用于握手期发送）
    this.outbound.sendControl({
      kind: 'HELLO',
      peerInstanceId: this.options.instanceId,
      expectedHubInstanceId: this.options.hubInstanceId,
      protocolVersions: [1],
      requiredCapabilities: 0,
      optionalCapabilities: 0,
      connectionNonce: this.nonce,
    });
    this.setState('handshaking');
    this.armHello();
    transport.onMessage((bytes) => this.onMessage(bytes));
    transport.onClose((info) => this.onClose(info));
  }

  private makeNonce(): Uint8Array {
    const random = this.options.random ?? Math.random;
    const nonce = new Uint8Array(16);
    for (let i = 0; i < 16; i += 1) {
      nonce[i] = Math.floor(random() * 256) & 0xff;
    }
    return nonce;
  }

  private onMessage(bytes: Uint8Array): void {
    if (this.connStateValue !== 'handshaking' && this.connStateValue !== 'ready') return;
    let decoded: ReturnType<typeof decodeInbound>;
    try {
      decoded = decodeInbound(bytes, {
        expectedSequence: this.expectedSeq,
        maxFrameBytes: this.limits.maxFrameBytes,
      });
    } catch (err) {
      // §4.1/§18.8（ADR 0010 L147 字面）：入站帧 sequence ≠ 期望值——无论 gap、repeat
      // 或回退——一律 SEQUENCE_VIOLATION connection fatal（1002 → blocked）。无任何
      // closing/终态豁免（F3 修复：SA6 seam 已支持显式 sequence + 静默期不变量）。
      const code = (err as { code?: string }).code ?? 'MALFORMED_FRAME';
      this.connectionFatal(code, code === 'INSTANCE_IDENTITY_MISMATCH' || code === 'CONNECTION_POLICY_VIOLATION' || code === 'FRAME_TOO_LARGE' ? (code === 'FRAME_TOO_LARGE' ? 1009 : 1008) : 1002);
      return;
    }
    this.expectedSeq = decoded.header.sequence + 1;
    const message = decoded.message;
    if (this.connStateValue === 'handshaking') {
      if (message.kind === 'HELLO_ACK') {
        this.onHelloAck(message);
        return;
      }
      // HELLO 前的任何其他帧 / 错向帧
      this.connectionFatal('CONNECTION_POLICY_VIOLATION', 1008);
      return;
    }
    this.dispatchReady(message, decoded.header.sequence);
  }

  private onHelloAck(message: {
    hubInstanceId: string;
    protocolVersion: number;
    connectionNonce: Uint8Array;
  }): void {
    if (
      message.hubInstanceId !== this.options.hubInstanceId ||
      message.protocolVersion !== 1 ||
      !this.nonceEqual(message.connectionNonce)
    ) {
      this.connectionFatal('INSTANCE_IDENTITY_MISMATCH', 1008);
      return;
    }
    this.clearHello();
    this.setState('ready');
    this.armResetCheck();
    this.openActiveTargets();
  }

  private nonceEqual(other: Uint8Array): boolean {
    const nonce = this.nonce;
    if (nonce === undefined || other.byteLength !== nonce.byteLength) return false;
    for (let i = 0; i < nonce.byteLength; i += 1) {
      if (nonce[i] !== other[i]) return false;
    }
    return true;
  }

  private dispatchReady(message: ReplicationMessage, sequence: number): void {
    switch (message.kind) {
      case 'HELLO':
      case 'HELLO_ACK':
      case 'BOOTSTRAP_ACK':
        this.connectionFatal('CONNECTION_POLICY_VIOLATION', 1008);
        return;
      case 'OPEN_NAMESPACE':
        this.onRemoteOpen(message);
        return;
      case 'OPEN_OK':
        this.withController(message.namespaceId, (c) => c.onOpenOk(message));
        return;
      case 'BOOTSTRAP_SNAPSHOT':
        this.withController(message.namespaceId, (c) => c.onBootstrapSnapshot({ ...message, sequence }));
        return;
      case 'SYNC_STEP1':
        this.withController(message.namespaceId, (c) => c.onSyncStep1({ ...message, sequence }));
        return;
      case 'SYNC_STEP2':
        this.withController(message.namespaceId, (c) => c.onSyncStep2({ ...message, sequence }));
        return;
      case 'SYNC_APPLIED':
        this.withController(message.namespaceId, (c) => c.onSyncApplied(message));
        return;
      case 'RESYNC_REQUIRED':
        this.withController(message.namespaceId, (c) => c.onResyncReceived());
        return;
      case 'UPDATE':
        this.withController(message.namespaceId, (c) => c.onHubUpdate({ ...message, sequence }));
        return;
      case 'UPDATE_ACK':
        this.withController(message.namespaceId, (c) => c.onUpdateAck(message));
        return;
      case 'CLOSE_NAMESPACE':
        this.withController(message.namespaceId, (c) => c.onCloseRequest({ ...message, sequence }));
        return;
      case 'CLOSE_OK':
        this.withController(message.namespaceId, (c) => c.onCloseOk());
        return;
      case 'IDENTITY_CHANGED':
        this.withController(message.namespaceId, (c) => c.onIdentityChanged());
        return;
      case 'ERROR':
        if (message.namespaceId !== undefined) {
          const controller = this.controllers.get(message.namespaceId);
          if (controller !== undefined) controller.onErrorFrame(message);
        }
        return;
      case 'GOAWAY':
        this.onGoaway(message);
        return;
      default: {
        const never: never = message;
        void never;
        return;
      }
    }
  }

  private onRemoteOpen(message: { namespaceId: string; hasLocalReplica: boolean }): void {
    if (message.hasLocalReplica) {
      // 错向 OPEN（hub→peer）且带身份字段：按 §11.2 处理
    }
    const controller = this.controllers.get(message.namespaceId);
    if (controller === undefined) {
      this.sendControl(namespaceErrorFrame('TARGET_NOT_REQUESTED', message.namespaceId));
      return;
    }
    this.sendControl(namespaceErrorFrame('NAMESPACE_STATE_VIOLATION', message.namespaceId));
  }

  private onGoaway(message: { reasonCode: string; drainTimeoutMs: number }): void {
    // §4.3 GOAWAY 接收语义（v1 最小面）：停止新 OPEN/round；按 reason 分类；slice 9 前
    // 不做 deadline 完整编排——按 drainTimeoutMs 后关闭并回退。
    this.goawayDrainMs = message.drainTimeoutMs;
    void this;
    if (message.reasonCode === 'SERVER_SHUTTING_DOWN' || message.reasonCode === 'REAUTH_REQUIRED') {
      // B1（终审 Standards 轴，2026-08-29）：blocked 直达路径补 sender teardown——
      // 与 enterBlocked/scheduleDrainClose 同型（§8 teardown 矩阵成文声称）。blocked
      // 是长寿命等待态且 onClose 对 blocked 早退——若暂停段 poll timer 已武装而未清，
      // stale getter 上 1s 周期无限重武装（backpressure.ts poll 回调）直至人工 stop。
      this.sender?.teardown();
      this.setState('blocked');
      return;
    }
    // SERVER_RESTARTING / 其他 → 本地计时 deadline 后由回退重连兜底
    this.scheduleDrainClose();
  }

  private goawayDrainMs = 0;

  private scheduleDrainClose(): void {
    const timer = this.options.timer;
    const transport = this.transport;
    timer.setTimeout(() => {
      // §8（R2 补行，SA2 #6）：close 前补 sender.teardown()——清除已武装 poll timer，
      // 杜绝 stale getter 上 1s 周期性重武装直至下次 dialNow 换 sender；即便 stale
      // fire 到达（防御面）：teardown 后 pollHandle 恒 undefined、回调零副作用且不重武装。
      this.sender?.teardown();
      if (transport !== undefined && !transport.closed) {
        transport.close(1001, 'goaway-drain');
      }
    }, this.goawayDrainMs);
  }

  private withController(namespaceId: string, fn: (c: PeerNamespaceController) => void): void {
    const controller = this.controllers.get(namespaceId);
    if (controller === undefined) {
      // 无生命周期即无合法收发态（§6 广义面）：统一 NAMESPACE_STATE_VIOLATION
      this.sendControl(namespaceErrorFrame('NAMESPACE_STATE_VIOLATION', namespaceId));
      return;
    }
    fn(controller);
  }

  private openActiveTargets(): void {
    for (const controller of [...this.controllers.values()]) {
      if (controller.intent !== 'active') continue;
      if (controller.state === 'targeted') {
        controller.startOpen();
      } else if (controller.state === 'disconnected' || controller.state === 'failed') {
        controller.setState('targeted');
        controller.startOpen();
      }
      // closed/conflicted：等待显式 re-add（§14.1）
    }
  }

  // ─────────────────────────────── 连接级帧出入 ───────────────────────────────

  private sendControl(message: ReplicationMessage): number {
    if (this.outbound === undefined || this.sender === undefined) return 0;
    // B-2e 放大器：连接状态门——控制器帧只在连接 ready 时发送；重建/断开/重连的
    // pending 期零出站（迟到帧落在新连接 handshaking 窗口会触发 HELLO_REQUIRED fatal）。
    if (this.connStateValue !== 'ready') return 0;
    // §4.3：保留额度判据在 sender.sendControl 单点（收口路径直发 outbound 豁免——
    // 见 onSequenceExhausted/connectionFatal/failConnectionBackpressure）。
    return this.sender.sendControl(message);
  }

  /**
   * data 帧（UPDATE）发送路径（§6.3，issue #137）：ready 门 → sender.tryEmitData
   * （水位观察② + data 出队；序列号由 OutboundQueue.emit 单点分配）。
   */
  private sendData(namespaceId: string, bytes: Uint8Array): number {
    if (this.outbound === undefined || this.sender === undefined) return 0;
    if (this.connStateValue !== 'ready') return 0;
    return this.sender.tryEmitData({
      kind: 'UPDATE',
      namespaceId,
      update: bytes,
    });
  }

  /** ConnectionSender 宿主：control 出站（无水位门；保留额度判据在 sender 侧）。 */
  private emitControl(message: ReplicationMessage): number {
    return this.outbound?.sendControl(message) ?? 0;
  }

  /** ConnectionSender 宿主：data 出站（OutboundQueue.emit——序列分配单点）。 */
  private emitData(message: ReplicationMessage): number {
    return this.outbound?.emit(message) ?? 0;
  }

  /**
   * §4.2 鸭子类型读取 transport.bufferedAmount（seam 定案：属性形态）。
   * 缺失/非 number/非有限数 → 0 = 无压力（既有 makeWire 与全部用例结构性零影响）。
   */
  private readBufferedAmount(): number {
    const transport = this.transport;
    if (transport === undefined) return 0;
    try {
      const level = (transport as { readonly bufferedAmount?: unknown }).bufferedAmount;
      return typeof level === 'number' && Number.isFinite(level) ? level : 0;
    } catch {
      return 0; // seam 契约：transport 契约是「number 属性或缺失」；非契约形态 = 无压力
    }
  }

  private transportClosed(): boolean {
    return this.transport?.closed ?? true;
  }

  /** §4.1 R3/#11（R2-2 修订）：出站 uint32 耗尽 → 直接 close(1008) → blocked。
   *  framing 已不可信（§14 L391「否则直接 close」）：任何后续帧都只能以重复序列
   *  0xffffffff 发送 ⇒ 违反 §1 不变量 2 / §3 L54 严格递增；故零出站帧（原 best-effort
   *  ERROR 直发已删除——它正是重复序列号的唯一来源），peer 侧 teardown 由
   *  enterBlocked() 承担（:565-575 已含 sender?.teardown()）。 */
  private onSequenceExhausted(transport: DuplexTransport): void {
    if (transport.closed) return;
    if (!transport.closed) {
      transport.close(1008, 'sequence-exhausted');
    }
    this.enterBlocked();
  }

  // ─────────────────────────────── 失败/关闭分类 ───────────────────────────────

  private onClose(info: Readonly<{ code: number; reason: string }>): void {
    void info;
    if (this.stopping || this.connStateValue === 'stopped') return;
    if (this.connStateValue === 'backoff' || this.connStateValue === 'blocked') return;
    if (this.connStateValue === 'draining') return;
    const code = info.code;
    if (code === 1002 || code === 1008) {
      this.enterBlocked();
      return;
    }
    this.onTemporaryFailure();
  }

  private connectionFatal(code: string, wsCloseCode: number): void {
    if (this.stopping) return;
    // R2（设计 §6.3/§4.3 豁免；SA2 #2）：收口 ERROR 直发 outbound——绕过 ready 门
    // （协议 §14「framing 仍可信时关闭前 best-effort 发送 connection ERROR」义务
    // 落实，#136 R-13 收口方向）。有意的 wire 可观察变化：handshaking 期 fatal 从
    // 0 ERROR 帧 → 恰 1 帧（§10 行 9 登记；ready 态行为不变）。豁免路径不经
    // sender.sendControl 的额度判据——收口路径零递归（§4.3 I-4）。
    const transport = this.transport;
    if (transport !== undefined && this.outbound !== undefined && !transport.closed) {
      try {
        this.emitControl(connectionErrorFrame(code));
      } catch {
        // best-effort；framing 已不可信
      }
    }
    if (transport !== undefined && !transport.closed) {
      transport.close(wsCloseCode, 'protocol-error');
    }
    this.enterBlocked();
  }

  /**
   * §4.3 保留额度耗尽动作（CONNECTION_BACKPRESSURE 分类连接失败，retryable=yes/1011）：
   * best-effort ERROR（豁免帧——直发 outbound 不经额度判据）→ close(1011) →
   * onTemporaryFailure（attempts+1 → backoff → 重拨；**不走** enterBlocked——
   * #136 §4.3 的 1002/1008 才是 blocked）。本地 close 不触发本地 onClose
   * （fake/真实 WS 同构），FSM 迁移由本方法显式驱动；重入守卫：state ∈
   * {stopped/backoff/blocked/draining} 直接返回（best-effort ERROR 的递归发送被守卫吸收）。
   */
  private failConnectionBackpressure(): void {
    if (
      this.connStateValue === 'stopped' ||
      this.connStateValue === 'backoff' ||
      this.connStateValue === 'blocked' ||
      this.connStateValue === 'draining'
    ) {
      return;
    }
    const transport = this.transport;
    if (transport !== undefined && this.outbound !== undefined && !transport.closed) {
      try {
        this.emitControl(connectionErrorFrame('CONNECTION_BACKPRESSURE'));
      } catch {
        // best-effort；framing 已不可信
      }
    }
    if (transport !== undefined && !transport.closed) {
      transport.close(1011, 'control-backpressure');
    }
    this.sender?.teardown();
    this.onTemporaryFailure();
  }

  private enterBlocked(): void {
    if (this.connStateValue === 'blocked') return;
    this.sender?.teardown();
    this.clearHello();
    this.clearReset();
    this.clearBackoff();
    this.setState('blocked');
    // R4（SA4）：blocked 也是连接收口——§3.5 teardown 行：checkpoint 清 + 逐 ns
    // onDataShed（A7 记账闭环；GOAWAY SHUTTING_DOWN 不关 socket——残留排队数据帧
    // 不得继续派发向已宣布停机的 hub；controller 已投影 disconnected，dispose 的
    // onDataShed → declareLocalResync 经 sendControl 非 ready 门 → 零出站帧，无噪声）
    if (this.outbound !== undefined) {
      this.outbound.dispose();
      this.outbound = undefined;
    }
    for (const controller of this.controllers.values()) {
      controller.onConnectionFatal();
    }
  }

  private onTemporaryFailure(): void {
    if (this.stopping) return;
    if (this.connStateValue === 'backoff' || this.connStateValue === 'blocked') return;
    this.sender?.teardown();
    this.clearHello();
    this.clearReset();
    this.attempts += 1;
    this.setState('backoff');
    for (const controller of this.controllers.values()) {
      controller.onConnectionLost();
    }
    const cap = Math.min(this.backoff.maxMs, this.backoff.baseMs * Math.pow(2, this.attempts - 1));
    const random = this.options.random ?? Math.random;
    const delay = Math.max(0, random() * cap);
    this.backoffHandle = this.options.timer.setTimeout(() => {
      this.backoffHandle = undefined;
      if (this.connStateValue === 'backoff') this.dialNow();
    }, delay);
  }

  private requestRebuild(reason: string): void {
    void reason;
    if (this.rebuildPending) return;
    this.rebuildPending = true;
    this.clearHello();
    this.clearReset();
    this.clearBackoff();
    this.sender?.teardown(); // §8：重建 = 旧连接终结（poll timer 清零）
    this.setState('disconnected');
    // B-2e：§4.3 L228「重建期间所有 namespace 投影 disconnected」——通知全部目标
    // 控制器（兄弟活跃 ns 立即投影、由其清理；重连后 openActiveTargets 统一重 OPEN）
    for (const controller of this.controllers.values()) {
      controller.onConnectionLost();
    }
    const transport = this.transport;
    if (transport !== undefined && !transport.closed) {
      transport.close(1000, 'replication-rebuild');
    }
    queueMicrotask(() => {
      this.rebuildPending = false;
      if (!this.stopping) this.dialNow();
    });
  }

  // ─────────────────────────────── timer 管理 ───────────────────────────────

  private armHello(): void {
    this.clearHello();
    this.helloHandle = this.options.timer.setTimeout(() => {
      this.helloHandle = undefined;
      if (this.connStateValue === 'handshaking') this.onTemporaryFailure();
    }, this.timeouts.helloTimeoutMs);
  }

  private clearHello(): void {
    if (this.helloHandle !== undefined) {
      this.options.timer.clearTimeout(this.helloHandle);
      this.helloHandle = undefined;
    }
  }

  private armResetCheck(): void {
    this.clearReset();
    this.resetHandle = this.options.timer.setTimeout(() => {
      this.resetHandle = undefined;
      if (this.connStateValue === 'ready') this.attempts = 0;
    }, this.backoff.resetAfterMs);
  }

  private clearReset(): void {
    if (this.resetHandle !== undefined) {
      this.options.timer.clearTimeout(this.resetHandle);
      this.resetHandle = undefined;
    }
  }

  private clearBackoff(): void {
    if (this.backoffHandle !== undefined) {
      this.options.timer.clearTimeout(this.backoffHandle);
      this.backoffHandle = undefined;
    }
  }

  private setState(state: PeerConnectionState): void {
    if (this.connStateValue === state) return;
    this.connStateValue = state;
  }

  private isTerminalState(state: PeerNamespaceState): boolean {
    return state === 'closed' || state === 'conflicted' || state === 'failed';
  }
}

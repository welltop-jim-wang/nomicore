/**
 * hub-connection —— `createHubReplication`：accept/HELLO/hub 连接 FSM + 帧分发
 * （§4.2/§6/§15.2）。per-(connection, namespace) 通道见 hub-namespace.ts。
 */
import type { DuplexTransport, HubUpgradeRequest } from './types.js';
import { selectProtocolVersion, type ReplicationMessage } from '@nomicore/replication-protocol';
import {
  decodeInbound,
  namespaceFieldViolation,
  OutboundQueue,
  connectionErrorFrame,
  codecFieldLimits,
} from './frame-io.js';
import { startLiveness } from './liveness.js';
import { HubNamespaceChannel, type HubChannelHost } from './hub-namespace.js';
import { ConnectionSender } from './backpressure.js';
import type { NamespaceRegistry } from '@nomicore/namespace-registry';
import type {
  HubConnection,
  HubReplication,
  HubReplicationOptions,
  NamespaceAuthorizer,
  ResolvedLimits,
  ResolvedTimeouts,
} from './types.js';
import type { ReplicationTimer } from './types.js';
import { resolveLimits, resolveTimeouts } from './defaults.js';
import {
  isValidInstanceId,
  validateHubOptions,
  validateInstanceId,
  validateLimits,
  validateTimeouts,
} from './validate.js';

/**
 * §3.2 R2 A2（SA2 必修）：认证窗口早到帧缓冲的条数界（模块常数，非配置 knob——
 * HELLO 是唯一合法早到帧，守规矩的 peer 恰发 1 帧，16 为充裕余量；累计字节由
 * 「单帧界 limits.maxFrameBytes × 条数界」导出：≤ 16×maxFrameBytes）。
 */
const MAX_EARLY_FRAMES = 16;

export function createHubReplication(options: HubReplicationOptions): HubReplication {
  return new HubReplicationImpl(options);
}

/** Hub 内部共享面（连接实例访问）。 */
interface HubInternals {
  readonly instanceId: string;
  readonly registry: NamespaceRegistry;
  readonly authorize: NamespaceAuthorizer;
  readonly timer: ReplicationTimer;
  readonly limits: ResolvedLimits;
  readonly timeouts: ResolvedTimeouts;
  dropConnection(connection: HubConnectionImpl): void;
}

class HubReplicationImpl implements HubReplication {
  private readonly limits: ResolvedLimits;
  private readonly timeouts: ResolvedTimeouts;
  private readonly connectionList: HubConnectionImpl[] = [];
  private closed = false;
  private connectionCounter = 0;
  private closeTail: Promise<void> = Promise.resolve();
  private readonly internals: HubInternals;

  constructor(private readonly options: HubReplicationOptions) {
    validateHubOptions(options);
    const limits = resolveLimits(options.limits);
    const timeouts = resolveTimeouts(options.timeouts);
    validateLimits(limits);
    validateTimeouts(timeouts);
    this.limits = limits;
    this.timeouts = timeouts;
    this.internals = {
      instanceId: options.instanceId,
      registry: options.registry,
      authorize: options.authorize,
      timer: options.timer,
      limits,
      timeouts,
      dropConnection: (connection) => this.dropConnection(connection),
    };
  }

  async accept(transport: DuplexTransport, request?: HubUpgradeRequest): Promise<HubConnection | undefined> {
    // ── 门 0：停止接纳（生命周期门先于认证——已 close 的 hub 对新 upgrade 零工作）──
    if (this.closed) {
      transport.close(1001, 'hub-shutdown');
      return undefined;
    }

    // ── 门 1：缺凭据（未传 request / 无 token 字段 / 非字符串 / 空串）→ 拒绝 ──
    const token = request?.token;
    if (typeof token !== 'string' || token.length === 0) {
      transport.close(1008, 'upgrade-unauthorized'); // 静态 reason，零 token/身份回显（AC-7）
      return undefined;
    }

    // ── 门 2：无认证器（类型必填 + §2.3 构造期 TypeError 后的纵深防御——JS 调用方绕过类型）
    //    「无认证器 = 全部 upgrade 拒绝」——fail-closed，绝不 fail-open ──
    if (typeof this.options.verifyToken !== 'function') {
      transport.close(1008, 'upgrade-unauthorized');
      return undefined;
    }

    // ── 门 3（R2 A2 + R3 N1）：有界早到帧缓冲 + 早断线观察 + 认证等待封顶 ──
    const earlyFrames: Uint8Array[] = [];
    let earlyClosed = false;
    let authRejected = false; // 预算/超时拒绝已发生——验证器迟归一律 undefined（迟归不复活）
    // R3 N1（SA2 必修，一行级）：off 句柄 no-op 初始化——同步重放型 transport（TcpTransport
    // 实存形态：onMessage 注册即同步重放积压、重放先于 return/句柄赋值，sa7-r2-transport:132-144）
    // 上，积压帧可在赋值语句完成前触发本 listener 的拒绝路径；no-op 句柄使 detachEarly 在
    // 【任意时刻】安全（重放期内调用 = 无害 no-op），注册完成后重赋真句柄。拒绝的【效果】
    // （置标志 + close）在重放期内照常生效；【摘监听】统一延后到注册完成后的同步段收口——
    // 不再从 transport.onMessage(...) 调用点同步抛 TypeError（那会使 async accept 的 promise
    // reject，违反 §8.2 硬不变量，且异常展开会流产重放循环——pendingFrames 已 splice、
    // 余帧丢失、transport 未按设计关闭）。
    let offMessage: () => void = () => {};
    let offClose: () => void = () => {};
    const detachEarly = (): void => { offMessage(); offClose(); }; // 幂等（重复摘除零副作用）
    offMessage = transport.onMessage((bytes) => {
      if (authRejected) return; // 已拒（重放循环内后续帧）——幂等早退
      if (bytes.byteLength > this.limits.maxFrameBytes) {
        // 单帧界：复用既有 limit（ADR 0010 L165「最大 WS frame」）；§14 语义 → 1009
        authRejected = true;
        transport.close(1009, 'upgrade-frame-limit'); // 重放期内 close 照常生效（不摘监听）
        return;
      }
      if (earlyFrames.length >= MAX_EARLY_FRAMES) {
        // 条数界：第 17 帧即拒绝（policy）→ 1008
        authRejected = true;
        transport.close(1008, 'upgrade-frame-limit');
        return;
      }
      earlyFrames.push(bytes);
    });
    offClose = transport.onClose(() => { earlyClosed = true; });
    // 注册完成后的同步收口段（R3 N1）：同步重放期已拒（或注册期早断）→ 摘真句柄 + 直接拒绝
    // 返回。此刻 auth timer 尚未武装——零清理面；非重放路径 authRejected/earlyClosed 恒 false，
    // 本检查零开销通过。
    if (authRejected || earlyClosed) {
      detachEarly();
      return undefined;
    }
    // 认证等待封顶（显式政策，非沉默）：复用 timeouts.helloTimeoutMs——握手预算的既有载体，
    // 零新 knob；超时 = 拒绝分配（1008 静态 reason）。起止：门 3 武装 → 任何出口即清（§8.1 矩阵）。
    const authHandle = this.internals.timer.setTimeout(() => {
      authRejected = true;
      detachEarly(); // 此时句柄必为真值（注册已完成）
      if (!transport.closed) transport.close(1008, 'upgrade-timeout');
    }, this.timeouts.helloTimeoutMs);
    const clearAuthTimer = (): void => { this.internals.timer.clearTimeout(authHandle); };

    // ── 门 4：验证（accept 永不 reject——红灯 #5 零 unhandled rejection 的不变量）──
    let instanceId: unknown;
    try {
      const verdict = await this.options.verifyToken(token);
      clearAuthTimer(); // 首要动作：验证器已归，封顶 timer 必清
      if (authRejected) return undefined; // 缓冲期已拒（预算/超时）——迟归不复活
      if (verdict === null || typeof verdict !== 'object' || (verdict as { ok?: unknown }).ok !== true) {
        return this.rejectUpgrade(transport, detachEarly); // {ok:false} 或畸形裁决
      }
      instanceId = (verdict as { instanceId: unknown }).instanceId;
    } catch {
      clearAuthTimer();
      if (authRejected) return undefined; // 超时在先、验证器抛错在后——仍 undefined
      return this.rejectUpgrade(transport, detachEarly); // 验证器抛错
    }
    // A2-d 单帧超界变体的零宽窗口面（§3.1 竞态消除）：即时验证器（1 tick）下，首帧
    // 投递微任务与验证器续体在同一批次竞争——先让出一次微任务，使排队中的首帧先进入
    // 早到缓冲（超界 → authRejected + close(1009) / 条数界 → close(1008)），
    // 门 5 再按 authRejected（或 transport.closed）收口零分配——「帧到达同步段即拒、
    // 零分配」在验证器即时归的零宽窗口同样成立。
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    if (authRejected) return undefined; // 早到缓冲已拒（预算/超界）——验后迟拒的兜底复核
    // instanceId 文法违例（红灯 #4：'Bad-Id!'）→ 视为无效凭据
    if (!isValidInstanceId(instanceId)) {
      return this.rejectUpgrade(transport, detachEarly);
    }

    // ── 门 5：认证期间世界变化（R2 A4：先摘早到监听 → 再检查 → 再构造——顺序唯一基准 §3.3）──
    detachEarly();
    if (this.closed) {
      transport.close(1001, 'hub-shutdown');
      return undefined;
    }
    if (earlyClosed || transport.closed) return undefined; // 对端已断：零分配、零 close 副作用

    // ── 分配：认证身份随连接注入；早到帧在构造尾部按序重放（§3.3）──
    const connection = new HubConnectionImpl(
      this.internals, transport, this.connectionCounter++, instanceId as string, earlyFrames,
    );
    this.connectionList.push(connection);
    return connection;
  }

  private rejectUpgrade(transport: DuplexTransport, detachEarly: () => void): undefined {
    detachEarly(); // 幂等——预算路径已摘时零副作用
    transport.close(1008, 'upgrade-unauthorized');
    return undefined;
  }

  async revoke(instanceIdentity: string, namespaceId: string): Promise<void> {
    const tails: Promise<void>[] = [];
    for (const connection of [...this.connectionList]) { // 拷贝迭代——revoke 途中连接可能收口
      if (connection.authenticatedInstanceId !== instanceIdentity) continue; // 认证身份为权威键
      tails.push(connection.revokeNamespace(namespaceId));
    }
    await Promise.all(tails); // 未知 scope → 空数组 → resolve
  }

  get connections(): readonly HubConnection[] {
    return this.connectionList;
  }

  close(): Promise<void> {
    if (this.closed) return this.closeTail;
    this.closed = true; // 先置位：accept 门 0 即刻生效（§3.2）
    for (const connection of [...this.connectionList]) {
      connection.shutdownWithGoaway(this.timeouts.closeTimeoutMs);
    }
    this.closeTail = Promise.all(
      this.connectionList.map((connection) => connection.settle()),
    ).then(() => undefined);
    return this.closeTail;
  }

  private dropConnection(connection: HubConnectionImpl): void {
    const index = this.connectionList.indexOf(connection);
    if (index >= 0) this.connectionList.splice(index, 1);
  }
}

class HubConnectionImpl implements HubConnection {
  state: 'handshaking' | 'ready' | 'draining' | 'closed' = 'handshaking';
  peerInstanceId: string | undefined;
  private readonly outbound: OutboundQueue;
  /** 连接级发送调度（§6.3；每连接实例一个，随 transport 生命周期）。 */
  private readonly sender: ConnectionSender;
  private expectedSeq = 1;
  private readonly channels = new Map<string, HubNamespaceChannel>();
  private readonly helloHandle: unknown;
  private closedFlag = false;
  private settleTail: Promise<void> = Promise.resolve();
  private readonly channelHost: HubChannelHost;
  private readonly transportSubscribers: Array<() => void> = [];
  private stopLiveness: (() => void) | undefined;

  constructor(
    private readonly hub: HubInternals,
    private readonly transport: DuplexTransport,
    private readonly connId: number,
    /** D1 分配时绑定的认证身份（授权键权威来源——§3.2/§4/§5.1）。 */
    readonly authenticatedInstanceId: string,
    /** §3.2 认证期早到帧缓冲（构造尾部按序重放——§3.3 唯一基准：先摘早到监听 → 构造 → 重放）。 */
    earlyFrames: readonly Uint8Array[],
  ) {
    this.outbound = new OutboundQueue(
      (bytes) => {
        if (!transport.closed) transport.send(bytes);
      },
      hub.limits,
      () => this.onSequenceExhausted(transport),
      (info) => this.sender.onEmitted(info),
    );
    this.sender = new ConnectionSender({
      limits: hub.limits,
      timer: hub.timer,
      readBufferedAmount: () => this.readBufferedAmount(),
      emitControl: (message) => this.outbound.sendControl(message),
      emitData: (message) => this.outbound.emit(message),
      facetOf: (namespaceId) => this.channels.get(namespaceId)?.sendFacet,
      isEmitAllowed: () => !this.closedFlag,
      onBackpressureExhausted: () => this.connectionFatal('CONNECTION_BACKPRESSURE', 1011),
    });
    this.channelHost = {
      limits: hub.limits,
      timeouts: hub.timeouts,
      timer: hub.timer,
      registry: hub.registry,
      instanceId: hub.instanceId,
      peerInstanceId: () => this.authenticatedInstanceId,
      authorize: (instanceIdentity, namespaceId) => hub.authorize(instanceIdentity, namespaceId),
      sendControl: (message) => this.sendControlChecked(message),
      sendData: (namespaceId, bytes) => this.sendData(namespaceId, bytes),
      dataGateOpen: () => this.sender.dataGateOpen(),
      onDataQueued: (namespaceId) => this.sender.onDataQueued(namespaceId),
      requestDataDrain: () => this.sender.requestDrain(),
      connectionFatal: (code, wsCloseCode) => this.connectionFatal(code, wsCloseCode ?? 1002),
    };
    this.helloHandle = hub.timer.setTimeout(() => {
      if (this.state === 'handshaking') {
        this.connectionFatal('HELLO_TIMEOUT', 1002);
      }
    }, hub.timeouts.helloTimeoutMs);
    this.transportSubscribers.push(
      transport.onMessage((bytes) => this.onMessage(bytes)),
      transport.onClose(() => this.onTransportClosed()),
    );
    // 构造尾部重放（§3.3）：早到帧不绕过任何协议纪律——handshaking 态内非 HELLO 帧 →
    // HELLO_REQUIRED fatal（:199-206 既有）；有界缓冲（≤16 帧）使重放同步段长度有界。
    for (const bytes of earlyFrames) {
      this.onMessage(bytes);
    }
  }

  close(code?: number, reason?: string): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    this.state = 'draining';
    this.sender.teardown(); // §8：poll timer 清零（连接收口必经点）
    for (const channel of this.channels.values()) channel.quiesceConnection();
    if (!this.transport.closed) {
      this.transport.close(code ?? 1001, reason ?? 'hub-close');
    }
    void this.cleanupAll();
  }

  /** §7.2：GOAWAY(SERVER_SHUTTING_DOWN, drain) 先行，随后 close(1001)。
   *  handshaking 连接不发 GOAWAY（HELLO 未完成——对端 handshaking 门对非 HELLO_ACK 帧
   *  判 CONNECTION_POLICY_VIOLATION，peer-connection.ts:256-258；GOAWAY-before-ACK 反而是
   *  协议伤害）；直接 close(1001)。 */
  shutdownWithGoaway(drainMs: number): void {
    if (this.closedFlag) return;
    if (this.state === 'handshaking') {
      this.close(1001, 'hub-shutdown');
      return;
    }
    try {
      this.outbound.sendControl({ // 直发豁免（同 connectionFatal :369-375）：停机帧不允许
        kind: 'GOAWAY', // 被背压额度否决（sender.sendControl 在 paused 态有额度判据，耗尽即
        reasonCode: 'SERVER_SHUTTING_DOWN', // connectionFatal——停机帧不允许被否决）
        drainTimeoutMs: drainMs,
      });
    } catch {
      // best-effort：framing 不可信 → 直接 close
    }
    this.close(1001, 'hub-shutdown'); // 既有路径：teardown + close + cleanupAll
  }

  /** §5.1 revoke 链第二层：HELLO 前无 channels → 天然 no-op。 */
  revokeNamespace(namespaceId: string): Promise<void> {
    const channel = this.channels.get(namespaceId);
    if (channel === undefined) return Promise.resolve();
    return channel.terminateUnauthorized();
  }

  /** 全部通道 cleanup 结算（HubReplication.close 等待）。 */
  settle(): Promise<void> {
    return this.settleTail;
  }

  private onMessage(bytes: Uint8Array): void {
    if (this.closedFlag) return;
    let decoded: { header: { sequence: number }; message: ReplicationMessage };
    try {
      decoded = decodeInbound(bytes, {
        expectedSequence: this.expectedSeq,
        maxFrameBytes: this.hub.limits.maxFrameBytes,
      });
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'MALFORMED_FRAME';
      this.connectionFatal(code, wsCloseCodeFor(code));
      return;
    }
    this.expectedSeq = decoded.header.sequence + 1;
    const message = decoded.message;
    if (this.state === 'handshaking') {
      if (message.kind === 'HELLO') {
        this.onHello(message);
        return;
      }
      this.connectionFatal('HELLO_REQUIRED', 1002);
      return;
    }
    this.dispatchReady(message, decoded.header.sequence);
  }

  private onHello(message: {
    peerInstanceId: string;
    expectedHubInstanceId: string;
    protocolVersions: number[];
    requiredCapabilities: number;
    connectionNonce: Uint8Array;
  }): void {
    if (this.state !== 'handshaking') {
      this.connectionFatal('CONNECTION_POLICY_VIOLATION', 1008);
      return;
    }
    // D2（§4）：HELLO 自声明身份必须等于认证身份（token 绑定的可信身份，一层↔二层绑定）；
    // 恒等失败 → INSTANCE_IDENTITY_MISMATCH（connection/config/1008，零新错误码）
    if (message.peerInstanceId !== this.authenticatedInstanceId) {
      this.connectionFatal('INSTANCE_IDENTITY_MISMATCH', 1008);
      return;
    }
    if (message.expectedHubInstanceId !== this.hub.instanceId) {
      this.connectionFatal('INSTANCE_IDENTITY_MISMATCH', 1008);
      return;
    }
    const version = selectProtocolVersion(message.protocolVersions, [1]);
    if (version === null) {
      this.connectionFatal('UNSUPPORTED_PROTOCOL_VERSION', 1002);
      return;
    }
    if (message.requiredCapabilities !== 0) {
      this.connectionFatal('UNSUPPORTED_CAPABILITY', 1002);
      return;
    }
    this.peerInstanceId = this.authenticatedInstanceId;
    this.state = 'ready';
    if (this.transport.ping !== undefined && this.transport.onPong !== undefined) {
      this.stopLiveness = startLiveness({
        timer: this.hub.timer,
        pingIntervalMs: this.hub.timeouts.pingIntervalMs,
        pongTimeoutMs: this.hub.timeouts.pongTimeoutMs,
        ping: this.transport.ping,
        onPong: this.transport.onPong,
        onPongTimeout: () => this.onLivenessLost(),
      });
    }
    // N1：§16 行 1「HELLO_ACK 解除」——HELLO 握手完成的同步段解除 hello timer
    //（原实现永不 clear：每连接多挂一个 helloTimeoutMs 空 timer）。
    this.hub.timer.clearTimeout(this.helloHandle);
    const connectionId = `${this.hub.instanceId}-conn-${this.connId}`;
    this.sendControlChecked({
      kind: 'HELLO_ACK',
      hubInstanceId: this.hub.instanceId,
      protocolVersion: version,
      selectedCapabilities: 0,
      connectionNonce: message.connectionNonce,
      connectionId,
    });
  }

  private dispatchReady(message: ReplicationMessage, sequence: number): void {
    switch (message.kind) {
      case 'HELLO':
      case 'HELLO_ACK':
      case 'OPEN_OK':
      case 'BOOTSTRAP_SNAPSHOT':
      case 'IDENTITY_CHANGED':
        // 方向纪律（R2.1 澄清）：hub 收到 hub→peer 方向专用帧 → 连接策略拒绝（§6）
        this.connectionFatal('CONNECTION_POLICY_VIOLATION', 1008);
        return;
      case 'OPEN_NAMESPACE':
        this.onOpenNamespace(message);
        return;
      case 'BOOTSTRAP_ACK':
        this.withChannel(message.namespaceId, (c) => c.onBootstrapAck({ ackedSequence: message.ackedSequence }));
        return;
      case 'SYNC_STEP1':
        this.withChannel(message.namespaceId, (c) => c.onSyncStep1({ ...message, sequence }));
        return;
      case 'SYNC_STEP2':
        this.withChannel(message.namespaceId, (c) => c.onSyncStep2({ ...message, sequence }));
        return;
      case 'SYNC_APPLIED':
        this.withChannel(message.namespaceId, (c) => c.onSyncApplied(message));
        return;
      case 'RESYNC_REQUIRED':
        this.withChannel(message.namespaceId, (c) => c.onResyncReceived());
        return;
      case 'UPDATE': {
        const violation = namespaceFieldViolation(message, codecFieldLimits(this.hub.limits));
        this.withChannel(message.namespaceId, (c) => {
          if (violation !== undefined) {
            c.onFieldViolation(violation);
            return;
          }
          c.onUpdate({ update: message.update, sequence });
        });
        return;
      }
      case 'UPDATE_ACK':
        this.withChannel(message.namespaceId, (c) => c.onUpdateAck(message));
        return;
      case 'CLOSE_NAMESPACE':
        this.withChannel(message.namespaceId, (c) => c.onCloseRequest({ ...message, sequence }));
        return;
      case 'CLOSE_OK':
        // hub 不发 CLOSE（CLOSE 恒由 peer 发起）；收到即方向异常
        this.withChannel(message.namespaceId, (c) => c.onErrorFrame({ code: 'NAMESPACE_STATE_VIOLATION' }));
        return;
      case 'ERROR':
        if (message.namespaceId !== undefined) {
          const channel = this.channels.get(message.namespaceId);
          if (channel !== undefined) channel.onErrorFrame(message);
        }
        return;
      case 'GOAWAY':
        this.connectionFatal('CONNECTION_POLICY_VIOLATION', 1008);
        return;
      default: {
        const never: never = message;
        void never;
        return;
      }
    }
  }

  private onOpenNamespace(message: {
    namespaceId: string;
    hasLocalReplica: boolean;
    replicationId?: string;
    replicationEpoch?: number;
  }): void {
    let channel = this.channels.get(message.namespaceId);
    if (channel === undefined) {
      channel = new HubNamespaceChannel(this.channelHost, message.namespaceId);
      this.channels.set(message.namespaceId, channel);
      channel.startOpen(message);
      return;
    }
    channel.onOpen(message);
  }

  private withChannel(namespaceId: string, fn: (c: HubNamespaceChannel) => void): void {
    const channel = this.channels.get(namespaceId);
    if (channel === undefined) {
      try {
        this.sendControlChecked({
          kind: 'ERROR',
          code: 'NAMESPACE_STATE_VIOLATION',
          safeMessage: 'protocol error: NAMESPACE_STATE_VIOLATION',
          namespaceId,
        });
      } catch {
        // 连接已收口；忽略
      }
      return;
    }
    fn(channel);
  }

  private onTransportClosed(): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    this.state = 'closed';
    this.sender.teardown();
    void this.cleanupAll();
  }

  private async cleanupAll(): Promise<void> {
    for (const channel of this.channels.values()) channel.quiesceConnection();
    this.stopLiveness?.();
    this.stopLiveness = undefined;
    for (const off of this.transportSubscribers.splice(0)) off();
    const cleanups = [...this.channels.values()].map((channel) => channel.onConnectionClosed());
    this.settleTail = Promise.all(cleanups).then(() => undefined);
    await this.settleTail;
    this.hub.dropConnection(this);
  }

  private connectionFatal(code: string, wsCloseCode: number): void {
    if (this.closedFlag) return;
    this.sender.teardown();
    try {
      // §4.3 豁免（R2，SA2 #2）：收口 ERROR 直发 outbound——绕过 sender 额度判据
      // （非耗尽场景下行为与经 sender 等价——控制帧本就不受阻，仅差额度记账，
      // 而收口后额度无意义）；收口路径零递归。
      this.outbound.sendControl(connectionErrorFrame(code));
    } catch {
      // best-effort；framing 已不可信
    }
    this.closedFlag = true;
    this.state = 'closed';
    for (const channel of this.channels.values()) channel.quiesceConnection();
    if (!this.transport.closed) {
      this.transport.close(wsCloseCode, 'protocol-error');
    }
    void this.cleanupAll();
  }

  /**
   * 活性失联（临时类，协议 L524/§14/L42）：零 ERROR 帧——该错误码不在 connection
   * 错误注册表（§13.1 append-only，活性是 WS 级事件非 wire 协议事件，不得扩表），
   * close(1001) + 与 connectionFatal 同构的收口拓扑（ready → closed 直迁；hub 无
   * dial/backoff——§15.2，重连责任在 peer，peer 侧对 1001 分类为临时失败 → backoff）。
   */
  private onLivenessLost(): void {
    if (this.closedFlag) return; // 重入守卫（与 connectionFatal 同构）
    this.sender.teardown(); // §8：poll timer 清零（连接收口必经点）
    this.closedFlag = true; // 先置位：close 触发的 onClose 命中 onTransportClosed 早退
    this.state = 'closed';
    for (const channel of this.channels.values()) channel.quiesceConnection();
    if (!this.transport.closed) {
      this.transport.close(1001, 'pong-timeout');
    }
    void this.cleanupAll(); // stopLiveness + 摘 transport 监听 + channel cleanup + dropConnection
  }

  private sendControlChecked(message: ReplicationMessage): number {
    // §4.3：保留额度判据在 sender.sendControl 单点（收口路径直发 outbound 豁免）。
    return this.sender.sendControl(message);
  }

  /**
   * data 帧（UPDATE）发送路径（§6.3，issue #137）：sender.tryEmitData（水位观察② +
   * data 出队；序列号由 OutboundQueue.emit 单点分配）。
   */
  private sendData(namespaceId: string, bytes: Uint8Array): number {
    return this.sender.tryEmitData({
      kind: 'UPDATE',
      namespaceId,
      update: bytes,
    });
  }

  /** §4.2 鸭子类型读取 transport.bufferedAmount（属性形态；缺失/非法 → 0=无压力）。 */
  private readBufferedAmount(): number {
    try {
      const level = (this.transport as { readonly bufferedAmount?: unknown }).bufferedAmount;
      return typeof level === 'number' && Number.isFinite(level) ? level : 0;
    } catch {
      return 0; // seam 契约：transport 契约是「number 属性或缺失」；非契约形态 = 无压力
    }
  }

  /** §4.1 R3/#11（R2-2 修订）：出站 uint32 耗尽（实践不可达）→ 直接 close(1008)。
   *  framing 已不可信（§14 L391「否则直接 close」）：任何后续帧都只能以重复序列
   *  0xffffffff 发送 ⇒ 违反 §1 不变量 2 / §3 L54 严格递增；故零出站帧（原 best-effort
   *  ERROR 直发已删除——它正是重复序列号的唯一来源）。sender.teardown() 于 close 前
   *  （既有）；closedFlag/state/cleanupAll 收口拓扑不变。 */
  private onSequenceExhausted(transport: DuplexTransport): void {
    if (transport.closed) return;
    this.sender.teardown();
    if (!transport.closed) {
      transport.close(1008, 'sequence-exhausted');
    }
    this.closedFlag = true;
    this.state = 'closed';
    void this.cleanupAll();
  }
}

/** 连接级协议错误 → WS close code（§14 粗分类）。 */
function wsCloseCodeFor(code: string): number {
  if (code === 'FRAME_TOO_LARGE') return 1009;
  if (code === 'INSTANCE_IDENTITY_MISMATCH' || code === 'CONNECTION_POLICY_VIOLATION') return 1008;
  return 1002;
}

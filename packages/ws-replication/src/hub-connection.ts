/**
 * hub-connection —— `createHubReplication`：accept/HELLO/hub 连接 FSM + 帧分发
 * （§4.2/§6/§15.2）。per-(connection, namespace) 通道见 hub-namespace.ts。
 */
import type { DuplexTransport, HubUpgradeRequest, UpgradeIdentity } from './types.js';
import { selectProtocolVersion, type ReplicationMessage } from '@nomicore/replication-protocol';
import {
  decodeInbound,
  namespaceFieldViolation,
  OutboundQueue,
  connectionErrorFrame,
  namespaceErrorFrame,
  codecFieldLimits,
} from './frame-io.js';
import { startLiveness } from './liveness.js';
import { HubNamespaceChannel, type HubChannelHost } from './hub-namespace.js';
import { ConnectionSender } from './backpressure.js';
import { dispatchReplicationObserver, safeNow, stableConnectionCode } from './observer.js';
import type { NamespaceRegistry } from '@nomicore/namespace-registry';
import type {
  HubConnection,
  HubConnectionState,
  HubReplication,
  HubReplicationOptions,
  NamespaceAuthorizer,
  ReplicationClock,
  ReplicationObserver,
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
 * 早到帧缓冲的条数界（模块常数，非配置 knob——HELLO 是唯一合法早到帧，守规矩的
 * peer 恰发 1 帧，16 为充裕余量；累计字节由「单帧界 limits.maxFrameBytes × 条数界」
 * 导出：≤ 16×maxFrameBytes）。
 *
 * 权威指向（#172 双标注）：帧限拒绝对外语义（条数越界 → WS 1008 / 单帧超界 →
 * WS 1009，close reason 恒 'upgrade-frame-limit'）以 docs/protocols/
 * instance-replication-v1.md 为唯一 wire contract（§14 WS close code 分类）。
 * 历史证据（立法沿革）：phase5 issue #138 设计 §3.2 R2 A2（早到帧有界化）+
 * R3 N1（同步重放型 transport 句柄安全）——wiki/raw 非规范，仅沿革记录。
 */
const MAX_EARLY_FRAMES = 16;

/**
 * issue #190：两 upgrade 入口（accept 门 3 / acceptTrusted 门 2）共享的有界早到帧
 * admission 单点。
 *
 * 权威指向（#172 双标注）：帧限拒绝对外语义（1009/1008 close-code 分类 +
 * auth-upgrade-rejected reason 闭集 frame-too-large/early-frame-limit）以
 * docs/protocols/instance-replication-v1.md 为唯一权威（§14 wire close-code 分类；
 * §23 observer reason 闭集——local seam）。历史证据（立法沿革）：phase5 issue #138
 * 设计 §3.2 R2 A2（早到帧有界化）+ R3 N1（同步重放型 transport 句柄安全）——
 * wiki/raw 非规范，仅沿革记录。
 *
 * 纪律（帧到达同步段、push 之前执行）：
 * - 幂等拒绝早退：拒绝后重放循环内后续帧直接 return（零保留零重放）；
 * - 单帧界：bytes.byteLength > limits.maxFrameBytes → 拒绝（§14 → 1009）；
 * - 条数界：frames.length >= MAX_EARLY_FRAMES（第 17 帧）→ 拒绝（policy → 1008）；
 * - 拒绝效果 = 置标志 + close(…, 'upgrade-frame-limit') + emit 帧限 reason（经注入回调）；
 * - 摘监听统一延后到注册完成后的同步收口段（R3 N1：no-op 句柄使 detach 任意时刻安全）。
 *
 * 资源账：保留上界 = MAX_EARLY_FRAMES × maxFrameBytes + 常数数组开销。
 */
interface EarlyFrameAdmission {
  /** 有界缓冲（≤16 帧，每帧 ≤ maxFrameBytes）——分配时随连接注入构造尾重放。 */
  readonly frames: Uint8Array[];
  /** admission 拒绝已发生（帧限或外部 markRejected）——迟归/后续帧不复活。 */
  isRejected(): boolean;
  /** 外部标记拒绝（accept() auth timer 超时路径专用；无副作用——close/emit 由调用方路径自理）。 */
  markRejected(): void;
  /** 接纳窗口内对端已断（onClose 观察）。 */
  isEarlyClosed(): boolean;
  /** 幂等摘除两监听（重放期内调用 = 无害 no-op，R3 N1）。 */
  detach(): void;
}

function installEarlyFrameAdmission(
  transport: DuplexTransport,
  limits: ResolvedLimits,
  emitFrameLimitRejected: (reason: 'frame-too-large' | 'early-frame-limit') => void,
): EarlyFrameAdmission {
  const frames: Uint8Array[] = [];
  const state = { rejected: false, earlyClosed: false };
  // R3 N1（一行级，原样保留）：off 句柄 no-op 初始化——同步重放型 transport
  // （TcpTransport 实存形态：onMessage 注册即同步重放积压、重放先于 return/句柄赋值，
  // sa7-r2-transport:132-144）上，积压帧可在赋值语句完成前触发本 listener 的拒绝路径；
  // no-op 句柄使 detach 在【任意时刻】安全（重放期内调用 = 无害 no-op），注册完成后
  // 重赋真句柄。拒绝的【效果】（置标志 + close）在重放期内照常生效；【摘监听】统一
  // 延后到注册完成后的同步段收口——不再从 transport.onMessage(...) 调用点同步抛
  // TypeError（那会使 async accept 的 promise reject，违反 §8.2 硬不变量，且异常展开
  // 会流产重放循环——pendingFrames 已 splice、余帧丢失、transport 未按设计关闭）。
  let offMessage: () => void = () => {};
  let offClose: () => void = () => {};
  const detach = (): void => { offMessage(); offClose(); }; // 幂等（重复摘除零副作用）
  offMessage = transport.onMessage((bytes) => {
    if (state.rejected) return; // 已拒（重放循环内后续帧）——幂等早退
    if (bytes.byteLength > limits.maxFrameBytes) {
      // 单帧界：复用既有 limit（ADR 0010「最大 WS frame」）；§14 语义 → 1009
      state.rejected = true;
      closeAdmission(transport, 1009, 'upgrade-frame-limit'); // §3.4 守卫版 close
      emitFrameLimitRejected('frame-too-large');
      return;
    }
    if (frames.length >= MAX_EARLY_FRAMES) {
      // 条数界：第 17 帧即拒（policy）→ 1008
      state.rejected = true;
      closeAdmission(transport, 1008, 'upgrade-frame-limit');
      emitFrameLimitRejected('early-frame-limit');
      return;
    }
    frames.push(bytes); // 唯一保留点——三检全过才保留
  });
  offClose = transport.onClose(() => { state.earlyClosed = true; });
  return {
    frames,
    isRejected: () => state.rejected,
    markRejected: () => { state.rejected = true; },
    isEarlyClosed: () => state.earlyClosed,
    detach,
  };
}

/**
 * 拒绝路径 close 守卫（#190 唯一超越「原样收敛」的强化）：admission 拒绝时 transport
 * 契约外形态（close 抛出）不得经 onMessage(...) 调用点展开——那会流产同步重放循环
 * 且 reject 调用方 promise（acceptTrusted 唯一生产 caller 为 fire-and-forget，
 * apps/yjs-server/src/app.ts:274 → unhandledRejection 进程级风险）。守卫吞异常后
 * 拒绝效果已生效（标志已置、事件仍发），残局归 transport 所有者；与
 * apps/yjs-server/src/index.ts:364-368 safeCloseTransport「吞二次异常」同款纪律。
 * 契约内 transport（close 不抛，全部现存 fixture/生产 adapter）行为零变化。
 */
function closeAdmission(transport: DuplexTransport, code: number, reason: string): void {
  try {
    transport.close(code, reason);
  } catch {
    // transport 契约外形态（close 抛出）：拒绝效果已生效（标志已置、事件仍发）——
    // 残局归 transport 所有者；与 index.ts safeCloseTransport「吞二次异常」同款纪律。
  }
}

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
  readonly observer: ReplicationObserver | undefined;
  readonly clock: ReplicationClock | undefined;
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
      observer: options.observer,
      clock: options.clock,
      dropConnection: (connection) => this.dropConnection(connection),
    };
  }

  /** auth-upgrade-rejected 发射（pre-connection：无 connectionId 可挂——攻击点 #8 文档化形态）。 */
  private emitUpgradeRejected(
    reason:
      | 'hub-shutdown'
      | 'missing-token'
      | 'verifier-missing'
      | 'frame-too-large'
      | 'early-frame-limit'
      | 'auth-timeout'
      | 'invalid-credentials'
      | 'invalid-instance-id'
      | 'peer-disconnected',
  ): void {
    if (this.options.observer === undefined) return;
    dispatchReplicationObserver(this.options.observer, {
      type: 'auth-upgrade-rejected',
      side: 'hub',
      reason,
    });
  }

  async accept(transport: DuplexTransport, request?: HubUpgradeRequest): Promise<HubConnection | undefined> {
    // ── 门 0：停止接纳（生命周期门先于认证——已 close 的 hub 对新 upgrade 零工作）──
    if (this.closed) {
      transport.close(1001, 'hub-shutdown');
      this.emitUpgradeRejected('hub-shutdown');
      return undefined;
    }

    // ── 门 1：缺凭据（未传 request / 无 token 字段 / 非字符串 / 空串）→ 拒绝 ──
    const token = request?.token;
    if (typeof token !== 'string' || token.length === 0) {
      transport.close(1008, 'upgrade-unauthorized'); // 静态 reason，零 token/身份回显（AC-7）
      this.emitUpgradeRejected('missing-token');
      return undefined;
    }

    // ── 门 2：无认证器（类型必填 + §2.3 构造期 TypeError 后的纵深防御——JS 调用方绕过类型）
    //    「无认证器 = 全部 upgrade 拒绝」——fail-closed，绝不 fail-open ──
    if (typeof this.options.verifyToken !== 'function') {
      transport.close(1008, 'upgrade-unauthorized');
      this.emitUpgradeRejected('verifier-missing');
      return undefined;
    }

    // ── 门 3（#190 收敛：共享有界早到帧 admission——R2 A2 三检 + R3 N1 句柄纪律原样
    //    内聚于 installEarlyFrameAdmission，两 upgrade 入口同一机制单点）──
    const admission = installEarlyFrameAdmission(
      transport, this.limits, (reason) => this.emitUpgradeRejected(reason),
    );
    // 注册完成后的同步收口段（R3 N1）：同步重放期已拒（或注册期早断）→ 摘真句柄 + 直接拒绝
    // 返回。此刻 auth timer 尚未武装——零清理面；非重放路径两标志恒 false，本检查零开销通过。
    if (admission.isRejected() || admission.isEarlyClosed()) {
      admission.detach();
      return undefined;
    }
    // 认证等待封顶（显式政策，非沉默）：复用 timeouts.helloTimeoutMs——握手预算的既有载体，
    // 零新 knob；超时 = 拒绝分配（1008 静态 reason）。起止：门 3 武装 → 任何出口即清（§8.1 矩阵）。
    const authHandle = this.internals.timer.setTimeout(() => {
      admission.markRejected(); // 超时拒绝标记（迟归不复活）——close/emit 由本路径自理
      admission.detach(); // 此时句柄必为真值（注册已完成）
      if (!transport.closed) transport.close(1008, 'upgrade-timeout');
      this.emitUpgradeRejected('auth-timeout');
    }, this.timeouts.helloTimeoutMs);
    const clearAuthTimer = (): void => { this.internals.timer.clearTimeout(authHandle); };

    // ── 门 4：验证（accept 永不 reject——红灯 #5 零 unhandled rejection 的不变量）──
    let instanceId: unknown;
    try {
      const verdict = await this.options.verifyToken(token);
      clearAuthTimer(); // 首要动作：验证器已归，封顶 timer 必清
      if (admission.isRejected()) return undefined; // 缓冲期已拒（预算/超时）——迟归不复活
      if (verdict === null || typeof verdict !== 'object' || (verdict as { ok?: unknown }).ok !== true) {
        this.emitUpgradeRejected('invalid-credentials');
        return this.rejectUpgrade(transport, admission.detach); // {ok:false} 或畸形裁决
      }
      instanceId = (verdict as { instanceId: unknown }).instanceId;
    } catch {
      clearAuthTimer();
      if (admission.isRejected()) return undefined; // 超时在先、验证器抛错在后——仍 undefined
      this.emitUpgradeRejected('invalid-credentials');
      return this.rejectUpgrade(transport, admission.detach); // 验证器抛错
    }
    // A2-d 单帧超界变体的零宽窗口面（§3.1 竞态消除）：即时验证器（1 tick）下，首帧
    // 投递微任务与验证器续体在同一批次竞争——先让出一次微任务，使排队中的首帧先进入
    // 早到缓冲（超界 → 拒绝 + close(1009) / 条数界 → 拒绝 + close(1008)），
    // 门 5 再按拒绝标志（或 transport.closed）收口零分配——「帧到达同步段即拒、
    // 零分配」在验证器即时归的零宽窗口同样成立。
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    if (admission.isRejected()) return undefined; // 早到缓冲已拒（预算/超界）——验后迟拒的兜底复核
    // instanceId 文法违例（红灯 #4：'Bad-Id!'）→ 视为无效凭据
    if (!isValidInstanceId(instanceId)) {
      this.emitUpgradeRejected('invalid-instance-id');
      return this.rejectUpgrade(transport, admission.detach);
    }

    // ── 门 5：认证期间世界变化（R2 A4：先摘早到监听 → 再检查 → 再构造——顺序唯一基准 §3.3）──
    admission.detach();
    if (this.closed) {
      transport.close(1001, 'hub-shutdown');
      this.emitUpgradeRejected('hub-shutdown');
      return undefined;
    }
    if (admission.isEarlyClosed() || transport.closed) {
      this.emitUpgradeRejected('peer-disconnected'); // 对端已断：零分配、零 close 副作用
      return undefined;
    }

    // ── 分配：认证身份随连接注入；早到帧在构造尾部按序重放（§3.3）──
    const connection = new HubConnectionImpl(
      this.internals, transport, this.connectionCounter++, instanceId as string, admission.frames,
    );
    this.connectionList.push(connection);
    return connection;
  }

  async acceptTrusted(
    transport: DuplexTransport,
    identity: UpgradeIdentity,
  ): Promise<HubConnection | undefined> {
    if (this.closed) {
      transport.close(1001, 'hub-shutdown');
      this.emitUpgradeRejected('hub-shutdown');
      return undefined;
    }
    if (!isValidInstanceId(identity?.peerInstanceId)) {
      transport.close(1008, 'upgrade-unauthorized');
      this.emitUpgradeRejected('invalid-instance-id');
      return undefined;
    }
    // ── 门 2（#190 修复本体）：共享有界早到帧 admission（与 accept() 门 3 同一机制单点）──
    //    trusted 路径无验证器、无 auth timer（单同步段零 await）——注册到收口零 await，
    //    唯一可达拒绝源是同步重放期帧限拒绝。
    const admission = installEarlyFrameAdmission(
      transport, this.limits, (reason) => this.emitUpgradeRejected(reason),
    );
    // 注册后同步收口段（R3 N1 同款；检查序 = 拒绝原因优先级序——帧限拒绝自身会 close
    // transport（transport.closed === true），isRejected() 必须先于 transport.closed
    // 检查，否则拒绝被误分类为 peer-disconnected 并补发错误事件）：
    if (admission.isRejected()) {
      admission.detach();
      return undefined; // 帧限拒绝已在监听器内完成 close + observer 事件——零分配、零补发事件
    }
    if (this.closed) { // 防御性复查（单同步段内实际不可达）
      admission.detach();
      transport.close(1001, 'hub-shutdown');
      this.emitUpgradeRejected('hub-shutdown');
      return undefined;
    }
    if (admission.isEarlyClosed() || transport.closed) { // 对端已断：零 close 副作用
      admission.detach();
      this.emitUpgradeRejected('peer-disconnected');
      return undefined;
    }
    // 分配（§3.3 唯一顺序基准：先摘早到监听 → 检查 → 构造）
    admission.detach();
    const connection = new HubConnectionImpl(
      this.internals,
      transport,
      this.connectionCounter++,
      identity.peerInstanceId,
      admission.frames,
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

  /** issue #175（AC1/AC2/AC3/AC6/AC7）：认证/授权 Adapter 主动 reauth 事件 seam——按认证
   *  实例身份定位连接（绝不以 token 值为键），对每个匹配连接发送
   *  GOAWAY(REAUTH_REQUIRED, drainTimeoutMs>0) 并按 drain/deadline 规则以 WS 1001 收口。
   *  未知实例/已收口连接 → 无副作用 resolve；重复调用幂等。resolve 语义 =「请求已受理」
   *  （GOAWAY 同步冲刷 + deadline 同步武装后即归；等待 drain 结算的是 deadline 回调）。
   *  全路径零 throw（sendControl 的 framing 异常在 beginReauth 内 fail-closed 收口）。 */
  async requestReauth(instanceIdentity: string): Promise<void> {
    if (this.closed) return; // hub 已停机：迟到请求零副作用（AC6）
    for (const connection of [...this.connectionList]) { // 拷贝迭代——同 revoke：发起途中连接可能收口
      if (connection.authenticatedInstanceId !== instanceIdentity) continue; // 认证身份为权威键（AC3/AC7）
      connection.beginReauth(); // 同步发起：GOAWAY 同步冲刷 + deadline 同步武装
    }
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
  state: HubConnectionState = 'handshaking';
  peerInstanceId: string | undefined;
  /** 协议 §6.2 专用 observability id（HELLO 完成时捕获；此前 undefined——事件可选字段）。 */
  private connectionIdValue: string | undefined;
  private readonly outbound: OutboundQueue;
  /** 连接级发送调度（§6.3；每连接实例一个，随 transport 生命周期）。 */
  private readonly sender: ConnectionSender;
  private expectedSeq = 1;
  private readonly channels = new Map<string, HubNamespaceChannel>();
  private readonly helloHandle: unknown;
  private closedFlag = false;
  private settleTail: Promise<void> = Promise.resolve();
  /** issue #174：GOAWAY drain 窗口结算闸（resolve-only，永不 reject——R1 零 unhandled
   *  rejection；cleanupAll 尾部 finally 释放）。 */
  private drainActive = false;
  /** drain 的触发原因决定窗口内 OPEN 的 wire 语义：停机显式拒绝，reauth 静默丢弃。 */
  private drainReason: 'SERVER_SHUTTING_DOWN' | 'REAUTH_REQUIRED' | undefined;
  private drainDeadline: unknown | undefined;
  private drainDone: (() => void) | undefined;
  private drainTail: Promise<void> | undefined;
  private readonly channelHost: HubChannelHost;
  private readonly transportSubscribers: Array<() => void> = [];
  private stopLiveness: (() => void) | undefined;
  /** issue #175：reauth 已发起（连接级幂等守卫——重复 requestReauth 零重复 GOAWAY）。 */
  private reauthRequested = false;
  /** issue #175：reauth drain deadline 句柄（§8 timer 纪律：必须可清——stale fire 零副作用）。 */
  private reauthDeadlineHandle: unknown | undefined;

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
      ackTimeoutMs: hub.timeouts.ackTimeoutMs,
      readBufferedAmount: () => this.readBufferedAmount(),
      emitControl: (message) => this.outbound.sendControl(message),
      emitData: (message) => this.outbound.emit(message),
      facetOf: (namespaceId) => this.channels.get(namespaceId)?.sendFacet,
      isEmitAllowed: () => !this.closedFlag,
      onBackpressureExhausted: () => this.connectionFatal('CONNECTION_BACKPRESSURE', 1011),
      onSendPaused: (bufferedAmount) => this.emitWaterEvent('send-paused', bufferedAmount),
      onSendResumed: (bufferedAmount) => this.emitWaterEvent('send-resumed', bufferedAmount),
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
      onChannelSettled: (_namespaceId) => this.maybeFinishDrainEarly(),
      observerPresent: () => this.connectionObserver() !== undefined,
      emitObserver: (event) => dispatchReplicationObserver(this.connectionObserver(), event),
      connectionId: () => this.connectionIdValue,
      // B1：时钟采样经 safeNow 折叠（throw → dormant undefined，零协议外溢）
      now: () => (this.connectionObserver() !== undefined ? safeNow(() => hub.clock?.now()) : undefined),
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
    this.setConnState('closed');
    this.clearDrainHandles(); // §4.6 路径 1：窗口期公共 close = force-close 逃生舱
    this.sender.teardown(); // §8：poll timer 清零（连接收口必经点）
    for (const channel of this.channels.values()) channel.quiesceConnection();
    if (!this.transport.closed) {
      this.transport.close(code ?? 1001, reason ?? 'hub-close');
    }
    void this.cleanupAll();
  }

  /** §7.2：GOAWAY(SERVER_SHUTTING_DOWN, drain) 先行，随后真实 drain 窗口，窗口末
   *  close(1001)。handshaking 连接不发 GOAWAY（HELLO 未完成——对端 handshaking 门对
   *  非 HELLO_ACK 帧判 CONNECTION_POLICY_VIOLATION，peer-connection.ts:256-258；
   *  GOAWAY-before-ACK 反而是协议伤害）；直接 close(1001)。 */
  shutdownWithGoaway(drainMs: number): void {
    // §4.1 双门：窗口期重入会覆盖旧 drainTail/drainDone → 旧 hub.close() Promise
    // 永不结算（挂起泄漏）。无现实重入路径（唯一调用点受 HubReplicationImpl.closed
    // 门 + hub.close() 幂等保护），一行防御。
    if (this.closedFlag) return;
    // reauth drain 与 Hub shutdown 同 tick 竞态：停机优先，立即 force-close；不能把
    // reauth 窗误当作已启动的 SERVER_SHUTTING_DOWN drain 后直接返回。
    if (this.drainActive) {
      if (this.drainReason === 'REAUTH_REQUIRED') this.close(1001, 'hub-shutdown');
      return;
    }
    if (this.state === 'handshaking') {
      this.close(1001, 'hub-shutdown');
      return;
    }
    // ① 结算闸先于一切（HubReplication.close() 随后 map settle() 必须观察到 pending——
    //    R1 RED@2。resolve-only：不存在 reject 路径 → 零 floating rejection）。
    this.drainTail = new Promise<void>((resolve) => { this.drainDone = resolve; });
    this.drainActive = true;
    this.drainReason = 'SERVER_SHUTTING_DOWN';
    this.state = 'draining';
    try {
      this.outbound.sendControl({ // 直发豁免（既有注释理由保留：停机帧不允许
        kind: 'GOAWAY', // 被背压额度否决（sender.sendControl 在 paused 态有额度判据，耗尽即
        reasonCode: 'SERVER_SHUTTING_DOWN', // connectionFatal——停机帧不允许被否决）
        drainTimeoutMs: drainMs,
      });
    } catch {
      // framing 不可信 = 真降级路径（外部故障）：drain 无从宣告 → 直接收口
      this.finishDrain();
      return;
    }
    // ② deadline：与 GOAWAY 宣告值同源同值（drainMs 即 closeTimeoutMs，R1 断言锚）。
    //    零新 knob；经注入 timer（测试 fake scheduler / 生产 timer 同一 seam）。
    this.drainDeadline = this.hub.timer.setTimeout(() => {
      this.drainDeadline = undefined;
      this.finishDrain(); // 不等待任何完成事件（AC4/R1）
    }, drainMs);
    // ③ 提前完成初检：channels 空 = 无可收口对象 → 立即收口（GOAWAY 已同步上 wire，
    //    close 随后——帧序仍先于 close 事件，D4 同序锚）
    this.maybeFinishDrainEarly();
  }

  /** issue #175 AC1/AC2/AC4：定向 reauth——GOAWAY(REAUTH_REQUIRED, drain>0) + deadline 后
   *  1001 收口。幂等（reauthRequested）；迟到/竞态（closedFlag）零副作用；绝不携带凭据
   *  （AC7）。与 shutdownWithGoaway 的区别：后者发帧后立即 close（停机零 drain 窗），
   *  本方法真正等待 drain 窗（closeTimeoutMs 预算）再收口（§6.3 L149「之后发送方以
   *  WS 1001 关闭」）。 */
  beginReauth(): void {
    if (this.closedFlag || this.reauthRequested) return;
    this.reauthRequested = true;
    if (this.state === 'handshaking') {
      // GOAWAY-before-ACK 是协议伤害：peer handshaking 门对非 HELLO_ACK 帧判
      // CONNECTION_POLICY_VIOLATION（peer-connection.ts:277-279）——镜像 shutdownWithGoaway
      // 的 handshaking 分支：不发 GOAWAY，直接 close(1001)。该连接同样是匹配身份的连接
      // （其 Upgrade 已用待轮换凭据认证），关闭 = 正确的 reauth 语义。
      this.close(1001, 'hub-reauth');
      return;
    }
    this.drainActive = true;
    this.drainReason = 'REAUTH_REQUIRED';
    this.state = 'draining'; // 连接级可观测迁移；现有 namespace 到 deadline 前自然收口（§6.3 L148）
    try {
      this.outbound.sendControl({ // 收口路径直发豁免（同 shutdownWithGoaway/connectionFatal
        kind: 'GOAWAY', // 家族）：生命周期控制帧不允许被 data 背压额度否决
        reasonCode: 'REAUTH_REQUIRED', // 稳定安全码，零凭据字段（AC7）
        drainTimeoutMs: this.hub.timeouts.closeTimeoutMs, // drain 预算载体（§4.3，构造期验证 >0）
      });
    } catch {
      this.close(1001, 'hub-reauth'); // framing 不可信 → fail-closed 直接收口（:336-338 同款）
      return;
    }
    this.reauthDeadlineHandle = this.hub.timer.setTimeout(() => {
      this.reauthDeadlineHandle = undefined;
      if (this.closedFlag) return; // transport 断/hub.close 已收口 → stale fire 零副作用
      this.close(1001, 'hub-reauth'); // 既有收口拓扑：teardown + quiesce + close + cleanupAll + drop
    }, this.hub.timeouts.closeTimeoutMs);
  }

  /** §5.1 revoke 链第二层：HELLO 前无 channels → 天然 no-op。 */
  revokeNamespace(namespaceId: string): Promise<void> {
    const channel = this.channels.get(namespaceId);
    if (channel === undefined) return Promise.resolve();
    return channel.terminateUnauthorized();
  }

  /** 全部通道 cleanup 结算（HubReplication.close 等待）：drain 期 → 窗口末结算闸。 */
  settle(): Promise<void> {
    // 仅 SERVER_SHUTTING_DOWN 拥有 Hub close 结算闸。若连接此前已进入 reauth drain，
    // hub.close() 会 force-close，并应等待该次 cleanup，而不是一个从未武装的 drainTail。
    return this.drainReason === 'SERVER_SHUTTING_DOWN'
      ? (this.drainTail ?? this.settleTail)
      : this.settleAfterClose();
  }

  /** close()/onTransportClosed() 同步启动 cleanupAll 前，settleTail 仍可能是旧 resolved 值；
   * 让一个微任务后再读取，锁住 reauth→hub.close 同 tick 的结算竞态。 */
  private async settleAfterClose(): Promise<void> {
    await Promise.resolve();
    await this.settleTail;
  }

  /** issue #174 §4.3：drain 窗口提前完成观测——全部 channel 终态（或空）→ 立即收口。 */
  private maybeFinishDrainEarly(): void {
    if (!this.drainActive || this.closedFlag) return; // 非 drain 零开销；closedFlag 为第二道闸
    for (const channel of this.channels.values()) {
      const s = channel.state; // 公开字段，零新投影 API
      if (s !== 'closed' && s !== 'conflicted' && s !== 'failed') return;
    }
    this.finishDrain(); // 全部终态（或 channels 空）→ 提前收口
  }

  /** issue #174 §4.4：drain 收口点——deadline/提前完成/对端关三入口合流（幂等）。
   *  deadline fire 时【不检查任何 channel/apply 状态】——不等待未完成网络 ACK（AC4）。 */
  private finishDrain(): void {
    if (this.closedFlag || !this.drainActive) return;
    this.clearDrainHandles();
    this.close(1001, 'hub-shutdown'); // 既有收口原样复用（§4.6）
  }

  /** issue #174 §4.6-R2 单点：drain 复位 + deadline 句柄清理。幂等；四条连接终结路径共用。 */
  private clearDrainHandles(): void {
    this.drainActive = false;
    this.drainReason = undefined;
    if (this.drainDeadline !== undefined) {
      this.hub.timer.clearTimeout(this.drainDeadline); // §8 句柄必清纪律
      this.drainDeadline = undefined;
    }
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
    // GOAWAY drain 开始后仍需分发到 drain 专用门：它只保留自然 CLOSE/CLOSE_OK、
    // 已接纳 apply 的必要 ACK 与 ERROR 收口；其余 namespace frame 不再进入 channel。
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
    this.connectionIdValue = `${this.hub.instanceId}-conn-${this.connId}`;
    this.setConnState('ready');
    if (this.transport.ping !== undefined && this.transport.onPong !== undefined) {
      this.stopLiveness = startLiveness({
        timer: this.hub.timer,
        pingIntervalMs: this.hub.timeouts.pingIntervalMs,
        pongTimeoutMs: this.hub.timeouts.pongTimeoutMs,
        ping: this.transport.ping,
        onPong: this.transport.onPong,
        // issue #170 R1：pong 超时 = §18 L524 临时失败——close(1001)、零 ERROR 帧
        //（§13.1 注册表无 liveness 错误码；不得发明未注册码）。
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
    // GOAWAY drain 专用接纳门：namespace 不再接纳任何可能启动协议工作或进入 apply
    // 的 frame。CLOSE_NAMESPACE/CLOSE_OK 保留自然握手；ACK/ERROR 仅结算 drain 前已发送
    // 的工作。协议没有通用「draining」错误码，因此除 OPEN 复用既有 reconnect 错误外，
    // 其余新工作静默丢弃，避免发明错误码或把正常在途帧升级为连接 fatal。
    if (this.drainActive) {
      switch (message.kind) {
        case 'OPEN_NAMESPACE':
          // SERVER_SHUTTING_DOWN 保持 issue #174 的显式拒绝；REAUTH_REQUIRED 保持
          // issue #175 AC4 的零响应，避免在认证失效窗口泄露任何 namespace 观测。
          if (this.drainReason === 'SERVER_SHUTTING_DOWN') {
            try {
              this.sendControlChecked(
                namespaceErrorFrame('NAMESPACE_REOPEN_REQUIRES_RECONNECT', message.namespaceId, sequence),
              );
            } catch {
              // 连接已收口；忽略（withChannel 同款既有防御）
            }
          }
          return;
        case 'BOOTSTRAP_ACK':
        case 'SYNC_STEP1':
        case 'SYNC_STEP2':
        case 'RESYNC_REQUIRED':
        case 'UPDATE':
          return;
        default:
          break;
      }
    }
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
      if (this.connectionObserver() !== undefined) {
        dispatchReplicationObserver(this.connectionObserver(), {
          type: 'namespace-error',
          side: 'hub',
          ...(this.connectionIdValue !== undefined ? { connectionId: this.connectionIdValue } : {}),
          namespaceId,
          code: 'NAMESPACE_STATE_VIOLATION',
          direction: 'sent',
        });
      }
      return;
    }
    fn(channel);
  }

  private onTransportClosed(): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    this.setConnState('closed');
    this.clearDrainHandles(); // §4.6 路径 2：对端已关 = 窗口无服务对象
    this.sender.teardown();
    void this.cleanupAll();
  }

  private async cleanupAll(): Promise<void> {
    // issue #175：reauth deadline 句柄单点清理（覆盖 close/onTransportClosed/
    // connectionFatal/onSequenceExhausted 全部收口路径——§8.1 timer 纪律「句柄必须可清」）
    if (this.reauthDeadlineHandle !== undefined) {
      this.hub.timer.clearTimeout(this.reauthDeadlineHandle);
      this.reauthDeadlineHandle = undefined;
    }
    for (const channel of this.channels.values()) channel.quiesceConnection();
    this.stopLiveness?.();
    this.stopLiveness = undefined;
    for (const off of this.transportSubscribers.splice(0)) off();
    const cleanups = [...this.channels.values()].map((channel) => channel.onConnectionClosed());
    try {
      this.settleTail = Promise.all(cleanups).then(() => undefined);
      await this.settleTail;
      this.hub.dropConnection(this);
    } finally {
      // §4.6：drain 结算闸在清理链尾释放——即使清理异常，close() Promise 也绝不悬挂
      const done = this.drainDone;
      this.drainDone = undefined;
      done?.();
    }
  }

  private connectionFatal(code: string, wsCloseCode: number): void {
    if (this.closedFlag) return;
    this.clearDrainHandles(); // §4.6 路径 3（R2-M1）：drain 期 fatal 不留 timer 残留
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
    this.setConnState('closed');
    for (const channel of this.channels.values()) channel.quiesceConnection();
    if (!this.transport.closed) {
      this.transport.close(wsCloseCode, 'protocol-error');
    }
    if (this.connectionObserver() !== undefined) {
      dispatchReplicationObserver(this.connectionObserver(), {
        type: 'connection-failed',
        side: 'hub',
        ...(this.connectionIdValue !== undefined ? { connectionId: this.connectionIdValue } : {}),
        code: stableConnectionCode(code),
        wsCloseCode,
      });
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
    this.clearDrainHandles(); // §4.6 路径 4（R2-M1）：drain 期序列耗尽不留 timer 残留
    this.sender.teardown();
    if (!transport.closed) {
      transport.close(1008, 'sequence-exhausted');
    }
    this.closedFlag = true;
    this.setConnState('closed');
    if (this.connectionObserver() !== undefined) {
      dispatchReplicationObserver(this.connectionObserver(), {
        type: 'connection-failed',
        side: 'hub',
        ...(this.connectionIdValue !== undefined ? { connectionId: this.connectionIdValue } : {}),
        code: 'OUTBOUND_SEQUENCE_EXHAUSTED',
        wsCloseCode: 1008,
      });
    }
    void this.cleanupAll();
  }

  /** H10：hub 连接 FSM 唯一迁移点（原 5 处直赋收编；同态早退——边沿 exactly-once）。
   *  初始 'handshaking' 不发射（无迁移即无事件）。 */
  private setConnState(next: HubConnectionState): void {
    if (this.state === next) return;
    const from = this.state;
    this.state = next;
    if (this.connectionObserver() !== undefined) {
      dispatchReplicationObserver(this.connectionObserver(), {
        type: 'connection-state-changed',
        side: 'hub',
        ...(this.connectionIdValue !== undefined ? { connectionId: this.connectionIdValue } : {}),
        from,
        to: next,
      });
    }
  }

  private connectionObserver(): ReplicationObserver | undefined {
    return this.hub.observer;
  }

  /** H15：连接级水位边沿事件（send-paused / send-resumed）。 */
  private emitWaterEvent(
    type: 'send-paused' | 'send-resumed',
    bufferedAmount: number,
  ): void {
    const observer = this.connectionObserver();
    if (observer === undefined) return;
    dispatchReplicationObserver(observer, {
      type,
      side: 'hub',
      ...(this.connectionIdValue !== undefined ? { connectionId: this.connectionIdValue } : {}),
      bufferedAmount,
    });
  }
}

/** 连接级协议错误 → WS close code（§14 粗分类）。 */
function wsCloseCodeFor(code: string): number {
  if (code === 'FRAME_TOO_LARGE') return 1009;
  if (code === 'INSTANCE_IDENTITY_MISMATCH' || code === 'CONNECTION_POLICY_VIOLATION') return 1008;
  return 1002;
}

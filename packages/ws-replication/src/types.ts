/**
 * `@nomicore/ws-replication` 冻结公共契约类型（SA6 冻结，逐字段；实现不得增删改名）
 * + 包内私有结构类型。issue #175 SA6 冻结契约扩展（主动 reauthentication 生命周期）：
 * `HubReplication.requestReauth` / `PeerReplication.notifyAuthChanged`。公共行为以
 * `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` 与
 * `docs/protocols/instance-replication-v1.md` 为权威。
 *
 * 类型来源：`NamespaceOwner` / `NamespaceRegistry` / `ReplicationSession`
 * 自 `@nomicore/namespace-registry` import type。
 */
import type {
  NamespaceOwner,
  NamespaceRegistry,
  ReplicationSession,
} from '@nomicore/namespace-registry';
import type {
  ConnectionErrorCode,
  NamespaceErrorCode,
} from '@nomicore/replication-protocol';

// ═══════════════════════════ 冻结公共契约面（§2） ═══════════════════════════

export interface ReplicationLimits {
  readonly maxFrameBytes: number; // 8 MiB
  readonly maxBootstrapBytes: number; // 4 MiB
  readonly maxSyncDiffBytes: number; // 2 MiB
  readonly maxUpdateBytes: number; // 512 KiB
  readonly maxQueuedUpdateBytes: number; // 4 MiB
  readonly maxQueuedUpdateCount: number; // 256
  readonly maxInFlightUpdates: number; // 32
  readonly maxQueuedBytesPerConnection: number; // 8 MiB
  readonly lowWater: number; // 64 KiB
  readonly highWater: number; // 512 KiB
  readonly maxQueuedControlBytes: number; // 8 MiB——控制帧独立保留额度（协议 §17：未冲刷控制字节口径）；
                                          // 必须 ≥ maxBootstrapBytes + 协议开销（validate 启动期响亮验证）；
                                          // 耗尽 = CONNECTION_BACKPRESSURE（close 1011）
  /** issue #243（slice 2，ADR 0013 配置表）：协商 CAP_CHUNKED_UPDATE 后单笔 UPDATE 分块传输的
   *  发送上界 = 接收端首 chunk `totalBytes` 校验上界（D1：分配前校验）。4 MiB 缺省。 */
  readonly maxChunkedUpdateBytes: number; // 4 MiB
  /** issue #244（slice 3，ADR 0013 配置表）：单笔 chunked transfer 的 `chunkCount` 申报上界
   *  （首 chunk 分配前拒绝——count 维度与 maxChunkedUpdateBytes 的 totalBytes 维度构成二维
   *  声明上界）。64 缺省；约束 ≥ 1（validateLimits 启动期响亮校验，零运行时 clamp）。 */
  readonly maxChunksPerUpdate: number; // 64
  /** issue #244（slice 3，ADR 0013 配置表）：连接级每入站方向并发 assembly 上界（每
   *  (连接, 入站方向) 独立计数——多 ns 聚合内存上界 = 本值 × maxChunkedUpdateBytes）。
   *  4 缺省；约束 ≥ 1；超额 = 到达首 chunk 的 ns 收 `UPDATE_TRANSFER_VIOLATION`（简报显式
   *  裁决），其余并发 assembly 不受影响（ns 级违例、连接保持 ready）。 */
  readonly maxConcurrentAssembliesPerConnection: number; // 4
  /** issue #295（slice 1，ADR 0022 配置表）：单笔 chunked snapshot transfer 的 `totalBytes`
   *  申报上界（接收端首 chunk 分配前校验，kind=1）。4 MiB 缺省；约束
   *  `≤ maxChunksPerUpdate × maxUpdateBytes`（链②：调用方显式表达本键时启动期响亮校验，
   *  违例构造期 TypeError，零运行时 clamp）。 */
  readonly maxChunkedBootstrapBytes: number; // 4 MiB
  /** issue #295（slice 1，ADR 0022 配置表）：单笔 chunked sync-diff transfer 的 `totalBytes`
   *  申报上界（接收端首 chunk 分配前校验，kind=2）。4 MiB 缺省；约束同 bootstrap 链②
   *  （各自新键显式表达时响亮生效）。 */
  readonly maxChunkedSyncDiffBytes: number; // 4 MiB
}

export interface ReplicationTimeouts {
  readonly helloTimeoutMs: number; // 10_000
  readonly openTimeoutMs: number; // 5_000
  readonly bootstrapTimeoutMs: number; // 10_000
  readonly reconcileTimeoutMs: number; // 10_000
  /** Peer-owned periodic reconciliation cadence while a namespace is live. */
  readonly reconcileIntervalMs: number; // 300_000
  readonly closeTimeoutMs: number; // 5_000
  readonly ackTimeoutMs: number; // 10_000
  /** WS 级 ping 间隔（§18「心跳与失联判定」；§5.1）。缺省 30_000（安全缺省，ADR L165）。 */
  readonly pingIntervalMs?: number;
  /** pong 超时（PONG 未复 → 活性失联收口）。缺省 10_000；必须 < pingIntervalMs。 */
  readonly pongTimeoutMs?: number;
  /** issue #244（ADR 0013 配置表）：接收端 chunked transfer assembly 的进度滑动 deadline
   *  （每收一 chunk 重置；停滞超时 → 弃 partial + `RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED}`）。
   *  30_000 缺省；容器裁决 = timeouts（时长上界，与 ackTimeoutMs 同族；ADR 配置表未冻结
   *  容器）。约束 = 有限正整数（validateTimeouts 启动期响亮校验，零运行时 clamp）。 */
  readonly assemblyTimeoutMs?: number;
}

export interface ReplicationBackoff {
  readonly baseMs: number;
  readonly maxMs: number;
  readonly resetAfterMs: number;
}

/** 一 WS binary message = 一 frame（协议不变量 1）。 */
export interface DuplexTransport {
  send(bytes: Uint8Array): void;
  close(code?: number, reason?: string): void;
  readonly closed: boolean;
  onMessage(listener: (bytes: Uint8Array) => void): () => void;
  onClose(listener: (info: Readonly<{ code: number; reason: string }>) => void): () => void;
  /** socket 缓冲未冲刷字节（真实 WS bufferedAmount 语义；协议 §17 L492 观察点）。缺省视为 0。
   *  生产 adapter 必须暴露（G3.4 背压的前提面）——缺面 = 能力缺失的 dormant（正确降级）。 */
  readonly bufferedAmount?: number;
  /** WS 级活性（§18；协议不定义业务 PING/PONG frame——活性只走 WS 层）。缺省 = 无活性面。
   *  pong 关联契约（issue #170）：监听器接收 pong 载荷（RFC 6455 §5.5.2——pong 必须回显
   *  ping 载荷）。暴露本面的 transport/adapter 必须忠实透传回显载荷；无法透传载荷的实现
   * 不得暴露 onPong（缺面 → liveness dormant 是唯一合法降级形态）。 */
  ping?(data?: Uint8Array): void;
  onPong?(listener: (payload?: Uint8Array) => void): () => void;
}

/** HTTP Upgrade bearer-token 验证的受信产物（协议 §2：成功认证至少产生可信 Peer
 *  instanceId）。由宿主（切片 9 组合根）在 Upgrade 验证通过后传给 accept()。 */
export interface UpgradeIdentity {
  readonly peerInstanceId: string; // 文法 ^[a-z][a-z0-9-]{0,62}$（§6.1）
}

/** 注入延迟 seam：零 native timer（ADT 0009 依赖纪律）。 */
export interface ReplicationTimer {
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

export type NamespaceAuthorization =
  | Readonly<{
      ok: true;
      localOwner: NamespaceOwner;
      permissions: Readonly<{ read: boolean; submit: boolean }>;
    }>
  | Readonly<{ ok: false }>;

export type NamespaceAuthorizer = (
  instanceIdentity: string,
  namespaceId: string,
) => Promise<NamespaceAuthorization>;

/** 精确两字段，不上 wire（AC1 锚）。 */
export interface ReplicationTarget {
  readonly namespaceId: string;
  readonly localOwner: NamespaceOwner;
}

/** Hub upgrade 请求上下文（Bearer token 值；缺失 = 未提供凭据）。 */
export interface HubUpgradeRequest {
  readonly token?: string;
}

/** 升级认证器：token → 可信 Peer instanceId（文法 ^[a-z][a-z0-9-]{0,62}$）或拒绝。 */
export type PeerTokenVerifier = (
  token: string,
) => Promise<Readonly<{ ok: true; instanceId: string }> | Readonly<{ ok: false }>>;

export interface HubReplicationOptions {
  readonly instanceId: string;
  readonly registry: NamespaceRegistry;
  readonly authorize: NamespaceAuthorizer;
  readonly timer: ReplicationTimer;
  readonly verifyToken: PeerTokenVerifier;
  readonly limits?: Readonly<Partial<ReplicationLimits>>;
  readonly timeouts?: Readonly<Partial<ReplicationTimeouts>>;
  /** 结构化观测 seam（ADR 0010 L167）：同步回调；throw 由 dispatchReplicationObserver
   *  隔离（静默，绝不改变协议状态/关闭分类/Runtime 写入结果）。可选；缺省零事件。 */
  readonly observer?: ReplicationObserver;
  /** 单调时源（latency 观测专用；可选——缺省 = 全部 latency 字段 undefined（dormant）。
   *  禁止实现内部使用原生时钟（系统/高精度时间 API）fallback（零时钟读取不变量保持）。 */
  readonly clock?: ReplicationClock;
}

export interface HubReplication {
  accept(
    transport: DuplexTransport,
    request?: HubUpgradeRequest,
  ): Promise<HubConnection | undefined>;
  /** 宿主已在 HTTP Upgrade 前完成认证时的可信身份入口；不得再次调用 verifyToken。
   * 可选以保持结构实现兼容；需要 pre-upgrade HTTP 拒绝语义的宿主必须在装配期断言存在。 */
  acceptTrusted?(
    transport: DuplexTransport,
    identity: UpgradeIdentity,
  ): Promise<HubConnection | undefined>;
  readonly connections: readonly HubConnection[];
  revoke(instanceIdentity: string, namespaceId: string): Promise<void>;
  /** issue #175（AC1/AC2/AC3/AC6/AC7）：认证/授权 Adapter 主动 reauth 事件 seam——按
   *  认证实例身份定位连接（绝不以 token 值为键），对每个匹配连接发送
   *  GOAWAY(REAUTH_REQUIRED, drainTimeoutMs>0) 并按 drain/deadline 规则以 WS 1001 收口。
   *  未知实例/已收口连接 → 无副作用 resolve；重复调用幂等。 */
  requestReauth(instanceIdentity: string): Promise<void>;
  close(): Promise<void>;
}

export interface HubConnection {
  readonly state: 'handshaking' | 'ready' | 'draining' | 'closed';
  readonly peerInstanceId: string | undefined;
  close(code?: number, reason?: string): void;
}

export interface PeerReplicationOptions {
  readonly instanceId: string;
  readonly hubInstanceId: string;
  readonly registry: NamespaceRegistry;
  readonly dial: () => DuplexTransport;
  readonly timer: ReplicationTimer;
  readonly targets?: readonly ReplicationTarget[];
  readonly limits?: Readonly<Partial<ReplicationLimits>>;
  readonly timeouts?: Readonly<Partial<ReplicationTimeouts>>;
  readonly backoff?: Readonly<Partial<ReplicationBackoff>>;
  readonly random?: () => number; // 缺省 () => Math.random()
  /** issue #243（slice 2）：peer 侧 opt-in 旋钮——true 时 HELLO.optionalCapabilities 置位
   *  CAP_CHUNKED_UPDATE（发起协商；最终交集由 hub 在 onHello 单点计算，peer 逐字消费
   *  HELLO_ACK.selectedCapabilities——wire 协商位是唯一行为判据）。缺省 false = v1 逐字节。 */
  readonly chunkedUpdate?: boolean;
  /** 可观测性延迟 seam（§5.2）：恢复/重建的异步调度点。缺省 = 单次 queueMicrotask。 */
  readonly deferTask?: (task: () => void) => void;
  /** 结构化观测 seam（ADR 0010 L167）：同步回调；throw 由 dispatchReplicationObserver
   *  隔离（静默，绝不改变协议状态/关闭分类/Runtime 写入结果）。可选；缺省零事件。 */
  readonly observer?: ReplicationObserver;
  /** 单调时源（latency 观测专用；可选——缺省 = 全部 latency 字段 undefined（dormant）。
   *  禁止实现内部使用原生时钟（系统/高精度时间 API）fallback（零时钟读取不变量保持）。 */
  readonly clock?: ReplicationClock;
}

export interface PeerReplication {
  start(): void; // 幂等
  stop(): Promise<void>;
  addTarget(target: ReplicationTarget): void; // 幂等（ADR 0010 冻结名）
  removeTarget(namespaceId: string): Promise<void>; // 幂等；未知 nsId → 立即 resolve undefined
  getConnectionState(): PeerConnectionState;
  getNamespaceState(namespaceId: string): PeerNamespaceState | undefined; // 未知 → undefined
  /** issue #175（AC5）：token/config 显式变化通知缝——blocked 仅在明确变化后恢复拨号。 */
  notifyAuthChanged(): void;
}

export type PeerConnectionState =
  | 'stopped'
  | 'disconnected'
  | 'connecting'
  | 'handshaking'
  | 'ready'
  | 'draining'
  | 'backoff'
  | 'blocked';

export type PeerNamespaceState =
  | 'targeted'
  | 'opening'
  | 'bootstrapping'
  | 'reconciling'
  | 'live'
  | 'needs-resync'
  | 'closing'
  | 'closed'
  | 'conflicted'
  | 'failed'
  | 'disconnected';

// ═══════════════════════════ 观测 seam（ADR 0010 L167；append-only） ═══════════════════════════

/** 观测事件的 side 判别（hub 侧 / peer 侧）。 */
export type ReplicationObserverSide = 'hub' | 'peer';

/** hub 侧 channel 状态投影（与 HubChannelState 逐字面量一致；首次公共化，加性）。 */
export type HubNamespaceState =
  | 'opening'
  | 'bootstrapping'
  | 'reconciling'
  | 'live'
  | 'needs-resync'
  | 'closing'
  | 'closed'
  | 'conflicted'
  | 'failed';

/** hub 连接状态（与 `HubConnection['state']` 逐字面量一致）。 */
export type HubConnectionState = 'handshaking' | 'ready' | 'draining' | 'closed';

/** 连接域稳定码 = 协议 §13.1 注册表全 17 码（codec 同源 import，append-only）
 *  + 2 个本包登记的内部稳定码（无 wire 帧；协议文档 §23 登记）。 */
export type ReplicationObserverConnectionCode =
  | ConnectionErrorCode
  | 'PONG_TIMEOUT' // hub 活性失联（hub-connection 既有内部路径）
  | 'OUTBOUND_SEQUENCE_EXHAUSTED'; // 出站 uint32 耗尽（双端既有路径）

/** namespace 域稳定码 = 协议 §13.2 注册表全 20 码（codec 同源 import，append-only）
 *  + 1 个登记内部码。 */
export type ReplicationObserverNamespaceCode =
  | NamespaceErrorCode
  | 'IDENTITY_CHANGED'; // §11 fence 帧方向标注（消息名作稳定字符串）

/** `resync-required{cause:'send-failed'}` 的发送失败子因（issue #231，append-only 闭联合）：
 *  - `update-too-large`：单笔 UPDATE 载荷确定性超过 `maxUpdateBytes`（修业务体量/配置限制）；
 *  - `send-frame-rejected`：载荷未超限，但发送路径返回非正 sequence（连接/状态/背压/
 *    编码/发送异常折叠——修连接与背压状态机方向）。 */
export type ReplicationSendFailureReason = 'update-too-large' | 'send-frame-rejected';

/**
 * issue #256（append-only）：`namespace-failed` 的终态原因闭联合——Peer/Hub namespace
 * 进入 `failed` 终态的可诊断原因（本地零 wire 失败路径的唯一观测信号；wire 错误驱动
 * 路径与 `namespace-error` 互补——前者计终态边沿、后者计 wire 帧，聚合口径以本事件
 * 为准，`remote-error` 防止对端驱动的失败被误计为本地故障）。
 *
 * 成员语义：
 * - `open-timeout` / `bootstrap-timeout` / `reconcile-timeout`：§5.1 timer 族超时
 *   （§13.2 `NAMESPACE_TIMEOUT` retryable=reconnect 的本地映射；事件附 `timeoutMs` =
 *   配置上限——有限数值非时间戳）；
 * - `open-failed`：OPEN 阶段本地失败（registry.open throw/拒绝、未授权、身份/epoch
 *   不匹配、open 阶段 lease 状态读取异常）；
 * - `session-open-failed`：openReplicationSession throw/拒绝；
 * - `replication-disabled`：本地副本存在但 replication 未启用（open 或 bootstrap
 *   阶段 lease 状态重读检出；响亮终局）；
 * - `session-missing`：apply/encode 路径 session 缺失（生命周期竞态防御分支）；
 * - `protocol-violation`：本地检出的协议违例（入站帧状态/身份/权限违例、字段级超限；
 *   伴随 wire ERROR——`namespace-error{direction:'sent'}` 携带对应稳定码）；
 * - `apply-refused`：session/Registry 结构化拒绝（ok:false  refusal 映射族）；
 * - `apply-rejected`：apply/encode/import 内部异常（throw/rejection 映射族）；
 * - `remote-error`：对端 namespace ERROR 帧驱动的终局（与本地失败零重复计数）；
 * - `send-failed`：codec 编码面超限/本地出站超限（hub 快照超 maxBootstrapBytes——
 *   本端资源超限，非对端违例）/控制帧发送异常；
 * - `internal-error`：防御性兜底（理论不可达分支与未分类内部失败，含 bootstrap
 *   阶段 lease 重读异常）。
 */
export type ReplicationNamespaceFailedCause =
  | 'open-timeout'
  | 'bootstrap-timeout'
  | 'reconcile-timeout'
  | 'open-failed'
  | 'session-open-failed'
  | 'replication-disabled'
  | 'session-missing'
  | 'protocol-violation'
  | 'apply-refused'
  | 'apply-rejected'
  | 'remote-error'
  | 'send-failed'
  | 'internal-error';

/**
 * 【issue #287 / ADR 0018 §3–§4】`schema-rearm-failed` 的稳定双码**唯一真值源**
 * （append-only；数组即词表，闭联合由它派生——见下）。
 *
 * 两码是 namespace-runtime `errors.ts` 注册表的既有成员（ADR 0018 §3「errors.ts 注册表
 * append-only 追加双码」）；ws-replication 侧仅消费 `ReplicationSchemaRearmOutcome.code`
 * 投影（`@nomicore/namespace-registry` 类型面逐字同源），**不**新增错误码、不新增 wire
 * 语义——事件是既有 runtime fatal 事实的观测投影（协议 §23.1 第 24 型）。
 *
 * - `NSRT-FATAL-SCHEMA-REARM-INVALID`：re-arm 编译**结果失败**（Hub 提交前已编译成功的
 *   同一文本在 peer 侧失败 = 版本偏移/字节损坏；稳定 schema issue 摘要留在 Runtime
 *   `getStatus()` fatal 摘要，不进事件——事件字段遵守 §23.3 安全清单，无 schema 文本）；
 * - `NSRT-FATAL-SCHEMA-REARM-INTERNAL`：re-arm 结果联合之外的内部异常（compile throw /
 *   畸形 ok:true 等结构性不可达分支）。
 *
 * **判据面与词表同源（复审修正）**：`observer.ts` 的运行期白名单**复用本数组**
 * （`SCHEMA_REARM_CODES.some(...)`），不再手抄一份字面量——初版两处各写一份，`satisfies`
 * 只锁「白名单 ⊆ 类型」这一上界，删掉一词表成员后 `tsc` 与全包用例皆绿（实测），
 * 「新增码漏改即编译期红」因此单向、可被反向漂移绕过。以本数组为唯一真值源后，
 * 增删词表成员同时改变类型与判据，双向不可能再漂移。
 */
export const SCHEMA_REARM_CODES = [
  'NSRT-FATAL-SCHEMA-REARM-INVALID',
  'NSRT-FATAL-SCHEMA-REARM-INTERNAL',
] as const;

/**
 * `schema-rearm-failed.code` 的闭联合 = 词表数组的元素类型（同源派生，见
 * `SCHEMA_REARM_CODES`）。
 */
export type ReplicationObserverSchemaRearmCode = (typeof SCHEMA_REARM_CODES)[number];

/** 单调时源（latency 观测专用；ADR 0009 Clock capability 同形窄面）。
 *  可选注入：缺省 = 全部 latency 字段 undefined（dormant，协议 §17 L494 缺面先例）。
 *  生产组合根应注入并在装配期对缺省做响亮断言（issue #164 双层纪律）。禁止实现内部
 *  使用原生时钟（系统/高精度时间 API）fallback。返回值仅作差，不作为事件字段输出。 */
export interface ReplicationClock {
  readonly now: () => number;
}

/**
 * 结构化 observer seam 事件（ADR 0010 L167 最小观测面全量映射；36 型，append-only——
 * issue #238 追加第 21 型 event-loop-delay-sampled 及四事件面 sequence/四段字段；
 * issue #256 追加第 22 型 namespace-failed 及 cause/timeoutMs 字段；issue #287 追加
 * 第 23/24 型 schema-rearm-applied / schema-rearm-failed——协议 §23.1 schema re-arm 域，
 * ADR 0018 §4；issue #244 追加第 25 型 chunked-update-aborted 及
 * ChunkedUpdateAbortReason 词表；issue #245 追加第 26–28 型
 * chunked-update-sent/applied/acked——ADR 0013 L89–91 域键集逐字 + §23 side 信封；
 * 改道裁决（SA8 R21）：分块 transfer 的成功结算从普通族改道至 chunked 族；
 * issue #301 追加第 29–36 型 chunked-snapshot-{sent,applied,acked,aborted} 与
 * chunked-sync-{sent,applied,acked,aborted}——ADR 0022 L78–81 + 协议 §23.1 第 29–36 型行，
 * 字段集对齐既有 chunked-update-* 四型）。

 *
 * Safe-field 纪律（协议文档 §23）：字段类别 = 稳定字面量（type/side/direction/via/
 * reason/cause/terminalState/from/to/reasonCode/channelState/connectionState）、受控标识
 * （namespaceId 恒为 `^ns-[0-9a-f]{32}$`；connectionId 为协议 §6.2 专用 observability id，
 * 握手完成前 undefined）、稳定错误码（闭联合，未知折叠 INTERNAL_ERROR）、有限数值
 * （bytes/updateBytes/maxUpdateBytes/queuedUpdateCount/queuedUpdateBytes/inFlightCount/
 * bufferedAmount 是长度/计数/水位读数不是内容；latency 是差值非绝对时间戳）。
 * issue #287 追加字段的类别登记（复审修正：`updatedAt` **不是**既有类别，须显式登记）：
 * `semanticFingerprint` 属 §23.3 documented safe digest（`sha256:v1:<64 位小写 hex>`——
 * 与 `stateVector*Hash` 的 16 位 hex 同属 digest 族但文法不同）、`code` 属稳定错误码
 * 闭联合；`updatedAt` 为 issue #287 在 §23.3 新登记的**受控投影元数据字符串**（源 =
 * Hub 起源、经复制到达的 `META.schema.updatedAt` 原文，**非本地时钟读数**、peer 永不
 * 生成它；缺席恒 `null`）——登记前 §23.3 无此类别，且 §23.4「绝对时间戳不入事件」
 * 针对本地时钟读数，复制来的原始字符串不越界。
 *
 * 事件**不得**包含：token、owner 值、Yjs bytes（Uint8Array/ArrayBuffer/DataView）、
 * SCHEMA/ROOT 内容、原始 cause（Error/message/stack）、任意不受控高基数自由文本。
 */
/** issue #244：partial assembly 被丢弃的原因（ADR 0013 L92 observer seam 冻结六值闭集，
 *  与中止矩阵各行一一平行；append-only，只增不改）。safe-field：稳定字面量。 */
export type ChunkedUpdateAbortReason =
  | 'timeout'
  | 'shed'
  | 'resync-declared'
  | 'channel-teardown'
  | 'connection-teardown'
  | 'epoch-fence';

export type ReplicationObserverEvent =
  // ── 连接域（低频：仅真实迁移）──
  | {
      readonly type: 'connection-state-changed';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly from: PeerConnectionState | HubConnectionState;
      readonly to: PeerConnectionState | HubConnectionState;
    }
  | {
      readonly type: 'connection-backoff-scheduled';
      readonly side: 'peer';
      readonly attempt: number;
      readonly delayMs: number;
      readonly reason:
        | 'dial-failed'
        | 'socket-closed'
        | 'hello-timeout'
        | 'pong-timeout'
        | 'connection-backpressure'
        | 'goaway-closed'
        | 'goaway-retry-hint'
        // issue #254（append-only）：timer 族 namespace 超时收口后的恢复性重建
        | 'namespace-recovery';
    }
  | {
      readonly type: 'goaway-received';
      readonly side: 'peer';
      readonly connectionId?: string;
      readonly reasonCode:
        | 'SERVER_RESTARTING'
        | 'SERVER_SHUTTING_DOWN'
        | 'REAUTH_REQUIRED'
        | 'other';
      readonly drainTimeoutMs: number;
      readonly retryAfterMs?: number;
    }
  // ── channel 域（低频：仅真实迁移）──
  | {
      readonly type: 'channel-state-changed';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly from: PeerNamespaceState | HubNamespaceState;
      readonly to: PeerNamespaceState | HubNamespaceState;
    }
  // ── bootstrap / reconcile 字节（次数 = 事件计数）──
  | {
      readonly type: 'bootstrap-snapshot-sent';
      readonly side: 'hub';
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly bytes: number;
    }
  | {
      readonly type: 'bootstrap-imported';
      readonly side: 'peer';
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly bytes: number;
    }
  | {
      readonly type: 'sync-step2-sent';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly bytes: number; // 冻结：出向 Step2 diff 载荷长度
      /** issue #239 append-only：本 Step2 帧的 wire roundId 投影（§9.1–9.3；
       *  uint32、单连接代际内单调；sent/applied 关联键）。 */
      readonly syncRoundId: number;
      /** issue #239 append-only：=== bytes（encoded update 长度澄清字段；bytes 冻结不 rename）。 */
      readonly encodedUpdateBytes: number;
    }
  | {
      readonly type: 'sync-diff-applied';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly bytes: number; // 冻结
      readonly applyLatencyMs?: number; // 既有：clock 缺省时字段缺失
      /** issue #239 append-only：被 apply 的 Step2 帧的 wire roundId 投影。 */
      readonly syncRoundId: number;
      /** issue #239 append-only：=== bytes。 */
      readonly encodedUpdateBytes: number;
      /** ── 效果字段组（issue #239，单命运：两次 SV 捕获均成功才存在；捕获 throw 整组折叠缺失）── */
      /** 本侧「Step2 接纳（帧分发同步段）→ apply 结算」窗口内 state vector 是否推进
       *  （观测投影，非因果归因；窗口内其他写如实计入）。 */
      readonly stateVectorChanged?: boolean;
      /** 'changed' ⟺ stateVectorChanged === true。 */
      readonly applyEffect?: 'changed' | 'noop';
      /** documented safe digest（§23.3 注册：双泳道 FNV-1a-32，恒 16 位小写 hex）。 */
      readonly stateVectorBeforeHash?: string;
      readonly stateVectorAfterHash?: string;
      // ── issue #238（append-only）：帧级关联 + 四段分段观测 ──
      /** 触发帧 envelope sequence（SYNC_STEP2 帧；§23 关联粒度 = wire 帧）。 */
      readonly sequence: number;
      /** sequencer 排队等待（registry stageClock 注入时在场；全 present 或全缺席）。 */
      readonly queueWaitMs?: number;
      /** R1–R3 同步门 + R4 scratch 预演（同上在场纪律）。 */
      readonly protectedCheckMs?: number;
      /** R5 Y.applyUpdate 实时写入（同上）。 */
      readonly liveApplyMs?: number;
      /** R6 saveDoc 登记时长（同上）。 */
      readonly dirtyNotifyMs?: number;
    }
  // ── updates/bytes in/out + apply/ACK latency（每帧粒度）──
  | {
      readonly type: 'update-sent';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly bytes: number;
      // ── issue #238（append-only）──
      /** 出站帧 envelope sequence（合并帧 = 该合并帧的 sequence——与 bytes 合并后
       *  长度口径同帧级；关联粒度 = wire 帧，非业务写）。 */
      readonly sequence: number;
      /** 帧实际出队 − 帧内最旧业务项入队（发送方发送队列等待；clock 注入时在场）。
       *  判读：sendQueueMs 低 + ackLatencyMs 高 → 延迟不在发送方（区分 sender dispatch
       *  与线上传输；§5.4——跨进程减法只作 triage 近似，非精确段值）。 */
      readonly sendQueueMs?: number;
    }
  | {
      readonly type: 'update-applied';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly bytes: number;
      readonly applyLatencyMs?: number;
      // ── issue #238（append-only）：帧级关联 + 四段分段观测 ──
      /** 触发帧 envelope sequence（UPDATE 帧）。 */
      readonly sequence: number;
      /** sequencer 排队等待（registry stageClock 注入时在场；全 present 或全缺席）。 */
      readonly queueWaitMs?: number;
      /** R1–R3 同步门 + R4 scratch 预演（同上在场纪律）。 */
      readonly protectedCheckMs?: number;
      /** R5 Y.applyUpdate 实时写入（同上）。 */
      readonly liveApplyMs?: number;
      /** R6 saveDoc 登记时长（同上）。 */
      readonly dirtyNotifyMs?: number;
    }
  | {
      readonly type: 'update-acked';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly bytes: number;
      readonly ackLatencyMs?: number;
      // ── issue #238（append-only）──
      /** = wire UPDATE_ACK.ackedSequence（回指被 ACK 的 UPDATE 帧 sequence——与
       *  update-sent{sequence} / 对端 update-applied{sequence} 构成三事件面闭环）。 */
      readonly sequence: number;
    }
  | {
      // issue #231（append-only 第 20 型）：无 resync 声明的超限静默丢弃——队列非空时
      // F4 丢弃语义继续 drain（R2-1/D4），不声明 resync；本事件是该路径唯一的观测信号。
      // 计数不变量：每笔超限丢弃恰一事件——队列已空 → resync-required{update-too-large}
      // （伴随 resync 声明）；队列非空 → update-dropped{update-too-large}（不声明）。
      readonly type: 'update-dropped';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly namespaceId: string;
      /** 丢弃原因（当前唯一形态 = 单笔超 maxUpdateBytes；append-only 闭联合可扩）。 */
      readonly reason: 'update-too-large';
      /** 被丢弃帧载荷字节数（长度非内容）。 */
      readonly updateBytes: number;
      /** 配置上限（单笔 UPDATE 载荷）。 */
      readonly maxUpdateBytes: number;
      /** 发射时刻 channel 状态（本路径无状态迁移——恒为 live）。 */
      readonly channelState: PeerNamespaceState | HubNamespaceState;
      /** 发射时刻连接状态。 */
      readonly connectionState: PeerConnectionState | HubConnectionState;
      /** 丢弃时刻未发送队列残余项数（被丢弃项已出队，不计入）。 */
      readonly queuedUpdateCount: number;
      /** 丢弃时刻未发送队列残余字节（口径 = 各项原始字节之和）。 */
      readonly queuedUpdateBytes: number;
      /** 丢弃时刻在途窗口占用。 */
      readonly inFlightCount: number;
      /** socket 缓冲未冲刷字节——仅 adapter 暴露 `transport.bufferedAmount` 时存在。 */
      readonly bufferedAmount?: number;
    }
  | {
      readonly type: 'degraded-bypass-applied'; // peer 专属（hub 结构性不可 bypass）
      readonly side: 'peer';
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly bytes: number;
      // ── issue #238（append-only）：帧级关联；按既有纪律（§23.5）不携时延字段 ──
      /** 触发帧 envelope sequence（UPDATE 帧）。 */
      readonly sequence: number;
    }
  // ── auth / 背压 / resync ──
  | {
      readonly type: 'auth-upgrade-rejected';
      readonly side: 'hub';
      readonly reason:
        | 'hub-shutdown'
        | 'missing-token'
        | 'verifier-missing'
        | 'frame-too-large'
        | 'early-frame-limit'
        | 'auth-timeout'
        | 'invalid-credentials'
        | 'invalid-instance-id'
        | 'peer-disconnected';
    }
  | {
      readonly type: 'resync-required';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly cause:
        | 'queue-overflow'
        | 'send-failed'
        | 'connection-shed'
        | 'ack-timeout'
        | 'session-fanout-overflow'
        | 'remote-declared';
      // ── issue #231（append-only）：仅 cause==='send-failed' 时存在的一组字段——
      //    子因 + 失败时刻安全数值/状态上下文；其余 cause 全部缺省（字段不存在）。 ──
      /** 发送失败子因（闭联合；区分「确定性超限」与「发送路径拒绝」）。 */
      readonly reason?: ReplicationSendFailureReason;
      /** 触发帧载荷字节数（长度非内容）。 */
      readonly updateBytes?: number;
      /** 配置上限（单笔 UPDATE 载荷）。 */
      readonly maxUpdateBytes?: number;
      /** 事件发射时刻的 channel 状态（事件在决策落定后发射——恒为 needs-resync）。 */
      readonly channelState?: PeerNamespaceState | HubNamespaceState;
      /** 事件发射时刻的连接状态（判别「连接健康但帧被拒」的关键上下文）。 */
      readonly connectionState?: PeerConnectionState | HubConnectionState;
      /** 失败时刻未发送队列项数（丢弃前采样——被丢弃工作的体量）。 */
      readonly queuedUpdateCount?: number;
      /** 失败时刻未发送队列字节（口径 = 各项原始字节之和）。 */
      readonly queuedUpdateBytes?: number;
      /** 失败时刻在途窗口占用。 */
      readonly inFlightCount?: number;
      /** socket 缓冲未冲刷字节——仅 adapter 暴露 `transport.bufferedAmount` 时存在。 */
      readonly bufferedAmount?: number;
    }
  | {
      readonly type: 'send-paused';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly bufferedAmount: number;
    }
  | {
      readonly type: 'send-resumed';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly bufferedAmount: number;
    }
  // ── 稳定错误计数（code 闭联合）──
  | {
      readonly type: 'connection-failed';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly code: ReplicationObserverConnectionCode;
      readonly wsCloseCode: number;
    }
  | {
      readonly type: 'namespace-error';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly code: ReplicationObserverNamespaceCode;
      readonly direction: 'sent' | 'received';
      readonly terminalState?: 'failed' | 'conflicted' | 'closed';
    }
  | {
      // issue #256（append-only 第 22 型）：namespace 进入 `failed` 终态的可诊断原因。
      // 计数不变量：每次 failed 终态边沿恰一事件（finalize 的 isTerminal 早退保证
      // 终态不降级/不重复——closing 期/终态后的迟到 finalize 调用零事件）；事件在
      // 决策落定后发射（setState 之后），observer 缺省零事件零分配。
      // 与 namespace-error 互补不重复：本事件计终态边沿，namespace-error 计 wire
      // ERROR 帧——wire 驱动路径两者各一（指标聚合以本事件 cause 为准）；本地零 wire
      // 路径（timer 超时/本地 open/session 失败/local 终局）仅本事件。
      readonly type: 'namespace-failed';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly namespaceId: string;
      /** 终态原因（闭联合；语义见 ReplicationNamespaceFailedCause 注释）。 */
      readonly cause: ReplicationNamespaceFailedCause;
      /** 仅 timer 族 cause（open/bootstrap/reconcile-timeout）在场：到期的配置上限
       *  （openTimeoutMs/bootstrapTimeoutMs/reconcileTimeoutMs——有限数值，非时间戳）。 */
      readonly timeoutMs?: number;
    }
  | {
      readonly type: 'identity-conflicted';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly via: 'open-mismatch' | 'fence' | 'identity-changed-frame';
    }
  // ── issue #238（append-only 第 21 型；连接域低频采样事件）──
  | {
      /**
       * event-loop 停摆判别探针（H1）：delayMs = liveness ping timer 实际 fire 时刻 −
       * 计划 fire 时刻（同一注入单调时钟域作差）。事件循环被同步长任务阻塞时，到期
       * timer 的 fire 统一后延——delayMs 是该窗口内停摆的**下界信号**（含 timer 后端
       * 粒度噪声，非精确测量；判别依赖多窗口对比 + 与各同步段膨胀的相关性——§6 边界
       * 明示）。cadence = liveness pingIntervalMs（缺省 30 s；无新常驻 timer）。
       * gating：observer + clock + transport ping/onPong 三者齐备才武装；任一缺席 →
       * 零状态、零调度（dormant 等价）。
       */
      readonly type: 'event-loop-delay-sampled';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      /** 漂移下界信号（ms；差值非绝对时间戳）。 */
      readonly delayMs: number;
    }
  // ── issue #287（append-only 第 23/24 型；协议 §23.1 schema re-arm 域，peer 专属）──
  | {
      /**
       * peer apply 槽提交后 schema re-arm **安装成功**（ADR 0018 §1–§2/§4）。
       *
       * 计数不变量：每次 re-arm 成功安装恰一事件——含纯格式/注释差异的安装
       * （semanticFingerprint 不变但 `updatedAt` 照常推进：ADR 0017「每次提交都推进」
       * 对齐，不据 fingerprint 跳过）。多 Peer 滚动升级的「全部 Peer 已 applied」收敛
       * 判据读取点 = 本事件。
       *
       * 发射点：apply 槽提交后段安装完成、槽结算续体（§23.4 决策落定后发射纪律；
       * ACK/SYNC_APPLIED 语义因此附带「active schema 已同步切换」——应用方收到
       * ACK 后读 `getActiveSchema()` 即得确定性确认）。**注意**：槽内 R5.6 安装段在
       * `await notifyDirty()`（R6）**之前**，但本事件的发射点在 ws-replication 层
       * apply 结算续体（槽已结算、dirty 已登记）——即**晚于** R6；ADR 0018 §4
       * 「决策落定后发射」为权威口径。
       *
       * hub 侧结构性不可能：peer→hub 方向 protected-field 检查拒绝一切 SCHEMA 变化，
       * hub 的 apply 槽永不观测到 SCHEMA 投影变化 ⟹ 本事件恒 `side:'peer'`
       * （conformance 反向断言见 `ws-replication-issue287-schema-rearm.test.ts`）。
       */
      readonly type: 'schema-rearm-applied';
      readonly side: 'peer';
      readonly connectionId?: string;
      readonly namespaceId: string;
      /** 新安装 active schema 的语义指纹（§23.3 documented safe digest——带版本的
       *  domain separation 外显格式 `sha256:v1:<64 位小写 hex>`，非 schema 文本；
       *  §23.3 注册的定长 digest 族与 `stateVectorBeforeHash`（16 位小写 hex）**不同
       *  形态**，勿混用文法）。 */
      readonly semanticFingerprint: string;
      /** 投影自**复制来的** `META.schema`（peer 永不读本地时钟生成它——ADR 0018 §2 /
       *  ADR 0010 issue #282 修订第 3 条）；诚实缺席（legacy/损坏）为 `null`。 */
      readonly updatedAt: string | null;
    }
  | {
      /**
       * peer apply 槽提交后 schema re-arm **fatal 置位**（ADR 0018 §3–§4）。
       *
       * 计数不变量：每次 re-arm fatal 置位恰一事件——收口闩锁（`rearmFatalClosed`）为
       * 判据本身（通道关闭后的迟到 failed outcome 零新事件），不依赖「通道已关闭」这一
       * 外部性质。伴随行为 = **本 namespace channel 主动发
       * CLOSE_NAMESPACE → `closed` 终态**（诚实快速失败，双侧资源立即释放；重连不
       * 自动重开——恢复入口 = 显式 re-add / reset-replica / 进程重启，不产生重试循环）。
       *
       * schema 类根因告警路由以本事件为准：fatal 后的重开路径（显式 re-add / 新连接
       * 对 `failed` 终态的每连接恰一次重试）会出现
       * `namespace-failed{cause:'session-open-failed'}`（Runtime fatal 门拒绝
       * `openReplicationSession`；每连接恰一、安静终局），其语义**不含**「schema 编译失败」。
       *
       * 事件不含 schema 文本/ROOT/堆栈；稳定 schema issue 摘要留在 Runtime
       * `getStatus()` fatal 摘要（§23.3 安全清单：不允许 SCHEMA 内容与原始 cause）。
       */
      readonly type: 'schema-rearm-failed';
      readonly side: 'peer';
      readonly connectionId?: string;
      readonly namespaceId: string;
      /** ADR 0018 §3 稳定双码之一（schema re-arm 域**独立**闭联合成员，§23.3 明文不并入
       *  §23.2 namespace 域白名单；未知折叠 INTERNAL_ERROR 不适用——Runtime 侧产出面
       *  即本双码）。 */
      readonly code: ReplicationObserverSchemaRearmCode;
    }
  // ── issue #244（append-only 第 25 型；ADR 0013 observer seam reason 词表六值与中止
  //    矩阵一一平行——SA2 R11/R12 裁决：shed/epoch-fence 行接线并入本切片，side 为
  //    §23 结构信封字段（22 型惯例），域键集逐字 ADR L92（无 connectionId））──
  | {
      /**
       * 分块 transfer 的 partial assembly 被丢弃（中止/违例清理矩阵的观测投影）。
       * 发射端 = 丢弃 partial 的一端（接收方语义——timeout 停滞方弃置、shed/RESYNC
       * 声明/CLOSE 收口/断线/epoch fence 的实际处置方）；receivedChunks/receivedBytes =
       * 已收进度（长度/计数 safe-field，非内容）。
       *
       * 计数不变量：每笔 busy→aborted 边沿恰一事件（busy 守卫——重复 clear/多清理挂点
       * 汇合至多一事件；fire 后竞态 clear 由 stale 零副作用吸收）；事件在决策落定后发射。
       * 终局失败族（违例/远端 ERROR/revoke → failed）不发本事件——该行的可观测信号是
       * `namespace-error`/`namespace-failed`（互补不重复）；`conflicted` 族 fence 终局
       * 经本事件登记（ADR 词表行）。observer 缺省 = 零事件构造、零快照读取。
       */
      readonly type: 'chunked-update-aborted';
      readonly side: ReplicationObserverSide;
      readonly namespaceId: string;
      readonly transferId: number;
      readonly reason: ChunkedUpdateAbortReason;
      readonly receivedChunks: number;
      readonly receivedBytes: number;
    }
  // ── issue #245（append-only 第 26–28 型；ADR 0013 L89–91 域键集逐字 + §23 side 信封。
  //    R22 裁决：无 sequence/四段差值/效果组/sendQueueMs——chunked 族关联键 = transferId
  //    （sent/aborted）+ wire UPDATE_CHUNK 帧申报；扩展 = append-only 键追加，须显式
  //    裁决 + 协议 §23.1 登记。键集冻结语义：connectionId 握手后在场；sent 恒无任何
  //    latency 键（clock 在场也不加）；applied/acked 的 latency 键随 clock 在场/缺省
  //    两态（无 clock 整键缺失，非 undefined 值——§23.4）。计数不变量：每笔完成的
  //    transfer → sent 恰一（末 chunk 出站时刻，非逐 chunk）＋（发送端）acked 恰一（单
  //    ACK = 末 chunk 帧序）；每笔组装 apply 成功 → 互斥四形态恰一（UPDATE_CHUNK 来源 ∧
  //    非 Step2 ∧ 非 degraded——degraded 期维持 degraded-bypass-applied 胜出，R23）。
  //    中止 transfer 结构性不可达任一成功结算点（与 aborted 互斥）。事件在决策落定后
  //    发射；observer 缺省 = 零事件构造、零投影读取、零时钟调用）──
  | {
      /**
       * 分块 transfer 完成出站（末 chunk 帧已交宿主发送且注册在途）恰一；中间 chunk
       * 零事件（非逐 chunk、非 transfer 起始发射——ADR L89「完成出站时一次」）。
       * 发射端 = 发送侧 facet；改道：本结算点不再发普通族 update-sent（R21）。
       * 字段 = wire UPDATE_CHUNK 申报投影：transferId/chunkCount/totalBytes（长度/计数
       * safe-field，非内容；无 sequence——帧级关联键为普通族专属，DD1 排除）。
       */
      readonly type: 'chunked-update-sent';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly transferId: number;
      readonly chunkCount: number;
      readonly totalBytes: number;
    }
  | {
      /**
       * 组装 apply 成功结算——apply 成功路径互斥规则第四形态：每笔成功 apply 恰一事件
       * （UPDATE_CHUNK 来源 ∧ 非 Step2 ∧ 非 degraded；degraded 判别先于本型，R23 裁决）。
       * 发射端 = 接收侧 facet；改道：本结算点不再发普通族 update-applied（R21）。
       * bytes === wire 声明 totalBytes（assembler Σbytes 精确核对不变量——长度非内容）；
       * chunkCount = wire 申报。无 transferId/sequence/stages 键（DD1 排除）。
       */
      readonly type: 'chunked-update-applied';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly bytes: number;
      readonly chunkCount: number;
      readonly applyLatencyMs?: number;
    }
  | {
      /**
       * 末 chunk 帧序的单 ACK 收妥结算（发送侧；zombie 迟到 ACK 零事件——弃置 transfer
       * 零成功型事件，与 aborted 互斥不变量一致）。改道：本结算点不再发普通族
       * update-acked（R21）。bytes = wire totalBytes（inFlight 记账总长）；ackLatencyMs
       * = ACK 处理时刻 − 末 chunk 出站时刻（clock 缺省/无 observer 时字段缺失）。
       */
      readonly type: 'chunked-update-acked';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly bytes: number;
      readonly ackLatencyMs?: number;

    }
  // ── issue #301（#295 切片 3；append-only 第 29–36 型；ADR 0022 L78–81 + 协议 §23.1
  //    第 29–36 型行。字段集对齐既有 chunked-update-* 四型；side 信封按 §23.1 行取值：
  //    snapshot 成功三型为字面量（snapshot 恒 hub→peer，对齐 bootstrap-snapshot-sent/
  //    bootstrap-imported 先例）；sync 四型与两 aborted 型为 ReplicationObserverSide
  //    （hub/peer 双侧可达，对齐 chunked-update-aborted 先例——hub 侧 kind=1 入站结构
  //    不可达属防御面，类型不收紧）。键集冻结：sent 恒无任何 latency 键；applied 无
  //    transferId/sequence/四段差值/效果组键；acked 无 sequence/syncRoundId；aborted 无
  //    connectionId。reason 复用既有 ChunkedUpdateAbortReason 闭联合（零新词）。计数
  //    不变量与 kind=0 先例逐字同构：sent/acked 每笔恰一、applied 六选一互斥、aborted
  //    busy→aborted 边沿恰一且与成功型互斥；发射全部在决策落定后、observer 缺省零构造）──
  | {
      /**
       * 分块 snapshot transfer（`kind=1`）完成出站时恰一（末 chunk 结算记账点），非逐
       * chunk。改道（R21 平移）：该结算点不再发普通族 `bootstrap-snapshot-sent`（窗口内
       * 归零）。字段 = wire UPDATE_CHUNK 申报投影（长度/计数 safe-field，非内容）。
       */
      readonly type: 'chunked-snapshot-sent';
      readonly side: 'hub';
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly transferId: number;
      readonly chunkCount: number;
      readonly totalBytes: number;
    }
  | {
      /**
       * `kind=1` 组装收齐的排他复制导入成功结算（peer 侧）。改道：该结算点不再发普通族
       * `bootstrap-imported`（窗口内归零）。bytes === wire 声明 totalBytes（assembler
       * Σbytes 精确核对不变量——长度非内容）；无 transferId/sequence/效果组键。
       */
      readonly type: 'chunked-snapshot-applied';
      readonly side: 'peer';
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly bytes: number;
      readonly chunkCount: number;
      readonly applyLatencyMs?: number;
    }
  | {
      /**
       * 末 chunk 帧序的单 BOOTSTRAP_ACK 收妥结算（发送侧 hub）；普通族无对应事件——本型
       * 为分块路径独有观测点，无改道。zombie 迟到 ACK / 单帧路径零事件。bytes = wire
       * totalBytes；ackLatencyMs = ACK 处理时刻 − 末 chunk 出站时刻（clock 缺省/无
       * observer 时整键缺失）。键集冻结：无 sequence/transferId/chunkCount 键。
       */
      readonly type: 'chunked-snapshot-acked';
      readonly side: 'hub';
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly bytes: number;
      readonly ackLatencyMs?: number;
    }
  | {
      /**
       * 分块 snapshot transfer（`kind=1`）的 partial assembly 被丢弃（abort 矩阵观测
       * 投影；纪律与 `chunked-update-aborted` 逐字同构）。终局失败族
       * （`SNAPSHOT_TRANSFER_*`/`BOOTSTRAP_FAILED`）不发本事件；无 connectionId 键。
       */
      readonly type: 'chunked-snapshot-aborted';
      readonly side: ReplicationObserverSide;
      readonly namespaceId: string;
      readonly transferId: number;
      readonly reason: ChunkedUpdateAbortReason;
      readonly receivedChunks: number;
      readonly receivedBytes: number;
    }
  | {
      /**
       * 分块 sync-diff transfer（`kind=2`）完成出站时恰一。改道：该结算点不再发普通族
       * `sync-step2-sent`（窗口内归零）。syncRoundId = 本 transfer 所属 round 的 wire
       * 投影（§9.1–9.3；uint32，issue #239 safe-field 先例）。恒无 latency 键。
       */
      readonly type: 'chunked-sync-sent';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly transferId: number;
      readonly chunkCount: number;
      readonly totalBytes: number;
      readonly syncRoundId: number;
    }
  | {
      /**
       * `kind=2` 组装收齐的 Step2 diff apply 成功结算。改道：该结算点不再发普通族
       * `sync-diff-applied`（窗口内归零）。bytes === wire totalBytes；syncRoundId =
       * 被 apply transfer 的 roundId 投影；无 transferId/sequence/效果组键
       * （degraded 判别先于本型胜出，R23 裁决不变）。
       */
      readonly type: 'chunked-sync-applied';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly bytes: number;
      readonly chunkCount: number;
      readonly syncRoundId: number;
      readonly applyLatencyMs?: number;
    }
  | {
      /**
       * 末 chunk 帧序的单 SYNC_APPLIED 收妥结算（发送侧）；普通族无对应事件——本型为
       * 分块路径独有观测点，无改道。被拒/迟到 ACK（quiet 域）零事件。键集冻结：无
       * sequence/syncRoundId/transferId/chunkCount 键。
       */
      readonly type: 'chunked-sync-acked';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly bytes: number;
      readonly ackLatencyMs?: number;
    }
  | {
      /**
       * 分块 sync-diff transfer（`kind=2`）的 partial assembly 被丢弃（abort 矩阵观测
       * 投影；纪律与 `chunked-update-aborted` 逐字同构）。终局失败族（`SYNC_TRANSFER_*`）
       * 不发本事件；无 connectionId 键。
       */
      readonly type: 'chunked-sync-aborted';
      readonly side: ReplicationObserverSide;
      readonly namespaceId: string;
      readonly transferId: number;
      readonly reason: ChunkedUpdateAbortReason;
      readonly receivedChunks: number;
      readonly receivedBytes: number;
    };

/**
 * 结构化 observer seam（ADR 0010 L167）：同步回调，事件 = 判别联合（§上文）。
 * throw 由 dispatchReplicationObserver 隔离（静默，绝不改变协议状态/关闭分类/
 * Runtime 写入结果——AC #3）。可选注入；缺省零事件。返回 Promise 会被忽略（异步
 * reject 属宿主域 unhandled）。事件对象不可变（类型层 readonly；mutate 属 Adapter 违约）。
 */
export type ReplicationObserver = (event: ReplicationObserverEvent) => void;

// ═══════════════════════════ 包内私有结构类型 ═══════════════════════════

/** issue #231：send 失败/超限丢弃的通道侧失败明细（observer 诊断载荷；包内私有——
 *  公共契约面只有事件字段，本结构不出 index.ts）。
 *  safe-field：全部稳定字面量/有限数值——零 Yjs bytes、零异常原文、零身份字段。
 *  计数口径 = 失败时刻采样（丢弃前）——描述被丢弃/在途工作的真实体量。 */
export interface UpdateSendFailureDetail {
  readonly reason: ReplicationSendFailureReason;
  readonly updateBytes: number;
  readonly maxUpdateBytes: number;
  readonly queuedUpdateCount: number;
  readonly queuedUpdateBytes: number;
  readonly inFlightCount: number;
}

/** 解析后的合并配置（构造期校验后的不可变值）。 */
export interface ResolvedLimits extends ReplicationLimits {}
export interface ResolvedTimeouts extends ReplicationTimeouts {
  readonly pingIntervalMs: number; // resolve 后必填（DEFAULT 提供缺省；§5.1）
  readonly pongTimeoutMs: number;
  readonly assemblyTimeoutMs: number; // issue #244：resolve 后必填（DEFAULT 提供缺省）
}
export interface ResolvedBackoff extends ReplicationBackoff {}

/** 本包从 replication-protocol 借用的 codec 字段级限额。 */
export interface CodecFieldLimits {
  readonly maxUpdateBytes: number;
  readonly maxBootstrapBytes: number;
  readonly maxSyncDiffBytes: number;
}

/** 命名空间状态机每侧的 round 记账（§9）。 */
export interface RoundState {
  currentRound: number; // peer：本方发起的当前 round；hub：最近接收的 peer Step1 round
  hubStep1Received: boolean; // （peer）本 round 已收 hub Step1
  hubStep1Seq: number | undefined; // 收到的 hub Step1 帧序
  ownStep1Seq: number | undefined; // 本端 Step1 帧序（校验对端 Step2.relatedStep1Sequence）
  ownStep2Seq: number | undefined; // 本端 Step2 帧序（校验对端 SYNC_APPLIED.ackedSequence）
  receivedStep2: boolean; // 已收对端 Step2（防重复）
  remoteDiffAppliedLocally: boolean; // 已 apply 对端 Step2 且已发 SYNC_APPLIED
  localDiffAppliedByRemote: boolean; // 已收对端对本端 Step2 的 SYNC_APPLIED
}

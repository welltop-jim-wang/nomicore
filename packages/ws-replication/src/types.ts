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

/** 单调时源（latency 观测专用；ADR 0009 Clock capability 同形窄面）。
 *  可选注入：缺省 = 全部 latency 字段 undefined（dormant，协议 §17 L494 缺面先例）。
 *  生产组合根应注入并在装配期对缺省做响亮断言（issue #164 双层纪律）。禁止实现内部
 *  使用原生时钟（系统/高精度时间 API）fallback。返回值仅作差，不作为事件字段输出。 */
export interface ReplicationClock {
  readonly now: () => number;
}

/**
 * 结构化 observer seam 事件（ADR 0010 L167 最小观测面全量映射；19 型，append-only）。
 *
 * Safe-field 纪律（协议文档 §23）：字段类别 = 稳定字面量（type/side/direction/via/
 * reason/cause/terminalState/from/to/reasonCode）、受控标识（namespaceId 恒为
 * `^ns-[0-9a-f]{32}$`；connectionId 为协议 §6.2 专用 observability id，握手完成前
 * undefined）、稳定错误码（闭联合，未知折叠 INTERNAL_ERROR）、有限数值（bytes 是长度
 * 不是内容；latency 是差值非绝对时间戳）。
 *
 * 事件**不得**包含：token、owner 值、Yjs bytes（Uint8Array/ArrayBuffer/DataView）、
 * SCHEMA/ROOT 内容、原始 cause（Error/message/stack）、任意不受控高基数自由文本。
 */
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
        | 'goaway-retry-hint';
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
      readonly bytes: number;
    }
  | {
      readonly type: 'sync-diff-applied';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly bytes: number;
      readonly applyLatencyMs?: number; // clock 缺省时 undefined
    }
  // ── updates/bytes in/out + apply/ACK latency（每帧粒度）──
  | {
      readonly type: 'update-sent';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly bytes: number;
    }
  | {
      readonly type: 'update-applied';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly bytes: number;
      readonly applyLatencyMs?: number;
    }
  | {
      readonly type: 'update-acked';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly bytes: number;
      readonly ackLatencyMs?: number;
    }
  | {
      readonly type: 'degraded-bypass-applied'; // peer 专属（hub 结构性不可 bypass）
      readonly side: 'peer';
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly bytes: number;
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
      readonly type: 'identity-conflicted';
      readonly side: ReplicationObserverSide;
      readonly connectionId?: string;
      readonly namespaceId: string;
      readonly via: 'open-mismatch' | 'fence' | 'identity-changed-frame';
    };

/**
 * 结构化 observer seam（ADR 0010 L167）：同步回调，事件 = 判别联合（§上文）。
 * throw 由 dispatchReplicationObserver 隔离（静默，绝不改变协议状态/关闭分类/
 * Runtime 写入结果——AC #3）。可选注入；缺省零事件。返回 Promise 会被忽略（异步
 * reject 属宿主域 unhandled）。事件对象不可变（类型层 readonly；mutate 属 Adapter 违约）。
 */
export type ReplicationObserver = (event: ReplicationObserverEvent) => void;

// ═══════════════════════════ 包内私有结构类型 ═══════════════════════════

/** 解析后的合并配置（构造期校验后的不可变值）。 */
export interface ResolvedLimits extends ReplicationLimits {}
export interface ResolvedTimeouts extends ReplicationTimeouts {
  readonly pingIntervalMs: number; // resolve 后必填（DEFAULT 提供缺省；§5.1）
  readonly pongTimeoutMs: number;
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

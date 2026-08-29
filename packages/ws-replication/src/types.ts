/**
 * `@nomicore/ws-replication` 冻结公共契约类型（SA6 冻结，逐字段；实现不得增删改名）
 * + 包内私有结构类型。
 *
 * 设计：wiki/raw/task_phase5-ws-namespace-sync_design.md §2（冻结契约面）。
 * 类型来源：`NamespaceOwner` / `NamespaceRegistry` / `ReplicationSession` /
 * `NamespaceLease` 自 `@nomicore/namespace-registry` import type。
 */
import type {
  NamespaceLease,
  NamespaceOwner,
  NamespaceRegistry,
  ReplicationSession,
} from '@nomicore/namespace-registry';

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
  readonly controlReserveBytes: number; // 64 KiB——control 帧独立保留额度（§17 L490）；耗尽 = CONNECTION_BACKPRESSURE
}

export interface ReplicationTimeouts {
  readonly helloTimeoutMs: number; // 10_000
  readonly openTimeoutMs: number; // 5_000
  readonly bootstrapTimeoutMs: number; // 10_000
  readonly reconcileTimeoutMs: number; // 10_000
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
  /** WS 级活性（§18；协议不定义业务 PING/PONG frame——活性只走 WS 层）。缺省 = 无活性面。 */
  ping?(data?: Uint8Array): void;
  onPong?(listener: () => void): () => void;
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
}

export interface HubReplication {
  accept(
    transport: DuplexTransport,
    request?: HubUpgradeRequest,
  ): Promise<HubConnection | undefined>;
  readonly connections: readonly HubConnection[];
  revoke(instanceIdentity: string, namespaceId: string): Promise<void>;
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
}

export interface PeerReplication {
  start(): void; // 幂等
  stop(): Promise<void>;
  addTarget(target: ReplicationTarget): void; // 幂等（ADR 0010 冻结名）
  removeTarget(namespaceId: string): Promise<void>; // 幂等；未知 nsId → 立即 resolve undefined
  getConnectionState(): PeerConnectionState;
  getNamespaceState(namespaceId: string): PeerNamespaceState | undefined; // 未知 → undefined
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

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
}

export interface ReplicationTimeouts {
  readonly helloTimeoutMs: number; // 10_000
  readonly openTimeoutMs: number; // 5_000
  readonly bootstrapTimeoutMs: number; // 10_000
  readonly reconcileTimeoutMs: number; // 10_000
  readonly closeTimeoutMs: number; // 5_000
  readonly ackTimeoutMs: number; // 10_000
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

export interface HubReplicationOptions {
  readonly instanceId: string;
  readonly registry: NamespaceRegistry;
  readonly authorize: NamespaceAuthorizer;
  readonly timer: ReplicationTimer;
  readonly limits?: Readonly<Partial<ReplicationLimits>>;
  readonly timeouts?: Readonly<Partial<ReplicationTimeouts>>;
}

export interface HubReplication {
  accept(transport: DuplexTransport): HubConnection;
  readonly connections: readonly HubConnection[];
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
export interface ResolvedTimeouts extends ReplicationTimeouts {}
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

/** 通道载体接口（hub / peer 两侧各自实现；供 round-engine / update-channel 回调）。 */
export interface NamespaceChannelCore {
  readonly limits: ResolvedLimits;
  readonly remoteInstanceId: string;
  session: ReplicationSession | undefined;
  lease: NamespaceLease | undefined;
}

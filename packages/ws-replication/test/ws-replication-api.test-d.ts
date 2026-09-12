/**
 * SA6 类型层契约（vitest --typecheck）—— issue #136 `@nomicore/ws-replication`
 * 切片 6 namespace 状态机冻结公共面。
 *
 * 契约来源：docs/phases/phase-5-websocket-replication.md 切片 6 + §协议与状态机验收 +
 * §测试 seam + §必须通过的场景（#3/#4/#5/#7/#8/#10/#11/#12/#16）；docs/protocols/
 * instance-replication-v1.md §7–§21；ADR 0010（target 精确 `{namespaceId, localOwner}`、
 * 授权 Adapter 形状、无 durable outbox）。
 *
 * 当前为红灯：本包尚未实现（SA3 交付后与本文件逐字段对齐）。
 */
import { describe, expectTypeOf, it } from 'vitest';
import {
  createHubReplication,
  createPeerReplication,
  DEFAULT_REPLICATION_BACKOFF,
  DEFAULT_REPLICATION_LIMITS,
  DEFAULT_REPLICATION_TIMEOUTS,
} from '@nomicore/ws-replication';
import type {
  DuplexTransport,
  HubConnection,
  HubConnectionState,
  HubNamespaceState,
  HubReplication,
  HubReplicationOptions,
  HubUpgradeRequest,
  NamespaceAuthorization,
  NamespaceAuthorizer,
  PeerConnectionState,
  PeerNamespaceState,
  PeerReplication,
  PeerReplicationOptions,
  PeerTokenVerifier,
  ReplicationBackoff,
  ReplicationClock,
  ReplicationLimits,
  ReplicationNamespaceFailedCause,
  ReplicationObserver,
  ReplicationObserverConnectionCode,
  ReplicationObserverEvent,
  ReplicationObserverNamespaceCode,
  ReplicationObserverSchemaRearmCode,
  ReplicationObserverSide,
  ReplicationSendFailureReason,
  ReplicationTarget,
  ReplicationTimer,
  ReplicationTimeouts,
} from '@nomicore/ws-replication';
import type { ConnectionErrorCode, NamespaceErrorCode } from '@nomicore/replication-protocol';
import type { NamespaceOwner, NamespaceRegistry } from '@nomicore/namespace-registry';

describe('`@nomicore/ws-replication` 冻结公共面（切片 6）', () => {
  it('工厂：createHubReplication / createPeerReplication 签名（选项均为命名形状）', () => {
    expectTypeOf(createHubReplication).parameter(0).toMatchTypeOf<HubReplicationOptions>();
    expectTypeOf(createHubReplication).returns.toMatchTypeOf<HubReplication>();
    expectTypeOf(createPeerReplication).parameter(0).toMatchTypeOf<PeerReplicationOptions>();
    expectTypeOf(createPeerReplication).returns.toMatchTypeOf<PeerReplication>();
  });

  it('Hub 面：accept(transport, request?) → Promise<HubConnection | undefined>；connections 只读；revoke → Promise<void>；close() → Promise<void>', () => {
    expectTypeOf<HubReplication>().toMatchTypeOf<{
      accept(
        transport: DuplexTransport,
        request?: HubUpgradeRequest,
      ): Promise<HubConnection | undefined>;
      readonly connections: readonly HubConnection[];
      revoke(instanceIdentity: string, namespaceId: string): Promise<void>;
      close(): Promise<void>;
    }>();
    expectTypeOf<HubConnection['state']>().toEqualTypeOf<
      'handshaking' | 'ready' | 'draining' | 'closed'
    >();
    expectTypeOf<HubConnection>().toMatchTypeOf<{
      readonly peerInstanceId: string | undefined;
      close(code?: number, reason?: string): void;
    }>();
  });

  it('Peer 面：状态机投影 + target 幂等 add/remove（ADR 0010 冻结名）', () => {
    expectTypeOf<PeerReplication>().toMatchTypeOf<{
      start(): void;
      stop(): Promise<void>;
      addTarget(target: ReplicationTarget): void;
      removeTarget(namespaceId: string): Promise<void>;
      getConnectionState(): PeerConnectionState;
      getNamespaceState(namespaceId: string): PeerNamespaceState | undefined;
    }>();
    expectTypeOf<PeerConnectionState>().toEqualTypeOf<
      | 'stopped'
      | 'disconnected'
      | 'connecting'
      | 'handshaking'
      | 'ready'
      | 'draining'
      | 'backoff'
      | 'blocked'
    >();
    expectTypeOf<PeerNamespaceState>().toEqualTypeOf<
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
      | 'disconnected'
    >();
  });

  it('Target：精确 { namespaceId, localOwner }；owner 为 Registry NamespaceOwner（本地重要属性，不上 wire）', () => {
    expectTypeOf<ReplicationTarget>().toMatchTypeOf<{
      readonly namespaceId: string;
      readonly localOwner: NamespaceOwner;
    }>();
  });

  it('授权 Adapter（§19）：authorizeNamespace(instanceIdentity, namespaceId) → denied | allowed{localOwner, permissions{read,submit}}', () => {
    expectTypeOf<NamespaceAuthorizer>().parameter(0).toBeString();
    expectTypeOf<NamespaceAuthorizer>().parameter(1).toBeString();
    expectTypeOf<NamespaceAuthorizer>().returns.resolves.toMatchTypeOf<NamespaceAuthorization>();
    expectTypeOf<NamespaceAuthorization>().toMatchTypeOf<
      | { ok: true; localOwner: NamespaceOwner; permissions: { read: boolean; submit: boolean } }
      | { ok: false }
    >();
  });

  it('传输 seam（§测试 seam fake socket 形状）：send/close/closed/onMessage/onClose', () => {
    expectTypeOf<DuplexTransport>().toMatchTypeOf<{
      send(bytes: Uint8Array): void;
      close(code?: number, reason?: string): void;
      readonly closed: boolean;
      onMessage(listener: (bytes: Uint8Array) => void): () => void;
      onClose(listener: (info: Readonly<{ code: number; reason: string }>) => void): () => void;
    }>();
  });

  it('配置：limits/timeouts/backoff 命名形状 + Timer 注入 seam（确定性）', () => {
    expectTypeOf<ReplicationLimits>().toMatchTypeOf<{
      readonly maxFrameBytes: number;
      readonly maxBootstrapBytes: number;
      readonly maxSyncDiffBytes: number;
      readonly maxUpdateBytes: number;
      readonly maxQueuedUpdateBytes: number;
      readonly maxQueuedUpdateCount: number;
      readonly maxInFlightUpdates: number;
      readonly maxQueuedBytesPerConnection: number;
      readonly lowWater: number;
      readonly highWater: number;
      readonly maxQueuedControlBytes: number; // 控制帧独立保留额度（协议 §17：未冲刷控制字节口径；缺省 8 MiB）
    }>();
    expectTypeOf<ReplicationTimeouts>().toMatchTypeOf<{
      readonly helloTimeoutMs: number;
      readonly openTimeoutMs: number;
      readonly bootstrapTimeoutMs: number;
      readonly reconcileTimeoutMs: number;
      readonly reconcileIntervalMs: number;
      readonly closeTimeoutMs: number;
      readonly ackTimeoutMs: number;
    }>();
    expectTypeOf<ReplicationBackoff>().toMatchTypeOf<{
      readonly baseMs: number;
      readonly maxMs: number;
      readonly resetAfterMs: number;
    }>();
    expectTypeOf<ReplicationTimer>().toMatchTypeOf<{
      readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
      readonly clearTimeout: (handle: unknown) => void;
    }>();
  });

  it('HubReplicationOptions / PeerReplicationOptions：registry 为真实 NamespaceRegistry；verifyToken 必填', () => {
    expectTypeOf<HubReplicationOptions>().toMatchTypeOf<{
      readonly instanceId: string;
      readonly registry: NamespaceRegistry;
      readonly authorize: NamespaceAuthorizer;
      readonly timer: ReplicationTimer;
      readonly verifyToken: PeerTokenVerifier;
    }>();
    expectTypeOf<PeerReplicationOptions>().toMatchTypeOf<{
      readonly instanceId: string;
      readonly hubInstanceId: string;
      readonly registry: NamespaceRegistry;
      readonly dial: () => DuplexTransport;
      readonly timer: ReplicationTimer;
    }>();
  });

  it('默认值常量：完整 limits/timeouts/backoff，构造期响亮校验（§17 不得运行时 clamp）', () => {
    expectTypeOf<typeof DEFAULT_REPLICATION_LIMITS>().toMatchTypeOf<Readonly<ReplicationLimits>>();
    expectTypeOf<typeof DEFAULT_REPLICATION_TIMEOUTS>().toMatchTypeOf<Readonly<ReplicationTimeouts>>();
    expectTypeOf<typeof DEFAULT_REPLICATION_BACKOFF>().toMatchTypeOf<Readonly<ReplicationBackoff>>();
  });
});

it('P1（issue #176 AC-1）：PONG_TIMEOUT 不在 connection 错误注册表（§13.1 append-only）', () => {
  // @ts-expect-error PONG_TIMEOUT 未登记——若此行不再报错，说明注册表被污染（错误修法）
  const code: ConnectionErrorCode = 'PONG_TIMEOUT';
  expectTypeOf(code).toBeString();
});

// ═══════════════════════════ issue #177：observer seam 冻结面（设计 §3；append-only） ═══════════════════════════

describe('`@nomicore/ws-replication` observer seam（issue #177）', () => {
  it('options：observer/clock 均为可选（加性可选——既有调用方零破坏）', () => {
    expectTypeOf<HubReplicationOptions>().toMatchTypeOf<{
      readonly observer?: ReplicationObserver;
      readonly clock?: ReplicationClock;
    }>();
    expectTypeOf<PeerReplicationOptions>().toMatchTypeOf<{
      readonly observer?: ReplicationObserver;
      readonly clock?: ReplicationClock;
    }>();
    // 形状：单函数回调 + { now(): number } 时钟面
    expectTypeOf<ReplicationObserver>().parameter(0).toMatchTypeOf<ReplicationObserverEvent>();
    expectTypeOf<ReplicationObserver>().returns.toBeVoid();
    expectTypeOf<ReplicationClock>().toMatchTypeOf<{ readonly now: () => number }>();
  });

  it('连接态/通道态公共投影：HubConnectionState 四值精确；HubNamespaceState 九值精确（且与 HubChannelState 同源）', () => {
    expectTypeOf<HubConnectionState>().toEqualTypeOf<
      'handshaking' | 'ready' | 'draining' | 'closed'
    >();
    expectTypeOf<HubNamespaceState>().toEqualTypeOf<
      | 'opening'
      | 'bootstrapping'
      | 'reconciling'
      | 'live'
      | 'needs-resync'
      | 'closing'
      | 'closed'
      | 'conflicted'
      | 'failed'
    >();
  });

  it('事件 union：36 型字面量精确匹配（判别联合闭集，append-only；issue #238/#256/#244/#245/#301 增补）', () => {
    expectTypeOf<ReplicationObserverEvent>().toEqualTypeOf<
      | { readonly type: 'connection-state-changed'; readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly from: PeerConnectionState | HubConnectionState; readonly to: PeerConnectionState | HubConnectionState }
      | { readonly type: 'connection-backoff-scheduled'; readonly side: 'peer'; readonly attempt: number; readonly delayMs: number; readonly reason: 'dial-failed' | 'socket-closed' | 'hello-timeout' | 'pong-timeout' | 'connection-backpressure' | 'goaway-closed' | 'goaway-retry-hint' | 'namespace-recovery' }
      | { readonly type: 'goaway-received'; readonly side: 'peer'; readonly connectionId?: string; readonly reasonCode: 'SERVER_RESTARTING' | 'SERVER_SHUTTING_DOWN' | 'REAUTH_REQUIRED' | 'other'; readonly drainTimeoutMs: number; readonly retryAfterMs?: number }
      | { readonly type: 'channel-state-changed'; readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly namespaceId: string; readonly from: PeerNamespaceState | HubNamespaceState; readonly to: PeerNamespaceState | HubNamespaceState }
      | { readonly type: 'bootstrap-snapshot-sent'; readonly side: 'hub'; readonly connectionId?: string; readonly namespaceId: string; readonly bytes: number }
      | { readonly type: 'bootstrap-imported'; readonly side: 'peer'; readonly connectionId?: string; readonly namespaceId: string; readonly bytes: number }
      | { readonly type: 'sync-step2-sent'; readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly namespaceId: string; readonly bytes: number; readonly syncRoundId: number; readonly encodedUpdateBytes: number }
      | { readonly type: 'sync-diff-applied'; readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly namespaceId: string; readonly bytes: number; readonly applyLatencyMs?: number; readonly syncRoundId: number; readonly encodedUpdateBytes: number; readonly stateVectorChanged?: boolean; readonly applyEffect?: 'changed' | 'noop'; readonly stateVectorBeforeHash?: string; readonly stateVectorAfterHash?: string; readonly sequence: number; readonly queueWaitMs?: number; readonly protectedCheckMs?: number; readonly liveApplyMs?: number; readonly dirtyNotifyMs?: number }
      | { readonly type: 'update-sent'; readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly namespaceId: string; readonly bytes: number; readonly sequence: number; readonly sendQueueMs?: number }
      | { readonly type: 'update-applied'; readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly namespaceId: string; readonly bytes: number; readonly applyLatencyMs?: number; readonly sequence: number; readonly queueWaitMs?: number; readonly protectedCheckMs?: number; readonly liveApplyMs?: number; readonly dirtyNotifyMs?: number }
      | { readonly type: 'update-acked'; readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly namespaceId: string; readonly bytes: number; readonly ackLatencyMs?: number; readonly sequence: number }
      | { readonly type: 'update-dropped'; readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly namespaceId: string; readonly reason: 'update-too-large'; readonly updateBytes: number; readonly maxUpdateBytes: number; readonly channelState: PeerNamespaceState | HubNamespaceState; readonly connectionState: PeerConnectionState | HubConnectionState; readonly queuedUpdateCount: number; readonly queuedUpdateBytes: number; readonly inFlightCount: number; readonly bufferedAmount?: number }
      | { readonly type: 'degraded-bypass-applied'; readonly side: 'peer'; readonly connectionId?: string; readonly namespaceId: string; readonly bytes: number; readonly sequence: number }
      | { readonly type: 'auth-upgrade-rejected'; readonly side: 'hub'; readonly reason: 'hub-shutdown' | 'missing-token' | 'verifier-missing' | 'frame-too-large' | 'early-frame-limit' | 'auth-timeout' | 'invalid-credentials' | 'invalid-instance-id' | 'peer-disconnected' }
      | { readonly type: 'resync-required'; readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly namespaceId: string; readonly cause: 'queue-overflow' | 'send-failed' | 'connection-shed' | 'ack-timeout' | 'session-fanout-overflow' | 'remote-declared'; readonly reason?: 'update-too-large' | 'send-frame-rejected'; readonly updateBytes?: number; readonly maxUpdateBytes?: number; readonly channelState?: PeerNamespaceState | HubNamespaceState; readonly connectionState?: PeerConnectionState | HubConnectionState; readonly queuedUpdateCount?: number; readonly queuedUpdateBytes?: number; readonly inFlightCount?: number; readonly bufferedAmount?: number }
      | { readonly type: 'send-paused'; readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly bufferedAmount: number }
      | { readonly type: 'send-resumed'; readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly bufferedAmount: number }
      | { readonly type: 'connection-failed'; readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly code: ReplicationObserverConnectionCode; readonly wsCloseCode: number }
      | { readonly type: 'namespace-error'; readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly namespaceId: string; readonly code: ReplicationObserverNamespaceCode; readonly direction: 'sent' | 'received'; readonly terminalState?: 'failed' | 'conflicted' | 'closed' }
      // issue #256（append-only 第 22 型）
      | { readonly type: 'namespace-failed'; readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly namespaceId: string; readonly cause: ReplicationNamespaceFailedCause; readonly timeoutMs?: number }
      | { readonly type: 'identity-conflicted'; readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly namespaceId: string; readonly via: 'open-mismatch' | 'fence' | 'identity-changed-frame' }
      // issue #238（append-only 第 21 型）
      | { readonly type: 'event-loop-delay-sampled'; readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly delayMs: number }
      // issue #287（append-only 第 23/24 型；ADR 0018 §4 schema re-arm 域，peer 专属）
      | { readonly type: 'schema-rearm-applied'; readonly side: 'peer'; readonly connectionId?: string; readonly namespaceId: string; readonly semanticFingerprint: string; readonly updatedAt: string | null }
      | { readonly type: 'schema-rearm-failed'; readonly side: 'peer'; readonly connectionId?: string; readonly namespaceId: string; readonly code: 'NSRT-FATAL-SCHEMA-REARM-INVALID' | 'NSRT-FATAL-SCHEMA-REARM-INTERNAL' }
      // issue #244（append-only 第 25 型；reason = ChunkedUpdateAbortReason 六值闭集——
      // 该别名经 types.ts 模块级导出、不经 index.ts 重导出，此处按结构展开比对）
      | { readonly type: 'chunked-update-aborted'; readonly side: ReplicationObserverSide; readonly namespaceId: string; readonly transferId: number; readonly reason: 'timeout' | 'shed' | 'resync-declared' | 'channel-teardown' | 'connection-teardown' | 'epoch-fence'; readonly receivedChunks: number; readonly receivedBytes: number }

      // issue #245（append-only 第 26–28 型；ADR 0013 L89–91 域键集逐字 + §23 side 信封——
      // R22 裁决：无 sequence/四段差值/效果组键；sent 恒无 latency 键）
      | { readonly type: 'chunked-update-sent'; readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly namespaceId: string; readonly transferId: number; readonly chunkCount: number; readonly totalBytes: number }
      | { readonly type: 'chunked-update-applied'; readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly namespaceId: string; readonly bytes: number; readonly chunkCount: number; readonly applyLatencyMs?: number }
      | { readonly type: 'chunked-update-acked'; readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly namespaceId: string; readonly bytes: number; readonly ackLatencyMs?: number }

      // issue #301（append-only 第 29–36 型；ADR 0019 L78–81 + 协议 §23.1 第 29–36 型行——
      // 字段集对齐既有 chunked-update-* 四型；side 信封：snapshot 成功三型字面量、
      // sync 四型与两 aborted 型 ReplicationObserverSide；sent 恒无 latency 键、
      // applied 无 transferId/sequence/效果组键、acked 无 sequence/syncRoundId、
      // aborted 无 connectionId；reason 复用 ChunkedUpdateAbortReason 六值闭集）
      | { readonly type: 'chunked-snapshot-sent'; readonly side: 'hub'; readonly connectionId?: string; readonly namespaceId: string; readonly transferId: number; readonly chunkCount: number; readonly totalBytes: number }
      | { readonly type: 'chunked-snapshot-applied'; readonly side: 'peer'; readonly connectionId?: string; readonly namespaceId: string; readonly bytes: number; readonly chunkCount: number; readonly applyLatencyMs?: number }
      | { readonly type: 'chunked-snapshot-acked'; readonly side: 'hub'; readonly connectionId?: string; readonly namespaceId: string; readonly bytes: number; readonly ackLatencyMs?: number }
      | { readonly type: 'chunked-snapshot-aborted'; readonly side: ReplicationObserverSide; readonly namespaceId: string; readonly transferId: number; readonly reason: 'timeout' | 'shed' | 'resync-declared' | 'channel-teardown' | 'connection-teardown' | 'epoch-fence'; readonly receivedChunks: number; readonly receivedBytes: number }
      | { readonly type: 'chunked-sync-sent'; readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly namespaceId: string; readonly transferId: number; readonly chunkCount: number; readonly totalBytes: number; readonly syncRoundId: number }
      | { readonly type: 'chunked-sync-applied'; readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly namespaceId: string; readonly bytes: number; readonly chunkCount: number; readonly syncRoundId: number; readonly applyLatencyMs?: number }
      | { readonly type: 'chunked-sync-acked'; readonly side: ReplicationObserverSide; readonly connectionId?: string; readonly namespaceId: string; readonly bytes: number; readonly ackLatencyMs?: number }
      | { readonly type: 'chunked-sync-aborted'; readonly side: ReplicationObserverSide; readonly namespaceId: string; readonly transferId: number; readonly reason: 'timeout' | 'shed' | 'resync-declared' | 'channel-teardown' | 'connection-teardown' | 'epoch-fence'; readonly receivedChunks: number; readonly receivedBytes: number }

    >();
    // issue #256：namespace-failed 字段类型精确性（cause 闭联合；timeoutMs 可选有限数值）
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'namespace-failed' }>['cause']>().toEqualTypeOf<ReplicationNamespaceFailedCause>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'namespace-failed' }>['timeoutMs']>().toEqualTypeOf<number | undefined>();
    // issue #238：新字段在场/缺省类型精确性
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'update-applied' }>['sequence']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'update-applied' }>['queueWaitMs']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'update-sent' }>['sendQueueMs']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'event-loop-delay-sampled' }>['delayMs']>().toEqualTypeOf<number>();
    // issue #287：re-arm 两型字段类型精确性（updatedAt 诚实缺席为 null 而非 undefined；
    // code 闭联合无 string 松类型）
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'schema-rearm-applied' }>['updatedAt']>().toEqualTypeOf<string | null>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'schema-rearm-applied' }>['semanticFingerprint']>().toEqualTypeOf<string>();
    expectTypeOf<ReplicationObserverSchemaRearmCode>().toEqualTypeOf<
      'NSRT-FATAL-SCHEMA-REARM-INVALID' | 'NSRT-FATAL-SCHEMA-REARM-INTERNAL'
    >();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'schema-rearm-failed' }>['code']>().toEqualTypeOf<ReplicationObserverSchemaRearmCode>();
    // issue #244：chunked-update-aborted 字段类型精确性（side 信封 + reason 六值闭集 + 计数）
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-update-aborted' }>['reason']>().toEqualTypeOf<
      | 'timeout'
      | 'shed'
      | 'resync-declared'
      | 'channel-teardown'
      | 'connection-teardown'
      | 'epoch-fence'
    >();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-update-aborted' }>['side']>().toEqualTypeOf<ReplicationObserverSide>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-update-aborted' }>['receivedChunks']>().toEqualTypeOf<number>();

    // issue #245：三新型字段类型精确性（transferId/chunkCount/totalBytes/bytes = 有限数值；
    // latency 可选——时钟折叠两态在类型面 = number | undefined 缺省可选）
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-update-sent' }>['transferId']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-update-sent' }>['chunkCount']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-update-sent' }>['totalBytes']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-update-sent' }>['side']>().toEqualTypeOf<ReplicationObserverSide>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-update-applied' }>['bytes']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-update-applied' }>['chunkCount']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-update-applied' }>['applyLatencyMs']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-update-acked' }>['bytes']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-update-acked' }>['ackLatencyMs']>().toEqualTypeOf<number | undefined>();

    // issue #301：8 型字段类型精确性（OD9-1 全覆盖；side 信封按 §23.1 行取值，
    // latency 可选 = number | undefined，sync 族 syncRoundId 必填，aborted reason 六值闭集）
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-snapshot-sent' }>['side']>().toEqualTypeOf<'hub'>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-snapshot-sent' }>['transferId']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-snapshot-sent' }>['chunkCount']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-snapshot-sent' }>['totalBytes']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-snapshot-applied' }>['side']>().toEqualTypeOf<'peer'>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-snapshot-applied' }>['bytes']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-snapshot-applied' }>['chunkCount']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-snapshot-applied' }>['applyLatencyMs']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-snapshot-acked' }>['side']>().toEqualTypeOf<'hub'>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-snapshot-acked' }>['bytes']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-snapshot-acked' }>['ackLatencyMs']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-snapshot-aborted' }>['side']>().toEqualTypeOf<ReplicationObserverSide>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-snapshot-aborted' }>['reason']>().toEqualTypeOf<
      | 'timeout'
      | 'shed'
      | 'resync-declared'
      | 'channel-teardown'
      | 'connection-teardown'
      | 'epoch-fence'
    >();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-snapshot-aborted' }>['receivedChunks']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-sync-sent' }>['side']>().toEqualTypeOf<ReplicationObserverSide>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-sync-sent' }>['transferId']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-sync-sent' }>['chunkCount']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-sync-sent' }>['totalBytes']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-sync-sent' }>['syncRoundId']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-sync-applied' }>['bytes']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-sync-applied' }>['chunkCount']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-sync-applied' }>['syncRoundId']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-sync-applied' }>['applyLatencyMs']>().toEqualTypeOf<number | undefined>();
    // acked 键集冻结：无 syncRoundId 键（OD1/R2 forbidden 断言在类型面的对应物）
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-sync-acked' }>['bytes']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-sync-acked' }>['ackLatencyMs']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<'syncRoundId' extends keyof Extract<ReplicationObserverEvent, { type: 'chunked-sync-acked' }> ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-sync-aborted' }>['transferId']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-sync-aborted' }>['reason']>().toEqualTypeOf<
      | 'timeout'
      | 'shed'
      | 'resync-declared'
      | 'channel-teardown'
      | 'connection-teardown'
      | 'epoch-fence'
    >();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'chunked-sync-aborted' }>['receivedBytes']>().toEqualTypeOf<number>();
    // 结构排除的静态锚：applied 族无 transferId/sequence 键；aborted 族无 connectionId 键
    expectTypeOf<'transferId' extends keyof Extract<ReplicationObserverEvent, { type: 'chunked-snapshot-applied' }> ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<'sequence' extends keyof Extract<ReplicationObserverEvent, { type: 'chunked-sync-applied' }> ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<'connectionId' extends keyof Extract<ReplicationObserverEvent, { type: 'chunked-snapshot-aborted' }> ? true : false>().toEqualTypeOf<false>();

  });

  it('稳定码闭联合：ConnectionErrorCode(17) ∪ 2 内部码；NamespaceErrorCode(20) ∪ 1 内部码（同源 append-only）', () => {
    expectTypeOf<ReplicationObserverConnectionCode>().toEqualTypeOf<
      | ConnectionErrorCode
      | 'PONG_TIMEOUT'
      | 'OUTBOUND_SEQUENCE_EXHAUSTED'
    >();
    expectTypeOf<ReplicationObserverNamespaceCode>().toEqualTypeOf<
      | NamespaceErrorCode
      | 'IDENTITY_CHANGED'
    >();
    // 事件 code 字段闭联合（无 string 松类型）
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'connection-failed' }>['code']>().toEqualTypeOf<ReplicationObserverConnectionCode>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'namespace-error' }>['code']>().toEqualTypeOf<ReplicationObserverNamespaceCode>();
    // issue #231：send-failed 子因闭联合（append-only；reason 字段与它同源）
    expectTypeOf<ReplicationSendFailureReason>().toEqualTypeOf<'update-too-large' | 'send-frame-rejected'>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'resync-required' }>['reason']>().toEqualTypeOf<ReplicationSendFailureReason | undefined>();
    // issue #231：update-dropped（第 20 型）——reason 当前唯一形态 update-too-large（必填，非可选）
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'update-dropped' }>['reason']>().toEqualTypeOf<'update-too-large'>();
    // issue #256：namespace-failed 终态原因闭联合（13 值精确，append-only；无 string 松类型）
    expectTypeOf<ReplicationNamespaceFailedCause>().toEqualTypeOf<
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
      | 'internal-error'
    >();
  });

  it('side 判别精确性：hub 侧连接事件不含 peer 专属值；peer 专属事件 side 字面量', () => {
    // connection-state-changed.from/to = 连接态联合（hub 仅 4 值；peer 8 值——联合仅单事件形状服务）
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'connection-state-changed' }>['from']>().toEqualTypeOf<PeerConnectionState | HubConnectionState>();
    // hub 侧事件类型不带 peer 专属字段（goaway/backoff 仅 peer）
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'goaway-received' }>['side']>().toEqualTypeOf<'peer'>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'degraded-bypass-applied' }>['side']>().toEqualTypeOf<'peer'>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'bootstrap-snapshot-sent' }>['side']>().toEqualTypeOf<'hub'>();
    expectTypeOf<Extract<ReplicationObserverEvent, { type: 'auth-upgrade-rejected' }>['side']>().toEqualTypeOf<'hub'>();
  });

  it('issue #243：chunkedUpdate 旋钮与 maxChunkedUpdateBytes 限额的公共类型面（additive）', () => {
    // PeerReplicationOptions.chunkedUpdate（可选 boolean；缺省 = v1）
    expectTypeOf<NonNullable<PeerReplicationOptions['chunkedUpdate']>>().toEqualTypeOf<boolean>();
    expectTypeOf<PeerReplicationOptions['chunkedUpdate']>().toEqualTypeOf<boolean | undefined>();
    // ReplicationLimits.maxChunkedUpdateBytes（必填 number——缺省 4 MiB）
    expectTypeOf<ReplicationLimits['maxChunkedUpdateBytes']>().toEqualTypeOf<number>();
    expectTypeOf<typeof DEFAULT_REPLICATION_LIMITS['maxChunkedUpdateBytes']>().toEqualTypeOf<number>();
    // issue #295：两聚合上限键进入公共类型面（必填 number；缺省 4 MiB 经 DEFAULT 提供）
    expectTypeOf<ReplicationLimits['maxChunkedBootstrapBytes']>().toEqualTypeOf<number>();
    expectTypeOf<ReplicationLimits['maxChunkedSyncDiffBytes']>().toEqualTypeOf<number>();
    expectTypeOf<typeof DEFAULT_REPLICATION_LIMITS['maxChunkedBootstrapBytes']>().toEqualTypeOf<number>();
    expectTypeOf<typeof DEFAULT_REPLICATION_LIMITS['maxChunkedSyncDiffBytes']>().toEqualTypeOf<number>();
  });

  it('观察面不回传控制能力：回调返回 void；事件对象全部 primitive 字段（无函数/对象引用字段）', () => {
    expectTypeOf<ReplicationObserver>().returns.toBeVoid();
    expectTypeOf<ReplicationObserverEvent>().toMatchTypeOf<{ readonly type: string }>();
  });
});

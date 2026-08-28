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
  HubReplication,
  HubReplicationOptions,
  NamespaceAuthorization,
  NamespaceAuthorizer,
  PeerConnectionState,
  PeerNamespaceState,
  PeerReplication,
  PeerReplicationOptions,
  ReplicationBackoff,
  ReplicationLimits,
  ReplicationTarget,
  ReplicationTimer,
  ReplicationTimeouts,
} from '@nomicore/ws-replication';
import type { NamespaceOwner, NamespaceRegistry } from '@nomicore/namespace-registry';

describe('`@nomicore/ws-replication` 冻结公共面（切片 6）', () => {
  it('工厂：createHubReplication / createPeerReplication 签名（选项均为命名形状）', () => {
    expectTypeOf(createHubReplication).parameter(0).toMatchTypeOf<HubReplicationOptions>();
    expectTypeOf(createHubReplication).returns.toMatchTypeOf<HubReplication>();
    expectTypeOf(createPeerReplication).parameter(0).toMatchTypeOf<PeerReplicationOptions>();
    expectTypeOf(createPeerReplication).returns.toMatchTypeOf<PeerReplication>();
  });

  it('Hub 面：accept(transport) → HubConnection；connections 只读；close() → Promise<void>', () => {
    expectTypeOf<HubReplication>().toMatchTypeOf<{
      accept(transport: DuplexTransport): HubConnection;
      readonly connections: readonly HubConnection[];
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
    }>();
    expectTypeOf<ReplicationTimeouts>().toMatchTypeOf<{
      readonly helloTimeoutMs: number;
      readonly openTimeoutMs: number;
      readonly bootstrapTimeoutMs: number;
      readonly reconcileTimeoutMs: number;
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

  it('HubReplicationOptions / PeerReplicationOptions：registry 为真实 NamespaceRegistry', () => {
    expectTypeOf<HubReplicationOptions>().toMatchTypeOf<{
      readonly instanceId: string;
      readonly registry: NamespaceRegistry;
      readonly authorize: NamespaceAuthorizer;
      readonly timer: ReplicationTimer;
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

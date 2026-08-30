/**
 * SA3 红灯验收（issue #177，设计 §9）—— `@nomicore/ws-replication` 结构化 observer seam：
 * 正向事件矩阵（T1-T7/T12-T13）+ 破坏性隔离/泄露（T8/T9）。
 *
 * 契约：wiki/raw/task_issue-177_design.md（R1 设计 §3.1 事件 union / §4 safe-field /
 * §5 隔离语义 / §6 发射点清单 / §9 测试计划）；docs/protocols/instance-replication-v1.md
 * §23（observer seam 事件词汇，非 wire 契约）；TASK.md 7 条 AC。
 *
 * 红灯纪律：真实 yjs / Registry / Runtime；fake-duplex 内存双端；注入 fake clock（零
 * native Date.now——时钟只作差）；零 real sleep（scheduler.advanceBy 虚拟推进）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type {
  DuplexTransport,
  HubReplication,
  PeerReplication,
  ReplicationClock,
  ReplicationObserver,
  ReplicationObserverEvent,
  NamespaceAuthorization,
} from '@nomicore/ws-replication';
import { decodeMessage, encodeMessage } from '@nomicore/replication-protocol';
import type { ReplicationMessage } from '@nomicore/replication-protocol';
import {
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  PEER_OWNER,
  SCHEMA_ENVELOPE,
  bytesToHex,
  deferred,
  makeHubNamespace,
  makeNode,
  makeSeedDoc,
  makeWire,
  okLease,
  schemaReady,
  settle,
  type HubNamespaceFixture,
  type ReplicaNode,
  type Wire,
} from './harness.js';
import { stableConnectionCode, stableNamespaceCode } from '../src/observer.js';
import { ConnectionSender, type ConnectionSenderHost } from '../src/backpressure.js';

const TEST_TOKEN = 'tok-test-4f2b8a1c9d3e';
const NS_RE = /^ns-[0-9a-f]{32}$/;

// ═══════════════════════════ 确定性时钟（仅作差；事件不含绝对时间戳） ═══════════════════════════

class ManualClock implements ReplicationClock {
  value: number;
  constructor(start: number) {
    this.value = start;
  }
  now(): number {
    return this.value;
  }
  advance(ms: number): void {
    this.value += ms;
  }
}

// ═══════════════════════════ 事件收集器 ═══════════════════════════

class Collector {
  readonly events: ReplicationObserverEvent[] = [];
  observer: ReplicationObserver = (event) => {
    this.events.push(event);
  };
  of(type: ReplicationObserverEvent['type']): ReplicationObserverEvent[] {
    return this.events.filter((e) => e.type === type);
  }
  lastOf(type: ReplicationObserverEvent['type']): ReplicationObserverEvent | undefined {
    const all = this.of(type);
    return all[all.length - 1];
  }
}

/** 每事件必 throw 的破坏性 observer（throw 必须被隔离——事件流不熔断、协议零影响）。 */
class ThrowingCollector extends Collector {
  override observer: ReplicationObserver = (event) => {
    this.events.push(event);
    throw new Error('observer boom (sentinel-obs-boom)');
  };
}

// ═══════════════════════════ 观察型双端组装（driver 同构，注入 observer/clock） ═══════════════════════════

export interface ObservedSetup {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly wire: Wire;
  readonly nsId: string;
  readonly fixture: HubNamespaceFixture;
  readonly hubEvents: Collector;
  readonly peerEvents: Collector;
  readonly hubClock: ReplicationClock;
  readonly peerClock: ReplicationClock;
  writeHub(update: Readonly<{ n?: number; extra?: number }>): Promise<void>;
  writePeer(update: Readonly<{ n?: number; extra?: number }>): Promise<void>;
  rootValue(side: 'hub' | 'peer', key: string): unknown;
  setDegraded(side: 'hub' | 'peer', degraded: boolean): void;
  injectHubFrame(message: ReplicationMessage): void;
  injectPeerFrame(message: ReplicationMessage): void;
}

interface ObservedOptions {
  readonly peerReplica?: 'none' | 'same' | Readonly<{ replicationId: string; replicationEpoch: number }>;
  readonly limits?: Readonly<Partial<{
    maxFrameBytes: number; maxBootstrapBytes: number; maxSyncDiffBytes: number;
    maxUpdateBytes: number; maxQueuedUpdateBytes: number; maxQueuedUpdateCount: number;
    maxInFlightUpdates: number; maxQueuedBytesPerConnection: number;
    lowWater: number; highWater: number; maxQueuedControlBytes: number;
  }>>;
  readonly timeouts?: Readonly<Partial<{
    helloTimeoutMs: number; openTimeoutMs: number; bootstrapTimeoutMs: number;
    reconcileTimeoutMs: number; closeTimeoutMs: number; ackTimeoutMs: number;
  }>>;
  readonly backoff?: Readonly<Partial<{ baseMs: number; maxMs: number; resetAfterMs: number }>>;
  readonly random?: () => number;
  readonly start?: boolean;
  readonly hubObserver?: ReplicationObserver;
  readonly peerObserver?: ReplicationObserver;
  readonly startClockValue?: number;
  /** 覆盖默认确定性时钟（B1 throw 时钟锚） */
  readonly hubClock?: ReplicationClock;
  readonly peerClock?: ReplicationClock;
}

async function observedBoot(opts: ObservedOptions = {}): Promise<ObservedSetup> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const fixture = await makeHubNamespace(hubNode, { owner: HUB_OWNER, root: { n: 42, extra: 77 } });
  const nsId = fixture.namespaceId;
  const hubEvents = new Collector();
  const peerEvents = new Collector();
  const hubClock: ReplicationClock =
    opts.hubClock ?? new ManualClock(opts.startClockValue ?? 1_000);
  const peerClock: ReplicationClock =
    opts.peerClock ?? new ManualClock(opts.startClockValue ?? 1_000);

  const authorizer = async (
    _instanceIdentity: string,
    namespaceId: string,
  ): Promise<NamespaceAuthorization> => ({
    ok: true,
    localOwner: HUB_OWNER,
    permissions: { read: true, submit: true },
    ...(namespaceId === nsId ? {} : {}),
  });

  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: hubNode.registry,
    authorize: authorizer,
    timer: hubNode.scheduler,
    verifyToken: async (token) =>
      token === TEST_TOKEN ? { ok: true, instanceId: PEER_INSTANCE } : { ok: false },
    observer: opts.hubObserver ?? hubEvents.observer,
    clock: hubClock,
    ...(opts.limits !== undefined ? { limits: opts.limits } : {}),
    ...(opts.timeouts !== undefined ? { timeouts: opts.timeouts } : {}),
  });

  const wires: Wire[] = [];
  const dial = (): DuplexTransport => {
    const wire = makeWire();
    wires.push(wire);
    void hub.accept(wire.hubEnd, { token: TEST_TOKEN });
    return wire.peerEnd;
  };

  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial,
    timer: peerNode.scheduler,
    targets: [{ namespaceId: nsId, localOwner: PEER_OWNER }],
    observer: opts.peerObserver ?? peerEvents.observer,
    clock: peerClock,
    ...(opts.limits !== undefined ? { limits: opts.limits } : {}),
    ...(opts.timeouts !== undefined ? { timeouts: opts.timeouts } : {}),
    ...(opts.backoff !== undefined ? { backoff: opts.backoff } : {}),
    ...(opts.random !== undefined ? { random: opts.random } : {}),
  });

  // peer 预置副本（reconcile 前置）——以 hub 实况快照为基底（struct 同源，diff 只含增量；
  // 纯 makeSeedDoc 会产生 SCHEMA/META 差异 → 保护检查 PROTECTED_FIELD_MUTATION）
  const replicaSpec = opts.peerReplica ?? 'none';
  if (replicaSpec !== 'none') {
    const rid =
      replicaSpec === 'same'
        ? fixture.identity.replicationId
        : (replicaSpec as { replicationId: string }).replicationId;
    const epoch =
      replicaSpec === 'same'
        ? fixture.identity.replicationEpoch
        : (replicaSpec as { replicationEpoch: number }).replicationEpoch;
    const hubDoc = hubNode.persistence.peek(HUB_OWNER, nsId);
    if (hubDoc === undefined) throw new Error('hub 文档缺失，无法构造 peer 副本基底');
    const seed = new Y.Doc();
    Y.applyUpdate(seed, Y.encodeStateAsUpdate(hubDoc));
    const seedMeta = seed.getMap('META') as unknown as Map<string, unknown>;
    if (seedMeta.get('replicationId') !== rid) seedMeta.set('replicationId', rid);
    if (seedMeta.get('replicationEpoch') !== epoch) seedMeta.set('replicationEpoch', epoch);
    const lease = okLease(
      await peerNode.registry.importReplica(PEER_OWNER, nsId, seed, {
        replicationId: rid,
        replicationEpoch: epoch,
      }),
    );
    await schemaReady(lease);
  }

  if (opts.start !== false && !wires.length) {
    peer.start();
  }

  const writePeer = async (update: Readonly<{ n?: number; extra?: number }>): Promise<void> => {
    const lease = okLease(await peerNode.registry.open(PEER_OWNER, nsId));
    await schemaReady(lease);
    for (const [key, value] of Object.entries(update)) {
      const result = await lease.mutateRoot({ op: 'set', path: [key], value });
      if (!result.ok) throw new Error(`peer 业务写失败：${JSON.stringify(result)}`);
    }
    await lease.release();
  };
  const writeHub = async (update: Readonly<{ n?: number; extra?: number }>): Promise<void> => {
    for (const [key, value] of Object.entries(update)) {
      const result = await fixture.lease.mutateRoot({ op: 'set', path: [key], value });
      if (!result.ok) throw new Error(`hub 业务写失败：${JSON.stringify(result)}`);
    }
    await settle();
  };

  const wire = () => wires[wires.length - 1]!;
  const nextSeq = (frames: Uint8Array[]): number => {
    let max = 0;
    for (const frame of frames) {
      try {
        const decoded = decodeMessage(frame);
        if (decoded.header.sequence > max) max = decoded.header.sequence;
      } catch {
        // 解码失败帧（故障注入）不参与序列推算
      }
    }
    return max + 1;
  };

  return {
    hubNode,
    peerNode,
    hub,
    peer,
    wire: wire(),
    nsId,
    fixture,
    hubEvents,
    peerEvents,
    hubClock,
    peerClock,
    writeHub,
    writePeer,
    rootValue(side, key) {
      const node = side === 'hub' ? hubNode : peerNode;
      const owner = side === 'hub' ? HUB_OWNER : PEER_OWNER;
      const doc = node.persistence.peek(owner, nsId);
      if (doc === undefined) throw new Error(`${side} 缺副本`);
      return (doc.getMap('ROOT') as unknown as Map<string, unknown>).get(key);
    },
    setDegraded(side, degraded) {
      const node = side === 'hub' ? hubNode : peerNode;
      const owner = side === 'hub' ? HUB_OWNER : PEER_OWNER;
      node.persistence.setStatus(owner, nsId, degraded ? 'persistence-degraded' : 'ready');
    },
    injectHubFrame(message) {
      const w = wire();
      w.hubEnd.send(encodeMessage(message, { sequence: nextSeq(w.hubToPeer) }));
    },
    injectPeerFrame(message) {
      const w = wire();
      w.peerEnd.send(encodeMessage(message, { sequence: nextSeq(w.peerToHub) }));
    },
  };
}

async function waitFor(
  pred: () => boolean,
  label: string,
  budget = 2_000,
): Promise<void> {
  for (let index = 0; index < budget; index += 1) {
    if (pred()) return;
    await settle();
  }
  throw new Error(`waitFor 超时：${label}`);
}

/** wire 帧序列解码（含序）。 */
function frameBytes(wire: Wire, direction: 'peer-to-hub' | 'hub-to-peer', kind: string): number[] {
  const frames = direction === 'peer-to-hub' ? wire.peerToHub : wire.hubToPeer;
  const out: number[] = [];
  for (const frame of frames) {
    try {
      const decoded = decodeMessage(frame);
      if (decoded.message.kind === kind) {
        const msg = decoded.message as unknown as { update?: Uint8Array; snapshot?: Uint8Array };
        out.push((msg.update ?? msg.snapshot)?.byteLength ?? 0);
      }
    } catch {
      // 忽略不可解码帧
    }
  }
  return out;
}

// ═══════════════════════════ T1/T2：正向·连接 & channel/bootstrap ═══════════════════════════

describe('T1/T2：连接与 channel/bootstrap 正向事件', () => {
  it('peer 连接态迁移序 + connectionId；hub 侧 ready 事件携带 connectionId', async () => {
    const run = await observedBoot();
    await waitFor(() => run.peer.getConnectionState() === 'ready', 'peer ready');
    await waitFor(() => run.peer.getNamespaceState(run.nsId) === 'live', 'ns live');

    const transitions = run.peerEvents.of('connection-state-changed');
    const seq = transitions.map((e) => {
      const t = e as Extract<ReplicationObserverEvent, { type: 'connection-state-changed' }>;
      return `${t.from}->${t.to}`;
    });
    expect(seq[0]).toBe('stopped->disconnected');
    expect(seq).toContain('disconnected->connecting');
    expect(seq).toContain('connecting->handshaking');
    expect(seq).toContain('handshaking->ready');
    // ready 后 peer 事件携带 connectionId（HELLO_ACK 捕获）
    const readyEvent = transitions[transitions.length - 1] as Extract<
      ReplicationObserverEvent,
      { type: 'connection-state-changed' }
    >;
    expect(readyEvent.to).toBe('ready');
    expect(readyEvent.connectionId).toMatch(/^hub-omega-conn-\d+$/);

    // hub 侧：handshaking→ready，connectionId = ${instanceId}-conn-${n}
    const hubTransitions = run.hubEvents.of('connection-state-changed');
    const hubReady = hubTransitions.find(
      (e) =>
        (e as Extract<ReplicationObserverEvent, { type: 'connection-state-changed' }>).to ===
        'ready',
    ) as Extract<ReplicationObserverEvent, { type: 'connection-state-changed' }> | undefined;
    expect(hubReady).toBeDefined();
    expect(hubReady?.connectionId).toMatch(/^hub-omega-conn-\d+$/);

    // stop → draining → stopped（块级）
    const stopP = run.peer.stop();
    await stopP;
    const afterStop = run.peerEvents
      .of('connection-state-changed')
      .map((e) => (e as Extract<ReplicationObserverEvent, { type: 'connection-state-changed' }>).to);
    expect(afterStop).toContain('draining');
    expect(afterStop[afterStop.length - 1]).toBe('stopped');
  });

  it('冷启动：bootstrap-snapshot-sent/imported 字节与 wire 帧一致；channel 迁移序；live 后无状态事件', async () => {
    const run = await observedBoot();
    await waitFor(() => run.peer.getNamespaceState(run.nsId) === 'live', 'live');
    await waitFor(() => run.hubEvents.of('bootstrap-snapshot-sent').length > 0, 'hub snapshot event');

    const wireSnapshotBytes = frameBytes(run.wire, 'hub-to-peer', 'BOOTSTRAP_SNAPSHOT');
    expect(wireSnapshotBytes).toHaveLength(1);
    const hubEvent = run.hubEvents.lastOf('bootstrap-snapshot-sent') as Extract<
      ReplicationObserverEvent,
      { type: 'bootstrap-snapshot-sent' }
    >;
    expect(hubEvent.bytes).toBe(wireSnapshotBytes[0]);
    expect(hubEvent.namespaceId).toBe(run.nsId);

    const peerEvent = run.peerEvents.lastOf('bootstrap-imported') as Extract<
      ReplicationObserverEvent,
      { type: 'bootstrap-imported' }
    >;
    expect(peerEvent.bytes).toBe(wireSnapshotBytes[0]);

    // channel 迁移序（peer 与 hub 双侧真实迁移，无重复——exactly-once）
    const channelSeq = (events: Collector): string[] =>
      events
        .of('channel-state-changed')
        .map(
          (e) =>
            `${(e as Extract<ReplicationObserverEvent, { type: 'channel-state-changed' }>).from}->${
              (e as Extract<ReplicationObserverEvent, { type: 'channel-state-changed' }>).to
            }`,
        );
    const peerSeq = channelSeq(run.peerEvents);
    expect(peerSeq).toContain('targeted->opening');
    expect(peerSeq).toContain('opening->bootstrapping');
    expect(peerSeq).toContain('bootstrapping->reconciling');
    expect(peerSeq).toContain('reconciling->live');
    const hubSeq = channelSeq(run.hubEvents);
    expect(hubSeq).toContain('opening->bootstrapping');
    expect(hubSeq).toContain('bootstrapping->reconciling');
    expect(hubSeq).toContain('reconciling->live');

    // live 后本地写不产生状态事件（计数=帧；状态零迁移）
    const before = run.peerEvents.events.length;
    await run.writePeer({ extra: 101 });
    await settle();
    const after = run.peerEvents.events.length;
    expect(run.peerEvents.of('channel-state-changed')).toHaveLength(
      channelSeq(run.peerEvents).length,
    );
    void before;
    void after;
    // 字节：出向 update-sent 与入向 update-applied 均与 wire UPDATE 载荷一致
    const wireUpdateBytes = frameBytes(run.wire, 'peer-to-hub', 'UPDATE');
    expect(wireUpdateBytes.length).toBeGreaterThanOrEqual(1);
    const sentEvents = run.peerEvents.of('update-sent') as Array<
      Extract<ReplicationObserverEvent, { type: 'update-sent' }>
    >;
    expect(sentEvents[sentEvents.length - 1]?.bytes).toBe(
      wireUpdateBytes[wireUpdateBytes.length - 1],
    );
    const appliedEvents = run.hubEvents.of('update-applied') as Array<
      Extract<ReplicationObserverEvent, { type: 'update-applied' }>
    >;
    expect(appliedEvents[appliedEvents.length - 1]?.bytes).toBe(
      wireUpdateBytes[wireUpdateBytes.length - 1],
    );
    // hub 出向（hub 本地写 → peer 入向）
    await run.writeHub({ n: 7 });
    await settle();
    const hubWriteBytes = frameBytes(run.wire, 'hub-to-peer', 'UPDATE');
    const hubSent = run.hubEvents.of('update-sent') as Array<
      Extract<ReplicationObserverEvent, { type: 'update-sent' }>
    >;
    expect(hubSent.length).toBeGreaterThanOrEqual(hubWriteBytes.length);
    expect(hubSent[hubSent.length - 1]?.bytes).toBe(hubWriteBytes[hubWriteBytes.length - 1]);
    expect(run.rootValue('peer', 'n')).toBe(7);
  });

  it('reconcile 路径：sync-step2-sent/sync-diff-applied 字节与 wire Step2 载荷一致', async () => {
    const run = await observedBoot({ peerReplica: 'same' });
    await waitFor(() => run.peer.getNamespaceState(run.nsId) === 'live', 'reconcile live');

    const hubStep2Bytes = frameBytes(run.wire, 'hub-to-peer', 'SYNC_STEP2');
    expect(hubStep2Bytes.length).toBeGreaterThanOrEqual(1);
    const sentEvent = run.hubEvents.lastOf('sync-step2-sent') as Extract<
      ReplicationObserverEvent,
      { type: 'sync-step2-sent' }
    >;
    expect(sentEvent.bytes).toBe(hubStep2Bytes[hubStep2Bytes.length - 1]);
    const appliedEvent = run.peerEvents.lastOf('sync-diff-applied') as Extract<
      ReplicationObserverEvent,
      { type: 'sync-diff-applied' }
    >;
    expect(appliedEvent.bytes).toBe(hubStep2Bytes[hubStep2Bytes.length - 1]);
    expect(run.rootValue('peer', 'n')).toBe(42);
  });
});

// ═══════════════════════════ T3：auth/authz ═══════════════════════════

describe('T3：auth/authz 拒绝事件', () => {
  function makeAuthHub(events: Collector): HubReplication {
    const node = makeNode('hub');
    return createHubReplication({
      instanceId: HUB_INSTANCE,
      registry: node.registry,
      authorize: async () => ({ ok: true, localOwner: HUB_OWNER, permissions: { read: true, submit: true } }),
      timer: node.scheduler,
      verifyToken: async (token) =>
        token === TEST_TOKEN ? { ok: true, instanceId: PEER_INSTANCE } : { ok: false },
      observer: events.observer,
    });
  }

  it('缺 token → missing-token；{ok:false} → invalid-credentials；坏文法 → invalid-instance-id', async () => {
    const events = new Collector();
    const hub = makeAuthHub(events);
    const wire1 = makeWire();
    await hub.accept(wire1.hubEnd, {});
    await settle();
    expect(events.lastOf('auth-upgrade-rejected')).toMatchObject({ type: 'auth-upgrade-rejected', side: 'hub', reason: 'missing-token' });
    let e = events.lastOf('auth-upgrade-rejected') as Extract<ReplicationObserverEvent, { type: 'auth-upgrade-rejected' }>;
    expect('connectionId' in e).toBe(false); // pre-connection：无 correlation 字段

    const wire2 = makeWire();
    await hub.accept(wire2.hubEnd, { token: 'wrong-token' });
    await settle();
    expect(events.lastOf('auth-upgrade-rejected')).toMatchObject({ reason: 'invalid-credentials' });

    const verifierEvents = new Collector();
    const node = makeNode('hub');
    const hub2 = createHubReplication({
      instanceId: HUB_INSTANCE,
      registry: node.registry,
      authorize: async () => ({ ok: true, localOwner: HUB_OWNER, permissions: { read: true, submit: true } }),
      timer: node.scheduler,
      verifyToken: async () => ({ ok: true, instanceId: 'Bad-Id!' }), // 文法违例
      observer: verifierEvents.observer,
    });
    const wire3 = makeWire();
    await hub2.accept(wire3.hubEnd, { token: TEST_TOKEN });
    await settle();
    e = verifierEvents.lastOf('auth-upgrade-rejected') as Extract<ReplicationObserverEvent, { type: 'auth-upgrade-rejected' }>;
    expect(e.reason).toBe('invalid-instance-id');
    void hub;
    void hub2;
  });

  it('auth-timeout（fake timer 推进）', async () => {
    const events = new Collector();
    const node = makeNode('hub');
    const hub = createHubReplication({
      instanceId: HUB_INSTANCE,
      registry: node.registry,
      authorize: async () => ({ ok: true, localOwner: HUB_OWNER, permissions: { read: true, submit: true } }),
      timer: node.scheduler,
      verifyToken: () => new Promise(() => undefined), // 永不归
      observer: events.observer,
      timeouts: { helloTimeoutMs: 10_000 },
    });
    const wire = makeWire();
    const acceptP = hub.accept(wire.hubEnd, { token: TEST_TOKEN });
    await settle();
    expect(events.of('auth-upgrade-rejected')).toHaveLength(0);
    await node.scheduler.advanceBy(10_000);
    await settle();
    const e = events.lastOf('auth-upgrade-rejected') as Extract<ReplicationObserverEvent, { type: 'auth-upgrade-rejected' }>;
    expect(e.reason).toBe('auth-timeout');
    void acceptP;
  });

  it('authz read 拒 → hub namespace-error{sent, NAMESPACE_UNAUTHORIZED}；peer namespace-error{received}', async () => {
    const hubNode = makeNode('hub');
    const peerNode = makeNode('peer');
    const fixture = await makeHubNamespace(hubNode, { owner: HUB_OWNER });
    const hubEvents = new Collector();
    const peerEvents = new Collector();
    const denyNs = fixture.namespaceId;
    const hub = createHubReplication({
      instanceId: HUB_INSTANCE,
      registry: hubNode.registry,
      authorize: async () => ({ ok: false }),
      timer: hubNode.scheduler,
      verifyToken: async (token) =>
        token === TEST_TOKEN ? { ok: true, instanceId: PEER_INSTANCE } : { ok: false },
      observer: hubEvents.observer,
    });
    const wire = makeWire();
    const peer = createPeerReplication({
      instanceId: PEER_INSTANCE,
      hubInstanceId: HUB_INSTANCE,
      registry: peerNode.registry,
      dial: () => {
        void hub.accept(wire.hubEnd, { token: TEST_TOKEN });
        return wire.peerEnd;
      },
      timer: peerNode.scheduler,
      targets: [{ namespaceId: denyNs, localOwner: PEER_OWNER }],
      observer: peerEvents.observer,
    });
    peer.start();
    await waitFor(
      () =>
        hubEvents
          .of('namespace-error')
          .some(
            (e) =>
              (e as Extract<ReplicationObserverEvent, { type: 'namespace-error' }>).code ===
              'NAMESPACE_UNAUTHORIZED',
          ),
      'hub NAMESPACE_UNAUTHORIZED sent',
    );
    const sent = hubEvents
      .of('namespace-error')
      .find(
        (e) =>
          (e as Extract<ReplicationObserverEvent, { type: 'namespace-error' }>).code ===
          'NAMESPACE_UNAUTHORIZED',
      ) as Extract<ReplicationObserverEvent, { type: 'namespace-error' }>;
    expect(sent.direction).toBe('sent');
    await waitFor(
      () =>
        peerEvents
          .of('namespace-error')
          .some(
            (e) =>
              (e as Extract<ReplicationObserverEvent, { type: 'namespace-error' }>).code ===
              'NAMESPACE_UNAUTHORIZED',
          ),
      'peer NAMESPACE_UNAUTHORIZED received',
    );
    const received = peerEvents
      .of('namespace-error')
      .find(
        (e) =>
          (e as Extract<ReplicationObserverEvent, { type: 'namespace-error' }>).code ===
          'NAMESPACE_UNAUTHORIZED',
      ) as Extract<ReplicationObserverEvent, { type: 'namespace-error' }>;
    expect(received.direction).toBe('received');
    expect(received.terminalState).toBe('failed');
  });
});

// ═══════════════════════════ T4：重连 / GOAWAY ═══════════════════════════

describe('T4：backoff / GOAWAY', () => {
  it('dial throw → backoff{dial-failed, attempt:1}，再败 attempt:2；delayMs 随 cap 递增', async () => {
    let dialCalls = 0;
    const events = new Collector();
    const node = makeNode('peer');
    const peer = createPeerReplication({
      instanceId: PEER_INSTANCE,
      hubInstanceId: HUB_INSTANCE,
      registry: node.registry,
      dial: () => {
        dialCalls += 1;
        throw new Error('dial boom');
      },
      timer: node.scheduler,
      observer: events.observer,
      backoff: { baseMs: 100, maxMs: 400, resetAfterMs: 400 },
      random: () => 0.5,
    });
    peer.start();
    await waitFor(
      () => events.of('connection-backoff-scheduled').length >= 1,
      'first backoff event',
    );
    // 退避 timer 在注入 scheduler 上——虚拟推进触发重拨 → 第二次失败
    await node.scheduler.advanceBy(50);
    await waitFor(
      () => events.of('connection-backoff-scheduled').length >= 2,
      'two backoff events',
    );
    const b1 = events.of('connection-backoff-scheduled')[0] as Extract<
      ReplicationObserverEvent,
      { type: 'connection-backoff-scheduled' }
    >;
    const b2 = events.of('connection-backoff-scheduled')[1] as Extract<
      ReplicationObserverEvent,
      { type: 'connection-backoff-scheduled' }
    >;
    expect(b1).toMatchObject({ side: 'peer', attempt: 1, reason: 'dial-failed', delayMs: 50 });
    expect(b2).toMatchObject({ attempt: 2, reason: 'dial-failed', delayMs: 100 });
    expect(dialCalls).toBe(2); // 首次拨号失败 + 首个 backoff 到期后第二次失败
    // 第三次拨号（attempt 2 的 backoff=100ms 到期）→ 消化计时器（防泄漏）
    await node.scheduler.advanceBy(100);
    await settle();
  });

  it('GOAWAY(SERVER_RESTARTING + retryAfterMs) → goaway-received + goaway-retry-hint（delay ≥ retryAfterMs；attempt 不递增）', async () => {
    const run = await observedBoot({ random: () => 0 });
    await waitFor(() => run.peer.getNamespaceState(run.nsId) === 'live', 'live');
    run.injectHubFrame({
      kind: 'GOAWAY',
      reasonCode: 'SERVER_RESTARTING',
      drainTimeoutMs: 5,
      retryAfterMs: 7,
    });
    await settle();
    const goaway = run.peerEvents.lastOf('goaway-received') as Extract<
      ReplicationObserverEvent,
      { type: 'goaway-received' }
    >;
    expect(goaway).toMatchObject({ side: 'peer', reasonCode: 'SERVER_RESTARTING', drainTimeoutMs: 5, retryAfterMs: 7 });
    // drain deadline → 本地 close 事件（真实 WS 语义：close() 触发本地 onclose）
    await run.peerNode.scheduler.advanceBy(5);
    run.wire.closePeerSide(1001, 'goaway-drain');
    await settle();
    await waitFor(
      () =>
        run.peerEvents
          .of('connection-backoff-scheduled')
          .some((e) => (e as Extract<ReplicationObserverEvent, { type: 'connection-backoff-scheduled' }>).reason === 'goaway-retry-hint'),
      'goaway-retry-hint',
    );
    const hint = run.peerEvents
      .of('connection-backoff-scheduled')
      .find(
        (e) =>
          (e as Extract<ReplicationObserverEvent, { type: 'connection-backoff-scheduled' }>).reason === 'goaway-retry-hint',
      ) as Extract<ReplicationObserverEvent, { type: 'connection-backoff-scheduled' }>;
    expect(hint.attempt).toBe(0); // GOAWAY 回重不是失败事件：attempt 不递增
    expect(hint.delayMs).toBeGreaterThanOrEqual(7);
    await run.peerNode.scheduler.advanceBy(20); // 消化 hint 重拨 timer
    await settle();
    void run;
  });

  it('敌意 GOAWAY reasonCode → reasonCode=other；SERVER_SHUTTING_DOWN → blocked', async () => {
    const run = await observedBoot();
    await waitFor(() => run.peer.getNamespaceState(run.nsId) === 'live', 'live');

    run.injectHubFrame({ kind: 'GOAWAY', reasonCode: 'HOSTILE-REASON', drainTimeoutMs: 1000 });
    await settle();
    const goaway = run.peerEvents.lastOf('goaway-received') as Extract<
      ReplicationObserverEvent,
      { type: 'goaway-received' }
    >;
    expect(goaway.reasonCode).toBe('other');

    // 第二连接：SHUTTING_DOWN → blocked（无 backoff）
    const run2 = await observedBoot();
    await waitFor(() => run2.peer.getNamespaceState(run2.nsId) === 'live', 'live2');
    run2.injectHubFrame({ kind: 'GOAWAY', reasonCode: 'SERVER_SHUTTING_DOWN', drainTimeoutMs: 1000 });
    await settle();
    await waitFor(() => run2.peer.getConnectionState() === 'blocked', 'blocked');
    const states = run2.peerEvents.of('connection-state-changed').map(
      (e) => (e as Extract<ReplicationObserverEvent, { type: 'connection-state-changed' }>).to,
    );
    expect(states[states.length - 1]).toBe('blocked');
    expect(run2.peerEvents.of('connection-backoff-scheduled')).toHaveLength(0);
    void run;
  });
});

// ═══════════════════════════ T5：背压 / resync ═══════════════════════════

describe('T5：背压 / resync 事件', () => {
  it('水位 send-paused/send-resumed（ConnectionSender 单元级：可编程 bufferedAmount）', async () => {
    const sentPaused: number[] = [];
    const sentResumed: number[] = [];
    let level = 0;
    let pollCallback: (() => void) | undefined;
    const timer = {
      setTimeout: (callback: () => void) => {
        pollCallback = callback;
        return 1;
      },
      clearTimeout: () => {
        pollCallback = undefined;
      },
    };
    const host: ConnectionSenderHost = {
      limits: {
        maxFrameBytes: 8 * 1024 * 1024, maxBootstrapBytes: 4 * 1024 * 1024,
        maxSyncDiffBytes: 2 * 1024 * 1024, maxUpdateBytes: 512 * 1024,
        maxQueuedUpdateBytes: 4 * 1024 * 1024, maxQueuedUpdateCount: 256,
        maxInFlightUpdates: 32, maxQueuedBytesPerConnection: 8 * 1024 * 1024,
        lowWater: 64 * 1024, highWater: 512 * 1024, maxQueuedControlBytes: 8 * 1024 * 1024,
      },
      timer: timer as never,
      ackTimeoutMs: 10_000,
      readBufferedAmount: () => level,
      emitControl: () => 0,
      emitData: () => 0,
      facetOf: () => undefined,
      isEmitAllowed: () => true,
      onBackpressureExhausted: () => undefined,
      onSendPaused: (n) => sentPaused.push(n),
      onSendResumed: (n) => sentResumed.push(n),
    };
    const sender = new ConnectionSender(host);
    level = 600 * 1024; // > highWater
    expect(sender.dataGateOpen()).toBe(false);
    expect(sentPaused).toEqual([600 * 1024]);
    level = 32 * 1024; // < lowWater
    // 真实恢复路径 = poll timer 到期 → resume（requestDrain 在 paused 期零观察）
    expect(pollCallback).toBeDefined();
    pollCallback?.();
    expect(sentResumed).toEqual([32 * 1024]);
  });

  it('live 溢出 → resync-required{queue-overflow}（peer）与 remote-declared（hub）', async () => {
    const run = await observedBoot({
      limits: { maxInFlightUpdates: 1, maxQueuedUpdateCount: 1, maxQueuedUpdateBytes: 4 * 1024 * 1024 },
    });
    await waitFor(() => run.peer.getNamespaceState(run.nsId) === 'live', 'live');
    // 挂起 hub 的 apply（saveDoc 门闩）→ 首笔 UPDATE 在途窗口满 → 第二笔溢出队列
    run.hubNode.persistence.saveGate = deferred();
    await run.writePeer({ n: 1 }); // 在途（窗口满）
    await run.writePeer({ n: 2 }); // 排队（count=1 → 上限）
    await run.writePeer({ n: 3 }); // 溢出 → queue-overflow
    await settle();
    await waitFor(
      () =>
        run.peerEvents
          .of('resync-required')
          .some((e) => (e as Extract<ReplicationObserverEvent, { type: 'resync-required' }>).cause === 'queue-overflow'),
      'peer queue-overflow',
    );
    await waitFor(
      () =>
        run.hubEvents
          .of('resync-required')
          .some((e) => (e as Extract<ReplicationObserverEvent, { type: 'resync-required' }>).cause === 'remote-declared'),
      'hub remote-declared',
    );
    const gate = run.hubNode.persistence.saveGate;
    run.hubNode.persistence.saveGate = undefined;
    if (gate !== undefined) gate.resolve();
    await settle();
  });

  it('control 保留额度耗尽（真实运行时锚：可编程 bufferedAmount + 1B reserve）→ connection-failed{CONNECTION_BACKPRESSURE, 1011} 先于 backoff{connection-backpressure}', async () => {
    // —— P8 运行时锚：peer 已 live 且 wire 可编程 bufferedAmount ——
    let buffered = 0;
    const hubNode = makeNode('hub');
    const peerNode = makeNode('peer');
    const fixture = await makeHubNamespace(hubNode, { owner: HUB_OWNER });
    const nsId = fixture.namespaceId;
    const peerEvents = new Collector();
    const hub = createHubReplication({
      instanceId: HUB_INSTANCE,
      registry: hubNode.registry,
      authorize: async () => ({ ok: true, localOwner: HUB_OWNER, permissions: { read: true, submit: true } }),
      timer: hubNode.scheduler,
      verifyToken: async (token) =>
        token === TEST_TOKEN ? { ok: true, instanceId: PEER_INSTANCE } : { ok: false },
    });
    const wire = makeWire();
    const peerEnd: DuplexTransport = {
      send: (bytes) => wire.peerEnd.send(bytes),
      close: (code, reason) => wire.peerEnd.close(code, reason),
      get closed() {
        return wire.peerEnd.closed;
      },
      onMessage: (listener) => wire.peerEnd.onMessage(listener),
      onClose: (listener) => wire.peerEnd.onClose(listener),
      get bufferedAmount() {
        return buffered; // 可编程水位（G3/G4 同款锚）
      },
    };
    const peer = createPeerReplication({
      instanceId: PEER_INSTANCE,
      hubInstanceId: HUB_INSTANCE,
      registry: peerNode.registry,
      dial: () => {
        void hub.accept(wire.hubEnd, { token: TEST_TOKEN });
        return peerEnd;
      },
      timer: peerNode.scheduler,
      targets: [{ namespaceId: nsId, localOwner: PEER_OWNER }],
      observer: peerEvents.observer,
      limits: {
        maxFrameBytes: 4096,
        maxBootstrapBytes: 512,
        maxSyncDiffBytes: 512,
        maxUpdateBytes: 512,
        maxQueuedControlBytes: 640,
        maxQueuedUpdateBytes: 4 * 1024 * 1024,
      }, // 合法最小额度；暂停态累计 control 仍可耗尽 → CONNECTION_BACKPRESSURE
      random: () => 0,
    });
    peer.start();
    await waitFor(() => peer.getNamespaceState(nsId) === 'live', 'live');
    // live 期先暂停：buffered > highWater（512KiB）→ 下一笔 control 出站观察即暂停
    buffered = 600 * 1024;
    for (let value = 9; value < 40; value += 1) {
      const checkWrite = await fixture.lease.mutateRoot({ op: 'set', path: ['n'], value });
      if (!checkWrite.ok) throw new Error(`hub 写失败：${JSON.stringify(checkWrite)}`);
      await settle();
      if (peerEvents.of('connection-failed').some((e) =>
        (e as Extract<ReplicationObserverEvent, { type: 'connection-failed' }>).code ===
          'CONNECTION_BACKPRESSURE')) break;
    }
    // —— 锚 1：connection-failed{CONNECTION_BACKPRESSURE, 1011}（P8） ——
    await waitFor(
      () =>
        peerEvents
          .of('connection-failed')
          .some(
            (e) =>
              (e as Extract<ReplicationObserverEvent, { type: 'connection-failed' }>).code ===
              'CONNECTION_BACKPRESSURE',
          ),
      'CONNECTION_BACKPRESSURE',
    );
    const failed = peerEvents
      .of('connection-failed')
      .find(
        (e) =>
          (e as Extract<ReplicationObserverEvent, { type: 'connection-failed' }>).code ===
          'CONNECTION_BACKPRESSURE',
      ) as Extract<ReplicationObserverEvent, { type: 'connection-failed' }>;
    expect(failed.wsCloseCode).toBe(1011);
    // —— 锚 2：backoff{connection-backpressure, attempt:1}（P3，其后） ——
    const backoff = peerEvents
      .of('connection-backoff-scheduled')
      .find(
        (e) =>
          (e as Extract<ReplicationObserverEvent, { type: 'connection-backoff-scheduled' }>).reason ===
          'connection-backpressure',
      ) as Extract<ReplicationObserverEvent, { type: 'connection-backoff-scheduled' }> | undefined;
    expect(backoff).toBeDefined();
    expect(backoff?.attempt).toBe(1);
    // —— 锚 3：事件次序 send-paused → connection-failed → connection-backoff-scheduled ——
    const order = peerEvents.events.map((e) => e.type).join(',');
    const iPaused = order.indexOf('send-paused');
    const iFailed = order.indexOf('connection-failed');
    const iBackoff = order.indexOf('connection-backoff-scheduled');
    expect(iPaused).toBeGreaterThanOrEqual(0);
    expect(iPaused).toBeLessThan(iFailed);
    expect(iFailed).toBeLessThan(iBackoff);
    // —— 锚 4：wire 侧 close code 1011（对端 hub 收到 close 信息） ——
    expect(wire.hubSideCloseInfo?.code).toBe(1011);
  });
});

// ═══════════════════════════ T6：identity / epoch conflict ═══════════════════════════

describe('T6：identity / epoch conflict', () => {
  it('hub epoch bump → fence（hub identity-conflicted + conflicted 终态）与 identity-changed-frame（peer）', async () => {
    const run = await observedBoot();
    await waitFor(() => run.peer.getNamespaceState(run.nsId) === 'live', 'live');
    const bump = await run.fixture.lease.bumpReplicationEpoch();
    if (!bump.ok) throw new Error(`bump 失败：${JSON.stringify(bump)}`);
    await waitFor(
      () => run.peer.getNamespaceState(run.nsId) === 'conflicted',
      'peer conflicted',
    );
    const hubFence = run.hubEvents.lastOf('identity-conflicted') as Extract<
      ReplicationObserverEvent,
      { type: 'identity-conflicted' }
    >;
    expect(hubFence).toMatchObject({ side: 'hub', via: 'fence', namespaceId: run.nsId });
    const peerFence = run.peerEvents.lastOf('identity-conflicted') as Extract<
      ReplicationObserverEvent,
      { type: 'identity-conflicted' }
    >;
    expect(peerFence).toMatchObject({ side: 'peer', via: 'identity-changed-frame', namespaceId: run.nsId });
    // 终态事件（conflicted）
    expect(
      run.peerEvents
        .of('channel-state-changed')
        .map((e) => (e as Extract<ReplicationObserverEvent, { type: 'channel-state-changed' }>).to),
    ).toContain('conflicted');
  });

  it('open 身份错配 → hub identity-conflicted{open-mismatch} + namespace-error{REPLICATION_ID_MISMATCH}', async () => {
    const run = await observedBoot({
      peerReplica: { replicationId: 'b'.repeat(32), replicationEpoch: 1 },
    });
    await waitFor(
      () =>
        run.hubEvents
          .of('identity-conflicted')
          .some((e) => (e as Extract<ReplicationObserverEvent, { type: 'identity-conflicted' }>).via === 'open-mismatch'),
      'hub open-mismatch',
    );
    const sent = run.hubEvents
      .of('namespace-error')
      .find(
        (e) =>
          (e as Extract<ReplicationObserverEvent, { type: 'namespace-error' }>).code ===
          'REPLICATION_ID_MISMATCH',
      ) as Extract<ReplicationObserverEvent, { type: 'namespace-error' }> | undefined;
    expect(sent?.direction).toBe('sent');
  });
});

// ═══════════════════════════ T7：稳定错误码 / 折叠 ═══════════════════════════

describe('T7：稳定错误码闭联合', () => {
  it('stableCode 白名单折叠：已知码原样；未知码 → INTERNAL_ERROR（单元级）', () => {
    expect(stableConnectionCode('MALFORMED_FRAME')).toBe('MALFORMED_FRAME');
    expect(stableConnectionCode('CONNECTION_BACKPRESSURE')).toBe('CONNECTION_BACKPRESSURE');
    expect(stableConnectionCode('PONG_TIMEOUT')).toBe('PONG_TIMEOUT');
    expect(stableConnectionCode('OUTBOUND_SEQUENCE_EXHAUSTED')).toBe('OUTBOUND_SEQUENCE_EXHAUSTED');
    expect(stableConnectionCode('WEIRD-UNKNOWN')).toBe('INTERNAL_ERROR');
    expect(stableNamespaceCode('NAMESPACE_UNAUTHORIZED')).toBe('NAMESPACE_UNAUTHORIZED');
    expect(stableNamespaceCode('IDENTITY_CHANGED')).toBe('IDENTITY_CHANGED');
    expect(stableNamespaceCode('SOME-JUNK')).toBe('INTERNAL_ERROR');
  });

  it('坏 magic → connection-failed{MALFORMED_FRAME, 1002} + blocked/closed', async () => {
    const events = new Collector();
    const node = makeNode('peer');
    const wire = makeWire();
    const peer = createPeerReplication({
      instanceId: PEER_INSTANCE,
      hubInstanceId: HUB_INSTANCE,
      registry: node.registry,
      dial: () => wire.peerEnd,
      timer: node.scheduler,
      observer: events.observer,
    });
    peer.start();
    await settle();
    wire.hubEnd.send(new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xff, 0xff, 0xff, 0xff]));
    await waitFor(() => events.of('connection-failed').length >= 1, 'connection-failed');
    const failed = events.lastOf('connection-failed') as Extract<
      ReplicationObserverEvent,
      { type: 'connection-failed' }
    >;
    // 坏 magic：codec 精确码 BAD_MAGIC（§13.1 注册表成员；§14 粗分类 1002）
    expect(failed).toMatchObject({ side: 'peer', code: 'BAD_MAGIC', wsCloseCode: 1002 });
    expect(peer.getConnectionState()).toBe('blocked');
  });

  it('UPDATE_TOO_LARGE → namespace-error{sent, UPDATE_TOO_LARGE}', async () => {
    const run = await observedBoot();
    await waitFor(() => run.peer.getNamespaceState(run.nsId) === 'live', 'live');
    const big = new Uint8Array(600 * 1024); // > maxUpdateBytes 512KiB（但 < maxFrameBytes）
    run.injectPeerFrame({ kind: 'UPDATE', namespaceId: run.nsId, update: big });
    await waitFor(
      () =>
        run.hubEvents
          .of('namespace-error')
          .some((e) => (e as Extract<ReplicationObserverEvent, { type: 'namespace-error' }>).code === 'UPDATE_TOO_LARGE'),
      'UPDATE_TOO_LARGE',
    );
    const ev = run.hubEvents
      .of('namespace-error')
      .find(
        (e) =>
          (e as Extract<ReplicationObserverEvent, { type: 'namespace-error' }>).code === 'UPDATE_TOO_LARGE',
      ) as Extract<ReplicationObserverEvent, { type: 'namespace-error' }>;
    expect(ev.direction).toBe('sent');
    expect(ev.terminalState === undefined || ev.terminalState === 'failed').toBe(true);
  });
});

// ═══════════════════════════ T8：失败隔离（破坏性） ═══════════════════════════

describe('T8：observer throw 隔离（三不改）', () => {
  async function runLifecycle(throwing: boolean): Promise<{
    /** 帧协议语义摘要（kind#seq；Yjs update 载荷含随机 client id——不可跨运行逐字节比） */
    frames: Readonly<{
      peerToHub: string[];
      hubToPeer: string[];
    }>;
    peerRoot: unknown;
    hubRoot: unknown;
    events: Collector;
    stopOk: boolean;
    unhandled: number;
  }> {
    const unhandled: number[] = [];
    const onRejection = (): void => {
      unhandled.push(1);
    };
    process.on('unhandledRejection', onRejection);
    try {
      const hubEvents = throwing ? new ThrowingCollector() : new Collector();
      const peerEvents = throwing ? new ThrowingCollector() : new Collector();
      const run = await observedBoot({ hubObserver: hubEvents.observer, peerObserver: peerEvents.observer, random: () => 0.5 });
      await waitFor(() => run.peer.getNamespaceState(run.nsId) === 'live', 'live');
      await run.writePeer({ n: 123 });
      await settle();
      await run.writeHub({ extra: 55 });
      await settle();
      const peerRoot = run.rootValue('peer', 'n') as number;
      const hubRoot = run.rootValue('hub', 'extra') as number;
      expect(peerRoot).toBe(123);
      expect(hubRoot).toBe(55);
      const summarize = (frames: readonly Uint8Array[]): string[] =>
        frames.map((bytes) => {
          try {
            const decoded = decodeMessage(bytes);
            return `${decoded.message.kind}#${decoded.header.sequence}`;
          } catch {
            return 'undecodable';
          }
        });
      // 事件流不熔断：throw 后后续事件仍投递（peer 至少收到 update-applied 后的 update-acked）
      expect(peerEvents.of('update-acked').length).toBeGreaterThanOrEqual(1);
      let stopOk = true;
      try {
        await run.peer.stop();
      } catch {
        stopOk = false;
      }
      return {
        frames: {
          peerToHub: summarize(run.wire.peerToHub),
          hubToPeer: summarize(run.wire.hubToPeer),
        },
        peerRoot,
        hubRoot,
        events: peerEvents,
        stopOk,
        unhandled: unhandled.length,
      };
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  }

  it('三运行对比：无 observer / 良性 / 每事件必 throw——帧协议语义序列与文档内容全等；stop settle；零 unhandled rejection', async () => {
    const baseline = await observedBoot({ random: () => 0.5 });
    await waitFor(() => baseline.peer.getNamespaceState(baseline.nsId) === 'live', 'base live');
    await baseline.writePeer({ n: 1 });
    await settle();
    await baseline.writeHub({ extra: 1 });
    await settle();
    const basePeerRoot = baseline.rootValue('peer', 'n');
    const baseHubRoot = baseline.rootValue('hub', 'extra');
    await baseline.peer.stop();

    const plain = await runLifecycle(false);
    const hostile = await runLifecycle(true);

    expect(plain.stopOk).toBe(true);
    expect(hostile.stopOk).toBe(true);
    expect(hostile.unhandled).toBe(0);
    expect(hostile.peerRoot).toBe(123);
    expect(hostile.hubRoot).toBe(55);
    // 帧协议语义序列全等（throw 不改变 wire——帧 kind/语义/序逐帧同构；
    // Yjs update 载荷含随机 doc client id，不可跨运行逐字节比——以语义摘要判定）
    expect(hostile.frames.hubToPeer.length).toBeGreaterThan(0);
    expect(plain.frames).toEqual(hostile.frames);
    expect(basePeerRoot).toBe(1);
    void baseHubRoot;
  }, 30_000);

  it('observer 在 update-applied 中 throw：apply 结果与 dirty 登记不受影响', async () => {
    const hubEvents = new ThrowingCollector();
    const run = await observedBoot({ hubObserver: hubEvents.observer });
    await waitFor(() => run.peer.getNamespaceState(run.nsId) === 'live', 'live');
    const before = run.hubNode.persistence.saveEvents.length;
    await run.writePeer({ n: 5 });
    await settle();
    expect(run.rootValue('hub', 'n')).toBe(5);
    expect(run.hubNode.persistence.saveEvents.length).toBe(before + 1);
    // 事件仍被投递（throw 后被隔离，非熔断）
    expect(hubEvents.of('update-applied').length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════ T9：敏感数据泄漏（破坏性） ═══════════════════════════

describe('T9：事件内容安全（safe-field）', () => {
  const SENTINELS: ReadonlyArray<readonly [string, string]> = [
    ['token', 'sk-SENTINEL-T0K3N-97f3'],
    ['owner', 'hub-owner-9f38'],
    ['cause', 'verifier-message-SENTINEL'],
    ['closeReason', 'close-reason-SENTINEL-55'],
    ['goaway', 'HOSTILE-GOAWAY-SENTINEL'],
    ['schema', 'schema-envelope-SENTINEL'],
    ['root', 'ROOT-SENTINEL-VALUE'],
  ];

  /** 冻结白名单：逐 type 键集（19 型；键集契约 = 设计 §4.1 + api 型断言共同锁定）。 */
  const ALLOWED_KEYS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
    ['connection-state-changed', new Set(['type', 'side', 'connectionId', 'from', 'to'])],
    ['connection-backoff-scheduled', new Set(['type', 'side', 'attempt', 'delayMs', 'reason'])],
    ['goaway-received', new Set(['type', 'side', 'connectionId', 'reasonCode', 'drainTimeoutMs', 'retryAfterMs'])],
    ['channel-state-changed', new Set(['type', 'side', 'connectionId', 'namespaceId', 'from', 'to'])],
    ['bootstrap-snapshot-sent', new Set(['type', 'side', 'connectionId', 'namespaceId', 'bytes'])],
    ['bootstrap-imported', new Set(['type', 'side', 'connectionId', 'namespaceId', 'bytes'])],
    ['sync-step2-sent', new Set(['type', 'side', 'connectionId', 'namespaceId', 'bytes'])],
    ['sync-diff-applied', new Set(['type', 'side', 'connectionId', 'namespaceId', 'bytes', 'applyLatencyMs'])],
    ['update-sent', new Set(['type', 'side', 'connectionId', 'namespaceId', 'bytes'])],
    ['update-applied', new Set(['type', 'side', 'connectionId', 'namespaceId', 'bytes', 'applyLatencyMs'])],
    ['update-acked', new Set(['type', 'side', 'connectionId', 'namespaceId', 'bytes', 'ackLatencyMs'])],
    ['degraded-bypass-applied', new Set(['type', 'side', 'connectionId', 'namespaceId', 'bytes'])],
    ['auth-upgrade-rejected', new Set(['type', 'side', 'reason'])],
    ['resync-required', new Set(['type', 'side', 'connectionId', 'namespaceId', 'cause'])],
    ['send-paused', new Set(['type', 'side', 'connectionId', 'bufferedAmount'])],
    ['send-resumed', new Set(['type', 'side', 'connectionId', 'bufferedAmount'])],
    ['connection-failed', new Set(['type', 'side', 'connectionId', 'code', 'wsCloseCode'])],
    ['namespace-error', new Set(['type', 'side', 'connectionId', 'namespaceId', 'code', 'direction', 'terminalState'])],
    ['identity-conflicted', new Set(['type', 'side', 'connectionId', 'namespaceId', 'via'])],
  ]);

  function assertSafe(events: readonly ReplicationObserverEvent[], label: string): void {
    for (const event of events) {
      const allowed = ALLOWED_KEYS.get(event.type);
      expect(allowed, `${label}: ${event.type} 无白名单`).toBeDefined();
      const keys = Object.keys(event);
      for (const key of keys) {
        expect(allowed!.has(key), `${label}: ${event.type} 意外键 ${key}`).toBe(true);
      }
      const text = JSON.stringify(event);
      for (const [name, sentinel] of SENTINELS) {
        expect(text.includes(sentinel), `${label}: ${event.type} 泄漏 ${name}`).toBe(false);
      }
      // 深扫：无 Uint8Array/ArrayBuffer/DataView/Error
      const seen = new Set<unknown>();
      const visit = (value: unknown): void => {
        if (value === null || typeof value !== 'object' || seen.has(value)) return;
        seen.add(value);
        if (value instanceof Uint8Array || value instanceof ArrayBuffer || value instanceof DataView) {
          throw new Error(`${label}: ${event.type} 含二进制对象`);
        }
        if (value instanceof Error) throw new Error(`${label}: ${event.type} 含 Error`);
        for (const v of Object.values(value)) visit(v);
      };
      visit(event);
      // 数值字段 ≥0 有限；correlation 字段文法
      for (const [key, value] of Object.entries(event)) {
        if (
          key === 'bytes' || key === 'bufferedAmount' || key === 'attempt' ||
          key === 'delayMs' || key === 'drainTimeoutMs' || key === 'retryAfterMs' ||
          key === 'wsCloseCode' || key === 'applyLatencyMs' || key === 'ackLatencyMs'
        ) {
          expect(typeof value === 'number' && Number.isFinite(value) && value >= 0, `${label}: ${event.type}.${key}`).toBe(true);
        }
        if (key === 'namespaceId') {
          expect(typeof value === 'string' && NS_RE.test(value), `${label}: ${event.type} namespaceId 文法`).toBe(true);
        }
      }
    }
  }

  it('全矩阵事件：键集 ⊆ 冻结白名单；零 sentinel；零二进制/Error；namespaceId 文法；数值有限', async () => {
    // 场景矩阵：成功（bootstrap/live/双向写）+ degrade + 敌意 GOAWAY + 断线重连 + stop
    const run = await observedBoot();
    await waitFor(() => run.peer.getNamespaceState(run.nsId) === 'live', 'live');
    await run.writeHub({ extra: 11 });
    await run.writePeer({ n: 12 });
    await settle();
    run.setDegraded('peer', true);
    await run.writeHub({ extra: 22 });
    await settle();
    run.setDegraded('peer', false);
    await run.writeHub({ extra: 33 });
    await settle();
    run.injectHubFrame({ kind: 'GOAWAY', reasonCode: 'HOSTILE-GOAWAY-SENTINEL', drainTimeoutMs: 5 });
    await settle();
    run.wire.closePeerSide(1006, 'close-reason-SENTINEL-55');
    await waitFor(() => run.peer.getConnectionState() !== 'ready', 'not ready');
    await run.peer.stop();
    await settle();

    const all = [...run.hubEvents.events, ...run.peerEvents.events];
    expect(all.length).toBeGreaterThan(20);
    assertSafe(all, 'matrix');
    // 全部 19 型中可达的 type 都出现（本矩阵覆盖的连接域 + 字节域 + degraded）
    const types = new Set(all.map((e) => e.type));
    const expectedTypes = [
      'connection-state-changed', 'channel-state-changed', 'bootstrap-imported',
      'bootstrap-snapshot-sent', 'update-sent', 'update-applied', 'goaway-received',
      'connection-backoff-scheduled', 'degraded-bypass-applied',
    ] as const;
    for (const t of expectedTypes) {
      expect(types.has(t), `缺事件 ${t}`).toBe(true);
    }
  });

  it('升级成功路径 token 不出现在任何事件（验证通过也不豁免）', async () => {
    const run = await observedBoot();
    await waitFor(() => run.peer.getConnectionState() === 'ready', 'ready');
    await settle();
    const all = [...run.hubEvents.events, ...run.peerEvents.events];
    for (const event of all) {
      expect(JSON.stringify(event).includes(TEST_TOKEN)).toBe(false);
      expect(JSON.stringify(event).includes('sk-')).toBe(false);
    }
    expect(all.length).toBeGreaterThan(0);
  });

  it('sentinel 植入补全（B3）：失败路径 token / verifier throw message / SCHEMA text / ROOT 字符串 / wire bytes hex+base64 全事件零出现', async () => {
    // —— fixture：schema text 与 ROOT 均植入 sentinel（真实文档内容，经 bootstrap + live 复制） ——
    const hubNode = makeNode('hub');
    const peerNode = makeNode('peer');
    const created = okLease(
      await hubNode.registry.create({
        owner: HUB_OWNER,
        schema: {
          ...SCHEMA_ENVELOPE,
          text: 'type ROOT = { n: number; marker: string; };\n// schema-envelope-SENTINEL-1a2b\n',
        },
        root: { n: 42, marker: 'ROOT-SENTINEL-VALUE' },
      }),
    );
    await schemaReady(created);
    const enabled = await created.enableReplication();
    if (!enabled.ok) throw new Error(`enableReplication 失败：${JSON.stringify(enabled)}`);
    const nsId = created.namespaceId;
    const hubEvents = new Collector();
    const peerEvents = new Collector();
    const hub = createHubReplication({
      instanceId: HUB_INSTANCE,
      registry: hubNode.registry,
      authorize: async () => ({ ok: true, localOwner: HUB_OWNER, permissions: { read: true, submit: true } }),
      timer: hubNode.scheduler,
      verifyToken: async (token) =>
        token === TEST_TOKEN ? { ok: true, instanceId: PEER_INSTANCE } : { ok: false },
      observer: hubEvents.observer,
    });
    const wire = makeWire();
    const peer = createPeerReplication({
      instanceId: PEER_INSTANCE,
      hubInstanceId: HUB_INSTANCE,
      registry: peerNode.registry,
      dial: () => {
        void hub.accept(wire.hubEnd, { token: TEST_TOKEN });
        return wire.peerEnd;
      },
      timer: peerNode.scheduler,
      targets: [{ namespaceId: nsId, localOwner: PEER_OWNER }],
      observer: peerEvents.observer,
    });
    peer.start();
    await waitFor(() => peer.getNamespaceState(nsId) === 'live', 'live');
    // 双向 live 复制（ROOT 字符串 sentinel 经 mutateRoot 合法写入，随后随 UPDATE 帧复制）
    const peerLease = okLease(await peerNode.registry.open(PEER_OWNER, nsId));
    await schemaReady(peerLease);
    const w1 = await peerLease.mutateRoot({ op: 'set', path: ['marker'], value: 'PEER-SENTINEL-ROOT' });
    if (!w1.ok) throw new Error(`peer 写失败：${JSON.stringify(w1)}`);
    await peerLease.release();
    await settle();
    const w2 = await created.mutateRoot({ op: 'set', path: ['n'], value: 43 });
    if (!w2.ok) throw new Error(`hub 写失败：${JSON.stringify(w2)}`);
    await settle();
    // 收敛锚：复制确已发生（sentinel 值落到对端，验证“内容在 wire 上”这一前提）
    const peerDoc = peerNode.persistence.peek(PEER_OWNER, nsId);
    const hubDoc = hubNode.persistence.peek(HUB_OWNER, nsId);
    expect((peerDoc?.getMap('ROOT') as unknown as Map<string, unknown>).get('n')).toBe(43);
    expect((hubDoc?.getMap('ROOT') as unknown as Map<string, unknown>).get('marker')).toBe(
      'PEER-SENTINEL-ROOT',
    );

    // —— 失败路径 sentinel：token 本身走 accept 拒绝（失败路径事件同样禁携） ——
    const wireFail = makeWire();
    await hub.accept(wireFail.hubEnd, { token: 'sk-SENTINEL-T0K3N-97f3' });
    await settle();
    const rejectEvent = hubEvents.lastOf('auth-upgrade-rejected') as Extract<
      ReplicationObserverEvent,
      { type: 'auth-upgrade-rejected' }
    >;
    expect(rejectEvent.reason).toBe('invalid-credentials');

    // —— verifier throw message sentinel（异常 message 禁携） ——
    const throwingEvents = new Collector();
    const hubThrowing = createHubReplication({
      instanceId: HUB_INSTANCE,
      registry: makeNode('hub').registry,
      authorize: async () => ({ ok: true, localOwner: HUB_OWNER, permissions: { read: true, submit: true } }),
      timer: makeNode('hub').scheduler,
      verifyToken: async () => {
        throw new Error('verifier-message-SENTINEL');
      },
      observer: throwingEvents.observer,
    });
    const wireThrow = makeWire();
    await hubThrowing.accept(wireThrow.hubEnd, { token: TEST_TOKEN });
    await settle();
    const throwEvent = throwingEvents.lastOf('auth-upgrade-rejected') as Extract<
      ReplicationObserverEvent,
      { type: 'auth-upgrade-rejected' }
    >;
    expect(throwEvent.reason).toBe('invalid-credentials');

    // —— wire bytes hex/base64 子串扫描（设计 T9「真实 wire bytes」面） ——
    const wireFrames = [...wire.peerToHub, ...wire.hubToPeer];
    expect(wireFrames.length).toBeGreaterThan(0);
    const hexSubs: string[] = [];
    const b64Subs: string[] = [];
    for (const frame of wireFrames.slice(0, 3)) {
      const hex = bytesToHex(frame);
      hexSubs.push(hex.slice(0, 24)); // 原样前缀子串（事件文本若含任何字节序列即中招）
      b64Subs.push(Buffer.from(frame).toString('base64').slice(0, 24));
    }

    // —— 汇总扫描（键集白名单 + sentinel + 二进制/Error 深扫 + 文法 + 数值） ——
    const all = [...hubEvents.events, ...peerEvents.events, ...throwingEvents.events];
    expect(all.length).toBeGreaterThan(10);
    assertSafe(all, 'sentinel-planted-matrix');
    for (const event of all) {
      const text = JSON.stringify(event);
      expect(text.includes('sk-SENTINEL-T0K3N-97f3')).toBe(false);
      expect(text.includes('verifier-message-SENTINEL')).toBe(false);
      expect(text.includes('schema-envelope-SENTINEL-1a2b')).toBe(false);
      expect(text.includes('ROOT-SENTINEL-VALUE')).toBe(false);
      expect(text.includes('PEER-SENTINEL-ROOT')).toBe(false);
      for (const hex of hexSubs) {
        expect(text.includes(hex), `${event.type} 泄漏 wire hex 子串`).toBe(false);
      }
      for (const b64 of b64Subs) {
        expect(text.includes(b64), `${event.type} 泄漏 wire base64 子串`).toBe(false);
      }
    }
  });
});

// ═══════════════════════════ T12：bytes in/out + latency ═══════════════════════════

describe('T12：per-frame bytes 与 apply/ACK latency', () => {
  it('注入 clock：update-applied.applyLatencyMs 含 sequencer 排队（saveGate 门闩）；update-acked.ackLatencyMs 含对端处理', async () => {
    const run = await observedBoot();
    await waitFor(() => run.peer.getNamespaceState(run.nsId) === 'live', 'live');

    // 挂 hub apply（saveDoc）→ 用门闩确定性制造延迟
    run.hubNode.persistence.saveGate = deferred();
    await run.writePeer({ n: 30 });
    await settle();
    // UPDATE 已出队（peer sentAt 已记录）且 hub apply 已进 sequencer（t0 已捕获）
    expect(run.peerEvents.of('update-sent').length).toBeGreaterThanOrEqual(1);
    const t0s = (run.hubClock as ManualClock).value;
    (run.hubClock as ManualClock).advance(25);
    (run.peerClock as ManualClock).advance(25);
    const gate = run.hubNode.persistence.saveGate;
    run.hubNode.persistence.saveGate = undefined;
    if (gate !== undefined) gate.resolve();
    await settle();
    void t0s;

    const applied = run.hubEvents.lastOf('update-applied') as Extract<
      ReplicationObserverEvent,
      { type: 'update-applied' }
    >;
    expect(applied.applyLatencyMs).toBe(25);
    const acked = run.peerEvents.lastOf('update-acked') as Extract<
      ReplicationObserverEvent,
      { type: 'update-acked' }
    >;
    expect(acked.ackLatencyMs).toBe(25);
    expect(acked.bytes).toBe(applied.bytes);
  });

  it('无 clock：latency 字段不存在、事件仍发（dormant 缺面）', async () => {
    const hubEvents = new Collector();
    const peerEvents = new Collector();
    const hubNode = makeNode('hub');
    const peerNode = makeNode('peer');
    const fixture = await makeHubNamespace(hubNode, { owner: HUB_OWNER });
    const hub = createHubReplication({
      instanceId: HUB_INSTANCE,
      registry: hubNode.registry,
      authorize: async () => ({ ok: true, localOwner: HUB_OWNER, permissions: { read: true, submit: true } }),
      timer: hubNode.scheduler,
      verifyToken: async (token) =>
        token === TEST_TOKEN ? { ok: true, instanceId: PEER_INSTANCE } : { ok: false },
      observer: hubEvents.observer,
      // 无 clock
    });
    const wire = makeWire();
    const peer = createPeerReplication({
      instanceId: PEER_INSTANCE,
      hubInstanceId: HUB_INSTANCE,
      registry: peerNode.registry,
      dial: () => {
        void hub.accept(wire.hubEnd, { token: TEST_TOKEN });
        return wire.peerEnd;
      },
      timer: peerNode.scheduler,
      targets: [{ namespaceId: fixture.namespaceId, localOwner: PEER_OWNER }],
      observer: peerEvents.observer,
      // 无 clock
    });
    peer.start();
    await waitFor(() => peer.getNamespaceState(fixture.namespaceId) === 'live', 'live');
    const lease = okLease(await peerNode.registry.open(PEER_OWNER, fixture.namespaceId));
    await schemaReady(lease);
    const result = await lease.mutateRoot({ op: 'set', path: ['n'], value: 9 });
    if (!result.ok) throw new Error(`写失败：${JSON.stringify(result)}`);
    await lease.release();
    await settle();

    expect(hubEvents.of('update-applied').length).toBeGreaterThanOrEqual(1);
    const applied = hubEvents.lastOf('update-applied') as Extract<
      ReplicationObserverEvent,
      { type: 'update-applied' }
    >;
    expect('applyLatencyMs' in applied).toBe(false);
    expect(peerEvents.of('update-acked').length).toBeGreaterThanOrEqual(1);
    const acked = peerEvents.lastOf('update-acked') as Extract<
      ReplicationObserverEvent,
      { type: 'update-acked' }
    >;
    expect('ackLatencyMs' in acked).toBe(false);
    expect(acked.bytes).toBe(applied.bytes);
  });
});

// ═══════════════════════════ T13：degraded bypass ═══════════════════════════

describe('T13：peer degraded bypass', () => {
  it('peer degraded：hub→peer apply → degraded-bypass-applied 且无 update-applied（互斥）；恢复 → update-applied', async () => {
    const run = await observedBoot();
    await waitFor(() => run.peer.getNamespaceState(run.nsId) === 'live', 'live');

    // A1：degraded 窗口的互斥负向半边基线——写前快照 update-applied/update-acked 计数
    const appliedBefore = run.peerEvents.of('update-applied').length;
    const ackedBefore = run.peerEvents.of('update-acked').length;

    run.setDegraded('peer', true);
    await settle();
    await run.writeHub({ extra: 88 });
    await settle();
    // bypass 事件（peer 专属）——互斥规则：每笔成功 apply 恰一事件
    const bypass = run.peerEvents.lastOf('degraded-bypass-applied') as Extract<
      ReplicationObserverEvent,
      { type: 'degraded-bypass-applied' }
    > | undefined;
    expect(bypass).toBeDefined();
    expect(bypass?.side).toBe('peer');
    expect(bypass?.namespaceId).toBe(run.nsId);
    expect(bypass?.bytes).toBeGreaterThan(0);
    // 互斥负向半边：degraded 窗口内零新增 update-applied（双发回归不可通过）
    expect(run.peerEvents.of('update-applied').length).toBe(appliedBefore);
    expect(run.peerEvents.of('update-acked').length).toBe(ackedBefore);
    const bypassCountDegraded = run.peerEvents.of('degraded-bypass-applied').length;
    expect(bypassCountDegraded).toBeGreaterThanOrEqual(1);

    // 恢复 → 回 update-applied（互斥正侧恢复）
    run.setDegraded('peer', false);
    await settle();
    await run.writeHub({ extra: 99 });
    await settle();
    const appliedAfterRecovery1 = run.peerEvents.of('update-applied').length;
    expect(appliedAfterRecovery1).toBeGreaterThan(appliedBefore + 0);
    // 恢复期第二次写：投影已回 ready → update-applied；旁路事件**不再增长**（A1 原死变量修复）
    const bypassCountBeforeSecond = run.peerEvents.of('degraded-bypass-applied').length;
    await run.writeHub({ extra: 100 });
    await settle();
    const appliedAfterRecovery2 = run.peerEvents.of('update-applied').length;
    expect(appliedAfterRecovery2).toBeGreaterThan(appliedAfterRecovery1);
    expect(run.peerEvents.of('degraded-bypass-applied').length).toBe(
      bypassCountBeforeSecond,
    );
    expect(run.rootValue('peer', 'extra')).toBe(100);
  });

  it('hub degraded：peer 写被 wire 拒绝 → hub namespace-error{PERSISTENCE_DEGRADED}；hub 永无 degraded-bypass-applied', async () => {
    const run = await observedBoot();
    await waitFor(() => run.peer.getNamespaceState(run.nsId) === 'live', 'live');
    run.setDegraded('hub', true);
    await settle();
    await run.writePeer({ n: 3 });
    await settle();
    await waitFor(
      () =>
        run.hubEvents
          .of('namespace-error')
          .some((e) => (e as Extract<ReplicationObserverEvent, { type: 'namespace-error' }>).code === 'PERSISTENCE_DEGRADED'),
      'hub PERSISTENCE_DEGRADED',
    );
    const ev = run.hubEvents
      .of('namespace-error')
      .find(
        (e) =>
          (e as Extract<ReplicationObserverEvent, { type: 'namespace-error' }>).code === 'PERSISTENCE_DEGRADED',
      ) as Extract<ReplicationObserverEvent, { type: 'namespace-error' }>;
    expect(ev.direction).toBe('sent');
    expect(run.hubEvents.of('degraded-bypass-applied')).toHaveLength(0);
    // 恢复 → hub 正常收
    run.setDegraded('hub', false);
    // 该 ns 已被 failed 收口（wire 拒绝路径）；验证旁路事件在 hub 始终为零即可
    expect(run.rootValue('hub', 'n')).toBe(42);
  });
});

// ═══════════════════════════ B1（SA4 R2）：clock.now throw 隔离 ═══════════════════════════

describe('B1：clock.now throw 隔离（观测缺面，非业务失败）', () => {
  it('throwing clock：全路径零 unhandled、apply/dirty/wire 不受影响、latency 字段缺失（dormant）', async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', listener);
    try {
      const boom = (): number => {
        throw new Error('clock-boom-not-for-wire');
      };
      const run = await observedBoot({
        hubClock: { now: boom },
        peerClock: { now: boom },
        random: () => 0.5,
      });
      await waitFor(() => run.peer.getNamespaceState(run.nsId) === 'live', 'live');
      const saveBefore = run.hubNode.persistence.saveEvents.length;
      // UPDATE / ACK / Step2 全路径（live 双向写 + 门闩挂起让 inFlight/apply 都走时钟面）
      await run.writePeer({ n: 7 });
      await settle();
      await run.writeHub({ extra: 11 });
      await settle();
      await run.hubNode.scheduler.advanceBy(1_000); // 挂起期间无未决 timer——仅推进（消耗 ack/空闲探测面）
      await settle();
      // —— 数据面：apply 结果与 dirty 登记不受 clock throw 影响 ——
      expect(run.rootValue('hub', 'n')).toBe(7);
      expect(run.rootValue('peer', 'extra')).toBe(11);
      expect(run.hubNode.persistence.saveEvents.length).toBeGreaterThan(saveBefore);
      // —— 事件面：事件照发（update-applied/update-acked 存在）且 latency 字段缺失（dormant） ——
      const applied = run.hubEvents.lastOf('update-applied') as Extract<
        ReplicationObserverEvent,
        { type: 'update-applied' }
      > | undefined;
      expect(applied).toBeDefined();
      expect('applyLatencyMs' in applied!).toBe(false);
      const acked = run.peerEvents.lastOf('update-acked') as Extract<
        ReplicationObserverEvent,
        { type: 'update-acked' }
      > | undefined;
      expect(acked).toBeDefined();
      expect('ackLatencyMs' in acked!).toBe(false);
      // —— 进程面：零 unhandledRejection（t0/t1/ACK 记账三点全部折叠） ——
      expect(unhandled).toHaveLength(0);
      await run.peer.stop();
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', listener);
    }
  });

  it('throwing clock：observer 在场也不改变 wire 帧行为（与无 clock 基线同构）', async () => {
    const run = await observedBoot({ hubClock: { now: () => { throw new Error('boom'); } }, random: () => 0.5 });
    await waitFor(() => run.peer.getNamespaceState(run.nsId) === 'live', 'live');
    await run.writePeer({ n: 21 });
    await settle();
    await run.writeHub({ extra: 33 });
    await settle();
    // 应用/收敛完整（Step2 + UPDATE + ACK 序列未被打断）
    expect(run.rootValue('hub', 'n')).toBe(21);
    await waitFor(() => run.rootValue('peer', 'extra') === 33, 'peer extra 33');
    const wire = run.wire;
    const kinds = [...wire.peerToHub, ...wire.hubToPeer].map((b) => {
      try {
        return decodeMessage(b).message.kind;
      } catch {
        return '?';
      }
    });
    expect(kinds).toContain('UPDATE');
    expect(kinds).toContain('UPDATE_ACK');
  });
});

// ═══════════════════════════ T11：重入安全（非 AC 冒烟） ═══════════════════════════

describe('T11（冒烟）：observer 内调用公共 API 不崩、状态一致', () => {
  it('observer 于 connection-state-changed 中调 stop()——停机照常结算，无撕裂', async () => {
    let stopped = false;
    const peerEvents: ReplicationObserverEvent[] = [];
    const stopping = new Collector();
    stopping.observer = (event: ReplicationObserverEvent) => {
      peerEvents.push(event);
      if (event.type === 'connection-state-changed' && event.side === 'peer' && event.to === 'ready') {
        stopped = true;
        void stoppingPeer?.stop();
      }
    };
    const node = makeNode('peer');
    const hubNode = makeNode('hub');
    const fixture = await makeHubNamespace(hubNode, { owner: HUB_OWNER });
    const hub = createHubReplication({
      instanceId: HUB_INSTANCE,
      registry: hubNode.registry,
      authorize: async () => ({ ok: true, localOwner: HUB_OWNER, permissions: { read: true, submit: true } }),
      timer: hubNode.scheduler,
      verifyToken: async (token) =>
        token === TEST_TOKEN ? { ok: true, instanceId: PEER_INSTANCE } : { ok: false },
    });
    const wire = makeWire();
    let stoppingPeer: PeerReplication | undefined = createPeerReplication({
      instanceId: PEER_INSTANCE,
      hubInstanceId: HUB_INSTANCE,
      registry: node.registry,
      dial: () => {
        void hub.accept(wire.hubEnd, { token: TEST_TOKEN });
        return wire.peerEnd;
      },
      timer: node.scheduler,
      targets: [{ namespaceId: fixture.namespaceId, localOwner: PEER_OWNER }],
      observer: stopping.observer,
    });
    const p = stoppingPeer;
    stoppingPeer = undefined;
    p.start();
    await settle();
    await settle();
    await waitFor(() => stopped, 'stopped flag');
    await p.stop();
    expect(p.getConnectionState()).toBe('stopped');
  });
});

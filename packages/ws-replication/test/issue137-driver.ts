/**
 * SA6 issue #137 测试驱动器 —— 单连接多 namespace 多路复用 + 有界公平背压。
 *
 * 与 driver.ts 的差异：多个 hub 命名空间（自定义 schema——含 blurb 字符串字段以构造
 * 大体积 update）、单一 peer 连接 multiplexing 全部 target、传输端 bufferedAmount
 * 压力注入（AC-6 seam——property 形态，duck-typed：实现经由
 * `transport.bufferedAmount` 读取，缺省 0 = 无压力，既有 harness 的 makeWire 不受影响）、
 * StubPersistence.saveGates 顺序门闩队列（AC-4/AC-5：分别悬挂两个 namespace 的
 * dirty notification，令两个 namespace 的发送窗口各自满）。
 *
 * 纪律与 driver.ts 相同：真实 yjs / Registry / Runtime 双实例；fake-duplex 内存双端；
 * 零 real sleep（fake scheduler + 微任务 + 门闩驱动）；零源码 grep 断言。
 */
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type {
  DuplexTransport,
  HubReplication,
  PeerConnectionState,
  PeerNamespaceState,
  PeerReplication,
  ReplicationLimits,
  ReplicationTimeouts,
} from '@nomicore/ws-replication';
import { decodeMessage, type DecodedMessage } from '@nomicore/replication-protocol';
import {
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  PEER_OWNER,
  deferred,
  makeNode,
  makeWire,
  okLease,
  schemaReady,
  settle,
  settleUntil,
  type Deferred,
  type ReplicaNode,
  type Wire,
} from './harness.js';

/** 命名空间 schema（blurb 字符串字段——大体积 update 注入锚）。 */
export const ISSUE137_SCHEMA = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'issue137-multiplex-backpressure',
  text: 'type ROOT = { n: number; blurb: string; };\n',
});

export interface Issue137BootOptions {
  readonly count?: number;
  readonly limits?: Readonly<Partial<ReplicationLimits>>;
  readonly timeouts?: Readonly<Partial<ReplicationTimeouts>>;
  /** 传输端暴露 bufferedAmount 压力属性（AC-6 seam；缺省 false——makeWire 原形，零压力）。 */
  readonly withPressure?: boolean;
}

export interface Run137 {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly nsIds: readonly string[];
  readonly wires: Wire[];
  readonly fixtures: ReadonlyMap<string, ReturnType<typeof okLease>>;
  wire(): Wire;
  peerWrite(nsId: string, value: Readonly<{ n?: number; blurb?: string }>): Promise<void>;
  hubWrite(nsId: string, value: Readonly<{ n?: number; blurb?: string }>): Promise<void>;
  setPeerPressure(bytes: number): void;
  setHubPressure(bytes: number): void;
  frames(dir: 'peerToHub' | 'hubToPeer'): DecodedMessage[];
  framesOf(dir: 'peerToHub' | 'hubToPeer', nsId: string): DecodedMessage[];
  frameKinds(dir: 'peerToHub' | 'hubToPeer'): string[];
  rootValue(side: 'hub' | 'peer', nsId: string, key: string): unknown;
  /** 依次挂起接下来 hub 侧 saveDoc 的门闩（顺序队列；供 AC-4/AC-5 悬挂多 ns 的 ACK）。 */
  holdHubSaveDocs(): Deferred[];
  states(): ReadonlyArray<Readonly<{ nsId: string; state: PeerNamespaceState | undefined }>>;
  connectionState(): PeerConnectionState;
}

/** 组装：count 个 hub 命名空间 + 单一 peer 连接（全部 target），等到全部 live。 */
export async function bootMulti(opts: Issue137BootOptions = {}): Promise<Run137> {
  const count = opts.count ?? 2;
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const fixtures = new Map<string, ReturnType<typeof okLease>>();
  const nsIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const lease = okLease(
      await hubNode.registry.create({
        owner: HUB_OWNER,
        schema: { ...ISSUE137_SCHEMA, id: `issue137-${index}` },
        root: { n: index + 1, blurb: 'seed' },
      }),
    );
    await schemaReady(lease);
    const enabled = await lease.enableReplication();
    if (!enabled.ok) throw new Error(`enableReplication 失败：${JSON.stringify(enabled)}`);
    fixtures.set(lease.namespaceId, lease);
    nsIds.push(lease.namespaceId);
  }

  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: hubNode.registry,
    authorize: async () => ({
      ok: true as const,
      localOwner: HUB_OWNER,
      permissions: { read: true, submit: true },
    }),
    timer: hubNode.scheduler,
    ...(opts.limits !== undefined ? { limits: opts.limits } : {}),
    ...(opts.timeouts !== undefined ? { timeouts: opts.timeouts } : {}),
  });

  const wires: Wire[] = [];
  let peerPressure = 0;
  let hubPressure = 0;
  let activeWire: Wire | undefined;
  const applyPressure = (transport: DuplexTransport, read: () => number): void => {
    Object.defineProperty(transport, 'bufferedAmount', {
      get: read,
      configurable: true,
    });
  };
  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      const wire = makeWire();
      wires.push(wire);
      activeWire = wire;
      if (opts.withPressure) {
        applyPressure(wire.peerEnd, () => peerPressure);
        applyPressure(wire.hubEnd, () => hubPressure);
      }
      hub.accept(wire.hubEnd);
      return wire.peerEnd;
    },
    timer: peerNode.scheduler,
    targets: nsIds.map((nsId) => ({ namespaceId: nsId, localOwner: PEER_OWNER })),
    ...(opts.limits !== undefined ? { limits: opts.limits } : {}),
    ...(opts.timeouts !== undefined ? { timeouts: opts.timeouts } : {}),
  });
  peer.start();
  await settleUntil(() => peer.getConnectionState() === 'ready', '连接 ready');
  await settleUntil(
    () => nsIds.every((nsId) => peer.getNamespaceState(nsId) === 'live'),
    `全部 namespace live（当前 ${nsIds.map((n) => `${n.slice(-2)}:${String(peer.getNamespaceState(n))}`).join(' ')}）`,
  );

  const write = async (
    node: ReplicaNode,
    owner: typeof PEER_OWNER | typeof HUB_OWNER,
    nsId: string,
    value: Readonly<{ n?: number; blurb?: string }>,
  ): Promise<void> => {
    const lease = okLease(await node.registry.open(owner, nsId));
    await schemaReady(lease);
    for (const [key, v] of Object.entries(value)) {
      const result = await lease.mutateRoot({ op: 'set', path: [key], value: v });
      if (!result.ok) throw new Error(`业务写失败：${JSON.stringify(result)}`);
    }
    await lease.release();
  };

  return {
    hubNode,
    peerNode,
    hub,
    peer,
    nsIds,
    wires,
    fixtures,
    wire: () => {
      if (activeWire === undefined) throw new Error('peer 尚未拨号');
      return activeWire;
    },
    peerWrite: async (nsId, value) => {
      // 业务写经单独 business lease（与 driver.writePeer 同构）；写完成 = 本地 sequencer
      // 槽已执行（「不阻塞 Runtime sequencer」的观察锚）。
      await write(peerNode, PEER_OWNER, nsId, value);
    },
    hubWrite: async (nsId, value) => {
      await write(hubNode, HUB_OWNER, nsId, value);
      await settle();
    },
    setPeerPressure: (bytes) => {
      peerPressure = bytes;
    },
    setHubPressure: (bytes) => {
      hubPressure = bytes;
    },
    frames: (dir) =>
      (activeWire === undefined ? [] : dir === 'peerToHub' ? activeWire.peerToHub : activeWire.hubToPeer).map(
        (bytes) => decodeMessage(bytes),
      ),
    framesOf: (dir, nsId) =>
      (activeWire === undefined ? [] : dir === 'peerToHub' ? activeWire.peerToHub : activeWire.hubToPeer)
        .map((bytes) => decodeMessage(bytes))
        .filter((f) => (f.message as { namespaceId?: string }).namespaceId === nsId),
    frameKinds: (dir) =>
      (activeWire === undefined ? [] : dir === 'peerToHub' ? activeWire.peerToHub : activeWire.hubToPeer).map(
        (bytes) => decodeMessage(bytes).message.kind,
      ),
    rootValue: (side, nsId, key) => {
      const node = side === 'hub' ? hubNode : peerNode;
      const owner = side === 'hub' ? HUB_OWNER : PEER_OWNER;
      const doc = node.persistence.peek(owner, nsId);
      if (doc === undefined) throw new Error(`${side} 缺副本 ${nsId}`);
      return (doc.getMap('ROOT') as unknown as Map<string, unknown>).get(key);
    },
    holdHubSaveDocs: () => {
      const gates = [deferred(), deferred()];
      hubNode.persistence.saveGates.push(...gates);
      return gates;
    },
    states: () =>
      nsIds.map((nsId) => ({ nsId, state: peer.getNamespaceState(nsId) })),
    connectionState: () => peer.getConnectionState(),
  };
}

/** 等待全部分组 namespace 进入给定状态集合（预算 4000 微任务；零 real sleep）。 */
export async function waitAllStates(
  run: Run137,
  wanted: ReadonlySet<PeerNamespaceState>,
): Promise<void> {
  await settleUntil(
    () => run.states().every(({ state }) => state !== undefined && wanted.has(state)),
    `全部 namespace 状态 ∈ [${[...wanted].join('|')}]（当前 ${run
      .states()
      .map(({ nsId, state }) => `${nsId.slice(-2)}:${String(state)}`)
      .join(' ')}）`,
  );
}

/**
 * SA6 红灯验收契约 —— issue #244（issue #233 切片 3）：分块传输有界性加固与中止清理
 * 矩阵（分块 transfer 在对抗与故障面前保持有界且自愈）。
 *
 * 契约面 = Host 简报 AC1–AC7 + ADR 0013（资源上限与配置链 / 接收端规则 / 中止清理 /
 * observer seam）+ SA8 前置门禁（artifacts/sa8-conflict-gate-issue-244.md）就绪注意项：
 *   R7（observer seam，含 chunked-update-aborted——reason 词表与中止矩阵一一平行，
 *     本契约按 ADR 0013「现行约束」把中止行的 aborted 事件并入断言面（R3/R5 逐字断言）；
 *   R8（protocol §17 配置链文档义务——记录于契约报告，非运行时断言）；
 *   R10（并发 assembly 超额 → UPDATE_TRANSFER_VIOLATION 是简报对 ADR 欠定点的显式
 *     裁决——本文件 R4 逐码断言该分类）。
 *
 * 契约史与现状（本文件 = iteration 0 批准契约 + iteration 1 修订补例；断言行为层逐字
 * 冻结，修订只增不改——已批准行为回归保护）：
 *
 * iteration 0（approve @ e2178f3）：切片 3 缺失面红灯断言 + 绿负控——
 *   R1a（AC1）配置链/缺省面；R1b（AC1）新键非法值 0 构造期 TypeError；
 *   R2（AC2/AC3 分类）chunkCount 超上限（> 缺省 64）→ UPDATE_TRANSFER_TOO_LARGE +
 *     ns 终局 failed + apply 前零写入；
 *   R3（AC4 + R7）assembly 停滞超 assemblyTimeoutMs（缺省 30_000，进度滑动）→ 弃
 *     partial + RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED} + chunked-update-aborted{timeout}
 *     + 对端按既有规则收口收敛；
 *   R4（AC3 + R10）连接级并发 assembly 超额（> maxConcurrentAssembliesPerConnection
 *     缺省 4）→ UPDATE_TRANSFER_VIOLATION 终局 failed，其余 4 个不受影响；
 *   R5a/R5b（AC5 + R7）中止矩阵 observer seam——CLOSE_NAMESPACE（channel-teardown）/
 *     连接断线（connection-teardown）弃忙 assembly 必须发射 chunked-update-aborted。
 *   N1 合法链配置构造成功 + 收敛 + 形状门回归；N2 chunkCount === 64（off-by-one）接纳；
 *   N3 完整 3-chunk transfer 收敛（fixture 哨兵）；N4 停滞 20s（< 30s 缺省）零误报。
 *
 * 实现基线（SA3 iteration 0/1，当前工作树 = 本文件运行对象）：设计 D1–D8 已落地
 * （含 SA4-1 槽位归还修复——其回归见 ws-replication-issue244-slot-reclaim-regression
 * .test.ts），iteration 0 的 11 用例现 **11/11 绿**（契约报告 §4/§13）。
 *
 * iteration 1（SA1 设计修订 §7-D1/§12 + SA8 design-recheck clear，R15–R19）：
 * SA4-2 收口的链生效口径 = **分块族链上键显式表达门**——调用方显式表达
 * `maxChunkedUpdateBytes` **或** `maxChunksPerUpdate`（两链不等式的分块族操作数键，
 * 均本切片家族引入）即对**合并结果**响亮校验两链；仅显式既有键（下调
 * maxQueuedUpdateBytes/maxUpdateBytes 等）、非链操作数新键、`chunkedUpdate` 旋钮均
 * 不激活链（design §7-D1 边界语义表）。现行实现只有单键门（仅显式 maxChunkedUpdateBytes
 * 激活：hub-connection.ts:195-202 / peer-connection.ts:109-116）。本 iteration 补 3 用例：
 *   R1c（红灯·SA4-2 落地序守卫，SA8 design-recheck §4-4 复核的算术边界）：显式
 *     `{maxChunksPerUpdate: 4}`（无 chunked 字节键、其余缺省）→ 合并结果链②
 *     （4MiB ≤ 4 × 512KiB = 2MiB）违例必须构造期 TypeError——现行单键门不抛（红）；
 *     SA3 门放宽（双激活键）后转绿——本用例保证「先契约后实现」顺序（§12 路由）。
 *   N5（负控·非追溯边界）：`{...LIMITS}`（显式下调既有键、**零**分块族键表达——
 *     SA8 R17：非「不含 maxChunkedUpdateBytes」的单键化措辞）双入口构造不抛——缺省
 *     envelope 不得被误判为用户配置错误（R2–R5/N2–N4 依赖该族构造成功）。
 *   N6（负控·激活键集闭合）：`{...LIMITS, maxConcurrentAssembliesPerConnection: 2}`
 *     双入口构造不抛——非链操作数键（并发/超时钮）不激活字节链（值门无条件照旧）。
 *   补例后契约 = 14 用例：R1c 红（现行门下）→ 门放宽后 14/14 绿；R1a/R1b/N1–N4 与
 *   R2–R5b 保持绿（门放宽不得误伤——同轮回归面）。
 *
 * 转绿假设：
 *   A1–A5（iteration 0 假设：count 上界/滑动超时/连接级并发上限/aborted 事件/超时
 *     容器）已由实现基线满足（按 ADR 0013 冻结语义 + 简报显式裁决落地，11/11 绿）；
 *   A6（本 iteration）：链激活 = 显式表达分块族链上键（`maxChunkedUpdateBytes` ∨
 *     `maxChunksPerUpdate`）→ 对合并结果响亮校验两链——R1c 红→绿判据；仅显式既有
 *     键/非链操作数键/旋钮均不激活（N5/N6 锁定边界语义表行 3/5/6）。
 *
 * 纪律与既有套件一致：真实 yjs / Registry / Runtime；fake-duplex + fake scheduler
 * （advanceBy 驱动全部虚拟时间）；零 real sleep；零源码 grep 断言；无 skip/only/todo；
 * 无 env override。测试文件在当前 HEAD 必须 tsc 干净（本文件不引用任何未实现的类型面）。
 */
import { describe, expect, it } from 'vitest';
import {
  createHubReplication,
  createPeerReplication,
  DEFAULT_REPLICATION_LIMITS,
  DEFAULT_REPLICATION_TIMEOUTS,
  type DuplexTransport,
  type HubReplication,
  type HubReplicationOptions,
  type PeerReplication,
  type PeerReplicationOptions,
  type ReplicationLimits,
  type ReplicationObserver,
  type ReplicationObserverEvent,
  type ReplicationTimeouts,
} from '@nomicore/ws-replication';
import type { NamespaceRegistry } from '@nomicore/namespace-registry';
import {
  CAP_CHUNKED_UPDATE,
  decodeMessage,
  encodeMessage,
  type DecodedMessage,
} from '@nomicore/replication-protocol';
import { DEFAULT_PEER_VERIFIER, TEST_TOKEN } from './driver.js';
import {
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  PEER_OWNER,
  makeNode,
  makeWire,
  okLease,
  schemaReady,
  settle,
  settleUntil,
  type ReplicaNode,
  type Wire,
} from './harness.js';

// ═══════════════════════════ 场景配置（虚拟时间；零 real sleep） ═══════════════════════════

const SCHEMA = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'issue244-chunked-ac',
  text: 'type ROOT = { n: number; blurb: string; };\n',
});

/** R1 同款极限构型：maxUpdateBytes=8KiB，大写 20KB → 目标分块 ≈3 帧。 */
const LIMITS: Readonly<Partial<ReplicationLimits>> = {
  maxUpdateBytes: 8 * 1024,
  maxQueuedUpdateCount: 100,
  maxQueuedUpdateBytes: 1 * 1024 * 1024,
  maxInFlightUpdates: 8,
};

const TIMEOUTS: Readonly<Partial<ReplicationTimeouts>> = {
  ackTimeoutMs: 60_000,
};

/** 大写（编码后 ≈20,029B > maxUpdateBytes 8KiB；chunkCount=3）。 */
const BIG = 'z'.repeat(20_000);

/** ADR 0013 配置表冻结缺省（slice 3 已实现落地；契约断言值）。 */
const DEFAULT_MAX_CHUNKS_PER_UPDATE = 64;
const DEFAULT_MAX_CONCURRENT_ASSEMBLIES = 4;
const DEFAULT_ASSEMBLY_TIMEOUT_MS = 30_000;

type ChunkMsg = Extract<DecodedMessage['message'], { kind: 'UPDATE_CHUNK' }>;
type AckMsg = Extract<DecodedMessage['message'], { kind: 'UPDATE_ACK' }>;
type ResyncMsg = Extract<DecodedMessage['message'], { kind: 'RESYNC_REQUIRED' }>;
type ErrorMsg = Extract<DecodedMessage['message'], { kind: 'ERROR' }>;
type ResyncEvent = Extract<ReplicationObserverEvent, { type: 'resync-required' }>;

/** 中止事件（ADR 0013 observer seam；当前 HEAD 尚未进入事件联合——测试侧投影类型）。 */
interface ChunkedAbortedLike {
  readonly type: 'chunked-update-aborted';
  readonly namespaceId: string;
  readonly transferId: number;
  readonly reason: string;
  readonly receivedChunks: number;
  readonly receivedBytes: number;
}

function makeCollector(): { events: ReplicationObserverEvent[]; observer: ReplicationObserver } {
  const events: ReplicationObserverEvent[] = [];
  return {
    events,
    observer: (event: ReplicationObserverEvent): void => {
      events.push(event);
    },
  };
}

function decodeWire(bytes: Uint8Array): DecodedMessage {
  return decodeMessage(bytes, { selectedCapabilities: CAP_CHUNKED_UPDATE });
}

function abortedLike(events: readonly ReplicationObserverEvent[]): ChunkedAbortedLike[] {
  return events.filter(
    (e): e is ReplicationObserverEvent & ChunkedAbortedLike =>
      (e as { type?: string }).type === 'chunked-update-aborted',
  ) as unknown as ChunkedAbortedLike[];
}

function failedEvents(events: readonly ReplicationObserverEvent[]): ReplicationObserverEvent[] {
  return events.filter((e) => e.type === 'namespace-failed');
}

function resyncEvents(events: readonly ReplicationObserverEvent[]): ResyncEvent[] {
  return events.filter((e): e is ResyncEvent => e.type === 'resync-required');
}

// ═══════════════════════════ data 水位暂停代理（transport seam，非协议实现） ═══════════════════════════

const PAUSE_HIGH = 600 * 1024; // > 缺省 highWater 512KiB
const PAUSE_LOW = 0; // ≤ 缺省 lowWater 64KiB → 观察即恢复

/** 第 N 个 data 帧（UPDATE/UPDATE_CHUNK）出站后把 bufferedAmount 抬到 high → 发送方
 *  暂停（transfer 中途停摆的可控构造）；release() 归零 → poll/观察恢复 → drain 续排。 */
function withDataPauseProxy(
  end: DuplexTransport,
  opts: { pauseAfterDataFrames: number; high: number; low: number },
): { end: DuplexTransport; release(): void } {
  let dataFrames = 0;
  let level = 0;
  const wrapped: DuplexTransport = {
    send(bytes) {
      end.send(bytes);
      let kind: string;
      try {
        kind = decodeWire(bytes).message.kind;
      } catch {
        kind = '?';
      }
      if (kind === 'UPDATE' || kind === 'UPDATE_CHUNK') {
        dataFrames += 1;
        if (dataFrames === opts.pauseAfterDataFrames) level = opts.high;
      }
    },
    close(code?: number, reason?: string) {
      end.close(code, reason);
    },
    get closed() {
      return end.closed;
    },
    onMessage(listener) {
      return end.onMessage(listener);
    },
    onClose(listener) {
      return end.onClose(listener);
    },
    get bufferedAmount() {
      return level;
    },
  };
  return {
    end: wrapped,
    release: () => {
      level = opts.low;
    },
  };
}

/** 起始即暂停的 data 闸门（boot 完成前把全部大写排进队列），第 N 个 data 帧出站后
 *  自动再暂停（多 ns 并发 assembly 的逐帧可控构造）；open() 每次调用都归零恢复。 */
function withGatedStartProxy(
  end: DuplexTransport,
  opts: { autoPauseAfterDataFrames: number; high: number; low: number },
): { end: DuplexTransport; open(): void } {
  let dataFrames = 0;
  let level = opts.high;
  const wrapped: DuplexTransport = {
    send(bytes) {
      end.send(bytes);
      let kind: string;
      try {
        kind = decodeWire(bytes).message.kind;
      } catch {
        kind = '?';
      }
      if (kind === 'UPDATE' || kind === 'UPDATE_CHUNK') {
        dataFrames += 1;
        if (dataFrames === opts.autoPauseAfterDataFrames) level = opts.high;
      }
    },
    close(code?: number, reason?: string) {
      end.close(code, reason);
    },
    get closed() {
      return end.closed;
    },
    onMessage(listener) {
      return end.onMessage(listener);
    },
    onClose(listener) {
      return end.onClose(listener);
    },
    get bufferedAmount() {
      return level;
    },
  };
  return {
    end: wrapped,
    open: () => {
      level = opts.low;
    },
  };
}

// ═══════════════════════════ 本地组装（单 ns；knob-on 真协商） ═══════════════════════════

interface SingleContext {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly nsId: string;
  readonly peerEvents: ReplicationObserverEvent[];
  readonly hubEvents: ReplicationObserverEvent[];
  readonly releasePeer: (() => void) | undefined;
  getWire(): Wire;
  peerWrite(value: Readonly<{ n?: number; blurb?: string }>): Promise<void>;
  frames(dir: 'peerToHub' | 'hubToPeer', nsId?: string): DecodedMessage[];
  chunks(dir: 'peerToHub' | 'hubToPeer'): ChunkMsg[];
  rootValue(side: 'hub' | 'peer', key: 'blurb' | 'n'): unknown;
  hubSaveCount(docId: string): number;
  advance(ms: number): Promise<void>;
}

async function bootSingle(opts: {
  limits?: Readonly<Partial<ReplicationLimits>>;
  timeouts?: Readonly<Partial<ReplicationTimeouts>>;
  pausePeerAfterDataFrames?: number;
}): Promise<SingleContext> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const lease = okLease(
    await hubNode.registry.create({
      owner: HUB_OWNER,
      schema: SCHEMA,
      root: { n: 1, blurb: 'seed' },
    }),
  );
  await schemaReady(lease);
  const enabled = await lease.enableReplication();
  if (!enabled.ok) throw new Error(`enableReplication 失败：${JSON.stringify(enabled)}`);
  const nsId = lease.namespaceId;

  const peerEvents = makeCollector();
  const hubEvents = makeCollector();
  let activeWire: Wire | undefined;
  let peerRelease: (() => void) | undefined;

  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: hubNode.registry,
    authorize: async () => ({
      ok: true as const,
      localOwner: HUB_OWNER,
      permissions: { read: true, submit: true },
    }),
    timer: hubNode.scheduler,
    verifyToken: DEFAULT_PEER_VERIFIER,
    limits: opts.limits ?? LIMITS,
    timeouts: opts.timeouts ?? TIMEOUTS,
    observer: hubEvents.observer,
  });

  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      const wire = makeWire();
      const wrapped =
        opts.pausePeerAfterDataFrames === undefined
          ? wire.peerEnd
          : (() => {
              const p = withDataPauseProxy(wire.peerEnd, {
                pauseAfterDataFrames: opts.pausePeerAfterDataFrames!,
                high: PAUSE_HIGH,
                low: PAUSE_LOW,
              });
              peerRelease = p.release;
              return p.end;
            })();
      activeWire = wire;
      void hub.accept(wire.hubEnd, { token: TEST_TOKEN });
      return wrapped;
    },
    timer: peerNode.scheduler,
    targets: [{ namespaceId: nsId, localOwner: PEER_OWNER }],
    limits: opts.limits ?? LIMITS,
    timeouts: opts.timeouts ?? TIMEOUTS,
    observer: peerEvents.observer,
    chunkedUpdate: true,
  });

  peer.start();
  await settleUntil(() => peer.getConnectionState() === 'ready', '连接 ready');
  await settleUntil(() => peer.getNamespaceState(nsId) === 'live', 'namespace live');

  return {
    hubNode,
    peerNode,
    hub,
    peer,
    nsId,
    peerEvents: peerEvents.events,
    hubEvents: hubEvents.events,
    releasePeer: peerRelease,
    getWire: () => {
      if (activeWire === undefined) throw new Error('peer 尚未拨号');
      return activeWire;
    },
    peerWrite: async (value) => {
      const business = okLease(await peerNode.registry.open(PEER_OWNER, nsId));
      await schemaReady(business);
      for (const [key, v] of Object.entries(value)) {
        const result = await business.mutateData({ op: 'set', path: [key], value: v });
        if (!result.ok) throw new Error(`业务写失败：${JSON.stringify(result)}`);
      }
      await business.release();
    },
    frames: (dir, filterNs) =>
      (dir === 'peerToHub' ? activeWire?.peerToHub : activeWire?.hubToPeer)!
        .map((bytes) => decodeWire(bytes))
        .filter((f) => filterNs === undefined || (f.message as { namespaceId?: string }).namespaceId === filterNs),
    chunks: (dir) => {
      const wire = activeWire!;
      const list = dir === 'peerToHub' ? wire.peerToHub : wire.hubToPeer;
      const out: ChunkMsg[] = [];
      for (const bytes of list) {
        const decoded = decodeWire(bytes);
        if (decoded.message.kind === 'UPDATE_CHUNK') out.push(decoded.message as ChunkMsg);
      }
      return out;
    },
    rootValue: (side, key) => {
      const node = side === 'hub' ? hubNode : peerNode;
      const owner = side === 'hub' ? HUB_OWNER : PEER_OWNER;
      const doc = node.persistence.peek(owner, nsId);
      if (doc === undefined) throw new Error(`${side} 缺副本 ${nsId}`);
      return (doc.getMap('ROOT') as unknown as Map<string, unknown>).get(key);
    },
    hubSaveCount: (docId) => hubNode.persistence.saveEvents.filter((e) => e.docId === docId).length,
    advance: async (ms) => {
      await peerNode.scheduler.advanceBy(ms);
      await hubNode.scheduler.advanceBy(ms);
      await settle();
    },
  };
}

// ═══════════════════════════ 本地组装（单连接 5 ns；R4 并发 assembly 场景） ═══════════════════════════

function schemaOf(tag: string): Readonly<{ lang: string; version: number; id: string; text: string }> {
  return {
    lang: 'vfsl',
    version: 1,
    id: `issue244-quint-${tag}`,
    text: 'type ROOT = { n: number; blurb: string; };\n',
  };
}

interface QuintContext {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly nsIds: readonly string[];
  readonly peerEvents: ReplicationObserverEvent[];
  readonly hubEvents: ReplicationObserverEvent[];
  openPeerGate(): void;
  getWire(): Wire;
  peerWrite(nsId: string, value: Readonly<{ n?: number; blurb?: string }>): Promise<void>;
  frames(dir: 'peerToHub' | 'hubToPeer', nsId?: string): DecodedMessage[];
  chunks(dir: 'peerToHub' | 'hubToPeer'): ChunkMsg[];
  rootValue(side: 'hub' | 'peer', nsId: string, key: 'blurb' | 'n'): unknown;
  hubSaveCount(docId: string): number;
  advance(ms: number): Promise<void>;
}

/** 单连接 5 ns：peer data 闸门起始关闭（boot 后全部大写先入队），autoPause 在第 N 个
 *  data 帧后自动再关——逐 ns chunk0 并发入站的确定性构造（N = ns 数）。 */
async function bootQuint(opts: {
  timeouts?: Readonly<Partial<ReplicationTimeouts>>;
}): Promise<QuintContext> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const tags = ['a', 'b', 'c', 'd', 'e'];
  const nsIds: string[] = [];
  for (const tag of tags) {
    const lease = okLease(
      await hubNode.registry.create({
        owner: HUB_OWNER,
        schema: schemaOf(tag),
        root: { n: 1, blurb: 'seed' },
      }),
    );
    await schemaReady(lease);
    const enabled = await lease.enableReplication();
    if (!enabled.ok) throw new Error(`enableReplication(${tag}) 失败：${JSON.stringify(enabled)}`);
    nsIds.push(lease.namespaceId);
  }

  const peerEvents = makeCollector();
  const hubEvents = makeCollector();
  let activeWire: Wire | undefined;
  let openGate: (() => void) | undefined;

  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: hubNode.registry,
    authorize: async () => ({
      ok: true as const,
      localOwner: HUB_OWNER,
      permissions: { read: true, submit: true },
    }),
    timer: hubNode.scheduler,
    verifyToken: DEFAULT_PEER_VERIFIER,
    limits: LIMITS,
    timeouts: opts.timeouts ?? TIMEOUTS,
    observer: hubEvents.observer,
  });

  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      const wire = makeWire();
      const gated = withGatedStartProxy(wire.peerEnd, {
        autoPauseAfterDataFrames: nsIds.length, // 5 个 chunk0 后自动再关
        high: PAUSE_HIGH,
        low: PAUSE_LOW,
      });
      openGate = gated.open;
      activeWire = wire;
      void hub.accept(wire.hubEnd, { token: TEST_TOKEN });
      return gated.end;
    },
    timer: peerNode.scheduler,
    targets: nsIds.map((namespaceId) => ({ namespaceId, localOwner: PEER_OWNER })),
    limits: LIMITS,
    timeouts: opts.timeouts ?? TIMEOUTS,
    observer: peerEvents.observer,
    chunkedUpdate: true,
  });

  peer.start();
  await settleUntil(() => peer.getConnectionState() === 'ready', '连接 ready');
  for (const nsId of nsIds) {
    await settleUntil(() => peer.getNamespaceState(nsId) === 'live', `ns ${nsId} live`);
  }

  const businessWrite = async (
    nsId: string,
    value: Readonly<{ n?: number; blurb?: string }>,
  ): Promise<void> => {
    const business = okLease(await peerNode.registry.open(PEER_OWNER, nsId));
    await schemaReady(business);
    for (const [key, v] of Object.entries(value)) {
      const result = await business.mutateData({ op: 'set', path: [key], value: v });
      if (!result.ok) throw new Error(`业务写失败：${JSON.stringify(result)}`);
    }
    await business.release();
  };

  return {
    hubNode,
    peerNode,
    hub,
    peer,
    nsIds,
    peerEvents: peerEvents.events,
    hubEvents: hubEvents.events,
    openPeerGate: () => {
      if (openGate === undefined) throw new Error('peer 尚未拨号');
      openGate();
    },
    getWire: () => {
      if (activeWire === undefined) throw new Error('peer 尚未拨号');
      return activeWire;
    },
    peerWrite: businessWrite,
    frames: (dir, filterNs) =>
      (dir === 'peerToHub' ? activeWire?.peerToHub : activeWire?.hubToPeer)!
        .map((bytes) => decodeWire(bytes))
        .filter((f) => filterNs === undefined || (f.message as { namespaceId?: string }).namespaceId === filterNs),
    chunks: (dir) => {
      const wire = activeWire!;
      const list = dir === 'peerToHub' ? wire.peerToHub : wire.hubToPeer;
      const out: ChunkMsg[] = [];
      for (const bytes of list) {
        const decoded = decodeWire(bytes);
        if (decoded.message.kind === 'UPDATE_CHUNK') out.push(decoded.message as ChunkMsg);
      }
      return out;
    },
    rootValue: (side, nsId, key) => {
      const node = side === 'hub' ? hubNode : peerNode;
      const owner = side === 'hub' ? HUB_OWNER : PEER_OWNER;
      const doc = node.persistence.peek(owner, nsId);
      if (doc === undefined) throw new Error(`${side} 缺副本 ${nsId}`);
      return (doc.getMap('ROOT') as unknown as Map<string, unknown>).get(key);
    },
    hubSaveCount: (docId) => hubNode.persistence.saveEvents.filter((e) => e.docId === docId).length,
    advance: async (ms) => {
      await peerNode.scheduler.advanceBy(ms);
      await hubNode.scheduler.advanceBy(ms);
      await settle();
    },
  };
}

// ═══════════════════════════ 帧观测辅助 ═══════════════════════════

function nsErrorFrames(ctx: SingleContext | QuintContext, dir: 'peerToHub' | 'hubToPeer'): string[] {
  return ctx
    .frames(dir)
    .filter((f) => f.message.kind === 'ERROR')
    .map((f) => (f.message as ErrorMsg).code);
}

function resyncReasons(ctx: SingleContext | QuintContext, dir: 'peerToHub' | 'hubToPeer'): string[] {
  return ctx
    .frames(dir)
    .filter((f) => f.message.kind === 'RESYNC_REQUIRED')
    .map((f) => (f.message as ResyncMsg).reasonCode);
}

function ackFrames(ctx: SingleContext, dir: 'peerToHub' | 'hubToPeer', nsId: string): AckMsg[] {
  return ctx
    .frames(dir, nsId)
    .filter((f): f is { header: DecodedMessage['header']; message: AckMsg } => f.message.kind === 'UPDATE_ACK')
    .map((f) => f.message);
}

function channelClosedEvents(events: readonly ReplicationObserverEvent[], nsId: string): number {
  return events.filter(
    (e) =>
      e.type === 'channel-state-changed' &&
      (e as { namespaceId?: string }).namespaceId === nsId &&
      (e as { to?: string }).to === 'closed',
  ).length;
}

function nextSeq(ctx: SingleContext | QuintContext): number {
  return ctx.frames('peerToHub').reduce((max, f) => Math.max(max, f.header.sequence), 0) + 1;
}

// ═══════════════════════════ 配置构造桩（R1 专用；不启动任何连接） ═══════════════════════════

const STUB_REGISTRY = { open: async () => ({ ok: false as const }) } as unknown as NamespaceRegistry;
const STUB_TIMER = {
  setTimeout: () => 1 as unknown,
  clearTimeout: () => undefined as void,
};

function hubOptionsWith(limits: Readonly<Partial<ReplicationLimits>>): HubReplicationOptions {
  return {
    instanceId: 'hub-ac',
    registry: STUB_REGISTRY,
    authorize: async () => ({ ok: false as const }),
    timer: STUB_TIMER,
    verifyToken: async () => ({ ok: false as const }),
    limits,
  };
}

function peerOptionsWith(limits: Readonly<Partial<ReplicationLimits>>): PeerReplicationOptions {
  return {
    instanceId: 'peer-ac',
    hubInstanceId: 'hub-ac',
    registry: STUB_REGISTRY,
    dial: () => ({ send: () => {}, close: () => {} }) as unknown as DuplexTransport,
    timer: STUB_TIMER,
    limits,
    chunkedUpdate: true,
  };
}

// ═══════════════════════════ 契约测试 ═══════════════════════════

describe('issue #244 切片 3：分块传输有界性加固与中止清理矩阵（红灯契约）', () => {
  it('红灯 R1a（AC1）：非法跨字段配置（maxChunkedUpdateBytes > maxQueuedUpdateBytes）构造期必须 TypeError；三个新配置缺省面缺失', () => {
    // (1) 跨字段响亮链（slice 2 注释显式移交本切片：validate.ts「跨字段链归 #244」）——
    // maxChunkedUpdateBytes=6MiB > maxQueuedUpdateBytes 缺省 4MiB → 构造期 TypeError
    const illegalChain = hubOptionsWith({ maxChunkedUpdateBytes: 6 * 1024 * 1024 });
    expect(
      () => createHubReplication(illegalChain),
      'maxChunkedUpdateBytes ≤ maxQueuedUpdateBytes 违例必须构造期 TypeError（当前链缺失，构造静默成功）',
    ).toThrow(TypeError);
    expect(
      () => createPeerReplication(peerOptionsWith({ maxChunkedUpdateBytes: 6 * 1024 * 1024 })),
      'peer 构造入口同样必须 TypeError（共享 validateLimits 链）',
    ).toThrow(TypeError);

    // (2) 配置缺省面：ADR 0013 配置表冻结值必须存在
    const limitsRecord = DEFAULT_REPLICATION_LIMITS as unknown as Record<string, number | undefined>;
    expect(
      limitsRecord.maxChunksPerUpdate,
      `maxChunksPerUpdate 缺省 ${DEFAULT_MAX_CHUNKS_PER_UPDATE}（当前键未实现）`,
    ).toBe(DEFAULT_MAX_CHUNKS_PER_UPDATE);
    expect(
      limitsRecord.maxConcurrentAssembliesPerConnection,
      `maxConcurrentAssembliesPerConnection 缺省 ${DEFAULT_MAX_CONCURRENT_ASSEMBLIES}（当前键未实现）`,
    ).toBe(DEFAULT_MAX_CONCURRENT_ASSEMBLIES);
    // assemblyTimeoutMs 的容器归属是 SA1 裁决（limits 或 timeouts）；契约断言「两容器
    // 之一存在冻结缺省 30_000」（当前两容器均无该键），行为面由 R3/N4 按 30s 缺省推进。
    const timeoutsRecord = DEFAULT_REPLICATION_TIMEOUTS as unknown as Record<string, number | undefined>;
    const assemblyDefault = limitsRecord.assemblyTimeoutMs ?? timeoutsRecord.assemblyTimeoutMs;
    expect(
      assemblyDefault,
      `assemblyTimeoutMs 缺省 ${DEFAULT_ASSEMBLY_TIMEOUT_MS}（当前 limits/timeouts 均未实现）`,
    ).toBe(DEFAULT_ASSEMBLY_TIMEOUT_MS);
  });

  it('红灯 R1b（AC1）：新上限键非法值（0）必须构造期 TypeError——当前未知键被静默接受', () => {
    const illegalCount = { maxChunksPerUpdate: 0 } as unknown as Readonly<Partial<ReplicationLimits>>;
    const illegalConcurrency = {
      maxConcurrentAssembliesPerConnection: 0,
    } as unknown as Readonly<Partial<ReplicationLimits>>;
    for (const [label, limits] of [
      ['maxChunksPerUpdate=0（约束 ≥1）', illegalCount],
      ['maxConcurrentAssembliesPerConnection=0（约束 ≥1）', illegalConcurrency],
    ] as const) {
      expect(
        () => createHubReplication(hubOptionsWith(limits)),
        `${label} 必须构造期 TypeError（当前该键无形状/值校验，静默接受）`,
      ).toThrow(TypeError);
      expect(
        () => createPeerReplication(peerOptionsWith(limits)),
        `${label}（peer 入口）必须构造期 TypeError`,
      ).toThrow(TypeError);
    }
  });

  it('红灯 R1c（AC1 + SA4-2 收口）：显式 maxChunksPerUpdate（无 chunked 字节键）必须激活合并值链校验——{maxChunksPerUpdate: 4}+缺省 → 链②算术违例构造期 TypeError（现行单键门不抛——落地序守卫）', () => {
    // SA4-2/SA1 iteration-1 裁决（design §7-D1 边界语义表行 2 + §12）：激活键 =
    // 分块族链上键 {maxChunkedUpdateBytes, maxChunksPerUpdate} 任一显式表达，即对
    // 合并结果响亮校验两链（ADR 0013 L71 约束列；绝不运行时 clamp）。
    // R1c = 现行单键门的族内缺口守卫（SA8 design-recheck §4-4 复核的算术边界）：
    // 显式 {maxChunksPerUpdate: 4}（其余全缺省）→ 合并结果
    //   链① maxChunkedUpdateBytes(缺省 4MiB) ≤ maxQueuedUpdateBytes(缺省 4MiB) ✓
    //   链② maxChunkedUpdateBytes(4MiB) ≤ 4 × maxUpdateBytes(缺省 512KiB) = 2MiB ✗
    // → 构造期 TypeError。用例精确隔离链②的算术边界：只显式 maxChunksPerUpdate，
    //   单键门（hub-connection.ts:195-202 / peer-connection.ts:109-116，仅认
    //   maxChunkedUpdateBytes）下不抛 → 红；SA3 门放宽（双激活键）后转绿。
    const onlyCountTightened: Readonly<Partial<ReplicationLimits>> = { maxChunksPerUpdate: 4 };
    // 期望值自检：冻结缺省关系必须使链②成立为「显式收紧即违例」（4MiB > 4×512KiB）——
    // 否则用例退化为空转（防 fixture/缺省漂移伪红伪绿）
    expect(DEFAULT_REPLICATION_LIMITS.maxChunkedUpdateBytes).toBe(4 * 1024 * 1024);
    expect(DEFAULT_REPLICATION_LIMITS.maxUpdateBytes).toBe(512 * 1024);
    expect(DEFAULT_REPLICATION_LIMITS.maxChunkedUpdateBytes).toBeGreaterThan(
      onlyCountTightened.maxChunksPerUpdate! * DEFAULT_REPLICATION_LIMITS.maxUpdateBytes,
    );
    expect(
      () => createHubReplication(hubOptionsWith(onlyCountTightened)),
      '显式 maxChunksPerUpdate=4 + 缺省 envelope 4MiB 必须构造期 TypeError（链②：4MiB > 4×512KiB=2MiB；现行单键门静默接受）',
    ).toThrow(TypeError);
    expect(
      () => createPeerReplication(peerOptionsWith(onlyCountTightened)),
      'peer 构造入口同样必须 TypeError（共享 validateChunkedTransferChain——双激活键门）',
    ).toThrow(TypeError);
    // 断言敏感度反证（现行门下即绿——证明红不在链机制本身而在激活键集）：
    // 同一合并结果（envelope 4MiB / maxChunksPerUpdate 4 / maxUpdateBytes 512KiB）经
    // 显式 maxChunkedUpdateBytes 表达（双键显式）时现行单键门已响亮 TypeError（链②
    // 算术违例真实存在）——R1c 的红精确落在「仅显式 maxChunksPerUpdate 未激活链」的
    // 单键门缺口；若实现把链判据写错（如 `<` 替代 `≤`）双键构型同样红。
    expect(() =>
      createHubReplication(
        hubOptionsWith({ maxChunkedUpdateBytes: 4 * 1024 * 1024, maxChunksPerUpdate: 4 }),
      ),
    ).toThrow(TypeError);
    expect(() =>
      createPeerReplication(
        peerOptionsWith({ maxChunkedUpdateBytes: 4 * 1024 * 1024, maxChunksPerUpdate: 4 }),
      ),
    ).toThrow(TypeError);
  });

  it('红灯 R2（AC2/AC3 声明超上限分类）：首 chunk 申报 chunkCount=65536 > maxChunksPerUpdate(64) → UPDATE_TRANSFER_TOO_LARGE、ns 终局 failed、apply 前零写入（当前静默接纳滞留）', async () => {
    const ctx = await bootSingle({});
    try {
      const savesBefore = ctx.hubSaveCount(ctx.nsId);
      // 恶意 chunkCount 申报（单帧自洽：index 0 < count、bytes 非空 ≤ totalBytes ≤ 各上界，
      // geometryConsistent——唯独 count 超 maxChunksPerUpdate 缺省 64）
      const frame = encodeMessage(
        {
          kind: 'UPDATE_CHUNK',
          transferKind: 0, // issue #295：单形态 kind 首字段（live-update 路径）
          namespaceId: ctx.nsId,
          transferId: 1,
          chunkIndex: 0,
          chunkCount: 65_536,
          totalBytes: 4096,
          bytes: new Uint8Array(1024),
        },
        { sequence: nextSeq(ctx) },
      );
      ctx.getWire().peerEnd.send(frame);
      // 帧分发同步 + 违例收口为同步决策（K4 同形）；确定性排空即可断言——红灯失败点
      // 必须是「零违例帧」本身，而不是任何等待预算（settleUntil 预算耗尽 = 伪红形态）。
      await settle();
      await settle();
      // 分类 = 声明超资源上限族 → TOO_LARGE（fatal/config-retryable，terminal failed）
      expect(
        nsErrorFrames(ctx, 'hubToPeer'),
        `chunkCount 超上限必须报 UPDATE_TRANSFER_TOO_LARGE（当前零违例帧——静默接纳滞留）`,
      ).toContain('UPDATE_TRANSFER_TOO_LARGE');
      expect(failedEvents(ctx.hubEvents).length, 'hub ns 终局 failed（TOO_LARGE = fatal 族）').toBe(1);
      // 违例先于任何 apply：live Y.Doc 零写入、零 dirty、零 ACK
      expect(ctx.rootValue('hub', 'blurb')).toBe('seed');
      expect(ctx.hubSaveCount(ctx.nsId)).toBe(savesBefore);
      expect(ackFrames(ctx, 'hubToPeer', ctx.nsId)).toHaveLength(0);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('红灯 R3（AC4 + R7 中止事件·timeout）：assembly 停滞超过 assemblyTimeoutMs（缺省 30s）→ 弃 partial + RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED} + chunked-update-aborted{timeout} + 收口收敛（当前零超时机制，停滞永挂）', async () => {
    const ctx = await bootSingle({ pausePeerAfterDataFrames: 1 });
    try {
      const savesBefore = ctx.hubSaveCount(ctx.nsId);
      // chunk0 出站（3-chunk transfer 中途在场）后 data 闸门暂停 → hub busy assembly 停滞
      await ctx.peerWrite({ blurb: BIG });
      await settle();
      const prefix = ctx.chunks('peerToHub');
      expect(prefix, 'T1 前缀（chunk0）已出站').toHaveLength(1);
      expect(prefix[0]!.chunkIndex).toBe(0);
      expect(ctx.rootValue('hub', 'blurb'), '只收 chunk0——未 apply').toBe('seed');
      // 停滞期零部分写入（stall 窗口内、超时 deadline 之前；中止发生在 apply 之前——
      // SA3 实现轮定位：该观察点必须落在 deadline 前进之前——超时收口触发后对端按
      // §9.4 立即开恢复 round，fake-duplex 同步投递 + advanceBy 微任务展开使 round
      // diff 在同一 advance 窗口内完成整笔收敛（既定收口语义，K7/F6 同款节奏），
      // deadline 后的「hub 仍 seed」断言在任何忠实实现下均不可达——语义断言原样保留）
      expect(ctx.rootValue('hub', 'blurb'), '停滞期零部分写入').toBe('seed');
      expect(ctx.hubSaveCount(ctx.nsId)).toBe(savesBefore);

      // 停滞推进 ≥ 缺省 assemblyTimeoutMs（30s；测试侧无法注入该键——按冻结缺省推进）
      await ctx.advance(DEFAULT_ASSEMBLY_TIMEOUT_MS + 1000);

      // 红灯断言面：超时 → 接收方（hub）发 RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED}
      expect(
        resyncReasons(ctx, 'hubToPeer'),
        `assembly 停滞超时必须以 RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED} 收口（当前零超时机制——无任何 RESYNC 帧）`,
      ).toContain('UPDATE_TRANSFER_EXPIRED');

      // R7：中止事件（ADR 0013 observer seam）——丢弃 partial 的一端发射 aborted{timeout}
      const aborted = abortedLike(ctx.hubEvents).filter((e) => e.reason === 'timeout');
      expect(
        aborted,
        `hub 丢弃停滞 assembly 必须发射 chunked-update-aborted{timeout}（当前零 chunked-* 事件）`,
      ).toHaveLength(1);
      expect(aborted[0]!.namespaceId).toBe(ctx.nsId);
      expect(aborted[0]!.receivedChunks, '已收进度 = chunk0 恰 1 片').toBe(1);
      expect(aborted[0]!.receivedBytes).toBeGreaterThan(0);

      // 对端按既有 §9.4 收口：peer 弃置残余（无续传 chunk）→ 恢复 round → diff 回灌收敛
      await settleUntil(
        () =>
          ctx.rootValue('hub', 'blurb') === BIG && ctx.peer.getNamespaceState(ctx.nsId) === 'live',
        '恢复 round 收敛（整笔 update 经 diff 回灌）且回 live',
      );
      await settle();
      expect(failedEvents(ctx.hubEvents), '超时收口不得使 hub ns 终局 failed').toHaveLength(0);
      expect(failedEvents(ctx.peerEvents), '恢复后 peer ns 零 failed').toHaveLength(0);
      const resyncs = resyncEvents(ctx.peerEvents).filter((e) => e.cause === 'remote-declared');
      expect(resyncs.length, 'peer 收到对端声明恰一次（remote-declared）').toBe(1);
      const t1ChunksAfter = ctx.chunks('peerToHub').filter((c) => c.transferId === 1);
      expect(
        t1ChunksAfter.length,
        '中止后不得有残余续传 chunk（单点终止，无僵尸续传）',
      ).toBe(1);

      // AC6 自愈尾：中止后新传输可正常发起（先放行 data 闸门——中止时残余队列已弃，
      // 闸门恢复后后续写经普通 UPDATE 收敛）
      ctx.releasePeer?.();
      await ctx.advance(1000);
      await ctx.peerWrite({ blurb: 'post-abort' });
      await settleUntil(
        () => ctx.rootValue('hub', 'blurb') === 'post-abort',
        '中止后新 update 正常收敛',
      );
      expect(ctx.peer.getNamespaceState(ctx.nsId)).toBe('live');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('红灯 R4（AC3 + R10 并发超额分类）：单连接 5 ns 并发 assembly——第 5 个首 chunk 必须 UPDATE_TRANSFER_VIOLATION 终局 failed，其余 4 个不受影响并正常收齐（当前无连接级上限，5 个全部静默滞留）', async () => {
    const ctx = await bootQuint({});
    try {
      const savesBefore = new Map(ctx.nsIds.map((nsId) => [nsId, ctx.hubSaveCount(nsId)]));
      // data 闸门起始关闭：5 个大写先入队（闸门关 → 全部滞留各自通道队列）
      for (const nsId of ctx.nsIds) {
        await ctx.peerWrite(nsId, { blurb: BIG });
      }
      await settle();
      // 开闸（poll 驱动 drain）→ RR 逐 ns 出 chunk0，第 5 个 data 帧后自动再关 →
      // hub 侧 5 个并发 busy assembly（帧 1..5 严格逐 ns chunk0）
      ctx.openPeerGate();
      await ctx.advance(2000);
      await settle();
      const chunk0s = ctx.chunks('peerToHub').filter((c) => c.chunkIndex === 0);
      expect(chunk0s.length, '5 ns 各出 chunk0（并发 assembly 构造）').toBe(5);
      const perNs = new Set(chunk0s.map((c) => c.namespaceId));
      expect(perNs.size, 'chunk0 必须覆盖全部 5 ns').toBe(5);
      const victims = ctx.chunks('peerToHub').filter((c) => c.chunkIndex === 0);
      const victimNs = victims.at(-1)!.namespaceId; // 第 5 个到达的首 chunk = 超额者
      const healthy = ctx.nsIds.filter((nsId) => nsId !== victimNs);
      // 收齐前零 apply（双跑均绿）
      expect(ctx.rootValue('hub', victimNs, 'blurb')).toBe('seed');
      for (const nsId of healthy) {
        expect(ctx.rootValue('hub', nsId, 'blurb')).toBe('seed');
      }
      // 红灯断言面：连接级并发超额 → 第 5 个 ns 的 UPDATE_TRANSFER_VIOLATION + 终局 failed
      const victimErrors = ctx
        .frames('hubToPeer', victimNs)
        .filter((f) => f.message.kind === 'ERROR')
        .map((f) => (f.message as ErrorMsg).code);
      expect(
        victimErrors,
        `并发 assembly 超额必须 UPDATE_TRANSFER_VIOLATION（当前无连接级上限——零违例帧）`,
      ).toContain('UPDATE_TRANSFER_VIOLATION');
      const hubFailed = failedEvents(ctx.hubEvents).filter(
        (e) => (e as { namespaceId?: string }).namespaceId === victimNs,
      );
      expect(hubFailed.length, '超额 ns 终局 failed（VIOLATION = fatal 族）').toBe(1);
      expect(
        failedEvents(ctx.hubEvents).filter((e) => (e as { namespaceId?: string }).namespaceId !== victimNs),
        '其余 4 ns 不得因并发上限终局',
      ).toHaveLength(0);

      // 其余 4 个并发 assembly 不受影响：二次开闸 → 收齐 → 恰一次 apply + dirty
      ctx.openPeerGate();
      await ctx.advance(2000);
      await settleUntil(
        () =>
          healthy.every((nsId) => ctx.rootValue('hub', nsId, 'blurb') === BIG) &&
          ctx.peer.getNamespaceState(victimNs) === 'failed',
        '4 个健康 transfer 收齐收敛且超额 ns 保持 failed',
      );
      await settle();
      for (const nsId of healthy) {
        expect(ctx.rootValue('hub', nsId, 'blurb'), `${nsId} 必须整笔收敛`).toBe(BIG);
        expect(ctx.hubSaveCount(nsId) - savesBefore.get(nsId)!, `${nsId} 恰一次 apply`).toBe(1);
        expect(ctx.peer.getNamespaceState(nsId), `${nsId} peer 侧保持 live`).toBe('live');
      }
      expect(ctx.rootValue('hub', victimNs, 'blurb'), '超额 ns 零部分写入').toBe('seed');
      expect(ctx.hubSaveCount(victimNs)).toBe(savesBefore.get(victimNs));
      expect(ctx.peer.getNamespaceState(victimNs)).toBe('failed');
      expect(ctx.peer.getConnectionState(), '违例为 ns 级——连接保持 ready').toBe('ready');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('红灯 R5a（AC5 + R7 中止事件·channel-teardown）：CLOSE_NAMESPACE 收口带忙 assembly → chunked-update-aborted{channel-teardown} + 零部分写入（当前零事件）', async () => {
    const ctx = await bootSingle({ pausePeerAfterDataFrames: 1 });
    try {
      const savesBefore = ctx.hubSaveCount(ctx.nsId);
      await ctx.peerWrite({ blurb: BIG });
      await settle();
      expect(ctx.chunks('peerToHub'), 'T1 前缀（chunk0）已出站——hub assembly busy').toHaveLength(1);
      // peer removeTarget → CLOSE_NAMESPACE → hub 通道收口（带忙入站 assembly）
      await ctx.peer.removeTarget(ctx.nsId);
      await settleUntil(
        () => channelClosedEvents(ctx.hubEvents, ctx.nsId) >= 1,
        'hub 通道收口 closed',
      );
      await settle();
      const aborted = abortedLike(ctx.hubEvents).filter((e) => e.reason === 'channel-teardown');
      expect(
        aborted,
        `CLOSE_NAMESPACE 收口弃忙 assembly 必须发射 chunked-update-aborted{channel-teardown}（当前零 chunked-* 事件）`,
      ).toHaveLength(1);
      expect(aborted[0]!.namespaceId).toBe(ctx.nsId);
      expect(aborted[0]!.receivedChunks).toBe(1);
      // AC5：中止路径零 durable partial state / 零部分写入
      expect(ctx.rootValue('hub', 'blurb'), '收口后 live Y.Doc 零部分写入').toBe('seed');
      expect(ctx.hubSaveCount(ctx.nsId)).toBe(savesBefore);
      expect(failedEvents(ctx.hubEvents), '正常收口零 failed 终局').toHaveLength(0);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('红灯 R5b（AC5 + R7 中止事件·connection-teardown）：连接断线带忙 assembly → chunked-update-aborted{connection-teardown} + 零部分写入（当前零事件）', async () => {
    const ctx = await bootSingle({ pausePeerAfterDataFrames: 1 });
    try {
      const savesBefore = ctx.hubSaveCount(ctx.nsId);
      await ctx.peerWrite({ blurb: BIG });
      await settle();
      expect(ctx.chunks('peerToHub'), 'T1 前缀（chunk0）已出站——hub assembly busy').toHaveLength(1);
      // 网络级断线（socket close——两应用侧均收到）
      ctx.getWire().closePeerSide();
      await settleUntil(
        () => channelClosedEvents(ctx.hubEvents, ctx.nsId) >= 1,
        'hub 侧通道随连接断线收口',
      );
      await settle();
      const aborted = abortedLike(ctx.hubEvents).filter((e) => e.reason === 'connection-teardown');
      expect(
        aborted,
        `连接断线弃忙 assembly 必须发射 chunked-update-aborted{connection-teardown}（当前零 chunked-* 事件）`,
      ).toHaveLength(1);
      expect(aborted[0]!.namespaceId).toBe(ctx.nsId);
      expect(aborted[0]!.receivedChunks).toBe(1);
      // AC5：断线中止零 durable partial state / 零部分写入
      expect(ctx.rootValue('hub', 'blurb'), '断线后 live Y.Doc 零部分写入').toBe('seed');
      expect(ctx.hubSaveCount(ctx.nsId)).toBe(savesBefore);
      expect(failedEvents(ctx.hubEvents), '断线收口零 failed 终局').toHaveLength(0);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('绿负控 N1（AC1）：合法跨字段链配置构造成功并可正常收敛；形状门 TypeError 回归（零运行时 clamp 的实现前哨）', async () => {
    // 合法链：maxChunkedUpdateBytes=256KiB ≤ maxQueuedUpdateBytes(1MiB) 且
    // ≤ maxChunksPerUpdate(缺省 64) × maxUpdateBytes(8KiB)=512KiB → 构造必须成功
    const validLimits: Readonly<Partial<ReplicationLimits>> = {
      ...LIMITS,
      maxChunkedUpdateBytes: 256 * 1024,
    };
    expect(() => createHubReplication(hubOptionsWith(validLimits))).not.toThrow();
    expect(() => createPeerReplication(peerOptionsWith(validLimits))).not.toThrow();
    // 既有形状门回归：非法既有键仍响亮 TypeError
    expect(() => createHubReplication(hubOptionsWith({ maxUpdateBytes: 0 }))).toThrow(TypeError);
    expect(() => createPeerReplication(peerOptionsWith({ maxQueuedUpdateBytes: -1 }))).toThrow(TypeError);
    // 运行时健康：合法链配置端到端收敛
    const ctx = await bootSingle({ limits: validLimits });
    try {
      await ctx.peerWrite({ blurb: 'valid-config' });
      await settleUntil(
        () =>
          ctx.rootValue('hub', 'blurb') === 'valid-config' &&
          ctx.peer.getNamespaceState(ctx.nsId) === 'live',
        '合法链配置下普通写收敛',
      );
      expect(failedEvents(ctx.hubEvents)).toHaveLength(0);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('绿负控 N5（AC1 + SA4-2 非追溯边界）：{...LIMITS}（显式下调既有键、零分块族键表达）双入口构造不抛——缺省 envelope 不得被误判为用户配置错误', () => {
    // 冻结 fixture LIMITS（上文 L104-109）显式表达 4 个 legacy 键、**零**分块族链上键
    // （无 maxChunkedUpdateBytes / maxChunksPerUpdate）——R2–R5/N2–N4 的默认注入构型。
    // 合并结果：maxChunkedUpdateBytes 缺省 4MiB > maxQueuedUpdateBytes 1MiB → 若激活则
    // 链①违例。断言面 = **不激活**（非追溯性：仅显式既有键不把未触碰的缺省误判为
    // 用户配置错误——design §7-D1 边界表行 3；SA8 R17：保持「零分块族键表达」的精确
    // 边界，非「不含 maxChunkedUpdateBytes」的单键化回退）。现行单键门与双键门均绿。
    const legacyOnly: Readonly<Partial<ReplicationLimits>> = { ...LIMITS };
    expect(
      Object.keys(legacyOnly),
      'LIMITS fixture 必须零分块族链上键（探针前提；R2–R5/N2–N4 构造成功依赖此面）',
    ).not.toContain('maxChunkedUpdateBytes');
    expect(Object.keys(legacyOnly)).not.toContain('maxChunksPerUpdate');
    // 探针真实性：合并 envelope 确实违链①——否则本用例退化为空转（非追溯面未探到）
    expect(DEFAULT_REPLICATION_LIMITS.maxChunkedUpdateBytes).toBeGreaterThan(
      legacyOnly.maxQueuedUpdateBytes!,
    );
    expect(() => createHubReplication(hubOptionsWith(legacyOnly))).not.toThrow();
    expect(() => createPeerReplication(peerOptionsWith(legacyOnly))).not.toThrow();
  });

  it('绿负控 N6（AC1 + SA4-2 激活键集闭合）：{...LIMITS, maxConcurrentAssembliesPerConnection: 2} 双入口构造不抛——非链操作数键（并发/超时钮）不激活字节链', () => {
    // 激活键集 = 两链不等式的**全部分块族操作数**（design §7-D1 边界表行 5）：并发键
    // 虽为本切片家族新键但非链操作数——调并发钮不得触发分块字节链错误（值门无条件
    // 照旧：2 ≥ 1 合法）。合并结果同 N5 违链①——若并发键被误纳入激活键集本用例即红。
    const concurrencyOnly: Readonly<Partial<ReplicationLimits>> = {
      ...LIMITS,
      maxConcurrentAssembliesPerConnection: 2,
    };
    expect(() => createHubReplication(hubOptionsWith(concurrencyOnly))).not.toThrow();
    expect(() => createPeerReplication(peerOptionsWith(concurrencyOnly))).not.toThrow();
  });

  it('绿负控 N2（AC2 边界）：chunkCount === maxChunksPerUpdate(64)（off-by-one 守卫）首 chunk 必须被接纳——零 ERROR/零 failed/零 apply', async () => {
    const ctx = await bootSingle({});
    try {
      const frame = encodeMessage(
        {
          kind: 'UPDATE_CHUNK',
          transferKind: 0, // issue #295：单形态 kind 首字段（live-update 路径）
          namespaceId: ctx.nsId,
          transferId: 1,
          chunkIndex: 0,
          chunkCount: DEFAULT_MAX_CHUNKS_PER_UPDATE, // 恰在缺省上限
          totalBytes: 4096,
          bytes: new Uint8Array(1024),
        },
        { sequence: nextSeq(ctx) },
      );
      ctx.getWire().peerEnd.send(frame);
      await settle();
      await settle();
      expect(nsErrorFrames(ctx, 'hubToPeer'), '上限内 chunkCount 不得触发任何 ERROR 帧').toHaveLength(0);
      expect(failedEvents(ctx.hubEvents), '上限内 chunkCount 不得触发 ns 终局').toHaveLength(0);
      expect(ctx.rootValue('hub', 'blurb'), '未收齐不得 apply').toBe('seed');
      expect(ackFrames(ctx, 'hubToPeer', ctx.nsId), '未收齐不得 ACK').toHaveLength(0);
      expect(resyncReasons(ctx, 'hubToPeer'), '未停滞不得 RESYNC').toHaveLength(0);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('绿负控 N3（fixture 哨兵 + AC7）：完整 3-chunk transfer 正常收齐收敛——恰一次 apply + dirty、单 ACK、零 resync（红灯场景装配自证）', async () => {
    const ctx = await bootSingle({});
    try {
      const savesBefore = ctx.hubSaveCount(ctx.nsId);
      await ctx.peerWrite({ blurb: BIG });
      await settleUntil(
        () => ctx.rootValue('hub', 'blurb') === BIG && ackFrames(ctx, 'hubToPeer', ctx.nsId).length === 1,
        'hub 整笔收齐收敛且单 ACK 到达',
      );
      await settle();
      const chunks = ctx.chunks('peerToHub');
      expect(chunks.length, '大写按 3 chunk 分块传输').toBe(3);
      expect(new Set(chunks.map((c) => c.transferId)).size).toBe(1);
      expect(chunks.reduce((sum, c) => sum + c.bytes.byteLength, 0)).toBe(chunks[0]!.totalBytes);
      expect(ctx.hubSaveCount(ctx.nsId) - savesBefore, '整笔恰一次 apply → dirty 恰一次').toBe(1);
      expect(resyncReasons(ctx, 'peerToHub'), 'live 分块传输零 RESYNC').toHaveLength(0);
      expect(failedEvents(ctx.hubEvents)).toHaveLength(0);
      expect(ctx.peer.getNamespaceState(ctx.nsId)).toBe('live');
      expect(ctx.peer.getConnectionState()).toBe('ready');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('绿负控 N4（AC4 前窗）：停滞 20s（< assemblyTimeoutMs 缺省 30s）零误报零事件；释放后整笔完成收敛（进度滑动 deadline 的实现前哨）', async () => {
    const ctx = await bootSingle({ pausePeerAfterDataFrames: 1 });
    try {
      const savesBefore = ctx.hubSaveCount(ctx.nsId);
      const release = ctx.releasePeer;
      expect(release, 'data 闸门暂停代理必须在位').toBeDefined();
      await ctx.peerWrite({ blurb: BIG });
      await settle();
      expect(ctx.chunks('peerToHub')).toHaveLength(1);
      expect(ctx.rootValue('hub', 'blurb'), '只收 chunk0——未 apply').toBe('seed');
      // 停滞 20s < 30s 缺省：不得有任何超时动作（双跑均绿——实现轮若提前触发即红）
      await ctx.advance(20_000);
      expect(resyncReasons(ctx, 'hubToPeer'), '20s（<30s 缺省）不得触发 RESYNC').toHaveLength(0);
      expect(nsErrorFrames(ctx, 'hubToPeer'), '20s 内零 ERROR').toHaveLength(0);
      expect(abortedLike(ctx.hubEvents), '20s 内零 chunked-update-aborted（无 premature fire）').toHaveLength(0);
      expect(ctx.rootValue('hub', 'blurb'), '20s 内零部分写入').toBe('seed');
      expect(ctx.hubSaveCount(ctx.nsId)).toBe(savesBefore);
      // 释放 → 剩余 chunk 续排 → 整笔完成收敛（进度恢复即免于超时）
      release!();
      await ctx.advance(2000);
      await settleUntil(
        () =>
          ctx.rootValue('hub', 'blurb') === BIG &&
          ackFrames(ctx, 'hubToPeer', ctx.nsId).length === 1 &&
          ctx.peer.getNamespaceState(ctx.nsId) === 'live',
        '释放后整笔 transfer 完成收敛',
      );
      await settle();
      expect(ctx.chunks('peerToHub').length, '同一 transferId 收齐 3 chunk').toBe(3);
      expect(ctx.hubSaveCount(ctx.nsId) - savesBefore, '整笔恰一次 apply').toBe(1);
      expect(resyncReasons(ctx, 'hubToPeer'), '全程零 RESYNC（进度未超窗）').toHaveLength(0);
      expect(failedEvents(ctx.hubEvents)).toHaveLength(0);
      expect(failedEvents(ctx.peerEvents)).toHaveLength(0);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });
});

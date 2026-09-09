/**
 * SA7 动态验证补充测试 —— issue #244（issue #233 切片 3）：分块传输有界性加固与中止
 * 清理矩阵的动态/数据流收口轮（final verification）。
 *
 * 锚定 SA4 静态评审「后续动态验证项」（task_issue-244_sa4_review.md §10）与 SA1 设计
 * §13 残差、SA6 契约 §15、SA9 §6-M3、SA10 §6-D2 一致登记的动态面——契约（14 用例）
 * 已动态覆盖 timeout（R3）/channel-teardown（R5a）/connection-teardown（R5b）三行与
 * 配置门（R1a/R1b/R1c/N1/N5/N6）、二维声明准入（R2/N2）、并发槽位（R4）；本文件补：
 *
 *   D-SLOT1（SA4 §10 行 1 / SA9-O3 / SA10-O3）：中止型槽位归还（timeout caller）后，
 *     同一连接上第 5/第 6 个 distinct ns 的合法首 chunk 必须被接纳——REG1–REG3 只锁
 *     完成型归还与跨代际归还，中止型 caller 归还无直接断言（timeout 泄漏槽 → ns-e
 *     误 UPDATE_TRANSFER_VIOLATION）；
 *   D-SLOT2：中止型槽位归还（connection-teardown caller）× peer 跨拨号代际——代际 1
 *     partial 传输被断线中止（非完成）后，代际 2 新 ns 串行收敛不受残留槽影响；
 *   D-RD1/D-RD2（SA4 §10 行 2）：resync-declared 行（收对端 RESYNC 边）hub/peer 双侧
 *     aborted 事件 + 互补 resync-required{remote-declared} + 零部分写入 + 残渣良性丢弃；
 *   D-QO1/D-QO2：queue-overflow 行（本端 wire 声明漏斗，cause 判别 → 'resync-declared'）
 *     hub/peer 双侧；
 *   D-SHED1/D-SHED2：shed 行（连接级背压弃置，cause 判别 → 'shed'）hub/peer 双侧；
 *   D-FENCE：epoch-fence 行（conflicted 族 carve-out——fence 终局**发射**）hub/peer
 *     双侧同场景（IDENTITY_CHANGED 双跳）+ side 字段双侧断言；
 *   D-GOAWAY：GOAWAY drain 行（R13 口径：经失联与收口入口归并 connection-teardown）
 *     ——drain deadline quiesce→onConnectionFatal→disposal 消费记忆位；
 *   D-SLIDE（SA4 §10 行 3 / SA6 §15）：跨窗滑动形态——chunk0@t0、chunk1@t≈20.7s、
 *     chunk2@t≈40.7s（累计 >30s 缺省窗口、逐 chunk 间隔 <30s）必须零 RESYNC/零 aborted
 *     并整笔收敛（若 deadline 不随 chunk 到达重置，t=30s 即误触发 EXPIRED）。
 *
 * 纪律与既有套件一致：真实 yjs / Registry / Runtime；fake-duplex + fake scheduler
 * （advanceBy 驱动全部虚拟时间）；零 real sleep；零源码 grep 断言；无 skip/only/todo。
 * 冻结契约文件（ws-replication-issue244-ac-red.test.ts）与 REG 文件零改动；生产代码零改动。
 */
import { describe, expect, it } from 'vitest';
import {
  createHubReplication,
  createPeerReplication,
  type DuplexTransport,
  type HubReplication,
  type PeerReplication,
  type ReplicationLimits,
  type ReplicationObserver,
  type ReplicationObserverEvent,
  type ReplicationTimeouts,
} from '@nomicore/ws-replication';
import type { NamespaceLease } from '@nomicore/namespace-registry';
import {
  CAP_CHUNKED_UPDATE,
  decodeMessage,
  encodeMessage,
  type DecodedMessage,
  type ReplicationMessage,
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

function schemaOf(tag: string): Readonly<{ lang: string; version: number; id: string; text: string }> {
  return {
    lang: 'vfsl',
    version: 1,
    id: `issue244-sa7-dyn-${tag}`,
    text: 'type ROOT = { n: number; blurb: string; };\n',
  };
}

/** 契约同款极限构型（显式表达的全为既有键——不激活分块族链，N5 边界内）。 */
const LIMITS: Readonly<Partial<ReplicationLimits>> = {
  maxUpdateBytes: 8 * 1024,
  maxQueuedUpdateCount: 100,
  maxQueuedUpdateBytes: 1 * 1024 * 1024,
  maxInFlightUpdates: 8,
};

const TIMEOUTS: Readonly<Partial<ReplicationTimeouts>> = {
  ackTimeoutMs: 60_000,
};

/** 大写（编码后 ≈20,029B > maxUpdateBytes 8KiB → 3 chunk；与契约 R 系列同构）。 */
const BIG = 'z'.repeat(20_000);

/** 双向哨兵大写（D-FENCE：双侧 busy + 双向零部分写入的逐值区分——peer 写 p、hub 写 h）。 */
const BIG_P = 'p'.repeat(20_000);
const BIG_H = 'h'.repeat(20_000);

/** 缺省 maxConcurrentAssembliesPerConnection = 4（ADR 0013 冻结）。 */
const DEFAULT_MAX_CONCURRENT_ASSEMBLIES = 4;
/** 缺省 assemblyTimeoutMs = 30_000（ADR 0013 冻结；D-SLIDE 按此推进）。 */
const DEFAULT_ASSEMBLY_TIMEOUT_MS = 30_000;

type ChunkMsg = Extract<DecodedMessage['message'], { kind: 'UPDATE_CHUNK' }>;
type ErrorMsg = Extract<DecodedMessage['message'], { kind: 'ERROR' }>;
type ResyncMsg = Extract<DecodedMessage['message'], { kind: 'RESYNC_REQUIRED' }>;
type ResyncEvent = Extract<ReplicationObserverEvent, { type: 'resync-required' }>;

/** 第 23 型中止事件投影（含 side——SA2-R12 双侧断言面）。 */
interface ChunkedAbortedLike {
  readonly type: 'chunked-update-aborted';
  readonly side: string;
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

function abortedOf(events: readonly ReplicationObserverEvent[], reason: string): ChunkedAbortedLike[] {
  return events.filter(
    (e): e is ReplicationObserverEvent & ChunkedAbortedLike =>
      (e as { type?: string }).type === 'chunked-update-aborted' &&
      (e as { reason?: string }).reason === reason,
  ) as unknown as ChunkedAbortedLike[];
}

function failedOf(events: readonly ReplicationObserverEvent[]): ReplicationObserverEvent[] {
  return events.filter((e) => e.type === 'namespace-failed');
}

function resyncObserverOf(events: readonly ReplicationObserverEvent[]): ResyncEvent[] {
  return events.filter((e): e is ResyncEvent => e.type === 'resync-required');
}

// ═══════════════════════════ data 闸门代理（transport seam；可控逐帧放行） ═══════════════════════════

const GATE_HIGH = 600 * 1024; // > 缺省 highWater 512KiB（背压语义：data 暂停、control 照流）

export interface GateControls {
  /** 计数模式：接下来第 N 个 data 帧出站后自动暂停（并进入 drip 模式）。 */
  arm(pauseAfterDataFrames: number): void;
  /** 立即暂停（不等 data 帧）。 */
  close(): void;
  /** drip 模式下放行恰好一个 data 帧（该帧出站后自动再暂停）。 */
  drip(): void;
  /** 永久放行（解除一切暂停与计数）。 */
  release(): void;
}

/** 可控 data 闸门：bufferedAmount 抬高 → 发送方背压暂停（control 不受水位门）；
 *  drip() 每次恰好放行一个 data 帧——跨窗滑动形态（D-SLIDE）的确定性构造。 */
export function withGateProxy(end: DuplexTransport): { end: DuplexTransport; controls: GateControls } {
  let level = 0;
  let autoAfter = 0;
  let dripMode = false;
  let disarmed = false;
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
        if (disarmed) return;
        if (autoAfter > 0) {
          autoAfter -= 1;
          if (autoAfter === 0) {
            dripMode = true;
            level = GATE_HIGH;
          }
          return;
        }
        if (dripMode) level = GATE_HIGH;
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
    controls: {
      arm: (pauseAfterDataFrames) => {
        if (disarmed || pauseAfterDataFrames <= 0) return;
        autoAfter = pauseAfterDataFrames;
      },
      close: () => {
        if (disarmed) return;
        autoAfter = 0;
        dripMode = true;
        level = GATE_HIGH;
      },
      drip: () => {
        if (disarmed || !dripMode) return;
        level = 0;
      },
      release: () => {
        disarmed = true;
        dripMode = false;
        autoAfter = 0;
        level = 0;
      },
    },
  };
}

// ═══════════════════════════ 本地组装（双端闸门；多 ns；拨号可重入） ═══════════════════════════

interface DynContext {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly nsIds: readonly string[];
  readonly hubEvents: ReplicationObserverEvent[];
  readonly peerEvents: ReplicationObserverEvent[];
  /** 每次拨号一个 wire（代际 = wires.length）；断言只读指定代际。 */
  readonly wires: Wire[];
  /** 每代际的 hub/peer 端 data 闸门（index 对应 wires）。 */
  readonly hubGates: GateControls[];
  readonly peerGates: GateControls[];
  readonly hubLeases: ReadonlyMap<string, NamespaceLease>;
  peerWrite(nsId: string, value: Readonly<{ n?: number; blurb?: string }>): Promise<void>;
  hubWrite(nsId: string, value: Readonly<{ n?: number; blurb?: string }>): Promise<void>;
  rootValue(side: 'hub' | 'peer', nsId: string, key: 'blurb' | 'n'): unknown;
  saveCount(side: 'hub' | 'peer', nsId: string): number;
  frames(dir: 'peerToHub' | 'hubToPeer', nsId?: string, wireIndex?: number): DecodedMessage[];
  chunks(dir: 'peerToHub' | 'hubToPeer', nsId?: string, wireIndex?: number): ChunkMsg[];
  errorCodes(dir: 'peerToHub' | 'hubToPeer', wireIndex?: number): string[];
  resyncReasons(dir: 'peerToHub' | 'hubToPeer', wireIndex?: number): string[];
  injectPeer(message: ReplicationMessage): void;
  injectHub(message: ReplicationMessage): void;
  connectionState(): string;
  namespaceState(nsId: string): string | undefined;
  advance(ms: number): Promise<void>;
}

async function bootDyn(opts: {
  nsCount?: number;
  limits?: Readonly<Partial<ReplicationLimits>>;
  timeouts?: Readonly<Partial<ReplicationTimeouts>>;
}): Promise<DynContext> {
  const nsCount = opts.nsCount ?? 1;
  const tags = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].slice(0, nsCount);
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const nsIds: string[] = [];
  const hubLeases = new Map<string, NamespaceLease>();
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
    hubLeases.set(lease.namespaceId, lease);
  }

  const peerEvents = makeCollector();
  const hubEvents = makeCollector();
  const wires: Wire[] = [];
  const hubGates: GateControls[] = [];
  const peerGates: GateControls[] = [];

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
      const hubGate = withGateProxy(wire.hubEnd);
      const peerGate = withGateProxy(wire.peerEnd);
      wires.push(wire);
      hubGates.push(hubGate.controls);
      peerGates.push(peerGate.controls);
      void hub.accept(hubGate.end, { token: TEST_TOKEN });
      return peerGate.end;
    },
    timer: peerNode.scheduler,
    targets: nsIds.map((namespaceId) => ({ namespaceId, localOwner: PEER_OWNER })),
    limits: opts.limits ?? LIMITS,
    timeouts: opts.timeouts ?? TIMEOUTS,
    random: () => 0.5, // 重拨退避确定性（D-SLOT2/D-GOAWAY 重连面）
    observer: peerEvents.observer,
    chunkedUpdate: true,
  });

  peer.start();
  await settleUntil(() => peer.getConnectionState() === 'ready', '连接 ready');
  for (const nsId of nsIds) {
    await settleUntil(() => peer.getNamespaceState(nsId) === 'live', `ns ${nsId} live`);
  }
  await settle();

  const businessWrite = async (
    node: ReplicaNode,
    owner: typeof HUB_OWNER,
    nsId: string,
    value: Readonly<{ n?: number; blurb?: string }>,
  ): Promise<void> => {
    const business = okLease(await node.registry.open(owner, nsId));
    await schemaReady(business);
    for (const [key, v] of Object.entries(value)) {
      const result = await business.mutateData({ op: 'set', path: [key], value: v });
      if (!result.ok) throw new Error(`业务写失败：${JSON.stringify(result)}`);
    }
    await business.release();
  };

  const decodeList = (dir: 'peerToHub' | 'hubToPeer', wireIndex?: number): DecodedMessage[] => {
    const wire = wires[wireIndex ?? wires.length - 1]!;
    return (dir === 'peerToHub' ? wire.peerToHub : wire.hubToPeer).map((bytes) => decodeWire(bytes));
  };

  const nextSeqOf = (dir: 'peerToHub' | 'hubToPeer'): number =>
    decodeList(dir).reduce((max, f) => Math.max(max, f.header.sequence), 0) + 1;

  return {
    hubNode,
    peerNode,
    hub,
    peer,
    nsIds,
    hubEvents: hubEvents.events,
    peerEvents: peerEvents.events,
    wires,
    hubGates,
    peerGates,
    hubLeases,
    peerWrite: (nsId, value) => businessWrite(peerNode, PEER_OWNER, nsId, value),
    hubWrite: (nsId, value) => businessWrite(hubNode, HUB_OWNER, nsId, value),
    rootValue: (side, nsId, key) => {
      const node = side === 'hub' ? hubNode : peerNode;
      const owner = side === 'hub' ? HUB_OWNER : PEER_OWNER;
      const doc = node.persistence.peek(owner, nsId);
      if (doc === undefined) throw new Error(`${side} 缺副本 ${nsId}`);
      return (doc.getMap('ROOT') as unknown as Map<string, unknown>).get(key);
    },
    saveCount: (side, nsId) => {
      const node = side === 'hub' ? hubNode : peerNode;
      return node.persistence.saveEvents.filter((e) => e.docId === nsId).length;
    },
    frames: (dir, filterNs, wireIndex) =>
      decodeList(dir, wireIndex).filter(
        (f) => filterNs === undefined || (f.message as { namespaceId?: string }).namespaceId === filterNs,
      ),
    chunks: (dir, filterNs, wireIndex) => {
      const out: ChunkMsg[] = [];
      for (const f of decodeList(dir, wireIndex)) {
        if (f.message.kind === 'UPDATE_CHUNK') {
          const m = f.message as ChunkMsg;
          if (filterNs === undefined || m.namespaceId === filterNs) out.push(m);
        }
      }
      return out;
    },
    errorCodes: (dir, wireIndex) =>
      decodeList(dir, wireIndex)
        .filter((f) => f.message.kind === 'ERROR')
        .map((f) => (f.message as ErrorMsg).code),
    resyncReasons: (dir, wireIndex) =>
      decodeList(dir, wireIndex)
        .filter((f) => f.message.kind === 'RESYNC_REQUIRED')
        .map((f) => (f.message as ResyncMsg).reasonCode),
    injectPeer: (message) => {
      wires[wires.length - 1]!.peerEnd.send(encodeMessage(message, { sequence: nextSeqOf('peerToHub') }));
    },
    injectHub: (message) => {
      wires[wires.length - 1]!.hubEnd.send(encodeMessage(message, { sequence: nextSeqOf('hubToPeer') }));
    },
    connectionState: () => peer.getConnectionState(),
    namespaceState: (nsId: string) => peer.getNamespaceState(nsId),
    advance: async (ms) => {
      await peerNode.scheduler.advanceBy(ms);
      await hubNode.scheduler.advanceBy(ms);
      await settle();
    },
  };
}

// ═══════════════════════════ 场景断言辅助 ═══════════════════════════

/** 一笔分块 transfer 的整笔收敛等待（以「收敛或违例」终止防伪红挂起；随后钉零违例）。
 *  ERROR 帧方向 = 违例接收方出向（side 'hub' → hubToPeer；side 'peer' → peerToHub）。 */
async function awaitChunked(
  ctx: DynContext,
  side: 'hub' | 'peer',
  nsId: string,
  label: string,
): Promise<void> {
  const errorDir = side === 'hub' ? 'hubToPeer' : 'peerToHub';
  await settleUntil(
    () => ctx.rootValue(side, nsId, 'blurb') === BIG || ctx.errorCodes(errorDir).length > 0,
    `${label}：整笔分块 transfer 必须收敛`,
  );
  expect(ctx.errorCodes(errorDir), `${label}：零 ERROR 违例帧`).toHaveLength(0);
  expect(ctx.rootValue(side, nsId, 'blurb'), `${label} 必须整笔收敛`).toBe(BIG);
}

/** 断线 → 重拨 → 新代际 ready + 全 ns live（REG3 同款节奏）。 */
async function awaitReconnected(ctx: DynContext, what: string): Promise<void> {
  for (let step = 0; step < 160; step += 1) {
    await ctx.advance(250);
    if (
      ctx.wires.length >= 2 &&
      ctx.connectionState() === 'ready' &&
      ctx.nsIds.every((nsId) => ctx.namespaceState(nsId) === 'live')
    ) {
      return;
    }
  }
  throw new Error(
    `重连窗口预算耗尽：${what}（conn=${ctx.connectionState()} dials=${ctx.wires.length}）`,
  );
}

// ═══════════════════════════ 动态验证测试 ═══════════════════════════

describe('issue #244 SA7 动态验证：中止型槽位归还 / 中止矩阵五行事件接线 / 跨窗滑动 deadline', () => {
  it('D-SLOT1（hub · timeout caller 归还）：ns-a partial 停滞超时中止后，同连接串行完成 b/c/d，第 5/第 6 个 distinct ns（e/f）合法首 chunk 必须被接纳并整笔收敛——零 VIOLATION、零 failed', async () => {
    const ctx = await bootDyn({ nsCount: 6 });
    try {
      expect(ctx.wires.length, 'fixture 必须为单连接').toBe(1);
      const [nsA, nsB, nsC, nsD, nsE, nsF] = ctx.nsIds as readonly [string, string, string, string, string, string];
      ctx.peerGates[0]!.arm(1);
      await ctx.peerWrite(nsA, { blurb: BIG });
      await settle();
      expect(ctx.chunks('peerToHub', nsA), 'ns-a chunk0 已出站——hub busy assembly').toHaveLength(1);
      expect(ctx.rootValue('hub', nsA, 'blurb'), '停滞前零部分写入').toBe('seed');

      // timeout caller：停滞 > 缺省 30s → 弃 partial + 归还槽 + aborted{timeout}
      await ctx.advance(DEFAULT_ASSEMBLY_TIMEOUT_MS + 1_000);
      const timeoutAborted = abortedOf(ctx.hubEvents, 'timeout');
      expect(timeoutAborted, 'timeout 中止事件恰一（中止型归还的触发面）').toHaveLength(1);
      expect(timeoutAborted[0]!.namespaceId).toBe(nsA);
      // 对端按 §9.4 收口：peer 弃残余 + 恢复 round → ns-a 经 diff 整笔收敛（闸门只停 data）
      await settleUntil(() => ctx.rootValue('hub', nsA, 'blurb') === BIG, 'ns-a 恢复 round 收敛');

      // 永久放行后：b/c/d 串行完成（完成型归还）；随后 e/f（第 5/6 个 distinct ns）
      // 的首 chunk 必须被接纳——若 timeout caller 泄漏 ns-a 槽，e 即为第 5 个持槽者误 VIOLATION
      ctx.peerGates[0]!.release();
      await ctx.advance(1_000);
      for (const nsId of [nsB, nsC, nsD, nsE, nsF]) {
        const before = ctx.saveCount('hub', nsId);
        await ctx.peerWrite(nsId, { blurb: BIG });
        await awaitChunked(ctx, 'hub', nsId, `ns ${nsId.slice(-4)} 串行 transfer`);
        await settle();
        const perNs = ctx.chunks('peerToHub', nsId);
        expect(perNs.length, `${nsId.slice(-4)} 必须 3 chunk（chunked 路径真实走通）`).toBe(3);
        expect(new Set(perNs.map((c) => c.transferId)).size).toBe(1);
        expect(ctx.saveCount('hub', nsId) - before, `${nsId.slice(-4)} 整笔恰一次 apply`).toBe(1);
      }
      expect(
        ctx.errorCodes('hubToPeer').filter((c) => c === 'UPDATE_TRANSFER_VIOLATION'),
        '中止型归还后全程零 UPDATE_TRANSFER_VIOLATION',
      ).toHaveLength(0);
      expect(failedOf(ctx.hubEvents), 'hub 侧零 failed').toHaveLength(0);
      expect(failedOf(ctx.peerEvents), 'peer 侧零 failed').toHaveLength(0);
      expect(ctx.connectionState(), '连接全程 ready').toBe('ready');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('D-SLOT2（peer · connection-teardown caller 归还 × 跨代际）：代际 1 partial 传输被断线中止（非完成）→ 重拨 → 代际 2 串行完成 b/c/d 后第 5/第 6 个 distinct ns（e/f）必须被接纳——槽位不得跨代际泄漏', async () => {
    const ctx = await bootDyn({ nsCount: 6 });
    try {
      const [nsA, nsB, nsC, nsD, nsE, nsF] = ctx.nsIds as readonly [string, string, string, string, string, string];
      const peerSavesA = ctx.saveCount('peer', nsA);
      ctx.hubGates[0]!.arm(1);
      await ctx.hubWrite(nsA, { blurb: BIG });
      await settle();
      expect(ctx.chunks('hubToPeer', nsA), 'ns-a chunk0 已下行——peer busy assembly').toHaveLength(1);
      expect(ctx.rootValue('peer', nsA, 'blurb'), '中止前零部分写入').toBe('seed');

      // connection-teardown caller：断线 → peer 失联入口置因 → disposal 消费 → 归还槽 + 事件
      ctx.wires[0]!.closePeerSide(1006, 'sa7-dyn teardown reclaim');
      await settleUntil(
        () => abortedOf(ctx.peerEvents, 'connection-teardown').length >= 1,
        '断线中止事件（connection-teardown，peer 侧）',
      );
      await settle();
      const teardownAborted = abortedOf(ctx.peerEvents, 'connection-teardown');
      expect(teardownAborted, 'connection-teardown 中止事件恰一').toHaveLength(1);
      expect(teardownAborted[0]!.side).toBe('peer');
      expect(teardownAborted[0]!.namespaceId).toBe(nsA);
      expect(teardownAborted[0]!.receivedChunks).toBe(1);
      expect(ctx.rootValue('peer', nsA, 'blurb'), '断线中止零部分写入').toBe('seed');
      expect(ctx.saveCount('peer', nsA), '零 durable 写入').toBe(peerSavesA);

      await awaitReconnected(ctx, '断线后自动重拨并回到 ready + 全 ns live');
      expect(ctx.wires.length, '新代际（新 wire）').toBe(2);

      // 代际 2：b/c/d 串行完成（完成型归还）；e/f（第 5/6 个 distinct ns）必须被接纳
      for (const nsId of [nsB, nsC, nsD, nsE, nsF]) {
        const before = ctx.saveCount('peer', nsId);
        await ctx.hubWrite(nsId, { blurb: BIG });
        await awaitChunked(ctx, 'peer', nsId, `代际 2 ns ${nsId.slice(-4)} 串行下行`);
        await settle();
        const perNs = ctx.chunks('hubToPeer', nsId, 1);
        expect(perNs.length, `${nsId.slice(-4)} 代际 2 分块下行真实走通`).toBeGreaterThanOrEqual(2);
        expect(ctx.saveCount('peer', nsId) - before, `${nsId.slice(-4)} 整笔恰一次 apply`).toBe(1);
      }
      expect(
        ctx.errorCodes('peerToHub').filter((c) => c === 'UPDATE_TRANSFER_VIOLATION'),
        '中止型跨代际归还后全程零 UPDATE_TRANSFER_VIOLATION',
      ).toHaveLength(0);
      expect(failedOf(ctx.peerEvents), 'peer 侧跨代际零 failed').toHaveLength(0);
      expect(failedOf(ctx.hubEvents), 'hub 侧跨代际零 failed').toHaveLength(0);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('D-RD1（hub · resync-declared 行·收对端声明边）：busy assembly 中收到对端 RESYNC_REQUIRED → aborted{resync-declared, side:hub} 恰一 + 互补 resync-required{remote-declared} + 零部分写入；后续残渣 chunk 良性丢弃（needs-resync 域零违例）', async () => {
    const ctx = await bootDyn({ nsCount: 1 });
    try {
      const nsId = ctx.nsIds[0]!;
      const savesBefore = ctx.saveCount('hub', nsId);
      ctx.peerGates[0]!.arm(1);
      await ctx.peerWrite(nsId, { blurb: BIG });
      await settle();
      expect(ctx.chunks('peerToHub', nsId), 'chunk0 已出站——hub busy').toHaveLength(1);

      // 对端声明边（注入 = 收到对端 RESYNC_REQUIRED 的确定性构造；发送方静默窗口）
      ctx.injectPeer({ kind: 'RESYNC_REQUIRED', namespaceId: nsId, reasonCode: 'send-queue-overflow' });
      await settle();
      await settle();

      const aborted = abortedOf(ctx.hubEvents, 'resync-declared');
      expect(aborted, 'resync-declared 中止事件恰一（hub 侧）').toHaveLength(1);
      expect(aborted[0]!.side).toBe('hub');
      expect(aborted[0]!.namespaceId).toBe(nsId);
      expect(aborted[0]!.receivedChunks).toBe(1);
      expect(aborted[0]!.receivedBytes).toBeGreaterThan(0);
      // 互补事件：hub 收对端声明 → resync-required{remote-declared} 恰一
      const remote = resyncObserverOf(ctx.hubEvents).filter((e) => e.cause === 'remote-declared');
      expect(remote, '互补 resync-required{remote-declared} 恰一').toHaveLength(1);
      // 零部分写入 / 零违例 / 非 failed 终局
      expect(ctx.rootValue('hub', nsId, 'blurb'), '弃 partial 后零部分写入').toBe('seed');
      expect(ctx.saveCount('hub', nsId)).toBe(savesBefore);
      expect(ctx.errorCodes('hubToPeer'), '零 ERROR').toHaveLength(0);
      expect(failedOf(ctx.hubEvents), 'resync 行不得终局 failed').toHaveLength(0);

      // 残渣语义：放行残余 chunk1/2 → hub 已 needs-resync 且 idle → 良性丢弃（F3）
      ctx.peerGates[0]!.release();
      await ctx.advance(2_000);
      expect(
        ctx.errorCodes('hubToPeer').filter((c) => c === 'UPDATE_TRANSFER_VIOLATION'),
        'needs-resync 域残渣 chunk 必须良性丢弃（零违例）',
      ).toHaveLength(0);
      expect(failedOf(ctx.hubEvents), '残渣丢弃后仍零 failed').toHaveLength(0);
      expect(ctx.rootValue('hub', nsId, 'blurb'), '残渣不得被 apply').toBe('seed');
      expect(ctx.saveCount('hub', nsId)).toBe(savesBefore);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('D-RD2（peer · resync-declared 行·收对端声明边）：peer busy assembly 时 hub 真实声明 RESYNC_REQUIRED（出向队列溢出）→ 对端声明边收帧 → aborted{resync-declared, side:peer} 恰一 + hub 侧零事件（busy 守卫）+ 零部分写入 + 恢复 round 整笔收敛', async () => {
    const ctx = await bootDyn({
      nsCount: 1,
      limits: { ...LIMITS, maxQueuedUpdateBytes: 24 * 1024 },
    });
    try {
      const nsId = ctx.nsIds[0]!;
      const peerSavesBefore = ctx.saveCount('peer', nsId);
      ctx.hubGates[0]!.arm(1);
      await ctx.hubWrite(nsId, { blurb: BIG });
      await settle();
      expect(ctx.chunks('hubToPeer', nsId), 'chunk0 已下行——peer busy').toHaveLength(1);
      expect(ctx.rootValue('peer', nsId, 'blurb'), '中止前零部分写入').toBe('seed');

      // hub 第二笔 20KB 写入队（闸门关死、首笔残部在场）→ 出向队列溢出 →
      // declareHubResync('queue-overflow')：hub 自身入站不 busy → hub 零事件（busy 守卫）；
      // 真实 RESYNC_REQUIRED 帧到达 peer → onResyncReceived 收对端声明边 → peer 中止事件
      await ctx.hubWrite(nsId, { blurb: BIG });
      await settle();
      await settle();

      const aborted = abortedOf(ctx.peerEvents, 'resync-declared');
      expect(aborted, 'resync-declared 中止事件恰一（peer 侧·收对端声明边）').toHaveLength(1);
      expect(aborted[0]!.side).toBe('peer');
      expect(aborted[0]!.namespaceId).toBe(nsId);
      expect(aborted[0]!.receivedChunks).toBe(1);
      expect(aborted[0]!.receivedBytes).toBeGreaterThan(0);
      expect(
        abortedOf(ctx.hubEvents, 'resync-declared'),
        'hub 声明时自身入站不 busy——busy 守卫必须零事件',
      ).toHaveLength(0);
      expect(ctx.resyncReasons('hubToPeer'), 'hub 真实声明 RESYNC_REQUIRED{send-queue-overflow}').toContain(
        'send-queue-overflow',
      );
      expect(
        resyncObserverOf(ctx.peerEvents).filter((e) => e.cause === 'remote-declared'),
        'peer 互补 resync-required{remote-declared} 恰一',
      ).toHaveLength(1);
      expect(ctx.errorCodes('peerToHub'), '零 ERROR').toHaveLength(0);
      expect(failedOf(ctx.peerEvents), 'resync 行不得终局 failed').toHaveLength(0);

      // peer 为 round 发起方：收声明后 maybeStartRecovery → Step1/2（control，不受 data 闸门）
      // → hub 本地 BIG 经 diff 回灌 → peer 整笔收敛（零部分写入后的完整恢复）
      await settleUntil(
        () => ctx.rootValue('peer', nsId, 'blurb') === BIG && ctx.namespaceState(nsId) === 'live',
        'peer 恢复 round 整笔收敛并回 live',
      );
      await settle();
      expect(ctx.saveCount('peer', nsId) - peerSavesBefore, '恢复恰一次整笔 apply').toBe(1);
      expect(failedOf(ctx.hubEvents), 'hub 侧零 failed').toHaveLength(0);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('D-QO1（hub · queue-overflow 行）：busy 入站 assembly 时本端发送队列溢出（maxQueuedUpdateBytes 45KiB × 第 3 笔）→ aborted{resync-declared, side:hub} 恰一 + RESYNC_REQUIRED{send-queue-overflow} + 互补 resync-required{queue-overflow}', async () => {
    const ctx = await bootDyn({
      nsCount: 1,
      limits: { ...LIMITS, maxQueuedUpdateBytes: 45 * 1024 },
    });
    try {
      const nsId = ctx.nsIds[0]!;
      ctx.peerGates[0]!.arm(1);
      await ctx.peerWrite(nsId, { blurb: BIG });
      await settle();
      expect(ctx.chunks('peerToHub', nsId), 'chunk0 已出站——hub busy').toHaveLength(1);

      // hub 出向 data 闸门关死 → 三笔 20KB 大写入队：20480→40960→61440 > 46080 溢出
      ctx.hubGates[0]!.close();
      await ctx.hubWrite(nsId, { blurb: BIG });
      await ctx.hubWrite(nsId, { blurb: BIG });
      await ctx.hubWrite(nsId, { blurb: BIG });
      await settle();

      const aborted = abortedOf(ctx.hubEvents, 'resync-declared');
      expect(aborted, 'queue-overflow 行中止事件恰一（cause 判别 → resync-declared）').toHaveLength(1);
      expect(aborted[0]!.side).toBe('hub');
      expect(aborted[0]!.receivedChunks).toBe(1);
      expect(ctx.resyncReasons('hubToPeer'), '溢出声明 RESYNC_REQUIRED{send-queue-overflow}').toContain(
        'send-queue-overflow',
      );
      const overflowEvents = resyncObserverOf(ctx.hubEvents).filter((e) => e.cause === 'queue-overflow');
      expect(overflowEvents, '互补 resync-required{queue-overflow} 恰一').toHaveLength(1);
      expect(ctx.errorCodes('hubToPeer'), '溢出声明族零 ERROR 违例帧（needs-resync 软收口）').toHaveLength(0);
      expect(failedOf(ctx.hubEvents), '溢出行不得终局 failed').toHaveLength(0);
      // hub 本地写合法在场（整值 BIG，非部分）；peer 经恢复 round 整笔收敛（非部分）
      await settleUntil(() => ctx.rootValue('peer', nsId, 'blurb') === BIG, 'peer 恢复 round 收敛');
      expect(ctx.rootValue('hub', nsId, 'blurb'), 'hub 本地写完整在场').toBe(BIG);
      expect(
        ctx.rootValue('peer', nsId, 'blurb'),
        'peer 收敛为整值 BIG（零部分写入）',
      ).toBe(BIG);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('D-QO2（peer · queue-overflow 行）：busy 入站 assembly 时 peer 发送队列溢出 → aborted{resync-declared, side:peer} 恰一 + RESYNC_REQUIRED{send-queue-overflow}（peer→hub）+ 恢复收敛', async () => {
    const ctx = await bootDyn({
      nsCount: 1,
      limits: { ...LIMITS, maxQueuedUpdateBytes: 45 * 1024 },
    });
    try {
      const nsId = ctx.nsIds[0]!;
      ctx.hubGates[0]!.arm(1);
      await ctx.hubWrite(nsId, { blurb: BIG });
      await settle();
      expect(ctx.chunks('hubToPeer', nsId), 'chunk0 已下行——peer busy').toHaveLength(1);

      ctx.peerGates[0]!.close();
      await ctx.peerWrite(nsId, { blurb: BIG });
      await ctx.peerWrite(nsId, { blurb: BIG });
      await ctx.peerWrite(nsId, { blurb: BIG });
      await settle();

      const aborted = abortedOf(ctx.peerEvents, 'resync-declared');
      expect(aborted, 'peer 侧 queue-overflow 行中止事件恰一').toHaveLength(1);
      expect(aborted[0]!.side).toBe('peer');
      expect(aborted[0]!.receivedChunks).toBe(1);
      expect(ctx.resyncReasons('peerToHub'), 'peer 溢出声明 RESYNC_REQUIRED').toContain(
        'send-queue-overflow',
      );
      expect(
        resyncObserverOf(ctx.peerEvents).filter((e) => e.cause === 'queue-overflow'),
        '互补 resync-required{queue-overflow} 恰一（peer 侧）',
      ).toHaveLength(1);
      expect(failedOf(ctx.peerEvents), '溢出行不得终局 failed').toHaveLength(0);
      // peer 为 round 发起方：declareLocalResync → maybeStartRecovery → hub 整笔收敛
      await settleUntil(() => ctx.rootValue('hub', nsId, 'blurb') === BIG, 'hub 恢复 round 收敛');
      expect(ctx.rootValue('peer', nsId, 'blurb'), 'peer 本地写完整在场').toBe(BIG);
      expect(failedOf(ctx.hubEvents), 'hub 侧零 failed').toHaveLength(0);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('D-SHED1（hub · shed 行）：busy 入站 assembly 时连接级背压弃置（maxQueuedBytesPerConnection 256KiB < 闸门伪 bufferedAmount 600KiB）→ aborted{shed, side:hub} 恰一 + RESYNC_REQUIRED + 互补 resync-required{connection-shed}', async () => {
    const ctx = await bootDyn({
      nsCount: 1,
      limits: {
        ...LIMITS,
        maxQueuedBytesPerConnection: 256 * 1024,
        highWater: 128 * 1024,
        lowWater: 16 * 1024,
      },
    });
    try {
      const nsId = ctx.nsIds[0]!;
      ctx.peerGates[0]!.arm(1);
      await ctx.peerWrite(nsId, { blurb: BIG });
      await settle();
      expect(ctx.chunks('peerToHub', nsId), 'chunk0 已出站——hub busy').toHaveLength(1);
      expect(ctx.rootValue('hub', nsId, 'blurb'), 'shed 前零部分写入').toBe('seed');

      // hub 出向伪 bufferedAmount=600KiB > cap 256KiB：首个 data 入队即触发连接级 shed，
      // victim = 最大 queued ns（唯一 ns）→ live 通道声明边 → cause 判别 → 'shed'
      ctx.hubGates[0]!.close();
      await ctx.hubWrite(nsId, { blurb: BIG });
      await settle();
      await settle();
      const aborted = abortedOf(ctx.hubEvents, 'shed');
      expect(aborted, 'shed 行中止事件恰一（hub 侧）').toHaveLength(1);
      expect(aborted[0]!.side).toBe('hub');
      expect(aborted[0]!.namespaceId).toBe(nsId);
      expect(aborted[0]!.receivedChunks).toBe(1);
      expect(abortedOf(ctx.hubEvents, 'resync-declared'), 'cause 判别不得误标 resync-declared').toHaveLength(0);
      expect(ctx.resyncReasons('hubToPeer'), 'shed 声明 RESYNC_REQUIRED{send-queue-overflow}').toContain(
        'send-queue-overflow',
      );
      expect(
        resyncObserverOf(ctx.hubEvents).filter((e) => e.cause === 'connection-shed'),
        '互补 resync-required{connection-shed} 恰一',
      ).toHaveLength(1);
      expect(ctx.errorCodes('hubToPeer'), 'shed 行零 ERROR').toHaveLength(0);
      expect(failedOf(ctx.hubEvents), 'shed 行不得终局 failed').toHaveLength(0);
      // hub 入站 partial 已弃（chunk0 不再滞留）；hub 本地写完整在场；peer 经 round 收敛
      expect(ctx.rootValue('hub', nsId, 'blurb'), 'hub 本地写完整在场（整值）').toBe(BIG);
      await settleUntil(() => ctx.rootValue('peer', nsId, 'blurb') === BIG, 'peer 恢复 round 收敛');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('D-SHED2（peer · shed 行）：busy 入站 assembly 时 peer 连接级背压弃置 → aborted{shed, side:peer} 恰一 + RESYNC_REQUIRED（peer→hub）+ 恢复收敛', async () => {
    const ctx = await bootDyn({
      nsCount: 1,
      limits: {
        ...LIMITS,
        maxQueuedBytesPerConnection: 256 * 1024,
        highWater: 128 * 1024,
        lowWater: 16 * 1024,
      },
    });
    try {
      const nsId = ctx.nsIds[0]!;
      ctx.hubGates[0]!.arm(1);
      await ctx.hubWrite(nsId, { blurb: BIG });
      await settle();
      expect(ctx.chunks('hubToPeer', nsId), 'chunk0 已下行——peer busy').toHaveLength(1);
      expect(ctx.rootValue('peer', nsId, 'blurb'), 'shed 前零部分写入').toBe('seed');

      ctx.peerGates[0]!.close();
      await ctx.peerWrite(nsId, { blurb: BIG });
      await settle();
      await settle();

      const aborted = abortedOf(ctx.peerEvents, 'shed');
      expect(aborted, 'shed 行中止事件恰一（peer 侧）').toHaveLength(1);
      expect(aborted[0]!.side).toBe('peer');
      expect(aborted[0]!.receivedChunks).toBe(1);
      expect(abortedOf(ctx.peerEvents, 'resync-declared'), 'cause 判别不得误标 resync-declared').toHaveLength(0);
      expect(ctx.resyncReasons('peerToHub'), 'peer shed 声明 RESYNC_REQUIRED').toContain(
        'send-queue-overflow',
      );
      expect(
        resyncObserverOf(ctx.peerEvents).filter((e) => e.cause === 'connection-shed'),
        '互补 resync-required{connection-shed} 恰一（peer 侧）',
      ).toHaveLength(1);
      expect(failedOf(ctx.peerEvents), 'shed 行不得终局 failed').toHaveLength(0);
      await settleUntil(() => ctx.rootValue('hub', nsId, 'blurb') === BIG, 'hub 恢复 round 收敛');
      expect(ctx.rootValue('peer', nsId, 'blurb'), 'peer 本地写完整在场').toBe(BIG);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('D-FENCE（epoch-fence 行 · hub/peer 双侧 + side 字段）：双侧 busy assembly 时 hub epoch bump → fence 终局 → hub aborted{epoch-fence, side:hub} + IDENTITY_CHANGED + peer aborted{epoch-fence, side:peer}（conflicted 族 carve-out：fence 发射）+ 双向零部分写入', async () => {
    const ctx = await bootDyn({ nsCount: 1, timeouts: { ackTimeoutMs: 5_000 } });
    try {
      const nsId = ctx.nsIds[0]!;
      // 双侧 busy + 逐值哨兵：peer 写 BIG_P（peer→hub 分块），hub 写 BIG_H（hub→peer 分块）
      ctx.peerGates[0]!.arm(1);
      ctx.hubGates[0]!.arm(1);
      await ctx.peerWrite(nsId, { blurb: BIG_P });
      await ctx.hubWrite(nsId, { blurb: BIG_H });
      await settle();
      expect(ctx.chunks('peerToHub', nsId), 'hub busy 入站（peer chunk0）').toHaveLength(1);
      expect(ctx.chunks('hubToPeer', nsId), 'peer busy 入站（hub chunk0）').toHaveLength(1);
      expect(ctx.rootValue('peer', nsId, 'blurb'), 'peer 本地写 BIG_P 在场').toBe(BIG_P);
      expect(ctx.rootValue('hub', nsId, 'blurb'), 'hub 本地写 BIG_H 在场').toBe(BIG_H);
      const hubSavesBefore = ctx.saveCount('hub', nsId);
      const peerSavesBefore = ctx.saveCount('peer', nsId);

      // hub 侧 epoch bump（经 fixture lease——runtime 复制管理写）→ watchdog 检出 fence 边沿
      const lease = ctx.hubLeases.get(nsId)!;
      const bumped = await lease.bumpReplicationEpoch();
      if (!bumped.ok) throw new Error(`bumpReplicationEpoch 失败：${JSON.stringify(bumped)}`);
      await settle();
      await ctx.advance(6_000);

      const hubAborted = abortedOf(ctx.hubEvents, 'epoch-fence');
      expect(hubAborted, 'hub 侧 fence 中止事件恰一（conflicted 族 carve-out）').toHaveLength(1);
      expect(hubAborted[0]!.side).toBe('hub');
      expect(hubAborted[0]!.namespaceId).toBe(nsId);
      expect(hubAborted[0]!.receivedChunks).toBe(1);

      const identityFrames = ctx
        .frames('hubToPeer', nsId)
        .filter((f) => f.message.kind === 'IDENTITY_CHANGED');
      expect(identityFrames, 'fence 终局恰一帧 IDENTITY_CHANGED').toHaveLength(1);

      const peerAborted = abortedOf(ctx.peerEvents, 'epoch-fence');
      expect(peerAborted, 'peer 侧经 IDENTITY_CHANGED 镜像 fence 中止事件恰一').toHaveLength(1);
      expect(peerAborted[0]!.side).toBe('peer');
      expect(peerAborted[0]!.receivedChunks).toBe(1);

      // 互补 identity-conflicted 事件双侧在场；fence 终局非 failed 族
      expect(
        ctx.hubEvents.filter((e) => e.type === 'identity-conflicted'),
        'hub 侧互补 identity-conflicted',
      ).toHaveLength(1);
      expect(
        ctx.peerEvents.filter((e) => e.type === 'identity-conflicted'),
        'peer 侧互补 identity-conflicted',
      ).toHaveLength(1);
      expect(failedOf(ctx.hubEvents), 'fence = conflicted 族（非 failed）').toHaveLength(0);
      expect(failedOf(ctx.peerEvents), 'peer 侧零 failed').toHaveLength(0);
      // 双向零部分写入：对端分块传输（各收 chunk0）不得 apply——各自哨兵值保持；
      // peer 零新增 durable 写入；hub 唯一新增 = bumpReplicationEpoch 的 META 落盘
      expect(ctx.rootValue('peer', nsId, 'blurb'), 'peer 弃 partial：BIG_H 不得部分/整体落地').toBe(BIG_P);
      expect(ctx.rootValue('hub', nsId, 'blurb'), 'hub 弃 partial：BIG_P 不得部分/整体落地').toBe(BIG_H);
      expect(ctx.saveCount('peer', nsId), 'peer 零新增 durable 写入（无分块 apply）').toBe(peerSavesBefore);
      expect(
        ctx.saveCount('hub', nsId),
        'hub 唯一新增 durable 写入 = epoch bump 的 META 落盘（零分块 apply）',
      ).toBe(hubSavesBefore + 1);
      expect(ctx.namespaceState(nsId), 'peer ns 终局 conflicted').toBe('conflicted');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('D-GOAWAY（GOAWAY drain 行 · R13 归并 connection-teardown）：peer busy assembly 时收到 GOAWAY{SERVER_RESTARTING} → drain deadline quiesce → aborted{connection-teardown, side:peer} 恰一 + 零部分写入 + 重连后经 reconciliation 收敛', async () => {
    const ctx = await bootDyn({ nsCount: 1 });
    try {
      const nsId = ctx.nsIds[0]!;
      const peerSavesBefore = ctx.saveCount('peer', nsId);
      ctx.hubGates[0]!.arm(1);
      await ctx.hubWrite(nsId, { blurb: BIG });
      await settle();
      expect(ctx.chunks('hubToPeer', nsId), 'chunk0 已下行——peer busy').toHaveLength(1);
      expect(ctx.rootValue('peer', nsId, 'blurb'), 'GOAWAY 前零部分写入').toBe('seed');

      ctx.injectHub({ kind: 'GOAWAY', reasonCode: 'SERVER_RESTARTING', drainTimeoutMs: 3_000 });
      await settle();
      expect(ctx.connectionState(), 'GOAWAY 后连接 draining').toBe('draining');

      // drain deadline：quiesceControllers → onConnectionFatal 置因 → disposal 消费 → close(1001)
      await ctx.advance(3_500);
      const aborted = abortedOf(ctx.peerEvents, 'connection-teardown');
      expect(aborted, 'GOAWAY drain 中止事件恰一（归并 connection-teardown）').toHaveLength(1);
      expect(aborted[0]!.side).toBe('peer');
      expect(aborted[0]!.namespaceId).toBe(nsId);
      expect(aborted[0]!.receivedChunks).toBe(1);
      expect(ctx.rootValue('peer', nsId, 'blurb'), 'drain 中止零部分写入').toBe('seed');
      expect(ctx.saveCount('peer', nsId), '零 durable 写入').toBe(peerSavesBefore);
      expect(failedOf(ctx.peerEvents), 'GOAWAY=临时失败面（零 failed）').toHaveLength(0);

      // 真实 WS 语义：本地主动 close() 后本地同样收到 close 事件（harness 以 closePeerSide 同模交付）
      ctx.wires[0]!.closePeerSide(1001, 'goaway-drain');
      await awaitReconnected(ctx, 'GOAWAY backoff 后重拨 ready + 全 ns live');
      // 重连后经既有 reconciliation 收敛（数据不丢）
      await settleUntil(
        () => ctx.rootValue('peer', nsId, 'blurb') === BIG && ctx.namespaceState(nsId) === 'live',
        '重连后 ns 收敛并回 live',
      );
      expect(
        abortedOf(ctx.peerEvents, 'connection-teardown'),
        '重连恢复后中止事件不重复（恰一保持）',
      ).toHaveLength(1);
      expect(failedOf(ctx.hubEvents), 'hub 侧零 failed').toHaveLength(0);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('D-SLIDE（跨窗滑动 deadline · SA4 §10 行 3）：chunk0@t0 → 20s 停滞 → chunk1@≈20.7s → 19.3s 停滞 → chunk2@≈40.7s（累计 >30s、逐段 <30s）必须零 RESYNC/零 aborted 并整笔收敛；完成后 31s 再推进零动作', async () => {
    const ctx = await bootDyn({ nsCount: 1 });
    try {
      const nsId = ctx.nsIds[0]!;
      const savesBefore = ctx.saveCount('hub', nsId);
      ctx.peerGates[0]!.arm(1);
      await ctx.peerWrite(nsId, { blurb: BIG });
      await settle();
      expect(ctx.chunks('peerToHub', nsId), 'chunk0 @t0 已出站').toHaveLength(1);
      expect(ctx.rootValue('hub', nsId, 'blurb'), '未收齐零 apply').toBe('seed');

      // 第一段停滞 20s（<30s 缺省）：零误报（N4 前窗语义）
      await ctx.advance(20_000);
      expect(ctx.resyncReasons('hubToPeer'), '20s 零 RESYNC').toHaveLength(0);
      expect(abortedOf(ctx.hubEvents, 'timeout'), '20s 零 aborted').toHaveLength(0);

      // drip 放行 chunk1 @≈t20.7s（poll ≤600ms 内恢复排水，恰一帧后再暂停）
      ctx.peerGates[0]!.drip();
      await ctx.advance(700);
      expect(ctx.chunks('peerToHub', nsId).length, 'chunk1 恰一放行').toBe(2);

      // 第二段停滞 19.3s：累计 t≈40s > 30s 窗口——deadline 必须已随 chunk1 重置（滑动）
      await ctx.advance(19_300);
      expect(
        ctx.resyncReasons('hubToPeer').filter((r) => r === 'UPDATE_TRANSFER_EXPIRED'),
        '累计 >30s 但逐段 <30s：不得误触发 EXPIRED（滑动 deadline 语义）',
      ).toHaveLength(0);
      expect(abortedOf(ctx.hubEvents, 'timeout'), '跨窗形态零 aborted').toHaveLength(0);
      expect(ctx.rootValue('hub', nsId, 'blurb'), '未收齐零 apply').toBe('seed');
      expect(ctx.saveCount('hub', nsId)).toBe(savesBefore);

      // drip 放行 chunk2 @≈t40.7s → 收齐 → 恰一次 apply + 单 ACK
      ctx.peerGates[0]!.drip();
      await ctx.advance(700);
      await settleUntil(
        () => ctx.rootValue('hub', nsId, 'blurb') === BIG && ctx.namespaceState(nsId) === 'live',
        '跨窗整笔收敛并回 live',
      );
      await settle();
      const chunks = ctx.chunks('peerToHub', nsId);
      expect(chunks.length, '同一 transferId 收齐 3 chunk').toBe(3);
      expect(new Set(chunks.map((c) => c.transferId)).size).toBe(1);
      expect(ctx.saveCount('hub', nsId) - savesBefore, '整笔恰一次 apply').toBe(1);
      expect(
        ctx.frames('hubToPeer', nsId).filter((f) => f.message.kind === 'UPDATE_ACK'),
        '单 ACK',
      ).toHaveLength(1);
      expect(ctx.resyncReasons('hubToPeer'), '全程零 RESYNC').toHaveLength(0);
      expect(failedOf(ctx.hubEvents)).toHaveLength(0);
      expect(failedOf(ctx.peerEvents)).toHaveLength(0);

      // 完成后 timer 已清：再推进 31s 零动作（busy→idle 出口清 timer 的动态复核）
      await ctx.advance(DEFAULT_ASSEMBLY_TIMEOUT_MS + 1_000);
      expect(ctx.resyncReasons('hubToPeer'), '完成后推进零 RESYNC').toHaveLength(0);
      expect(abortedOf(ctx.hubEvents, 'timeout'), '完成后推进零 aborted').toHaveLength(0);
      expect(failedOf(ctx.hubEvents), '完成后推进零 failed').toHaveLength(0);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });
});

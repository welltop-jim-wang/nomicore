/**
 * SA4-1 回归 —— issue #244（issue #233 切片 3）连接级入站 assembly 槽位生命周期。
 *
 * 缺陷（SA4-1 BLOCKER）：两通道（hub `onUpdateChunk` / peer `onHubUpdateChunk`）的
 * `assemblySlotHeld` 镜像旗标从未被置 `true`——`endAssemblyScope` 的归还守卫
 * （`if (!this.assemblySlotHeld) return;`）使 `host.endInboundAssembly` 唯一调用点
 * 不可达，连接级 `inboundAssemblySlots` 集合只增不减。任何连接上曾有
 * ≥ `maxConcurrentAssembliesPerConnection`（缺省 4）个 distinct namespace 发起过
 * 入站分块传输后（即便全部正常收齐、串行非并发），后续**新** namespace 的合法首
 * chunk 永久误收 `UPDATE_TRANSFER_VIOLATION` + 终局 failed：
 *
 *  - hub 侧：泄漏持续整个连接生命周期（`HubConnectionImpl`）；
 *  - peer 侧：`PeerConnectionImpl` 跨拨号代际存活 → 泄漏跨断线重连累积。
 *
 * 本文件 = SA4 §9 SA4-1 Required change 的回归面（dispatch「修复后超过四个串行完成
 * 的跨 namespace 分块传输，后续合法首 chunk 必须被接纳」）。既有 SA6 红灯契约
 * （R4 止于 5 ns 并发 + victim failed，同 ns 重试被 `has→true` 幂等吸收）对归还路径
 * 零覆盖——本文件补三场景，修复前必须红：
 *
 *   REG1（hub 入站 · 串行 6 distinct ns）：单连接上 6 个 namespace 各自**串行完成**
 *     整笔 peer→hub 分块传输（每笔收齐 + ACK 后才发起下一笔）——第 5、第 6 个
 *     namespace 的合法首 chunk 必须被接纳（修复前：第 5 个即误 VIOLATION + failed）；
 *   REG2（peer 入站 · 串行 6 distinct ns）：同构镜像——hub 业务写 6 ns 分块下行，
 *     peer 侧串行收齐，第 5、第 6 个合法首 chunk 必须被接纳（修复前：peer 误拒 e）；
 *   REG3（peer 入站 · 断线重连新代际）：代际 1 串行完成 4 个 hub→peer 分块传输后
 *     网络断线（closePeerSide 1006）→ 自动重拨（新 wire、新代际）→ 代际 2 中对此前
 *     从未传输过的第 5 个 ns 发起分块传输必须正常收敛（修复前：代际 1 的 4 个泄漏
 *     槽跨代际存活 → 新代际首 chunk 误 VIOLATION）。
 *
 * 纪律与既有套件一致：真实 yjs / Registry / Runtime；fake-duplex + fake scheduler
 * （advanceBy 驱动全部虚拟时间）；零 real sleep；零源码 grep 断言；无 skip/only/todo。
 * 红灯契约文件（ws-replication-issue244-ac-red.test.ts）零改动。
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
import {
  CAP_CHUNKED_UPDATE,
  decodeMessage,
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

function schemaOf(tag: string): Readonly<{ lang: string; version: number; id: string; text: string }> {
  return {
    lang: 'vfsl',
    version: 1,
    id: `issue244-slot-reclaim-${tag}`,
    text: 'type ROOT = { n: number; blurb: string; };\n',
  };
}

/** 契约同款极限构型：maxUpdateBytes=8KiB，大写 20KB → 分块 ≈3 帧（chunked 路径必须被
 *  真实走通——否则 D3 槽位门不会被触发，回归测试即失效）。 */
const LIMITS: Readonly<Partial<ReplicationLimits>> = {
  maxUpdateBytes: 8 * 1024,
  maxQueuedUpdateCount: 100,
  maxQueuedUpdateBytes: 1 * 1024 * 1024,
  maxInFlightUpdates: 8,
};

const TIMEOUTS: Readonly<Partial<ReplicationTimeouts>> = {
  ackTimeoutMs: 60_000,
};

const BIG = 'z'.repeat(20_000); // 编码后 ≈20,029B > maxUpdateBytes 8KiB → 3 chunk

/** 串行完成的 distinct ns 数必须 > 缺省 maxConcurrentAssembliesPerConnection（4）。 */
const TAGS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

type ChunkMsg = Extract<DecodedMessage['message'], { kind: 'UPDATE_CHUNK' }>;
type ErrorMsg = Extract<DecodedMessage['message'], { kind: 'ERROR' }>;

function decodeWire(bytes: Uint8Array): DecodedMessage {
  return decodeMessage(bytes, { selectedCapabilities: CAP_CHUNKED_UPDATE });
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

function failedOf(events: readonly ReplicationObserverEvent[]): ReplicationObserverEvent[] {
  return events.filter((e) => e.type === 'namespace-failed');
}

// ═══════════════════════════ 单连接 6 ns 本地组装（双方向可写；拨号可重入） ═══════════════════════════

interface SlotContext {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly nsIds: readonly string[];
  readonly peerEvents: ReplicationObserverEvent[];
  readonly hubEvents: ReplicationObserverEvent[];
  /** 每次拨号一个 wire（代际 = wires.length）；断言只读「当前代际」wire。 */
  readonly wires: Wire[];
  peerWrite(nsId: string, value: Readonly<{ n?: number; blurb?: string }>): Promise<void>;
  hubWrite(nsId: string, value: Readonly<{ n?: number; blurb?: string }>): Promise<void>;
  rootValue(side: 'hub' | 'peer', nsId: string, key: 'blurb' | 'n'): unknown;
  frames(dir: 'peerToHub' | 'hubToPeer', nsId?: string, wireIndex?: number): DecodedMessage[];
  chunks(dir: 'peerToHub' | 'hubToPeer', wireIndex?: number): ChunkMsg[];
  advance(ms: number): Promise<void>;
}

async function bootSlots(): Promise<SlotContext> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const nsIds: string[] = [];
  for (const tag of TAGS) {
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
  const wires: Wire[] = [];

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
    timeouts: TIMEOUTS,
    observer: hubEvents.observer,
  });

  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      const wire = makeWire();
      wires.push(wire);
      void hub.accept(wire.hubEnd, { token: TEST_TOKEN });
      return wire.peerEnd;
    },
    timer: peerNode.scheduler,
    targets: nsIds.map((namespaceId) => ({ namespaceId, localOwner: PEER_OWNER })),
    limits: LIMITS,
    timeouts: TIMEOUTS,
    random: () => 0.5, // 重拨退避确定性（REG3 依赖）
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

  return {
    hubNode,
    peerNode,
    hub,
    peer,
    nsIds,
    peerEvents: peerEvents.events,
    hubEvents: hubEvents.events,
    wires,
    peerWrite: (nsId, value) => businessWrite(peerNode, PEER_OWNER, nsId, value),
    hubWrite: (nsId, value) => businessWrite(hubNode, HUB_OWNER, nsId, value),
    rootValue: (side, nsId, key) => {
      const node = side === 'hub' ? hubNode : peerNode;
      const owner = side === 'hub' ? HUB_OWNER : PEER_OWNER;
      const doc = node.persistence.peek(owner, nsId);
      if (doc === undefined) throw new Error(`${side} 缺副本 ${nsId}`);
      return (doc.getMap('ROOT') as unknown as Map<string, unknown>).get(key);
    },
    frames: (dir, filterNs, wireIndex) => {
      const wire = wires[wireIndex ?? wires.length - 1]!;
      const list = dir === 'peerToHub' ? wire.peerToHub : wire.hubToPeer;
      return list
        .map((bytes) => decodeWire(bytes))
        .filter((f) => filterNs === undefined || (f.message as { namespaceId?: string }).namespaceId === filterNs);
    },
    chunks: (dir, wireIndex) => {
      const wire = wires[wireIndex ?? wires.length - 1]!;
      const list = dir === 'peerToHub' ? wire.peerToHub : wire.hubToPeer;
      const out: ChunkMsg[] = [];
      for (const bytes of list) {
        const decoded = decodeWire(bytes);
        if (decoded.message.kind === 'UPDATE_CHUNK') out.push(decoded.message as ChunkMsg);
      }
      return out;
    },
    advance: async (ms) => {
      await peerNode.scheduler.advanceBy(ms);
      await hubNode.scheduler.advanceBy(ms);
      await settle();
    },
  };
}

// ═══════════════════════════ 场景断言辅助 ═══════════════════════════

function violationErrorFrames(ctx: SlotContext, dir: 'peerToHub' | 'hubToPeer'): string[] {
  return ctx
    .frames(dir)
    .filter((f) => f.message.kind === 'ERROR')
    .map((f) => (f.message as ErrorMsg).code)
    .filter((code) => code === 'UPDATE_TRANSFER_VIOLATION');
}

/** 一笔分块 transfer 的整笔收敛等待：修复前（槽位泄漏）第 5 个 distinct ns 会被误
 *  UPDATE_TRANSFER_VIOLATION 而永不收敛——谓词以「收敛或违例」终止，随后用断言钉住
 *  「零 VIOLATION + 已收敛」，红/绿失败点都精确落在 SA4-1 语义上。 */
async function awaitChunkedTransfer(
  ctx: SlotContext,
  side: 'hub' | 'peer',
  nsId: string,
  dir: 'peerToHub' | 'hubToPeer',
  label: string,
): Promise<void> {
  await settleUntil(
    () => ctx.rootValue(side, nsId, 'blurb') === BIG || violationErrorFrames(ctx, dir).length > 0,
    `${label}：整笔分块 transfer 必须收敛（修复前第 5 个 distinct ns 的合法首 chunk 会误 VIOLATION）`,
  );
  expect(
    violationErrorFrames(ctx, dir),
    `SA4-1 回归：${label}——已完成 4 笔串行 transfer 后，新 namespace 的合法首 chunk 不得误 UPDATE_TRANSFER_VIOLATION（连接级槽位必须随每笔完成归还）`,
  ).toHaveLength(0);
  expect(ctx.rootValue(side, nsId, 'blurb'), `${label} 必须整笔收敛`).toBe(BIG);
}

function saveDelta(
  node: ReplicaNode,
  docId: string,
  before: Readonly<Map<string, number>>,
): number {
  return node.persistence.saveEvents.filter((e) => e.docId === docId).length - (before.get(docId) ?? 0);
}

function allLive(ctx: SlotContext): boolean {
  return ctx.nsIds.every((nsId) => ctx.peer.getNamespaceState(nsId) === 'live');
}

/** 断线 → 重拨 → 新代际 ready + 全 ns live（虚拟时钟推进驱动 close 传播/backoff/
 *  握手/boot；必须先推进再检查——close 事件经 queueMicrotask 传播，立即检查会早退）。 */
async function awaitReconnected(ctx: SlotContext, what: string): Promise<void> {
  for (let step = 0; step < 120; step += 1) {
    await ctx.advance(250);
    if (ctx.wires.length >= 2 && ctx.peer.getConnectionState() === 'ready' && allLive(ctx)) return;
  }
  throw new Error(
    `重连窗口预算耗尽：${what}（conn=${String(ctx.peer.getConnectionState())} dials=${ctx.wires.length}）`,
  );
}

// ═══════════════════════════ 回归测试（SA4-1；修复前每例必须红） ═══════════════════════════

describe('issue #244 SA4-1 回归：连接级入站 assembly 槽位随完成归还（串行 >4 个 distinct ns）', () => {
  it('REG1（hub 入站 · peer→hub）：6 个 distinct ns 串行整笔分块 transfer 全部收敛——第 5/第 6 个合法首 chunk 必须被接纳，零 UPDATE_TRANSFER_VIOLATION、零 failed（修复前：槽位泄漏 → ns-e 误 VIOLATION）', async () => {
    const ctx = await bootSlots();
    try {
      expect(ctx.wires.length, 'fixture 必须为单连接（单代际）').toBe(1);
      const savesBefore = new Map<string, number>();
      for (const nsId of ctx.nsIds) {
        savesBefore.set(
          nsId,
          ctx.hubNode.persistence.saveEvents.filter((e) => e.docId === nsId).length,
        );
      }
      for (const [index, nsId] of ctx.nsIds.entries()) {
        await ctx.peerWrite(nsId, { blurb: BIG });
        await awaitChunkedTransfer(
          ctx,
          'hub',
          nsId,
          'hubToPeer',
          `ns-${TAGS[index]}（第 ${index + 1} 个 distinct ns 的串行 transfer）`,
        );
        await settle();
      }
      // 每笔都真实走了分块路径（≥2 帧 = chunked；缺省几何 = 恰 3 帧）——否则 D3 槽位门
      // 未被触发，本回归即失效
      for (const [index, nsId] of ctx.nsIds.entries()) {
        const perNs = ctx.chunks('peerToHub').filter((c) => c.namespaceId === nsId);
        expect(perNs.length, `ns-${TAGS[index]} 必须按 3 chunk 分块传输（chunked 路径真实走通）`).toBe(3);
        expect(new Set(perNs.map((c) => c.transferId)).size).toBe(1);
        expect(saveDelta(ctx.hubNode, nsId, savesBefore), `ns-${TAGS[index]} 整笔恰一次 apply`).toBe(1);
      }
      expect(violationErrorFrames(ctx, 'hubToPeer'), '全程零 UPDATE_TRANSFER_VIOLATION').toHaveLength(0);
      expect(failedOf(ctx.hubEvents), 'hub 侧 6 ns 零 failed').toHaveLength(0);
      expect(failedOf(ctx.peerEvents), 'peer 侧零 failed').toHaveLength(0);
      expect(ctx.peer.getConnectionState(), '连接全程 ready').toBe('ready');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('REG2（peer 入站 · hub→peer）：hub 业务写 6 个 distinct ns 串行分块下行全部收敛——第 5/第 6 个合法首 chunk 必须被接纳，零 UPDATE_TRANSFER_VIOLATION、零 failed（修复前：peer 槽位泄漏 → ns-e 误 VIOLATION）', async () => {
    const ctx = await bootSlots();
    try {
      const savesBefore = new Map<string, number>();
      for (const nsId of ctx.nsIds) {
        savesBefore.set(
          nsId,
          ctx.peerNode.persistence.saveEvents.filter((e) => e.docId === nsId).length,
        );
      }
      for (const [index, nsId] of ctx.nsIds.entries()) {
        await ctx.hubWrite(nsId, { blurb: BIG });
        await awaitChunkedTransfer(
          ctx,
          'peer',
          nsId,
          'peerToHub',
          `ns-${TAGS[index]}（第 ${index + 1} 个 distinct ns 的串行下行 transfer）`,
        );
        await settle();
      }
      for (const [index, nsId] of ctx.nsIds.entries()) {
        const perNs = ctx.chunks('hubToPeer').filter((c) => c.namespaceId === nsId);
        expect(perNs.length, `ns-${TAGS[index]} 必须分块下行（chunked 路径真实走通）`).toBeGreaterThanOrEqual(2);
        expect(new Set(perNs.map((c) => c.transferId)).size).toBe(1);
        expect(saveDelta(ctx.peerNode, nsId, savesBefore), `ns-${TAGS[index]} peer 整笔恰一次 apply`).toBe(1);
      }
      expect(violationErrorFrames(ctx, 'peerToHub'), '全程零 UPDATE_TRANSFER_VIOLATION').toHaveLength(0);
      expect(failedOf(ctx.peerEvents), 'peer 侧 6 ns 零 failed').toHaveLength(0);
      expect(failedOf(ctx.hubEvents), 'hub 侧零 failed').toHaveLength(0);
      expect(ctx.peer.getConnectionState(), '连接全程 ready').toBe('ready');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('REG3（peer 入站 · 断线重连新代际）：代际 1 串行完成 4 笔 hub→peer 分块传输 → 断线重拨 → 代际 2 中对新 ns（此前从未传输）的分块传输必须正常收敛——槽位不得跨代际泄漏（修复前：代际 1 泄漏的 4 槽使新代际首 chunk 误 VIOLATION）', async () => {
    const ctx = await bootSlots();
    try {
      expect(ctx.wires.length, 'fixture 初始单连接').toBe(1);
      // 代际 1：串行完成 4 笔（a..d）hub→peer 分块传输
      for (const [index, nsId] of ctx.nsIds.slice(0, 4).entries()) {
        await ctx.hubWrite(nsId, { blurb: BIG });
        await awaitChunkedTransfer(
          ctx,
          'peer',
          nsId,
          'peerToHub',
          `代际 1 ns-${TAGS[index]}（第 ${index + 1} 笔串行下行 transfer）`,
        );
        await settle();
      }
      // 网络级断线（两应用侧均收 close）→ peer 自动退避重拨 → 新代际 ready + 全 ns live
      ctx.wires[0]!.closePeerSide(1006, 'sa41-regression network lost');
      await awaitReconnected(ctx, '断线后必须自动重拨并回到 ready + 全 ns live');
      expect(ctx.wires.length, '断线后必须重拨出新一代际（新 wire）').toBe(2);

      // 代际 2：新 ns e（此前任何代际从未发起过传输）分块传输必须被接纳并整笔收敛
      const nsE = ctx.nsIds[4]!;
      const savesBeforeE = ctx.peerNode.persistence.saveEvents.filter((e) => e.docId === nsE).length;
      await ctx.hubWrite(nsE, { blurb: BIG });
      await awaitChunkedTransfer(ctx, 'peer', nsE, 'peerToHub', '代际 2 新 ns-e（第 5 个 distinct ns）');
      await settle();
      const perNsE = ctx.chunks('hubToPeer').filter((c) => c.namespaceId === nsE);
      expect(perNsE.length, '代际 2 ns-e 必须分块下行（chunked 路径真实走通）').toBeGreaterThanOrEqual(2);
      expect(
        ctx.peerNode.persistence.saveEvents.filter((e) => e.docId === nsE).length - savesBeforeE,
        '代际 2 ns-e 整笔恰一次 apply',
      ).toBe(1);
      // 代际 2 的第六个 ns f 同样必须被接纳（泄漏修复后无任何历史残留）
      const nsF = ctx.nsIds[5]!;
      const savesBeforeF = ctx.peerNode.persistence.saveEvents.filter((e) => e.docId === nsF).length;
      await ctx.hubWrite(nsF, { blurb: BIG });
      await awaitChunkedTransfer(ctx, 'peer', nsF, 'peerToHub', '代际 2 ns-f（第 6 个 distinct ns）');
      await settle();
      expect(
        ctx.peerNode.persistence.saveEvents.filter((e) => e.docId === nsF).length - savesBeforeF,
        '代际 2 ns-f 整笔恰一次 apply',
      ).toBe(1);
      expect(violationErrorFrames(ctx, 'peerToHub'), '新代际全程零 UPDATE_TRANSFER_VIOLATION').toHaveLength(0);
      expect(failedOf(ctx.peerEvents), 'peer 侧跨代际零 failed').toHaveLength(0);
      expect(failedOf(ctx.hubEvents), 'hub 侧跨代际零 failed').toHaveLength(0);
      expect(ctx.peer.getConnectionState(), '代际 2 连接 ready').toBe('ready');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });
});

/**
 * SA6 红灯验收契约 —— issue #243（issue #233 切片 2）：协商过 CAP_CHUNKED_UPDATE 的
 * Hub/Peer 之间，超过 maxUpdateBytes 的单逻辑 live update 必须以 UPDATE_CHUNK 帧流
 * live 传输（独立 sequence、每帧 ≤ maxUpdateBytes、整笔占 1 in-flight 槽、收齐重组后
 * 恰一次 trusted apply + dirty、单 UPDATE_ACK 结算、零 SYNC round）；未协商双端保持
 * v1 逐字节行为（ADR 0013 + Host 任务简报 AC1–AC8）。
 *
 * 当前 HEAD（c20aeb0，切片 1 已合入）：wire 面已冻结（0x42 codec / CAP bit /
 * decode 门控 / 两错误码），但 ws-replication 连接层**无任何分块能力**——
 * HELLO.optionalCapabilities/HELLO_ACK.selectedCapabilities 硬编码 0、decodeInbound
 * 不传 selectedCapabilities（UPDATE_CHUNK 入站 → decode 门控 UNSUPPORTED_MESSAGE_TYPE
 * connection fatal 1002）、UPDATE_CHUNK dispatch 为防御性 connectionFatal 占位、
 * UpdateChannel 对 > maxUpdateBytes 项仍 v1 丢弃 + needs-resync。
 *
 * 协商上下文的建立（NC0 自证）：ws-replication 尚无「开启协商」的配置旋钮（归属 SA1
 * D2 决策），本文件以**测试侧 transport 代理**在 wire 层改写 HELLO.optionalCapabilities
 * 与 HELLO_ACK.selectedCapabilities（使位 0x00000001），使双端在 wire 上处于「已协商」
 * 状态——代理只改写握手帧，其余字节原样透传（encode/decode canonical roundtrip 逐字节
 * 稳定，切片 1 冻结性质）。由此红灯失败可归因于「分块机制缺失」而非「未协商」；
 * 实现轮（slice 2）若按 ADR 0013 语义以 wire 协商位为发送/解码门控，本文件在 SA3
 * 落地后即转绿，与未来配置旋钮形状解耦（同时 AC6 的未协商默认不变量由 NC2 守护）。
 *
 * 测试 → 验收标准映射（Host 简报 AC1–AC8）：
 *   P1（红灯）← AC2/AC8：chunk 帧流形状（每帧 ≤ maxUpdateBytes、transferId/chunkCount/
 *     totalBytes 跨帧一致、chunkIndex 从 0 严格递增、Σbytes == totalBytes）；
 *   P2（红灯）← AC1/AC5/AC3：live 全程零 SYNC round、零 resync、hub 收敛、
 *     恰一次 dirty（hub saveDoc 计数 +1）、单 UPDATE_ACK（ackedSequence = 末 chunk 帧序）；
 *   P3（红灯）← AC1/AC3/AC8 接收端：协商连接上合法完整单 chunk transfer 注入 →
 *     hub 恰一次 apply（零 SYNC、Y.Doc 收敛、连接保持 ready、单 UPDATE_ACK）；
 *   NC0（绿）协商上下文自证（wire HELLO/HELLO_ACK 携带 capability bit）；
 *   NC1（绿）限内 update 在协商连接上仍单 UPDATE + 单 ACK（分块不得为限内开启）；
 *   NC2（绿，AC6 守护）未协商超限 write 保持 v1 逐字节行为（零 UPDATE_CHUNK、resync
 *     ×1、SYNC_STEP2 恢复）——与 R1/R2/R3 刻画（issue-233 repro 文件，冻结不改）一致。
 *
 * HEAD c20aeb0 实测分布（两次复跑一致）：P1/P2/P3 红（3 failed），NC0/NC1/NC2 绿
 * （3 passed）——红灯失败点 = 缺口断言（零 chunk 帧 / v1 resync 回退 / decode 门控
 * 1002 收口），NC0 排除「未协商」假红归因。
 *
 * 纪律与既有套件一致：真实 yjs / Registry / Runtime；fake-duplex 内存双端；fake
 * scheduler；零 real sleep；零源码 grep 断言；无 skip/only/todo；无 env override。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type {
  DuplexTransport,
  HubReplication,
  PeerReplication,
  ReplicationLimits,
  ReplicationObserver,
  ReplicationObserverEvent,
  ReplicationTimeouts,
} from '@nomicore/ws-replication';
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

const CHUNK_SCHEMA = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'issue243-chunked-ac',
  text: 'type ROOT = { n: number; blurb: string; };\n',
});

/** R1 同款极限构型：maxUpdateBytes=8KiB，大写 20KB（超限）→ 目标分块 ≈3 帧。 */
const LIMITS: Readonly<Partial<ReplicationLimits>> = {
  maxUpdateBytes: 8 * 1024,
  maxQueuedUpdateCount: 100,
  maxQueuedUpdateBytes: 1 * 1024 * 1024,
  maxInFlightUpdates: 8,
};

const TIMEOUTS: Readonly<Partial<ReplicationTimeouts>> = {
  ackTimeoutMs: 60_000,
};

const BIG = 'z'.repeat(20_000); // 编码后 ≈20,029B > maxUpdateBytes 8KiB

type ChunkMsg = Extract<DecodedMessage['message'], { kind: 'UPDATE_CHUNK' }>;
type AckMsg = Extract<DecodedMessage['message'], { kind: 'UPDATE_ACK' }>;
type ResyncEvent = Extract<ReplicationObserverEvent, { type: 'resync-required' }>;

/** 事件收集器（peer/hub observer；事件天然有序）。 */
function makeCollector(): { events: ReplicationObserverEvent[]; observer: ReplicationObserver } {
  const events: ReplicationObserverEvent[] = [];
  return {
    events,
    observer: (event: ReplicationObserverEvent): void => {
      events.push(event);
    },
  };
}

/** 带协商的 decode：观察面允许解码 UPDATE_CHUNK（wire 已协商上下文；其余帧同选项亦合法）。 */
function decodeWire(bytes: Uint8Array): DecodedMessage {
  return decodeMessage(bytes, { selectedCapabilities: CAP_CHUNKED_UPDATE });
}

// ═══════════════════════════ 测试侧 wire 协商代理（transport seam，非协议实现） ═══════════════════════════

/** 握手帧改写：HELLO.optionalCapabilities / HELLO_ACK.selectedCapabilities 置位
 *  CAP_CHUNKED_UPDATE；其余帧逐字节透传（canonical roundtrip 稳定性 = 切片 1 冻结性质）。 */
function rewriteChunkCapability(bytes: Uint8Array): Uint8Array {
  const decoded = decodeWire(bytes);
  const message = decoded.message;
  if (message.kind === 'HELLO' && (message.optionalCapabilities & CAP_CHUNKED_UPDATE) === 0) {
    return encodeMessage(
      { ...message, optionalCapabilities: message.optionalCapabilities | CAP_CHUNKED_UPDATE },
      { sequence: decoded.header.sequence },
    );
  }
  if (message.kind === 'HELLO_ACK' && (message.selectedCapabilities & CAP_CHUNKED_UPDATE) === 0) {
    return encodeMessage(
      { ...message, selectedCapabilities: message.selectedCapabilities | CAP_CHUNKED_UPDATE },
      { sequence: decoded.header.sequence },
    );
  }
  return bytes;
}

/** 包一层 transport：send 侧握手改写后转发；其余接口原样委托（代理不丢帧、不改序）。 */
function withNegotiationProxy(end: DuplexTransport): DuplexTransport {
  return {
    send(bytes) {
      end.send(rewriteChunkCapability(bytes));
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
  };
}

// ═══════════════════════════ 本地组装（与 issue137-driver.bootMulti 同构，单 ns） ═══════════════════════════

interface ChunkedContext {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly nsId: string;
  readonly peerEvents: ReturnType<typeof makeCollector>['events'];
  readonly hubEvents: ReturnType<typeof makeCollector>['events'];
  getWire(): Wire;
  /** 业务写（与 bootMulti.peerWrite 同构：独立 business lease；写完成 = 本地 sequencer 已执行）。 */
  peerWrite(value: Readonly<{ n?: number; blurb?: string }>): Promise<void>;
  /** 方向帧（按到达序，capability-aware decode；nsId 过滤可选）。 */
  frames(dir: 'peerToHub' | 'hubToPeer', nsId?: string): DecodedMessage[];
  /** 该 ns 的 UPDATE_CHUNK 帧（出向数据 = peerToHub 捕获序）。 */
  chunks(dir: 'peerToHub' | 'hubToPeer'): ChunkMsg[];
  rootValue(side: 'hub' | 'peer', key: 'blurb' | 'n'): unknown;
  hubSaveCount(docId: string): number;
}

async function bootChunked(opts: {
  negotiate: boolean;
  timeouts?: Readonly<Partial<ReplicationTimeouts>>;
}): Promise<ChunkedContext> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const lease = okLease(
    await hubNode.registry.create({
      owner: HUB_OWNER,
      schema: CHUNK_SCHEMA,
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
      const hubEnd = opts.negotiate ? withNegotiationProxy(wire.hubEnd) : wire.hubEnd;
      const peerEnd = opts.negotiate ? withNegotiationProxy(wire.peerEnd) : wire.peerEnd;
      activeWire = wire;
      void hub.accept(hubEnd, { token: TEST_TOKEN });
      return peerEnd;
    },
    timer: peerNode.scheduler,
    targets: [{ namespaceId: nsId, localOwner: PEER_OWNER }],
    limits: LIMITS,
    timeouts: opts.timeouts ?? TIMEOUTS,
    observer: peerEvents.observer,
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
  };
}

// ═══════════════════════════ 观测辅助 ═══════════════════════════

function syncRoundFrames(ctx: ChunkedContext): DecodedMessage[] {
  return [...ctx.frames('peerToHub'), ...ctx.frames('hubToPeer')].filter((f) =>
    ['SYNC_STEP1', 'SYNC_STEP2', 'SYNC_APPLIED'].includes(f.message.kind),
  );
}

function ackFrames(ctx: ChunkedContext, nsId: string): AckMsg[] {
  return ctx
    .frames('hubToPeer', nsId)
    .filter((f): f is { header: DecodedMessage['header']; message: AckMsg } => f.message.kind === 'UPDATE_ACK')
    .map((f) => f.message);
}

/** 红灯失败信息：当前可观测 v1 回退全貌（供红灯日志直接作为证据）。 */
function fallbackSummary(ctx: ChunkedContext, label: string): string {
  const p2h = ctx.frames('peerToHub').map((f) => f.message.kind);
  const h2p = ctx.frames('hubToPeer').map((f) => f.message.kind);
  return [
    label,
    `peer ns state=${String(ctx.peer.getNamespaceState(ctx.nsId))} conn=${ctx.peer.getConnectionState()}`,
    `peer→hub kinds: ${p2h.join(',')}`,
    `hub→peer kinds: ${h2p.join(',')}`,
    `hub blurb=${String(ctx.rootValue('hub', 'blurb')).slice(0, 24)}…`,
  ].join('\n');
}

// ═══════════════════════════ 契约测试 ═══════════════════════════

describe('issue #243 切片 2：协商 CAP_CHUNKED_UPDATE 超限 UPDATE live 分块传输（红灯契约）', () => {
  it('绿负控 NC0：wire 协商代理生效——HELLO.optional / HELLO_ACK.selected 携带 CAP_CHUNKED_UPDATE（红灯场景的协商上下文自证，fixture 正确性哨兵）', async () => {
    const ctx = await bootChunked({ negotiate: true });
    try {
      const wire = ctx.getWire();
      const hello = decodeWire(wire.peerToHub[0]!);
      expect(hello.message.kind).toBe('HELLO');
      const helloMsg = hello.message as Extract<DecodedMessage['message'], { kind: 'HELLO' }>;
      expect(helloMsg.optionalCapabilities & CAP_CHUNKED_UPDATE, 'HELLO 必须已置位 CAP_CHUNKED_UPDATE').not.toBe(0);

      const helloAck = wire.hubToPeer.map((b) => decodeWire(b)).find((f) => f.message.kind === 'HELLO_ACK');
      expect(helloAck, '必须有 HELLO_ACK').toBeDefined();
      const ackMsg = (helloAck!.message as Extract<DecodedMessage['message'], { kind: 'HELLO_ACK' }>);
      expect(ackMsg.selectedCapabilities & CAP_CHUNKED_UPDATE, 'HELLO_ACK 必须已置位 CAP_CHUNKED_UPDATE').not.toBe(0);

      // 协商完成且连接健康（无任何 resync / chunk 帧污染基线）
      expect(ctx.peer.getConnectionState()).toBe('ready');
      expect(ctx.peer.getNamespaceState(ctx.nsId)).toBe('live');
      expect(ctx.frames('peerToHub').filter((f) => f.message.kind === 'UPDATE_CHUNK')).toHaveLength(0);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('红灯 P1（AC2/AC8）：协商连接上超限 update 必须以 ≤maxUpdateBytes 的 UPDATE_CHUNK 帧出站——transferId/chunkCount/totalBytes 跨帧一致、chunkIndex 从 0 严格递增、Σbytes==totalBytes', async () => {
    const ctx = await bootChunked({ negotiate: true });
    try {
      await ctx.peerWrite({ blurb: BIG });
      await settle(); // 帧序确定性排空（当前实现：v1 丢弃 + resync 恢复，wire 可见）

      const chunks = ctx.chunks('peerToHub');
      const maxUpdateBytes = LIMITS.maxUpdateBytes!;
      const maxFrameBytes = 8 * 1024 * 1024; // DEFAULT_REPLICATION_LIMITS.maxFrameBytes

      expect(
        chunks.length,
        `超限 update 必须以分块帧出站（当前 ${chunks.length} 帧）：\n${fallbackSummary(ctx, 'P1')}`,
      ).toBeGreaterThanOrEqual(2);

      // AC2：每个 wire frame ≤ maxUpdateBytes（chunk 载荷）与 maxFrameBytes（帧全长，既有上限）
      const chunkFrames = ctx
        .getWire()
        .peerToHub.map((bytes) => ({ bytes, decoded: decodeWire(bytes) }))
        .filter((f) => f.decoded.message.kind === 'UPDATE_CHUNK');
      for (const [index, entry] of chunkFrames.entries()) {
        const chunk = entry.decoded.message as ChunkMsg;
        expect(chunk.bytes.byteLength, `chunk[${index}] 载荷必须 ≤ maxUpdateBytes`).toBeLessThanOrEqual(maxUpdateBytes);
        expect(entry.bytes.byteLength, `chunk[${index}] 帧全长必须 ≤ maxFrameBytes`).toBeLessThanOrEqual(maxFrameBytes);
      }

      // AC8：transferId 唯一且跨帧一致、chunkCount/totalBytes 跨帧一致、chunkIndex 严格递增
      const transferIds = new Set(chunks.map((c) => c.transferId));
      expect(transferIds.size, '整笔 transfer 的 transferId 必须跨 chunk 一致').toBe(1);
      expect(chunks[0]!.transferId).toBeGreaterThanOrEqual(1);
      const chunkCounts = new Set(chunks.map((c) => c.chunkCount));
      expect(chunkCounts.size, 'chunkCount 必须跨 chunk 一致').toBe(1);
      const totalBytesSet = new Set(chunks.map((c) => c.totalBytes));
      expect(totalBytesSet.size, 'totalBytes 必须跨 chunk 一致').toBe(1);
      const declaredCount = chunks[0]!.chunkCount;
      expect(chunks.length).toBe(declaredCount);
      for (const [index, chunk] of chunks.entries()) {
        expect(chunk.chunkIndex, `chunkIndex 必须严格递增（第 ${index} 帧）`).toBe(index);
      }
      const totalBytes = chunks[0]!.totalBytes;
      expect(totalBytes, 'totalBytes 必须 > maxUpdateBytes（超限前提）').toBeGreaterThan(maxUpdateBytes);
      expect(chunks.reduce((sum, c) => sum + c.bytes.byteLength, 0), 'Σbytes 必须 == totalBytes').toBe(totalBytes);
      expect(chunks.reduce((sum, c) => sum + c.bytes.byteLength, 0), 'Σbytes 必须 > maxUpdateBytes（确实超限）').toBeGreaterThan(maxUpdateBytes);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('红灯 P2（AC1/AC5/AC3）：协商连接上超限 update 全程 live 传输——零 SYNC round、零 resync、hub 收敛、hub 恰一次 dirty、单 UPDATE_ACK（ackedSequence=末 chunk 帧序）', async () => {
    const ctx = await bootChunked({ negotiate: true });
    try {
      // 新建连接必经一次初始 sync round（OPEN→bootstrap→reconcile→live）——该 boot
      // round 帧不是被测传输的产物；AC1「零 SYNC round」的断言面 = 写后零新增。
      // （实现轮修正注：原断言对全程帧计数，含 boot round 6 帧——绿灯不可达；修正为
      // 增量口径，语义与断言消息「超限 update 不得触发任何 SYNC round」逐字一致。）
      const syncBaseline = syncRoundFrames(ctx).length;
      const savesBefore = ctx.hubSaveCount(ctx.nsId);
      await ctx.peerWrite({ blurb: BIG });
      // 等待 hub 数据收敛 + 单 UPDATE_ACK 到达（实现轮修正注：收敛谓词在 apply 完成
      // 的微任务序之前即可为真——ACK 在 apply 续体发出；同文件 NC1 既有 settle 惯例，
      // 此处并入谓词使帧级断言面确定性排空）
      await settleUntil(
        () =>
          ctx.rootValue('hub', 'blurb') === BIG &&
          ackFrames(ctx, ctx.nsId).length === 1,
        'hub 数据收敛且单 ACK 到达',
      );
      expect(ctx.rootValue('peer', 'blurb')).toBe(BIG);

      // AC1：全程零 resync 声明（namespace 状态机不得离开 live）
      const resyncs = ctx.peerEvents.filter((e): e is ResyncEvent => e.type === 'resync-required');
      expect(
        resyncs.length,
        `超限 update 必须以 live 分块传输，零 SYNC/resync（当前 resync=${resyncs.length}）：\n${fallbackSummary(ctx, 'P2')}`,
      ).toBe(0);

      // AC1：零 SYNC round（两方向均不得出现 SYNC_STEP1/2/APPLIED——增量口径）
      const syncs = syncRoundFrames(ctx);
      expect(
        syncs.length - syncBaseline,
        `零新增 SYNC round（当前新增 ${syncs.length - syncBaseline} 帧 SYNC_*）：\n${fallbackSummary(ctx, 'P2')}`,
      ).toBe(0);

      // AC3：hub 侧恰一次 apply → 恰一次 dirty notification（saveDoc 计数 +1）
      const savesAfter = ctx.hubSaveCount(ctx.nsId);
      expect(savesAfter - savesBefore, '整笔 transfer 恰一次 apply → hub dirty 恰一次').toBe(1);

      // AC5：单 UPDATE_ACK，ackedSequence = 末 chunk 帧序（ACK 结算锚）
      const chunks = ctx.chunks('peerToHub');
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      const lastChunkSeq = ctx
        .frames('peerToHub')
        .filter((f) => f.message.kind === 'UPDATE_CHUNK')
        .at(-1)!.header.sequence;
      const acks = ackFrames(ctx, ctx.nsId);
      expect(acks.length, `整笔 transfer 恰一次 UPDATE_ACK（当前 ${acks.length}）`).toBe(1);
      expect(acks[0]!.ackedSequence, 'UPDATE_ACK.ackedSequence 必须 = 末 chunk 帧序').toBe(lastChunkSeq);

      // 收尾状态：peer live + connection ready（未被错误收口）
      expect(ctx.peer.getNamespaceState(ctx.nsId)).toBe('live');
      expect(ctx.peer.getConnectionState()).toBe('ready');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('红灯 P3（AC3/AC8 接收端）：协商连接上合法完整单 chunk transfer 注入 → hub 恰一次 apply（零 SYNC、零失败收口）、Y.Doc 收敛、单 UPDATE_ACK', async () => {
    const ctx = await bootChunked({ negotiate: true });
    try {
      const wire = ctx.getWire();
      // 生成真实 CRDT 增量（hub 与 peer 当前同态：blurb='seed'）→ 目标值 'via-chunk'
      const base = ctx.peerNode.persistence.peek(PEER_OWNER, ctx.nsId)!;
      const fork = new Y.Doc();
      Y.applyUpdate(fork, Y.encodeStateAsUpdate(base));
      fork.getMap('ROOT').set('blurb', 'via-chunk');
      const delta = Y.encodeStateAsUpdate(fork, Y.encodeStateVector(base));
      expect(delta.byteLength).toBeGreaterThan(0);

      const seq = ctx.frames('peerToHub').reduce((max, f) => Math.max(max, f.header.sequence), 0) + 1;
      const frame = encodeMessage(
        {
          kind: 'UPDATE_CHUNK',
          transferKind: 0, // issue #295：单形态 kind 首字段（live-update 路径）
          namespaceId: ctx.nsId,
          transferId: 1,
          chunkIndex: 0,
          chunkCount: 1,
          totalBytes: delta.byteLength,
          bytes: delta,
        },
        { sequence: seq },
      );
      const savesBefore = ctx.hubSaveCount(ctx.nsId);
      const syncBaseline = syncRoundFrames(ctx).length; // boot round 帧基线（非注入产物）
      wire.peerEnd.send(frame);
      await settle();

      // 目标：接收端 assembly 收齐单 chunk → 恰一次 sequenced apply + dirty → 单 ACK；
      // 当前实现：decode 门控 UNSUPPORTED_MESSAGE_TYPE → connection fatal(1002) 收口，零 apply。
      // 接收端收口判别 = hub 通道/ns 终局与违例帧面（注入 chunk 本身不得使 hub 终局）。
      // （实现轮修正注：原断言 hubSideClosed===false 在该 wire 注入形态下绿灯不可达——
      // 注入帧占用的是真实 peer 连接级序列号空间：hub ACK 该帧后 peer 按既有 ACK
      // 关联纪律（#238/ac5-live：未知 ackedSequence → ACK_STATE_VIOLATION connection
      // fatal）合法收口，其 ERROR 帧重复注入帧序 → hub SEQUENCE_VIOLATION——两级均属
      // 冻结语义且非 slice 2 引入；AC3/AC8 的接收端证据改为 hub 通道面断言（无 ns 终局、
      // 零 UPDATE_TRANSFER_* 违例帧、ACK 先于任何 hub ERROR/close 出站）。）
      expect(
        ctx.hubEvents.filter((e) => e.type === 'namespace-failed'),
        `注入 chunk 不得使 hub ns 终局 failed：\n${fallbackSummary(ctx, 'P3')}`,
      ).toHaveLength(0);
      const hubErrors = ctx
        .frames('hubToPeer', ctx.nsId)
        .filter((f) => f.message.kind === 'ERROR')
        .map((f) => (f.message as Extract<DecodedMessage['message'], { kind: 'ERROR' }>).code);
      expect(
        hubErrors.filter((code) => code === 'UPDATE_TRANSFER_VIOLATION' || code === 'UPDATE_TRANSFER_TOO_LARGE'),
        `注入 chunk 不得触发 UPDATE_TRANSFER_* 违例：\n${fallbackSummary(ctx, 'P3')}`,
      ).toHaveLength(0);
      const hubKinds = ctx.frames('hubToPeer').map((f) => f.message.kind);
      expect(
        hubKinds.indexOf('UPDATE_ACK'),
        'hub UPDATE_ACK 必须先行于任何 hub ERROR/close（注入 chunk 本身零收口）',
      ).toBeGreaterThanOrEqual(0);
      expect(hubKinds.indexOf('UPDATE_ACK')! < (hubKinds.indexOf('ERROR') === -1 ? hubKinds.length : hubKinds.indexOf('ERROR'))).toBe(true);
      expect(
        ctx.rootValue('hub', 'blurb'),
        `hub 必须应用注入 chunk（Y.Doc 收敛到 'via-chunk'）：\n${fallbackSummary(ctx, 'P3')}`,
      ).toBe('via-chunk');
      expect(ctx.hubSaveCount(ctx.nsId) - savesBefore, '恰一次 apply → hub dirty 恰一次').toBe(1);
      const acks = ackFrames(ctx, ctx.nsId);
      expect(acks.length, '单 chunk transfer 必须恰一次 UPDATE_ACK').toBe(1);
      expect(acks[0]!.ackedSequence, 'UPDATE_ACK.ackedSequence 必须 = 注入 chunk 帧序').toBe(seq);
      expect(syncRoundFrames(ctx).length - syncBaseline, '合法 chunk 注入不得触发任何 SYNC round').toBe(0);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('绿负控 NC1：协商连接上限内 update 仍以单 UPDATE 帧 + 单 UPDATE_ACK 传输——分块不得为限内 update 开启', async () => {
    const ctx = await bootChunked({ negotiate: true });
    try {
      await ctx.peerWrite({ blurb: 'small-payload' });
      await settleUntil(
        () =>
          ctx.rootValue('hub', 'blurb') === 'small-payload' && ctx.peer.getNamespaceState(ctx.nsId) === 'live',
        'hub 收敛且 peer 回 live',
      );
      await settle(); // 帧序确定性排空（ACK 帧在收敛谓词之后微任务序到达）

      const updates = ctx.frames('peerToHub', ctx.nsId).filter((f) => f.message.kind === 'UPDATE');
      expect(updates).toHaveLength(1);
      expect((updates[0]!.message as Extract<DecodedMessage['message'], { kind: 'UPDATE' }>).update.byteLength).toBeLessThanOrEqual(LIMITS.maxUpdateBytes!);
      expect(ctx.chunks('peerToHub'), '限内 update 不得分块').toHaveLength(0);
      expect(ctx.peerEvents.filter((e) => e.type === 'resync-required')).toHaveLength(0);
      const acks = ackFrames(ctx, ctx.nsId);
      expect(acks).toHaveLength(1);
      expect(ctx.peer.getNamespaceState(ctx.nsId)).toBe('live');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  it('绿负控 NC2（AC6）：未协商连接上超限 update 保持 v1 逐字节行为——零 UPDATE_CHUNK、resync ×1、hub 经 SYNC_STEP2 恢复收敛', async () => {
    const ctx = await bootChunked({ negotiate: false });
    try {
      await ctx.peerWrite({ blurb: BIG });
      await settleUntil(
        () =>
          ctx.rootValue('hub', 'blurb') === BIG && ctx.peer.getNamespaceState(ctx.nsId) === 'live',
        'v1 恢复 round 后 hub 收敛且 peer 回 live',
      );
      await settle();
      expect(ctx.chunks('peerToHub'), '未协商：零 UPDATE_CHUNK 帧').toHaveLength(0);
      expect(ctx.frames('peerToHub', ctx.nsId).filter((f) => f.message.kind === 'UPDATE'), '未协商：大写不得以 UPDATE 帧承载').toHaveLength(0);
      const resyncs = ctx.peerEvents.filter((e): e is ResyncEvent => e.type === 'resync-required');
      expect(resyncs.length, '未协商：大写恰一次 resync 声明').toBe(1);
      expect(resyncs[0]!.channelState, 'resync 声明投影 channelState = needs-resync').toBe('needs-resync');
      // 恢复依赖完整 state-vector round（控制帧路径 SYNC_STEP2 承载同一载荷）
      const diffs = ctx
        .frames('peerToHub', ctx.nsId)
        .filter((f) => f.message.kind === 'SYNC_STEP2')
        .map((f) => (f.message as Extract<DecodedMessage['message'], { kind: 'SYNC_STEP2' }>).update.byteLength);
      expect(diffs.some((n) => n > LIMITS.maxUpdateBytes!), 'v1 恢复必须以 >maxUpdateBytes 的 SYNC_STEP2 diff 传输同一载荷').toBe(true);
      expect(ctx.peer.getNamespaceState(ctx.nsId)).toBe('live');
      expect(ctx.peer.getConnectionState()).toBe('ready');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });
});

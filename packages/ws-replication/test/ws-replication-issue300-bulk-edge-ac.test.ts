/**
 * issue #300（#295 切片 2）机制探针（契约外）——SA1 设计 §11 的 M2/M3/M5 三条接线锚：
 *
 * - **M2**：resync-declared 边沿 = 在途 kind=2 载体弃置归 idle；边沿后**同 transferId 零新增
 *   chunk 出站**（残渣只剩真正在途帧——本探针把 data 闸门关在第一帧之后，边沿后开闸，
 *   断言该 transferId 不再出现更高 chunkIndex，hub 零写入、peer 非 failed）；
 * - **M3**：窗口空位唤醒——`UpdateChannel.onAck` 在 channel 队列为空但 bulk 载体有待发工作
 *   时仍 `requestDataDrain`（R47 等价：无 bulk 工作时与现状逐字节同义）；
 * - **M5**：bulk chunk 出站被拒（`sendChunk` 返回 ≤0）→ 载体弃置归 idle + 宿主 kind 特定
 *   收口回调恰一次（失败明细先采样）；重复 `pullOne()` 零出站、零自旋。
 *
 * 纪律：真实 harness（M2）/ 真实包内类 + 确定性 fake host（M3/M5）；零 real sleep；
 * 不修改 SA6 契约文件（`ws-replication-issue300-chunked-sync-ac-red.test.ts`）与刻画文件。
 */
import { describe, expect, it } from 'vitest';
import {
  createHubReplication,
  createPeerReplication,
  type DuplexTransport,
  type PeerReplication,
  type ReplicationLimits,
  type ReplicationObserver,
  type ReplicationObserverEvent,
} from '@nomicore/ws-replication';
import { CAP_CHUNKED_UPDATE, decodeMessage, encodeMessage } from '@nomicore/replication-protocol';
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
import { UpdateChannel, type UpdateChannelHost } from '../src/update-channel.js';
import { BulkTransferSender, type BulkTransferHost } from '../src/bulk-transfer.js';
import { resolveLimits } from '../src/defaults.js';
import type { ChunkedTransferPiece } from '../src/update-transfer.js';
import type { UpdateSendFailureDetail } from '../src/types.js';

// ═══════════════════════════ M3：窗口空位唤醒（UpdateChannel.onAck） ═══════════════════════════

interface ChannelLog {
  readonly drainRequests: number[];
  readonly chunks: ChunkedTransferPiece[];
}

function makeChannelHarness(
  bulkWork: () => boolean,
  overrides: Readonly<Partial<ReplicationLimits>> = {},
): {
  channel: UpdateChannel;
  log: ChannelLog;
  limits: ReturnType<typeof resolveLimits>;
} {
  const limits = resolveLimits({
    maxUpdateBytes: 1024,
    maxChunkedUpdateBytes: 8192,
    maxInFlightUpdates: 4,
    maxQueuedUpdateCount: 100,
    maxQueuedUpdateBytes: 1024 * 1024,
    ...overrides,
  });
  let seq = 0;
  const log: ChannelLog = { drainRequests: [], chunks: [] };
  const host: UpdateChannelHost = {
    limits,
    ackTimeoutMs: 60_000,
    sendUpdateFrame: () => {
      seq += 1;
      return seq;
    },
    sendUpdateChunkFrame: (chunk) => {
      seq += 1;
      log.chunks.push(chunk);
      return seq;
    },
    chunkedSendEnabled: () => true,
    declareLocalResync: () => undefined,
    noteUpdateDropped: () => undefined,
    notePendingResync: () => undefined,
    onAckTimeout: () => undefined,
    onUpdateAcked: () => undefined,
    noteUpdateSent: () => undefined,
    armTimer: () => ({}),
    clearTimer: () => undefined,
    dataGateOpen: () => true,
    onDataQueued: () => undefined,
    requestDataDrain: () => {
      log.drainRequests.push(1);
    },
    hasBulkTransferWork: bulkWork,
  };
  return { channel: new UpdateChannel(host), log, limits };
}

describe('issue #300 M3：窗口空位唤醒路径（onAck ∧ bulk 待发工作）', () => {
  it('M3-a：channel 队列为空 ∧ bulk 有工作 → 每个 ACK 仍请求 drain（窗口满时 kind=2 不被饿死）', () => {
    const { channel, log } = makeChannelHarness(() => true);
    // 构造一个裸 in-flight 条目（普通 UPDATE 帧）——窗口 = 4，占 1 槽
    channel.deliver(new Uint8Array([1, 2, 3]), 'live');
    expect(channel.inFlightCount).toBe(1);
    const before = log.drainRequests.length;
    // ACK 释放槽位：channel 队列为空（无 kind=0 待发）但 bulk 载体在场 → 必须请求 drain
    expect(channel.onAck(1)).toBe('ok');
    expect(log.drainRequests.length, 'M3：无 channel 队列也须唤醒 bulk').toBe(before + 1);
  });

  it('M3-b（R47 等价）：无 bulk 工作时 onAck 与现状逐字节同义——空 channel 队列零 drain、非空队列照旧 drain', () => {
    // b1：队列为空（唯一在途帧被 ACK）→ 零 drain 请求（现状语义）
    const empty = makeChannelHarness(() => false);
    empty.channel.deliver(new Uint8Array([1, 2, 3]), 'live'); // 窗口空位 → 直发（seq=1）
    expect(empty.channel.inFlightCount).toBe(1);
    expect(empty.channel.onAck(1)).toBe('ok');
    expect(empty.log.drainRequests, '无 bulk 工作 ∧ 队列空 → 零 drain（逐字节同义）').toHaveLength(0);

    // b2：队列非空（窗口占满时到达的第二笔）→ ACK 释放后照旧请求 drain（既有行为不变）
    const queued = makeChannelHarness(() => false, { maxInFlightUpdates: 1 });
    queued.channel.deliver(new Uint8Array([1, 2, 3]), 'live'); // seq=1 直发，窗口占满
    queued.channel.deliver(new Uint8Array([4, 5, 6]), 'live'); // 窗口满 → 入队
    expect(queued.channel.queuedCount).toBe(1);
    expect(queued.channel.onAck(1)).toBe('ok');
    expect(queued.log.drainRequests.length, '无 bulk 工作 ∧ 队列非空 → 既有 drain 请求不变').toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════ M5：出站被拒（BulkTransferSender） ═══════════════════════════

interface BulkHostLog {
  readonly sent: ChunkedTransferPiece[];
  readonly rejected: UpdateSendFailureDetail[];
  ackTimeouts: number;
  armed: number;
  cleared: number;
}

function makeBulkHost(opts: {
  rejectFrom?: number;
  gateOpen?: () => boolean;
}): { sender: BulkTransferSender; log: BulkHostLog; setRejectFrom(index: number | undefined): void } {
  let rejectFrom = opts.rejectFrom;
  let nextSeq = 0;
  let nextId = 1;
  const log: BulkHostLog = { sent: [], rejected: [], ackTimeouts: 0, armed: 0, cleared: 0 };
  const host: BulkTransferHost = {
    maxUpdateBytes: 1024,
    ackTimeoutMs: 60_000,
    allocateTransferId: () => {
      const id = nextId;
      nextId += 1;
      return id;
    },
    transferIdAvailable: () => true,
    windowHasRoom: () => true,
    sendChunk: (chunk) => {
      log.sent.push(chunk);
      if (rejectFrom !== undefined && log.sent.length > rejectFrom) return 0;
      nextSeq += 1;
      return nextSeq;
    },
    dataGateOpen: opts.gateOpen ?? (() => true),
    armTimer: () => {
      log.armed += 1;
      return {};
    },
    clearTimer: () => {
      log.cleared += 1;
    },
  };
  return {
    sender: new BulkTransferSender(host),
    log,
    setRejectFrom: (index) => {
      rejectFrom = index;
    },
  };
}

describe('issue #300 M5：kind=2 chunk 出站被拒（sendChunk ≤ 0）的确定性收口', () => {
  it('M5-a：首 chunk 被拒 → 失败明细先采样（reason=send-frame-rejected + totalBytes）+ 载体弃置归 idle + 收口回调恰一次', () => {
    const harness = makeBulkHost({ rejectFrom: 0 });
    let lastSeq: number | undefined;
    let aborts = 0;
    harness.sender.enqueue({
      kind: 2,
      payload: new Uint8Array(3000),
      binding: { syncRoundId: 7 },
      onLastChunkSent: (seq) => {
        lastSeq = seq;
      },
      onSendRejected: (detail) => {
        aborts += 1;
        harness.log.rejected.push(detail());
      },
      onAckTimeout: () => undefined,
    });
    expect(harness.sender.pullOne(), '被拒也是进展（消费即进展）').toBe(true);
    expect(aborts, 'kind=2 收口回调恰一次').toBe(1);
    expect(harness.log.rejected).toEqual([
      {
        reason: 'send-frame-rejected',
        updateBytes: 3000,
        maxUpdateBytes: 1024,
        queuedUpdateCount: 1,
        queuedUpdateBytes: 3000,
        inFlightCount: 0,
      },
    ]);
    expect(lastSeq, '零 ACK 锚（无末 chunk 出站）').toBeUndefined();
    expect(harness.sender.hasWork(), '载体弃置归 idle').toBe(false);
    expect(harness.sender.pullOne(), '归 idle 后零出站（零自旋）').toBe(false);
    expect(harness.log.sent).toHaveLength(1);
  });

  it('M5-b：中间 chunk 被拒 → 同款收口（已出站帧留在 wire，载体/后续帧零出站）', () => {
    const harness = makeBulkHost({ rejectFrom: 1 });
    let aborts = 0;
    harness.sender.enqueue({
      kind: 1,
      payload: new Uint8Array(3000),
      binding: { replicationId: 'r-1', replicationEpoch: 2 },
      onLastChunkSent: () => undefined,
      onSendRejected: (detail) => {
        aborts += 1;
        void detail;
      },
      onAckTimeout: () => undefined,
    });
    expect(harness.sender.pullOne()).toBe(true); // chunk 0 出站
    expect(harness.sender.pullOne()).toBe(true); // chunk 1 被拒 → 弃置
    expect(aborts).toBe(1);
    expect(harness.sender.hasWork()).toBe(false);
    expect(harness.log.sent).toHaveLength(2);
    expect(harness.sender.pullOne()).toBe(false);
  });
});

// ═══════════════════════════ M1/M2：真实 harness（observer 在场） ═══════════════════════════

const SCHEMA = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'issue300-bulk-edge',
  text: 'type ROOT = { n: number; blurb: string; };\n',
});

const PAUSE_HIGH = 600 * 1024;

/** 恢复 round 构型基线（kind=0 不可分块 ⇒ 恢复 diff 超 maxSyncDiffBytes ⇒ kind=2）。 */
const EDGE_LIMITS: Readonly<Partial<ReplicationLimits>> = Object.freeze({
  maxUpdateBytes: 8 * 1024,
  maxInFlightUpdates: 8,
  maxQueuedUpdateCount: 100,
  maxQueuedUpdateBytes: 1024 * 1024,
  maxBootstrapBytes: 64 * 1024,
  maxChunkedUpdateBytes: 4 * 1024,
  maxSyncDiffBytes: 32 * 1024,
  maxChunkedSyncDiffBytes: 512 * 1024,
});

interface Kind2Chunk {
  readonly transferId: number;
  readonly chunkIndex: number;
  readonly sequence: number;
}

interface EdgeCtx {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly peer: PeerReplication;
  readonly nsId: string;
  readonly wire: Wire;
  readonly peerEvents: ReplicationObserverEvent[];
  readonly hubEvents: ReplicationObserverEvent[];
  kind2Chunks(): Kind2Chunk[];
  hubRoot(key: string): unknown;
  hubSaveCount(): number;
  releasePeerData(): void;
  armPeerDataPause(): void;
  advance(ms: number): Promise<void>;
  stop(): Promise<void>;
}

/** 本地 boot（真实 yjs/Registry/Runtime + fake duplex；observer 在场）：
 *  hub 初始文档 `seed`；peer 以 `chunkedUpdate: true` 协商；可选 peer 侧 data 闸门代理
 *  （armPeerDataPause：首帧 kind=2 chunk 出站后进入水位暂停；releasePeerData 归零恢复）。 */
async function bootIssue300(opts: {
  initialBlurb?: string;
  /** 需要「首帧后暂停」构型时置 true（M2）。 */
  pausablePeerData?: boolean;
}): Promise<EdgeCtx> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const lease = okLease(
    await hubNode.registry.create({
      owner: HUB_OWNER,
      schema: { ...SCHEMA },
      root: { n: 1, blurb: opts.initialBlurb ?? 'seed' },
    }),
  );
  await schemaReady(lease);
  const enabled = await lease.enableReplication();
  if (!enabled.ok) throw new Error(`enableReplication 失败：${JSON.stringify(enabled)}`);
  const nsId = lease.namespaceId;
  const wire = makeWire();

  let level = 0;
  let pauseArmed = false;
  const peerEnd: DuplexTransport =
    opts.pausablePeerData === true
      ? {
          send(bytes) {
            wire.peerEnd.send(bytes);
            if (pauseArmed) {
              const decoded = decodeMessage(bytes, { selectedCapabilities: CAP_CHUNKED_UPDATE });
              if (decoded.message.kind === 'UPDATE_CHUNK' && decoded.message.transferKind === 2) {
                pauseArmed = false;
                level = PAUSE_HIGH; // 首帧之后立即 > highWater → data 路径暂停
              }
            }
          },
          close(code, reason) {
            wire.peerEnd.close(code, reason);
          },
          get closed() {
            return wire.peerEnd.closed;
          },
          onMessage(listener) {
            return wire.peerEnd.onMessage(listener);
          },
          onClose(listener) {
            return wire.peerEnd.onClose(listener);
          },
          get bufferedAmount() {
            return level;
          },
        }
      : wire.peerEnd;

  const peerEvents: ReplicationObserverEvent[] = [];
  const hubEvents: ReplicationObserverEvent[] = [];
  const peerObserver: ReplicationObserver = (event) => {
    peerEvents.push(event);
  };
  const hubObserver: ReplicationObserver = (event) => {
    hubEvents.push(event);
  };
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
    limits: EDGE_LIMITS,
    timeouts: { ackTimeoutMs: 60_000 },
    observer: hubObserver,
  });
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
    limits: EDGE_LIMITS,
    timeouts: { ackTimeoutMs: 60_000 },
    chunkedUpdate: true,
    observer: peerObserver,
  });
  peer.start();
  await settleUntil(() => peer.getConnectionState() === 'ready', '连接 ready');
  await settleUntil(() => peer.getNamespaceState(nsId) === 'live', 'peer live');

  const hubDoc = (): { getMap(name: string): Map<string, unknown> } | undefined =>
    hubNode.persistence.peek(HUB_OWNER, nsId) as { getMap(name: string): Map<string, unknown> } | undefined;

  return {
    hubNode,
    peerNode,
    peer,
    nsId,
    wire,
    peerEvents,
    hubEvents,
    kind2Chunks: () =>
      wire.peerToHub
        .map((bytes, index) => {
          const decoded = decodeMessage(bytes, { selectedCapabilities: CAP_CHUNKED_UPDATE });
          return decoded.message.kind === 'UPDATE_CHUNK' && decoded.message.transferKind === 2
            ? {
                transferId: decoded.message.transferId,
                chunkIndex: decoded.message.chunkIndex,
                sequence: index,
              }
            : undefined;
        })
        .filter((entry): entry is Kind2Chunk => entry !== undefined),
    hubRoot: (key) => hubDoc()?.getMap('ROOT').get(key),
    hubSaveCount: () => hubNode.persistence.saveEvents.filter((e) => e.docId === nsId).length,
    releasePeerData: () => {
      level = 0;
    },
    armPeerDataPause: () => {
      pauseArmed = true;
    },
    advance: async (ms) => {
      await peerNode.scheduler.advanceBy(ms);
      await hubNode.scheduler.advanceBy(ms);
      await settle();
    },
    stop: async () => {
      await peer.stop().catch(() => undefined);
    },
  };
}

/** 本地 100KB 写（peer 侧；> maxChunkedUpdateBytes 4KiB ⇒ 不可分块 → 恢复 round 的 diff 超限）。 */
async function peerWriteBig(ctx: EdgeCtx, value: string): Promise<void> {
  const business = okLease(await ctx.peerNode.registry.open(PEER_OWNER, ctx.nsId));
  await schemaReady(business);
  const result = await business.mutateData({ op: 'set', path: ['blurb'], value });
  if (!result.ok) throw new Error(`业务写失败：${JSON.stringify(result)}`);
  await business.release();
}

describe('issue #300 M1：kind=2 分块完成点零普通族 sync-diff-applied（§23.3 第 33 型改道语义）', () => {
  it('M1：peer→hub 分块 diff 完成点 hub 侧零 sync-diff-applied；同 round 的单帧 Step2 路径照常发射（对照锚）', async () => {
    const ctx = await bootIssue300({});
    try {
      await peerWriteBig(ctx, 'q'.repeat(100_000));
      await settleUntil(
        () => ctx.hubRoot('blurb') === 'q'.repeat(100_000),
        'kind=2 分块恢复 diff 收敛',
      );
      await settleUntil(() => ctx.kind2Chunks().length >= 2, 'kind=2 chunk 序列上 wire');
      await settle();

      // 恢复 round 归属：最后一个 SYNC_STEP1 的 roundId（chunked Step2 与本 round 的单帧
      // Step2 对照都在该 round 内）
      const step1Rounds = ctx.wire.peerToHub
        .map((bytes) => decodeMessage(bytes, { selectedCapabilities: CAP_CHUNKED_UPDATE }).message)
        .filter((message) => message.kind === 'SYNC_STEP1')
        .map((message) => message.syncRoundId);
      const recoveryRoundId = step1Rounds[step1Rounds.length - 1]!;
      expect(
        ctx.hubEvents.filter(
          (e) => e.type === 'sync-diff-applied' && e.syncRoundId === recoveryRoundId,
        ),
        'M1：kind=2 分块完成点零普通族 sync-diff-applied（窗口内归零）',
      ).toHaveLength(0);
      expect(
        ctx.hubEvents.filter(
          (e) => e.type === 'sync-step2-sent' && e.syncRoundId === recoveryRoundId,
        ).length,
        '对照锚：同一 round 内 hub 侧单帧 Step2 照常发射 sync-step2-sent（观察者链路在场）',
      ).toBeGreaterThanOrEqual(1);
      expect(
        ctx.peerEvents.filter((e) => e.type === 'sync-diff-applied').length,
        '对照锚：同 round 的单帧 Step2 路径（hub→peer）照常发射 sync-diff-applied',
      ).toBeGreaterThanOrEqual(1);
      expect(ctx.hubRoot('blurb'), '收敛（一次 apply 的最终效应）').toBe('q'.repeat(100_000));
    } finally {
      await ctx.stop();
    }
  }, 30_000);
});

describe('issue #300 M2：resync-declared 边沿弃置在途 kind=2 载体（同 transferId 零新增 chunk）', () => {
  it('M2：首帧后闸门关闭 → 注入对端 RESYNC_REQUIRED → 载体弃置；开闸后同 transferId 零更高 chunkIndex、hub 零写入、peer 非 failed', async () => {
    const ctx = await bootIssue300({ pausablePeerData: true });
    try {
      const savesBefore = ctx.hubSaveCount();
      ctx.armPeerDataPause();
      await peerWriteBig(ctx, 'q'.repeat(100_000));
      await settle();
      await settleUntil(() => ctx.kind2Chunks().length >= 1, 'kind=2 首帧出站');
      await settle();

      const beforeEdge = ctx.kind2Chunks();
      expect(beforeEdge, '边沿前恰一帧在途（闸门已关）').toHaveLength(1);
      const abortedTransferId = beforeEdge[0]!.transferId;

      // 注入对端 RESYNC_REQUIRED（本端 wire 声明边的对端化形态）：载体必须弃置归 idle
      const hubSeqBase = ctx.wire.hubToPeer.reduce(
        (max, bytes) =>
          Math.max(
            max,
            decodeMessage(bytes, { selectedCapabilities: CAP_CHUNKED_UPDATE }).header.sequence,
          ),
        0,
      );
      ctx.wire.hubEnd.send(
        encodeMessage(
          { kind: 'RESYNC_REQUIRED', namespaceId: ctx.nsId, reasonCode: 'send-queue-overflow' },
          { sequence: hubSeqBase + 1 },
        ),
      );
      await settle();
      expect(
        ctx.peer.getNamespaceState(ctx.nsId),
        'resync-declared 边沿 → needs-resync（非 failed）',
      ).toBe('needs-resync');
      expect(ctx.kind2Chunks(), '边沿后同 transferId 零新增 chunk（载体已弃置）').toHaveLength(1);

      // 开闸（水位恢复 → poll → resume → drain）：被弃置载体不得再出站任何帧
      ctx.releasePeerData();
      await ctx.advance(1000);
      await settle();
      await settle();
      expect(
        ctx.kind2Chunks().filter((entry) => entry.transferId === abortedTransferId),
        'M2：开闸后同 transferId 仍零更高 chunkIndex',
      ).toHaveLength(1);
      expect(ctx.kind2Chunks()[0]!.chunkIndex).toBe(0);
      expect(ctx.hubRoot('blurb'), '零部分写入（重组失败先于 apply）').toBe('seed');
      expect(ctx.hubSaveCount(), 'hub 零 dirty 登记（违例/弃置先于 apply）').toBe(savesBefore);
      expect(ctx.peer.getConnectionState(), 'ns 级边沿——连接保持 ready').toBe('ready');
      expect(ctx.peer.getNamespaceState(ctx.nsId), 'M2 探针不要求收敛（残渣由既有恢复轨道接管）').not.toBe(
        'failed',
      );
    } finally {
      await ctx.stop();
    }
  }, 30_000);
});

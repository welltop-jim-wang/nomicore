/**
 * SA6 验收契约（红灯）— issue #300（#295 切片 2）：chunked BOOTSTRAP_SNAPSHOT / SYNC_STEP2
 * diff 端到端（R1/R3 收敛绿灯）。
 *
 * 契约来源（规范效力链）：
 * - ADR `docs/adr/0019-chunked-sync-transfer.md`：恒用机制（非协商能力）——超过单帧上限的
 *   snapshot/diff 一律分块（L12）；round/epoch 绑定块（L39–43）；ACK/sender/receiver/记账
 *   逐条平移 ADR 0013（L45–51：一次 sequenced apply / 排他复制导入、control reserve 零
 *   chunk、惰性切片、整笔 1 in-flight 槽、独立 sequence/dataGateOpen/RR）；四新错误码
 *   （L66–70）；R1/R3 刻画文件不动 + 新增收敛绿灯测试（L96–103）。
 * - `docs/protocols/instance-replication-v1.md`（wire 唯一权威）：§8.1 L200–202（kind=1
 *   snapshot 改道 / 首 chunk 校验 / 绑定块核对 / 一次排他复制导入 / BOOTSTRAP_ACK 结算）；
 *   §8.2 L211（ackedSequence = 末 chunk 帧序）；§9.2 L236–238（kind=2 diff 双向改道 /
 *   syncRoundId 绑定 / 一次 apply + SYNC_APPLIED / 不 fallback bootstrap）；§9.3 L246
 *   （SYNC_APPLIED ackedSequence = 末 chunk 帧序）；§10.3 L307–345（单形态字段序、首 chunk
 *   上界+几何校验、后续帧跨帧一致、错误三分类映射、三 kind 共用 transferId 计数器、未协商
 *   pre-parse 拒绝）；§13.2 L445–448/L452（四码注册与分类）；§17 L575–615（kind 无关机制
 *   键、chunk 经 data 路径不占 control 保留额度）；§22 L701（本切片交付传输层 kind=1/2
 *   测试资产）。
 * - SA8 前置门禁 `wiki/raw/task_issue-300_conflict_report.md`（clear，0 hard-conflict）就绪
 *   注意项：
 *   R42（三 kind 共用同一 (连接,方向,namespace) transferId 计数器）→ R2 跨 kind 单调性断言；
 *   R43（解码侧 0x42 协商门不得因 kind 泛化弱化；未协商端不分 kind pre-parse
 *     `UNSUPPORTED_MESSAGE_TYPE` connection fatal）→ 负控 N3；
 *   R44（首 chunk 校验 = 协议全四条：按 kind 聚合上限 ∧ chunkCount ≤ maxChunksPerUpdate ∧
 *     totalBytes ≤ chunkCount × maxUpdateBytes ∧ chunkCount ≥ 1）→ R4/R5 声明/几何族（后两条
 *     几何校验显式覆盖；`chunkCount ≥ 1` 与单帧自洽规则为 codec 级 MALFORMED_FRAME，见报告）；
 *   R45（kind=2 发送端聚合超限分支未逐字冻结——R7 只断言冻结错误族码在 wire 上可观察 +
 *     终局 failed + 零写入，对「发送端预检」与「接收端首 chunk 校验」两种合规落地都成立）；
 *   R47（append-only 冻结面零顺手改：kind=0 逐字节等价）→ 负控 N4。
 *
 * 红灯条件（当前 HEAD 必须失败，失败原因是能力缺失而非环境/fixture/入口）：
 * - R1：超 `maxBootstrapBytes` 的 snapshot 当前以单帧 `BOOTSTRAP_TOO_LARGE` 终局
 *   （hub-namespace `startBootstrap`），peer 永不收敛、wire 零 kind=1 chunk；
 * - R2：超 `maxSyncDiffBytes` 的恢复 diff 当前在发送端编码面以 `SYNC_DIFF_TOO_LARGE` 终局，
 *   wire 零 kind=2 chunk；
 * - R3：data 闸门关闭时当前仍以控制帧（BOOTSTRAP_TOO_LARGE）决定 bootstrap 结局——R1 揭示的
 *   control 路径绕行未消除；
 * - R4/R5：接收端 kind=1 校验/绑定块核对尚未存在（kind=1 帧在 bootstrap 期落
 *   `NAMESPACE_STATE_VIOLATION`）；
 * - R6：kind=2 接收端跨帧/绑定块校验结构性不可达（发送端先落 SYNC_DIFF_TOO_LARGE）；
 * - R7：超聚合上限的 kind=2 声明当前落 `SYNC_DIFF_TOO_LARGE`（非冻结新码）。
 *
 * 负控（当前 HEAD 即绿，实现后必须保持绿——证明红不在环境/入口/断言敏感度）：
 * - N1：未超单帧上限的 snapshot 仍走单帧 BOOTSTRAP_SNAPSHOT（触发条件，非兼容回落）；
 * - N2：未超单帧上限的恢复 diff 仍走单帧 SYNC_STEP2（零 kind=2 chunk）；
 * - N3（R43）：未协商端收到任何 0x42（含伪造 payload）→ pre-parse
 *   `UNSUPPORTED_MESSAGE_TYPE` connection fatal（close 1002、blocked、零 namespace ERROR）；
 * - N4（R47）：kind=0 chunked live-update 路径行为等价（transferKind 0、无绑定块、单
 *   UPDATE_ACK 锚末 chunk 帧序、收敛）。
 *
 * 纪律：无 skip/only/todo、无 env override、无 fallback、无源码字符串/正则断言、零 real
 * sleep（fake duplex + fake scheduler + 虚拟时间）；断言全部落在运行时行为（wire 帧、
 * namespace 状态、live Y.Doc 值、持久化 dirty 计数）。刻画文件
 * `ws-replication-issue233-repro.test.ts` 不改（本文件独立新增）。
 */
import { describe, expect, it } from 'vitest';
import {
  createHubReplication,
  createPeerReplication,
  type DuplexTransport,
  type HubReplication,
  type PeerReplication,
  type ReplicationLimits,
  type ReplicationTimeouts,
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

// ═══════════════════════════ 契约常量 ═══════════════════════════

const SCHEMA = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'issue300-chunked-sync-ac',
  text: 'type ROOT = { n: number; blurb: string; };\n',
});

/** R1/R3 同款构型基线（maxUpdateBytes=8KiB ⇒ chunk 上限 = 8KiB）。 */
const LIMITS: Readonly<Partial<ReplicationLimits>> = Object.freeze({
  maxUpdateBytes: 8 * 1024,
  maxInFlightUpdates: 8,
  maxQueuedUpdateCount: 100,
  maxQueuedUpdateBytes: 1 * 1024 * 1024,
});

const TIMEOUTS: Readonly<Partial<ReplicationTimeouts>> = Object.freeze({
  ackTimeoutMs: 60_000,
});

/** 超 `maxBootstrapBytes`（8KiB）且 ≤ `maxChunkedBootstrapBytes`（512KiB）的合法文档。 */
const BIG_SNAPSHOT = 'z'.repeat(100_000);
/** 超 `maxSyncDiffBytes`（32KiB）且 ≤ `maxChunkedSyncDiffBytes`（512KiB）的恢复 diff 载荷。 */
const BIG_DIFF = 'q'.repeat(100_000);
/** 可分块 live-update 载荷（> maxUpdateBytes 8KiB ∧ ≤ maxChunkedUpdateBytes 64KiB）。 */
const MEDIUM = 'm'.repeat(20_000);

const MAX_UPDATE_BYTES = 8 * 1024;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

type ChunkMsg = Extract<DecodedMessage['message'], { kind: 'UPDATE_CHUNK' }>;
type ErrorMsg = Extract<DecodedMessage['message'], { kind: 'ERROR' }>;

interface SeqChunk {
  readonly sequence: number;
  readonly message: ChunkMsg;
}

// ═══════════════════════════ 本地组装（单 ns；真协商 chunkedUpdate） ═══════════════════════════

interface Ctx {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly nsId: string;
  readonly wire: Wire;
  frames(dir: 'peerToHub' | 'hubToPeer'): DecodedMessage[];
  chunks(dir: 'peerToHub' | 'hubToPeer'): SeqChunk[];
  nextSeq(dir: 'peerToHub' | 'hubToPeer'): number;
  hubRoot(key: 'blurb' | 'n'): unknown;
  peerRoot(key: 'blurb' | 'n'): unknown;
  hubDocPresent(): boolean;
  peerDocPresent(): boolean;
  hubSaveCount(): number;
  releaseHubData(): void;
  advance(ms: number): Promise<void>;
  peerWrite(value: Readonly<{ blurb?: string }>): Promise<void>;
  hubWrite(value: Readonly<{ blurb?: string }>): Promise<void>;
  stop(): Promise<void>;
}

/** hub 侧 data 闸门代理（transport seam，非协议实现）：起始 bufferedAmount = high
 *  （> 缺省 highWater 512KiB ⇒ data 路径暂停；控制帧不受影响）；release() 归零恢复。 */
const PAUSE_HIGH = 600 * 1024;

function withHubDataPauseProxy(end: DuplexTransport): { end: DuplexTransport; release(): void } {
  let level = PAUSE_HIGH;
  const wrapped: DuplexTransport = {
    send(bytes) {
      end.send(bytes);
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
      level = 0;
    },
  };
}

/** peer 侧出站帧代理（故障注入 seam，非协议实现）：corrupt 返回改写后的字节（同 sequence）。 */
function withPeerSendCorruption(
  end: DuplexTransport,
  corrupt: (bytes: Uint8Array) => Uint8Array,
): DuplexTransport {
  return {
    send(bytes) {
      end.send(corrupt(bytes));
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

async function boot(opts: {
  limits?: Readonly<Partial<ReplicationLimits>>;
  initialBlurb?: string;
  /** false = v1 未协商（0x42 全 kind 被 decode 门控 pre-parse 拒绝）。缺省 true。 */
  chunkedUpdate?: boolean;
  /** 丢一帧 hub→peer 单帧 BOOTSTRAP_SNAPSHOT：把 peer 悬在 bootstrapping（接收端校验注入面）。 */
  dropSnapshot?: boolean;
  /** hub 侧起始 data 闸门关闭（R3：chunk 必须等 data 路径）。 */
  pauseHubDataAtStart?: boolean;
  /** peer 出站帧改写（R6：真实 kind=2 transfer 的跨帧/绑定块违例注入）。 */
  corruptPeerSend?: (bytes: Uint8Array) => Uint8Array;
}): Promise<Ctx> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const lease = okLease(
    await hubNode.registry.create({
      owner: HUB_OWNER,
      schema: { ...SCHEMA, id: 'issue300-chunked-sync-ac' },
      root: { n: 1, blurb: opts.initialBlurb ?? 'seed' },
    }),
  );
  await schemaReady(lease);
  const enabled = await lease.enableReplication();
  if (!enabled.ok) throw new Error(`enableReplication 失败：${JSON.stringify(enabled)}`);
  const nsId = lease.namespaceId;

  let activeWire: Wire | undefined;
  let releaseHubData: (() => void) | undefined;
  const decode = (bytes: Uint8Array): DecodedMessage =>
    decodeMessage(bytes, { selectedCapabilities: CAP_CHUNKED_UPDATE });

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
    ...(opts.limits === undefined ? {} : { limits: opts.limits }),
    timeouts: TIMEOUTS,
  });

  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      const wire = makeWire();
      activeWire = wire;
      if (opts.dropSnapshot === true) {
        wire.dropNextHubToPeer((bytes) => decode(bytes).message.kind === 'BOOTSTRAP_SNAPSHOT');
      }
      let hubEnd: DuplexTransport = wire.hubEnd;
      if (opts.pauseHubDataAtStart === true) {
        const paused = withHubDataPauseProxy(hubEnd);
        hubEnd = paused.end;
        releaseHubData = paused.release;
      }
      const peerEnd: DuplexTransport =
        opts.corruptPeerSend === undefined
          ? wire.peerEnd
          : withPeerSendCorruption(wire.peerEnd, opts.corruptPeerSend);
      void hub.accept(hubEnd, { token: TEST_TOKEN });
      return peerEnd;
    },
    timer: peerNode.scheduler,
    targets: [{ namespaceId: nsId, localOwner: PEER_OWNER }],
    ...(opts.limits === undefined ? {} : { limits: opts.limits }),
    timeouts: TIMEOUTS,
    chunkedUpdate: opts.chunkedUpdate ?? true,
  });
  peer.start();
  await settleUntil(() => peer.getConnectionState() === 'ready', '连接 ready');

  const bytesOf = (dir: 'peerToHub' | 'hubToPeer'): readonly Uint8Array[] => {
    if (activeWire === undefined) throw new Error('peer 尚未拨号');
    return dir === 'peerToHub' ? activeWire.peerToHub : activeWire.hubToPeer;
  };
  const frames = (dir: 'peerToHub' | 'hubToPeer'): DecodedMessage[] => bytesOf(dir).map(decode);
  const hubDoc = (): { getMap(name: string): Map<string, unknown> } | undefined =>
    hubNode.persistence.peek(HUB_OWNER, nsId) as { getMap(name: string): Map<string, unknown> } | undefined;
  const peerDoc = (): { getMap(name: string): Map<string, unknown> } | undefined =>
    peerNode.persistence.peek(PEER_OWNER, nsId) as { getMap(name: string): Map<string, unknown> } | undefined;

  return {
    hubNode,
    peerNode,
    hub,
    peer,
    nsId,
    get wire() {
      if (activeWire === undefined) throw new Error('peer 尚未拨号');
      return activeWire;
    },
    frames,
    chunks: (dir) =>
      frames(dir)
        .filter((f) => f.message.kind === 'UPDATE_CHUNK')
        .map((f) => ({ sequence: f.header.sequence, message: f.message as ChunkMsg })),
    nextSeq: (dir) => frames(dir).reduce((max, f) => Math.max(max, f.header.sequence), 0) + 1,
    hubRoot: (key) => hubDoc()?.getMap('ROOT').get(key),
    peerRoot: (key) => peerDoc()?.getMap('ROOT').get(key),
    hubDocPresent: () => hubDoc() !== undefined,
    peerDocPresent: () => peerDoc() !== undefined,
    hubSaveCount: () => hubNode.persistence.saveEvents.filter((e) => e.docId === nsId).length,
    releaseHubData: () => {
      if (releaseHubData === undefined) throw new Error('本构型未启用 hub data 闸门代理');
      releaseHubData();
    },
    advance: async (ms) => {
      await peerNode.scheduler.advanceBy(ms);
      await hubNode.scheduler.advanceBy(ms);
      await settle();
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
    hubWrite: async (value) => {
      const business = okLease(await hubNode.registry.open(HUB_OWNER, nsId));
      await schemaReady(business);
      for (const [key, v] of Object.entries(value)) {
        const result = await business.mutateData({ op: 'set', path: [key], value: v });
        if (!result.ok) throw new Error(`业务写失败：${JSON.stringify(result)}`);
      }
      await business.release();
    },
    stop: () => peer.stop().catch(() => undefined),
  };
}

// ═══════════════════════════ 断言辅助（结构性 wire 观测） ═══════════════════════════

function errorCodes(frames: readonly DecodedMessage[]): string[] {
  return frames
    .filter((f) => f.message.kind === 'ERROR')
    .map((f) => (f.message as ErrorMsg).code);
}

function onlyKind<const K extends DecodedMessage['message']['kind']>(
  frames: readonly DecodedMessage[],
  kind: K,
): Array<Extract<DecodedMessage['message'], { kind: K }>> {
  return frames
    .filter((f) => f.message.kind === kind)
    .map((f) => f.message as Extract<DecodedMessage['message'], { kind: K }>);
}

/** 单个 chunked transfer 的 wire 结构完整性（不假设发送端切片密度）。 */
function expectWellFormedTransfer(
  chunks: readonly SeqChunk[],
  label: string,
): { transferId: number; totalBytes: number; chunkCount: number } {
  expect(chunks.length, `${label}：wire 上必须观察到 ≥2 个 chunk 帧（分块传输）`).toBeGreaterThanOrEqual(2);
  const ids = [...new Set(chunks.map((c) => c.message.transferId))];
  expect(ids.length, `${label}：单笔 transfer 必须恰一个 transferId`).toBe(1);
  const head = chunks[0]!.message;
  const { transferId, totalBytes, chunkCount } = head;
  let sum = 0;
  chunks.forEach((chunk, index) => {
    expect(chunk.message.transferId, `${label}：transferId 逐帧逐字节一致`).toBe(transferId);
    expect(chunk.message.totalBytes, `${label}：totalBytes 逐帧逐字节一致`).toBe(totalBytes);
    expect(chunk.message.chunkCount, `${label}：chunkCount 逐帧逐字节一致`).toBe(chunkCount);
    expect(chunk.message.chunkIndex, `${label}：chunkIndex 严格递增（0-based）`).toBe(index);
    expect(
      chunk.message.bytes.byteLength,
      `${label}：每 chunk bytes ≤ maxUpdateBytes（frame 级上限，零新上限）`,
    ).toBeLessThanOrEqual(MAX_UPDATE_BYTES);
    sum += chunk.message.bytes.byteLength;
  });
  expect(chunkCount, `${label}：chunkCount 必须等于实际 observe 到的 chunk 数`).toBe(chunks.length);
  expect(sum, `${label}：Σbytes === totalBytes（收齐精确核对的对象）`).toBe(totalBytes);
  expect(
    totalBytes,
    `${label}：几何一致 totalBytes ≤ chunkCount × maxUpdateBytes（协议 §10.3 首 chunk 第③条）`,
  ).toBeLessThanOrEqual(chunkCount * MAX_UPDATE_BYTES);
  return { transferId, totalBytes, chunkCount };
}

function expectFrameBounds(frames: readonly DecodedMessage[], label: string): void {
  for (const frame of frames) {
    expect(
      frame.header.payloadLength + 20,
      `${label}：每个 wire frame ≤ maxFrameBytes（含 20-byte envelope）`,
    ).toBeLessThanOrEqual(MAX_FRAME_BYTES);
  }
}

// ═══════════════════════════ 契约测试 ═══════════════════════════

const SNAPSHOT_LIMITS: Readonly<Partial<ReplicationLimits>> = {
  ...LIMITS,
  maxBootstrapBytes: 8 * 1024,
  maxSyncDiffBytes: 32 * 1024,
  maxChunkedBootstrapBytes: 512 * 1024,
  maxChunkedSyncDiffBytes: 512 * 1024,
};

describe('issue #300（#295 切片 2）：chunked BOOTSTRAP_SNAPSHOT / SYNC_STEP2 端到端（红灯验收契约）', () => {
  it('红灯 R1（AC1 + AC3）：超 maxBootstrapBytes 的 snapshot 经 kind=1 chunk 序列完成初始同步；BOOTSTRAP_ACK 锚末 chunk 帧序；每帧 ≤ maxUpdateBytes/maxFrameBytes；零 BOOTSTRAP_TOO_LARGE', async () => {
    const ctx = await boot({ limits: SNAPSHOT_LIMITS, initialBlurb: BIG_SNAPSHOT });
    try {
      await settle();
      const bootstrapState = ctx.peer.getNamespaceState(ctx.nsId);
      expect(
        bootstrapState,
        `超限 snapshot 不得以单帧 BOOTSTRAP_TOO_LARGE 终局；peer 必须经 kind=1 分块传输完成初始同步（当前 ${String(bootstrapState)}）`,
      ).not.toBe('failed');
      await settleUntil(
        () => ctx.peer.getNamespaceState(ctx.nsId) === 'live',
        `peer 经 kind=1 分块 snapshot 收敛到 live（当前 ${String(ctx.peer.getNamespaceState(ctx.nsId))}）`,
      );
      await settle();

      // 触发条件：snapshot 超单帧上限 ⇒ 不得走单帧 BOOTSTRAP_SNAPSHOT 控制帧
      expect(
        onlyKind(ctx.frames('hubToPeer'), 'BOOTSTRAP_SNAPSHOT'),
        '超限 snapshot 不得以单帧 BOOTSTRAP_SNAPSHOT 出站（协议 §8.1 改道，非兼容回落）',
      ).toHaveLength(0);

      const chunks = ctx.chunks('hubToPeer');
      expect(
        chunks.every((c) => c.message.transferKind === 1),
        'snapshot transfer 的 kind 首字段必须恒为 1',
      ).toBe(true);
      const shape = expectWellFormedTransfer(chunks, 'kind=1 snapshot transfer');
      expect(shape.totalBytes, '声明的 totalBytes 必须真正超单帧上限（触发条件敏感性）').toBeGreaterThan(
        8 * 1024,
      );
      expect(
        shape.totalBytes,
        '声明的 totalBytes 必须 ≤ maxChunkedBootstrapBytes（聚合上限内）',
      ).toBeLessThanOrEqual(512 * 1024);
      expectFrameBounds(ctx.frames('hubToPeer'), 'hub→peer');

      // 收敛：peer 安装基线副本（一次排他复制导入的最终效应）
      expect(ctx.peerDocPresent(), 'peer 必须安装基线副本').toBe(true);
      expect(ctx.peerRoot('blurb'), 'peer 基线值必须逐字等于 hub 快照').toBe(BIG_SNAPSHOT);
      expect(ctx.hubRoot('blurb'), 'hub 快照源不变').toBe(BIG_SNAPSHOT);
      expect(ctx.peer.getConnectionState()).toBe('ready');

      // 单 ACK 结算 + ackedSequence = 末 chunk 帧序（§8.2）
      const acks = onlyKind(ctx.frames('peerToHub'), 'BOOTSTRAP_ACK');
      expect(acks, 'kind=1 transfer 必须恰一次 BOOTSTRAP_ACK 结算').toHaveLength(1);
      expect(
        acks[0]!.ackedSequence,
        'BOOTSTRAP_ACK.ackedSequence 必须锚在末 chunk 帧序（导入完成后结算）',
      ).toBe(chunks[chunks.length - 1]!.sequence);

      // 错误面：零 ERROR（尤其零 BOOTSTRAP_TOO_LARGE 死码触发）
      expect(errorCodes(ctx.frames('hubToPeer')), 'hub→peer 零 ERROR').toEqual([]);
      expect(errorCodes(ctx.frames('peerToHub')), 'peer→hub 零 ERROR').toEqual([]);
      expect(ctx.peer.getNamespaceState(ctx.nsId)).toBe('live');
    } finally {
      await ctx.stop();
    }
  });

  it('红灯 R2（AC2 + AC3 + SA8 R42）：超 maxSyncDiffBytes 的恢复 diff 经 kind=2 chunk 序列收敛；SYNC_APPLIED 锚末 chunk 帧序；三 kind 共用 transferId 计数器（跨 kind 严格递增）', async () => {
    const ctx = await boot({ limits: { ...SNAPSHOT_LIMITS, maxChunkedUpdateBytes: 64 * 1024 } });
    try {
      await settleUntil(() => ctx.peer.getNamespaceState(ctx.nsId) === 'live', 'peer live');

      // phase A：可分块 live update（20KB ≤ maxChunkedUpdateBytes 64KiB）→ kind=0 transfer
      const p2hBeforeA = ctx.frames('peerToHub').length;
      await ctx.peerWrite({ blurb: MEDIUM });
      await settleUntil(() => ctx.hubRoot('blurb') === MEDIUM, 'phase A：kind=0 分块 live update 收敛');
      const p2hBeforeB = ctx.frames('peerToHub').length;
      const h2pBeforeB = ctx.frames('hubToPeer').length;
      const phaseAChunks = ctx
        .frames('peerToHub')
        .slice(p2hBeforeA, p2hBeforeB)
        .filter((f) => f.message.kind === 'UPDATE_CHUNK')
        .map((f) => ({ sequence: f.header.sequence, message: f.message as ChunkMsg }));
      expect(phaseAChunks.length, 'phase A 必须发生 kind=0 分块传输（跨 kind 计数器断言前提）').toBeGreaterThanOrEqual(2);
      expect(phaseAChunks.every((c) => c.message.transferKind === 0), 'phase A = kind=0').toBe(true);
      const kind0Shape = expectWellFormedTransfer(phaseAChunks, 'kind=0 live transfer');

      // phase B：100KB > maxChunkedUpdateBytes ⇒ live 路径不可分块 → 恢复 round 的 diff 超
      // maxSyncDiffBytes(32KiB) → kind=2 分块序列
      await ctx.peerWrite({ blurb: BIG_DIFF });
      await settle();
      const phaseBState = ctx.peer.getNamespaceState(ctx.nsId);
      expect(
        phaseBState,
        `超 maxSyncDiffBytes 的恢复 diff 不得以单帧 SYNC_DIFF_TOO_LARGE 终局；peer 必须经 kind=2 分块传输收敛（当前 ${String(phaseBState)}）`,
      ).not.toBe('failed');
      await settleUntil(
        () => ctx.hubRoot('blurb') === BIG_DIFF && ctx.peer.getNamespaceState(ctx.nsId) === 'live',
        `phase B：kind=2 分块恢复 diff 收敛（当前 hub=${String(ctx.hubRoot('blurb'))?.slice(0, 8)}）`,
      );
      await settle();

      const phaseBFramesP2H = ctx.frames('peerToHub').slice(p2hBeforeB);
      const phaseBFramesH2P = ctx.frames('hubToPeer').slice(h2pBeforeB);
      expectFrameBounds([...phaseBFramesP2H, ...phaseBFramesH2P], 'phase B');

      const kind2Chunks = phaseBFramesP2H
        .filter((f) => f.message.kind === 'UPDATE_CHUNK')
        .map((f) => ({ sequence: f.header.sequence, message: f.message as ChunkMsg }));
      expect(
        kind2Chunks.every((c) => c.message.transferKind === 2),
        'phase B 的恢复 diff transfer 的 kind 首字段必须恒为 2',
      ).toBe(true);
      const kind2Shape = expectWellFormedTransfer(kind2Chunks, 'kind=2 recovery diff transfer');
      expect(
        kind2Shape.totalBytes,
        '恢复 diff 的 totalBytes 必须真正超 maxSyncDiffBytes（触发条件敏感性）',
      ).toBeGreaterThan(32 * 1024);
      expect(
        kind2Shape.totalBytes,
        '恢复 diff 的 totalBytes 必须 ≤ maxChunkedSyncDiffBytes（聚合上限内）',
      ).toBeLessThanOrEqual(512 * 1024);

      // R42：三 kind 共用同一 (连接, 方向, namespace) 计数器 ⇒ 跨 kind 严格递增
      expect(
        kind2Shape.transferId,
        `kind=2 transferId(${kind2Shape.transferId}) 必须 > 前一笔 kind=0 transferId(${kind0Shape.transferId})——单计数器共享`,
      ).toBeGreaterThan(kind0Shape.transferId);

      // 绑定块：kind=2 首 chunk syncRoundId 必须等于本 round 的 SYNC_STEP1 roundId
      const step1Rounds = onlyKind(phaseBFramesP2H, 'SYNC_STEP1').map((m) => m.syncRoundId);
      expect(step1Rounds.length, '恢复 round 必须先有 SYNC_STEP1').toBeGreaterThanOrEqual(1);
      const recoveryRoundId = step1Rounds[step1Rounds.length - 1]!;
      expect(
        kind2Chunks[0]!.message.syncRoundId,
        'kind=2 首 chunk 绑定块 syncRoundId 必须与本 round 一致（§9.2）',
      ).toBe(recoveryRoundId);

      // 单 ACK 结算：SYNC_APPLIED.ackedSequence = 末 chunk 帧序（§9.3）；一次 apply 的效应 = 收敛值
      const applied = onlyKind(phaseBFramesH2P, 'SYNC_APPLIED');
      expect(applied, 'kind=2 transfer 必须恰一次 SYNC_APPLIED 结算').toHaveLength(1);
      expect(applied[0]!.syncRoundId, 'SYNC_APPLIED 属于恢复 round').toBe(recoveryRoundId);
      expect(
        applied[0]!.ackedSequence,
        'SYNC_APPLIED.ackedSequence 必须锚在末 kind=2 chunk 帧序',
      ).toBe(kind2Chunks[kind2Chunks.length - 1]!.sequence);

      // 无控制帧绕行：phase B 的 SYNC_STEP2 单帧（若有）不得超 maxSyncDiffBytes
      for (const step2 of onlyKind(phaseBFramesP2H, 'SYNC_STEP2')) {
        expect(
          step2.update.byteLength,
          'phase B 不得出现超 maxSyncDiffBytes 的单帧 SYNC_STEP2（R1 结构性绕行修复）',
        ).toBeLessThanOrEqual(32 * 1024);
      }
      expect(errorCodes(phaseBFramesP2H), 'phase B peer→hub 零 ERROR（零 SYNC_DIFF_TOO_LARGE）').toEqual([]);
      expect(errorCodes(phaseBFramesH2P), 'phase B hub→peer 零 ERROR').toEqual([]);
      expect(ctx.hubRoot('blurb'), 'hub 收敛到最新大文档').toBe(BIG_DIFF);
    } finally {
      await ctx.stop();
    }
  });

  it('红灯 R2b（AC2 双向）：hub→peer 方向的超限恢复 diff 同样经 kind=2 chunk 序列收敛；SYNC_APPLIED 锚末 chunk 帧序', async () => {
    const ctx = await boot({
      limits: { ...SNAPSHOT_LIMITS, maxBootstrapBytes: 64 * 1024, maxChunkedUpdateBytes: 4 * 1024 },
      initialBlurb: 'seed',
    });
    try {
      await settleUntil(() => ctx.peer.getNamespaceState(ctx.nsId) === 'live', 'peer live');
      const h2pBefore = ctx.frames('hubToPeer').length;
      const p2hBefore = ctx.frames('peerToHub').length;
      // hub 侧 100KB 写：> maxUpdateBytes ∧ > maxChunkedUpdateBytes ⇒ live 路径不可分块 →
      // hub 声明 RESYNC_REQUIRED（等待 peer 新 round）→ peer 恢复 round 的 hub→peer diff
      // 超 maxSyncDiffBytes → kind=2
      await ctx.hubWrite({ blurb: BIG_DIFF });
      await settle();
      const hubSideState = ctx.peer.getNamespaceState(ctx.nsId);
      expect(
        hubSideState,
        `hub→peer 超限 diff 不得以单帧 SYNC_DIFF_TOO_LARGE 终局；peer 必须经 kind=2 分块传输收敛（当前 ${String(hubSideState)}）`,
      ).not.toBe('failed');
      await settleUntil(
        () => ctx.peerRoot('blurb') === BIG_DIFF && ctx.peer.getNamespaceState(ctx.nsId) === 'live',
        `hub→peer kind=2 收敛（当前 peer=${String(ctx.peerRoot('blurb'))?.slice(0, 8)}）`,
      );
      await settle();

      const phaseH2P = ctx.frames('hubToPeer').slice(h2pBefore);
      const phaseP2H = ctx.frames('peerToHub').slice(p2hBefore);
      const kind2Chunks = phaseH2P
        .filter((f) => f.message.kind === 'UPDATE_CHUNK')
        .map((f) => ({ sequence: f.header.sequence, message: f.message as ChunkMsg }));
      expect(
        kind2Chunks.every((c) => c.message.transferKind === 2),
        'hub→peer 恢复 diff 的 kind 首字段必须恒为 2',
      ).toBe(true);
      const shape = expectWellFormedTransfer(kind2Chunks, 'hub→peer kind=2 recovery diff transfer');
      expect(shape.totalBytes, 'hub→peer diff 必须真正超 maxSyncDiffBytes').toBeGreaterThan(32 * 1024);

      const step1Rounds = onlyKind(phaseP2H, 'SYNC_STEP1').map((m) => m.syncRoundId);
      expect(step1Rounds.length, 'peer 必须发起恢复 round（hub 声明 RESYNC 后）').toBeGreaterThanOrEqual(1);
      const recoveryRoundId = step1Rounds[step1Rounds.length - 1]!;
      expect(
        kind2Chunks[0]!.message.syncRoundId,
        'hub→peer kind=2 首 chunk 绑定块 syncRoundId 必须与本 round 一致',
      ).toBe(recoveryRoundId);

      const applied = onlyKind(phaseP2H, 'SYNC_APPLIED');
      expect(applied, 'hub→peer kind=2 transfer 必须恰一次 SYNC_APPLIED 结算').toHaveLength(1);
      expect(applied[0]!.syncRoundId).toBe(recoveryRoundId);
      expect(applied[0]!.ackedSequence, 'SYNC_APPLIED 锚末 kind=2 chunk 帧序').toBe(
        kind2Chunks[kind2Chunks.length - 1]!.sequence,
      );
      expect(errorCodes(phaseH2P), 'hub→peer 零 ERROR（零 SYNC_DIFF_TOO_LARGE）').toEqual([]);
      expect(errorCodes(phaseP2H), 'peer→hub 零 ERROR').toEqual([]);
      expect(ctx.peerRoot('blurb'), 'peer 收敛到 hub 大文档').toBe(BIG_DIFF);
    } finally {
      await ctx.stop();
    }
  });

  it('红灯 R3（AC3 data 路径记账）：超限 snapshot 在 data 闸门关闭时零 chunk 出站、终局不由控制帧判定；开闸后经 data 路径逐帧完成（control reserve 零 chunk）', async () => {
    const ctx = await boot({
      limits: SNAPSHOT_LIMITS,
      initialBlurb: BIG_SNAPSHOT,
      pauseHubDataAtStart: true,
    });
    try {
      await settle();
      await settleUntil(
        () => ctx.frames('hubToPeer').some((f) => f.message.kind === 'OPEN_OK'),
        'OPEN_OK 控制帧必须能穿过 data 压力（control 与 data 路径分账）',
      );
      const pausedState = ctx.peer.getNamespaceState(ctx.nsId);
      expect(
        pausedState,
        `data 闸门关闭时 bootstrap 不得被控制帧判定为终局失败（当前 ${String(pausedState)}：BOOTSTRAP_TOO_LARGE 经 control 路径直达）`,
      ).not.toBe('failed');
      expect(
        pausedState === 'opening' || pausedState === 'bootstrapping',
        `data 闸门关闭时 peer 必须悬在 bootstrap 传输中（当前 ${String(pausedState)}）`,
      ).toBe(true);
      expect(ctx.chunks('hubToPeer'), 'data 闸门关闭时零 chunk 出站（chunk 经 data 路径记账）').toHaveLength(0);
      expect(
        onlyKind(ctx.frames('hubToPeer'), 'BOOTSTRAP_SNAPSHOT'),
        'data 闸门关闭时不得以单帧控制 snapshot 绕行',
      ).toHaveLength(0);

      ctx.releaseHubData();
      await ctx.advance(1000);
      await settleUntil(
        () => ctx.peer.getNamespaceState(ctx.nsId) === 'live' && ctx.peerRoot('blurb') === BIG_SNAPSHOT,
        '开闸后 kind=1 chunk 序列完成 bootstrap 并收敛',
      );
      expectWellFormedTransfer(ctx.chunks('hubToPeer'), '闸门恢复后的 kind=1 snapshot transfer');
      expect(ctx.peer.getConnectionState()).toBe('ready');
    } finally {
      await ctx.stop();
    }
  });

  it('红灯 R4（AC4 + SA8 R44 kind=1 声明/几何校验）：聚合上限 / 计数上限 / 几何不一致分别映射 SNAPSHOT_TRANSFER_TOO_LARGE / SNAPSHOT_TRANSFER_VIOLATION；边界（恰在限内）必须接纳；apply 前零写入', async () => {
    interface SnapCase {
      readonly label: string;
      readonly accept: boolean;
      readonly totalBytes: number;
      readonly chunkCount: number;
      readonly code?: string;
    }
    const cases: readonly SnapCase[] = [
      {
        label: 'totalBytes 超聚合上限（128KiB > maxChunkedBootstrapBytes 64KiB）',
        accept: false,
        code: 'SNAPSHOT_TRANSFER_TOO_LARGE',
        totalBytes: 128 * 1024,
        chunkCount: 64,
      },
      {
        label: 'chunkCount 超 maxChunksPerUpdate（65 > 64）',
        accept: false,
        code: 'SNAPSHOT_TRANSFER_TOO_LARGE',
        totalBytes: 1024,
        chunkCount: 65,
      },
      {
        label: '几何不一致 totalBytes > chunkCount × maxUpdateBytes（48KiB > 2 × 8KiB）',
        accept: false,
        code: 'SNAPSHOT_TRANSFER_VIOLATION',
        totalBytes: 48 * 1024,
        chunkCount: 2,
      },
      {
        label: '边界（≤ 含等号）：totalBytes = 64KiB = maxChunkedBootstrapBytes ∧ chunkCount = 64 = maxChunksPerUpdate',
        accept: true,
        totalBytes: 64 * 1024,
        chunkCount: 64,
      },
    ];
    const observed: Array<{
      readonly label: string;
      readonly codes: string[];
      readonly state: string | undefined;
      readonly docPresent: boolean;
    }> = [];
    for (const c of cases) {
      const ctx = await boot({
        limits: {
          ...LIMITS,
          maxBootstrapBytes: 64 * 1024,
          maxChunkedBootstrapBytes: 64 * 1024,
          maxSyncDiffBytes: 32 * 1024,
          maxChunkedSyncDiffBytes: 512 * 1024,
        },
        dropSnapshot: true,
      });
      try {
        await settle();
        expect(
          ctx.peer.getNamespaceState(ctx.nsId),
          `${c.label}：前置——peer 必须悬在 bootstrapping（单帧 snapshot 被丢）`,
        ).toBe('bootstrapping');
        const openOk = onlyKind(ctx.frames('hubToPeer'), 'OPEN_OK')[0]!;
        const crafted = encodeMessage(
          {
            kind: 'UPDATE_CHUNK',
            transferKind: 1,
            namespaceId: ctx.nsId,
            transferId: 1,
            chunkIndex: 0,
            chunkCount: c.chunkCount,
            totalBytes: c.totalBytes,
            replicationId: openOk.replicationId,
            replicationEpoch: openOk.replicationEpoch,
            bytes: new Uint8Array(1024),
          },
          { sequence: ctx.nextSeq('hubToPeer'), limits: { maxUpdateBytes: MAX_UPDATE_BYTES } },
        );
        ctx.wire.hubEnd.send(crafted);
        await settle();
        await settle();
        observed.push({
          label: c.label,
          codes: errorCodes(ctx.frames('peerToHub')),
          state: ctx.peer.getNamespaceState(ctx.nsId),
          docPresent: ctx.peerDocPresent(),
        });
      } finally {
        await ctx.stop();
      }
    }
    cases.forEach((c, index) => {
      const o = observed[index]!;
      if (c.accept) {
        // 边界敏感度：判据必须是 ≤（含等号）——恰在上界的声明不得被误判为违例
        expect(
          o.codes,
          `${c.label}：恰在冻结上界内的首 chunk 不得报错（≤ 含等号）`,
        ).toEqual([]);
        expect(o.state, `${c.label}：未收齐不得终局（assembly 悬置）`).toBe('bootstrapping');
        expect(o.docPresent, `${c.label}：未收齐不得 apply——零写入`).toBe(false);
      } else {
        expect(
          o.codes,
          `${c.label}：必须映射 ${String(c.code)}（当前 kind=1 在 bootstrap 期落 NAMESPACE_STATE_VIOLATION）`,
        ).toContain(c.code);
        expect(o.state, `${c.label}：终局 failed`).toBe('failed');
        expect(o.docPresent, `${c.label}：重组/校验失败先于 apply——live Y.Doc 零写入`).toBe(false);
      }
    });
  });

  it('红灯 R5（AC4 kind=1 绑定块核对）：首 chunk replicationId / replicationEpoch 与 OPEN_OK 不符 → 既有 REPLICATION_ID_MISMATCH / REPLICATION_EPOCH_MISMATCH；apply 前零写入', async () => {
    const cases = [
      { label: 'replicationId 不符', code: 'REPLICATION_ID_MISMATCH', wrong: 'id' },
      { label: 'replicationEpoch 不符', code: 'REPLICATION_EPOCH_MISMATCH', wrong: 'epoch' },
    ] as const;
    const observed: Array<{
      readonly label: string;
      readonly codes: string[];
      readonly state: string | undefined;
      readonly docPresent: boolean;
    }> = [];
    for (const c of cases) {
      const ctx = await boot({
        limits: {
          ...LIMITS,
          maxBootstrapBytes: 64 * 1024,
          maxChunkedBootstrapBytes: 64 * 1024,
          maxSyncDiffBytes: 32 * 1024,
          maxChunkedSyncDiffBytes: 512 * 1024,
        },
        dropSnapshot: true,
      });
      try {
        await settle();
        expect(ctx.peer.getNamespaceState(ctx.nsId), `${c.label}：前置 bootstrapping`).toBe(
          'bootstrapping',
        );
        const openOk = onlyKind(ctx.frames('hubToPeer'), 'OPEN_OK')[0]!;
        const replicatedId = c.wrong === 'id' ? `${openOk.replicationId.slice(0, -1)}f` : openOk.replicationId;
        const epoch = c.wrong === 'epoch' ? openOk.replicationEpoch + 1 : openOk.replicationEpoch;
        const crafted = encodeMessage(
          {
            kind: 'UPDATE_CHUNK',
            transferKind: 1,
            namespaceId: ctx.nsId,
            transferId: 1,
            chunkIndex: 0,
            chunkCount: 2,
            totalBytes: 8 * 1024,
            replicationId: replicatedId,
            replicationEpoch: epoch,
            bytes: new Uint8Array(1024),
          },
          { sequence: ctx.nextSeq('hubToPeer'), limits: { maxUpdateBytes: MAX_UPDATE_BYTES } },
        );
        ctx.wire.hubEnd.send(crafted);
        await settle();
        await settle();
        observed.push({
          label: c.label,
          codes: errorCodes(ctx.frames('peerToHub')),
          state: ctx.peer.getNamespaceState(ctx.nsId),
          docPresent: ctx.peerDocPresent(),
        });
      } finally {
        await ctx.stop();
      }
    }
    cases.forEach((c, index) => {
      const o = observed[index]!;
      expect(
        o.codes,
        `${c.label}：必须映射既有码 ${c.code}（绑定块内容核对归本切片）`,
      ).toContain(c.code);
      expect(o.state, `${c.label}：终局 failed`).toBe('failed');
      expect(o.docPresent, `${c.label}：绑定块核对失败先于 apply——零写入`).toBe(false);
    });
  });

  it('红灯 R6（AC4 + SA8 R44 kind=2 跨帧/绑定块违例）：真实 kind=2 transfer 的后续 chunk totalBytes 漂移 → SYNC_TRANSFER_VIOLATION；首 chunk syncRoundId 漂移 → SYNC_STATE_VIOLATION；apply 前零写入', async () => {
    const corruptionOf = (mode: 'totalBytes' | 'syncRoundId') => (bytes: Uint8Array): Uint8Array => {
      const decoded = decodeMessage(bytes, { selectedCapabilities: CAP_CHUNKED_UPDATE });
      if (decoded.message.kind !== 'UPDATE_CHUNK') return bytes;
      const msg = decoded.message as ChunkMsg;
      if (msg.transferKind !== 2) return bytes;
      if (mode === 'syncRoundId' && msg.chunkIndex === 0 && msg.syncRoundId !== undefined) {
        return encodeMessage(
          { ...msg, syncRoundId: msg.syncRoundId + 1 },
          { sequence: decoded.header.sequence },
        );
      }
      if (mode === 'totalBytes' && msg.chunkIndex === 1) {
        return encodeMessage({ ...msg, totalBytes: msg.totalBytes + 1 }, { sequence: decoded.header.sequence });
      }
      return bytes;
    };
    const cases = [
      { label: '后续 chunk totalBytes 漂移', mode: 'totalBytes' as const, code: 'SYNC_TRANSFER_VIOLATION' },
      { label: '首 chunk syncRoundId 漂移', mode: 'syncRoundId' as const, code: 'SYNC_STATE_VIOLATION' },
    ];
    const observed: Array<{
      readonly label: string;
      readonly chunkCount: number;
      readonly codes: string[];
      readonly hubValue: unknown;
      readonly hubSavesUnchanged: boolean;
      readonly peerState: string | undefined;
      readonly connection: string;
    }> = [];
    for (const c of cases) {
      const ctx = await boot({
        limits: {
          ...LIMITS,
          maxBootstrapBytes: 64 * 1024,
          maxChunkedUpdateBytes: 4 * 1024,
          maxSyncDiffBytes: 32 * 1024,
          maxChunkedSyncDiffBytes: 512 * 1024,
        },
        corruptPeerSend: corruptionOf(c.mode),
      });
      try {
        await settleUntil(() => ctx.peer.getNamespaceState(ctx.nsId) === 'live', 'peer live');
        const savesBefore = ctx.hubSaveCount();
        await ctx.peerWrite({ blurb: BIG_DIFF });
        await settle();
        await settle();
        observed.push({
          label: c.label,
          chunkCount: ctx.chunks('peerToHub').filter((k) => k.message.transferKind === 2).length,
          codes: errorCodes(ctx.frames('hubToPeer')),
          hubValue: ctx.hubRoot('blurb'),
          hubSavesUnchanged: ctx.hubSaveCount() === savesBefore,
          peerState: ctx.peer.getNamespaceState(ctx.nsId),
          connection: ctx.peer.getConnectionState(),
        });
      } finally {
        await ctx.stop();
      }
    }
    cases.forEach((c, index) => {
      const o = observed[index]!;
      // 注入面真实性：前置必须是真实发生的 kind=2 chunk 序列（不是 fixture 空转）
      expect(
        o.chunkCount,
        `${c.label}：前置——真实 kind=2 chunk 序列必须已上 wire（当前 0：kind=2 发送路径缺失）`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        o.codes,
        `${c.label}：必须映射 ${c.code}（跨帧/绑定块违例接收端校验归本切片）`,
      ).toContain(c.code);
      expect(o.hubValue, `${c.label}：违例先于 apply——hub live Y.Doc 零写入`).toBe('seed');
      expect(o.hubSavesUnchanged, `${c.label}：违例零 dirty 登记`).toBe(true);
      expect(o.peerState, `${c.label}：peer 终局 failed`).toBe('failed');
      expect(o.connection, `${c.label}：ns 级违例——连接保持 ready`).toBe('ready');
    });
  });

  it('红灯 R7（AC4 + SA8 R45 kind=2 声明超聚合上限）：100KB 恢复 diff > maxChunkedSyncDiffBytes 32KiB → 冻结码 SYNC_TRANSFER_TOO_LARGE 在 wire 可观察 + 终局 failed + 零写入（不收敛）', async () => {
    const ctx = await boot({
      limits: {
        ...LIMITS,
        maxBootstrapBytes: 64 * 1024,
        maxChunkedUpdateBytes: 4 * 1024,
        maxSyncDiffBytes: 32 * 1024,
        maxChunkedSyncDiffBytes: 32 * 1024,
      },
    });
    try {
      await settleUntil(() => ctx.peer.getNamespaceState(ctx.nsId) === 'live', 'peer live');
      await ctx.peerWrite({ blurb: BIG_DIFF });
      await settleUntil(
        () => ctx.peer.getNamespaceState(ctx.nsId) === 'failed',
        `超聚合上限的 kind=2 载荷必须以冻结码终局 failed（当前 ${String(ctx.peer.getNamespaceState(ctx.nsId))}）`,
      );
      await settle();
      const codes = [...errorCodes(ctx.frames('peerToHub')), ...errorCodes(ctx.frames('hubToPeer'))];
      expect(
        codes,
        'SYNC_TRANSFER_TOO_LARGE（fatal/config/failed）必须在 wire 可观察——发送端预检或接收端首 chunk 校验两种合规落地均覆盖',
      ).toContain('SYNC_TRANSFER_TOO_LARGE');
      expect(codes, '不得回落到单帧路径死码 SYNC_DIFF_TOO_LARGE').not.toContain('SYNC_DIFF_TOO_LARGE');
      expect(ctx.hubRoot('blurb'), '超限载荷不得部分写入 hub').toBe('seed');
      expect(ctx.peer.getNamespaceState(ctx.nsId)).toBe('failed');
      expect(ctx.peer.getConnectionState(), 'namespace 级失败——连接保持 ready').toBe('ready');
    } finally {
      await ctx.stop();
    }
  });

  it('负控 N1（AC1 触发条件）：未超 maxBootstrapBytes 的 snapshot 仍走单帧 BOOTSTRAP_SNAPSHOT——零 kind=1 chunk、单 ACK、收敛', async () => {
    const ctx = await boot({
      limits: { ...SNAPSHOT_LIMITS },
      initialBlurb: 's'.repeat(2_000),
    });
    try {
      await settleUntil(() => ctx.peer.getNamespaceState(ctx.nsId) === 'live', '单帧 snapshot 收敛');
      await settle();
      const snapshots = onlyKind(ctx.frames('hubToPeer'), 'BOOTSTRAP_SNAPSHOT');
      expect(snapshots, '未超单帧上限：恰一帧 BOOTSTRAP_SNAPSHOT').toHaveLength(1);
      expect(snapshots[0]!.snapshot.byteLength, '单帧载荷 ≤ maxBootstrapBytes').toBeLessThanOrEqual(8 * 1024);
      expect(ctx.chunks('hubToPeer'), '单帧路径零 0x42 chunk').toHaveLength(0);
      const acks = onlyKind(ctx.frames('peerToHub'), 'BOOTSTRAP_ACK');
      expect(acks).toHaveLength(1);
      expect(acks[0]!.ackedSequence).toBe(
        ctx.frames('hubToPeer').find((f) => f.message.kind === 'BOOTSTRAP_SNAPSHOT')!.header.sequence,
      );
      expect(ctx.peerRoot('blurb')).toBe('s'.repeat(2_000));
    } finally {
      await ctx.stop();
    }
  });

  it('负控 N2（AC2 触发条件）：未超 maxSyncDiffBytes 的恢复 diff 仍走单帧 SYNC_STEP2——零 kind=2 chunk、恰一帧、收敛', async () => {
    const ctx = await boot({
      limits: {
        ...LIMITS,
        maxBootstrapBytes: 64 * 1024,
        maxChunkedUpdateBytes: 4 * 1024,
        maxSyncDiffBytes: 32 * 1024,
        maxChunkedSyncDiffBytes: 512 * 1024,
      },
    });
    try {
      await settleUntil(() => ctx.peer.getNamespaceState(ctx.nsId) === 'live', 'peer live');
      const p2hBefore = ctx.frames('peerToHub').length; // boot round 的 Step2 不计入本断言面
      await ctx.peerWrite({ blurb: 's'.repeat(16_000) });
      await settleUntil(() => ctx.hubRoot('blurb') === 's'.repeat(16_000), '单帧恢复 diff 收敛');
      await settle();
      const step2 = onlyKind(
        ctx.frames('peerToHub').slice(p2hBefore),
        'SYNC_STEP2',
      );
      expect(step2, '未超 maxSyncDiffBytes：恢复 diff 仍走单帧 SYNC_STEP2').toHaveLength(1);
      expect(step2[0]!.update.byteLength, '单帧 diff ≤ maxSyncDiffBytes 且 > maxUpdateBytes（触发敏感性）').toBeGreaterThan(8 * 1024);
      expect(step2[0]!.update.byteLength, '单帧 diff ≤ maxSyncDiffBytes').toBeLessThanOrEqual(32 * 1024);
      expect(ctx.chunks('peerToHub'), '单帧路径零 0x42 chunk').toHaveLength(0);
    } finally {
      await ctx.stop();
    }
  });

  it('负控 N3（SA8 R43 解码侧协商门）：未协商端收到任何 0x42（含伪造 payload）→ pre-parse UNSUPPORTED_MESSAGE_TYPE connection fatal（close 1002 / blocked / 零 namespace ERROR）', async () => {
    const ctx = await boot({
      limits: { ...LIMITS, maxChunkedUpdateBytes: 64 * 1024 },
      chunkedUpdate: false,
    });
    try {
      await settleUntil(() => ctx.peer.getNamespaceState(ctx.nsId) === 'live', 'peer live（未协商连接）');
      const valid = encodeMessage(
        {
          kind: 'UPDATE_CHUNK',
          transferKind: 2,
          namespaceId: ctx.nsId,
          transferId: 1,
          chunkIndex: 0,
          chunkCount: 2,
          totalBytes: 4096,
          syncRoundId: 1,
          bytes: new Uint8Array(2048),
        },
        { sequence: ctx.nextSeq('hubToPeer') },
      );
      // 伪造 payload（首字段 transferKind=3 非法）：若门控后置会落 MALFORMED_FRAME；
      // pre-parse 门控必须优先给出 UNSUPPORTED_MESSAGE_TYPE（不分 kind）。
      const corrupted = valid.slice();
      corrupted[20] = 3;
      ctx.wire.hubEnd.send(corrupted);
      await settle();
      await settle();
      expect(
        errorCodes(ctx.frames('peerToHub')),
        '未协商端必须以 UNSUPPORTED_MESSAGE_TYPE connection fatal 拒绝（不得落 namespace 级码）',
      ).toContain('UNSUPPORTED_MESSAGE_TYPE');
      expect(
        errorCodes(ctx.frames('peerToHub')).filter((code) => code.startsWith('SNAPSHOT_') || code.startsWith('SYNC_')),
        '未协商端不得把 0x42 交给 namespace kind 校验面',
      ).toEqual([]);
      expect(ctx.peer.getConnectionState(), 'connection fatal → blocked').toBe('blocked');
      expect(ctx.wire.hubSideCloseInfo?.code, 'close 1002（§14 协议错误）').toBe(1002);
    } finally {
      await ctx.stop();
    }
  });

  it('负控 N4（SA8 R47 kind=0 不回归）：可分块 live update 仍走 transferKind=0（无绑定块）——单 UPDATE_ACK 锚末 chunk 帧序、收敛', async () => {
    const ctx = await boot({
      limits: { ...LIMITS, maxChunkedUpdateBytes: 64 * 1024, maxSyncDiffBytes: 32 * 1024 },
      initialBlurb: 'seed',
    });
    try {
      await settleUntil(() => ctx.peer.getNamespaceState(ctx.nsId) === 'live', 'peer live');
      await ctx.peerWrite({ blurb: MEDIUM });
      await settleUntil(() => ctx.hubRoot('blurb') === MEDIUM, 'kind=0 分块 live update 收敛');
      await settle();
      const chunks = ctx.chunks('peerToHub');
      expect(chunks.every((c) => c.message.transferKind === 0), 'kind=0 路径不变').toBe(true);
      const shape = expectWellFormedTransfer(chunks, 'kind=0 live transfer');
      expect(shape.totalBytes, '可分块 live update 的 totalBytes = 编码后 update 长度').toBeGreaterThan(
        8 * 1024,
      );
      expect(
        chunks[0]!.message.replicationId === undefined && chunks[0]!.message.syncRoundId === undefined,
        'kind=0 首 chunk 不得携带任何绑定块成员（codec 单形态规则）',
      ).toBe(true);
      const acks = onlyKind(ctx.frames('hubToPeer'), 'UPDATE_ACK');
      expect(acks, 'kind=0 transfer 单 ACK 结算').toHaveLength(1);
      expect(acks[0]!.ackedSequence, 'UPDATE_ACK 锚末 chunk 帧序').toBe(
        chunks[chunks.length - 1]!.sequence,
      );
      expect(ctx.chunks('hubToPeer'), 'hub→peer 方向零 kind=1/2 chunk（本构型无超限载荷）').toHaveLength(0);
      expect(ctx.peer.getConnectionState()).toBe('ready');
    } finally {
      await ctx.stop();
    }
  });
});

/**
 * SA6 验收契约（红灯）—— issue #245（issue #233 切片 4）：分块传输 observer 事件。
 *
 * 授权链：ADR 0013 Observer seam（L83–94，四事件键集冻结）、协议 §23.1 L725（三成功型
 * 为 #245 计划项——本切片不登记为已实现行为）、§23.3/§23.4/§23.7（safe-field / throw
 * 隔离 / 无 observer 逐字节等价 / conformance 增补）、SA8 前置门禁（clear；R20–R23 路由）。
 *
 * 能力缺口（Feature 型——不虚构 Bug 根因）：现行实现中分块 transfer 的成功三面走普通族
 * 事件（update-channel.ts:440 末 chunk noteUpdateSent{末序,总长}；hub-namespace.ts:1192 /
 * peer-namespace.ts:1425 组装 apply 成功发 update-applied；ACK 路径发 update-acked）——
 * chunked-update-sent/applied/acked 三型零实现（grep 全库仅 aborted 族命中）；成功三型
 * 事件不存在、改道未落地。chunked-update-aborted 第 23 型已由切片 3（#244）交付（R20：
 * 本切片范围 = 校验/保持冻结面——见 N4）。
 *
 * 契约形态：
 *  - 红（现实现失败、目标实现转绿）：R1 sent / R2 applied（含互斥规则 AC4）/ R3 acked /
 *    R4 hub→peer 方向镜像 / R5 时钟在场 latency ≥ 0（AC3 后半）。
 *  - 绿负控（现实现通过、实现轮不得误伤）：N1 普通 UPDATE 帧族键集逐字节不变（append-only
 *    边界，R21）；N2 无 observer 分块 transfer = 零时钟调用 + 收敛（AC3 前半）；N3 每事件
 *    必 throw 与无 observer 基线逐字节等价（AC2）；N4 aborted 键集/六 reason 闭集/恰一
 *    计数不变量回归（AC5/AC1，已交付面保持）；N5 degraded × chunked 互斥单事件（AC4 +
 *    SA8 R23 缺省裁决：每笔成功 apply 恰一事件）。
 *
 * 纪律：真实 yjs / Registry / Runtime；fake-duplex + fake scheduler（advanceBy 虚拟时间，
 * 零 real sleep）；零源码 grep 断言；无 skip/only/todo；断言只观测运行时事件对象/帧/文档
 * 行为，绝不引用未实现生产类型（三成功型期望以本地冻结键集字面量表达——契约 tsc 干净）。
 * 生产代码零改动。
 */
import { describe, expect, it } from 'vitest';
import {
  createHubReplication,
  createPeerReplication,
  type DuplexTransport,
  type HubReplication,
  type PeerReplication,
  type ReplicationClock,
  type ReplicationLimits,
  type ReplicationObserver,
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
  FIXED_MS,
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
    id: `issue245-ac-red-${tag}`,
    // text 含高熵哨兵串：事件 JSON.stringify 深扫必须零出现（§23.3 内容禁止项）
    text: `type ROOT = { n: number; blurb: string; }; // SENTINEL_SCHEMA_TEXT_245_${tag}\n`,
  };
}

/** 契约同款极限构型（显式表达的全为既有键——不激活额外链，N5 边界内）。 */
const LIMITS: Readonly<Partial<ReplicationLimits>> = {
  maxUpdateBytes: 8 * 1024,
  maxQueuedUpdateCount: 100,
  maxQueuedUpdateBytes: 1 * 1024 * 1024,
  maxInFlightUpdates: 8,
};

const TIMEOUTS: Readonly<Partial<ReplicationTimeouts>> = {
  ackTimeoutMs: 60_000,
};

/** 大写（编码后 ≈20,029B > maxUpdateBytes 8KiB → 3 chunk；与 #243/#244 套件同构）。 */
const BIG = 'z'.repeat(20_000);

/** 限内小写（单 UPDATE 帧——普通族回归面 N1）。 */
const SMALL = `small-${'x'.repeat(200)}`;

/** 背压闸门高度：> 缺省 highWater 512KiB（data 暂停、control 照流）。 */
const GATE_HIGH = 600 * 1024;

type ChunkMsg = Extract<DecodedMessage['message'], { kind: 'UPDATE_CHUNK' }>;
type AckMsg = Extract<DecodedMessage['message'], { kind: 'UPDATE_ACK' }>;

function decodeWire(bytes: Uint8Array): DecodedMessage {
  return decodeMessage(bytes, { selectedCapabilities: CAP_CHUNKED_UPDATE });
}

// ═══════════════════════════ 运行时事件观测（不引用未实现生产类型） ═══════════════════════════

/** 观测事件 = 运行时对象（键集冻结断言以本地字面量表达——不引用未实现判别联合成员）。 */
type ContractEvent = Readonly<Record<string, unknown>> & { readonly type: string };

/** 计数时钟（零观测调用断言 + latency ≥ 0 断言共用）。 */
class CountingClock implements ReplicationClock {
  calls = 0;
  now(): number {
    this.calls += 1;
    return FIXED_MS;
  }
}

function makeCollector(): { events: ContractEvent[]; observer: ReplicationObserver } {
  const events: ContractEvent[] = [];
  return {
    events,
    observer: (event): void => {
      events.push(event as unknown as ContractEvent);
    },
  };
}

/** 破坏性 observer：先记录后必 throw（throw 必须被隔离——事件流不熔断、协议零影响）。 */
function makeThrowingCollector(): { events: ContractEvent[]; observer: ReplicationObserver } {
  const events: ContractEvent[] = [];
  return {
    events,
    observer: (event): void => {
      events.push(event as unknown as ContractEvent);
      throw new Error('issue245-observer-boom');
    },
  };
}

function ofType(events: readonly ContractEvent[], type: string): ContractEvent[] {
  return events.filter((e) => e.type === type);
}

function isPlainNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function expectNumber(value: unknown, what: string): void {
  expect(isPlainNumber(value), `${what} 必须是有限数值，实际 ${String(value)}`).toBe(true);
}

function expectSafeId(value: unknown, what: string): void {
  expect(typeof value === 'string' && /^ns-[0-9a-f]{32}$/.test(value), `${what} 必须符合 ns-<32hex>`).toBe(
    true,
  );
}

function expectConnectionId(value: unknown, what: string): void {
  expect(
    typeof value === 'string' && value.length > 0 && value.includes('-conn-'),
    `${what} 必须是协议 §6.2 observability id（受控标识）`,
  ).toBe(true);
}

function expectKeysExactly(event: ContractEvent, expected: readonly string[], what: string): void {
  expect(Object.keys(event).sort(), `${what} 键集必须逐字冻结（无多余/缺失键）：${expected.join('/')}`).toEqual(
    [...expected].sort(),
  );
}

// ═══════════════════════════ 冻结键集（ADR 0013 L89–92 + §23 信封；append-only 冻结面） ═══════════════════════════

/** 域键集（含信封 type/side；connectionId 握手后在场——分块 transfer 结构性仅在握手后）。 */
const SENT_KEYS = ['type', 'side', 'connectionId', 'namespaceId', 'transferId', 'chunkCount', 'totalBytes'];
const APPLIED_KEYS = ['type', 'side', 'connectionId', 'namespaceId', 'bytes', 'chunkCount'];
const ACKED_KEYS = ['type', 'side', 'connectionId', 'namespaceId', 'bytes'];
const ABORTED_KEYS = [
  'type',
  'side',
  'namespaceId',
  'transferId',
  'reason',
  'receivedChunks',
  'receivedBytes',
];
const ABORT_REASONS: readonly string[] = [
  'timeout',
  'shed',
  'resync-declared',
  'channel-teardown',
  'connection-teardown',
  'epoch-fence',
];
/** apply 成功路径互斥四形态（AC4：每笔成功 apply 恰一事件）。 */
const APPLY_FORM_TYPES: readonly string[] = [
  'update-applied',
  'sync-diff-applied',
  'degraded-bypass-applied',
  'chunked-update-applied',
];
const CHUNKED_TYPES: readonly string[] = [
  'chunked-update-sent',
  'chunked-update-applied',
  'chunked-update-acked',
  'chunked-update-aborted',
];

// ═══════════════════════════ data 闸门代理（transport seam；可控逐帧放行） ═══════════════════════════

export interface GateControls {
  /** 计数模式：接下来第 N 个 data 帧出站后自动暂停（并进入 drip 模式）。 */
  arm(pauseAfterDataFrames: number): void;
  /** drip 模式下放行恰好一个 data 帧（该帧出站后自动再暂停）。 */
  drip(): void;
  /** 永久放行（解除一切暂停与计数）。 */
  release(): void;
}

/** 可控 data 闸门（#244 SA7 套件同款构型）：bufferedAmount 抬高 → 发送方背压暂停
 *  （control 不受水位门）；drip() 每次恰好放行一个 data 帧——分块时序的确定性构造。 */
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

// ═══════════════════════════ 本地组装（双端闸门；observer/clock 可注入） ═══════════════════════════

interface Ctx {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly nsId: string;
  readonly hubEvents: ContractEvent[];
  readonly peerEvents: ContractEvent[];
  readonly hubClock: CountingClock | undefined;
  readonly peerClock: CountingClock | undefined;
  readonly wires: Wire[];
  readonly hubGates: GateControls[];
  readonly peerGates: GateControls[];
  peerWrite(value: Readonly<{ n?: number; blurb?: string }>): Promise<void>;
  hubWrite(value: Readonly<{ n?: number; blurb?: string }>): Promise<void>;
  rootValue(side: 'hub' | 'peer', key: 'blurb' | 'n'): unknown;
  saveCount(side: 'hub' | 'peer'): number;
  frames(dir: 'peerToHub' | 'hubToPeer'): DecodedMessage[];
  chunks(dir: 'peerToHub' | 'hubToPeer'): ChunkMsg[];
  ackFrames(dir: 'peerToHub' | 'hubToPeer'): AckMsg[];
  errorCodes(dir: 'peerToHub' | 'hubToPeer'): string[];
  resyncReasons(dir: 'peerToHub' | 'hubToPeer'): string[];
  /** 以对端（peer）名义注入一帧（确定性 wire 构造；序列 = 下一出站序）。 */
  injectPeer(message: { kind: 'RESYNC_REQUIRED'; namespaceId: string; reasonCode: string }): void;
  namespaceState(): string;
  connectionState(): string;
  advance(ms: number): Promise<void>;
}

async function boot(opts: {
  /** undefined = 装配收集器 observer；null = 显式无 observer（零事件基线）。 */
  hubObserver?: ReplicationObserver | null;
  peerObserver?: ReplicationObserver | null;
  hubClock?: ReplicationClock;
  peerClock?: ReplicationClock;
  /** peer persistence 置 degraded（N5：hub→peer 分块下行互斥面）。 */
  degradePeer?: boolean;
}): Promise<Ctx> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const lease = okLease(
    await hubNode.registry.create({
      owner: HUB_OWNER,
      schema: schemaOf('a'),
      root: { n: 1, blurb: 'seed' },
    }),
  );
  await schemaReady(lease);
  const enabled = await lease.enableReplication();
  if (!enabled.ok) throw new Error(`enableReplication 失败：${JSON.stringify(enabled)}`);
  const nsId = lease.namespaceId;

  const hubEvents = makeCollector();
  const peerEvents = makeCollector();
  const hubClock = opts.hubClock === undefined ? undefined : opts.hubClock;
  const peerClock = opts.peerClock === undefined ? undefined : opts.peerClock;
  const wires: Wire[] = [];
  const hubGates: GateControls[] = [];
  const peerGates: GateControls[] = [];
  // exactOptionalPropertyTypes：observer 缺省（null）时必须整键缺省，不得携带 undefined
  const hubObserverField =
    opts.hubObserver === undefined
      ? { observer: hubEvents.observer }
      : opts.hubObserver === null
        ? {}
        : { observer: opts.hubObserver };
  const peerObserverField =
    opts.peerObserver === undefined
      ? { observer: peerEvents.observer }
      : opts.peerObserver === null
        ? {}
        : { observer: opts.peerObserver };

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
    ...hubObserverField,
    ...(hubClock === undefined ? {} : { clock: hubClock }),
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
    targets: [{ namespaceId: nsId, localOwner: PEER_OWNER }],
    limits: LIMITS,
    timeouts: TIMEOUTS,
    ...peerObserverField,
    ...(peerClock === undefined ? {} : { clock: peerClock }),
    chunkedUpdate: true,
  });

  peer.start();
  await settleUntil(() => peer.getConnectionState() === 'ready', '连接 ready');
  await settleUntil(() => peer.getNamespaceState(nsId) === 'live', `ns live`);
  await settle();

  if (opts.degradePeer === true) {
    peerNode.persistence.setStatus(PEER_OWNER, nsId, 'persistence-degraded');
    await settle();
  }

  const businessWrite = async (
    node: ReplicaNode,
    owner: typeof HUB_OWNER,
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

  const decodeList = (dir: 'peerToHub' | 'hubToPeer'): DecodedMessage[] => {
    const wire = wires[wires.length - 1]!;
    return (dir === 'peerToHub' ? wire.peerToHub : wire.hubToPeer).map((bytes) => decodeWire(bytes));
  };

  return {
    hubNode,
    peerNode,
    hub,
    peer,
    nsId,
    hubEvents: hubEvents.events,
    peerEvents: peerEvents.events,
    hubClock: hubClock instanceof CountingClock ? hubClock : undefined,
    peerClock: peerClock instanceof CountingClock ? peerClock : undefined,
    wires,
    hubGates,
    peerGates,
    peerWrite: (value) => businessWrite(peerNode, PEER_OWNER, value),
    hubWrite: (value) => businessWrite(hubNode, HUB_OWNER, value),
    rootValue: (side, key) => {
      const node = side === 'hub' ? hubNode : peerNode;
      const owner = side === 'hub' ? HUB_OWNER : PEER_OWNER;
      const doc = node.persistence.peek(owner, nsId);
      if (doc === undefined) throw new Error(`${side} 缺副本`);
      return (doc.getMap('ROOT') as unknown as Map<string, unknown>).get(key);
    },
    saveCount: (side) => {
      const node = side === 'hub' ? hubNode : peerNode;
      return node.persistence.saveEvents.filter((e) => e.docId === nsId).length;
    },
    frames: (dir) => decodeList(dir),
    chunks: (dir) => {
      const out: ChunkMsg[] = [];
      for (const f of decodeList(dir)) {
        if (f.message.kind === 'UPDATE_CHUNK') {
          out.push(f.message as ChunkMsg);
        }
      }
      return out;
    },
    ackFrames: (dir) => {
      const out: AckMsg[] = [];
      for (const f of decodeList(dir)) {
        if (f.message.kind === 'UPDATE_ACK') out.push(f.message as AckMsg);
      }
      return out;
    },
    errorCodes: (dir) =>
      decodeList(dir)
        .filter((f) => f.message.kind === 'ERROR')
        .map((f) => (f.message as { code: string }).code),
    resyncReasons: (dir) =>
      decodeList(dir)
        .filter((f) => f.message.kind === 'RESYNC_REQUIRED')
        .map((f) => (f.message as { reasonCode: string }).reasonCode),
    injectPeer: (message) => {
      const wire = wires[wires.length - 1]!;
      const nextSeq =
        wire.peerToHub.reduce((max, bytes) => Math.max(max, decodeWire(bytes).header.sequence), 0) + 1;
      wire.peerEnd.send(
        encodeMessage(message as unknown as Parameters<typeof encodeMessage>[0], { sequence: nextSeq }),
      );
    },
    namespaceState: () => peer.getNamespaceState(nsId) ?? 'unknown',
    connectionState: () => peer.getConnectionState(),
    advance: async (ms) => {
      await peerNode.scheduler.advanceBy(ms);
      await hubNode.scheduler.advanceBy(ms);
      await settle();
    },
  };
}

/** 整笔分块 transfer 收敛等待（以收敛为终止；随后钉零违例 + 零 failed）。 */
async function awaitChunkedConvergence(ctx: Ctx, side: 'hub' | 'peer', label: string): Promise<void> {
  await settleUntil(() => ctx.rootValue(side, 'blurb') === BIG, `${label}：整笔分块 transfer 必须收敛`);
  await settle();
}

/** 完成一笔 peer→hub 分块 transfer（不做事件断言；返回 wire 观测）。 */
async function completePeerToHub(ctx: Ctx): Promise<{ chunks: ChunkMsg[]; lastChunkSeq: number }> {
  await ctx.peerWrite({ blurb: BIG });
  await settleUntil(
    () => ctx.rootValue('hub', 'blurb') === BIG && ctx.ackFrames('hubToPeer').length === 1,
    'peer→hub 分块收敛 + 单 ACK',
  );
  await settle();
  const chunks = ctx.chunks('peerToHub');
  const chunkSeq = ctx
    .frames('peerToHub')
    .filter((f) => f.message.kind === 'UPDATE_CHUNK')
    .map((f) => f.header.sequence);
  expect(chunks.length, '场景自检：必须真实多 chunk 分块').toBeGreaterThanOrEqual(2);
  expect(new Set(chunks.map((c) => c.transferId)).size, '场景自检：单 transferId').toBe(1);
  return { chunks, lastChunkSeq: chunkSeq[chunkSeq.length - 1]! };
}

// ═══════════════════════════ safe-field / 键集深扫辅助 ═══════════════════════════

/** §23.7 哨兵深扫：事件树零 Yjs bytes/ArrayBuffer/DataView/Error，值域只允许
 *  primitive/普通对象/数组（JSON.stringify 无标记物由调用方以哨兵串断言）。 */
function sweepEvent(value: unknown, path: string): void {
  if (value === null) return;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'undefined') return;
  if (t === 'object') {
    if (value instanceof Uint8Array || value instanceof ArrayBuffer || value instanceof DataView) {
      throw new Error(`safe-field 违例：${path} 含 Yjs bytes 二进制对象`);
    }
    if (value instanceof Error) throw new Error(`safe-field 违例：${path} 含 Error（异常原文禁携）`);
    if (Array.isArray(value)) {
      value.forEach((item, index) => sweepEvent(item, `${path}[${index}]`));
      return;
    }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      sweepEvent(v, `${path}.${k}`);
    }
    return;
  }
  throw new Error(`safe-field 违例：${path} 含非常规值 ${t}`);
}

function sweepAll(events: readonly ContractEvent[], label: string): void {
  for (const event of events) sweepEvent(event, `${label}:${event.type}`);
}

/** 断言全部观测事件的 JSON 序列化不含任何植入哨兵（token / schema 文本 / 内容前缀）。 */
function assertNoSentinels(events: readonly ContractEvent[], label: string): void {
  const serialized = JSON.stringify(events);
  const sentinels: ReadonlyArray<readonly [string, string]> = [
    [TEST_TOKEN, 'token 值'],
    ['SENTINEL_SCHEMA_TEXT_245', 'SCHEMA 文本内容'],
    ['z'.repeat(64), 'ROOT 大内容前缀'],
    ['issue245-ac-red', 'schema id'],
  ];
  for (const [marker, what] of sentinels) {
    expect(serialized.includes(marker), `${label}：事件 JSON 不得含 ${what} 标记物`).toBe(false);
  }
}

// ═══════════════════════════ 契约用例 ═══════════════════════════

describe('issue #245 验收契约：分块传输 observer 事件（红 = 三成功型能力缺口；绿 = 负控与已交付面回归）', () => {
  // ───────────────────────────────────────── 绿负控 N1：普通族键集逐字节不变（R21 边界） ─────────────────────────────────────────

  it('绿 N1（AC 互斥边界/R21）：协商连接上限内 UPDATE 仍走普通族——update-sent/applied/acked 键集逐字不变、零 chunked-update-*、零 UPDATE_CHUNK 帧', async () => {
    const ctx = await boot({});
    try {
      await ctx.peerWrite({ blurb: SMALL });
      await settleUntil(
        () => ctx.rootValue('hub', 'blurb') === SMALL && ctx.ackFrames('hubToPeer').length === 1,
        '限内 update 单帧收敛',
      );
      await settleUntil(() => ofType(ctx.peerEvents, 'update-acked').length >= 1, 'peer 收到 ACK 事件');
      await settle();

      expect(ctx.chunks('peerToHub'), '限内 update 零 UPDATE_CHUNK 帧').toHaveLength(0);
      const updateFrames = ctx.frames('peerToHub').filter((f) => f.message.kind === 'UPDATE');
      expect(updateFrames, '限内 update 恰一 UPDATE 帧').toHaveLength(1);
      const frameBytes = (updateFrames[0]!.message as { update: Uint8Array }).update.byteLength;

      // 三事件面闭环（#238 关联键）：sent/applied/acked 同一 sequence + bytes === 帧载荷长
      const sent = ofType(ctx.peerEvents, 'update-sent');
      const applied = ofType(ctx.hubEvents, 'update-applied');
      const acked = ofType(ctx.peerEvents, 'update-acked');
      expect(sent, '限内 update 恰一 update-sent').toHaveLength(1);
      expect(applied, '限内 update 恰一 update-applied').toHaveLength(1);
      expect(acked, '限内 update 恰一 update-acked').toHaveLength(1);
      expectKeysExactly(sent[0]!, ['type', 'side', 'connectionId', 'namespaceId', 'bytes', 'sequence'], 'update-sent');
      expectKeysExactly(applied[0]!, ['type', 'side', 'connectionId', 'namespaceId', 'bytes', 'sequence'], 'update-applied');
      expectKeysExactly(acked[0]!, ['type', 'side', 'connectionId', 'namespaceId', 'bytes', 'sequence'], 'update-acked');
      expect(sent[0]!.side, 'sent side').toBe('peer');
      expect(applied[0]!.side, 'applied side').toBe('hub');
      expect(acked[0]!.side, 'acked side').toBe('peer');
      expect(sent[0]!.namespaceId).toBe(ctx.nsId);
      expectNumber(sent[0]!.bytes, 'update-sent.bytes');
      expect(sent[0]!.bytes).toBe(frameBytes);
      expect(applied[0]!.bytes).toBe(frameBytes);
      expect(acked[0]!.bytes).toBe(frameBytes);
      expectNumber(sent[0]!.sequence, 'update-sent.sequence');
      expect(applied[0]!.sequence).toBe(sent[0]!.sequence);
      expect(acked[0]!.sequence).toBe(sent[0]!.sequence);
      // 无 clock → latency 字段缺失（field 缺失非 undefined；exact keyset 已锁）
      expect(ctx.hubClock, '场景自检：无 clock').toBeUndefined();
      // 分块族四型零事件（改道边界：普通帧不得误报 chunked 族）
      for (const type of CHUNKED_TYPES) {
        expect(ofType(ctx.hubEvents, type), `hub 零 ${type}`).toHaveLength(0);
        expect(ofType(ctx.peerEvents, type), `peer 零 ${type}`).toHaveLength(0);
      }
      // safe-field 哨兵深扫（全部事件）
      sweepAll([...ctx.hubEvents, ...ctx.peerEvents], 'N1');
      assertNoSentinels([...ctx.hubEvents, ...ctx.peerEvents], 'N1');
      expect(ctx.namespaceState(), 'ns 保持 live').toBe('live');
      expect(ctx.connectionState(), '连接保持 ready').toBe('ready');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  // ───────────────────────────────────────── 绿负控 N2：无 observer = 零事件零时钟零采样 ─────────────────────────────────────────

  it('绿 N2（AC3 前半）：无 observer 的分块 transfer——零时钟调用、文档收敛、整笔恰一 apply 结算', async () => {
    const hubClock = new CountingClock();
    const peerClock = new CountingClock();
    const ctx = await boot({ hubObserver: null, peerObserver: null, hubClock, peerClock });
    try {
      const savesBefore = ctx.saveCount('hub');
      await completePeerToHub(ctx);
      await awaitChunkedConvergence(ctx, 'hub', 'N2 no-observer 收敛');
      expect(ctx.rootValue('hub', 'blurb'), 'hub 收敛整值').toBe(BIG);
      expect(ctx.saveCount('hub') - savesBefore, '整笔恰一次 apply → dirty 恰一').toBe(1);
      expect(ctx.ackFrames('hubToPeer'), '单 ACK').toHaveLength(1);
      expect(ctx.errorCodes('hubToPeer'), '零 ERROR').toHaveLength(0);
      expect(ctx.resyncReasons('hubToPeer'), '零 RESYNC').toHaveLength(0);
      expect(ctx.namespaceState(), 'ns 保持 live').toBe('live');
      // 停止后零时钟调用仍成立（收口路径同样零采样——观测面缺省纪律覆盖全生命周期）
      await ctx.peer.stop().catch(() => undefined);
      await settle();
      expect(ctx.hubClock!.calls, '零 observer ⇒ hub 全程零时钟调用（含收口）').toBe(0);
      expect(ctx.peerClock!.calls, '零 observer ⇒ peer 全程零时钟调用（含收口）').toBe(0);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  // ───────────────────────────────────────── 绿负控 N3：observer 每事件必 throw 隔离（AC2） ─────────────────────────────────────────

  it('绿 N3（AC2）：分块 transfer 中 observer 每事件必 throw——wire 语义序列/终态/文档内容/apply 结算与无 observer 基线全等', async () => {
    // 基线运行（无 observer）与破坏运行（每事件必 throw）为两棵独立 fixture（同一代码路径）。
    const baseCtx = await boot({ hubObserver: null, peerObserver: null });
    let baseDigest: { peerToHub: string[]; hubToPeer: string[] } | undefined;
    let baseSavesHub = 0;
    let baseRootHub: unknown;
    let baseRootPeer: unknown;
    try {
      await completePeerToHub(baseCtx);
      await awaitChunkedConvergence(baseCtx, 'hub', 'N3 基线收敛');
      // wire 语义摘要 = kind#sequence（§23.7 惯例：payload 含随机 doc client id——逐字节
      // 跨运行不可比；帧语义/计数/序全等 + 终态文档内容全等共同构成「观测零 wire 扰动」）
      const digestOf = (dir: 'peerToHub' | 'hubToPeer'): string[] =>
        baseCtx.frames(dir).map((f) => `${f.message.kind}#${f.header.sequence}`);
      baseDigest = { peerToHub: digestOf('peerToHub'), hubToPeer: digestOf('hubToPeer') };
      baseSavesHub = baseCtx.saveCount('hub');
      baseRootHub = baseCtx.rootValue('hub', 'blurb');
      baseRootPeer = baseCtx.rootValue('peer', 'blurb');
    } finally {
      await baseCtx.peer.stop().catch(() => undefined);
    }

    const throwingHub = makeThrowingCollector();
    const throwingPeer = makeThrowingCollector();
    const boomCtx = await boot({ hubObserver: throwingHub.observer, peerObserver: throwingPeer.observer });
    try {
      await completePeerToHub(boomCtx);
      await awaitChunkedConvergence(boomCtx, 'hub', 'N3 破坏 observer 收敛');
      await settle();

      // throw 被隔离：事件流不熔断（破坏运行仍投递了普通族事件——目标实现轮将扩展至
      // 三成功型，同样必须被隔离投递）
      expect(throwingHub.events.length, 'hub 破坏运行事件流非空').toBeGreaterThan(0);
      expect(throwingPeer.events.length, 'peer 破坏运行事件流非空').toBeGreaterThan(0);
      // 终态/文档内容/结算全等
      expect(boomCtx.namespaceState(), '破坏运行 ns 终态 live').toBe('live');
      expect(boomCtx.connectionState(), '破坏运行连接 ready').toBe('ready');
      expect(boomCtx.rootValue('hub', 'blurb'), '破坏运行文档内容 = 基线').toBe(baseRootHub);
      expect(boomCtx.rootValue('peer', 'blurb'), '破坏运行 peer 文档 = 基线').toBe(baseRootPeer);
      expect(boomCtx.saveCount('hub'), 'apply 结算（dirty 计数）= 基线').toBe(baseSavesHub);
      expect(boomCtx.errorCodes('hubToPeer'), '破坏运行零 ERROR').toHaveLength(0);
      // wire 语义序列全等（§23.7 惯例：观测零 wire 扰动）
      const boomDigest = {
        peerToHub: boomCtx.frames('peerToHub').map((f) => `${f.message.kind}#${f.header.sequence}`),
        hubToPeer: boomCtx.frames('hubToPeer').map((f) => `${f.message.kind}#${f.header.sequence}`),
      };
      expect(boomDigest.peerToHub, 'peer→hub wire 语义序列 = 基线').toEqual(baseDigest!.peerToHub);
      expect(boomDigest.hubToPeer, 'hub→peer wire 语义序列 = 基线').toEqual(baseDigest!.hubToPeer);
    } finally {
      await boomCtx.peer.stop().catch(() => undefined);
    }
  });

  // ───────────────────────────────────────── 绿负控 N4：aborted 键集/闭集/恰一回归（R20 已交付面） ─────────────────────────────────────────

  it('绿 N4（AC5/AC1 回归）：busy assembly 中收对端 RESYNC（resync-declared 行）——chunked-update-aborted 键集逐字冻结、reason ∈ 六值闭集、每笔中止恰一事件、零成功型事件、零部分写入/零 durable', async () => {
    const ctx = await boot({});
    try {
      ctx.peerGates[0]!.arm(1);
      await ctx.peerWrite({ blurb: BIG });
      await settle();
      const chunk0 = ctx.chunks('peerToHub');
      expect(chunk0, 'chunk0 已出站——hub busy assembly').toHaveLength(1);
      expect(ctx.rootValue('hub', 'blurb'), '中止前零部分写入').toBe('seed');
      const savesBefore = ctx.saveCount('hub');

      // 对端声明边（确定性 wire 构造：以 peer 名义注入 RESYNC_REQUIRED）→ hub 弃 partial
      ctx.injectPeer({ kind: 'RESYNC_REQUIRED', namespaceId: ctx.nsId, reasonCode: 'send-queue-overflow' });
      await settle();
      await settle();

      const aborted = ofType(ctx.hubEvents, 'chunked-update-aborted');
      expect(aborted, 'resync-declared 中止事件恰一（busy 守卫计数不变量）').toHaveLength(1);
      expectKeysExactly(aborted[0]!, ABORTED_KEYS, 'chunked-update-aborted（含 side 信封；无 connectionId——ADR L92 域键集）');
      expect(aborted[0]!.side, '发射端 = 丢弃 partial 的接收方（hub）').toBe('hub');
      expectSafeId(aborted[0]!.namespaceId, 'aborted.namespaceId');
      expect(aborted[0]!.namespaceId).toBe(ctx.nsId);
      expectNumber(aborted[0]!.transferId, 'aborted.transferId');
      expect(aborted[0]!.transferId).toBe(chunk0[0]!.transferId);
      expect(aborted[0]!.reason, 'reason 必须 ∈ 六值闭集').toBe('resync-declared');
      expect(ABORT_REASONS, '闭集成员').toContain(aborted[0]!.reason);
      expectNumber(aborted[0]!.receivedChunks, 'aborted.receivedChunks');
      expect(aborted[0]!.receivedChunks).toBe(1);
      expectNumber(aborted[0]!.receivedBytes, 'aborted.receivedBytes');
      expect(aborted[0]!.receivedBytes).toBe(chunk0[0]!.bytes.byteLength);
      expect(ctx.rootValue('hub', 'blurb'), '弃 partial 后零部分写入').toBe('seed');
      expect(ctx.saveCount('hub'), '零 durable 写入').toBe(savesBefore);
      expect(ctx.errorCodes('hubToPeer'), 'resync-declared 行零 ERROR 帧').toHaveLength(0);
      expect(ofType(ctx.hubEvents, 'namespace-failed'), '软收口不得终局 failed').toHaveLength(0);

      // 中止的 transfer 不得产生任何成功型事件（发送侧未到末 chunk 出站、接收侧未 apply）
      for (const type of ['chunked-update-sent', 'chunked-update-applied', 'chunked-update-acked'] as const) {
        expect(ofType(ctx.hubEvents, type), `hub 零 ${type}`).toHaveLength(0);
        expect(ofType(ctx.peerEvents, type), `peer 零 ${type}`).toHaveLength(0);
      }
      expect(ofType(ctx.hubEvents, 'chunked-update-aborted'), '中止事件不重复').toHaveLength(1);
      // safe-field：aborted 事件哨兵深扫
      sweepAll(aborted, 'N4');
      assertNoSentinels(aborted, 'N4');

      // 残渣语义：放行残余 chunk1/2 → hub 已 needs-resync 且 idle → 良性丢弃（F3，零违例）
      ctx.peerGates[0]!.release();
      await ctx.advance(2_000);
      expect(
        ctx.errorCodes('hubToPeer').filter((c) => c === 'UPDATE_TRANSFER_VIOLATION'),
        'needs-resync 域残渣 chunk 必须良性丢弃（零 VIOLATION）',
      ).toHaveLength(0);
      expect(ofType(ctx.hubEvents, 'namespace-failed'), '残渣丢弃后仍零 failed').toHaveLength(0);
      expect(ofType(ctx.peerEvents, 'namespace-failed'), 'peer 零 failed').toHaveLength(0);
      expect(ctx.rootValue('hub', 'blurb'), '残渣不得被 apply').toBe('seed');
      expect(ctx.saveCount('hub'), '残渣零 durable').toBe(savesBefore);
      expect(ofType(ctx.hubEvents, 'chunked-update-aborted'), '全程中止事件仍恰一').toHaveLength(1);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  // ───────────────────────────────────────── 绿负控 N5：degraded × chunked 互斥（R23 缺省裁决） ─────────────────────────────────────────

  it('绿 N5（AC4 + SA8 R23）：peer degraded 窗口内 hub→peer 分块 apply——每笔成功 apply 恰一事件（现 = degraded-bypass-applied 单事件；互斥四形态零双发）', async () => {
    const ctx = await boot({ degradePeer: true });
    try {
      // boot 期（live 前）存在恢复 round 的 sync-diff-applied——互斥计数必须取窗口增量
      const formsBefore = ctx.peerEvents.filter((e) => APPLY_FORM_TYPES.includes(e.type)).length;
      const hubChunkCountBefore = ctx.chunks('hubToPeer').length;
      await ctx.hubWrite({ blurb: BIG });
      await settleUntil(
        () => ctx.rootValue('peer', 'blurb') === BIG && ctx.ackFrames('peerToHub').length === 1,
        'degraded 窗口分块下行收敛 + 单 ACK 回程',
      );
      await settle();
      const hubChunks = ctx.chunks('hubToPeer').slice(hubChunkCountBefore);
      expect(hubChunks.length, '场景自检：真实分块下行').toBeGreaterThanOrEqual(2);

      // 互斥四形态：degraded 窗口每笔成功 apply 恰一增量事件（当前唯一 = degraded-bypass-applied；
      // 实现轮若加 chunked 族成功型必须维持恰一、不得双发）
      const formsAfter = ctx.peerEvents.filter((e) => APPLY_FORM_TYPES.includes(e.type));
      expect(formsAfter.length - formsBefore, 'degraded 分块 apply 恰一互斥事件增量').toBe(1);
      const deltaForm = formsAfter[formsAfter.length - 1]!;
      expect(deltaForm.type, 'degraded 判别胜出（R23 缺省裁决）').toBe('degraded-bypass-applied');
      expectKeysExactly(deltaForm, ['type', 'side', 'connectionId', 'namespaceId', 'bytes', 'sequence'], 'degraded-bypass-applied');
      expect(deltaForm.side).toBe('peer');
      expectNumber(deltaForm.bytes, 'degraded-bypass-applied.bytes');
      expect(deltaForm.bytes).toBe(hubChunks[0]!.totalBytes);
      expectNumber(deltaForm.sequence, 'degraded-bypass-applied.sequence');
      const newApplied = ctx.peerEvents.filter(
        (e) => e.type === 'update-applied' || e.type === 'chunked-update-applied',
      );
      expect(newApplied, 'degraded 窗口零 update-applied / chunked-update-applied（互斥负向半边）').toHaveLength(0);
      // 中止/双发负向断言（issue #245 目标语义对齐，实现轮 facilitation——见 §12 N5 语义：
      // 互斥规则辖 apply 形态 [AC4/R23]，不含发送侧结算）：本笔 transfer 完整收敛 → 零
      // aborted；接收侧（peer）零 chunked 成功型（apply 走 degraded-bypass-applied 胜出，
      // 第四形态零双发——上方 apply-form 增量恰一已证）；发送侧（hub）的 chunked-update-sent/
      // acked 恰一 = R4 同构镜像（degraded 只影响接收侧 apply 形态判别，不影响发送侧改道
      // [R21]——红 R4 在无 degraded 同构几何下断言同一形状；旧全型零断言系改道前的
      // 平凡真值，目标语义下与 R4 结构性互斥，故按本文件自身目标形状收窄）。
      expect(ofType(ctx.hubEvents, 'chunked-update-aborted'), 'hub 零 chunked-update-aborted（transfer 完整收敛）').toHaveLength(0);
      expect(ofType(ctx.peerEvents, 'chunked-update-aborted'), 'peer 零 chunked-update-aborted').toHaveLength(0);
      for (const type of ['chunked-update-sent', 'chunked-update-applied', 'chunked-update-acked'] as const) {
        expect(ofType(ctx.peerEvents, type), `接收侧 peer 零 ${type}`).toHaveLength(0);
      }
      expect(ofType(ctx.hubEvents, 'chunked-update-sent'), 'hub 分块下行 chunked-update-sent 恰一（发送侧改道正常）').toHaveLength(1);
      expect(ofType(ctx.hubEvents, 'chunked-update-acked'), 'hub 分块下行 chunked-update-acked 恰一（ACK 回程正常）').toHaveLength(1);
      // 事件安全面
      sweepAll([...ctx.hubEvents, ...ctx.peerEvents], 'N5');
      assertNoSentinels([...ctx.hubEvents, ...ctx.peerEvents], 'N5');
      expect(ctx.namespaceState(), 'ns 保持 live').toBe('live');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  // ───────────────────────────────────────── 红 R1：chunked-update-sent（完成出站恰一，非逐 chunk） ─────────────────────────────────────────

  it('红 R1（AC1/AC2-sent/AC4）：分块 transfer 完成出站时必须恰一发 chunked-update-sent{transferId,chunkCount,totalBytes}——中间 chunk 零发射、普通族零误报', async () => {
    const ctx = await boot({});
    try {
      // 时序相位 1/2：chunk0、chunk1 出站后（transfer 未完成）——零 chunked 事件（非逐 chunk、
      // 非 transfer 起始发射——事件只在完成出站时刻）
      ctx.peerGates[0]!.arm(1);
      await ctx.peerWrite({ blurb: BIG });
      await settle();
      expect(ctx.chunks('peerToHub'), 'chunk0 已出站').toHaveLength(1);
      for (const type of CHUNKED_TYPES) {
        expect(ofType(ctx.peerEvents, type), `chunk0 后 peer 零 ${type}`).toHaveLength(0);
        expect(ofType(ctx.hubEvents, type), `chunk0 后 hub 零 ${type}`).toHaveLength(0);
      }
      ctx.peerGates[0]!.drip();
      await ctx.advance(700);
      expect(ctx.chunks('peerToHub'), 'chunk1 已出站').toHaveLength(2);
      for (const type of CHUNKED_TYPES) {
        expect(ofType(ctx.peerEvents, type), `chunk1 后 peer 零 ${type}`).toHaveLength(0);
        expect(ofType(ctx.hubEvents, type), `chunk1 后 hub 零 ${type}`).toHaveLength(0);
      }

      // 相位 3：放行末 chunk → transfer 完成出站 → 恰一发 chunked-update-sent（目标行为）
      ctx.peerGates[0]!.release();
      await ctx.advance(700);
      await awaitChunkedConvergence(ctx, 'hub', 'R1 收敛');
      const { chunks } = await completePeerToHubGuard(ctx);
      const sent = ofType(ctx.peerEvents, 'chunked-update-sent');
      expect(
        sent.length,
        'AC-sent：transfer 完成出站必须恰一发 chunked-update-sent（当前 0——三成功型事件未实现/改道未落地；中间 chunk 已证零发射）',
      ).toBe(1);
      expectKeysExactly(sent[0]!, SENT_KEYS, 'chunked-update-sent（无 clock：零 latency 键、零 sequence/多余键）');
      expect(sent[0]!.side, '发送侧 side').toBe('peer');
      expect(sent[0]!.namespaceId).toBe(ctx.nsId);
      expectConnectionId(sent[0]!.connectionId, 'chunked-update-sent.connectionId');
      expectNumber(sent[0]!.transferId, 'transferId');
      expectNumber(sent[0]!.chunkCount, 'chunkCount');
      expectNumber(sent[0]!.totalBytes, 'totalBytes');
      expect(sent[0]!.transferId, 'transferId 必须 = wire 首 chunk 申报').toBe(chunks[0]!.transferId);
      expect(sent[0]!.chunkCount, 'chunkCount 必须 = wire 申报').toBe(chunks[0]!.chunkCount);
      expect(sent[0]!.totalBytes, 'totalBytes 必须 = wire 申报').toBe(chunks[0]!.totalBytes);
      expect(ofType(ctx.peerEvents, 'update-sent'), '改道：分块 transfer 零普通族 update-sent').toHaveLength(0);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  // ───────────────────────────────────────── 红 R2：chunked-update-applied + 互斥第四形态 ─────────────────────────────────────────

  it('红 R2（AC4/AC1-applied）：成功分块 apply 必须恰一发 chunked-update-applied 且普通族 update-applied 改道归零——每笔成功 apply 恰一互斥事件（第四形态）', async () => {
    const ctx = await boot({});
    try {
      // boot 期（live 边）存在一次空 diff 恢复 round → hub 已有 sync-diff-applied 基线；
      // 互斥计数取「本笔分块 transfer 窗口」增量
      const formsBefore = ctx.hubEvents.filter((e) => APPLY_FORM_TYPES.includes(e.type)).length;
      await completePeerToHub(ctx);
      await awaitChunkedConvergence(ctx, 'hub', 'R2 收敛');
      const { chunks } = await completePeerToHubGuard(ctx);
      const hubForms = ctx.hubEvents.filter((e) => APPLY_FORM_TYPES.includes(e.type));

      // 互斥不变量（当前已满足半边）：本笔 transfer 窗口恰一 apply-form 增量事件
      expect(
        hubForms.length - formsBefore,
        '每笔成功 apply 恰一互斥事件（现 = update-applied 单发——计数半边已绿）',
      ).toBe(1);
      const applied = ofType(ctx.hubEvents, 'chunked-update-applied');
      expect(
        applied.length,
        'AC4：分块 apply 必须发 chunked-update-applied 恰一（当前 0——仍发 update-applied，第四形态改道未落地）',
      ).toBe(1);
      expectKeysExactly(applied[0]!, APPLIED_KEYS, 'chunked-update-applied（无 clock：零 latency 键）');
      expect(applied[0]!.side, '接收侧 side').toBe('hub');
      expect(applied[0]!.namespaceId).toBe(ctx.nsId);
      expectConnectionId(applied[0]!.connectionId, 'chunked-update-applied.connectionId');
      expectNumber(applied[0]!.bytes, 'bytes');
      expectNumber(applied[0]!.chunkCount, 'chunkCount');
      expect(applied[0]!.bytes, 'bytes 必须 = wire totalBytes（整笔长度）').toBe(chunks[0]!.totalBytes);
      expect(applied[0]!.chunkCount, 'chunkCount 必须 = wire 申报').toBe(chunks[0]!.chunkCount);
      const appliedDelta = hubForms.slice(formsBefore).filter((e) => e.type === 'update-applied');
      expect(appliedDelta, '改道：本笔分块 apply 零普通族 update-applied 增量').toHaveLength(0);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  // ───────────────────────────────────────── 红 R3：chunked-update-acked ─────────────────────────────────────────

  it('红 R3（AC1-acked）：末 chunk ACK 收妥必须恰一发 chunked-update-acked{bytes=totalBytes}——普通族 update-acked 改道归零、sent 先于 acked', async () => {
    const ctx = await boot({});
    try {
      await completePeerToHub(ctx);
      await awaitChunkedConvergence(ctx, 'hub', 'R3 收敛');
      // issue #245 目标语义对齐（实现轮 facilitation，非验收语义变更）：completePeerToHub
      // 已确认 hub→peer ACK 帧上 wire；本行等待 peer 实际处理该 ACK（事件面信号）。改道
      // 落地后该信号从普通族 update-acked 翻转为 chunked-update-acked（本用例下方自身断言
      // 普通族归零——等待旧族即结构性永不满足，红期脚手架锚随目标翻转）。
      await settleUntil(() => ofType(ctx.peerEvents, 'chunked-update-acked').length >= 1, 'peer 收 ACK（目标 chunked 族）');
      await settle();
      const { chunks } = await completePeerToHubGuard(ctx);

      const acked = ofType(ctx.peerEvents, 'chunked-update-acked');
      expect(
        acked.length,
        'AC-acked：末 chunk ACK 收妥必须恰一发 chunked-update-acked（当前 0——仍发 update-acked，改道未落地）',
      ).toBe(1);
      expectKeysExactly(acked[0]!, ACKED_KEYS, 'chunked-update-acked（无 clock：零 latency 键）');
      expect(acked[0]!.side, '发送侧 side').toBe('peer');
      expect(acked[0]!.namespaceId).toBe(ctx.nsId);
      expectConnectionId(acked[0]!.connectionId, 'chunked-update-acked.connectionId');
      expectNumber(acked[0]!.bytes, 'bytes');
      expect(acked[0]!.bytes, 'bytes 必须 = wire totalBytes').toBe(chunks[0]!.totalBytes);
      expect(ofType(ctx.peerEvents, 'update-acked'), '改道：分块 transfer 零普通族 update-acked').toHaveLength(0);
      // 时序：发送侧 sent 先于 acked（sent = 末 chunk 出站时刻；acked = ACK 帧处理时刻）
      const sent = ofType(ctx.peerEvents, 'chunked-update-sent');
      expect(sent, 'sent 前置断言（R1 转绿后恒 1）').toHaveLength(1);
      expect(
        ctx.peerEvents.indexOf(acked[0]!) > ctx.peerEvents.indexOf(sent[0]!),
        '发送侧事件序：chunked-update-sent 必须先于 chunked-update-acked',
      ).toBe(true);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  // ───────────────────────────────────────── 红 R4：hub→peer 方向镜像（side 双侧） ─────────────────────────────────────────

  it('红 R4（AC1-* 方向镜像/side）：hub→peer 分块下行——hub 发 chunked-update-sent/acked、peer 发 chunked-update-applied（当前全 0——双侧改道未落地）', async () => {
    const ctx = await boot({});
    try {
      await ctx.hubWrite({ blurb: BIG });
      await settleUntil(
        () => ctx.rootValue('peer', 'blurb') === BIG && ctx.ackFrames('peerToHub').length === 1,
        'hub→peer 分块收敛 + 单 ACK 回程',
      );
      await settle();
      const chunks = ctx.chunks('hubToPeer');
      expect(chunks.length, '场景自检：真实分块下行').toBeGreaterThanOrEqual(2);

      const hubSent = ofType(ctx.hubEvents, 'chunked-update-sent');
      expect(
        hubSent.length,
        '方向镜像：hub 出站 transfer 完成必须恰一发 chunked-update-sent{side:hub}（当前 0）',
      ).toBe(1);
      expectKeysExactly(hubSent[0]!, SENT_KEYS, 'chunked-update-sent（hub）');
      expect(hubSent[0]!.side).toBe('hub');
      expect(hubSent[0]!.transferId).toBe(chunks[0]!.transferId);
      expect(hubSent[0]!.chunkCount).toBe(chunks[0]!.chunkCount);
      expect(hubSent[0]!.totalBytes).toBe(chunks[0]!.totalBytes);

      const peerApplied = ofType(ctx.peerEvents, 'chunked-update-applied');
      expect(
        peerApplied.length,
        '方向镜像：peer 分块 apply 必须恰一发 chunked-update-applied{side:peer}（当前 0）',
      ).toBe(1);
      expectKeysExactly(peerApplied[0]!, APPLIED_KEYS, 'chunked-update-applied（peer）');
      expect(peerApplied[0]!.side).toBe('peer');
      expect(peerApplied[0]!.bytes).toBe(chunks[0]!.totalBytes);
      expect(peerApplied[0]!.chunkCount).toBe(chunks[0]!.chunkCount);

      const hubAcked = ofType(ctx.hubEvents, 'chunked-update-acked');
      expect(hubAcked.length, '方向镜像：hub 收 ACK 必须恰一发 chunked-update-acked{side:hub}（当前 0）').toBe(1);
      expectKeysExactly(hubAcked[0]!, ACKED_KEYS, 'chunked-update-acked（hub）');
      expect(hubAcked[0]!.side).toBe('hub');
      expect(hubAcked[0]!.bytes).toBe(chunks[0]!.totalBytes);

      // 双侧普通族改道归零
      expect(ofType(ctx.hubEvents, 'update-sent'), 'hub 零普通 update-sent').toHaveLength(0);
      expect(ofType(ctx.hubEvents, 'update-acked'), 'hub 零普通 update-acked').toHaveLength(0);
      expect(ofType(ctx.peerEvents, 'update-applied'), 'peer 零普通 update-applied').toHaveLength(0);
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });

  // ───────────────────────────────────────── 红 R5：时钟在场 latency ≥ 0（AC3 后半） ─────────────────────────────────────────

  it('红 R5（AC3 后半）：注入 clock 的分块 transfer——chunked-update-applied.applyLatencyMs / chunked-update-acked.ackLatencyMs 在场且 ≥ 0（当前事件缺失）', async () => {
    const hubClock = new CountingClock();
    const peerClock = new CountingClock();
    const ctx = await boot({ hubClock, peerClock });
    try {
      await completePeerToHub(ctx);
      await awaitChunkedConvergence(ctx, 'hub', 'R5 收敛');
      await settle();
      const { chunks } = await completePeerToHubGuard(ctx);

      const applied = ofType(ctx.hubEvents, 'chunked-update-applied');
      expect(applied.length, 'AC3：clock 在场时 chunked-update-applied 必须恰一（当前 0）').toBe(1);
      expect(
        Object.prototype.hasOwnProperty.call(applied[0]!, 'applyLatencyMs') &&
          isPlainNumber(applied[0]!.applyLatencyMs) &&
          (applied[0]!.applyLatencyMs as number) >= 0,
        'applyLatencyMs 必须在场且 ≥ 0（clock 注入）',
      ).toBe(true);
      expect(applied[0]!.bytes).toBe(chunks[0]!.totalBytes);

      const acked = ofType(ctx.peerEvents, 'chunked-update-acked');
      expect(acked.length, 'AC3：clock 在场时 chunked-update-acked 必须恰一（当前 0）').toBe(1);
      expect(
        Object.prototype.hasOwnProperty.call(acked[0]!, 'ackLatencyMs') &&
          isPlainNumber(acked[0]!.ackLatencyMs) &&
          (acked[0]!.ackLatencyMs as number) >= 0,
        'ackLatencyMs 必须在场且 ≥ 0（clock 注入）',
      ).toBe(true);
      expect(acked[0]!.bytes).toBe(chunks[0]!.totalBytes);

      // sent 无 latency 字段（键集冻结：chunked-update-sent 无任何差值键）
      const sent = ofType(ctx.peerEvents, 'chunked-update-sent');
      expect(sent.length, 'clock 在场 sent 仍恰一').toBe(1);
      expectKeysExactly(sent[0]!, SENT_KEYS, 'chunked-update-sent（恒无 latency 键）');
    } finally {
      await ctx.peer.stop().catch(() => undefined);
    }
  });
});

/**
 * 完成-收敛守卫：R 系列在释放闸门后再次确认 transfer 已完整（未在闸门相位提前完成——
 * 断言锚的防漂移自检；不做事件断言）。
 */
async function completePeerToHubGuard(ctx: Ctx): Promise<{ chunks: ChunkMsg[] }> {
  const chunks = ctx.chunks('peerToHub');
  expect(new Set(chunks.map((c) => c.chunkCount)).size, '场景自检：单 chunkCount').toBe(1);
  expect(chunks.reduce((s, c) => s + c.bytes.byteLength, 0), '场景自检：Σbytes === totalBytes').toBe(
    chunks[0]!.totalBytes,
  );
  expect(ctx.rootValue('hub', 'blurb'), '场景自检：hub 收敛整值').toBe(BIG);
  return { chunks };
}

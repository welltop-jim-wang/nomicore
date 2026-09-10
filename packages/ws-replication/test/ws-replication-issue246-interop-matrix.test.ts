/**
 * issue #246 实现代际互通矩阵（File B）——ADR 0013 L25 预授权的传输层全组合 conformance
 * 证据；未协商 ⇒ v1 超限行为（丢弃 + needs-resync + reconciliation）逐字节保持。
 *
 * 三格：
 *  - M1 v1 peer ↔ v2 hub：`chunkedUpdate` 缺省（HELLO optionalCapabilities=0）；
 *  - M2 v2 peer ↔ v1 hub：`chunkedUpdate: true` + HELLO capability 剥除 interposer；
 *    M1 全部行为断言逐条复现（**双方向腿**：peer 写腿 + hub 写镜像腿，后者即超限
 *    hub→peer 载荷腿），三层确定性等同比对对象覆盖两方向完整时间线；
 *  - M3 v2 ↔ v2：双方协商 `CAP_CHUNKED_UPDATE` ⇒ 超限 UPDATE 分块 + 单 ACK。
 *
 * 等价性论证（设计 §7.4.1；诚实边界 §7.4.3）：v1 代际端点定义上不含
 * `CAP_CHUNKED_UPDATE`（HELLO 恒发 0、v1 hub 支持集 = ∅）⇒ `selectCapabilities` 交集恒 0；
 * v2 端点全部 chunked 行为（发送与接收）门控于协商位单点。因此任意含 v1 端点的组合
 * 「wire 可见行为 ≡ 双方 selectedCapabilities===0 的 v2↔v2 未协商组合」。M2 以测试本地
 * interposer 在 HELLO 单帧上剥除 peer offered bit，令真实 v2 hub 经自身交集得出 selected=0
 * ——得到一个真实双端未协商会话，与 v1 hub 在 wire 上不可区分。**诚实边界**：interposer
 * 建模的是 v1 hub 的 wire 可见行为（HELLO 交集单点），不运行 pre-#242 hub 代码；残余风险
 * 由三层既有证据封堵：(a) v1 代码 = 现代码减去全部由协商位门控的分块特性（append-only
 * 切片链 + #243 未协商负控）；(b) #233 刻画测试锁 v1 行为；(c) codec 层 golden 旧字节互通。
 *
 * F1 断言纪律（SA2 评审 F1 修订）：**跨会话（M2 vs M1）不存在任何字节/长度相等断言**——
 * yjs@13.6.x `generateNewClientId = random.uint32`，lib0 varuint 编码宽度 1–5 字节随值变化，
 * 跨会话 Yjs 载荷字节与长度均不确定相等。M2≡M1 以三层确定性形态承载：
 *  (a) post-HELLO 每方向 `kind#sequence`（envelope sequence = 连接内确定性计数器）序列全等；
 *  (b) 确定性字段帧逐字段相等（HELLO_ACK.selectedCapabilities/protocolVersion、
 *      RESYNC_REQUIRED.reasonCode、UPDATE_ACK.ackedSequence、OPEN 族字段、BOOTSTRAP_ACK
 *      namespaceId；排除 connectionNonce（16 字节随机）、connectionId（hub 连接域标识）、
 *      一切 Yjs 编码字节）；
 *  (c) Yjs 承载帧（SYNC_STEP1/SYNC_STEP2/UPDATE/UPDATE_CHUNK/BOOTSTRAP_SNAPSHOT）只比
 *      kind + 每 kind 计数（+ namespaceId）。
 * 唯一字节级断言 = interposer **同一会话内**记录的原始 ↔ 重写 HELLO 字节对（等长、同
 *  envelope sequence、解码后除 optionalCapabilities 外逐字段相等、字节差异全部落在
 *  optionalCapabilities 4 字节 uint32 BE 字段窗口内）。
 *
 * N9 前提（落地锚定）：Layer (b) 的 OPEN 族 `replicationId`/`replicationEpoch` 跨会话确定性
 * 成立的前提 = 以 `makeNode` 原样组装（每 node 独立 `makeCounterRandomBytes()` 计数随机源，
 * `drawReplicationId` 走该受控源）且 M1/M2 两次构型调用序列一致——本文件不引入共享随机源
 * 工厂、不改变 `enableReplication` 前的抽取次序。
 *
 * N6 先例：矩阵含 UPDATE_CHUNK 帧的时间线一律经 `decodeWire = decodeMessage(bytes,
 * { selectedCapabilities: CAP_CHUNKED_UPDATE })`（#243 L111-112）；未协商格经
 * `{ selectedCapabilities: 0 }` 构型断言拒绝分类。
 *
 * 纪律与既有套件一致：真实 yjs / Registry / Runtime；fake-duplex；fake scheduler；
 * 零 real sleep；零源码 grep 断言。
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
  ENVELOPE_HEADER_BYTES,
  ProtocolError,
  decodeMessage,
  encodeMessage,
  selectCapabilities,
  type DecodedMessage,
  type HelloAckMsg,
  type HelloMsg,
  type UpdateAckMsg,
  type UpdateChunkMsg,
} from '@nomicore/replication-protocol';
import { DEFAULT_PEER_VERIFIER, TEST_TOKEN } from './driver.js';
import {
  HUB_INSTANCE,
  HUB_OWNER,
  NS_MAIN,
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

// ═══════════════════════════ 场景配置（与 #233 R1 同款极限构型） ═══════════════════════════

const SCHEMA = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'issue246-interop-matrix',
  text: 'type ROOT = { n: number; blurb: string; };\n',
});

const LIMITS: Readonly<Partial<ReplicationLimits>> = {
  maxUpdateBytes: 8 * 1024,
  maxQueuedUpdateCount: 100,
  maxQueuedUpdateBytes: 1 * 1024 * 1024,
  maxInFlightUpdates: 8,
};

const TIMEOUTS: Readonly<Partial<ReplicationTimeouts>> = { ackTimeoutMs: 60_000 };

const BIG = 'z'.repeat(20_000); // 编码后 ≈20,029B > maxUpdateBytes 8KiB

type Direction = 'peerToHub' | 'hubToPeer';
type ResyncEvent = Extract<ReplicationObserverEvent, { type: 'resync-required' }>;

/** 观察侧解码：协商上下文解码（#243 `decodeWire` 先例）——仅观测选项，不改 wire 行为。 */
function decodeWire(bytes: Uint8Array): DecodedMessage {
  return decodeMessage(bytes, { selectedCapabilities: CAP_CHUNKED_UPDATE });
}

interface Collector {
  readonly events: ReplicationObserverEvent[];
  readonly observer: ReplicationObserver;
  of(type: ReplicationObserverEvent['type']): ReplicationObserverEvent[];
}

function makeCollector(): Collector {
  const events: ReplicationObserverEvent[] = [];
  return {
    events,
    observer: (event) => {
      events.push(event);
    },
    of: (type) => events.filter((event) => event.type === type),
  };
}

// ═══════════════════════════ HELLO capability 剥除 interposer ═══════════════════════════

interface HelloRewrite {
  readonly original: Uint8Array;
  readonly rewritten: Uint8Array;
  readonly originalMessage: HelloMsg;
}

/**
 * 测试本地 interposer（设计 §7.4.2）：包装交给 `hub.accept` 的 transport 端。
 * `onMessage` 内先经 codec 判型；HELLO（0x01）以 `optionalCapabilities: 0`
 * 重编码（保留 envelope sequence）后转发，其余帧与 send/close/closed/onClose
 * 原样委托（onMessage 返回的退订句柄原样透传）。记录原始/重写 HELLO 字节对为证据。
 */
function makeHelloCapabilityStripper(target: DuplexTransport): {
  readonly end: DuplexTransport;
  readonly records: HelloRewrite[];
} {
  const records: HelloRewrite[] = [];
  const end: DuplexTransport = {
    send(bytes) {
      target.send(bytes);
    },
    close(code, reason) {
      target.close(code, reason);
    },
    get closed() {
      return target.closed;
    },
    onMessage(listener) {
      return target.onMessage((bytes) => {
        let decoded: DecodedMessage | undefined;
        try {
          decoded = decodeWire(bytes);
        } catch {
          decoded = undefined;
        }
        if (decoded === undefined || decoded.message.kind !== 'HELLO') {
          listener(bytes);
          return;
        }
        const hello = decoded.message;
        const rewritten = encodeMessage(
          { ...hello, optionalCapabilities: 0 },
          { sequence: decoded.header.sequence },
        );
        records.push({ original: bytes.slice(), rewritten, originalMessage: hello });
        listener(rewritten);
      });
    },
    onClose(listener) {
      return target.onClose(listener);
    },
  };
  return { end, records };
}

/** payload 前缀 varUint 读取（仅用于定位 interposer 字节窗口，纯测试域解析）。 */
function readVarUintAt(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let index = offset;
  for (;;) {
    const byte = bytes[index];
    if (byte === undefined) throw new Error('HELLO payload 越界');
    value += (byte & 0x7f) * 2 ** shift;
    index += 1;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return { value, next: index };
}

/** HELLO payload 中 optionalCapabilities（uint32 BE）在整帧内的 4 字节窗口。 */
function helloOptionalCapabilitiesWindow(bytes: Uint8Array): { readonly start: number; readonly end: number } {
  let index = ENVELOPE_HEADER_BYTES;
  for (let strings = 0; strings < 2; strings += 1) {
    const length = readVarUintAt(bytes, index);
    index = length.next + length.value; // peerInstanceId / expectedHubInstanceId
  }
  const count = readVarUintAt(bytes, index);
  index = count.next;
  for (let version = 0; version < count.value; version += 1) {
    index = readVarUintAt(bytes, index).next;
  }
  index += 4; // requiredCapabilities
  return { start: index, end: index + 4 };
}

// ═══════════════════════════ 三层确定性等同投影（F1） ═══════════════════════════

/** (a) 层：`kind#sequence` 序列（sequence = 连接内确定性计数器，与 Yjs 随机性无关）。 */
function kindSequence(frames: readonly DecodedMessage[]): string[] {
  return frames.map((frame) => `${frame.message.kind}#${frame.header.sequence}`);
}

/** HELLO 握手帧之后的帧流（HELLO 自身的 nonce/offered bit 属会话随机/意图面）。 */
function postHandshake(frames: readonly DecodedMessage[]): DecodedMessage[] {
  const helloAt = frames.findIndex((frame) => frame.message.kind === 'HELLO');
  return helloAt < 0 ? [...frames] : frames.slice(helloAt + 1);
}

/** (b) 层：确定性字段帧逐字段投影（排除 connectionNonce/connectionId/Yjs 字节）。 */
function deterministicFields(frames: readonly DecodedMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const frame of frames) {
    const message = frame.message;
    const base = { kind: message.kind, sequence: frame.header.sequence };
    switch (message.kind) {
      case 'HELLO_ACK':
        out.push({
          ...base,
          protocolVersion: (message as HelloAckMsg).protocolVersion,
          selectedCapabilities: (message as HelloAckMsg).selectedCapabilities,
        });
        break;
      case 'RESYNC_REQUIRED':
        out.push({ ...base, namespaceId: message.namespaceId, reasonCode: message.reasonCode });
        break;
      case 'UPDATE_ACK':
        out.push({ ...base, namespaceId: message.namespaceId, ackedSequence: message.ackedSequence });
        break;
      case 'OPEN_NAMESPACE':
        out.push({
          ...base,
          namespaceId: message.namespaceId,
          hasLocalReplica: message.hasLocalReplica,
          replicationId: message.replicationId,
          replicationEpoch: message.replicationEpoch,
        });
        break;
      case 'OPEN_OK':
        out.push({
          ...base,
          namespaceId: message.namespaceId,
          mode: message.mode,
          replicationId: message.replicationId,
          replicationEpoch: message.replicationEpoch,
        });
        break;
      case 'BOOTSTRAP_ACK':
        out.push({ ...base, namespaceId: message.namespaceId });
        break;
      default:
        break;
    }
  }
  return out;
}

/** (c) 层：Yjs 承载帧的 kind + 每 kind 计数（+ namespaceId）——字节与长度不参与断言。 */
const YJS_BEARING = new Set(['SYNC_STEP1', 'SYNC_STEP2', 'UPDATE', 'UPDATE_CHUNK', 'BOOTSTRAP_SNAPSHOT']);

function yjsBearingCounts(frames: readonly DecodedMessage[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const frame of frames) {
    if (!YJS_BEARING.has(frame.message.kind)) continue;
    const namespaceId = (frame.message as { namespaceId?: string }).namespaceId ?? '-';
    const key = `${frame.message.kind}@${namespaceId}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

// ═══════════════════════════ 矩阵会话组装（自备，不改 bootMulti） ═══════════════════════════

interface MatrixSession {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly nsId: string;
  readonly peerCollector: Collector;
  readonly hubCollector: Collector;
  readonly wire: Wire;
  readonly helloRewrites: readonly HelloRewrite[];
  readonly helloAck: HelloAckMsg;
  /** peer 实际发出的 HELLO（as-sent；M2 中 offered bit = CAP）。 */
  readonly hello: HelloMsg;
  /** hub 实际收到的 HELLO（interposer 重写后；v1 代际等价 wire 入口）。 */
  readonly helloHubVisible: HelloMsg;
  peerWrite(value: Readonly<{ n?: number; blurb?: string }>): Promise<void>;
  hubWrite(value: Readonly<{ n?: number; blurb?: string }>): Promise<void>;
  frames(direction: Direction): DecodedMessage[];
  framesOf(direction: Direction, kind: string): DecodedMessage[];
  rootValue(side: 'hub' | 'peer', key: 'blurb' | 'n'): unknown;
  namespaceState(): string | undefined;
  connectionState(): string;
}

async function bootMatrix(opts: {
  readonly stripHelloCapabilities?: boolean;
  readonly chunkedUpdate?: boolean;
}): Promise<MatrixSession> {
  // N9：makeNode 原样组装（每 node 独立计数随机源）；M1/M2/M3 调用序列一致。
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const lease = okLease(
    await hubNode.registry.create({ owner: HUB_OWNER, schema: SCHEMA, root: { n: 1, blurb: 'seed' } }),
  );
  await schemaReady(lease);
  const enabled = await lease.enableReplication();
  if (!enabled.ok) throw new Error(`enableReplication 失败：${JSON.stringify(enabled)}`);
  const nsId = lease.namespaceId;

  const peerCollector = makeCollector();
  const hubCollector = makeCollector();
  let activeWire: Wire | undefined;
  let helloRewrites: readonly HelloRewrite[] = [];

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
    observer: hubCollector.observer,
  });

  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      const wire = makeWire();
      activeWire = wire;
      let hubEnd = wire.hubEnd;
      if (opts.stripHelloCapabilities === true) {
        const stripper = makeHelloCapabilityStripper(wire.hubEnd);
        hubEnd = stripper.end;
        helloRewrites = stripper.records; // 活引用：HELLO 到达后记录可见
      }
      void hub.accept(hubEnd, { token: TEST_TOKEN });
      return wire.peerEnd;
    },
    timer: peerNode.scheduler,
    targets: [{ namespaceId: nsId, localOwner: PEER_OWNER }],
    limits: LIMITS,
    timeouts: TIMEOUTS,
    observer: peerCollector.observer,
    chunkedUpdate: opts.chunkedUpdate ?? false,
  });

  peer.start();
  await settleUntil(() => peer.getConnectionState() === 'ready', '连接 ready');
  await settleUntil(() => peer.getNamespaceState(nsId) === 'live', 'namespace live');

  const write = async (
    node: ReplicaNode,
    owner: typeof HUB_OWNER | typeof PEER_OWNER,
    value: Readonly<{ n?: number; blurb?: string }>,
  ): Promise<void> => {
    const business = okLease(await node.registry.open(owner, nsId));
    await schemaReady(business);
    for (const [key, entry] of Object.entries(value)) {
      const result = await business.mutateData({ op: 'set', path: [key], value: entry });
      if (!result.ok) throw new Error(`业务写失败：${JSON.stringify(result)}`);
    }
    await business.release();
  };

  const wireOf = (): Wire => {
    if (activeWire === undefined) throw new Error('peer 尚未拨号');
    return activeWire;
  };
  const rawOf = (direction: Direction): Uint8Array[] =>
    direction === 'peerToHub' ? wireOf().peerToHub : wireOf().hubToPeer;

  const frames = (direction: Direction): DecodedMessage[] => rawOf(direction).map(decodeWire);

  const initialPeerToHub = frames('peerToHub');
  const initialHubToPeer = frames('hubToPeer');
  const hello = initialPeerToHub.find((frame) => frame.message.kind === 'HELLO')?.message as HelloMsg;
  const helloAck = initialHubToPeer.find((frame) => frame.message.kind === 'HELLO_ACK')?.message as HelloAckMsg;

  return {
    hubNode,
    peerNode,
    hub,
    peer,
    nsId,
    peerCollector,
    hubCollector,
    get wire() {
      return wireOf();
    },
    helloRewrites,
    hello,
    helloHubVisible:
      helloRewrites.length > 0
        ? (decodeWire(helloRewrites[0]!.rewritten).message as HelloMsg)
        : hello,
    helloAck,
    peerWrite: (value) => write(peerNode, PEER_OWNER, value),
    hubWrite: (value) => write(hubNode, HUB_OWNER, value),
    frames,
    framesOf: (direction, kind) => frames(direction).filter((frame) => frame.message.kind === kind),
    rootValue: (side, key) => {
      const node = side === 'hub' ? hubNode : peerNode;
      const owner = side === 'hub' ? HUB_OWNER : PEER_OWNER;
      const doc = node.persistence.peek(owner, nsId);
      if (doc === undefined) throw new Error(`${side} 缺副本 ${nsId}`);
      return (doc.getMap('ROOT') as unknown as Map<string, unknown>).get(key);
    },
    namespaceState: () => peer.getNamespaceState(nsId),
    connectionState: () => peer.getConnectionState(),
  };
}

/** v1 回落行为断言组（设计 §7.4.2 M1 行 + SA2 观察 N4：按观测侧分别断言，禁止汇总）。 */
async function assertV1Fallback(session: MatrixSession, direction: Direction): Promise<void> {
  const senderIsPeer = direction === 'peerToHub';
  const senderCollector = senderIsPeer ? session.peerCollector : session.hubCollector;
  const receiverCollector = senderIsPeer ? session.hubCollector : session.peerCollector;
  const writer = senderIsPeer ? session.peerWrite : session.hubWrite;
  const opposite = senderIsPeer ? 'peer' : 'hub';
  const before = session.frames(direction);

  await writer({ blurb: BIG });
  await settleUntil(
    () =>
      session.rootValue(opposite, 'blurb') === BIG &&
      session.namespaceState() !== undefined &&
      session.namespaceState() !== 'needs-resync' &&
      session.namespaceState() !== 'reconciling',
    `v1 回落：reconciliation 收敛且回到 live（当前 ${String(session.namespaceState())}）`,
  );
  await settle();

  // 协商位：hub 实际收到的 HELLO（v1 代际等价 wire 入口）恒 0；HELLO_ACK 交集恒 0
  expect(session.helloHubVisible.optionalCapabilities).toBe(0);
  expect(session.helloAck.selectedCapabilities).toBe(0);

  // 发射侧（发送方）恰一：send-failed / update-too-large / channelState=needs-resync（N4 按侧）
  const sentFailures = senderCollector
    .of('resync-required')
    .filter((event): event is ResyncEvent => event.type === 'resync-required')
    .filter((event) => event.namespaceId === session.nsId && event.cause === 'send-failed');
  expect(sentFailures, '发射侧恰一 send-failed resync-required').toHaveLength(1);
  expect(sentFailures[0]!.reason).toBe('update-too-large');
  expect(sentFailures[0]!.channelState).toBe('needs-resync');

  // 接收侧（对端）恰一 remote-declared 处置
  const received = receiverCollector
    .of('resync-required')
    .filter((event): event is ResyncEvent => event.type === 'resync-required')
    .filter((event) => event.namespaceId === session.nsId && event.cause === 'remote-declared');
  expect(received, '接收侧恰一 remote-declared 处置').toHaveLength(1);

  // wire：恰一 RESYNC_REQUIRED；该写零 UPDATE / 零 UPDATE_CHUNK 承载
  const after = session.frames(direction);
  const newFrames = after.slice(before.length);
  expect(newFrames.filter((frame) => frame.message.kind === 'RESYNC_REQUIRED')).toHaveLength(1);
  expect(newFrames.filter((frame) => frame.message.kind === 'UPDATE')).toHaveLength(0);
  expect(newFrames.filter((frame) => frame.message.kind === 'UPDATE_CHUNK')).toHaveLength(0);

  // 恢复：经 > maxUpdateBytes 的 SYNC_STEP2 diff 收敛（v1 超限代价形态）
  const bigDiffs = newFrames.filter(
    (frame) =>
      frame.message.kind === 'SYNC_STEP2' &&
      (frame.message as Extract<DecodedMessage['message'], { kind: 'SYNC_STEP2' }>).update.byteLength >
        LIMITS.maxUpdateBytes!,
  );
  expect(bigDiffs.length, 'v1 回落必须经 > maxUpdateBytes 的 SYNC_STEP2 diff 收敛').toBeGreaterThanOrEqual(1);
  expect(session.rootValue(opposite, 'blurb')).toBe(BIG);
}

// ═══════════════════════════ M1 / M2 / M3 ═══════════════════════════

describe('issue #246 实现代际互通矩阵（ADR 0013 L25；未协商 ⇒ v1 超限行为保持）', () => {
  it('M1 v1 peer ↔ v2 hub：协商位恒 0；peer 写与 hub 写镜像双方向 v1 回落', async () => {
    const session = await bootMatrix({ chunkedUpdate: false });
    await assertV1Fallback(session, 'peerToHub');
    await assertV1Fallback(session, 'hubToPeer');
    expect(session.connectionState()).toBe('ready');
  }, 30_000);

  it('M2 v2 peer ↔ v1 hub（HELLO capability 剥除 interposer）：字节对证据 + M1 行为 + 三层确定性等同', async () => {
    // 同一构型独立组装两次：M1 基线（v1 peer）与 M2（v2 peer + interposer）历史逐帧对应。
    const baseline = await bootMatrix({ chunkedUpdate: false });
    const stripped = await bootMatrix({ chunkedUpdate: true, stripHelloCapabilities: true });

    // ── interposer 证据：v2 确实 offered，重写后为 0 ─────────────────────────
    expect(stripped.helloRewrites).toHaveLength(1);
    expect(stripped.hello.optionalCapabilities, 'as-sent HELLO 确实 offered').toBe(CAP_CHUNKED_UPDATE);
    const rewrite = stripped.helloRewrites[0]!;
    expect(rewrite.originalMessage.optionalCapabilities).toBe(CAP_CHUNKED_UPDATE);
    const rewrittenDecoded = decodeWire(rewrite.rewritten);
    expect(rewrittenDecoded.message.kind).toBe('HELLO');
    expect((rewrittenDecoded.message as HelloMsg).optionalCapabilities).toBe(0);

    // 同会话原始/重写字节对（F1 唯一字节级断言对象）
    expect(rewrite.rewritten.byteLength).toBe(rewrite.original.byteLength);
    expect(rewrittenDecoded.header.sequence).toBe(decodeWire(rewrite.original).header.sequence);
    const originalDecoded = decodeWire(rewrite.original).message as HelloMsg;
    expect(originalDecoded.peerInstanceId).toBe(rewrite.originalMessage.peerInstanceId);
    expect(rewrittenDecoded.message).toEqual({ ...originalDecoded, optionalCapabilities: 0 });
    expect(Array.from((rewrittenDecoded.message as HelloMsg).connectionNonce)).toEqual(
      Array.from(originalDecoded.connectionNonce),
    );
    // 重编码等价：差异只能是 optionalCapabilities 字段
    expect(
      Array.from(
        encodeMessage({ ...originalDecoded, optionalCapabilities: 0 }, { sequence: 1 }),
      ),
    ).toEqual(Array.from(rewrite.rewritten));
    const window = helloOptionalCapabilitiesWindow(rewrite.original);
    const diffOffsets = Array.from(rewrite.original)
      .map((byte, index) => (byte === rewrite.rewritten[index] ? -1 : index))
      .filter((index) => index >= 0);
    expect(diffOffsets.length, '原始/重写 HELLO 必须存在差异字节').toBeGreaterThan(0);
    for (const offset of diffOffsets) {
      expect(
        offset >= window.start && offset < window.end,
        `字节差异越出 optionalCapabilities 窗口：${offset} ∉ [${window.start}, ${window.end})`,
      ).toBe(true);
    }
    expect(Array.from(rewrite.original.slice(window.start, window.end))).toEqual([0, 0, 0, 1]);
    expect(Array.from(rewrite.rewritten.slice(window.start, window.end))).toEqual([0, 0, 0, 0]);

    // ── M1 全部行为断言逐条成立（双方向腿与 M1 同序对齐；含 N4 按侧 resync 断言） ──
    // 两会话操作序列逐一对齐（peer 写腿 → hub 写镜像腿，N9 纪律不变）：M2≡M1 三层
    // 等同比对对象必须包含超限 hub→peer 载荷腿，而非仅握手/reconciliation 回声流量。
    await assertV1Fallback(baseline, 'peerToHub');
    await assertV1Fallback(stripped, 'peerToHub');
    await assertV1Fallback(baseline, 'hubToPeer');
    await assertV1Fallback(stripped, 'hubToPeer');
    expect(stripped.helloAck.selectedCapabilities).toBe(0);
    expect(stripped.connectionState()).toBe('ready');

    // ── M2≡M1 三层确定性等同（无任何跨会话字节/长度相等项，F1） ──────────────
    for (const direction of ['peerToHub', 'hubToPeer'] as const) {
      const left = postHandshake(baseline.frames(direction));
      const right = postHandshake(stripped.frames(direction));
      // (a) 帧序列层
      expect(kindSequence(right), `(a) ${direction} kind#sequence 序列`).toEqual(kindSequence(left));
      // (b) 确定性字段层
      expect(deterministicFields(right), `(b) ${direction} 确定性字段`).toEqual(deterministicFields(left));
      // (c) Yjs 承载层：只比 kind + 计数（+ namespaceId）
      expect(yjsBearingCounts(right), `(c) ${direction} Yjs 承载帧计数`).toEqual(yjsBearingCounts(left));
    }
  }, 60_000);

  it('M3 v2 ↔ v2 协商分块：双方向 UPDATE_CHUNK 多帧 + 单 ACK（末 chunk 帧序）+ 零 resync', async () => {
    const session = await bootMatrix({ chunkedUpdate: true });
    expect(session.hello.optionalCapabilities).toBe(CAP_CHUNKED_UPDATE);
    expect(session.helloAck.selectedCapabilities).toBe(CAP_CHUNKED_UPDATE);

    const assertChunked = async (direction: Direction): Promise<void> => {
      const senderIsPeer = direction === 'peerToHub';
      const opposite = senderIsPeer ? 'peer' : 'hub';
      const before = session.frames(direction);
      await (senderIsPeer ? session.peerWrite({ blurb: BIG }) : session.hubWrite({ blurb: BIG }));
      await settleUntil(
        () => session.rootValue(opposite, 'blurb') === BIG && session.namespaceState() === 'live',
        `M3 ${direction} 分块收敛且回 live（当前 ${String(session.namespaceState())}）`,
      );
      await settle();

      const frames = session.frames(direction);
      const chunkFrames = frames.filter(
        (frame): frame is DecodedMessage & { message: UpdateChunkMsg } =>
          frame.message.kind === 'UPDATE_CHUNK' &&
          (frame.message as UpdateChunkMsg).namespaceId === session.nsId,
      );
      expect(chunkFrames.length, `${direction} UPDATE_CHUNK ≥ 2 帧`).toBeGreaterThanOrEqual(2);
      expect(new Set(chunkFrames.map((frame) => frame.message.transferId)).size).toBe(1);
      expect(chunkFrames[0]!.message.transferId).toBe(1);
      expect(chunkFrames.map((frame) => frame.message.chunkIndex)).toEqual(
        chunkFrames.map((_, index) => index),
      );
      expect(chunkFrames.every((frame) => frame.message.chunkCount === chunkFrames.length)).toBe(true);
      const totalBytes = chunkFrames.reduce((sum, frame) => sum + frame.message.bytes.byteLength, 0);
      expect(totalBytes).toBe(chunkFrames[0]!.message.totalBytes);
      expect(chunkFrames.every((frame) => frame.message.bytes.byteLength <= LIMITS.maxUpdateBytes!)).toBe(true);

      const acks = session
        .frames(senderIsPeer ? 'hubToPeer' : 'peerToHub')
        .filter(
          (frame): frame is DecodedMessage & { message: UpdateAckMsg } =>
            frame.message.kind === 'UPDATE_ACK' &&
            (frame.message as UpdateAckMsg).namespaceId === session.nsId,
        );
      expect(acks, `${direction} 恰一 UPDATE_ACK（反向结算）`).toHaveLength(1);
      expect(acks[0]!.message.ackedSequence).toBe(chunkFrames[chunkFrames.length - 1]!.header.sequence);

      // 零 resync：协商路径直达，无 reconciliation 代价
      expect(
        [...session.peerCollector.events, ...session.hubCollector.events].filter(
          (event) => event.type === 'resync-required',
        ),
      ).toHaveLength(0);
      // #233 R1 反向断言：该写零 SYNC_STEP2 承载（不经控制帧路径）
      expect(
        frames.filter(
          (frame) =>
            frame.message.kind === 'SYNC_STEP2' &&
            (frame.message as Extract<DecodedMessage['message'], { kind: 'SYNC_STEP2' }>).update.byteLength >
              LIMITS.maxUpdateBytes!,
        ),
      ).toHaveLength(0);
      expect(before.length, '写前时间线非空（会话已建立）').toBeGreaterThan(0);
      expect(frames.length, '该写必须新增 wire 帧').toBeGreaterThan(before.length);
      expect(session.rootValue(opposite, 'blurb')).toBe(BIG);
    };

    await assertChunked('peerToHub');
    await assertChunked('hubToPeer');
  }, 30_000);

  it('协商数学与分类等同锚：v1 hub 交集 = 0；未协商 0x42 解码拒绝分类 = connection fatal 1002', () => {
    // v1 hub 数学（支持集 ∅）与 v2 hub 数学
    expect(selectCapabilities(0, CAP_CHUNKED_UPDATE, 0)).toEqual({ ok: true, selected: 0 });
    expect(selectCapabilities(0, CAP_CHUNKED_UPDATE, CAP_CHUNKED_UPDATE)).toEqual({
      ok: true,
      selected: CAP_CHUNKED_UPDATE,
    });

    const chunkFrame = encodeMessage(
      {
        kind: 'UPDATE_CHUNK',
        namespaceId: NS_MAIN,
        transferId: 1,
        chunkIndex: 0,
        chunkCount: 1,
        totalBytes: 3,
        bytes: Uint8Array.from([1, 2, 3]),
      },
      { sequence: 7 },
    );
    // v1 端收 0x42 ≡ v2 未协商端收 0x42：分类等同锚
    let rejection: unknown;
    try {
      decodeMessage(chunkFrame, { selectedCapabilities: 0 });
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(ProtocolError);
    const protocolError = rejection as ProtocolError;
    expect(protocolError.code).toBe('UNSUPPORTED_MESSAGE_TYPE');
    expect(protocolError.scope).toBe('connection');
    expect(protocolError.fatal).toBe(true);
    expect(protocolError.wsCloseCode).toBe(1002);
    // 已协商端同帧正常解码（观测面 decodeWire）
    expect(decodeWire(chunkFrame).message.kind).toBe('UPDATE_CHUNK');
  });
});

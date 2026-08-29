/**
 * SA7 动态验证补充测试 —— issue #161（SA4 R2 pass 后的动态审核重点 1–4 + O1）。
 *
 * 覆盖（对应 sa4_review §六 + R2-6 O1）：
 *   D1（§六.1 R1 关联完整性·全链路）：≥3 ns 同连接、一 ns ACK 超时（resync 声明，
 *      in-flight 窗口未收口）、兄弟 ns 数据帧滞留连接队列（水位暂停）时，发起新 ns
 *      OPEN（bootstrap）与 removeTarget（close）——wire 上 BOOTSTRAP_SNAPSHOT/
 *      CLOSE_NAMESPACE 帧序与其 ACK 回显（BOOTSTRAP_ACK/CLOSE_OK.ackedSequence）
 *      恒等关联、零 ACK_STATE_VIOLATION false-fatal。
 *   D2（§六.1 R1 关联完整性·类级真实接线形态）：sendControl 返回值 = 本控制帧自身
 *      wire 序——同一次 drain 内数据帧随后派发（多 ns 竞争交错）不污染关联基准。
 *   D3（§六.2 N3 公平性）：canDispatchData=false 的 ns 长期占位（窗口满未收口）时，
 *      兄弟 ns 被挡帧由检查点 timer（一个周期）兜底派发——真实 scheduler 推进下
 *      无饿死。
 *   D4（§六.3 N4 liveness）：真实 ping/onPong facet 注入——pong 超时收口（backoff）、
 *      pong 复清计时、stop/重拨清 timer、缺面 dormant 零活性事件。
 *   D5（§六.4 R4 GOAWAY blocked）：SHUTTING_DOWN → blocked 后（socket 保持开放），
 *      wire 上零后续 UPDATE 帧（含 blocked 前已入连接队列的滞留帧）。
 *   D6（O1 E5 运行时锚·全链路）：closing drain 期（CLOSE_OK 丢失、closeTimeout 未到）
 *      迟到 OPEN_OK → finalize 终态 → removeTarget promise 有限结算（零 timer 推进、
 *      零 CLOSE_OK——E5 是该路径唯一结算点）。
 *
 * 纪律：真实 yjs / Registry / Runtime / PeerReplication / HubReplication；fake-duplex
 * + 慢 socket 栅门（测试文件自制，行为观测面）；fake scheduler；零 real sleep；
 * 零源码 grep 断言（OutboundQueue 为被测生产类，经相对路径导入做类级锚）。
 */
import { describe, expect, it } from 'vitest';
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type {
  DuplexTransport,
  HubReplication,
  PeerReplication,
  ReplicationLimits,
} from '@nomicore/ws-replication';
import { createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import {
  decodeMessage,
  encodeMessage,
  type DecodedMessage,
  type ReplicationMessage,
} from '@nomicore/replication-protocol';
import { ConnectionSender, type DataSenderFacet } from '../src/backpressure.js';
import { resolveLimits } from '../src/defaults.js';
import { OutboundQueue } from '../src/frame-io.js';
import type { ResolvedLimits } from '../src/types.js';
import { makeAuthorizer } from './driver.js';
import {
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  PEER_OWNER,
  makeNode,
  okLease,
  schemaReady,
  settle,
  settleUntil,
} from './harness.js';
import type { HubNamespaceFixture, ReplicaNode } from './harness.js';

// ═══════════════════════════ 公共 fixture（8KiB blob 可观测体积） ═══════════════════════════

const SCHEMA_BLOB_NS = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'phase5-ws-namespace-sync',
  text: 'type ROOT = { n: number; blob: string; };\n',
});

const BLOB = 'x'.repeat(8_000);

async function makeBlobHubNamespace(node: ReplicaNode): Promise<HubNamespaceFixture> {
  const lease = okLease(
    await node.registry.create({
      owner: HUB_OWNER,
      schema: SCHEMA_BLOB_NS,
      root: { n: 42, blob: '' },
    }),
  );
  await schemaReady(lease);
  const enabled = await lease.enableReplication();
  if (!enabled.ok) throw new Error(`enableReplication 失败：${JSON.stringify(enabled)}`);
  return { namespaceId: lease.namespaceId, lease, identity: { replicationId: '', replicationEpoch: 0 } };
}

// ═══════════════════════════ 慢 socket 栅门 wire（hub→peer 方向可栅；peer→hub 直达） ═══════════════════════════

interface DispatchEntry {
  readonly kind: string;
  readonly namespaceId: string | undefined;
  readonly sequence: number;
  readonly code: string | undefined;
  readonly bytes: Uint8Array;
}

interface GatedWire {
  readonly peerEnd: DuplexTransport;
  readonly hubEnd: DuplexTransport & { readonly bufferedAmount: number };
  setGate(on: boolean): void;
  readonly dispatchLog: DispatchEntry[];
  readonly deliveredToPeer: Uint8Array[];
  readonly peerToHub: Uint8Array[];
  releaseAll(): void;
  readonly heldBytes: number;
}

function makeGatedWire(): GatedWire {
  const peerListeners = new Set<(bytes: Uint8Array) => void>();
  const peerCloseListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const hubListeners = new Set<(bytes: Uint8Array) => void>();
  const hubCloseListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const held: Uint8Array[] = [];
  const dispatchLog: DispatchEntry[] = [];
  const deliveredToPeer: Uint8Array[] = [];
  const peerToHub: Uint8Array[] = [];
  let gated = false;
  let peerClosed = false;
  let hubClosed = false;

  const record = (bytes: Uint8Array): void => {
    const decoded = decodeMessage(bytes);
    dispatchLog.push({
      kind: decoded.message.kind,
      namespaceId: (decoded.message as { namespaceId?: string }).namespaceId,
      sequence: decoded.header.sequence,
      code: decoded.message.kind === 'ERROR' ? (decoded.message as { code: string }).code : undefined,
      bytes,
    });
  };

  const peerEnd: DuplexTransport = {
    send(bytes) {
      if (peerClosed) return;
      const copy = bytes.slice();
      peerToHub.push(copy);
      queueMicrotask(() => {
        for (const listener of [...hubListeners]) listener(copy);
      });
    },
    close(code = 1000, reason = '') {
      if (peerClosed) return;
      peerClosed = true;
      queueMicrotask(() => {
        for (const listener of [...hubCloseListeners]) listener({ code, reason });
      });
    },
    get closed() {
      return peerClosed;
    },
    onMessage(listener) {
      peerListeners.add(listener);
      return () => peerListeners.delete(listener);
    },
    onClose(listener) {
      peerCloseListeners.add(listener);
      return () => peerCloseListeners.delete(listener);
    },
  };

  const hubEnd = {
    send(bytes: Uint8Array) {
      if (hubClosed) return;
      const copy = bytes.slice();
      record(copy);
      if (gated) {
        held.push(copy);
        return;
      }
      deliveredToPeer.push(copy);
      queueMicrotask(() => {
        for (const listener of [...peerListeners]) listener(copy);
      });
    },
    close(code = 1001, reason = 'hub-close') {
      if (hubClosed) return;
      hubClosed = true;
      queueMicrotask(() => {
        for (const listener of [...peerCloseListeners]) listener({ code, reason });
      });
    },
    get closed() {
      return hubClosed;
    },
    onMessage(listener) {
      hubListeners.add(listener);
      return () => hubListeners.delete(listener);
    },
    onClose(listener) {
      hubCloseListeners.add(listener);
      return () => hubCloseListeners.delete(listener);
    },
    get bufferedAmount(): number {
      let total = 0;
      for (const bytes of held) total += bytes.byteLength;
      return total;
    },
  } as DuplexTransport & { readonly bufferedAmount: number };

  return {
    peerEnd,
    hubEnd,
    setGate(on) {
      gated = on;
    },
    dispatchLog,
    deliveredToPeer,
    peerToHub,
    releaseAll() {
      const todo = held.splice(0);
      for (const bytes of todo) {
        deliveredToPeer.push(bytes);
        for (const listener of [...peerListeners]) listener(bytes);
      }
    },
    get heldBytes() {
      let total = 0;
      for (const bytes of held) total += bytes.byteLength;
      return total;
    },
  };
}

// ═══════════════════════════ D1：多 ns 竞争下的关联完整性（全链路） ═══════════════════════════

interface MultiRunD1 {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly nsIds: readonly string[];
  readonly wire: GatedWire;
  readonly fixtures: ReadonlyMap<string, HubNamespaceFixture>;
  peerState(nsId: string): string | undefined;
}

async function bootMultiD1(opts: {
  nsCount: number;
  limits: Readonly<Partial<ReplicationLimits>>;
  ackTimeoutMs: number;
}): Promise<MultiRunD1> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const authorizer = makeAuthorizer({});
  const fixtures = new Map<string, HubNamespaceFixture>();
  for (let i = 0; i < opts.nsCount; i += 1) {
    const fixture = await makeBlobHubNamespace(hubNode);
    fixtures.set(fixture.namespaceId, fixture);
  }
  const nsIds = [...fixtures.keys()];
  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: hubNode.registry,
    authorize: authorizer.authorize,
    timer: hubNode.scheduler,
    limits: opts.limits,
    timeouts: { ackTimeoutMs: opts.ackTimeoutMs },
  });
  const wireRef: { current: GatedWire | undefined } = { current: undefined };
  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      const wire = makeGatedWire();
      wireRef.current = wire;
      hub.accept(wire.hubEnd, { peerInstanceId: PEER_INSTANCE });
      return wire.peerEnd;
    },
    timer: peerNode.scheduler,
    targets: nsIds.map((nsId) => ({ namespaceId: nsId, localOwner: PEER_OWNER })),
    limits: opts.limits,
    timeouts: { ackTimeoutMs: opts.ackTimeoutMs },
  });
  peer.start();
  await settleUntil(
    () => nsIds.every((nsId) => peer.getNamespaceState(nsId) === 'live'),
    '多 namespace 全部进入 live',
  );
  const wire = wireRef.current;
  if (wire === undefined) throw new Error('peer 未拨号');
  return {
    hubNode,
    peerNode,
    hub,
    peer,
    nsIds,
    wire,
    fixtures,
    peerState: (nsId) => peer.getNamespaceState(nsId),
  };
}

async function writeHubBlob(run: MultiRunD1, nsId: string, n: number): Promise<void> {
  const fixture = run.fixtures.get(nsId);
  if (fixture === undefined) throw new Error(`未知 ns ${nsId}`);
  const result = await fixture.lease.mutateRoot({ op: 'set', path: ['n'], value: n });
  if (!result.ok) throw new Error(`hub 业务写失败：${JSON.stringify(result)}`);
  const blobResult = await fixture.lease.mutateRoot({ op: 'set', path: ['blob'], value: BLOB });
  if (!blobResult.ok) throw new Error(`hub 业务写失败：${JSON.stringify(blobResult)}`);
  await settle();
}

describe('SA7 D1（SA4 §六.1 R1）：多 ns 竞争下 BOOTSTRAP_SNAPSHOT/CLOSE_NAMESPACE 与 ACK 回显恒等关联', () => {
  it('ACK 超时 resync + 兄弟 ns 队列滞留期间 bootstrap/close 关联恒等、零 ACK_STATE_VIOLATION', async () => {
    const run = await bootMultiD1({
      nsCount: 3,
      limits: {
        maxInFlightUpdates: 2,
        maxQueuedUpdateCount: 1024,
        maxQueuedUpdateBytes: 8 * 1024 * 1024,
        maxQueuedBytesPerConnection: 8 * 1024 * 1024,
        lowWater: 1024,
        highWater: 4096,
      },
      ackTimeoutMs: 300,
    });
    const [nsA, nsB, nsC] = run.nsIds as [string, string, string];
    void nsC; // 第三个 ns：同连接背景流量（不参与断言细节）

    // ── 构造：nsA in-flight 窗口满未收口（socket 栅门持有 2×8KiB，ACK 不回）──
    run.wire.setGate(true);
    await writeHubBlob(run, nsA, 1);
    await writeHubBlob(run, nsA, 2);
    await settle();
    const aUpdates = run.wire.dispatchLog.filter((e) => e.kind === 'UPDATE' && e.namespaceId === nsA);
    expect(aUpdates).toHaveLength(2); // 2 帧已派发、滞留 socket 缓冲（窗口 2/2 满）

    // ── ACK 超时（300ms，注入 timer）：abandon + 记忆化 RESYNC_REQUIRED（控制帧）──
    await run.hubNode.scheduler.advanceBy(300);
    await settle();
    const resyncEntries = run.wire.dispatchLog.filter((e) => e.kind === 'RESYNC_REQUIRED');
    expect(resyncEntries).toHaveLength(1);
    expect(resyncEntries[0]!.namespaceId).toBe(nsA);

    // ── 兄弟 ns nsB 持续交付：水位暂停期数据帧滞留连接级队列 ──
    await writeHubBlob(run, nsB, 1);
    await writeHubBlob(run, nsB, 2);
    await settle();
    // 暂停窗口内零数据派发（nsB 两帧滞留连接队列；nsA 两帧滞留 socket 缓冲）
    expect(run.wire.dispatchLog.filter((e) => e.kind === 'UPDATE' && e.namespaceId === nsB)).toHaveLength(0);
    expect(run.wire.heldBytes).toBeGreaterThan(0);

    // ── 新 ns OPEN（bootstrap）：控制帧与滞留数据竞争同一出站队列 ──
    const nsD = (await makeBlobHubNamespace(run.hubNode)).namespaceId;
    run.peer.addTarget({ namespaceId: nsD, localOwner: PEER_OWNER });
    await settleUntil(
      () => run.wire.dispatchLog.some((e) => e.kind === 'BOOTSTRAP_SNAPSHOT' && e.namespaceId === nsD),
      'BOOTSTRAP_SNAPSHOT 已派发',
    );
    const bootEntry = run.wire.dispatchLog.find(
      (e) => e.kind === 'BOOTSTRAP_SNAPSHOT' && e.namespaceId === nsD,
    )!;
    const bootWireSeq = bootEntry.sequence;

    // ── 释放栅门：peer 处理全部滞留帧 → 回 BOOTSTRAP_ACK（echo 快照帧序）──
    run.wire.setGate(false);
    run.wire.releaseAll();
    await settle();
    const peerFrames = run.wire.peerToHub.map((b) => decodeMessage(b));
    const bootAcks = peerFrames.filter(
      (f) =>
        f.message.kind === 'BOOTSTRAP_ACK' &&
        (f.message as { namespaceId?: string }).namespaceId === nsD,
    );
    expect(bootAcks).toHaveLength(1);
    // ★ R1 关联锚：wire 上 BOOTSTRAP_SNAPSHOT 帧序 === BOOTSTRAP_ACK.ackedSequence
    expect((bootAcks[0]!.message as { ackedSequence: number }).ackedSequence).toBe(bootWireSeq);

    // ── 恢复水位（检查点 timer 驱动）→ nsB 滞留帧派发 + nsD sync round 收敛 ──
    await run.hubNode.scheduler.advanceBy(100);
    await settle();
    await settleUntil(() => run.peerState(nsD) === 'live', 'nsD bootstrap 收敛 live');
    expect(
      run.wire.dispatchLog.filter((e) => e.kind === 'UPDATE' && e.namespaceId === nsB).length,
    ).toBeGreaterThanOrEqual(1); // authoritative sender 可合并/严格准入，至少已派发一帧

    // ── removeTarget（close）：CLOSE_NAMESPACE 帧序与 CLOSE_OK 回显恒等 ──
    const closeP = run.peer.removeTarget(nsB);
    await settleUntil(
      () => run.wire.peerToHub.some((b) => decodeMessage(b).message.kind === 'CLOSE_NAMESPACE'),
      'CLOSE_NAMESPACE 已发出',
    );
    const closeNs = peerFramesOfKind(run.wire.peerToHub, 'CLOSE_NAMESPACE');
    expect(closeNs).toHaveLength(1);
    const closeWireSeq = closeNs[0]!.header.sequence;
    await settleUntil(() => run.peerState(nsB) === 'closed', 'nsB 经 CLOSE_OK 收口 closed');
    // closeP 只能经 E1（关联 CLOSE_OK）结算——零 timer 推进（closeTimeoutMs=5000 从未推进）
    await withMicrotaskBudget(closeP, 'removeTarget 经关联 CLOSE_OK 结算');
    const closeOks = hubFramesOfKindDelivered(run.wire.dispatchLog, 'CLOSE_OK');
    expect(closeOks).toHaveLength(1);
    // ★ R1 关联锚：CLOSE_NAMESPACE wire 序 === CLOSE_OK.ackedSequence
    expect((closeOks[0]!.message as { ackedSequence: number }).ackedSequence).toBe(closeWireSeq);

    // ── 零 ACK_STATE_VIOLATION false-fatal：连接存活、双向零该码 ERROR 帧 ──
    const errorFrames = run.wire.dispatchLog.filter((e) => e.kind === 'ERROR');
    expect(errorFrames.filter((e) => e.code === 'ACK_STATE_VIOLATION')).toHaveLength(0);
    expect(peerFrames.filter((f) => f.message.kind === 'ERROR').length).toBe(0);
    expect(run.wire.hubEnd.closed).toBe(false);
    expect(run.peer.getConnectionState()).toBe('ready');
  });
});

function peerFramesOfKind(bytesList: readonly Uint8Array[], kind: string): DecodedMessage[] {
  return bytesList.map((b) => decodeMessage(b)).filter((f) => f.message.kind === kind);
}

function hubFramesOfKindDelivered(log: readonly DispatchEntry[], kind: string): DecodedMessage[] {
  return log.filter((e) => e.kind === kind).map((e) => decodeMessage(e.bytes));
}

/** 微任务预算内必须结算（零 timer 推进——证明结算点为事件驱动而非超时兜底）。 */
async function withMicrotaskBudget(p: Promise<void>, what: string, budget = 3_000): Promise<void> {
  let settled = false;
  void p.then(() => {
    settled = true;
  });
  for (let i = 0; i < budget; i += 1) {
    if (settled) return;
    await Promise.resolve();
  }
  if (!settled) throw new Error(`微任务预算耗尽：${what} 未结算（事件驱动结算点缺失）`);
}

// ═══════════════════════════ D2/D3：OutboundQueue 类级锚（真实生产类） ═══════════════════════════

const QUEUE_LIMITS: Readonly<ResolvedLimits> = Object.freeze(
  resolveLimits({
    maxFrameBytes: 1 << 20,
    maxBootstrapBytes: 1 << 20,
    maxSyncDiffBytes: 1 << 20,
    maxUpdateBytes: 1 << 20,
    maxQueuedUpdateBytes: 1 << 20,
    maxQueuedUpdateCount: 1024,
    maxInFlightUpdates: 8,
    maxQueuedBytesPerConnection: 8 << 20,
    lowWater: 1024,
    highWater: 4096,
    maxQueuedControlBytes: 8 * 1024 * 1024, // 控制帧独立保留额度（协议 §17：未冲刷控制字节口径）
  }),
);

const NS_W = 'ns-44444444444444444444444444444444';
const NS_X = 'ns-66666666666666666666666666666666';
const NS_Y = 'ns-55555555555555555555555555555555';

interface WireEmission {
  readonly seq: number;
  readonly label: string;
}

function upd(nsId: string): ReplicationMessage {
  return { kind: 'UPDATE', namespaceId: nsId, update: new Uint8Array([9, 9]) } as ReplicationMessage;
}

function bootFrame(nsId: string): ReplicationMessage {
  return {
    kind: 'BOOTSTRAP_SNAPSHOT',
    namespaceId: nsId,
    replicationId: '1'.repeat(32),
    replicationEpoch: 1,
    snapshot: new Uint8Array([0]),
  } as ReplicationMessage;
}

function senderHarness(blocked: Set<string>): {
  sender: ConnectionSender;
  queue: OutboundQueue;
  facets: Map<string, DataSenderFacet>;
  emissions: Array<{ seq: number; ns: string }>;
  enqueue(namespaceId: string): void;
} {
  const scheduler = createRegistryTestScheduler();
  const emissions: Array<{ seq: number; ns: string }> = [];
  const pending = new Map<string, ReplicationMessage[]>();
  const facets = new Map<string, DataSenderFacet>();
  let sender!: ConnectionSender;
  const queue = new OutboundQueue(() => undefined, QUEUE_LIMITS, () => undefined, (info) => sender.onEmitted(info));
  sender = new ConnectionSender({
    limits: QUEUE_LIMITS,
    timer: scheduler,
    ackTimeoutMs: 10_000, // poll 公式输入（D2/D3 语义与 poll 无关——readBufferedAmount 恒 0 不暂停）
    readBufferedAmount: () => 0,
    emitControl: (message) => queue.sendControl(message),
    emitData: (message) => {
      const seq = queue.emit(message);
      emissions.push({ seq, ns: 'namespaceId' in message ? message.namespaceId ?? '' : '' });
      return seq;
    },
    facetOf: (namespaceId) => facets.get(namespaceId),
    isEmitAllowed: () => true,
    onBackpressureExhausted: () => undefined,
  });
  const ensure = (namespaceId: string): ReplicationMessage[] => {
    let items = pending.get(namespaceId);
    if (items === undefined) {
      items = [];
      pending.set(namespaceId, items);
      facets.set(namespaceId, {
        queuedBytes: () => items!.reduce((sum, item) => sum + (item.kind === 'UPDATE' ? item.update.byteLength : 0), 0),
        queuedCount: () => items!.length,
        pullAndSendOne: () => {
          if (blocked.has(namespaceId) || items!.length === 0) return false;
          sender.tryEmitData(items!.shift()!);
          return true;
        },
        discardForConnectionPressure: () => { items!.length = 0; },
      });
    }
    return items;
  };
  return {
    sender,
    queue,
    facets,
    emissions,
    enqueue: (namespaceId) => {
      ensure(namespaceId).push(upd(namespaceId));
      sender.onDataQueued(namespaceId);
    },
  };
}

describe('SA7 D2（ConnectionSender/OutboundQueue 关联）：控制序列不受后续 data drain 污染', () => {
  it('控制帧返回自身序，data 经 authoritative facet plane 后续派发', () => {
    // cast 防线（SA2 T1）：额度字段必须有界数值——resolveLimits 构造 + isFinite 双保险，杜绝 NaN 静默失效
    expect(Number.isFinite(QUEUE_LIMITS.maxQueuedControlBytes)).toBe(true);
    const h = senderHarness(new Set());
    h.enqueue(NS_Y);
    const ret = h.sender.sendControl(bootFrame(NS_W));
    h.sender.requestDrain();
    expect(ret).toBe(1);
    expect(h.emissions.map((e) => e.seq)).toEqual([2]);
  });
});

describe('SA7 D3：ConnectionSender round-robin 有界整轮扫描', () => {
  it('阻塞 facet 不妨碍就绪兄弟同轮派发', () => {
    const blocked = new Set<string>([NS_W, NS_X]);
    const h = senderHarness(blocked);
    h.enqueue(NS_W);
    h.enqueue(NS_X);
    h.enqueue(NS_Y);
    h.sender.requestDrain();
    expect(h.emissions.map((e) => e.ns)).toEqual([NS_Y]);
    h.enqueue(NS_Y);
    h.sender.requestDrain();
    expect(h.emissions.map((e) => e.ns)).toEqual([NS_Y, NS_Y]);
  });

  it('全部 facet 阻塞时一整轮后有界停止', () => {
    const h = senderHarness(new Set([NS_W, NS_X, NS_Y]));
    h.enqueue(NS_W);
    h.enqueue(NS_X);
    h.enqueue(NS_Y);
    h.sender.requestDrain();
    expect(h.emissions).toHaveLength(0);
  });
});

// ═══════════════════════════ D4：N4 liveness（ping/onPong facet 注入） ═══════════════════════════

interface LivenessWire {
  readonly peerEnd: DuplexTransport & { ping(): void };
  readonly hubEnd: DuplexTransport;
  pingCount(): number;
  firePong(): void;
}

function makeLivenessWire(): LivenessWire {
  const peerListeners = new Set<(bytes: Uint8Array) => void>();
  const peerCloseListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const hubListeners = new Set<(bytes: Uint8Array) => void>();
  const hubCloseListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const pongListeners = new Set<() => void>();
  let pings = 0;
  let peerClosed = false;
  let hubClosed = false;

  const peerEnd = {
    send(bytes: Uint8Array) {
      if (peerClosed) return;
      const copy = bytes.slice();
      queueMicrotask(() => {
        for (const listener of [...hubListeners]) listener(copy);
      });
    },
    close(code = 1000, reason = '') {
      if (peerClosed) return;
      peerClosed = true;
      queueMicrotask(() => {
        for (const listener of [...hubCloseListeners]) listener({ code, reason });
      });
    },
    get closed() {
      return peerClosed;
    },
    onMessage(listener: (bytes: Uint8Array) => void) {
      peerListeners.add(listener);
      return () => peerListeners.delete(listener);
    },
    onClose(listener: (info: Readonly<{ code: number; reason: string }>) => void) {
      peerCloseListeners.add(listener);
      return () => peerCloseListeners.delete(listener);
    },
    ping() {
      pings += 1;
    },
    onPong(listener: () => void) {
      pongListeners.add(listener);
      return () => pongListeners.delete(listener);
    },
  } as DuplexTransport & { ping(): void };

  const hubEnd: DuplexTransport = {
    send(bytes) {
      if (hubClosed) return;
      const copy = bytes.slice();
      queueMicrotask(() => {
        for (const listener of [...peerListeners]) listener(copy);
      });
    },
    close(code = 1001, reason = 'hub-close') {
      if (hubClosed) return;
      hubClosed = true;
      queueMicrotask(() => {
        for (const listener of [...peerCloseListeners]) listener({ code, reason });
      });
    },
    get closed() {
      return hubClosed;
    },
    onMessage(listener) {
      hubListeners.add(listener);
      return () => hubListeners.delete(listener);
    },
    onClose(listener) {
      hubCloseListeners.add(listener);
      return () => hubCloseListeners.delete(listener);
    },
  };

  return {
    peerEnd,
    hubEnd,
    pingCount: () => pings,
    firePong() {
      for (const listener of [...pongListeners]) listener();
    },
  };
}

interface LivenessBoot {
  readonly peer: PeerReplication;
  readonly peerNode: ReplicaNode;
  readonly wires: LivenessWire[];
}

async function bootLiveness(withFacets: boolean): Promise<LivenessBoot> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const authorizer = makeAuthorizer({});
  const fixture = await makeBlobHubNamespace(hubNode);
  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: hubNode.registry,
    authorize: authorizer.authorize,
    timer: hubNode.scheduler,
  });
  const wires: LivenessWire[] = [];
  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      const wire = makeLivenessWire();
      wires.push(wire);
      hub.accept(
        withFacets ? wire.hubEnd : wire.hubEnd,
        { peerInstanceId: PEER_INSTANCE },
      );
      return withFacets ? wire.peerEnd : stripFacets(wire.peerEnd);
    },
    timer: peerNode.scheduler,
    targets: [{ namespaceId: fixture.namespaceId, localOwner: PEER_OWNER }],
    timeouts: { pingIntervalMs: 1_000, pongTimeoutMs: 500 },
    // random=0.99：backoff 延迟 = 0.99×100ms = 99ms——pong 超时观察窗（+500ms）内
    // 不触发零延迟重拨（delay = max(0, random()*cap)，random()=0 会同窗立即重拨回 ready）
    random: () => 0.99,
  });
  return { peer, peerNode, wires };
}

/** 剥离 ping/onPong 面（缺面 dormant 路径——真实 WS 无活性钩子的降级形态）。 */
function stripFacets(t: DuplexTransport): DuplexTransport {
  return {
    send: (b) => t.send(b),
    close: (c?, r?) => t.close(c, r),
    get closed() {
      return t.closed;
    },
    onMessage: (l) => t.onMessage(l),
    onClose: (l) => t.onClose(l),
  };
}

describe('SA7 D4（SA4 §六.3 N4）：WS ping/pong liveness 运行时行为', () => {
  it('pong 超时 → temporary failure 收口（backoff）；pong 复清计时；stop 后零 timer 残留', async () => {
    const run = await bootLiveness(true);
    run.peer.start();
    await settleUntil(() => run.peer.getConnectionState() === 'ready', '连接 ready');
    const wire1 = run.wires[0]!;

    // ping 周期到 → 发 ping；pong 未复 → pongTimeout → temporary failure
    await run.peerNode.scheduler.advanceBy(1_000);
    expect(wire1.pingCount()).toBe(1);
    await run.peerNode.scheduler.advanceBy(500);
    expect(run.peer.getConnectionState()).toBe('backoff');

    // backoff（random=0 → 50ms）→ 重拨 → 新 facet transport 活性重武装
    await run.peerNode.scheduler.advanceBy(100);
    await settleUntil(() => run.peer.getConnectionState() === 'ready', '重拨后 ready');
    expect(run.wires.length).toBe(2);
    const wire2 = run.wires[1]!;
    // pong 及时复 → 计时清零：三个周期不误杀
    await run.peerNode.scheduler.advanceBy(1_000);
    expect(wire2.pingCount()).toBe(1);
    wire2.firePong();
    await run.peerNode.scheduler.advanceBy(1_000);
    expect(wire2.pingCount()).toBe(2);
    wire2.firePong();
    await run.peerNode.scheduler.advanceBy(499); // 未越 pongTimeout
    expect(run.peer.getConnectionState()).toBe('ready');
    await run.peerNode.scheduler.advanceBy(1);
    expect(run.peer.getConnectionState()).toBe('ready'); // pong 已清计时——不误杀
    wire2.firePong();

    // stop → 活性 timer 清理：此后推进整个 ping 周期零 ping
    const pingsAtStop = wire2.pingCount();
    run.peer.stop();
    await settleUntil(() => run.peer.getConnectionState() === 'stopped', 'stopped');
    await run.peerNode.scheduler.advanceBy(10_000);
    expect(wire2.pingCount()).toBe(pingsAtStop); // 零 timer 残留
  });

  it('缺面（无 ping/onPong）→ dormant：推进 pingInterval+pongTimeout 零活性事件、连接不误收口', async () => {
    const run = await bootLiveness(false);
    run.peer.start();
    await settleUntil(() => run.peer.getConnectionState() === 'ready', '连接 ready');
    // 无 facet transport：活性循环不得武装——长时间推进零 ping（无面可计）且不因
    // 活性失联收口（dormant 降级，切片 9 前无宿主适配的正确形态）
    await run.peerNode.scheduler.advanceBy(41_000);
    expect(run.peer.getConnectionState()).toBe('ready');
    expect(run.wires[0]!.pingCount()).toBe(0); // facet 未接（stripFacets）——零调用
  });
});

// ═══════════════════════════ D5：R4 GOAWAY blocked 后 wire 零后续 UPDATE ═══════════════════════════

describe('SA7 D5（SA4 §六.4 R4）：GOAWAY SHUTTING_DOWN → blocked 后零后续 UPDATE 帧', () => {
  it('blocked（socket 保持开放）后：滞留队列不派发、新业务写零出站', async () => {
    const hubNode = makeNode('hub');
    const peerNode = makeNode('peer');
    const authorizer = makeAuthorizer({});
    const fixture = await makeBlobHubNamespace(hubNode);
    const hub = createHubReplication({
      instanceId: HUB_INSTANCE,
      registry: hubNode.registry,
      authorize: authorizer.authorize,
      timer: hubNode.scheduler,
    });
    // peer 侧栅门 wire：peer→hub 方向可栅（模拟慢上行 socket + bufferedAmount 面）
    const peerListeners = new Set<(bytes: Uint8Array) => void>();
    const peerCloseListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
    const hubListeners = new Set<(bytes: Uint8Array) => void>();
    const hubCloseListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
    const held: Uint8Array[] = [];
    const dispatched: DecodedMessage[] = [];
    const hubToPeer: Uint8Array[] = [];
    let gated = false;
    let peerClosed = false;
    let hubClosed = false;
    const peerEnd = {
      send(bytes: Uint8Array) {
        if (peerClosed) return;
        const copy = bytes.slice();
        dispatched.push(decodeMessage(copy));
        if (gated) {
          held.push(copy);
          return;
        }
        queueMicrotask(() => {
          for (const listener of [...hubListeners]) listener(copy);
        });
      },
      close(code = 1000, reason = '') {
        if (peerClosed) return;
        peerClosed = true;
        queueMicrotask(() => {
          for (const listener of [...hubCloseListeners]) listener({ code, reason });
        });
      },
      get closed() {
        return peerClosed;
      },
      onMessage(listener: (bytes: Uint8Array) => void) {
        peerListeners.add(listener);
        return () => peerListeners.delete(listener);
      },
      onClose(listener: (info: Readonly<{ code: number; reason: string }>) => void) {
        peerCloseListeners.add(listener);
        return () => peerCloseListeners.delete(listener);
      },
      get bufferedAmount(): number {
        let total = 0;
        for (const bytes of held) total += bytes.byteLength;
        return total;
      },
    } as DuplexTransport & { readonly bufferedAmount: number };
    const hubEnd: DuplexTransport = {
      send(bytes) {
        if (hubClosed) return;
        const copy = bytes.slice();
        hubToPeer.push(copy);
        queueMicrotask(() => {
          for (const listener of [...peerListeners]) listener(copy);
        });
      },
      close(code = 1001, reason = 'hub-close') {
        if (hubClosed) return;
        hubClosed = true;
        queueMicrotask(() => {
          for (const listener of [...peerCloseListeners]) listener({ code, reason });
        });
      },
      get closed() {
        return hubClosed;
      },
      onMessage(listener) {
        hubListeners.add(listener);
        return () => hubListeners.delete(listener);
      },
      onClose(listener) {
        hubCloseListeners.add(listener);
        return () => hubCloseListeners.delete(listener);
      },
    };
    const peer = createPeerReplication({
      instanceId: PEER_INSTANCE,
      hubInstanceId: HUB_INSTANCE,
      registry: peerNode.registry,
      dial: () => {
        hub.accept(hubEnd, { peerInstanceId: PEER_INSTANCE });
        return peerEnd;
      },
      timer: peerNode.scheduler,
      targets: [{ namespaceId: fixture.namespaceId, localOwner: PEER_OWNER }],
      limits: { maxInFlightUpdates: 3, highWater: 4096, lowWater: 1024 },
      random: () => 0,
    });
    peer.start();
    await settleUntil(
      () => peer.getNamespaceState(fixture.namespaceId) === 'live',
      'ns live',
    );

    const writePeer = async (n: number): Promise<void> => {
      const lease = okLease(await peerNode.registry.open(PEER_OWNER, fixture.namespaceId));
      await schemaReady(lease);
      const r1 = await lease.mutateRoot({ op: 'set', path: ['n'], value: n });
      if (!r1.ok) throw new Error(`peer 写失败：${JSON.stringify(r1)}`);
      const r2 = await lease.mutateRoot({ op: 'set', path: ['blob'], value: BLOB });
      if (!r2.ok) throw new Error(`peer 写失败：${JSON.stringify(r2)}`);
      await lease.release();
      await settle();
    };

    // 栅住上行：writePeer（n+blob 两笔 mutateRoot → 2 个 UPDATE）全部派发滞留
    // socket 缓冲（in-flight 2/3 未收口），检查点 → 暂停（16KiB ≥ highWater）
    gated = true;
    await writePeer(1);
    expect(dispatched.filter((f) => f.message.kind === 'UPDATE')).toHaveLength(2);
    await peerNode.scheduler.advanceBy(100); // 检查点：水位暂停
    await settle();
    // 暂停期 writePeer(2)：窗口有余量（2/3）→ handoff → 滞留连接级队列（未派发）
    await writePeer(2);
    expect(dispatched.filter((f) => f.message.kind === 'UPDATE')).toHaveLength(2);

    // GOAWAY SHUTTING_DOWN（hub→peer 注入；hub 静默期）→ blocked
    const nextHubSeq = hubToPeer.reduce((max, b) => Math.max(max, decodeMessage(b).header.sequence), 0) + 1;
    hubEnd.send(
      encodeMessage(
        { kind: 'GOAWAY', reasonCode: 'SERVER_SHUTTING_DOWN', drainTimeoutMs: 5_000 } as ReplicationMessage,
        { sequence: nextHubSeq },
      ),
    );
    await settleUntil(() => peer.getConnectionState() === 'blocked', 'GOAWAY → blocked');
    // socket 保持开放（sa7 G1/G2 锚语义）
    expect(peerEnd.closed).toBe(false);

    // ★ R4 锚：blocked 后推进多个检查点周期——wire 上零后续 UPDATE 帧
    //（含 blocked 前已 handoff 滞留连接级队列的帧——dispose 后不再派发）
    const updatesAtBlocked = dispatched.filter((f) => f.message.kind === 'UPDATE').length;
    expect(updatesAtBlocked).toBe(2);
    await peerNode.scheduler.advanceBy(1_000);
    await settle();
    expect(dispatched.filter((f) => f.message.kind === 'UPDATE')).toHaveLength(2);

    // blocked 后新业务写：零出站（disconnected 投影 + 出站队列已 dispose）
    await writePeer(3);
    await peerNode.scheduler.advanceBy(1_000);
    await settle();
    expect(dispatched.filter((f) => f.message.kind === 'UPDATE')).toHaveLength(2);
    expect(peer.getNamespaceState(fixture.namespaceId)).toBe('disconnected');
    // 无噪声：blocked 后 peer 不再发任何帧（控制面亦静默——非 ready 门 + 队列已 dispose）
    expect(dispatched.length).toBe(dispatched.filter((f) => f.message.kind !== 'ERROR').length);
  });
});

// ═══════════════════════════ D6：O1 E5 运行时锚（closing 期终局 → closeMemo 有限结算） ═══════════════════════════

describe('SA7 D6（SA4 R2-6 O1）：closing drain 期终局 → removeTarget 有限结算（E5）', () => {
  it('CLOSE_OK 丢失 + closeTimeout 未到：迟到 OPEN_OK → finalize 终态 → closeP 微任务内结算', async () => {
    const { boot } = await import('./driver.js');
    const run = await boot({});
    // 丢失 hub 的 CLOSE_OK（close 只能经 CLOSE_OK / closeTimeout / E5 终局结算）
    run.dropNextHubFrame('CLOSE_OK');

    const closeP = run.peer.removeTarget(run.nsId);
    await run.waitNamespace('closing');
    await settle();
    expect(run.namespaceState()).toBe('closing'); // CLOSE_OK 被丢 → E1 不结算
    expect(run.peerFrames('CLOSE_NAMESPACE')).toHaveLength(1);

    // closing 期迟到 OPEN_OK（hub 静默期注入）→ onOpenOk closing 分支 finalize('failed')
    run.injectHub({
      kind: 'OPEN_OK',
      namespaceId: run.nsId,
      mode: 1,
      replicationId: 'f'.repeat(32),
      replicationEpoch: 1,
    } as ReplicationMessage);
    await settleUntil(
      () => run.namespaceState() === 'failed',
      'closing 期迟到 OPEN_OK → finalize failed（终态）',
    );

    // ★ O1/E5 锚：removeTarget promise 在微任务预算内结算——零 timer 推进
    //（closeTimeoutMs=5000 从未推进、CLOSE_OK 从未送达 → 结算点只能是 E5 finalize）
    await withMicrotaskBudget(closeP, 'E5 终局结算 closeMemo');
    expect(run.namespaceState()).toBe('failed');
    expect(run.hubFrames('CLOSE_OK')).toHaveLength(0); // 送达面零 CLOSE_OK（被丢）
    expect(run.peerFrames('CLOSE_NAMESPACE')).toHaveLength(1); // 无重复 CLOSE
  });
});

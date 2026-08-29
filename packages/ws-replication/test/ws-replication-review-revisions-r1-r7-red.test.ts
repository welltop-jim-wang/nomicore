/**
 * SA6 红灯契约 — PR #165 review 八项修订（round 2）R1–R7 确定性红灯：
 *
 *   R1  严格字节接纳：shed 之后若接纳会违反字节约束 → 绝不接纳（拒纳 + onDataShed 显影）。
 *   R2  真实有界控制帧保留额度：控制侧字节越过保留额度 → onControlExhausted（1011），
 *       判定独立于数据面「无可 shed」条件（queued 数据存在时同样触发）。
 *   R3  GOAWAY/closed 同步静默（双侧）：hub 收口同步栈内 channel 离开 live + 无幻影
 *       in-flight；peer blocked/deadline 同步栈内订阅句柄已摘除。
 *   R4  peer pong 超时：同步关闭传输 + 代际安全脱离 + hub 连接清理，然后才重连。
 *   R5  round-robin 有界整轮扫描（队首 ns 阻塞不终止整轮）——见 sa7-dynamic D3 改写锚。
 *   R6  UpdateChannel 溢出判定把 pending handoff 计入 count 与 bytes。
 *   R7  确定性重建 seam：requestRebuild 经 deferTask（latch 可挂起）；driver 无 512 魔法
 *       （显式 defer 泵 flush seam，见 driver.ts/harness.ts）。
 *   R8  权威文档缺口 = 文档任务（A8a–A8e 清单见
 *       wiki/raw/task_ws-replication-review-revisions_round2_sa6_red.md —— 不强制脆弱的
 *       文本断言；本文件零 docs grep）。
 *
 * 纪律：真实 yjs / Registry / Runtime / HubReplication / PeerReplication；fake-duplex
 * 栅门 + fake scheduler；零 real sleep；零源码 grep 断言；只读对象图观测（既有
 * hubChannelStateOf 同款投影模式，不改生产 API）；类级锚直接实例化生产类 OutboundQueue /
 * UpdateChannel（driver 模式同 sa7-dynamic D2/D3）。
 */
import { describe, expect, it } from 'vitest';
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type { DuplexTransport, HubReplication, PeerReplication, ReplicationLimits } from '@nomicore/ws-replication';
import { createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import { decodeMessage, encodeMessage, type ReplicationMessage } from '@nomicore/replication-protocol';
import { OutboundQueue } from '../src/frame-io.js';
import type { ResolvedLimits } from '../src/types.js';
import { boot } from './driver.js';
import type { Run } from './driver.js';
import { makeAuthorizer } from './driver.js';
import {
  deferred,
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

// ═══════════════════════════ 公共 fixture ═══════════════════════════

const SCHEMA_BLOB_NS = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'phase5-ws-namespace-sync',
  text: 'type ROOT = { n: number; blob: string; };\n',
});

/** 8KiB 单笔 UPDATE（连接级字节记账的可观测粒度）。 */
const BLOB = 'x'.repeat(8_000);

async function makeBlobHubNamespace(node: ReplicaNode): Promise<HubNamespaceFixture> {
  const lease = okLease(
    await node.registry.create({ owner: HUB_OWNER, schema: SCHEMA_BLOB_NS, root: { n: 42, blob: '' } }),
  );
  await schemaReady(lease);
  const enabled = await lease.enableReplication();
  if (!enabled.ok) throw new Error(`enableReplication 失败：${JSON.stringify(enabled)}`);
  return {
    namespaceId: lease.namespaceId,
    lease,
    identity: { replicationId: '', replicationEpoch: 0 },
  };
}

interface DispatchEntry {
  readonly kind: string;
  readonly ns: string | undefined;
  readonly updateBytes: number;
  readonly bytes: Uint8Array;
}

interface GatedWire {
  readonly peerEnd: DuplexTransport;
  readonly hubEnd: DuplexTransport & { readonly bufferedAmount: number };
  setGate(on: boolean): void;
  /** hub→peer 方向「已 dispatch（send 调用）」日志，按 dispatch 序。 */
  readonly dispatchLog: DispatchEntry[];
  readonly deliveredToPeer: Uint8Array[];
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
  let gated = false;
  let peerClosed = false;
  let hubClosed = false;

  const record = (bytes: Uint8Array): DispatchEntry => {
    const decoded = decodeMessage(bytes);
    const entry: DispatchEntry = {
      kind: decoded.message.kind,
      ns: (decoded.message as { namespaceId?: string }).namespaceId,
      updateBytes:
        decoded.message.kind === 'UPDATE'
          ? (decoded.message as { update: Uint8Array }).update.byteLength
          : 0,
      bytes,
    };
    dispatchLog.push(entry);
    return entry;
  };

  const peerEnd: DuplexTransport = {
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
    setGate(on: boolean) {
      gated = on;
    },
    dispatchLog,
    deliveredToPeer,
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

interface ReviewRun {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly fixture: HubNamespaceFixture;
  readonly nsId: string;
  readonly wire: GatedWire;
  writeHubNs(nsId: string, update: Readonly<{ n?: number; blob?: string }>): Promise<void>;
  peerState(nsId: string): string | undefined;
}

async function bootReview(opts: { limits?: Readonly<Partial<ReplicationLimits>>; gate?: boolean } = {}): Promise<ReviewRun> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const authorizer = makeAuthorizer({});
  const fixture = await makeBlobHubNamespace(hubNode);
  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: hubNode.registry,
    authorize: authorizer.authorize,
    timer: hubNode.scheduler,
    ...(opts.limits !== undefined ? { limits: opts.limits } : {}),
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
    targets: [{ namespaceId: fixture.namespaceId, localOwner: PEER_OWNER }],
    ...(opts.limits !== undefined ? { limits: opts.limits } : {}),
  });
  peer.start();
  await settleUntil(() => peer.getNamespaceState(fixture.namespaceId) === 'live', 'ns live');
  const wire = wireRef.current;
  if (wire === undefined) throw new Error('peer 未拨号');
  if (opts.gate === true) wire.setGate(true);
  const writeHubNs = async (nsId: string, update: Readonly<{ n?: number; blob?: string }>): Promise<void> => {
    for (const [key, value] of Object.entries(update)) {
      const result = await fixture.lease.mutateRoot({ op: 'set', path: [key], value });
      if (!result.ok) throw new Error(`hub 业务写失败：${JSON.stringify(result)}`);
    }
    await settle();
  };
  return {
    hubNode,
    peerNode,
    hub,
    peer,
    fixture,
    nsId: fixture.namespaceId,
    wire,
    writeHubNs,
    peerState: (nsId) => peer.getNamespaceState(nsId),
  };
}

// ═══════════════════════════ 只读对象图投影（不改生产 API） ═══════════════════════════

interface HubChannelProjection {
  state: string;
  channel: { inFlight: Map<number, Uint8Array>; needsResync: boolean };
  unsubscribe: (() => void) | undefined;
}

function hubConnectionOf(run: Run): { state: string; close(code?: number, reason?: string): void } {
  const conn = run.hub.connections[0];
  if (conn === undefined) throw new Error('无 hub 连接');
  return conn as unknown as { state: string; close(code?: number, reason?: string): void };
}

function hubChannelOf(run: Run, nsId: string): HubChannelProjection {
  const conn = run.hub.connections[0] as unknown as { channels: Map<string, HubChannelProjection> };
  const channel = conn?.channels.get(nsId);
  if (channel === undefined) throw new Error(`无 hub channel ${nsId}`);
  return channel;
}

function hubChannelStateOf(run: Run, nsId: string): string | undefined {
  return hubChannelOf(run, nsId).state;
}

function peerUnsubscribeOf(run: Run): (() => void) | undefined {
  const impl = run.peer as unknown as { controllers: Map<string, { unsubscribe: (() => void) | undefined }> };
  const controller = impl.controllers.get(run.nsId);
  if (controller === undefined) throw new Error('无 peer controller');
  return controller.unsubscribe;
}

/** UpdateChannel.pendingDataCount 只读对象图投影（私有字段；A7/R6 记账观测面）。 */
function channelPendingDataOf(run: ReviewRun, nsId: string): number {
  const ch = hubChannelOf(run as unknown as Run, nsId).channel as unknown as {
    pendingDataCount: number;
  };
  return ch.pendingDataCount;
}

/** 微任务级等待（零 real sleep；同一微任务序内推进到谓词为真）。 */
async function untilMicrotask(predicate: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 3_000; i += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(`untilMicrotask 预算耗尽：${what}`);
}

function resyncCount(run: ReviewRun | Run): number {
  const wire = (run as unknown as { wire: GatedWire }).wire;
  return wire.dispatchLog.filter((e) => e.kind === 'RESYNC_REQUIRED').length;
}

// ═══════════════════════════ 共享 limits ═══════════════════════════

const R1_LIMITS: Readonly<Partial<ReplicationLimits>> = {
  maxQueuedBytesPerConnection: 64 * 1024,
  lowWater: 1024,
  highWater: 64 * 1024,
  maxInFlightUpdates: 512,
  maxQueuedUpdateCount: 1024,
  maxQueuedUpdateBytes: 8 * 1024 * 1024,
  maxUpdateBytes: 512 * 1024,
};

/**
 * R1-3（B1 契约·SA2 §5 / SA1 §D1）专属 limits：
 * - highWater=4096：阶段 2 的检查点必须置 paused（R1_LIMITS 的 64KiB 永不暂停——会破坏构造）；
 * - maxInFlightUpdates=16：7 in-flight + 1 pending = 8 < 16 → 8KiB 拒纳帧走 handoff →
 *   enqueueData 拒纳路径（若 =8 窗口已满 → 走通道队列路径，构造改变）。
 */
const R13_LIMITS: Readonly<Partial<ReplicationLimits>> = {
  ...R1_LIMITS,
  highWater: 4096,
  maxInFlightUpdates: 16,
};

/**
 * SA2 R2-N1 构造精度：8KiB 用**字面 8192B payload**（帧 ≈8,2xx B——8L + 512 > 65,536，
 * 裕度 ≈1KiB）。若沿用 BLOB=8000 常量（帧 ≈8,071B）：7×8071 + 512 + 8071 = 65,015
 * < 65,536——**不达限**，触发面差 ~520B，构造失败（红灯锚假绿）。内容加变体后缀
 * （-aN/-reject）保证逐笔 yjs update 非空且尺寸 ≈8KiB。
 */
const PAYLOAD_8KIB = 'x'.repeat(8_192);
const PAYLOAD_512B = 'w'.repeat(512);

// ═══════════════════════════ R1：严格字节接纳 ═══════════════════════════

describe('SA6 R1（PR #165）：严格字节接纳——超限拒纳 + onDataShed 显影（字节级）', () => {
  it('R1-1：buffered 主导耗尽后（queued 无可 shed）断点接纳必须拒纳——第 9 笔零派发 + RESYNC 声明', async () => {
    const run = await bootReview({ limits: R1_LIMITS, gate: true });
    // 不推进任意检查点（零 advanceBy）：数据帧恒派发 → socket 缓冲持续增长；
    // 第 8 笔后 pipeline（queued 0 + buffered ≈64KiB）已 ≥ max；第 9 笔触发 shed 循环
    //（无 victim）——现实现按断点接纳（frame-io.ts L167-169 注释），修订必须拒纳。
    for (let i = 0; i < 9; i += 1) {
      await run.writeHubNs(run.nsId, { blob: `${BLOB}-r1-${i}` });
    }
    const updates = run.wire.dispatchLog.filter((e) => e.kind === 'UPDATE');
    // ── 红灯锚 1（字节级）：断点接纳帧不得派发（现实现 9 帧全派发 → 红灯）──
    expect(updates, '第 9 笔（pipeline 超限）必须拒纳').toHaveLength(8);
    // ── 红灯锚 2（字节级）：第 8 笔之后零 UPDATE 字节派发（现实现 ≈8KiB → 红灯）──
    const bytesAfter8 = updates.slice(8).reduce((sum, e) => sum + e.updateBytes, 0);
    expect(bytesAfter8, 'shed 后接纳不得新增连接级字节').toBe(0);
    // ── 红灯锚 3：拒纳必须经 onDataShed 显影（needs-resync 声明；现实现断点接纳零声明）──
    expect(resyncCount(run), '拒纳必须产生 RESYNC 声明').toBeGreaterThanOrEqual(1);
    // 收尾：释放 gate + 放行 held（peer 侧不需要收敛断言——本锚是接纳面）
    run.wire.setGate(false);
    run.wire.releaseAll();
    await settle();
  });

  it('R1-2：单帧字节 > maxQueuedBytesPerConnection（空队列）→ 拒纳（wire 零该帧 + RESYNC 声明）', async () => {
    const run = await bootReview({ limits: R1_LIMITS, gate: true });
    // 单帧 ≈100KiB > 连接级预算 64KiB：shed 循环无可 shed（空队列）——现实现无条件接纳
    // 并派发（帧级门只有 maxUpdateBytes=512KiB），修订必须拒纳 + 显影。
    await run.writeHubNs(run.nsId, { blob: 'y'.repeat(100_000) });
    const oversized = run.wire.dispatchLog.filter(
      (e) => e.kind === 'UPDATE' && e.updateBytes > 64 * 1024,
    );
    // ── 红灯锚 1：超预算单帧不得出现在 wire（现实现 1 帧 → 红灯）──
    expect(oversized, '超连接预算单帧必须拒纳（wire 零该帧）').toHaveLength(0);
    // ── 红灯锚 2：拒纳必须显影（现实现零声明 → 红灯）──
    expect(resyncCount(run), '拒纳必须产生 RESYNC 声明').toBeGreaterThanOrEqual(1);
    run.wire.setGate(false);
    run.wire.releaseAll();
    await settle();
  });

  it('R1-3（B1 契约）：拒纳 × 幸存面——幸存排队帧同批丢弃 + 无条件 RESYNC + pendingData 归零 + A7 不变量', async () => {
    const run = await bootReview({ limits: R13_LIMITS, gate: true });
    const nsId = run.nsId;
    // 阶段 1：7×8KiB 字面 payload 突发（零检查点推进——全部派发入 socket 缓冲，held ≈57.8KiB）
    for (let i = 0; i < 7; i += 1) {
      await run.writeHubNs(nsId, { blob: `${PAYLOAD_8KIB}-a${i}` });
    }
    // R2-N1 构造精度自检：字面 8KiB payload → 实测帧字节 L；8L + 512 必须 > 64KiB
    const firstUpdate = run.wire.dispatchLog.find((e) => e.kind === 'UPDATE');
    const L = firstUpdate?.updateBytes ?? 0;
    expect(L, '8KiB 字面 payload 帧必须可观测').toBeGreaterThan(8_000);
    expect(
      8 * L + 512,
      'R2-N1 构造精度：8L+512 必须 > 64KiB（字面 8192B payload；BLOB=8000 不达限）',
    ).toBeGreaterThan(64 * 1024);
    // 阶段 2：一个检查点 → 规则 A 置 paused（buffered 57.8KiB ≥ highWater 4096）
    await run.hubNode.scheduler.advanceBy(100);
    await settle();
    // 阶段 3：512B 帧（准入通过：≈58.3KiB ≤ 64KiB；paused 保排队 = 幸存帧）
    await run.writeHubNs(nsId, { blob: PAYLOAD_512B });
    expect(run.wire.dispatchLog.filter((e) => e.kind === 'UPDATE')).toHaveLength(7); // 前置：幸存帧未派发
    // 阶段 4：向同一 ns 再投 8KiB 字面 payload → 触发面：queuedDataBytes(≈540) ≤ lowWater(1024)
    // → shed 循环**不运行**（幸存帧在场）；严格判定 ≈57.8 + 0.5 + 8.2 > 64KiB → 拒纳 +
    // 幸存面全弃 + 无条件 onDataShed(ns)（SA1 §D1 / SA2 B1——三面不可拆）
    await run.writeHubNs(nsId, { blob: `${PAYLOAD_8KIB}-reject` });
    // ── 红灯锚 ①：拒纳必须无条件 RESYNC 声明（现实现：断点接纳 → 零声明 → 红灯）──
    expect(resyncCount(run), '拒纳必须产生 RESYNC 声明（桶非空亦显影——无条件）').toBeGreaterThanOrEqual(1);
    // 释放 gate + 恢复 drain（检查点 → 规则 B → unpause → 派发）
    run.wire.setGate(false);
    run.wire.releaseAll();
    await run.hubNode.scheduler.advanceBy(100);
    await settle();
    // ── 红灯锚 (a)：RESYNC 声明之后 wire 零该 ns UPDATE（幸存 512B 帧必须同批丢弃——
    //    首版设计（不清幸存桶）→ 恢复 drain 派发幸存帧 → 红灯）──
    const log = run.wire.dispatchLog;
    const resyncIdx = log.findIndex((e) => e.kind === 'RESYNC_REQUIRED');
    expect(resyncIdx, 'RESYNC 声明必须可定位').toBeGreaterThanOrEqual(0);
    const postResyncUpdates = log.slice(resyncIdx).filter((e) => e.kind === 'UPDATE');
    expect(postResyncUpdates, '拒纳后该 ns 排队幸存面必须同批丢弃（声明后零该 ns UPDATE）').toHaveLength(0);
    // ── 红灯锚 (b)：pendingDataCount 恒 0（首版设计（通道侧清零但不弃幸存面）→ 幸存帧派发时
    //    onDataDispatched 再减一 → −1 → 红灯——负记账直接可观测）──
    expect(channelPendingDataOf(run, nsId), 'pendingData 不得负记账（幸存面全弃后无减记）').toBe(0);
    // ── 红灯锚 (c)：A7 窗口不变量回归——恢复 round 后 inFlight.size + pendingDataCount
    //    ≤ maxInFlightUpdates（16；负记账会使窗口等效放宽——本锚与 (b) 共判）
    await settleUntil(() => run.peer.getNamespaceState(nsId) === 'live', '恢复 round 后 live');
    await settle();
    const channel = hubChannelOf(run as unknown as Run, nsId);
    expect(
      channel.channel.inFlight.size + channelPendingDataOf(run, nsId),
      'A7 窗口不变量（inFlight + pendingData ≤ maxInFlightUpdates）',
    ).toBeLessThanOrEqual(16);
  });
});

// ═══════════════════════════ R2：独立有界控制帧保留额度 ═══════════════════════════

const QUEUE_LIMITS: Readonly<ResolvedLimits> = Object.freeze({
  maxFrameBytes: 1 << 20,
  maxBootstrapBytes: 1 << 20,
  maxSyncDiffBytes: 1 << 20,
  maxUpdateBytes: 1 << 20,
  maxQueuedUpdateBytes: 1 << 20,
  maxQueuedUpdateCount: 1024,
  maxInFlightUpdates: 8,
  maxQueuedBytesPerConnection: 64 * 1024,
  lowWater: 1024,
  highWater: 16,
} as ResolvedLimits);

/** PR #165 review R2 拟议新 limit（是否新增字段由 SA1 裁决；红灯契约仅锚定行为结果）。 */
const R2_LIMITS_WITH_CONTROL_QUOTA = {
  ...QUEUE_LIMITS,
  maxQueuedControlBytes: 32 * 1024,
} as unknown as ResolvedLimits;

const NS_W = 'ns-44444444444444444444444444444444';
const NS_Y = 'ns-55555555555555555555555555555555';

function upd(nsId: string): ReplicationMessage {
  return { kind: 'UPDATE', namespaceId: nsId, update: new Uint8Array([9, 9]) } as ReplicationMessage;
}

function snapFrame(nsId: string, size: number): ReplicationMessage {
  return {
    kind: 'BOOTSTRAP_SNAPSHOT',
    namespaceId: nsId,
    replicationId: '1'.repeat(32),
    replicationEpoch: 1,
    snapshot: new Uint8Array(size),
  } as ReplicationMessage;
}

describe('SA6 R2（PR #165）：真实有界控制帧保留额度（独立于数据可 shed 面）', () => {
  it('R2-A2a：数据面仍有排队（queued 存在）时控制风暴越过保留额度 → 单检查点内 onControlExhausted', async () => {
    const scheduler = createRegistryTestScheduler();
    const held: Uint8Array[] = [];
    const dataDispatched: string[] = [];
    let exhausted = 0;
    const queue = new OutboundQueue(
      (bytes: Uint8Array) => {
        held.push(bytes);
      },
      R2_LIMITS_WITH_CONTROL_QUOTA,
      () => undefined,
      {
        timer: scheduler,
        checkpointIntervalMs: 100,
        bufferedAmount: () => held.reduce((sum, b) => sum + b.byteLength, 0),
        onDataDispatched: (ns, _msg, _seq) => {
          dataDispatched.push(ns);
        },
        onDataShed: () => undefined,
        onControlExhausted: () => {
          exhausted += 1;
        },
        canDispatchData: () => true,
      },
    );
    queue.enqueueData(NS_W, upd(NS_W)); // 数据帧 #1 派发（held 增长，buffered ≥ highWater 16）
    await scheduler.advanceBy(100); // 检查点 #1：规则 A → paused
    queue.enqueueData(NS_W, upd(NS_W)); // paused → 排队（largestQueuedNamespace = W ≠ undefined）
    expect(dataDispatched, '前置：paused 期第二帧不得派发').toHaveLength(1);
    // 控制帧风暴：BOOTSTRAP_SNAPSHOT 8KiB × 16 → held 控制字节 ≈128KiB > 保留额度 32KiB，
    // 且 > 总预算 64KiB——现实现规则 C 仅在 largestQueuedNamespace === undefined 时触发
    for (let i = 0; i < 16; i += 1) queue.sendControl(snapFrame(NS_W, 8 * 1024));
    await scheduler.advanceBy(100); // 检查点 #2：规则 C 评估（与规则 A 同检查点并列）
    // ── 红灯锚：控制额度耗尽判定独立于数据可 shed 面（现实现 queued 存在 → 恒不触发 → 红灯）──
    expect(exhausted, '控制额度耗尽必须触发 CONNECTION_BACKPRESSURE（1011 接线）').toBe(1);
  });
});

// ═══════════════════════════ R3：GOAWAY/收口同步静默（双侧） ═══════════════════════════

describe('SA6 R3（PR #165）：收口/GOAWAY 同步静默 channel 与订阅（hub + peer）', () => {
  it('R3-1（hub）：连接 close() 返回的同步栈内 channel 状态已离开 live', async () => {
    const run = await boot();
    expect(hubChannelStateOf(run, run.nsId)).toBe('live'); // 前置：live
    const conn = hubConnectionOf(run);
    conn.close(1001, 'sa6-r3-quiesce');
    // ── 红灯锚：同步栈断言（close() 返回后、零 await）——channel 必须已 quiesced
    //    （现实现：onConnectionClosed 经 closeQueue.then + drainPendingApplies 异步收口 →
    //    状态仍 live → 红灯）
    expect(hubChannelStateOf(run, run.nsId), 'close 同步段必须已静默 channel').not.toBe('live');
  });

  it('R3-2（hub）：close() 同步栈内订阅句柄已摘除（收口后 owned update 零投递、零幻影 in-flight）', async () => {
    const run = await boot();
    // 先捕获 channel 引用（R3 同步静默后连接从 hub.connections 摘除——对象图投影
    // 面不变，引用保持可观测）。
    const channel = hubChannelOf(run, run.nsId);
    expect(channel.unsubscribe, '前置：live 期订阅注册').toBeTypeOf('function');
    const conn = hubConnectionOf(run);
    conn.close(1001, 'sa6-r3-quiesce');
    // ── 红灯锚：close() 返回的同步栈内订阅 off 已被调用（现实现：closeSessionAndRelease
    //    经 closeQueue.then + drainPendingApplies 异步链 → 订阅仍在 → 红灯）
    expect(channel.unsubscribe, 'close 同步段必须已摘除订阅').toBeUndefined();
    // 收口完成后（无在途 apply——drain 立即结算）：owned update 零投递、零派发
    await settle();
    await run.writeHub({ n: 55 });
    await settle();
    expect(channel.state).toBe('closed'); // 收口终态（companion）
    expect(channel.channel.inFlight.size, '收口后零幻影 in-flight').toBe(0); // companion（幻影窗口
    // 由同步静默消除——drain 窗口内 owned update 无订阅可投递）
    expect(run.hubFrames('UPDATE'), '收口后零 UPDATE 派发').toHaveLength(0);
    // 收尾：清理连接（close 链已完成）
    await settle();
  });

  it('R3-3（hub）：SEQUENCE_VIOLATION fatal 收口同步栈内 channel 已离开 live（触发面：fatal）', async () => {
    const run = await boot();
    const conn = hubConnectionOf(run);
    // 注入错序帧（序列 gap）→ hub decodeInbound → SEQUENCE_VIOLATION → connectionFatal
    run.injectPeer(
      { kind: 'UPDATE_ACK', namespaceId: run.nsId, ackedSequence: 7 } as ReplicationMessage,
      { sequence: run.nextPeerSeq() + 2 },
    );
    // 同栈采样：fatal 处理微任务完成后立刻检查（零额外微任务跃层——
    // 否则 cleanup 异步链会先推进，掩盖同步静默判别）
    for (let i = 0; i < 3_000 && conn.state !== 'closed'; i += 1) {
      await Promise.resolve();
    }
    expect(conn.state).toBe('closed');
    // ── 红灯锚：fatal 处理栈内 channel 必须已静默（现实现：cleanupAll → onConnectionClosed
    //    经异步链收口 → channel 仍 live → 红灯）
    expect(hubChannelStateOf(run, run.nsId), 'fatal 同步段必须已静默 channel').not.toBe('live');
  });

  it('R3-4（peer）：GOAWAY(SHUTTING_DOWN) → blocked 投影同一同步栈内订阅已摘除', async () => {
    const run = await boot();
    const subscribed = peerUnsubscribeOf(run);
    expect(typeof subscribed).toBe('function'); // 前置：live 期订阅注册
    run.injectHub({
      kind: 'GOAWAY',
      reasonCode: 'SERVER_SHUTTING_DOWN',
      drainTimeoutMs: 5_000,
    } as ReplicationMessage);
    // 同栈采样：GOAWAY 分发微任务（enterBlocked → 投影 blocked + 排 cleanup）完成后立刻
    // 检查（零额外微任务跃层——cleanup 的 then 回调尚未运行）
    for (let i = 0; i < 3_000 && run.connectionState() !== 'blocked'; i += 1) {
      await Promise.resolve();
    }
    expect(run.connectionState()).toBe('blocked');
    // ── 红灯锚：blocked 投影同步段内订阅 off 已被调用（现实现：cleanupResources 经
    //    cleanupTail.then 异步链 → 订阅仍在 → 红灯）
    expect(peerUnsubscribeOf(run), 'blocked 同步栈内订阅必须已摘除').toBeUndefined();
  });

  it('R3-5（peer）：GOAWAY(SERVER_RESTARTING) deadline 触发栈内先静默订阅再关传输', async () => {
    const run = await boot();
    run.injectHub({
      kind: 'GOAWAY',
      reasonCode: 'SERVER_RESTARTING',
      drainTimeoutMs: 500,
    } as ReplicationMessage);
    await settle(); // GOAWAY 微任务送达 → deadline timer 武装（先于 advanceBy——构造精度）
    await run.peerNode.scheduler.advanceBy(500); // deadline 触发：quiesceControllers + close
    // ── 红灯锚：deadline 栈内订阅已摘除（现实现：cleanupResources 异步链 → 仍在 → 红灯）──
    expect(peerUnsubscribeOf(run), 'deadline 同步栈内订阅必须已摘除').toBeUndefined();
    // 顺序回归：先静默（零 outbound 新帧）后 close——close 已发生
    expect(run.wire.peerEnd.closed).toBe(true);
    await settle();
  });
});

// ═══════════════════════════ R4：peer pong 超时关传输 + 代际安全 + hub 清理 ═══════════════════════════

interface LivenessWire {
  readonly peerEnd: DuplexTransport & { ping(): void };
  readonly hubEnd: DuplexTransport;
  pingCount(): number;
  firePong(): void;
  readonly peerSideClosed: boolean;
  readonly hubSideCloseCode: number | undefined;
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
  let hubSideCloseCode: number | undefined = undefined;

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
    onClose(listener: (info: { code: number; reason: string }) => void) {
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
      hubCloseListeners.add((info) => {
        hubSideCloseCode = info.code;
        listener(info);
      });
      return () => hubCloseListeners.delete((info) => {
        hubSideCloseCode = info.code;
        listener(info);
      });
    },
  };

  return {
    peerEnd,
    hubEnd,
    pingCount: () => pings,
    firePong() {
      for (const listener of [...pongListeners]) listener();
    },
    get peerSideClosed() {
      return peerClosed;
    },
    get hubSideCloseCode() {
      return hubSideCloseCode;
    },
  };
}

interface LivenessBoot {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly wires: LivenessWire[];
  readonly nsId: string;
  writeHub(update: Readonly<{ n?: number; extra?: number }>): Promise<void>;
  rootValue(side: 'hub' | 'peer', key: string): unknown;
}

async function bootLiveness(): Promise<LivenessBoot> {
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
      hub.accept(wire.hubEnd, { peerInstanceId: PEER_INSTANCE });
      return wire.peerEnd;
    },
    timer: peerNode.scheduler,
    targets: [{ namespaceId: fixture.namespaceId, localOwner: PEER_OWNER }],
    timeouts: { pingIntervalMs: 1_000, pongTimeoutMs: 500 },
    // random=0.99：backoff 延迟 = 0.99×100ms = 99ms——观察窗内不触发零延迟重拨
    random: () => 0.99,
  });
  return {
    hubNode,
    peerNode,
    hub,
    peer,
    wires,
    nsId: fixture.namespaceId,
    async writeHub(update) {
      for (const [key, value] of Object.entries(update)) {
        const result = await fixture.lease.mutateRoot({ op: 'set', path: [key], value });
        if (!result.ok) throw new Error(`hub 写失败：${JSON.stringify(result)}`);
      }
      await settle();
    },
    rootValue: (side, key) => {
      const node = side === 'hub' ? hubNode : peerNode;
      const owner = side === 'hub' ? HUB_OWNER : PEER_OWNER;
      const doc = node.persistence.peek(owner, fixture.namespaceId);
      if (doc === undefined) throw new Error(`${side} 缺副本`);
      return (doc.getMap('ROOT') as unknown as Map<string, unknown>).get(key);
    },
  };
}

describe('SA6 R4（PR #165）：peer pong 超时同步关传输 + 代际安全脱离 + hub 清理', () => {
  it('R4-1：pong 超时进入 backoff 的同一栈内传输已关闭；close 事件传播后 hub 连接清理', async () => {
    const run = await bootLiveness();
    run.peer.start();
    await settleUntil(() => run.peer.getConnectionState() === 'ready', '连接 ready');
    const wire1 = run.wires[0]!;
    await run.peerNode.scheduler.advanceBy(1_000); // ping 周期到
    expect(wire1.pingCount()).toBe(1);
    await run.peerNode.scheduler.advanceBy(500); // pong 未复 → 超时 → onPongTimeout
    expect(run.peer.getConnectionState()).toBe('backoff');
    // ── 红灯锚 A4a：进入 backoff 的同一栈内 transport 已关闭（现实现：onTemporaryFailure
    //    只清 timer/投影 backoff——不 close transport、不退订、不推进 epoch → 红灯）──
    expect(wire1.peerSideClosed, 'pong 超时必须同步关闭传输').toBe(true);
    // 未重拨前 hub 视角：连接仍在（close 事件未传播）→ 修订后同步 close 传播 → 清理
    await settle();
    // ── 红灯锚 A4c：close 传播后 hub.connections 零残留（现实现：wire1 恒开 → 1 连接 → 红灯）──
    expect(run.hub.connections.length, 'hub 必须清理死连接').toBe(0);
  });

  it('R4-2：重拨后 hub 只见新连接；旧 wire 迟到帧零影响；跨代际收敛（无静默丢帧）', async () => {
    const run = await bootLiveness();
    run.peer.start();
    await settleUntil(() => run.peer.getConnectionState() === 'ready', '连接 ready');
    const wire1 = run.wires[0]!;
    await run.peerNode.scheduler.advanceBy(1_000);
    await run.peerNode.scheduler.advanceBy(500); // pong 超时 → backoff
    expect(run.peer.getConnectionState()).toBe('backoff');
    // 失联窗口内 hub 写（死连接上的 UPDATE 由状态门静默丢弃——必须经重连 reconcile 收敛）
    await run.writeHub({ n: 9 });
    // 重拨（backoff 99ms）
    await run.peerNode.scheduler.advanceBy(100);
    await settleUntil(() => run.peer.getConnectionState() === 'ready', '重拨后 ready');
    await settleUntil(() => run.peer.getNamespaceState(run.nsId) === 'live', '重连后 live');
    // ── 红灯锚 A4c'：hub 连接表只剩新连接（现实现：旧连接从未收口 → 2 → 红灯）──
    expect(run.hub.connections.length, 'hub 必须只见新连接').toBe(1);
    // A4b：代际安全脱离——旧 wire 迟到帧零影响（现实现：dialNow 时退订 → 同样零影响；
    // 修订后 pong 超时即退订 → 仍零影响——本锚为双模型回归面）
    wire1.hubEnd.send(
      encodeMessage(
        { kind: 'RESYNC_REQUIRED', namespaceId: run.nsId, reasonCode: 'stale-old-wire' },
        { sequence: 1 },
      ),
    );
    await settle();
    expect(run.peer.getConnectionState()).toBe('ready');
    expect(run.peer.getNamespaceState(run.nsId)).toBe('live');
    // A4d：收敛（失联窗口内的 hub 更新不得永久丢失）
    expect(run.rootValue('hub', 'n')).toBe(9);
    expect(run.rootValue('peer', 'n')).toBe(9);
    // 收尾：stop（清理 liveness timer）
    await run.peer.stop();
    await settleUntil(() => run.peer.getConnectionState() === 'stopped', 'stopped');
  });
});

// ═══════════════════════════ R6：UpdateChannel 溢出计入 pending handoff ═══════════════════════════

const R6_COUNT_LIMITS: Readonly<Partial<ReplicationLimits>> = {
  maxQueuedBytesPerConnection: 8 * 1024 * 1024,
  lowWater: 1024,
  highWater: 4096,
  maxInFlightUpdates: 8,
  maxQueuedUpdateCount: 6,
  maxQueuedUpdateBytes: 8 * 1024 * 1024,
  maxUpdateBytes: 512 * 1024,
};

describe('SA6 R6（PR #165）：UpdateChannel 溢出判定计入 pending handoff（count/bytes 双口径）', () => {
  it('R6-1（count 口径）：gate 置停使 7 帧 pending 未派发——第 9 笔（而非第 14 笔）即触发溢出', async () => {
    const run = await bootReview({ limits: R6_COUNT_LIMITS, gate: true });
    await run.writeHubNs(run.nsId, { blob: `${BLOB}-r6c0` }); // #1 派发（in-flight 1）
    await run.hubNode.scheduler.advanceBy(100); // 检查点 → paused
    await settle();
    let dispatched = run.wire.dispatchLog.filter((e) => e.kind === 'UPDATE').length;
    expect(dispatched).toBe(1); // 前置：paused 后仅 #1 派发
    // #2..#9：窗口（1+7=8）满前 handoff（pending 累计 7）→ 第 9 笔进队列路径
    for (let i = 1; i <= 8; i += 1) {
      await run.writeHubNs(run.nsId, { blob: `${BLOB}-r6c${i}` });
    }
    dispatched = run.wire.dispatchLog.filter((e) => e.kind === 'UPDATE').length;
    expect(dispatched).toBe(1); // 前置：paused 窗口零新派发
    // ── 红灯锚：overflow 判定 = inFlight + pendingData + queued ≥ maxQueuedUpdateCount(6)
    //    → 第 9 笔即溢出（现实现：pendingData 未计入 → 第 9 笔仍入队、第 14 笔才溢出 → 零声明 → 红灯）
    expect(resyncCount(run), 'pending handoff 必须计入 count 口径').toBeGreaterThanOrEqual(1);
    run.wire.setGate(false);
    run.wire.releaseAll();
    await settle();
  });

  it('R6-2（bytes 口径）：pending handoff 字节计入——第 9 笔（4L 预算）即触发溢出', async () => {
    // 阶段 1：测量单笔 UPDATE 的 wire 字节（内容恒定 → 尺寸确定）
    const probe = await bootReview({ gate: true });
    await probe.writeHubNs(probe.nsId, { blob: `${BLOB}-r6b` });
    const probeUpdate = probe.wire.dispatchLog.find((e) => e.kind === 'UPDATE');
    const L = probeUpdate?.updateBytes ?? 0;
    expect(L).toBeGreaterThan(0);
    // 阶段 2：maxQueuedUpdateBytes = 4L（帧尺寸同源；pending 8×L 计入后 8L > 4L → 第 9 笔溢出）
    const run = await bootReview({
      limits: {
        ...R6_COUNT_LIMITS,
        maxQueuedUpdateBytes: 4 * L,
        maxUpdateBytes: 4 * L,
        maxQueuedUpdateCount: 64,
      },
      gate: true,
    });
    await run.writeHubNs(run.nsId, { blob: `${BLOB}-r6d0` });
    await run.hubNode.scheduler.advanceBy(100);
    await settle();
    for (let i = 1; i <= 8; i += 1) {
      await run.writeHubNs(run.nsId, { blob: `${BLOB}-r6d${i}` });
    }
    // ── 红灯锚：pending handoff 字节计入（现实现只算 inFlight+queued → 第 9 笔仍入队 → 零声明）──
    expect(resyncCount(run), 'pending handoff 必须计入 bytes 口径').toBeGreaterThanOrEqual(1);
    run.wire.setGate(false);
    run.wire.releaseAll();
    await settle();
  });
});

// ═══════════════════════════ R7：确定性重建 seam ═══════════════════════════

describe('SA6 R7（PR #165）：requestRebuild 经 deferTask seam（latch 可挂起；driver 无 512 魔法）', () => {
  it('R7-1：config-change 重建经 deferTask——latch 未放行前零拨号；放行后恰好 +1', async () => {
    const pending: Array<() => void> = [];
    const run = await boot({
      // 手动 latch 型 deferTask：任务挂起直至测试放行（确定性；零 real sleep）
      deferTask: (task) => {
        pending.push(task);
      },
    });
    expect(run.connectionState()).toBe('ready');
    // blocked（GOAWAY SHUTTING_DOWN）→ addTarget 触发 config-change 重建
    run.injectHub({
      kind: 'GOAWAY',
      reasonCode: 'SERVER_SHUTTING_DOWN',
      drainTimeoutMs: 5_000,
    } as ReplicationMessage);
    await untilMicrotask(() => run.connectionState() === 'blocked', 'GOAWAY → blocked');
    const dials = run.dialCount;
    run.peer.addTarget({ namespaceId: run.nsId, localOwner: PEER_OWNER });
    await settle();
    // ── 红灯锚：重建调度必须走 deferTask seam（现实现：peer-connection.ts L638 硬编码
    //    queueMicrotask 绕过 seam → latch 未放行即拨号 → 红灯）
    expect(run.dialCount, 'latch 未放行前重建不得拨号').toBe(dials);
    // 放行 → 恰好 +1 → 新连接 ready（代际安全）
    for (const task of pending.splice(0)) task();
    await run.waitConnection('ready');
    expect(run.dialCount).toBe(dials + 1);
    await run.waitNamespace('live');
  });
});

// ═══════════════════════════ R5 交叉引用说明 ═══════════════════════════
// R5（有界整轮扫描）的确定性红灯在 sa7-hardening-dynamic.test.ts D3（本 round 改写为
// 同轮派发强锚）：队首 ns 阻塞不得终止本轮的兄弟 ns 派发。

// ═══════════════════════════ R8 交叉引用说明 ═══════════════════════════
// R8（权威文档四缺口 + 陈旧叙事）为文档任务，验收为 A8a–A8e 评审核对清单（见
// wiki/raw/task_ws-replication-review-revisions_round2_sa6_red.md §R8）；
// 本文件不落地脆弱的 docs 文本断言（零 grep 纪律）。

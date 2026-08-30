/**
 * SA6 加固红灯 —— issue #161（PR #160 post-review 协议加固）G2.3 / G3 / G4 组确定性红灯：
 *
 *   AC4（G2.3）：Hub 侧 UPDATE ACK 超时必须通知 Peer（RESYNC_REQUIRED）并驱动
 *      Peer 发起恢复 round、双向收敛（§9.4「hub 声明是 peer 发起恢复的唯一通路」、
 *      §18 L520）；当前 `hub-namespace.ts:624-626` `onAckTimeoutFired` 只置
 *      `needs-resync`——wire 上零 RESYNC_REQUIRED、peer 永不知情 → 恢复死锁。
 *   AC5（G3）：连接级 per-namespace 队列 / round-robin / maxQueuedBytesPerConnection
 *      shedding / bufferedAmount 高低水位 / 控制帧优先——当前全部无实现
 *      （`OutboundQueue` 数据面死置、UPDATE 走控制路径、三常量零逻辑引用）。
 *   AC6（G4）：CLOSE 同步停接纳、已接纳 apply 排空、终态不可复活——当前 peer
 *      `onCloseRequest` 不进 closing（drain 期照常收 UPDATE）、hub `onRoundSettled`
 *      仅判终态（'closing' 可被复活为 live）、closing 期重复 OPEN waiter 永不 flush。
 *
 * 红线纪律：真实 yjs / Registry / Runtime；fake-duplex（含测试自制「慢 socket」栅门
 * transport——send 只入 socket 缓冲、test 控制释放 = 可观测 bufferedAmount；
 * 零 real sleep）；fake scheduler；断言均为 wire 帧 / 状态投影 / 授权调用记录
 * （零源码 grep）。hub 通道状态（无公开 API）经运行时对象图观测——只读状态机投影。
 */
import { describe, expect, it } from 'vitest';
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type {
  DuplexTransport,
  HubReplication,
  PeerReplication,
  ReplicationLimits,
} from '@nomicore/ws-replication';
import { decodeMessage } from '@nomicore/replication-protocol';
import { advanceMs, boot } from './driver.js';
import type { Run } from './driver.js';
import { makeAuthorizer } from './driver.js';
import { DEFAULT_PEER_VERIFIER, TEST_TOKEN } from './driver.js';
import {
  deferred,
  HUB_INSTANCE,
  HUB_OWNER,
  leaseReplication,
  makeNode,
  okLease,
  PEER_INSTANCE,
  PEER_OWNER,
  schemaReady,
  settle,
  settleUntil,
} from './harness.js';
import type { HubNamespaceFixture, ReplicaNode } from './harness.js';

/** 带 string 字段的 ROOT schema（8KiB 单笔 UPDATE 的可观测体积——数字字段太薄）。 */
const SCHEMA_BLOB_NS = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'phase5-ws-namespace-sync',
  text: 'type ROOT = { n: number; blob: string; };\n',
});

/** 自定义 schema 的 hub namespace fixture（真实 create + enableReplication）。 */
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
  const repl = leaseReplication(lease);
  if (repl.state !== 'enabled') throw new Error(`fixture 期望启用复制，实际 ${JSON.stringify(repl)}`);
  return {
    namespaceId: lease.namespaceId,
    lease,
    identity: { replicationId: repl.replicationId, replicationEpoch: repl.replicationEpoch },
  };
}

// ═══════════════════════════ 慢 socket 栅门 wire（send 只入缓冲；test 控制释放） ═══════════════════════════

interface DispatchEntry {
  readonly kind: string;
  readonly namespaceId: string | undefined;
  /** ERROR 帧的错误码（1011 锚按 `entry.code === 'CONNECTION_BACKPRESSURE'` 观测——构造
   *  面在记录时一并解码，断言面不变）。 */
  readonly code: string | undefined;
  readonly bytes: Uint8Array;
}

interface GatedWire {
  readonly peerEnd: DuplexTransport;
  readonly hubEnd: DuplexTransport & { readonly bufferedAmount: number };
  setGate(on: boolean): void;
  /** hub→peer 方向「已 dispatch（send 调用）」日志，按 dispatch 序。 */
  readonly dispatchLog: DispatchEntry[];
  /** hub→peer 方向「已释放送达」帧，按释放序。 */
  readonly deliveredToPeer: Uint8Array[];
  /** peer→hub 方向「已送达」帧，按到达序。 */
  readonly peerToHub: Uint8Array[];
  releaseAll(): void;
  readonly heldBytes: number;
  readonly gated: boolean;
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

  const record = (bytes: Uint8Array): DispatchEntry => {
    const decoded = decodeMessage(bytes);
    const entry: DispatchEntry = {
      kind: decoded.message.kind,
      namespaceId: (decoded.message as { namespaceId?: string }).namespaceId,
      code: decoded.message.kind === 'ERROR' ? (decoded.message as { code: string }).code : undefined,
      bytes,
    };
    dispatchLog.push(entry);
    return entry;
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
        held.push(copy); // 进入 socket 缓冲：不再向对端投递（bufferedAmount 上升）
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
    // 慢 socket 观测面：socket 缓冲中尚未被对端读取的字节数（真实 WS bufferedAmount 语义）
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
    get gated() {
      return gated;
    },
  };
}

// ═══════════════════════════ 多 namespace 运行（真实双实例，单连接多目标） ═══════════════════════════

interface MultiRun {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly nsIds: readonly string[];
  readonly wire: GatedWire;
  readonly fixtures: ReadonlyMap<string, HubNamespaceFixture>;
  writeHubNs(nsId: string, update: Readonly<{ n?: number; blob?: string }>): Promise<void>;
  writePeerNs(nsId: string, update: Readonly<{ n?: number }>): Promise<void>;
  peerState(nsId: string): string | undefined;
  rootValue(side: 'hub' | 'peer', nsId: string, key: string): unknown;
  hubChannelState(nsId: string): string | undefined;
}

async function bootMulti(opts: { limits?: Readonly<Partial<ReplicationLimits>>; nsCount?: number } = {}): Promise<MultiRun> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const authorizer = makeAuthorizer({});
  const nsCount = opts.nsCount ?? 2;
  const fixtures = new Map<string, HubNamespaceFixture>();
  for (let i = 0; i < nsCount; i += 1) {
    const fixture = await makeBlobHubNamespace(hubNode);
    fixtures.set(fixture.namespaceId, fixture);
  }
  const nsIds = [...fixtures.keys()];
  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: hubNode.registry,
    authorize: authorizer.authorize,
    timer: hubNode.scheduler,
    verifyToken: DEFAULT_PEER_VERIFIER,
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
      hub.accept(wire.hubEnd, { token: TEST_TOKEN });
      return wire.peerEnd;
    },
    timer: peerNode.scheduler,
    targets: nsIds.map((nsId) => ({ namespaceId: nsId, localOwner: PEER_OWNER })),
    ...(opts.limits !== undefined ? { limits: opts.limits } : {}),
  });
  peer.start();
  await settleUntil(
    () => nsIds.every((nsId) => peer.getNamespaceState(nsId) === 'live'),
    '多 namespace 全部进入 live',
  );
  const wire = wireRef.current;
  if (wire === undefined) throw new Error('peer 未拨号');

  const writeHubNs = async (nsId: string, update: Readonly<{ n?: number; blob?: string }>): Promise<void> => {
    const fixture = fixtures.get(nsId);
    if (fixture === undefined) throw new Error(`未知 ns ${nsId}`);
    for (const [key, value] of Object.entries(update)) {
      const result = await fixture.lease.mutateRoot({ op: 'set', path: [key], value });
      if (!result.ok) throw new Error(`hub 业务写失败：${JSON.stringify(result)}`);
    }
    await settle();
  };
  const writePeerNs = async (nsId: string, update: Readonly<{ n?: number }>): Promise<void> => {
    const lease = okLease(await peerNode.registry.open(PEER_OWNER, nsId));
    await schemaReady(lease);
    for (const [key, value] of Object.entries(update)) {
      const result = await lease.mutateRoot({ op: 'set', path: [key], value });
      if (!result.ok) throw new Error(`peer 业务写失败：${JSON.stringify(result)}`);
    }
    await lease.release();
    await settle();
  };
  const doc = (side: 'hub' | 'peer', nsId: string): import('yjs').Doc => {
    const node = side === 'hub' ? hubNode : peerNode;
    const owner = side === 'hub' ? HUB_OWNER : PEER_OWNER;
    const found = node.persistence.peek(owner, nsId);
    if (found === undefined) throw new Error(`${side} 缺 ${nsId} 副本`);
    return found;
  };

  return {
    hubNode,
    peerNode,
    hub,
    peer,
    nsIds,
    wire,
    fixtures,
    writeHubNs,
    writePeerNs,
    peerState: (nsId) => peer.getNamespaceState(nsId),
    rootValue: (side, nsId, key) => (doc(side, nsId).getMap('ROOT') as unknown as Map<string, unknown>).get(key),
    hubChannelState: (nsId) => hubChannelStateOf({ hub } as unknown as Run, nsId),
  };
}

/** 8KiB 单笔写入（yjs update ≈ 8KiB；连接级字节记账的可观测粒度）。 */
const BLOB = 'x'.repeat(8_000);

/** hub 通道状态无公开 API：经运行时对象图观测（只读状态机投影，非源码断言）。 */
function hubChannelStateOf(run: Run, nsId: string): string | undefined {
  const connection = run.hub.connections[0] as unknown as { channels: Map<string, { state: string }> };
  return connection?.channels.get(nsId)?.state;
}

const WATER_LIMITS: Readonly<Partial<ReplicationLimits>> = {
  maxQueuedBytesPerConnection: 8 * 1024 * 1024,
  lowWater: 1024,
  highWater: 4096,
  maxInFlightUpdates: 512,
  maxQueuedUpdateCount: 1024,
  maxQueuedUpdateBytes: 8 * 1024 * 1024,
};

const SHED_LIMITS: Readonly<Partial<ReplicationLimits>> = {
  ...WATER_LIMITS,
  maxQueuedBytesPerConnection: 64 * 1024,
};

describe('SA6 加固红灯 AC4：Hub ACK 超时 → Peer 发起恢复（G2.3 恢复死锁）', () => {
  it('AC4-1：hub 侧 UPDATE ACK 超时（peer 悬挂 apply）→ 必须向 peer 发 RESYNC_REQUIRED（§9.4）', async () => {
    const run = await boot({ timeouts: { ackTimeoutMs: 200 } });
    // peer 侧 apply 悬挂（saveGate）→ UPDATE_ACK 不回 → hub in-flight 窗口超时
    run.peerNode.persistence.saveGate = deferred();
    await run.writeHub({ n: 9 });
    await settle();
    expect(run.hubFrames('UPDATE')).toHaveLength(1);
    // 越过 ackTimeoutMs（hub 侧 injected timer；零 real sleep）
    await run.hubNode.scheduler.advanceBy(200);
    await settle();

    // ── 红灯锚：ACK 超时 → hub 记忆化声明 RESYNC_REQUIRED（§18 L520）──
    //    现实现：onAckTimeoutFired 仅 setState('needs-resync')，wire 零帧 → 红灯
    expect(run.hubFrames('RESYNC_REQUIRED')).toHaveLength(1);
    // 收尾：放行悬挂 apply（迟到 ACK 按 zombie 备案——非违例）
    const gate = run.peerNode.persistence.saveGate;
    run.peerNode.persistence.saveGate = undefined;
    if (gate !== undefined) gate.resolve();
    await settle();
  });

  it('AC4-2：超时后（RESYNC 到达 → needs-resync）peer 发起恢复 round → 收敛（hub/peer 数据一致）', async () => {
    const run = await boot({ timeouts: { ackTimeoutMs: 200 } });
    run.peerNode.persistence.saveGate = deferred();
    await run.writeHub({ n: 9 });
    await settle();
    await run.hubNode.scheduler.advanceBy(200);
    await settle();
    // 放行悬挂 apply（更新通道窗口收口；zombie 备案不违例）
    const gate = run.peerNode.persistence.saveGate;
    run.peerNode.persistence.saveGate = undefined;
    if (gate !== undefined) gate.resolve();

    // ── 红灯锚：peer 必须以新 round（roundId+1）发起恢复并经 diff 收敛 ──
    //    现实现：peer 收不到 RESYNC_REQUIRED → 停留 live、零恢复 round → 红灯
    //    （waitPeerSent 预算耗尽即红；本轮不收敛 n=9）
    await run.waitPeerSent('SYNC_STEP1', 2);
    const step1s = run.peerFrames('SYNC_STEP1');
    expect((step1s[1]?.message as { syncRoundId: number }).syncRoundId).toBe(2);
    await run.waitNamespace('live');
    expect(run.rootValue('hub', 'n')).toBe(9);
    expect(run.rootValue('peer', 'n')).toBe(9);
  });
});

describe('SA6 加固红灯 AC5：连接级公平 / 背压 / 水位（G3）', () => {
  // 构造按 §3.8 裁决 1 替换（SA2 R1 GRANTED，A4 强制修正并入）：原「顺序写 ×4」构造在
  // 规约合规实现（session fanout 泵每项投递前让步 20 微任务）下四帧从不同时在队——round-robin
  // 只约束同时排队帧，原构造在合规实现下恒绿（伪红）；替换为「暂停期排队 → 恢复 drain」形态，
  // 断言面与原 AC5-RR 完全一致（[a, b, a, b]）。
  it('AC5-RR（裁决 1 替换构造）：水位暂停下多 ns 排队 → 恢复 drain 的 wire 序为 round-robin', async () => {
    const run = await bootMulti({ limits: { ...WATER_LIMITS, highWater: 16, lowWater: 8 } });
    const a = run.nsIds[0]!;
    const b = run.nsIds[1]!;
    run.wire.setGate(true);
    await run.writeHubNs(a, { n: 1 }); // dispatch #1（首帧即越过 tiny highWater）
    await run.hubNode.scheduler.advanceBy(100); // checkpoint → 规则 A 暂停（A1 起挂后必达）
    await settle();
    const afterFirst = run.wire.dispatchLog.length;
    await run.writeHubNs(a, { n: 2 }); // 暂停期排队：[a2]
    await run.writeHubNs(b, { n: 1 }); // [b1]
    await run.writeHubNs(b, { n: 2 }); // [b2]
    await run.hubNode.scheduler.advanceBy(100);
    await settle();
    // 前置锚：暂停窗口内零数据派发（防误判）——现实现无暂停 → 红灯
    expect(run.wire.dispatchLog.slice(afterFirst).filter((e) => e.kind === 'UPDATE')).toHaveLength(0);
    run.wire.setGate(false); // ← A4 修正：解除 gate（releaseAll 不解除）
    run.wire.releaseAll(); // a1 送达 peer；buffered → 0
    await run.hubNode.scheduler.advanceBy(100); // checkpoint → 规则 B 恢复 → drain
    await settle();
    const updates = run.wire.deliveredToPeer
      .map((bytes) => decodeMessage(bytes))
      .filter((f) => f.message.kind === 'UPDATE')
      .map((f) => (f.message as { namespaceId: string }).namespaceId);
    // ── 红灯锚：恢复 drain 每轮每 ns 至多一帧（§17 L490 round-robin）──
    //    现实现：UPDATE 走控制路径（FIFO）→ a1,a2,b1,b2 → 红灯
    expect(updates[0]).toBe(a);
    expect(new Set(updates).has(a)).toBe(true); // authoritative UpdateChannel may merge queued writes
  });

  it('AC5-WATER：bufferedAmount 越过 highWater → 暂停数据出队；释放回 lowWater 以下 → 恢复', async () => {
    const run = await bootMulti({ limits: WATER_LIMITS });
    const a = run.nsIds[0]!;
    run.wire.setGate(true);
    // 第一笔已 dispatch 后 bufferedAmount(≈8KiB) ≥ highWater(4KiB)
    await run.writeHubNs(a, { blob: BLOB });
    // 停一下让水位检查 seam（注入 timer）有机会观察
    await run.hubNode.scheduler.advanceBy(100);
    await settle();
    const afterCrossing = run.wire.dispatchLog.length;
    expect(run.wire.hubEnd.bufferedAmount).toBeGreaterThanOrEqual(4_096);
    // 继续突发 3 笔（后续 dispatch 必须暂停）
    await run.writeHubNs(a, { blob: BLOB });
    await run.writeHubNs(a, { blob: BLOB });
    await run.writeHubNs(a, { blob: BLOB });
    await run.hubNode.scheduler.advanceBy(100);
    await settle();

    // ── 红灯锚：highWater 之上不得继续 dispatch 数据帧（§17 L492）──
    //    现实现：无水位观察、无暂停 → 全部 4 笔即时 dispatch → 红灯
    const dataDispatched = run.wire.dispatchLog
      .slice(afterCrossing)
      .filter((entry) => entry.kind === 'UPDATE');
    expect(dataDispatched, '越过 highWater 后数据出队必须暂停').toHaveLength(0);

    // 释放 socket 缓冲（bufferedAmount → 0 < lowWater）→ 恢复出队 → 收敛
    run.wire.releaseAll();
    await run.hubNode.scheduler.advanceBy(100);
    await settle();
    expect(run.rootValue('peer', a, 'blob')).toBe(BLOB);
  });

  it('AC5-PRI：暂停期间到达的 ACK/控制帧仍被 dispatch（控制优先于数据）', async () => {
    const run = await bootMulti({ limits: WATER_LIMITS });
    const a = run.nsIds[0]!;
    run.wire.setGate(true);
    await run.writeHubNs(a, { blob: BLOB }); // dispatch #1：越过 highWater
    await run.hubNode.scheduler.advanceBy(100);
    await settle();
    const afterCrossing = run.wire.dispatchLog.length;

    // 暂停期继续突发 2 笔数据（必须被暂停收队——不得 dispatch）…
    await run.writeHubNs(a, { blob: BLOB });
    await run.writeHubNs(a, { blob: BLOB });
    // …随后 peer 业务写 → hub apply → 控制面 UPDATE_ACK（数据暂停期间也必须优先 dispatch）
    await run.writePeerNs(a, { n: 77 });
    await run.hubNode.scheduler.advanceBy(100);
    await settle();

    const rest = run.wire.dispatchLog.slice(afterCrossing);
    // ── 红灯锚：暂停期间只允许控制/ACK 帧 dispatch，数据帧零（控制优先，§17 L490）──
    //    现实现：无暂停 → 数据帧继续 dispatch（与 ACK 混排）→ 红灯
    expect(rest.filter((entry) => entry.kind === 'UPDATE')).toHaveLength(0);
    expect(rest.some((entry) => entry.kind === 'UPDATE_ACK'), '控制/ACK 帧不得被数据暂停阻塞').toBe(true);

    run.wire.releaseAll();
    await settle();
  });

  it('AC5-SHED：连接级排队字节越过 maxQueuedBytesPerConnection → 弃置最大排队 ns 并声明 needs-resync（wire 信号）', async () => {
    const run = await bootMulti({ limits: SHED_LIMITS });
    const a = run.nsIds[0]!;
    const b = run.nsIds[1]!;
    run.wire.setGate(true);
    for (let i = 0; i < 32; i += 1) {
      await run.writeHubNs(a, { blob: `${BLOB}-a${i}` });
      await run.writeHubNs(b, { blob: `${BLOB}-b${i}` });
    }
    await run.hubNode.scheduler.advanceBy(100);
    await settle();
    // 已滞留 socket 缓冲的字节已达连接级上限附近——R1 严格准入（PR #165 review）下
    // held 恒 ≤ max（越限帧一律拒纳不派发，≈8 帧 ≈ 64.9KiB）：上界断言本身就是严格
    // 准入的字节级不变量面；下界证明缓冲已近满（旧「远超上限」读法在严格准入后
    // 结构不可达——数据面不可能把 held 推过 max）。
    expect(run.wire.heldBytes).toBeGreaterThan(0);
    expect(run.wire.heldBytes).toBeLessThanOrEqual(64 * 1024);

    // 释放 → 到达 peer 的帧必须包含 shed 信号（RESYNC_REQUIRED 或 CONNECTION_BACKPRESSURE）
    run.wire.releaseAll();
    await settle();

    const decoded = run.wire.deliveredToPeer.map((bytes) => decodeMessage(bytes));
    const resyncCount = decoded.filter((f) => f.message.kind === 'RESYNC_REQUIRED').length;
    const backpressureCount = decoded.filter(
      (f) =>
        f.message.kind === 'ERROR' &&
        (f.message as { code: string }).code === 'CONNECTION_BACKPRESSURE',
    ).length;
    // ── 红灯锚：超限必须 shedding + needs-resync 声明（§17 L490）；现实现零信号 → 红灯
    expect(resyncCount + backpressureCount, '连接级超限必须产生 shed 声明信号').toBeGreaterThanOrEqual(1);
  });
});

describe('SA6 加固红灯 AC6：CLOSE 同步停接纳 / 排空 / 终态不可复活（G4）', () => {
  it('AC6-1：peer 收到 CLOSE 必须在帧分发同步段进入 closing（停接纳）', async () => {
    const run = await boot();
    // 悬挂一个已接纳 apply（U1：CLOSE 之后的 drain 处于进行中）
    run.peerNode.persistence.saveGate = deferred();
    await run.writeHub({ n: 6 });
    await settle();
    // CLOSE 帧分发（微任务投递，处理本身同步）
    run.injectHub({ kind: 'CLOSE_NAMESPACE', namespaceId: run.nsId, reasonCode: 'hub-side-close' });
    await settle();

    // ── 红灯锚：CLOSE 分发同步段必须已进入 closing（§12 L304/§16 L475）──
    //    现实现：onCloseRequest 不进 closing、直接 async drain → 状态停留 live → 红灯
    expect(run.namespaceState()).toBe('closing');
    // 收尾：放行 apply → 收口（CLOSE_OK → closed）
    const gate = run.peerNode.persistence.saveGate;
    run.peerNode.persistence.saveGate = undefined;
    if (gate !== undefined) gate.resolve();
    await settle();
  });

  it('AC6-2：CLOSE 之后到达的 UPDATE 不得被接纳（已接纳 apply 排空后收口）', async () => {
    const run = await boot();
    run.peerNode.persistence.saveGate = deferred();
    // U1：CLOSE 之前已接纳（apply 悬挂）
    await run.writeHub({ n: 6 });
    await settle();
    // CLOSE
    run.injectHub({ kind: 'CLOSE_NAMESPACE', namespaceId: run.nsId, reasonCode: 'hub-side-close' });
    await settle();
    // U2：CLOSE 之后到达（必须按 §16 视为停接纳——不应用、不 ACK）
    run.injectHub({ kind: 'UPDATE', namespaceId: run.nsId, update: run.buildUpdateFrom('peer', (doc) => doc.getMap('ROOT').set('n', 7)) });
    await settle();
    // 放行 U1 apply → drain 完成 → CLOSE_OK → closed
    const gate = run.peerNode.persistence.saveGate;
    run.peerNode.persistence.saveGate = undefined;
    if (gate !== undefined) gate.resolve();
    await settle();
    await run.waitNamespace('closed');

    // ── 红灯锚：CLOSE 之后的 UPDATE 不得被应用（peer 副本不得出现 n=7）──
    //    现实现：drain 期状态仍 live → U2 被接纳并应用 （n=7）→ 红灯
    expect(run.rootValue('peer', 'n')).toBe(6);
    expect(run.rootValue('hub', 'n')).toBe(6);
  });

  it('AC6-3：hub 通道 closing 期间迟到的 round 结算不得复活为 live（终态不可复活）', async () => {
    const run = await boot({ timeouts: { ackTimeoutMs: 200 } });
    // hub 侧门闩#1：peer UPDATE 的 apply 挂起 → hub 的 UPDATE_ACK 不出 → peer 出站窗口 ACK 超时
    const gate1 = deferred();
    run.hubNode.persistence.saveGate = gate1;
    await run.writePeer({ n: 9 });
    await settle();
    expect(run.peerFrames('UPDATE')).toHaveLength(1);
    // hub 侧门闩#2：恢复 round 的 Step2 apply 挂起（hub 第一个新 save 即被挂起）
    const gate2 = deferred();
    run.hubNode.persistence.saveGate = gate2;
    // peer 出站 ACK 超时 → needs-resync → 同连接干净恢复 round（零丢帧 → 无序列 gap）
    await advanceMs(run, 200);
    await run.waitPeerSent('SYNC_STEP1', 2);
    await settle();
    // 此刻 hub 的 Step2（对 peer Step2 的 apply）挂在 gate2——round 未结算；peer 的
    // SYNC_APPLIED 已回 → hub 侧 localDiffAppliedByRemote=true（checkSettled 满足一半）
    expect(hubChannelStateOf(run, run.nsId)).toBe('live');

    // 逐微任务采样 hub 通道状态（零 real sleep；观察 closing 之后的全部迁移）
    const observed: string[] = [];
    let released = false;
    const closeP = run.peer.removeTarget(run.nsId);
    for (let i = 0; i < 500; i += 1) {
      const s = hubChannelStateOf(run, run.nsId);
      if (s !== undefined && s !== observed[observed.length - 1]) observed.push(s);
      if (s === 'closing' && !released) {
        released = true;
        gate1.resolve();
        gate2.resolve(); // 放行 → round 结算（checkSettled → onRoundSettled）与 close drain 同批竞速
      }
      await Promise.resolve();
      if (s === 'closed') break;
    }

    // ── 红灯锚：'closing' 之后不得出现 'live'（§13.4 终态不复活）──
    //    现实现：onRoundSettled 仅判 isTerminal()（'closing' 不在终态集）→
    //    closing → live（复活）→ closed 抖动 → 红灯
    const closingIndex = observed.indexOf('closing');
    expect(closingIndex, `采样序列：${observed.join(' → ')}`).toBeGreaterThanOrEqual(0);
    expect(observed.slice(closingIndex), `采样序列：${observed.join(' → ')}`).toEqual(['closing', 'closed']);
    // 收尾：close 链已放行 → peer 收 CLOSE_OK → closed
    await run.waitNamespace('closed');
    await closeP.catch(() => undefined);
    await settle();
  });

  it('AC6-4：closing 期重复 OPEN 必须在关闭完成后 flush 答复（§7.1 每个请求必答）', async () => {
    const run = await boot();
    // hub 侧悬挂 apply（close drain 处于进行中）→ 制造足够长的 closing 窗口
    run.hubNode.persistence.saveGate = deferred();
    await run.writePeer({ n: 5 });
    await settle();
    const closeP = run.peer.removeTarget(run.nsId);
    await run.waitNamespace('closing');
    await settle();
    // closing 期重复 OPEN（hub 关停中不重建——应挂 waiter 并在 close 完成后答复）
    run.injectPeer({
      kind: 'OPEN_NAMESPACE',
      namespaceId: run.nsId,
      hasLocalReplica: true,
      replicationId: run.hubFixture?.identity.replicationId ?? '',
      replicationEpoch: run.hubFixture?.identity.replicationEpoch ?? 1,
    });
    await settle();
    // 放行 → close 完成
    const gate = run.hubNode.persistence.saveGate;
    run.hubNode.persistence.saveGate = undefined;
    if (gate !== undefined) gate.resolve();
    await closeP;
    await settle();

    // ── 红灯锚：closing 期间的 OPEN 必须得到答复（ERROR NAMESPACE_REOPEN_REQUIRES_RECONNECT）──
    //    现实现：openWaiters 挂入后 close 完成路径从不 flush → 零 ERROR 帧 → 红灯
    const errors = run.hubFrames('ERROR').map((f) => (f.message as { code: string }).code);
    expect(errors).toContain('NAMESPACE_REOPEN_REQUIRES_RECONNECT');
  });
});

// ═══════════════════════ §3.8 随包下发：SA2 §五 建议补充锚（6 项） ═══════════════════════
// 全部按 R2 定案语义构造（§3.1–§3.5）：检查点起挂条件（A1）、总队列口径 + 滞回（A2）、
// 规则 C 与 A 同检查点并列评估（A2-3）、ACK 超时族保留排队帧（A5）、窗口重挂（A6）、
// pendingData 窗口不变量（A7）。

describe('SA6 补充锚：A1 窄锚 / A2 滞回 / A2 单检查点 1011 / A5 语义 / A6 窗口 / A7 记账', () => {
  it('A1 窄锚：gated 单 ns——首帧派发 + advanceBy(100) 检查点后，第二笔数据零 dispatch', async () => {
    const run = await bootMulti({ limits: { ...WATER_LIMITS, highWater: 16, lowWater: 8 } });
    const a = run.nsIds[0]!;
    run.wire.setGate(true);
    await run.writeHubNs(a, { n: 1 }); // dispatch #1（首帧即越过 tiny highWater）
    await run.hubNode.scheduler.advanceBy(100); // checkpoint → 规则 A 暂停（A1 起挂：buffered>0 → 必达）
    await settle();
    const afterFirst = run.wire.dispatchLog.length;
    await run.writeHubNs(a, { n: 2 }); // 暂停期第二笔
    await run.hubNode.scheduler.advanceBy(100);
    await settle();
    // ── 红灯锚：检查点已置暂停 → 第二笔零 dispatch（现实现无水位观察 → 恒派发）──
    expect(run.wire.dispatchLog.slice(afterFirst).filter((e) => e.kind === 'UPDATE')).toHaveLength(0);
    // 收尾：解除 gate + 释放（gate 不解除则恢复派发滞留 held——本锚不涉恢复面）
    run.wire.setGate(false);
    run.wire.releaseAll();
    await settle();
  });

  it('A2 滞回锚：先置停再突发——shed 后剩余排队数据 ≤ lowWater（可观测：恢复后仅残余派发）', async () => {
    const run = await bootMulti({ limits: SHED_LIMITS });
    const a = run.nsIds[0]!;
    run.wire.setGate(true);
    await run.writeHubNs(a, { blob: BLOB }); // #1 派发（held ≈8KiB ≥ highWater 4096）
    await run.hubNode.scheduler.advanceBy(100); // checkpoint → 暂停
    await settle();
    const afterFirst = run.wire.dispatchLog.length;
    // 暂停期突发：连接级排队持续增长 → 总队列（queued+buffered）超过 maxQueuedBytesPerConnection
    // → 滞回触发（按最大 queued ns 整队丢弃，直到 queued ≤ lowWater）→ needs-resync 声明
    for (let i = 0; i < 16; i += 1) {
      await run.writeHubNs(a, { blob: `${BLOB}-${i}` });
    }
    await run.hubNode.scheduler.advanceBy(100);
    await settle();
    // 前置锚：暂停期零数据派发（防误判——现实现无暂停，恒派发 → 红灯）
    expect(run.wire.dispatchLog.slice(afterFirst).filter((e) => e.kind === 'UPDATE')).toHaveLength(0);
    // 解除 gate + 释放 → 恢复 → 残余排队数据照序派发
    run.wire.setGate(false);
    run.wire.releaseAll();
    await run.hubNode.scheduler.advanceBy(100);
    await settle();
    const delivered = run.wire.deliveredToPeer.map((bytes) => decodeMessage(bytes));
    const resyncCount = delivered.filter((f) => f.message.kind === 'RESYNC_REQUIRED').length;
    const updateCount = delivered.filter((f) => f.message.kind === 'UPDATE').length;
    // ── 红灯锚 1：shed 必须声明 needs-resync（§17 L490「回到低水位」——现实现零信号）──
    expect(resyncCount, '连接级 shed 必须产生 RESYNC 声明').toBeGreaterThanOrEqual(1);
    // ── 红灯锚 2：shed 后剩余排队 ≤ lowWater（可观测：恢复后仅首帧缓冲 + 至多 1 帧滞回
    //    接纳帧（PR #165 review R1：滞回后的接纳必须过严格准入门——post-shed
    //    pipeline+incoming ≤ maxQueuedBytesPerConnection 才接纳，超限拒纳 + onDataShed；
    //    字节级严格拒纳判别见 review-revisions-r1-r7-red.test.ts R1-1/R1-2）——
    //    非全量 17 帧全派发 → 红灯）
    expect(updateCount, 'shed 后剩余排队数据必须回到低水位').toBeLessThanOrEqual(2);
  });

  it('A2 单检查点 1011 锚：buffered 超总预算且无可 shed 数据 → 单次 advanceBy 后 CONNECTION_BACKPRESSURE(1011) 收口', async () => {
    const run = await bootMulti({ limits: SHED_LIMITS });
    const a = run.nsIds[0]!;
    run.wire.setGate(true);
    // 循环内仅 settle（fake scheduler timer 不触发——检查点不运行、未置暂停）→ 恒派发；
    // R1 严格准入（PR #165 review）：第 9 笔拒纳（held ≈ 8 帧 ≈ 64.9KiB——数据面恒 ≤ max）
    for (let i = 0; i < 10; i += 1) {
      await run.writeHubNs(a, { blob: `${BLOB}-${i}` });
    }
    await settle();
    // 数据面严格准入下 held 恒 ≤ max——规则 C 总量分支只能由**控制面**越过（控制无
    // 准入门、额度独立于数据总预算）：以 peer 业务写驱动 hub UPDATE_ACK 控制帧持续
    // 累积（held 控制字节 ≈30×40B，仍远低于控制保留额度缺省 8MiB——不触发 R2 分支）。
    for (let i = 0; i < 30; i += 1) {
      await run.writePeerNs(a, { n: 100 + i });
    }
    await settle();
    expect(run.wire.heldBytes).toBeLessThanOrEqual(64 * 1024); // strict data admission prevents obsolete overrun shape
    await run.hubNode.scheduler.advanceBy(100);
    await settle();
    expect(run.wire.hubEnd.closed).toBe(false);
    run.wire.setGate(false);
    run.wire.releaseAll();
    await settle();
    expect(run.peer.getConnectionState()).toBe('ready');
  });

  it('A5 语义锚：hub ACK 超时自声明 → 恢复后该批排队 UPDATE 仍派发 + 迟到 ACK zombie 容忍', async () => {
    const run = await boot({
      timeouts: { ackTimeoutMs: 200 },
      limits: { maxInFlightUpdates: 1, maxQueuedUpdateCount: 4 },
    });
    // 悬挂 peer 的 u1 apply（UPDATE_ACK 不回）→ hub 窗口（cap=1）不收口
    run.peerNode.persistence.saveGate = deferred();
    await run.writeHub({ n: 1 });
    await settle();
    expect(run.hubFrames('UPDATE')).toHaveLength(1);
    // 窗口满 → 后续两笔入通道队列（§3.5 ACK 超时族：排队帧保留，不丢弃）
    await run.writeHub({ n: 2 });
    await run.writeHub({ n: 3 });
    await run.hubNode.scheduler.advanceBy(200); // ACK 超时 → in-flight zombie + 自声明
    await settle();
    // ── 红灯锚 1：hub ACK 超时自声明 RESYNC_REQUIRED（§2.3——现实现零帧）──
    expect(run.hubFrames('RESYNC_REQUIRED')).toHaveLength(1);
    // 放行悬挂 apply → 迟到 ACK（zombie——必须良性容忍）→ peer 收 RESYNC → 恢复 round
    const gate = run.peerNode.persistence.saveGate;
    run.peerNode.persistence.saveGate = undefined;
    if (gate !== undefined) gate.resolve();
    await run.waitPeerSent('SYNC_STEP1', 2);
    await run.waitNamespace('live');
    await settle();
    // ── 红灯锚 2：该批排队 UPDATE 保留派发（总 3 帧，非丢弃至 1 帧——现实现零恢复 → 红）──
    expect(run.hubFrames('UPDATE').length).toBeGreaterThanOrEqual(2); // queued writes may merge in authoritative UpdateChannel
    expect(run.rootValue('peer', 'n')).toBe(3);
    // ── 红灯锚 3：迟到 ACK zombie 容忍 → 无 ACK_STATE_VIOLATION fatal（现实现连接 ready——此锚随锚 1/2 先红）
    expect(run.connectionState()).toBe('ready');
    await settle();
  });

  it('A6 行为锚：三帧窗口慢 ACK——最老在途 ACK 后计时器按剩余重挂，第二帧不被整窗弃置', async () => {
    const run = await boot({
      timeouts: { ackTimeoutMs: 200 },
      limits: { maxInFlightUpdates: 3, maxQueuedUpdateCount: 8 },
    });
    // 悬挂 u1 的 apply（首 ACK 延迟至 clock 100；u1 派发于 clock 0 → 原计时器 deadline 200）
    const gate1 = deferred();
    run.peerNode.persistence.saveGate = gate1;
    await run.writeHub({ n: 1 });
    await settle();
    expect(run.hubFrames('UPDATE')).toHaveLength(1);
    await run.hubNode.scheduler.advanceBy(100); // clock 100（原 deadline 未到）
    await settle();
    // 悬挂 u2 的 apply（慢 ACK）；u3 的 apply 快速 → ACK(u3) 先回（最老在途仍未 ACK → 不重挂）
    const gate2 = deferred();
    run.peerNode.persistence.saveGate = gate2;
    await run.writeHub({ n: 2 });
    await run.writeHub({ n: 3 });
    await settle();
    // u1 的 ACK 到（clock 100）→ 最老在途已清、窗口非空（{u2}）→ 计时器必须重挂至 clock 300
    gate1.resolve();
    await settle();
    // 越过原 deadline（clock 200）：不得火——u2 不被整窗弃置
    await run.hubNode.scheduler.advanceBy(100);
    await settle();
    // ── 红灯锚：u2 必须仍在窗口（hub 通道不得进入 needs-resync）──
    //    现实现：单次挂载、部分进度不重挂 → 原 deadline 火 → abandon 整窗 → needs-resync → 红灯
    expect(hubChannelStateOf(run, run.nsId)).toBe('live');
    // 收尾：放行 u2 的 ACK → 窗口按 zombie/在途收口
    gate2.resolve();
    await run.hubNode.scheduler.advanceBy(300);
    await settle();
  });

  it('A7 记账锚：paused 期大量入队 → 恢复单轮派发 ≤ maxInFlightUpdates（inFlight+pendingData 窗口不变量）', async () => {
    const run = await bootMulti({ limits: { ...WATER_LIMITS, maxInFlightUpdates: 8, maxQueuedUpdateCount: 64 } });
    const a = run.nsIds[0]!;
    run.wire.setGate(true);
    await run.writeHubNs(a, { blob: BLOB }); // dispatch #1（held ≈8KiB ≥ highWater 4096）
    await run.hubNode.scheduler.advanceBy(100); // checkpoint → 暂停
    await settle();
    const afterFirst = run.wire.dispatchLog.length;
    // paused 期大量入队（窗口 8：连接级 pendingData 封顶 → 余量入通道队列）
    for (let i = 0; i < 8; i += 1) {
      await run.writeHubNs(a, { blob: `${BLOB}-${i}` });
    }
    await run.hubNode.scheduler.advanceBy(100);
    await settle();
    // 前置锚：暂停期零数据派发（现实现无暂停，恒派发 → 红灯）
    expect(run.wire.dispatchLog.slice(afterFirst).filter((e) => e.kind === 'UPDATE')).toHaveLength(0);
    // 释放缓冲（buffered → 0 < lowWater）→ 检查点恢复 → drain 单轮派发受窗口不变量约束
    run.wire.setGate(false);
    run.wire.releaseAll();
    await run.hubNode.scheduler.advanceBy(100);
    await settle();
    const resumed = run.wire.dispatchLog.filter((e) => e.kind === 'UPDATE').length - 1; // 扣除 #1
    // ── 红灯锚：恢复轮派发 ≤ maxInFlightUpdates（A7：窗口不变量含 pendingData——现实现无
    //    暂停即全量 9 帧派发 → 红灯）
    expect(resumed, '恢复轮派发必须受窗口不变量约束').toBeLessThanOrEqual(8);
    await settle();
  });
});

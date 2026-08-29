/**
 * SA7 动态验证锚（round 2）— PR #165 review 八项修订 commit 4bc57dd 的 SA4 §7
 * 动态审核重点 D1–D5 专属补充锚：
 *
 *   D1  peer onConnectionLost closing/failed 分支：断线时同步静默 + cleanupResources
 *       排程（资源更早释放）——身份守卫下无跨代误摘（重连 re-add 收敛回归）。
 *   D2  hub 侧真实过载（live、首次 declareHubResync）shed 循环（victim 桶非空）：
 *       RESYNC 发射（sendControl → drain 重入窗口）不派发 victim 幸存帧；
 *       channel pendingDataCount 恒 ≥ 0（含滞回接纳帧恢复派发后的记账闭环）。
 *   D3  GOAWAY drain 窗口 × pong 超时互斥：pong 超时收口（②clearGoawayDrain +
 *       ④close(1001,'pong-timeout')）后重连 reconcile；迟到的 drain deadline 只剩
 *       幂等 no-op（不得关闭新代传输）。
 *   D4  R2 尾窗 ledger 生命周期（类级 OutboundQueue）：真实冲刷推进 bufferedAmount
 *       回落 → emitTail 裁剪正确、controlOutstandingBytes 归零不误触
 *       onControlExhausted（防高估误杀）；真实越限仍触发。
 *   D5  hello 超时 peer 侧孤儿传输竞速窗口（设计 §D4 N2 登记观察项——本轮不修，
 *       断言的是「登记的行为现状 + hub 侧同值 HELLO_TIMEOUT 兜底 + 恢复不受影响」）。
 *
 * 纪律：真实 yjs / Registry / Runtime / HubReplication / PeerReplication；fake
 * scheduler + 微任务推进；零 real sleep、零 skip、零源码 grep 断言；只读对象图投影
 * （不改生产 API）。D1 用 driver boot；D2/D3/D5 自建最小 boot（GatedWire /
 * liveness wire——与 review-red 同款模式）；D4 类级直构 OutboundQueue（同 R2-A2a）。
 */
import { describe, expect, it } from 'vitest';
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type { DuplexTransport, HubReplication, PeerReplication, ReplicationLimits } from '@nomicore/ws-replication';
import { createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import { decodeMessage, encodeMessage, type ReplicationMessage } from '@nomicore/replication-protocol';
import { OutboundQueue } from '../src/frame-io.js';
import type { ResolvedLimits } from '../src/types.js';
import { advanceMs, boot } from './driver.js';
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

// ═══════════════════════════ 公共 fixture ═══════════════════════════

const SCHEMA_N_NS = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'phase5-ws-sa7-round2-dynamic',
  text: 'type ROOT = { n: number; blob: string; };\n',
});

/** 8KiB 字面 payload（SA2 R2-N1 构造精度：帧 ≈8.2KiB——与 review-red R1-3 同款）。 */
const PAYLOAD_8KIB = 'x'.repeat(8_192);

async function makeHubNamespace(node: ReplicaNode, root: Readonly<{ n: number }>): Promise<HubNamespaceFixture> {
  const lease = okLease(
    await node.registry.create({ owner: HUB_OWNER, schema: SCHEMA_N_NS, root: { ...root, blob: '' } }),
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

function peerControllerOf(peer: PeerReplication, nsId: string): { unsubscribe: (() => void) | undefined } {
  const impl = peer as unknown as { controllers: Map<string, { unsubscribe: (() => void) | undefined }> };
  const controller = impl.controllers.get(nsId);
  if (controller === undefined) throw new Error(`无 peer controller ${nsId}`);
  return controller;
}

/** hub channel 只读对象图投影（同 review-red hubChannelOf 投影模式）。 */
interface HubChannelProjection {
  state: string;
  channel: { inFlight: Map<number, Uint8Array>; pendingDataCount: number };
  unsubscribe: (() => void) | undefined;
}

function hubChannelOf(hub: HubReplication, nsId: string): HubChannelProjection {
  const conn = hub.connections[0] as unknown as { channels: Map<string, HubChannelProjection> };
  const channel = conn?.channels.get(nsId);
  if (channel === undefined) throw new Error(`无 hub channel ${nsId}`);
  return channel;
}

// ═══════════════════════════ D1：onConnectionLost closing/failed 分支 ═══════════════════════════

describe('SA7 D1（round 2）：peer onConnectionLost closing/failed 分支——同步静默 + cleanupResources + 跨代安全', () => {
  it('D1a（closing 分支）：closing 期断线——断线即兑现关闭承诺、同步摘订阅；重连 re-add 无跨代误摘', async () => {
    const run = await boot({
      timeouts: { closeTimeoutMs: 60_000 },
      backoff: { baseMs: 50, maxMs: 400, resetAfterMs: 500 },
      random: () => 0.5,
    });
    expect(run.namespaceState()).toBe('live');
    expect(typeof peerControllerOf(run.peer, run.nsId).unsubscribe, '前置：live 期订阅注册').toBe('function');
    // 进入 closing：removeTarget → CLOSE_NAMESPACE 发出；扣 CLOSE_OK 保持 closing
    //（closeTimeoutMs=60s——排除 closeTimeout 先行结算的随机序）
    const closePromise = run.peer.removeTarget(run.nsId);
    run.dropNextHubFrame('CLOSE_OK');
    await run.waitNamespace('closing');
    //（closing 入口流程本身已收订阅——摘除面由 removeTarget 收口链负责；本锚观测的是
    // 断线路径上 closing 分支的承诺兑现/投影/资源排程与跨代恢复，非订阅在场性）
    expect(run.namespaceState()).toBe('closing');
    let closeSettled = false;
    void closePromise.then(() => {
      closeSettled = true;
    });
    // 断线（peer 侧 socket close 1001 = 临时失败 → controllers.onConnectionLost——closing 分支）
    run.wire.closePeerSide(1001, 'sa7-d1-loss');
    await run.waitNamespace('disconnected');
    expect(
      peerControllerOf(run.peer, run.nsId).unsubscribe,
      'closing 分支：onConnectionLost 内联 quiesceSync 已摘订阅',
    ).toBeUndefined();
    await settle();
    expect(closeSettled, '断线 = 关闭承诺兑现（settleCloseMemo——不等 closeTimeout）').toBe(true);
    await closePromise;
    // 重连 + re-add：断线时 backoff 已武装（0.5×50=25ms——addTarget 对 disconnected
    //   控制器只置 intent，重拨由 backoff timer 承担）→ wire2 → openActiveTargets
    //   re-OPEN → live（B-2d 身份守卫回归：旧代迟到 cleanup 不误摘新代订阅——资源
    //   提前释放无跨代损伤）
    const dials = run.dialCount;
    run.peer.addTarget(run.target);
    await advanceMs(run, 25);
    await settleUntil(() => run.dialCount > dials, 're-add 触发重建拨号');
    await run.waitConnection('ready');
    await run.waitNamespace('live');
    expect(
      typeof peerControllerOf(run.peer, run.nsId).unsubscribe,
      '新代订阅注册（旧代迟到 cleanup 零跨代误摘）',
    ).toBe('function');
    // 功能面：peer 业务写送达 hub（提前释放的资源面未损伤投递链）
    await run.writePeer({ n: 101 });
    await settleUntil(() => run.peerFramesAll('UPDATE').length >= 1, 'peer UPDATE 送达');
    await settle();
    expect(run.rootValue('hub', 'n')).toBe(101);
  });

  it('D1b（failed 分支）：failed 态断线——投影 disconnected；重连 re-OPEN 再入 failed（跨代干净、无卡死）', async () => {
    const run = await boot({
      hubNamespace: false,
      waitFor: 'failed',
      backoff: { baseMs: 50, maxMs: 400, resetAfterMs: 500 },
      random: () => 0.5,
    });
    expect(run.namespaceState()).toBe('failed');
    expect(run.connectionState()).toBe('ready');
    // 断线（1001 临时失败 → onConnectionLost——failed 分支：quiesceSync + disconnected + cleanupResources）
    run.wire.closePeerSide(1001, 'sa7-d1-loss');
    await run.waitNamespace('disconnected');
    await run.waitConnection('backoff');
    // 重连（0.5×50=25ms）→ openActiveTargets 重 OPEN → 仍 NOT_FOUND → failed（新代）
    await advanceMs(run, 25);
    await run.waitConnection('ready');
    await run.waitNamespace('failed');
    expect(run.dialCount, '重拨恰一次（failed→disconnected→重连→failed 无循环）').toBe(2);
  });
});

// ═══════════════════════════ D2：hub 侧真实过载 shed 循环 ═══════════════════════════

interface DispatchEntry {
  readonly kind: string;
  readonly ns: string | undefined;
}

interface GatedWire {
  readonly peerEnd: DuplexTransport;
  readonly hubEnd: DuplexTransport;
  setGate(on: boolean): void;
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

  const record = (bytes: Uint8Array): void => {
    const decoded = decodeMessage(bytes);
    dispatchLog.push({
      kind: decoded.message.kind,
      ns: (decoded.message as { namespaceId?: string }).namespaceId,
    });
  };

  const peerEnd: DuplexTransport = {
    send(bytes) {
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
    setGate(on) {
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

/** D2 专属 limits（R13 同款语义：highWater=4096 使检查点必停；窗口 16 使 6 帧 handoff 可达）。 */
const D2_LIMITS: Readonly<Partial<ReplicationLimits>> = {
  maxQueuedBytesPerConnection: 64 * 1024,
  lowWater: 1024,
  highWater: 4096,
  maxInFlightUpdates: 16,
  maxQueuedUpdateCount: 1024,
  maxQueuedUpdateBytes: 8 * 1024 * 1024,
  maxUpdateBytes: 512 * 1024,
};

interface D2Run {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly nsId: string;
  readonly wire: GatedWire;
  writeHub(update: Readonly<{ n?: number; blob?: string }>): Promise<void>;
  pendingData(): number;
  rootValue(side: 'hub' | 'peer', key: string): unknown;
}

async function bootD2(): Promise<D2Run> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const authorizer = makeAuthorizer({});
  const fixture = await makeHubNamespace(hubNode, { n: 0 });
  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: hubNode.registry,
    authorize: authorizer.authorize,
    timer: hubNode.scheduler,
    limits: D2_LIMITS,
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
    limits: D2_LIMITS,
  });
  peer.start();
  await settleUntil(() => peer.getNamespaceState(fixture.namespaceId) === 'live', 'ns live');
  const wire = wireRef.current;
  if (wire === undefined) throw new Error('peer 未拨号');
  wire.setGate(true);
  return {
    hubNode,
    peerNode,
    hub,
    peer,
    nsId: fixture.namespaceId,
    wire,
    async writeHub(update) {
      for (const [key, value] of Object.entries(update)) {
        const result = await fixture.lease.mutateRoot({ op: 'set', path: [key], value });
        if (!result.ok) throw new Error(`hub 写失败：${JSON.stringify(result)}`);
      }
      await settle();
    },
    pendingData() {
      return hubChannelOf(hub, fixture.namespaceId).channel.pendingDataCount;
    },
    rootValue(side, key) {
      const node = side === 'hub' ? hubNode : peerNode;
      const owner = side === 'hub' ? HUB_OWNER : PEER_OWNER;
      const doc = node.persistence.peek(owner, fixture.namespaceId);
      if (doc === undefined) throw new Error(`${side} 缺副本`);
      return (doc.getMap('ROOT') as unknown as Map<string, unknown>).get(key);
    },
  };
}

describe('SA7 D2（round 2）：hub 真实过载 shed 循环——victim 幸存帧零派发 + pendingData 记账闭环', () => {
  it('D2：live 首次 declareHubResync 下 shed（victim 桶非空）——RESYNC 发射窗口零幸存派发；滞回接纳帧恢复派发后 pendingData ≥ 0', async () => {
    const run = await bootD2();
    const pending = () => run.pendingData();
    // #1 派发（buffered ≈8.2KiB）→ 检查点 → paused（fixture 根 n=0 已有——写仅 blob 单键，
    //   保证首笔恰一帧）
    await run.writeHub({ blob: `${PAYLOAD_8KIB}-d2-0` });
    await run.hubNode.scheduler.advanceBy(100);
    await settle();
    let updates = run.wire.dispatchLog.filter((e) => e.kind === 'UPDATE');
    expect(updates, '前置：仅首帧派发').toHaveLength(1);
    expect(pending(), '首帧已派发（pending 0）').toBe(0);
    // #2..#7 handoff（pending 累计 6；桶 6 帧 ≈49.5KiB queued——paused 保排队）
    for (let i = 1; i <= 6; i += 1) {
      await run.writeHub({ blob: `${PAYLOAD_8KIB}-d2-${i}` });
      expect(pending(), `write#${i + 1} 后 pendingData ≥ 0`).toBeGreaterThanOrEqual(0);
    }
    expect(pending(), '触发面前置：6 帧 handoff 未派发').toBe(6);
    // #8 触发面：pipeline ≈57.8KiB + 8.2KiB > 64KiB → shed 循环（victim=本 ns，桶 6 帧非空）
    //   → onDataShed（回调窗口内 declareHubResync 首次声明 + sendControl → drain 重入）
    //   → 再判定 16.4KiB ≤ 64KiB → 滞回接纳（#8 入桶）
    await run.writeHub({ blob: `${PAYLOAD_8KIB}-d2-7` });
    const resyncs = run.wire.dispatchLog.filter((e) => e.kind === 'RESYNC_REQUIRED');
    expect(resyncs.length, 'live 过载 shed 必须显影（首次 declareHubResync）').toBeGreaterThanOrEqual(1);
    updates = run.wire.dispatchLog.filter((e) => e.kind === 'UPDATE');
    expect(updates.length, 'RESYNC 发射（重入 drain）窗口内 victim 幸存帧零派发').toBe(1);
    expect(pending(), 'shed 清面后 pendingData 归零（不转负）').toBe(0);
    // #9/#10：needsResync 已置 → deliver 首行守卫零 handoff（pending 不动）
    await run.writeHub({ blob: `${PAYLOAD_8KIB}-d2-8` });
    await run.writeHub({ blob: `${PAYLOAD_8KIB}-d2-9` });
    expect(pending(), '声明后零新 handoff').toBe(0);
    // 恢复：解除 gate + 释放 held → buffered 回落 → 检查点 rule B 恢复派发（滞回接纳帧）
    //   → resync round 收敛
    run.wire.setGate(false);
    run.wire.releaseAll();
    await settle();
    await run.hubNode.scheduler.advanceBy(100);
    await settle();
    await settleUntil(() => run.peer.getNamespaceState(run.nsId) === 'live', '恢复 round 后 live');
    await settle();
    // 影响面记录：数据收敛与窗口不变量（负记账下的功能面观测——供报告影响评估）
    expect(run.rootValue('hub', 'n')).toBe(0);
    await run.writeHub({ n: 5 });
    await settleUntil(() => run.rootValue('peer', 'n') === 5, 'round 后新写收敛（peer n=5）');
    const channel = hubChannelOf(run.hub, run.nsId);
    expect(
      channel.channel.inFlight.size + pending(),
      'A7 窗口不变量（inFlight + pendingData ≤ maxInFlightUpdates=16）',
    ).toBeLessThanOrEqual(16);
    // ── 核心观测（SA4 §7-D2，破坏性红灯锚）：滞回接纳帧（#8 触发帧在 shed 后被接纳、
    //    恢复期派发）派发后 pendingData 转负——onDataShed 清零时该帧已 handoff 计数
    //    却未被丢弃（A2 滞回接纳路径），恢复派发经 onDataDispatched 再减一 → −1。
    //    负记账使 R6 溢出 count 口径与 A7 窗口门双双低估负载 1 帧。──
    expect(pending(), '恢复派发后 pendingData ≥ 0（R6 记账闭环）').toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════ D3：GOAWAY drain × pong 超时互斥 ═══════════════════════════

interface LivenessWireOptions {
  /** ping 后自动复 pong（重连代 wire 用——避免观察窗内新代被自身 pong 超时收口）。 */
  readonly autoPong?: boolean;
  /** 扣下一帧指定 kind 的 peer→hub 帧（一次性——D5 扣 HELLO 用：hub 等 HELLO 才起 HELLO_TIMEOUT）。 */
  readonly dropNextPeerToHubKind?: string;
}

interface LivenessLogWire {
  readonly peerEnd: DuplexTransport & { ping(): void };
  readonly hubEnd: DuplexTransport;
  readonly hubToPeer: Uint8Array[];
  readonly peerToHub: Uint8Array[];
  pingCount(): number;
  readonly peerSideClosed: boolean;
  readonly hubSideCloseInfo: Readonly<{ code: number; reason: string }> | undefined;
  nextHubSeq(): number;
}

function makeLivenessLogWire(opts: LivenessWireOptions = {}): LivenessLogWire {
  const peerListeners = new Set<(bytes: Uint8Array) => void>();
  const peerCloseListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const hubListeners = new Set<(bytes: Uint8Array) => void>();
  const hubCloseListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const pongListeners = new Set<() => void>();
  const hubToPeer: Uint8Array[] = [];
  const peerToHub: Uint8Array[] = [];
  let pings = 0;
  let peerClosed = false;
  let hubClosed = false;
  let dropArmed = opts.dropNextPeerToHubKind;
  let hubSideCloseInfo: Readonly<{ code: number; reason: string }> | undefined;

  const peerEnd = {
    send(bytes: Uint8Array) {
      if (peerClosed) return;
      const copy = bytes.slice();
      if (dropArmed !== undefined && decodeMessage(copy).message.kind === dropArmed) {
        dropArmed = undefined; // 一次性扣帧（发送方已发、未投递）
        return;
      }
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
      if (opts.autoPong === true) {
        queueMicrotask(() => {
          for (const listener of [...pongListeners]) listener();
        });
      }
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
      hubCloseListeners.add((info) => {
        hubSideCloseInfo = info;
        listener(info);
      });
      return () => hubCloseListeners.delete(listener);
    },
  };

  return {
    peerEnd,
    hubEnd,
    hubToPeer,
    peerToHub,
    pingCount: () => pings,
    get peerSideClosed() {
      return peerClosed;
    },
    get hubSideCloseInfo() {
      return hubSideCloseInfo;
    },
    nextHubSeq() {
      let max = 0;
      for (const bytes of hubToPeer) max = Math.max(max, decodeMessage(bytes).header.sequence);
      return max + 1;
    },
  };
}

interface D3Env {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly wires: LivenessLogWire[];
  readonly nsId: string;
  writeHub(update: Readonly<{ n?: number }>): Promise<void>;
  rootValue(side: 'hub' | 'peer', key: string): unknown;
}

async function bootD3(): Promise<D3Env> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const authorizer = makeAuthorizer({});
  const fixture = await makeHubNamespace(hubNode, { n: 42 });
  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: hubNode.registry,
    authorize: authorizer.authorize,
    timer: hubNode.scheduler,
  });
  const wires: LivenessLogWire[] = [];
  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      // 首代 wire 不复 pong（触发 pong 超时）；重连代 auto-pong（观察窗内不被自身收口）
      const wire = makeLivenessLogWire({ autoPong: wires.length > 0 });
      wires.push(wire);
      hub.accept(wire.hubEnd, { peerInstanceId: PEER_INSTANCE });
      return wire.peerEnd;
    },
    timer: peerNode.scheduler,
    targets: [{ namespaceId: fixture.namespaceId, localOwner: PEER_OWNER }],
    timeouts: { pingIntervalMs: 1_000, pongTimeoutMs: 500 },
    backoff: { baseMs: 50, maxMs: 400, resetAfterMs: 500 },
    random: () => 0.5,
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
    rootValue(side, key) {
      const node = side === 'hub' ? hubNode : peerNode;
      const owner = side === 'hub' ? HUB_OWNER : PEER_OWNER;
      const doc = node.persistence.peek(owner, fixture.namespaceId);
      if (doc === undefined) throw new Error(`${side} 缺副本`);
      return (doc.getMap('ROOT') as unknown as Map<string, unknown>).get(key);
    },
  };
}

describe('SA7 D3（round 2）：GOAWAY drain 窗口 × pong 超时互斥 + 重连 reconcile', () => {
  it('D3：drain 窗口内 pong 超时 → clearGoawayDrain + close(1001,pong-timeout) → backoff → 重连 live；迟到 deadline 幂等 no-op', async () => {
    const env = await bootD3();
    env.peer.start();
    await settleUntil(() => env.peer.getConnectionState() === 'ready', '连接 ready');
    await settleUntil(() => env.peer.getNamespaceState(env.nsId) === 'live', 'ns live');
    const wire1 = env.wires[0]!;
    // GOAWAY drain 窗口：deadline 5000ms ≫ ping(1000)+pong(500)——pong 超时必落在窗口内
    wire1.hubEnd.send(
      encodeMessage(
        { kind: 'GOAWAY', reasonCode: 'SERVER_RESTARTING', drainTimeoutMs: 5_000 } as ReplicationMessage,
        { sequence: wire1.nextHubSeq() },
      ),
    );
    await settle();
    expect(env.peer.getConnectionState(), 'drain 窗口期连接照常（deadline 未到）').toBe('ready');
    expect(wire1.peerSideClosed).toBe(false);
    // ping 周期到 → pong 不复 → 超时（drain 窗口内触发互斥路径）
    await env.peerNode.scheduler.advanceBy(1_000);
    expect(wire1.pingCount()).toBe(1);
    const peerFramesBefore = wire1.peerToHub.length;
    await env.peerNode.scheduler.advanceBy(500);
    // ④ 同步 close(1001,'pong-timeout') + ⑥ backoff（临时失败——非 blocked：drain 职责已被失联回收承担）
    expect(env.peer.getConnectionState(), 'pong 超时 = 临时失败（backoff，非 blocked）').toBe('backoff');
    expect(wire1.peerSideClosed, 'pong 超时必须同步关闭传输').toBe(true);
    await settle();
    expect(wire1.hubSideCloseInfo, 'close code/reason 对齐（1001/pong-timeout）').toEqual({
      code: 1001,
      reason: 'pong-timeout',
    });
    // ⑦ 投影后 dispose 零出站噪声：旧 wire 在超时收口后零新帧
    expect(wire1.peerToHub.length, '收口后旧 wire 零出站（dispose 经非 ready 门）').toBe(peerFramesBefore);
    // hub 侧 close 事件传播 → cleanupAll → 连接清理
    await settleUntil(() => env.hub.connections.length === 0, 'hub 清理死连接');
    // ② clearGoawayDrain：重连（0.5×50=25ms）→ 新 wire → reconcile live
    await env.peerNode.scheduler.advanceBy(25);
    await settleUntil(() => env.peer.getConnectionState() === 'ready', '重拨 ready');
    await settleUntil(() => env.peer.getNamespaceState(env.nsId) === 'live', '重连 reconcile live');
    expect(env.hub.connections.length, 'hub 只见新连接').toBe(1);
    const wire2 = env.wires[1]!;
    // 迟到的 drain deadline（原定 GOAWAY+5000ms）：若 ② 未清除 → deadline 回调会把
    // this.transport（= 新 wire2）以 'goaway-drain' 关闭——幂等 no-op 判别点
    await env.peerNode.scheduler.advanceBy(5_000);
    expect(wire2.peerSideClosed, '迟到的 drain deadline 不得关闭新传输（clearGoawayDrain 幂等）').toBe(false);
    expect(env.peer.getConnectionState()).toBe('ready');
    expect(env.peer.getNamespaceState(env.nsId)).toBe('live');
    // 断线窗口 hub 写经重连 reconcile 收敛（无静默丢帧）
    await env.writeHub({ n: 99 });
    await settleUntil(() => env.rootValue('peer', 'n') === 99, '断线窗口写收敛');
    expect(env.rootValue('hub', 'n')).toBe(99);
    await env.peer.stop();
    await settleUntil(() => env.peer.getConnectionState() === 'stopped', 'stopped（零 timer 残留）');
  });
});

// ═══════════════════════════ D4：R2 尾窗 ledger 冲刷回落（类级） ═══════════════════════════

const D4_LIMITS: Readonly<ResolvedLimits> = Object.freeze({
  maxFrameBytes: 1 << 20,
  maxBootstrapBytes: 1 << 20,
  maxSyncDiffBytes: 1 << 20,
  maxUpdateBytes: 1 << 20,
  maxQueuedUpdateBytes: 1 << 20,
  maxQueuedUpdateCount: 1024,
  maxInFlightUpdates: 8,
  maxQueuedBytesPerConnection: 64 * 1024,
  lowWater: 1024,
  highWater: 8 * 1024,
  maxQueuedControlBytes: 32 * 1024,
} as ResolvedLimits);

describe('SA7 D4（round 2）：控制尾窗 ledger 冲刷回落——裁剪正确、归零不误杀、真实越限仍触发', () => {
  it('D4：bufferedAmount 回落推进 emitTail 裁剪——controlOutstandingBytes 回落不误触 onControlExhausted；越限仍触发', async () => {
    const scheduler = createRegistryTestScheduler();
    // held 模拟 socket 缓冲；flush(n) 按 FIFO 冲刷 n 字节（§17 前提：缓冲按发送序冲刷）
    const held: Uint8Array[] = [];
    const dataDispatched: string[] = [];
    let exhausted = 0;
    const queue = new OutboundQueue(
      (bytes: Uint8Array) => {
        held.push(bytes);
      },
      D4_LIMITS,
      () => undefined,
      {
        timer: scheduler,
        checkpointIntervalMs: 100,
        bufferedAmount: () => held.reduce((sum, b) => sum + b.byteLength, 0),
        onDataDispatched: (ns) => {
          dataDispatched.push(ns);
        },
        onDataShed: () => undefined,
        onControlExhausted: () => {
          exhausted += 1;
        },
        canDispatchData: () => true,
      },
    );
    const flush = (budget: number): void => {
      let flushed = 0;
      while (held.length > 0 && flushed < budget) {
        flushed += held[0]!.byteLength;
        held.splice(0, 1);
      }
    };
    const snap = (nsId: string): ReplicationMessage =>
      ({
        kind: 'BOOTSTRAP_SNAPSHOT',
        namespaceId: nsId,
        replicationId: '1'.repeat(32),
        replicationEpoch: 1,
        snapshot: new Uint8Array(8 * 1024),
      }) as ReplicationMessage;
    const upd = (nsId: string): ReplicationMessage =>
      ({ kind: 'UPDATE', namespaceId: nsId, update: new Uint8Array([9, 9]) }) as ReplicationMessage;
    //（namespaceId 须匹配 ^ns-[0-9a-f]{32}$——canonical checkNamespaceId）
    const NS = 'ns-77777777777777777777777777777777';
    // 数据 1 帧 + 控制风暴 6×8KiB payload（帧 ≈8.2KiB）→ 尾窗控制 ≈49KiB > 32KiB 额度
    queue.enqueueData(NS, upd(NS));
    expect(dataDispatched).toHaveLength(1);
    for (let i = 0; i < 6; i += 1) queue.sendControl(snap(NS));
    const bufferedBefore = held.reduce((sum, b) => sum + b.byteLength, 0);
    expect(bufferedBefore, '前置：未冲刷时控制尾窗确越额度').toBeGreaterThan(32 * 1024);
    // ── 冲刷回落：FIFO 释放 ≈40KiB（含多数控制帧）→ buffered ≈10KiB ──
    flush(40 * 1024);
    // 检查点 #1：裁剪（flushed = totalEmitted − buffered）→ controlOutstanding 回落 < 32KiB；
    //   规则 A：buffered ≈10KiB > highWater 8KiB → paused
    await scheduler.advanceBy(100);
    expect(exhausted, '冲刷回落后的检查点不得误触 onControlExhausted（防高估误杀）').toBe(0);
    queue.enqueueData(NS, upd(NS)); // paused → 排队不派发（检查点确实运行过的旁证）
    expect(dataDispatched, '规则 A 已暂停（检查点运行旁证）').toHaveLength(1);
    // ── 全量冲刷：buffered 0 → flushed = totalEmitted → emitTail 全裁 → outstanding 归零 ──
    flush(Number.MAX_SAFE_INTEGER);
    await scheduler.advanceBy(100);
    expect(exhausted, 'ledger 归零后不得误触耗尽').toBe(0);
    expect(dataDispatched, '规则 B 恢复 → 排队帧派发（buffered 0 ≤ lowWater）').toHaveLength(2);
    // ── 正向对照：真实越限（无冲刷回落）→ 控制分支必须触发 ──
    for (let i = 0; i < 5; i += 1) queue.sendControl(snap(NS));
    await scheduler.advanceBy(100);
    expect(exhausted, '真实越过保留额度仍必须触发（裁剪不吞真越限）').toBe(1);
  });
});

// ═══════════════════════════ D5：hello 超时孤儿传输（登记观察） ═══════════════════════════

describe('SA7 D5（round 2，登记观察项——设计 §D4 N2）：hello 超时 peer 侧孤儿传输竞速窗口', () => {
  it('D5：hello 超时不关 peer 侧传输（孤儿窗口在场）；hub 侧同值 HELLO_TIMEOUT(1002) 兜底收口；重连恢复不受影响', async () => {
    const hubNode = makeNode('hub');
    const peerNode = makeNode('peer');
    const authorizer = makeAuthorizer({});
    const fixture = await makeHubNamespace(hubNode, { n: 42 });
    const hub = createHubReplication({
      instanceId: HUB_INSTANCE,
      registry: hubNode.registry,
      authorize: authorizer.authorize,
      timer: hubNode.scheduler,
    });
    const wires: LivenessLogWire[] = [];
    const peer = createPeerReplication({
      instanceId: PEER_INSTANCE,
      hubInstanceId: HUB_INSTANCE,
      registry: peerNode.registry,
      dial: () => {
        // 首代 wire 扣 peer→hub HELLO（一次性）→ hub 收不到 HELLO → 起 hub 侧
        // HELLO_TIMEOUT（同值兜底面）；peer 侧 hello 超时（100ms）先行 → 孤儿窗口展开
        const wire =
          wires.length === 0
            ? makeLivenessLogWire({ autoPong: true, dropNextPeerToHubKind: 'HELLO' })
            : makeLivenessLogWire({ autoPong: true });
        wires.push(wire);
        hub.accept(wire.hubEnd, { peerInstanceId: PEER_INSTANCE });
        return wire.peerEnd;
      },
      timer: peerNode.scheduler,
      targets: [{ namespaceId: fixture.namespaceId, localOwner: PEER_OWNER }],
      timeouts: { helloTimeoutMs: 100 },
      backoff: { baseMs: 50, maxMs: 400, resetAfterMs: 500 },
      random: () => 0.5,
    });
    peer.start();
    // hello 超时（ACK 被扣）→ onTemporaryFailure（公共入口——行为不变面）→ backoff
    await peerNode.scheduler.advanceBy(100);
    await settleUntil(() => peer.getConnectionState() === 'backoff', 'hello 超时 → backoff');
    const wire1 = wires[0]!;
    // ── 登记观察（非缺陷断言）：peer 侧传输保持开放 = 孤儿窗口在场（设计 §D4 N2
    //    明示本轮不修、处置建议开跟踪票归总控）──
    expect(wire1.peerSideClosed, '登记观察：hello 超时不关 peer 侧传输（孤儿窗口在场）').toBe(false);
    // 恢复不受影响：backoff 重拨（扣帧一次性）→ wire2 HELLO 放行 → ready → live
    await peerNode.scheduler.advanceBy(25);
    await settleUntil(() => peer.getConnectionState() === 'ready', '重拨 ready');
    await settleUntil(() => peer.getNamespaceState(fixture.namespaceId) === 'live', '重连 live');
    expect(wires.length).toBe(2);
    // hub 侧兜底：同值 HELLO_TIMEOUT fatal（1002）关闭孤儿连接的 hub 半边（竞速窗口
    //   的另一端——双侧同值 10s 缺省下该兜底与 peer 侧超时构成竞速；本探针把 peer 侧
    //   调至 100ms 以确定性展开窗口，hub 侧保持缺省 10s 观察兜底行为）
    await hubNode.scheduler.advanceBy(10_000);
    await settle();
    expect(wire1.hubEnd.closed, 'hub 侧 HELLO_TIMEOUT 兜底关闭其半边').toBe(true);
    expect(hub.connections.length, 'hub 已收口孤儿连接（仅剩新连接）').toBe(1);
    expect(wire1.peerSideClosed, 'peer 侧仍未自关（孤儿面——登记项非缺陷）').toBe(false);
    await peer.stop();
    await settleUntil(() => peer.getConnectionState() === 'stopped', 'stopped');
  });
});

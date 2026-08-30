/**
 * SA6 红灯契约（issue #176）—— hub pong 超时的临时失败语义（协议 L524：pong 超时按
 * 临时失败处理：close(1001) + backoff 重连；不发送未登记 PONG_TIMEOUT ERROR 帧）。
 *
 * 权威规格：wiki/raw/task_176_sa2.md（SA2/SA6 owned 测试；本文件按 §3/§4 落码）。
 *
 * 红基线行为链（现状 bug，hub-connection.ts:419）：hub ping → pong 超时 →
 * connectionFatal('PONG_TIMEOUT', 1002) → ERROR 帧 encode throw 被吞（wire 零 ERROR，
 * AC-1 空真）→ close(1002,'protocol-error') → peer 按 1002 分类 enterBlocked →
 * 永久 blocked、零重拨（AC-2/AC-3/AC-6 全红）。
 *
 * 纪律（同 R4/D4 文件头）：真实 yjs / Registry / HubReplication / PeerReplication；
 * fake-duplex 微任务投递 + fake scheduler；零 real sleep；零源码 grep 断言；零生产
 * API 变更（全部观测走既有公共面 + fake wire 计数面）。
 *
 * ⚠️ 与 SA2 §4 T4c 字面的实现差异：SA2 写 wire1.hubEnd.send(...) 注入迟到数据帧；
 * 本场景下 hub 侧已 closed（hub 发起超时收口——与 R4 A4b 的 peer 发起不同），
 * makeEnd 同构的 send 会因 hubSideClosed 短路为零投递（空洞测试）。故 wire 增加
 * `fireStaleData`（绕过 closed 旗标直注对端当前 onMessage 监听器集，语义与
 * fireStalePeerClose 同构），T4c 用它做 worst-case 迟到帧注入。
 */
import { describe, expect, it } from 'vitest';
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type { DuplexTransport, HubReplication, PeerReplication } from '@nomicore/ws-replication';
import { createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import { encodeMessage } from '@nomicore/replication-protocol';
import { DEFAULT_PEER_VERIFIER, TEST_TOKEN, makeAuthorizer } from './driver.js';
import {
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  PEER_OWNER,
  decodeAll,
  framesOfKind,
  makeHubNamespace,
  makeNode,
  settle,
  settleUntil,
} from './harness.js';
import type { HubNamespaceFixture } from './harness.js';

// ═══════════════════════════ §3.1 makeIssue176Wire：对称 liveness wire ═══════════════════════════

interface Issue176Wire {
  readonly peerEnd: DuplexTransport;
  readonly hubEnd: DuplexTransport;
  hubPings(): number;
  fireHubPong(): void;
  hubPongListenerCount(): number;
  peerPings(): number;
  firePeerPong(): void;
  peerPongListenerCount(): number;
  /** hub→peer 帧（发送即记录；同 harness makeWire 旁路语义）。 */
  readonly hubToPeer: Uint8Array[];
  readonly peerToHub: Uint8Array[];
  /** hubEnd.close 投递给 peer 端 onClose 监听器的 info 快照（AC-2 观测面）。 */
  readonly lastCloseDeliveredToPeer: Readonly<{ code: number; reason: string }> | undefined;
  /** peer 端关闭时 hub 端观测的 info（T4b 用）。 */
  readonly hubSideCloseInfo: Readonly<{ code: number; reason: string }> | undefined;
  readonly peerSideClosed: boolean;
  readonly hubSideClosed: boolean;
  /** 一次性旗标：下一次 hubEnd.close 对 peer 端的通知被扣留（记入 held，不投递）。 */
  holdPeerCloseOnce(): void;
  /** 把扣留的 close 通知投递给【释放时刻】peer 端当前 onClose 监听器集（模拟网络迟到 close）。 */
  releaseHeldPeerClose(): void;
  /** 绕过 closed 旗标，直接向 peer 端当前 onClose 监听器集合成派发（worst-case 迟到 close）。 */
  fireStalePeerClose(code: number, reason: string): void;
  /** 绕过 closed 旗标，向 peer 端当前 onMessage 监听器集合成派发（worst-case 迟到数据帧）。 */
  fireStaleData(bytes: Uint8Array): void;
}

function makeIssue176Wire(
  opts: { hubFacets?: boolean; peerFacets?: boolean } = {},
): Issue176Wire {
  const hubFacets = opts.hubFacets ?? true;
  const peerFacets = opts.peerFacets ?? false;
  const hubMsgListeners = new Set<(bytes: Uint8Array) => void>();
  const hubCloseListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const peerMsgListeners = new Set<(bytes: Uint8Array) => void>();
  const peerCloseListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const hubPongListeners = new Set<(payload?: Uint8Array) => void>();
  const peerPongListeners = new Set<(payload?: Uint8Array) => void>();
  let hubPings = 0;
  let peerPings = 0;
  let lastHubPingPayload: Uint8Array | undefined;
  let lastPeerPingPayload: Uint8Array | undefined;
  let hubClosed = false;
  let peerClosed = false;
  const hubToPeer: Uint8Array[] = [];
  const peerToHub: Uint8Array[] = [];
  let lastCloseDeliveredToPeer: Readonly<{ code: number; reason: string }> | undefined;
  let hubSideCloseInfo: Readonly<{ code: number; reason: string }> | undefined;
  let heldPeerClose: Readonly<{ code: number; reason: string }> | undefined;
  let holdNextPeerClose = false;

  const deliverCloseToPeer = (code: number, reason: string): void => {
    queueMicrotask(() => {
      lastCloseDeliveredToPeer = { code, reason };
      for (const listener of [...peerCloseListeners]) listener({ code, reason });
    });
  };

  const peerEnd: DuplexTransport = {
    send(bytes: Uint8Array) {
      if (peerClosed) return;
      const copy = bytes.slice();
      peerToHub.push(copy);
      queueMicrotask(() => {
        for (const listener of [...hubMsgListeners]) listener(copy);
      });
    },
    close(code = 1000, reason = '') {
      if (peerClosed) return;
      peerClosed = true;
      queueMicrotask(() => {
        hubSideCloseInfo = { code, reason };
        for (const listener of [...hubCloseListeners]) listener({ code, reason });
      });
    },
    get closed() {
      return peerClosed;
    },
    onMessage(listener) {
      peerMsgListeners.add(listener);
      return () => peerMsgListeners.delete(listener);
    },
    onClose(listener) {
      peerCloseListeners.add(listener);
      return () => peerCloseListeners.delete(listener);
    },
    ...(peerFacets
      ? {
          ping(payload?: Uint8Array) {
            peerPings += 1;
            lastPeerPingPayload = payload?.slice();
          },
          onPong(listener: (payload?: Uint8Array) => void) {
            peerPongListeners.add(listener);
            return () => peerPongListeners.delete(listener);
          },
        }
      : {}),
  };

  const hubEnd: DuplexTransport = {
    send(bytes: Uint8Array) {
      if (hubClosed) return;
      const copy = bytes.slice();
      hubToPeer.push(copy);
      queueMicrotask(() => {
        for (const listener of [...peerMsgListeners]) listener(copy);
      });
    },
    close(code = 1001, reason = 'hub-close') {
      if (hubClosed) return;
      hubClosed = true;
      if (holdNextPeerClose) {
        // 一次性扣留：close 已发生（本端），对 peer 端的通知稍后经 releaseHeldPeerClose 投递
        heldPeerClose = { code, reason };
        holdNextPeerClose = false;
        return;
      }
      deliverCloseToPeer(code, reason);
    },
    get closed() {
      return hubClosed;
    },
    onMessage(listener) {
      hubMsgListeners.add(listener);
      return () => hubMsgListeners.delete(listener);
    },
    onClose(listener) {
      hubCloseListeners.add(listener);
      return () => hubCloseListeners.delete(listener);
    },
    ...(hubFacets
      ? {
          ping(payload?: Uint8Array) {
            hubPings += 1;
            lastHubPingPayload = payload?.slice();
          },
          onPong(listener: (payload?: Uint8Array) => void) {
            hubPongListeners.add(listener);
            return () => hubPongListeners.delete(listener);
          },
        }
      : {}),
  };

  return {
    peerEnd,
    hubEnd,
    hubPings: () => hubPings,
    fireHubPong() {
      for (const listener of [...hubPongListeners]) listener(lastHubPingPayload?.slice());
    },
    hubPongListenerCount: () => hubPongListeners.size,
    peerPings: () => peerPings,
    firePeerPong() {
      for (const listener of [...peerPongListeners]) listener(lastPeerPingPayload?.slice());
    },
    peerPongListenerCount: () => peerPongListeners.size,
    hubToPeer,
    peerToHub,
    get lastCloseDeliveredToPeer() {
      return lastCloseDeliveredToPeer;
    },
    get hubSideCloseInfo() {
      return hubSideCloseInfo;
    },
    get peerSideClosed() {
      return peerClosed;
    },
    get hubSideClosed() {
      return hubClosed;
    },
    holdPeerCloseOnce() {
      holdNextPeerClose = true;
    },
    releaseHeldPeerClose() {
      const held = heldPeerClose;
      if (held === undefined) return;
      heldPeerClose = undefined;
      deliverCloseToPeer(held.code, held.reason);
    },
    fireStalePeerClose(code: number, reason: string) {
      queueMicrotask(() => {
        for (const listener of [...peerCloseListeners]) listener({ code, reason });
      });
    },
    fireStaleData(bytes: Uint8Array) {
      queueMicrotask(() => {
        for (const listener of [...peerMsgListeners]) listener(bytes);
      });
    },
  };
}

// ═══════════════════════════ §3.2 makeRecordingScheduler（peer 复制面 delay 日志 seam） ═══════════════════════════

interface RecordingScheduler {
  /** 每次 setTimeout 的 delayMs，按调用序（hello/backoff/reset/controller 全落在其上）。 */
  readonly delays: number[];
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  advanceBy(milliseconds: number): Promise<void>;
  pending(): number;
}

function makeRecordingScheduler(): RecordingScheduler {
  const inner = createRegistryTestScheduler();
  const delays: number[] = [];
  return {
    delays,
    setTimeout: (callback, delayMs) => {
      delays.push(delayMs);
      return inner.setTimeout(callback, delayMs);
    },
    clearTimeout: (handle) => inner.clearTimeout(handle as number),
    advanceBy: (milliseconds) => inner.advanceBy(milliseconds),
    pending: () => inner.pending(),
  };
}

// ═══════════════════════════ §3.3 instrumentPeerEnd（订阅摘除结构锚） ═══════════════════════════

function instrumentPeerEnd(transport: DuplexTransport): {
  readonly proxy: DuplexTransport;
  stats(): Readonly<{ total: number; detached: number }>;
} {
  const records: Array<{ detached: boolean }> = [];
  const facet = transport as DuplexTransport & {
    ping?(data?: Uint8Array): void;
    onPong?(listener: () => void): () => void;
  };
  const proxy: DuplexTransport = {
    send: (bytes) => transport.send(bytes),
    close: (code?, reason?) => transport.close(code, reason),
    get closed() {
      return transport.closed;
    },
    onMessage: (listener) => {
      const record = { detached: false };
      records.push(record);
      const off = transport.onMessage(listener);
      return () => {
        record.detached = true;
        off();
      };
    },
    onClose: (listener) => {
      const record = { detached: false };
      records.push(record);
      const off = transport.onClose(listener);
      return () => {
        record.detached = true;
        off();
      };
    },
    ...(facet.ping !== undefined && facet.onPong !== undefined
      ? {
          ping: (data?: Uint8Array) => facet.ping!(data),
          onPong: (listener: () => void) => facet.onPong!(listener),
        }
      : {}),
  };
  return {
    proxy,
    stats: () => ({
      total: records.length,
      detached: records.filter((r) => r.detached).length,
    }),
  };
}

// ═══════════════════════════ §3.4 bootIssue176（R4 bootLiveness 对称扩展版） ═══════════════════════════

interface BootIssue176Options {
  /** hubEnd 提供 ping/onPong（缺省 true——hub liveness 武装；SA1 §4「dormant 反例」闸门）。 */
  readonly hubFacets?: boolean;
  /** peerEnd 提供 ping/onPong（缺省 false——隔离被测方向 hub 侧超时；T4b 开）。 */
  readonly peerFacets?: boolean;
  /** peer 侧 liveness 计时（缺省 = 包默认 30_000/10_000；T4b 用 3_000/500）。 */
  readonly peerTimeouts?: Readonly<{ pingIntervalMs: number; pongTimeoutMs: number }>;
  /** dial 时把 peerEnd 包成订阅记录 proxy（T4d）。 */
  readonly instrumentPeerEnd?: boolean;
}

interface Issue176Boot {
  readonly hubSched: ReturnType<typeof createRegistryTestScheduler>;
  readonly rec: RecordingScheduler;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly wires: Issue176Wire[];
  readonly nsId: string;
  readonly fixture: HubNamespaceFixture;
  /** 按 wire 序的订阅统计访问器（instrumentPeerEnd 时非空）。 */
  readonly peerStats: Array<() => Readonly<{ total: number; detached: number }>>;
  writeHub(update: Readonly<{ n?: number; extra?: number }>): Promise<void>;
  rootValue(side: 'hub' | 'peer', key: string): unknown;
}

async function bootIssue176(opts: BootIssue176Options = {}): Promise<Issue176Boot> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const authorizer = makeAuthorizer({});
  const fixture = await makeHubNamespace(hubNode); // 默认 SCHEMA_ENVELOPE + GOOD_ROOT {n:42}
  const hubSched = hubNode.scheduler; // hub liveness/hello 计时面
  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: hubNode.registry,
    authorize: authorizer.authorize,
    timer: hubSched,
    verifyToken: DEFAULT_PEER_VERIFIER,
    timeouts: { pingIntervalMs: 1_000, pongTimeoutMs: 500 },
  });
  const rec = makeRecordingScheduler(); // §3.2：peer 复制面全部 timer 落在 rec 上
  const wires: Issue176Wire[] = [];
  const peerStats: Array<() => Readonly<{ total: number; detached: number }>> = [];
  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      const wire = makeIssue176Wire({ hubFacets: opts.hubFacets ?? true, peerFacets: opts.peerFacets ?? false });
      wires.push(wire);
      void hub.accept(wire.hubEnd, { token: TEST_TOKEN });
      if (opts.instrumentPeerEnd === true) {
        const instrumented = instrumentPeerEnd(wire.peerEnd);
        peerStats.push(instrumented.stats);
        return instrumented.proxy;
      }
      return wire.peerEnd;
    },
    timer: rec,
    random: () => 0.99, // attempt1 delay = 0.99×100 = 99ms；attempt2（未重置）= 198ms
    ...(opts.peerTimeouts !== undefined ? { timeouts: opts.peerTimeouts } : {}),
    targets: [{ namespaceId: fixture.namespaceId, localOwner: PEER_OWNER }],
  });
  return {
    hubSched,
    rec,
    hub,
    peer,
    wires,
    nsId: fixture.namespaceId,
    fixture,
    peerStats,
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

/** 前置：boot → start → ready → live（T1 起的公共起点）。 */
async function bootReady(): Promise<Issue176Boot> {
  const boot = await bootIssue176();
  boot.peer.start();
  await settleUntil(() => boot.peer.getConnectionState() === 'ready', '连接 ready');
  await settleUntil(() => boot.peer.getNamespaceState(boot.nsId) === 'live', 'ns live');
  await settle();
  return boot;
}

// ═══════════════════════════ §4 用例（T1–T6 + P1 见 api.test-d.ts） ═══════════════════════════

describe('issue #176（SA2 契约）：hub pong 超时 = 临时失败（1001 + backoff），零 PONG_TIMEOUT ERROR', () => {
  it('T1 hub pong 超时收口：1001 + 零 ERROR 帧 + 连接/计时清理（AC-1/AC-2/AC-5）', async () => {
    const boot = await bootReady();
    const conn1 = boot.hub.connections[0]!;
    const wire1 = boot.wires[0]!;
    const pendingAtReady = boot.hubSched.pending();

    // 1. 首个 ping 周期（liveness 武装证明）
    await boot.hubSched.advanceBy(1_000);
    expect(wire1.hubPings(), 'hub liveness 必须已武装（hubEnd 配 ping/onPong）').toBe(1);
    expect(boot.hubSched.pending()).toBe(pendingAtReady + 1); // loop 内 pong timer +1、下一轮 ping 抵消

    // 2. pong 未复 → 超时 → 同步段收口断言
    await boot.hubSched.advanceBy(500);
    expect(wire1.hubEnd.closed).toBe(true);
    // 🟥 主锚（AC-2）：现状 connectionFatal → {code:1002, reason:'protocol-error'}
    expect(wire1.lastCloseDeliveredToPeer).toEqual({ code: 1001, reason: 'pong-timeout' });
    expect(wire1.lastCloseDeliveredToPeer?.reason).not.toBe('protocol-error');
    expect(conn1.state).toBe('closed'); // ready → closed 直迁（hub FSM §15.2）

    // 3. 收口清理（AC-5）：连接清出连接表 + hub 计时卫生 + pong listener 摘除
    await settle();
    expect(boot.hub.connections.length).toBe(0);
    // 连接域计时卫生锚：ready+live 时 pending = 基线 N + liveness ping(1) + hub channel
    // watchdog idle(1)；收口后连接域 timer 全清（stopLiveness + watchdog teardown），仅回落
    // 基线。若修复路径漏 stopLiveness → liveness ping 残留 → 此值 = pendingAtReady - 1 → 红。
    expect(boot.hubSched.pending()).toBe(pendingAtReady - 2);
    expect(wire1.hubPongListenerCount()).toBe(0); // liveness offPong 已调

    // 4. 帧审计（AC-1）：全程零 connection ERROR / 零 PONG_TIMEOUT
    const decoded = decodeAll(wire1.hubToPeer);
    const errorFrames = decoded.filter((f) => f.message.kind === 'ERROR');
    expect(errorFrames).toHaveLength(0);
    expect(
      errorFrames.some((f) => (f.message as { code?: string }).code === 'PONG_TIMEOUT'),
    ).toBe(false);

    // 5. peer 侧投影（AC-3 主锚）：backoff（现状 blocked → 红）+ namespace disconnected
    expect(boot.peer.getConnectionState()).toBe('backoff');
    expect(boot.peer.getNamespaceState(boot.nsId)).toBe('disconnected');
  });

  it('T2 跨端：hub 超时 → peer backoff → 重连 ready → 数据收敛（AC-3/AC-6）', async () => {
    const boot = await bootReady();
    const wire1 = boot.wires[0]!;
    // 前置 = T1（hub 超时收口）
    await boot.hubSched.advanceBy(1_000);
    expect(wire1.hubPings()).toBe(1);
    await boot.hubSched.advanceBy(500);
    await settle();

    // 1. 🟥 主锚：backoff 且未重拨（现状 blocked → 红）
    expect(boot.peer.getConnectionState()).toBe('backoff');
    expect(boot.peer.getConnectionState()).not.toBe('blocked');
    expect(boot.wires.length).toBe(1);

    // 2. 失联窗口内 hub 写（死连接上的 UPDATE 静默丢弃——重连后经 bootstrap/reconcile 收敛）
    await boot.writeHub({ n: 9 });

    // 3. backoff 99ms 到期 → 重拨 → ready + live
    await boot.rec.advanceBy(100);
    await settleUntil(() => boot.peer.getConnectionState() === 'ready', '重拨后 ready');
    await settleUntil(() => boot.peer.getNamespaceState(boot.nsId) === 'live', '重连后 live');
    expect(boot.wires.length).toBe(2);
    expect(boot.hub.connections.length).toBe(1); // 只见新连接；旧连接已清

    // 4. 收敛锚：失联窗口更新不丢失
    expect(boot.rootValue('hub', 'n')).toBe(9);
    expect(boot.rootValue('peer', 'n')).toBe(9);

    // 5. 全程「从未 blocked」轨迹锚
    expect(boot.peer.getConnectionState()).not.toBe('blocked');
  });

  it('T3 注入 seam 与 attempts 重置契约（AC-4）', async () => {
    const boot = await bootReady();
    const wire1 = boot.wires[0]!;

    // 1. 第一次 hub pong 超时 → backoff delay = 0.99×100 = 99ms（现状 blocked 无此记录 → 红）
    await boot.hubSched.advanceBy(1_000);
    expect(wire1.hubPings()).toBe(1);
    await boot.hubSched.advanceBy(500);
    await settle();
    expect(boot.peer.getConnectionState()).toBe('backoff');
    expect(boot.rec.delays).toContain(99);
    expect(boot.rec.delays).not.toContain(198); // 第一次失败不得是 200 档（attempt 未放大）

    // 2. 边界锚（E11 含等号修正）：98ms 未到期不重拨；+1ms 到期重拨
    await boot.rec.advanceBy(98);
    expect(boot.peer.getConnectionState()).toBe('backoff');
    expect(boot.wires.length).toBe(1);
    await boot.rec.advanceBy(1);
    await settleUntil(() => boot.peer.getConnectionState() === 'ready', '重拨后 ready');
    await settleUntil(() => boot.peer.getNamespaceState(boot.nsId) === 'live', '重连后 live');
    expect(boot.wires.length).toBe(2);

    // 3. 稳定 ready 越过 resetAfterMs（10_000）→ attempts 清零（armResetCheck :737-743）
    await boot.rec.advanceBy(10_000);
    expect(boot.peer.getConnectionState()).toBe('ready'); // 重置计时器触发不扰动连接

    // 4. 第二次 hub pong 超时（wire2）→ 新 backoff 回到 base 档
    await boot.hubSched.advanceBy(1_000);
    await boot.hubSched.advanceBy(500);
    await settle();
    expect(boot.rec.delays.filter((d) => d === 99)).toHaveLength(2);
    expect(boot.rec.delays).not.toContain(198); // 未重置 → 第二次 cap=200 → 198 → 红
    expect(boot.peer.getConnectionState()).toBe('backoff');
  });

  it('T4a 迟到 pong（hub 侧旧 wire）：空监听集、零复活 timer（AC-7）', async () => {
    const boot = await bootReady();
    const wire1 = boot.wires[0]!;
    await boot.hubSched.advanceBy(1_000);
    await boot.hubSched.advanceBy(500);
    await settle();
    const pendingAfter = boot.hubSched.pending();
    expect(() => wire1.fireHubPong()).not.toThrow();
    expect(boot.hubSched.pending()).toBe(pendingAfter); // 无复活 timer
    expect(wire1.hubPongListenerCount()).toBe(0); // 已摘除——迟到 pong 落在空监听集
    expect(boot.peer.getConnectionState()).toBe('backoff');
  });

  it('T4b 迟到 close（peer 侧旧代际）：1001 迟到 + 1002 worst-case 不污染新代际（AC-7）', async () => {
    const boot = await bootIssue176({
      peerFacets: true,
      peerTimeouts: { pingIntervalMs: 3_000, pongTimeoutMs: 500 },
    });
    boot.peer.start();
    await settleUntil(() => boot.peer.getConnectionState() === 'ready', '连接 ready');
    await settleUntil(() => boot.peer.getNamespaceState(boot.nsId) === 'live', 'ns live');
    await settle();
    const wire1 = boot.wires[0]!;

    // 1. hub 超时收口：wire1 的 hub→peer close 通知被扣留（peer 未知连接已死）
    wire1.holdPeerCloseOnce();
    await boot.hubSched.advanceBy(1_000);
    expect(wire1.hubPings()).toBe(1);
    await boot.hubSched.advanceBy(500);
    await settle();
    expect(wire1.hubEnd.closed).toBe(true);
    expect(wire1.lastCloseDeliveredToPeer).toBeUndefined(); // 扣留——零投递
    expect(boot.peer.getConnectionState()).toBe('ready');

    // 2. peer 自身 liveness 超时（peer-connection.ts:308-311 路径）→ backoff → 重拨 → wire2
    await boot.rec.advanceBy(3_500);
    await settle();
    expect(boot.peer.getConnectionState()).toBe('backoff');
    await boot.rec.advanceBy(100);
    await settleUntil(() => boot.peer.getConnectionState() === 'ready', '重拨后 ready');
    await settleUntil(() => boot.peer.getNamespaceState(boot.nsId) === 'live', '重连后 live');
    expect(boot.wires.length).toBe(2);

    // 3. hub 早先的 1001 迟到到达（投递给当时监听器集——旧 wire 已退订 → 空集）
    wire1.releaseHeldPeerClose();
    await settle();
    expect(boot.peer.getConnectionState()).toBe('ready');
    expect(boot.peer.getNamespaceState(boot.nsId)).toBe('live');
    expect(boot.peer.getConnectionState()).not.toBe('blocked');

    // 4. worst-case：旧代际 close 携永久类 code 1002 迟到 → 不得把新代际打入 blocked
    wire1.fireStalePeerClose(1002, 'stale-protocol-error');
    await settle();
    expect(boot.peer.getConnectionState()).toBe('ready'); // 🟥 守卫锚（旧代际关闭 + 误订阅 → blocked → 红）
    expect(boot.peer.getNamespaceState(boot.nsId)).toBe('live');
    expect(boot.hub.connections.length).toBe(1);
    expect(boot.wires.length).toBe(2); // 无多余重拨
  });

  it('T4c 旧 wire 迟到数据帧：代际守卫零污染（AC-7）', async () => {
    const boot = await bootReady();
    const wire1 = boot.wires[0]!;
    await boot.hubSched.advanceBy(1_000);
    await boot.hubSched.advanceBy(500);
    await settle();
    expect(boot.peer.getConnectionState()).toBe('backoff');
    await boot.rec.advanceBy(100);
    await settleUntil(() => boot.peer.getConnectionState() === 'ready', '重拨后 ready');
    await settleUntil(() => boot.peer.getNamespaceState(boot.nsId) === 'live', '重连后 live');
    // 旧 wire 迟到 RESYNC_REQUIRED（worst-case 直注——hub 侧已 closed，见文件头差异说明）
    wire1.fireStaleData(
      encodeMessage(
        { kind: 'RESYNC_REQUIRED', namespaceId: boot.nsId, reasonCode: 'stale-old-wire' },
        { sequence: 1 },
      ),
    );
    await settle();
    expect(boot.peer.getConnectionState()).toBe('ready');
    expect(boot.peer.getNamespaceState(boot.nsId)).toBe('live');
    expect(boot.hub.connections.length).toBe(1);
  });

  it('T4d 订阅摘除结构锚（peer 侧）：重连后旧 transport 订阅全摘（AC-5 第三面）', async () => {
    const boot = await bootIssue176({ instrumentPeerEnd: true });
    boot.peer.start();
    await settleUntil(() => boot.peer.getConnectionState() === 'ready', '连接 ready');
    await settleUntil(() => boot.peer.getNamespaceState(boot.nsId) === 'live', 'ns live');
    await settle();
    expect(boot.peerStats).toHaveLength(1);
    const wire1 = boot.wires[0]!;
    await boot.hubSched.advanceBy(1_000);
    await boot.hubSched.advanceBy(500);
    await settle();
    expect(boot.peer.getConnectionState()).toBe('backoff');
    await boot.rec.advanceBy(100);
    await settleUntil(() => boot.peer.getConnectionState() === 'ready', '重拨后 ready');
    await settleUntil(() => boot.peer.getNamespaceState(boot.nsId) === 'live', '重连后 live');
    expect(boot.peerStats).toHaveLength(2);
    // 🟩：wire1 旧订阅（onMessage + onClose）在 dialNow unsubscribeTransport 时全摘
    const wire1Stats = boot.peerStats[0]!();
    expect(wire1Stats.total).toBeGreaterThan(0);
    expect(wire1Stats.detached).toBe(wire1Stats.total);
  });

  it('T5 负向：pong 常答不关（AC-2/AC-5 反面）', async () => {
    const boot = await bootReady();
    const wire = boot.wires[0]!;
    for (let i = 0; i < 3; i += 1) {
      await boot.hubSched.advanceBy(1_000);
      wire.fireHubPong(); // 清 pong timer（liveness.ts:25-30）
      await settle();
    }
    expect(wire.hubEnd.closed).toBe(false);
    expect(wire.lastCloseDeliveredToPeer).toBeUndefined(); // 零关闭
    expect(boot.peer.getConnectionState()).toBe('ready');
    expect(boot.peer.getNamespaceState(boot.nsId)).toBe('live');
    expect(wire.hubPings()).toBe(3); // 误杀为零、活性循环持续
  });

  it('T6 收尾卫生：stop 后 rec.pending 零残留 + hub.close 幂等收口（AC-5）', async () => {
    const boot = await bootReady();
    const wire1 = boot.wires[0]!;
    await boot.hubSched.advanceBy(1_000);
    expect(wire1.hubPings()).toBe(1);
    await boot.hubSched.advanceBy(500);
    await settle();
    expect(boot.peer.getConnectionState()).toBe('backoff');
    await boot.rec.advanceBy(100);
    await settleUntil(() => boot.peer.getConnectionState() === 'ready', '重拨后 ready');
    await settleUntil(() => boot.peer.getNamespaceState(boot.nsId) === 'live', '重连后 live');
    // 收尾：stop（backoff/hello/reset/controller/liveness 计时全清——peer 复制面在 rec 上）
    await boot.peer.stop();
    await settleUntil(() => boot.peer.getConnectionState() === 'stopped', 'stopped');
    expect(boot.rec.pending()).toBe(0);
    await boot.hub.close(); // 幂等收口
    await settle();
    expect(boot.hub.connections.length).toBe(0);
  });
});

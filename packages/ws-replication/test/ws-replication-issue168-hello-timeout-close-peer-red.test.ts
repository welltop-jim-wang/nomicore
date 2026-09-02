/**
 * issue #168 红灯契约（SA6 Phase 1 rd）—— ws-replication peer 侧 HELLO 超时同步关闭旧
 * transport（孤儿传输竞速窗口收口）。
 *
 * 背景：SA7 round 2 D5 锚测试（ws-replication-sa7-round2-dynamic.test.ts）当前把
 * `peerSideClosed === false` 作为「登记观察」断言——hello 超时后 peer 只进 backoff，
 * 旧 transport 的 peer 半边保持开放，直到 hub 侧同值 HELLO_TIMEOUT(1002) 兜底才收口
 * （孤儿窗口）。SA5 分析（wiki/raw/20260830-bug-…synchronously.md）：root cause 在
 * peer-connection.ts `armHello`（:908-914）——hello 超时回调只调 onTemporaryFailure，
 * 而关闭是「路径特定的」（pong-timeout 在自己的回调里自关 :421-432；hello-timeout
 * 没有对应的自关代码），违反 wire contract docs/protocols/instance-replication-v1.md
 * §18「HELLO/pong timeout关闭连接」。修复方向：hello 超时入口执行 established
 * pong-timeout detach-close 序列（停 liveness → 退订 → epoch 失效 → close(1001) →
 * onTemporaryFailure(epochAlreadyInvalidated=true)），进入 backoff 前同步关闭旧传输。
 *
 * 本契约锚点（行为断言，零源码 grep、零 skip、零 real sleep）：
 *   1. 【红色核心】hello 超时（100ms）→ backoff 时 peer 侧旧 transport 必须已
 *      同步关闭（wire1.peerSideClosed === true）——当前实现为 false（缺陷在场）。
 *   2. 【序列签名】hub 侧可观测到 close 事件 { code: 1001, reason: 'hello-timeout' }
 *      （established detach-close 序列的 code/reason 签名，与 pong-timeout 同构；
 *      reason 沿用观测词表既有词 hello-timeout）。
 *   3. 【观测面】恰好一次 connection-backoff-scheduled（reason=hello-timeout,
 *      attempt=1）；无 connection-failed（临时失败，非 blocked）。
 *   4. 【迟到并发步幂等】in-flight HELLO_ACK 落旧 wire（epoch/退订双闸）→ 零扰动；
 *      hub 侧同值 HELLO_TIMEOUT（10s）到点只剩幂等 no-op（state 守卫）——新连接不受影响。
 *   5. 【恢复链路】backoff → 重拨（wire2）→ ready → live；hub.connections 仅 1。
 *   6. 【冻结面】dial-throw 仍走 backoff(dial-failed) + 重试恢复（关闭动作不外溢到
 *      无 transport 入口）；远端 1001 关闭（onClose 入口）仍 backoff(socket-closed) +
 *      恢复，且迟到 hello 定时器零副作用（clear-on-ack 与状态守卫双保险）。
 *
 * 同款模式来源：SA7 D5/D3 锚（真实 Registry/Runtime + fake scheduler + 内存双端
 * liveness wire；虚拟时间推进，零真实等待）。
 */
import { describe, expect, it } from 'vitest';
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type {
  DuplexTransport,
  HubReplication,
  PeerReplication,
  ReplicationObserver,
  ReplicationObserverEvent,
} from '@nomicore/ws-replication';
import { decodeMessage, encodeMessage } from '@nomicore/replication-protocol';
import type { ReplicationMessage } from '@nomicore/replication-protocol';
import {
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  PEER_OWNER,
  makeHubNamespace,
  makeNode,
  settle,
  settleUntil,
  type HubNamespaceFixture,
  type ReplicaNode,
} from './harness.js';
import { DEFAULT_PEER_VERIFIER, TEST_TOKEN, makeAuthorizer } from './driver.js';

// ═══════════════════════════ 事件收集器（观测面锚点） ═══════════════════════════

class Collector {
  readonly events: ReplicationObserverEvent[] = [];
  readonly observer: ReplicationObserver = (event) => {
    this.events.push(event);
  };
  of(type: ReplicationObserverEvent['type']): ReplicationObserverEvent[] {
    return this.events.filter((e) => e.type === type);
  }
  lastOf(type: ReplicationObserverEvent['type']): ReplicationObserverEvent | undefined {
    const all = this.of(type);
    return all[all.length - 1];
  }
}

// ═══════════════════════════ 内存双端 liveness wire（含 ping/onPong + 选帧扣抛） ═══════════════════════════

interface LivenessWireOptions {
  /** ping 后自动复 pong（重连代 wire 用——避免观察窗内新代被自身 pong 超时收口）。 */
  readonly autoPong?: boolean;
  /** 扣下一帧指定 kind 的 peer→hub 帧（一次性——首代扣 HELLO 用：hub 等 HELLO 才起 HELLO_TIMEOUT）。 */
  readonly dropNextPeerToHubKind?: string;
}

interface LivenessLogWire {
  readonly peerEnd: DuplexTransport & { ping(data?: Uint8Array): void };
  readonly hubEnd: DuplexTransport;
  readonly hubToPeer: Uint8Array[];
  readonly peerToHub: Uint8Array[];
  readonly peerSideClosed: boolean;
  readonly hubSideCloseInfo: Readonly<{ code: number; reason: string }> | undefined;
  /** 网络级断线（hub 侧发起）：真实 WS 语义——对端（peer 应用）收 onClose，
   *  本地（hub 应用）同样收本方 socket 关闭事件（同 makeWire.closePeerSide 建模）。 */
  closeHubSide(code?: number, reason?: string): void;
  nextHubSeq(): number;
}

function makeLivenessLogWire(opts: LivenessWireOptions = {}): LivenessLogWire {
  const peerListeners = new Set<(bytes: Uint8Array) => void>();
  const peerCloseListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const hubListeners = new Set<(bytes: Uint8Array) => void>();
  const hubCloseListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const pongListeners = new Set<(payload?: Uint8Array) => void>();
  const hubToPeer: Uint8Array[] = [];
  const peerToHub: Uint8Array[] = [];
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
    ping(data?: Uint8Array) {
      if (opts.autoPong === true) {
        // RFC 6455 §5.5.2：pong 回显 ping 载荷——以 ping 载荷投递（忠实回显）。
        queueMicrotask(() => {
          for (const listener of [...pongListeners]) listener(data);
        });
      }
    },
    onPong(listener: (payload?: Uint8Array) => void) {
      pongListeners.add(listener);
      return () => pongListeners.delete(listener);
    },
  } as DuplexTransport & { ping(data?: Uint8Array): void };

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
    get peerSideClosed() {
      return peerClosed;
    },
    get hubSideCloseInfo() {
      return hubSideCloseInfo;
    },
    closeHubSide(code = 1001, reason = 'hub-close') {
      if (hubClosed) return;
      hubClosed = true;
      queueMicrotask(() => {
        for (const listener of [...peerCloseListeners]) listener({ code, reason });
        for (const listener of [...hubCloseListeners]) listener({ code, reason });
      });
    },
    nextHubSeq() {
      let max = 0;
      for (const bytes of hubToPeer) max = Math.max(max, decodeMessage(bytes).header.sequence);
      return max + 1;
    },
  };
}

// ═══════════════════════════ 组装（真实 Registry/Runtime + fake 双端 + fake scheduler） ═══════════════════════════

interface Env168 {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly wires: LivenessLogWire[];
  readonly nsId: string;
  readonly peerEvents: Collector;
}

interface Boot168Options {
  /** peer 侧 hello 超时（探针值——读小以确定性展开握手窗口）。 */
  readonly peerHelloTimeoutMs: number;
  /** hub 侧 hello 超时（缺省 10s——协议缺省同值兜底面）。 */
  readonly hubHelloTimeoutMs?: number;
  /** 首代 wire 扣 peer→hub HELLO（缺省 true——hub 收不到 HELLO → 起自身 HELLO_TIMEOUT 兜底面）。 */
  readonly dropFirstHello?: boolean;
  /** 首次 dial 抛错（冻结面 dial-throw 探针）；随后 dial 正常建 wire。 */
  readonly dialThrowsFirst?: boolean;
  /** peer 观测面收集器（注入 observer）。 */
  readonly peerEvents?: Collector;
}

async function boot168(opts: Boot168Options): Promise<Env168> {
  const { peerHelloTimeoutMs, hubHelloTimeoutMs = 10_000 } = opts;
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const authorizer = makeAuthorizer({});
  const fixture: HubNamespaceFixture = await makeHubNamespace(hubNode, { owner: HUB_OWNER });
  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: hubNode.registry,
    authorize: authorizer.authorize,
    timer: hubNode.scheduler,
    verifyToken: DEFAULT_PEER_VERIFIER,
    timeouts: { helloTimeoutMs: hubHelloTimeoutMs },
  });
  const peerEvents = opts.peerEvents ?? new Collector();
  const wires: LivenessLogWire[] = [];
  let dialCalls = 0;
  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      dialCalls += 1;
      if (opts.dialThrowsFirst === true && dialCalls === 1) throw new Error('dial boom (issue168 probe)');
      // 首代 wire 扣 peer→hub HELLO（一次性）→ hub 收不到 HELLO → 起 hub 侧 HELLO_TIMEOUT
      // （同值兜底面）；peer 侧 hello 超时先行 → 孤儿窗口展开（缺陷现状）
      const wire = makeLivenessLogWire({
        autoPong: true,
        ...(opts.dropFirstHello !== false && wires.length === 0 ? { dropNextPeerToHubKind: 'HELLO' } : {}),
      });
      wires.push(wire);
      hub.accept(wire.hubEnd, { token: TEST_TOKEN });
      return wire.peerEnd;
    },
    timer: peerNode.scheduler,
    observer: peerEvents.observer,
    targets: [{ namespaceId: fixture.namespaceId, localOwner: PEER_OWNER }],
    timeouts: { helloTimeoutMs: peerHelloTimeoutMs },
    backoff: { baseMs: 50, maxMs: 400, resetAfterMs: 500 },
    random: () => 0.5,
  });
  return { hubNode, peerNode, hub, peer, wires, nsId: fixture.namespaceId, peerEvents };
}

// ═══════════════════════════ T1：hello 超时同步关闭旧 peer transport（红色核心） ═══════════════════════════

describe('issue #168 红灯契约（SA6）：hello 超时同步关闭 peer 侧旧 transport（孤儿竞速窗口收口）', () => {
  it('T1：hello 超时（100ms）→ peer 侧旧 transport 同步关闭（close(1001, hello-timeout)）；迟到并发步幂等；重拨恢复；hub 侧 HELLO_TIMEOUT 幂等 no-op', async () => {
    const env = await boot168({ peerHelloTimeoutMs: 100 });
    env.peer.start();
    // hello 超时（ACK 被扣）→ 修复后：established detach-close 序列同步关闭旧传输 → backoff
    await env.peerNode.scheduler.advanceBy(100);
    await settleUntil(() => env.peer.getConnectionState() === 'backoff', 'hello 超时 → backoff');
    await settle(); // close 事件经微任务投递到 hub 侧——先排空再断言
    const wire1 = env.wires[0]!;
    // ── 红色核心契约（issue #168）：hello 超时入口必须同步关闭旧 peer transport ──
    //    （缺陷现状：peerSideClosed === false——孤儿窗口在场，等 hub 侧 HELLO_TIMEOUT 兜底收口）
    expect(wire1.peerSideClosed, 'hello 超时同步关闭 peer 侧旧 transport（孤儿窗口收口）').toBe(true);
    // ── established detach-close 序列签名：close 事件以 {1001, hello-timeout} 到达 hub 侧 ──
    //    （pong-timeout 同构：peer 本地超时是内部路径，无 wire ERROR 帧；code 1001 对齐 §18 R4）
    expect(wire1.hubSideCloseInfo, '序列签名：close(1001, hello-timeout) 到达 hub 侧').toEqual({
      code: 1001,
      reason: 'hello-timeout',
    });
    // ── 观测面：恰好一次 backoff（reason=hello-timeout 词表既有词；attempt=1）——无重复收口 ──
    const b1 = env.peerEvents.lastOf('connection-backoff-scheduled');
    expect(b1, 'backoff 事件存在且字段对齐').toMatchObject({
      type: 'connection-backoff-scheduled',
      side: 'peer',
      attempt: 1,
      reason: 'hello-timeout',
    });
    expect(env.peerEvents.of('connection-backoff-scheduled')).toHaveLength(1);
    expect(env.peerEvents.of('connection-failed'), '临时失败分类——零 connection-failed').toHaveLength(0);
    // ── 迟到并发拨号步（in-flight HELLO_ACK 落旧 wire——epoch/退订双闸）：零扰动 ──
    wire1.hubEnd.send(
      encodeMessage(
        {
          kind: 'HELLO_ACK',
          hubInstanceId: HUB_INSTANCE,
          protocolVersion: 1,
          selectedCapabilities: 0,
          connectionNonce: new Uint8Array(16),
          connectionId: 'late-ack-issue-168',
        } as ReplicationMessage,
        { sequence: wire1.nextHubSeq() },
      ),
    );
    await settle();
    expect(env.peer.getConnectionState(), '迟到 HELLO_ACK 零扰动（仍 backoff，无 blocked/重入）').toBe('backoff');
    expect(env.peerEvents.of('connection-backoff-scheduled'), '无第二次 backoff（迟到步零副作用）').toHaveLength(1);
    // ── 恢复链路：backoff（0.5×50=25ms）→ 重拨（wire2）→ ready → live；hub 只见新连接 ──
    await env.peerNode.scheduler.advanceBy(25);
    await settleUntil(() => env.peer.getConnectionState() === 'ready', '重拨 ready');
    await settleUntil(() => env.peer.getNamespaceState(env.nsId) === 'live', '重连 live');
    expect(env.wires, '恰好两个代际（旧代已收口，无第三次拨号）').toHaveLength(2);
    // hub 侧收口是异步链（onTransportClosed → cleanupAll → dropConnection）——轮询等待收口完成
    await settleUntil(() => env.hub.connections.length === 1, 'hub 收口旧连接（仅剩新连接）');
    const wire2 = env.wires[1]!;
    expect(wire2.peerSideClosed, '新代传输不受旧代收口影响').toBe(false);
    // ── hub 侧同值 HELLO_TIMEOUT（10s）到点：peer 已同步关闭 → 定时器只剩幂等 no-op ──
    await env.hubNode.scheduler.advanceBy(10_000);
    await settle();
    expect(env.peer.getConnectionState(), 'hub 旧定时器 no-op（新连接不受影响）').toBe('ready');
    expect(wire2.peerSideClosed, '新代传输保持开放').toBe(false);
    expect(env.hub.connections, 'hub 仍未重复收口').toHaveLength(1);
    expect(wire1.peerSideClosed, '旧 wire 关闭态保持（无复活）').toBe(true);
    await env.peer.stop();
    await settleUntil(() => env.peer.getConnectionState() === 'stopped', 'stopped');
  });
});

// ═══════════════════════════ T2：冻结面——dial-throw ═══════════════════════════

describe('issue #168 冻结面锁定（SA6）：dial-throw / onClose 入口行为必须保持', () => {
  it('T2：dial 抛错仍 backoff(dial-failed, attempt:1)，重试正常建链 ready/live——关闭动作不外溢到无 transport 入口', async () => {
    const events = new Collector();
    const env = await boot168({ peerHelloTimeoutMs: 10_000, dropFirstHello: false, dialThrowsFirst: true, peerEvents: events });
    env.peer.start();
    // 首次 dial throw → onTemporaryFailure('dial-failed')（无新 transport 可关——this.transport 未赋值）
    await settleUntil(() => env.peer.getConnectionState() === 'backoff', 'dial throw → backoff');
    const b1 = events.lastOf('connection-backoff-scheduled');
    expect(b1, 'frozen：backoff(dial-failed, attempt:1)').toMatchObject({
      type: 'connection-backoff-scheduled',
      side: 'peer',
      attempt: 1,
      reason: 'dial-failed',
    });
    expect(events.of('connection-failed'), '临时失败分类——零 connection-failed').toHaveLength(0);
    // backoff(25ms) 到期 → 第二次 dial 成功 → wire1 HELLO 放行 → ready → live
    await env.peerNode.scheduler.advanceBy(25);
    await settleUntil(() => env.peer.getConnectionState() === 'ready', '重试 ready');
    await settleUntil(() => env.peer.getNamespaceState(env.nsId) === 'live', '重试 live');
    expect(env.wires).toHaveLength(1);
    expect(env.wires[0]!.peerSideClosed, '建链成功的 transport 保持开放').toBe(false);
    expect(env.hub.connections).toHaveLength(1);
    await env.peer.stop();
    await settleUntil(() => env.peer.getConnectionState() === 'stopped', 'stopped');
  });

  it('T3：handshaking 期远端 close(1001) 仍 backoff(socket-closed) + 重拨恢复；迟到 hello 定时器零副作用', async () => {
    const events = new Collector();
    const env = await boot168({ peerHelloTimeoutMs: 10_000, dropFirstHello: false, peerEvents: events });
    env.peer.start();
    // 首代 HELLO 放行 → hub ACK → ready（hello 定时器已被 clear-on-ack 清除）
    await settleUntil(() => env.peer.getConnectionState() === 'ready', '首连 ready');
    await settleUntil(() => env.peer.getNamespaceState(env.nsId) === 'live', '首连 live');
    const wire1 = env.wires[0]!;
    // 远端 1001 关闭（onClose 入口——frozen 面）：socket-closed → backoff，传输已死无需自关
    wire1.closeHubSide(1001, 'hub-close');
    await settleUntil(() => env.peer.getConnectionState() === 'backoff', '远端关闭 → backoff');
    const b1 = events.lastOf('connection-backoff-scheduled');
    expect(b1, 'frozen：backoff(socket-closed)').toMatchObject({
      type: 'connection-backoff-scheduled',
      side: 'peer',
      attempt: 1,
      reason: 'socket-closed',
    });
    // 恢复：重拨（wire2）→ ready → live
    await env.peerNode.scheduler.advanceBy(25);
    await settleUntil(() => env.peer.getConnectionState() === 'ready', '重拨 wire2 ready');
    await settleUntil(() => env.peer.getNamespaceState(env.nsId) === 'live', '重连 live');
    expect(env.wires).toHaveLength(2);
    const wire2 = env.wires[1]!;
    expect(wire2.peerSideClosed).toBe(false);
    // hub 侧收口是异步链（onTransportClosed → cleanupAll → dropConnection）——轮询等待收口完成
    await settleUntil(() => env.hub.connections.length === 1, 'hub 收口旧连接（仅剩新连接）');
    // 迟到 hello 定时器（wire2 的 helloTimeoutMs=10s 到点）：状态守卫（ready）→ no-op；wire2 不受影响
    await env.peerNode.scheduler.advanceBy(10_000);
    await settle();
    expect(env.peer.getConnectionState(), '迟到 hello 定时器零副作用（ready 保持）').toBe('ready');
    expect(wire2.peerSideClosed, '新代传输未被迟到定时器关闭').toBe(false);
    expect(events.of('connection-backoff-scheduled'), '无第二次 backoff').toHaveLength(1);
    await env.peer.stop();
    await settleUntil(() => env.peer.getConnectionState() === 'stopped', 'stopped');
  });
});

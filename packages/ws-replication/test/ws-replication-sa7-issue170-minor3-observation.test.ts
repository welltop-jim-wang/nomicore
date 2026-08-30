/**
 * SA7 观察探针（issue #170 动态验证）—— SA2 MINOR #3：
 * 「GOAWAY drain deadline 落在长 backoff 窗口内」的既有语义观察。
 *
 * 背景（SA2 攻击评审 #3 / SA4 动态审核重点 #4）：
 *   round2 D3 已覆盖「短 backoff——重连先于 deadline，dialNow:clearGoawayDrain
 *   吸收迟到 deadline」。本探针补对偶面：backoff 窗口（50s）长于 drain deadline
 *   （5s）时，deadline 在 backoff 中途触发。登记为既有语义观察（现行
 *   onTemporaryFailure 不清 goawayDrainHandle——非本任务缺陷面，断言的是现状 +
 *   恢复收敛，非红灯契约）。
 *
 * 时间线（虚拟时钟；pingInterval=1s / pongTimeout=0.5s / backoff 100k×0.5=50s）：
 *   t=0.0  GOAWAY(SERVER_RESTARTING, drain 5_000)——drain 窗口开启，FSM 仍 ready
 *   t=1.0  ping1（首代 wire 不复 pong）
 *   t=1.5  pong 超时收口：close(1001,'pong-timeout') → backoff（至 t=51.5）；
 *          controllers onConnectionLost → ns disconnected
 *   t=5.0  drain deadline 在 backoff 窗内触发：quiesceControllers（幂等投影）+
 *          sender?.teardown()（已 undefined）+ transport 已关 → 零二次 close
 *   t=51.5 backoff 到期 → dialNow（clearGoawayDrain 幂等 + goawayActive=false）
 *          → wire2 → ready → openActiveTargets 重开 → live → 数据收敛
 *
 * 观察断言（现状锚，非修复契约）：
 *   1. FSM 跨 deadline 恒 'backoff'（deadline 回调不触碰连接 FSM）；
 *   2. peerCloseLog 全程恰一条 {1001,'pong-timeout'}（零二次 close）；
 *   3. backoff 窗内零已关传输 ping（P4 同款观察，liveness 已停）；
 *   4. 重连恰一次（dialCount 2）、hub 只留新连接、ns 重开 live、写值收敛；
 *   5. 重连后无残留 drain 定时器关闭新传输（wire2 保持开放）。
 *
 * 纪律：真实 yjs / Registry / Runtime / HubReplication / PeerReplication；内存
 * 双端 wire（pong 回显 ping 载荷）；fake scheduler 虚拟时钟；零 real sleep、零
 * skip、零源码 grep 断言——全部为运行时可观测行为。
 */
import { describe, expect, it } from 'vitest';
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type { DuplexTransport, HubReplication, PeerReplication } from '@nomicore/ws-replication';
import { decodeMessage, encodeMessage, type ReplicationMessage } from '@nomicore/replication-protocol';
import { DEFAULT_PEER_VERIFIER, makeAuthorizer, TEST_TOKEN } from './driver.js';
import {
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  PEER_OWNER,
  makeHubNamespace,
  makeNode,
  settle,
  settleUntil,
  type ReplicaNode,
} from './harness.js';

// ═══════════════════════════ 探针常量 ═══════════════════════════

const PING_INTERVAL_MS = 1_000;
const PONG_TIMEOUT_MS = 500;
const DRAIN_DEADLINE_MS = 5_000;
/** backoff base/max = 100_000 × random 0.5 → 50_000（重拨于 pong 超时后 50s）。 */
const BACKOFF_DELAY_MS = 50_000;

// ═══════════════════════════ wire fixture（D3 同款 + peerCloseLog/ping 记录） ═══════════════════════════

interface GoawayProbeWire {
  readonly peerEnd: DuplexTransport & { ping(data?: Uint8Array): void };
  readonly hubEnd: DuplexTransport;
  readonly hubToPeer: Uint8Array[];
  readonly peerToHub: Uint8Array[];
  pingCount(): number;
  /** 本端（peer 侧）发起的 close 调用记录——「零二次 close」判别点。 */
  peerCloseLog(): ReadonlyArray<Readonly<{ code: number; reason: string }>>;
  readonly peerSideClosed: boolean;
  readonly hubSideCloseInfo: Readonly<{ code: number; reason: string }> | undefined;
  nextHubSeq(): number;
}

function makeGoawayProbeWire(opts: { autoPong: boolean }): GoawayProbeWire {
  const peerListeners = new Set<(bytes: Uint8Array) => void>();
  const peerCloseListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const hubListeners = new Set<(bytes: Uint8Array) => void>();
  const hubCloseListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const pongListeners = new Set<(payload?: Uint8Array) => void>();
  const hubToPeer: Uint8Array[] = [];
  const peerToHub: Uint8Array[] = [];
  const peerCloseLog: Array<Readonly<{ code: number; reason: string }>> = [];
  let pings = 0;
  let peerClosed = false;
  let hubClosed = false;
  let hubSideCloseInfo: Readonly<{ code: number; reason: string }> | undefined;

  const peerEnd = {
    send(bytes: Uint8Array) {
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
      peerCloseLog.push({ code, reason });
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
      pings += 1;
      if (opts.autoPong) {
        // RFC 6455 §5.5.2：pong 回显 ping 载荷（忠实回显——重连代保持健康）。
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
    pingCount: () => pings,
    peerCloseLog: () => peerCloseLog,
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

// ═══════════════════════════ 环境 ═══════════════════════════

interface GoawayProbeEnv {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly wires: GoawayProbeWire[];
  readonly nsId: string;
  writeHub(value: number): Promise<void>;
  rootValue(side: 'hub' | 'peer'): unknown;
}

async function bootGoawayProbe(): Promise<GoawayProbeEnv> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const authorizer = makeAuthorizer({});
  const fixture = await makeHubNamespace(hubNode);
  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: hubNode.registry,
    authorize: authorizer.authorize,
    verifyToken: DEFAULT_PEER_VERIFIER,
    timer: hubNode.scheduler,
  });
  const wires: GoawayProbeWire[] = [];
  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      // 首代 wire 不复 pong（确定性触发 pong 超时）；重连代 autoPong（保持健康）。
      const wire = makeGoawayProbeWire({ autoPong: wires.length > 0 });
      wires.push(wire);
      void hub.accept(wire.hubEnd, { token: TEST_TOKEN });
      return wire.peerEnd;
    },
    timer: peerNode.scheduler,
    targets: [{ namespaceId: fixture.namespaceId, localOwner: PEER_OWNER }],
    timeouts: { pingIntervalMs: PING_INTERVAL_MS, pongTimeoutMs: PONG_TIMEOUT_MS },
    backoff: { baseMs: 100_000, maxMs: 100_000, resetAfterMs: 10_000 },
    random: () => 0.5,
  });
  return {
    hubNode,
    peerNode,
    hub,
    peer,
    wires,
    nsId: fixture.namespaceId,
    async writeHub(value: number) {
      const result = await fixture.lease.mutateRoot({ op: 'set', path: ['n'], value });
      if (!result.ok) throw new Error(`hub 写失败：${JSON.stringify(result)}`);
      await settle();
    },
    rootValue(side: 'hub' | 'peer') {
      const node = side === 'hub' ? hubNode : peerNode;
      const owner = side === 'hub' ? HUB_OWNER : PEER_OWNER;
      const doc = node.persistence.peek(owner, fixture.namespaceId);
      if (doc === undefined) throw new Error(`${side} 缺副本`);
      return (doc.getMap('ROOT') as ReadonlyMap<string, unknown>).get('n');
    },
  };
}

// ═══════════════════════════ SA2 MINOR #3 观察探针 ═══════════════════════════

describe('SA7 观察探针（SA2 MINOR #3）：GOAWAY drain deadline 落在长 backoff 窗口内（既有语义）', () => {
  it('drain 5s × backoff 50s：deadline 窗内触发——FSM 恒 backoff、零二次 close；重连后 ns 重开 live、数据收敛', async () => {
    const env = await bootGoawayProbe();
    env.peer.start();
    await settleUntil(() => env.peer.getConnectionState() === 'ready', '连接 ready');
    await settleUntil(() => env.peer.getNamespaceState(env.nsId) === 'live', 'ns live');
    const wire1 = env.wires[0]!;

    // t=0：GOAWAY(SERVER_RESTARTING, drain 5_000)——drain 窗口开启，deadline 排于 t=5.0
    wire1.hubEnd.send(
      encodeMessage(
        { kind: 'GOAWAY', reasonCode: 'SERVER_RESTARTING', drainTimeoutMs: DRAIN_DEADLINE_MS } as ReplicationMessage,
        { sequence: wire1.nextHubSeq() },
      ),
    );
    await settle();
    expect(env.peer.getConnectionState(), 'GOAWAY 收帧后进入 draining（deadline 未到）').toBe('draining');
    expect(wire1.peerSideClosed).toBe(false);

    // t=1.0：ping1（首代 wire 不复 pong）→ pong 超时排于 t=1.5
    await env.peerNode.scheduler.advanceBy(PING_INTERVAL_MS);
    expect(wire1.pingCount(), '前置：ping1 已发').toBe(1);

    // t=1.5：pong 超时收口——close(1001,'pong-timeout') + backoff（至 t=51.5）
    await env.peerNode.scheduler.advanceBy(PONG_TIMEOUT_MS);
    expect(env.peer.getConnectionState(), 'pong 超时 = 临时失败（backoff）').toBe('backoff');
    expect(wire1.peerCloseLog(), '首收口：恰一条 close(1001,pong-timeout)').toEqual([
      { code: 1001, reason: 'pong-timeout' },
    ]);
    await settle();
    expect(wire1.hubSideCloseInfo, 'hub 侧收到 1001/pong-timeout').toEqual({
      code: 1001,
      reason: 'pong-timeout',
    });
    // hub 侧死连接异步清理（SA2 MINOR #4 同款 registry 收口，不推进 hub 时钟）
    await settleUntil(() => env.hub.connections.length === 0, 'hub 清理死连接');

    // t=4.999：deadline 前一刻——FSM 仍 backoff、零 dial、零已关传输 ping
    await env.peerNode.scheduler.advanceBy(DRAIN_DEADLINE_MS - PING_INTERVAL_MS - PONG_TIMEOUT_MS - 1);
    expect(env.peer.getConnectionState(), 'deadline 前仍 backoff').toBe('backoff');
    expect(env.wires.length, 'deadline 前零重拨').toBe(1);
    expect(wire1.pingCount(), 'backoff 窗内零已关传输 ping（liveness 已停）').toBe(1);

    // t≈5.0：drain deadline 在长 backoff 窗内触发（quiesceControllers 幂等 + 传输已关）
    await env.peerNode.scheduler.advanceBy(2);
    expect(env.peer.getConnectionState(), '观察 1：deadline 回调不触碰连接 FSM——恒 backoff').toBe('backoff');
    expect(wire1.peerCloseLog(), '观察 2：deadline 零二次 close（传输已关，幂等 no-op）').toEqual([
      { code: 1001, reason: 'pong-timeout' },
    ]);
    // 观察记录：deadline 的 quiesceControllers 对已 disconnected 的控制器幂等（投影不变）
    expect(env.peer.getNamespaceState(env.nsId), '观察：deadline 投影幂等（ns 保持 disconnected）').toBe('disconnected');
    expect(env.wires.length, 'deadline 不触发重拨').toBe(1);

    // t=51.498（=5_001+46_497）：backoff 到期（t=51.5）前——全程恒 backoff、恰一次 dial
    await env.peerNode.scheduler.advanceBy(46_497);
    expect(env.peer.getConnectionState(), 'backoff 全程保持（无中间迁移）').toBe('backoff');
    expect(env.wires.length).toBe(1);

    // t=51.501：backoff 到期 → dialNow（clearGoawayDrain 幂等 + goawayActive=false）→ wire2
    await env.peerNode.scheduler.advanceBy(3);
    expect(env.wires.length, '观察 4：重连恰一次（dialCount 2）').toBe(2);
    await settleUntil(() => env.peer.getConnectionState() === 'ready', '重拨 ready');
    await settleUntil(() => env.peer.getNamespaceState(env.nsId) === 'live', 'ns failed/disconnected → targeted 重开 → live');
    expect(env.hub.connections.length, '重连后 hub 只留新连接（SA2 MINOR #4 同款断言）').toBe(1);
    const wire2 = env.wires[1]!;

    // 观察记录：deadline 已在 t=5 消费，重连后无残留 drain 定时器关新传输
    await env.peerNode.scheduler.advanceBy(DRAIN_DEADLINE_MS + BACKOFF_DELAY_MS);
    expect(wire2.peerSideClosed, '观察 5：重连后无残留 deadline 关闭新传输').toBe(false);
    expect(env.peer.getConnectionState()).toBe('ready');
    expect(env.peer.getNamespaceState(env.nsId)).toBe('live');
    // 数据最终收敛（断线窗口 hub 写经重连 reconcile 汇聚）
    await env.writeHub(99);
    await settleUntil(() => env.rootValue('peer') === 99, '重连后数据收敛（peer n=99）');
    expect(env.rootValue('hub')).toBe(99);

    await env.peer.stop();
    await settleUntil(() => env.peer.getConnectionState() === 'stopped', 'stopped（零 timer 残留）');
  });
});

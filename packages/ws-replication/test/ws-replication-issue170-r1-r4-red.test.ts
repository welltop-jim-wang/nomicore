/**
 * SA6 红灯 —— issue #170（PR #165 ping/pong seam 收口：epoch 安全 + 协议正确）。
 *
 * 缺陷锚（SA5 分析报告 R1–R4，全部钉住「当前缺陷行为」→ 本测试断言**正确行为**，
 * 现实现下必然红灯；SA3 按修复方向实现后转绿）：
 *
 *   H1（R1）：hub pong 超时走 `connectionFatal('PONG_TIMEOUT', 1002)`——
 *     ① `PONG_TIMEOUT` 不在协议 §10 错误码注册表，ERROR 帧编码抛
 *        `unknown error code`，被 best-effort try/catch 吞掉 → 帧从未上线；
 *     ② close code 1002 违反 §18 L524（pong 超时 = 临时失败，应 1001）与
 *        §14 L387 分类；③ 对端 onClose(1002) → `enterBlocked` → 永不重拨。
 *   P1/P2/P3（R2）：`liveness.ts` pong 监听无条件清「当前任意」`pongHandle`，
 *     ping↔pong 零关联——迟到/重复/未请求 pong 清掉**下一次** ping 的超时，
 *     死对端被误判存活（WS pong 回显 ping 载荷是唯一关联凭据）。
 *   P4（R3）：peer pong 超时闭包只 `close(1001)`+`onTemporaryFailure`，不同步
 *     停旧 liveness / 退订旧 transport 全部监听 / 作废 epoch——backoff 窗口内
 *     旧 liveness 对已关 transport 周期 ping（真实 ws 语义 = timer 回调内
 *     未捕获异常 `WebSocket is not open: readyState 3 (CLOSED)`）。
 *   P5（R4）：`enterBlocked` 完全不停 liveness / 不退订 transport——blocked
 *     终态旧 liveness 无限期运行（周期 ping 死对端；自身 pong 超时再以 1001
 *     二次自关，FSM 仍停留 blocked）。
 *
 * 纪律：真实 yjs / Registry / Runtime / HubReplication / PeerReplication；
 * 内存双端 liveness wire（两端独立 ping/pong 面，pong 回显 ping 载荷——
 * WS 关联凭据；可手动注入任意载荷 pong；可模拟已关传输上 ping 的 ws 语义抛错）；
 * fake scheduler + 微任务推进；零 real sleep、零 skip、零源码 grep 断言。
 * 断言全部为运行时可观测行为：wire 帧 / close 码 / 监听计数 / ping 计数 /
 * 连接 FSM 状态 / 副本收敛值。
 */
import { describe, expect, it } from 'vitest';
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type { DuplexTransport, HubReplication, PeerReplication } from '@nomicore/ws-replication';
import { decodeMessage } from '@nomicore/replication-protocol';
import { DEFAULT_PEER_VERIFIER, makeAuthorizer, TEST_TOKEN } from './driver.js';
import {
  HUB_INSTANCE,
  HUB_OWNER,
  makeHubNamespace,
  makeNode,
  PEER_INSTANCE,
  PEER_OWNER,
  settle,
  settleUntil,
  type ReplicaNode,
} from './harness.js';

// ═══════════════════════════ 契约常量 ═══════════════════════════

/** 协议 §18 工程缺省（docs/protocols/instance-replication-v1.md L524）。 */
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;
/** backoff base/max = 100_000 且 random=0.5 → pong 超时后延迟 50_000 重拨。 */
const BACKOFF_DELAY_MS = 50_000;

// ═══════════════════════════ liveness wire fixture ═══════════════════════════

type PongPayload = Uint8Array | undefined;

/** 活性 facet 传输端点（DuplexTransport + WS 级 ping/pong 面；可选装配 → 缺面 dormant）。 */
interface FacetTransport extends DuplexTransport {
  ping?(data?: Uint8Array): void;
  onPong?(listener: (payload?: Uint8Array) => void): () => void;
}

interface LivenessWireOptions {
  readonly peerFacets: boolean;
  readonly hubFacets: boolean;
  /** peer ping 后微任务自动回 pong（回显 ping 载荷——模拟对端健康应答）。 */
  readonly peerAutoPong: boolean;
  /** hub ping 后微任务自动回 pong。 */
  readonly hubAutoPong: boolean;
  /** 已关传输上 ping 记录 ws 语义错误（`WebSocket is not open: readyState 3`）。 */
  readonly throwPingWhenClosed: boolean;
}

interface FrameProbe {
  readonly kind: string;
  readonly code: string | undefined;
  readonly sequence: number;
}

interface LivenessWire {
  readonly peerEnd: FacetTransport;
  readonly hubEnd: FacetTransport;
  /** 每次 ping 的载荷记录（WS pong 回显凭据；当前实现发无载荷 ping → undefined）。 */
  peerPings(): PongPayload[];
  hubPings(): PongPayload[];
  /** 已关传输上发生的 ping 次数（僵尸活性证据）。 */
  peerPingsAfterClose(): number;
  /** 已关传输上 ping 捕获的 ws 语义错误（真实 ws = timer 回调内未捕获异常）。 */
  closedTransportPingErrors(): Error[];
  /** 各监听面当前订阅数（收口后应全为 0）。 */
  peerPongListeners(): number;
  peerMessageListeners(): number;
  peerCloseListeners(): number;
  hubPongListeners(): number;
  /** 手动注入 pong（同步投递给该端全部 pong 监听器；载荷任意——未请求/迟到凭据）。 */
  injectPeerPong(payload: PongPayload): void;
  injectHubPong(payload: PongPayload): void;
  /** 本端发起的 close 调用记录。 */
  peerCloseLog(): ReadonlyArray<Readonly<{ code: number; reason: string }>>;
  hubCloseLog(): ReadonlyArray<Readonly<{ code: number; reason: string }>>;
  peerClosed(): boolean;
  hubClosed(): boolean;
  hubToPeerFrames(): FrameProbe[];
}

function makeLivenessWire(opts: LivenessWireOptions): LivenessWire {
  const peerListeners = new Set<(bytes: Uint8Array) => void>();
  const peerCloseListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const hubListeners = new Set<(bytes: Uint8Array) => void>();
  const hubCloseListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const peerPongListeners = new Set<(payload?: Uint8Array) => void>();
  const hubPongListeners = new Set<(payload?: Uint8Array) => void>();
  const peerPingPayloads: PongPayload[] = [];
  const hubPingPayloads: PongPayload[] = [];
  const peerCloseLog: Array<Readonly<{ code: number; reason: string }>> = [];
  const hubCloseLog: Array<Readonly<{ code: number; reason: string }>> = [];
  const hubToPeer: Uint8Array[] = [];
  const closedTransportPingErrors: Error[] = [];
  let peerClosed = false;
  let hubClosed = false;
  let peerPingsAfterClose = 0;

  const peerEnd: FacetTransport = {
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
    onClose(listener: (info: Readonly<{ code: number; reason: string }>) => void) {
      peerCloseListeners.add(listener);
      return () => peerCloseListeners.delete(listener);
    },
    ...(opts.peerFacets
      ? {
          ping(data?: Uint8Array) {
            peerPingPayloads.push(data);
            if (peerClosed) {
              peerPingsAfterClose += 1;
              if (opts.throwPingWhenClosed) {
                closedTransportPingErrors.push(
                  new Error('WebSocket is not open: readyState 3 (CLOSED)'),
                );
              }
              return;
            }
            if (opts.peerAutoPong) {
              const payload = data;
              queueMicrotask(() => {
                for (const listener of [...peerPongListeners]) listener(payload);
              });
            }
          },
          onPong(listener: (payload?: Uint8Array) => void) {
            peerPongListeners.add(listener);
            return () => peerPongListeners.delete(listener);
          },
        }
      : {}),
  };

  const hubEnd: FacetTransport = {
    send(bytes: Uint8Array) {
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
      hubCloseLog.push({ code, reason });
      queueMicrotask(() => {
        for (const listener of [...peerCloseListeners]) listener({ code, reason });
      });
    },
    get closed() {
      return hubClosed;
    },
    onMessage(listener: (bytes: Uint8Array) => void) {
      hubListeners.add(listener);
      return () => hubListeners.delete(listener);
    },
    onClose(listener: (info: Readonly<{ code: number; reason: string }>) => void) {
      hubCloseListeners.add(listener);
      return () => hubCloseListeners.delete(listener);
    },
    ...(opts.hubFacets
      ? {
          ping(data?: Uint8Array) {
            hubPingPayloads.push(data);
            if (hubClosed) return;
            if (opts.hubAutoPong) {
              const payload = data;
              queueMicrotask(() => {
                for (const listener of [...hubPongListeners]) listener(payload);
              });
            }
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
    peerPings: () => peerPingPayloads,
    hubPings: () => hubPingPayloads,
    peerPingsAfterClose: () => peerPingsAfterClose,
    closedTransportPingErrors: () => closedTransportPingErrors,
    peerPongListeners: () => peerPongListeners.size,
    peerMessageListeners: () => peerListeners.size,
    peerCloseListeners: () => peerCloseListeners.size,
    hubPongListeners: () => hubPongListeners.size,
    injectPeerPong(payload: PongPayload) {
      for (const listener of [...peerPongListeners]) listener(payload);
    },
    injectHubPong(payload: PongPayload) {
      for (const listener of [...hubPongListeners]) listener(payload);
    },
    peerCloseLog: () => peerCloseLog,
    hubCloseLog: () => hubCloseLog,
    peerClosed: () => peerClosed,
    hubClosed: () => hubClosed,
    hubToPeerFrames: () =>
      hubToPeer.map((bytes) => {
        const decoded = decodeMessage(bytes);
        return {
          kind: decoded.message.kind,
          code: (decoded.message as Readonly<{ code?: string }>).code,
          sequence: decoded.header.sequence,
        };
      }),
  };
}

// ═══════════════════════════ 测试环境（真实 hub/peer + 真实 Registry/Runtime/yjs） ═══════════════════════════

interface Issue170Env {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly wires: LivenessWire[];
  readonly nsId: string;
  dialCount(): number;
  writeHub(value: number): Promise<void>;
  rootValue(side: 'hub' | 'peer'): unknown;
}

interface BootOptions {
  /** 活性面装配：'peer'（仅 peer 端 ping/pong——hub 活性 dormant）| 'hub'（仅 hub 端）。 */
  readonly facets: 'peer' | 'hub';
  /** 首代 wire 不自动回 pong（确定性触发首代 pong 超时）；后代 wire 自动回 pong（保持健康）。 */
  readonly autoPongFromSecond?: boolean;
  /** 已关传输上 ping 记录 ws 语义错误（P4 用）。 */
  readonly throwPingWhenClosed?: boolean;
}

async function bootIssue170(opts: BootOptions): Promise<Issue170Env> {
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
    timeouts: { helloTimeoutMs: 10_000, pingIntervalMs: PING_INTERVAL_MS, pongTimeoutMs: PONG_TIMEOUT_MS },
  });
  const wires: LivenessWire[] = [];
  let dialCount = 0;
  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      dialCount += 1;
      const wire = makeLivenessWire({
        peerFacets: opts.facets === 'peer',
        hubFacets: opts.facets === 'hub',
        peerAutoPong: opts.autoPongFromSecond === true && dialCount > 1,
        hubAutoPong: opts.autoPongFromSecond === true && dialCount > 1,
        throwPingWhenClosed: opts.throwPingWhenClosed === true,
      });
      wires.push(wire);
      void hub.accept(wire.hubEnd, { token: TEST_TOKEN });
      return wire.peerEnd;
    },
    timer: peerNode.scheduler,
    targets: [{ namespaceId: fixture.namespaceId, localOwner: PEER_OWNER }],
    timeouts: { helloTimeoutMs: 10_000, pingIntervalMs: PING_INTERVAL_MS, pongTimeoutMs: PONG_TIMEOUT_MS },
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
    dialCount: () => dialCount,
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

// ═══════════════════════════ H1：hub pong 超时协议语义（R1） ═══════════════════════════

describe('SA6 红灯 issue #170 H1（R1）：hub pong 超时 = 协议临时失败（1001）而非 PONG_TIMEOUT/1002', () => {
  it('H1：hub pong 超时 → close(1001)；零未注册 PONG_TIMEOUT ERROR 帧；peer 走 backoff 重拨重连，数据最终收敛', async () => {
    const env = await bootIssue170({ facets: 'hub', autoPongFromSecond: true });
    env.peer.start();
    await settleUntil(() => env.peer.getConnectionState() === 'ready', '握手 ready');
    const wire1 = env.wires[0]!;
    // 前置：hub 活性武装（ping 面装配）；对端不复 pong
    expect(wire1.hubPongListeners(), '前置：hub pong 监听已注册').toBe(1);
    await env.hubNode.scheduler.advanceBy(PING_INTERVAL_MS);
    expect(wire1.hubPings().length, '前置：hub 发第 1 个 WS ping').toBe(1);
    await env.hubNode.scheduler.advanceBy(PONG_TIMEOUT_MS);
    await settle();
    // ── R1 红灯锚 1：pong 超时关闭码 = 1001（§18 L524 临时失败）；当前 1002/'protocol-error'
    expect(
      wire1.hubCloseLog()[0]?.code,
      'BUG R1：hub pong 超时必须 close(1001)（temporary-failure 语义）——当前 1002 使 peer 进入 blocked 终态',
    ).toBe(1001);
    // ── 协议护栏（绿灯）：不得发明未注册 PONG_TIMEOUT ERROR 帧（§10 注册表无此码；
    //   当前编码抛 `unknown error code` 被吞——帧不上线；修复后不得重新引入）
    const frames = wire1.hubToPeerFrames();
    expect(
      frames.filter((f) => f.kind === 'ERROR' && f.code === 'PONG_TIMEOUT'),
      '协议护栏：wire 上不得出现未注册 PONG_TIMEOUT connection ERROR（§10）',
    ).toHaveLength(0);
    await settle();
    // ── R1 红灯锚 2：peer 收到 1001 关闭 → backoff（temporary-failure）；当前 1002 → blocked 终态
    expect(
      env.peer.getConnectionState(),
      'BUG R1：hub pong 超时关闭后 peer 必须走 backoff（临时失败）——当前 1002 使 peer 进入 blocked、永不重拨',
    ).toBe('backoff');
    // ── R1 红灯锚 3：backoff 到期重拨（random=0.5 × 100_000 = 50_000）；当前 blocked → dialCount 恒 1
    await env.peerNode.scheduler.advanceBy(BACKOFF_DELAY_MS);
    await settle();
    expect(env.dialCount(), 'BUG R1：临时失败必须 backoff 重拨（当前 blocked 永不重拨）').toBe(2);
    // ── 重连后收敛（验收 5/6）：hub 只保留新连接、数据最终汇聚
    await settleUntil(() => env.peer.getConnectionState() === 'ready', '重拨后 ready');
    await settleUntil(() => env.peer.getNamespaceState(env.nsId) === 'live', '重连后 ns live');
    expect(env.hub.connections.length, '重连后 hub 只保留新连接').toBe(1);
    await env.writeHub(99);
    await settleUntil(() => env.rootValue('peer') === 99, '重连后数据收敛（peer n=99）');
    expect(env.rootValue('hub')).toBe(99);
  });
});

// ═══════════════════════════ P1–P3：ping↔pong 关联（R2） ═══════════════════════════

describe('SA6 红灯 issue #170 P1–P3（R2）：迟到/重复/未请求 pong 不得清除在途 ping 的超时', () => {
  it('P1（迟到 pong）：属上一 ping 的迟到回声（载荷 ≠ 在途 ping）不得清除下一 ping 的超时', async () => {
    const env = await bootIssue170({ facets: 'peer' });
    env.peer.start();
    await settleUntil(() => env.peer.getConnectionState() === 'ready', '握手 ready');
    const wire = env.wires[0]!;
    // t=30：ping1（对端不复）
    await env.peerNode.scheduler.advanceBy(PING_INTERVAL_MS);
    expect(wire.peerPings().length, '前置：ping1 已发').toBe(1);
    // ping1 的合法回声（载荷 = ping1 载荷）→ 清除 ping1 的 pong 超时
    wire.injectPeerPong(wire.peerPings()[0]);
    // t=60：ping2（新在途 ping；pong 超时应于 t=70 触发）
    await env.peerNode.scheduler.advanceBy(PING_INTERVAL_MS);
    expect(wire.peerPings().length, '前置：ping2 已发').toBe(2);
    // 属 ping1 的**迟到**回声（载荷 = ping1 载荷，≠ ping2）——必须不得清除 ping2 的超时
    wire.injectPeerPong(wire.peerPings()[0]);
    // t=70：ping2 无应答 → pong 超时必须收口（close 1001 → backoff）
    await env.peerNode.scheduler.advanceBy(PONG_TIMEOUT_MS);
    await settle();
    expect(
      env.peer.getConnectionState(),
      'BUG R2：迟到（旧 ping）pong 不得清掉下一 ping 的超时——t=70 必须 pong 超时收口为 backoff',
    ).toBe('backoff');
    expect(wire.peerCloseLog()[0]?.code, 'BUG R2：pong 超时收口 close code = 1001').toBe(1001);
  });

  it('P2（重复 pong）：同一 pong 的重复投递（载荷 = 上一 ping）不得清除在途下一 ping 的超时', async () => {
    const env = await bootIssue170({ facets: 'peer' });
    env.peer.start();
    await settleUntil(() => env.peer.getConnectionState() === 'ready', '握手 ready');
    const wire = env.wires[0]!;
    // t=30：ping1 + 合法回声（清除 ping1 超时）
    await env.peerNode.scheduler.advanceBy(PING_INTERVAL_MS);
    wire.injectPeerPong(wire.peerPings()[0]);
    // t=60：ping2 在途
    await env.peerNode.scheduler.advanceBy(PING_INTERVAL_MS);
    expect(wire.peerPings().length, '前置：ping2 已发').toBe(2);
    // 同一 pong 的**重复**投递（载荷仍 = ping1 回显）——必须不得清除 ping2 的超时
    wire.injectPeerPong(wire.peerPings()[0]);
    await env.peerNode.scheduler.advanceBy(PONG_TIMEOUT_MS);
    await settle();
    expect(
      env.peer.getConnectionState(),
      'BUG R2：重复（旧 ping）pong 不得清掉下一 ping 的超时——t=70 必须 pong 超时收口为 backoff',
    ).toBe('backoff');
    expect(wire.peerCloseLog()[0]?.code, 'BUG R2：pong 超时收口 close code = 1001').toBe(1001);
  });

  it('P3（未请求 pong）：载荷从未发送过的 pong 不得清除在途 ping 的超时（死对端不得被误判存活）', async () => {
    const env = await bootIssue170({ facets: 'peer' });
    env.peer.start();
    await settleUntil(() => env.peer.getConnectionState() === 'ready', '握手 ready');
    const wire = env.wires[0]!;
    // t=30：ping1（对端死——从不应答）
    await env.peerNode.scheduler.advanceBy(PING_INTERVAL_MS);
    expect(wire.peerPings().length, '前置：ping1 已发').toBe(1);
    // 未请求 pong（载荷从未出现在任何 ping 上）——必须不得清除 ping1 的超时
    wire.injectPeerPong(new Uint8Array([0xde, 0xad]));
    // t=40：ping1 无应答 → pong 超时必须收口（close 1001 → backoff）
    await env.peerNode.scheduler.advanceBy(PONG_TIMEOUT_MS);
    await settle();
    expect(
      env.peer.getConnectionState(),
      'BUG R2：未请求 pong 不得清掉在途 ping 的超时——死对端不得被误判存活（t=40 必须 backoff）',
    ).toBe('backoff');
    expect(wire.peerCloseLog()[0]?.code, 'BUG R2：pong 超时收口 close code = 1001').toBe(1001);
  });
});

// ═══════════════════════════ P4：peer pong 超时同步收口 + 重连（R3 + old-epoch） ═══════════════════════════

describe('SA6 红灯 issue #170 P4（R3 + 验收 1/2/5/6）：pong 超时同步收口栈——停活性/退订/关传输后再排 backoff', () => {
  it('P4：超时即同步停旧 liveness、退订旧 transport 全部监听（旧代 pong 惰性）；backoff 窗内零 ping 已关传输；重连收敛', async () => {
    const env = await bootIssue170({
      facets: 'peer',
      autoPongFromSecond: true,
      throwPingWhenClosed: true,
    });
    env.peer.start();
    await settleUntil(() => env.peer.getConnectionState() === 'ready', '握手 ready');
    const wire1 = env.wires[0]!;
    // t=30：peer ping1（对端不复）→ t=40 pong 超时：close(1001) + backoff（现有行为已正确——绿灯护栏）
    await env.peerNode.scheduler.advanceBy(PING_INTERVAL_MS);
    expect(wire1.peerPings().length, '前置：ping1').toBe(1);
    await env.peerNode.scheduler.advanceBy(PONG_TIMEOUT_MS);
    await settle();
    expect(wire1.peerCloseLog(), '护栏：peer pong 超时 close(1001, pong-timeout)').toEqual([
      { code: 1001, reason: 'pong-timeout' },
    ]);
    expect(env.peer.getConnectionState(), '护栏：pong 超时 → backoff（临时失败）').toBe('backoff');
    // ── R3 红灯锚 1：超时->backoff 同步栈内必须退订旧 pong 监听（迟到/旧代 pong 从此惰性）
    expect(
      wire1.peerPongListeners(),
      'BUG R3：pong 超时同步退订 pong 监听（旧代 pong 不得再入网）——当前 backoff 窗口内仍订阅',
    ).toBe(0);
    // ── R3 红灯锚 2：超时->backoff 同步栈内必须退订旧 transport 的 message/close 监听
    expect(
      wire1.peerMessageListeners(),
      'BUG R3：pong 超时同步退订旧 transport message 监听',
    ).toBe(0);
    expect(
      wire1.peerCloseListeners(),
      'BUG R3：pong 超时同步退订旧 transport close 监听',
    ).toBe(0);
    // backoff 窗口 [40,90)：旧代 pong（属 ping1 的回声）此刻注入——已被退订则惰性
    wire1.injectPeerPong(wire1.peerPings()[0]);
    await env.peerNode.scheduler.advanceBy(PING_INTERVAL_MS); // t=70（重拨前）
    // ── R3 红灯锚 3：backoff 窗口内旧 liveness 不得对已关传输发 ping（真实 ws = timer 回调内未捕获异常）
    expect(
      wire1.peerPingsAfterClose(),
      'BUG R3：backoff 窗口内旧 liveness 零 ping（已关传输）——当前僵尸循环周期 ping 已关 socket',
    ).toBe(0);
    expect(
      wire1.closedTransportPingErrors(),
      'BUG R3：不得对已关传输 ping（ws 语义 `WebSocket is not open` 异常）',
    ).toHaveLength(0);
    // t=90：backoff 到期 → 重拨（后代 wire auto-pong，健康）
    await env.peerNode.scheduler.advanceBy(BACKOFF_DELAY_MS - PING_INTERVAL_MS);
    await settle();
    await settleUntil(() => env.peer.getConnectionState() === 'ready', '重拨后 ready');
    await settleUntil(() => env.peer.getNamespaceState(env.nsId) === 'live', '重连后 ns live');
    expect(env.dialCount(), '重拨恰一次').toBe(2);
    expect(env.hub.connections.length, '重连后 hub 只保留新连接').toBe(1);
    // 替换连接就绪后，旧代 pong 注入旧传输——必须惰性：新连接状态/序列/ns 零扰动
    const before = wire1.peerPings().length;
    wire1.injectPeerPong(wire1.peerPings()[0]);
    await settle();
    expect(env.peer.getConnectionState(), '旧代 pong 不得扰动新连接状态').toBe('ready');
    expect(env.peer.getNamespaceState(env.nsId), '旧代 pong 不得扰动新连接 ns').toBe('live');
    expect(wire1.peerPings().length, '旧代 pong 不得唤醒旧 liveness').toBe(before);
    // 收敛（验收 5/6）
    await env.writeHub(77);
    await settleUntil(() => env.rootValue('peer') === 77, '重连后数据收敛（peer n=77）');
    expect(env.rootValue('hub')).toBe(77);
  });
});

// ═══════════════════════════ P5：blocked 收口停活性（R4） ═══════════════════════════

describe('SA6 红灯 issue #170 P5（R4）：blocked 终态收口必须停 liveness + 退订 transport', () => {
  it('P5：hub 1002 关闭 → peer blocked；blocked 态零 ping 活动、零自发二次 close、监听全退订', async () => {
    const env = await bootIssue170({ facets: 'peer' });
    env.peer.start();
    await settleUntil(() => env.peer.getConnectionState() === 'ready', '握手 ready');
    const wire = env.wires[0]!;
    // hub 以 1002（协议错误分类）关闭 → peer 进入 blocked 终态（现行为——前置断言）
    wire.hubEnd.close(1002, 'protocol-error');
    await settle();
    expect(env.peer.getConnectionState(), '前置：1002 关闭 → blocked').toBe('blocked');
    // ── R4 锚 1：blocked 收口必须停 liveness；transport 监听保留到真实 close 通知，
    // 以兼容连接生命周期的 close 可观测性与在途 namespace 收口续体。
    expect(wire.peerPongListeners(), 'blocked 必须退订 pong 监听').toBe(0);
    expect(wire.peerMessageListeners(), 'blocked 在真实 close 前保留 message 监听').toBe(1);
    expect(wire.peerCloseListeners(), 'blocked 在真实 close 前保留 close 监听').toBe(1);
    // ── R4 红灯锚 2：blocked 态零 liveness 活动（不周期 ping 死对端/已关 socket）
    await env.peerNode.scheduler.advanceBy(PING_INTERVAL_MS); // t=30
    expect(
      wire.peerPings().length,
      'BUG R4：blocked 态不得再发 ping（旧 liveness 已停）——当前僵尸活性周期 ping 死对端',
    ).toBe(0);
    // ── R4 红灯锚 3：blocked 态不得自行 pong 超时二次收口（自身 close(1001) 噪音）
    await env.peerNode.scheduler.advanceBy(PONG_TIMEOUT_MS); // t=40
    await settle();
    expect(
      wire.peerCloseLog(),
      'BUG R4：blocked 态不得自行 pong 超时二次 close（FSM 已终态、无收口义务）',
    ).toHaveLength(0);
    // blocked 终态保持（不重拨——非本缺陷面，护栏）
    expect(env.peer.getConnectionState(), 'blocked 终态保持').toBe('blocked');
    expect(env.dialCount(), 'blocked 终态保持（不重拨）').toBe(1);
  });
});

/**
 * SA7 动态验证补充测试（issue #168）—— SA4 移交动态复核点 2b/3：
 * detachCloseTimedOutTransport 的重入语义与 close-throw 吸收面（fake-duplex 注入级）。
 *
 * SA4 §7 移交点（wiki/raw/task_ws-replication-…-sa4_review.md）：
 *   - 点 2（R3 同构实证补全）：内存 wire 的 close 不自通知 peer 侧 onClose，
 *     「close() 同步派发 onClose → 零重入副作用」的 epoch 闸纵深未被 SA6 契约驱动。
 *     本文件以「粘性 adapter」（退订后仍保留派发 + close() 同步派发 onClose——
 *     adapter 违约注入）在 hello 超时路径实证：同步重入被 epoch 闸滤除——
 *     backoff reason 仍为 hello-timeout（若闸失效则被改写为 socket-closed）、
 *     恰一次 backoff、零 connection-failed、close 调用时刻监听面已清空（退订先行）。
 *   - 点 3（close-throw 吸收分支）：内存 wire 的 close 不抛错，helper 的 catch
 *     分支零执行面。本文件以「close() 同步抛错 adapter」在 hello 与 pong 两个
 *     调用点实证：异常被吸收、onTemporaryFailure 必达（backoff 恰一次、零
 *     connection-failed）、恢复链完好（重拨 → ready → live）。
 *
 * 纪律（与 SA6 issue168 红灯契约同款）：真实 Registry/Runtime/yjs + fake scheduler
 * + 内存双端 wire；行为断言（观测面事件流/状态机/close 账本），零源码 grep、
 * 零 skip、零 real sleep、零 mock 被测对象。注入只发生在 transport adapter 层
 * （DuplexTransport 契约的违约模拟——被测的正是包对违约 adapter 的防御）。
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

// ═══════════════════════════ 探针 wire（同步重入 / close 抛错注入 + 观测账本） ═══════════════════════════

interface ProbeWireOptions {
  /** 扣下一帧指定 kind 的 peer→hub 帧（一次性——首代扣 HELLO 用：hello 超时驱动）。 */
  readonly dropNextPeerToHubKind?: string;
  /**
   * 粘性 adapter（违约注入）：退订（off 返回值调用）后监听器仍保留在派发表中，
   * 且 close() **同步**派发 onClose 给全部保留监听器（含已退订者）。
   * 被测防御 = 订阅闭包 epoch 门（peer-connection.ts dialNow 订阅处）——退订先行
   * 被 adapter 违约绕过后，epoch 闸必须独立滤除重入。
   */
  readonly stickyCloseReentry?: boolean;
  /** close() 同步抛错（违约注入）：helper catch 吸收面（backoff 仍必达）。 */
  readonly throwOnPeerClose?: boolean;
  /** peer 端装配 ping/onPong 面（liveness 武装前提——pong 超时驱动用）。 */
  readonly peerFacets?: boolean;
  /** ping 后微任务自动回 pong（健康代 wire 用）。 */
  readonly autoPong?: boolean;
}

interface ProbeWire {
  readonly peerEnd: DuplexTransport;
  readonly hubEnd: DuplexTransport;
  /** peer 侧 close 调用账本（成功完成的 close——code/reason 序列签名）。 */
  peerCloseLog(): ReadonlyArray<Readonly<{ code: number; reason: string }>>;
  /** peer 侧 close 调用尝试次数（含抛错的那次）。 */
  peerCloseAttempts(): number;
  /** peer 侧 close 抛出的异常账本（throwOnPeerClose 注入证据）。 */
  peerCloseThrown(): ReadonlyArray<Error>;
  /** close() 同步派发到达的保留监听器次数（stickyCloseReentry 注入证据——非空转锚）。 */
  syncReentryDeliveries(): number;
  /** close() 调用入口时刻的活跃 close/message 监听数（退订先行实证——应为 0/0）。 */
  closeListenerCountAtClose(): number | undefined;
  messageListenerCountAtClose(): number | undefined;
  /** peer 端 ping 载荷账本（pong 路径前置锚——证明 liveness 已武装且 ping 已发）。 */
  peerPings(): ReadonlyArray<Uint8Array | undefined>;
  /** hub 侧观测到的 close 信息（peer 侧 close 经微任务投递）。 */
  hubSideCloseInfo(): Readonly<{ code: number; reason: string }> | undefined;
  /** 注入迟到 in-flight HELLO_ACK（落旧 wire——epoch/退订双闸零扰动锚）。 */
  sendLateHelloAck(): void;
  peerSideClosed(): boolean;
}

function makeProbeWire(opts: ProbeWireOptions = {}): ProbeWire {
  const messageEntries = new Set<{ listener: (bytes: Uint8Array) => void; active: boolean }>();
  const closeEntries = new Set<{ listener: (info: Readonly<{ code: number; reason: string }>) => void; active: boolean }>();
  const hubListeners = new Set<(bytes: Uint8Array) => void>();
  const hubCloseListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const pongListeners = new Set<(payload?: Uint8Array) => void>();
  const hubToPeer: Uint8Array[] = [];
  const peerPingPayloads: Array<Uint8Array | undefined> = [];
  const peerCloseLog: Array<Readonly<{ code: number; reason: string }>> = [];
  const peerCloseThrown: Error[] = [];
  let peerCloseAttempts = 0;
  let syncReentryDeliveries = 0;
  let closeListenerCountAtClose: number | undefined;
  let messageListenerCountAtClose: number | undefined;
  let peerClosed = false;
  let hubSideClose: Readonly<{ code: number; reason: string }> | undefined;
  let dropArmed = opts.dropNextPeerToHubKind;

  const activeCount = (entries: Set<{ active: boolean }>): number => {
    let count = 0;
    for (const entry of entries) if (entry.active) count += 1;
    return count;
  };

  const peerEnd = {
    send(bytes: Uint8Array) {
      if (peerClosed) return;
      const copy = bytes.slice();
      if (dropArmed !== undefined && decodeMessage(copy).message.kind === dropArmed) {
        dropArmed = undefined; // 一次性扣帧（发送方已发、未投递）
        return;
      }
      queueMicrotask(() => {
        for (const listener of [...hubListeners]) listener(copy);
      });
    },
    close(code = 1000, reason = '') {
      peerCloseAttempts += 1;
      closeListenerCountAtClose = activeCount(closeEntries);
      messageListenerCountAtClose = activeCount(messageEntries);
      if (opts.throwOnPeerClose === true) {
        const error = new Error('adapter violation: close() threw synchronously (issue168 probe)');
        peerCloseThrown.push(error);
        throw error; // 违约 adapter：close 失败，socket 未关（closed 保持 false）
      }
      if (peerClosed) return;
      peerClosed = true;
      peerCloseLog.push({ code, reason });
      if (opts.stickyCloseReentry === true) {
        // 同步派发给全部保留监听器（含已退订者——adapter 违约：无视退订）
        for (const entry of [...closeEntries]) {
          syncReentryDeliveries += 1;
          entry.listener({ code, reason });
        }
      }
      queueMicrotask(() => {
        hubSideClose = { code, reason };
        for (const listener of [...hubCloseListeners]) listener({ code, reason });
      });
    },
    get closed() {
      return peerClosed;
    },
    onMessage(listener: (bytes: Uint8Array) => void) {
      const entry = { listener, active: true };
      messageEntries.add(entry);
      return () => {
        entry.active = false; // 粘性模式：账面退订、派发表保留
        if (opts.stickyCloseReentry !== true) messageEntries.delete(entry);
      };
    },
    onClose(listener: (info: Readonly<{ code: number; reason: string }>) => void) {
      const entry = { listener, active: true };
      closeEntries.add(entry);
      return () => {
        entry.active = false;
        if (opts.stickyCloseReentry !== true) closeEntries.delete(entry);
      };
    },
    ...(opts.peerFacets
      ? {
          ping(data?: Uint8Array) {
            peerPingPayloads.push(data);
            if (opts.autoPong === true) {
              const payload = data;
              queueMicrotask(() => {
                for (const listener of [...pongListeners]) listener(payload);
              });
            }
          },
          onPong(listener: (payload?: Uint8Array) => void) {
            pongListeners.add(listener);
            return () => pongListeners.delete(listener);
          },
        }
      : {}),
  } as DuplexTransport;

  const hubEnd: DuplexTransport = {
    send(bytes) {
      const copy = bytes.slice();
      hubToPeer.push(copy);
      queueMicrotask(() => {
        for (const entry of [...messageEntries]) {
          if (entry.active) entry.listener(copy);
        }
      });
    },
    close(code = 1001, reason = 'hub-close') {
      queueMicrotask(() => {
        for (const entry of [...closeEntries]) {
          if (entry.active) entry.listener({ code, reason });
        }
      });
    },
    get closed() {
      return false;
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
    peerCloseLog: () => peerCloseLog,
    peerCloseAttempts: () => peerCloseAttempts,
    peerCloseThrown: () => peerCloseThrown,
    syncReentryDeliveries: () => syncReentryDeliveries,
    closeListenerCountAtClose: () => closeListenerCountAtClose,
    messageListenerCountAtClose: () => messageListenerCountAtClose,
    peerPings: () => peerPingPayloads,
    hubSideCloseInfo: () => hubSideClose,
    sendLateHelloAck() {
      let max = 0;
      for (const bytes of hubToPeer) max = Math.max(max, decodeMessage(bytes).header.sequence);
      hubEnd.send(
        encodeMessage(
          {
            kind: 'HELLO_ACK',
            hubInstanceId: HUB_INSTANCE,
            protocolVersion: 1,
            selectedCapabilities: 0,
            connectionNonce: new Uint8Array(16),
            connectionId: 'late-ack-issue168-sa7',
          } as ReplicationMessage,
          { sequence: max + 1 },
        ),
      );
    },
    peerSideClosed: () => peerClosed,
  };
}

// ═══════════════════════════ 组装（真实 Registry/Runtime + fake scheduler） ═══════════════════════════

interface EnvSa7168 {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly wires: ProbeWire[];
  readonly nsId: string;
  readonly events: Collector;
  dialCount(): number;
}

interface BootSa7168Options {
  /** 首代 wire 的注入选项（探针面）；后代 wire 一律健康（facets + autoPong）。 */
  readonly firstWire: ProbeWireOptions;
  /** peer 时间面（hello/ping/pong 探针值）。 */
  readonly peerTimeouts: {
    readonly helloTimeoutMs: number;
    readonly pingIntervalMs?: number;
    readonly pongTimeoutMs?: number;
  };
}

async function bootSa7168(opts: BootSa7168Options): Promise<EnvSa7168> {
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
    timeouts: { helloTimeoutMs: 10_000 },
  });
  const events = new Collector();
  const wires: ProbeWire[] = [];
  let dialCount = 0;
  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      dialCount += 1;
      const wire = makeProbeWire(
        dialCount === 1 ? opts.firstWire : { peerFacets: true, autoPong: true },
      );
      wires.push(wire);
      void hub.accept(wire.hubEnd, { token: TEST_TOKEN });
      return wire.peerEnd;
    },
    timer: peerNode.scheduler,
    observer: events.observer,
    targets: [{ namespaceId: fixture.namespaceId, localOwner: PEER_OWNER }],
    timeouts: {
      helloTimeoutMs: opts.peerTimeouts.helloTimeoutMs,
      ...(opts.peerTimeouts.pingIntervalMs !== undefined
        ? { pingIntervalMs: opts.peerTimeouts.pingIntervalMs }
        : {}),
      ...(opts.peerTimeouts.pongTimeoutMs !== undefined
        ? { pongTimeoutMs: opts.peerTimeouts.pongTimeoutMs }
        : {}),
    },
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
    events,
    dialCount: () => dialCount,
  };
}

const HELLO_TIMEOUT_MS = 100;
const PING_INTERVAL_MS = 50;
const PONG_TIMEOUT_MS = 30;
const BACKOFF_DELAY_MS = 25; // 0.5 × baseMs(50)

// ═══════════════════════════ V1：hello 超时 + 粘性同步重入（R3 epoch 闸实证） ═══════════════════════════

describe('SA7 issue #168 动态验证：hello 超时 detach-close 的重入语义与 close-throw 吸收（注入级）', () => {
  it('V1：粘性 adapter 同步重入 onClose（含已退订监听）——epoch 闸滤除，backoff 仍恰一次且 reason=hello-timeout；退订先行；迟到 ACK 零扰动；恢复完好', async () => {
    const env = await bootSa7168({
      firstWire: { dropNextPeerToHubKind: 'HELLO', stickyCloseReentry: true },
      peerTimeouts: { helloTimeoutMs: HELLO_TIMEOUT_MS },
    });
    env.peer.start();
    await env.peerNode.scheduler.advanceBy(HELLO_TIMEOUT_MS);
    await settleUntil(() => env.peer.getConnectionState() === 'backoff', 'hello 超时 → backoff');
    const wire1 = env.wires[0]!;
    // ── close 序列签名：helper 对旧 transport 执行 close(1001, hello-timeout) ──
    expect(wire1.peerCloseLog(), 'close(1001, hello-timeout) 已执行').toEqual([
      { code: 1001, reason: 'hello-timeout' },
    ]);
    // ── 非空转锚：同步重入真的发生（粘性派发到达 ≥1 个已退订监听器）──
    expect(wire1.syncReentryDeliveries(), '同步重入注入非空转（close() 同步派发到达保留监听器）').toBeGreaterThanOrEqual(1);
    // ── 退订先行实证：close() 调用入口时刻，活跃 close/message 监听已清零 ──
    expect(wire1.closeListenerCountAtClose(), 'close 调用时刻 close 监听已退订（退订先行）').toBe(0);
    expect(wire1.messageListenerCountAtClose(), 'close 调用时刻 message 监听已退订（退订先行）').toBe(0);
    // ── epoch 闸实证：同步重入未劫持 backoff 分类（若闸失效 → reason 被改写为 socket-closed 且事件翻倍/错类）──
    const backoffs = env.events.of('connection-backoff-scheduled');
    expect(backoffs, '恰一次 backoff（同步重入零重入副作用）').toHaveLength(1);
    expect(backoffs[0], 'reason 保持 hello-timeout（未被重入改写为 socket-closed）').toMatchObject({
      type: 'connection-backoff-scheduled',
      side: 'peer',
      attempt: 1,
      reason: 'hello-timeout',
    });
    expect(env.events.of('connection-failed'), '临时失败分类——零 connection-failed').toHaveLength(0);
    expect(env.peer.getConnectionState(), 'backoff 稳定（无 blocked/二次迁移）').toBe('backoff');
    // ── hub 侧序列签名（close 事件经微任务投递）──
    await settle();
    expect(wire1.hubSideCloseInfo(), 'hub 侧可观测 {1001, hello-timeout}').toEqual({
      code: 1001,
      reason: 'hello-timeout',
    });
    // ── 迟到 in-flight HELLO_ACK 落旧 wire（epoch/退订双闸）：零扰动 ──
    wire1.sendLateHelloAck();
    await settle();
    expect(env.peer.getConnectionState(), '迟到 ACK 零扰动（仍 backoff）').toBe('backoff');
    expect(env.events.of('connection-backoff-scheduled'), '迟到 ACK 不产生第二次 backoff').toHaveLength(1);
    // ── 恢复链：backoff(25ms) → wire2（健康代）→ ready → live ──
    await env.peerNode.scheduler.advanceBy(BACKOFF_DELAY_MS);
    await settleUntil(() => env.peer.getConnectionState() === 'ready', '重拨 ready');
    await settleUntil(() => env.peer.getNamespaceState(env.nsId) === 'live', '重连 live');
    expect(env.dialCount(), '恰两代拨号').toBe(2);
    expect(env.wires[1]!.peerSideClosed(), '新代传输不受旧代收口影响').toBe(false);
    await env.peer.stop();
    await settleUntil(() => env.peer.getConnectionState() === 'stopped', 'stopped');
  });

  it('V2：adapter close() 同步抛错（hello 路径）——响亮进入 blocked，不把未关闭 transport 当作可恢复断线', async () => {
    const env = await bootSa7168({
      firstWire: { dropNextPeerToHubKind: 'HELLO', throwOnPeerClose: true },
      peerTimeouts: { helloTimeoutMs: HELLO_TIMEOUT_MS },
    });
    env.peer.start();
    await env.peerNode.scheduler.advanceBy(HELLO_TIMEOUT_MS);
    await settleUntil(() => env.peer.getConnectionState() === 'blocked', 'close 抛错 → blocked');
    const wire1 = env.wires[0]!;
    expect(wire1.peerCloseAttempts(), 'close 尝试恰一次').toBe(1);
    expect(wire1.peerCloseThrown(), 'close 同步抛错已发生（失败面非空转）').toHaveLength(1);
    expect(wire1.peerCloseLog(), '违约 adapter 下 close 未完成（socket 层未关）').toHaveLength(0);
    expect(env.events.of('connection-backoff-scheduled'), '未关闭 transport 不进入 backoff').toHaveLength(0);
    expect(env.events.of('connection-failed'), 'adapter 违约按连接失败响亮投影').toHaveLength(1);
    await env.peerNode.scheduler.advanceBy(BACKOFF_DELAY_MS);
    expect(env.dialCount(), 'blocked 不自动重拨，避免孤儿 transport 与新代并存').toBe(1);
  });

  it('V3：adapter close() 同步抛错（pong 路径）——响亮进入 blocked，不自动重拨制造孤儿连接', async () => {
    const env = await bootSa7168({
      firstWire: { peerFacets: true, autoPong: false, throwOnPeerClose: true },
      peerTimeouts: {
        helloTimeoutMs: 10_000,
        pingIntervalMs: PING_INTERVAL_MS,
        pongTimeoutMs: PONG_TIMEOUT_MS,
      },
    });
    env.peer.start();
    // 首代握手正常（HELLO 放行）→ ready → liveness 武装（peer ping 面）
    await settleUntil(() => env.peer.getConnectionState() === 'ready', '首连 ready');
    const wire1 = env.wires[0]!;
    await env.peerNode.scheduler.advanceBy(PING_INTERVAL_MS);
    expect(wire1.peerPings().length, '前置：liveness 已武装且 ping 已发（pong 超时驱动非空转）').toBe(1);
    // pong 超时 → detachCloseTimedOutTransport(pong-timeout) → close 抛错 → loud blocked
    await env.peerNode.scheduler.advanceBy(PONG_TIMEOUT_MS);
    await settleUntil(() => env.peer.getConnectionState() === 'blocked', 'pong 超时 + close 抛错 → blocked');
    expect(wire1.peerCloseAttempts(), 'close 尝试恰一次').toBe(1);
    expect(wire1.peerCloseThrown(), 'close 同步抛错已发生（失败面非空转）').toHaveLength(1);
    expect(env.events.of('connection-backoff-scheduled'), '未关闭 transport 不进入 backoff').toHaveLength(0);
    expect(env.events.of('connection-failed'), 'adapter 违约按连接失败响亮投影').toHaveLength(1);
    await env.peerNode.scheduler.advanceBy(BACKOFF_DELAY_MS);
    expect(env.dialCount(), 'blocked 不自动重拨').toBe(1);
  });
});

/**
 * SA7 动态验证补充测试（issue #168 SA4 移交点 2a）—— 生产 ws adapter 真实链路上的
 * hello 超时同步关闭 peer transport（R3 重入语义的真机实证）。
 *
 * 背景（SA4 §7 移交点 2）：pong 路径有 real-transport 测试先例（node:net TCP），
 * hello 路径在 SA6 契约里仅经 fake-duplex 内存 wire 驱动——且该 wire 的 peer 侧
 * close() 从不把 close 事件通知回 peer 自己（内存双端语义），「close() 触发的
 * onClose 重入被退订/epoch 双闸滤除」缺真机证据。本文件在**生产 adapter 链路**
 * （apps/yjs-server `wrapWs`（ws 库）hub/peer 双侧 + `startHubWsServer` upgrade +
 * 真实 Registry/Runtime/yjs + 真实 timer）上验证：
 *
 *   RT-1  hello 超时（hub 侧扣 HELLO_ACK——gate 只拦 hub→peer 首代出站）→ peer 经
 *         established detach-close 序列 close(1001, 'hello-timeout')——**close code/
 *         reason 经真实 WS close 握手帧穿越内核 TCP**，hub 侧 'close' 事件观测到
 *         恰 { code: 1001, reason: 'hello-timeout' }（序列签名真机面）。
 *   RT-2  退订先行实证：close() 调用入口时刻，peer 侧 gate 的活跃 onClose/onMessage
 *         监听数已清零（detach-close 序列先退订后 close）。
 *   RT-3  真实异步重入零副作用：ws 客户端 close 握手完成后本地 'close' 事件到达
 *         gate（真机 re-entry），此刻活跃监听为 0——PeerConnection 零重入：恰一次
 *         connection-backoff-scheduled{hello-timeout, attempt:1}、零 connection-failed、
 *         无 socket-closed 二次 backoff、无 blocked。
 *   RT-4  恢复链完好：backoff（40ms）→ 重拨（gate 放行）→ ready → live；
 *         hub 经真实 close 事件收口旧连接（hub.connections → 1）；稳定窗内零复发。
 *
 * 纪律（与 ws-replication real-transport 套件同类——真实链路集成抽样）：node loopback
 * 真实 WS + 真实 timer + 有界 real wait；注入仅发生在 transport gate 层（首代 hub→peer
 * 出站扣帧——等价「hub 无响应」，被测的包侧行为）；fixture 在测试自身以归属包**公共
 * 导出**就地搭建最小真实基建（真实 Registry/Runtime + MemoryPersistence + systemClock）
 * ——零包内 subpath、零测试 seam（apps/yjs-server AGENTS.md Boundaries）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { systemClock } from '@nomicore/clock';
import { MemoryPersistence, type PersistenceScheduler } from '@nomicore/persistence';
import {
  createNamespaceRegistry,
  type InstanceRole,
  type NamespaceLease,
  type NamespaceOwner,
  type NamespaceRegistry,
  type RegistryRandomBytes,
  type RegistryTimeoutScheduler,
} from '@nomicore/namespace-registry';
import { startHubWsServer, wrapWs } from '../src/transport/ws-server.js';
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type {
  DuplexTransport,
  HubReplication,
  NamespaceAuthorizer,
  PeerReplication,
  PeerTokenVerifier,
  ReplicationObserver,
  ReplicationObserverEvent,
  ReplicationTimer,
} from '@nomicore/ws-replication';

// ═══════════════════════════ 工具（真实链路抽样专用） ═══════════════════════════

/** 有界 real wait 轮询。 */
async function waitUntil(what: string, predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) throw new Error(`waitUntil 超时（${timeoutMs}ms）：${what}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

/** 有界 real sleep（稳定窗采样）。 */
function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** 真实 timer（协议时间面走真实时钟——本文件为真实链路抽样）。 */
const realTimer: ReplicationTimer = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs) as unknown,
  clearTimeout: (handle) => clearTimeout(handle as unknown as number),
};

// ═══════════════════════════ 应用内最小 fixture（仅包公共导出；零包内 subpath / 测试 seam） ═══════════════════════════
//
// apps/yjs-server AGENTS.md Boundaries：只消费 @nomicore/* 包公共导出。hub/peer 实例
// 基建以生产公共工厂就地搭建（createNamespaceRegistry + MemoryPersistence + systemClock
// + 真实 timer 调度器 + node:crypto 随机源）；以下协议常量/授权器/认证器为测试自身最小
// 声明——与各归属包测试基建同构的纯本地值，不 import 任何包内测试文件。

const HUB_INSTANCE = 'hub-omega';
const PEER_INSTANCE = 'peer-alpha';
const HUB_OWNER: NamespaceOwner = Object.freeze({ userId: 'hub-owner-9f38' });
const PEER_OWNER: NamespaceOwner = Object.freeze({ userId: 'peer-owner-7e21' });
const TEST_TOKEN = 'tok-test-4f2b8a1c9d3e';

/** 最小 schema 包（vfsl 单一 ROOT 对象面——与本仓库复制 schema 惯例同构）。 */
const SCHEMA_ENVELOPE = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'phase5-ws-namespace-sync',
  text: 'type ROOT = { n: number; ext?: number; extra?: number; };\n',
});

/** 真实 timer 调度器（Registry/Persistence 公共调度注入面——本文件为真实链路抽样）。 */
const realScheduler: RegistryTimeoutScheduler & PersistenceScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs) as unknown,
  clearTimeout: (handle) => clearTimeout(handle as unknown as number),
};

/** 随机源（RegistryRandomBytes 公共合约；node:crypto 真随机——随机性只影响不可观测的
 *  namespaceId/复制身份，测试断言零依赖其取值）。 */
const cryptoRandomBytes: RegistryRandomBytes = (length) => new Uint8Array(randomBytes(length));

/** 授权器：全授予，本地 owner = hub entry owner（HUB_OWNER）。 */
const authorize: NamespaceAuthorizer = async () => ({
  ok: true,
  localOwner: HUB_OWNER,
  permissions: { read: true, submit: true },
});

/** Upgrade 认证器：TEST_TOKEN → PEER_INSTANCE；其余拒绝。 */
const verifyToken: PeerTokenVerifier = (token) =>
  Promise.resolve(token === TEST_TOKEN ? { ok: true, instanceId: PEER_INSTANCE } : { ok: false });

interface FixtureNode {
  readonly role: InstanceRole;
  readonly persistence: MemoryPersistence;
  readonly registry: NamespaceRegistry;
}

/** 真实实例节点：生产 Registry/Runtime + MemoryPersistence（真实 clock/wall 调度器/随机源）。 */
function makeFixtureNode(role: InstanceRole): FixtureNode {
  const persistence = new MemoryPersistence({ scheduler: realScheduler });
  const registry = createNamespaceRegistry(persistence, {
    clock: systemClock,
    scheduler: realScheduler,
    randomBytes: cryptoRandomBytes,
    idleTimeoutMs: 1_000_000, // idle 远大于测试预算（真实链路抽样不触发 registry idle）
    role,
  });
  return { role, persistence, registry };
}

function leaseSchemaState(lease: NamespaceLease): string {
  const status = lease.getStatus();
  if (status.lease !== 'active') return 'released';
  return status.runtime.schema.state;
}

/** hub 侧：真实 create + schema 就绪 + enableReplication（复制身份安装）。 */
async function makeHubNamespaceFixture(
  node: FixtureNode,
  owner: NamespaceOwner,
): Promise<Readonly<{ namespaceId: string }>> {
  const result = await node.registry.create({ owner, schema: SCHEMA_ENVELOPE, root: { n: 42 } });
  if (!result.ok) throw new Error(`hub namespace create 失败：${JSON.stringify(result)}`);
  const lease = result.lease;
  await waitUntil('hub namespace schema ready', () => leaseSchemaState(lease) === 'ready', 10_000);
  const enabled = await lease.enableReplication();
  if (!enabled.ok) throw new Error(`enableReplication 失败：${JSON.stringify(enabled)}`);
  return { namespaceId: lease.namespaceId };
}

class Collector {
  readonly events: ReplicationObserverEvent[] = [];
  readonly observer: ReplicationObserver = (event) => {
    this.events.push(event);
  };
  of(type: ReplicationObserverEvent['type']): ReplicationObserverEvent[] {
    return this.events.filter((e) => e.type === type);
  }
}

interface ListenerEntry<T> {
  readonly listener: T;
  active: boolean;
}

function activeCount(entries: ReadonlySet<{ active: boolean }>): number {
  let count = 0;
  for (const entry of entries) if (entry.active) count += 1;
  return count;
}

/**
 * peer 侧观测 gate（纯透传 + 账本）：
 * - close() 调用入口时刻记录活跃 onClose/onMessage 监听数（RT-2 退订先行实证）；
 * - 真实 ws 'close' 事件到达（本地重入）计数 + 该时刻活跃监听数（RT-3 重入滤除实证）。
 */
class PeerGate implements DuplexTransport {
  private readonly messageEntries = new Set<ListenerEntry<(bytes: Uint8Array) => void>>();
  private readonly closeEntries = new Set<ListenerEntry<(info: Readonly<{ code: number; reason: string }>) => void>>();
  /** close() 调用账本：code/reason + 调用入口时刻的活跃监听数（RT-2 退订先行实证）。 */
  readonly closeCalls: Array<Readonly<{ code: number; reason: string; closeListeners: number; messageListeners: number }>> = [];
  innerCloseDeliveries = 0;
  readonly listenersAtInnerCloseDelivery: number[] = [];
  private readonly offInnerMessage: () => void;
  private readonly offInnerClose: () => void;

  constructor(readonly inner: DuplexTransport) {
    this.offInnerMessage = inner.onMessage((bytes) => {
      for (const entry of [...this.messageEntries]) if (entry.active) entry.listener(bytes);
    });
    this.offInnerClose = inner.onClose((info) => {
      this.innerCloseDeliveries += 1;
      this.listenersAtInnerCloseDelivery.push(activeCount(this.closeEntries));
      for (const entry of [...this.closeEntries]) if (entry.active) entry.listener(info);
    });
  }

  send(bytes: Uint8Array): void {
    this.inner.send(bytes);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({
      code: code ?? 1000,
      reason: reason ?? '',
      closeListeners: activeCount(this.closeEntries),
      messageListeners: activeCount(this.messageEntries),
    });
    this.inner.close(code, reason);
  }

  get closed(): boolean {
    return this.inner.closed;
  }

  onMessage(listener: (bytes: Uint8Array) => void): () => void {
    const entry = { listener, active: true };
    this.messageEntries.add(entry);
    return () => {
      entry.active = false;
      this.messageEntries.delete(entry);
    };
  }

  onClose(listener: (info: Readonly<{ code: number; reason: string }>) => void): () => void {
    const entry = { listener, active: true };
    this.closeEntries.add(entry);
    return () => {
      entry.active = false;
      this.closeEntries.delete(entry);
    };
  }

  get bufferedAmount(): number {
    return this.inner.bufferedAmount ?? 0;
  }

  /** 箭头字段：liveness 以解绑引用持有 ping/onPong（this 必须词法捕获——与生产 wrapWs 闭包同构）。 */
  readonly ping = (data?: Uint8Array): void => {
    this.inner.ping?.(data);
  };

  readonly onPong = (listener: (payload?: Uint8Array) => void): (() => void) => {
    return this.inner.onPong?.(listener) ?? (() => {});
  };

  dispose(): void {
    this.offInnerMessage();
    this.offInnerClose();
  }
}

/**
 * hub 侧 gate：首代（gateOpen=false）扣全部 hub→peer 出站帧（含 HELLO_ACK——
 * 「hub 无响应」注入，hello 超时驱动）；观测 hub 侧真实 close 事件签名（RT-1）。
 */
class HubGate implements DuplexTransport {
  private readonly messageEntries = new Set<ListenerEntry<(bytes: Uint8Array) => void>>();
  private readonly closeEntries = new Set<ListenerEntry<(info: Readonly<{ code: number; reason: string }>) => void>>();
  gateOpen = false;
  swallowedByteCount = 0;
  swallowedFrameCount = 0;
  hubCloseInfo: Readonly<{ code: number; reason: string }> | undefined;
  private readonly offInnerMessage: () => void;
  private readonly offInnerClose: () => void;

  constructor(readonly inner: DuplexTransport) {
    this.offInnerMessage = inner.onMessage((bytes) => {
      for (const entry of [...this.messageEntries]) if (entry.active) entry.listener(bytes);
    });
    this.offInnerClose = inner.onClose((info) => {
      if (this.hubCloseInfo === undefined) this.hubCloseInfo = info;
      for (const entry of [...this.closeEntries]) if (entry.active) entry.listener(info);
    });
  }

  send(bytes: Uint8Array): void {
    if (!this.gateOpen) {
      this.swallowedFrameCount += 1;
      this.swallowedByteCount += bytes.byteLength;
      return; // 首代「hub 无响应」注入：帧不上 socket（peer 零感知）
    }
    this.inner.send(bytes);
  }

  close(code?: number, reason?: string): void {
    this.inner.close(code, reason);
  }

  get closed(): boolean {
    return this.inner.closed;
  }

  onMessage(listener: (bytes: Uint8Array) => void): () => void {
    const entry = { listener, active: true };
    this.messageEntries.add(entry);
    return () => {
      entry.active = false;
      this.messageEntries.delete(entry);
    };
  }

  onClose(listener: (info: Readonly<{ code: number; reason: string }>) => void): () => void {
    const entry = { listener, active: true };
    this.closeEntries.add(entry);
    return () => {
      entry.active = false;
      this.closeEntries.delete(entry);
    };
  }

  get bufferedAmount(): number {
    return this.inner.bufferedAmount ?? 0;
  }

  /** 箭头字段：liveness 以解绑引用持有 ping/onPong（this 必须词法捕获——与生产 wrapWs 闭包同构）。 */
  readonly ping = (data?: Uint8Array): void => {
    if (this.gateOpen) this.inner.ping?.(data);
  };

  readonly onPong = (listener: (payload?: Uint8Array) => void): (() => void) => {
    if (!this.gateOpen) return () => undefined;
    return this.inner.onPong?.(listener) ?? (() => {});
  };

  dispose(): void {
    this.offInnerMessage();
    this.offInnerClose();
  }
}

// ═══════════════════════════ 组装与清理 ═══════════════════════════

const HELLO_TIMEOUT_MS = 500; // 探针值：> loopback 建连+握手往返；驱动首代 hello 超时
const BACKOFF_DELAY_MS = 40; // 0.5 × baseMs(80)

interface RealWsRun {
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly events: Collector;
  readonly peerGates: PeerGate[];
  readonly hubGates: HubGate[];
  readonly nsId: string;
  dialCount(): number;
}

interface PendingClose {
  closeServer(): Promise<void>;
  terminateSockets(): void;
  disposeGates(run: RealWsRun): void;
}

const openSockets: WebSocket[] = [];
const pendingCloses: PendingClose[] = [];

afterEach(async () => {
  for (const socket of openSockets.splice(0)) {
    try {
      socket.terminate();
    } catch {
      /* 已关 */
    }
  }
  for (const pending of pendingCloses.splice(0)) {
    pending.terminateSockets();
    await pending.closeServer().catch(() => undefined);
  }
});

async function bootRealWs(): Promise<RealWsRun & PendingClose> {
  const hubNode = makeFixtureNode('hub');
  const peerNode = makeFixtureNode('peer');
  const fixture = await makeHubNamespaceFixture(hubNode, HUB_OWNER);
  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: hubNode.registry,
    authorize,
    timer: realTimer,
    verifyToken,
    timeouts: { helloTimeoutMs: 10_000 },
  });

  const hubGates: HubGate[] = [];
  const wsServer = await startHubWsServer({
    host: '127.0.0.1',
    port: 0,
    path: '/replication',
    accept: (transport, token) => {
      const gate = new HubGate(transport);
      hubGates.push(gate);
      if (hubGates.length > 1) gate.gateOpen = true; // 首代扣 ACK（hello 超时）；后代放行
      void hub.accept(gate, token !== undefined ? { token } : undefined);
    },
  });

  const events = new Collector();
  const peerGates: PeerGate[] = [];
  let dialCount = 0;
  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      dialCount += 1;
      const socket = new WebSocket(`ws://127.0.0.1:${wsServer.port}/replication`, {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      openSockets.push(socket);
      const gate = new PeerGate(wrapWs(socket));
      peerGates.push(gate);
      return gate;
    },
    timer: realTimer,
    observer: events.observer,
    targets: [{ namespaceId: fixture.namespaceId, localOwner: PEER_OWNER }],
    timeouts: { helloTimeoutMs: HELLO_TIMEOUT_MS, pingIntervalMs: 60_000, pongTimeoutMs: 10_000 },
    backoff: { baseMs: 80, maxMs: 400, resetAfterMs: 60_000 },
    random: () => 0.5,
  });

  const run: RealWsRun & PendingClose = {
    hub,
    peer,
    events,
    peerGates,
    hubGates,
    nsId: fixture.namespaceId,
    dialCount: () => dialCount,
    closeServer: () => wsServer.close(),
    terminateSockets: () => {
      for (const socket of openSockets.splice(0)) {
        try {
          socket.terminate();
        } catch {
          /* 已关 */
        }
      }
    },
    disposeGates: (r: RealWsRun) => {
      for (const gate of r.peerGates) gate.dispose();
      for (const gate of r.hubGates) gate.dispose();
    },
  };
  pendingCloses.push(run);
  return run;
}

// ═══════════════════════════ RT-1..RT-4：生产 ws adapter 真实链路 ═══════════════════════════

describe('SA7 issue #168 动态验证（生产 ws adapter）：hello 超时同步 close(1001, hello-timeout) 穿越真实 WS 握手；重入零副作用；恢复完好', () => {
  it('RT：hello 超时 → close(1001, hello-timeout) 经真实 close 握手到达 hub；退订先行；真实异步 close 重入零副作用；恰一次 backoff；重拨 ready/live；hub 收口至 1', { timeout: 60_000 }, async () => {
    const run = await bootRealWs();
    run.peer.start();
    // ── 首代：hello 超时（hub 侧扣 ACK）→ detach-close → backoff ──
    await waitUntil('hello 超时 → backoff', () => run.peer.getConnectionState() === 'backoff', 10_000);
    expect(run.dialCount(), '超时前无早熟重拨（首代仍是第一代）').toBe(1);
    const peerGate1 = run.peerGates[0]!;
    const hubGate1 = run.hubGates[0]!;
    // RT-1（前半）：peer 经生产 adapter 执行 close(1001, 'hello-timeout')
    expect(peerGate1.closeCalls, 'close 调用恰一次且序列签名 1001/hello-timeout').toEqual([
      { code: 1001, reason: 'hello-timeout', closeListeners: 0, messageListeners: 0 },
    ]);
    // RT-2：退订先行——close() 入口时刻活跃监听已清零（上式 closeListeners/messageListeners 字段）
    // RT-1（后半）：close code/reason 穿越真实 WS close 握手帧，hub 侧 'close' 事件观测同值
    await waitUntil('hub 侧收到真实 close 事件', () => hubGate1.hubCloseInfo !== undefined, 5_000);
    expect(hubGate1.hubCloseInfo, '序列签名经真实链路到达 hub').toEqual({ code: 1001, reason: 'hello-timeout' });
    // 注入非空转锚：hub 确有被扣的出站帧（HELLO_ACK 在途被拦——超时由 ACK 缺席驱动，非连接失败）
    expect(hubGate1.swallowedFrameCount, '首代 hub→peer 出站帧被扣（hello 超时驱动面非空转）').toBeGreaterThanOrEqual(1);
    // RT-3：真实异步重入零副作用——ws 客户端 close 握手完成后本地 'close' 事件到达 gate，
    //   此刻活跃监听为 0（退订已先行）→ PeerConnection 零重入
    await waitUntil('peer 侧真实 close 事件到达（本地重入发生）', () => peerGate1.innerCloseDeliveries >= 1, 5_000);
    expect(
      peerGate1.listenersAtInnerCloseDelivery[0],
      '真实 close 事件到达时刻活跃监听为 0（重入被退订滤除）',
    ).toBe(0);
    const backoffs = run.events.of('connection-backoff-scheduled');
    expect(backoffs, '恰一次 backoff（真实重入零副作用——无 socket-closed 二次分类）').toHaveLength(1);
    expect(backoffs[0], 'reason=hello-timeout, attempt=1（真实链路观测面）').toMatchObject({
      type: 'connection-backoff-scheduled',
      side: 'peer',
      attempt: 1,
      reason: 'hello-timeout',
    });
    expect(run.events.of('connection-failed'), '临时失败分类——零 connection-failed').toHaveLength(0);
    // ── RT-4：恢复链——backoff(40ms) → 重拨（gate 放行）→ ready → live ──
    await waitUntil('重拨 ready', () => run.peer.getConnectionState() === 'ready', 10_000);
    await waitUntil('重连 live（bootstrap 经真实链路收敛）', () => run.peer.getNamespaceState(run.nsId) === 'live', 10_000);
    expect(run.dialCount(), '恰两代拨号').toBe(2);
    // hub 经真实 close 事件收口旧连接（异步清理链——轮询等待）
    await waitUntil('hub 收口旧连接（仅剩新连接）', () => run.hub.connections.length === 1, 10_000);
    // 稳定窗：无复发（迟到 close/清理链零扰动新代）
    await sleep(400);
    expect(run.peer.getConnectionState(), '稳定窗内 ready 保持').toBe('ready');
    expect(run.events.of('connection-backoff-scheduled'), '稳定窗内零新增 backoff').toHaveLength(1);
    expect(run.events.of('connection-failed').length, '稳定窗内零 connection-failed').toBe(0);
    expect(peerGate1.inner.closed, '旧代传输关闭态保持').toBe(true);
    // ── 收尾 ──
    await run.peer.stop();
    await waitUntil('peer stopped', () => run.peer.getConnectionState() === 'stopped', 10_000);
    await run.hub.close().catch(() => undefined);
    run.disposeGates(run);
    await run.closeServer();
  });
});

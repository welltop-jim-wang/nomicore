/**
 * SA7 动态验证（issue #171）—— 真实 TCP 链路（真机面）。
 *
 * 覆盖 SA4 R2 §4 动态审核重点 1/3/4 + SA2 R2-N2①（同文件内 SA7 决策表）：
 *   RT-F1  GOAWAY(SERVER_RESTARTING) drain 窗口内 removeTarget 的真机回归——
 *         与 SA4 静态锚（fake-duplex + 受控 scheduler）互补：本文件在真实 TCP +
 *         真实 timer 下验证 deadline 的 transport close(1001) 触发**本地** onClose
 *         （socket.end() → 本地 'close' 事件——真实 WS 语义；fake-duplex 的本地
 *         close 不自通知）后资源收口仍恰一次：peer registry observer `lease-released`
 *         事件恰一次（remainingLeases 归零）、watchdog idle 自重武装链停止
 *         （计数 timer 佐证——采样窗口零新增武装）、session/lease 字段清空。
 *   RT-G5  GOAWAY 收帧同步静默 + disconnected 提前投影的**可观测时序**（SA2 R2-N2①）：
 *         真实 wire 注入 GOAWAY 后、deadline 之前：ns 投影 disconnected（连接 ready
 *         不变）、订阅已摘、drain 窗口内 peer 业务写零 UPDATE 出站；deadline 到期
 *         才关 transport（1001/goaway-drain）；deadline 全量层处置（不经 removeTarget
 *         的对照路径）lease 恰一次释放。
 *   RT-C4  C4（removeTarget 路径）错配 CLOSE_OK 的真 wire 形态：ACK_STATE_VIOLATION
 *         ERROR 帧经真实 socket 到达对端、close code 1002（protocol-error）、连接
 *         blocked 投影、removeTarget 承诺有限结算。
 *   RT-C4b C4b（hub 发起 CLOSE 窗口，closeSequence 未定义）同款显式收口：真 wire
 *         注入 CLOSE_NAMESPACE（在途 apply 经 saveGate 悬挂 → closing 窗口稳定）+
 *         错配 CLOSE_OK → ACK_STATE_VIOLATION ERROR 帧 + blocked + 1002；放行
 *         saveGate 后本代 CLOSE 续体仍正常收口 closed（零静默完成、零悬挂）。
 *
 * 纪律（与 ws-replication-sa7-r2-transport.test.ts 同类——真实链路集成抽样）：
 * node:net 真实 TCP loopback；4 字节长度前缀成帧（transport 适配器职责）；真实
 * timer + 有界 real wait；注入帧走 hub 侧 transport.send（经真实 socket + 对端重组，
 * 序列遵循「接收端已见最大 +1」记账——注入点均处于发送方静默窗口）；不 mock 被测
 * 对象（registry/Runtime/Y.Doc 全真实；Persistence 仅 stub 承担门闩载体——与
 * fake-duplex 套件同款）。对象图只读投影沿用 issue171-red 既有模式。
 */
import * as net from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createHubReplication,
  createPeerReplication,
} from '@nomicore/ws-replication';
import type {
  DuplexTransport,
  HubReplication,
  PeerReplication,
  ReplicationTimer,
} from '@nomicore/ws-replication';
import {
  decodeMessage,
  encodeMessage,
  type DecodedMessage,
} from '@nomicore/replication-protocol';
import { createNamespaceRegistryForTesting } from '@nomicore/namespace-registry/testing';
import {
  FIXED_MS,
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  PEER_OWNER,
  deferred,
  makeCounterRandomBytes,
  makeHubNamespace,
  makeNode,
  okLease,
  schemaReady,
  StubPersistence,
  type ReplicaNode,
} from './harness.js';
import type { ReplicationMessage } from '@nomicore/replication-protocol';

// ═══════════════════════════ 通用工具（真实链路抽样专用） ═══════════════════════════

/** 有界 real wait 轮询。 */
async function waitUntil(what: string, predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) throw new Error(`waitUntil 超时（${timeoutMs}ms）：${what}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

/** 有界 real sleep。 */
function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

interface PairCloseMeta {
  hub: { code: number; reason: string } | undefined;
  peer: { code: number; reason: string } | undefined;
}

/**
 * 真实 TCP transport 适配器（4B 长度前缀成帧）+ SA7 观测面：
 * - sent/dropped/received 三向帧账本（drop 判定前记录 dropped、到达本端记录 received）；
 * - dropNext 选择性丢帧 seam（C4 扣真实 CLOSE_OK 用——帧已由发送方编码但不上 socket）；
 * - 本地 close(code,reason) 记入共享 meta；socket 'close' 事件通知**本端** onClose
 *   （socket.end() 后本地同样收到 close 事件——真实 WS 语义，RT-F1 的核心面）。
 */
class RealWireTransport implements DuplexTransport {
  readonly socket: net.Socket;
  private readonly messageListeners: Array<(bytes: Uint8Array) => void> = [];
  private readonly closeListeners: Array<(info: Readonly<{ code: number; reason: string }>) => void> = [];
  private readonly meta: PairCloseMeta;
  private readonly side: 'hub' | 'peer';
  private buffer: Buffer = Buffer.alloc(0);
  private readonly pendingFrames: Uint8Array[] = [];
  private closedFlag = false;
  private dropPred: ((bytes: Uint8Array) => boolean) | undefined;
  readonly sent: DecodedMessage[] = [];
  readonly dropped: DecodedMessage[] = [];
  readonly received: DecodedMessage[] = [];

  constructor(socket: net.Socket, side: 'hub' | 'peer', meta: PairCloseMeta) {
    this.socket = socket;
    this.side = side;
    this.meta = meta;
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    socket.on('close', () => {
      this.closedFlag = true;
      const info = this.side === 'hub' ? this.meta.peer : this.meta.hub;
      for (const listener of [...this.closeListeners]) listener(info ?? { code: 1006, reason: 'abnormal' });
    });
    socket.on('error', () => {
      /* close 事件随错误到达；仅防 unhandled error 事件 */
    });
  }

  get closed(): boolean {
    return this.closedFlag || this.socket.destroyed;
  }

  send(bytes: Uint8Array): void {
    if (this.closedFlag) return;
    let frame: DecodedMessage;
    try {
      frame = decodeMessage(bytes);
    } catch {
      this.socket.destroy();
      return;
    }
    if (this.dropPred !== undefined && this.dropPred(bytes)) {
      this.dropPred = undefined;
      this.dropped.push(frame);
      return;
    }
    this.sent.push(frame);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(bytes.byteLength, 0);
    this.socket.write(Buffer.concat([header, Buffer.from(bytes)]));
  }

  /** 下一帧命中断言即丢弃（仅一次；帧不上 socket——接收端零感知）。 */
  dropNext(pred: (bytes: Uint8Array) => boolean): void {
    this.dropPred = pred;
  }

  close(code?: number, reason?: string): void {
    if (this.closedFlag) return;
    this.meta[this.side] = { code: code ?? 1005, reason: reason ?? '' };
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 2_000).unref?.();
  }

  onMessage(listener: (bytes: Uint8Array) => void): () => void {
    this.messageListeners.push(listener);
    // 注册后重放积压帧（TCP 数据可能先于协议侧注册到达）——保「一 send 一 message」。
    if (this.pendingFrames.length > 0) {
      const replay = this.pendingFrames.splice(0);
      for (const bytes of replay) listener(bytes);
    }
    return () => {
      const index = this.messageListeners.indexOf(listener);
      if (index >= 0) this.messageListeners.splice(index, 1);
    };
  }

  onClose(listener: (info: Readonly<{ code: number; reason: string }>) => void): () => void {
    this.closeListeners.push(listener);
    return () => {
      const index = this.closeListeners.indexOf(listener);
      if (index >= 0) this.closeListeners.splice(index, 1);
    };
  }

  /** 本端注入帧（经真实 socket 出站；序列由调用方按接收端记账指定）。 */
  inject(bytes: Uint8Array): void {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(bytes.byteLength, 0);
    this.socket.write(Buffer.concat([header, Buffer.from(bytes)]));
    this.sent.push(decodeMessage(bytes));
  }

  /** 接收端已见最大帧序 +1（注入帧的期望序列）。 */
  nextSequenceForReceiver(): number {
    let max = 0;
    for (const f of this.received) max = Math.max(max, f.header.sequence);
    return max + 1;
  }

  private receive(chunk: Buffer): void {
    if (this.closedFlag) return;
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.byteLength < 4) return;
      const length = this.buffer.readUInt32BE(0);
      if (this.buffer.byteLength < 4 + length) return;
      const payload = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      const copy = new Uint8Array(payload.byteLength);
      copy.set(payload);
      let frame: DecodedMessage;
      try {
        frame = decodeMessage(copy);
      } catch {
        continue;
      }
      this.received.push(frame);
      if (this.messageListeners.length === 0) {
        this.pendingFrames.push(copy);
        continue;
      }
      for (const listener of [...this.messageListeners]) listener(copy);
    }
  }
}

/** 真实 timer。 */
const realTimer: ReplicationTimer = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs) as unknown,
  clearTimeout: (handle) => clearTimeout(handle as unknown as number),
};

/** 计数 timer（RT-F1 watchdog 空转观测：记录每次武装的延迟值）。 */
function makeCountingTimer(record: number[]): ReplicationTimer {
  return {
    setTimeout: (callback, delayMs) => {
      record.push(delayMs);
      return setTimeout(callback, delayMs) as unknown;
    },
    clearTimeout: (handle) => clearTimeout(handle as unknown as number),
  };
}

/** 带 observer 的 peer 节点（lease-released 官方观测面）。 */
function makeObservedPeerNode(leaseReleased: number[]): ReplicaNode {
  const persistence = new StubPersistence();
  const scheduler = makeNode('peer').scheduler;
  const registry = createNamespaceRegistryForTesting(persistence, {
    clock: { now: () => FIXED_MS },
    scheduler,
    idleTimeoutMs: 1_000_000,
    randomBytes: makeCounterRandomBytes(),
    role: 'peer',
    observer: (event: unknown) => {
      const e = event as { type: string; remainingLeases?: number };
      if (e.type === 'lease-released' && typeof e.remainingLeases === 'number') {
        leaseReleased.push(e.remainingLeases);
      }
    },
  });
  return { role: 'peer', persistence, scheduler, registry };
}

interface RealRun {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly nsId: string;
  readonly hubSide: RealWireTransport;
  readonly peerSide: RealWireTransport;
  readonly meta: PairCloseMeta;
  readonly leaseReleased: number[];
  readonly timerArms: number[] | undefined;
  /** peer 侧业务写（独立 business lease）。 */
  writePeer(value: Readonly<{ n: number }>): Promise<void>;
}

interface RealBootOptions {
  readonly countingTimer?: number[];
  readonly peerTimeouts?: { ackTimeoutMs?: number; closeTimeoutMs?: number };
}

/** 组装真实 TCP 链路：单 namespace，bootstrap 到 live（真实 timer；backoff 拉长防重拨干扰断言窗口）。 */
async function bootReal(opts: RealBootOptions = {}): Promise<RealRun> {
  const hubNode = makeNode('hub');
  const leaseReleased: number[] = [];
  const peerNode = makeObservedPeerNode(leaseReleased);
  const fixture = await makeHubNamespace(hubNode, { owner: HUB_OWNER });
  const nsId = fixture.namespaceId;

  const meta: PairCloseMeta = { hub: undefined, peer: undefined };
  let hubSide: RealWireTransport | undefined;
  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: hubNode.registry,
    authorize: async () => ({
      ok: true as const,
      localOwner: HUB_OWNER,
      permissions: { read: true, submit: true },
    }),
    timer: realTimer,
  });

  const server = net.createServer((socket) => {
    hubSide = new RealWireTransport(socket, 'hub', meta);
    hub.accept(hubSide, { peerInstanceId: PEER_INSTANCE });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;

  let peerSide: RealWireTransport | undefined;
  const peerTimer = opts.countingTimer !== undefined ? makeCountingTimer(opts.countingTimer) : realTimer;
  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      const socket = net.connect(port, '127.0.0.1');
      peerSide = new RealWireTransport(socket, 'peer', meta);
      return peerSide;
    },
    timer: peerTimer,
    targets: [{ namespaceId: nsId, localOwner: PEER_OWNER }],
    // 时间面覆写：closeTimeout 拉长排除兜底先行；ackTimeout 缩短使 watchdog 空转
    //（如泄漏）在采样窗口内可观测；backoff 拉长使 deadline 关连接后 peer 稳定 backoff。
    timeouts: {
      closeTimeoutMs: opts.peerTimeouts?.closeTimeoutMs ?? 60_000,
      ackTimeoutMs: opts.peerTimeouts?.ackTimeoutMs ?? 10_000,
    },
    backoff: { baseMs: 60_000, maxMs: 60_000, resetAfterMs: 60_000 },
  });
  peer.start();
  await waitUntil('连接 ready', () => peer.getConnectionState() === 'ready', 15_000);
  await waitUntil(
    `namespace live（当前 ${String(peer.getNamespaceState(nsId))}）`,
    () => peer.getNamespaceState(nsId) === 'live',
    15_000,
  );
  if (hubSide === undefined || peerSide === undefined) throw new Error('transport 未建立');

  const writePeer = async (value: Readonly<{ n: number }>): Promise<void> => {
    const lease = okLease(await peerNode.registry.open(PEER_OWNER, nsId));
    await schemaReady(lease);
    const result = await lease.mutateRoot({ op: 'set', path: ['n'], value: value.n });
    if (!result.ok) throw new Error(`peer 业务写失败：${JSON.stringify(result)}`);
    await lease.release();
  };

  return {
    hubNode,
    peerNode,
    hub,
    peer,
    nsId,
    hubSide,
    peerSide,
    meta,
    leaseReleased,
    timerArms: opts.countingTimer,
    writePeer,
  };
}

/** 只读对象图投影（peer 控制器资源账目 + watchdog 武装位；沿用 SA4 F1 锚同款）。 */
function controllerProjectionOf(run: RealRun): {
  readonly session: unknown;
  readonly lease: unknown;
  readonly watchdogIdleArmed: boolean;
  readonly unsubscribe: unknown;
} {
  const impl = run.peer as unknown as {
    controllers: Map<
      string,
      { session: unknown; lease: unknown; watchdog: { idleArmed: boolean }; unsubscribe: (() => void) | undefined }
    >;
  };
  const controller = impl.controllers.get(run.nsId);
  if (controller === undefined) throw new Error('无 peer controller');
  return {
    session: controller.session,
    lease: controller.lease,
    watchdogIdleArmed: controller.watchdog.idleArmed,
    unsubscribe: controller.unsubscribe,
  };
}

/** hub 通道状态只读投影。 */
function hubChannelStateOf(run: RealRun): string | undefined {
  const connection = run.hub.connections[0] as unknown as { channels: Map<string, { state: string }> };
  return connection?.channels.get(run.nsId)?.state;
}

/** 经真实 socket 注入 hub→peer 帧（序列 = peer 接收端已见最大 +1）。 */
function injectHubToPeer(run: RealRun, message: ReplicationMessage, sequence?: number): number {
  const seq = sequence ?? run.peerSide.nextSequenceForReceiver();
  run.hubSide.inject(encodeMessage(message, { sequence: seq }));
  return seq;
}

function countKind(frames: readonly DecodedMessage[], kind: string): number {
  return frames.filter((f) => f.message.kind === kind).length;
}

const cleanupQueue: Array<() => void> = [];
afterAll(() => {
  for (const dispose of cleanupQueue) dispose();
});

// ═══════════════════════════ RT-F1：drain 窗口 removeTarget 真机回归 ═══════════════════════════

describe('SA7 RT-F1（issue #171，SA4 §4.1）：真实 TCP + 真实 timer 下 GOAWAY drain 窗口 removeTarget——deadline 关 socket 触发本地 onClose 后资源收口恰一次', () => {
  it('RT-F1：live → GOAWAY(RESTARTING) → 窗口内 removeTarget → deadline close(1001) 本地 onClose → lease-released 恰一次 + watchdog 零空转 + 字段清空', async () => {
    const ACK_MS = 120;
    const DRAIN_MS = 800;
    const timerArms: number[] = [];
    const run = await bootReal({
      countingTimer: timerArms,
      peerTimeouts: { ackTimeoutMs: ACK_MS, closeTimeoutMs: 60_000 },
    });
    const before = controllerProjectionOf(run);
    expect(before.session, '前置：live 期 session 已取得').toBeDefined();
    expect(before.lease, '前置：live 期 lease 已取得').toBeDefined();
    expect(before.watchdogIdleArmed, '前置：watchdog idle 已武装（自订阅起）').toBe(true);
    expect(run.leaseReleased, '前置：peer registry 尚无 lease 释放事件').toHaveLength(0);

    // ── GOAWAY RESTARTING 经真实 wire 注入（真实 socket + 对端重组）──
    const t0 = Date.now();
    injectHubToPeer(run, {
      kind: 'GOAWAY',
      reasonCode: 'SERVER_RESTARTING',
      drainTimeoutMs: DRAIN_MS,
    });
    // ── 轻量层同步静默：ns 投影 disconnected（连接 ready 不变）——SA2 R2-N2① 提前投影时序留证 ──
    await waitUntil(
      `GOAWAY 收帧后 ns disconnected（当前 ${String(run.peer.getNamespaceState(run.nsId))}）`,
      () => run.peer.getNamespaceState(run.nsId) === 'disconnected',
      2_000,
    );
    const tDisconnected = Date.now();
    expect(tDisconnected - t0, 'disconnected 投影必须发生在 deadline 之前（提前投影）').toBeLessThan(DRAIN_MS);
    expect(run.peer.getConnectionState(), 'drain 窗口内连接保持 ready（deadline 只管 transport）').toBe('ready');
    expect(controllerProjectionOf(run).unsubscribe, '轻量层已摘订阅').toBeUndefined();

    // ── 攻击点：drain 窗口内（deadline 未到）宿主移除 target（F1 修复面）──
    await run.peer.removeTarget(run.nsId);
    expect(run.peer.getNamespaceState(run.nsId), 'removeTarget 本地收口 closed（disconnected 分支）').toBe('closed');
    // drain 窗口内即完成处置（F1 修复：本地结算同样排队处置——不依赖 deadline）
    await waitUntil('F1 处置完成（lease-released 事件恰一次）', () => run.leaseReleased.length === 1, 3_000);
    expect(run.leaseReleased, 'peer replication lease 恰一次释放（remainingLeases 归零——无泄漏/无双重释放）').toEqual([0]);

    // ── deadline 到期（真实 timer）：全量层 isTerminal() 早退 + transport close(1001) ──
    await waitUntil('deadline 关闭 peer 侧 transport', () => run.peerSide.closed, DRAIN_MS + 3_000);
    expect(run.meta.peer, 'deadline transport close = WS 1001/goaway-drain（§6.3）').toEqual({
      code: 1001,
      reason: 'goaway-drain',
    });
    // 真实 socket.close 事件通知**本地** onClose（真实 WS 语义）→ 临时失败 → backoff
    await waitUntil(
      `本地 onClose 处理后连接 backoff（当前 ${run.peer.getConnectionState()}）`,
      () => run.peer.getConnectionState() === 'backoff',
      3_000,
    );
    // ── 恰一次收口（真机差异面）：本地 onClose → onConnectionLost 终态早退，不得二次释放 ──
    await sleep(3 * ACK_MS + 60);
    expect(run.leaseReleased, 'deadline/本地 onClose 后仍恰一次 lease-released（零双重释放）').toEqual([0]);

    // ── watchdog 零空转：采样窗口内零新增 timer 武装（泄漏时每 ACK_MS 重武装一次）──
    const sampleStart = timerArms.length;
    await sleep(3 * ACK_MS + 60);
    expect(
      timerArms.length - sampleStart,
      'deadline 后 watchdog idle 自重武装链必须停止（采样窗口零新增武装）',
    ).toBe(0);

    const after = controllerProjectionOf(run);
    expect(after.session, '终局：session 字段已清空（AC2 零泄漏）').toBeUndefined();
    expect(after.lease, '终局：lease 字段已清空（AC2 零泄漏）').toBeUndefined();
    expect(after.watchdogIdleArmed, '终局：watchdog 已 teardown').toBe(false);

    await run.peer.stop();
    await waitUntil('peer stopped', () => run.peer.getConnectionState() === 'stopped', 5_000);
    cleanupQueue.push(() => run.peerSide.socket.destroy());
  });

  it('RT-G5：GOAWAY 收帧同步静默——drain 窗口内 peer 业务写零 UPDATE 出站；deadline 才关 transport；deadline 全量层处置 lease 恰一次', async () => {
    const DRAIN_MS = 1_200;
    const run = await bootReal({});
    expect(run.peer.getNamespaceState(run.nsId)).toBe('live');

    // 前置：live 期业务写已上 wire（UPDATE 基线 > 0）
    await run.writePeer({ n: 777 });
    await waitUntil(
      'live 期 UPDATE 已上 wire（基线）',
      () => countKind(run.peerSide.sent, 'UPDATE') >= 1,
      3_000,
    );

    const t0 = Date.now();
    injectHubToPeer(run, {
      kind: 'GOAWAY',
      reasonCode: 'SERVER_RESTARTING',
      drainTimeoutMs: DRAIN_MS,
    });
    // ── 同步静默（G5）：收帧段订阅已摘 + 投影 disconnected + 连接 ready ──
    await waitUntil('GOAWAY 收帧后 ns disconnected', () => run.peer.getNamespaceState(run.nsId) === 'disconnected', 2_000);
    const tDisconnected = Date.now();
    expect(tDisconnected - t0, 'disconnected 投影在 deadline 前（同步段先于异步 drain）').toBeLessThan(DRAIN_MS);
    expect(run.peer.getConnectionState(), 'drain 窗口连接 ready').toBe('ready');
    expect(controllerProjectionOf(run).unsubscribe, '订阅已摘（数据面双保险之一）').toBeUndefined();

    // ── drain 窗口内业务写 → 零 UPDATE 出站（同步静默先于异步 drain——真实 wire 帧面）──
    const updatesBefore = countKind(run.peerSide.sent, 'UPDATE');
    expect(updatesBefore, '前置：live 期 UPDATE 已上 wire（bootstrap 收敛）').toBeGreaterThan(0);
    await run.writePeer({ n: 4242 });
    await sleep(250);
    expect(
      countKind(run.peerSide.sent, 'UPDATE'),
      'drain 窗口内业务写零 UPDATE 出站（收帧同步段已静默订阅）',
    ).toBe(updatesBefore);
    expect(run.peer.getConnectionState(), '窗口内连接仍 ready').toBe('ready');

    // ── deadline：transport close(1001) + 全量层处置（本测试无 removeTarget——对照路径）──
    await waitUntil('deadline 关闭 peer 侧 transport', () => run.peerSide.closed, DRAIN_MS + 3_000);
    expect(run.meta.peer, 'deadline transport close = 1001/goaway-drain').toEqual({
      code: 1001,
      reason: 'goaway-drain',
    });
    // lease 账本：live 期业务写 lease 释放（remaining=1——复制 lease 仍持有）在前；
    // deadline 全量层释放复制 lease → 最后事件 remaining=0。
    await waitUntil(
      'deadline 全量层处置复制 lease（最后事件 remainingLeases=0）',
      () => run.leaseReleased.length > 0 && run.leaseReleased[run.leaseReleased.length - 1] === 0,
      3_000,
    );
    const sample = run.leaseReleased.length;
    await sleep(200);
    expect(run.leaseReleased.length, 'deadline + 本地 onClose 后无二次释放').toBe(sample);

    await run.peer.stop();
    await waitUntil('peer stopped', () => run.peer.getConnectionState() === 'stopped', 5_000);
    cleanupQueue.push(() => run.peerSide.socket.destroy());
  });
});

// ═══════════════════════════ RT-C4 / RT-C4b：错配 CLOSE_OK 真 wire 形态 ═══════════════════════════

describe('SA7 RT-C4（issue #171，SA4 §4.4）：错配 CLOSE_OK 的 ERROR 帧真 wire 形态（1002 + blocked 投影）', () => {
  it('RT-C4：removeTarget 后扣真实 CLOSE_OK → 注入错配 CLOSE_OK → ACK_STATE_VIOLATION ERROR 帧上真实 wire 并到达对端 + close(1002) + blocked + 承诺有限结算', async () => {
    const run = await bootReal({});
    // 扣住真实 CLOSE_OK（帧由 hub 编码但不上 socket——接收端零感知）
    run.hubSide.dropNext((bytes) => {
      try {
        return decodeMessage(bytes).message.kind === 'CLOSE_OK';
      } catch {
        return false;
      }
    });
    const closeP = run.peer.removeTarget(run.nsId);
    await waitUntil('peer 进入 closing', () => run.peer.getNamespaceState(run.nsId) === 'closing', 3_000);
    // 同步点（SA3 §2.2）：hub 通道 closed = 真实 CLOSE_OK 已发出并被 drop
    await waitUntil(
      `hub 通道 closed（当前 ${String(hubChannelStateOf(run))}）`,
      () => hubChannelStateOf(run) === 'closed',
      3_000,
    );
    expect(run.peer.getConnectionState(), '注入前连接 ready（violation 未发生）').toBe('ready');

    // 注入错配 CLOSE_OK（ackedSequence 与 closeSequence 不匹配；序列 = 接收端期望）
    injectHubToPeer(run, {
      kind: 'CLOSE_OK',
      namespaceId: run.nsId,
      ackedSequence: 999_999,
    });
    // ── 锚 1：ACK_STATE_VIOLATION ERROR 帧上真实 wire（peer→hub）并到达对端 ──
    await waitUntil(
      'ERROR(ACK_STATE_VIOLATION) 出站',
      () =>
        run.peerSide.sent.some(
          (f) => f.message.kind === 'ERROR' && (f.message as { code: string }).code === 'ACK_STATE_VIOLATION',
        ),
      3_000,
    );
    expect(
      run.hubSide.received.some(
        (f) => f.message.kind === 'ERROR' && (f.message as { code: string }).code === 'ACK_STATE_VIOLATION',
      ),
      'ERROR 帧经真实 socket 到达 hub 侧（真 wire 形态）',
    ).toBe(true);
    // ── 锚 2：连接 blocked 投影 ──
    await waitUntil('连接 blocked', () => run.peer.getConnectionState() === 'blocked', 3_000);
    // ── 锚 3：transport close code 1002（protocol-error）──
    expect(run.meta.peer, 'violation 收口 transport close = 1002/protocol-error').toEqual({
      code: 1002,
      reason: 'protocol-error',
    });
    // ── 锚 4：removeTarget 承诺有限结算（violation 收口 = 关闭承诺兑现）──
    await closeP;
    expect(run.leaseReleased[run.leaseReleased.length - 1], 'violation 收口路径 lease 释放（remainingLeases 归零）').toBe(0);
    await run.peer.stop();
    await waitUntil('peer stopped', () => run.peer.getConnectionState() === 'stopped', 5_000);
    cleanupQueue.push(() => run.peerSide.socket.destroy());
  });

  it('RT-C4b：hub 发起 CLOSE（closeSequence 未定义）窗口注入错配 CLOSE_OK → 同款显式收口；放行在途 apply 后本代 CLOSE 续体仍收口 closed', async () => {
    const run = await bootReal({});
    // 在途 apply 悬挂（peer 侧 saveGate）：hub 写 → UPDATE → peer apply → saveDoc 挂起
    const gate = deferred();
    run.peerNode.persistence.saveGate = gate;
    // hub 侧业务写（经 registry 重开 fixture——与 fake 套件 writeHub 同语义）
    const hubLease = okLease(await run.hubNode.registry.open(HUB_OWNER, run.nsId));
    await schemaReady(hubLease);
    const mutated = await hubLease.mutateRoot({ op: 'set', path: ['n'], value: 66 });
    if (!mutated.ok) throw new Error(`hub 业务写失败：${JSON.stringify(mutated)}`);
    await waitUntil('peer apply 到达 saveDoc（悬挂）', () => run.peerNode.persistence.saveEvents.length > 0, 3_000);
    await waitUntil(
      'peer 文档已接纳 n=66（apply 已变更本地 doc、saveDoc 悬挂）',
      () => {
        const doc = run.peerNode.persistence.peek(PEER_OWNER, run.nsId);
        return doc !== undefined && (doc.getMap('ROOT').get('n') as number) === 66;
      },
      3_000,
    );

    // hub 发起 CLOSE（真 wire 注入；本端从未发出 CLOSE_NAMESPACE → closeSequence 未定义）
    const closeNsSeq = injectHubToPeer(run, {
      kind: 'CLOSE_NAMESPACE',
      namespaceId: run.nsId,
      reasonCode: 'hub-side-close',
    });
    await waitUntil('peer 进入 closing（drain 悬挂在途 apply）', () => run.peer.getNamespaceState(run.nsId) === 'closing', 3_000);

    // 注入错配 CLOSE_OK（+7 偏移恒 ≠ 任何关联序）
    injectHubToPeer(run, {
      kind: 'CLOSE_OK',
      namespaceId: run.nsId,
      ackedSequence: closeNsSeq + 7,
    });
    // ── 锚 1：同款 ACK_STATE_VIOLATION 显式收口（零静默完成）──
    await waitUntil(
      'ERROR(ACK_STATE_VIOLATION) 出站',
      () =>
        run.peerSide.sent.some(
          (f) => f.message.kind === 'ERROR' && (f.message as { code: string }).code === 'ACK_STATE_VIOLATION',
        ),
      3_000,
    );
    expect(
      run.hubSide.received.some(
        (f) => f.message.kind === 'ERROR' && (f.message as { code: string }).code === 'ACK_STATE_VIOLATION',
      ),
      'C4b：ERROR 帧经真实 socket 到达 hub 侧',
    ).toBe(true);
    await waitUntil('连接 blocked', () => run.peer.getConnectionState() === 'blocked', 3_000);
    expect(run.meta.peer, 'C4b：transport close = 1002/protocol-error').toEqual({
      code: 1002,
      reason: 'protocol-error',
    });
    expect(
      run.peer.getNamespaceState(run.nsId),
      'violation 窗口不得静默完成收口为 closed（投影 disconnected）',
    ).not.toBe('closed');

    // ── 锚 2：放行在途 apply → 本代 CLOSE 续体正常收口 closed（零悬挂）──
    gate.resolve();
    await waitUntil('放行后 peer ns 收口 closed', () => run.peer.getNamespaceState(run.nsId) === 'closed', 5_000);
    await run.peer.stop();
    await waitUntil('peer stopped', () => run.peer.getConnectionState() === 'stopped', 5_000);
    cleanupQueue.push(() => run.peerSide.socket.destroy());
  });
});

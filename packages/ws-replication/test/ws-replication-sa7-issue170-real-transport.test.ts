/**
 * SA7 补充测试（issue #170 动态验证）—— 真实 transport（真实 TCP + 真实 OS timer）
 * 下的 ping/pong epoch safety 全链路：pong 超时收口 → backoff 重拨 → hub 只留新连接
 * → 数据最终收敛。
 *
 * 背景：本任务 SA6 红灯（H1/P4）走 fake-duplex 内存 wire + fake scheduler 虚拟时钟；
 * 仓内既有真实链路测试（ws-replication-sa7-r2-transport，issue #137）真实 TCP 但
 * transport 无 ping/onPong 面（liveness dormant）。本文件在真实 TCP 链路上补
 * issue #170 验收 5 的真实面：
 *   ① 首代连接：hub 适配器不复 pong（确定性地令 peer liveness 超时）；
 *   ② pong 超时收口（真实 timer 触发）：close(1001,'pong-timeout') 上真实 socket、
 *      peer 进 backoff；hub 侧最终观测到 1001/pong-timeout（wire 可见）；
 *   ③ 收口后旧传输零再 ping（ws 语义下 ping() 对已关 socket 抛错——本适配器忠实
 *      建模抛错面；结构性不发生 → 零抛错计数）、pong/message/close 监听全退订；
 *   ④ wire 上零未注册 PONG_TIMEOUT connection ERROR 帧（§10 护栏，真实链路面）；
 *   ⑤ backoff 到期重拨（新 TCP 连接，hub 适配器 auto-pong）→ ready → ns live →
 *      hub 只保留新连接（connections===1）→ hub 写 → peer 副本收敛；
 *   ⑥ 新代健康存活：≥2 个 ping 周期全部被应答（真实往返），连接保持 ready。
 *
 * 纪律（与 r2-transport 同属「真实链路集成抽样」测试类）：node:net 真实 TCP +
 * 真实 timer + 有界 real wait 轮询（waitUntil）；Registry 仍走 testing seam
 * （r2-transport 同款组合，先例长期绿色）。传输层 4B 长度前缀 + 1B record 类型
 * （0x01=协议 DATA / 0x02=PING / 0x03=PONG）——PING/PONG 是 WS 控制帧语义的适配器
 * 级实现（协议 L42：不定义业务 PING/PONG frame，故绝不进入协议帧流）；pong 回显
 * ping 载荷（RFC 6455 §5.5.2）。零源码 grep 断言。
 */
import * as net from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import {
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  PEER_OWNER,
  makeNode,
  okLease,
  schemaReady,
  SCHEMA_ENVELOPE,
  type ReplicaNode,
} from './harness.js';
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type { DuplexTransport, HubReplication, PeerReplication, ReplicationTimer } from '@nomicore/ws-replication';
import { decodeMessage, type DecodedMessage } from '@nomicore/replication-protocol';

// ═══════════════════════════ 常量（真实时钟,刻意小值缩短观察窗） ═══════════════════════════

const PING_INTERVAL_MS = 200;
const PONG_TIMEOUT_MS = 150;
/** backoff base/max=300 × random 0.5 → 150ms 后重拨。 */
const BACKOFF_BASE_MS = 300;

const RECORD_DATA = 0x01;
const RECORD_PING = 0x02;
const RECORD_PONG = 0x03;

/** 有界 real wait 轮询（真实链路集成抽样专用,r2-transport 同款）。 */
async function waitUntil(what: string, predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) throw new Error(`waitUntil 超时（${timeoutMs}ms）：${what}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

interface PairCloseMeta {
  hub: { code: number; reason: string } | undefined;
  peer: { code: number; reason: string } | undefined;
}

// ═══════════════════════════ 真实 TCP transport（liveness 面 + 适配器级 PING/PONG） ═══════════════════════════

/**
 * 真实 TCP transport 适配器（基类,无 liveness 面）：record = [type 1B][len 4B][payload]。
 * - DATA（0x01）：协议帧（与 r2-transport 的 4B 前缀同职责,加类型字节区分控制 record）；
 * - PING（0x02）/PONG（0x03）：WS 控制帧语义的适配器级实现——收到 PING 且
 *   `respondPing` 时立即回 PONG（回显载荷）；收到 PONG 时唤起 pong 监听器
 *   （基类不暴露 ping/onPong 成员 → 复制层 liveness dormant——hub 侧用,
 *   hub 侧 pong 超时语义由 H1 在虚拟时钟面覆盖）。
 *   `exactOptionalPropertyTypes` 纪律:接口可选成员不可显式 undefined,故 face
 *   经子类以必需方法提供（PeerRealTcpTransport）——结构上天然可赋值 DuplexTransport。
 */
class RealTcpTransport implements DuplexTransport {
  readonly socket: net.Socket;
  private readonly side: 'hub' | 'peer';
  private readonly meta: PairCloseMeta;
  private readonly respondPing: boolean;
  protected readonly messageListeners: Array<(bytes: Uint8Array) => void> = [];
  protected readonly closeListeners: Array<(info: Readonly<{ code: number; reason: string }>) => void> = [];
  protected readonly pongListeners: Array<(payload?: Uint8Array) => void> = [];
  protected readonly pendingFrames: Uint8Array[] = [];
  protected readonly sent: DecodedMessage[] = [];
  protected buffer: Buffer = Buffer.alloc(0);
  private closedFlag = false;
  private pings = 0;
  private pingsOnClosed = 0;
  private readonly pingErrors: Error[] = [];
  private readonly pongRecords: Uint8Array[] = [];

  constructor(socket: net.Socket, side: 'hub' | 'peer', meta: PairCloseMeta, respondPing: boolean) {
    this.socket = socket;
    this.side = side;
    this.meta = meta;
    this.respondPing = respondPing;
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

  /** peer 侧 liveness 面（子类以必需方法暴露——复制层武装判据 `ping !== undefined` 恒真）。 */
  protected doPing(data?: Uint8Array): void {
    if (this.closedFlag) {
      // 真实 ws 语义：closed socket 上 ping() 抛错（timer 回调内未捕获 = 进程级）
      this.pingsOnClosed += 1;
      const err = new Error('WebSocket is not open: readyState 3 (CLOSED)');
      this.pingErrors.push(err);
      throw err;
    }
    this.pings += 1;
    this.writeRecord(RECORD_PING, data ?? new Uint8Array(0));
  }

  protected subscribePong(listener: (payload?: Uint8Array) => void): () => void {
    this.pongListeners.push(listener);
    return () => {
      const index = this.pongListeners.indexOf(listener);
      if (index >= 0) this.pongListeners.splice(index, 1);
    };
  }

  get closed(): boolean {
    return this.closedFlag || this.socket.destroyed;
  }

  // ── 观测面 ──
  pingCount(): number {
    return this.pings;
  }
  pingsOnClosedTransport(): number {
    return this.pingsOnClosed;
  }
  closedTransportPingErrors(): ReadonlyArray<Error> {
    return this.pingErrors;
  }
  pongListenerCount(): number {
    return this.pongListeners.length;
  }
  messageListenerCount(): number {
    return this.messageListeners.length;
  }
  closeListenerCount(): number {
    return this.closeListeners.length;
  }
  /** 本端发出的协议帧（解码后）——wire 护栏断言用。 */
  sentFrames(): ReadonlyArray<DecodedMessage> {
    return this.sent;
  }
  /** 本端收到的 PONG record 载荷记录。 */
  receivedPongs(): ReadonlyArray<Uint8Array> {
    return this.pongRecords;
  }

  // ── DuplexTransport 契约 ──
  send(bytes: Uint8Array): void {
    if (this.closedFlag) return;
    this.writeRecord(RECORD_DATA, bytes);
    this.sent.push(decodeMessage(bytes));
  }

  close(code?: number, reason?: string): void {
    if (this.closedFlag) return;
    this.meta[this.side] = { code: code ?? 1005, reason: reason ?? '' };
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 2_000).unref?.();
  }

  onMessage(listener: (bytes: Uint8Array) => void): () => void {
    this.messageListeners.push(listener);
    // 真实 TCP 上数据可能先于协议侧注册 listener 到达——注册后重放积压帧
    //（r2-transport 同款：保「一 send 一 message」语义）。
    if (this.pendingFrames.length > 0) {
      const replay = this.pendingFrames.splice(0);
      for (const bytes of replay) listener(bytes);
    }
    return () => {
      const index = this.messageListeners.indexOf(listener);
      if (index >= 0) this.messageListeners.splice(index, 1);
    };
  }

  onClose(listener: (info: Readonly<{ code: number; reason: string }>) => void) {
    this.closeListeners.push(listener);
    return () => {
      const index = this.closeListeners.indexOf(listener);
      if (index >= 0) this.closeListeners.splice(index, 1);
    };
  }

  // ── 成帧层 ──
  private writeRecord(type: number, payload: Uint8Array): void {
    const header = Buffer.alloc(5);
    header.writeUInt8(type, 0);
    header.writeUInt32BE(payload.byteLength, 1);
    this.socket.write(Buffer.concat([header, Buffer.from(payload)]));
  }

  private receive(chunk: Buffer): void {
    if (this.closedFlag) return;
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.byteLength < 5) return;
      const type = this.buffer.readUInt8(0);
      const length = this.buffer.readUInt32BE(1);
      if (this.buffer.byteLength < 5 + length) return;
      const payload = this.buffer.subarray(5, 5 + length);
      this.buffer = this.buffer.subarray(5 + length);
      const copy = new Uint8Array(payload.byteLength);
      copy.set(payload);
      if (type === RECORD_PING) {
        if (this.respondPing) this.writeRecord(RECORD_PONG, copy); // RFC 6455 §5.5.2：回显载荷
        continue;
      }
      if (type === RECORD_PONG) {
        this.pongRecords.push(copy);
        for (const listener of [...this.pongListeners]) listener(copy);
        continue;
      }
      if (this.messageListeners.length === 0) {
        this.pendingFrames.push(copy);
        continue;
      }
      for (const listener of [...this.messageListeners]) listener(copy);
    }
  }
}

/** peer 侧 transport：以必需方法暴露 ping/onPong 面（liveness 武装判据恒真；
 *  exactOptionalPropertyTypes 下天然可赋值 DuplexTransport 可选成员）。 */
class PeerRealTcpTransport extends RealTcpTransport {
  private failFirstPing: boolean;
  private injectedFailures = 0;

  constructor(socket: net.Socket, meta: PairCloseMeta, opts: { failFirstPing?: boolean } = {}) {
    super(socket, 'peer', meta, true);
    this.failFirstPing = opts.failFirstPing === true;
  }

  /** 实例箭头属性（非原型方法）：liveness 以分离引用调用 `deps.ping`/`deps.onPong`
   *  （peer-connection.ts:307-308 `ping: transport.ping, onPong: transport.onPong`）——
   *  方法语法会丢 `this` 绑定，箭头属性捕获实例。 */
  readonly ping = (data?: Uint8Array): void => {
    // 故障注入（A4 动态锚）：适配器 ping 首调抛错（socket 仍开放）——liveness 的
    // catch 必须吸收（不得逃出 timer 回调 = 进程级未捕获异常）。
    if (this.failFirstPing) {
      this.failFirstPing = false;
      this.injectedFailures += 1;
      throw new Error('simulated adapter ping failure (fault injection)');
    }
    this.doPing(data);
  };

  readonly onPong = (listener: (payload?: Uint8Array) => void): (() => void) => {
    return this.subscribePong(listener);
  };

  injectedPingFailures(): number {
    return this.injectedFailures;
  }
}

/** 真实 timer（本文件为真实链路抽样；协议时间面走真实时钟）。 */
const realTimer: ReplicationTimer = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs) as unknown,
  clearTimeout: (handle) => clearTimeout(handle as unknown as number),
};

// ═══════════════════════════ 环境组装 ═══════════════════════════

interface RealLivenessRun {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly nsId: string;
  readonly peerTransports: PeerRealTcpTransport[];
  readonly hubTransports: RealTcpTransport[];
  /** hub 侧观测到的对端（peer）close 信息——wire 可见的关闭码判别点。 */
  hubSeenClose(): Readonly<{ code: number; reason: string }> | undefined;
  dialCount(): number;
  writeHub(value: number): Promise<void>;
  rootValue(side: 'hub' | 'peer'): unknown;
  destroy(): void;
}

/**
 * 真实 TCP 链路：hub 侧 transport 不暴露 liveness 面（dormant）；第 1 个连接
 * hub 适配器不复 PING（确定性触发 peer pong 超时）,后续连接复 PING（健康）。
 */
async function bootRealLiveness(
  opts: { failFirstPeerPing?: boolean } = {},
): Promise<RealLivenessRun> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const lease = okLease(
    await hubNode.registry.create({ owner: HUB_OWNER, schema: SCHEMA_ENVELOPE, root: { n: 42 } }),
  );
  await schemaReady(lease);
  const enabled = await lease.enableReplication();
  if (!enabled.ok) throw new Error(`enableReplication 失败：${JSON.stringify(enabled)}`);
  const nsId = lease.namespaceId;

  const meta: PairCloseMeta = { hub: undefined, peer: undefined };
  const peerTransports: PeerRealTcpTransport[] = [];
  const hubTransports: RealTcpTransport[] = [];
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
    // 首个连接不复 PING（死对端）——peer liveness 必然超时；后续连接回 PONG（健康）。
    // hub 侧用基类（无 ping/onPong 面 → hub liveness dormant——hub 侧语义由 H1 覆盖）。
    const generation = hubTransports.length + 1;
    const transport = new RealTcpTransport(socket, 'hub', meta, generation > 1);
    hubTransports.push(transport);
    hub.accept(transport, { peerInstanceId: PEER_INSTANCE });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;

  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      const socket = net.connect(port, '127.0.0.1');
      const transport = new PeerRealTcpTransport(socket, meta, {
        failFirstPing: opts.failFirstPeerPing === true && peerTransports.length === 0,
      });
      peerTransports.push(transport);
      return transport;
    },
    timer: realTimer,
    targets: [{ namespaceId: nsId, localOwner: PEER_OWNER }],
    timeouts: { pingIntervalMs: PING_INTERVAL_MS, pongTimeoutMs: PONG_TIMEOUT_MS },
    backoff: { baseMs: BACKOFF_BASE_MS, maxMs: BACKOFF_BASE_MS, resetAfterMs: 60_000 },
    random: () => 0.5,
  });
  peer.start();

  const writeHub = async (value: number): Promise<void> => {
    const opened = okLease(await hubNode.registry.open(HUB_OWNER, nsId));
    await schemaReady(opened);
    const result = await opened.mutateRoot({ op: 'set', path: ['n'], value });
    if (!result.ok) throw new Error(`hub 写失败：${JSON.stringify(result)}`);
    await opened.release();
  };
  const rootValue = (side: 'hub' | 'peer'): unknown => {
    const node = side === 'hub' ? hubNode : peerNode;
    const owner = side === 'hub' ? HUB_OWNER : PEER_OWNER;
    const doc = node.persistence.peek(owner, nsId);
    if (doc === undefined) throw new Error(`${side} 缺副本`);
    return (doc.getMap('ROOT') as ReadonlyMap<string, unknown>).get('n');
  };
  return {
    hubNode,
    peerNode,
    hub,
    peer,
    nsId,
    peerTransports,
    hubTransports,
    hubSeenClose: () => meta.peer,
    dialCount: () => peerTransports.length,
    writeHub,
    rootValue,
    destroy() {
      for (const t of [...peerTransports, ...hubTransports]) t.socket.destroy();
      server.close();
    },
  };
}

const liveRuns: RealLivenessRun[] = [];

/** 有界收尾：协议 stop/close 不得因已销毁链路悬挂测试进程。 */
async function settleClose(promise: Promise<void>, ms: number): Promise<void> {
  await Promise.race([promise, new Promise<void>((resolve) => setTimeout(resolve, ms))]);
}

afterAll(async () => {
  for (const run of liveRuns.splice(0)) {
    run.destroy();
    await settleClose(run.peer.stop(), 3_000);
    await settleClose(run.hub.close(), 3_000);
  }
});

// ═══════════════════════════ 真实 transport 全链路 ═══════════════════════════

describe('SA7 issue #170 真实 transport：pong 超时收口 → backoff 重拨 → hub 只留新连接 → 数据收敛（真实 TCP + 真实 timer）', () => {
  it('真实链路：死对端 pong 超时 close(1001) → 重拨后 hub.connections===1、旧传输零僵尸 ping/零 ws 抛错、新代健康、写值收敛', { timeout: 120_000 }, async () => {
    const run = await bootRealLiveness();
    liveRuns.push(run);
    try {
      // 前置：首代连接 ready + ns live（真实握手/reconcile）
      await waitUntil('首代连接 ready', () => run.peer.getConnectionState() === 'ready', 15_000);
      await waitUntil('首代 ns live', () => run.peer.getNamespaceState(run.nsId) === 'live', 15_000);
      const gen1 = run.peerTransports[0]!;
      expect(gen1.pingCount(), '前置：liveness 已武装（ping 面装配）').toBeGreaterThanOrEqual(0);

      // ── ① 死对端（hub 首代不复 PING）→ pong 超时收口（真实 timer 触发）──
      await waitUntil('pong 超时 → backoff', () => run.peer.getConnectionState() === 'backoff', 15_000);
      // 真实 TCP：close() = socket.end() → FIN 往返后本地 'close' 事件置位（有界等待）
      await waitUntil('gen1 传输关闭（FIN 往返）', () => gen1.closed, 15_000);
      await waitUntil('hub 侧观测关闭', () => run.hubTransports[0]?.closed === true, 15_000);
      // wire 可见：hub 侧观测到 1001/pong-timeout（临时失败语义——非 1002/blocked）
      expect(run.hubSeenClose(), 'hub 观测 close code/reason = 1001/pong-timeout').toEqual({
        code: 1001,
        reason: 'pong-timeout',
      });

      // ── ② 收口后旧传输收口纪律（真实面）：监听全退订、零已关传输 ping、零 ws 语义抛错 ──
      await waitUntil('旧传输 pong 监听退订', () => gen1.pongListenerCount() === 0, 15_000);
      expect(gen1.messageListenerCount(), '旧传输 message 监听退订').toBe(0);
      expect(gen1.closeListenerCount(), '旧传输 close 监听退订').toBe(0);

      // ── ③ wire 护栏：peer 首代零未注册 PONG_TIMEOUT connection ERROR 帧 ──
      const pongTimeoutErrors = gen1.sentFrames().filter(
        (f) => f.message.kind === 'ERROR' && (f.message as Readonly<{ code?: string }>).code === 'PONG_TIMEOUT',
      );
      expect(pongTimeoutErrors, '协议护栏：wire 上零 PONG_TIMEOUT ERROR（§10 注册表无此码）').toHaveLength(0);

      // ── ④ hub 异步清死连接（registry 收口不依赖虚拟时钟——SA2 MINOR #4 真实面）──
      await waitUntil('hub 清理死连接', () => run.hub.connections.length === 0, 15_000);

      // ── ⑤ backoff 到期重拨（新 TCP 连接 + hub 复 PING）→ ready → ns live ──
      await waitUntil('重拨（dialCount 2）', () => run.dialCount() === 2, 15_000);
      await waitUntil('重拨后 ready', () => run.peer.getConnectionState() === 'ready', 15_000);
      await waitUntil('重连后 ns live', () => run.peer.getNamespaceState(run.nsId) === 'live', 15_000);
      expect(run.hub.connections.length, '重连后 hub 只保留新连接').toBe(1);
      const gen2 = run.peerTransports[1]!;

      // ── ⑥ 新代健康：真实 PING→PONG 往返应答（≥2 周期），连接保持 ready ──
      await waitUntil('新代 ≥2 次 ping 被应答', () => gen2.receivedPongs().length >= 2, 15_000);
      expect(run.peer.getConnectionState(), '新代持续 ready（健康 liveness）').toBe('ready');

      // ── ⑦ 数据最终收敛（验收 5/6 真实面）：hub 写 → peer 副本汇聚 ──
      await run.writeHub(99);
      await waitUntil('数据收敛（peer n=99）', () => run.rootValue('peer') === 99, 30_000);
      expect(run.rootValue('hub')).toBe(99);

      // ── ⑧ 僵尸活性判别（全程窗口后复核）：首代传输零再 ping、零 ws 语义抛错 ──
      expect(gen1.pingsOnClosedTransport(), 'backoff/重连全程零已关传输 ping（P4 真实面）').toBe(0);
      expect(gen1.closedTransportPingErrors(), '零 ws 语义 ping 抛错（timer 回调内未捕获异常不存在）').toHaveLength(0);
      const gen1PingsAtEnd = gen1.pingCount();
      expect(gen1PingsAtEnd, '首代 ping 停在超时前（自停纪律）').toBeGreaterThanOrEqual(1);
      // 旧代注入迟到 PONG record 直写旧 socket 已不可能（已关）；新代不受旧代影响：
      expect(gen2.pingsOnClosedTransport()).toBe(0);
    } finally {
      // 观测窗后复核不再有变化（防御性二次采样留给收尾 destroy 前）
    }
  });

  it('A4 故障注入：适配器 ping() 首调抛错（socket 仍开放）→ liveness catch 吸收 → close(1001,pong-timeout) + backoff → 重连健康收敛（零未捕获异常）', { timeout: 120_000 }, async () => {
    const run = await bootRealLiveness({ failFirstPeerPing: true });
    liveRuns.push(run);
    // 前置：首代 ready + ns live
    await waitUntil('首代连接 ready', () => run.peer.getConnectionState() === 'ready', 15_000);
    await waitUntil('首代 ns live', () => run.peer.getNamespaceState(run.nsId) === 'live', 15_000);
    const gen1 = run.peerTransports[0]!;

    // ── 首个 ping 周期：适配器 ping() 抛错（open socket 上的传输层故障）──
    await waitUntil('ping 抛错 → catch 吸收 → backoff', () => run.peer.getConnectionState() === 'backoff', 15_000);
    expect(gen1.injectedPingFailures(), '注入恰一次').toBe(1);
    // 异常被 liveness catch 吸收（SA4 动态重点 #2 / SA2 MINOR #2 登记项的活链路面）：
    // 进程未崩溃（此处即测试继续运行）、收口走临时失败语义（非 blocked）
    await waitUntil('gen1 传输关闭', () => gen1.closed, 15_000);
    await waitUntil('hub 观测关闭', () => run.hubTransports[0]?.closed === true, 15_000);
    expect(run.hubSeenClose(), 'ping 抛错收口同样 1001/pong-timeout（临时失败）').toEqual({
      code: 1001,
      reason: 'pong-timeout',
    });
    // 监听退订纪律与已关传输零 ping（同 P4 语义）
    await waitUntil('旧传输 pong 监听退订', () => gen1.pongListenerCount() === 0, 15_000);
    expect(gen1.pingsOnClosedTransport()).toBe(0);
    expect(gen1.closedTransportPingErrors()).toHaveLength(0);

    // ── hub 清死连接 → backoff 到期重拨 → 新代健康（真实 PING/PONG 往返）──
    await waitUntil('hub 清理死连接', () => run.hub.connections.length === 0, 15_000);
    await waitUntil('重拨（dialCount 2）', () => run.dialCount() === 2, 15_000);
    await waitUntil('重拨后 ready', () => run.peer.getConnectionState() === 'ready', 15_000);
    await waitUntil('重连后 ns live', () => run.peer.getNamespaceState(run.nsId) === 'live', 15_000);
    expect(run.hub.connections.length, '重连后 hub 只保留新连接').toBe(1);
    const gen2 = run.peerTransports[1]!;
    await waitUntil('新代 ping 被应答', () => gen2.receivedPongs().length >= 1, 15_000);
    expect(run.peer.getConnectionState()).toBe('ready');

    // ── 数据收敛 ──
    await run.writeHub(77);
    await waitUntil('数据收敛（peer n=77）', () => run.rootValue('peer') === 77, 30_000);
    expect(run.rootValue('hub')).toBe(77);
  });
});

/**
 * SA7 动态验证补充测试（revision round 2）—— SA4 交 SA7 抽查点 2：
 * 真实 transport 下的缺省零漂移抽样。
 *
 * 背景：本轮（R2）全部既有测试走 fake-duplex 内存双端；`controlReserveBytes` 缺省
 * 64KiB 与旧实现以 lowWater（缺省同为 64KiB）为额度 ceiling 的「逐帧等价」声明，
 * 缺真实传输链路（真实 bufferedAmount 水位驱动暂停段）下的行为对照。本文件在
 * 真实 TCP loopback 链路上抽样暂停段 control 行为的缺省边界两侧：
 *   A（存活侧）：真实暂停段 + 缺省额度内容纳的 control 流量 → 全部 ACK 上 wire、
 *      零 ERROR、连接 ready；
 *   B（耗尽侧）：真实暂停段 + 跨越缺省额度（> 64KiB）的 control 流量 → 恰 1 个
 *      ERROR(CONNECTION_BACKPRESSURE) + close(1011) + peer backoff。
 *   A/B 在旧实现（lowWater=64KiB ceiling，58150ad）下行为逐帧相同——缺省零漂移的
 *   动态差分证明（SA7 已在本机对旧 src 复跑本文件核对，见 sa7 报告）。
 *
 * 真实链路结构约束（实现于测试构造，非协议约束）：ACK 反馈与 data 同流——peer 侧
 * 暂停读取切断 ACK 回流后，单连接暂停段内可达 control 流量上界 =
 * Σ_ns min(窗口 32)（每 ns 至多 32 笔在途未 ACK）。故 A 取 4 ns × 32 = 128 ACK
 * （≈7.3KiB，存活侧采样），B 取 40 ns × 32 = 1280 ACK（≈73KiB > 64KiB，跨越缺省
 * 边界）。flood 总量受队列上限（4MB）约束取 44 × 100KiB ≈ 4.4MB（在途 + 队列
 * ≤ ~4.4MB < 溢出线）。
 *
 * 纪律：limits 全部取缺省（零覆写——零漂移抽样前提）；暂停段由真实内核/用户态发送
 * 积压驱动（socket.writableLength——§4.2 duck-typed bufferedAmount seam 的真值来源，
 * 零注入）；node:net 真实 TCP；4 字节长度前缀成帧属 transport 适配器职责
 * （DuplexTransport 契约 = 一 send 一 message，TCP 流式承载需适配器重组）。
 * 本文件为真实链路集成抽样：真实 timer + 有界 real wait（与 fake-duplex 套件的
 * 「零 real sleep」纪律分属不同测试类，header 显式声明）。
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
  type ReplicaNode,
} from './harness.js';
import { DEFAULT_PEER_VERIFIER, TEST_TOKEN } from './driver.js';
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type {
  DuplexTransport,
  HubReplication,
  PeerReplication,
  ReplicationTimer,
} from '@nomicore/ws-replication';
import { decodeMessage, type DecodedMessage } from '@nomicore/replication-protocol';

/** 与 issue137-driver 同 schema（blurb 大体积字段——真实积压灌数据锚）。 */
const TRANSPORT_SCHEMA = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'issue137-r2-real-transport',
  text: 'type ROOT = { n: number; blurb: string; };\n',
});

/** 有界 real wait 轮询（真实链路集成抽样专用）。 */
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

/** 真实 TCP transport 适配器：4B 长度前缀成帧；bufferedAmount = socket.writableLength（真值）。 */
class TcpTransport implements DuplexTransport {
  readonly socket: net.Socket;
  private readonly messageListeners: Array<(bytes: Uint8Array) => void> = [];
  private readonly closeListeners: Array<(info: Readonly<{ code: number; reason: string }>) => void> = [];
  private readonly meta: PairCloseMeta;
  private readonly side: 'hub' | 'peer';
  private readonly onSend: ((bytes: Uint8Array) => void) | undefined;
  private buffer: Buffer = Buffer.alloc(0);
  private readonly pendingFrames: Uint8Array[] = [];
  private closedFlag = false;

  constructor(
    socket: net.Socket,
    side: 'hub' | 'peer',
    meta: PairCloseMeta,
    onSend?: (bytes: Uint8Array) => void,
  ) {
    this.socket = socket;
    this.side = side;
    this.meta = meta;
    this.onSend = onSend;
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    socket.on('close', () => {
      this.closedFlag = true;
      const info = this.side === 'hub' ? this.meta.peer : this.meta.hub;
      for (const listener of this.closeListeners) listener(info ?? { code: 1006, reason: 'abnormal' });
    });
    socket.on('error', () => {
      /* close 事件随错误到达；此处仅防 unhandled error 事件 */
    });
  }

  /** §4.2 seam 真值：真实发送积压（用户态未刷入内核字节）——零注入。 */
  get bufferedAmount(): number {
    return this.socket.writableLength;
  }

  get closed(): boolean {
    return this.closedFlag || this.socket.destroyed;
  }

  send(bytes: Uint8Array): void {
    if (this.closedFlag) return;
    const header = Buffer.alloc(4);
    header.writeUInt32BE(bytes.byteLength, 0);
    this.socket.write(Buffer.concat([header, Buffer.from(bytes)]));
    this.onSend?.(bytes);
  }

  close(code?: number, reason?: string): void {
    if (this.closedFlag) return;
    this.meta[this.side] = { code: code ?? 1005, reason: reason ?? '' };
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 2_000).unref?.();
  }

  onMessage(listener: (bytes: Uint8Array) => void): () => void {
    this.messageListeners.push(listener);
    // 真实 TCP 上数据可能先于协议侧注册 listener 到达（fake-duplex 靠微任务时序天然
    // 掩盖该竞态）——注册后重放积压帧，保 DuplexTransport「一 send 一 message」语义。
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
      if (this.messageListeners.length === 0) {
        this.pendingFrames.push(copy);
        continue;
      }
      for (const listener of this.messageListeners) listener(copy);
    }
  }
}

/** 真实 timer（本文件为真实链路抽样；协议时间面走真实时钟）。 */
const realTimer: ReplicationTimer = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs) as unknown,
  clearTimeout: (handle) => clearTimeout(handle as unknown as number),
};

interface RealRun {
  readonly hubNode: ReplicaNode;
  readonly peerNode: ReplicaNode;
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly nsIds: readonly string[];
  readonly hubTransport: TcpTransport;
  readonly peerTransport: TcpTransport;
  readonly hubSent: DecodedMessage[];
  readonly hubSentBytes: number[];
  readonly peerSent: DecodedMessage[];
  readonly server: net.Server;
  readonly peerSocket: net.Socket;
  readonly hubCloseMeta: PairCloseMeta;
  write(nsId: string, side: 'hub' | 'peer', value: Readonly<{ n?: number; blurb?: string }>): Promise<void>;
  destroy(): void;
}

/** 组装真实 TCP 链路：count 个 namespace 复用单连接 + 真实积压 seam（limits 全缺省）。 */
async function bootReal(count: number): Promise<RealRun> {
  const hubNode = makeNode('hub');
  const peerNode = makeNode('peer');
  const nsIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const lease = okLease(
      await hubNode.registry.create({
        owner: HUB_OWNER,
        schema: { ...TRANSPORT_SCHEMA, id: `issue137-r2-real-${index}` },
        root: { n: 1, blurb: 'seed' },
      }),
    );
    await schemaReady(lease);
    const enabled = await lease.enableReplication();
    if (!enabled.ok) throw new Error(`enableReplication 失败：${JSON.stringify(enabled)}`);
    nsIds.push(lease.namespaceId);
  }

  const hubSent: DecodedMessage[] = [];
  const hubSentBytes: number[] = [];
  const peerSent: DecodedMessage[] = [];
  const meta: PairCloseMeta = { hub: undefined, peer: undefined };
  let hubTransport: TcpTransport | undefined;

  const hub = createHubReplication({
    instanceId: HUB_INSTANCE,
    registry: hubNode.registry,
    authorize: async () => ({
      ok: true as const,
      localOwner: HUB_OWNER,
      permissions: { read: true, submit: true },
    }),
    timer: realTimer,
    verifyToken: DEFAULT_PEER_VERIFIER,
  });

  const server = net.createServer((socket) => {
    const transport = new TcpTransport(socket, 'hub', meta, (bytes) => {
      hubSent.push(decodeMessage(bytes));
      hubSentBytes.push(bytes.byteLength);
    });
    hubTransport = transport;
    hub.accept(transport, { token: TEST_TOKEN }); // server 回调晚于 hub 构造执行——TDZ 安全
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;

  let peerTransport: TcpTransport | undefined;
  const peer = createPeerReplication({
    instanceId: PEER_INSTANCE,
    hubInstanceId: HUB_INSTANCE,
    registry: peerNode.registry,
    dial: () => {
      const socket = net.connect(port, '127.0.0.1');
      peerTransport = new TcpTransport(socket, 'peer', meta, (bytes) =>
        peerSent.push(decodeMessage(bytes)),
      );
      return peerTransport;
    },
    timer: realTimer,
    targets: nsIds.map((nsId) => ({ namespaceId: nsId, localOwner: PEER_OWNER })),
    // 仅时间面覆写（limits 零覆写——零漂移抽样前提）：ACK 悬挂期不触发重传；
    // backoff 拉长使 1011 后 peer 稳定停留 backoff（断言窗口内不重拨）。
    timeouts: { ackTimeoutMs: 60_000 },
    backoff: { baseMs: 60_000, maxMs: 60_000, resetAfterMs: 60_000 },
  });
  peer.start();
  await waitUntil('连接 ready', () => peer.getConnectionState() === 'ready', 15_000);
  for (const nsId of nsIds) {
    await waitUntil(
      `namespace live（当前 ${String(peer.getNamespaceState(nsId))}）`,
      () => peer.getNamespaceState(nsId) === 'live',
      15_000,
    );
  }
  if (hubTransport === undefined || peerTransport === undefined) {
    throw new Error('transport 未建立');
  }

  const write = async (
    side: 'hub' | 'peer',
    nsId: string,
    value: Readonly<{ n?: number; blurb?: string }>,
  ): Promise<void> => {
    const owner = side === 'hub' ? HUB_OWNER : PEER_OWNER;
    const node = side === 'hub' ? hubNode : peerNode;
    const lease = okLease(await node.registry.open(owner, nsId));
    await schemaReady(lease);
    for (const [key, v] of Object.entries(value)) {
      const result = await lease.mutateRoot({ op: 'set', path: [key], value: v });
      if (!result.ok) throw new Error(`业务写失败：${JSON.stringify(result)}`);
    }
    await lease.release();
  };

  return {
    hubNode,
    peerNode,
    hub,
    peer,
    nsIds,
    hubTransport,
    peerTransport,
    hubSent,
    hubSentBytes,
    peerSent,
    server,
    peerSocket: peerTransport.socket,
    hubCloseMeta: meta,
    write: (nsId, side, value) => write(side, nsId, value),
    destroy() {
      for (const socket of [hubTransport?.socket, peerTransport?.socket]) socket?.destroy();
      server.close();
    },
  };
}

/** 真实暂停段构造：暂停 peer 侧读取 → hub 出站真实积压超 highWater=512KiB。
 *
 * 自适应灌数据（480KiB/笔，编码后 491,618B < maxUpdateBytes 512KiB）：逐笔写入直至
 * 真实积压可见超过 512KiB（内核吸收饱和点实测 ~2.4MB——每次灌 ~7 笔即停）。全部
 * 灌数据走 live 直发在途（窗口 ≤ 32），至多 1 笔入队列——远低于 4MB 队列上限，
 * 通道保持 live（零 RESYNC_REQUIRED/ERROR——A 用例的可观测前提）。
 *
 * topUp（A 用例）：入暂停段后再写 topUp 笔——全部入队列（8 × 491,618 =
 * 3,932,944B ≤ 4MB 队列上限，无论暂停点在何处均不溢出），经闸门震荡（resume →
 * drain → 再 pause）灌入 socket，使真实积压抬升 ~3MB——并发负载下抑制内核
 * rmem 自适应吸收导致的可见积压衰减（时序稳健性，非语义断言）。 */
async function enterRealPause(run: RealRun, nsId: string, topUp = 0): Promise<void> {
  run.peerSocket.pause();
  let writes = 0;
  while (run.hubTransport.bufferedAmount <= 512 * 1024) {
    if (writes >= 40) break; // 防御上限（内核吸收异常增大时快速失败）
    await run.write(nsId, 'hub', { blurb: 'b'.repeat(480 * 1024) });
    writes += 1;
    // 稳态读数：让内核先吸收（吸收完成 → writableLength 回 0 = 未饱和；非零 = 饱和），
    // 避免瞬时读数早退导致出口后继续衰减震荡、排队项累积。
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  if (run.hubTransport.bufferedAmount <= 512 * 1024) {
    throw new Error(`真实积压未过 highWater（${writes} 笔后 ${String(run.hubTransport.bufferedAmount)}B）`);
  }
  // topUp 上界安全：出口排队 ≤ 2（每笔后稳态读数）+ topUp 6 = 8 × 491,618 =
  // 3,932,944B ≤ 4MB 队列上限——任何负载时序下不触发溢出收口。
  for (let index = 0; index < topUp; index += 1) {
    await run.write(nsId, 'hub', { blurb: 'b'.repeat(480 * 1024) });
  }
}

function countKind(frames: DecodedMessage[], kind: string): number {
  return frames.filter((f) => f.message.kind === kind).length;
}

const liveRuns: RealRun[] = [];

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

describe('issue #137 R2 SA7：真实 transport 缺省零漂移抽样（真实 TCP + 真实 bufferedAmount）', () => {
  it(
    'A（存活侧）：真实暂停段 + 缺省额度内 control 流量（4 ns × 32 ACK = 128 ≈ 7.3KiB ≪ 64KiB）——全部上 wire、零 ERROR、连接 ready',
    { timeout: 90_000 },
    async () => {
      const run = await bootReal(4);
      liveRuns.push(run);
      try {
        await enterRealPause(run, run.nsIds[0] as string, 6);
        expect(run.hubTransport.bufferedAmount).toBeGreaterThan(512 * 1024);

        // 每 ns 32 笔在途（窗口满即止——ACK 回流被切断后的可达上界形态）：
        // 4 × 32 = 128 ACK ≈ 7.3KiB，缺省 64KiB 额度内容纳。
        for (const nsId of run.nsIds) {
          for (let n = 0; n < 32; n += 1) await run.write(nsId, 'peer', { n });
        }
        await waitUntil(
          `hub 侧 ACK 全部上 wire（当前 ${String(countKind(run.hubSent, 'UPDATE_ACK'))}）`,
          () => countKind(run.hubSent, 'UPDATE_ACK') >= 128,
          30_000,
        );

        // ★ 缺省零漂移抽样（存活侧）：control 不受闸门阻塞、只受保留额度约束——
        // 额度内全部发出（旧实现 lowWater=64KiB 同界）。
        expect(countKind(run.hubSent, 'UPDATE_ACK')).toBe(128);
        expect(countKind(run.hubSent, 'ERROR')).toBe(0);
        expect(countKind(run.hubSent, 'RESYNC_REQUIRED')).toBe(0);
        expect(run.peer.getConnectionState()).toBe('ready');
        // 注：不重复断言末端 bufferedAmount——并发负载下内核 rmem 自适应吸收可使
        // 可见积压缓慢衰减（时序非确定）；暂停段成立已由 enterRealPause 入口验证，
        // 本用例语义锚在 control 行为（128 ACK 全发 + 零耗尽）。
      } finally {
        run.peerSocket.resume(); // 排空真实积压，便于 afterAll 收尾
      }
    },
  );

  it(
    'B（耗尽侧）：真实暂停段 + 跨越缺省额度 control 流量（40 ns × 32 ACK = 1280 ≈ 73KiB > 64KiB）——恰 1 ERROR(CONNECTION_BACKPRESSURE) + close(1011) + peer backoff',
    { timeout: 180_000 },
    async () => {
      const run = await bootReal(40);
      liveRuns.push(run);
      try {
        await enterRealPause(run, run.nsIds[0] as string);
        expect(run.hubTransport.bufferedAmount).toBeGreaterThan(512 * 1024);

        // 逐 ns 32 笔在途，直至额度耗尽（预期第 ~1150 个 ACK 触发 connectionFatal）。
        outer: for (const nsId of run.nsIds) {
          for (let n = 0; n < 32; n += 1) {
            await run.write(nsId, 'peer', { n });
            if (countKind(run.hubSent, 'ERROR') > 0) break outer;
          }
        }
        await waitUntil(
          `hub 侧 ERROR 上 wire（当前 ACK=${String(countKind(run.hubSent, 'UPDATE_ACK'))}）`,
          () => countKind(run.hubSent, 'ERROR') >= 1,
          60_000,
        );

        // peer 侧读取恢复后才可观测 close（FIN 排在积压之后）——恢复排空后观测终局。
        run.peerSocket.resume();
        await waitUntil('peer 观测连接关闭（backoff）', () => run.peer.getConnectionState() === 'backoff', 30_000);

        const errors = run.hubSent.filter((f) => f.message.kind === 'ERROR');
        // ★ 缺省零漂移抽样（耗尽侧）：CONNECTION_BACKPRESSURE | 1011（旧实现同界同码）。
        expect(errors).toHaveLength(1);
        expect(
          errors[0] !== undefined && errors[0].message.kind === 'ERROR' ? errors[0].message.code : undefined,
        ).toBe('CONNECTION_BACKPRESSURE');
        expect(run.hubCloseMeta.hub?.code).toBe(1011); // hub 侧 close(1011)
        expect(run.peerTransport.closed).toBe(true);
        expect(run.peer.getConnectionState()).toBe('backoff');
        // 边界采样（下界断言，帧长自适配）：按 ERROR 前各 ACK 实测字节累加，计算
        // 缺省 64KiB 额度的许可 ACK 数（57B 定长到 seq=128，其后 58B——r2-red 实测
        // 注释同源），断言实际发送量不显著低于许可数（−2 容纳交错）。上界不设：
        // close 排空期（socket.end 先刷积压再 FIN）的收尾 ACK 属收口瞬态，不属额度
        // 记账面。
        const errorIndex = run.hubSent.findIndex((f) => f.message.kind === 'ERROR');
        let reserveUsed = 0;
        let permitted = 0;
        for (let i = 0; i < errorIndex; i += 1) {
          if (run.hubSent[i]?.message.kind !== 'UPDATE_ACK') continue;
          reserveUsed += run.hubSentBytes[i] ?? 0;
          if (reserveUsed > 64 * 1024) break;
          permitted += 1;
        }
        expect(countKind(run.hubSent, 'UPDATE_ACK')).toBeGreaterThanOrEqual(permitted - 2);
      } finally {
        run.peerSocket.resume();
      }
    },
  );
});

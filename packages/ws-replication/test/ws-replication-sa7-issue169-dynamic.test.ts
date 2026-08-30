/**
 * SA7 动态验证补充测试（issue #169）—— SA4/双轴审查移交的动态审核重点 1、2 的运行环境复核：
 *
 *  D1（重点 1：混合冲刷下控制额度过释放——设计 v5「R12 kind-aware 保守退休账本」的
 *      反向回归锚）：`observe()` 在 Δ<0 时若按 `min(|Δ|, controlUnflushed)` 无 kind
 *      归因释放策略账，则 data 字节离开 socket 也会释放控制额度——SA7 此前以
 *      「特性化测试」证实该面（v4 形状：batch2 越限放行、wire 超 quota、有界
 *      ≤ 窗口前 data 积压）。**R12 修复后本用例改为安全回归**：Δ<0 按
 *      §3.5 退休优先序（①已吸收 data → ②handoff data → ③已吸收 control →
 *      ④handoff control）消耗退休预算，控制额度释放仅由 ③+④ 退休的控制字节驱动
 *      ——data flush 绝不释放控制额度（硬不变量）。本构造下 data flush（Δ<0 =
 *      revealedData）全部被 ① 已吸收 data 候选消耗 → 零额度释放 → 窗口内恰
 *      n1 帧（至额度边缘）上线；第 n1+1 帧为首越界帧（148,293 + 16,477 =
 *      164,770 > 163,840）→ 拒纳不上 wire + 恰一次 CONNECTION_BACKPRESSURE
 *      （收口 1011 接线由红灯锚 G3a/G9 钉死）→ 终态 wire control = 148,293 ≤
 *      maxQueuedControlBytes。
 *
 *  D2（重点 2：Δ≡0 write-through-0 悬崖的数据面饱和签名，设计 §14.4 已接受面）：
 *     健康 Node 流 writableLength 写穿归 0 → 帧间有空闲间隙的低速率连接上，
 *     「上升+回落同间隙」的帧在 FIFO 留永久残差 → 单连接累计 data 纳入满 cap 后
 *     data 准入恒拒 + 恢复环再拒（RESYNC_REQUIRED 反复声明）+ UPDATE 字节平 +
 *     无 1011 / 无 close 终局信号（§13.11 饱和签名）。真实 TCP loopback 长寿命
 *     连接 + 帧间 settle 节奏 + 累计 > cap 验证该签名如期可观测。
 *
 * 纪律：D1 直构真实 ConnectionSender + 真实 OutboundQueue + 真实 codec（仅传输
 * bufferedAmount seam 与注入调度器，协议既定可注入边界）；D2 真实 node:net TCP +
 * 真实 timer + 真实 writableLength（零注入，与 ws-replication-sa7-r2-transport
 * 同类：有界 real wait 的真实链路集成抽样）。
 *
 * SA4 重点 3（真实 TCP 用例 B 耗尽点漂移）不新增代码——以既有
 * ws-replication-sa7-r2-transport.test.ts 本地复跑（含全量套件）作为证据，见
 * task_issue-169-backpressure-accounting_sa7_report.md。
 */
import * as net from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_PEER_VERIFIER, TEST_TOKEN } from './driver.js';
import { createHubReplication, createPeerReplication } from '@nomicore/ws-replication';
import type {
  DuplexTransport,
  HubReplication,
  PeerReplication,
  ReplicationLimits,
  ReplicationTimer,
} from '@nomicore/ws-replication';
import {
  decodeMessage,
  encodeMessage,
  type DecodedMessage,
  type ReplicationMessage,
} from '@nomicore/replication-protocol';
import { createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import { ConnectionSender } from '../src/backpressure.js';
import { resolveLimits } from '../src/defaults.js';
import { codecFieldLimits, OutboundQueue } from '../src/frame-io.js';
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

const NS = 'ns-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function updateFrame(payloadBytes: number): ReplicationMessage {
  return { kind: 'UPDATE', namespaceId: NS, update: new Uint8Array(payloadBytes) };
}

function bootstrapFrame(payloadBytes: number): ReplicationMessage {
  return {
    kind: 'BOOTSTRAP_SNAPSHOT',
    namespaceId: NS,
    replicationId: '1'.repeat(32),
    replicationEpoch: 1,
    snapshot: new Uint8Array(payloadBytes),
  };
}

// ═══════════════════════════ D1：混合冲刷额度过释放（seam 级确定性） ═══════════════════════════

describe('issue #169 SA7-D1（双轴 BLOCK 修复 · 设计 v5 §3.5）：data flush 绝不释放控制额度——kind-aware 退休回归', () => {
  it('D1（R12 反向回归）：data flush 后第 n1+1 控制帧（首越界）拒纳不上 wire + 恰一次 CONNECTION_BACKPRESSURE + 窗口内控制上线 ≤ maxQueuedControlBytes', () => {
    const CAP = 1024 * 1024;
    const HIGH = 8 * 1024;
    const LOW = 1024;
    const MAX_BOOTSTRAP = 16 * 1024;
    const QUOTA = 160 * 1024; // ≥ MAX_BOOTSTRAP + 128（validate 启动约束）
    const limits = resolveLimits({
      maxQueuedBytesPerConnection: CAP,
      lowWater: LOW,
      highWater: HIGH,
      maxBootstrapBytes: MAX_BOOTSTRAP,
      maxQueuedControlBytes: QUOTA,
    });

    const probe = (message: ReplicationMessage): number =>
      encodeMessage(message, {
        sequence: 1,
        maxFrameBytes: limits.maxFrameBytes,
        limits: codecFieldLimits(limits),
      }).byteLength;
    const F_CTRL = probe(bootstrapFrame(16 * 1024));
    expect(F_CTRL).toBeGreaterThan(0);
    const n1 = Math.floor(QUOTA / F_CTRL); // batch1 帧数：恰至额度边缘（9×16,477 = 148,293 ≤ QUOTA；
    //                                     // 10×16,477 = 164,770 > QUOTA——第 n1+1 帧为首越界帧）
    expect(n1, '前置：n1 ≥ 2').toBeGreaterThanOrEqual(2);

    const scheduler = createRegistryTestScheduler();
    let buffered = 0;
    let exhausted = 0;
    let emittedControlCount = 0;
    let emittedDataCount = 0;
    let wireControlBytes = 0;
    let sender!: ConnectionSender;
    const queue = new OutboundQueue(
      () => undefined,
      limits,
      () => undefined,
      (info) => {
        if (info.kind === 'control') wireControlBytes += info.byteLength;
        sender.onEmitted(info);
      },
    );
    sender = new ConnectionSender({
      limits,
      timer: scheduler,
      ackTimeoutMs: 10_000,
      readBufferedAmount: () => buffered,
      emitControl: (message) => {
        emittedControlCount += 1;
        return queue.sendControl(message);
      },
      emitData: (message) => {
        emittedDataCount += 1;
        return queue.emit(message);
      },
      facetOf: () => undefined,
      isEmitAllowed: () => true,
      onBackpressureExhausted: () => {
        exhausted += 1;
      },
    });

    // P1：窗口前 data 积压——同一同步栈 6×16KiB 直发，bufferedAmount 恒 0（滞后）。
    for (let i = 0; i < 6; i += 1) sender.tryEmitData(updateFrame(16 * 1024));
    expect(emittedDataCount, '前置：data 积压全部交接（admission ≤ CAP）').toBe(6);

    // P2：transport 仅显影吸收 60KiB（Δ>0 弹出同额 data → 退休候选 ① 累积）——FIFO 队首
    //     留下窗口前未吸收 data 积压；水位 61,440 > highWater → 进入暂停窗口
    //     （controlUnflushed=0，窗口起点重置）。
    const revealedData = 60 * 1024;
    buffered = revealedData;
    expect(sender.dataGateOpen(), '水位超 highWater → 暂停窗口').toBe(false);

    // P3：窗口内控制流 batch1——n1 帧至额度边缘（真实未冲刷控制字节 = n1×F_CTRL ≤ QUOTA）；
    //     每帧交接后 Δ>0 吸收（FIFO 弹出：剩余 data 积压耗尽后按 control chunk 归因——
    //     ③ 退休候选累积）。额度释放仅由 Δ<0 的控制退休驱动，此刻零释放。
    for (let i = 0; i < n1; i += 1) {
      sender.sendControl(bootstrapFrame(16 * 1024));
      buffered += F_CTRL; // 控制字节入 transport 缓冲（seam 与真值一致）
    }
    expect(emittedControlCount, 'batch1 恰 n1 帧上线').toBe(n1);
    expect(exhausted, '前置：batch1 未触收口').toBe(0);

    // P4：★ 混合冲刷——缓冲内 revealedData 字节的 **data** 离开 socket（控制字节一字未动）。
    //     observe() Δ<0：v5 退休优先序 ① unretiredAbsorbedData（= 60KiB 显影 + batch1
    //     Δ>0 弹出的 data）先耗尽退休预算 → ③④ 零退休 → **控制额度零释放**（R12 硬不变量；
    //     v4 无 kind 归因形状在此释放 min(|Δ|, controlUnflushed) → batch2 越限放行 → 红）。
    buffered -= revealedData;
    expect(sender.dataGateOpen(), '窗口持续（水位仍 > lowWater）').toBe(false);

    // P5：batch2——首帧（第 n1+1 个控制帧）即越界（148,293 + 16,477 = 164,770 > 163,840）
    //     拒纳：恰一次 CONNECTION_BACKPRESSURE（收口 1011 接线由红灯锚 G3a/G9 钉死）、
    //     触发帧不上 wire；窗口内控制上线字节 = n1×F_CTRL ≤ maxQueuedControlBytes。
    let n2 = 0;
    for (;;) {
      const before = emittedControlCount;
      sender.sendControl(bootstrapFrame(16 * 1024));
      if (emittedControlCount === before) break;
      buffered += F_CTRL;
      n2 += 1;
      if (n2 > 200) throw new Error('防御上限：既不受纳也不收口');
    }
    expect(exhausted, 'data flush 后首越界帧恰一次 CONNECTION_BACKPRESSURE（1011 收口面）').toBe(1);

    // ★ 反向回归断言面（v4 特性化断言 — n2>0 / wire>QUOTA — 的修复后对立面）：
    expect(n2, 'data flush 不释放控制额度——batch2 零放行').toBe(0);
    expect(emittedControlCount, '窗口内恰 n1 帧上线（第 n1+1 帧拒纳不上 wire）').toBe(n1);
    expect(wireControlBytes, '窗口内控制上线 ≤ maxQueuedControlBytes（未冲刷控制字节上限）').toBeLessThanOrEqual(QUOTA);
    expect(wireControlBytes, '精确上线 n1×F_CTRL（148,293 ≤ 163,840）').toBe(n1 * F_CTRL);
  });
});

// ═══════════════════════════ D2：Δ≡0 悬崖饱和签名（真实 TCP E2E） ═══════════════════════════

interface PairCloseMeta {
  hub: { code: number; reason: string } | undefined;
  peer: { code: number; reason: string } | undefined;
}

/** 真实 TCP transport 适配器（与 ws-replication-sa7-r2-transport 同构）：4B 长度前缀
 *  成帧；bufferedAmount = socket.writableLength（真值，零注入）。 */
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
      /* close 事件随错误到达；仅防 unhandled error 事件 */
    });
  }

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

const realTimer: ReplicationTimer = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs) as unknown,
  clearTimeout: (handle) => clearTimeout(handle as unknown as number),
};

async function waitUntil(what: string, predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) throw new Error(`waitUntil 超时（${timeoutMs}ms）：${what}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

const SATURATION_SCHEMA = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'issue169-sa7-delta-zero-cliff',
  text: 'type ROOT = { n: number; blurb: string; };\n',
});

interface SaturationRun {
  readonly hub: HubReplication;
  readonly peer: PeerReplication;
  readonly nsIds: readonly string[];
  readonly hubTransport: TcpTransport;
  readonly peerTransport: TcpTransport;
  readonly hubSent: DecodedMessage[];
  readonly hubSentBytes: number[];
  readonly server: net.Server;
  readonly peerSocket: net.Socket;
  readonly hubCloseMeta: PairCloseMeta;
  write(nsId: string, side: 'hub' | 'peer', value: Readonly<{ n?: number; blurb?: string }>): Promise<void>;
  destroy(): void;
}

async function bootSaturation(limits: Readonly<Partial<ReplicationLimits>>): Promise<SaturationRun> {
  const hubNode: ReplicaNode = makeNode('hub');
  const peerNode: ReplicaNode = makeNode('peer');
  const lease = okLease(
    await hubNode.registry.create({
      owner: HUB_OWNER,
      schema: SATURATION_SCHEMA,
      root: { n: 1, blurb: 'seed' },
    }),
  );
  await schemaReady(lease);
  const enabled = await lease.enableReplication();
  if (!enabled.ok) throw new Error(`enableReplication 失败：${JSON.stringify(enabled)}`);
  const nsIds = [lease.namespaceId];

  const hubSent: DecodedMessage[] = [];
  const hubSentBytes: number[] = [];
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
    limits,
  });

  const server = net.createServer((socket) => {
    const transport = new TcpTransport(socket, 'hub', meta, (bytes) => {
      hubSent.push(decodeMessage(bytes));
      hubSentBytes.push(bytes.byteLength);
    });
    hubTransport = transport;
    void hub.accept(transport, { token: TEST_TOKEN });
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
      peerTransport = new TcpTransport(socket, 'peer', meta);
      return peerTransport;
    },
    timer: realTimer,
    targets: nsIds.map((nsId) => ({ namespaceId: nsId, localOwner: PEER_OWNER })),
    limits,
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
    const target = okLease(await node.registry.open(owner, nsId));
    await schemaReady(target);
    for (const [key, v] of Object.entries(value)) {
      const result = await target.mutateRoot({ op: 'set', path: [key], value: v });
      if (!result.ok) throw new Error(`业务写失败：${JSON.stringify(result)}`);
    }
    await target.release();
  };

  return {
    hub,
    peer,
    nsIds,
    hubTransport,
    peerTransport,
    hubSent,
    hubSentBytes,
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

function countKind(frames: DecodedMessage[], kind: string): number {
  return frames.filter((f) => f.message.kind === kind).length;
}

function updateWireBytes(run: SaturationRun): number {
  let total = 0;
  for (let i = 0; i < run.hubSent.length; i += 1) {
    if (run.hubSent[i]?.message.kind === 'UPDATE') total += run.hubSentBytes[i] ?? 0;
  }
  return total;
}

const liveRuns: SaturationRun[] = [];

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

describe('issue #169 SA7-D2（SA4 动态重点 2）：Δ≡0 write-through-0 悬崖——真实 TCP 长寿命连接饱和签名', () => {
  it(
    'D2：帧间 settle 节奏下累计 data 超过 cap → data 准入恒拒（RESYNC_REQUIRED 恢复环）/ UPDATE 字节平 / 零 1011、零 close（无终局信号）',
    { timeout: 180_000 },
    async () => {
      const CAP = 1024 * 1024; // highWater 缺省 512KiB ≤ CAP（validate 链式不变量）
      const run = await bootSaturation({ maxQueuedBytesPerConnection: CAP });
      liveRuns.push(run);
      const nsId = run.nsIds[0] as string;
      const BLOB = 64 * 1024;

      // Δ≡0 节奏：每帧后等 writableLength 写穿归 0 再写下一帧（低速率连接的
      // 帧间空闲间隙——「上升+回落同间隙」→ FIFO 永久残差）。
      for (let i = 0; i < 40; i += 1) {
        await run.write(nsId, 'hub', { blurb: 'b'.repeat(BLOB) });
        if (countKind(run.hubSent, 'RESYNC_REQUIRED') > 0) break;
        await waitUntil('帧间 settle（writableLength 写穿归 0）', () => run.hubTransport.bufferedAmount === 0, 5_000);
        await new Promise<void>((resolve) => setTimeout(resolve, 15));
      }
      await waitUntil('首个 RESYNC_REQUIRED（饱和到达）', () => countKind(run.hubSent, 'RESYNC_REQUIRED') >= 1, 20_000);
      await waitUntil('socket 排空（悬崖面：预算耗尽时 socket 实际为空）', () => run.hubTransport.bufferedAmount === 0, 10_000);

      // 饱和签名 ①：预算耗尽纯粹来自「已交付字节」——peer 实收 UPDATE 字节 > cap − 单帧
      //   （若记账正确，socket 已排空 + 队列空 → projected ≈ 0，新帧应放行）。
      const delivered = updateWireBytes(run);
      expect(delivered, '累计已交付 UPDATE 字节 ≈ cap（残差泄漏耗尽预算）').toBeGreaterThan(CAP - 70 * 1024);
      expect(run.hubTransport.bufferedAmount, '悬崖面：socket 实际为空（Δ≡0）').toBe(0);

      // 饱和签名 ②：恢复环再拒——peer 收 RESYNC_REQUIRED 发起新 round，round 完成后
      //   新写仍恒拒（残差不随恢复清除）→ RESYNC_REQUIRED 反复声明（storm）。
      for (let k = 0; k < 6 && countKind(run.hubSent, 'RESYNC_REQUIRED') < 2; k += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 400));
        await run.write(nsId, 'hub', { blurb: 'c'.repeat(BLOB) });
      }
      await waitUntil('RESYNC_REQUIRED ≥ 2（恢复环再拒——单调升）', () => countKind(run.hubSent, 'RESYNC_REQUIRED') >= 2, 45_000);

      // 饱和签名 ③：UPDATE 字节平——饱和后新写不再上 wire（needs-resync 丢弃 + 恒拒）。
      const flatBase = updateWireBytes(run);
      await run.write(nsId, 'hub', { blurb: 'd'.repeat(BLOB) });
      await new Promise<void>((resolve) => setTimeout(resolve, 1_500));
      expect(updateWireBytes(run) - flatBase, 'UPDATE 字节平（新写零交付）').toBeLessThanOrEqual(4 * 1024);

      // 饱和签名 ④：无终局信号——无 ERROR / 无 close(1011) / 连接保持 ready
      //   （设计 §14.4 已接受面：#164 为上线前置，非本轮修复面）。
      expect(countKind(run.hubSent, 'ERROR'), '悬崖面无 ERROR').toBe(0);
      expect(run.hubCloseMeta.hub, '悬崖面无 close(1011) 终局信号').toBeUndefined();
      expect(run.peer.getConnectionState(), '连接保持 ready（锁死而非收口）').toBe('ready');
    },
  );
});

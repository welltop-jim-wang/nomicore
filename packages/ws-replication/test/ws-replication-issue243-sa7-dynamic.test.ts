/**
 * issue #243（slice 2）SA7 动态验证补充 —— 发送端 transfer 状态机与接收端 detached
 * assembly 的**跳点级**中间值/状态转换驱动（设计 §7 DD-3/DD-4；SA6 契约 §12 A1–A3）。
 *
 * 既有 K0–K15 / ac-red / real-transport 为黑盒 wire/observer/saveDoc 证据；本文件以
 * 包内单点驱动（`UpdateChannel` + `UpdateChunkAssembler`，测试侧 fake host——与
 * issue169 背压套件同款 `../src/*` 直引纪律）补齐黑盒面不可观察的关键中间跳点：
 *
 *  - S1 发送 transfer 全程：载体守恒（queued[0] 保持至末 chunk）、中间 chunk 零
 *    inFlight/零 timer/零 update-sent、末 chunk 槽位 1→1 转换（effectiveInFlight
 *    恒 ≤ max、裸 inFlight 恒 ≤ max）、update-sent{末序,totalBytes} 恰一、ACK 结算
 *    update-acked{bytes=totalBytes, sequence=末序}；
 *  - S2 transferId 单调不复用（同通道第二笔 = 2）；
 *  - S3 对端声明（markResyncReceived）中途终止：载体随队列消失、needsResync 期
 *    deliver 丢弃、恢复后新 transferId 从 offset 0 整笔重切；
 *  - S4 ack-timeout 中途弃置（F6）：abortedTransfer=true 上抛、载体保留（v1 冻结
 *    队列语义）、恢复后新 transferId 整笔重切；
 *  - S5 无 transfer 的 ack-timeout：abortedTransfer=false；迟至 ACK → zombie；
 *  - S6 未协商 v1 双窗口负控（F1）：deliver 时刻直发超限分支——队列空 = 响亮
 *    send-failed{update-too-large}；队列非空 = F4 静默 + update-dropped{update-too-large}，
 *    排队项 FIFO 照发；
 *  - S7 teardown（连接收口）transferId 归 1（新作用域）；
 *  - S8 有效占用口径：窗口满（maxInFlightUpdates=1 ∧ 直发在途）时新 transfer 不
 *    初始化（pullAndSendOne false、零 chunk），ACK 空位后 transfer 才启动；
 *  - A* 接收 assembly：首 chunk 上界/几何校验全部分配前（违例后 idle——零分配残留）、
 *    严格递增/跨帧一致/Σ 精确核对、单 chunk 收齐、busy 路径违例保持 busy 至
 *    控制器 reset（违例处置 = 控制器终局 + clearInboundAssembly）。
 *
 * 纪律：纯单元驱动（真实 src 模块 + fake host）；零 real sleep、零随机、零源码 grep
 * 断言；不触碰生产代码。
 */
import { describe, expect, it } from 'vitest';
import { UpdateChannel, type UpdateChannelHost } from '../src/update-channel.js';
import { UpdateChunkAssembler, chunkBounds, chunkCountOf } from '../src/update-transfer.js';
import { resolveLimits } from '../src/defaults.js';
import type {
  ReplicationLimits,
  ResolvedLimits,
  UpdateSendFailureDetail,
} from '../src/types.js';

// ═══════════════════════════ 测试侧 fake host（全部回调记账） ═══════════════════════════

interface HostLog {
  updates: Array<Readonly<{ bytes: Uint8Array; seq: number }>>;
  chunks: Array<Readonly<{ transferId: number; chunkIndex: number; chunkCount: number; totalBytes: number; bytes: Uint8Array; seq: number }>>;
  declarations: Array<Readonly<{ cause: 'queue-overflow' | 'send-failed'; detail?: UpdateSendFailureDetail }>>;
  dropped: UpdateSendFailureDetail[];
  pendingResync: number;
  ackTimeouts: boolean[];
  acked: Array<Readonly<{ bytes: number; sequence: number }>>;
  sent: Array<Readonly<{ sequence: number; bytes: number }>>;
  timerArmed: number;
  timerCleared: number;
  dataQueued: number;
  drainRequests: number;
}

interface FakeHostOptions {
  limits?: Readonly<Partial<ReplicationLimits>>;
  negotiated?: boolean;
  gateOpen?: boolean;
}

function makeChannelHost(opts: FakeHostOptions = {}): {
  host: UpdateChannelHost;
  log: HostLog;
  setNegotiated(value: boolean): void;
  setGateOpen(value: boolean): void;
  limits: ResolvedLimits;
} {
  const limits = resolveLimits({
    maxUpdateBytes: 1024,
    maxChunkedUpdateBytes: 4096,
    maxInFlightUpdates: 2,
    maxQueuedUpdateCount: 100,
    maxQueuedUpdateBytes: 1024 * 1024,
    ...opts.limits,
  });
  let negotiated = opts.negotiated ?? true;
  let gateOpen = opts.gateOpen ?? true;
  let nextSeq = 0;
  const log: HostLog = {
    updates: [],
    chunks: [],
    declarations: [],
    dropped: [],
    pendingResync: 0,
    ackTimeouts: [],
    acked: [],
    sent: [],
    timerArmed: 0,
    timerCleared: 0,
    dataQueued: 0,
    drainRequests: 0,
  };
  const host: UpdateChannelHost = {
    limits,
    ackTimeoutMs: 60_000,
    sendUpdateFrame: (bytes) => {
      nextSeq += 1;
      log.updates.push({ bytes, seq: nextSeq });
      return nextSeq;
    },
    sendUpdateChunkFrame: (chunk) => {
      nextSeq += 1;
      log.chunks.push({ ...chunk, seq: nextSeq });
      return nextSeq;
    },
    chunkedSendEnabled: () => negotiated,
    declareLocalResync: (cause, failureDetail) => {
      const detail = failureDetail?.();
      log.declarations.push(detail === undefined ? { cause } : { cause, detail });
    },
    noteUpdateDropped: (detail) => {
      log.dropped.push(detail());
    },
    notePendingResync: () => {
      log.pendingResync += 1;
    },
    onAckTimeout: (abortedTransfer) => {
      log.ackTimeouts.push(abortedTransfer);
    },
    onUpdateAcked: (info) => {
      log.acked.push({ bytes: info.bytes, sequence: info.sequence });
    },
    noteUpdateSent: (info) => {
      log.sent.push({ sequence: info.sequence, bytes: info.bytes });
    },
    armTimer: () => {
      log.timerArmed += 1;
      return {};
    },
    clearTimer: () => {
      log.timerCleared += 1;
    },
    dataGateOpen: () => gateOpen,
    onDataQueued: () => {
      log.dataQueued += 1;
    },
    requestDataDrain: () => {
      log.drainRequests += 1;
    },
  };
  return {
    host,
    log,
    limits,
    setNegotiated: (value) => {
      negotiated = value;
    },
    setGateOpen: (value) => {
      gateOpen = value;
    },
  };
}

/** 3 chunk 载荷（3000B，maxUpdateBytes=1024 → chunkCount=3）。 */
function bigPayload(size = 3000): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = i % 251;
  return bytes;
}

// ═══════════════════════════ S*：发送端 transfer 状态机（DD-3） ═══════════════════════════

describe('SA7 issue #243 发送端 transfer 状态机（UpdateChannel 跳点级驱动）', () => {
  it('S1：协商超限项改道入队（零直发）→ 逐 chunk 出站（载体守恒/中间零记账/末 chunk 槽位 1→1/单 update-sent/ACK 结算）', () => {
    const { host, log } = makeChannelHost();
    const channel = new UpdateChannel(host);
    const payload = bigPayload();

    // 入口：live 直发窗口有空位 ∧ 闸门开 ∧ chunkable → 不进直发，改道入有界队列并请求 drain
    channel.deliver(payload, 'live');
    expect(log.updates, '零 UPDATE 直发（改道）').toHaveLength(0);
    expect(log.chunks).toHaveLength(0);
    expect(channel.queuedCount).toBe(1);
    expect(channel.queuedBytes).toBe(3000);
    expect(log.drainRequests, 'chunkable 入队后单点 drain 请求（DD-3.3）').toBe(1);
    expect(log.dataQueued).toBe(1);

    // chunk 0（中间 chunk）
    expect(channel.pullAndSendOne()).toBe(true);
    expect(log.chunks).toHaveLength(1);
    const c0 = log.chunks[0]!;
    expect(c0.transferId).toBe(1);
    expect(c0.chunkIndex).toBe(0);
    expect(c0.chunkCount).toBe(3);
    expect(c0.totalBytes).toBe(3000);
    expect(c0.bytes.byteLength).toBe(1024);
    expect(c0.bytes).toEqual(payload.subarray(0, 1024));
    // 载体守恒：transfer 进行中队首载体不移出（queued[0] === 载体项；R4 保守记账）
    expect(channel.queuedCount).toBe(1);
    expect(channel.queuedBytes).toBe(3000);
    // 中间 chunk 零 inFlight / 零 timer / 零 update-sent；有效占用 = 1（transfer 槽）
    expect(channel.inFlightCount).toBe(0);
    expect(channel.effectiveInFlightCount()).toBe(1);
    expect(log.timerArmed).toBe(0);
    expect(log.sent).toHaveLength(0);

    // chunk 1（中间 chunk）——每帧独立 sequence（host 分配 2）
    expect(channel.pullAndSendOne()).toBe(true);
    const c1 = log.chunks[1]!;
    expect(c1.seq).toBe(2);
    expect(c1.chunkIndex).toBe(1);
    expect(c1.bytes.byteLength).toBe(1024);
    expect(channel.queuedCount).toBe(1);
    expect(channel.effectiveInFlightCount()).toBe(1);
    expect(log.sent).toHaveLength(0);

    // chunk 2（末 chunk）：载体出队 + inFlight 注册 + update-sent 恰一 + timer 武装
    expect(channel.pullAndSendOne()).toBe(true);
    const c2 = log.chunks[2]!;
    expect(c2.seq).toBe(3);
    expect(c2.chunkIndex).toBe(2);
    expect(c2.bytes.byteLength).toBe(952);
    expect(c2.bytes).toEqual(payload.subarray(2048));
    expect(channel.queuedCount, '末 chunk 出站才 shift 载体').toBe(0);
    expect(channel.queuedBytes).toBe(0);
    // 槽位 1→1：transfer 槽 → inFlight 条目；任意时刻 ≤ maxInFlightUpdates（=2）
    expect(channel.inFlightCount).toBe(1);
    expect(channel.effectiveInFlightCount()).toBe(1);
    expect(channel.inFlight.get(3)!.bytes, 'inFlight 条目 bytes = totalBytes').toBe(3000);
    expect(log.sent, '末 chunk 恰一次 update-sent').toHaveLength(1);
    expect(log.sent[0]!).toEqual({ sequence: 3, bytes: 3000 });
    expect(log.timerArmed).toBe(1);

    // ACK 结算（关联键 = 末 chunk 帧序）
    expect(channel.onAck(3)).toBe('ok');
    expect(log.acked).toEqual([{ bytes: 3000, sequence: 3 }]);
    expect(channel.effectiveInFlightCount()).toBe(0);
    expect(log.timerCleared).toBe(1);
  });

  it('S2：transferId 单调不复用（同通道第二笔 = 2；needs-resync/结算不复位）', () => {
    const { host, log } = makeChannelHost();
    const channel = new UpdateChannel(host);
    for (let round = 1; round <= 2; round += 1) {
      channel.deliver(bigPayload(), 'live');
      for (let i = 0; i < 3; i += 1) channel.pullAndSendOne();
      const lastSeq = log.chunks.at(-1)!.seq;
      expect(channel.onAck(lastSeq)).toBe('ok');
      expect(log.chunks.filter((c) => c.transferId === round).length).toBe(3);
    }
    expect(new Set(log.chunks.map((c) => c.transferId))).toEqual(new Set([1, 2]));
  });

  it('S3：对端声明（markResyncReceived）中途终止——载体随队列消失、needsResync 期 deliver 丢弃、恢复后新 transferId 从 offset 0 整笔重切', () => {
    const { host, log } = makeChannelHost();
    const channel = new UpdateChannel(host);
    const payload = bigPayload();
    channel.deliver(payload, 'live');
    expect(channel.pullAndSendOne()).toBe(true); // chunk 0 出站（transfer 进行中）

    channel.markResyncReceived(); // DD-3.7 路径 3：discardQueued 单点清 transfer
    expect(channel.queuedCount, '载体随队列消失').toBe(0);
    expect(channel.queuedBytes).toBe(0);
    expect(channel.needsResync).toBe(true);
    expect(channel.effectiveInFlightCount(), 'needsResync ⇒ 无 activeTransfer（F2 不变量）').toBe(0);

    // needs-resync 期间新交付直接丢弃（§10.1 首行）
    channel.deliver(bigPayload(500), 'live');
    expect(channel.queuedCount).toBe(0);
    expect(log.updates).toHaveLength(0);

    // 恢复（resetForLive）→ 新交付 → 新 transferId（2）从 offset 0 整笔重切
    channel.resetForLive();
    channel.deliver(payload, 'live');
    for (let i = 0; i < 3; i += 1) expect(channel.pullAndSendOne()).toBe(true);
    const retry = log.chunks.filter((c) => c.transferId === 2);
    expect(retry.map((c) => c.chunkIndex)).toEqual([0, 1, 2]);
    expect(retry[0]!.bytes).toEqual(payload.subarray(0, 1024));
    expect(retry.reduce((s, c) => s + c.bytes.byteLength, 0)).toBe(3000);
    expect(channel.queuedCount).toBe(0);
  });

  it('S4：ack-timeout 中途弃置（F6）——abortedTransfer=true 上抛、载体保留（v1 冻结队列）、恢复后新 transferId 整笔重切', () => {
    const { host, log } = makeChannelHost();
    const channel = new UpdateChannel(host);
    const payload = bigPayload();
    channel.deliver(payload, 'live');
    expect(channel.pullAndSendOne()).toBe(true); // chunk 0 出站（transfer 在场、无 inFlight）

    channel.abandonInFlight(); // ack-timer 体路径（DD-3.7 显式清除）
    expect(log.ackTimeouts, '中止信号 = transfer 在场判定（结构门）').toEqual([true]);
    expect(channel.queuedCount, '载体保留 queued[0]——不得 discardQueued（v1 语义）').toBe(1);
    expect(channel.queuedBytes).toBe(3000);
    expect(channel.needsResync).toBe(true);

    channel.resetForLive();
    for (let i = 0; i < 3; i += 1) expect(channel.pullAndSendOne()).toBe(true);
    const retry = log.chunks.filter((c) => c.transferId === 2);
    expect(retry.map((c) => c.chunkIndex)).toEqual([0, 1, 2]);
    expect(retry.reduce((s, c) => s + c.bytes.byteLength, 0)).toBe(3000);
    const lastSeq = retry.at(-1)!.seq;
    expect(channel.onAck(lastSeq)).toBe('ok');
    expect(channel.effectiveInFlightCount()).toBe(0);
  });

  it('S5：无 transfer 的 ack-timeout——abortedTransfer=false；迟至 ACK → zombie（v1 原体）', () => {
    const { host, log } = makeChannelHost();
    const channel = new UpdateChannel(host);
    channel.deliver(bigPayload(500), 'live'); // 限内直发（inFlight seq=1）
    expect(log.updates).toHaveLength(1);
    channel.abandonInFlight();
    expect(log.ackTimeouts).toEqual([false]);
    expect(channel.onAck(1)).toBe('zombie');
  });

  it('S6：未协商 v1 双窗口负控（F1）——deliver 时刻超限判定：队列空 = send-failed{update-too-large} 响亮；队列非空 = F4 静默 + update-dropped、排队项照发', () => {
    const { host, log } = makeChannelHost({ negotiated: false });
    const channel = new UpdateChannel(host);

    // (a) 队列空窗口：直发时刻超限 → 丢弃 + needs-resync + send-failed 声明（v1 同刻同形）
    channel.deliver(bigPayload(), 'live');
    expect(log.updates).toHaveLength(0);
    expect(log.chunks).toHaveLength(0);
    expect(channel.queuedCount).toBe(0);
    expect(channel.needsResync).toBe(true);
    expect(log.declarations).toHaveLength(1);
    expect(log.declarations[0]!.cause).toBe('send-failed');
    expect(log.declarations[0]!.detail!.reason).toBe('update-too-large');

    // (b) 混合队列窗口（drain 时刻等价形态）：闸门关先积压一项，再超限写 → F4 静默丢弃
    const fresh = makeChannelHost({ negotiated: false });
    const channel2 = new UpdateChannel(fresh.host);
    fresh.setGateOpen(false);
    channel2.deliver(bigPayload(500), 'live'); // 闸门关 → 入队
    expect(channel2.queuedCount).toBe(1);
    fresh.setGateOpen(true);
    channel2.deliver(bigPayload(), 'live'); // 闸门开 ∧ 窗口空 ∧ ¬chunkable → 直发 → 超限
    expect(fresh.log.dropped.map((d) => d.reason)).toEqual(['update-too-large']);
    expect(fresh.log.declarations, 'F4 静默——零 resync 声明').toHaveLength(0);
    expect(channel2.queuedCount, '排队项存活（FIFO 照发）').toBe(1);
    expect(channel2.pullAndSendOne()).toBe(true);
    expect(fresh.log.updates).toHaveLength(1);
    expect(fresh.log.chunks).toHaveLength(0);
    expect(channel2.queuedCount).toBe(0);
  });

  it('S7：teardown（连接收口）transferId 归 1（新作用域，ADR 0013:32）', () => {
    const { host, log } = makeChannelHost();
    const channel = new UpdateChannel(host);
    channel.deliver(bigPayload(), 'live');
    for (let i = 0; i < 3; i += 1) channel.pullAndSendOne();
    expect(channel.onAck(log.chunks.at(-1)!.seq)).toBe('ok');
    channel.teardown();
    expect(channel.queuedCount).toBe(0);
    expect(channel.needsResync).toBe(true);
    channel.resetForLive();
    channel.deliver(bigPayload(), 'live');
    expect(channel.pullAndSendOne()).toBe(true);
    expect(log.chunks.at(-1)!.transferId).toBe(1);
  });

  it('S8：有效占用口径（DD-3.4 ③b）——窗口满（maxInFlightUpdates=1 ∧ 直发在途）时新 transfer 不初始化，ACK 空位后才启动', () => {
    const { host, log } = makeChannelHost({ limits: { maxInFlightUpdates: 1 } });
    const channel = new UpdateChannel(host);
    channel.deliver(bigPayload(500), 'live'); // 直发（窗口 1/1，inFlight seq=1）
    expect(log.updates).toHaveLength(1);
    expect(channel.effectiveInFlightCount()).toBe(1);

    channel.deliver(bigPayload(), 'live'); // chunkable → 窗口满 → 入队（零直发）
    expect(channel.queuedCount).toBe(1);
    expect(log.chunks).toHaveLength(0);
    expect(channel.pullAndSendOne(), '窗口前置拒绝——transfer 不初始化').toBe(false);
    expect(log.chunks).toHaveLength(0);
    expect(channel.effectiveInFlightCount(), '无 transfer 时有效口径 ≡ 裸口径').toBe(1);

    expect(channel.onAck(1)).toBe('ok'); // 空位释放（并触发 drain 请求）
    expect(channel.pullAndSendOne()).toBe(true); // transfer 启动：chunk 0
    expect(log.chunks).toHaveLength(1);
    expect(channel.effectiveInFlightCount()).toBe(1); // 0 inFlight + 1 transfer 槽
    for (let i = 0; i < 2; i += 1) expect(channel.pullAndSendOne()).toBe(true);
    expect(channel.inFlightCount).toBe(1);
    expect(channel.effectiveInFlightCount(), '末 chunk 槽位 1→1（恒 ≤ max=1）').toBe(1);
    expect(channel.onAck(log.chunks.at(-1)!.seq)).toBe('ok');
  });
});

// ═══════════════════════════ A*：接收端 detached assembly（DD-4/D1） ═══════════════════════════

const ASM_LIMITS = { maxUpdateBytes: 1024, maxChunkedUpdateBytes: 4096 } as const;

function piece(over: Partial<{ transferId: number; chunkIndex: number; chunkCount: number; totalBytes: number; size: number }>) {
  return {
    transferId: over.transferId ?? 1,
    chunkIndex: over.chunkIndex ?? 0,
    chunkCount: over.chunkCount ?? 3,
    totalBytes: over.totalBytes ?? 3000,
    bytes: new Uint8Array(over.size ?? 1024),
  };
}

describe('SA7 issue #243 接收端 detached assembly（UpdateChunkAssembler 跳点级驱动）', () => {
  it('A1：切片几何纯函数（单一事实源）——ceil 计数与半开区间边界', () => {
    expect(chunkCountOf(3000, 1024)).toBe(3);
    expect(chunkCountOf(3072, 1024)).toBe(3);
    expect(chunkCountOf(1, 1024)).toBe(1);
    expect(chunkBounds(3000, 1024, 0)).toEqual({ start: 0, end: 1024 });
    expect(chunkBounds(3000, 1024, 2)).toEqual({ start: 2048, end: 3000 });
    expect(chunkBounds(3072, 1024, 2)).toEqual({ start: 2048, end: 3072 });
  });

  it('A2：首 chunk 上界校验先于分配（D1）——totalBytes > maxChunkedUpdateBytes → TOO_LARGE、assembly 保持 idle', () => {
    const asm = new UpdateChunkAssembler(ASM_LIMITS);
    const r = asm.accept(piece({ totalBytes: 4097, chunkCount: 5, size: 1024 }));
    expect(r).toEqual({ outcome: 'violation', code: 'UPDATE_TRANSFER_TOO_LARGE' });
    expect(asm.busy).toBe(false);
  });

  it('A3：几何一致性校验（totalBytes ≤ chunkCount × maxUpdateBytes）——违例 → VIOLATION、零分配；上界校验（#4）先于几何（#5）', () => {
    const asm = new UpdateChunkAssembler(ASM_LIMITS);
    const r = asm.accept(piece({ totalBytes: 4096, chunkCount: 2, size: 1024 })); // 2×1024 < 4096 ∧ ≤ maxChunked
    expect(r).toEqual({ outcome: 'violation', code: 'UPDATE_TRANSFER_VIOLATION' });
    expect(asm.busy).toBe(false);
    // 双违例组态（totalBytes 同时超 maxChunkedUpdateBytes ∧ 几何不符）→ 校验序 #4 先于 #5
    const both = new UpdateChunkAssembler(ASM_LIMITS);
    expect(both.accept(piece({ totalBytes: 5000, chunkCount: 2, size: 1024 }))).toEqual({
      outcome: 'violation',
      code: 'UPDATE_TRANSFER_TOO_LARGE',
    });
    expect(both.busy).toBe(false);
  });

  it('A4：首 chunk bytes > maxUpdateBytes → VIOLATION（连接 decode 不传 FieldLimits 的手工判）', () => {
    const asm = new UpdateChunkAssembler(ASM_LIMITS);
    expect(asm.accept(piece({ size: 1025 }))).toEqual({ outcome: 'violation', code: 'UPDATE_TRANSFER_VIOLATION' });
    expect(asm.busy).toBe(false);
  });

  it('A5：totalBytes < 1 → VIOLATION、零分配', () => {
    const asm = new UpdateChunkAssembler(ASM_LIMITS);
    expect(asm.accept(piece({ totalBytes: 0, chunkCount: 1, size: 1 }))).toEqual({
      outcome: 'violation',
      code: 'UPDATE_TRANSFER_VIOLATION',
    });
    expect(asm.busy).toBe(false);
  });

  it('A6：3-chunk 重组 happy path——严格递增追加、收齐 Σ 精确核对、complete 后回 idle 可接纳新 transfer', () => {
    const asm = new UpdateChunkAssembler(ASM_LIMITS);
    const a = new Uint8Array(1024).fill(0xaa);
    const b = new Uint8Array(1024).fill(0xbb);
    const c = new Uint8Array(952).fill(0xcc);
    expect(asm.accept({ transferId: 7, chunkIndex: 0, chunkCount: 3, totalBytes: 3000, bytes: a })).toEqual({ outcome: 'more' });
    expect(asm.busy).toBe(true);
    expect(asm.accept({ transferId: 7, chunkIndex: 1, chunkCount: 3, totalBytes: 3000, bytes: b })).toEqual({ outcome: 'more' });
    const done = asm.accept({ transferId: 7, chunkIndex: 2, chunkCount: 3, totalBytes: 3000, bytes: c });
    expect(done.outcome).toBe('complete');
    if (done.outcome !== 'complete') return;
    expect(done.bytes.byteLength).toBe(3000);
    expect(done.bytes.subarray(0, 1024)).toEqual(a);
    expect(done.bytes.subarray(1024, 2048)).toEqual(b);
    expect(done.bytes.subarray(2048)).toEqual(c);
    expect(asm.busy, 'complete 后回 idle（apply 前缓冲已交出）').toBe(false);
    // idle 后新 transfer 首_chunk 正常接纳（旧 assembly 无残留在场）
    expect(asm.accept({ transferId: 8, chunkIndex: 0, chunkCount: 1, totalBytes: 10, bytes: new Uint8Array(10) }).outcome).toBe('complete');
  });

  it('A7：busy 跨帧规则——transferId/totalBytes/chunkCount 漂移、跳号、重复、越界 overrun 均 VIOLATION（busy 保持至控制器 reset）', () => {
    const base = { transferId: 7, chunkCount: 3, totalBytes: 3000 };
    const start = (asm: UpdateChunkAssembler) =>
      asm.accept({ ...base, chunkIndex: 0, bytes: new Uint8Array(1024) });

    const drift = (mutate: (f: { transferId: number; chunkIndex: number; chunkCount: number; totalBytes: number; bytes: Uint8Array }) => void) => {
      const asm = new UpdateChunkAssembler(ASM_LIMITS);
      expect(start(asm).outcome).toBe('more');
      const frame = { ...base, chunkIndex: 1, bytes: new Uint8Array(1024) };
      mutate(frame);
      return { result: asm.accept(frame), asm };
    };

    expect(drift((f) => { f.transferId = 8; }).result).toEqual({ outcome: 'violation', code: 'UPDATE_TRANSFER_VIOLATION' });
    expect(drift((f) => { f.totalBytes = 2999; }).result).toEqual({ outcome: 'violation', code: 'UPDATE_TRANSFER_VIOLATION' });
    expect(drift((f) => { f.chunkCount = 4; }).result).toEqual({ outcome: 'violation', code: 'UPDATE_TRANSFER_VIOLATION' });
    expect(drift((f) => { f.chunkIndex = 2; }).result).toEqual({ outcome: 'violation', code: 'UPDATE_TRANSFER_VIOLATION' }); // 跳号
    const dup = new UpdateChunkAssembler(ASM_LIMITS);
    expect(start(dup).outcome).toBe('more');
    expect(dup.accept({ ...base, chunkIndex: 0, bytes: new Uint8Array(1024) }).outcome).toBe('violation'); // 重复（busy ∧ 同 id 重复首 chunk）
    expect(dup.busy).toBe(true);
    const overrun = new UpdateChunkAssembler(ASM_LIMITS);
    expect(
      overrun.accept({ transferId: 7, chunkIndex: 0, chunkCount: 2, totalBytes: 2000, bytes: new Uint8Array(1024) }).outcome,
    ).toBe('more');
    expect(
      overrun.accept({ transferId: 7, chunkIndex: 1, chunkCount: 2, totalBytes: 2000, bytes: new Uint8Array(1024) }),
      'receivedBytes + len > totalBytes（1024+1024 > 2000）→ VIOLATION',
    ).toEqual({ outcome: 'violation', code: 'UPDATE_TRANSFER_VIOLATION' });
    const overLimit = new UpdateChunkAssembler(ASM_LIMITS);
    expect(start(overLimit).outcome).toBe('more');
    expect(
      overLimit.accept({ ...base, chunkIndex: 1, bytes: new Uint8Array(1025) }).outcome,
      'busy 路径 per-chunk ≤ maxUpdateBytes',
    ).toBe('violation');
    // busy 违例后状态保持（处置 = 控制器 transferViolation → 终局 + clearInboundAssembly）
    expect(drift((f) => { f.transferId = 9; }).asm.busy).toBe(true);
  });

  it('A8：收齐时 Σ ≠ totalBytes → VIOLATION 且 assembly 复位（短申报收口）', () => {
    const asm = new UpdateChunkAssembler(ASM_LIMITS);
    expect(asm.accept({ transferId: 3, chunkIndex: 0, chunkCount: 2, totalBytes: 2048, bytes: new Uint8Array(1024) }).outcome).toBe('more');
    const r = asm.accept({ transferId: 3, chunkIndex: 1, chunkCount: 2, totalBytes: 2048, bytes: new Uint8Array(500) });
    expect(r).toEqual({ outcome: 'violation', code: 'UPDATE_TRANSFER_VIOLATION' });
    expect(asm.busy, 'Σ 不符 → reset（不残留半成品）').toBe(false);
  });

  it('A9：单 chunk transfer（chunkCount=1）首帧即收齐', () => {
    const asm = new UpdateChunkAssembler(ASM_LIMITS);
    const r = asm.accept({ transferId: 5, chunkIndex: 0, chunkCount: 1, totalBytes: 100, bytes: new Uint8Array(100).fill(7) });
    expect(r.outcome).toBe('complete');
    if (r.outcome !== 'complete') return;
    expect(r.bytes.byteLength).toBe(100);
    expect(asm.busy).toBe(false);
  });
});

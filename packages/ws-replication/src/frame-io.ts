/**
 * frame-io —— 方向序列纪律、codec 包装、close-code 分类、ERROR 帧构造（设计 §4）。
 *
 * 冻结纪律：
 * - 发送侧：每连接每方向独立 uint32 计数从 1 严格递增；**序列号只在帧实际出队发送时
 *   分配**（§4.1 R3/#7 钉死——入队项不携带、不预占），控制帧优先（§4.4）；
 * - 接收侧：入站 frame sequence 严格等于期望值（last+1）；gap/repeat/回退一律
 *   `SEQUENCE_VIOLATION` connection fatal（ADR 0010 L147 字面，§18.8）。字段级超限
 *   （UPDATE_TOO_LARGE / BOOTSTRAP_TOO_LARGE / SYNC_DIFF_TOO_LARGE）由调用方在 decode
 *   成功后手工判定（保留 namespaceId 以构造 namespace-scope ERROR）；
 * - 出站 uint32 耗尽（实践不可达）→ 响亮收口：close(1008)，不回绕、不静默错序。
 */
import {
  decodeMessage,
  encodeMessage,
  type ReplicationMessage,
} from '@nomicore/replication-protocol';
import type { CodecFieldLimits, ResolvedLimits } from './types.js';

/** codec 字段级限额（encode 侧传给 codec；decode 侧由调用方手工判定）。 */
export function codecFieldLimits(limits: ResolvedLimits): CodecFieldLimits {
  return {
    maxUpdateBytes: limits.maxUpdateBytes,
    maxBootstrapBytes: limits.maxBootstrapBytes,
    maxSyncDiffBytes: limits.maxSyncDiffBytes,
  };
}

/** ERROR 帧 safeMessage 静态常量表（单点；零 owner/token/身份/内容回显——I-2）。 */
export function safeMessageFor(code: string): string {
  return `protocol error: ${code}`;
}

/** 构造 connection ERROR 帧（scope 由注册表导出；调用方不可覆盖）。 */
export function connectionErrorFrame(code: string, relatedSequence?: number): ReplicationMessage {
  return {
    kind: 'ERROR',
    code,
    safeMessage: safeMessageFor(code),
    ...(relatedSequence === undefined ? {} : { relatedSequence }),
  };
}

/** 构造 namespace ERROR 帧。 */
export function namespaceErrorFrame(
  code: string,
  namespaceId: string,
  relatedSequence?: number,
): ReplicationMessage {
  return {
    kind: 'ERROR',
    code,
    safeMessage: safeMessageFor(code),
    namespaceId,
    ...(relatedSequence === undefined ? {} : { relatedSequence }),
  };
}

/** 入站解码（含 expectedSequence；序列检查先于一切 payload 处理）。 */
export function decodeInbound(
  bytes: Uint8Array,
  options: { expectedSequence: number; maxFrameBytes: number },
): { header: { sequence: number }; message: ReplicationMessage } {
  return decodeMessage(bytes, {
    expectedSequence: options.expectedSequence,
    maxFrameBytes: options.maxFrameBytes,
  });
}

/** 字段级超限判别（decode 成功后手工判定；返回命名空间级超限码或 undefined）。 */
export function namespaceFieldViolation(
  message: ReplicationMessage,
  fieldLimits: CodecFieldLimits,
): string | undefined {
  switch (message.kind) {
    case 'UPDATE':
      return message.update.byteLength > fieldLimits.maxUpdateBytes ? 'UPDATE_TOO_LARGE' : undefined;
    case 'BOOTSTRAP_SNAPSHOT':
      return message.snapshot.byteLength > fieldLimits.maxBootstrapBytes ? 'BOOTSTRAP_TOO_LARGE' : undefined;
    case 'SYNC_STEP2':
      return message.update.byteLength > fieldLimits.maxSyncDiffBytes ? 'SYNC_DIFF_TOO_LARGE' : undefined;
    default:
      return undefined;
  }
}

/** 单方向出站队列：控制帧恒先；序列号在 dequeue 发送时单点分配（R3/#7）。 */
export class OutboundQueue {
  private lastSeq = 0;
  private readonly controlQueue: ReplicationMessage[] = [];
  private readonly dataQueues = new Map<string, ReplicationMessage[]>();
  private readonly dataOrder: string[] = [];
  private dataCursor = 0;

  constructor(
    private readonly emitRaw: (bytes: Uint8Array, sequence: number) => void,
    private readonly limits: ResolvedLimits,
  ) {}

  get lastSequence(): number {
    return this.lastSeq;
  }

  /** 入队控制帧并立即排空（控制恒先于 data；序列在出队时分配）。返回本帧序列。 */
  sendControl(message: ReplicationMessage): number {
    this.controlQueue.push(message);
    this.drain();
    return this.lastSeq;
  }

  /** 立即发送一条 data 帧（窗口放行直发路径），返回分配的帧序。 */
  sendData(namespaceId: string, message: ReplicationMessage): number {
    void namespaceId;
    return this.emitOne(message);
  }

  /** 排空：控制队列全部先行；data 每轮每 ns 至多一笔（round-robin）。 */
  drain(): void {
    while (this.controlQueue.length > 0) {
      const item = this.controlQueue.shift()!;
      this.emitOne(item);
    }
    while (this.queuedDataCount() > 0) {
      const nsId = this.nextDataNamespace();
      if (nsId === undefined) return;
      const bucket = this.dataQueues.get(nsId);
      const item = bucket?.shift();
      if (item === undefined || bucket === undefined) continue;
      this.emitOne(item);
      if (bucket.length === 0) {
        this.dataQueues.delete(nsId);
        const index = this.dataOrder.indexOf(nsId);
        if (index >= 0) this.dataOrder.splice(index, 1);
        if (this.dataCursor >= this.dataOrder.length) this.dataCursor = 0;
      }
    }
  }

  /** 清空队列（连接收口防御）。 */
  clear(): void {
    this.controlQueue.length = 0;
    this.dataQueues.clear();
    this.dataOrder.length = 0;
    this.dataCursor = 0;
  }

  private queuedDataCount(): number {
    let total = 0;
    for (const queue of this.dataQueues.values()) total += queue.length;
    return total;
  }

  private nextDataNamespace(): string | undefined {
    if (this.dataOrder.length === 0) return undefined;
    if (this.dataCursor >= this.dataOrder.length) this.dataCursor = 0;
    const nsId = this.dataOrder[this.dataCursor]!;
    this.dataCursor += 1;
    return nsId;
  }

  private emitOne(message: ReplicationMessage): number {
    if (this.lastSeq >= 0xffffffff) {
      // 出站 uint32 耗尽（实践不可达）：不回绕、不静默错序——响亮收口。
      // 连接层捕获该错误并 close(1008)。
      throw new Error(
        'WIRE_SEQUENCE_EXHAUSTED: outbound sequence reached 0xffffffff; connection must be closed',
      );
    }
    const sequence = this.lastSeq + 1;
    const bytes = encodeMessage(message, {
      sequence,
      maxFrameBytes: this.limits.maxFrameBytes,
      limits: codecFieldLimits(this.limits),
    });
    this.lastSeq = sequence;
    this.emitRaw(bytes, sequence);
    return sequence;
  }
}

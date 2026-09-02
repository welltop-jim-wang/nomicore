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

/** 出站 uint32 耗尽（§4.1 R3/#11 响亮收口钩子；实践不可达，防御面补齐）。
 *  connection 级收口（ERROR + close 1008）由 OutboundQueue.onSequenceExhausted 回调执行；
 *  本错误无 `.code`——调用方（控制器 sendChecked）按「非命名空间编码错」静默返回 0，
 *  不再叠加 namespace ERROR（连接已收口）。 */
export class OutboundExhaustedError extends Error {
  constructor() {
    super('outbound sequence reached 0xffffffff; connection must be closed');
    this.name = 'OutboundExhaustedError';
  }
}

/** 出站帧实际编码字节回报（§4.3 control 保留额度记账的确定判据来源）。 */
export interface EmittedInfo {
  readonly kind: 'control' | 'data';
  readonly byteLength: number;
}

/** 单方向出站队列：控制帧恒先；序列号在 dequeue 发送时单点分配（R3/#7）。
 *  data 帧经 `emit`（ConnectionSender 出队点）；round-robin 公平轮转已由
 *  ConnectionSender + UpdateChannel 落地（§6.4——原 dataQueues/sendData 死代码删除）。 */
export class OutboundQueue {
  private lastSeq = 0;
  private readonly controlQueue: ReplicationMessage[] = [];

  constructor(
    private readonly emitRaw: (bytes: Uint8Array, sequence: number) => void,
    private readonly limits: ResolvedLimits,
    private readonly onSequenceExhausted: () => void = () => undefined,
    private readonly onEmitted: (info: EmittedInfo) => void = () => undefined,
  ) {}

  get lastSequence(): number {
    return this.lastSeq;
  }

  /** 入队控制帧并立即排空（控制恒先于 data；序列在出队时分配）。返回**本帧自身**序列
   *  ——控制队列 FIFO，本帧必为本批最后发出的控制帧；drain 返回「最后发出的控制帧序」
   *  （数据帧随后派发会使 `lastSeq` 被污染——R1 修复：G2.1/G2.2 关联基准只认控制帧
   *  自身序，不与数据帧派发序混同）。 */
  sendControl(message: ReplicationMessage): number {
    this.controlQueue.push(message);
    return this.drain();
  }

  /** 立即发送一条 data 帧（ConnectionSender 出队点）；返回分配的帧序。 */
  emit(message: ReplicationMessage): number {
    return this.emitOne(message, 'data');
  }

  /** 排空控制队列（data 调度由 ConnectionSender 负责）。返回本批最后一个控制帧序列。 */
  drain(): number {
    let lastControlSeq = 0;
    while (this.controlQueue.length > 0) {
      const item = this.controlQueue.shift()!;
      lastControlSeq = this.emitOne(item, 'control');
    }
    return lastControlSeq;
  }

  /** 清空队列（连接收口防御）。 */
  clear(): void {
    this.controlQueue.length = 0;
  }

  private emitOne(message: ReplicationMessage, kind: 'control' | 'data'): number {
    if (this.lastSeq >= 0xffffffff) {
      // 出站 uint32 耗尽（实践不可达）：不回绕、不静默错序——响亮收口（§4.1 R3/#11）：
      // 触发连接层 best-effort connection ERROR + close(1008)；本出队不再发送。
      this.onSequenceExhausted();
      throw new OutboundExhaustedError();
    }
    const sequence = this.lastSeq + 1;
    const bytes = encodeMessage(message, {
      sequence,
      maxFrameBytes: this.limits.maxFrameBytes,
      limits: codecFieldLimits(this.limits),
    });
    this.lastSeq = sequence;
    this.emitRaw(bytes, sequence);
    this.onEmitted({ kind, byteLength: bytes.byteLength });
    return sequence;
  }
}

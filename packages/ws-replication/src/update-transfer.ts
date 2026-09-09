/**
 * update-transfer —— issue #243（slice 2，ADR 0013）分块 UPDATE 传输的接收端
 * detached assembly 与切片几何纯函数（发送端切片边界与接收端校验的单一事实源）。
 *
 * - 发送端（UpdateChannel）：出队时刻惰性切片，每帧独立 sequence、独立受 dataGateOpen
 *   与 RR「每轮每 ns 一帧」约束，整笔 transfer 占 1 个 in-flight 窗口槽（有效占用口径），
 *   单 UPDATE_ACK（末 chunk 帧序）结算——见 update-channel.ts。
 * - 接收端（本模块）：每 (ns, 方向) 控制器持一个 `UpdateChunkAssembler`（单入站方向、
 *   纯易失、零持久化）。首 chunk（idle）在**分配前**完成全部上界校验（D1）后按已验证
 *   totalBytes 一次性分配 detached buffer；后续 chunk 严格递增追加；收齐后核对 Σbytes
 *   == totalBytes 才交控制器做恰一次 sequenced apply——任何重组失败先于 apply，live
 *   Y.Doc 零写入（AC3）。
 *
 * 违例分类（slice 2 基础映射；#244 完备化）：结构/顺序族 → UPDATE_TRANSFER_VIOLATION
 * （fatal/terminal failed）；上界族 → UPDATE_TRANSFER_TOO_LARGE。codec 单帧自洽规则
 * （transferId≥1、chunkCount≥1、chunkIndex<chunkCount、bytes 非空 ≤ totalBytes）已在
 * slice 1 decode 层强制——本模块只做跨帧/上界状态机。
 *
 * 本模块不经 src/index.ts 导出（包内私有）。
 */

/** 单帧分块载荷（UPDATE_CHUNK 消息体，minus namespaceId——发送/接收共享形状）。 */
export interface ChunkedTransferPiece {
  readonly transferId: number;
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly totalBytes: number;
  readonly bytes: Uint8Array;
}

/** 切片几何：chunkCount = ceil(totalBytes / maxChunkBytes)（发送端唯一分片依据）。 */
export function chunkCountOf(totalBytes: number, maxChunkBytes: number): number {
  return Math.ceil(totalBytes / maxChunkBytes);
}

/** 切片几何：第 index 片在半开区间 [start, end)（零拷贝 subarray 边界；index 0-based）。 */
export function chunkBounds(
  totalBytes: number,
  maxChunkBytes: number,
  index: number,
): { start: number; end: number } {
  const start = index * maxChunkBytes;
  return { start, end: Math.min(start + maxChunkBytes, totalBytes) };
}

/** 单 chunk 几何一致性（首 chunk 校验 #5：totalBytes ≤ chunkCount × maxUpdateBytes）。 */
export function geometryConsistent(
  totalBytes: number,
  chunkCount: number,
  maxChunkBytes: number,
): boolean {
  return chunkCount >= 1 && totalBytes <= chunkCount * maxChunkBytes;
}

/** 收帧结果。 */
export type UpdateChunkAcceptResult =
  | { readonly outcome: 'more' }
  | { readonly outcome: 'complete'; readonly bytes: Uint8Array }
  | {
      readonly outcome: 'violation';
      readonly code: 'UPDATE_TRANSFER_VIOLATION' | 'UPDATE_TRANSFER_TOO_LARGE';
    };

/**
 * 接收端 detached assembly（DD-4）：busy 期间按 (transferId, chunkIndex 严格递增) 收帧，
 * 首 chunk 经上界校验后一次性分配。作用域 = (连接, 方向, namespaceId)——控制器在连接
 * 收口/恢复结算/声明边沿调用 `reset()`。
 */
export class UpdateChunkAssembler {
  private readonly maxUpdateBytes: number;
  private readonly maxChunkedUpdateBytes: number;
  private buffer: Uint8Array | undefined;
  private transferIdValue = 0;
  private declaredChunkCount = 0;
  private declaredTotalBytes = 0;
  private receivedCount = 0;
  private receivedBytes = 0;

  constructor(limits: Readonly<{ maxUpdateBytes: number; maxChunkedUpdateBytes: number }>) {
    this.maxUpdateBytes = limits.maxUpdateBytes;
    this.maxChunkedUpdateBytes = limits.maxChunkedUpdateBytes;
  }

  get busy(): boolean {
    return this.buffer !== undefined;
  }

  /** 弃置（连接收口/声明边沿/恢复结算/残渣收口）：零副作用，可随时调用。 */
  reset(): void {
    this.buffer = undefined;
    this.transferIdValue = 0;
    this.declaredChunkCount = 0;
    this.declaredTotalBytes = 0;
    this.receivedCount = 0;
    this.receivedBytes = 0;
  }

  /**
   * 收帧。调用方保证：idle 时只以 chunkIndex===0 调用（idle∧chunkIndex>0 属残渣形态，
   * 由控制器按 ns 状态判别后处置——本方法对该形态返回 violation 作防御兜底）。
   *
   * idle 首 chunk 校验序（全部先于分配，D1）：
   *   1. busy∧异 transferId / busy∧同 id 重复首 chunk → VIOLATION（本方法 busy 分支）；
   *   2. bytes ≤ maxUpdateBytes（decode 不传 FieldLimits，须手工判）；
   *   3. totalBytes ≥ 1；
   *   4. totalBytes ≤ maxChunkedUpdateBytes → TOO_LARGE；
   *   5. totalBytes ≤ chunkCount × maxUpdateBytes（几何一致）→ VIOLATION；
   *   6. 通过后 new Uint8Array(totalBytes) 一次性分配并拷贝 chunk 0。
   *
   * busy 后续 chunk：transferId/totalBytes/chunkCount 与声明逐字节一致 ∧ chunkIndex ===
   * 已收数量（严格递增）∧ bytes ≤ maxUpdateBytes ∧ receivedBytes + len ≤ totalBytes →
   * 追加拷贝；任一不符 → VIOLATION。收齐时 Σbytes === totalBytes 精确核对（不符 →
   * VIOLATION）后返回 complete。
   */
  accept(frame: ChunkedTransferPiece): UpdateChunkAcceptResult {
    if (this.buffer === undefined) {
      if (frame.chunkIndex !== 0) return violation(); // 防御兜底（残渣应由控制器判别）
      const check = this.validateFirst(frame);
      if (check !== undefined) return check;
      const buffer = new Uint8Array(frame.totalBytes);
      buffer.set(frame.bytes, 0);
      this.buffer = buffer;
      this.transferIdValue = frame.transferId;
      this.declaredChunkCount = frame.chunkCount;
      this.declaredTotalBytes = frame.totalBytes;
      this.receivedCount = 1;
      this.receivedBytes = frame.bytes.byteLength;
      return this.receivedCount === this.declaredChunkCount
        ? this.completeIfExact(buffer)
        : { outcome: 'more' };
    }
    // busy：跨帧规则
    if (frame.transferId !== this.transferIdValue) return violation();
    if (frame.totalBytes !== this.declaredTotalBytes) return violation();
    if (frame.chunkCount !== this.declaredChunkCount) return violation();
    if (frame.chunkIndex !== this.receivedCount) return violation();
    if (frame.bytes.byteLength > this.maxUpdateBytes) return violation();
    if (frame.bytes.byteLength === 0) return violation(); // codec 已强制非空；纵深
    if (this.receivedBytes + frame.bytes.byteLength > this.declaredTotalBytes) {
      return violation();
    }
    const buffer = this.buffer;
    buffer.set(frame.bytes, this.receivedBytes);
    this.receivedCount += 1;
    this.receivedBytes += frame.bytes.byteLength;
    return this.receivedCount === this.declaredChunkCount
      ? this.completeIfExact(buffer)
      : { outcome: 'more' };
  }

  private completeIfExact(buffer: Uint8Array): UpdateChunkAcceptResult {
    if (this.receivedBytes !== this.declaredTotalBytes) {
      this.reset();
      return violation();
    }
    const bytes = buffer;
    this.reset();
    return { outcome: 'complete', bytes };
  }

  private validateFirst(
    frame: ChunkedTransferPiece,
  ): UpdateChunkAcceptResult | undefined {
    if (frame.bytes.byteLength > this.maxUpdateBytes) return violation();
    if (frame.totalBytes < 1) return violation();
    if (frame.bytes.byteLength > frame.totalBytes) return violation(); // codec 已强制；纵深防越界
    if (frame.totalBytes > this.maxChunkedUpdateBytes) {
      return { outcome: 'violation', code: 'UPDATE_TRANSFER_TOO_LARGE' };
    }
    if (!geometryConsistent(frame.totalBytes, frame.chunkCount, this.maxUpdateBytes)) {
      return violation();
    }
    return undefined;
  }
}

function violation(): UpdateChunkAcceptResult {
  return { outcome: 'violation', code: 'UPDATE_TRANSFER_VIOLATION' };
}

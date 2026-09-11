/**
 * update-transfer —— issue #243（slice 2，ADR 0013）分块 UPDATE 传输的接收端
 * detached assembly 与切片几何纯函数（发送端切片边界与接收端校验的单一事实源）。
 *
 * - 发送端（UpdateChannel / BulkTransferSender）：出队时刻惰性切片，每帧独立 sequence、
 *   独立受 dataGateOpen 与 RR「每轮每 ns 一帧」约束，整笔 transfer 占 1 个 in-flight
 *   窗口槽（有效占用口径），单 ACK（UPDATE_ACK / BOOTSTRAP_ACK / SYNC_APPLIED）结算
 *   ——见 update-channel.ts / bulk-transfer.ts。
 * - 接收端（本模块）：每 (ns, 方向) 控制器持一个 `UpdateChunkAssembler`（单入站方向、
 *   纯易失、零持久化）。首 chunk（idle）在**分配前**完成全部上界校验（D1）后按已验证
 *   totalBytes 一次性分配 detached buffer；后续 chunk 严格递增追加；收齐后核对 Σbytes
 *   == totalBytes 才交控制器做恰一次 sequenced apply——任何重组失败先于 apply，live
 *   Y.Doc 零写入（AC3）。
 *
 * 违例分类（issue #244 基础映射 + issue #295 切片 2 kind 泛化）：结构/顺序/几何族 →
 * `<family>_TRANSFER_VIOLATION`（fatal/terminal failed）；上界族 → `<family>_TRANSFER_TOO_LARGE`。
 * family 由帧的 `transferKind` 单点映射（`chunkedViolationCode`）：kind=0 → `UPDATE_*`
 * （逐字保持 #243 冻结结果形状）、kind=1 → `SNAPSHOT_*`、kind=2 → `SYNC_*`。codec 单帧
 * 自洽规则（transferId≥1、chunkCount≥1、chunkIndex<chunkCount、bytes 非空 ≤ totalBytes、
 * kind 值域、绑定块存在性/位置）已在 decode 层强制——本模块只做跨帧/上界状态机。
 *
 * 本模块不经 src/index.ts 导出（包内私有）。
 */

/** 分块传输 kind（单形态首字段，ADR 0019；`undefined` 归一为 0——既有 kind=0 生产者等价）。 */
export type ChunkedTransferKind = 0 | 1 | 2;

/** 单帧分块载荷（UPDATE_CHUNK 消息体，minus namespaceId——发送/接收共享形状）。 */
export interface ChunkedTransferPiece {
  /** issue #295 切片 2：kind 首字段（#299 codec 冻结）。缺省 = 0（kind=0 既有调用点/fixture
   *  逐字节等价——R47）。kind=1/2 由 BulkTransferSender 显式携带。 */
  readonly transferKind?: ChunkedTransferKind;
  readonly transferId: number;
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly totalBytes: number;
  readonly bytes: Uint8Array;
  /** 绑定块（当且仅当 kind=1 ∧ chunkIndex=0；codec 强制存在性与位置）。 */
  readonly replicationId?: string;
  readonly replicationEpoch?: number;
  /** 绑定块（当且仅当 kind=2 ∧ chunkIndex=0；codec 强制存在性与位置）。 */
  readonly syncRoundId?: number;
}

/** 族中性违例原因：由上界族/结构族派生 kind 相关冻结错误码（映射单点见下）。 */
export type ChunkedTransferViolationReason = 'transfer-too-large' | 'transfer-violation';

/** 三个 kind family 的冻结违例码（协议 §13.2）。 */
export type ChunkedTransferViolationCode =
  | 'UPDATE_TRANSFER_VIOLATION'
  | 'UPDATE_TRANSFER_TOO_LARGE'
  | 'SNAPSHOT_TRANSFER_VIOLATION'
  | 'SNAPSHOT_TRANSFER_TOO_LARGE'
  | 'SYNC_TRANSFER_VIOLATION'
  | 'SYNC_TRANSFER_TOO_LARGE';

/** 族中性原因 × kind → 冻结错误码（唯一映射点；控制器只透传结果码）。 */
export function chunkedViolationCode(
  reason: ChunkedTransferViolationReason,
  kind: ChunkedTransferKind,
): ChunkedTransferViolationCode {
  const family = kind === 1 ? 'SNAPSHOT' : kind === 2 ? 'SYNC' : 'UPDATE';
  return `${family}_TRANSFER_${reason === 'transfer-too-large' ? 'TOO_LARGE' : 'VIOLATION'}` as ChunkedTransferViolationCode;
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
  | {
      readonly outcome: 'complete';
      readonly bytes: Uint8Array;
      /** issue #245（DD4）：wire 申报 chunkCount（reset 前捕获）——chunked-update-applied
       *  事件的 chunkCount 事实源。不携带 transferId/totalBytes：成功型键集无需（DD1）。 */
      readonly chunkCount: number;
    }
  | {
      readonly outcome: 'violation';
      /** 按帧/在途 assembly 的 kind 映射的冻结码（`chunkedViolationCode` 单点）。 */
      readonly code: ChunkedTransferViolationCode;
    };

/** assembly 限额（kind 泛化，issue #295 切片 2）：kind=1/2 上限缺省 = 该 kind 未启用。 */
export interface UpdateChunkAssemblerLimits {
  readonly maxUpdateBytes: number;
  /** kind=0 聚合上限（#243 既有语义）。 */
  readonly maxChunkedUpdateBytes: number;
  /** kind=1 聚合上限（`maxChunkedBootstrapBytes`）；kind=1 帧到达前必须提供。 */
  readonly maxChunkedBootstrapBytes?: number;
  /** kind=2 聚合上限（`maxChunkedSyncDiffBytes`）；kind=2 帧到达前必须提供。 */
  readonly maxChunkedSyncDiffBytes?: number;
}

/**
 * 接收端 detached assembly（DD-4）：busy 期间按 (transferId, chunkIndex 严格递增) 收帧，
 * 首 chunk 经上界校验后一次性分配。作用域 = (连接, 方向, namespaceId)——控制器在连接
 * 收口/恢复结算/声明边沿调用 `reset()`。issue #295 切片 2：busy 期间 `transferKind`
 * 与 transferId/totalBytes/chunkCount 同列逐字节一致（异 kind 同 transferId 的恶意交错 →
 * violation，错误族按在途 assembly 的 kind 取）。
 */
export class UpdateChunkAssembler {
  private readonly maxUpdateBytes: number;
  private readonly maxChunkedUpdateBytes: number;
  private readonly maxChunkedBootstrapBytes: number | undefined;
  private readonly maxChunkedSyncDiffBytes: number | undefined;
  private buffer: Uint8Array | undefined;
  private transferIdValue = 0;
  private transferKindValue: ChunkedTransferKind = 0;
  private declaredChunkCount = 0;
  private declaredTotalBytes = 0;
  private receivedCount = 0;
  private receivedBytes = 0;

  constructor(limits: UpdateChunkAssemblerLimits) {
    this.maxUpdateBytes = limits.maxUpdateBytes;
    this.maxChunkedUpdateBytes = limits.maxChunkedUpdateBytes;
    this.maxChunkedBootstrapBytes = limits.maxChunkedBootstrapBytes;
    this.maxChunkedSyncDiffBytes = limits.maxChunkedSyncDiffBytes;
  }

  get busy(): boolean {
    return this.buffer !== undefined;
  }

  /** issue #295 切片 2：在途 assembly 的 kind（idle → undefined）——busy 违例错误族选路、
   *  超时收口选路与 aborted 事件 kind 门的事实源。 */
  get busyKind(): ChunkedTransferKind | undefined {
    return this.buffer === undefined ? undefined : this.transferKindValue;
  }

  /** issue #244：进度快照（中止事件构造前捕获；idle → undefined——无快照即零事件载荷）。
   *  只投影计数/长度/受控 transferId（长度/计数 safe-field，非内容）；reset 前调用。 */
  snapshot():
    | { readonly transferId: number; readonly receivedChunks: number; readonly receivedBytes: number }
    | undefined {
    if (this.buffer === undefined) return undefined;
    return {
      transferId: this.transferIdValue,
      receivedChunks: this.receivedCount,
      receivedBytes: this.receivedBytes,
    };
  }

  /** 弃置（连接收口/声明边沿/恢复结算/残渣收口）：零副作用，可随时调用。 */
  reset(): void {
    this.buffer = undefined;
    this.transferIdValue = 0;
    this.transferKindValue = 0;
    this.declaredChunkCount = 0;
    this.declaredTotalBytes = 0;
    this.receivedCount = 0;
    this.receivedBytes = 0;
  }

  /**
   * 收帧。调用方保证：idle 时只以 chunkIndex===0 调用（idle∧chunkIndex>0 属残渣形态，
   * 由控制器按 ns 状态判别后处置——本方法对该形态返回 violation 作防御兜底）。
   *
   * idle 首 chunk 校验序（全部先于分配，D1/issue #295 D6）：
   *   1. busy∧异 transferId/kind / busy∧同 id 重复首 chunk → VIOLATION（本方法 busy 分支）；
   *   2. bytes ≤ maxUpdateBytes（decode 不传 FieldLimits，须手工判）；
   *   3. totalBytes ≥ 1；
   *   4. totalBytes ≤ 按 kind 聚合上限（kind=0 → maxChunkedUpdateBytes /
   *      kind=1 → maxChunkedBootstrapBytes / kind=2 → maxChunkedSyncDiffBytes）→ TOO_LARGE；
   *   5. totalBytes ≤ chunkCount × maxUpdateBytes（几何一致）→ VIOLATION；
   *   6. 通过后 new Uint8Array(totalBytes) 一次性分配并拷贝 chunk 0。
   *
   * busy 后续 chunk：transferKind/transferId/totalBytes/chunkCount 与声明逐字节一致 ∧
   * chunkIndex === 已收数量（严格递增）∧ bytes ≤ maxUpdateBytes ∧
   * receivedBytes + len ≤ totalBytes → 追加拷贝；任一不符 → VIOLATION（族按在途 kind）。
   * 收齐时 Σbytes === totalBytes 精确核对（不符 → VIOLATION）后返回 complete。
   */
  accept(frame: ChunkedTransferPiece): UpdateChunkAcceptResult {
    const kind = frame.transferKind ?? 0;
    if (this.buffer === undefined) {
      if (frame.chunkIndex !== 0) return this.violation('transfer-violation', kind); // 防御兜底
      const check = this.validateFirst(frame, kind);
      if (check !== undefined) return check;
      const buffer = new Uint8Array(frame.totalBytes);
      buffer.set(frame.bytes, 0);
      this.buffer = buffer;
      this.transferIdValue = frame.transferId;
      this.transferKindValue = kind;
      this.declaredChunkCount = frame.chunkCount;
      this.declaredTotalBytes = frame.totalBytes;
      this.receivedCount = 1;
      this.receivedBytes = frame.bytes.byteLength;
      return this.receivedCount === this.declaredChunkCount
        ? this.completeIfExact(buffer)
        : { outcome: 'more' };
    }
    // busy：跨帧规则（错误族按在途 assembly 的 kind）
    const busyKind = this.transferKindValue;
    if (kind !== busyKind) return this.violation('transfer-violation', busyKind);
    if (frame.transferId !== this.transferIdValue) return this.violation('transfer-violation', busyKind);
    if (frame.totalBytes !== this.declaredTotalBytes) return this.violation('transfer-violation', busyKind);
    if (frame.chunkCount !== this.declaredChunkCount) return this.violation('transfer-violation', busyKind);
    if (frame.chunkIndex !== this.receivedCount) return this.violation('transfer-violation', busyKind);
    if (frame.bytes.byteLength > this.maxUpdateBytes) return this.violation('transfer-violation', busyKind);
    if (frame.bytes.byteLength === 0) return this.violation('transfer-violation', busyKind); // codec 已强制非空；纵深
    if (this.receivedBytes + frame.bytes.byteLength > this.declaredTotalBytes) {
      return this.violation('transfer-violation', busyKind);
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
      const kind = this.transferKindValue;
      this.reset();
      return this.violation('transfer-violation', kind);
    }
    // issue #245（DD4）：reset 前捕获 declaredChunkCount——complete 消费方需要
    // chunkCount（chunked-update-applied 字段事实源）；Σbytes === totalBytes 的
    // 既有不变量保持不变（bytes.byteLength === declaredTotalBytes）。
    const chunkCount = this.declaredChunkCount;
    const bytes = buffer;
    this.reset();
    return { outcome: 'complete', bytes, chunkCount };
  }

  private validateFirst(
    frame: ChunkedTransferPiece,
    kind: ChunkedTransferKind,
  ): UpdateChunkAcceptResult | undefined {
    if (frame.bytes.byteLength > this.maxUpdateBytes) return this.violation('transfer-violation', kind);
    if (frame.totalBytes < 1) return this.violation('transfer-violation', kind);
    if (frame.bytes.byteLength > frame.totalBytes) {
      return this.violation('transfer-violation', kind); // codec 已强制；纵深防越界
    }
    if (frame.totalBytes > this.aggregateLimitFor(kind)) {
      return this.violation('transfer-too-large', kind);
    }
    if (!geometryConsistent(frame.totalBytes, frame.chunkCount, this.maxUpdateBytes)) {
      return this.violation('transfer-violation', kind);
    }
    return undefined;
  }

  /** 按 kind 取聚合上限（kind=1/2 未配置 = 该 kind 无合法上下文 → 响亮编程错）。 */
  private aggregateLimitFor(kind: ChunkedTransferKind): number {
    if (kind === 0) return this.maxChunkedUpdateBytes;
    const limit = kind === 1 ? this.maxChunkedBootstrapBytes : this.maxChunkedSyncDiffBytes;
    if (limit === undefined) {
      throw new Error(
        kind === 1
          ? 'UpdateChunkAssembler: maxChunkedBootstrapBytes required for transferKind=1'
          : 'UpdateChunkAssembler: maxChunkedSyncDiffBytes required for transferKind=2',
      );
    }
    return limit;
  }

  private violation(
    reason: ChunkedTransferViolationReason,
    kind: ChunkedTransferKind,
  ): UpdateChunkAcceptResult {
    return { outcome: 'violation', code: chunkedViolationCode(reason, kind) };
  }
}

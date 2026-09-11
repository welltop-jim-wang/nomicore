/**
 * bulk-transfer —— issue #295 切片 2（ADR 0019 / 协议 §8.1/§9.2/§10.3）：kind=1（snapshot）
 * 与 kind=2（sync-diff）分块载荷的发送端唯一载体。
 *
 * 与 `UpdateChannel`（kind=0 live-update 通道）刻意分离：结算帧（BOOTSTRAP_ACK /
 * SYNC_APPLIED）、失败族（bootstrap 失败族 / round 语义）与窗口/ACK 记账语义不同构，
 * 混载会同时污染 kind=0 的 R47 等价面与 kind≠0 的正确性（设计 D1 备选①拒绝）。
 *
 * 状态机（单实例 per (ns, 方向)，与 UpdateChannel 同生命周期）：
 * ```text
 * idle ──enqueue(kind, payload, binding)──▶ queued（完整载荷入队，1 载体项）
 * queued ──首 chunk 出站──▶ active（chunkIndex 严格递增；transferId 于此刻分配——R42）
 * active ──末 chunk 出站──▶ awaiting-ack（载体核减；onLastChunkSent 携带末 chunk 帧序）
 * awaiting-ack ──settle(kind)（BOOTSTRAP_ACK / SYNC_APPLIED 收妥）──▶ idle
 * 任意态 ──abort/dispose（teardown、shed、round 终止、epoch fence、resync-declared、ACK
 *          超时、发送被拒）──▶ idle
 * ```
 *
 * 冻结语义（设计 D1/D2/D7）：
 * - **惰性切片**：入队持完整载荷（载体字节计入 facet `queuedBytes`，连接级 shed 账本可见）；
 *   出队时刻按 `chunkBounds(totalBytes, maxUpdateBytes, index)` 切片（复用既有几何纯函数）；
 * - **data 路径出站**：每 chunk 经宿主 `sendChunk` 出站（连接层 kind 感知 `sendUpdateChunk`
 *   → `tryEmitData`：ready 门 + 水位闸门 + 独立 sequence + 连接总压账本）；控制保留额度
 *   零 chunk（结构性成立——data 出站不经 control 队列）；
 * - **每 (ns, 方向) 至多 1 个进行中 kind≠0 transfer**：facet 三段仲裁（D7）使 kind=0 新
 *   transfer 在其结算前不开；`enqueue` 非 idle 为协议内不可达（防御性响亮重置）；
 * - **出站被拒（M5）**：`sendChunk` 返回 ≤0 → 失败明细先采样 → 载体弃置归 idle →
 *   宿主按 kind 做确定性收口（kind=1 → BOOTSTRAP_FAILED 族；kind=2 → needs-resync）。
 *
 * 本模块不经 src/index.ts 导出（包内私有）。
 */
import { chunkBounds, chunkCountOf, type ChunkedTransferKind, type ChunkedTransferPiece } from './update-transfer.js';
import type { UpdateSendFailureDetail } from './types.js';

/** kind=1/2 分块载荷的绑定块（首 chunk 携带；codec 单形态规则强制位置与存在性）。 */
export interface BulkTransferBinding {
  readonly replicationId?: string;
  readonly replicationEpoch?: number;
  readonly syncRoundId?: number;
}

/** 入队请求（一次性；含宿主侧结算/中止回调）。 */
export interface BulkTransferRequest {
  readonly kind: 1 | 2;
  /** 完整载荷（入队持整笔；出队惰性切片）。 */
  readonly payload: Uint8Array;
  /** 首 chunk 绑定块（kind 语义；由调用方保证与 payload 匹配）。 */
  readonly binding: BulkTransferBinding;
  /** 末 chunk 出站回调（**同一同步调用栈**——结算锚赋值先于任何合法 ACK 到达）。 */
  readonly onLastChunkSent: (lastChunkSequence: number) => void;
  /** 出站被拒（M5）回调：失败明细供给器（仅 observer 在场时求值）；宿主按 kind 收口。 */
  readonly onSendRejected: (detail: () => UpdateSendFailureDetail) => void;
  /** kind=2 自持 ACK timer 超时回调（载体已弃置归 idle）；宿主按 kind 收口。 */
  readonly onAckTimeout: () => void;
}

/** 宿主 seam（命名空间控制器实现；窗口/闸门/计数器全部复用既有单点）。 */
export interface BulkTransferHost {
  readonly maxUpdateBytes: number;
  /** kind=2 自持 ACK timer 上限（§10.4 平移；kind=1 由宿主 bootstrap timer 覆盖）。 */
  readonly ackTimeoutMs: number;
  /** 三 kind 共用计数器消费点（UpdateChannel 单点；R42）。 */
  readonly allocateTransferId: () => number;
  /** transferId 域未尽（D0 改道判据组成；由调用方在 enqueue 前判定）。 */
  readonly transferIdAvailable: () => boolean;
  /** 本方向 in-flight 窗口是否有空位（有效占用口径；整笔占 1 槽的起始判据）。 */
  readonly windowHasRoom: () => boolean;
  /** 单帧出站（连接层 kind 感知 UPDATE_CHUNK 路径）；返回帧序，≤0 = 被拒。 */
  readonly sendChunk: (chunk: ChunkedTransferPiece) => number;
  /** data 闸门（§4.2）。 */
  readonly dataGateOpen: () => boolean;
  readonly armTimer: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

interface BulkTransferState {
  readonly request: BulkTransferRequest;
  readonly totalBytes: number;
  readonly chunkCount: number;
  phase: 'queued' | 'active' | 'awaiting-ack';
  transferId: number;
  nextChunkIndex: number;
}

export class BulkTransferSender {
  private current: BulkTransferState | undefined;
  private ackTimerHandle: unknown | undefined;
  private ackTimerArmed = false;
  /** 防御计数（enqueue 非 idle = 协议内不可达的实现缺陷信号；不静默）。 */
  private replacedCount = 0;

  constructor(private readonly host: BulkTransferHost) {}

  /** 是否有载体（queued/active/awaiting-ack）——facet 仲裁 ② 门（整笔占槽至结算）。 */
  hasWork(): boolean {
    return this.current !== undefined;
  }

  /** 是否有**待出站**工作（queued/active）——M3 窗口空位唤醒判据（awaiting-ack 无待发帧）。 */
  hasQueuedWork(): boolean {
    return this.current !== undefined && this.current.phase !== 'awaiting-ack';
  }

  /** 载体 kind（idle → undefined）。 */
  get kind(): 1 | 2 | undefined {
    return this.current?.request.kind;
  }

  /** 协议内不可达的实现缺陷信号（enqueue 覆盖旧载体次数）；仅诊断读面。 */
  get replacedTransferCount(): number {
    return this.replacedCount;
  }

  /** 入队（完整载荷 + 1 载体项）。调用方保证 idle（单发语义）；非 idle = 响亮防御重置。 */
  enqueue(request: BulkTransferRequest): void {
    if (this.current !== undefined) {
      // 设计 D1：防御性处理 = 丢弃旧载体并按新载荷重置（响亮防御，不静默）。
      this.replacedCount += 1;
      this.disposeCurrent();
    }
    const totalBytes = request.payload.byteLength;
    this.current = {
      request,
      totalBytes,
      chunkCount: chunkCountOf(totalBytes, this.host.maxUpdateBytes),
      phase: 'queued',
      transferId: 0,
      nextChunkIndex: 0,
    };
  }

  /** 载体字节（未出站核减前恒整笔——连接级 shed 账本口径）。 */
  queuedBytes(): number {
    const state = this.current;
    if (state === undefined || state.phase === 'awaiting-ack') return 0;
    return state.totalBytes;
  }

  /** 载体项数（0/1）。 */
  queuedCount(): number {
    const state = this.current;
    return state === undefined || state.phase === 'awaiting-ack' ? 0 : 1;
  }

  /**
   * 出队一帧（facet 每轮每 ns 至多一帧）。返回 true ⇔ 取得进展（chunk 出站 / 被拒弃置）。
   * 前置（调用方保证 state 门/kind 语境）：载体在场 ∧ 非 awaiting-ack ∧ dataGateOpen
   * ∧（首 chunk 时）窗口空位 ∧ transferId 域未尽。中段 chunk 不复查窗口（同构 §10.3 ③a）。
   */
  pullOne(): boolean {
    const state = this.current;
    if (state === undefined || state.phase === 'awaiting-ack') return false;
    if (!this.host.dataGateOpen()) return false;
    if (state.phase === 'queued') {
      if (!this.host.windowHasRoom()) return false;
      if (!this.host.transferIdAvailable()) return false; // 实践不可达（uint32 域）
      state.transferId = this.host.allocateTransferId(); // R42：首 chunk 出站时刻分配
    }
    const { start, end } = chunkBounds(state.totalBytes, this.host.maxUpdateBytes, state.nextChunkIndex);
    const isFirst = state.nextChunkIndex === 0;
    const seq = this.host.sendChunk({
      transferKind: state.request.kind,
      transferId: state.transferId,
      chunkIndex: state.nextChunkIndex,
      chunkCount: state.chunkCount,
      totalBytes: state.totalBytes,
      bytes: state.request.payload.subarray(start, end),
      ...(isFirst && state.request.kind === 1
        ? {
            replicationId: state.request.binding.replicationId,
            replicationEpoch: state.request.binding.replicationEpoch,
          }
        : {}),
      ...(isFirst && state.request.kind === 2
        ? { syncRoundId: state.request.binding.syncRoundId }
        : {}),
    });
    if (seq <= 0) {
      // M5：失败明细必须在弃置之前采样（弃置后计数恒零——#243 send-failed 族同款纪律）。
      const detail = this.captureFailureDetail(state);
      const request = state.request;
      this.disposeCurrent();
      request.onSendRejected(detail);
      return true; // 「消费即进展」（镜像 #243 discardQueued 语义）
    }
    state.nextChunkIndex += 1;
    state.phase = 'active';
    if (state.nextChunkIndex >= state.chunkCount) {
      // 末 chunk：结算锚（同步回调）+ kind=2 自持 ACK timer（kind=1 由宿主 bootstrap timer 覆盖）
      state.phase = 'awaiting-ack';
      state.request.onLastChunkSent(seq);
      if (state.request.kind === 2) this.armAckTimer();
    }
    return true;
  }

  /** ACK 结算（BOOTSTRAP_ACK / SYNC_APPLIED 收妥）：awaiting-ack 且 kind 匹配 → idle。 */
  settle(kind: 1 | 2): void {
    const state = this.current;
    if (state === undefined || state.request.kind !== kind || state.phase !== 'awaiting-ack') return;
    this.disposeCurrent();
  }

  /** resync-declared 边沿（M2）：载体弃置 + 归 idle + 拆 timer（此后本方向零新增 kind≠0 出站）。 */
  abortForResyncDeclared(): void {
    this.disposeCurrent();
  }

  /** round 终止 / epoch fence / 通道收口（与 channel.teardown 同点）：载体弃置。 */
  teardown(): void {
    this.disposeCurrent();
  }

  /** 连接级 shed（facet 调用点）：返回被弃置载体的 kind（undefined = 无载体）——控制器据此
   *  做 kind 特定收口（kind=1 → BOOTSTRAP_FAILED 族；kind=2 → resync 边沿族）。 */
  discardForConnectionPressure(): 1 | 2 | undefined {
    const kind = this.current?.request.kind;
    this.disposeCurrent();
    return kind;
  }

  private armAckTimer(): void {
    if (this.ackTimerArmed) return;
    this.ackTimerArmed = true;
    this.ackTimerHandle = this.host.armTimer(() => {
      this.ackTimerArmed = false;
      this.ackTimerHandle = undefined;
      const state = this.current;
      if (state === undefined || state.request.kind !== 2 || state.phase !== 'awaiting-ack') return;
      const request = state.request;
      this.disposeCurrent();
      request.onAckTimeout();
    }, this.host.ackTimeoutMs);
  }

  private disposeCurrent(): void {
    this.current = undefined;
    if (!this.ackTimerArmed) return;
    this.ackTimerArmed = false;
    if (this.ackTimerHandle !== undefined) {
      this.host.clearTimer(this.ackTimerHandle);
      this.ackTimerHandle = undefined;
    }
  }

  /** M5 失败明细（失败时刻采样；丢弃后计数恒零——采样必须先于 disposeCurrent）。 */
  private captureFailureDetail(state: BulkTransferState): () => UpdateSendFailureDetail {
    const updateBytes = state.totalBytes;
    const maxUpdateBytes = this.host.maxUpdateBytes;
    const queuedUpdateCount = this.queuedCount();
    const queuedUpdateBytes = this.queuedBytes();
    return () => ({
      reason: 'send-frame-rejected',
      updateBytes,
      maxUpdateBytes,
      queuedUpdateCount,
      queuedUpdateBytes,
      // bulk 载体独立账本（kind≠0 不注册 channel 的裸 inFlight 条目）；
      // 载体在场即整笔占 1 个窗口槽——诊断口径以 queued* 为准。
      inFlightCount: 0,
    });
  }
}

/** 载体 kind 类型别名（调用方判别用）。 */
export type BulkTransferKind = Extract<ChunkedTransferKind, 1 | 2>;

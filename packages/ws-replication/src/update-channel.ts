/**
 * update-channel —— 单方向 UPDATE 通道：滑动窗口/有界队列/ACK 簿记/溢出（§10）。
 *
 * 每 (ns, 方向) 一个实例（peer 上行 / hub→peer 下行对称）。序列号在「帧实际出队
 * 发送时」由宿主连接层分配（§4.1 R3/#7）——本通道的 `send` 回调即该分配点。
 *
 * issue #137（设计 §6.2）：data 出队统一改经 `pullAndSendOne`（合并策略取帧、
 * 「消费即进展」）；`deliver` live 直发增加水位闸门前置；连接级 shed 经
 * `discardForConnectionPressure` 同构处置（§10.2）。控制器级状态门由 facet
 * 适配器承担（§6.3）——本通道不感知控制器状态。
 */
import * as Y from 'yjs';
import type { ReplicationMessage } from '@nomicore/replication-protocol';
import { safeNow } from './observer.js';
import { chunkBounds, chunkCountOf, type ChunkedTransferPiece } from './update-transfer.js';
import type {
  ReplicationSendFailureReason,
  ResolvedLimits,
  UpdateSendFailureDetail,
} from './types.js';

export interface UpdateChannelHost {
  readonly limits: ResolvedLimits;
  readonly ackTimeoutMs: number;
  /** 发送 UPDATE 帧；返回分配的帧序。 */
  readonly sendUpdateFrame: (bytes: Uint8Array) => number;
  /** issue #243（DD-3.5）：发送 UPDATE_CHUNK 帧（与 UPDATE 同一 data 出站点）；返回分配的帧序。 */
  readonly sendUpdateChunkFrame: (chunk: ChunkedTransferPiece) => number;
  /** issue #243（DD-1.5）：wire 协商位判据——true 才允许分块出站（发送门）。 */
  readonly chunkedSendEnabled: () => boolean;
  /** 本端声明 RESYNC（§10.2 溢出/ACK timeout/session 溢出边沿）：ns → needs-resync + RESYNC 帧。
   *  cause 为 resync 子因判别（§6.5 U1：live 溢出 / 发送失败）。
   *  issue #231：send-failed 附带惰性失败明细（仅 observer 在场时求值——无 observer
   *  零分配零采样，热路径纪律与 §23.4「无 observer 逐字节等价」保持）。 */
  readonly declareLocalResync: (
    cause: 'queue-overflow' | 'send-failed',
    failureDetail?: () => UpdateSendFailureDetail,
  ) => void;
  /** issue #231：超限项在队列非空时被 F4 静默丢弃（无 resync 声明，R2-1/D4 活性保持）
   *  的观测通知——控制器侧据此发射 update-dropped 事件（该路径唯一观测信号）。
   *  惰性明细同款纪律：仅 observer 在场时求值。 */
  readonly noteUpdateDropped: (detail: () => UpdateSendFailureDetail) => void;
  /** 非 live 溢出（§5.3）：丢弃未发送 + 置 pendingResync（round 完成时再开 round）。 */
  readonly notePendingResync: () => void;
  /** ACK timeout（§10.4）：弃置 in-flight + needs-resync + 立即新 round。issue #243（F6）：
   *  参数 = 弃置时刻是否有在途 chunked transfer（abandonInFlight 于显式清除前捕获）——
   *  peer 控制器据此决定补发 wire RESYNC_REQUIRED（仅协商连接可触达）。 */
  readonly onAckTimeout: (abortedTransfer: boolean) => void;
  /** 单笔 ACK 收妥记账（§6.5 U2/U3）：bytes = 在途帧载荷长度；latencyMs = ACK 时刻 − 发送时刻
   *  （clock 缺省/无 observer 时 undefined）；sequence = 被 ACK 帧序（= wire
   *  UPDATE_ACK.ackedSequence——issue #238 三事件面关联键）。
   *  issue #245（DD3）：chunked = 本 ACK 结算的是分块 transfer 的末 chunk 条目（发送侧
   *  据此改道发 chunked-update-acked；普通帧条目不携带该标记——普通路径逐字节不变）。 */
  readonly onUpdateAcked: (
    info: Readonly<{ bytes: number; latencyMs?: number; sequence: number; chunked?: true }>,
  ) => void;
  /** 帧实际出站记账（issue #238 §5.4）：seq>0 的每帧恰一通知（update-sent 发射信息）——
   *  sendQueueMs = 帧出队时刻 − 帧内最旧业务项入队时刻（clock 缺省时 undefined）。
   *  发射方（namespace facet）自行做 observer 在场门。
   *  issue #245（DD3）：chunked 组仅末 chunk 结算通知携带（= 分块 transfer 完成出站——
   *  中间 chunk 保持零通知）；发送侧据此改道发 chunked-update-sent。 */
  readonly noteUpdateSent: (
    info: Readonly<{
      sequence: number;
      bytes: number;
      sendQueueMs?: number;
      chunked?: Readonly<{ transferId: number; chunkCount: number }>;
    }>,
  ) => void;
  /** 单调时源（仅作差；控制器绑定 clock——无 clock 时返回 undefined）。 */
  readonly now?: () => number | undefined;
  readonly armTimer: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
  /** 连接级 data 水位闸门（§4.2；issue #137）：true = 可发送。 */
  readonly dataGateOpen: () => boolean;
  /** data 入队成功回调（§4.4 连接总压/wheel 登记；issue #137）。 */
  readonly onDataQueued: () => void;
  /** 请求连接级 drain（§4.5；issue #137）：ACK 空位/恢复/resetForLive 触发。 */
  readonly requestDataDrain: () => void;
  /** issue #295 切片 2（SA2-M3）：本方向 kind=1/2 分块载荷发送器是否有待发工作
   *  （channel 队列为空的窗口空位唤醒路径）。缺省 = false（kind=0 热路径逐字节同义）。 */
  readonly hasBulkTransferWork?: () => boolean;
}

interface QueuedItem {
  readonly bytes: Uint8Array;
  /** 入队时刻（issue #238 §5.4；clock 缺省/throw → 字段缺省——sendQueueMs 随之缺省）。 */
  readonly queuedAt?: number;
}

/**
 * issue #243（DD-3）：在途 chunked transfer 状态。载体 = 队列项本身（保持 queued[0]，
 * 末 chunk 出站才 shift）——守恒不变量：`activeTransfer ≠ undefined ⇒ queued[0] === 载体项`。
 */
interface ActiveTransferState {
  readonly item: QueuedItem;
  readonly transferId: number;
  /** 下一待发 chunk 下标（0-based；严格递增，不回绕）。 */
  chunkIndex: number;
  readonly totalBytes: number;
  readonly chunkCount: number;
}

export class UpdateChannel {
  /** 在途记账（§6.5 U2）：值形状 = {载荷字节数, 发送时刻}——纯内部记账，消费方仅
   *  size/keys/get/delete/clear，行为等价。sentAt 仅作差（clock 缺省 → undefined）。
   *  issue #245（DD3）：chunked = 末 chunk 条目标记（分块 transfer 的 ACK 结算判据——
   *  改道发 chunked-update-acked；普通帧条目不携带）。 */
  readonly inFlight = new Map<
    number,
    { readonly bytes: number; readonly sentAt?: number; readonly chunked?: true }
  >();
  readonly zombieSeqs = new Set<number>();
  private readonly queued: QueuedItem[] = [];
  private queuedByteCount = 0;
  /** 本通道的 needs-resync 标记（§10.2 溢出 / §10.4 弃置 / §10.6 对端声明 / §12 边沿 / §4.4 shed）。 */
  needsResync = false;
  private ackTimerHandle: unknown | undefined;
  private ackTimerArmed = false;
  /** issue #243（DD-3.2）：在途 chunked transfer（每 (ns,方向) 至多 1 个；惰性切片）。 */
  private activeTransfer: ActiveTransferState | undefined;
  /** issue #243（DD-3.2）：transferId 计数——(ns, 方向, 连接) 域内自 1 严格递增；resync/
   *  终态不复位；teardown（连接收口/新连接会话建立）归 1（新作用域，ADR 0013:32）。 */
  private nextTransferId = 1;

  constructor(private readonly host: UpdateChannelHost) {}

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  /** issue #243（DD-3.6）：有效占用口径（唯一口径）——裸在途 + 在途 transfer 槽。
   *  无 transfer 时与 v1 裸口径同义（未协商连接恒满足）；「直发逐字节不变」的适用域 =
   *  无 activeTransfer 组态。包内只读访问器，不经 src/index.ts 导出。 */
  effectiveInFlightCount(): number {
    return this.inFlight.size + (this.activeTransfer !== undefined ? 1 : 0);
  }

  /** issue #295 切片 2（D7）：本方向是否有在途 kind=0 chunked transfer——facet 三段仲裁
   *  的 ① 位（kind=0 transfer 走完前不放行 kind≠0 出站）。包内只读访问器。 */
  hasActiveTransfer(): boolean {
    return this.activeTransfer !== undefined;
  }

  /** issue #295 切片 2（D2/R42）：三 kind 共用同一 (连接, 方向, ns) transferId 计数器——
   *  kind=1/2 发送器（BulkTransferSender）在首 chunk 出站时刻消费本方法；kind=0 的
   *  `startTransfer` 仍走同一 `nextTransferId`。包内方法，不经 src/index.ts 导出。 */
  allocateTransferId(): number {
    const id = this.nextTransferId;
    this.nextTransferId += 1;
    return id;
  }

  /** issue #295 切片 2（D0）：transferId 域未尽（uint32 不回绕）——改道判据的组成部分。 */
  transferIdAvailable(): boolean {
    return this.nextTransferId <= 0xffffffff;
  }

  get queuedCount(): number {
    return this.queued.length;
  }

  /** 未发送队列字节（口径 = 队列内各项原始字节数之和；§5 R2 账务一致性）。 */
  get queuedBytes(): number {
    return this.queuedByteCount;
  }

  /** listener 交付（§10.1）。由控制器按 ns 状态选择 live 或 deferred 路径；终态零调用。 */
  deliver(bytes: Uint8Array, mode: 'live' | 'deferred'): void {
    if (this.needsResync) return; // §10.1 首行：溢出/恢复声明后丢弃（round 修复）
    // issue #238 §5.4：入队时刻记账（仅 clock 在场读数——safeNow 折叠；直发路径同
    // 口径：帧内最旧业务项入队时刻 = 本交付时刻）
    const queuedAt = safeNow(() => this.host.now?.());
    // issue #243（DD-2.3/DD-3.3，F1 修订）：chunkable 判定 = 已协商 ∧ 超 maxUpdateBytes
    // ∧ ≤ maxChunkedUpdateBytes ∧ transferId 域未耗尽——未协商连接恒 false，与 v1
    // 逐字节一致（改道范围收窄到「已协商 ∧ 可分块」项）。
    const chunkable = this.isChunkable(bytes);
    // issue #243：chunkable 项在窗口空位 ∧ 闸门开时也不进直发——改道入有界队列，
    // 出队时刻惰性切片（DD-3.3 行 2）。此时窗口空位存在、闸门开，若无既有 ACK/恢复
    // 触发点，出队只能依赖入队后的连接级 drain（requestDrain 门内自判 paused）——
    // 该请求必须在 push + wheel 登记之后发起（drain 才能取到本项）。
    let drainAfterQueue = false;
    if (mode === 'live') {
      // F1（SA4 修复，2026-08-29）：闸门检查**先行**——dataGateOpen 非纯读（暂停段
      // 撤压时 observeWater → resume → 同步 drainData 重入消费窗口空位）；闸门先求值
      // 完成后窗口检查读的是 drain 后真值，直发条件（窗口有空位 ∧ 闸门开）在发送
      // 时刻成立（协议 §10.2 / 设计 §4.1）。
      const gateOpen = this.host.dataGateOpen();
      const windowHasRoom = this.effectiveInFlightCount() < this.host.limits.maxInFlightUpdates;
      if (gateOpen && windowHasRoom && !chunkable) {
        this.sendAndRegister(bytes, queuedAt);
        return;
      }
      if (chunkable && gateOpen && windowHasRoom) drainAfterQueue = true;
    }
    // 到此处：窗口满（live）或闸门关（live）或 deferred 或 chunkable → 入有界队列
    if (this.overflows(bytes)) {
      this.discardQueued();
      if (mode === 'live') {
        this.needsResync = true;
        this.host.declareLocalResync('queue-overflow');
      } else {
        this.host.notePendingResync();
      }
      return;
    }
    this.queued.push({ bytes, ...(queuedAt !== undefined ? { queuedAt } : {}) });
    this.queuedByteCount += bytes.byteLength;
    // §4.4：入队成功后通知连接级（RR wheel 登记 + 连接总压检查）。
    this.host.onDataQueued();
    if (drainAfterQueue) this.host.requestDataDrain();
  }

  /** ACK 簿记（§10.3）：返回 'ok' | 'zombie' | 'violation'（never-sent → 连接级 fatal）。 */
  onAck(sequence: number): 'ok' | 'zombie' | 'violation' {
    if (this.inFlight.has(sequence)) {
      const entry = this.inFlight.get(sequence)!;
      const wasOldest = sequence === this.oldestInFlightSeq();
      this.inFlight.delete(sequence);
      if (this.inFlight.size === 0) {
        this.disarmAckTimer();
      } else if (wasOldest) {
        // 最老在途完成后，以当前时刻为新锚重挂剩余窗口，避免部分进度仍被旧计时锚整窗弃置。
        this.disarmAckTimer();
        this.armAckTimer();
      }
      // §6.5 U2：ack 收妥记账（latency = 收到 ACK 时刻 − 帧出队发送时刻；只作差）
      const t1 = safeNow(() => this.host.now?.());
      const latencyMs =
        entry.sentAt !== undefined && t1 !== undefined ? t1 - entry.sentAt : undefined;
      this.host.onUpdateAcked({
        bytes: entry.bytes,
        sequence,
        ...(latencyMs !== undefined ? { latencyMs } : {}),
        // issue #245（DD3）：末 chunk 条目标记透传——facet 据此改道发 chunked-update-acked
        ...(entry.chunked !== undefined ? { chunked: true as const } : {}),
      });
      if (this.queued.length > 0 || this.host.hasBulkTransferWork?.() === true) {
        this.host.requestDataDrain(); // §6.2：原同步 flush 循环 → 连接级 drain（M3：bulk 载体窗口空位唤醒）
      }
      return 'ok';
    }
    if (this.zombieSeqs.has(sequence)) {
      this.zombieSeqs.delete(sequence);
      return 'zombie';
    }
    return 'violation';
  }

  /** 已收到对端 RESYNC_REQUIRED（§10.6）：丢弃本端未发送增量、置 needs-resync。
   *  本轮声明与状态迁移由控制器负责（发送方约束——不得重复声明）。 */
  markResyncReceived(): void {
    this.needsResync = true;
    this.discardQueued();
  }

  /** session 层溢出边沿（§12 命中分派）：同 §10.6 同构处置。 */
  markSessionResyncEdge(): void {
    this.markResyncReceived();
  }

  /** 未发送队列溢出判据（§17 L479–486 分列限制 + L488「未发送队列」任一上限超出）。
   *  R2-3：in-flight 窗口是独立限制（§10.2 L279「窗口满只暂停发送」），不得计入
   *  queued count/bytes 判据——否则合法满窗口会让第一笔未发送 UPDATE 提前溢出。 */
  private overflows(incoming: Uint8Array): boolean {
    if (this.queued.length >= this.host.limits.maxQueuedUpdateCount) return true;
    return this.queuedByteCount + incoming.byteLength > this.host.limits.maxQueuedUpdateBytes;
  }

  private discardQueued(): void {
    this.queued.length = 0;
    this.queuedByteCount = 0;
    // issue #243（DD-3.7，F2）：结构性单点——discardQueued 是全部「队列清空」路径的
    // 汇聚点，内联清除使任何清队列路径自动终止在途 chunked transfer（载体随队列消失；
    // needsResync ⇒ 无 activeTransfer 推论由此闭环）。abandonInFlight（ACK timeout）不
    // 经本路径——其载体保留、走显式清除（DD-3.7）。
    this.clearActiveTransfer();
  }

  /** issue #243（DD-3.7）：唯一清除点（私有；discardQueued 内联 + abandonInFlight 显式
   *  + 末 chunk 结算内联）。只清状态——载体队列项的去留由调用路径决定。 */
  private clearActiveTransfer(): void {
    this.activeTransfer = undefined;
  }

  /** issue #243（DD-2.3）：可分块判据——「已协商 ∧ 超限 ∧ ≤ maxChunkedUpdateBytes ∧
   *  transferId 域未耗尽」。未协商连接恒 false（v1 逐字节：超限判定仍在 deliver/drain
   *  sendAndRegister 时刻原样进行）。 */
  private isChunkable(bytes: Uint8Array): boolean {
    return (
      bytes.byteLength > this.host.limits.maxUpdateBytes &&
      bytes.byteLength <= this.host.limits.maxChunkedUpdateBytes &&
      this.transferIdAvailable() &&
      this.host.chunkedSendEnabled()
    );
  }

  /** issue #231：失败时刻计数采样（调用点纪律 = 先采样、后 discardQueued——丢弃后
   *  计数恒零，诊断价值丢失）。返回惰性明细供给器：仅 observer 在场时被求值，
   *  无 observer 时明细对象零构造（§23.4 逐字节等价纪律）。 */
  private captureFailureDetail(
    reason: ReplicationSendFailureReason,
    updateBytes: number,
  ): () => UpdateSendFailureDetail {
    const maxUpdateBytes = this.host.limits.maxUpdateBytes;
    const queuedUpdateCount = this.queued.length;
    const queuedUpdateBytes = this.queuedByteCount;
    const inFlightCount = this.inFlight.size;
    return () => ({
      reason,
      updateBytes,
      maxUpdateBytes,
      queuedUpdateCount,
      queuedUpdateBytes,
      inFlightCount,
    });
  }

  private sendAndRegister(bytes: Uint8Array, oldestQueuedAt?: number): void {
    if (bytes.byteLength > this.host.limits.maxUpdateBytes) {
      // R2-1：超限面判别（唯一可达形态 = 单笔项自身超限，§2.1①——贪心合并以累计
      // 原始字节 ≤ maxUpdateBytes 为上界，多项帧结构性不可能超限）。该项无论走哪条
      // 路径都永不可 wire——F4 丢弃语义不变；但丢弃必须可修复：
      //  - 队列非空：同一次 drain 后续 pass 照发合法项（D4 钉死——R2-N1 活性），
      //    丢失项由既有配置病理立场与下一次 reconciliation 修复；
      //  - 队列已空：丢弃即终局静默（三个 drain 触发点均不可达），
      //    ⇒ §10.2 同构响亮收口。
      if (this.queued.length === 0) {
        // issue #231：失败时刻采样（队列已空——计数恒零，口径与 send-frame-rejected 一致）
        const detail = this.captureFailureDetail('update-too-large', bytes.byteLength);
        this.discardQueued();            // no-op（队列已空）；保持 §17 L488「丢弃全部未发送」形状
        this.needsResync = true;         // 停发新 UPDATE（deliver 首行丢弃）
        this.host.declareLocalResync('send-failed', detail); // peer: RESYNC_REQUIRED{send-queue-overflow}
                                                      // + setState + maybeStartRecovery；
                                                      // hub: declareHubResync 同构
      } else {
        // issue #231 AC1 补盲：队列非空 = 无 resync 声明的静默丢弃——发出观测信号
        // （update-dropped{update-too-large}），observer 不再漏掉该分支。
        // 采样口径：被丢弃项已出队，queued* 为残余队列体量（≠0 即本分支判别证）。
        this.host.noteUpdateDropped(
          this.captureFailureDetail('update-too-large', bytes.byteLength),
        );
      }
      return; // 不调用 host.sendUpdateFrame——控制器大小门保留为不可达后盾
    }
    const seq = this.host.sendUpdateFrame(bytes);
    if (seq <= 0) {
      // issue #231：发送路径拒绝（连接/状态/背压/编码/发送异常折叠为非正 sequence）——
      // 失败明细必须在 discardQueued 之前采样（丢弃后计数恒零，丢失诊断价值）。
      const detail = this.captureFailureDetail('send-frame-rejected', bytes.byteLength);
      this.discardQueued();
      this.needsResync = true;
      this.host.declareLocalResync('send-failed', detail);
      return;
    }
    // §6.5 U2：发送时刻记账（帧实际出队后；clock 缺省 → undefined；throw → 缺面）
    const sentAt = safeNow(() => this.host.now?.());
    this.inFlight.set(seq, {
      bytes: bytes.byteLength,
      ...(sentAt !== undefined ? { sentAt } : {}),
    });
    // issue #238 §5.4：sendQueueMs = 帧出队 − 帧内最旧业务项入队（发送方进程内精确；
    // clock 缺省 → 缺面）。update-sent 发射信息随记账回调传出（发射方做 observer 门）。
    const sendQueueMs =
      sentAt !== undefined && oldestQueuedAt !== undefined ? sentAt - oldestQueuedAt : undefined;
    this.host.noteUpdateSent({
      sequence: seq,
      bytes: bytes.byteLength,
      ...(sendQueueMs !== undefined ? { sendQueueMs } : {}),
    });
    this.armAckTimer();
  }

  /**
   * 连接级 data 出队：取一帧发送（§4.5/§6.2，issue #137）。
   *
   * 入口前置（R2 钉死，SA2 #5——任一不满足 → 返回 false 且不消费队列项）：
   *  ① 控制器 state === 'live'（facet 层门，§6.3——本方法不含该门）；
   *  ② channel !needsResync；
   *  ③a in-flight transfer 在场：仅查 dataGateOpen（槽已自持，不查窗口空位，DD-3.4）——
   *     发下一 chunk（末 chunk 出站 shift 载体并注册 inFlight）；
   *  ③b 否则 effectiveInFlightCount() < maxInFlightUpdates（窗口空位——有效占用口径，
   *     无 transfer 时与 v1 裸口径同义）；
   *  ④ queued.length > 0；
   *  ⑤ host.dataGateOpen()（闸门开）。
   *
   * 取帧（§5 合并策略）：队首可分块 → 在 queued[0] 上初始化 transfer（不经 takeItems、
   * 不 shift）并出 chunk 0；队首超限但不可分块 → 走既有取帧-超限分支原样（消费即进展）；
   * 队首不超限 → 贪心 Y.mergeUpdates 合并（累计原始字节 ≤ maxUpdateBytes，至少一项）。
   * **出队核减 = 被取出各项的入账字节数之和**；transfer 载体整项保留至末 chunk 出站
   * （R4 保守记账，压力方向安全）。
   *
   * 返回值语义（R3 钉死，SA2 R2-N1·方案 A——「消费即进展」）：true ⇔ 消费了 ≥1
   * 队列项或发送了 1 个中间 chunk（F4 丢弃也是进展）；false ⇔ 前置任一不满足（未消费）。
   */
  pullAndSendOne(): boolean {
    if (this.needsResync) return false;
    if (this.activeTransfer !== undefined) {
      // F2 不变量：needsResync ⇒ 无 activeTransfer（全部置位路径经清除点）——此处
      // needsResync 已早退；防御性保持 queued 非空（守恒不变量，结构性恒成立）。
      if (this.queued.length === 0) {
        this.clearActiveTransfer();
        return false;
      }
      if (!this.host.dataGateOpen()) return false;
      return this.sendOneChunk();
    }
    if (this.effectiveInFlightCount() >= this.host.limits.maxInFlightUpdates) return false;
    if (this.queued.length === 0) return false;
    if (!this.host.dataGateOpen()) return false;
    if (this.isChunkable(this.queued[0]!.bytes)) {
      this.startTransfer(this.queued[0]!);
      return this.sendOneChunk();
    }
    const items = this.takeItems();
    const frame = this.mergeItems(items);
    // issue #238 §5.4：合并帧 sendQueueMs 口径 = 帧内最旧业务项入队时刻（takeItems
    // 按 FIFO shift——首项即最旧）
    this.sendAndRegister(frame, items[0]?.queuedAt);
    return true;
  }

  /** issue #243（DD-3.2）：在 queued[0]（= 载体项，不 shift）上初始化 transfer。调用方
   *  前置已确认窗口空位（有效占用口径）与 chunkable 判据。transferId 自 1 严格递增。 */
  private startTransfer(item: QueuedItem): void {
    const totalBytes = item.bytes.byteLength;
    this.activeTransfer = {
      item,
      // issue #295 切片 2（D2）：单点分配（kind=0 与 kind=1/2 共用同一计数器）
      transferId: this.allocateTransferId(),
      chunkIndex: 0,
      totalBytes,
      chunkCount: chunkCountOf(totalBytes, this.host.limits.maxUpdateBytes),
    };
  }

  /** issue #243（DD-3.5/3.6）：发出下一 chunk。返回 true ⇔ 本次调用取得进展（中间
   *  chunk 出站 / 末 chunk 结算 / 失败弃置均算进展——drain 循环「消费即进展」语义）。
   *
   *  末 chunk 出站：shift 载体 + 核减记账 → inFlight.set(末 chunk 帧序, {bytes: 总长,
   *  出站时刻, chunked: true}) → armAckTimer → 清 activeTransfer（槽位 1→1 转换，任意
   *  时刻 effectiveInFlightCount ≤ max 且裸 inFlight.size ≤ max）→ noteUpdateSent{末序,
   *  总长, chunked 组}（issue #245：facet 改道发 chunked-update-sent——transfer 完成出站
   *  恰一，非逐 chunk）。
   *  中间 chunk：不注册 inFlight、不挂 timer、零 noteUpdateSent 通知（#245：chunked 族
   *  事件只在完成出站时刻发射，中间 chunk 零事件——B1 不变）。
   *  出站拒绝（seq ≤ 0）：与单帧失败同构——采样失败明细 → discardQueued（transfer 随
   *  队列一并终止）→ needsResync → declareLocalResync('send-failed')。 */
  private sendOneChunk(): boolean {
    const transfer = this.activeTransfer!;
    const maxChunk = this.host.limits.maxUpdateBytes;
    const { start, end } = chunkBounds(transfer.totalBytes, maxChunk, transfer.chunkIndex);
    const seq = this.host.sendUpdateChunkFrame({
      // issue #295 切片 2（D5）：kind=0 出站 piece 显式携首字段（wire 字节不变——codec 本就编 0）
      transferKind: 0,
      transferId: transfer.transferId,
      chunkIndex: transfer.chunkIndex,
      chunkCount: transfer.chunkCount,
      totalBytes: transfer.totalBytes,
      bytes: transfer.item.bytes.subarray(start, end),
    });
    if (seq <= 0) {
      // issue #231 同款纪律：失败明细先于 discardQueued 采样（丢弃后计数恒零）。
      const detail = this.captureFailureDetail('send-frame-rejected', transfer.totalBytes);
      this.discardQueued();
      this.needsResync = true;
      this.host.declareLocalResync('send-failed', detail);
      return true;
    }
    const sentAt = safeNow(() => this.host.now?.());
    const isLast = transfer.chunkIndex + 1 >= transfer.chunkCount;
    if (isLast) {
      // 载体出队核减 = 整项入账字节（R4：transfer 期间保守超计至末 chunk）。守恒不变量
      // （queued[0] === 载体项）由「初始化不 shift / 仅末 chunk 结算 shift」结构性保证。
      const head = this.queued.shift()!;
      this.queuedByteCount -= head.bytes.byteLength;
      this.inFlight.set(seq, {
        bytes: transfer.totalBytes,
        ...(sentAt !== undefined ? { sentAt } : {}),
        // issue #245（DD3）：末 chunk 条目标记——ACK 结算改道判据
        chunked: true,
      });
      this.activeTransfer = undefined;
      // issue #245（R21/DD3）：改道——携带 chunked 上下文组，facet 据此发
      // chunked-update-sent（transferId/chunkCount/totalBytes；bytes = totalBytes 既有语义）。
      // R27 定死：本路径不计算/不携带 sendQueueMs——sendOneChunk 只服务 chunked transfer，
      // chunked 族事件键集不含该字段（DD1 排除），其计算为死代码（普通帧路径
      // sendAndRegister 的 sendQueueMs 逐字节不变——N1/N3 锚）。
      this.host.noteUpdateSent({
        sequence: seq,
        bytes: transfer.totalBytes,
        chunked: { transferId: transfer.transferId, chunkCount: transfer.chunkCount },
      });
      this.armAckTimer();
    } else {
      transfer.chunkIndex += 1;
    }
    return true;
  }

  /** §5 取帧：窗口可全吸收 → 逐笔一帧；窗口是瓶颈（queuedCount > avail）→ 贪心合并。 */
  private takeItems(): QueuedItem[] {
    const avail = this.host.limits.maxInFlightUpdates - this.inFlight.size;
    if (this.queued.length > avail) {
      const items: QueuedItem[] = [];
      let total = 0;
      while (this.queued.length > 0) {
        const next = this.queued[0]!;
        // 至少一项；此后累计原始字节 ≤ maxUpdateBytes（贪心上界）
        if (items.length > 0 && total + next.bytes.byteLength > this.host.limits.maxUpdateBytes) break;
        const item = this.queued.shift()!;
        items.push(item);
        total += item.bytes.byteLength;
        this.queuedByteCount -= item.bytes.byteLength; // 核减 = 入账字节数之和（§5 R2）
      }
      return items;
    }
    const item = this.queued.shift()!;
    this.queuedByteCount -= item.bytes.byteLength;
    return [item];
  }

  /** 单项原样成帧；多项 Y.mergeUpdates（§10.1 未发送合并；P-6）。 */
  private mergeItems(items: QueuedItem[]): Uint8Array {
    if (items.length === 1) return items[0]!.bytes;
    return Y.mergeUpdates(items.map((item) => item.bytes));
  }

  /** live 进入时的恢复清理：清 needs-resync、请求连接级 drain 放行队列残余。 */
  resetForLive(): void {
    this.needsResync = false;
    this.host.requestDataDrain();
  }

  /** §4.4 连接总压 shed → §10.2 同构处置：丢全部未发送 + needs-resync（停发新 UPDATE）。
   *  声明/恢复拓扑分派由控制器（facet）负责——通道只做队列与标记。 */
  discardForConnectionPressure(): void {
    this.discardQueued();
    this.needsResync = true;
  }

  /** 全部 in-flight 弃置（§10.4 ACK timeout）：迟至 ACK 良性；窗口视为收口。
   *  issue #243（DD-3.7/F6）：入口先捕获 `abortedTransfer = (activeTransfer 在场)`
   *  （于显式清除之前），再显式清 transfer（载体保留 queued[0]——v1 冻结队列跨
   *  ack-timeout 保留、恢复后续排语义不变，不得改 discardQueued），随后以
   *  `onAckTimeout(abortedTransfer)` 上抛：hub 控制器既有漏斗声明不变；peer 控制器在
   *  true 时经漏斗补发 wire RESYNC_REQUIRED（仅协商连接可触达），false 时 PN6b 原体。 */
  abandonInFlight(): void {
    const abortedTransfer = this.activeTransfer !== undefined;
    for (const seq of this.inFlight.keys()) {
      this.zombieSeqs.add(seq);
    }
    this.inFlight.clear();
    this.disarmAckTimer();
    this.needsResync = true;
    this.clearActiveTransfer(); // 显式清除（不弃队列——载体保留）
    this.host.onAckTimeout(abortedTransfer);
  }

  /** 连接收口：全部在途按迟至 ACK 弃置处理（连接死亡，zombie 记账无意义——清空）。
   *  issue #243（DD-3.2）：nextTransferId 归 1——teardown = 连接收口/新连接会话建立的
   *  标记，transferId 作用域 = (连接, 方向, ns)（ADR 0013:32；旧作用域 assembly 随连接
   *  拆除即弃，无跨作用域歧义）。 */
  teardown(): void {
    this.disarmAckTimer();
    this.inFlight.clear();
    this.zombieSeqs.clear();
    this.discardQueued();
    this.needsResync = true;
    this.nextTransferId = 1;
  }

  /** 当前最老在途序列；Map 保持实际发送插入序。 */
  private oldestInFlightSeq(): number | undefined {
    return this.inFlight.keys().next().value as number | undefined;
  }

  private armAckTimer(): void {
    if (this.ackTimerArmed) return;
    this.ackTimerArmed = true;
    this.ackTimerHandle = this.host.armTimer(() => {
      this.ackTimerArmed = false;
      this.ackTimerHandle = undefined;
      if (this.inFlight.size > 0) this.abandonInFlight();
    }, this.host.ackTimeoutMs);
  }

  private disarmAckTimer(): void {
    if (!this.ackTimerArmed) return;
    this.ackTimerArmed = false;
    if (this.ackTimerHandle !== undefined) {
      this.host.clearTimer(this.ackTimerHandle);
      this.ackTimerHandle = undefined;
    }
  }
}

/** RE-export 以便调用方统一 import（哨兵类型）。 */
export type UpdateChannelControl = ReplicationMessage;

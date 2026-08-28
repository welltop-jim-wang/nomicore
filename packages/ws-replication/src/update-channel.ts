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
import type { ResolvedLimits } from './types.js';

export interface UpdateChannelHost {
  readonly limits: ResolvedLimits;
  readonly ackTimeoutMs: number;
  /** 发送 UPDATE 帧；返回分配的帧序。 */
  readonly sendUpdateFrame: (bytes: Uint8Array) => number;
  /** 本端声明 RESYNC（§10.2 溢出/ACK timeout/session 溢出边沿）：ns → needs-resync + RESYNC 帧。 */
  readonly declareLocalResync: () => void;
  /** 非 live 溢出（§5.3）：丢弃未发送 + 置 pendingResync（round 完成时再开 round）。 */
  readonly notePendingResync: () => void;
  /** ACK timeout（§10.4）：弃置 in-flight + needs-resync + 立即新 round。 */
  readonly onAckTimeout: () => void;
  readonly armTimer: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
  /** 连接级 data 水位闸门（§4.2；issue #137）：true = 可发送。 */
  readonly dataGateOpen: () => boolean;
  /** data 入队成功回调（§4.4 连接总压/wheel 登记；issue #137）。 */
  readonly onDataQueued: () => void;
  /** 请求连接级 drain（§4.5；issue #137）：ACK 空位/恢复/resetForLive 触发。 */
  readonly requestDataDrain: () => void;
}

interface QueuedItem {
  readonly bytes: Uint8Array;
}

export class UpdateChannel {
  readonly inFlight = new Map<number, Uint8Array>();
  readonly zombieSeqs = new Set<number>();
  private readonly queued: QueuedItem[] = [];
  private queuedByteCount = 0;
  /** 本通道的 needs-resync 标记（§10.2 溢出 / §10.4 弃置 / §10.6 对端声明 / §12 边沿 / §4.4 shed）。 */
  needsResync = false;
  private ackTimerHandle: unknown | undefined;
  private ackTimerArmed = false;

  constructor(private readonly host: UpdateChannelHost) {}

  get inFlightCount(): number {
    return this.inFlight.size;
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
    if (mode === 'live') {
      // F1（SA4 修复，2026-08-29）：闸门检查**先行**——dataGateOpen 非纯读（暂停段
      // 撤压时 observeWater → resume → 同步 drainData 重入消费窗口空位）；闸门先求值
      // 完成后窗口检查读的是 drain 后真值，直发条件（窗口有空位 ∧ 闸门开）在发送
      // 时刻成立（协议 §10.2 / 设计 §4.1）。
      if (this.host.dataGateOpen() && this.inFlight.size < this.host.limits.maxInFlightUpdates) {
        this.sendAndRegister(bytes);
        return;
      }
    }
    // 到此处：窗口满（live）或闸门关（live）或 deferred → 入有界队列
    if (this.overflows(bytes)) {
      this.discardQueued();
      if (mode === 'live') {
        this.needsResync = true;
        this.host.declareLocalResync();
      } else {
        this.host.notePendingResync();
      }
      return;
    }
    this.queued.push({ bytes });
    this.queuedByteCount += bytes.byteLength;
    // §4.4：入队成功后通知连接级（RR wheel 登记 + 连接总压检查）。
    this.host.onDataQueued();
  }

  /** ACK 簿记（§10.3）：返回 'ok' | 'zombie' | 'violation'（never-sent → 连接级 fatal）。 */
  onAck(sequence: number): 'ok' | 'zombie' | 'violation' {
    if (this.inFlight.has(sequence)) {
      this.inFlight.delete(sequence);
      if (this.inFlight.size === 0) this.disarmAckTimer();
      if (this.queued.length > 0) this.host.requestDataDrain(); // §6.2：原同步 flush 循环 → 连接级 drain
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

  /** 每笔 UPDATE 的大小门（§17 配置保证单笔必可发送——校验侧不 clamp）。 */
  private overflows(incoming: Uint8Array): boolean {
    const pending = this.inFlight.size + this.queued.length;
    if (pending >= this.host.limits.maxQueuedUpdateCount) return true;
    let pendingBytes = this.queuedByteCount;
    for (const bytes of this.inFlight.values()) pendingBytes += bytes.byteLength;
    return pendingBytes + incoming.byteLength > this.host.limits.maxQueuedUpdateBytes;
  }

  private discardQueued(): void {
    this.queued.length = 0;
    this.queuedByteCount = 0;
  }

  private sendAndRegister(bytes: Uint8Array): void {
    const seq = this.host.sendUpdateFrame(bytes);
    if (seq <= 0) return; // F4：发送侧未出队（超限丢弃/连接已收口）→ 零 in-flight 幽灵登记
    this.inFlight.set(seq, bytes);
    this.armAckTimer();
  }

  /**
   * 连接级 data 出队：取一帧发送（§4.5/§6.2，issue #137）。
   *
   * 入口前置五条（R2 钉死，SA2 #5——任一不满足 → 返回 false 且不消费队列项）：
   *  ① 控制器 state === 'live'（facet 层门，§6.3——本方法不含该门）；
   *  ② channel !needsResync；
   *  ③ inFlight.size < maxInFlightUpdates（窗口空位——原 flushQueued 循环条件移入
   *     单帧前置，无循环可依托，超窗发射风险以本前置杜绝）；
   *  ④ queued.length > 0；
   *  ⑤ host.dataGateOpen()（闸门开）。
   *
   * 取帧（§5 合并策略）：queuedCount > avail → 贪心 Y.mergeUpdates 合并一帧（累计
   * 原始字节 ≤ maxUpdateBytes，至少一项）；否则逐笔一帧。**出队核减 = 被取出各项的
   * 入账字节数之和**（合并产物实长只用于 inFlight 记账与本帧 maxUpdateBytes 判据）。
   *
   * 返回值语义（R3 钉死，SA2 R2-N1·方案 A——「消费即进展」）：true ⇔ 消费了 ≥1
   * 队列项（F4 丢弃也是进展）；false ⇔ 前置任一不满足（未消费）。与 #136
   * flushQueued 循环（F4 后继续消费下一项）逐语义对齐——超限项消费后，同一次
   * drain 的后续 pass 即拉到合法项，不依赖任何未来触发点。
   */
  pullAndSendOne(): boolean {
    if (this.needsResync) return false;
    if (this.inFlight.size >= this.host.limits.maxInFlightUpdates) return false;
    if (this.queued.length === 0) return false;
    if (!this.host.dataGateOpen()) return false;
    const items = this.takeItems();
    const frame = this.mergeItems(items);
    this.sendAndRegister(frame);
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

  /** 全部 in-flight 弃置（§10.4 ACK timeout）：迟至 ACK 良性；窗口视为收口。 */
  abandonInFlight(): void {
    for (const seq of this.inFlight.keys()) {
      this.zombieSeqs.add(seq);
    }
    this.inFlight.clear();
    this.disarmAckTimer();
    this.needsResync = true;
    this.host.onAckTimeout();
  }

  /** 连接收口：全部在途按迟至 ACK 弃置处理（连接死亡，zombie 记账无意义——清空）。 */
  teardown(): void {
    this.disarmAckTimer();
    this.inFlight.clear();
    this.zombieSeqs.clear();
    this.discardQueued();
    this.needsResync = true;
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

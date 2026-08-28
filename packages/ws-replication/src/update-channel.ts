/**
 * update-channel —— 单方向 UPDATE 通道：滑动窗口/有界队列/ACK 簿记/溢出（§10）。
 *
 * 每 (ns, 方向) 一个实例（peer 上行 / hub→peer 下行对称）。序列号在「帧实际出队
 * 发送时」由宿主连接层分配（§4.1 R3/#7）——本通道的 `send` 回调即该分配点。
 */
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
}

interface QueuedItem {
  readonly bytes: Uint8Array;
}

export class UpdateChannel {
  readonly inFlight = new Map<number, Uint8Array>();
  readonly zombieSeqs = new Set<number>();
  private readonly queued: QueuedItem[] = [];
  private queuedBytes = 0;
  /** 本通道的 needs-resync 标记（§10.2 溢出 / §10.4 弃置 / §10.6 对端声明 / §12 边沿）。 */
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

  /** listener 交付（§10.1）。由控制器按 ns 状态选择 live 或 deferred 路径；终态零调用。 */
  deliver(bytes: Uint8Array, mode: 'live' | 'deferred'): void {
    if (this.needsResync) return; // §10.1 首行：溢出/恢复声明后丢弃（round 修复）
    if (mode === 'live') {
      if (this.inFlight.size < this.host.limits.maxInFlightUpdates) {
        this.sendAndRegister(bytes);
        return;
      }
    }
    // 到此处：窗口满（live）或 deferred → 入有界队列
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
    this.queuedBytes += bytes.byteLength;
  }

  /** ACK 簿记（§10.3）：返回 'ok' | 'zombie' | 'violation'（never-sent → 连接级 fatal）。 */
  onAck(sequence: number): 'ok' | 'zombie' | 'violation' {
    if (this.inFlight.has(sequence)) {
      this.inFlight.delete(sequence);
      if (this.inFlight.size === 0) this.disarmAckTimer();
      this.flushQueued();
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
    let pendingBytes = this.queuedBytes;
    for (const bytes of this.inFlight.values()) pendingBytes += bytes.byteLength;
    return pendingBytes + incoming.byteLength > this.host.limits.maxQueuedUpdateBytes;
  }

  private discardQueued(): void {
    this.queued.length = 0;
    this.queuedBytes = 0;
  }

  private sendAndRegister(bytes: Uint8Array): void {
    const seq = this.host.sendUpdateFrame(bytes);
    this.inFlight.set(seq, bytes);
    this.armAckTimer();
  }

  /** 窗口收口/恢复完成后把队列按序发出（round-robin 语义由上层保证单 ns 直发）。 */
  flushQueued(): void {
    while (
      !this.needsResync &&
      this.inFlight.size < this.host.limits.maxInFlightUpdates &&
      this.queued.length > 0
    ) {
      const item = this.queued.shift()!;
      this.queuedBytes -= item.bytes.byteLength;
      this.sendAndRegister(item.bytes);
    }
  }

  /** live 进入时的恢复清理：清 needs-resync、flush 队列。 */
  resetForLive(): void {
    this.needsResync = false;
    this.flushQueued();
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

/**
 * backpressure —— 连接级发送调度（协议 §17 / ADR 0010 L151；每连接实例一个，
 * 随 transport 生命周期）。issue #137 新域 = 连接级四件事（设计 §0）：
 *
 *  ① bufferedAmount 高/低水位闸门（hysteresis + 注入 ReplicationTimer poll，
 *     §4.2）——缺失/非 number 属性 → 0 → 恒开（既有 makeWire 零影响）；
 *  ② control 保留额度记账（暂停段控制帧实际编码字节，OutboundQueue 出站回调
 *     单点回报）与 CONNECTION_BACKPRESSURE（1011）耗尽收口（§4.3）；
 *  ③ 连接总压记账与 shed：Σ facet.queuedBytes() > maxQueuedBytesPerConnection
 *     （严格大于）→ 按最大 queued namespace 依次收口（丢未发送 + needs-resync）
 *     直到 Σ ≤ cap（§4.4）；
 *  ④ data round-robin 轮转：插入序 wheel + 旋转游标，每轮每 ns 至多一帧
 *     （§4.5）。
 *
 * 属主边界（R0-2）：本模块只记账 ws-replication 自己的未发送 data 队列；零触碰
 * namespace-registry 的 session fanout 队列（切片 3 域）。不进 Runtime sequencer
 * （§11.2）：本模块不 import、不 await、不回调 Runtime/Lease/Registry——依赖方向
 * 保证，非约定。
 */
import { encodeMessage, type ReplicationMessage } from '@nomicore/replication-protocol';
import { codecFieldLimits } from './frame-io.js';
import type { ReplicationTimer, ResolvedLimits } from './types.js';

/** 连接级 data 调度面（由控制器/通道实现；设计 §6.1/§6.2/§6.3）。 */
export interface DataSenderFacet {
  /** 连接总压记账：本 ns 未发送 data 队列字节（口径=各项原始字节之和，§5 R2）。 */
  queuedBytes(): number;
  /** wheel 留轮判定：本 ns 是否有未发送 data。 */
  queuedCount(): number;
  /** 取一帧发送；true ⇔ 消费 ≥1 队列项（F4 丢弃也是进展，R3——「消费即进展」）。 */
  pullAndSendOne(): boolean;
  /** §4.4 shed → §10.2 同构处置（丢全部未发送 + needs-resync + 声明/pendingResync）。 */
  discardForConnectionPressure(): void;
}

/** ConnectionSender 宿主（连接层实现；设计 §6.1）。 */
export interface ConnectionSenderHost {
  readonly limits: ResolvedLimits;
  readonly timer: ReplicationTimer;
  /** 鸭子类型读取 transport.bufferedAmount（设计 §4.2；缺失/非法 → 0=无压力）。 */
  readBufferedAmount(): number;
  /** control 帧出站点（→ OutboundQueue.sendControl；无水位门，保留额度判据在 sendControl）。 */
  emitControl(message: ReplicationMessage): number;
  /** data 帧出站点（→ OutboundQueue.emit；序列号单点分配）。 */
  emitData(message: ReplicationMessage): number;
  /** 命名空间 facet 查询（peer: controllers map / hub: channels map）。 */
  facetOf(namespaceId: string): DataSenderFacet | undefined;
  /** 连接可发送性（peer: connState==='ready'；hub: 未收口）。 */
  isEmitAllowed(): boolean;
  /** §4.3 保留额度耗尽 → CONNECTION_BACKPRESSURE 分类连接失败（1011）。 */
  onBackpressureExhausted(): void;
}

/** 恢复检查间隔（§1.3-3 冻结常量；测试 1s×30 步进假设内，非配置）。 */
export const BACKPRESSURE_POLL_INTERVAL_MS = 1_000;

/** 单次 drain 的轮次限额（§4.5 注记 c：turns 截断不是终态——已发帧的 ACK 必再触发 drain）。 */
const DRAIN_TURN_LIMIT = 10_000;

export class ConnectionSender {
  private paused = false;
  private pollHandle: unknown | undefined;
  /** 暂停段累计已发出 control 帧的编码后实际字节数（§4.3 保留额度记账）。 */
  private controlReserveUsed = 0;
  /** 插入序 wheel（首次入队登记；队列清空/消失移除）。 */
  private readonly wheel: string[] = [];
  private cursor = 0;
  private tornDown = false;

  constructor(private readonly host: ConnectionSenderHost) {}

  // ─────────────────────────────── control / data 发送点 ───────────────────────────────

  /** control 发送点（§4.1/§4.3）：水位观察 + 保留额度判据 + emit（控制帧不被闸门阻塞）。
   *  R2-4：额度判据用独立配置 `controlReserveBytes`（§17 L490）；lowWater 仅保留
   *  §17 L492 恢复 dequeue 的水位迟滞语义（observeWater/poll），与额度无关。 */
  sendControl(message: ReplicationMessage): number {
    this.observeWater();
    if (this.paused) {
      const frameBytes = this.measureFrame(message);
      if (this.controlReserveUsed + frameBytes > this.host.limits.controlReserveBytes) {
        // §4.3 耗尽谓词（R2 钉死）：触发帧是首个会越界的帧——不发送、立即收口。
        this.host.onBackpressureExhausted();
        return 0;
      }
    }
    return this.host.emitControl(message);
  }

  /** data 发送尝试（§4.1 快速路径 + §4.2 观察②）：isEmitAllowed + 水位 + emit。 */
  tryEmitData(message: ReplicationMessage): number {
    if (!this.host.isEmitAllowed()) return 0;
    if (!this.dataGateOpen()) return 0;
    const frameBytes = this.measureFrame(message);
    if (frameBytes > this.host.limits.maxQueuedBytesPerConnection) return 0;
    const projected = this.host.readBufferedAmount() + this.totalQueuedBytes() + frameBytes;
    if (projected > this.host.limits.maxQueuedBytesPerConnection) return 0;
    return this.host.emitData(message);
  }

  /** data 闸门（§4.2 hysteresis）：> highWater → 暂停；暂停段 ≤ lowWater → 恢复 + drain。 */
  dataGateOpen(): boolean {
    this.observeWater();
    return !this.paused;
  }

  /** 任一通道 data 入队后（§4.4 触发点）：wheel 登记 → 总压检查。 */
  onDataQueued(namespaceId: string): void {
    if (this.tornDown) return;
    if (!this.wheel.includes(namespaceId)) {
      this.wheel.push(namespaceId);
    }
    this.enforceConnectionCap();
  }

  /** 出站帧实际编码字节回报（OutboundQueue onEmitted 单点；§4.3 记账判据来源）。 */
  onEmitted(info: Readonly<{ kind: 'control' | 'data'; byteLength: number }>): void {
    if (info.kind === 'control' && this.paused) {
      this.controlReserveUsed += info.byteLength;
    }
  }

  /** 请求排空（ACK 空位 / 恢复 / resetForLive）：!paused → drainData。 */
  requestDrain(): void {
    if (this.paused) return;
    this.drainData();
  }

  /** 连接收口/重拨/重建/停机的必经点：清 poll timer、清 wheel、复位（§8）。 */
  teardown(): void {
    this.tornDown = true;
    this.clearPoll();
    this.wheel.length = 0;
    this.cursor = 0;
    this.paused = false;
    this.controlReserveUsed = 0;
  }

  // ─────────────────────────────── §4.5 drain（RR 轮转） ───────────────────────────────

  private drainData(): void {
    if (this.tornDown || this.paused || !this.host.isEmitAllowed()) return;
    let turns = 0;
    while (this.wheel.length > 0 && turns < DRAIN_TURN_LIMIT) {
      turns += 1;
      let progressed = false;
      let visited = 0;
      while (visited < this.wheel.length) {
        const nsId = this.wheel[this.cursor]!;
        this.cursor = this.cursor + 1;
        if (this.cursor >= this.wheel.length) this.cursor = 0;
        visited += 1;
        const facet = this.host.facetOf(nsId);
        if (facet === undefined) {
          this.removeFromWheel(nsId);
          continue;
        }
        if (facet.queuedCount() === 0) {
          this.removeFromWheel(nsId);
          continue;
        }
        // 每轮每 ns 至多一帧；true ⇔ 消费 ≥1 项（F4 丢弃也是进展——R3「消费即进展」）
        if (facet.pullAndSendOne()) progressed = true;
        if (this.paused || !this.host.isEmitAllowed()) return; // 帧间水位复查（§4.5）
      }
      if (!progressed) return; // 全轮零消费（窗口满/live 门槛未过/闸门关）→ 退出，ACK 后再来
    }
  }

  // ─────────────────────────────── §4.2 水位观察 / poll ───────────────────────────────

  private observeWater(): void {
    const level = this.host.readBufferedAmount();
    if (level > this.host.limits.highWater) {
      this.enterPause();
      return;
    }
    if (this.paused && level <= this.host.limits.lowWater) {
      this.resume();
    }
  }

  private enterPause(): void {
    if (this.paused) return;
    this.paused = true;
    this.controlReserveUsed = 0;
    this.armPoll();
  }

  private resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.controlReserveUsed = 0;
    this.clearPoll();
    this.requestDrain(); // §4.2：恢复即立即 drain（设计走查：AC-6a/6b 恢复段由 poll 触发）
  }

  private armPoll(): void {
    if (this.pollHandle !== undefined) return;
    this.pollHandle = this.host.timer.setTimeout(() => {
      this.pollHandle = undefined;
      if (this.tornDown || !this.paused) return; // stale fire：零副作用、不重武装（§8）
      const level = this.host.readBufferedAmount();
      if (level > this.host.limits.lowWater) {
        this.armPoll(); // 一拍一查，不叠帧
        return;
      }
      this.resume();
    }, BACKPRESSURE_POLL_INTERVAL_MS);
  }

  private clearPoll(): void {
    if (this.pollHandle === undefined) return;
    this.host.timer.clearTimeout(this.pollHandle);
    this.pollHandle = undefined;
  }

  // ─────────────────────────────── §4.4 连接总压记账与 shed ───────────────────────────────

  private totalQueuedBytes(): number {
    let total = 0;
    for (const nsId of this.wheel) total += this.queuedBytesOf(nsId);
    return total;
  }

  private enforceConnectionCap(): void {
    const cap = this.host.limits.maxQueuedBytesPerConnection;
    while (true) {
      const total = this.totalQueuedBytes();
      if (total <= cap) return; // 触发用严格大于（§4.4 边界语义；AC-5 逐值吻合）
      const victim = this.pickVictim();
      if (victim === undefined) return;
      const facet = this.host.facetOf(victim);
      if (facet === undefined || facet.queuedBytes() === 0) return; // 无 data 可弃
      facet.discardForConnectionPressure(); // §10.2 同构处置（丢全部未发送 + needs-resync）
      this.removeFromWheel(victim); // 队列已空，不留轮
    }
  }

  /** 最大 queued namespace；并列取 wheel 序先者（确定性，§4.4）。 */
  private pickVictim(): string | undefined {
    let best: string | undefined;
    let bestBytes = 0;
    for (const nsId of this.wheel) {
      const bytes = this.queuedBytesOf(nsId);
      if (bytes > bestBytes) {
        bestBytes = bytes;
        best = nsId;
      }
    }
    return best;
  }

  private queuedBytesOf(nsId: string): number {
    const facet = this.host.facetOf(nsId);
    if (facet === undefined) return 0;
    const bytes = facet.queuedBytes();
    return bytes > 0 ? bytes : 0;
  }

  /** 移除（游标偏移可按移除位置微调——pass 内公平轻微偏斜、无跨 pass 饥饿，§4.5 b）。 */
  private removeFromWheel(namespaceId: string): void {
    const index = this.wheel.indexOf(namespaceId);
    if (index < 0) return;
    this.wheel.splice(index, 1);
    if (this.cursor > index) this.cursor -= 1;
    if (this.cursor >= this.wheel.length) this.cursor = 0;
  }

  // ─────────────────────────────── §4.3 帧长确定判据 ───────────────────────────────

  /**
   * 控制帧编码后实际字节数（判据必须确定，估算不可接受）。探针编码：envelope 的
   * sequence 是固定 4 字节大端字段（replication-protocol/envelope.ts writeBe32），
   * 帧长与序列号取值无关——探针序列与出站序列产生逐字节相同帧长，为「确定判据」。
   */
  private measureFrame(message: ReplicationMessage): number {
    return encodeMessage(message, {
      sequence: 0,
      maxFrameBytes: this.host.limits.maxFrameBytes,
      limits: codecFieldLimits(this.host.limits),
    }).byteLength;
  }
}

/**
 * backpressure —— 连接级发送调度（协议 §17 / ADR 0010 L151；每连接实例一个，
 * 随 transport 生命周期）。issue #169 记账纠偏（SA1 设计：统一连接账本 3.1-3.4、
 * 控制保留额度 §4、admission §5、shed §6、poll 公式 §7）：
 *
 *  ① bufferedAmount 高/低水位闸门（hysteresis + 注入 ReplicationTimer poll，
 *     间隔 = max(1, floor(ackTimeoutMs/100))，协议 §17 权威公式）——缺失/非 number
 *     属性 → 0 → 恒开（既有 makeWire 零影响）；
 *  ② control 保留额度 = 暂停窗口内**未冲刷**控制字节账本（controlUnflushed，冲刷即
 *     释放；耗尽 = CONNECTION_BACKPRESSURE（1011）收口）；阈值 maxQueuedControlBytes
 *     （缺省 8 MiB，≥ maxBootstrapBytes + 128 启动期响亮验证）；
 *  ③ 统一连接账本：P3 观察值 + P2 未吸收/未离开交接（FIFO handoffQueue：data 恒计、
 *     control 按 onEmitted 裁定注计）+ Σ P1 排队——admission（tryEmitData）与 shed 触发
 *     （enforceConnectionCap）共用（单一台账，无缝隙）；
 *  ④ shed：溢出触发（总压 > cap 严格大于）→ 按最大 queued namespace 依次整队丢弃
 *     至 queued 侧 ≤ lowWater（§17「整队丢弃至 queued 侧 ≤ low-water」）；
 *  ⑤ data round-robin 轮转：插入序 wheel + 旋转游标，每轮每 ns 至多一帧（不变）。
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
  /** poll 间隔公式输入（协议 §17 L492：max(1, floor(ackTimeoutMs/100))）。 */
  readonly ackTimeoutMs: number;
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
  /** 控制保留额度耗尽 → CONNECTION_BACKPRESSURE 分类连接失败（1011）。 */
  onBackpressureExhausted(): void;
}

/** 单次 drain 的轮次限额（§4.5 注记 c：turns 截断不是终态——已发帧的 ACK 必再触发 drain）。 */
const DRAIN_TURN_LIMIT = 10_000;

/** FIFO 交接队列成员：按交接序记录「已交给 transport、未被观察吸收/离开」的 chunk。 */
interface HandoffChunk {
  readonly kind: 'data' | 'control';
  /** 剩余未吸收字节；队首可原地缩减（observe 的 min 弹出）。 */
  bytes: number;
}

export class ConnectionSender {
  private paused = false;
  private pollHandle: unknown | undefined;
  /** P2 交接队列（FIFO，§3.1）：data 与 control 帧的压力相位账（I-1）。 */
  private readonly handoffQueue: HandoffChunk[] = [];
  /** = Σ kind==='data' 的 bytes（data 侧 P2 余额）。 */
  private pendingDataHandoff = 0;
  /** = Σ kind==='control' 的 bytes（control 侧 P2 余额；暂停窗口内交接的控制帧计——见 onEmitted 裁定注）。 */
  private controlPendingHandoff = 0;
  /** 策略账本（非压力相位）：暂停窗口内交接、未观察冲刷的控制字节——只喂额度判据（R3）。 */
  private controlUnflushed = 0;
  /** 最近一次观察基线（delta 对账，§3.2）。 */
  private lastObservedBuffered = 0;
  /** 恢复检查间隔 = max(1, floor(ackTimeoutMs/100))（协议 §17 权威公式，§7）。 */
  private readonly pollIntervalMs: number;
  /** 插入序 wheel（首次入队登记；队列清空/消失移除）。 */
  private readonly wheel: string[] = [];
  private cursor = 0;
  private tornDown = false;

  constructor(private readonly host: ConnectionSenderHost) {
    this.pollIntervalMs = Math.max(1, Math.floor(host.ackTimeoutMs / 100));
  }

  // ─────────────────────────────── control / data 发送点 ───────────────────────────────

  /** control 发送点（§4.1/§4.3）：水位观察 + 额度判据 + emit（控制帧不被闸门阻塞）。
   *  额度 = 暂停窗口内未冲刷控制字节账本（controlUnflushed）；触发帧是首个会越界的帧
   *  ——不发送、立即收口（CONNECTION_BACKPRESSURE）。 */
  sendControl(message: ReplicationMessage): number {
    this.observeWater();
    if (this.paused) {
      const frameBytes = this.measureFrame(message);
      if (this.controlUnflushed + frameBytes > this.host.limits.maxQueuedControlBytes) {
        // §4.3 耗尽谓词（R2 钉死）：触发帧是首个会越界的帧——不发送、立即收口。
        this.host.onBackpressureExhausted();
        return 0;
      }
    }
    return this.host.emitControl(message);
  }

  /** data 发送尝试（§5 严格接纳）：isEmitAllowed + 水位 + 单帧守卫 + 统一账本投影。 */
  tryEmitData(message: ReplicationMessage): number {
    if (!this.host.isEmitAllowed()) return 0;
    if (!this.dataGateOpen()) return 0;
    const frameBytes = this.measureFrame(message);
    if (frameBytes > this.host.limits.maxQueuedBytesPerConnection) return 0;
    // 严格接纳：P3 观察 + P2（data 与 control 未吸收/未离开，R4）+ Σ P1 排队 + 本帧 ≤ cap。
    // controlUnflushed 不计入（R3）：已吸收控制字节已在观察值内；未吸收的在 controlPendingHandoff。
    const projected =
      this.observe() + this.pendingDataHandoff + this.controlPendingHandoff
      + this.totalQueuedBytes() + frameBytes;
    if (projected > this.host.limits.maxQueuedBytesPerConnection) return 0;
    return this.host.emitData(message);
  }

  /** data 闸门（§4.2 hysteresis）：> highWater → 暂停；暂停段 ≤ lowWater → 恢复 + drain。 */
  dataGateOpen(): boolean {
    this.observeWater();
    return !this.paused;
  }

  /** 任一通道 data 入队后（§4.4 触发点）：wheel 登记 → 统一账本总压检查。 */
  onDataQueued(namespaceId: string): void {
    if (this.tornDown) return;
    if (!this.wheel.includes(namespaceId)) {
      this.wheel.push(namespaceId);
    }
    this.enforceConnectionCap();
  }

  /** 出站帧实际编码字节回报（OutboundQueue onEmitted 单点；§4.2 记账判据来源）。 */
  onEmitted(info: Readonly<{ kind: 'control' | 'data'; byteLength: number }>): void {
    if (this.tornDown) return; // 收口路径直发 ERROR 的回报零记账（§13.4）
    if (info.kind === 'control') {
      // 压力侧 P2（R4 注——裁定待 SA1/SA2 复核）：暂停窗口内的控制帧入共享 FIFO 恒计；
      // 非暂停控制帧不入 FIFO。设计 §4.2「controlPendingHandoff 恒计（不区分暂停）」与
      // §12.3「R1-1 判据同旧（P2 已被 observe 释放，projected 逐值同）」在
      // 「Δ≡0 段（gate-off/write-through-0）→ 随后 Δ>0」的混合观察面上互斥：恒计会把
      // Δ≡0 段交接的未观察控制字节作为 FIFO 首残差永久保留（总残差 = Σ未观察控制字节，
      // 不随后续 Δ 收敛——head-pop 语义下 min(|Δ|, 队列总余额) 的残差恒等），使 R1-1
      // 类边界（协议公式 64,808 ≤ cap 但 65,597 > cap）误拒一帧。本实现选 §12.3 面
      // （R1-1 判据同旧）：非暂停控制栈的压力盲区维持 PR #165/issue #137 基线口径
      // （SA2 T4 构想未入红灯契约——17 用例全部不依赖非暂停控制 P2 计总压）。
      if (this.paused) {
        this.handoffQueue.push({ kind: 'control', bytes: info.byteLength });
        this.controlPendingHandoff += info.byteLength;
        this.controlUnflushed += info.byteLength; // 策略侧：窗口内累计
      }
    } else {
      this.handoffQueue.push({ kind: 'data', bytes: info.byteLength }); // 压力侧 P2
      this.pendingDataHandoff += info.byteLength;
    }
  }

  /** 请求排空（ACK 空位 / 恢复 / resetForLive）：!paused → drainData。 */
  requestDrain(): void {
    if (this.paused) return;
    this.drainData();
  }

  /** 连接收口/重拨/重建/停机的必经点：清 poll timer、清 wheel、复位全部台账（§8）。 */
  teardown(): void {
    this.tornDown = true;
    this.clearPoll();
    this.wheel.length = 0;
    this.cursor = 0;
    this.paused = false;
    this.handoffQueue.length = 0;
    this.pendingDataHandoff = 0;
    this.controlPendingHandoff = 0;
    this.controlUnflushed = 0;
    this.lastObservedBuffered = 0;
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
    const level = this.observe(); // 迟滞判定前先对账（G3b 冲刷释放的观察点之一）
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
    this.controlUnflushed = 0; // 暂停窗口起点（新窗口从 0 计；D3c 探针 ACK 语义依赖此重置）
    this.armPoll();
  }

  private resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.controlUnflushed = 0; // 窗口关闭（resume ⇔ 观察值已 ≤ lowWater，缓冲基本排空）
    this.clearPoll();
    this.requestDrain(); // §4.2：恢复即立即 drain（设计走查：AC-6a/6b 恢复段由 poll 触发）
  }

  private armPoll(): void {
    if (this.pollHandle !== undefined) return;
    this.pollHandle = this.host.timer.setTimeout(() => {
      this.pollHandle = undefined;
      if (this.tornDown || !this.paused) return; // stale fire：零副作用、不重武装（§8）
      const level = this.observe(); // poll 也是对账点（冲刷释放）
      if (level > this.host.limits.lowWater) {
        this.armPoll(); // 一拍一查，不叠帧
        return;
      }
      this.resume();
    }, this.pollIntervalMs); // 协议 §17 权威公式派生间隔（替代固定 1000ms）
  }

  private clearPoll(): void {
    if (this.pollHandle === undefined) return;
    this.host.timer.clearTimeout(this.pollHandle);
    this.pollHandle = undefined;
  }

  // ─────────────────────────────── §3 统一连接账本 / §4.4 总压与 shed ───────────────────────────────

  /**
   * 读数 + 对账（§3.2/§3.3）：
   *  - Δ ≠ 0（吸收证据 / 离开证据）：FIFO 队首起弹出 min(|Δ|, 队列总余额) 字节
   *    （按 chunk kind 核减对应侧余额；队首 chunk 原地缩减）；双向释放——「吸收+冲刷
   *    同间隙」的 chunk 在恒动面上不留不可回收 stale（P2 无界累积 → 假拒/假 shed）；
   *  - Δ < 0 另释放策略账本：controlUnflushed -= min(|Δ|, controlUnflushed)
   *    （§4.2 G3b 冲刷即释放）。
   *  返回本次观察值。
   */
  private observe(): number {
    const level = this.host.readBufferedAmount();
    const delta = level - this.lastObservedBuffered;
    if (delta !== 0) {
      let remaining = Math.abs(delta);
      while (remaining > 0 && this.handoffQueue.length > 0) {
        const chunk = this.handoffQueue[0]!;
        const take = Math.min(chunk.bytes, remaining);
        if (chunk.kind === 'data') this.pendingDataHandoff -= take;
        else this.controlPendingHandoff -= take;
        chunk.bytes -= take;
        remaining -= take;
        if (chunk.bytes === 0) this.handoffQueue.shift();
      }
      if (delta < 0) {
        // 策略侧独立于压力侧：已吸收（Δ>0）≠ 已冲刷——吸收后仍占用额度（R2-A2a 语义锚）
        this.controlUnflushed -= Math.min(-delta, this.controlUnflushed);
      }
    }
    this.lastObservedBuffered = level;
    return level;
  }

  /** 连接总压（§3.4）：P3 观察 + P2 未吸收/未离开交接（data 与 control，各恰一次）+ Σ P1 排队。
   *  controlUnflushed 不在此（R3）：已吸收控制字节已在 lastObservedBuffered 内。 */
  private totalPressure(): number {
    return this.lastObservedBuffered + this.pendingDataHandoff
      + this.controlPendingHandoff + this.totalQueuedBytes();
  }

  private totalQueuedBytes(): number {
    let total = 0;
    for (const nsId of this.wheel) total += this.queuedBytesOf(nsId);
    return total;
  }

  private enforceConnectionCap(): void {
    const cap = this.host.limits.maxQueuedBytesPerConnection;
    this.observe(); // 决策点先观察（I-2；对账后 totalPressure 才是无缝隙口径）
    if (this.totalPressure() <= cap) return; // 触发：严格大于（I-3；恰好 cap 不触发）
    // 恢复目标 = queued 侧 ≤ lowWater（协议 §17「整队丢弃至 queued 侧 ≤ low-water」；
    // 触发后不止步于 cap——即便中途总压已回落也要清到 lowWater）
    while (this.totalQueuedBytes() > this.host.limits.lowWater) {
      const victim = this.pickVictim(); // 最大 queued 优先；并列取 wheel 序先者（不变，确定性）
      if (victim === undefined) break; // 无可弃（socket 侧压力 → 水位暂停/1011 承接域）
      const facet = this.host.facetOf(victim);
      if (facet === undefined || facet.queuedBytes() === 0) break;
      facet.discardForConnectionPressure(); // §10.2 同构处置（丢全部未发送 + needs-resync）
      if (facet.queuedBytes() > 0) break; // facet 契约防御：discard 后未清零即停（防活锁）
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

/**
 * @nomicore/namespace-runtime —— 写序列器 FIFO 骨架（D6，R2：真实写槽已挂接）：
 * 唯一排序机构。
 *
 * 语义：
 * - promise-chain 尾接尾：前项 settle（含 reject）后本项才开始执行——P0 从此获得
 *   「真实队首节点」地位（入队即 pending，绝不因同步执行而挂死构造栈）；
 * - 返回值即本项完成信号：泛型 Promise<T>（D7）——P0 用法 T=void（完成信号无消费方，
 *   runtime.ts 以 `void` 丢弃）；mutateData 写槽 T=MutateDataResult（携带槽结果联合
 *   值 / fatal rejection）——「返回完成信号」是 mutateData 接纳/屏障的全部依赖
 *   （D1/D2：写槽 S6 await notifyDirty 后槽才释放，return 即槽释放信号）；
 * - 链尾恒绿接线（settled.then(noop, noop)）：单项失败不阻断 FIFO（后续写仍取得
 *   槽——扩展位语义与 ADR-0008 一致），队列永不因单项失败断裂。
 *
 * 扩展位（SA8 边界注记 2，只文档不预写代码）：
 * - close barrier = enqueue(release 槽)——「前项 settle 后项方启」+「返回完成信号」
 *   恰好是这两个挂接点需要的全部性质。
 *
 * 模块零导出（sequencer 是包内实现；index.ts 不导出——AC2 锁定 runtime 上无
 * sequencer 键，类自身也不从公共入口出现）。
 */

/** 链尾接线 noop（消化前项 reject——INV-N12：链尾恒绿）。 */
function noop(): void {
  /* 有意为空：消化 reject，无 unhandled rejection */
}

/**
 * 槽类型标签（issue #238 §7 槽级记账；写序列器各入队点的业务分类——加性 label 参
 * 不触 FIFO 核心）。P0 = 启动预演；S = 业务 mutation 写槽；schema = SCHEMA 写槽；
 * E = enable replication 槽；R = remote apply 槽（replication-session A4）；
 * bump = epoch bump 槽；close-barrier = close/fence 队列终节点。
 */
export type SequencerSlotKind =
  | 'P0'
  | 'S'
  | 'E'
  | 'R'
  | 'schema'
  | 'bump'
  | 'close-barrier';

/**
 * 槽级样本（issue #238 §7；差值/计数，无绝对时间戳）——包内形状（sequencer 零公共
 * 导出；本形状经 runtime.ts seam 输入出包，registry 装配层以闭包盖 namespaceId 戳后
 * 转发宿主 sink——ADR-0008 L101「队列进度和内部事件属于日志、metrics 与 trace」落点）。
 * 仅注入 stageClock + slotMetrics 双在场时采样（D7：任一缺席 → 整条记账关闭）。
 */
export interface SequencerSlotSample {
  readonly slotKind: SequencerSlotKind;
  /** 本槽入队 → 开跑（对 S 槽即业务写在 FIFO 中的排队；注入时钟在场才有值）。 */
  readonly waitMs?: number;
  /** 本槽执行全程（开跑 → settle）。 */
  readonly runMs: number;
  /** 本槽开跑时刻写序列器中尚未开跑的排队任务数（含本槽自身——开跑瞬间本槽仍在队列计数内）。 */
  readonly queueDepthAtStart: number;
}

/** 槽级记账 sink（同步回调；调用纪律 = 槽释放后续体，sink throw 自捕获——绝不反哺槽内）。 */
export type SequencerSlotMetricsSink = (sample: SequencerSlotSample) => void;

/** 槽级记账配置（stageClock 与 slotMetrics 双在场才启用——构造期判定，运行时不可变）。 */
export interface WriteSequencerMetrics {
  readonly now: () => number;
  readonly sink: SequencerSlotMetricsSink;
}

/** 槽样本缓冲上限（冻结常量：有界环形语义——满则丢最旧，绝不无界增长；每槽 ≤1 样本，
 *  flush 在槽释放后续体，缓冲实际恒近空——上限是防御性纪律非容量需求）。 */
const SLOT_SAMPLE_BUFFER_CAPACITY = 1024;

/** 通用 FIFO 槽执行器（唯一排序机构）。 */
export class WriteSequencer {
  private tail: Promise<unknown> = Promise.resolve();
  /** 槽级记账（issue #238 §7）；undefined = 记账关闭（无 stageClock 或 sink——零开销路径）。 */
  private readonly metrics: WriteSequencerMetrics | undefined;
  /** 已入队未开跑的任务计数（私有；仅记账在场时维护）。 */
  private depth = 0;
  /** 槽样本缓冲（有界；满则丢最旧）。 */
  private samples: SequencerSlotSample[] = [];

  constructor(metrics?: WriteSequencerMetrics) {
    this.metrics = metrics;
  }

  /**
   * 入队：前项 settle（含 reject）后本项才开始执行；返回值即本项完成信号（携带
   * 槽结果 T——resolve 值或 rejection 原样传播，调用方持有）。
   * 入队回调经 .then 排程为微任务（ECMAScript PromiseJobs）——绝不在 enqueue
   * 调用栈内同步运行（INV-N1 机制根源，无需任何额外调度原语）。
   * FIFO 链形逐字节不变：`settled = this.tail.then(run, run)` +
   * `this.tail = settled.then(noop, noop)`（G1：不移动/移除/并行化槽序）。
   */
  enqueue<T>(run: () => Promise<T>, slotKind?: SequencerSlotKind): Promise<T> {
    const metrics = this.metrics;
    if (metrics === undefined) {
      // —— 记账关闭：与既有实现逐字节同形（零开销路径） ——
      const settled = this.tail.then(run, run); // 前项失败不阻断 FIFO
      this.tail = settled.then(noop, noop); // 链尾恒绿：队列永不因单项失败断裂
      return settled;
    }
    // —— 记账在场：加性包装（waitMs/runMs/queueDepth 采样；D7：clock throw → 本槽折叠
    //    为无样本路径——绝不外溢协议状态 / unhandledRejection） ——
    let admission: number | undefined;
    try {
      admission = metrics.now();
    } catch {
      admission = undefined;
    }
    if (admission === undefined) {
      // 时源缺面（throw/undefined）→ 本槽记账折叠：仍按纯 FIFO 入队
      const settled = this.tail.then(run, run);
      this.tail = settled.then(noop, noop);
      return settled;
    }
    this.depth += 1;
    const runMeasured = async (): Promise<T> => {
      const queueDepthAtStart = this.depth; // 含本槽自身（开跑瞬间仍在计数内）
      this.depth -= 1;
      let slotStart: number | undefined;
      try {
        slotStart = metrics.now();
      } catch {
        slotStart = undefined;
      }
      if (slotStart === undefined) return run(); // 时源缺面 → 折叠（零样本）
      try {
        return await run();
      } finally {
        let slotEnd: number | undefined;
        try {
          slotEnd = metrics.now();
        } catch {
          slotEnd = undefined;
        }
        if (slotEnd !== undefined && slotKind !== undefined) {
          // 槽内只入有界缓冲（O(1) push）；flush 在 settled 后续体（槽外调用纪律）
          this.pushSample({
            slotKind,
            waitMs: slotStart - admission,
            runMs: slotEnd - slotStart,
            queueDepthAtStart,
          });
        }
      }
    };
    const settled = this.tail.then(runMeasured, runMeasured); // 前项失败不阻断 FIFO
    this.tail = settled.then(noop, noop); // 链尾恒绿
    // 槽释放后续体 flush（sink 绝不入槽内同步栈；sink throw 自捕获）
    void settled.then(
      () => this.flushSamples(),
      () => this.flushSamples(),
    );
    return settled;
  }

  private pushSample(sample: SequencerSlotSample): void {
    if (this.samples.length >= SLOT_SAMPLE_BUFFER_CAPACITY) {
      this.samples.shift(); // 满则丢最旧（有界纪律；drop 不计数入样本——防御性上限）
    }
    this.samples.push(sample);
  }

  private flushSamples(): void {
    const sink = this.metrics?.sink;
    if (sink === undefined || this.samples.length === 0) return;
    const batch = this.samples;
    this.samples = [];
    for (const sample of batch) {
      try {
        sink(sample);
      } catch {
        // ADR-0007 L54「记录」面先例：sink 失败不是业务失败——静默丢弃，绝不反哺槽内
      }
    }
  }
}

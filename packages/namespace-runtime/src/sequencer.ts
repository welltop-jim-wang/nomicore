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

/** 通用 FIFO 槽执行器（唯一排序机构）。 */
export class WriteSequencer {
  private tail: Promise<unknown> = Promise.resolve();

  /**
   * 入队：前项 settle（含 reject）后本项才开始执行；返回值即本项完成信号（携带
   * 槽结果 T——resolve 值或 rejection 原样传播，调用方持有）。
   * 入队回调经 .then 排程为微任务（ECMAScript PromiseJobs）——绝不在 enqueue
   * 调用栈内同步运行（INV-N1 机制根源，无需任何额外调度原语）。
   */
  enqueue<T>(run: () => Promise<T>): Promise<T> {
    const settled = this.tail.then(run, run); // 前项失败不阻断 FIFO
    this.tail = settled.then(noop, noop); // 链尾恒绿：队列永不因单项失败断裂
    return settled;
  }
}

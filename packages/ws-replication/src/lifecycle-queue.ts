/**
 * lifecycle-queue —— per-namespace 单一生命周期队列 + 合流（§13.1）。
 *
 * 串行化 removeTarget / socket-close cleanup / session-close / lease-release；
 * cleanup Promise 记忆化合流（并发 removeTarget ×2 → 同一 Promise、恰一 CLOSE 帧）。
 */
export class LifecycleQueue {
  private tail: Promise<void> = Promise.resolve();

  /** 串行链追加操作：前序失败不阻断后续（每操作独立成败；本包 cleanup 恒绿）。 */
  enqueue(operation: () => Promise<void>): Promise<void> {
    const run = this.tail.then(operation, operation);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** 等待当前全部已入队操作结算（不追加）。 */
  settle(): Promise<void> {
    return this.tail;
  }
}

/** 记忆化合流器：并发调用押注到同一 Promise；结算后复用（幂等）。 */
export class Memoized {
  private memo: Promise<void> | undefined;

  constructor(private readonly executor: () => Promise<void>) {}

  get(): Promise<void> {
    if (this.memo === undefined) {
      this.memo = this.executor();
    }
    return this.memo;
  }
}

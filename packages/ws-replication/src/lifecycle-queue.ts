/**
 * lifecycle-queue —— per-namespace 单一生命周期队列 + 合流（§13.1）。
 *
 * 串行化 removeTarget / socket-close cleanup / session-close / lease-release；
 * cleanup Promise 记忆化合流（并发 removeTarget ×2 → 同一 Promise、恰一 CLOSE 帧）。
 *
 * 注（§5.3 死抽象清理）：hub 侧用内联 closeQueue promise 链、peer 侧用本文件的
 * Memoized + cleanupTail——两套并存即「非单一权威」；LifecycleQueue 类（零引用）
 * 已删除，收敛为 Memoized（peer-namespace.ts 在用，保留并更名注释见下）。
 */

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

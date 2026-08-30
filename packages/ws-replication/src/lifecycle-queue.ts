/**
 * lifecycle-queue —— per-namespace 生命周期队列原语（§13.1；issue #171 §D9 权威裁决）。
 *
 * 串行化 removeTarget / socket-close cleanup / session-close / lease-release；
 * cleanup Promise 记忆化合流（并发 removeTarget ×2 → 同一 Promise、恰一 CLOSE 帧）。
 *
 * 注（issue #171 §D9 生命周期权威归一）：hub 侧用内联 closeQueue promise 链 + open
 * 续体**中止**（Scope 1：中止 ≠ 排队——其资源回收在续体内同步完成），peer 侧用
 * 本文件的 Memoized + cleanupTail（`enqueueLifecycle` 统一队列原语）——「不重建共享
 * LifecycleQueue 类；按侧定责为两个显式单一权威」：hub 通道（per-connection、无代际
 * 重建）与 peer 控制器（跨连接、epoch 所有权 + intent + settle-gate）生命周期形状
 * 不同构，强行单一类会重演「LifecycleQueue 零引用死抽象」事故。LifecycleQueue 类
 * （零引用）已删除，收敛为 Memoized（peer-namespace.ts 在用，保留——见下）。
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

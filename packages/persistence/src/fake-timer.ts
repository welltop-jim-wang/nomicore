import type { Context } from '@deepseek-ai/cordis'
import type { TimerService } from '@deepseek-ai/cordis-plugin-timer'
import type { PersistenceScheduler } from './contract.js'

/**
 * Cordis fake timer plugin：提供 `'timer'` service + mixin `ctx.timeout`，委托
 * 注入的 fake scheduler。
 *
 * ⚠️ 本模块 **vitest-free**：模块加载期不得 import vitest——否则在非 vitest
 * 进程（如探针 CLI 的真实子进程）被 import 即抛 "Vitest failed to access its
 * internal state"。成员一律 property-signature / 箭头属性形态（AC4 静态守卫
 * 的负向 lookbehind 会把 method-shorthand 判为裸调用），禁止 method-shorthand。
 *
 * 契约（R1/#8 + R1/B3）：
 * - fake 的 `timeout`/`setTimeout` 必须返回**幂等 disposer `() => void`**
 *   （内部包 `() => timer.clearTimeout(id)`），不得透传 scheduler 的裸 number
 *   id——生产桥接的 `clearTimeout(handle) === handle()` 依赖 disposer 形状
 *   （裸 id 会静默变 `(number)()` TypeError）。
 * - 注入的 timer 必须是宿主时间线的**视图**（其 `setTimeout` 到期基线 = 宿主
 *   虚拟刻度，见 ProbeTimeline 不变式 ③）；**禁止**传入带独立内部时钟的
 *   scheduler（如 `createTestScheduler()`）——那样 `at = 内部now + delay` 中
 *   内部 now 停在初值，首腿之后所有 deadline 与宿主时钟脱钩。
 */
export function createFakeTimerPlugin(
  timer: Pick<PersistenceScheduler, 'setTimeout' | 'clearTimeout'>,
): {
  /** fake service.timeout 形状（timeout 与 setTimeout 同实现，均返回 () => void）。 */
  apply(ctx: Context): void
} {
  const service = {
    timeout: (callback: () => void, delay: number): (() => void) => {
      const id = timer.setTimeout(callback, delay) // 登记进宿主时间线（视图）
      let done = false
      return () => {
        if (done) return
        done = true
        timer.clearTimeout(id)
      }
    },
    // 与真实 TimerService 同：委托 timeout
    setTimeout: (callback: () => void, delay: number): (() => void) => service.timeout(callback, delay),
    interval: (..._args: unknown[]): never => {
      throw new TypeError('fake timer plugin does not implement interval')
    },
    setInterval: (..._args: unknown[]): never => {
      throw new TypeError('fake timer plugin does not implement setInterval')
    },
    throttle: (..._args: unknown[]): never => {
      throw new TypeError('fake timer plugin does not implement throttle')
    },
    debounce: (..._args: unknown[]): never => {
      throw new TypeError('fake timer plugin does not implement debounce')
    },
  }
  return {
    apply(ctx: Context): void {
      ctx.effect(() => {
        const unregister = ctx.provide('timer', service as unknown as TimerService)
        ctx.mixin('timer', ['timeout'])
        return () => { unregister() }
      }, 'fake-timer: service')
    },
  }
}

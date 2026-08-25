import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-timer'
import { requireClock } from '@nomicore/clock'
import type { PersistenceScheduler } from './contract.js'

/**
 * Cordis wiring leaf for the persistence adapters (module-graph DAG: this
 * module imports `context`-level dependencies only; `lifecycle.ts` never
 * imports it).
 *
 * ⚠️ 宿主接线契约（R1/#15）——timer fiber 生命周期必须 ⊇ persistence adapter
 * 生命周期：宿主必须**先装 timer、后停 persistence**（本任务 DSH profile 的
 * clock → timer → persistence 装配序与 adapter → fiber dispose 序即满足）。
 * 若宿主先拆 timer fiber 再使用 persistence adapter，`scheduleRetry` →
 * `ctx.timeout` 会在 native 回调续体里抛 INACTIVE_EFFECT（uncaught）——该顺序
 * 是宿主接线契约，不在 persistence 内部防御（adapter `closed` 标志只覆盖自身
 * dispose 路径）。
 */

/**
 * 插件启动强依赖断言（AC2）：在 provide service **之前**同步执行；缺失任一
 * 依赖即 loud throw（不 fallback、不 console.error 后继续）。检验经
 * `ctx.get(name)` 安全探针（cordis 已核实：缺失返回 `undefined`、从不
 * throw），文案稳定、单句、含 service 名与安装指引。
 */
export function assertPersistenceHostDependencies(ctx: Context): void {
  requireClock(ctx) // 缺失 → throw 'required Cordis service "clock" is unavailable'（@nomicore/clock 现有文案）
  const timer = ctx.get('timer') as { timeout?: unknown } | undefined
  if (timer === undefined || typeof timer.timeout !== 'function') {
    throw new Error(
      'required Cordis service "timer" is unavailable: '
      + 'install @deepseek-ai/cordis-plugin-timer before the persistence plugin',
    )
  }
}

/**
 * 派生 plugin 路径的唯一 PersistenceScheduler 来源（AC3）：内部先执行
 * `assertPersistenceHostDependencies`（订单保证：断言失败时任何 service
 * 都未提供），再桥接 `ctx.timeout`。
 *
 * `ctx.timeout(cb, ms)` 返回幂等 disposer（timer 插件源码已核实：effect
 * wrapper 单次守卫；timer 触发时先 `dispose()` 再 `callback()`），故
 * disposer 即 handle——`clearTimeout(handle) === handle()`：触发前调用取消
 * 底层 native timer，触发后调用是无害清理，与 `clearTimeout(handle)` 语义
 * 精确对齐。
 */
export function createCordisPersistenceScheduler(ctx: Context): PersistenceScheduler {
  assertPersistenceHostDependencies(ctx)
  return {
    setTimeout: (callback, delayMs) => ctx.timeout(callback, delayMs),
    clearTimeout: (handle) => { (handle as () => void)() },
  }
}

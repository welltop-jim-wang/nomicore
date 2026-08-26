import type { Context } from '@deepseek-ai/cordis'
import { provideClock, type Clock } from './contract.js'

/**
 * Production wall-clock provider：直接委托 `Date.now()`。
 * 冻结单例——运行时键面恰为 `now`，无调度成员（issue #106 AC5）。
 * 不承诺单调：读数随系统 wall clock，可能被 NTP 校正回跳。
 */
export const systemClock: Clock = Object.freeze({
  now: () => Date.now(),
})

/**
 * Production Cordis plugin：以 `ctx.effect` 发布 `ctx.clock`（systemClock 单例），
 * service 注册清理由 Cordis 拥有——fiber dispose 时自动注销（对齐
 * MemoryPersistence.apply 模式；Clock 无自有资源，无需额外 cleanup）。
 */
export function createSystemClockPlugin() {
  return {
    apply(ctx: Context) {
      ctx.effect(() => provideClock(ctx, systemClock), 'clock: service')
    },
  }
}

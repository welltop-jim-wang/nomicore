import type { Context } from '@deepseek-ai/cordis'

/**
 * 通用 Cordis wall-clock capability（issue #106 / ADR-0009 / issue #104 决策）。
 *
 * 职责边界：Clock 只负责**当前时间观察**——`now()` 返回 Unix epoch
 * milliseconds，且**明确不承诺单调**（wall clock 允许 NTP 校正或 manual
 * provider 回跳）。延迟调度（timeout/interval/cron）继续由 Cordis Timer
 * capability 负责，Clock 永不提供调度成员。
 *
 * 消费纪律：`now()` 输出的合法性校验在消费方（如 Registry create-document，
 * 非法输出属 internal fatal，ADR-0009），Clock 包本身不包装/不校验读数。
 */
export interface Clock {
  /** 当前 Unix epoch milliseconds。不承诺单调递增。 */
  now(): number
}

/** Cordis service 名（issue #104 决策：service names `clock`/`nomicorePersistence`/`nomicoreRegistry`）。 */
export const CLOCK_SERVICE = 'clock' as const

declare module '@deepseek-ai/cordis' {
  interface Context {
    clock: Clock
  }
}

/** 在当前 Context 发布 Clock service；返回注销函数（对齐 provideDocPersistence 模式）。 */
export function provideClock(ctx: Context, clock: Clock): () => void {
  return ctx.provide(CLOCK_SERVICE, clock)
}

/**
 * 取 Clock service；缺失即 loud throw——依赖 plugin 不得 fallback 到
 * `Date.now()` 或任何系统时间（issue #106 AC4 / issue #104：missing
 * dependencies fail plugin startup loudly）。
 */
export function requireClock(ctx: Context): Clock {
  const clock = ctx.get(CLOCK_SERVICE)
  if (clock === undefined) {
    throw new Error('required Cordis service "clock" is unavailable')
  }
  return clock as Clock
}

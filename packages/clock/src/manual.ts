import type { Context } from '@deepseek-ai/cordis'
import { provideClock, type Clock } from './contract.js'

/**
 * 受控 manual testing provider（issue #106 AC3 / issue #104 Testing Decisions：
 * manual Clock 状态与 fake timer 协调推进，idle 与 createdAt 测试确定性、
 * 无真实 sleep）。
 *
 * 语义：
 * - `set(timeMs)` 把读数放到任意有限 Unix epoch 毫秒——**允许回跳**
 *   （wall clock 不承诺单调，测试可模拟 NTP 校正）；
 * - `advance(deltaMs)` 只向前推进（非负有限 delta）；回跳请用 `set`；
 * - 输入校验 loud 且先于状态变更：非 number → TypeError；非有限 / 负 delta /
 *   advance 溢出 → RangeError；校验失败后读数保持不变；
 * - 本 provider 永不读取系统时间（确定性纪律），也不含任何调度成员。
 */
export interface ManualClock extends Clock {
  set(timeMs: number): void
  advance(deltaMs: number): void
}

function assertTime(label: string, value: number): number {
  if (typeof value !== 'number') {
    throw new TypeError(`manual clock ${label} must be a number (Unix epoch milliseconds)`)
  }
  if (!Number.isFinite(value)) {
    throw new RangeError(`manual clock ${label} must be a finite number`)
  }
  return value
}

export function createManualClock(initialMs = 0): ManualClock {
  let current = assertTime('initialMs', initialMs)
  return Object.freeze({
    now: () => current,
    set(timeMs: number) {
      current = assertTime('timeMs', timeMs)
    },
    advance(deltaMs: number) {
      if (typeof deltaMs !== 'number') {
        throw new TypeError('manual clock deltaMs must be a number (milliseconds)')
      }
      if (!Number.isFinite(deltaMs) || deltaMs < 0) {
        throw new RangeError('manual clock deltaMs must be a finite non-negative number')
      }
      const next = current + deltaMs
      if (!Number.isFinite(next)) {
        throw new RangeError('manual clock advance overflows the finite number range')
      }
      current = next
    },
  })
}

/**
 * 测试组合 Cordis plugin：把给定 manual clock 发布为 `ctx.clock`，
 * 生命周期与 production plugin 一致（fiber dispose 自动注销）。
 */
export function createManualClockPlugin(clock: ManualClock) {
  return {
    apply(ctx: Context) {
      ctx.effect(() => provideClock(ctx, clock), 'clock: service')
    },
  }
}

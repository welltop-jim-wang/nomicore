/**
 * 红灯契约（行为面）— @nomicore/clock 通用 Cordis wall-clock capability
 *（issue #106 验收条件 + issue #104 Implementation/Testing Decisions + ADR-0009）。
 *
 * 契约锚点：
 * - AC2：`Clock.now()` 返回 Unix epoch milliseconds，明确不承诺单调；
 * - AC3：production wall-clock provider（systemClock）与受控 manual testing
 *   provider（createManualClock）；
 * - AC4：`requireClock` 在缺失 Clock service 时 loud fail，不 fallback 到系统时间；
 * - AC5：Clock 不提供 timeout/interval/cron，不与 Cordis Timer 职责重叠——
 *   provider 的运行时键面恰为契约键，无任何调度成员；
 * - issue #104：manual Clock 状态用于确定性测试（与 fake timer 协调推进）；
 * - ADR-0009：Clock 是 wall clock，不承诺单调——manual clock 允许 set 回跳。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  CLOCK_SERVICE,
  provideClock,
  requireClock,
  systemClock,
  type Clock,
} from '../src/index.js'
import { createManualClock } from '../src/testing.js'

describe('Clock 契约：service 名与 Context augmentation（AC1）', () => {
  it('CLOCK_SERVICE 冻结为字符串 "clock"（issue #104 决策：service names clock/…）', () => {
    expect(CLOCK_SERVICE).toBe('clock')
  })

  it('provideClock 后 ctx.clock 可读且与提供实例恒等', () => {
    const ctx = new Context()
    const clock: Clock = { now: () => 1234 }
    provideClock(ctx, clock)
    expect(ctx.clock).toBe(clock)
    expect(ctx.get(CLOCK_SERVICE)).toBe(clock)
    expect(requireClock(ctx)).toBe(clock)
  })
})

describe('requireClock：缺失 Clock service 的 loud fail（AC4）', () => {
  it('裸 Context 上 requireClock 抛稳定错误，且不安装任何 fallback', () => {
    const ctx = new Context()
    expect(() => requireClock(ctx)).toThrow('required Cordis service "clock" is unavailable')
    // 不 fallback 到系统时间：抛错后 service 仍不存在（未静默注册 systemClock）
    expect(ctx.get(CLOCK_SERVICE)).toBeUndefined()
  })

  it('依赖 plugin 在 apply 中 requireClock：缺失即启动失败（loud）', () => {
    const ctx = new Context()
    const dependentPlugin = {
      apply(host: Context) {
        requireClock(host)
      },
    }
    expect(() => dependentPlugin.apply(ctx)).toThrow('required Cordis service "clock" is unavailable')
  })
})

describe('systemClock：production wall-clock provider（AC2/AC3/AC5）', () => {
  it('now() 返回 Unix epoch milliseconds：与 Date.now() 同区间 bracket', () => {
    const before = Date.now()
    const reading = systemClock.now()
    const after = Date.now()
    expect(Number.isFinite(reading)).toBe(true)
    expect(reading).toBeGreaterThanOrEqual(before)
    expect(reading).toBeLessThanOrEqual(after)
  })

  it('运行时键面恰为 [now]：无 timeout/interval/cron 调度成员', () => {
    expect(Object.keys(systemClock)).toEqual(['now'])
    expect(Object.isFrozen(systemClock)).toBe(true)
  })

  it('不承诺单调：接口层面只断言读数是有限 number（单调性非契约）', () => {
    const first = systemClock.now()
    const second = systemClock.now()
    expect(Number.isFinite(first)).toBe(true)
    expect(Number.isFinite(second)).toBe(true)
  })
})

describe('createManualClock：受控 manual testing provider（AC3 + #104 确定性测试）', () => {
  it('默认从 0 起（确定性基线），now() 返回当前读数', () => {
    const clock = createManualClock()
    expect(clock.now()).toBe(0)
  })

  it('指定初始读数', () => {
    const clock = createManualClock(1_700_000_000_000)
    expect(clock.now()).toBe(1_700_000_000_000)
  })

  it('set 任意有限读数（含回跳——wall clock 不承诺单调）', () => {
    const clock = createManualClock(100)
    clock.set(250)
    expect(clock.now()).toBe(250)
    clock.set(40)
    expect(clock.now()).toBe(40)
  })

  it('advance 累进推进', () => {
    const clock = createManualClock(100)
    clock.advance(1)
    clock.advance(59)
    expect(clock.now()).toBe(160)
  })

  it('manual clock 键面恰为 [now, set, advance]：无调度成员', () => {
    const clock = createManualClock()
    expect(Object.keys(clock)).toEqual(['now', 'set', 'advance'])
    expect(Object.isFrozen(clock)).toBe(true)
  })

  it('loud 输入校验：非 number → TypeError；非有限 → RangeError', () => {
    const clock = createManualClock(100)
    // @ts-expect-error 运行时防御：JS 调用方可传非 number
    expect(() => clock.set('100')).toThrow(TypeError)
    expect(() => clock.set(Number.NaN)).toThrow(RangeError)
    expect(() => clock.set(Number.POSITIVE_INFINITY)).toThrow(RangeError)
    // @ts-expect-error 运行时防御：JS 调用方可传非 number
    expect(() => clock.advance('1')).toThrow(TypeError)
    expect(() => clock.advance(Number.NaN)).toThrow(RangeError)
    expect(() => clock.advance(Number.NEGATIVE_INFINITY)).toThrow(RangeError)
    // 校验失败后读数不变（校验先于状态变更）
    expect(clock.now()).toBe(100)
  })

  it('advance 拒绝负 delta（回跳用语义明确的 set）', () => {
    const clock = createManualClock(100)
    expect(() => clock.advance(-1)).toThrow(RangeError)
    expect(clock.now()).toBe(100)
  })

  it('advance 溢出有限范围 → RangeError，状态不变', () => {
    const clock = createManualClock(Number.MAX_VALUE)
    expect(() => clock.advance(Number.MAX_VALUE)).toThrow(RangeError)
    expect(clock.now()).toBe(Number.MAX_VALUE)
  })

  it('构造期 initialMs 同样 loud 校验', () => {
    expect(() => createManualClock(Number.NaN)).toThrow(RangeError)
    // @ts-expect-error 运行时防御
    expect(() => createManualClock('0')).toThrow(TypeError)
  })

  it('manual clock 是 Clock 接口的实现：可经 provideClock 发布并被 requireClock 取回', () => {
    const ctx = new Context()
    const clock: Clock = createManualClock(7)
    provideClock(ctx, clock)
    expect(requireClock(ctx).now()).toBe(7)
  })
})

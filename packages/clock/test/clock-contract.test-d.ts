/**
 * 红灯契约（类型面）— @nomicore/clock 公共类型与 Context augmentation
 *（issue #106 AC6「类型、Context augmentation、service provide/require …测试完整」
 * + AC5 类型层无调度成员）。
 *
 * 锚定机制（vitest --typecheck 下红/绿翻转）：
 * - `ctx.clock` 须经 declare module augmentation 落在 Cordis Context 上，类型为 Clock；
 * - `Clock.now` 返回 number；Clock 类型面无 setTimeout/setInterval/cron 成员
 *   （`@ts-expect-error` 反向锚定——一旦未来有人加调度成员，类型测试转红）；
 * - `provideClock` 只接受 Clock；`requireClock` 返回 Clock（非 undefined）；
 * - testing 子路径的 ManualClock 可赋值给 Clock（里氏替换）。
 */
import { describe, expectTypeOf, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  provideClock,
  requireClock,
  systemClock,
  type Clock,
} from '../src/index.js'
import { createManualClock, type ManualClock } from '../src/testing.js'

declare const ctx: Context

describe('类型面：Context augmentation 与 service 存取（AC1/AC6）', () => {
  it('ctx.clock 类型为 Clock，now() 返回 number', () => {
    expectTypeOf(ctx.clock).toEqualTypeOf<Clock>()
    expectTypeOf(ctx.clock.now).returns.toEqualTypeOf<number>()
  })

  it('requireClock 返回确定存在的 Clock（loud fail 纪律：类型不含 undefined）', () => {
    expectTypeOf(requireClock(ctx)).toEqualTypeOf<Clock>()
  })

  it('provideClock 接受 Clock 并返回注销函数；拒绝非 Clock', () => {
    const clock: Clock = { now: () => 0 }
    expectTypeOf(provideClock(ctx, clock)).toEqualTypeOf<() => void>()
    // @ts-expect-error 缺 now 方法不是 Clock
    provideClock(ctx, {})
    // @ts-expect-error 多出的调度成员不是 Clock 契约（exact 对象字面量检查）
    provideClock(ctx, { now: () => 0, setTimeout: () => 0 })
  })
})

describe('类型面：Clock 无调度职责（AC5）', () => {
  it('Clock 类型面无 timeout/interval/cron 成员', () => {
    // @ts-expect-error Clock 不提供 setTimeout
    ctx.clock.setTimeout
    // @ts-expect-error Clock 不提供 setInterval
    ctx.clock.setInterval
    // @ts-expect-error Clock 不提供 cron
    ctx.clock.cron
  })

  it('Clock 只有 now 一个键', () => {
    expectTypeOf<keyof Clock>().toEqualTypeOf<'now'>()
  })
})

describe('类型面：provider 形状（AC3）', () => {
  it('systemClock 是 Clock', () => {
    expectTypeOf(systemClock).toEqualTypeOf<Clock>()
  })

  it('ManualClock 扩展 Clock 且提供 set/advance 控制面', () => {
    expectTypeOf<ManualClock>().toMatchTypeOf<Clock>()
    expectTypeOf(createManualClock()).toEqualTypeOf<ManualClock>()
    expectTypeOf(createManualClock).parameter(0).toEqualTypeOf<number | undefined>()
    expectTypeOf<ManualClock['set']>().toEqualTypeOf<(timeMs: number) => void>()
    expectTypeOf<ManualClock['advance']>().toEqualTypeOf<(deltaMs: number) => void>()
  })
})

/**
 * 红灯契约（Cordis 组合与生命周期面）— @nomicore/clock plugin
 *（issue #106 AC1/AC6：service provide/require 与生命周期测试完整）。
 *
 * 模式对齐 packages/persistence/test/memory-persistence.test.ts 的
 * 「unloads one Cordis service exactly once across repeated fiber disposal」：
 * plugin.apply → ctx.effect 注册 provideClock；fiber dispose → Cordis 自动注销
 * service；重复 dispose 幂等，注销事件恰一次。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { createSystemClockPlugin, requireClock, systemClock } from '../src/index.js'
import { createManualClock, createManualClockPlugin } from '../src/testing.js'

describe('createSystemClockPlugin：production 组合（AC1/AC3/AC6）', () => {
  it('apply 后发布 ctx.clock === systemClock 单例', () => {
    const ctx = new Context()
    createSystemClockPlugin().apply(ctx)
    expect(ctx.clock).toBe(systemClock)
    expect(requireClock(ctx)).toBe(systemClock)
  })

  it('fiber dispose 后 service 注销；重复 dispose 幂等且注销事件恰一次', async () => {
    const ctx = new Context()
    let serviceEvents = 0
    ctx.on('internal/service', (name, value) => {
      if (name === 'clock' && value === undefined) serviceEvents += 1
    })

    createSystemClockPlugin().apply(ctx)
    expect(ctx.get('clock')).toBe(systemClock)

    const firstUnload = ctx.fiber.dispose()
    const repeatedUnload = ctx.fiber.dispose()
    await Promise.all([firstUnload, repeatedUnload])

    expect(serviceEvents).toBe(1)
    expect(ctx.get('clock')).toBeUndefined()
    // 注销后 requireClock 恢复 loud fail（不残留系统时间 fallback）
    expect(() => requireClock(ctx)).toThrow('required Cordis service "clock" is unavailable')
  })

  it('两个 plugin 实例各自独立 apply 不互相影响（重复 provide 同 key 由 Cordis 裁决）', () => {
    const first = new Context()
    const second = new Context()
    createSystemClockPlugin().apply(first)
    createSystemClockPlugin().apply(second)
    expect(first.clock).toBe(systemClock)
    expect(second.clock).toBe(systemClock)
  })
})

describe('createManualClockPlugin：受控测试组合（AC3/AC6 + #104 manual Clock）', () => {
  it('apply 发布给定 manual clock；宿主生命周期结束即注销', async () => {
    const ctx = new Context()
    const manual = createManualClock(1_000)
    createManualClockPlugin(manual).apply(ctx)

    expect(ctx.clock).toBe(manual)
    manual.advance(500)
    expect(requireClock(ctx).now()).toBe(1_500)

    await ctx.fiber.dispose()
    expect(ctx.get('clock')).toBeUndefined()
  })

  it('依赖 plugin 经 requireClock 取得 manual clock：时间读数完全由测试控制', () => {
    const ctx = new Context()
    const manual = createManualClock(2_000)
    createManualClockPlugin(manual).apply(ctx)

    let observed: number | undefined
    const dependentPlugin = {
      apply(host: Context) {
        observed = requireClock(host).now()
      },
    }
    dependentPlugin.apply(ctx)
    expect(observed).toBe(2_000)
    manual.set(9_999)
    expect(manual.now()).toBe(9_999)
  })
})

/**
 * Issue #330 / ADR 0023 — guard-proxy 合法消费回归（@nomicore/clock）
 *
 * 契约（ADR 0023 L45–74/L90–93 + `wiki/raw/task_issue-330_sa6_contract.md` §12.2/§12.3）：
 * - `systemClock` 与 testing 导出的 `ManualClock` 的函数成员必须是访问器属性
 *   （getter 返回稳定闭包）——冻结数据属性 + 「get 陷阱返回包装闭包」的 guard Proxy
 *   会触发 ECMA-262 Proxy [[Get]] 不变量 TypeError，访问器形态是规范留出的合法通道；
 * - `Object.freeze` 姿态不弱化：赋值 / `defineProperty` 重定义仍被拒，枚举性不变；
 * - 每用例含三重对照：敏感性正控（helper 确实在包装，防空洞绿）+ 诚实 Proxy 负控
 *   （失败不来自 Proxy/冻结本身）+ 被测断言。
 *
 * 红灯（改造前 HEAD）：`systemClock.now`、`ManualClock.now/set/advance` 经 guard
 * Proxy 访问即抛 TypeError（同 SA6 契约 §5 红表）。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { createSystemClockPlugin, requireClock, systemClock } from '../src/index.js'
import { createManualClock, createManualClockPlugin, type ManualClock } from '../src/testing.js'

/** 包内复制的 guard-proxy（AC6 / ADR 0023 L90：不新建共享测试设施）。 */
function guardProxy<T extends object>(target: T): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, receiver)
      if (typeof value !== 'function') return value
      // DSH cordis-host-runner 语义：为每个函数成员返回新的包装闭包
      return (...args: unknown[]) => Reflect.apply(value, receiver, args)
    },
  }) as T
}

/** 敏感性正控：helper 对「冻结 + 数据属性函数成员」必须抛不变量 TypeError。 */
function expectGuardProxySensitivityPositiveControl(): void {
  const frozenDataSurface = Object.freeze({ probe: (): number => 1 })
  expect(() => guardProxy(frozenDataSurface).probe).toThrow(TypeError)
}

/** 诚实 Proxy 负控：`get` 返回目标实际值 → 同一成员访问不抛。 */
function expectHonestProxyPassthrough(target: object, member: string): void {
  const honest = new Proxy(target, { get: (t, prop, receiver) => Reflect.get(t, prop, receiver) })
  expect(() => (honest as Record<string, unknown>)[member]).not.toThrow()
}

/** 逐成员访问结果（运行时观察；THROW 记录错误类型而非源码文本）。 */
function sweepMemberAccess(target: object, members: readonly string[]): Record<string, string> {
  const guarded = guardProxy(target)
  const outcomes: Record<string, string> = {}
  for (const member of members) {
    try {
      void (guarded as Record<string, unknown>)[member]
      outcomes[member] = 'ACCESS_OK'
    } catch (error) {
      outcomes[member] = error instanceof TypeError ? 'THROW:TypeError' : `THROW:${String(error)}`
    }
  }
  return outcomes
}

function accessOk(members: readonly string[]): Record<string, string> {
  return Object.fromEntries(members.map((member) => [member, 'ACCESS_OK']))
}

/** ADR 0023 L64–74 姿态断言块（访问器形态 + freeze 不弱化）。 */
function expectAccessorPosture(service: object, member: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(service, member)
  expect(descriptor).toBeDefined()
  const d = descriptor!
  expect('value' in d).toBe(false)
  expect(typeof d.get).toBe('function')
  expect(d.set).toBeUndefined()
  expect(d.configurable).toBe(false)
  expect(d.enumerable).toBe(true)
  expect(Object.isFrozen(service)).toBe(true)
  const hostile = service as Record<string, unknown>
  expect(() => { hostile[member] = () => 1 }).toThrow(TypeError)
  expect(() => Object.defineProperty(service, member, { value: () => 1 })).toThrow(TypeError)
}

const SYSTEM_MEMBERS = ['now'] as const
const MANUAL_MEMBERS = ['now', 'set', 'advance'] as const

describe('systemClock：guard-proxy 合法消费（Issue #330 AC3 / ADR 0023）', () => {
  it('now 经 guard Proxy 访问与调用直通，冻结姿态与键面不变', () => {
    expectGuardProxySensitivityPositiveControl()
    expectHonestProxyPassthrough(systemClock, 'now')

    // 逐成员访问：改造前 1/1 THROW:TypeError，改造后全 ACCESS_OK
    expect(sweepMemberAccess(systemClock, SYSTEM_MEMBERS)).toEqual(accessOk(SYSTEM_MEMBERS))

    const guarded = guardProxy(systemClock)
    const before = Date.now()
    const reading = guarded.now()
    const after = Date.now()
    expect(Number.isFinite(reading)).toBe(true)
    expect(reading).toBeGreaterThanOrEqual(before)
    expect(reading).toBeLessThanOrEqual(after)

    // 稳定闭包：同一实例同一函数引用（禁止 getter 内联新建函数）
    expect(systemClock.now).toBe(systemClock.now)

    expectAccessorPosture(systemClock, 'now')
    expect(Object.keys(systemClock)).toEqual(['now'])
  })

  it('经 createSystemClockPlugin 发布后（requireClock 取得）仍可被 guard Proxy 消费', async () => {
    expectGuardProxySensitivityPositiveControl()
    const ctx = new Context()
    createSystemClockPlugin().apply(ctx)
    const published = requireClock(ctx)
    expect(published).toBe(systemClock)
    expectHonestProxyPassthrough(published, 'now')

    expect(sweepMemberAccess(published, SYSTEM_MEMBERS)).toEqual(accessOk(SYSTEM_MEMBERS))

    const guarded = guardProxy(published)
    const before = Date.now()
    const reading = guarded.now()
    const after = Date.now()
    expect(Number.isFinite(reading)).toBe(true)
    expect(reading).toBeGreaterThanOrEqual(before)
    expect(reading).toBeLessThanOrEqual(after)
    await ctx.fiber.dispose()
  })
})

describe('ManualClock：guard-proxy 合法消费（Issue #330 AC3 / ADR 0023）', () => {
  it('now/set/advance 经 guard Proxy 访问与调用直通，loud 校验语义透传', () => {
    expectGuardProxySensitivityPositiveControl()
    const clock = createManualClock(100)
    expectHonestProxyPassthrough(clock, 'now')
    expectHonestProxyPassthrough(clock, 'set')
    expectHonestProxyPassthrough(clock, 'advance')

    // 逐成员访问：改造前 3/3 THROW:TypeError，改造后全 ACCESS_OK
    expect(sweepMemberAccess(clock, MANUAL_MEMBERS)).toEqual(accessOk(MANUAL_MEMBERS))

    const guarded = guardProxy(clock)
    guarded.set(250)
    expect(guarded.now()).toBe(250)
    guarded.advance(5)
    expect(guarded.now()).toBe(255)
    expect(clock.now()).toBe(255) // 直连观察同一实例状态（包装调用直通）

    // 方法体一行不动 ⇒ 错误语义逐字保持：非 number → TypeError；非有限/负 delta → RangeError
    expect(() => guarded.set(Number.NaN)).toThrow(RangeError)
    expect(() => guarded.set('1' as unknown as number)).toThrow(TypeError)
    expect(() => guarded.advance(-1)).toThrow(RangeError)
    expect(() => guarded.advance(Number.NaN)).toThrow(RangeError)
    expect(guarded.now()).toBe(255) // 校验失败后读数不变

    // 每实例稳定闭包（工厂作用域捕获 current，不跨实例串状态）
    expect(clock.now).toBe(clock.now)
    expect(clock.set).toBe(clock.set)
    expect(clock.advance).toBe(clock.advance)
    const other = createManualClock(7)
    const guardedOther = guardProxy(other)
    guardedOther.set(9)
    guardedOther.advance(1)
    expect(guardedOther.now()).toBe(10)
    expect(guarded.now()).toBe(255)

    for (const member of MANUAL_MEMBERS) expectAccessorPosture(clock, member)
    expect(Object.keys(clock)).toEqual(['now', 'set', 'advance'])
  })

  it('经 createManualClockPlugin 发布后（requireClock 取得）仍可被 guard Proxy 消费', async () => {
    expectGuardProxySensitivityPositiveControl()
    const manual = createManualClock(1_000)
    const ctx = new Context()
    createManualClockPlugin(manual).apply(ctx)
    const published = requireClock(ctx)
    expect(published).toBe(manual)
    expectHonestProxyPassthrough(published, 'advance')

    expect(sweepMemberAccess(published, MANUAL_MEMBERS)).toEqual(accessOk(MANUAL_MEMBERS))

    // require 通道的静态类型是 Clock（服务契约面）；本用例发布的就是 ManualClock 实例。
    const guarded = guardProxy(published as ManualClock)
    guarded.advance(500)
    expect(guarded.now()).toBe(1_500)
    for (const member of MANUAL_MEMBERS) expectAccessorPosture(published, member)
    await ctx.fiber.dispose()
  })
})

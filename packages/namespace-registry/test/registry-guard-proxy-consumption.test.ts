/**
 * Issue #330 / ADR 0023 — guard-proxy 合法消费回归（@nomicore/namespace-registry）
 *
 * 契约（ADR 0023 L45–74/L90–93 + `wiki/raw/task_issue-330_sa6_contract.md` §12.2/§12.3）：
 * - `nomicoreRegistry` 的全部函数成员（open/create/importReplica/resetReplica/
 *   deleteNamespace/getStatus/shutdown）必须是访问器属性（getter 返回稳定闭包），
 *   从而可被「get 陷阱返回包装闭包」的 guard Proxy 合法消费；
 * - `Object.freeze` 姿态不弱化：赋值 / `defineProperty` 重定义仍被拒，枚举性/键序不变；
 * - 稳定闭包：`service.m === service.m`；`shutdown()` 仍返回同一缓存 Promise（AC12 幂等锚）；
 * - 每用例含三重对照：敏感性正控 + 诚实 Proxy 负控 + 被测断言。
 *
 * 组合 seam 对齐 `registry-plugin.test.ts` 测试 22：真实 Cordis Context + instance +
 * manual clock + fake timer + memory persistence + registry plugin。
 *
 * 红灯（改造前 HEAD）：7/7 成员经 guard Proxy 访问即抛 TypeError（SA6 契约 §5 红表）。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createManualClock, createManualClockPlugin } from '@nomicore/clock/testing'
import { createInstancePlugin } from '@nomicore/instance'
import { createMemoryPersistencePlugin } from '@nomicore/persistence'
import { createFakeTimerPlugin } from '@nomicore/persistence/testing'
import {
  NOMICORE_REGISTRY_SERVICE,
  createNamespaceRegistryPlugin,
  requireNomicoreRegistry,
  type CreateNamespaceInput,
  type NamespaceRegistry,
} from '@nomicore/namespace-registry'
import { createRegistryTestScheduler } from '@nomicore/namespace-registry/testing'

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

const REGISTRY_MEMBERS = [
  'open',
  'create',
  'importReplica',
  'resetReplica',
  'deleteNamespace',
  'getStatus',
  'shutdown',
] as const

/** 真实组合（对齐 registry-plugin.test.ts 测试 22），经 require 通道取得服务。 */
async function mountRegistry(): Promise<{ ctx: Context; registry: NamespaceRegistry }> {
  const ctx = new Context()
  createInstancePlugin().apply(ctx, { instanceId: 'guard-proxy-host', role: 'hub' })
  createManualClockPlugin(createManualClock(1_700_000_123_456)).apply(ctx)
  createFakeTimerPlugin(createRegistryTestScheduler()).apply(ctx)
  createMemoryPersistencePlugin().apply(ctx)
  await ctx.plugin(createNamespaceRegistryPlugin())
  return { ctx, registry: requireNomicoreRegistry(ctx) }
}

describe('nomicoreRegistry：guard-proxy 合法消费（Issue #330 AC1 / ADR 0023）', () => {
  it('七个成员经 guard Proxy 访问不抛、调用行为直通', async () => {
    expectGuardProxySensitivityPositiveControl()
    const { ctx, registry } = await mountRegistry()
    expect(registry).toBe(requireNomicoreRegistry(ctx))
    expectHonestProxyPassthrough(registry, 'open')

    // 逐成员访问：改造前 7/7 THROW:TypeError，改造后全 ACCESS_OK
    expect(sweepMemberAccess(registry, REGISTRY_MEMBERS)).toEqual(accessOk(REGISTRY_MEMBERS))

    const guarded = guardProxy(registry)

    // open：缺失命名空间 → NAMESPACE_NOT_FOUND，与直连同型
    const directOpen = await registry.open({ userId: 'u-guard' }, 'missing-ns')
    const proxiedOpen = await guarded.open({ userId: 'u-guard' }, 'missing-ns')
    expect(proxiedOpen).toEqual(directOpen)
    expect(proxiedOpen).toMatchObject({ ok: false, code: 'NAMESPACE_NOT_FOUND' })

    // create/importReplica/resetReplica/deleteNamespace：非法输入 → 同型 issue 信封，零状态副作用
    // （公共 typed 签名不表达敌意输入——实现层签名以 unknown 表达，接纳段校验一切
    // 畸形输入是运行时契约；此处用受控非法值穿过类型边界观察运行时拒绝语义。）
    const hostileCreateInput = {} as CreateNamespaceInput
    const hostileDoc = undefined as unknown as Parameters<NamespaceRegistry['importReplica']>[2]
    const hostileIdentity = undefined as unknown as Parameters<NamespaceRegistry['importReplica']>[3]

    const directCreate = await registry.create(hostileCreateInput)
    const proxiedCreate = await guarded.create(hostileCreateInput)
    expect(proxiedCreate).toEqual(directCreate)
    expect(proxiedCreate).toMatchObject({ ok: false })

    const directImport = await registry.importReplica({ userId: 'u-guard' }, 'bad/ns', hostileDoc, hostileIdentity)
    const proxiedImport = await guarded.importReplica({ userId: 'u-guard' }, 'bad/ns', hostileDoc, hostileIdentity)
    expect(proxiedImport).toEqual(directImport)
    expect(proxiedImport).toMatchObject({ ok: false })

    const directReset = await registry.resetReplica({ userId: 'u-guard' }, 'bad/ns', hostileIdentity)
    const proxiedReset = await guarded.resetReplica({ userId: 'u-guard' }, 'bad/ns', hostileIdentity)
    expect(proxiedReset).toEqual(directReset)
    expect(proxiedReset).toMatchObject({ ok: false })

    const directDelete = await registry.deleteNamespace({ userId: 'u-guard' }, 'bad/ns')
    const proxiedDelete = await guarded.deleteNamespace({ userId: 'u-guard' }, 'bad/ns')
    expect(proxiedDelete).toEqual(directDelete)
    expect(proxiedDelete).toMatchObject({ ok: false })

    // getStatus：恒三相冻结常量投影（同引用直通）
    expect(guarded.getStatus()).toBe(registry.getStatus())
    expect(guarded.getStatus()).toEqual({ state: 'running' })

    // 稳定闭包：同实例同一函数引用（禁止 getter 内联新建函数）
    for (const member of REGISTRY_MEMBERS) {
      expect((registry as unknown as Record<string, unknown>)[member]).toBe(
        (registry as unknown as Record<string, unknown>)[member],
      )
    }

    // 冻结姿态 + 键面/枚举性
    for (const member of REGISTRY_MEMBERS) expectAccessorPosture(registry, member)
    expect(Object.keys(registry)).toEqual([...REGISTRY_MEMBERS])
    expect(NOMICORE_REGISTRY_SERVICE).toBe('nomicoreRegistry')

    await ctx.fiber.dispose()
  })

  it('shutdown 经 guard Proxy 返回同一缓存 Promise（AC12 幂等锚），freeze 姿态不变', async () => {
    expectGuardProxySensitivityPositiveControl()
    const { ctx, registry } = await mountRegistry()
    expectHonestProxyPassthrough(registry, 'shutdown')
    const guarded = guardProxy(registry)

    const first = registry.shutdown()
    expect(guarded.shutdown()).toBe(first)
    expect(guarded.shutdown()).toBe(guarded.shutdown())
    await first
    expect(guarded.getStatus()).toEqual({ state: 'stopped' })

    expectAccessorPosture(registry, 'shutdown')
    await ctx.fiber.dispose()
  })
})

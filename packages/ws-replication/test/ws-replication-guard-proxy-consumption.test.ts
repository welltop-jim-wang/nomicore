/**
 * Issue #330 / ADR 0023 — guard-proxy 合法消费回归（@nomicore/ws-replication）
 *
 * 契约（ADR 0023 L45–74/L90–93 + `wiki/raw/task_issue-330_sa6_contract.md` §12.2/§12.3）：
 * - `nomicoreHubReplication`（status/requestReauth/stop）与 `nomicorePeerReplication`
 *   （status/addTarget/removeTarget/notifyAuthChanged/waitForLive/stop）的函数成员必须是
 *   访问器属性（getter 返回稳定闭包），从而可被「get 陷阱返回包装闭包」的 guard Proxy
 *   合法消费（`status` 改造前已是 getter，不得回归）；
 * - `Object.freeze` 姿态不弱化：赋值 / `defineProperty` 重定义仍被拒，枚举性/键序不变；
 * - 稳定闭包：`service.m === service.m`；`stop()` 返回同一缓存 Promise；
 * - 每用例含三重对照：敏感性正控 + 诚实 Proxy 负控 + 被测断言；
 * - `waitForLive` 的 settle 用注入 timer + `stop()` 触发（无真实 sleep、无轮询）。
 *
 * 组合 seam 对齐 `ws-replication-plugin.test.ts` 的 `dependencies()` + stub listen/dial。
 *
 * 红灯（改造前 HEAD）：hub requestReauth/stop、peer addTarget/removeTarget/
 * notifyAuthChanged/waitForLive/stop 经 guard Proxy 访问即抛 TypeError；`status`×2 已绿。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { provideClock } from '@nomicore/clock'
import { provideInstance } from '@nomicore/instance'
import { provideNomicoreRegistry } from '@nomicore/namespace-registry'
import {
  createHubReplicationPlugin,
  createPeerReplicationPlugin,
  requireHubReplication,
  requirePeerReplication,
  type DuplexTransport,
} from '../src/index.js'

const namespaceId = `ns-${'1'.repeat(32)}`

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

/** 依赖组合（对齐 ws-replication-plugin.test.ts `dependencies()`）。 */
function dependencies(
  ctx: Context,
  role: 'hub' | 'peer',
  timer: { timeout(callback: () => void, delayMs: number): () => void } = { timeout: () => () => {} },
): void {
  provideInstance(ctx, Object.freeze({ instanceId: `${role}-one`, role }))
  provideClock(ctx, { now: () => 1 })
  if (typeof ctx.root.timeout === 'function') ctx.provide('timer', timer as never)
  else ctx.provide('timer', { ...timer, ctx: { root: { ...ctx.root, timeout: timer.timeout } } } as never)
  provideNomicoreRegistry(ctx, { open: vi.fn() } as never)
}

function transport(): DuplexTransport {
  return {
    send: vi.fn(), close: vi.fn(), closed: false,
    onMessage: () => () => {}, onClose: () => () => {},
  }
}

const HUB_MEMBERS = ['status', 'requestReauth', 'stop'] as const
const PEER_MEMBERS = ['status', 'addTarget', 'removeTarget', 'notifyAuthChanged', 'waitForLive', 'stop'] as const
/** 稳定闭包断言只适用于函数成员（status getter 返回快照值，非稳定闭包契约）。 */
const PEER_FUNCTION_MEMBERS = ['addTarget', 'removeTarget', 'notifyAuthChanged', 'waitForLive', 'stop'] as const

describe('nomicoreHubReplication：guard-proxy 合法消费（Issue #330 AC2 / ADR 0023）', () => {
  it('status/requestReauth/stop 经 guard Proxy 访问与调用直通，stop 缓存 Promise 恒等', async () => {
    expectGuardProxySensitivityPositiveControl()
    const plugin = createHubReplicationPlugin(
      { listen: { host: '127.0.0.1', port: 0 }, tokens: [], authorization: [] },
      { listen: { listen: vi.fn(async () => ({ close: vi.fn(async () => {}) })) } as never },
    )
    const ctx = new Context()
    dependencies(ctx, 'hub')
    await plugin.apply(ctx)
    const service = requireHubReplication(ctx)
    expectHonestProxyPassthrough(service, 'requestReauth')

    // 逐成员访问：改造前 status 已绿、requestReauth/stop THROW；改造后全 ACCESS_OK
    expect(sweepMemberAccess(service, HUB_MEMBERS)).toEqual(accessOk(HUB_MEMBERS))

    const guarded = guardProxy(service)

    // status 已是 getter（既有绿灯不得回归）
    expect(guarded.status).toEqual(service.status)
    expect(guarded.status).toEqual({ state: 'ready', connections: 0 })

    // requestReauth：访问不抛 + 调用 resolve（无连接时零副作用）
    await expect(guarded.requestReauth('peer-one')).resolves.toBeUndefined()

    // stop：访问不抛 + 缓存 Promise 恒等
    const first = service.stop()
    expect(guarded.stop()).toBe(first)
    await first

    // 稳定闭包 + 姿态
    expect(service.requestReauth).toBe(service.requestReauth)
    expect(service.stop).toBe(service.stop)
    for (const member of HUB_MEMBERS) expectAccessorPosture(service, member)
    expect(Object.keys(service)).toEqual([...HUB_MEMBERS])

    await ctx.fiber.dispose()
  })
})

describe('nomicorePeerReplication：guard-proxy 合法消费（Issue #330 AC2 / ADR 0023）', () => {
  it('全部成员经 guard Proxy 访问与调用直通，waitForLive 由 stop 触发 settle', async () => {
    expectGuardProxySensitivityPositiveControl()
    const cancel = vi.fn()
    const timeout = vi.fn(() => cancel)
    const plugin = createPeerReplicationPlugin(
      { expectedHubInstanceId: 'hub-one' },
      { dial: () => transport() },
    )
    const ctx = new Context()
    dependencies(ctx, 'peer', { timeout })
    plugin.apply(ctx)
    const service = requirePeerReplication(ctx)
    expectHonestProxyPassthrough(service, 'addTarget')

    // 逐成员访问：改造前除 status 外 5/5 THROW；改造后全 ACCESS_OK
    expect(sweepMemberAccess(service, PEER_MEMBERS)).toEqual(accessOk(PEER_MEMBERS))

    const guarded = guardProxy(service)

    // status 已是 getter（既有绿灯不得回归）
    expect(guarded.status.state).toBe('ready')
    expect(['connecting', 'handshaking']).toContain(guarded.status.connection)

    // addTarget / notifyAuthChanged / removeTarget：访问不抛 + 调用直通
    expect(() => guarded.addTarget({ namespaceId, localOwner: { userId: 'owner' } })).not.toThrow()
    expect(() => guarded.notifyAuthChanged()).not.toThrow()
    await expect(guarded.removeTarget(namespaceId)).resolves.toBeUndefined()

    // waitForLive：注入 timer 武装等待；stop() 触发 settle（无真实 sleep/轮询）
    const timersBeforeWait = timeout.mock.calls.length
    const pending = guarded.waitForLive(namespaceId)
    expect(timeout).toHaveBeenCalledTimes(timersBeforeWait + 1)
    await guarded.stop()
    await expect(pending).rejects.toThrow('peer replication stopped')
    expect(cancel.mock.calls.length).toBeGreaterThanOrEqual(1)

    // 稳定闭包（函数成员：同实例同一函数引用；status 是快照值 getter，不在此列）
    for (const member of PEER_FUNCTION_MEMBERS) {
      expect((service as unknown as Record<string, unknown>)[member]).toBe(
        (service as unknown as Record<string, unknown>)[member],
      )
    }
    for (const member of PEER_MEMBERS) expectAccessorPosture(service, member)
    expect(Object.keys(service)).toEqual([...PEER_MEMBERS])

    await ctx.fiber.dispose()
  })
})

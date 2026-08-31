import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  INSTANCE_SERVICE,
  createInstancePlugin,
  mergeInstanceConfig,
  provideInstance,
  requireInstance,
} from '../src/index.js'

describe('instance configuration', () => {
  it('merges defined factory overrides over host configuration', () => {
    expect(mergeInstanceConfig(
      { instanceId: 'host-peer', role: 'peer' },
      { instanceId: 'test-peer', role: undefined },
    )).toEqual({ instanceId: 'test-peer', role: 'peer' })
  })

  it.each([
    [{ instanceId: 'Bad', role: 'hub' }, 'instanceId'],
    [{ instanceId: 'hub-a', role: 'other' }, 'role'],
    [{ instanceId: 'hub-a', role: 'hub', extra: true }, 'unknown key "extra"'],
  ])('strictly rejects malformed final config %#', (config, message) => {
    expect(() => mergeInstanceConfig(config as never)).toThrow(message)
  })

  it('strictly rejects unknown factory override keys', () => {
    expect(() => createInstancePlugin({ role: 'hub', token: 'secret' } as never)).toThrow('unknown key "token"')
  })
})

describe('instance service and plugin lifecycle', () => {
  it('provides and requires the service through public helpers', () => {
    const ctx = new Context()
    const instance = Object.freeze({ instanceId: 'hub-a', role: 'hub' as const })
    const revoke = provideInstance(ctx, instance)
    expect(ctx.nomicoreInstance).toBe(instance)
    expect(requireInstance(ctx)).toBe(instance)
    revoke()
    expect(() => requireInstance(ctx)).toThrow('required Cordis service "nomicoreInstance" is unavailable')
  })

  it('publishes one frozen identity and revokes it on fiber disposal', async () => {
    const ctx = new Context()
    createInstancePlugin({ instanceId: 'override-hub' }).apply(ctx, {
      instanceId: 'configured-hub',
      role: 'hub',
    })

    const instance = requireInstance(ctx)
    expect(instance).toEqual({ instanceId: 'override-hub', role: 'hub' })
    expect(Object.isFrozen(instance)).toBe(true)
    expect(() => Object.assign(instance, { role: 'peer' })).toThrow()

    await ctx.fiber.dispose()
    expect(ctx.get(INSTANCE_SERVICE)).toBeUndefined()
  })

  it('validates before publishing the service', () => {
    const ctx = new Context()
    expect(() => createInstancePlugin().apply(ctx, { instanceId: 'bad id', role: 'peer' })).toThrow('instanceId')
    expect(ctx.get(INSTANCE_SERVICE)).toBeUndefined()
  })
})

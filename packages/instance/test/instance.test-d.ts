import { Context } from '@deepseek-ai/cordis'
import { describe, expectTypeOf, it } from 'vitest'
import {
  createInstancePlugin,
  mergeInstanceConfig,
  provideInstance,
  requireInstance,
  type Instance,
  type InstanceConfig,
  type InstanceRole,
} from '../src/index.js'

describe('instance public type contract', () => {
  it('exposes the immutable service and helpers', () => {
    const ctx = new Context()
    const instance: Instance = { instanceId: 'peer-a', role: 'peer' }
    expectTypeOf<InstanceRole>().toEqualTypeOf<'hub' | 'peer'>()
    expectTypeOf(ctx.nomicoreInstance).toEqualTypeOf<Instance>()
    expectTypeOf(requireInstance(ctx)).toEqualTypeOf<Instance>()
    expectTypeOf(provideInstance(ctx, instance)).toEqualTypeOf<() => void>()
    expectTypeOf(mergeInstanceConfig(instance)).toEqualTypeOf<Readonly<InstanceConfig>>()
    expectTypeOf(createInstancePlugin().apply).parameter(1).toEqualTypeOf<InstanceConfig>()
  })
})

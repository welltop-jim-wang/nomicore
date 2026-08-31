import type { Context } from '@deepseek-ai/cordis'

/** A Nomicore process has one static replication role. */
export type InstanceRole = 'hub' | 'peer'

/** Immutable local identity shared by registry and transport plugins. */
export interface Instance {
  readonly instanceId: string
  readonly role: InstanceRole
}

/** Host-owned configuration for the Instance plugin. */
export interface InstanceConfig {
  readonly instanceId: string
  readonly role: InstanceRole
}

/** Optional factory overrides. Defined fields replace host configuration. */
export interface InstanceConfigOverrides {
  readonly instanceId?: string | undefined
  readonly role?: InstanceRole | undefined
}

export const INSTANCE_SERVICE = 'nomicoreInstance' as const

const INSTANCE_ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/
const CONFIG_KEYS = new Set(['instanceId', 'role'])

declare module '@deepseek-ai/cordis' {
  interface Context {
    nomicoreInstance: Instance
  }
}

export function provideInstance(ctx: Context, instance: Instance): () => void {
  return ctx.provide(INSTANCE_SERVICE, instance)
}

export function requireNomicoreInstance(ctx: Context): Instance {
  const instance = ctx.get(INSTANCE_SERVICE)
  if (instance === undefined) {
    throw new Error('required Cordis service "nomicoreInstance" is unavailable')
  }
  return instance
}

/** @deprecated Use requireNomicoreInstance. */
export const requireInstance = requireNomicoreInstance

/**
 * Creates an Instance provider. Configuration is read when the plugin is
 * applied, then merged with factory overrides and validated before service
 * publication. Both identity fields are restart-only.
 */
export function createInstancePlugin(overrides: InstanceConfigOverrides = {}) {
  assertStrictObject(overrides, 'instance overrides')

  return {
    apply(ctx: Context, config: InstanceConfig) {
      const merged = mergeInstanceConfig(config, overrides)
      const instance: Instance = Object.freeze({
        instanceId: merged.instanceId,
        role: merged.role,
      })
      ctx.effect(() => provideInstance(ctx, instance), 'instance: service')
    },
  }
}

/** Strictly merges defined factory fields over host configuration. */
export function mergeInstanceConfig(
  config: InstanceConfig,
  overrides: InstanceConfigOverrides = {},
): Readonly<InstanceConfig> {
  assertStrictObject(config, 'instance config')
  assertStrictObject(overrides, 'instance overrides')

  const merged = {
    instanceId: overrides.instanceId === undefined ? config.instanceId : overrides.instanceId,
    role: overrides.role === undefined ? config.role : overrides.role,
  }
  validateInstanceConfig(merged)
  return Object.freeze(merged)
}

function validateInstanceConfig(config: { readonly instanceId: unknown; readonly role: unknown }): asserts config is InstanceConfig {
  if (typeof config.instanceId !== 'string' || !INSTANCE_ID_PATTERN.test(config.instanceId)) {
    throw new TypeError('invalid instance config: "instanceId" must match ^[a-z][a-z0-9-]{0,62}$')
  }
  if (config.role !== 'hub' && config.role !== 'peer') {
    throw new TypeError('invalid instance config: "role" must be "hub" or "peer"')
  }
}

function assertStrictObject(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`invalid ${name}: expected an object`)
  }
  const unknownKeys = Object.keys(value).filter((key) => !CONFIG_KEYS.has(key))
  if (unknownKeys.length > 0) {
    throw new TypeError(`invalid ${name}: unknown key "${unknownKeys[0]}"`)
  }
}

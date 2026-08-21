import type { Context } from '@deepseek-ai/cordis'
import type * as Y from 'yjs'

/** A host-issued partition key. Persistence does not authenticate it. */
export interface User {
  readonly userId: string
}

/**
 * A short-lived, adapter-owned lease of a live document.
 *
 * Every successful `loadDoc()` returns a new handle. Handles for the same
 * `(userId, docId)` may share their `doc`, but they never share lease identity.
 * Call `release()` from the caller's `finally`; it is idempotent.
 */
export interface DocHandle {
  readonly user: User
  readonly docId: string
  readonly doc: Y.Doc
  release(): Promise<void>
}

/**
 * The persistence seam shared by all adapters.
 *
 * `saveDoc()` only records that the handle's document is dirty. It does not
 * promise that a snapshot has reached durable storage. Adapters reject handles
 * that they did not issue, as well as handles that have already been released.
 */
export interface DocPersistence {
  loadDoc(user: User, docId: string): Promise<DocHandle | null>
  saveDoc(handle: DocHandle): Promise<void>
}

/** Cordis label for the host-wide persistence service. */
export const DOC_PERSISTENCE_SERVICE = 'docPersistence' as const

/**
 * Scheduler defaults owned by persistence adapters. `saveDoc()` resets the
 * debounce deadline; the max-dirty deadline is measured from the first dirty
 * notification. Retry policy remains adapter-internal.
 */
export const DEFAULT_PERSISTENCE_SCHEDULE: Readonly<PersistenceSchedule> = Object.freeze({
  debounceMs: 500,
  maxDirtyMs: 5_000,
})

export interface PersistenceSchedule {
  readonly debounceMs: number
  readonly maxDirtyMs: number
}

export interface PersistenceTimer {
  readonly now: () => number
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown
  readonly clearTimeout: (timer: unknown) => void
}

export const systemPersistenceTimer: PersistenceTimer = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof globalThis.setTimeout>),
}

/** Resolve and validate the only scheduling options exposed by this contract. */
export function resolvePersistenceSchedule(
  config: Partial<PersistenceSchedule> = {},
): PersistenceSchedule {
  const schedule: PersistenceSchedule = {
    debounceMs: config.debounceMs ?? DEFAULT_PERSISTENCE_SCHEDULE.debounceMs,
    maxDirtyMs: config.maxDirtyMs ?? DEFAULT_PERSISTENCE_SCHEDULE.maxDirtyMs,
  }

  for (const [name, value] of Object.entries(schedule)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`persistence schedule ${name} must be a finite non-negative number`)
    }
  }

  return Object.freeze(schedule)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Persistence is a required service for consumers that inject it. */
    docPersistence: DocPersistence
  }
}

/**
 * Register an adapter in the current Cordis fiber.
 *
 * `ctx.provide()` is the real Cordis registration API. Its returned disposer is
 * owned by the current fiber, so stop/reload removes the service automatically.
 */
export function provideDocPersistence(ctx: Context, persistence: DocPersistence): () => void {
  return ctx.provide(DOC_PERSISTENCE_SERVICE, persistence)
}

/**
 * Resolve the service as a hard dependency. Plugins that consume it must also
 * export `inject: ['docPersistence']`; this helper makes direct callers fail
 * loudly instead of treating absence as an optional-service fallback.
 */
export function requireDocPersistence(ctx: Context): DocPersistence {
  const persistence = ctx.get(DOC_PERSISTENCE_SERVICE)
  if (persistence === undefined) {
    throw new Error('required Cordis service "docPersistence" is unavailable')
  }
  return persistence
}

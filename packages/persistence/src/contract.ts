import type { Context } from '@deepseek-ai/cordis'
import type * as Y from 'yjs'

/** A host-issued partition key. Persistence does not authenticate it. */
export interface User {
  readonly userId: string
}

/**
 * Entry-level persistence status of one DocHandle lease (issue #79).
 * Frozen vocabulary — rendered part of the ADR-0006 revision contract.
 */
export type DocHandleStatus = 'ready' | 'persistence-degraded' | 'released' | 'disposed'

/** A short-lived, adapter-owned lease of a live document. */
export interface DocHandle {
  /** The storage owner of this document (partition key), not the current accessor. */
  readonly owner: User
  readonly docId: string
  readonly doc: Y.Doc
  /**
   * Synchronous, entry-level status of THIS handle's (owner.userId, docId)
   * entry at the instant of the call — never the adapter aggregate.
   * Point-in-time observation only: it is not a promise that any subsequent
   * flush will succeed (same no-durability-promise discipline as saveDoc).
   * Precedence: disposed > released > entry state.
   */
  getStatus(): DocHandleStatus
  release(): Promise<void>
}

/**
 * The persistence seam shared by all adapters.
 *
 * The Cordis service name exposed by this interface is `nomicorePersistence`
 * (`NOMICORE_PERSISTENCE_SERVICE`).
 */
export interface DocPersistence {
  createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle>
  loadDoc(owner: User, docId: string): Promise<DocHandle | null>
  saveDoc(handle: DocHandle): Promise<void>
}

/** Stable duplicate-creation error. Callers branch on code, never message text. */
export class DocDuplicateError extends Error {
  readonly code: 'DOC_DUPLICATE' = 'DOC_DUPLICATE'
  constructor(message = 'createDoc duplicate: the (owner, docId) already exists') {
    super(message)
    this.name = 'DocDuplicateError'
  }
}

export const NOMICORE_PERSISTENCE_SERVICE = 'nomicorePersistence' as const

export interface PersistenceSchedule {
  readonly debounceMs: number
  readonly maxDirtyMs: number
}

export const DEFAULT_PERSISTENCE_SCHEDULE: Readonly<PersistenceSchedule> = Object.freeze({
  debounceMs: 500,
  maxDirtyMs: 5_000,
})

/**
 * The delayed-scheduling seam injected into every adapter (property-signature
 * form so the AC4 static guard can distinguish host-global timer APIs from
 * injected seam members). Scheduling only: wall-clock observation belongs to
 * `ctx.clock`, never to this seam.
 */
export interface PersistenceScheduler {
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown
  readonly clearTimeout: (handle: unknown) => void
}

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
    nomicorePersistence: DocPersistence
  }
}

export function provideNomicorePersistence(ctx: Context, persistence: DocPersistence): () => void {
  return ctx.provide(NOMICORE_PERSISTENCE_SERVICE, persistence)
}

export function requireNomicorePersistence(ctx: Context): DocPersistence {
  const persistence = ctx.get(NOMICORE_PERSISTENCE_SERVICE)
  if (persistence === undefined) {
    throw new Error('required Cordis service "nomicorePersistence" is unavailable')
  }
  return persistence
}

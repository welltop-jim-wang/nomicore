import type { Context } from '@deepseek-ai/cordis'
import type * as Y from 'yjs'

/** A host-issued partition key. Persistence does not authenticate it. */
export interface User {
  readonly userId: string
}

/** A short-lived, adapter-owned lease of a live document. */
export interface DocHandle {
  /** The storage owner of this document (partition key), not the current accessor. */
  readonly owner: User
  readonly docId: string
  readonly doc: Y.Doc
  release(): Promise<void>
}

/** The persistence seam shared by all adapters. */
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

export const DOC_PERSISTENCE_SERVICE = 'docPersistence' as const

export interface PersistenceSchedule {
  readonly debounceMs: number
  readonly maxDirtyMs: number
}

export const DEFAULT_PERSISTENCE_SCHEDULE: Readonly<PersistenceSchedule> = Object.freeze({
  debounceMs: 500,
  maxDirtyMs: 5_000,
})

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
    docPersistence: DocPersistence
  }
}

export function provideDocPersistence(ctx: Context, persistence: DocPersistence): () => void {
  return ctx.provide(DOC_PERSISTENCE_SERVICE, persistence)
}

export function requireDocPersistence(ctx: Context): DocPersistence {
  const persistence = ctx.get(DOC_PERSISTENCE_SERVICE)
  if (persistence === undefined) {
    throw new Error('required Cordis service "docPersistence" is unavailable')
  }
  return persistence
}

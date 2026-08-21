import type { Context } from '@deepseek-ai/cordis'
import type * as Y from 'yjs'
import { PersistenceLifecycle, type PersistenceStatus } from './lifecycle.js'
import {
  provideDocPersistence,
  type DocHandle,
  type DocPersistence,
  type PersistenceSchedule,
  type PersistenceTimer,
  type User,
} from './index.js'

const TEST_FACTORY = Symbol('MemoryPersistence test factory')

export interface MemoryPersistenceOptions {
  readonly schedule?: Partial<PersistenceSchedule>
  readonly timer?: PersistenceTimer
  /** Implementations must honor `signal` to make in-flight I/O cancellable. */
  readonly writeSnapshot?: (key: string, snapshot: Uint8Array, signal: AbortSignal) => Promise<void> | void
  /** Implementations must honor `signal` to make in-flight I/O cancellable. */
  readonly readSnapshot?: (key: string, signal: AbortSignal) => Promise<Uint8Array | undefined> | Uint8Array | undefined
}

export type MemoryPersistenceStatus = PersistenceStatus

interface StoredSnapshot { readonly snapshot: Uint8Array }

/**
 * The process-shared snapshot store of the reference adapter.
 *
 * Adapters whose I/O is wired to an external store (I/O hooks present) mirror
 * every successful write here, and read hooks first, falling back to this
 * store. A second adapter instance over the same external store therefore sees
 * committed snapshots even while the external write is replaced by a gate (the
 * shared createDoc contract anchors this: a create's initial commit must be
 * readable by a fresh instance over the same store). Instances without hooks
 * keep an isolated private store.
 */
const sharedSnapshots = new Map<string, StoredSnapshot>()

/** In-memory reference adapter with cancellable I/O and a separate snapshot store. */
export class MemoryPersistence implements DocPersistence {
  private readonly core: PersistenceLifecycle

  constructor(private readonly options: MemoryPersistenceOptions = {}) {
    const snapshots = (options.readSnapshot !== undefined || options.writeSnapshot !== undefined)
      ? sharedSnapshots
      : new Map<string, StoredSnapshot>()
    const core = new PersistenceLifecycle(
      {
        // Byte-order identical to the pre-core restore/flush paths; the commit
        // segment (snapshot set) sits after the aborted-signal guard. The
        // fallback snapshot is captured at read-issue time: a read issued
        // before a create must not observe the create's own later mirror
        // write, while a fresh instance's read (issued after the commit) sees
        // it even when the external write was gated (shared createDoc
        // contract: committed snapshots are readable through a fresh instance
        // over the same store).
        read: async (key, signal) => {
          const fallback = snapshots.get(key)?.snapshot
          const external = await options.readSnapshot?.(key, signal)
          return external ?? fallback
        },
        write: async (key, snapshot, signal) => {
          if (options.writeSnapshot) await options.writeSnapshot(key, snapshot, signal)
          if (signal.aborted) return
          snapshots.set(key, { snapshot: snapshot.slice() })
        },
      },
      {
        ...(options.schedule !== undefined ? { schedule: options.schedule } : {}),
        ...(options.timer !== undefined ? { timer: options.timer } : {}),
      },
    )
    this.core = core
  }

  getStatus(): MemoryPersistenceStatus { return this.core.getStatus() }

  loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    return this.core.loadDoc(owner, docId)
  }

  createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    return this.core.createDoc(owner, docId, doc)
  }

  saveDoc(handle: DocHandle): Promise<void> {
    return this.core.saveDoc(handle)
  }

  /** Cordis owns service registration cleanup; this effect closes only adapter resources. */
  apply(ctx: Context): void {
    ctx.effect(() => {
      provideDocPersistence(ctx, this)
      return () => this.dispose()
    }, 'memory-persistence: service')
  }

  dispose(): Promise<void> {
    return this.core.dispose()
  }

  [TEST_FACTORY](owner: User, docId: string): DocHandle {
    return this.core.seedForTest(owner, docId)
  }
}

export function createMemoryPersistence(options: MemoryPersistenceOptions = {}): MemoryPersistence {
  return new MemoryPersistence(options)
}

/** Cordis plugin factory; each invocation owns an isolated adapter instance. */
export function createMemoryPersistencePlugin(options: MemoryPersistenceOptions = {}) {
  let instance: MemoryPersistence | undefined
  return {
    apply(ctx: Context) {
      instance = createMemoryPersistence(options)
      instance.apply(ctx)
    },
    get instance(): MemoryPersistence | undefined { return instance },
  }
}

/**
 * Test-only helper export. It lives on the module's non-package export path
 * (`@nomicore/persistence/src/memory.js`) and is deliberately absent from
 * `@nomicore/persistence` public exports.
 */
export function createMemoryHandleForTest(
  persistence: MemoryPersistence,
  owner: User,
  docId: string,
): DocHandle {
  return persistence[TEST_FACTORY](owner, docId)
}

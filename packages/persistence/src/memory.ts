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
 * In-memory reference adapter with cancellable I/O and a separate snapshot store.
 *
 * Isolation rules (R4, design §5.3.1): the snapshot mirror is instance-private
 * (IO-1 — no module-level mutable state); when a read hook is wired it is the
 * sole read authority, and the `??` short-circuit means the mirror is never
 * evaluated for hooked instances (IO-2); dispose clears the instance mirror
 * after the core has settled all in-flight I/O (IO-3).
 */
export class MemoryPersistence implements DocPersistence {
  private readonly core: PersistenceLifecycle
  private readonly snapshots = new Map<string, StoredSnapshot>()

  constructor(private readonly options: MemoryPersistenceOptions = {}) {
    const core = new PersistenceLifecycle(
      {
        // Byte-order and await-depth identical to the pre-core restore/flush
        // paths; the commit segment (mirror set) sits after the aborted-signal
        // guard. Read is verbatim-isomorphic with base restoreEntry: the `??`
        // short-circuits at the Promise-object level, so a wired read hook is
        // the only read authority and the mirror is never consulted for
        // hooked instances.
        read: async (key, signal) => options.readSnapshot?.(key, signal) ?? this.snapshots.get(key)?.snapshot,
        write: async (key, snapshot, signal) => {
          if (options.writeSnapshot) await options.writeSnapshot(key, snapshot, signal)
          if (signal.aborted) return
          this.snapshots.set(key, { snapshot: snapshot.slice() })
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

  /**
   * Settle all in-flight I/O through the core first (the aborted-signal guard
   * already prevents any mirror write after dispose), then clear the instance
   * mirror: a disposed instance's data must never be resurrected by a later
   * instance (ADR-0006 factory/instance model).
   */
  async dispose(): Promise<void> {
    await this.core.dispose()
    this.snapshots.clear()
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

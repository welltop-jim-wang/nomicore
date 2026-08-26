import type { Context } from '@deepseek-ai/cordis'
import type * as Y from 'yjs'
import { PersistenceLifecycle, type PersistenceIO, type PersistenceStatus } from './lifecycle.js'
import {
  type DocHandle,
  type DocPersistence,
  type PersistenceSchedule,
  type PersistenceScheduler,
  type User,
} from './contract.js'
import {
  assertPersistenceHostDependencies,
  bindPersistenceAdapterLifecycle,
  createCordisPersistenceScheduler,
} from './service.js'

const TEST_FACTORY = Symbol('MemoryPersistence test factory')

export interface MemoryPersistenceOptions {
  readonly schedule?: Partial<PersistenceSchedule> | undefined
  /**
   * Adapter-owned scheduling seam, injected by the host (the production plugin
   * path derives it from `ctx.timeout` via `createCordisPersistenceScheduler`).
   * Required: the adapter never provides or falls back to a system timer.
   */
  readonly scheduler: PersistenceScheduler
  /**
   * Optional flat write hook. Contract (design §4.3.4/§3.1): a hook that has
   * entered runs to completion — all of its own side effects — or rejects
   * before any side effect begins; it must never reject AFTER partially
   * committing (that is a seam violation, an adapter bug the lifecycle
   * declares but does not defend against). Abort checks are the adapter
   * entry gate's job (the gate sits at io.write ENTRY, before this hook):
   * the hook may consult `signal` but is not required to.
   */
  readonly writeSnapshot?: (key: string, snapshot: Uint8Array, signal: AbortSignal) => Promise<void> | void
  /** Implementations must honor `signal` to make in-flight I/O cancellable. */
  readonly readSnapshot?: (key: string, signal: AbortSignal) => Promise<Uint8Array | undefined> | Uint8Array | undefined
  /**
   * Around-seam over this adapter's real I/O (fault injection / composition).
   * Receives the adapter's default io (Memory: entry-abort-gate → writeSnapshot
   * hook → mirror set, per §3.5 方案 (a); File: mkdir → writeFile tmp → rename)
   * and returns the io the lifecycle will use. The returned io MUST uphold the
   * PersistenceIO contract: write resolves ⟺ committed; rejects leave the
   * store unchanged; no synchronous throw.
   */
  readonly wrapIo?: ((io: PersistenceIO) => PersistenceIO) | undefined
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

  constructor(private readonly options: MemoryPersistenceOptions) {
    const baseIo: PersistenceIO = {
      // Byte-order and await-depth identical to the pre-core restore/flush
      // paths; the abort gate sits at io.write ENTRY (before any hook side
      // effect); a write that has entered runs to completion — hook side
      // effects + mirror set — and resolving means committed (§3.5/ADR
      // observable-channel axiom). Read is verbatim-isomorphic with base
      // restoreEntry: the `??` short-circuits at the Promise-object level, so
      // a wired read hook is the only read authority and the mirror is never
      // consulted for hooked instances.
      read: async (key, signal) => options.readSnapshot?.(key, signal) ?? this.snapshots.get(key)?.snapshot,
      write: async (key, snapshot, signal) => {
        signal.throwIfAborted()
        if (options.writeSnapshot) await options.writeSnapshot(key, snapshot, signal)
        this.snapshots.set(key, { snapshot: snapshot.slice() })
      },
    }
    const io = options.wrapIo !== undefined ? options.wrapIo(baseIo) : baseIo
    const core = new PersistenceLifecycle(io, {
      ...(options.schedule !== undefined ? { schedule: options.schedule } : {}),
      scheduler: options.scheduler,
    })
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

  /** Ordered Cordis lifecycle (rev1 问题 3): service revocation → dependent-fiber settle → adapter dispose. */
  apply(ctx: Context): void {
    // AC2: loud fail on missing clock/timer before ANY service is provided.
    assertPersistenceHostDependencies(ctx)
    bindPersistenceAdapterLifecycle(ctx, this, 'memory-persistence: service')
  }

  /**
   * Settle all in-flight I/O through the core first — `core.dispose()` drains
   * every tracked operation (each write runs inside a tracked op), so a mirror
   * set from a write that had already entered its entry gate happens BEFORE
   * `allSettled` returns and is cleared by the `snapshots.clear()` below —
   * then clear the instance mirror: a disposed instance's data must never be
   * resurrected by a later instance (ADR-0006 factory/instance model). The
   * invariant mechanism is drain-then-clear, not an abort guard (design
   * §4.3.2: the abort gate sits at io.write ENTRY and cannot prevent the
   * committed mirror set of a write that was already in flight).
   */
  async dispose(): Promise<void> {
    await this.core.dispose()
    this.snapshots.clear()
  }

  [TEST_FACTORY](owner: User, docId: string): DocHandle {
    return this.core.seedForTest(owner, docId)
  }
}

export function createMemoryPersistence(options: MemoryPersistenceOptions): MemoryPersistence {
  return new MemoryPersistence(options)
}

/** Cordis plugin factory; each invocation owns an isolated adapter instance. */
export function createMemoryPersistencePlugin(options: Omit<MemoryPersistenceOptions, 'scheduler' | 'wrapIo'> = {}) {
  let instance: MemoryPersistence | undefined
  return {
    apply(ctx: Context) {
      instance = new MemoryPersistence({
        ...options,
        scheduler: createCordisPersistenceScheduler(ctx),
      })
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

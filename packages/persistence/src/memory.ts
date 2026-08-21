import type { Context } from '@deepseek-ai/cordis'
import * as Y from 'yjs'
import {
  provideDocPersistence,
  resolvePersistenceSchedule,
  systemPersistenceTimer,
  type DocHandle,
  type DocPersistence,
  type PersistenceSchedule,
  type PersistenceTimer,
  type User,
} from './index.js'

export interface MemoryPersistenceOptions {
  readonly schedule?: Partial<PersistenceSchedule>
  readonly timer?: PersistenceTimer
  /** Test seam used to force asynchronous snapshot-write failures. */
  readonly writeSnapshot?: (key: string, snapshot: Uint8Array) => Promise<void> | void
  /** Test seam used to observe restore coalescing. */
  readonly readSnapshot?: (key: string) => Promise<Uint8Array | undefined> | Uint8Array | undefined
}

export type MemoryPersistenceStatus = 'ready' | 'persistence-degraded' | 'disposed'

interface Entry {
  readonly key: string
  readonly user: User
  readonly docId: string
  readonly doc: Y.Doc
  readonly handles: Set<MemoryDocHandle>
  dirtyGeneration: number
  savedGeneration: number
  flushing: boolean
  retryDelayMs: number
  debounceTimer?: unknown
  maxDirtyTimer?: unknown
  retryTimer?: unknown
}

interface StoredSnapshot {
  readonly snapshot: Uint8Array
}

export class MemoryDocHandle implements DocHandle {
  private released = false

  constructor(
    private readonly owner: MemoryPersistence,
    public readonly user: User,
    public readonly docId: string,
    public readonly doc: Y.Doc,
    readonly entryKey: string,
  ) {}

  async release(): Promise<void> {
    if (this.released) return
    this.released = true
    this.owner.release(this)
  }

  get isReleased(): boolean {
    return this.released
  }
}

/**
 * In-memory reference adapter. The live cache and durable snapshots are kept
 * separately so an idle entry can be evicted without losing persisted state.
 */
export class MemoryPersistence implements DocPersistence {
  private readonly schedule: PersistenceSchedule
  private readonly timer: PersistenceTimer
  private readonly snapshots = new Map<string, StoredSnapshot>()
  private readonly entries = new Map<string, Entry>()
  private readonly loading = new Map<string, Promise<Entry | null>>()
  private status: MemoryPersistenceStatus = 'ready'
  private disposed = false

  constructor(private readonly options: MemoryPersistenceOptions = {}) {
    this.schedule = resolvePersistenceSchedule(options.schedule)
    this.timer = options.timer ?? systemPersistenceTimer
  }

  getStatus(): MemoryPersistenceStatus {
    return this.status
  }

  async loadDoc(user: User, docId: string): Promise<DocHandle | null> {
    this.assertUsable()
    const key = toKey(user, docId)
    let entry = this.entries.get(key)
    if (!entry) {
      let pending = this.loading.get(key)
      if (!pending) {
        pending = this.restoreEntry(user, docId, key)
        this.loading.set(key, pending)
        void pending.then(
          () => this.loading.delete(key),
          () => this.loading.delete(key),
        )
      }
      entry = (await pending) ?? undefined
    }
    return entry ? this.issueHandle(entry) : null
  }

  /** Test-only creation seam: production callers create a Y.Doc then save it. */
  async createHandle(user: User, docId: string): Promise<DocHandle> {
    this.assertUsable()
    const key = toKey(user, docId)
    let entry = this.entries.get(key)
    if (!entry) {
      entry = this.createEntry(user, docId, key, new Y.Doc())
      this.entries.set(key, entry)
    }
    return this.issueHandle(entry)
  }

  async saveDoc(handle: DocHandle): Promise<void> {
    this.assertUsable()
    const owned = this.assertOwnedHandle(handle)
    const entry = this.entries.get(owned.entryKey)
    if (!entry || !entry.handles.has(owned)) {
      throw new Error('foreign or released DocHandle')
    }
    entry.dirtyGeneration += 1
    this.scheduleFlush(entry)
  }

  /** Register the service in Cordis and arrange adapter disposal on unload. */
  apply(ctx: Context): void {
    ctx.effect(() => {
      const disposeService = provideDocPersistence(ctx, this)
      return () => {
        void disposeService()
        this.dispose()
      }
    }, 'memory-persistence: service')
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.status = 'disposed'
    for (const entry of this.entries.values()) {
      this.clearTimers(entry)
      entry.doc.destroy()
      entry.handles.clear()
    }
    this.entries.clear()
    this.loading.clear()
    this.snapshots.clear()
  }

  release(handle: MemoryDocHandle): void {
    const entry = this.entries.get(handle.entryKey)
    if (!entry) return
    entry.handles.delete(handle)
    this.maybeEvict(entry)
  }

  private async restoreEntry(user: User, docId: string, key: string): Promise<Entry | null> {
    const snapshot = await (this.options.readSnapshot?.(key) ?? this.snapshots.get(key)?.snapshot)
    if (!snapshot) return null
    const doc = new Y.Doc()
    Y.applyUpdate(doc, snapshot)
    const metaDocId = doc.getMap('META').get('docId')
    if (metaDocId !== docId) {
      doc.destroy()
      throw new Error(`persisted META.docId ${String(metaDocId)} does not match requested docId ${docId}`)
    }
    const entry = this.createEntry(user, docId, key, doc)
    this.entries.set(key, entry)
    return entry
  }

  private createEntry(user: User, docId: string, key: string, doc: Y.Doc): Entry {
    return {
      key,
      user,
      docId,
      doc,
      handles: new Set(),
      dirtyGeneration: 0,
      savedGeneration: 0,
      flushing: false,
      retryDelayMs: this.schedule.debounceMs || 1,
    }
  }

  private issueHandle(entry: Entry): MemoryDocHandle {
    const handle = new MemoryDocHandle(this, entry.user, entry.docId, entry.doc, entry.key)
    entry.handles.add(handle)
    return handle
  }

  private scheduleFlush(entry: Entry): void {
    if (entry.flushing) return
    if (!entry.maxDirtyTimer) {
      entry.maxDirtyTimer = this.timer.setTimeout(() => this.requestFlush(entry), this.schedule.maxDirtyMs)
    }
    if (entry.debounceTimer) this.timer.clearTimeout(entry.debounceTimer)
    entry.debounceTimer = this.timer.setTimeout(() => this.requestFlush(entry), this.schedule.debounceMs)
  }

  private requestFlush(entry: Entry): void {
    entry.debounceTimer = undefined
    entry.maxDirtyTimer = undefined
    if (entry.flushing) return
    void this.flush(entry)
  }

  private async flush(entry: Entry): Promise<void> {
    if (entry.flushing || entry.savedGeneration === entry.dirtyGeneration || this.disposed) return
    entry.flushing = true
    const generation = entry.dirtyGeneration
    const snapshot = Y.encodeStateAsUpdate(entry.doc)
    try {
      await this.writeSnapshot(entry.key, snapshot)
      entry.savedGeneration = generation
      entry.retryDelayMs = this.schedule.debounceMs || 1
      if (entry.savedGeneration !== entry.dirtyGeneration) this.scheduleFlush(entry)
      else this.maybeEvict(entry)
    } catch {
      this.status = 'persistence-degraded'
      this.scheduleRetry(entry)
    } finally {
      entry.flushing = false
      if (entry.savedGeneration !== entry.dirtyGeneration && !entry.debounceTimer && !entry.maxDirtyTimer && !entry.retryTimer) {
        this.scheduleFlush(entry)
      }
      this.maybeEvict(entry)
    }
  }

  private async writeSnapshot(key: string, snapshot: Uint8Array): Promise<void> {
    if (this.options.writeSnapshot) await this.options.writeSnapshot(key, snapshot)
    this.snapshots.set(key, { snapshot: snapshot.slice() })
    this.status = 'ready'
  }

  private scheduleRetry(entry: Entry): void {
    if (entry.retryTimer) return
    const delay = entry.retryDelayMs
    entry.retryDelayMs = Math.min(Math.max(delay * 2, 1), this.schedule.maxDirtyMs)
    entry.retryTimer = this.timer.setTimeout(() => {
      entry.retryTimer = undefined
      void this.flush(entry)
    }, delay)
  }

  private maybeEvict(entry: Entry): void {
    if (entry.handles.size || entry.flushing || entry.savedGeneration !== entry.dirtyGeneration) return
    this.clearTimers(entry)
    this.entries.delete(entry.key)
    entry.doc.destroy()
  }

  private clearTimers(entry: Entry): void {
    for (const timer of [entry.debounceTimer, entry.maxDirtyTimer, entry.retryTimer]) {
      if (timer !== undefined) this.timer.clearTimeout(timer)
    }
    entry.debounceTimer = undefined
    entry.maxDirtyTimer = undefined
    entry.retryTimer = undefined
  }

  private assertOwnedHandle(handle: DocHandle): MemoryDocHandle {
    if (!(handle instanceof MemoryDocHandle) || handle['owner'] !== this || handle.isReleased) {
      throw new Error('foreign or released DocHandle')
    }
    return handle
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('MemoryPersistence is disposed')
    if (this.status === 'persistence-degraded') throw new Error('persistence-degraded: writes are rejected until retry succeeds')
  }
}

export function createMemoryPersistence(options: MemoryPersistenceOptions = {}): MemoryPersistence {
  return new MemoryPersistence(options)
}

/** Cordis plugin factory; each invocation owns an isolated adapter instance. */
export function createMemoryPersistencePlugin(options: MemoryPersistenceOptions = {}) {
  return {
    apply(ctx: Context) {
      createMemoryPersistence(options).apply(ctx)
    },
  }
}

function toKey(user: User, docId: string): string {
  return `${user.userId}\u0000${docId}`
}

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

const HANDLE_OWNER = new WeakMap<MemoryDocHandle, MemoryPersistence>()

export interface MemoryPersistenceOptions {
  readonly schedule?: Partial<PersistenceSchedule>
  readonly timer?: PersistenceTimer
  readonly writeSnapshot?: (key: string, snapshot: Uint8Array) => Promise<void> | void
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
    private readonly persistence: MemoryPersistence,
    public readonly user: User,
    public readonly docId: string,
    public readonly doc: Y.Doc,
    readonly entryKey: string,
  ) {
    HANDLE_OWNER.set(this, persistence)
  }

  async release(): Promise<void> {
    if (this.released) return
    this.released = true
    this.persistence.release(this)
  }

  get isReleased(): boolean {
    return this.released
  }
}

/** In-memory reference adapter with an independent cache and snapshot store. */
export class MemoryPersistence implements DocPersistence {
  private readonly schedule: PersistenceSchedule
  private readonly timer: PersistenceTimer
  private readonly snapshots = new Map<string, StoredSnapshot>()
  private readonly entries = new Map<string, Entry>()
  private readonly loading = new Map<string, Promise<Entry | null>>()
  private status: MemoryPersistenceStatus = 'ready'
  private closed = false
  private epoch = 0

  constructor(private readonly options: MemoryPersistenceOptions = {}) {
    this.schedule = resolvePersistenceSchedule(options.schedule)
    this.timer = options.timer ?? systemPersistenceTimer
  }

  getStatus(): MemoryPersistenceStatus {
    return this.status
  }

  async loadDoc(user: User, docId: string): Promise<DocHandle | null> {
    this.assertReadable()
    const key = toKey(user, docId)
    let entry = this.entries.get(key)
    if (!entry) {
      let pending = this.loading.get(key)
      if (!pending) {
        const epoch = this.epoch
        pending = this.restoreEntry(user, docId, key, epoch)
        this.loading.set(key, pending)
        void pending.then(
          () => this.loading.delete(key),
          () => this.loading.delete(key),
        )
      }
      entry = (await pending) ?? undefined
      this.assertReadable()
    }
    return entry ? this.issueHandle(entry) : null
  }

  /** Test-only creation seam; the public persistence contract stays unchanged. */
  async createHandle(user: User, docId: string): Promise<DocHandle> {
    this.assertWritable()
    const key = toKey(user, docId)
    let entry = this.entries.get(key)
    if (!entry) {
      entry = this.createEntry(user, docId, key, new Y.Doc())
      this.entries.set(key, entry)
    }
    return this.issueHandle(entry)
  }

  async saveDoc(handle: DocHandle): Promise<void> {
    this.assertWritable()
    const owned = this.assertOwnedHandle(handle)
    const entry = this.entries.get(owned.entryKey)
    if (!entry || !entry.handles.has(owned)) throw new Error('foreign or released DocHandle')
    entry.dirtyGeneration += 1
    this.scheduleFlush(entry)
  }

  /** Cordis owns service cleanup; this cleanup only closes adapter resources. */
  apply(ctx: Context): void {
    ctx.effect(() => {
      provideDocPersistence(ctx, this)
      return () => this.dispose()
    }, 'memory-persistence: service')
  }

  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.epoch += 1
    this.status = 'disposed'
    for (const entry of this.entries.values()) {
      this.clearTimers(entry)
      entry.handles.clear()
      entry.doc.destroy()
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

  private async restoreEntry(user: User, docId: string, key: string, epoch: number): Promise<Entry | null> {
    const snapshot = await (this.options.readSnapshot?.(key) ?? this.snapshots.get(key)?.snapshot)
    if (!this.isCurrent(epoch)) return null
    if (!snapshot) return null
    const doc = new Y.Doc()
    Y.applyUpdate(doc, snapshot)
    const metaDocId = doc.getMap('META').get('docId')
    if (metaDocId !== docId) {
      doc.destroy()
      throw new Error(`persisted META.docId ${String(metaDocId)} does not match requested docId ${docId}`)
    }
    if (!this.isCurrent(epoch)) {
      doc.destroy()
      return null
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
    if (entry.flushing || this.closed) return
    if (entry.maxDirtyTimer === undefined) {
      entry.maxDirtyTimer = this.timer.setTimeout(() => this.onMaxDirty(entry), this.schedule.maxDirtyMs)
    }
    if (entry.debounceTimer !== undefined) this.timer.clearTimeout(entry.debounceTimer)
    entry.debounceTimer = this.timer.setTimeout(() => this.onDebounce(entry), this.schedule.debounceMs)
  }

  private onDebounce(entry: Entry): void {
    entry.debounceTimer = undefined
    this.cancelMaxDirty(entry)
    this.startFlush(entry)
  }

  private onMaxDirty(entry: Entry): void {
    entry.maxDirtyTimer = undefined
    this.cancelDebounce(entry)
    this.startFlush(entry)
  }

  private startFlush(entry: Entry): void {
    if (entry.flushing || this.closed) return
    void this.flush(entry, this.epoch)
  }

  private async flush(entry: Entry, epoch: number): Promise<void> {
    if (entry.flushing || entry.savedGeneration === entry.dirtyGeneration || !this.isCurrent(epoch)) return
    entry.flushing = true
    const generation = entry.dirtyGeneration
    const snapshot = Y.encodeStateAsUpdate(entry.doc)
    try {
      await this.writeSnapshot(entry.key, snapshot, epoch)
      if (!this.isCurrent(epoch)) return
      entry.savedGeneration = generation
      entry.retryDelayMs = this.schedule.debounceMs || 1
      if (entry.savedGeneration !== entry.dirtyGeneration) this.scheduleFlush(entry)
    } catch (error) {
      if (!this.isCurrent(epoch)) return
      this.status = 'persistence-degraded'
      this.scheduleRetry(entry)
    } finally {
      if (!this.isCurrent(epoch)) return
      entry.flushing = false
      if (entry.savedGeneration !== entry.dirtyGeneration && entry.debounceTimer === undefined && entry.maxDirtyTimer === undefined && entry.retryTimer === undefined) {
        this.scheduleFlush(entry)
      }
      this.maybeEvict(entry)
    }
  }

  private async writeSnapshot(key: string, snapshot: Uint8Array, epoch: number): Promise<void> {
    if (this.options.writeSnapshot) await this.options.writeSnapshot(key, snapshot)
    if (!this.isCurrent(epoch)) return
    this.snapshots.set(key, { snapshot: snapshot.slice() })
    this.status = 'ready'
  }

  private scheduleRetry(entry: Entry): void {
    if (entry.retryTimer !== undefined || this.closed) return
    const delay = entry.retryDelayMs
    entry.retryDelayMs = Math.min(Math.max(delay * 2, 1), this.schedule.maxDirtyMs)
    entry.retryTimer = this.timer.setTimeout(() => {
      entry.retryTimer = undefined
      this.startFlush(entry)
    }, delay)
  }

  private maybeEvict(entry: Entry): void {
    if (entry.handles.size || entry.flushing || entry.savedGeneration !== entry.dirtyGeneration) return
    this.clearTimers(entry)
    this.entries.delete(entry.key)
    entry.doc.destroy()
  }

  private cancelDebounce(entry: Entry): void {
    if (entry.debounceTimer !== undefined) this.timer.clearTimeout(entry.debounceTimer)
    entry.debounceTimer = undefined
  }

  private cancelMaxDirty(entry: Entry): void {
    if (entry.maxDirtyTimer !== undefined) this.timer.clearTimeout(entry.maxDirtyTimer)
    entry.maxDirtyTimer = undefined
  }

  private clearTimers(entry: Entry): void {
    this.cancelDebounce(entry)
    this.cancelMaxDirty(entry)
    if (entry.retryTimer !== undefined) this.timer.clearTimeout(entry.retryTimer)
    entry.retryTimer = undefined
  }

  private assertOwnedHandle(handle: DocHandle): MemoryDocHandle {
    if (!(handle instanceof MemoryDocHandle) || HANDLE_OWNER.get(handle) !== this || handle.isReleased) {
      throw new Error('foreign or released DocHandle')
    }
    return handle
  }

  private assertReadable(): void {
    if (this.closed) throw new Error('MemoryPersistence is disposed')
  }

  private assertWritable(): void {
    this.assertReadable()
    if (this.status === 'persistence-degraded') {
      throw new Error('persistence-degraded: writes are rejected until retry succeeds')
    }
  }

  private isCurrent(epoch: number): boolean {
    return !this.closed && this.epoch === epoch
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
    /** Test/host diagnostic hook; undefined until the plugin has applied. */
    get instance(): MemoryPersistence | undefined {
      return instance
    },
  }
}

function toKey(user: User, docId: string): string {
  return `${user.userId}\u0000${docId}`
}

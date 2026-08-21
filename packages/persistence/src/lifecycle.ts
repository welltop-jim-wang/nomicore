import * as Y from 'yjs'
import {
  DocDuplicateError,
  resolvePersistenceSchedule,
  systemPersistenceTimer,
  type DocHandle,
  type PersistenceSchedule,
  type PersistenceTimer,
  type User,
} from './index.js'

/**
 * The adapter I/O seam shared by every persistence adapter.
 *
 * - `write` must honor `signal`: once `signal.aborted` is set it must not
 *   execute its commit segment (MemoryPersistence: the private snapshot map
 *   set; FilePersistence: the temp→rename step). A failed `write` must leave
 *   the store unchanged.
 * - `read` must honor `signal` the same way.
 */
export interface PersistenceIO {
  read(key: string, signal: AbortSignal): Promise<Uint8Array | undefined>
  write(key: string, snapshot: Uint8Array, signal: AbortSignal): Promise<void>
}

export type PersistenceStatus = 'ready' | 'persistence-degraded' | 'disposed'

interface LiveEntry {
  readonly key: string
  readonly owner: User
  readonly docId: string
  readonly doc: Y.Doc
  readonly handles: Set<PersistenceHandle>
  dirtyGeneration: number
  savedGeneration: number
  flushing: boolean
  retryDelayMs: number
  debounceTimer?: unknown
  maxDirtyTimer?: unknown
  retryTimer?: unknown
}

interface StoredSnapshot { readonly snapshot: Uint8Array }

/** A store-read error carried through the driver as a value. */
class ReadError {
  constructor(readonly err: unknown) {}
}

/**
 * One in-flight store read. Exactly one driver settles `completion` (through
 * the deferred's exactly-once mutual exclusion), unless a winning createDoc
 * adopts the read first in its completion block.
 */
interface ReadTicket {
  readonly startedBy: 'load' | 'create'
  readonly rawPromise: Promise<Uint8Array | undefined>
  readonly completion: Promise<LiveEntry | null>
  readonly settleOnce: (value: LiveEntry | null) => void
  readonly rejectOnce: (err: unknown) => void
  /** Back-reference filled synchronously when a create supersedes this read. */
  supersededBy: CreateClaim | undefined
  /** Set in the create's completion block, before the claim settles. */
  adoptedByCreate: boolean
  adoptedEntry: LiveEntry | undefined
  /** `rawPromise` settled flag (no promise-state introspection needed). */
  rawSettled: boolean
}

interface CreateClaim {
  /** Settles exactly once on both outcomes of the create operation (U8). */
  promise: Promise<void>
  supersededRead: ReadTicket | undefined
}

type Cell =
  | { state: 'reading'; read: ReadTicket }
  | { state: 'creating'; claim: CreateClaim; supersededRead: ReadTicket | undefined }
  | { state: 'live'; entry: LiveEntry }

const HANDLE_OWNER = new WeakMap<PersistenceHandle, PersistenceLifecycle>()
const RELEASE = new WeakMap<PersistenceLifecycle, (handle: PersistenceHandle) => void>()

class PersistenceHandle implements DocHandle {
  private released = false

  constructor(
    private readonly persistence: PersistenceLifecycle,
    public readonly owner: User,
    public readonly docId: string,
    public readonly doc: Y.Doc,
    readonly entryKey: string,
  ) {
    HANDLE_OWNER.set(this, persistence)
  }

  async release(): Promise<void> {
    if (this.released) return
    this.released = true
    RELEASE.get(this.persistence)!(this)
  }

  get isReleased(): boolean { return this.released }
}

/**
 * The per-key coordinated persistence lifecycle shared by all adapters.
 *
 * Cells coordinate create/load for one `(owner.userId, docId)` key; the flush
 * scheduler (debounce/max-dirty/retry/generation single-flight), eviction,
 * epoch/dispose and handle-lease identity all live here so that adapters never
 * copy the state machine.
 */
export class PersistenceLifecycle {
  private readonly schedule: PersistenceSchedule
  private readonly timer: PersistenceTimer
  private readonly cells = new Map<string, Cell>()
  private readonly inFlight = new Set<Promise<unknown>>()
  private readonly abortController = new AbortController()
  private status: PersistenceStatus = 'ready'
  private closed = false
  private epoch = 0

  constructor(
    private readonly io: PersistenceIO,
    options: { schedule?: Partial<PersistenceSchedule>; timer?: PersistenceTimer } = {},
  ) {
    this.schedule = resolvePersistenceSchedule(options.schedule)
    this.timer = options.timer ?? systemPersistenceTimer
    RELEASE.set(this, (handle) => this.releaseHandle(handle))
  }

  getStatus(): PersistenceStatus { return this.status }

  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    this.assertReadable()
    const key = toKey(owner, docId)
    const cached = this.cells.get(key)
    if (cached?.state === 'live') return this.issueHandle(cached.entry)
    return this.loadSlowPath(owner, docId, key)
  }

  async createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    this.assertWritable()
    this.validateCreateDoc(doc, docId)
    const key = toKey(owner, docId)
    const epoch = this.epoch
    let supersededRead: ReadTicket | undefined

    // ---- claim acquisition ----
    acquire: while (true) {
      const cell = this.cells.get(key)
      if (cell?.state === 'live') throw this.duplicateError(owner, key)
      if (cell?.state === 'creating') throw this.duplicateError(owner, key)
      if (cell?.state === 'reading') {
        if (cell.read.startedBy === 'create') {
          // Join the existing existence check; never issue a second read.
          const raw = await cell.read.rawPromise
          this.assertCurrentEpoch(epoch)
          if (raw !== undefined) throw this.duplicateError(owner, key)
          continue acquire
        }
        // Supersede the load-started read: do not wait for it, do not re-read,
        // do not delete it (the load waiter still relies on it on rollback).
        supersededRead = cell.read
        break acquire
      }
      // Empty: this create must probe the store itself.
      const read = this.startReadTicket(key, owner, docId, 'create', epoch)
      const raw = await read.rawPromise
      this.assertCurrentEpoch(epoch)
      if (raw !== undefined) throw this.duplicateError(owner, key)
      const now = this.cells.get(key)
      if (now === undefined) break acquire
      continue acquire
    }

    // ---- perform create (the cell is creating before any write) ----
    const claim: CreateClaim = { promise: undefined!, supersededRead }
    if (supersededRead !== undefined) supersededRead.supersededBy = claim
    this.cells.set(key, { state: 'creating', claim, supersededRead })
    const op = this.track((async () => {
      try {
        const snapshot = Y.encodeStateAsUpdate(doc)
        await this.io.write(key, snapshot, this.abortController.signal)
        this.assertCurrentEpoch(epoch)
        const entry = this.createEntry(owner, docId, key, doc)
        this.cells.set(key, { state: 'live', entry })
        // Adopt the superseded read in the same synchronous block: the load
        // waiter immediately gets the created live entry (I5).
        if (supersededRead !== undefined && !supersededRead.adoptedByCreate) {
          supersededRead.adoptedByCreate = true
          supersededRead.adoptedEntry = entry
          supersededRead.settleOnce(entry)
        }
        return this.issueHandle(entry)
      } catch (err) {
        const cur = this.cells.get(key)
        if (cur?.state === 'creating' && cur.claim === claim) {
          if (supersededRead !== undefined && !supersededRead.rawSettled) {
            // The superseded driver is still parked at its read: hand the cell
            // back so it can route its own evidence on settle.
            this.cells.set(key, { state: 'reading', read: supersededRead })
          } else {
            this.cells.delete(key)
          }
        }
        throw err
      }
    })())
    // U8: the claim settles on both outcomes through this derived wiring —
    // the try/catch above performs no claim settlement of its own.
    claim.promise = op.then(() => undefined, () => undefined)
    return op
  }

  async saveDoc(handle: DocHandle): Promise<void> {
    this.assertWritable()
    const owned = this.assertOwnedHandle(handle)
    const cell = this.cells.get(owned.entryKey)
    if (cell?.state !== 'live' || !cell.entry.handles.has(owned)) throw new Error('foreign or released DocHandle')
    cell.entry.dirtyGeneration += 1
    this.scheduleFlush(cell.entry)
  }

  /** Synchronous test seed: reuses a live cell, otherwise registers a new doc without writing the store. */
  seedForTest(owner: User, docId: string): DocHandle {
    this.assertWritable()
    const key = toKey(owner, docId)
    const cell = this.cells.get(key)
    if (cell?.state === 'live') return this.issueHandle(cell.entry)
    if (cell?.state === 'reading' || cell?.state === 'creating') {
      throw new Error('test seed requires an idle key cell')
    }
    const entry = this.createEntry(owner, docId, key, new Y.Doc())
    this.cells.set(key, { state: 'live', entry })
    return this.issueHandle(entry)
  }

  /**
   * Abort I/O, clear local resources, then await every tracked operation.
   * Adapter I/O implementations must honor the supplied AbortSignal; this makes
   * plugin unload wait for all restore/flush/create work to settle without
   * real-time polling or a hidden timeout policy.
   */
  async dispose(): Promise<void> {
    if (this.closed) {
      await Promise.allSettled([...this.inFlight])
      return
    }
    this.closed = true
    this.epoch += 1
    this.status = 'disposed'
    this.abortController.abort()
    for (const cell of this.cells.values()) {
      if (cell.state === 'live') {
        const entry = cell.entry
        this.clearTimers(entry)
        entry.handles.clear()
        entry.doc.destroy()
      }
    }
    this.cells.clear()
    await Promise.allSettled([...this.inFlight])
  }

  private async loadSlowPath(owner: User, docId: string, key: string): Promise<DocHandle | null> {
    const epoch = this.epoch
    let sawEntry = false
    while (true) {
      const entry = await this.resolveLoad(key, epoch, owner, docId)
      this.assertReadable()
      if (entry === null) {
        if (sawEntry) {
          console.error('[persistence] integrity violation: resolved entry had committed store content, but a fresh read found none', { key })
          throw new Error(`persistence integrity: fresh store read found no snapshot after a resolved entry was evicted (${key})`)
        }
        return null
      }
      sawEntry = true
      // Ownership re-validation in the same synchronous block as issuance:
      // never sign a handle for a destroyed/evicted document (I6).
      const cell = this.cells.get(key)
      if (cell?.state === 'live' && cell.entry === entry) {
        return this.issueHandle(entry)
      }
    }
  }

  private async resolveLoad(key: string, epoch: number, owner: User, docId: string): Promise<LiveEntry | null> {
    while (true) {
      const cell = this.cells.get(key)
      if (cell?.state === 'live') return cell.entry
      if (cell?.state === 'creating') {
        await cell.claim.promise
        continue
      }
      if (cell?.state === 'reading') return await cell.read.completion
      this.startReadTicket(key, owner, docId, 'load', epoch)
      continue
    }
  }

  private startReadTicket(key: string, owner: User, docId: string, startedBy: 'load' | 'create', epoch: number): ReadTicket {
    const read = this.createReadTicket(key, startedBy)
    this.cells.set(key, { state: 'reading', read })
    const driver = this.driveLoadRead(key, owner, docId, read, epoch).then(
      (value) => { read.settleOnce(value) },
      (err: unknown) => { read.rejectOnce(err) },
    )
    void this.track(driver)
    return read
  }

  private createReadTicket(key: string, startedBy: 'load' | 'create'): ReadTicket {
    let completionResolve: (value: LiveEntry | null) => void = () => {}
    let completionReject: (reason?: unknown) => void = () => {}
    const completion = new Promise<LiveEntry | null>((resolve, reject) => {
      completionResolve = resolve
      completionReject = reject
    })
    let settled = false
    const rawPromise = this.io.read(key, this.abortController.signal)
    const read: ReadTicket = {
      startedBy,
      rawPromise,
      completion,
      settleOnce(value) {
        if (settled) return
        settled = true
        completionResolve(value)
      },
      rejectOnce(err) {
        if (settled) return
        settled = true
        completionReject(err)
      },
      supersededBy: undefined,
      adoptedByCreate: false,
      adoptedEntry: undefined,
      rawSettled: false,
    }
    void rawPromise.then(
      () => { read.rawSettled = true },
      () => { read.rawSettled = true },
    )
    return read
  }

  /**
   * The single driver per read ticket. After the read settles, exactly one of
   * adopted / superseded / plain holds; the superseded branch re-validates cell
   * ownership before routing evidence (never awaits its own completion).
   */
  private async driveLoadRead(key: string, owner: User, docId: string, read: ReadTicket, epoch: number): Promise<LiveEntry | null> {
    let snapshot: Uint8Array | undefined | ReadError
    try {
      snapshot = await read.rawPromise
    } catch (err) {
      snapshot = new ReadError(err)
    }

    if (read.adoptedByCreate) {
      this.observeLateReadOutcome(key, snapshot)
      return read.adoptedEntry!
    }

    const claim = read.supersededBy
    if (claim !== undefined) {
      await claim.promise
      if (read.adoptedByCreate) {
        this.observeLateReadOutcome(key, snapshot)
        return read.adoptedEntry!
      }
      // The create failed. If the rollback handed the cell back to this
      // ticket, route as its owner; otherwise fall back to the evidence.
      const cell = this.cells.get(key)
      if (cell?.state === 'reading' && cell.read === read) {
        return this.ownerRoute(key, owner, docId, snapshot, epoch)
      }
      return this.routeEvidence(key, owner, docId, snapshot, epoch)
    }

    return this.ownerRoute(key, owner, docId, snapshot, epoch)
  }

  /** Classic owner routing; the caller holds the reading cell with this ticket. */
  private async ownerRoute(key: string, owner: User, docId: string, snapshot: Uint8Array | undefined | ReadError, epoch: number): Promise<LiveEntry | null> {
    if (!this.isCurrent(epoch)) {
      this.cells.delete(key)
      throw new Error('persistence is disposed')
    }
    if (snapshot instanceof ReadError) {
      this.cells.delete(key)
      throw snapshot.err
    }
    if (snapshot === undefined) {
      this.cells.delete(key)
      return null
    }
    let entry: LiveEntry
    try {
      entry = this.restoreAndValidate(snapshot, owner, docId, key)
    } catch (err) {
      // No reading residue: the next load re-reads the store (self-heals).
      this.cells.delete(key)
      throw err
    }
    this.cells.set(key, { state: 'live', entry })
    return entry
  }

  /** Create-failure evidence fallback, reachable only when this ticket no longer owns the cell. */
  private async routeEvidence(key: string, owner: User, docId: string, snapshot: Uint8Array | undefined | ReadError, epoch: number): Promise<LiveEntry | null> {
    if (!this.isCurrent(epoch)) throw new Error('persistence is disposed')
    if (snapshot instanceof ReadError) throw snapshot.err
    if (snapshot === undefined) return null
    const entry = this.restoreAndValidate(snapshot, owner, docId, key)
    if (this.cells.get(key) === undefined) {
      this.cells.set(key, { state: 'live', entry })
      return entry
    }
    entry.doc.destroy()
    return this.resolveLoad(key, epoch, owner, docId)
  }

  /** Late outcome of a superseded read: observation only, never routed (I5). */
  private observeLateReadOutcome(key: string, snapshot: Uint8Array | undefined | ReadError): void {
    if (snapshot instanceof Uint8Array) {
      console.error('[persistence] lost-update anomaly: createDoc superseded a pending load whose store read returned a pre-existing snapshot', { key })
    } else if (snapshot instanceof ReadError) {
      console.warn('[persistence] superseded store read failed after createDoc won the key; ignoring stale read error', { key })
    }
  }

  private validateCreateDoc(doc: Y.Doc, docId: string): void {
    const metaDocId = doc.getMap('META').get('docId')
    if (metaDocId !== docId) {
      throw new Error(`doc META.docId ${String(metaDocId)} does not match requested docId ${docId}`)
    }
  }

  private duplicateError(owner: User, key: string): DocDuplicateError {
    return new DocDuplicateError(`createDoc duplicate: owner ${owner.userId} already has this docId (${key})`)
  }

  private restoreAndValidate(snapshot: Uint8Array, owner: User, docId: string, key: string): LiveEntry {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, snapshot)
    const metaDocId = doc.getMap('META').get('docId')
    if (metaDocId !== docId) {
      doc.destroy()
      throw new Error(`persisted META.docId ${String(metaDocId)} does not match requested docId ${docId}`)
    }
    return this.createEntry(owner, docId, key, doc)
  }

  private createEntry(owner: User, docId: string, key: string, doc: Y.Doc): LiveEntry {
    return { key, owner, docId, doc, handles: new Set(), dirtyGeneration: 0, savedGeneration: 0, flushing: false, retryDelayMs: this.schedule.debounceMs || 1 }
  }

  private issueHandle(entry: LiveEntry): DocHandle {
    const handle = new PersistenceHandle(this, entry.owner, entry.docId, entry.doc, entry.key)
    entry.handles.add(handle)
    return handle
  }

  private releaseHandle(handle: PersistenceHandle): void {
    const cell = this.cells.get(handle.entryKey)
    if (cell?.state !== 'live' || !cell.entry.handles.has(handle)) return
    cell.entry.handles.delete(handle)
    this.maybeEvict(cell.entry)
  }

  private scheduleFlush(entry: LiveEntry): void {
    if (entry.flushing || this.closed) return
    if (entry.maxDirtyTimer === undefined) entry.maxDirtyTimer = this.timer.setTimeout(() => this.onMaxDirty(entry), this.schedule.maxDirtyMs)
    if (entry.debounceTimer !== undefined) this.timer.clearTimeout(entry.debounceTimer)
    entry.debounceTimer = this.timer.setTimeout(() => this.onDebounce(entry), this.schedule.debounceMs)
  }

  private onDebounce(entry: LiveEntry): void {
    entry.debounceTimer = undefined
    this.cancelMaxDirty(entry)
    this.startFlush(entry)
  }

  private onMaxDirty(entry: LiveEntry): void {
    entry.maxDirtyTimer = undefined
    this.cancelDebounce(entry)
    this.startFlush(entry)
  }

  private startFlush(entry: LiveEntry): void {
    if (entry.flushing || this.closed) return
    void this.track(this.flush(entry, this.epoch)).catch(() => {})
  }

  private async flush(entry: LiveEntry, epoch: number): Promise<void> {
    if (entry.flushing || entry.savedGeneration === entry.dirtyGeneration || !this.isCurrent(epoch)) return
    entry.flushing = true
    const generation = entry.dirtyGeneration
    const snapshot = Y.encodeStateAsUpdate(entry.doc)
    try {
      await this.io.write(entry.key, snapshot, this.abortController.signal)
      if (!this.isCurrent(epoch)) return
      entry.savedGeneration = generation
      entry.retryDelayMs = this.schedule.debounceMs || 1
      this.status = 'ready'
    } catch {
      if (!this.isCurrent(epoch)) return
      this.status = 'persistence-degraded'
      this.scheduleRetry(entry)
    } finally {
      if (!this.isCurrent(epoch)) return
      entry.flushing = false
      // A save during the previous flush belongs to a fresh dirty window. The
      // old generation's timers have already fired/cancelled, so schedule the
      // next debounce only after the single-flight lock is released.
      if (entry.savedGeneration !== entry.dirtyGeneration && entry.retryTimer === undefined) {
        this.cancelDebounce(entry)
        this.cancelMaxDirty(entry)
        this.scheduleFlush(entry)
      }
      this.maybeEvict(entry)
    }
  }

  private scheduleRetry(entry: LiveEntry): void {
    if (entry.retryTimer !== undefined || this.closed) return
    const delay = entry.retryDelayMs
    entry.retryDelayMs = Math.min(Math.max(delay * 2, 1), this.schedule.maxDirtyMs)
    entry.retryTimer = this.timer.setTimeout(() => {
      entry.retryTimer = undefined
      this.startFlush(entry)
    }, delay)
  }

  private maybeEvict(entry: LiveEntry): void {
    if (entry.handles.size || entry.flushing || entry.savedGeneration !== entry.dirtyGeneration) return
    this.clearTimers(entry)
    const cell = this.cells.get(entry.key)
    if (cell?.state === 'live' && cell.entry === entry) this.cells.delete(entry.key)
    entry.doc.destroy()
  }

  private cancelDebounce(entry: LiveEntry): void {
    if (entry.debounceTimer !== undefined) this.timer.clearTimeout(entry.debounceTimer)
    entry.debounceTimer = undefined
  }

  private cancelMaxDirty(entry: LiveEntry): void {
    if (entry.maxDirtyTimer !== undefined) this.timer.clearTimeout(entry.maxDirtyTimer)
    entry.maxDirtyTimer = undefined
  }

  private clearTimers(entry: LiveEntry): void {
    this.cancelDebounce(entry)
    this.cancelMaxDirty(entry)
    if (entry.retryTimer !== undefined) this.timer.clearTimeout(entry.retryTimer)
    entry.retryTimer = undefined
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.inFlight.add(promise)
    void promise.then(() => this.inFlight.delete(promise), () => this.inFlight.delete(promise))
    return promise
  }

  private assertOwnedHandle(handle: DocHandle): PersistenceHandle {
    if (!(handle instanceof PersistenceHandle) || HANDLE_OWNER.get(handle) !== this || handle.isReleased) throw new Error('foreign or released DocHandle')
    return handle
  }

  private assertReadable(): void { if (this.closed) throw new Error('persistence is disposed') }

  private assertWritable(): void {
    this.assertReadable()
    if (this.status === 'persistence-degraded') throw new Error('persistence-degraded: writes are rejected until retry succeeds')
  }

  private assertCurrentEpoch(epoch: number): void {
    if (!this.isCurrent(epoch)) throw new Error('createDoc rejected: persistence is disposed')
  }

  private isCurrent(epoch: number): boolean { return !this.closed && this.epoch === epoch }
}

function toKey(user: User, docId: string): string { return `${user.userId}\u0000${docId}` }

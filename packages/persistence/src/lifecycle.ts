import * as Y from 'yjs'
import {
  DocCreateFatalError,
  DocCreateOperationalError,
  DocDuplicateError,
  DocLoadOperationalError,
  resolvePersistenceSchedule,
  type DocHandle,
  type DocHandleStatus,
  type PersistenceSchedule,
  type PersistenceScheduler,
  type User,
} from './contract.js'

/**
 * The adapter I/O seam shared by every persistence adapter.
 *
 * Observable-channel axiom (design §3.1): `committed` is judged against the
 * store this instance's READ path trusts.
 *
 * - `write` resolve ⟺ the trusted store already holds this snapshot — the
 *   commit segment has fully executed (Memory: flat-hook side effects + the
 *   private mirror set; File: temp→rename completed). A write must never
 *   resolve without having executed its commit segment (no silent no-op
 *   resolve).
 * - `write` reject ⟹ this write did not change the trusted store. Abort
 *   semantics are carried by an ENTRY gate: once `signal.aborted` is set, the
 *   write must not enter its pipeline at all (Memory: entry `throwIfAborted`
 *   before any flat hook; File: entry + after-mkdir + after-writeFile gates,
 *   all before rename). A write that has passed the entry gate runs to
 *   completion (hook side effects + commit segment; File's rename, once
 *   executed, completes) — completion ⇒ resolve ⇒ committed.
 * - Seam-violation definition (an adapter bug the lifecycle declares but does
 *   not defend against): ① a write that rejects after partially committing;
 *   ② a synchronous throw from `read`/`write` — PersistenceIO methods must
 *   NEVER throw synchronously: every failure goes through the returned
 *   promise's rejection.
 * - `read` must honor `signal` the same way: abort ⇒ rejection through the
 *   returned promise, never a fabricated verdict, never a synchronous throw.
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
  degraded: boolean
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
}

interface CreateClaim {
  /** Settles exactly once on both outcomes of the create operation (U8). */
  promise: Promise<void>
}

type Cell =
  | { state: 'reading'; read: ReadTicket }
  | { state: 'creating'; claim: CreateClaim }
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

  getStatus(): DocHandleStatus {
    return this.persistence.handleStatusOf(this)
  }
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
  private readonly scheduler: PersistenceScheduler
  private readonly cells = new Map<string, Cell>()
  private readonly inFlight = new Set<Promise<unknown>>()
  private readonly abortController = new AbortController()
  private closed = false
  private epoch = 0

  constructor(
    private readonly io: PersistenceIO,
    options: { schedule?: Partial<PersistenceSchedule> | undefined; scheduler: PersistenceScheduler },
  ) {
    this.schedule = resolvePersistenceSchedule(options.schedule)
    this.scheduler = options.scheduler
    RELEASE.set(this, (handle) => this.releaseHandle(handle))
  }

  getStatus(): PersistenceStatus {
    if (this.closed) return 'disposed'
    for (const cell of this.cells.values()) {
      if (cell.state === 'live' && cell.entry.degraded) return 'persistence-degraded'
    }
    return 'ready'
  }

  /** Entry-level status resolution for a handle this lifecycle issued (issue #79). */
  handleStatusOf(handle: PersistenceHandle): DocHandleStatus {
    if (this.closed) return 'disposed'
    if (handle.isReleased) return 'released'
    const cell = this.cells.get(handle.entryKey)
    if (cell?.state !== 'live' || !cell.entry.handles.has(handle)) {
      // Lease invariant: an unreleased handle on an open lifecycle always has
      // a live entry that still counts it — maybeEvict requires
      // handles.size === 0, and dispose is caught by the closed check above.
      // Reaching this branch is an integrity bug: loud, never a silent
      // fallback status.
      throw new Error(`persistence integrity: unreleased handle has no live entry (${handle.entryKey})`)
    }
    return cell.entry.degraded ? 'persistence-degraded' : 'ready'
  }

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
    // ---- claim acquisition ----
    acquire: while (true) {
      const cell = this.cells.get(key)
      if (cell?.state === 'live') throw this.duplicateError(owner, key)
      if (cell?.state === 'creating') throw this.duplicateError(owner, key)
      if (cell?.state === 'reading') {
        // A pending load may reveal an already committed snapshot. Wait for the
        // evidence before creating: createDoc must never overwrite a document
        // merely because its existence read was late.
        let raw: Uint8Array | undefined
        try {
          raw = await cell.read.rawPromise
          this.assertCurrentEpoch(epoch)
        } catch (err) {
          // R1/R2/R3 (design §2.2): probe-read failure. On a current epoch this
          // is an operational store failure (the create wrote nothing, so
          // committed:false is authoritative); once the lifecycle ended
          // (dispose race) the same rejection is a probe-read fatal — AC6
          // forbids reporting a store-health fact the lifecycle can no longer
          // verify. The disposed-epoch Error survives as the exact `cause`.
          throw this.classifyCreateStoreFailure('probe-read', err, epoch)
        }
        if (raw !== undefined) throw this.duplicateError(owner, key)
        continue acquire
      }
      // Empty: this create must probe the store itself.
      const read = this.startReadTicket(key, owner, docId, 'create', epoch)
      let raw: Uint8Array | undefined
      try {
        raw = await read.rawPromise
        this.assertCurrentEpoch(epoch)
      } catch (err) {
        // R1/R2/R3 rationale 同上（design §2.2）：probe-read 拒绝按 epoch
        // current/stale 分类；assertCurrentEpoch 失败恒 stale ⇒ 走 fatal 分支。
        throw this.classifyCreateStoreFailure('probe-read', err, epoch)
      }
      if (raw !== undefined) throw this.duplicateError(owner, key)
      const now = this.cells.get(key)
      if (now === undefined) break acquire
      continue acquire
    }

    // ---- perform create (the cell is creating before any write) ----
    const claim: CreateClaim = { promise: undefined! }
    this.cells.set(key, { state: 'creating', claim })
    const op = this.track((async () => {
      try {
        // W1: pre-commit encoding — a Yjs internal failure is fatal, never
        // downgraded to operational (AC6); nothing was written, and the
        // committed:false fact is authoritative (the write path never ran).
        let snapshot: Uint8Array
        try {
          snapshot = Y.encodeStateAsUpdate(doc)
        } catch (err) {
          throw new DocCreateFatalError('snapshot-encode', err)
        }
        // W2/W3: store-level write rejection. On a current epoch this is the
        // store's own operational failure (committed:false per the
        // observable-channel axiom: reject ⟹ the trusted store unchanged);
        // once the lifecycle ended (dispose abort), the rejection means the
        // commit segment never ran — a store-write fatal, never operational.
        try {
          await this.io.write(key, snapshot, this.abortController.signal)
        } catch (err) {
          throw this.classifyCreateStoreFailure('store-write', err, epoch)
        }
        // W4/W5: the commit point is crossed the moment write resolved
        // (resolve ⟺ committed) — every failure from here on is post-commit
        // committed:true. No rollback is claimed, promised, or performed.
        try {
          this.assertCurrentEpoch(epoch)
          const entry = this.createEntry(owner, docId, key, doc)
          this.cells.set(key, { state: 'live', entry })
          return this.issueHandle(entry)
        } catch (err) {
          throw new DocCreateFatalError('post-commit', err)
        }
      } catch (err) {
        const cur = this.cells.get(key)
        if (cur?.state === 'creating' && cur.claim === claim) {
          this.cells.delete(key)
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
    // (issue #79) degraded is NOT a rejection reason: saveDoc is the
    // post-mutation dirty notification. The entry's pending retry covers the
    // new dirty generation with the full live Y.Doc.
    cell.entry.dirtyGeneration += 1
    this.scheduleFlush(cell.entry)
  }

  /** Synchronous test seed: reuses a live cell, otherwise registers a new doc without writing the store. */
  seedForTest(owner: User, docId: string): DocHandle {
    this.assertWritable()
    const key = toKey(owner, docId)
    const cell = this.cells.get(key)
    if (cell?.state === 'live') {
      // (issue #79) degraded is not a rejection reason on the read/lease path
      // (ADR-0006 keeps reads while degraded): a twin lease on a degraded
      // entry is legal and reports the entry status.
      return this.issueHandle(cell.entry)
    }
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
    // (issue #108 §4.2.6) The create path awaits `rawPromise` directly; when a
    // create-started read rejects with no concurrent load attached, `completion`
    // would otherwise be a forever-unhandled rejection. Awaited consumers
    // (concurrent loads routed through `resolveLoad`) still observe it.
    completion.catch(() => {})
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
    }
    return read
  }

  /** The single driver per read ticket, which exclusively routes its evidence. */
  private async driveLoadRead(key: string, owner: User, docId: string, read: ReadTicket, epoch: number): Promise<LiveEntry | null> {
    let snapshot: Uint8Array | undefined | ReadError
    try {
      snapshot = await read.rawPromise
    } catch (err) {
      snapshot = new ReadError(err)
    }
    return this.routeOwnedRead(key, owner, docId, snapshot, epoch)
  }

  /** Classic owner routing; the caller holds the reading cell with this ticket. */
  private async routeOwnedRead(key: string, owner: User, docId: string, snapshot: Uint8Array | undefined | ReadError, epoch: number): Promise<LiveEntry | null> {
    if (!this.isCurrent(epoch)) {
      this.cells.delete(key)
      throw new Error('persistence is disposed')
    }
    if (snapshot instanceof ReadError) {
      this.cells.delete(key)
      // L1 (design §2.1): store-level read failure on a current epoch is the
      // one operational classification for the load path. The exact original
      // rejection (identity-stable) is preserved on `cause`; the stable
      // message never concatenates it. The cell cleanup above stays first, so
      // the failed ticket self-heals on the next load.
      throw new DocLoadOperationalError(snapshot.err)
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

  private validateCreateDoc(doc: Y.Doc, docId: string): void {
    const metaDocId = doc.getMap('META').get('docId')
    if (metaDocId !== docId) {
      throw new Error(`doc META.docId ${String(metaDocId)} does not match requested docId ${docId}`)
    }
  }

  private duplicateError(owner: User, key: string): DocDuplicateError {
    return new DocDuplicateError(`createDoc duplicate: owner ${owner.userId} already has this docId (${key})`)
  }

  /**
   * The one classifier for every store-level create failure before the commit
   * point, shared by the claim probe-read sites (R1/R2/R3) and the write
   * segment (W2/W3). On a current epoch the store rejection is an operational
   * failure — the create wrote nothing, so committed:false is authoritative;
   * once the lifecycle ended (dispose race) the same rejection is a `phase`
   * fatal — AC6 forbids reporting a store-health fact the lifecycle can no
   * longer verify. The original failure survives as the exact `cause`. The
   * R3 branch (assertCurrentEpoch rejection) always lands on the fatal side
   * here: it throws only when `isCurrent(epoch)` is already false. Post-commit
   * failures (W4/W5) never pass through this classifier: write resolved ⟹
   * committed:true unconditionally.
   */
  private classifyCreateStoreFailure(
    phase: 'probe-read' | 'store-write',
    err: unknown,
    epoch: number,
  ): DocCreateOperationalError | DocCreateFatalError {
    return this.isCurrent(epoch)
      ? new DocCreateOperationalError(err)
      : new DocCreateFatalError(phase, err)
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
    return { key, owner, docId, doc, handles: new Set(), degraded: false, dirtyGeneration: 0, savedGeneration: 0, flushing: false, retryDelayMs: this.schedule.debounceMs || 1 }
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
    // Single-scheduler discipline (issue #79): while a retry timer is pending
    // (degraded window), the retry backoff IS the flush schedule — its next
    // flush captures the CURRENT dirtyGeneration from the full live Y.Doc, and
    // the backoff is capped at maxDirtyMs, preserving the max-dirty attempt
    // guarantee. Arming debounce/maxDirty here would stack a second schedule
    // whose stale timers outlive the retry (the retry's success path sees
    // savedGeneration === dirtyGeneration and never cancels them).
    if (entry.retryTimer !== undefined) return
    if (entry.maxDirtyTimer === undefined) entry.maxDirtyTimer = this.scheduler.setTimeout(() => this.onMaxDirty(entry), this.schedule.maxDirtyMs)
    if (entry.debounceTimer !== undefined) this.scheduler.clearTimeout(entry.debounceTimer)
    entry.debounceTimer = this.scheduler.setTimeout(() => this.onDebounce(entry), this.schedule.debounceMs)
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
      entry.degraded = false
    } catch {
      if (!this.isCurrent(epoch)) return
      entry.degraded = true
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
    entry.retryTimer = this.scheduler.setTimeout(() => {
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
    if (entry.debounceTimer !== undefined) this.scheduler.clearTimeout(entry.debounceTimer)
    entry.debounceTimer = undefined
  }

  private cancelMaxDirty(entry: LiveEntry): void {
    if (entry.maxDirtyTimer !== undefined) this.scheduler.clearTimeout(entry.maxDirtyTimer)
    entry.maxDirtyTimer = undefined
  }

  private clearTimers(entry: LiveEntry): void {
    this.cancelDebounce(entry)
    this.cancelMaxDirty(entry)
    if (entry.retryTimer !== undefined) this.scheduler.clearTimeout(entry.retryTimer)
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
  }

  private assertCurrentEpoch(epoch: number): void {
    if (!this.isCurrent(epoch)) throw new Error('createDoc rejected: persistence is disposed')
  }

  private isCurrent(epoch: number): boolean { return !this.closed && this.epoch === epoch }
}

function toKey(owner: User, docId: string): string { return `${owner.userId}\u0000${docId}` }

import type { Context } from '@deepseek-ai/cordis'
import type { TimerService } from '@deepseek-ai/cordis-plugin-timer'
import * as Y from 'yjs'
import {
  DocCreateFatalError,
  DocCreateOperationalError,
  DocDuplicateError,
  DocLoadOperationalError,
  type DocHandle,
  type DocPersistence,
  type PersistenceScheduler,
  type User,
} from './contract.js'
import type { PersistenceIO } from './lifecycle.js'

/** Lazily load Vitest so the test-support timer remains CLI-safe. */
async function vitest(): Promise<typeof import('vitest')> {
  return await import('vitest')
}

/**
 * The factory shape shared by every persistence adapter's contract test.
 *
 * Adapters may accept configuration in their own test setup; the factory here
 * only exposes the ready-to-exercise `DocPersistence` face. `createHandle()`
 * seeds a document through the adapter's public creation path (owner
 * semantics: the storage owner, not the current accessor).
 */
export interface DocPersistenceContractFixture {
  readonly persistence: DocPersistence
  createHandle(owner: User, docId: string): Promise<DocHandle>
}

export type DocPersistenceContractFactory = () => Promise<DocPersistenceContractFixture> | DocPersistenceContractFixture

/**
 * Reusable P2/P3 contract suite for lease-owning persistence adapters.
 *
 * It locks the persistence seam without prescribing any storage implementation.
 * P2 MemoryPersistence and P3 FilePersistence must invoke this suite against
 * their own factories.
 */
export async function describeDocPersistenceContract(
  factory: DocPersistenceContractFactory,
): Promise<void> {
  const { describe, expect, it } = await vitest()
  const owner: User = { userId: 'contract-user' }
  const docId = 'contract-doc'

  describe('DocPersistence lease contract', () => {
    it('returns independent handles sharing one live Y.Doc', async () => {
      const { persistence, createHandle } = await factory()
      const seeded = await createHandle(owner, docId)
      await persistence.saveDoc(seeded)
      await seeded.release()

      const first = await persistence.loadDoc(owner, docId)
      const second = await persistence.loadDoc(owner, docId)

      expect(first).not.toBeNull()
      expect(second).not.toBeNull()
      expect(first).not.toBe(second)
      expect(first!.doc).toBe(second!.doc)

      await first!.release()
      await second!.release()
    })

    it('makes release idempotent and does not invalidate another handle', async () => {
      const { persistence, createHandle } = await factory()
      const seeded = await createHandle(owner, docId)
      await persistence.saveDoc(seeded)
      await seeded.release()

      const first = await persistence.loadDoc(owner, docId)
      const second = await persistence.loadDoc(owner, docId)
      expect(first).not.toBeNull()
      expect(second).not.toBeNull()

      await expect(first!.release()).resolves.toBeUndefined()
      await expect(first!.release()).resolves.toBeUndefined()
      await expect(persistence.saveDoc(second!)).resolves.toBeUndefined()

      await second!.release()
    })

    it('rejects foreign and released handles passed to saveDoc', async () => {
      const first = await factory()
      const second = await factory()
      const handle = await first.createHandle(owner, docId)

      await expect(second.persistence.saveDoc(handle)).rejects.toThrow()
      await handle.release()
      await expect(first.persistence.saveDoc(handle)).rejects.toThrow()
    })
  })
}

// ---------------------------------------------------------------------------
// createDoc / owner-semantics contract (issue-64 shared suite)
//
// This suite is the acceptance anchor for the createDoc feature. Every
// adapter — MemoryPersistence now, FilePersistence when it lands — must run
// it against its own fixture. The suite only speaks the public seam: it
// drives `createDoc`/`loadDoc`/`saveDoc` on the adapter, injects I/O failures
// and gates through the fixture's store hooks, and verifies committed
// snapshots through a second adapter instance over the same store.
// ---------------------------------------------------------------------------

/** A deterministic scheduler facade: `advanceBy` fires due callbacks in order. */
export interface TestScheduler extends PersistenceScheduler {
  advanceBy(milliseconds: number): Promise<void>
  pending(): number
}

/** Fake-clock scheduler used by the shared suite (no real sleeps). */
export function createTestScheduler(): TestScheduler {
  let now = 0
  let nextId = 0
  const timers = new Map<number, { at: number, callback: () => void }>()
  return {
    setTimeout(callback, delayMs) {
      const id = nextId++
      timers.set(id, { at: now + delayMs, callback })
      return id
    },
    clearTimeout(timer) {
      timers.delete(timer as number)
    },
    pending: () => timers.size,
    async advanceBy(milliseconds) {
      const deadline = now + milliseconds
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= deadline)
          .sort(([, left], [, right]) => left.at - right.at)[0]
        if (!due) break
        const [id, timer] = due
        timers.delete(id)
        now = timer.at
        timer.callback()
        for (let index = 0; index < 3; index += 1) await Promise.resolve()
      }
      now = deadline
      for (let index = 0; index < 3; index += 1) await Promise.resolve()
    },
  }
}

/**
 * Cordis fake timer plugin for integration tests: supplies the `'timer'`
 * service and its `ctx.timeout` mixin through the injected scheduler.
 *
 * `timeout` and `setTimeout` return idempotent disposers, matching Cordis'
 * TimerService contract. The remaining TimerService operations intentionally
 * fail because persistence exercises only one-shot scheduling.
 */
export function createFakeTimerPlugin(
  timer: Pick<PersistenceScheduler, 'setTimeout' | 'clearTimeout'>,
): { apply(ctx: Context): void } {
  const service = {
    timeout: (callback: () => void, delay: number): (() => void) => {
      const id = timer.setTimeout(callback, delay)
      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        timer.clearTimeout(id)
      }
    },
    setTimeout: (callback: () => void, delay: number): (() => void) => service.timeout(callback, delay),
    interval: (..._args: unknown[]): never => {
      throw new TypeError('fake timer plugin does not implement interval')
    },
    setInterval: (..._args: unknown[]): never => {
      throw new TypeError('fake timer plugin does not implement setInterval')
    },
    throttle: (..._args: unknown[]): never => {
      throw new TypeError('fake timer plugin does not implement throttle')
    },
    debounce: (..._args: unknown[]): never => {
      throw new TypeError('fake timer plugin does not implement debounce')
    },
  }
  return {
    apply(ctx: Context): void {
      ctx.effect(() => {
        const unregister = ctx.provide('timer', service as unknown as TimerService)
        ctx.mixin('timer', ['timeout'])
        return () => { unregister() }
      }, 'fake-timer: service')
    },
  }
}

/**
 * Mutable I/O hooks shared by the adapter under test and the fresh adapter
 * instance used to verify committed snapshots. Adapters must delegate their
 * I/O options to the *current* methods of this object so tests can replace
 * `write`/`read` to inject failures and gates.
 */
export interface DocStoreHooks {
  write(key: string, snapshot: Uint8Array, signal: AbortSignal): Promise<void>
  read(key: string, signal: AbortSignal): Promise<Uint8Array | undefined>
}

/** Default in-memory store: the shared suite's "disk". */
export function createDocStore(): DocStoreHooks {
  const snapshots = new Map<string, Uint8Array>()
  return {
    async write(key, snapshot) {
      snapshots.set(key, snapshot.slice())
    },
    async read(key) {
      return snapshots.get(key)
    },
  }
}

/** The future public seam: `createDoc` joins `loadDoc`/`saveDoc` (issue-64). */
export interface DocPersistenceWithCreate extends DocPersistence {
  createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle>
}

export interface DocCreateContractFixture {
  readonly persistence: DocPersistenceWithCreate
  readonly scheduler: TestScheduler
  readonly store: DocStoreHooks
  /** A second adapter over the same store with an empty cache. */
  readonly makeFresh: () => DocPersistence
  readonly dispose: () => Promise<void>
}

export type DocCreateContractFactory = () => Promise<DocCreateContractFixture> | DocCreateContractFixture

export class TestTimeoutError extends Error {
  constructor(readonly op: string) {
    super(`timed out waiting for ${op}`)
    this.name = 'TestTimeoutError'
  }
}

/** Guard that turns a never-settling promise into a clean test failure. */
export function withTimeout<T>(promise: Promise<T>, milliseconds: number, op: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const guard = globalThis.setTimeout(() => reject(new TestTimeoutError(op)), milliseconds)
    promise.then(
      (value) => { globalThis.clearTimeout(guard); resolve(value) },
      (reason: unknown) => { globalThis.clearTimeout(guard); reject(reason) },
    )
  })
}

function docWithMeta(docId: string, who?: string): Y.Doc {
  const doc = new Y.Doc()
  doc.getMap('META').set('docId', docId)
  if (who !== undefined) doc.getMap('ROOT').set('who', who)
  return doc
}

/** Capture a rejection as a value; a resolution fails the test loudly. */
async function rejectionOf<T>(promise: Promise<T>): Promise<unknown> {
  return promise.then(
    () => { throw new Error('expected the operation to reject') },
    (reason: unknown) => reason,
  )
}

/**
 * Asserts the duplicate contract: a stable error code that callers can branch
 * on without parsing `message`. The dedicated error type is pinned when the
 * adapter package exports it; the code is always pinned.
 */
async function assertDuplicateError(reason: unknown): Promise<void> {
  const { expect } = await vitest()
  expect(reason).toMatchObject({ code: 'DOC_DUPLICATE' })
  const mod = await import('./contract.js') as { DocDuplicateError?: new (message?: string) => Error }
  if (mod.DocDuplicateError !== undefined) {
    expect(reason).toBeInstanceOf(mod.DocDuplicateError)
  }
}

/**
 * Shared createDoc acceptance suite (issue-64). Runs against every adapter
 * fixture; see the suite header for the anchored semantics.
 */
export async function describeDocCreateContract(
  factory: DocCreateContractFactory,
): Promise<void> {
  const { describe, expect, it } = await vitest()
  describe('DocPersistence createDoc contract', () => {
    it('creates an owner lease, commits the initial snapshot before resolving, and shares the live doc with loads', async () => {
      const fixture = await factory()
      const { persistence, scheduler } = fixture
      const owner: User = { userId: 'alice' }
      const docId = 'create-happy-doc'
      const doc = docWithMeta(docId, 'hello')

      const handle = await persistence.createDoc(owner, docId, doc)
      expect(handle.doc).toBe(doc)
      expect(handle.owner).toBe(owner)
      expect(handle.docId).toBe(docId)
      // Owner migration: the lease no longer carries a `user` field.
      expect((handle as { user?: unknown }).user).toBeUndefined()
      expect(scheduler.pending()).toBe(0)

      // A same-instance load shares the live document and honors the owner.
      const second = await persistence.loadDoc(owner, docId)
      expect(second).not.toBeNull()
      expect(second!.doc).toBe(doc)
      expect(second!.owner).toBe(owner)
      await second!.release()

      // Fresh adapter over the same store: the initial snapshot was committed
      // before createDoc resolved (no saveDoc involved).
      const fresh = fixture.makeFresh()
      const loaded = await fresh.loadDoc(owner, docId)
      expect(loaded).not.toBeNull()
      expect(loaded!.doc.getMap('ROOT').get('who')).toBe('hello')
      await loaded!.release()

      await handle.release()
      await fixture.dispose()
    })

    it('only registers dirty on saveDoc after create and flushes on the debounce deadline', async () => {
      const fixture = await factory()
      const { persistence, scheduler, store } = fixture
      const owner: User = { userId: 'alice' }
      const docId = 'create-save-doc'
      const handle = await persistence.createDoc(owner, docId, docWithMeta(docId, 'v1'))

      let writes = 0
      store.write = async () => { writes += 1 }
      handle.doc.getMap('ROOT').set('rev', 2)
      await persistence.saveDoc(handle)
      expect(writes).toBe(0)

      await scheduler.advanceBy(499)
      expect(writes).toBe(0)
      await scheduler.advanceBy(1)
      expect(writes).toBe(1)

      await handle.release()
      await fixture.dispose()
    })

    it('rejects duplicate createDoc with a stable error code and never overwrites committed content', async () => {
      const fixture = await factory()
      const { persistence } = fixture
      const owner: User = { userId: 'alice' }
      const docId = 'create-dup-doc'
      const first = await persistence.createDoc(owner, docId, docWithMeta(docId, 'original'))

      // Cache path: the key is already live in this adapter.
      const challenger = docWithMeta(docId, 'overwrite')
      await assertDuplicateError(await rejectionOf(persistence.createDoc(owner, docId, challenger)))
      expect(challenger.isDestroyed).toBe(false)

      // Store path: a fresh adapter with an empty cache sees the committed doc.
      const fresh = fixture.makeFresh()
      await assertDuplicateError(await rejectionOf(fresh.createDoc(owner, docId, docWithMeta(docId, 'again'))))

      // Nothing was overwritten.
      const loaded = await fresh.loadDoc(owner, docId)
      expect(loaded).not.toBeNull()
      expect(loaded!.doc.getMap('ROOT').get('who')).toBe('original')
      await loaded!.release()

      await first.release()
      await fixture.dispose()
    })

    it('lets exactly one concurrent create win and rejects the other with duplicate', async () => {
      const fixture = await factory()
      const { persistence, store } = fixture
      const owner: User = { userId: 'alice' }
      const docId = 'create-race-doc'
      const docA = docWithMeta(docId, 'a')
      const docB = docWithMeta(docId, 'b')

      let enteredWrites = 0
      let releaseWrites: (() => void) | undefined
      const gate = new Promise<void>((resolve) => { releaseWrites = resolve })
      const originalWrite = store.write
      store.write = async (key, snapshot, signal) => {
        enteredWrites += 1
        await gate
        await originalWrite(key, snapshot, signal) // 透传真实写：gate 只门控时序，不吞 payload
      }

      const pending = Promise.allSettled([
        persistence.createDoc(owner, docId, docA),
        persistence.createDoc(owner, docId, docB),
      ])
      releaseWrites!()
      const results = await pending

      const fulfilled = results.filter((result): result is PromiseFulfilledResult<DocHandle> => result.status === 'fulfilled')
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      // The loser was rejected before it could write: no overwrite attempt.
      expect(enteredWrites).toBe(1)

      const winner = fulfilled[0]!.value
      const loserDoc = winner.doc === docA ? docB : docA
      await assertDuplicateError(rejected[0]!.reason)
      expect(loserDoc.isDestroyed).toBe(false)

      await winner.release()
      const fresh = fixture.makeFresh()
      const loaded = await fresh.loadDoc(owner, docId)
      expect(loaded).not.toBeNull()
      expect(loaded!.doc.getMap('ROOT').get('who')).toBe(winner.doc.getMap('ROOT').get('who'))
      await loaded!.release()
      await fixture.dispose()
    })

    it('waits for a pending load before create and rejects when its read finds committed content', async () => {
      const fixture = await factory()
      const { persistence, store } = fixture
      const owner: User = { userId: 'alice' }
      const docId = 'create-load-doc'
      const persisted = docWithMeta(docId, 'already-committed')
      const persistedSnapshot = Y.encodeStateAsUpdate(persisted)

      let readStarted: (() => void) | undefined
      let releaseRead: ((value: Uint8Array | undefined) => void) | undefined
      const readStartedPromise = new Promise<void>((resolve) => { readStarted = resolve })
      store.read = (_key, _signal) => {
        readStarted!()
        return new Promise<Uint8Array | undefined>((resolve) => { releaseRead = resolve })
      }

      const loading = persistence.loadDoc(owner, docId)
      await withTimeout(readStartedPromise, 2_000, 'load to start its restore read')

      const creating = persistence.createDoc(owner, docId, docWithMeta(docId, 'must-not-overwrite'))
      releaseRead!(persistedSnapshot)

      const loaded = await withTimeout(loading, 2_000, 'pending load to restore committed content')
      expect(loaded).not.toBeNull()
      expect(loaded!.doc.getMap('ROOT').get('who')).toBe('already-committed')
      await assertDuplicateError(await rejectionOf(creating))

      await loaded!.release()
      await fixture.dispose()
    })

    it('does not cache, commit, or destroy the caller doc when the initial write fails', async () => {
      const fixture = await factory()
      const { persistence, store, scheduler } = fixture
      const owner: User = { userId: 'alice' }
      const docId = 'create-fail-doc'
      const doc = docWithMeta(docId, 'never-committed')

      const originalWrite = store.write
      const ioDown = new Error('io down')
      store.write = async () => { throw ioDown }
      const err = await rejectionOf(persistence.createDoc(owner, docId, doc))
      // §5.4.1 (issue #108): the failure channel is now a typed operational
      // error — the store rejection must NOT leak into the public message
      // text, and the exact cause is preserved on `cause` (identity-stable).
      expect(err).toBeInstanceOf(DocCreateOperationalError)
      expect((err as { committed: boolean }).committed).toBe(false)
      expect((err as { cause: unknown }).cause).toBe(ioDown)
      expect((err as { message?: string }).message).not.toContain('io down')
      expect(doc.isDestroyed).toBe(false)
      expect(scheduler.pending()).toBe(0)

      // Nothing was committed.
      const fresh = fixture.makeFresh()
      expect(await fresh.loadDoc(owner, docId)).toBeNull()

      // No stale claim: the same key can be created after the failure, and the
      // caller still owns the very same Y.Doc instance.
      store.write = originalWrite
      const retried = await persistence.createDoc(owner, docId, doc)
      expect(retried.doc).toBe(doc)
      await retried.release()
      await fixture.dispose()
    })

    it('keeps A/doc1 and B/doc1 isolated and returns null for unknown keys', async () => {
      const fixture = await factory()
      const { persistence } = fixture
      const alice: User = { userId: 'alice' }
      const bob: User = { userId: 'bob' }
      const docId = 'shared-name'

      const aHandle = await persistence.createDoc(alice, docId, docWithMeta(docId, 'alice-content'))
      const bHandle = await persistence.createDoc(bob, docId, docWithMeta(docId, 'bob-content'))
      expect(aHandle.doc).not.toBe(bHandle.doc)
      await aHandle.release()
      await bHandle.release()

      const aliceLoaded = await persistence.loadDoc(alice, docId)
      const bobLoaded = await persistence.loadDoc(bob, docId)
      expect(aliceLoaded).not.toBeNull()
      expect(bobLoaded).not.toBeNull()
      expect(aliceLoaded!.doc.getMap('ROOT').get('who')).toBe('alice-content')
      expect(bobLoaded!.doc.getMap('ROOT').get('who')).toBe('bob-content')
      expect(await persistence.loadDoc({ userId: 'carol' }, docId)).toBeNull()

      await aliceLoaded!.release()
      await bobLoaded!.release()
      await fixture.dispose()
    })

    it('does not serialize operations of different keys', async () => {
      const fixture = await factory()
      const { persistence, store } = fixture
      const owner: User = { userId: 'alice' }
      const firstDocId = 'create-first-doc'
      const secondDocId = 'create-second-doc'

      let calls = 0
      let firstWriteStarted: (() => void) | undefined
      const firstEntered = new Promise<void>((resolve) => { firstWriteStarted = resolve })
      let releaseFirstWrite: (() => void) | undefined
      store.write = async () => {
        calls += 1
        if (calls === 1) {
          firstWriteStarted!()
          await new Promise<void>((resolve) => { releaseFirstWrite = resolve })
        }
      }

      const first = persistence.createDoc(owner, firstDocId, docWithMeta(firstDocId, '1'))
      await withTimeout(firstEntered, 2_000, 'first create to enter its write')

      const second = await withTimeout(
        persistence.createDoc(owner, secondDocId, docWithMeta(secondDocId, '2')),
        2_000,
        'second create while the first key write is still in flight',
      )
      expect(calls).toBe(2)
      expect(second.doc.getMap('ROOT').get('who')).toBe('2')

      releaseFirstWrite!()
      const firstHandle = await first
      expect(firstHandle.doc.getMap('ROOT').get('who')).toBe('1')

      await firstHandle.release()
      await second.release()
      await fixture.dispose()
    })

    it('validates only META.docId: rejects mismatch, tolerates missing ROOT/SCHEMA and arbitrary createdAt', async () => {
      const fixture = await factory()
      const { persistence } = fixture
      const owner: User = { userId: 'alice' }

      // META.docId mismatch is a loud failure and leaves the caller's doc alone.
      const mismatched = new Y.Doc()
      mismatched.getMap('META').set('docId', 'other-doc')
      await expect(persistence.createDoc(owner, 'expected-doc', mismatched)).rejects.toThrow(/META\.docId/)
      expect(mismatched.isDestroyed).toBe(false)

      // Missing META entirely is also a mismatch.
      const bare = new Y.Doc()
      bare.getMap('ROOT').set('x', 1)
      await expect(persistence.createDoc(owner, 'expected-doc', bare)).rejects.toThrow(/META\.docId/)
      expect(bare.isDestroyed).toBe(false)

      // Permissive: correct docId, no SCHEMA, no ROOT, garbage createdAt.
      const permissive = new Y.Doc()
      permissive.getMap('META').set('docId', 'expected-doc')
      permissive.getMap('META').set('createdAt', 'not-a-date')
      const handle = await persistence.createDoc(owner, 'expected-doc', permissive)
      expect(handle.doc).toBe(permissive)
      await handle.release()

      // ROOT is not validated either: a Y.Text at ROOT is stored as-is.
      const textRoot = new Y.Doc()
      textRoot.getMap('META').set('docId', 'text-root-doc')
      textRoot.getText('ROOT').insert(0, 'hello')
      const textHandle = await persistence.createDoc(owner, 'text-root-doc', textRoot)
      expect(textHandle.doc).toBe(textRoot)
      await textHandle.release()

      const fresh = fixture.makeFresh()
      const loaded = await fresh.loadDoc(owner, 'expected-doc')
      expect(loaded).not.toBeNull()
      expect(loaded!.doc.getMap('META').get('createdAt')).toBe('not-a-date')
      await loaded!.release()
      await fixture.dispose()
    })

    it('settles an in-flight create when dispose races it, leaving no timers or hidden leases', async () => {
      const fixture = await factory()
      const { persistence, store, scheduler } = fixture
      const owner: User = { userId: 'alice' }
      const docId = 'create-dispose-doc'
      const doc = docWithMeta(docId, 'x')

      // §5.4.2 (issue #108 R1/A-1): deterministic entered-gate construction —
      // the previous abort-listener resolve hook violated the PersistenceIO
      // contract (resolve-without-commit) and raced the adapter entry gate.
      // The hook is now entered (entry gate passed), then explicitly rejects
      // with a self-owned instance BEFORE any side effect, only after dispose.
      const writeAborted = new Error('write aborted')
      let releaseWrite: (() => void) | undefined
      let writeEntered: (() => void) | undefined
      const writeEnteredPromise = new Promise<void>((resolve) => { writeEntered = resolve })
      store.write = (_key, _snapshot, _signal) => new Promise<void>((_resolve, reject) => {
        writeEntered!()
        releaseWrite = () => reject(writeAborted)
      })

      const creating = persistence.createDoc(owner, docId, doc)
      await withTimeout(writeEnteredPromise, 2_000, 'create to enter its write')
      const disposing = fixture.dispose()
      releaseWrite!()
      await disposing

      // The in-flight create settles with a real rejection — never with the
      // timeout guard (that would mean the promise leaked and never settled),
      // and never by resolving (that would be a hidden lease past dispose).
      const settlement = await withTimeout(creating, 2_000, 'in-flight create to settle during dispose').then(
        () => 'resolved',
        (reason: unknown) => reason,
      )
      expect(settlement).not.toBeInstanceOf(TestTimeoutError)
      expect(settlement).toBeInstanceOf(Error)
      // §5.4.2 (issue #108): the store-write abort race is a typed fatal with
      // an authoritative committed:false and the exact self-owned cause
      // (identity anchor; EC7's AbortError variant is the complementary one).
      expect(settlement).toBeInstanceOf(DocCreateFatalError)
      expect((settlement as { phase: string }).phase).toBe('store-write')
      expect((settlement as { committed: boolean }).committed).toBe(false)
      expect((settlement as { cause: unknown }).cause).toBe(writeAborted)
      expect(scheduler.pending()).toBe(0)

      // The adapter is closed: no hidden lease can be minted afterwards.
      await expect(persistence.loadDoc(owner, docId)).rejects.toThrow(/disposed/)
      await expect(persistence.createDoc(owner, docId, docWithMeta(docId, 'y'))).rejects.toThrow(/disposed/)
    })
  })
}

// ---------------------------------------------------------------------------
// Typed error contract (issue #108, design §5): the load/create failure
// classification shared by every adapter. Both fixtures drive fault injection
// through ONE mechanism — the `wrapIo` around-seam — so the exact same
// assertion set runs against Memory and File.
// ---------------------------------------------------------------------------

/** One armed gate: `entered` fires when the operation reached the seam; `release()` lets it proceed. */
export interface PersistenceHold {
  readonly entered: Promise<void>
  release(): void
}

/** Single-shot fault injection arming slots for the next seam operation. */
export interface PersistenceIoFaults {
  /** Next read rejects with `reason` before touching the real io. */
  failNextRead(reason: unknown): void
  /** Next write rejects with `reason` before its commit segment (store unchanged). */
  failNextWrite(reason: unknown): void
  /** Next write suspends before its commit segment; `release()` lets the real commit run. */
  holdNextWriteBeforeCommit(): PersistenceHold
  /** Next write suspends AFTER the real commit; `release()` lets the write resolve. */
  holdNextWriteAfterCommit(): PersistenceHold
  /** Next read suspends; after `release()` returns `value` without touching the real io. */
  holdNextReadThen(value: Uint8Array | undefined): PersistenceHold
  /** Next primary-remove rejects with `reason`（R2：归档 remove 段故障注入——归档
   *  提交点已跨过后失败 → relocate-remove committed:true 路径）。 */
  failNextRemove(reason: unknown): void
}

/**
 * The `wrapIo` fault seam (design §5.3). `wrap(io)` returns a PersistenceIO
 * that both maintains the PersistenceIO contract (no synchronous throw; write
 * resolves ⟺ committed; a pre-commit hold re-checks the signal before letting
 * the real commit run) and exposes the fault slots above.
 */
export interface PersistenceIoFaultSeam {
  readonly faults: PersistenceIoFaults
  wrap(io: PersistenceIO): PersistenceIO
}

const NO_FAULT = Symbol('createPersistenceIoFaultSeam: no fault armed')

interface ArmedHold {
  readonly enteredResolve: () => void
  readonly gate: Promise<void>
  readonly release: () => void
}

function armHold(): ArmedHold & { readonly hold: PersistenceHold } {
  let enteredResolveFn: () => void = () => {}
  const entered = new Promise<void>((resolve) => { enteredResolveFn = resolve })
  let releaseFn: () => void = () => {}
  const gate = new Promise<void>((resolve) => { releaseFn = resolve })
  return {
    enteredResolve: enteredResolveFn,
    gate,
    release: releaseFn,
    hold: { entered, release: releaseFn },
  }
}

export function createPersistenceIoFaultSeam(): PersistenceIoFaultSeam {
  let failRead: unknown = NO_FAULT
  let failWrite: unknown = NO_FAULT
  let failRemove: unknown = NO_FAULT
  let holdRead: ArmedHold | undefined
  let holdReadValue: Uint8Array | undefined = undefined
  let holdWriteBeforeCommit: ArmedHold | undefined
  let holdWriteAfterCommit: ArmedHold | undefined

  const faults: PersistenceIoFaults = {
    failNextRead(reason) { failRead = reason },
    failNextWrite(reason) { failWrite = reason },
    failNextRemove(reason) { failRemove = reason },
    holdNextWriteBeforeCommit() {
      const armed = armHold()
      holdWriteBeforeCommit = armed
      return armed.hold
    },
    holdNextWriteAfterCommit() {
      const armed = armHold()
      holdWriteAfterCommit = armed
      return armed.hold
    },
    holdNextReadThen(value) {
      const armed = armHold()
      holdRead = armed
      holdReadValue = value
      return armed.hold
    },
  }

  const wrap = (io: PersistenceIO): PersistenceIO => ({
    async read(key, signal) {
      const failure = failRead
      if (failure !== NO_FAULT) {
        failRead = NO_FAULT
        throw failure
      }
      const held = holdRead
      if (held !== undefined) {
        holdRead = undefined
        held.enteredResolve()
        await held.gate
        return holdReadValue
      }
      return await io.read(key, signal)
    },
    async write(key, snapshot, signal) {
      const failure = failWrite
      if (failure !== NO_FAULT) {
        failWrite = NO_FAULT
        throw failure
      }
      const before = holdWriteBeforeCommit
      if (before !== undefined) {
        holdWriteBeforeCommit = undefined
        before.enteredResolve()
        await before.gate
        // Contract self-check: once aborted, the commit segment must not run
        // (the wrapped inner io for Memory/File already gates its own entry,
        // but this keeps ANY inner io within the PersistenceIO contract).
        signal.throwIfAborted()
        return await io.write(key, snapshot, signal)
      }
      await io.write(key, snapshot, signal)
      const after = holdWriteAfterCommit
      if (after !== undefined) {
        holdWriteAfterCommit = undefined
        after.enteredResolve()
        await after.gate
      }
    },
    // Phase 5（§4.6，D-6 裁决 (b)）：归档提交写并入既有 write 故障/hold 槽——与
    // write 完全同款（failWrite / holdWriteBeforeCommit / holdWriteAfterCommit +
    // signal.throwIfAborted() 自检后转调内层 io）；不触碰主键存储是内层方法级承诺。
    async writeArchive(key, snapshot, signal) {
      const failure = failWrite
      if (failure !== NO_FAULT) {
        failWrite = NO_FAULT
        throw failure
      }
      const before = holdWriteBeforeCommit
      if (before !== undefined) {
        holdWriteBeforeCommit = undefined
        before.enteredResolve()
        await before.gate
        signal.throwIfAborted()
        return await io.writeArchive!(key, snapshot, signal)
      }
      await io.writeArchive!(key, snapshot, signal)
      const after = holdWriteAfterCommit
      if (after !== undefined) {
        holdWriteAfterCommit = undefined
        after.enteredResolve()
        await after.gate
      }
    },
    // Phase 5（§4.6）：主键移除（R2 增加 remove 故障槽——归档 remove 段
    // committed:true 路径的确定性故障注入面；半途 hold 不设——移除段无提交段语义）。
    async remove(key, signal) {
      const failure = failRemove
      if (failure !== NO_FAULT) {
        failRemove = NO_FAULT
        throw failure
      }
      await io.remove!(key, signal)
    },
  })

  return { faults, wrap }
}

/**
 * Fixture contract for the shared typed error suite (design §5.3 + EC rows):
 * one adapter under test wired through the fault seam, a fresh adapter over the
 * same committed store, direct store writes for corruption fixtures, and the
 * scheduler/dispose faces the EC assertions need.
 */
export interface DocPersistenceErrorContractFixture {
  readonly persistence: DocPersistenceWithCreate
  readonly scheduler: TestScheduler
  readonly faults: PersistenceIoFaults
  /** A brand-new adapter over the same committed store (empty cache). */
  readonly makeFresh: () => DocPersistence
  /** Writes raw snapshot bytes straight into the store (corruption fixtures). */
  writeCommitted(owner: User, docId: string, bytes: Uint8Array): Promise<void>
  readonly dispose: () => Promise<void>
}

export type DocPersistenceErrorContractFactory =
  () => Promise<DocPersistenceErrorContractFixture> | DocPersistenceErrorContractFixture

/**
 * Shared typed load/create error contract (issue #108, design §5.3 EC1–EC8).
 * Every adapter runs this exact group; fault injection goes through the
 * fixture's `wrapIo` seam (EC10 is Memory-specific and lives in the Memory
 * test file — its construction needs the public flat-hook surface).
 */
export async function describePersistenceErrorContract(
  factory: DocPersistenceErrorContractFactory,
): Promise<void> {
  const { describe, expect, it } = await vitest()
  // Typed error faces (issue #108 §5): statically imported from the module
  // top — the classes ship with the production implementation, so this suite
  // branches and asserts on the real exported constructors.

  const SENTINEL = 'TOP-SECRET-CAUSE-TOKEN-7f3a'
  const FAKE_PATH = '/etc/sekrit/root/users/alice'
  const LOAD_MESSAGE = 'loadDoc operational failure: the underlying store read rejected'
  const CREATE_OPERATIONAL_MESSAGE = 'createDoc operational failure: the store rejected before commit'
  const CREATE_FATAL_MESSAGE = 'createDoc fatal: internal create failure'

  /** N3: sensitive cause text must never reach any public error face. */
  function assertNoSensitiveText(err: unknown): void {
    const texts = [
      (err as { message?: string }).message ?? '',
      (err as { name?: string }).name ?? '',
      String((err as { stack?: string }).stack ?? ''),
      JSON.stringify(err),
    ]
    for (const text of texts) {
      expect(text).not.toContain(SENTINEL)
      expect(text).not.toContain(FAKE_PATH)
    }
  }

  describe('DocPersistence typed error contract', () => {
    it('EC1: a store read failure is a shared DocLoadOperationalError carrying the exact cause', async () => {
      const fixture = await factory()
      const owner: User = { userId: 'alice' }
      const docId = 'ec1-doc'
      const ioDown = new Error(`io down: ${SENTINEL} @ ${FAKE_PATH}`)
      const committed = docWithMeta(docId, 'preserved')
      await fixture.writeCommitted(owner, docId, Y.encodeStateAsUpdate(committed))

      fixture.faults.failNextRead(ioDown)
      // Both loads are started in the same tick: the first one registers the
      // reading cell synchronously, so the second coalesces onto the same ticket.
      const first = fixture.persistence.loadDoc(owner, docId)
      const second = fixture.persistence.loadDoc(owner, docId)
      const firstErr = await rejectionOf(first)
      const secondErr = await rejectionOf(second)

      expect(firstErr).toBe(secondErr)
      expect(firstErr).toBeInstanceOf(DocLoadOperationalError)
      expect(firstErr).toMatchObject({ code: 'DOC_LOAD_OPERATIONAL' })
      expect((firstErr as { cause: unknown }).cause).toBe(ioDown)
      expect((firstErr as { message: string }).message).toBe(LOAD_MESSAGE)
      expect((firstErr as { name: string }).name).toBe('DocLoadOperationalError')
      assertNoSensitiveText(firstErr)

      // Healed: the failed ticket cleaned its reading cell, so the retry re-reads.
      const healed = await fixture.persistence.loadDoc(owner, docId)
      expect(healed).not.toBeNull()
      expect(healed!.doc.getMap('ROOT').get('who')).toBe('preserved')
      await healed!.release()
      await fixture.dispose()
    })

    it('EC2: load corruption stays a loud bare error and is never downgraded to operational (AC6)', async () => {
      const fixture = await factory()
      const owner: User = { userId: 'alice' }
      const docId = 'ec2-doc'
      const mislabeled = new Y.Doc()
      mislabeled.getMap('META').set('docId', 'other-doc')
      mislabeled.getMap('ROOT').set('who', 'mislabeled')
      await fixture.writeCommitted(owner, docId, Y.encodeStateAsUpdate(mislabeled))

      const err = await rejectionOf(fixture.persistence.loadDoc(owner, docId))
      expect((err as { message?: string }).message).toMatch(/META\.docId/)
      expect(err).not.toBeInstanceOf(DocLoadOperationalError)
      expect(err).not.toBeInstanceOf(DocCreateOperationalError)
      expect(err).not.toBeInstanceOf(DocCreateFatalError)
      await fixture.dispose()
    })

    it('EC3: a create write failure before commit is DocCreateOperationalError committed:false', async () => {
      const fixture = await factory()
      const owner: User = { userId: 'alice' }
      const docId = 'ec3-doc'
      const doc = docWithMeta(docId, 'never-committed')
      const ioDown = new Error(`io down: ${SENTINEL} @ ${FAKE_PATH}`)
      fixture.faults.failNextWrite(ioDown)

      const err = await rejectionOf(fixture.persistence.createDoc(owner, docId, doc))
      expect(err).toBeInstanceOf(DocCreateOperationalError)
      expect(err).toMatchObject({ code: 'DOC_CREATE_OPERATIONAL', committed: false })
      expect((err as { committed: boolean }).committed).toBe(false)
      expect((err as { cause: unknown }).cause).toBe(ioDown)
      expect((err as { message: string }).message).toBe(CREATE_OPERATIONAL_MESSAGE)
      expect((err as { name: string }).name).toBe('DocCreateOperationalError')
      assertNoSensitiveText(err)
      expect(doc.isDestroyed).toBe(false)
      expect(fixture.scheduler.pending()).toBe(0)

      // Nothing was committed, and no stale claim blocks a retry with the same doc.
      expect(await fixture.makeFresh().loadDoc(owner, docId)).toBeNull()
      const retried = await fixture.persistence.createDoc(owner, docId, doc)
      expect(retried.doc).toBe(doc)
      await retried.release()
      await fixture.dispose()
    })

    it('EC4: a create probe-read failure on a current epoch is DocCreateOperationalError committed:false', async () => {
      const fixture = await factory()
      const owner: User = { userId: 'alice' }
      const docId = 'ec4-doc'
      const doc = docWithMeta(docId, 'never-probed')
      const ioDown = new Error(`probe read down: ${SENTINEL} @ ${FAKE_PATH}`)
      fixture.faults.failNextRead(ioDown)

      const err = await rejectionOf(fixture.persistence.createDoc(owner, docId, doc))
      expect(err).toBeInstanceOf(DocCreateOperationalError)
      expect(err).toMatchObject({ code: 'DOC_CREATE_OPERATIONAL', committed: false })
      expect((err as { committed: boolean }).committed).toBe(false)
      expect((err as { cause: unknown }).cause).toBe(ioDown)
      expect((err as { message: string }).message).toBe(CREATE_OPERATIONAL_MESSAGE)
      expect((err as { name: string }).name).toBe('DocCreateOperationalError')
      assertNoSensitiveText(err)
      expect(doc.isDestroyed).toBe(false)
      expect(await fixture.makeFresh().loadDoc(owner, docId)).toBeNull()
      const retried = await fixture.persistence.createDoc(owner, docId, doc)
      expect(retried.doc).toBe(doc)
      await retried.release()
      await fixture.dispose()
    })

    it('EC5: a dispose after commit is DocCreateFatalError post-commit committed:true and never rolls back', async () => {
      const fixture = await factory()
      const owner: User = { userId: 'alice' }
      const docId = 'ec5-doc'
      const doc = docWithMeta(docId, 'committed-before-fatal')

      const hold = fixture.faults.holdNextWriteAfterCommit()
      const creating = fixture.persistence.createDoc(owner, docId, doc)
      const creatingRejection = rejectionOf(creating)
      // Early attachment with a no-op sink: if a hold-arm timeout aborts this test
      // before the awaited rejection collection, a pre-implementation createDoc
      // resolution must not surface as a process-level unhandled rejection.
      void creatingRejection.catch(() => {})
      await withTimeout(hold.entered, 2_000, 'create write to finish its commit and enter the post-commit hold')

      const disposing = fixture.dispose()
      hold.release()
      await disposing

      const err = await creatingRejection
      expect(err).toBeInstanceOf(DocCreateFatalError)
      expect(err).toMatchObject({ code: 'DOC_CREATE_FATAL' })
      expect((err as { phase: string }).phase).toBe('post-commit')
      expect((err as { committed: boolean }).committed).toBe(true)
      expect((err as { cause: unknown }).cause).toBeInstanceOf(Error)
      expect((err as { message: string }).message).toBe(CREATE_FATAL_MESSAGE)
      expect((err as { name: string }).name).toBe('DocCreateFatalError')
      // N5: the fatal never claims, promises, or performs rollback.
      expect((err as { message: string }).message).not.toMatch(/rollback|compensat|undo/i)
      assertNoSensitiveText(err)
      expect(doc.isDestroyed).toBe(false)
      expect(fixture.scheduler.pending()).toBe(0)

      // The committed snapshot really is in the store: a fresh adapter reads it back.
      const fresh = fixture.makeFresh()
      const loaded = await fresh.loadDoc(owner, docId)
      expect(loaded).not.toBeNull()
      expect(loaded!.doc.getMap('ROOT').get('who')).toBe('committed-before-fatal')
      await loaded!.release()
      // The caller must not retry create: the retry observes DOC_DUPLICATE.
      await expect(fresh.createDoc(owner, docId, docWithMeta(docId, 'again'))).rejects.toMatchObject({ code: 'DOC_DUPLICATE' })
      await fixture.dispose()
    })

    it('EC6: a probe read aborted by dispose is DocCreateFatalError probe-read committed:false', async () => {
      const fixture = await factory()
      const owner: User = { userId: 'alice' }
      const docId = 'ec6-doc'
      const doc = docWithMeta(docId, 'never-probed')

      const hold = fixture.faults.holdNextReadThen(undefined)
      const creating = fixture.persistence.createDoc(owner, docId, doc)
      const creatingRejection = rejectionOf(creating)
      // Early attachment with a no-op sink: if a hold-arm timeout aborts this test
      // before the awaited rejection collection, a pre-implementation createDoc
      // resolution must not surface as a process-level unhandled rejection.
      void creatingRejection.catch(() => {})
      await withTimeout(hold.entered, 2_000, 'create probe read to enter the hold')

      const disposing = fixture.dispose()
      hold.release()
      await disposing

      const err = await creatingRejection
      expect(err).toBeInstanceOf(DocCreateFatalError)
      expect(err).toMatchObject({ code: 'DOC_CREATE_FATAL' })
      expect((err as { phase: string }).phase).toBe('probe-read')
      expect((err as { committed: boolean }).committed).toBe(false)
      expect((err as { cause: unknown }).cause).toBeInstanceOf(Error)
      expect((err as { message: string }).message).toBe(CREATE_FATAL_MESSAGE)
      expect((err as { name: string }).name).toBe('DocCreateFatalError')
      expect(doc.isDestroyed).toBe(false)
      expect(fixture.scheduler.pending()).toBe(0)

      // The write path never ran: the store is untouched.
      expect(await fixture.makeFresh().loadDoc(owner, docId)).toBeNull()
      // L0/C0 unchanged: the disposed adapter still rejects with the bare lifetime text.
      await expect(fixture.persistence.loadDoc(owner, docId)).rejects.toThrow(/disposed/)
      await expect(fixture.persistence.createDoc(owner, docId, docWithMeta(docId, 'y'))).rejects.toThrow(/disposed/)
      await fixture.dispose()
    })

    it('EC7: a store write aborted by dispose is DocCreateFatalError store-write committed:false', async () => {
      const fixture = await factory()
      const owner: User = { userId: 'alice' }
      const docId = 'ec7-doc'
      const doc = docWithMeta(docId, 'never-written')

      const hold = fixture.faults.holdNextWriteBeforeCommit()
      const creating = fixture.persistence.createDoc(owner, docId, doc)
      const creatingRejection = rejectionOf(creating)
      // Early attachment with a no-op sink: if a hold-arm timeout aborts this test
      // before the awaited rejection collection, a pre-implementation createDoc
      // resolution must not surface as a process-level unhandled rejection.
      void creatingRejection.catch(() => {})
      await withTimeout(hold.entered, 2_000, 'create write to enter the pre-commit hold')

      const disposing = fixture.dispose()
      hold.release()
      await disposing

      const err = await creatingRejection
      expect(err).toBeInstanceOf(DocCreateFatalError)
      expect(err).toMatchObject({ code: 'DOC_CREATE_FATAL' })
      expect((err as { phase: string }).phase).toBe('store-write')
      expect((err as { committed: boolean }).committed).toBe(false)
      expect((err as { cause: unknown }).cause).toBeInstanceOf(Error)
      expect((err as { message: string }).message).toBe(CREATE_FATAL_MESSAGE)
      expect((err as { name: string }).name).toBe('DocCreateFatalError')
      expect(doc.isDestroyed).toBe(false)
      expect(fixture.scheduler.pending()).toBe(0)

      // The commit segment never ran: the store is untouched.
      expect(await fixture.makeFresh().loadDoc(owner, docId)).toBeNull()
      await fixture.dispose()
    })

    it('EC8: DocDuplicateError stays an independent type with its own code, never mixed with the new types', async () => {
      const fixture = await factory()
      const owner: User = { userId: 'alice' }
      const docId = 'ec8-doc'
      const first = await fixture.persistence.createDoc(owner, docId, docWithMeta(docId, 'original'))

      // Cache path and store path both stay DocDuplicateError.
      const dup = await rejectionOf(fixture.persistence.createDoc(owner, docId, docWithMeta(docId, 'challenger')))
      expect(dup).toBeInstanceOf(DocDuplicateError)
      expect(dup).toMatchObject({ code: 'DOC_DUPLICATE' })
      expect(dup).not.toBeInstanceOf(DocLoadOperationalError)
      expect(dup).not.toBeInstanceOf(DocCreateOperationalError)
      expect(dup).not.toBeInstanceOf(DocCreateFatalError)

      const fresh = fixture.makeFresh()
      const freshDup = await rejectionOf(fresh.createDoc(owner, docId, docWithMeta(docId, 'again')))
      expect(freshDup).toBeInstanceOf(DocDuplicateError)
      expect(freshDup).not.toBeInstanceOf(DocLoadOperationalError)
      expect(freshDup).not.toBeInstanceOf(DocCreateOperationalError)
      expect(freshDup).not.toBeInstanceOf(DocCreateFatalError)

      // The three new types are mutually exclusive with duplicate too, and
      // all four codes are distinct.
      const loadErr = new DocLoadOperationalError(new Error('x'))
      const createErr = new DocCreateOperationalError(new Error('x'))
      const fatalErr = new DocCreateFatalError('store-write', new Error('x'))
      expect(loadErr).not.toBeInstanceOf(DocDuplicateError)
      expect(createErr).not.toBeInstanceOf(DocDuplicateError)
      expect(fatalErr).not.toBeInstanceOf(DocDuplicateError)
      const codes = new Set([
        (dup as { code: string }).code,
        (loadErr as unknown as { code: string }).code,
        (createErr as unknown as { code: string }).code,
        (fatalErr as unknown as { code: string }).code,
      ])
      expect(codes.size).toBe(4)

      await first.release()
      await fixture.dispose()
    })
  })
}

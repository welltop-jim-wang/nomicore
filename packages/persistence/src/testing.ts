import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { DocHandle, DocPersistence, PersistenceTimer, User } from './index.js'

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
export function describeDocPersistenceContract(
  factory: DocPersistenceContractFactory,
): void {
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

/** A deterministic timer facade: `advanceBy` fires due callbacks in order. */
export interface TestTimer extends PersistenceTimer {
  advanceBy(milliseconds: number): Promise<void>
  pending(): number
}

/** Fake-clock timer used by the shared suite (no real sleeps). */
export function createTestTimer(): TestTimer {
  let now = 0
  let nextId = 0
  const timers = new Map<number, { at: number, callback: () => void }>()
  return {
    now: () => now,
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
  readonly timer: TestTimer
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

async function tick(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
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
  expect(reason).toMatchObject({ code: 'DOC_DUPLICATE' })
  const mod = await import('./index.js') as { DocDuplicateError?: new (message?: string) => Error }
  if (mod.DocDuplicateError !== undefined) {
    expect(reason).toBeInstanceOf(mod.DocDuplicateError)
  }
}

/**
 * Shared createDoc acceptance suite (issue-64). Runs against every adapter
 * fixture; see the suite header for the anchored semantics.
 */
export function describeDocCreateContract(
  factory: DocCreateContractFactory,
): void {
  describe('DocPersistence createDoc contract', () => {
    it('creates an owner lease, commits the initial snapshot before resolving, and shares the live doc with loads', async () => {
      const fixture = await factory()
      const { persistence, timer } = fixture
      const owner: User = { userId: 'alice' }
      const docId = 'create-happy-doc'
      const doc = docWithMeta(docId, 'hello')

      const handle = await persistence.createDoc(owner, docId, doc)
      expect(handle.doc).toBe(doc)
      expect(handle.owner).toBe(owner)
      expect(handle.docId).toBe(docId)
      // Owner migration: the lease no longer carries a `user` field.
      expect((handle as { user?: unknown }).user).toBeUndefined()
      expect(timer.pending()).toBe(0)

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
      const { persistence, timer, store } = fixture
      const owner: User = { userId: 'alice' }
      const docId = 'create-save-doc'
      const handle = await persistence.createDoc(owner, docId, docWithMeta(docId, 'v1'))

      let writes = 0
      store.write = async () => { writes += 1 }
      handle.doc.getMap('ROOT').set('rev', 2)
      await persistence.saveDoc(handle)
      expect(writes).toBe(0)

      await timer.advanceBy(499)
      expect(writes).toBe(0)
      await timer.advanceBy(1)
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
      store.write = async () => {
        enteredWrites += 1
        await gate
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

    it('does not return null for a load that is still pending when create wins the key', async () => {
      const fixture = await factory()
      const { persistence, store } = fixture
      const owner: User = { userId: 'alice' }
      const docId = 'create-load-doc'
      const doc = docWithMeta(docId, 'from-create')

      let readStarted: (() => void) | undefined
      let releaseRead: ((value: Uint8Array | undefined) => void) | undefined
      const readStartedPromise = new Promise<void>((resolve) => { readStarted = resolve })
      store.read = (_key, _signal) => {
        readStarted!()
        return new Promise<Uint8Array | undefined>((resolve) => { releaseRead = resolve })
      }

      const loading = persistence.loadDoc(owner, docId)
      await withTimeout(readStartedPromise, 2_000, 'load to start its restore read')

      store.write = async () => {}
      const created = await persistence.createDoc(owner, docId, doc)
      releaseRead!(undefined)

      const loaded = await withTimeout(loading, 2_000, 'load pending while create won the key')
      expect(loaded).not.toBeNull()
      expect(loaded!.doc).toBe(created.doc)
      expect(loaded!.owner).toBe(owner)

      await created.release()
      await loaded!.release()
      await fixture.dispose()
    })

    it('does not cache, commit, or destroy the caller doc when the initial write fails', async () => {
      const fixture = await factory()
      const { persistence, store, timer } = fixture
      const owner: User = { userId: 'alice' }
      const docId = 'create-fail-doc'
      const doc = docWithMeta(docId, 'never-committed')

      const originalWrite = store.write
      store.write = async () => { throw new Error('io down') }
      const err = await rejectionOf(persistence.createDoc(owner, docId, doc))
      expect((err as { message?: string }).message).toContain('io down')
      expect(doc.isDestroyed).toBe(false)
      expect(timer.pending()).toBe(0)

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
      const { persistence, store, timer } = fixture
      const owner: User = { userId: 'alice' }
      const docId = 'create-dispose-doc'
      const doc = docWithMeta(docId, 'x')

      let releaseWrite: (() => void) | undefined
      store.write = (_key, _snapshot, signal) => new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve())
        releaseWrite = resolve
      })

      const creating = persistence.createDoc(owner, docId, doc)
      await tick()
      await withTimeout(fixture.dispose(), 2_000, 'dispose with an in-flight create')
      releaseWrite?.()

      // The in-flight create settles with a real rejection — never with the
      // timeout guard (that would mean the promise leaked and never settled),
      // and never by resolving (that would be a hidden lease past dispose).
      const settlement = await withTimeout(creating, 2_000, 'in-flight create to settle during dispose').then(
        () => 'resolved',
        (reason: unknown) => reason,
      )
      expect(settlement).not.toBeInstanceOf(TestTimeoutError)
      expect(settlement).toBeInstanceOf(Error)
      expect(timer.pending()).toBe(0)

      // The adapter is closed: no hidden lease can be minted afterwards.
      await expect(persistence.loadDoc(owner, docId)).rejects.toThrow(/disposed/)
      await expect(persistence.createDoc(owner, docId, docWithMeta(docId, 'y'))).rejects.toThrow(/disposed/)
    })
  })
}

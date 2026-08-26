/**
 * SA6 red acceptance tests — issue #79 (feature):
 * DocHandle entry-level status + saveDoc dirty registration while degraded.
 *
 * Anchored acceptance criteria (task_issue-79.md):
 *   AC1  DocHandle exposes a synchronous, entry-level `getStatus()` at least
 *        distinguishing `ready` | `persistence-degraded` | `released` |
 *        `disposed`.
 *   AC2  Status answers for the handle's own `(owner, docId)` entry, never the
 *        adapter aggregate status.
 *   AC3  After an entry flush failure the related handle reports
 *        `persistence-degraded`; unrelated namespace handles stay `ready`.
 *   AC4  The entry's own retry success restores the related handle to `ready`.
 *   AC5  `saveDoc(handle)` must NOT reject because the entry is degraded: it
 *        registers dirty (increments dirty generation) and the existing retry
 *        covers the latest complete live Y.Doc.
 *   AC6  foreign / released / identity-mismatched / disposed-persistence errors
 *        keep rejecting loudly (non-degraded guard rails).
 *   AC7  Deterministic race: g1 flush in flight -> observe `ready` before the
 *        mutation -> mutation 2 enters the live Y.Doc -> g1 flush fails ->
 *        mutation 2's saveDoc registers while degraded -> retry succeeds ->
 *        a fresh Persistence instance load sees mutation 2.
 *
 * Red state today: `DocHandle` has no `getStatus()` (calling it throws
 * TypeError) and `saveDoc` rejects while the entry is degraded
 * ("persistence-degraded: writes are rejected until retry succeeds").
 *
 * The future API is exercised through a local cast so the suite compiles and
 * runs against the current seam; the assertions are pure runtime behavior.
 */
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { DocHandle, User } from '../src/contract.js'
import { createMemoryPersistence } from '../src/index.js'
import { createDocStore, createTestScheduler, withTimeout } from '../src/testing.js'
import { createMemoryHandleForTest } from './memory-testkit.js'

type HandleStatus = 'ready' | 'persistence-degraded' | 'released' | 'disposed'

/** The future DocHandle face (AC1). Cast keeps the suite runnable pre-implementation. */
interface HandleWithStatus extends DocHandle {
  getStatus(): HandleStatus
}

function statusOf(handle: DocHandle): HandleStatus {
  return (handle as unknown as HandleWithStatus).getStatus()
}

/** Drain enough microtask turns for internal flush/retry chains to settle. */
async function settle(turns = 12): Promise<void> {
  for (let i = 0; i < turns; i += 1) await Promise.resolve()
}

describe('issue-79: DocHandle entry-level status (MemoryPersistence)', () => {
  it('AC1: getStatus() is synchronous and distinguishes ready / persistence-degraded / released / disposed', async () => {
    const timer = createTestScheduler()
    const persistence = createMemoryPersistence({
      scheduler: timer,
      async writeSnapshot() { throw new Error('io down') },
    })
    const owner: User = { userId: 'alice' }

    const handle = await createMemoryHandleForTest(persistence, owner, 'status-doc')
    handle.doc.getMap('META').set('docId', 'status-doc')
    expect(statusOf(handle)).toBe('ready')

    await persistence.saveDoc(handle)
    await timer.advanceBy(500)
    await settle()
    expect(statusOf(handle)).toBe('persistence-degraded')

    // A second lease of the same degraded entry reports the same entry status.
    const twin = await createMemoryHandleForTest(persistence, owner, 'status-doc')
    expect(statusOf(twin)).toBe('persistence-degraded')
    await twin.release()

    await handle.release()
    expect(statusOf(handle)).toBe('released')

    const keeper = await createMemoryHandleForTest(persistence, owner, 'keeper-doc')
    keeper.doc.getMap('META').set('docId', 'keeper-doc')
    await persistence.dispose()
    expect(statusOf(keeper)).toBe('disposed')
  })

  it('AC2+AC3: status is entry-scoped — a degraded (owner, docId) leaves unrelated entries ready on the same adapter', async () => {
    const timer = createTestScheduler()
    const persistence = createMemoryPersistence({
      scheduler: timer,
      async writeSnapshot(key) {
        if (key === 'alice\u0000doomed') throw new Error('disk unavailable')
      },
    })
    const alice: User = { userId: 'alice' }

    const doomed = await createMemoryHandleForTest(persistence, alice, 'doomed')
    doomed.doc.getMap('META').set('docId', 'doomed')
    await persistence.saveDoc(doomed)
    const fine = await createMemoryHandleForTest(persistence, alice, 'fine')
    fine.doc.getMap('META').set('docId', 'fine')
    await persistence.saveDoc(fine)

    await timer.advanceBy(500)
    await settle()

    // The adapter aggregate is degraded (context for the contrast below), yet
    // the unrelated handle must answer for its own entry — `ready`.
    expect(persistence.getStatus()).toBe('persistence-degraded')
    expect(statusOf(doomed)).toBe('persistence-degraded')
    expect(statusOf(fine)).toBe('ready')

    await doomed.release()
    await fine.release()
    await persistence.dispose()
  })

  it('AC4: only the degraded entry own retry restores it to ready; an unrelated successful flush does not', async () => {
    const timer = createTestScheduler()
    let doomedFailures = 1
    const persistence = createMemoryPersistence({
      scheduler: timer,
      async writeSnapshot(key) {
        if (key === 'alice\u0000doomed' && doomedFailures > 0) {
          doomedFailures -= 1
          throw new Error('io down')
        }
      },
    })
    const alice: User = { userId: 'alice' }

    const doomed = await createMemoryHandleForTest(persistence, alice, 'doomed')
    doomed.doc.getMap('META').set('docId', 'doomed')
    await persistence.saveDoc(doomed)
    const fine = await createMemoryHandleForTest(persistence, alice, 'fine')
    fine.doc.getMap('META').set('docId', 'fine')
    await persistence.saveDoc(fine)

    // Same window: doomed's flush fails while fine's own flush succeeds.
    await timer.advanceBy(500)
    await settle()
    expect(statusOf(doomed)).toBe('persistence-degraded')
    // fine's successful flush in the same window must NOT have restored doomed.
    expect(statusOf(fine)).toBe('ready')
    expect(statusOf(doomed)).toBe('persistence-degraded')

    // doomed's own retry (t=1000) commits and restores only its entry.
    await timer.advanceBy(500)
    await settle()
    expect(statusOf(doomed)).toBe('ready')
    expect(statusOf(fine)).toBe('ready')

    await doomed.release()
    await fine.release()
    await persistence.dispose()
  })

  it('AC5: saveDoc while degraded registers dirty and the retry persists the latest live doc, visible to a fresh adapter', async () => {
    const timer = createTestScheduler()
    const store = createDocStore()
    let ioFailures = 1
    let storeWrites = 0
    const persistence = createMemoryPersistence({
      scheduler: timer,
      readSnapshot: (key, signal) => store.read(key, signal),
      writeSnapshot: async (key, snapshot, signal) => {
        if (ioFailures > 0) {
          ioFailures -= 1
          throw new Error('io down')
        }
        storeWrites += 1
        await store.write(key, snapshot, signal)
      },
    })
    const alice: User = { userId: 'alice' }

    const handle = await createMemoryHandleForTest(persistence, alice, 'rev-doc')
    handle.doc.getMap('META').set('docId', 'rev-doc')
    handle.doc.getMap('ROOT').set('rev', 1)
    await persistence.saveDoc(handle)

    // g1 flush fails -> entry degrades (adapter aggregate reflects it; the
    // handle-level status is asserted separately in the AC1/AC3 tests).
    await timer.advanceBy(500)
    await settle()
    expect(persistence.getStatus()).toBe('persistence-degraded')

    // Mutation while degraded: saveDoc must NOT reject, it registers dirty.
    handle.doc.getMap('ROOT').set('rev', 2)
    await expect(persistence.saveDoc(handle)).resolves.toBeUndefined()

    // Retry (t=1000) flushes the complete live doc, including rev=2.
    await timer.advanceBy(500)
    await settle()
    expect(storeWrites).toBe(1)
    expect(persistence.getStatus()).toBe('ready')

    // A fresh adapter over the same store sees mutation 2.
    const fresh = createMemoryPersistence({
      scheduler: createTestScheduler(),
      readSnapshot: (key, signal) => store.read(key, signal),
      writeSnapshot: (key, snapshot, signal) => store.write(key, snapshot, signal),
    })
    const loaded = await fresh.loadDoc(alice, 'rev-doc')
    expect(loaded).not.toBeNull()
    expect(loaded!.doc.getMap('ROOT').get('rev')).toBe(2)
    await loaded!.release()
    await fresh.dispose()

    await handle.release()
    await persistence.dispose()
  })

  it('AC7: deterministic race — g1 flush in flight → ready → mutation 2 → g1 fails → degraded saveDoc registers → retry → fresh load sees mutation 2', async () => {
    const timer = createTestScheduler()
    const store = createDocStore()
    const originalWrite = store.write
    let writes = 0
    let releaseFirstWrite: ((reason: unknown) => void) | undefined
    let firstWriteStartedResolve: (() => void) | undefined
    const firstWriteStarted = new Promise<void>((resolve) => { firstWriteStartedResolve = resolve })

    store.write = async (key, snapshot, signal) => {
      writes += 1
      if (writes === 1) {
        // generation-1 flush write parks here until the test settles it.
        firstWriteStartedResolve!()
        await new Promise<void>((resolve, reject) => {
          releaseFirstWrite = (reason: unknown) => {
            if (reason === undefined) resolve()
            else reject(reason as Error)
          }
        })
      }
      await originalWrite(key, snapshot, signal)
    }

    const persistence = createMemoryPersistence({
      scheduler: timer,
      readSnapshot: (key, signal) => store.read(key, signal),
      writeSnapshot: (key, snapshot, signal) => store.write(key, snapshot, signal),
    })
    const alice: User = { userId: 'alice' }
    const handle = await createMemoryHandleForTest(persistence, alice, 'race-doc')
    handle.doc.getMap('META').set('docId', 'race-doc')
    handle.doc.getMap('ROOT').set('generation', 1)

    expect(statusOf(handle)).toBe('ready')
    await persistence.saveDoc(handle) // generation 1 dirty

    // generation-1 flush starts (debounce deadline reached) and parks in write.
    await timer.advanceBy(500)
    await withTimeout(firstWriteStarted, 2_000, 'generation-1 flush write to start')
    expect(writes).toBe(1)

    // 写前观察 ready: getStatus() reflects only the instant of the call — the
    // in-flight flush has not failed yet, so the handle still reads ready.
    expect(statusOf(handle)).toBe('ready')

    // mutation 2 enters the live Y.Doc while g1 flush is in flight.
    handle.doc.getMap('ROOT').set('generation', 2)

    // generation-1 flush fails -> the entry degrades.
    releaseFirstWrite!(new Error('disk unavailable'))
    await settle()
    expect(statusOf(handle)).toBe('persistence-degraded')

    // mutation 2's saveDoc while degraded must register dirty, not reject.
    await expect(persistence.saveDoc(handle)).resolves.toBeUndefined()

    // retry succeeds: full live doc (generation 2) is committed.
    await timer.advanceBy(500)
    await settle()
    expect(writes).toBe(2)
    expect(statusOf(handle)).toBe('ready')

    // A new Persistence instance over the same store load-sees mutation 2.
    const fresh = createMemoryPersistence({
      scheduler: createTestScheduler(),
      readSnapshot: (key, signal) => store.read(key, signal),
      writeSnapshot: (key, snapshot, signal) => store.write(key, snapshot, signal),
    })
    const loaded = await fresh.loadDoc(alice, 'race-doc')
    expect(loaded).not.toBeNull()
    expect(loaded!.doc.getMap('ROOT').get('generation')).toBe(2)
    await loaded!.release()
    await fresh.dispose()

    await handle.release()
    await persistence.dispose()
  })

  it('AC6: foreign / released / identity-mismatched / disposed errors stay loud, and status still reports released/disposed', async () => {
    const timer = createTestScheduler()
    const first = createMemoryPersistence({ scheduler: timer })
    const second = createMemoryPersistence({ scheduler: timer })
    const alice: User = { userId: 'alice' }

    const handle = await createMemoryHandleForTest(first, alice, 'doc1')
    handle.doc.getMap('META').set('docId', 'doc1')

    // foreign handle: another adapter must reject it loudly.
    await expect(second.saveDoc(handle)).rejects.toThrow(/foreign or released DocHandle/)

    // entry-identity mismatch: a forged plain handle object must reject loudly.
    const forged = { owner: alice, docId: 'doc1', doc: handle.doc } as unknown as DocHandle
    await expect(first.saveDoc(forged)).rejects.toThrow(/foreign or released DocHandle/)

    // released handle: the lease is spent, saveDoc must keep rejecting.
    await handle.release()
    expect(statusOf(handle)).toBe('released')
    await expect(first.saveDoc(handle)).rejects.toThrow(/foreign or released DocHandle/)

    // disposed persistence: every operation keeps rejecting loudly.
    const keeper = await createMemoryHandleForTest(first, alice, 'keeper')
    keeper.doc.getMap('META').set('docId', 'keeper')
    await first.dispose()
    expect(statusOf(keeper)).toBe('disposed')
    await expect(first.saveDoc(handle)).rejects.toThrow(/disposed/)
    await expect(first.loadDoc(alice, 'doc1')).rejects.toThrow(/disposed/)

    await second.dispose()
  })
})

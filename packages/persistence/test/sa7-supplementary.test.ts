// SA7 supplementary dynamic tests (issue-64, Phase 3).
//
// Anchors the dynamic-review checklist handed over by SA4 R2 and design R4
// §5.3.1, beyond what the shared SA6 suite already pins:
//
//   - store isolation across adapter instances (SA4 R1 regression, promoted
//     from implementation constraint IO-1/IO-2 to a contract, per the SA4 R2
//     suggestion) and IO-3 dispose-clears-the-mirror semantics
//   - SA2 R1 red-line attacks 1-4 / design §4.4 cases 5a-5d: fake null,
//     silent old-content resurrection, ghost handle, hung-read early adoption
//   - R2-1 liveness nail: a superseded load really settles when the
//     superseding create fails its write (U8), leaving no stale claim
//   - observeLateReadOutcome console.error (lost-update) and console.warn
//     (superseded READ_ERR) really fire on their triggering paths
//
// Interleavings here are ordered deterministically on the microtask queue:
// a load parked on a superseded read always adopts the live entry (its
// continuation is queued inside the create's commit block, before the test
// can act), so the eviction race is exercised through the claim-join path
// (a load that arrives while the cell is `creating` resumes only after the
// claim settles, which is after the create promise settles — the test can
// release the create handle in that window).
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { createMemoryPersistence, type PersistenceTimer, type User } from '../src/index.js'
import { createDocStore, createTestTimer, withTimeout, type DocStoreHooks } from '../src/testing.js'

function docWithMeta(docId: string, who?: string): Y.Doc {
  const doc = new Y.Doc()
  doc.getMap('META').set('docId', docId)
  if (who !== undefined) doc.getMap('ROOT').set('who', who)
  return doc
}

/** Wires an adapter whose I/O delegates to the *current* methods of `store`. */
function adapterOver(store: DocStoreHooks, timer?: PersistenceTimer) {
  return createMemoryPersistence({
    ...(timer !== undefined ? { timer } : {}),
    readSnapshot: (key, signal) => store.read(key, signal),
    writeSnapshot: (key, snapshot, signal) => store.write(key, snapshot, signal),
  })
}

/** Drains the microtask queue so gated continuations (drivers) have run. */
async function drain(times = 20): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve()
}

/**
 * Replaces `store.read` with a controllable gate: the next read after arming
 * hangs until the test releases it; reads before arming and after the gate is
 * consumed delegate to the real store.
 */
function armReadGate(store: DocStoreHooks): {
  arm: () => void
  release: (value: Uint8Array | undefined) => void
  reject: (reason: unknown) => void
  started: () => Promise<void>
} {
  const originalRead = store.read
  let armed = false
  let startedResolve: (() => void) | undefined
  const startedPromise = new Promise<void>((resolve) => { startedResolve = resolve })
  let releaseGate: ((value: Uint8Array | undefined) => void) | undefined
  let rejectGate: ((reason: unknown) => void) | undefined
  store.read = (key, signal) => {
    if (armed) {
      armed = false
      startedResolve!()
      return new Promise<Uint8Array | undefined>((resolve, reject) => {
        releaseGate = resolve
        rejectGate = reject
      })
    }
    return originalRead(key, signal)
  }
  return {
    arm: () => { armed = true },
    release: (value) => { releaseGate!(value) },
    reject: (reason) => { rejectGate!(reason) },
    started: () => startedPromise,
  }
}

describe('SA7 dynamic verification: store isolation (SA4 R1 / IO-1..IO-3)', () => {
  it('keeps two hooked instances over different stores mutually invisible, even after dispose', async () => {
    const alice: User = { userId: 'alice' }
    const storeA = createDocStore()
    const storeB = createDocStore() // brand-new and empty

    const a = adapterOver(storeA)
    const handle = await a.createDoc(alice, 'doc1', docWithMeta('doc1', 'A-content'))

    // Live-instance isolation: B over a different store sees nothing of A.
    const bLive = adapterOver(storeB)
    expect(await bLive.loadDoc(alice, 'doc1')).toBeNull()
    await bLive.dispose()

    await handle.release()
    await a.dispose()

    // SA4 R1 attack: a fresh adapter over the still-empty storeB must neither
    // read A's content nor be denied creation by a fake duplicate.
    const b = adapterOver(storeB)
    expect(await b.loadDoc(alice, 'doc1')).toBeNull()
    const created = await b.createDoc(alice, 'doc1', docWithMeta('doc1', 'B-content'))
    expect(created.doc.getMap('ROOT').get('who')).toBe('B-content')
    const reloaded = await b.loadDoc(alice, 'doc1')
    expect(reloaded!.doc.getMap('ROOT').get('who')).toBe('B-content')
    await reloaded!.release()
    await created.release()
    await b.dispose()
  })

  it('clears the instance mirror on dispose so a later no-hook instance cannot resurrect it', async () => {
    const timer = createTestTimer()
    const alice: User = { userId: 'alice' }
    const a = createMemoryPersistence({ timer }) // no hooks: instance-private mirror

    const handle = await a.createDoc(alice, 'doc1', docWithMeta('doc1', 'mirror-me'))
    // The creating instance still sees its own doc (live cell).
    const cached = await a.loadDoc(alice, 'doc1')
    expect(cached).not.toBeNull()
    await cached!.release()

    // A second live no-hook instance shares no mirror with A.
    const b = createMemoryPersistence({ timer })
    expect(await b.loadDoc(alice, 'doc1')).toBeNull()
    await b.dispose()

    await handle.release()
    await a.dispose()

    // After dispose the mirror is cleared: nothing resurrects in-process.
    const c = createMemoryPersistence({ timer })
    expect(await c.loadDoc(alice, 'doc1')).toBeNull()
    const recreated = await c.createDoc(alice, 'doc1', docWithMeta('doc1', 'fresh'))
    expect(recreated.doc.getMap('ROOT').get('who')).toBe('fresh')
    await recreated.release()
    await c.dispose()
    expect(timer.pending()).toBe(0)
  })
})

describe('SA7 dynamic verification: supersede/claim races (design §4.4 5a-5d)', () => {
  it('5a: a load superseded by a winning create resolves with the committed content, never null', async () => {
    const timer = createTestTimer()
    const alice: User = { userId: 'alice' }
    const store = createDocStore()
    const persistence = adapterOver(store)
    const gate = armReadGate(store)

    gate.arm()
    const loading = persistence.loadDoc(alice, 'doc1')
    await withTimeout(gate.started(), 2_000, 'load read to start')

    const created = await persistence.createDoc(alice, 'doc1', docWithMeta('doc1', 'committed-new'))
    await created.release()
    gate.release(undefined) // late "not found" evidence after create won

    const loaded = await withTimeout(loading, 2_000, 'superseded load after create won')
    expect(loaded).not.toBeNull()
    expect(loaded!.doc.isDestroyed).toBe(false)
    expect(loaded!.doc.getMap('ROOT').get('who')).toBe('committed-new')
    await loaded!.release()
    await persistence.dispose()
    expect(timer.pending()).toBe(0)
  })

  it('5b: never resurrects the old committed content and reports the lost update via console.error', async () => {
    const timer = createTestTimer()
    const alice: User = { userId: 'alice' }
    const store = createDocStore()
    const persistence = adapterOver(store, timer)

    // Commit OLD first, then drop it from the cache (release evicts).
    const oldHandle = await persistence.createDoc(alice, 'doc1', docWithMeta('doc1', 'OLD'))
    const oldBytes = Y.encodeStateAsUpdate(oldHandle.doc)
    await oldHandle.release()

    const gate = armReadGate(store)
    gate.arm()
    const loading = persistence.loadDoc(alice, 'doc1') // gated read observes OLD
    await withTimeout(gate.started(), 2_000, 'load read to start')

    const created = await persistence.createDoc(alice, 'doc1', docWithMeta('doc1', 'NEW'))
    await created.release()

    const errors: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(String(args[0]))
    })
    try {
      gate.release(oldBytes) // late OLD evidence arrives after create won
      const loaded = await withTimeout(loading, 2_000, 'superseded load after late old snapshot')
      await drain()
      expect(loaded).not.toBeNull()
      expect(loaded!.doc.getMap('ROOT').get('who')).toBe('NEW')
      await loaded!.release()
    } finally {
      spy.mockRestore()
    }
    expect(errors).toContain('[persistence] lost-update anomaly: createDoc superseded a pending load whose store read returned a pre-existing snapshot')
    await persistence.dispose()
    expect(timer.pending()).toBe(0)
  })

  it('5a/5c eviction race: a load parked on the create claim re-reads the committed content and gets a live, usable doc', async () => {
    const timer = createTestTimer()
    const alice: User = { userId: 'alice' }
    const store = createDocStore()
    const persistence = adapterOver(store, timer)

    // Counting write with a one-shot gate on the first call: the create hangs
    // inside its write until the test lets it commit, so a load can park on
    // the create claim meanwhile; later writes (the flush below) pass through.
    let writes = 0
    let firstWrite = true
    const originalWrite = store.write
    let enteredCreateWrite: (() => void) | undefined
    const createWriteEntered = new Promise<void>((resolve) => { enteredCreateWrite = resolve })
    let releaseCreateWrite: (() => void) | undefined
    store.write = async (key, snapshot, signal) => {
      writes += 1
      if (firstWrite) {
        firstWrite = false
        enteredCreateWrite!()
        await new Promise<void>((resolve) => { releaseCreateWrite = resolve })
      }
      await originalWrite(key, snapshot, signal)
    }

    const creating = persistence.createDoc(alice, 'doc1', docWithMeta('doc1', 'committed-new'))
    await withTimeout(createWriteEntered, 2_000, 'create to enter its gated write')

    // This load parks on the create claim (cell is `creating`, not reading).
    const loading = persistence.loadDoc(alice, 'doc1')

    releaseCreateWrite!()
    const created = await creating
    // Synchronous release before the claim-waiter continuation runs: the only
    // handle goes away, so the clean entry evicts (its doc is destroyed).
    created.release()

    const loaded = await withTimeout(loading, 2_000, 'claim-joined load after eviction')
    expect(loaded).not.toBeNull()
    // A fresh document restored from the committed snapshot — not the evicted
    // (destroyed) instance, and never null.
    expect(loaded!.doc).not.toBe(created.doc)
    expect(loaded!.doc.isDestroyed).toBe(false)
    expect(loaded!.doc.getMap('ROOT').get('who')).toBe('committed-new')

    // The handle is fully usable: dirty registration + debounce flush work.
    const writesAfterCreate = writes
    loaded!.doc.getMap('ROOT').set('post-load', true)
    await expect(persistence.saveDoc(loaded!)).resolves.toBeUndefined()
    await timer.advanceBy(499)
    expect(writes).toBe(writesAfterCreate)
    await timer.advanceBy(1)
    expect(writes).toBe(writesAfterCreate + 1)
    await loaded!.release()
    await persistence.dispose()
    expect(timer.pending()).toBe(0)
  })

  it('5d: a hung store read never blocks the superseded load (early adoption)', async () => {
    const timer = createTestTimer()
    const alice: User = { userId: 'alice' }
    const store = createDocStore()
    const persistence = adapterOver(store, timer)
    const gate = armReadGate(store)

    gate.arm()
    const loading = persistence.loadDoc(alice, 'doc1')
    await withTimeout(gate.started(), 2_000, 'load read to start')

    // The create handle stays held; the read gate is NEVER released here.
    const created = await persistence.createDoc(alice, 'doc1', docWithMeta('doc1', 'early'))
    const loaded = await withTimeout(loading, 2_000, 'superseded load must not wait for the hung read')
    expect(loaded).not.toBeNull()
    expect(loaded!.doc).toBe(created.doc)
    expect(loaded!.doc.isDestroyed).toBe(false)

    // Settle the hung read afterwards so dispose has nothing in flight.
    gate.release(undefined)
    await drain()
    await loaded!.release()
    await created.release()
    await persistence.dispose()
  })
})

describe('SA7 dynamic verification: liveness and observation (R2-1 / late-read outcomes)', () => {
  it('R2-1: a superseded load really settles when the superseding create fails its write, and leaves no stale claim', async () => {
    const timer = createTestTimer()
    const alice: User = { userId: 'alice' }
    const store = createDocStore()
    const persistence = adapterOver(store)
    const gate = armReadGate(store)

    const originalWrite = store.write
    gate.arm()
    const loading = persistence.loadDoc(alice, 'doc1')
    await withTimeout(gate.started(), 2_000, 'load read to start')

    store.write = async () => { throw new Error('create write exploded') }
    await expect(persistence.createDoc(alice, 'doc1', docWithMeta('doc1', 'never'))).rejects.toThrow(/create write exploded/)

    gate.release(undefined)
    const loaded = await withTimeout(loading, 2_000, 'superseded load must settle after create failure')
    expect(loaded).toBeNull()

    // No stale claim: the key is creatable again through the real write path.
    store.write = originalWrite
    const retried = await persistence.createDoc(alice, 'doc1', docWithMeta('doc1', 'second-try'))
    expect(retried.doc.getMap('ROOT').get('who')).toBe('second-try')
    await retried.release()
    await persistence.dispose()
    expect(timer.pending()).toBe(0)
  })

  it('warns when a superseded read fails after the create won the key, without disturbing the load', async () => {
    const timer = createTestTimer()
    const alice: User = { userId: 'alice' }
    const store = createDocStore()
    const persistence = adapterOver(store, timer)
    const gate = armReadGate(store)

    gate.arm()
    const loading = persistence.loadDoc(alice, 'doc1')
    await withTimeout(gate.started(), 2_000, 'load read to start')

    const created = await persistence.createDoc(alice, 'doc1', docWithMeta('doc1', 'winner'))
    const warnings: string[] = []
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(String(args[0]))
    })
    try {
      gate.reject(new Error('read blew up after supersede'))
      const loaded = await withTimeout(loading, 2_000, 'superseded load after read failure')
      expect(loaded!.doc).toBe(created.doc)
      await loaded!.release()
      await drain()
    } finally {
      spy.mockRestore()
    }
    expect(warnings).toContain('[persistence] superseded store read failed after createDoc won the key; ignoring stale read error')
    await created.release()
    await persistence.dispose()
  })
})

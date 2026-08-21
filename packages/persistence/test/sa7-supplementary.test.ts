// SA7 supplementary dynamic tests (issue-64, Phase 3).
//
// Anchors persistence behavior beyond the shared contract suite:
//
//   - store isolation across adapter instances (IO-1/IO-2) and IO-3
//     dispose-clears-the-mirror semantics;
//   - a pending load's store evidence prevents createDoc from overwriting an
//     existing document.
import { describe, expect, it } from 'vitest'
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

describe('SA7 dynamic verification: create/load evidence ordering', () => {
  it('waits for a pending load and rejects create when the read finds committed content', async () => {
    const timer = createTestTimer()
    const alice: User = { userId: 'alice' }
    const store = createDocStore()
    const persistence = adapterOver(store, timer)
    const gate = armReadGate(store)
    const persisted = docWithMeta('doc1', 'OLD')

    gate.arm()
    const loading = persistence.loadDoc(alice, 'doc1')
    await withTimeout(gate.started(), 2_000, 'load read to start')

    const creating = persistence.createDoc(alice, 'doc1', docWithMeta('doc1', 'must-not-overwrite'))
    gate.release(Y.encodeStateAsUpdate(persisted))

    const loaded = await withTimeout(loading, 2_000, 'pending load to settle')
    expect(loaded).not.toBeNull()
    expect(loaded!.doc.getMap('ROOT').get('who')).toBe('OLD')
    await expect(creating).rejects.toMatchObject({ code: 'DOC_DUPLICATE' })

    await loaded!.release()
    await persistence.dispose()
    expect(timer.pending()).toBe(0)
  })
})

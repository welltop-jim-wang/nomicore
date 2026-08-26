import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createManualClock, createManualClockPlugin } from '@nomicore/clock/testing'
import {
  DocCreateFatalError,
  MemoryPersistence,
  createMemoryPersistence,
  type PersistenceScheduler,
  type User,
} from '../src/index.js'
import {
  createDocStore,
  createFakeTimerPlugin,
  createPersistenceIoFaultSeam,
  describeDocCreateContract,
  describeDocPersistenceContract,
  describePersistenceErrorContract,
  withTimeout,
} from '../src/testing.js'
import { createMemoryHandleForTest } from './memory-testkit.js'

interface FakeTimer extends PersistenceScheduler {
  advanceBy(milliseconds: number): Promise<void>
  pending(): number
  cleared(): readonly number[]
}

function createFakeTimer(): FakeTimer {
  let now = 0
  let nextId = 0
  const cleared: number[] = []
  const timers = new Map<number, { at: number, callback: () => void }>()
  return {
    setTimeout(callback, delayMs) {
      const id = nextId++
      timers.set(id, { at: now + delayMs, callback })
      return id
    },
    clearTimeout(timer) {
      const id = timer as number
      cleared.push(id)
      timers.delete(id)
    },
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
        await Promise.resolve()
        await Promise.resolve()
      }
      now = deadline
      await Promise.resolve()
      await Promise.resolve()
    },
    pending: () => timers.size,
    cleared: () => cleared,
  }
}

function docWithMeta(docId: string): Y.Doc {
  const doc = new Y.Doc()
  doc.getMap('META').set('docId', docId)
  return doc
}

async function createAndSave(persistence: MemoryPersistence, user: User, docId: string): Promise<Y.Doc> {
  const handle = await createMemoryHandleForTest(persistence, user, docId)
  handle.doc.getMap('META').set('docId', docId)
  await persistence.saveDoc(handle)
  await handle.release()
  return handle.doc
}

await describeDocPersistenceContract(async () => {
  const timer = createFakeTimer()
  const persistence = createMemoryPersistence({ scheduler: timer })
  return {
    persistence,
    async createHandle(owner, docId) {
      return persistence.createDoc(owner, docId, docWithMeta(docId))
    },
  }
})

await describeDocCreateContract(async () => {
  const timer = createFakeTimer()
  const store = createDocStore()
  const persistence = createMemoryPersistence({
    scheduler: timer,
    readSnapshot: (key, signal) => store.read(key, signal),
    writeSnapshot: (key, snapshot, signal) => store.write(key, snapshot, signal),
  })
  return {
    persistence,
    scheduler: timer,
    store,
    makeFresh: () => createMemoryPersistence({
      scheduler: createFakeTimer(),
      readSnapshot: (key, signal) => store.read(key, signal),
      writeSnapshot: (key, snapshot, signal) => store.write(key, snapshot, signal),
    }),
    dispose: () => persistence.dispose(),
  }
})

// ---------------------------------------------------------------------------
// Typed error contract (issue #108 §5.3): shared EC1–EC8 suite, Memory fixture
// = delegation model (flat read/write hooks delegating to one shared store) +
// the `wrapIo` fault seam. EC10 (the delegation-model committed:true
// self-consistency anchor) is Memory-specific and lives below.
// ---------------------------------------------------------------------------

await describePersistenceErrorContract(async () => {
  const timer = createFakeTimer()
  const store = createDocStore()
  const seam = createPersistenceIoFaultSeam()
  const persistence = createMemoryPersistence({
    scheduler: timer,
    readSnapshot: (key, signal) => store.read(key, signal),
    writeSnapshot: (key, snapshot, signal) => store.write(key, snapshot, signal),
    wrapIo: seam.wrap,
  })
  return {
    persistence,
    scheduler: timer,
    faults: seam.faults,
    makeFresh: () => createMemoryPersistence({
      scheduler: createFakeTimer(),
      readSnapshot: (key, signal) => store.read(key, signal),
      writeSnapshot: (key, snapshot, signal) => store.write(key, snapshot, signal),
    }),
    writeCommitted: async (owner, docId, bytes) => {
      await store.write(`${owner.userId}\u0000${docId}`, bytes, new AbortController().signal)
    },
    dispose: () => persistence.dispose(),
  }
})

describe('MemoryPersistence', () => {
  it('coalesces concurrent restores and gives independent handles the same live document', async () => {
    const timer = createFakeTimer()
    const user = { userId: 'alice' }
    const persisted = docWithMeta('doc1')
    persisted.getMap('ROOT').set('value', 'saved')
    const update = Y.encodeStateAsUpdate(persisted)
    let reads = 0
    const persistence = createMemoryPersistence({
      scheduler: timer,
      async readSnapshot() {
        reads += 1
        await Promise.resolve()
        return update
      },
    })

    const [first, second] = await Promise.all([persistence.loadDoc(user, 'doc1'), persistence.loadDoc(user, 'doc1')])
    expect(reads).toBe(1)
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first).not.toBe(second)
    expect(first!.doc).toBe(second!.doc)
  })

  it('rejects a foreign handle from another MemoryPersistence instance', async () => {
    const timer = createFakeTimer()
    const user = { userId: 'alice' }
    const first = createMemoryPersistence({ scheduler: timer })
    const second = createMemoryPersistence({ scheduler: timer })
    const handle = await createMemoryHandleForTest(first, user, 'doc1')
    handle.doc.getMap('META').set('docId', 'doc1')

    await expect(second.saveDoc(handle)).rejects.toThrow(/foreign or released DocHandle/)
    await expect(first.saveDoc(handle)).resolves.toBeUndefined()
  })

  it('rejects a released handle even when its original adapter is still live', async () => {
    const timer = createFakeTimer()
    const persistence = createMemoryPersistence({ scheduler: timer })
    const handle = await createMemoryHandleForTest(persistence, { userId: 'alice' }, 'doc1')
    handle.doc.getMap('META').set('docId', 'doc1')

    await handle.release()
    await expect(persistence.saveDoc(handle)).rejects.toThrow(/foreign or released DocHandle/)
  })

  it('marks dirty asynchronously with debounce and max-dirty deadlines', async () => {
    const timer = createFakeTimer()
    let writes = 0
    const persistence = createMemoryPersistence({
      scheduler: timer,
      async writeSnapshot() { writes += 1 },
    })
    const handle = await createMemoryHandleForTest(persistence, { userId: 'alice' }, 'doc1')
    handle.doc.getMap('META').set('docId', 'doc1')

    await persistence.saveDoc(handle)
    await timer.advanceBy(499)
    expect(writes).toBe(0)
    await timer.advanceBy(1)
    expect(writes).toBe(1)

    for (let index = 0; index < 10; index += 1) {
      handle.doc.getMap('ROOT').set(`v${index}`, index)
      await persistence.saveDoc(handle)
      await timer.advanceBy(400)
    }
    expect(writes).toBe(1)
    await timer.advanceBy(1_000)
    expect(writes).toBe(2)
  })

  it('cancels the paired timer when debounce fires, so its old max-dirty callback cannot flush again', async () => {
    const timer = createFakeTimer()
    let writes = 0
    const persistence = createMemoryPersistence({ scheduler: timer, async writeSnapshot() { writes += 1 } })
    const handle = await createMemoryHandleForTest(persistence, { userId: 'alice' }, 'doc1')
    handle.doc.getMap('META').set('docId', 'doc1')

    await persistence.saveDoc(handle)
    await timer.advanceBy(500)
    expect(writes).toBe(1)
    expect(timer.cleared()).toHaveLength(1)
    await timer.advanceBy(4_500)
    expect(writes).toBe(1)
  })

  it('cancels the paired timer when max-dirty fires, so its old debounce callback cannot flush again', async () => {
    const timer = createFakeTimer()
    let writes = 0
    const persistence = createMemoryPersistence({
      scheduler: timer,
      schedule: { debounceMs: 10_000, maxDirtyMs: 5_000 },
      async writeSnapshot() { writes += 1 },
    })
    const handle = await createMemoryHandleForTest(persistence, { userId: 'alice' }, 'doc1')
    handle.doc.getMap('META').set('docId', 'doc1')

    await persistence.saveDoc(handle)
    await timer.advanceBy(5_000)
    expect(writes).toBe(1)
    expect(timer.cleared()).toHaveLength(1)
    await timer.advanceBy(5_000)
    expect(writes).toBe(1)
  })

  it('keeps a dirty generation written during an in-flight flush', async () => {
    const timer = createFakeTimer()
    let finishFirst: (() => void) | undefined
    let writes = 0
    const persistence = createMemoryPersistence({
      scheduler: timer,
      writeSnapshot: async () => {
        writes += 1
        if (writes === 1) await new Promise<void>((resolve) => { finishFirst = resolve })
      },
    })
    const handle = await createMemoryHandleForTest(persistence, { userId: 'alice' }, 'doc1')
    handle.doc.getMap('META').set('docId', 'doc1')
    await persistence.saveDoc(handle)
    await timer.advanceBy(500)
    expect(writes).toBe(1)

    handle.doc.getMap('ROOT').set('later', true)
    await persistence.saveDoc(handle)
    finishFirst!()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await timer.advanceBy(500)
    await Promise.resolve()
    await Promise.resolve()
    expect(writes).toBe(2)
  })

  it('does not let a generation-one timer flush or confirm generation two while its flush is in flight', async () => {
    const timer = createFakeTimer()
    let finishFirst: (() => void) | undefined
    const snapshots: Uint8Array[] = []
    const persistence = createMemoryPersistence({
      scheduler: timer,
      writeSnapshot: async (_key, snapshot) => {
        snapshots.push(snapshot)
        if (snapshots.length === 1) await new Promise<void>((resolve) => { finishFirst = resolve })
      },
    })
    const handle = await createMemoryHandleForTest(persistence, { userId: 'alice' }, 'doc1')
    handle.doc.getMap('META').set('docId', 'doc1')
    handle.doc.getMap('ROOT').set('generation', 1)
    await persistence.saveDoc(handle)
    await timer.advanceBy(500)
    expect(snapshots).toHaveLength(1)

    handle.doc.getMap('ROOT').set('generation', 2)
    await persistence.saveDoc(handle)
    // Both original timers have already been consumed/cancelled by the first
    // debounce; advancing past the old max-dirty deadline must not start g2.
    await timer.advanceBy(10_000)
    expect(snapshots).toHaveLength(1)

    finishFirst!()
    for (let index = 0; index < 10; index += 1) await Promise.resolve()
    await timer.advanceBy(499)
    expect(snapshots).toHaveLength(1)
    await timer.advanceBy(1)
    expect(snapshots).toHaveLength(2)

    const restored = new Y.Doc()
    Y.applyUpdate(restored, snapshots[1]!)
    expect(restored.getMap('ROOT').get('generation')).toBe(2)
  })

  it('degrades to read-only, preserves the live document, then restores writes after retry', async () => {
    const timer = createFakeTimer()
    let failures = 1
    const persistence = createMemoryPersistence({
      scheduler: timer,
      async writeSnapshot() {
        if (failures > 0) {
          failures -= 1
          throw new Error('disk unavailable')
        }
      },
    })
    const user = { userId: 'alice' }
    const handle = await createMemoryHandleForTest(persistence, user, 'doc1')
    handle.doc.getMap('META').set('docId', 'doc1')
    handle.doc.getMap('ROOT').set('readable', 'yes')
    await persistence.saveDoc(handle)
    await timer.advanceBy(500)
    expect(persistence.getStatus()).toBe('persistence-degraded')
    expect(handle.doc.getMap('ROOT').get('readable')).toBe('yes')

    const second = await persistence.loadDoc(user, 'doc1')
    expect(second).not.toBeNull()
    expect(second!.doc).toBe(handle.doc)
    expect(second!.doc.getMap('ROOT').get('readable')).toBe('yes')
    // (issue #79 AC5) degraded is not a saveDoc rejection reason: the entry
    // stays degraded, saveDoc registers dirty, and retry covers the full doc.
    expect(handle.getStatus()).toBe('persistence-degraded')
    await expect(persistence.saveDoc(handle)).resolves.toBeUndefined()
    // R3 (owner #3): degraded radius is entry-scoped (ADR-0006 namespace
    // semantics) — a fresh entry has no degraded history, so creating and
    // writing 'other' is allowed while doc1 stays degraded.
    const other = await createMemoryHandleForTest(persistence, user, 'other')
    await expect(persistence.saveDoc(other)).resolves.toBeUndefined()
    await other.release()

    await timer.advanceBy(500)
    expect(persistence.getStatus()).toBe('ready')
    await expect(persistence.saveDoc(second!)).resolves.toBeUndefined()
  })

  it('restores a persisted snapshot while degraded, registers dirty writes, then restores writes after retry', async () => {
    const timer = createFakeTimer()
    const user = { userId: 'alice' }
    const snapshotDoc = docWithMeta('doc1')
    snapshotDoc.getMap('ROOT').set('fromSnapshot', 'readable')
    const snapshot = Y.encodeStateAsUpdate(snapshotDoc)
    let failures = 1
    const persistence = createMemoryPersistence({
      scheduler: timer,
      readSnapshot: async () => snapshot,
      async writeSnapshot() {
        if (failures > 0) {
          failures -= 1
          throw new Error('write unavailable')
        }
      },
    })

    const loaded = await persistence.loadDoc(user, 'doc1')
    expect(loaded).not.toBeNull()
    expect(loaded!.doc.getMap('ROOT').get('fromSnapshot')).toBe('readable')
    await persistence.saveDoc(loaded!)
    await timer.advanceBy(500)
    expect(persistence.getStatus()).toBe('persistence-degraded')

    // Force a cache miss while retaining the test-supplied durable snapshot.
    await loaded!.release()
    const restored = await persistence.loadDoc(user, 'doc1')
    expect(restored).not.toBeNull()
    expect(restored!.doc.getMap('ROOT').get('fromSnapshot')).toBe('readable')
    // (issue #79 AC5) same reversal as above: degraded entry keeps accepting
    // dirty registration until its own retry succeeds.
    expect(restored!.getStatus()).toBe('persistence-degraded')
    await expect(persistence.saveDoc(restored!)).resolves.toBeUndefined()

    await timer.advanceBy(500)
    expect(persistence.getStatus()).toBe('ready')
    await expect(persistence.saveDoc(restored!)).resolves.toBeUndefined()
  })

  it('evicts only after the final release and successful flush, restoring equivalent content into a new document', async () => {
    const timer = createFakeTimer()
    const persistence = createMemoryPersistence({ scheduler: timer })
    const user = { userId: 'alice' }
    const seed = await createMemoryHandleForTest(persistence, user, 'doc1')
    const oldDoc = seed.doc
    oldDoc.getMap('META').set('docId', 'doc1')
    oldDoc.getMap('ROOT').set('value', 'persist me')
    await persistence.saveDoc(seed)
    await seed.release()
    await timer.advanceBy(500)

    const restored = await persistence.loadDoc(user, 'doc1')
    expect(restored).not.toBeNull()
    expect(restored!.doc).not.toBe(oldDoc)
    expect(restored!.doc.getMap('ROOT').get('value')).toBe('persist me')
  })

  it('isolates users and rejects a snapshot with mismatched META.docId', async () => {
    const timer = createFakeTimer()
    const persistence = createMemoryPersistence({ scheduler: timer })
    const alice = { userId: 'alice' }
    const bob = { userId: 'bob' }
    await createAndSave(persistence, alice, 'doc1')
    await timer.advanceBy(500)

    expect(await persistence.loadDoc(bob, 'doc1')).toBeNull()

    const bad = docWithMeta('other-doc')
    const badUpdate = Y.encodeStateAsUpdate(bad)
    const corrupt = createMemoryPersistence({ scheduler: timer, async readSnapshot() { return badUpdate } })
    await expect(corrupt.loadDoc(alice, 'doc1')).rejects.toThrow(/META\.docId.*doc1/)
  })

  it('waits for an aborted restore rejection without reviving cache or leaking a rejection', async () => {
    const timer = createFakeTimer()
    let rejectRead: ((reason: Error) => void) | undefined
    let observedAbort = false
    const persistence = createMemoryPersistence({
      scheduler: timer,
      readSnapshot: (_key, signal) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => { observedAbort = true })
        rejectRead = reject
      }),
    })

    const loading = persistence.loadDoc({ userId: 'alice' }, 'doc1')
    const closing = persistence.dispose()
    expect(observedAbort).toBe(true)
    rejectRead!(new Error('restore aborted'))
    await closing
    await expect(loading).rejects.toThrow(/restore aborted|disposed/)
    await expect(persistence.loadDoc({ userId: 'alice' }, 'doc1')).rejects.toThrow(/disposed/)
    expect(timer.pending()).toBe(0)
  })

  it('does not revive cache state when dispose happens during restore', async () => {
    const timer = createFakeTimer()
    let resolveRead: ((snapshot: Uint8Array | undefined) => void) | undefined
    const persisted = docWithMeta('doc1')
    const persistence = createMemoryPersistence({
      scheduler: timer,
      readSnapshot: () => new Promise((resolve) => { resolveRead = resolve }),
    })

    const loading = persistence.loadDoc({ userId: 'alice' }, 'doc1')
    persistence.dispose()
    resolveRead!(Y.encodeStateAsUpdate(persisted))
    await expect(loading).rejects.toThrow(/disposed/)
    expect(timer.pending()).toBe(0)
    await expect(persistence.loadDoc({ userId: 'alice' }, 'doc1')).rejects.toThrow(/disposed/)
  })

  it('waits for an aborted flush rejection without reviving state or timers', async () => {
    const timer = createFakeTimer()
    let rejectWrite: ((reason: Error) => void) | undefined
    let observedAbort = false
    const persistence = createMemoryPersistence({
      scheduler: timer,
      writeSnapshot: (_key, _snapshot, signal) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => { observedAbort = true })
        rejectWrite = reject
      }),
    })
    const handle = await createMemoryHandleForTest(persistence, { userId: 'alice' }, 'doc1')
    handle.doc.getMap('META').set('docId', 'doc1')
    await persistence.saveDoc(handle)
    await timer.advanceBy(500)

    const closing = persistence.dispose()
    expect(observedAbort).toBe(true)
    rejectWrite!(new Error('flush aborted'))
    await closing
    expect(timer.pending()).toBe(0)
    expect(persistence.getStatus()).toBe('disposed')
  })

  it('waits for a never-settling writer to settle through AbortSignal before dispose resolves', async () => {
    const timer = createFakeTimer()
    let abortWriter: (() => void) | undefined
    const persistence = createMemoryPersistence({
      scheduler: timer,
      writeSnapshot: (_key, _snapshot, signal) => new Promise<void>((resolve) => {
        // This simulates I/O that would otherwise never settle. The documented
        // adapter contract is to settle promptly when its signal is aborted.
        signal.addEventListener('abort', () => {
          abortWriter = resolve
        })
      }),
    })
    const handle = await createMemoryHandleForTest(persistence, { userId: 'alice' }, 'doc1')
    handle.doc.getMap('META').set('docId', 'doc1')
    await persistence.saveDoc(handle)
    await timer.advanceBy(500)

    let disposed = false
    const closing = persistence.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)
    abortWriter!()
    await closing
    expect(disposed).toBe(true)
    expect(persistence.getStatus()).toBe('disposed')
    expect(timer.pending()).toBe(0)
  })

  it('does not revive state or timers when dispose happens during flush', async () => {
    const timer = createFakeTimer()
    let resolveWrite: (() => void) | undefined
    const persistence = createMemoryPersistence({
      scheduler: timer,
      writeSnapshot: () => new Promise<void>((resolve) => { resolveWrite = resolve }),
    })
    const handle = await createMemoryHandleForTest(persistence, { userId: 'alice' }, 'doc1')
    handle.doc.getMap('META').set('docId', 'doc1')
    await persistence.saveDoc(handle)
    await timer.advanceBy(500)

    persistence.dispose()
    resolveWrite!()
    await Promise.resolve()
    await Promise.resolve()
    expect(timer.pending()).toBe(0)
    expect(persistence.getStatus()).toBe('disposed')
    await expect(persistence.saveDoc(handle)).rejects.toThrow(/disposed/)
  })

  it('unloads one Cordis service exactly once across repeated fiber disposal', async () => {
    const timer = createFakeTimer()
    const persistence = createMemoryPersistence({ scheduler: timer })
    const ctx = new Context()
    createManualClockPlugin(createManualClock()).apply(ctx)
    createFakeTimerPlugin(timer).apply(ctx)
    let serviceEvents = 0
    ctx.on('internal/service', (name, value) => {
      if (name === 'nomicorePersistence' && value === undefined) serviceEvents += 1
    })

    persistence.apply(ctx)
    expect(ctx.get('nomicorePersistence')).toBe(persistence)

    const firstUnload = ctx.fiber.dispose()
    const repeatedUnload = ctx.fiber.dispose()
    await Promise.all([firstUnload, repeatedUnload])

    expect(serviceEvents).toBe(1)
    expect(ctx.get('nomicorePersistence')).toBeUndefined()
    expect(persistence.getStatus()).toBe('disposed')
    await persistence.dispose()
    expect(serviceEvents).toBe(1)
  })

  it('disposes caches and pending timers', async () => {
    const timer = createFakeTimer()
    const persistence = createMemoryPersistence({ scheduler: timer })
    const handle = await createMemoryHandleForTest(persistence, { userId: 'alice' }, 'doc1')
    handle.doc.getMap('META').set('docId', 'doc1')
    await persistence.saveDoc(handle)
    expect(timer.pending()).toBeGreaterThan(0)

    persistence.dispose()
    expect(timer.pending()).toBe(0)
    expect(persistence.getStatus()).toBe('disposed')
    await expect(persistence.loadDoc({ userId: 'alice' }, 'doc1')).rejects.toThrow(/disposed/)
  })
})

// ---------------------------------------------------------------------------
// EC10 (issue #108 §5.3, R1/A-1): delegation-model abort-during-hook ⇒
// committed:true self-consistency anchor. Memory-specific: it drives the
// public flat hooks directly (no wrapIo) — the hook enters the io.write entry
// gate first, is held, dispose fires mid-hook, and the hook then completes its
// own store write (same shape as a File rename in flight). The create must
// report committed:true AND the read path (the shared store) must agree.
// ---------------------------------------------------------------------------

describe('MemoryPersistence delegation-model committed:true anchor (issue #108 EC10)', () => {
  it('reports committed:true when an abort-during-hook write still commits, and the read path agrees', async () => {
    const timer = createFakeTimer()
    const store = createDocStore()
    let enteredResolve: () => void = () => {}
    const entered = new Promise<void>((resolve) => { enteredResolve = resolve })
    let releaseWrite: () => void = () => {}
    const gate = new Promise<void>((resolve) => { releaseWrite = resolve })
    const persistence = createMemoryPersistence({
      scheduler: timer,
      readSnapshot: (key, signal) => store.read(key, signal),
      writeSnapshot: async (key, snapshot, signal) => {
        enteredResolve()
        await gate
        await store.write(key, snapshot, signal)
      },
    })
    const owner: User = { userId: 'alice' }
    const docId = 'ec10-doc'
    const doc = docWithMeta(docId)
    doc.getMap('ROOT').set('who', 'committed-despite-dispose')

    const creating = persistence.createDoc(owner, docId, doc)
    const creatingRejection = creating.then(
      () => { throw new Error('expected createDoc to reject') },
      (reason: unknown) => reason,
    )
    await withTimeout(entered, 2_000, 'create write to enter its hook')
    const disposing = persistence.dispose()
    releaseWrite()
    await disposing

    const err = await creatingRejection
    expect(err).toBeInstanceOf(DocCreateFatalError)
    expect((err as { phase: string }).phase).toBe('post-commit')
    expect((err as { committed: boolean }).committed).toBe(true)
    expect(doc.isDestroyed).toBe(false)
    expect(timer.pending()).toBe(0)

    // The read authority (the shared store) really holds the snapshot: the
    // committed:true fact and the observable read path agree.
    const fresh = createMemoryPersistence({
      scheduler: createFakeTimer(),
      readSnapshot: (key, signal) => store.read(key, signal),
      writeSnapshot: (key, snapshot, signal) => store.write(key, snapshot, signal),
    })
    const loaded = await fresh.loadDoc(owner, docId)
    expect(loaded).not.toBeNull()
    expect(loaded!.doc.getMap('ROOT').get('who')).toBe('committed-despite-dispose')
    await loaded!.release()

    // The disposed adapter keeps its bare lifetime channels.
    await expect(persistence.loadDoc(owner, docId)).rejects.toThrow(/disposed/)
    await expect(persistence.createDoc(owner, docId, docWithMeta(docId))).rejects.toThrow(/disposed/)
  })
})

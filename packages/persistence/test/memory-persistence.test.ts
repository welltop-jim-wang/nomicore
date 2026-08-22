import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  MemoryPersistence,
  createMemoryPersistence,
  type PersistenceTimer,
  type User,
} from '../src/index.js'
import {
  createDocStore,
  describeDocCreateContract,
  describeDocPersistenceContract,
} from '../src/testing.js'
import { createMemoryHandleForTest } from './memory-testkit.js'

interface FakeTimer extends PersistenceTimer {
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
    now: () => now,
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

describeDocPersistenceContract(async () => {
  const timer = createFakeTimer()
  const persistence = createMemoryPersistence({ timer })
  return {
    persistence,
    async createHandle(owner, docId) {
      return persistence.createDoc(owner, docId, docWithMeta(docId))
    },
  }
})

describeDocCreateContract(async () => {
  const timer = createFakeTimer()
  const store = createDocStore()
  const persistence = createMemoryPersistence({
    timer,
    readSnapshot: (key, signal) => store.read(key, signal),
    writeSnapshot: (key, snapshot, signal) => store.write(key, snapshot, signal),
  })
  return {
    persistence,
    timer,
    store,
    makeFresh: () => createMemoryPersistence({
      timer: createFakeTimer(),
      readSnapshot: (key, signal) => store.read(key, signal),
      writeSnapshot: (key, snapshot, signal) => store.write(key, snapshot, signal),
    }),
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
      timer,
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
    const first = createMemoryPersistence({ timer })
    const second = createMemoryPersistence({ timer })
    const handle = await createMemoryHandleForTest(first, user, 'doc1')
    handle.doc.getMap('META').set('docId', 'doc1')

    await expect(second.saveDoc(handle)).rejects.toThrow(/foreign or released DocHandle/)
    await expect(first.saveDoc(handle)).resolves.toBeUndefined()
  })

  it('rejects a released handle even when its original adapter is still live', async () => {
    const timer = createFakeTimer()
    const persistence = createMemoryPersistence({ timer })
    const handle = await createMemoryHandleForTest(persistence, { userId: 'alice' }, 'doc1')
    handle.doc.getMap('META').set('docId', 'doc1')

    await handle.release()
    await expect(persistence.saveDoc(handle)).rejects.toThrow(/foreign or released DocHandle/)
  })

  it('marks dirty asynchronously with debounce and max-dirty deadlines', async () => {
    const timer = createFakeTimer()
    let writes = 0
    const persistence = createMemoryPersistence({
      timer,
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
    const persistence = createMemoryPersistence({ timer, async writeSnapshot() { writes += 1 } })
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
      timer,
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
      timer,
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
      timer,
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
      timer,
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
    await expect(persistence.saveDoc(handle)).rejects.toThrow(/persistence-degraded/)
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

  it('restores a persisted snapshot while degraded, keeps writes rejected, then restores writes after retry', async () => {
    const timer = createFakeTimer()
    const user = { userId: 'alice' }
    const snapshotDoc = docWithMeta('doc1')
    snapshotDoc.getMap('ROOT').set('fromSnapshot', 'readable')
    const snapshot = Y.encodeStateAsUpdate(snapshotDoc)
    let failures = 1
    const persistence = createMemoryPersistence({
      timer,
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
    await expect(persistence.saveDoc(restored!)).rejects.toThrow(/persistence-degraded/)

    await timer.advanceBy(500)
    expect(persistence.getStatus()).toBe('ready')
    await expect(persistence.saveDoc(restored!)).resolves.toBeUndefined()
  })

  it('evicts only after the final release and successful flush, restoring equivalent content into a new document', async () => {
    const timer = createFakeTimer()
    const persistence = createMemoryPersistence({ timer })
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
    const persistence = createMemoryPersistence({ timer })
    const alice = { userId: 'alice' }
    const bob = { userId: 'bob' }
    await createAndSave(persistence, alice, 'doc1')
    await timer.advanceBy(500)

    expect(await persistence.loadDoc(bob, 'doc1')).toBeNull()

    const bad = docWithMeta('other-doc')
    const badUpdate = Y.encodeStateAsUpdate(bad)
    const corrupt = createMemoryPersistence({ timer, async readSnapshot() { return badUpdate } })
    await expect(corrupt.loadDoc(alice, 'doc1')).rejects.toThrow(/META\.docId.*doc1/)
  })

  it('waits for an aborted restore rejection without reviving cache or leaking a rejection', async () => {
    const timer = createFakeTimer()
    let rejectRead: ((reason: Error) => void) | undefined
    let observedAbort = false
    const persistence = createMemoryPersistence({
      timer,
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
      timer,
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
      timer,
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
      timer,
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
      timer,
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
    const persistence = createMemoryPersistence({ timer })
    const ctx = new Context()
    let serviceEvents = 0
    ctx.on('internal/service', (name, value) => {
      if (name === 'docPersistence' && value === undefined) serviceEvents += 1
    })

    persistence.apply(ctx)
    expect(ctx.get('docPersistence')).toBe(persistence)

    const firstUnload = ctx.fiber.dispose()
    const repeatedUnload = ctx.fiber.dispose()
    await Promise.all([firstUnload, repeatedUnload])

    expect(serviceEvents).toBe(1)
    expect(ctx.get('docPersistence')).toBeUndefined()
    expect(persistence.getStatus()).toBe('disposed')
    await persistence.dispose()
    expect(serviceEvents).toBe(1)
  })

  it('disposes caches and pending timers', async () => {
    const timer = createFakeTimer()
    const persistence = createMemoryPersistence({ timer })
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

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  MemoryPersistence,
  createMemoryPersistence,
  describeDocPersistenceContract,
  type PersistenceTimer,
  type User,
} from '../src/index.js'

interface FakeTimer extends PersistenceTimer {
  advanceBy(milliseconds: number): Promise<void>
  pending(): number
}

function createFakeTimer(): FakeTimer {
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
  }
}

function docWithMeta(docId: string): Y.Doc {
  const doc = new Y.Doc()
  doc.getMap('META').set('docId', docId)
  return doc
}

async function createAndSave(persistence: MemoryPersistence, user: User, docId: string): Promise<Y.Doc> {
  const handle = await persistence.createHandle(user, docId)
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
    async createHandle(user, docId) {
      const handle = await persistence.createHandle(user, docId)
      handle.doc.getMap('META').set('docId', docId)
      return handle
    },
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

  it('marks dirty asynchronously with debounce and max-dirty deadlines', async () => {
    const timer = createFakeTimer()
    let writes = 0
    const persistence = createMemoryPersistence({
      timer,
      async writeSnapshot() { writes += 1 },
    })
    const handle = await persistence.createHandle({ userId: 'alice' }, 'doc1')
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
    const handle = await persistence.createHandle({ userId: 'alice' }, 'doc1')
    handle.doc.getMap('META').set('docId', 'doc1')
    await persistence.saveDoc(handle)
    await timer.advanceBy(500)
    expect(writes).toBe(1)

    handle.doc.getMap('ROOT').set('later', true)
    await persistence.saveDoc(handle)
    finishFirst!()
    await new Promise((resolve) => setImmediate(resolve))
    await timer.advanceBy(500)
    await new Promise((resolve) => setImmediate(resolve))
    expect(writes).toBe(2)
  })

  it('degrades on write failure, rejects writes, then restores readiness after retry', async () => {
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
    const handle = await persistence.createHandle({ userId: 'alice' }, 'doc1')
    handle.doc.getMap('META').set('docId', 'doc1')
    await persistence.saveDoc(handle)
    await timer.advanceBy(500)
    expect(persistence.getStatus()).toBe('persistence-degraded')
    await expect(persistence.saveDoc(handle)).rejects.toThrow(/persistence-degraded/)

    await timer.advanceBy(500)
    expect(persistence.getStatus()).toBe('ready')
    await expect(persistence.saveDoc(handle)).resolves.toBeUndefined()
  })

  it('evicts only after the final release and successful flush, restoring equivalent content into a new document', async () => {
    const timer = createFakeTimer()
    const persistence = createMemoryPersistence({ timer })
    const user = { userId: 'alice' }
    const seed = await persistence.createHandle(user, 'doc1')
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

  it('disposes caches and pending timers', async () => {
    const timer = createFakeTimer()
    const persistence = createMemoryPersistence({ timer })
    const handle = await persistence.createHandle({ userId: 'alice' }, 'doc1')
    handle.doc.getMap('META').set('docId', 'doc1')
    await persistence.saveDoc(handle)
    expect(timer.pending()).toBeGreaterThan(0)

    persistence.dispose()
    expect(timer.pending()).toBe(0)
    expect(persistence.getStatus()).toBe('disposed')
    await expect(persistence.loadDoc({ userId: 'alice' }, 'doc1')).rejects.toThrow(/disposed/)
  })
})

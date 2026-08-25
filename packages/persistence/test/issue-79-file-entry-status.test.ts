/**
 * SA6 red acceptance tests — issue #79 (feature) over the FilePersistence
 * adapter: DocHandle entry-level status + saveDoc dirty registration while
 * degraded (AC1/AC3/AC4/AC5 of task_issue-79.md).
 *
 * Red state today: `DocHandle` has no `getStatus()` (calling it throws
 * TypeError) and `saveDoc` rejects while the entry is degraded.
 *
 * The future API is exercised through a local cast so the suite compiles and
 * runs against the current seam; the assertions are pure runtime behavior.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { FilePersistence, createFileHandleForTest } from '../src/file.js'
import type { DocHandle, PersistenceSchedule, PersistenceScheduler, User } from '../src/contract.js'
import { createTestScheduler } from '../src/testing.js'

type HandleStatus = 'ready' | 'persistence-degraded' | 'released' | 'disposed'

/** The future DocHandle face (AC1). Cast keeps the suite runnable pre-implementation. */
interface HandleWithStatus extends DocHandle {
  getStatus(): HandleStatus
}

function statusOf(handle: DocHandle): HandleStatus {
  return (handle as unknown as HandleWithStatus).getStatus()
}

const TEST_SCHEDULE: Partial<PersistenceSchedule> = { debounceMs: 10, maxDirtyMs: 50 }

const ALICE: User = { userId: 'alice' }
const BOB: User = { userId: 'bob' }

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Real-event-loop poll until predicate holds (bounded); lets async flushes settle. */
async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400 && !predicate(); i += 1) await sleep(5)
  expect(predicate(), what).toBe(true)
}

const tempRootDirs = new Set<string>()
function makeRootDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomicore-issue79-file-'))
  tempRootDirs.add(dir)
  return dir
}
afterAll(() => {
  for (const dir of tempRootDirs) fs.rmSync(dir, { recursive: true, force: true })
})

/**
 * Deterministic manual scheduler: nothing fires until the test fires the oldest
 * scheduled callback. Insertion order stands in for clock order.
 */
class ManualTimer implements PersistenceScheduler {
  private nextId = 0
  private readonly timers = new Map<number, () => void>()
  setTimeout(callback: () => void): unknown {
    const id = this.nextId++
    this.timers.set(id, callback)
    return id
  }
  clearTimeout(timer: unknown): void { this.timers.delete(timer as number) }
  fireOldest(): void {
    const oldest = this.timers.entries().next()
    if (oldest.done) throw new Error('ManualTimer.fireOldest(): no pending timer')
    const [id, callback] = oldest.value
    this.timers.delete(id)
    callback()
  }
  get pending(): number { return this.timers.size }
}

describe('issue-79: DocHandle entry-level status (FilePersistence)', () => {
  it('AC1: released and disposed handle status over the file adapter', async () => {
    const rootDir = makeRootDir()
    const persistence = new FilePersistence({ rootDir, schedule: TEST_SCHEDULE, scheduler: createTestScheduler() })

    const handle = await createFileHandleForTest(persistence, ALICE, 'd1')
    handle.doc.getMap('META').set('docId', 'd1')
    expect(statusOf(handle)).toBe('ready')

    await handle.release()
    expect(statusOf(handle)).toBe('released')

    await persistence.dispose()
    expect(statusOf(handle)).toBe('disposed')
  })

  it('AC3+AC4+AC5: entry-scoped degradation, degraded saveDoc registration, own-retry recovery, fresh-instance visibility', async () => {
    const rootDir = makeRootDir()
    const bobDir = path.join(rootDir, 'users', 'bob')
    fs.mkdirSync(bobDir, { recursive: true })
    fs.chmodSync(bobDir, 0o500) // r-x: bob's flush writeFile fails with EACCES

    const timer = new ManualTimer()
    const persistence = new FilePersistence({
      rootDir, scheduler: timer, schedule: { debounceMs: 100, maxDirtyMs: 1000 },
    })
    try {
      const bobHandle = await createFileHandleForTest(persistence, BOB, 'doomed')
      bobHandle.doc.getMap('META').set('docId', 'doomed')
      bobHandle.doc.getMap('ROOT').set('who', 'bob')
      await persistence.saveDoc(bobHandle)

      const aliceHandle = await createFileHandleForTest(persistence, ALICE, 'fine')
      aliceHandle.doc.getMap('META').set('docId', 'fine')
      aliceHandle.doc.getMap('ROOT').set('who', 'alice')
      await persistence.saveDoc(aliceHandle)

      // Fire bob's flush trigger -> EACCES -> only bob's entry degrades
      // (adapter aggregate reflects it; handle-level status asserted below).
      timer.fireOldest()
      await waitFor(
        () => persistence.getStatus() === 'persistence-degraded',
        'bob flush failure to degrade the adapter',
      )

      // Mutation while degraded: saveDoc registers dirty instead of rejecting.
      bobHandle.doc.getMap('ROOT').set('rev', 2)
      await expect(persistence.saveDoc(bobHandle)).resolves.toBeUndefined()

      // Entry-scoped status: bob degraded, unrelated namespace handle ready.
      expect(statusOf(bobHandle)).toBe('persistence-degraded')
      expect(statusOf(aliceHandle)).toBe('ready')

      // Heal the disk; Alice's own flush succeeds but must NOT restore bob.
      fs.chmodSync(bobDir, 0o755)
      timer.fireOldest() // alice's debounce -> alice flush lands on disk
      await waitFor(
        () => fs.existsSync(path.join(rootDir, 'users', 'alice', 'fine.snapshot')),
        'alice flush to land on disk',
      )
      expect(statusOf(bobHandle)).toBe('persistence-degraded')

      // Bob's own retry commits the full live doc (rev=2) and restores ready.
      timer.fireOldest() // bob's retry
      await waitFor(
        () => fs.existsSync(path.join(bobDir, 'doomed.snapshot')),
        'bob retry to commit its snapshot',
      )
      expect(statusOf(bobHandle)).toBe('ready')

      // 单一调度器纪律锚点（issue #79 设计 §3.4）：retry 成功闭合脏窗口后，该 entry
      // 不得残留任何无人认领的调度计时器。判别力（SA2 R1 /tmp 实测）：guard 在=0 /
      // guard 无=2（degraded 窗口 saveDoc 泄漏的 maxDirty+debounce 对）。
      expect(timer.pending).toBe(0)

      // A fresh FilePersistence instance over the same rootDir sees mutation 2.
      const fresh = new FilePersistence({ rootDir, schedule: TEST_SCHEDULE, scheduler: createTestScheduler() })
      const loaded = await fresh.loadDoc(BOB, 'doomed')
      expect(loaded).not.toBeNull()
      expect(loaded!.doc.getMap('ROOT').get('rev')).toBe(2)
      await loaded!.release()
      await fresh.dispose()

      await bobHandle.release()
      await aliceHandle.release()
      await persistence.dispose()
      expect(timer.pending).toBe(0)
    } finally {
      fs.chmodSync(bobDir, 0o755)
      await persistence.dispose()
    }
  })
})

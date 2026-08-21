/**
 * SA7 dynamic verification tests (Phase 3, issue #58) — permanent supplements.
 *
 * These pin the three runtime behaviors from the SA4 dynamic-audit list
 * (wiki/raw/task_file-persistence-plugin_sa4_review.md §8) that the SA6
 * acceptance suite does not already pin:
 *
 *   §8.1 sweep signal chain end-to-end — a leftover .tmp whose unlink fails
 *        (EACCES partition) neither blocks load nor silently disappears: the
 *        same disk condition resurfaces loudly on the next flush as
 *        `persistence-degraded`, closing the best-effort swallow's signal loop.
 *   §8.2 degraded radius — a failed flush for one user rejects writes for
 *        every other user on the same adapter instance (saveDoc AND the
 *        test-factory creation path); any single successful flush restores
 *        `ready` for everyone while the failed doc keeps backing off (its
 *        retry re-degrades the adapter).
 *   §8.3 leftover-tmp sweeping is keyed per (user, docId) — loading d1 removes
 *        only d1's tmp; an unrelated d2 leftover is never touched (no tree walk).
 *
 * Module-entry discipline (SA4 §8.4 / finding F-1): this file imports
 * ../src/index.js BEFORE the deep ../src/file.js path. A deep-path consumer
 * that skips index.js hits a module-cycle TDZ ("Class extends value
 * undefined"), which is a documented entry-order constraint, NOT an
 * implementation defect.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  FilePersistence,
  type PersistenceSchedule,
  type PersistenceTimer,
  type User,
} from '../src/index.js'
import { createFileHandleForTest } from '../src/file.js'

const TEST_SCHEDULE: Partial<PersistenceSchedule> = { debounceMs: 10, maxDirtyMs: 50 }

const ALICE: User = { userId: 'alice' }
const BOB: User = { userId: 'bob' }
const CAROL: User = { userId: 'carol' }

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Real-event-loop poll until predicate holds (bounded); lets async flushes settle. */
async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400 && !predicate(); i += 1) await sleep(5)
  expect(predicate(), what).toBe(true)
}

const tempRootDirs = new Set<string>()
function makeRootDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomicore-sa7-file-'))
  tempRootDirs.add(dir)
  return dir
}
afterAll(() => {
  for (const dir of tempRootDirs) fs.rmSync(dir, { recursive: true, force: true })
})

/**
 * Deterministic manual timer (SA4 §8.2 needs a flush ordering that real timers
 * cannot guarantee): nothing fires until the test fires the oldest scheduled
 * callback. Insertion order stands in for clock order; firing either the
 * debounce or the max-dirty trigger of an entry reaches the same startFlush.
 */
class ManualTimer implements PersistenceTimer {
  private nextId = 0
  private readonly timers = new Map<number, () => void>()
  now(): number { return 0 }
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

describe('FilePersistence SA7 dynamic verification', () => {
  it('sweep signal chain: an unremovable leftover tmp does not block load, and the same disk condition resurfaces as persistence-degraded on the next flush', async () => {
    const rootDir = makeRootDir()
    const userDir = path.join(rootDir, 'users', 'alice')
    const snapshotPath = path.join(userDir, 'd1.snapshot')
    const tmpPath = `${snapshotPath}.tmp`

    // Commit a snapshot while the partition is writable.
    const writer = new FilePersistence({ rootDir, schedule: TEST_SCHEDULE })
    const writerHandle = await createFileHandleForTest(writer, ALICE, 'd1')
    writerHandle.doc.getMap('META').set('docId', 'd1')
    writerHandle.doc.getMap('ROOT').set('v', 'committed')
    await writer.saveDoc(writerHandle)
    await writerHandle.release()
    await sleep(250)
    await writer.dispose()
    expect(fs.existsSync(snapshotPath)).toBe(true)
    fs.writeFileSync(tmpPath, 'crash-leftover')

    // r-x partition: reads still work; unlink/write fail with EACCES.
    fs.chmodSync(userDir, 0o555)
    try {
      const persistence = new FilePersistence({ rootDir, schedule: TEST_SCHEDULE })

      // (a) load succeeds; the swallowed unlink failure leaves the tmp in place
      const loaded = await persistence.loadDoc(ALICE, 'd1')
      expect(loaded).not.toBeNull()
      expect(loaded!.doc.getMap('ROOT').get('v')).toBe('committed')
      expect(fs.existsSync(tmpPath)).toBe(true) // unlink attempted, EACCES swallowed — not silent success
      expect(persistence.getStatus()).toBe('ready')

      // (b) save is accepted now; the swallowed disk condition resurfaces loudly
      loaded!.doc.getMap('ROOT').set('v', 'dirty')
      await persistence.saveDoc(loaded!)
      await sleep(250) // debounce 10ms fires; flush writeFile hits the same EACCES
      expect(persistence.getStatus()).toBe('persistence-degraded')
      expect(fs.existsSync(snapshotPath)).toBe(true) // old committed state intact
      await expect(persistence.saveDoc(loaded!)).rejects.toThrow(/persistence-degraded/)

      await loaded!.release()
      await persistence.dispose()
      expect(persistence.getStatus()).toBe('disposed')
    } finally {
      fs.chmodSync(userDir, 0o755)
    }
  })

  it('degraded radius spans users; any successful flush restores ready for everyone while the failed doc keeps backing off', async () => {
    const rootDir = makeRootDir()
    const bobDir = path.join(rootDir, 'users', 'bob')
    fs.mkdirSync(bobDir, { recursive: true })
    fs.chmodSync(bobDir, 0o500) // r-x: bob's flush writeFile fails with EACCES

    const timer = new ManualTimer()
    const persistence = new FilePersistence({
      rootDir, timer, schedule: { debounceMs: 100, maxDirtyMs: 1000 },
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
      expect(timer.pending).toBeGreaterThan(0) // flush triggers parked; nothing fired yet

      // Fire only bob's flush trigger → EACCES → the whole adapter degrades.
      timer.fireOldest()
      await waitFor(
        () => persistence.getStatus() === 'persistence-degraded',
        'bob flush failure degrades the whole adapter',
      )

      // Radius: another user's saveDoc AND the creation path are both rejected.
      await expect(persistence.saveDoc(aliceHandle)).rejects.toThrow(/persistence-degraded/)
      await expect(createFileHandleForTest(persistence, CAROL, 'newdoc')).rejects.toThrow(/persistence-degraded/)

      // Alice's own (healthy partition) flush restores writable status for all.
      timer.fireOldest()
      await waitFor(
        () => persistence.getStatus() === 'ready',
        'unrelated successful flush restores ready',
      )
      expect(fs.existsSync(path.join(rootDir, 'users', 'alice', 'fine.snapshot'))).toBe(true)
      expect(fs.existsSync(path.join(bobDir, 'doomed.snapshot'))).toBe(false) // bob never committed

      // Bob was parked in retry backoff the whole time: firing his retry
      // re-attempts the doomed flush and re-degrades the adapter.
      timer.fireOldest()
      await waitFor(
        () => persistence.getStatus() === 'persistence-degraded',
        'bob retry re-degrades — backoff machinery alive',
      )
      expect(fs.existsSync(path.join(bobDir, 'doomed.snapshot'))).toBe(false)

      await bobHandle.release()
      await aliceHandle.release()
      await persistence.dispose()
      expect(timer.pending).toBe(0)
    } finally {
      fs.chmodSync(bobDir, 0o755)
    }
  })

  it("leftover-tmp sweeping is keyed per (user, docId): loading d1 never touches d2's leftover", async () => {
    const rootDir = makeRootDir()
    const userDir = path.join(rootDir, 'users', 'alice')
    fs.mkdirSync(userDir, { recursive: true })
    const committed = new Y.Doc()
    committed.getMap('META').set('docId', 'd1')
    committed.getMap('ROOT').set('v', 'committed')
    fs.writeFileSync(path.join(userDir, 'd1.snapshot'), Y.encodeStateAsUpdate(committed))
    fs.writeFileSync(path.join(userDir, 'd1.snapshot.tmp'), 'leftover-d1')
    fs.writeFileSync(path.join(userDir, 'd2.snapshot.tmp'), 'leftover-d2')

    const persistence = new FilePersistence({ rootDir })
    const d1 = await persistence.loadDoc(ALICE, 'd1')
    expect(d1).not.toBeNull()
    expect(d1!.doc.getMap('ROOT').get('v')).toBe('committed')
    expect(fs.existsSync(path.join(userDir, 'd1.snapshot.tmp'))).toBe(false) // swept: keyed to the loaded doc
    expect(fs.existsSync(path.join(userDir, 'd2.snapshot.tmp'))).toBe(true) // untouched: no tree walk

    await d1!.release()
    await persistence.dispose()
  })
})

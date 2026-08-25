/**
 * SA7 dynamic verification tests (Phase 3, issue #58) — permanent supplements.
 * R3 revision per PR #66 owner review #2/#3/#4.
 *
 *   test 1 — leftover-tmp sweep is loud: a non-ENOENT unlink failure (EACCES
 *        partition) rejects loadDoc with the original errno preserved and
 *        leaves the tmp in place; after the partition heals, load succeeds and
 *        the tmp is swept. ADR-0006 "ignore and delete": the delete is an
 *        obligation, not best-effort (ENOENT stays silent; the normal/ENOENT
 *        sweep paths are already pinned by the SA6 suite).
 *   test 2 — degraded/recovery is entry-scoped (ADR-0006 namespace semantics):
 *        a failed flush degrades ONLY its own (user, docId) entry; unrelated
 *        entries stay readable and writable; an unrelated successful flush
 *        does NOT restore the failed entry; only the failed entry's own retry
 *        success restores it.
 *   test 3 — leftover-tmp sweeping is keyed per (user, docId): loading d1
 *        removes only d1's tmp; an unrelated d2 leftover is never touched
 *        (no tree walk).
 *
 * No index.ts barrel import and no entry-order discipline are needed: the R3
 * module graph is acyclic (contract.ts is the dependency leaf), so these deep
 * imports evaluate safely in any order (see module-graph-regression.test.ts).
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { FilePersistence, createFileHandleForTest } from '../src/file.js'
import type { PersistenceSchedule, PersistenceScheduler, User } from '../src/contract.js'
import { createTestScheduler } from '../src/testing.js'

const TEST_SCHEDULE: PersistenceSchedule = { debounceMs: 10, maxDirtyMs: 50 }

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
 * Deterministic manual timer: nothing fires until the test fires the oldest
 * scheduled callback. Insertion order stands in for clock order; firing either
 * the debounce or the max-dirty trigger of an entry reaches the same
 * startFlush.
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

describe('FilePersistence SA7 dynamic verification', () => {
  it('non-ENOENT tmp sweep failure is loud: loadDoc rejects with the errno preserved, then heals after chmod', async () => {
    const rootDir = makeRootDir()
    const userDir = path.join(rootDir, 'users', 'alice')
    const snapshotPath = path.join(userDir, 'd1.snapshot')
    const tmpPath = `${snapshotPath}.tmp`

    // Commit a snapshot while the partition is writable.
    const writerScheduler = createTestScheduler()
    const writer = new FilePersistence({ rootDir, schedule: TEST_SCHEDULE, scheduler: writerScheduler })
    const writerHandle = await createFileHandleForTest(writer, ALICE, 'd1')
    writerHandle.doc.getMap('META').set('docId', 'd1')
    writerHandle.doc.getMap('ROOT').set('v', 'committed')
    await writer.saveDoc(writerHandle)
    await writerHandle.release()
    // 虚拟调度（issue #107）：advanceBy 触发 debounce + deadline 式等待真实 I/O 落盘
    // （原真实 sleep(250) 在虚拟 scheduler 下永不触发）。
    await writerScheduler.advanceBy(TEST_SCHEDULE.debounceMs)
    await waitFor(
      () => fs.existsSync(snapshotPath) && !fs.existsSync(`${snapshotPath}.tmp`),
      'writer snapshot to commit with no .tmp residue',
    )
    await writer.dispose()
    expect(fs.existsSync(snapshotPath)).toBe(true)
    fs.writeFileSync(tmpPath, 'crash-leftover')

    // r-x partition: readFile still works, but unlink fails with EACCES.
    fs.chmodSync(userDir, 0o555)
    try {
      const persistence = new FilePersistence({ rootDir, schedule: TEST_SCHEDULE, scheduler: createTestScheduler() })

      // The sweep's unlink failure must surface loudly at load time with the
      // original errno — even though the committed snapshot is fully readable.
      await expect(persistence.loadDoc(ALICE, 'd1')).rejects.toMatchObject({ code: 'EACCES' })
      expect(fs.existsSync(tmpPath)).toBe(true) // failed unlink left the tmp in place
      await persistence.dispose()
    } finally {
      fs.chmodSync(userDir, 0o755)
    }

    // Healed partition: load succeeds and the leftover tmp is swept.
    const persistence = new FilePersistence({ rootDir, schedule: TEST_SCHEDULE, scheduler: createTestScheduler() })
    const loaded = await persistence.loadDoc(ALICE, 'd1')
    expect(loaded).not.toBeNull()
    expect(loaded!.doc.getMap('ROOT').get('v')).toBe('committed')
    expect(fs.existsSync(tmpPath)).toBe(false) // swept after the healed load

    await loaded!.release()
    await persistence.dispose()
  })

  it('directory tmp placeholder is removed during load without an unhandled rejection, then the committed snapshot remains usable', async () => {
    const rootDir = makeRootDir()
    const userDir = path.join(rootDir, 'users', 'alice')
    const snapshotPath = path.join(userDir, 'd1.snapshot')
    const tmpPath = `${snapshotPath}.tmp`
    fs.mkdirSync(userDir, { recursive: true })

    const committed = new Y.Doc()
    committed.getMap('META').set('docId', 'd1')
    committed.getMap('ROOT').set('v', 'committed')
    fs.writeFileSync(snapshotPath, Y.encodeStateAsUpdate(committed))
    fs.mkdirSync(tmpPath)

    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    const persistence = new FilePersistence({ rootDir, scheduler: createTestScheduler() })
    try {
      const loaded = await persistence.loadDoc(ALICE, 'd1')
      expect(loaded).not.toBeNull()
      expect(loaded!.doc.getMap('ROOT').get('v')).toBe('committed')
      expect(fs.existsSync(tmpPath)).toBe(false)
      await Promise.resolve()
      await Promise.resolve()
      expect(unhandled).toEqual([])
      await loaded!.release()
    } finally {
      process.off('unhandledRejection', onUnhandled)
      await persistence.dispose()
    }
  })

  it('degraded/recovery is entry-scoped: only the failed (user, docId) is degraded, unrelated docs stay writable, and only its own retry restores it', async () => {
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
      expect(timer.pending).toBeGreaterThan(0) // flush triggers parked; nothing fired yet

      // Fire only bob's flush trigger → EACCES → only bob's entry degrades.
      timer.fireOldest()
      await waitFor(
        () => persistence.getStatus() === 'persistence-degraded',
        'bob flush failure degrades the adapter',
      )

      // Coverage 1: only Bob/doc1 is degraded — saveDoc registers dirty (AC5)
      // and a twin lease on the same degraded entry still resolves (AC1).
      expect(bobHandle.getStatus()).toBe('persistence-degraded')
      await expect(persistence.saveDoc(bobHandle)).resolves.toBeUndefined()
      const twin = await createFileHandleForTest(persistence, BOB, 'doomed')
      expect(twin.getStatus()).toBe('persistence-degraded')
      await twin.release()

      // Coverage 2: Alice/doc2 stays readable and writable; CAROL's fresh doc
      // creation is also allowed (a new entry has no degraded history).
      const aliceReload = await persistence.loadDoc(ALICE, 'fine')
      expect(aliceReload).not.toBeNull()
      expect(aliceReload!.doc).toBe(aliceHandle.doc)
      await expect(persistence.saveDoc(aliceHandle)).resolves.toBeUndefined()
      const carolHandle = await createFileHandleForTest(persistence, CAROL, 'newdoc')
      await carolHandle.release()

      // Coverage 3: Alice's successful flush must NOT restore Bob/doc1 — Bob
      // stays degraded (entry status). Adapter status is only a coarse health
      // summary; degraded saveDoc keeps registering dirty (AC5).
      timer.fireOldest()
      await waitFor(
        () => fs.existsSync(path.join(rootDir, 'users', 'alice', 'fine.snapshot')),
        'alice flush lands on disk',
      )
      expect(bobHandle.getStatus()).toBe('persistence-degraded')
      await expect(persistence.saveDoc(bobHandle)).resolves.toBeUndefined()
      expect(persistence.getStatus()).toBe('persistence-degraded')
      expect(fs.existsSync(path.join(bobDir, 'doomed.snapshot'))).toBe(false) // bob never committed

      // Coverage 4: heal the disk, then fire Bob's own retry — only its own
      // retry success restores writability for the entry.
      fs.chmodSync(bobDir, 0o755)
      timer.fireOldest()
      await waitFor(
        () => fs.existsSync(path.join(bobDir, 'doomed.snapshot')),
        'bob retry commits after healing',
      )
      expect(persistence.getStatus()).toBe('ready')
      await expect(persistence.saveDoc(bobHandle)).resolves.toBeUndefined()

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

    const persistence = new FilePersistence({ rootDir, scheduler: createTestScheduler() })
    const d1 = await persistence.loadDoc(ALICE, 'd1')
    expect(d1).not.toBeNull()
    expect(d1!.doc.getMap('ROOT').get('v')).toBe('committed')
    expect(fs.existsSync(path.join(userDir, 'd1.snapshot.tmp'))).toBe(false) // swept: keyed to the loaded doc
    expect(fs.existsSync(path.join(userDir, 'd2.snapshot.tmp'))).toBe(true) // untouched: no tree walk

    await d1!.release()
    await persistence.dispose()
  })
})

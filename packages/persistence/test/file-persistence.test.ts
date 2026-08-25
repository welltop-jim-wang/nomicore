/**
 * SA6 red acceptance tests for the FilePersistence Cordis plugin (issue #58).
 *
 * This file is the Phase-1 acceptance anchor: every test below is RED until
 * `src/file.ts` exists and satisfies the ADR-0006 v1 disk contract. The tests
 * deliberately mirror the MemoryPersistence adapter surface so the P2 lifecycle
 * core is reused instead of being copied:
 *
 *   - `FilePersistence` class (options: rootDir + optional schedule/scheduler)
 *       implements DocPersistence, plus `apply(ctx)`, `dispose()`, `getStatus()`
 *   - `createFilePersistencePlugin(options)` -> Cordis plugin factory
 *   - `createFileHandleForTest(persistence, user, docId)` (test-only creation
 *       path exported from `src/file.js`, mirroring `src/memory.js`)
 *   - `FilePersistenceStatus` = 'ready' | 'persistence-degraded' | 'disposed'
 *
 * Behavior is asserted through the real filesystem (mkdtemp rootDir) and
 * through the public DocPersistence seam; no source text is inspected.
 *
 * R1 timer 迁移（issue #107）：真实 sleep(250) 的 `waitForFlush()` 已替换为
 * 「显式 createTestScheduler() 注入 + advanceBy(debounceMs) 触发 + deadline 式
 * waitFor(谓词) 等真实 I/O」。谓词逐用例化（R1/#9）：首写用例 = 快照文件存在；
 * 覆盖写用例（chmod 0o444 后二次 flush）文件已存在 → 谓词解码内容断言
 * generation。时序纪律：waitFor 必须先于 writer.dispose() 完成（dispose 经
 * AbortSignal 掐断在途写，先 dispose 后等待将永不落盘）。
 */
import { Context } from '@deepseek-ai/cordis'
import { afterAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createManualClock, createManualClockPlugin } from '@nomicore/clock/testing'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  FilePersistence,
  createFilePersistencePlugin,
  type PersistenceSchedule,
  type User,
} from '../src/index.js'
import { createFileHandleForTest } from '../src/file.js'
import {
  createFakeTimerPlugin,
  createPersistenceIoFaultSeam,
  createTestScheduler,
  describeDocPersistenceContract,
  describePersistenceErrorContract,
  type TestScheduler,
} from '../src/testing.js'

const TEST_SCHEDULE: PersistenceSchedule = { debounceMs: 10, maxDirtyMs: 50 }

/**
 * deadline 式真实等待（dsh clock.ts waitFor 同款轮询语义）：真实文件 I/O 在
 * libuv 线程池结算，须经宏任务轮转才落地——以真实 setTimeout 轮询谓词直到成立
 * 或真实时间上限（默认 5s）耗尽，超时路径 loud throw（同 ProbeTimeoutError 纪律）。
 */
async function waitFor(predicate: () => boolean, what: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (predicate()) return
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what} (${timeoutMs}ms)`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const tempRootDirs = new Set<string>()
function makeRootDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomicore-file-persist-'))
  tempRootDirs.add(dir)
  return dir
}
afterAll(() => {
  for (const dir of tempRootDirs) fs.rmSync(dir, { recursive: true, force: true })
})

/** ADR-0006 three-entry doc: SCHEMA envelope + META identity + ROOT data root. */
function populateThreeEntryDoc(doc: Y.Doc, docId: string): void {
  const schema = doc.getMap('SCHEMA')
  schema.set('lang', 'vfsl')
  schema.set('version', 1)
  schema.set('id', 'vfs3-assets@v1')
  schema.set('text', 'module Vfs3Assets { ... }')
  const meta = doc.getMap('META')
  meta.set('docId', docId)
  meta.set('createdAt', 1_787_304_142_133)
  const root = doc.getMap('ROOT')
  root.set('title', 'hello')
  root.set('n', 42)
  root.set('flag', true)
  const nested = new Y.Map<string>()
  nested.set('k', 'v')
  root.set('nested', nested)
  root.set('body', new Y.Text('line one'))
}

/**
 * 虚拟化 seed：显式 scheduler 注入 + advanceBy(debounceMs) 触发 + deadline 式
 * 谓词轮询等待真实 I/O（waitFor 必须先于 dispose —— dispose 经 AbortSignal
 * 掐断在途写，先 dispose 后等待将永不落盘）。谓词逐用例化（R1/#9）：
 * 首写 = 快照存在；覆盖写 = 解码内容断言 generation。
 */
async function seedAndFlush(
  persistence: FilePersistence,
  scheduler: TestScheduler,
  user: User,
  docId: string,
  populate: (doc: Y.Doc) => void,
  flushDone: () => boolean,
  what: string,
): Promise<Y.Doc> {
  const handle = await createFileHandleForTest(persistence, user, docId)
  populate(handle.doc)
  handle.doc.getMap('META').set('docId', docId)
  await persistence.saveDoc(handle)
  await handle.release()
  await scheduler.advanceBy(TEST_SCHEDULE.debounceMs)
  await waitFor(flushDone, what)
  return handle.doc
}

// ---------------------------------------------------------------------------
// P1 shared contract suite, wired to the FilePersistence adapter.
// ---------------------------------------------------------------------------

await describeDocPersistenceContract(async () => {
  const persistence = new FilePersistence({ rootDir: makeRootDir(), scheduler: createTestScheduler() })
  return {
    persistence,
    async createHandle(user, docId) {
      const handle = await createFileHandleForTest(persistence, user, docId)
      handle.doc.getMap('META').set('docId', docId)
      return handle
    },
  }
})

// ---------------------------------------------------------------------------
// Typed error contract (issue #108 §5.3): shared EC1–EC8 suite, File fixture
// anchored on the REAL filesystem commit point (mkdtemp rootDir, default io =
// real mkdir→tmp→rename; only `wrapIo` injects faults). `writeCommitted`
// writes the .snapshot bytes straight to disk for corruption fixtures.
// ---------------------------------------------------------------------------

await describePersistenceErrorContract(async () => {
  const rootDir = makeRootDir()
  const scheduler = createTestScheduler()
  const seam = createPersistenceIoFaultSeam()
  const persistence = new FilePersistence({ rootDir, scheduler, wrapIo: seam.wrap })
  return {
    persistence,
    scheduler,
    faults: seam.faults,
    makeFresh: () => new FilePersistence({ rootDir, scheduler: createTestScheduler() }),
    writeCommitted: async (owner, docId, bytes) => {
      const userDir = path.join(rootDir, 'users', owner.userId)
      fs.mkdirSync(userDir, { recursive: true })
      fs.writeFileSync(path.join(userDir, `${docId}.snapshot`), bytes)
    },
    dispose: () => persistence.dispose(),
  }
})

// ---------------------------------------------------------------------------
// File-system-specific acceptance tests (ADR-0006 v1 disk contract).
// ---------------------------------------------------------------------------

describe('FilePersistence', () => {
  it('writes the ADR disk layout {rootDir}/users/{userId}/{namespaceId}.snapshot as a full Yjs update with no temp left behind', async () => {
    const rootDir = makeRootDir()
    const scheduler = createTestScheduler()
    const persistence = new FilePersistence({ rootDir, schedule: TEST_SCHEDULE, scheduler })
    const handle = await createFileHandleForTest(persistence, { userId: 'alice' }, 'doc1')
    handle.doc.getMap('META').set('docId', 'doc1')
    handle.doc.getMap('ROOT').set('value', 'saved')
    await persistence.saveDoc(handle)
    await handle.release()
    const snapshotPath = path.join(rootDir, 'users', 'alice', 'doc1.snapshot')
    await scheduler.advanceBy(TEST_SCHEDULE.debounceMs)
    await waitFor(() => fs.existsSync(snapshotPath), 'doc1 snapshot to land on disk')

    expect(fs.existsSync(snapshotPath)).toBe(true)
    expect(fs.existsSync(`${snapshotPath}.tmp`)).toBe(false)

    // The committed bytes must be a complete Yjs state update (encodeStateAsUpdate).
    const restored = new Y.Doc()
    Y.applyUpdate(restored, fs.readFileSync(snapshotPath))
    expect(restored.getMap('META').get('docId')).toBe('doc1')
    expect(restored.getMap('ROOT').get('value')).toBe('saved')

    await persistence.dispose()
  })

  it('fully restores SCHEMA/META/ROOT through a brand-new instance after save (crash restart)', async () => {
    const rootDir = makeRootDir()
    const writerScheduler = createTestScheduler()
    const writer = new FilePersistence({ rootDir, schedule: TEST_SCHEDULE, scheduler: writerScheduler })
    const writerDoc = await seedAndFlush(
      writer,
      writerScheduler,
      { userId: 'alice' },
      'ns-1',
      (doc) => { populateThreeEntryDoc(doc, 'ns-1') },
      () => fs.existsSync(path.join(rootDir, 'users', 'alice', 'ns-1.snapshot')),
      'ns-1 snapshot to land on disk',
    )
    await writer.dispose()

    const reader = new FilePersistence({ rootDir, scheduler: createTestScheduler() })
    const restored = await reader.loadDoc({ userId: 'alice' }, 'ns-1')
    expect(restored).not.toBeNull()
    expect(restored!.doc).not.toBe(writerDoc)

    const schema = restored!.doc.getMap('SCHEMA')
    expect(schema.get('lang')).toBe('vfsl')
    expect(schema.get('version')).toBe(1)
    expect(schema.get('id')).toBe('vfs3-assets@v1')
    expect(String(schema.get('text'))).toContain('module')

    const meta = restored!.doc.getMap('META')
    expect(meta.get('docId')).toBe('ns-1')
    expect(meta.get('createdAt')).toBe(1_787_304_142_133)

    const root = restored!.doc.getMap('ROOT')
    expect(root.get('title')).toBe('hello')
    expect(root.get('n')).toBe(42)
    expect(root.get('flag')).toBe(true)
    expect(root.get('nested')).toBeInstanceOf(Y.Map)
    expect((root.get('nested') as Y.Map<string>).get('k')).toBe('v')
    expect((root.get('body') as Y.Text).toString()).toBe('line one')

    await restored!.release()
    await reader.dispose()
  })

  it('isolates users: the same docId under different users lives in separate partitions', async () => {
    const rootDir = makeRootDir()
    const scheduler = createTestScheduler()
    const persistence = new FilePersistence({ rootDir, schedule: TEST_SCHEDULE, scheduler })
    await seedAndFlush(
      persistence, scheduler, { userId: 'alice' }, 'doc1',
      (doc) => { doc.getMap('ROOT').set('owner', 'alice') },
      () => fs.existsSync(path.join(rootDir, 'users', 'alice', 'doc1.snapshot')),
      'alice doc1 snapshot to land on disk',
    )
    await seedAndFlush(
      persistence, scheduler, { userId: 'bob' }, 'doc1',
      (doc) => { doc.getMap('ROOT').set('owner', 'bob') },
      () => fs.existsSync(path.join(rootDir, 'users', 'bob', 'doc1.snapshot')),
      'bob doc1 snapshot to land on disk',
    )

    expect(fs.existsSync(path.join(rootDir, 'users', 'alice', 'doc1.snapshot'))).toBe(true)
    expect(fs.existsSync(path.join(rootDir, 'users', 'bob', 'doc1.snapshot'))).toBe(true)

    const reader = new FilePersistence({ rootDir, scheduler: createTestScheduler() })
    const alice = await reader.loadDoc({ userId: 'alice' }, 'doc1')
    const bob = await reader.loadDoc({ userId: 'bob' }, 'doc1')
    expect(alice).not.toBeNull()
    expect(bob).not.toBeNull()
    expect(alice!.doc.getMap('ROOT').get('owner')).toBe('alice')
    expect(bob!.doc.getMap('ROOT').get('owner')).toBe('bob')
    expect(alice!.doc).not.toBe(bob!.doc)

    await alice!.release()
    await bob!.release()
    await reader.dispose()
    await persistence.dispose()
  })

  it('keeps plugin instances with different rootDir fully independent', async () => {
    const rootA = makeRootDir()
    const rootB = makeRootDir()
    const schedulerA = createTestScheduler()
    const a = new FilePersistence({ rootDir: rootA, schedule: TEST_SCHEDULE, scheduler: schedulerA })
    const b = new FilePersistence({ rootDir: rootB, schedule: TEST_SCHEDULE, scheduler: createTestScheduler() })
    await seedAndFlush(
      a, schedulerA, { userId: 'alice' }, 'doc1',
      (doc) => { doc.getMap('ROOT').set('secret', 'only-in-a') },
      () => fs.existsSync(path.join(rootA, 'users', 'alice', 'doc1.snapshot')),
      'rootA doc1 snapshot to land on disk',
    )

    expect(fs.existsSync(path.join(rootA, 'users', 'alice', 'doc1.snapshot'))).toBe(true)
    expect(fs.existsSync(path.join(rootB, 'users', 'alice', 'doc1.snapshot'))).toBe(false)
    expect(await b.loadDoc({ userId: 'alice' }, 'doc1')).toBeNull()

    await a.dispose()
    await b.dispose()
  })

  it('ignores and deletes leftover .tmp files on load (crash recovery)', async () => {
    const rootDir = makeRootDir()
    const userDir = path.join(rootDir, 'users', 'alice')
    fs.mkdirSync(userDir, { recursive: true })

    // (a) stale tmp with no committed snapshot: load misses and the tmp is removed.
    const staleTmp = path.join(userDir, 'doc1.snapshot.tmp')
    fs.writeFileSync(staleTmp, 'half-written garbage')
    const persistence = new FilePersistence({ rootDir, scheduler: createTestScheduler() })
    expect(await persistence.loadDoc({ userId: 'alice' }, 'doc1')).toBeNull()
    expect(fs.existsSync(staleTmp)).toBe(false)

    // (b) stale tmp next to a committed snapshot: only .snapshot is honored and
    // the tmp is removed.
    const committed = new Y.Doc()
    committed.getMap('META').set('docId', 'doc2')
    committed.getMap('ROOT').set('value', 'committed')
    fs.writeFileSync(path.join(userDir, 'doc2.snapshot'), Y.encodeStateAsUpdate(committed))
    fs.writeFileSync(path.join(userDir, 'doc2.snapshot.tmp'), 'half-written garbage')

    const loaded = await persistence.loadDoc({ userId: 'alice' }, 'doc2')
    expect(loaded).not.toBeNull()
    expect(loaded!.doc.getMap('ROOT').get('value')).toBe('committed')
    expect(fs.existsSync(path.join(userDir, 'doc2.snapshot.tmp'))).toBe(false)

    await loaded!.release()
    await persistence.dispose()
  })

  it('treats a snapshot whose META.docId does not match the requested namespace as corruption and fails loudly', async () => {
    const rootDir = makeRootDir()
    const userDir = path.join(rootDir, 'users', 'alice')
    fs.mkdirSync(userDir, { recursive: true })
    const corrupted = new Y.Doc()
    corrupted.getMap('META').set('docId', 'other-doc')
    corrupted.getMap('ROOT').set('value', 'x')
    fs.writeFileSync(path.join(userDir, 'doc1.snapshot'), Y.encodeStateAsUpdate(corrupted))

    const persistence = new FilePersistence({ rootDir, scheduler: createTestScheduler() })
    await expect(persistence.loadDoc({ userId: 'alice' }, 'doc1')).rejects.toThrow(/META\.docId/)
    await persistence.dispose()
  })

  it('validates userId/namespaceId against the safe grammar and never escapes rootDir', async () => {
    const rootDir = makeRootDir()
    const persistence = new FilePersistence({ rootDir, scheduler: createTestScheduler() })

    const badUserIds = ['', '../escape', 'a/b', 'a\\b', 'a b', 'A', 'a_b', 'a.1', '-abc', '1abc', 'a'.repeat(64)]
    for (const bad of badUserIds) {
      await expect(persistence.loadDoc({ userId: bad }, 'doc1')).rejects.toThrow()
    }
    const badDocIds = ['', '../escape', 'a/b', 'A', 'a_b', 'a'.repeat(64)]
    for (const bad of badDocIds) {
      await expect(persistence.loadDoc({ userId: 'alice' }, bad)).rejects.toThrow()
    }

    // Grammar boundaries: single char and the 63-char maximum are accepted.
    expect(await persistence.loadDoc({ userId: 'a' }, 'a')).toBeNull()
    expect(await persistence.loadDoc({ userId: 'a'.repeat(63) }, 'a'.repeat(63))).toBeNull()

    // No path traversal may touch anything outside rootDir.
    expect(fs.existsSync(path.join(rootDir, '..', 'escape'))).toBe(false)
    expect(fs.existsSync(path.join(rootDir, '..', 'users', 'escape'))).toBe(false)

    await persistence.dispose()
  })

  it('replaces a committed snapshot via atomic rename: a read-only committed file does not block the next flush', async () => {
    const rootDir = makeRootDir()
    const scheduler = createTestScheduler()
    const persistence = new FilePersistence({ rootDir, schedule: TEST_SCHEDULE, scheduler })
    const snapshotPath = path.join(rootDir, 'users', 'alice', 'doc1.snapshot')
    await seedAndFlush(
      persistence, scheduler, { userId: 'alice' }, 'doc1',
      (doc) => { doc.getMap('ROOT').set('generation', 1) },
      () => fs.existsSync(snapshotPath),
      'doc1 generation-1 snapshot to land on disk',
    )

    // A committed snapshot that cannot be opened for writing. rename(2) only
    // needs write permission on the parent directory, so a tmp+rename flush
    // succeeds while a direct rewrite of .snapshot fails with EACCES.
    fs.chmodSync(snapshotPath, 0o444)

    // 覆盖写谓词（R1/#9）：文件已存在，必须解码内容断言 generation===2。
    await seedAndFlush(
      persistence, scheduler, { userId: 'alice' }, 'doc1',
      (doc) => { doc.getMap('ROOT').set('generation', 2) },
      () => {
        if (!fs.existsSync(snapshotPath)) return false
        const after = new Y.Doc()
        try {
          Y.applyUpdate(after, fs.readFileSync(snapshotPath))
        } catch {
          return false
        }
        return after.getMap('ROOT').get('generation') === 2
      },
      'doc1 generation-2 snapshot to be committed',
    )

    expect(persistence.getStatus()).toBe('ready')
    const after = new Y.Doc()
    Y.applyUpdate(after, fs.readFileSync(snapshotPath))
    expect(after.getMap('ROOT').get('generation')).toBe(2)
    expect(fs.existsSync(`${snapshotPath}.tmp`)).toBe(false)

    await persistence.dispose()
  })

  it('dispose cancels pending flush timers, leaves nothing written, and rejects further use', async () => {
    const rootDir = makeRootDir()
    const scheduler = createTestScheduler()
    const persistence = new FilePersistence({ rootDir, scheduler })
    const handle = await createFileHandleForTest(persistence, { userId: 'alice' }, 'doc1')
    handle.doc.getMap('META').set('docId', 'doc1')
    await persistence.saveDoc(handle)
    expect(scheduler.pending()).toBeGreaterThan(0)

    await persistence.dispose()

    expect(scheduler.pending()).toBe(0)
    expect(persistence.getStatus()).toBe('disposed')
    expect(fs.existsSync(path.join(rootDir, 'users', 'alice', 'doc1.snapshot'))).toBe(false)
    await expect(persistence.loadDoc({ userId: 'alice' }, 'doc1')).rejects.toThrow(/disposed/)
    await expect(persistence.saveDoc(handle)).rejects.toThrow()

    await persistence.dispose()
  })

  it('registers as a Cordis service through the plugin factory and disposes with the fiber', async () => {
    const rootDir = makeRootDir()
    const plugin = createFilePersistencePlugin({ rootDir })
    const ctx = new Context()
    createManualClockPlugin(createManualClock()).apply(ctx)
    createFakeTimerPlugin(createTestScheduler()).apply(ctx)
    plugin.apply(ctx)

    const persistence = plugin.instance
    expect(persistence).toBeInstanceOf(FilePersistence)
    expect(ctx.get('nomicorePersistence')).toBe(persistence)

    const handle = await createFileHandleForTest(persistence!, { userId: 'alice' }, 'doc1')
    handle.doc.getMap('META').set('docId', 'doc1')
    await persistence!.saveDoc(handle)
    await handle.release()

    await ctx.fiber.dispose()
    expect(persistence!.getStatus()).toBe('disposed')
    expect(ctx.get('nomicorePersistence')).toBeUndefined()
  })
})

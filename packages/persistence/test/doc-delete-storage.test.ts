/**
 * issue #228（ADR-0006 修订节）Persistence 逻辑删除存储面套件（T-P3/T-P4）：
 *
 * - P3a File：主键 .snapshot + 同名 .tmp + 受控归档位 .snapshot/.tmp 全清
 *   （手工/迁移残留也覆盖——R4 归档位清理的防御性）；
 * - P3b File：真实归档（archiveDoc 身份前置成功）后 deleteDoc → 归档副本也消失；
 * - P3c File：删除后 loadDoc → null、二次 deleteDoc 幂等 {ok:true}（ENOENT 容忍）；
 * - P3d 部分失败重试收敛：removeKey 运营拒绝（failNextRemoveKey）→
 *   DocDeleteOperationalError（cause 原样）→ 重试 {ok:true}；
 * - P3e Memory：deleteSnapshot hook 纪律——主 mirror + hook store 双清；
 * - P4a disposed → DocDeleteFatalError('lifecycle-disposed')（committed:false）；
 * - P4b removeKey 缺席（wrapIo 剥离）→ capability gate bare loud Error；
 * - P4c io.removeKey 同步 throw（PersistenceIO 契约违约）→
 *   DocDeleteFatalError('adapter-violation')。
 *
 * 锚定纪律：真实 yjs / 真实 Memory/File adapter + wrapIo 故障注入；fake
 * scheduler 脚本化；真实 fs（mkdtemp）file 面。
 */
import { afterAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createMemoryPersistence,
  DocDeleteFatalError,
  DocDeleteOperationalError,
  FilePersistence,
  type PersistenceIO,
  type ReplicaPersistence,
  type ReplicationIdentityRef,
  type User,
} from '@nomicore/persistence';
import {
  createPersistenceIoFaultSeam,
  createTestScheduler,
  type PersistenceIoFaultSeam,
} from '@nomicore/persistence/testing';

const ALICE: User = Object.freeze({ userId: 'u-alice' });
const TEST_SCHEDULE = { debounceMs: 10, maxDirtyMs: 50 };
const REPLICATION_ID = 'a'.repeat(32);
const EXPECTED_IDENTITY: ReplicationIdentityRef = Object.freeze({
  replicationId: REPLICATION_ID,
  replicationEpoch: 1,
});

function keyOf(owner: User, docId: string): string {
  return `${owner.userId}\u0000${docId}`;
}

function makeDoc(docId: string, replicationId?: string): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('META').set('docId', docId);
  if (replicationId !== undefined) {
    doc.getMap('META').set('replicationId', replicationId);
    doc.getMap('META').set('replicationEpoch', 1);
  }
  doc.getMap('ROOT').set('n', 1);
  return doc;
}

const tempRootDirs = new Set<string>();
function makeRootDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomicore-doc-delete-store-'));
  tempRootDirs.add(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempRootDirs) fs.rmSync(dir, { recursive: true, force: true });
});

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function commitDoc(persistence: FilePersistence, scheduler: ReturnType<typeof createTestScheduler>, docId: string, replicationId?: string): Promise<void> {
  const handle = await persistence.createDoc(ALICE, docId, makeDoc(docId, replicationId));
  await handle.release();
  await scheduler.advanceBy(TEST_SCHEDULE.debounceMs + 1);
}

describe('issue #228 — deleteDoc 存储面（File 真实 fs；T-P3）', () => {
  it('P3a File 全副本清理：主键 .snapshot/.tmp + 归档位 .snapshot/.tmp 全清（含手工残留）', async () => {
    const rootDir = makeRootDir();
    const scheduler = createTestScheduler();
    const persistence = new FilePersistence({ rootDir, scheduler, schedule: TEST_SCHEDULE });
    const docId = 'ns-store-a';
    await commitDoc(persistence, scheduler, docId);

    const primarySnapshot = path.join(rootDir, 'users', ALICE.userId, `${docId}.snapshot`);
    const primaryTmp = `${primarySnapshot}.tmp`;
    const archiveSnapshot = path.join(rootDir, 'archive', 'users', ALICE.userId, `${docId}.snapshot`);
    const archiveTmp = `${archiveSnapshot}.tmp`;
    // 手工/迁移残留：主键 tmp 与归档位整对（R4 防御性清理面）
    fs.writeFileSync(primaryTmp, 'stale-tmp');
    fs.mkdirSync(path.dirname(archiveSnapshot), { recursive: true });
    fs.writeFileSync(archiveSnapshot, 'stale-archive');
    fs.writeFileSync(archiveTmp, 'stale-archive-tmp');
    for (const p of [primarySnapshot, primaryTmp, archiveSnapshot, archiveTmp]) {
      expect(fs.existsSync(p), p).toBe(true);
    }

    await persistence.deleteDoc(ALICE, docId);
    for (const p of [primarySnapshot, primaryTmp, archiveSnapshot, archiveTmp]) {
      expect(fs.existsSync(p), `残留 ${p} 必须被删除`).toBe(false);
    }
    await persistence.dispose();
  });

  it('P3b File 真实归档后 deleteDoc：归档副本随主键一并逻辑删除', async () => {
    const rootDir = makeRootDir();
    const scheduler = createTestScheduler();
    const persistence = new FilePersistence({ rootDir, scheduler, schedule: TEST_SCHEDULE });
    const docId = 'ns-store-b';
    await commitDoc(persistence, scheduler, docId, REPLICATION_ID);
    const archived = await persistence.archiveDoc(ALICE, docId, EXPECTED_IDENTITY);
    expect(archived).toEqual({ ok: true });
    const archiveSnapshot = path.join(rootDir, 'archive', 'users', ALICE.userId, `${docId}.snapshot`);
    expect(fs.existsSync(archiveSnapshot)).toBe(true);
    expect(await persistence.loadDoc(ALICE, docId)).toBeNull();

    await persistence.deleteDoc(ALICE, docId);
    expect(fs.existsSync(archiveSnapshot), '归档副本必须随删除消失').toBe(false);
    await persistence.dispose();
  });

  it('P3c File 删除后 loadDoc → null、二次 deleteDoc 幂等 {ok:true}（ENOENT 容忍）', async () => {
    const rootDir = makeRootDir();
    const scheduler = createTestScheduler();
    const persistence = new FilePersistence({ rootDir, scheduler, schedule: TEST_SCHEDULE });
    const docId = 'ns-store-c';
    await commitDoc(persistence, scheduler, docId);
    await persistence.deleteDoc(ALICE, docId);
    expect(await persistence.loadDoc(ALICE, docId)).toBeNull();
    await expect(persistence.deleteDoc(ALICE, docId)).resolves.toEqual({ ok: true });
    await persistence.dispose();
  });

  it('P3d 部分失败重试收敛：removeKey 运营拒绝 → DocDeleteOperationalError（cause 原样）→ 重试 {ok:true}', async () => {
    const store = new Map<string, Uint8Array>();
    const scheduler = createTestScheduler();
    const seam = createPersistenceIoFaultSeam();
    const pers: ReplicaPersistence = createMemoryPersistence({
      scheduler,
      schedule: TEST_SCHEDULE,
      writeSnapshot: async (key, snapshot) => {
        store.set(key, snapshot.slice());
      },
      readSnapshot: async (key) => store.get(key),
      deleteSnapshot: async (key) => {
        store.delete(key);
      },
      wrapIo: seam.wrap,
    });
    const handle = await pers.createDoc(ALICE, 'ns-store-d', makeDoc('ns-store-d'));
    await handle.release();
    await scheduler.advanceBy(TEST_SCHEDULE.debounceMs + 1);
    expect(store.has(keyOf(ALICE, 'ns-store-d'))).toBe(true);

    const ioDown = new Error('removeKey io down (EACCES)');
    seam.faults.failNextRemoveKey(ioDown);
    const first = await pers.deleteDoc(ALICE, 'ns-store-d').then(
      () => null,
      (err: unknown) => err,
    );
    expect(first).toBeInstanceOf(DocDeleteOperationalError);
    expect(first).toMatchObject({ code: 'DOC_DELETE_OPERATIONAL' });
    expect((first as { cause: unknown }).cause).toBe(ioDown);

    // 重试收敛（删除单调性：只前进不回退）
    await expect(pers.deleteDoc(ALICE, 'ns-store-d')).resolves.toEqual({ ok: true });
    expect(store.has(keyOf(ALICE, 'ns-store-d'))).toBe(false);
    await (pers as unknown as { dispose(): Promise<void> }).dispose();
  });

  it('P3e Memory deleteSnapshot hook 纪律：主 mirror + hook store 双清（主键直传）', async () => {
    const store = new Map<string, Uint8Array>();
    const scheduler = createTestScheduler();
    const deleteCalls: string[] = [];
    const pers: ReplicaPersistence = createMemoryPersistence({
      scheduler,
      schedule: TEST_SCHEDULE,
      writeSnapshot: async (key, snapshot) => {
        store.set(key, snapshot.slice());
      },
      readSnapshot: async (key) => store.get(key),
      deleteSnapshot: async (key) => {
        deleteCalls.push(key);
        store.delete(key);
      },
    });
    const handle = await pers.createDoc(ALICE, 'ns-store-e', makeDoc('ns-store-e'));
    await handle.release();
    await scheduler.advanceBy(TEST_SCHEDULE.debounceMs + 1);
    await pers.deleteDoc(ALICE, 'ns-store-e');
    expect(deleteCalls).toEqual([keyOf(ALICE, 'ns-store-e')]); // hook 收到主键直传
    expect(store.has(keyOf(ALICE, 'ns-store-e'))).toBe(false);
    await (pers as unknown as { dispose(): Promise<void> }).dispose();
  });
});

describe('issue #228 — deleteDoc 终局与能力门（T-P4）', () => {
  it('P4a disposed → DocDeleteFatalError("lifecycle-disposed")（committed:false）', async () => {
    const store = new Map<string, Uint8Array>();
    const scheduler = createTestScheduler();
    const pers: ReplicaPersistence = createMemoryPersistence({
      scheduler,
      schedule: TEST_SCHEDULE,
      writeSnapshot: async (key, snapshot) => {
        store.set(key, snapshot.slice());
      },
      readSnapshot: async (key) => store.get(key),
      deleteSnapshot: async (key) => {
        store.delete(key);
      },
    });
    await (pers as unknown as { dispose(): Promise<void> }).dispose();
    const err = await pers.deleteDoc(ALICE, 'ns-disposed').then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DocDeleteFatalError);
    expect(err).toMatchObject({ code: 'DOC_DELETE_FATAL', phase: 'lifecycle-disposed', committed: false });
  });

  it('P4b removeKey 缺席（wrapIo 剥离）→ capability gate bare loud Error（稳定 message 无回显）', async () => {
    const store = new Map<string, Uint8Array>();
    const scheduler = createTestScheduler();
    const pers = createMemoryPersistence({
      scheduler,
      schedule: TEST_SCHEDULE,
      writeSnapshot: async (key, snapshot) => {
        store.set(key, snapshot.slice());
      },
      readSnapshot: async (key) => store.get(key),
      deleteSnapshot: async (key) => {
        store.delete(key);
      },
      wrapIo: (io: PersistenceIO) => {
        const { removeKey: _removed, ...stripped } = io;
        void _removed;
        return stripped as PersistenceIO;
      },
    });
    await expect(pers.deleteDoc(ALICE, 'ns-gate')).rejects.toThrow(/removeKey/);
    await (pers as unknown as { dispose(): Promise<void> }).dispose();
  });

  it('P4c io.removeKey 同步 throw（PersistenceIO 契约违约）→ DocDeleteFatalError("adapter-violation")', async () => {
    const store = new Map<string, Uint8Array>();
    const scheduler = createTestScheduler();
    const pers = createMemoryPersistence({
      scheduler,
      schedule: TEST_SCHEDULE,
      writeSnapshot: async (key, snapshot) => {
        store.set(key, snapshot.slice());
      },
      readSnapshot: async (key) => store.get(key),
      deleteSnapshot: async (key) => {
        store.delete(key);
      },
      wrapIo: (io: PersistenceIO) => ({
        ...io,
        // 契约违约注入：非 async 同步 throw（真实 adapter 永不如此）
        removeKey: () => {
          throw new Error('sync-throw violation');
        },
      }),
    });
    const handle = await pers.createDoc(ALICE, 'ns-violation', makeDoc('ns-violation'));
    await handle.release();
    await scheduler.advanceBy(TEST_SCHEDULE.debounceMs + 1);
    const err = await pers.deleteDoc(ALICE, 'ns-violation').then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DocDeleteFatalError);
    expect(err).toMatchObject({ code: 'DOC_DELETE_FATAL', phase: 'adapter-violation', committed: false });
    // 违约后 deleting cell 已被 identity 守卫清理——后续（合规 wrap 层）重试可收敛：
    // 本 fixture 的违约 wrap 恒违约，改经 seam 语义由 P3d 覆盖；此处仅断言 cell 清理
    // 不阻塞再次调用（仍走 gate → 同违约拒绝，绝不 busy-loop / 假 ok）。
    const again = await pers.deleteDoc(ALICE, 'ns-violation').then(
      () => null,
      (e: unknown) => e,
    );
    expect(again).toBeInstanceOf(DocDeleteFatalError);
    await (pers as unknown as { dispose(): Promise<void> }).dispose();
  });
});

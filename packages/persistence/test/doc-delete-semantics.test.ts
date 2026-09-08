/**
 * issue #228（ADR-0006 修订节）Persistence 逻辑删除语义套件（T-P1/T-P2）：
 *
 * - P1a 幂等 absent：从不存在的 key deleteDoc → {ok:true}（删除不是存在性预言）；
 * - P1b 双 adapter 一致：Memory/File 同契约（File 存储面另见 doc-delete-storage）；
 * - P1c active handle → DocDeleteActiveHandleError（诚实拒绝），release 后重试
 *   {ok:true}——删除是「仅在无有效 handle 时执行」；
 * - P1d delete × loadDoc 同 key 交错（M1 绿锚）：delete claim 持守期 loadDoc
 *   等待 → removeKey 结算后重读 → null（绝不制造伪数据、绝不覆写 deleting cell）；
 * - P1e delete 在途期 createDoc 同 key：等待删除结算后正常新建（删除后重建 = 新
 *   namespace 合法语义，非伪 duplicate——M1 create 消费方绿锚）；
 * - P2a 复活向量 (i) 定时器取消：零-handle dirty entry（debounce/maxDirty 已武装、
 *   未点火）→ deleteDoc → 推进虚拟钟越过 maxDirtyMs → 快照仍缺席（定时器被取消、
 *   无重建、scheduler.pending() === 0）；
 * - P2b 在途 flush（已点火、越过入口门）：deleteDoc 等待 flush 结算 → removeKey
 *   → 无重建、无第三次写（SA2 M2 次序绿锚：cancel-then-evict）。
 *
 * 锚定纪律：真实 yjs / 真实 MemoryPersistence（hook store 字节级）+ 真实
 * FilePersistence（mkdtemp rootDir）；wrapIo 仅作故障/观测注入；fake scheduler
 * 脚本化；零 real sleep（File 侧 deadline 式 waitFor 与既有套件同款）。
 */
import { afterAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createMemoryPersistence,
  DocDeleteActiveHandleError,
  FilePersistence,
  type PersistenceIO,
  type ReplicaPersistence,
  type User,
} from '@nomicore/persistence';
import {
  createPersistenceIoFaultSeam,
  createTestScheduler,
  type PersistenceIoFaultSeam,
  type TestScheduler,
} from '@nomicore/persistence/testing';

const ALICE: User = Object.freeze({ userId: 'u-alice' });
const TEST_SCHEDULE = { debounceMs: 10, maxDirtyMs: 50 };

function keyOf(owner: User, docId: string): string {
  return `${owner.userId}\u0000${docId}`;
}

function makeDoc(docId: string, n = 1): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('META').set('docId', docId);
  doc.getMap('ROOT').set('n', n);
  return doc;
}

interface MemoryFixture {
  readonly persistence: ReplicaPersistence;
  readonly scheduler: TestScheduler;
  readonly store: Map<string, Uint8Array>;
  readonly seam: PersistenceIoFaultSeam;
  dispose(): Promise<void>;
}

/** hook store 字节级 fixture（与 phase5-bootstrap-r2 套件同款纪律）。 */
function makeMemoryFixture(wrap?: (io: PersistenceIO) => PersistenceIO): MemoryFixture {
  const store = new Map<string, Uint8Array>();
  const scheduler = createTestScheduler();
  const seam = createPersistenceIoFaultSeam();
  const persistence: ReplicaPersistence = createMemoryPersistence({
    scheduler,
    schedule: TEST_SCHEDULE,
    writeSnapshot: async (key, snapshot) => {
      store.set(key, snapshot.slice());
    },
    readSnapshot: async (key) => store.get(key),
    deleteSnapshot: async (key) => {
      store.delete(key);
    },
    wrapIo: wrap ?? seam.wrap,
  });
  return {
    persistence,
    scheduler,
    store,
    seam,
    dispose: async () => {
      await (persistence as unknown as { dispose(): Promise<void> }).dispose();
    },
  };
}

const tempRootDirs = new Set<string>();
function makeRootDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomicore-doc-delete-'));
  tempRootDirs.add(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempRootDirs) fs.rmSync(dir, { recursive: true, force: true });
});

async function makeFileFixture(): Promise<{ persistence: FilePersistence; scheduler: TestScheduler }> {
  const scheduler = createTestScheduler();
  const persistence = new FilePersistence({ rootDir: makeRootDir(), scheduler, schedule: TEST_SCHEDULE });
  return { persistence, scheduler };
}

/** 生成一份已提交快照（create + release + 推进 scheduler 触发 flush）。 */
async function commitDoc(persistence: ReplicaPersistence, scheduler: TestScheduler, docId: string): Promise<void> {
  const handle = await persistence.createDoc(ALICE, docId, makeDoc(docId));
  await handle.release();
  await scheduler.advanceBy(TEST_SCHEDULE.debounceMs + 1);
}

describe('issue #228 — deleteDoc 语义（ADR-0006 修订节；T-P1）', () => {
  it('P1a 幂等 absent：从不存在的 key deleteDoc → {ok:true}（删除不是存在性预言）', async () => {
    const fx = makeMemoryFixture();
    await expect(fx.persistence.deleteDoc(ALICE, 'ns-absent')).resolves.toEqual({ ok: true });
    await expect(fx.persistence.deleteDoc(ALICE, 'ns-absent')).resolves.toEqual({ ok: true });
    await fx.dispose();
  });

  it('P1b 双 adapter 一致性：Memory 与 File 删除后 loadDoc → null', async () => {
    const mem = makeMemoryFixture();
    await commitDoc(mem.persistence, mem.scheduler, 'ns-dual-mem');
    expect(mem.store.has(keyOf(ALICE, 'ns-dual-mem'))).toBe(true);
    await mem.persistence.deleteDoc(ALICE, 'ns-dual-mem');
    expect(await mem.persistence.loadDoc(ALICE, 'ns-dual-mem')).toBeNull();
    await mem.dispose();

    const file = await makeFileFixture();
    await commitDoc(file.persistence, file.scheduler, 'ns-dual-file');
    await file.persistence.deleteDoc(ALICE, 'ns-dual-file');
    expect(await file.persistence.loadDoc(ALICE, 'ns-dual-file')).toBeNull();
    await file.persistence.dispose();
  });

  it('P1c active handle → DocDeleteActiveHandleError；release 后重试 {ok:true}', async () => {
    const fx = makeMemoryFixture();
    const handle = await fx.persistence.createDoc(ALICE, 'ns-active', makeDoc('ns-active'));
    await expect(fx.persistence.deleteDoc(ALICE, 'ns-active')).rejects.toBeInstanceOf(
      DocDeleteActiveHandleError,
    );
    await handle.release();
    await expect(fx.persistence.deleteDoc(ALICE, 'ns-active')).resolves.toEqual({ ok: true });
    expect(await fx.persistence.loadDoc(ALICE, 'ns-active')).toBeNull();
    await fx.dispose();
  });

  it('P1d delete × loadDoc 同 key 交错（M1 绿锚）：删除结算后 loadDoc 得 null、绝不伪数据', async () => {
    // removeKey 闸门 wrapIo：hold removeKey 直到 release——deterministic 交错窗口。
    let gateResolve: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      gateResolve = resolve;
    });
    let removeKeyEnteredResolve: () => void = () => {};
    const removeKeyEntered = new Promise<void>((resolve) => {
      removeKeyEnteredResolve = resolve;
    });
    const wrap: (io: PersistenceIO) => PersistenceIO = (io) => ({
      ...io,
      async removeKey(key, signal) {
        removeKeyEnteredResolve();
        await gate;
        if (io.removeKey === undefined) throw new Error('unreachable');
        await io.removeKey(key, signal);
      },
    });
    const fx = makeMemoryFixture(wrap);
    const handle = await fx.persistence.createDoc(ALICE, 'ns-interleave', makeDoc('ns-interleave'));
    handle.doc.getMap('ROOT').set('n', 2);
    await fx.persistence.saveDoc(handle);
    await handle.release();
    await fx.scheduler.advanceBy(TEST_SCHEDULE.debounceMs + 1); // committed
    expect(fx.store.has(keyOf(ALICE, 'ns-interleave'))).toBe(true);

    const deleting = fx.persistence.deleteDoc(ALICE, 'ns-interleave');
    await removeKeyEntered; // delete 已置 deleting claim、removeKey 持守中
    const loading = fx.persistence.loadDoc(ALICE, 'ns-interleave'); // 等待 claim → 结算后 null
    gateResolve();
    await expect(deleting).resolves.toEqual({ ok: true });
    expect(await loading).toBeNull();
    expect(fx.store.has(keyOf(ALICE, 'ns-interleave'))).toBe(false);
    await fx.dispose();
  });

  it('P1e delete 在途期 createDoc：等待删除结算后新建成功（删除后重建合法语义，M1 create 消费方绿锚）', async () => {
    let gateResolve: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      gateResolve = resolve;
    });
    let removeKeyEnteredResolve: () => void = () => {};
    const removeKeyEntered = new Promise<void>((resolve) => {
      removeKeyEnteredResolve = resolve;
    });
    const wrap: (io: PersistenceIO) => PersistenceIO = (io) => ({
      ...io,
      async removeKey(key, signal) {
        removeKeyEnteredResolve();
        await gate;
        if (io.removeKey === undefined) throw new Error('unreachable');
        await io.removeKey(key, signal);
      },
    });
    const fx = makeMemoryFixture(wrap);
    await commitDoc(fx.persistence, fx.scheduler, 'ns-recreate');
    const deleting = fx.persistence.deleteDoc(ALICE, 'ns-recreate');
    await removeKeyEntered;
    const creating = fx.persistence.createDoc(ALICE, 'ns-recreate', makeDoc('ns-recreate', 7));
    gateResolve();
    await expect(deleting).resolves.toEqual({ ok: true });
    const recreated = await creating; // 删除结算 → 探读缺席 → 正常新建（绝不伪 duplicate）
    recreated.doc.getMap('ROOT').set('n', 8);
    await fx.persistence.saveDoc(recreated);
    await recreated.release();
    await fx.scheduler.advanceBy(TEST_SCHEDULE.debounceMs + 1);
    expect(fx.store.has(keyOf(ALICE, 'ns-recreate'))).toBe(true); // 重建后的新快照
    await fx.dispose();
  });
});

describe('issue #228 — deleteDoc 复活向量封堵（ADR-0006 修订节；T-P2）', () => {
  it('P2a 复活向量 (i)：零-handle dirty entry 定时器取消——越过 maxDirtyMs 快照仍缺席', async () => {
    const fx = makeMemoryFixture();
    const handle = await fx.persistence.createDoc(ALICE, 'ns-resurrect-a', makeDoc('ns-resurrect-a'));
    handle.doc.getMap('ROOT').set('n', 99); // dirty
    await fx.persistence.saveDoc(handle); // 武装 debounce + maxDirty（未点火）
    await handle.release();
    expect(fx.scheduler.pending()).toBeGreaterThan(0);

    await fx.persistence.deleteDoc(ALICE, 'ns-resurrect-a');
    expect(fx.store.has(keyOf(ALICE, 'ns-resurrect-a'))).toBe(false);
    expect(fx.scheduler.pending()).toBe(0); // 全部定时器已取消

    await fx.scheduler.advanceBy(TEST_SCHEDULE.maxDirtyMs * 3); // 虚拟钟越过上限
    expect(fx.store.has(keyOf(ALICE, 'ns-resurrect-a'))).toBe(false);
    expect(await fx.persistence.loadDoc(ALICE, 'ns-resurrect-a')).toBeNull();
    await fx.dispose();
  });

  it('P2b 在途 flush（已点火、越过入口门）：deleteDoc 等待结算 → removeKey → 无第三次写', async () => {
    const store = new Map<string, Uint8Array>();
    const scheduler = createTestScheduler();
    const seam = createPersistenceIoFaultSeam();
    let writeCount = 0;
    const pers: ReplicaPersistence = createMemoryPersistence({
      scheduler,
      schedule: TEST_SCHEDULE,
      writeSnapshot: async (key, snapshot) => {
        writeCount += 1;
        store.set(key, snapshot.slice());
      },
      readSnapshot: async (key) => store.get(key),
      deleteSnapshot: async (key) => {
        store.delete(key);
      },
      wrapIo: seam.wrap,
    });
    // createDoc 自身提交 = write #1；随后同 handle 标 dirty（flush #2 待点火）
    const handle = await pers.createDoc(ALICE, 'ns-resurrect-b', makeDoc('ns-resurrect-b', 1));
    handle.doc.getMap('ROOT').set('n', 2);
    await pers.saveDoc(handle);
    await handle.release(); // 零 handle、dirty——entry 保留、debounce/maxDirty 武装
    expect(writeCount).toBe(1);
    expect(scheduler.pending()).toBeGreaterThan(0);

    const hold = seam.faults.holdNextWriteBeforeCommit();
    const advancing = scheduler.advanceBy(TEST_SCHEDULE.debounceMs); // 触发 debounce → flush #2
    await hold.entered;
    expect(writeCount).toBe(1); // flush #2 已越过入口门但提交段持守

    const deleting = pers.deleteDoc(ALICE, 'ns-resurrect-b'); // settle 等待在途 flush 结算
    hold.release(); // flush #2 提交 → 通知 waiter → settle 重读 → cancel-then-evict → removeKey
    await advancing;
    await expect(deleting).resolves.toEqual({ ok: true });
    expect(writeCount).toBe(2); // 恰两次提交（create 提交 + 在途 flush）——无第三次写
    expect(store.has(keyOf(ALICE, 'ns-resurrect-b'))).toBe(false);
    expect(scheduler.pending()).toBe(0);
    await scheduler.advanceBy(TEST_SCHEDULE.maxDirtyMs * 3); // 越过上限仍无重建
    expect(store.has(keyOf(ALICE, 'ns-resurrect-b'))).toBe(false);
    await (pers as unknown as { dispose(): Promise<void> }).dispose();
  });
});

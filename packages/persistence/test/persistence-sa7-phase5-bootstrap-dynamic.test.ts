/**
 * SA7 动态验证 — issue #133（Phase 5: bootstrap import, archive, and guarded
 * replica reset）persistence 侧活链路攻击。
 *
 * 覆盖（对应 SA7 任务简报重点 1/4/5/6/7）：
 * - §1 settle 排空活性（BLOCKER-1 动态实证）：1a 零-handle dirty → 立即归档（强制
 *   flush 跳过 debounce、归档含最后写入值）；1b degraded 回退窗 × 归档（尊重回退、
 *   无热循环、排空后成功）；1c dispose × 在途 flush settle 竞态（bare disposed 有限
 *   结算）；1d degraded retry 武装 + 零在途 flush + dispose 三重交错（SA2 BLOCKER-1
 *   原始脚本的动态版）。
 * - §4 Memory dispose 窗口（SA4 F-7-i / SA2 INFO-R2-1）：writeArchive resolve 后
 *   remove 前 dispose 的 drain-then-clear 次序、committed:true fatal、新实例重试收敛；
 *   relocate-remove 失败（hook 拒绝）→ committed:true fatal + 重试收敛单副本归档。
 * - §5 File 归档崩溃恢复实机演练（真实 tmpdir / 真实 fs rename）：归档后新实例恢复、
 *   tmp 残留恢复、双副本窗口收敛+幂等、owner 分区实机；F-7-ii dispose × relocate-remove
 *   双窗口（rm 已进入→ok:true 落地 / abort 后 remove 抛错→committed:true fatal）。
 * - §6 identity 守卫动态边界：持久身份演进（epoch 1→2 落盘）后以旧 epoch 归档拒绝 +
 *   文档完好；导入后立即归档（未 flush 窗口）守卫读到导入字节身份。
 * - §7 类型/公共面动态守卫：主入口运行时可枚举键无禁词面（removeDoc/deleteDoc/
 *   listDocs 等）；实例原型面不含删除/枚举词根。
 *
 * 真实性纪律：真实 yjs / 真实 MemoryPersistence·FilePersistence（真实 tmpdir、真实
 * fs）；fault 注入仅经 createPersistenceIoFaultSeam 或自定义 wrapIo（设计 §4.6 规格
 * 化面）；零 real sleep（fake scheduler + advanceBy；真实异步排空用微任务 drain /
 * barrier，不用定时等待）；全部竞态用例包 withTimeout（超时即失败，不许静默挂起）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DocArchiveDuplicateError,
  DocArchiveFatalError,
  DocArchiveIdentityError,
  FilePersistence,
  createMemoryPersistence,
  type DocHandle,
  type DocPersistence,
  type MemoryPersistenceOptions,
  type PersistenceIO,
  type ReplicationIdentityRef,
  type User,
} from '@nomicore/persistence';
import {
  createPersistenceIoFaultSeam,
  createTestScheduler,
  withTimeout,
  type TestScheduler,
} from '@nomicore/persistence/testing';

// ═══════════════════════════════ 基础设施 ═══════════════════════════════

const ALICE: User = Object.freeze({ userId: 'u-alice' });
const BOB: User = Object.freeze({ userId: 'u-bob' });
const DOC = 'ns-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ID_A = 'a'.repeat(32);
const KEY = `${ALICE.userId}\u0000${DOC}`;
const EXPECT_A: ReplicationIdentityRef = { replicationId: ID_A, replicationEpoch: 1 };

/** 归档/导入能力面（契约成员；cast 仅类型面）。 */
interface ArchiveCapable {
  readonly archiveDoc: (
    owner: User,
    docId: string,
    expected: ReplicationIdentityRef,
  ) => Promise<Readonly<{ ok: true }>>;
  readonly importDoc: (owner: User, docId: string, doc: Y.Doc) => Promise<DocHandle>;
}

type CapablePersistence = DocPersistence & ArchiveCapable;

function asCapable(p: DocPersistence): CapablePersistence {
  return p as unknown as CapablePersistence;
}

function makeDoc(
  docId: string,
  opts: { replicationId?: string; replicationEpoch?: number; n?: number } = {},
): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('META').set('docId', docId);
  if (opts.replicationId !== undefined) doc.getMap('META').set('replicationId', opts.replicationId);
  if (opts.replicationEpoch !== undefined) doc.getMap('META').set('replicationEpoch', opts.replicationEpoch);
  doc.getMap('ROOT').set('n', opts.n ?? 42);
  return doc;
}

async function drainMicrotasks(depth = 60): Promise<void> {
  for (let i = 0; i < depth; i += 1) await Promise.resolve();
}

async function rejectionOf<T>(promise: Promise<T>): Promise<unknown> {
  return promise.then(
    () => { throw new Error('expected the operation to reject') },
    (reason: unknown) => reason,
  );
}

function decodeToDoc(bytes: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bytes);
  return doc;
}

// ═══════════════════════════════ 自定义 wrapIo 探针（设计 §4.6 规格化面） ═══════════════════════════════

interface HoldGate {
  readonly entered: Promise<void>;
  release(): void;
}

/**
 * io 级探针 + 故障注入（wrapIo around-seam）：记录调用序（log 为全序事件名表）、
 * write 尝试计数（含 createDoc 初始写——断言一律用相对基线）、writeArchive 字节与
 * remove 调用；注入面 = 持续 N 次 write 拒绝（pre-commit，store 不变——PersistenceIO
 * 契约）、writeArchive 提交段完成后挂起（dispose-窗口构造）、remove 内层完成后挂起
 * （F-7-ii「rm 已进入→完整执行」窗口构造）。全部禁同步 throw。
 */
interface IoProbe {
  readonly log: string[];
  readonly writeAttempts: number;
  readonly archiveWrites: Array<{ key: string; bytes: Uint8Array }>;
  readonly removes: string[];
  failNextWrites(count: number, reason: unknown): void;
  holdAfterArchiveCommit(): HoldGate;
  holdAfterRemoveDone(): HoldGate;
  wrap(io: PersistenceIO): PersistenceIO;
}

function makeIoProbe(): IoProbe {
  const log: string[] = [];
  const archiveWrites: Array<{ key: string; bytes: Uint8Array }> = [];
  const removes: string[] = [];
  let writeAttempts = 0;
  let failRemaining = 0;
  let failReason: unknown = undefined;
  let archiveHold: { resolveEntered: () => void; gate: Promise<void> } | undefined;
  let removeHold: { resolveEntered: () => void; gate: Promise<void> } | undefined;

  function armHold(): HoldGate & { gate: Promise<void>; resolveEntered: () => void } {
    let resolveEntered!: () => void;
    const entered = new Promise<void>((resolve) => { resolveEntered = resolve });
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => { releaseGate = resolve });
    return { entered, gate, resolveEntered, release: releaseGate };
  }

  return {
    log,
    get writeAttempts() { return writeAttempts },
    archiveWrites,
    removes,
    failNextWrites(count, reason) {
      failRemaining = count;
      failReason = reason;
    },
    holdAfterArchiveCommit() {
      const armed = armHold();
      archiveHold = { resolveEntered: armed.resolveEntered, gate: armed.gate };
      return { entered: armed.entered, release: armed.release };
    },
    holdAfterRemoveDone() {
      const armed = armHold();
      removeHold = { resolveEntered: armed.resolveEntered, gate: armed.gate };
      return { entered: armed.entered, release: armed.release };
    },
    wrap(io) {
      return {
        async read(key, signal) {
          return await io.read(key, signal);
        },
        async write(key, snapshot, signal) {
          writeAttempts += 1;
          if (failRemaining > 0) {
            failRemaining -= 1;
            throw failReason;
          }
          await io.write(key, snapshot, signal);
        },
        async writeArchive(key, snapshot, signal) {
          await io.writeArchive!(key, snapshot, signal);
          log.push('archive-committed');
          archiveWrites.push({ key, bytes: snapshot.slice() });
          const held = archiveHold;
          if (held !== undefined) {
            archiveHold = undefined;
            log.push('archive-hold-entered');
            held.resolveEntered();
            await held.gate;
            log.push('archive-hold-released');
          }
        },
        async remove(key, signal) {
          log.push('remove-entered');
          await io.remove!(key, signal);
          log.push('remove-done');
          removes.push(key);
          const held = removeHold;
          if (held !== undefined) {
            removeHold = undefined;
            log.push('remove-hold-entered');
            held.resolveEntered();
            await held.gate;
            log.push('remove-hold-released');
          }
        },
      };
    },
  };
}

// ═══════════════════════════════ Memory 夹具（hook store + 探针） ═══════════════════════════════

interface MemoryDynFixture {
  readonly persistence: CapablePersistence;
  readonly scheduler: TestScheduler;
  readonly store: Map<string, Uint8Array>;
  readonly probe: IoProbe;
  /** 共享同一外部 hook store 的新实例（重启语义）。 */
  makeRestart(): MemoryDynFixture;
  dispose(): Promise<void>;
}

function makeMemoryDynFixture(
  sharedStore?: Map<string, Uint8Array>,
  opts: { failFirstDelete?: number } = {},
): MemoryDynFixture {
  const store = sharedStore ?? new Map<string, Uint8Array>();
  const scheduler = createTestScheduler();
  const probe = makeIoProbe();
  let deleteFailures = opts.failFirstDelete ?? 0;
  const persistence = createMemoryPersistence({
    scheduler,
    schedule: { debounceMs: 1, maxDirtyMs: 1 },
    writeSnapshot: async (key, snapshot) => {
      store.set(key, snapshot.slice());
    },
    readSnapshot: async (key) => store.get(key),
    deleteSnapshot: async (key: string) => {
      if (deleteFailures > 0) {
        deleteFailures -= 1;
        throw new Error(`injected delete failure (remaining ${deleteFailures})`);
      }
      store.delete(key);
    },
    wrapIo: probe.wrap,
  } as MemoryPersistenceOptions);
  return {
    persistence: asCapable(persistence),
    scheduler,
    store,
    probe,
    makeRestart: () => makeMemoryDynFixture(store),
    dispose: async () => {
      await (persistence as unknown as { dispose(): Promise<void> }).dispose();
      probe.log.push('dispose-returned');
    },
  };
}

// ═══════════════════════════════ File 夹具（真实 tmpdir + 探针；可共享 rootDir 重启） ═══════════════════════════════

const fileRootDirs = new Set<string>();
afterEach(async () => {
  await Promise.all(
    [...fileRootDirs].map((root) => fsp.rm(root, { recursive: true, force: true })),
  );
  fileRootDirs.clear();
});

interface FileDynFixture {
  readonly persistence: CapablePersistence;
  readonly scheduler: TestScheduler;
  readonly probe: IoProbe;
  readonly rootDir: string;
  readonly mainPath: string;
  readonly archivePath: string;
  readonly archiveTmpPath: string;
  dispose(): Promise<void>;
}

function makeFileDynFixture(opts: { probe?: IoProbe; rootDir?: string } = {}): FileDynFixture {
  const rootDir = opts.rootDir ?? path.join(
    os.tmpdir(),
    `nomicore-sa7-p133-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
  );
  fileRootDirs.add(rootDir);
  const scheduler = createTestScheduler();
  const probe = opts.probe ?? makeIoProbe();
  const persistence = new FilePersistence({
    rootDir,
    scheduler,
    schedule: { debounceMs: 1, maxDirtyMs: 1 },
    wrapIo: probe.wrap,
  });
  return {
    persistence: asCapable(persistence),
    scheduler,
    probe,
    rootDir,
    mainPath: path.join(rootDir, 'users', ALICE.userId, `${DOC}.snapshot`),
    archivePath: path.join(rootDir, 'archive', 'users', ALICE.userId, `${DOC}.snapshot`),
    archiveTmpPath: path.join(rootDir, 'archive', 'users', ALICE.userId, `${DOC}.snapshot.tmp`),
    dispose: async () => {
      await (persistence as unknown as { dispose(): Promise<void> }).dispose();
      probe.log.push('dispose-returned');
    },
  };
}

async function listFilesUnder(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const rel = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), `${rel}/`);
      else files.push(rel);
    }
  }
  await walk(rootDir, '');
  return files.sort();
}

async function fileState(target: string): Promise<'present' | 'absent'> {
  return await fsp.access(target).then(() => 'present', () => 'absent');
}

// ═══════════════════════════════ §1 settle 排空活性（BLOCKER-1 动态实证） ═══════════════════════════════

describe('SA7 §1 settle 排空活性（MemoryPersistence 真实链路）', () => {
  it('1a 零-handle dirty entry → 立即 archiveDoc：有限结算、强制 flush 跳过 debounce、归档含最后写入值', async () => {
    const fx = makeMemoryDynFixture();
    const handle = await fx.persistence.createDoc(ALICE, DOC, makeDoc(DOC, {
      replicationId: ID_A,
      replicationEpoch: 1,
      n: 1,
    }));
    const base = fx.probe.writeAttempts; // createDoc 初始写（已 committed）
    // 业务写：dirty 登记（debounce 武装，零 advanceBy）→ 释放 handle（零-handle dirty 窗口）
    handle.doc.getMap('ROOT').set('n', 77);
    await fx.persistence.saveDoc(handle);
    await handle.release();
    expect(fx.scheduler.pending()).toBeGreaterThan(0); // debounce/maxDirty 在武装（未被排空）

    // 立即归档：settle 必须强制即时 flush（跳过 debounce 定时器）→ 排空 → 归档
    const result = await withTimeout(
      fx.persistence.archiveDoc(ALICE, DOC, EXPECT_A),
      2_000,
      'archive over zero-handle dirty entry',
    );
    expect(result).toMatchObject({ ok: true });

    // 强制 flush 证据：恰一次 write 尝试即排空（未依赖任何 advanceBy）；归档字节含最后写入值
    expect(fx.probe.writeAttempts - base).toBe(1);
    expect(fx.probe.archiveWrites).toHaveLength(1);
    const archived = decodeToDoc(fx.probe.archiveWrites[0]!.bytes);
    expect(archived.getMap('ROOT').get('n')).toBe(77);
    expect(archived.getMap('META').get('replicationId')).toBe(ID_A);
    expect(archived.getMap('META').get('replicationEpoch')).toBe(1);
    // 主键已移除（外部 store + loadDoc → null）
    expect(fx.store.has(KEY)).toBe(false);
    expect(await fx.persistence.loadDoc(ALICE, DOC)).toBeNull();
    await fx.dispose();
  });

  it('1b degraded 回退窗 × archive：尊重回退（逐步重试、零热循环）→ 排空 → 最终成功且归档含最后写入值', async () => {
    const fx = makeMemoryDynFixture();
    const handle = await fx.persistence.createDoc(ALICE, DOC, makeDoc(DOC, {
      replicationId: ID_A,
      replicationEpoch: 1,
      n: 1,
    }));
    handle.doc.getMap('ROOT').set('n', 88);
    await fx.persistence.saveDoc(handle);
    await handle.release();
    const base = fx.probe.writeAttempts;

    // 进入 degraded：首次 flush 失败（debounce 触发）→ retry 武装（回退窗）
    fx.probe.failNextWrites(3, new Error('store down (bounded window)'));
    await fx.scheduler.advanceBy(1);
    await drainMicrotasks();
    expect(fx.probe.writeAttempts - base).toBe(1); // 首次尝试已失败、零自旋

    // 归档发起：settle 被动等待（retryTimer 武装 ⟺ degraded 回退窗），不得热循环
    const archiving = fx.persistence.archiveDoc(ALICE, DOC, EXPECT_A);
    void archiving.catch(() => {});
    await drainMicrotasks();
    expect(fx.probe.writeAttempts - base).toBe(1); // 等待窗内零新增尝试（无热循环）
    await drainMicrotasks();
    expect(fx.probe.writeAttempts - base).toBe(1); // 微任务排空不产生新尝试（时间未推进）

    // 逐步推进回退窗：每 advanceBy(1) 恰一次重试尝试（重试计数有界、按时间推进）
    await fx.scheduler.advanceBy(1);
    await drainMicrotasks();
    expect(fx.probe.writeAttempts - base).toBe(2);
    await drainMicrotasks();
    expect(fx.probe.writeAttempts - base).toBe(2);
    await fx.scheduler.advanceBy(1);
    await drainMicrotasks();
    expect(fx.probe.writeAttempts - base).toBe(3);
    // 第 4 次（failNextWrites(3) 已耗尽）成功 → waiter 通知 → settle 排空 → 归档完成
    await fx.scheduler.advanceBy(1);
    const result = await withTimeout(archiving, 2_000, 'archive after degraded window drains');
    expect(result).toMatchObject({ ok: true });
    expect(fx.probe.writeAttempts - base).toBe(4); // 3 失败 + 1 成功，恰四次（有界）
    expect(fx.scheduler.pending()).toBe(0);

    // 归档内容含最后写入值
    expect(fx.probe.archiveWrites).toHaveLength(1);
    const archived = decodeToDoc(fx.probe.archiveWrites[0]!.bytes);
    expect(archived.getMap('ROOT').get('n')).toBe(88);
    expect(fx.store.has(KEY)).toBe(false);
    expect(await fx.persistence.loadDoc(ALICE, DOC)).toBeNull();
    await fx.dispose();
  });

  it('1c dispose × settle（在途 flush）：archiveDoc bare disposed 有限结算、dispose 有限结算、零定时器残留', async () => {
    // seam（holdNextWriteBeforeCommit）+ 探针复合：seam 内层 hold、探针外层记录
    const store = new Map<string, Uint8Array>();
    const scheduler = createTestScheduler();
    const seam = createPersistenceIoFaultSeam();
    const probe = makeIoProbe();
    const persistence = createMemoryPersistence({
      scheduler,
      schedule: { debounceMs: 1, maxDirtyMs: 1 },
      writeSnapshot: async (key, snapshot) => { store.set(key, snapshot.slice()); },
      readSnapshot: async (key) => store.get(key),
      deleteSnapshot: async (key: string) => { store.delete(key); },
      wrapIo: (base) => probe.wrap(seam.wrap(base)),
    } as MemoryPersistenceOptions);
    const capable = asCapable(persistence);
    const handle = await capable.createDoc(ALICE, DOC, makeDoc(DOC, {
      replicationId: ID_A,
      replicationEpoch: 1,
    }));
    handle.doc.getMap('ROOT').set('n', 6);
    await capable.saveDoc(handle);
    await handle.release();
    const base = probe.writeAttempts;

    // settle 的强制 flush 进入 pre-commit hold（标准 fault seam 注入）
    const hold = seam.faults.holdNextWriteBeforeCommit();
    const archiving = capable.archiveDoc(ALICE, DOC, EXPECT_A);
    void archiving.catch(() => {});
    await withTimeout(hold.entered, 2_000, 'forced flush to enter pre-commit hold');
    expect(probe.writeAttempts - base).toBe(1); // 在途 flush 恰一次

    // dispose 竞态：flush 在途 → dispose → abort → flush 拒绝 → waiter 通知（通知点 1）
    const disposing = (async () => {
      await (persistence as unknown as { dispose(): Promise<void> }).dispose();
      probe.log.push('dispose-returned');
    })();
    hold.release();
    const [archiveSettlement, disposeSettlement] = await Promise.all([
      withTimeout(rejectionOf(archiving), 2_000, 'archive to settle during dispose'),
      withTimeout(disposing, 2_000, 'dispose to settle'),
    ] as [Promise<unknown>, Promise<void>]);
    expect(disposeSettlement).toBeUndefined();

    // bare disposed 通道（非 typed 归档四分类）；有限结算且非超时
    expect(archiveSettlement).toBeInstanceOf(Error);
    expect((archiveSettlement as Error).message).toMatch(/disposed/);
    expect(archiveSettlement).not.toBeInstanceOf(DocArchiveFatalError);
    expect(archiveSettlement).not.toBeInstanceOf(DocArchiveIdentityError);
    expect(scheduler.pending()).toBe(0);
    expect(probe.log).not.toContain('archive-committed'); // 归档提交段从未执行
  });

  it('1d 三重交错（SA2 BLOCKER-1 原始脚本动态版）：degraded retry 武装 + 零在途 flush + dispose → 一切有限结算', async () => {
    const fx = makeMemoryDynFixture();
    const handle = await fx.persistence.createDoc(ALICE, DOC, makeDoc(DOC, {
      replicationId: ID_A,
      replicationEpoch: 1,
    }));
    handle.doc.getMap('ROOT').set('n', 9);
    await fx.persistence.saveDoc(handle);
    await handle.release();
    const base = fx.probe.writeAttempts;

    // degraded retry 武装 + 零在途 flush：持续失败 → 首次 flush 失败 → retry 武装
    fx.probe.failNextWrites(999, new Error('store permanently down'));
    await fx.scheduler.advanceBy(1);
    await drainMicrotasks();
    expect(fx.probe.writeAttempts - base).toBe(1);
    expect(fx.scheduler.pending()).toBeGreaterThan(0); // retry timer 在武装

    // 归档 settle：被动等待（retryTimer 武装）——不强制 flush、不热循环
    const archiving = fx.persistence.archiveDoc(ALICE, DOC, EXPECT_A);
    void archiving.catch(() => {});
    await drainMicrotasks();
    expect(fx.probe.writeAttempts - base).toBe(1); // 零在途 flush（等待窗内零新尝试）

    // dispose：clearTimers 取消 retry + 同步段通知 waiters（通知点 2）→ 双方有限结算
    const [archiveSettlement] = await Promise.all([
      withTimeout(rejectionOf(archiving), 2_000, 'archive settle at dispose (armed retry, no in-flight flush)'),
      withTimeout(fx.dispose(), 2_000, 'dispose over armed-retry settle waiter'),
    ] as [Promise<unknown>, Promise<void>]);

    expect(archiveSettlement).toBeInstanceOf(Error);
    expect((archiveSettlement as Error).message).toMatch(/disposed/); // bare disposed 收口（INV-15）
    expect(archiveSettlement).not.toBeInstanceOf(DocArchiveFatalError);
    expect(fx.probe.writeAttempts - base).toBe(1); // 死亡瞬间零额外重试（回退被尊重到底）
    expect(fx.scheduler.pending()).toBe(0); // 定时器全清
    expect(fx.probe.log).not.toContain('archive-committed');
    expect(fx.probe.log).not.toContain('remove-entered');
  });
});

// ═══════════════════════════════ §4 Memory dispose 窗口（F-7-i / INFO-R2-1） ═══════════════════════════════

describe('SA7 §4 Memory dispose 窗口（F-7-i：writeArchive resolve → remove 前 dispose）', () => {
  it('4a drain-then-clear 次序 + committed:true fatal + 外部主键未删 + 新实例重试收敛', async () => {
    const fx = makeMemoryDynFixture();
    const handle = await fx.persistence.createDoc(ALICE, DOC, makeDoc(DOC, {
      replicationId: ID_A,
      replicationEpoch: 1,
      n: 33,
    }));
    await handle.release(); // 干净零-handle entry 即时驱逐；store 已持 committed 字节

    // writeArchive 提交段完成（archiveSnapshots 已写入）后、remove 前挂起
    const hold = fx.probe.holdAfterArchiveCommit();
    const archiving = fx.persistence.archiveDoc(ALICE, DOC, EXPECT_A);
    void archiving.catch(() => {});
    await withTimeout(hold.entered, 2_000, 'writeArchive commit then hold');

    // dispose 窗口命中：drain-then-clear（core.dispose 的 allSettled 先结算被 track 的
    // 归档提交段，archiveSnapshots 写入先于 clear() 生效）
    const disposing = fx.dispose();
    hold.release();
    const [err] = await Promise.all([
      withTimeout(rejectionOf(archiving), 2_000, 'archive settle in dispose window'),
      withTimeout(disposing, 2_000, 'dispose in archive window'),
    ] as [Promise<unknown>, Promise<void>]);

    // remove 入口 abort 门 → committed:true fatal（对提交瞬间为真——归档区已持字节）
    expect(err).toBeInstanceOf(DocArchiveFatalError);
    expect((err as DocArchiveFatalError).phase).toBe('relocate-remove');
    expect((err as DocArchiveFatalError).committed).toBe(true);
    // drain-then-clear 次序证据：archive 提交先于 dispose 返回（clear 后置）
    expect(fx.probe.log.indexOf('archive-committed')).toBeLessThan(fx.probe.log.indexOf('dispose-returned'));
    expect(fx.probe.log).not.toContain('remove-done'); // remove 提交段未执行
    // 外部视角：主键未删（归档未发生、文档原样）——重启恢复语义诚实
    expect(fx.store.has(KEY)).toBe(true);

    // 新实例重试收敛：guard-read 见主键 → 身份复验 → 再归档 → 删主键（单副本归档）
    const restart = fx.makeRestart();
    const retried = await withTimeout(
      restart.persistence.archiveDoc(ALICE, DOC, EXPECT_A),
      2_000,
      'restart instance archive retry convergence',
    );
    expect(retried).toMatchObject({ ok: true });
    expect(fx.store.has(KEY)).toBe(false);
    expect(await restart.persistence.loadDoc(ALICE, DOC)).toBeNull();
    expect(restart.probe.removes).toEqual([KEY]);
    await restart.dispose();
  });

  it('4b relocate-remove 失败（deleteSnapshot hook 拒绝）→ committed:true fatal + 重试收敛为单副本归档', async () => {
    // 一次性 remove 失败（hook 在任何 side effect 前拒绝——PersistenceIO 契约形态）
    const fx = makeMemoryDynFixture(undefined, { failFirstDelete: 1 });
    const handle = await fx.persistence.createDoc(ALICE, DOC, makeDoc(DOC, {
      replicationId: ID_A,
      replicationEpoch: 1,
      n: 21,
    }));
    await handle.release();

    const err = await withTimeout(
      rejectionOf(fx.persistence.archiveDoc(ALICE, DOC, EXPECT_A)),
      2_000,
      'archive with one failing remove',
    );
    expect(err).toBeInstanceOf(DocArchiveFatalError);
    expect((err as DocArchiveFatalError).phase).toBe('relocate-remove');
    expect((err as DocArchiveFatalError).committed).toBe(true); // 归档写已 resolve（提交点跨越）
    // 双窗口现场：归档区已持副本（writeArchive 已 resolve）+ 主键仍在（remove 未完成）
    expect(fx.probe.archiveWrites).toHaveLength(1);
    expect(fx.probe.log).toContain('archive-committed');
    expect(fx.store.has(KEY)).toBe(true);

    // 重试收敛：guard-read 见主键 → 身份复验 → 再归档（单槽覆盖）→ 删主键 → 单副本终态
    const retried = await withTimeout(
      fx.persistence.archiveDoc(ALICE, DOC, EXPECT_A),
      2_000,
      'archive retry convergence after remove failure',
    );
    expect(retried).toMatchObject({ ok: true });
    expect(fx.probe.archiveWrites).toHaveLength(2); // 第二次归档写（单槽 latest-wins）
    expect(Buffer.from(fx.probe.archiveWrites[0]!.bytes).equals(
      Buffer.from(fx.probe.archiveWrites[1]!.bytes),
    )).toBe(true); // 同字节覆盖（收敛为同一副本）
    expect(fx.store.has(KEY)).toBe(false);
    expect(await fx.persistence.loadDoc(ALICE, DOC)).toBeNull();
    // 幂等收敛后：再归档 → DUPLICATE（主键已不在）
    const again = await withTimeout(
      rejectionOf(fx.persistence.archiveDoc(ALICE, DOC, EXPECT_A)),
      2_000,
      'idempotent duplicate after convergence',
    );
    expect(again).toBeInstanceOf(DocArchiveDuplicateError);
    await fx.dispose();
  });
});

// ═══════════════════════════════ §5 File 归档崩溃恢复实机演练 ═══════════════════════════════

describe('SA7 §5 File 归档崩溃恢复实机演练（真实 tmpdir）', () => {
  it('5a 归档成功后新实例：loadDoc → null、归档文件存在、可 decode、META 身份完整', async () => {
    const first = makeFileDynFixture();
    const handle = await first.persistence.createDoc(ALICE, DOC, makeDoc(DOC, {
      replicationId: ID_A,
      replicationEpoch: 1,
      n: 12,
    }));
    await handle.release();

    const result = await withTimeout(first.persistence.archiveDoc(ALICE, DOC, EXPECT_A), 5_000, 'file archive');
    expect(result).toMatchObject({ ok: true });
    await first.dispose();

    // 新实例（同 rootDir，重启语义）：主键不可读、归档文件可 decode、META 身份完整
    const restart = makeFileDynFixture({ rootDir: first.rootDir });
    expect(await restart.persistence.loadDoc(ALICE, DOC)).toBeNull();
    const raw = await fsp.readFile(first.archivePath);
    const archived = decodeToDoc(raw);
    expect(archived.getMap('META').get('docId')).toBe(DOC);
    expect(archived.getMap('META').get('replicationId')).toBe(ID_A);
    expect(archived.getMap('META').get('replicationEpoch')).toBe(1);
    expect(archived.getMap('ROOT').get('n')).toBe(12);
    // 无 tmp 残留
    const files = await listFilesUnder(first.rootDir);
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
    await restart.dispose();
  });

  it('5b 归档 tmp 残留（writeFile tmp 后 rename 前崩溃语义）：新实例主键正常可 load、再归档成功、tmp 覆盖式清理', async () => {
    // 崩溃语义构造：tmp 已写、rename 未执行 → 「tmp 残留 + 主键仍在」
    const first = makeFileDynFixture();
    const handle = await first.persistence.createDoc(ALICE, DOC, makeDoc(DOC, {
      replicationId: ID_A,
      replicationEpoch: 1,
      n: 7,
    }));
    await handle.release();
    await first.dispose();

    // 手工注入 tmp 残留（真实 fs 写入归档区 tmp 位）
    await fsp.mkdir(path.dirname(first.archiveTmpPath), { recursive: true });
    await fsp.writeFile(first.archiveTmpPath, Buffer.from([0x00, 0x01, 0x02, 0xde, 0xad]));

    // 新实例启动：主键文档正常可 load（恢复不触归档区）
    const second = makeFileDynFixture({ rootDir: first.rootDir });
    const loaded = await withTimeout(second.persistence.loadDoc(ALICE, DOC), 5_000, 'load with archive tmp residue');
    expect(loaded).not.toBeNull();
    expect(loaded!.doc.getMap('ROOT').get('n')).toBe(7);
    expect(loaded!.doc.getMap('META').get('replicationId')).toBe(ID_A);
    await loaded!.release();

    // 再归档成功：tmp 被覆盖式清理（writeArchive 重写 tmp → rename）
    const result = await withTimeout(second.persistence.archiveDoc(ALICE, DOC, EXPECT_A), 5_000, 're-archive over tmp residue');
    expect(result).toMatchObject({ ok: true });
    expect(await fileState(first.archiveTmpPath)).toBe('absent');
    const raw = await fsp.readFile(first.archivePath);
    const archived = decodeToDoc(raw);
    expect(archived.getMap('ROOT').get('n')).toBe(7);
    expect(await second.persistence.loadDoc(ALICE, DOC)).toBeNull();
    await second.dispose();
  });

  it('5c 双副本窗口（archive 写 resolve + remove 前崩溃）：重启后两副本并存 → 重试 archiveDoc 收敛（归档区覆盖、主键删除、幂等）', async () => {
    // 崩溃语义构造：writeArchive 已 resolve（归档文件在盘）+ remove 未执行（主键仍在）
    const first = makeFileDynFixture();
    const handle = await first.persistence.createDoc(ALICE, DOC, makeDoc(DOC, {
      replicationId: ID_A,
      replicationEpoch: 1,
      n: 15,
    }));
    await handle.release();
    await first.dispose();
    const mainBytes = await fsp.readFile(first.mainPath);
    await fsp.mkdir(path.dirname(first.archivePath), { recursive: true });
    await fsp.writeFile(first.archivePath, mainBytes); // 模拟归档写已落盘、remove 前崩溃

    // 新实例：两副本并存 → 主键仍可 load（诚实状态）
    const second = makeFileDynFixture({ rootDir: first.rootDir });
    const loaded = await withTimeout(second.persistence.loadDoc(ALICE, DOC), 5_000, 'load in dual-copy window');
    expect(loaded).not.toBeNull();
    expect(loaded!.doc.getMap('ROOT').get('n')).toBe(15);
    await loaded!.release();

    // 重试 archiveDoc 收敛：归档区覆盖（同字节）、主键删除
    const result = await withTimeout(second.persistence.archiveDoc(ALICE, DOC, EXPECT_A), 5_000, 'retry archive convergence');
    expect(result).toMatchObject({ ok: true });
    expect(await fsp.readFile(first.archivePath)).toEqual(mainBytes);
    expect(await fileState(first.mainPath)).toBe('absent');
    expect(await second.persistence.loadDoc(ALICE, DOC)).toBeNull();

    // 幂等：收敛后二次归档 → DUPLICATE（单槽语义，无双重归档）
    const again = await withTimeout(
      rejectionOf(second.persistence.archiveDoc(ALICE, DOC, EXPECT_A)),
      5_000,
      'duplicate after convergence',
    );
    expect(again).toBeInstanceOf(DocArchiveDuplicateError);
    await second.dispose();
  });

  it('5d owner 分区实机：A 归档后 B 分区文件树零变化', async () => {
    const fx = makeFileDynFixture();
    const aHandle = await fx.persistence.createDoc(ALICE, DOC, makeDoc(DOC, {
      replicationId: ID_A, replicationEpoch: 1, n: 1,
    }));
    const bHandle = await fx.persistence.createDoc(BOB, DOC, makeDoc(DOC, {
      replicationId: 'b'.repeat(32), replicationEpoch: 5, n: 2,
    }));
    await aHandle.release();
    await bHandle.release();
    const bobPath = path.join(fx.rootDir, 'users', BOB.userId, `${DOC}.snapshot`);
    const bobBefore = await fsp.readFile(bobPath);

    const result = await withTimeout(fx.persistence.archiveDoc(ALICE, DOC, EXPECT_A), 5_000, 'archive alice partition');
    expect(result).toMatchObject({ ok: true });

    // B 分区零变化：文件字节逐字节一致、可正常 load、身份/内容原样
    expect(await fsp.readFile(bobPath)).toEqual(bobBefore);
    const bobLoaded = await fx.persistence.loadDoc(BOB, DOC);
    expect(bobLoaded).not.toBeNull();
    expect(bobLoaded!.doc.getMap('META').get('replicationEpoch')).toBe(5);
    expect(bobLoaded!.doc.getMap('ROOT').get('n')).toBe(2);
    await bobLoaded!.release();
    // A 分区：主键缺席、归档文件在受控子树
    expect(await fx.persistence.loadDoc(ALICE, DOC)).toBeNull();
    expect(await fileState(fx.archivePath)).toBe('present');
    const files = await listFilesUnder(fx.rootDir);
    expect(files).toContain(`archive/users/${ALICE.userId}/${DOC}.snapshot`);
    expect(files).toContain(`users/${BOB.userId}/${DOC}.snapshot`);
    await fx.dispose();
  });

  it('5e F-7-ii dispose × relocate-remove 双窗口：rm 已进入→完整执行→ok:true 落地；abort 后 remove 抛错→committed:true fatal + 重启重试收敛', async () => {
    // —— 窗口 1：rm 已进入 → 完整执行（remove 契约）→ dispose 期间 hold → 诚实 ok:true ——
    const w1 = makeFileDynFixture();
    const h1 = await w1.persistence.createDoc(ALICE, DOC, makeDoc(DOC, {
      replicationId: ID_A, replicationEpoch: 1, n: 40,
    }));
    await h1.release();
    const holdRemove = w1.probe.holdAfterRemoveDone();
    const archiving1 = w1.persistence.archiveDoc(ALICE, DOC, EXPECT_A);
    void archiving1.catch(() => {});
    await withTimeout(holdRemove.entered, 5_000, 'remove inner completed then hold');
    const disposing1 = w1.dispose();
    holdRemove.release();
    const [ok1] = await Promise.all([
      withTimeout(archiving1, 5_000, 'archive settle after entered-remove dispose'),
      withTimeout(disposing1, 5_000, 'dispose after entered remove'),
    ] as [Promise<Readonly<{ ok: true }>>, Promise<void>]);
    // rm 已进入后完整执行：archive ok:true 且效果已落地（主键删、归档文件在）——诚实
    expect(ok1).toMatchObject({ ok: true });
    expect(w1.probe.log).toContain('remove-done');
    expect(await fileState(w1.mainPath)).toBe('absent');
    expect(await fileState(w1.archivePath)).toBe('present');

    // —— 窗口 2：writeArchive resolve 后 remove 进入前 dispose → abort 门拒绝 → committed:true fatal ——
    const w2 = makeFileDynFixture();
    const h2 = await w2.persistence.createDoc(ALICE, DOC, makeDoc(DOC, {
      replicationId: ID_A, replicationEpoch: 1, n: 41,
    }));
    await h2.release();
    const holdArchive = w2.probe.holdAfterArchiveCommit();
    const archiving2 = w2.persistence.archiveDoc(ALICE, DOC, EXPECT_A);
    void archiving2.catch(() => {});
    await withTimeout(holdArchive.entered, 5_000, 'writeArchive commit then hold (file)');
    const disposing2 = w2.dispose();
    holdArchive.release();
    const [err2] = await Promise.all([
      withTimeout(rejectionOf(archiving2), 5_000, 'archive settle in abort window (file)'),
      withTimeout(disposing2, 5_000, 'dispose in abort window (file)'),
    ] as [Promise<unknown>, Promise<void>]);
    expect(err2).toBeInstanceOf(DocArchiveFatalError);
    expect((err2 as DocArchiveFatalError).phase).toBe('relocate-remove');
    expect((err2 as DocArchiveFatalError).committed).toBe(true);
    expect(w2.probe.log).not.toContain('remove-done'); // remove 提交段从未执行（abort 门先于内层）
    // File 恢复面：归档文件已在盘（提交点为真）+ 主键仍在 → 双副本窗口落盘
    expect(await fileState(w2.archivePath)).toBe('present');
    expect(await fileState(w2.mainPath)).toBe('present');

    // 重启重试收敛：guard-read 主键 → 身份复验 → 归档覆盖 → 主键删除 → 幂等 DUPLICATE
    const restart = makeFileDynFixture({ rootDir: w2.rootDir });
    const converged = await withTimeout(restart.persistence.archiveDoc(ALICE, DOC, EXPECT_A), 5_000, 'restart convergence');
    expect(converged).toMatchObject({ ok: true });
    expect(await fileState(w2.mainPath)).toBe('absent');
    expect(await restart.persistence.loadDoc(ALICE, DOC)).toBeNull();
    const dup = await withTimeout(
      rejectionOf(restart.persistence.archiveDoc(ALICE, DOC, EXPECT_A)),
      5_000,
      'duplicate after restart convergence',
    );
    expect(dup).toBeInstanceOf(DocArchiveDuplicateError);
    await restart.dispose();
  });
});

// ═══════════════════════════════ §6 identity 守卫动态边界 ═══════════════════════════════

describe('SA7 §6 identity 守卫动态边界', () => {
  it('6a 持久身份演进（epoch 1→2 落盘）后以旧 epoch 归档 → IDENTITY_MISMATCH + 文档完好 + open 恢复', async () => {
    const fx = makeMemoryDynFixture();
    const handle = await fx.persistence.createDoc(ALICE, DOC, makeDoc(DOC, {
      replicationId: ID_A,
      replicationEpoch: 1,
      n: 3,
    }));
    await handle.release();

    // 身份演进：重载 → META epoch 改写 → flush 落盘（持久快照身份 = 2）
    const loaded = await fx.persistence.loadDoc(ALICE, DOC);
    expect(loaded).not.toBeNull();
    loaded!.doc.getMap('META').set('replicationEpoch', 2);
    loaded!.doc.getMap('ROOT').set('n', 4);
    await fx.persistence.saveDoc(loaded!);
    await fx.scheduler.advanceBy(1); // flush 落盘
    await loaded!.release();
    const persisted = decodeToDoc(fx.store.get(KEY)!);
    expect(persisted.getMap('META').get('replicationEpoch')).toBe(2); // 落盘事实

    // 以旧 epoch（1）的 expected 归档 → 拒绝（守卫以持久快照复制事实为权威）
    const before = fx.store.get(KEY)!.slice();
    const err = await withTimeout(
      rejectionOf(fx.persistence.archiveDoc(ALICE, DOC, EXPECT_A)),
      2_000,
      'stale-epoch archive',
    );
    expect(err).toBeInstanceOf(DocArchiveIdentityError);
    // 文档完好：store 字节零改动 + open 恢复（epoch 2、ROOT 4）
    expect(Buffer.from(fx.store.get(KEY)!).equals(Buffer.from(before))).toBe(true);
    const recovered = await fx.persistence.loadDoc(ALICE, DOC);
    expect(recovered).not.toBeNull();
    expect(recovered!.doc.getMap('META').get('replicationEpoch')).toBe(2);
    expect(recovered!.doc.getMap('ROOT').get('n')).toBe(4);
    await recovered!.release();
    expect(fx.probe.archiveWrites).toHaveLength(0); // 零部分归档
    await fx.dispose();
  });

  it('6b 导入后立即归档（未 flush 窗口）：守卫读到导入字节身份（新身份成功 / 旧身份拒绝+完好）', async () => {
    // 正向：导入（create 提交点已落盘）→ 立即以导入身份归档 → 成功
    const ok = makeMemoryDynFixture();
    const impHandle = await ok.persistence.importDoc(ALICE, DOC, makeDoc(DOC, {
      replicationId: ID_A,
      replicationEpoch: 7,
      n: 55,
    }));
    await impHandle.release(); // 零 flush 窗口：导入提交点即持久事实
    const result = await withTimeout(
      ok.persistence.archiveDoc(ALICE, DOC, { replicationId: ID_A, replicationEpoch: 7 }),
      2_000,
      'archive immediately after import',
    );
    expect(result).toMatchObject({ ok: true }); // 守卫读到导入字节身份（epoch 7）
    expect(ok.probe.archiveWrites).toHaveLength(1);
    const archived = decodeToDoc(ok.probe.archiveWrites[0]!.bytes);
    expect(archived.getMap('META').get('replicationEpoch')).toBe(7);
    expect(archived.getMap('ROOT').get('n')).toBe(55);
    expect(await ok.persistence.loadDoc(ALICE, DOC)).toBeNull();
    await ok.dispose();

    // 负控：导入 epoch 7 → 以旧身份（epoch 6）归档 → 拒绝 + 导入副本完好
    const bad = makeMemoryDynFixture();
    const impHandle2 = await bad.persistence.importDoc(ALICE, DOC, makeDoc(DOC, {
      replicationId: ID_A,
      replicationEpoch: 7,
      n: 56,
    }));
    await impHandle2.release();
    const err = await withTimeout(
      rejectionOf(bad.persistence.archiveDoc(ALICE, DOC, { replicationId: ID_A, replicationEpoch: 6 })),
      2_000,
      'stale-identity archive after import',
    );
    expect(err).toBeInstanceOf(DocArchiveIdentityError);
    const intact = await bad.persistence.loadDoc(ALICE, DOC);
    expect(intact).not.toBeNull();
    expect(intact!.doc.getMap('META').get('replicationEpoch')).toBe(7);
    expect(intact!.doc.getMap('ROOT').get('n')).toBe(56);
    await intact!.release();
    expect(bad.probe.archiveWrites).toHaveLength(0);
    await bad.dispose();
  });
});

// ═══════════════════════════════ §7 公共面动态守卫 ═══════════════════════════════

describe('SA7 §7 persistence 公共面动态守卫（运行时可枚举键）', () => {
  it('主入口运行时枚举键不含禁词面；实例原型面不含 removeDoc/deleteDoc/listDocs 等删除/枚举词根', async () => {
    const mod = (await import('@nomicore/persistence')) as Record<string, unknown>;
    const moduleKeys = [...Object.keys(mod), ...Object.getOwnPropertyNames(mod)];
    const forbiddenModule = [
      'removeDoc', 'deleteDoc', 'listDocs', 'dropDoc', 'destroyDoc',
      'restoreDoc', 'putDoc', 'getDoc', 'removeAll', 'deleteAll', 'archiveAll',
    ];
    for (const name of forbiddenModule) {
      expect(moduleKeys, `主入口不得导出 ${name}`).not.toContain(name);
    }

    const forbiddenProto = [
      'removeDoc', 'deleteDoc', 'listDocs', 'dropDoc', 'destroyDoc',
      'restoreDoc', 'purgeDoc', 'getDoc', 'putDoc', 'removeAllDocs',
    ];
    const surfaceRoot = path.join(
      os.tmpdir(),
      `nomicore-sa7-surface-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    );
    fileRootDirs.add(surfaceRoot);
    const mem = createMemoryPersistence({ scheduler: createTestScheduler() });
    const file = new FilePersistence({ rootDir: surfaceRoot, scheduler: createTestScheduler() });
    for (const adapter of [mem, file]) {
      const protoKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(adapter));
      for (const name of forbiddenProto) {
        expect(protoKeys, `${adapter.constructor.name} 原型面不得含 ${name}`).not.toContain(name);
      }
      // 契约方法恰在：三基础 + Phase 5 两复制成员
      for (const required of ['createDoc', 'loadDoc', 'saveDoc', 'importDoc', 'archiveDoc']) {
        expect(protoKeys, `${adapter.constructor.name} 原型面必须含 ${required}`).toContain(required);
      }
    }
    await (mem as unknown as { dispose(): Promise<void> }).dispose();
    await (file as unknown as { dispose(): Promise<void> }).dispose();
  });
});

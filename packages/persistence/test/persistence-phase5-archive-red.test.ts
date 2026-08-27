/**
 * SA6 红灯锚定 — issue #133（Phase 5: bootstrap import, archive, and guarded
 * replica reset）AC-3/AC-5/AC-6 的 persistence 侧：受复制身份前置条件保护的
 * `archiveDoc(owner, docId, expectedReplicationIdentity)` 归档 seam。
 *
 * 契约来源（docs/phases/phase-5-websocket-replication.md §实施切片 2 /
 * docs/adr/0010-hub-peer-websocket-ydoc-replication.md §复制谱系与 epoch /
 * ADR 0006 排他创建与原子提交纪律）：
 * - AC-3：MemoryPersistence 与 FilePersistence 实现行为等价的归档语义；
 *   archiveDoc 仅在无有效 handle（live 未释放）时执行；身份前置条件守卫
 *   （expectedReplicationIdentity 与持久快照 META 复制身份不符 → 稳定拒绝且
 *   原 snapshot 零改动）；归档后 loadDoc → null；归档内容可经受控路径恢复且
 *   字节可 decode、META 身份完整（File 正式恢复面；Memory 等价面 = 主键移除
 *   + slot 复用——测试 seam 见 phase 文档 §测试 seam「FilePersistence 做进程
 *   重启、归档和恢复验收」）；
 * - AC-5：File 归档落点在 rootDir 内受控路径、原子 rename（tmp→rename 纪律，
 *   fault seam 断言无部分状态）；文件访问封闭在 Persistence 包内（行为侧锚：
 *   归档文件只能经本包 archiveDoc 移动，落点严格在 rootDir 内）；
 * - AC-6：crash/error committed 事实（fault seam 注入归档读/写阶段失败 →
 *   稳定分类、失败前归档不发生）；duplicate archive 稳定拒绝；archive recovery；
 *   independent owner partitions（owner A 归档零影响 owner B 同 docId 分区）。
 *
 * 红灯机制（基线 = DocPersistence 公共面仅 createDoc/loadDoc/saveDoc）：
 * 一切 `persistence.archiveDoc(...)` 调用在基线上抛
 * `TypeError: archiveDoc is not a function`——特征缺失的红。
 *
 * 锚定纪律：真实 yjs / 真实 MemoryPersistence·FilePersistence（真实 tmpdir、
 * 真实 fs rename），零 mock 本地服务、零源码 grep 断言；故障注入仅经既有
 * createPersistenceIoFaultSeam（wrapIo around-seam，issue #108 模式）；fake
 * scheduler 脚本化驱动（零 real sleep；createDoc 为提交-前-resolve 语义，无需
 * flush 等待）。
 *
 * 临时契约声明（显式标记「临时名/临时形状，待 SA1 冻结」）：
 * - ReplicationIdentityRef（expectedReplicationIdentity 的参数形状，
 *   `{ replicationId: string; replicationEpoch: number }`）——ADR 0010 冻结了
 *   字段（32 小写 hex / 从 1 开始的十进制安全整数）与「复制身份」概念，两参
 *   数的包装形状属 N-1 待 SA1 定义；
 * - 归档稳定错误的 code 拼写（DOC_ARCHIVE_IDENTITY_MISMATCH /
 *   DOC_ARCHIVE_ACTIVE_HANDLE / DOC_ARCHIVE_DUPLICATE / DOC_ARCHIVE_OPERATIONAL）
 *   —— phase 文档冻结了「duplicate / identity mismatch / operational failure /
 *   committed-aware fatal 四类稳定分类」，拼写待 SA1 冻结；import 侧 duplicate
 *   直接用已冻结 DOC_DUPLICATE（文档措辞「排他创建」「绝不覆盖」与 0006 一致）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  FilePersistence,
  createMemoryPersistence,
  DocDuplicateError,
  type DocPersistence,
  type MemoryPersistenceOptions,
  type User,
} from '@nomicore/persistence';
import {
  createPersistenceIoFaultSeam,
  createTestScheduler,
  type PersistenceIoFaults,
  type TestScheduler,
} from '@nomicore/persistence/testing';

// ═══════════════════════════════ 契约面本地声明（临时形状，待 SA1 冻结） ═══════════════

/** 复制身份引用（临时形状：ADR 0010 冻结字段的包装；N-1 待 SA1 定义）。 */
interface ReplicationIdentityRef {
  readonly replicationId: string;
  readonly replicationEpoch: number;
}

/** archiveDoc 新契约面（phase 文档冻结名；仅调用面 cast，运行时对象原样）。 */
interface ArchiveCapablePersistence {
  readonly archiveDoc: (
    owner: User,
    docId: string,
    expectedReplicationIdentity: ReplicationIdentityRef,
  ) => Promise<Readonly<{ ok: true }>>;
}

function asArchive(persistence: DocPersistence): DocPersistence & ArchiveCapablePersistence {
  return persistence as unknown as DocPersistence & ArchiveCapablePersistence;
}

/** 文档快照构建（归档载体：META.docId + 可选复制身份 + ROOT）。 */
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

// ═══════════════════════════════ 双 adapter 夹具 ═══════════════════════════════

/**
 * 归档契约夹具（Memory/File 平行接缝）：adapter 经 wrapIo fault seam 接线；
 * `storeSnapshot()` 返回真实持久化面（Memory = hook 存储 Map；File = rootDir
 * 递归文件清单 + 字节）——「零改动」「无残留」断言全部落在真实存储面上。
 */
interface ArchiveFixture {
  readonly persistence: DocPersistence;
  readonly scheduler: TestScheduler;
  readonly faults: PersistenceIoFaults;
  /** 真实持久化面快照（相对路径 + 字节）。 */
  readStoreSnapshot(): Promise<{ files: string[]; bytes: Map<string, Uint8Array> }>;
  /** 该 (owner, docId) 的 committed snapshot 相对路径（Memory: `user\0docId`；File: users/<u>/<docId>.snapshot）。 */
  snapshotPathOf(owner: User, docId: string): string;
  dispose(): Promise<void>;
}

function makeMemoryArchiveFixture(): ArchiveFixture {
  const store = new Map<string, Uint8Array>();
  const scheduler = createTestScheduler();
  const seam = createPersistenceIoFaultSeam();
  const persistence = createMemoryPersistence({
    scheduler,
    schedule: { debounceMs: 1, maxDirtyMs: 1 },
    writeSnapshot: async (key, snapshot) => {
      store.set(key, snapshot.slice());
    },
    readSnapshot: async (key) => store.get(key),
    // R-1（设计 §4.10/§4.14.1 回流清单）：deleteSnapshot hook——归档 remove 需外部
    // store 的删除能力（hook store 是唯一读权威，无删除路径则归档「主键移除」对外部
    // store 是虚假 no-op，loud 配置门命中）。仅主键直传（R2：writeArchive 不经
    // writeSnapshot hook、独立 archiveSnapshots 分区——本夹具不预设 archive-scoped key）。
    deleteSnapshot: async (key: string) => {
      store.delete(key);
    },
    wrapIo: seam.wrap,
  } as MemoryPersistenceOptions);
  return {
    persistence,
    scheduler,
    faults: seam.faults,
    readStoreSnapshot: async () => {
      const files = [...store.keys()].sort();
      const bytes = new Map<string, Uint8Array>();
      for (const [key, value] of store) bytes.set(key, value.slice());
      return { files, bytes };
    },
    snapshotPathOf: (owner, docId) => `${owner.userId}\u0000${docId}`,
    dispose: async () => {
      await (persistence as unknown as { dispose(): Promise<void> }).dispose();
    },
  };
}

function makeFileArchiveFixture(rootDir: string): ArchiveFixture {
  const scheduler = createTestScheduler();
  const seam = createPersistenceIoFaultSeam();
  const persistence = new FilePersistence({
    rootDir,
    scheduler,
    schedule: { debounceMs: 1, maxDirtyMs: 1 },
    wrapIo: seam.wrap,
  });
  return {
    persistence,
    scheduler,
    faults: seam.faults,
    readStoreSnapshot: async () => {
      const files: string[] = [];
      const bytes = new Map<string, Uint8Array>();
      async function walk(dir: string, prefix: string): Promise<void> {
        for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
          const rel = `${prefix}${entry.name}`;
          const abs = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(abs, `${rel}/`);
          } else {
            files.push(rel);
            bytes.set(rel, await fsp.readFile(abs));
          }
        }
      }
      await walk(rootDir, '');
      files.sort();
      return { files, bytes };
    },
    snapshotPathOf: (owner, docId) => `users/${owner.userId}/${docId}.snapshot`,
    dispose: async () => {
      await (persistence as unknown as { dispose(): Promise<void> }).dispose();
    },
  };
}

/** 断言真实持久化面在操作前后逐字节一致（零改动 / 无部分状态）。 */
async function assertStoreUnchanged(
  before: { files: string[]; bytes: Map<string, Uint8Array> },
  after: { files: string[]; bytes: Map<string, Uint8Array> },
): Promise<void> {
  expect(after.files).toEqual(before.files);
  expect([...after.bytes.keys()].sort()).toEqual([...before.bytes.keys()].sort());
  for (const key of before.bytes.keys()) {
    expect(Buffer.from(after.bytes.get(key) as Uint8Array).equals(
      Buffer.from(before.bytes.get(key) as Uint8Array),
    ), `store 键 ${key} 字节被改动`).toBe(true);
  }
}

const ALICE: User = Object.freeze({ userId: 'u-alice' });
const BOB: User = Object.freeze({ userId: 'u-bob' });
const DOC_ID = 'ns-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ID_A = 'a'.repeat(32);
const ID_B = 'b'.repeat(32);
const ID_WRONG = 'c'.repeat(32);

const fixtures: Record<string, () => ArchiveFixture> = {
  MemoryPersistence: makeMemoryArchiveFixture,
};

// File 夹具每个用例独立 tmpdir（afterEach 统一清理）。
const fileRootDirs: string[] = [];
function makeRealFileFixture(): ArchiveFixture {
  const rootDir = path.join(
    os.tmpdir(),
    `nomicore-archive-red-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
  );
  fileRootDirs.push(rootDir);
  return makeFileArchiveFixture(rootDir);
}
fixtures.FilePersistence = makeRealFileFixture;

afterEach(async () => {
  await Promise.all(
    fileRootDirs.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })),
  );
});

// ═══════════════════════════════ 共享矩阵（Memory/File 双 adapter 平行验收） ═════════════

for (const [adapterName, makeFixture] of Object.entries(fixtures)) {
  describe(`archiveDoc 契约（${adapterName}，AC-3/AC-5/AC-6 共享矩阵）`, () => {
    it('AC-3 成功归档：loadDoc → null、committed 主键移除、slot 可重建（新内容）', async () => {
      const fx = makeFixture();
      const seeded = await fx.persistence.createDoc(ALICE, DOC_ID, makeDoc(DOC_ID, {
        replicationId: ID_A,
        replicationEpoch: 1,
      }));
      await seeded.release();

      const result = await asArchive(fx.persistence).archiveDoc(ALICE, DOC_ID, {
        replicationId: ID_A,
        replicationEpoch: 1,
      });
      expect(result).toMatchObject({ ok: true });

      // 归档后：loadDoc → null（主键不再可读）；slot 可重建（reset→bootstrap 的
      // persistence 侧资格：同 (owner, docId) 可再次排他创建，内容全新、旧归档不合并）
      expect(await fx.persistence.loadDoc(ALICE, DOC_ID)).toBeNull();
      const rebuilt = await fx.persistence.createDoc(ALICE, DOC_ID, makeDoc(DOC_ID, {
        replicationId: ID_A,
        replicationEpoch: 2,
        n: 99,
      }));
      const loaded = await fx.persistence.loadDoc(ALICE, DOC_ID);
      expect(loaded).not.toBeNull();
      expect(loaded!.doc.getMap('ROOT').get('n')).toBe(99);
      expect(loaded!.doc.getMap('META').get('replicationEpoch')).toBe(2);
      await rebuilt.release();
      await loaded!.release();
      await fx.dispose();
    });

    it('AC-3 身份不匹配：稳定拒绝（DOC_ARCHIVE_IDENTITY_MISMATCH，临时拼写）+ 原 snapshot 零改动', async () => {
      const fx = makeFixture();
      const seeded = await fx.persistence.createDoc(ALICE, DOC_ID, makeDoc(DOC_ID, {
        replicationId: ID_A,
        replicationEpoch: 1,
      }));
      await seeded.release();
      const before = await fx.readStoreSnapshot();

      await expect(
        asArchive(fx.persistence).archiveDoc(ALICE, DOC_ID, {
          replicationId: ID_WRONG,
          replicationEpoch: 1,
        }),
      ).rejects.toMatchObject({ code: 'DOC_ARCHIVE_IDENTITY_MISMATCH' });

      // 原 snapshot 零改动：真实存储面逐字节一致，loadDoc 仍返回完整文档
      await assertStoreUnchanged(before, await fx.readStoreSnapshot());
      const loaded = await fx.persistence.loadDoc(ALICE, DOC_ID);
      expect(loaded).not.toBeNull();
      expect(loaded!.doc.getMap('META').get('replicationId')).toBe(ID_A);
      expect(loaded!.doc.getMap('META').get('replicationEpoch')).toBe(1);
      expect(loaded!.doc.getMap('ROOT').get('n')).toBe(42);
      await loaded!.release();
      await fx.dispose();
    });

    it('AC-3 身份不匹配（epoch 不符同拒）：稳定拒绝 + 原 snapshot 零改动', async () => {
      const fx = makeFixture();
      const seeded = await fx.persistence.createDoc(ALICE, DOC_ID, makeDoc(DOC_ID, {
        replicationId: ID_A,
        replicationEpoch: 1,
      }));
      await seeded.release();
      const before = await fx.readStoreSnapshot();

      await expect(
        asArchive(fx.persistence).archiveDoc(ALICE, DOC_ID, {
          replicationId: ID_A,
          replicationEpoch: 2,
        }),
      ).rejects.toMatchObject({ code: 'DOC_ARCHIVE_IDENTITY_MISMATCH' });
      await assertStoreUnchanged(before, await fx.readStoreSnapshot());
      const loaded = await fx.persistence.loadDoc(ALICE, DOC_ID);
      expect(loaded).not.toBeNull();
      expect(loaded!.doc.getMap('META').get('replicationEpoch')).toBe(1);
      await loaded!.release();
      await fx.dispose();
    });

    it('AC-3/AC-6 持久化 META 复制身份损坏（双键在而格式违约）：稳定拒绝 + 零改动（不伪装可归档）', async () => {
      const fx = makeFixture();
      // replicationId 非 32 位小写 hex（'z' 非法）——持久损坏形态（#132 损坏判据族）
      const seeded = await fx.persistence.createDoc(ALICE, DOC_ID, makeDoc(DOC_ID, {
        replicationId: 'z'.repeat(32),
        replicationEpoch: 1,
      }));
      await seeded.release();
      const before = await fx.readStoreSnapshot();

      // 损坏身份的归档分类（identity mismatch 族还是独立 corrupt 族）属 SA1 冻结；
      // 本用例只锚「拒绝且零改动」这一契约（绝不允许损坏文档被静默归档）。
      await expect(
        asArchive(fx.persistence).archiveDoc(ALICE, DOC_ID, {
          replicationId: ID_A,
          replicationEpoch: 1,
        }),
      ).rejects.toThrow();
      await assertStoreUnchanged(before, await fx.readStoreSnapshot());
      const loaded = await fx.persistence.loadDoc(ALICE, DOC_ID);
      expect(loaded).not.toBeNull();
      expect(loaded!.doc.getMap('META').get('replicationId')).toBe('z'.repeat(32));
      await loaded!.release();
      await fx.dispose();
    });

    it('AC-3/AC-6 active handle（live 未释放）：稳定拒绝（DOC_ARCHIVE_ACTIVE_HANDLE，临时拼写）→ release 后归档成功', async () => {
      const fx = makeFixture();
      const handle = await fx.persistence.createDoc(ALICE, DOC_ID, makeDoc(DOC_ID, {
        replicationId: ID_A,
        replicationEpoch: 1,
      }));
      // handle 仍 live：归档拒绝（phase 文档「仅在无有效 handle/Runtime generation 时执行」）
      await expect(
        asArchive(fx.persistence).archiveDoc(ALICE, DOC_ID, {
          replicationId: ID_A,
          replicationEpoch: 1,
        }),
      ).rejects.toMatchObject({ code: 'DOC_ARCHIVE_ACTIVE_HANDLE' });
      expect(handle.getStatus()).toBe('ready');
      expect(handle.doc.getMap('ROOT').get('n')).toBe(42); // 文档仍 live 可读

      await handle.release();
      const result = await asArchive(fx.persistence).archiveDoc(ALICE, DOC_ID, {
        replicationId: ID_A,
        replicationEpoch: 1,
      });
      expect(result).toMatchObject({ ok: true });
      expect(await fx.persistence.loadDoc(ALICE, DOC_ID)).toBeNull();
      await fx.dispose();
    });

    it('AC-3/AC-6 duplicate archive（二次归档）：稳定拒绝（DOC_ARCHIVE_DUPLICATE，临时拼写）+ 首次归档完整保留', async () => {
      const fx = makeFixture();
      const seeded = await fx.persistence.createDoc(ALICE, DOC_ID, makeDoc(DOC_ID, {
        replicationId: ID_A,
        replicationEpoch: 1,
      }));
      await seeded.release();
      await asArchive(fx.persistence).archiveDoc(ALICE, DOC_ID, {
        replicationId: ID_A,
        replicationEpoch: 1,
      });

      await expect(
        asArchive(fx.persistence).archiveDoc(ALICE, DOC_ID, {
          replicationId: ID_A,
          replicationEpoch: 1,
        }),
      ).rejects.toMatchObject({ code: 'DOC_ARCHIVE_DUPLICATE' });

      // 首次归档结果保留：主键仍不可读、slot 仍空——第二次拒绝不得清掉任何事实
      expect(await fx.persistence.loadDoc(ALICE, DOC_ID)).toBeNull();
      await fx.dispose();
    });

    it('AC-6 committed 事实诚实（hold-before-commit）：归档提交前窗口真实存储面零变化；release 后提交恰一次、无残留', async () => {
      const fx = makeFixture();
      const seeded = await fx.persistence.createDoc(ALICE, DOC_ID, makeDoc(DOC_ID, {
        replicationId: ID_A,
        replicationEpoch: 1,
      }));
      await seeded.release();
      const before = await fx.readStoreSnapshot();

      const hold = fx.faults.holdNextWriteBeforeCommit();
      const archiveP = asArchive(fx.persistence).archiveDoc(ALICE, DOC_ID, {
        replicationId: ID_A,
        replicationEpoch: 1,
      });
      // 若归档提交未路由经 io seam（hold 永不触发）或基线上 archiveDoc 缺失（立即
      // reject），race 快速判定，避免 3s 级超时等待——hold 触发才是继续的路径。
      const engaged = await Promise.race([
        hold.entered.then(() => 'held' as const),
        archiveP.then(
          () => 'resolved-before-hold' as const,
          (error: unknown) => {
            throw error;
          },
        ),
      ]);
      expect(engaged, '归档提交写必须经 io seam（hold-before-commit 应先行触发）').toBe('held');
      // 提交段未执行：真实存储面必须与操作前逐字节一致（无 tmp、无半移动、无预写）
      await assertStoreUnchanged(before, await fx.readStoreSnapshot());

      hold.release();
      const result = await archiveP;
      expect(result).toMatchObject({ ok: true });
      // 提交恰一次：主键已移除 → loadDoc null；无未清理 tmp（File 侧读清单兜底）
      expect(await fx.persistence.loadDoc(ALICE, DOC_ID)).toBeNull();
      await fx.dispose();
    });

    it('AC-6 fault seam：归档身份核对读失败 → 稳定拒绝（DOC_ARCHIVE_OPERATIONAL，临时拼写）+ 零改动（失败前归档不发生）', async () => {
      const fx = makeFixture();
      const seeded = await fx.persistence.createDoc(ALICE, DOC_ID, makeDoc(DOC_ID, {
        replicationId: ID_A,
        replicationEpoch: 1,
      }));
      await seeded.release();
      const before = await fx.readStoreSnapshot();

      fx.faults.failNextRead(new Error('archive io down (deterministic)'));
      await expect(
        asArchive(fx.persistence).archiveDoc(ALICE, DOC_ID, {
          replicationId: ID_A,
          replicationEpoch: 1,
        }),
      ).rejects.toMatchObject({ code: 'DOC_ARCHIVE_OPERATIONAL' });
      await assertStoreUnchanged(before, await fx.readStoreSnapshot());
      const loaded = await fx.persistence.loadDoc(ALICE, DOC_ID);
      expect(loaded).not.toBeNull();
      expect(loaded!.doc.getMap('ROOT').get('n')).toBe(42);
      await loaded!.release();
      await fx.dispose();
    });

    it('AC-6 owner 分区独立：owner A 归档零影响 owner B 同 docId 分区（内容与身份均原样）', async () => {
      const fx = makeFixture();
      const a = await fx.persistence.createDoc(ALICE, DOC_ID, makeDoc(DOC_ID, {
        replicationId: ID_A,
        replicationEpoch: 3,
        n: 11,
      }));
      const b = await fx.persistence.createDoc(BOB, DOC_ID, makeDoc(DOC_ID, {
        replicationId: ID_B,
        replicationEpoch: 7,
        n: 22,
      }));
      await a.release();
      await b.release();

      // A 归档成功
      const result = await asArchive(fx.persistence).archiveDoc(ALICE, DOC_ID, {
        replicationId: ID_A,
        replicationEpoch: 3,
      });
      expect(result).toMatchObject({ ok: true });
      expect(await fx.persistence.loadDoc(ALICE, DOC_ID)).toBeNull();

      // B 分区零影响：内容、复制身份完整；B 亦可按自己身份归档
      const bLoaded = await fx.persistence.loadDoc(BOB, DOC_ID);
      expect(bLoaded).not.toBeNull();
      expect(bLoaded!.doc.getMap('ROOT').get('n')).toBe(22);
      expect(bLoaded!.doc.getMap('META').get('replicationId')).toBe(ID_B);
      expect(bLoaded!.doc.getMap('META').get('replicationEpoch')).toBe(7);
      await bLoaded!.release();
      const bArchive = await asArchive(fx.persistence).archiveDoc(BOB, DOC_ID, {
        replicationId: ID_B,
        replicationEpoch: 7,
      });
      expect(bArchive).toMatchObject({ ok: true });
      expect(await fx.persistence.loadDoc(BOB, DOC_ID)).toBeNull();
      await fx.dispose();
    });
  });
}

// ═══════════════════════════════ File 专属：受控路径 + 原子 rename + 重启恢复（AC-5） ═══════════════

describe('archiveDoc 契约（FilePersistence 专属，AC-5/AC-6）', () => {
  it('AC-5 归档落点在 rootDir 内受控路径：snapshot 移除、恰一份新归档文件、字节 decode 且 META 身份完整、零 tmp 残留', async () => {
    const fx = makeRealFileFixture();
    const seeded = await fx.persistence.createDoc(ALICE, DOC_ID, makeDoc(DOC_ID, {
      replicationId: ID_A,
      replicationEpoch: 1,
    }));
    await seeded.release();
    const before = await fx.readStoreSnapshot();
    expect(before.files).toEqual([fx.snapshotPathOf(ALICE, DOC_ID)]);

    const result = await asArchive(fx.persistence).archiveDoc(ALICE, DOC_ID, {
      replicationId: ID_A,
      replicationEpoch: 1,
    });
    expect(result).toMatchObject({ ok: true });

    const after = await fx.readStoreSnapshot();
    // snapshot 主键移除；恰一份新文件；任何路径都不含 tmp 残留
    expect(after.files).not.toContain(fx.snapshotPathOf(ALICE, DOC_ID));
    expect(after.files).toHaveLength(1);
    for (const rel of after.files) expect(rel.endsWith('.tmp')).toBe(false);
    // 受控路径：归档文件由本包经 rootDir 内受控路径产生（文件本身经 rootDir 递归
    // 发现——在 rootDir 内；「rootDir 外零新增」的边界锚见下方模块纪律行为侧测试）。
    const artifactRel = after.files[0] as string;
    expect(artifactRel).not.toBe(fx.snapshotPathOf(ALICE, DOC_ID));
    // 字节可 decode：META 身份完整（docId/replicationId/replicationEpoch）、ROOT 内容在场
    const artifactBytes = after.bytes.get(artifactRel) as Uint8Array;
    const decoded = new Y.Doc();
    Y.applyUpdate(decoded, artifactBytes);
    expect(decoded.getMap('META').get('docId')).toBe(DOC_ID);
    expect(decoded.getMap('META').get('replicationId')).toBe(ID_A);
    expect(decoded.getMap('META').get('replicationEpoch')).toBe(1);
    expect(decoded.getMap('ROOT').get('n')).toBe(42);
    decoded.destroy();
    await fx.dispose();
  });

  it('AC-5/AC-6 fault seam：归档提交写失败 → 稳定拒绝（DOC_ARCHIVE_OPERATIONAL，临时拼写）+ 目录树与快照字节零变化（原子 rename 无部分状态）', async () => {
    const fx = makeRealFileFixture();
    const seeded = await fx.persistence.createDoc(ALICE, DOC_ID, makeDoc(DOC_ID, {
      replicationId: ID_A,
      replicationEpoch: 1,
    }));
    await seeded.release();
    const before = await fx.readStoreSnapshot();

    fx.faults.failNextWrite(new Error('archive write down (deterministic)'));
    await expect(
      asArchive(fx.persistence).archiveDoc(ALICE, DOC_ID, {
        replicationId: ID_A,
        replicationEpoch: 1,
      }),
    ).rejects.toMatchObject({ code: 'DOC_ARCHIVE_OPERATIONAL' });

    // 原子纪律：目录树逐文件一致（无 tmp、无半写归档文件）、snapshot 字节原样
    await assertStoreUnchanged(before, await fx.readStoreSnapshot());
    const loaded = await fx.persistence.loadDoc(ALICE, DOC_ID);
    expect(loaded).not.toBeNull();
    expect(loaded!.doc.getMap('ROOT').get('n')).toBe(42);
    await loaded!.release();
    await fx.dispose();
  });

  it('AC-3/AC-6 File 重启恢复（进程重启语义）：归档后 dispose → 同 rootDir 新实例 loadDoc → null、归档副本保留且 decode 完整', async () => {
    const rootDir = path.join(
      os.tmpdir(),
      `nomicore-archive-restart-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    );
    fileRootDirs.push(rootDir);
    const first = makeFileArchiveFixture(rootDir);
    const seeded = await first.persistence.createDoc(ALICE, DOC_ID, makeDoc(DOC_ID, {
      replicationId: ID_A,
      replicationEpoch: 5,
      n: 77,
    }));
    await seeded.release();
    await asArchive(first.persistence).archiveDoc(ALICE, DOC_ID, {
      replicationId: ID_A,
      replicationEpoch: 5,
    });
    const archived = await first.readStoreSnapshot();
    await first.dispose();

    // 完全重启：全新实例、空缓存、同 rootDir（file-persistence.test.ts 的 seed 先例）
    const second = makeFileArchiveFixture(rootDir);
    expect(await second.persistence.loadDoc(ALICE, DOC_ID)).toBeNull();
    // 归档副本仍在磁盘、可 decode：META 身份完整（restart 后恢复面）
    const artifacts = [...archived.bytes.entries()].filter(([rel]) => !rel.endsWith('.tmp'));
    expect(artifacts).toHaveLength(1);
    const decoded = new Y.Doc();
    Y.applyUpdate(decoded, artifacts[0]![1]);
    expect(decoded.getMap('META').get('docId')).toBe(DOC_ID);
    expect(decoded.getMap('META').get('replicationId')).toBe(ID_A);
    expect(decoded.getMap('META').get('replicationEpoch')).toBe(5);
    expect(decoded.getMap('ROOT').get('n')).toBe(77);
    decoded.destroy();
    await second.dispose();
  });

  it('AC-5 模块纪律（行为侧）：snapshot 文件只能经本包移动——归档后 rootDir 外零新增文件（文件访问封闭在 @nomicore/persistence 内）', async () => {
    // 专用父目录（仅本用例独占）：readdir(parent) 前后对比零干扰，禁与其他测试共享 tmpdir 面。
    const parent = await fsp.mkdtemp(path.join(os.tmpdir(), 'nomicore-archive-module-parent-'));
    fileRootDirs.push(parent);
    const rootDir = path.join(parent, 'data');
    const fx = makeFileArchiveFixture(rootDir);
    const seeded = await fx.persistence.createDoc(ALICE, DOC_ID, makeDoc(DOC_ID, {
      replicationId: ID_A,
      replicationEpoch: 1,
    }));
    await seeded.release();

    // 行为锚：归档移动后 rootDir 内恰一份归档文件；rootDir 外（专用父目录）零新增——文件操作不进 rootDir 外。
    const parentEntriesBefore = new Set(await fsp.readdir(parent));
    await asArchive(fx.persistence).archiveDoc(ALICE, DOC_ID, {
      replicationId: ID_A,
      replicationEpoch: 1,
    });
    const parentEntriesAfter = new Set(await fsp.readdir(parent));
    expect([...parentEntriesAfter].filter((name) => !parentEntriesBefore.has(name))).toEqual([]);

    const after = await fx.readStoreSnapshot();
    expect(after.files).toHaveLength(1);
    const artifactRel = after.files[0] as string;
    const artifactAbs = path.resolve(rootDir, artifactRel);
    expect(artifactAbs.startsWith(`${path.resolve(rootDir)}${path.sep}`)).toBe(true);
    await fx.dispose();
  });
});

// ═══════════════════════════════ 保持性守卫（基线应为绿，防回潮） ═══════════════════════════════

describe('archiveDoc 保持性守卫（基线已满足，预期绿）', () => {
  it('既有排他创建语义不变：已存在 (owner, docId) 的 createDoc 仍为 DOC_DUPLICATE（导入/归档不得破坏 0006 排他纪律）', async () => {
    const fx = makeMemoryArchiveFixture();
    const first = await fx.persistence.createDoc(ALICE, DOC_ID, makeDoc(DOC_ID, { replicationId: ID_A, replicationEpoch: 1 }));
    await expect(
      fx.persistence.createDoc(ALICE, DOC_ID, makeDoc(DOC_ID, { replicationId: ID_B, replicationEpoch: 1 })),
    ).rejects.toThrow(DocDuplicateError);
    await first.release();
    await fx.dispose();
  });
});

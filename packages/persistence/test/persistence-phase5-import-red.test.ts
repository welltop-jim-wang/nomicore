/**
 * SA6 红灯锚定 — issue #133（Phase 5: bootstrap import, archive, and guarded
 * replica reset）AC-2/AC-6 的 persistence 侧：从 detached、已核对身份的完整
 * Y.Doc 排他创建副本的受控复制导入 seam（临时契约名 `importDoc`，**待 SA1
 * 冻结**——ADR 0010 只称「内部受信任导入/受控复制导入能力」；行为断言才是锚）。
 *
 * 契约来源（docs/phases/phase-5-websocket-replication.md §实施切片 2 /
 * ADR 0006 issue #64 修订节「对 (owner.userId, docId) 排他创建……cache 命中
 * 即拒、store 存在性读见快照即拒、并发 claim 即拒」/ ADR 0010 §取代与关联
 * 「Persistence 不增加跨 owner catalog」）：
 * - AC-2：导入排他创建、绝不覆盖、绝不静默合并已提交内容（duplicate →
 *   已冻结 DOC_DUPLICATE 稳定分类——与 createDoc 排他面同款、同一已冻结错误族）；
 * - 0006 冻结约束：`META.docId === docId`（0006:50）——违约 → 稳定拒绝且零持久化
 *   写入（store 无残留、loadDoc 仍 null）；
 * - AC-6：同 key 并发导入 → 恰一个成功；导入后普通 createDoc 同 key 仍
 *   DOC_DUPLICATE（导入不为 create 面开旁路）；导入 slot 语义 = 可 loadDoc
 *   的持久副本（File 重启恢复）；owner 分区独立。
 *
 * 红灯机制（基线 = 公共面无导入 seam）：一切 `persistence.importDoc(...)` 调用
 * 抛 `TypeError: importDoc is not a function`——特征缺失的红。
 *
 * 锚定纪律：真实 yjs / 真实 MemoryPersistence·FilePersistence（真实 tmpdir），
 * 零 mock 本地服务、零源码 grep 断言；fake scheduler 脚本化驱动。
 *
 * 临时契约名/临时形状清单（全部在报告中显式标记）：
 * - `importDoc(owner, docId, doc): Promise<DocHandle>`（临时名——语义 = 排他
 *   创建持久副本，与 createDoc 同通道结果；doc 为 detached 完整 Y.Doc 输入）；
 * - 身份违约错误码 `DOC_IMPORT_IDENTITY_MISMATCH`（临时拼写；duplicate 用已
 *   冻结 DOC_DUPLICATE——「排他创建」「绝不覆盖」的稳定分类既有先例）。
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
  type DocHandle,
  type DocPersistence,
  type User,
} from '@nomicore/persistence';
import {
  createTestScheduler,
  type TestScheduler,
} from '@nomicore/persistence/testing';

// ═══════════════════════════════ 契约面本地声明（临时名，待 SA1 冻结） ═══════════════

/** 受控复制导入 seam（临时名 importDoc；排他创建持久副本）。 */
interface ImportCapablePersistence {
  readonly importDoc: (owner: User, docId: string, doc: Y.Doc) => Promise<DocHandle>;
}

function asImport(persistence: DocPersistence): DocPersistence & ImportCapablePersistence {
  return persistence as unknown as DocPersistence & ImportCapablePersistence;
}

/** 完整 Y.Doc（detached 输入副本）：SCHEMA 信封 + META.docId/createdAt + 复制身份 + ROOT。 */
function makeHubDoc(
  docId: string,
  opts: { replicationId?: string; replicationEpoch?: number; n?: number; metaDocId?: string } = {},
): Y.Doc {
  const doc = new Y.Doc();
  const schema = doc.getMap('SCHEMA');
  schema.set('lang', 'vfsl');
  schema.set('version', 1);
  schema.set('id', 'phase5-import-red');
  schema.set('text', 'type ROOT = { n: number; };\n');
  const meta = doc.getMap('META');
  meta.set('docId', opts.metaDocId ?? docId);
  meta.set('createdAt', 1_700_000_123_456);
  if (opts.replicationId !== undefined) meta.set('replicationId', opts.replicationId);
  if (opts.replicationEpoch !== undefined) meta.set('replicationEpoch', opts.replicationEpoch);
  doc.getMap('ROOT').set('n', opts.n ?? 42);
  return doc;
}

const ALICE: User = Object.freeze({ userId: 'u-alice' });
const BOB: User = Object.freeze({ userId: 'u-bob' });
const DOC_ID = 'ns-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ID_A = 'a'.repeat(32);
const ID_B = 'b'.repeat(32);

// ═══════════════════════════════ 双 adapter 夹具 ═══════════════════════════════

interface ImportFixture {
  readonly persistence: DocPersistence;
  readonly scheduler: TestScheduler;
  /** 真实持久化面（Memory = hook 存储 Map；File = rootDir 递归文件清单）。 */
  readonly readStoreFiles: () => Promise<string[]>;
  readonly dispose: () => Promise<void>;
}

function makeMemoryImportFixture(): ImportFixture {
  const store = new Map<string, Uint8Array>();
  const scheduler = createTestScheduler();
  const persistence = createMemoryPersistence({
    scheduler,
    schedule: { debounceMs: 1, maxDirtyMs: 1 },
    writeSnapshot: async (key, snapshot) => {
      store.set(key, snapshot.slice());
    },
    readSnapshot: async (key) => store.get(key),
  });
  return {
    persistence,
    scheduler,
    readStoreFiles: async () => [...store.keys()].sort(),
    dispose: async () => {
      await (persistence as unknown as { dispose(): Promise<void> }).dispose();
    },
  };
}

const fileRootDirs: string[] = [];
function makeFileImportFixture(rootDir?: string): ImportFixture {
  const dir =
    rootDir ??
    path.join(
      os.tmpdir(),
      `nomicore-import-red-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    );
  if (rootDir === undefined) fileRootDirs.push(dir);
  const scheduler = createTestScheduler();
  const persistence = new FilePersistence({
    rootDir: dir,
    scheduler,
    schedule: { debounceMs: 1, maxDirtyMs: 1 },
  });
  return {
    persistence,
    scheduler,
    readStoreFiles: async () => {
      const files: string[] = [];
      async function walk(dir: string, prefix: string): Promise<void> {
        let entries;
        try {
          entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch (error) {
          // 目录尚未创建（零写入拒绝路径下 rootDir 不存在）≡ 空 store——观察意图
          // 「零持久化写入」的必然面；ENOENT 视为空清单（fixture 管道容错，非断言）。
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
          throw error;
        }
        for (const entry of entries) {
          const rel = `${prefix}${entry.name}`;
          if (entry.isDirectory()) await walk(path.join(dir, entry.name), `${rel}/`);
          else files.push(rel);
        }
      }
      await walk(dir, '');
      return files.sort();
    },
    dispose: async () => {
      await (persistence as unknown as { dispose(): Promise<void> }).dispose();
    },
  };
}

afterEach(async () => {
  await Promise.all(
    fileRootDirs.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })),
  );
});

const fixtures: Record<string, () => ImportFixture> = {
  MemoryPersistence: makeMemoryImportFixture,
  FilePersistence: makeFileImportFixture,
};

// ═══════════════════════════════ 共享矩阵（双 adapter 平行验收，ADR 0006:157-159 纪律） ═══════════════

for (const [adapterName, makeFixture] of Object.entries(fixtures)) {
  describe(`受控复制导入 importDoc 契约（${adapterName}，AC-2/AC-6）`, () => {
    it('AC-2 成功导入：排他创建持久副本——可 loadDoc、内容与 META 身份完整（含复制字段）', async () => {
      const fx = makeFixture();
      const handle = await asImport(fx.persistence).importDoc(ALICE, DOC_ID, makeHubDoc(DOC_ID, {
        replicationId: ID_A,
        replicationEpoch: 1,
        n: 123,
      }));

      // 导入即持久副本：loadDoc 独立 handle 且共享同一 live doc；内容与身份完整
      const loaded = await fx.persistence.loadDoc(ALICE, DOC_ID);
      expect(loaded).not.toBeNull();
      expect(loaded!.doc.getMap('ROOT').get('n')).toBe(123);
      expect(loaded!.doc.getMap('META').get('docId')).toBe(DOC_ID);
      expect(loaded!.doc.getMap('META').get('replicationId')).toBe(ID_A);
      expect(loaded!.doc.getMap('META').get('replicationEpoch')).toBe(1);
      await handle.release();
      await loaded!.release();
      await fx.dispose();
    });

    it('AC-2 duplicate（已存在 committed snapshot）：稳定拒绝 DOC_DUPLICATE（已冻结分类）+ 零覆盖零合并', async () => {
      const fx = makeFixture();
      const existing = await fx.persistence.createDoc(ALICE, DOC_ID, makeHubDoc(DOC_ID, {
        replicationId: ID_B,
        replicationEpoch: 9,
        n: 1,
      }));
      await existing.release();
      const filesBefore = await fx.readStoreFiles();

      // 导入撞已提交内容：绝不覆盖/合并（0006：store 存在性读见快照即拒）
      await expect(
        asImport(fx.persistence).importDoc(ALICE, DOC_ID, makeHubDoc(DOC_ID, {
          replicationId: ID_A,
          replicationEpoch: 1,
          n: 999,
        })),
      ).rejects.toThrow(DocDuplicateError);

      expect(await fx.readStoreFiles()).toEqual(filesBefore);
      const loaded = await fx.persistence.loadDoc(ALICE, DOC_ID);
      expect(loaded).not.toBeNull();
      expect(loaded!.doc.getMap('ROOT').get('n')).toBe(1); // 原内容未被覆盖
      expect(loaded!.doc.getMap('META').get('replicationId')).toBe(ID_B); // 身份未被合并
      await loaded!.release();
      await fx.dispose();
    });

    it('AC-2 duplicate（cache 命中即拒）：同 key 同时两个导入 → 恰一个成功、一个 DOC_DUPLICATE', async () => {
      const fx = makeFixture();
      const doc = makeHubDoc(DOC_ID, { replicationId: ID_A, replicationEpoch: 1, n: 9 });
      const [first, second] = await Promise.allSettled([
        asImport(fx.persistence).importDoc(ALICE, DOC_ID, doc),
        asImport(fx.persistence).importDoc(ALICE, DOC_ID, makeHubDoc(DOC_ID, {
          replicationId: ID_A,
          replicationEpoch: 1,
          n: 9,
        })),
      ]);

      const settled = [first, second];
      const fulfilled = settled.filter((r) => r.status === 'fulfilled');
      const rejected = settled.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(DocDuplicateError);

      // 恰一份内容在场：winner 的 n=9 文档完整落盘
      const loaded = await fx.persistence.loadDoc(ALICE, DOC_ID);
      expect(loaded).not.toBeNull();
      expect(loaded!.doc.getMap('ROOT').get('n')).toBe(9);
      await (fulfilled[0] as PromiseFulfilledResult<DocHandle>).value.release();
      await loaded!.release();
      await fx.dispose();
    });

    it('AC-2 跨面排他：导入后普通 createDoc 同 key 仍 DOC_DUPLICATE（导入不为 create 面开旁路）', async () => {
      const fx = makeFixture();
      const handle = await asImport(fx.persistence).importDoc(ALICE, DOC_ID, makeHubDoc(DOC_ID, {
        replicationId: ID_A,
        replicationEpoch: 1,
      }));
      await handle.release();

      await expect(
        fx.persistence.createDoc(ALICE, DOC_ID, makeHubDoc(DOC_ID, {
          replicationId: ID_B,
          replicationEpoch: 2,
        })),
      ).rejects.toThrow(DocDuplicateError);
      await fx.dispose();
    });

    it('0006 冻结约束：META.docId ≠ docId → 稳定拒绝（DOC_IMPORT_IDENTITY_MISMATCH，临时拼写）+ 零持久化写入', async () => {
      const fx = makeFixture();
      // 伪造「他人身份」的文档：META.docId 与请求 docId 不符——受信导入不得把
      // 别名字面写进本 (owner, docId) 分区（0006:50 冻结规则）。
      await expect(
        asImport(fx.persistence).importDoc(ALICE, DOC_ID, makeHubDoc(DOC_ID, {
          metaDocId: 'ns-cccccccccccccccccccccccccccccccc',
          replicationId: ID_A,
          replicationEpoch: 1,
        })),
      ).rejects.toMatchObject({ code: 'DOC_IMPORT_IDENTITY_MISMATCH' });

      // 零持久化写入：store 无残留、loadDoc 仍 null
      expect(await fx.readStoreFiles()).toEqual([]);
      expect(await fx.persistence.loadDoc(ALICE, DOC_ID)).toBeNull();
      await fx.dispose();
    });

    it('AC-6 owner 分区独立：owner A 导入零影响 owner B 同 docId 分区', async () => {
      const fx = makeFixture();
      const a = await asImport(fx.persistence).importDoc(ALICE, DOC_ID, makeHubDoc(DOC_ID, {
        replicationId: ID_A,
        replicationEpoch: 1,
        n: 11,
      }));
      const b = await asImport(fx.persistence).importDoc(BOB, DOC_ID, makeHubDoc(DOC_ID, {
        replicationId: ID_B,
        replicationEpoch: 2,
        n: 22,
      }));
      await a.release();
      await b.release();

      const bLoaded = await fx.persistence.loadDoc(BOB, DOC_ID);
      expect(bLoaded).not.toBeNull();
      expect(bLoaded!.doc.getMap('ROOT').get('n')).toBe(22);
      expect(bLoaded!.doc.getMap('META').get('replicationEpoch')).toBe(2);
      await bLoaded!.release();
      await fx.dispose();
    });
  });
}

// ═══════════════════════════════ File 重启恢复（phase 文档 §测试 seam：进程重启验收） ═══════════════

describe('importDoc 契约（FilePersistence 重启恢复，AC-6）', () => {
  it('导入持久副本经重启恢复：File dispose → 同 rootDir 新实例 loadDoc → 内容与复制身份完整', async () => {
    const rootDir = path.join(
      os.tmpdir(),
      `nomicore-import-restart-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    );
    fileRootDirs.push(rootDir);
    const first = makeFileImportFixture(rootDir);
    const handle = await asImport(first.persistence).importDoc(ALICE, DOC_ID, makeHubDoc(DOC_ID, {
      replicationId: ID_A,
      replicationEpoch: 4,
      n: 555,
    }));
    await handle.release();
    await first.dispose();

    const second = makeFileImportFixture(rootDir);
    const loaded = await second.persistence.loadDoc(ALICE, DOC_ID);
    expect(loaded).not.toBeNull();
    expect(loaded!.doc.getMap('ROOT').get('n')).toBe(555);
    expect(loaded!.doc.getMap('META').get('replicationId')).toBe(ID_A);
    expect(loaded!.doc.getMap('META').get('replicationEpoch')).toBe(4);
    await loaded!.release();
    await second.dispose();
  });
});

// ═══════════════════════════════ 保持性守卫（基线应绿） ═══════════════════════════════

describe('importDoc 保持性守卫（基线已满足，预期绿）', () => {
  it('导入不新增跨 owner catalog：A/B 两分区同 docId 各自独立后，删除面仍未扩展（无 list/enumerate 公共方法）', async () => {
    const fx = makeMemoryImportFixture();
    const seam = fx.persistence as unknown as Record<string, unknown>;
    // 0009/0010：Persistence 不提供跨 owner catalog 或 list/enumerate/delete 公共面
    expect('listDocs' in seam).toBe(false);
    expect('enumerate' in seam).toBe(false);
    expect('removeDoc' in seam).toBe(false);
    expect('deleteDoc' in seam).toBe(false);
    await fx.dispose();
  });
});

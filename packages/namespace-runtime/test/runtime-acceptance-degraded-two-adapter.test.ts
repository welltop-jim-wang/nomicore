/**
 * 验收测试 — issue #93 AC4：persistence degraded/recovery、检查后降级竞态与最新 live
 * Y.Doc 最终持久化 —— MemoryPersistence 与 FilePersistence 两 Adapter 平行验收。
 *
 * 契约来源：
 * - 任务简报（issue #93）AC4：「persistence degraded/recovery、检查后降级竞态与最新
 *   live Y.Doc 最终持久化通过两 Adapter 验收」；
 * - docs/adr/0006（#79 修订）：「saveDoc 是 mutation 后的 dirty notification：只要租约
 *   有效……saveDoc 必须递增 dirtyGeneration 并 resolve——entry 处于 persistence-degraded
 *   不构成拒绝理由；已提交进 live Y.Doc 的事务由持久层内部 retry 以完整 Y.Doc 状态最终
 *   持久化」；「gate 检查通过后才转为 degraded 的 mutation 不属『后续』写入：其内存事务
 *   保留、saveDoc 正常登记、由 retry 覆盖最新完整 live Y.Doc」；「MemoryPersistence 与
 *   FilePersistence 以平行验收套件覆盖同一状态契约」；
 * - docs/adr/0008（persistence-degraded gate）：「gate 是瞬时观察：检查后才发生的降级
 *   不撤销已提交事务，dirty notification 仍必须登记最新 live doc」。
 *
 * 本文件锚点（全部可观测运行时行为）：
 * - 同一场景函数先后在两个真实 Adapter（Memory 公开 I/O hook / File 真实磁盘）上执行——
 *   平行验收套件，两 Adapter 断言文本一致；
 * - FilePersistence 的降级注入不 mock I/O：在 rootDir/users 位置放一个普通文件，使真实
 *   mkdir 失败（ENOTDIR）——真实 fs 语义驱动的确定性失败；恢复 = 移除该文件；
 * - 每次 loadFresh 经全新 Adapter 实例（空缓存）+ 共享 store/磁盘读取——跨实例证明
 *   「最终持久化」而非 live-doc 别名。
 *
 * 验收记录：本文件首次运行即「已绿/存量能力」证据（#79/#89–#92 均已合入）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DocHandle, User } from '@nomicore/persistence';
import { createMemoryPersistence, FilePersistence } from '@nomicore/persistence';
import { realPersistenceScheduler } from './real-persistence-scheduler.js';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import type { NamespaceRuntime } from '../src/index.js';

const OWNER: User = { userId: 'u-alice' };
const TEXT = 'type ROOT = { n: number; a: string; };';
const ENVELOPE = { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT } as const;
const ROOT0 = { n: 1, a: 'x' };
const TEXT_V2 = 'type ROOT = { n: number; a: string; b: boolean; };';
const ENVELOPE_V2 = { lang: 'vfsl', version: 1, id: 'ns-2', text: TEXT_V2 } as const;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function readValue(runtime: NamespaceRuntime, p: readonly (string | number)[]): unknown {
  const read = runtime.readData(p);
  if (!read.ok) throw new Error(`读取应成功，实际 code=${read.code}`);
  return read.value;
}

async function makeDoc(): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
  doc.getMap('META').set('docId', 'ns-1');
  doc.getMap('META').set('createdAt', 1_700_000_000_000);
  const root = doc.getMap('ROOT');
  for (const [k, v] of Object.entries(ROOT0)) root.set(k, v);
  return doc;
}

/** 两 Adapter 的最小公共面：场景只经它驱动（全部公开 API，无包内 seam）。 */
interface AdapterFixture {
  readonly handle: DocHandle;
  readonly doc: Y.Doc;
  /** writer.saveDoc(handle)，由构造方绑定的窄接缝。 */
  readonly save: () => Promise<void>;
  setFailing(failing: boolean): Promise<void>;
  /** 全新 Adapter 实例（空缓存）loadDoc；返回 loaded doc 或 null。 */
  loadFresh(): Promise<{ doc: Y.Doc; release: () => Promise<void> } | null>;
  cleanup(): Promise<void>;
}

interface AdapterCtx {
  create(): Promise<AdapterFixture>;
}

/** MemoryPersistence 引脚：共享 store 经公开 I/O hook；降级 = write hook throw。 */
function memoryCtx(): AdapterCtx {
  return {
    async create() {
      const store = new Map<string, Uint8Array>();
      let failing = false;
      const writer = createMemoryPersistence({
        scheduler: realPersistenceScheduler,
        schedule: { debounceMs: 5, maxDirtyMs: 60 },
        writeSnapshot: async (key, snapshot) => {
          if (failing) throw new Error('io down (deterministic)');
          store.set(key, snapshot.slice());
        },
      });
      const reader = createMemoryPersistence({
        scheduler: realPersistenceScheduler,
        readSnapshot: async (key) => store.get(key),
      });
      const doc = await makeDoc();
      const handle = await writer.createDoc(OWNER, 'ns-1', doc);
      return {
        handle,
        doc,
        save: () => writer.saveDoc(handle),
        setFailing: async (f) => {
          failing = f;
        },
        loadFresh: async () => {
          const loaded = await reader.loadDoc(OWNER, 'ns-1');
          return loaded === null ? null : { doc: loaded.doc, release: () => loaded.release() };
        },
        cleanup: async () => {
          await handle.release().catch(() => {});
          await reader.dispose();
          await writer.dispose();
        },
      };
    },
  };
}

/** FilePersistence 引脚：真实磁盘；降级 = 把 userDir 目录替换为普通文件（mkdir 真失败）。
 *  注意：createDoc 自身先落初始快照（rootDir/users/u-alice/ 已存在）——故先删除该目录
 *  再用同名普通文件占位，此后任何 flush 的 mkdir 都真实失败（ENOTDIR），恢复 = 移除文件。 */
function fileCtx(): AdapterCtx {
  return {
    async create() {
      const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nsr-degraded-'));
      const usersDir = path.join(rootDir, 'users');
      const blockerPath = usersDir;
      const mk = () => new FilePersistence({ rootDir, scheduler: realPersistenceScheduler, schedule: { debounceMs: 5, maxDirtyMs: 60 } });
      const writer = mk();
      const doc = await makeDoc();
      const handle = await writer.createDoc(OWNER, 'ns-1', doc);
      return {
        handle,
        doc,
        save: () => writer.saveDoc(handle),
        setFailing: async (f) => {
          if (f) {
            // 删除整个 users 分区目录（含 createDoc 初始快照）→ 同一路径放普通文件占位；
            // 后续任何 flush 的 mkdir('users/<userId>', recursive) 都真实失败（ENOTDIR）
            await fsp.rm(usersDir, { recursive: true, force: true });
            await fsp.writeFile(blockerPath, 'block mkdir');
          } else {
            await fsp.rm(blockerPath, { force: true });
          }
        },
        loadFresh: async () => {
          const loaded = await mk().loadDoc(OWNER, 'ns-1');
          return loaded === null ? null : { doc: loaded.doc, release: () => loaded.release() };
        },
        cleanup: async () => {
          await handle.release().catch(() => {});
          await writer.dispose();
          await fsp.rm(rootDir, { recursive: true, force: true });
        },
      };
    },
  };
}

/**
 * AC4 平行场景（两 Adapter 同一断言集）：
 * 1. gate 通过后降级：首个 mutateData 的 writable gate 检查时 handle 仍 ready（尚无失败
 *    flush）→ 提交 ok + saveDoc 正常登记；
 * 2. entry 转 persistence-degraded（flush 失败）→ Runtime status：rootWrite 关、read 开、
 *    schema 保持 ready——degraded 不阻止 P0/read；
 * 3. 第二笔（后续写）被新降级 gate 拦截：RUNTIME_WRITE_DISABLED、零写入（doc 字节不变）；
 * 4. 恢复 I/O → 持久层 retry 覆盖最新完整 live Y.Doc（含降级前登记的写）→ 全新实例
 *    读到第一笔的值（最终持久化证明）；
 * 5. 恢复后第三笔写成功 → 全新实例再读到第三笔值。
 */
async function runDegradedRecoveryAcceptance(ctx: AdapterCtx): Promise<void> {
  const fx = await ctx.create();
  const runtime = createNamespaceRuntimeWithSeam({ handle: fx.handle, notifyDirty: fx.save });
  await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');

  try {
    // 1) 降级注入先于首次 flush：gate 检查瞬时 handle 仍 ready
    await fx.setFailing(true);
    const first = await runtime.mutateData({ op: 'set', path: ['n'], value: 22 });
    expect(first).toEqual({ ok: true });
    expect(readValue(runtime, ['n'])).toBe(22);

    // 2) flush 失败 → entry persistence-degraded；Runtime 位值如实
    await expect.poll(() => fx.handle.getStatus(), { interval: 10, timeout: 5_000 }).toBe('persistence-degraded');
    const status = runtime.getStatus();
    expect(status.rootWrite.enabled).toBe(false);
    expect(status.schemaWrite.enabled).toBe(false);
    expect(status.read.enabled).toBe(true);
    expect(status.schema.state).toBe('ready');
    expect(status.lifecycle).toBe('ready');

    // 3) 后续写被拦：RUNTIME_WRITE_DISABLED、零写入（doc 字节不变）
    const before = [...Y.encodeStateAsUpdate(fx.doc)];
    const blocked = await runtime.mutateData({ op: 'set', path: ['n'], value: 23 });
    expect(blocked.ok).toBe(false);
    expect(JSON.stringify(blocked)).toContain('RUNTIME_WRITE_DISABLED');
    expect([...Y.encodeStateAsUpdate(fx.doc)]).toEqual(before);
    expect(readValue(runtime, ['n'])).toBe(22);

    // 4) 恢复 I/O → retry 覆盖最新 live doc → 全新实例看到降级前第一笔的值（最终持久化）
    await fx.setFailing(false);
    await expect.poll(() => fx.handle.getStatus(), { interval: 10, timeout: 5_000 }).toBe('ready');
    const fresh1 = await fx.loadFresh();
    expect(fresh1).not.toBeNull();
    if (fresh1 === null) return;
    expect(fresh1.doc.getMap('ROOT').get('n')).toBe(22);
    expect(fresh1.doc.getMap('ROOT').get('a')).toBe('x');
    await fresh1.release();

    // 5) 恢复后第三笔写成功并落盘 → 再次全新实例读到
    const third = await runtime.mutateData({ op: 'set', path: ['n'], value: 31 });
    expect(third).toEqual({ ok: true });
    await sleep(100);
    await expect.poll(() => fx.handle.getStatus(), { interval: 10, timeout: 5_000 }).toBe('ready');
    const fresh2 = await fx.loadFresh();
    expect(fresh2).not.toBeNull();
    if (fresh2 === null) return;
    expect(fresh2.doc.getMap('ROOT').get('n')).toBe(31);
    await fresh2.release();
  } finally {
    await fx.cleanup();
  }
}

/** issue #102 矩阵补口：与上面的 ROOT 场景互补，以 SCHEMA replacement 覆盖
 * gate 后降级、degraded gate、recovery，以及 close barrier 后最后 generation 的持久化。 */
async function runSchemaDegradedAndCloseGenerationAcceptance(ctx: AdapterCtx): Promise<void> {
  const fx = await ctx.create();
  const runtime = createNamespaceRuntimeWithSeam({ handle: fx.handle, notifyDirty: fx.save });
  await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');

  try {
    await fx.setFailing(true);
    // writable gate 通过后才由异步 flush 降级：SCHEMA+ROOT 已提交且 dirty 已登记。
    const replacement = await runtime.replaceSchema({
      schema: { ...ENVELOPE_V2 },
      root: { n: 20, a: 'schema', b: true },
    });
    expect(replacement).toEqual({ ok: true });
    expect(runtime.getActiveSchema()?.id).toBe('ns-2');
    expect(readValue(runtime, ['b'])).toBe(true);
    await expect.poll(() => fx.handle.getStatus(), { interval: 10, timeout: 5_000 }).toBe('persistence-degraded');

    // degraded 后的新 SCHEMA 写被 gate 拦住且不改 live generation。
    const before = [...Y.encodeStateAsUpdate(fx.doc)];
    const blocked = await runtime.replaceSchema({ schema: { ...ENVELOPE } });
    expect(blocked.ok).toBe(false);
    expect(JSON.stringify(blocked)).toContain('RUNTIME_WRITE_DISABLED');
    expect([...Y.encodeStateAsUpdate(fx.doc)]).toEqual(before);

    await fx.setFailing(false);
    await expect.poll(() => fx.handle.getStatus(), { interval: 10, timeout: 5_000 }).toBe('ready');

    // 最后一代不等待 debounce：成功 ROOT write 后立即 close，barrier 必须先排空 notifier；
    // release 后 persistence entry 仍需 flush 到 savedGeneration === dirtyGeneration 才可淘汰。
    expect(await runtime.mutateData({ op: 'set', path: ['n'], value: 99 })).toEqual({ ok: true });
    await runtime.close();
    expect(fx.handle.getStatus()).toBe('released');

    await expect.poll(async () => {
      const probe = await fx.loadFresh();
      if (probe === null) return undefined;
      const value = probe.doc.getMap('ROOT').get('n');
      await probe.release();
      return value;
    }, { interval: 10, timeout: 5_000 }).toBe(99);
    const fresh = await fx.loadFresh();
    expect(fresh).not.toBeNull();
    if (fresh === null) return;
    expect(fresh.doc.getMap('SCHEMA').get('id')).toBe('ns-2');
    expect(fresh.doc.getMap('SCHEMA').get('text')).toBe(TEXT_V2);
    expect(fresh.doc.getMap('ROOT').get('n')).toBe(99);
    expect(fresh.doc.getMap('ROOT').get('a')).toBe('schema');
    expect(fresh.doc.getMap('ROOT').get('b')).toBe(true);
    await fresh.release();
  } finally {
    await runtime.close().catch(() => {});
    await fx.cleanup();
  }
}

describe('AC4：persistence degraded/recovery 平行验收（MemoryPersistence）', () => {
  it('检查后降级竞态 → gate 拦截后续写 → retry 最终持久化最新 live doc（全新实例可见）', async () => {
    await runDegradedRecoveryAcceptance(memoryCtx());
  });
});

describe('AC4：persistence degraded/recovery 平行验收（FilePersistence）', () => {
  it('检查后降级竞态 → gate 拦截后续写 → retry 最终持久化最新 live doc（磁盘恢复可见）', async () => {
    await runDegradedRecoveryAcceptance(fileCtx());
  });
});

describe.each([
  ['MemoryPersistence', memoryCtx],
  ['FilePersistence', fileCtx],
] as const)('issue #102：%s 的 SCHEMA degraded/recovery + close 最后一代矩阵', (_name, makeCtx) => {
  it('SCHEMA gate 后降级仍登记 → degraded 拦后续 SCHEMA → recovery → ROOT 最后一代经 close 排空并持久化', async () => {
    await runSchemaDegradedAndCloseGenerationAcceptance(makeCtx());
  });
});

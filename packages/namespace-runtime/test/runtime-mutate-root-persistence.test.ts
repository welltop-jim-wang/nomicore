/**
 * SA6 红灯验收测试 — @nomicore/namespace-runtime validated ROOT write 与真实
 * Persistence 集成（issue #90 / 任务简报 AC7 + AC10，功能开发）。
 *
 * 契约来源：
 * - docs/adr/0008「单一 write sequencer」节：「notifyDirty 是由构造方绑定
 *   persistence.saveDoc(handle) 的窄接缝；成功只表示 live commit 与 dirty notification
 *   已登记，不表示已经落盘」；
 * - docs/adr/0008（persistence-degraded）：「检查后才发生的降级不撤销已提交事务，
 *   dirty notification 仍必须登记最新 live doc」；
 * - docs/adr/0006（#79 修订）：「saveDoc 是 mutation 后的 dirty notification：只要租约
 *   有效……saveDoc 必须递增 dirtyGeneration 并 resolve——entry 处于
 *   persistence-degraded 不构成拒绝理由；已提交进 live Y.Doc 的事务由持久层内部 retry
 *   以完整 Y.Doc 状态最终持久化」；「gate 检查通过后才转为 degraded 的 mutation 不属
 *   『后续』写入：其内存事务保留、saveDoc 正常登记、由 retry 覆盖最新完整 live Y.Doc」；
 * - 任务简报 AC7（persistence-degraded 阻止 ROOT write 但不阻止 read/P0；检查后降级的写
 *   仍登记最新 dirty 状态）与 AC10（真实 Persistence 集成测试）。
 *
 * 本文件冻结的契约锚点（SA1/SA3 验收行为锚）：
 * - seam 注入 `notifyDirty: () => persistence.saveDoc(handle)`（生产绑定形态的测试直译）；
 * - 完整链路（E2E）：真实内存 Persistence（公开 I/O hook 接线下共享 store）→
 *   createDoc 提交初始快照 → Runtime（真实 P0/active schema）→ mutateRoot ok:true →
 *   同槽 saveDoc 登记 → debounce flush 落盘 → **全新 Persistence 实例** loadDoc 观察到
 *   Runtime 写入的 ROOT 值（跨实例持久化证明，非 live-doc 别名）；
 * - degraded 链：flush 失败 → entry persistence-degraded → 下一次 mutateRoot 被 gate
 *   拦截（RUNTIME_WRITE_DISABLED、零写入）；恢复 I/O → retry 覆盖最新 live doc →
 *   全新实例 loadDoc 看到降级前那次 mutateRoot 的值（「检查后降级的写仍登记最新 dirty
 *   状态」的端到端证明）。
 *
 * 红灯现状（构造性红灯）：runtime.mutateRoot 尚未实现——首个 mutateRoot 调用即红。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, User } from '@nomicore/persistence';
import { createMemoryPersistence } from '@nomicore/persistence';
import { createNamespaceRuntimeWithSeam } from '../src/index.js';
import type { NamespaceRuntime } from '../src/index.js';

const OWNER: User = { userId: 'u-alice' };
const TEXT_VALID = 'type ROOT = { n: number; a: string; };';
const ENVELOPE = { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_VALID } as const;
const ROOT0 = { n: 1, a: 'x' };

interface MutateRootRuntime extends NamespaceRuntime {
  mutateRoot: (mutation: unknown) => Promise<{ ok: true } | { ok: false; issues: unknown[] }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function readValue(runtime: NamespaceRuntime, path: readonly (string | number)[]): unknown {
  const read = runtime.read(path);
  if (!read.ok) throw new Error(`读取应成功，实际 code=${read.code}`);
  return read.value;
}

/** 真实内存 Persistence × 共享 store（全部经公开 I/O hook——无任何包内 seam 走线）。 */
function makePersistences(opts: {
  failWrite?: () => boolean;
  schedule?: { debounceMs: number; maxDirtyMs: number };
}): {
  writer: ReturnType<typeof createMemoryPersistence>;
  reader: ReturnType<typeof createMemoryPersistence>;
  store: Map<string, Uint8Array>;
} {
  const store = new Map<string, Uint8Array>();
  const writer = createMemoryPersistence({
    schedule: opts.schedule ?? { debounceMs: 5, maxDirtyMs: 60 },
    writeSnapshot: async (key, snapshot) => {
      if (opts.failWrite?.()) throw new Error('io down (deterministic)');
      store.set(key, snapshot.slice());
    },
  });
  const reader = createMemoryPersistence({
    readSnapshot: async (key) => store.get(key),
  });
  return { writer, reader, store };
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

async function readyRuntime(handle: DocHandle, notifier: () => Promise<void>): Promise<MutateRootRuntime> {
  const runtime = createNamespaceRuntimeWithSeam({
    handle,
    notifyDirty: notifier,
  }) as unknown as MutateRootRuntime;
  await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
  return runtime;
}

describe('namespace-runtime validateRoot write × 真实 Persistence 集成（AC7/AC10）', () => {
  it('AC10 幸福链路：Runtime 写 → saveDoc 登记 → flush → 全新 Persistence 实例 loadDoc 观察到写入值（跨实例持久化）', async () => {
    const { writer, reader } = makePersistences({});
    const doc = await makeDoc();
    const handle = await writer.createDoc(OWNER, 'ns-1', doc);

    // 构造方绑定生产形态窄接缝：notifyDirty = persistence.saveDoc(handle)
    const runtime = await readyRuntime(handle, () => writer.saveDoc(handle));

    // 前向断言：写 Promise 完成（完成信号 = 含 dirty notification 登记）
    const res = await runtime.mutateRoot({ op: 'set', path: ['n'], value: 42 });
    expect(res).toEqual({ ok: true });

    // read-your-write（后向闭环：await 写 Promise 后 read 观察提交值）
    expect(readValue(runtime, ['n'])).toBe(42);

    // 等待 debounce flush 落盘（真实时钟 + 短调度）
    await sleep(80);
    expect(handle.getStatus()).toBe('ready');

    // 跨实例持久化证明：全新 Persistence 实例（空缓存）经共享 store 读到 Runtime 写入
    const loaded = await reader.loadDoc(OWNER, 'ns-1');
    expect(loaded).not.toBeNull();
    if (loaded === null) return;
    expect(loaded.doc.getMap('ROOT').get('n')).toBe(42);
    expect(loaded.doc.getMap('ROOT').get('a')).toBe('x');

    await loaded.release();
    await handle.release();
    await reader.dispose();
    await writer.dispose();
  });

  it('AC7 + AC10 degraded 全链：gate 通过后降级 → 写照常提交并登记 → 后续写被拦 → retry 覆盖 → 全新实例看到该写', async () => {
    let failFlush = false;
    const { writer, reader } = makePersistences({ failWrite: () => failFlush });
    const doc = await makeDoc();
    const handle = await writer.createDoc(OWNER, 'ns-1', doc);

    // 降级注入时机先于首次 flush：gate 检查瞬时时 handle 仍 ready（尚无失败 flush），
    // 而该写自己的 flush 必然失败 → 「检查后才降级」的确定性编排
    failFlush = true;
    const runtime = await readyRuntime(handle, () => writer.saveDoc(handle));

    // 第一笔：writable gate 通过（检查时点尚未降级）→ 提交 ok + saveDoc 登记（不撤销、不拒绝）
    const res = await runtime.mutateRoot({ op: 'set', path: ['n'], value: 22 });
    expect(res).toEqual({ ok: true });
    expect(readValue(runtime, ['n'])).toBe(22);

    // 落盘失败 → entry persistence-degraded（dirty notification 已登记，不构成拒绝）
    await expect.poll(() => handle.getStatus(), { interval: 10, timeout: 5_000 }).toBe('persistence-degraded');
    const status = runtime.getStatus();
    expect(status.rootWrite.enabled).toBe(false);
    expect(status.read.enabled).toBe(true);
    expect(status.schema.state).toBe('ready'); // degraded 不阻止 P0

    // 第二笔：新降级 gate 拦截 → RUNTIME_WRITE_DISABLED，文档不变
    const before = [...Y.encodeStateAsUpdate(doc)];
    const blocked = await runtime.mutateRoot({ op: 'set', path: ['n'], value: 23 });
    expect(blocked).toMatchObject({ ok: false });
    expect(JSON.stringify(blocked)).toContain('RUNTIME_WRITE_DISABLED');
    expect([...Y.encodeStateAsUpdate(doc)]).toEqual(before);
    expect(readValue(runtime, ['n'])).toBe(22);

    // 恢复 I/O → 持久层 retry 覆盖最新完整 live Y.Doc（含降级前那次写的值）
    failFlush = false;
    await expect.poll(() => handle.getStatus(), { interval: 10, timeout: 5_000 }).toBe('ready');

    // 全新实例（空缓存）经共享 store 读取：降级窗口前登记的脏数据最终持久化成功
    const loaded = await reader.loadDoc(OWNER, 'ns-1');
    expect(loaded).not.toBeNull();
    if (loaded === null) return;
    expect(loaded.doc.getMap('ROOT').get('n')).toBe(22);

    await loaded.release();
    await handle.release();
    await reader.dispose();
    await writer.dispose();
  });
});

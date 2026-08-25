/**
 * SA6 红灯验收测试 — @nomicore/namespace-runtime replaceSchema × 真实 Persistence 集成
 * （issue #91 / 任务简报 AC3 + AC8 + AC10，功能开发）。
 *
 * 契约来源：
 * - docs/adr/0008「SCHEMA write」节：「提供 root 时，将其视为最终完整 logical ROOT
 *   snapshot，验证并 detached 构造完整新内容」；「在一个 transaction 中原子替换 SCHEMA
 *   与必要的 ROOT generation」；「transaction 返回后立即安装新 active tools，再
 *   await notifyDirty()」；
 * - docs/adr/0008「P0 与 active schema」节：「正常 compile result failure 仅使 ROOT
 *   write unavailable；SCHEMA write 仍可修复」（AC8 恢复路径）；
 * - docs/adr/0008「单一 write sequencer」节：「notifyDirty 是由构造方绑定
 *   persistence.saveDoc(handle) 的窄接缝；成功只表示 live commit 与 dirty notification
 *   已登记，不表示已经落盘」；
 * - docs/adr/0006（#79 修订）：「saveDoc 是 mutation 后的 dirty notification……已提交进
 *   live Y.Doc 的事务由持久层内部 retry 以完整 Y.Doc 状态最终持久化」；
 * - 任务简报 AC10（真实 Persistence 集成测试）与「关键上下文」1（SCHEMA 写五步）/3
 *   （可复用 doc-runtime 资产：replaceRootContent 等）/8（unavailable 态 schemaWrite
 *   仍 enabled）。
 *
 * 本文件冻结的契约锚点（SA1/SA3 验收行为锚）：
 * - 完整链路（E2E）：真实内存 Persistence（公开 I/O hook 接线下共享 store）→
 *   createDoc 提交初始快照 → Runtime（真实 P0/active schema，default vfsl 编译）→
 *   replaceSchema（提供完整 ROOT）→ 单事务原子替换 → 同槽 saveDoc 登记 → debounce
 *   flush 落盘 → **全新 Persistence 实例** loadDoc 观察到新 SCHEMA（四键）+ 新 ROOT
 *   内容（跨实例持久化证明，非 live-doc 别名）；
 * - AC8 恢复链：真实 P0 编译失败（doc SCHEMA 文本非法）→ unavailable + rootWrite 关 →
 *   replaceSchema（合法 proposed + 完整 ROOT）恢复 → ready + rootWrite 开 →
 *   mutateRoot 成功提交 → flush → 全新实例看到新 SCHEMA 与 mutateRoot 写入值；
 *   （「不依赖当前 schema 编译成功」的端到端证明）。
 *
 * 红灯现状（构造性红灯）：runtime.replaceSchema 尚未实现——首个 replaceSchema 调用即红
 * （TypeError: runtime.replaceSchema is not a function）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, User } from '@nomicore/persistence';
import { createMemoryPersistence } from '@nomicore/persistence';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import type { NamespaceRuntime } from '../src/index.js';

const OWNER: User = { userId: 'u-alice' };
const TEXT_V1 = 'type ROOT = { n: number; a: string; };';
const ENV1 = { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_V1 } as const;
const TEXT_BAD = 'type ROOT = {'; // 真实 vfsl 编译失败文本（P0 → unavailable）
const ENV_BAD = { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_BAD } as const;
const TEXT_V2 = 'type ROOT = { n: number; a: string; b: boolean; };';
const ENV2 = { lang: 'vfsl', version: 1, id: 'ns-2', text: TEXT_V2 } as const;
const ROOT0 = { n: 1, a: 'x' };

interface ReplaceSchemaRuntime extends NamespaceRuntime {
  replaceSchema: (input: { schema: unknown; root?: unknown }) => Promise<{ ok: true } | { ok: false; issues: unknown[] }>;
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

async function makeDoc(envelope: { lang: string; version: number; id: string; text: string }): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(envelope)) sc.set(k, v);
  doc.getMap('META').set('docId', 'ns-1');
  doc.getMap('META').set('createdAt', 1_700_000_000_000);
  const root = doc.getMap('ROOT');
  for (const [k, v] of Object.entries(ROOT0)) root.set(k, v);
  return doc;
}

async function readyRuntime(
  handle: DocHandle,
  notifier: () => Promise<void>,
  expected: 'ready' | 'unavailable' = 'ready',
): Promise<ReplaceSchemaRuntime> {
  const runtime = createNamespaceRuntimeWithSeam({
    handle,
    notifyDirty: notifier,
  }) as unknown as ReplaceSchemaRuntime;
  await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe(expected);
  return runtime;
}

describe('namespace-runtime replaceSchema × 真实 Persistence 集成（AC3/AC8/AC10）', () => {
  it('AC10 幸福链路：replaceSchema（提供完整 ROOT）→ 单事务 → saveDoc 登记 → flush → 全新 Persistence 实例观察到新 SCHEMA 与新 ROOT（跨实例持久化）', async () => {
    const { writer, reader } = makePersistences({});
    const doc = await makeDoc(ENV1);
    const handle = await writer.createDoc(OWNER, 'ns-1', doc);

    let notifierCalls = 0;
    const runtime = await readyRuntime(handle, () => {
      notifierCalls += 1;
      return writer.saveDoc(handle);
    });

    // 前向断言：replaceSchema 完成信号 = live 原子提交 + dirty notification 登记
    const updates = { count: 0 };
    doc.on('update', () => {
      updates.count += 1;
    });
    const res = await runtime.replaceSchema({ schema: ENV2, root: { n: 10, a: 'z', b: true } });
    expect(res).toEqual({ ok: true });

    // 单事务原子性（SCHEMA + ROOT 同 transaction——恰 1 次更新事件）
    expect(updates.count).toBe(1);
    expect(notifierCalls).toBe(1);
    expect(runtime.getActiveSchema()?.id).toBe('ns-2');
    expect(runtime.getStatus().schema.state).toBe('ready');
    expect(runtime.getStatus().rootWrite.enabled).toBe(true);
    // read-your-write
    expect(readValue(runtime, ['n'])).toBe(10);
    expect(readValue(runtime, ['a'])).toBe('z');
    expect(readValue(runtime, ['b'])).toBe(true);

    // 等待 debounce flush 落盘（真实时钟 + 短调度）
    await sleep(80);
    expect(handle.getStatus()).toBe('ready');

    // 跨实例持久化证明：全新 Persistence 实例（空缓存）经共享 store 读到替换后的完整状态
    const loaded = await reader.loadDoc(OWNER, 'ns-1');
    expect(loaded).not.toBeNull();
    if (loaded === null) return;
    const sc = loaded.doc.getMap('SCHEMA');
    expect([...sc.keys()].sort()).toEqual(['id', 'lang', 'text', 'version']);
    expect(sc.get('id')).toBe('ns-2');
    expect(sc.get('lang')).toBe('vfsl');
    expect(sc.get('version')).toBe(1);
    expect(sc.get('text')).toBe(TEXT_V2);
    expect(loaded.doc.getMap('ROOT').get('n')).toBe(10);
    expect(loaded.doc.getMap('ROOT').get('a')).toBe('z');
    expect(loaded.doc.getMap('ROOT').get('b')).toBe(true);

    await loaded.release();
    await handle.release();
    await reader.dispose();
    await writer.dispose();
  });

  it('AC8 + AC10 恢复全链：真实 P0 编译失败（unavailable）→ replaceSchema 合法恢复 → mutateRoot 恢复 ROOT write → flush → 全新实例看到新 SCHEMA 与写入值', async () => {
    const { writer, reader } = makePersistences({});
    const doc = await makeDoc(ENV_BAD); // 非法 SCHEMA 文本 → 真实 vfsl 编译失败
    const handle = await writer.createDoc(OWNER, 'ns-1', doc);

    let notifierCalls = 0;
    const runtime = await readyRuntime(handle, () => {
      notifierCalls += 1;
      return writer.saveDoc(handle);
    }, 'unavailable');

    // P0 正常 compile failure：rootWrite 关、schemaWrite 仍可修复（不依赖当前 schema 编译成功）
    expect(runtime.getStatus().rootWrite.enabled).toBe(false);
    expect(runtime.getStatus().schemaWrite.enabled).toBe(true);
    expect(runtime.getStatus().schema.state).toBe('unavailable');
    expect(runtime.getActiveSchema()).toBeNull();

    // 合法 replaceSchema（提供完整 logical ROOT）→ 单事务原子替换 → 恢复
    const res = await runtime.replaceSchema({ schema: ENV2, root: { n: 4, a: 'q', b: false } });
    expect(res).toEqual({ ok: true });
    expect(notifierCalls).toBe(1);
    expect(runtime.getStatus().schema.state).toBe('ready');
    expect(runtime.getStatus().rootWrite.enabled).toBe(true); // ROOT write 恢复
    expect(runtime.getActiveSchema()?.id).toBe('ns-2');
    expect(readValue(runtime, ['n'])).toBe(4);
    expect(readValue(runtime, ['b'])).toBe(false);

    // 恢复后 ROOT write 可用：mutateRoot 使用新 active schema 成功提交
    await expect(runtime.mutateRoot({ op: 'set', path: ['n'], value: 6 })).resolves.toEqual({ ok: true });
    expect(notifierCalls).toBe(2);
    expect(readValue(runtime, ['n'])).toBe(6);

    // 落盘后全新实例：新 SCHEMA 四键 + mutateRoot 写入值（降级/window 外正常链）
    await sleep(80);
    expect(handle.getStatus()).toBe('ready');
    const loaded = await reader.loadDoc(OWNER, 'ns-1');
    expect(loaded).not.toBeNull();
    if (loaded === null) return;
    expect(loaded.doc.getMap('SCHEMA').get('id')).toBe('ns-2');
    expect(loaded.doc.getMap('SCHEMA').get('text')).toBe(TEXT_V2);
    expect(loaded.doc.getMap('ROOT').get('n')).toBe(6);
    expect(loaded.doc.getMap('ROOT').get('b')).toBe(false);

    await loaded.release();
    await handle.release();
    await reader.dispose();
    await writer.dispose();
  });
});

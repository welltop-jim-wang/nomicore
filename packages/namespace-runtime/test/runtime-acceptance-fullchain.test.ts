/**
 * 验收测试 — issue #93 全链集成验收（AC1 端到端 + AC5 fatal 全链 × 真实 Persistence）。
 *
 * 契约来源：
 * - 任务简报（issue #93）AC1：「真实 VFSL compiler + doc-runtime + MemoryPersistence/
 *   FilePersistence 的端到端场景覆盖 Runtime 全能力」；AC5：「committed/pre-commit fatal、
 *   best-effort dirty notification、fatal 后只读和 close 全链通过」；
 * - docs/adr/0008：Runtime 组合 doc-runtime + vfsl + Persistence 窄通知接缝；P0 编译真实
 *   信封（默认 compile = vfsl compileSchemaEnvelope）；readLogicalValueAtPath 从固定
 *   ROOT 按实际载体投影；ROOT write / SCHEMA replacement 走单 sequencer；
 * - docs/adr/0006（#79 修订）：saveDoc 是 mutation 后的 dirty notification——只要租约
 *   有效即登记并由持久层内部 retry 以完整 Y.Doc 状态最终持久化。
 *
 * 本文件锚点（全部为可观测运行时行为，无任何源码文本断言）：
 * - 真实编译器：seam 不注入 compile → 默认 vfsl compileSchemaEnvelope（解析/求值/校验
 *   全真实）；fixture 为仓内 schema 文本（ADR-0001 夹具例外）；
 * - 真实读取投影：runtime.read 透传 doc-runtime readLogicalValueAtPath——Y.Map 字段、
 *   Y.Array 元素、嵌套 map 载体逐层投影；
 * - 真实持久化：MemoryPersistence（公开 I/O hook 共享 store——跨实例读证明非 live
 *   别名）与 FilePersistence（真实磁盘 + 全新实例 crash-restart 证明）；
 * - fatal × 真实持久化：committed:true observer 逃逸 → RuntimeWriteFatalError → 槽内
 *   best-effort notifyDirty（真实 saveDoc）→ 跨实例观察到已提交值；fatal 后只读 +
 *   close 全链。
 *
 * 验收记录（issue #93 简报 AC1/AC5 落账）：
 * - 本文件首次运行即为「已绿/存量能力」证据（#86–#92 均已合入本分支）：若任一断言
 *   红，即集成缺口，向总控报告具体失败。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DocHandle, User } from '@nomicore/persistence';
import { createMemoryPersistence, FilePersistence } from '@nomicore/persistence';
import { RuntimeWriteFatalError } from '../src/index.js';
import { createNamespaceRuntime, createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import type { NamespaceRuntime } from '../src/index.js';

const OWNER: User = { userId: 'u-alice' };

// 仓内真实 VFSL 文本夹具（ADR-0001：schema 文本只以测试 fixture 形式存在）
const TEXT_V1 = 'type ROOT = { n: number; a: string; tags: string[]; };';
const ENV1 = { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_V1 } as const;
const TEXT_V2 = 'type ROOT = { n: number; a: string; b: boolean; };';
const ENV2 = { lang: 'vfsl', version: 1, id: 'ns-2', text: TEXT_V2 } as const;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function readValue(runtime: NamespaceRuntime, p: readonly (string | number)[]): unknown {
  const read = runtime.read(p);
  if (!read.ok) throw new Error(`读取应成功，实际 code=${read.code}`);
  return read.value;
}

async function makeDoc(envelope: { lang: string; version: number; id: string; text: string }): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(envelope)) sc.set(k, v);
  const meta = doc.getMap('META');
  meta.set('docId', 'ns-1');
  meta.set('createdAt', 1_700_000_000_000);
  const root = doc.getMap('ROOT');
  root.set('n', 1);
  root.set('a', 'x');
  // tags 字段按 VFSL 契约物化为 Y.Array 载体（plain 数组不是合法载体——由受控写入维持）
  const tags = new Y.Array<string>();
  tags.push(['t0', 't1']);
  root.set('tags', tags);
  return doc;
}

async function readyRuntime(handle: DocHandle, notifier: () => Promise<void>): Promise<NamespaceRuntime> {
  const runtime = createNamespaceRuntimeWithSeam({ handle, notifyDirty: notifier });
  await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
  expect(runtime.getStatus().fatal).toBeNull();
  return runtime;
}

// ---------------------------------------------------------------------------
// MemoryPersistence 引脚（公开 I/O hook，无包内 seam）
// ---------------------------------------------------------------------------
function makeMemoryPair(): {
  writer: ReturnType<typeof createMemoryPersistence>;
  reader: ReturnType<typeof createMemoryPersistence>;
  store: Map<string, Uint8Array>;
} {
  const store = new Map<string, Uint8Array>();
  const writer = createMemoryPersistence({
    schedule: { debounceMs: 5, maxDirtyMs: 60 },
    writeSnapshot: async (key, snapshot) => {
      store.set(key, snapshot.slice());
    },
  });
  const reader = createMemoryPersistence({ readSnapshot: async (key) => store.get(key) });
  return { writer, reader, store };
}

describe('AC1：真实 VFSL compiler + doc-runtime + MemoryPersistence 端到端（Runtime 全能力）', () => {
  it('全链：P0→active schema→载体投影读取→ROOT write→SCHEMA replacement→跨实例持久化→close',
    async () => {
      const { writer, reader } = makeMemoryPair();
      const doc = await makeDoc(ENV1);
      const handle = await writer.createDoc(OWNER, 'ns-1', doc);
      const runtime = await readyRuntime(handle, () => writer.saveDoc(handle));

      try {
        // ① P0 真实编译结算：active schema 身份五键
        const active = runtime.getActiveSchema();
        expect(active).not.toBeNull();
        expect(active!.lang).toBe('vfsl');
        expect(active!.version).toBe(1);
        expect(active!.id).toBe('ns-1');
        expect(typeof active!.envelopeFingerprint).toBe('string');
        expect(active!.envelopeFingerprint.length).toBeGreaterThan(0);
        expect(typeof active!.semanticFingerprint).toBe('string');
        expect(active!.semanticFingerprint.length).toBeGreaterThan(0);

        // ② 只读投影（doc-runtime 载体投影）：map 字段 / Y.Array 元素
        expect(readValue(runtime, ['n'])).toBe(1);
        expect(readValue(runtime, ['a'])).toBe('x');
        expect(readValue(runtime, ['tags', 0])).toBe('t0');
        expect(readValue(runtime, ['tags', 1])).toBe('t1');

        // ③ ROOT write（validated mutation 管线）：标量 + 数组载体
        const r1 = await runtime.mutateRoot({ op: 'set', path: ['n'], value: 42 });
        expect(r1).toEqual({ ok: true });
        expect(readValue(runtime, ['n'])).toBe(42);
        const r2 = await runtime.mutateRoot({ op: 'set', path: ['tags'], value: ['x', 'y', 'z'] });
        expect(r2).toEqual({ ok: true });
        expect(readValue(runtime, ['tags'])).toEqual(['x', 'y', 'z']);

        // ④ SCHEMA replacement（提供完整 ROOT）：原子替换 + active 同步切换
        const updates = { count: 0 };
        doc.on('update', () => {
          updates.count += 1;
        });
        const rep = await runtime.replaceSchema({ schema: { ...ENV2 }, root: { n: 10, a: 'z', b: true } });
        expect(rep).toEqual({ ok: true });
        expect(updates.count).toBe(1); // 单 transaction（SCHEMA+ROOT 同事务原子替换）
        expect(runtime.getActiveSchema()?.id).toBe('ns-2');
        expect(readValue(runtime, ['n'])).toBe(10);
        expect(readValue(runtime, ['b'])).toBe(true);
        expect(runtime.getSchemaEnvelope()).toEqual({ lang: 'vfsl', version: 1, id: 'ns-2', text: TEXT_V2 });

        // ⑤ 跨实例持久化（flush 落盘后全新实例空缓存读取——非 live 别名）
        await sleep(100);
        expect(handle.getStatus()).toBe('ready');
        const loaded = await reader.loadDoc(OWNER, 'ns-1');
        expect(loaded).not.toBeNull();
        if (loaded === null) return;
        const sc = loaded.doc.getMap('SCHEMA');
        expect([...sc.keys()].sort()).toEqual(['id', 'lang', 'text', 'version']);
        expect(sc.get('id')).toBe('ns-2');
        expect(sc.get('text')).toBe(TEXT_V2);
        expect(loaded.doc.getMap('ROOT').get('n')).toBe(10);
        expect(loaded.doc.getMap('ROOT').get('a')).toBe('z');
        expect(loaded.doc.getMap('ROOT').get('b')).toBe(true);
        await loaded.release();

        // ⑥ close 全链：closed 停止公共读写接纳
        const closeP = runtime.close();
        expect(runtime.getStatus().lifecycle).toBe('closing');
        await closeP;
        expect(runtime.getStatus().lifecycle).toBe('closed');
        const readAfter = runtime.read(['n']);
        expect(readAfter.ok).toBe(false);
        if (readAfter.ok) throw new Error('closed 期读取应被拒绝');
        expect(readAfter.code).toBe('RUNTIME_READ_DISABLED');
        const writeAfter = await runtime.mutateRoot({ op: 'set', path: ['n'], value: 1 });
        expect(writeAfter.ok).toBe(false);
        expect(JSON.stringify(writeAfter)).toContain('RUNTIME_WRITE_DISABLED');
        expect(handle.getStatus()).toBe('released');
      } finally {
        await handle.release().catch(() => {});
        await reader.dispose();
        await writer.dispose();
      }
    });
});

// ---------------------------------------------------------------------------
// FilePersistence 引脚（真实磁盘）
// ---------------------------------------------------------------------------
async function withFilePair(
  fn: (fx: {
    writer: FilePersistence;
    handle: DocHandle;
    /** 以同一 rootDir 构造全新 FilePersistence 实例（空缓存 crash-restart 证明）。 */
    restart: () => FilePersistence;
  }) => Promise<void>,
): Promise<void> {
  const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nsr-acceptance-'));
  const writer = new FilePersistence({ rootDir, schedule: { debounceMs: 5, maxDirtyMs: 60 } });
  const handle = await writer.createDoc(OWNER, 'ns-1', await makeDoc(ENV1));
  try {
    await fn({ writer, handle, restart: () => new FilePersistence({ rootDir }) });
  } finally {
    await writer.dispose();
    await fsp.rm(rootDir, { recursive: true, force: true });
  }
}

describe('AC1：真实 VFSL compiler + doc-runtime + FilePersistence 端到端（Runtime 全能力）', () => {
  it('全链：P0→读取→ROOT write→SCHEMA replacement→磁盘落盘→新实例 crash-restart→close（真实文件）',
    async () => {
      await withFilePair(async ({ writer, handle, restart }) => {
        const runtime = await readyRuntime(handle, () => writer.saveDoc(handle));
        try {
          // ① P0 真实编译
          await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
          expect(runtime.getActiveSchema()?.id).toBe('ns-1');

          // ② ROOT write
          expect(await runtime.mutateRoot({ op: 'set', path: ['n'], value: 7 })).toEqual({ ok: true });
          expect(readValue(runtime, ['n'])).toBe(7);

          // ③ SCHEMA replacement（提供完整 ROOT：原子替换 + active 同步切换）
          const rep = await runtime.replaceSchema({ schema: { ...ENV2 }, root: { n: 10, a: 'z', b: true } });
          expect(rep).toEqual({ ok: true });
          expect(runtime.getActiveSchema()?.id).toBe('ns-2');

          // ④ 磁盘落盘
          await sleep(100);
          expect(handle.getStatus()).toBe('ready');

          // ⑤ 全新 FilePersistence 实例（空缓存）crash-restart：磁盘完整恢复三条目
          const restarted = await restart().loadDoc(OWNER, 'ns-1');
          expect(restarted).not.toBeNull();
          if (restarted === null) return;
          const sc = restarted.doc.getMap('SCHEMA');
          expect(sc.get('id')).toBe('ns-2');
          expect(sc.get('text')).toBe(TEXT_V2);
          expect(restarted.doc.getMap('ROOT').get('n')).toBe(10);
          expect(restarted.doc.getMap('ROOT').get('a')).toBe('z');
          expect(restarted.doc.getMap('ROOT').get('b')).toBe(true);
          expect(restarted.doc.getMap('META').get('docId')).toBe('ns-1');
          await restarted.release();

          // ⑥ close
          await runtime.close();
          expect(runtime.getStatus().lifecycle).toBe('closed');
          expect(handle.getStatus()).toBe('released');
          expect(runtime.read(['n']).ok).toBe(false);
        } finally {
          await handle.release().catch(() => {});
        }
      });
    });
});

describe('AC5：fatal 全链 × 真实 Persistence（committed:true best-effort + 跨实例可见已提交值 + 只读 + close）', () => {
  it('observer 逃逸 fatal → RuntimeWriteFatalError(committed:true) → best-effort saveDoc → 新实例看到提交值 → 写禁用/读保留 → close',
    async () => {
      const { writer, reader } = makeMemoryPair();
      const doc = await makeDoc(ENV1);
      const handle = await writer.createDoc(OWNER, 'ns-1', doc);
      let notifierCalls = 0;
      const runtime = createNamespaceRuntimeWithSeam({
        handle,
        notifyDirty: () => {
          notifierCalls += 1;
          return writer.saveDoc(handle);
        },
      });
      await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');

      try {
        // 注入 committed:true fatal：事务提交后 observer 逃逸（yjs 实证：提交不撤销）
        doc.getMap('ROOT').observe(() => {
          throw new Error('observer-boom-acceptance');
        });

        const p = runtime.mutateRoot({ op: 'set', path: ['n'], value: 9 });
        await expect(p).rejects.toBeInstanceOf(RuntimeWriteFatalError);
        await expect(p).rejects.toMatchObject({ committed: true });

        // 带 committed:true 的 fatal：槽内 best-effort notifyDirty 恰一次（真实 saveDoc 登记）
        expect(notifierCalls).toBe(1);

        // 不虚假回滚：已提交值保留，读取保留
        expect(readValue(runtime, ['n'])).toBe(9);
        const status = runtime.getStatus();
        expect(status.read.enabled).toBe(true);
        expect(status.rootWrite.enabled).toBe(false);
        expect(status.schemaWrite.enabled).toBe(false);
        expect(status.fatal).not.toBeNull();
        expect(typeof status.fatal!.code).toBe('string');
        expect(typeof status.fatal!.message).toBe('string');

        // 后续写：RUNTIME_WRITE_DISABLED 零写入
        const blocked = await runtime.mutateRoot({ op: 'set', path: ['n'], value: 1 });
        expect(blocked.ok).toBe(false);
        expect(JSON.stringify(blocked)).toContain('RUNTIME_WRITE_DISABLED');
        expect(readValue(runtime, ['n'])).toBe(9);

        // best-effort 登记的 dirty 最终持久化：全新实例观察 fatal-committed 时的提交值
        await sleep(100);
        const loaded = await reader.loadDoc(OWNER, 'ns-1');
        expect(loaded).not.toBeNull();
        if (loaded === null) return;
        expect(loaded.doc.getMap('ROOT').get('n')).toBe(9);
        await loaded.release();

        // close 全链照常
        await runtime.close();
        expect(runtime.getStatus().lifecycle).toBe('closed');
        expect(handle.getStatus()).toBe('released');
      } finally {
        await handle.release().catch(() => {});
        await reader.dispose();
        await writer.dispose();
      }
    });
});

// ---------------------------------------------------------------------------
// AC5 追加块（#93 round 2 / SA8 E②）：D-6 pre-commit fatal 真实持久化全链
// ---------------------------------------------------------------------------

import type { CompileSchemaEnvelopeResult, SchemaEnvelope } from '@nomicore/vfsl';
import { compileSchemaEnvelope } from '@nomicore/vfsl';

/** 按 envelope.id 分发的 compile 构造器（P0 与 replaceSchema 共用同一 seam 注入）——
 *  复用 runtime-replace-schema-sa7-dynamic.test.ts 同款机制（D-6 注入点=仅 compile，
 *  其余全真）。 */
function dispatchCompile(
  handlers: Record<string, (envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult>,
): (envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult {
  return (envelope) => {
    const h = handlers[envelope.id];
    if (h !== undefined) return h(envelope);
    return compileSchemaEnvelope(envelope);
  };
}

async function settleOf(
  p: Promise<unknown>,
): Promise<{ kind: 'resolved'; value: unknown } | { kind: 'rejected'; reason: unknown }> {
  try {
    return { kind: 'resolved', value: await p };
  } catch (reason) {
    return { kind: 'rejected', reason };
  }
}

function countUpdates(doc: Y.Doc): { count: number } {
  const counter = { count: 0 };
  doc.on('update', () => {
    counter.count += 1;
  });
  return counter;
}

function stateBytes(doc: Y.Doc): number[] {
  return [...Y.encodeStateAsUpdate(doc)];
}

describe('AC5（#93 rev2 追加）：D-6 pre-commit fatal 真实持久化全链（U-1..U-4）', () => {
  it('U-1 Memory × pre-commit fatal：seam compile 按 id 分发 throw（P0 真实 ready）→ rejection phase=schema-compile-throw committed=false + notifier 0 + 零写入 + fatal 摘要 + 读照常/写 DISABLED + close release 恰一次',
    async () => {
      const { writer, reader } = makeMemoryPair();
      const doc = await makeDoc(ENV1);
      const handle = await writer.createDoc(OWNER, 'ns-1', doc);
      let notifierCalls = 0;
      const runtime = createNamespaceRuntimeWithSeam({
        handle,
        notifyDirty: () => {
          notifierCalls += 1;
          return writer.saveDoc(handle);
        },
        compile: dispatchCompile({ 'ns-2': () => { throw new Error('PRECOMPILE_COMPILE_BOOM'); } }),
      });
      try {
        // ① P0 真实编译结算（proposed 注入不影响 P0）
        await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
        expect(runtime.getActiveSchema()?.id).toBe('ns-1');

        // ② replaceSchema → pre-commit fatal rejection（compiled 未达组合 seam——零写入）
        const updates = countUpdates(doc);
        const bytesBefore = stateBytes(doc);
        const settled = await settleOf(runtime.replaceSchema({ schema: { ...ENV2 }, root: { n: 999, a: 'x', b: true } }));
        expect(settled.kind).toBe('rejected');
        if (settled.kind !== 'rejected') return;
        expect(settled.reason).toBeInstanceOf(RuntimeWriteFatalError);
        const fatal = settled.reason as RuntimeWriteFatalError;
        expect(fatal.phase).toBe('schema-compile-throw');
        expect(fatal.committed).toBe(false);
        expect(fatal.cause).toBeInstanceOf(Error);

        // ③ notifier 恰 0（committed:false 不调 dirty notifier）+ 零 update/字节不变
        expect(notifierCalls).toBe(0);
        expect(updates.count).toBe(0);
        expect(stateBytes(doc)).toEqual(bytesBefore);

        // ④ fatal 摘要（SCHEMA 槽独立码）+ 读照常 + getter 照常（fatal 期 lifecycle 仍 ready）
        const status = runtime.getStatus();
        expect(status.fatal?.code).toBe('NSRT-FATAL-SCHEMA-WRITE-INTERNAL');
        expect(status.read.enabled).toBe(true);
        expect(readValue(runtime, ['n'])).toBe(1);
        expect(runtime.getActiveSchema()?.id).toBe('ns-1');

        // ⑤ 后续两写 RUNTIME_WRITE_DISABLED 零字节变化
        const bytesAfter = stateBytes(doc);
        const followRoot = await settleOf(runtime.mutateRoot({ op: 'set', path: ['n'], value: 7 }));
        expect(followRoot.kind).toBe('resolved');
        if (followRoot.kind === 'resolved') {
          expect(followRoot.value).toMatchObject({ ok: false });
          expect(JSON.stringify(followRoot.value)).toContain('RUNTIME_WRITE_DISABLED');
        }
        const followSchema = await settleOf(runtime.replaceSchema({ schema: { ...ENV2 } }));
        expect(followSchema.kind).toBe('resolved');
        if (followSchema.kind === 'resolved') {
          expect(followSchema.value).toMatchObject({ ok: false });
          expect(JSON.stringify(followSchema.value)).toContain('RUNTIME_WRITE_DISABLED');
        }
        expect(stateBytes(doc)).toEqual(bytesAfter);

        // ⑥ close 排空 release 恰一次
        await runtime.close();
        expect(runtime.getStatus().lifecycle).toBe('closed');
        expect(handle.getStatus()).toBe('released');
      } finally {
        await handle.release().catch(() => {});
        await reader.dispose();
        await writer.dispose();
      }
    });

  it('U-2 File × pre-commit fatal：同 U-1 断言面 + restart 全新实例 durable 零写入（SCHEMA 原文/ROOT 原值/META 原样）',
    async () => {
      const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nsr-acceptance-u2-'));
      const writer = new FilePersistence({ rootDir, schedule: { debounceMs: 5, maxDirtyMs: 60 } });
      const handle = await writer.createDoc(OWNER, 'ns-1', await makeDoc(ENV1));
      const restart = (): FilePersistence => new FilePersistence({ rootDir });
      let notifierCalls = 0;
      const runtime = createNamespaceRuntimeWithSeam({
        handle,
        notifyDirty: () => {
          notifierCalls += 1;
          return writer.saveDoc(handle);
        },
        compile: dispatchCompile({ 'ns-2': () => { throw new Error('PRECOMPILE_COMPILE_BOOM'); } }),
      });
      try {
        await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');

        const bytesBefore = stateBytes(handle.doc);
        const updates = countUpdates(handle.doc);
        const settled = await settleOf(runtime.replaceSchema({ schema: { ...ENV2 }, root: { n: 999, a: 'x', b: true } }));
        expect(settled.kind).toBe('rejected');
        if (settled.kind !== 'rejected') return;
        expect((settled.reason as RuntimeWriteFatalError).phase).toBe('schema-compile-throw');
        expect((settled.reason as RuntimeWriteFatalError).committed).toBe(false);
        expect(notifierCalls).toBe(0);
        expect(updates.count).toBe(0);
        expect(stateBytes(handle.doc)).toEqual(bytesBefore);
        expect(runtime.getStatus().fatal?.code).toBe('NSRT-FATAL-SCHEMA-WRITE-INTERNAL');

        await runtime.close();
        expect(handle.getStatus()).toBe('released');

        // durable 零写入：fatal 前无任何成功写 → 全新实例空缓存读回原样三条目
        await sleep(100);
        const restarted = await restart().loadDoc(OWNER, 'ns-1');
        expect(restarted).not.toBeNull();
        if (restarted === null) return;
        const sc = restarted.doc.getMap('SCHEMA');
        expect([...sc.keys()].sort()).toEqual(['id', 'lang', 'text', 'version']);
        expect(sc.get('id')).toBe('ns-1');
        expect(sc.get('text')).toBe(TEXT_V1);
        expect(restarted.doc.getMap('ROOT').get('n')).toBe(1);
        expect(restarted.doc.getMap('ROOT').get('a')).toBe('x');
        expect(restarted.doc.getMap('META').get('docId')).toBe('ns-1');
        await restarted.release();
      } finally {
        await handle.release().catch(() => {});
        await writer.dispose();
        await fsp.rm(rootDir, { recursive: true, force: true });
      }
    });

  it('U-3 File × committed fatal（observer 逃逸，经生产工厂 createNamespaceRuntime）：rejection committed=true + best-effort saveDoc 恰一次 + restart 见提交值 + 读保留 + 后续写 DISABLED + close 照常',
    async () => {
      const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nsr-acceptance-u3-'));
      const writer = new FilePersistence({ rootDir, schedule: { debounceMs: 5, maxDirtyMs: 60 } });
      const handle = await writer.createDoc(OWNER, 'ns-1', await makeDoc(ENV1));
      const restart = (): FilePersistence => new FilePersistence({ rootDir });
      let notifierCalls = 0;
      // 生产工厂构造（observer 逃逸是 doc 级注入，与生产构造器兼容——D-5/D-6 组合）
      const runtime = createNamespaceRuntime(handle, () => {
        notifierCalls += 1;
        return writer.saveDoc(handle);
      });
      try {
        await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
        handle.doc.getMap('ROOT').observe(() => {
          throw new Error('OBSERVER_BOOM_U3');
        });

        const p = runtime.mutateRoot({ op: 'set', path: ['n'], value: 9 });
        await expect(p).rejects.toBeInstanceOf(RuntimeWriteFatalError);
        await expect(p).rejects.toMatchObject({ committed: true });

        // committed:true → 槽内 best-effort notifier（真实 saveDoc）恰一次；不虚假回滚
        expect(notifierCalls).toBe(1);
        expect(readValue(runtime, ['n'])).toBe(9);
        const status = runtime.getStatus();
        expect(status.read.enabled).toBe(true);
        expect(status.rootWrite.enabled).toBe(false);
        expect(status.schemaWrite.enabled).toBe(false);
        expect(status.fatal?.code).toBe('NSRT-FATAL-WRITE-INTERNAL');

        const blocked = await runtime.mutateRoot({ op: 'set', path: ['n'], value: 1 });
        expect(blocked.ok).toBe(false);
        expect(JSON.stringify(blocked)).toContain('RUNTIME_WRITE_DISABLED');
        expect(readValue(runtime, ['n'])).toBe(9);

        // 持久化证明：best-effort 登记的真实落盘 → restart 新实例见已提交值（不虚假回滚）
        await sleep(100);
        const restarted = await restart().loadDoc(OWNER, 'ns-1');
        expect(restarted).not.toBeNull();
        if (restarted === null) return;
        expect(restarted.doc.getMap('ROOT').get('n')).toBe(9);
        await restarted.release();

        await runtime.close();
        expect(runtime.getStatus().lifecycle).toBe('closed');
        expect(handle.getStatus()).toBe('released');
      } finally {
        await handle.release().catch(() => {});
        await writer.dispose();
        await fsp.rm(rootDir, { recursive: true, force: true });
      }
    });

  it('U-4 Memory × P0 期 compile throw：fatal 摘要 NSRT-FATAL-P0-INTERNAL + schema.state 保持 preparing + 读立即可用 + 全部写 RUNTIME_WRITE_DISABLED + notifier 0 + close release 恰一次',
    async () => {
      const { writer, reader } = makeMemoryPair();
      const doc = await makeDoc(ENV1);
      const handle = await writer.createDoc(OWNER, 'ns-1', doc);
      let notifierCalls = 0;
      const runtime = createNamespaceRuntimeWithSeam({
        handle,
        notifyDirty: () => {
          notifierCalls += 1;
          return writer.saveDoc(handle);
        },
        compile: () => {
          throw new Error('P0_COMPILE_BOOM_U4');
        },
      });
      try {
        // 读立即可用（read 不等 P0）
        expect(runtime.read(['n']).ok).toBe(true);
        await expect.poll(() => runtime.getStatus().fatal, { interval: 10, timeout: 5_000 }).not.toBeNull();

        const status = runtime.getStatus();
        expect(status.fatal?.code).toBe('NSRT-FATAL-P0-INTERNAL');
        expect(status.schema.state).toBe('preparing'); // P0 未结算成 ready/unavailable
        expect(status.read.enabled).toBe(true);
        expect(runtime.read(['n']).ok).toBe(true);

        // 全部写 RUNTIME_WRITE_DISABLED（fatal 永久禁写）——零 update/notifier/字节变化
        const updates = countUpdates(doc);
        const bytesBefore = stateBytes(doc);
        const rw = await runtime.mutateRoot({ op: 'set', path: ['n'], value: 3 });
        expect(rw.ok).toBe(false);
        expect(JSON.stringify(rw)).toContain('RUNTIME_WRITE_DISABLED');
        const rs = await runtime.replaceSchema({ schema: { ...ENV2 } });
        expect(rs.ok).toBe(false);
        expect(JSON.stringify(rs)).toContain('RUNTIME_WRITE_DISABLED');
        expect(notifierCalls).toBe(0);
        expect(updates.count).toBe(0);
        expect(stateBytes(doc)).toEqual(bytesBefore);

        // close 排空 release 恰一次
        await runtime.close();
        expect(runtime.getStatus().lifecycle).toBe('closed');
        expect(handle.getStatus()).toBe('released');
      } finally {
        await handle.release().catch(() => {});
        await reader.dispose();
        await writer.dispose();
      }
    });
});

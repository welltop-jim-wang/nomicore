/**
 * 验收测试 — issue #93 round 2 / 评审项 2 / SA8 E①：生产装配路径真实端到端（D-5）。
 *
 * 契约来源：
 * - wiki/raw/task_namespace-runtime-integration-acceptance-rev1_design.md §5（D-5）：
 *   构造经包内生产工厂 `createNamespaceRuntime(handle, notifyDirty)`（runtime.ts:240-245，
 *   ADR-0008「生产工厂保留包内，由未来 Registry 使用」——import 包内相对路径
 *   ../src/runtime.js 是唯一同时满足评审意图与 AC6/ADR-0008 两条边界的形态）；
 *   不注入 compile（真实 compileSchemaEnvelope——解析/求值/校验全真实）；doc-runtime
 *   真实（read/applyValidatedMutation/replaceSchemaAndRoot 全链）；notifyDirty 是
 *   ADR-0008 L45「由构造方绑定 persistence.saveDoc(handle)」的逐字调用形（计数是观测
 *   不是注入）；Memory + File 双 Adapter。
 * - 场景（§5.2 六步）：P0 → 读 → ROOT write → SCHEMA replacement → 跨实例/crash-restart
 *   持久化 → close。
 *
 * 断言面纪律：不注入任何 fault/gate（那是注入式 seam fullchain 的分工）；dirty 计数是
 * 「生产绑定真实生效」的行为证据（每笔成功写恰一次 notify；P0/close 零 notify）。
 *
 * 红/绿标注（SA6 落锚）：
 * - 全链为绿(存量)——唯 post-close `getSchema()` 同步 throw
 *   （RUNTIME_READ_DISABLED）断言**红**：D-2 契约（#93 rev2，close 停接纳扩展至三个
 *   数据投影 getter）在生产构造路径上的集成确认；
 * - 其余断言对当前 HEAD 首跑即绿（评审缺口是覆盖不是行为）。
 *
 * 构造哲学隔离：本文件经生产工厂构造——文件内不出现注入式 seam 构造器
 * （createNamespaceRuntime 与测试接缝的分工见设计 §5.3 对照表）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DocHandle, User } from '@nomicore/persistence';
import { createMemoryPersistence, FilePersistence } from '@nomicore/persistence';
import { realPersistenceScheduler } from './real-persistence-scheduler.js';
import { waitDurableSnapshot } from './durable-snapshot-wait.js';
import { createNamespaceRuntime } from '../src/runtime.js';
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
  const read = runtime.readData(p);
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
  const tags = new Y.Array<string>();
  tags.push(['t0', 't1']);
  root.set('tags', tags);
  return doc;
}

/** 生产构造（无任何注入）：notifyDirty = 「构造方绑定 persistence.saveDoc(handle)」逐字形。 */
async function readyProductionRuntime(
  handle: DocHandle,
  save: (h: DocHandle) => Promise<void>,
): Promise<{ runtime: NamespaceRuntime; dirty: () => number }> {
  let dirty = 0;
  const runtime = createNamespaceRuntime(handle, () => {
    dirty += 1;
    return save(handle);
  });
  await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
  expect(runtime.getStatus().fatal).toBeNull();
  return { runtime, dirty: () => dirty };
}

/** post-close 停接纳断言面（D-2/D-5 交叉——生产构造路径上的 read/write/getter 收口）。 */
async function assertPostClose(
  runtime: NamespaceRuntime,
  handle: DocHandle,
): Promise<void> {
  expect(handle.getStatus()).toBe('released');
  expect(runtime.getStatus().lifecycle).toBe('closed');
  const readAfter = runtime.readData(['n']);
  expect(readAfter.ok).toBe(false);
  if (readAfter.ok) throw new Error('closed 期读取应被拒绝（D-2 停接纳）');
  expect(readAfter.code).toBe('RUNTIME_READ_DISABLED');
  const w = await runtime.mutateData({ op: 'set', path: ['n'], value: 1 });
  expect(w.ok).toBe(false);
  expect(JSON.stringify(w)).toContain('RUNTIME_WRITE_DISABLED');
  const s = await runtime.replaceSchema({ schema: { ...ENV2 } });
  expect(s.ok).toBe(false);
  expect(JSON.stringify(s)).toContain('RUNTIME_WRITE_DISABLED');
  // 【D-2 红灯】：post-close getSchema() 同步 throw（code RUNTIME_READ_DISABLED、
  // message 含 'closed' 与 getter 名）——现行为返回投影值 → 断言红，随 D-2 转绿。
  let thrown: unknown = '(no throw)';
  try {
    runtime.getSchema();
  } catch (e) {
    thrown = e;
  }
  expect(thrown, 'post-close getSchema() 应同步 throw（D-2 停接纳）').not.toBe('(no throw)');
  expect(thrown).not.toBeInstanceOf(Promise);
  expect((thrown as { code?: unknown }).code).toBe('RUNTIME_READ_DISABLED');
  expect(String((thrown as { message?: unknown }).message)).toContain('closed');
  expect(String((thrown as { message?: unknown }).message)).toContain('getSchema');
}

describe('D-5：生产装配——MemoryPersistence 全链（createNamespaceRuntime 真实绑定 + 真实 compile）', () => {
  it('T5.1 六步全链：P0→读取→ROOT write→SCHEMA replacement→跨实例持久化→close；dirty 每成功写恰 +1；post-close getSchema throw（D-2 红）',
    async () => {
      const store = new Map<string, Uint8Array>();
      const writer = createMemoryPersistence({
        scheduler: realPersistenceScheduler,
        schedule: { debounceMs: 5, maxDirtyMs: 60 },
        writeSnapshot: async (key, snapshot) => {
          store.set(key, snapshot.slice());
        },
      });
      const reader = createMemoryPersistence({
        scheduler: realPersistenceScheduler,
        readSnapshot: async (key) => store.get(key),
      });
      const handle = await writer.createDoc(OWNER, 'ns-1', await makeDoc(ENV1));
      const { runtime, dirty } = await readyProductionRuntime(handle, (h) => writer.saveDoc(h));
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
        expect(dirty()).toBe(0); // P0 零 notify

        // ② 载体投影读取：Y.Map 字段 + Y.Array 元素
        expect(readValue(runtime, ['n'])).toBe(1);
        expect(readValue(runtime, ['a'])).toBe('x');
        expect(readValue(runtime, ['tags', 0])).toBe('t0');
        expect(readValue(runtime, ['tags', 1])).toBe('t1');

        // ③ ROOT write：ok:true → 读见新值 → dirty 恰 +1
        const r1 = await runtime.mutateData({ op: 'set', path: ['n'], value: 42 });
        expect(r1).toEqual({ ok: true });
        expect(readValue(runtime, ['n'])).toBe(42);
        expect(dirty()).toBe(1);

        // ④ SCHEMA replacement（完整 root）：ok:true → 单 update（单事务）→ active 同步切换
        const updates = { count: 0 };
        handle.doc.on('update', () => {
          updates.count += 1;
        });
        const rep = await runtime.replaceSchema({ schema: { ...ENV2 }, root: { n: 10, a: 'z', b: true } });
        expect(rep).toEqual({ ok: true });
        expect(updates.count).toBe(1);
        expect(runtime.getActiveSchema()?.id).toBe('ns-2');
        expect(readValue(runtime, ['n'])).toBe(10);
        expect(readValue(runtime, ['b'])).toBe(true);
        expect(runtime.getSchema()).toEqual({ lang: 'vfsl', version: 1, id: 'ns-2', text: TEXT_V2 });
        expect(dirty()).toBe(2);

        // ⑤ 跨实例持久化证明（flush 后全新实例空缓存读取——非 live 别名）
        await sleep(100);
        expect(handle.getStatus()).toBe('ready');
        const loaded = await reader.loadDoc(OWNER, 'ns-1');
        expect(loaded).not.toBeNull();
        if (loaded === null) return;
        expect(loaded.doc).not.toBe(handle.doc); // 全新 decode 实例（非 live 别名）
        const sc = loaded.doc.getMap('SCHEMA');
        expect([...sc.keys()].sort()).toEqual(['id', 'lang', 'text', 'version']);
        expect(sc.get('id')).toBe('ns-2');
        expect(sc.get('text')).toBe(TEXT_V2);
        expect(loaded.doc.getMap('ROOT').get('n')).toBe(10);
        expect(loaded.doc.getMap('ROOT').get('a')).toBe('z');
        expect(loaded.doc.getMap('ROOT').get('b')).toBe(true);
        await loaded.release();

        // ⑥ close（生产构造路径）→ 停接纳 + D-2 getter 收口
        const closeP = runtime.close();
        expect(runtime.getStatus().lifecycle).toBe('closing');
        await closeP;
        await assertPostClose(runtime, handle);
        expect(dirty()).toBe(2); // close 零 notify
      } finally {
        await handle.release().catch(() => {});
        await reader.dispose();
        await writer.dispose();
      }
    });
});

describe('D-5：生产装配——FilePersistence 全链（真实磁盘 + crash-restart）', () => {
  it('T5.2 六步全链（File）：P0→读取→ROOT write→SCHEMA replacement→磁盘落盘→新实例 crash-restart→close；dirty 每成功写恰 +1；post-close getSchema throw（D-2 红）',
    async () => {
      const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nsr-prod-assembly-'));
      const writer = new FilePersistence({ rootDir, scheduler: realPersistenceScheduler, schedule: { debounceMs: 5, maxDirtyMs: 60 } });
      const handle = await writer.createDoc(OWNER, 'ns-1', await makeDoc(ENV1));
      const restart = (): FilePersistence => new FilePersistence({ rootDir, scheduler: realPersistenceScheduler });
      const { runtime, dirty } = await readyProductionRuntime(handle, (h) => writer.saveDoc(h));
      try {
        // ① P0 真实编译
        expect(runtime.getActiveSchema()?.id).toBe('ns-1');
        expect(dirty()).toBe(0);

        // ② 载体投影读取
        expect(readValue(runtime, ['n'])).toBe(1);
        expect(readValue(runtime, ['tags', 0])).toBe('t0');

        // ③ ROOT write
        expect(await runtime.mutateData({ op: 'set', path: ['n'], value: 7 })).toEqual({ ok: true });
        expect(readValue(runtime, ['n'])).toBe(7);
        expect(dirty()).toBe(1);

        // ④ SCHEMA replacement（完整 root）
        const updates = { count: 0 };
        handle.doc.on('update', () => {
          updates.count += 1;
        });
        const rep = await runtime.replaceSchema({ schema: { ...ENV2 }, root: { n: 10, a: 'z', b: true } });
        expect(rep).toEqual({ ok: true });
        expect(updates.count).toBe(1);
        expect(runtime.getActiveSchema()?.id).toBe('ns-2');
        expect(dirty()).toBe(2);

        // ⑤ 全新 FilePersistence 实例（空缓存）crash-restart：磁盘完整恢复
        //    （竞态守卫同 fullchain U-3：saveDoc 只是 dirty 登记，落盘是 debounce+retry
        //    的**最终**持久化——固定 sleep 与并发 flush 写读竞态，先有界轮询再一次性断言）
        await waitDurableSnapshot(OWNER, 'ns-1', rootDir, (doc) => doc.getMap('ROOT').get('n'), 10);
        const restarted = await restart().loadDoc(OWNER, 'ns-1');
        expect(restarted).not.toBeNull();
        if (restarted === null) return;
        expect(restarted.doc.getMap('SCHEMA').get('id')).toBe('ns-2');
        expect(restarted.doc.getMap('SCHEMA').get('text')).toBe(TEXT_V2);
        expect(restarted.doc.getMap('ROOT').get('n')).toBe(10);
        expect(restarted.doc.getMap('ROOT').get('a')).toBe('z');
        expect(restarted.doc.getMap('ROOT').get('b')).toBe(true);
        expect(restarted.doc.getMap('META').get('docId')).toBe('ns-1');
        await restarted.release();

        // ⑥ close
        await runtime.close();
        await assertPostClose(runtime, handle);
        expect(dirty()).toBe(2);
      } finally {
        await handle.release().catch(() => {});
        await writer.dispose();
        await fsp.rm(rootDir, { recursive: true, force: true });
      }
    });
});

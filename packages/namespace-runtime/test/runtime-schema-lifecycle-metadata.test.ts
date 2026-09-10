/**
 * issue #282 / ADR-0017 — @nomicore/namespace-runtime schema 生命周期元数据
 * （META.schema.updatedAt）契约测试。
 *
 * 锚定契约（验收准则逐条映射）：
 * - genesis：META.schema 为嵌套 Y.Map、updatedAt 为 UTC ISO 8601 字符串（genesis 文档
 *   由 doc-runtime createInitialDocument 安装；本文件以同形种子 + Registry 侧测试双锚）；
 * - P0：active schema 身份第六键 updatedAt 与 META.schema.updatedAt 同源；
 * - legacy 命名空间（无 META.schema）→ updatedAt === null（诚实缺席，绝不伪造派生）；
 *   损坏形态（schema 非 Y.Map / updatedAt 非 string）→ null；
 * - 成功 replaceSchema：同一事务提交 SCHEMA + META.schema.updatedAt；activeInfo 在
 *   post-transaction/pre-dirty 观测窗内即对应新 generation；
 * - 语义等价/仅格式差异的替换同样推进 updatedAt（时间戳描述提交的 generation，
 *   不据语义指纹相等推断）；
 * - 拒绝/零写入替换（compile 失败、ROOT 校验失败）不推进 updatedAt；
 * - notifyDirty 失败后 committed generation 的时间戳保留（不回滚不卸载）；
 * - 时钟读数非法/抛出 → write-slot-internal committed:false 零写入；
 * - 持久化重启后时间戳逐字节保留；
 * - getMetadata 将 META.schema 投影为 plain object（嵌套 Y.Map 递归深拷贝）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, User } from '@nomicore/persistence';
import { createMemoryPersistence } from '@nomicore/persistence';
import { compileSchemaEnvelope } from '@nomicore/vfsl';
import { realPersistenceScheduler } from './real-persistence-scheduler.js';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import type { NamespaceRuntime } from '../src/index.js';
import { RuntimeWriteFatalError } from '../src/errors.js';

const OWNER: User = { userId: 'u-alice' };
const TEXT_V1 = 'type ROOT = { n: number; a: string; };';
const ENV1 = { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_V1 } as const;
// 与 TEXT_V1 语义等价（仅普通注释 + 格式差异——semanticFingerprint 恒等，envelope 文本不同）
const TEXT_V1_REFORMATTED = '// ordinary comment\ntype ROOT = {\n  n: number;\n  a: string;\n};';
const ENV1_REFORMATTED = { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_V1_REFORMATTED } as const;
const TEXT_V2 = 'type ROOT = { n: number; a: string; b: boolean; };';
const ENV2 = { lang: 'vfsl', version: 1, id: 'ns-2', text: TEXT_V2 } as const;
const ROOT0 = { n: 1, a: 'x' };
const ROOT_V2 = { n: 1, a: 'x', b: true };

const T0_MS = 1_700_000_000_000;
const T0_ISO = new Date(T0_MS).toISOString();
const T1_MS = 1_700_000_123_456;
const T1_ISO = new Date(T1_MS).toISOString();
const T2_MS = 1_700_000_999_999;
const T2_ISO = new Date(T2_MS).toISOString();

/** 种子文档（SCHEMA 信封 + META docId/createdAt + ROOT；schemaLifecycle 控制 META.schema）。 */
function makeDoc(opts: {
  envelope?: { lang: string; version: number; id: string; text: string };
  schemaLifecycle?: 'genesis' | 'legacy' | 'corrupt-carrier' | 'corrupt-value';
} = {}): Y.Doc {
  const envelope = opts.envelope ?? ENV1;
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(envelope)) sc.set(k, v);
  const meta = doc.getMap('META');
  meta.set('docId', 'ns-1');
  meta.set('createdAt', T0_ISO);
  const mode = opts.schemaLifecycle ?? 'genesis';
  if (mode === 'genesis') {
    const schemaMeta = new Y.Map<unknown>();
    schemaMeta.set('updatedAt', T0_ISO);
    meta.set('schema', schemaMeta);
  } else if (mode === 'corrupt-carrier') {
    meta.set('schema', 'not-a-map'); // 损坏：schema 键非 Y.Map
  } else if (mode === 'corrupt-value') {
    const schemaMeta = new Y.Map<unknown>();
    schemaMeta.set('updatedAt', 42); // 损坏：updatedAt 非 string
    meta.set('schema', schemaMeta);
  } // 'legacy'：无 schema 键
  const root = doc.getMap('ROOT');
  for (const [k, v] of Object.entries(ROOT0)) root.set(k, v);
  return doc;
}

function makeHandle(doc: Y.Doc): DocHandle {
  return {
    owner: OWNER,
    docId: 'ns-1',
    doc,
    getStatus: () => 'ready',
    release: () => Promise.resolve(),
  } as unknown as DocHandle;
}

interface MakeRuntimeOpts {
  clock?: () => number;
  notifyDirty?: () => Promise<void>;
}

async function readyRuntime(doc: Y.Doc, opts: MakeRuntimeOpts = {}): Promise<NamespaceRuntime> {
  const runtime = createNamespaceRuntimeWithSeam({
    handle: makeHandle(doc),
    notifyDirty: opts.notifyDirty ?? (() => Promise.resolve()),
    ...(opts.clock !== undefined ? { clock: opts.clock } : {}),
  });
  await expect
    .poll(() => runtime.getStatus().schema.state, { interval: 5, timeout: 5_000 })
    .toBe('ready');
  return runtime;
}

describe('issue #282：P0 / genesis 与 legacy 兼容（getActiveSchema 第六键 updatedAt）', () => {
  it('genesis 文档：activeInfo.updatedAt 与 META.schema.updatedAt 同源（UTC ISO 8601 字符串）', async () => {
    const runtime = await readyRuntime(makeDoc());
    const active = runtime.getActiveSchema();
    expect(active).not.toBeNull();
    expect(Object.keys(active!)).toEqual([
      'lang',
      'version',
      'id',
      'envelopeFingerprint',
      'semanticFingerprint',
      'updatedAt',
    ]);
    expect(active!.updatedAt).toBe(T0_ISO);
    // UTC ISO 8601 形状（toISOString 产物）
    expect(active!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    await runtime.close();
  });

  it('legacy 命名空间（无 META.schema）→ updatedAt === null（诚实缺席，不伪造派生）', async () => {
    const runtime = await readyRuntime(makeDoc({ schemaLifecycle: 'legacy' }));
    const active = runtime.getActiveSchema();
    expect(active).not.toBeNull();
    expect(active!.updatedAt).toBeNull();
    // 其余五字段照常（身份/双指纹不受影响）
    expect(active!.id).toBe('ns-1');
    await runtime.close();
  });

  it('损坏形态（schema 非 Y.Map / updatedAt 非 string）→ updatedAt === null，不影响 schema 可用性', async () => {
    for (const mode of ['corrupt-carrier', 'corrupt-value'] as const) {
      const runtime = await readyRuntime(makeDoc({ schemaLifecycle: mode }));
      expect(runtime.getActiveSchema()?.updatedAt).toBeNull();
      expect(runtime.getStatus().schema.state).toBe('ready');
      await runtime.close();
    }
  });

  it('getMetadata 将 META.schema 投影为 plain object（嵌套 Y.Map 递归深拷贝，非 live 引用）', async () => {
    const runtime = await readyRuntime(makeDoc());
    const metadata = runtime.getMetadata();
    expect(metadata.schema).toEqual({ updatedAt: T0_ISO });
    expect(metadata.schema instanceof Y.Map).toBe(false);
    // legacy：无 schema 键 → 投影不补键
    const legacy = await readyRuntime(makeDoc({ schemaLifecycle: 'legacy' }));
    expect('schema' in legacy.getMetadata()).toBe(false);
    await runtime.close();
    await legacy.close();
  });
});

describe('issue #282：replaceSchema 推进 updatedAt（同一事务原子提交）', () => {
  it('成功替换：注入时钟 T1 → META.schema.updatedAt 与 activeInfo.updatedAt 同步推进到 T1', async () => {
    const doc = makeDoc();
    const runtime = await readyRuntime(doc, { clock: () => T1_MS });
    expect(runtime.getActiveSchema()?.updatedAt).toBe(T0_ISO);

    const result = await runtime.replaceSchema({ schema: ENV2, root: ROOT_V2 });
    expect(result).toEqual({ ok: true });

    // 文档侧：META.schema.updatedAt 已写入（与 SCHEMA 四键同事务）
    const schemaMeta = doc.getMap('META').get('schema');
    expect(schemaMeta).toBeInstanceOf(Y.Map);
    expect((schemaMeta as Y.Map<unknown>).get('updatedAt')).toBe(T1_ISO);
    // 公共投影：activeInfo.updatedAt 对应新 generation
    const active = runtime.getActiveSchema();
    expect(active?.id).toBe('ns-2');
    expect(active?.updatedAt).toBe(T1_ISO);
    await runtime.close();
  });

  it('post-transaction/pre-dirty 观测窗：notifier 挂起期间 activeInfo 已对应新 generation（id + updatedAt）', async () => {
    const doc = makeDoc();
    let releaseNotifier!: () => void;
    const notifierGate = new Promise<void>((resolve) => {
      releaseNotifier = resolve;
    });
    const runtime = await readyRuntime(doc, {
      clock: () => T1_MS,
      notifyDirty: () => notifierGate,
    });
    const pending = runtime.replaceSchema({ schema: ENV2, root: ROOT_V2 });
    // 等事务提交（notifier 已被调用 = 事务已提交、installActive 已执行）
    await expect
      .poll(
        () => (doc.getMap('META').get('schema') as Y.Map<unknown>).get('updatedAt'),
        { interval: 5, timeout: 5_000 },
      )
      .toBe(T1_ISO);
    // 观测窗内：公共投影已切换新 generation（AC6 窗口语义延伸到 updatedAt）
    const active = runtime.getActiveSchema();
    expect(active?.id).toBe('ns-2');
    expect(active?.updatedAt).toBe(T1_ISO);
    releaseNotifier();
    await expect(pending).resolves.toEqual({ ok: true });
    await runtime.close();
  });

  it('语义等价/仅格式差异的替换仍推进 updatedAt（时间戳描述提交的 generation，不据语义指纹推断）', async () => {
    // 前置：两文本 semanticFingerprint 恒等（普通注释/格式差异不入语义指纹）
    const c1 = compileSchemaEnvelope(ENV1);
    const c2 = compileSchemaEnvelope(ENV1_REFORMATTED);
    if (!c1.ok || !c2.ok) throw new Error('fixture 前置编译应成功');
    expect(c2.semanticFingerprint).toBe(c1.semanticFingerprint);
    expect(c2.envelopeFingerprint).not.toBe(c1.envelopeFingerprint);

    const doc = makeDoc();
    const runtime = await readyRuntime(doc, { clock: () => T1_MS });
    const before = runtime.getActiveSchema();
    const result = await runtime.replaceSchema({ schema: ENV1_REFORMATTED });
    expect(result).toEqual({ ok: true });
    const after = runtime.getActiveSchema();
    // 语义指纹不变（同一代 generation 语义），但 updatedAt 推进（新提交 generation）
    expect(after?.semanticFingerprint).toBe(before?.semanticFingerprint);
    expect(after?.updatedAt).toBe(T1_ISO);
    expect((doc.getMap('META').get('schema') as Y.Map<unknown>).get('updatedAt')).toBe(T1_ISO);
    await runtime.close();
  });

  it('legacy 命名空间的首次成功替换：修复性安装 META.schema 并写入 updatedAt', async () => {
    const doc = makeDoc({ schemaLifecycle: 'legacy' });
    const runtime = await readyRuntime(doc, { clock: () => T1_MS });
    expect(runtime.getActiveSchema()?.updatedAt).toBeNull();
    const result = await runtime.replaceSchema({ schema: ENV2, root: ROOT_V2 });
    expect(result).toEqual({ ok: true });
    const schemaMeta = doc.getMap('META').get('schema');
    expect(schemaMeta).toBeInstanceOf(Y.Map);
    expect((schemaMeta as Y.Map<unknown>).get('updatedAt')).toBe(T1_ISO);
    expect(runtime.getActiveSchema()?.updatedAt).toBe(T1_ISO);
    await runtime.close();
  });
});

describe('issue #282：零写入结局不推进 updatedAt / 诚实 fatal', () => {
  it('compile 失败（rejected）→ updatedAt 不变、activeInfo 不变', async () => {
    const doc = makeDoc();
    let clockCalls = 0;
    const runtime = await readyRuntime(doc, {
      clock: () => {
        clockCalls += 1;
        return T1_MS;
      },
    });
    const result = await runtime.replaceSchema({
      schema: { lang: 'vfsl', version: 1, id: 'ns-bad', text: 'type ROOT = {' },
    });
    expect(result.ok).toBe(false);
    expect(runtime.getActiveSchema()?.updatedAt).toBe(T0_ISO);
    expect(runtime.getActiveSchema()?.id).toBe('ns-1');
    expect((doc.getMap('META').get('schema') as Y.Map<unknown>).get('updatedAt')).toBe(T0_ISO);
    expect(clockCalls).toBe(0); // S4.5 晚于 compile——零写入结局零读钟
    await runtime.close();
  });

  it('ROOT 校验失败（seam 领域拒绝）→ updatedAt 不变、文档零写入', async () => {
    const doc = makeDoc();
    const runtime = await readyRuntime(doc, { clock: () => T1_MS });
    const result = await runtime.replaceSchema({
      schema: ENV2,
      root: { n: 1, a: 'x', b: true, undeclared: 1 }, // 未声明键 → 领域失败零写入
    });
    expect(result.ok).toBe(false);
    expect(runtime.getActiveSchema()?.updatedAt).toBe(T0_ISO);
    expect((doc.getMap('META').get('schema') as Y.Map<unknown>).get('updatedAt')).toBe(T0_ISO);
    expect(doc.getMap('SCHEMA').get('id')).toBe('ns-1'); // SCHEMA 未动
    await runtime.close();
  });

  it('notifyDirty 失败（committed:true fatal）→ 时间戳保留为已提交 generation 的一部分', async () => {
    const doc = makeDoc();
    const runtime = await readyRuntime(doc, {
      clock: () => T1_MS,
      notifyDirty: () => Promise.reject(new Error('saveDoc down')),
    });
    const pending = runtime.replaceSchema({ schema: ENV2, root: ROOT_V2 });
    await expect(pending).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof RuntimeWriteFatalError && err.phase === 'notify-dirty-failed' && err.committed === true,
    );
    // committed generation 完整保留（不回滚、不卸载——含 updatedAt）
    const active = runtime.getActiveSchema();
    expect(active?.id).toBe('ns-2');
    expect(active?.updatedAt).toBe(T1_ISO);
    expect((doc.getMap('META').get('schema') as Y.Map<unknown>).get('updatedAt')).toBe(T1_ISO);
    await runtime.close();
  });

  it('时钟读数非法（NaN）→ write-slot-internal committed:false，零写入、updatedAt 不变', async () => {
    const doc = makeDoc();
    const runtime = await readyRuntime(doc, { clock: () => Number.NaN });
    const pending = runtime.replaceSchema({ schema: ENV2, root: ROOT_V2 });
    await expect(pending).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof RuntimeWriteFatalError && err.phase === 'write-slot-internal' && err.committed === false,
    );
    expect(runtime.getActiveSchema()?.updatedAt).toBe(T0_ISO);
    expect(runtime.getActiveSchema()?.id).toBe('ns-1');
    expect((doc.getMap('META').get('schema') as Y.Map<unknown>).get('updatedAt')).toBe(T0_ISO);
    expect(doc.getMap('SCHEMA').get('id')).toBe('ns-1');
    await runtime.close();
  });

  it('时钟抛出 → write-slot-internal committed:false，零写入', async () => {
    const doc = makeDoc();
    const runtime = await readyRuntime(doc, {
      clock: () => {
        throw new Error('clock broken');
      },
    });
    await expect(runtime.replaceSchema({ schema: ENV2, root: ROOT_V2 })).rejects.toSatisfy(
      (err: unknown) => err instanceof RuntimeWriteFatalError && err.committed === false,
    );
    expect((doc.getMap('META').get('schema') as Y.Map<unknown>).get('updatedAt')).toBe(T0_ISO);
    await runtime.close();
  });
});

describe('issue #282：持久化重启保留 updatedAt（跨实例逐字节一致）', () => {
  it('replaceSchema → flush → 全新 Persistence 实例 loadDoc → 新 Runtime P0 观察到同一 updatedAt', async () => {
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

    // 第一世代：genesis 种子（T0）→ replaceSchema（T1）→ flush 落盘
    const doc = makeDoc();
    const handle1 = await writer.createDoc(OWNER, 'ns-1', doc);
    const runtime1 = createNamespaceRuntimeWithSeam({
      handle: handle1,
      notifyDirty: () => writer.saveDoc(handle1),
      clock: () => T1_MS,
    });
    await expect
      .poll(() => runtime1.getStatus().schema.state, { interval: 5, timeout: 5_000 })
      .toBe('ready');
    expect(runtime1.getActiveSchema()?.updatedAt).toBe(T0_ISO);
    await expect(runtime1.replaceSchema({ schema: ENV2, root: ROOT_V2 })).resolves.toEqual({ ok: true });
    expect(runtime1.getActiveSchema()?.updatedAt).toBe(T1_ISO);
    // 等待 debounce flush 落盘（真实时钟 + 短调度；沿 runtime-replace-schema-persistence 先例）
    await new Promise((r) => setTimeout(r, 80));
    expect(handle1.getStatus()).toBe('ready');
    await runtime1.close();

    // 第二世代：全新实例 loadDoc → 新 Runtime P0 → updatedAt 逐字节保留
    const handle2 = await reader.loadDoc(OWNER, 'ns-1');
    expect(handle2).not.toBeNull();
    const runtime2 = createNamespaceRuntimeWithSeam({
      handle: handle2!,
      notifyDirty: () => reader.saveDoc(handle2!),
    });
    await expect
      .poll(() => runtime2.getStatus().schema.state, { interval: 5, timeout: 5_000 })
      .toBe('ready');
    const active = runtime2.getActiveSchema();
    expect(active?.id).toBe('ns-2');
    expect(active?.updatedAt).toBe(T1_ISO);
    // 替换后仍可继续推进（重启后写路径完好；注入 T2 时钟锚定）
    const runtime2b = runtime2;
    await expect(runtime2b.replaceSchema({ schema: ENV1, root: ROOT0 })).resolves.toEqual({ ok: true });
    const schemaMeta = handle2!.doc.getMap('META').get('schema');
    expect(schemaMeta).toBeInstanceOf(Y.Map);
    expect(runtime2b.getActiveSchema()?.updatedAt).not.toBeNull();
    await runtime2.close();
    await reader.dispose();
    await writer.dispose();
  });
});

describe('issue #282：缺省时钟（Date.now 兜底）', () => {
  it('未注入 clock 时 replaceSchema 仍写入合法 UTC ISO 8601 updatedAt', async () => {
    const doc = makeDoc({ schemaLifecycle: 'legacy' });
    const before = Date.now();
    const runtime = await readyRuntime(doc); // 无 clock 注入 → Date.now 缺省
    const result = await runtime.replaceSchema({ schema: ENV2, root: ROOT_V2 });
    const after = Date.now();
    expect(result).toEqual({ ok: true });
    const updatedAt = runtime.getActiveSchema()?.updatedAt;
    expect(typeof updatedAt).toBe('string');
    expect(updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const ms = Date.parse(updatedAt!);
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);
    await runtime.close();
  });
});

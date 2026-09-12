/**
 * #316 C3c（T-4）— readData 端到端：Int/Range 叶的语义 schema 投影（ADR 0016 + ADR 0020 决策 8）。
 *
 * 契约来源：SA6 §12.4 C3c（readData 组合面）+ SA1 设计 §7 T-4（自包含装置）。覆盖缺口：
 * `read-schema-projection.ts` 的 `cloneValueSchema` int/range 分支（#351 新增）在
 * `packages/namespace-runtime/test/**` 此前零测试覆盖。
 *
 * 装置说明（**文件内自包含**，不修改任何既有文件）：`TXT_316` / `seedRoot316` /
 * `makeHandle316` / `makeReadyRuntime316` 镜像包级共享 fixture
 * `readdata-schema-projection-fixture.ts:73-98` 的**构造配方**（memory persistence +
 * Y.Doc 三载体播种 + seam + 有界 poll），但载体值为本票 Int/Range 目标值——该共享
 * fixture 的 `makeHandle`/`makeReadyRuntime` 被 #273 载体数据（273 键集）锁定，不能
 * 承载本票预写值，故按 SA1 设计备选 6 方案 (b) 在新文件内私有构造；被只读复用的共享件
 * 仅 `./real-persistence-scheduler.js`（scheduler 自 issue #107 起为必填注入）。
 *
 * 断言纪律（SA6 §12.0）：只观察公共接缝 `readData`/`getStatus` 的运行时输出（结果形状 /
 * 投影内容 / 引用隔离 / 失败码与 path 回显）；不 skip / 不软化 / 不 grep 源码；文案不冻结。
 * 装置失败全部 fail loud：META.docId 违约 → persistence 拒绝；schema 解析失败 → 有界 poll
 * 超时（5s）红；播种遗漏 → 值断言红。无静默 fallback。
 */
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createMemoryPersistence } from '@nomicore/persistence';
import type { DocHandle, User } from '@nomicore/persistence';
import { compileSchemaEnvelope, resolveSchemaAtPath } from '@nomicore/vfsl';
import type { ReadDataSchemaProjection } from '@nomicore/vfsl';
import { realPersistenceScheduler } from './real-persistence-scheduler.js';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import type { NamespaceRuntime } from '../src/index.js';

/** #316 私有 schema 文本：int（裸/区间）/ range / 数组元素 / Record 值 / union 叶 + pattern 配对面。 */
const TXT_316 = `
type ROOT = YMap<{
  /** 库存计数 */
  b: number & Int<1, 100>;
  bare: number & Int;
  c: number & Range<0.5, 1.5>;
  e: number & Int<0, 9>[];
  r: Record<string, number & Int<0, 9>>;
  u: number & Int<1, 3> | string;
  p: string & Pattern<"^a+$">;
}>;
`.trim();

const ENV_316 = { lang: 'vfsl', version: 1, id: 'ns-316', text: TXT_316 } as const;
const DOC_ID_316 = 'ns-316';
const OWNER_316: User = { userId: 'u-316' };

/** ROOT 载体播种（runtime 构造前、`createDoc` 之前——与共享 fixture 同款构造时点）。 */
function seedRoot316(root: Y.Map<unknown>): void {
  root.set('b', 50);
  root.set('bare', 7);
  root.set('c', 1);
  const e = new Y.Array<number>();
  e.push([4, 7]);
  root.set('e', e);
  const r = new Y.Map<number>();
  r.set('k', 5);
  root.set('r', r);
  root.set('u', 2);
  root.set('p', 'aaa');
}

/** 经 MemoryPersistence 构造带 SCHEMA/META/ROOT 三载体的 DocHandle（配方镜像见文件头注）。 */
async function makeHandle316(): Promise<DocHandle> {
  const persistence = createMemoryPersistence({ scheduler: realPersistenceScheduler });
  const doc = new Y.Doc();
  const schema = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(ENV_316)) schema.set(k, v);
  const meta = doc.getMap('META');
  meta.set('docId', DOC_ID_316); // 必须与 createDoc 的 docId 一致（persistence 契约组）
  meta.set('createdAt', 1_700_000_000_000);
  seedRoot316(doc.getMap('ROOT'));
  return persistence.createDoc(OWNER_316, DOC_ID_316, doc);
}

/** 构造 runtime 并等待 P0 结算到 ready（有界 5s，超时即红——fail loud，不静默跳过）。 */
async function makeReadyRuntime316(): Promise<NamespaceRuntime> {
  const handle = await makeHandle316();
  const runtime = createNamespaceRuntimeWithSeam({ handle });
  await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
  return runtime;
}

type ReadOkResult = { ok: true; value: unknown; schema: ReadDataSchemaProjection | null };

/** 单点窄化：readData ok:false → loud throw（绝不假绿）。 */
function readOk(runtime: NamespaceRuntime, path: readonly (string | number)[]): ReadOkResult {
  const r = runtime.readData(path);
  if (!r.ok) {
    throw new Error(`契约前提失败：readData(${JSON.stringify(path)}) 应成功，实际 code=${r.code}`);
  }
  return r;
}

/** 独立投影预言机：同一信封经 vfsl 公共 API 编译 + 解析（与 runtime 组合面同源同库）。 */
function oracle(path: readonly (string | number)[]): ReadDataSchemaProjection {
  const compiled = compileSchemaEnvelope(ENV_316);
  if (!compiled.ok) {
    throw new Error(`预言机前提失败：信封编译失败 ${JSON.stringify(compiled.issues)}`);
  }
  const resolved = resolveSchemaAtPath(compiled.derived, path);
  if (!resolved.ok) {
    throw new Error(`预言机前提失败：路径 ${JSON.stringify(path)} 解析 ${resolved.code}`);
  }
  return {
    valueSchema: resolved.valueSchema,
    aliases: resolved.aliases,
    docs: resolved.docs,
    aliasDocs: resolved.aliasDocs,
  };
}

describe('C3c — readData 端到端：Int/Range 叶的语义 schema 投影（三键成功形状 + 预写值）', () => {
  it('前置：writeData/readData 装置可观察预写值（b=50 等），schema.state=ready', async () => {
    const runtime = await makeReadyRuntime316();
    try {
      expect(runtime.getStatus().schema.state).toBe('ready');
      expect(readOk(runtime, ['b']).value).toBe(50);
    } finally {
      await runtime.close();
    }
  });

  it("['b']：ok 恰三键 {ok,value,schema}；value=50；schema.valueSchema = {kind:'int',min:1,max:100}", async () => {
    const runtime = await makeReadyRuntime316();
    try {
      const r = readOk(runtime, ['b']);
      expect(Object.keys(r).sort()).toEqual(['ok', 'schema', 'value']);
      expect(r.value).toBe(50);
      expect(r.schema).not.toBeNull();
      expect(r.schema!.valueSchema).toEqual({ kind: 'int', min: 1, max: 100 });
      expect(r.schema).toEqual(oracle(['b']));
    } finally {
      await runtime.close();
    }
  });

  it("['bare']：裸 Int 条件键纪律——value=7，valueSchema 键集恰 ['kind']（不补 min/max undefined 槽）", async () => {
    const runtime = await makeReadyRuntime316();
    try {
      const r = readOk(runtime, ['bare']);
      expect(r.value).toBe(7);
      expect(r.schema).not.toBeNull();
      expect(r.schema!.valueSchema).toEqual({ kind: 'int' });
      expect(Object.keys(r.schema!.valueSchema)).toEqual(['kind']);
    } finally {
      await runtime.close();
    }
  });

  it("['c']：range 两键必在场——value=1，valueSchema = {kind:'range',min:0.5,max:1.5}", async () => {
    const runtime = await makeReadyRuntime316();
    try {
      const r = readOk(runtime, ['c']);
      expect(r.value).toBe(1);
      expect(r.schema).not.toBeNull();
      expect(r.schema!.valueSchema).toEqual({ kind: 'range', min: 0.5, max: 1.5 });
    } finally {
      await runtime.close();
    }
  });

  it("['e',1]：数组元素 int 叶——value=7，valueSchema = {kind:'int',min:0,max:9}", async () => {
    const runtime = await makeReadyRuntime316();
    try {
      const r = readOk(runtime, ['e', 1]);
      expect(r.value).toBe(7);
      expect(r.schema).not.toBeNull();
      expect(r.schema!.valueSchema).toEqual({ kind: 'int', min: 0, max: 9 });
    } finally {
      await runtime.close();
    }
  });

  it("['r','k']：Record 值叶 int——value=5，valueSchema = {kind:'int',min:0,max:9}", async () => {
    const runtime = await makeReadyRuntime316();
    try {
      const r = readOk(runtime, ['r', 'k']);
      expect(r.value).toBe(5);
      expect(r.schema).not.toBeNull();
      expect(r.schema!.valueSchema).toEqual({ kind: 'int', min: 0, max: 9 });
    } finally {
      await runtime.close();
    }
  });

  it("['u']：union 叶原样透传——首成员 int 叶（与 pattern 侧同构语义）", async () => {
    const runtime = await makeReadyRuntime316();
    try {
      const r = readOk(runtime, ['u']);
      expect(r.value).toBe(2);
      expect(r.schema).not.toBeNull();
      expect(r.schema!.valueSchema).toEqual({
        kind: 'union',
        members: [
          { kind: 'int', min: 1, max: 3 },
          { kind: 'scalar', type: 'string' },
        ],
      });
    } finally {
      await runtime.close();
    }
  });

  it("['b'] 的 docs 切片含 'ROOT.b' 且内容非空（ADR 0019 行内前置 doc）", async () => {
    const runtime = await makeReadyRuntime316();
    try {
      const r = readOk(runtime, ['b']);
      expect(r.schema).not.toBeNull();
      const docs = r.schema!.docs;
      expect(Object.keys(docs)).toContain('ROOT.b');
      expect(docs['ROOT.b']!.join(' ').trim().length).toBeGreaterThan(0);
    } finally {
      await runtime.close();
    }
  });
});

describe('C3c — readData 投影隔离（每次读 detached 深拷贝、不冻结、零缓存）', () => {
  it('两次读内容全等但引用不共享；改写首读投影后重读逐字等于 pristine 且非同一对象', async () => {
    const runtime = await makeReadyRuntime316();
    try {
      const pristine = oracle(['b']);
      const first = readOk(runtime, ['b']);
      expect(first.schema).toEqual(pristine);
      const p = first.schema;
      if (p === null) throw new Error('契约前提失败：ready 态路径内读 schema 应为投影');
      // 可变普通副本（不冻结）——与 #273 契约同款纪律
      expect(Object.isFrozen(p.valueSchema)).toBe(false);
      expect(Object.isFrozen(p.docs)).toBe(false);
      // 污染：valueSchema 附加属性 + docs 条目替换
      (p.valueSchema as Record<string, unknown>)['tainted'] = true;
      (p.docs as Record<string, unknown>)['ROOT.b'] = ['corrupted'];

      const second = readOk(runtime, ['b']);
      expect(second.schema).toEqual(pristine);
      expect(second.schema).not.toBe(p);
      expect(second.schema!.valueSchema).not.toBe(p.valueSchema);
      expect(second.schema!.docs).not.toBe(p.docs);
      expect(second.schema!.docs['ROOT.b']).toEqual(pristine.docs['ROOT.b']);
    } finally {
      await runtime.close();
    }
  });
});

describe('C3c — readData 失败面与 pattern 叶配对（同码、无 schema 键、path 回显）', () => {
  it("['b','x'] 与 ['p','x'] 同为 PATH_NOT_ALLOWED（值读终态短路；失败对象无 schema 键）", async () => {
    const runtime = await makeReadyRuntime316();
    try {
      for (const path of [['b', 'x'], ['p', 'x']] as const) {
        const r = runtime.readData([...path]);
        expect(r.ok).toBe(false);
        if (r.ok) throw new Error(`期望 ok:false：${JSON.stringify(path)}`);
        expect(r.code).toBe('PATH_NOT_ALLOWED');
        expect(r.path).toEqual([...path]);
        expect(Object.hasOwn(r, 'schema')).toBe(false);
      }
    } finally {
      await runtime.close();
    }
  });
});

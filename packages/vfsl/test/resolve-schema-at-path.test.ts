/**
 * SA6 红灯契约测试 — resolveSchemaAtPath（Issue #272 / ADR-0016「解析语义」节）。
 *
 * 契约来源（任务简报「What to build」解析语义 6 条 + AC1–AC3；ADR-0016 为权威母法；
 * ADR-0003 §3 any-of「任一成员出现即存在」+ §4 ref 按名保留；写侧对偶 drillStep）：
 *
 * - AC1：`resolveSchemaAtPath(derived, path)` 经 vfsl 公共入口（包 index）导出；结果
 *   联合失败分支 `{ok:false, code:'SCHEMA_PATH_NOT_FOUND'|'SCHEMA_PATH_INVALID', path}`
 *   ——path 回显调用方数组的**新鲜副本**（改原数组不影响已回显结果；两次调用不共享）；
 * - AC2：union 静态 any-member 扩展（与写守卫 drillStep「任一成员接纳即放行」同构、
 *   与值无关、不按判别式收窄）；终点多候选合成 union 节点（无判别式缓存）；Record
 *   keyPattern 正则实测 fail-closed（失配 → SCHEMA_PATH_NOT_FOUND）；optional 游走
 *   透明展开 / 返回子树原样保留；ref 目标缺失（畸形派生物）抛 InternalError（不进
 *   结果联合）；结构侧终态镜像写守卫「路径不存在」→ SCHEMA_PATH_NOT_FOUND（标量
 *   leaf 下钻 / YPlainArray 内部位）；形状守卫（对象位 number 段 / 数组位非整数
 *   下标）→ SCHEMA_PATH_INVALID；
 * - AC3：docs/aliasDocs 切片键与派生文档三表键规约同构（键 ⊆ 既有表、内容逐字、
 *   不发明键）；别名表 = 返回子树 ref 的传递闭包（递归别名不发散、JSON 可序列化）；
 *   非空 docs 切片 = 脊柱（沿 P 的键）+ 终点子树后代/闭包别名内部注释（键集见断言）；
 * - 同步、纯函数、零 memo、结果联合拒绝（红线：畸形 ref 必须 throw 逃逸，不得收编
 *   为联合失败——SA8 冲突门禁下游红线 1）。
 *
 * 红灯现状（能力缺口 = 接缝缺失）：当前 index.ts 尚无 resolveSchemaAtPath 导出。
 * 本文件以**动态接缝**取函数——顶层不静态 import 缺失名目（vfsl 包 typecheck 保持
 * 绿），每条断言红灯显式报「接缝缺失」原因；SA3 实现公共导出后翻绿。断言全部锚定
 * 可观测运行时行为（结果形状 / 值 schema 内容 / 键集 / 内容逐字 / throw），不读
 * 源码、不 grep 文本。类型面（签名 / 判别联合 / 投影四件套）由
 * resolve-schema-at-path.test-d.ts 锚定。
 */
import { describe, expect, it } from 'vitest';
import { parseVfsl, evaluate } from '../src/index.js';
import { InternalError } from '../src/resolve.js';
import type { DerivedSchema, VfslModule, ValueSchema } from '../src/index.js';
import {
  FIXTURE_TEXT,
  DOC_AUDIT_CREATEDBY,
  DOC_ROOT_AUDIT,
  DOC_ROOT_NOTES,
  DOC_ROOT_KEYWORDS,
  DOC_ROOT_CONFIG,
  DOC_AUDIT_ALIAS,
  DOC_ASSET_ENTITY_ALIAS,
  VALUE_AUDIT,
  VALUE_ASSET_ENTITY_UNION,
  VALUE_ROOT,
  VALUE_ASSETS_RECORD,
  SYNTH_UNION_MEMBERS,
} from './resolve-schema-at-path-fixture.js';

// —— 契约类型（镜像 ADR-0016 签名块；公共类型名目由 test-d 锚定，本文件不依赖）——

/** 投影体（ADR-0016「投影体」节四件套）。 */
interface Projection {
  valueSchema: ValueSchema;
  aliases: Record<string, ValueSchema>;
  docs: Record<string, readonly string[]>;
  aliasDocs: Record<string, readonly string[]>;
}

/** 结果联合：ok 分支 = 投影；失败分支 = 两枚稳定码 + path 回显（新鲜副本）。 */
type ResolveSchemaAtPathResult =
  | ({ ok: true } & Projection)
  | { ok: false; code: 'SCHEMA_PATH_NOT_FOUND' | 'SCHEMA_PATH_INVALID'; path: Array<string | number> };

type ResolveSchemaAtPath = (
  derived: DerivedSchema,
  path: readonly (string | number)[],
) => ResolveSchemaAtPathResult;

// —— 动态接缝（红灯原因显式化；SA3 导出后翻绿）——

let seamCached: ResolveSchemaAtPath | null = null;

async function seam(): Promise<ResolveSchemaAtPath> {
  if (seamCached) return seamCached;
  const mod = (await import('../src/index.js')) as Record<string, unknown>;
  const fn = mod['resolveSchemaAtPath'];
  if (typeof fn !== 'function') {
    throw new Error(
      '红灯基线：vfsl 公共入口 index 尚未导出 resolveSchemaAtPath（Issue #272 能力缺口 = 接缝缺失；' +
        '实现公共导出后本断言自动翻绿）',
    );
  }
  seamCached = fn as ResolveSchemaAtPath;
  return seamCached;
}

// —— 测试辅助 ——

function parseOk(text: string): VfslModule {
  const result = parseVfsl(text);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`前置 parseVfsl 失败（不应发生）：${JSON.stringify(result.issues)}`);
  }
  return result.module;
}

/** parse → evaluate 全链路（evaluate 为绿色基线——ok 断言是前置不变量而非本契约断言）。 */
function evaluateFixture(text: string = FIXTURE_TEXT): DerivedSchema {
  const result = evaluate(parseOk(text));
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`evaluate 失败（前置不变量违反）：${JSON.stringify(result.issues)}`);
  }
  return result.derived;
}

/** JSON 深拷贝——派生 schema 纯数据契约；畸形/递归夹具在拷贝上构造，不污染共享派生。 */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 递归删除全部 `discriminator` 键——构造「无判别式缓存」派生物（ADR 0003 §3 透明性）。 */
function stripDiscriminators<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripDiscriminators(v)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'discriminator') continue;
      out[k] = stripDiscriminators(v);
    }
    return out as unknown as T;
  }
  return value;
}

/** 过滤出非空内容条目（切片是否保留空数组条目属设计自由度——契约不锁存在性）。 */
function nonEmpty(record: Record<string, readonly string[]>): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {};
  for (const [k, v] of Object.entries(record)) {
    if (v.length > 0) out[k] = v;
  }
  return out;
}

/** 合成 union 成员多集比较：数量与内容精确锁定，顺序不锁（收集序属设计自由度）。 */
function expectSameSchemaMembers(actual: readonly unknown[], expected: readonly unknown[]): void {
  expect(actual).toHaveLength(expected.length);
  const canon = (nodes: readonly unknown[]): string[] => nodes.map((n) => JSON.stringify(n)).sort();
  expect(canon(actual)).toEqual(canon(expected));
}

/** 断言 resolve 结果为 ok 并返回投影；红灯阶段接缝缺失以 seam() throw 呈现（fail 即红）。 */
async function resolveOk(
  derived: DerivedSchema,
  path: readonly (string | number)[],
): Promise<Projection> {
  const fn = await seam();
  const r = fn(derived, path);
  expect(r).toMatchObject({ ok: true });
  if (!r.ok) {
    throw new Error(`期望 ok:true，实际 ${JSON.stringify(r)}`);
  }
  return r;
}

// —— 断言体 ——

describe('resolveSchemaAtPath — AC1 公共接缝与结果形状', () => {
  it('公共入口 index 导出同步纯函数（typeof function；结果非 Promise）', async () => {
    const fn = await seam();
    expect(typeof fn).toBe('function');
    const r = fn(evaluateFixture(), []);
    expect(r).not.toBeInstanceOf(Promise);
  });

  it('空路径 [] 返回 ROOT 值 schema 投影：valueSchema = 整棵 ROOT 值子树（optional/Record 原样保留）', async () => {
    const derived = evaluateFixture();
    const r = await resolveOk(derived, []);
    expect(r.valueSchema).toEqual(VALUE_ROOT);
  });

  it('ok 分支恰含五键 {ok, valueSchema, aliases, docs, aliasDocs}（ADR-0016 投影四件套）', async () => {
    const r = await resolveOk(evaluateFixture(), []);
    expect(Object.keys(r).sort()).toEqual(['aliasDocs', 'aliases', 'docs', 'ok', 'valueSchema']);
  });

  it('同步纯函数观察面：同输入两次调用结果内容全等（确定性）；结果可 JSON 序列化往返', async () => {
    const derived = evaluateFixture();
    const fn = await seam();
    const a = fn(derived, ['audit']);
    const b = fn(derived, ['audit']);
    expect(a).toEqual(b);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a); // 纯数据、零 memo 不改变可观测结果
  });
});

describe('resolveSchemaAtPath — AC1 失败码与 path 新鲜副本回显', () => {
  it('SCHEMA_PATH_NOT_FOUND：封闭对象未知字段（写守卫「路径不存在」同构位）', async () => {
    const fn = await seam();
    const r = fn(evaluateFixture(), ['nope']);
    expect(r).toEqual({ ok: false, code: 'SCHEMA_PATH_NOT_FOUND', path: ['nope'] });
  });

  it('SCHEMA_PATH_NOT_FOUND：union 全体成员均无该字段（static any-member 无一接纳）', async () => {
    const fn = await seam();
    const r = fn(evaluateFixture(), ['u', 'z']);
    expect(r).toEqual({ ok: false, code: 'SCHEMA_PATH_NOT_FOUND', path: ['u', 'z'] });
  });

  it('SCHEMA_PATH_NOT_FOUND：Record keyPattern 失配 fail-closed（写侧值级键校验同向拒绝）', async () => {
    const fn = await seam();
    const r = fn(evaluateFixture(), ['assets', 'bad key!']);
    expect(r).toEqual({ ok: false, code: 'SCHEMA_PATH_NOT_FOUND', path: ['assets', 'bad key!'] });
  });

  it('SCHEMA_PATH_NOT_FOUND：optional 透明展开后为标量终态，下钻无候选接纳', async () => {
    const fn = await seam();
    expect(fn(evaluateFixture(), ['notes', 'x'])).toEqual({
      ok: false,
      code: 'SCHEMA_PATH_NOT_FOUND',
      path: ['notes', 'x'],
    });
  });

  it('SCHEMA_PATH_NOT_FOUND：YPlainArray 内部位（写守卫「纯值终态只能整体替换」同构——整位可解析、内部不可下钻）', async () => {
    const fn = await seam();
    expect(fn(evaluateFixture(), ['attachments', 0])).toEqual({
      ok: false,
      code: 'SCHEMA_PATH_NOT_FOUND',
      path: ['attachments', 0],
    });
  });

  it('SCHEMA_PATH_INVALID：对象位收到 number 段（写守卫「对象位置需要 string 键段」同构）', async () => {
    const fn = await seam();
    expect(fn(evaluateFixture(), [0])).toEqual({
      ok: false,
      code: 'SCHEMA_PATH_INVALID',
      path: [0],
    });
  });

  it('SCHEMA_PATH_INVALID：数组位收到 string 段（写守卫「数组位置需要整数 number 下标段」同构）', async () => {
    const fn = await seam();
    expect(fn(evaluateFixture(), ['keywords', '0'])).toEqual({
      ok: false,
      code: 'SCHEMA_PATH_INVALID',
      path: ['keywords', '0'],
    });
  });

  it('SCHEMA_PATH_INVALID：数组位收到负数/非整数 number 段（形状守卫）', async () => {
    const fn = await seam();
    expect(fn(evaluateFixture(), ['keywords', -1])).toEqual({
      ok: false,
      code: 'SCHEMA_PATH_INVALID',
      path: ['keywords', -1],
    });
  });

  it('失败码 path 回显为调用方数组的新鲜副本：改原数组不影响已回显结果，两次调用不共享', async () => {
    const fn = await seam();
    const derived = evaluateFixture();
    const caller = ['nope'];
    const r1 = fn(derived, caller);
    const r2 = fn(derived, caller);
    if (r1.ok || r2.ok) throw new Error('期望 NOT_FOUND');
    expect(r1.path).toEqual(['nope']);
    expect(r1.path).not.toBe(caller); // 非同一引用
    expect(r1.path).not.toBe(r2.path); // 两次调用各自新鲜
    caller[0] = 'mutated';
    expect(r1.path).toEqual(['nope']); // 原数组突变不穿透
    const r3 = fn(derived, [0]);
    if (r3.ok) throw new Error('期望 INVALID');
    expect(r3.path).toEqual([0]);
    expect(r3.path).not.toBe(r1.path);
  });
});

describe('resolveSchemaAtPath — AC2 union 静态 any-member 扩展与合成 union 终点', () => {
  it("Record '<key>' + union 下钻（img1 过 keyPattern）命中 member0 字段：端点 = scalar string", async () => {
    const r = await resolveOk(evaluateFixture(), ['assets', 'img1', 'url']);
    expect(r.valueSchema).toEqual({ kind: 'scalar', type: 'string' });
    expect(Object.keys(r.aliases)).toHaveLength(0);
  });

  it('union 下钻路径合法 ⟺ 端点可解析：值缺席（键从未写入）也照常解析（解析与实际值无关）', async () => {
    const r = await resolveOk(evaluateFixture(), ['assets', 'new1', 'url']);
    expect(r.valueSchema).toEqual({ kind: 'scalar', type: 'string' });
  });

  it("终点多候选合成 union 节点：['u','x'] 命中 m0.x（string）与 m1.x（array<number>）", async () => {
    const r = await resolveOk(evaluateFixture(), ['u', 'x']);
    const node = r.valueSchema as { kind: string; members?: unknown[]; discriminator?: unknown };
    expect(node.kind).toBe('union');
    // 合成 union 恰两键（无判别式缓存——合法 ValueSchema 形状）
    expect(Object.keys(node)).toEqual(['kind', 'members']);
    expectSameSchemaMembers(node.members ?? [], SYNTH_UNION_MEMBERS as unknown as readonly unknown[]);
  });

  it("端点恰为单候选 ref 时按名保留、不内联展开：['assets','img1'] → ref AssetEntity（ADR 0003 §4）", async () => {
    const r = await resolveOk(evaluateFixture(), ['assets', 'img1']);
    expect(r.valueSchema).toEqual({ kind: 'ref', name: 'AssetEntity' });
    expect(Object.keys(r.aliases).sort()).toEqual(['AssetEntity', 'Audit']); // 体内 audit ref → 闭包含 Audit
    expect(r.aliases['Audit']).toEqual(VALUE_AUDIT);
    expect(stripDiscriminators(r.aliases['AssetEntity'])).toEqual(
      stripDiscriminators(VALUE_ASSET_ENTITY_UNION),
    );
  });

  it('解析与判别式缓存无关：剥光 discriminator 的派生 schema 产生同内容结果（不按值收窄）', async () => {
    const derived = evaluateFixture();
    const stripped = stripDiscriminators(deepClone(derived));
    const fn = await seam();
    for (const p of [
      ['u', 'x'],
      ['u', 'z'],
      ['assets', 'img1', 'url'],
      ['assets', 'new1', 'url'],
      ['audit'],
    ] as const) {
      expect(fn(stripped, p)).toEqual(fn(derived, p));
    }
  });
});

describe('resolveSchemaAtPath — AC2 Record keyPattern fail-closed 与 Record 终点', () => {
  it("Record 终点（['assets']）：返回子树含 '<key>' 槽与 keyPattern（Record 语义原样保留）", async () => {
    const r = await resolveOk(evaluateFixture(), ['assets']);
    expect(r.valueSchema).toEqual(VALUE_ASSETS_RECORD);
  });

  it("动态键段过正则实测放行：['assets','img1'] → 终点 = '<key>' 槽值 ref AssetEntity", async () => {
    const r = await resolveOk(evaluateFixture(), ['assets', 'img1']);
    expect(r.valueSchema).toEqual({ kind: 'ref', name: 'AssetEntity' });
  });

  it('keyPattern 失配 fail-closed 由失败码组锚定；Record 对象位 number 段仍归形状守卫 INVALID', async () => {
    const fn = await seam();
    expect(fn(evaluateFixture(), ['assets', 7])).toEqual({
      ok: false,
      code: 'SCHEMA_PATH_INVALID',
      path: ['assets', 7],
    });
  });
});

describe('resolveSchemaAtPath — AC2 optional 游走透明展开 / 返回原样保留', () => {
  it("optional 字段终点原样保留：['notes'] → {kind:'optional', value: scalar string}", async () => {
    const r = await resolveOk(evaluateFixture(), ['notes']);
    expect(r.valueSchema).toEqual({ kind: 'optional', value: { kind: 'scalar', type: 'string' } });
  });

  it("optional(object) 终点原样保留：['config'] → optional 包 object（可缺席是值语义的一部分）", async () => {
    const r = await resolveOk(evaluateFixture(), ['config']);
    expect(r.valueSchema).toEqual({
      kind: 'optional',
      value: {
        kind: 'object',
        fields: [{ name: 'retries', value: { kind: 'scalar', type: 'number' } }],
      },
    });
  });

  it("optional 游走透明展开：['config','retries'] 穿透 optional 包装命中内层字段 → scalar number", async () => {
    const r = await resolveOk(evaluateFixture(), ['config', 'retries']);
    expect(r.valueSchema).toEqual({ kind: 'scalar', type: 'number' });
  });

  it('ROOT [] 返回子树中 optional 包装原样在场（VALUE_ROOT.notes/config 均为 optional 节点）', async () => {
    const r = await resolveOk(evaluateFixture(), []);
    expect(r.valueSchema).toEqual(VALUE_ROOT);
  });

  it('YPlainArray 整位读 = 值语义照常（array<string>）；内部位拒绝由失败码组锚定', async () => {
    const r = await resolveOk(evaluateFixture(), ['attachments']);
    expect(r.valueSchema).toEqual({ kind: 'array', element: { kind: 'scalar', type: 'string' } });
  });
});

describe('resolveSchemaAtPath — AC2 ref 目标缺失 → InternalError（畸形派生物，不进结果联合）', () => {
  it('游走中需展开缺失 ref（删 values/aliases 双表 AssetEntity）：抛 InternalError，绝不降级为联合失败', async () => {
    const derived = deepClone(evaluateFixture());
    delete derived.values['AssetEntity'];
    delete derived.aliases['AssetEntity'];
    const fn = await seam();
    let caught: unknown;
    try {
      fn(derived, ['assets', 'img1', 'url']);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InternalError);
    if (caught instanceof Error) expect(caught.name).toBe('InternalError');
  });

  it('终点 ref 缺失（删 Audit）同样抛 InternalError（别名表须给出闭包内容，缺失 = 畸形派生物）', async () => {
    const derived = deepClone(evaluateFixture());
    delete derived.values['Audit'];
    delete derived.aliases['Audit'];
    const fn = await seam();
    expect(() => fn(derived, ['audit'])).toThrow(InternalError);
  });
});

describe('resolveSchemaAtPath — AC3 docs/aliasDocs 切片与别名传递闭包', () => {
  it('标量叶子读：docs 含脊柱键 ROOT.notes（内容逐字）；无其他非空 docs/aliasDocs；闭包为空', async () => {
    const r = await resolveOk(evaluateFixture(), ['notes']);
    expect(r.docs['ROOT.notes']).toEqual([DOC_ROOT_NOTES]);
    expect(nonEmpty(r.docs)).toEqual({ 'ROOT.notes': [DOC_ROOT_NOTES] });
    expect(nonEmpty(r.aliasDocs)).toEqual({});
    expect(Object.keys(r.aliases)).toHaveLength(0);
  });

  it("别名终点读 ['audit']：docs = 脊柱 ROOT.audit + 闭包别名内部 Audit.createdBy；aliasDocs 按别名名", async () => {
    const r = await resolveOk(evaluateFixture(), ['audit']);
    expect(r.valueSchema).toEqual({ kind: 'ref', name: 'Audit' });
    expect(r.docs['ROOT.audit']).toEqual([DOC_ROOT_AUDIT]);
    expect(r.docs['Audit.createdBy']).toEqual([DOC_AUDIT_CREATEDBY]);
    expect(nonEmpty(r.docs)).toEqual({
      'ROOT.audit': [DOC_ROOT_AUDIT],
      'Audit.createdBy': [DOC_AUDIT_CREATEDBY],
    });
    expect(r.aliasDocs['Audit']).toEqual([DOC_AUDIT_ALIAS]);
    expect(nonEmpty(r.aliasDocs)).toEqual({ Audit: [DOC_AUDIT_ALIAS] });
    expect(Object.keys(r.aliases)).toEqual(['Audit']);
    expect(r.aliases['Audit']).toEqual(VALUE_AUDIT);
  });

  it("别名内深读 ['audit','createdBy']：docs = 沿 P 的键（ROOT.audit + Audit.createdBy）；闭包空 → aliasDocs 无非空", async () => {
    const r = await resolveOk(evaluateFixture(), ['audit', 'createdBy']);
    expect(r.valueSchema).toEqual({ kind: 'scalar', type: 'string' });
    expect(nonEmpty(r.docs)).toEqual({
      'ROOT.audit': [DOC_ROOT_AUDIT],
      'Audit.createdBy': [DOC_AUDIT_CREATEDBY],
    });
    expect(nonEmpty(r.aliasDocs)).toEqual({});
    expect(Object.keys(r.aliases)).toHaveLength(0);
  });

  it('空路径 [] 读：docs 非空切片 = 终点子树全部注释位（含闭包别名内部）；aliasDocs = 闭包别名级注释', async () => {
    const r = await resolveOk(evaluateFixture(), []);
    expect(nonEmpty(r.docs)).toEqual({
      'ROOT.audit': [DOC_ROOT_AUDIT],
      'ROOT.notes': [DOC_ROOT_NOTES],
      'ROOT.keywords': [DOC_ROOT_KEYWORDS],
      'ROOT.config': [DOC_ROOT_CONFIG],
      'Audit.createdBy': [DOC_AUDIT_CREATEDBY],
    });
    expect(nonEmpty(r.aliasDocs)).toEqual({
      Audit: [DOC_AUDIT_ALIAS],
      AssetEntity: [DOC_ASSET_ENTITY_ALIAS],
    });
    expect(Object.keys(r.aliases).sort()).toEqual(['AssetEntity', 'Audit', 'U']);
  });

  it('键规约同构 + 内容逐字（跨读集不变量）：docs 键 ⊆ fieldDocs∪markerDocs 键、aliasDocs ⊆ aliasDocs 表、aliases ⊆ values 表', async () => {
    const derived = evaluateFixture();
    const fn = await seam();
    const fieldKeys = new Set(Object.keys(derived.fieldDocs));
    const markerKeys = new Set(Object.keys(derived.markerDocs));
    const aliasDocKeys = new Set(Object.keys(derived.aliasDocs));
    const valueKeys = new Set(Object.keys(derived.values));
    const paths: Array<Array<string | number>> = [
      [],
      ['notes'],
      ['audit'],
      ['audit', 'createdBy'],
      ['config'],
      ['keywords'],
      ['assets'],
      ['assets', 'img1'],
      ['assets', 'img1', 'url'],
      ['u', 'x'],
      ['attachments'],
    ];
    for (const p of paths) {
      const r = await resolveOk(derived, p);
      for (const [k, v] of Object.entries(r.docs)) {
        expect(fieldKeys.has(k) || markerKeys.has(k)).toBe(true); // 不发明键（§3 语法路径/别名锚定文法）
        const field = derived.fieldDocs[k] ?? [];
        const marker = derived.markerDocs[k] ?? [];
        expect(v).toEqual([...field, ...marker]); // 内容逐字（夹具位无同键双非空，合并序不敏感）
      }
      for (const [k, v] of Object.entries(r.aliasDocs)) {
        expect(aliasDocKeys.has(k)).toBe(true);
        expect(v).toEqual(derived.aliasDocs[k]);
      }
      for (const k of Object.keys(r.aliases)) {
        expect(valueKeys.has(k)).toBe(true);
      }
    }
  });

  it('别名表 = 传递闭包且递归别名不发散：自引用别名 → 单名闭包、终止、JSON 可序列化', async () => {
    const derived = deepClone(evaluateFixture());
    derived.values['Audit'] = {
      kind: 'object',
      fields: [{ name: 'self', value: { kind: 'ref', name: 'Audit' } }],
    };
    const r = await resolveOk(derived, ['audit']);
    expect(r.valueSchema).toEqual({ kind: 'ref', name: 'Audit' });
    expect(Object.keys(r.aliases)).toEqual(['Audit']); // 名集去重 → 不发散
    expect(r.aliases['Audit']).toEqual(derived.values['Audit']); // 内容按名保留（ref 不内联展开）
    expect(JSON.parse(JSON.stringify(r))).toEqual(r); // 递归安全性在数据面成立
  });
});

/**
 * SA6 红灯测试 — 派生 schema 携带 docs（ADR 0005 §3 契约落地）+ typeCls 签名收敛（Issue #29）。
 *
 * 契约来源（任务简报 AC + SA5 报告《20260819-bug-vfsl-derived-docs-typecls.md》）：
 * - AC1：derived 的别名 / map 字段 / 标记节点携带 docs: string[]（无注释为空数组，与 IR §7.2
 *   同款必填纪律——exactOptionalPropertyTypes 下为必填键而非条件展开）；
 * - AC2：docs 内容自 IR 对应节点逐字继承（含联合成员内字段、标记实参位）；
 * - AC3：派生 schema JSON 序列化往返仍无损（含 docs）；
 * - AC4：typeCls 收敛为 Resolver 方法（沿 resolveChain 先例），调用方不再解包 Resolver 成员；
 * - AC5：存量 253 测试全绿——本文件新增断言全部落在**新增顶层槽位**，既有 StructureNode /
 *   MapField / ValueSchema / ValueField / IndexEntry 形状零改动（既有测试对上述形状做了
 *   精确 toEqual，加必填键即违约，故 docs 三锚以三张新表承载）；
 * - AC6：规格 §10 fixture 求值后 ROOT/Audit 等节点 docs 与 IR 一致。
 *
 * docs 承载位置（SA6 红灯契约即定形；SA5 报告「别名级承载位置需 SA1 定形」以本文件为准）：
 * - DerivedSchema.aliasDocs: Record<别名名, string[]>——别名级（含 ROOT；每别名一项；
 *   VfslAlias.docs 逐字继承）；
 * - DerivedSchema.fieldDocs: Record<语法路径, string[]>——结构树字段级（键与 index 键同构；
 *   联合成员内字段以 '<member N>' 段定位，N = 成员声明序 0 起；Record 值位合成字段 '<key>'
 *   同表；VfslField.docs 逐字继承）；
 * - DerivedSchema.markerDocs: Record<语法路径, string[]>——标记级（标记在字段类型位 → 该字段
 *   路径；标记在别名体根 → 别名名路径；marker.docs 逐字继承）。
 *
 * 断言纪律：全部锚定 evaluate 的**可观测输出**（运行时行为 / 模块导出），不读源码、不 grep
 * 文本形状。typeCls 收敛按 SKILL 合法模式三件套：模块导出断言（自由函数不再导出）+ Resolver
 * 方法形态 + 方法语义（驱动真实代码路径）。resolve.ts 为内部件（不进公共面，SA5 报告
 * Evidence 5），签名收敛不构成公共 API 破坏。
 *
 * 红灯现状：derived 无任何 docs 槽位（SA5 Evidence 2：派生 JSON 中 "docs" 键计数 0），
 * typeCls 仍以自由函数从 resolve.ts 导出——本文件全部 docs 断言与 typeCls 断言当前必然失败。
 */
import { describe, expect, it } from 'vitest';
import { parseVfsl, evaluate } from '../src/index.js';
import type { VfslModule, VfslType } from '../src/index.js';

// —— 规格 §10 vfs3.assets 参考 fixture（与 evaluate-derived-schema.test.ts 同文本；7 处 docs）——

const FIXTURE = `
/** vfs3.assets — 依据 issue #9 描述还原（原设计文档缺位） */

/** 资产 ID：键约束由 Pattern 定义，禁 "." 与 "|" */
type AssetId = string & Pattern<"^[A-Za-z0-9_\\\\-]{1,64}$">;

/** 审计信息：所有写入留痕 */
type Audit = YMap<{
  createdBy: YLeaf<string>;
  createdAt: YLeaf<number>;
}>;

/** 资产实体：按 kind 判别的封闭联合 */
type AssetEntity =
  | { kind: "image"; url: YLeaf<string>; width: YLeaf<number>; height: YLeaf<number>; audit: Audit }
  | { kind: "text"; body: YXmlFragment<{ paragraphs: YArray<YLeaf<string>> }>; audit: Audit }
  | { kind: "file"; name: YLeaf<string>; size: YLeaf<number>; tags: YArray<YLeaf<string>>; audit: Audit };

/** 附件：与 Yjs 同步无关的纯值数组 */
type Attachments = YPlainArray<YLeaf<string>>;

/** ROOT：命名空间根文档，assets 键集受 AssetId 的 Pattern 约束 */
type ROOT = YMap<{
  assets: Record<AssetId, AssetEntity>;
  attachments: Attachments;
  audit: Audit;
  /** @semantic 可选说明字段 */
  notes?: YLeaf<string>;
  keywords: YLeaf<string>[];
}>;
`.trim();

// —— 合成模块：三锚位全覆盖（联合成员内字段位 / 标记实参内字段位 / 别名体与字段类型标记位）——

const SYNTH = `
/** 联合实体 */
type Entity =
  | { /** 变体标记 */ kind: "image"; /** 图片地址 */ url: YLeaf<string> }
  | { kind: "text"; /** 正文 */ body: YMap<{ /** 段落 */ paragraphs: YArray<YLeaf<string>> }> };

/** 单例容器 */
type Box = /** 容器标记 */ YMap<{ item: YLeaf<number> }>;

type ROOT = {
  /** 根字段 */
  e: Entity;
  b: Box;
  /** 包内字段 */
  n: /** 内层标记 */ YLeaf<string>;
};
`.trim();

// —— 测试辅助 ——

function parseOk(text: string): VfslModule {
  const result = parseVfsl(text);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`前置 parseVfsl 失败（不应发生）：${JSON.stringify(result.issues)}`);
  }
  return result.module;
}

/** parse → evaluate 全链路；断言 ok:true 并返回 derived（红灯 = docs 槽位缺失）。 */
function evaluateModule(text: string): unknown {
  const result = evaluate(parseOk(text));
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`evaluate 失败（当前契约预期 ok:true）：${JSON.stringify(result.issues)}`);
  }
  return result.derived;
}

/** docs 三表安全取值（表缺失 / 键缺失 → null，保证红灯以断言不匹配呈现而非抛错）。 */
function slot(derived: unknown, table: 'aliasDocs' | 'fieldDocs' | 'markerDocs', key: string): string[] | null {
  const t = (derived as Record<string, Record<string, string[]> | undefined>)[table];
  return t?.[key] ?? null;
}

// —— 契约断言 ——

describe('evaluate — 派生 schema 携带 docs（ADR 0005 §3 三锚位）', () => {
  it('AC6：§10 fixture 各别名 docs 与 IR 逐字一致（含 ROOT/Audit/AssetId 具名锚）', () => {
    const module = parseOk(FIXTURE);
    const derived = evaluateModule(FIXTURE);
    // 逐字继承全量锚：派生 aliasDocs 与 IR VfslAlias.docs 一一对应
    for (const a of module.aliases) {
      expect(slot(derived, 'aliasDocs', a.name)).toEqual(a.docs);
    }
    // AC6 具名锚（文档注释原文逐字，含前导/尾随空白）
    expect(slot(derived, 'aliasDocs', 'ROOT')).toEqual([' ROOT：命名空间根文档，assets 键集受 AssetId 的 Pattern 约束 ']);
    expect(slot(derived, 'aliasDocs', 'Audit')).toEqual([' 审计信息：所有写入留痕 ']);
    expect(slot(derived, 'aliasDocs', 'AssetId')).toEqual([
      ' vfs3.assets — 依据 issue #9 描述还原（原设计文档缺位） ',
      ' 资产 ID：键约束由 Pattern 定义，禁 "." 与 "|" ',
    ]);
    expect(slot(derived, 'aliasDocs', 'AssetEntity')).toEqual([' 资产实体：按 kind 判别的封闭联合 ']);
    expect(slot(derived, 'aliasDocs', 'Attachments')).toEqual([' 附件：与 Yjs 同步无关的纯值数组 ']);
  });

  it('AC1+AC2：字段位 docs——fixture ROOT.notes 与 IR 逐字一致（标记实参内字段位）', () => {
    const module = parseOk(FIXTURE);
    const derived = evaluateModule(FIXTURE);
    const rootType = module.aliases.find((a) => a.name === 'ROOT')!.type;
    if (rootType.kind !== 'marker' || rootType.marker !== 'YMap') throw new Error('ROOT 应为 YMap 标记');
    if (rootType.arg.kind !== 'object') throw new Error('ROOT 实参应为对象');
    const notes = rootType.arg.fields.find((f) => f.name === 'notes')!;
    expect(slot(derived, 'fieldDocs', 'ROOT.notes')).toEqual(notes.docs); // 与 IR 逐字一致
    expect(slot(derived, 'fieldDocs', 'ROOT.notes')).toEqual([' @semantic 可选说明字段 ']);
  });

  it('AC1：无注释字段/标记/别名携带空数组（无 doc 为空数组——与 IR §7.2 同款必填）', () => {
    const derived = evaluateModule(FIXTURE);
    expect(slot(derived, 'fieldDocs', 'ROOT.assets')).toEqual([]); // 命名字段无 doc
    expect(slot(derived, 'fieldDocs', 'ROOT.assets.<key>')).toEqual([]); // Record 值位合成字段
    expect(slot(derived, 'fieldDocs', 'ROOT.keywords')).toEqual([]); // 数组字段无 doc
    expect(slot(derived, 'markerDocs', 'ROOT')).toEqual([]); // ROOT 的 YMap 标记
    expect(slot(derived, 'markerDocs', 'Audit')).toEqual([]); // Audit 的 YMap 标记
    expect(slot(derived, 'markerDocs', 'ROOT.notes')).toEqual([]); // notes 的 YLeaf 标记
    expect(slot(derived, 'markerDocs', 'AssetEntity.<member 2>.tags')).toEqual([]); // 联合成员内 YArray 标记
  });

  it('AC2：docs 逐字继承含联合成员内字段位与标记实参位（合成模块全量）', () => {
    const derived = evaluateModule(SYNTH);
    // 联合成员内字段位（<member N> 段 = 成员声明序，0 起）
    expect(slot(derived, 'fieldDocs', 'Entity.<member 0>.kind')).toEqual([' 变体标记 ']);
    expect(slot(derived, 'fieldDocs', 'Entity.<member 0>.url')).toEqual([' 图片地址 ']);
    expect(slot(derived, 'fieldDocs', 'Entity.<member 1>.kind')).toEqual([]); // 无 doc → 空数组
    expect(slot(derived, 'fieldDocs', 'Entity.<member 1>.body')).toEqual([' 正文 ']);
    // 标记实参内字段位（YMap<{…}> 实参内字段，嵌套）
    expect(slot(derived, 'fieldDocs', 'Entity.<member 1>.body.paragraphs')).toEqual([' 段落 ']);
    // 别名体内字段位 + ROOT 字段位（含 ref 字段）
    expect(slot(derived, 'fieldDocs', 'Box.item')).toEqual([]);
    expect(slot(derived, 'fieldDocs', 'ROOT.e')).toEqual([' 根字段 ']);
    expect(slot(derived, 'fieldDocs', 'ROOT.b')).toEqual([]);
    expect(slot(derived, 'fieldDocs', 'ROOT.n')).toEqual([' 包内字段 ']);
    // 别名级
    expect(slot(derived, 'aliasDocs', 'Entity')).toEqual([' 联合实体 ']);
    expect(slot(derived, 'aliasDocs', 'Box')).toEqual([' 单例容器 ']);
    expect(slot(derived, 'aliasDocs', 'ROOT')).toEqual([]);
    // 标记位：别名体根标记 + 字段类型位标记 + 标记实参内标记
    expect(slot(derived, 'markerDocs', 'Box')).toEqual([' 容器标记 ']);
    expect(slot(derived, 'markerDocs', 'ROOT.n')).toEqual([' 内层标记 ']);
    expect(slot(derived, 'markerDocs', 'Entity.<member 0>.url')).toEqual([]); // YLeaf 无 doc
    expect(slot(derived, 'markerDocs', 'Entity.<member 1>.body')).toEqual([]); // YMap 无 doc
    expect(slot(derived, 'markerDocs', 'Entity.<member 1>.body.paragraphs')).toEqual([]); // YArray 无 doc
    expect(slot(derived, 'markerDocs', 'Box.item')).toEqual([]); // YLeaf 无 doc
  });

  it('AC3：派生 schema JSON 序列化往返无损（含 docs 三锚）', () => {
    const derived = evaluateModule(FIXTURE);
    const round: unknown = JSON.parse(JSON.stringify(derived));
    expect(round).toEqual(derived);
    expect(slot(round, 'aliasDocs', 'ROOT')).toEqual([' ROOT：命名空间根文档，assets 键集受 AssetId 的 Pattern 约束 ']);
    expect(slot(round, 'fieldDocs', 'ROOT.notes')).toEqual([' @semantic 可选说明字段 ']);
    expect(slot(round, 'markerDocs', 'ROOT')).toEqual([]);
  });
});

describe('evaluate — typeCls 签名收敛（Standards 轴：Resolver 内聚，对齐 resolveChain 先例）', () => {
  it('AC4：resolve.ts 不再以自由函数导出 typeCls（模块级导出断言）', async () => {
    const mod = await import('../src/resolve.js');
    expect((mod as { typeCls?: unknown }).typeCls).toBeUndefined();
  });

  it('AC4：Resolver 携带 typeCls(t) 方法形态（调用方不再解包 cls/bodies 传参）', async () => {
    const { buildResolver } = await import('../src/resolve.js');
    const module = parseOk('type S = "x" | "y";\ntype ROOT = { s: S };');
    const R = buildResolver(module);
    expect(typeof (R as unknown as { typeCls?: unknown }).typeCls).toBe('function');
  });

  it('AC4：Resolver.typeCls(t) 语义不变（scalar/map 判定与收敛前自由函数一致）', async () => {
    const { buildResolver } = await import('../src/resolve.js');
    const module = parseOk(
      'type S = "x" | "y";\ntype M = { a: number };\ntype U = M | { b: string };\ntype ROOT = { s: S; u: U };',
    );
    const R = buildResolver(module);
    const byName = new Map(module.aliases.map((a) => [a.name, a.type]));
    const r = R as unknown as { typeCls?: (t: VfslType) => string };
    expect(r.typeCls?.(byName.get('S')!)).toBe('scalar'); // 全标量联合 → scalar
    expect(r.typeCls?.(byName.get('M')!)).toBe('map'); // 对象 → map
    expect(r.typeCls?.(byName.get('U')!)).toBe('map'); // ref 成员 + 内联对象成员混合 → map（fold）
    expect(r.typeCls?.(byName.get('ROOT')!)).toBe('map'); // 对象 → map
  });
});

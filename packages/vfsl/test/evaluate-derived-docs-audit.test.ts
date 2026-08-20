/**
 * SA7 动态补充测试 — docs 三表审计（Issue #29；SA4 动态审核重点 #1/#2 回流落地）。
 *
 * 契约来源（SA1 设计 §8「SA7 动态补充方向」#1–#3 + §3.3 契约空白定形；文件名为
 * ALLOW LIST 固定条目 `[SA7 owned]`，不替代 SA6 红灯 8 断言的验收义务）：
 * - #1 排序全键集对账：§4.5 排序字面量三断言（拦「计数对而键集错」——R1 事故形态）
 *   + 性质断言「零碰撞模块 markerDocs 键数 === IR marker 节点总数」「aliasDocs 键数
 *   恒 = 别名数」（结构性封死漏走标记位 / 漏立别名行）；
 * - #2 手造 IR 三例 E100：alias / field / marker 三锚任一 docs 缺失或非数组 →
 *   loud 边界（TypeError → 顶层 catch → VFSL-E100 前缀），附合法 fixture 正向对照
 *   （防守卫误伤正常路径）。断言只验冻结前缀，不要求消息含 docs 值（SA2 R2 口径）；
 * - #3 无 undefined 全树性质：derived 全树遍历任何层级不出现 undefined 值（补
 *   JSON 往返 toEqual 对对象内 undefined 键不敏感的盲区）；
 * - §3.3 同路径嵌套标记串联：`YMap<YMap<{…}>>` / `YLeaf<YLeaf<string>>` 等
 *   parser 可达碰撞形的 markerDocs 按源序串联（外层标记在前）——红灯 8 断言未覆盖
 *   的契约空白；另锚 record `<key>` 合成字段恒空数组（IR record 无 docs 槽，即使
 *   值位标记携带 docs 也不入 fieldDocs）。
 *
 * 断言纪律：全部锚定 evaluate 的可观测输出（运行时行为），不读源码、不 grep 文本形状。
 */
import { describe, expect, it } from 'vitest';
import { parseVfsl, evaluate } from '../src/index.js';
import type { VfslModule, VfslType } from '../src/index.js';

// —— 规格 §10 vfs3.assets 参考 fixture（与 evaluate-derived-docs-typecls.test.ts 同文本）——

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

// —— 合成模块：三锚位全覆盖（与红灯测试同文本；键集 3 / 9 / 7）——

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

// —— 嵌套标记合成模块（§3.3 碰撞形 + record 值位锚；红灯 8 断言未覆盖的契约空白）——
//
// 嵌套形均为 parser 可达（E304：YMap 实参 map 形——YMap 即 map 形；YLeaf 实参标量形
// ——YLeaf<string> 即标量形）。多 doc 标记（NestMulti：外层两段连续 doc）锚「按记号
// 出现序拼接」到数组级，而非仅单元素退化形。

const NESTED = `
/** 嵌套地图 */
type NestMap = /** 外层 */ YMap</** 内层 */ YMap<{ f: string }>>;

type NestLeaf = /** A */ YLeaf</** B */ YLeaf<string>>;

type NestMulti = /** d1 */ /** d2 */ YMap</** d3 */ YMap<{ g: string }>>;

type ROOT = {
  m: /** 外M */ YMap</** 内M */ YMap<{ v: string }>>;
  r: Record<string, /** 值标记 */ YMap<{ w: string }>>;
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

/** parse → evaluate 全链路；断言 ok:true 并返回 derived。 */
function evaluateModule(text: string): unknown {
  const result = evaluate(parseOk(text));
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`evaluate 失败（当前契约预期 ok:true）：${JSON.stringify(result.issues)}`);
  }
  return result.derived;
}

function docsTable(derived: unknown, table: 'aliasDocs' | 'fieldDocs' | 'markerDocs'): Record<string, string[]> {
  const t = (derived as Record<string, unknown>)[table] as Record<string, string[]> | undefined;
  if (t === undefined) throw new Error(`derived 缺少 docs 三表之 ${table}（审计对象缺失，loud 失败）`);
  return t;
}

/** IR 标记节点计数（每别名树内遍历，ref 终态不穿越——与 walkDocs 同纪律）。 */
function countMarkers(t: VfslType): number {
  switch (t.kind) {
    case 'marker':
      return 1 + countMarkers(t.arg);
    case 'object':
      return t.fields.reduce((n, f) => n + countMarkers(f.type), 0);
    case 'union':
      return t.members.reduce((n, m) => n + countMarkers(m), 0);
    case 'array':
      return countMarkers(t.element);
    case 'record':
      return countMarkers(t.key) + countMarkers(t.value);
    default:
      return 0; // ref 不穿越 / primitive / literal / pattern
  }
}

function moduleMarkerCount(module: VfslModule): number {
  return module.aliases.reduce((n, a) => n + countMarkers(a.type), 0);
}

/** 全树无 undefined 值（对象属性值为 undefined / 数组元素为 undefined 均抛）。 */
function expectNoUndefined(node: unknown, trail: string): void {
  if (node === undefined) throw new Error(`derived 树中出现 undefined 值：${trail}`);
  if (Array.isArray(node)) {
    node.forEach((v, i) => expectNoUndefined(v, `${trail}[${i}]`));
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) expectNoUndefined(v, `${trail}.${k}`);
  }
}

/** 手造 IR loud 边界断言（§3.4）：ok:false 且冻结前缀 VFSL-E100（不要求消息含 docs 值）。 */
function expectE100(result: ReturnType<typeof evaluate>): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('unreachable（上方断言已拦）');
  expect(result.issues.length).toBeGreaterThan(0);
  expect(result.issues[0]!.message.startsWith('VFSL-E100')).toBe(true);
}

/**
 * 手造 IR 构造（§8 方向 #2）：取合法 FIXTURE 的解析产物深拷贝后外科手术式破坏单个
 * docs 槽——等价于「不经 parseVfsl 直接构造畸形 module」，且锚点定位不脆（不手写
 * 整棵 IR）。structuredClone 保持其余子树为真实 parser 产物。
 */
function tamperedFixture(mutate: (m: VfslModule) => void): ReturnType<typeof evaluate> {
  // VfslModule 为纯 JSON 数据（kind 判别联合 + 字符串/数组），JSON 深拷贝等价 structuredClone
  //（tsconfig lib ES2022 无该全局，不引 DOM/node types）。
  const module = JSON.parse(JSON.stringify(parseOk(FIXTURE))) as VfslModule;
  mutate(module);
  return evaluate(module);
}

// —— §8 方向 #1：排序全键集对账（拦「计数对而键集错」）+ 结构性质 ——

describe('evaluate — docs 三表排序全键集对账（设计 §4.5 字面量）', () => {
  it('FIXTURE：aliasDocs / fieldDocs / markerDocs 排序全键集逐字全等（5 / 22 / 18）', () => {
    const derived = evaluateModule(FIXTURE);
    expect([...Object.keys(docsTable(derived, 'aliasDocs'))].sort()).toEqual([
      'AssetEntity', 'AssetId', 'Attachments', 'Audit', 'ROOT']);
    expect([...Object.keys(docsTable(derived, 'fieldDocs'))].sort()).toEqual([
      'AssetEntity.<member 0>.audit', 'AssetEntity.<member 0>.height', 'AssetEntity.<member 0>.kind',
      'AssetEntity.<member 0>.url', 'AssetEntity.<member 0>.width',
      'AssetEntity.<member 1>.audit', 'AssetEntity.<member 1>.body', 'AssetEntity.<member 1>.body.paragraphs',
      'AssetEntity.<member 1>.kind',
      'AssetEntity.<member 2>.audit', 'AssetEntity.<member 2>.kind', 'AssetEntity.<member 2>.name',
      'AssetEntity.<member 2>.size', 'AssetEntity.<member 2>.tags',
      'Audit.createdAt', 'Audit.createdBy',
      'ROOT.assets', 'ROOT.assets.<key>', 'ROOT.attachments', 'ROOT.audit', 'ROOT.keywords', 'ROOT.notes']);
    expect([...Object.keys(docsTable(derived, 'markerDocs'))].sort()).toEqual([
      'AssetEntity.<member 0>.height', 'AssetEntity.<member 0>.url', 'AssetEntity.<member 0>.width',
      'AssetEntity.<member 1>.body', 'AssetEntity.<member 1>.body.paragraphs',
      'AssetEntity.<member 1>.body.paragraphs.<item>',
      'AssetEntity.<member 2>.name', 'AssetEntity.<member 2>.size', 'AssetEntity.<member 2>.tags',
      'AssetEntity.<member 2>.tags.<item>',
      'Attachments', 'Attachments.<item>', 'Audit', 'Audit.createdAt', 'Audit.createdBy',
      'ROOT', 'ROOT.keywords.<item>', 'ROOT.notes']);
  });

  it('FIXTURE：性质断言——marker 节点计数 = markerDocs 键数；aliasDocs 键数 = 别名数（零碰撞模块）', () => {
    const module = parseOk(FIXTURE);
    const derived = evaluateModule(FIXTURE);
    // 键集字面量（上一断言）锚绝对真值；本性质断言结构性封死「漏走某个标记位」类缺陷
    // ——任何把 IR marker 节点走丢（switch 漏分支 / 提前 return）的实现都会使两数失衡。
    expect(Object.keys(docsTable(derived, 'markerDocs')).length).toBe(moduleMarkerCount(module));
    expect(Object.keys(docsTable(derived, 'aliasDocs')).length).toBe(module.aliases.length);
  });

  it('SYNTH：排序全键集逐字全等（3 / 9 / 7）+ 同组性质断言', () => {
    const module = parseOk(SYNTH);
    const derived = evaluateModule(SYNTH);
    expect([...Object.keys(docsTable(derived, 'aliasDocs'))].sort()).toEqual(['Box', 'Entity', 'ROOT']);
    expect([...Object.keys(docsTable(derived, 'fieldDocs'))].sort()).toEqual([
      'Box.item',
      'Entity.<member 0>.kind', 'Entity.<member 0>.url',
      'Entity.<member 1>.body', 'Entity.<member 1>.body.paragraphs', 'Entity.<member 1>.kind',
      'ROOT.b', 'ROOT.e', 'ROOT.n']);
    expect([...Object.keys(docsTable(derived, 'markerDocs'))].sort()).toEqual([
      'Box', 'Box.item',
      'Entity.<member 0>.url', 'Entity.<member 1>.body', 'Entity.<member 1>.body.paragraphs',
      'Entity.<member 1>.body.paragraphs.<item>',
      'ROOT.n']);
    expect(Object.keys(docsTable(derived, 'markerDocs')).length).toBe(moduleMarkerCount(module));
    expect(Object.keys(docsTable(derived, 'aliasDocs')).length).toBe(module.aliases.length);
  });
});

// —— §8 方向 #2：手造 IR 三例 E100（三锚统一 loud 边界）+ 正向对照 ——

describe('evaluate — 手造 IR docs 槽异常 → E100（设计 §3.4）', () => {
  it('(a) 别名锚 docs 缺失（undefined）→ ok:false + VFSL-E100 冻结前缀', () => {
    const result = tamperedFixture((m) => {
      const root = m.aliases.find((a) => a.name === 'ROOT')!;
      (root as { docs: string[] | undefined }).docs = undefined;
    });
    expectE100(result);
  });

  it('(b) 字段锚 docs 缺失（undefined）→ ok:false + VFSL-E100 冻结前缀', () => {
    const result = tamperedFixture((m) => {
      const root = m.aliases.find((a) => a.name === 'ROOT')!;
      if (root.type.kind !== 'marker' || root.type.arg.kind !== 'object') throw new Error('前置形状不符');
      const notes = root.type.arg.fields.find((f) => f.name === 'notes')!;
      (notes as { docs: string[] | undefined }).docs = undefined;
    });
    expectE100(result);
  });

  it('(c) 标记锚 docs 非数组（字符串 "foo"）→ ok:false + VFSL-E100 冻结前缀（不被字符级展开）', () => {
    const result = tamperedFixture((m) => {
      const root = m.aliases.find((a) => a.name === 'ROOT')!;
      (root.type as { docs: unknown }).docs = 'foo'; // R1 缺陷形态：无守卫时 [ ...'foo' ] 字符级展开
    });
    expectE100(result);
  });

  it('正向对照：合法 FIXTURE 求值仍 ok:true（守卫不误伤正常路径）', () => {
    const result = evaluate(parseOk(FIXTURE));
    expect(result.ok).toBe(true);
  });
});

// —— §8 方向 #3：无 undefined 全树性质（补 JSON 往返 toEqual 盲区）——

describe('evaluate — derived 全树无 undefined 值（设计 §8 方向 #3）', () => {
  it('FIXTURE 全树（含三表）任何层级不出现 undefined 值', () => {
    expectNoUndefined(evaluateModule(FIXTURE), 'derived');
  });

  it('SYNTH 全树（含三表）任何层级不出现 undefined 值', () => {
    expectNoUndefined(evaluateModule(SYNTH), 'derived');
  });
});

// —— §3.3：同路径嵌套标记串联（外层在前，源序）+ record <key> 恒空数组 ——

describe('evaluate — 嵌套标记 markerDocs 源序串联（设计 §3.3）', () => {
  it('YMap<YMap<{…}>>：两标记同键（别名体根路径），外层 docs 在前', () => {
    const derived = evaluateModule(NESTED);
    expect(docsTable(derived, 'markerDocs')['NestMap']).toEqual([' 外层 ', ' 内层 ']);
    expect(docsTable(derived, 'fieldDocs')['NestMap.f']).toEqual([]); // 内层实参字段位不因嵌套改道
  });

  it('YLeaf<YLeaf<string>>：两标记同键，外层在前', () => {
    const derived = evaluateModule(NESTED);
    expect(docsTable(derived, 'markerDocs')['NestLeaf']).toEqual([' A ', ' B ']);
  });

  it('多 doc 标记参与串联：数组级拼接按记号出现序（外层两段连续 doc 在前）', () => {
    const derived = evaluateModule(NESTED);
    expect(docsTable(derived, 'markerDocs')['NestMulti']).toEqual([' d1 ', ' d2 ', ' d3 ']);
  });

  it('字段类型位嵌套标记同键串联（ROOT.m）+ 内层实参字段路径不串位', () => {
    const derived = evaluateModule(NESTED);
    expect(docsTable(derived, 'markerDocs')['ROOT.m']).toEqual([' 外M ', ' 内M ']);
    expect(docsTable(derived, 'fieldDocs')['ROOT.m.v']).toEqual([]);
  });

  it('record `<key>` 合成字段恒空数组（IR record 无 docs 槽）；值位标记 docs 入 markerDocs 同路径', () => {
    const derived = evaluateModule(NESTED);
    // 契约锚：即使 record 值位标记携带 docs，<key> 合成字段的 fieldDocs 仍恒 []（§3.2 规则表）。
    expect(docsTable(derived, 'fieldDocs')['ROOT.r']).toEqual([]); // r 字段自身无 doc
    expect(docsTable(derived, 'fieldDocs')['ROOT.r.<key>']).toEqual([]);
    expect(docsTable(derived, 'markerDocs')['ROOT.r.<key>']).toEqual([' 值标记 ']);
    expect(docsTable(derived, 'fieldDocs')['ROOT.r.<key>.w']).toEqual([]); // 值位标记透明递归内的字段
  });

  it('嵌套模块性质断言：碰撞形下 marker 节点计数 ≥ markerDocs 键数（串联收敛键数）', () => {
    const module = parseOk(NESTED);
    const derived = evaluateModule(NESTED);
    // NESTED 含 4 处碰撞（NestMap/NestLeaf/NestMulti/ROOT.m 各两标记一键）+ 1 处单标记
    // （ROOT.r.<key>）+ 透明递归内 0 标记——键数 = 节点数 - 碰撞收敛数。
    const keys = Object.keys(docsTable(derived, 'markerDocs')).length;
    const nodes = moduleMarkerCount(module);
    expect(keys).toBeLessThanOrEqual(nodes);
    expect(keys).toBe(nodes - 4); // 4 处双标记碰撞各收敛 1 键
  });
});

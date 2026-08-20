/**
 * SA6 红灯测试 — 求值器核心：evaluate 公共导出与派生 schema（Issue #20）。
 *
 * 契约来源（ADR-0003 已接受 + 任务简报验收标准）：
 * - ADR-0003 §1：第二公共导出 evaluate(module) → { ok: true; derived } | { ok: false; issues }；
 *   派生 schema 纯数据、可 JSON 序列化、无行列（内容哈希纪律）；
 * - ADR-0003 §3：联合 = { kind: 'union'; members } 分支列表（any-of 匹配语义，声明序）；
 *   存在全成员互异字面量字段 → 附判别式缓存（O(1) 跳转）；缓存缺失/存在不改变可观测行为；
 *   无判别联合「逐个尝试」与「有缓存」两路径输出全等；no-match 诊断（失败距离最小成员 +
 *   「联合成员 i/N」）所需数据预置为接缝；
 * - ADR-0003 §4：ref 按名引用不内联展开；派生 schema 照搬 IR 模块形状（别名表 + ref 节点）；
 *   解析动作由包内共享解析器完成；派生物大小 O(文本规模)，菱形引用链 2^N 对抗不炸；
 * - ADR-0003 §5：xml-fragment 为结构树终态节点（不透明，无 children）；
 * - 简报验收标准：结构树节点全形态（root/map/array/xml-fragment/leaf/plain/union/ref）、
 *   物化折叠四规则（裸对象→map、裸 T[]→array、全标量联合→leaf、YPlainArray 子树→plain）
 *   正反断言、值 schema（字面量枚举 / Pattern 正则 / optional）、路径索引
 *   （exact / pattern 键匹配，ref 穿透 + Record 键模式）、§10 fixture（含 ROOT）全量求值。
 *
 * 派生 schema 形状（本文件内类型定义 = 测试契约，SA3 按此实现）：
 * - aliases: 别名名 → 结构节点（ref 保留不展开，ADR §4 别名表）；
 * - structure: 结构树入口，root 节点包裹 ROOT 的 map 物化；
 * - values: 别名名 → 值 schema（与结构树正交：物化语义 vs 值语义）；
 * - index: 路径 → 条目（match: 'exact' | 'pattern'；Record 键段 '<key>' 与数组段
 *   '<item>' 为 pattern 条目，Record 键带 Pattern 约束时 keyPattern 携带解码后正则）。
 *
 * 路径索引与 ref 穿透的关系（契约裁定）：索引键 = 语法路径（ref 为终态节点，不展开），
 * 保证菱形链派生物（含索引）恒为 O(文本规模)；ref 穿透是查询期能力——索引 + 别名表
 * 足以支撑穿透下钻（ADR §4「解析动作由包内共享解析器完成」），本文件 resolvePath 即
 * 最小消费者验证数据充分性。
 *
 * 红灯现状：evaluate 尚未在包公共面导出，全部测试当前必然失败（接缝缺失即红灯，
 * 非伪红）；SA3 实现公共导出后转绿。断言全部锚定 evaluate 的可观测输出（派生 schema
 * 数据形状与行为不变量），不读取源码、不 grep 文本形状。
 */
import { describe, expect, it } from 'vitest';
import { parseVfsl, evaluate } from '../src/index.js';
import type { VfslIssue } from '../src/index.js';

// —— 测试契约类型（ADR 0003 + 简报 AC 的派生 schema 形状）——

interface Discriminator {
  /** 判别字段名（全体成员互异的字面量字段） */
  field: string;
  /** 字面量值 → 成员序号（O(1) 跳转；顺序 = 声明序） */
  byValue: Record<string, number>;
}

/** 结构树节点（Yjs 物化语义；ref / leaf / plain / xml-fragment 为终态） */
type StructureNode =
  | { kind: 'root'; node: StructureNode } // ROOT 入口（派生 schema 的根）
  | { kind: 'map'; fields: MapField[] } // Y.Map 封闭键空间（字段按声明序）
  | { kind: 'array'; element: StructureNode } // Y.Array（T[] 默认物化）
  | { kind: 'xml-fragment' } // Y.XmlFragment 不透明终态（ADR §5）
  | { kind: 'leaf' } // 原生叶子值（标量形物化）
  | { kind: 'plain' } // YPlainArray 子树纯值上下文（不可下钻）
  | { kind: 'union'; members: StructureNode[]; discriminator?: Discriminator } // 分支列表
  | { kind: 'ref'; name: string }; // 按名引用（不内联展开，ADR §4）

interface MapField {
  name: string;
  optional: boolean;
  node: StructureNode;
}

/** 值 schema（值类型语义：封闭对象 / 判别联合 / 字面量联合 / pattern 约束） */
type ValueSchema =
  | { kind: 'object'; fields: ValueField[] } // 封闭对象（未声明字段拒绝）
  | { kind: 'array'; element: ValueSchema } // 数组值语义（T[] / YArray / YPlainArray）
  | { kind: 'xml' } // YXmlFragment：JSON 快照值为 XML 字符串
  | { kind: 'union'; members: ValueSchema[]; discriminator?: Discriminator }
  | { kind: 'enum'; values: Array<string | number> } // 字面量联合 → 枚举（声明序）
  | { kind: 'pattern'; regex: string } // string & Pattern<"…">（解码后原文）
  | { kind: 'scalar'; type: 'string' | 'number' | 'boolean' | 'null' | 'unknown' }
  | { kind: 'optional'; value: ValueSchema } // ?: 可选字段
  | { kind: 'ref'; name: string };

interface ValueField {
  name: string;
  value: ValueSchema;
}

/** 路径索引条目（键匹配：exact = 精确路径；pattern = 约束键段） */
interface IndexEntry {
  match: 'exact' | 'pattern';
  /** Record 键为 string & Pattern 时的解码后正则（仅 pattern 条目可携带） */
  keyPattern?: string;
  node: StructureNode;
}

interface DerivedSchema {
  /** 别名表（ADR §4：照搬 IR 模块形状，ref 不展开；含 ROOT） */
  aliases: Record<string, StructureNode>;
  /** 结构树入口：root 节点（ROOT 物化为 Y.Map） */
  structure: StructureNode;
  /** 值 schema：每别名的值语义 */
  values: Record<string, ValueSchema>;
  /** 路径索引：路径 → 条目（路径 = ROOT 起 '.' 连接的语法路径） */
  index: Record<string, IndexEntry>;
}

type EvaluateResult =
  | { ok: true; derived: DerivedSchema }
  | { ok: false; issues: VfslIssue[] };

// —— 规格 §10 vfs3.assets 参考 fixture（含 ROOT；与 parse 侧测试同文本，parse 已绿）——

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

/** AssetId 解码后正则（VFSL §2 注记 6：\\- 双写解码为 \-） */
const ASSET_ID_REGEX = '^[A-Za-z0-9_\\-]{1,64}$';

// —— 测试辅助 ——

function parseOk(text: string): ReturnType<typeof parseVfsl> extends infer R
  ? R extends { ok: true; module: infer M }
    ? M
    : never
  : never {
  const result = parseVfsl(text);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`前置 parseVfsl 失败（不应发生）：${JSON.stringify(result.issues)}`);
  }
  return result.module;
}

/** parse → evaluate 全链路；断言 ok:true 并返回 derived（红灯 = evaluate 接缝缺失）。 */
function evaluateModule(text: string): DerivedSchema {
  const result: EvaluateResult = evaluate(parseOk(text));
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`evaluate 失败（当前契约预期 ok:true）：${JSON.stringify(result.issues)}`);
  }
  return result.derived;
}

function asRoot(node: StructureNode): Extract<StructureNode, { kind: 'root' }> {
  if (node.kind !== 'root') throw new Error(`期望 root 节点，实际 ${node.kind}`);
  return node;
}

/** ROOT map 内按字段名下钻（结构树字段访问辅助）。 */
function resolveStructureField(structure: StructureNode, name: string): StructureNode {
  const root = asRoot(structure);
  if (root.node.kind !== 'map') throw new Error(`ROOT 应物化为 map，实际 ${root.node.kind}`);
  const field = root.node.fields.find((f) => f.name === name);
  if (!field) {
    throw new Error(`字段 ${name} 不在 ROOT 键空间: ${root.node.fields.map((f) => f.name).join(',')}`);
  }
  return field.node;
}

/** 结构树 kind 收集（ref / leaf / plain / xml-fragment 终态不下钻）。 */
function collectStructureKinds(node: StructureNode, out: Set<string>): void {
  out.add(node.kind);
  switch (node.kind) {
    case 'root':
      collectStructureKinds(node.node, out);
      break;
    case 'map':
      for (const f of node.fields) collectStructureKinds(f.node, out);
      break;
    case 'array':
      collectStructureKinds(node.element, out);
      break;
    case 'union':
      for (const m of node.members) collectStructureKinds(m, out);
      break;
    default:
      break; // ref / leaf / plain / xml-fragment 终态
  }
}

/** 全量对象键收集（断言派生物无行列纪律用）。 */
function collectObjectKeys(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, out);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out.add(key);
      collectObjectKeys((value as Record<string, unknown>)[key], out);
    }
  }
}

/**
 * 最小消费者：路径穿透下钻（ADR §4「解析动作由包内共享解析器完成」的查询期语义）。
 * 以索引最长前缀定位入口条目，剩余段经 ref（别名表）/ union（any-of 任一成员）穿透。
 */
function walkFrom(derived: DerivedSchema, node: StructureNode, segments: string[], i: number): StructureNode | null {
  if (i >= segments.length) return node;
  const seg = segments[i]!;
  switch (node.kind) {
    case 'root':
      return walkFrom(derived, node.node, segments, i);
    case 'ref': {
      const target = derived.aliases[node.name];
      return target ? walkFrom(derived, target, segments, i) : null;
    }
    case 'map': {
      const field = node.fields.find((f) => f.name === seg);
      return field ? walkFrom(derived, field.node, segments, i + 1) : null;
    }
    case 'array':
      return walkFrom(derived, node.element, segments, i + 1);
    case 'union': {
      // any-of 匹配语义：任一成员下钻成功即存在（ADR §3 路径存在性）
      for (const member of node.members) {
        const hit = walkFrom(derived, member, segments, i);
        if (hit) return hit;
      }
      return null;
    }
    default:
      return null; // leaf / plain / xml-fragment 终态
  }
}

function resolvePath(derived: DerivedSchema, path: string): StructureNode | null {
  const segments = path.split('.');
  for (let n = segments.length; n >= 1; n--) {
    const entry = derived.index[segments.slice(0, n).join('.')];
    if (entry) {
      const node = walkFrom(derived, entry.node, segments, n);
      if (node) return node;
    }
  }
  return null;
}

// —— 测试 ——

describe('evaluate — ADR 0003 §1 接缝：结果联合形状与派生 schema 纪律', () => {
  it('AC1：evaluate 为包的第二公共导出（函数）', () => {
    expect(typeof evaluate).toBe('function');
  });

  it('AC1：合法模块 → ok:true，结果携带 derived（ok 判别联合分支）', () => {
    const result: EvaluateResult = evaluate(parseOk('type ROOT = { x: string };'));
    expect(typeof result.ok).toBe('boolean');
    expect(result.ok).toBe(true);
    expect(Object.keys(result)).toContain('derived');
  });

  it('AC1：evaluate 是纯函数——同输入两次求值输出全等', () => {
    const module = parseOk('type ROOT = { x: string };');
    expect(evaluate(module)).toEqual(evaluate(module));
  });

  it('AC1：ok:true 时 derived JSON 往返无损（纯数据、无函数）', () => {
    const derived = evaluateModule(FIXTURE);
    expect(JSON.parse(JSON.stringify(derived))).toEqual(derived);
  });

  it('AC1：derived 无行列位置（内容哈希纪律——任何层级不出现 line/column/pos 键）', () => {
    const keys = new Set<string>();
    collectObjectKeys(evaluateModule(FIXTURE), keys);
    for (const k of ['line', 'column', 'pos']) {
      expect(keys.has(k)).toBe(false);
    }
  });
});

describe('evaluate — 结构树节点全形态（root/map/array/xml-fragment/leaf/plain/union/ref）', () => {
  it('AC：规格 §10 fixture（含 ROOT）全量求值通过，八种节点形态齐备', () => {
    const derived = evaluateModule(FIXTURE);
    const kinds = new Set<string>();
    collectStructureKinds(derived.structure, kinds);
    for (const node of Object.values(derived.aliases)) collectStructureKinds(node, kinds);
    for (const k of ['root', 'map', 'array', 'xml-fragment', 'leaf', 'plain', 'union', 'ref']) {
      expect(kinds.has(k)).toBe(true);
    }
  });

  it('AC：root 为派生入口节点，包裹 ROOT 的 map 物化', () => {
    const derived = evaluateModule('type ROOT = { x: string };');
    const root = asRoot(derived.structure);
    expect(root.node.kind).toBe('map');
  });

  it('AC：map 字段保留声明序，字段含 optional 与节点', () => {
    const derived = evaluateModule('type ROOT = { x: string; y?: number };');
    const root = asRoot(derived.structure);
    if (root.node.kind !== 'map') throw new Error(`ROOT 应物化为 map，实际 ${root.node.kind}`);
    expect(root.node.fields.map((f) => [f.name, f.optional])).toEqual([
      ['x', false],
      ['y', true],
    ]);
    expect(root.node.fields[0]!.node.kind).toBe('leaf');
  });

  it('AC：xml-fragment 为终态节点（不透明语义：无 children，ADR §5）', () => {
    const derived = evaluateModule('type ROOT = { body: YXmlFragment<{ p: string }> };');
    expect(resolveStructureField(derived.structure, 'body')).toEqual({ kind: 'xml-fragment' });
  });
});

describe('evaluate — 物化折叠四规则（各含正反断言）', () => {
  it('规则1 正：裸对象 → map（默认物化即 YMap）', () => {
    const derived = evaluateModule('type ROOT = { x: string };');
    expect(asRoot(derived.structure).node.kind).toBe('map');
  });

  it('规则1 反：纯值上下文（YPlainArray 子树）内裸对象不物化为 map（→ plain 终态）', () => {
    const derived = evaluateModule('type ROOT = { items: YPlainArray<{ a: string }> };');
    expect(resolveStructureField(derived.structure, 'items')).toEqual({ kind: 'plain' });
  });

  it('规则2 正：裸 T[] → array（同步 Y.Array 物化）', () => {
    const derived = evaluateModule('type ROOT = { tags: string[] };');
    const tags = resolveStructureField(derived.structure, 'tags');
    if (tags.kind !== 'array') throw new Error(`期望 array 节点，实际 ${tags.kind}`);
    expect(tags.element.kind).toBe('leaf');
  });

  it('规则2 反：纯值上下文内裸数组不物化为 array（→ plain 终态）', () => {
    const derived = evaluateModule('type ROOT = { items: YPlainArray<string[]> };');
    expect(resolveStructureField(derived.structure, 'items')).toEqual({ kind: 'plain' });
  });

  it('规则3 正：全标量联合 → leaf（成员细节入值 schema 枚举）', () => {
    const derived = evaluateModule('type ROOT = { port: 80 | 443 };');
    expect(resolveStructureField(derived.structure, 'port')).toEqual({ kind: 'leaf' });
    expect(derived.values['ROOT']).toEqual({
      kind: 'object',
      fields: [{ name: 'port', value: { kind: 'enum', values: [80, 443] } }],
    });
  });

  it('规则3 反：全容器联合不折叠为 leaf（→ union 分支列表）', () => {
    const derived = evaluateModule('type ROOT = { m: { a: string } | { b: number } };');
    const m = resolveStructureField(derived.structure, 'm');
    if (m.kind !== 'union') throw new Error(`期望 union 节点，实际 ${m.kind}`);
    expect(m.members).toHaveLength(2);
  });

  it('规则4 正：YPlainArray 子树 → plain 纯值上下文终态', () => {
    const derived = evaluateModule('type ROOT = { items: YPlainArray<string> };');
    expect(resolveStructureField(derived.structure, 'items')).toEqual({ kind: 'plain' });
  });

  it('规则4 反：同步标记 YArray 不折叠为 plain（→ array）', () => {
    const derived = evaluateModule('type ROOT = { items: YArray<string> };');
    const items = resolveStructureField(derived.structure, 'items');
    if (items.kind !== 'array') throw new Error(`期望 array 节点，实际 ${items.kind}`);
    expect(items.element.kind).toBe('leaf');
  });

  it('规则4 反：YXmlFragment 不折叠为 plain（→ xml-fragment 终态）', () => {
    const derived = evaluateModule('type ROOT = { body: YXmlFragment<{ p: string }> };');
    expect(resolveStructureField(derived.structure, 'body')).toEqual({ kind: 'xml-fragment' });
  });
});

describe('evaluate — 联合：分支列表表示与判别式缓存边界（ADR 0003 §3）', () => {
  it('AC：联合以成员分支列表表示，成员按声明序保留', () => {
    const derived = evaluateModule('type ROOT = { m: { a: string } | { b: number } };');
    const m = resolveStructureField(derived.structure, 'm');
    if (m.kind !== 'union') throw new Error(`期望 union 节点，实际 ${m.kind}`);
    expect(m.members).toHaveLength(2);
    if (m.members[0]!.kind !== 'map' || m.members[1]!.kind !== 'map') {
      throw new Error('联合成员应为 map 节点');
    }
    expect(m.members[0]!.fields[0]!.name).toBe('a');
    expect(m.members[1]!.fields[0]!.name).toBe('b');
  });

  it('AC：全成员互异字面量字段 → 附判别式缓存（字段名 + 值→成员序号跳转表）', () => {
    const derived = evaluateModule(FIXTURE);
    const entity = derived.aliases['AssetEntity']!; // fixture 保证声明
    if (entity.kind !== 'union') throw new Error(`期望 union 节点，实际 ${entity.kind}`);
    expect(entity.discriminator).toEqual({ field: 'kind', byValue: { image: 0, text: 1, file: 2 } });
  });

  it('AC：判别式缓存与「逐个尝试」路径一致——byValue 指向的成员其判别字段字面量 = 键', () => {
    const derived = evaluateModule(FIXTURE);
    const entity = derived.aliases['AssetEntity']!; // fixture 保证声明
    const values = derived.values['AssetEntity']!;
    if (entity.kind !== 'union' || values.kind !== 'union') {
      throw new Error('结构树与值 schema 均应含 AssetEntity 联合节点');
    }
    const byValue = entity.discriminator?.byValue ?? {};
    expect(Object.keys(byValue)).toEqual(['image', 'text', 'file']);
    for (const [literal, idx] of Object.entries(byValue)) {
      const vMember = values.members[idx];
      if (vMember === undefined) throw new Error(`判别式缓存成员序号 ${idx} 越界`);
      if (vMember.kind !== 'object') throw new Error('联合成员值 schema 应为封闭对象');
      const kindField = vMember.fields.find((f) => f.name === 'kind');
      expect(kindField?.value).toEqual({ kind: 'enum', values: [literal] });
    }
  });

  it('AC：缓存缺失/存在不改变可观测行为——有缓存联合的 members 与无缓存基线全等（缓存仅附加）', () => {
    const derived = evaluateModule('type ROOT = { m: { kind: "image" } | { kind: "text" } };');
    const m = resolveStructureField(derived.structure, 'm');
    if (m.kind !== 'union') throw new Error(`期望 union 节点，实际 ${m.kind}`);
    expect(m.discriminator).toEqual({ field: 'kind', byValue: { image: 0, text: 1 } });
    const { discriminator: _cache, ...baseline } = m;
    expect(baseline).toEqual({
      kind: 'union',
      members: [
        { kind: 'map', fields: [{ name: 'kind', optional: false, node: { kind: 'leaf' } }] },
        { kind: 'map', fields: [{ name: 'kind', optional: false, node: { kind: 'leaf' } }] },
      ],
    });
  });

  it('AC：无互异字面量字段的联合不附缓存（无公共字段）', () => {
    const derived = evaluateModule('type ROOT = { m: { a: string } | { b: number } };');
    const m = resolveStructureField(derived.structure, 'm');
    if (m.kind !== 'union') throw new Error(`期望 union 节点，实际 ${m.kind}`);
    expect(Object.prototype.hasOwnProperty.call(m, 'discriminator')).toBe(false);
  });

  it('AC：无互异字面量字段的联合不附缓存（公共字段但值不两两互异）', () => {
    const derived = evaluateModule('type ROOT = { m: { kind: "a" } | { kind: "a" } };');
    const m = resolveStructureField(derived.structure, 'm');
    if (m.kind !== 'union') throw new Error(`期望 union 节点，实际 ${m.kind}`);
    expect(Object.prototype.hasOwnProperty.call(m, 'discriminator')).toBe(false);
  });
});

describe('evaluate — ref 按名引用不内联展开（ADR 0003 §4）：菱形引用链 2^N 对抗', () => {
  const N = 15; // 全展开基线 2^16 = 65536 个 map 节点

  /** 菱形链：A0={l:A1,r:A1} → … → A14={l:A15,r:A15} → A15={v:string}，ROOT=A0。 */
  function diamondText(): string {
    const lines: string[] = ['type ROOT = A0;', `type A${N} = { v: string };`];
    for (let i = N - 1; i >= 0; i--) {
      lines.push(`type A${i} = { l: A${i + 1}; r: A${i + 1} };`);
    }
    return lines.join('\n');
  }

  it('AC：派生物大小 O(文本规模)——2^N 对抗文本不炸（序列化长度线性界）', () => {
    const derived = evaluateModule(diamondText());
    const serialized = JSON.stringify(derived);
    // 全展开基线：2^16 个 map ≈ 数 MB；按名引用实现（别名表 + ref 节点）≈ 数 KB
    expect(serialized.length).toBeLessThan(50_000);
  });

  it('AC：ref 节点保留不展开——结构树与别名表均以 ref 承载，序列化中 ref/map 出现次数线性界', () => {
    const derived = evaluateModule(diamondText());
    const serialized = JSON.stringify(derived);
    // 结构树：ROOT = A0 → map，字段 l/r 均为 ref A1（未展开成 A1 的子树）
    const root = asRoot(derived.structure);
    if (root.node.kind !== 'map') throw new Error(`ROOT 应物化为 map，实际 ${root.node.kind}`);
    expect(root.node.fields.map((f) => f.node)).toEqual([
      { kind: 'ref', name: 'A1' },
      { kind: 'ref', name: 'A1' },
    ]);
    // 别名表：ROOT + A0..A15 共 N+2 项，每项 O(自身文本)
    expect(Object.keys(derived.aliases)).toHaveLength(N + 2);
    const a0 = derived.aliases['A0']!;
    if (a0.kind !== 'map') throw new Error('A0 应为 map 节点');
    expect(a0.fields.map((f) => f.node)).toEqual([
      { kind: 'ref', name: 'A1' },
      { kind: 'ref', name: 'A1' },
    ]);
    const a15 = derived.aliases[`A${N}`]!;
    if (a15.kind !== 'map') throw new Error('A15 应为 map 节点');
    expect(a15.fields.map((f) => f.name)).toEqual(['v']);
    // 线性界（全展开则指数级）：ref 节点 = 结构 2 + 索引 2 + 别名表 2N ≈ 34；map = N+2 ≈ 17
    const refs = (serialized.match(/"kind":"ref"/g) ?? []).length;
    const maps = (serialized.match(/"kind":"map"/g) ?? []).length;
    expect(refs).toBeLessThan(200);
    expect(maps).toBeLessThan(200);
  });

  it('AC：路径索引同步保持线性（不枚举 ref 穿透后的展开路径）', () => {
    const derived = evaluateModule(diamondText());
    // 语法路径仅 ROOT / ROOT.l / ROOT.r 三条
    expect(Object.keys(derived.index).length).toBeLessThanOrEqual(3 * (N + 2));
  });
});

describe('evaluate — 值 schema：字面量枚举 / Pattern 正则 / optional', () => {
  it('AC：字面量联合 → 枚举（声明序保留）', () => {
    const derived = evaluateModule('type Port = 80 | 443; type ROOT = { port: Port };');
    expect(derived.values['Port']).toEqual({ kind: 'enum', values: [80, 443] });
  });

  it('AC：string & Pattern → pattern（正则解码后原文）', () => {
    const derived = evaluateModule(FIXTURE);
    expect(derived.values['AssetId']).toEqual({ kind: 'pattern', regex: ASSET_ID_REGEX });
  });

  it('AC：?: 可选字段 → 值 schema optional 包装，且结构树字段 optional:true', () => {
    const derived = evaluateModule(FIXTURE);
    const rootValues = derived.values['ROOT']!; // fixture 保证声明
    if (rootValues.kind !== 'object') throw new Error(`ROOT 值 schema 应为封闭对象，实际 ${rootValues.kind}`);
    const notes = rootValues.fields.find((f) => f.name === 'notes');
    expect(notes?.value).toEqual({ kind: 'optional', value: { kind: 'scalar', type: 'string' } });
    const rootStruct = derived.aliases['ROOT']!; // fixture 保证声明
    if (rootStruct.kind !== 'map') throw new Error('ROOT 结构应为 map 节点');
    expect(rootStruct.fields.find((f) => f.name === 'notes')?.optional).toBe(true);
  });

  it('AC：值 schema 与结构树正交并存（同一别名两棵独立可查的树）', () => {
    const derived = evaluateModule(FIXTURE);
    expect(derived.aliases['Audit']!.kind).toBe('map');
    expect(derived.values['Audit']).toEqual({
      kind: 'object',
      fields: [
        { name: 'createdBy', value: { kind: 'scalar', type: 'string' } },
        { name: 'createdAt', value: { kind: 'scalar', type: 'number' } },
      ],
    });
  });
});

describe('evaluate — 路径索引：可查、ref 穿透、Record 键模式', () => {
  it('AC：exact 路径条目——ROOT 入口与字段路径', () => {
    const derived = evaluateModule(FIXTURE);
    const rootEntry = derived.index['ROOT'];
    expect(rootEntry?.match).toBe('exact');
    expect(rootEntry?.node.kind).toBe('root');
    const auditEntry = derived.index['ROOT.audit'];
    expect(auditEntry?.match).toBe('exact');
    if (auditEntry?.node.kind !== 'ref') throw new Error('ROOT.audit 应为 ref 节点');
    expect(auditEntry.node.name).toBe('Audit');
  });

  it('AC：Record 键模式——<key> 段为 pattern 条目且携带键约束正则', () => {
    const derived = evaluateModule(FIXTURE);
    const entry = derived.index['ROOT.assets.<key>'];
    expect(entry?.match).toBe('pattern');
    expect(entry?.keyPattern).toBe(ASSET_ID_REGEX);
    expect(entry?.node.kind).toBe('union');
  });

  it('AC：数组元素段——<item> 条目可查', () => {
    const derived = evaluateModule(FIXTURE);
    expect(derived.index['ROOT.keywords']?.node.kind).toBe('array');
    const itemEntry = derived.index['ROOT.keywords.<item>'];
    expect(itemEntry?.match).toBe('pattern');
    expect(itemEntry?.node.kind).toBe('leaf');
  });

  it('AC：ref 穿透——索引 + 别名表足以支撑穿透下钻查询（最小消费者验证数据充分性）', () => {
    const derived = evaluateModule(FIXTURE);
    // ref 穿透：ROOT.audit → ref Audit → createdBy / createdAt
    expect(resolvePath(derived, 'ROOT.audit.createdBy')?.kind).toBe('leaf');
    expect(resolvePath(derived, 'ROOT.audit.createdAt')?.kind).toBe('leaf');
    // Record 键模式 + 联合成员穿透：assets.<key> 下的字段路径
    expect(resolvePath(derived, 'ROOT.assets.<key>')?.kind).toBe('union');
    expect(resolvePath(derived, 'ROOT.assets.<key>.kind')?.kind).toBe('leaf');
    expect(resolvePath(derived, 'ROOT.assets.<key>.width')?.kind).toBe('leaf');
    expect(resolvePath(derived, 'ROOT.assets.<key>.tags')?.kind).toBe('array');
    // 纯值上下文：attachments → ref Attachments → plain 终态
    expect(resolvePath(derived, 'ROOT.attachments')?.kind).toBe('plain');
    // 数组元素穿透
    expect(resolvePath(derived, 'ROOT.keywords.<item>')?.kind).toBe('leaf');
    // 不存在路径 → null
    expect(resolvePath(derived, 'ROOT.nonexistent')).toBeNull();
    expect(resolvePath(derived, 'ROOT.audit.nonexistent')).toBeNull();
  });
});

describe('evaluate — no-match 诊断接缝（ADR 0003 §3：失败距离最小成员 + 「联合成员 i/N」）', () => {
  it('AC：联合成员按声明序编号且完整保留（诊断生成所需数据预置；计算属 validateSnapshot 消费）', () => {
    const derived = evaluateModule(FIXTURE);
    const entity = derived.aliases['AssetEntity']!; // fixture 保证声明
    if (entity.kind !== 'union') throw new Error(`期望 union 节点，实际 ${entity.kind}`);
    // 成员数 N 与编号序（i/N 相对定位）：声明序 = 判别式缓存键序
    expect(entity.members).toHaveLength(3);
    expect(Object.keys(entity.discriminator?.byValue ?? {})).toEqual(['image', 'text', 'file']);
    // 失败距离计算所需：每成员完整子树在场（各成员字段集互异，可定位最小失败成员）
    const fieldNames = entity.members.map((m) => (m.kind === 'map' ? m.fields.map((f) => f.name) : null));
    expect(fieldNames[0]).toEqual(['kind', 'url', 'width', 'height', 'audit']);
    expect(fieldNames[1]).toEqual(['kind', 'body', 'audit']);
    expect(fieldNames[2]).toEqual(['kind', 'name', 'size', 'tags', 'audit']);
  });

  it('AC：无判别联合同样保留声明序（「逐个尝试」路径的诊断基础）', () => {
    const derived = evaluateModule('type ROOT = { m: { a: string } | { b: number } };');
    const m = resolveStructureField(derived.structure, 'm');
    if (m.kind !== 'union') throw new Error(`期望 union 节点，实际 ${m.kind}`);
    if (m.members[0]!.kind !== 'map' || m.members[1]!.kind !== 'map') {
      throw new Error('联合成员应为 map 节点');
    }
    expect(m.members[0]!.fields[0]!.name).toBe('a');
    expect(m.members[1]!.fields[0]!.name).toBe('b');
  });
});

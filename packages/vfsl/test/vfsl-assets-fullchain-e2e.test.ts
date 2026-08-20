/**
 * SA6 红灯测试 — vfs3.assets 全链路端到端编排（issue #32，Phase 0 收官）。
 *
 * 契约来源（任务简报验收标准 + ADR 0003 + 规格 §10）：
 * - AC1：全链路正例——同一段 §10 fixture 文本驱动三层：parseVfsl → ok；
 *   evaluate(module) → ok；validateSnapshot(derived, 完整合法快照) → ok:true。
 *   快照须覆盖 image/text/file 三类资产 + audit + attachments + notes + keywords 全字段；
 * - AC2：派生 schema 关键节点断言——ROOT map 形态（root 包裹 map，字段声明序 +
 *   optional 精确）、assets Record 键模式（index pattern 条目 + 解码后 AssetId 正则）、
 *   AssetEntity 判别式缓存（kind 三值 → 成员序号）、text 成员 body 的 xml-fragment
 *   终态（ADR 0003 §5 不透明：无 children）、attachments 的 plain 终态；
 * - AC3：docs 抽查——派生 schema 的 ROOT/Audit/AssetEntity 节点携带 fixture 的
 *   JSDoc 原文（aliasDocs 逐字）；
 * - AC4：非法快照矩阵八面（每面至少一例，断言 issue 的 path 段数组精确）——未知键 /
 *   必填缺失 / 值类型错 / AssetId Pattern 键违例 / 联合 no-match（带「联合成员 i/N」）/
 *   YPlainArray 子树值错 / XML 非良构字符串 / kind 枚举外值；
 * - AC5：fixture 文本以规格 §10 为准（本文件副本与 §10 逐字对齐，含 Pattern 双写
 *   转义：TS 源码 `\\\\` → 运行时 `\\`，与 §10 文本一致）；
 * - AC6：不重复单点覆盖——解析行为属 #9 既有测试、校验器单点属 #21 既有测试，
 *   本文件只做全链路编排断言：每条断言均以同一 §10 文本驱动 parse → evaluate →
 *   validate 三层串联，锚定三层协同的验收契约（任何一层回归即红灯）。
 *
 * 断言纪律：全部锚定公共接缝的**可观测输出**（parse/evaluate 结果形状、派生 schema
 * 数据形状、validateSnapshot 的 issue 与 path 段数组），不读取源码、不 grep 文本形状。
 *
 * 红灯现状（Phase 1 实测）：三层实现已合入（parse #9 / evaluate #28 / docs #30 /
 * validateSnapshot #21），本文件为收官编排验收锚；若串联暴露实现缺口（如某 facet
 * 的 issue path 不精确、节点形态偏离 ADR 0003），相应断言保持红色，实测证据以
 * wiki/raw/task_vfsl-assets-fullchain-e2e.md 记录为准。
 */
import { describe, expect, it } from 'vitest';
import { parseVfsl, evaluate, validateSnapshot } from '../src/index.js';
import type { DerivedSchema, StructureNode, ValidateResult, VfslModule } from '../src/index.js';

// —— 规格 §10 vfs3.assets 参考 fixture（AC5：与 §10 逐字对齐；TS 转义后与 §10 原文一致）——

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

/** AssetId 解码后正则（VFSL §2 注记 6：`\\-` 双写解码为 `\-`；与 evaluate-derived-schema.test.ts 同款）。 */
const ASSET_ID_REGEX = '^[A-Za-z0-9_\\-]{1,64}$';

// —— 测试辅助 ——

/** 深拷贝（JSON 往返）——测试间隔离，避免共享对象被校验实现意外污染。 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const AUDIT = { createdBy: 'jim', createdAt: 1724000000000 };

/**
 * §10 fixture 的完整合法快照（AC1 内容要求：image/text/file 三类资产 + audit +
 * attachments + notes + keywords 全覆盖；每次调用返回新对象，避免测试间共享）。
 */
function validSnapshot(): Record<string, unknown> {
  return {
    assets: {
      img1: { kind: 'image', url: 'https://example.com/a.jpg', width: 800, height: 600, audit: clone(AUDIT) },
      text1: { kind: 'text', body: '<p>hello</p>', audit: clone(AUDIT) },
      file1: { kind: 'file', name: 'report.pdf', size: 2048, tags: ['a', 'b'], audit: clone(AUDIT) },
    },
    attachments: ['note.txt', 'photo.png'],
    audit: clone(AUDIT),
    keywords: ['asset', 'demo'],
    notes: 'optional note',
  };
}

/**
 * 全链路编排核心：同一段 §10 文本驱动三层——parseVfsl → evaluate → derived。
 * 每层断言 ok:true（分层失败即红灯锚点），返回 module 与 derived 供后续断言消费
 * （evaluate 消费 parse 的 module、validateSnapshot 消费 evaluate 的 derived——
 * 同一文本、逐层传递，非各自独立构造）。
 */
function chainDerived(): { module: VfslModule; derived: DerivedSchema } {
  const parsed = parseVfsl(FIXTURE);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) {
    throw new Error(`前置 parseVfsl 失败（不应发生）：${JSON.stringify(parsed.issues)}`);
  }
  const evaluated = evaluate(parsed.module);
  expect(evaluated.ok).toBe(true);
  if (!evaluated.ok) {
    throw new Error(`前置 evaluate 失败（不应发生）：${JSON.stringify(evaluated.issues)}`);
  }
  return { module: parsed.module, derived: evaluated.derived };
}

/** 非法快照矩阵公共断言：ok:false 且 issues 含指定 path 段数组。
 * 命名辨析：本助手是 validate 语义（ValidateResult + path 段数组），与既有 parse 语义
 * 助手 expectIssueAt(issue, code, line, column) 同名不同契约——故改名防误用。 */
function expectValidateIssueAt(result: ValidateResult, path: Array<string | number>): ValidateResult {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.issues.map((i) => i.path)).toContainEqual(path);
  }
  return result;
}

// —— 测试 ——

describe('vfs3.assets 全链路 — AC1：同一 §10 文本驱动 parse → evaluate → validateSnapshot', () => {
  it('AC1：全链路正例——parse ok → evaluate ok → 完整合法快照 validateSnapshot ok:true（显式逐层串联）', () => {
    // 第 1 层：解析（同一段文本）
    const parsed = parseVfsl(FIXTURE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(`parseVfsl 失败（不应发生）：${JSON.stringify(parsed.issues)}`);
    // 第 2 层：物化推导（消费第 1 层的 module）
    const evaluated = evaluate(parsed.module);
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) throw new Error(`evaluate 失败（不应发生）：${JSON.stringify(evaluated.issues)}`);
    // 第 3 层：整文档校验（消费第 2 层的 derived）
    const result = validateSnapshot(evaluated.derived, validSnapshot());
    expect(result).toEqual({ ok: true });
  });

  it('AC1：正例快照覆盖 image/text/file 三类资产 + audit + attachments + notes + keywords——恰为 { ok: true }', () => {
    const { derived } = chainDerived();
    const snap = validSnapshot();
    // 全字段在场性先验：三类资产齐备、audit/attachments/keywords/notes 全覆盖
    expect(Object.keys(snap.assets as Record<string, unknown>)).toEqual(['img1', 'text1', 'file1']);
    expect(Object.keys(snap)).toEqual(['assets', 'attachments', 'audit', 'keywords', 'notes']);
    expect(validateSnapshot(derived, snap)).toEqual({ ok: true });
  });
});

describe('vfs3.assets 全链路 — AC2：派生 schema 关键节点（物化推导产物）', () => {
  it('AC2：ROOT map 形态——structure 根为 root 包裹 map，字段声明序 assets/attachments/audit/notes/keywords，notes optional', () => {
    const { derived } = chainDerived();
    const structure: StructureNode = derived.structure;
    expect(structure.kind).toBe('root');
    if (structure.kind !== 'root') throw new Error('structure 应为 root 节点');
    expect(structure.node.kind).toBe('map'); // ROOT 固定物化为 Y.Map（ADR 0003 §2）
    if (structure.node.kind !== 'map') throw new Error('ROOT 应物化为 map');
    expect(structure.node.fields.map((f) => [f.name, f.optional])).toEqual([
      ['assets', false],
      ['attachments', false],
      ['audit', false],
      ['notes', true], // ?: 可选字段
      ['keywords', false],
    ]);
  });

  it('AC2：assets Record 键模式——路径索引 <key> 段为 pattern 条目，携带 AssetId 解码后正则', () => {
    const { derived } = chainDerived();
    const entry = derived.index['ROOT.assets.<key>'];
    expect(entry?.match).toBe('pattern');
    expect(entry?.keyPattern).toBe(ASSET_ID_REGEX);
    expect(entry?.node.kind).toBe('union'); // Record 值位 = AssetEntity 判别联合
  });

  it('AC2：AssetEntity 判别式缓存——kind 三值 image/text/file 指向成员声明序 0/1/2', () => {
    const { derived } = chainDerived();
    const entity = derived.aliases['AssetEntity']!; // fixture 保证声明
    if (entity.kind !== 'union') throw new Error('AssetEntity 应为 union 节点');
    expect(entity.members).toHaveLength(3);
    expect(entity.discriminator).toEqual({ field: 'kind', byValue: { image: 0, text: 1, file: 2 } });
  });

  it('AC2：text 成员 body 为 xml-fragment 终态——不透明节点无 children（ADR 0003 §5）', () => {
    const { derived } = chainDerived();
    const entity = derived.aliases['AssetEntity']!; // fixture 保证声明
    if (entity.kind !== 'union') throw new Error('AssetEntity 应为 union 节点');
    const textMember = entity.members[1]!; // 声明序 1 = text 成员（AC2 判别式缓存锁定）
    if (textMember.kind !== 'map') throw new Error('text 成员应为 map 节点');
    const body = textMember.fields.find((f) => f.name === 'body');
    expect(body?.node).toEqual({ kind: 'xml-fragment' }); // 终态：无实参展开、无 children
  });

  it('AC2：attachments 为 plain 终态——YPlainArray 纯值上下文不可下钻', () => {
    const { derived } = chainDerived();
    const structure: StructureNode = derived.structure;
    if (structure.kind !== 'root' || structure.node.kind !== 'map') {
      throw new Error('structure 应为 root 包裹 map');
    }
    const attachments = structure.node.fields.find((f) => f.name === 'attachments');
    expect(attachments?.node).toEqual({ kind: 'plain' });
  });
});

describe('vfs3.assets 全链路 — AC3：派生 schema 携带 fixture JSDoc（docs 抽查）', () => {
  /** docs 表安全取值（表缺失 / 键缺失 → null，保证红灯以断言不匹配呈现而非抛错）。 */
  function aliasDocs(derived: unknown, name: string): string[] | null {
    const table = (derived as { aliasDocs?: Record<string, string[]> }).aliasDocs;
    return table?.[name] ?? null;
  }

  it('AC3：ROOT/Audit/AssetEntity 节点携带 fixture 的 JSDoc 原文（逐字，含前导/尾随空白）', () => {
    const { derived } = chainDerived();
    expect(aliasDocs(derived, 'ROOT')).toEqual([' ROOT：命名空间根文档，assets 键集受 AssetId 的 Pattern 约束 ']);
    expect(aliasDocs(derived, 'Audit')).toEqual([' 审计信息：所有写入留痕 ']);
    expect(aliasDocs(derived, 'AssetEntity')).toEqual([' 资产实体：按 kind 判别的封闭联合 ']);
  });
});

describe('vfs3.assets 全链路 — AC4：非法快照矩阵（八面，issue 的 path 段数组精确）', () => {
  it('AC4-1 未知键：ROOT 层未声明键拒绝（封闭对象语义），path 精确', () => {
    const { derived } = chainDerived();
    const snap = validSnapshot();
    snap.extraKey = 1;
    expectValidateIssueAt(validateSnapshot(derived, snap), ['extraKey']);
  });

  it('AC4-2 必填缺失：ROOT.attachments 缺省报告，path 精确', () => {
    const { derived } = chainDerived();
    const snap = validSnapshot();
    delete snap.attachments;
    expectValidateIssueAt(validateSnapshot(derived, snap), ['attachments']);
  });

  it('AC4-3 值类型错：image 资产 url 收到 number（下钻至 Record 值位成员内字段），path 精确', () => {
    const { derived } = chainDerived();
    const snap = validSnapshot();
    (snap.assets as Record<string, unknown>).img1 = {
      kind: 'image', url: 42, width: 800, height: 600, audit: clone(AUDIT),
    };
    expectValidateIssueAt(validateSnapshot(derived, snap), ['assets', 'img1', 'url']);
  });

  it('AC4-4 AssetId Pattern 键违例：assets 键含 "." 拒绝，path 含违例键段', () => {
    const { derived } = chainDerived();
    const snap = validSnapshot();
    (snap.assets as Record<string, unknown>)['abc.123'] = {
      kind: 'image', url: 'u', width: 1, height: 1, audit: clone(AUDIT),
    };
    expectValidateIssueAt(validateSnapshot(derived, snap), ['assets', 'abc.123']);
  });

  it('AC4-5 联合 no-match：kind 枚举外值（缺其余字段）触发「联合成员 i/N」相对定位（text 成员失败距离最小），path 精确', () => {
    const { derived } = chainDerived();
    const snap = validSnapshot();
    (snap.assets as Record<string, unknown>).img1 = { kind: 'video' }; // 三成员均不匹配
    const result = validateSnapshot(derived, snap);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.message.includes('联合成员 2/3'))).toBe(true);
      expect(result.issues.map((i) => i.path)).toContainEqual(['assets', 'img1']);
    }
  });

  it('AC4-6 YPlainArray 子树值错：attachments 元素 42 非 string（纯值上下文叶子），path 含下标段', () => {
    const { derived } = chainDerived();
    const snap = validSnapshot();
    snap.attachments = ['note.txt', 42];
    expectValidateIssueAt(validateSnapshot(derived, snap), ['attachments', 1]);
  });

  it('AC4-7 XML 非良构字符串：text 资产 body 未闭合标签拒绝（ADR 0003 §5 仅要求良构），path 精确', () => {
    const { derived } = chainDerived();
    const snap = validSnapshot();
    (snap.assets as Record<string, unknown>).text1 = {
      kind: 'text', body: '<p>unclosed', audit: clone(AUDIT),
    };
    expectValidateIssueAt(validateSnapshot(derived, snap), ['assets', 'text1', 'body']);
  });

  it('AC4-8 kind 枚举外值：判别值不在 {image,text,file}，其余字段齐全仍拒绝（失败距离最小成员定位 1/3），path 精确', () => {
    const { derived } = chainDerived();
    const snap = validSnapshot();
    (snap.assets as Record<string, unknown>).img1 = {
      kind: 'video', url: 'u', width: 1, height: 1, audit: clone(AUDIT), // 仅 kind 一项不匹配 image 成员
    };
    const result = validateSnapshot(derived, snap);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.message.includes('联合成员 1/3'))).toBe(true);
      expect(result.issues.map((i) => i.path)).toContainEqual(['assets', 'img1']);
    }
  });
});

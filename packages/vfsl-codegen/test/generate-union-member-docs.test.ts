/**
 * SA6 验收契约（feature 红灯）— issue #307：`@nomicore/vfsl-codegen` 联合成员 doc 四发射位。
 *
 * 契约来源：ADR 0019 决策 6（docs/adr/0019-vfsl-union-member-docs.md，accepted 2026-09-11）+
 * issue #307 What-to-build / Acceptance criteria + 冲突门禁报告
 * （wiki/raw/task_issue-307_conflict_report.md，Verdict `clear`，登记 W1/W2 两处设计留白）。
 *
 * 四个发射位（决策 6）：
 * 1. 别名判别联合：成员 doc 以 `  | ` 行为基准上一行发射逐成员 TSDoc；
 * 2. 别名枚举 / 标量联合坍缩位（两树坍缩为 leaf/enum）：有成员 doc 时转多行逐成员布局，
 *    无成员 doc 保持既有单行布局（存量逐字节不变）；
 * 3. 内联联合（字段类型位等）：成员 doc 行内前置（doc 块紧跟成员起点，形如「块 + Member | …」）；
 * 4. 内联枚举：同行内前置。
 *
 * 无发射位（决策 6 末段）：YPlainArray 纯值子树与 YXmlFragment 不透明实参内的成员 doc
 * 丢弃（derived 表照常收集）——与 fieldDocs/markerDocs 既有限界同族。
 *
 * SA6 钉死的两处留白（ADR 未定的实现自由度，转成可执行断言）：
 * - W1 多行切换判据：**该位点 `<member N>` 键在 derived `memberDocs` 表中存在非空条目**
 *   （不按值侧 kind / 成员数量猜测）；判据按位点独立，同模块内有 doc 位点多行、无 doc 位点
 *   单行并存。
 * - W2 多 doc 成员：块位（发射位 1/2）每条 doc 一块、按源序逐行叠加；行内位（发射位 3/4）
 *   每条 doc 一块、按源序以单个空格串联。doc 文本经 tsdocLines 逐字保留（含多行体）。
 *
 * 红灯现状（能力缺口，实测 HEAD 4d4208b）：derived `memberDocs` 表已在场（#306
 * 已合并），但 emitter 的 EmitTables 只有 aliasDocs/fieldDocs/markerDocs 三槽——
 * 四个位点生成物对成员 doc **零发射**。故本文件「有 doc」用例全部红，「无 doc /
 * 无发射位」负控当前即绿（实现后必须保持）。
 *
 * 断言一律经公共入口 `generateProjection`（生成文本）与 `parseVfsl`/`evaluate`（派生表
 * 在场性）观察运行时行为，不读源码、不 skip/only、不软化。
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVfsl, evaluate } from '@nomicore/vfsl';
import type { DerivedSchema } from '@nomicore/vfsl';
import { generateProjection } from '@nomicore/vfsl-codegen';
import { preEmitDiagnostics, formatDiagnostics, repoRoot } from './tsc-helper.js';

// ---------------------------------------------------------------------------
// 公共辅助：parse → evaluate → generateProjection（失败信息携带 issues，证明红因非 fixture 错）
// ---------------------------------------------------------------------------

function derive(src: string): DerivedSchema {
  const parsed = parseVfsl(src);
  if (!parsed.ok) {
    throw new Error(`测试前提失败：parseVfsl 应 ok（fixture 合法 M4 文本），实际 issues: ${JSON.stringify(parsed.issues)}`);
  }
  const result = evaluate(parsed.module);
  if (!result.ok) {
    throw new Error(`测试前提失败：evaluate 应 ok，实际 issues: ${JSON.stringify(result.issues)}`);
  }
  return result.derived;
}

function emit(src: string, semicolonFree = false): string {
  return generateProjection(derive(src), { sourceText: src, semicolonFree });
}

/** 派生 memberDocs 键清单（在场性断言：证伪「fixture 根本没有成员 doc」的伪红/伪绿）。 */
function memberDocKeys(src: string): string[] {
  return Object.keys(derive(src).memberDocs ?? {}).sort();
}

// ---------------------------------------------------------------------------
// fixture：四个发射位 + 负控位
// ---------------------------------------------------------------------------

/** 发射位 1：别名判别联合（map 成员，成员 doc 多行前导 `|` 布局）。 */
const FIXTURE_ALIAS_UNION = `/** 根 */
type ROOT = YMap<{ e: Entity }>;

/** 实体联合 */
type Entity =
  /** 图片变体 */
  | { kind: "image"; url: YLeaf<string> }
  /** 文本变体 */
  | { kind: "text"; title: YLeaf<string> };
`;

/** 发射位 1：别名联合的 ref 成员（规则 0 完整 PathSchema 外壳）。 */
const FIXTURE_ALIAS_REF_UNION = `type A = YMap<{ x: YLeaf<string> }>;
type B = YMap<{ y: YLeaf<number> }>;
type ROOT = YMap<{ u: U }>;
type U = /** 甲变体 */ A /** 乙变体 */ | B;
`;

/** 发射位 2：别名枚举（标量字面量联合坍缩位，全成员有 doc）。 */
const FIXTURE_ALIAS_ENUM = `type ROOT = YMap<{ s: Status }>;

/** 状态 */
type Status =
  /** 草稿 */
  | "draft"
  /** 已提交 */
  | "submitted"
  /** 已归档 */
  | "archived";
`;

/** 发射位 2：别名标量联合坍缩位（可空叶：值侧 scalar union → T | null）。 */
const FIXTURE_ALIAS_SCALAR_UNION = `type ROOT = YMap<{ m: Maybe }>;
/** 可空 */
type Maybe = /** 有值 */ string /** 空值 */ | null;
`;

/** 发射位 2：部分成员有 doc（W1 判据：任一条目在场 → 全成员多行，无 doc 成员不垫行）。 */
const FIXTURE_ALIAS_ENUM_PARTIAL = `type ROOT = YMap<{ s: Status }>;
type Status =
  | "draft"
  /** 已提交 */
  | "submitted"
  | "archived";
`;

/** 发射位 3：内联联合（字段类型位，ref 成员）。 */
const FIXTURE_INLINE_UNION = `type A = YMap<{ x: YLeaf<string> }>;
type B = YMap<{ y: YLeaf<number> }>;
type ROOT = YMap<{ u: /** 甲变体 */ A /** 乙变体 */ | B }>;
`;

/** 发射位 4：内联枚举（字段类型位，字面量联合）。 */
const FIXTURE_INLINE_ENUM = `type ROOT = YMap<{ s: /** 草稿 */ "draft" /** 已提交 */ | "submitted" }>;
`;

/** 发射位 3：内联标量联合（可空叶，字段类型位）。 */
const FIXTURE_INLINE_SCALAR_UNION = `type ROOT = YMap<{ v: /** 有值 */ string /** 空值 */ | null }>;
`;

/** 发射位 3：内联判别联合（map×object 成员，走 emitUnionBodyMembers map 分支）。 */
const FIXTURE_INLINE_MAP_UNION = `type ROOT = YMap<{ e: /** 图片变体 */ { kind: "image"; url: YLeaf<string> } /** 文本变体 */ | { kind: "text"; title: YLeaf<string> } }>;
`;

/** 发射位 4：数组元素位的内联枚举（路径经 `. <item>` 合成段，键空间一致）。 */
const FIXTURE_ARRAY_ELEMENT = `type ROOT = YMap<{ tags: YArray</** 甲 */ "a" /** 乙 */ | "b"> }>;
`;

/** 发射位 4：内联枚举部分成员有 doc（行内前置只出现在有 doc 的成员位）。 */
const FIXTURE_INLINE_ENUM_PARTIAL = `type ROOT = YMap<{ s: "draft" /** 已提交 */ | "submitted" }>;
`;

/** 负控：无发射位位点（YPlainArray 纯值子树 / YXmlFragment 不透明实参）内的成员 doc。 */
const FIXTURE_PLAIN_SUBTREE = `type ROOT = YMap<{ p: YPlainArray</** 纯值成员 */ "a" /** 纯值乙 */ | "b"> }>;
`;
const FIXTURE_XML_FRAGMENT = `type ROOT = YMap<{ x: YXmlFragment<{ u: /** xml 内部成员 */ "a" /** xml 乙 */ | "b" }> }>;
`;

/** 负控：M3 优先（`|` 夹缝 doc 挂标记节点）→ memberDocs 整键缺席 → 布局不得切换。 */
const FIXTURE_MARKER_ONLY_UNION = `type ROOT = YMap<{ x: X }>;
type X = | /** 载体口径 */ YLeaf<string> | YLeaf<number>;
`;

/** 负控：同模块内有 doc 位点与无 doc 位点并存——切换按位点独立，不整模块联动。 */
const FIXTURE_MIXED_PRESENCE = `type ROOT = YMap<{ plain: Status; docd: DocStatus }>;
type Status = "a" | "b";
type DocStatus = /** 甲 */ "a" /** 乙 */ | "b";
`;

// ---------------------------------------------------------------------------
// 发射位 1 — 别名判别联合：成员 doc 以 `  | ` 行上一行发射
// ---------------------------------------------------------------------------

describe('issue #307 / ADR 0019 决策 6.1 — 别名判别联合：成员 doc 以 `  | ` 行上一行发射', () => {
  it('map 成员：逐成员 TSDoc 位于 `  | ` 行上方（doc 内缩与 `|` 列对齐）', () => {
    const out = emit(FIXTURE_ALIAS_UNION);
    // 红因前置：derived memberDocs 表在场（红因是发射缺口，非 fixture 无 doc）
    expect(memberDocKeys(FIXTURE_ALIAS_UNION)).toEqual(['Entity.<member 0>', 'Entity.<member 1>']);
    expect(out).toContain(
      '/**  实体联合  */\n' +
        'export type Entity =\n' +
        '  /**  图片变体  */\n' +
        "  | { 'kind': PathSchema<'image', 'leaf'>; 'url': PathSchema<string, 'leaf'> }\n" +
        '  /**  文本变体  */\n' +
        "  | { 'kind': PathSchema<'text', 'leaf'>; 'title': PathSchema<string, 'leaf'> };",
    );
  });

  it('ref 成员（规则 0 外壳）：doc 行位于 `  | PathSchema<…>` 行上方', () => {
    const out = emit(FIXTURE_ALIAS_REF_UNION);
    expect(out).toContain(
      'export type U =\n' +
        '  /**  甲变体  */\n' +
        "  | PathSchema<A, 'map'>\n" +
        '  /**  乙变体  */\n' +
        "  | PathSchema<B, 'map'>;",
    );
  });

  it('semicolonFree：同布局（doc 行位置不变、声明无终止分号）', () => {
    const out = emit(FIXTURE_ALIAS_UNION, true);
    expect(out).toContain(
      '/**  实体联合  */\n' +
        'export type Entity =\n' +
        '  /**  图片变体  */\n' +
        '  | {\n' +
        "    'kind': PathSchema<'image', 'leaf'>\n" +
        "    'url': PathSchema<string, 'leaf'>\n" +
        '  }\n' +
        '  /**  文本变体  */\n' +
        '  | {\n' +
        "    'kind': PathSchema<'text', 'leaf'>\n" +
        "    'title': PathSchema<string, 'leaf'>\n" +
        '  }',
    );
    expect(out).not.toContain(';');
  });
});

// ---------------------------------------------------------------------------
// 发射位 2 — 别名枚举 / 标量联合坍缩位：memberDocs 键 → 多行逐成员
// ---------------------------------------------------------------------------

describe('issue #307 / ADR 0019 决策 6.2 — 别名枚举坍缩位：有 memberDocs → 多行逐成员', () => {
  it('字面量枚举：三成员含 doc → `export type Status =` 换行 + `  | ` 逐成员行（ADR 示例形状）', () => {
    const out = emit(FIXTURE_ALIAS_ENUM);
    expect(memberDocKeys(FIXTURE_ALIAS_ENUM)).toEqual([
      'Status.<member 0>',
      'Status.<member 1>',
      'Status.<member 2>',
    ]);
    expect(out).toContain(
      '/**  状态  */\n' +
        'export type Status =\n' +
        '  /**  草稿  */\n' +
        "  | 'draft'\n" +
        '  /**  已提交  */\n' +
        "  | 'submitted'\n" +
        '  /**  已归档  */\n' +
        "  | 'archived';",
    );
  });

  it('标量联合坍缩位（可空叶 string | null）：同样多行逐成员，成员文本 = 单行形态逐段拆分', () => {
    const out = emit(FIXTURE_ALIAS_SCALAR_UNION);
    expect(memberDocKeys(FIXTURE_ALIAS_SCALAR_UNION)).toEqual(['Maybe.<member 0>', 'Maybe.<member 1>']);
    expect(out).toContain(
      'export type Maybe =\n' +
        '  /**  有值  */\n' +
        '  | string\n' +
        '  /**  空值  */\n' +
        '  | null;',
    );
  });

  it('W1 判据：部分成员有 doc → 全成员逐行多行；无 doc 成员行前不垫空行/不产出 doc 行', () => {
    const out = emit(FIXTURE_ALIAS_ENUM_PARTIAL);
    expect(memberDocKeys(FIXTURE_ALIAS_ENUM_PARTIAL)).toEqual(['Status.<member 1>']);
    expect(out).toContain(
      'export type Status =\n' +
        "  | 'draft'\n" +
        '  /**  已提交  */\n' +
        "  | 'submitted'\n" +
        "  | 'archived';",
    );
  });

  it('semicolonFree：同布局，声明无终止分号', () => {
    const out = emit(FIXTURE_ALIAS_ENUM, true);
    expect(out).toContain(
      '/**  状态  */\n' +
        'export type Status =\n' +
        '  /**  草稿  */\n' +
        "  | 'draft'\n" +
        '  /**  已提交  */\n' +
        "  | 'submitted'\n" +
        '  /**  已归档  */\n' +
        "  | 'archived'\n",
    );
  });
});

// ---------------------------------------------------------------------------
// 发射位 3/4 — 内联联合 / 内联枚举：成员 doc 行内前置
// ---------------------------------------------------------------------------

describe('issue #307 / ADR 0019 决策 6.3/6.4 — 内联联合 / 内联枚举：成员 doc 行内前置', () => {
  it('内联联合（ref 成员，字段类型位）：doc 块紧跟成员起点行内前置', () => {
    const out = emit(FIXTURE_INLINE_UNION);
    expect(memberDocKeys(FIXTURE_INLINE_UNION)).toEqual(['ROOT.u.<member 0>', 'ROOT.u.<member 1>']);
    expect(out).toContain(
      "    u: PathSchema</**  甲变体  */ PathSchema<A, 'map'> | /**  乙变体  */ PathSchema<B, 'map'>, 'map'>;",
    );
  });

  it('内联枚举（字面量联合，字段类型位）：同行内前置', () => {
    const out = emit(FIXTURE_INLINE_ENUM);
    expect(memberDocKeys(FIXTURE_INLINE_ENUM)).toEqual(['ROOT.s.<member 0>', 'ROOT.s.<member 1>']);
    expect(out).toContain("    s: PathSchema</**  草稿  */ 'draft' | /**  已提交  */ 'submitted', 'leaf'>;");
  });

  it('内联标量联合坍缩位（可空叶，字段类型位）：同行内前置', () => {
    const out = emit(FIXTURE_INLINE_SCALAR_UNION);
    expect(out).toContain("    v: PathSchema</**  有值  */ string | /**  空值  */ null, 'leaf'>;");
  });

  it('内联判别联合（map×object 成员）：前缀拼接不改变 `|` join 文法', () => {
    const out = emit(FIXTURE_INLINE_MAP_UNION);
    expect(out).toContain(
      '    e: PathSchema</**  图片变体  */ ' +
        "{ 'kind': PathSchema<'image', 'leaf'>; 'url': PathSchema<string, 'leaf'> } | " +
        '/**  文本变体  */ ' +
        "{ 'kind': PathSchema<'text', 'leaf'>; 'title': PathSchema<string, 'leaf'> }, 'map'>;",
    );
  });

  it('数组元素位（`. <item>` 路径段）：行内前置使用元素子树的 `<member N>` 键', () => {
    const out = emit(FIXTURE_ARRAY_ELEMENT);
    expect(memberDocKeys(FIXTURE_ARRAY_ELEMENT)).toEqual([
      'ROOT.tags.<item>.<member 0>',
      'ROOT.tags.<item>.<member 1>',
    ]);
    expect(out).toContain(
      "    tags: PathSchema<Record<`${number}`, PathSchema</**  甲  */ 'a' | /**  乙  */ 'b', 'leaf'>>, 'array'>;",
    );
  });

  it('部分成员有 doc：行内前置只出现在有 doc 的成员位（无 doc 成员裸前置）', () => {
    const out = emit(FIXTURE_INLINE_ENUM_PARTIAL);
    expect(memberDocKeys(FIXTURE_INLINE_ENUM_PARTIAL)).toEqual(['ROOT.s.<member 1>']);
    expect(out).toContain("    s: PathSchema<'draft' | /**  已提交  */ 'submitted', 'leaf'>;");
  });

  it('semicolonFree：内联 map 成员多行化时 doc 前缀仍紧跟成员起点（`{` 前），无行尾空格', () => {
    const out = emit(FIXTURE_INLINE_MAP_UNION, true);
    expect(out).toContain(
      '    e: PathSchema</**  图片变体  */ {\n' +
        "      'kind': PathSchema<'image', 'leaf'>\n" +
        "      'url': PathSchema<string, 'leaf'>\n" +
        '    } | /**  文本变体  */ {\n' +
        "      'kind': PathSchema<'text', 'leaf'>\n" +
        "      'title': PathSchema<string, 'leaf'>\n" +
        "    }, 'map'",
    );
    expect(out).not.toMatch(/ +$/m);
  });
});

// ---------------------------------------------------------------------------
// W2 — 多 doc 成员：块位逐行叠加、行内位空格串联、确定性
// ---------------------------------------------------------------------------

describe('issue #307 / W2 — 多 doc 成员确定性渲染', () => {
  const FIXTURE_MULTI_DOC_BLOCK = `type ROOT = YMap<{ s: Status }>;
type Status =
  /** 第一条 */
  /** 第二条 */
  | "a"
  /** 乙 */
  | "b";
`;

  const FIXTURE_MULTI_DOC_INLINE = `type ROOT = YMap<{ s: /** 第一条 */ /** 第二条 */ "a" /** 乙 */ | "b" }>;
`;

  const FIXTURE_MULTILINE_DOC_BODY = `type ROOT = YMap<{ s: Status }>;
type Status =
  /**
   * 第一行
   * 第二行
   */
  | "a"
  | "b";
`;

  it('块位（别名枚举）：2+ doc 逐块叠加、按源序在成员行上方；同输入两次发射逐字节一致', () => {
    expect(memberDocKeys(FIXTURE_MULTI_DOC_BLOCK)).toEqual(['Status.<member 0>', 'Status.<member 1>']);
    const out = emit(FIXTURE_MULTI_DOC_BLOCK);
    expect(out).toContain(
      'export type Status =\n' +
        '  /**  第一条  */\n' +
        '  /**  第二条  */\n' +
        "  | 'a'\n" +
        '  /**  乙  */\n' +
        "  | 'b';",
    );
    expect(emit(FIXTURE_MULTI_DOC_BLOCK)).toBe(out);
  });

  it('行内位（内联枚举）：2+ doc 逐块、按源序以单空格串联在成员前', () => {
    expect(memberDocKeys(FIXTURE_MULTI_DOC_INLINE)).toEqual(['ROOT.s.<member 0>', 'ROOT.s.<member 1>']);
    const out = emit(FIXTURE_MULTI_DOC_INLINE);
    expect(out).toContain("    s: PathSchema</**  第一条  */ /**  第二条  */ 'a' | /**  乙  */ 'b', 'leaf'>;");
    expect(emit(FIXTURE_MULTI_DOC_INLINE)).toBe(out);
  });

  it('块位多行 doc 体（决策 1 逐字保留）：tsdocLines 既有语义（默认模式 `/** ` 行尾空格保留）', () => {
    // doc body = '\n   * 第一行\n   * 第二行\n   '（源缩进逐字保留）→ 默认模式 `  /** ` + body + ` */`
    expect(memberDocKeys(FIXTURE_MULTILINE_DOC_BODY)).toEqual(['Status.<member 0>']);
    const out = emit(FIXTURE_MULTILINE_DOC_BODY);
    expect(out).toContain(
      'export type Status =\n' +
        '  /** \n' +
        '   * 第一行\n' +
        '   * 第二行\n' +
        '    */\n' +
        "  | 'a'\n" +
        "  | 'b';",
    );
  });

  it('semicolonFree 块位多行 doc 体：`/**` 后不垫空格（无行尾空格），其余逐字保留', () => {
    const out = emit(FIXTURE_MULTILINE_DOC_BODY, true);
    expect(out).toContain(
      'export type Status =\n' +
        '  /**\n' +
        '   * 第一行\n' +
        '   * 第二行\n' +
        '    */\n' +
        "  | 'a'\n" +
        "  | 'b'\n",
    );
    expect(out).not.toMatch(/ +$/m);
  });
});

// ---------------------------------------------------------------------------
// 负控 — 无发射位位点（YPlainArray / YXmlFragment）；无 doc 位点逐字节不变
// ---------------------------------------------------------------------------

describe('负控 — YPlainArray 纯值子树与 YXmlFragment 实参：derived 收集但零发射（决策 6 末段）', () => {
  it('YPlainArray：成员 doc 在 derived 表在场，生成物保持纯值单行且零 doc 字节', () => {
    expect(memberDocKeys(FIXTURE_PLAIN_SUBTREE)).toEqual([
      'ROOT.p.<item>.<member 0>',
      'ROOT.p.<item>.<member 1>',
    ]);
    const out = emit(FIXTURE_PLAIN_SUBTREE);
    expect(out).toContain("    p: PathSchema<'a' | 'b'[], 'plain'>;");
    expect(out).not.toContain('纯值成员');
    expect(out).not.toContain('纯值乙');
  });

  it('YXmlFragment：成员 doc 在 derived 表在场，不透明终态输出零 doc 字节', () => {
    expect(memberDocKeys(FIXTURE_XML_FRAGMENT)).toEqual([
      'ROOT.x.u.<member 0>',
      'ROOT.x.u.<member 1>',
    ]);
    const out = emit(FIXTURE_XML_FRAGMENT);
    expect(out).toContain("    x: PathSchema<string, 'xml-fragment'>;");
    expect(out).not.toContain('xml 内部成员');
    expect(out).not.toContain('xml 乙');
  });

  it('M3 优先位（markerDocs 在场、memberDocs 缺席）：坍缩别名维持单行，标记 doc 不泄漏', () => {
    expect(derive(FIXTURE_MARKER_ONLY_UNION).memberDocs).toBeUndefined();
    const out = emit(FIXTURE_MARKER_ONLY_UNION);
    expect(out).toContain('export type X = string | number;');
    expect(out).not.toContain('载体口径');
  });
});

describe('负控 — 无成员 doc：生成物逐字节不变（ADR 0019 决策 9.2 / AC「无 doc 逐字节不变」）', () => {
  const FIXTURE_NO_DOC_ALIAS_UNION = `type ROOT = YMap<{ e: Entity }>;
type Entity =
  | { kind: "image"; url: YLeaf<string> }
  | { kind: "text"; title: YLeaf<string> };
`;

  const FIXTURE_NO_DOC_COLLAPSED = `type ROOT = YMap<{ s: Status; m: Maybe; x: X }>;
type Status = "draft" | "submitted" | "archived";
type Maybe = string | null;
type X = YLeaf<string> | YLeaf<number>;
`;

  const FIXTURE_NO_DOC_INLINE = `type A = YMap<{ x: YLeaf<string> }>;
type B = YMap<{ y: YLeaf<number> }>;
type ROOT = YMap<{ u: A | B; s: "draft" | "submitted"; v: string | null }>;
`;

  it('派生表无 memberDocs 键（条件稀疏）', () => {
    expect(derive(FIXTURE_NO_DOC_ALIAS_UNION).memberDocs).toBeUndefined();
    expect(derive(FIXTURE_NO_DOC_COLLAPSED).memberDocs).toBeUndefined();
    expect(derive(FIXTURE_NO_DOC_INLINE).memberDocs).toBeUndefined();
  });

  it('无 doc 别名联合：既有 `| ` 多行布局逐字节不变（HEAD 4d4208b 金样本）', () => {
    expect(emit(FIXTURE_NO_DOC_ALIAS_UNION)).toContain(
      'export type Entity =\n' +
        "  | { 'kind': PathSchema<'image', 'leaf'>; 'url': PathSchema<string, 'leaf'> }\n" +
        "  | { 'kind': PathSchema<'text', 'leaf'>; 'title': PathSchema<string, 'leaf'> };",
    );
  });

  it('无 doc 坍缩位：枚举/标量联合/标记联合维持既有单行布局（HEAD 4d4208b 金样本）', () => {
    expect(emit(FIXTURE_NO_DOC_COLLAPSED)).toContain(
      "export type Status = 'draft' | 'submitted' | 'archived';\n" +
        'export type Maybe = string | null;\n' +
        'export type X = string | number;',
    );
  });

  it('无 doc 内联位：联合/枚举/标量联合维持既有单行内联布局（HEAD 4d4208b 金样本）', () => {
    expect(emit(FIXTURE_NO_DOC_INLINE)).toContain(
      "    u: PathSchema<PathSchema<A, 'map'> | PathSchema<B, 'map'>, 'map'>;\n" +
        "    s: PathSchema<'draft' | 'submitted', 'leaf'>;\n" +
        "    v: PathSchema<string | null, 'leaf'>;",
    );
  });

  it('负控：同模块内无 doc 别名与无 doc 字段位维持既有单行（切换不整模块联动）', () => {
    const out = emit(FIXTURE_MIXED_PRESENCE);
    expect(out).toContain("export type Status = 'a' | 'b';");
    expect(out).toContain("    plain: PathSchema<Status, 'leaf'>;");
  });

  it('W1 判据按位点独立：同模块内有 doc 别名独立多行（无 doc 别名不受影响）', () => {
    const out = emit(FIXTURE_MIXED_PRESENCE);
    expect(out).toContain(
      'export type DocStatus =\n' +
        '  /**  甲  */\n' +
        "  | 'a'\n" +
        '  /**  乙  */\n' +
        "  | 'b';",
    );
    expect(out).toContain("    docd: PathSchema<DocStatus, 'leaf'>;");
  });
});

// ---------------------------------------------------------------------------
// 负控 — 存量 domain 逐字节不变 + generate --check 新鲜（ADR 0005 决策 4）
// ---------------------------------------------------------------------------

const DOMAIN_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

describe('负控 — 存量 domains：生成物逐字节不变、`pnpm generate --check` 不报过期', () => {
  it('domains/vfs3-assets：无成员 doc 派生物 → 生成物与仓内 generated.ts 逐字节相同', async () => {
    const schemaPath = join(DOMAIN_ROOT, 'domains', 'vfs3-assets', 'schema.vfsl');
    const generatedPath = join(DOMAIN_ROOT, 'domains', 'vfs3-assets', 'generated.ts');
    const schemaText = await readFile(schemaPath, 'utf8');
    const derived = derive(schemaText);
    expect(derived.memberDocs, '存量 domain 无 M4 文本 → 条件稀疏表整键缺席').toBeUndefined();
    expect(generateProjection(derived, { sourceText: schemaText })).toBe(await readFile(generatedPath, 'utf8'));
  });

  it('仓根 `pnpm generate --check` 新鲜退出 0（regenerate 与盘上 diff 为空）', () => {
    const r = spawnSync('pnpm', ['generate', '--check'], { cwd: repoRoot, encoding: 'utf8', shell: false });
    expect(r.status, `stderr: ${r.stderr ?? ''}`).toBe(0);
  }, 20_000);
});

// ---------------------------------------------------------------------------
// 端到端 — CLI：成员 doc 经 generate 写盘、--check 新鲜（默认 + semicolonFree）
// ---------------------------------------------------------------------------

const CLI_FIXTURE = `// @lang: vfsl
// @id: demo@1
// @version: 1
/** 状态 */
type Status =
  /** 草稿 */
  | "draft"
  /** 已提交 */
  | "submitted";

/** 实体联合 */
type Entity =
  /** 图片变体 */
  | { kind: "image"; url: YLeaf<string> }
  /** 文本变体 */
  | { kind: "text"; title: YLeaf<string> };

type ROOT = YMap<{ status: Status; entities: YArray<Entity> }>;
`;

async function makeCliFixture(): Promise<{ dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'vfsl-codegen-member-docs-'));
  const domainsDir = join(dir, 'domains', 'demo');
  await mkdir(domainsDir, { recursive: true });
  await writeFile(join(domainsDir, 'schema.vfsl'), CLI_FIXTURE, 'utf8');
  return { dir };
}

function runPnpm(args: string[], cwd: string): { status: number | null; stderr: string } {
  const r = spawnSync('pnpm', args, { cwd, encoding: 'utf8', shell: false });
  return { status: r.status, stderr: r.stderr ?? '' };
}

describe('端到端 — CLI：成员 doc 写盘 + --check 新鲜闭环（默认格式与 semicolonFree）', () => {
  it('默认格式：generated.ts 含四发射位文案，`--check` 退出 0', async () => {
    const fx = await makeCliFixture();
    const gen = runPnpm(['generate', '--domains', fx.dir], repoRoot);
    expect(gen.status, gen.stderr).toBe(0);
    const text = await readFile(join(fx.dir, 'domains', 'demo', 'generated.ts'), 'utf8');
    expect(text).toContain("  /**  草稿  */\n  | 'draft'");
    expect(text).toContain("  /**  图片变体  */\n  | { 'kind': PathSchema<'image', 'leaf'>");
    expect(text).toContain("    status: PathSchema<Status, 'leaf'>;");
    const check = runPnpm(['generate', '--check', '--domains', fx.dir], repoRoot);
    expect(check.status, check.stderr).toBe(0);
  }, 20_000);

  it('semicolonFree：同布局零分号、`--check --semicolon-free` 退出 0', async () => {
    const fx = await makeCliFixture();
    const gen = runPnpm(['generate', '--domains', fx.dir, '--semicolon-free'], repoRoot);
    expect(gen.status, gen.stderr).toBe(0);
    const text = await readFile(join(fx.dir, 'domains', 'demo', 'generated.ts'), 'utf8');
    expect(text).not.toContain(';');
    expect(text).toContain("  /**  草稿  */\n  | 'draft'");
    expect(text).toContain("  /**  图片变体  */\n  | {\n");
    const check = runPnpm(['generate', '--check', '--domains', fx.dir, '--semicolon-free'], repoRoot);
    expect(check.status, check.stderr).toBe(0);
  }, 20_000);
});

// ---------------------------------------------------------------------------
// 类型面 — 成员 doc 是注释：生成物孤立 program 零诊断（默认 + semicolonFree）
// ---------------------------------------------------------------------------

describe('类型面 — 带成员 doc 的生成物孤立 tsc 零诊断（注释不改变类型形状）', () => {
  /** 混合 fixture：发射位 1（别名联合）+ 发射位 4（内联枚举）同文件，仅一个 ROOT。 */
  const FIXTURE_COMPILE = `/** 根 */
type ROOT = YMap<{ e: Entity; s: /** 草稿 */ "draft" /** 已提交 */ | "submitted" }>;

/** 实体联合 */
type Entity =
  /** 图片变体 */
  | { kind: "image"; url: YLeaf<string> }
  /** 文本变体 */
  | { kind: "text"; title: YLeaf<string> };
`;

  it.each([
    ['默认格式', false],
    ['semicolonFree', true],
  ] as const)('%s：生成物写盘后 pre-emit 诊断为零', async (_name, semicolonFree) => {
    const text = emit(FIXTURE_COMPILE, semicolonFree);
    expect(text, '红因前置：成员 doc 必须已在生成物中').toContain('/**  图片变体  */');
    expect(text, '红因前置：内联成员 doc 必须已在生成物中').toContain("/**  草稿  */ 'draft'");
    const dir = await mkdtemp(join(tmpdir(), 'vfsl-codegen-member-docs-tsc-'));
    const file = join(dir, 'generated.ts');
    await writeFile(file, text, 'utf8');
    const diags = preEmitDiagnostics([file]);
    expect(formatDiagnostics(diags)).toBe('');
    expect(diags).toHaveLength(0);
  });
});

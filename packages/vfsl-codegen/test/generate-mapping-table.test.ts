/**
 * SA6 红灯测试 — `@nomicore/vfsl-codegen` 生成器：映射表逐行发射（AC1）+ docs → TSDoc（AC2）。
 *
 * 契约来源（ADR 0004 §后果 + ADR 0005 §3/§4 + issue #26 AC + SA5 锚点建议 1/2/6/7）：
 * - 生成器是 `evaluate` 派生 schema 的**纯发射器**：输入 `DerivedSchema`（不吃 IR、不吃
 *   .vfsl 原文），输出 TS 类型文本（ADR 0005 §3；SA5 锚点 1）；
 * - 映射表（ADR 0004 + 设计 §8.3，SA5 锚点 6 发射载体样板）：
 *   - `YMap` → `PathSchema<Record<字段, …>, 'map'>`；
 *   - `YArray` → `PathSchema<Record<\`${number}\`, 元素子表>, 'array'>`（D1 下标段可解析）；
 *   - `YPlainArray` → `PathSchema<V[], 'plain'>` **纯值终态**（无 Record<number, 子表> 子树，
 *     继续下钻 → UnknownPath；D1）；`V` = 元素纯值类型（数组/标量透传）；
 *   - `YLeaf` → `PathSchema<T, 'leaf'>`（可空 `T | null`）；
 *   - `YXmlFragment` → `PathSchema<string, 'xml-fragment'>`（不透明终态，值 = XML 字符串）；
 *   - `Pattern` → string（键别名按字符串类型发射）；
 *   - 裸 `T[]` → `PathSchema<Record<\`${number}\`, 元素子表>, 'array'>`（D1）；
 *   - `Record<Key, …>` → `Record<string, 值位子树>`（键含 Pattern 约束 → string）。
 *   - ref → 别名引用、不内联展开（ADR 0003 §4）。
 * - docs 三槽 → TSDoc（AC2；SA5 锚点 2）：`aliasDocs` / `fieldDocs` / `markerDocs` 均须
 *   出现在生成 TSDoc。
 * - 顶层键 = ROOT 的字段、路径无 `ROOT` 前缀（D5）。
 *
 * 契约硬化（本文件 = SA3 实现的唯一行为锚点之一）：
 * - 生成器函数从 `@nomicore/vfsl-codegen` 公共导出 `generateProjection(derived, opts?)`，
 *   返回生成的 TS 文本（string）；`opts.sourceText` 接受源文本以计算头注哈希（AC4 头注）。
 * - 断言对象 = `generateProjection` 的**发射输出**（string），属纯发射器的可观测行为；
 *   不读 generator 源码、不 grep 源文本形状。
 *
 * 红灯现状：`@nomicore/vfsl-codegen` 包不存在 → `import ... from '@nomicore/vfsl-codegen'`
 * 抛 module-not-found → 本文件全红（构造性红灯，非伪红）。SA3 实现后每条断言独立校验
 * 对应映射行。**入参形状 SA3 不得改动**（SA5 实证 derive 输入契约已冻结）。
 */
import { describe, expect, it } from 'vitest';
/** @nomicore/vfsl 既有包（前置依赖，svc 绿）：相对导入避免依赖 workspace 软链（新包未接线）。 */
import { parseVfsl, evaluate } from '../../vfsl/src/index.js';
/** 被测导出尚不存在 → module-not-found → 整文件红灯（真红根因，非语法/转译错误）。 */
import { generateProjection } from '@nomicore/vfsl-codegen';

/** 覆盖全映射表的 .vfsl fixture：每行一种映射态（docs 三槽在 aliasDocs 位）。
 *  R4 增补（建议 A）：`leafRef: Id`（结构=leaf、值=ref）与 `metaRef: YMap<Meta>`
 *  （结构=已解析 map、值=ref——规则 0 判别性用例）钉死值侧 ref 优先。 */
const FIXTURE = `/** 根文档说明 */
type ROOT = YMap<{
  label: YLeaf<string>;
  tags: YLeaf<string>[];
  meta: YMap<{ count: YLeaf<number> }>;
  items: YArray<YLeaf<string>>;
  attachments: YPlainArray<YLeaf<string>>;
  rich: YXmlFragment<{ p: YLeaf<string> }>;
  entityList: YArray<Entity>;
  byId: Record<Id, Entity>;
  leafRef: Id;
  metaRef: YMap<Meta>;
}>;

/** 实体的判别联合 */
type Entity =
  | { kind: "image"; url: YLeaf<string> }
  | { kind: "text"; richBody: YLeaf<string>; title: YLeaf<string> };

/** Id：Pattern 键约束 */
type Id = string & Pattern<"^[A-Za-z0-9_]{1,16}$">;

type Meta = YMap<{ m: YLeaf<number> }>;
`;

/** parse → evaluate → derived（前置齐备，SA5 实证）。 */
function evaluateFixture(): import('../../vfsl/src/index.js').DerivedSchema {
  const parsed = parseVfsl(FIXTURE);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(`parseVfsl ok 应为 true：${JSON.stringify(parsed.issues)}`);
  const result = evaluate(parsed.module);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`evaluate ok 应为 true：${JSON.stringify(result.issues)}`);
  return result.derived;
}

/** 发射守卫：调用 generateProjection 并断言其为 string（生成器存在且可运行的观察点）。 */
function emit(): string {
  const derived = evaluateFixture();
  const out = generateProjection(derived, { sourceText: FIXTURE });
  expect(typeof out).toBe('string');
  return out;
}

/** 去空白比较辅助：断言「某字段发射为给定 kind 载体」，容忍格式差异（空白/引号）。 */
function fieldKind(out: string, field: string, kind: string): boolean {
  const re = new RegExp(`${field}\\s*:\\s*PathSchema<[^>]*(['"])${kind}\\1\\s*>`);
  return re.test(out);
}

describe('AC1 — 映射表逐行发射断言', () => {
  it('整体载体：declare module 增广 + VfslPathMap 接口 + 顶层键无 ROOT 前缀（D5）', () => {
    const out = emit();
    expect(out).toContain(`declare module '@nomicore/vfsl-protocol'`);
    expect(out).toContain('interface VfslPathMap');
    // 顶层键 = ROOT 的字段；'ROOT' 不作为顶层路径键出现
    expect(out).not.toMatch(/^\s*['"]?ROOT['"]?\s*:/m);
  });

  it('YLeaf → PathSchema<string, \'leaf\'>', () => {
    expect(fieldKind(emit(), 'label', 'leaf')).toBe(true);
  });

  it('裸 T[]（Y.Array 默认物化）→ PathSchema<Record<\`${number}\`, element>, \'array\'>（D1）', () => {
    const out = emit();
    expect(out).toContain('Record<`${number}`');
    // tags 为数组字段 → array 载体，Value = Record<`${number}`, 元素子表>
    expect(out).toMatch(/tags\s*:\s*PathSchema<Record<`\$\{number}`,\s*PathSchema<string,\s*'leaf'>\s*>,\s*'array'\s*>/);
  });

  it('YArray 标记 → 同步 array 载体（与裸 T[] 同形，D1）', () => {
    const out = emit();
    expect(out).toMatch(/items\s*:\s*PathSchema<Record<`\$\{number}`,\s*PathSchema<string,\s*'leaf'>\s*>,\s*'array'\s*>/);
  });

  it('YPlainArray → PathSchema<V[], \'plain\'> 纯值终态（无 Record<number,子树> 子树，D1）', () => {
    const out = emit();
    // attachments: YPlainArray<YLeaf<string>> → Value = string[]，kind = 'plain'
    expect(out).toMatch(/attachments\s*:\s*PathSchema<[^>]*string\[\][^>]*,\s*['"]plain['"]\s*>/);
    // 终态禁令：plain 载体不得携带可下钻的 Record<`${number}`, ...> 子树（负例：任何 Record< 开头均违约）
    expect(/attachments\s*:\s*PathSchema<Record</.test(out)).toBe(false);
  });

  it('YXmlFragment → PathSchema<string, \'xml-fragment\'> 不透明终态', () => {
    expect(fieldKind(emit(), 'rich', 'xml-fragment')).toBe(true);
  });

  it('Record<Pattern 键,…> → Record<string, 值位子树>，值位是判别联合 map', () => {
    const out = emit();
    expect(out).toContain('Record<string');
    expect(out).toMatch(/byId\s*:\s*PathSchema<Record<string,\s*PathSchema</);
    // Entity 判别联合存在于 byId 值位 → map 载体
    expect(out).toMatch(/byId\s*:\s*PathSchema<Record<string,\s*PathSchema<[^>]*['"]map['"]/);
  });

  it('ref → 别名引用、不内联展开（ADR 0003 §4）——Entity 独立发射位', () => {
    const out = emit();
    // entityList: YArray<Entity>，Entity 判别联合以独立 map 载体出现在生成物
    expect(out).toMatch(/entityList\s*:\s*PathSchema<Record<`\$\{number}`,\s*PathSchema<Entity,\s*'map'>/);
    // Entity 判别联合的字面量成员 kind 在场
    expect(out).toMatch(/['"]image['"]/);
    expect(out).toMatch(/['"]text['"]/);
  });

  it('R4/A：ref 到 leaf/map 形别名仍为别名引用（规则 0 值侧优先；metaRef 为判别性用例）', () => {
    const out = emit();
    // leafRef: Id（结构=leaf、值=ref Id）→ 别名引用 PathSchema<Id, 'leaf'>（不内联成 string）
    expect(out).toMatch(/leafRef\s*:\s*PathSchema<Id,\s*'leaf'>/);
    // metaRef: YMap<Meta>（结构=已解析 map {m:leaf}、值=ref Meta）→ 仍别名引用 PathSchema<Meta, 'map'>
    // ——字面按结构侧发射会内联 map，只有值侧 ref 优先规则产出别名引用（§3.2 规则 0）
    expect(out).toMatch(/metaRef\s*:\s*PathSchema<Meta,\s*'map'>/);
    // 段②：Meta 独立别名声明（对象字面量形，字段名带引号——§3.9 v3 格式）
    expect(out).toMatch(/export type Meta\s*=\s*\{\s*'m':\s*PathSchema<number,\s*'leaf'>\s*\};/);
  });

  it('AC1 联合成员独有字段（发射侧）：成员互异字段按声明类型在场（T|undefined 宽度由 test-d 断言 read）', () => {
    const out = emit();
    expect(out).toMatch(/\burl\b/);
    expect(out).toMatch(/\brichBody\b/);
    expect(out).toMatch(/\btitle\b/);
  });
});

describe('AC2 — docs 三槽 → 生成 TSDoc', () => {
  it('aliasDocs：ROOT 与具名别名级 docs 逐字出现在生成 TSDoc', () => {
    const out = emit();
    expect(out).toContain('根文档说明');
    expect(out).toContain('实体的判别联合');
    expect(out).toContain('Id：Pattern 键约束');
  });

  it('TSDoc 语法完整：生成的注释块不残破（开闭配平）', () => {
    const out = emit();
    const opens = (out.match(/\/\*\*/g) ?? []).length;
    const closes = (out.match(/\*\//g) ?? []).length;
    expect(opens).toBeLessThanOrEqual(closes);
  });
});

/**
 * SA6 红灯测试 — 容器与标记类型（issue #6）：T[] / Record<K,V> / 六标记 / 交叉类型。
 *
 * 契约来源（docs/vfsl/v1-spec.md，frozen）：
 * - §2 语法子集：ArrayType（`T[]`）、RecordType、Marker（六标记）、PatternType
 *   （`string & Pattern<"正则">` 唯一交叉）；
 * - §3 标记类型语义：标记实参形状约束表（YMap/YXmlFragment 对象形、YLeaf 标量形、
 *   违反 → E304；形状沿别名链解析后判定）、Record 键 string 形（E306）、纯值上下文
 *   （YPlainArray 子树禁同步标记，经别名间接引入亦禁，违反 → E307）、三分类混合
 *   联合（同步物化上下文 → E309）；
 * - §4 错误码总表与定位锚、判定顺序第 6 条（未声明名 / 标记大小写变体 → E301）、
 *   第 7 条（裸保留名误用 → E100）；
 * - §6 大小写契约：精确拼写（YMap/YArray/YPlainArray/YLeaf/YXmlFragment/Pattern）
 *   是契约；变体拼写（YLEaf/ymap 等）不是已知名，按未知名 E301；变体可声明为
 *   普通别名（不进入保留名）；
 * - §9.1 Pattern 实参正则合法性不在方言层校验（解码后是否合法正则不判）。
 *
 * 断言策略：IR 具体形状属实现自由度（规格 §1 出范围），正例不锁定节点形状——
 * 断言 ok:true + IR 可 JSON 序列化（PRD #3）+ 与「无标记等价文本」的 IR 可区分
 * （标记及其包裹目标必须进入 IR，否则任务目标「标记及其包裹目标进入 IR」不成立）。
 * 反例断言冻结错误码 + 定位锚（规格 §4 错误身份冻结）。全部断言经公共接缝
 * parseVfsl 运行时行为，无源码 grep。
 */
import { describe, expect, it } from 'vitest';
import { parseVfsl } from '../src/index.js';

/** PRD #3 冻结的公共接缝返回形状。 */
type ParseResult =
  | { ok: true; module: unknown }
  | { ok: false; issues: { message: string; line: number; column: number }[] };

type Issue = { message: string; line: number; column: number };

/** 断言 ok: true 并返回 module（module 形状不锁定，断言时按需探测）。 */
function expectOk(result: ParseResult): unknown {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`期望 ok: true，实际 ok: false（issues: ${JSON.stringify(result.issues)}）`);
  }
  return result.module;
}

/** PRD 验收：IR 可 JSON 序列化（内容哈希缓存的前提）——序列化往返须无损。 */
function expectJsonRoundTrip(value: unknown): void {
  expect(JSON.parse(JSON.stringify(value))).toEqual(value);
}

/** 断言 ok: false、issues 恰含 1 条，且字段形状 / 行列基准 / message 前缀全部合规。 */
function expectSingleIssue(result: ParseResult): Issue {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error(`期望 ok: false，实际 ok: true（module: ${JSON.stringify(result.module)}）`);
  }
  expect(result.issues).toHaveLength(1);
  const issue = result.issues[0];
  expect(issue).toBeDefined();
  if (!issue) {
    throw new Error('issues 数组为空');
  }
  // message 冻结前缀格式（§4 错误码传递通道）：VFSL-E<编号>: <消息>
  expect(issue.message).toMatch(/^VFSL-E\d{3}: /);
  // line/column 均 1 起
  expect(Number.isInteger(issue.line)).toBe(true);
  expect(issue.line).toBeGreaterThanOrEqual(1);
  expect(Number.isInteger(issue.column)).toBe(true);
  expect(issue.column).toBeGreaterThanOrEqual(1);
  return issue;
}

/** 断言错误码前缀 + 精确锚点行列（规格 §4 定位锚冻结）。 */
function expectIssueAt(issue: Issue, code: string, line: number, column: number): void {
  expect(issue.message).toMatch(new RegExp(`^VFSL-E${code}: `));
  expect(issue.line).toBe(line);
  expect(issue.column).toBe(column);
}

/** 断言错误码前缀（不锁消息全文与锚点——E100 族锚点非本任务增量）。 */
function expectCode(issue: Issue, code: string): void {
  expect(issue.message).toMatch(new RegExp(`^VFSL-E${code}: `));
}

/**
 * 标记 / 容器进入 IR 的可区分性锚：两段文本（仅包裹结构不同）的 IR 必须不同。
 * 若实现把标记折叠成无标记等价形状，IR 相同 → 断言失败（任务目标「标记及其
 * 包裹目标进入 IR」不成立）。
 */
function expectDistinct(textA: string, textB: string): void {
  const serializedA = JSON.stringify(expectOk(parseVfsl(textA)));
  const serializedB = JSON.stringify(expectOk(parseVfsl(textB)));
  expect(serializedA).not.toBe(serializedB);
}

/** 深度搜索：JSON 往返后的 module 中是否存在目标字符串值（如解码后的正则）。 */
function jsonContainsString(value: unknown, target: string): boolean {
  if (typeof value === 'string') return value === target;
  if (Array.isArray(value)) return value.some((v) => jsonContainsString(v, target));
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some((v) => jsonContainsString(v, target));
  }
  return false;
}

describe('issue #6 — 正例：六标记 / 容器 / 交叉解析进 IR（AC1·AC2·AC3 幸福路径）', () => {
  it('YMap 正例解析进 IR，且与裸对象类型可区分（标记不被折叠）', () => {
    const module = expectOk(parseVfsl('type A = YMap<{ x: string }>;\ntype ROOT = {};'));
    expectJsonRoundTrip(module);
    expect(JSON.stringify(module)).toContain('A');
    expectDistinct('type A = YMap<{ x: string }>;\ntype ROOT = {};', 'type A = { x: string };\ntype ROOT = {};');
  });

  it('YArray 正例解析进 IR，且与裸标量可区分', () => {
    const module = expectOk(parseVfsl('type A = YArray<string>;\ntype ROOT = {};'));
    expectJsonRoundTrip(module);
    expect(JSON.stringify(module)).toContain('A');
    expectDistinct('type A = YArray<string>;\ntype ROOT = {};', 'type A = string;\ntype ROOT = {};');
  });

  it('YPlainArray 正例解析进 IR（子树纯值上下文：YLeaf 允许）', () => {
    const module = expectOk(parseVfsl('type A = YPlainArray<YLeaf<string>>;\ntype ROOT = {};'));
    expectJsonRoundTrip(module);
    expect(JSON.stringify(module)).toContain('A');
    expectDistinct('type A = YPlainArray<number>;\ntype ROOT = {};', 'type A = number;\ntype ROOT = {};');
  });

  it('YLeaf 正例解析进 IR，且与裸标量可区分', () => {
    const module = expectOk(parseVfsl('type A = YLeaf<string>;\ntype ROOT = {};'));
    expectJsonRoundTrip(module);
    expect(JSON.stringify(module)).toContain('A');
    expectDistinct('type A = YLeaf<string>;\ntype ROOT = {};', 'type A = string;\ntype ROOT = {};');
  });

  it('YXmlFragment 正例解析进 IR（保留名，只识别、不做结构解释），且与裸对象可区分', () => {
    const module = expectOk(parseVfsl('type A = YXmlFragment<{ title: string }>;\ntype ROOT = {};'));
    expectJsonRoundTrip(module);
    expect(JSON.stringify(module)).toContain('A');
    expectDistinct(
      'type A = YXmlFragment<{ title: string }>;\ntype ROOT = {};',
      'type A = { title: string };\ntype ROOT = {};',
    );
  });

  it('Pattern 正例：string & Pattern<"正则"> 解析进 IR，正则原文入 IR（AC3 唯一交叉正例）', () => {
    const module = expectOk(parseVfsl('type A = string & Pattern<"^[a-z]+$">;\ntype ROOT = {};'));
    expectJsonRoundTrip(module);
    const serialized = JSON.stringify(module);
    expect(serialized).toContain('A');
    // Pattern 键约束进入 IR：正则实参解码后文本必须在 IR 中（AC2 键约束入 IR）
    expect(serialized).toContain('^[a-z]+$');
    expectDistinct('type A = string & Pattern<"^[a-z]+$">;\ntype ROOT = {};', 'type A = string;\ntype ROOT = {};');
  });

  it('T[] 数组后缀正例解析进 IR（ArrayType），且与裸标量可区分', () => {
    const module = expectOk(parseVfsl('type A = string[];\ntype ROOT = {};'));
    expectJsonRoundTrip(module);
    expect(JSON.stringify(module)).toContain('A');
    expectDistinct('type A = string[];\ntype ROOT = {};', 'type A = string;\ntype ROOT = {};');
  });

  it('Record 正例解析进 IR（RecordType），且与裸值类型可区分', () => {
    const module = expectOk(parseVfsl('type A = Record<string, number>;\ntype ROOT = {};'));
    expectJsonRoundTrip(module);
    expect(JSON.stringify(module)).toContain('A');
    expectDistinct('type A = Record<string, number>;\ntype ROOT = {};', 'type A = number;\ntype ROOT = {};');
  });

  it('Record 键类型解析进 IR：键为 Pattern 约束别名（经别名链）与裸 string 键可区分（AC2）', () => {
    const text = 'type AssetId = string & Pattern<"^[a-z]+$">;\ntype A = Record<AssetId, number>;\ntype ROOT = {};';
    const module = expectOk(parseVfsl(text));
    expectJsonRoundTrip(module);
    expect(JSON.stringify(module)).toContain('AssetId');
    // Pattern 键约束进入 IR（解码后正则原文）
    expect(jsonContainsString(module, '^[a-z]+$')).toBe(true);
    // 键类型（约束别名 vs 裸 string）不同 → IR 必须不同
    expectDistinct(text, 'type A = Record<string, number>;\ntype ROOT = {};');
  });

  it('Record 键直接为 string & Pattern<…>（E306 的 string 形）正例解析进 IR（AC2 直接形态）', () => {
    const module = expectOk(parseVfsl('type A = Record<string & Pattern<"^[a-z]+$">, number>;\ntype ROOT = {};'));
    expectJsonRoundTrip(module);
    expect(JSON.stringify(module)).toContain('A');
  });

  it('标记嵌套（AC1）：YMap 包 Record 包 YLeaf，最内层实参进入 IR', () => {
    const text = 'type A = YMap<Record<string, YLeaf<string>>>;\ntype ROOT = {};';
    const module = expectOk(parseVfsl(text));
    expectJsonRoundTrip(module);
    expect(JSON.stringify(module)).toContain('A');
    // 嵌套包裹目标逐层进入 IR：最内层 YLeaf 实参不同 → 整体 IR 必须不同
    expectDistinct(text, 'type A = YMap<Record<string, YLeaf<number>>>;\ntype ROOT = {};');
  });

  it('YArray 任意实参：嵌套 YArray 与标量联合均正例', () => {
    expectOk(parseVfsl('type A = YArray<YArray<string>>;\ntype ROOT = {};'));
    expectOk(parseVfsl('type A = YArray<string | number>;\ntype ROOT = {};'));
  });

  it('spec §10 vfs3.assets 全量 fixture 端到端解析（六标记全出现 + 嵌套 + Record + T[] + ?:）', () => {
    const fixture = `
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
    const module = expectOk(parseVfsl(fixture));
    expectJsonRoundTrip(module);
    const serialized = JSON.stringify(module);
    for (const name of ['AssetId', 'Audit', 'AssetEntity', 'Attachments', 'ROOT']) {
      expect(serialized).toContain(name);
    }
    // Pattern 键约束进入 IR：双写反斜杠解码后的正则原文（§2 注记 6）
    expect(jsonContainsString(module, '^[A-Za-z0-9_\\-]{1,64}$')).toBe(true);
  });
});

describe('issue #6 — 反例：标记实参形状 / Record 键 / 纯值上下文 / 混合联合（红灯）', () => {
  it('E304：YMap 实参非对象形（标量），锚标记记号', () => {
    const issue = expectSingleIssue(parseVfsl('type A = YMap<string>;\ntype ROOT = {};'));
    expectIssueAt(issue, '304', 1, 10);
  });

  it('E304：YLeaf 实参容器形（对象），锚标记记号', () => {
    const issue = expectSingleIssue(parseVfsl('type A = YLeaf<{ x: string }>;\ntype ROOT = {};'));
    expectIssueAt(issue, '304', 1, 10);
  });

  it('E304：YXmlFragment 实参非对象形（标量），锚标记记号', () => {
    const issue = expectSingleIssue(parseVfsl('type A = YXmlFragment<number>;\ntype ROOT = {};'));
    expectIssueAt(issue, '304', 1, 10);
  });

  it('E304 沿别名链判定：YLeaf 实参为解析到对象形的别名，锚标记记号', () => {
    const issue = expectSingleIssue(parseVfsl('type B = { x: number };\ntype A = YLeaf<B>;\ntype ROOT = {};'));
    expectIssueAt(issue, '304', 2, 10);
  });

  it('E306：Record 键类型非 string 形（number），锚键类型起点', () => {
    const issue = expectSingleIssue(parseVfsl('type R = Record<number, string>;\ntype ROOT = {};'));
    expectIssueAt(issue, '306', 1, 17);
  });

  it('E306 沿别名链判定：键为解析到 number 形的别名，锚键类型起点', () => {
    const issue = expectSingleIssue(parseVfsl('type B = number;\ntype R = Record<B, string>;\ntype ROOT = {};'));
    expectIssueAt(issue, '306', 2, 17);
  });

  it('E307：同步标记直接位于纯值上下文（YPlainArray 子树），锚标记记号', () => {
    const issue = expectSingleIssue(parseVfsl('type A = YPlainArray<YMap<{ x: string }>>;\ntype ROOT = {};'));
    expectIssueAt(issue, '307', 1, 22);
  });

  it('E307 经别名间接引入纯值上下文，锚引入别名的引用记号', () => {
    const issue = expectSingleIssue(parseVfsl('type A = YMap<{ x: string }>;\ntype B = YPlainArray<A>;\ntype ROOT = {};'));
    expectIssueAt(issue, '307', 2, 22);
  });

  it('E309：同步物化上下文混合联合（容器形与标量形并存），锚首个异类成员起点', () => {
    const issue = expectSingleIssue(parseVfsl('type T = { x: { a: string } | number };\ntype ROOT = {};'));
    expectIssueAt(issue, '309', 1, 31);
  });
});

describe('issue #6 — 交叉类型契约（AC3：string & Pattern<"…"> 是唯一被接受的交叉形式）', () => {
  it('交叉左元非 string：number & string → 结构化错误 E100', () => {
    expectCode(expectSingleIssue(parseVfsl('type A = number & string;')), '100');
  });

  it('交叉右元非 Pattern：string & number → E100', () => {
    expectCode(expectSingleIssue(parseVfsl('type A = string & number;')), '100');
  });

  it('Pattern 脱离 string & Pattern<"…"> 完整语境（缺实参括号）→ E100', () => {
    expectCode(expectSingleIssue(parseVfsl('type A = string & Pattern;')), '100');
  });

  it('Pattern 实参非字符串字面量（数字）→ E100', () => {
    expectCode(expectSingleIssue(parseVfsl('type A = string & Pattern<1>;')), '100');
  });

  it('多段交叉（string & Pattern<"a"> & number）→ E100', () => {
    expectCode(expectSingleIssue(parseVfsl('type A = string & Pattern<"a"> & number;')), '100');
  });

  it('§9.1：Pattern 实参解码后非合法正则不在方言层校验 → ok: true', () => {
    expectOk(parseVfsl('type A = string & Pattern<"[">;\ntype ROOT = {};'));
  });

  it('§2 注记 6：正则实参反斜杠双写（\\d），解码后单反斜杠原文进 IR', () => {
    const module = expectOk(parseVfsl('type A = string & Pattern<"\\\\d+">;\ntype ROOT = {};'));
    expectJsonRoundTrip(module);
    expect(jsonContainsString(module, '\\d+')).toBe(true);
  });
});

describe('issue #6 — 大小写契约（AC4：变体拼写不是合法标记，按未知名报错）', () => {
  it('精确拼写 YMap 合法；同构文本 ymap 变体按未知名 E301（§6）', () => {
    expectOk(parseVfsl('type A = YMap<{ x: string }>;\ntype ROOT = {};'));
    const issue = expectSingleIssue(parseVfsl('type A = ymap<{ x: string }>;\ntype ROOT = {};'));
    expectIssueAt(issue, '301', 1, 10);
  });

  it('YLEaf 变体（大小写错误）按未知名 E301，锚引用记号', () => {
    const issue = expectSingleIssue(parseVfsl('type A = YLEaf<string>;\ntype ROOT = {};'));
    expectIssueAt(issue, '301', 1, 10);
  });

  it('§6：变体拼写可声明为普通别名（不进入保留名），声明后引用合法', () => {
    const module = expectOk(parseVfsl('type yleaf = string;\ntype A = yleaf;\ntype ROOT = {};'));
    expectJsonRoundTrip(module);
    const serialized = JSON.stringify(module);
    expect(serialized).toContain('yleaf');
    expect(serialized).toContain('A');
  });

  it('裸标记保留名误用（无 <）：type A = YMap → E100（判定顺序第 7 条）', () => {
    expectCode(expectSingleIssue(parseVfsl('type A = YMap;')), '100');
  });
});

/**
 * SA6 红灯测试 — 命名空间根（ROOT 约定）：VFSL-E310 / VFSL-E311（Issue #19）。
 *
 * 契约来源（docs/vfsl/v1-spec.md，frozen）：
 * - §3「命名空间根（ROOT 约定）」：每个模块必须恰好声明一个名为 `ROOT` 的别名
 *   （大小写是契约；`root` / `Root` 不算）；ROOT 固定物化为 Y.Map——仅接受裸对象
 *   （默认物化即 YMap）/ 显式 `YMap` / `Record` / 全 map 形联合（clsOf 三分类经
 *   别名解析后判定）；标量形（原始类型 / 全标量联合 / `YLeaf` / `YPlainArray` /
 *   `Pattern`）与 `YArray` / `YXmlFragment` 一律拒绝；
 * - §4 错误码总表：E310（缺 ROOT，锚模块起始 1:1）/ E311（ROOT 非 map 形，锚
 *   ROOT 类型表达式起点记号）；E310/E311 属引用 / 语义相位，与既有 E30x 按
 *   min-position 聚合；ROOT 重复声明走既有 E302，不是新码；
 * - 错误码传递通道：issues 恰含 1 条，message 前缀 `VFSL-E<编号>: ` 冻结。
 *
 * 断言锚点一律为公共接缝 parseVfsl(text) 的可观测行为（ok / issue 码 / 行列），
 * 不读取源码、不 grep 文本形状。E310/E311 当前完全未实现（grep 零命中），
 * 全部反例断言当前必然红灯。
 */
import { describe, expect, it } from 'vitest';
import { parseVfsl } from '../src/index.js';

/** PRD #3 冻结的公共接缝返回形状。 */
type ParseResult =
  | { ok: true; module: unknown }
  | { ok: false; issues: { message: string; line: number; column: number }[] };

type Issue = { message: string; line: number; column: number };

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

/** 断言错误码前缀 + 精确行列（如 expectIssueAt(issue, '310', 1, 1)）。 */
function expectIssueAt(issue: Issue, code: string, line: number, column: number): void {
  expect(issue.message).toMatch(new RegExp(`^VFSL-E${code}: `));
  expect(issue.line).toBe(line);
  expect(issue.column).toBe(column);
}

/** 断言 ok: true（正例契约锚）。 */
function expectOk(result: ParseResult): unknown {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`期望 ok: true，实际 ok: false（issues: ${JSON.stringify(result.issues)}）`);
  }
  return result.module;
}

describe('parseVfsl — 命名空间根：E310 缺少 ROOT（锚模块起始 1:1）', () => {
  it('AC1：无 ROOT 的模块 → VFSL-E310，line 1 column 1', () => {
    const issue = expectSingleIssue(parseVfsl('type Foo = string;'));
    expectIssueAt(issue, '310', 1, 1);
  });

  it('多个别名但无 ROOT → VFSL-E310，锚模块起始与声明数量无关', () => {
    const issue = expectSingleIssue(parseVfsl('type A = string;\ntype B = { x: number };'));
    expectIssueAt(issue, '310', 1, 1);
  });

  it('前导文档注释后的无 ROOT 模块 → VFSL-E310 仍锚 1:1（模块起始 = 文本起始，非首个声明）', () => {
    const issue = expectSingleIssue(parseVfsl('/** 前导文档注释 */\ntype Foo = string;'));
    expectIssueAt(issue, '310', 1, 1);
  });

  it('空文本（空模块，无 ROOT 别名）→ VFSL-E310，锚 1:1（§3「每个模块」无例外）', () => {
    const issue = expectSingleIssue(parseVfsl(''));
    expectIssueAt(issue, '310', 1, 1);
  });

  it('AC5：`type root = {…}` 大小写变体不算 ROOT → VFSL-E310', () => {
    const issue = expectSingleIssue(parseVfsl('type root = { a: string };'));
    expectIssueAt(issue, '310', 1, 1);
  });

  it('AC5：`type Root = {…}` 大小写变体不算 ROOT → VFSL-E310', () => {
    const issue = expectSingleIssue(parseVfsl('type Root = { a: string };'));
    expectIssueAt(issue, '310', 1, 1);
  });
});

describe('parseVfsl — 命名空间根：E311 标量 ROOT（锚 ROOT 类型表达式起点）', () => {
  it('AC2：原始类型 `type ROOT = string;` → VFSL-E311，锚类型表达式起点', () => {
    const issue = expectSingleIssue(parseVfsl('type ROOT = string;'));
    expectIssueAt(issue, '311', 1, 13);
  });

  it('AC2：其他原始类型（number）同样拒绝 → VFSL-E311', () => {
    const issue = expectSingleIssue(parseVfsl('type ROOT = number;'));
    expectIssueAt(issue, '311', 1, 13);
  });

  it('AC2：`type ROOT = YLeaf<string>;` → VFSL-E311，锚 YLeaf 记号', () => {
    const issue = expectSingleIssue(parseVfsl('type ROOT = YLeaf<string>;'));
    expectIssueAt(issue, '311', 1, 13);
  });

  it('AC2：`type ROOT = YPlainArray<string>;` → VFSL-E311（纯值容器在根位属标量形，拒绝）', () => {
    const issue = expectSingleIssue(parseVfsl('type ROOT = YPlainArray<string>;'));
    expectIssueAt(issue, '311', 1, 13);
  });

  it('AC2：`type ROOT = string & Pattern<"a">;` → VFSL-E311，锚 string 记号（PatternType 起点）', () => {
    const issue = expectSingleIssue(parseVfsl('type ROOT = string & Pattern<"a">;'));
    expectIssueAt(issue, '311', 1, 13);
  });

  it('AC2：全标量联合 `type ROOT = string | number;` → VFSL-E311，锚首成员起点', () => {
    const issue = expectSingleIssue(parseVfsl('type ROOT = string | number;'));
    expectIssueAt(issue, '311', 1, 13);
  });
});

describe('parseVfsl — 命名空间根：E311 非 map 容器 ROOT', () => {
  it('AC3：`type ROOT = YArray<string>;` → VFSL-E311，锚 YArray 记号', () => {
    const issue = expectSingleIssue(parseVfsl('type ROOT = YArray<string>;'));
    expectIssueAt(issue, '311', 1, 13);
  });

  it('AC3：`type ROOT = YXmlFragment<{ a: string }>;` → VFSL-E311（实参对象形通过 E304，根位仍拒绝）', () => {
    const issue = expectSingleIssue(parseVfsl('type ROOT = YXmlFragment<{ a: string }>;'));
    expectIssueAt(issue, '311', 1, 13);
  });

  it('裸数组 `type ROOT = string[];`（默认 YArray 物化）→ VFSL-E311，锚 primary 起点', () => {
    const issue = expectSingleIssue(parseVfsl('type ROOT = string[];'));
    expectIssueAt(issue, '311', 1, 13);
  });
});

describe('parseVfsl — 命名空间根：E311 别名链穿透（clsOf 经别名解析后判定）', () => {
  it('AC6：`type S = string; type ROOT = S;` → VFSL-E311，锚引用记号 S', () => {
    const issue = expectSingleIssue(parseVfsl('type S = string; type ROOT = S;'));
    expectIssueAt(issue, '311', 1, 30);
  });

  it('多跳别名链 `type A = string; type B = A; type ROOT = B;` → VFSL-E311', () => {
    const issue = expectSingleIssue(parseVfsl('type A = string; type B = A; type ROOT = B;'));
    expectIssueAt(issue, '311', 1, 42);
  });

  it('全标量联合经别名 `type ROOT = A | B;`（A/B 均标量）→ VFSL-E311，锚联合首成员', () => {
    const issue = expectSingleIssue(parseVfsl('type A = string; type B = number; type ROOT = A | B;'));
    expectIssueAt(issue, '311', 1, 47);
  });
});

describe('parseVfsl — 命名空间根：E311 锚点 = ROOT 类型表达式起点（非 type 关键字）', () => {
  it('多行文本：类型表达式起于第 2 行 → 锚其起点行列', () => {
    const issue = expectSingleIssue(parseVfsl('type ROOT =\n  string;'));
    expectIssueAt(issue, '311', 2, 3);
  });

  it('别名链多行：锚第 2 行引用记号起点', () => {
    const issue = expectSingleIssue(parseVfsl('type S = string;\ntype ROOT = S;'));
    expectIssueAt(issue, '311', 2, 13);
  });
});

describe('parseVfsl — 命名空间根：E310/E311 与既有 E30x 的候选池 min-position 聚合', () => {
  it('E311（ROOT 位，行 1 列 13）先于其内未知名 E301（列 20）→ E311 胜出', () => {
    const issue = expectSingleIssue(parseVfsl('type ROOT = YArray<Foo>;'));
    expectIssueAt(issue, '311', 1, 13);
  });

  it('ROOT 重复声明走既有 E302（不是新码），锚第二个声明名', () => {
    const issue = expectSingleIssue(parseVfsl('type ROOT = { a: string }; type ROOT = { b: number };'));
    expectIssueAt(issue, '302', 1, 33);
  });

  it('ROOT 位未知名引用：形状不裁决，错误身份归既有 E301（防误报 E311）', () => {
    const issue = expectSingleIssue(parseVfsl('type ROOT = Foo;'));
    expectIssueAt(issue, '301', 1, 13);
  });
});

describe('parseVfsl — 命名空间根：正例全形态（ok: true 契约锚）', () => {
  it('AC4：裸对象 `type ROOT = { x: string };` → ok', () => {
    const module = expectOk(parseVfsl('type ROOT = { x: string };'));
    expect(JSON.stringify(module)).toContain('ROOT');
  });

  it('空对象 `type ROOT = {};`（默认物化即 YMap）→ ok', () => {
    const module = expectOk(parseVfsl('type ROOT = {};'));
    expect(JSON.stringify(module)).toContain('ROOT');
  });

  it('AC4：显式 `type ROOT = YMap<{ x: string }>;` → ok', () => {
    const module = expectOk(parseVfsl('type ROOT = YMap<{ x: string }>;'));
    expect(JSON.stringify(module)).toContain('ROOT');
  });

  it('AC4：`type ROOT = Record<string, string>;` → ok', () => {
    const module = expectOk(parseVfsl('type ROOT = Record<string, string>;'));
    expect(JSON.stringify(module)).toContain('ROOT');
  });

  it('AC4：全 map 形联合 `type ROOT = { x: string } | YMap<{ y: number }>;` → ok', () => {
    const module = expectOk(parseVfsl('type ROOT = { x: string } | YMap<{ y: number }>;'));
    expect(JSON.stringify(module)).toContain('ROOT');
  });

  it('AC6：map 形经别名间接 `type M = YMap<{ x: string }>; type ROOT = M;` → ok', () => {
    const module = expectOk(parseVfsl('type M = YMap<{ x: string }>; type ROOT = M;'));
    expect(JSON.stringify(module)).toContain('ROOT');
  });

  it('全 map 形联合经别名 `type ROOT = A | B;`（A/B 均 map）→ ok', () => {
    const module = expectOk(parseVfsl('type A = { x: string }; type B = YMap<{ y: number }>; type ROOT = A | B;'));
    expect(JSON.stringify(module)).toContain('ROOT');
  });

  it('AC7：ROOT 被其他别名引用（既当根又当积木）→ ok', () => {
    const module = expectOk(parseVfsl('type ROOT = { x: string }; type R = ROOT;'));
    expect(JSON.stringify(module)).toContain('ROOT');
  });

  it('AC7：游离积木别名（无人引用）合法 → ok', () => {
    const module = expectOk(parseVfsl('type ROOT = { x: string }; type Unused = string;'));
    expect(JSON.stringify(module)).toContain('ROOT');
  });

  it('大小写变体与真 ROOT 并存：`Root` 不算根，真 ROOT 在场 → ok', () => {
    const module = expectOk(parseVfsl('type Root = { a: string }; type ROOT = { x: string };'));
    expect(JSON.stringify(module)).toContain('ROOT');
  });

  it('规格 §10 修订版 vfs3.assets 参考 fixture（ROOT=YMap，YXmlFragment 位于 text.body）→ ok', () => {
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
    const serialized = JSON.stringify(module);
    for (const name of ['AssetId', 'AssetEntity', 'Attachments', 'ROOT']) {
      expect(serialized).toContain(name);
    }
  });
});

/**
 * SA6 红灯测试 — R3 回归用例轮（issue #5 / SA4 REJECT R-1、R-2 的回归锚）。
 *
 * 来源：wiki/raw/task_vfsl-parser-min-e2e_sa4_review.md §六.1 / §六.2（R3 派发前
 * 全部期望行列已经 node 脚本按 Unicode 码点口径逐字符核算，见该轮记录）。
 *
 * R-1（规格 §4「column 按 Unicode 码点计」）：注释内星面字符（non-BMP）列计数
 * 必须按码点推进——实现缺陷为 tokenizer 两个注释扫描器按 UTF-16 码元推进
 * （tokenizer.ts:100-103 / 114-137），导致后续锚点列漂移 +1/个。四断言：
 * 块注释单星面 / 双星面累积 / 行注释 EOF 锚（无换行）各 1，BMP 中文对照 1
 * （对照必须保持绿——缺陷仅由星面字符触发）。
 *
 * R-2（设计 §6.1「同名多声明引用边取全部声明体并集」）：重复声明场景下 E106
 * 引用图边必须取并集而非「最后一次声明体」（实现缺陷为 semantic.ts:88-95 的
 * `graph.set(a.name, edges)` 后声明覆盖先声明）。三断言：自环版（前体自环回边
 * 经并集进入候选池，min-position 胜出）、互环版（互环声明对置于重复声明之前，
 * 并集回边 (2,15) 先于 E302@(3,6) 胜出——SA4 原输入单行版在并集口径下仍由
 * E302 胜出、无可观测变化，故按设计 §6.2 构造本判别输入，见 R3 记录）、
 * 单声明自环对照（排除「实现没有 E106」的替代解释）。
 *
 * 全部断言经公共接缝 parseVfsl 运行时行为，无源码 grep。
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

/** 断言错误码前缀 + 精确锚点行列。 */
function expectIssueAt(issue: Issue, code: string, line: number, column: number): void {
  expect(issue.message).toMatch(new RegExp(`^VFSL-E${code}: `));
  expect(issue.line).toBe(line);
  expect(issue.column).toBe(column);
}

describe('R3 R-1 — 注释内星面字符列计数按码点（SA4 REJECT R-1 回归）', () => {
  it('块注释单星面：`/*😀*/ type A = -1;` 锚 `-` 按码点计 @(1,16)', () => {
    const issue = expectSingleIssue(parseVfsl('/*😀*/ type A = -1;'));
    expectIssueAt(issue, '100', 1, 16);
  });

  it('块注释双星面：`/*😀😀*/ type A = -1;` 锚 `-` 漂移按码点计 @(1,17)', () => {
    const issue = expectSingleIssue(parseVfsl('/*😀😀*/ type A = -1;'));
    expectIssueAt(issue, '100', 1, 17);
  });

  it('行注释星面 EOF 无换行：`type A = string //😀` EOF 锚按码点计 @(1,20)', () => {
    const issue = expectSingleIssue(parseVfsl('type A = string //😀'));
    expectIssueAt(issue, '100', 1, 20);
  });

  it('BMP 对照：`/*中*/ type A = -1;` 中文按码点计 @(1,16)，不触发漂移', () => {
    const issue = expectSingleIssue(parseVfsl('/*中*/ type A = -1;'));
    expectIssueAt(issue, '100', 1, 16);
  });
});

describe('R3 R-2 — 重复声明引用图边取全部声明体并集（SA4 REJECT R-2 回归）', () => {
  it('自环版：`type A = { a: A }; type A = string;` 前体自环回边 min-position 胜出 → E106@(1,15)', () => {
    const issue = expectSingleIssue(parseVfsl('type A = { a: A }; type A = string;\ntype ROOT = {};'));
    expectIssueAt(issue, '106', 1, 15);
  });

  it('互环版：`type A = { b: B };\\ntype B = { a: A };\\ntype A = string;` 并集回边 min-position 胜出 → E106@(2,15)', () => {
    const issue = expectSingleIssue(parseVfsl('type A = { b: B };\ntype B = { a: A };\ntype A = string;\ntype ROOT = {};'));
    expectIssueAt(issue, '106', 2, 15);
  });

  it('单声明自环对照：`type A = { a: A };` → E106@(1,15)，排除「实现没有 E106」的替代解释', () => {
    const issue = expectSingleIssue(parseVfsl('type A = { a: A };\ntype ROOT = {};'));
    expectIssueAt(issue, '106', 1, 15);
  });
});

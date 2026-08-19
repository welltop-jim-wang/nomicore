/**
 * SA6 红灯测试 — parseVfsl 异常输入：结构化错误（issue #5）。
 *
 * 契约来源（docs/vfsl/v1-spec.md，frozen §4）：
 * - 公共接缝：ok: false 时 issues 数组恰含 1 条（v1 冻结「首个错误即失败」）；
 * - 每条 issue 形状 { message, line, column }，line/column 均 1 起，column 按
 *   Unicode 码点计，行分隔为 \n；
 * - message 的冻结前缀格式 `VFSL-E<编号>: <人类可读消息>`（断言前缀，不锁消息全文）；
 * - 定位锚点按错误码总表（E100~E106、E201~E203、E301~E303）。
 *
 * 本切片错误范围：切片内构造相关的语法 / 词法 / 引用错误（E100 catch-all 为底线）。
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

/** 断言错误码前缀，如 expectCode(issue, '301')。 */
function expectCode(issue: Issue, code: string): void {
  expect(issue.message).toMatch(new RegExp(`^VFSL-E${code}: `));
}

describe('parseVfsl — 语法相位错误（E100~E105）', () => {
  it('E100：括号分组不在 v1 子集（注记 5），锚 `(` 起点', () => {
    const issue = expectSingleIssue(parseVfsl('type A = ( string | number );'));
    expectCode(issue, '100');
    expect(issue.line).toBe(1);
    expect(issue.column).toBe(10);
  });

  it('E100：负数字面量不在 v1 子集（注记 7），锚 `-` 起点', () => {
    const issue = expectSingleIssue(parseVfsl('type A = -1;'));
    expectCode(issue, '100');
    expect(issue.line).toBe(1);
    expect(issue.column).toBe(10);
  });

  it('E100：保留名后随 < 属越界语法（判定顺序第 7 条），锚保留名记号', () => {
    const issue = expectSingleIssue(parseVfsl('type T = string<number>;'));
    expectCode(issue, '100');
    expect(issue.line).toBe(1);
    expect(issue.column).toBe(10);
  });

  it('E100：别名缺终止分号（注记 4），返回结构化错误', () => {
    const issue = expectSingleIssue(parseVfsl('type A = string'));
    expectCode(issue, '100');
  });

  it('E100：可选属性缺类型注解，返回结构化错误', () => {
    const issue = expectSingleIssue(parseVfsl('type T = { a?: };'));
    expectCode(issue, '100');
  });

  it('E101：any 类型被禁止（判定顺序第 5 条），锚 any 记号', () => {
    const issue = expectSingleIssue(parseVfsl('type A = any;'));
    expectCode(issue, '101');
    expect(issue.line).toBe(1);
    expect(issue.column).toBe(10);
  });

  it('E102：自定义泛型参数（判定顺序第 2 条），锚 < 记号', () => {
    const issue = expectSingleIssue(parseVfsl('type Box<T> = { value: T };'));
    expectCode(issue, '102');
    expect(issue.line).toBe(1);
    expect(issue.column).toBe(9);
  });

  it('E103：条件类型（判定顺序第 3 条），锚 extends 记号', () => {
    const issue = expectSingleIssue(parseVfsl('type T = A extends B ? C : D;'));
    expectCode(issue, '103');
    expect(issue.line).toBe(1);
    expect(issue.column).toBe(12);
  });

  it('E104：mapped type（判定顺序第 4 条），锚 [ 记号', () => {
    const issue = expectSingleIssue(parseVfsl('type T = { [K in Keys]: V };'));
    expectCode(issue, '104');
    expect(issue.line).toBe(1);
    expect(issue.column).toBe(12);
  });

  it('E105：interface 声明族（判定顺序第 1 条），锚 interface 记号', () => {
    const issue = expectSingleIssue(parseVfsl('interface A {}'));
    expectCode(issue, '105');
    expect(issue.line).toBe(1);
    expect(issue.column).toBe(1);
  });
});

describe('parseVfsl — 词法相位错误（E201~E203）', () => {
  it('E201：字符串字面量未闭合（注记 6），锚起始 `"`', () => {
    const issue = expectSingleIssue(parseVfsl('type A = "abc'));
    expectCode(issue, '201');
    expect(issue.line).toBe(1);
    expect(issue.column).toBe(10);
  });

  it('E202：非法转义序列（注记 6），锚反斜杠记号', () => {
    const issue = expectSingleIssue(parseVfsl('type A = "a\\b";'));
    expectCode(issue, '202');
    expect(issue.line).toBe(1);
    expect(issue.column).toBe(12);
  });

  it('E203：块注释未闭合，锚起始 /*', () => {
    const issue = expectSingleIssue(parseVfsl('type A = string; /* foo'));
    expectCode(issue, '203');
    expect(issue.line).toBe(1);
    expect(issue.column).toBe(18);
  });
});

describe('parseVfsl — 引用 / 语义相位错误（E301~E303、E106）', () => {
  it('E301：未知名引用，锚引用记号', () => {
    const issue = expectSingleIssue(parseVfsl('type A = Foo;\ntype ROOT = {};'));
    expectCode(issue, '301');
    expect(issue.line).toBe(1);
    expect(issue.column).toBe(10);
  });

  it('E301：多行文本中行列基准 1 起、\\n 为行分隔（§4）', () => {
    const issue = expectSingleIssue(parseVfsl('type A = string;\n\ntype B = Foo;\ntype ROOT = {};'));
    expectCode(issue, '301');
    expect(issue.line).toBe(3);
    expect(issue.column).toBe(10);
  });

  it('E302：类型别名重复声明，锚重复的声明名', () => {
    const issue = expectSingleIssue(parseVfsl('type A = string; type A = number;\ntype ROOT = {};'));
    expectCode(issue, '302');
    expect(issue.line).toBe(1);
    expect(issue.column).toBe(23);
  });

  it('E303：别名名占用保留名（判定顺序第 7 条），锚声明名', () => {
    const issue = expectSingleIssue(parseVfsl('type string = number;'));
    expectCode(issue, '303');
    expect(issue.line).toBe(1);
    expect(issue.column).toBe(6);
  });

  it('E106：自引用成环，锚再入引用记号', () => {
    const issue = expectSingleIssue(parseVfsl('type A = { x: A };\ntype ROOT = {};'));
    expectCode(issue, '106');
    expect(issue.line).toBe(1);
    expect(issue.column).toBe(15);
  });

  it('E106：互引用成环（A→B→A），锚再入引用记号', () => {
    const issue = expectSingleIssue(parseVfsl('type A = { b: B };\ntype B = { a: A };\ntype ROOT = {};'));
    expectCode(issue, '106');
    expect(issue.line).toBe(2);
    expect(issue.column).toBe(15);
  });
});

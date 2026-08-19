/**
 * SA6 红灯测试 — 禁止语法负例矩阵（issue #8，功能开发）。
 *
 * 契约来源（docs/vfsl/v1-spec.md，frozen §4「禁止清单与错误语义」）：
 * - 五类禁止构造对应专属错误码 E101~E105，定位锚点按「错误判定顺序」逐条规定；
 * - 公共接缝：ok: false 时 issues 恰含 1 条；issue 形状 { message, line, column }，
 *   line/column 均 1 起，column 按 Unicode 码点计；
 * - message 冻结前缀 `VFSL-E<编号>: `（断言前缀，不锁消息全文）；
 * - 同处构造命中多个特征时取文本位置最前者（判定顺序引语）；
 * - 类型位置的泛型调用（`Foo<Bar>`）不属 E102——判定顺序第 6 条：未声明 → E301 锚
 *   引用记号，已声明 → E100 锚 `<`（本文件以 E102-06/07 单元格锚定该精确区分）。
 *
 * 矩阵组织（验收标准第 3 条：测试报告可逐项指认矩阵单元格）：
 * - describe 名 = 错误码类别；it 名 = `<码>-<单元格编号>-<neg|pos> <形态描述>`；
 * - neg = 负例（越界写法，断言 ok: false + 错误码 + 锚点行列）；
 * - pos = 与负例配对的最接近合法写法（断言 ok: true + 声明数，证明拒绝精确、
 *   非一刀切）。
 */
import { describe, expect, it } from 'vitest';
import { parseVfsl } from '../src/index.js';

/** PRD #3 冻结的公共接缝返回形状。 */
type ParseResult =
  | { ok: true; module: unknown }
  | { ok: false; issues: { message: string; line: number; column: number }[] };

type Issue = { message: string; line: number; column: number };

/** 断言 ok: false、issues 恰含 1 条，返回该 issue（字段形状合规）。 */
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
  expect(issue.message).toMatch(/^VFSL-E\d{3}: /);
  expect(Number.isInteger(issue.line)).toBe(true);
  expect(issue.line).toBeGreaterThanOrEqual(1);
  expect(Number.isInteger(issue.column)).toBe(true);
  expect(issue.column).toBeGreaterThanOrEqual(1);
  return issue;
}

/** 断言错误码前缀 + 锚点行列（v1-spec §4 错误身份 = 码 + 消息 + 行列）。 */
function expectAnchored(issue: Issue, code: string, line: number, column: number): void {
  expect(issue.message).toMatch(new RegExp(`^VFSL-E${code}: `));
  expect(issue.line).toBe(line);
  expect(issue.column).toBe(column);
}

/** 断言正例通过：ok: true 且解析出全部声明（防「静默截断为 ok」伪绿）。 */
function expectOk(result: ParseResult, aliasCount: number): void {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`期望 ok: true，实际 ok: false（issues: ${JSON.stringify(result.issues)}）`);
  }
  const m = result.module as { aliases?: unknown[] };
  expect(Array.isArray(m.aliases)).toBe(true);
  expect(m.aliases).toHaveLength(aliasCount);
}

// ============================================================
// E101 — any 类型（判定顺序第 5 条：类型位置遇 any → E101，锚 any 记号）
// ============================================================
describe('E101 — any 类型禁止矩阵（v1-spec §4 判定顺序第 5 条，锚 any 记号）', () => {
  it('E101-01-neg 顶层类型位置 any → E101 锚 1:10', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = any;')), '101', 1, 10);
  });

  it('E101-01-pos 最接近合法写法 unknown（原始类型 §2）→ ok', () => {
    expectOk(parseVfsl('type T = unknown;'), 1);
  });

  it('E101-02-neg 对象字段嵌套位 any → E101 锚 1:15', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = { a: any };')), '101', 1, 15);
  });

  it('E101-02-pos 字段嵌套位 unknown → ok', () => {
    expectOk(parseVfsl('type T = { a: unknown };'), 1);
  });

  it('E101-03-neg 数组元素位 any（any[]）→ E101 锚 1:10', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = any[];')), '101', 1, 10);
  });

  it('E101-03-pos 数组元素位 unknown → ok', () => {
    expectOk(parseVfsl('type T = unknown[];'), 1);
  });

  it('E101-04-neg 联合成员位 any → E101 锚 1:19', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = string | any;')), '101', 1, 19);
  });

  it('E101-04-pos 联合成员位 unknown → ok', () => {
    expectOk(parseVfsl('type T = string | unknown;'), 1);
  });

  it('E101-05-neg 标记实参位 any（YLeaf<any>）→ E101 锚 1:16', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = YLeaf<any>;')), '101', 1, 16);
  });

  it('E101-05-pos 标记实参位 unknown（YLeaf 允许 unknown，§3 形状约束表）→ ok', () => {
    expectOk(parseVfsl('type T = YLeaf<unknown>;'), 1);
  });

  it('E101-06-neg Record 值位 any → E101 锚 1:25', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = Record<string, any>;')), '101', 1, 25);
  });

  it('E101-06-pos Record 值位 unknown → ok', () => {
    expectOk(parseVfsl('type T = Record<string, unknown>;'), 1);
  });

  it('E101-07-neg 大小写变体 Any 非保留名（§4/§6 大小写敏感）→ E301 锚 1:10，非 E101', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = Any;')), '301', 1, 10);
  });

  it('E101-07-pos Any 可声明为普通别名并引用 → ok', () => {
    expectOk(parseVfsl('type Any = string; type T = Any;'), 2);
  });

  it('E101-08-neg 纯值上下文内 any（YPlainArray 实参位同样类型位置）→ E101 锚 1:22', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = YPlainArray<any>;')), '101', 1, 22);
  });

  it('E101-08-pos 纯值上下文内 unknown → ok', () => {
    expectOk(parseVfsl('type T = YPlainArray<unknown>;'), 1);
  });
});

// ============================================================
// E102 — 自定义泛型（判定顺序第 2 条：声明名后遇 < → E102，锚 < 记号；
//        第 6 条：类型位置泛型调用按声明/未声明终判，E100 锚 < / E301 锚引用记号）
// ============================================================
describe('E102 — 自定义泛型禁止矩阵（v1-spec §4 判定顺序第 2/6 条）', () => {
  it('E102-01-neg 单参数泛型声明 → E102 锚 1:9', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type Box<T> = { value: T };')), '102', 1, 9);
  });

  it('E102-01-pos 最接近合法写法：去掉参数表的普通别名 → ok', () => {
    expectOk(parseVfsl('type Box = { value: string };'), 1);
  });

  it('E102-02-neg 多参数泛型声明 → E102 锚 1:10', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type Pair<K, V> = { k: K; v: V };')), '102', 1, 10);
  });

  it('E102-02-pos 多字段普通别名 → ok', () => {
    expectOk(parseVfsl('type Pair = { k: string; v: number };'), 1);
  });

  it('E102-03-neg 带约束泛型声明（<T extends string>，位置最前者为 < → E102 优先于 E103）→ E102 锚 1:9', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type Box<T extends string> = { value: T };')), '102', 1, 9);
  });

  it('E102-03-pos 约束语义的直接表达：string 形别名 → ok', () => {
    expectOk(parseVfsl('type Box = { value: string };'), 1);
  });

  it('E102-04-neg 带默认值泛型声明（<K = string, V = number>）→ E102 锚 1:10', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type Pair<K = string, V = number> = { k: K; v: V };')), '102', 1, 10);
  });

  it('E102-04-pos 默认值语义的直接表达：字段引用已声明别名 → ok', () => {
    expectOk(parseVfsl('type K = string; type V = number; type Pair = { k: K; v: V };'), 3);
  });

  it('E102-05-neg 声明名与 < 间有空白（trivia 不影响判定）→ E102 锚 1:10', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type Box <T> = { value: T };')), '102', 1, 10);
  });

  it('E102-05-pos 空白形态的合法版本（声明名后为 =）→ ok', () => {
    expectOk(parseVfsl('type Box = { value: string };'), 1);
  });

  it('E102-06-neg 类型位置泛型调用且名未声明（第 6 条终判）→ E301 锚引用记号 1:10', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = Foo<Bar>;')), '301', 1, 10);
  });

  it('E102-06-pos 声明后裸引用（Foo 已声明的最接近合法写法）→ ok', () => {
    expectOk(parseVfsl('type Foo = string; type T = Foo;'), 2);
  });

  it('E102-09-neg 裸引用未声明名（无实参）→ E301 锚引用记号 1:10', () => {
    // 对照格：证明 E301 拒的是「未声明」而非「实参调用形态」；配对正例即 E102-06-pos
    expectAnchored(expectSingleIssue(parseVfsl('type T = Foo;')), '301', 1, 10);
  });

  it('E102-07-neg 类型位置泛型调用且名已声明（第 6 条终判）→ E100 锚 < 1:43', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type Box = { value: string }; type T = Box<string>;')), '100', 1, 43);
  });

  it('E102-07-pos 已声明别名不带实参的裸引用 → ok', () => {
    expectOk(parseVfsl('type Box = { value: string }; type T = Box;'), 2);
  });

  it('E102-08-neg 声明名与 < 跨行（trivia 剥离后判定不变）→ E102 锚 2:1', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type Box\n<T> = { value: T };')), '102', 2, 1);
  });

  it('E102-08-pos 跨行形态的合法版本（= 在次行）→ ok', () => {
    expectOk(parseVfsl('type Box\n= { value: string };'), 1);
  });
});

// ============================================================
// E103 — 条件类型（判定顺序第 3 条：类型位置遇 extends → E103，锚 extends 记号）
// ============================================================
describe('E103 — 条件类型禁止矩阵（v1-spec §4 判定顺序第 3 条，锚 extends 记号）', () => {
  it('E103-01-neg 顶层条件类型 → E103 锚 1:12', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = A extends B ? C : D;')), '103', 1, 12);
  });

  it('E103-01-pos 最接近合法写法：条件拆为显式联合 → ok', () => {
    expectOk(parseVfsl('type C = string; type D = number; type T = C | D;'), 3);
  });

  it('E103-02-neg 对象字段嵌套位条件类型 → E103 锚 1:17', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = { a: A extends B ? C : D };')), '103', 1, 17);
  });

  it('E103-02-pos 字段嵌套位显式联合 → ok', () => {
    expectOk(parseVfsl('type C = string; type D = number; type T = { a: C | D };'), 3);
  });

  it('E103-03-neg 条件类型带数组后缀（extends 处即报）→ E103 锚 1:12', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = A extends B ? C : D[];')), '103', 1, 12);
  });

  it('E103-03-pos 数组形态的显式联合（C[] | D[]）→ ok', () => {
    expectOk(parseVfsl('type C = string; type D = number; type T = C[] | D[];'), 3);
  });

  it('E103-04-neg 联合成员位条件类型 → E103 锚 1:21', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = string | A extends B ? C : D;')), '103', 1, 21);
  });

  it('E103-04-pos 联合成员位显式联合 → ok', () => {
    expectOk(parseVfsl('type C = string; type D = number; type T = string | C | D;'), 3);
  });

  it('E103-05-neg 标记实参位条件类型（YArray<...>）→ E103 锚 1:19', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = YArray<A extends B ? C : D>;')), '103', 1, 19);
  });

  it('E103-05-pos 标记实参位显式联合 → ok', () => {
    expectOk(parseVfsl('type C = string; type D = number; type T = YArray<C | D>;'), 3);
  });

  it('E103-06-neg Record 值位条件类型 → E103 锚 1:27', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = Record<string, A extends B ? C : D>;')), '103', 1, 27);
  });

  it('E103-06-pos Record 值位显式联合 → ok', () => {
    expectOk(parseVfsl('type C = string; type D = number; type T = Record<string, C | D>;'), 3);
  });

  it('E103-07-neg PatternType 之后的联合成员位条件类型 → E103 锚 1:36', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = string & Pattern<"a"> | A extends B ? C : D;')), '103', 1, 36);
  });

  it('E103-07-pos PatternType 与显式联合并存 → ok', () => {
    expectOk(parseVfsl('type C = string; type D = number; type T = string & Pattern<"a"> | C | D;'), 3);
  });

  it('E103-08-neg 类型位置首记号即 extends → E103 锚 1:10', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = extends B;')), '103', 1, 10);
  });

  it('E103-08-pos 最接近合法写法（原始类型）→ ok', () => {
    expectOk(parseVfsl('type T = string;'), 1);
  });
});

// ============================================================
// E104 — mapped type（判定顺序第 4 条：字段名 Ident 期望位遇 [ → E104，锚 [ 记号；
//         修饰符形态 `{ readonly [K...` 的 [ 不在 Ident 期望位 → 按 E100 精确拒绝）
// ============================================================
describe('E104 — mapped type 禁止矩阵（v1-spec §4 判定顺序第 4 条，锚 [ 记号）', () => {
  it('E104-01-neg 顶层对象内 mapped type → E104 锚 1:12', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = { [K in Keys]: V };')), '104', 1, 12);
  });

  it('E104-01-pos 最接近合法写法：Record 键值映射 → ok', () => {
    expectOk(parseVfsl('type V = string; type T = Record<string, V>;'), 2);
  });

  it('E104-02-neg 嵌套对象内 mapped type → E104 锚 1:17', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = { a: { [K in Keys]: V } };')), '104', 1, 17);
  });

  it('E104-02-pos 嵌套对象内 Record → ok', () => {
    expectOk(parseVfsl('type V = string; type T = { a: Record<string, V> };'), 2);
  });

  it('E104-03-neg 混普通字段对象内 mapped type → E104 锚 1:23', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = { a: string; [K in Keys]: V };')), '104', 1, 23);
  });

  it('E104-03-pos 混普通字段对象（去掉 mapped 部分）→ ok', () => {
    expectOk(parseVfsl('type V = string; type T = { a: string; extra: V };'), 2);
  });

  it('E104-04-neg 标记实参内 mapped type（YMap<{...}>）→ E104 锚 1:17', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = YMap<{ [K in Keys]: V }>;')), '104', 1, 17);
  });

  it('E104-04-pos 标记实参内普通对象字段 → ok', () => {
    expectOk(parseVfsl('type V = string; type T = YMap<{ key: V }>;'), 2);
  });

  it('E104-05-neg 对象数组元素位 mapped type（{...}[]）→ E104 锚对象内 [ 1:12', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = { [K in Keys]: V }[];')), '104', 1, 12);
  });

  it('E104-05-pos 对象数组元素位 Record → ok', () => {
    expectOk(parseVfsl('type V = string; type T = Record<string, V>[];'), 2);
  });

  it('E104-06-neg readonly 修饰符形态（[ 不在字段名 Ident 期望位，判定顺序第 4 条不命中）→ E100 锚 [ 1:21', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = { readonly [K in Keys]: V };')), '100', 1, 21);
  });

  it('E104-06-pos readonly 作普通字段名合法（readonly 非保留名）→ ok', () => {
    expectOk(parseVfsl('type T = { readonly: string };'), 1);
  });

  it('E104-07-neg 标记实参内多层嵌套对象中的 mapped type → E104 锚 1:22', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = YMap<{ a: { [K in Keys]: V } }>;')), '104', 1, 22);
  });

  it('E104-07-pos 嵌套对象内 Record 替代 → ok', () => {
    expectOk(parseVfsl('type V = string; type T = YMap<{ a: Record<string, V> }>;'), 2);
  });

  it('E104-08-neg 联合成员内对象 mapped type → E104 锚 1:12', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = { [K in Keys]: V } | { x: string };')), '104', 1, 12);
  });

  it('E104-08-pos 联合成员内对象（普通字段）→ ok', () => {
    expectOk(parseVfsl('type V = string; type T = { key: V } | { x: string };'), 2);
  });
});

// ============================================================
// E105 — interface 声明族整族冻结（判定顺序第 1 条：模块层 / 类型位置遇
//        interface → E105，锚 interface 记号；含无 extends 形态）
// ============================================================
describe('E105 — interface 声明族禁止矩阵（v1-spec §4 判定顺序第 1 条，锚 interface 记号）', () => {
  it('E105-01-neg 无 extends 形态（整族冻结）→ E105 锚 1:1', () => {
    expectAnchored(expectSingleIssue(parseVfsl('interface A {}')), '105', 1, 1);
  });

  it('E105-01-pos 最接近合法写法：空对象 type 别名 → ok', () => {
    expectOk(parseVfsl('type A = {};'), 1);
  });

  it('E105-02-neg 带 extends 形态 → E105 锚 1:1', () => {
    expectAnchored(expectSingleIssue(parseVfsl('interface A extends B {}')), '105', 1, 1);
  });

  it('E105-02-pos extends B 的直接表达：type 别名引用 B → ok', () => {
    expectOk(parseVfsl('type B = string; type A = B;'), 2);
  });

  it('E105-03-neg 多继承形态（extends B, C）→ E105 锚 1:1', () => {
    expectAnchored(expectSingleIssue(parseVfsl('interface A extends B, C {}')), '105', 1, 1);
  });

  it('E105-03-pos 多继承合并成员的直接表达：对象字面量合并字段 → ok', () => {
    expectOk(parseVfsl('type B = string; type C = number; type A = { b: B; c: C };'), 3);
  });

  it('E105-04-neg 混模块：合法别名后遇 interface → E105 锚 2:1', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type A = string;\ninterface B {}')), '105', 2, 1);
  });

  it('E105-04-pos 混模块的合法版本（全部 type 别名）→ ok', () => {
    expectOk(parseVfsl('type A = string; type B = {};'), 2);
  });

  it('E105-05-neg 类型位置遇 interface（对象字段类型位）→ E105 锚 1:15', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = { a: interface B {} };')), '105', 1, 15);
  });

  it('E105-05-pos 类型位置引用已声明对象别名 → ok', () => {
    expectOk(parseVfsl('type B = {}; type T = { a: B };'), 2);
  });

  it('E105-06-neg 带成员方法形态（整族冻结，内部形状无关）→ E105 锚 1:1', () => {
    expectAnchored(expectSingleIssue(parseVfsl('interface A { foo(): void; }')), '105', 1, 1);
  });

  it('E105-06-pos 成员表达为对象字段 → ok', () => {
    expectOk(parseVfsl('type A = { foo: string };'), 1);
  });

  it('E105-07-neg 大小写变体 Interface 非保留名（§4/§6 大小写敏感）→ E301 锚 1:10，非 E105', () => {
    expectAnchored(expectSingleIssue(parseVfsl('type T = Interface;')), '301', 1, 10);
  });

  it('E105-07-pos Interface 可声明为普通别名并引用 → ok', () => {
    expectOk(parseVfsl('type Interface = string; type T = Interface;'), 2);
  });
});

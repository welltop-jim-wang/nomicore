/**
 * SA7 补充测试（issue #6 动态验证）——两类补充面：
 *
 * 1. 资源界 / 必终止 / 声明序不变性（SA1 设计 §11 登记的 SA7 动态验证位）：
 *    - T-l（§11.1）：20k 裸引用链 + Record 键 → ok:true（迭代图查询栈安全回归，
 *      兼 SA2 #7 运行时栈安全动态验证位）；
 *    - T-R2-4 / T-R2-5（§11.3）：k=40 / k=21 E302 双体深链 → 有限时间正常返回
 *      ok:false E302@(2,6)（R2 旧多体递归在此输入 3·2^k 步挂起；T-R2-5 另断言 <1s）；
 *    - T-R3-2（§11.4）：声明序不变性——模块 2/3 行互换产出完全相同的错误码与位置；
 *    - T-R4-1 / T-R4-2（§11.4）：容器介导环分辨位——错误身份归还 E106@回边，
 *      不误报 E304@YMap（分量池顶层分解口径）。
 *
 * 2. fuzz 烟雾（SA4 动态审核重点 #3）：固定种子确定性随机输入（记号汤 + 合法
 *    fixture 截断/变异），断言 parseVfsl 永不抛异常、返回形状恒为 PRD #3 冻结的
 *    二态 union、且顶层兜底通道（VFSL-E100: 内部错误）永不被触达——该通道命中
 *    即实现缺陷（index.ts 注记），不得视为通过。
 *
 * 全部断言经公共接缝 parseVfsl 运行时行为，无源码 grep（SA4 §1.7）。
 */
import { describe, expect, it } from 'vitest';
import { parseVfsl } from '../src/index.js';

type ParseResult =
  | { ok: true; module: unknown }
  | { ok: false; issues: { message: string; line: number; column: number }[] };

type Issue = { message: string; line: number; column: number };

/** 断言 ok:false、issues 恰含 1 条（#5 冻结：单一 issue + min-position 聚合）。 */
function expectSingleIssue(result: ParseResult): Issue {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error(`期望 ok: false，实际 ok: true（module: ${JSON.stringify(result.module)}）`);
  }
  expect(result.issues).toHaveLength(1);
  const issue = result.issues[0];
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

/** 断言错误码前缀 + 精确锚点行列（规格 §4 定位锚冻结）。 */
function expectIssueAt(issue: Issue, code: string, line: number, column: number): void {
  expect(issue.message).toMatch(new RegExp(`^VFSL-E${code}: `));
  expect(issue.line).toBe(line);
  expect(issue.column).toBe(column);
}

describe('SA7 补充 — 资源界 / 必终止 / 声明序不变性（设计 §11 SA7 动态验证位）', () => {
  it('T-l：20k 裸引用链 + Record 键 → ok:true（栈安全回归，无 RangeError、无挂起）', () => {
    const lines: string[] = ['type A0 = string;'];
    for (let i = 1; i <= 20000; i += 1) {
      lines.push(`type A${i} = A${i - 1};`);
    }
    lines.push('type R = Record<A20000, string>;');
    lines.push('type ROOT = {};'); // #19：ROOT 在场消 E310，断言意图不变
    const result = parseVfsl(lines.join('\n'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 深链产物仍须满足 PRD #3：IR 可 JSON 序列化
      expect(JSON.parse(JSON.stringify(result.module))).toEqual(result.module);
    }
  });

  it('T-R2-4：k=40 E302 双体深链 → 有限时间正常返回 ok:false E302@(2,6)', () => {
    const lines: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      lines.push(`type B${i} = B${i + 1};`);
      lines.push(`type B${i} = B${i + 1};`);
    }
    lines.push('type B40 = string;');
    lines.push('type R = Record<B0, string>;');
    lines.push('type ROOT = {};');
    expect(lines).toHaveLength(83); // 设计 §11.3 登记口径：2k+2+ROOT 行（#19 对齐口径：2k+2 声明行 + 1 根行）
    const issue = expectSingleIssue(parseVfsl(lines.join('\n')));
    // min-position 胜出锚 = B0 的第二条声明（strCls(B0)=true → 无 E306 竞争）
    expectIssueAt(issue, '302', 2, 6);
  });

  it('T-R2-5：k=21 同构双体链 → 同码同位 E302@(2,6)，且耗时 < 1s（防大输入凑巧线性）', () => {
    const lines: string[] = [];
    for (let i = 0; i < 21; i += 1) {
      lines.push(`type B${i} = B${i + 1};`);
      lines.push(`type B${i} = B${i + 1};`);
    }
    lines.push('type B21 = string;');
    lines.push('type R = Record<B0, string>;');
    lines.push('type ROOT = {};');
    const started = Date.now();
    const issue = expectSingleIssue(parseVfsl(lines.join('\n')));
    expect(Date.now() - started).toBeLessThan(1000);
    expectIssueAt(issue, '302', 2, 6);
  });

  it('T-R3-2：声明序不变性——2/3 行互换后两模块同报 E304@YMap@(1,10)', () => {
    const moduleA = 'type X = YMap<T>;\ntype T = U1;\ntype U1 = T | number;\ntype ROOT = {};';
    const moduleB = 'type X = YMap<T>;\ntype U1 = T | number;\ntype T = U1;\ntype ROOT = {};';
    const issueA = expectSingleIssue(parseVfsl(moduleA));
    const issueB = expectSingleIssue(parseVfsl(moduleB));
    expectIssueAt(issueA, '304', 1, 10);
    expectIssueAt(issueB, '304', 1, 10);
    // 「产出完全相同的错误码与位置」：消息全文亦须一致（两序同码同位同文）
    expect(issueB.message).toBe(issueA.message);
  });

  it('T-R4-1：容器介导环 → 错误身份归还 E106@A@(2,15)，不误报 E304@YMap（顶层分解分辨位）', () => {
    const issue = expectSingleIssue(parseVfsl('type T = YMap<A>;\ntype A = { x: A | number };\ntype ROOT = {};'));
    expectIssueAt(issue, '106', 2, 15);
  });

  it('T-R4-2：容器介导环 + 环外嵌套 ref（D 不入分量池）→ E106@A@(2,15)', () => {
    const issue = expectSingleIssue(
      parseVfsl('type T = YMap<A>;\ntype A = { x: A | D };\ntype D = number;\ntype ROOT = {};'),
    );
    expectIssueAt(issue, '106', 2, 15);
  });
});

/** 固定种子确定性 PRNG（mulberry32）——fuzz 输入可复现，无 Math.random/Date。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** noUncheckedIndexedAccess 口径下的受检随机取元素（越界/undefined 即抛——确定性 PRNG 下不会发生）。 */
function pickFrom<T>(items: readonly T[], rand: () => number): T {
  const item = items[Math.floor(rand() * items.length)];
  if (item === undefined) {
    throw new Error('pickFrom 越界（items 为空或 rand 返回值异常）');
  }
  return item;
}

/** fuzz 记号汤字母表：方言记号 + 标记（含大小写变体）+ 字面量 + 结构符 + 空白。 */
const TOKENS = [
  'type', 'A', 'B', 'x', 'y', '=', ';', '{', '}', '<', '>', '[', ']', '|', '&',
  '?', ':', ',', '(', ')', '.', '\\', '/', '-', 'string', 'number', 'boolean',
  'YMap', 'YArray', 'YPlainArray', 'YLeaf', 'YXmlFragment', 'Pattern', 'Record',
  'yleaf', 'YLEaf', 'ymap', 'YMAP', '"a"', '"^[a-z]+$"', '"["', '1', 'true',
  '@semantic', '中', '\n', ' ', ' ', '\n',
];

/** 合法 fixture 池（变异源）：覆盖六标记 / Record / 交叉 / 嵌套 / 前向引用。
 *  #19 勘误（SA2 LOW-1）：第 1~5 条完整 fixture（含 ROOT）确定性 ok:true（≥5 次，
 *  保证下方 okTrue > 0 不依赖种子）；第 6 条引用未声明 M → E301、第 7 条
 *  YPlainArray<A>（A 含 YMap）→ E307，整条为 ok:false，贡献 ok:false 支路。 */
const FIXTURES = [
  'type A = YMap<{ x: string }>; type B = YArray<number>;\ntype ROOT = {};',
  'type A = YPlainArray<YLeaf<string>>; type C = string[];\ntype ROOT = {};',
  'type AssetId = string & Pattern<"^[A-Za-z0-9_\\\\-]{1,64}$">;\ntype R = Record<AssetId, number>;\ntype ROOT = {};',
  'type R = Record<string, number>; type P = Record<string & Pattern<"\\\\d+">, string>;\ntype ROOT = {};',
  'type Inner = { x: YLeaf<string> };\ntype M = YMap<Record<string, YLeaf<Inner>>>;\ntype ROOT = {};',
  'type Doc = YXmlFragment<{ assets: Record<string, M>; notes?: YLeaf<string> }>;\ntype ROOT = {};',
  'type A = YMap<{ x: string }>;\ntype B = YPlainArray<A>;\ntype ROOT = {};',
];

/** 单输入契约自检：不抛异常 + 二态 union + 冻结字段形状 + 兜底通道未被触达。 */
function assertParseContract(input: string): boolean {
  let result: unknown;
  try {
    result = parseVfsl(input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`parseVfsl 抛异常（违反不抛错契约）: ${msg}；input=${JSON.stringify(input)}`);
  }
  const r = result as { ok?: unknown; module?: unknown; issues?: unknown };
  if (r === null || typeof r !== 'object' || !('ok' in r)) {
    throw new Error(`返回非二态 union: ${JSON.stringify(result)}；input=${JSON.stringify(input)}`);
  }
  if (r.ok === true) {
    // ok:true 支：module 必须可 JSON 无损往返（PRD #3 冻结）
    expect(JSON.parse(JSON.stringify(r.module))).toEqual(r.module);
    return true;
  }
  if (r.ok !== false) {
    throw new Error(`ok 字段非布尔: ${JSON.stringify(r.ok)}；input=${JSON.stringify(input)}`);
  }
  const issues = r.issues;
  if (!Array.isArray(issues) || issues.length === 0) {
    throw new Error(`ok:false 但 issues 非非空数组: ${JSON.stringify(issues)}；input=${JSON.stringify(input)}`);
  }
  for (const raw of issues) {
    const issue = raw as Partial<Issue>;
    expect(typeof issue.message).toBe('string');
    expect(issue.message).toMatch(/^VFSL-E\d{3}: /);
    // 顶层兜底通道（index.ts 最终防线）命中 = 实现缺陷，不得视为通过
    expect(issue.message).not.toMatch(/^VFSL-E\d{3}: 内部错误/);
    expect(Number.isInteger(issue.line)).toBe(true);
    expect(issue.line).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(issue.column)).toBe(true);
    expect(issue.column).toBeGreaterThanOrEqual(1);
  }
  return false;
}

describe('SA7 补充 — fuzz 烟雾（SA4 动态审核重点 #3：不抛异常 / 二态 union / 兜底通道不可达）', () => {
  it('记号汤：3000 组种子随机输入全部落契约内', () => {
    const rand = mulberry32(20260819);
    let okTrue = 0;
    let okFalse = 0;
    for (let iter = 0; iter < 3000; iter += 1) {
      const length = Math.floor(rand() * 121); // 0..120 个记号
      const parts: string[] = [];
      for (let t = 0; t < length; t += 1) {
        parts.push(pickFrom(TOKENS, rand));
      }
      // #19：固定后缀 `type ROOT = {};`——TOKENS 字母表无 ROOT 记号，缺后缀时纯随机
      // 汤不可能再产出 ok:true（E310 落地后），双支路断言必红；加后缀后空汤
      // （length===0，固定种子下 26 次）确定性触达 ok:true 支路。
      if (assertParseContract(parts.join('') + '\ntype ROOT = {};')) okTrue += 1;
      else okFalse += 1;
    }
    // 两侧支路（ok:true / ok:false）均须被真实触达，防「全落一侧」的空转烟雾
    expect(okTrue).toBeGreaterThan(0);
    expect(okFalse).toBeGreaterThan(0);
    expect(okTrue + okFalse).toBe(3000);
  });

  it('fixture 变异/截断：3000 组 + 全前缀截断全部落契约内', () => {
    const rand = mulberry32(62026081);
    const chars: readonly string[] = TOKENS.join('').split('');
    let okTrue = 0;
    let okFalse = 0;
    const check = (input: string): void => {
      if (assertParseContract(input)) okTrue += 1;
      else okFalse += 1;
    };
    for (let iter = 0; iter < 3000; iter += 1) {
      const fixture = pickFrom(FIXTURES, rand);
      let mutated = fixture;
      const ops = 1 + Math.floor(rand() * 3); // 1..3 步变异
      for (let op = 0; op < ops; op += 1) {
        const kind = rand();
        if (kind < 0.4 && mutated.length > 0) {
          // 截断
          mutated = mutated.slice(0, Math.floor(rand() * mutated.length));
        } else if (kind < 0.6 && mutated.length > 0) {
          // 删字符
          const at = Math.floor(rand() * mutated.length);
          mutated = mutated.slice(0, at) + mutated.slice(at + 1);
        } else if (kind < 0.8) {
          // 插入随机字符
          const at = Math.floor(rand() * (mutated.length + 1));
          mutated = mutated.slice(0, at) + pickFrom(chars, rand) + mutated.slice(at);
        } else {
          // 片段复制
          const from = Math.floor(rand() * mutated.length);
          const to = from + Math.floor(rand() * (mutated.length - from + 1));
          mutated = mutated + mutated.slice(from, to);
        }
      }
      check(mutated);
    }
    // 系统性全前缀截断（不依赖种子，覆盖 EOF/残缺输入面）
    for (const fixture of FIXTURES) {
      for (let end = 0; end <= fixture.length; end += 1) {
        check(fixture.slice(0, end));
      }
    }
    // 两侧支路（ok:true / ok:false）均须被真实触达，防「全落一侧」的空转烟雾
    expect(okTrue).toBeGreaterThan(0);
    expect(okFalse).toBeGreaterThan(0);
    expect(okTrue + okFalse).toBeGreaterThan(3000);
  });
});

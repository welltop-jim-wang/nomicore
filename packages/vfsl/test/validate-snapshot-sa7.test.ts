/**
 * SA7 补充测试（issue #21 动态验证，2026-08-20）——SA4 r1 §四 指出的测试覆盖缺口补样：
 * 无 WorkBudgetExceeded 触发样例、无 E100 路径样例、四类 pattern loud 消息仅间接覆盖两类。
 * 来源：SA7 动态验证探针（wiki/raw/task_vfsl-validate-snapshot_sa7_report.md），逐项实证后择优固化。
 * 说明：不触碰 SA6 冻结的 validate-snapshot.test.ts（设计 §13）；本文件为 SA7 新增补充面。
 */
import { describe, expect, it } from 'vitest';
import { parseVfsl, evaluate, validateSnapshot } from '../src/index.js';
import type { DerivedSchema } from '../src/index.js';

function ev(text: string): DerivedSchema {
  const p = parseVfsl(text);
  if (!p.ok) throw new Error('parse fail: ' + JSON.stringify(p.issues));
  const e = evaluate(p.module);
  if (!e.ok) throw new Error('evaluate fail: ' + JSON.stringify(e.issues));
  return e.derived;
}

function firstIssue(text: string, snap: Record<string, unknown>): { message: string; path: Array<string | number> } {
  const r = validateSnapshot(ev(text), snap);
  if (r.ok) throw new Error('expected ok:false');
  return r.issues[0]!;
}

describe('SA7 补充：四类 pattern loud 消息逐一触发（设计 §6.5；此前仅两类被间接覆盖）', () => {
  it('编译错：Pattern<"["> 到达校验位 → 无法编译 loud（ok:false + path）', () => {
    const i = firstIssue('type ROOT = { v: string & Pattern<"["> };', { v: 'x' });
    expect(i.message).toMatch(/^Pattern 正则无法编译：\/\[\/（.+）$/);
    expect(i.path).toEqual(['v']);
  });

  it.each([
    ['反向引用', 'type ROOT = { v: string & Pattern<"\\\\1"> };'],
    ['后行断言', 'type ROOT = { v: string & Pattern<"(?<=a)b"> };'],
    ['Unicode 属性转义', 'type ROOT = { v: string & Pattern<"\\\\p{L}"> };'],
    ['内联标志', 'type ROOT = { v: string & Pattern<"(?i)a"> };'],
  ])('子集外构造：%s → 不支持的构造 loud', (_name, text) => {
    const i = firstIssue(text, { v: 'x' });
    expect(i.message).toMatch(/^Pattern 正则含匹配器不支持的构造：.+（子集清单见设计 §6.2）$/);
    expect(i.path).toEqual(['v']);
  });

  it('编译期程序规模超限：a{1,99999} 量词展开 > 10000 指令 loud（消息不携带运行期上下文）', () => {
    const i = firstIssue('type ROOT = { v: string & Pattern<"a{1,99999}"> };', { v: 'a' });
    expect(i.message).toMatch(/^Pattern 正则程序规模超限：\/a\{1,99999\}\/ 编译产物超过 10000 指令（量词展开 \d+ 份）$/);
    expect(i.path).toEqual(['v']);
  });

  it('匹配步数预算耗尽：(?=.*;)z × 5000 码元 → 4M 钳制 loud（「无法判定」，非「不匹配」）', () => {
    const i = firstIssue('type ROOT = { v: string & Pattern<"(?=.*;)z"> };', { v: 'x'.repeat(5000) });
    expect(i.message).toBe('Pattern 匹配步数预算耗尽（输入长度 5000，预算 4000000）：无法在预算内判定匹配性');
    expect(i.path).toEqual(['v']);
  }, 10_000);

  it('使用时暴露对照：非法正则挂 optional 缺席 / 空 Record / 空数组 → 不编译不暴露 ok:true（冻结语义）', () => {
    expect(validateSnapshot(ev('type ROOT = { s?: string & Pattern<"["> };'), {}).ok).toBe(true);
    expect(validateSnapshot(ev('type ROOT = { m: Record<string, string & Pattern<"[">> };'), { m: {} }).ok).toBe(true);
    expect(validateSnapshot(ev('type Id = string & Pattern<"[">;\ntype ROOT = { a: Id[] };'), { a: [] }).ok).toBe(true);
  });
});

describe('SA7 补充：全局工作预算 WorkBudgetExceeded（设计 §3.4——首次动态触发的持久锚定）', () => {
  function wideUnionSchema(members: number): string {
    const parts: string[] = [];
    for (let i = 0; i < members; i++) parts.push('{ k: "m' + i + '"; v: string }');
    return 'type U = ' + parts.join(' | ') + ';\ntype ROOT = { m: Record<string, U> };';
  }
  function bigRecord(keys: number): Record<string, unknown> {
    const inner: Record<string, unknown> = {};
    for (let i = 0; i < keys; i++) inner['k' + i] = 'zzz';
    return { m: inner };
  }

  it('预算内照常完成（WORK_LIMIT 是上界不是配额）：100k 键 × 120 成员联合 → 101 条截断输出', () => {
    const d = ev(wideUnionSchema(120));
    const r = validateSnapshot(d, bigRecord(100_000));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toHaveLength(101);
      expect(r.issues[100]!.message).toBe('校验问题超出 100 条上限，输出已截断（truncated）：另有 199900 处问题未报告');
    }
  }, 60_000);

  it('超预算 loud fail-closed：900k 键 × 120 成员联合（≈2.2×10⁸ 单位 > 2×10⁸）→ 单条预算耗尽 issue', () => {
    const d = ev(wideUnionSchema(120));
    const r = validateSnapshot(d, bigRecord(900_000));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toHaveLength(1); // 不进 emit 通道、无截断标记
      const msg = r.issues[0]!.message;
      expect(msg).toMatch(/^校验工作预算耗尽（全局已执行 \d+ 工作单位，上限 200000000）：无法在预算内完成整份校验$/);
      expect(Number(msg.match(/全局已执行 (\d+) 工作单位/)![1])).toBeGreaterThan(200_000_000);
      expect(r.issues[0]!.path).toEqual([]);
      expect(msg).not.toContain('VFSL-E100'); // 三重可区分：非 E100、非截断标记、非单次 Pattern 预算
      expect(msg).not.toContain('truncat');
      expect(msg).not.toContain('Pattern');
    }
  }, 300_000);
});

describe('SA7 补充：崩溃边界 E100 收编（设计 §10 R3——RangeError 触发面）', () => {
  it('深 ref 链（解析后深度 3×10⁴，表达式嵌套每层=2）× 等深快照 → RangeError 收编为单条 E100', () => {
    let text = 'type A0 = { x: string };\n';
    for (let i = 1; i <= 30_000; i++) text += 'type A' + i + ' = { x: A' + (i - 1) + ' };\n';
    text += 'type ROOT = A30000;';
    let snap: unknown = { x: 's' };
    for (let i = 0; i < 30_000; i++) snap = { x: snap };
    const r = validateSnapshot(ev(text), snap);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toHaveLength(1);
      expect(r.issues[0]!.message).toMatch(/^VFSL-E100: 内部错误（意外异常）: /);
      expect(r.issues[0]!.path).toEqual([]);
    }
  }, 120_000);
});

describe('SA7 补充：memo 65,536 封顶清空重建后正确性（设计 §3.4）', () => {
  it('70k distinct (节点,值) 对 → 封顶多次重建，输出仍精确（101 条 + 截断计数 300）', () => {
    const d = ev('type ROOT = { m: Record<string, string | number | boolean | null> };');
    const inner: Record<string, unknown> = {};
    for (let i = 0; i < 69_800; i++) inner['k' + i] = i; // 合法 number，全 distinct → memo miss
    for (let i = 0; i < 200; i++) inner['bad' + i] = {}; // 每键汇总+下钻 2 issue → 溢出
    const r = validateSnapshot(d, { m: inner });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toHaveLength(101);
      expect(r.issues[100]!.message).toBe('校验问题超出 100 条上限，输出已截断（truncated）：另有 300 处问题未报告');
    }
  }, 30_000);
});

describe('SA7 补充：SA2 R2-1 前瞻攻击构造回归锚（设计 §6.4 包络表 202 行）', () => {
  it('(?=.*;)z × 202 码元（包络内）→ 完成且真值匹配 ok:true', () => {
    const d = ev('type ROOT = { name: string & Pattern<"(?=.*;)z"> };');
    expect(validateSnapshot(d, { name: 'x'.repeat(200) + 'z' + ';' }).ok).toBe(true);
  }, 10_000);

  it('lookMemo 稀疏物化：200 条空前瞻 × 10⁷ 码元 → 4M 钳制 loud，无 GB 级内存面（毫秒级返回）', () => {
    const d = ev('type ROOT = { v: string & Pattern<"' + '(?=)'.repeat(200) + 'z"> };');
    const r = validateSnapshot(d, { v: 'a'.repeat(10_000_000) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]!.message).toBe('Pattern 匹配步数预算耗尽（输入长度 10000000，预算 4000000）：无法在预算内判定匹配性');
    }
  }, 60_000);
});

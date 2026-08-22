/**
 * 设计强制守卫测试 B（issue #54 / H3，SA3 实现；R2 新增——SA2 A2 + N1）——
 * getCompiled 崩溃边界（INV-6 / D11）与冻结缓存条目 × 校验接缝等价（D4.3 / N1）。
 *
 * 依据：task_docscope-compile-cache_design.md §5.5。断言形态（永不 throw /
 * ENV-100 / 冻结≡新鲜 toEqual）为设计冻结项；fixture 具体值为 SA3 实现自由度
 * （validatePatch path 按实际签名 `Array<string | number>` 落地为 ['a']，
 * SA2 R2-N2 实现提示）。
 */
import { describe, expect, it } from 'vitest';
import { evaluate, getCompiled, parseVfsl, validatePatch, validateLogicalSnapshot } from '../src/index.js';
import type { DerivedSchema } from '../src/index.js';

// RT-2（SA2 A2）：getCompiled 崩溃边界结构性承诺——任意输入（含对抗面）永不 throw，
// 恒返回 ok 联合。正常路径无可抛点，此测试锚定的是全函数体兜底的结构存在性
// （R1「仅包 gate」形态下，文本通道兜底缺席——对抗面用例即结构回归锚）。
describe('getCompiled — 崩溃边界（INV-6 / D11，SA2 A2）', () => {
  /** 断言「要么 ok 要么 ok:false」，绝不 throw（测试本体承载：throw 即败）。 */
  function okOrRejected(r: unknown): void {
    expect(r === null || r === undefined).toBe(false);
    expect(typeof (r as { ok?: unknown }).ok).toBe('boolean');
  }

  it('深嵌套边界（MAX_TYPE_NESTING=100 上下）不外抛：合法侧 ok、越界侧 ok:false', () => {
    const nest = (n: number): string =>
      `type ROOT = ${'{ a: '.repeat(n)}number${'}'.repeat(n)};`;
    for (const n of [98, 100, 120]) { // 合法/边界/越界三档（SA2 R2-N3：n=100 为最大合法边界）
      okOrRejected(getCompiled(nest(n)));
    }
  });

  it('超长文本（~64KB 混合注释与字段）不外抛', () => {
    const comment = `/** ${'x'.repeat(52000)} */ `;
    const fields = Array.from({ length: 1000 }, (_, i) => `f${i}: string; `).join('');
    const text = `${comment}type ROOT = { ${fields}};`;
    expect(text.length).toBeGreaterThan(60000); // fixture 自检：确实 ~64KB
    okOrRejected(getCompiled(text));
  });

  it('lone surrogate 文本（RT-1 fixture）不外抛', () => {
    for (const text of [
      '/** note \uD800 */ type ROOT = { a: string; };', // 藏身处 1：doc 注释
      'type ROOT = { a: "\uDC00"; };', // 藏身处 2：字符串字面量
    ]) {
      okOrRejected(getCompiled(text));
    }
  });

  it('对抗 getter 信封（读取即抛）→ ENV-100 结构化返回（kind:envelope / code:100），绝不外抛', () => {
    const adversarial: unknown = { get lang() { throw new Error('adversarial'); } };
    const r = getCompiled(adversarial as never);
    expect(r.ok).toBe(false);
    const first = (
      r as unknown as { ok: false; issues: [{ kind: string; issue: { code: string } }] }
    ).issues[0];
    expect(first.kind).toBe('envelope');
    expect(first.issue.code).toBe('100'); // ENV-100（H1 §6 同款崩溃边界）
  });
});

// RT-3（SA2 N1）：深冻结缓存条目喂给校验接缝 ≡ 新鲜 derived——锚定「冻结对校验器
// 零行为差异」。若校验器存在就地变异（如原地 sort），冻结条目会在其内部抛
// TypeError → E100 → 与新鲜路径结果分叉，本测试即红。
describe('getCompiled — 冻结条目 × 校验接缝等价（D4.3 / SA2 N1）', () => {
  const TEXT = 'type ROOT = { a: string; b?: number; };';
  const SNAPSHOT_OK = { a: 'x' };
  const SNAPSHOT_BAD = { a: 1 }; // 值类型违例（拒绝分支）

  /** 新鲜直编（不经缓存）：缓存条目路径的等价对照基准。 */
  function freshDerived(): DerivedSchema {
    const p = parseVfsl(TEXT);
    expect(p.ok).toBe(true);
    if (!p.ok) throw new Error(`fixture 自检失败（parseVfsl）: ${JSON.stringify(p.issues)}`);
    const e = evaluate(p.module);
    expect(e.ok).toBe(true);
    if (!e.ok) throw new Error(`fixture 自检失败（evaluate）: ${JSON.stringify(e.issues)}`);
    return e.derived;
  }

  /** 经缓存命中取得冻结 derived（深冻结，D4.3）。 */
  function cachedDerived(): DerivedSchema {
    const cached = getCompiled(TEXT);
    expect(cached.ok).toBe(true);
    if (!cached.ok) throw new Error(`fixture 自检失败（getCompiled）: ${JSON.stringify(cached.issues)}`);
    return cached.derived;
  }

  it('validateLogicalSnapshot(缓存条目.derived) ≡ validateLogicalSnapshot(新鲜 derived)（ok 与拒绝两分支）', () => {
    const cached = cachedDerived();
    const fresh = freshDerived();
    for (const snap of [SNAPSHOT_OK, SNAPSHOT_BAD]) {
      expect(validateLogicalSnapshot(cached, snap)).toEqual(validateLogicalSnapshot(fresh, snap));
    }
  });

  it('validatePatch 同款等价（结构守卫 + 重建校验路径，拒绝分支含）', () => {
    const cached = cachedDerived();
    const fresh = freshDerived();
    const base = { a: 'old' };
    for (const value of ['new', 42]) { // 合法替换（a: string）与类型违例（拒绝分支）
      expect(validatePatch(cached, base, ['a'], value)).toEqual(validatePatch(fresh, base, ['a'], value));
    }
  });
});

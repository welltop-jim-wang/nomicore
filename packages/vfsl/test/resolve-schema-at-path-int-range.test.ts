/**
 * SA6 绿→保持绿契约 — issue #315 C6b：readData 投影对 Int/Range 标量叶透传（ADR 0020 决策 8）。
 *
 * `resolveSchemaAtPath` 的值树匹配对本票新叶子是**终态**：`['b']` 原样透传 int 叶、
 * `['e']` / `['e', 0]` 数组与元素透传、越段不可下钻 → 既有 `SCHEMA_PATH_NOT_FOUND`
 * （**零新增拒绝路径与失败码**，ADR 0016 两失败码冻结）。
 *
 * #316 覆盖补强（SA6 §12.4 C3b，本文件加法式扩展，既有 7 条断言与既有字段 a~e/p/q 零改动）：
 * FIXTURE 增补 int/range 容器侧（`u`/`r`）与**无命名碰撞**的 pattern 配对面
 * （`pp`/`ppe`/`ppr`/`ppu`），以 7 组配对断言证明 AC3 的字面表述「与 pattern 叶同构」
 * ——逐组同 ok 性、同失败码、同 path 新鲜回显；并断言失败码集合 ⊆ 两枚冻结码。
 *
 * 断言纪律：只观察公共接缝 `resolveSchemaAtPath` 的运行时输出（结果联合 + valueSchema 深等）；
 * 不 skip / 不软化 / 不 grep 源码。
 */
import { describe, expect, it } from 'vitest';
import { evaluate, parseVfsl, resolveSchemaAtPath } from '../src/index.js';
import type { DerivedSchema } from '../src/index.js';

/** SA6 §12.1 规范 fixture（#316 按 T-3 追加 u/r 与 pattern 配对面 pp/ppe/ppr/ppu）。 */
const FIXTURE = `type ROOT = YMap<{
  a: number & Int;
  b: number & Int<1, 100>;
  c: number & Range<0.5, 1.5>;
  d: number & Range<-40, 85>;
  e: number & Int<0, 9>[];
  p: number & Int<1, 1>;
  q: number & Range<0, 0>;
  u: number & Int<1, 3> | string;
  r: Record<string, number & Int<0, 9>>;
  pp: string & Pattern<"^a+$">;
  ppe: string & Pattern<"^a+$">[];
  ppr: Record<string, string & Pattern<"^a+$">>;
  ppu: string & Pattern<"^a+$"> | number;
}>;
`;

/** 文本 → parse → evaluate → derived（红因诊断：携带实际 issues）。 */
function derive(): DerivedSchema {
  const parsed = parseVfsl(FIXTURE);
  if (!parsed.ok) {
    throw new Error(`期望 parseVfsl ok:true，实际 issues: ${JSON.stringify(parsed.issues)}`);
  }
  const evaluated = evaluate(parsed.module);
  if (!evaluated.ok) {
    throw new Error(`期望 evaluate ok:true，实际 issues: ${JSON.stringify(evaluated.issues)}`);
  }
  return evaluated.derived;
}

const DERIVED = derive();

/** 期望投影成功并返回 valueSchema（红因诊断：携带实际失败码）。 */
function projectedValueSchema(path: Array<string | number>): unknown {
  const result = resolveSchemaAtPath(DERIVED, path);
  if (!result.ok) {
    throw new Error(`期望 ok:true，实际 code=${result.code} path=${JSON.stringify(result.path)}`);
  }
  return result.valueSchema;
}

describe('C6b — Int/Range 值叶透传（标量终态，无新增拒绝路径）', () => {
  it("['a'] → {kind:'int'}（裸 Int 条件键缺席）", () => {
    const schema = projectedValueSchema(['a']) as Record<string, unknown>;
    expect(schema).toEqual({ kind: 'int' });
    expect(Object.keys(schema)).toEqual(['kind']);
  });

  it("['b'] → {kind:'int',min:1,max:100} 深等透传", () => {
    expect(projectedValueSchema(['b'])).toEqual({ kind: 'int', min: 1, max: 100 });
  });

  it("['c'] → {kind:'range',min:0.5,max:1.5} 深等透传", () => {
    expect(projectedValueSchema(['c'])).toEqual({ kind: 'range', min: 0.5, max: 1.5 });
  });

  it("['d'] → 负端点 range 叶透传", () => {
    expect(projectedValueSchema(['d'])).toEqual({ kind: 'range', min: -40, max: 85 });
  });

  it("['e'] → array<int> 透传；['e',0] → 元素 int 叶透传", () => {
    expect(projectedValueSchema(['e'])).toEqual({
      kind: 'array',
      element: { kind: 'int', min: 0, max: 9 },
    });
    expect(projectedValueSchema(['e', 0])).toEqual({ kind: 'int', min: 0, max: 9 });
  });

  it("['b','x'] → ok:false, code 'SCHEMA_PATH_NOT_FOUND'（标量叶不可下钻；无新失败码）", () => {
    const result = resolveSchemaAtPath(DERIVED, ['b', 'x']);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('期望 ok:false');
    expect(result.code).toBe('SCHEMA_PATH_NOT_FOUND');
    expect(result.path).toEqual(['b', 'x']);
  });

  it("['e',0,'x'] → SCHEMA_PATH_NOT_FOUND（元素叶终态）", () => {
    const result = resolveSchemaAtPath(DERIVED, ['e', 0, 'x']);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('期望 ok:false');
    expect(result.code).toBe('SCHEMA_PATH_NOT_FOUND');
  });
});

// ───────────────────────── #316 C3b（T-3）：比较型同构 + 失败码集合 ─────────────────────────

/** 失败码冻结集（ADR 0016 / ADR 0020 决策 8：恰两枚，不新增拒绝路径）。 */
const FROZEN_CODES = ['SCHEMA_PATH_NOT_FOUND', 'SCHEMA_PATH_INVALID'] as const;
type FrozenCode = (typeof FROZEN_CODES)[number];

/** 失败观测：断言 ok:false 且 path 为调用方入参的新鲜副本（非同一引用），返回实际码。 */
function failureCode(path: readonly (string | number)[]): FrozenCode {
  const result = resolveSchemaAtPath(DERIVED, path);
  if (result.ok) throw new Error(`期望 ok:false，实际 ok:true：${JSON.stringify(path)}`);
  expect(result.path).toEqual([...path]);
  expect(result.path).not.toBe(path);
  return result.code;
}

/** 野段形状（非 string|number）：公共签名外输入，仅用于形状守卫配对断言。 */
const WILD_SEG = {} as unknown as string;

/** 7 组配对：int/range 侧 ↔ pattern 侧（同下钻段、同期望码；末组为野段形状）。 */
const PAIRED_FAILURES: ReadonlyArray<{
  readonly intRange: readonly (string | number)[];
  readonly pattern: readonly (string | number)[];
  readonly code: FrozenCode;
}> = [
  { intRange: ['b', 'x'], pattern: ['pp', 'x'], code: 'SCHEMA_PATH_NOT_FOUND' },
  { intRange: ['b', 0], pattern: ['pp', 0], code: 'SCHEMA_PATH_NOT_FOUND' },
  { intRange: ['e', 0, 'x'], pattern: ['ppe', 0, 'x'], code: 'SCHEMA_PATH_NOT_FOUND' },
  { intRange: ['e', 1, 0], pattern: ['ppe', 1, 0], code: 'SCHEMA_PATH_NOT_FOUND' },
  { intRange: ['u', 'x'], pattern: ['ppu', 'x'], code: 'SCHEMA_PATH_NOT_FOUND' },
  { intRange: ['r', 'k', 'x'], pattern: ['ppr', 'k', 'x'], code: 'SCHEMA_PATH_NOT_FOUND' },
  { intRange: ['b', WILD_SEG], pattern: ['pp', WILD_SEG], code: 'SCHEMA_PATH_INVALID' },
];

describe('C3b — int/range 叶与 pattern 叶比较型同构（终态/拒绝分类一致，码集合不越界）', () => {
  it("配对前提：['u'] union（首成员 int 叶）、['r','k'] int 叶；pattern 侧同形（断言非空转）", () => {
    expect(projectedValueSchema(['u'])).toEqual({
      kind: 'union',
      members: [
        { kind: 'int', min: 1, max: 3 },
        { kind: 'scalar', type: 'string' },
      ],
    });
    expect(projectedValueSchema(['r', 'k'])).toEqual({ kind: 'int', min: 0, max: 9 });
    expect(projectedValueSchema(['pp'])).toEqual({ kind: 'pattern', regex: '^a+$' });
    expect(projectedValueSchema(['ppe', 0])).toEqual({ kind: 'pattern', regex: '^a+$' });
    expect(projectedValueSchema(['ppr', 'k'])).toEqual({ kind: 'pattern', regex: '^a+$' });
    expect(projectedValueSchema(['ppu'])).toEqual({
      kind: 'union',
      members: [
        { kind: 'pattern', regex: '^a+$' },
        { kind: 'scalar', type: 'number' },
      ],
    });
  });

  it.each(PAIRED_FAILURES)(
    '配对同构：$intRange ↔ $pattern 同码 $code（path 新鲜回显）',
    ({ intRange, pattern, code }) => {
      const intRangeCode = failureCode(intRange);
      const patternCode = failureCode(pattern);
      expect(intRangeCode).toBe(code);
      expect(patternCode).toBe(code);
      expect(intRangeCode).toBe(patternCode);
    },
  );

  it('失败码集合 ⊆ 两枚冻结码（覆盖既有失败例 + 7 组配对；不新增拒绝路径/失败码）', () => {
    const failurePaths: ReadonlyArray<readonly (string | number)[]> = [
      ['b', 'x'],
      ['e', 0, 'x'],
      ['b', 0],
      ['e', 1, 0],
      ['u', 'x'],
      ['r', 'k', 'x'],
      ['b', WILD_SEG],
      ['pp', 'x'],
      ['pp', 0],
      ['ppe', 0, 'x'],
      ['ppe', 1, 0],
      ['ppu', 'x'],
      ['ppr', 'k', 'x'],
      ['pp', WILD_SEG],
    ];
    const observed = new Set<FrozenCode>();
    for (const path of failurePaths) observed.add(failureCode(path));
    expect(observed.size).toBeGreaterThan(0);
    for (const code of observed) expect(FROZEN_CODES).toContain(code);
  });
});

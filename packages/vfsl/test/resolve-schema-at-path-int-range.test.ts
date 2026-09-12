/**
 * SA6 绿→保持绿契约 — issue #315 C6b：readData 投影对 Int/Range 标量叶透传（ADR 0020 决策 8）。
 *
 * `resolveSchemaAtPath` 的值树匹配对本票新叶子是**终态**：`['b']` 原样透传 int 叶、
 * `['e']` / `['e', 0]` 数组与元素透传、越段不可下钻 → 既有 `SCHEMA_PATH_NOT_FOUND`
 * （**零新增拒绝路径与失败码**，ADR 0016 两失败码冻结）。
 *
 * 断言纪律：只观察公共接缝 `resolveSchemaAtPath` 的运行时输出（结果联合 + valueSchema 深等）；
 * 不 skip / 不软化 / 不 grep 源码。
 */
import { describe, expect, it } from 'vitest';
import { evaluate, parseVfsl, resolveSchemaAtPath } from '../src/index.js';
import type { DerivedSchema } from '../src/index.js';

/** SA6 §12.1 规范 fixture。 */
const FIXTURE = `type ROOT = YMap<{
  a: number & Int;
  b: number & Int<1, 100>;
  c: number & Range<0.5, 1.5>;
  d: number & Range<-40, 85>;
  e: number & Int<0, 9>[];
  p: number & Int<1, 1>;
  q: number & Range<0, 0>;
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

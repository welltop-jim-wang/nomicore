/**
 * SA6 红→绿契约 — issue #315 C3/C4（ADR 0020 决策 5/6 + ADR 0021 决策 1/3；SA6 §12.4/§12.5）。
 *
 * C3：FIXTURE → parseVfsl ok → evaluate ok，断言 derived 两树（值叶形状 / 结构叶 / 字段名序 /
 * index 引用同一性 / docs 空表 / JSON 往返无 undefined 槽）。
 * C4：三形态逐值判定——合法矩阵（含双端点）、失配矩阵（path + 消息内容不变量）、四值基线
 * （NaN/±Infinity/-0 统一拒绝；裸 number 同口径负控）、全收集 100+截断、validatePatch 同口径
 * （共享解释器）、联合/数组集成（`contradictsInner` 类型级硬矛盾，`{v:true}` = 2 条）。
 *
 * 断言纪律（SA6 §12.0）：只观察公共接缝运行时输出（`parseVfsl` / `evaluate` /
 * `validateLogicalSnapshot` / `validatePatch`）；消息文案不进冻结面——除 C4d 明列的内容
 * 不变量（R1/R2/R3）外只断言码前缀、path、计数。不 skip / 不软化 / 不 grep 源码。
 */
import { describe, expect, it } from 'vitest';
import {
  evaluate,
  parseVfsl,
  validateLogicalSnapshot,
  validatePatch,
} from '../src/index.js';
import type { DerivedSchema, MapField, ValidateIssue } from '../src/index.js';

/** SA6 §12.1 规范 fixture（三形态 + 数组 + 单点区间）。 */
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
function derive(text: string): DerivedSchema {
  const parsed = parseVfsl(text);
  if (!parsed.ok) {
    throw new Error(`期望 parseVfsl ok:true，实际 issues: ${JSON.stringify(parsed.issues)}`);
  }
  const evaluated = evaluate(parsed.module);
  if (!evaluated.ok) {
    throw new Error(`期望 evaluate ok:true，实际 issues: ${JSON.stringify(evaluated.issues)}`);
  }
  return evaluated.derived;
}

const DERIVED = derive(FIXTURE);

/** ROOT 结构树字段项（结构叶断言锚）。 */
function structureFields(derived: DerivedSchema): MapField[] {
  const root = derived.structure;
  if (root.kind !== 'root') throw new Error(`structure 非 root：${root.kind}`);
  if (root.node.kind !== 'map') throw new Error(`ROOT 结构非 map：${root.node.kind}`);
  return root.node.fields;
}

function unit(name: string): MapField {
  const field = structureFields(DERIVED).find((f) => f.name === name);
  if (field === undefined) throw new Error(`结构字段缺失：${name}`);
  return field;
}

/** ROOT 值 schema 字段值（值叶断言锚）。 */
function valueOfField(name: string): unknown {
  const root = DERIVED.values['ROOT'];
  if (root === undefined) throw new Error('derived.values.ROOT 缺失');
  if (root.kind !== 'object') throw new Error(`ROOT 值 schema 非 object：${root.kind}`);
  const field = root.fields.find((f) => f.name === name);
  if (field === undefined) throw new Error(`值字段缺失：${name}`);
  return field.value;
}

/** C4a 合法基线（全字段在场且取值合法）。 */
const BASE: Record<string, unknown> = { a: 3, b: 1, c: 0.5, d: -40, e: [0, 9, 5], p: 1, q: 0 };

function snapshotWith(field: string, value: unknown): Record<string, unknown> {
  return { ...BASE, [field]: value };
}

/** 期望 ok:false 且恰 1 条 issue，返回该 issue（失配矩阵断言锚）。 */
function singleIssue(snapshot: unknown): ValidateIssue {
  const result = validateLogicalSnapshot(DERIVED, snapshot);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('期望 ok:false，实际 ok:true');
  expect(result.issues).toHaveLength(1);
  const issue = result.issues[0];
  if (issue === undefined) throw new Error('issues 数组为空');
  return issue;
}

/** 期望 ok:false 且恰 1 条 issue，返回该 issue（任意 derived）。 */
function singleIssueOf(derived: DerivedSchema, snapshot: unknown): ValidateIssue {
  const result = validateLogicalSnapshot(derived, snapshot);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('期望 ok:false，实际 ok:true');
  expect(result.issues).toHaveLength(1);
  const issue = result.issues[0];
  if (issue === undefined) throw new Error('issues 数组为空');
  return issue;
}

// ---------------------------------------------------------------------------
// C3 — derived 契约（实现前红 → 实现后绿）
// ---------------------------------------------------------------------------

describe('C3 — derived 两树：值叶 / 结构叶 / 字段名序 / 引用同一性 / docs / JSON 往返', () => {
  it('字段名序 = 声明序 a,b,c,d,e,p,q', () => {
    expect(structureFields(DERIVED).map((f) => f.name)).toEqual(['a', 'b', 'c', 'd', 'e', 'p', 'q']);
  });

  it('值叶形状：a/b/c/d/e/p/q 逐项深等（条件键缺席 = 整键不存在）', () => {
    expect(valueOfField('a')).toEqual({ kind: 'int' });
    expect(valueOfField('b')).toEqual({ kind: 'int', min: 1, max: 100 });
    expect(valueOfField('c')).toEqual({ kind: 'range', min: 0.5, max: 1.5 });
    expect(valueOfField('d')).toEqual({ kind: 'range', min: -40, max: 85 });
    expect(valueOfField('e')).toEqual({ kind: 'array', element: { kind: 'int', min: 0, max: 9 } });
    expect(valueOfField('p')).toEqual({ kind: 'int', min: 1, max: 1 });
    expect(valueOfField('q')).toEqual({ kind: 'range', min: 0, max: 0 });
  });

  it('裸 Int 值叶键集合恰 ["kind"]（无 min/max 槽——杀死静默丢键/补空槽）', () => {
    const value = valueOfField('a') as Record<string, unknown>;
    expect(Object.keys(value)).toEqual(['kind']);
    expect(Object.hasOwn(value, 'min')).toBe(false);
    expect(Object.hasOwn(value, 'max')).toBe(false);
  });

  it('结构树：int/range 与 pattern 同层标量叶（a..d/p/q = leaf；e = array<leaf>）', () => {
    for (const name of ['a', 'b', 'c', 'd', 'p', 'q']) {
      expect(unit(name).node).toEqual({ kind: 'leaf' });
    }
    expect(unit('e').node).toEqual({ kind: 'array', element: { kind: 'leaf' } });
  });

  it('index["ROOT.b"] = { match: "exact", node: 与结构字段同一对象引用 }', () => {
    const entry = DERIVED.index['ROOT.b'];
    expect(entry).toBeDefined();
    expect(entry?.match).toBe('exact');
    expect(entry?.node).toBe(unit('b').node);
  });

  it('docs 表：无 doc 时 ROOT / 各字段 / 标记位均为空数组（新叶子不新增或挪用锚）', () => {
    expect(DERIVED.aliasDocs['ROOT']).toEqual([]);
    expect(DERIVED.markerDocs['ROOT']).toEqual([]);
    for (const name of ['a', 'b', 'c', 'd', 'e', 'p', 'q']) {
      expect(DERIVED.fieldDocs[`ROOT.${name}`]).toEqual([]);
    }
    // 条件稀疏第八键：无成员 doc 时整键缺席
    expect(Object.hasOwn(DERIVED, 'memberDocs')).toBe(false);
  });

  it('JSON.parse(JSON.stringify(derived)) 与 derived 深度相等（无 undefined 键的静默丢键）', () => {
    expect(JSON.parse(JSON.stringify(DERIVED))).toEqual(DERIVED);
  });

  it('两次独立 derive 深度相等（同输入同输出）', () => {
    expect(derive(FIXTURE)).toEqual(DERIVED);
  });

  it('别名链无子终态内联（杀死 isNoChildTerminal 漏改）：int/range 别名在结构树为 leaf 而非 ref 终态', () => {
    const derived = derive(
      'type A = number & Int<1, 3>;\ntype B = number & Range<0, 1>;\ntype ROOT = YMap<{ v: A; w: B }>;\n',
    );
    const root = derived.structure;
    if (root.kind !== 'root' || root.node.kind !== 'map') throw new Error('ROOT 结构非 map');
    // F4 无子终态内联：新叶子与 primitive/literal/pattern 同层，不得落 ref 终态（两树漂移）
    expect(root.node.fields.map((f) => f.node)).toEqual([{ kind: 'leaf' }, { kind: 'leaf' }]);
    expect(derived.values['A']).toEqual({ kind: 'int', min: 1, max: 3 });
    expect(derived.values['B']).toEqual({ kind: 'range', min: 0, max: 1 });
  });
});

// ---------------------------------------------------------------------------
// C4a — validate 合法矩阵
// ---------------------------------------------------------------------------

describe('C4a — 合法矩阵：闭区间含双端点、整数可为负、数组元素边界', () => {
  it('全字段合法基线 → ok:true', () => {
    expect(validateLogicalSnapshot(DERIVED, BASE)).toEqual({ ok: true });
  });

  it('双端点批量合法（a=-3/0/3、b=1/100、c=0.5/1.5、d=-40/85、e=[0,9,5]、p=1、q=0）', () => {
    expect(validateLogicalSnapshot(DERIVED, snapshotWith('a', -3))).toEqual({ ok: true });
    expect(validateLogicalSnapshot(DERIVED, snapshotWith('a', 0))).toEqual({ ok: true });
    expect(validateLogicalSnapshot(DERIVED, snapshotWith('a', 3))).toEqual({ ok: true });
    expect(validateLogicalSnapshot(DERIVED, snapshotWith('b', 1))).toEqual({ ok: true });
    expect(validateLogicalSnapshot(DERIVED, snapshotWith('b', 100))).toEqual({ ok: true });
    expect(validateLogicalSnapshot(DERIVED, snapshotWith('b', 50))).toEqual({ ok: true });
    expect(validateLogicalSnapshot(DERIVED, snapshotWith('c', 0.5))).toEqual({ ok: true });
    expect(validateLogicalSnapshot(DERIVED, snapshotWith('c', 1.5))).toEqual({ ok: true });
    expect(validateLogicalSnapshot(DERIVED, snapshotWith('c', 1))).toEqual({ ok: true });
    expect(validateLogicalSnapshot(DERIVED, snapshotWith('d', -40))).toEqual({ ok: true });
    expect(validateLogicalSnapshot(DERIVED, snapshotWith('d', 85))).toEqual({ ok: true });
    expect(validateLogicalSnapshot(DERIVED, snapshotWith('d', 0))).toEqual({ ok: true });
    expect(validateLogicalSnapshot(DERIVED, snapshotWith('e', [0, 9, 5]))).toEqual({ ok: true });
    expect(validateLogicalSnapshot(DERIVED, snapshotWith('e', [0]))).toEqual({ ok: true });
    expect(validateLogicalSnapshot(DERIVED, snapshotWith('p', 1))).toEqual({ ok: true });
    expect(validateLogicalSnapshot(DERIVED, snapshotWith('q', 0))).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// C4b/C4c — validate 失配矩阵 + 四值基线
// ---------------------------------------------------------------------------

describe('C4b/C4c — 失配矩阵：path 逐例 + 四值（NaN/±Infinity/-0）统一拒绝', () => {
  const MISMATCHES: Array<{ field: string; label: string; value: unknown; path: Array<string | number> }> = [
    { field: 'a', label: '非整数', value: 1.5, path: ['a'] },
    { field: 'a', label: '-0', value: -0, path: ['a'] },
    { field: 'a', label: 'NaN', value: NaN, path: ['a'] },
    { field: 'a', label: 'Infinity', value: Infinity, path: ['a'] },
    { field: 'a', label: '-Infinity', value: -Infinity, path: ['a'] },
    { field: 'a', label: '字符串', value: '3', path: ['a'] },
    { field: 'a', label: 'null', value: null, path: ['a'] },
    { field: 'b', label: '低于下端点', value: 0, path: ['b'] },
    { field: 'b', label: '超出上端点', value: 101, path: ['b'] },
    { field: 'b', label: '非整数', value: 1.5, path: ['b'] },
    { field: 'b', label: '-0', value: -0, path: ['b'] },
    { field: 'b', label: 'NaN', value: NaN, path: ['b'] },
    { field: 'b', label: 'Infinity', value: Infinity, path: ['b'] },
    { field: 'b', label: '字符串', value: '50', path: ['b'] },
    { field: 'c', label: 'f64 相邻下越界', value: 0.4999999999999999, path: ['c'] },
    { field: 'c', label: 'f64 相邻上越界', value: 1.5000000000000002, path: ['c'] },
    { field: 'c', label: '-0', value: -0, path: ['c'] },
    { field: 'c', label: 'NaN', value: NaN, path: ['c'] },
    { field: 'c', label: '-Infinity', value: -Infinity, path: ['c'] },
    { field: 'c', label: '字符串', value: '0.5', path: ['c'] },
    { field: 'd', label: '负端点下越界', value: -40.00000000000001, path: ['d'] },
    { field: 'd', label: '上端点越界', value: 85.00000000000001, path: ['d'] },
    { field: 'e', label: '元素越界', value: [1, 2, 10], path: ['e', 2] },
    { field: 'e', label: '元素类型', value: [1, '2'], path: ['e', 1] },
    { field: 'p', label: '非单点值', value: 2, path: ['p'] },
    { field: 'q', label: '非单点值', value: 0.5, path: ['q'] },
  ];

  it.each(MISMATCHES)('$field = $label → ok:false，path $path，恰 1 条普通 issue', ({ field, value, path }) => {
    const issue = singleIssue(snapshotWith(field, value));
    expect(issue.path).toEqual(path);
    // R1：普通 issue（非崩溃收编、非预算终态）
    expect(issue.message.startsWith('VFSL-E100')).toBe(false);
    expect(issue.message).not.toContain('预算耗尽');
  });

  it('四值 + 非数在 c（range 形态）同样逐值拒绝（-0 经 Object.is 不被区间放过）', () => {
    for (const value of [-0, NaN, Infinity, -Infinity, '0.5', null]) {
      const issue = singleIssue(snapshotWith('c', value));
      expect(issue.path).toEqual(['c']);
    }
  });

  it('负控：裸 number 四值同口径拒绝、有限数放行（ADR 0021 统一基线不回归）', () => {
    const derived = derive('type ROOT = YMap<{ n: number }>;\n');
    expect(validateLogicalSnapshot(derived, { n: 0 })).toEqual({ ok: true });
    expect(validateLogicalSnapshot(derived, { n: -3.5 })).toEqual({ ok: true });
    for (const value of [-0, NaN, Infinity, -Infinity]) {
      const issue = singleIssueOf(derived, { n: value });
      expect(issue.path).toEqual(['n']);
      expect(issue.message.startsWith('VFSL-E100')).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// C4d — 消息内容不变量（R1/R2/R3；文案本身不冻结）
// ---------------------------------------------------------------------------

describe('C4d — 消息内容不变量：实际值渲染 / -0 ≠ 0 / 期望区间承载', () => {
  it('R2：message(-0) 含 "-0" 且 ≠ 同 schema 位 message(0)（Int<1,100> 下二者均失配）', () => {
    const minusZero = singleIssue(snapshotWith('b', -0));
    const zero = singleIssue(snapshotWith('b', 0));
    expect(minusZero.message).toContain('-0');
    expect(zero.message).not.toContain('-0');
    expect(minusZero.message).not.toBe(zero.message);
  });

  it('R3：b=101 的 message 含上端点 100；b=1.5 与 b=101 两条 message 互异', () => {
    const over = singleIssue(snapshotWith('b', 101));
    const fractional = singleIssue(snapshotWith('b', 1.5));
    expect(over.message).toContain('100');
    expect(fractional.message).not.toBe(over.message);
  });

  it('实际值渲染：101 / 1.5 / NaN / Infinity / -Infinity 各自成串', () => {
    expect(singleIssue(snapshotWith('b', 101)).message).toContain('101');
    expect(singleIssue(snapshotWith('b', 1.5)).message).toContain('1.5');
    expect(singleIssue(snapshotWith('a', NaN)).message).toContain('NaN');
    expect(singleIssue(snapshotWith('a', Infinity)).message).toContain('Infinity');
    expect(singleIssue(snapshotWith('a', -Infinity)).message).toContain('-Infinity');
  });

  // SA4 F-SA4-1 回归：裸 `number & Int`（min/max 双缺席）的有限非整数走整数性维消息，
  // 不得落入区间维模板而渲染 `undefined` 端点（设计 §8.4 冻结模板：裸形 = `期望整数，实际 …`）。
  it('F-SA4-1 回归：裸 Int（a=1.5）message 含「整数」且不含 "undefined"', () => {
    const bare = singleIssue(snapshotWith('a', 1.5));
    expect(bare.message).toContain('整数');
    expect(bare.message).not.toContain('undefined');
  });
});

// ---------------------------------------------------------------------------
// C4e — 全收集与预算
// ---------------------------------------------------------------------------

describe('C4e — 全收集：101 个越界元素 = 100 条 + 截断标记（非 fail-fast、非预算终态）', () => {
  it('e 长度 101 全越界 → ok:false，issues.length === 101（末条截断标记 path []）', () => {
    const result = validateLogicalSnapshot(DERIVED, snapshotWith('e', Array.from({ length: 101 }, () => 10)));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('期望 ok:false');
    expect(result.issues).toHaveLength(101);
    for (let i = 0; i < 100; i += 1) {
      expect(result.issues[i]?.path).toEqual(['e', i]);
    }
    const tail = result.issues[100];
    expect(tail?.path).toEqual([]);
    expect(tail?.message).toContain('另有 1 处问题未报告');
    // 预算终态可区分（普通 issue 集合，非全局预算耗尽）
    expect(result.issues.some((i) => i.message.includes('校验工作预算耗尽'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C4f — 写路径同口径（validatePatch 共享解释器）
// ---------------------------------------------------------------------------

describe('C4f — validatePatch 同口径（共享 validateSubtree 解释器，零旁路）', () => {
  it('patch ["b"]=101 → ok:false，path [b]', () => {
    const result = validatePatch(DERIVED, BASE, ['b'], 101);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('期望 ok:false');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.path).toEqual(['b']);
  });

  it('负控：patch ["b"]=50 → ok:true', () => {
    expect(validatePatch(DERIVED, BASE, ['b'], 50)).toEqual({ ok: true });
  });

  it('patch ["b"]=1（下端点）→ ok:true', () => {
    expect(validatePatch(DERIVED, BASE, ['b'], 1)).toEqual({ ok: true });
  });

  it('patch ["b"]=-0 → ok:false，path [b]', () => {
    const result = validatePatch(DERIVED, BASE, ['b'], -0);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('期望 ok:false');
    expect(result.issues[0]?.path).toEqual(['b']);
  });
});

// ---------------------------------------------------------------------------
// C4g — 联合/数组集成（杀死只改 validateValue 漏 contradictsInner 的实现）
// ---------------------------------------------------------------------------

describe('C4g — 联合成员集成：int 硬矛盾为类型级（B6 冻结）', () => {
  const UNION = derive('type ROOT = YMap<{ v: number & Int<1, 3> | string }>;\n');

  it('{v:2}（int 成员命中）与 {v:"x"}（string 成员命中）→ ok:true', () => {
    expect(validateLogicalSnapshot(UNION, { v: 2 })).toEqual({ ok: true });
    expect(validateLogicalSnapshot(UNION, { v: 'x' })).toEqual({ ok: true });
  });

  it('{v:5}（数值型但越界）→ ok:false，恰 1 条（候选分支下钻；值级模型会得 2 条）', () => {
    const result = validateLogicalSnapshot(UNION, { v: 5 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('期望 ok:false');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.path).toEqual(['v']);
  });

  it('{v:true} → ok:false，恰 2 条且首条含「不匹配任何联合成员」（contradictsInner 判别性用例）', () => {
    const result = validateLogicalSnapshot(UNION, { v: true });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('期望 ok:false');
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]?.message).toContain('不匹配任何联合成员');
    expect(result.issues[0]?.path).toEqual(['v']);
  });

  it('F-SA4-1 回归（联合候选下钻）：裸 Int 成员的非整数失配消息同样不含 "undefined"', () => {
    const bareUnion = derive('type ROOT = YMap<{ v: number & Int | string }>;\n');
    const result = validateLogicalSnapshot(bareUnion, { v: 1.5 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('期望 ok:false');
    expect(result.issues.length).toBeGreaterThanOrEqual(1);
    expect(result.issues[0]?.message).toContain('整数');
    for (const issue of result.issues) expect(issue.message).not.toContain('undefined');
  });

  it('数组元素位 int 形态逐元素判定（number & Int<1,3>[] → {v:[1,4]} path ["v",1]）', () => {
    const arrayUnion = derive('type ROOT = YMap<{ v: number & Int<1, 3>[] }>;\n');
    expect(validateLogicalSnapshot(arrayUnion, { v: [1, 2, 3] })).toEqual({ ok: true });
    const result = validateLogicalSnapshot(arrayUnion, { v: [1, 4] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('期望 ok:false');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.path).toEqual(['v', 1]);
  });
});

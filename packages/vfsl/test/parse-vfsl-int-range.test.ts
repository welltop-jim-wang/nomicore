/**
 * SA6 红→绿契约 — issue #315 C1/C2（ADR 0020 决策 1/2/4；SA6 §12.2/§12.3）。
 *
 * 三约束形态：`number & Int`（零参）/ `number & Int<min,max>` / `number & Range<min,max>`——
 * 在一切类型位置解析 → IR 叶子；`Int`/`Range` 进保留名集合（别名占用 E303、字段名位 E100、
 * 裸用 E100，镜像裸 `Pattern`）；arity 严格（`Int<5>` / `Int<1,2,3>` / `Range<0>` / `Int<>` /
 * 裸 `Range` → E100 锚构造起点记号）；Int 端点整数性按 f64 值判定（设计 §7.2 B1 冻结）；
 * 空区间（min > max，f64 比较）解析期 E100 锚构造起点；端点复用 #314 闸门（超双精度 / -0）。
 *
 * 断言纪律（SA6 §12.0）：只观察公共接缝 `parseVfsl` 的运行时返回（ok / IR 叶子形状 /
 * issue 的码 + 行列锚）；正例一律使用声明 ROOT 的完整模块；负例必须同时钉错误码 + 行列锚
 * （只断言 ok:false 不足以杀死过宽实现）；不 skip / 不软化 / 不 grep 源码。
 *
 * 锚位约定（SA6 §12.1）：MODULE(FORM) := `type ROOT = YMap<{ v: ${FORM} }>;`，FORM 起点
 * (1,23)、`&` 列 30、`Int`/`Range` 列 32。AST 节点 pos = `number` 记号（供 E304/E306/E311
 * 语义锚定，镜像 pattern pos = `string` 记号）；parser E100（arity/端点/空区间）锚
 * `Int`/`Range` 记号——两套锚不得混用（设计 §8.1 末注）。
 */
import { describe, expect, it } from 'vitest';
import { parseVfsl } from '../src/index.js';
import type { VfslField, VfslModule, VfslType } from '../src/index.js';

/** SA6 §12.1 规范模块：类型表达式起点恒 (1,23)。 */
const MODULE = (form: string): string => `type ROOT = YMap<{ v: ${form} }>;`;

interface Issue {
  message: string;
  line: number;
  column: number;
}

/** 期望 ok:true 并返回 IR 模块（红因诊断：携带实际 issues）。 */
function parseModuleOk(text: string): VfslModule {
  const result = parseVfsl(text);
  if (!result.ok) {
    throw new Error(`期望 ok:true，实际 issues: ${JSON.stringify(result.issues)}`);
  }
  expect(result.ok).toBe(true);
  return result.module;
}

/** 期望 ok:false、issues 恰 1 条，返回该 issue（单错误即失败契约）。 */
function parseIssue(text: string): Issue {
  const result = parseVfsl(text);
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error(`期望 ok:false，实际 ok:true（module: ${JSON.stringify(result.module)}）`);
  }
  expect(result.issues).toHaveLength(1);
  const issue = result.issues[0];
  if (issue === undefined) throw new Error('issues 数组为空');
  return issue;
}

/** ROOT 别名 `YMap<{ v: T }>` 中字段 `v` 的 AST/IR 字段项。 */
function rootField(module: VfslModule): VfslField {
  const root = module.aliases.find((a) => a.name === 'ROOT');
  if (root === undefined) throw new Error('ROOT 别名缺失');
  const marker = root.type;
  if (marker.kind !== 'marker') throw new Error(`ROOT 类型非 marker：${marker.kind}`);
  const arg = marker.arg;
  if (arg.kind !== 'object') throw new Error(`YMap 实参非对象形：${arg.kind}`);
  const field = arg.fields.find((f) => f.name === 'v');
  if (field === undefined) throw new Error('字段 v 缺失');
  return field;
}

/** ROOT 字段 `v` 的类型（IR 值断言锚）。 */
function rootFieldType(module: VfslModule): VfslType {
  return rootField(module).type;
}

// ---------------------------------------------------------------------------
// C1 — 正例：三形态解析 → IR 叶子（实现前红 → 实现后绿）
// ---------------------------------------------------------------------------

describe('C1 — 三形态作对象字段：ok + IR 叶子（整数 / 小数 / 负端点 / 单点区间）', () => {
  const FORMS: Array<{ form: string; ir: unknown }> = [
    { form: 'number & Int', ir: { kind: 'int' } },
    { form: 'number & Int<1, 100>', ir: { kind: 'int', min: 1, max: 100 } },
    { form: 'number & Int<-10, 10>', ir: { kind: 'int', min: -10, max: 10 } },
    { form: 'number & Int<1, 1>', ir: { kind: 'int', min: 1, max: 1 } },
    { form: 'number & Range<0, 1>', ir: { kind: 'range', min: 0, max: 1 } },
    { form: 'number & Range<0.5, 1.5>', ir: { kind: 'range', min: 0.5, max: 1.5 } },
    { form: 'number & Range<-40, 85>', ir: { kind: 'range', min: -40, max: 85 } },
    { form: 'number & Range<0, 0>', ir: { kind: 'range', min: 0, max: 0 } },
    {
      form: 'number & Int<0, 9>[]',
      ir: { kind: 'array', element: { kind: 'int', min: 0, max: 9 } },
    },
    // 设计 §7.2 B1 冻结：Int 端点整数性按 f64 值判定（文本形态不进 IR；U5 已接受）
    { form: 'number & Int<1.0, 2>', ir: { kind: 'int', min: 1, max: 2 } },
    { form: 'number & Int<2.0, 3.0>', ir: { kind: 'int', min: 2, max: 3 } },
  ];

  it.each(FORMS)('$form → ok，IR $ir', ({ form, ir }) => {
    const type = rootFieldType(parseModuleOk(MODULE(form)));
    expect(type).toEqual(ir);
  });

  it('number & Int（零参）：键集合恰 ["kind"]，min/max 整键缺席（条件键纪律）', () => {
    const type = rootFieldType(parseModuleOk(MODULE('number & Int')));
    expect(Object.keys(type)).toEqual(['kind']);
    expect(Object.hasOwn(type, 'min')).toBe(false);
    expect(Object.hasOwn(type, 'max')).toBe(false);
  });

  it('IR 无 undefined 槽：JSON 往返深度相等（条件键 = 整键不存在）', () => {
    const module = parseModuleOk(MODULE('number & Int<-10, 10>'));
    expect(JSON.parse(JSON.stringify(module))).toEqual(module);
  });

  const TRIVIA_FORMS = [
    'number&Int<1, 2>',
    'number  &  Int<1, 2>',
    'number & /*c*/ Int<1, 2>',
    'number & Int /*c*/ <1, 2>',
  ];

  it.each(TRIVIA_FORMS)('trivia 无关（无文本特判）：%s → IR int<1,2>', (form) => {
    expect(rootFieldType(parseModuleOk(MODULE(form)))).toEqual({ kind: 'int', min: 1, max: 2 });
  });

  it('跨行形态（换行 trivia）→ IR int<1,2>', () => {
    const text = 'type ROOT = YMap<{\n  v: number\n    & Int<1, 2>\n}>;\n';
    expect(rootFieldType(parseModuleOk(text))).toEqual({ kind: 'int', min: 1, max: 2 });
  });
});

describe('C1 — 全局位置：三形态在一切类型位置可达（无上下文特判）', () => {
  it('G1 别名 RHS：`type A = number & Int<1, 3>;` → A 的 IR 为 int 叶', () => {
    const module = parseModuleOk('type A = number & Int<1, 3>;\ntype ROOT = YMap<{ v: A }>;');
    const alias = module.aliases.find((a) => a.name === 'A');
    expect(alias?.type).toEqual({ kind: 'int', min: 1, max: 3 });
  });

  it('G2 Record 值位：`Record<string, number & Int<1, 3>>` → 值位 int 叶', () => {
    const type = rootFieldType(parseModuleOk('type ROOT = YMap<{ v: Record<string, number & Int<1, 3>> }>;'));
    expect(type.kind).toBe('record');
    if (type.kind !== 'record') throw new Error(`期望 record，实际 ${type.kind}`);
    expect(type.value).toEqual({ kind: 'int', min: 1, max: 3 });
  });

  it('G3 YLeaf 实参：`YLeaf<number & Int<1, 3>>` → 标记实参 int 叶（标量形容纳）', () => {
    const type = rootFieldType(parseModuleOk('type ROOT = YMap<{ v: YLeaf<number & Int<1, 3>> }>;'));
    expect(type.kind).toBe('marker');
    if (type.kind !== 'marker') throw new Error(`期望 marker，实际 ${type.kind}`);
    expect(type.marker).toBe('YLeaf');
    expect(type.arg).toEqual({ kind: 'int', min: 1, max: 3 });
  });

  it('G4 对象字段位（MODULE 脚手架）→ int 叶', () => {
    expect(rootFieldType(parseModuleOk(MODULE('number & Range<0, 1>')))).toEqual({
      kind: 'range',
      min: 0,
      max: 1,
    });
  });

  it('可选字段位 `v?: number & Int<1, 3>` → optional 字段 + int 叶', () => {
    const field = rootField(parseModuleOk('type ROOT = YMap<{ v?: number & Int<1, 3> }>;'));
    expect(field.optional).toBe(true);
    expect(field.type).toEqual({ kind: 'int', min: 1, max: 3 });
  });

  it('联合成员位 `number & Int<1, 3> | string` → 首成员 int 叶', () => {
    const type = rootFieldType(parseModuleOk(MODULE('number & Int<1, 3> | string')));
    expect(type.kind).toBe('union');
    if (type.kind !== 'union') throw new Error(`期望 union，实际 ${type.kind}`);
    expect(type.members[0]).toEqual({ kind: 'int', min: 1, max: 3 });
    expect(type.members[1]).toEqual({ kind: 'primitive', name: 'string' });
  });
});

// ---------------------------------------------------------------------------
// C2 — 负例：错误码 + 精确锚（实现前红 → 实现后绿；负控保持绿）
// ---------------------------------------------------------------------------

describe('C2 — 负例 A 组：arity / Int 浮点端点 / 空区间 / -0 端点 / 超双精度（锚构造起点或违规记号）', () => {
  const A_CASES: Array<{ form: string; code: string; column: number; note: string }> = [
    { form: 'number & Int<5>', code: '100', column: 32, note: 'arity：单实参 → 锚构造起点' },
    { form: 'number & Int<1, 2, 3>', code: '100', column: 32, note: 'arity：第三实参 → 锚构造起点' },
    { form: 'number & Range<0>', code: '100', column: 32, note: 'arity：单实参' },
    { form: 'number & Int<>', code: '100', column: 32, note: 'arity：零实参' },
    { form: 'number & Range', code: '100', column: 32, note: 'Range 无实参 → 锚 Range 记号' },
    { form: 'number & Int<0.5, 1>', code: '100', column: 36, note: 'Int 端点非整数（首违规记号）' },
    { form: 'number & Int<1, 2.5>', code: '100', column: 39, note: 'Int 端点非整数（第二端点）' },
    { form: 'number & Int<5, 1>', code: '100', column: 32, note: '空区间（min > max）→ 锚构造起点' },
    { form: 'number & Range<1, 0>', code: '100', column: 32, note: '空区间（min > max）' },
    { form: 'number & Int<-0, 1>', code: '100', column: 36, note: '-0 端点值判定（ADR 0021 决策 2）' },
    { form: 'number & Range<-0.0, 1>', code: '100', column: 38, note: '-0 端点值判定（小数形态）' },
    {
      form: `number & Int<${'9'.repeat(309)}, 1>`,
      code: '100',
      column: 36,
      note: '超双精度端点（#314 有限性闸门复用）',
    },
  ];

  it.each(A_CASES)('$form → VFSL-E$code @ (1,$column)（$note）', ({ form, code, column }) => {
    const issue = parseIssue(MODULE(form));
    expect(issue.message).toMatch(new RegExp(`^VFSL-E${code}: `));
    expect(issue.line).toBe(1);
    expect(issue.column).toBe(column);
  });
});

describe('C2 — 负例 B 组：裸用 / 保留名占用 / 字段名位 / 语义相位锚', () => {
  const B_CASES: Array<{ text: string; code: string; column: number; note: string }> = [
    { text: MODULE('Int'), code: '100', column: 23, note: '裸 Int → E100 锚该记号' },
    { text: MODULE('Int<1, 2>'), code: '100', column: 23, note: '裸 Int<…> 一律 E100' },
    { text: MODULE('Range'), code: '100', column: 23, note: '裸 Range → E100 锚该记号' },
    { text: MODULE('Range<0, 1>'), code: '100', column: 23, note: '裸 Range<…> 一律 E100' },
    { text: MODULE('string & Int<1, 2>'), code: '100', column: 30, note: '左元非 number → 锚 `&`' },
    { text: MODULE('boolean & Int<1, 2>'), code: '100', column: 31, note: '左元非 number → 锚 `&`' },
    { text: MODULE('unknown & Int'), code: '100', column: 31, note: '白名单按左元判定 → 锚 `&`' },
    { text: MODULE('number & Pattern<"a">'), code: '100', column: 30, note: 'number 只配 Int/Range' },
    { text: MODULE('number & Int<1,2> & string'), code: '100', column: 41, note: '第二段 `&` → 锚该 `&`' },
    { text: 'type Int = number;\ntype ROOT = {};', code: '303', column: 6, note: '别名名占用保留名' },
    { text: 'type Range = number;\ntype ROOT = {};', code: '303', column: 6, note: '别名名占用保留名' },
    { text: 'type ROOT = YMap<{ Int: number }>;', code: '100', column: 20, note: '字段名位保留名' },
    { text: 'type ROOT = number & Int;', code: '311', column: 13, note: 'ROOT 非 map 形（AST pos = number 记号）' },
    {
      text: 'type ROOT = YMap<{ v: Record<number & Int<1, 3>, string> }>;',
      code: '306',
      column: 30,
      note: 'Record 数值键（键类型起点 = number 记号）',
    },
  ];

  it.each(B_CASES)('$note：$text → VFSL-E$code @ (1,$column)', ({ text, code, column }) => {
    const issue = parseIssue(text);
    expect(issue.message).toMatch(new RegExp(`^VFSL-E${code}: `));
    expect(issue.line).toBe(1);
    expect(issue.column).toBe(column);
  });

  it('E303 锚声明名（镜像 `type string = number;` 既有先例）', () => {
    const issue = parseIssue('type Int = number;\ntype ROOT = {};');
    expect(issue.message).toContain('保留名');
  });
});

describe('C2 补充 — 复合违规优先级（设计 §7.2 B3）与非数字实参锚位（B4）', () => {
  const COMPOSITE: Array<{ form: string; column: number; note: string }> = [
    { form: 'number & Int<0.5>', column: 32, note: 'arity 先行：单实参 + 浮点 → arity 锚构造起点' },
    { form: 'number & Int<1, 2, 3.5>', column: 32, note: 'arity 先行：第三实参（计数先于种类判定）' },
    { form: 'number & Int<5, 1.5>', column: 39, note: '端点值判定先于空区间：锚首个违规端点记号' },
    { form: 'number & Int<1.5, 5>', column: 36, note: '端点违规取源序首个记号' },
    { form: 'number & Int<"a", 1>', column: 36, note: 'B4：非数字实参锚该实参记号' },
    { form: 'number & Int<1,>', column: 38, note: 'B4：缺第二实参锚 `>` 记号' },
    { form: 'number & Int<1 2>', column: 38, note: '分隔畸形锚该分隔记号' },
  ];

  it.each(COMPOSITE)('$form → E100 @ (1,$column)（$note）', ({ form, column }) => {
    const issue = parseIssue(MODULE(form));
    expect(issue.message).toMatch(/^VFSL-E100: /);
    expect(issue.line).toBe(1);
    expect(issue.column).toBe(column);
  });

  it('EOF 截断（`number & Int<`）→ E100 锚 EOF 记号实际位置（既有 Pattern 实参锚同款）', () => {
    // 设计 §8.1(f) 括注的「err() 回退 (1,1)」仅在 next() 返回 undefined 时成立；tokenizer
    // 恒产出 eof 记号（带扫描结束位），故锚为 EOF 记号自身坐标——与 parsePatternType 的
    // 既有实参锚（`string & Pattern<` 锚 EOF 记号）同款，不另造回退。
    const issue = parseIssue('type ROOT = YMap<{ v: number & Int<');
    expect(issue.message).toMatch(/^VFSL-E100: /);
    expect(issue.message).toContain('文件末尾');
    expect(issue.line).toBe(1);
    expect(issue.column).toBe(36);
  });

  it('夹缝 doc 不挂靠约束位（不调用 claimDocs）：留 dangling → E305 锚注释起始（既有语义）', () => {
    const issue = parseIssue('type ROOT = YMap<{ v: number /** d */ & Int<1, 2> }>;');
    expect(issue.message).toMatch(/^VFSL-E305: /);
    expect(issue.line).toBe(1);
    expect(issue.column).toBe(30);
  });
});

describe('C2 — 负控组（实现前后均须绿）：大小写敏感、近似名、既有交叉负例', () => {
  it('小写 `int` 非保留名：`type int = number;` + 引用 → ok', () => {
    const parsed = parseVfsl('type int = number;\ntype ROOT = YMap<{ v: int }>;');
    expect(parsed.ok, JSON.stringify(parsed.ok ? [] : parsed.issues)).toBe(true);
  });

  it('近似名 `Integer` / `Range2` 保持合法（保留面恰 Int/Range 两名）', () => {
    const parsed = parseVfsl(
      'type Integer = number;\ntype Range2 = number;\ntype ROOT = YMap<{ a: Integer; b: Range2 }>;',
    );
    expect(parsed.ok, JSON.stringify(parsed.ok ? [] : parsed.issues)).toBe(true);
  });

  it('字段名 `Range2` 保持合法（仅保留名整名命中才拒绝）', () => {
    const parsed = parseVfsl('type ROOT = YMap<{ Range2: number }>;');
    expect(parsed.ok, JSON.stringify(parsed.ok ? [] : parsed.issues)).toBe(true);
  });

  it('`number & int<1, 2>`（小写近似名）→ E100 锚 `&` (1,30)（不扩大保留面）', () => {
    const issue = parseIssue(MODULE('number & int<1, 2>'));
    expect(issue.message).toMatch(/^VFSL-E100: /);
    expect(issue.column).toBe(30);
  });

  it('`number & Integer<1, 2>`（近似名）→ E100 锚 `&` (1,30)', () => {
    const issue = parseIssue(MODULE('number & Integer<1, 2>'));
    expect(issue.message).toMatch(/^VFSL-E100: /);
    expect(issue.column).toBe(30);
  });

  it('`string & Pattern<"a">`（既有白名单）保持 ok 且 IR 同形', () => {
    expect(rootFieldType(parseModuleOk(MODULE('string & Pattern<"a">')))).toEqual({
      kind: 'pattern',
      regex: 'a',
    });
  });

  it('`string & Pattern`（& 后缺实参）保持 E100 锚 `Pattern` (1,32)', () => {
    const issue = parseIssue(MODULE('string & Pattern'));
    expect(issue.message).toMatch(/^VFSL-E100: /);
    expect(issue.column).toBe(32);
  });
});

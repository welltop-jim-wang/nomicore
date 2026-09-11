/**
 * SA6 红/绿契约 — issue #314：VFSL 数字字面量拓宽（负号与小数，ADR 0020 决策 3）。
 *
 * 文法（v1-spec §2 注记 7 修订后 / ADR 0020 决策 3）：`NumberLiteral = [ "-" ], digit,
 * { digit }, [ ".", digit, { digit } ]`——可选负号 + digits + 可选小数部；负号须紧邻
 * 数字（作为 number 记号的一部分扫描，不吞 trivia）；`.5` / `1.` / 指数记号不做。
 *
 * 断言纪律（SA6 §12.0）：只观察公共接缝 `parseVfsl` 的运行时返回（ok / IR 字面量值 /
 * issue 的码 + 行列锚）；正例一律使用声明 ROOT 的完整模块（`type A = -1;` 缺 ROOT 是
 * E310，不是本文件的正例形态）；负例必须同时钉错误码 + 行列锚（只断言 ok:false 不足以
 * 杀死过宽实现）。不 skip / 不软化 / 不 grep 源码。
 *
 * 锚位约定（SA6 §12.1）：MODULE(FORM) := `type ROOT = YMap<{ v: ${FORM} }>;`，类型表达式
 * 起点 (1,23)。`-1 & string` 的 E100 锚 `&` 记号 = (1,26)（设计 §6「B-补 2」勘误：
 * `-1` 占 23-24 列、`&` 在 26 列；SA6 契约原文的 (1,25) 系无符号形误抄）。
 */
import { describe, expect, it } from 'vitest';
import { parseVfsl } from '../src/index.js';
import type { VfslModule, VfslType } from '../src/index.js';

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

/** 期望 ok:false、issues 恰 1 条，返回该 issue（SA6 §12.0 单错误即失败契约）。 */
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

/** ROOT 别名 `YMap<{ v: T }>` 中字段 `v` 的类型节点（IR 值断言锚）。 */
function rootFieldType(module: VfslModule): VfslType {
  const root = module.aliases.find((a) => a.name === 'ROOT');
  if (root === undefined) throw new Error('ROOT 别名缺失');
  const marker = root.type;
  if (marker.kind !== 'marker') throw new Error(`ROOT 类型非 marker：${marker.kind}`);
  const arg = marker.arg;
  if (arg.kind !== 'object') throw new Error(`YMap 实参非对象形：${arg.kind}`);
  const field = arg.fields.find((f) => f.name === 'v');
  if (field === undefined) throw new Error('字段 v 缺失');
  return field.type;
}

/** 字面量 / 全字面量联合节点的数值序列（声明序）。 */
function literalValues(type: VfslType): Array<string | number> {
  if (type.kind === 'literal') return [type.value];
  if (type.kind === 'union') {
    return type.members.map((m) => {
      if (m.kind !== 'literal') throw new Error(`联合成员非字面量：${m.kind}`);
      return m.value;
    });
  }
  throw new Error(`非字面量 / 联合节点：${type.kind}`);
}

// ---------------------------------------------------------------------------
// C1 — 正例：负 / 小数字面量全局可解析（实现前红 → 实现后绿）
// ---------------------------------------------------------------------------

describe('C1 — 负 / 小数字面量作联合成员：ok + IR 字面量值（f64 归一）', () => {
  const LITERALS: Array<{ form: string; value: number }> = [
    { form: '-1', value: -1 },
    { form: '0.5', value: 0.5 },
    { form: '-0.5', value: -0.5 },
    { form: '00', value: 0 }, // 前导零本就是合法形态（文法 `[0-9]+` 未禁止）
    { form: '00.5', value: 0.5 },
    { form: '9007199254740993', value: 9007199254740992 }, // f64 舍入（既有行为）
    { form: '-9007199254740993', value: -9007199254740992 },
    { form: '0.99999999999999999', value: 1 }, // f64 舍入，非拒绝
    { form: `-0.${'0'.repeat(322)}1`, value: -1e-323 }, // 次正规、非 -0
    { form: '9'.repeat(308), value: 1e308 }, // 既有边界
    { form: `-${'9'.repeat(308)}`, value: -1e308 },
  ];

  it.each(LITERALS)('$form → ok，IR literal $value', ({ form, value }) => {
    const module = parseModuleOk(MODULE(form));
    const type = rootFieldType(module);
    expect(type.kind).toBe('literal');
    if (type.kind !== 'literal') throw new Error(`期望 literal，实际 ${type.kind}`);
    // Object.is 语义（toBe）：-0 与 0 不同值，f64 归一值逐位相等
    expect(type.value).toBe(value);
  });

  const UNIONS: Array<{ form: string; values: number[] }> = [
    { form: '-1 | 1', values: [-1, 1] },
    { form: '0.5 | 1.5', values: [0.5, 1.5] },
    { form: '0.1 | 0.2', values: [0.1, 0.2] },
  ];

  it.each(UNIONS)('$form → ok，union members $values（声明序）', ({ form, values }) => {
    const module = parseModuleOk(MODULE(form));
    const type = rootFieldType(module);
    expect(type.kind).toBe('union');
    expect(literalValues(type)).toEqual(values);
  });
});

describe('C1 — 全局位置：字面量子集是全局规则，无上下文特判', () => {
  it('别名 RHS：`type A = -1 | 0.5;` 可解析且 ROOT 引用别名', () => {
    const module = parseModuleOk('type A = -1 | 0.5; type ROOT = YMap<{ v: A }>;');
    const aliasA = module.aliases.find((a) => a.name === 'A');
    expect(aliasA).toBeDefined();
    if (aliasA === undefined) throw new Error('别名 A 缺失');
    expect(literalValues(aliasA.type)).toEqual([-1, 0.5]);
  });

  it('数组元素位：`-1[]` → ok，元素 literal -1', () => {
    const module = parseModuleOk(MODULE('-1[]'));
    const type = rootFieldType(module);
    expect(type.kind).toBe('array');
    if (type.kind !== 'array') throw new Error(`期望 array，实际 ${type.kind}`);
    expect(type.element.kind).toBe('literal');
    if (type.element.kind !== 'literal') throw new Error('元素非 literal');
    expect(type.element.value).toBe(-1);
  });

  it('YLeaf 实参位：`YLeaf<-1>` → ok', () => {
    const module = parseModuleOk(MODULE('YLeaf<-1>'));
    const type = rootFieldType(module);
    expect(type.kind).toBe('marker');
    if (type.kind !== 'marker') throw new Error(`期望 marker，实际 ${type.kind}`);
    expect(type.arg.kind).toBe('literal');
    if (type.arg.kind !== 'literal') throw new Error('YLeaf 实参非 literal');
    expect(type.arg.value).toBe(-1);
  });

  it('YArray 实参位：`YArray<0.5>` → ok', () => {
    const module = parseModuleOk(MODULE('YArray<0.5>'));
    const type = rootFieldType(module);
    expect(type.kind).toBe('marker');
    if (type.kind !== 'marker') throw new Error(`期望 marker，实际 ${type.kind}`);
    expect(type.arg.kind).toBe('literal');
    if (type.arg.kind !== 'literal') throw new Error('YArray 实参非 literal');
    expect(type.arg.value).toBe(0.5);
  });

  it('Record 值位：`Record<string, -1 | 0.5>` → ok', () => {
    const module = parseModuleOk(MODULE('Record<string, -1 | 0.5>'));
    const type = rootFieldType(module);
    expect(type.kind).toBe('record');
    if (type.kind !== 'record') throw new Error(`期望 record，实际 ${type.kind}`);
    expect(literalValues(type.value)).toEqual([-1, 0.5]);
  });
});

describe('C1 — 全局位置：既有形状规则照常裁决（非 E100 词法面）', () => {
  it('Record 键位：`Record<-1, string>` → E306 @ (1,30)（识别为数值字面量后按键形规则拒绝）', () => {
    const issue = parseIssue(MODULE('Record<-1, string>'));
    expect(issue.message).toMatch(/^VFSL-E306: /);
    expect([issue.line, issue.column]).toEqual([1, 30]);
  });

  it('交叉位：`-1 & string` → E100 @ (1,26)（锚 `&` 记号；SA6 契约原文 (1,25) 系误抄，见文件头注）', () => {
    const issue = parseIssue(MODULE('-1 & string'));
    expect(issue.message).toMatch(/^VFSL-E100: /);
    expect([issue.line, issue.column]).toEqual([1, 26]);
  });

  it('scalar ROOT 形：`type ROOT = -1 | 0.5;` → E311 @ (1,13)（表达式起点）', () => {
    const issue = parseIssue('type ROOT = -1 | 0.5;');
    expect(issue.message).toMatch(/^VFSL-E311: /);
    expect([issue.line, issue.column]).toEqual([1, 13]);
  });
});

// ---------------------------------------------------------------------------
// C2 — 负例对照：非法形态维持 E100 + 精确锚（实现前后均绿，具突变敏感性）
// ---------------------------------------------------------------------------

describe('invalid number forms', () => {
  /** 期望 E100 + 锚位（列）的非法形态矩阵（SA6 §12.3）。 */
  const INVALID: Array<{ form: string; column: number }> = [
    { form: '.5', column: 23 }, // 小数点两侧 digits 必填
    { form: '1.', column: 24 },
    { form: '1e3', column: 24 }, // 指数记号不做（停在非 digit，字段分隔符错）
    { form: '-1e3', column: 25 }, // 已登记锚位变化：`-1` 合法记号后锚 `e3`
    { form: '1..5', column: 24 },
    { form: '-', column: 23 }, // 裸 `-` 维持未知字符延迟错误记号路径
    { form: '- 1', column: 23 }, // 负号须紧邻数字：空白不得被吞
    { form: '-/*c*/1', column: 23 }, // trivia 不得被吞
    { form: '-.5', column: 23 },
    { form: '--1', column: 23 },
    { form: '-0', column: 23 }, // -0 家族：解析期 E100（值判定）
    { form: '-0.0', column: 23 },
    { form: '-00', column: 23 },
    { form: `-0.${'0'.repeat(323)}1`, column: 23 }, // f64 下溢为 -0：杀死文本判定实现
    { form: `-0.${'0'.repeat(400)}`, column: 23 },
  ];

  it.each(INVALID)('$form → E100 @ (1,$column)', ({ form, column }) => {
    const issue = parseIssue(MODULE(form));
    expect(issue.message).toMatch(/^VFSL-E100: /);
    expect(issue.line).toBe(1);
    expect(issue.column).toBe(column);
  });

  it('未知字符路径的负例维持既有消息类别（锚 `-` / `.` 所在列）', () => {
    const cases: Array<{ form: string; marker: string }> = [
      { form: '.5', marker: '未知记号: .' },
      { form: '1.', marker: '未知记号: .' },
      { form: '1..5', marker: '未知记号: .' },
      { form: '-', marker: '未知记号: -' },
      { form: '- 1', marker: '未知记号: -' },
      { form: '-/*c*/1', marker: '未知记号: -' },
      { form: '-.5', marker: '未知记号: -' },
      { form: '--1', marker: '未知记号: -' },
    ];
    for (const { form, marker } of cases) {
      const issue = parseIssue(MODULE(form));
      expect(issue.message, `形态 ${form}`).toContain(marker);
    }
  });

  it('-0 家族：消息含 `-0` 且引导改写成 `0`（码 + 锚不变）', () => {
    const forms = ['-0', '-0.0', '-00', `-0.${'0'.repeat(323)}1`, `-0.${'0'.repeat(400)}`];
    for (const form of forms) {
      const issue = parseIssue(MODULE(form));
      expect(issue.message, `形态 ${form}`).toMatch(/^VFSL-E100: /);
      expect(issue.message, `形态 ${form}`).toContain('-0');
      expect(issue.message, `形态 ${form}`).toMatch(/请.*0/); // 引导写 0
      expect([issue.line, issue.column], `形态 ${form}`).toEqual([1, 23]);
    }
  });

  it('超双精度（含负值）沿既有 §7.3 域闸门：消息同无符号版，锚记号起点 (1,23)', () => {
    for (const form of ['9'.repeat(309), `-${'9'.repeat(309)}`]) {
      const issue = parseIssue(MODULE(form));
      expect(issue.message, `形态 ${form.slice(0, 8)}…`).toMatch(
        /^VFSL-E100: 数字字面量超出可序列化数值域/,
      );
      expect([issue.line, issue.column]).toEqual([1, 23]);
    }
  });
});

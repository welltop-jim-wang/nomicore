/**
 * SA6 红灯契约 — issue #306（M4 联合成员文档注释：derived 条件稀疏 `memberDocs` +
 * 手造 IR loud 边界）。
 *
 * 契约来源：ADR 0019 决策 5（DerivedSchema 新增条件稀疏 `memberDocs?: Record<string,
 * string[]>`；显式修订 ADR 0003 docs 表条款）+ 决策 8（纯文档性质：不进校验与物化）+
 * issue #306 AC3 / AC5。
 *
 * 基线（录制于实现前 HEAD 91c4add）：
 * - 无成员 doc 的存量文本派生物当前即绿（键集合 = 既有七表，无 `memberDocs` 键）；
 * - 有成员 doc 的派生物与手造 IR 路径当前无 `memberDocs`（能力缺口）→ 相应用例红；
 * - 手造 IR 的 `memberDocs` 畸形当前被静默忽略 → ok:true（红灯），实现后必须 loud E100。
 *
 * 断言一律经公共入口 evaluate / parseVfsl 观察运行时行为；不读源码、不 skip、不软化。
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { evaluate, parseVfsl } from '../src/index.js';
import type { DerivedSchema, VfslModule } from '../src/index.js';
import { FIXTURE_B, SPEC_FIXTURE } from './union-member-docs-fixture.js';

/** 既有派生 schema 键集合（ADR 0003 + ADR 0005；条件稀疏 key 不在场时不得改变）。 */
const BASE_DERIVED_KEYS = ['aliases', 'structure', 'values', 'index', 'aliasDocs', 'fieldDocs', 'markerDocs'];

/** 存量稳定金样本（E-1）：录制于实现前 HEAD 91c4add 的 evaluate 现行为。 */
const SPEC_FIXTURE_DERIVED_SHA256 = '2335a0236fd20572999d3126de6dae5aa30e954ea5bb070ffcb5c8847df0375b';
const FIXTURE_B_DERIVED_SHA256 = '547748b6dcbe75a236ab3c88f30c31188bf8f8324bdaa8e9aac2a393c509492f';

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function parseOk(text: string): VfslModule {
  const result = parseVfsl(text);
  if (!result.ok) {
    throw new Error(`前置 parseVfsl 失败（不应发生）: ${JSON.stringify(result.issues)}`);
  }
  return result.module;
}

function evaluateOk(text: string): DerivedSchema {
  const result = evaluate(parseOk(text));
  if (!result.ok) {
    throw new Error(`期望 evaluate ok:true，实际 issues: ${JSON.stringify(result.issues)}`);
  }
  return result.derived;
}

/** derived 条件稀疏 memberDocs 表（ADR 0019 决策 5 目标形状）。 */
function memberDocsOf(derived: DerivedSchema): Record<string, string[]> | undefined {
  return (derived as unknown as { memberDocs?: Record<string, string[]> }).memberDocs;
}

/** 整键在场性（条件稀疏：无成员 doc 时整键不存在，不得以空表入场）。 */
function hasMemberDocsKey(derived: DerivedSchema): boolean {
  return Object.prototype.hasOwnProperty.call(derived, 'memberDocs');
}

/** 手造 IR loud 边界断言（决策 5 §3.4 守卫族）：恰一条 E100、无 derived 载荷（禁止静默规范化）。 */
function expectE100(result: ReturnType<typeof evaluate>, label: string): void {
  expect(result.ok, `${label}: 应 loud 失败`).toBe(false);
  if (result.ok) throw new Error('unreachable（上方断言已拦）');
  expect(result.issues, `${label}: 恰一条 issue`).toHaveLength(1);
  expect(result.issues[0]!.message, `${label}: VFSL-E100 冻结前缀`).toMatch(/^VFSL-E100: /);
  expect('derived' in result, `${label}: 不得携带派生物`).toBe(false);
}

/** 手造 IR：无 memberDocs 键（合法存量形状）。 */
function handMadeUnionIr(): VfslModule {
  return {
    kind: 'vfsl-module',
    aliases: [
      { kind: 'alias', name: 'ROOT', docs: [], type: { kind: 'object', fields: [] } },
      {
        kind: 'alias',
        name: 'T',
        docs: [],
        type: {
          kind: 'union',
          members: [
            { kind: 'literal', value: 'a' },
            { kind: 'literal', value: 'b' },
          ],
        },
      },
    ],
  };
}

/** 手造 IR：memberDocs 显式在场（可为畸形值——测试入口绕过 parseVfsl，直构 module）。 */
function handMadeUnionIrWith(memberDocs: unknown): VfslModule {
  const module = handMadeUnionIr() as unknown as {
    aliases: Array<{ name: string; type: Record<string, unknown> }>;
  };
  const t = module.aliases.find((a) => a.name === 'T')!;
  t.type['memberDocs'] = memberDocs;
  return module as unknown as VfslModule;
}

describe('issue #306 / ADR 0019 — derived 条件稀疏 memberDocs（决策 5）', () => {
  it('有成员 doc：按 <member N> 路径键逐字收集，只收非空条目（AC3）', () => {
    const text =
      'type ROOT = { s: Status };\n' +
      'type Status =\n' +
      '  /** 草稿 */\n' +
      '  | "draft"\n' +
      '  /** 已提交 */\n' +
      '  | "submitted"\n' +
      '  | "archived";';
    const derived = evaluateOk(text);
    const table = memberDocsOf(derived);
    expect(table, '有成员 doc 时整键必须在场').toBeDefined();
    // 键 = 成员语法路径（既有 `<member N>` 合成段，N 从 0 起声明序）；member 2 无 doc → 不成键
    expect(Object.keys(table!)).toEqual(['Status.<member 0>', 'Status.<member 1>']);
    expect(table).toEqual({ 'Status.<member 0>': [' 草稿 '], 'Status.<member 1>': [' 已提交 '] });
    expect(table!['Status.<member 2>']).toBeUndefined();
  });

  it('嵌套联合路径：<member N> 段按声明序合成（对象字段位与数组 <item> 段）（AC3）', () => {
    const text =
      'type ROOT = { x: X; v: V };\n' +
      'type X = { k: /** 内甲 */ "a" | "b" };\n' +
      'type V = YArray</** 内乙 */ "x" | "y">;';
    const derived = evaluateOk(text);
    // 键 = 既有路径文法：字段段 + <member N>；数组位再走既有 <item> 合成段
    expect(Object.keys(memberDocsOf(derived) ?? {})).toEqual([
      'X.k.<member 0>',
      'V.<item>.<member 0>',
    ]);
    expect(memberDocsOf(derived)).toEqual({
      'X.k.<member 0>': [' 内甲 '],
      'V.<item>.<member 0>': [' 内乙 '],
    });
  });

  it('无成员 doc：整键缺席、既有键集合不变、派生物逐字节稳定（AC3 / AC4）', () => {
    expectStableDerived('SPEC_FIXTURE', SPEC_FIXTURE, SPEC_FIXTURE_DERIVED_SHA256);
    expectStableDerived('FIXTURE_B', FIXTURE_B, FIXTURE_B_DERIVED_SHA256);
  });

  it('纯文档性质：成员 doc 只改变 memberDocs 表，物化 / 索引 / 既有三表全等（决策 8）', () => {
    const withDocs =
      'type ROOT = { s: S };\ntype S =\n  /** 甲 */\n  | "a"\n  /** 乙 */\n  | "b";';
    const withoutDocs = 'type ROOT = { s: S };\ntype S = "a" | "b";';
    const d1 = evaluateOk(withDocs);
    const d0 = evaluateOk(withoutDocs);
    expect(d1.structure).toEqual(d0.structure);
    expect(d1.values).toEqual(d0.values);
    expect(d1.index).toEqual(d0.index);
    expect(d1.aliases).toEqual(d0.aliases);
    expect(d1.aliasDocs).toEqual(d0.aliasDocs);
    expect(d1.fieldDocs).toEqual(d0.fieldDocs);
    expect(d1.markerDocs).toEqual(d0.markerDocs);
    // 文档确实进入派生物（否则上面的全等断言会掩盖「成员 doc 被丢弃」）
    expect(JSON.stringify(d1)).not.toBe(JSON.stringify(d0));
    expect(Object.keys(memberDocsOf(d1) ?? {})).toEqual(['S.<member 0>', 'S.<member 1>']);
  });
});

describe('issue #306 / ADR 0019 — 手造 IR memberDocs 守卫（决策 5，AC5）', () => {
  it('正控：无 memberDocs 键 / 等长良性的手造 IR 均 ok:true，条件稀疏不产生空表', () => {
    const bare = evaluate(handMadeUnionIr());
    expect(bare.ok).toBe(true);
    if (!bare.ok) throw new Error(`期望 ok:true（无 memberDocs 键），实际 ${JSON.stringify(bare.issues)}`);
    expect(hasMemberDocsKey(bare.derived)).toBe(false);
    expect(Object.keys(bare.derived)).toEqual(BASE_DERIVED_KEYS);

    const benign = evaluate(handMadeUnionIrWith([[' x '], []]));
    expect(benign.ok).toBe(true);
    if (!benign.ok) throw new Error(`期望 ok:true（等长良性 memberDocs），实际 ${JSON.stringify(benign.issues)}`);
    expect(Object.keys(memberDocsOf(benign.derived) ?? {})).toEqual(['T.<member 0>']);
    expect(memberDocsOf(benign.derived)).toEqual({ 'T.<member 0>': [' x '] });

    // 全部为空数组 → 仍不产生 memberDocs 键（条件稀疏：至少一名成员携带 doc 才在场）
    const allEmpty = evaluate(handMadeUnionIrWith([[], []]));
    expect(allEmpty.ok).toBe(true);
    if (!allEmpty.ok) throw new Error(`期望 ok:true（全空 memberDocs），实际 ${JSON.stringify(allEmpty.issues)}`);
    expect(hasMemberDocsKey(allEmpty.derived)).toBe(false);
  });

  it('畸形 memberDocs（非等长数组的数组）→ ok:false 恰一条 E100，禁止静默规范化（AC5）', () => {
    const cases: Array<[string, unknown]> = [
      ['短于 members', [[' x ']]],
      ['长于 members', [[' x '], [], [' z ']]],
      ['元素非数组', [[' x '], 'nope']],
      ['整体非数组', 'nope'],
    ];
    for (const [label, memberDocs] of cases) {
      expectE100(evaluate(handMadeUnionIrWith(memberDocs)), label);
    }
  });
});

/** E-1：存量（无成员 doc）文本派生物的键集合与紧凑 JSON 逐字节不变。 */
function expectStableDerived(name: string, text: string, digest: string): void {
  const derived = evaluateOk(text);
  expect(Object.keys(derived), `${name}: 键集合不变（memberDocs 不在场）`).toEqual(BASE_DERIVED_KEYS);
  expect(hasMemberDocsKey(derived), `${name}: memberDocs 整键缺席`).toBe(false);
  expect(sha256(JSON.stringify(derived)), `${name}: derived 紧凑 JSON 逐字节不变`).toBe(digest);
}

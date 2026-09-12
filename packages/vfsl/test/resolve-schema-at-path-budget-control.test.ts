/**
 * Issue #335 负控/基线（SA6 §12.2 G0、§12.3 第四行）— 实现前后**均须全绿**。
 *
 * 本文件不 import/不调用任何预算名目：只经既有两参 `resolveSchemaAtPath` 与
 * `parseVfsl`/`evaluate` 公共接缝锚定：
 * - G0.1 预算夹具可解析可求值（图/表前提）；
 * - G0.2 层结构字面量对账（§6.3.4 计层矩阵的独立 oracle：容器各一层、optional/union/
 *   enum 透明、ref 终态——期望值不靠读源码，全部经求值输出观察）；
 * - G0.3 毒化哨兵前提（clean 无预算 ok；毒化无预算 `throw InternalError`）；
 * - G0.4 无预算基线冻结（#272 14 路径 SA6 §13.5 摘要 + 预算夹具摘要 + 键序 + M4 型
 *   enum 成员注释键 23 键基线）；
 * - G8.1 两参调用静态可编译、重复调用逐字节确定、derived 零变异。
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { evaluate, parseVfsl, resolveSchemaAtPath } from '../src/index.js';
import type { DerivedSchema, ValueSchema, VfslModule } from '../src/index.js';
import { InternalError } from '../src/resolve.js';
import { FIXTURE_TEXT } from './resolve-schema-at-path-fixture.js';
import {
  EXPECTED_DOCS,
  M4_ROOT_ALIAS_DOCS,
  M4_ROOT_ALIAS_ORDER,
  M4_TEXT,
} from './resolve-schema-at-path-member-docs-fixture.js';
import {
  BUDGET_ALIAS_ORDER,
  BUDGET_FIXTURE_TEXT,
  BUDGET_NO_BUDGET_DIGESTS,
  POISON_ALIAS,
  budgetFixtureDerived,
  poisonedFixtureDerived,
} from './resolve-schema-at-path-budget-fixture.js';

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function parseOk(text: string): VfslModule {
  const result = parseVfsl(text);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`前置 parseVfsl 失败（不应发生）：${JSON.stringify(result.issues)}`);
  }
  return result.module;
}

function evaluateOk(text: string): DerivedSchema {
  const result = evaluate(parseOk(text));
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`前置 evaluate 失败（不应发生）：${JSON.stringify(result.issues)}`);
  }
  return result.derived;
}

function fixture272(): DerivedSchema {
  return evaluateOk(FIXTURE_TEXT);
}

function m4(): DerivedSchema {
  return evaluateOk(M4_TEXT);
}

/** 值树字段（窄化断言辅助）。 */
function fieldsOf(node: ValueSchema): ReadonlyArray<{ name: string; value: ValueSchema }> {
  if (node.kind !== 'object') throw new Error(`前置违反：期望 object，实际 ${node.kind}`);
  return node.fields;
}

function fieldValue(node: ValueSchema, name: string): ValueSchema {
  const field = fieldsOf(node).find((f) => f.name === name);
  if (field === undefined) throw new Error(`前置违反：缺字段 ${name}`);
  return field.value;
}

// —— #272 无预算 14 路径冻结摘要（SA6 §13.5；sha256(JSON.stringify(result)) 前 16 位）——

const FIXTURE_272_BASELINE: ReadonlyArray<{ path: readonly (string | number)[]; prefix: string }> = [
  { path: [], prefix: '5c2eb58e98e87b3f' },
  { path: ['audit'], prefix: '0522bec4126c4361' },
  { path: ['assets'], prefix: 'd791971882166312' },
  { path: ['assets', 'img1'], prefix: '1fdd6ec9abc63cf7' },
  { path: ['assets', 'img1', 'url'], prefix: '2417f648bb65657d' },
  { path: ['notes'], prefix: 'fd64ebfcd5191e12' },
  { path: ['keywords'], prefix: 'a9fa8c686e66fcdb' },
  { path: ['u', 'x'], prefix: '2b26ffb93924762a' },
  { path: ['config'], prefix: '49be73e01d4cedf0' },
  { path: ['config', 'retries'], prefix: 'ad5ad3e6a978cf44' },
  { path: ['nope'], prefix: '09ba64ad18349c6b' },
  { path: [0], prefix: '66daaf30651de6a8' },
  { path: ['keywords', -1], prefix: 'b901ba9fc9a06227' },
  { path: ['u'], prefix: 'f44ef53c5873dce4' },
];

describe('#335 G0 负控 — 前提与基线', () => {
  it('G0.1 预算夹具 parseVfsl ok 且 evaluate ok（五表在场）', () => {
    const derived = budgetFixtureDerived();
    expect(Object.keys(derived.aliases).sort()).toEqual(['Audit', 'Ledger', 'Mode', 'Pair', 'ROOT']);
    expect(Object.keys(derived.values).sort()).toEqual(['Audit', 'Ledger', 'Mode', 'Pair', 'ROOT']);
    expect(derived.structure.kind).toBe('root');
    expect(Object.hasOwn(derived.values, 'ROOT')).toBe(true);
    // memberDocs 条件稀疏但在场（别名枚举成员注释锚位）
    expect(derived.memberDocs).toBeDefined();
    expect(Object.keys(derived.memberDocs ?? {}).sort()).toEqual(['Mode.<member 0>', 'Mode.<member 1>']);
  });

  it('G0.2 层结构字面量对账（容器各一层、optional/union/enum 透明、ref 终态）', () => {
    const derived = budgetFixtureDerived();
    const root = derived.values['ROOT'];
    if (root === undefined) throw new Error('前置违反：缺 ROOT');
    // ROOT 一层 object，字段声明序固定
    expect(fieldsOf(root).map((f) => f.name)).toEqual([
      'shallow',
      'deep',
      'pair',
      'inlPair',
      'plain',
      'opt',
      'req',
      'mode',
      'modes',
      'modeMap',
    ]);
    // ref 终态：shallow/mode 为按名引用（不内联）
    expect(fieldValue(root, 'shallow')).toEqual({ kind: 'ref', name: 'Ledger' });
    expect(fieldValue(root, 'mode')).toEqual({ kind: 'ref', name: 'Mode' });
    expect(fieldValue(root, 'pair')).toEqual({ kind: 'ref', name: 'Pair' });
    // 深链两层容器：deep(object) → mid(object) → leaf(ref)
    const deep = fieldValue(root, 'deep');
    const mid = fieldValue(deep, 'mid');
    expect(deep.kind).toBe('object');
    expect(mid.kind).toBe('object');
    expect(fieldValue(mid, 'leaf')).toEqual({ kind: 'ref', name: 'Ledger' });
    // optional 透明（与 req 必填孪生同构）：optional 包裹一层 object
    const opt = fieldValue(root, 'opt');
    expect(opt.kind).toBe('optional');
    expect(opt.kind === 'optional' ? opt.value.kind : undefined).toBe('object');
    expect(fieldValue(root, 'req').kind).toBe('object');
    // union 透明：inlPair 两成员 object（判别式缓存在场但不计层）
    const inlPair = fieldValue(root, 'inlPair');
    expect(inlPair.kind).toBe('union');
    expect(inlPair.kind === 'union' ? inlPair.members.map((m) => m.kind) : []).toEqual([
      'object',
      'object',
    ]);
    // enum 终态（字面量联合）
    expect(derived.values['Mode']).toEqual({ kind: 'enum', values: ['on', 'off'] });
    // 数组一层、Record 一层（`<key>` 槽）
    expect(fieldValue(root, 'modes').kind).toBe('array');
    const modeMap = fieldValue(root, 'modeMap');
    expect(modeMap.kind).toBe('object');
    expect(fieldsOf(modeMap).map((f) => f.name)).toEqual(['<key>']);
    // 别名链：Ledger(object) → audit(ref Audit)；Audit.notes 数组（一层）
    const ledger = derived.values['Ledger'];
    const audit = derived.values['Audit'];
    if (ledger === undefined || audit === undefined) throw new Error('前置违反：缺 Ledger/Audit');
    expect(fieldValue(ledger, 'audit')).toEqual({ kind: 'ref', name: 'Audit' });
    expect(fieldValue(audit, 'notes').kind).toBe('array');
    expect(fieldValue(audit, 'by').kind).toBe('scalar');
  });

  it('G0.3 毒化哨兵前提：clean 无预算 ok；毒化无预算 throw InternalError（非裸 TypeError）', () => {
    const clean = fixture272();
    expect(resolveSchemaAtPath(clean, []).ok).toBe(true);
    expect(resolveSchemaAtPath(clean, ['assets', 'img1']).ok).toBe(true);
    const poisoned = poisonedFixtureDerived();
    let thrown: unknown;
    try {
      resolveSchemaAtPath(poisoned, []);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(InternalError);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe('InternalError');
    expect((thrown as Error).message).toContain(POISON_ALIAS);
    let thrownDeep: unknown;
    try {
      resolveSchemaAtPath(poisoned, ['assets', 'img1']);
    } catch (err) {
      thrownDeep = err;
    }
    expect(thrownDeep).toBeInstanceOf(InternalError);
  });

  it('G0.4 #272 无预算 14 路径冻结摘要不变（SA6 §13.5）', () => {
    const derived = fixture272();
    for (const { path, prefix } of FIXTURE_272_BASELINE) {
      const result = resolveSchemaAtPath(derived, path);
      expect(sha256(JSON.stringify(result)).slice(0, 16)).toBe(prefix);
    }
  });

  it('G0.4 预算夹具无预算摘要冻结 + 结果键序（ok 恰五键 / 失败恰三键）', () => {
    const derived = budgetFixtureDerived();
    for (const [key, digest] of Object.entries(BUDGET_NO_BUDGET_DIGESTS)) {
      const path = JSON.parse(key) as (string | number)[];
      const result = resolveSchemaAtPath(derived, path);
      expect(sha256(JSON.stringify(result))).toBe(digest);
      expect(Object.keys(result)).toEqual(
        result.ok ? ['ok', 'valueSchema', 'aliases', 'docs', 'aliasDocs'] : ['ok', 'code', 'path'],
      );
    }
    expect(resolveSchemaAtPath(derived, ['nope']).ok).toBe(false);
    expect(resolveSchemaAtPath(derived, [0]).ok).toBe(false);
  });

  it('G0.4 M4 型 enum 成员注释键基线：`[]` docs 23 键 + 闭包序 + aliasDocs', () => {
    const derived = m4();
    const result = resolveSchemaAtPath(derived, []);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('前置违反：M4 `[]` 应 ok');
    expect(result.docs).toEqual(EXPECTED_DOCS);
    expect(Object.keys(result.docs)).toHaveLength(23);
    expect(Object.keys(result.aliases)).toEqual([...M4_ROOT_ALIAS_ORDER]);
    expect(result.aliasDocs).toEqual(M4_ROOT_ALIAS_DOCS);
    expect(Object.keys(result)).toEqual(['ok', 'valueSchema', 'aliases', 'docs', 'aliasDocs']);
  });

  it('G0.4 预算夹具无预算闭包发现序 = 夹具字面量（审计基准）', () => {
    const derived = budgetFixtureDerived();
    const result = resolveSchemaAtPath(derived, []);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('前置违反：预算夹具 `[]` 应 ok');
    expect(Object.keys(result.aliases)).toEqual([...BUDGET_ALIAS_ORDER]);
  });

  it('G8.1 两参调用静态可编译、重复调用逐字节确定、derived 零变异', () => {
    const derived = budgetFixtureDerived();
    const before = JSON.stringify(derived);
    const once = JSON.stringify(resolveSchemaAtPath(derived, []));
    const twice = JSON.stringify(resolveSchemaAtPath(derived, []));
    expect(twice).toBe(once);
    expect(JSON.stringify(derived)).toBe(before);
    // 夹具文本与求值入口不变性（红文件的静态前提）
    expect(BUDGET_FIXTURE_TEXT).toContain('type ROOT = YMap<{');
  });
});

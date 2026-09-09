/**
 * SA6 负控/基线测试 — resolveSchemaAtPath 契约的前提可执行性（Issue #272 / ADR-0016）。
 *
 * 本文件**不 import resolveSchemaAtPath**——它锚定红契约文件
 * (resolve-schema-at-path.test.ts) 的全部前提，证明红灯不是夹具/期望/工具链错误：
 *
 * - C1 夹具可解析可求值（evaluate 为绿色基线）；
 * - C2 夹具派生 schema 的文档三表/值树内容与红契约使用的期望字面量逐字一致
 *   （红契约内的每一条内容/形状期望在本文件对源表对账——夹具与期望零漂移）；
 * - C3 写侧路径守卫（validatePatch drillStep，既有绿色实现对偶）在同一夹具同一
 *   路径集上的判定 = 红契约读侧判定的机制性前提：
 *   · 写合法路径集（C3a）——红契约对应 ok:true（union/Record/optional/ref 位）；
 *   · 写「路径不存在」类拒绝（C3b）——红契约对应 SCHEMA_PATH_NOT_FOUND；
 *   · 写「路径段类型错误」类拒绝（C3c）——红契约对应 SCHEMA_PATH_INVALID；
 *   · 数组越界属 base 运行时判定（C3d）——读侧无 base、无越界概念（不锁读侧行为）。
 *
 * 断言全部经既有公共接缝（parseVfsl/evaluate/validatePatch）的可观测输出，不读源码。
 */
import { describe, expect, it } from 'vitest';
import { parseVfsl, evaluate, validatePatch } from '../src/index.js';
import type { DerivedSchema, ValueSchema, VfslModule, ValidateResult } from '../src/index.js';
import {
  FIXTURE_TEXT,
  DOC_AUDIT_CREATEDBY,
  DOC_ROOT_AUDIT,
  DOC_ROOT_NOTES,
  DOC_ROOT_KEYWORDS,
  DOC_ROOT_CONFIG,
  DOC_AUDIT_ALIAS,
  DOC_ASSET_ENTITY_ALIAS,
  ALL_NONEMPTY_DOCS,
  ALL_NONEMPTY_ALIAS_DOCS,
  VALUE_AUDIT,
  VALUE_ASSET_ENTITY_UNION,
  VALUE_ROOT,
  VALUE_U_UNION,
  SCALAR_STRING,
} from './resolve-schema-at-path-fixture.js';

function parseOk(text: string): VfslModule {
  const result = parseVfsl(text);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`前置 parseVfsl 失败（不应发生）：${JSON.stringify(result.issues)}`);
  }
  return result.module;
}

function evaluateFixture(text: string = FIXTURE_TEXT): DerivedSchema {
  const result = evaluate(parseOk(text));
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`evaluate 失败（前置不变量违反）：${JSON.stringify(result.issues)}`);
  }
  return result.derived;
}

function stripDiscriminators<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripDiscriminators(v)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'discriminator') continue;
      out[k] = stripDiscriminators(v);
    }
    return out as unknown as T;
  }
  return value;
}

function nonEmpty(record: Record<string, readonly string[]>): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {};
  for (const [k, v] of Object.entries(record)) {
    if (v.length > 0) out[k] = v;
  }
  return out;
}

/** 夹具合法 ROOT 快照（写侧对偶矩阵的 base；每次调用新对象）。 */
function validBase(): Record<string, unknown> {
  return {
    audit: { createdBy: 'jim' },
    assets: {
      img1: { kind: 'image', url: 'https://x/a.jpg', audit: { createdBy: 'jim' } },
      text1: { kind: 'text', body: '<p>hi</p>', audit: { createdBy: 'jim' } },
    },
    notes: 'hi',
    keywords: ['a', 'b'],
    u: { kind: 'a', x: 'v' },
    config: { retries: 3 },
    attachments: ['n1', 'n2'],
  };
}

/** 值树 ROOT object 节点的 fields（夹具前置；窄化类型以通过 strict 检查）。 */
function rootFields(d: DerivedSchema): Extract<ValueSchema, { kind: 'object' }>['fields'] {
  const root = d.values['ROOT'];
  if (root === undefined || root.kind !== 'object') {
    throw new Error(`夹具前置违反：values.ROOT 应为 object（实际 ${root?.kind ?? typeof root}）`);
  }
  return root.fields;
}

describe('resolveSchemaAtPath 负控 — C1 夹具求值基线', () => {
  it('夹具文本 parseVfsl ok 且 evaluate ok（红契约全部断言的前提成立）', () => {
    const derived = evaluateFixture();
    // 值/结构/索引/三表五大槽位齐全（derived.ts 冻结形状）
    expect(Object.keys(derived.aliases).sort()).toEqual(['AssetEntity', 'AssetId', 'Audit', 'ROOT', 'U']);
    expect(Object.keys(derived.values).sort()).toEqual(['AssetEntity', 'AssetId', 'Audit', 'ROOT', 'U']);
    expect(derived.index['ROOT']?.match).toBe('exact');
    expect(derived.index['ROOT.assets.<key>']?.keyPattern).toBe('^[A-Za-z0-9_\\-]{1,64}$');
  });
});

describe('resolveSchemaAtPath 负控 — C2 期望字面量与派生输出逐字对账（红契约零漂移）', () => {
  it('值树字面量对账：values.ROOT / Audit 精确一致；U / AssetEntity 按语义一致（判别式缓存不锁在场）', () => {
    const d = evaluateFixture();
    expect(d.values.ROOT).toEqual(VALUE_ROOT);
    expect(d.values.Audit).toEqual(VALUE_AUDIT);
    expect(stripDiscriminators(d.values.U)).toEqual(VALUE_U_UNION);
    expect(stripDiscriminators(d.values.AssetEntity)).toEqual(VALUE_ASSET_ENTITY_UNION);
  });

  it('Record 值位对账：values.ROOT.assets 含 "<key>" 槽与 keyPattern（解码后正则原文）', () => {
    const d = evaluateFixture();
    const assetsField = rootFields(d).find((f) => f.name === 'assets');
    expect(assetsField?.value).toMatchObject({
      kind: 'object',
      keyPattern: '^[A-Za-z0-9_\\-]{1,64}$',
    });
  });

  it('optional 位对账：notes/config 为 optional 包装（value 树字段值位）', () => {
    const d = evaluateFixture();
    const notes = rootFields(d).find((f) => f.name === 'notes');
    expect(notes?.value).toEqual({ kind: 'optional', value: SCALAR_STRING });
    const config = rootFields(d).find((f) => f.name === 'config');
    expect(config?.value).toMatchObject({ kind: 'optional' });
  });

  it('文档三表非空条目对账：fieldDocs/aliasDocs 的非空内容映射 == 红契约非空切片全集', () => {
    const d = evaluateFixture();
    expect(nonEmpty(d.fieldDocs)).toEqual(ALL_NONEMPTY_DOCS);
    expect(nonEmpty(d.aliasDocs)).toEqual(ALL_NONEMPTY_ALIAS_DOCS);
    // 逐条字面对账（含前导/尾随空白逐字纪律）
    expect(d.fieldDocs['Audit.createdBy']).toEqual([DOC_AUDIT_CREATEDBY]);
    expect(d.fieldDocs['ROOT.audit']).toEqual([DOC_ROOT_AUDIT]);
    expect(d.fieldDocs['ROOT.notes']).toEqual([DOC_ROOT_NOTES]);
    expect(d.fieldDocs['ROOT.keywords']).toEqual([DOC_ROOT_KEYWORDS]);
    expect(d.fieldDocs['ROOT.config']).toEqual([DOC_ROOT_CONFIG]);
    expect(d.aliasDocs['Audit']).toEqual([DOC_AUDIT_ALIAS]);
    expect(d.aliasDocs['AssetEntity']).toEqual([DOC_ASSET_ENTITY_ALIAS]);
    // 红契约的「无非空越界条目」前提：全表非空条目恰为上述（markerDocs 全空）
    expect(nonEmpty(d.markerDocs)).toEqual({});
    expect(d.aliasDocs['ROOT']).toEqual([]); // ROOT 别名级无注释（消除归属歧义的设计位）
  });

  it('判别式缓存位对账：U/AssetEntity 值 union 携带 discriminator（红契约不锁其在场，剥光比较按语义）', () => {
    const d = evaluateFixture();
    expect((d.values.U as { discriminator?: unknown }).discriminator).toBeDefined();
    expect((d.values.AssetEntity as { discriminator?: unknown }).discriminator).toBeDefined();
  });
});

describe('resolveSchemaAtPath 负控 — C3 写侧对偶判定（validatePatch 机制性前提）', () => {
  const writeOk = (p: Array<string | number>, v: unknown): void => {
    const r = validatePatch(evaluateFixture(), validBase(), p, v);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      throw new Error(`写侧对偶前置违反（路径应写合法）：${JSON.stringify(r.issues)}`);
    }
  };

  const writeIssues = (p: Array<string | number>, v: unknown): Extract<ValidateResult, { ok: false }> => {
    const r = validatePatch(evaluateFixture(), validBase(), p, v);
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error(`写侧对偶前置违反（路径应写拒绝）：${JSON.stringify(r)}`);
    }
    return r;
  };

  it('C3a 写合法路径集（红契约 ok:true 前提）：union 位 / Record+union 位 / optional 位 / 数组位 / 别名深位', () => {
    writeOk(['u', 'x'], 's'); // union any-member（member a 的 x）
    writeOk(['assets', 'img1', 'url'], 'u2'); // Record+union member0 字段
    writeOk(['keywords', 0], 'z'); // 数组元素位
    writeOk(['audit', 'createdBy'], 'ann'); // 别名内深位
    writeOk(['notes'], 'hi2'); // optional 整位（整体写）
    writeOk(['config', 'retries'], 7); // optional 透明展开后的内层字段
    writeOk(['attachments'], ['n9']); // YPlainArray 整位整体替换
  });

  it('C3b 写「路径不存在」类（红契约 SCHEMA_PATH_NOT_FOUND 前提）：未知字段 / union 无字段 / 标量下钻 / YPlainArray 内部', () => {
    const m1 = writeIssues(['nope'], 1);
    expect(m1.issues[0]?.message).toContain('路径不存在');
    const m2 = writeIssues(['u', 'z'], 1);
    expect(m2.issues[0]?.message).toContain('路径不存在');
    const m3 = writeIssues(['notes', 'x'], 1); // base.notes 在场 → 命中 leaf 终态拒绝
    expect(m3.issues[0]?.message).toContain('原生叶子（leaf）终态');
    const m4 = writeIssues(['attachments', 0], 'z');
    expect(m4.issues[0]?.message).toContain('YPlainArray 纯值终态');
  });

  it('C3c 写「路径段类型错误」类（红契约 SCHEMA_PATH_INVALID 前提）：对象位 number / 数组位 string / 数组位负数', () => {
    const m1 = writeIssues([0], 1);
    expect(m1.issues[0]?.message).toContain('路径段类型错误：对象位置需要 string 键段');
    const m2 = writeIssues(['keywords', '0'], 'z');
    expect(m2.issues[0]?.message).toContain('路径段类型错误：数组位置需要整数 number 下标段');
    const m3 = writeIssues(['keywords', -1], 'z');
    expect(m3.issues[0]?.message).toContain('路径段类型错误：数组位置需要整数 number 下标段');
  });

  it('C3d 边界澄清：数组越界 = base 运行时判定（非结构拒绝）；读侧解析无 base、无越界概念', () => {
    const r = writeIssues(['keywords', 2], 'z');
    expect(r.issues[0]?.message).toContain('数组下标越界');
  });

  it('C3e Record 键 Pattern = 写侧值级校验（非结构守卫）：keyPattern 失配键写入被值级拒绝（读侧 fail-closed 同向）', () => {
    const r = writeIssues(['assets', 'bad key!'], { kind: 'image', url: 'u', audit: { createdBy: 'j' } });
    expect(r.issues[0]?.message).toContain('Record 键');
    expect(r.issues[0]?.message).toContain('不满足 Pattern 正则');
  });
});

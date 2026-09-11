/**
 * SA6 红灯契约测试 — issue #308（readData 语义投影 docs 切片并入 memberDocs 第三来源）。
 *
 * 契约来源：SA6 验收契约 `wiki/raw/task_issue-308_sa6_contract.md` §12.2/§12.3（逐字
 * 转写）；母决策 ADR 0019 §7（docs 切片三来源 + 合并序 field → marker → member 末位）与
 * ADR 0016「投影体」节（选键规则、空条目过滤、四件套形状）。
 *
 * 目标行为（AC1）：读联合/枚举所在路径时，投影 `docs` 携带 `<member N>` 键的逐字成员
 * doc；marker 成员同时有 M3 doc 时合并次序为 marker 在前、member 在后。
 *
 * 断言一律经公共入口 `parseVfsl` → `evaluate` → `resolveSchemaAtPath`（包 index 导出），
 * 全部锚定可观测运行时行为（结果形状 / 内容逐字 / 键集 / 顺序），不读源码、不 grep 文本、
 * 不 skip/only。红灯基线（实现前 HEAD `4d4208b`）：docs 切片只扫 fieldDocs + markerDocs
 * 两表，`<member N>` 键缺失 → M1–M9 在目标断言处失败。
 */
import { describe, expect, it } from 'vitest';
import { evaluate, parseVfsl, resolveSchemaAtPath } from '../src/index.js';
import type { DerivedSchema, VfslModule } from '../src/index.js';
import { InternalError } from '../src/resolve.js';
import {
  EXPECTED_DOCS,
  M4_CONTRACT_PATHS,
  M4_MEMBER_DOCS_KEY_COUNT,
  M4_ROOT_ALIAS_DOCS,
  M4_ROOT_ALIAS_ORDER,
  M4_TEXT,
} from './resolve-schema-at-path-member-docs-fixture.js';

// —— 前置辅助（evaluate 为绿色基线；ok 断言是前置不变量而非本契约断言）——

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

/** M4 派生物（每次调用新对象；夹具文本逐字节 = SA6 §12.1）。 */
function m4(): DerivedSchema {
  return evaluateOk(M4_TEXT);
}

/** 条件稀疏 memberDocs 表（ADR 0019 决策 5；M4 夹具必须整键在场）。 */
function memberDocsOf(derived: DerivedSchema): Record<string, string[]> {
  const table = derived.memberDocs;
  if (table === undefined) {
    throw new Error('前置不变量违反：M4 派生物 memberDocs 键缺席（#306 已合入面）');
  }
  return table;
}

/** 解析并断言 ok:true，返回投影（失败即红，报告完整结果）。 */
function projection(derived: DerivedSchema, path: readonly (string | number)[]) {
  const r = resolveSchemaAtPath(derived, path);
  expect(r.ok, `期望 ok:true，实际 ${JSON.stringify(r)}`).toBe(true);
  if (!r.ok) throw new Error('unreachable（上方断言已拦）');
  return r;
}

describe('前置不变量 — M4 派生物形状（SA6 §12.2 补充前提断言）', () => {
  it('memberDocs 23 键在场、只含非空成员条目、fieldDocs 在 <member N> 键上恒无条目', () => {
    const derived = m4();
    const md = memberDocsOf(derived);
    expect(Object.keys(md)).toHaveLength(M4_MEMBER_DOCS_KEY_COUNT);
    for (const k of Object.keys(md)) {
      expect(md[k]!.length).toBeGreaterThan(0);
      expect(derived.fieldDocs[k]).toBeUndefined();
    }
  });

  it('marker+member 同键双非空唯一位置 = Mixed.<member 0>（M7 合并序前提）', () => {
    const derived = m4();
    const md = memberDocsOf(derived);
    const bothNonEmpty = Object.keys(derived.markerDocs).filter(
      (k) => (derived.markerDocs[k] ?? []).length > 0 && md[k] !== undefined,
    );
    expect(bothNonEmpty).toEqual(['Mixed.<member 0>']);
    expect(derived.markerDocs['Mixed.<member 0>']).toEqual([' 载体甲 ']);
    expect(md['Mixed.<member 0>']).toEqual([' 成员甲 ']);
  });
});

describe('AC1 — 闭包别名腿：读联合/枚举别名终点携带 <member N> 逐字 doc', () => {
  it('M1：读 ["u"] — U.<member 0/1> 逐字；值 schema = ref U、闭包 [U]、aliasDocs 空', () => {
    const r = projection(m4(), ['u']);
    expect(r.docs).toEqual({
      'U.<member 0>': [' 变体甲 '],
      'U.<member 1>': [' 变体乙 '],
    });
    expect(r.aliasDocs).toEqual({});
    expect(r.valueSchema).toEqual({ kind: 'ref', name: 'U' });
    expect(Object.keys(r.aliases)).toEqual(['U']);
  });

  it('M2：读 ["s"] — 枚举无成员结构，Status.<member 0/1> 只能由 memberDocs 回填', () => {
    const r = projection(m4(), ['s']);
    expect(r.docs).toEqual({
      'Status.<member 0>': [' 草稿：可继续编辑 '],
      'Status.<member 1>': [' 已提交：只可追加备注 '],
    });
    expect(r.aliasDocs).toEqual({ Status: [' 订单生命周期状态 '] });
    expect(r.valueSchema).toEqual({ kind: 'ref', name: 'Status' });
  });

  it('M8a：读 ["inl"] / ["inlEnum"] — 别名内联联合/枚举逐字成员 doc', () => {
    const base = m4();
    expect(projection(base, ['inl']).docs).toEqual({
      'Inl.<member 0>': [' 别名内联甲 '],
      'Inl.<member 1>': [' 别名内联乙 '],
    });
    expect(projection(base, ['inlEnum']).docs).toEqual({
      'InlEnum.<member 0>': [' 别名开 '],
      'InlEnum.<member 1>': [' 别名关 '],
    });
    expect(projection(base, ['inl']).aliasDocs).toEqual({});
    expect(projection(base, ['inlEnum']).aliasDocs).toEqual({});
  });
});

describe('AC1 — 终点子树腿：闭包为空的内联路径仍必须命中 <member N>', () => {
  it('M3：读 ["pair"] — 内联联合成员 doc；闭包 []', () => {
    const r = projection(m4(), ['pair']);
    expect(r.docs).toEqual({
      'ROOT.pair.<member 0>': [' 内联甲 '],
      'ROOT.pair.<member 1>': [' 内联乙 '],
    });
    expect(r.aliasDocs).toEqual({});
    expect(Object.keys(r.aliases)).toEqual([]);
  });

  it('M4：读 ["mode"] — 内联枚举成员 doc；值 schema = enum [on,off]、闭包 []', () => {
    const r = projection(m4(), ['mode']);
    expect(r.docs).toEqual({
      'ROOT.mode.<member 0>': [' 开 '],
      'ROOT.mode.<member 1>': [' 关 '],
    });
    expect(r.aliasDocs).toEqual({});
    expect(r.valueSchema).toEqual({ kind: 'enum', values: ['on', 'off'] });
    expect(Object.keys(r.aliases)).toEqual([]);
  });

  it('M5b：读 ["inlItems"] / ["inlItems",0] — 别名数组内联枚举成员 doc（<item>.<member N>）', () => {
    const base = m4();
    const expected = {
      'InlItem.<item>.<member 0>': [' 别名元素甲 '],
      'InlItem.<item>.<member 1>': [' 别名元素乙 '],
    };
    expect(projection(base, ['inlItems']).docs).toEqual(expected);
    expect(projection(base, ['inlItems', 0]).docs).toEqual(expected);
    expect(projection(base, ['inlItems']).aliasDocs).toEqual({});
    expect(projection(base, ['inlItems', 0]).aliasDocs).toEqual({});
  });

  it('M6：读 ["recInline","k1"] / ["inlRec","k1"] — Record 值位内联枚举成员 doc', () => {
    const base = m4();
    expect(projection(base, ['recInline', 'k1']).docs).toEqual({
      'ROOT.recInline.<key>.<member 0>': [' 记录甲 '],
      'ROOT.recInline.<key>.<member 1>': [' 记录乙 '],
    });
    expect(projection(base, ['inlRec', 'k1']).docs).toEqual({
      'InlRec.<key>.<member 0>': [' 别名记录甲 '],
      'InlRec.<key>.<member 1>': [' 别名记录乙 '],
    });
    expect(Object.keys(projection(base, ['recInline', 'k1']).aliases)).toEqual([]);
    expect(Object.keys(projection(base, ['inlRec', 'k1']).aliases)).toEqual([]);
  });
});

describe('AC1 — 数组元素别名 / 全量读 / 合并序', () => {
  it('M5a：读 ["items"] 与 ["items",0] — Choice.<member 0/1> 逐字', () => {
    const base = m4();
    const expected = {
      'Choice.<member 0>': [' 选项甲 '],
      'Choice.<member 1>': [' 选项乙 '],
    };
    expect(projection(base, ['items']).docs).toEqual(expected);
    expect(projection(base, ['items', 0]).docs).toEqual(expected);
    expect(projection(base, ['items']).aliasDocs).toEqual({});
    expect(projection(base, ['items', 0]).aliasDocs).toEqual({});
  });

  it('M7：读 ["m"] — marker 在前、member 在后；三源合并为空者不得成键', () => {
    const r = projection(m4(), ['m']);
    expect(r.docs).toEqual({ 'Mixed.<member 0>': [' 载体甲 ', ' 成员甲 '] });
    // 合并序逐字可判（JSON 序列化含两元素次序）
    expect(JSON.stringify(r.docs['Mixed.<member 0>'])).toBe('[" 载体甲 "," 成员甲 "]');
    expect(Object.keys(r.docs)).not.toContain('Mixed.<member 1>');
    expect(r.aliasDocs).toEqual({});
  });

  it('M8b：读 [] — 23 键全量逐字；aliasDocs = Status；闭包 8 名顺序不变', () => {
    const r = projection(m4(), []);
    expect(r.docs).toEqual(EXPECTED_DOCS);
    expect(Object.keys(r.docs)).toHaveLength(M4_MEMBER_DOCS_KEY_COUNT);
    expect(r.aliasDocs).toEqual(M4_ROOT_ALIAS_DOCS);
    expect(Object.keys(r.aliases)).toEqual(M4_ROOT_ALIAS_ORDER);
  });
});

describe('AC1 — 机械不变量（M9a/M9b）：三源拼接 + 不发明键 + 闭包腿全覆盖', () => {
  it('M9a：凡锚名 ∈ 闭包别名的 memberDocs 键，docs[k] = 三源逐字拼接', () => {
    const derived = m4();
    const md = memberDocsOf(derived);
    for (const p of M4_CONTRACT_PATHS) {
      const r = projection(derived, p);
      const aliasNames = Object.keys(r.aliases);
      for (const k of Object.keys(md)) {
        const inClosure = aliasNames.some((a) => k === a || k.startsWith(`${a}.`));
        if (!inClosure) continue;
        expect(r.docs[k], `M9a：路径 ${JSON.stringify(p)} 键 ${k}`).toEqual([
          ...(derived.fieldDocs[k] ?? []),
          ...(derived.markerDocs[k] ?? []),
          ...md[k]!,
        ]);
      }
    }
  });

  it('M9b：docs 键 ⊆ 三表键并集、内容逐字 = field+marker+member；aliasDocs ⊆ 表并逐字', () => {
    const derived = m4();
    const md = memberDocsOf(derived);
    const tableKeys = new Set([
      ...Object.keys(derived.fieldDocs),
      ...Object.keys(derived.markerDocs),
      ...Object.keys(md),
    ]);
    for (const p of M4_CONTRACT_PATHS) {
      const r = projection(derived, p);
      for (const [k, v] of Object.entries(r.docs)) {
        expect(tableKeys.has(k), `M9b：不发明键 ${k}（路径 ${JSON.stringify(p)}）`).toBe(true);
        expect(v, `M9b：三源拼接 ${k}`).toEqual([
          ...(derived.fieldDocs[k] ?? []),
          ...(derived.markerDocs[k] ?? []),
          ...(md[k] ?? []),
        ]);
      }
      for (const [k, v] of Object.entries(r.aliasDocs)) {
        expect(Object.hasOwn(derived.aliasDocs, k), `M9b：aliasDocs 不发明键 ${k}`).toBe(true);
        expect(v).toEqual(derived.aliasDocs[k]);
      }
    }
  });
});

describe('D4（非 SA6 契约项，设计 §7-D4 辅助断言）— memberDocs 在场畸形：可信域 loud，不泄漏裸 TypeError', () => {
  /** 手造派生 schema：memberDocs 在场但表级畸形（派生数据契约被篡改）。 */
  function malformed(memberDocs: unknown): DerivedSchema {
    const derived = JSON.parse(JSON.stringify(m4())) as Record<string, unknown>;
    derived['memberDocs'] = memberDocs;
    return derived as unknown as DerivedSchema;
  }

  it('memberDocs = null / [] / 非对象 → 可解析路径上 throw InternalError', () => {
    for (const bad of [null, [], 'not-a-record', 42]) {
      expect(
        () => resolveSchemaAtPath(malformed(bad), ['u']),
        `memberDocs=${JSON.stringify(bad)} 应 loud`,
      ).toThrow(InternalError);
    }
  });

  it('memberDocs 在场畸形 + 路径解析失败 → 仍为两码结果联合（不额外 throw，D4 守卫位置偏好）', () => {
    for (const bad of [null, []]) {
      const r = resolveSchemaAtPath(malformed(bad), ['doesNotExist']);
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error('unreachable（上方断言已拦）');
      expect(['SCHEMA_PATH_NOT_FOUND', 'SCHEMA_PATH_INVALID']).toContain(r.code);
    }
  });
});

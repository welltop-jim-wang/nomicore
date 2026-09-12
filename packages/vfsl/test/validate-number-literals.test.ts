/**
 * SA6 红/绿契约 — issue #314 C3：负 / 小数枚举成员的 f64 严格相等判定。
 *
 * 文本 fixture → parseVfsl → evaluate → derived enum（声明序）→ validateLogicalSnapshot
 * 命中 / 失配矩阵。下游语义（enum 折叠、`===` 严格相等、path 报告）为现状能力
 * （SA6 E1 手工 IR 已证），本文件锁定「拓宽后的文本经同一链路端到端可用」。
 *
 * 非目标（明确禁止在此断言，SA6 §12.4）：运行期 `-0`（对 `0` 成员或裸 `number`）的
 * 接受 / 拒绝语义属 ADR 0021 / issue #312；#314 只改文本侧字面量解析。
 *
 * 断言纪律：只观察公共接缝（parseVfsl / evaluate / validateLogicalSnapshot）的运行时
 * 输出；不 skip / 不软化 / 不 grep 源码。
 */
import { describe, expect, it } from 'vitest';
import { evaluate, parseVfsl, validateLogicalSnapshot } from '../src/index.js';
import type { DerivedSchema, ValidateIssue } from '../src/index.js';

/** C3 fixture：负整数 + 小数联合成员（声明序即 f64 值序）。 */
const FIXTURE = 'type ROOT = YMap<{ v: -1 | 0.5 | 2; d: 0.1 | 0.2 }>;';

/** 文本 → parse → evaluate（红因诊断：携带实际 issues）。 */
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

/** ROOT 对象的字段值 schema（字段名 → ValueSchema 节点）。 */
function rootField(name: string): DerivedSchema['values'][string] {
  const root = DERIVED.values['ROOT'];
  if (root === undefined) throw new Error('derived.values.ROOT 缺失');
  if (root.kind !== 'object') throw new Error(`ROOT 值 schema 非 object：${root.kind}`);
  const field = root.fields.find((f) => f.name === name);
  if (field === undefined) throw new Error(`字段 ${name} 缺失`);
  return field.value;
}

/** 期望校验通过。 */
function expectValid(snapshot: Record<string, number>): void {
  const result = validateLogicalSnapshot(DERIVED, snapshot);
  expect(result.ok, `期望 ok:true，实际 ${JSON.stringify(result)}`).toBe(true);
}

/** 期望校验失败，返回首条 issue。 */
function expectInvalid(snapshot: Record<string, number>): ValidateIssue {
  const result = validateLogicalSnapshot(DERIVED, snapshot);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('期望 ok:false，实际 ok:true');
  expect(result.issues).toHaveLength(1);
  const issue = result.issues[0];
  if (issue === undefined) throw new Error('issues 数组为空');
  return issue;
}

describe('C3 — derived：全字面量联合折叠为声明序 enum（负 / 小数值）', () => {
  it('字段 v → enum [-1, 0.5, 2]（声明序）', () => {
    const v = rootField('v');
    expect(v.kind).toBe('enum');
    if (v.kind !== 'enum') throw new Error(`期望 enum，实际 ${v.kind}`);
    // 声明序（非排序、非字符串化）：逐位 Object.is 相等（toBe）
    const expected = [-1, 0.5, 2];
    expect(v.values).toHaveLength(expected.length);
    v.values.forEach((actual, i) => expect(actual).toBe(expected[i]));
  });

  it('字段 d → enum [0.1, 0.2]（声明序；判别键 String 化后仍互异）', () => {
    const d = rootField('d');
    expect(d.kind).toBe('enum');
    if (d.kind !== 'enum') throw new Error(`期望 enum，实际 ${d.kind}`);
    expect(d.values).toEqual([0.1, 0.2]);
  });
});

describe('C3 — validateLogicalSnapshot：f64 严格相等（零 epsilon）', () => {
  it('命中：{v:-1,d:0.1} / {v:0.5,d:0.2} / {v:2,d:0.1} 全 ok:true', () => {
    expectValid({ v: -1, d: 0.1 });
    expectValid({ v: 0.5, d: 0.2 });
    expectValid({ v: 2, d: 0.1 });
  });

  it('失配 v：{v:1} → ok:false，path [\'v\']，消息含期望枚举值', () => {
    const issue = expectInvalid({ v: 1, d: 0.1 });
    expect(issue.path).toEqual(['v']);
    expect(issue.message).toContain('期望 -1 | 0.5 | 2');
    expect(issue.message).toContain('实际 number');
  });

  it('严格相等（零 epsilon）：2.0000000000000004（2 的后继双精度）不命中 2 → ok:false', () => {
    const issue = expectInvalid({ v: 2.0000000000000004, d: 0.1 });
    expect(issue.path).toEqual(['v']);
    expect(issue.message).toContain('期望 -1 | 0.5 | 2');
  });

  it('失配 d：0.5000000000000001 不命中 0.1 | 0.2 → ok:false，path [\'d\']', () => {
    const issue = expectInvalid({ v: -1, d: 0.5000000000000001 });
    expect(issue.path).toEqual(['d']);
    expect(issue.message).toContain('期望 0.1 | 0.2');
  });

  it('0.1 + 0.2（= 0.30000000000000004）不命中 0.1 | 0.2 → ok:false（十进制直觉非语义）', () => {
    const issue = expectInvalid({ v: -1, d: 0.1 + 0.2 });
    expect(issue.path).toEqual(['d']);
  });

  it('精确 f64 值命中：{v:-1,d:0.1} → ok:true', () => {
    expectValid({ v: -1, d: 0.1 });
  });
});

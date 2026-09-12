/**
 * SA6 红/绿契约 — issue #314 C4：负 / 小数字面量联合发射合法 TS。
 *
 * 文本 fixture → parseVfsl → evaluate → `generateProjection`；断言发射文本含负 / 小数值
 * 段且经**真实 TS 编译器**（仓内 typescript API，与 `tsc --noEmit` 同语义，见 tsc-helper）
 * 0 诊断。成员值语义：生成文本中每个数值段 `Number(段)` 与 IR 字面量逐位相等。
 *
 * 明确非要求（SA6 §12.5）：生成文本不要求可被 VFSL 回读（`1e-7` 是合法 TS 而 VFSL 指数
 * 记号仍 E100）；「指数记号不做」只作用于 VFSL 文本侧。
 *
 * 断言纪律：发射文本是产品（允许断言），但「合法 TS」一律由编译器诊断证明，不用正则冒充；
 * 不 skip / 不软化 / 不 grep 生成器源码。
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, parseVfsl } from '@nomicore/vfsl';
import { generateProjection } from '@nomicore/vfsl-codegen';
import type { DerivedSchema, ValueSchema } from '@nomicore/vfsl';
import type * as TS from 'typescript';
import { formatDiagnostics, preEmitDiagnostics } from './tsc-helper.js';

/** C4 fixture：负整数 / 小数联合 + f64 记法敏感的极小值（`0.0000001` → TS `1e-7`）。 */
const FIXTURE = `type ROOT = YMap<{
  v: -1 | 0.5 | 2;
  tiny: 0.0000001;
  neg: -1.5 | -0.25;
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
const OUT = generateProjection(DERIVED, { sourceText: FIXTURE });

/** 字段发射段：生成文本中该字段 `PathSchema<…>` 内的逐段文本（声明序）。 */
function emittedSegments(field: string): string[] {
  const re = new RegExp(`(?:^|\\n)\\s*'?${field}'?\\s*:\\s*PathSchema<([^>]*)>`, 'm');
  const match = re.exec(OUT);
  if (match === null) throw new Error(`生成文本未找到字段 ${field} 的 PathSchema 段`);
  const body = match[1];
  if (body === undefined) throw new Error(`字段 ${field} 的 PathSchema 段为空`);
  // 剥去节点 kind 段（leaf 字段恒 `, 'leaf'`），只留值段
  return body.replace(/,\s*'[a-z-]+'\s*$/, '').split('|').map((s) => s.trim());
}

/** derived 中 ROOT 字段的值 schema。 */
function derivedField(name: string): ValueSchema {
  const root = DERIVED.values['ROOT'];
  if (root === undefined) throw new Error('derived.values.ROOT 缺失');
  if (root.kind !== 'object') throw new Error(`ROOT 值 schema 非 object：${root.kind}`);
  const field = root.fields.find((f) => f.name === name);
  if (field === undefined) throw new Error(`字段 ${name} 缺失`);
  return field.value;
}

/** derived 中字段的 enum 字面量序列（声明序）。 */
function derivedEnumValues(name: string): Array<string | number> {
  const value = derivedField(name);
  if (value.kind !== 'enum') throw new Error(`字段 ${name} 值 schema 非 enum：${value.kind}`);
  return value.values;
}

/** 把生成文本写入临时文件并对全部 rootNames 建孤立 program 编译；返回诊断 + 清理。 */
function compileInTempDir(files: Array<{ name: string; text: string }>): {
  diagnostics: readonly TS.Diagnostic[];
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'vfsl-number-literals-tsc-'));
  const rootNames = files.map((f) => {
    const p = join(dir, f.name);
    writeFileSync(p, f.text, 'utf8');
    return p;
  });
  return {
    diagnostics: preEmitDiagnostics(rootNames),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe('C4 — 发射文本含负 / 小数字面量联合（String(number) 记法）', () => {
  it('返回 string，含 `PathSchema<-1 | 0.5 | 2, \'leaf\'>`', () => {
    expect(typeof OUT).toBe('string');
    expect(OUT).toContain(`PathSchema<-1 | 0.5 | 2, 'leaf'>`);
  });

  it('含负小数联合 `PathSchema<-1.5 | -0.25, \'leaf\'>`', () => {
    expect(OUT).toContain(`PathSchema<-1.5 | -0.25, 'leaf'>`);
  });

  it('含 f64 极小值 `PathSchema<1e-7, \'leaf\'>`（合法 TS、值等价；不要求 VFSL 回读）', () => {
    expect(OUT).toContain(`PathSchema<1e-7, 'leaf'>`);
  });
});

describe('C4 — 成员值语义：发射段 Number(段) === IR 字面量（逐位）', () => {
  it('v：发射段数值 = derived enum [-1, 0.5, 2]', () => {
    expect(emittedSegments('v').map(Number)).toEqual(derivedEnumValues('v'));
    expect(emittedSegments('v').map(Number)).toEqual([-1, 0.5, 2]);
  });

  it('tiny：发射段数值 = derived 字面量 0.0000001（1e-7 记法合法）', () => {
    expect(emittedSegments('tiny').map(Number)).toEqual(derivedEnumValues('tiny'));
    expect(emittedSegments('tiny').map(Number)).toEqual([0.0000001]);
  });

  it('neg：发射段数值 = derived enum [-1.5, -0.25]', () => {
    expect(emittedSegments('neg').map(Number)).toEqual(derivedEnumValues('neg'));
    expect(emittedSegments('neg').map(Number)).toEqual([-1.5, -0.25]);
  });
});

describe('C4 — 生成物原样（孤立 program）经真实 TS 编译器 0 诊断', () => {
  it('generated 文本写临时 .ts 后 preEmitDiagnostics 为空（即「发射合法 TS」）', () => {
    const { diagnostics, cleanup } = compileInTempDir([{ name: 'generated.ts', text: OUT }]);
    try {
      expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
    } finally {
      cleanup();
    }
  });
});

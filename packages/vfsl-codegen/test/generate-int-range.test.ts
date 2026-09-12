/**
 * SA6 红→绿契约 — issue #315 C6a：Int/Range 叶子生成 `number`（ADR 0020 决策 7 + ADR 0005）。
 *
 * 文本 fixture → parseVfsl → evaluate → `generateProjection`；断言发射文本中三形态字段的
 * 值投影为 `number`（数组元素位为索引 Record 内的 `PathSchema<number, 'leaf'>`），且生成物
 * 经**真实 TS 编译器**（仓内 typescript API，`preEmitDiagnostics`）0 诊断——不得抛
 * `structure/value desync`（HEAD 红灯形态）。
 *
 * 断言纪律：发射文本是产品（允许断言）；「合法 TS」一律由编译器诊断证明，不用正则冒充；
 * 不 skip / 不软化 / 不 grep 生成器源码。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluate, parseVfsl } from '@nomicore/vfsl';
import { generateProjection } from '@nomicore/vfsl-codegen';
import type { DerivedSchema, ValueSchema } from '@nomicore/vfsl';
import type * as TS from 'typescript';
import { formatDiagnostics, preEmitDiagnostics } from './tsc-helper.js';

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

/** ROOT 值 schema 字段值（前置判别：值叶确为 int/range）。 */
function derivedField(name: string): ValueSchema {
  const root = DERIVED.values['ROOT'];
  if (root === undefined || root.kind !== 'object') throw new Error('derived.values.ROOT 非 object');
  const field = root.fields.find((f) => f.name === name);
  if (field === undefined) throw new Error(`值字段缺失：${name}`);
  return field.value;
}

/**
 * 发射文本中 ROOT 接口成员 `name: PathSchema<…>` 的完整值段（含外层 PathSchema 与 kind 段）。
 * 以花括号平衡扫描取段（嵌套 `Record<\`${number}\`, …>` 亦正确切分）。
 */
function emittedFieldEntry(name: string): string {
  const re = new RegExp(`(?:^|\\n) {4}'?${name}'?\\??: `);
  const m = re.exec(OUT);
  if (m === null) throw new Error(`生成文本未找到字段 ${name} 的接口成员`);
  const start = m.index + m[0].length;
  if (!OUT.startsWith('PathSchema<', start)) {
    throw new Error(`字段 ${name} 的值段不是 PathSchema：${OUT.slice(start, start + 40)}`);
  }
  let i = start + 'PathSchema<'.length;
  let depth = 1;
  while (i < OUT.length && depth > 0) {
    const ch = OUT[i];
    if (ch === '<') depth += 1;
    else if (ch === '>') depth -= 1;
    i += 1;
  }
  if (depth !== 0) throw new Error(`字段 ${name} 的 PathSchema 段未闭合`);
  return OUT.slice(start, i);
}

/** 把生成文本写入临时文件并对全部 rootNames 建孤立 program 编译；返回诊断 + 清理。 */
function compileInTempDir(files: Array<{ name: string; text: string }>): {
  diagnostics: readonly TS.Diagnostic[];
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'vfsl-int-range-tsc-'));
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

describe('C6a — Int/Range 叶子投影 number（前置判别 + 发射文本）', () => {
  it('前置：derived 值叶确为 int/range（发射断言非空转）', () => {
    expect(derivedField('a')).toEqual({ kind: 'int' });
    expect(derivedField('b')).toEqual({ kind: 'int', min: 1, max: 100 });
    expect(derivedField('c')).toEqual({ kind: 'range', min: 0.5, max: 1.5 });
    expect(derivedField('d')).toEqual({ kind: 'range', min: -40, max: 85 });
    expect(derivedField('e')).toEqual({ kind: 'array', element: { kind: 'int', min: 0, max: 9 } });
  });

  it.each(['a', 'b', 'c', 'd', 'p', 'q'])("字段 %s 发射 `PathSchema<number, 'leaf'>`", (name) => {
    expect(emittedFieldEntry(name)).toBe("PathSchema<number, 'leaf'>");
  });

  it("数组元素位 e 发射 `PathSchema<Record<`${number}`, PathSchema<number, 'leaf'>>, 'array'>`", () => {
    expect(emittedFieldEntry('e')).toBe(
      "PathSchema<Record<`${number}`, PathSchema<number, 'leaf'>>, 'array'>",
    );
  });

  it('生成文本不含 desync 诊断文本（如实测抛错则本文件在 derive/generate 处先失败）', () => {
    expect(typeof OUT).toBe('string');
    expect(OUT).not.toContain('structure/value desync');
  });
});

describe('C6a — 生成物原样（孤立 program）经真实 TS 编译器 0 诊断', () => {
  it('generated 文本写临时 .ts 后 preEmitDiagnostics 为空（即「发射合法 TS」）', () => {
    const { diagnostics, cleanup } = compileInTempDir([{ name: 'generated.ts', text: OUT }]);
    try {
      expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
    } finally {
      cleanup();
    }
  });
});

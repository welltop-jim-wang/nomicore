/**
 * SA6 红→绿契约 — issue #315 C6a：Int/Range 叶子生成 `number`（ADR 0020 决策 7 + ADR 0005）。
 *
 * 文本 fixture → parseVfsl → evaluate → `generateProjection`；断言发射文本中三形态字段的
 * 值投影为 `number`（数组元素位为索引 Record 内的 `PathSchema<number, 'leaf'>`），且生成物
 * 经**真实 TS 编译器**（仓内 typescript API，`preEmitDiagnostics`）0 诊断——不得抛
 * `structure/value desync`（HEAD 红灯形态）。
 *
 * #316 覆盖补强（SA6 §12.2 C1c/C1e，同一文件加法式扩展，既有断言零改动）：
 * - C1c：生成物 + typed-access consumer **同 program** 编译——`PathAt`/`PathValue`/
 *   `PathPatchValue`（import 自 `@nomicore/vfsl-protocol`，生成文本只做 `VfslPathMap`
 *   增广）对 int/range 叶精确投影 `number`、写路径 fail-closed；独立负例文件恰 1 条
 *   TS2322 反证「投影确为 number 而非 `any`/`string`」；
 * - C1e：叶子闸门过宽放行负控——结构侧 leaf + 值侧未知 kind 的篡改派生物必须响亮
 *   `structure/value desync`，不得静默发射弱化类型。
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

// ─────────────── #316 C1c（T-1）：typed-access 编译级投影（generated + consumer 同 program） ───────────────

/**
 * consumer 文本：类型面一律 import 自 `@nomicore/vfsl-protocol`；`VfslPathMap` 由同 program
 * 生成文本的 `declare module` 增广（生成物不导出类型，ADR 0020 决策 7 的 `number` 原样）。
 * 敏感性：投影若退化为 `string`/`unknown`，`number` 赋值即报 TS2322；若退化为 `any`，
 * 两条 `@ts-expect-error` 反噬为「未使用」诊断（TS2578）。
 */
const TYPED_ACCESS_CONSUMER = `import type {
  PathAt,
  PathElementValue,
  PathPatchValue,
  PathValue,
  VfslPathMap,
  VfslTypedAccess,
} from '@nomicore/vfsl-protocol';

declare const access: VfslTypedAccess<VfslPathMap>;

// 读投影：int / range 叶 = number（非法值在类型层不可表达）
const readInt: PathValue<PathAt<VfslPathMap, ['b']>> = 42;
const readRange: PathValue<PathAt<VfslPathMap, ['c']>> = 0.5;
// 数组元素叶：int 叶经元素投影仍为 number（访问面 path 段限 string，元素位用 PathElementValue 锚定）
const readArrayElement: PathElementValue<PathAt<VfslPathMap, ['e']>> = 7;
// 写投影：int 叶 = 声明处 number（fail-closed rest 标记在场，缺参即 TS2554）
const patchInt: PathPatchValue<PathAt<VfslPathMap, ['b']>> = 100;

access.read(['b']);
access.patch(['b'], 42);
access.patch(['c'], 1.5);
// @ts-expect-error 写投影为 number：字符串被类型系统拒绝
access.patch(['b'], '42');
// @ts-expect-error 写投影为 number：布尔被类型系统拒绝
access.patch(['b'], true);

void readInt;
void readRange;
void readArrayElement;
void patchInt;
`;

/** 独立负例文件：把「投影确为 number」升级为编译器事实（恰 1 条 TS2322）。 */
const TYPED_ACCESS_NEGATIVE = `import type { PathAt, PathValue, VfslPathMap } from '@nomicore/vfsl-protocol';

const bad: PathValue<PathAt<VfslPathMap, ['b']>> = '42';
void bad;
`;

describe('C1c — typed-access 编译级投影（PathAt/PathValue/PathPatchValue 对 int/range 叶成立）', () => {
  it('generated + consumer 同 program：读/写投影为 number、非法值 fail-closed（0 诊断）', () => {
    const { diagnostics, cleanup } = compileInTempDir([
      { name: 'generated.ts', text: OUT },
      { name: 'consumer.ts', text: TYPED_ACCESS_CONSUMER },
    ]);
    try {
      expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it("敏感性反证：`PathValue<…> = '42'` 负例文件恰产生 1 条 TS2322（投影退化 any/string 则 0 条）", () => {
    const { diagnostics, cleanup } = compileInTempDir([
      { name: 'generated.ts', text: OUT },
      { name: 'negative.ts', text: TYPED_ACCESS_NEGATIVE },
    ]);
    try {
      expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe(2322);
    } finally {
      cleanup();
    }
  });
});

// ─────────────── #316 C1e（T-2）：叶子闸门过宽放行负控（leaf 结构 + 未知 value kind） ───────────────

describe('C1e — 叶子闸门过宽放行负控（未知 value kind 响亮 desync，不得静默发射）', () => {
  it("把 ROOT.b 值侧篡改为 {kind:'xml'}（结构侧仍 leaf）→ generateProjection 抛错含 structure/value desync", () => {
    const tampered = JSON.parse(JSON.stringify(DERIVED)) as DerivedSchema;
    const root = tampered.values['ROOT'];
    if (root === undefined || root.kind !== 'object') throw new Error('篡改前提失败：values.ROOT 非 object');
    const field = root.fields.find((f) => f.name === 'b');
    if (field === undefined) throw new Error('篡改前提失败：值字段 b 缺失');
    field.value = { kind: 'xml' }; // 结构树 b 仍为 leaf → 两树失配
    expect(() => generateProjection(tampered, { sourceText: FIXTURE })).toThrow(/structure\/value desync/);
  });
});

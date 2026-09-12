/**
 * issue #336（ADR-0024 T3）readData 形状预算 —— **负控 / 回归锚**（恒绿；设计 §12-T2）。
 *
 * 覆盖：
 * 1. 无 options 逐字节回归锚：`readData(path)` 的 value 与 doc-runtime 公共读取直调
 *    逐字段相等；schema 与 vfsl 公共 resolver 独立预言机（#273 oracle 形态）深等且
 *    `JSON.stringify` 逐字节相等；信封差异恰为新增两键（truncated/truncations）；
 * 2. 失败分支键集：PATH_NOT_ALLOWED / RUNTIME_READ_DISABLED 恰四键、不带截断键；
 *    lifecycle 停接纳优先；敌意 path 在预算模式下的 `schema:null` 收敛、ok 恒真、零 throw；
 * 3. detach 纪律（预算）：连续两次同参预算读深度相等但引用互异（含标记 clue），
 *    调用方 mutation（含改写 marker.clue）不污染后续读数；不冻结。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { compileSchemaEnvelope, resolveSchemaAtPath } from '@nomicore/vfsl';
import { readLogicalValueAtPath } from '@nomicore/doc-runtime';
import type { NamespaceRuntime } from '../src/index.js';
import { expectReadDataOkKeys } from './helpers/readdata-ok-shape.js';
import {
  ENV_336,
  makeBudgetRuntime,
  makeBudgetRuntimeWithDoc,
} from './runtime-readdata-shape-budget-fixture.js';

interface TruncationEntry {
  readonly path: readonly (string | number)[];
  readonly kind: 'depth' | 'width';
  readonly omitted: number;
}

interface OkShape {
  readonly ok: true;
  readonly value: unknown;
  readonly schema: { readonly valueSchema: unknown; readonly [k: string]: unknown } | null;
  readonly truncated: boolean;
  readonly truncations: readonly TruncationEntry[];
}

function ok(r: unknown, label: string): OkShape {
  if ((r as { ok?: unknown }).ok !== true) {
    throw new Error(`${label}：契约前提失败（期望 ok:true，实际 ${JSON.stringify(r)}）`);
  }
  return r as OkShape;
}

const FAILURE_KEYS = ['code', 'message', 'ok', 'path'] as const;

const compiled = compileSchemaEnvelope(ENV_336);
if (!compiled.ok) throw new Error(`oracle 前提失败：${JSON.stringify(compiled.issues)}`);
const DERIVED = compiled.derived;

/** 独立预言机（vfsl 公共 resolver，#273 oracle 形态）。 */
function oracleSchema(path: readonly (string | number)[]): {
  valueSchema: unknown;
  aliases: Record<string, unknown>;
  docs: Record<string, readonly string[]>;
  aliasDocs: Record<string, readonly string[]>;
} {
  const resolved = resolveSchemaAtPath(DERIVED, path);
  if (!resolved.ok) throw new Error(`oracle 前提失败：路径 ${JSON.stringify(path)} → ${resolved.code}`);
  return {
    valueSchema: resolved.valueSchema,
    aliases: resolved.aliases,
    docs: resolved.docs,
    aliasDocs: resolved.aliasDocs,
  };
}

/** 首个截断标记节点（预算投影探针）。 */
function findMarker(node: unknown): Record<string, unknown> | null {
  if (node === null || typeof node !== 'object') return null;
  const rec = node as Record<string, unknown>;
  if (rec.kind === 'truncated') return rec;
  for (const value of Object.values(rec)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const hit = findMarker(item);
        if (hit !== null) return hit;
      }
    } else {
      const hit = findMarker(value);
      if (hit !== null) return hit;
    }
  }
  return null;
}

describe('无 options 逐字节回归锚：值与投影内容与 T3 前逐字节一致（ADR-0024 L29/L67）', () => {
  const PATHS: ReadonlyArray<readonly (string | number)[]> = [
    [],
    ['meta'],
    ['meta', 'content'],
    ['tags'],
    ['tags', 1],
    ['nick'],
    ['count'],
  ];

  it('readData(path) 的 value ≡ readLogicalValueAtPath(doc, path) 值；schema ≡ resolver 四件套（深等 + JSON 逐字节）', async () => {
    const { runtime, doc } = await makeBudgetRuntimeWithDoc();
    for (const path of PATHS) {
      const r = ok(runtime.readData(path), `control/${JSON.stringify(path)}`);
      expectReadDataOkKeys(r);
      // 信封差异恰为新增两键：无预算读恒空清单 + truncated=false
      expect(r.truncated).toBe(false);
      expect(Array.isArray(r.truncations)).toBe(true);
      expect(r.truncations).toStrictEqual([]);
      // 值通道 oracle = doc-runtime 公共直调（同一 doc）
      const t1 = readLogicalValueAtPath(doc, path);
      if (!t1.ok) throw new Error(`oracle 前提失败：${JSON.stringify(path)} 值读 ${t1.code}`);
      expect(r.value).toStrictEqual(t1.value);
      expect(JSON.stringify(r.value)).toBe(JSON.stringify(t1.value));
      // 投影通道 oracle = vfsl resolver 公共直调
      const oracle = oracleSchema(path);
      expect(r.schema).toStrictEqual(oracle);
      expect(JSON.stringify(r.schema)).toBe(JSON.stringify(oracle));
    }
    await runtime.close();
  });
});

describe('失败分支键集与敌意 path 收敛（预算模式对偶采样；ADR-0024 L67）', () => {
  it('PATH_NOT_ALLOWED（非数组 path / 标量下钻）恰四键、不带截断键', async () => {
    const runtime = await makeBudgetRuntime();
    const notArray = runtime.readData('nope' as unknown as readonly (string | number)[]);
    expect(notArray.ok).toBe(false);
    expect((notArray as { code: string }).code).toBe('PATH_NOT_ALLOWED');
    expect(Object.keys(notArray).sort()).toStrictEqual([...FAILURE_KEYS]);
    const scalarDrill = runtime.readData(['count', 'x']);
    expect(scalarDrill.ok).toBe(false);
    expect(Object.keys(scalarDrill).sort()).toStrictEqual([...FAILURE_KEYS]);
    await runtime.close();
  });

  it('RUNTIME_READ_DISABLED（closing/closed）恰四键、不带截断键、零 doc 触碰', async () => {
    const runtime = await makeBudgetRuntime();
    await runtime.close();
    const r = runtime.readData(['meta']);
    expect(r.ok).toBe(false);
    expect((r as { code: string }).code).toBe('RUNTIME_READ_DISABLED');
    expect(Object.keys(r).sort()).toStrictEqual([...FAILURE_KEYS]);
  });

  it('敌意 path（重定义 Symbol.iterator 的真数组）+ 预算：值通道照常、schema:null 收敛、ok 恒真、零 throw、恒五键', async () => {
    const runtime = await makeBudgetRuntime();
    const hostilePath: Array<string | number> = ['count'];
    Object.defineProperty(hostilePath, Symbol.iterator, {
      value: () => {
        throw new Error('probe: hostile iterator');
      },
      configurable: true,
    });
    const r = ok(runtime.readData(hostilePath, { depth: 1 }), 'hostile-path');
    expectReadDataOkKeys(r);
    expect(r.value).toBe(3);
    expect(r.schema).toBeNull();
    await runtime.close();
  });
});

describe('detach 纪律（预算投影，含截断标记）：全新副本、零冻结、零缓存', () => {
  it('连续两次同参预算读：深度相等、引用互异（schema/valueSchema/标记 clue 对象）；mutation 不污染后续读数', async () => {
    const runtime: NamespaceRuntime = await makeBudgetRuntime();
    const pristine = ok(runtime.readData([], { depth: 1 }), 'detach-pristine');
    expect(pristine.schema).not.toBeNull();
    const pristineJson = JSON.stringify(pristine.schema);
    const marker = findMarker(pristine.schema!.valueSchema);
    expect(marker, 'detach 前提：预算投影须含标记节点').not.toBeNull();

    const second = ok(runtime.readData([], { depth: 1 }), 'detach-second');
    expect(second.schema).toStrictEqual(pristine.schema);
    expect(second.schema).not.toBe(pristine.schema);
    expect(second.schema!.valueSchema).not.toBe(pristine.schema!.valueSchema);
    const secondMarker = findMarker(second.schema!.valueSchema)!;
    expect(secondMarker).not.toBe(marker);
    expect(secondMarker.clue).not.toBe(marker!.clue);
    expect(Object.isFrozen(pristine.schema)).toBe(false);

    // 调用方 mutation（含标记 clue 改写）后重读逐字节不受污染
    (marker as Record<string, unknown>).clue = { via: 'container', containerKind: 'object' };
    (pristine.schema as unknown as { valueSchema: unknown }).valueSchema = null;
    const third = ok(runtime.readData([], { depth: 1 }), 'detach-third');
    expect(JSON.stringify(third.schema)).toBe(pristineJson);
    expect(third.schema!.valueSchema).not.toBeNull();
    await runtime.close();
  });
});

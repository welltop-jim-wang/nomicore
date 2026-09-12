/**
 * 形状预算类型契约 — @nomicore/doc-runtime readLogicalValueAtPath 三参形态与封闭 options
 * （issue #334 / ADR-0024 决策 1；SA6 验收契约 §12.1 T1-1…T1-8 + §12.7 TD1–TD6）。
 *
 * 断言纪律（同仓 test-d 先例）：全部锚定签名/类型投影；
 * - 重载解析：2 参调用静态型恰为 ReadLogicalValueResult（旧联合逐字不动）、3 参合法对象调用
 *   静态型恰为 ReadLogicalValueAtPathBudgetResult；
 * - 负例一律 `@ts-expect-error` 自我反转：任一负例被实现误放行（未知键/类型不符/数组/
 *   裸非对象/显式 undefined 第三参/参数个数不符）→ unused directive → 本文件红；
 * - 新名目经 src/index.ts 导入锚定：任一缺失 → TS2305 → 红。
 *
 * 红灯现状：三参签名与新类型名目今日整体不存在 → 3 参调用 TS2554、类型导入 TS2305、本文件红。
 */
import { describe, expectTypeOf, it } from 'vitest';
import * as Y from 'yjs';
import { readLogicalValueAtPath } from '../src/index.js';
import type {
  ReadLogicalValueAtPathBudgetResult,
  ReadLogicalValueAtPathOptions,
  ReadLogicalValueResult,
  ReadLogicalValueTruncationEntry,
} from '../src/index.js';

declare const doc: Y.Doc;

describe('TD1 无 options（2 参）静态型 — 恰为未改动的 ReadLogicalValueResult', () => {
  it('2 参调用静态返回型恰为 ReadLogicalValueResult；成功分支无截断键', () => {
    const r = readLogicalValueAtPath(doc, []);
    expectTypeOf(r).toEqualTypeOf<ReadLogicalValueResult>();
    if (r.ok) {
      expectTypeOf(r.value).toEqualTypeOf<unknown>();
      // @ts-expect-error —— 无 options 成功面不得出现 truncated（T1-1/T1-3/TD1）
      r.truncated;
      // @ts-expect-error —— 无 options 成功面不得出现 truncations（T1-1/T1-3/TD1）
      r.truncations;
    }
  });
});

describe('TD2 三参（预算）静态型 — ReadLogicalValueAtPathBudgetResult 成功分支', () => {
  it('3 参调用静态返回型恰为 ReadLogicalValueAtPathBudgetResult；成功分支四字段齐全', () => {
    const r = readLogicalValueAtPath(doc, [], {});
    expectTypeOf(r).toEqualTypeOf<ReadLogicalValueAtPathBudgetResult>();
    if (r.ok) {
      expectTypeOf(r.value).toEqualTypeOf<unknown>();
      expectTypeOf(r.truncated).toEqualTypeOf<boolean>();
      expectTypeOf(r.truncations).toEqualTypeOf<readonly ReadLogicalValueTruncationEntry[]>();
    }
  });
});

describe('TD3 预算失败分支 — 双码联合与 path 回显', () => {
  it('失败分支 code 恰为 PATH_NOT_ALLOWED | READ_OPTIONS_INVALID；path 为段数组', () => {
    const r = readLogicalValueAtPath(doc, [], {});
    if (!r.ok) {
      expectTypeOf(r.code).toEqualTypeOf<'PATH_NOT_ALLOWED' | 'READ_OPTIONS_INVALID'>();
      expectTypeOf(r.path).toEqualTypeOf<readonly (string | number)[]>();
    }
  });
});

describe('TD4 options 封闭形状 — 合法/非法编译期投影', () => {
  it('合法 options：{}、{depth}、{depth:-0}、{maxChildrenPerNode}、双轴', () => {
    readLogicalValueAtPath(doc, [], {});
    readLogicalValueAtPath(doc, [], { depth: 0 });
    readLogicalValueAtPath(doc, [], { depth: -0 });
    readLogicalValueAtPath(doc, [], { maxChildrenPerNode: 0 });
    readLogicalValueAtPath(doc, [], { depth: 0, maxChildrenPerNode: 1 });
  });

  it('非法 options 一律编译错误（@ts-expect-error 自我反转）', () => {
    // @ts-expect-error —— 未知多余键（封闭形状，T1-4）
    readLogicalValueAtPath(doc, [], { bogus: 1 });
    // @ts-expect-error —— 轴值类型不符（T1-4）
    readLogicalValueAtPath(doc, [], { depth: '1' });
    // @ts-expect-error —— 轴值类型不符（T1-4）
    readLogicalValueAtPath(doc, [], { maxChildrenPerNode: null });
    // @ts-expect-error —— 数组不是封闭形状 options（weak type TS2559，T1-4）
    readLogicalValueAtPath(doc, [], []);
    // @ts-expect-error —— 裸非对象（T1-4）
    readLogicalValueAtPath(doc, [], 42);
    // @ts-expect-error —— 裸 null（T1-4）
    readLogicalValueAtPath(doc, [], null);
    // @ts-expect-error —— exactOptionalPropertyTypes：显式 undefined 不可赋给可选轴（H11）
    readLogicalValueAtPath(doc, [], { depth: undefined });
  });
});

describe('TD5 参数个数纪律 — 1/2/3 参面与显式 undefined 第三参拒绝', () => {
  it('@ts-expect-error：缺 path（1 参）、4 参、显式 undefined 第三参（T1-5）', () => {
    // @ts-expect-error —— 缺 path 参数
    readLogicalValueAtPath(doc);
    // @ts-expect-error —— 多余第 4 参
    readLogicalValueAtPath(doc, [], {}, {});
    // @ts-expect-error —— 显式 undefined 第三参：options 形参非可选（T1-5 类型层）
    readLogicalValueAtPath(doc, [], undefined);
  });
});

describe('TD6 新类型名目经公共入口可导入（任一缺失即 TS2305 红）', () => {
  it('ReadLogicalValueAtPathOptions / ReadLogicalValueTruncationEntry / ReadLogicalValueAtPathBudgetResult 投影正确', () => {
    const options: ReadLogicalValueAtPathOptions = { depth: 1 };
    expectTypeOf(options.depth).toEqualTypeOf<number | undefined>();
    expectTypeOf(options.maxChildrenPerNode).toEqualTypeOf<number | undefined>();

    const entry: ReadLogicalValueTruncationEntry = { path: ['a'], kind: 'width', omitted: 1 };
    expectTypeOf(entry.path).toEqualTypeOf<readonly (string | number)[]>();
    expectTypeOf(entry.kind).toEqualTypeOf<'depth' | 'width'>();
    expectTypeOf(entry.omitted).toEqualTypeOf<number>();

    expectTypeOf<ReadLogicalValueAtPathBudgetResult>().toMatchTypeOf<{ ok: boolean }>();
    expectTypeOf<ReadLogicalValueResult>().toMatchTypeOf<{ ok: boolean }>();
  });
});

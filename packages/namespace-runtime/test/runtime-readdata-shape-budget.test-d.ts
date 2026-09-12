/**
 * issue #336（ADR-0024 T3）类型面锚 —— runtime `readData` 双结果联合 + 双重载（设计 §12-T3）。
 *
 * 锚定机制（vitest --typecheck / `tsc -p tsconfig.typecheck.json`）：
 * - 【红】当前 `NamespaceRuntimeReadDataResult` 成功成员恰三键、`readData` 单参、
 *   `NamespaceRuntimeReadDataBudgetResult` / `NamespaceRuntimeReadDataOptions` 不存在——
 *   五键 `keyof` 探针与重载探针整体红；SA3 落位后转绿。
 * - 零泄漏：`READ_OPTIONS_INVALID` 只属于预算联合（doc-runtime T1 双联合注记预期的
 *   Extract 派生零泄漏点），legacy 联合不得含该码。
 * - 失败面无新键：两联合的失败成员都不得携带 truncated/truncations。
 * - 重载序：legacy 重载排最后（`ReturnType` 取末签名 → `_readAlias` 锚原文保持）；
 *   预算调用结果含 READ_OPTIONS_INVALID 成员 → 不得赋给 legacy 联合（反向锁）。
 */
import { describe, it } from 'vitest';
import type {
  NamespaceRuntime,
  NamespaceRuntimeReadDataBudgetResult,
  NamespaceRuntimeReadDataOptions,
  NamespaceRuntimeReadDataResult,
  ReadLogicalValueTruncationEntry,
} from '@nomicore/namespace-runtime';
import type { BudgetedReadDataSchemaProjection, ReadDataSchemaProjection } from '@nomicore/vfsl';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type AssertTrue<T extends true> = T;

type LegacyOk = Extract<NamespaceRuntimeReadDataResult, { ok: true }>;
type BudgetOk = Extract<NamespaceRuntimeReadDataBudgetResult, { ok: true }>;

// —— 五键恒形：keyof 精确集合（多一键/少一键即红）——
type _legacyFiveKeys = AssertTrue<
  Equal<keyof LegacyOk, 'ok' | 'value' | 'schema' | 'truncated' | 'truncations'>
>;
type _budgetFiveKeys = AssertTrue<
  Equal<keyof BudgetOk, 'ok' | 'value' | 'schema' | 'truncated' | 'truncations'>
>;
type _legacyTruncated = AssertTrue<Equal<LegacyOk['truncated'], boolean>>;
type _legacyTruncations = AssertTrue<
  Equal<LegacyOk['truncations'], readonly ReadLogicalValueTruncationEntry[]>
>;
type _legacySchema = AssertTrue<Equal<LegacyOk['schema'], ReadDataSchemaProjection | null>>;
type _budgetSchema = AssertTrue<Equal<BudgetOk['schema'], BudgetedReadDataSchemaProjection | null>>;

// —— 零泄漏：READ_OPTIONS_INVALID 只属于预算联合 ——
type _legacyNoOptionsCode = AssertTrue<
  Equal<Extract<NamespaceRuntimeReadDataResult, { code: 'READ_OPTIONS_INVALID' }>, never>
>;
type _budgetHasOptionsCode = AssertTrue<
  Equal<
    Extract<NamespaceRuntimeReadDataBudgetResult, { ok: false; code: 'READ_OPTIONS_INVALID' }> extends never
      ? never
      : true,
    true
  >
>;

// —— 失败面无新键（既有失败分支形状不动）——
type _legacyFailureNoNewKeys = AssertTrue<
  Equal<Extract<NamespaceRuntimeReadDataResult, { ok: false; truncated: unknown }>, never>
>;
type _budgetFailureNoNewKeys = AssertTrue<
  Equal<Extract<NamespaceRuntimeReadDataBudgetResult, { ok: false; truncated: unknown }>, never>
>;

// —— 重载序：legacy 排最后（ReturnType 取末签名；registry `_readAlias` 锚原文保持的前提）——
type _legacyReturnType = AssertTrue<
  Equal<ReturnType<NamespaceRuntime['readData']>, NamespaceRuntimeReadDataResult>
>;

/** 预算 options 为 doc-runtime 单源类型别名（零复制）。 */
type _optionsAlias = AssertTrue<
  Equal<NamespaceRuntimeReadDataOptions, { depth?: number; maxChildrenPerNode?: number }>
>;

// 声明期证明（仅 typecheck 用，零运行时值）。
export type RuntimeReadDataShapeAssertions = {
  readonly legacyFiveKeys: _legacyFiveKeys;
  readonly budgetFiveKeys: _budgetFiveKeys;
  readonly legacyTruncated: _legacyTruncated;
  readonly legacyTruncations: _legacyTruncations;
  readonly legacySchema: _legacySchema;
  readonly budgetSchema: _budgetSchema;
  readonly legacyNoOptionsCode: _legacyNoOptionsCode;
  readonly budgetHasOptionsCode: _budgetHasOptionsCode;
  readonly legacyFailureNoNewKeys: _legacyFailureNoNewKeys;
  readonly budgetFailureNoNewKeys: _budgetFailureNoNewKeys;
  readonly legacyReturnType: _legacyReturnType;
  readonly optionsAlias: _optionsAlias;
};

declare const runtime: NamespaceRuntime;

describe('类型面：readData 双重载（单参 → legacy 联合；双参 → 预算联合）', () => {
  it('单参调用命中 legacy 联合、双参调用命中预算联合；预算联合不得赋给 legacy 联合（反向零泄漏锁）', () => {
    const legacyCall: NamespaceRuntimeReadDataResult = runtime.readData([]);
    const budgetCall: NamespaceRuntimeReadDataBudgetResult = runtime.readData([], { depth: 1 });
    void legacyCall;
    void budgetCall;
    // @ts-expect-error 预算联合含 READ_OPTIONS_INVALID 成员——不得赋给 legacy 联合（零泄漏反向锁）
    const leak: NamespaceRuntimeReadDataResult = runtime.readData([], { depth: 1 });
    void leak;
  });
});

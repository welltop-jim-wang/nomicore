/**
 * issue #336（ADR-0024 T3）类型面锚 —— registry `NamespaceLease.readData` 预算别名与
 * 双重载（设计 §12-T6）。
 *
 * 锚定机制（vitest --typecheck）：
 * - 【红】当前 lease 单签名、`NamespaceLeaseReadDataBudgetResult` 不存在——预算别名
 *   Equal 锁与重载探针红；SA3 落位后转绿；
 * - 别名组合锁：`NamespaceLeaseReadDataBudgetResult = NamespaceRuntimeReadDataBudgetResult
 *   | NamespaceLeaseReleasedIssue`（沿 legacy 别名先例；lease 层零预算解释）；
 * - 零泄漏：released/legacy 面不得混入 `READ_OPTIONS_INVALID`（只在预算联合）；
 * - 重载序镜像 runtime：legacy 排最后（`ReturnType` 取末签名 → `_readAlias` 锚原文保持）。
 */
import { describe, it } from 'vitest';
import type {
  NamespaceLease,
  NamespaceLeaseReadDataBudgetResult,
  NamespaceLeaseReadDataResult,
  NamespaceLeaseReleasedIssue,
} from '@nomicore/namespace-registry';
import type { NamespaceRuntimeReadDataBudgetResult } from '@nomicore/namespace-runtime';
import type { BudgetedReadDataSchemaProjection, ReadDataSchemaProjection } from '@nomicore/vfsl';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type AssertTrue<T extends true> = T;

type LeaseLegacyOk = Extract<NamespaceLeaseReadDataResult, { ok: true }>;
type LeaseBudgetOk = Extract<NamespaceLeaseReadDataBudgetResult, { ok: true }>;

// —— 别名组合锁（lease 预算结果 = runtime 预算联合 | released issue）——
type _budgetAlias = AssertTrue<
  Equal<NamespaceLeaseReadDataBudgetResult, NamespaceRuntimeReadDataBudgetResult | NamespaceLeaseReleasedIssue>
>;
type _budgetHasReleased = AssertTrue<
  Equal<Extract<NamespaceLeaseReadDataBudgetResult, { code: 'NAMESPACE_LEASE_RELEASED' }>, NamespaceLeaseReleasedIssue>
>;

// —— 五键恒形（镜像 runtime 成功面）——
type _legacyFiveKeys = AssertTrue<
  Equal<keyof LeaseLegacyOk, 'ok' | 'value' | 'schema' | 'truncated' | 'truncations'>
>;
type _budgetFiveKeys = AssertTrue<
  Equal<keyof LeaseBudgetOk, 'ok' | 'value' | 'schema' | 'truncated' | 'truncations'>
>;
type _legacySchema = AssertTrue<Equal<LeaseLegacyOk['schema'], ReadDataSchemaProjection | null>>;
type _budgetSchema = AssertTrue<Equal<LeaseBudgetOk['schema'], BudgetedReadDataSchemaProjection | null>>;

// —— 零泄漏：READ_OPTIONS_INVALID 只属于预算别名 ——
type _legacyNoOptionsCode = AssertTrue<
  Equal<Extract<NamespaceLeaseReadDataResult, { code: 'READ_OPTIONS_INVALID' }>, never>
>;
type _budgetHasOptionsCode = AssertTrue<
  Equal<
    Extract<NamespaceLeaseReadDataBudgetResult, { ok: false; code: 'READ_OPTIONS_INVALID' }> extends never
      ? never
      : true,
    true
  >
>;

// —— 失败面无新键（既有失败分支形状不动）——
type _legacyFailureNoNewKeys = AssertTrue<
  Equal<Extract<NamespaceLeaseReadDataResult, { ok: false; truncated: unknown }>, never>
>;
type _budgetFailureNoNewKeys = AssertTrue<
  Equal<Extract<NamespaceLeaseReadDataBudgetResult, { ok: false; truncated: unknown }>, never>
>;

// —— 重载序：legacy 排最后（ReturnType 取末签名）——
type _legacyReturnType = AssertTrue<
  Equal<ReturnType<NamespaceLease['readData']>, NamespaceLeaseReadDataResult>
>;

// 声明期证明（仅 typecheck 用，零运行时值）。
export type LeaseReadDataBudgetAssertions = {
  readonly budgetAlias: _budgetAlias;
  readonly budgetHasReleased: _budgetHasReleased;
  readonly legacyFiveKeys: _legacyFiveKeys;
  readonly budgetFiveKeys: _budgetFiveKeys;
  readonly legacySchema: _legacySchema;
  readonly budgetSchema: _budgetSchema;
  readonly legacyNoOptionsCode: _legacyNoOptionsCode;
  readonly budgetHasOptionsCode: _budgetHasOptionsCode;
  readonly legacyFailureNoNewKeys: _legacyFailureNoNewKeys;
  readonly budgetFailureNoNewKeys: _budgetFailureNoNewKeys;
  readonly legacyReturnType: _legacyReturnType;
};

declare const lease: NamespaceLease;

describe('类型面：lease.readData 双重载（单参 → legacy 别名；双参 → 预算别名）', () => {
  it('单参命中 legacy 别名、双参命中预算别名；预算别名不得赋给 legacy 别名（反向零泄漏锁）', () => {
    const legacyCall: NamespaceLeaseReadDataResult = lease.readData([]);
    const budgetCall: NamespaceLeaseReadDataBudgetResult = lease.readData([], { depth: 1 });
    void legacyCall;
    void budgetCall;
    // @ts-expect-error 预算别名含 READ_OPTIONS_INVALID 成员——不得赋给 legacy 别名（零泄漏反向锁）
    const leak: NamespaceLeaseReadDataResult = lease.readData([], { depth: 1 });
    void leak;
  });
});

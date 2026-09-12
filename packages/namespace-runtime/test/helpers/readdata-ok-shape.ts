/**
 * issue #333（T0）+ issue #336（T3 形状修订）：readData 成功分支形状的统一断言/构造面。
 *
 * 形状权威（T3 落位后）：ADR-0024 决策 4（修订 ADR-0016 恰三键条款）——成功分支**恒五键**
 * `{ ok: true, value, schema, truncated, truncations }`：value 键恒在场（缺席为显式
 * undefined）、schema 为 `ReadDataSchemaProjection | null`、truncated === truncations.length > 0
 * （B14）、无截断时 truncations 恒为数组（空清单也是数组，无「缺席 = 无截断」隐式约定）。
 * 恰三键 → 五键修订即在本模块单点完成（T0 的交付目的：10 个消费文件零源码改动）。
 *
 * schema 保持**纯面**（`ReadDataSchemaProjection | null`，不加宽为含预算标记投影——
 * SA2 N3 钉死）：typed stub（`() => readDataOk(...)` 赋给 runtime 替身的 readData）依赖
 * 「ReadDataOkShape ⊆ 两联合成功成员」的可赋值性（纯 ⊆ Budgeted 单向成立）；加宽会使 stub
 * 对 legacy 重载不可赋值。**预算断言纪律**：预算读结果只用 `expectReadDataOkKeys`
 * （五键键集）+ 定点断言（逐字段）——不对含标记投影做 `expectReadDataOk` 整形状断言。
 *
 * ★ 反伪绿不变量（SA6 契约 C2.3 的结构前提）：`expectReadDataOk` 不得以任何方式
 *   从 `readDataOk` 派生其期望对象（反之亦然）。二者必须各自独立内联构造形状：
 *   替身/生产任一侧的形状突变（M1/M2）只应改变 actual 一侧，才能被断言面击穿。
 *   把两者合并为单一构造函数会让 M2 突变同时改写 actual 与 expected → 伪绿。
 */
import { expect } from 'vitest';
import type { ReadDataSchemaProjection } from '@nomicore/vfsl';
import type { ReadLogicalValueTruncationEntry } from '@nomicore/doc-runtime';

/** 成功分支恰五键键集（字母序——与既有键集断言的 .sort() 语义一致；T3 修订点）。 */
export const READDATA_OK_KEYS = ['ok', 'schema', 'truncated', 'truncations', 'value'] as const;

/** 成功分支恰五键形状——`NamespaceRuntimeReadDataResult` / `…BudgetResult` 成功成员的
 *  精确同构（保持 typed stub 的 TS2322 类型锁：接口键集漂移时 stub 在此编译失败）。 */
export interface ReadDataOkShape {
  readonly ok: true;
  readonly value: unknown;
  readonly schema: ReadDataSchemaProjection | null;
  readonly truncated: boolean;
  readonly truncations: readonly ReadLogicalValueTruncationEntry[];
}

/** 生产者侧：测试替身/工厂构造 readData 成功返回值（每次新鲜普通对象）。缺省参数 =
 *  无截断（既有双参调用点零改动编译通过）。 */
export function readDataOk(
  value: unknown,
  schema: ReadDataSchemaProjection | null,
  truncated = false,
  truncations: readonly ReadLogicalValueTruncationEntry[] = [],
): ReadDataOkShape {
  const shape: ReadDataOkShape = { ok: true, value, schema, truncated, truncations };
  return shape;
}

/** 断言侧（family A 替换）：恰五键全等断言——多一键/少一键/ok 非真/value 或 schema
 *  不深等即失败；期望值独立内联构造（见文件头反伪绿不变量）。truncated/truncations
 *  缺省为无截断（false / 空数组）。 */
export function expectReadDataOk(
  actual: unknown,
  expected: {
    value: unknown;
    schema: ReadDataSchemaProjection | null;
    truncated?: boolean;
    truncations?: readonly ReadLogicalValueTruncationEntry[];
  },
): void {
  const expectedShape: ReadDataOkShape = {
    ok: true,
    value: expected.value,
    schema: expected.schema,
    truncated: expected.truncated ?? false,
    truncations: expected.truncations ?? [],
  };
  expect(actual).toStrictEqual(expectedShape);
}

/** 键集侧（family B 替换）：恰五键整键集断言（只断键集，不比较值）。 */
export function expectReadDataOkKeys(actual: object): void {
  expect(Object.keys(actual).sort()).toStrictEqual(READDATA_OK_KEYS);
}

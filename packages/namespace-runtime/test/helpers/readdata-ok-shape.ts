/**
 * issue #333（T0）：readData 成功分支「恰三键」形状的统一断言/构造面。
 *
 * 形状权威：ADR-0016（{ ok: true, value, schema }，value 键恒在场、缺席为显式
 * undefined；schema 为 ReadDataSchemaProjection | null）；T3（ADR-0024 决策 4）
 * 将在本模块内把形状修订为恒五键——所有调用站点不感知键集。
 *
 * ★ 反伪绿不变量（SA6 契约 C2.3 的结构前提）：`expectReadDataOk` 不得以任何方式
 *   从 `readDataOk` 派生其期望对象（反之亦然）。二者必须各自独立内联构造形状：
 *   替身/生产任一侧的形状突变（M1/M2）只应改变 actual 一侧，才能被断言面击穿。
 *   把两者合并为单一构造函数会让 M2 突变同时改写 actual 与 expected → 伪绿。
 */
import { expect } from 'vitest';
import type { ReadDataSchemaProjection } from '@nomicore/vfsl';

/** 成功分支恰三键键集（字母序——与既有键集断言的 .sort() 语义一致）。 */
export const READDATA_OK_KEYS = ['ok', 'schema', 'value'] as const;

/** 成功分支恰三键形状——`NamespaceRuntimeReadDataResult` 成功成员的精确同构
 *  （保持 typed stub 的 TS2322 类型锁：T3 接口加键时 stub 在此编译失败）。 */
export interface ReadDataOkShape {
  readonly ok: true;
  readonly value: unknown;
  readonly schema: ReadDataSchemaProjection | null;
}

/** 生产者侧：测试替身/工厂构造 readData 成功返回值（每次新鲜普通对象）。 */
export function readDataOk(value: unknown, schema: ReadDataSchemaProjection | null): ReadDataOkShape {
  const shape: ReadDataOkShape = { ok: true, value, schema };
  return shape;
}

/** 断言侧（family A 替换）：恰三键全等断言——多一键/少一键/ok 非真/value 或
 *  schema 不深等即失败；期望值独立内联构造（见文件头反伪绿不变量）。 */
export function expectReadDataOk(
  actual: unknown,
  expected: { value: unknown; schema: ReadDataSchemaProjection | null },
): void {
  const expectedShape: ReadDataOkShape = { ok: true, value: expected.value, schema: expected.schema };
  expect(actual).toStrictEqual(expectedShape);
}

/** 键集侧（family B 替换）：恰三键整键集断言（只断键集，不比较值）。 */
export function expectReadDataOkKeys(actual: object): void {
  expect(Object.keys(actual).sort()).toStrictEqual(READDATA_OK_KEYS);
}

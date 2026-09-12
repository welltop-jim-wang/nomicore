/**
 * Issue #335 红灯契约（类型面）— 投影通道形状预算公共名目与三参签名。
 *
 * 契约来源：SA6 §12.2 G1（G1.1–G1.5）、设计 §6.4/§6.8/§7.1、母法 ADR 0024 L77/L79 +
 * ADR 0016 修订节第 3 条。
 *
 * 红灯机制（HEAD）：三参调用 TS2554、公共 index 无预算名目 TS2305/TS2724 → 本文件在
 * `vitest --typecheck` / 包 tsc 双入口红；SA3 实现公共面后翻绿。类型断言只经
 * `expectTypeOf` 与 `@ts-expect-error` 投影，无运行时产物（typecheck 只类型检查、不执行）。
 */
import { describe, expectTypeOf, it } from 'vitest';
import { isSchemaTruncationMarker, resolveSchemaAtPath } from '../src/index.js';
import type {
  BudgetedReadDataSchemaProjection,
  BudgetedResolveSchemaAtPathResult,
  BudgetedValueSchema,
  DerivedSchema,
  ReadDataSchemaProjection,
  ResolveSchemaAtPathResult,
  ResolveSchemaBudgetOptions,
  SchemaTruncationClue,
  SchemaTruncationMarker,
  ValueSchema,
} from '../src/index.js';

declare const derived: DerivedSchema;
declare const path: readonly (string | number)[];
declare const options: ResolveSchemaBudgetOptions;
declare const budgeted: BudgetedResolveSchemaAtPathResult;
declare const marker: SchemaTruncationMarker;

type NineKinds =
  | 'object'
  | 'array'
  | 'xml'
  | 'union'
  | 'enum'
  | 'pattern'
  | 'scalar'
  | 'optional'
  | 'ref';

describe('#335 G1 公共 API 与类型面', () => {
  it('G1.1 三参调用编译通过（含显式 undefined）；两参调用仍合法', () => {
    const two = resolveSchemaAtPath(derived, path);
    const three = resolveSchemaAtPath(derived, path, options);
    const explicitUndefined = resolveSchemaAtPath(derived, path, undefined);
    expectTypeOf(two).toEqualTypeOf<ResolveSchemaAtPathResult>();
    expectTypeOf(three).toEqualTypeOf<BudgetedResolveSchemaAtPathResult>();
    expectTypeOf(explicitUndefined).toEqualTypeOf<BudgetedResolveSchemaAtPathResult>();
  });

  it('G1.1 options 为封闭形状（未知键静态拒绝）且字段可选数字', () => {
    expectTypeOf<ResolveSchemaBudgetOptions>().toMatchTypeOf<{
      readonly depth?: number;
      readonly maxChildrenPerNode?: number;
    }>();
    const both: ResolveSchemaBudgetOptions = { depth: 1, maxChildrenPerNode: 2 };
    expectTypeOf(both).toMatchTypeOf<ResolveSchemaBudgetOptions>();
    // @ts-expect-error options 为封闭形状：未知键静态拒绝（ADR 0024 L30 同精神）
    resolveSchemaAtPath(derived, path, { maxNodes: 1 });
    // @ts-expect-error depth 必须为 number
    resolveSchemaAtPath(derived, path, { depth: '1' });
  });

  it('G1.2 包装联合是 ValueSchema 的超集；预算投影类型别名正确', () => {
    expectTypeOf<ValueSchema>().toMatchTypeOf<BudgetedValueSchema>();
    expectTypeOf<SchemaTruncationMarker>().toMatchTypeOf<BudgetedValueSchema>();
    expectTypeOf<BudgetedReadDataSchemaProjection>().toEqualTypeOf<
      ReadDataSchemaProjection<BudgetedValueSchema>
    >();
    // 无预算投影体缺省实例化逐字段同型（既有消费者零感知）
    expectTypeOf<ReadDataSchemaProjection>().toEqualTypeOf<ReadDataSchemaProjection<ValueSchema>>();
  });

  it('G1.2 标记与线索形状：kind=truncated + 线索嵌套判别联合', () => {
    expectTypeOf(marker.kind).toEqualTypeOf<'truncated'>();
    expectTypeOf(marker.clue.via).toEqualTypeOf<'ref' | 'container'>();
    const refClue: SchemaTruncationClue = { via: 'ref', name: 'Audit' };
    const containerClue: SchemaTruncationClue = { via: 'container', containerKind: 'array' };
    expectTypeOf(refClue).toMatchTypeOf<SchemaTruncationClue>();
    expectTypeOf(containerClue).toMatchTypeOf<SchemaTruncationClue>();
    // @ts-expect-error 线索判别联合不含未知 via
    const bad: SchemaTruncationClue = { via: 'weird', name: 'X' };
    expectTypeOf(bad).toMatchTypeOf<SchemaTruncationClue>();
  });

  it('G1.2 公共守卫 isSchemaTruncationMarker 收窄 unknown', () => {
    expectTypeOf(isSchemaTruncationMarker).toBeFunction();
    expectTypeOf(isSchemaTruncationMarker).parameter(0).toEqualTypeOf<unknown>();
    const node: unknown = marker;
    if (isSchemaTruncationMarker(node)) {
      expectTypeOf(node).toEqualTypeOf<SchemaTruncationMarker>();
    }
  });

  it('G1.3 无预算结果类型纯度：无预算 valueSchema/aliases 恒纯 ValueSchema', () => {
    const result = resolveSchemaAtPath(derived, path);
    if (result.ok) {
      expectTypeOf(result.valueSchema).toEqualTypeOf<ValueSchema>();
      expectTypeOf(result.aliases).toEqualTypeOf<Record<string, ValueSchema>>();
      // @ts-expect-error 无预算 valueSchema 类型不含 truncated 判别（包装联合不得污染）
      if (result.valueSchema.kind === 'truncated') {
        // 不可能到达
      }
    }
  });

  it('G1.4 ValueSchema 九 kind 冻结（新增 kind 即红）', () => {
    expectTypeOf<ValueSchema['kind']>().toEqualTypeOf<NineKinds>();
    // @ts-expect-error 标记不是 ValueSchema 成员（投影层包装、非扩 kind）
    const invalid: ValueSchema = marker;
    expectTypeOf(invalid).toEqualTypeOf<ValueSchema>();
    // @ts-expect-error 'truncated' 不在九 kind 冻结面内
    const invalidKind: ValueSchema['kind'] = 'truncated';
    expectTypeOf(invalidKind).toEqualTypeOf<NineKinds>();
  });

  it('G1.5 预算结果 ok 分支：valueSchema/aliases 容纳标记成员（含失败三码）', () => {
    if (budgeted.ok) {
      expectTypeOf(budgeted.valueSchema).toEqualTypeOf<BudgetedValueSchema>();
      expectTypeOf(budgeted.aliases).toEqualTypeOf<Record<string, BudgetedValueSchema>>();
      expectTypeOf(budgeted.docs).toEqualTypeOf<Record<string, readonly string[]>>();
      expectTypeOf(budgeted.aliasDocs).toEqualTypeOf<Record<string, readonly string[]>>();
      // 十案判别共享 `kind` 字面量：truncated 分支在联合内可达
      if (budgeted.valueSchema.kind === 'truncated') {
        expectTypeOf(budgeted.valueSchema).toEqualTypeOf<SchemaTruncationMarker>();
      }
    } else {
      expectTypeOf(budgeted.code).toEqualTypeOf<
        'SCHEMA_PATH_NOT_FOUND' | 'SCHEMA_PATH_INVALID' | 'SCHEMA_OPTIONS_INVALID'
      >();
      expectTypeOf(budgeted.path).toBeArray();
    }
  });
});

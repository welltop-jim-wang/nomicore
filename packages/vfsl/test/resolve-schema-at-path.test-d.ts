/**
 * SA6 红灯契约测试（类型面）— resolveSchemaAtPath 公共类型名目与签名（Issue #272 /
 * ADR-0016「解析语义」签名块 +「投影体」节）。
 *
 * 锚定内容（ADR-0016 为权威）：
 * - `resolveSchemaAtPath` 经 vfsl 公共入口（包 index）以值导出，签名
 *   `(derived: DerivedSchema, path: readonly (string | number)[])`，同步；
 * - 结果联合 `ResolveSchemaAtPathResult`：
 *   `{ok:true, valueSchema, aliases, docs, aliasDocs}`（投影四件套）| `{ok:false,
 *   code:'SCHEMA_PATH_NOT_FOUND'|'SCHEMA_PATH_INVALID', path}`——失败码为两枚字面量
 *   联合的判别分支；ok 分支不带 code（判别干净）；
 * - 投影体名目 `ReadDataSchemaProjection` 字段形状与 ADR-0016「投影体」块一致：
 *   valueSchema: ValueSchema；aliases: Record<string, ValueSchema>；
 *   docs/aliasDocs: Record<string, readonly string[]>。
 *
 * 红灯机制（vitest --typecheck / 包 tsc 双入口）：当前 index.ts 未导出三枚名目 →
 * 无指令 import 报 TS2305 → 红；SA3 按 ADR 签名实现公共导出后翻绿。类型断言只经
 * expectTypeOf 投影，无运行时产物。
 */
import { describe, expectTypeOf, it } from 'vitest';
import { resolveSchemaAtPath } from '../src/index.js';
import type {
  DerivedSchema,
  ReadDataSchemaProjection,
  ResolveSchemaAtPathResult,
  ValueSchema,
} from '../src/index.js';

// 纯类型占位（typecheck 只类型检查、不执行本文件）
declare const derived: DerivedSchema;
declare const path: readonly (string | number)[];
declare const projection: ReadDataSchemaProjection;
declare const result: ResolveSchemaAtPathResult;

describe('resolveSchemaAtPath 类型面 — 公共名目与签名（ADR-0016）', () => {
  it('index 导出同步函数 resolveSchemaAtPath，签名 (derived: DerivedSchema, path: readonly (string|number)[])', () => {
    expectTypeOf(resolveSchemaAtPath).toBeFunction();
    expectTypeOf(resolveSchemaAtPath).parameter(0).toEqualTypeOf<DerivedSchema>();
    expectTypeOf(resolveSchemaAtPath).parameter(1).toEqualTypeOf<readonly (string | number)[]>();
    expectTypeOf(resolveSchemaAtPath(derived, path)).toEqualTypeOf<ResolveSchemaAtPathResult>();
  });

  it('结果联合判别：ok 分支 = 投影四件套（ValueSchema / 别名表 / 双文档切片）', () => {
    if (result.ok) {
      expectTypeOf(result.valueSchema).toEqualTypeOf<ValueSchema>();
      expectTypeOf(result.aliases).toEqualTypeOf<Record<string, ValueSchema>>();
      expectTypeOf(result.docs).toEqualTypeOf<Record<string, readonly string[]>>();
      expectTypeOf(result.aliasDocs).toEqualTypeOf<Record<string, readonly string[]>>();
      // ok 分支不带失败码（判别干净）——此处类型错误存在 = 契约满足
      // @ts-expect-error ok 分支不应有 code 键
      result.code;
    } else {
      // 失败分支 = 两枚稳定码 + path 回显
      expectTypeOf(result.code).toEqualTypeOf<'SCHEMA_PATH_NOT_FOUND' | 'SCHEMA_PATH_INVALID'>();
      expectTypeOf(result.path).toMatchTypeOf<readonly (string | number)[]>();
      expectTypeOf(result.path).toBeArray();
    }
  });

  it('投影体名目 ReadDataSchemaProjection 可导入且形状与 ADR-0016「投影体」一致', () => {
    expectTypeOf(projection.valueSchema).toEqualTypeOf<ValueSchema>();
    expectTypeOf(projection.aliases).toEqualTypeOf<Record<string, ValueSchema>>();
    expectTypeOf(projection.docs).toEqualTypeOf<Record<string, readonly string[]>>();
    expectTypeOf(projection.aliasDocs).toEqualTypeOf<Record<string, readonly string[]>>();
  });
});

/**
 * SA6 红灯类型锚（issue #273 / ADR-0016）— runtime 层 readData 结果联合 ok 分支
 * 必须演进为 `{ ok: true; value: unknown; schema: ReadDataSchemaProjection | null }`
 * （AC1「runtime 层形状」类型面）。
 *
 * 锚定机制（vitest --typecheck / `tsc -p tsconfig.typecheck.json` 下红/绿翻转）：
 * - 【红】`NamespaceRuntimeReadDataResult` 的 ok 成员当前为 doc-runtime
 *   `ReadLogicalValueResult` 零包装透传 `{ ok: true; value }`——`Extract<…, { ok: true;
 *   value: unknown; schema: ReadDataSchemaProjection | null }>` 求值为 never →
 *   `true` 赋值 TS2322 → 红；SA3 把成功分支重定型为带 schema 的新形状（schema 精确
 *   可空——无 undefined 第三态）→ 绿。
 * - 【绿（保持性守卫）】doc-runtime `ReadLogicalValueResult` ok 成员必须保持 schema
 *   无关（schema 只进 namespace-runtime 组合边界，doc-runtime 零改动）——若 doc-runtime
 *   读结果被塞入 schema，守卫翻转红。
 *
 * 行为面锚见 runtime-readdata-schema-projection-red.test.ts（15 条运行时红灯）。
 */
import { describe, it } from 'vitest';
import type { NamespaceRuntimeReadDataResult } from '@nomicore/namespace-runtime';
import type { ReadLogicalValueResult } from '@nomicore/doc-runtime';
import type { ReadDataSchemaProjection } from '@nomicore/vfsl';

/**
 * ok 分支形状探针：联合中须存在携带 `schema: ReadDataSchemaProjection | null` 的
 * ok:true 成员（value 同时在场）。当前零包装联合无此成员 → never → 红。
 */
type HasSchemaOnOk<T> =
  Extract<T, { ok: true; value: unknown; schema: ReadDataSchemaProjection | null }> extends never
    ? never
    : true;

/** 保持性守卫：doc-runtime 读结果 ok 成员不得携带任何 schema 键（schema 无关保持）。 */
type DocReadOkStillSchemaless<T> =
  Extract<T, { ok: true; schema: unknown }> extends never
    ? true
    : never;

describe('类型面：NamespaceRuntimeReadDataResult 成功分支携带可空语义 schema 投影（AC1）', () => {
  it('ok:true 成员形状 = { value, schema: ReadDataSchemaProjection | null }（当前红灯：零包装联合无 schema）', () => {
    const anchored: HasSchemaOnOk<NamespaceRuntimeReadDataResult> = true;
    void anchored;
  });
});

describe('类型面：doc-runtime ReadLogicalValueResult 保持 schema 无关（分层保持守卫）', () => {
  it('ok 成员不得出现 schema 键（doc-runtime 读取面零改动）', () => {
    const guarded: DocReadOkStillSchemaless<ReadLogicalValueResult> = true;
    void guarded;
  });
});

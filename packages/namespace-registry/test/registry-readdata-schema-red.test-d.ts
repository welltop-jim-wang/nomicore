/**
 * SA6 红灯类型锚（issue #273 / ADR-0016）— lease 层 readData 结果别名必须跟随
 * runtime 新形状（AC1「runtime 与 lease 两层类型一致」类型面）。
 *
 * 锚定机制（vitest --typecheck / `tsc -p tsconfig.typecheck.json` 下红/绿翻转）：
 * - 【红】`NamespaceLeaseReadDataResult` 现为
 *   `ReadLogicalValueResult | RuntimeReadDisabledResult | NamespaceLeaseReleasedIssue`
 *   （types.ts lease 公开别名直引 doc-runtime 旧联合）——ok 成员无 schema：
 *   `Extract<…, { ok: true; value: unknown; schema: ReadDataSchemaProjection | null }>`
 *   求值 never → `true` 赋值 TS2322 → 红；lease 别名跟随 runtime 新形状
 *   （lease 透传行为零变化，行为面由 runtime 契约覆盖）→ 绿。
 * - 【绿（保持性守卫）】leased/released/disabled 失败面不得混入 ok:true 形状——ok
 *   判别与失败通道保持（本锚只认 ok:true + schema 的成员存在性，不误报失败成员）。
 *
 * 行为面：lease.readData 为 entry.runtime.readData 直透传（lease.ts），runtime 契约
 * 即 lease 行为契约；registry 侧本锚锁类型跟随。
 */
import { describe, it } from 'vitest';
import type { NamespaceLeaseReadDataResult } from '@nomicore/namespace-registry';
import type { ReadDataSchemaProjection } from '@nomicore/vfsl';

/** ok 分支形状探针：联合中须存在携带 `schema: ReadDataSchemaProjection | null` 的
 *  ok:true 成员。当前 lease 别名直引旧联合 → never → 红。 */
type HasSchemaOnLeaseOk<T> =
  Extract<T, { ok: true; value: unknown; schema: ReadDataSchemaProjection | null }> extends never
    ? never
    : true;

describe('类型面：NamespaceLeaseReadDataResult 别名跟随 runtime 新形状（AC1）', () => {
  it('lease readData 成功分支携带可空语义 schema 投影（当前红灯：别名直引旧联合无 schema）', () => {
    const anchored: HasSchemaOnLeaseOk<NamespaceLeaseReadDataResult> = true;
    void anchored;
  });
});

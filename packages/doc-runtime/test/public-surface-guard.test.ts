/**
 * SA6 红灯测试（运行时值面）— @nomicore/doc-runtime 公共入口恢复导出
 * `applyValidatedMutation`（issue #90 / 任务简报「关键上下文 3」）。
 *
 * 契约来源（任务简报 关键上下文 3）：
 * - `applyValidatedMutation` 公共面状态：packages/doc-runtime/src/mutation.ts 已实现
 *   set-only `applyValidatedMutation`（ADR-0007 管线：零写入/单事务/fatal 契约）；
 * - 该入口在 commit 21b0eed 以「待 #76 四操作契约」下架；#76 现已 CLOSED
 *   （COMPLETED，随 #87 PR #96 以 set-only 最小落地收口，无独立 PR）；
 * - 本任务 AC5 要求 namespace-runtime 调用 applyValidatedMutation → doc-runtime
 *   公共面恢复导出（set-only 现状）+ 公共面守卫测试同步更新属本任务范围；
 * - ADR-0007 明文将 applyValidatedMutation 列为 @nomicore/doc-runtime 公共入口；
 *   成功只返回 {ok:true}；领域失败经 ok:false 结果联合。
 *
 * 断言纪律（锚定运行时行为，非源码文本）：
 * - 以 `import * as docRuntime from '../src/index.js'` 取公共入口命名空间 → 只做
 *   模块导出观测（存在性 / 值形态），不做任何源码 grep / 字符串形状断言；
 * - 类型名目（MutationIssue / ApplyValidatedMutationResult）的导入锚定见
 *   public-surface-type-guard.test-d.ts（vitest --typecheck @ts-expect-error 机制）。
 *
 * 红灯现状（当前基线，index.ts 尚未 `export { applyValidatedMutation }`）：
 * - 命名空间上不存在 `applyValidatedMutation` → `typeof ns.applyValidatedMutation ===
 *   'function'` 断言失败 → 本文件红。
 * 修绿（SA3）：从 src/index.ts 恢复 `export { applyValidatedMutation }`
 * （含类型名目 MutationIssue / ApplyValidatedMutationResult）→ 本文件转绿。
 */
import { describe, expect, it } from 'vitest';
import * as docRuntime from '../src/index.js';

const ns = docRuntime as Record<string, unknown>;

describe('@nomicore/doc-runtime 公共入口 — applyValidatedMutation 恢复导出（issue #90 范围）', () => {
  it('公共入口存在值导出 applyValidatedMutation 且为函数（ADR-0007 公共入口条款 + 任务简报关键上下文 3）', () => {
    expect(Object.prototype.hasOwnProperty.call(ns, 'applyValidatedMutation')).toBe(true);
    expect(typeof ns.applyValidatedMutation).toBe('function');
  });

  it('owner 要求继续交付的五项值导出仍在位（材料化 / fatal / 提取 / 读取 / 替换）', () => {
    expect(typeof ns.materializeRoot).toBe('function');
    expect(typeof ns.DocRuntimeFatalError).toBe('function'); // class 构造器即 function
    expect(typeof ns.extractYjsSnapshot).toBe('function');
    expect(typeof ns.readLogicalValueAtPath).toBe('function');
    expect(typeof ns.replaceRootContent).toBe('function');
  });

  it('公共入口的值导出面恰含 applyValidatedMutation 这一个 mutation 管线入口（无改头换面的姊妹导出）', () => {
    // 命名空间键集合判定：同形入口多枚出现即红（防 SA3 以别名绕过公共面纪律）。
    const mutationValueExports = Object.keys(ns).filter((k) => /^applyValidatedMutation$/.test(k));
    expect(mutationValueExports).toEqual(['applyValidatedMutation']);
  });
});

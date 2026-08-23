/**
 * SA6 红灯测试（运行时值面）— @nomicore/doc-runtime 公共入口面收缩（issue #87 / PR #96 Review）。
 *
 * 契约来源（owner Request changes 修改要求 1 + 回归要求 1）：
 * - 公共入口（packages/doc-runtime/src/index.ts，即包名 @nomicore/doc-runtime `"."` 导出
 *   指向的入口模块）不得再存在 set-only 半成品值导出 `applyValidatedMutation`——
 *   #76 四操作（set/delete/array-insert/array-delete）完整交付前不得以正式公共 API 形式出现；
 * - owner 要求继续交付的名目保留在位：`materializeRoot`、`DocRuntimeFatalError`、
 *   `extractYjsSnapshot`、`readLogicalValueAtPath`、`replaceRootContent`（值导出在位）。
 *
 * 断言纪律（锚定运行时行为，非源码文本）：
 * - 以 `import * as docRuntime from '../src/index.js'` 取公共入口命名空间 → 只做
 *   模块导出观测（存在性 / 值形态），不做任何源码 grep / 字符串形状断言；
 * - 类型名目（MutationIssue / ApplyValidatedMutationResult）不可再导入的锚定
 *   见 public-surface-type-guard.test-d.ts（vitest --typecheck @ts-expect-error 机制）。
 *
 * 红灯现状（当前基线，index.ts 第 15 行仍 `export { applyValidatedMutation }`）：
 * - 命名空间上存在 `applyValidatedMutation` → `toBeUndefined()` / `'...' in ns === false`
 *   断言失败 → 本文件红。
 * 修绿（SA3）：从 src/index.ts 移除三名目导出 → 本文件转绿。
 */
import { describe, expect, it } from 'vitest';
import * as docRuntime from '../src/index.js';

const ns = docRuntime as Record<string, unknown>;

describe('@nomicore/doc-runtime 公共入口 — 值导出面收缩（修订 AC R1）', () => {
  it('公共入口不存在 set-only 半成品值导出 applyValidatedMutation', () => {
    // owner 修改要求 1：#76 完整四操作交付前不得公开 set-only 实现。
    expect(Object.prototype.hasOwnProperty.call(ns, 'applyValidatedMutation')).toBe(false);
    expect(ns.applyValidatedMutation).toBeUndefined();
  });

  it('owner 要求继续交付的五项值导出仍在位（材料化 / fatal / 提取 / 读取 / 替换）', () => {
    expect(typeof ns.materializeRoot).toBe('function');
    expect(typeof ns.DocRuntimeFatalError).toBe('function'); // class 构造器即 function
    expect(typeof ns.extractYjsSnapshot).toBe('function');
    expect(typeof ns.readLogicalValueAtPath).toBe('function');
    expect(typeof ns.replaceRootContent).toBe('function');
  });

  it('公共入口不泄露任何 mutation 管线值导出（含 #76 未交付的 delete/array-insert/array-delete 形态）', () => {
    // 收缩契约：mutation 语义（含四操作终态）整体留在包内，直至 #76 一次性公开。
    // 用命名空间键集合判定——存在即红，防 SA3 改头换面（如换名导出 set-only 形态）。
    const leaked = Object.keys(ns).filter((k) => /^applyValidatedMutation$/.test(k));
    expect(leaked).toEqual([]);
  });
});

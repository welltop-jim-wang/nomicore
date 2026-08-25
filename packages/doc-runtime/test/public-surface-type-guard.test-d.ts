/**
 * SA6 红灯测试（类型面）— @nomicore/doc-runtime 公共入口恢复导出 mutation 类型名目
 * （issue #90 / 任务简报「关键上下文 3」）。
 *
 * 契约来源（任务简报 关键上下文 3）：
 * - #76 已 CLOSED（随 #87 PR #96 以 set-only 最小落地收口）→ set-only
 *   `applyValidatedMutation` 及其类型名目 `MutationIssue` /
 *   `ApplyValidatedMutationResult` 恢复为公共入口正名目；
 * - 安全保留的正名目不变：`ExtractIssue` / `ExtractResult` /
 *   `ReadLogicalValueResult` / `MaterializeIssue` / `MaterializeResult` /
 *   `DocRuntimeFatalPhase` / `ReplaceIssue` / `ReplaceResult`。
 *
 * 锚定机制（在 vitest --typecheck 配置下红/绿翻转）：
 * - 正例（必须可导入的名目）用无指令 import 锚定：任一缺失 → TS2305 → **红**；
 * - 当前基线（入口未导出 three 名目）→ import 报 TS2305 → **红**；
 *   修绿（SA3 恢复导出）→ TS2305 消失 → **绿**。
 *
 * 红灯现状（当前基线，index.ts 未导出）：
 * - 本文件两个正例 import 均报 TS2305 → 红。
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  ApplyValidatedMutationResult,
  DocRuntimeFatalPhase,
  ExtractIssue,
  ExtractResult,
  MaterializeIssue,
  MaterializeResult,
  MutationIssue,
  ReadLogicalValueResult,
  ReplaceIssue,
  ReplaceResult,
} from '../src/index.js';

// 正例名目的类型占位声明（纯类型层；仅用于 expectTypeOf 投影，不生成运行时产物）
declare const extractIssue: ExtractIssue;
declare const extractResult: ExtractResult;
declare const readResult: ReadLogicalValueResult;
declare const materializeIssue: MaterializeIssue;
declare const materializeResult: MaterializeResult;
declare const replaceIssue: ReplaceIssue;
declare const replaceResult: ReplaceResult;
declare const phase: DocRuntimeFatalPhase;
declare const mutationIssue: MutationIssue;
declare const mutationResult: ApplyValidatedMutationResult;

describe('@nomicore/doc-runtime 公共入口 — mutation 类型名目恢复导出（issue #90 范围，类型层）', () => {
  it('恢复的名目可经公共入口导入：MutationIssue / ApplyValidatedMutationResult（任意缺失即 TS2305 红）', () => {
    expectTypeOf(mutationIssue.message).toEqualTypeOf<string>();
    expectTypeOf(mutationIssue.path).toEqualTypeOf<Array<string | number>>();
    expectTypeOf(mutationResult.ok).toEqualTypeOf<boolean>();
  });

  it('保留的公共类型名目仍可经公共入口导入（任一缺失即 TS2305 红）', () => {
    // 仅锚"可导入"本身；基本投影证明导入有效（不锁字段形状细节——属既有交付范围）。
    expectTypeOf(extractIssue.message).toEqualTypeOf<string>();
    expectTypeOf(readResult.ok).toEqualTypeOf<boolean>();
    expectTypeOf(materializeResult.ok).toEqualTypeOf<boolean>();
    expectTypeOf(replaceResult.ok).toEqualTypeOf<boolean>();
    expectTypeOf(phase).toEqualTypeOf<
      'observer-cleanup-throw' | 'post-commit-verification' | 'pre-commit-internal'
    >();
    expectTypeOf(extractResult).toMatchTypeOf<{ ok: boolean }>();
  });
});

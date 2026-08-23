/**
 * SA6 红灯测试（类型面）— @nomicore/doc-runtime 公共入口类型名目收缩（issue #87 / PR #96 Review）。
 *
 * 契约来源（owner Request changes 修改要求 1）：
 * - 公共入口不得再导出类型名目 `MutationIssue` / `ApplyValidatedMutationResult`
 *   （与 set-only 值导出 `applyValidatedMutation` 同批下公共面，#76 交付前不公开）；
 * - 既有公共类型名目继续保留：`ExtractIssue` / `ExtractResult` / `ReadLogicalValueResult` /
 *   `MaterializeIssue` / `MaterializeResult` / `DocRuntimeFatalPhase` / `ReplaceIssue` / `ReplaceResult`。
 *
 * 锚定机制（在 vitest --typecheck 配置下红/绿翻转，先例：read-logical-value-at-path.test-d.ts）：
 * - vitest.config.ts 启用 `typecheck.enabled`，`typecheck.include` 只覆盖各包 test 目录下
 *   的 `.test-d.ts` 后缀文件，`tsconfig` 指向 `./tsconfig.typecheck.json` → 本文件由
 *   `vitest run --typecheck` 以 tsc 诊断驱动；
 * - 负例（**不得**再导入的名目）用 `// @ts-expect-error` 自我反转断言，
 *   且被移除名目**绝不**在本文件其他位置被引用（避免修绿后残留未抑制的 "Cannot find name" 噪声）：
 *   当前基线（导出仍在）→ import 成功 → 指令未被消费 → TS2578 "unused '@ts-expect-error' directive"
 *   报错 → **红**；SA3 移除三名目导出 → import 报 TS2305 → 指令被消费 → **绿**；
 * - 正例（必须保留的名目）用无指令 import 锚定：任一被误删 → TS2305 → **红**。
 *   正例命名空间**不含**三个被移除的名目（防 SA3 只改值导出、漏掉类型导出）。
 *
 * 红灯现状（当前基线，index.ts 第 16 行仍 `export type { MutationIssue, ApplyValidatedMutationResult }`）：
 * - 两个 @ts-expect-error 均未使用 → vitest typecheck 报 TS2578 → 本文件红。
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  DocRuntimeFatalPhase,
  ExtractIssue,
  ExtractResult,
  MaterializeIssue,
  MaterializeResult,
  ReadLogicalValueResult,
  ReplaceIssue,
  ReplaceResult,
} from '../src/index.js';

// —— 负例锚定：set-only 半成品类型名目不得再经公共入口导入（#76 完整交付后才可公开）——
// @ts-expect-error —— MutationIssue 已从公共入口移除（owner 修改要求 1）
import type { MutationIssue } from '../src/index.js';
// @ts-expect-error —— ApplyValidatedMutationResult 已从公共入口移除（owner 修改要求 1）
import type { ApplyValidatedMutationResult } from '../src/index.js';

// 正例名目的类型占位声明（纯类型层；仅用于 expectTypeOf 投影，不生成运行时产物）
declare const extractIssue: ExtractIssue;
declare const extractResult: ExtractResult;
declare const readResult: ReadLogicalValueResult;
declare const materializeIssue: MaterializeIssue;
declare const materializeResult: MaterializeResult;
declare const replaceIssue: ReplaceIssue;
declare const replaceResult: ReplaceResult;
declare const phase: DocRuntimeFatalPhase;

describe('@nomicore/doc-runtime 公共入口 — 类型名目面（修订 AC R1，类型层）', () => {
  it('owner 要求保留的公共类型名目仍可经公共入口导入（任一缺失即 TS2305 红）', () => {
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

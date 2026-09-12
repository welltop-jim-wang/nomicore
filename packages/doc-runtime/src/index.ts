/**
 * @nomicore/doc-runtime —— Yjs bridge public surface（ADR-0007 / ADR-0008）。
 *
 * Public value APIs intentionally remain narrow. `readLogicalValueAtPath(doc, path)` is the
 * schema-independent carrier projection read defined by ADR-0008. Detached builders,
 * transaction guards, post-install verifiers, and prepared mutation state stay
 * package-internal. The validated-mutation entry implements ADR-0007's four-operation
 * contract and is re-exported together with its public envelope/result types.
 */
export { extractYjsSnapshot } from './extract.js';
export type { ExtractIssue, ExtractResult } from './extract.js';
export { readLogicalValueAtPath } from './read.js';
export type { ReadLogicalValueResult } from './read.js';
// 形状预算（issue #334 / ADR-0024 决策 1/3/6）：加法类型导出——三参 read 的 options、
// 截断条目与预算结果联合。零新增值导出（读入口仍唯一，决策 6「不新增第二条读路径」）。
export type {
  ReadLogicalValueAtPathBudgetResult,
  ReadLogicalValueAtPathOptions,
  ReadLogicalValueTruncationEntry,
} from './read.js';
export { materializeRoot } from './materialize.js';
export type { MaterializeIssue, MaterializeResult } from './materialize.js';
export { DocRuntimeFatalError } from './fatal.js';
export type { DocRuntimeFatalPhase } from './fatal.js';
export { replaceRootContent } from './replace.js';
export type { ReplaceIssue, ReplaceResult } from './replace.js';
export { applyValidatedMutation } from './mutation.js';
export type {
  MutationIssue,
  MutationPath,
  ValidatedMutation,
  ApplyValidatedMutationResult,
} from './mutation.js';
export { replaceSchemaAndRoot } from './schema-replace.js';
export type { SchemaReplaceInput, SchemaRootPlan } from './schema-replace.js';
export { createInitialDocument } from './create-initial-document.js';
export type { CreateInitialDocumentInput, CreateInitialDocumentResult } from './create-initial-document.js';

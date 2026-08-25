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

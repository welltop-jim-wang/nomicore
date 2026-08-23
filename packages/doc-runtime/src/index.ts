/**
 * @nomicore/doc-runtime —— Yjs bridge public surface（ADR-0007 / ADR-0008）。
 *
 * Public value APIs intentionally remain narrow. Detached builders, transaction guards,
 * post-install verifiers, and prepared mutation state stay package-internal.
 */
export { extractYjsSnapshot } from './extract.js';
export type { ExtractIssue, ExtractResult } from './extract.js';
export { readLogicalValueAtPath } from './read.js';
export type { ReadLogicalValueResult } from './read.js';
export { materializeRoot } from './materialize.js';
export type { MaterializeIssue, MaterializeResult } from './materialize.js';
export { DocRuntimeFatalError } from './fatal.js';
export type { DocRuntimeFatalPhase } from './fatal.js';
export { applyValidatedMutation } from './mutation.js';
export type { MutationIssue, ApplyValidatedMutationResult } from './mutation.js';
export { replaceRootContent } from './replace.js';
export type { ReplaceIssue, ReplaceResult } from './replace.js';

import type { CompiledSchema } from './evaluator.js';
import { VfslNotImplementedError } from './errors.js';

export type ValidationIssueCode =
  | 'type-mismatch'
  | 'missing-key'
  | 'unrecognized-key'
  | 'key-pattern-mismatch'
  | 'pattern-mismatch'
  | 'discriminant-mismatch';

/** 结构化 issue：替代旧体系的单条拼接字符串错误。 */
export interface ValidationIssue {
  readonly code: ValidationIssueCode;
  /** 实例路径，形如 `/assets/byId/a1/profile/portraitResourceId`。 */
  readonly path: string;
  readonly message: string;
  /** 语义层摘要（JSDoc 首行）——错误信息回带语义，设计文档 §12。 */
  readonly semantic: string | null;
}

/**
 * 整文档校验器（设计文档 §3 派生产物 4）：
 * 快照加载、迁移后体检、测试、管理端点共用的单一入口。
 * 判别联合必须“重建校验”：单字段 patch 也合并当前值后按变体验证。
 * Phase 0 第 5 步实现。
 */
export function validateSnapshot(snapshot: unknown, compiled: CompiledSchema): readonly ValidationIssue[] {
  throw new VfslNotImplementedError('validate: validateSnapshot');
}

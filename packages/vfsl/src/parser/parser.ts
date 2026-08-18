import { VfslNotImplementedError } from '../errors.js';
import type { ModuleIr } from '../ir.js';

export interface ParseIssue {
  readonly message: string;
  readonly line: number;
  readonly column: number;
}

export type ParseResult =
  | { readonly ok: true; readonly module: ModuleIr }
  | { readonly ok: false; readonly issues: readonly ParseIssue[] };

/**
 * VFSL 文本（受限 TypeScript 子集，设计文档 §4）→ ModuleIr。
 *
 * 越出子集的语法（any、自定义泛型、条件类型、mapped type 等）必须报错，
 * 不做“差不多”的猜测——方言子集是冻结的抓手。
 */
export function parseVfsl(text: string): ParseResult {
  throw new VfslNotImplementedError('parser: parseVfsl');
}

import type { CompiledSchema } from './evaluator.js';
import { VfslNotImplementedError } from './errors.js';
import type { StructureNode } from './structure.js';
import type { ValueSchema } from './value-schema.js';

export type PathLookupFailureReason =
  | 'unknown-key'
  | 'key-pattern-mismatch'
  | 'opaque-node'
  | 'index-into-array';

export type PathLookup =
  | { readonly ok: true; readonly structure: StructureNode; readonly value: ValueSchema }
  | {
      readonly ok: false;
      readonly reason: PathLookupFailureReason;
      readonly segment: string;
      readonly atIndex: number;
    };

/**
 * 路径 → 子 schema 索引（设计文档 §3 派生产物 3）。
 *
 * 取代旧体系的 resolveChild 三级前缀匹配：键匹配（exact / pattern）
 * 成为标准能力。Phase 0 第 4 步实现。
 */
export function subSchemaAt(compiled: CompiledSchema, path: readonly string[]): PathLookup {
  throw new VfslNotImplementedError('path-index: subSchemaAt');
}

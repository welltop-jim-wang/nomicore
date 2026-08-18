import type { SchemaEnvelope } from './envelope.js';
import { VfslNotImplementedError } from './errors.js';
import type { ModuleIr } from './ir.js';
import type { StructureNode } from './structure.js';
import type { ValueSchema } from './value-schema.js';

/** 一段 VFSL 文本的编译产物：结构树 + 值 schema 树（设计文档 §3 派生产物）。 */
export interface CompiledSchema {
  readonly envelope: SchemaEnvelope;
  readonly structure: StructureNode;
  readonly value: ValueSchema;
}

/** ModuleIr → 结构树 + 值 schema 树。Phase 0 第 3 步实现。 */
export function evaluateModule(moduleIr: ModuleIr, envelope: SchemaEnvelope): CompiledSchema {
  throw new VfslNotImplementedError('evaluator: evaluateModule');
}

/** 信封 → 编译产物（parse + evaluate + 按内容哈希缓存的入口）。Phase 0 第 3 步实现。 */
export function compileSchema(envelope: SchemaEnvelope): CompiledSchema {
  throw new VfslNotImplementedError('evaluator: compileSchema');
}

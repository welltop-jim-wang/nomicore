import { VfslNotImplementedError } from './errors.js';
import type { JSDocComment } from './ir.js';

/** 机器消费标签：必须解析成功且可解析到目标，否则 schema 创建/升级拒绝（设计文档 §5）。 */
export const MACHINE_TAGS = ['invariant', 'ref'] as const;

export type MachineTag = (typeof MACHINE_TAGS)[number];

/** 其余标签（@format / @role / @example / @values / @unit / @since / @deprecated / @entity / @key）为文档性质：未识别只 warn，不 fail。 */
export function extractJSDoc(comment: string): JSDocComment {
  throw new VfslNotImplementedError('jsdoc: extractJSDoc');
}

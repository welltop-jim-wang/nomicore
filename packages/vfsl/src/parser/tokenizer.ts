import { VfslNotImplementedError } from '../errors.js';

/** 词法单元。注释保留为 token，供 parser 挂到 JSDoc（设计文档 §5）。 */
export type TokenType = 'ident' | 'symbol' | 'string' | 'number' | 'block-comment' | 'line-comment' | 'eof';

export interface Token {
  readonly type: TokenType;
  readonly text: string;
  readonly line: number;
  readonly column: number;
}

/** VFSL 文本 → token 流。Phase 0 第 2 步实现。 */
export function tokenize(source: string): readonly Token[] {
  throw new VfslNotImplementedError('parser: tokenize');
}

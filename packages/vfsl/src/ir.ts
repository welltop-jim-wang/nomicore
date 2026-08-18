/**
 * VFSL 语法子集的 IR——parser 的输出、求值器的输入（设计文档 §4）。
 *
 * 首版服务于方言 v1，字段只增不改。`YXmlFragment` 建模为对内建名
 * `YXmlFragment` 的 ref，不作为 marker 包装。
 */

export interface JSDocTag {
  readonly tag: string;
  readonly value: string;
}

/** JSDoc 首行是自由文本（AI 的主要输入），`@tag` 是半结构化标签（设计文档 §5）。 */
export interface JSDocComment {
  readonly description: string;
  readonly tags: readonly JSDocTag[];
}

export type PrimitiveName = 'string' | 'number' | 'boolean' | 'null' | 'unknown';

export type MarkerName = 'YMap' | 'YArray' | 'YPlainArray' | 'YLEaf';

export interface PropertyIr {
  readonly name: string;
  readonly optional: boolean;
  readonly type: TypeIr;
  readonly jsdoc: JSDocComment | null;
}

export type TypeIr =
  | { readonly ir: 'ref'; readonly name: string; readonly typeArgs: readonly TypeIr[]; readonly jsdoc: JSDocComment | null }
  | { readonly ir: 'marker'; readonly marker: MarkerName; readonly target: TypeIr; readonly jsdoc: JSDocComment | null }
  | { readonly ir: 'object'; readonly properties: readonly PropertyIr[]; readonly jsdoc: JSDocComment | null }
  | { readonly ir: 'union'; readonly variants: readonly TypeIr[]; readonly jsdoc: JSDocComment | null }
  | { readonly ir: 'array'; readonly element: TypeIr; readonly jsdoc: JSDocComment | null }
  | { readonly ir: 'record'; readonly key: TypeIr; readonly value: TypeIr; readonly jsdoc: JSDocComment | null }
  | { readonly ir: 'primitive'; readonly name: PrimitiveName; readonly jsdoc: JSDocComment | null }
  | { readonly ir: 'literal'; readonly value: string | number | boolean | null; readonly jsdoc: JSDocComment | null }
  /** `string & Pattern<"正则">`——子集内唯一允许的交叉类型形式。 */
  | { readonly ir: 'pattern'; readonly pattern: string; readonly jsdoc: JSDocComment | null };

export interface TypeAliasIr {
  readonly name: string;
  readonly target: TypeIr;
  readonly jsdoc: JSDocComment | null;
}

export interface ModuleIr {
  readonly aliases: readonly TypeAliasIr[];
}

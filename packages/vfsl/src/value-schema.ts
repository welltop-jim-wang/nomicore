import type { JSDocComment } from './ir.js';

/**
 * 值 schema 树——值类型语义（设计文档 §3 派生物的值维度）。
 * 与结构树正交：结构管“Yjs 怎么物化”，值管“数据长什么样”。
 */

interface ValueSchemaBase {
  readonly jsdoc: JSDocComment | null;
}

export interface StringValueSchema extends ValueSchemaBase {
  readonly type: 'string';
  readonly pattern: string | null;
}

export interface NumberValueSchema extends ValueSchemaBase {
  readonly type: 'number';
}

export interface BooleanValueSchema extends ValueSchemaBase {
  readonly type: 'boolean';
}

export interface NullValueSchema extends ValueSchemaBase {
  readonly type: 'null';
}

export interface UnknownValueSchema extends ValueSchemaBase {
  readonly type: 'unknown';
}

export interface LiteralValueSchema extends ValueSchemaBase {
  readonly type: 'literal';
  readonly value: string | number | boolean | null;
}

export interface UnionValueSchema extends ValueSchemaBase {
  readonly type: 'union';
  readonly variants: readonly ValueSchema[];
}

export interface ArrayValueSchema extends ValueSchemaBase {
  readonly type: 'array';
  readonly element: ValueSchema;
}

export interface RecordValueSchema extends ValueSchemaBase {
  readonly type: 'record';
  readonly keyPattern: string | null;
  readonly value: ValueSchema;
}

export interface PropertySchema {
  readonly name: string;
  readonly optional: boolean;
  readonly schema: ValueSchema;
}

/** 判别联合：引擎自动识别字面量判别字段（设计文档 §4）。 */
export interface DiscriminantInfo {
  readonly field: string;
}

export interface ObjectValueSchema extends ValueSchemaBase {
  readonly type: 'object';
  /** 子集内对象默认封闭：未声明字段拒绝。 */
  readonly closed: true;
  readonly properties: readonly PropertySchema[];
  readonly discriminant: DiscriminantInfo | null;
}

export type ValueSchema =
  | StringValueSchema
  | NumberValueSchema
  | BooleanValueSchema
  | NullValueSchema
  | UnknownValueSchema
  | LiteralValueSchema
  | UnionValueSchema
  | ArrayValueSchema
  | RecordValueSchema
  | ObjectValueSchema;

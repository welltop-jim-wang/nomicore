/**
 * IR 公共类型定义（PRD #3 冻结接缝的载荷形状）。
 *
 * 本文件仅含类型（设计 §7.1 【R2 · SA2 #8】）：`parseVfsl` 的实现与导出在
 * `index.ts`；不得在此写签名无体声明（非合法 TS，typecheck 必败）。
 *
 * 设计要点（§7.3）：kind 判别联合对 JSON 往返 / 穷尽 switch 友好；IR 不携带
 * 行列（位置是诊断信息，进 IR 会让内容哈希对排版敏感）；`ok: true` 蕴含名字
 * 唯一（E302 已拒绝重复）。
 */
export interface VfslIssue {
  message: string;
  line: number;
  column: number;
}

export interface VfslModule {
  kind: 'vfsl-module';
  aliases: VfslAlias[];
}

export interface VfslAlias {
  kind: 'alias';
  name: string;
  type: VfslType;
}

export interface VfslField {
  kind: 'field';
  name: string;
  /** 必填（exactOptionalPropertyTypes 下不用 `optional?: boolean`）。 */
  optional: boolean;
  type: VfslType;
}

export type VfslType =
  | { kind: 'primitive'; name: 'string' | 'number' | 'boolean' | 'null' | 'unknown' }
  | { kind: 'literal'; value: string | number } // JSON 天然区分 "80" 与 80
  | { kind: 'ref'; name: string }
  | { kind: 'object'; fields: VfslField[] }
  | { kind: 'union'; members: VfslType[] }
  | { kind: 'array'; element: VfslType } // T[]（#6）
  | { kind: 'record'; key: VfslType; value: VfslType } // Record<K, V>，键约束原样入 IR（#6）
  | {
      // 标记类型及其包裹目标（不折叠，AC1 可区分性锚）（#6）
      kind: 'marker';
      marker: 'YMap' | 'YArray' | 'YPlainArray' | 'YLeaf' | 'YXmlFragment';
      arg: VfslType;
    }
  | { kind: 'pattern'; regex: string }; // string & Pattern<"正则"> 解码后原文（#6）

export type ParseVfslResult =
  | { ok: true; module: VfslModule }
  | { ok: false; issues: VfslIssue[] };

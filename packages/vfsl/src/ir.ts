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
  /** 文档注释原文数组（连续 doc 按出现序；无 doc 时为空数组——必填，§7.2）。 */
  docs: string[];
  type: VfslType;
}

export interface VfslField {
  kind: 'field';
  name: string;
  /** 必填（exactOptionalPropertyTypes 下不用 `optional?: boolean`）。 */
  optional: boolean;
  /** 文档注释原文数组（连续 doc 按出现序；无 doc 时为空数组——必填，§7.2）。 */
  docs: string[];
  type: VfslType;
}

export type VfslType =
  | { kind: 'primitive'; name: 'string' | 'number' | 'boolean' | 'null' | 'unknown' }
  | { kind: 'literal'; value: string | number } // JSON 天然区分 "80" 与 80
  | { kind: 'ref'; name: string }
  | { kind: 'object'; fields: VfslField[] }
  | {
      // 联合（ADR 0019 决策 4）。memberDocs 为**条件键**：仅当至少一名成员携带 doc
      // 时在场，与 members 等长对齐（无 doc 成员为空数组）；全体成员均无 doc 时整键
      // 不存在。指纹纪律：本键参与 semantic 指纹输入（fingerprint.ts 单一生产者），
      // 条件附加是存量 `sha256:v1:` 指纹逐字节稳定的构造保证（非风格选择）——不得补
      // 空槽、不得二次规范化、键插入序恒为 kind → members → memberDocs。
      kind: 'union';
      members: VfslType[];
      memberDocs?: string[][];
    }
  | { kind: 'array'; element: VfslType } // T[]（#6）
  | { kind: 'record'; key: VfslType; value: VfslType } // Record<K, V>，键约束原样入 IR（#6）
  | {
      // 标记类型及其包裹目标（不折叠，AC1 可区分性锚）（#6）；marker 保留源拼写
      // （大小写是契约）；docs 挂标记记号处（#7 JSDoc M1/M2/M3 锚位之一；无 doc 为空数组，
      // 必填——与 alias/field 的 §7.2 约定同构）。
      kind: 'marker';
      marker: 'YMap' | 'YArray' | 'YPlainArray' | 'YLeaf' | 'YXmlFragment';
      arg: VfslType;
      docs: string[];
    }
  | { kind: 'pattern'; regex: string } // string & Pattern<"正则"> 解码后原文（#6）
  | {
      // 数值约束叶子（ADR 0020 决策 5；镜像 pattern 叶子先例）：`number & Int` 零参形态
      // 两键皆缺席（**条件键**，整键不存在——不得补 undefined 槽）；`number & Int<min,max>`
      // 两键必在场。键插入序恒 kind → min → max，f64 原值（值判定，文本形态不进 IR）——
      // 指纹纪律：新叶子只服务新文本，无 Int/Range 的存量 IR 逐字节不变。
      kind: 'int';
      min?: number;
      max?: number;
    }
  | { kind: 'range'; min: number; max: number }; // number & Range<min, max>（两端点必在场）

export type ParseVfslResult =
  | { ok: true; module: VfslModule }
  | { ok: false; issues: VfslIssue[] };

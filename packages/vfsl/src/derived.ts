/**
 * 派生 schema 类型族（ADR 0003 冻结形状；issue #20 求值器产出）。
 *
 * 本文件仅含类型（沿 ir.ts「仅含类型」先例）；`evaluate` 的实现与导出在
 * `evaluate.ts` / `index.ts`。
 *
 * 纪律（设计 §2.1/§8.3）：
 * - 纯数据、可 JSON 序列化、无行列——内容哈希纪律（编译缓存缓存值）；
 * - 不可变契约：派生物对消费者不可变——index 条目 node 与树内节点为同一对象
 *   引用（O(文本规模) 的显式设计选择），突变 index['ROOT'].node 会交叉污染
 *   structure。v1 以类型 JSDoc + 设计文档声明承载，不 Object.freeze（评估见
 *   设计 §8.3）；
 * - `exactOptionalPropertyTypes` 纪律：未附加时整个键不得存在（条件展开构造）。
 */
import type { VfslIssue } from './ir.js';

/** 判别式缓存（非契约缓存，ADR 0003 §3：缺失/存在不改变可观测行为）。 */
export interface Discriminator {
  /** 判别字段名（全体成员互异的字面量字段） */
  field: string;
  /** 字面量值 → 成员序号（O(1) 跳转；键 = String(字面量)；插入序 = 成员声明序） */
  byValue: Record<string, number>;
}

/** 结构树节点（Yjs 物化语义；ref / leaf / plain / xml-fragment 为终态）。 */
export type StructureNode =
  | { kind: 'root'; node: StructureNode } // ROOT 入口（仅 structure 与 index['ROOT'] 出现）
  | { kind: 'map'; fields: MapField[] } // Y.Map 封闭键空间（字段声明序）
  | { kind: 'array'; element: StructureNode } // Y.Array
  | { kind: 'xml-fragment' } // 不透明终态（ADR 0003 §5）
  | { kind: 'leaf' } // 原生叶子值（标量形物化）
  | { kind: 'plain' } // YPlainArray 子树纯值上下文终态
  | { kind: 'union'; members: StructureNode[]; discriminator?: Discriminator }
  | { kind: 'ref'; name: string }; // 按名引用，不内联展开（ADR 0003 §4）

export interface MapField {
  /** Record 的动态键段固定名 '<key>'。 */
  name: string;
  optional: boolean;
  node: StructureNode;
}

/** 值 schema（值类型语义，与结构树正交）。 */
export type ValueSchema =
  | { kind: 'object'; fields: ValueField[]; keyPattern?: string } // keyPattern 仅 Record 物化位携带（决策 F2）
  | { kind: 'array'; element: ValueSchema }
  | { kind: 'xml' }
  | { kind: 'union'; members: ValueSchema[]; discriminator?: Discriminator }
  | { kind: 'enum'; values: Array<string | number> } // 字面量（联合）→ 枚举，声明序
  | { kind: 'pattern'; regex: string }
  | { kind: 'scalar'; type: 'string' | 'number' | 'boolean' | 'null' | 'unknown' }
  | { kind: 'optional'; value: ValueSchema } // 仅对象字段 ?: 包装
  | { kind: 'ref'; name: string };

export interface ValueField {
  name: string;
  value: ValueSchema;
}

/** 路径索引条目。 */
export interface IndexEntry {
  match: 'exact' | 'pattern';
  /** 仅 Record 键段 '<key>' 且 K 解析为 Pattern 时携带（解码后正则）。 */
  keyPattern?: string;
  node: StructureNode;
}

/** 派生 schema（求值器产出；纯数据、可 JSON 序列化、无行列——内容哈希纪律）。 */
export interface DerivedSchema {
  /** 别名表：IR 同构（ref 不展开，含 ROOT）。 */
  aliases: Record<string, StructureNode>;
  /** 结构树入口：root 节点包裹 ROOT 的 map 物化。 */
  structure: StructureNode;
  /** 每别名的值语义。 */
  values: Record<string, ValueSchema>;
  /** ROOT 起 '.' 连接的语法路径 → 条目。 */
  index: Record<string, IndexEntry>;
}

export type EvaluateResult =
  | { ok: true; derived: DerivedSchema }
  | { ok: false; issues: VfslIssue[] };

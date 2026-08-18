import type { MarkerName } from './ir.js';

/**
 * 结构树——Yjs 物化语义（设计文档 §3 派生产物 2）。
 * 供路径下钻守卫与 materialization 使用，与值类型语义正交。
 */

export type StructureKind = 'map' | 'array' | 'xml-fragment' | 'plain';

export type StorageKind = 'ymap' | 'yarray' | 'plain-array' | 'xml' | 'scalar';

export interface StructureChild {
  readonly key: string;
  readonly node: StructureNode;
}

export interface StructureNode {
  readonly kind: StructureKind;
  readonly storage: StorageKind;
  /** PATCH 不可下钻的不透明节点（YLeaf / YPlainArray / YXmlFragment）。 */
  readonly opaque: boolean;
  /** 封闭 map 的已知子节点；非封闭 map 为空。 */
  readonly children: readonly StructureChild[];
  /** Record 键约束（regex 源，如 `^[^.|]+$`）；无约束为 null。 */
  readonly keyPattern: string | null;
  /** Record / array 的元素结构。 */
  readonly element: StructureNode | null;
  /** 产生该节点的标记类型；plain 物化为 null。 */
  readonly marker: MarkerName | 'YXmlFragment' | null;
}

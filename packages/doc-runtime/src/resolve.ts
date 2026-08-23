/**
 * @nomicore/doc-runtime — 结构树 ref 解析器（extract/materialize 共享模块，D8）。
 *
 * 自 extract.ts 纯移动（issue #74 设计 §4.9）：签名与实现逐字不变——调用局部 memo
 * （节点引用为键，O(1) 复用）+ inFlight 环守卫**先于** memo 命中判定 + 缺名 loud 抛出。
 * 合法 derived 经 E301/E106 保证无环有名；缺名/环仅手造派生物可触达 → 抛错由调用方
 * 顶层崩溃边界收编（extract 侧 DOCRT-E100 / materialize 侧 DOCRT-E200，对齐
 * evaluate.ts 手造 IR loud 边界）。移动使两侧共享同一实现，杜绝复制漂移。
 */
import type { DerivedSchema, StructureNode } from '@nomicore/vfsl';

/**
 * 结构树 ref 解析（D8）：每调用局部 memo（节点引用为键，O(1) 复用）+ inFlight 环守卫。
 */
export function makeRefResolver(derived: DerivedSchema): (node: StructureNode) => StructureNode {
  const memo = new Map<StructureNode, StructureNode>();
  return function resolve(node: StructureNode): StructureNode {
    const inFlight = new Set<string>();
    let cur: StructureNode = node;
    while (cur.kind === 'ref') {
      // 环守卫先于 memo 命中判定：合法输入两序等价，手造环必须在此 loud 抛出（→ E100/E200），
      // 而非经 memo 命中陷入无限循环（D8「递归无环守卫」意图；镜像 vfsl walkRefChain 语义）
      if (inFlight.has(cur.name)) throw new Error(`结构 ref 环（${cur.name}）`);
      const hit = memo.get(cur);
      if (hit !== undefined) {
        cur = hit;
        continue;
      }
      inFlight.add(cur.name);
      const next = derived.aliases[cur.name]; // undefined = 未声明（Object.hasOwn 语义）
      if (next === undefined) throw new Error(`结构 ref 缺名（${cur.name}）`);
      memo.set(cur, next);
      cur = next;
    }
    return cur;
  };
}

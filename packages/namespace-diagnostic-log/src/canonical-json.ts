/**
 * RFC 8785 JCS 规范化（纯 TS，叶子模块；设计 §5.2）。
 *
 * 实现要点：
 * - 数字：`String(value)` —— ECMAScript Number::toString（RFC 8785 §3.2.2.3，
 *   含 1e+21、-0→"0"）；非有限数（NaN/±Infinity）为快照契约违反。
 * - 字符串：`JSON.stringify` —— RFC 8785 §3.2.2.2 转义集；ES2019 well-formed
 *   JSON.stringify 将 lone surrogate 转义为 `\udXXX`（RFC 未定义域上的确定性
 *   全函数扩展——不替换、不坍缩，与 vfsl sha256.ts 的 WTF-8 单射哲学同向）。
 * - 对象键：按 UTF-16 code unit 序排序（JS `<`；RFC 8785 §3.2.3），递归。
 * - 数组：逐槽显式检查（R2/C-b1）——稀疏数组 hole 与显式 undefined 元素都是
 *   快照契约违反（map/join 会跳洞产出非 JSON 文本，JSON.stringify 把 hole 呈现为
 *   null——digest 与嵌入值表示分叉，一律拒绝）。
 * - 节点护栏（设计 §5.3）：单个投影遍历节点数 > 1_000_000 → 契约违反
 *   （防畸形巨型快照，非预期路径）。
 *
 * 本模块零 node 绑定（纯 ECMAScript）；canonical 文本的 UTF-8 字节化由调用方
 * （digest.ts）经全局 TextEncoder 完成。
 */

/** 快照契约违反（遍历中发现非 JSON 值/稀疏 hole/节点护栏超限/敌意 getter 抛出）。 */
export class SnapshotContractViolation extends Error {
  constructor(message = 'snapshot 违反快照契约（非 JSON 值、稀疏数组或节点护栏超限）') {
    super(message)
    this.name = 'SnapshotContractViolation'
  }
}

/** 单个投影遍历的节点账本（jcs 与 redact 共用；> 1_000_000 → 违反）。 */
export interface TraversalBudget {
  nodes: number
}

export const NODE_BUDGET_LIMIT = 1_000_000

/** 创建新遍历节点账本。 */
export function createTraversalBudget(): TraversalBudget {
  return { nodes: 0 }
}

function charge(budget: TraversalBudget | undefined): void {
  if (budget === undefined) return
  budget.nodes += 1
  if (budget.nodes > NODE_BUDGET_LIMIT) {
    throw new SnapshotContractViolation(`快照遍历节点数超过护栏 ${NODE_BUDGET_LIMIT}`)
  }
}

/**
 * RFC 8785 JCS 规范化：输入为 JSON-safe plain data（快照契约由本函数防御性
 * 校验）；输出 canonical JSON 文本。
 *
 * 对任意输入（含敌意 getter/非 JSON 值/稀疏数组/超深嵌套）不 throw 出本模块：
 * 以 SnapshotContractViolation（或宿主 RangeError）表达——调用方（input 投影）
 * 收编为 capture:'unavailable' + input-projection-failed（设计 §5.4）。
 */
export function jcs(value: unknown, budget?: TraversalBudget): string {
  charge(budget)
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new SnapshotContractViolation(`非有限数字：${String(value)}`)
    return String(value) // RFC 8785 §3.2.2.3：ECMAScript Number::toString（-0 → "0"）
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) {
    const parts: string[] = []
    for (let i = 0; i < value.length; i++) {
      // 逐槽显式检查（R2/C-b1）：hole 与 undefined 元素一律快照契约违反
      if (!(i in value) || value[i] === undefined) {
        throw new SnapshotContractViolation(`稀疏数组 hole / undefined 元素（index ${i}）`)
      }
      parts.push(jcs(value[i], budget))
    }
    return '[' + parts.join(',') + ']'
  }
  if (typeof value === 'object') {
    // R5/std C-3 plainness 守卫：对象值必须 plain（原型为 Object.prototype 或 null）；
    // Date/Map/Set/typed array 等非 plain 值 → 快照契约违反（§5.4 清单增补——
    // 同时封死 full 捕获内嵌 typed array 的冻结漏洞；full 捕获因 digest 先行（jcs 先于
    // 嵌入）被同一守卫覆盖）
    assertPlainObject(value)
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    const parts: string[] = []
    for (const key of keys) parts.push(JSON.stringify(key) + ':' + jcs(record[key], budget))
    return '{' + parts.join(',') + '}'
  }
  // undefined / symbol / bigint / function —— 非 JSON 值
  throw new SnapshotContractViolation(`非 JSON 值：${typeof value}`)
}

/** plainness 守卫（原型为 Object.prototype 或 null；R5/std C-3）。 */
export function assertPlainObject(value: object): void {
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    throw new SnapshotContractViolation('非 plain 对象（原型非 Object.prototype/null）')
  }
}

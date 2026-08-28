/**
 * 输入捕获投影（设计 §5——四策略 × 可得性决策表，确定性无自由裁量）。
 *
 * - 「事实优先于策略」（§5.1）：not-accessed / unavailable / unsafe-input 由 producer
 *   判定并原样入 record，任何策略不得改写事实。
 * - digest 恒为安全快照 RFC 8785 JCS bytes 的 SHA-256——与投影策略无关地对全量
 *   快照计算（§2.2/§10-J7：full/redacted 变体也携带 digest，跨策略可比对）。
 * - 零额外读取纪律（§5.4）：只消费 emission 携带的 snapshot（所有权已移交）；
 *   遍历失败/非 JSON 值/稀疏 hole/节点护栏超限 → capture:'unavailable' +
 *   input-projection-failed，不重读、不重试。
 */
import { createTraversalBudget, jcs, SnapshotContractViolation, type TraversalBudget } from '../canonical-json.js'
import { digestOfCanonical } from '../digest.js'
import type { InputCapture } from '../record.js'
import type { EmissionInput } from '../emission.js'

/** redacted 算法（§5.3：结构保形、叶值脱敏、null 保留；护栏 >1M 节点 → 失败）。 */
const REDACTED_LEAF = '«redacted»'

function redactValue(value: unknown, budget: TraversalBudget): unknown {
  budget.nodes += 1
  if (budget.nodes > 1_000_000) throw new SnapshotContractViolation('redacted 投影节点护栏超限')
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return REDACTED_LEAF
  }
  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (let i = 0; i < value.length; i++) {
      if (!(i in value) || value[i] === undefined) {
        throw new SnapshotContractViolation(`稀疏数组 hole / undefined 元素（index ${i}）`)
      }
      out.push(redactValue(value[i], budget))
    }
    return out
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(record)) out[key] = redactValue(record[key], budget)
    return out
  }
  throw new SnapshotContractViolation(`非 JSON 值：${typeof value}`)
}

/**
 * 语义 emission 的 input → 冻结 InputCapture。
 * @param onFailure input-projection-failed 健康回调（恰一次）
 */
export function projectInput(
  input: EmissionInput | undefined,
  policy: 'none' | 'digest' | 'redacted' | 'full',
  onFailure: () => void,
): InputCapture {
  if (input === undefined) return { capture: 'none' }
  const record = input as Record<string, unknown>
  if ('status' in record) {
    // 事实优先于策略（§5.1 决策表四列皆同）
    if (record.status === 'not-accessed') return { capture: 'not-accessed' }
    if (record.status === 'unavailable') return { capture: 'unavailable' }
    if (record.status === 'unsafe-input') return { capture: 'unsafe-input' }
    // 形状违约：status 值不在封闭词表 → 快照契约类失败
    onFailure()
    return { capture: 'unavailable' }
  }
  if (!('snapshot' in record)) {
    // 空 input 对象 / 未知形状
    onFailure()
    return { capture: 'unavailable' }
  }
  const snapshot = record.snapshot
  if (policy === 'none') {
    // 策略不捕获则不触碰快照（§5.1 decision table）
    return { capture: 'none' }
  }
  try {
    // 逐遍历独立节点账本（§5.3 护栏按遍历计：jcs 与 redact 各自 >1M 节点 → 失败）
    const digest = digestOfCanonical(jcs(snapshot, createTraversalBudget()))
    if (policy === 'digest') return { capture: 'digest', digest }
    if (policy === 'full') return { capture: 'full', value: snapshot, digest }
    // redacted：结构与 digest 保留（§5.3；digest 恒为全量快照未脱敏摘要）
    const redacted = redactValue(snapshot, createTraversalBudget())
    return { capture: 'redacted', value: redacted, digest }
  } catch {
    onFailure()
    return { capture: 'unavailable' }
  }
}

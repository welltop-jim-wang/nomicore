/**
 * issues 投影（设计 §6——确定性截断原语 + 预算逐字对齐 ADR 0012 §投影）。
 *
 * 预算基准（R2/E-c2 钉死）：一切「UTF-8 bytes」预算按 **JSON 字符串字面量内容字节**
 * 计——`jsonLiteralBytes(s) = utf8Bytes(JSON.stringify(s)).length - 2`。受限资源本质
 * 是 JSONL line 的字节（§5.5 measure 同基）。该基准下：lone surrogate 计 6B、
 * `"`/`\`/短转义计 2B、`\u00xx` 计 6B、合法 astral 字符计 4B。
 *
 * 确定性（§6.1）：预算基准固定、code point 前缀扫描固定（不拆分代理对）、
 * `…[truncated]` 标记固定（R4 勘误：精确 JSON 字面量 14B——U+2026 计 3B +
 * `[truncated]` 11B；截断按 14B 预留）。R2/E-c1：budget < marker 字节数 → loud throw
 * `TruncationBudgetBelowMarker`（内部不变量违反；throw 经 emit 顶层 catch 收编为
 * pipeline-crashed，绝不静默产出超预算输出）。
 */

/** 截断标记（R4 勘误：JSON 字面量字节 = 14B——`…` U+2026 = 3B + `[truncated]` = 11B）。 */
export const TRUNCATION_MARKER = '…[truncated]'

/** 内部不变量违反：budget < marker 字节数（正常不可达——v1 全部调用点为冻结常量 4096/1024/256 ≥ 13）。 */
export class TruncationBudgetBelowMarker extends Error {
  constructor(budgetBytes: number) {
    super(`truncateUtf8 budget ${budgetBytes} < marker 字节数（内部不变量违反）`)
    this.name = 'TruncationBudgetBelowMarker'
  }
}

/** 字符串 → JSON 字面量内容字节数（§6.1 预算基准；按 code point 表逐字累计——
 *  与 truncateUtf8 扫描同基，保证「测量」与「截断」同标尺）。 */
export function jsonLiteralBytes(s: string): number {
  let bytes = 0
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i)!
    bytes += jsonLiteralCpBytes(cp)
    i += cp > 0xffff ? 2 : 1
  }
  return bytes
}

/** 单个 code point 在 JSON 字面量中的字节数（与 JSON.stringify 转义规则一一对应；§6.1）。
 *  无特例：U+2026（'…'）按 `cp < 0x10000 → 3B` 记账（R4/C-4 勘误——设计 §6.1 本无
 *  U+2026 特例；marker 精确 14B）。 */
export function jsonLiteralCpBytes(cp: number): number {
  if (cp === 0x22 || cp === 0x5c) return 2 // \" \\
  if (cp === 0x08 || cp === 0x09 || cp === 0x0a || cp === 0x0c || cp === 0x0d) return 2 // \b\t\n\f\r
  if (cp < 0x20) return 6 // \u00xx
  if (cp >= 0xd800 && cp <= 0xdfff) return 6 // lone surrogate → \udXXX
  if (cp < 0x80) return 1
  if (cp < 0x800) return 2
  if (cp < 0x10000) return 3
  return 4 // astral（合法代理对，UTF-8 原样）
}

/**
 * 确定性截断：按 JSON 字面量字节预算、code point 对齐（代理对不拆分）、
 * 超限时以 `…[truncated]` 收尾，输出总字面量字节 ≤ budget。
 */
export function truncateUtf8(s: string, budgetBytes: number): string {
  if (budgetBytes < jsonLiteralBytes(TRUNCATION_MARKER)) throw new TruncationBudgetBelowMarker(budgetBytes)
  if (jsonLiteralBytes(s) <= budgetBytes) return s
  const target = budgetBytes - jsonLiteralBytes(TRUNCATION_MARKER)
  let bytes = 0
  let cut = 0
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i)!
    const cpBytes = jsonLiteralCpBytes(cp)
    if (bytes + cpBytes > target) break
    bytes += cpBytes
    i += cp > 0xffff ? 2 : 1
    cut = i
  }
  return s.slice(0, cut) + TRUNCATION_MARKER
}

import type { DiagnosticIssue, IssuesProjection } from '../record.js'

/** 有效条目判定（R2/C-b1 段级 JSON-safe）：形状 + 每段 string ∨ Number.isFinite(number)。 */
function isValidSegment(segment: unknown): segment is string | number {
  if (typeof segment === 'string') return true
  return typeof segment === 'number' && Number.isFinite(segment)
}

function isValidItem(item: unknown): item is DiagnosticIssue {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return false
  const record = item as Record<string, unknown>
  if (typeof record.message !== 'string') return false
  if (!Array.isArray(record.path)) return false
  if (record.code !== undefined && typeof record.code !== 'string') return false
  for (const segment of record.path) {
    if (!isValidSegment(segment)) return false
  }
  return true
}

/**
 * 原始 issue 输入 → IssuesProjection（策略投影 + 预算截断；§6.2）。
 *
 * 输入形状（R5/std C-S2）：裸数组 `DiagnosticIssue[]`（设计 §2.6）；非数组输入视为
 * 畸形容器 → 丢弃全部 issues + enrichment-field-dropped/issues（恰一次）。
 *
 * 规则：畸形条目整条丢弃（originalCount 只计有效）；非法段（NaN/±Infinity/
 * undefined——稀疏数组 hole 读出 undefined 同判）整条丢弃并上报
 * enrichment-field-dropped/issues（恰一次）；number 段 -0 归一为 +0；
 * truncated/originalCount 为 presence 语义且**严格 ⇔ 预算截断**（R5 再裁决——
 * 条目畸形丢弃不置位，只经健康事件上报；预算截断＝条数 >1000 或 message/path/code
 * 截断，两键同现同缺）。
 *
 * @param onDropped 条目丢弃回调（恰一次）
 * @returns undefined ⇔ issues 未提供/容器畸形（record 不含 issues 字段）
 */
export function projectIssues(
  raw: unknown,
  policy: 'none' | 'full' | 'redacted',
  onDropped: () => void,
): IssuesProjection | undefined {
  if (policy === 'none') return { policy: 'none', items: [] }
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) {
    onDropped()
    return undefined
  }
  const items: unknown[] = raw

  const valid: DiagnosticIssue[] = []
  let droppedAny = false
  for (const item of items) {
    if (!isValidItem(item)) {
      droppedAny = true
      continue
    }
    // number 段 -0 → +0 归一（段级廉价；内存对象与 JSON 视图逐字段一致，§6.2）
    const path: Array<string | number> = item.path.map((segment) =>
      typeof segment === 'number' && Object.is(segment, -0) ? 0 : segment,
    )
    valid.push({
      ...(item.code !== undefined ? { code: item.code } : {}),
      message: item.message,
      path,
    })
  }
  if (droppedAny) onDropped()

  let truncated = false
  const projected: DiagnosticIssue[] = []
  for (const issue of valid.slice(0, 1000)) {
    // path 预算与策略无关（R5/std C-S1）：前 256 段；string 段 1KiB 截断
    const path: Array<string | number> = issue.path
      .slice(0, 256)
      .map((segment) => (typeof segment === 'string' ? truncateUtf8(segment, 1024) : segment))
    if (issue.path.length > 256 || path.length !== issue.path.length) truncated = true
    for (let i = 0; i < Math.min(issue.path.length, 256); i++) {
      const before = issue.path[i]
      const after = path[i]
      if (typeof before === 'string' && typeof after === 'string' && after !== before) truncated = true
    }
    if (policy === 'redacted') {
      // 脱敏策略（策略差异仅内容处理）：message→«redacted»；code 保留（稳定码低敏）
      projected.push({
        ...(issue.code !== undefined ? { code: issue.code } : {}),
        message: '«redacted»',
        path,
      })
      continue
    }
    // full：逐字段确定性截断（code 256B / message 4096B / string 段 1024B）
    const code = issue.code === undefined ? undefined : truncateUtf8(issue.code, 256)
    const message = truncateUtf8(issue.message, 4096)
    if (issue.code !== undefined && code !== issue.code) truncated = true
    if (message !== issue.message) truncated = true
    projected.push({
      ...(code !== undefined ? { code } : {}),
      message,
      path,
    })
  }
  if (valid.length > 1000) truncated = true

  // R5 再裁决 presence：严格 ⇔ 预算截断（两键同现同缺；畸形条目丢弃不置位）
  const base: IssuesProjection = { policy, items: projected }
  if (truncated) return { ...base, truncated: true, originalCount: valid.length }
  return base
}

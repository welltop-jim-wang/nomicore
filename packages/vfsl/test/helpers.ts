/**
 * SA6 测试辅助 —— 形状无关的 IR 观察工具。
 *
 * 契约只固定公共接缝 parseVfsl(text) → { ok, module | issues }；
 * module 的具体形状由实现（SA3）自定，测试不得锁定内部键名。
 * 这里通过深度遍历收集节点/字符串，把断言锚定在语义事实上。
 */
import { expect } from 'vitest'

export type ParseOutcome =
  | { ok: true; module: unknown }
  | { ok: false; issues: Issue[] }

export interface Issue {
  message: string
  line: number
  column: number
}

/** 深度遍历 root，收集所有可达对象节点（带访问去环，防 IR 意外成环时死循环）。 */
export function collectNodes(root: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const seen = new Set<object>()
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return
    if (seen.has(value as object)) return
    seen.add(value as object)
    const obj = value as Record<string, unknown>
    out.push(obj)
    for (const v of Object.values(obj)) walk(v)
  }
  walk(root)
  return out
}

/**
 * 在 root 子树中定位"名为 name 的节点"：
 * 优先匹配 .name 字段（数组式 IR），其次匹配直接以 name 为键的条目（键式 IR）。
 * 对别名子树调用即得到字段节点。
 */
export function nodeByName(root: unknown, name: string): Record<string, unknown> | undefined {
  const nodes = collectNodes(root)
  const byName = nodes.find((n) => n.name === name)
  if (byName) return byName
  for (const n of nodes) {
    if (n[name] !== undefined) {
      const v = n[name]
      return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : n
    }
  }
  return undefined
}

/** 收集 root 子树中的所有字符串（对象键与值都算），用于断言字面量/正则/JSDoc 原文出现在 IR 中。 */
export function collectStrings(root: unknown): string[] {
  const out: string[] = []
  const seen = new Set<object>()
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'string') out.push(v)
      return
    }
    if (seen.has(v as object)) return
    seen.add(v as object)
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out.push(k)
      walk(val)
    }
  }
  walk(root)
  return out
}

/** 断言结构化错误满足契约形状：message 非空字符串，line/column 为源行内合法整数。 */
export function expectIssueShape(issue: Issue, sourceLines: string[]): void {
  expect(typeof issue.message).toBe('string')
  expect(issue.message.length).toBeGreaterThan(0)
  expect(Number.isInteger(issue.line)).toBe(true)
  expect(Number.isInteger(issue.column)).toBe(true)
  expect(issue.line).toBeGreaterThanOrEqual(1)
  expect(issue.line).toBeLessThanOrEqual(sourceLines.length)
  const lineText = sourceLines[issue.line - 1] ?? ''
  expect(issue.column).toBeGreaterThanOrEqual(1)
  expect(issue.column).toBeLessThanOrEqual(lineText.length + 1)
}

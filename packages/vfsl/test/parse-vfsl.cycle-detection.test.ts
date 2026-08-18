/**
 * SA6 红灯套件 3/4 — 环检测负例：递归 / 循环引用的类型别名必须被拒绝。
 *
 * 契约锚点：别名引用图成环 → { ok: false, issues: [{ message, line, column }] }。
 * 同时锚定无环前向引用合法，防止实现过度拒绝。
 */
import { describe, it, expect } from 'vitest'
import { parseVfsl } from '@nomicore/vfsl'
import { expectIssueShape, nodeByName } from './helpers'

describe('环检测：递归 / 循环引用必须被拒绝', () => {
  it('自引用：type A = A 直接成环', () => {
    const text = 'type A = A;'
    const r = parseVfsl(text)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues.length).toBeGreaterThanOrEqual(1)
    for (const issue of r.issues) expectIssueShape(issue, text.split('\n'))
  })

  it('经对象字段自递归：type A = { x: A } 成环', () => {
    const text = 'type A = { x: A }'
    const r = parseVfsl(text)
    expect(r.ok).toBe(false)
    if (r.ok) return
    for (const issue of r.issues) expectIssueShape(issue, text.split('\n'))
  })

  it('互引用环：A 引用 B、B 引用 A', () => {
    const text = 'type A = B;\ntype B = A;'
    const r = parseVfsl(text)
    expect(r.ok).toBe(false)
    if (r.ok) return
    const lines = text.split('\n')
    expect(r.issues.length).toBeGreaterThanOrEqual(1)
    for (const issue of r.issues) expectIssueShape(issue, lines)
    // 错误必须指向环上的某一行
    expect(r.issues.some((i) => i.line === 1 || i.line === 2)).toBe(true)
  })

  it('经对象字段的互引用环：A { b: B }、B { a: A }', () => {
    const text = 'type A = { b: B };\ntype B = { a: A };'
    const r = parseVfsl(text)
    expect(r.ok).toBe(false)
    if (r.ok) return
    for (const issue of r.issues) expectIssueShape(issue, text.split('\n'))
  })

  it('无环的前向引用是合法的：A 引用后声明的 B 不报错', () => {
    const text = 'type A = B;\ntype B = { x: string }'
    const r = parseVfsl(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(nodeByName(r.module, 'A')).toBeDefined()
    expect(nodeByName(r.module, 'B')).toBeDefined()
  })
})

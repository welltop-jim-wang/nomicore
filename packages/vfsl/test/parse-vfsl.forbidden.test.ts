/**
 * SA6 红灯套件 2/4 — 禁止清单逐项负例 + 覆盖矩阵负例。
 *
 * 契约锚点：parseVfsl(text) → { ok: false, issues: [{ message, line, column }] }。
 * 每个越界构造都必须产生结构化错误；line/column 必须落在源文本内。
 */
import { describe, it, expect } from 'vitest'
import { parseVfsl } from '@nomicore/vfsl'
import { expectIssueShape, type ParseOutcome } from './helpers'

/** 统一断言：解析失败 + 所有 issue 满足结构化错误契约（message/line/column）。 */
function expectRejected(r: ParseOutcome, text: string): void {
  expect(r.ok).toBe(false)
  if (r.ok) return
  expect(Array.isArray(r.issues)).toBe(true)
  expect(r.issues.length).toBeGreaterThanOrEqual(1)
  for (const issue of r.issues) expectIssueShape(issue, text.split('\n'))
}

describe('禁止清单 · 逐项负例', () => {
  it('any：type A = any 越界', () => {
    const text = 'type A = any;'
    expectRejected(parseVfsl(text), text)
  })

  it('any：行号精确到越界处（前置注释后 any 在第 3 行）', () => {
    const text = ['// 前置行注释一', '// 前置行注释二', 'type A = any;'].join('\n')
    const r = parseVfsl(text)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues.some((i) => i.line === 3)).toBe(true)
  })

  it('自定义泛型：type Box<T> = { value: T } 越界', () => {
    const text = 'type Box<T> = { value: T };'
    expectRejected(parseVfsl(text), text)
  })

  it('条件类型：string extends number ? ... 越界', () => {
    const text = 'type Cond = string extends number ? "yes" : "no";'
    expectRejected(parseVfsl(text), text)
  })

  it('mapped type：[K in "a" | "b"] 越界', () => {
    const text = 'type M = { [K in "a" | "b"]: string };'
    expectRejected(parseVfsl(text), text)
  })

  it('interface 继承：interface Child extends Parent 越界', () => {
    const text = 'interface Child extends Parent { name: string }'
    expectRejected(parseVfsl(text), text)
  })

  it('交叉类型仅允许 string & Pattern：string & number 越界', () => {
    const text = 'type A = string & number;'
    expectRejected(parseVfsl(text), text)
  })

  it('Pattern 参数必须是字符串字面量：Pattern<123> 越界', () => {
    const text = 'type A = string & Pattern<123>;'
    expectRejected(parseVfsl(text), text)
  })

  it('Record 必须两个类型参数：Record<string> 越界', () => {
    const text = 'type R = Record<string>;'
    expectRejected(parseVfsl(text), text)
  })

  it('标记类型大小写是契约：ymap（小写）越界', () => {
    const text = 'type A = { m: ymap<{}> };'
    expectRejected(parseVfsl(text), text)
  })
})

describe('覆盖矩阵 · 负例补充', () => {
  it('封闭对象字面量：索引签名 [key: string] 越界（未声明字段拒绝的语义基础）', () => {
    const text = 'type A = { [key: string]: number };'
    expectRejected(parseVfsl(text), text)
  })

  it('原始类型仅限 string/number/boolean/null/unknown：symbol 越界', () => {
    const text = 'type A = { x: symbol };'
    expectRejected(parseVfsl(text), text)
  })

  it('数组类型仅限 T[]：元组 [string] 越界', () => {
    const text = 'type A = { x: [string] };'
    expectRejected(parseVfsl(text), text)
  })

  it('注释负例：未闭合的块注释 /* 报错', () => {
    const text = 'type A = { x: string } /* 未闭合'
    expectRejected(parseVfsl(text), text)
  })
})

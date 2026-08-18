/**
 * SA6 红灯套件 4/4 — JSDoc 原文捕获与挂载。
 *
 * 契约锚点：/** *\/ 原文捕获并挂载到相邻 IR 节点（类型别名 / 属性 / 标记类型处）；
 * // 行注释与 /* *\/ 块注释只被忽略，内容不得进入 IR。
 */
import { describe, it, expect } from 'vitest'
import { parseVfsl } from '@nomicore/vfsl'
import { collectStrings, nodeByName } from './helpers'

describe('JSDoc：/** */ 原文挂载到正确的节点', () => {
  it('别名级：/** 原文 */ 挂载到类型别名节点', () => {
    const text = '/** 资产的根类型 */\ntype Asset = { name: string }'
    const r = parseVfsl(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(collectStrings(r.module)).toContain('资产的根类型')
    // 必须挂在 Asset 节点上，而非游离在 module 别处
    expect(collectStrings(nodeByName(r.module, 'Asset')!)).toContain('资产的根类型')
  })

  it('属性级：/** 原文 */ 挂载到对应属性节点', () => {
    const text = ['type Asset = {', '  /** 资产唯一标识 */', '  name: string;', '  age: number', '}'].join('\n')
    const r = parseVfsl(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const asset = nodeByName(r.module, 'Asset')
    expect(asset).toBeDefined()
    if (!asset) return
    expect(collectStrings(nodeByName(asset, 'name')!)).toContain('资产唯一标识')
  })

  it('标记类型处：/** 原文 */ 挂载到带标记类型的属性节点', () => {
    const text = ['type Node = {', '  /** 物化元数据映射 */', '  meta: YMap<{ version: number }>;', '}'].join('\n')
    const r = parseVfsl(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const node = nodeByName(r.module, 'Node')
    expect(node).toBeDefined()
    if (!node) return
    expect(collectStrings(nodeByName(node, 'meta')!)).toContain('物化元数据映射')
  })

  it('注释区分：/* */ 块注释与 // 行注释的内容不得进入 IR（仅 /** */ 被捕获）', () => {
    const text = [
      '// 行注释标记内容-不应出现',
      '/* 块注释标记内容-不应出现 */',
      'type A = { x: string }',
    ].join('\n')
    const r = parseVfsl(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const s = collectStrings(r.module)
    expect(s).not.toContain('行注释标记内容-不应出现')
    expect(s).not.toContain('块注释标记内容-不应出现')
  })

  it('相邻节点不错位：文档一挂到 A、文档二挂到 B，互不串挂', () => {
    const text = [
      '/** 文档一-给A */',
      'type A = { x: string }',
      '',
      '/** 文档二-给B */',
      'type B = { y: number }',
    ].join('\n')
    const r = parseVfsl(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const a = nodeByName(r.module, 'A')
    const b = nodeByName(r.module, 'B')
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    if (!a || !b) return
    const aStrings = collectStrings(a)
    const bStrings = collectStrings(b)
    expect(aStrings).toContain('文档一-给A')
    expect(bStrings).toContain('文档二-给B')
    expect(aStrings).not.toContain('文档二-给B')
    expect(bStrings).not.toContain('文档一-给A')
  })
})

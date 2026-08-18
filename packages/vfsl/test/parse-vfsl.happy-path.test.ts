/**
 * SA6 红灯套件 1/4 — v1 语法子集正例覆盖矩阵（幸福路径）。
 *
 * 契约锚点：parseVfsl(text) → { ok: true, module }。
 * 断言只锁定语义事实（别名/字段/类型/字面量/正则/文档出现在 IR 中），
 * 不锁定 module 的具体键名（IR 形状由 SA3 自定）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseVfsl } from '@nomicore/vfsl'
import { collectNodes, collectStrings, nodeByName } from './helpers'

const VFS3_ASSETS_FIXTURE = fileURLToPath(new URL('./fixtures/vfs3-assets.vfsl', import.meta.url))

describe('parseVfsl 公共接缝', () => {
  it('导出 parseVfsl 函数', () => {
    expect(typeof parseVfsl).toBe('function')
  })
})

describe('v1 语法子集 · 正例覆盖矩阵', () => {
  it('类型别名：type 声明解析成功，别名进入 module', () => {
    const r = parseVfsl('type Asset = { name: string }')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.module).toBeDefined()
    expect(nodeByName(r.module, 'Asset')).toBeDefined()
  })

  it('封闭对象字面量 + 五种原始类型：string/number/boolean/null/unknown', () => {
    const text = 'type Profile = { id: string; age: number; active: boolean; spouse: null; extra: unknown }'
    const r = parseVfsl(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const alias = nodeByName(r.module, 'Profile')
    expect(alias).toBeDefined()
    if (!alias) return
    for (const f of ['id', 'age', 'active', 'spouse', 'extra']) {
      expect(nodeByName(alias, f)).toBeDefined()
    }
    expect(collectStrings(nodeByName(alias, 'id')!)).toContain('string')
    expect(collectStrings(nodeByName(alias, 'age')!)).toContain('number')
    expect(collectStrings(nodeByName(alias, 'active')!)).toContain('boolean')
    expect(collectStrings(nodeByName(alias, 'spouse')!)).toContain('null')
    expect(collectStrings(nodeByName(alias, 'extra')!)).toContain('unknown')
  })

  it('?: 可选属性：subtitle 在 IR 中被标记为可选', () => {
    const text = 'type Doc = { title: string; subtitle?: string }'
    const r = parseVfsl(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const subtitle = nodeByName(nodeByName(r.module, 'Doc')!, 'subtitle')
    expect(subtitle).toBeDefined()
    if (!subtitle) return
    expect(collectNodes(subtitle).some((n) => n.optional === true)).toBe(true)
  })

  it('字面量联合：kind: "note" | "code" 两个成员都进入 IR', () => {
    const text = 'type Doc = { kind: "note" | "code" }'
    const r = parseVfsl(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const kind = nodeByName(nodeByName(r.module, 'Doc')!, 'kind')
    expect(kind).toBeDefined()
    if (!kind) return
    const s = collectStrings(kind)
    expect(s).toContain('note')
    expect(s).toContain('code')
  })

  it('数组类型 T[]：成员类型进入字段 IR', () => {
    const text = 'type Doc = { tags: string[] }'
    const r = parseVfsl(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const tags = nodeByName(nodeByName(r.module, 'Doc')!, 'tags')
    expect(tags).toBeDefined()
    if (!tags) return
    expect(collectStrings(tags)).toContain('string')
  })

  it('Record<K, V>：键与值两个类型参数都进入字段 IR', () => {
    const text = 'type Env = { limits: Record<string, number> }'
    const r = parseVfsl(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const limits = nodeByName(nodeByName(r.module, 'Env')!, 'limits')
    expect(limits).toBeDefined()
    if (!limits) return
    const s = collectStrings(limits)
    expect(s).toContain('string')
    expect(s).toContain('number')
  })

  it('string & Pattern<"正则">：正则原文进入字段 IR', () => {
    const text = 'type Asset = { name: string & Pattern<"^[a-z0-9]+(\\.[a-z0-9]+)*$"> }'
    const r = parseVfsl(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const name = nodeByName(nodeByName(r.module, 'Asset')!, 'name')
    expect(name).toBeDefined()
    if (!name) return
    expect(collectStrings(name)).toContain('^[a-z0-9]+(\\.[a-z0-9]+)*$')
  })

  it('注释：// 行注释与 /* 块注释被忽略，不影响解析', () => {
    const text = [
      '// 行注释：类型行前置',
      '/* 块注释：跨字段 */',
      'type Doc = {',
      '  title: string; // 行尾注释',
      '  body: string; /* 行间块注释 */',
      '}',
    ].join('\n')
    const r = parseVfsl(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const doc = nodeByName(r.module, 'Doc')
    expect(doc).toBeDefined()
    if (!doc) return
    expect(nodeByName(doc, 'title')).toBeDefined()
    expect(nodeByName(doc, 'body')).toBeDefined()
  })

  it('六个标记类型（大小写是契约）：YMap/YArray/YPlainArray/YLeaf/YXmlFragment/Pattern 均可用', () => {
    const text = [
      'type Node = {',
      '  meta: YMap<{ version: number }>;',
      '  items: YArray<string>;',
      '  raw: YPlainArray<number>;',
      '  leaf: YLeaf;',
      '  xml: YXmlFragment;',
      '  name: string & Pattern<"^[a-z]+$">;',
      '}',
    ].join('\n')
    const r = parseVfsl(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const node = nodeByName(r.module, 'Node')
    expect(node).toBeDefined()
    if (!node) return
    for (const f of ['meta', 'items', 'raw', 'leaf', 'xml', 'name']) {
      expect(nodeByName(node, f)).toBeDefined()
    }
    const s = collectStrings(node)
    expect(s).toContain('YMap')
    expect(s).toContain('YArray')
    expect(s).toContain('YPlainArray')
    expect(s).toContain('YLeaf')
    expect(s).toContain('YXmlFragment')
  })

  it('正例 fixture：vfs3.assets 全量解析为 IR（设计文档 §4 重构）', () => {
    const text = readFileSync(VFS3_ASSETS_FIXTURE, 'utf8')
    const r = parseVfsl(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const asset = nodeByName(r.module, 'Asset')
    expect(asset).toBeDefined()
    if (!asset) return
    for (const f of ['name', 'kind', 'meta', 'tags', 'raw', 'leaf', 'xml', 'owner']) {
      expect(nodeByName(asset, f)).toBeDefined()
    }
    expect(collectStrings(nodeByName(asset, 'kind')!)).toContain('file')
    expect(collectStrings(nodeByName(asset, 'kind')!)).toContain('dir')
    expect(collectStrings(nodeByName(asset, 'name')!)).toContain('^[a-z0-9][a-z0-9-]*$')
    expect(collectStrings(asset)).toContain('资产唯一标识，禁止含 . 与 | 字符')
    expect(collectStrings(asset)).toContain('物化元数据')
  })
})

describe('IR 可观察性质', () => {
  it('IR 可序列化：module JSON 往返不丢信息（编译缓存的前提）', () => {
    const text = 'type Asset = { name: string & Pattern<"^[a-z]+$">; kind: "file" | "dir" }'
    const r = parseVfsl(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(() => JSON.stringify(r.module)).not.toThrow()
    expect(JSON.parse(JSON.stringify(r.module))).toEqual(r.module)
  })

  it('纯函数确定性：同一输入两次解析结果完全一致', () => {
    const text = 'type A = { x: string; y?: number }'
    expect(parseVfsl(text)).toEqual(parseVfsl(text))
  })
})

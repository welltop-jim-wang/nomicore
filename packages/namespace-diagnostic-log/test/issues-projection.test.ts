/**
 * 红灯契约 — §9.4 issues 投影边界（验收标准 3）
 * 锚点：ADR 0012 §投影（message ≤ 4 KiB、path ≤ 256 段、string 段 ≤ 1 KiB、issues ≤ 1000 条、
 *       确定性截断、truncated/originalCount、不拆 code point）+ 设计 §6.1（R2/E-c2 预算基准 =
 *       JSON 字面量内容字节；R2/E-c1 入口 loud 断言 TruncationBudgetBelowMarker）+ §6.2
 *       （R2/C-b1 段级 JSON-safe：NaN/±Infinity/undefined/稀疏 hole 段整条丢弃；
 *       -0 段归一 +0）+ §2.3（IssuesProjection 形状）+ §4.2（enrichment-field-dropped/issues）。
 */
import { describe, expect, it } from 'vitest'
import { jsonLiteralBytes, truncateUtf8, TRUNCATION_MARKER } from '../src/testing.js'
import { assertAttempt, baseEmission, eventsOfType, makeLog } from './helpers/base.js'
import { expectTwin } from './helpers/twin.js'

const MARKER = '…[truncated]'

/** 构造单 issue emission 并取回投影后的 IssuesProjection。 */
function project(issues: unknown, policy: 'none' | 'full' | 'redacted' = 'full') {
  const { log } = makeLog({ issuesPolicy: policy })
  log.emitter.emit(baseEmission({ issues }))
  const record = assertAttempt(log.records()[0]!)
  return record.issues!
}

describe('§9.4 message 4 KiB 字节预算（R2/E-c2 JSON 字面量基准）', () => {
  it('恰 4096B 不截断；4097B 截断且序列化字节 ≤ 4096', () => {
    const exact = project([{ message: 'a'.repeat(4096), path: [] }])
    expect(exact.items[0]!.message).toBe('a'.repeat(4096))
    expect('truncated' in exact).toBe(false)

    const over = project([{ message: 'a'.repeat(4097), path: [] }])
    expect(over.items[0]!.message.endsWith(MARKER)).toBe(true)
    expect(jsonLiteralBytes(over.items[0]!.message)).toBeLessThanOrEqual(4096)
    expect(over.truncated).toBe(true)
    expect(over.originalCount).toBe(1)
  })

  it('多字节字符骑界：3B 字符不拆分（截在字符前）', () => {
    // 4082 a（4082B）+ 3×€（9B）+ 10 b → 4101B > 4096 → 截断；€ 必须整体排除
    // （R4/C-4：marker 预留 14B → 前缀预算 4082 = 4096 − 14）
    const proj = project([{ message: 'a'.repeat(4082) + '€'.repeat(3) + 'b'.repeat(10), path: [] }])
    expect(proj.items[0]!.message).toBe('a'.repeat(4082) + MARKER)
    expect(jsonLiteralBytes(proj.items[0]!.message)).toBe(4096)
  })

  it('astral 字符（代理对）不拆分：输出无 lone surrogate', () => {
    const proj = project([{ message: 'a'.repeat(4083) + '😀'.repeat(5) + 'b'.repeat(10), path: [] }])
    const out = proj.items[0]!.message
    expect(out.endsWith(MARKER)).toBe(true)
    for (const ch of out) {
      const cp = ch.codePointAt(0)!
      expect(cp >= 0xd800 && cp <= 0xdfff, '输出不得含 lone surrogate').toBe(false)
    }
    expect(jsonLiteralBytes(out)).toBeLessThanOrEqual(4096)
  })

  it('R2/E-c2 逐单位 KAT：lone surrogate 计 6B、\\n 与 " 计 2B、control 计 6B、astral 计 4B、ASCII 1B', () => {
    expect(jsonLiteralBytes('a')).toBe(1)
    expect(jsonLiteralBytes('€')).toBe(3)
    expect(jsonLiteralBytes('😀')).toBe(4)
    expect(jsonLiteralBytes('\n')).toBe(2)
    expect(jsonLiteralBytes('"')).toBe(2)
    expect(jsonLiteralBytes('\\')).toBe(2)
    expect(jsonLiteralBytes('\u0001')).toBe(6)
    expect(jsonLiteralBytes('\ud800')).toBe(6)
  })

  it('1365 个 lone surrogate（字面量 8190B）> 4096 → 截断且截断后序列化字节 ≤ 4096', () => {
    const proj = project([{ message: '\ud800'.repeat(1365), path: [] }])
    const msg = proj.items[0]!.message
    expect(jsonLiteralBytes(msg)).toBeLessThanOrEqual(4096)
    expect(msg.endsWith(MARKER)).toBe(true)
    expect(msg.length).toBeLessThan(1365)
    expect(proj.truncated).toBe(true)
  })
})

describe('§9.4 path / 条目数预算', () => {
  it('path 257 段 → 保前 256 段 + truncated', () => {
    const path = Array.from({ length: 257 }, (_, i) => `s${i}`)
    const proj = project([{ message: 'm', path }])
    expect(proj.items[0]!.path).toHaveLength(256)
    expect(proj.items[0]!.path[0]).toBe('s0')
    expect(proj.items[0]!.path[255]).toBe('s255')
    expect(proj.truncated).toBe(true)
  })

  it('string 段 1025B → 截断到 ≤1024B（前缀 1010B + marker 14B）', () => {
    const proj = project([{ message: 'm', path: ['a'.repeat(1025)] }])
    const seg = proj.items[0]!.path[0] as string
    expect(jsonLiteralBytes(seg)).toBeLessThanOrEqual(1024)
    expect(seg.endsWith(MARKER)).toBe(true)
    expect(proj.truncated).toBe(true)
  })

  it('number 段原样保留（含 0）；string/number 混合 path 保序', () => {
    const proj = project([{ message: 'm', path: ['a', 1, 'b', 2] }])
    expect(proj.items[0]!.path).toEqual(['a', 1, 'b', 2])
  })

  it('1001 条 → 保前 1000 条 + truncated + originalCount=1001；恰 1000 条 → 无截断标记', () => {
    const many = Array.from({ length: 1001 }, (_, i) => ({ message: `m${i}`, path: [] }))
    const proj = project(many)
    expect(proj.items).toHaveLength(1000)
    expect(proj.truncated).toBe(true)
    expect(proj.originalCount).toBe(1001)

    const exact = Array.from({ length: 1000 }, (_, i) => ({ message: `m${i}`, path: [] }))
    const proj2 = project(exact)
    expect(proj2.items).toHaveLength(1000)
    expect('truncated' in proj2).toBe(false)
    expect('originalCount' in proj2).toBe(false)
  })

  it('truncated/originalCount 为 presence 语义（VFSL 可选字段；从未截断时键不存在）', () => {
    const proj = project([{ message: 'm', path: [] }])
    expect('truncated' in proj).toBe(false)
    expect('originalCount' in proj).toBe(false)
    expect(proj.policy).toBe('full')
    expect(proj.items).toHaveLength(1)
  })
})

describe('§9.4 策略投影（policy 自标，ADR 0011 §数据保护）', () => {
  it('redacted：message→«redacted»，code/path 保留，policy 自标', () => {
    const proj = project(
      [{ code: 'registry.e1', message: 'secret failure detail', path: ['a', 1] }],
      'redacted',
    )
    expect(proj.policy).toBe('redacted')
    expect(proj.items[0]!.message).toBe('«redacted»')
    expect(proj.items[0]!.code).toBe('registry.e1')
    expect(proj.items[0]!.path).toEqual(['a', 1])
  })

  it('none：空 items（策略即承诺不捕获）', () => {
    const proj = project([{ message: 'm', path: [] }], 'none')
    expect(proj).toEqual({ policy: 'none', items: [] })
  })

  it('code 截断至 256B（R2 预算基准下 242B 前缀 + marker 14B）', () => {
    const proj = project([{ code: 'c'.repeat(300), message: 'm', path: [] }])
    const code = proj.items[0]!.code!
    expect(jsonLiteralBytes(code)).toBeLessThanOrEqual(256)
    expect(code.endsWith(MARKER)).toBe(true)
    expect(proj.truncated).toBe(true)
  })

  it('R5/spec C-S1：redacted 策略下 path 301 段（含 1025B string 段）→ 截断到 256 段 + 两键同现', () => {
    const path = ['a'.repeat(1025), ...Array.from({ length: 300 }, (_, i) => `s${i}`)]
    const proj = project([{ message: 'secret', path }], 'redacted')
    expect(proj.policy).toBe('redacted')
    // message 在 redacted 下仍为 «redacted»（与预算路径正交）
    expect(proj.items[0]!.message).toBe('«redacted»')
    expect(proj.items[0]!.path).toHaveLength(256)
    // 长 string 段截断到 ≤1024B（前缀 1010B + marker 14B）
    const seg = proj.items[0]!.path[0] as string
    expect(jsonLiteralBytes(seg)).toBeLessThanOrEqual(1024)
    expect(seg.endsWith(MARKER)).toBe(true)
    expect(proj.items[0]!.path[255]).toBe('s254')
    // 预算截断（非畸形丢弃）→ truncated/originalCount 两键同现（R5/C-3 回摆后仍成立）
    expect(proj.truncated).toBe(true)
    expect(proj.originalCount).toBe(1)
  })
})

describe('§9.4 畸形条目丢弃（§4.2/§6.2）', () => {
  it('缺 message / path 非数组 → 整条丢弃（事件上报，truncated/originalCount 两键缺席）', () => {
    const proj = project([
      { path: [] } as never,
      { message: 'm', path: 'not-array' } as never,
      { message: 'ok', path: [] },
    ])
    expect(proj.items).toEqual([{ message: 'ok', path: [] }])
    // R5/C-3 presence 回摆：presence 严格 ⇔ 预算截断（与冻结 schema JSDoc 逐字一致）；
    // 畸形丢弃只经 enrichment-field-dropped/issues 事件上报——两键均缺席
    expect('truncated' in proj).toBe(false)
    expect('originalCount' in proj).toBe(false)
  })

  it('R2/C-b1 段级 JSON-safe：NaN/±Infinity 段 → 整条丢弃 + enrichment-field-dropped/issues', () => {
    const { log, events } = makeLog({ issuesPolicy: 'full' })
    log.emitter.emit(
      baseEmission({
        issues: [
          { message: 'nan', path: [0, Number.NaN, 'x'] },
          { message: 'inf', path: [1, Number.POSITIVE_INFINITY] },
          { message: 'ninf', path: [Number.NEGATIVE_INFINITY, 2] },
          { message: 'valid', path: [0, 'a'] },
        ],
      }),
    )
    const proj = assertAttempt(log.records()[0]!).issues!
    expect(proj.items).toHaveLength(1)
    expect(proj.items[0]!.message).toBe('valid')
    // R5/C-3 presence 回摆：畸形丢弃（段级 JSON-safe 拒绝）两键均缺席，仅事件上报
    expect('truncated' in proj).toBe(false)
    expect('originalCount' in proj).toBe(false)
    const dropped = eventsOfType(events, 'enrichment-field-dropped').filter((e) => e.field === 'issues')
    expect(dropped.length).toBe(1)
    expect(dropped[0]!.type).toBe('enrichment-field-dropped')
  })

  it('undefined 段（稀疏数组 hole 读出）→ 整条丢弃', () => {
    const holey: unknown[] = []
    holey.length = 2
    holey[1] = 'x'
    const proj = project([{ message: 'hole', path: holey }, { message: 'ok', path: [] }])
    expect(proj.items).toHaveLength(1)
    expect(proj.items[0]!.message).toBe('ok')
    // R5/C-3 presence 回摆：畸形丢弃两键均缺席
    expect('truncated' in proj).toBe(false)
    expect('originalCount' in proj).toBe(false)
  })

  it('-0 number 段 → 投影归一为 +0（内存对象即 0，非 -0）', () => {
    const proj = project([{ message: 'm', path: [-0, 1] }])
    const seg = proj.items[0]!.path[0] as number
    expect(Object.is(seg, -0)).toBe(false)
    expect(seg).toBe(0)
  })
})

describe('R5/spec C-S2：emission.issues 按 §2.6 为 DiagnosticIssue[] 裸数组（防「数组被静默丢弃」回归）', () => {
  it('裸数组逐条投影：items 与输入一一对应、保序、policy 自标；无截断无丢弃则两键缺席', () => {
    const { log } = makeLog({ issuesPolicy: 'full' })
    log.emitter.emit(
      baseEmission({
        issues: [
          { code: 'r.e1', message: 'first', path: ['a', 1] },
          { message: 'second', path: [] },
          { code: 'r.e2', message: 'third', path: ['b'] },
        ],
      }),
    )
    const proj = assertAttempt(log.records()[0]!).issues!
    expect(proj.policy).toBe('full')
    expect(proj.items).toHaveLength(3)
    expect(proj.items[0]).toEqual({ code: 'r.e1', message: 'first', path: ['a', 1] })
    expect(proj.items[1]).toEqual({ message: 'second', path: [] })
    expect(proj.items[2]).toEqual({ code: 'r.e2', message: 'third', path: ['b'] })
    expect('truncated' in proj).toBe(false)
    expect('originalCount' in proj).toBe(false)
  })
})

describe('§9.4 R2/E-c1 小预算 loud 断言（truncateUtf8）', () => {
  it('budget=12（< marker 14B）→ loud throw，不静默产出超预算输出', () => {
    expect(() => truncateUtf8('x', 12)).toThrow()
  })

  it('生产调用点常量（4096/1024/256）全 ≥ marker 14B：真实预算下不触发内部不变量违反', () => {
    expect(() => truncateUtf8('a'.repeat(4096), 4096)).not.toThrow()
    expect(() => truncateUtf8('a'.repeat(1024), 1024)).not.toThrow()
    expect(() => truncateUtf8('a'.repeat(256), 256)).not.toThrow()
  })

  it('TRUNCATION_MARKER 字节数 = 14（R4/C-4 勘误：13B → 14B）', () => {
    expect(jsonLiteralBytes(TRUNCATION_MARKER)).toBe(14)
    expect(TRUNCATION_MARKER).toBe(MARKER)
  })
})

describe('§9.4 孪生不变量：投影结果经 JSON round-trip 后仍通过 schema（§9.8 通用 helper）', () => {
  it('全部上文投影场景抽样 round-trip 合法', () => {
    const { log } = makeLog({ issuesPolicy: 'full' })
    log.emitter.emit(
      baseEmission({
        issues: [
          { message: 'a'.repeat(4097), path: ['s'.repeat(1025), -0, 1] },
          { code: 'c'.repeat(300), message: '\ud800'.repeat(3), path: [] },
        ],
      }),
    )
    for (const record of log.records()) expectTwin(record, 'issues projection')
  })
})

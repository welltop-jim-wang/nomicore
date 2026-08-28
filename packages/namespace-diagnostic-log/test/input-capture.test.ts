/**
 * 红灯契约 — §9.3 输入捕获四策略（验收标准 2）
 * 锚点：ADR 0011 §输入捕获（默认 digest 或更保守；capability/acceptance gate 前拒绝 =
 *       not-accessed，不得随后序列化/hash/检查；快照失败 = unavailable/unsafe-input，
 *       事实优先于策略）+ 设计 §5.1（决策表全格 5 输入行 × 4 策略）+ §5.2（digest =
 *       SHA-256(RFC 8785 JCS bytes)；KAT：RFC 8785 向量子集 + SHA-256 标准向量 +
 *       lone surrogate 确定性扩展；键序 = UTF-16 code unit；数字 = ECMAScript
 *       Number::toString）+ §5.3（redacted 算法：叶→«redacted»、null 保留、结构保形；
 *       节点护栏 1M → unavailable）+ §5.4（非 JSON 值/遍历抛出 → unavailable +
 *       input-projection-failed，不重读）+ §7.4/§9.8（-0 的 full 嵌入视图契约：
 *       内存保留 -0、JSON 视图 0、round-trip 合法）。
 */
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { jcs, sha256Hex } from '../src/testing.js'
import { assertAttempt, baseEmission, makeLog } from './helpers/base.js'
import { expectTwin } from './helpers/twin.js'

const digestOf = (text: string): string =>
  createHash('sha256').update(new TextEncoder().encode(text)).digest('hex')

describe('§9.3 决策表全格（§5.1）', () => {
  const POLICIES = ['none', 'digest', 'redacted', 'full'] as const
  const SNAPSHOT = { a: 1, b: [2, 3] }
  const SNAPSHOT_DIGEST = digestOf(jcs(SNAPSHOT))

  it('input 省略 → capture:none（四策略同）', () => {
    for (const inputPolicy of POLICIES) {
      const { log } = makeLog({ inputPolicy })
      log.emitter.emit(baseEmission())
      expect(assertAttempt(log.records()[0]!).input, `policy=${inputPolicy}`).toEqual({ capture: 'none' })
    }
  })

  it('{status:not-accessed} → capture:not-accessed（事实优先于策略，四列皆同）', () => {
    for (const inputPolicy of POLICIES) {
      const { log } = makeLog({ inputPolicy })
      log.emitter.emit(baseEmission({ input: { status: 'not-accessed' } }))
      expect(assertAttempt(log.records()[0]!).input, `policy=${inputPolicy}`).toEqual({ capture: 'not-accessed' })
    }
  })

  it('{status:unavailable} → capture:unavailable（四列皆同）', () => {
    for (const inputPolicy of POLICIES) {
      const { log } = makeLog({ inputPolicy })
      log.emitter.emit(baseEmission({ input: { status: 'unavailable' } }))
      expect(assertAttempt(log.records()[0]!).input, `policy=${inputPolicy}`).toEqual({ capture: 'unavailable' })
    }
  })

  it('{status:unsafe-input} → capture:unsafe-input（四列皆同）', () => {
    for (const inputPolicy of POLICIES) {
      const { log } = makeLog({ inputPolicy })
      log.emitter.emit(baseEmission({ input: { status: 'unsafe-input' } }))
      expect(assertAttempt(log.records()[0]!).input, `policy=${inputPolicy}`).toEqual({ capture: 'unsafe-input' })
    }
  })

  it('{snapshot} × none → capture:none（策略不捕获则不触碰快照）', () => {
    const { log } = makeLog({ inputPolicy: 'none' })
    log.emitter.emit(baseEmission({ input: { snapshot: SNAPSHOT } }))
    expect(assertAttempt(log.records()[0]!).input).toEqual({ capture: 'none' })
  })

  it('{snapshot} × digest → {capture:digest, digest}（无 value）', () => {
    const { log } = makeLog({ inputPolicy: 'digest' })
    log.emitter.emit(baseEmission({ input: { snapshot: SNAPSHOT } }))
    const input = assertAttempt(log.records()[0]!).input
    expect(input).toEqual({ capture: 'digest', digest: SNAPSHOT_DIGEST })
    expect('value' in (input as object)).toBe(false)
  })

  it('{snapshot} × full → {capture:full, value:快照引用, digest}', () => {
    const { log } = makeLog({ inputPolicy: 'full' })
    log.emitter.emit(baseEmission({ input: { snapshot: SNAPSHOT } }))
    const input = assertAttempt(log.records()[0]!).input
    expect(input).toMatchObject({ capture: 'full', value: SNAPSHOT, digest: SNAPSHOT_DIGEST })
  })

  it('{snapshot} × redacted → {capture:redacted, value:脱敏后结构, digest:全量快照 digest}', () => {
    const { log } = makeLog({ inputPolicy: 'redacted' })
    log.emitter.emit(baseEmission({ input: { snapshot: SNAPSHOT } }))
    const input = assertAttempt(log.records()[0]!).input
    expect(input).toMatchObject({
      capture: 'redacted',
      value: { a: '«redacted»', b: ['«redacted»', '«redacted»'] },
      digest: SNAPSHOT_DIGEST, // 与投影策略无关地对全量快照计算（§2.2/§10-J7）
    })
  })
})

describe('§9.3 digest KAT：RFC 8785 向量子集 + SHA-256 标准向量（§5.2）', () => {
  it('键序 = UTF-16 code unit（设计语义：JS `<`；`\\r` < `€`）', () => {
    const input: Record<string, unknown> = {
      '€': 'Euro Sign',
      '\r': 'Carriage Return',
      '\n': 'New Line',
      '1': 'One',
      '2': 'Two',
      '1.0': 'One Point Zero',
      '0': 'Zero',
      '\u0001': 'Control Char',
    }
    const canonical = jcs(input)
    // 逐字断言 canonical 文本（转义在文本内）：
    expect(canonical).toBe(
      '{"\\u0001":"Control Char","\\n":"New Line","\\r":"Carriage Return",' +
        '"0":"Zero","1":"One","1.0":"One Point Zero","2":"Two","€":"Euro Sign"}',
    )
    // end-to-end：emitter digest 与该 canonical 文本 SHA-256 一致
    const { log } = makeLog({ inputPolicy: 'digest' })
    log.emitter.emit(baseEmission({ input: { snapshot: input } }))
    const recordInput = assertAttempt(log.records()[0]!).input
    expect(recordInput).toMatchObject({ capture: 'digest', digest: digestOf(canonical) })
  })

  it('数字序列化（ECMAScript Number::toString）：1e+21 / -0 → 0 / 1e-7 / 1e-6 / 333333333.33333329', () => {
    expect(jcs(-0)).toBe('0')
    expect(jcs(1e21)).toBe('1e+21')
    expect(jcs(1e-7)).toBe('1e-7')
    expect(jcs(1e-6)).toBe('0.000001')
    expect(jcs(333333333.33333329)).toBe('333333333.3333333')
    const canonical = jcs({ n: 333333333.33333329, e: 1e21, z: -0, tiny: 1e-7 })
    expect(canonical).toBe('{"e":1e+21,"n":333333333.3333333,"tiny":1e-7,"z":0}')
  })

  it('字符串转义：引号/反斜杠/控制字符 → JSON.stringify 规则；lone surrogate → \\udXXX（well-formed）', () => {
    expect(jcs('a"b\\c')).toBe('"a\\"b\\\\c"')
    expect(jcs('\u0001\r\n')).toBe('"\\u0001\\r\\n"')
    expect(jcs('\ud800')).toBe('"\\ud800"')
    expect(jcs('😀')).toBe('"😀"')
  })

  it('SHA-256 标准向量（空串/abc）— 经 sha256Hex 接缝（§9.3 KAT）', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    // 管线 digest == sha256Hex(jcs(snapshot))：两条独立路径同值
    const { log } = makeLog({ inputPolicy: 'digest' })
    const snapshot = { message: 'abc' }
    log.emitter.emit(baseEmission({ input: { snapshot } }))
    expect(assertAttempt(log.records()[0]!).input).toMatchObject({ digest: sha256Hex(jcs(snapshot)) })
  })

  it('lone surrogate 快照的确定性 digest（RFC 未定义域的确定性全函数扩展，§5.2）', () => {
    const snapshot = { message: '\ud800'.repeat(3) }
    const expected = '3ac71dce3f46d391a8e97fb99a9f3ad77adb603a8e2784d7f7b6b189a37326a2'
    expect(sha256Hex(jcs(snapshot))).toBe(expected)
    const { log } = makeLog({ inputPolicy: 'digest' })
    log.emitter.emit(baseEmission({ input: { snapshot } }))
    expect(assertAttempt(log.records()[0]!).input).toMatchObject({ capture: 'digest', digest: expected })
  })
})

describe('§9.3 redacted 算法（§5.3：结构保形、叶值脱敏、null 保留）', () => {
  it('string/number/boolean 叶 → «redacted»；null 保留；object/array 保形递归', () => {
    const snapshot = {
      name: 'secret-name',
      attempts: 3,
      enabled: true,
      note: null,
      nested: { items: [1, 'x', { deep: false }], ok: 0 },
    }
    const { log } = makeLog({ inputPolicy: 'redacted' })
    log.emitter.emit(baseEmission({ input: { snapshot } }))
    const input = assertAttempt(log.records()[0]!).input
    expect(input).toMatchObject({
      capture: 'redacted',
      value: {
        name: '«redacted»',
        attempts: '«redacted»',
        enabled: '«redacted»',
        note: null,
        nested: { items: ['«redacted»', '«redacted»', { deep: '«redacted»' }], ok: '«redacted»' },
      },
    })
    // digest 仍是全量快照（未脱敏前）的摘要——精确比对靠同记录 digest（§5.3）
    expect(input).toMatchObject({ digest: digestOf(jcs(snapshot)) })
    expectTwin(log.records()[0]!, 'redacted')
  })

  it('节点护栏：>1,000,000 节点 → unavailable + input-projection-failed（防畸形巨型快照）', () => {
    const huge = new Array(1_000_001).fill(0)
    const { log, events } = makeLog({ inputPolicy: 'redacted' })
    log.emitter.emit(baseEmission({ input: { snapshot: huge } }))
    expect(assertAttempt(log.records()[0]!).input).toEqual({ capture: 'unavailable' })
    expect(events.some((e) => e.type === 'input-projection-failed')).toBe(true)
  })
})

describe('§9.3 快照契约违反与零重读（§5.4）', () => {
  it('symbol/bigint/function 值 → unavailable（traversal 防御）', () => {
    for (const value of [Symbol('s'), 10n, () => 1]) {
      const { log, events } = makeLog({ inputPolicy: 'digest' })
      log.emitter.emit(baseEmission({ input: { snapshot: { v: value } } }))
      expect(assertAttempt(log.records()[0]!).input).toEqual({ capture: 'unavailable' })
      expect(events.some((e) => e.type === 'input-projection-failed')).toBe(true)
    }
  })

  it('-0 在 full 嵌入视图中内存保留、JSON 视图为 0、round-trip 合法（§5.4/§9.8）', () => {
    const snapshot = { z: -0 }
    const { log } = makeLog({ inputPolicy: 'full' })
    log.emitter.emit(baseEmission({ input: { snapshot } }))
    const input = assertAttempt(log.records()[0]!).input
    const value = (input as { value: { z: number } }).value
    expect(Object.is(value.z, -0)).toBe(true)
    // digest 侧 -0 归一为 "0"（RFC 8785 §3.2.2.3），与序列化视图同基
    expect(input).toMatchObject({ digest: digestOf('{"z":0}') })
    expectTwin(log.records()[0]!, '-0 round-trip')
  })

  it('同一敌意 getter 只触达一次（不重读不重试，ADR 0011 §输入捕获）', () => {
    let touches = 0
    const snapshot = new Proxy(
      { k: 'v' },
      {
        get(target, key, receiver) {
          if (key === 'k') touches++
          return Reflect.get(target, key, receiver)
        },
      },
    )
    const { log } = makeLog({ inputPolicy: 'digest' })
    log.emitter.emit(baseEmission({ input: { snapshot } }))
    expect(assertAttempt(log.records()[0]!).input).toMatchObject({ capture: 'digest' })
    expect(touches).toBe(1)
  })
})

/**
 * 红灯契约 — §9.9 update 物理化（验收标准 5 副产品 + ADR 0012 §Inline 与 sidecar）
 * 锚点：ADR 0012 §Binary frame v1（CRC-32C 参数 0x1EDC6F41/init 0xFFFFFFFF/refin/refout/
 *       xorout 0xFFFFFFFF；check("123456789") = 0xE3069283）+ 设计 §7.3（表驱动、8 位小写 hex）+
 *       §7.4（physicalize 三守卫分支：empty-update 最前 / update-capture-disabled /
 *       payload-too-large，均保 attempt metadata，**不得**产生 vfsl-validation-failed）+
 *       §2.1/§11 R2/D-c1（P_BASE64 空串论证与 empty-update 词表）+ §2.5（inline carrier
 *       字段：storage/format/payloadLength/crc32c/base64，RFC 4648 恒 padding）。
 * R3 修订：CRC32C 空输入 KAT 改为 `crc32cHex(new Uint8Array(0)) === '00000000'` 直测
 * （testing 子路径导出）——与同文件 empty-update 断言（0 字节 emit 路径必转
 * update-omitted/empty-update，不可能产出 inline 空 Base64 carrier）互斥，不再走 emit。
 */
import { describe, expect, it } from 'vitest'
import { crc32cHex } from '../src/testing.js'
import { assertAttempt, baseEmission, makeLog } from './helpers/base.js'
import { expectTwin } from './helpers/twin.js'

describe('§9.9 CRC32C KAT（ADR 逐字）与 inline carrier 字段（§7.3）', () => {
  it('check("123456789") === 0xE3069283：经 carrier 可观测', () => {
    const { log } = makeLog({ updateCapture: true })
    const bytes = new TextEncoder().encode('123456789')
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: bytes } }))
    const update = (assertAttempt(log.records()[0]!).result as { effect: string; update: { crc32c: string } }).update
    expect(update.crc32c).toBe('e3069283')
  })

  it('R3 修订：空输入 CRC32C KAT 直测 crc32cHex（0 字节不产 inline carrier——见 empty-update 断言）', () => {
    expect(crc32cHex(new Uint8Array(0))).toBe('00000000')
  })

  it('增量向量："a" → c1d04330、"abc" → 364b3fb7、"hello world" → c99465aa', () => {
    for (const [text, expectedCrc] of [
      ['a', 'c1d04330'],
      ['abc', '364b3fb7'],
      ['hello world', 'c99465aa'],
    ] as const) {
      const { log } = makeLog({ updateCapture: true })
      log.emitter.emit(
        baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: new TextEncoder().encode(text) } }),
      )
      const result = assertAttempt(log.records()[0]!).result as { effect: string; update: { payloadLength: number; base64: string; crc32c: string } }
      expect(result.update.crc32c, `crc32c("${text}")`).toBe(expectedCrc)
      expect(result.update.payloadLength).toBe(text.length)
      // Base64 恒 padding 可解码 round-trip（RFC 4648 标准形）
      const decoded = Buffer.from(result.update.base64, 'base64')
      expect(decoded.toString('utf8')).toBe(text)
      expect(result.update.base64).not.toMatch(/\s/)
    }
  })

  it('inline carrier 字段逐字对齐：storage/format/payloadLength/crc32c/base64（§2.5）', () => {
    const { log } = makeLog({ updateCapture: true })
    log.emitter.emit(
      baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: new TextEncoder().encode('123456789') } }),
    )
    const record = assertAttempt(log.records()[0]!)
    expect(record.result).toEqual({
      kind: 'committed',
      effect: 'update',
      update: { storage: 'inline', format: 'yjs-update-v1', payloadLength: 9, crc32c: 'e3069283', base64: 'MTIzNDU2Nzg5' },
    })
    expectTwin(record, 'inline carrier')
  })
})

describe('§9.9 update-omitted 三 reason 分支（§7.4 守卫）', () => {
  it('payload-too-large：bytes > payloadMaxBytes → update-omitted 保 attempt metadata', () => {
    const { log, events } = makeLog({ updateCapture: true, payloadMaxBytes: 8 })
    const bytes = new Uint8Array(9).fill(1)
    log.emitter.emit(
      baseEmission({ operation: 'replication-apply', result: { kind: 'committed', effect: 'update', updateBytes: bytes } }),
    )
    const record = assertAttempt(log.records()[0]!)
    expect(record.operation).toBe('replication-apply')
    expect(record.result).toEqual({ kind: 'committed', effect: 'update-omitted', reason: 'payload-too-large' })
    // 保 metadata：attemptId/sequence/observedAt 都在
    expect(record.attemptId).toBe('att-11111111111111111111111111111111')
    expect(record.sequence).toBe('1')
    expect(events.some((e) => e.type === 'vfsl-validation-failed')).toBe(false)
    expectTwin(record, 'payload-too-large')
  })

  it('update-capture-disabled：默认配置（updateCapture:false）→ update-omitted 保事实', () => {
    const { log, events } = makeLog()
    const bytes = new TextEncoder().encode('123456789')
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: bytes } }))
    const record = assertAttempt(log.records()[0]!)
    expect(record.result).toEqual({ kind: 'committed', effect: 'update-omitted', reason: 'update-capture-disabled' })
    expect(events.some((e) => e.type === 'vfsl-validation-failed')).toBe(false)
    expectTwin(record, 'update-capture-disabled')
  })

  it('R2/D-c1 empty-update：0 字节 updateBytes → update-omitted/empty-update，且**无** vfsl-validation-failed', () => {
    const { log, events } = makeLog({ updateCapture: true })
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: new Uint8Array(0) } }))
    const record = assertAttempt(log.records()[0]!)
    expect(record.result).toEqual({ kind: 'committed', effect: 'update-omitted', reason: 'empty-update' })
    expect(events.some((e) => e.type === 'vfsl-validation-failed')).toBe(false)
    expect(log.stats().accepted).toBe(1)
    expectTwin(record, 'empty-update')
  })

  it('守卫优先级（§7.4）：0 字节 先于 update-capture-disabled（即使捕获禁用也是 empty-update）', () => {
    const { log } = makeLog({ updateCapture: false })
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: new Uint8Array(0) } }))
    expect(assertAttempt(log.records()[0]!).result).toEqual({ kind: 'committed', effect: 'update-omitted', reason: 'empty-update' })
  })

  it('fatal+committed:true 携带 0 字节同样转 empty-update（语义镜像，非仅 committed 路径）', () => {
    const { log } = makeLog({ updateCapture: true })
    log.emitter.emit(baseEmission({ result: { kind: 'fatal', committed: true, effect: 'update', updateBytes: new Uint8Array(0) } }))
    const record = assertAttempt(log.records()[0]!)
    expect(record.result).toEqual({ kind: 'fatal', committed: true, effect: 'update-omitted', reason: 'empty-update' })
  })
})

describe('§9.9 被省略 update 的元数据完整性（ADR 0012「保 attempt metadata」）', () => {
  it('三 reason 下 attempt 身份/结局事实/observedAt 全部保留', () => {
    const { log } = makeLog({ updateCapture: false, payloadMaxBytes: 4 })
    const cases = [
      { reason: 'payload-too-large', bytes: new Uint8Array(5).fill(3) },
      { reason: 'update-capture-disabled', bytes: new Uint8Array(4).fill(3) },
    ] as const
    for (const c of cases) {
      log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: c.bytes } }))
    }
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: new Uint8Array(0) } }))
    const records = log.records()
    expect(records).toHaveLength(3)
    for (const record of records) {
      const attempt = assertAttempt(record)
      expect(attempt.operation).toBe('root-mutation')
      expect(attempt.observedAt).toBe('2026-08-28T12:00:00.000Z')
      expectTwin(attempt, 'update-omitted metadata')
    }
  })
})

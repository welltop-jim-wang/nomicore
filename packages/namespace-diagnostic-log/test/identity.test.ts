/**
 * 红灯契约 — §9.10 身份与 helper（AC1/AC5）
 * 锚点：设计 §4.3（streamId 构造期 CSPRNG 生成 log-+32hex；attemptId 缺省 att-+32hex 或
 *       透传 producer 受控 ID）+ §4.4（RandomSource 注入接缝仅 streamId/attemptId 两用途；
 *       observedAtFrom 纯 helper；epoch 超 ISO 域 throw——发生在 emit 之前，不违反
 *       emit 不抛错契约）+ §1.2（不依赖 clock，observedAt 由 producer 用注入 Clock 生成）+
 *       R2/A-c1（sequence 十进制字符串进位 nextDecimal 无 number 失真；uint64 全域
 *       18446744073709551615；exhausted 模式：后续丢弃 + stats 计数 + 无逐条事件 + 不 throw；
 *       stats().lastSequenceAssigned 恒为 string|null）+ §7.2 + §8.1/§10-J13（事件抑制备案）。
 */
import { describe, expect, it } from 'vitest'
import { observedAtFrom } from '../src/index.js'
import type { DiagnosticLogHealthEvent } from '../src/index.js'
import {
  createBoundedMemoryDiagnosticLogPresetSequence,
  createDeterministicRandomSource,
  nextDecimal,
} from '../src/testing.js'
import { assertAttempt, baseEmission, eventsOfType, makeLog } from './helpers/base.js'

const PATTERNS = {
  streamId: /^log-[0-9a-f]{32}$/,
  attemptId: /^att-[0-9a-f]{32}$/,
  isoMs: /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$/,
}

describe('§9.10 attemptId：缺省生成 att-+32hex / 透传（§4.3）', () => {
  it('确定性 RandomSource 注入：streamId 与 attemptId 各取 16B', () => {
    const bytes = new Uint8Array(32)
    bytes.fill(0xaa, 0, 16)
    bytes.fill(0xbb, 16, 32)
    const { log } = makeLog({ randomSource: createDeterministicRandomSource(bytes) })
    log.emitter.emit(baseEmission({ attemptId: undefined }))
    const record = assertAttempt(log.records()[0]!)
    expect(log.streamId).toBe('log-' + 'aa'.repeat(16))
    expect(record.streamId).toBe(log.streamId)
    expect(record.attemptId).toBe('att-' + 'bb'.repeat(16))
    expect(record.attemptId).toMatch(PATTERNS.attemptId)
    expect(log.streamId).toMatch(PATTERNS.streamId)
  })

  it('attemptId 透传：producer 受控关联 ID 原样保留', () => {
    const { log } = makeLog()
    log.emitter.emit(baseEmission({ attemptId: 'producer-correlation-1' }))
    expect(assertAttempt(log.records()[0]!).attemptId).toBe('producer-correlation-1')
  })

  it('多 record 共用同一 streamId（单实例单 stream），attemptId 各自独立', () => {
    const { log } = makeLog()
    log.emitter.emit(baseEmission({ operation: 'namespace-create' }))
    log.emitter.emit(baseEmission({ operation: 'schema-replacement' }))
    const [a, b] = log.records()
    const ra = assertAttempt(a!)
    const rb = assertAttempt(b!)
    expect(ra.streamId).toBe(rb.streamId)
    expect(ra.streamId).toMatch(PATTERNS.streamId)
    expect(ra.sequence).toBe('1')
    expect(rb.sequence).toBe('2')
  })
})

describe('§9.10 observedAtFrom（§4.4 纯 helper，无 clock 依赖）', () => {
  it('结构兼容 Clock.now：now() => ms → UTC ISO 8601 毫秒精度 Z 后缀', () => {
    expect(observedAtFrom(() => 1_700_000_000_000)).toBe('2023-11-14T22:13:20.000Z')
    expect(observedAtFrom(() => 0)).toBe('1970-01-01T00:00:00.000Z')
    expect(observedAtFrom(() => 1)).toBe('1970-01-01T00:00:00.001Z')
  })

  it('输出恒匹配 P_ISO_MS（与冻结 schema Pattern 精确一致）', () => {
    for (const ms of [0, 1_700_000_000_000, 8_640_000_000_000 - 1]) {
      const iso = observedAtFrom(() => ms)
      expect(iso).toMatch(PATTERNS.isoMs)
      expect(iso.endsWith('Z')).toBe(true)
    }
  })

  it('epoch 超出 ISO 表示域 → throw（producer 侧 bug，发生在 emit 之前）', () => {
    expect(() => observedAtFrom(() => 9_000_000_000_000_000)).toThrow()
  })
})

describe('§9.10 R2/A-c1 sequence 十进制字符串进位纪律（nextDecimal 直测）', () => {
  it('进位链：9→10、99→100、…51614→…51615（无 number 失真）', () => {
    expect(nextDecimal('9')).toBe('10')
    expect(nextDecimal('99')).toBe('100')
    expect(nextDecimal('18446744073709551614')).toBe('18446744073709551615')
  })

  it('长进位链逐位正确（含跨 0 回归）', () => {
    let s = '1'
    for (let i = 0; i < 10; i++) s = nextDecimal(s)
    expect(s).toBe('11')
    // 999 → 1000
    expect(nextDecimal('999')).toBe('1000')
    // 2^53 边界邻域无跳变（number 已失真、字符串进位不坏）
    expect(nextDecimal('9007199254740993')).toBe('9007199254740994')
    expect(Number(nextDecimal('9007199254740993'))).toBe(9007199254740994)
  })
})

describe('§9.10 exhausted 模式：uint64 max 邻域（R2/A-c1 预置接缝）', () => {
  it('预置 lastSequence=…51614：一次 append 得 …51615（接纳），再 append → exhausted 丢弃', () => {
    const events: DiagnosticLogHealthEvent[] = []
    const log = createBoundedMemoryDiagnosticLogPresetSequence(
      { observer: { onEvent: (e) => { events.push(e) } } },
      '18446744073709551614',
    )
    // 第一次 append：分配到 uint64 max——边界语义：分配到 max 的那条仍接纳（§9.10/R2.2）
    log.emitter.emit(baseEmission())
    expect(log.records()).toHaveLength(1)
    expect(assertAttempt(log.records()[0]!).sequence).toBe('18446744073709551615')
    expect(log.stats().lastSequenceAssigned).toBe('18446744073709551615')
    // 第二次 append：exhausted——丢弃 + stats 计数 + 不 throw + 无逐条事件
    expect(() => log.emitter.emit(baseEmission())).not.toThrow()
    expect(log.records()).toHaveLength(1)
    const stats = log.stats()
    expect(stats.accepted).toBe(1)
    expect(stats.droppedTotal).toBe(1)
    // SA2 R2.3-n3：exhausted 计数落在 droppedByReason['sequence-exhausted']（stats 不属冻结事件词表）
    expect(stats.droppedByReason['sequence-exhausted']).toBe(1)
    expect(stats.lastSequenceAssigned).toBe('18446744073709551615')
    // 事件抑制：无 record-dropped（v1 冻结 reason 词表不含 exhausted 位，§8.1 备案）
    expect(eventsOfType(events, 'record-dropped')).toHaveLength(0)
    expect(events).toHaveLength(0)
  })

  it('lastSequenceAssigned 恒为十进制字符串（无 number 失真；§7.2 类型语义）', () => {
    const log = createBoundedMemoryDiagnosticLogPresetSequence({}, '1')
    log.emitter.emit(baseEmission())
    log.emitter.emit(baseEmission())
    const last = log.stats().lastSequenceAssigned
    expect(typeof last).toBe('string')
    expect(last).toBe('3')
    expect(last).toMatch(/^(0|[1-9][0-9]*)$/)
  })
})

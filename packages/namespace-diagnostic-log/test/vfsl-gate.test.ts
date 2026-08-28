/**
 * 红灯契约 — §9.6 VFSL 校验失败注入（验收标准 4）
 * 锚点：ADR 0012 §VFSL record schema / §Writer（append 前 VFSL validation failure 是日志
 *       writer bug：丢弃 record、增加低基数 metric 并向独立结构化 observer 上报，不改变
 *       业务结果）+ 设计 §4.1 步骤 5（失败 → 丢弃 + vfsl-validation-failed，只带 issuePaths
 *       不带 message）+ §8.1（事件词表与白名单：issuePaths 首 10 条，无值预览；禁 message/
 *       stack/Base64）+ §8.2（低基数字段白名单）+ §3.4（envelopeFingerprint 冻结身份键）+
 *       §7.4/§10-J1（sidecar 形状在 schema 中完整可表达，#152 前置验收）+ §4.1 步骤 0′/
 *       R2/F-c1（failed 模式：构造期一次 schema-compile-failed、后续全丢弃不逐条发事件、
 *       testing 注入坏 envelope）。
 */
import { describe, expect, it } from 'vitest'
import { getRecordSchemaCompilation, RECORD_SCHEMA_ID } from '../src/index.js'
import type { DiagnosticChangeRecord, DiagnosticLogHealthEvent } from '../src/index.js'
import {
  createBoundedMemoryDiagnosticLogWithSchema,
  injectFinalRecord,
} from '../src/testing.js'
import { assertAttempt, baseEmission, eventsOfType, FROZEN_ENVELOPE_FINGERPRINT, makeLog, mustCompile } from './helpers/base.js'
import { expectTwin } from './helpers/twin.js'

const STREAM_ID = 'log-0123456789abcdef0123456789abcdef'
const BASE_RECORD: DiagnosticChangeRecord = {
  recordKind: 'attempt',
  streamId: STREAM_ID,
  sequence: '1',
  attemptId: 'att-0123456789abcdef0123456789abcdef',
  operation: 'root-mutation',
  stage: 'transaction',
  observedAt: '2026-08-28T12:00:00.000Z',
  source: { kind: 'local' },
  input: { capture: 'none' },
  result: { kind: 'committed', effect: 'noop' },
}

describe('§9.6 冻结 schema 自身（编译 ok + 指纹钉死 + 信封恰四键）', () => {
  it('getRecordSchemaCompilation() ok 且 envelopeFingerprint 钉死到编译期常量', () => {
    const compiled = mustCompile()
    expect(compiled.envelopeFingerprint).toBe(FROZEN_ENVELOPE_FINGERPRINT)
    // semanticFingerprint 供工具诊断（§3.4），形状锚定
    expect(compiled.semanticFingerprint).toMatch(/^sha256:v1:[0-9a-f]{64}$/)
    // 模块级单次缓存：同一引用（§3.4 惰性一次编译 + 缓存）
    expect(getRecordSchemaCompilation()).toBe(compiled)
  })

  it('RECORD_SCHEMA_ID 与 RECORD_SCHEMA_ENVELOPE 恰四键（lang/version/id/text）', () => {
    expect(RECORD_SCHEMA_ID).toBe('nomicore.namespace-diagnostic-change-record@1')
    const compiled = mustCompile()
    expect(compiled.envelope.id).toBe(RECORD_SCHEMA_ID)
    const keys = Object.keys(compiled.envelope).sort()
    expect(keys).toEqual(['id', 'lang', 'text', 'version'])
    expect(compiled.envelope.lang).toBe('vfsl')
    expect(compiled.envelope.version).toBe(1)
    expect(typeof compiled.envelope.text).toBe('string')
    expect(Object.isFrozen(compiled.envelope)).toBe(true)
  })
})

describe('§9.6 手工构造违规 record 逐类喂入 VFSL 门（injectFinalRecord 直通接缝）', () => {
  // 违规 record 的类型为 unknown（fault-injection 模拟 JS 侧注入；经 injectFinalRecord 运行时喂入）
  const badRecords: Array<[string, unknown]> = [
    ['坏 streamId', { ...BASE_RECORD, streamId: 'log-zzz' }],
    ['词表外 operation', { ...BASE_RECORD, operation: 'nope' }],
    ['词表外 stage', { ...BASE_RECORD, stage: 'nope' }],
    [
      'rejected 带 update（封闭性）',
      {
        ...BASE_RECORD,
        result: {
          kind: 'rejected',
          update: { storage: 'inline', format: 'yjs-update-v1', payloadLength: 9, crc32c: 'e3069283', base64: 'MTIzNDU2Nzg5' },
        },
      },
    ],
    ['多余顶层键（封闭对象）', { ...BASE_RECORD, extra: 1 } as unknown as DiagnosticChangeRecord],
    ['坏 Base64 形状（5 字符无 padding）', { ...BASE_RECORD, result: { kind: 'committed', effect: 'update', update: { storage: 'inline', format: 'yjs-update-v1', payloadLength: 9, crc32c: 'e3069283', base64: 'MTIzNDU' } } }],
    ['坏 CRC hex', { ...BASE_RECORD, result: { kind: 'committed', effect: 'update', update: { storage: 'inline', format: 'yjs-update-v1', payloadLength: 9, crc32c: 'ZZZZZZZZ', base64: 'MTIzNDU2Nzg5' } } }],
    ['坏 ISO observedAt（无毫秒）', { ...BASE_RECORD, observedAt: '2026-08-28T12:00:00Z' }],
    ['InputCapture 缺 digest', { ...BASE_RECORD, input: { capture: 'digest' } }],
  ]

  it.each(badRecords)('%s → 丢弃：不 throw、不入队、vfsl-validation-failed 事件只含 issuePaths', (_name, record) => {
    const { log, events } = makeLog()
    expect(() => injectFinalRecord(log, record as DiagnosticChangeRecord)).not.toThrow()
    expect(log.records()).toHaveLength(0)
    const failed = eventsOfType(events, 'vfsl-validation-failed')
    expect(failed).toHaveLength(1)
    const event = failed[0]!
    expect(event).toMatchObject({
      type: 'vfsl-validation-failed',
      recordKind: 'attempt',
      schemaId: RECORD_SCHEMA_ID,
      schemaFingerprint: FROZEN_ENVELOPE_FINGERPRINT,
    })
    expect(Array.isArray(event.issuePaths)).toBe(true)
    expect(event.issuePaths.length).toBeGreaterThan(0)
    expect(event.issuePaths.length).toBeLessThanOrEqual(10)
    for (const p of event.issuePaths) {
      expect(typeof p).toBe('string')
      expect(p.startsWith('$.')).toBe(true)
    }
    // 白名单纪律（§8.2）：事件键集 ⊆ 低基数白名单（type/reason/…/issuePaths/数值），
    // 不含 record/input/Base64/message/stack 等
    const allowedKeys = new Set([
      'type', 'reason', 'stage', 'field', 'fromPolicy', 'recordKind', 'operation',
      'schemaId', 'schemaFingerprint', 'issuePaths', 'projectedRecordBytes', 'queueDepth', 'issueCount',
    ])
    for (const k of Object.keys(event)) expect(allowedKeys.has(k), `事件键 ${k} 超出白名单`).toBe(true)
    expect(event.projectedRecordBytes).toBeGreaterThan(0)
  })

  it('schema 校验失败计数进 stats（低基数对账）', () => {
    const { log } = makeLog()
    injectFinalRecord(log, { ...BASE_RECORD, streamId: 'log-bad' })
    const stats = log.stats()
    expect(stats.accepted).toBe(0)
    expect(stats.droppedTotal).toBe(1)
    expect(stats.queueDepth).toBe(0)
  })
})

describe('§9.6 sidecar 形状可表达性（#152 前置验收，§7.4/§10-J1）', () => {
  it('手工 sidecar carrier attempt record 通过冻结 schema 校验并入队', () => {
    const { log, events } = makeLog()
    const sidecarRecord: DiagnosticChangeRecord = {
      ...BASE_RECORD,
      result: {
        kind: 'committed',
        effect: 'update',
        update: {
          storage: 'sidecar',
          format: 'yjs-update-v1',
          segment: '00000001',
          frameOffset: '0',
          payloadLength: 12,
          crc32c: 'e3069283',
        },
      },
    }
    expect(() => injectFinalRecord(log, sidecarRecord)).not.toThrow()
    expect(log.records()).toHaveLength(1)
    expect(assertAttempt(log.records()[0]!).result).toEqual(sidecarRecord.result)
    // 通过门即不产生校验失败事件
    expect(eventsOfType(events, 'vfsl-validation-failed')).toHaveLength(0)
    expectTwin(log.records()[0]!, 'sidecar record')
  })

  it('genesis-baseline 第二族 record 可表达（§2.4/§11-G2）', () => {
    const { log } = makeLog()
    const genesis: DiagnosticChangeRecord = {
      recordKind: 'genesis-baseline',
      streamId: STREAM_ID,
      sequence: '0',
      observedAt: '2026-08-28T12:00:00.000Z',
      source: { kind: 'local' },
      update: { storage: 'inline', format: 'yjs-update-v1', payloadLength: 9, crc32c: 'e3069283', base64: 'MTIzNDU2Nzg5' },
    }
    expect(() => injectFinalRecord(log, genesis)).not.toThrow()
    expect(log.records()).toHaveLength(1)
    expect(log.records()[0]!.recordKind).toBe('genesis-baseline')
    expectTwin(log.records()[0]!, 'genesis baseline')
  })
})

describe('§9.6 R2/F-c1 failed 模式注入（坏 envelope → schema-compile-failed）', () => {
  it('构造期恰一次 schema-compile-failed + 后续 append 全丢弃 + 无逐条 record-dropped + 无串扰', () => {
    const badEnvelope = {
      lang: 'vfsl',
      version: 1,
      id: 'nomicore.namespace-diagnostic-change-record@1',
      text: 'type ROOT = number;', // 非 map 形 ROOT → E311 编译失败
    }
    const events: DiagnosticLogHealthEvent[] = []
    const log = createBoundedMemoryDiagnosticLogWithSchema(
      { observer: { onEvent: (e) => { events.push(e) } } },
      badEnvelope,
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'schema-compile-failed', schemaId: RECORD_SCHEMA_ID })
    expect(eventsOfType(events, 'schema-compile-failed')[0]!.issueCount).toBeGreaterThan(0)

    // 后续 append 全丢弃：不 throw、不入队、不逐条发 record-dropped
    expect(() => log.emitter.emit(baseEmission())).not.toThrow()
    expect(() => log.emitter.emit(baseEmission())).not.toThrow()
    expect(log.records()).toHaveLength(0)
    expect(eventsOfType(events, 'record-dropped')).toHaveLength(0)
    expect(log.stats().accepted).toBe(0)
    expect(log.stats().droppedTotal).toBe(2)
    expect(log.stats().queueDepth).toBe(0)

    // 模块级内建编译缓存不受注入影响（§9.6 备注：无串扰）
    const builtin = getRecordSchemaCompilation()
    expect(builtin.ok).toBe(true)
  })

  it('failed 模式不阻断后续合法日志实例（独立实例互不影响）', () => {
    const badEnvelope = { lang: 'vfsl', version: 1, id: 'x', text: 'type ROOT = number;' }
    const first = createBoundedMemoryDiagnosticLogWithSchema({}, badEnvelope)
    expect(() => first.emitter.emit(baseEmission())).not.toThrow()
    expect(first.records()).toHaveLength(0)
    const { log } = makeLog()
    log.emitter.emit(baseEmission())
    expect(log.records()).toHaveLength(1)
  })
})

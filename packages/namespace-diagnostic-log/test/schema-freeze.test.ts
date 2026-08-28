/**
 * 红灯契约 — §9.8 指纹与冻结纪律
 * 锚点：设计 §3.4（冻结身份键 = envelopeFingerprint `sha256:v1:<hex>`，文本任何改动＝新
 *       schema 版本；契约测试把 envelopeFingerprint 钉成编译期常量断言）+ §12（ALLOW
 *       LIST 内建 schema）+ 设计 §9.8（§9.1 全部 record 复跑 validateLogicalSnapshot 外部
 *       一致性；R2/C-b1 JSON round-trip 孪生不变量通用 helper——本文件钉死 helper 语义，
 *       各 suite 复用）+ §2.4/§2.5（两族 record 形状、inline/sidecar carrier）。
 */
import { describe, expect, it } from 'vitest'
import { validateLogicalSnapshot } from '@nomicore/vfsl'
import { getRecordSchemaCompilation, RECORD_SCHEMA_ENVELOPE, RECORD_SCHEMA_ID } from '../src/index.js'
import type { DiagnosticChangeRecord } from '../src/index.js'
import { assertAttempt, attemptRecords, baseEmission, FROZEN_ENVELOPE_FINGERPRINT, makeLog, mustCompile } from './helpers/base.js'
import { expectRecordTwinValid, expectTwin } from './helpers/twin.js'

const STREAM_ID = 'log-0123456789abcdef0123456789abcdef'
const INLINE = {
  storage: 'inline' as const,
  format: 'yjs-update-v1' as const,
  payloadLength: 9,
  crc32c: 'e3069283',
  base64: 'MTIzNDU2Nzg5',
}

describe('§9.8 fingerprint 钉死（编译期常量·变更纪律）', () => {
  it('envelopeFingerprint === 冻结常量（schema 文本逐字符变更 = 有意识 bump + 本测试同步修改）', () => {
    const compiled = mustCompile()
    expect(compiled.envelopeFingerprint).toBe(FROZEN_ENVELOPE_FINGERPRINT)
  })

  it('RECORD_SCHEMA_ENVELOPE 恰四键且与编译产物 envelope 同源', () => {
    const compiled = getRecordSchemaCompilation()
    expect(compiled.ok).toBe(true)
    if (compiled.ok) {
      expect(Object.keys(RECORD_SCHEMA_ENVELOPE).sort()).toEqual(['id', 'lang', 'text', 'version'])
      expect(RECORD_SCHEMA_ENVELOPE.id).toBe(RECORD_SCHEMA_ID)
      expect(RECORD_SCHEMA_ENVELOPE.lang).toBe('vfsl')
      expect(RECORD_SCHEMA_ENVELOPE.version).toBe(1)
      expect(RECORD_SCHEMA_ENVELOPE.text).toBe(compiled.envelope.text)
      // 深冻结（#152 manifest 内嵌用，§3.1）
      expect(Object.isFrozen(RECORD_SCHEMA_ENVELOPE)).toBe(true)
      expect(compiled.derived).toBeDefined()
    }
  })
})

describe('§9.8 外部一致性：§9.1 全部 record 形状复跑 validateLogicalSnapshot（AC4）', () => {
  const attempts: Array<[string, DiagnosticChangeRecord]> = [
    ['committed+noop', {
      recordKind: 'attempt', streamId: STREAM_ID, sequence: '1',
      attemptId: 'att-0123456789abcdef0123456789abcdef',
      operation: 'root-mutation', stage: 'transaction',
      observedAt: '2026-08-28T12:00:00.000Z', source: { kind: 'local' },
      input: { capture: 'none' }, result: { kind: 'committed', effect: 'noop' },
    }],
    ['committed+update(inline)', {
      recordKind: 'attempt', streamId: STREAM_ID, sequence: '2',
      attemptId: 'att-0123456789abcdef0123456789abcdef',
      operation: 'root-mutation', stage: 'transaction',
      observedAt: '2026-08-28T12:00:00.000Z', source: { kind: 'local' },
      input: { capture: 'none' }, result: { kind: 'committed', effect: 'update', update: INLINE },
    }],
    ['committed+update-omitted', {
      recordKind: 'attempt', streamId: STREAM_ID, sequence: '3',
      attemptId: 'att-0123456789abcdef0123456789abcdef',
      operation: 'root-mutation', stage: 'transaction',
      observedAt: '2026-08-28T12:00:00.000Z', source: { kind: 'local' },
      input: { capture: 'none' }, result: { kind: 'committed', effect: 'update-omitted', reason: 'payload-too-large' },
    }],
    ['rejected', {
      recordKind: 'attempt', streamId: STREAM_ID, sequence: '4',
      attemptId: 'att-0123456789abcdef0123456789abcdef',
      operation: 'root-mutation', stage: 'validation',
      observedAt: '2026-08-28T12:00:00.000Z', source: { kind: 'local' },
      input: { capture: 'none' }, result: { kind: 'rejected' },
    }],
    ['fatal+committed:false', {
      recordKind: 'attempt', streamId: STREAM_ID, sequence: '5',
      attemptId: 'att-0123456789abcdef0123456789abcdef',
      operation: 'root-mutation', stage: 'input-snapshot',
      observedAt: '2026-08-28T12:00:00.000Z', source: { kind: 'local' },
      input: { capture: 'unavailable' }, result: { kind: 'fatal', committed: false },
    }],
    ['fatal+committed:true+unknown', {
      recordKind: 'attempt', streamId: STREAM_ID, sequence: '6',
      attemptId: 'att-0123456789abcdef0123456789abcdef',
      operation: 'root-mutation', stage: 'transaction',
      observedAt: '2026-08-28T12:00:00.000Z', source: { kind: 'local' },
      input: { capture: 'none' }, result: { kind: 'fatal', committed: true, effect: 'unknown' },
    }],
    ['fatal+committed:true+update', {
      recordKind: 'attempt', streamId: STREAM_ID, sequence: '7',
      attemptId: 'att-0123456789abcdef0123456789abcdef',
      operation: 'root-mutation', stage: 'dirty-notification',
      observedAt: '2026-08-28T12:00:00.000Z', source: { kind: 'local' },
      input: { capture: 'none' }, result: { kind: 'fatal', committed: true, effect: 'update', update: INLINE },
    }],
    ['fatal+committed:true+update-omitted', {
      recordKind: 'attempt', streamId: STREAM_ID, sequence: '8',
      attemptId: 'att-0123456789abcdef0123456789abcdef',
      operation: 'root-mutation', stage: 'transaction',
      observedAt: '2026-08-28T12:00:00.000Z', source: { kind: 'local' },
      input: { capture: 'none' }, result: { kind: 'fatal', committed: true, effect: 'update-omitted', reason: 'empty-update' },
    }],
    ['sidecar carrier', {
      recordKind: 'attempt', streamId: STREAM_ID, sequence: '9',
      attemptId: 'att-0123456789abcdef0123456789abcdef',
      operation: 'root-mutation', stage: 'transaction',
      observedAt: '2026-08-28T12:00:00.000Z', source: { kind: 'local' },
      input: { capture: 'none' },
      result: {
        kind: 'committed', effect: 'update',
        update: { storage: 'sidecar', format: 'yjs-update-v1', segment: '00000001', frameOffset: '0', payloadLength: 12, crc32c: 'e3069283' },
      },
    }],
    ['genesis-baseline', {
      recordKind: 'genesis-baseline', streamId: STREAM_ID, sequence: '0',
      observedAt: '2026-08-28T12:00:00.000Z', source: { kind: 'local' },
      update: INLINE,
    }],
  ]

  it.each(attempts)('%s 直接通过 validateLogicalSnapshot（sink 侧手工构造等价物也可读）', (_name, record) => {
    const compiled = mustCompile()
    const result = validateLogicalSnapshot(compiled.derived, record)
    expect(result.ok, JSON.stringify(result.ok ? '' : result.issues)).toBe(true)
    // 孪生不变量：JSON round-trip 后仍 ok（§9.8 通用 helper）
    expectRecordTwinValid(compiled.derived, record, _name)
  })

  it('emitter 产出的孪生 record 同样通过（全变体联动）', () => {
    const { log } = makeLog({ updateCapture: true })
    const bytes = new TextEncoder().encode('123456789')
    const emissions = [
      baseEmission({ result: { kind: 'committed', effect: 'noop' } }),
      baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: bytes } }),
      baseEmission({ result: { kind: 'committed', effect: 'update-omitted', reason: 'update-capture-disabled' } }),
      baseEmission({ result: { kind: 'rejected' } }),
      baseEmission({ result: { kind: 'fatal', committed: false } }),
      baseEmission({ result: { kind: 'fatal', committed: true, effect: 'unknown' } }),
      baseEmission({ result: { kind: 'fatal', committed: true, effect: 'update', updateBytes: bytes } }),
      baseEmission({ result: { kind: 'fatal', committed: true, effect: 'update-omitted', reason: 'empty-update' } }),
    ]
    for (const e of emissions) log.emitter.emit(e)
    expect(log.records()).toHaveLength(8)
    for (const record of attemptRecords(log.records())) expectTwin(record, 'emitter variants')
  })
})

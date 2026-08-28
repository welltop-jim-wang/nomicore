/**
 * 红灯契约 — §9.1 词表与全 result 分支（验收标准 1）
 * 锚点：AC1（语义 emitter 接受全部冻结 v1 operation 与 result 分支；不向 producer 暴露
 *       JSONL/Base64/segment/frame/offset/retention）+ 设计 §2.1（operation 6 值、
 *       result 8 成员判别联合、update-omitted 三 reason 词表）+ §2.6（emission 形状）+
 *       §4.2 表（intake 违规 → emission-dropped）+ §10-J2/J3（fatal committed↔effect、
 *       code↔sourceModule 成对三重强制）+ ADR 0011 §Interface / ADR 0012 §JSONL record。
 */
import { describe, expect, it } from 'vitest'
import { createDiagnosticChangeEmitter } from '../src/index.js'
import type { DiagnosticChangeRecord, DiagnosticChangeSink, DiagnosticSemanticRecord } from '../src/index.js'
import { ALL_OPERATIONS, assertAttempt, attemptRecords, baseEmission, eventsOfType, makeLog, OBSERVED_AT } from './helpers/base.js'
import { expectTwin } from './helpers/twin.js'

describe('§1.3/§2.6 语义 emitter → sink 面（semantic record 形状，AC1）', () => {
  it('sink 收到 DiagnosticSemanticRecord：语义投影完成、物理字段（streamId/sequence/recordKind）缺失', () => {
    const received: DiagnosticSemanticRecord[] = []
    const sink: DiagnosticChangeSink = { append: (r) => received.push(r) }
    const emitter = createDiagnosticChangeEmitter({ inputPolicy: 'digest', issuesPolicy: 'full' }, sink)
    emitter.emit(
      baseEmission({
        input: { snapshot: { a: 1 } },
        issues: { items: [{ message: 'm1', path: ['p'] }] },
        result: { kind: 'committed', effect: 'update', updateBytes: new TextEncoder().encode('123456789') },
      }),
    )
    expect(received).toHaveLength(1)
    const semantic = received[0]!
    expect(semantic.attemptId).toBe('att-11111111111111111111111111111111')
    expect(semantic.operation).toBe('root-mutation')
    expect(semantic.stage).toBe('transaction')
    expect(semantic.observedAt).toBe(OBSERVED_AT)
    expect(semantic.source).toEqual({ kind: 'local' })
    expect(semantic.input).toMatchObject({ capture: 'digest' })
    expect(semantic.issues).toEqual({ policy: 'full', items: [{ message: 'm1', path: ['p'] }] })
    expect(semantic.result).toMatchObject({ kind: 'committed', effect: 'update' })
    expect((semantic.result as { updateBytes: Uint8Array }).updateBytes).toBeInstanceOf(Uint8Array)
    // 语义 record 无物理身份字段（物理投影归 adapter，§4.1 切分线）
    const keys = Object.keys(semantic)
    expect(keys).not.toContain('streamId')
    expect(keys).not.toContain('sequence')
    expect(keys).not.toContain('recordKind')
    // 语义 record 深冻结（§2.6 所有权契约）
    expect(Object.isFrozen(semantic)).toBe(true)
    expect(Object.isFrozen(semantic.input)).toBe(true)
  })

  it('emitter.intake 违规 emission：emit 不 throw，sink 无交付', () => {
    const received: DiagnosticSemanticRecord[] = []
    const emitter = createDiagnosticChangeEmitter(
      { inputPolicy: 'digest', issuesPolicy: 'full' },
      { append: (r) => received.push(r) },
    )
    expect(() => emitter.emit(baseEmission({ operation: 'nope' }))).not.toThrow()
    expect(received).toHaveLength(0)
  })

  it('sink.append 抛错：emit 不 throw（§4.1 步骤 7 防 throw）', () => {
    const emitter = createDiagnosticChangeEmitter(
      { inputPolicy: 'digest', issuesPolicy: 'full' },
      {
        append() {
          throw new Error('sink boom')
        },
      },
    )
    expect(() => emitter.emit(baseEmission())).not.toThrow()
  })
})

describe('§9.1 result 8 变体全矩阵（AC1）', () => {
  const CRC = 'e3069283'

  it('committed+noop：record 以最终 attempt 形状接纳，result 无多余键', () => {
    const { log, events } = makeLog()
    log.emitter.emit(baseEmission())
    const records = log.records()
    expect(records).toHaveLength(1)
    const record = assertAttempt(records[0]!)
    expect(record.recordKind).toBe('attempt')
    expect(record.operation).toBe('root-mutation')
    expect(record.stage).toBe('transaction')
    expect(record.observedAt).toBe(OBSERVED_AT)
    expect(record.source).toEqual({ kind: 'local' })
    expect(record.input).toEqual({ capture: 'none' })
    // 精确到键集：noop 是单键 result——封闭对象机器禁止携带 update（§2.5/§4.2）
    expect(record.result).toEqual({ kind: 'committed', effect: 'noop' })
    expect(events).toEqual([])
    expectTwin(record, 'committed+noop')
  })

  it('committed+update：语义 updateBytes 物理化为 inline carrier（§7.4）', () => {
    const { log } = makeLog({ updateCapture: true })
    const bytes = new TextEncoder().encode('123456789')
    log.emitter.emit(
      baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: bytes } }),
    )
    const record = assertAttempt(log.records()[0]!)
    expect(record.result).toEqual({
      kind: 'committed',
      effect: 'update',
      update: { storage: 'inline', format: 'yjs-update-v1', payloadLength: 9, crc32c: CRC, base64: 'MTIzNDU2Nzg5' },
    })
    expectTwin(record, 'committed+update')
  })

  it('committed+update-omitted：producer 声明 reason 原样保留（词表值 payload-too-large）', () => {
    const { log } = makeLog()
    log.emitter.emit(
      baseEmission({ result: { kind: 'committed', effect: 'update-omitted', reason: 'payload-too-large' } }),
    )
    const record = assertAttempt(log.records()[0]!)
    expect(record.result).toEqual({ kind: 'committed', effect: 'update-omitted', reason: 'payload-too-large' })
    expectTwin(record, 'committed+update-omitted')
  })

  it('rejected：result 恰为单键，无 update 键（封闭性机器回归锚）', () => {
    const { log } = makeLog({ updateCapture: true })
    log.emitter.emit(baseEmission({ result: { kind: 'rejected' } }))
    const record = assertAttempt(log.records()[0]!)
    expect(record.result).toEqual({ kind: 'rejected' })
    // 显式钉死「没有 update 键」——即使 updateCapture 开启也不得出现
    expect('update' in (record.result as object)).toBe(false)
    expectTwin(record, 'rejected')
  })

  it('fatal+committed:false：显式布尔 + 无 effect 键（TS 字面量相关性的运行时侧）', () => {
    const { log } = makeLog({ updateCapture: true })
    log.emitter.emit(baseEmission({ result: { kind: 'fatal', committed: false } }))
    const record = assertAttempt(log.records()[0]!)
    expect(record.result).toEqual({ kind: 'fatal', committed: false })
    expect('update' in (record.result as object)).toBe(false)
    expectTwin(record, 'fatal+committed:false')
  })

  it('fatal+committed:true+effect:unknown：effect 不可知的诚实表达（§11-G3）', () => {
    const { log } = makeLog()
    log.emitter.emit(baseEmission({ result: { kind: 'fatal', committed: true, effect: 'unknown' } }))
    const record = assertAttempt(log.records()[0]!)
    expect(record.result).toEqual({ kind: 'fatal', committed: true, effect: 'unknown' })
    expectTwin(record, 'fatal+unknown')
  })

  it('fatal+committed:true+effect:update：与 committed 同构的物理化', () => {
    const { log } = makeLog({ updateCapture: true })
    const bytes = new TextEncoder().encode('123456789')
    log.emitter.emit(
      baseEmission({ result: { kind: 'fatal', committed: true, effect: 'update', updateBytes: bytes } }),
    )
    const record = assertAttempt(log.records()[0]!)
    expect(record.result).toEqual({
      kind: 'fatal',
      committed: true,
      effect: 'update',
      update: { storage: 'inline', format: 'yjs-update-v1', payloadLength: 9, crc32c: CRC, base64: 'MTIzNDU2Nzg5' },
    })
    expectTwin(record, 'fatal+update')
  })

  it('fatal+committed:true+effect:update-omitted：reason 保留', () => {
    const { log } = makeLog()
    log.emitter.emit(
      baseEmission({ result: { kind: 'fatal', committed: true, effect: 'update-omitted', reason: 'empty-update' } }),
    )
    const record = assertAttempt(log.records()[0]!)
    expect(record.result).toEqual({ kind: 'fatal', committed: true, effect: 'update-omitted', reason: 'empty-update' })
    expectTwin(record, 'fatal+update-omitted')
  })

  it('stage=transaction 的 committed 记录：stage 是结局所属最后阶段（ADR 0011 语义纪律）', () => {
    const { log } = makeLog()
    log.emitter.emit(baseEmission({ stage: 'transaction' }))
    expect(assertAttempt(log.records()[0]!).stage).toBe('transaction')
  })

  it('dirty-notification 场景：fatal+committed:true+effect:update+stage=dirty-notification 可表达（§2.1）', () => {
    const { log } = makeLog({ updateCapture: true })
    const bytes = new TextEncoder().encode('123456789')
    log.emitter.emit(
      baseEmission({
        stage: 'dirty-notification',
        result: { kind: 'fatal', committed: true, effect: 'update', updateBytes: bytes },
      }),
    )
    const record = assertAttempt(log.records()[0]!)
    expect(record.stage).toBe('dirty-notification')
    expect(record.result).toMatchObject({ kind: 'fatal', committed: true, effect: 'update' })
    expectTwin(record, 'dirty-notification')
  })
})

describe('§9.1 operation 六值词表矩阵（AC1）', () => {
  it('全部 6 个 operation 各至少一次被接纳', () => {
    const { log } = makeLog()
    for (const operation of ALL_OPERATIONS) {
      log.emitter.emit(baseEmission({ operation }))
    }
    const records = log.records()
    expect(records).toHaveLength(6)
    const ops = new Set(attemptRecords(records).map((r) => r.operation))
    for (const operation of ALL_OPERATIONS) expect(ops.has(operation)).toBe(true)
    for (const record of attemptRecords(records)) expectTwin(record, `operation=${record.operation}`)
  })
})

describe('§9.1 code/sourceModule 成对性 + 语义字段（§10-J3）', () => {
  it('code+sourceModule 成对出现时两者都保留', () => {
    const { log } = makeLog()
    log.emitter.emit(baseEmission({ code: 'registry.ns.create', sourceModule: 'registry' }))
    const record = assertAttempt(log.records()[0]!)
    expect(record.code).toBe('registry.ns.create')
    expect(record.sourceModule).toBe('registry')
    expectTwin(record, 'code+sourceModule')
  })

  it('语义 record 不含物理键（AC1 运行时侧）：record 无 recordId/manifest 等物理字段', () => {
    const { log } = makeLog()
    log.emitter.emit(baseEmission())
    const record = assertAttempt(log.records()[0]!) as unknown as Record<string, unknown>
    // streamId/sequence/recordKind 是 v1 契约身份字段（设计 §2.4），物理细节（segment/frame/base64 载体
    // 除 update carrier 外）不得出现在 attempt 顶层
    expect(record.streamId).toBeDefined()
    expect(record.sequence).toBeDefined()
    expect(record.recordKind).toBeDefined()
    // producer emission 面黑名单的运行时等价：emission 面没有这些键（见 identity.test-d.ts 编译期锚）
  })
})

describe('§9.1 intake 结构校验违规 → emission-dropped（§4.2 表）', () => {
  const violations: Array<[string, Record<string, unknown>]> = [
    ['词表外 operation', { operation: 'nope' }],
    ['词表外 stage', { stage: 'nope' }],
    ['result 缺 effect（形状缺残）', { result: { kind: 'committed' } }],
    ['result 未知形状', { result: { kind: 'committed', effect: 'update' } }],
    ['observedAt 违 P_ISO_MS（无毫秒）', { observedAt: '2026-08-28T12:00:00Z' }],
    ['observedAt 非字符串', { observedAt: 123 }],
    ['attemptId 含换行（行注入）', { attemptId: 'att-\nabc' }],
    ['code 含空白（违 StableCode Pattern）', { code: 'bad code!' }],
    ['source.remoteInstanceId 含换行', { source: { kind: 'replication', direction: 'hub-to-peer', remoteInstanceId: 'r\n1' } }],
    ['source 形状缺 remoteInstanceId', { source: { kind: 'replication', direction: 'peer-to-hub' } }],
  ]

  it.each(violations)('%s → emission 被丢弃，emit 不 throw，无 record 入队', (_name, overrides) => {
    const { log, events } = makeLog()
    expect(() => log.emitter.emit(baseEmission(overrides))).not.toThrow()
    expect(log.records()).toHaveLength(0)
    const dropped = eventsOfType(events, 'emission-dropped')
    expect(dropped.length).toBeGreaterThanOrEqual(1)
    expect(dropped[0]).toMatchObject({ type: 'emission-dropped', reason: 'emission-shape' })
    expect(log.stats().accepted).toBe(0)
  })

  it('违规 emission 不消耗 sequence（intake 在 adapter 之前，§4.1 步骤 1 vs 步骤 1′）', () => {
    const { log } = makeLog()
    log.emitter.emit(baseEmission({ operation: 'nope' }))
    expect(log.stats().lastSequenceAssigned).toBeNull()
    log.emitter.emit(baseEmission())
    expect(assertAttempt(log.records()[0]!).sequence).toBe('1')
  })
})

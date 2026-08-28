/**
 * 红灯契约 — §9.7 有界内存 adapter 语义（验收标准 5）
 * 锚点：ADR 0012 §Writer（「writer queue 满时 drop newest，保留已排队顺序；不得为了记录
 *       drop 再挤占同一队列」）+ 设计 §7.1（容量、drop newest、保序、永不 throw/阻塞、
 *       records() 冻结引用数组、接纳序 = sequence 升序）+ §7.2（DiagnosticMemoryStats：
 *       accepted/droppedTotal/droppedByReason/droppedByOperationReason/lastSequenceAssigned
 *       为 string|null）+ §4.3（sequence 从 1 起单调、丢弃也消耗）。
 */
import { describe, expect, it } from 'vitest'
import { assertAttempt, attemptRecords, baseEmission, eventsOfType, makeLog } from './helpers/base.js'
import { expectTwin } from './helpers/twin.js'

describe('§9.7 容量饱和：drop newest（AC5）', () => {
  it('capacity=3 + 6 条 emission：前 3 条按序保留，后 3 条 drop newest，事件与 stats 对账', () => {
    const { log, events } = makeLog({ capacity: 3 })
    for (let i = 0; i < 6; i++) {
      log.emitter.emit(baseEmission({ operation: 'root-mutation' }))
    }
    const records = log.records()
    expect(records).toHaveLength(3)
    // 保留的是前 3 条（已接纳顺序不变——drop 的是新到者）
    expect(attemptRecords(records).map((r) => r.sequence)).toEqual(['1', '2', '3'])

    const drops = eventsOfType(events, 'record-dropped').filter((e) => e.reason === 'queue-full')
    expect(drops).toHaveLength(3)
    for (const d of drops) {
      expect(d).toMatchObject({ type: 'record-dropped', reason: 'queue-full', operation: 'root-mutation' })
      expect(d.queueDepth).toBe(3)
      expect(d.projectedRecordBytes).toBeGreaterThan(0)
    }

    const stats = log.stats()
    expect(stats.accepted).toBe(3)
    expect(stats.queueDepth).toBe(3)
    expect(stats.droppedTotal).toBe(3)
    expect(stats.droppedByReason['queue-full']).toBe(3)
    expect(stats.droppedByOperationReason['root-mutation:queue-full']).toBe(3)
    // 丢弃也消耗 sequence（§4.3）：最后一次分配 = 第 6 次 append
    expect(stats.lastSequenceAssigned).toBe('6')
  })

  it('drop 事件绝不作为 record 入队（ADR 0012 §Writer）', () => {
    const { log } = makeLog({ capacity: 1 })
    log.emitter.emit(baseEmission())
    log.emitter.emit(baseEmission())
    const records = log.records()
    expect(records).toHaveLength(1)
    // 队列里只有真实 record，没有 health/status/drop 伪 record
    for (const r of records) {
      const attempt = assertAttempt(r)
      expect(attempt.result).toBeDefined()
    }
  })

  it('capacity=1：满后新到者被丢，已接纳 record 不变', () => {
    const { log } = makeLog({ capacity: 1 })
    log.emitter.emit(baseEmission({ attemptId: 'att-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }))
    log.emitter.emit(baseEmission({ attemptId: 'att-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }))
    expect(log.records()).toHaveLength(1)
    expect(assertAttempt(log.records()[0]!).attemptId).toBe('att-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(log.stats().droppedTotal).toBe(1)
  })
})

describe('§9.7 保序：接纳序 == sequence 升序（AC5）', () => {
  it('交错 operation 的 emission 仍按 sequence 升序可读', () => {
    const { log } = makeLog({ capacity: 10 })
    const ops = ['root-mutation', 'namespace-create', 'replication-apply', 'schema-replacement', 'replication-enable'] as const
    for (let i = 0; i < 9; i++) {
      log.emitter.emit(baseEmission({ operation: ops[i % ops.length]! }))
    }
    const seqs = attemptRecords(log.records()).map((r) => Number(r.sequence))
    expect(seqs).toEqual(Array.from({ length: 9 }, (_, i) => i + 1))
    const sorted = [...seqs].sort((a, b) => a - b)
    expect(seqs).toEqual(sorted)
  })
})

describe('§9.7 records() 冻结引用数组（ADR 0011 只读快照语义）', () => {
  it('数组与 record 均冻结：变异抛 TypeError', () => {
    const { log } = makeLog()
    log.emitter.emit(baseEmission())
    const records = log.records()
    expect(Object.isFrozen(records)).toBe(true)
    expect(Object.isFrozen(records[0])).toBe(true)
    expect(() => {
      ;(records as unknown[]).push(1)
    }).toThrow(TypeError)
    expect(() => {
      ;(records[0] as { sequence: string }).sequence = '99'
    }).toThrow(TypeError)
  })
})

describe('§9.7 stats 对账（§7.2）', () => {
  it('lastSequenceAssigned 为 string|null：初始 null，首次 append 后为十进制字符串', () => {
    const { log } = makeLog()
    expect(log.stats().lastSequenceAssigned).toBeNull()
    log.emitter.emit(baseEmission())
    log.emitter.emit(baseEmission())
    const last = log.stats().lastSequenceAssigned
    expect(typeof last).toBe('string')
    expect(last).toMatch(/^(0|[1-9][0-9]*)$/)
    expect(last).toBe('2')
  })

  it('stats 与 records() 一致：accepted = queueDepth，lastSequenceAssigned - queueDepth = 丢弃数', () => {
    const { log } = makeLog({ capacity: 2 })
    for (let i = 0; i < 5; i++) log.emitter.emit(baseEmission())
    const stats = log.stats()
    expect(stats.accepted).toBe(2)
    expect(stats.queueDepth).toBe(2)
    const gap = Number(stats.lastSequenceAssigned) - stats.queueDepth
    expect(gap).toBe(3)
    expect(stats.droppedTotal).toBe(3)
  })

  it('每实例独立 stats（单实例单 stream 语义，§4.3）', () => {
    const a = makeLog()
    const b = makeLog()
    a.log.emitter.emit(baseEmission())
    expect(a.log.stats().accepted).toBe(1)
    expect(b.log.stats().accepted).toBe(0)
  })
})

describe('§9.7 原子性：全路径同步、纯内存、无 IO（AC5 永不阻塞）', () => {
  it('批量 emission 同步完成且全部孪生合法', () => {
    const { log } = makeLog({ updateCapture: true })
    const bytes = new TextEncoder().encode('123456789')
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: bytes } }))
    log.emitter.emit(baseEmission({ result: { kind: 'rejected' } }))
    log.emitter.emit(baseEmission({ result: { kind: 'fatal', committed: false } }))
    for (const record of log.records()) expectTwin(record, 'memory adapter variants')
  })
})

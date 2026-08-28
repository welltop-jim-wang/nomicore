/**
 * 红灯契约 — §9.5 line 预算与降级（验收标准 3）
 * 锚点：ADR 0012 §投影（「输入导致超限时先降级为 digest；去掉输入后 record 仍超限则丢弃
 *       整条 record 并通过健康面上报，不影响业务」）+ 设计 §5.5（降级顺序：full/redacted →
 *       digest+degraded+health input-degraded；仍超限 → 丢弃 + record-dropped/
 *       line-budget-exceeded + projectedRecordBytes）+ §4.3（被丢弃 record 同样消耗 sequence
 *       → 队列内 gap 是诚实信号）+ §10-J9（无 sidecar 环境大 update 必走丢弃分支的诚实锚）。
 */
import { describe, expect, it } from 'vitest'
import { jcs, sha256Hex } from '../src/testing.js'
import { assertAttempt, baseEmission, eventsOfType, makeLog } from './helpers/base.js'

describe('§9.5 降级路径：full 超预算 → digest + degraded（§4.1 步骤 4a）', () => {
  it('full 输入超预算：record 仍被接纳、input 变 digest+degraded、健康事件落桶、value 不在 record', () => {
    const snapshot = { data: 'x'.repeat(2000) }
    const { log, events } = makeLog({ inputPolicy: 'full', lineBudgetBytes: 1000 })
    log.emitter.emit(baseEmission({ input: { snapshot } }))
    const records = log.records()
    expect(records).toHaveLength(1)
    const input = assertAttempt(records[0]!).input
    expect(input).toMatchObject({
      capture: 'digest',
      degraded: 'projected-input-too-large',
    })
    // 降级后不再嵌入 value
    expect('value' in (input as object)).toBe(false)
    // digest 恒为全量快照 JCS bytes 的 SHA-256（§5.2），降级不改 digest
    const expected = sha256Hex(jcs(snapshot))
    expect(input).toMatchObject({ digest: expected })
    const degraded = eventsOfType(events, 'input-degraded')
    expect(degraded).toHaveLength(1)
    expect(degraded[0]).toMatchObject({ type: 'input-degraded', fromPolicy: 'full' })
    // degraded 记录仍是合法 record（无 value 后必然更小）
    expect(assertAttempt(records[0]!).sequence).toBe('1')
  })

  it('redacted 超预算同降级（fromPolicy=redacted）——键重型输入：键在 redacted 下保留（R3 修订断言修正）', () => {
    // redacted 收缩叶值（→«redacted»，12B/叶）但**键名保留**：数千键对象 redacted 投影后
    // 仍远超 lineBudgetBytes（红action 收缩会让 {data:'x'×2000} 只余 ~441B、永不超预算）
    const snapshot: Record<string, number> = Object.fromEntries(
      Array.from({ length: 2000 }, (_, i) => [`key${i}`, i]),
    )
    const { log, events } = makeLog({ inputPolicy: 'redacted', lineBudgetBytes: 1000 })
    log.emitter.emit(baseEmission({ input: { snapshot } }))
    const input = assertAttempt(log.records()[0]!).input
    expect(input).toMatchObject({ capture: 'digest', degraded: 'projected-input-too-large' })
    // 降级后 record 必然 < 1000B（digest 无 value）——被接纳而非丢弃
    expect(log.records()).toHaveLength(1)
    const degraded = eventsOfType(events, 'input-degraded')
    expect(degraded).toHaveLength(1)
    expect(degraded[0]).toMatchObject({ type: 'input-degraded', fromPolicy: 'redacted' })
    expect(events.some((e) => e.type === 'record-dropped')).toBe(false)
  })
})

describe('§9.5 丢弃路径：digest-only 仍超限（§4.1 步骤 4b）', () => {
  it('小预算下 digest-only record 超限 → 丢弃 + record-dropped/line-budget-exceeded + 队列无此 record', () => {
    const { log, events } = makeLog({ lineBudgetBytes: 350 })
    // issues message 300B + 基础字段 → record 必超 350B
    log.emitter.emit(baseEmission({ issues: { items: [{ message: 'm'.repeat(300), path: [] }] } }))
    expect(log.records()).toHaveLength(0)
    const dropped = eventsOfType(events, 'record-dropped').filter((e) => e.reason === 'line-budget-exceeded')
    expect(dropped).toHaveLength(1)
    const event = dropped[0]!
    expect(event.operation).toBe('root-mutation')
    expect(event.reason).toBe('line-budget-exceeded')
    expect(event.queueDepth).toBe(0)
    expect(event.projectedRecordBytes).toBeGreaterThan(350)
    expect(event.projectedRecordBytes).toBeGreaterThanOrEqual(event.queueDepth)
  })

  it('被丢弃 record 消耗 sequence：下一接纳 record 出现诚实的 gap（§4.3）', () => {
    const { log } = makeLog({ lineBudgetBytes: 350 })
    log.emitter.emit(baseEmission({ issues: { items: [{ message: 'm'.repeat(300), path: [] }] } }))
    log.emitter.emit(baseEmission())
    const records = log.records()
    expect(records).toHaveLength(1)
    expect(assertAttempt(records[0]!).sequence).toBe('2')
    expect(log.stats().lastSequenceAssigned).toBe('2')
    expect(log.stats().accepted).toBe(1)
  })
})

describe('§9.5 update Base64 单独超预算 → 丢弃（§10-J9 锚，内存无 sidecar 后果）', () => {
  it('中等预算 + 较大 update：Base64 后超限 → 丢弃（record-dropped/line-budget-exceeded）', () => {
    const bytes = new Uint8Array(320).fill(7)
    const { log, events } = makeLog({ updateCapture: true, lineBudgetBytes: 700 })
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: bytes } }))
    expect(log.records()).toHaveLength(0)
    const dropped = eventsOfType(events, 'record-dropped').filter((e) => e.reason === 'line-budget-exceeded')
    expect(dropped).toHaveLength(1)
    expect(dropped[0]!.projectedRecordBytes).toBeGreaterThan(700)
    // 无 input 时降级不参与（capture none 无 value 可降），直接丢弃——ADR 字面顺序
    expect(eventsOfType(events, 'input-degraded')).toHaveLength(0)
  })

  it('不大于 payloadMaxBytes 的 update 先于 line 预算被 physicalize（§7.4）→ 丢弃非 update-omitted', () => {
    const bytes = new Uint8Array(320).fill(7)
    const { log } = makeLog({ updateCapture: true, payloadMaxBytes: 1024 * 1024, lineBudgetBytes: 700 })
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: bytes } }))
    expect(log.records()).toHaveLength(0)
    // 没有 update-omitted 伪装：320B < payloadMaxBytes → 走 inline → 由 line 预算丢弃
    expect(log.stats().droppedByReason['line-budget-exceeded']).toBe(1)
  })
})

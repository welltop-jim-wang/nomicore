/**
 * 红灯契约 — §9.11 observer 故障隔离（验收标准 4/5）
 * 锚点：设计 §8.3（safeNotify：observer.onEvent throw → 单行稳定码 fallback 日志
 *       DIAGNOSTIC_LOG_OBSERVER_FAILED observer_threw=<typeof err>；事件不重放、不排队、
 *       不重入；fallback logger 可注入，自身 throw 再包一层空 catch——最后防线）+ §8.1
 *       （observer 事件词表与低基数白名单）+ 验收标准 4（「校验或 observer 故障只经低基数
 *       logger 健康 observability 上报」）+ ADR 0011（emit 不抛错；日志故障不改业务结果）。
 */
import { describe, expect, it } from 'vitest'
import { createBoundedMemoryDiagnosticLog } from '../src/index.js'
import type { DiagnosticLogHealthEvent } from '../src/index.js'
import { assertAttempt, baseEmission, eventsOfType, makeLog } from './helpers/base.js'

describe('§9.11 observer 每事件必 throw → emit 不 throw、record 照常入队、fallbackLog 收到稳定码行', () => {
  it('健康事件触发时 observer 抛错：单行稳定码 fallback + 业务管道不受影响', () => {
    const fallbackLines: string[] = []
    const log = createBoundedMemoryDiagnosticLog({
      observer: {
        onEvent() {
          throw new Error('observer boom')
        },
      },
      fallbackLog: (line) => fallbackLines.push(line),
    })
    // 违规 emission 触发 emission-dropped → observer 抛错 → fallback 稳定码
    expect(() => log.emitter.emit(baseEmission({ operation: 'nope' }))).not.toThrow()
    expect(log.records()).toHaveLength(0)
    expect(fallbackLines).toHaveLength(1)
    expect(fallbackLines[0]).toMatch(/^DIAGNOSTIC_LOG_OBSERVER_FAILED /)
    expect(fallbackLines[0]).toContain('observer_threw=')

    // 合法 emission 继续被接纳：observer 故障不影响业务结果与后续管道
    expect(() => log.emitter.emit(baseEmission())).not.toThrow()
    expect(log.records()).toHaveLength(1)
    expect(assertAttempt(log.records()[0]!).result).toEqual({ kind: 'committed', effect: 'noop' })
  })

  it('多个健康事件 → 每个都走 fallback（事件不重放、不排队、不重入 observer）', () => {
    const fallbackLines: string[] = []
    const log = createBoundedMemoryDiagnosticLog({
      observer: {
        onEvent() {
          throw new Error('always')
        },
      },
      fallbackLog: (line) => fallbackLines.push(line),
    })
    log.emitter.emit(baseEmission({ operation: 'nope' }))
    log.emitter.emit(baseEmission({ operation: 'still-nope' }))
    log.emitter.emit(baseEmission({ observedAt: 'bad' }))
    expect(fallbackLines).toHaveLength(3)
    for (const line of fallbackLines) expect(line).toMatch(/^DIAGNOSTIC_LOG_OBSERVER_FAILED /)
  })

  it('observer throw 不改变健康事件语义：被丢弃的 emission 仍是 emission-dropped（不会变成功）', () => {
    const events: DiagnosticLogHealthEvent[] = []
    const log = createBoundedMemoryDiagnosticLog({
      observer: { onEvent: (e) => { events.push(e) } },
      fallbackLog: () => {},
    })
    log.emitter.emit(baseEmission({ operation: 'nope' }))
    expect(events).toHaveLength(1)
    expect(eventsOfType(events, 'emission-dropped')[0]).toMatchObject({ type: 'emission-dropped', reason: 'emission-shape' })
  })
})

describe('§9.11 fallbackLog 自身 throw → 仍不外抛（最后防线，§8.3）', () => {
  it('observer 与 fallbackLog 都抛：emit 仍不 throw，健康事件被静默收编', () => {
    let fallbackCalls = 0
    const log = createBoundedMemoryDiagnosticLog({
      observer: {
        onEvent() {
          throw new Error('observer')
        },
      },
      fallbackLog: () => {
        fallbackCalls++
        throw new Error('fallback lost')
      },
    })
    expect(() => log.emitter.emit(baseEmission({ operation: 'nope' }))).not.toThrow()
    expect(fallbackCalls).toBe(1)
    // 后续合法 emission 不受影响
    expect(() => log.emitter.emit(baseEmission())).not.toThrow()
    expect(log.records()).toHaveLength(1)
  })
})

describe('§9.11 健康事件不入日志队列（ADR「同一 JSONL 不写递归 health record」的同构纪律）', () => {
  it('即使健康事件密集发生，队列中只有真实 attempt record', () => {
    const { log } = makeLog({ capacity: 5 })
    log.emitter.emit(baseEmission({ operation: 'nope' }))
    log.emitter.emit(baseEmission({ operation: 'nope' }))
    log.emitter.emit(baseEmission())
    expect(log.records()).toHaveLength(1)
    expect(log.stats().accepted).toBe(1)
    expect(log.stats().droppedTotal).toBe(0)
  })
})

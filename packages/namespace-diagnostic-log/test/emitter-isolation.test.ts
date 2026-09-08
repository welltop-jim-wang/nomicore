/**
 * 红灯契约 — §9.2 emission 不变量（AC2/AC4）
 * 锚点：ADR 0011 §Interface（emit 立即接收 detached record；不得阻塞、throw、返回
 *       durability promise，不得保留调用方可变引用；所有权「已转移或已复制」）+ 设计 §2.6
 *       （所有权契约（R3 修订）：snapshot 为 plain-data 深冻结、**updateBytes 为 intake
 *       复制隔离**——typed array 无法冻结，Object.freeze(Uint8Array) 必抛 TypeError；
 *       producer 事后变异原数组不影响已接纳 record）+ §4.1 步骤 0（顶层 try/catch →
 *       pipeline-crashed）+ §4.2 表（敌意 getter/非 JSON 值/超深嵌套 →
 *       capture:unavailable + input-projection-failed，不重读不重试）+ 设计
 *       §5.2/§5.4（jcs 逐槽检查、零额外读取纪律）。
 */
import { describe, expect, it } from 'vitest'
import { assertAttempt, baseEmission, eventsOfType, makeLog } from './helpers/base.js'
import { expectTwin } from './helpers/twin.js'

describe('§9.2 敌意输入：快照契约违反 → 降级 unavailable，不 throw（§4.2/§5.4）', () => {
  it('getter 抛出的 snapshot：emit 不 throw，capture=unavailable，事件落桶，getter 只触达一次', () => {
    let touches = 0
    // 敌意读取：secret 的 get 抛错——快照本不该有敌意 getter（producer 违约）
    const hostile = new Proxy(
      { secret: 'x' },
      {
        get(target, key, receiver) {
          if (key === 'secret') {
            touches++
            throw new Error('hostile getter')
          }
          return Reflect.get(target, key, receiver)
        },
      },
    )
    const { log, events } = makeLog({ inputPolicy: 'digest' })
    expect(() => log.emitter.emit(baseEmission({ input: { snapshot: hostile } }))).not.toThrow()
    const records = log.records()
    expect(records).toHaveLength(1)
    expect(assertAttempt(records[0]!).input).toEqual({ capture: 'unavailable' })
    const failed = eventsOfType(events, 'input-projection-failed')
    expect(failed.length).toBe(1)
    expect(failed[0]!.type).toBe('input-projection-failed')
    // 不重读不重试：同一 getter 只触达一次（§5.4/§9.3 探针）
    expect(touches).toBe(1)
    expectTwin(records[0]!, 'hostile getter')
  })

  it('非 JSON 值：bigint / symbol / function / undefined / NaN / Infinity → unavailable + 事件', () => {
    const cases: unknown[] = [
      { a: 1n },
      { a: Symbol('s') },
      { a: () => 1 },
      { a: undefined },
      { a: Number.NaN },
      { a: Number.POSITIVE_INFINITY },
      { a: Number.NEGATIVE_INFINITY },
    ]
    for (const snapshot of cases) {
      const { log, events } = makeLog({ inputPolicy: 'digest' })
      expect(() => log.emitter.emit(baseEmission({ input: { snapshot } }))).not.toThrow()
      const records = log.records()
      expect(records).toHaveLength(1)
      expect(assertAttempt(records[0]!).input).toEqual({ capture: 'unavailable' })
      expect(events.some((e) => e.type === 'input-projection-failed')).toBe(true)
    }
  })

  it('稀疏数组 hole（R2/C-b1 序列化分叉纪律）：jcs 逐槽检查 → unavailable，不得产出 [null,…] 假象', () => {
    const holey: unknown[] = []
    holey.length = 2
    holey[0] = 'x'
    const { log, events } = makeLog({ inputPolicy: 'digest' })
    expect(() => log.emitter.emit(baseEmission({ input: { snapshot: { a: holey } } }))).not.toThrow()
    expect(assertAttempt(log.records()[0]!).input).toEqual({ capture: 'unavailable' })
    expect(events.some((e) => e.type === 'input-projection-failed')).toBe(true)
    expectTwin(log.records()[0]!, 'sparse array')
  })

  it('超深嵌套 snapshot：遍历抛出 → unavailable（不阻塞、不 throw）', () => {
    let root: Record<string, unknown> = {}
    let cur = root
    for (let i = 0; i < 100_000; i++) {
      const next: Record<string, unknown> = {}
      cur.next = next
      cur = next
    }
    const { log, events } = makeLog({ inputPolicy: 'digest' })
    expect(() => log.emitter.emit(baseEmission({ input: { snapshot: root } }))).not.toThrow()
    expect(assertAttempt(log.records()[0]!).input).toEqual({ capture: 'unavailable' })
    expect(events.some((e) => e.type === 'input-projection-failed')).toBe(true)
  })

  it('root snapshot 非对象（数字/字符串根值）：仍按快照契约处理并可用', () => {
    // 快照是 plain-data——数字根值合法（jcs 可规范化）
    const { log } = makeLog({ inputPolicy: 'digest' })
    expect(() => log.emitter.emit(baseEmission({ input: { snapshot: 42 } }))).not.toThrow()
    expect(assertAttempt(log.records()[0]!).input).toMatchObject({ capture: 'digest' })
  })
})

describe('§9.2 所有权契约：plain-data snapshot 冻结 + updateBytes 复制隔离（ADR 0011 §Interface / R3 修订 §2.6）', () => {
  it('full 策略下变异已移交 snapshot：抛 TypeError，记录不被改写', () => {
    const snapshot = { k: 'original' }
    const { log } = makeLog({ inputPolicy: 'full' })
    log.emitter.emit(baseEmission({ input: { snapshot } }))
    expect(assertAttempt(log.records()[0]!).input).toMatchObject({ capture: 'full' })
    expect(() => {
      ;(snapshot as { k: string }).k = 'mutated'
    }).toThrow(TypeError)
    expect(assertAttempt(log.records()[0]!).input).toMatchObject({ capture: 'full', value: { k: 'original' } })
    expectTwin(log.records()[0]!, 'full ownership')
  })

  it('变异已移交 updateBytes：复制隔离——已接纳 record 的 inline base64 解码仍等于原始字节（typed array 无法冻结，ADR 允许「已转移或已复制」）', () => {
    const bytes = new TextEncoder().encode('123456789')
    const { log } = makeLog({ updateCapture: true })
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: bytes } }))
    // producer 事后变异其持有的字节（Object.freeze(Uint8Array) 必抛——R3 修订为 intake 复制隔离）
    bytes[0] = 0
    const update = (assertAttempt(log.records()[0]!).result as { effect: string; update: { base64: string } }).update
    expect(Buffer.from(update.base64, 'base64').toString('utf8')).toBe('123456789')
    expect((assertAttempt(log.records()[0]!).result as { effect: string }).effect).toBe('update')
  })
})

describe('§9.2 管线整体：emit 绝不外抛（ADR 0011）', () => {
  it('多路违规混排：每次 emit 均不 throw，违规丢弃、合法接纳', () => {
    const { log } = makeLog()
    const emissions = [
      baseEmission({ operation: 'nope' }),
      baseEmission(),
      baseEmission({ result: { kind: 'fatal', committed: false } }),
      baseEmission({ observedAt: 'bad' }),
    ]
    for (const emission of emissions) {
      expect(() => log.emitter.emit(emission)).not.toThrow()
    }
    expect(log.records()).toHaveLength(2)
    expect(assertAttempt(log.records()[0]!).result).toEqual({ kind: 'committed', effect: 'noop' })
    expect(assertAttempt(log.records()[1]!).result).toEqual({ kind: 'fatal', committed: false })
  })
})

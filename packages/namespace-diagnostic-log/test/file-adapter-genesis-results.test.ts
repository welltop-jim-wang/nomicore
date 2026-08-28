/**
 * 红灯契约 — ADR 0012 验收门槛 4（全部 result 判别分支）+ genesis baseline record。
 *
 * 锚点：
 * - ADR 0012 §JSONL record：v1 六形状展开 8 成员判别联合（committed+noop / +update /
 *   +update-omitted；rejected；fatal+committed:false；fatal+committed:true +
 *   unknown | update | update-omitted）；「rejected 与 fatal committed:false 禁止携带
 *   update」；「payload 超限时保留 attempt metadata，记录 update-omitted 与稳定 reason」
 * - ADR 0012 §Stream 与 generation：「每个新 stream 尽力先记录当前完整 Y.Doc 的
 *   genesis baseline，使该 stream 可独立诊断性重放；genesis 未成功写入时 stream 仍可
 *   记录诊断事实，但不得声称完整重放」
 * - CONTEXT.md：genesis baseline record = 顶层 recordKind: 'genesis-baseline' 判别；
 *   无 attemptId/operation/stage/result/input（#148 设计 §11-G2 形状；#152 adapter
 *   内部构造，不改 schema）
 * - #148 设计 §7.4 三守卫（empty-update / update-capture-disabled / payload-too-large
 *   → update-omitted + 稳定 reason）
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { crc32cHex } from '../src/crc32c.js'
import { baseEmission, OBSERVED_AT } from './helpers/base.js'
import { expectTwin } from './helpers/twin.js'
import {
  checkInlineCarrier,
  decodeFrame,
  makeFileLog,
  makeTempRoot,
  patternedBytes,
  readJsonl,
  rmTempRoot,
  streamPaths,
} from './helpers/file.js'

const tempRoots: string[] = []

function freshRoot(): string {
  const root = makeTempRoot()
  tempRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmTempRoot(root)
})

/** emit 后返回 JSONL records（含 genesis 先行）。 */
function jsonlOf(log: ReturnType<typeof makeFileLog>['log']): Array<Record<string, unknown>> {
  return readJsonl(streamPaths(log.rootDir, log.namespaceId, log.streamId).jsonlPath)
}

describe('ADR 0012 验收门槛 4：全部 result 判别分支落盘且通过冻结 VFSL schema', () => {
  it('committed+noop / rejected / fatal+false / fatal+true+unknown（无 update 载体）', () => {
    const root = freshRoot()
    const { log } = makeFileLog({ rootDir: root, namespaceId: 'ns-results-1', updateCapture: true })

    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'noop' } })) // seq 1
    log.emitter.emit(baseEmission({ result: { kind: 'rejected' } })) // seq 2
    log.emitter.emit(baseEmission({ result: { kind: 'fatal', committed: false } })) // seq 3
    log.emitter.emit(baseEmission({ result: { kind: 'fatal', committed: true, effect: 'unknown' } })) // seq 4

    const records = jsonlOf(log)
    expect(records.map((r) => r.sequence)).toEqual(['1', '2', '3', '4'])

    expect(records[0]!.result).toEqual({ kind: 'committed', effect: 'noop' })
    expect(records[1]!.result).toEqual({ kind: 'rejected' })
    expect(records[2]!.result).toEqual({ kind: 'fatal', committed: false })
    expect(records[3]!.result).toEqual({ kind: 'fatal', committed: true, effect: 'unknown' })

    // rejected / fatal+committed:false 禁止携带 update（ADP 0012 §JSONL record 封闭对象）
    for (const idx of [1, 2]) {
      expect('update' in (records[idx]!.result as object)).toBe(false)
      expect('base64' in (records[idx]!.result as object)).toBe(false)
      expect('segment' in (records[idx]!.result as object)).toBe(false)
    }
    for (const r of records) expectTwin(r, `result branch ${r.sequence}`)
  })

  it('committed+update（inline）与 fatal+true+update（inline）两载体分支', () => {
    const root = freshRoot()
    const { log } = makeFileLog({ rootDir: root, namespaceId: 'ns-results-2', updateCapture: true })
    const a = patternedBytes(10)
    const b = patternedBytes(11)

    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: a } }))
    log.emitter.emit(baseEmission({ result: { kind: 'fatal', committed: true, effect: 'update', updateBytes: b } }))

    const records = jsonlOf(log)
    for (const [idx, bytes] of [[0, a], [1, b]] as const) {
      const result = records[idx]!.result as { kind: string; committed?: boolean; effect: string; update: Record<string, unknown> }
      // 勘误（2026-08-28 总控 R 裁决）：idx=1 为 fatal+committed:true 分支——kind 必须按索引区分
      //（冻结契约 src/record.ts AttemptResult：`committed` 键仅 fatal 结局携带，kind 保留 'fatal'）
      expect(result.kind).toBe(idx === 1 ? 'fatal' : 'committed')
      if (idx === 1) expect(result.committed).toBe(true)
      expect(result.effect).toBe('update')
      expect(result.update.storage).toBe('inline')
      checkInlineCarrier(result.update as { base64: string; payloadLength: number; crc32c: string })
      expect(result.update.crc32c).toBe(crc32cHex(bytes))
      expectTwin(records[idx]!, 'committed/fatal update branch')
    }
  })

  it('committed+update-omitted（producer 声明）与 fatal+true+update-omitted', () => {
    const root = freshRoot()
    const { log } = makeFileLog({ rootDir: root, namespaceId: 'ns-results-3' })
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update-omitted', reason: 'empty-update' } }))
    log.emitter.emit(baseEmission({ result: { kind: 'fatal', committed: true, effect: 'update-omitted', reason: 'update-capture-disabled' } }))

    const records = jsonlOf(log)
    expect(records[0]!.result).toEqual({ kind: 'committed', effect: 'update-omitted', reason: 'empty-update' })
    expect(records[1]!.result).toEqual({ kind: 'fatal', committed: true, effect: 'update-omitted', reason: 'update-capture-disabled' })
    for (const r of records) expectTwin(r, 'update-omitted branch')
  })
})

describe('#148 设计 §7.4 守卫：guard 驱动 update-omitted 三 reason（保留 attempt metadata）', () => {
  it('empty-update：0 字节 → update-omitted/empty-update，attempt metadata 完整保留', () => {
    const root = freshRoot()
    const { log, events } = makeFileLog({ rootDir: root, namespaceId: 'ns-guard-1', updateCapture: true })
    log.emitter.emit(baseEmission({
      operation: 'root-mutation',
      stage: 'transaction',
      result: { kind: 'committed', effect: 'update', updateBytes: new Uint8Array(0) },
    }))
    const record = jsonlOf(log)[0]!
    expect(record.operation).toBe('root-mutation')
    expect(record.stage).toBe('transaction')
    expect(record.attemptId).toBeDefined()
    expect(record.result).toEqual({ kind: 'committed', effect: 'update-omitted', reason: 'empty-update' })
    // 不是 writer bug：无 vfsl-validation-failed
    expect(events.filter((e) => e.type === 'vfsl-validation-failed')).toHaveLength(0)
    expectTwin(record, 'empty-update guard')
  })

  it('update-capture-disabled：默认配置（updateCapture:false）→ 记录 update-omitted 而非 update', () => {
    const root = freshRoot()
    const { log } = makeFileLog({ rootDir: root, namespaceId: 'ns-guard-2', updateCapture: false })
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(10) } }))
    const record = jsonlOf(log)[0]!
    expect(record.result).toEqual({ kind: 'committed', effect: 'update-omitted', reason: 'update-capture-disabled' })
    expectTwin(record, 'update-capture-disabled guard')
  })

  it('payload-too-large：payloadMaxBytes 守卫 → update-omitted/payload-too-large 而非整条丢弃', () => {
    const root = freshRoot()
    const { log } = makeFileLog({ rootDir: root, namespaceId: 'ns-guard-3', updateCapture: true, payloadMaxBytes: 8 })
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(9) } }))
    const record = jsonlOf(log)[0]!
    expect(record.result).toEqual({ kind: 'committed', effect: 'update-omitted', reason: 'payload-too-large' })
    expect(record.attemptId).toBeDefined() // attempt metadata 保留
    expectTwin(record, 'payload-too-large guard')
  })
})

describe('genesis baseline record：新 stream 尽力先记录（#152 adapter 内部构造，不改 schema）', () => {
  it('提供 genesisUpdateBytes → 首条为 genesis-baseline（sequence 1），attempt 从 2 起', () => {
    const root = freshRoot()
    const genesis = patternedBytes(32)
    const { log } = makeFileLog({
      rootDir: root,
      namespaceId: 'ns-genesis-1',
      updateCapture: true,
      genesisUpdateBytes: genesis,
      clock: { now: () => 0 }, // 固定时钟 → observedAt 可钉
    })

    const records = jsonlOf(log)
    expect(records).toHaveLength(1) // 仅 genesis（尚未 emit attempt）
    const genesisRecord = records[0]!
    expect(genesisRecord.recordKind).toBe('genesis-baseline')
    expect(genesisRecord.streamId).toBe(log.streamId)
    expect(genesisRecord.sequence).toBe('1')
    expect(genesisRecord.observedAt).toBe('1970-01-01T00:00:00.000Z')
    expect(genesisRecord.source).toEqual({ kind: 'local' })
    // 非变更尝试：无 attemptId/operation/stage/result/input 键
    expect('attemptId' in genesisRecord).toBe(false)
    expect('operation' in genesisRecord).toBe(false)
    expect('stage' in genesisRecord).toBe(false)
    expect('result' in genesisRecord).toBe(false)
    expect('input' in genesisRecord).toBe(false)

    const update = genesisRecord.update as Record<string, unknown>
    expect(update.storage).toBe('inline')
    expect(update.format).toBe('yjs-update-v1')
    expect(update.payloadLength).toBe(32)
    expect(update.crc32c).toBe(crc32cHex(genesis))
    checkInlineCarrier(update as { base64: string; payloadLength: number; crc32c: string })
    expectTwin(genesisRecord, 'genesis-baseline record')

    // attempt 紧随其后：sequence 2
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'noop' } }))
    const after = jsonlOf(log)
    expect(after).toHaveLength(2)
    expect(after[1]!.recordKind).toBe('attempt')
    expect(after[1]!.sequence).toBe('2')
  })

  it('genesisUpdateBytes 超过 inline 阈值 → genesis 走 sidecar frame（offset 0）', () => {
    const root = freshRoot()
    const genesis = patternedBytes(4097)
    const { log } = makeFileLog({ rootDir: root, namespaceId: 'ns-genesis-2', updateCapture: true, genesisUpdateBytes: genesis })

    const records = jsonlOf(log)
    const update = records[0]!.update as Record<string, unknown>
    expect(update.storage).toBe('sidecar')
    expect(update.segment).toBe('00000001')
    expect(update.frameOffset).toBe('0')
    expect(update.payloadLength).toBe(4097)

    const bin = new Uint8Array(requireFsRead(streamPaths(root, 'ns-genesis-2', log.streamId).binPath))
    const frame = decodeFrame(bin, 0)
    expect(frame.sequence).toBe(1n)
    expect(frame.payload).toEqual(genesis)
    expectTwin(records[0]!, 'genesis sidecar record')
  })

  it('不提供 genesisUpdateBytes → stream 直接以 attempt 开始（genesis 可选最佳努力）', () => {
    const root = freshRoot()
    const { log } = makeFileLog({ rootDir: root, namespaceId: 'ns-genesis-3', updateCapture: true })
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'noop' } }))
    const records = jsonlOf(log)
    expect(records).toHaveLength(1)
    expect(records[0]!.recordKind).toBe('attempt')
    expect(records[0]!.sequence).toBe('1')
  })
})

function requireFsRead(path: string): Buffer {
  return readFileSync(path)
}

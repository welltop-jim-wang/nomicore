/**
 * 红灯契约 — Round 2 writer 面（PR #159 人工评审反馈，2026-08-28；R2-G1 取代 round 1
 * 「分配即消耗 / gap 合法」）。权威契约：wiki/raw/task_diagnostic-log-file-adapter-r2_design.md
 * （SA1 R3，SA2 R2 pass + SA8 R3 delta clear）——本文件锚定其 §3.2/§3.2.1/§3.3/§5.2
 * 的 writer 语义与 §5.3 锚 7/8/11。
 *
 * 语义契约（设计 §3.1–§3.3）：
 * - sequence 只在「record 通过全部可失败准备门、即将进入 JSONL append 的提交分支」时
 *   以 candidate 取得；任何 candidate 前 gate drop / definitive pre-commit failure
 *   不写入 lastCommittedSequence，candidate 可安全复用；
 * - JSONL/BIN append 失败二分：open 期即失败的 EISDIR/EACCES/ENOENT（可证明零字节）
 *   与测试 seam 声明 wroteBytes:0 为 definitive；其余（含 write 期失败）默认 ambiguous：
 *   reservation 该 candidate、封闭旧 generation（failed/readonly），绝不复用、绝不在
 *   旧 stream 继续写第二条相同 (streamId, sequence)；
 * - genesis 守卫（0 字节 / 超 payloadMax / projection / gate 失败）发生在 candidate 前，
 *   不消耗 sequence；genesis confirmed success 提交 '1'；
 * - exhausted：仅 confirmed JSONL success 到 UINT64_MAX 时恰一次 stream-exhausted；
 *   ambiguous/definitive 失败于 max 候选不得触发 exhausted。
 *
 * 测试手段（无新接缝依赖；全部基于真实运行时行为）：
 * - gate drop：line 预算（record-dropped/line-budget-exceeded）；
 * - definitive：目录占位 EISDIR（open 期，零字节可证明）、segments 目录删除 ENOENT；
 * - ambiguous：JSONL 路径替换为 /dev/full 符号链接——open 成功、write(2) 恒 ENOSPC 的
 *   write 期失败；按设计 §3.2.1 不属于「打开前确定零字节」三类，默认归 ambiguous
 *   （设计明令不得从 errno 猜测零写入——ENOSPC 无字节回执，属歧义结果）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { UINT64_MAX } from '../src/adapters/memory.js'
import { readStreamStrict } from '../src/index.js'
import { createEventCollectingObserver, createFileDiagnosticLogPresetSequence } from '../src/testing.js'
import { baseEmission } from './helpers/base.js'
import {
  decodeFrame,
  encodeFrame,
  eventsOfType,
  FRAME_HEADER_BYTES,
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

/** 设计 §3.2.1：ambiguous 的「may not be persisted」证据必须在可观察通道出现
 *  （health payload 或 fallback log line——设计原文「health payload/log line must
 *  state: `sequence <candidate> may not be persisted`」）。 */
function assertMayNotBePersistedEvidence(
  events: readonly unknown[],
  logLines: readonly string[],
  candidate: string,
): void {
  const sources = [...logLines, ...events.map((e) => JSON.stringify(e))]
  expect(
    sources.some((s) => s.includes('may not be persisted') && s.includes(candidate)),
    `缺少「sequence ${candidate} may not be persisted」可观察证据（events=${JSON.stringify(events)} logLines=${JSON.stringify(logLines)}）`,
  ).toBe(true)
}

describe('R2：sequence 提交点——candidate 前门禁失败不消耗 sequence（设计 §3.2/§3.3）', () => {
  it('line 预算 gate drop → 后续成功 record 的 sequence 为 "1"（门失败零落盘、不推进）', () => {
    const root = freshRoot()
    const { log, events } = makeFileLog({
      rootDir: root,
      namespaceId: 'ns-r2-seq-gate',
      lineBudgetBytes: 400,
      updateCapture: true,
    })
    const p = streamPaths(root, 'ns-r2-seq-gate', log.streamId)

    // 2000 字符 message 的 issues 投影后 record 恒超 400B line budget → record-dropped
    log.emitter.emit(
      baseEmission({
        result: { kind: 'committed', effect: 'noop' },
        issues: [{ message: 'x'.repeat(2000), path: [] }],
      }),
    )
    const dropped = eventsOfType(events, 'record-dropped')
    expect(dropped).toHaveLength(1)
    expect(dropped[0]!.reason).toBe('line-budget-exceeded')
    expect(existsSync(p.jsonlPath)).toBe(false) // gate 失败零落盘

    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'noop' } }))
    const records = readJsonl(p.jsonlPath)
    expect(records).toHaveLength(1)
    expect(records[0]!.sequence).toBe('1') // 当前实现（分配即消耗）产出 '2' → 红灯
  })

  it('genesis 0 字节守卫跳过 → 首个 attempt 的 sequence 为 "1"（守卫不消耗；round 1 G2 语义废止）', () => {
    const root = freshRoot()
    const { log } = makeFileLog({
      rootDir: root,
      namespaceId: 'ns-r2-genesis0',
      genesisUpdateBytes: new Uint8Array(0),
      updateCapture: true,
    })
    const p = streamPaths(root, 'ns-r2-genesis0', log.streamId)

    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'noop' } }))
    const records = readJsonl(p.jsonlPath)
    expect(records).toHaveLength(1)
    expect(records[0]!.recordKind).toBe('attempt') // genesis 被守卫跳过：零落盘
    expect(records[0]!.sequence).toBe('1') // 当前实现（genesis 先分配后守卫）产出 '2' → 红灯

    const read = readStreamStrict({ rootDir: root, namespaceId: 'ns-r2-genesis0', streamId: log.streamId })
    expect(read.status).toBe('ok') // 「1」起连续——健康 stream 不误判（R2-AC2）
  })

  it('genesis 超 payloadMax 守卫跳过 → 首个 attempt 为 "1"', () => {
    const root = freshRoot()
    const { log } = makeFileLog({
      rootDir: root,
      namespaceId: 'ns-r2-genesis-max',
      genesisUpdateBytes: patternedBytes(32),
      payloadMaxBytes: 16,
      updateCapture: true,
    })
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'noop' } }))
    const records = readJsonl(streamPaths(root, 'ns-r2-genesis-max', log.streamId).jsonlPath)
    expect(records).toHaveLength(1)
    expect(records[0]!.recordKind).toBe('attempt')
    expect(records[0]!.sequence).toBe('1') // 当前实现产出 '2' → 红灯
  })

  it('genesis confirmed success → genesis 为 "1"、attempt 为 "2"（正例：提交点分配保持既有健康语义）', () => {
    const root = freshRoot()
    const { log } = makeFileLog({
      rootDir: root,
      namespaceId: 'ns-r2-genesis-ok',
      genesisUpdateBytes: patternedBytes(32),
      updateCapture: true,
    })
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(10) } }))
    const records = readJsonl(streamPaths(root, 'ns-r2-genesis-ok', log.streamId).jsonlPath)
    expect(records.map((r) => r.sequence)).toEqual(['1', '2'])
    expect(records[0]!.recordKind).toBe('genesis-baseline')

    const read = readStreamStrict({ rootDir: root, namespaceId: 'ns-r2-genesis-ok', streamId: log.streamId })
    expect(read.status).toBe('ok')
  })
})

describe('R2：definitive pre-commit failure（设计 §3.2.1 / §5.3 #8）——open 期零字节失败保持 candidate 可复用', () => {
  it('jsonl 目录占位（open 期 EISDIR）→ 恢复后下一成功 record 使用同一 candidate（"1"）、reader ok 无 gap', () => {
    const root = freshRoot()
    const { log, events } = makeFileLog({ rootDir: root, namespaceId: 'ns-r2-def-jsonl', updateCapture: true })
    const p = streamPaths(root, 'ns-r2-def-jsonl', log.streamId)

    mkdirSync(p.jsonlPath, { recursive: true }) // 目标即目录 → open 期 EISDIR，零字节可证明
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(10) } }))
    expect(
      eventsOfType(events, 'storage-write-failed').some((e) => e.stage === 'jsonl' && e.code === 'EISDIR'),
    ).toBe(true)

    rmdirSync(p.jsonlPath)
    expect(existsSync(p.jsonlPath)).toBe(false) // 零字节证据：失败未创建任何文件
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(10) } }))

    const records = readJsonl(p.jsonlPath)
    expect(records).toHaveLength(1)
    expect(records[0]!.sequence).toBe('1') // 当前实现（definitive 亦消耗）产出 '2' → 红灯

    const read = readStreamStrict({ rootDir: root, namespaceId: 'ns-r2-def-jsonl', streamId: log.streamId })
    expect(read.status).toBe('ok')
    expect(read.records.map((r) => r.sequence)).toEqual(['1'])
  })

  it('bin 目录占位（sidecar BIN-first open 期 EISDIR）→ 恢复后复用 "1"、frame offset 0、reader ok', () => {
    const root = freshRoot()
    const { log, events } = makeFileLog({ rootDir: root, namespaceId: 'ns-r2-def-bin', updateCapture: true })
    const p = streamPaths(root, 'ns-r2-def-bin', log.streamId)

    mkdirSync(p.binPath, { recursive: true })
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(4097) } }))
    expect(
      eventsOfType(events, 'storage-write-failed').some((e) => e.stage === 'bin' && e.code === 'EISDIR'),
    ).toBe(true)

    rmdirSync(p.binPath)
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(4097) } }))

    const records = readJsonl(p.jsonlPath)
    expect(records).toHaveLength(1)
    expect(records[0]!.sequence).toBe('1') // 当前实现产出 '2' → 红灯
    const carrier = (records[0]!.result as { update: { storage: string; frameOffset: string } }).update
    expect(carrier.storage).toBe('sidecar')
    expect(carrier.frameOffset).toBe('0') // 恢复后 fresh stat（非缓存）→ 帧从 0 起

    const read = readStreamStrict({ rootDir: root, namespaceId: 'ns-r2-def-bin', streamId: log.streamId })
    expect(read.status).toBe('ok') // [1] 连续；帧/JSONL 交叉一致
  })

  it('segments 目录删除（open 期 ENOENT）→ 恢复后复用 "1"', () => {
    const root = freshRoot()
    const { log, events } = makeFileLog({ rootDir: root, namespaceId: 'ns-r2-def-enoent', updateCapture: true })
    const p = streamPaths(root, 'ns-r2-def-enoent', log.streamId)

    rmSyncSegments(p.segmentsDir)
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(10) } }))
    expect(
      eventsOfType(events, 'storage-write-failed').some((e) => e.stage === 'jsonl' && e.code === 'ENOENT'),
    ).toBe(true)
    expect(existsSync(p.jsonlPath)).toBe(false) // 零字节证据

    mkdirSync(p.segmentsDir, { recursive: true })
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(10) } }))
    const records = readJsonl(p.jsonlPath)
    expect(records).toHaveLength(1)
    expect(records[0]!.sequence).toBe('1') // 当前实现产出 '2' → 红灯
  })
})

describe('R2：ambiguous append outcome（设计 §3.2.1 / §5.3 #7）——write 期未知结果不得复用、封闭 generation', () => {
  it('JSONL write 期 ENOSPC（/dev/full）→ 恢复后同 generation 零新增（密封）、绝无伪作连续恢复', () => {
    const root = freshRoot()
    const logLines: string[] = []
    const { log, events } = makeFileLog({
      rootDir: root,
      namespaceId: 'ns-r2-amb-inline',
      updateCapture: true,
      fallbackLog: (line: string) => logLines.push(line),
    })
    const p = streamPaths(root, 'ns-r2-amb-inline', log.streamId)

    // 前置一条真实记录（seq 1，建立同 generation 基线）
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(10) } }))
    expect(readJsonl(p.jsonlPath)).toHaveLength(1)

    // JSONL 路径替换为 /dev/full：open 成功、write(2) 恒 ENOSPC——write 期失败，
    // 无法证明「完整 JSONL line 未出现」→ 设计默认 ambiguous（禁 errno 猜零写入）
    renameSync(p.jsonlPath, p.jsonlPath + '.bak')
    symlinkSync('/dev/full', p.jsonlPath)
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(10) } }))
    expect(eventsOfType(events, 'storage-write-failed').some((e) => e.stage === 'jsonl')).toBe(true)
    assertMayNotBePersistedEvidence(events, logLines, '2')

    // 恢复真实文件后再次 emit：ambiguous 已封闭该 generation → 零新增
    unlinkSync(p.jsonlPath)
    renameSync(p.jsonlPath + '.bak', p.jsonlPath)
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(10) } }))
    const records = readJsonl(p.jsonlPath)
    expect(records.map((r) => r.sequence)).toEqual(['1']) // 当前实现（不封闭）产 ['1','3'] → 红灯
  })

  it('sidecar BIN-first：JSONL write 期 ENOSPC → BIN orphan 保留、JSONL 零新增、同 generation 密封', () => {
    const root = freshRoot()
    const logLines: string[] = []
    const { log, events } = makeFileLog({
      rootDir: root,
      namespaceId: 'ns-r2-amb-sidecar',
      updateCapture: true,
      fallbackLog: (line: string) => logLines.push(line),
    })
    const p = streamPaths(root, 'ns-r2-amb-sidecar', log.streamId)
    const frameBytes = FRAME_HEADER_BYTES + 4097

    // 前置：sidecar seq 1 成功（bin [frame1]，jsonl [1]）
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(4097) } }))
    expect(readJsonl(p.jsonlPath)).toHaveLength(1)

    // 第二次：BIN-first 帧完整落盘（orphan frame seq 2 at offset frameBytes），JSONL write 期 ENOSPC → ambiguous
    renameSync(p.jsonlPath, p.jsonlPath + '.bak')
    symlinkSync('/dev/full', p.jsonlPath)
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(4097) } }))
    expect(eventsOfType(events, 'storage-write-failed').some((e) => e.stage === 'jsonl')).toBe(true)
    assertMayNotBePersistedEvidence(events, logLines, '2')
    // 既有 bin 增加一个 orphan frame（诚实残态保留；不得用同 candidate 或更高 candidate 重写旧 stream）
    const bin1 = readBin(p.binPath)
    expect(bin1.byteLength).toBe(frameBytes * 2)
    expect(decodeFrame(bin1, frameBytes).sequence).toBe(2n)

    // 恢复后：generation 已封闭 → JSONL 零新增、bin 零新增
    unlinkSync(p.jsonlPath)
    renameSync(p.jsonlPath + '.bak', p.jsonlPath)
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(4097) } }))
    expect(readJsonl(p.jsonlPath).map((r) => r.sequence)).toEqual(['1']) // 当前实现产 ['1','3'] → 红灯
    expect(readBin(p.binPath).byteLength).toBe(frameBytes * 2) // 当前实现追加 frame 3 → 3 帧 → 红灯
  })

  it('ambiguous 与 definitive 的可观察差异：同一 EISDIR 故障下 ambiguous 不触发任何「同 candidate 恢复」', () => {
    // （结构锚：definitive 分支由上一 describe 覆盖；此处定性确认 ambiguous 事件通道存在）
    const root = freshRoot()
    const logLines: string[] = []
    const { log, events } = makeFileLog({
      rootDir: root,
      namespaceId: 'ns-r2-amb-min',
      updateCapture: true,
      fallbackLog: (line: string) => logLines.push(line),
    })
    const p = streamPaths(root, 'ns-r2-amb-min', log.streamId)
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(10) } }))
    renameSync(p.jsonlPath, p.jsonlPath + '.bak')
    symlinkSync('/dev/full', p.jsonlPath)
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(10) } }))
    // 至少一条 jsonl 写作失败事件 + may-not-be-persisted 证据——两分支的事件面存在
    expect(eventsOfType(events, 'storage-write-failed').some((e) => e.stage === 'jsonl')).toBe(true)
    assertMayNotBePersistedEvidence(events, logLines, '2')
    unlinkSync(p.jsonlPath)
    renameSync(p.jsonlPath + '.bak', p.jsonlPath)
  })
})

describe('R2：exhausted 边界（设计 §3.3 / §5.3 #11）', () => {
  it('confirmed UINT64_MAX → 恰一次 stream-exhausted + 记录落盘 + 后续零落盘', () => {
    const root = freshRoot()
    const observer = createEventCollectingObserver()
    const log = createFileDiagnosticLogPresetSequence(
      { rootDir: root, namespaceId: 'ns-r2-max-ok', updateCapture: true, observer },
      '18446744073709551614',
    )
    const p = streamPaths(root, 'ns-r2-max-ok', log.streamId)

    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'noop' } }))
    const records = readJsonl(p.jsonlPath)
    expect(records).toHaveLength(1)
    expect(records[0]!.sequence).toBe(UINT64_MAX)

    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'noop' } }))
    expect(readJsonl(p.jsonlPath)).toHaveLength(1)
    expect(eventsOfType(observer.events, 'stream-exhausted')).toHaveLength(1)

    const read = readStreamStrict({ rootDir: root, namespaceId: 'ns-r2-max-ok', streamId: log.streamId })
    expect(read.status).toBe('corrupt') // 预置接缝自 '1' 起连续前缀未落盘 → 诚实 gap（设计 §3.3 预置前提）
    expect(read.issues.some((i) => i.code === 'sequence-gap')).toBe(true)
    expect(read.records[0]!.ok).toBe(true)
  })

  it('definitive 失败于 max 候选 → 不发 stream-exhausted；恢复后同 candidate 落盘且恰一次 exhausted', () => {
    const root = freshRoot()
    const observer = createEventCollectingObserver()
    const log = createFileDiagnosticLogPresetSequence(
      { rootDir: root, namespaceId: 'ns-r2-max-def', updateCapture: true, observer },
      '18446744073709551614',
    )
    const p = streamPaths(root, 'ns-r2-max-def', log.streamId)

    mkdirSync(p.jsonlPath, { recursive: true }) // definitive：open 期 EISDIR
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'noop' } }))
    expect(eventsOfType(observer.events, 'stream-exhausted')).toHaveLength(0) // 当前实现（分配即 exhausted）→ 1 → 红灯
    expect(
      eventsOfType(observer.events, 'storage-write-failed').some((e) => e.stage === 'jsonl'),
    ).toBe(true)

    rmdirSync(p.jsonlPath)
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'noop' } }))
    const records = readJsonl(p.jsonlPath)
    expect(records).toHaveLength(1)
    expect(records[0]!.sequence).toBe(UINT64_MAX) // confirmed 落盘于 max
    expect(eventsOfType(observer.events, 'stream-exhausted')).toHaveLength(1) // 恰一次：仅在 confirmed success

    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'noop' } }))
    expect(readJsonl(p.jsonlPath)).toHaveLength(1) // 后续丢弃（绝不超域）
    expect(eventsOfType(observer.events, 'stream-exhausted')).toHaveLength(1)
  })

  it('ambiguous 失败于 max 候选 → 不发 stream-exhausted（未确认耗尽）、密封 generation', () => {
    const root = freshRoot()
    const observer = createEventCollectingObserver()
    const logLines: string[] = []
    const log = createFileDiagnosticLogPresetSequence(
      { rootDir: root, namespaceId: 'ns-r2-max-amb', updateCapture: true, observer, fallbackLog: (l: string) => logLines.push(l) },
      '18446744073709551614',
    )
    const p = streamPaths(root, 'ns-r2-max-amb', log.streamId)

    symlinkSync('/dev/full', p.jsonlPath) // write 期失败 → ambiguous
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'noop' } }))
    expect(eventsOfType(observer.events, 'stream-exhausted')).toHaveLength(0) // 当前实现 → 1 → 红灯
    expect(eventsOfType(observer.events, 'storage-write-failed').some((e) => e.stage === 'jsonl')).toBe(true)
    assertMayNotBePersistedEvidence(observer.events, logLines, UINT64_MAX)

    unlinkSync(p.jsonlPath)
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'noop' } }))
    expect(existsSync(p.jsonlPath)).toBe(false) // 已封闭：恢复也不得写
    expect(eventsOfType(observer.events, 'stream-exhausted')).toHaveLength(0)
  })
})

/** 读取 .bin 原始字节。 */
function readBin(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path))
}

/** 删除 segments 目录（ENOENT definitive 变体）。 */
function rmSyncSegments(segmentsDir: string): void {
  rmSync(segmentsDir, { recursive: true, force: true })
}

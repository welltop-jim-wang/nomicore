/**
 * 红灯契约 — Issue #153 Reopen streams, roll segments, and repair provable tails（设计定稿 §13）。
 *
 * 权威契约：`wiki/raw/task_diagnostic-log-stream-roll-repair_design.md`（§13 SA6 锚点全表；
 * §4 健康证明 / §5 可证明尾部修复 / §6 segment group 滚动 / §7 耗尽 / §8 构造流程 /
 * §10 健康事件词表）。约束优先级：任务简报 > SA8 前置门禁 > ADR-0012（含 2026-08-28
 * 首切片 amendment）> ADR-0011/0008 > #148 冻结契约 > #152/R2 设计。
 *
 * 全部断言针对运行时产物（磁盘字节、observer 事件、readStreamStrict 返回）——零源码
 * 文本断言（SA6 禁令）。
 *
 * fixture 与配置注记：
 * - 会话期 src 的 `FileDiagnosticLogConfig`/`DiagnosticLogHealthEvent` 类型面尚未含本票
 *   新键/新成员（要待 SA3）——本文件以 `makeRollFileLog`（config 断言收敛）与
 *   `eventsOfTypeRaw`（按字符串判别的事件窄化）保持类型面冻结期可编译；SA3 加类型后
 *   仍编译（断言层只按行为判别）。
 * - fixture stream 使用 17 键 manifest（`validManifest` 默认——本票 writer 的产物形状）；
 *   14 键 legacy 夹具显式 `legacyManifest`。
 * - 所有 resume 构造统一显式 `updateCapture: true`（fixture manifest 默认
 *   committedUpdateCapture=true——冻结比对 §4.2 的一致面）。
 * - 多 segment fixture 的 roll targets 按夹具语义显式给定（闭段 roll-target 核查 §9.3
 *   要求闭段至少一维达标——夹具 targets 与构造 config 必须一致）。
 */
import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readStreamStrict } from '../src/index.js'
import type { FileDiagnosticLogConfig } from '../src/index.js'
import { createFileDiagnosticLogPresetSequence } from '../src/testing.js'
import { baseEmission } from './helpers/base.js'
import {
  concatU8,
  encodeFrame,
  eventsOfType,
  eventsOfTypeRaw,
  FRAME_HEADER_BYTES,
  legacyManifest,
  makeFileLog,
  makeTempRoot,
  patternedBytes,
  readJson,
  readJsonl,
  readJsonlBytes,
  rmTempRoot,
  sidecarAttemptRecord,
  streamPaths,
  validAttemptRecord,
  validCurrent,
  validManifest,
  writeStreamFixture,
} from './helpers/file.js'
import type { AssembledFileLog } from './helpers/file.js'

const tempRoots: string[] = []

function freshRoot(): string {
  const root = makeTempRoot()
  tempRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmTempRoot(root)
})

/** sidecar 帧字节长（25B header + 4097B payload；>默认 inline 阈值 4096 → sidecar 路径）。 */
const SIDE_PAYLOAD = 4097
const FRAME_BYTES = FRAME_HEADER_BYTES + SIDE_PAYLOAD // 4122

/** §13 契约里的 fixture streamId（CSPRNG 形状：log- + 32hex，isSafeStreamId 通过）。 */
const FX = 'log-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const FX2 = 'log-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

/** 全部文件的确定性枚举（歧义/零写入断言用）。 */
function countFilesRecursive(dir: string): number {
  let count = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) count += countFilesRecursive(full)
    else count += 1
  }
  return count
}

/** segment 目录枚举（8 位名排序；entry 含 .jsonl/.bin 全名）。 */
function segmentEntries(root: string, ns: string, streamId: string): string[] {
  return readdirSync(streamPaths(root, ns, streamId).segmentsDir).sort()
}

/** 逐 segment（按 8 位名升序）读取全部 JSONL record。 */
function readAllSegments(root: string, ns: string, streamId: string): Array<{ segment: string; record: Record<string, unknown> }> {
  const p = streamPaths(root, ns, streamId)
  const out: Array<{ segment: string; record: Record<string, unknown> }> = []
  for (const entry of segmentEntries(root, ns, streamId)) {
    if (!entry.endsWith('.jsonl')) continue
    const segment = entry.slice(0, -'.jsonl'.length)
    for (const record of readJsonl(join(p.segmentsDir, entry))) {
      out.push({ segment, record })
    }
  }
  return out
}

/** #153 配置键（src 类型面待 SA3 扩展；此处以断言收敛保持类型面冻结期可编译）。 */
type RollConfigKeys = {
  targetJsonlSegmentBytes?: number
  targetBinSegmentBytes?: number
  targetRecordsPerSegment?: number
}

/** #153 构造（默认 updateCapture:true——与 fixture manifest 的 committedUpdateCapture 一致）。 */
function makeRollFileLog(config: Partial<FileDiagnosticLogConfig> & RollConfigKeys): AssembledFileLog {
  return makeFileLog({ updateCapture: true, ...config } as Partial<FileDiagnosticLogConfig>)
}

/** resume 构造的默认模板（17 键 fixture 的冻结面一致参数）。 */
function makeResumeLog(root: string, ns: string, extra: Partial<FileDiagnosticLogConfig> & RollConfigKeys = {}): AssembledFileLog {
  return makeRollFileLog({ rootDir: root, namespaceId: ns, ...extra })
}

/** 合法单 segment 记录主线（rec1 起、默认 targets；装配成 healthy stream 的基模）。 */
function rotatedProof(
  b: AssembledFileLog,
  streamFixture: string,
  root: string,
  ns: string,
  cause: string,
): void {
  const rotated = eventsOfTypeRaw(b.events, 'stream-generation-rotated')
  expect(rotated).toHaveLength(1)
  expect(rotated[0]).toMatchObject({ type: 'stream-generation-rotated', cause })
  expect(b.log.streamId).not.toBe(streamFixture)
  expect(b.log.streamId).toMatch(/^log-[0-9a-f]{32}$/)
  // current.json 指向新 stream（rotate 后 initNewGeneration 的 locator 愈合）
  const current = readJson<Record<string, unknown>>(streamPaths(root, ns, b.log.streamId).currentPath)
  expect(current.streamId).toBe(b.log.streamId)
}

// ============================================================================
// §13.1–§13.3 AC1 reopen/续写（门槛 12）
// ============================================================================
describe('§13.1–3 AC1：健康 stream 续写 reopen（顺序复用单逻辑 writer）', () => {
  it('§13.1 [红灯] 无 resumeStreamId 重启 → 同 streamId 续写、sequence 续接、reader 全绿', () => {
    const root = freshRoot()
    const ns = 'ns-ac1-1'
    const a = makeRollFileLog({
      rootDir: root,
      namespaceId: ns,
      targetJsonlSegmentBytes: 2000,
      targetBinSegmentBytes: 20000,
      targetRecordsPerSegment: 2,
    })
    // A：3 条（records target=2 → 滚出 00000002；seg1=[1,2]，seg2=[3]）
    a.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    a.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(SIDE_PAYLOAD) } }))
    a.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    expect(segmentEntries(root, ns, a.log.streamId)).toContain('00000002.jsonl')

    // B：同 root 同配置重启（无 resumeStreamId）→ 续写同一 stream
    const b = makeResumeLog(root, ns, {
      targetJsonlSegmentBytes: 2000,
      targetBinSegmentBytes: 20000,
      targetRecordsPerSegment: 2,
    })
    expect(b.log.streamId).toBe(a.log.streamId)
    // B 首条 emit sequence = A 末条 +1；append 依 §6.3 种子落 SegMax（seg2 已 1 条 < 2 → 不滚）
    b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    const all = readAllSegments(root, ns, a.log.streamId)
    expect(all.map((r) => r.record.sequence)).toEqual(['1', '2', '3', '4'])
    expect(all[3]!.segment).toBe('00000002')
    // 跨段连续 → reader 全绿
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: a.log.streamId }).status).toBe('ok')
  })

  it('§13.2 [红灯] B 续写后 current.json 仍指向该 stream；A/B 记录按 sequence 全序排列', () => {
    const root = freshRoot()
    const ns = 'ns-ac1-2'
    const a = makeRollFileLog({ rootDir: root, namespaceId: ns, targetRecordsPerSegment: 2 })
    a.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    a.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(SIDE_PAYLOAD) } }))
    a.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))

    const b = makeResumeLog(root, ns, { targetRecordsPerSegment: 2 })
    b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))

    const current = readJson<Record<string, unknown>>(streamPaths(root, ns, a.log.streamId).currentPath)
    expect(current.streamId).toBe(a.log.streamId)
    const all = readAllSegments(root, ns, a.log.streamId)
    expect(all.map((r) => r.record.sequence)).toEqual(['1', '2', '3', '4'])
    expect(all.map((r) => r.record.streamId)).toEqual([a.log.streamId, a.log.streamId, a.log.streamId, a.log.streamId])
  })

  it('§13.3 [红灯] resumeStreamId 显式指定健康 stream → 续写（显式处置路径）', () => {
    const root = freshRoot()
    const ns = 'ns-ac1-3'
    const a = makeRollFileLog({ rootDir: root, namespaceId: ns, targetRecordsPerSegment: 5 })
    a.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    a.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(SIDE_PAYLOAD) } }))

    const b = makeResumeLog(root, ns, { resumeStreamId: a.log.streamId, targetRecordsPerSegment: 5 })
    expect(b.log.streamId).toBe(a.log.streamId)
    b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    const all = readAllSegments(root, ns, a.log.streamId)
    expect(all.map((r) => r.record.sequence)).toEqual(['1', '2', '3'])
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: a.log.streamId }).status).toBe('ok')
  })
})

// ============================================================================
// §13.4–§13.6 AC2 Segment group 滚动
// ============================================================================
describe('§13.4–6 AC2：JSONL/BIN 成对滚动（固定编号、边界判定、续写期滚动）', () => {
  it('§13.4 [红灯] 小 targets + 混合 inline/sidecar → 成对滚动；闭组至少一维达标；单条超大记录独占新组', () => {
    const root = freshRoot()
    const ns = 'ns-ac2-1'
    const cfg = {
      targetJsonlSegmentBytes: 2000,
      targetBinSegmentBytes: 60000,
      targetRecordsPerSegment: 2,
    }
    const { log, events } = makeRollFileLog({ rootDir: root, namespaceId: ns, ...cfg })
    const emit = (bytes: number) =>
      log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(bytes) } }))

    emit(100) // seg1 rec1 inline
    emit(SIDE_PAYLOAD) // seg1 rec2 sidecar（seg1.bin 惰性创建）
    emit(100) // seg2 rec3 inline（seg1 达标 → 滚动）
    emit(SIDE_PAYLOAD) // seg2 rec4 sidecar
    emit(SIDE_PAYLOAD) // seg3 rec5 超大 sidecar（seg2 达标 → 滚动；单条独占新组且字节超 jsonl target）

    const entries = segmentEntries(root, ns, log.streamId)
    // 同组 JSONL/BIN 同号成对
    expect(entries).toContain('00000001.jsonl')
    expect(entries).toContain('00000001.bin')
    expect(entries).toContain('00000002.jsonl')
    expect(entries).toContain('00000002.bin')
    expect(entries).toContain('00000003.jsonl')
    expect(entries).toContain('00000003.bin')

    // 闭组在滚动前至少一维达标（§9.3 正例）：seg1 与 seg2 均恰 2 条 = records target
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: log.streamId }).status).toBe('ok')

    // 单条超大 record（帧 4122B > jsonl target 2000B）独占新组且不越 record/payload 硬上限
    // （line 预算内 → 落盘、无 drop 事件）
    const seg3 = readJsonl(join(streamPaths(root, ns, log.streamId).segmentsDir, '00000003.jsonl'))
    expect(seg3).toHaveLength(1)
    expect(seg3[0]!.sequence).toBe('5')
    expect(eventsOfType(events, 'record-dropped').some((e) => e.reason === 'line-budget-exceeded')).toBe(false)
  })

  it('§13.5a [红灯] 恰达 target（records==target）→ 下一条前滚动（边界双向：达标即滚）', () => {
    const root = freshRoot()
    const ns = 'ns-ac2-2'
    const { log } = makeRollFileLog({ rootDir: root, namespaceId: ns, targetRecordsPerSegment: 2 })
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    // 恰达 target：尚未滚（滚动发生在写入下一条 record 之前）
    expect(segmentEntries(root, ns, log.streamId)).toEqual(['00000001.jsonl'])
    // 下一条 → 滚动
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    expect(segmentEntries(root, ns, log.streamId)).toEqual(['00000001.jsonl', '00000002.jsonl'])
    const seg2 = readJsonl(join(streamPaths(root, ns, log.streamId).segmentsDir, '00000002.jsonl'))
    expect(seg2.map((r) => r.sequence)).toEqual(['3'])
  })

  it('§13.5b [护栏·绿] 未达 target → 不滚（边界反向）', () => {
    const root = freshRoot()
    const ns = 'ns-ac2-3'
    const { log } = makeRollFileLog({ rootDir: root, namespaceId: ns, targetRecordsPerSegment: 5 })
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    expect(segmentEntries(root, ns, log.streamId)).toEqual(['00000001.jsonl'])
  })

  it('§13.6 [红灯] 续写期滚动：A 滚出多段后 B 续写 → 新 record 依 §6.3 种子落段或滚入下一段', () => {
    const root = freshRoot()
    const ns = 'ns-ac2-4'
    const cfg = { targetRecordsPerSegment: 2 }
    const a = makeRollFileLog({ rootDir: root, namespaceId: ns, ...cfg })
    a.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    a.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    a.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } })) // seg2 = [3]

    const b = makeResumeLog(root, ns, cfg)
    b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } })) // seg2 = [3,4]
    b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } })) // → 滚入 seg3 = [5]

    const all = readAllSegments(root, ns, a.log.streamId)
    expect(all.map((r) => r.record.sequence)).toEqual(['1', '2', '3', '4', '5'])
    expect(all[3]!.segment).toBe('00000002')
    expect(all[4]!.segment).toBe('00000003')
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: a.log.streamId }).status).toBe('ok')
  })
})

// ============================================================================
// §13.7–§13.12 AC3 可证明尾部修复
// ============================================================================
describe('§13.7–12 AC3：三类可证明尾部修复（C1/C2/C3 + 种子）', () => {
  it('§13.7a [红灯] C1 不完整尾 JSONL 行 → 截到最后 \\n + stream-tail-repaired + 续写复用该号', () => {
    const root = freshRoot()
    const ns = 'ns-ac3-1'
    const line1 = JSON.stringify(validAttemptRecord(FX, '1')) + '\n'
    const partial = '  {"recordKind":"attempt","streamId":"' + FX.slice(0, 10)
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlText: line1 + partial,
      current: validCurrent(FX),
    })
    const b = makeResumeLog(root, ns)
    const repaired = eventsOfTypeRaw(b.events, 'stream-tail-repaired')
    expect(repaired).toHaveLength(1)
    expect(repaired[0]).toMatchObject({ type: 'stream-tail-repaired', repair: 'jsonl-incomplete-line' })
    expect(repaired[0]!.truncatedBytes).toBe(Buffer.byteLength(partial))

    const p = streamPaths(root, ns, FX)
    expect(readFileSync(p.jsonlPath, 'utf8')).toBe(line1)
    // 续写 sequence 复用被截断号（lastCommitted=1 → 下一条 '2'）
    b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    expect(readJsonl(p.jsonlPath).map((r) => r.sequence)).toEqual(['1', '2'])
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('ok')
  })

  it('§13.7b R1 变体 [红灯] J 全文无 0x0A（含「恰为合法 JSON」形）→ 截为 0 字节、lastCommitted=null、首条 seq=1', () => {
    const root = freshRoot()
    const ns = 'ns-ac3-2'
    // 单条 record 全文无换行且内容恰为合法 JSON（终止符证明不依赖 parse）
    const whole = JSON.stringify(validAttemptRecord(FX, '1'))
    expect(whole.includes('\n')).toBe(false)
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlText: whole,
      current: validCurrent(FX),
    })
    const p = streamPaths(root, ns, FX)
    const before = Buffer.byteLength(whole)
    const b = makeResumeLog(root, ns)
    const repaired = eventsOfTypeRaw(b.events, 'stream-tail-repaired')
    expect(repaired).toHaveLength(1)
    expect(repaired[0]).toMatchObject({ type: 'stream-tail-repaired', repair: 'jsonl-incomplete-line' })
    expect(repaired[0]!.truncatedBytes).toBe(before)
    expect(readJsonlBytes(p.jsonlPath).byteLength).toBe(0)
    // 退化形：无任何完整行 → lastCommittedSequence=null → 续写首条 sequence='1'
    b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    expect(readJsonl(p.jsonlPath).map((r) => r.sequence)).toEqual(['1'])
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('ok')
  })

  it('§13.8a [红灯] C2a bin 末尾 <25 字节残块 → bin-incomplete-frame 修复 + 链衔接续写', () => {
    const root = freshRoot()
    const ns = 'ns-ac3-3'
    const payload1 = patternedBytes(SIDE_PAYLOAD)
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlLines: [sidecarAttemptRecord(FX, '1', payload1)],
      bin: concatU8(encodeFrame(1, payload1), patternedBytes(10)),
      current: validCurrent(FX),
    })
    const b = makeResumeLog(root, ns)
    const repaired = eventsOfTypeRaw(b.events, 'stream-tail-repaired')
    expect(repaired).toHaveLength(1)
    expect(repaired[0]).toMatchObject({ type: 'stream-tail-repaired', repair: 'bin-incomplete-frame' })
    expect(repaired[0]!.truncatedBytes).toBe(10)
    const p = streamPaths(root, ns, FX)
    expect(readJsonlBytes(p.binPath).byteLength).toBe(FRAME_BYTES)
    // 续写：新帧 fresh-stat 落截断点（链衔接）
    b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(SIDE_PAYLOAD) } }))
    const rec2 = readJsonl(p.jsonlPath)[1]!
    const carrier2 = (rec2.result as { update: { storage: string; frameOffset: string } }).update
    expect(carrier2.storage).toBe('sidecar')
    expect(carrier2.frameOffset).toBe(String(FRAME_BYTES))
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('ok')
  })

  it('§13.8b [红灯] C2b 25 字节头合法 + payload 越界 → bin-incomplete-frame 修复', () => {
    const root = freshRoot()
    const ns = 'ns-ac3-4'
    const payload1 = patternedBytes(SIDE_PAYLOAD)
    // 第二帧头 payloadLength=100 但只有 50 字节 payload（撕裂帧）
    const tornHeader = encodeFrame(2, patternedBytes(100)).subarray(0, FRAME_HEADER_BYTES + 50)
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlLines: [sidecarAttemptRecord(FX, '1', payload1)],
      bin: concatU8(encodeFrame(1, payload1), tornHeader),
      current: validCurrent(FX),
    })
    const b = makeResumeLog(root, ns)
    const repaired = eventsOfTypeRaw(b.events, 'stream-tail-repaired')
    expect(repaired).toHaveLength(1)
    expect(repaired[0]).toMatchObject({ type: 'stream-tail-repaired', repair: 'bin-incomplete-frame' })
    expect(readJsonlBytes(streamPaths(root, ns, FX).binPath).byteLength).toBe(FRAME_BYTES)
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('ok')
  })

  it('§13.9 [红灯] C3 完整未引用尾部 orphan frames → bin-orphan-frames 修复；续写首帧 offset=截断点', () => {
    const root = freshRoot()
    const ns = 'ns-ac3-5'
    const payload1 = patternedBytes(SIDE_PAYLOAD)
    const p2 = patternedBytes(SIDE_PAYLOAD)
    const p3 = patternedBytes(SIDE_PAYLOAD)
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlLines: [sidecarAttemptRecord(FX, '1', payload1)],
      bin: concatU8(encodeFrame(1, payload1), encodeFrame(2, p2), encodeFrame(3, p3)),
      current: validCurrent(FX),
    })
    const b = makeResumeLog(root, ns)
    const repaired = eventsOfTypeRaw(b.events, 'stream-tail-repaired')
    expect(repaired).toHaveLength(1)
    expect(repaired[0]).toMatchObject({ type: 'stream-tail-repaired', repair: 'bin-orphan-frames' })
    expect(repaired[0]!.truncatedBytes).toBe(2 * FRAME_BYTES)
    const p = streamPaths(root, ns, FX)
    expect(readJsonlBytes(p.binPath).byteLength).toBe(FRAME_BYTES)
    // 续写首帧 offset = 截断点（链衔接——C3 是续写前置条件）
    b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(SIDE_PAYLOAD) } }))
    const rec2 = readJsonl(p.jsonlPath)[1]!
    const carrier2 = (rec2.result as { update: { segment: string; frameOffset: string } }).update
    expect(carrier2.segment).toBe('00000001')
    expect(carrier2.frameOffset).toBe(String(FRAME_BYTES))
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('ok')
  })

  it('§13.10 [红灯] C2+C3 混合（orphan 帧后接撕裂帧）→ 单次截断单事件（bin-incomplete-frame）', () => {
    const root = freshRoot()
    const ns = 'ns-ac3-6'
    const payload1 = patternedBytes(SIDE_PAYLOAD)
    const orphan = encodeFrame(2, patternedBytes(SIDE_PAYLOAD))
    const torn = patternedBytes(5) // < 25 字节：尾块不足 header → C2 终局证据
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlLines: [sidecarAttemptRecord(FX, '1', payload1)],
      bin: concatU8(encodeFrame(1, payload1), orphan, torn),
      current: validCurrent(FX),
    })
    const b = makeResumeLog(root, ns)
    const repaired = eventsOfTypeRaw(b.events, 'stream-tail-repaired')
    expect(repaired).toHaveLength(1)
    expect(repaired[0]).toMatchObject({ type: 'stream-tail-repaired', repair: 'bin-incomplete-frame' })
    expect(repaired[0]!.truncatedBytes).toBe(FRAME_BYTES + 5)
    expect(readJsonlBytes(streamPaths(root, ns, FX).binPath).byteLength).toBe(FRAME_BYTES)
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('ok')
  })

  it('§13.11 [红灯] C1+C2 并存 → 两事件两截断、各自修复', () => {
    const root = freshRoot()
    const ns = 'ns-ac3-7'
    const payload1 = patternedBytes(SIDE_PAYLOAD)
    const line1 = JSON.stringify(validAttemptRecord(FX, '1')) + '\n'
    const partial = '{"partial":'
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlText: line1 + partial,
      bin: concatU8(encodeFrame(1, payload1), patternedBytes(7)),
      current: validCurrent(FX),
    })
    const b = makeResumeLog(root, ns)
    const repaired = eventsOfTypeRaw(b.events, 'stream-tail-repaired')
    expect(repaired).toHaveLength(2)
    const kinds = repaired.map((r) => r.repair).sort()
    expect(kinds).toEqual(['bin-incomplete-frame', 'jsonl-incomplete-line'])
    const p = streamPaths(root, ns, FX)
    expect(readFileSync(p.jsonlPath, 'utf8')).toBe(line1)
    expect(readJsonlBytes(p.binPath).byteLength).toBe(FRAME_BYTES)
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('ok')
  })

  it('§13.12 [红灯] 修复后 reader ok 且 SegMax 计数种子正确（下一条 record 依 §6.3 落段）', () => {
    const root = freshRoot()
    const ns = 'ns-ac3-8'
    // 两 segment：seg1=[1]（闭段 1 ≥ target 1 ✓）；seg2（SegMax）=[2] + 撕裂 jsonl 尾 + 10B 垃圾 bin
    const line2 = JSON.stringify(validAttemptRecord(FX, '2')) + '\n'
    const partial = '{"t":'
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns, { targetRecordsPerSegment: 1 }),
      segments: [
        { segment: '00000001', jsonlLines: [validAttemptRecord(FX, '1')] },
        { segment: '00000002', jsonlText: line2 + partial, bin: patternedBytes(10) },
      ],
      current: validCurrent(FX),
    })
    const b = makeResumeLog(root, ns, { targetRecordsPerSegment: 1 })
    expect(eventsOfTypeRaw(b.events, 'stream-tail-repaired')).toHaveLength(2)
    // 种子推演：seg2 修复后恰 1 条 = target → B 首条 emit 滚入 00000003（若种子错 0 条 → 落 seg2）
    b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    const seg3 = readJsonl(join(streamPaths(root, ns, FX).segmentsDir, '00000003.jsonl'))
    expect(seg3.map((r) => r.sequence)).toEqual(['3'])
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('ok')
  })
})

// ============================================================================
// §13.13–§13.20 AC4 中间损坏不修复 + 确定性 rotate
// ============================================================================
describe('§13.13–20 AC4：中间损坏零修复 + 确定性 rotate（cause 封闭枚举）', () => {
  /** rotate 期望断言模板：恰一次 stream-generation-rotated{cause} + 新 streamId + current.json 指向新 stream。 */
  function expectRotated(
    b: AssembledFileLog,
    streamFixture: string,
    root: string,
    ns: string,
    cause: string,
  ): void {
    const rotated = eventsOfTypeRaw(b.events, 'stream-generation-rotated')
    expect(rotated).toHaveLength(1)
    expect(rotated[0]).toMatchObject({ type: 'stream-generation-rotated', cause })
    expect(b.log.streamId).not.toBe(streamFixture)
    expect(b.log.streamId).toMatch(/^log-[0-9a-f]{32}$/)
    // current.json 指向新 stream（rotate 后 initNewGeneration 的 locator 愈合）
    const current = readJson<Record<string, unknown>>(streamPaths(root, ns, b.log.streamId).currentPath)
    expect(current.streamId).toBe(b.log.streamId)
  }

  it('§13.13 [红灯] 中间坏 JSON 行 + 可修复尾巴 → 零修复 + stream-corrupt rotate + 新 gen genesis', () => {
    const root = freshRoot()
    const ns = 'ns-ac4-1'
    const line1 = JSON.stringify(validAttemptRecord(FX, '1')) + '\n'
    const badMiddle = '  {"broken": not-json }\n'
    const partial = '  {"partial":'
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlText: line1 + badMiddle + partial,
      current: validCurrent(FX),
    })
    const p = streamPaths(root, ns, FX)
    const jsonlBefore = readFileSync(p.jsonlPath)
    const manifestBefore = readFileSync(p.manifestPath)

    const b = makeResumeLog(root, ns, { genesisUpdateBytes: patternedBytes(50) })
    expectRotated(b, FX, root, ns, 'stream-corrupt')
    // 零修复：文件字节恒等、无 stream-tail-repaired 事件
    expect(readFileSync(p.jsonlPath).equals(jsonlBefore)).toBe(true)
    expect(readFileSync(p.manifestPath).equals(manifestBefore)).toBe(true)
    expect(eventsOfTypeRaw(b.events, 'stream-tail-repaired')).toHaveLength(0)
    // 新 generation 尽力 genesis
    const newRecords = readJsonl(streamPaths(root, ns, b.log.streamId).jsonlPath)
    expect(newRecords[0]!).toMatchObject({ recordKind: 'genesis-baseline', sequence: '1' })
    // 损坏如实可见（H：corrupt 类 ⇒ reader 非 ok）
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('corrupt')
  })

  it('§13.14a [红灯] 引用帧 CRC 翻位 → stream-corrupt rotate', () => {
    const root = freshRoot()
    const ns = 'ns-ac4-2'
    const payload1 = patternedBytes(SIDE_PAYLOAD)
    const frame = encodeFrame(1, payload1)
    frame[FRAME_HEADER_BYTES + 5] = frame[FRAME_HEADER_BYTES + 5]! ^ 0xff
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlLines: [sidecarAttemptRecord(FX, '1', payload1)],
      bin: frame,
      current: validCurrent(FX),
    })
    const p = streamPaths(root, ns, FX)
    const binBefore = readFileSync(p.binPath)
    const b = makeResumeLog(root, ns)
    expectRotated(b, FX, root, ns, 'stream-corrupt')
    expect(readFileSync(p.binPath).equals(binBefore)).toBe(true)
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('corrupt')
  })

  it('§13.14b [红灯] 引用 offset 越界 → stream-corrupt rotate', () => {
    const root = freshRoot()
    const ns = 'ns-ac4-3'
    const payload1 = patternedBytes(SIDE_PAYLOAD)
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlLines: [sidecarAttemptRecord(FX, '1', payload1, { frameOffset: '999999' })],
      bin: encodeFrame(1, payload1),
      current: validCurrent(FX),
    })
    const b = makeResumeLog(root, ns)
    expectRotated(b, FX, root, ns, 'stream-corrupt')
  })

  it('§13.14c [红灯] 引用不存在帧（.bin 缺失）→ stream-corrupt rotate', () => {
    const root = freshRoot()
    const ns = 'ns-ac4-4'
    const payload1 = patternedBytes(SIDE_PAYLOAD)
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlLines: [sidecarAttemptRecord(FX, '1', payload1)],
      current: validCurrent(FX),
    })
    const b = makeResumeLog(root, ns)
    expectRotated(b, FX, root, ns, 'stream-corrupt')
  })

  it('§13.15a [红灯] bin 中部 magic 垃圾尾（不可证撕裂）→ stream-corrupt rotate（不修复）', () => {
    const root = freshRoot()
    const ns = 'ns-ac4-5'
    const payload1 = patternedBytes(SIDE_PAYLOAD)
    const garbage = concatU8(new TextEncoder().encode('XXYY'), patternedBytes(200))
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlLines: [sidecarAttemptRecord(FX, '1', payload1)],
      bin: concatU8(encodeFrame(1, payload1), garbage),
      current: validCurrent(FX),
    })
    const p = streamPaths(root, ns, FX)
    const binBefore = readFileSync(p.binPath)
    const b = makeResumeLog(root, ns)
    expectRotated(b, FX, root, ns, 'stream-corrupt')
    expect(readFileSync(p.binPath).equals(binBefore)).toBe(true)
    expect(eventsOfTypeRaw(b.events, 'stream-tail-repaired')).toHaveLength(0)
  })

  it('§13.15b [红灯] 未知 frameVersion 尾块 → stream-incompatible rotate（ADR 不修复清单）', () => {
    const root = freshRoot()
    const ns = 'ns-ac4-6'
    const payload1 = patternedBytes(SIDE_PAYLOAD)
    const unknownVersion = encodeFrame(2, patternedBytes(100), { frameVersion: 2 })
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlLines: [sidecarAttemptRecord(FX, '1', payload1)],
      bin: concatU8(encodeFrame(1, payload1), unknownVersion),
      current: validCurrent(FX),
    })
    const p = streamPaths(root, ns, FX)
    const binBefore = readFileSync(p.binPath)
    const b = makeResumeLog(root, ns)
    expectRotated(b, FX, root, ns, 'stream-incompatible')
    expect(readFileSync(p.binPath).equals(binBefore)).toBe(true)
  })

  it('§13.16a [红灯] sequence-gap（删中间完整行）→ stream-corrupt rotate', () => {
    const root = freshRoot()
    const ns = 'ns-ac4-7'
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlLines: [validAttemptRecord(FX, '1'), validAttemptRecord(FX, '3')],
      current: validCurrent(FX),
    })
    const b = makeResumeLog(root, ns)
    expectRotated(b, FX, root, ns, 'stream-corrupt')
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('corrupt')
  })

  it('§13.16b [红灯] orphan 帧夹在被引用帧之间（链断）→ stream-corrupt rotate', () => {
    const root = freshRoot()
    const ns = 'ns-ac4-8'
    const payload1 = patternedBytes(SIDE_PAYLOAD)
    const payload2 = patternedBytes(SIDE_PAYLOAD)
    // bin = [ref1 seq1 @0..4122) + [orphan seq2 @4122..8244) + [ref2 seq2 @8244..12366)
    // jsonl: rec1→@0（end=4122），rec2→@8244 ≠ 链末端 4122 → frame-boundary-invalid（链中 orphan）
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlLines: [
        sidecarAttemptRecord(FX, '1', payload1),
        sidecarAttemptRecord(FX, '2', payload2, { frameOffset: String(2 * FRAME_BYTES) }),
      ],
      bin: concatU8(encodeFrame(1, payload1), encodeFrame(2, payload2), encodeFrame(2, payload2)),
      current: validCurrent(FX),
    })
    const b = makeResumeLog(root, ns)
    expectRotated(b, FX, root, ns, 'stream-corrupt')
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('corrupt')
  })

  it('§13.17a [红灯] 非 SegMax 段的未终止末行 → 不修复 → stream-corrupt rotate（后缀性质）', () => {
    const root = freshRoot()
    const ns = 'ns-ac4-9'
    const line1 = JSON.stringify(validAttemptRecord(FX, '1')) + '\n'
    const partial = '  {"t":'
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns, { targetRecordsPerSegment: 1 }),
      segments: [
        { segment: '00000001', jsonlText: line1 + partial },
        { segment: '00000002', jsonlLines: [validAttemptRecord(FX, '2')] },
      ],
      current: validCurrent(FX),
    })
    const p = streamPaths(root, ns, FX)
    const seg1Before = readFileSync(join(p.segmentsDir, '00000001.jsonl'))
    const b = makeResumeLog(root, ns, { targetRecordsPerSegment: 1 })
    expectRotated(b, FX, root, ns, 'stream-corrupt')
    // 零修复：非最大段的未终止末行原样保留
    expect(readFileSync(join(p.segmentsDir, '00000001.jsonl')).equals(seg1Before)).toBe(true)
    expect(eventsOfTypeRaw(b.events, 'stream-tail-repaired')).toHaveLength(0)
    // reader 同向：非最大段未终止末块 → line-unterminated
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('corrupt')
  })

  it('§13.17b [§5.4 裁决] 非 SegMax 段 bin 尾孤儿（闭段惰性残渣）→ 不修复、不损坏、健康 resume', () => {
    const root = freshRoot()
    const ns = 'ns-ac4-10'
    // seg1 = [rec1 sidecar@0 + 完整 orphan 尾帧（JSONL-definitive 缺口的产物）]；
    // seg2 = [rec2 inline]（SegMax）。闭段未引用尾字节 = 惰性残渣（设计 §5.4：不构成损坏）。
    const payload1 = patternedBytes(SIDE_PAYLOAD)
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns, { targetRecordsPerSegment: 1 }),
      segments: [
        {
          segment: '00000001',
          jsonlLines: [sidecarAttemptRecord(FX, '1', payload1)],
          bin: concatU8(encodeFrame(1, payload1), encodeFrame(2, patternedBytes(SIDE_PAYLOAD))),
        },
        { segment: '00000002', jsonlLines: [validAttemptRecord(FX, '2')] },
      ],
      current: validCurrent(FX),
    })
    const p = streamPaths(root, ns, FX)
    const seg1Before = readFileSync(join(p.segmentsDir, '00000001.bin'))
    const b = makeResumeLog(root, ns, { targetRecordsPerSegment: 1 })
    // 健康 resume（非 corrupt rotate）：同 stream 续写、零修复、闭段字节恒等
    expect(b.log.streamId).toBe(FX)
    expect(eventsOfTypeRaw(b.events, 'stream-generation-rotated')).toHaveLength(0)
    expect(eventsOfTypeRaw(b.events, 'stream-tail-repaired')).toHaveLength(0)
    expect(readFileSync(join(p.segmentsDir, '00000001.bin')).equals(seg1Before)).toBe(true)
    b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    expect(readAllSegments(root, ns, FX).map((r) => r.record.sequence)).toEqual(['1', '2', '3'])
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('ok')
  })

  it('§13.18a [红灯] 17 键篡改（schema.text 换）→ stream-incompatible rotate + 旧 manifest 字节恒等', () => {
    const root = freshRoot()
    const ns = 'ns-ac4-11'
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns, { schema: { lang: 'vfsl', version: 1, id: 'nomicore.namespace-diagnostic-change-record@1', text: 'tampered-text' } }),
      jsonlLines: [validAttemptRecord(FX, '1')],
      current: validCurrent(FX),
    })
    const p = streamPaths(root, ns, FX)
    const manifestBefore = readFileSync(p.manifestPath)
    const b = makeResumeLog(root, ns)
    expectRotated(b, FX, root, ns, 'stream-incompatible')
    expect(readFileSync(p.manifestPath).equals(manifestBefore)).toBe(true)
    // reader 同向：指纹不符 → incompatible（与分析同源判定）
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('incompatible')
  })

  it('§13.18b [红灯] 14 键健康 manifest → legacy-manifest rotate + 同流 reader 仍 ok（双形状正例）', () => {
    const root = freshRoot()
    const ns = 'ns-ac4-12'
    writeStreamFixture(root, ns, FX, {
      manifest: legacyManifest(FX, ns),
      jsonlLines: [validAttemptRecord(FX, '1')],
      current: validCurrent(FX),
    })
    const b = makeResumeLog(root, ns)
    const rotated = eventsOfTypeRaw(b.events, 'stream-generation-rotated')
    expect(rotated).toHaveLength(1)
    expect(rotated[0]).toMatchObject({ cause: 'legacy-manifest' })
    expect(b.log.streamId).not.toBe(FX)
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('ok')
  })

  it('§13.18c [红灯] 14 键篡改指纹 → stream-incompatible（不是 legacy-manifest；manifest 门 incompatible 判定先于 17 键要求）', () => {
    const root = freshRoot()
    const ns = 'ns-ac4-13'
    writeStreamFixture(root, ns, FX, {
      manifest: legacyManifest(FX, ns, {
        schema: { lang: 'vfsl', version: 1, id: 'nomicore.namespace-diagnostic-change-record@1', text: 'tampered-text' },
        schemaFingerprint: 'sha256:v1:' + '0'.repeat(64),
      }),
      jsonlLines: [validAttemptRecord(FX, '1')],
      current: validCurrent(FX),
    })
    const b = makeResumeLog(root, ns)
    const rotated = eventsOfTypeRaw(b.events, 'stream-generation-rotated')
    expect(rotated).toHaveLength(1)
    expect(rotated[0]).toMatchObject({ cause: 'stream-incompatible' })
    // 读能力保持：reader 对 14 键篡改指纹 → incompatible（与 #152 mismatch 夹具同向）
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('incompatible')
  })

  it('§13.19 [红灯] 14 键 legacy manifest + sidecar 帧 → legacy-manifest rotate；同文件 reader 可读（双形状正例）', () => {
    const root = freshRoot()
    const ns = 'ns-ac4-14'
    const payload1 = patternedBytes(SIDE_PAYLOAD)
    writeStreamFixture(root, ns, FX, {
      manifest: legacyManifest(FX, ns),
      jsonlLines: [sidecarAttemptRecord(FX, '1', payload1)],
      bin: encodeFrame(1, payload1),
      current: validCurrent(FX),
    })
    const b = makeResumeLog(root, ns)
    const rotated = eventsOfTypeRaw(b.events, 'stream-generation-rotated')
    expect(rotated).toHaveLength(1)
    expect(rotated[0]).toMatchObject({ cause: 'legacy-manifest' })
    const read = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX })
    expect(read.status).toBe('ok') // 读能力（双形状）≠ 续写能力（仅 17 键）
    expect(read.records).toHaveLength(1)
    expect(read.records[0]!.ok).toBe(true)
  })

  it('§13.20a [红灯] 冻结配置改变（roll target）→ frozen-policy-mismatch rotate + 新 manifest 携带新值', () => {
    const root = freshRoot()
    const ns = 'ns-ac4-15'
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns, { targetRecordsPerSegment: 2 }),
      jsonlLines: [validAttemptRecord(FX, '1')],
      current: validCurrent(FX),
    })
    const b = makeResumeLog(root, ns, { targetRecordsPerSegment: 3 })
    const rotated = eventsOfTypeRaw(b.events, 'stream-generation-rotated')
    expect(rotated).toHaveLength(1)
    expect(rotated[0]).toMatchObject({ cause: 'frozen-policy-mismatch' })
    const newManifest = readJson<Record<string, unknown>>(streamPaths(root, ns, b.log.streamId).manifestPath)
    expect(newManifest.targetRecordsPerSegment).toBe(3)
  })

  it('§13.20b [红灯] 冻结配置改变（capture/policy/inline 阈值/line 上限）→ 同 cause；新 manifest 携带新值', () => {
    const cases: Array<{ key: string; fixtures: Record<string, unknown>; config: Partial<FileDiagnosticLogConfig> & RollConfigKeys; manifestKey: string; newValue: unknown }> = [
      { key: 'updateCapture', fixtures: {}, config: { updateCapture: false }, manifestKey: 'committedUpdateCapture', newValue: false },
      { key: 'inputPolicy', fixtures: {}, config: { inputPolicy: 'none' }, manifestKey: 'inputCapturePolicy', newValue: 'none' },
      { key: 'inlineUpdateMaxBytes', fixtures: {}, config: { inlineUpdateMaxBytes: 8 }, manifestKey: 'inlineUpdateMaxBytes', newValue: 8 },
      { key: 'lineBudgetBytes', fixtures: {}, config: { lineBudgetBytes: 2048 }, manifestKey: 'jsonlLineLimitBytes', newValue: 2048 },
    ]
    for (const c of cases) {
      const root = freshRoot()
      const ns = `ns-ac4-16-${c.key}`
      writeStreamFixture(root, ns, FX, {
        manifest: validManifest(FX, ns, c.fixtures),
        jsonlLines: [validAttemptRecord(FX, '1')],
        current: validCurrent(FX),
      })
      const b = makeResumeLog(root, ns, c.config)
      const rotated = eventsOfTypeRaw(b.events, 'stream-generation-rotated')
      expect(rotated, `case ${c.key}`).toHaveLength(1)
      expect(rotated[0]!.cause, `case ${c.key}`).toBe('frozen-policy-mismatch')
      const newManifest = readJson<Record<string, unknown>>(streamPaths(root, ns, b.log.streamId).manifestPath)
      expect(newManifest[c.manifestKey], `case ${c.key}`).toBe(c.newValue)
    }
  })
})

// ============================================================================
// §13.21–§13.25 AC5 locator 解析/歧义/新鲜命名空间
// ============================================================================
describe('§13.21–25 AC5：locator 确定性解析与歧义处置', () => {
  it('§13.21 [红灯] current.json 损坏 JSON + 恰一 stream → 确定性恢复续写 + current.json 愈合', () => {
    const root = freshRoot()
    const ns = 'ns-ac5-1'
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlLines: [validAttemptRecord(FX, '1')],
      current: '{broken-json',
    })
    const b = makeResumeLog(root, ns)
    expect(b.log.streamId).toBe(FX)
    // locator 愈合：current.json 恢复为可重建 locator（format/version/streamId 三键）
    const current = readJson<Record<string, unknown>>(streamPaths(root, ns, FX).currentPath)
    expect(current.format).toBe('ndcl-current')
    expect(current.version).toBe(1)
    expect(current.streamId).toBe(FX)
    b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    expect(readJsonl(streamPaths(root, ns, FX).jsonlPath).map((r) => r.sequence)).toEqual(['1', '2'])
  })

  it('§13.22 [红灯] current.json 缺失 + 2 个 manifest-bearing stream → disabled + locator-ambiguous + 零文件写入', () => {
    const root = freshRoot()
    const ns = 'ns-ac5-2'
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlLines: [validAttemptRecord(FX, '1')],
    })
    writeStreamFixture(root, ns, FX2, {
      manifest: validManifest(FX2, ns),
      jsonlLines: [validAttemptRecord(FX2, '1')],
    })
    const filesBefore = countFilesRecursive(root)

    const b = makeResumeLog(root, ns)
    const initFailed = eventsOfTypeRaw(b.events, 'stream-init-failed')
    expect(initFailed).toHaveLength(1)
    expect(initFailed[0]).toMatchObject({ code: 'LOG_STREAM_INIT_FAILED', reason: 'locator-ambiguous' })
    expect(eventsOfTypeRaw(b.events, 'stream-generation-rotated')).toHaveLength(0)
    // 零文件写入（含 current.json）——歧义终态不创建任何新文件
    expect(countFilesRecursive(root)).toBe(filesBefore)
    expect(() => b.log.emitter.emit(baseEmission())).not.toThrow()
  })

  it('§13.23a [红灯] current.json 指向不存在 stream + 恰一候选 → 恢复该候选', () => {
    const root = freshRoot()
    const ns = 'ns-ac5-3'
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlLines: [validAttemptRecord(FX, '1')],
      current: validCurrent('log-ffffffffffffffffffffffffffffffff'),
    })
    const b = makeResumeLog(root, ns)
    expect(b.log.streamId).toBe(FX)
    b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    expect(readJsonl(streamPaths(root, ns, FX).jsonlPath).map((r) => r.sequence)).toEqual(['1', '2'])
  })

  it('§13.23b [红灯] current.json 指向不存在 stream + ≥2 候选 → disabled + locator-ambiguous（零猜测）', () => {
    const root = freshRoot()
    const ns = 'ns-ac5-4'
    writeStreamFixture(root, ns, FX, { manifest: validManifest(FX, ns), jsonlLines: [validAttemptRecord(FX, '1')] })
    writeStreamFixture(root, ns, FX2, { manifest: validManifest(FX2, ns), jsonlLines: [validAttemptRecord(FX2, '1')] })
    // 注入 current.json 指向不存在的第三个 stream（写入计入 filesBefore 后）
    const p = streamPaths(root, ns, FX)
    writeFileSync(p.currentPath, JSON.stringify(validCurrent('log-ffffffffffffffffffffffffffffffff')))
    const filesBefore = countFilesRecursive(root)

    const b = makeResumeLog(root, ns)
    const initFailed = eventsOfTypeRaw(b.events, 'stream-init-failed')
    expect(initFailed).toHaveLength(1)
    expect(initFailed[0]).toMatchObject({ code: 'LOG_STREAM_INIT_FAILED', reason: 'locator-ambiguous' })
    expect(eventsOfTypeRaw(b.events, 'stream-generation-rotated')).toHaveLength(0)
    // 零新增文件：歧义终态不创建任何新 stream / 不写 current.json
    expect(countFilesRecursive(root)).toBe(filesBefore)
    expect(() => b.log.emitter.emit(baseEmission())).not.toThrow()
  })

  it('§13.24 [红灯] 显式 resumeStreamId 目标 manifest 缺失 → rotate manifest-missing（不回退 locator）', () => {
    const root = freshRoot()
    const ns = 'ns-ac5-5'
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlLines: [validAttemptRecord(FX, '1')],
      current: validCurrent(FX),
    })
    const p = streamPaths(root, ns, FX)
    const oldJsonl = readFileSync(p.jsonlPath)
    const missing = 'log-cccccccccccccccccccccccccccccccc'
    const b = makeResumeLog(root, ns, { resumeStreamId: missing })
    const rotated = eventsOfTypeRaw(b.events, 'stream-generation-rotated')
    expect(rotated).toHaveLength(1)
    expect(rotated[0]).toMatchObject({ cause: 'manifest-missing' })
    expect(b.log.streamId).not.toBe(FX)
    expect(b.log.streamId).not.toBe(missing)
    // 不回退 locator：fixture 流未被续写/改写
    expect(readFileSync(p.jsonlPath).equals(oldJsonl)).toBe(true)
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('ok')
  })

  it('§13.25 [护栏·绿] 空命名空间 → fresh 新 generation、无 rotate 事件', () => {
    const root = freshRoot()
    const ns = 'ns-ac5-6'
    const { log, events } = makeRollFileLog({ rootDir: root, namespaceId: ns })
    expect(eventsOfTypeRaw(events, 'stream-generation-rotated')).toHaveLength(0)
    expect(eventsOfType(events, 'stream-init-failed')).toHaveLength(0)
    expect(log.streamId).toMatch(/^log-[0-9a-f]{32}$/)
    expect(readdirSync(streamPaths(root, ns, log.streamId).segmentsDir)).toEqual([])
  })
})

// ============================================================================
// §13.26–§13.28 双耗尽 + 无效 targets 配置门
// ============================================================================
describe('§13.26–28：segment/sequence 耗尽与 invalid-roll-targets 配置门', () => {
  it('§13.26a [红灯] reopen 已耗尽 stream（SegMax=99999999 且达标）→ 构造期恰一次 stream-exhausted', () => {
    const root = freshRoot()
    const ns = 'ns-exh-1'
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns, { targetJsonlSegmentBytes: 1, targetBinSegmentBytes: 1, targetRecordsPerSegment: 1 }),
      segments: [{ segment: '99999999', jsonlLines: [validAttemptRecord(FX, '1')] }],
      current: validCurrent(FX),
    })
    const p = streamPaths(root, ns, FX)
    const jsonlBefore = readFileSync(join(p.segmentsDir, '99999999.jsonl'))
    const cfg = { targetJsonlSegmentBytes: 1, targetBinSegmentBytes: 1, targetRecordsPerSegment: 1 }
    const b = makeResumeLog(root, ns, cfg)
    // 构造期恰一次 exhausted（latch 守卫）；后续 emit 静默丢弃、零文件变化、无新段
    expect(eventsOfTypeRaw(b.events, 'stream-exhausted')).toHaveLength(1)
    expect(eventsOfTypeRaw(b.events, 'stream-generation-rotated')).toHaveLength(0)
    b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    expect(readFileSync(join(p.segmentsDir, '99999999.jsonl')).equals(jsonlBefore)).toBe(true)
    expect(segmentEntries(root, ns, FX)).toEqual(['99999999.jsonl'])
  })

  it('§13.26b [红灯] segment 99999999 滚动溢出（emit 触发）→ 恰一次 exhausted + 触发 record 丢弃 + 无新段', () => {
    const root = freshRoot()
    const ns = 'ns-exh-2'
    // 99999999.jsonl 空文件（0 records）→ 未达 exhaustedAtOpen；首条 emit 落盘、次条触发耗尽
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns, { targetJsonlSegmentBytes: 1, targetBinSegmentBytes: 1, targetRecordsPerSegment: 1 }),
      segments: [{ segment: '99999999', jsonlText: '' }],
      current: validCurrent(FX),
    })
    const p = streamPaths(root, ns, FX)
    const cfg = { targetJsonlSegmentBytes: 1, targetBinSegmentBytes: 1, targetRecordsPerSegment: 1 }
    const b = makeResumeLog(root, ns, cfg)
    expect(eventsOfTypeRaw(b.events, 'stream-exhausted')).toHaveLength(0) // 构造期未耗尽
    b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    expect(readJsonl(join(p.segmentsDir, '99999999.jsonl')).map((r) => r.sequence)).toEqual(['1'])
    // 次条：计数器已达任一 target 且 currentSegment=99999999 → 溢出 → 丢弃 + 恰一次事件
    b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    expect(readJsonl(join(p.segmentsDir, '99999999.jsonl')).map((r) => r.sequence)).toEqual(['1'])
    expect(eventsOfTypeRaw(b.events, 'stream-exhausted')).toHaveLength(1)
    expect(segmentEntries(root, ns, FX)).toEqual(['99999999.jsonl'])
  })

  it('§13.27 [回归锚] sequence uint64 耗尽：preset=max-1 → 首条 committed 至 max + 恰一次事件、次条丢弃', () => {
    const root = freshRoot()
    const ns = 'ns-exh-3'
    const MAX = '18446744073709551615'
    const log = createFileDiagnosticLogPresetSequence(
      { rootDir: root, namespaceId: ns, updateCapture: true } as FileDiagnosticLogConfig,
      '18446744073709551614',
    )
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    const records = readJsonl(streamPaths(root, ns, log.streamId).jsonlPath)
    expect(records.map((r) => r.sequence)).toEqual([MAX])
  })

  it('§13.28 [红灯] 非法 roll targets（0/1.5/负数/2^53）→ disabled + invalid-roll-targets + 零文件', () => {
    const invalidValues = [0, 1.5, -1, 2 ** 53]
    const keys = ['targetJsonlSegmentBytes', 'targetBinSegmentBytes', 'targetRecordsPerSegment'] as const
    let cases = 0
    for (const key of keys) {
      for (const value of invalidValues) {
        const root = freshRoot()
        const ns = `ns-exh-4-${cases}`
        const b = makeRollFileLog({ rootDir: root, namespaceId: ns, [key]: value } as Partial<FileDiagnosticLogConfig> & RollConfigKeys)
        const initFailed = eventsOfTypeRaw(b.events, 'stream-init-failed')
        expect(initFailed, `${key}=${value}`).toHaveLength(1)
        expect(initFailed[0], `${key}=${value}`).toMatchObject({ code: 'LOG_STREAM_INIT_FAILED', reason: 'invalid-roll-targets' })
        expect(countFilesRecursive(root), `${key}=${value}`).toBe(0)
        cases += 1
      }
    }
  })
})

// ============================================================================
// §13.29 崩溃窗口重启矩阵（AC5 逐字：BIN-before-JSONL 全窗）
// ============================================================================
describe('§13.29 AC5：BIN-before-JSONL 崩溃窗口重启矩阵（修复或健康续写，reader 终态 ok）', () => {
  it('窗口1 完整 orphan 帧 + jsonl ENOENT → bin-orphan-frames 修复 + 健康续写', () => {
    const root = freshRoot()
    const ns = 'ns-window-1'
    const payload1 = patternedBytes(SIDE_PAYLOAD)
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      bin: encodeFrame(1, payload1), // 有 bin 无 jsonl：BIN-first 崩溃窗口（.jsonl 从未创建）
      current: validCurrent(FX),
    })
    const b = makeResumeLog(root, ns)
    const repaired = eventsOfTypeRaw(b.events, 'stream-tail-repaired')
    expect(repaired).toHaveLength(1)
    expect(repaired[0]).toMatchObject({ repair: 'bin-orphan-frames' })
    expect(b.log.streamId).toBe(FX)
    b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    expect(readJsonl(streamPaths(root, ns, FX).jsonlPath).map((r) => r.sequence)).toEqual(['1'])
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('ok')
  })

  it('窗口2 撕裂帧（<25B 残块）+ jsonl ENOENT → bin-incomplete-frame 修复 + 健康续写', () => {
    const root = freshRoot()
    const ns = 'ns-window-2'
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      bin: patternedBytes(10),
      current: validCurrent(FX),
    })
    const b = makeResumeLog(root, ns)
    const repaired = eventsOfTypeRaw(b.events, 'stream-tail-repaired')
    expect(repaired).toHaveLength(1)
    expect(repaired[0]).toMatchObject({ repair: 'bin-incomplete-frame' })
    expect(b.log.streamId).toBe(FX)
    b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    expect(readJsonl(streamPaths(root, ns, FX).jsonlPath).map((r) => r.sequence)).toEqual(['1'])
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('ok')
  })

  it('窗口3 帧完整 + 行撕裂（部分 JSONL 行）→ C1 + C3 双修复 + 健康续写', () => {
    const root = freshRoot()
    const ns = 'ns-window-3'
    const payload1 = patternedBytes(SIDE_PAYLOAD)
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlText: '  {"recordKind":"attempt","streamId":"' + FX.slice(0, 10),
      bin: encodeFrame(1, payload1),
      current: validCurrent(FX),
    })
    const b = makeResumeLog(root, ns)
    const repaired = eventsOfTypeRaw(b.events, 'stream-tail-repaired')
    expect(repaired).toHaveLength(2)
    const kinds = repaired.map((r) => r.repair).sort()
    expect(kinds).toEqual(['bin-orphan-frames', 'jsonl-incomplete-line'])
    b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    expect(readJsonl(streamPaths(root, ns, FX).jsonlPath).map((r) => r.sequence)).toEqual(['1'])
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('ok')
  })

  it('窗口4 行完整 + 帧完整 → 零修复、健康续写（reader 终态 ok）', () => {
    const root = freshRoot()
    const ns = 'ns-window-4'
    const payload1 = patternedBytes(SIDE_PAYLOAD)
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlLines: [sidecarAttemptRecord(FX, '1', payload1)],
      bin: encodeFrame(1, payload1),
      current: validCurrent(FX),
    })
    const b = makeResumeLog(root, ns)
    expect(eventsOfTypeRaw(b.events, 'stream-tail-repaired')).toHaveLength(0)
    expect(b.log.streamId).toBe(FX)
    b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    expect(readJsonl(streamPaths(root, ns, FX).jsonlPath).map((r) => r.sequence)).toEqual(['1', '2'])
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('ok')
  })
})

// ============================================================================
// §13.31–§13.33 R1 新增锚（SA2 #1/#3/#4）
// ============================================================================
describe('§13.31–33 R1 新增锚：链中 orphan 生命周期 / 不可读≠缺失 / locator 愈合失败', () => {
  it('§13.31 [核心红灯] writer 自产链中 orphan 全生命周期：注入→复用续写→reader corrupt→重启 corrupt rotate', () => {
    const root = freshRoot()
    const ns = 'ns-r1-31'
    const cfg = { targetJsonlSegmentBytes: 100000, targetBinSegmentBytes: 100000, targetRecordsPerSegment: 100 }
    const a = makeRollFileLog({ rootDir: root, namespaceId: ns, ...cfg })
    const p = streamPaths(root, ns, a.log.streamId)

    // ① sidecar emit → ref1 落 bin [0..4122)，committed
    a.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(SIDE_PAYLOAD) } }))
    expect(readJsonl(p.jsonlPath).map((r) => r.sequence)).toEqual(['1'])

    // ② jsonl 路径换目录占位（open 期 EISDIR=definitive）→ sidecar emit → orphan 落 [4122..8244)
    renameSync(p.jsonlPath, `${p.jsonlPath}.bak`)
    mkdirSync(p.jsonlPath, { recursive: true })
    a.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(SIDE_PAYLOAD) } }))
    expect(
      eventsOfTypeRaw(a.events, 'storage-write-failed').some((e) => e.stage === 'jsonl' && e.code === 'EISDIR'),
    ).toBe(true)

    // ③ 还原 jsonl → sidecar emit（candidate 复用 seq 2；fresh-stat 跳过 orphan → 新帧落 [8244..12366)）
    rmdirSync(p.jsonlPath)
    renameSync(`${p.jsonlPath}.bak`, p.jsonlPath)
    a.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(SIDE_PAYLOAD) } }))
    const rec2 = readJsonl(p.jsonlPath)[1]!
    expect(rec2.sequence).toBe('2')
    const carrier2 = (rec2.result as { update: { frameOffset: string } }).update
    expect(carrier2.frameOffset).toBe(String(2 * FRAME_BYTES))

    // ④ 进程内 reader：链断终态实证（ref1 end=4122 ≠ ref2 offset=8244）
    const read = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: a.log.streamId })
    expect(read.status).toBe('corrupt')
    expect(read.issues.some((i) => i.code === 'frame-boundary-invalid')).toBe(true)

    // ⑤ 同 root 同配置重启构造 B → 恰一次 stream-generation-rotated{cause:stream-corrupt} + 新 streamId
    //    + 旧 segments/manifest 字节恒等 + B emit 落新 generation（旧历史永久只读、无数据丢失）
    const pA = streamPaths(root, ns, a.log.streamId)
    const jsonlBefore = readFileSync(pA.jsonlPath)
    const binBefore = readFileSync(pA.binPath)
    const manifestBefore = readFileSync(pA.manifestPath)
    const b = makeResumeLog(root, ns, cfg)
    const rotated = eventsOfTypeRaw(b.events, 'stream-generation-rotated')
    expect(rotated).toHaveLength(1)
    expect(rotated[0]).toMatchObject({ cause: 'stream-corrupt' })
    expect(b.log.streamId).not.toBe(a.log.streamId)
    expect(readFileSync(pA.jsonlPath).equals(jsonlBefore)).toBe(true)
    expect(readFileSync(pA.binPath).equals(binBefore)).toBe(true)
    expect(readFileSync(pA.manifestPath).equals(manifestBefore)).toBe(true)
    b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    expect(readJsonl(streamPaths(root, ns, b.log.streamId).jsonlPath)).toHaveLength(1)
  })

  it('§13.32a [红灯] SegMax .jsonl 目录占位（EISDIR，不可读≠缺失）→ stream-corrupt rotate', () => {
    const root = freshRoot()
    const ns = 'ns-r1-32a'
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlLines: [validAttemptRecord(FX, '1')],
      current: validCurrent(FX),
    })
    const p = streamPaths(root, ns, FX)
    rmSync(p.jsonlPath, { recursive: true, force: true })
    mkdirSync(p.jsonlPath, { recursive: true })
    const b = makeResumeLog(root, ns)
    const rotated = eventsOfTypeRaw(b.events, 'stream-generation-rotated')
    expect(rotated).toHaveLength(1)
    expect(rotated[0]).toMatchObject({ cause: 'stream-corrupt' })
    // 绝不「按空文件健康续写」：不同 streamId（rotate 而非 resume）
    expect(b.log.streamId).not.toBe(FX)
    expect(eventsOfTypeRaw(b.events, 'stream-tail-repaired')).toHaveLength(0)
    expect(statSync(p.jsonlPath).isDirectory()).toBe(true)
  })

  it('§13.32b [红灯] SegMax .bin chmod 000（不可读、无引用）→ 保守 stream-corrupt rotate（不跳过续写）', () => {
    const root = freshRoot()
    const ns = 'ns-r1-32b'
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlLines: [validAttemptRecord(FX, '1')],
      bin: new Uint8Array(0), // .bin 存在（无引用）
      current: validCurrent(FX),
    })
    const p = streamPaths(root, ns, FX)
    chmodSync(p.binPath, 0o000)
    const b = makeResumeLog(root, ns)
    const rotated = eventsOfTypeRaw(b.events, 'stream-generation-rotated')
    expect(rotated).toHaveLength(1)
    expect(rotated[0]).toMatchObject({ cause: 'stream-corrupt' })
    expect(b.log.streamId).not.toBe(FX)
    expect(statSync(p.binPath).mode & 0o777).toBe(0)
  })

  it('§13.32c [对照] SegMax .jsonl ENOENT + bin 完整帧 → C3 修复/健康续写（ENOENT 豁免不被 32a 波及）', () => {
    const root = freshRoot()
    const ns = 'ns-r1-32c'
    const payload1 = patternedBytes(SIDE_PAYLOAD)
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      bin: encodeFrame(1, payload1), // 无 .jsonl 文件（BIN-first 窗口）
      current: validCurrent(FX),
    })
    const b = makeResumeLog(root, ns)
    expect(eventsOfTypeRaw(b.events, 'stream-generation-rotated')).toHaveLength(0)
    expect(b.log.streamId).toBe(FX)
    expect(eventsOfTypeRaw(b.events, 'stream-tail-repaired')).toHaveLength(1)
    b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    expect(readJsonl(streamPaths(root, ns, FX).jsonlPath).map((r) => r.sequence)).toEqual(['1'])
  })

  it('§13.33 [红灯] resume 成功路径 current.json 写入失败 → storage-write-failed{stage:current} + 续写不受影响；再重启仍确定性恢复', () => {
    const root = freshRoot()
    const ns = 'ns-r1-33'
    writeStreamFixture(root, ns, FX, {
      manifest: validManifest(FX, ns),
      jsonlLines: [validAttemptRecord(FX, '1')],
      current: validCurrent(FX),
    })
    const p = streamPaths(root, ns, FX)
    // 注入：current.json.tmp 被目录占位（writeCurrent 的 temp+rename 首步即 EISDIR）
    mkdirSync(join(p.namespaceDir, 'current.json.tmp'), { recursive: true })
    const b = makeResumeLog(root, ns)
    expect(
      eventsOfTypeRaw(b.events, 'storage-write-failed').some((e) => e.stage === 'current'),
    ).toBe(true)
    // resume 不受影响：同一 stream 续写、sequence 照常推进
    expect(b.log.streamId).toBe(FX)
    b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    expect(readJsonl(p.jsonlPath).map((r) => r.sequence)).toEqual(['1', '2'])
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('ok')

    // 清除注入后再重启一次 → 仍经 locator 确定性恢复同一 stream（不落 locator-ambiguous）
    rmSync(join(p.namespaceDir, 'current.json.tmp'), { recursive: true, force: true })
    const c = makeResumeLog(root, ns)
    expect(eventsOfTypeRaw(c.events, 'stream-init-failed').some((e) => e.reason === 'locator-ambiguous')).toBe(false)
    expect(c.log.streamId).toBe(FX)
    c.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    expect(readJsonl(p.jsonlPath).map((r) => r.sequence)).toEqual(['1', '2', '3'])
  })
})

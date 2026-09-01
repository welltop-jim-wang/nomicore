/**
 * 红灯契约 — Issue #154（SA6 编写）：保留历史报告 / reader-reopen 兼容（AC-5 + R1/R2 验收化）。
 *
 * 权威契约：`wiki/raw/task_issue-154_sa2_design.md` §2.5（StrictStreamRead 增量两字段）、
 * §7.1（historyTrimmed ⇔ 枚举最低段 ≠ '00000001'；锚 null 重定基；`false` 时逐字节等同现状）、
 * §7.4（全裁剪收敛：resume 空流 seq 1——备案钉死）、§7.5（resume 双侧锚容差：防 rotate 风暴）、
 * §9 T-E1–T-E7。ADR 0012 §Retention（earliest retained sequence 扫描重建）。
 *
 * 红灯性拆分：
 * - T-E1 / T-E4 / T-E7：行为红（当前实现缺 trim 报告/sweep ⇒ corrupt 或 TypeError）；
 * - T-E2 / T-E3 / T-E5 / T-E6：回归护锚（现行为已是契约目标——`historyTrimmed === false`
 *   字段断言在 src 类型面加字段前 = 值差红，SA3 后转绿；防「把中洞/单段>1 误当 trim」漂移）。
 * 全部断言针对运行时产物（reader 返回、事件、磁盘、sequence 续接）——零源码文本断言。
 */
import { existsSync, rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { readStreamStrict } from '../src/index.js'
import type { FileDiagnosticLogConfig } from '../src/index.js'
import { baseEmission } from './helpers/base.js'
import {
  eventsOfTypeRaw,
  makeFileLog,
  makeTempRoot,
  patternedBytes,
  readAllSegmentRecords,
  rmTempRoot,
  segmentEntriesOf,
  segmentPathsOf,
  validAttemptRecord,
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

const T0 = Date.parse('2026-08-28T12:00:00.000Z')
const SIDE = 100
const INLINE_T = 64
const FIX = 'log-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function makeWriter(root: string, ns: string, extra: Record<string, unknown> = {}): AssembledFileLog {
  return makeFileLog({
    rootDir: root,
    namespaceId: ns,
    updateCapture: true,
    targetRecordsPerSegment: 1,
    inlineUpdateMaxBytes: INLINE_T,
    clock: { now: () => T0 },
    ...extra,
  } as unknown as Partial<FileDiagnosticLogConfig>)
}

function emit(log: AssembledFileLog): void {
  log.log.emitter.emit(
    baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(SIDE) } }),
  )
}

/** 三组构造（段1、2 闭 / 段3 开）。 */
function buildThreeGroups(root: string, ns: string, extra: Record<string, unknown> = {}): AssembledFileLog {
  const log = makeWriter(root, ns, extra)
  emit(log)
  emit(log)
  emit(log)
  return log
}

// ============================================================================
// T-E：裁剪历史报告与 reader/reopen 兼容
// ============================================================================
describe('T-E 保留历史报告（AC-5）', () => {
  it('T-E1 [红灯] trim 报告：最低段=00000002 流 ⇒ ok + historyTrimmed + earliestRetainedSequence + 无 sequence-gap', () => {
    const root = freshRoot()
    const ns = 'ns-e1'
    writeStreamFixture(root, ns, FIX, {
      manifest: validManifest(FIX, ns, { targetRecordsPerSegment: 1 }),
      segments: [
        { segment: '00000002', jsonlLines: [validAttemptRecord(FIX, '2')] },
        { segment: '00000003', jsonlLines: [validAttemptRecord(FIX, '3')] },
      ],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FIX })
    expect(read.status).toBe('ok') // 裁前缀 ≠ 损坏（现状 = corrupt/gap → 红）
    expect(read.issues.some((i) => i.code === 'sequence-gap')).toBe(false)
    expect(read.historyTrimmed).toBe(true)
    expect(read.earliestRetainedSequence).toBe('2')
    expect(read.records.map((r) => r.sequence)).toEqual(['2', '3'])
    expect(read.records.every((r) => r.ok)).toBe(true)
  })

  it('T-E2 [护锚] 中洞仍腐：段 1、3 在、段 2 无 ⇒ corrupt + sequence-gap 保持；historyTrimmed===false', () => {
    const root = freshRoot()
    const ns = 'ns-e2'
    writeStreamFixture(root, ns, FIX, {
      manifest: validManifest(FIX, ns, { targetRecordsPerSegment: 1 }),
      segments: [
        { segment: '00000001', jsonlLines: [validAttemptRecord(FIX, '1')] },
        { segment: '00000003', jsonlLines: [validAttemptRecord(FIX, '3')] },
      ],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FIX })
    expect(read.status).toBe('corrupt')
    expect(read.issues.some((i) => i.code === 'sequence-gap')).toBe(true)
    expect(read.historyTrimmed).toBe(false) // 最低段 = 00000001 ⇒ 结构性非裁剪（§7.1-E 分界锚）
  })

  it('T-E3 [护锚] 单段首 record >1 仍腐（钉死复刻）：historyTrimmed===false + sequence-gap（组内缺失 ≠ 裁剪）', () => {
    const root = freshRoot()
    const ns = 'ns-e3'
    writeStreamFixture(root, ns, FIX, {
      manifest: validManifest(FIX, ns, { targetRecordsPerSegment: 1 }),
      segments: [{ segment: '00000001', jsonlLines: [validAttemptRecord(FIX, '2')] }],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FIX })
    expect(read.status).toBe('corrupt')
    expect(read.issues.some((i) => i.code === 'sequence-gap')).toBe(true)
    expect(read.historyTrimmed).toBe(false) // 最低段仍 = 00000001 ⇒ 真损坏
  })

  it('T-E4 [红灯] resume-after-trim（0/0 删前缀后重开）：同 streamId、无 rotate；续写 sequence=4 落段 00000004', () => {
    const root = freshRoot()
    const ns = 'ns-e4'
    const a = buildThreeGroups(root, ns, { retention: { maxAgeMs: 0, maxBytesPerNamespace: 0, sweepOnOpen: false } })
    const del = a.log.sweepRetention({ now: T0 })
    expect(del.deletedGroups).toBe(2) // 0/0：尽删闭组（段1、2）
    expect(segmentEntriesOf(root, ns, a.log.streamId)).toEqual(['00000003.bin', '00000003.jsonl'])
    // 重开（locator 三分支）——resume 容差：最低段 ≠ 00000001 ⇒ 锚重定基，绝不 rotate
    const b = makeWriter(root, ns, { retention: { maxAgeMs: 0, maxBytesPerNamespace: 0, sweepOnOpen: false } })
    expect(b.log.streamId).toBe(a.log.streamId)
    expect(eventsOfTypeRaw(b.events, 'stream-generation-rotated')).toHaveLength(0)
    emit(b) // 段3 已 1 条 ≥ target 1 → 滚出 00000004
    const records = readAllSegmentRecords(root, ns, a.log.streamId)
    expect(records.map((r) => r.record.sequence)).toEqual(['3', '4'])
    expect(records[records.length - 1]!.segment).toBe('00000004')
  })

  it('T-E5 [护锚] resume-after-middle-loss 仍 rotate（复刻 §13.16a 语义不回归）', () => {
    const root = freshRoot()
    const ns = 'ns-e5'
    writeStreamFixture(root, ns, FIX, {
      manifest: validManifest(FIX, ns, { targetRecordsPerSegment: 1 }),
      current: true,
      segments: [
        { segment: '00000001', jsonlLines: [validAttemptRecord(FIX, '1')] },
        { segment: '00000003', jsonlLines: [validAttemptRecord(FIX, '3')] },
      ],
    })
    const b = makeFileLog({
      rootDir: root,
      namespaceId: ns,
      updateCapture: true,
      targetRecordsPerSegment: 1,
      clock: { now: () => T0 },
    } as unknown as Partial<FileDiagnosticLogConfig>)
    expect(b.log.streamId).not.toBe(FIX) // 中洞 = 真损坏 → 确定性 rotate（与 trim 可区分）
    const rotated = eventsOfTypeRaw(b.events, 'stream-generation-rotated')
    expect(rotated).toHaveLength(1)
    expect((rotated[0] as { cause: string }).cause).toBe('stream-corrupt')
  })

  it('T-E6 [护锚] 全裁剪收敛：闭组删尽 + 仅开组零记录 ⇒ 重开 resume 空流 seq 1（§7.4 备案钉死）', () => {
    const root = freshRoot()
    const ns = 'ns-e6'
    // 合成收敛态：manifest + current + 空 segments 目录（=「manifest 落盘后首 record 前崩溃」同构）
    writeStreamFixture(root, ns, FIX, { manifest: validManifest(FIX, ns), current: true, segments: [] })
    const b = makeFileLog({ rootDir: root, namespaceId: ns, updateCapture: true, clock: { now: () => T0 } })
    expect(b.log.streamId).toBe(FIX)
    emit(b)
    const records = readAllSegmentRecords(root, ns, FIX)
    expect(records.map((r) => r.record.sequence)).toEqual(['1'])
  })

  it('T-E7 [红灯] orphan 清理：闭组 bin-无-jsonl-无-marker ⇒ 清；开组同形异态 ⇒ 不清（INV-1）', () => {
    const root = freshRoot()
    const ns = 'ns-e7'
    const a = makeWriter(root, ns, { retention: { maxAgeMs: null, maxBytesPerNamespace: null, sweepOnOpen: false } })
    emit(a)
    emit(a) // seg1 [1] 闭、seg2 [2] 开
    // 闭组 orphan：删 seg1 的 jsonl（无 .deleting——真 orphan；bin 留置）
    rmSync(segmentPathsOf(root, ns, a.log.streamId, '00000001').jsonlPath, { force: true })
    const report = a.log.sweepRetention({ now: T0 + 10_000_000 })
    expect(report.orphanBinsDeleted).toBe(1)
    expect(existsSync(segmentPathsOf(root, ns, a.log.streamId, '00000001').binPath)).toBe(false) // bin 已清
    // 开组（段2）jsonl+bin 原样（绝不清活态）
    expect(existsSync(segmentPathsOf(root, ns, a.log.streamId, '00000002').jsonlPath)).toBe(true)
    expect(existsSync(segmentPathsOf(root, ns, a.log.streamId, '00000002').binPath)).toBe(true)
  })
})

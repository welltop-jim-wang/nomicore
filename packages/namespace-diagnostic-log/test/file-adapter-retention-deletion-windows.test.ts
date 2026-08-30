/**
 * 红灯契约 — Issue #154（SA6 编写）：组删除协议中断矩阵（SA2 §6.1 W0–W3 + T20 + T-E8）。
 *
 * 权威契约：`wiki/raw/task_issue-154_sa2_design.md` §6.1（每步中断 × {bin 存在/缺失}）、
 * §4.2（JSONL-as-commit-marker：S0→S1 rename(jsonl→.deleting)→S2 unlink(bin)→S3 unlink(marker)）、
 * §9 T-B8/T-E8/T20。ADR 0012 §Retention 与删除 L291-295。
 *
 * 方法学：中断态直接合成磁盘状态（rename jsonl→.deleting 等），断言 = 构造/sweep 后
 * 的运行时磁盘产物 + reader 视图 + 健康事件。当前主干无 retention API/行为 ⇒
 * `sweepRetention`/`historyTrimmed` 类型缺失（tsc 红）+ 运行时 TypeError/断言失败（vitest 红）；
 * 若实现「构造即 rotate」（R1 风暴）则 W1/W2/W3 的 no-rotate 断言亦红——双锚点。
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
  synthesizeDeletingMarker,
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

/** 标准 writer 模板（frozen 面：updateCapture+targets+inline 阈值；与 reader/resume 冻结比对一致）。 */
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

/** 两闭/开组构造：段1 [1] 闭、段2 [2] 开（各含 jsonl+bin——侧车帧 → 成对性可验）。 */
function buildTwoGroups(root: string, ns: string): AssembledFileLog {
  const log = makeWriter(root, ns)
  emit(log)
  emit(log)
  expect(segmentEntriesOf(root, ns, log.log.streamId)).toEqual(['00000001.bin', '00000001.jsonl', '00000002.bin', '00000002.jsonl'])
  return log
}

// ============================================================================
// §6.1 矩阵：每步中断 × {bin 存在, bin 缺失}
// ============================================================================
describe('§6.1 组删除协议中断矩阵（AC-2「resumable … across restart windows」）', () => {
  it('W0 [红灯] 崩溃于 rename 前（jsonl+bin 完整）：重开不删、不 rotate；续写接 sequence', () => {
    const root = freshRoot()
    const ns = 'ns-w0'
    const a = buildTwoGroups(root, ns)
    const b = makeWriter(root, ns, { retention: { sweepOnOpen: false } })
    expect(b.log.streamId).toBe(a.log.streamId)
    expect(eventsOfTypeRaw(b.events, 'stream-generation-rotated')).toHaveLength(0)
    // 组完整（无需续走）：段1 原样
    expect(segmentEntriesOf(root, ns, a.log.streamId)).toEqual(['00000001.bin', '00000001.jsonl', '00000002.bin', '00000002.jsonl'])
    // 续写接 sequence（段2 满 1 条 → 滚出段3）
    emit(b)
    const records = readAllSegmentRecords(root, ns, a.log.streamId)
    expect(records.map((r) => r.record.sequence)).toEqual(['1', '2', '3'])
    expect(records[records.length - 1]!.segment).toBe('00000003')
  })

  it('W1 [红灯] 崩溃于 rename 后、unlink(bin) 前（.deleting+bin）：reader 不报 roll-target-violation/gap；重开续走清为无', () => {
    const root = freshRoot()
    const ns = 'ns-w1'
    const a = buildTwoGroups(root, ns)
    synthesizeDeletingMarker(root, ns, a.log.streamId, '00000001', { keepBin: true })

    // —— T20：mid-deletion 态的 reader 视图（.deleting 组从枚举消失；幸存组锚重定基，非 corrupt）——
    const read = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: a.log.streamId })
    expect(read.status).toBe('ok')
    expect(read.issues.some((i) => i.code === 'manifest-roll-target-violation')).toBe(false)
    expect(read.issues.some((i) => i.code === 'sequence-gap')).toBe(false)
    expect(read.issues.some((i) => i.code === 'frame-missing')).toBe(false)
    expect(read.historyTrimmed).toBe(true)
    expect(read.earliestRetainedSequence).toBe('2')
    expect(read.records.map((r) => r.sequence)).toEqual(['2'])

    // —— 重开：构造不 rotate（.deleting 感知）；sweep 续走 S1→S3 完成删除 ——
    const b = makeWriter(root, ns, { retention: { sweepOnOpen: false } })
    expect(b.log.streamId).toBe(a.log.streamId)
    expect(eventsOfTypeRaw(b.events, 'stream-generation-rotated')).toHaveLength(0)
    const report = b.log.sweepRetention({ now: T0 + 10_000_000 })
    expect(report.failedSteps).toBe(0)
    const seg1 = segmentPathsOf(root, ns, a.log.streamId, '00000001')
    expect(existsSync(seg1.deletingPath)).toBe(false)
    expect(existsSync(seg1.binPath)).toBe(false)
    expect(existsSync(seg1.jsonlPath)).toBe(false)
    // 幸存组原样（开组保护）
    expect(segmentEntriesOf(root, ns, a.log.streamId)).toEqual(['00000002.bin', '00000002.jsonl'])
  })

  it('W2 [红灯] 崩溃于 unlink(bin) 后、unlink(marker) 前（仅 .deleting）：重开续走清为无', () => {
    const root = freshRoot()
    const ns = 'ns-w2'
    const a = buildTwoGroups(root, ns)
    synthesizeDeletingMarker(root, ns, a.log.streamId, '00000001', { keepBin: false })

    const b = makeWriter(root, ns, { retention: { sweepOnOpen: false } })
    expect(b.log.streamId).toBe(a.log.streamId)
    expect(eventsOfTypeRaw(b.events, 'stream-generation-rotated')).toHaveLength(0)
    const report = b.log.sweepRetention({ now: T0 + 10_000_000 })
    expect(report.failedSteps).toBe(0)
    const seg1 = segmentPathsOf(root, ns, a.log.streamId, '00000001')
    expect(existsSync(seg1.deletingPath)).toBe(false)
    expect(existsSync(seg1.binPath)).toBe(false)
    expect(existsSync(seg1.jsonlPath)).toBe(false)
    expect(segmentEntriesOf(root, ns, a.log.streamId)).toEqual(['00000002.bin', '00000002.jsonl'])
  })

  it('W3 [红灯] 崩溃于 unlink(marker) 后（组已无）：重开不 rotate（前缀缺失 = trim）、段2 原样', () => {
    const root = freshRoot()
    const ns = 'ns-w3'
    const a = buildTwoGroups(root, ns)
    const seg1 = segmentPathsOf(root, ns, a.log.streamId, '00000001')
    rmSyncInTest(seg1.jsonlPath)
    rmSyncInTest(seg1.binPath)

    const b = makeWriter(root, ns, { retention: { sweepOnOpen: false } })
    expect(b.log.streamId).toBe(a.log.streamId)
    expect(eventsOfTypeRaw(b.events, 'stream-generation-rotated')).toHaveLength(0)
    // 无续走对象：组已无残留；不再报任何删除动作
    const report = b.log.sweepRetention({ now: T0 + 10_000_000 })
    expect(report.failedSteps).toBe(0)
    expect(segmentEntriesOf(root, ns, a.log.streamId)).toEqual(['00000002.bin', '00000002.jsonl'])
  })

  it('T-E8 [红灯] 遗留 .deleting 由 sweep 完成并计数（deletingMarkersCompleted ≥ 1 + retention-swept 事件）', () => {
    const root = freshRoot()
    const ns = 'ns-e8'
    const a = buildTwoGroups(root, ns)
    // 构造之后再合成 W2 态：保证存在性由显式 sweep 承担（不依赖构造期续走次序）
    synthesizeDeletingMarker(root, ns, a.log.streamId, '00000001', { keepBin: false })
    // 显式 sweep（无限制配置 → 卫生遍历无条件执行）
    const b = makeWriter(root, ns, {
      retention: { maxAgeMs: null, maxBytesPerNamespace: null, sweepOnOpen: false },
    })
    const report = b.log.sweepRetention({ now: T0 + 10_000_000 })
    expect(report.deletingMarkersCompleted).toBeGreaterThanOrEqual(1)
    expect(eventsOfTypeRaw(b.events, 'retention-swept').length).toBeGreaterThanOrEqual(1)
    expect(eventsOfTypeRaw(b.events, 'stream-generation-rotated')).toHaveLength(0)
    expect(existsSync(segmentPathsOf(root, ns, a.log.streamId, '00000001').deletingPath)).toBe(false)
  })
})

function rmSyncInTest(file: string): void {
  rmSync(file, { force: true })
}

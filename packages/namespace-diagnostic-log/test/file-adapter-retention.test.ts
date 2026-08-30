/**
 * 红灯契约 — Issue #154 Retain, lease, and delete namespace diagnostic logs（SA6 编写）。
 *
 * 权威契约：`wiki/raw/task_issue-154_sa2_design.md`（§9 T-A/T-B 全表；§2.1/§2.2 公共 API；
 * §4.1/§4.2/§4.5 状态机与两遍算法；§5 INV-1/2/5/6/10/11/13）。约束优先级：任务简报
 * （TASK.md AC 1/2/5） > SA2 设计 > ADR-0012 §Retention 与删除 > #153 既有冻结面。
 *
 * 本文件：T-A（age/bytes 配置语义：null/0/非法值/默认值/不持久化）+
 * T-B1–T-B5、T-B7–T-B10（闭组资格、协议产物、开组保护、前缀纪律、文法不可达、
 * 永不 throw、多 generation 候选序）。T-B6（租约洞）在 read-session 文件。
 *
 * 方法学（SA2 §9 原文照搬）：不新增 fault-injection 接缝——中断态直接合成磁盘状态；
 * 红灯性 = 当前主干无这些 API/行为，编译期红（`log.sweepRetention`/`read.historyTrimmed`
 * 类型缺失）或断言期红（运行时 TypeError/断言失败）。全部断言针对运行时产物
 * （磁盘文件字节、observer 事件、sweep 报告、readStreamStrict 返回）——零源码文本断言。
 *
 * 类型面注记（#153 同款路线）：`FileDiagnosticLogConfig.retention` 与
 * `FileDiagnosticLog.sweepRetention` 是 SA2 提议的增量 API（§2.1/§2.2），本文件按
 * 提议形状直接引用——当前 src 类型缺这些成员 ⇒ tsc/运行时双红；SA3 实现后按同形状
 * 编译通过并转绿。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { readStreamStrict } from '../src/index.js'
import type { FileDiagnosticLog, FileDiagnosticLogConfig } from '../src/index.js'
import { baseEmission } from './helpers/base.js'
import {
  eventsOfTypeRaw,
  groupBytesOf,
  makeFileLog,
  makeTempRoot,
  patternedBytes,
  readAllSegmentRecords,
  readJsonl,
  rmTempRoot,
  segmentEntriesOf,
  segmentPathsOf,
  streamPaths,
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

/** 确定性时间基准（与 helpers/base.ts OBSERVED_AT 同刻同形状：P_ISO_MS）。 */
const T0 = Date.parse('2026-08-28T12:00:00.000Z')
const isoAt = (ms: number): string => new Date(T0 + ms).toISOString()

/** SA2 §2.1 retention 配置三键的本地镜像（提议 API 形状——src 类型面冻结期不 import）。 */
type RetentionLike = {
  maxAgeMs?: number | null | undefined
  maxBytesPerNamespace?: number | null | undefined
  sweepOnOpen?: boolean | undefined
}

/** 侧车帧载荷：100B（> inline 阈值 64 → sidecar → 每一段生成 .bin；25B header → 125B/段）。 */
const SIDE = 100
const INLINE_T = 64

/** 标准构造：targetRecordsPerSegment=1 使每条记录独立滚段（闭组/开组可控）+ updateCapture。 */
function makeRetentionLog(root: string, ns: string, retention: RetentionLike, extra: Record<string, unknown> = {}): AssembledFileLog {
  return makeFileLog({
    rootDir: root,
    namespaceId: ns,
    updateCapture: true,
    targetRecordsPerSegment: 1,
    inlineUpdateMaxBytes: INLINE_T,
    retention,
    ...extra,
  } as unknown as Partial<FileDiagnosticLogConfig>)
}

/** 运行身份护栏（#153 同款）：EACCES 注入（chmod 0555）只在非 root 下成立。 */
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

/** emit 一条 sidecar 记录（observedAt = T0 + observedMs；sequence 由 writer 分配）。 */
function emit(log: AssembledFileLog, observedMs: number): void {
  log.log.emitter.emit(
    baseEmission({ observedAt: isoAt(observedMs), result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(SIDE) } }),
  )
}

/** 构造三组流：段 1、2 闭（各 1 条），段 3 开组。 */
function buildThreeGroups(root: string, ns: string, retention: RetentionLike, observedMs = 0): AssembledFileLog {
  const log = makeRetentionLog(root, ns, retention)
  emit(log, observedMs)
  emit(log, observedMs)
  emit(log, observedMs)
  expect(segmentEntriesOf(root, ns, log.log.streamId)).toEqual([
    '00000001.bin',
    '00000001.jsonl',
    '00000002.bin',
    '00000002.jsonl',
    '00000003.bin',
    '00000003.jsonl',
  ])
  return log
}

// ============================================================================
// T-A：age/bytes 配置语义（AC-1）
// ============================================================================
describe('T-A retention 语义（AC-1：可配置 age/bytes、null/0 文档语义）', () => {
  it('T-A1 [红灯] 年龄前沿包含性：now−groupNewest == maxAgeMs ⇒ 过期；−1ms ⇒ 不过期', () => {
    const root = freshRoot()
    const ns = 'ns-a1'
    const a = buildThreeGroups(root, ns, { maxAgeMs: 1000, sweepOnOpen: false }, 0)

    // 边界内（999）：零删除（组龄 999 < 1000）
    const keep = a.log.sweepRetention({ now: T0 + 999 })
    expect(keep.deletedGroups).toBe(0)
    expect(segmentEntriesOf(root, ns, a.log.streamId)).toHaveLength(6)

    // 边界含等号（1000）：闭组 1、2 均过期（组龄 1000 == maxAgeMs）→ 删除；开组 3 原样
    const del = a.log.sweepRetention({ now: T0 + 1000 })
    expect(del.deletedGroups).toBe(2)
    expect(segmentEntriesOf(root, ns, a.log.streamId)).toEqual(['00000003.bin', '00000003.jsonl'])
    expect(del.earliestRetained).toEqual([{ streamId: a.log.streamId, sequence: '3' }])
    expect(del.historyTrimmedStreams.map((s) => s.streamId)).toContain(a.log.streamId)
    expect(del.retainedBytes).toBe(groupBytesOf(segmentPathsOf(root, ns, a.log.streamId, '00000003')))
  })

  it('T-A2 [红灯] 组内取 max（回拨时钟）：中间行新、末行旧 ⇒ 按 max 判定保留；老组仍删', () => {
    const root = freshRoot()
    const ns = 'ns-a2'
    // target=2 → 段1 [r1,r2]、段2 [r3,r4]、段3 [r5] 开组
    const a = makeRetentionLog(root, ns, { maxAgeMs: 5000, sweepOnOpen: false }, { targetRecordsPerSegment: 2 })
    emit(a, 0)
    emit(a, 0) // seg1: r1,r2 @ T0（老）
    emit(a, 10000)
    emit(a, 0) // seg2: r3 @ T0+10000、r4 @ T0（注入回拨：末行旧、中间行新——max 判定必须取 r3）
    emit(a, 0) // seg3 开组

    const report = a.log.sweepRetention({ now: T0 + 6000 }) // cutoff = T0+1000
    expect(report.deletedGroups).toBe(1) // 仅 seg1 过期；seg2（max = T0+10000 > cutoff）保留
    expect(segmentEntriesOf(root, ns, a.log.streamId)).toEqual([
      '00000002.bin',
      '00000002.jsonl',
      '00000003.bin',
      '00000003.jsonl',
    ])
    expect(report.earliestRetained[0]).toMatchObject({ streamId: a.log.streamId, sequence: '3' })
  })

  it('T-A3 [红灯] 字节前沿：total == maxBytes ⇒ 零删除；total == maxBytes+1 ⇒ 删最老闭组至 ≤', () => {
    const root = freshRoot()
    const ns = 'ns-a3'
    // 第一实例：仅测量（无字节限制 → 零删除），产出的字节形状确定
    const a = buildThreeGroups(root, ns, { maxAgeMs: null, sweepOnOpen: false }, 0)
    const p = (seg: string) => segmentPathsOf(root, ns, a.log.streamId, seg)
    const total = groupBytesOf(p('00000001')) + groupBytesOf(p('00000002')) + groupBytesOf(p('00000003'))
    expect(a.log.sweepRetention({ now: T0 + 10_000_000 }).deletedGroups).toBe(0)

    // 边界 A：预算 == total → 不删（total > maxBytes 为假）
    const b = makeRetentionLog(root, ns, { maxAgeMs: null, maxBytesPerNamespace: total, sweepOnOpen: false })
    expect(b.log.streamId).toBe(a.log.streamId)
    const keep = b.log.sweepRetention({ now: T0 + 10_000_000 })
    expect(keep.deletedGroups).toBe(0)
    expect(segmentEntriesOf(root, ns, a.log.streamId)).toHaveLength(6)

    // 边界 B：预算 == total−1 → 删最老闭组（候选序首组）至 ≤
    const c = makeRetentionLog(root, ns, { maxAgeMs: null, maxBytesPerNamespace: total - 1, sweepOnOpen: false })
    expect(c.log.streamId).toBe(a.log.streamId)
    const del = c.log.sweepRetention({ now: T0 + 10_000_000 })
    expect(del.deletedGroups).toBeGreaterThanOrEqual(1)
    expect(segmentEntriesOf(root, ns, a.log.streamId)).toContain('00000003.jsonl') // 开组原样
    const afterTotal = groupBytesOf(p('00000001')) + groupBytesOf(p('00000002')) + groupBytesOf(p('00000003'))
    expect(afterTotal).toBeLessThanOrEqual(total - 1)
  })

  it('T-A4 [红灯] 双 null ⇒ 年龄/字节零动作；卫生遍历仍清 orphan 与遗留 .deleting', () => {
    const root = freshRoot()
    const ns = 'ns-a4'
    const a = buildThreeGroups(root, ns, { maxAgeMs: null, maxBytesPerNamespace: null, sweepOnOpen: false }, 0)
    // W1：闭组 1 的 jsonl rename → .deleting（bin 保留）——命名与内容随 rename（原子、同目录）
    const seg1 = segmentPathsOf(root, ns, a.log.streamId, '00000001')
    renameSync(seg1.jsonlPath, seg1.deletingPath)
    // orphan：闭组 00000004.bin（无 jsonl、无 .deleting）
    const orphan = segmentPathsOf(root, ns, a.log.streamId, '00000004')
    writeFileSync(orphan.binPath, patternedBytes(SIDE))

    const report = a.log.sweepRetention({ now: T0 + 10_000_000 })
    expect(report.deletedGroups).toBe(0) // 双 null：限制驱动零删除
    expect(report.orphanBinsDeleted).toBe(1)
    expect(report.deletingMarkersCompleted).toBe(1)
    expect(existsSync(seg1.deletingPath)).toBe(false)
    expect(existsSync(seg1.binPath)).toBe(false)
    expect(existsSync(orphan.binPath)).toBe(false)
    // 幸存组不受牵连
    expect(segmentEntriesOf(root, ns, a.log.streamId)).toEqual(['00000002.bin', '00000002.jsonl', '00000003.bin', '00000003.jsonl'])
  })

  it('T-A5 [红灯] 0/0 ⇒ 尽删全部闭组；开组（jsonl+bin）原样；retainedBytes == 开组字节（诚实下限）', () => {
    const root = freshRoot()
    const ns = 'ns-a5'
    const a = buildThreeGroups(root, ns, { maxAgeMs: 0, maxBytesPerNamespace: 0, sweepOnOpen: false }, 0)
    const report = a.log.sweepRetention({ now: T0 })
    expect(report.deletedGroups).toBe(2)
    expect(segmentEntriesOf(root, ns, a.log.streamId)).toEqual(['00000003.bin', '00000003.jsonl'])
    const open = segmentPathsOf(root, ns, a.log.streamId, '00000003')
    expect(existsSync(open.jsonlPath)).toBe(true)
    expect(existsSync(open.binPath)).toBe(true)
    expect(report.retainedBytes).toBe(groupBytesOf(open)) // 如实下限：开组（+阻塞组）字节
  })

  it('T-A6 [红灯] 非法值（−1/NaN/1.5/∞/非数字）⇒ 恰一次 retention-config-invalid + 零删除 + stream 照常', () => {
    const cases: Array<{ retention: RetentionLike; field: 'maxAgeMs' | 'maxBytesPerNamespace' }> = [
      { retention: { maxAgeMs: -1 }, field: 'maxAgeMs' },
      { retention: { maxAgeMs: Number.NaN }, field: 'maxAgeMs' },
      { retention: { maxAgeMs: 1.5 }, field: 'maxAgeMs' },
      { retention: { maxAgeMs: Number.POSITIVE_INFINITY }, field: 'maxAgeMs' },
      { retention: { maxBytesPerNamespace: 'x' as unknown as number }, field: 'maxBytesPerNamespace' },
      { retention: { maxBytesPerNamespace: Number.NaN }, field: 'maxBytesPerNamespace' },
    ]
    let n = 0
    for (const c of cases) {
      n += 1
      const root = freshRoot()
      const ns = `ns-a6-${n}`
      const a = makeRetentionLog(root, ns, c.retention, { sweepOnOpen: false })
      const invalid = eventsOfTypeRaw(a.events, 'retention-config-invalid')
      expect(invalid).toHaveLength(1)
      expect((invalid[0] as { field: string }).field).toBe(c.field)
      // stream 照常工作：emit 落盘
      emit(a, 0)
      expect(readJsonl(streamPaths(root, ns, a.log.streamId).jsonlPath)).toHaveLength(1)
      // retention 失活：零删除 + 无 retention-swept 事件
      const report = a.log.sweepRetention({ now: T0 + 10_000_000_000 })
      expect(report.deletedGroups).toBe(0)
      expect(eventsOfTypeRaw(a.events, 'retention-swept')).toHaveLength(0)
    }
  })

  it('T-A7 [红灯] 缺省配置 ⇒ 30d 默认年龄生效（30d 整触发、30d−1 不触发——1GiB 字节默认不做全量 fixt）', () => {
    const root = freshRoot()
    const ns = 'ns-a7'
    // clock 注入 T0：构造期自动 sweep（默认 sweepOnOpen=true）恒以 T0 为 now → 零动作（数据零龄）
    const a = makeFileLog({
      rootDir: root,
      namespaceId: ns,
      updateCapture: true,
      targetRecordsPerSegment: 1,
      inlineUpdateMaxBytes: INLINE_T,
      clock: { now: () => T0 },
    })
    emit(a, 0)
    emit(a, 0) // 段1 闭、段2 开
    // 30d 整 = 2_592_000_000ms（ADR 0012 默认）——边界前 1ms 不删
    const before = a.log.sweepRetention({ now: T0 + 2_592_000_000 - 1 })
    expect(before.deletedGroups).toBe(0)
    const at = a.log.sweepRetention({ now: T0 + 2_592_000_000 })
    expect(at.deletedGroups).toBe(1)
    expect(segmentEntriesOf(root, ns, a.log.streamId)).toHaveLength(2) // 仅段2 开组
  })

  it('T-A8 [红灯] 配置不持久化：sweep 前后 manifest 字节恒等；改 retention 重开不 rotate（对照 frozen 项）', () => {
    const root = freshRoot()
    const ns = 'ns-a8'
    const a = makeRetentionLog(root, ns, { maxAgeMs: 1000, sweepOnOpen: false })
    emit(a, 0)
    emit(a, 0)
    const manifestPath = streamPaths(root, ns, a.log.streamId).manifestPath
    const manifestBefore = readFileSync(manifestPath)
    a.log.sweepRetention({ now: T0 + 2000 }) // 删除闭组（retention 路径绝不写 manifest——INV-6）
    expect(readFileSync(manifestPath).equals(manifestBefore)).toBe(true)

    // 改 retention 重开：同 streamId、无 rotate 事件（retention 配置不冻结、不产生新 generation）
    const b = makeRetentionLog(root, ns, { maxAgeMs: null, maxBytesPerNamespace: 0, sweepOnOpen: false })
    expect(b.log.streamId).toBe(a.log.streamId)
    expect(eventsOfTypeRaw(b.events, 'stream-generation-rotated')).toHaveLength(0)

    // 对照：frozen 项（roll targets）变更 → rotate（既有 #153 语义，防「任何配置都 rotate」反向误判）
    const root2 = freshRoot()
    const ns2 = 'ns-a8-ctrl'
    const d = makeRetentionLog(root2, ns2, { sweepOnOpen: false })
    emit(d, 0)
    emit(d, 0)
    const e = makeRetentionLog(root2, ns2, { sweepOnOpen: false }, { targetRecordsPerSegment: 5 })
    expect(e.log.streamId).not.toBe(d.log.streamId)
    expect(eventsOfTypeRaw(e.events, 'stream-generation-rotated')).toHaveLength(1)
  })
})

// ============================================================================
// T-B：闭组资格与删除协议（AC-2）
// ============================================================================
describe('T-B 闭组资格与删除协议（AC-2）', () => {
  it('T-B1 [红灯] 只有闭组被删：段 1、2 删（协议后零残留）、开组 3 原样；幸存组帧可读', () => {
    const root = freshRoot()
    const ns = 'ns-b1'
    const a = buildThreeGroups(root, ns, { maxAgeMs: 0, sweepOnOpen: false }, 0)
    const report = a.log.sweepRetention({ now: T0 })
    expect(report.deletedGroups).toBe(2)
    // 协议产物序（T-B2）：闭组任何 .jsonl/.bin/.deleting 残留全无
    expect(segmentEntriesOf(root, ns, a.log.streamId)).toEqual(['00000003.bin', '00000003.jsonl'])
    // 成对性（T-B3）：幸存组 jsonl 引用的侧车帧可读（trim 感知后 status ok；现在 = corrupt/gap → 红）
    const read = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: a.log.streamId })
    expect(read.status).toBe('ok')
    expect(read.records.map((r) => r.sequence)).toEqual(['3'])
    expect(read.records[0]!.ok).toBe(true)
  })

  it('T-B4 [红灯] 开组保护（无闭组）：仅开组 + 0/0 ⇒ 零删除、字节如实', () => {
    const root = freshRoot()
    const ns = 'ns-b4'
    const a = makeRetentionLog(root, ns, { maxAgeMs: 0, maxBytesPerNamespace: 0, sweepOnOpen: false })
    emit(a, 0) // 单段开组
    const report = a.log.sweepRetention({ now: T0 })
    expect(report.deletedGroups).toBe(0)
    expect(segmentEntriesOf(root, ns, a.log.streamId)).toEqual(['00000001.bin', '00000001.jsonl'])
    expect(report.retainedBytes).toBe(groupBytesOf(segmentPathsOf(root, ns, a.log.streamId, '00000001')))
  })

  it('T-B5 [红灯] 开组 BIN-first 瞬态（零 jsonl、仅 bin）不被删也不被 orphan 清（INV-1 照妖镜）', () => {
    const root = freshRoot()
    const ns = 'ns-b5'
    const a = makeRetentionLog(root, ns, { maxAgeMs: null, maxBytesPerNamespace: null, sweepOnOpen: false })
    emit(a, 0)
    emit(a, 0) // seg1 [1] 闭、seg2 [2] 开
    // 合成开组 bin-only：删开组 jsonl（BIN-first 写帧后、JSONL 提交前的瞬态镜像）
    const seg2 = segmentPathsOf(root, ns, a.log.streamId, '00000002')
    rmSync(seg2.jsonlPath, { force: true })

    const report = a.log.sweepRetention({ now: T0 + 10_000_000 })
    expect(report.orphanBinsDeleted).toBe(0) // 开组绝对豁免
    expect(report.deletedGroups).toBe(0)
    expect(existsSync(seg2.binPath)).toBe(true) // 瞬态 bin 原样
    expect(existsSync(seg2.jsonlPath)).toBe(false) // 无保留/重建
  })

  it('T-B7 [红灯] 前缀纪律-IO 失败：段 2 marker unlink 失败 ⇒ 止步该流、段 3 不删（无跳洞）', () => {
    const root = freshRoot()
    const ns = 'ns-b7'
    const a = buildThreeGroups(root, ns, { maxAgeMs: 0, sweepOnOpen: false }, 0)
    const seg2 = segmentPathsOf(root, ns, a.log.streamId, '00000002')
    // 段 2 占位 .deleting（目录）→ unlink/rename 必败（EISDIR/EEXIST/ENOTEMPTY）
    mkdirSync(seg2.deletingPath)

    const report = a.log.sweepRetention({ now: T0 })
    expect(report.failedSteps).toBeGreaterThanOrEqual(1)
    // 前缀纪律：绝不跳洞——段 2 jsonl 未删（止步）、段 3（开组）原样
    expect(existsSync(seg2.jsonlPath)).toBe(true)
    expect(existsSync(segmentPathsOf(root, ns, a.log.streamId, '00000003').jsonlPath)).toBe(true)
  })

  it('T-B8 [红灯] 保留字文法不可达：手工 {seg}.deleting + {seg}.bin ⇒ 卫生清为无；append 不落入该段', () => {
    const root = freshRoot()
    const ns = 'ns-b8'
    const sid = 'log-33333333333333333333333333333333'
    writeStreamFixture(root, ns, sid, {
      manifest: validManifest(sid, ns, { targetRecordsPerSegment: 1, inlineUpdateMaxBytes: INLINE_T }),
      current: true,
      segments: [
        { segment: '00000001', jsonlLines: [validAttemptRecord(sid, '1')] },
        { segment: '00000002', jsonlLines: [validAttemptRecord(sid, '2')] },
        { segment: '00000003', jsonlLines: [validAttemptRecord(sid, '3')] },
      ],
    })
    // 手工放置文法不可达残留（段 4：.deleting + .bin——形似 W1 但非任何协议产物）
    const seg4 = segmentPathsOf(root, ns, sid, '00000004')
    writeFileSync(seg4.binPath, patternedBytes(SIDE))
    writeFileSync(seg4.deletingPath, '')

    const a = makeRetentionLog(root, ns, { maxAgeMs: null, maxBytesPerNamespace: null, sweepOnOpen: false }, { resumeStreamId: sid })
    a.log.sweepRetention({ now: T0 + 10_000_000 })
    // 文法不可达残留被清（.deleting 不满足 P_SEGMENT；兄弟 bin 随标记 S1→S3 续走）
    expect(existsSync(seg4.binPath)).toBe(false)
    expect(existsSync(seg4.deletingPath)).toBe(false)
    // 后续 append 落入真流（段 3 满 1 条 → 滚出 00000004 新组），sequence 接续
    emit(a, 0)
    const records = readAllSegmentRecords(root, ns, sid)
    expect(records.map((r) => r.record.sequence)).toEqual(['1', '2', '3', '4'])
    expect(records[records.length - 1]!.segment).toBe('00000004')
  })

  it.skipIf(isRoot)('T-B9 [红灯] sweep 永不 throw（INV-5）：只读 segments 目录 ⇒ 报告 + failedSteps 计数；恢复后 emit 照常', () => {
    const root = freshRoot()
    const ns = 'ns-b9'
    const a = buildThreeGroups(root, ns, { maxAgeMs: 0, sweepOnOpen: false }, 0)
    const segmentsDir = streamPaths(root, ns, a.log.streamId).segmentsDir
    chmodSync(segmentsDir, 0o555)
    try {
      // 绝不 throw：一切 IO 失败 → 计数 + 事件（INV-5 隔离）；a.log.sweepRetention 直接调用即证明
      const report = a.log.sweepRetention({ now: T0 })
      expect(report.failedSteps).toBeGreaterThanOrEqual(1)
    } finally {
      chmodSync(segmentsDir, 0o755)
    }
    emit(a, 0) // 恢复后照常落盘（段3 满 1 条 → 滚出段 00000004）
    const all = readAllSegmentRecords(root, ns, a.log.streamId)
    expect(all.map((r) => r.record.sequence)).toEqual(['1', '2', '3', '4'])
    expect(all[all.length - 1]!.segment).toBe('00000004')
  })

  it('T-B10 [红灯] 多 generation：候选序 = manifest.createdAt↑；旧代先裁；字节预算跨代合计', () => {
    const root = freshRoot()
    const ns = 'ns-b10'
    // 旧代：X 构造（clock T0 → manifest createdAt T0）——先在 X 内滚两段
    const x = makeRetentionLog(root, ns, { sweepOnOpen: false }, { clock: { now: () => T0 } })
    emit(x, 0)
    emit(x, 0) // A: seg1 [1]、seg2 [2]（sealed 世代：全部组皆闭——无开组概念）
    // 当前代：Y 以不同 roll target 重开 → frozen-policy-mismatch → rotate → 新 stream B
    const y = makeFileLog({
      rootDir: root,
      namespaceId: ns,
      updateCapture: true,
      targetRecordsPerSegment: 2,
      inlineUpdateMaxBytes: INLINE_T,
      clock: { now: () => T0 + 100_000 },
    } as unknown as Partial<FileDiagnosticLogConfig>)
    expect(y.log.streamId).not.toBe(x.log.streamId)
    expect(eventsOfTypeRaw(y.events, 'stream-generation-rotated')).toHaveLength(1)
    emit(y, 0)
    emit(y, 0)
    emit(y, 0) // B: seg1 [1,2] 闭、seg2 [3] 开（clock T0+100000 → createdAt 较晚）

    const a1 = groupBytesOf(segmentPathsOf(root, ns, x.log.streamId, '00000001'))
    const a2 = groupBytesOf(segmentPathsOf(root, ns, x.log.streamId, '00000002'))
    const b1 = groupBytesOf(segmentPathsOf(root, ns, y.log.streamId, '00000001'))
    const b2 = groupBytesOf(segmentPathsOf(root, ns, y.log.streamId, '00000002'))
    const total = a1 + a2 + b1 + b2

    // 预算 = total−1：只容 1 组被删；被删者必须是候选序首项 = 旧代 A 的段 1（createdAt↑）
    const z = makeFileLog({
      rootDir: root,
      namespaceId: ns,
      updateCapture: true,
      targetRecordsPerSegment: 2,
      inlineUpdateMaxBytes: INLINE_T,
      clock: { now: () => T0 + 100_000 },
      retention: { maxAgeMs: null, maxBytesPerNamespace: total - 1, sweepOnOpen: false },
    } as unknown as Partial<FileDiagnosticLogConfig>)
    expect(z.log.streamId).toBe(y.log.streamId)
    const report = z.log.sweepRetention({ now: T0 + 10_000_000 })
    expect(report.deletedGroups).toBe(1)
    expect(report.reclaimedBytes).toBe(a1)
    expect(existsSync(segmentPathsOf(root, ns, x.log.streamId, '00000001').jsonlPath)).toBe(false)
    expect(existsSync(segmentPathsOf(root, ns, x.log.streamId, '00000002').jsonlPath)).toBe(true)
    expect(existsSync(segmentPathsOf(root, ns, y.log.streamId, '00000001').jsonlPath)).toBe(true)
    expect(existsSync(segmentPathsOf(root, ns, y.log.streamId, '00000002').jsonlPath)).toBe(true)
  })
})

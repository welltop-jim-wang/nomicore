/**
 * 红灯契约 — Issue #227（SA6 编写）：retention/hygiene 租约行为（AC2/AC5）。
 *
 * 权威契约：`wiki/raw/task_issue-227_design.md`（R1.1）§3.3（§3.3.1 S0′ 提交点复查
 * `deleteGroupIfUnleased` / §3.3.2 P0 卫生遍历 orphan-BIN 租约门 + `leaseBlockedGroups`
 * 计入 P0 跳过）/ §8.2（B2/B3 矩阵）。
 *
 * 红灯性（HEAD = 本文件编写时点）：
 * - B2/B3 断言「活跃 read-session 租约覆盖的 closed 组，其 orphan BIN 不得被 P0
 *   卫生遍历删除」——HEAD 的 `hygieneStream` orphan-BIN 清理（file.ts:1134–1151）
 *   不看租约，直接 unlink（复现基线：sweep report orphanBinsDeleted=1、bin 消失、
 *   leaseBlockedGroups=0）→ 红灯；SA3 加租约门后翻转（bin 保留、leaseBlockedGroups≥1、
 *   close 后再 sweep 才删）。
 * - 全部断言针对运行时产物（sweep report / 磁盘文件 / retention-swept 事件）——
 *   零源码文本断言、零测试抑制。
 */
import { existsSync, unlinkSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  openDiagnosticReadSession,
  type DiagnosticReadSession,
  type RetentionSweepReport,
} from '../src/index.js'
import type { FileDiagnosticLogConfig, DiagnosticLogHealthEvent } from '../src/index.js'
import { baseEmission } from './helpers/base.js'
import {
  eventsOfTypeRaw,
  makeFileLog,
  makeTempRoot,
  patternedBytes,
  rmTempRoot,
} from './helpers/file.js'
import type { AssembledFileLog } from './helpers/file.js'

const tempRoots: string[] = []
const openSessions: DiagnosticReadSession[] = []

function freshRoot(): string {
  const root = makeTempRoot()
  tempRoots.push(root)
  return root
}

afterEach(() => {
  for (const session of openSessions.splice(0)) session.close()
  for (const root of tempRoots.splice(0)) rmTempRoot(root)
})

const T0 = Date.parse('2026-08-28T12:00:00.000Z')

/** 三组无 genesis sidecar 流（段 1、2 闭 / 段 3 开；retention 双 null → 只跑 P0 卫生遍历）。 */
function buildThreeSidecarGroups(root: string, ns: string, extra: Record<string, unknown> = {}): AssembledFileLog {
  const log = makeFileLog({
    rootDir: root,
    namespaceId: ns,
    updateCapture: true,
    targetRecordsPerSegment: 1,
    inlineUpdateMaxBytes: 8,
    clock: { now: () => T0 },
    retention: { maxAgeMs: null, maxBytesPerNamespace: null, sweepOnOpen: false },
    ...extra,
  } as unknown as Partial<FileDiagnosticLogConfig>)
  const payload = patternedBytes(64)
  for (let i = 0; i < 3; i++) {
    log.log.emitter.emit(
      baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: payload } }),
    )
  }
  return log
}

function segmentsDirOf(root: string, ns: string, streamId: string): string {
  return `${root}/namespaces/${ns}/streams/${streamId}/segments`
}

function track(session: DiagnosticReadSession): DiagnosticReadSession {
  openSessions.push(session)
  return session
}

// ============================================================================
// B2 — P0 卫生守约（活跃租约下 orphan-BIN 不得被删）
// ============================================================================
describe('B2 卫生守约（AC2：P0 orphan-BIN 清理必须尊重活跃租约）', () => {
  it('B2 [红灯] 活跃 session 下 sweep ⇒ bin 保留、orphanBinsDeleted=0、leaseBlockedGroups≥1（P0 租约门缺失的违约本体）', () => {
    const root = freshRoot()
    const ns = 'ns-227-b2'
    const a = buildThreeSidecarGroups(root, ns)
    const dir = segmentsDirOf(root, ns, a.log.streamId)
    const session = track(
      openDiagnosticReadSession({
        rootDir: root,
        namespaceId: ns,
        streamId: a.log.streamId,
        ttlMs: 60_000,
        clock: { now: () => T0 },
      }),
    )
    expect(session.segments).toEqual(['00000001', '00000002', '00000003'])
    // 前置盘面：closed 组 1 残留 bin-无-jsonl-无-marker（writer 滚动边界崩溃可达态）
    unlinkSync(`${dir}/00000001.jsonl`)
    const binPath = `${dir}/00000001.bin`
    expect(existsSync(binPath)).toBe(true)

    // 红：HEAD P0 卫生不看租约 → orphanBinsDeleted≥1、bin 消失、leaseBlockedGroups=0；
    // 修后：租约门 → bin 保留、orphanBinsDeleted=0、leaseBlockedGroups≥1
    const report: RetentionSweepReport = a.log.sweepRetention({ now: T0 + 1000 })
    expect(report.orphanBinsDeleted).toBe(0)
    expect(report.leaseBlockedGroups).toBeGreaterThanOrEqual(1)
    expect(existsSync(binPath)).toBe(true)
    expect(report.deletedGroups).toBe(0)
  })

  it('B2 [绿灯续] session.close() 后再 sweep ⇒ 同 orphan BIN 被 P0 清理（orphanBinsDeleted≥1、bin 消失）', () => {
    const root = freshRoot()
    const ns = 'ns-227-b2c'
    const a = buildThreeSidecarGroups(root, ns)
    const dir = segmentsDirOf(root, ns, a.log.streamId)
    const session = openDiagnosticReadSession({
      rootDir: root,
      namespaceId: ns,
      streamId: a.log.streamId,
      ttlMs: 60_000,
      clock: { now: () => T0 },
    })
    unlinkSync(`${dir}/00000001.jsonl`)
    const binPath = `${dir}/00000001.bin`
    // 第一轮：活跃租约下 bin 必须幸存（B2 红断言）
    const blocked = a.log.sweepRetention({ now: T0 + 1000 })
    expect(blocked.orphanBinsDeleted).toBe(0)
    expect(existsSync(binPath)).toBe(true)
    // 释放后：同一盘面再 sweep → P0 照常清理
    session.close()
    const freed = a.log.sweepRetention({ now: T0 + 1000 })
    expect(freed.orphanBinsDeleted).toBeGreaterThanOrEqual(1)
    expect(existsSync(binPath)).toBe(false)
  })
})

// ============================================================================
// B3 — 报告口径（P0 跳过与 P1 止步同计入 leaseBlockedGroups；事件与报告一致）
// ============================================================================
describe('B3 报告口径（AC2/AC5：leaseBlockedGroups = P1 止步 + P0 跳过；retention-swept 事件一致）', () => {
  function lastRetentionSwept(events: readonly DiagnosticLogHealthEvent[]): Record<string, unknown> | undefined {
    const swept = eventsOfTypeRaw(events, 'retention-swept')
    return swept[swept.length - 1] as Record<string, unknown> | undefined
  }

  it('B3 [红灯] P0 orphan-BIN 跳过计入 leaseBlockedGroups，且 retention-swept 事件计数与报告一致', () => {
    const root = freshRoot()
    const ns = 'ns-227-b3'
    const a = buildThreeSidecarGroups(root, ns)
    const dir = segmentsDirOf(root, ns, a.log.streamId)
    const session = track(
      openDiagnosticReadSession({
        rootDir: root,
        namespaceId: ns,
        streamId: a.log.streamId,
        ttlMs: 60_000,
        clock: { now: () => T0 },
      }),
    )
    unlinkSync(`${dir}/00000001.jsonl`)
    const binPath = `${dir}/00000001.bin`

    const report: RetentionSweepReport = a.log.sweepRetention({ now: T0 + 1000 })
    // 红：HEAD → orphanBinsDeleted=1、leaseBlockedGroups=0（P0 无租约门、跳过不计数）；
    // 修后：P0 跳过计入 leaseBlockedGroups（设计 §3.3.2 N-3 语义）
    expect(report.orphanBinsDeleted).toBe(0)
    expect(report.leaseBlockedGroups).toBeGreaterThanOrEqual(1)
    expect(existsSync(binPath)).toBe(true)

    const event = lastRetentionSwept(a.events)
    expect(event).toBeDefined()
    expect(event?.leaseBlockedGroups).toBeGreaterThanOrEqual(1)
    expect(event?.orphanBinsDeleted).toBe(0)
    expect(event?.leaseBlockedGroups).toBe(report.leaseBlockedGroups)
    expect(event?.orphanBinsDeleted).toBe(report.orphanBinsDeleted)
  })

  it('B3 [绿灯对照] P1 年龄遍历的租约止步同计入 leaseBlockedGroups（既有 T-C1 语义经报告字段复核）', () => {
    const root = freshRoot()
    const ns = 'ns-227-b3p'
    const a = buildThreeSidecarGroups(root, ns, {
      retention: { maxAgeMs: 0, maxBytesPerNamespace: 0, sweepOnOpen: false },
    })
    const session = track(
      openDiagnosticReadSession({
        rootDir: root,
        namespaceId: ns,
        streamId: a.log.streamId,
        ttlMs: 60_000,
        clock: { now: () => T0 },
      }),
    )
    const report: RetentionSweepReport = a.log.sweepRetention({ now: T0 + 1000 })
    expect(report.deletedGroups).toBe(0) // 活跃租约：P1 前缀纪律止步
    expect(report.leaseBlockedGroups).toBeGreaterThanOrEqual(1)
    const event = lastRetentionSwept(a.events)
    expect(event?.leaseBlockedGroups).toBe(report.leaseBlockedGroups)
    expect(event?.deletedGroups).toBe(0)
  })
})

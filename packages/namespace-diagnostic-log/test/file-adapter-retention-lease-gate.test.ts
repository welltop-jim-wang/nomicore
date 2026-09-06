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
 * - B4a/B4b/B5（R2 增量，rev2 设计 §8.2）：S0′/P0 提交门取**提交时刻**（D11 +
 *   G-227-5 采含）——sweep 开始后注册、提交门之前到期的租约不得阻塞。B4b（活跃
 *   control）/B5 control 在 HEAD 上必红（旧提交门用 sweep 起始 now 且无钟读 →
 *   钩子不触发 → 无租约 → 照常删除）；B4a/B5 主臂对 HEAD 空洞绿（同机制——与
 *   control 臂合并构成红差分）。
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

/** 两组流（段 1 闭 aged / 段 2 开；P1 年龄遍历恰一闭组候选——B4 S0′ 提交门单候选夹具）。
 *  clock 必须由调用方注入（fake 提交钟——构造/emit 期未武装时读回 T0）。 */
function buildTwoGroups(root: string, ns: string, clock: { now(): number }): AssembledFileLog {
  const log = makeFileLog({
    rootDir: root,
    namespaceId: ns,
    updateCapture: true,
    targetRecordsPerSegment: 1,
    inlineUpdateMaxBytes: 8,
    clock,
    retention: { maxAgeMs: 0, maxBytesPerNamespace: null, sweepOnOpen: false },
  } as unknown as Partial<FileDiagnosticLogConfig>)
  const payload = patternedBytes(64)
  for (let i = 0; i < 2; i++) {
    log.log.emitter.emit(
      baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: payload } }),
    )
  }
  return log
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

// ============================================================================
// B4 — S0′ 提交时刻取时（R2/O-2：sweep 开始后注册、S1 rename 前到期的租约允许删除；
//       commit 门读的是提交时刻现值，不是 sweep 起始 now——INV-227-12）
// ============================================================================
// 权威契约：rev2 设计 §3.3（D11 `deleteGroupIfUnleased` 弃 now 参、改 clock.now()）/
// §8.2（B4a/B4b 档案）。构造：适配器注入 fake 提交钟（构造/emit 期未武装 → 恒 T0），
// 武装后首个钟调用 = P1 S0′ 提交时刻位（P0 无 orphan 零触门、初查/年龄/字节全消费
// 入参 now 零钟读——位次亲证见 SA2 复审 §2）；回调内注册 probe（独立静态钟 T_REG、
// ttl 5 → leasedUntil T_REG+5）后返回提交时刻。B4b control 在 HEAD 必红；B4a 主臂
// HEAD 空洞绿（S0′ 无钟读 → 钩子不触发 → 无租约 → 照常删除）——与 B4b 合并成红差分。
describe('B4 S0′ 提交时刻（R2：过期租约在 S1 rename 前不阻塞删除——INV-4 提交点字面复位）', () => {
  it('B4a [红差分·主臂] sweep 开始后注册、提交时刻已到期的租约 ⇒ 放行删除（deletedGroups=1、leaseBlockedGroups=0）', () => {
    const root = freshRoot()
    const ns = 'ns-227-b4a'
    let a: AssembledFileLog | null = null
    const probeSlot: { session: DiagnosticReadSession | null } = { session: null }
    let armed = false
    let reads = 0
    const T_REG = T0 + 10 // probe open 时刻 > sweep 起始 now（T0）——「sweep 开始后注册」
    const commitClock: { now(): number } = {
      now(): number {
        if (!armed) return T0
        reads += 1
        if (reads === 1 && a !== null) {
          // P1 S0′ 提交位（新实现唯一钟读位）：注册 ttl=5 租约后返回 T2 ≥ T_REG+5 →
          // 提交时刻判过期 → S1 rename 放行（放行源于「到期」而非关闭——INV-4 字面）
          probeSlot.session = openDiagnosticReadSession({
            rootDir: root,
            namespaceId: ns,
            streamId: a.log.streamId,
            ttlMs: 5,
            clock: { now: () => T_REG },
          })
          return T_REG + 5
        }
        return T_REG + 5 // fire-once：重入返回现值（K-R2-4）
      },
    }
    const fixture = buildTwoGroups(root, ns, commitClock)
    a = fixture
    const streamDir = segmentsDirOf(root, ns, fixture.log.streamId)
    armed = true
    // 红（HEAD）：S0′ 用 sweep 起始 now=T0 → 但无钟读位 → 钩子不触发 → 无租约 → 照常删除
    //（空洞绿——与 B4b control 合并构成红差分）；修后：提交时刻 T_REG+5 判过期 → 放行
    const report = fixture.log.sweepRetention({ now: T0 })
    expect(report.deletedGroups).toBe(1)
    expect(report.leaseBlockedGroups).toBe(0)
    expect(existsSync(`${streamDir}/00000001.jsonl`)).toBe(false)
    expect(existsSync(`${streamDir}/00000001.bin`)).toBe(false)
    expect(existsSync(`${streamDir}/00000002.jsonl`)).toBe(true) // 开组原样
    if (probeSlot.session !== null) track(probeSlot.session)
    // 放行源于到期而非关闭（probe 从未被 close——注册表条目仍在，仅过期）
    expect(probeSlot.session !== null && probeSlot.session.closed).toBe(false)
  })

  it('B4b [红灯 control] 提交时刻仍活跃的租约 ⇒ 阻塞删除（deletedGroups=0、leaseBlockedGroups≥1、文件在）', () => {
    const root = freshRoot()
    const ns = 'ns-227-b4b'
    let a: AssembledFileLog | null = null
    const probeSlot: { session: DiagnosticReadSession | null } = { session: null }
    let armed = false
    let reads = 0
    const T_REG = T0 + 10
    const commitClock: { now(): number } = {
      now(): number {
        if (!armed) return T0
        reads += 1
        if (reads === 1 && a !== null) {
          // 返回 T2′ ∈ [T_REG, T_REG+5) → 提交时刻仍活跃 → 必须阻塞（反向钉死「提交门读提交时刻」）
          probeSlot.session = openDiagnosticReadSession({
            rootDir: root,
            namespaceId: ns,
            streamId: a.log.streamId,
            ttlMs: 5,
            clock: { now: () => T_REG },
          })
          return T_REG + 2
        }
        return T_REG + 2
      },
    }
    const fixture = buildTwoGroups(root, ns, commitClock)
    a = fixture
    const streamDir = segmentsDirOf(root, ns, fixture.log.streamId)
    armed = true
    // 红（HEAD）：无 S0′ 钟读 → 钩子不触发 → 无租约 → group1 照删 → deletedGroups=1（断言必红）
    const report = fixture.log.sweepRetention({ now: T0 })
    expect(report.deletedGroups).toBe(0)
    expect(report.leaseBlockedGroups).toBeGreaterThanOrEqual(1)
    expect(existsSync(`${streamDir}/00000001.jsonl`)).toBe(true)
    expect(existsSync(`${streamDir}/00000001.bin`)).toBe(true)
    if (probeSlot.session !== null) track(probeSlot.session)
    expect(probeSlot.session !== null && probeSlot.session.closed).toBe(false)
  })
})

// ============================================================================
// B5 — P0 提交门取时（R2 + G-227-5 采含：orphan-BIN unlink 门同为删除提交点，
//       统一 INV-227-12——提交时刻评估租约）
// ============================================================================
// 权威契约：rev2 设计 §3.3（G-227-5 默认采含，SA2 复审 §5.3 裁定采含）/ §8.2（B5）。
// 构造同 B4，但钩子位 = P0 卫生遍历 orphan-BIN 租约门（P0 先于 P1；fixture 无
// openSegment 之外触门面）。control 臂在 HEAD 必红；主臂 HEAD 空洞绿（同 B4 机制）。
describe('B5 P0 提交门取时（R2：orphan-BIN unlink 以提交时刻评估租约——G-227-5 采含）', () => {
  it('B5 [红差分·主臂] P0 门位注册「届时已到期」租约 ⇒ orphan BIN 照常清理（orphanBinsDeleted=1、leaseBlockedGroups=0）', () => {
    const root = freshRoot()
    const ns = 'ns-227-b5'
    let a: AssembledFileLog | null = null
    const probeSlot: { session: DiagnosticReadSession | null } = { session: null }
    let armed = false
    let reads = 0
    const T_REG = T0 + 10
    const commitClock: { now(): number } = {
      now(): number {
        if (!armed) return T0
        reads += 1
        if (reads === 1 && a !== null) {
          probeSlot.session = openDiagnosticReadSession({
            rootDir: root,
            namespaceId: ns,
            streamId: a.log.streamId,
            ttlMs: 5,
            clock: { now: () => T_REG },
          })
          return T_REG + 5 // 提交时刻已到期 → unlink 放行
        }
        return T_REG + 5
      },
    }
    const fixture = buildThreeSidecarGroups(root, ns, { clock: commitClock })
    a = fixture
    const dir = segmentsDirOf(root, ns, fixture.log.streamId)
    unlinkSync(`${dir}/00000001.jsonl`) // orphan BIN 前置盘面（同 B2）
    const binPath = `${dir}/00000001.bin`
    expect(existsSync(binPath)).toBe(true)
    armed = true
    // 红（HEAD）：P0 门用 sweep 起始 now → 无钟读 → 钩子不触发 → 无租约 → BIN 照删
    //（主臂空洞绿——control 臂构成红差分）；修后：提交时刻 T_REG+5 判过期 → 照常清理
    const report = fixture.log.sweepRetention({ now: T0 })
    expect(report.orphanBinsDeleted).toBe(1)
    expect(report.leaseBlockedGroups).toBe(0)
    expect(existsSync(binPath)).toBe(false)
    if (probeSlot.session !== null) track(probeSlot.session)
    expect(probeSlot.session !== null && probeSlot.session.closed).toBe(false)
  })

  it('B5 [红灯 control] P0 门位注册提交时刻仍活跃的租约 ⇒ unlink 阻塞（leaseBlockedGroups≥1、orphanBinsDeleted=0、BIN 在）', () => {
    const root = freshRoot()
    const ns = 'ns-227-b5c'
    let a: AssembledFileLog | null = null
    const probeSlot: { session: DiagnosticReadSession | null } = { session: null }
    let armed = false
    let reads = 0
    const T_REG = T0 + 10
    const commitClock: { now(): number } = {
      now(): number {
        if (!armed) return T0
        reads += 1
        if (reads === 1 && a !== null) {
          probeSlot.session = openDiagnosticReadSession({
            rootDir: root,
            namespaceId: ns,
            streamId: a.log.streamId,
            ttlMs: 5,
            clock: { now: () => T_REG },
          })
          return T_REG + 2 // 提交时刻仍活跃 → unlink 必须被阻
        }
        return T_REG + 2
      },
    }
    const fixture = buildThreeSidecarGroups(root, ns, { clock: commitClock })
    a = fixture
    const dir = segmentsDirOf(root, ns, fixture.log.streamId)
    unlinkSync(`${dir}/00000001.jsonl`)
    const binPath = `${dir}/00000001.bin`
    armed = true
    // 红（HEAD）：P0 门不看租约 → BIN 照删 → orphanBinsDeleted=1（断言必红）
    const report = fixture.log.sweepRetention({ now: T0 })
    expect(report.leaseBlockedGroups).toBeGreaterThanOrEqual(1)
    expect(report.orphanBinsDeleted).toBe(0)
    expect(existsSync(binPath)).toBe(true)
    if (probeSlot.session !== null) track(probeSlot.session)
    expect(probeSlot.session !== null && probeSlot.session.closed).toBe(false)
  })
})

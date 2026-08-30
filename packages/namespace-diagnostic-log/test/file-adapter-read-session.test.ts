/**
 * 红灯契约 — Issue #154（SA6 编写）：strict reader 短期可续租读会话租约（AC-3）。
 *
 * 权威契约：`wiki/raw/task_issue-154_sa2_design.md` §2.3（DiagnosticReadSession 提议 API）、
 * §4.3（读会话状态机：TTL 惰性判定、快照租用、过期 ≠ 阻塞）、§5 INV-4/9、
 * §9 T-C1–T-C8 + T-B6（租约洞=前缀纪律）。ADR 0012 §Retention（「长期 reader 必须有
 * 最大 lease 时长或显式续租」——默认取显式续租模式）。
 *
 * 红灯性：当前主干无 `openDiagnosticReadSession` 导出（SA2 §2.3 提议增量）⇒ 本文件
 * 静态 import 即失败（vitest 运行时加载错误 + tsc 类型错误）——新导出缺失的红灯；
 * SA3 实现后按 §2.3 形状转绿。
 *
 * 全部断言针对运行时产物（sweep 报告、磁盘文件、会话状态机返回值）——零源码文本断言。
 */
import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  openDiagnosticReadSession,
  type DiagnosticReadSession,
  type DiagnosticReadSessionRequest,
} from '../src/index.js'
import type { FileDiagnosticLogConfig } from '../src/index.js'
import { baseEmission } from './helpers/base.js'
import {
  groupBytesOf,
  makeFileLog,
  makeTempRoot,
  patternedBytes,
  rmTempRoot,
  segmentEntriesOf,
  segmentPathsOf,
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

/** 可推进会话时钟（TTL 惰性判定与过期放行的确定性来源）。 */
interface CurrentTime {
  t: number
  now(): number
}

function newClock(start: number): CurrentTime {
  const c: CurrentTime = { t: start, now: () => c.t }
  return c
}

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

/** 三组构造（段1、2 闭 / 段3 开；全侧车帧）。retention 0/0：闭组恒过期——租约是唯一阻塞面。 */
function buildThreeGroups(root: string, ns: string): AssembledFileLog {
  const log = makeWriter(root, ns, { retention: { maxAgeMs: 0, maxBytesPerNamespace: 0, sweepOnOpen: false } })
  emit(log)
  emit(log)
  emit(log)
  expect(segmentEntriesOf(root, ns, log.log.streamId)).toHaveLength(6)
  return log
}

// ============================================================================
// T-C：读会话租约（AC-3）
// ============================================================================
describe('T-C 读会话租约（AC-3：短期可续租、过期不阻塞）', () => {
  it('T-C1 [红灯] 活跃租约阻塞：会话锁组 ⇒ 超龄 sweep 零删除 + leaseBlockedGroups ≥ 1', () => {
    const root = freshRoot()
    const ns = 'ns-c1'
    const a = buildThreeGroups(root, ns)
    // 会话覆盖 open 时刻枚举的段快照（含开组段3；TTL 未到期）——形状锚点：SA2 §2.3 请求形状
    const req: DiagnosticReadSessionRequest = {
      rootDir: root,
      namespaceId: ns,
      streamId: a.log.streamId,
      ttlMs: 60_000,
      clock: { now: () => T0 },
    }
    const session: DiagnosticReadSession = openDiagnosticReadSession(req)
    expect(session.segments).toEqual(['00000001', '00000002', '00000003'])
    const report = a.log.sweepRetention({ now: T0 + 1000 })
    expect(report.deletedGroups).toBe(0) // 活跃租约：闭组 1 被跳过并止步
    expect(report.leaseBlockedGroups).toBeGreaterThanOrEqual(1)
    expect(existsSync(segmentPathsOf(root, ns, a.log.streamId, '00000001').jsonlPath)).toBe(true) // 段1 未被删
  })

  it('T-C2 [红灯] close() 立即释放：同一轮 sweep 即删', () => {
    const root = freshRoot()
    const ns = 'ns-c2'
    const a = buildThreeGroups(root, ns)
    const session = openDiagnosticReadSession({
      rootDir: root,
      namespaceId: ns,
      streamId: a.log.streamId,
      ttlMs: 60_000,
      clock: { now: () => T0 },
    })
    session.close()
    expect(session.closed).toBe(true)
    const report = a.log.sweepRetention({ now: T0 + 1000 })
    expect(report.deletedGroups).toBe(2)
    expect(report.leaseBlockedGroups).toBe(0)
    expect(segmentEntriesOf(root, ns, a.log.streamId)).toEqual(['00000003.bin', '00000003.jsonl'])
  })

  it('T-C3 [红灯] TTL 过期放行：时钟越过 leasedUntil ⇒ sweep 照删（AC-3 后半句锚点）', () => {
    const root = freshRoot()
    const ns = 'ns-c3'
    const a = buildThreeGroups(root, ns)
    const clock = newClock(T0)
    const session = openDiagnosticReadSession({
      rootDir: root,
      namespaceId: ns,
      streamId: a.log.streamId,
      ttlMs: 1000,
      clock,
    })
    expect(session.leasedUntil).toBe(T0 + 1000)
    clock.t = T0 + 1001 // 惰性判定：过期 = 视同无租约
    const report = a.log.sweepRetention({ now: clock.t })
    expect(report.deletedGroups).toBe(2)
    expect(report.leaseBlockedGroups).toBe(0) // 过期租约不参与阻塞
  })

  it('T-C4 [红灯] 过期后 renew 重租（不复活数据）：renew()===true；快照不变；closed 仍 false', () => {
    const root = freshRoot()
    const ns = 'ns-c4'
    const a = buildThreeGroups(root, ns)
    const clock = newClock(T0)
    const session = openDiagnosticReadSession({
      rootDir: root,
      namespaceId: ns,
      streamId: a.log.streamId,
      ttlMs: 1000,
      clock,
    })
    clock.t = T0 + 2000 // 已过期；数据随后被 sweep 删
    const report = a.log.sweepRetention({ now: clock.t })
    expect(report.deletedGroups).toBe(2)
    // 过期后可重租（§2.3：租约是劝告锁——renew()===true 不保证快照仍完整）
    expect(session.renew()).toBe(true)
    expect(session.closed).toBe(false)
    expect(session.segments).toEqual(['00000001', '00000002', '00000003']) // 快照不增（数据不复活）
  })

  it('T-C5 [红灯] maxLifetimeMs 拒续：超总时长后 renew()===false；close() 幂等', () => {
    const root = freshRoot()
    const ns = 'ns-c5'
    const a = buildThreeGroups(root, ns)
    const clock = newClock(T0)
    const session = openDiagnosticReadSession({
      rootDir: root,
      namespaceId: ns,
      streamId: a.log.streamId,
      ttlMs: 1000,
      maxLifetimeMs: 2500, // 自 open 起最长 2.5s
      clock,
    })
    clock.t = T0 + 1000
    expect(session.renew()).toBe(true)
    clock.t = T0 + 2000
    // 续租至 3000 将超出 maxLifetimeMs=2500 ⇒ 拒续（解释性裁决：续租不得越界——见 sa6 报告歧义 #1）
    expect(session.renew()).toBe(false)
    session.close()
    expect(session.renew()).toBe(false) // 已 close：恒 false
    session.close() // 幂等
    expect(session.closed).toBe(true)
  })

  it('T-C6 [红灯] 快照集语义：open 后新滚出段不在 segments；租约保护旧前缀；close 后旧前缀全删、新段不受扰', () => {
    const root = freshRoot()
    const ns = 'ns-c6'
    const a = makeWriter(root, ns, { retention: { maxAgeMs: 0, maxBytesPerNamespace: 0, sweepOnOpen: false } })
    emit(a)
    emit(a) // 段1 闭、段2 开
    const session = openDiagnosticReadSession({
      rootDir: root,
      namespaceId: ns,
      streamId: a.log.streamId,
      ttlMs: 60_000,
      clock: { now: () => T0 },
    })
    expect(session.segments).toEqual(['00000001', '00000002'])
    emit(a) // open 之后滚出段 3（会话不感知——快照语义）
    expect(session.segments).toEqual(['00000001', '00000002'])
    expect(segmentEntriesOf(root, ns, a.log.streamId)).toContain('00000003.jsonl')

    const blocked = a.log.sweepRetention({ now: T0 + 1000 })
    expect(blocked.deletedGroups).toBe(0) // 快照租约锁住前缀（含段1）→ 止步
    session.close()
    const freed = a.log.sweepRetention({ now: T0 + 1000 })
    expect(freed.deletedGroups).toBe(2) // 释放后：段1、2（旧前缀闭组）全删
    expect(segmentEntriesOf(root, ns, a.log.streamId)).toEqual(['00000003.bin', '00000003.jsonl']) // 段3（快照外新组）开组原样
  })

  it('T-C7 [红灯] 跨实例可见性（INV-9）：无亲缘 adapter 的 sweep 尊重模块级租约注册表', () => {
    const root = freshRoot()
    const ns = 'ns-c7'
    const a = buildThreeGroups(root, ns)
    // 模块级注册表：openDiagnosticReadSession 与 adapter 无亲缘（纯函数）；进程内共享即正确性要求
    const session = openDiagnosticReadSession({
      rootDir: root,
      namespaceId: ns,
      streamId: a.log.streamId,
      ttlMs: 60_000,
      clock: { now: () => T0 },
    })
    // 另一 adapter 实例（同 root；独立构造）的 sweep 必须看见该租约（INV-9）
    const other = makeWriter(root, ns, { retention: { maxAgeMs: 0, maxBytesPerNamespace: 0, sweepOnOpen: false } })
    const report = other.log.sweepRetention({ now: T0 })
    expect(report.deletedGroups).toBe(0)
    expect(report.leaseBlockedGroups).toBeGreaterThanOrEqual(1)
    session.close()
  })

  it('T-C8 [红灯] 注册表隔离：不同 namespaceId 互不可见（租约不误伤他 namespace）', () => {
    const root = freshRoot()
    const ns1 = 'ns-c8-1'
    const ns2 = 'ns-c8-2'
    const a1 = buildThreeGroups(root, ns1)
    const a2 = buildThreeGroups(root, ns2)
    const session = openDiagnosticReadSession({
      rootDir: root,
      namespaceId: ns1,
      streamId: a1.log.streamId,
      ttlMs: 60_000,
      clock: { now: () => T0 },
    })
    const report = a2.log.sweepRetention({ now: T0 + 1000 })
    expect(report.deletedGroups).toBe(2) // ns2 无租约 → 照删
    expect(segmentEntriesOf(root, ns1, a1.log.streamId)).toHaveLength(6) // ns1 受租约保护
    session.close()
  })

  it('T-B6 [红灯] 租约洞（INV-2 核心）：租约锁前缀 ⇒ 0/0 sweep 零删除，绝不「删后留前」成洞', () => {
    const root = freshRoot()
    const ns = 'ns-b6'
    const a = buildThreeGroups(root, ns)
    const session = openDiagnosticReadSession({
      rootDir: root,
      namespaceId: ns,
      streamId: a.log.streamId,
      ttlMs: 60_000,
      clock: { now: () => T0 },
    })
    const report = a.log.sweepRetention({ now: T0 + 1000 })
    expect(report.deletedGroups).toBe(0) // 前缀纪律：首个不可删组即止步
    // 洞的反向断言：段 1、2 同时幸存（无「删 2 留 1」）
    expect(segmentEntriesOf(root, ns, a.log.streamId)).toHaveLength(6)
    expect(existsSync(segmentPathsOf(root, ns, a.log.streamId, '00000001').jsonlPath)).toBe(true)
    expect(existsSync(segmentPathsOf(root, ns, a.log.streamId, '00000002').jsonlPath)).toBe(true)
    // 释放后正常删
    session.close()
    const freed = a.log.sweepRetention({ now: T0 + 1000 })
    expect(freed.deletedGroups).toBe(2)
    expect(groupBytesOf(segmentPathsOf(root, ns, a.log.streamId, '00000001'))).toBe(0)
  })
})

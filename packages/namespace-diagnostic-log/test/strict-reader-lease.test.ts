/**
 * 红灯契约 — Issue #227（SA6 编写）：strict reader 全程持约读取（AC1/AC2/AC5）。
 *
 * 权威契约：`wiki/raw/task_issue-227_design.md`（R1.1）§3.2（④′ 会话取得与防御门 /
 * §3.2.3 逐段续租检查点 / §3.2.4 segment-vanished 检测）/ §8.1（A1–A5 矩阵）/
 * §8.6（外部 session 用例 afterEach close、步进假钟纪律）。
 *
 * 红灯性（HEAD = 本文件编写时点）：
 * - A1/A2/A3a/A3c/A4a/A4b 断言「request.session 提供时的快照/续租/vanished/防御门」
 *   语义——HEAD 的 `readStreamStrict` 无 session 字段（请求面三字段），传入的
 *   session 被忽略（自枚举/自读取），断言必然红灯；SA3 按 §3.2 接线后翻绿。
 * - A3b/A4c/A5 为「零回退等价」保护臂（HEAD 已绿，S0′/④′ 改造不得回退）。
 * - 全部断言针对运行时产物（读状态/issue 码/records/注册表可观测行为）；
 *   零源码文本断言、零测试抑制。
 */
import { existsSync, renameSync, rmSync, unlinkSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  openDiagnosticReadSession,
  readStreamStrict,
  type DiagnosticReadSession,
  type StrictReadRequest,
  type StrictStreamRead,
} from '../src/index.js'
import type { FileDiagnosticLogConfig } from '../src/index.js'
import { baseEmission } from './helpers/base.js'
import {
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

/** 步进假钟：每次 now() 调用前进 step ms（设计 §8.6——多取时点必须逐次前进）。 */
function stepClock(start: number, step: number): { now(): number } {
  let t = start - step
  return { now: () => (t += step) }
}

/** 无 genesis 多段 sidecar 流（每段恰一条 attempt；段 1..n-1 闭、段 n 开）。 */
function buildSegments(root: string, ns: string, count: number, extra: Record<string, unknown> = {}): AssembledFileLog {
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
  for (let i = 0; i < count; i++) {
    log.log.emitter.emit(
      baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: payload } }),
    )
  }
  return log
}

function segmentsDirOf(root: string, ns: string, streamId: string): string {
  return `${root}/namespaces/${ns}/streams/${streamId}/segments`
}

function withSession(request: Omit<StrictReadRequest, 'session'> & { session: DiagnosticReadSession }): StrictStreamRead {
  // session 字段为 #227 提议增量（HEAD 类型面尚无）——以扩展形状直通，断言交给运行时
  return readStreamStrict(request as StrictReadRequest & { session: DiagnosticReadSession })
}

function seqsOf(read: StrictStreamRead): string[] {
  return read.records.map((r) => r.sequence)
}

function track(session: DiagnosticReadSession): DiagnosticReadSession {
  openSessions.push(session)
  return session
}

// ============================================================================
// A1 — 快照驱动（会话 segments 即枚举；open 后新滚出段不可见）
// ============================================================================
describe('A1 快照驱动（AC1/AC5：session.segments 即枚举，open 后新段不可见）', () => {
  it('A1 [红灯] 外部 session open 后 writer 再滚新段 ⇒ 带 session 读不见新段记录；无 session 对照读得见', () => {
    const root = freshRoot()
    const ns = 'ns-227-a1'
    const a = buildSegments(root, ns, 3)
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

    const before = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: a.log.streamId })
    expect(seqsOf(before)).toEqual(['1', '2', '3']) // 夹具自证

    // writer 在 session open 之后再滚出新段 4
    a.log.emitter.emit(
      baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(64) } }),
    )
    expect(session.segments).toEqual(['00000001', '00000002', '00000003']) // 快照不感知新段

    const withSnap = withSession({ rootDir: root, namespaceId: ns, streamId: a.log.streamId, session })
    // 红：HEAD 忽略 session、自枚举可见 seq4 → seqs=[1,2,3,4]；修后：快照驱动 → [1,2,3]
    expect(seqsOf(withSnap)).toEqual(['1', '2', '3'])
    expect(withSnap.status).toBe('ok')

    const without = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: a.log.streamId })
    expect(seqsOf(without)).toEqual(['1', '2', '3', '4']) // 对照组：无 session（自租约）读得见新段
  })
})

// ============================================================================
// A2 — 逐段续租检查点（bounded 拒续 → lease-expired；unbounded → ok）
// ============================================================================
describe('A2 续租检查点（AC1/AC5：长读取按冻结策略续租或诚实失败）', () => {
  it('A2 [红灯] bounded maxLifetimeMs + 步进假钟 ⇒ corrupt + lease-expired（segment 归因）、已读 records 保留', () => {
    const root = freshRoot()
    const ns = 'ns-227-a2'
    const a = buildSegments(root, ns, 4)
    const clock = stepClock(T0, 12_000)
    const session = track(
      openDiagnosticReadSession({
        rootDir: root,
        namespaceId: ns,
        streamId: a.log.streamId,
        ttlMs: 45_000,
        maxLifetimeMs: 45_000, // bounded：续租越界即解释性拒续（read-session.ts renew 语义）
        clock,
      }),
    )
    // 红：HEAD 忽略 session → ok + 全量 records；修后：段 4 检查点续租被拒 →
    // corrupt + lease-expired(00000004)、已读段 1..3 records 保留
    const read = withSession({ rootDir: root, namespaceId: ns, streamId: a.log.streamId, session })
    expect(read.status).toBe('corrupt')
    const expired = read.issues.find((i) => i.code === 'lease-expired')
    expect(expired).toBeDefined()
    expect(expired?.segment).toBe('00000004')
    expect(seqsOf(read)).toEqual(['1', '2', '3']) // 诚实失败：停止读取、保留已读 records
  })

  it('A2 [绿灯对照] 同钟 unbounded（maxLifetimeMs=null）⇒ ok + 全量 records（显式续租永不失败臂）', () => {
    const root = freshRoot()
    const ns = 'ns-227-a2u'
    const a = buildSegments(root, ns, 4)
    const clock = stepClock(T0, 12_000)
    const session = track(
      openDiagnosticReadSession({
        rootDir: root,
        namespaceId: ns,
        streamId: a.log.streamId,
        ttlMs: 45_000,
        maxLifetimeMs: null,
        clock,
      }),
    )
    const read = withSession({ rootDir: root, namespaceId: ns, streamId: a.log.streamId, session })
    expect(read.status).toBe('ok')
    expect(read.issues).toEqual([])
    expect(seqsOf(read)).toEqual(['1', '2', '3', '4'])
  })
})

// ============================================================================
// A3 — segment-vanished 兜底（快照里有、盘上无 = 租约窗内被删/到期后被扫）
// ============================================================================
describe('A3 vanished 兜底（AC2/AC5：租约契约的可观测兜底，零静默空读）', () => {
  it('A3a [红灯] session open 后整组 rm（jsonl+bin）⇒ corrupt + segment-vanished（segment 归因）、前缀 records 保留', () => {
    const root = freshRoot()
    const ns = 'ns-227-a3a'
    const a = buildSegments(root, ns, 3)
    const session = track(
      openDiagnosticReadSession({
        rootDir: root,
        namespaceId: ns,
        streamId: a.log.streamId,
        ttlMs: 60_000,
        clock: { now: () => T0 },
      }),
    )
    const dir = segmentsDirOf(root, ns, a.log.streamId)
    // 租约窗内整组消失（模拟 sweep 违约删除 / 到期后被扫）
    rmSync(`${dir}/00000003.jsonl`)
    rmSync(`${dir}/00000003.bin`)
    // 红：HEAD 忽略 session → 自枚举不见组 3 → ok 零 issue（历史裁剪包络）；
    // 修后：快照驱动 → 段 3 jsonl ENOENT ∧ bin 缺失 → segment-vanished + corrupt
    const read = withSession({ rootDir: root, namespaceId: ns, streamId: a.log.streamId, session })
    expect(read.status).toBe('corrupt')
    const vanished = read.issues.find((i) => i.code === 'segment-vanished')
    expect(vanished).toBeDefined()
    expect(vanished?.segment).toBe('00000003')
    expect(seqsOf(read)).toEqual(['1', '2'])
  })

  it('A3b [绿灯对照] 只删最大段 jsonl 留 bin（BIN-first 合法崩溃窗口）⇒ ok 零行零 issue', () => {
    const root = freshRoot()
    const ns = 'ns-227-a3b'
    const a = buildSegments(root, ns, 3)
    const session = track(
      openDiagnosticReadSession({
        rootDir: root,
        namespaceId: ns,
        streamId: a.log.streamId,
        ttlMs: 60_000,
        clock: { now: () => T0 },
      }),
    )
    unlinkSync(`${segmentsDirOf(root, ns, a.log.streamId)}/00000003.jsonl`)
    const read = withSession({ rootDir: root, namespaceId: ns, streamId: a.log.streamId, session })
    // BIN-first 窗口 pin 保留：bin 在 ∧ marker 不在 → 零行零 issue、状态 ok
    expect(read.status).toBe('ok')
    expect(read.issues).toEqual([])
    expect(seqsOf(read)).toEqual(['1', '2'])
  })

  it('A3c [红灯] session open 后合成 .deleting marker（jsonl rename）⇒ corrupt + segment-vanished（segment 归因）', () => {
    const root = freshRoot()
    const ns = 'ns-227-a3c'
    const a = buildSegments(root, ns, 3)
    const session = track(
      openDiagnosticReadSession({
        rootDir: root,
        namespaceId: ns,
        streamId: a.log.streamId,
        ttlMs: 60_000,
        clock: { now: () => T0 },
      }),
    )
    const dir = segmentsDirOf(root, ns, a.log.streamId)
    // S1 提交后中间态：jsonl → .deleting（bin 留存；marker 组对一切新枚举不可见）
    renameSync(`${dir}/00000002.jsonl`, `${dir}/00000002.deleting`)
    // 红：HEAD 忽略 session → 枚举剔除 marker 组 → 无 vanished 归因；
    // 修后：快照驱动 → 段 2 jsonl ENOENT ∧ marker 在 → segment-vanished(00000002)
    const read = withSession({ rootDir: root, namespaceId: ns, streamId: a.log.streamId, session })
    expect(read.status).toBe('corrupt')
    const vanished = read.issues.find((i) => i.code === 'segment-vanished')
    expect(vanished).toBeDefined()
    expect(vanished?.segment).toBe('00000002')
  })
})

// ============================================================================
// A4 — 防御门（身份不符 / 已 close / enumerationFailed）
// ============================================================================
describe('A4 会话防御门（AC1：闭会话与异身份会话不得静默裸读）', () => {
  it('A4a [红灯] 传入身份不符 session（异 namespaceId）⇒ corrupt + locator-invalid（零 fs 归因）', () => {
    const root = freshRoot()
    const ns1 = 'ns-227-a4a1'
    const ns2 = 'ns-227-a4a2'
    const a1 = buildSegments(root, ns1, 2)
    const a2 = buildSegments(root, ns2, 2)
    const foreign = track(
      openDiagnosticReadSession({
        rootDir: root,
        namespaceId: ns2,
        streamId: a2.log.streamId,
        ttlMs: 60_000,
        clock: { now: () => T0 },
      }),
    )
    // 红：HEAD 忽略 session → ns1 全量 ok；修后：身份不符 → corrupt + locator-invalid、零 fs
    const read = withSession({ rootDir: root, namespaceId: ns1, streamId: a1.log.streamId, session: foreign })
    expect(read.status).toBe('corrupt')
    expect(read.issues.some((i) => i.code === 'locator-invalid')).toBe(true)
    expect(read.records).toEqual([])
  })

  it('A4b [红灯] 传入已 close 的 session ⇒ corrupt + lease-expired（闭会话无保护，不静默裸读）', () => {
    const root = freshRoot()
    const ns = 'ns-227-a4b'
    const a = buildSegments(root, ns, 2)
    const session = openDiagnosticReadSession({
      rootDir: root,
      namespaceId: ns,
      streamId: a.log.streamId,
      ttlMs: 60_000,
      clock: { now: () => T0 },
    })
    session.close()
    expect(session.closed).toBe(true)
    // 红：HEAD 忽略 session → 全量 ok；修后：closed 防御门 → corrupt + lease-expired
    const read = withSession({ rootDir: root, namespaceId: ns, streamId: a.log.streamId, session })
    expect(read.status).toBe('corrupt')
    expect(read.issues.some((i) => i.code === 'lease-expired')).toBe(true)
    expect(read.records).toEqual([])
  })

  it('A4c [绿灯等价] 传入 enumerationFailed 会话（segments 目录缺失）⇒ 与现状 corrupt + manifest-invalid 包络逐字节等同', () => {
    const root = freshRoot()
    const ns = 'ns-227-a4c'
    const a = buildSegments(root, ns, 2)
    const dir = segmentsDirOf(root, ns, a.log.streamId)
    rmSync(dir, { recursive: true, force: true }) // manifest 在、segments/ 缺失
    const session = track(
      openDiagnosticReadSession({
        rootDir: root,
        namespaceId: ns,
        streamId: a.log.streamId,
        ttlMs: 60_000,
        clock: { now: () => T0 },
      }),
    )
    expect(session.segments).toEqual([]) // 枚举失败 → 空快照（修后 enumerationFailed=true 承载该事实）
    const plain = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: a.log.streamId })
    const withSnap = withSession({ rootDir: root, namespaceId: ns, streamId: a.log.streamId, session })
    expect(withSnap.status).toBe('corrupt')
    expect(withSnap.issues.map((i) => i.code)).toEqual(plain.issues.map((i) => i.code))
    expect(withSnap.issues.some((i) => i.code === 'manifest-invalid')).toBe(true)
    expect(withSnap.records).toEqual([])
  })
})

// ============================================================================
// A5 — 无泄漏（自租约路径读后注册表可再删；重复调用无累积）
// ============================================================================
describe('A5 无泄漏（AC1：自开会话在函数返回前 close——注册表零残留的可观测证明）', () => {
  it('A5 [绿灯] 无 session 自租约读后立即 0/0 sweep ⇒ 全部闭组可删（close 生效证明）', () => {
    const root = freshRoot()
    const ns = 'ns-227-a5'
    const a = buildSegments(root, ns, 4, {
      retention: { maxAgeMs: 0, maxBytesPerNamespace: 0, sweepOnOpen: false },
    })
    readStreamStrict({ rootDir: root, namespaceId: ns, streamId: a.log.streamId }) // 自租约路径（无 session 传参）
    const report = a.log.sweepRetention({ now: T0 + 1000 })
    // 若无泄漏：读返回时会话已 close → 租约不阻塞 → 闭组 1..3 全删、开组 4 止步
    expect(report.deletedGroups).toBe(3)
    expect(report.leaseBlockedGroups).toBe(0)
    expect(report.failedSteps).toBe(0)
  })

  it('A5 [绿灯] 重复自租约读不累积注册表条目（两次读 + sweep 均零阻塞）', () => {
    const root = freshRoot()
    const ns = 'ns-227-a5b'
    const a = buildSegments(root, ns, 4, {
      retention: { maxAgeMs: 0, maxBytesPerNamespace: 0, sweepOnOpen: false },
    })
    readStreamStrict({ rootDir: root, namespaceId: ns, streamId: a.log.streamId })
    readStreamStrict({ rootDir: root, namespaceId: ns, streamId: a.log.streamId })
    const report = a.log.sweepRetention({ now: T0 + 1000 })
    expect(report.deletedGroups).toBe(3)
    expect(report.leaseBlockedGroups).toBe(0)
    // 闭组已删、开组在 → 无 jsonl 残留洞
    expect(existsSync(`${segmentsDirOf(root, ns, a.log.streamId)}/00000001.jsonl`)).toBe(false)
    expect(existsSync(`${segmentsDirOf(root, ns, a.log.streamId)}/00000004.jsonl`)).toBe(true)
  })
})

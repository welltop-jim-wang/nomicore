/**
 * 红灯契约 — Issue #227（SA6 编写）：replay 全程持约 + 完整性判定收紧（AC1–AC5）。
 *
 * 权威契约：`wiki/raw/task_issue-227_design.md`（R1.1）§3.4（replay session 生命周期
 * 与 finally close）/ §4.3（materialize switch 分类、N-1/N-2 次序备案）/ §8.4（D1–D9
 * 矩阵）；SA2 复审 `wiki/raw/task_issue-227_sa2_review.md` §4 binding 约束
 * K-2（fatal-committed-false-omitted 翻转 pin）/ K-3（非法 readSession 不抛 →
 * failed + replay-internal-error）；SA5 复现实测基线 `wiki/raw/20260906-bug-issue-227.md` §5。
 *
 * 红灯性（HEAD = 本文件编写时点；今日实测值见各用例注释）：
 * - D1 [红]：`readSession` 请求面不存在（编译面直通断言）——bounded 配置下 replay
 *   今日整链 complete；修后 lease-expired 诚实中止（partial）。
 * - D3 [红]：fatal-committed-unknown 今日推进至 complete（issues=[]、lastSeq='4'）；
 *   修后 partial + update-unknown + lastSeq='2'（不推进过该 record）。同语义即
 *   sa7.test.ts 重点 4 的改写（K-1，同 change）。
 * - D4c（K-2）[红]：fatal/committed:false/effect:'update-omitted' 今日 complete；
 *   修后 partial + update-omitted、不推进。
 * - D4d（N-1）[红]：乱序 ∧ committed-omitted 今日 [sequence-gap, update-omitted]；
 *   修后连续性复核先命中 → update-omitted 从 issue 集合消失。
 * - D8（F-1）[红]：手拼 fatal/committed:true（无 effect 字段）今日 complete；
 *   修后 partial + update-unknown + 不推进过该 record。
 * - K-3 [红]：非法 readSession（ttlMs:0 / maxLifetimeMs:0）今日被忽略（complete）；
 *   修后不抛、failed + replay-internal-error。
 * - D2/D4a/D4b/D5/D6/D7/D9 为保真/零回退 pin（HEAD 已绿；SA3 不得回退）——
 *   D9 钉 SA5 实测的 fail-closed 集合形状（N-2 叙事的翻转在该夹具上不可观测，
 *   以实测形状为准）。
 * - 全部断言针对运行时产物（replay 报告 / Y.Doc 解码快照 / sweep 报告）；
 *   零源码文本断言、零测试抑制。
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  createFileDiagnosticLog,
  readStreamStrict,
  type NamespaceDiagnosticChangeEmission,
  type StrictStreamRead,
} from '../../../packages/namespace-diagnostic-log/src/index.js'
import { replayNamespaceDiagnosticLog, type DiagnosticReplayResult } from '../src/index.js'
import type { ReplayNamespaceDiagnosticLogRequest } from '../src/index.js'

const T0 = Date.parse('2026-08-28T12:00:00.000Z')

const tempRoots: string[] = []

function freshRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// ── 夹具（与 sa7.test.ts / SA5 复现脚本同源）──────────────────────────────────

let attemptCounter = 0
function emissionFor(result: NamespaceDiagnosticChangeEmission['result']): NamespaceDiagnosticChangeEmission {
  attemptCounter += 1
  const hex = attemptCounter.toString(16).padStart(32, '0').slice(0, 32)
  return {
    operation: 'root-mutation',
    stage: 'transaction',
    observedAt: new Date(T0).toISOString(),
    attemptId: `att-${hex}`,
    source: { kind: 'local' },
    result,
  }
}

function prodDoc(namespaceId: string, count: number): Y.Doc {
  const doc = new Y.Doc()
  doc.getMap('META').set('docId', namespaceId)
  doc.getMap('ROOT').set('count', count)
  return doc
}

function currentStreamIdOf(rootDir: string, ns: string): string {
  const locator = JSON.parse(readFileSync(join(rootDir, 'namespaces', ns, 'current.json'), 'utf8')) as {
    streamId: string
  }
  return locator.streamId
}

function segmentsDirOf(rootDir: string, ns: string, streamId: string): string {
  return join(rootDir, 'namespaces', ns, 'streams', streamId, 'segments')
}

function jsonlPathOf(rootDir: string, ns: string): string {
  const sid = currentStreamIdOf(rootDir, ns)
  const dir = segmentsDirOf(rootDir, ns, sid)
  const file = readdirSync(dir).find((f) => f.endsWith('.jsonl')) as string
  return join(dir, file)
}

interface ChainLog {
  rootDir: string
  ns: string
  streamId: string
  prod: Y.Doc
}

/** 单段健康链：genesis(seq1) + attempts 依序（真实 yjs 字节，inline 阈值内）。 */
function buildHealthyChain(rootDir: string, ns: string, updates: Array<{ to: number }>): ChainLog {
  const prod = prodDoc(ns, 1)
  const log = createFileDiagnosticLog({
    rootDir,
    namespaceId: ns,
    updateCapture: true,
    genesisUpdateBytes: Y.encodeStateAsUpdate(prod),
    clock: { now: () => T0 },
    retention: { maxAgeMs: null, maxBytesPerNamespace: null, sweepOnOpen: false },
  })
  let sv = Y.encodeStateVector(prod)
  for (const { to } of updates) {
    prod.getMap('ROOT').set('count', to)
    log.emitter.emit(
      emissionFor({ kind: 'committed', effect: 'update', updateBytes: Y.encodeStateAsUpdate(prod, sv) }),
    )
    sv = Y.encodeStateVector(prod)
  }
  return { rootDir, ns, streamId: log.streamId, prod }
}

/** 以盘面末行作信封模板追加手拼行（sequence/attemptId/result 覆盖）。 */
function appendLine(rootDir: string, ns: string, overrides: Record<string, unknown>): void {
  const jsonl = jsonlPathOf(rootDir, ns)
  const lines = readFileSync(jsonl, 'utf8').split('\n').filter((l) => l.length > 0)
  const tpl = JSON.parse(lines[lines.length - 1] as string) as Record<string, unknown>
  writeFileSync(jsonl, [...lines, JSON.stringify({ ...tpl, ...overrides })].join('\n') + '\n')
}

function decodeRootCount(snapshot: Uint8Array | undefined): unknown {
  expect(snapshot, 'snapshot 应存在（有重放基）').toBeInstanceOf(Uint8Array)
  const doc = new Y.Doc()
  Y.applyUpdate(doc, snapshot as Uint8Array)
  return doc.getMap('ROOT').get('count')
}

function codesOf(result: DiagnosticReplayResult): string[] {
  return result.issues.map((i) => i.code)
}

/** 步进假钟：每次 now() 调用前进 step ms（设计 §8.6）。 */
function stepClock(start: number, step: number): { now(): number } {
  let t = start - step
  return { now: () => (t += step) }
}

/** #227 提议增量请求面直通（HEAD 类型面无 readSession——运行时断言为准）。 */
function replayWith(request: ReplayNamespaceDiagnosticLogRequest & Record<string, unknown>): DiagnosticReplayResult {
  return replayNamespaceDiagnosticLog(request as ReplayNamespaceDiagnosticLogRequest)
}

const FATAL_COMMITTED_TRUE_NO_EFFECT = { kind: 'fatal', committed: true } // schema.ts:178 第 5 成员（effect 缺席）
const OMITTED_REASON = 'payload-too-large'

// ============================================================================
// D1 — 到期/续租（AC1/AC5：bounded 拒续 → 诚实失败；unbounded 同钟 → complete）
// ============================================================================
describe('D1 lease 到期/续租（AC1：长 replay 按冻结策略续租或诚实失败）', () => {
  it('D1 [红灯] bounded maxLifetimeMs + 步进假钟 ⇒ partial + lease-expired、lastSeq 停在最后成功物化记录', () => {
    const rootDir = freshRoot('sa6-227-d1-')
    const ns = 'ns-227-d1'
    // 4 记录单段链：genesis(1) + update(2→5) + update(3→9) + update(4→12)
    buildHealthyChain(rootDir, ns, [{ to: 5 }, { to: 9 }, { to: 12 }])
    // 红：HEAD 请求面无 readSession（直通被忽略）→ complete + issues=[] + lastSeq='4'；
    // 修后：段内逐条物化前续租检查点在 update(seq4) 处被 bounded 拒续 →
    // partial + [{code:'lease-expired'}] + lastSeq='3'
    const result = replayWith({
      rootDir,
      namespaceId: ns,
      readSession: { ttlMs: 45_000, maxLifetimeMs: 45_000, clock: stepClock(T0, 10_000) },
    })
    expect(result.status).toBe('partial')
    expect(result.issues).toEqual([{ code: 'lease-expired' }])
    expect(result.lastAppliedSequence).toBe('3')
    expect(decodeRootCount(result.snapshot)).toBe(9) // 前缀态（seq3 已物化）
  })

  it('D1 [绿灯对照] 同钟 unbounded（maxLifetimeMs=null）⇒ complete + issues=[] + lastSeq 计入全链', () => {
    const rootDir = freshRoot('sa6-227-d1u-')
    const ns = 'ns-227-d1u'
    buildHealthyChain(rootDir, ns, [{ to: 5 }, { to: 9 }, { to: 12 }])
    const result = replayWith({
      rootDir,
      namespaceId: ns,
      readSession: { ttlMs: 45_000, maxLifetimeMs: null, clock: stepClock(T0, 10_000) },
    })
    expect(result.status).toBe('complete')
    expect(result.issues).toEqual([])
    expect(result.lastAppliedSequence).toBe('4')
    expect(decodeRootCount(result.snapshot)).toBe(12)
  })
})

// ============================================================================
// D2 — 会话恒释放（AC1：replay 返回后租约已 close——sweep 立即可删）
// ============================================================================
describe('D2 会话恒释放（AC1：finally close 的端到端可观测证明）', () => {
  it('D2 [绿灯] replay 完成后立即 0/0 sweep ⇒ 全部闭组可删（结果本身不受影响）', () => {
    const rootDir = freshRoot('sa6-227-d2-')
    const ns = 'ns-227-d2'
    // 4 段链（每段恰一记录：genesis 段 1 + 段 2..4 闭组；段 4 为开组）
    const prod = prodDoc(ns, 1)
    const log = createFileDiagnosticLog({
      rootDir,
      namespaceId: ns,
      updateCapture: true,
      genesisUpdateBytes: Y.encodeStateAsUpdate(prod),
      targetRecordsPerSegment: 1,
      clock: { now: () => T0 },
      retention: { maxAgeMs: 0, maxBytesPerNamespace: 0, sweepOnOpen: false },
    })
    let sv = Y.encodeStateVector(prod)
    for (const to of [5, 9, 12]) {
      prod.getMap('ROOT').set('count', to)
      log.emitter.emit(
        emissionFor({ kind: 'committed', effect: 'update', updateBytes: Y.encodeStateAsUpdate(prod, sv) }),
      )
      sv = Y.encodeStateVector(prod)
    }
    const replay = replayNamespaceDiagnosticLog({ rootDir, namespaceId: ns })
    expect(replay.status).toBe('complete') // replay 结果不受影响
    expect(replay.lastAppliedSequence).toBe('4')
    // replay 内部 session 已 close（finally）→ 闭组 1..3 立即可删、开组 4 止步
    const report = log.sweepRetention({ now: T0 + 1000 })
    expect(report.deletedGroups).toBe(3)
    expect(report.leaseBlockedGroups).toBe(0)
  })
})

// ============================================================================
// D3 — unknown committed effect（AC3；与 sa7.test.ts 重点 4 改写同语义）
// ============================================================================
describe('D3 unknown committed effect（AC3：fatal-committed-unknown 不再推进至 complete）', () => {
  it('D3 [红灯] genesis + update + fatal-unknown + update ⇒ partial + update-unknown、lastSeq 停在 fatal-unknown 前、快照复现前缀态', () => {
    const rootDir = freshRoot('sa6-227-d3-')
    const ns = 'ns-227-d3'
    const prod = prodDoc(ns, 1)
    const log = createFileDiagnosticLog({
      rootDir,
      namespaceId: ns,
      updateCapture: true,
      genesisUpdateBytes: Y.encodeStateAsUpdate(prod),
      clock: { now: () => T0 },
      retention: { maxAgeMs: null, maxBytesPerNamespace: null, sweepOnOpen: false },
    })
    let sv = Y.encodeStateVector(prod)
    prod.getMap('ROOT').set('count', 5)
    log.emitter.emit(
      emissionFor({ kind: 'committed', effect: 'update', updateBytes: Y.encodeStateAsUpdate(prod, sv) }),
    )
    // emitter 合法产出 fatal/committed:true/effect:'unknown'
    log.emitter.emit(emissionFor({ kind: 'fatal', committed: true, effect: 'unknown' }))
    sv = Y.encodeStateVector(prod)
    prod.getMap('ROOT').set('count', 9)
    log.emitter.emit(
      emissionFor({ kind: 'committed', effect: 'update', updateBytes: Y.encodeStateAsUpdate(prod, sv) }),
    )
    // 红（今日实测：complete / issues=[] / lastSeq='4' / 快照 count=9）；
    // 修后：partial + update-unknown + lastSeq='2' + 快照 count=5（前缀态，seq4 不进入）
    const result = replayNamespaceDiagnosticLog({ rootDir, namespaceId: ns })
    expect(result.status).toBe('partial')
    expect(result.issues).toEqual([{ code: 'update-unknown' }])
    expect(result.lastAppliedSequence).toBe('2')
    expect(decodeRootCount(result.snapshot)).toBe(5)
  })
})

// ============================================================================
// D4 — omitted（AC4：committed / fatal-committed 双面 + K-2 翻转 + N-1 次序）
// ============================================================================
describe('D4 omitted（AC4：必要但省略的 update 必止步 + K-2/N-1 翻转 pin）', () => {
  it('D4a [绿灯] committed/effect:update-omitted（既有 R7 语义保留）⇒ partial + update-omitted、不推进', () => {
    const rootDir = freshRoot('sa6-227-d4a-')
    const ns = 'ns-227-d4a'
    buildHealthyChain(rootDir, ns, [{ to: 5 }, { to: 9 }])
    appendLine(rootDir, ns, {
      sequence: '4',
      attemptId: 'att-' + 'co'.padEnd(32, '0'),
      result: { kind: 'committed', effect: 'update-omitted', reason: OMITTED_REASON },
    })
    const result = replayNamespaceDiagnosticLog({ rootDir, namespaceId: ns })
    expect(result.status).toBe('partial')
    expect(result.issues).toEqual([{ code: 'update-omitted' }])
    expect(result.lastAppliedSequence).toBe('3')
  })

  it('D4b [绿灯] fatal/committed:true/effect:update-omitted ⇒ partial + update-omitted、不推进', () => {
    const rootDir = freshRoot('sa6-227-d4b-')
    const ns = 'ns-227-d4b'
    buildHealthyChain(rootDir, ns, [{ to: 5 }, { to: 9 }])
    appendLine(rootDir, ns, {
      sequence: '4',
      attemptId: 'att-' + 'ft'.padEnd(32, '0'),
      result: { kind: 'fatal', committed: true, effect: 'update-omitted', reason: OMITTED_REASON },
    })
    const result = replayNamespaceDiagnosticLog({ rootDir, namespaceId: ns })
    expect(result.status).toBe('partial')
    expect(result.issues).toEqual([{ code: 'update-omitted' }])
    expect(result.lastAppliedSequence).toBe('3')
  })

  it('D4c [红灯·K-2] fatal/committed:false/effect:update-omitted（N-A 不对称翻转 pin）⇒ partial + update-omitted、不推进', () => {
    const rootDir = freshRoot('sa6-227-d4c-')
    const ns = 'ns-227-d4c'
    buildHealthyChain(rootDir, ns, [{ to: 5 }, { to: 9 }])
    appendLine(rootDir, ns, {
      sequence: '4',
      attemptId: 'att-' + 'na'.padEnd(32, '0'),
      result: { kind: 'fatal', committed: false, effect: 'update-omitted', reason: OMITTED_REASON },
    })
    // 红（今日实测：complete / issues=[] / lastSeq='4'——该形状被推进、complete 可达）；
    // 修后：materialize omitted 分支无条件触发 → partial + update-omitted、不推进（lastSeq='3'）
    const result = replayNamespaceDiagnosticLog({ rootDir, namespaceId: ns })
    expect(result.status).toBe('partial')
    expect(result.issues).toEqual([{ code: 'update-omitted' }])
    expect(result.lastAppliedSequence).toBe('3')
  })

  it('D4d [红灯·N-1] 乱序 ∧ committed-omitted ⇒ 连续性复核先命中：update-omitted 从 issue 集合消失（sequence-gap 存续）', () => {
    const rootDir = freshRoot('sa6-227-d4d-')
    const ns = 'ns-227-d4d'
    buildHealthyChain(rootDir, ns, [{ to: 5 }, { to: 9 }])
    appendLine(rootDir, ns, {
      sequence: '99', // 断链（expectedNext=4）
      attemptId: 'att-' + 'oo'.padEnd(32, '0'),
      result: { kind: 'committed', effect: 'update-omitted', reason: OMITTED_REASON },
    })
    // 红（今日实测：issues=[sequence-gap, update-omitted]——③ 镜像 gap + ④ 停止点先命中
    // omitted 检查）；修后：连续性复核先于物化/omitted 判定 → 停止点改由 gap 命中，
    // update-omitted 不再进入报告
    const result = replayNamespaceDiagnosticLog({ rootDir, namespaceId: ns })
    expect(result.status).toBe('partial')
    expect(result.lastAppliedSequence).toBe('3')
    const codes = codesOf(result)
    expect(codes).toContain('sequence-gap')
    expect(codes).not.toContain('update-omitted')
  })

  it('D4 夹具自证：乱序行的 entry 级读取仍 ok（断链判定属 replay 连续性复核职责）', () => {
    const rootDir = freshRoot('sa6-227-d4s-')
    const ns = 'ns-227-d4s'
    buildHealthyChain(rootDir, ns, [{ to: 5 }, { to: 9 }])
    appendLine(rootDir, ns, {
      sequence: '99',
      attemptId: 'att-' + 'os'.padEnd(32, '0'),
      result: { kind: 'committed', effect: 'update-omitted', reason: OMITTED_REASON },
    })
    const streamId = currentStreamIdOf(rootDir, ns)
    const read = readStreamStrict({ rootDir, namespaceId: ns, streamId })
    const broken = read.records.find((r) => r.sequence === '99')
    expect(broken?.ok).toBe(true)
    expect(read.status).toBe('corrupt') // reader 级连续性镜像（sequence-gap）先行
  })
})

// ============================================================================
// D5 — undecodable（AC4：无法解码的必要 update ——既有通道 pin）
// ============================================================================
describe('D5 undecodable（AC4：合法 CRC/长度但不可解码的 update 必止步）', () => {
  it('D5 [绿灯] 载体装合法帧 CRC 的非 yjs 字节 ⇒ partial + update-undecodable、不推进', () => {
    const rootDir = freshRoot('sa6-227-d5-')
    const ns = 'ns-227-d5'
    const prod = prodDoc(ns, 1)
    const log = createFileDiagnosticLog({
      rootDir,
      namespaceId: ns,
      updateCapture: true,
      genesisUpdateBytes: Y.encodeStateAsUpdate(prod),
      clock: { now: () => T0 },
      retention: { maxAgeMs: null, maxBytesPerNamespace: null, sweepOnOpen: false },
    })
    log.emitter.emit(emissionFor({ kind: 'committed', effect: 'update', updateBytes: new Uint8Array(64).fill(0xcd) }))
    const result = replayNamespaceDiagnosticLog({ rootDir, namespaceId: ns })
    expect(result.status).toBe('partial')
    expect(result.issues).toEqual([{ code: 'update-undecodable' }])
    expect(result.lastAppliedSequence).toBe('1') // genesis 已应用、该 update 应用失败
  })
})

// ============================================================================
// D6 — missing/畸形（AC4：断链与防御通道 pin）
// ============================================================================
describe('D6 missing/畸形（AC4：缺行断链 sequence-gap / 畸形必要 update fail-closed）', () => {
  it('D6a [绿灯] 中段删整行 ⇒ partial + sequence-gap、lastSeq 停在断链前（R5 保留）', () => {
    const rootDir = freshRoot('sa6-227-d6a-')
    const ns = 'ns-227-d6a'
    buildHealthyChain(rootDir, ns, [{ to: 5 }, { to: 9 }, { to: 12 }])
    const jsonl = jsonlPathOf(rootDir, ns)
    const lines = readFileSync(jsonl, 'utf8').split('\n').filter((l) => l.length > 0)
    const kept = lines.filter((l) => (JSON.parse(l) as { sequence: string }).sequence !== '3')
    expect(kept).toHaveLength(lines.length - 1)
    writeFileSync(jsonl, kept.join('\n') + '\n')
    const result = replayNamespaceDiagnosticLog({ rootDir, namespaceId: ns })
    expect(result.status).toBe('partial')
    const codes = codesOf(result)
    expect(codes).toContain('sequence-gap')
    expect(result.lastAppliedSequence).toBe('2') // 断链前最后可证 record
  })

  it('D6b [绿灯] 手拼 committed/effect:update + 畸形 update 字段 ⇒ 非 complete（vfsl-invalid 通道，G5 防御面）', () => {
    const rootDir = freshRoot('sa6-227-d6b-')
    const ns = 'ns-227-d6b'
    buildHealthyChain(rootDir, ns, [{ to: 5 }, { to: 9 }])
    appendLine(rootDir, ns, {
      sequence: '4',
      attemptId: 'att-' + 'g5'.padEnd(32, '0'),
      result: { kind: 'committed', effect: 'update', update: 42 }, // 畸形 carrier
    })
    const result = replayNamespaceDiagnosticLog({ rootDir, namespaceId: ns })
    expect(result.status).not.toBe('complete')
    expect(codesOf(result)).toContain('vfsl-invalid')
    expect(result.lastAppliedSequence).toBe('3')
  })
})

// ============================================================================
// D7 — 合法 complete replay 保真回归（AC5）
// ============================================================================
describe('D7 complete 保真回归（AC5：健康混合链 complete 全条件 + 快照逻辑等价终态）', () => {
  it('D7 [绿灯] genesis + updates + noop + rejected + fatal-committed:false 混合健康链 ⇒ complete、issues=[]、快照复现终态', () => {
    const rootDir = freshRoot('sa6-227-d7-')
    const ns = 'ns-227-d7'
    const prod = prodDoc(ns, 1)
    const log = createFileDiagnosticLog({
      rootDir,
      namespaceId: ns,
      updateCapture: true,
      genesisUpdateBytes: Y.encodeStateAsUpdate(prod),
      clock: { now: () => T0 },
      retention: { maxAgeMs: null, maxBytesPerNamespace: null, sweepOnOpen: false },
    })
    let sv = Y.encodeStateVector(prod)
    prod.getMap('ROOT').set('count', 5)
    log.emitter.emit(
      emissionFor({ kind: 'committed', effect: 'update', updateBytes: Y.encodeStateAsUpdate(prod, sv) }),
    )
    log.emitter.emit(emissionFor({ kind: 'committed', effect: 'noop' }))
    log.emitter.emit(emissionFor({ kind: 'rejected' }))
    log.emitter.emit(emissionFor({ kind: 'fatal', committed: false }))
    sv = Y.encodeStateVector(prod)
    prod.getMap('ROOT').set('count', 9)
    log.emitter.emit(
      emissionFor({ kind: 'committed', effect: 'update', updateBytes: Y.encodeStateAsUpdate(prod, sv) }),
    )
    const result = replayNamespaceDiagnosticLog({ rootDir, namespaceId: ns })
    expect(result.status).toBe('complete')
    expect(result.issues).toEqual([])
    expect(result.lastAppliedSequence).toBe('6') // genesis=1 + 五条 attempt 全部计入
    expect(decodeRootCount(result.snapshot)).toBe(9)
  })
})

// ============================================================================
// D8 — effect 缺席变体（R1.1-F1 的 replay 端 pin：AC3/AC4）
// ============================================================================
describe('D8 effect 缺席变体（AC3/AC4：fatal ∧ committed:true ∧ 无 effect 字段 → update-unknown + 不推进）', () => {
  it('D8 [红灯] genesis + 双 update + 手拼 fatal-committed-true 无 effect ⇒ partial + update-unknown、lastSeq 停在手拼行之前、快照前缀态', () => {
    const rootDir = freshRoot('sa6-227-d8-')
    const ns = 'ns-227-d8'
    buildHealthyChain(rootDir, ns, [{ to: 5 }, { to: 9 }])
    appendLine(rootDir, ns, {
      sequence: '4',
      attemptId: 'att-' + 'f1'.padEnd(32, '0'),
      result: FATAL_COMMITTED_TRUE_NO_EFFECT, // schema.ts:178 第 5 成员（VFSL 合法、emitter 不可达）
    })
    // 夹具自证：strict 读接受该形状（entry.ok=true——schema 不动）
    const read: StrictStreamRead = readStreamStrict({
      rootDir,
      namespaceId: ns,
      streamId: currentStreamIdOf(rootDir, ns),
    })
    expect(read.records.find((r) => r.sequence === '4')?.ok).toBe(true)
    // 红（今日实测：complete / issues=[] / lastSeq='4'）；
    // 修后：materialize unknown → partial + update-unknown、lastSeq='3'（不推进过该 record）
    const result = replayNamespaceDiagnosticLog({ rootDir, namespaceId: ns })
    expect(result.status).toBe('partial')
    expect(result.issues).toEqual([{ code: 'update-unknown' }])
    expect(result.lastAppliedSequence).toBe('3')
    expect(decodeRootCount(result.snapshot)).toBe(9) // 前缀态（seq3 已物化，seq4 不进入）
  })
})

// ============================================================================
// D9 — pre-genesis 损坏载体（N-2 备案的可观测形状 pin）
// ============================================================================
describe('D9 pre-genesis 损坏载体（AC4：前置 attempt + genesis 后移 + sidecar bin 缺失的 fail-closed 集合）', () => {
  it('D9 [绿灯] 手拼前置 attempt(seq1) + genesis(seq2) + 删 sidecar bin ⇒ failed + frame-missing/genesis-missing 并存、无重放基', () => {
    const rootDir = freshRoot('sa6-227-d9-')
    const ns = 'ns-227-d9'
    const prod = prodDoc(ns, 1)
    const log = createFileDiagnosticLog({
      rootDir,
      namespaceId: ns,
      updateCapture: true,
      genesisUpdateBytes: Y.encodeStateAsUpdate(prod),
      inlineUpdateMaxBytes: 8, // genesis 与 attempts 同为 sidecar（同 bin 受损）
      clock: { now: () => T0 },
      retention: { maxAgeMs: null, maxBytesPerNamespace: null, sweepOnOpen: false },
    })
    const payload = new Uint8Array(64).fill(0x42)
    for (let i = 0; i < 2; i++) {
      log.emitter.emit(emissionFor({ kind: 'committed', effect: 'update', updateBytes: payload }))
    }
    const dir = segmentsDirOf(rootDir, ns, log.streamId)
    const jsonl = join(dir, '00000001.jsonl')
    const lines = readFileSync(jsonl, 'utf8').split('\n').filter((l) => l.length > 0)
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>)
    expect(parsed.map((r) => r.recordKind)).toEqual(['genesis-baseline', 'attempt', 'attempt'])
    const attempt = parsed.find((r) => r.recordKind === 'attempt' && r.sequence === '2') as Record<string, unknown>
    const genesis = parsed.find((r) => r.recordKind === 'genesis-baseline') as Record<string, unknown>
    const rest = parsed.filter((r) => r !== attempt && r !== genesis)
    genesis.sequence = '2'
    attempt.sequence = '1'
    // 物理顺序：前置 attempt(1) → genesis 后移(2) → 其余 attempt(3)
    writeFileSync(jsonl, [JSON.stringify(attempt), JSON.stringify(genesis), ...rest.map((r) => JSON.stringify(r))].join('\n') + '\n')
    unlinkSync(join(dir, '00000001.bin'))
    // 实测形状（SA5 §5 D9 行，零倍数脆弱 pin）：failed + 4×frame-missing（③ 镜像 3 + ④ 停止点 1）
    // + genesis-missing（无重放基）；修后形状保持（!ok 路径与 ⑤ 兜底不受物化前置影响）
    const result = replayNamespaceDiagnosticLog({ rootDir, namespaceId: ns })
    expect(result.status).toBe('failed')
    expect(result.lastAppliedSequence).toBeNull()
    expect(result.snapshot).toBeUndefined()
    expect(codesOf(result)).toEqual([
      'frame-missing',
      'frame-missing',
      'frame-missing',
      'frame-missing',
      'genesis-missing',
    ])
  })
})

// ============================================================================
// K-3 — 非法 readSession 供参（N-B 收敛：不抛、failed + replay-internal-error）
// ============================================================================
describe('K-3 非法 readSession 供参（SA2 N-B binding：replay 不新生长 throw 面）', () => {
  function expectFailClosed(rootDir: string, ns: string, readSession: Record<string, unknown>): void {
    let threw: unknown = null
    let result: DiagnosticReplayResult | null = null
    try {
      result = replayWith({ rootDir, namespaceId: ns, readSession })
    } catch (err) {
      threw = err
    }
    expect(threw, 'replay 对非法 readSession 供参绝不向外抛').toBeNull()
    expect(result).not.toBeNull()
    expect(result?.status).toBe('failed')
    expect(result?.issues).toEqual([{ code: 'replay-internal-error' }]) // 既有收敛通道，零新码
    expect(result?.lastAppliedSequence).toBeNull()
    expect(result?.snapshot).toBeUndefined()
  }

  it('K-3 [红灯] readSession:{ttlMs:0} ⇒ 不抛、failed + replay-internal-error', () => {
    const rootDir = freshRoot('sa6-227-k3a-')
    const ns = 'ns-227-k3a'
    buildHealthyChain(rootDir, ns, [{ to: 5 }, { to: 9 }])
    // 红（今日实测：供参被忽略 → complete / issues=[]）；修后：open 校验失败收敛
    expectFailClosed(rootDir, ns, { ttlMs: 0 })
  })

  it('K-3 [红灯] readSession:{maxLifetimeMs:0} ⇒ 不抛、failed + replay-internal-error', () => {
    const rootDir = freshRoot('sa6-227-k3b-')
    const ns = 'ns-227-k3b'
    buildHealthyChain(rootDir, ns, [{ to: 5 }, { to: 9 }])
    expectFailClosed(rootDir, ns, { maxLifetimeMs: 0 })
  })
})

// 健康链文件级自证（其余用例依赖的基线形状）
describe('夹具自证（健康链基线）', () => {
  it('4 记录健康链 replay 基线：complete、issues=[]、lastSeq=4（D1/D3 的红基线）', () => {
    const rootDir = freshRoot('sa6-227-self-')
    const ns = 'ns-227-self'
    buildHealthyChain(rootDir, ns, [{ to: 5 }, { to: 9 }, { to: 12 }])
    const result = replayNamespaceDiagnosticLog({ rootDir, namespaceId: ns })
    expect(result.status).toBe('complete')
    expect(result.issues).toEqual([])
    expect(result.lastAppliedSequence).toBe('4')
    expect(existsSync(rootDir)).toBe(true) // 目录在（tempRoots 清理由 afterEach 负责）
  })
})

/**
 * 红灯契约 — Issue #154（SA6 编写）：namespace 日志逻辑删除（AC-4）。
 *
 * 权威契约：`wiki/raw/task_issue-154_sa2_design.md` §2.4（deleteNamespaceDiagnosticLog 提议 API
 * 与协议：deletion.json 意图标记/三步续走/结果联合）、§4.4（N0–N5 状态机）、
 * §5 INV-8/12/13、§9 T-D1–T-D9。ADR 0012 §Retention 与删除（删除清单 + 仅逻辑删除边界）。
 *
 * 红灯性：当前主干无 `deleteNamespaceDiagnosticLog` 导出（SA2 §2.4 提议增量）；本文件
 * 静态 import 即失败（vitest 运行时加载错误 + tsc 类型错误）——新导出缺失的红灯；
 * SA3 实现后按 §2.4 形状转绿。
 *
 * 断言全部针对运行时产物（返回值、磁盘树、observer 事件、会话状态）——零源码文本断言。
 */
import { existsSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deleteNamespaceDiagnosticLog,
  type NamespaceLogDeletionRequest,
  type NamespaceLogDeletionResult,
  openDiagnosticReadSession,
} from '../src/index.js'
import type { FileDiagnosticLogConfig } from '../src/index.js'
import { baseEmission } from './helpers/base.js'
import {
  bytesSnapshotOf,
  eventsOfTypeRaw,
  makeFileLog,
  makeTempRoot,
  patternedBytes,
  rmTempRoot,
  segmentEntriesOf,
  segmentPathsOf,
  streamPaths,
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

/** deletion.json 意图标记内容（SA2 §2.4 协议钉死形状）。 */
const DELETION_MARKER = JSON.stringify({ format: 'ndcl-deletion', version: 1 })

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

/** 完整 namespace 构造：1 条在段1 闭组（含 .bin）+ 段2 开组 + 常见残留物（current.json.tmp）。 */
function buildNamespace(root: string, ns: string): AssembledFileLog {
  const log = makeWriter(root, ns)
  emit(log)
  emit(log)
  const p = streamPaths(root, ns, log.log.streamId)
  // current.json.tmp 残留（ADR：locator 替换残留；删除清单显式覆盖）
  writeFileSync(join(p.namespaceDir, 'current.json.tmp'), '{"partial":true}')
  // 段级 .deleting 残留（W2 形——删除清单显式覆盖）
  const seg1 = segmentPathsOf(root, ns, log.log.streamId, '00000001')
  renameSync(seg1.jsonlPath, seg1.deletingPath)
  return log
}

/** 快照序对比较（Map → 排序 entries；字节恒等断言用）。 */
function snapshotPairs(map: Map<string, number>): Array<[string, number]> {
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

// ============================================================================
// T-D：namespace 日志逻辑删除（AC-4）
// ============================================================================
describe('T-D namespace 日志删除（AC-4：locator/manifest/jsonl/bin/标记/索引全清 + 语义边界）', () => {
  it('T-D1 [红灯] 全量覆盖：删除后 namespaceDir 不存在（locator/manifest/jsonl/bin/.deleting/deletion.json/current.json.tmp 全无）', () => {
    const root = freshRoot()
    const ns = 'ns-d1'
    const a = buildNamespace(root, ns)
    const p = streamPaths(root, ns, a.log.streamId)
    const req: NamespaceLogDeletionRequest = { rootDir: root, namespaceId: ns }
    const result: NamespaceLogDeletionResult = deleteNamespaceDiagnosticLog(req)
    expect(result.status).toBe('deleted')
    expect(result.status === 'deleted' && result.streamsRemoved).toBeGreaterThanOrEqual(1)
    // 逐对象清单（AC-4）：整个 namespace 路径树不存在
    expect(existsSync(p.namespaceDir)).toBe(false)
    expect(existsSync(p.currentPath)).toBe(false)
    expect(existsSync(join(p.namespaceDir, 'current.json.tmp'))).toBe(false)
    expect(existsSync(join(p.namespaceDir, 'deletion.json'))).toBe(false)
    expect(existsSync(p.streamsDir)).toBe(false)
    expect(existsSync(p.manifestPath)).toBe(false)
    expect(existsSync(segmentPathsOf(root, ns, a.log.streamId, '00000001').deletingPath)).toBe(false)
    expect(existsSync(segmentPathsOf(root, ns, a.log.streamId, '00000002').jsonlPath)).toBe(false)
  })

  it('T-D2 [红灯] 幂等：二次调用 {status:"absent"}（目录不存在即成功）', () => {
    const root = freshRoot()
    const ns = 'ns-d2'
    buildNamespace(root, ns)
    const first = deleteNamespaceDiagnosticLog({ rootDir: root, namespaceId: ns })
    expect(first.status).toBe('deleted')
    const second = deleteNamespaceDiagnosticLog({ rootDir: root, namespaceId: ns })
    expect(second.status).toBe('absent')
  })

  it('T-D3 [红灯] 非法 namespaceId（含 .. / 控制符 / 路径分隔）：failed + invalid-namespace-id + 零 fs 触达', () => {
    const bad = ['..', 'a/b', 'a\\b', 'ctl\u0000', 'ctl\u001f']
    let n = 0
    for (const id of bad) {
      n += 1
      const root = freshRoot()
      const result = deleteNamespaceDiagnosticLog({ rootDir: root, namespaceId: id })
      expect(result.status).toBe('failed')
      if (result.status === 'failed') {
        expect(result.code).toBe('invalid-namespace-id')
      }
      // 零 fs 触达：根下不产生 namespaces/ 目录（文法前置先于一切 IO）
      expect(existsSync(join(root, 'namespaces'))).toBe(false)
      void n
    }
  })

  it('T-D4 [红灯] 半态门（N1）：deletion.json 存在 ⇒ 构造 disabled + 恰一次 namespace-log-deleted + 零写入（含 emit）', () => {
    const root = freshRoot()
    const ns = 'ns-d4'
    const a = buildNamespace(root, ns)
    // N1 态：marker 落盘（current.json 尚在、树完整）
    writeFileSync(join(streamPaths(root, ns, a.log.streamId).namespaceDir, 'deletion.json'), DELETION_MARKER)
    const before = snapshotPairs(bytesSnapshotOf(streamPaths(root, ns, a.log.streamId).namespaceDir))

    const b = makeFileLog({
      rootDir: root,
      namespaceId: ns,
      updateCapture: true,
      targetRecordsPerSegment: 1,
      inlineUpdateMaxBytes: INLINE_T,
      clock: { now: () => T0 },
    } as unknown as Partial<FileDiagnosticLogConfig>)
    const failed = eventsOfTypeRaw(b.events, 'stream-init-failed')
    expect(failed).toHaveLength(1)
    expect((failed[0] as { reason: string }).reason).toBe('namespace-log-deleted')
    // 禁止复活：构造后 emit（同步、不抛、静默丢弃）→ 目录字节恒等
    emit(b)
    const after = snapshotPairs(bytesSnapshotOf(streamPaths(root, ns, a.log.streamId).namespaceDir))
    expect(after).toEqual(before)
  })

  it('T-D5 [红灯] 半态续走：N2/N3/N4 合成态 ⇒ 重入删除完成至 absent', () => {
    // N2：marker 在、current.json 已无、部分流残留
    const root2 = freshRoot()
    const ns2 = 'ns-d5-n2'
    const a2 = buildNamespace(root2, ns2)
    const p2 = streamPaths(root2, ns2, a2.log.streamId)
    writeFileSync(join(p2.namespaceDir, 'deletion.json'), DELETION_MARKER)
    unlinkSync(p2.currentPath)
    const r2 = deleteNamespaceDiagnosticLog({ rootDir: root2, namespaceId: ns2 })
    expect(r2.status).toBe('deleted')
    expect(existsSync(p2.namespaceDir)).toBe(false)

    // N3：某流已 rename 为 {s}.deleting、未 rm（marker 在）
    const root3 = freshRoot()
    const ns3 = 'ns-d5-n3'
    const a3 = buildNamespace(root3, ns3)
    const p3 = streamPaths(root3, ns3, a3.log.streamId)
    writeFileSync(join(p3.namespaceDir, 'deletion.json'), DELETION_MARKER)
    renameSync(p3.streamDir, join(p3.streamsDir, `${a3.log.streamId}.deleting`))
    const r3 = deleteNamespaceDiagnosticLog({ rootDir: root3, namespaceId: ns3 })
    expect(r3.status).toBe('deleted')
    expect(existsSync(p3.namespaceDir)).toBe(false)

    // N4：全流已删、空壳 dir(+marker)
    const root4 = freshRoot()
    const ns4 = 'ns-d5-n4'
    const a4 = buildNamespace(root4, ns4)
    const p4 = streamPaths(root4, ns4, a4.log.streamId)
    writeFileSync(join(p4.namespaceDir, 'deletion.json'), DELETION_MARKER)
    rmSync(p4.streamsDir, { recursive: true, force: true })
    const r4 = deleteNamespaceDiagnosticLog({ rootDir: root4, namespaceId: ns4 })
    expect(r4.status).toBe('deleted')
    expect(existsSync(p4.namespaceDir)).toBe(false)
  })

  it('T-D6 [红灯/护栏] {streamId}.deleting 文法：破坏 current.json 后 locator 扫描不吞入；构造 fresh 新 lineage', () => {
    const root = freshRoot()
    const ns = 'ns-d6'
    const a = buildNamespace(root, ns)
    const p = streamPaths(root, ns, a.log.streamId)
    // N3 形（无 marker——刻意摘除，验证 locator 文法面）：current.json 已无 + 流目录改名
    unlinkSync(p.currentPath)
    const renamed = join(p.streamsDir, `${a.log.streamId}.deleting`)
    rmSync(renamed, { recursive: true, force: true }) // 清掉可能残留（buildNamespace 未产生此名）
    renameSync(p.streamDir, renamed)

    const b = makeFileLog({
      rootDir: root,
      namespaceId: ns,
      updateCapture: true,
      targetRecordsPerSegment: 1,
      inlineUpdateMaxBytes: INLINE_T,
      clock: { now: () => T0 },
    } as unknown as Partial<FileDiagnosticLogConfig>)
    // 不 resume 旧 .deleting 目录：fresh 新 lineage；无 rotate（fresh ≠ rotate）
    expect(b.log.streamId).not.toBe(a.log.streamId)
    expect(eventsOfTypeRaw(b.events, 'stream-generation-rotated')).toHaveLength(0)
    expect(existsSync(renamed)).toBe(true) // 旧残部原样（删除完成路径 = 重入删除，非构造）
    emit(b)
    expect(segmentEntriesOf(root, ns, b.log.streamId)).toContain('00000001.jsonl')
  })

  it('T-D7 [红灯] 语义边界：完成态词汇 = deleted/absent（无 erased/purged 暗示面）；删除不留任何 tombstone 文件', () => {
    const root = freshRoot()
    const ns = 'ns-d7'
    buildNamespace(root, ns)
    const result = deleteNamespaceDiagnosticLog({ rootDir: root, namespaceId: ns })
    // 词汇：{status:'deleted'} 而非 'erased'/'purged'/'wiped'（逻辑删除——SA2 §2.4 / ADR 边界）
    expect(result.status).toBe('deleted')
    expect(JSON.stringify(result).toLowerCase()).not.toMatch(/erase|purge|wipe|secure/)
    // 删除 = 活跃存储的移除：根下无任何残留（不写 tombstone/whitepaper——无安全擦除暗示）
    expect(existsSync(join(root, 'namespaces', ns))).toBe(false)
  })

  it('T-D8 [红灯] 完成后 fresh：删除后再构造 ⇒ 新 streamId + genesis（新 lineage 合法）', () => {
    const root = freshRoot()
    const ns = 'ns-d8'
    const a = buildNamespace(root, ns)
    const first = deleteNamespaceDiagnosticLog({ rootDir: root, namespaceId: ns })
    expect(first.status).toBe('deleted')
    const b = makeWriter(root, ns)
    expect(b.log.streamId).not.toBe(a.log.streamId) // 全新 lineage
    emit(b)
    expect(segmentEntriesOf(root, ns, b.log.streamId)).toContain('00000001.jsonl')
    const c = deleteNamespaceDiagnosticLog({ rootDir: root, namespaceId: ns })
    expect(c.status).toBe('deleted')
  })

  it('T-D9 [红灯] 租约分区释放：删除后旧会话 closed===true + renew()===false；注册表无残留', () => {
    const root = freshRoot()
    const ns = 'ns-d9'
    const a = buildNamespace(root, ns)
    const session = openDiagnosticReadSession({
      rootDir: root,
      namespaceId: ns,
      streamId: a.log.streamId,
      ttlMs: 60_000,
      clock: { now: () => T0 },
    })
    const result = deleteNamespaceDiagnosticLog({ rootDir: root, namespaceId: ns })
    expect(result.status).toBe('deleted')
    expect(session.closed).toBe(true)
    expect(session.renew()).toBe(false)
  })
})

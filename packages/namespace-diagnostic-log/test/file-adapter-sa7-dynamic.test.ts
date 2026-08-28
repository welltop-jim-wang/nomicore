/**
 * SA7 动态验证补充测试 — File diagnostic-log adapter R2（issue #152 round=2，2026-08-28）。
 *
 * 与 SA6 红灯契约（file-adapter-strict-reader / r2-policy-continuity）的分工：
 * - SA6 锚定设计 §5.3 语义（多为手工 fixture 直写物理文件）；
 * - 本文件全部用例走**真实运行链路**：`createFileDiagnosticLog`（真实 emitter→adapter→
 *   磁盘投影）产出健康 stream 后，仅在**物理层**做敌意篡改（manifest 字段翻转 /
 *   JSONL 行删除 / 字节注入），再经真实 `readStreamStrict` 判定——验证 reader 不信任
 *   writer、忠实执行 manifest 冻结 policy（R2-AC1）与物理连续性（R2-AC2）。
 *
 * 动态重点（SA4 §5 交办）：
 * - #2 BIN-ok + JSONL-definitive 交错终态（orphan 帧 + candidate 复用）——无既有测试锚，
 *   本文件 D-A1 实测 strict reader 判定（静态推演为 ok：首个被引用帧不做 boundary 检查）。
 * - #1 残余（write 期 EACCES 误分类）后果有界性 → D-C6：误分类最坏物理后果
 *   （部分行 / 重复 sequence）被 reader 响亮判 corrupt 的实证。
 *
 * 断言全部针对运行时产物（磁盘字节、事件、reader 返回），零源码文本断言。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { readStreamStrict } from '../src/index.js'
import type { StrictReadIssue, StrictStreamRead } from '../src/index.js'
import { baseEmission } from './helpers/base.js'
import {
  decodeFrame,
  eventsOfType,
  FRAME_HEADER_BYTES,
  makeFileLog,
  makeTempRoot,
  patternedBytes,
  readJson,
  readJsonl,
  rmTempRoot,
  streamPaths,
} from './helpers/file.js'

const tempRoots: string[] = []

function freshRoot(prefix: string): { root: string; ns: string } {
  const root = makeTempRoot('ndcl-sa7-')
  tempRoots.push(root)
  return { root, ns: prefix }
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmTempRoot(root)
})

/** stream 级 issue code 列表。 */
function issueCodes(read: StrictStreamRead): string[] {
  return read.issues.map((i) => i.code)
}

/** 翻转字节（制造与 patternedBytes 等长但内容不同的 payload——CRC 必然不同）。 */
function invertedBytes(size: number): Uint8Array {
  return patternedBytes(size).map((b) => (b ^ 0xff) as number)
}

/** 读取并解析 bin 的全部帧（25B header + payload；帧长对齐解码）。 */
function readAllFrames(binPath: string): Array<{ sequence: string; payload: Uint8Array }> {
  const bytes = readFileSync(binPath)
  const frames: Array<{ sequence: string; payload: Uint8Array }> = []
  let offset = 0
  while (offset < bytes.byteLength) {
    const decoded = decodeFrame(new Uint8Array(bytes), offset)
    frames.push({ sequence: decoded.sequence.toString(), payload: decoded.payload })
    offset += FRAME_HEADER_BYTES + decoded.payloadLength
  }
  return frames
}

describe('SA7 动态重点 #2：BIN-ok + JSONL-definitive 交错终态（orphan 帧 + candidate 复用）实测', () => {
  it('D-A1: BIN 帧完整落盘后 JSONL open 期 EISDIR（definitive）→ orphan 保留、candidate 复用、新帧引用可判 ok', () => {
    const { root, ns } = freshRoot('ns-sa7-interleave')
    const { log, events } = makeFileLog({ rootDir: root, namespaceId: ns, updateCapture: true })
    const p = streamPaths(root, ns, log.streamId)

    // ① 真实前置：seq 1 inline（10B ≤ 4096）
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(10) } }))
    expect(readJsonl(p.jsonlPath).map((r) => r.sequence)).toEqual(['1'])

    // ② 交错注入：JSONL 路径目录占位（open 期 EISDIR，零字节可证明）→ sidecar emit：
    //    BIN-first 帧完整落盘（orphan frame seq '2' @0）→ JSONL append definitive 失败
    renameSync(p.jsonlPath, `${p.jsonlPath}.bak`)
    mkdirSync(p.jsonlPath, { recursive: true })
    log.emitter.emit(
      baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(4097) } }),
    )
    // JSONL open 期 EISDIR 必须被分类为 definitive（storage-write-failed 事件）
    expect(
      eventsOfType(events, 'storage-write-failed').some((e) => e.stage === 'jsonl' && e.code === 'EISDIR'),
    ).toBe(true)
    // orphan 物理证据：bin 已有 seq '2' 帧（offset 0），JSONL 仍无 seq 2 行
    expect(existsSync(p.binPath)).toBe(true)
    const orphanFrames = readAllFrames(p.binPath)
    expect(orphanFrames.map((f) => f.sequence)).toEqual(['2'])
    expect(readJsonl(`${p.jsonlPath}.bak`).map((r) => r.sequence)).toEqual(['1'])

    // ③ 恢复 + 复用 candidate：移除目录占位、还原 JSONL → 同一 candidate '2' 再次提交
    rmdirSync(p.jsonlPath)
    renameSync(`${p.jsonlPath}.bak`, p.jsonlPath)
    log.emitter.emit(
      baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: invertedBytes(4097) } }),
    )

    const records = readJsonl(p.jsonlPath)
    // definitive 复用 candidate → 新记录仍为 seq 2
    expect(records.map((r) => r.sequence)).toEqual(['1', '2'])
    const carrier = (records[1]!.result as { update: { storage: string; frameOffset: string } }).update
    expect(carrier.storage).toBe('sidecar')
    // fresh-stat 跳过 orphan 帧 → 新帧从 orphan 之后起
    expect(carrier.frameOffset).toBe(String(FRAME_HEADER_BYTES + 4097))
    // bin 终态：两个 seq '2' 帧（orphan @0 + 复用提交帧 @4122）
    const frames = readAllFrames(p.binPath)
    expect(frames.map((f) => f.sequence)).toEqual(['2', '2'])

    // ④ 实测判定：真实 readStreamStrict 对该交错终态的 status（静态推演：ok——
    //    首个被引用帧不做 boundary 检查，orphan 帧无 JSONL 引用不产生 issue）
    const read = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: log.streamId })
    // 交错终态实测判定（推演 ok；若实现判 frame-boundary-invalid 此处红 → SA7 发现）
    expect(read.status).toBe('ok')
    expect(read.records.map((r) => r.sequence)).toEqual(['1', '2'])
    expect(read.records.every((r) => r.ok)).toBe(true)
    expect(issueCodes(read)).toEqual([])
  })
})

describe('SA7 R2-AC2 活链路：真实 writer 产物的物理删除必发现、健康 stream（含合法终态）不误判', () => {
  it('D-B1: 真实 [1 inline, 2 sidecar, 3 inline] 物理删除 JSONL seq 2 行（bin 帧保留）→ corrupt + sequence-gap 归因发现 record', () => {
    const { root, ns } = freshRoot('ns-sa7-physdel')
    const { log } = makeFileLog({ rootDir: root, namespaceId: ns, updateCapture: true })
    const p = streamPaths(root, ns, log.streamId)

    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(10) } }))
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(4097) } }))
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: invertedBytes(10) } }))
    const before = readJsonl(p.jsonlPath)
    expect(before.map((r) => r.sequence)).toEqual(['1', '2', '3'])
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: log.streamId }).status).toBe('ok')

    // 物理删除 seq 2 的 JSONL 行（bin 的 frame 2 原样保留——不因 bin 仍在而掩盖缺口）
    const lines = readFileSync(p.jsonlPath, 'utf8').split('\n')
    lines.splice(1, 1) // 删除 offset 1（seq 2）
    writeFileSync(p.jsonlPath, lines.join('\n'))
    // bin 帧保留（sidecar frame 2 未删）
    expect(readAllFrames(p.binPath)).toHaveLength(1)

    const read = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: log.streamId })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read)).toContain('sequence-gap')
    const gap = read.issues.find((i) => i.code === 'sequence-gap') as StrictReadIssue
    // gap 归因 = 发现缺口的物理 record（seq 3）
    expect(gap.sequence).toBe('3')
    // 发现 record 位于删除后的 offset 1
    expect(gap.offset).toBe(1)
    expect(gap.segment).toBe('00000001')
    // 剩余两条物理记录自身 ok（逐条解释保留），且 seq 1 inline / seq 3 inline 存储交叉不受 bin 残帧干扰
    expect(read.records.map((r) => r.sequence)).toEqual(['1', '3'])
    expect(read.records.every((r) => r.ok)).toBe(true)
  })

  it('D-B2: 健康 stream 混合合法终态（inline / sidecar / fatal-committed sidecar / noop）→ ok、零 issue、零误判', () => {
    const { root, ns } = freshRoot('ns-sa7-healthy')
    const { log } = makeFileLog({ rootDir: root, namespaceId: ns, updateCapture: true })
    const p = streamPaths(root, ns, log.streamId)

    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(10) } }))
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(4097) } }))
    log.emitter.emit(
      baseEmission({ result: { kind: 'fatal', committed: true, effect: 'update', updateBytes: invertedBytes(4097) } }),
    )
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'noop' } }))
    log.emitter.emit(baseEmission({ result: { kind: 'fatal', committed: false, effect: 'rejected' } }))

    const read = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: log.streamId })
    expect(read.status).toBe('ok')
    expect(read.records.map((r) => r.sequence)).toEqual(['1', '2', '3', '4', '5'])
    expect(read.records.every((r) => r.ok)).toBe(true)
    expect(issueCodes(read)).toEqual([])
    // 两个 sidecar 帧连续引用（fatal-committed 与 committed）
    expect(readAllFrames(p.binPath)).toHaveLength(2)
  })
})

describe('SA7 R2-AC1 活链路：真实 writer 产物 + manifest 物理篡改 → strict reader 响亮执行冻结 policy', () => {
  it('D-C1: committedUpdateCapture 翻转为 false → 真实 update 记录判 manifest-update-capture-violation + corrupt', () => {
    const { root, ns } = freshRoot('ns-sa7-capfalse')
    const { log } = makeFileLog({ rootDir: root, namespaceId: ns, updateCapture: true })
    const p = streamPaths(root, ns, log.streamId)
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(10) } }))
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: log.streamId }).status).toBe('ok')

    const manifest = readJson<Record<string, unknown>>(p.manifestPath)
    writeFileSync(p.manifestPath, JSON.stringify({ ...manifest, committedUpdateCapture: false }))

    const read = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: log.streamId })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read)).toContain('manifest-update-capture-violation')
    // corrupt 保留逐条解释（非 incompatible 清空）
    expect(read.records).toHaveLength(1)
    expect(read.records[0]!.ok).toBe(false)
  })

  it('D-C2: inlineUpdateMaxBytes 收紧为 4 → 真实 10B inline 记录超阈值 → manifest-inline-threshold-violation', () => {
    const { root, ns } = freshRoot('ns-sa7-inlinemax')
    const { log } = makeFileLog({ rootDir: root, namespaceId: ns, updateCapture: true })
    const p = streamPaths(root, ns, log.streamId)
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(10) } }))

    const manifest = readJson<Record<string, unknown>>(p.manifestPath)
    writeFileSync(p.manifestPath, JSON.stringify({ ...manifest, inlineUpdateMaxBytes: 4 }))

    const read = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: log.streamId })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read)).toContain('manifest-inline-threshold-violation')
  })

  it('D-C3: inlineUpdateMaxBytes 放宽为 1048576 → 真实 4097B sidecar 记录 ≤ 阈值 → manifest-sidecar-threshold-violation', () => {
    const { root, ns } = freshRoot('ns-sa7-sidecarmax')
    const { log } = makeFileLog({ rootDir: root, namespaceId: ns, updateCapture: true })
    const p = streamPaths(root, ns, log.streamId)
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(4097) } }))
    expect(readJsonl(p.jsonlPath)[0]!.result).toHaveProperty('update.storage', 'sidecar')

    const manifest = readJson<Record<string, unknown>>(p.manifestPath)
    writeFileSync(p.manifestPath, JSON.stringify({ ...manifest, inlineUpdateMaxBytes: 1048576 }))

    const read = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: log.streamId })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read)).toContain('manifest-sidecar-threshold-violation')
  })

  it('D-C4: jsonlLineLimitBytes 收紧为 64 → 真实记录原始行字节超限 → manifest-line-limit-exceeded', () => {
    const { root, ns } = freshRoot('ns-sa7-linelimit')
    const { log } = makeFileLog({ rootDir: root, namespaceId: ns, updateCapture: true })
    const p = streamPaths(root, ns, log.streamId)
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(10) } }))

    const manifest = readJson<Record<string, unknown>>(p.manifestPath)
    writeFileSync(p.manifestPath, JSON.stringify({ ...manifest, jsonlLineLimitBytes: 64 }))

    const read = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: log.streamId })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read)).toContain('manifest-line-limit-exceeded')
  })

  it('D-C5: inputCapturePolicy 改为 none → 真实 {snapshot} 输入投影的 full 记录判 manifest-input-policy-violation', () => {
    const { root, ns } = freshRoot('ns-sa7-inputpol')
    const { log } = makeFileLog({ rootDir: root, namespaceId: ns, updateCapture: true, inputPolicy: 'full' })
    const p = streamPaths(root, ns, log.streamId)
    log.emitter.emit(baseEmission({ input: { snapshot: { a: 1 } } }))
    const record = readJsonl(p.jsonlPath)[0]! as { input: { capture: string } }
    expect(record.input.capture).toBe('full')

    const manifest = readJson<Record<string, unknown>>(p.manifestPath)
    writeFileSync(p.manifestPath, JSON.stringify({ ...manifest, inputCapturePolicy: 'none' }))

    const read = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: log.streamId })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read)).toContain('manifest-input-policy-violation')
  })
})

describe('SA7 动态重点 #1 佐证：write 期 EACCES 误分类残余的最坏物理后果有界（响亮 corrupt，非静默错乱）', () => {
  it('D-C6: 注入部分行 + 重复 sequence 行（误分类最坏产物形状）→ reader 以 invalid-json + sequence-out-of-order 响亮判 corrupt', () => {
    const { root, ns } = freshRoot('ns-sa7-residual')
    const { log } = makeFileLog({ rootDir: root, namespaceId: ns, updateCapture: true })
    const p = streamPaths(root, ns, log.streamId)

    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(10) } }))
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: invertedBytes(10) } }))
    expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: log.streamId }).status).toBe('ok')

    // 物理注入（模拟 exotic fs 上 write 期 EACCES 被误归 definitive 后可能留下的脏形态）：
    // ① 一条完整但重复 sequence '2' 的行；② 一段无换行结尾的部分行（半行 JSON）
    const seq2Line = JSON.stringify(readJsonl(p.jsonlPath)[1])
    const partialLine = '  {"recordKind":"attempt","streamId":"' + log.streamId.slice(0, 8)
    writeFileSync(p.jsonlPath, `${readFileSync(p.jsonlPath, 'utf8')}${seq2Line}\n${partialLine}`)

    const read = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: log.streamId })
    expect(read.status).toBe('corrupt')
    const codes = issueCodes(read)
    // 重复 sequence / 部分行均响亮判坏
    expect(codes).toContain('sequence-out-of-order')
    expect(codes).toContain('invalid-json')
    expect(codes).not.toContain('ok')
  })
})

/**
 * SA7 动态补验 — Issue #153 `repair-io-failure` 路径（SA4 静态验尸 §三.1 / LOW-3 记档）。
 *
 * 背景：SA3 实现了 `applyRepairs` 的 truncateSync 失败分支
 * （notify(stream-generation-rotated{cause:'repair-io-failure'}) + rotate 新 generation +
 * 已成功的前序修复保留），但设计 §13 未列锚、SA6 未落测试——零覆盖。本文件按 SA4 动态清单
 * 注入只读语义（目标文件 chmod 0444 → truncateSync open(O_WRONLY) 得 EACCES）补齐。
 *
 * 注入精度说明（POSIX 语义，非任意选型）：truncate 既存文件只需文件自身写权限，
 * 不需要目录写权限——因此「segments 目录 chmod 0555」无法阻断 truncateSync；能可靠
 * 触发 repair-io-failure 的只读注入是「待截断文件 chmod 0444」（owner 也失去写位）。
 * 分析阶段只读（readFileSync 0444 可读），故分析照常产出 repairs，截断点才失败。
 *
 * 运行身份前提：EACCES 只在非 root 下成立（root 可写 0444 文件）——本组用例在
 * uid===0 环境 skip（CI GitHub-hosted runner / 本地开发机均为非 root）。
 *
 * 断言全部面向运行时产物（磁盘字节、observer 事件、readStreamStrict 返回）——零源码
 * 文本断言。
 */
import { chmodSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readStreamStrict } from '../src/index.js'
import type { FileDiagnosticLogConfig } from '../src/index.js'
import { baseEmission } from './helpers/base.js'
import {
  concatU8,
  encodeFrame,
  eventsOfTypeRaw,
  FRAME_HEADER_BYTES,
  makeFileLog,
  makeTempRoot,
  patternedBytes,
  readJson,
  readJsonl,
  readJsonlBytes,
  rmTempRoot,
  sidecarAttemptRecord,
  streamPaths,
  validAttemptRecord,
  validCurrent,
  validManifest,
  writeStreamFixture,
} from './helpers/file.js'
import type { AssembledFileLog } from './helpers/file.js'

const tempRoots: string[] = []

function freshRoot(): string {
  const root = makeTempRoot('ndcl-sa7-repair-io-')
  tempRoots.push(root)
  return root
}

afterEach(() => {
  // 0444 文件不可写但 unlink 只需目录写权限——先恢复 0644 便于任意清理器处理
  for (const root of tempRoots.splice(0)) {
    chmodRecursive(root, 0o644, 0o755)
    rmTempRoot(root)
  }
})

function chmodRecursive(dir: string, fileMode: number, dirMode: number): void {
  try {
    chmodSync(dir, dirMode)
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) chmodRecursive(full, fileMode, dirMode)
      else {
        try {
          chmodSync(full, fileMode)
        } catch {
          // 目录占位等特殊 entry：忽略
        }
      }
    }
  } catch {
    // 清理尽力而为
  }
}

/** fixture streamId（CSPRNG 形状）。 */
const FX = 'log-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
/** sidecar 帧字节长（25B header + 4097B payload → sidecar 路径）。 */
const SIDE_PAYLOAD = 4097
const FRAME_BYTES = FRAME_HEADER_BYTES + SIDE_PAYLOAD // 4122

/** resume 构造（默认 updateCapture:true——与 fixture manifest 的 committedUpdateCapture 一致）。 */
function makeResumeLog(
  root: string,
  ns: string,
  extra: Partial<FileDiagnosticLogConfig> = {},
): AssembledFileLog {
  return makeFileLog({ rootDir: root, namespaceId: ns, updateCapture: true, ...extra })
}

/** rotate 证明模板：恰一次 rotated{cause} + 新 streamId + current.json 愈合。 */
function expectRotated(b: AssembledFileLog, cause: string, root: string, ns: string): void {
  const rotated = eventsOfTypeRaw(b.events, 'stream-generation-rotated')
  expect(rotated).toHaveLength(1)
  expect(rotated[0]).toMatchObject({ type: 'stream-generation-rotated', cause })
  expect(b.log.streamId).not.toBe(FX)
  expect(b.log.streamId).toMatch(/^log-[0-9a-f]{32}$/)
  const current = readJson<Record<string, unknown>>(streamPaths(root, ns, b.log.streamId).currentPath)
  expect(current.streamId).toBe(b.log.streamId)
}

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

describe('SA7 补验：applyRepairs 截断 IO 失败（repair-io-failure rotate；注入=待截断文件 chmod 0444）', () => {
  it.skipIf(isRoot)(
    'S7-R1 C1 修复目标 jsonl chmod 0444 → 恰一次 rotated{repair-io-failure} + 新 generation 承接 emit + 旧文件字节零改写',
    () => {
      const root = freshRoot()
      const ns = 'ns-sa7-rio-1'
      const line1 = JSON.stringify(validAttemptRecord(FX, '1')) + '\n'
      const partial = '{"partial":'
      writeStreamFixture(root, ns, FX, {
        manifest: validManifest(FX, ns),
        jsonlText: line1 + partial, // C1 可修复尾（不完整末行）
        current: validCurrent(FX),
      })
      const p = streamPaths(root, ns, FX)
      const jsonlBefore = readJsonlBytes(p.jsonlPath)
      chmodSync(p.jsonlPath, 0o444) // 截断目标只读 → truncateSync EACCES

      const b = makeResumeLog(root, ns)

      expectRotated(b, 'repair-io-failure', root, ns)
      // 零修复事件（唯一修复 C1 未成功；分析事件不外泄）
      expect(eventsOfTypeRaw(b.events, 'stream-tail-repaired')).toHaveLength(0)
      // 旧 stream 字节恒等（0444 下物理不可能被改写——腐蚀注入保持原样、历史未动）
      expect(readJsonlBytes(p.jsonlPath).equals(jsonlBefore)).toBe(true)
      expect(statSync(p.jsonlPath).mode & 0o777).toBe(0o444)
      // 新 generation 真实承接 emit（disabled 不得静默）
      b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
      const newJsonl = join(streamPaths(root, ns, b.log.streamId).segmentsDir, '00000001.jsonl')
      expect(readJsonl(newJsonl).map((r) => r.sequence)).toEqual(['1'])
      expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: b.log.streamId }).status).toBe('ok')
      // 旧 stream 保持可严格读（inline record 自洽；损坏仅尾部未提交行）
      expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('corrupt')
    },
  )

  it.skipIf(isRoot)(
    'S7-R2 C2 修复目标 bin chmod 0444（jsonl 健康）→ rotated{repair-io-failure} + bin 字节恒等',
    () => {
      const root = freshRoot()
      const ns = 'ns-sa7-rio-2'
      const payload1 = patternedBytes(SIDE_PAYLOAD)
      const torn = patternedBytes(7) // < 25B：C2 可修复撕裂尾
      writeStreamFixture(root, ns, FX, {
        manifest: validManifest(FX, ns),
        jsonlLines: [sidecarAttemptRecord(FX, '1', payload1)],
        bin: concatU8(encodeFrame(1, payload1), torn),
        current: validCurrent(FX),
      })
      const p = streamPaths(root, ns, FX)
      const binBefore = readJsonlBytes(p.binPath)
      chmodSync(p.binPath, 0o444)

      const b = makeResumeLog(root, ns)

      expectRotated(b, 'repair-io-failure', root, ns)
      expect(eventsOfTypeRaw(b.events, 'stream-tail-repaired')).toHaveLength(0)
      expect(readJsonlBytes(p.binPath).equals(binBefore)).toBe(true)
      b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
      const newJsonl = join(streamPaths(root, ns, b.log.streamId).segmentsDir, '00000001.jsonl')
      expect(readJsonl(newJsonl).map((r) => r.sequence)).toEqual(['1'])
      expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: b.log.streamId }).status).toBe('ok')
    },
  )

  it.skipIf(isRoot)(
    'S7-R3 C1 成功 + C2 失败（bin chmod 0444）→ 前序修复保留：jsonl 已截断落盘 + bin 恒等 + 恰一次 repaired + 恰一次 rotated{repair-io-failure}',
    () => {
      const root = freshRoot()
      const ns = 'ns-sa7-rio-3'
      const line1 = JSON.stringify(validAttemptRecord(FX, '1')) + '\n'
      const partial = '{"partial":'
      writeStreamFixture(root, ns, FX, {
        manifest: validManifest(FX, ns),
        jsonlText: line1 + partial, // C1（jsonl，可写 → 成功）
        bin: concatU8(encodeFrame(1, patternedBytes(100)), patternedBytes(7)), // C2（bin，0444 → 失败）
        current: validCurrent(FX),
      })
      const p = streamPaths(root, ns, FX)
      chmodSync(p.binPath, 0o444)

      const b = makeResumeLog(root, ns)

      // 恰一次修复事件 = C1（jsonl-incomplete-line）；C2 失败不再发 repaired
      const repaired = eventsOfTypeRaw(b.events, 'stream-tail-repaired')
      expect(repaired).toHaveLength(1)
      expect(repaired[0]).toMatchObject({ type: 'stream-tail-repaired', repair: 'jsonl-incomplete-line' })
      expectRotated(b, 'repair-io-failure', root, ns)
      // 已成功修复保留：jsonl 修复真实落盘（截到 line1 末尾）
      expect(readFileSync(p.jsonlPath, 'utf8')).toBe(line1)
      // bin 恒等（截断失败 + 不可写 → 字节零变化）
      expect(readJsonlBytes(p.binPath).byteLength).toBe(FRAME_HEADER_BYTES + 100 + 7)
      // 旧 stream 不被续写（rotate 后 writer 落新 generation）
      b.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(SIDE_PAYLOAD) } }))
      const oldSegs = readdirSync(p.segmentsDir).sort()
      expect(oldSegs).toEqual(['00000001.bin', '00000001.jsonl'])
      const newJsonl = join(streamPaths(root, ns, b.log.streamId).segmentsDir, '00000001.jsonl')
      expect(readJsonl(newJsonl).map((r) => r.sequence)).toEqual(['1'])
      expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: b.log.streamId }).status).toBe('ok')
    },
  )

  it.skipIf(isRoot)(
    'S7-R4 权限恢复后重开 → 同一 tail 现可修复（repair-io-failure 非粘性；rotate 决策按当下 IO 事实）',
    () => {
      const root = freshRoot()
      const ns = 'ns-sa7-rio-4'
      const line1 = JSON.stringify(validAttemptRecord(FX, '1')) + '\n'
      writeStreamFixture(root, ns, FX, {
        manifest: validManifest(FX, ns),
        jsonlText: line1 + '{"partial":',
        current: validCurrent(FX),
      })
      const p = streamPaths(root, ns, FX)
      chmodSync(p.jsonlPath, 0o444)
      const fail = makeResumeLog(root, ns)
      expectRotated(fail, 'repair-io-failure', root, ns)

      // 权限恢复（运维清障模拟）后显式 resumeStreamId 回 FX：尾巴可修复 → 健康 resume
      //（证明 repair-io-failure 是一次性的 rotate 决策，非对旧 stream 的终态封印）
      chmodSync(p.jsonlPath, 0o644)
      const heal = makeResumeLog(root, ns, { resumeStreamId: FX })
      const repaired = eventsOfTypeRaw(heal.events, 'stream-tail-repaired')
      expect(repaired).toHaveLength(1)
      expect(repaired[0]).toMatchObject({ repair: 'jsonl-incomplete-line' })
      expect(eventsOfTypeRaw(heal.events, 'stream-generation-rotated')).toHaveLength(0)
      expect(heal.log.streamId).toBe(FX)
      heal.log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
      expect(readJsonl(p.jsonlPath).map((r) => r.sequence)).toEqual(['1', '2'])
      expect(readStreamStrict({ rootDir: root, namespaceId: ns, streamId: FX }).status).toBe('ok')
    },
  )
})

/**
 * 红灯契约 — AC1 新 stream：不可变 manifest（冻结 VFSL 信封 + format policy）
 * + 原子可替换 current-stream locator（ADR 0012 §File adapter 布局）。
 *
 * 锚点：task_diagnostic-log-file-adapter.md AC1 + ADR 0012
 * - 「manifest.json 创建后不可变，至少保存：manifest format/version；streamId、
 *   namespaceId 与 createdAt；完整 record schema VFSL 四键信封；record、frame 与
 *   schema 版本；committed update capture、input capture policy；inline threshold
 *   与 JSONL line 上限」
 * - 「current.json 使用 temp + rename 原子替换，只保存 format/version/streamId」
 * - 「namespaceId、streamId 与 segment 名必须按各自安全文法校验后才能进入路径；
 *   不符合时日志不启用并上报，不通过编码、hash 或替换字符静默另存」
 * - 「.bin 在该 segment 首次出现 sidecar payload 时惰性创建」
 * - ADR 0012 §Stream 与 generation（streamId = log- + 32 位小写 hex）
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RECORD_SCHEMA_ENVELOPE, RECORD_SCHEMA_ID, RECORD_SCHEMA_TEXT } from '../src/schema.js'
import { createDeterministicRandomSource } from '../src/testing.js'
import { baseEmission, FROZEN_ENVELOPE_FINGERPRINT } from './helpers/base.js'
import {
  CURRENT_FORMAT,
  CURRENT_VERSION,
  DEFAULT_INLINE_UPDATE_MAX_BYTES,
  DEFAULT_LINE_LIMIT_BYTES,
  eventsOfType,
  makeFileLog,
  makeTempRoot,
  MANIFEST_FORMAT,
  MANIFEST_VERSION,
  patternedBytes,
  readJson,
  rmTempRoot,
  streamPaths,
} from './helpers/file.js'

const tempRoots: string[] = []

function freshRoot(): string {
  const root = makeTempRoot()
  tempRoots.push(root)
  return root
}

/** 递归统计 root 下的文件数（路径安全断言：不得产生任何落盘产物）。 */
function countFilesRecursive(dir: string): number {
  let count = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) count += countFilesRecursive(full)
    else count += 1
  }
  return count
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmTempRoot(root)
})

describe('AC1 布局：manifest + current.json + segments（ADR 0012 §File adapter 布局）', () => {
  it('构造即建 namespaces/{namespaceId}/current.json + streams/{streamId}/manifest.json + segments/', () => {
    const root = freshRoot()
    const { log, events } = makeFileLog({ rootDir: root, namespaceId: 'ns-layout-1' })
    const p = streamPaths(root, 'ns-layout-1', log.streamId)

    expect(p.namespaceDir).toContain(join('namespaces', 'ns-layout-1'))
    expect(existsSync(p.currentPath)).toBe(true)
    expect(existsSync(p.manifestPath)).toBe(true)
    expect(statSync(p.segmentsDir).isDirectory()).toBe(true)
    expect(events).toHaveLength(0)

    // streamId 文法：log- + 32 位小写 hex（ADR 0012 §Stream 与 generation）
    expect(log.streamId).toMatch(/^log-[0-9a-f]{32}$/)
  })

  it('streamId 三处一致（log.streamId / current.json / manifest.json / 目录名）且实例寿命内稳定', () => {
    const root = freshRoot()
    const { log } = makeFileLog({ rootDir: root, namespaceId: 'ns-layout-2' })
    const before = log.streamId
    const current = readJson<Record<string, unknown>>(streamPaths(root, 'ns-layout-2', log.streamId).currentPath)
    const manifest = readJson<Record<string, unknown>>(streamPaths(root, 'ns-layout-2', log.streamId).manifestPath)

    log.emitter.emit(baseEmission())
    const after = log.streamId
    expect(current.streamId).toBe(before)
    expect(manifest.streamId).toBe(before)
    expect(existsSync(streamPaths(root, 'ns-layout-2', log.streamId).streamDir)).toBe(true)
    expect(after).toBe(before) // 实例寿命内稳定
  })

  it('current.json 只保存 format/version/streamId（恰三键、无 tmp 残留）', () => {
    const root = freshRoot()
    const { log } = makeFileLog({ rootDir: root, namespaceId: 'ns-layout-3' })
    const p = streamPaths(root, 'ns-layout-3', log.streamId)
    const current = readJson<Record<string, unknown>>(p.currentPath)

    expect(Object.keys(current).sort()).toEqual(['format', 'streamId', 'version'])
    expect(current.format).toBe(CURRENT_FORMAT)
    expect(current.version).toBe(CURRENT_VERSION)
    expect(current.streamId).toBe(log.streamId)

    // temp + rename 原子替换：不留 *.tmp / *.part 中间文件
    const leftovers = readdirSync(p.namespaceDir).filter((name) => name.includes('tmp') || name.includes('part'))
    expect(leftovers).toEqual([])
  })

  it('manifest.json 含冻结 VFSL 四键信封与 format policy（键集与取值逐项）', () => {
    const root = freshRoot()
    const { log } = makeFileLog({ rootDir: root, namespaceId: 'ns-layout-4' })
    const p = streamPaths(root, 'ns-layout-4', log.streamId)
    const manifest = readJson<Record<string, unknown>>(p.manifestPath)

    expect(Object.keys(manifest).sort()).toEqual([
      'committedUpdateCapture',
      'createdAt',
      'format',
      'frameVersion',
      'inlineUpdateMaxBytes',
      'inputCapturePolicy',
      'jsonlLineLimitBytes',
      'namespaceId',
      'recordVersion',
      'schema',
      'schemaFingerprint',
      'schemaId',
      'streamId',
      'version',
    ])
    expect(manifest.format).toBe(MANIFEST_FORMAT)
    expect(manifest.version).toBe(MANIFEST_VERSION)
    expect(manifest.streamId).toBe(log.streamId)
    expect(manifest.namespaceId).toBe('ns-layout-4')
    expect(typeof manifest.createdAt).toBe('string')
    expect(new RegExp('^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$').test(manifest.createdAt as string)).toBe(true)

    // 完整 VFSL 四键信封（ADR 0012：manifest 内嵌同一完整四键信封以便离线解释）
    expect(manifest.schema).toEqual(RECORD_SCHEMA_ENVELOPE)
    expect(Object.keys(manifest.schema as object).sort()).toEqual(['id', 'lang', 'text', 'version'])
    expect((manifest.schema as { text: string }).text).toBe(RECORD_SCHEMA_TEXT)

    // record/frame/schema 版本 + 指纹（ADR 0012 §VFSL record schema：指纹必须与内建冻结版本匹配）
    expect(manifest.recordVersion).toBe(1)
    expect(manifest.frameVersion).toBe(1)
    expect(manifest.schemaId).toBe(RECORD_SCHEMA_ID)
    expect(manifest.schemaFingerprint).toBe(FROZEN_ENVELOPE_FINGERPRINT)
  })

  it('配置值冻结进 manifest（updateCapture/inputPolicy/inline 阈值/line 上限）', () => {
    const root = freshRoot()
    const { log } = makeFileLog({
      rootDir: root,
      namespaceId: 'ns-layout-5',
      updateCapture: true,
      inputPolicy: 'none',
      inlineUpdateMaxBytes: 64,
      lineBudgetBytes: 8192,
    })
    const manifest = readJson<Record<string, unknown>>(streamPaths(root, 'ns-layout-5', log.streamId).manifestPath)
    expect(manifest.committedUpdateCapture).toBe(true)
    expect(manifest.inputCapturePolicy).toBe('none')
    expect(manifest.inlineUpdateMaxBytes).toBe(64)
    expect(manifest.jsonlLineLimitBytes).toBe(8192)
  })

  it('默认 manifest 值：committedUpdateCapture=false / inputCapturePolicy=digest / inline=4096 / line=1MiB', () => {
    const root = freshRoot()
    const { log } = makeFileLog({ rootDir: root, namespaceId: 'ns-layout-6' })
    const manifest = readJson<Record<string, unknown>>(streamPaths(root, 'ns-layout-6', log.streamId).manifestPath)
    expect(manifest.committedUpdateCapture).toBe(false)
    expect(manifest.inputCapturePolicy).toBe('digest')
    expect(manifest.inlineUpdateMaxBytes).toBe(DEFAULT_INLINE_UPDATE_MAX_BYTES)
    expect(manifest.jsonlLineLimitBytes).toBe(DEFAULT_LINE_LIMIT_BYTES)
  })

  it('manifest 不可变：emit 前后字节恒等（创建后不可改）', () => {
    const root = freshRoot()
    const { log } = makeFileLog({ rootDir: root, namespaceId: 'ns-layout-7', updateCapture: true, inlineUpdateMaxBytes: 16 })
    const p = streamPaths(root, 'ns-layout-7', log.streamId)
    const before = readFileSync(p.manifestPath)

    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(16) } }))
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(4097) } }))
    log.emitter.emit(baseEmission({ result: { kind: 'rejected' } }))

    const after = readFileSync(p.manifestPath)
    expect(after.equals(before)).toBe(true)
  })

  it('.bin 惰性创建：仅 inline 写入时不存在，首次 sidecar 出现时创建', () => {
    const root = freshRoot()
    const { log } = makeFileLog({ rootDir: root, namespaceId: 'ns-layout-8', updateCapture: true })
    const p = streamPaths(root, 'ns-layout-8', log.streamId)

    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    expect(existsSync(p.binPath)).toBe(false)

    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(4097) } }))
    expect(existsSync(p.binPath)).toBe(true)
  })

  it('streamId 由注入随机源确定性生成（log- + 32 hex）', () => {
    const rootA = freshRoot()
    const rootB = freshRoot()
    const randomSource = createDeterministicRandomSource(new Uint8Array([0xab, 0xcd, 0x01, 0x23]))
    const a = makeFileLog({ rootDir: rootA, namespaceId: 'ns-layout-9a', randomSource })
    const b = makeFileLog({ rootDir: rootB, namespaceId: 'ns-layout-9b', randomSource })
    expect(a.log.streamId).toBe(b.log.streamId)
    expect(a.log.streamId).toMatch(/^log-[0-9a-f]{32}$/)
  })
})

describe('AC1 路径安全文法：namespaceId 不符合安全文法 → 日志不启用并上报（ADR 0012）', () => {
  const HOSTILE_NAMESPACE_IDS = ['../escape', 'a/b', '..', '.', '', 'a\\b', 'ns\u0000x'] as const

  for (const namespaceId of HOSTILE_NAMESPACE_IDS) {
    it(`namespaceId ${JSON.stringify(namespaceId)} → 不创建任何文件、emitter 不抛、上报 stream-init-failed`, () => {
      const root = freshRoot()
      const { log, events } = makeFileLog({ rootDir: root, namespaceId })

      // 不 throw（初始化失败不影响任何调用方）
      expect(typeof log.emitter.emit).toBe('function')
      // 不静默另存：rootDir 下不出现任何文件（目录可为空，但绝无产物）
      expect(countFilesRecursive(root)).toBe(0)
      // 路径未逃逸：rootDir 外层无 escape 目录
      expect(existsSync(join(root, '..', 'escape'))).toBe(false)
      // 上报：独立健康 observer 收到 stream-init-failed（ADR 0012 code LOG_STREAM_INIT_FAILED）
      const events1 = eventsOfType(events, 'stream-init-failed')
      expect(events1).toHaveLength(1)
      expect(events1[0]).toMatchObject({ type: 'stream-init-failed', code: 'LOG_STREAM_INIT_FAILED', reason: 'invalid-namespace-id' })
      // emit 仍不抛（业务不受影响）
      expect(() => log.emitter.emit(baseEmission())).not.toThrow()
    })
  }

  it('安全 namespaceId 正常启用（对照）', () => {
    const root = freshRoot()
    const { log, events } = makeFileLog({ rootDir: root, namespaceId: 'ns-ok-152' })
    expect(existsSync(streamPaths(root, 'ns-ok-152', log.streamId).manifestPath)).toBe(true)
    expect(eventsOfType(events, 'stream-init-failed')).toHaveLength(0)
  })
})

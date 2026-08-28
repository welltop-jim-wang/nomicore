/**
 * 红灯契约 — AC3 校验门（append 前 VFSL + storage 校验；BIN-first）+
 * ADR 0012 验收门槛 10（manifest envelope 不匹配 → 新建 generation、旧 manifest 不改）+
 * AC5（格式/校验/队列/存储失败不干扰 producer）。
 *
 * 锚点：
 * - AC3：「Final physical records pass the built-in VFSL schema and storage validation
 *   before append, and sidecar frames are appended before their JSONL references」
 *   （ADR 0012 §VFSL record schema「append 前 VFSL validation failure 是日志 writer bug：
 *   丢弃 record、…上报，不改变业务结果」；§Writer「BIN-first 避免完整 JSONL 引用尚不存在
 *   的 frame」「write/flush 失败只改变日志健康，不影响业务」）
 * - 门槛 10：「manifest envelope 不匹配时新建 stream，不改旧 manifest」
 *   （ADR 0012 §VFSL record schema「打开现有 stream 时，manifest format/version 和 schema
 *   fingerprint 必须与内建冻结版本匹配；不匹配则旧 stream 保持只读，建立新 generation，
 *   不改写旧 manifest」）
 * - AC5 / ADR 0011：「日志 emit、排队、持久化、背压、丢弃或关闭失败不得改变业务操作的
 *   返回值…」「adapter 同步 throw 或异步失败均被隔离，并只进入独立的日志健康 metrics/observer」
 *
 * SA6 testing 接缝：injectFinalRecordFile(log, record) —— 直通 storage projection，
 * 走 VFSL 门 + storage 校验 + 落盘（inline 形状；sidecar 注入不提供 payload 归 #153）。
 */
import { existsSync, mkdirSync, readFileSync, rmdirSync, rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { crc32cHex } from '../src/crc32c.js'
import { baseEmission } from './helpers/base.js'
import {
  eventsOfType,
  eventsOfTypeRaw,
  makeFileLog,
  makeTempRoot,
  patternedBytes,
  readJsonl,
  rmTempRoot,
  streamPaths,
  validAttemptRecord,
  writeStreamFixture,
} from './helpers/file.js'
import { injectFinalRecordFile } from '../src/testing.js'
import { readStreamStrict } from '../src/index.js'

const tempRoots: string[] = []

function freshRoot(): string {
  const root = makeTempRoot()
  tempRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmTempRoot(root)
})

describe('AC3 storage projection 后、append 前的 VFSL + storage 校验门（注入违规最终 record）', () => {
  it('VFSL 违规（坏 Base64 字面形状）→ 丢弃 + vfsl-validation-failed（只带 issuePaths）+ 零落盘', () => {
    const root = freshRoot()
    const { log, events } = makeFileLog({ rootDir: root, namespaceId: 'ns-gate-1', updateCapture: true })
    const bad = validAttemptRecord(log.streamId, '1', {
      result: {
        kind: 'committed',
        effect: 'update',
        update: { storage: 'inline', format: 'yjs-update-v1', payloadLength: 3, crc32c: '9d8f1b8f', base64: 'not-base64!!' },
      },
    })
    injectFinalRecordFile(log, bad as never)

    expect(eventsOfType(events, 'vfsl-validation-failed')).toHaveLength(1)
    const v = eventsOfType(events, 'vfsl-validation-failed')[0]!
    expect(v.recordKind).toBe('attempt')
    expect(v.issuePaths.length).toBeGreaterThan(0)
    expect(v.schemaId).toBe('nomicore.namespace-diagnostic-change-record@1')
    expect(v.schemaFingerprint).toMatch(/^sha256:v1:[0-9a-f]{64}$/)
    // 未落盘
    expect(existsSync(streamPaths(root, 'ns-gate-1', log.streamId).jsonlPath)).toBe(false)
  })

  it('storage 违规 1：非规范 padding bits（AB==）→ storage-validation-failed/base64-invalid + 零落盘', () => {
    const root = freshRoot()
    const { log, events } = makeFileLog({ rootDir: root, namespaceId: 'ns-gate-2', updateCapture: true })
    const bad = validAttemptRecord(log.streamId, '1', {
      result: {
        kind: 'committed',
        effect: 'update',
        update: { storage: 'inline', format: 'yjs-update-v1', payloadLength: 1, crc32c: '5f81805a', base64: 'AB==' },
      },
    })
    injectFinalRecordFile(log, bad as never)
    expect(eventsOfType(events, 'storage-validation-failed')[0]).toMatchObject({ type: 'storage-validation-failed', recordKind: 'attempt', code: 'base64-invalid' })
    expect(existsSync(streamPaths(root, 'ns-gate-2', log.streamId).jsonlPath)).toBe(false)
  })

  it('storage 违规 2：decoded length ≠ payloadLength → base64-length-mismatch', () => {
    const root = freshRoot()
    const { log, events } = makeFileLog({ rootDir: root, namespaceId: 'ns-gate-3', updateCapture: true })
    const payload = new TextEncoder().encode('abc')
    const bad = validAttemptRecord(log.streamId, '1', {
      result: {
        kind: 'committed',
        effect: 'update',
        update: {
          storage: 'inline',
          format: 'yjs-update-v1',
          payloadLength: 6,
          crc32c: crc32cHexOf(payload),
          base64: Buffer.from(payload).toString('base64'),
        },
      },
    })
    injectFinalRecordFile(log, bad as never)
    expect(eventsOfType(events, 'storage-validation-failed')[0]).toMatchObject({ code: 'base64-length-mismatch' })
    expect(existsSync(streamPaths(root, 'ns-gate-3', log.streamId).jsonlPath)).toBe(false)
  })

  it('storage 违规 3：inline CRC 错误 → crc-mismatch', () => {
    const root = freshRoot()
    const { log, events } = makeFileLog({ rootDir: root, namespaceId: 'ns-gate-4', updateCapture: true })
    const bad = validAttemptRecord(log.streamId, '1', {
      result: {
        kind: 'committed',
        effect: 'update',
        update: {
          storage: 'inline',
          format: 'yjs-update-v1',
          payloadLength: 3,
          crc32c: '00000000',
          base64: Buffer.from(new TextEncoder().encode('abc')).toString('base64'),
        },
      },
    })
    injectFinalRecordFile(log, bad as never)
    expect(eventsOfType(events, 'storage-validation-failed')[0]).toMatchObject({ code: 'crc-mismatch' })
    expect(existsSync(streamPaths(root, 'ns-gate-4', log.streamId).jsonlPath)).toBe(false)
  })

  it('storage 违规 4：record.streamId 与本 stream 不符 → stream-mismatch', () => {
    const root = freshRoot()
    const { log, events } = makeFileLog({ rootDir: root, namespaceId: 'ns-gate-5', updateCapture: true })
    const bad = validAttemptRecord('log-22222222222222222222222222222222', '1')
    injectFinalRecordFile(log, bad as never)
    expect(eventsOfType(events, 'storage-validation-failed')[0]).toMatchObject({ code: 'stream-mismatch' })
    expect(existsSync(streamPaths(root, 'ns-gate-5', log.streamId).jsonlPath)).toBe(false)
  })

  it('校验失败与合法记录互不干扰：注入违规后正常 emit 照常落盘、reader 全绿', () => {
    const root = freshRoot()
    const { log, events } = makeFileLog({ rootDir: root, namespaceId: 'ns-gate-6', updateCapture: true })
    injectFinalRecordFile(log, validAttemptRecord(log.streamId, '1', { result: { kind: 'committed', effect: 'update', update: { storage: 'inline', format: 'yjs-update-v1', payloadLength: 3, crc32c: '00000000', base64: Buffer.from(new TextEncoder().encode('abc')).toString('base64') } } }) as never)
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(10) } }))

    const records = readJsonl(streamPaths(root, 'ns-gate-6', log.streamId).jsonlPath)
    expect(records).toHaveLength(1) // 违规注入零落盘；合法 emit 照常
    expect(records[0]!.recordKind).toBe('attempt')
    expect(records[0]!.result).toMatchObject({ kind: 'committed', effect: 'update', update: { storage: 'inline' } })
    expect(eventsOfType(events, 'storage-validation-failed')).toHaveLength(1)

    const read = readStreamStrict({ rootDir: root, namespaceId: 'ns-gate-6', streamId: log.streamId })
    expect(read.status).toBe('ok')
  })
})

describe('AC3 BIN-first：frame 写入失败时 JSONL 绝不引用不存在的 frame（磁盘故障注入）', () => {
  it('.bin 路径被目录占位（EISDIR）→ emit 不抛、无 sidecar 引用、事件上报；恢复后继续', () => {
    const root = freshRoot()
    const { log, events } = makeFileLog({ rootDir: root, namespaceId: 'ns-binfirst-1', updateCapture: true })
    const p = streamPaths(root, 'ns-binfirst-1', log.streamId)

    // 前置：一条 inline 记录落在 JSONL
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(10) } }))
    expect(readJsonl(p.jsonlPath)).toHaveLength(1)

    // 阻塞 .bin：以目录占位 → frame append 必然失败
    mkdirSync(p.binPath, { recursive: true })
    expect(() => log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(4097) } }))).not.toThrow()

    // BIN-first：JSONL 没有新增任何 sidecar 引用（缺帧引用永不落盘）
    const lines = readJsonl(p.jsonlPath)
    expect(lines).toHaveLength(1)
    for (const line of lines) {
      const update = (line.result as { update?: { storage?: string } }).update
      if (update !== undefined) expect(update.storage).not.toBe('sidecar')
    }
    // 故障只进日志健康：storage-write-failed 事件上报
    const fails = eventsOfType(events, 'storage-write-failed')
    expect(fails.length).toBeGreaterThanOrEqual(1)
    expect(fails[0]).toMatchObject({ type: 'storage-write-failed', stage: 'bin' })

    // 恢复：frame 可写 → 新记录正常落盘且帧完整
    rmdirSync(p.binPath)
    expect(() => log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(4097) } }))).not.toThrow()
    const after = readJsonl(p.jsonlPath)
    expect(after).toHaveLength(2)
    const second = after[1]!
    expect((second.result as { update: { storage: string } }).update.storage).toBe('sidecar')
    const seq = second.sequence as string

    const read = readStreamStrict({ rootDir: root, namespaceId: 'ns-binfirst-1', streamId: log.streamId })
    expect(read.status).toBe('ok')
    // 恢复后的 frame 与 JSONL 引用交叉一致（sequence 与 seq 对应）
    const rec = read.records.find((r) => r.sequence === seq)!
    expect(rec.ok).toBe(true)
  })

  it('.bin 为目录时 inline 小 update 不受影响（inline 不依赖 frame）', () => {
    const root = freshRoot()
    const { log } = makeFileLog({ rootDir: root, namespaceId: 'ns-binfirst-2', updateCapture: true })
    const p = streamPaths(root, 'ns-binfirst-2', log.streamId)
    mkdirSync(p.binPath, { recursive: true })
    expect(() => log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(10) } }))).not.toThrow()
    expect(readJsonl(p.jsonlPath)).toHaveLength(1)
  })

  it('JSONL 路径被占位 → emit 不抛 + 事件 + 恢复后继续（业务零影响）', () => {
    const root = freshRoot()
    const { log, events } = makeFileLog({ rootDir: root, namespaceId: 'ns-binfirst-3', updateCapture: true })
    const p = streamPaths(root, 'ns-binfirst-3', log.streamId)

    // 阻塞从零开始（无存量 fd）：segments/ 存在，且 00000001.jsonl 是目录 → 打开即 EISDIR
    rmSync(p.jsonlPath, { recursive: true, force: true })
    mkdirSync(p.jsonlPath, { recursive: true })
    expect(() => log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'noop' } }))).not.toThrow()
    expect(eventsOfType(events, 'storage-write-failed').some((e) => e.stage === 'jsonl')).toBe(true)

    // 恢复：目录移除 → 后续记录正常落盘
    rmSync(p.jsonlPath, { recursive: true })
    expect(() => log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'noop' } }))).not.toThrow()
    const lines = readJsonl(p.jsonlPath)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.result).toEqual({ kind: 'committed', effect: 'noop' })
  })
})

describe('AC5 observer 故障隔离（存储故障事件经 observer 上报；observer 自身抛错不外溢）', () => {
  it('observer 每事件必 throw → emit 不抛、fallbackLog 收到稳定码行、日志继续', () => {
    const root = freshRoot()
    const lines: string[] = []
    const observer = {
      onEvent: () => {
        throw new Error('observer boom')
      },
    }
    const { log } = makeFileLog({
      rootDir: root,
      namespaceId: 'ns-obs-1',
      updateCapture: true,
      observer,
      fallbackLog: (line: string) => {
        lines.push(line)
      },
    })
    const p = streamPaths(root, 'ns-obs-1', log.streamId)
    mkdirSync(p.binPath, { recursive: true }) // 触发存储故障事件

    expect(() => log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(4097) } }))).not.toThrow()
    expect(lines.filter((l) => l.startsWith('DIAGNOSTIC_LOG_OBSERVER_FAILED')).length).toBeGreaterThanOrEqual(1)
  })
})

describe('ADR 0012 验收门槛 10：manifest envelope/schema fingerprint 不匹配 → 新建 generation、旧 manifest 不改', () => {
  it('resume 到指纹不符的旧 stream → stream-generation-rotated{stream-incompatible} + 新 streamId、旧 manifest 字节恒等、旧 segments 零写入、current.json 指向新 stream', () => {
    const root = freshRoot()
    const ns = 'ns-mismatch'
    const oldStream = 'log-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

    // 旧 generation：合法 manifest + 一条旧记录（envelope text 被篡改 → 指纹不匹配；
    // #153 R1（SA2 #2）归因钉死：14 键篡改指纹 → stream-incompatible（manifest 门 incompatible
    // 判定先于 17 键要求），**不是** legacy-manifest）
    writeStreamFixture(root, ns, oldStream, {
      manifest: {
        format: 'ndcl-manifest',
        version: 1,
        streamId: oldStream,
        namespaceId: ns,
        createdAt: '2026-08-28T12:00:00.000Z',
        schema: { lang: 'vfsl', version: 1, id: 'nomicore.namespace-diagnostic-change-record@1', text: 'tampered-schema-text' },
        recordVersion: 1,
        frameVersion: 1,
        schemaId: 'nomicore.namespace-diagnostic-change-record@1',
        schemaFingerprint: 'sha256:v1:' + '0'.repeat(64),
        committedUpdateCapture: false,
        inputCapturePolicy: 'digest',
        inlineUpdateMaxBytes: 4096,
        jsonlLineLimitBytes: 1048576,
      },
      jsonlLines: [validAttemptRecord(oldStream, '1')],
    })
    const oldManifestBefore = readFileSync(streamPaths(root, ns, oldStream).manifestPath)

    // 打开：fingerprint 不匹配 → rotate（事件通道从 stream-init-failed/manifest-mismatch
    // 迁移到 stream-generation-rotated{cause:'stream-incompatible'}，§11.3）
    const { log, events } = makeFileLog({ rootDir: root, namespaceId: ns, resumeStreamId: oldStream, updateCapture: true })
    expect(log.streamId).not.toBe(oldStream)
    expect(log.streamId).toMatch(/^log-[0-9a-f]{32}$/)
    const rotated = eventsOfTypeRaw(events, 'stream-generation-rotated')
    expect(rotated).toHaveLength(1)
    expect(rotated[0]).toMatchObject({ type: 'stream-generation-rotated', cause: 'stream-incompatible' })
    // #153：init-failed 仅保留给 disabled 终态（invalid-namespace-id/invalid-stream-id/
    // locator-ambiguous/invalid-roll-targets）——本路径不得再发 init-failed
    expect(eventsOfTypeRaw(events, 'stream-init-failed')).toHaveLength(0)
    expect(eventsOfTypeRaw(events, 'stream-tail-repaired')).toHaveLength(0)

    // 旧 manifest 字节恒等（不改写旧 manifest）
    expect(readFileSync(streamPaths(root, ns, oldStream).manifestPath).equals(oldManifestBefore)).toBe(true)

    // 新 generation 落盘；emit 均进新 stream
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(10) } }))
    expect(readJsonl(streamPaths(root, ns, log.streamId).jsonlPath)).toHaveLength(1)
    // 旧 segments 无新写入（旧目录里仍是 fixture 的 jsonl 单行）
    const oldJsonlPath = streamPaths(root, ns, oldStream).jsonlPath
    expect(readJsonl(oldJsonlPath)).toHaveLength(1)
    // current.json 指向新 stream
    const current = JSON.parse(readFileSync(streamPaths(root, ns, log.streamId).currentPath, 'utf8')) as { streamId: string }
    expect(current.streamId).toBe(log.streamId)

    // 旧 stream 由 strict reader 诚实判定（fingerprint 不符 → incompatible，不近似解释）
    const read = readStreamStrict({ rootDir: root, namespaceId: ns, streamId: oldStream })
    expect(read.status).toBe('incompatible')
  })
})

function crc32cHexOf(bytes: Uint8Array): string {
  return crc32cHex(bytes)
}

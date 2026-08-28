/**
 * R2 补充测试（SA6 域外；SA2 R1 攻击点 #1/#2/#3/#4/#5/#6/#8 + R2-1 实现期强制项与
 * 实现期备注 1 的落地；设计 §9「R2 补充测试映射」）。
 *
 * 独立新文件（≠ 改既有 SA6 断言；§12「新增独立文件」边界声明的落地）：
 * - EISDIR 恢复变体（#1）与外部 truncate 自愈（#1/(ii)）：fresh-stat offset 不变量；
 * - 构造 crash 三连（#2）：clock throw / NaN / 超域 → 构造级 catch-all；
 * - reader fs 包络（#3）：segments 目录删除 / jsonl 目录占位 / bin 目录占位；
 * - exhausted 转换（#4）：createFileDiagnosticLogPresetSequence 预置接缝；
 * - manifest 身份/严格度（#5/#8）：streamId 篡改 / 第 15 键 / 类型篡改；
 * - 注入超预算（#6）与 getter 陷阱注入（实现期备注 1）；
 * - R2-1：预置接缝 loud 校验（≥ UINT64_MAX / 前导零 / 非十进制 → throw；'0' 合法）。
 */
import { existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { crc32cHex } from '../src/crc32c.js'
import { UINT64_MAX } from '../src/adapters/memory.js'
import { readStreamStrict } from '../src/index.js'
import {
  createEventCollectingObserver,
  createFileDiagnosticLogPresetSequence,
  injectFinalRecordFile,
} from '../src/testing.js'
import { baseEmission } from './helpers/base.js'
import {
  encodeFrame,
  eventsOfType,
  makeFileLog,
  makeTempRoot,
  patternedBytes,
  readJsonl,
  rmTempRoot,
  streamPaths,
  validAttemptRecord,
  validManifest,
  writeStreamFixture,
} from './helpers/file.js'

const tempRoots: string[] = []

function freshRoot(): string {
  const root = makeTempRoot()
  tempRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmTempRoot(root)
})

const NS = 'ns-r2'
const STREAM = 'log-11111111111111111111111111111111'

function issueCodes(issues: readonly { code: string }[]): string[] {
  return issues.map((i) => i.code)
}

describe('R2 补充（#1）：fresh-stat offset 不变量——EISDIR 恢复与外部截断自愈', () => {
  it('成功帧后 EISDIR 再恢复：新帧引用真实落点 125，reader 全绿', () => {
    const root = freshRoot()
    const { log, events } = makeFileLog({ rootDir: root, namespaceId: 'ns-r2-eisdir', updateCapture: true, inlineUpdateMaxBytes: 64 })
    const p = streamPaths(root, 'ns-r2-eisdir', log.streamId)

    // 首发 sidecar 成功帧（100B payload → 25+100=125B .bin）
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    const saved = readFileSync(p.binPath)

    // 目录占位 → EISDIR 失败（offset 规划 fresh-stat 下 isFile()=false → 0，append 必败）
    rmSync(p.binPath, { force: true })
    mkdirSync(p.binPath, { recursive: true })
    expect(() =>
      log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(200) } })),
    ).not.toThrow()
    expect(eventsOfType(events, 'storage-write-failed').some((e) => e.stage === 'bin' && e.code === 'EISDIR')).toBe(true)

    // 恢复：移除目录并还原原帧内容（模拟「故障后真实文件尾完好」的崩溃窗口）
    rmdirSync(p.binPath)
    writeFileSync(p.binPath, saved)
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(200) } }))

    const after = readJsonl(p.jsonlPath)
    expect(after).toHaveLength(2)
    const last = after[1]!
    const update = last.result as { update: { frameOffset: string } }
    expect(update.update.frameOffset).toBe('125') // 真实文件尾（fresh stat），非缓存/目录尺寸

    const read = readStreamStrict({ rootDir: root, namespaceId: 'ns-r2-eisdir', streamId: log.streamId })
    expect(read.status).toBe('ok')
    const rec = read.records.find((r) => r.sequence === (last.sequence as string))!
    expect(rec.ok).toBe(true)
  })

  it('外部 truncate(bin,50) 后再写：新帧引用真实 EOF，旧帧诚实帧损坏', () => {
    const root = freshRoot()
    const { log } = makeFileLog({ rootDir: root, namespaceId: 'ns-r2-trunc', updateCapture: true, inlineUpdateMaxBytes: 64 })
    const p = streamPaths(root, 'ns-r2-trunc', log.streamId)

    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(100) } }))
    truncateSync(p.binPath, 50)
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'update', updateBytes: patternedBytes(200) } }))

    const after = readJsonl(p.jsonlPath)
    const last = after[1]!
    const update = last.result as { update: { frameOffset: string } }
    expect(update.update.frameOffset).toBe('50') // 自愈：fresh stat 取真实 EOF（非缓存 125/350）

    const read = readStreamStrict({ rootDir: root, namespaceId: 'ns-r2-trunc', streamId: log.streamId })
    expect(read.status).toBe('corrupt') // 被截断的首帧诚实报告损坏
    expect(read.records[0]!.ok).toBe(false)
    expect(issueCodes(read.records[0]!.issues)).toContain('frame-crc-mismatch')
    expect(read.records[1]!.ok).toBe(true) // 新帧引用真实落点、全量校验通过
  })
})

describe('R2 补充（#2）：构造级 crash 包络（clock throw / NaN / 超域）', () => {
  for (const [label, now] of [
    ['throw', () => { throw new Error('clock boom') }],
    ['NaN', () => NaN],
    ['超域 8.64e15+1', () => 8.64e15 + 1],
  ] as const) {
    it(`clock.now() ${label} → 构造不抛、恰一次 pipeline-crashed、emit 不抛零落盘`, () => {
      const root = freshRoot()
      const observer = createEventCollectingObserver()
      const log = createFileDiagnosticLogPresetSequence({ rootDir: root, namespaceId: 'ns-r2-crash', clock: { now }, observer }, '0')
      const p = streamPaths(root, 'ns-r2-crash', log.streamId)

      expect(log.streamId).toMatch(/^log-[0-9a-f]{32}$/)
      const crashed = eventsOfType(observer.events, 'pipeline-crashed')
      expect(crashed).toHaveLength(1)
      expect(crashed[0]).toMatchObject({ type: 'pipeline-crashed', stage: 'adapter' })
      expect(() => log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'noop' } }))).not.toThrow()
      expect(existsSync(p.manifestPath)).toBe(false)
      expect(existsSync(p.jsonlPath)).toBe(false)
    })
  }
})

describe('R2 补充（#3）：reader fs 错误包络——损坏状态下绝不抛', () => {
  it('segments 目录被删 → 不抛 + corrupt + manifest-invalid', () => {
    const root = freshRoot()
    writeStreamFixture(root, NS, STREAM, { jsonlLines: [validAttemptRecord(STREAM, '1')] })
    rmSync(streamPaths(root, NS, STREAM).segmentsDir, { recursive: true, force: true })

    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.issues)).toContain('manifest-invalid')
  })

  it('jsonl 目录占位 → 不抛 + corrupt + invalid-json（segment 归因）', () => {
    const root = freshRoot()
    const p = streamPaths(root, NS, STREAM)
    writeStreamFixture(root, NS, STREAM, { jsonlLines: [validAttemptRecord(STREAM, '1')] })
    rmSync(p.jsonlPath, { recursive: true, force: true })
    mkdirSync(p.jsonlPath, { recursive: true })

    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.issues)).toContain('invalid-json')
    expect(read.issues.some((i) => i.code === 'invalid-json' && i.segment === '00000001')).toBe(true)
  })

  it('bin 目录占位 + sidecar 引用 → 不抛 + corrupt + frame-missing', () => {
    const root = freshRoot()
    const p = streamPaths(root, NS, STREAM)
    const payload = patternedBytes(4097)
    const record = validAttemptRecord(STREAM, '1', {
      result: {
        kind: 'committed',
        effect: 'update',
        update: { storage: 'sidecar', format: 'yjs-update-v1', segment: '00000001', frameOffset: '0', payloadLength: 4097, crc32c: crc32cHex(payload) },
      },
    })
    writeStreamFixture(root, NS, STREAM, {
      jsonlLines: [record],
      bin: encodeFrame(1, payload),
    })
    rmSync(p.binPath, { force: true })
    mkdirSync(p.binPath, { recursive: true })

    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.records[0]!.issues)).toContain('frame-missing')
  })
})

describe('R2 补充（#4）：exhausted 转换（预置接缝）与 R2-1 入参 loud 校验', () => {
  it('预置 UINT64_MAX−1：首次 emit 落盘 UINT64_MAX 且恰一次 stream-exhausted；后续静默零落盘；reader ok', () => {
    const root = freshRoot()
    const observer = createEventCollectingObserver()
    const log = createFileDiagnosticLogPresetSequence(
      { rootDir: root, namespaceId: 'ns-r2-exh', updateCapture: true, observer },
      '18446744073709551614',
    )
    const p = streamPaths(root, 'ns-r2-exh', log.streamId)

    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'noop' } }))
    let records = readJsonl(p.jsonlPath)
    expect(records).toHaveLength(1)
    expect(records[0]!.sequence).toBe(UINT64_MAX)
    expect(eventsOfType(observer.events, 'stream-exhausted')).toHaveLength(1)

    // 转换后：静默丢弃、零落盘、不再发事件
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'noop' } }))
    records = readJsonl(p.jsonlPath)
    expect(records).toHaveLength(1)
    expect(eventsOfType(observer.events, 'stream-exhausted')).toHaveLength(1)
    expect(eventsOfType(observer.events, 'record-dropped')).toHaveLength(0)

    const read = readStreamStrict({ rootDir: root, namespaceId: 'ns-r2-exh', streamId: log.streamId })
    expect(read.status).toBe('ok')
    expect(read.records[0]!.ok).toBe(true)
  })

  it('R2-1：预置 ≥UINT64_MAX / 前导零 / 非十进制 → loud throw；预置 0 合法', () => {
    const root = freshRoot()
    const config = { rootDir: root, namespaceId: 'ns-r2-preset' }
    expect(() => createFileDiagnosticLogPresetSequence(config, UINT64_MAX)).toThrow()
    expect(() => createFileDiagnosticLogPresetSequence(config, '18446744073709551616')).toThrow()
    expect(() => createFileDiagnosticLogPresetSequence(config, '01')).toThrow()
    expect(() => createFileDiagnosticLogPresetSequence(config, 'abc')).toThrow()

    const observer = createEventCollectingObserver()
    const log = createFileDiagnosticLogPresetSequence({ ...config, observer }, '0')
    log.emitter.emit(baseEmission({ result: { kind: 'committed', effect: 'noop' } }))
    const records = readJsonl(streamPaths(root, 'ns-r2-preset', log.streamId).jsonlPath)
    expect(records[0]!.sequence).toBe('1')
  })
})

describe('R2 补充（#5/#8）：manifest 身份互核与严格度', () => {
  it('manifest.streamId 篡改（目录名指向 STREAM）→ corrupt + stream 级 stream-mismatch + records []', () => {
    const root = freshRoot()
    writeStreamFixture(root, NS, STREAM, {
      manifest: validManifest('log-22222222222222222222222222222222', NS),
      jsonlLines: [validAttemptRecord(STREAM, '1')],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.issues)).toContain('stream-mismatch')
    expect(read.records).toHaveLength(0)
    expect(read.manifest).not.toBeNull()
  })

  it('第 15 键 → corrupt + manifest-invalid + records []', () => {
    const root = freshRoot()
    writeStreamFixture(root, NS, STREAM, {
      manifest: validManifest(STREAM, NS, { strayKey: true }),
      jsonlLines: [validAttemptRecord(STREAM, '1')],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.issues)).toContain('manifest-invalid')
    expect(read.records).toHaveLength(0)
  })

  it('inlineUpdateMaxBytes:"4096"（字符串类型篡改）→ corrupt + manifest-invalid', () => {
    const root = freshRoot()
    writeStreamFixture(root, NS, STREAM, {
      manifest: validManifest(STREAM, NS, { inlineUpdateMaxBytes: '4096' }),
      jsonlLines: [validAttemptRecord(STREAM, '1')],
    })
    const read = readStreamStrict({ rootDir: root, namespaceId: NS, streamId: STREAM })
    expect(read.status).toBe('corrupt')
    expect(issueCodes(read.issues)).toContain('manifest-invalid')
    expect(read.records).toHaveLength(0)
  })
})

describe('R2 补充（#6 + 实现期备注 1）：injectFinalRecordFile 门序与崩溃包络', () => {
  it('注入超 line 预算（4 MiB inline base64）→ 零落盘 + record-dropped/line-budget-exceeded', () => {
    const root = freshRoot()
    const { log, events } = makeFileLog({ rootDir: root, namespaceId: 'ns-r2-inject-budget', updateCapture: true })
    const huge = validAttemptRecord(log.streamId, '1', {
      result: {
        kind: 'committed',
        effect: 'update',
        update: {
          storage: 'inline',
          format: 'yjs-update-v1',
          payloadLength: 3 * 1024 * 1024,
          crc32c: '00000000',
          base64: 'A'.repeat(4 * 1024 * 1024),
        },
      },
    })
    injectFinalRecordFile(log, huge as never)

    const dropped = eventsOfType(events, 'record-dropped')
    expect(dropped).toHaveLength(1)
    expect(dropped[0]!.reason).toBe('line-budget-exceeded')
    expect(existsSync(streamPaths(root, 'ns-r2-inject-budget', log.streamId).jsonlPath)).toBe(false)
  })

  it('注入含 throw getter 的 record → 接缝不抛 + 恰一次 pipeline-crashed（appendFinal 顶层 catch 显式化）', () => {
    const root = freshRoot()
    const { log, events } = makeFileLog({ rootDir: root, namespaceId: 'ns-r2-inject-trap' })
    const base = validAttemptRecord(log.streamId, '1') as Record<string, unknown>
    const trapped = new Proxy(base, {
      get(target, prop, receiver) {
        if (prop === 'result') throw new Error('getter trap')
        return Reflect.get(target, prop, receiver)
      },
    })
    expect(() => injectFinalRecordFile(log, trapped as never)).not.toThrow()
    expect(eventsOfType(events, 'pipeline-crashed')).toHaveLength(1)
    expect(eventsOfType(events, 'pipeline-crashed')[0]).toMatchObject({ type: 'pipeline-crashed', stage: 'adapter' })
    expect(existsSync(streamPaths(root, 'ns-r2-inject-trap', log.streamId).jsonlPath)).toBe(false)
  })
})

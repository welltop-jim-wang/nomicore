/**
 * SA6 共享契约夹具 — issue #152 File adapter（非测试文件，vitest 不以 `*.test.ts` 匹配）。
 *
 * 作用：为 packages/namespace-diagnostic-log/test/file-adapter-*.test.ts 提供
 * - 临时根目录（mkdtemp）与磁盘清理；
 * - ADR 0012 §File adapter 布局的路径派生（namespaces/{namespaceId}/…）；
 * - current.json / manifest.json / JSONL 的读写与校验夹具；
 * - NDCL v1 25-byte frame header 的构造/解码（ADR 0012 §Binary frame v1 逐字节）；
 * - File adapter 装配工厂 + 事件收集；
 * - 手工 fake stream 写入（strict reader 的损坏/不兼容注入用）。
 *
 * 契约锚点：ADR 0012 §File adapter 布局 / §JSONL record / §Binary frame v1 /
 * §VFSL record schema / §Inline 与 sidecar；#148 设计 §3.4（冻结信封指纹）。
 * 所有断言针对运行时产物（磁盘文件字节、observer 事件、reader 返回），
 * 不对源码文本做任何字符串/正则断言。
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect } from 'vitest'
import { crc32cHex } from '../../src/crc32c.js'
import {
  RECORD_SCHEMA_ENVELOPE,
  RECORD_SCHEMA_ID,
  RECORD_SCHEMA_TEXT,
} from '../../src/schema.js'
import type { DiagnosticLogHealthEvent, DiagnosticLogHealthObserver } from '../../src/health.js'
import type { FileDiagnosticLog, FileDiagnosticLogConfig } from '../../src/index.js'
import { createFileDiagnosticLog } from '../../src/index.js'
import { createEventCollectingObserver } from '../../src/testing.js'
import { OBSERVED_AT } from './base.js'
// 事件窄化单源：复用 base.ts 的 eventsOfType（同签名；file.ts 单向 import base.ts，无循环——
// N-7 去重：删除本地重复实现）
export { eventsOfType } from './base.js'
/**
 * #153 辅助：对新健康事件成员（src 类型面尚未加成员时）以原始形状按 type 判别窄化。
 * 保证红灯测试在 src 类型面冻结期也能编译通过（SA3 加成员后仍编译——只按字符串判别）。
 * 用法：`eventsOfTypeRaw(events, 'stream-generation-rotated')` → Array<Record<string, unknown>>。
 */
export function eventsOfTypeRaw(events: readonly DiagnosticLogHealthEvent[], type: string): Array<Record<string, unknown>> {
  return (events as unknown as Array<Record<string, unknown>>).filter((e) => e.type === type)
}
// frame 基架与本模块解耦（零缺失接缝依赖，可独立自检）——见 frame.ts 头注
export {
  FRAME_HEADER_BYTES,
  PAYLOAD_TYPE_YJS_UPDATE_V1,
  patternedBytes,
  encodeFrame,
  decodeFrame,
  recomputeFrameCrc,
  isCanonicalBase64,
} from './frame.js'
import type { DecodedFrame } from './frame.js'
import { isCanonicalBase64 } from './frame.js'

export type { DecodedFrame }

/** 冻结信封指纹（#148 schema-freeze 钉死常量；manifest 内嵌校验用）。 */
export const FROZEN_ENVELOPE_FINGERPRINT =
  'sha256:v1:dedad2ab93d9df9224960ca094924168f8bcc1c0512dfdd0a03dc6e66613e070'

/** manifest 声明自身格式/版本（SA6 契约常量）与 ADR 0012「record、frame 与 schema 版本」。 */
export const MANIFEST_FORMAT = 'ndcl-manifest'
export const MANIFEST_VERSION = 1
export const CURRENT_FORMAT = 'ndcl-current'
export const CURRENT_VERSION = 1
export const RECORD_VERSION = 1
export const FRAME_VERSION = 1
export const DEFAULT_INLINE_UPDATE_MAX_BYTES = 4096
export const DEFAULT_LINE_LIMIT_BYTES = 1024 * 1024
/** #153 roll targets 默认值（ADR 0012 §Segment rolling：64 MiB / 256 MiB / 100,000 records；冻结进 manifest）。 */
export const DEFAULT_TARGET_JSONL_SEGMENT_BYTES = 67108864
export const DEFAULT_TARGET_BIN_SEGMENT_BYTES = 268435456
export const DEFAULT_TARGET_RECORDS_PER_SEGMENT = 100000

/** 安全 namespaceId（ADR 0012：必须按安全文法校验后才能进入路径）。 */
export const SAFE_NAMESPACE_ID = 'ns-test-152'

/** 临时根目录（每个测试私有）。 */
export function makeTempRoot(prefix = 'ndcl-file-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** 清理临时根目录。 */
export function rmTempRoot(root: string): void {
  rmSync(root, { recursive: true, force: true })
}

/** ADR 0012 §File adapter 布局的路径派生。 */
export function streamPaths(rootDir: string, namespaceId: string, streamId: string) {
  const namespaceDir = join(rootDir, 'namespaces', namespaceId)
  const streamsDir = join(namespaceDir, 'streams')
  const streamDir = join(streamsDir, streamId)
  const segmentsDir = join(streamDir, 'segments')
  return {
    namespaceDir,
    currentPath: join(namespaceDir, 'current.json'),
    streamsDir,
    streamDir,
    manifestPath: join(streamDir, 'manifest.json'),
    segmentsDir,
    jsonlPath: join(segmentsDir, '00000001.jsonl'),
    binPath: join(segmentsDir, '00000001.bin'),
  }
}

/** 读 JSON 文件并解析。 */
export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

/** 逐行读取 JSONL（每行一个紧凑 JSON object；UTF-8 无 BOM、\n 结尾）。 */
export function readJsonl(file: string): Array<Record<string, unknown>> {
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>)
}

/** 已落盘 JSONL 原始字节（BOM/结尾换行校验用）。 */
export function readJsonlBytes(file: string): Buffer {
  return readFileSync(file)
}

/** 装配 File adapter + 事件收集 observer。 */
export interface AssembledFileLog {
  log: FileDiagnosticLog
  events: DiagnosticLogHealthEvent[]
  observer: DiagnosticLogHealthObserver & { events: DiagnosticLogHealthEvent[] }
}

/** 默认配置（临时根 + 安全 namespaceId；emit 用 baseEmission 覆盖）。 */
export function defaultFileConfig(rootDir: string): FileDiagnosticLogConfig {
  return { rootDir, namespaceId: SAFE_NAMESPACE_ID }
}

/** 装配 File adapter（rootDir/namespaceId 为必填——调用方始终提供；Partial 装配经 fixture seam）。 */
export function makeFileLog(config: Partial<FileDiagnosticLogConfig> = {}): AssembledFileLog {
  const observer = createEventCollectingObserver()
  const log = createFileDiagnosticLog({ observer, ...config } as FileDiagnosticLogConfig)
  return { log, events: observer.events, observer }
}

/** 标准 manifest（SA6 契约键集；ADR 0012「至少保存」逐项）。
 *  R2 修订（PR #159，设计 §2.2）：默认 `committedUpdateCapture: true`——reader 基线夹具的
 *  record 携带 update carrier，manifest 必须与之政策一致，否则 R2 起的 policy 校验
 *  （manifest-update-capture-violation）会判夹具自身为 corrupt（夹具语义：记录被测
 *  reader 行为，不引政策噪音）；capture=false 的敌意用例由测试显式 override。
 *  #153 修订（设计 §4.2/§11.3）：默认追加三 roll target 键（17 键当前形状——本票
 *  writer 的产物形状；默认值 = ADR 0012 §Segment rolling 默认）；14 键 legacy 形状
 *  请用 `legacyManifest`（§13.18(b)/§13.19 双形状锚）。 */
export function validManifest(streamId: string, namespaceId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    streamId,
    namespaceId,
    createdAt: OBSERVED_AT,
    schema: { lang: 'vfsl', version: 1, id: RECORD_SCHEMA_ID, text: RECORD_SCHEMA_TEXT },
    recordVersion: RECORD_VERSION,
    frameVersion: FRAME_VERSION,
    schemaId: RECORD_SCHEMA_ID,
    schemaFingerprint: FROZEN_ENVELOPE_FINGERPRINT,
    committedUpdateCapture: true,
    inputCapturePolicy: 'digest',
    inlineUpdateMaxBytes: DEFAULT_INLINE_UPDATE_MAX_BYTES,
    jsonlLineLimitBytes: DEFAULT_LINE_LIMIT_BYTES,
    targetJsonlSegmentBytes: DEFAULT_TARGET_JSONL_SEGMENT_BYTES,
    targetBinSegmentBytes: DEFAULT_TARGET_BIN_SEGMENT_BYTES,
    targetRecordsPerSegment: DEFAULT_TARGET_RECORDS_PER_SEGMENT,
    ...overrides,
  }
}

/** 14 键 legacy manifest（#152 时代 writer 的合法产物形状；设计 §4.1 步 1d/§13.18(b)/§13.19）。 */
export function legacyManifest(streamId: string, namespaceId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { targetJsonlSegmentBytes: _a, targetBinSegmentBytes: _b, targetRecordsPerSegment: _c, ...legacy } = validManifest(streamId, namespaceId)
  return { ...legacy, ...overrides }
}

/** 标准 current.json locator（ADR 0012：只保存 format/version/streamId）。 */
export function validCurrent(streamId: string): Record<string, unknown> {
  return { format: CURRENT_FORMAT, version: CURRENT_VERSION, streamId }
}

/** 多 segment fixture 条目（#153 writeStreamFixture 扩展：current.json 与多 segment 夹具支持）。 */
export interface StreamSegmentFixture {
  /** 8 位十进制 segment 名（P_SEGMENT 文法）。 */
  segment: string
  jsonlText?: string
  jsonlLines?: unknown[]
  bin?: Uint8Array
}

/**
 * 手工 fake stream（strict reader 损坏/不兼容注入用）：
 * - 默认写 manifest.json + segments/00000001.{jsonl,bin}（jsonlText 逐字节 or jsonlLines 序列化）；
 * - `segments` 提供 → 按条目写每 segment 的 .jsonl/.bin（多 segment / 非 00000001 夹具），
 *   此时顶层 jsonlText/jsonlLines/bin（00000001 别名）忽略；
 * - `current` 提供 → 写 namespaceDir/current.json（true → validCurrent(streamId)，对象 → 逐字
 *   JSON 化，字符串 → 原样字节写入——坏 JSON 腐蚀用例）。
 */
export function writeStreamFixture(
  root: string,
  namespaceId: string,
  streamId: string,
  opts: {
    manifest?: unknown
    jsonlText?: string
    jsonlLines?: unknown[]
    bin?: Uint8Array
    current?: boolean | Record<string, unknown> | string
    segments?: StreamSegmentFixture[]
  } = {},
): string {
  const p = streamPaths(root, namespaceId, streamId)
  mkdirSync(p.segmentsDir, { recursive: true })
  writeFileSync(p.manifestPath, JSON.stringify(opts.manifest ?? validManifest(streamId, namespaceId)))
  if (opts.segments !== undefined) {
    for (const seg of opts.segments) {
      if (seg.jsonlText !== undefined) {
        writeFileSync(join(p.segmentsDir, `${seg.segment}.jsonl`), seg.jsonlText)
      } else if (seg.jsonlLines !== undefined) {
        const lines = seg.jsonlLines.map((line) => JSON.stringify(line) + '\n').join('')
        writeFileSync(join(p.segmentsDir, `${seg.segment}.jsonl`), lines)
      }
      if (seg.bin !== undefined) {
        writeFileSync(join(p.segmentsDir, `${seg.segment}.bin`), seg.bin)
      }
    }
  } else {
    if (opts.jsonlText !== undefined) {
      writeFileSync(p.jsonlPath, opts.jsonlText)
    } else if (opts.jsonlLines !== undefined) {
      const lines = opts.jsonlLines.map((line) => JSON.stringify(line) + '\n').join('')
      writeFileSync(p.jsonlPath, lines)
    }
    if (opts.bin !== undefined) {
      writeFileSync(p.binPath, opts.bin)
    }
  }
  if (opts.current !== undefined) {
    mkdirSync(p.namespaceDir, { recursive: true })
    if (opts.current === true) {
      writeFileSync(p.currentPath, JSON.stringify(validCurrent(streamId)))
    } else if (typeof opts.current === 'string') {
      writeFileSync(p.currentPath, opts.current)
    } else {
      writeFileSync(p.currentPath, JSON.stringify(opts.current))
    }
  }
  return p.streamDir
}

/** 合法 attempt record（small inline update 'abc'）——strict reader 正例与损坏基线。 */
export function validAttemptRecord(
  streamId: string,
  sequence: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const payload = new TextEncoder().encode('abc')
  return {
    recordKind: 'attempt',
    streamId,
    sequence,
    attemptId: 'att-11111111111111111111111111111111',
    operation: 'root-mutation',
    stage: 'transaction',
    observedAt: OBSERVED_AT,
    source: { kind: 'local' },
    input: { capture: 'not-accessed' },
    result: {
      kind: 'committed',
      effect: 'update',
      update: {
        storage: 'inline',
        format: 'yjs-update-v1',
        payloadLength: payload.byteLength,
        crc32c: crc32cHex(payload),
        base64: Buffer.from(payload).toString('base64'),
      },
    },
    ...overrides,
  }
}

/** 内联 carrier 的 storage 交叉校验（decode 长度 + CRC；ADR 0012 §storage validator）。 */
export function checkInlineCarrier(update: { base64: string; payloadLength: number; crc32c: string }): Uint8Array {
  expect(isCanonicalBase64(update.base64), 'inline base64 必须为标准 RFC 4648（含 padding、无空白）').toBe(true)
  const decoded = Buffer.from(update.base64, 'base64')
  expect(decoded.byteLength, 'decoded length 必须与 payloadLength 一致').toBe(update.payloadLength)
  expect(crc32cHex(decoded), 'inline CRC32C 必须与 decoded payload 一致').toBe(update.crc32c)
  return new Uint8Array(decoded)
}

/**
 * #153 夹具：sidecar attempt record（引用 segment/frameOffset 处的帧；payload 确定 CRC）。
 * 默认 segment '00000001'、frameOffset '0'、payloadLength = payload.byteLength、crc32c 由
 * payload 计算——手工夹具的「合法帧引用」基模（与 encodeFrame 配对成 healthy stream）。
 * overrides 可故意覆盖 crc32c/frameOffset/payloadLength 造损坏引用。
 */
export function sidecarAttemptRecord(
  streamId: string,
  sequence: string,
  payload: Uint8Array,
  opts: {
    segment?: string
    frameOffset?: string | number
    payloadLength?: number
    crc32c?: string
    overrides?: Record<string, unknown>
  } = {},
): Record<string, unknown> {
  return validAttemptRecord(streamId, sequence, {
    result: {
      kind: 'committed',
      effect: 'update',
      update: {
        storage: 'sidecar',
        format: 'yjs-update-v1',
        segment: opts.segment ?? '00000001',
        frameOffset: String(opts.frameOffset ?? '0'),
        payloadLength: opts.payloadLength ?? payload.byteLength,
        crc32c: opts.crc32c ?? crc32cHex(payload),
      },
    },
    ...(opts.overrides ?? {}),
  })
}

/** #153 夹具：若干 Uint8Array 的顺序拼接（frame 串接基模）。 */
export function concatU8(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

// ============================================================================
// #154 红灯契约辅助（SA6 纯增量；issue #154 保留/租约/删除的 fixture 扩展——
// 零既有函数改动、零既有测试断言变更）
// ============================================================================

/**
 * #154：segments 目录条目枚举（readdirSync 排序；保留文件名含后缀）。
 * 判定锚：ADR 0012 §Retention 删除协议 —— `.deleting` 标记与段落文件共存于 segments/。
 */
export function segmentEntriesOf(rootDir: string, namespaceId: string, streamId: string): string[] {
  return readdirSync(streamPaths(rootDir, namespaceId, streamId).segmentsDir).sort()
}

/**
 * #154：任意 segment 的 jsonl/bin/deleting 三路径。
 * `.deleting` 命名约定 = ADR 0012 L291「将 .jsonl 原子 rename 为 .deleting」+
 * SA2 设计 §4.2 钉死命名（组删除协议 S1 state 文件）。
 */
export function segmentPathsOf(rootDir: string, namespaceId: string, streamId: string, segment: string) {
  const segmentsDir = streamPaths(rootDir, namespaceId, streamId).segmentsDir
  return {
    jsonlPath: join(segmentsDir, `${segment}.jsonl`),
    binPath: join(segmentsDir, `${segment}.bin`),
    deletingPath: join(segmentsDir, `${segment}.deleting`),
  }
}

/** #154：组字节合计（jsonl+bin 实际字节；文件不存在计 0 —— INV-10 字节核算口径）。 */
export function groupBytesOf(p: { jsonlPath: string; binPath: string }): number {
  let total = 0
  for (const file of [p.jsonlPath, p.binPath]) {
    try {
      total += statSync(file).size
    } catch {
      // ENOENT = 0 字节（INV-10：stat ENOENT=0）
    }
  }
  return total
}

/**
 * #154：目录树 → { 相对路径: 字节数 } 快照（目录不存在 → 空 Map）。
 * 零写入/零改动断言用（构造门禁后目录字节恒等证明）。
 */
export function bytesSnapshotOf(dir: string): Map<string, number> {
  const out = new Map<string, number>()
  if (!existsSync(dir)) return out
  const walk = (d: string, prefix: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) walk(full, join(prefix, entry.name))
      else out.set(join(prefix, entry.name), statSync(full).size)
    }
  }
  walk(dir, '')
  return out
}

/** #154：逐 segment（8 位名升序）读取全部 JSONL record。 */
export function readAllSegmentRecords(
  rootDir: string,
  namespaceId: string,
  streamId: string,
): Array<{ segment: string; record: Record<string, unknown> }> {
  const p = streamPaths(rootDir, namespaceId, streamId)
  const out: Array<{ segment: string; record: Record<string, unknown> }> = []
  for (const entry of segmentEntriesOf(rootDir, namespaceId, streamId)) {
    if (!entry.endsWith('.jsonl')) continue
    const segment = entry.slice(0, -'.jsonl'.length)
    for (const record of readJsonl(join(p.segmentsDir, entry))) out.push({ segment, record })
  }
  return out
}

/**
 * #154：合成组删除协议中断态（W1/W2——ADR 步骤 2「rename jsonl → .deleting」之后、
 * 步骤 3「unlink bin」之前/之后）。
 * - keepBin=true  → W1（.deleting + bin）
 * - keepBin=false → W2（仅 .deleting）
 * 前置：目标 segment 的 .jsonl 存在且无 .deleting 残留（loud throw——fixture 装配错误）。
 */
export function synthesizeDeletingMarker(
  rootDir: string,
  namespaceId: string,
  streamId: string,
  segment: string,
  opts: { keepBin: boolean },
): void {
  const p = segmentPathsOf(rootDir, namespaceId, streamId, segment)
  if (!existsSync(p.jsonlPath)) throw new Error(`synthesizeDeletingMarker: ${segment}.jsonl 不存在（fixture 装配错误）`)
  if (existsSync(p.deletingPath)) throw new Error(`synthesizeDeletingMarker: ${segment}.deleting 已存在（fixture 装配错误）`)
  renameSync(p.jsonlPath, p.deletingPath)
  if (!opts.keepBin) unlinkSync(p.binPath)
}

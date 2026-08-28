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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

/** 事件窄化（reuse base.ts 语义的本地副本——避免 helper 间彼此 import 循环）。 */
export function eventsOfType<T extends DiagnosticLogHealthEvent['type']>(
  events: readonly DiagnosticLogHealthEvent[],
  type: T,
): Extract<DiagnosticLogHealthEvent, { type: T }>[] {
  return events.filter((e): e is Extract<DiagnosticLogHealthEvent, { type: T }> => e.type === type)
}

/** 标准 manifest（SA6 契约键集；ADR 0012「至少保存」逐项）。 */
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
    committedUpdateCapture: false,
    inputCapturePolicy: 'digest',
    inlineUpdateMaxBytes: DEFAULT_INLINE_UPDATE_MAX_BYTES,
    jsonlLineLimitBytes: DEFAULT_LINE_LIMIT_BYTES,
    ...overrides,
  }
}

/** 标准 current.json locator（ADR 0012：只保存 format/version/streamId）。 */
export function validCurrent(streamId: string): Record<string, unknown> {
  return { format: CURRENT_FORMAT, version: CURRENT_VERSION, streamId }
}

/**
 * 手工 fake stream（strict reader 损坏/不兼容注入用）：
 * 写 manifest.json + segments/00000001.jsonl（jsonlText 逐字节 or jsonlLines 序列化）
 * + 可选 00000001.bin。
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
  } = {},
): string {
  const p = streamPaths(root, namespaceId, streamId)
  mkdirSync(p.segmentsDir, { recursive: true })
  writeFileSync(p.manifestPath, JSON.stringify(opts.manifest ?? validManifest(streamId, namespaceId)))
  if (opts.jsonlText !== undefined) {
    writeFileSync(p.jsonlPath, opts.jsonlText)
  } else if (opts.jsonlLines !== undefined) {
    const lines = opts.jsonlLines.map((line) => JSON.stringify(line) + '\n').join('')
    writeFileSync(p.jsonlPath, lines)
  }
  if (opts.bin !== undefined) {
    writeFileSync(p.binPath, opts.bin)
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

/**
 * File diagnostic-log adapter（设计 §3/§4——issue #152；#153 §3/§5.5/§6/§7/§8；
 * ADR 0012 §File adapter）。
 *
 * 契约摘要：
 * - 构造即建三件套：segments/（recursive mkdir）→ manifest.json（'wx' 不可变创建，
 *   17 键 = 恰 14 键 + #153 三 roll target）→ genesis（尽力）→ current.json（temp + rename 原子替换）；
 * - #153 构造期 reopen：locator 确定性三分支（显式 resumeStreamId > 可用 current.json >
 *   恰一候选扫描恢复；≥2 候选 → disabled + locator-ambiguous，绝不猜测）→ 健康证明
 *   （analyzeStreamForResume）通过则续写（lastCommittedSequence 续接 + 三类可证明尾部
 *   修复逐次上报 stream-tail-repaired；全有或全无），失败则确定性 rotate
 *   （stream-generation-rotated{cause:…} + 新 generation 承接，旧流只读字节恒等）；
 * - #153 segment group 滚动：三 roll target 任一达到「当前用量 ≥ target」→ 下一记录前
 *   滚入下一 8 位编号 segment（JSONL/BIN 成对、惰性创建、无关闭标记文件）；
 *   99999999 溢出 = exhausted disabled + 恰一次 stream-exhausted，绝不新建 generation；
 * - 同步落盘：每 record 独立 open-append-close（`appendFileSync`），无队列、无
 *   batch、无 fsync、无常驻 fd（§4.3/J2；EISDIR 占位恢复语义的必要条件；
 *   R2 ADR-0012 amendment 把有界同步 append 显性化为首切片决策，write-slot 外接线
 *   为规范性条件——见 docs/adr/0012）；
 * - R2 提交点纪律（设计 §3.2/§3.2.1）：sequence 以 candidate 在「全部可失败准备门
 *   通过、即将进入 JSONL append 的提交分支」时取得并即刻物化；definitive pre-commit
 *   failure（open 期 EISDIR/EACCES/ENOENT，零字节可证明）不消耗 candidate 可复用；
 *   ambiguous outcome（write 期失败等不能证明零字节）保守 reservation + 封闭旧
 *   generation（failed/readonly），绝不写第二条相同 sequence，证据走
 *   「may not be persisted」fallbackLog 行；confirmed success 才推进
 *   lastCommittedSequence（UINT64_MAX → 恰一次 stream-exhausted）；
 * - 每 record：三守卫（empty / update-capture-disabled / payload-too-large →
 *   update-omitted）→ inline/sidecar 物理投影（sidecar 的 frameOffset 恒取 append 前
 *   fresh stat——无内存-磁盘孪生状态）→ line 预算（先降级后丢弃）→ VFSL 门 →
 *   storage 门 → 落盘（BIN-first）；构造级 crash 包络与 FILE_INTERNAL 直通接缝
 *   （不分配 sequence、不触碰 exhausted 门闩）同 round 1。
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { validateLogicalSnapshot } from '@nomicore/vfsl'
import { buildInlineCarrier } from '../carrier.js'
import { crc32cHex } from '../crc32c.js'
import { bytesToHex, cryptoRandomBytes } from '../digest.js'
import { observedAtFrom } from '../emission.js'
import type { DiagnosticEmitterConfig, DiagnosticSemanticRecord, EmissionResult, NamespaceDiagnosticChangeEmitter, RandomSource } from '../emission.js'
import { decodeFrame, encodeFrame, frameCrcOf } from '../frame.js'
import { defaultFallbackLog, makeEventNotifier } from '../health.js'
import type { DiagnosticLogHealthObserver } from '../health.js'
import { isSafeNamespaceId, isSafeStreamId, segmentFilePaths, streamLayoutPaths } from '../paths.js'
import { enumerateSegmentGroups } from '../reader.js'
import type { SegmentGroupEnumeration } from '../reader.js'
import { analyzeStreamForResume } from '../reader.js'
import type { ResumeRepair } from '../reader.js'
import { releaseNamespaceLeasePartition, segmentLeased } from '../read-session.js'
import { normalizeRetentionConfig } from '../retention.js'
import type { FileRetentionConfig, NormalizedRetentionConfig, RetentionSweepReport } from '../retention.js'
import { createDiagnosticChangeEmitter } from '../pipeline.js'
import type { AttemptRecord, AttemptResult, DiagnosticChangeRecord, GenesisBaselineRecord, UpdateCarrier } from '../record.js'
import { RECORD_SCHEMA_ENVELOPE, RECORD_SCHEMA_ID, getRecordSchemaCompilation } from '../schema.js'
import type { RecordSchemaCompilationResult } from '../schema.js'
import { isCanonicalDecimal, validateInlineCarrier, validateSidecarFrame } from '../storage-gate.js'
import type { Operation } from '../vocabulary.js'
import { isOperation } from '../vocabulary.js'
import { nextDecimal, UINT64_MAX } from './memory.js'

/** File adapter 配置（§1.3：全可选项带 `| undefined` 显式联合——exactOptionalPropertyTypes 装配模式）。 */
export interface FileDiagnosticLogConfig {
  /** 日志根目录；单进程独占（ADR 0012 §Writer），不做跨进程锁。 */
  rootDir: string
  /** 日志根目录下的 namespace 目录段；进入路径前过安全文法（§2.6）。 */
  namespaceId: string
  /** 提供 → 新 stream 先尽力写 genesis-baseline（sequence 1，§4.2）。 */
  genesisUpdateBytes?: Uint8Array | undefined
  /** 提供 → 显式续写目标（§3.1 ①）：构造期健康证明通过 → 从 lastCommittedSequence 续写；
   *  证明失败 → 确定性 rotate（`stream-generation-rotated{cause:…}`），绝不静默回退 locator。 */
  resumeStreamId?: string | undefined
  /** 输入捕获策略，默认 'digest'（emitter 管线配置；冻结进 manifest `inputCapturePolicy`）。 */
  inputPolicy?: 'none' | 'digest' | 'redacted' | 'full' | undefined
  /** issues 投影策略，默认 'full'（emitter 管线配置，#148 J6 同款默认）。 */
  issuesPolicy?: 'none' | 'full' | 'redacted' | undefined
  /** attempt 的 update 捕获，默认 false（冻结进 manifest `committedUpdateCapture`；与 genesis 正交）。 */
  updateCapture?: boolean | undefined
  /** 最终 JSONL line 紧凑 JSON UTF-8 字节硬上限（不含结尾 `\n`），默认 1 MiB。 */
  lineBudgetBytes?: number | undefined
  /** 单 update payload 硬上限（守卫取 min(配置值, 0xFFFFFFFF)），默认 64 MiB。 */
  payloadMaxBytes?: number | undefined
  /** inline/sidecar 分界（≤ 内联，> sidecar），默认 4096（冻结进 manifest `inlineUpdateMaxBytes`）。 */
  inlineUpdateMaxBytes?: number | undefined
  /** #153 roll：JSONL segment 字节 target，默认 64 MiB（冻结进 manifest `targetJsonlSegmentBytes`）。 */
  targetJsonlSegmentBytes?: number | undefined
  /** #153 roll：BIN segment 字节 target，默认 256 MiB（冻结进 manifest `targetBinSegmentBytes`）。 */
  targetBinSegmentBytes?: number | undefined
  /** #153 roll：segment record 数 target，默认 100,000（冻结进 manifest `targetRecordsPerSegment`）。 */
  targetRecordsPerSegment?: number | undefined
  /** 健康观察者（#148 同一接缝；同步、可能 throw——safeNotify 隔离）。 */
  observer?: DiagnosticLogHealthObserver | undefined
  /** observer 故障 fallback logger（默认 console.error；§8.3 可注入）。 */
  fallbackLog?: ((line: string) => void) | undefined
  /** 随机源注入接缝（仅 streamId 用途；attemptId 由 emitter 管线用同一注入源）。 */
  randomSource?: RandomSource | undefined
  /** 注入时钟：manifest `createdAt` 与 genesis `observedAt` 两处同源（R2 修订：异常被
   *  构造级 crash 包络收编，不从构造函数外抛）。 */
  clock?: { now(): number } | undefined
  /** #154 retention 配置（null / undefined = 默认 30d + 1 GiB；违规值 → retention 失活 +
   *  恰一次 `retention-config-invalid`，stream 照常工作——ADR 0012 §Retention 可动态调整，
   *  不冻结进 manifest、不产生新 generation）。 */
  retention?: FileRetentionConfig | null | undefined
}

/** File 日志对象形状（§1.4；无 records()/stats() 读面——读面是 readStreamStrict）。 */
export interface FileDiagnosticLog {
  emitter: NamespaceDiagnosticChangeEmitter
  /** CSPRNG 生成 log-+32hex；实例寿命内稳定；disabled 模式也有值（§10-J6）。 */
  readonly streamId: string
  readonly rootDir: string
  readonly namespaceId: string
  /** #154：执行一次 retention sweep（卫生遍历 → 年龄遍历 → 字节遍历）。纯同步、绝不
   *  throw；一切 fs 失败计数进报告（INV-5）。now 可注入（缺省 = config.clock.now()）。 */
  sweepRetention(options?: { now?: number }): RetentionSweepReport
}

/** 实例内部状态（testing 子路径直通接缝经此访问；与 memory.ts `INTERNAL` 同款模式）。 */
export interface FileLogInternals {
  appendFinal(record: DiagnosticChangeRecord): void
}

/** 实例内部符号（非导出公共面；testing.ts 经此访问直通接缝）。 */
export const FILE_INTERNAL = Symbol('namespace-diagnostic-log:file-internal')

/** 内部工厂 options（生产构造器内部函数化——testing 子路径的注入接缝）。 */
export interface FileLogOptions {
  /** sequence 预置（仅 testing；预置到 uint64 邻域驱动 exhausted 转换）。 */
  presetLastSequence?: string
}

/** 物理化产物（attempt 三守卫后的 result + 侧车 payload）；stat 失败单独表达（§4.4 offset 规划行）。 */
type Physicalized = { result: AttemptResult; payload?: Uint8Array } | { offsetFailed: string }

const TEXT_ENCODER = new TextEncoder()

function utf8Length(text: string): number {
  return TEXT_ENCODER.encode(text).length
}

function measure(record: unknown): number {
  return utf8Length(JSON.stringify(record))
}

/** 事件中 operation 的稳定取值：词表内 → 原值；词表外（仅 fault-injection 到达）→ undefined。 */
function operationOf(value: unknown): Operation | undefined {
  if (value !== null && typeof value === 'object') {
    const candidate = (value as Record<string, unknown>).operation
    if (isOperation(candidate)) return candidate
  }
  return undefined
}

/** errno 稳定码提取（string 原样；否则 'EUNKNOWN' 兜底字面量——不上抛 message）。 */
function errnoOf(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | null)?.code
  return typeof code === 'string' ? code : 'EUNKNOWN'
}

/** ValidateIssue 段数组 → `$.a.b[0]` 形式（§8.2 低基数 issuePaths；首 10 条由调用方截取）。 */
function formatIssuePath(path: Array<string | number>): string {
  let out = '$'
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`
    else if (segment.includes('.') || segment.includes('[') || segment.includes(']')) out += `['${segment}']`
    else out += `.${segment}`
  }
  return out
}

/** 最终 record → update carrier（attempt 的 result.update / genesis 的 update；无 → null）。 */
function carrierFrom(record: DiagnosticChangeRecord): UpdateCarrier | null {
  if (record.recordKind === 'genesis-baseline') return (record as GenesisBaselineRecord).update
  const result = (record as AttemptRecord).result
  if (result.kind === 'committed') return result.effect === 'update' ? result.update : null
  if (result.kind === 'fatal' && 'effect' in result && result.effect === 'update') return result.update
  return null
}

/** manifest（§2.2 恰 14 键 + #153 三 roll target = 17 键；创建后不可变——只经 `'wx'` 写一次）。 */
function buildManifest(
  id: string,
  namespaceId: string,
  envelopeFingerprint: string,
  createdAt: string,
  updateCapture: boolean,
  inputPolicy: string,
  inlineUpdateMaxBytes: number,
  lineBudgetBytes: number,
  targetJsonlSegmentBytes: number,
  targetBinSegmentBytes: number,
  targetRecordsPerSegment: number,
): Record<string, unknown> {
  return {
    format: 'ndcl-manifest',
    version: 1,
    streamId: id,
    namespaceId,
    createdAt,
    schema: RECORD_SCHEMA_ENVELOPE,
    recordVersion: 1,
    frameVersion: 1,
    schemaId: RECORD_SCHEMA_ID,
    schemaFingerprint: envelopeFingerprint,
    committedUpdateCapture: updateCapture,
    inputCapturePolicy: inputPolicy,
    inlineUpdateMaxBytes,
    jsonlLineLimitBytes: lineBudgetBytes,
    targetJsonlSegmentBytes,
    targetBinSegmentBytes,
    targetRecordsPerSegment,
  }
}

/** #153 roll target 值域（§8.1 loud 配置门：非整数 / <1 / >2^53-1 / NaN / ∞ → 非法）。 */
function isRollTargetValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

/** 8 位十进制 segment 名 +1（'99999999' 的下一名无 8 位表示——溢出由 beforeCommit 判段耗尽）。 */
function nextSegmentName(segment: string): string {
  return (BigInt(segment) + 1n).toString().padStart(8, '0')
}

/** 构造期同步 IO 的 locator 解析（§3.1 三分支；只在构造路径调用、write-slot 外）。 */
function resolveResumeCandidate(
  rootDir: string,
  namespaceId: string,
  resumeStreamId: string | undefined,
): { kind: 'explicit'; streamId: string } | { kind: 'locator'; streamId: string } | { kind: 'recovered'; streamId: string } | { kind: 'fresh' } | { kind: 'ambiguous' } {
  // ① 显式处置优先（Host 明示的 resume 目标；不做任何静默回退）
  if (resumeStreamId !== undefined) return { kind: 'explicit', streamId: resumeStreamId }
  const base = streamLayoutPaths(rootDir, namespaceId, 'log-' + '0'.repeat(32))
  // ② locator 可用性（current.json 只保存 format/version/streamId——可重建 locator 而非完整性证明）
  let locator: { format: unknown; version: unknown; streamId: unknown } | null = null
  try {
    const parsed: unknown = JSON.parse(readFileSync(base.currentPath, 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      locator = parsed as { format: unknown; version: unknown; streamId: unknown }
    }
  } catch {
    locator = null // 缺失/不可读/解析失败 → 不可用
  }
  if (
    locator !== null &&
    locator.format === 'ndcl-current' &&
    locator.version === 1 &&
    typeof locator.streamId === 'string' &&
    isSafeStreamId(locator.streamId)
  ) {
    const targetManifest = streamLayoutPaths(rootDir, namespaceId, locator.streamId).manifestPath
    try {
      if (statSync(targetManifest).isFile()) return { kind: 'locator', streamId: locator.streamId }
    } catch {
      // 目标 manifest 不存在（stream 目录缺失/未创建）→ 先落 ③ 重扫
    }
  }
  // ③ manifests 扫描（确定性恢复；候选 = 目录名过 streamId 文法 且 manifest.json 存在）
  let candidates: string[] = []
  try {
    for (const entry of readdirSync(base.streamsDir)) {
      if (!isSafeStreamId(entry)) continue
      try {
        if (statSync(join(base.streamsDir, entry, 'manifest.json')).isFile()) candidates.push(entry)
      } catch {
        // 非候选（manifest 缺失/不可读）
      }
    }
  } catch {
    candidates = [] // streams/ 不存在 → 零候选（首次启用）
  }
  candidates.sort()
  if (candidates.length === 0) return { kind: 'fresh' }
  if (candidates.length === 1) return { kind: 'recovered', streamId: candidates[0]! }
  return { kind: 'ambiguous' }
}

/**
 * 工厂（生产构造器内部函数化——testing 子路径经 options 注入预置 sequence）。
 * 绝不向 Host 抛：任何未预见异常 → failed 模式 + 恰一次
 * `pipeline-crashed{stage:'adapter'}`（§3.1 构造级 crash 包络，R2 修订 SA2 #2）。
 */
export function createFileLog(config: FileDiagnosticLogConfig, options: FileLogOptions = {}): FileDiagnosticLog {
  const observer = config.observer
  const fallbackLog = config.fallbackLog ?? defaultFallbackLog
  const randomSource = config.randomSource ?? { randomBytes: (n: number) => cryptoRandomBytes(n) }
  const notify = makeEventNotifier(observer, fallbackLog)

  const inputPolicy = config.inputPolicy ?? 'digest'
  const issuesPolicy = config.issuesPolicy ?? 'full'
  const updateCapture = config.updateCapture ?? false
  const lineBudgetBytes = config.lineBudgetBytes ?? 1024 * 1024
  const payloadMaxBytes = Math.min(config.payloadMaxBytes ?? 64 * 1024 * 1024, 0xffffffff)
  const inlineUpdateMaxBytes = config.inlineUpdateMaxBytes ?? 4096
  const targetJsonlSegmentBytes = config.targetJsonlSegmentBytes ?? 67108864
  const targetBinSegmentBytes = config.targetBinSegmentBytes ?? 268435456
  const targetRecordsPerSegment = config.targetRecordsPerSegment ?? 100000
  const clock = config.clock ?? { now: () => Date.now() }
  const namespaceId = config.namespaceId
  // #154 retention 配置（loud 门：违规 → 仅 retention 失活 + 恰一次 retention-config-invalid；
  //   stream 照常工作——与 invalid-roll-targets 刻意不同：retention 属可动态调整类，不冻结进 manifest）。
  const retentionValidation = normalizeRetentionConfig(config.retention)
  const retentionConfig: NormalizedRetentionConfig = retentionValidation.ok
    ? retentionValidation.config
    : { maxAgeMs: null, maxBytesPerNamespace: null, sweepOnOpen: config.retention?.sweepOnOpen ?? true }
  const sweepOnOpen = retentionConfig.sweepOnOpen

  let mode: 'ready' | 'disabled' | 'failed' = 'failed'
  let currentStreamId: string | undefined
  let jsonlPath: string | null = null
  let binPath: string | null = null
  let segmentsDir: string | null = null
  /** #153 滚动状态（§6.2；内存计数——offset 恒 fresh-stat，计数器仅软阈值非对称 D4）。 */
  let currentSegment: string | null = null
  let segJsonlBytes = 0
  let segBinBytes = 0
  let segRecords = 0
  let envelopeFingerprint = ''
  /** 已确认提交的连续前缀末尾（R2 设计 §3.2：仅 confirmed success / ambiguous reservation 写入）。 */
  let lastCommittedSequence: string | null = options.presetLastSequence ?? null
  let exhaustedLatch = false
  /** ambiguous outcome 保守封闭标记（构造期 genesis 密封后不得被 mode='ready' 覆盖）。 */
  let sealed = false
  /** inject 路径 per-segment expectedOffset（§6.3 注入门与 reader 同款边界语义）。 */
  const injectedFrameOffsets = new Map<string, bigint>()

  /**
   * 无副作用候选（R2 设计 §3.2 双阶段）：仅读 lastCommittedSequence 推导下一个序号；
   * 不写任何状态——candidate 本地化，直到 confirmed success 或 ambiguous reservation
   * 才写入 lastCommittedSequence。
   */
  function candidateSequence(): string {
    return lastCommittedSequence === null ? '1' : nextDecimal(lastCommittedSequence)
  }

  /** confirmed JSONL success（§3.3）：提交点推进 + 滚动计数器推进（§6.2）；UINT64_MAX → 恰一次 stream-exhausted。 */
  function commitConfirmed(sequence: string, lineBytes: number): void {
    lastCommittedSequence = sequence
    segJsonlBytes += lineBytes
    segRecords += 1
    if (sequence === UINT64_MAX) {
      exhaustedLatch = true
      notify({ type: 'stream-exhausted' })
    }
  }

  /**
   * ambiguous outcome（R2 设计 §3.2.1）：无法证明「完整 JSONL line 未出现」——
   * 保守 reservation 该 candidate（永不复用）、封闭旧 generation（failed/readonly），
   * 绝不在旧 stream 写第二条相同 (streamId, sequence)。
   * 可观察证据（R2-G21）：经 fallbackLog 行通道——`sequence <candidate> may not be persisted`，
   * 不断言其缺失；storage-write-failed 事件字段形状不变。
   */
  function commitAmbiguous(sequence: string, stage: 'bin' | 'jsonl', code: string, operation: Operation | undefined): void {
    lastCommittedSequence = sequence
    sealed = true
    mode = 'failed'
    notify(
      operation === undefined
        ? { type: 'storage-write-failed', stage, code }
        : { type: 'storage-write-failed', stage, code, operation },
    )
    fallbackLog(
      `sequence ${sequence} may not be persisted: ${stage} append outcome ambiguous (${code}); old generation sealed, no in-place retry`,
    )
  }

  /**
   * 预计 frameOffset（§4.1 修订，R2 采纳 SA2 #1 建议 (b)）——fresh stat、无缓存：
   * 文件感知（`throwIfNoEntry:false` + `isFile()`），非常规文件（目录占位）按 0 计
   * （随后 append 必败而连同 record 丢弃——绝无「目录 st_size 当文件长」的错位引用）；
   * stat 自身 throw（EACCES 等）→ 无法规划 → 由调用方转
   * `storage-write-failed{stage:'bin'}` + 丢弃（未尝试 append，零副作用）。
   */
  function planFrameOffset(): number {
    const st = statSync(binPath!, { throwIfNoEntry: false })
    return st !== undefined && st.isFile() ? st.size : 0
  }

  /** update bytes → inline/sidecar carrier（§4.1 storage projection；侧车恒 fresh-stat）。 */
  function projectCarrier(bytes: Uint8Array): { carrier: UpdateCarrier; payload: Uint8Array } | { offsetFailed: string } {
    if (bytes.byteLength <= inlineUpdateMaxBytes) {
      return { carrier: buildInlineCarrier(bytes), payload: bytes }
    }
    let offset: number
    try {
      offset = planFrameOffset()
    } catch (err) {
      return { offsetFailed: errnoOf(err) }
    }
    return {
      carrier: {
        storage: 'sidecar',
        format: 'yjs-update-v1',
        segment: currentSegment ?? '00000001',
        frameOffset: String(offset),
        payloadLength: bytes.byteLength,
        crc32c: crc32cHex(bytes),
      },
      payload: bytes,
    }
  }

  /** 三守卫 + 物理化（§7.4 同款顺序：empty → capture-disabled → payload-too-large）。 */
  function physicalize(result: EmissionResult): Physicalized {
    if (result.kind === 'committed' && result.effect === 'update') {
      return physicalizeUpdate('committed', result.updateBytes)
    }
    if (result.kind === 'fatal' && 'effect' in result && result.effect === 'update') {
      return physicalizeUpdate('fatal', result.updateBytes)
    }
    return { result: result as AttemptResult }
  }

  function physicalizeUpdate(kind: 'committed' | 'fatal', bytes: Uint8Array): Physicalized {
    if (bytes.length === 0) {
      return { result: omitted(kind, 'empty-update') }
    }
    if (!updateCapture) {
      return { result: omitted(kind, 'update-capture-disabled') }
    }
    if (bytes.length > payloadMaxBytes) {
      return { result: omitted(kind, 'payload-too-large') }
    }
    const projected = projectCarrier(bytes)
    if ('offsetFailed' in projected) return projected
    return { result: withUpdate(kind, projected.carrier), payload: projected.payload }
  }

  function omitted(kind: 'committed' | 'fatal', reason: string): AttemptResult {
    return kind === 'committed'
      ? { kind: 'committed', effect: 'update-omitted', reason }
      : { kind: 'fatal', committed: true, effect: 'update-omitted', reason }
  }

  function withUpdate(kind: 'committed' | 'fatal', update: UpdateCarrier): AttemptResult {
    return kind === 'committed'
      ? { kind: 'committed', effect: 'update', update }
      : { kind: 'fatal', committed: true, effect: 'update', update }
  }

  /** 语义 record → attempt record（与 memory.assemble 同形状；物理化在 result 内）。 */
  function assembleAttempt(
    semantic: DiagnosticSemanticRecord,
    sequence: string,
    streamId: string,
  ): { record: AttemptRecord; payload?: Uint8Array } | { offsetFailed: string } {
    const projected = physicalize(semantic.result)
    if ('offsetFailed' in projected) return projected
    const record: AttemptRecord = {
      recordKind: 'attempt',
      streamId,
      sequence,
      attemptId: semantic.attemptId,
      operation: semantic.operation,
      stage: semantic.stage,
      observedAt: semantic.observedAt,
      source: semantic.source,
      result: projected.result,
      input: semantic.input,
    }
    if (semantic.durationMs !== undefined) record.durationMs = semantic.durationMs
    if (semantic.context !== undefined) record.context = semantic.context
    if (semantic.code !== undefined) record.code = semantic.code
    if (semantic.sourcePhase !== undefined) record.sourcePhase = semantic.sourcePhase
    if (semantic.sourceModule !== undefined) record.sourceModule = semantic.sourceModule
    if (semantic.issues !== undefined) record.issues = semantic.issues
    return { record, ...(projected.payload !== undefined ? { payload: projected.payload } : {}) }
  }

  /** storage 门（§6；失败 → 调用方转 storage-validation-failed）。返回 issue code 或 null。 */
  function storageGateIssue(record: DiagnosticChangeRecord, payload: Uint8Array | undefined): string | null {
    const streamId = currentStreamId
    if (streamId === undefined || record.streamId !== streamId) return 'stream-mismatch'
    const carrier = carrierFrom(record)
    if (carrier === null) return null
    if (carrier.storage === 'inline') return validateInlineCarrier(carrier)
    // sidecar：
    if (payload !== undefined) return null // emission 路径：自检在写帧时（§6.3）
    // 注入路径：引用存在性交叉——帧缺失/不符一律 frame-missing（总控 G3 裁决扩值）
    return checkInjectedSidecarFrame(carrier, record.sequence) === null ? null : 'frame-missing'
  }

  /** 注入 sidecar 引用自检（§6.3——读 bin、按 §7.4 全量校验该帧；通过则推进 expectedOffset）。 */
  function checkInjectedSidecarFrame(carrier: UpdateCarrier & { storage: 'sidecar' }, recordSequence: string): string | null {
    if (segmentsDir === null) return 'frame-missing'
    const binFile = join(segmentsDir, `${carrier.segment}.bin`)
    let bytes: Uint8Array | null = null
    try {
      const st = statSync(binFile, { throwIfNoEntry: false })
      if (st !== undefined && st.isFile()) bytes = readFileSync(binFile)
    } catch {
      bytes = null
    }
    const expected = injectedFrameOffsets.get(carrier.segment) ?? null
    const check = validateSidecarFrame(
      bytes,
      bytes === null ? 0 : bytes.byteLength,
      BigInt(carrier.frameOffset),
      expected,
      recordSequence,
      carrier,
    )
    if (!check.ok) return check.issue
    injectedFrameOffsets.set(carrier.segment, check.nextExpectedOffset)
    return null
  }

  /** 提交前准备门后的产物（sequence 仍为临时 preview；提交点才物化候选）。 */
  interface PreparedRecord {
    record: DiagnosticChangeRecord
    payload: Uint8Array | undefined
  }

  /**
   * 提交前准备门（R2 设计 §3.2 prepare：line 预算 → VFSL → P_DECIMAL 镜像 → storage 门）。
   * 任何失败：notify/drop 并返回 undefined——**绝不分配 sequence**（candidate 前 gate 不消耗）。
   * attempt/genesis/注入共用；注入路径 record 自带 sequence，只作形状参与校验。
   */
  function prepareRecord(
    record: DiagnosticChangeRecord,
    operation: Operation | undefined,
    payload: Uint8Array | undefined,
  ): PreparedRecord | undefined {
    // —— line 预算门（§4.1：超限先降级 input full/redacted → digest + degraded；仍超限丢弃 + 上报）——
    let effective = record
    let bytes = measure(effective)
    if (bytes > lineBudgetBytes) {
      const input = record.recordKind === 'attempt' ? (record as AttemptRecord).input : undefined
      if (input !== undefined && (input.capture === 'full' || input.capture === 'redacted')) {
        const op = operationOf(effective) ?? (effective as AttemptRecord).operation
        effective = {
          ...effective,
          input: { capture: 'digest', digest: input.digest, degraded: 'projected-input-too-large' },
        } as DiagnosticChangeRecord
        bytes = measure(effective)
        notify({ type: 'input-degraded', operation: op, fromPolicy: input.capture })
      }
    }
    if (bytes > lineBudgetBytes) {
      const base = {
        type: 'record-dropped' as const,
        reason: 'line-budget-exceeded' as const,
        projectedRecordBytes: bytes,
        queueDepth: 0,
      }
      notify(operation === undefined ? base : { ...base, operation })
      return undefined
    }
    // —— VFSL 门（失败 → writer bug 信号——只带 issuePaths，不带 message）——
    const compiled: RecordSchemaCompilationResult | null = getRecordSchemaCompilation()
    if (compiled.ok) {
      const validation = validateLogicalSnapshot(compiled.derived, effective)
      if (!validation.ok) {
        const base = {
          type: 'vfsl-validation-failed' as const,
          recordKind: effective.recordKind,
          issuePaths: validation.issues
            .filter((issue) => issue.path.length > 0)
            .slice(0, 10)
            .map((issue) => formatIssuePath(issue.path)),
          projectedRecordBytes: bytes,
          schemaId: RECORD_SCHEMA_ID,
          schemaFingerprint: compiled.envelopeFingerprint,
        }
        notify(operation === undefined ? base : { ...base, operation })
        return undefined
      }
    }
    // —— P_DECIMAL 字面镜像（R 修复轮 R-1/R-2；SA4 实证：vfsl Pattern 引擎 alternation
    //    语义放行 '01'/''/前导零——sequence 与 sidecar frameOffset 两消费面在此复核）。
    //    违规 → storage-validation-failed（code 复用 reader 29 码词表既有的 vfsl-invalid——
    //    与 G3 扩 frame-missing 同一「复用 reader 词表既有稳定码」原则）+ 零落盘；
    //    可达面仅 testing 注入接缝（emission 路径 sequence/frameOffset 恒规范）。——
    if (!isCanonicalDecimal(effective.sequence)) {
      const base = { type: 'storage-validation-failed' as const, recordKind: effective.recordKind, code: 'vfsl-invalid' }
      notify(operation === undefined ? base : { ...base, operation })
      return undefined
    }
    {
      const carrier = carrierFrom(effective)
      if (carrier !== null && carrier.storage === 'sidecar' && !isCanonicalDecimal(carrier.frameOffset)) {
        const base = { type: 'storage-validation-failed' as const, recordKind: effective.recordKind, code: 'vfsl-invalid' }
        notify(operation === undefined ? base : { ...base, operation })
        return undefined
      }
    }
    // —— storage 门（§6：inline 全量校验 / sidecar 注入引用交叉）——
    const gateIssue = storageGateIssue(effective, payload)
    if (gateIssue !== null) {
      const base = { type: 'storage-validation-failed' as const, recordKind: effective.recordKind, code: gateIssue }
      notify(operation === undefined ? base : { ...base, operation })
      return undefined
    }
    return { record: effective, payload }
  }

  /**
   * append 失败分类（R2 设计 §3.2.1）：definitive pre-commit failure = 目标文件写入前即可
   * 证明零字节（open 期 EISDIR/EACCES/ENOENT）；**其余一律 ambiguous**——不得从 errno
   * 名猜测零写入（ENOSPC 无字节回执，属歧义结果）。
   */
  function classifyAppendFailure(err: unknown): { definitive: boolean; code: string } {
    const code = errnoOf(err)
    return { definitive: code === 'EISDIR' || code === 'EACCES' || code === 'ENOENT', code }
  }

  /**
   * 滚动判定（§6.2 唯一新增调用点；仅在 emission/genesis 提交分支、candidateSequence 之前）。
   * 三计数器任一达到 target → 推进 currentSegment、重派生路径、清零计数器；
   * '99999999' 溢出 → 段耗尽路径（§7）：恰一次 stream-exhausted + 返回 false（触发 record 丢弃）。
   * 返回 false 时调用方不得提交。
   */
  function beforeCommit(): boolean {
    if (currentSegment === null) return true
    const reached =
      segJsonlBytes >= targetJsonlSegmentBytes || segBinBytes >= targetBinSegmentBytes || segRecords >= targetRecordsPerSegment
    if (!reached) return true
    if (currentSegment === '99999999') {
      exhaustedLatch = true
      notify({ type: 'stream-exhausted' })
      return false
    }
    currentSegment = nextSegmentName(currentSegment)
    const paths = segmentFilePaths(segmentsDir!, currentSegment)
    jsonlPath = paths.jsonlPath
    binPath = paths.binPath
    segJsonlBytes = 0
    segBinBytes = 0
    segRecords = 0
    return true
  }

  /**
   * 提交钩子（emission 路径：confirmed 推进 / ambiguous reservation；注入路径：不推进）。
   */
  interface CommitHooks {
    onConfirmed(sequence: string, lineBytes: number): void
    onAmbiguous(sequence: string, stage: 'bin' | 'jsonl', code: string): void
  }

  /**
   * 提交落盘（R2 设计 §3.2.1 commitPrepared；BIN-first：帧完整落盘后才写 JSONL 引用）：
   * - definitive pre-commit failure → notify storage-write-failed 后返回（candidate 可复用）；
   * - ambiguous outcome → hooks.onAmbiguous（reservation + 封闭 generation，绝不复用）；
   * - success → hooks.onConfirmed。
   * 注入路径与 emission 路径共用（payload === undefined 时不做 BIN 写——帧已被注入门验证）。
   */
  function commitRecord(
    record: DiagnosticChangeRecord,
    payload: Uint8Array | undefined,
    operation: Operation | undefined,
    hooks: CommitHooks,
  ): void {
    if (jsonlPath === null || binPath === null) return
    const carrier = carrierFrom(record)
    const isSidecar = carrier !== null && carrier.storage === 'sidecar'
    if (isSidecar && payload !== undefined) {
      // emission 路径：encode + 自检（writer bug 防线，§6.3）→ BIN append → JSONL append
      const frame = encodeFrame(record.sequence, payload)
      const decoded = decodeFrame(frame, 0)
      if (
        decoded.sequence !== BigInt(record.sequence) ||
        decoded.payloadLength !== payload.byteLength ||
        decoded.crc32c !== frameCrcOf(frame, 0)
      ) {
        // 自检失败 = 提交前 gate（零写入）：不消耗 candidate
        const base = { type: 'storage-validation-failed' as const, recordKind: record.recordKind, code: 'crc-mismatch' }
        notify(operation === undefined ? base : { ...base, operation })
        return
      }
      try {
        appendFileSync(binPath, frame)
        segBinBytes += frame.byteLength // 物理字节如实计数（含后续 JSONL definitive 失败留下的 orphan）
      } catch (err) {
        const failure = classifyAppendFailure(err)
        if (failure.definitive) {
          const base = { type: 'storage-write-failed' as const, stage: 'bin' as const, code: failure.code }
          notify(operation === undefined ? base : { ...base, operation })
          return // candidate 可复用（零字节可证明）
        }
        hooks.onAmbiguous(record.sequence, 'bin', failure.code) // orphan/partial frame 保守封闭
        return
      }
    }
    const line = JSON.stringify(record) + '\n'
    try {
      appendFileSync(jsonlPath, line)
    } catch (err) {
      const failure = classifyAppendFailure(err)
      if (failure.definitive) {
        const base = { type: 'storage-write-failed' as const, stage: 'jsonl' as const, code: failure.code }
        notify(operation === undefined ? base : { ...base, operation })
        return // candidate 可复用（BIN 已写帧的交错依 best-effort orphan 语义保留）
      }
      hooks.onAmbiguous(record.sequence, 'jsonl', failure.code) // write 期失败：不能证明零字节
      return
    }
    hooks.onConfirmed(record.sequence, utf8Length(line))
  }

  /**
   * emission 提交入口（R2 设计 §3.2：candidate 只在准备门全过后取得并即刻物化进
   * JSONL record 与（若 sidecar）frame；confirmed/ambiguous 才写入 lastCommittedSequence）。
   */
  /** 滚动后重投影（§6.4）：sidecar carrier 的 segment/frameOffset 以滚定后的当前 segment 为准。
   *  projectCarrier 在准备门阶段以滚动前状态规划（fresh-stat），滚动发生后必须重取——
   *  offset 恒 fresh-stat（正确性关键），segment 取 currentSegment（§6.4 替换 '00000001' 硬编码）。 */
  function reprojectSidecarCarrier(
    record: DiagnosticChangeRecord,
    segment: string,
    frameOffset: string,
  ): DiagnosticChangeRecord {
    const withCarrier = (update: UpdateCarrier): UpdateCarrier =>
      update.storage === 'sidecar' ? { ...update, segment, frameOffset } : update
    if (record.recordKind === 'genesis-baseline') {
      const g = record as GenesisBaselineRecord
      return { ...g, update: withCarrier(g.update) }
    }
    const a = record as AttemptRecord
    const result = a.result
    if (result.kind === 'committed' && result.effect === 'update') {
      return { ...a, result: { ...result, update: withCarrier(result.update) } }
    }
    if (result.kind === 'fatal' && 'effect' in result && result.effect === 'update') {
      return { ...a, result: { ...result, update: withCarrier(result.update) } }
    }
    return record
  }

  function commitPrepared(prepared: PreparedRecord, operation: Operation | undefined): void {
    if (!beforeCommit()) return // 段耗尽：触发 record 丢弃（事件已发）
    const candidate = candidateSequence()
    let record = { ...prepared.record, sequence: candidate } as DiagnosticChangeRecord
    let payload = prepared.payload
    if (payload !== undefined) {
      const carrier = carrierFrom(record)
      if (carrier !== null && carrier.storage === 'sidecar') {
        // 滚动后重投影（§6.4）：帧写当前 bin（binPath 已随滚动重派生）、carrier 同段 fresh-stat
        let offset: number
        try {
          offset = planFrameOffset()
        } catch (err) {
          // offset 规划行：stat throw → storage-write-failed{stage:'bin'} + 丢弃（candidate 未消费）
          notify(
            operation === undefined
              ? { type: 'storage-write-failed', stage: 'bin', code: errnoOf(err) }
              : { type: 'storage-write-failed', stage: 'bin', code: errnoOf(err), operation },
          )
          return
        }
        record = reprojectSidecarCarrier(record, currentSegment!, String(offset))
      }
    }
    commitRecord(record, payload, operation, {
      onConfirmed: (sequence, lineBytes) => commitConfirmed(sequence, lineBytes),
      onAmbiguous: (sequence, stage, code) => commitAmbiguous(sequence, stage, code, operation),
    })
  }

  /**
   * emitter → adapter 路径（§4.1 / R2 设计 §3.2：candidate 前准备门，drop 不消耗；
   * 提交点分配 + §3.2.1 definitive/ambiguous 分类；顶层 try/catch 兜底 → pipeline-crashed）。
   */
  function appendSemantic(semantic: DiagnosticSemanticRecord): void {
    try {
      if (mode !== 'ready' || exhaustedLatch || jsonlPath === null || binPath === null) return
      const streamId = currentStreamId
      if (streamId === undefined) return
      // —— 准备门（candidate 前；sequence 仅为临时 preview 参与形状校验）——
      const attempted = assembleAttempt(semantic, candidateSequence(), streamId)
      if ('offsetFailed' in attempted) {
        // §4.4 offset 规划行：stat throw → storage-write-failed{stage:'bin'} + 丢弃（candidate 未取得）
        notify({ type: 'storage-write-failed', stage: 'bin', code: attempted.offsetFailed, operation: semantic.operation })
        return
      }
      const prepared = prepareRecord(attempted.record, semantic.operation, attempted.payload)
      if (prepared === undefined) return // 门失败零落盘、不推进（line/VFSL/storage 门）
      commitPrepared(prepared, semantic.operation)
    } catch {
      const operation = operationOf(semantic)
      notify(
        operation === undefined
          ? { type: 'pipeline-crashed', stage: 'adapter' }
          : { type: 'pipeline-crashed', stage: 'adapter', operation },
      )
    }
  }

  /**
   * 直通接缝（testing.injectFinalRecordFile）：不分配 sequence、不推进 lastCommittedSequence、
   * 不触碰 exhausted 门闩（无分配即无转换——R2 修订 SA2 #6）；append 失败与 emission 路径
   * 同一分类（ambiguous → 保守封闭）；顶层 try/catch 显式化（SA2 实现期备注 1）。
   */
  function appendFinal(record: DiagnosticChangeRecord): void {
    try {
      if (mode !== 'ready' || exhaustedLatch || jsonlPath === null || binPath === null) return
      const operation = operationOf(record)
      const prepared = prepareRecord(record, operation, undefined)
      if (prepared === undefined) return
      commitRecord(prepared.record, prepared.payload, operation, {
        onConfirmed: () => {}, // 注入不推进（record 自带 sequence）
        onAmbiguous: (sequence, stage, code) => commitAmbiguous(sequence, stage, code, operation),
      })
    } catch {
      const operation = operationOf(record)
      notify(
        operation === undefined
          ? { type: 'pipeline-crashed', stage: 'adapter' }
          : { type: 'pipeline-crashed', stage: 'adapter', operation },
      )
    }
  }

  /**
   * genesis（§4.2 / R2 设计 §3.3：与 attempt 同一 final-record 管线；守卫、投影、门
   * 全部在 candidate 前结束——守卫跳过不消耗 sequence；append 失败与 attempt 走同一
   * definitive/ambiguous 分类；confirmed success 提交 '1'）。
   */
  function runGenesis(streamId: string): void {
    const bytes = config.genesisUpdateBytes
    if (bytes === undefined) return
    if (bytes.length === 0) return // 守卫跳过：不写记录、不发事件（§11-G10 豁免备案）
    if (bytes.length > payloadMaxBytes) return
    const projected = projectCarrier(bytes)
    if ('offsetFailed' in projected) {
      // IO 型失败：事件 + 不禁用 stream（genesis 尽力语义）；candidate 未取得
      notify({ type: 'storage-write-failed', stage: 'bin', code: projected.offsetFailed })
      return
    }
    const record: GenesisBaselineRecord = {
      recordKind: 'genesis-baseline',
      streamId,
      sequence: candidateSequence(), // 临时 preview；提交点物化（与最终候选一致）
      observedAt: observedAtFrom(clock.now),
      source: { kind: 'local' },
      update: projected.carrier,
    }
    const prepared = prepareRecord(record, undefined, projected.payload)
    if (prepared === undefined) return // gate drop：不消耗 sequence
    commitPrepared(prepared, undefined)
  }

  /** 新 generation 建立（§3.1 ⑤；segments → manifest('wx') → genesis → current.json；#153 §8.3 增量：
   *  manifest 17 键、段态清零——currentSegment='00000001'、三计数器 0、lastCommitted=preset??null）。 */
  function initializeGeneration(id: string): 'ok' | 'collision' | 'disabled' {
    const paths = streamLayoutPaths(config.rootDir, namespaceId, id)
    try {
      mkdirSync(paths.segmentsDir, { recursive: true })
    } catch (err) {
      notify({ type: 'storage-write-failed', stage: 'manifest', code: errnoOf(err) })
      return 'disabled'
    }
    const manifest = buildManifest(
      id,
      namespaceId,
      envelopeFingerprint,
      observedAtFrom(clock.now),
      updateCapture,
      inputPolicy,
      inlineUpdateMaxBytes,
      lineBudgetBytes,
      targetJsonlSegmentBytes,
      targetBinSegmentBytes,
      targetRecordsPerSegment,
    )
    try {
      writeFileSync(paths.manifestPath, JSON.stringify(manifest), { flag: 'wx' })
    } catch (err) {
      if (errnoOf(err) === 'EEXIST') return 'collision' // 碰撞：调用方重生成 streamId 重试
      notify({ type: 'storage-write-failed', stage: 'manifest', code: errnoOf(err) })
      return 'disabled'
    }
    jsonlPath = paths.jsonlPath
    binPath = paths.binPath
    segmentsDir = paths.segmentsDir
    currentStreamId = id
    currentSegment = '00000001'
    segJsonlBytes = 0
    segBinBytes = 0
    segRecords = 0
    lastCommittedSequence = options.presetLastSequence ?? null
    if (config.genesisUpdateBytes !== undefined) {
      runGenesis(id)
    }
    writeCurrent(paths.namespaceDir, paths.currentPath, id)
    return 'ok'
  }

  /** current.json（恰三键；temp + rename 原子替换；失败仅事件、不禁用 stream——§2.3）。 */
  function writeCurrent(namespaceDir: string, currentPath: string, id: string): void {
    const tmpPath = join(namespaceDir, 'current.json.tmp')
    try {
      writeFileSync(tmpPath, JSON.stringify({ format: 'ndcl-current', version: 1, streamId: id }))
      renameSync(tmpPath, currentPath)
    } catch (err) {
      notify({ type: 'storage-write-failed', stage: 'current', code: errnoOf(err) })
      try {
        unlinkSync(tmpPath) // best-effort 清理；ENOENT 及其他一律吞——清理失败不升级（§2.3）
      } catch {
        // 残留合法：locator 恢复只按主名 current.json 工作，tmp 固定名不参与定位
      }
    }
  }

  /** 新 generation 装配（§8.1：'wx' EEXIST 碰撞重试 ≤ 8；耗尽 → disabled + EEXIST 事件）。 */
  function initNewGeneration(): void {
    let outcome = initializeGeneration(currentStreamId!)
    let retries = 0
    while (outcome === 'collision' && retries < 8) {
      currentStreamId = 'log-' + bytesToHex(randomSource.randomBytes(16))
      retries += 1
      outcome = initializeGeneration(currentStreamId!)
    }
    if (outcome === 'collision') {
      mode = 'disabled'
      notify({ type: 'storage-write-failed', stage: 'manifest', code: 'EEXIST' })
    } else if (outcome === 'disabled') {
      mode = 'disabled'
    } else {
      // genesis 期间 ambiguous 密封（构造期 commitAmbiguous）不得被 'ready' 覆盖
      mode = sealed ? 'failed' : 'ready'
    }
  }

  /**
   * 修复应用（§5.5；顺序 C1 在前、C2/C3 在后——分析输出序）。
   * truncateSync 失败 → notify(stream-generation-rotated{cause:'repair-io-failure'}) + false；
   * 调用方收到 false 走 rotate 新 generation（已成功的修复保留、其事件保留——截断只删
   * §5.2 证明无引用字节，无历史改写）。
   */
  function applyRepairs(repairs: ResumeRepair[]): boolean {
    for (const repair of repairs) {
      const sp = segmentFilePaths(segmentsDir!, repair.segment)
      const target = repair.kind === 'jsonl-incomplete-line' ? sp.jsonlPath : sp.binPath
      try {
        truncateSync(target, repair.truncateToBytes)
      } catch {
        notify({ type: 'stream-generation-rotated', cause: 'repair-io-failure' })
        return false
      }
      notify({ type: 'stream-tail-repaired', repair: repair.kind, truncatedBytes: repair.truncatedBytes })
    }
    return true
  }

  // ============================================================================
  // #154 retention sweep（SA2 §2.2/§4.2/§4.5：卫生 → 年龄 → 字节三遍；INV-1/2/4/5/6/14）
  // ============================================================================

  /** `.deleting` 标记路径（组删除协议 S1 提交点产物；与 stream 目录级 `.deleting` 同名不同层）。 */
  function markerPathOf(segmentsDir: string, segment: string): string {
    return join(segmentsDir, `${segment}.deleting`)
  }

  /** 常规文件 stat（ENOENT/非常规文件 → 0；其他 stat 异常 → failedSteps++ 计 0——宁少删）。 */
  function statSizeAccounting(p: string, report: RetentionSweepReport): number {
    try {
      const st = statSync(p, { throwIfNoEntry: false })
      return st !== undefined && st.isFile() ? st.size : 0
    } catch {
      report.failedSteps += 1
      return 0
    }
  }

  /** 常规文件存在性（ENOENT/不可读/非常规 → false——不存在即无占用，不计数）。 */
  function statFileExists(p: string): boolean {
    try {
      const st = statSync(p, { throwIfNoEntry: false })
      return st !== undefined && st.isFile()
    } catch {
      return false
    }
  }

  /** sweep 候选流的描述（manifest.createdAt ↑, streamId ↑——SA2 §4.5 候选序）。 */
  interface SweepStream {
    streamId: string
    createdAtMs: number
    segmentsDir: string
  }

  /** streams 目录扫描（与 locator 恢复同源的文法门；manifest 缺失/不可读 → 保守跳过该流）。 */
  function scanSweepStreams(streamsDir: string): SweepStream[] | null {
    let entries: string[]
    try {
      entries = readdirSync(streamsDir)
    } catch (err) {
      return errnoOf(err) === 'ENOENT' ? [] : null
    }
    const streams: SweepStream[] = []
    for (const entry of entries) {
      if (!isSafeStreamId(entry)) continue
      try {
        const parsed = JSON.parse(readFileSync(join(streamsDir, entry, 'manifest.json'), 'utf8')) as Record<string, unknown>
        if (typeof parsed.createdAt !== 'string') continue
        const createdAtMs = Date.parse(parsed.createdAt)
        if (Number.isNaN(createdAtMs)) continue
        streams.push({ streamId: entry, createdAtMs, segmentsDir: join(streamsDir, entry, 'segments') })
      } catch {
        // manifest 缺失/不可读/非对象 → 跳过（无 createdAt 无法定序——保守不裁）
      }
    }
    streams.sort((a, b) => a.createdAtMs - b.createdAtMs || (a.streamId < b.streamId ? -1 : a.streamId > b.streamId ? 1 : 0))
    return streams
  }

  /** 单条 JSONL 行的 observedAt（ms；不可解析/无 observedAt → null）。 */
  function observedAtMsOfLine(line: string): number | null {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (typeof parsed.observedAt !== 'string') return null
      const ms = Date.parse(parsed.observedAt)
      return Number.isNaN(ms) ? null : ms
    } catch {
      return null
    }
  }

  /**
   * 组年龄判定（SA2 §4.5-R3）：`now − max(observedAt) ≥ maxAgeMs`（含等号，T-A1 钉死）。
   * - 快速否决：末行 observedAt > cutoff ⇒ max > cutoff ⇒ 必未过期（sound——max ≥ 末行值）；
   * - 零 record/无 observedAt → 恒视为过期（无可保内容；SA2 §4.5 明文）；
   * - jsonl 缺失（ENOENT） → 恒视为过期；其他读失败 → failedSteps++ + 保守不定龄（宁少删）。
   */
  function groupAgeExpired(segmentsDir: string, segment: string, cutoff: number, report: RetentionSweepReport): boolean {
    let text: string
    try {
      text = readFileSync(segmentFilePaths(segmentsDir, segment).jsonlPath, 'utf8')
    } catch (err) {
      if (errnoOf(err) === 'ENOENT') return true
      report.failedSteps += 1
      return false
    }
    const lines = text.split('\n')
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    if (lines.length > 0) {
      const last = observedAtMsOfLine(lines[lines.length - 1]!)
      if (last !== null && last > cutoff) return false
    }
    let maxObserved: number | null = null
    for (const line of lines) {
      const ms = observedAtMsOfLine(line)
      if (ms !== null && (maxObserved === null || ms > maxObserved)) maxObserved = ms
    }
    if (maxObserved === null) return true
    return maxObserved <= cutoff
  }

  /** 组删除协议（SA2 §4.2 JSONL-as-commit-marker：S1 rename jsonl→.deleting → S2 unlink bin →
   *  S3 unlink marker；ENOENT 全程容忍读＝幂等续走；任一步失败 → false（调用方计数 + 止步））。 */
  function deleteGroup(segmentsDir: string, segment: string): boolean {
    const sp = segmentFilePaths(segmentsDir, segment)
    const marker = markerPathOf(segmentsDir, segment)
    try {
      renameSync(sp.jsonlPath, marker) // S1：意图提交点（同目录原子；ENOENT = 已被续走/无 jsonl）
    } catch (err) {
      if (errnoOf(err) !== 'ENOENT') return false
    }
    try {
      unlinkSync(sp.binPath) // S2（ENOENT 容忍）
    } catch (err) {
      if (errnoOf(err) !== 'ENOENT') return false
    }
    try {
      unlinkSync(marker) // S3（ENOENT 容忍）
    } catch (err) {
      if (errnoOf(err) !== 'ENOENT') return false
    }
    return true
  }

  /** 组删除前字节（reclaimedBytes 口径：jsonl+bin 实际字节）。 */
  function groupBytesBeforeDelete(segmentsDir: string, segment: string): number {
    const sp = segmentFilePaths(segmentsDir, segment)
    let total = 0
    for (const file of [sp.jsonlPath, sp.binPath]) {
      try {
        const st = statSync(file, { throwIfNoEntry: false })
        if (st !== undefined && st.isFile()) total += st.size
      } catch {
        // ENOENT/其他 → 0（已不存在/不可读——删除仍执行，字节如实 0）
      }
    }
    return total
  }

  /** 卫生遍历（P0，无条件——协议卫生不属「限制」，ADR 步骤 4/5 无条件）：遗留 `.deleting`
   *  续走（S1→S3）+ orphan BIN 清理（闭组 bin-无-jsonl-无-marker；开组 BIN-first 瞬态绝对豁免）。 */
  function hygieneStream(stream: SweepStream, openSegment: string | null, report: RetentionSweepReport): void {
    let enumeration: SegmentGroupEnumeration
    try {
      enumeration = enumerateSegmentGroups(stream.segmentsDir)
    } catch {
      report.failedSteps += 1
      return
    }
    for (const segment of enumeration.deleting) {
      const sp = segmentFilePaths(stream.segmentsDir, segment)
      const marker = markerPathOf(stream.segmentsDir, segment)
      try {
        unlinkSync(sp.binPath) // S2（ENOENT 容忍）
      } catch (err) {
        if (errnoOf(err) !== 'ENOENT') {
          report.failedSteps += 1
          continue // 跳过该标记（下轮重试）；marker 保留 = 残留证明
        }
      }
      try {
        unlinkSync(marker) // S3（ENOENT 容忍）
      } catch (err) {
        if (errnoOf(err) !== 'ENOENT') {
          report.failedSteps += 1
          continue
        }
      }
      report.deletingMarkersCompleted += 1
    }
    for (const segment of enumeration.live) {
      if (openSegment !== null && segment === openSegment) continue // INV-1：开组 BIN-first 瞬态绝对豁免
      const sp = segmentFilePaths(stream.segmentsDir, segment)
      if (statFileExists(sp.jsonlPath) || statFileExists(markerPathOf(stream.segmentsDir, segment))) continue
      if (!statFileExists(sp.binPath)) continue
      try {
        unlinkSync(sp.binPath)
        report.orphanBinsDeleted += 1
      } catch {
        report.failedSteps += 1
      }
    }
  }

  /** 首条可枚举 record 的 sequence（scan for earliest retained；无 record → null）。 */
  function firstRecordSequenceOf(segmentsDir: string, segment: string): string | null {
    let text: string
    try {
      text = readFileSync(segmentFilePaths(segmentsDir, segment).jsonlPath, 'utf8')
    } catch {
      return null
    }
    for (const line of text.split('\n')) {
      if (line === '') continue
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>
        if (typeof parsed.sequence === 'string' && parsed.sequence !== '') return parsed.sequence
      } catch {
        // 不可解析行不计（诚实跳过）
      }
    }
    return null
  }

  /** 空报告（disabled/failed 模式下显式调用 sweepRetention 的诚实返回）。 */
  function emptySweepReport(): RetentionSweepReport {
    return {
      sweptStreams: 0,
      deletedGroups: 0,
      reclaimedBytes: 0,
      orphanBinsDeleted: 0,
      deletingMarkersCompleted: 0,
      leaseBlockedGroups: 0,
      openProtectedStops: 0,
      failedSteps: 0,
      retainedBytes: 0,
      earliestRetained: [],
      historyTrimmedStreams: [],
    }
  }

  /** sweep 主体（INV-5：绝不 throw——异常一律收敛为 failedSteps 增量 + 零删除语义）。 */
  function sweepNow(now: number): RetentionSweepReport {
    const report = emptySweepReport()
    try {
      const maxAgeMs = retentionConfig.maxAgeMs
      const maxBytes = retentionConfig.maxBytesPerNamespace
      const nsPaths = streamLayoutPaths(config.rootDir, namespaceId, currentStreamId ?? 'log-' + '0'.repeat(32))
      const streams = scanSweepStreams(nsPaths.streamsDir)
      if (streams === null) {
        report.failedSteps += 1
        return report
      }
      report.sweptStreams = streams.length
      const openSegmentOf = (streamId: string): string | null =>
        streamId === currentStreamId ? currentSegment : null

      // —— P0 卫生遍历（无条件）——
      for (const stream of streams) hygieneStream(stream, openSegmentOf(stream.streamId), report)

      // —— P1 年龄遍历（maxAgeMs ≠ null 时；每流前缀纪律：首个不可删组即止步，绝不跳洞）——
      if (maxAgeMs !== null) {
        for (const stream of streams) {
          let enumeration: SegmentGroupEnumeration
          try {
            enumeration = enumerateSegmentGroups(stream.segmentsDir)
          } catch {
            report.failedSteps += 1
            continue
          }
          const openSegment = openSegmentOf(stream.streamId)
          for (const segment of enumeration.live) {
            if (openSegment !== null && segment === openSegment) {
              report.openProtectedStops += 1
              break
            }
            if (segmentLeased(config.rootDir, namespaceId, stream.streamId, segment, now)) {
              report.leaseBlockedGroups += 1
              break
            }
            if (!groupAgeExpired(stream.segmentsDir, segment, now - maxAgeMs, report)) break // 未过期 → 止步
            const before = groupBytesBeforeDelete(stream.segmentsDir, segment)
            if (before === 0) continue // 无文件组（枚举残留）——无可删内容
            if (deleteGroup(stream.segmentsDir, segment)) {
              report.deletedGroups += 1
              report.reclaimedBytes += before
            } else {
              report.failedSteps += 1
              break // IO 失败 → 止步该流（前缀纪律）
            }
          }
        }
      }

      // —— P2 字节遍历（maxBytes ≠ null 时；Σ 全部流全部组（含闭组字节——存在即占空间）；
      //    候选序与 P1 同源；SA4 R1 裁决：**字节遍历只以 closed ∧ unleased 为门**——年龄
      //    新鲜度是 P1 年龄遍历的专属限制，字节预算必须可独立达标（两限制各自独立生效，
      //    不互相门控、不双重执法）；无可删候选（全被开组/租约/失败止步）→ 停）——
      if (maxBytes !== null) {
        let total = 0
        for (const stream of streams) {
          let enumeration: SegmentGroupEnumeration
          try {
            enumeration = enumerateSegmentGroups(stream.segmentsDir)
          } catch {
            report.failedSteps += 1
            continue
          }
          for (const segment of enumeration.live) {
            const sp = segmentFilePaths(stream.segmentsDir, segment)
            total += statSizeAccounting(sp.jsonlPath, report) + statSizeAccounting(sp.binPath, report)
          }
        }
        while (total > maxBytes) {
          let progressed = false
          for (const stream of streams) {
            if (total <= maxBytes) break
            let enumeration: SegmentGroupEnumeration
            try {
              enumeration = enumerateSegmentGroups(stream.segmentsDir)
            } catch {
              report.failedSteps += 1
              break
            }
            const openSegment = openSegmentOf(stream.streamId)
            for (const segment of enumeration.live) {
              if (total <= maxBytes) break
              if (openSegment !== null && segment === openSegment) {
                report.openProtectedStops += 1
                break
              }
              if (segmentLeased(config.rootDir, namespaceId, stream.streamId, segment, now)) {
                report.leaseBlockedGroups += 1
                break
              }
              // SA4 R1：无年龄新鲜度门（P1 专属）——字节预算下闭组即可删（前缀纪律仍生效：
              // 首个不可删组即止步该流，绝不跳洞）
              const before = groupBytesBeforeDelete(stream.segmentsDir, segment)
              if (before === 0) continue
              if (deleteGroup(stream.segmentsDir, segment)) {
                report.deletedGroups += 1
                report.reclaimedBytes += before
                total -= before
                progressed = true
              } else {
                report.failedSteps += 1
                break
              }
            }
          }
          if (!progressed) break // 无可删候选（开组/租约/失败全部止步）→ 停（INV-5 绝不动开组）
        }
      }

      // —— 报告数据面（扫描重建——ADR 明文：earliest retained sequence 通过扫描重建）——
      for (const stream of streams) {
        let enumeration: SegmentGroupEnumeration
        try {
          enumeration = enumerateSegmentGroups(stream.segmentsDir)
        } catch {
          continue
        }
        if (enumeration.live.length === 0) continue
        for (const segment of enumeration.live) {
          const sp = segmentFilePaths(stream.segmentsDir, segment)
          report.retainedBytes += statSizeAccounting(sp.jsonlPath, report) + statSizeAccounting(sp.binPath, report)
        }
        let first: string | null = null
        for (const segment of enumeration.live) {
          const seq = firstRecordSequenceOf(stream.segmentsDir, segment)
          if (seq !== null) {
            first = seq
            break
          }
        }
        report.earliestRetained.push({ streamId: stream.streamId, sequence: first })
        if (enumeration.live[0] !== '00000001') report.historyTrimmedStreams.push({ streamId: stream.streamId })
      }
      return report
    } catch {
      // INV-5：任何未预见异常 → 已计数留档（绝不外抛；报告数据面保持诚实）
      report.failedSteps += 1
      return report
    }
  }

  /** 事件规则（SA2 §2.6）：「有动作」才发——零动作（含全零卫生）不发（防 open 噪声）。 */
  function emitRetentionSweptIfAction(report: RetentionSweepReport): void {
    const action =
      report.deletedGroups > 0 ||
      report.orphanBinsDeleted > 0 ||
      report.deletingMarkersCompleted > 0 ||
      report.leaseBlockedGroups > 0 ||
      report.openProtectedStops > 0 ||
      report.failedSteps > 0
    if (!action) return
    notify({
      type: 'retention-swept',
      deletedGroups: report.deletedGroups,
      reclaimedBytes: report.reclaimedBytes,
      orphanBinsDeleted: report.orphanBinsDeleted,
      deletingMarkersCompleted: report.deletingMarkersCompleted,
      leaseBlockedGroups: report.leaseBlockedGroups,
      failedSteps: report.failedSteps,
    })
  }

  try {
    if (!retentionValidation.ok) {
      // #154 loud 配置门：违规 → 仅 retention 失活 + 恰一次 retention-config-invalid
      // （配置错不杀死日志能力——与 invalid-roll-targets 刻意不同）
      notify({ type: 'retention-config-invalid', field: retentionValidation.field })
    }
    currentStreamId = 'log-' + bytesToHex(randomSource.randomBytes(16))
    if (!isSafeNamespaceId(namespaceId)) {
      mode = 'disabled'
      notify({ type: 'stream-init-failed', code: 'LOG_STREAM_INIT_FAILED', reason: 'invalid-namespace-id' })
    } else if (config.resumeStreamId !== undefined && !isSafeStreamId(config.resumeStreamId)) {
      mode = 'disabled'
      notify({ type: 'stream-init-failed', code: 'LOG_STREAM_INIT_FAILED', reason: 'invalid-stream-id' })
    } else if (isNamespaceDeletionMarked(config.rootDir, namespaceId)) {
      // #154 marker 门（INV-8 线性化）：deletion.json 落盘后构造一律 disabled——零写入、
      // 绝不 resume/新建 generation（删除半态不得复活；重入删除是唯一完成路径）
      mode = 'disabled'
      notify({ type: 'stream-init-failed', code: 'LOG_STREAM_INIT_FAILED', reason: 'namespace-log-deleted' })
    } else if (
      !isRollTargetValue(config.targetJsonlSegmentBytes ?? 67108864) ||
      !isRollTargetValue(config.targetBinSegmentBytes ?? 268435456) ||
      !isRollTargetValue(config.targetRecordsPerSegment ?? 100000)
    ) {
      // §8.1 loud 配置门（绝不静默钳制）：非法 roll targets → disabled + invalid-roll-targets
      mode = 'disabled'
      notify({ type: 'stream-init-failed', code: 'LOG_STREAM_INIT_FAILED', reason: 'invalid-roll-targets' })
    } else {
      const compiled = getRecordSchemaCompilation()
      if (!compiled.ok) {
        mode = 'failed'
        notify({ type: 'schema-compile-failed', schemaId: RECORD_SCHEMA_ID, issueCount: compiled.issues.length })
      } else {
        envelopeFingerprint = compiled.envelopeFingerprint
        const cand = resolveResumeCandidate(config.rootDir, namespaceId, config.resumeStreamId)
        if (cand.kind === 'fresh') {
          initNewGeneration()
        } else if (cand.kind === 'ambiguous') {
          // §3.2：不创建任何新 stream、不写任何文件（含 current.json）；emitter 照常构造（J6）
          mode = 'disabled'
          notify({ type: 'stream-init-failed', code: 'LOG_STREAM_INIT_FAILED', reason: 'locator-ambiguous' })
        } else {
          const analysis = analyzeStreamForResume({
            rootDir: config.rootDir,
            namespaceId,
            streamId: cand.streamId,
            resolved: {
              updateCapture,
              inputPolicy,
              inlineUpdateMaxBytes,
              lineBudgetBytes,
              targetJsonlSegmentBytes,
              targetBinSegmentBytes,
              targetRecordsPerSegment,
            },
          })
          if (analysis.verdict === 'rotate') {
            // rotate 路径：事件先于新 generation 初始化发出（因果序）；旧 stream 保持只读、未改写
            notify({ type: 'stream-generation-rotated', cause: analysis.cause })
            initNewGeneration()
          } else {
            // §6.3 种子：currentStreamId = cand.streamId；resume 不写 genesis（genesisUpdateBytes 忽略）
            const paths = streamLayoutPaths(config.rootDir, namespaceId, cand.streamId)
            segmentsDir = paths.segmentsDir
            if (!applyRepairs(analysis.repairs)) {
              initNewGeneration() // repair-io-failure：已成功的修复保留 → rotate 新 generation
            } else {
              currentStreamId = cand.streamId
              currentSegment = analysis.resume.currentSegment
              segJsonlBytes = analysis.resume.jsonlBytes
              segBinBytes = analysis.resume.binBytes
              segRecords = analysis.resume.records
              lastCommittedSequence = analysis.resume.lastCommittedSequence
              const sp = segmentFilePaths(segmentsDir, currentSegment)
              jsonlPath = sp.jsonlPath
              binPath = sp.binPath
              if (analysis.resume.exhaustedAtOpen !== null) {
                exhaustedLatch = true
                notify({ type: 'stream-exhausted' })
              }
              writeCurrent(paths.namespaceDir, paths.currentPath, cand.streamId)
              // 构造期 genesis 不存在于 resume 路径；sealed 恒 false，保留防御位
              mode = sealed ? 'failed' : 'ready'
            }
          }
        }
      }
    }
  } catch {
    // —— 构造级 crash 包络（R2 修订 SA2 #2）：初始化失败不影响 namespace create ——
    mode = 'failed'
    notify({ type: 'pipeline-crashed', stage: 'adapter' })
  }

  // —— 形状完备返回（J6）：所有模式 emitter 照常构造（emit 同步、不抛——sink 按 mode 静默）——
  const streamId = currentStreamId ?? 'log-' + '0'.repeat(32)
  const emitterConfig: DiagnosticEmitterConfig = { inputPolicy, issuesPolicy, observer, fallbackLog, randomSource }
  const emitter = createDiagnosticChangeEmitter(emitterConfig, { append: appendSemantic })

  // #154 构造完成自动 sweep（sweepOnOpen 默认 true；仅 ready 执行——disabled/failed 零动作；
  //  `now` = config.clock.now()——T-A7 锚点：构造期自动 sweep 恒以注入钟为 now）
  if (mode === 'ready' && sweepOnOpen) {
    const report = sweepNow(clock.now())
    emitRetentionSweptIfAction(report)
  }

  const log: FileDiagnosticLog = {
    emitter,
    streamId,
    rootDir: config.rootDir,
    namespaceId,
    // #154 显式 sweep（INV-5：绝不 throw；disabled/failed → 空报告零动作；now 可注入）
    sweepRetention: (options?: { now?: number }): RetentionSweepReport => {
      if (mode !== 'ready') return emptySweepReport()
      const report = sweepNow(options?.now ?? clock.now())
      emitRetentionSweptIfAction(report)
      return report
    },
  }
  const internals: FileLogInternals = { appendFinal }
  Object.defineProperty(log, FILE_INTERNAL, { value: internals, enumerable: false })
  return log
}

/** 生产构造器（§1.2 公共面；内部实现 = createFileLog 默认 options——testing 子路径经 options 注入）。 */
export function createFileDiagnosticLog(config: FileDiagnosticLogConfig): FileDiagnosticLog {
  return createFileLog(config, {})
}

// ============================================================================
// #154 namespace 日志逻辑删除（SA2 §2.4/§4.4/§5 INV-8/12/13；ADR 0012 §Retention 与删除）
// ============================================================================

/** namespace 日志删除请求（SA2 §2.4）。 */
export interface NamespaceLogDeletionRequest {
  rootDir: string
  namespaceId: string
}

/** namespace 日志删除结果（结构化；绝不抛——失败以 code+step 显式返回，部分态可重入续走）。 */
export type NamespaceLogDeletionResult =
  | { status: 'deleted'; streamsRemoved: number } // 本次（或幂等重试）完成
  | { status: 'absent' } // namespace 目录不存在（幂等成功）
  | { status: 'failed'; code: string; step: 'marker' | 'locator' | 'stream' | 'remove' }
// code = 稳定 errno 码（'EACCES'/'ENOTEMPTY'…）或 'invalid-namespace-id' 字面量；无 message

/** deletion.json 意图标记内容（SA2 §2.4 协议钉死形状；temp+rename 原子写）。 */
const DELETION_MARKER = JSON.stringify({ format: 'ndcl-deletion', version: 1 })

/** 构造期 marker 门（INV-8）：deletion.json 存在 ⇔ 该 namespace 处于删除半态。 */
function isNamespaceDeletionMarked(rootDir: string, namespaceId: string): boolean {
  const base = streamLayoutPaths(rootDir, namespaceId, 'log-' + '0'.repeat(32))
  return existsSync(join(base.namespaceDir, 'deletion.json'))
}

/**
 * namespace 日志逻辑删除（AC-4；只承诺活跃存储的逻辑删除——命名/结果词汇/文档均无
 * secure-erase 暗示面，INV-12）：
 *   0. namespaceId 过安全文法（违规 → failed/invalid-namespace-id/marker，零 fs 触达）；
 *   1. namespaceDir 不存在 → {status:'absent'}（幂等）；
 *   2. 写 deletion.json（temp+rename：意图线性化点——此后构造一律 disabled；
 *      重入调用是唯一完成路径）；
 *   3. unlink current.json（+ best-effort current.json.tmp）；
 *   4. 逐 stream：renameSync {s} → {s}.deleting（文法不可达——不满足 P_STREAM_ID，扫描
 *      永不吞入）→ rmSync(recursive, force)；已为 {s}.deleting 的残部直接 rm（N3 续走）；
 *   5. rmSync(namespaceDir, recursive, force)（N4 续走）；
 *   6. 释放该 namespace 的租约注册表分区；该 namespace 全部会话置 closed（INV-12）。
 * 任一步失败（非 ENOENT）→ failed{code,step}；partial 态可重入续走（N1–N5 矩阵）。
 */
export function deleteNamespaceDiagnosticLog(req: NamespaceLogDeletionRequest): NamespaceLogDeletionResult {
  if (!isSafeNamespaceId(req.namespaceId)) {
    return { status: 'failed', code: 'invalid-namespace-id', step: 'marker' }
  }
  const base = streamLayoutPaths(req.rootDir, req.namespaceId, 'log-' + '0'.repeat(32))
  const namespaceDir = base.namespaceDir
  const markerPath = join(namespaceDir, 'deletion.json')
  // 1. 存在性（absent → 幂等成功）
  let dirExists = false
  try {
    dirExists = statSync(namespaceDir, { throwIfNoEntry: false }) !== undefined
  } catch {
    dirExists = false
  }
  if (!dirExists) return { status: 'absent' }
  // 2. marker（temp+rename 原子；写失败 → failed/marker）
  const tmpPath = join(namespaceDir, 'deletion.json.tmp')
  try {
    writeFileSync(tmpPath, DELETION_MARKER)
    renameSync(tmpPath, markerPath)
  } catch (err) {
    const code = errnoOf(err)
    try {
      unlinkSync(tmpPath) // best-effort 清理（残留不参与定位）
    } catch {
      // 静默（清理失败不升级——tmp 固定名不参与任何文法空间）
    }
    return { status: 'failed', code, step: 'marker' }
  }
  // 3. locator（current.json + 残留 tmp；ENOENT 容忍——N2 续走）
  try {
    unlinkSync(base.currentPath)
  } catch (err) {
    if (errnoOf(err) !== 'ENOENT') return { status: 'failed', code: errnoOf(err), step: 'locator' }
  }
  try {
    unlinkSync(join(namespaceDir, 'current.json.tmp'))
  } catch (err) {
    if (errnoOf(err) !== 'ENOENT') return { status: 'failed', code: errnoOf(err), step: 'locator' }
  }
  // 4. 逐 stream（文法门：isSafeStreamId 或 {s}.deleting 残部——其余条目一律忽略，INV-13）
  let streamsRemoved = 0
  let streamEntries: string[]
  try {
    streamEntries = readdirSync(base.streamsDir)
  } catch (err) {
    if (errnoOf(err) !== 'ENOENT') return { status: 'failed', code: errnoOf(err), step: 'stream' }
    streamEntries = []
  }
  for (const entry of streamEntries) {
    const full = join(base.streamsDir, entry)
    // N3 残部（已 rename 为 {s}.deleting、未 rm）——predicate 应用于 slice 表达式，不窄化 entry
    if (entry.endsWith('.deleting') && isSafeStreamId(entry.slice(0, -'.deleting'.length))) {
      try {
        rmSync(full, { recursive: true, force: true })
      } catch (err) {
        const code = errnoOf(err)
        if (code !== 'ENOENT') return { status: 'failed', code, step: 'stream' }
      }
      streamsRemoved += 1
    } else if (isSafeStreamId(entry)) {
      const renamed = join(base.streamsDir, `${entry}.deleting`)
      try {
        renameSync(full, renamed)
        rmSync(renamed, { recursive: true, force: true })
      } catch (err) {
        const code = errnoOf(err)
        if (code !== 'ENOENT') return { status: 'failed', code, step: 'stream' }
      }
      streamsRemoved += 1
    }
  }
  // 5. namespaceDir 移除（N4 续走：空壳 dir(+marker)）
  try {
    rmSync(namespaceDir, { recursive: true, force: true })
  } catch (err) {
    return { status: 'failed', code: errnoOf(err), step: 'remove' }
  }
  // 6. 租约分区释放（INV-12）
  releaseNamespaceLeasePartition(req.rootDir, req.namespaceId)
  return { status: 'deleted', streamsRemoved }
}

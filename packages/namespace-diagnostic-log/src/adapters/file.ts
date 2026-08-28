/**
 * File diagnostic-log adapter（设计 §3/§4——issue #152；ADR 0012 §File adapter）。
 *
 * 契约摘要：
 * - 构造即建三件套：segments/（recursive mkdir）→ manifest.json（'wx' 不可变创建，
 *   恰 14 键）→ genesis（尽力）→ current.json（temp + rename 原子替换）；
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
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
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
import { isSafeNamespaceId, isSafeStreamId, streamLayoutPaths } from '../paths.js'
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
  /** 提供 → manifest 指纹匹配检查（§3.4；#152 无续写能力——四分支全落新建 generation）。 */
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
  /** 健康观察者（#148 同一接缝；同步、可能 throw——safeNotify 隔离）。 */
  observer?: DiagnosticLogHealthObserver | undefined
  /** observer 故障 fallback logger（默认 console.error；§8.3 可注入）。 */
  fallbackLog?: ((line: string) => void) | undefined
  /** 随机源注入接缝（仅 streamId 用途；attemptId 由 emitter 管线用同一注入源）。 */
  randomSource?: RandomSource | undefined
  /** 注入时钟：manifest `createdAt` 与 genesis `observedAt` 两处同源（R2 修订：异常被
   *  构造级 crash 包络收编，不从构造函数外抛）。 */
  clock?: { now(): number } | undefined
}

/** File 日志对象形状（§1.4；无 records()/stats() 读面——读面是 readStreamStrict）。 */
export interface FileDiagnosticLog {
  emitter: NamespaceDiagnosticChangeEmitter
  /** CSPRNG 生成 log-+32hex；实例寿命内稳定；disabled 模式也有值（§10-J6）。 */
  readonly streamId: string
  readonly rootDir: string
  readonly namespaceId: string
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

/** manifest（§2.2 恰 14 键；创建后不可变——只经 `'wx'` 写一次）。 */
function buildManifest(
  id: string,
  namespaceId: string,
  envelopeFingerprint: string,
  createdAt: string,
  updateCapture: boolean,
  inputPolicy: string,
  inlineUpdateMaxBytes: number,
  lineBudgetBytes: number,
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
  }
}

/** resume 旧 manifest 的指纹匹配检查（§3.1 ③④；只读，绝不写旧 stream 目录）。 */
function readResumeManifest(path: string, frozenFingerprint: string): 'missing' | 'mismatch' | 'match' {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return 'missing'
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return 'mismatch'
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return 'mismatch'
  const m = parsed as Record<string, unknown>
  if (m.format !== 'ndcl-manifest' || m.version !== 1) return 'mismatch'
  const schema = m.schema as Record<string, unknown> | null
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return 'mismatch'
  if (
    schema.lang !== RECORD_SCHEMA_ENVELOPE.lang ||
    schema.version !== RECORD_SCHEMA_ENVELOPE.version ||
    schema.id !== RECORD_SCHEMA_ENVELOPE.id ||
    schema.text !== RECORD_SCHEMA_ENVELOPE.text
  ) {
    return 'mismatch'
  }
  if (m.schemaFingerprint !== frozenFingerprint) return 'mismatch'
  return 'match'
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
  const clock = config.clock ?? { now: () => Date.now() }
  const namespaceId = config.namespaceId

  let mode: 'ready' | 'disabled' | 'failed' = 'failed'
  let currentStreamId: string | undefined
  let jsonlPath: string | null = null
  let binPath: string | null = null
  let segmentsDir: string | null = null
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

  /** confirmed JSONL success（§3.3）：提交点推进；UINT64_MAX → 恰一次 stream-exhausted。 */
  function commitConfirmed(sequence: string): void {
    lastCommittedSequence = sequence
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
        segment: '00000001',
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
    //    违规 → storage-validation-failed（code 复用 reader 23 码既有的 vfsl-invalid——
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

  /** 提交钩子（emission 路径：confirmed 推进 / ambiguous reservation；注入路径：不推进）。 */
  interface CommitHooks {
    onConfirmed(sequence: string): void
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
    hooks.onConfirmed(record.sequence)
  }

  /**
   * emission 提交入口（R2 设计 §3.2：candidate 只在准备门全过后取得并即刻物化进
   * JSONL record 与（若 sidecar）frame；confirmed/ambiguous 才写入 lastCommittedSequence）。
   */
  function commitPrepared(prepared: PreparedRecord, operation: Operation | undefined): void {
    const candidate = candidateSequence()
    const record = { ...prepared.record, sequence: candidate } as DiagnosticChangeRecord
    commitRecord(record, prepared.payload, operation, {
      onConfirmed: (sequence) => commitConfirmed(sequence),
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

  /** 新 generation 建立（§3.1 ⑤；segments → manifest('wx') → genesis → current.json）。 */
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

  try {
    currentStreamId = 'log-' + bytesToHex(randomSource.randomBytes(16))
    if (!isSafeNamespaceId(namespaceId)) {
      mode = 'disabled'
      notify({ type: 'stream-init-failed', code: 'LOG_STREAM_INIT_FAILED', reason: 'invalid-namespace-id' })
    } else if (config.resumeStreamId !== undefined && !isSafeStreamId(config.resumeStreamId)) {
      mode = 'disabled'
      notify({ type: 'stream-init-failed', code: 'LOG_STREAM_INIT_FAILED', reason: 'invalid-stream-id' })
    } else {
      const compiled = getRecordSchemaCompilation()
      if (!compiled.ok) {
        mode = 'failed'
        notify({ type: 'schema-compile-failed', schemaId: RECORD_SCHEMA_ID, issueCount: compiled.issues.length })
      } else {
        envelopeFingerprint = compiled.envelopeFingerprint
        if (config.resumeStreamId !== undefined) {
          const resumePath = streamLayoutPaths(config.rootDir, namespaceId, config.resumeStreamId).manifestPath
          const signal = readResumeManifest(resumePath, envelopeFingerprint)
          if (signal === 'missing') {
            notify({ type: 'stream-init-failed', code: 'LOG_STREAM_INIT_FAILED', reason: 'manifest-missing' })
          } else if (signal === 'mismatch') {
            notify({ type: 'stream-init-failed', code: 'LOG_STREAM_INIT_FAILED', reason: 'manifest-mismatch' })
          }
          // match → 静默（总控 G1 裁决；#152 无续写能力——恒新建 generation）
        }
        // —— 新 generation（'wx' EEXIST 碰撞重试 ≤ 8；耗尽 → disabled + EEXIST 事件）——
        let outcome = initializeGeneration(currentStreamId)
        let retries = 0
        while (outcome === 'collision' && retries < 8) {
          currentStreamId = 'log-' + bytesToHex(randomSource.randomBytes(16))
          retries += 1
          outcome = initializeGeneration(currentStreamId)
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
  const log: FileDiagnosticLog = { emitter, streamId, rootDir: config.rootDir, namespaceId }
  const internals: FileLogInternals = { appendFinal }
  Object.defineProperty(log, FILE_INTERNAL, { value: internals, enumerable: false })
  return log
}

/** 生产构造器（§1.2 公共面；内部实现 = createFileLog 默认 options——testing 子路径经 options 注入）。 */
export function createFileDiagnosticLog(config: FileDiagnosticLogConfig): FileDiagnosticLog {
  return createFileLog(config, {})
}

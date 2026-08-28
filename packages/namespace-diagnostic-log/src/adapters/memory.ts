/**
 * 有界内存 adapter（设计 §7——emitter + sink 一体装配；AC5）。
 *
 * 契约（§7.1）：容量 capacity 条；queue 满时 drop newest（已接纳 record 与顺序不变，
 * drop 绝不作为 record 入队——ADR 0012 §Writer）；接纳序 = sequence 升序；records()
 * 返回冻结引用数组；永不 throw、永不阻塞（全同步、纯内存、O(record) CPU——
 * Base64/CRC/序列化/校验均以 line 预算为上界）。
 *
 * 数据流（§4.1）：0′ 构造时急切编译冻结 schema（失败 → failed 模式，恰一次
 * schema-compile-failed + 后续 append 全丢弃只进 stats 计数）→ 1 sequence 分配
 * （十进制字符串进位 nextDecimal，uint64 全域无 number 失真——R2/A-c1；达 uint64
 * max → exhausted 模式，丢弃 + stats 计数，不逐条发事件）→ 2 update 物理化
 * （empty-update / update-capture-disabled / payload-too-large 前置守卫 §7.4）→
 * 3 组装最终 record → 4 line 预算（超限先降级 input→digest，仍超限丢弃 → 5 VFSL 门
 * → 6 入队。
 */
import { compileSchemaEnvelope, validateLogicalSnapshot } from '@nomicore/vfsl'
import { buildInlineCarrier } from '../carrier.js'
import { bytesToHex, cryptoRandomBytes } from '../digest.js'
import type { DiagnosticEmitterConfig, DiagnosticSemanticRecord, EmissionResult, RandomSource } from '../emission.js'
import type { NamespaceDiagnosticChangeEmitter } from '../emission.js'
import { defaultFallbackLog, makeEventNotifier } from '../health.js'
import type { DiagnosticLogHealthObserver } from '../health.js'
import { createDiagnosticChangeEmitter } from '../pipeline.js'
import type { AttemptRecord, AttemptResult, DiagnosticChangeRecord, InputCapture } from '../record.js'
import { RECORD_SCHEMA_ID, getRecordSchemaCompilation } from '../schema.js'
import type { RecordSchemaCompilationResult } from '../schema.js'
import type { Operation } from '../vocabulary.js'
import { isOperation } from '../vocabulary.js'

/** uint64 最大值（decimal 字符串；ADR 0012 §JSONL record「达到 uint64 最大值后 stream 进入 exhausted」）。 */
export const UINT64_MAX = '18446744073709551615'

/** 十进制字符串进位（R2/A-c1：全程不经 number 算术——JS number 超 2^53 后失真
 *  会产出重复/跳变却仍匹配 P_DECIMAL；字符串进位覆盖 uint64 全域无失真）。 */
export function nextDecimal(s: string): string {
  const digits = s.split('')
  let i = digits.length - 1
  for (; i >= 0; i--) {
    const d = digits[i]!
    if (d === '9') {
      digits[i] = '0'
    } else {
      digits[i] = String(Number(d) + 1)
      break
    }
  }
  if (i < 0) digits.unshift('1')
  return digits.join('')
}

/** 紧凑 JSON 的 UTF-8 字节长（§5.5 measure；不含结尾 \n；TextEncoder——Buffer 不进本模块）。 */
function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length
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

/** stats 计数键分类（§7.2）。 */
interface StatsBook {
  accepted: number
  droppedTotal: number
  droppedByReason: Record<string, number>
  droppedByOperationReason: Record<string, number>
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1
}

function countDrop(book: StatsBook, reason: string, operation: Operation | undefined): void {
  book.droppedTotal += 1
  bump(book.droppedByReason, reason)
  if (operation !== undefined) bump(book.droppedByOperationReason, `${operation}:${reason}`)
}

/** 有界内存日志（设计 §1.3/§7）。 */
export interface BoundedMemoryDiagnosticLog {
  emitter: NamespaceDiagnosticChangeEmitter
  /** 本实例 streamId（构造时 CSPRNG 生成，log- + 32 hex）。 */
  readonly streamId: string
  /** 已接纳 record 的顺序快照（冻结引用，按 sequence 升序；attempt 与
   *  genesis-baseline 两族——genesis 仅经 testing 直通接缝可入队）。 */
  records(): readonly DiagnosticChangeRecord[]
  /** 低基数健康计数（accepted / dropped by reason / dropped by operation×reason / queueDepth）。 */
  stats(): DiagnosticMemoryStats
}

/** 读面统计（§7.2）。 */
export interface DiagnosticMemoryStats {
  streamId: string
  capacity: number
  queueDepth: number
  accepted: number
  droppedTotal: number
  droppedByReason: Readonly<Record<string, number>>
  droppedByOperationReason: Readonly<Record<string, number>>
  /** 十进制字符串（uint64 全域无 number 失真）；gap 诊断：与 queueDepth 差 = 丢弃数。 */
  lastSequenceAssigned: string | null
}

/** 有界内存日志配置（§1.4；全部带默认值——以 Partial 装配）。 */
export interface DiagnosticLogConfig {
  /** 输入捕获策略，默认 'digest'（ADR 0011 §输入捕获）。 */
  inputPolicy?: 'none' | 'digest' | 'redacted' | 'full'
  /** issues 投影策略，默认 'full'（judgement call §10-J6）。 */
  issuesPolicy?: 'none' | 'full' | 'redacted'
  /** committed update 捕获，默认 false（ADR 0011 §数据保护）。 */
  updateCapture?: boolean
  /** 最终 record 紧凑 JSON 的 UTF-8 字节硬上限（不含结尾 \n），默认 1 MiB。 */
  lineBudgetBytes?: number
  /** 单个 update payload 字节硬上限（≤ uint32），默认 64 MiB。 */
  payloadMaxBytes?: number
  /** 内存队列容量（条数），默认 1024。 */
  capacity?: number
  /** 健康观察者（可选；故障隔离 §8.3）。 */
  observer?: DiagnosticLogHealthObserver | undefined
  /** observer 故障 fallback logger（默认 console.error；§8.3 可注入）。 */
  fallbackLog?: ((line: string) => void) | undefined
  /** 随机源注入接缝（仅 streamId/attemptId；生产默认 CSPRNG）。 */
  randomSource?: RandomSource | undefined
}

/** 实例内部状态（testing 子路径直通接缝经此访问）。 */
export interface MemoryLogInternals {
  appendFinal(record: DiagnosticChangeRecord): void
}

/** 实例内部符号（非导出公共面；testing.ts 经此访问直通接缝）。 */
export const INTERNAL = Symbol('namespace-diagnostic-log:internal')

interface MemoryLogOptions {
  /** 自定义 envelope（R2/F-c1：注入坏 envelope 驱动 failed 模式；生产构造器内部函数化）。 */
  envelope?: unknown
  /** sequence 预置（R2/A-c1：预置到 uint64 邻域驱动 exhausted 转换）。 */
  presetLastSequence?: string
}

/** 工厂（生产构造器内部函数化——测试经 testing 子路径注入坏 envelope / 预置 sequence）。 */
export function createMemoryLog(config: DiagnosticLogConfig, options: MemoryLogOptions = {}): BoundedMemoryDiagnosticLog {
  const observer = config.observer
  const fallbackLog = config.fallbackLog ?? defaultFallbackLog
  const randomSource = config.randomSource ?? { randomBytes: (n) => cryptoRandomBytes(n) }
  const notify = makeEventNotifier(observer, fallbackLog)

  const streamId = 'log-' + bytesToHex(randomSource.randomBytes(16))
  const inputPolicy = config.inputPolicy ?? 'digest'
  const issuesPolicy = config.issuesPolicy ?? 'full'
  const updateCapture = config.updateCapture ?? false
  const lineBudgetBytes = config.lineBudgetBytes ?? 1024 * 1024
  const payloadMaxBytes = config.payloadMaxBytes ?? 64 * 1024 * 1024
  const capacity = config.capacity ?? 1024

  // —— 步骤 0′：构造时急切编译冻结 schema（失败 → failed 模式）——
  const compiled: RecordSchemaCompilationResult =
    options.envelope === undefined ? getRecordSchemaCompilation() : compileSchemaEnvelope(options.envelope)
  let failed = false
  if (!compiled.ok) {
    failed = true
    notify({
      type: 'schema-compile-failed',
      schemaId: envelopeSchemaId(options.envelope),
      issueCount: compiled.issues.length,
    })
  }

  const book: StatsBook = { accepted: 0, droppedTotal: 0, droppedByReason: {}, droppedByOperationReason: {} }
  const queue: DiagnosticChangeRecord[] = []
  let lastSequence: string | null = options.presetLastSequence ?? null
  const exhausted = () => lastSequence === UINT64_MAX && !failed

  /** record-dropped 低基数事件（failed 与 exhausted 模式事件抑制：不逐条发）。
   *  词表外 operation（仅 fault-injection 到达）→ 省略 operation 键（SA6 §3.6）。 */
  function notifyRecordDropped(
    reason: 'line-budget-exceeded' | 'queue-full',
    operation: Operation | undefined,
    bytes: number,
  ): void {
    const base = { type: 'record-dropped' as const, reason, projectedRecordBytes: bytes, queueDepth: queue.length }
    notify(operation === undefined ? base : { ...base, operation })
  }

  /** update 物理化（§7.4 三守卫前置：empty-update 最前）。 */
  function physicalize(result: EmissionResult): AttemptResult {
    if (result.kind === 'committed' && result.effect === 'update') {
      return physicalizeUpdate('committed', result.updateBytes)
    }
    if (result.kind === 'fatal' && 'effect' in result && result.effect === 'update') {
      return physicalizeUpdate('fatal', result.updateBytes)
    }
    // noop / rejected / fatal+false / effect unknown / producer 已声明 update-omitted → 原样保留
    return result as AttemptResult
  }

  function physicalizeUpdate(kind: 'committed' | 'fatal', bytes: Uint8Array): AttemptResult {
    if (bytes.length === 0) {
      return kind === 'committed'
        ? { kind: 'committed', effect: 'update-omitted', reason: 'empty-update' }
        : { kind: 'fatal', committed: true, effect: 'update-omitted', reason: 'empty-update' }
    }
    if (!updateCapture) {
      return kind === 'committed'
        ? { kind: 'committed', effect: 'update-omitted', reason: 'update-capture-disabled' }
        : { kind: 'fatal', committed: true, effect: 'update-omitted', reason: 'update-capture-disabled' }
    }
    if (bytes.length > payloadMaxBytes) {
      return kind === 'committed'
        ? { kind: 'committed', effect: 'update-omitted', reason: 'payload-too-large' }
        : { kind: 'fatal', committed: true, effect: 'update-omitted', reason: 'payload-too-large' }
    }
    return kind === 'committed'
      ? { kind: 'committed', effect: 'update', update: buildInlineCarrier(bytes) }
      : { kind: 'fatal', committed: true, effect: 'update', update: buildInlineCarrier(bytes) }
  }

  /** 语义 record → 最终 attempt record（步骤 1-3）。 */
  function assemble(semantic: DiagnosticSemanticRecord): AttemptRecord {
    const sequence = lastSequence === null ? '1' : nextDecimal(lastSequence)
    lastSequence = sequence
    const record: AttemptRecord = {
      recordKind: 'attempt',
      streamId,
      sequence,
      attemptId: semantic.attemptId,
      operation: semantic.operation,
      stage: semantic.stage,
      observedAt: semantic.observedAt,
      source: semantic.source,
      result: physicalize(semantic.result),
      input: semantic.input,
    }
    if (semantic.durationMs !== undefined) record.durationMs = semantic.durationMs
    if (semantic.context !== undefined) record.context = semantic.context
    if (semantic.code !== undefined) record.code = semantic.code
    if (semantic.sourcePhase !== undefined) record.sourcePhase = semantic.sourcePhase
    if (semantic.sourceModule !== undefined) record.sourceModule = semantic.sourceModule
    if (semantic.issues !== undefined) record.issues = semantic.issues
    return record
  }

  /** 步骤 4-6：line 预算 → VFSL 门 → 入队（emission 路径与直通接缝共用）。 */
  function gateAndEnqueue(record: DiagnosticChangeRecord): void {
    let effective = record
    let bytes = measure(effective)
    if (bytes > lineBudgetBytes) {
      // 4a：input full/redacted → 降级 digest（+degraded 标记）+ health input-degraded
      const input = effective.recordKind === 'attempt' ? (effective.input as InputCapture) : undefined
      if (input !== undefined && (input.capture === 'full' || input.capture === 'redacted')) {
        // 降级只对 attempt record 发生（genesis 无 input）——operation 键必然存在；
        // 词表外 operation（仅 fault-injection 到达）以 record 原值携带（§8.1 成员要求
        // operation: Operation，SA6 §3.6 不断言该值）
        const operation = operationOf(effective) ?? (effective as { operation: Operation }).operation
        effective = {
          ...effective,
          input: { capture: 'digest', digest: input.digest, degraded: 'projected-input-too-large' },
        } as DiagnosticChangeRecord
        bytes = measure(effective)
        notify({ type: 'input-degraded', operation, fromPolicy: input.capture })
      }
    }
    if (bytes > lineBudgetBytes) {
      // 4b：仍超限 → 丢弃整条 record
      notifyRecordDropped('line-budget-exceeded', operationOf(effective), bytes)
      countDrop(book, 'line-budget-exceeded', operationOf(effective))
      return
    }
    // 5：VFSL 校验（失败 → writer bug 信号——只带 issuePaths，不带 message）
    if (compiled.ok) {
      const validation = validateLogicalSnapshot(compiled.derived, effective)
      if (!validation.ok) {
        const operation = operationOf(effective)
        const base = {
          type: 'vfsl-validation-failed' as const,
          recordKind: effective.recordKind,
          // 只带 issuePaths（首 10 条，`$.a.b[0]` 形式）——根级 issue 无路径段，跳过；
          // 不带 message（含值预览，§8.2 禁入）
          issuePaths: validation.issues
            .filter((issue) => issue.path.length > 0)
            .slice(0, 10)
            .map((issue) => formatIssuePath(issue.path)),
          projectedRecordBytes: bytes,
          schemaId: RECORD_SCHEMA_ID,
          schemaFingerprint: compiled.envelopeFingerprint,
        }
        notify(operation === undefined ? base : { ...base, operation })
        countDrop(book, 'vfsl-validation-failed', operationOf(effective))
        return
      }
    }
    // 6：入队（满员 → drop newest；已接纳顺序不变）
    if (queue.length >= capacity) {
      notifyRecordDropped('queue-full', operationOf(effective), bytes)
      countDrop(book, 'queue-full', operationOf(effective))
      return
    }
    queue.push(Object.freeze(effective))
    book.accepted += 1
  }

  /** emitter→adapter 路径（语义 record → 最终 record；§4.1 步骤 1′-6）。 */
  function append(semantic: DiagnosticSemanticRecord): void {
    try {
      if (failed) {
        countDrop(book, 'schema-compile-failed', operationOf(semantic))
        return
      }
      if (exhausted()) {
        countDrop(book, 'sequence-exhausted', operationOf(semantic))
        return
      }
      const record = assemble(semantic)
      gateAndEnqueue(record)
    } catch {
      const operation = operationOf(semantic)
      notify(operation === undefined ? { type: 'pipeline-crashed', stage: 'adapter' } : { type: 'pipeline-crashed', stage: 'adapter', operation })
    }
  }

  /** 直通接缝（testing.injectFinalRecord）：storage projection → VFSL 门 + 入队。 */
  function appendFinal(record: DiagnosticChangeRecord): void {
    try {
      if (failed) {
        countDrop(book, 'schema-compile-failed', operationOf(record))
        return
      }
      if (exhausted()) {
        countDrop(book, 'sequence-exhausted', operationOf(record))
        return
      }
      gateAndEnqueue(record)
    } catch {
      const operation = operationOf(record)
      notify(operation === undefined ? { type: 'pipeline-crashed', stage: 'adapter' } : { type: 'pipeline-crashed', stage: 'adapter', operation })
    }
  }

  const emitterConfig: DiagnosticEmitterConfig = { inputPolicy, issuesPolicy, observer, fallbackLog, randomSource }
  const emitter = createDiagnosticChangeEmitter(emitterConfig, { append })

  const log: BoundedMemoryDiagnosticLog = {
    emitter,
    streamId,
    records(): readonly DiagnosticChangeRecord[] {
      return Object.freeze([...queue])
    },
    stats(): DiagnosticMemoryStats {
      return {
        streamId,
        capacity,
        queueDepth: queue.length,
        accepted: book.accepted,
        droppedTotal: book.droppedTotal,
        droppedByReason: Object.freeze({ ...book.droppedByReason }),
        droppedByOperationReason: Object.freeze({ ...book.droppedByOperationReason }),
        lastSequenceAssigned: lastSequence,
      }
    },
  }
  const internals: MemoryLogInternals = { appendFinal }
  Object.defineProperty(log, INTERNAL, { value: internals, enumerable: false })
  return log
}

/** 预置/注入 envelope 的 schemaId（schema-compile-failed 事件；§8.1——id 缺失/非串回退冻结 id）。 */
function envelopeSchemaId(envelope: unknown): typeof RECORD_SCHEMA_ID {
  if (envelope !== null && typeof envelope === 'object') {
    const id = (envelope as Record<string, unknown>).id
    if (typeof id === 'string') return id as typeof RECORD_SCHEMA_ID
  }
  return RECORD_SCHEMA_ID
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

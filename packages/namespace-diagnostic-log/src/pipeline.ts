/**
 * emitter 管线（设计 §4——语义投影，adapter 无关；#152 复用同一管线、只换 sink）。
 *
 * 数据流（§4.1）：0 顶层 catch → 1 intake 结构校验 → 2 attemptId 缺省 → 3 输入投影 →
 * 4 issues 投影 → 5 enrichment 清洗 → 6 组装语义 record（深冻结）→ 7 sink.append。
 *
 * 失败隔离（§4.2）：任何一步失败都只能走健康事件（observer）——emit 同步、void、
 * 绝不 throw / 阻塞（ADR 0011 §Interface）；违规 emission 丢弃（emission-dropped），
 * 不消耗 adapter sequence（intake 在 sink 之前）。
 */
import { bytesToHex, cryptoRandomBytes } from './digest.js'
import { defaultFallbackLog, makeEventNotifier } from './health.js'
import type { DiagnosticLogHealthEvent } from './health.js'
import type {
  DiagnosticEmitterConfig,
  DiagnosticSemanticRecord,
  NamespaceDiagnosticChangeEmission,
  NamespaceDiagnosticChangeEmitter,
  RandomSource,
  SemanticResult,
} from './emission.js'
import { projectInput } from './projection/input.js'
import { projectIssues } from './projection/issues.js'
import type { InputCapture, IssuesProjection, LogContext } from './record.js'
import { RE_BOUNDED_STR, RE_ISO_MS, RE_STABLE_CODE } from './schema-patterns.js'
import type { Operation, SourceModule } from './vocabulary.js'
import { isLogSource, isOperation, isSourceModule, isStage } from './vocabulary.js'
import type { DiagnosticChangeSink } from './sink.js'

export type { NamespaceDiagnosticChangeEmitter }

/** 深冻结：容器递归冻结；ArrayBuffer view（Uint8Array）不可冻结（V8 必抛
 *  `Cannot freeze array buffer views with elements`）→ 跳过——updateBytes 的隔离
 *  由 intake 复制保证（设计 §2.6 R3：复制是唯一可机器的隔离；语义 record 与最终
 *  record 都消费副本）。 */
export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value as object)) return value
  seen.add(value as object)
  if (ArrayBuffer.isView(value)) return value
  Object.freeze(value)
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key], seen)
  }
  return value
}

/** 稳定地从 emission 中提取 operation（敌意 getter 下也可能抛——调用方兜底）。 */
function safeOperationOf(value: unknown): Operation | undefined {
  try {
    if (value !== null && typeof value === 'object') {
      const candidate = (value as Record<string, unknown>).operation
      if (isOperation(candidate)) return candidate
    }
  } catch {
    return undefined
  }
  return undefined
}

/** intake 结构校验（§4.1 步骤 1 / §4.2 表——词表/形状/observedAt/attemptId/code Pattern）。 */
function intakeValid(emission: NamespaceDiagnosticChangeEmission): boolean {
  const e = emission as unknown as Record<string, unknown>
  if (!isOperation(e.operation)) return false
  if (!isStage(e.stage)) return false
  if (typeof e.observedAt !== 'string' || !RE_ISO_MS.test(e.observedAt)) return false
  if (e.attemptId !== undefined && e.attemptId !== null) {
    if (typeof e.attemptId !== 'string' || !RE_BOUNDED_STR.test(e.attemptId)) return false
  }
  if (e.code !== undefined && e.code !== null) {
    if (typeof e.code !== 'string' || !RE_STABLE_CODE.test(e.code)) return false
  }
  if (e.sourcePhase !== undefined && e.sourcePhase !== null) {
    if (typeof e.sourcePhase !== 'string' || !RE_STABLE_CODE.test(e.sourcePhase)) return false
  }
  if (e.sourceModule !== undefined && e.sourceModule !== null) {
    if (!isSourceModule(e.sourceModule)) return false
  }
  if (!isLogSource(e.source)) return false
  // source 封闭键校验（R5/std C-S3）：local 仅 kind 键；replication 仅
  // kind/direction/remoteInstanceId——多余键 → emission-dropped（producer 结构违规，
  // 不得漏到 VFSL 门误报 writer bug）
  const source = e.source as Record<string, unknown>
  const sourceKeys = Object.keys(source)
  if (source.kind === 'local' && (sourceKeys.length !== 1 || sourceKeys[0] !== 'kind')) return false
  if (source.kind === 'replication') {
    for (const key of sourceKeys) {
      if (key !== 'kind' && key !== 'direction' && key !== 'remoteInstanceId') return false
    }
    // remoteInstanceId：有界无换行（§6.3 结构性——违规丢 emission）
    if (!RE_BOUNDED_STR.test(source.remoteInstanceId as string)) return false
  }
  // input 非对象（primitive/null/数组——含显式 null）→ 结构违规（R5/std C-2：
  // 不得进入 `in` 运算冒泡成 pipeline-crashed 丢整条 record；null 为明确违规形状）
  if (e.input !== undefined) {
    if (e.input === null || typeof e.input !== 'object' || Array.isArray(e.input)) return false
  }
  return resultShapeValid(e.result)
}

/** result 形状校验（§2.6 EmissionResult 严格判别联合的运行期镜像）。 */
function resultShapeValid(result: unknown): boolean {
  if (result === null || typeof result !== 'object') return false
  const r = result as Record<string, unknown>
  switch (r.kind) {
    case 'committed':
      if (r.effect === 'noop') return true
      if (r.effect === 'update') return r.updateBytes instanceof Uint8Array
      if (r.effect === 'update-omitted') {
        return typeof r.reason === 'string' && RE_STABLE_CODE.test(r.reason)
      }
      return false
    case 'rejected':
      return true
    case 'fatal':
      if (r.committed === false) return true
      if (r.committed !== true) return false
      if (r.effect === 'unknown') return true
      if (r.effect === 'update') return r.updateBytes instanceof Uint8Array
      if (r.effect === 'update-omitted') {
        return typeof r.reason === 'string' && RE_STABLE_CODE.test(r.reason)
      }
      return false
    default:
      return false
  }
}

/** 规范化 result（intake 已验证——重建成员屏蔽多余键，物理键永不泄漏进语义 record）。
 *  R3（总控裁决）：updateBytes 在 intake 复制（`slice()` 副本）——producer 在 emit 后
 *  变异原 updateBytes 不影响已接纳 record（复制隔离；`Object.freeze` 对非空 typed
 *  array 在 V8 必抛「Cannot freeze array buffer views with elements」，冻结无法机器
 *  强制不可变异——设计 §2.6 R3 注记）。 */
function canonicalResult(result: unknown): SemanticResult {
  const r = result as Record<string, unknown>
  if (r.kind === 'committed') {
    if (r.effect === 'noop') return { kind: 'committed', effect: 'noop' }
    if (r.effect === 'update') {
      return { kind: 'committed', effect: 'update', updateBytes: (r.updateBytes as Uint8Array).slice() }
    }
    return { kind: 'committed', effect: 'update-omitted', reason: r.reason as string }
  }
  if (r.kind === 'rejected') return { kind: 'rejected' }
  if (r.committed === false) return { kind: 'fatal', committed: false }
  if (r.effect === 'unknown') return { kind: 'fatal', committed: true, effect: 'unknown' }
  if (r.effect === 'update') {
    return { kind: 'fatal', committed: true, effect: 'update', updateBytes: (r.updateBytes as Uint8Array).slice() }
  }
  return { kind: 'fatal', committed: true, effect: 'update-omitted', reason: r.reason as string }
}

/** attemptId 缺省生成（att- + 32 hex；§4.3）。 */
function generateAttemptId(randomSource: RandomSource): string {
  return 'att-' + bytesToHex(randomSource.randomBytes(16))
}

/** 默认 CSPRNG（node:crypto 经 digest.ts——唯一环境绑定面之一）。 */
function defaultRandomSource(): RandomSource {
  return { randomBytes: (n) => cryptoRandomBytes(n) }
}

/** enrichment 清洗：context 字段级违规 → 丢字段 + 事件（§4.2；不丢整条 record）。 */
function cleanContext(
  context: unknown,
  operation: Operation,
  notify: (event: DiagnosticLogHealthEvent) => void,
): LogContext | undefined {
  if (context === undefined || context === null) return undefined
  if (typeof context !== 'object' || Array.isArray(context)) {
    // 非对象 context：整体丢弃（不发明字段名事件——见 sa3_impl 报告）
    return undefined
  }
  const raw = context as Record<string, unknown>
  const out: LogContext = {}
  if (raw.correlationId !== undefined && raw.correlationId !== null) {
    if (typeof raw.correlationId === 'string' && RE_BOUNDED_STR.test(raw.correlationId)) {
      out.correlationId = raw.correlationId
    } else {
      notify({ type: 'enrichment-field-dropped', field: 'context.correlationId', operation })
    }
  }
  if (raw.runtimeGeneration !== undefined && raw.runtimeGeneration !== null) {
    if (typeof raw.runtimeGeneration === 'string' && RE_BOUNDED_STR.test(raw.runtimeGeneration)) {
      out.runtimeGeneration = raw.runtimeGeneration
    } else {
      notify({ type: 'enrichment-field-dropped', field: 'context.runtimeGeneration', operation })
    }
  }
  if (raw.replicationId !== undefined && raw.replicationId !== null) {
    if (typeof raw.replicationId === 'string' && RE_BOUNDED_STR.test(raw.replicationId)) {
      out.replicationId = raw.replicationId
    } else {
      notify({ type: 'enrichment-field-dropped', field: 'context.replicationId', operation })
    }
  }
  if (raw.replicationEpoch !== undefined && raw.replicationEpoch !== null) {
    if (typeof raw.replicationEpoch === 'number' && Number.isFinite(raw.replicationEpoch)) {
      out.replicationEpoch = Object.is(raw.replicationEpoch, -0) ? 0 : raw.replicationEpoch
    } else {
      notify({ type: 'enrichment-field-dropped', field: 'context.replicationEpoch', operation })
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** 组装语义 record（intake 通过后；§4.1 步骤 2-6）。 */
function buildSemanticRecord(
  emission: NamespaceDiagnosticChangeEmission,
  config: DiagnosticEmitterConfig,
  notify: (event: DiagnosticLogHealthEvent) => void,
): DiagnosticSemanticRecord | null {
  const operation = emission.operation

  // —— 步骤 1：intake 结构校验（违规 → 丢弃 + emission-dropped）——
  if (!intakeValid(emission)) {
    notify({ type: 'emission-dropped', reason: 'emission-shape', operation })
    return null
  }

  // —— 步骤 2：attemptId 缺省 ——
  const attemptId = emission.attemptId ?? generateAttemptId(config.randomSource ?? defaultRandomSource())

  // —— 步骤 3：输入投影 ——
  const input: InputCapture = projectInput(emission.input, config.inputPolicy, () => {
    notify({ type: 'input-projection-failed', operation })
  })

  // —— 步骤 4：issues 投影（emission.issues 为裸数组 DiagnosticIssue[]——设计
  // §2.6 R5/std C-S2 形状；管线内部投影为 IssuesProjection）——
  let issues: IssuesProjection | undefined
  if (emission.issues !== undefined && emission.issues !== null) {
    issues = projectIssues(emission.issues, config.issuesPolicy, () => {
      notify({ type: 'enrichment-field-dropped', field: 'issues', operation })
    })
  }

  // —— 步骤 5：enrichment 清洗 ——
  const context = cleanContext(emission.context, operation, notify)
  // code↔sourceModule 成对性（§10-J3）：单侧缺失 → 丢弃单侧字段 + 事件（SA6 §3.5）
  const hasCode = emission.code !== undefined && emission.code !== null
  const hasSourceModule = emission.sourceModule !== undefined && emission.sourceModule !== null
  let code: string | undefined
  let sourceModule: SourceModule | undefined
  if (hasCode && hasSourceModule) {
    code = emission.code
    sourceModule = emission.sourceModule
  } else if (hasCode) {
    notify({ type: 'enrichment-field-dropped', field: 'code', operation })
  } else if (hasSourceModule) {
    notify({ type: 'enrichment-field-dropped', field: 'sourceModule', operation })
  }
  const sourcePhase = emission.sourcePhase
  let durationMs: number | undefined
  if (emission.durationMs !== undefined && emission.durationMs !== null) {
    if (typeof emission.durationMs === 'number' && Number.isFinite(emission.durationMs)) {
      durationMs = emission.durationMs
    } else {
      notify({ type: 'enrichment-field-dropped', field: 'durationMs', operation })
    }
  }

  // —— 步骤 6：组装（结果重建自规范化成员，物理键不泄漏）——
  const semantic: DiagnosticSemanticRecord = {
    attemptId,
    operation,
    stage: emission.stage,
    observedAt: emission.observedAt,
    source: emission.source,
    result: canonicalResult(emission.result),
    input,
  }
  if (context !== undefined) semantic.context = context
  if (durationMs !== undefined) semantic.durationMs = durationMs
  if (code !== undefined) semantic.code = code
  if (sourcePhase !== undefined) semantic.sourcePhase = sourcePhase
  if (sourceModule !== undefined) semantic.sourceModule = sourceModule
  if (issues !== undefined) semantic.issues = issues
  return semantic
}

/** 可复用 emitter 管线工厂（设计 §1.3/§4；#152 attempt 记录路径复用同一管线、只换 sink）。 */
export function createDiagnosticChangeEmitter(
  config: DiagnosticEmitterConfig,
  sink: DiagnosticChangeSink,
): NamespaceDiagnosticChangeEmitter {
  const notify = makeEventNotifier(config.observer, config.fallbackLog ?? defaultFallbackLog)
  return {
    emit(emission: NamespaceDiagnosticChangeEmission): void {
      let semantic: DiagnosticSemanticRecord | null = null
      try {
        semantic = buildSemanticRecord(emission, config, notify)
        if (semantic === null) return
        // 深冻结语义 record（步骤 6；所有权契约——producer 后变异 → strict TypeError）
        deepFreeze(semantic)
      } catch {
        notify({
          type: 'pipeline-crashed',
          stage: 'emitter',
          ...(safeOperationOf(emission) !== undefined ? { operation: safeOperationOf(emission) as Operation } : {}),
        })
        return
      }
      try {
        sink.append(semantic)
      } catch {
        notify({ type: 'pipeline-crashed', stage: 'adapter', ...(semantic !== null ? { operation: semantic.operation } : {}) })
      }
    },
  }
}

export type { DiagnosticSemanticRecord, InputCapture, IssuesProjection }

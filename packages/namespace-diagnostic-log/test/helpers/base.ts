/**
 * SA6 共享契约夹具（非测试文件，vitest 不以 `*.test.ts` 匹配）。
 *
 * 作用：为 packages/namespace-diagnostic-log/test/** 提供
 * - 基础 emission 构造器（fresh 对象，可被覆盖成合法/违规任意形状）；
 * - 装配型日志构造器 + 事件收集；
 * - 内建 schema 编译产物的取用（失败即抛——内建 schema 必须可编译，这是 §3/§9.6 前提）；
 * - 事件/record 窄化守卫（R4/C-1、R4/C-2：health 事件按 §8.1 判别联合与 records()
 *   按 §2.4 两族联合访问前先断属）。
 *
 * 契约锚点：设计 §2.6（EmissionInput/EmissionResult/DiagnosticSemanticRecord）、
 * §7.1（装配语义）、§8.1（健康事件）、§12（testing 子路径）。
 */
import { expect } from 'vitest'
import { createBoundedMemoryDiagnosticLog, getRecordSchemaCompilation } from '../../src/index.js'
import type {
  AttemptRecord,
  DiagnosticChangeRecord,
  DiagnosticLogConfig,
  DiagnosticLogHealthEvent,
  DiagnosticLogHealthObserver,
  NamespaceDiagnosticChangeEmission,
} from '../../src/index.js'
import { createEventCollectingObserver } from '../../src/testing.js'

/** 合法 observedAt（满足 P_ISO_MS `^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$`）。 */
export const OBSERVED_AT = '2026-08-28T12:00:00.000Z'

/**
 * 冻结信封指纹（设计 §3.4 冻结身份键；§9.8 契约测试钉死常量）：
 * sha256:v1:dedad2ab93d9df9224960ca094924168f8bcc1c0512dfdd0a03dc6e66613e070
 * 已用 compileSchemaEnvelope 对 §3.3 文本（含尾随 \n）实测确认。
 */
export const FROZEN_ENVELOPE_FINGERPRINT =
  'sha256:v1:dedad2ab93d9df9224960ca094924168f8bcc1c0512dfdd0a03dc6e66613e070'

/** 全 6 operation 词表（§2.1 / §9.1 矩阵抽样用）。 */
export const ALL_OPERATIONS = [
  'namespace-create',
  'root-mutation',
  'schema-replacement',
  'replication-apply',
  'replication-enable',
  'replication-epoch-bump',
] as const

/** 合法 attemptId（满足 AttemptId Pattern，`att-` + 32 hex 子集）。 */
export const BASE_ATTEMPT_ID = 'att-11111111111111111111111111111111'

/**
 * 构造一条 fresh 的语义 emission（默认 root-mutation / transaction / local /
 * committed+noop / 无 input、无 issues、提供 attemptId）。
 * overrides 以 Record<string, unknown> 形式合入——允许覆盖为
 * 「TS 类型合法但运行期违规」形状（模拟 JS 侧 producer 从操作）。
 */
export function baseEmission(overrides: Record<string, unknown> = {}): NamespaceDiagnosticChangeEmission {
  const emission: NamespaceDiagnosticChangeEmission = {
    operation: 'root-mutation',
    stage: 'transaction',
    observedAt: OBSERVED_AT,
    attemptId: BASE_ATTEMPT_ID,
    source: { kind: 'local' },
    result: { kind: 'committed', effect: 'noop' },
  }
  Object.assign(emission, overrides)
  return emission
}

export interface AssembledLog {
  log: ReturnType<typeof createBoundedMemoryDiagnosticLog>
  events: DiagnosticLogHealthEvent[]
  observer: DiagnosticLogHealthObserver & { events: DiagnosticLogHealthEvent[] }
}

/** 装配有界内存日志 + 事件收集 observer；config 合入（observer 由本 helper 注入）。 */
export function makeLog(config: Partial<DiagnosticLogConfig> = {}): AssembledLog {
  const observer = createEventCollectingObserver()
  const log = createBoundedMemoryDiagnosticLog({ observer, ...config })
  return { log, events: observer.events, observer }
}

/** 内建 schema 编译产物（ok 分支）；编译失败即抛——SA3 若让内建 schema 编译失败属 writer bug（§3/§4.1 步骤 0′）。 */
export function mustCompile() {
  const compiled = getRecordSchemaCompilation()
  if (!compiled.ok) {
    throw new Error(`built-in schema must compile: ${JSON.stringify(compiled.issues).slice(0, 500)}`)
  }
  return compiled
}

/**
 * R4/C-1：健康事件按 §8.1 判别联合窄化（filter 不窄化联合——访问成员字段前经此守卫）。
 * 注意：record-dropped / vfsl-validation-failed 的 operation 在 R4 后为可选，
 * 访问处按需断言值或 undefined。
 */
export function eventsOfType<T extends DiagnosticLogHealthEvent['type']>(
  events: readonly DiagnosticLogHealthEvent[],
  type: T,
): Extract<DiagnosticLogHealthEvent, { type: T }>[] {
  return events.filter((e): e is Extract<DiagnosticLogHealthEvent, { type: T }> => e.type === type)
}

/**
 * R4/C-2：records() 元素窄化为 attempt 族（访问 .result/.operation 等 attempt 字段前先断属）。
 * 非 attempt（genesis-baseline）访问 attempt 字段 = 测试断言缺陷，loud 失败。
 */
export function assertAttempt(record: DiagnosticChangeRecord): AttemptRecord {
  expect(record.recordKind, 'records() 元素必须为 attempt 族后才能访问 attempt 字段（R4/C-2）').toBe('attempt')
  return record as AttemptRecord
}

/** R4/C-2：批量窄化（filter + 类型谓词）；保留接纳序。 */
export function attemptRecords(records: readonly DiagnosticChangeRecord[]): AttemptRecord[] {
  return records.filter((r): r is AttemptRecord => r.recordKind === 'attempt')
}

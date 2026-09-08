/**
 * 语义 emission 面（设计 §2.6——producer → emitter 接缝）。
 *
 * 所有权契约（ADR 0011 §Interface）：emit 的 interface 语义是立即接收一份由调用方
 * 持有权已转移或已复制的 detached record，不得阻塞、throw、返回 durability promise，
 * 亦不得保留调用方可变引用。实现（R3 总控裁决）：plain-data snapshot 所有权移交 +
 * 管线深冻结（敌意后变异 loud TypeError）；updateBytes 为 intake 复制（slice 副本，
 * 复制隔离——producer emit 后变异不影响已接纳 record；冻结对 typed array 不可机器
 * 强制，设计 §2.6 R3 注记）。
 */
import type { DiagnosticIssue, InputCapture, IssuesProjection, LogContext, LogSource, Operation, SourceModule, Stage } from './record.js'
import type { DiagnosticLogHealthObserver } from './health.js'

/** producer 提交的 detached 语义结局（update 以 owned bytes 表达——不出现物理键）。 */
export type EmissionResult =
  | { kind: 'committed'; effect: 'noop' }
  | { kind: 'committed'; effect: 'update'; updateBytes: Uint8Array }
  | { kind: 'committed'; effect: 'update-omitted'; reason: string }
  | { kind: 'rejected' }
  | { kind: 'fatal'; committed: false }
  | { kind: 'fatal'; committed: true; effect: 'unknown' }
  | { kind: 'fatal'; committed: true; effect: 'update'; updateBytes: Uint8Array }
  | { kind: 'fatal'; committed: true; effect: 'update-omitted'; reason: string }

/** 输入捕获输入（设计 §2.6：省略 input 字段 ⇔ 无可捕获输入，按 none 处理）。 */
export type EmissionInput =
  | { status: 'not-accessed' }
  | { status: 'unavailable' }
  | { status: 'unsafe-input' }
  | { snapshot: unknown }

/** producer → emitter 的语义 emission（设计 §2.6）。 */
export interface NamespaceDiagnosticChangeEmission {
  operation: Operation
  stage: Stage
  /** producer 用注入 Clock 生成（observedAtFrom helper；结构兼容 Clock.now）。 */
  observedAt: string
  durationMs?: number
  /** 缺失时由 writer 用 128-bit CSPRNG 生成 att-+32hex。 */
  attemptId?: string
  source: LogSource
  context?: LogContext
  code?: string
  sourcePhase?: string
  sourceModule?: SourceModule
  /** issues 原始输入：裸数组 DiagnosticIssue[]（设计 §2.6 形状；预算在管线内施加，
   *  管线内部投影为 IssuesProjection——R5/std C-S2）。 */
  issues?: DiagnosticIssue[]
  input?: EmissionInput
  result: EmissionResult
}

/** 语义镜像 of AttemptResult——update 以 owned bytes 表达（emitter 管线输出用）。 */
export type SemanticResult = EmissionResult

/** emitter 管线输出（语义投影已完成，物理投影未开始）——sink 消费（设计 §2.6）。 */
export interface DiagnosticSemanticRecord {
  attemptId: string
  operation: Operation
  stage: Stage
  observedAt: string
  durationMs?: number
  source: LogSource
  context?: LogContext
  code?: string
  sourcePhase?: string
  sourceModule?: SourceModule
  issues?: IssuesProjection
  input: InputCapture
  result: SemanticResult
}

/** emitter 接缝接口（ADR 0011 §Interface 小接口：同步、void、不 throw、不阻塞）。 */
export interface NamespaceDiagnosticChangeEmitter {
  emit(emission: NamespaceDiagnosticChangeEmission): void
}

/** 语义投影配置（emitter；设计 §1.3/§1.4：inputPolicy/issuesPolicy 归 emitter）。 */
export interface DiagnosticEmitterConfig {
  inputPolicy: 'none' | 'digest' | 'redacted' | 'full'
  issuesPolicy: 'none' | 'full' | 'redacted'
  /** 健康观察者（可选；故障隔离见 health.ts §8.3）。 */
  observer?: DiagnosticLogHealthObserver | undefined
  /** observer 故障 fallback logger（默认 console.error；§8.3 可注入）。 */
  fallbackLog?: ((line: string) => void) | undefined
  /** 随机源注入接缝（仅 attemptId 用途；生产默认 CSPRNG）。 */
  randomSource?: RandomSource | undefined
}

/**
 * 随机源注入接缝（设计 §4.4）：仅两个用途——streamId（16B）与 attemptId（16B）。
 * 生产默认 node:crypto CSPRNG；注入接缝仅测试可用性服务。
 */
export interface RandomSource {
  /** n 字节密码学随机（生产默认 node:crypto randomBytes；测试注入确定性序列）。 */
  randomBytes(n: number): Uint8Array
}

/**
 * producer 侧 observedAt helper（结构兼容 Clock.now 的注入 Clock；设计 §4.4）：
 * `new Date(now()).toISOString()` 恒为 `YYYY-MM-DDTHH:MM:SS.sssZ`（与 P_ISO_MS
 * 精确匹配）；epoch 超出 ISO 表示域时 throw——producer 侧 bug，发生在 emit 之前，
 * 不违反 emit 不抛错契约。
 */
export function observedAtFrom(now: () => number): string {
  return new Date(now()).toISOString()
}

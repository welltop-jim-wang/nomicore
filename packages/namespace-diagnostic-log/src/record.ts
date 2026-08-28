/**
 * v1 存储 record 契约类型（设计 §2.4/§2.5——冻结 schema `RECORD_SCHEMA_TEXT` 的
 * TS 孪生；schema.ts 为本包唯一 schema 文本源，本模块与 schema 单源纪律见
 * schema-patterns.ts 头注）。
 *
 * AttemptResult 的 TS 侧用字面量 `false`/`true` 在编译期锁死「committed 事实 ↔
 * effect 存在」的相关性（设计 §2.1/§10-J2 三重强制之一；VFSL v1 无布尔字面量，
 * schema 侧以 `committed: boolean` 放松——不会拒绝合法 record）。
 */
import type { LogContext, LogSource, Operation, SourceModule, Stage } from './vocabulary.js'

export type { LogContext, LogSource, Operation, SourceModule, Stage } from './vocabulary.js'

/** stream 身份半段：log- + 32 位小写 hex（ADR 0012 §Stream 与 generation）。 */
export type StreamId = string

/** record 身份的顺序半段：无前导零十进制字符串，uint64 值域（ADR 0012 §JSONL record）。 */
export type Sequence = string

/** 变更尝试关联 ID：producer 受控关联 ID 或 att- + 32 hex（有界、无换行）。 */
export type AttemptId = string

/** producer 侧完成时刻：UTC ISO 8601、毫秒精度、Z 后缀。 */
export type ObservedAt = string

/** 稳定诊断码（顶层 code/sourcePhase 与 update-omitted reason 共用）。 */
export type StableCode = string

/** CRC-32C 8 位小写 hex。 */
export type Crc32cHex = string

/** RFC 4648 标准 Base64（含 padding、无空白换行）。 */
export type Base64 = string

/** sidecar 所在 segment 名（固定 8 位十进制）。 */
export type SegmentName = string

/** sidecar frame 起点（十进制无前导零字符串；首 frame 偏移可为 0）。 */
export type FrameOffset = string

/** issues 统一投影单条（ADR 0012 §投影 逐字形状）。 */
export interface DiagnosticIssue {
  /** 所属模块稳定码；ADR TS 快照即 plain string（预算由投影施加，§10-J8）。 */
  code?: string
  /** ≤4 KiB UTF-8，超限确定性截断且不拆分 code point（§6.1）。 */
  message: string
  /** ≤256 段；string 段 ≤1 KiB（截断+标记）；number 段为有限数（-0 已归一 0）。 */
  path: Array<string | number>
}

/** issues 投影容器（policy 标明投影策略，防误认脱敏内容为原始 issue，ADR 0011 §数据保护）。 */
export interface IssuesProjection {
  policy: 'none' | 'full' | 'redacted'
  items: DiagnosticIssue[]
  /** presence ⇔ 发生过预算截断（§6.2）。 */
  truncated?: boolean
  /** 截断前的有效条数（presence 语义）。 */
  originalCount?: number
}

/** 输入捕获：四策略 × 可得性的七值封闭（设计 §2.2/§5.1）。 */
export type InputCapture =
  | { capture: 'none' }
  | { capture: 'not-accessed' }
  | { capture: 'unavailable' }
  | { capture: 'unsafe-input' }
  | { capture: 'digest'; digest: string; degraded?: 'projected-input-too-large' }
  | { capture: 'full'; value: unknown; digest: string }
  | { capture: 'redacted'; value: unknown; digest: string }

/** update 物理载体（两种 storage 形状，一次冻结服务 #152；设计 §2.5）。 */
export type UpdateCarrier =
  | {
      storage: 'inline'
      format: 'yjs-update-v1'
      payloadLength: number
      crc32c: string
      base64: string
    }
  | {
      storage: 'sidecar'
      format: 'yjs-update-v1'
      segment: string
      frameOffset: string
      payloadLength: number
      crc32c: string
    }

/** 结局严格判别联合（ADR 0012 §JSONL record 六形状展开为 8 个具体成员；设计 §2.1）。 */
export type AttemptResult =
  | { kind: 'committed'; effect: 'noop' }
  | { kind: 'committed'; effect: 'update'; update: UpdateCarrier }
  | { kind: 'committed'; effect: 'update-omitted'; reason: string }
  | { kind: 'rejected' }
  | { kind: 'fatal'; committed: false }
  | { kind: 'fatal'; committed: true; effect: 'unknown' }
  | { kind: 'fatal'; committed: true; effect: 'update'; update: UpdateCarrier }
  | { kind: 'fatal'; committed: true; effect: 'update-omitted'; reason: string }

/** 最终 attempt record（设计 §2.4）。 */
export interface AttemptRecord {
  recordKind: 'attempt'
  streamId: string
  sequence: string
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
  result: AttemptResult
}

/** 新 stream 的 genesis 基线 record（设计 §2.4/§11-G2 裁决——非变更尝试）。 */
export interface GenesisBaselineRecord {
  recordKind: 'genesis-baseline'
  streamId: string
  sequence: string
  observedAt: string
  source: LogSource
  context?: LogContext
  update: UpdateCarrier
}

/** 两族 record 封闭联合（schema ROOT 的 TS 孪生）。 */
export type DiagnosticChangeRecord = AttemptRecord | GenesisBaselineRecord

/** update-omitted 稳定 reason 受控词表（v1 三值；设计 §2.1/R2/A-c2）。 */
export const UPDATE_OMITTED_REASONS: ReadonlySet<string> = new Set([
  'payload-too-large',
  'update-capture-disabled',
  'empty-update',
])

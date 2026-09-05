/**
 * @nomicore/namespace-diagnostic-log 公共面（设计 §1.3——issue #148 冻结）。
 *
 * 模块定位（§1.1）：叶子 observability 模块——namespace 诊断变更日志 v1 的语义
 * emission 接缝、冻结 VFSL record schema 与有界内存 adapter；不是 Persistence
 * 真相源（ADR 0011「一个日志 adapter 不构成新的 Persistence 真相源」）。
 *
 * 依赖方向（§1.2）：仅依赖 @nomicore/vfsl（compileSchemaEnvelope /
 * validateLogicalSnapshot）+ node:crypto/Buffer（唯一环境绑定面：digest.ts /
 * carrier.ts，AGENTS.md 声明）。
 */
// —— 冻结词表与 record 契约类型（§2）——
export type {
  AttemptId,
  AttemptRecord,
  AttemptResult,
  Base64,
  Crc32cHex,
  DiagnosticChangeRecord,
  DiagnosticIssue,
  FrameOffset,
  GenesisBaselineRecord,
  InputCapture,
  IssuesProjection,
  LogContext,
  LogSource,
  ObservedAt,
  Operation,
  Sequence,
  SegmentName,
  SourceModule,
  StableCode,
  Stage,
  StreamId,
  UpdateCarrier,
} from './record.js'

// —— 语义 emission 与 emitter 接缝（ADR 0011 §Interface 命名）——
export type {
  DiagnosticEmitterConfig,
  DiagnosticSemanticRecord,
  EmissionInput,
  EmissionResult,
  NamespaceDiagnosticChangeEmission,
  NamespaceDiagnosticChangeEmitter,
  RandomSource,
} from './emission.js'
export { observedAtFrom } from './emission.js'
export { createDiagnosticChangeEmitter } from './pipeline.js'

// —— adapter 接缝（storage projection 归 adapter，ADR 0012 §VFSL record schema）——
export type { DiagnosticChangeSink } from './sink.js'

// —— 本票交付物：有界内存 adapter（emitter + sink 一体装配）——
export {
  createMemoryLog as createBoundedMemoryDiagnosticLog,
  type BoundedMemoryDiagnosticLog,
  type DiagnosticLogConfig,
  type DiagnosticMemoryStats,
} from './adapters/memory.js'

// —— 冻结 schema 资产（§3）——
export { RECORD_SCHEMA_ENVELOPE, RECORD_SCHEMA_ID, getRecordSchemaCompilation } from './schema.js'
export type { RecordSchemaCompilationResult } from './schema.js'

// —— 健康 observability（§8）——
export type { DiagnosticLogHealthEvent, DiagnosticLogHealthObserver } from './health.js'

// —— File adapter（issue #152；§1.2 公共导出增量——既有导出一字不动）——
export {
  createFileDiagnosticLog,
  type FileDiagnosticLog,
  type FileDiagnosticLogConfig,
} from './adapters/file.js'
export {
  readStreamStrict,
  materializeStrictRecordUpdate,
  type StrictRecordUpdate,
  type StrictStreamRead,
  type StrictReadStatus,
  type StrictReadIssue,
  type StrictRecordRead,
  type StrictReadRequest,
} from './reader.js'
// —— #155 增量（m3/D10 单源纪律）：路径安全文法原语 re-export（paths.ts 既有导出
//    原样转发，零新实现）——replay 工具 locator 前置门与 writer/reader 同源，零双源 ——
export { isSafeNamespaceId, isSafeStreamId } from './paths.js'

// —— #154 增量（保留/租约/删除；全部为增量导出——既有导出一字不动）——
export type { FileRetentionConfig, RetentionSweepReport } from './retention.js'
export {
  openDiagnosticReadSession,
  type DiagnosticReadSession,
  type DiagnosticReadSessionRequest,
} from './read-session.js'
export {
  deleteNamespaceDiagnosticLog,
  type NamespaceLogDeletionRequest,
  type NamespaceLogDeletionResult,
} from './adapters/file.js'

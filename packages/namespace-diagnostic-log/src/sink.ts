/**
 * sink 接缝（设计 §1.3/§4.1——adapter 实现 DiagnosticChangeSink；#152 文件 adapter
 * 复用 emitter 管线、只换 sink）。
 */
import type { DiagnosticSemanticRecord } from './emission.js'

/** adapter 接缝（storage projection 归 adapter，ADR 0012 §VFSL record schema）。 */
export interface DiagnosticChangeSink {
  append(record: DiagnosticSemanticRecord): void
}

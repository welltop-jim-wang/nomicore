/**
 * 健康 observability 接缝（设计 §8）。
 *
 * 事件词表（§8.1）与低基数字段白名单（§8.2）冻结；observer 故障隔离（§8.3）：
 * 同步、可能 throw——必须被 safeNotify 隔离，单行稳定码 fallback（默认
 * console.error，可注入），事件不重放、不排队、不重入；fallbackLog 自身 throw
 * 视为部署错误，再包一层空 catch（最后防线，静默——此处无更外层通道）。
 */
import type { Operation } from './vocabulary.js'
import type { RECORD_SCHEMA_ID } from './schema.js'

/** observer 接口（同步；可能 throw——必须经 safeNotify 调用）。 */
export interface DiagnosticLogHealthObserver {
  onEvent(event: DiagnosticLogHealthEvent): void
}

/** 健康事件词表（v1 冻结；设计 §8.1——#148 的 8 成员 + #152 追加 4 成员（只增不改），
 *  type 判别；record-dropped.reason 仅两值）。record-dropped 与 vfsl-validation-failed
 *  两成员的 operation 为 `operation?: Operation`（R4/C-5 已注：genesis-baseline 无
 *  operation 属形状事实——直通接缝注入的 genesis 校验失败事件无该键）；其余成员携带
 *  operation: Operation（emission 路径由 intake 保证词表内值）。 */
export type DiagnosticLogHealthEvent =
  | { type: 'emission-dropped'; reason: 'emission-shape'; operation?: Operation }
  | { type: 'pipeline-crashed'; stage: 'emitter' | 'adapter'; operation?: Operation }
  | { type: 'input-projection-failed'; operation: Operation }
  | {
      type: 'enrichment-field-dropped'
      field:
        | 'context.correlationId'
        | 'context.runtimeGeneration'
        | 'context.replicationId'
        | 'context.replicationEpoch'
        | 'code'
        | 'sourcePhase'
        | 'sourceModule'
        | 'durationMs'
        | 'issues'
      operation: Operation
    }
  | { type: 'input-degraded'; operation: Operation; fromPolicy: 'full' | 'redacted' }
  | {
      type: 'record-dropped'
      reason: 'line-budget-exceeded' | 'queue-full'
      operation?: Operation
      projectedRecordBytes: number
      queueDepth: number
    }
  | {
      type: 'vfsl-validation-failed'
      recordKind: 'attempt' | 'genesis-baseline'
      operation?: Operation
      issuePaths: string[]
      projectedRecordBytes: number
      schemaId: typeof RECORD_SCHEMA_ID
      schemaFingerprint: string
    }
  | { type: 'schema-compile-failed'; schemaId: typeof RECORD_SCHEMA_ID; issueCount: number }
  | {
      type: 'stream-init-failed'
      code: 'LOG_STREAM_INIT_FAILED'
      reason: 'invalid-namespace-id' | 'invalid-stream-id' | 'manifest-mismatch' | 'manifest-missing'
    }
  | {
      type: 'storage-validation-failed'
      recordKind: 'attempt' | 'genesis-baseline'
      operation?: Operation
      /** code ∈ { base64-invalid | base64-length-mismatch | crc-mismatch | stream-mismatch
       *  | frame-missing | vfsl-invalid }
       *  （前四值 SA6 锚定；frame-missing 总控 G3 裁决扩值（复用 reader 词表既有稳定码）——
       *  注入 sidecar 引用帧缺失的 loud 拒绝；vfsl-invalid 为 R 修复轮（SA4 R1 R-2）第 6 值——
       *  P_DECIMAL 字面镜像违规（注入 sequence/frameOffset 前导零/空串/非十进制）的 loud 拒绝，
       *  同 G3「复用 reader issue 词表既有稳定码」原则，零新码）。 */
      code: string
    }
  | {
      type: 'storage-write-failed'
      stage: 'bin' | 'jsonl' | 'manifest' | 'current'
      operation?: Operation
      /** code = 稳定 errno 码（'EISDIR'/'ENOSPC'/'EEXIST'…），不含底层 message。 */
      code: string
    }
  | { type: 'stream-exhausted' }

/** 事件对象深冻结（设计 §8.2；事件构造后冻结，防 observer 侧变异）。 */
export function freezeEvent(event: DiagnosticLogHealthEvent): DiagnosticLogHealthEvent {
  const frozen = Object.freeze(
    Object.fromEntries(
      Object.entries(event).map(([k, v]) => [k, Array.isArray(v) ? Object.freeze([...v]) : v]),
    ),
  ) as DiagnosticLogHealthEvent
  return frozen
}

/** observer 故障 fallback 稳定码前缀（设计 §8.3 原文）。 */
export const OBSERVER_FALLBACK_PREFIX = 'DIAGNOSTIC_LOG_OBSERVER_FAILED'

/** 默认 fallback logger（低基数单行；console.error）。 */
export function defaultFallbackLog(line: string): void {
  // eslint-disable-next-line no-console
  console.error(line)
}

/**
 * observer 故障隔离（设计 §8.3）：
 * - observer.onEvent throw → 单行稳定码 fallback（不重入 observer、不 throw、不计数）；
 * - fallbackLog 自身 throw → 最后防线，静默收编（此处无更外层通道）。
 */
export function safeNotify(
  observer: DiagnosticLogHealthObserver | undefined,
  event: DiagnosticLogHealthEvent,
  fallbackLog: (line: string) => void,
): void {
  if (observer === undefined) return
  try {
    observer.onEvent(event)
  } catch (err) {
    try {
      fallbackLog(`${OBSERVER_FALLBACK_PREFIX} observer_threw=${typeof err}`)
    } catch {
      // 最后防线：fallbackLog 抛错视为部署错误——静默（无更外层通道，注释即设计）
    }
  }
}

/** 健康事件通知（构造后冻结 + safeNotify；设计 §8）。
 *  参数为判别联合 typed 字面量——构造点编译期检查恢复（R5/std C-1：不得以 Record
 *  中间体绕过成员形状；每个构造点直接构造对应成员）。 */
export function makeEventNotifier(
  observer: DiagnosticLogHealthObserver | undefined,
  fallbackLog: (line: string) => void,
): (event: DiagnosticLogHealthEvent) => void {
  return (event: DiagnosticLogHealthEvent): void => {
    safeNotify(observer, freezeEvent(event), fallbackLog)
  }
}

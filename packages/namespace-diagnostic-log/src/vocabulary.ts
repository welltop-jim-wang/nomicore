/**
 * v1 冻结语义词表（issue #148 冻结；设计 §2.1——schema 与 TS 单源纪律见 schema-patterns.ts）。
 *
 * operation（6 值封闭，ADR 0012 §JSONL record 逐字）、stage（8 值封闭，ADR 0011
 * §变更尝试与结局 逐字；v1 不折叠、不新增）、sourceModule（4 值封闭，ADR 0012）、
 * LogSource / LogContext（ADR 0012 逐字形状）。
 *
 * 词表「封闭」语义：词表外值在 emitter intake 直接丢弃 emission（§4.2 表），
 * 不在 record 中留 any 逃生口。
 */

/** v1 封闭 operation 词表（ADR 0012 §JSONL record 逐字；新增 operation 需新 schema 版本与新 stream generation）。 */
export type Operation =
  | 'namespace-create'
  | 'root-mutation'
  | 'schema-replacement'
  | 'replication-apply'
  | 'replication-enable'
  | 'replication-epoch-bump'

/** 结局所属阶段的封闭枚举（ADR 0011 §变更尝试与结局 8 值逐字；不折叠为统一 failed）。 */
export type Stage =
  | 'acceptance'
  | 'capability-gate'
  | 'input-snapshot'
  | 'schema-compile'
  | 'validation'
  | 'identity'
  | 'transaction'
  | 'dirty-notification'

/** 稳定 code 的来源模块封闭枚举（ADR 0012：Registry、Runtime、Persistence 与 replication）。 */
export type SourceModule = 'registry' | 'runtime' | 'persistence' | 'replication'

/** 变更来源：本地写路径或可信复制路径（ADR 0012 §JSONL record 逐字形状）。 */
export type LogSource =
  | { kind: 'local' }
  | { kind: 'replication'; direction: 'hub-to-peer' | 'peer-to-hub'; remoteInstanceId: string }

/** 受控关联上下文（ADR 0012 逐字形状）：全可选，缺失即未提供。 */
export interface LogContext {
  correlationId?: string
  runtimeGeneration?: string
  replicationId?: string
  replicationEpoch?: number
}

/** 运行期词表（intake 结构校验用；与类型同源冻结）。 */
export const OPERATIONS: ReadonlySet<string> = new Set([
  'namespace-create',
  'root-mutation',
  'schema-replacement',
  'replication-apply',
  'replication-enable',
  'replication-epoch-bump',
])

export const STAGES: ReadonlySet<string> = new Set([
  'acceptance',
  'capability-gate',
  'input-snapshot',
  'schema-compile',
  'validation',
  'identity',
  'transaction',
  'dirty-notification',
])

export const SOURCE_MODULES: ReadonlySet<string> = new Set(['registry', 'runtime', 'persistence', 'replication'])

export const REPLICATION_DIRECTIONS: ReadonlySet<string> = new Set(['hub-to-peer', 'peer-to-hub'])

/** 运行期词表类型守卫。 */
export function isOperation(value: unknown): value is Operation {
  return typeof value === 'string' && OPERATIONS.has(value)
}

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && STAGES.has(value)
}

export function isSourceModule(value: unknown): value is SourceModule {
  return typeof value === 'string' && SOURCE_MODULES.has(value)
}

export function isLogSource(value: unknown): value is LogSource {
  if (value === null || typeof value !== 'object') return false
  const source = value as Record<string, unknown>
  if (source.kind === 'local') return true
  if (source.kind === 'replication') {
    return (
      typeof source.direction === 'string' &&
      REPLICATION_DIRECTIONS.has(source.direction) &&
      typeof source.remoteInstanceId === 'string'
    )
  }
  return false
}

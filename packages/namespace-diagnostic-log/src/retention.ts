/**
 * retention 配置与报告（issue #154 纯策略层——零 fs、零环境绑定，AGENTS.md 绑定面
 * 之内：`node:fs` 仅 file.ts/reader.ts；本模块为纯 TS）。
 *
 * 契约：ADR 0012 §Retention 与删除 + SA2 设计 §2.1/§2.2（null/0/缺省语义表、
 * 值域 loud 门、配置零持久化）。所有「无法定龄/统计失败」的保守决策在此表达为
 * 类型化返回——IO 收敛在 file.ts 的 sweep 路径内。
 */

/** retention 配置（纯类型；不冻结进 manifest——ADR「manifest 不承担频繁变化的 retention 状态」）。 */
export interface FileRetentionConfig {
  /**
   * 年龄上限（毫秒）。缺省 = 30 天（ADR 0012 默认）。
   * - undefined        → 默认 2_592_000_000（30d）
   * - null（显式）     → 关闭年龄限制（ADR 0012「显式 null 关闭某个限制」）
   * - 0                → 一切闭组立即过期（「0 不表示无限」）
   * - n > 0            → group 内最晚 committed record 的 observedAt 距 now ≥ n 时过期
   */
  maxAgeMs?: number | null | undefined
  /**
   * 每 namespace 字节上限（JSONL+BIN 之和，跨全部 stream generation）。
   * 缺省 = 1 GiB。null → 关闭字节限制；0 → 裁掉全部可删闭组（开组永不计删）。
   */
  maxBytesPerNamespace?: number | null | undefined
  /** 构造完成后自动执行一次 sweep；默认 true（ADR「File adapter 内置可配置 retention」）。 */
  sweepOnOpen?: boolean | undefined
}

/** ADR 0012 默认年龄上限：30 天（毫秒）。 */
export const DEFAULT_RETENTION_MAX_AGE_MS = 2_592_000_000

/** ADR 0012 默认每 namespace 字节上限：1 GiB。 */
export const DEFAULT_RETENTION_MAX_BYTES = 1024 * 1024 * 1024

/** 规范化后的 retention 配置（校验通过后；null = 该限制关闭）。 */
export interface NormalizedRetentionConfig {
  /** null = 年龄遍历整体跳过；数字 = 闭组年龄 ≥ 该值（ms）即过期（含等号）。 */
  maxAgeMs: number | null
  /** null = 字节遍历整体跳过；数字 = namespace 字节预算（≤ 0 表示「压到最小值」）。 */
  maxBytesPerNamespace: number | null
  sweepOnOpen: boolean
}

/** 配置校验结果：违规 → 仅 retention 失活 + 恰一次 `retention-config-invalid{field}`。 */
export type RetentionConfigValidation =
  | { ok: true; config: NormalizedRetentionConfig }
  | { ok: false; field: 'maxAgeMs' | 'maxBytesPerNamespace' }

/** 单限制值域：safe integer ∧ ≥ 0；否则 'invalid'（loud 门——绝不静默钳制）。 */
function validateLimit(value: unknown, dflt: number): number | null | 'invalid' {
  if (value === undefined) return dflt
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return 'invalid'
  return value
}

/**
 * retention 配置校验与缺省展开（SA2 §2.1 语义表逐项；违规任一限制 → 失活）。
 * 注意：违规时**不**按「各自独立关闭」降级部分——失活 = 两限制皆 null（保留卫生遍历）。
 */
export function normalizeRetentionConfig(input: FileRetentionConfig | null | undefined): RetentionConfigValidation {
  if (input === null || input === undefined) {
    return {
      ok: true,
      config: {
        maxAgeMs: DEFAULT_RETENTION_MAX_AGE_MS,
        maxBytesPerNamespace: DEFAULT_RETENTION_MAX_BYTES,
        sweepOnOpen: true,
      },
    }
  }
  const maxAge = validateLimit(input.maxAgeMs, DEFAULT_RETENTION_MAX_AGE_MS)
  if (maxAge === 'invalid') return { ok: false, field: 'maxAgeMs' }
  const maxBytes = validateLimit(input.maxBytesPerNamespace, DEFAULT_RETENTION_MAX_BYTES)
  if (maxBytes === 'invalid') return { ok: false, field: 'maxBytesPerNamespace' }
  return {
    ok: true,
    config: { maxAgeMs: maxAge, maxBytesPerNamespace: maxBytes, sweepOnOpen: input.sweepOnOpen ?? true },
  }
}

/**
 * 单次 retention sweep 报告（SA2 §2.2；数据面——可含 streamId，与健康事件低基数
 * 纪律正交：事件只带计数/封闭枚举）。
 */
export interface RetentionSweepReport {
  /** 参与判定的 stream generation 数。 */
  sweptStreams: number
  /** 成对删除完成的闭组数。 */
  deletedGroups: number
  /** 上述组 jsonl+bin 字节合计。 */
  reclaimedBytes: number
  /** orphan BIN 文件数。 */
  orphanBinsDeleted: number
  /** 本次完成的遗留 .deleting 协议数。 */
  deletingMarkersCompleted: number
  /** 因活跃租约跳过（并止步）的组数。 */
  leaseBlockedGroups: number
  /** 因开组保护止步的 stream 数。 */
  openProtectedStops: number
  /** 任一 IO 失败步骤计数。 */
  failedSteps: number
  /** sweep 后 namespace 全部留存字节（诚实下限：开组 + 阻塞组字节照计）。 */
  retainedBytes: number
  /** 每个仍有文件的 stream 的最早保留 sequence（扫描重建——ADR 明文）。 */
  earliestRetained: Array<{ streamId: string; sequence: string | null }>
  /** 最低幸存段 ≠ '00000001' 的 stream（历史已裁剪）。 */
  historyTrimmedStreams: Array<{ streamId: string }>
}

/**
 * DEFAULT_* 三常量（冻结值，与 harness CONTRACT_* 逐值一致）+ Partial 合并。
 *
 * 设计：§2（值）/§15.2（冻结语义）。
 */
import type {
  ReplicationBackoff,
  ReplicationLimits,
  ReplicationTimeouts,
  ResolvedBackoff,
  ResolvedLimits,
  ResolvedTimeouts,
} from './types.js';

/** 冻结默认 limits（§2 注释值；与 harness CONTRACT_LIMITS 逐值一致）。 */
export const DEFAULT_REPLICATION_LIMITS: Readonly<ReplicationLimits> = Object.freeze({
  maxFrameBytes: 8 * 1024 * 1024,
  maxBootstrapBytes: 4 * 1024 * 1024,
  maxSyncDiffBytes: 2 * 1024 * 1024,
  maxUpdateBytes: 512 * 1024,
  maxQueuedUpdateBytes: 4 * 1024 * 1024,
  maxQueuedUpdateCount: 256,
  maxInFlightUpdates: 32,
  maxQueuedBytesPerConnection: 8 * 1024 * 1024,
  lowWater: 64 * 1024,
  highWater: 512 * 1024,
});

/** 冻结默认 timeouts（§2 注释值；与 harness CONTRACT_TIMEOUTS 逐值一致）。 */
export const DEFAULT_REPLICATION_TIMEOUTS: Readonly<ReplicationTimeouts> = Object.freeze({
  helloTimeoutMs: 10_000,
  openTimeoutMs: 5_000,
  bootstrapTimeoutMs: 10_000,
  reconcileTimeoutMs: 10_000,
  closeTimeoutMs: 5_000,
  ackTimeoutMs: 10_000,
});

/** 冻结默认 backoff（§2 注释值；与 harness CONTRACT_BACKOFF 逐值一致）。 */
export const DEFAULT_REPLICATION_BACKOFF: Readonly<ReplicationBackoff> = Object.freeze({
  baseMs: 100,
  maxMs: 30_000,
  resetAfterMs: 10_000,
});

/** Partial 覆盖合并（显式字段整值替换缺省；逐字段 clamp 是禁区——见 §15.1）。 */
export function resolveLimits(partial: Readonly<Partial<ReplicationLimits>> | undefined): ResolvedLimits {
  return { ...DEFAULT_REPLICATION_LIMITS, ...(partial ?? {}) };
}

export function resolveTimeouts(
  partial: Readonly<Partial<ReplicationTimeouts>> | undefined,
): ResolvedTimeouts {
  return { ...DEFAULT_REPLICATION_TIMEOUTS, ...(partial ?? {}) };
}

export function resolveBackoff(
  partial: Readonly<Partial<ReplicationBackoff>> | undefined,
): ResolvedBackoff {
  return { ...DEFAULT_REPLICATION_BACKOFF, ...(partial ?? {}) };
}

/**
 * §17 构造期响亮校验（`validate.ts`；同步 `TypeError`，绝不运行时 clamp）。
 *
 * 设计：§15.1。createHubReplication / createPeerReplication 构造期（合并 Partial
 * 覆盖 DEFAULT 后对**合并结果**校验）。
 */
import type {
  ReplicationBackoff,
  ReplicationLimits,
  ReplicationTimeouts,
} from './types.js';

const INSTANCE_ID_RE = /^[a-z][a-z0-9-]{0,62}$/;
const PROTOCOL_OVERHEAD_BYTES = 128;

function assertCollKind(
  cond: boolean,
  name: string,
  detail: string,
): asserts cond {
  if (!cond) throw new TypeError(`${name}: ${detail}`);
}

function positiveSafeInteger(value: number, name: string): void {
  assertCollKind(Number.isSafeInteger(value) && value > 0, name, `${name} 必须为正有限安全整数`);
}

/** 形状门（缺成员/非函数 → TypeError，message 恒定不回显传入值）。 */
function assertCallable(value: unknown, name: string): void {
  assertCollKind(typeof value === 'function', name, `${name} 必须是函数`);
}

function assertObjectShape(value: unknown, name: string): void {
  assertCollKind(
    value !== null && typeof value === 'object',
    name,
    `${name} 必须是对象`,
  );
}

export function validateInstanceId(instanceId: string, name: string): void {
  assertCollKind(
    typeof instanceId === 'string' && INSTANCE_ID_RE.test(instanceId),
    name,
    `${name} 必须匹配 ^[a-z][a-z0-9-]{0,62}$`,
  );
}

export function validateHubOptions(
  options: Readonly<{
    instanceId: string;
    registry: unknown;
    authorize: unknown;
    timer: unknown;
  }>,
): void {
  validateInstanceId(options.instanceId, 'instanceId');
  assertObjectShape(options.registry, 'registry');
  assertCallable(
    (options.registry as { open?: unknown }).open,
    'registry.open',
  );
  assertCallable(options.authorize, 'authorize');
  assertObjectShape(options.timer, 'timer');
  assertCallable(
    (options.timer as { setTimeout?: unknown }).setTimeout,
    'timer.setTimeout',
  );
  assertCallable(
    (options.timer as { clearTimeout?: unknown }).clearTimeout,
    'timer.clearTimeout',
  );
}

export function validatePeerOptions(
  options: Readonly<{
    instanceId: string;
    hubInstanceId: string;
    registry: unknown;
    dial: unknown;
    timer: unknown;
  }>,
): void {
  validateInstanceId(options.instanceId, 'instanceId');
  validateInstanceId(options.hubInstanceId, 'hubInstanceId');
  assertObjectShape(options.registry, 'registry');
  assertCallable(
    (options.registry as { open?: unknown }).open,
    'registry.open',
  );
  assertCallable(options.dial, 'dial');
  assertObjectShape(options.timer, 'timer');
  assertCallable(
    (options.timer as { setTimeout?: unknown }).setTimeout,
    'timer.setTimeout',
  );
  assertCallable(
    (options.timer as { clearTimeout?: unknown }).clearTimeout,
    'timer.clearTimeout',
  );
}

export function validateLimits(limits: ReplicationLimits): void {
  positiveSafeInteger(limits.maxFrameBytes, 'maxFrameBytes');
  positiveSafeInteger(limits.maxBootstrapBytes, 'maxBootstrapBytes');
  positiveSafeInteger(limits.maxSyncDiffBytes, 'maxSyncDiffBytes');
  positiveSafeInteger(limits.maxUpdateBytes, 'maxUpdateBytes');
  positiveSafeInteger(limits.maxQueuedUpdateBytes, 'maxQueuedUpdateBytes');
  positiveSafeInteger(limits.maxQueuedUpdateCount, 'maxQueuedUpdateCount');
  positiveSafeInteger(limits.maxInFlightUpdates, 'maxInFlightUpdates');
  positiveSafeInteger(limits.maxQueuedBytesPerConnection, 'maxQueuedBytesPerConnection');
  positiveSafeInteger(limits.lowWater, 'lowWater');
  positiveSafeInteger(limits.highWater, 'highWater');
  positiveSafeInteger(limits.controlReserveBytes, 'controlReserveBytes');

  const budget = limits.maxFrameBytes - PROTOCOL_OVERHEAD_BYTES;
  assertCollKind(
    limits.maxBootstrapBytes <= budget,
    'limits',
    `maxBootstrapBytes(${limits.maxBootstrapBytes}) 必须 ≤ maxFrameBytes − ${PROTOCOL_OVERHEAD_BYTES}(${budget})`,
  );
  assertCollKind(
    limits.maxSyncDiffBytes <= budget,
    'limits',
    `maxSyncDiffBytes(${limits.maxSyncDiffBytes}) 必须 ≤ maxFrameBytes − ${PROTOCOL_OVERHEAD_BYTES}(${budget})`,
  );
  assertCollKind(
    limits.maxUpdateBytes <= budget,
    'limits',
    `maxUpdateBytes(${limits.maxUpdateBytes}) 必须 ≤ maxFrameBytes − ${PROTOCOL_OVERHEAD_BYTES}(${budget})`,
  );
  assertCollKind(
    limits.maxQueuedUpdateBytes >= limits.maxUpdateBytes,
    'limits',
    'maxQueuedUpdateBytes 必须 ≥ maxUpdateBytes',
  );
  assertCollKind(limits.maxInFlightUpdates >= 1, 'limits', 'maxInFlightUpdates 必须 ≥ 1');
  assertCollKind(
    limits.lowWater < limits.highWater,
    'limits',
    'lowWater 必须 < highWater',
  );
}

export function validateTimeouts(timeouts: ReplicationTimeouts): void {
  positiveSafeInteger(timeouts.helloTimeoutMs, 'helloTimeoutMs');
  positiveSafeInteger(timeouts.openTimeoutMs, 'openTimeoutMs');
  positiveSafeInteger(timeouts.bootstrapTimeoutMs, 'bootstrapTimeoutMs');
  positiveSafeInteger(timeouts.reconcileTimeoutMs, 'reconcileTimeoutMs');
  positiveSafeInteger(timeouts.closeTimeoutMs, 'closeTimeoutMs');
  positiveSafeInteger(timeouts.ackTimeoutMs, 'ackTimeoutMs');
}

export function validateBackoff(backoff: ReplicationBackoff): void {
  positiveSafeInteger(backoff.baseMs, 'baseMs');
  positiveSafeInteger(backoff.maxMs, 'maxMs');
  positiveSafeInteger(backoff.resetAfterMs, 'resetAfterMs');
  assertCollKind(backoff.baseMs <= backoff.maxMs, 'backoff', 'baseMs 必须 ≤ maxMs');
}

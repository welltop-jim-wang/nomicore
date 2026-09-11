/**
 * §17 构造期响亮校验（`validate.ts`；同步 `TypeError`，绝不运行时 clamp）。
 *
 * 设计：§15.1。createHubReplication / createPeerReplication 构造期（合并 Partial
 * 覆盖 DEFAULT 后对**合并结果**校验）。
 */
import type {
  ReplicationBackoff,
  ReplicationLimits,
  ResolvedTimeouts,
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

/** D1：对升级认证器返回身份做布尔文法判定（reject 语义——validateInstanceId 是 throw 语义）。 */
export function isValidInstanceId(value: unknown): boolean {
  return typeof value === 'string' && INSTANCE_ID_RE.test(value);
}

export function validateHubOptions(
  options: Readonly<{
    instanceId: string;
    registry: unknown;
    authorize: unknown;
    timer: unknown;
    verifyToken: unknown;
    observer?: unknown;
    clock?: unknown;
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
  assertCallable(options.verifyToken, 'verifyToken');
  if (options.observer !== undefined) {
    assertCallable(options.observer, 'observer');
  }
  if (options.clock !== undefined) {
    assertObjectShape(options.clock, 'clock');
    assertCallable((options.clock as { now?: unknown }).now, 'clock.now');
  }
}

export function validatePeerOptions(
  options: Readonly<{
    instanceId: string;
    hubInstanceId: string;
    registry: unknown;
    dial: unknown;
    timer: unknown;
    chunkedUpdate?: unknown; // issue #243：opt-in 旋钮形状门
    deferTask?: unknown;
    observer?: unknown;
    clock?: unknown;
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
  if (options.chunkedUpdate !== undefined) {
    assertCollKind(
      typeof options.chunkedUpdate === 'boolean',
      'chunkedUpdate',
      'chunkedUpdate 必须是 boolean',
    );
  }
  if (options.deferTask !== undefined) {
    assertCallable(options.deferTask, 'deferTask');
  }
  if (options.observer !== undefined) {
    assertCallable(options.observer, 'observer');
  }
  if (options.clock !== undefined) {
    assertObjectShape(options.clock, 'clock');
    assertCallable((options.clock as { now?: unknown }).now, 'clock.now');
  }
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
  positiveSafeInteger(limits.maxQueuedControlBytes, 'maxQueuedControlBytes');
  positiveSafeInteger(limits.maxChunkedUpdateBytes, 'maxChunkedUpdateBytes'); // issue #243（slice 2）
  // issue #244（slice 3）：分块传输两新上限键值门（约束 ≥ 1，ADR 0013 配置表）
  positiveSafeInteger(limits.maxChunksPerUpdate, 'maxChunksPerUpdate');
  positiveSafeInteger(limits.maxConcurrentAssembliesPerConnection, 'maxConcurrentAssembliesPerConnection');
  // issue #295（slice 1）：snapshot / sync-diff 聚合上限两键值门（正有限安全整数；缺省 4 MiB 恒合法）
  positiveSafeInteger(limits.maxChunkedBootstrapBytes, 'maxChunkedBootstrapBytes');
  positiveSafeInteger(limits.maxChunkedSyncDiffBytes, 'maxChunkedSyncDiffBytes');

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
  // 协议 §17：控制帧独立保留额度 ≥ maxBootstrapBytes + 协议开销（启动期响亮验证，无运行时 clamp）
  assertCollKind(
    limits.maxQueuedControlBytes >= limits.maxBootstrapBytes + PROTOCOL_OVERHEAD_BYTES,
    'limits',
    `maxQueuedControlBytes(${limits.maxQueuedControlBytes}) 必须 ≥ maxBootstrapBytes(${limits.maxBootstrapBytes}) + ${PROTOCOL_OVERHEAD_BYTES}`,
  );
  assertCollKind(
    limits.lowWater < limits.highWater,
    'limits',
    'lowWater 必须 < highWater',
  );
  // §3.4/A2-3 链式不变量：可恢复暂停阈值必须先于终止性 1011 阈值（low < high ≤ 总预算）
  assertCollKind(
    limits.highWater <= limits.maxQueuedBytesPerConnection,
    'limits',
    'highWater 必须 ≤ maxQueuedBytesPerConnection',
  );
  // §17 链式不变量：control 保留额度必须恒容纳一次 bootstrap + 协议开销（构造期
  // 响亮校验，绝不运行时 clamp——最低合法额度即「恰好容纳一次 bootstrap + 开销」）。
  assertCollKind(
    limits.maxQueuedControlBytes >= limits.maxBootstrapBytes + PROTOCOL_OVERHEAD_BYTES,
    'limits',
    `maxQueuedControlBytes(${limits.maxQueuedControlBytes}) 必须 ≥ maxBootstrapBytes(${limits.maxBootstrapBytes}) + ${PROTOCOL_OVERHEAD_BYTES}`,
  );
}

/**
 * issue #244（ADR 0013 配置表约束列；跨字段响亮链——绝不运行时 clamp）。调用契约 =
 * 仅当调用方**显式**表达任一「分块族链上键」——`maxChunkedUpdateBytes` ∨
 * `maxChunksPerUpdate`（两链不等式的操作数键，均为本切片家族引入）——时对合并结果
 * 校验两链（SA4-2 收口：单键门会把「显式收紧 maxChunksPerUpdate + 缺省 envelope」留成
 * 族内静默缺口——R1c `{maxChunksPerUpdate: 4}` → 链② 4MiB > 4×512KiB=2MiB 构造期
 * TypeError）。缺省值自洽由 DEFAULT 构造成立（4MiB ≤ 4MiB ∧ 4MiB ≤ 64×512KiB=32MiB）；
 * 仅显式下调既有键、未表达分块族键的存量配置不激活链——非追溯性：slice-3 前配置无法
 * 预见新键缺省（N5 锁定），不把「未触碰的缺省」误判为用户配置错误（N6：非链操作数键
 * 亦不激活）；R1a 的 6MiB 显式申报即在本链上响亮 TypeError。
 * 两链在合并结果上判定：
 *   1. maxChunkedUpdateBytes ≤ maxQueuedUpdateBytes（单笔组装上界 ≤ 未发送队列字节预算）；
 *   2. maxChunkedUpdateBytes ≤ maxChunksPerUpdate × maxUpdateBytes（totalBytes/chunkCount
 *      两维声明校验的几何一致先决；缺省 4MiB ≤ 64 × 512KiB = 32MiB）。
 */
export function validateChunkedTransferChain(limits: ReplicationLimits): void {
  assertCollKind(
    limits.maxChunkedUpdateBytes <= limits.maxQueuedUpdateBytes,
    'limits',
    `maxChunkedUpdateBytes(${limits.maxChunkedUpdateBytes}) 必须 ≤ maxQueuedUpdateBytes(${limits.maxQueuedUpdateBytes})`,
  );
  assertCollKind(
    limits.maxChunkedUpdateBytes <= limits.maxChunksPerUpdate * limits.maxUpdateBytes,
    'limits',
    `maxChunkedUpdateBytes(${limits.maxChunkedUpdateBytes}) 必须 ≤ maxChunksPerUpdate(${limits.maxChunksPerUpdate}) × maxUpdateBytes(${limits.maxUpdateBytes})`,
  );
}

/**
 * issue #295（slice 1，ADR 0019 配置表 / 协议 §17）：chunked snapshot 聚合上限链②
 * `maxChunkedBootstrapBytes ≤ maxChunksPerUpdate × maxUpdateBytes`（≤ 含等号；绝不运行时 clamp）。
 *
 * 激活门（D6 裁决，与 `validateChunkedTransferChain` 的 #244 家族门同构但**各自独立**）：
 * 仅当调用方**显式表达 `maxChunkedBootstrapBytes`** 时对合并结果校验本链——协议 §17
 * 「显式配置 … 时**对应**链式校验响亮生效；未表达新键的存量配置不误判」；每条 #295 链只由
 * 自身新键激活（SA8 R38 / 设计 D6 窄门；宽门会与锁定契约 C2/C3 边界族数学冲突）。
 */
export function validateChunkedBootstrapChain(limits: ReplicationLimits): void {
  assertCollKind(
    limits.maxChunkedBootstrapBytes <= limits.maxChunksPerUpdate * limits.maxUpdateBytes,
    'limits',
    `maxChunkedBootstrapBytes(${limits.maxChunkedBootstrapBytes}) 必须 ≤ maxChunksPerUpdate(${limits.maxChunksPerUpdate}) × maxUpdateBytes(${limits.maxUpdateBytes})`,
  );
}

/**
 * issue #295（slice 1，ADR 0019 配置表 / 协议 §17）：chunked sync-diff 聚合上限链②
 * `maxChunkedSyncDiffBytes ≤ maxChunksPerUpdate × maxUpdateBytes`（同形态、同纪律）。
 * 激活门 = 显式表达 `maxChunkedSyncDiffBytes`（见上）。
 */
export function validateChunkedSyncDiffChain(limits: ReplicationLimits): void {
  assertCollKind(
    limits.maxChunkedSyncDiffBytes <= limits.maxChunksPerUpdate * limits.maxUpdateBytes,
    'limits',
    `maxChunkedSyncDiffBytes(${limits.maxChunkedSyncDiffBytes}) 必须 ≤ maxChunksPerUpdate(${limits.maxChunksPerUpdate}) × maxUpdateBytes(${limits.maxUpdateBytes})`,
  );
}

export function validateTimeouts(timeouts: ResolvedTimeouts): void {
  positiveSafeInteger(timeouts.helloTimeoutMs, 'helloTimeoutMs');
  positiveSafeInteger(timeouts.openTimeoutMs, 'openTimeoutMs');
  positiveSafeInteger(timeouts.bootstrapTimeoutMs, 'bootstrapTimeoutMs');
  positiveSafeInteger(timeouts.reconcileTimeoutMs, 'reconcileTimeoutMs');
  positiveSafeInteger(timeouts.reconcileIntervalMs, 'reconcileIntervalMs');
  positiveSafeInteger(timeouts.closeTimeoutMs, 'closeTimeoutMs');
  positiveSafeInteger(timeouts.ackTimeoutMs, 'ackTimeoutMs');
  positiveSafeInteger(timeouts.pingIntervalMs, 'pingIntervalMs');
  positiveSafeInteger(timeouts.pongTimeoutMs, 'pongTimeoutMs');
  positiveSafeInteger(timeouts.assemblyTimeoutMs, 'assemblyTimeoutMs'); // issue #244（有限正整数，无跨字段）
  assertCollKind(
    timeouts.pongTimeoutMs < timeouts.pingIntervalMs,
    'timeouts',
    'pongTimeoutMs 必须 < pingIntervalMs',
  );
}

export function validateBackoff(backoff: ReplicationBackoff): void {
  positiveSafeInteger(backoff.baseMs, 'baseMs');
  positiveSafeInteger(backoff.maxMs, 'maxMs');
  positiveSafeInteger(backoff.resetAfterMs, 'resetAfterMs');
  assertCollKind(backoff.baseMs <= backoff.maxMs, 'backoff', 'baseMs 必须 ≤ maxMs');
}

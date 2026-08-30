/**
 * `@nomicore/yjs-server` 严格配置模型与校验（设计 §3.2；AC1）。
 *
 * 纪律：
 *  - 一切违反在启动期同步 loud：未知键 TypeError（拒绝静默忽略拼错）；
 *  - role×字段交叉互斥（hub config 带 peer 块 / peer config 带 hub 块 → 拒；
 *    role=hub 出现顶层 `backoff`（peer 专属）→ 拒）；
 *  - authorization 双形式：`namespaceId`/`provisionId` 恰一；直引形式
 *    `ownerUserId` 必填非空（localOwner 唯一来源）；provision 形式禁止
 *    `ownerUserId`（owner 唯一来源 = provision 条目）；
 *  - 解析结果**深冻结**（调用方改写配置零效果——配置是不可变契约）。
 *
 * 校验失败抛 `ConfigValidationError`（TypeError 子类，携带结构化
 * `violations: {path, reason}[]`——启动与 SIGHUP 换装共用同一校验器并输出
 * 同一形状的诊断）。
 */
import type { ReplicationBackoff, ReplicationLimits, ReplicationTimeouts } from '@nomicore/ws-replication';

export const INSTANCE_ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
export const NAMESPACE_ID_PATTERN = /^ns-[0-9a-f]{32}$/;

export interface AppConfig {
  readonly role: 'hub' | 'peer';
  readonly instanceId: string;
  readonly persistence: PersistenceConfig;
  readonly idleTimeoutMs?: number;
  readonly limits?: Readonly<Partial<ReplicationLimits>>;
  readonly timeouts?: Readonly<Partial<ReplicationTimeouts>>;
  readonly backoff?: Readonly<Partial<ReplicationBackoff>>;
  readonly hub?: HubConfig;
  readonly peer?: PeerConfig;
}

export type PersistenceConfig =
  | Readonly<{ kind: 'memory' }>
  | Readonly<{ kind: 'file'; rootDir: string; schedule?: Readonly<{ debounceMs: number; maxDirtyMs: number }> }>;

export interface HubConfig {
  readonly listen: Readonly<{ host: string; port: number }>;
  readonly tokens: Readonly<Record<string, string>>;
  readonly provision?: readonly ProvisionEntry[];
  readonly authorization?: readonly AuthorizationEntry[];
}

export interface ProvisionEntry {
  readonly id: string;
  readonly ownerUserId: string;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly root: unknown;
}

export type AuthorizationEntry =
  | Readonly<{
      peerInstanceId: string;
      namespaceId: string;
      ownerUserId: string;
      read: boolean;
      submit: boolean;
    }>
  | Readonly<{
      peerInstanceId: string;
      provisionId: string;
      read: boolean;
      submit: boolean;
    }>;

export interface PeerConfig {
  readonly hub: Readonly<{ url: string; hubInstanceId: string; token: string }>;
  readonly targets?: readonly Readonly<{ namespaceId: string; ownerUserId: string }>[];
}

export class ConfigValidationError extends TypeError {
  readonly violations: readonly Readonly<{ path: string; reason: string }>[];

  constructor(violations: readonly Readonly<{ path: string; reason: string }>[]) {
    super(
      `invalid yjs-server app config: ${violations
        .map((v) => `${v.path}: ${v.reason}`)
        .join('; ')}`,
    );
    this.name = 'ConfigValidationError';
    this.violations = Object.freeze([...violations]);
  }
}

const LIMIT_KEYS = new Set([
  'maxFrameBytes',
  'maxBootstrapBytes',
  'maxSyncDiffBytes',
  'maxUpdateBytes',
  'maxQueuedUpdateBytes',
  'maxQueuedUpdateCount',
  'maxInFlightUpdates',
  'maxQueuedBytesPerConnection',
  'lowWater',
  'highWater',
  'controlReserveBytes',
]);

const TIMEOUT_KEYS = new Set([
  'helloTimeoutMs',
  'openTimeoutMs',
  'bootstrapTimeoutMs',
  'reconcileTimeoutMs',
  'closeTimeoutMs',
  'ackTimeoutMs',
  'pingIntervalMs',
  'pongTimeoutMs',
]);

const BACKOFF_KEYS = new Set(['baseMs', 'maxMs', 'resetAfterMs']);

interface Problem {
  readonly path: string;
  readonly reason: string;
}

type Violations = Problem[];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function checkStringPattern(value: unknown, pattern: RegExp, path: string, what: string, violations: Violations): void {
  if (typeof value !== 'string' || !pattern.test(value)) {
    violations.push({ path, reason: `${what} must match ${pattern}` });
  }
}

/** 校验并深冻结一个 plain value（对象/数组递归；其余原样返回）。 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

/** 校验 `limits`/`timeouts`/`backoff` 这类 Partial 透传块：键集白名单 + 正数校验。 */
function validatePartialNumberBlock(
  value: unknown,
  path: string,
  allowedKeys: ReadonlySet<string>,
  what: string,
  violations: Violations,
): unknown {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    violations.push({ path, reason: `${what} must be an object` });
    return undefined;
  }
  for (const [key, child] of Object.entries(value)) {
    if (!allowedKeys.has(key)) {
      violations.push({ path: `${path}.${key}`, reason: `unknown key (${what}); allowed: ${[...allowedKeys].join(', ')}` });
    } else if (!isPositiveFinite(child)) {
      violations.push({ path: `${path}.${key}`, reason: `${what} value must be a positive finite number` });
    }
  }
  return value;
}

function validatePersistence(value: unknown, violations: Violations): PersistenceConfig | undefined {
  if (!isPlainObject(value)) {
    violations.push({ path: 'persistence', reason: 'persistence must be an object' });
    return undefined;
  }
  if (value.kind !== 'memory' && value.kind !== 'file') {
    violations.push({ path: 'persistence.kind', reason: `persistence.kind must be 'memory' | 'file'` });
    return undefined;
  }
  const keys = Object.keys(value);
  if (value.kind === 'memory') {
    if (keys.some((k) => k !== 'kind')) {
      violations.push({ path: 'persistence', reason: `unknown key for memory persistence: ${keys.filter((k) => k !== 'kind').join(', ')}` });
      return undefined;
    }
    return { kind: 'memory' };
  }
  for (const key of keys) {
    if (key !== 'kind' && key !== 'rootDir' && key !== 'schedule') {
      violations.push({ path: `persistence.${key}`, reason: 'unknown key for file persistence' });
    }
  }
  if (!isNonEmptyString(value.rootDir)) {
    violations.push({ path: 'persistence.rootDir', reason: 'file persistence requires a non-empty rootDir string' });
  }
  let schedule: Readonly<{ debounceMs: number; maxDirtyMs: number }> | undefined;
  if (value.schedule !== undefined) {
    if (
      !isPlainObject(value.schedule) ||
      !isPositiveFinite(value.schedule.debounceMs) ||
      !isPositiveFinite(value.schedule.maxDirtyMs)
    ) {
      violations.push({
        path: 'persistence.schedule',
        reason: 'persistence.schedule requires debounceMs and maxDirtyMs (positive finite numbers)',
      });
    } else {
      schedule = { debounceMs: value.schedule.debounceMs, maxDirtyMs: value.schedule.maxDirtyMs };
    }
  }
  return { kind: 'file', rootDir: value.rootDir as string, ...(schedule !== undefined ? { schedule } : {}) };
}

function validateListen(value: unknown, violations: Violations): Readonly<{ host: string; port: number }> | undefined {
  if (!isPlainObject(value)) {
    violations.push({ path: 'hub.listen', reason: 'hub.listen must be an object' });
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (key !== 'host' && key !== 'port') {
      violations.push({ path: `hub.listen.${key}`, reason: 'unknown key in hub.listen' });
    }
  }
  if (!isNonEmptyString(value.host)) {
    violations.push({ path: 'hub.listen.host', reason: 'hub.listen.host must be a non-empty string' });
  }
  if (typeof value.port !== 'number' || !Number.isInteger(value.port) || value.port < 0 || value.port > 65535) {
    violations.push({ path: 'hub.listen.port', reason: 'hub.listen.port must be an integer in 0..65535 (0 = ephemeral)' });
  }
  return value.host !== undefined && value.port !== undefined
    ? { host: value.host as string, port: value.port as number }
    : undefined;
}

function validateTokens(value: unknown, violations: Violations): Readonly<Record<string, string>> | undefined {
  if (!isPlainObject(value)) {
    violations.push({ path: 'hub.tokens', reason: 'hub.tokens must be an object' });
    return undefined;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    violations.push({ path: 'hub.tokens', reason: 'hub.tokens must be non-empty' });
    return undefined;
  }
  const tokens: Record<string, string> = {};
  for (const [peerInstanceId, token] of entries) {
    if (!INSTANCE_ID_PATTERN.test(peerInstanceId)) {
      violations.push({ path: `hub.tokens.${peerInstanceId}`, reason: `token key must match ${INSTANCE_ID_PATTERN}` });
    }
    if (typeof token !== 'string' || token.length === 0) {
      violations.push({ path: `hub.tokens.${peerInstanceId}`, reason: 'token value must be a non-empty string' });
    } else {
      tokens[peerInstanceId] = token;
    }
  }
  return tokens;
}

function validateProvision(value: unknown, violations: Violations): readonly ProvisionEntry[] | undefined {
  if (!Array.isArray(value)) {
    violations.push({ path: 'hub.provision', reason: 'hub.provision must be an array' });
    return undefined;
  }
  const out: ProvisionEntry[] = [];
  value.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      violations.push({ path: `hub.provision[${index}]`, reason: 'provision entry must be an object' });
      return;
    }
    if (!isNonEmptyString(entry.id)) {
      violations.push({ path: `hub.provision[${index}].id`, reason: 'provision id must be a non-empty string' });
    }
    if (!isNonEmptyString(entry.ownerUserId)) {
      violations.push({ path: `hub.provision[${index}].ownerUserId`, reason: 'provision ownerUserId must be a non-empty string' });
    }
    const schema = entry.schema;
    if (
      !isPlainObject(schema) ||
      schema.lang !== 'vfsl' ||
      typeof schema.version !== 'number' ||
      !isNonEmptyString(schema.id) ||
      typeof schema.text !== 'string'
    ) {
      violations.push({
        path: `hub.provision[${index}].schema`,
        reason: 'provision schema must be { lang: "vfsl", version: number, id: non-empty string, text: string }',
      });
    }
    if (Object.keys(entry).some((k) => k !== 'id' && k !== 'ownerUserId' && k !== 'schema' && k !== 'root')) {
      violations.push({ path: `hub.provision[${index}]`, reason: 'unknown key in provision entry (allowed: id, ownerUserId, schema, root)' });
    }
    out.push({
      id: entry.id as string,
      ownerUserId: entry.ownerUserId as string,
      schema: schema as Record<string, unknown>,
      root: entry.root,
    });
  });
  return out;
}

function validateAuthorization(
  value: unknown,
  provisionIds: ReadonlySet<string>,
  violations: Violations,
): readonly AuthorizationEntry[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    violations.push({ path: 'hub.authorization', reason: 'hub.authorization must be an array' });
    return undefined;
  }
  const out: AuthorizationEntry[] = [];
  const seenDirect = new Set<string>();
  const seenProvision = new Set<string>();
  value.forEach((entry, index) => {
    const base = `hub.authorization[${index}]`;
    if (!isPlainObject(entry)) {
      violations.push({ path: base, reason: 'authorization entry must be an object' });
      return;
    }
    checkStringPattern(entry.peerInstanceId, INSTANCE_ID_PATTERN, `${base}.peerInstanceId`, 'peerInstanceId', violations);
    const hasNamespaceId = entry.namespaceId !== undefined;
    const hasProvisionId = entry.provisionId !== undefined;
    if (hasNamespaceId === hasProvisionId) {
      violations.push({ path: base, reason: 'authorization entry must carry exactly one of namespaceId | provisionId' });
    }
    if (typeof entry.read !== 'boolean' || typeof entry.submit !== 'boolean') {
      violations.push({ path: base, reason: 'authorization entry requires boolean read and submit' });
    }
    const unknownKeys = Object.keys(entry).filter(
      (k) => k !== 'peerInstanceId' && k !== 'namespaceId' && k !== 'provisionId' && k !== 'ownerUserId' && k !== 'read' && k !== 'submit',
    );
    if (unknownKeys.length > 0) {
      violations.push({ path: base, reason: `unknown key in authorization entry: ${unknownKeys.join(', ')}` });
    }
    if (hasNamespaceId) {
      const nsId = entry.namespaceId;
      checkStringPattern(nsId, NAMESPACE_ID_PATTERN, `${base}.namespaceId`, 'namespaceId', violations);
      if (!isNonEmptyString(entry.ownerUserId)) {
        violations.push({
          path: `${base}.ownerUserId`,
          reason: 'direct-form authorization (namespaceId) requires a non-empty ownerUserId (localOwner single source)',
        });
      }
      const key = `${String(entry.peerInstanceId)}\u0000${String(nsId)}`;
      if (seenDirect.has(key)) {
        violations.push({ path: base, reason: `duplicate (peerInstanceId, namespaceId) authorization pair: ${String(entry.peerInstanceId)} / ${String(nsId)}` });
      }
      seenDirect.add(key);
      out.push({
        peerInstanceId: entry.peerInstanceId as string,
        namespaceId: nsId as string,
        ownerUserId: entry.ownerUserId as string,
        read: entry.read as boolean,
        submit: entry.submit as boolean,
      });
    } else if (hasProvisionId) {
      const provisionId = entry.provisionId;
      if (!isNonEmptyString(provisionId)) {
        violations.push({ path: `${base}.provisionId`, reason: 'provisionId must be a non-empty string' });
      } else if (!provisionIds.has(provisionId)) {
        violations.push({ path: `${base}.provisionId`, reason: `dangling provisionId "${provisionId}" (must resolve to a hub.provision entry)` });
      }
      if (entry.ownerUserId !== undefined) {
        violations.push({
          path: `${base}.ownerUserId`,
          reason: 'provision-form authorization must NOT carry ownerUserId (owner comes from the provision entry)',
        });
      }
      const key = `${String(entry.peerInstanceId)}\u0000${String(provisionId)}`;
      if (seenProvision.has(key)) {
        violations.push({ path: base, reason: `duplicate (peerInstanceId, provisionId) authorization pair: ${String(entry.peerInstanceId)} / ${String(provisionId)}` });
      }
      seenProvision.add(key);
      out.push({
        peerInstanceId: entry.peerInstanceId as string,
        provisionId: provisionId as string,
        read: entry.read as boolean,
        submit: entry.submit as boolean,
      });
    }
  });
  return out;
}

function validatePeerHubUrl(value: unknown, path: string, violations: Violations): boolean {
  if (typeof value !== 'string') {
    violations.push({ path, reason: 'peer.hub.url must be a string' });
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    violations.push({ path, reason: `peer.hub.url is not a valid URL: "${value}"` });
    return false;
  }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    violations.push({ path, reason: `peer.hub.url must use ws: or wss: (got "${parsed.protocol}")` });
    return false;
  }
  if (parsed.hostname === '') {
    violations.push({ path, reason: 'peer.hub.url must have a host' });
    return false;
  }
  if (parsed.hash !== '') {
    violations.push({ path, reason: 'peer.hub.url must not carry a fragment' });
    return false;
  }
  return true;
}

function validateHub(value: unknown, violations: Violations): HubConfig | undefined {
  if (!isPlainObject(value)) {
    violations.push({ path: 'hub', reason: 'hub must be an object' });
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (key !== 'listen' && key !== 'tokens' && key !== 'provision' && key !== 'authorization') {
      violations.push({ path: `hub.${key}`, reason: 'unknown key in hub block' });
    }
  }
  const listen = validateListen(value.listen, violations);
  const tokens = validateTokens(value.tokens, violations);
  const provision = validateProvision(value.provision ?? [], violations);
  const provisionIds = new Set((provision ?? []).map((p) => p.id));
  const authorization = validateAuthorization(value.authorization, provisionIds, violations);
  return listen !== undefined && tokens !== undefined
    ? {
        listen,
        tokens,
        ...(provision !== undefined && provision.length > 0 ? { provision } : {}),
        ...(authorization !== undefined && authorization.length > 0 ? { authorization } : {}),
      }
    : undefined;
}

function validatePeer(value: unknown, violations: Violations): PeerConfig | undefined {
  if (!isPlainObject(value)) {
    violations.push({ path: 'peer', reason: 'peer must be an object' });
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (key !== 'hub' && key !== 'targets') {
      violations.push({ path: `peer.${key}`, reason: 'unknown key in peer block' });
    }
  }
  if (!isPlainObject(value.hub)) {
    violations.push({ path: 'peer.hub', reason: 'peer.hub must be an object' });
    return undefined;
  }
  validatePeerHubUrl(value.hub.url, 'peer.hub.url', violations);
  checkStringPattern(value.hub.hubInstanceId, INSTANCE_ID_PATTERN, 'peer.hub.hubInstanceId', 'hubInstanceId', violations);
  if (!isNonEmptyString(value.hub.token)) {
    violations.push({ path: 'peer.hub.token', reason: 'peer.hub.token must be a non-empty string' });
  }
  let targets: readonly Readonly<{ namespaceId: string; ownerUserId: string }>[] | undefined;
  if (value.targets !== undefined) {
    if (!Array.isArray(value.targets)) {
      violations.push({ path: 'peer.targets', reason: 'peer.targets must be an array' });
    } else {
      const seen = new Set<string>();
      const list: Readonly<{ namespaceId: string; ownerUserId: string }>[] = [];
      value.targets.forEach((entry, index) => {
        const base = `peer.targets[${index}]`;
        if (!isPlainObject(entry)) {
          violations.push({ path: base, reason: 'target entry must be an object' });
          return;
        }
        checkStringPattern(entry.namespaceId, NAMESPACE_ID_PATTERN, `${base}.namespaceId`, 'namespaceId', violations);
        if (!isNonEmptyString(entry.ownerUserId)) {
          violations.push({ path: `${base}.ownerUserId`, reason: 'target ownerUserId must be a non-empty string' });
        }
        for (const key of Object.keys(entry)) {
          if (key !== 'namespaceId' && key !== 'ownerUserId') {
            violations.push({ path: `${base}.${key}`, reason: 'unknown key in target entry (exactly two fields: namespaceId, ownerUserId)' });
          }
        }
        const nsId = entry.namespaceId;
        if (typeof nsId === 'string' && seen.has(nsId)) {
          violations.push({ path: base, reason: `duplicate target namespaceId: ${nsId}` });
        }
        if (typeof nsId === 'string') seen.add(nsId);
        list.push({ namespaceId: nsId as string, ownerUserId: entry.ownerUserId as string });
      });
      targets = list;
    }
  }
  return {
    hub: {
      url: value.hub.url as string,
      hubInstanceId: value.hub.hubInstanceId as string,
      token: value.hub.token as string,
    },
    ...(targets !== undefined ? { targets } : {}),
  };
}

/**
 * 严格解析并深冻结 AppConfig。一切违规 → `ConfigValidationError`（TypeError）。
 */
export function parseAppConfig(raw: unknown): AppConfig {
  const violations: Violations = [];
  if (!isPlainObject(raw)) {
    throw new ConfigValidationError([{ path: '$', reason: 'config must be a plain JSON object' }]);
  }
  for (const key of Object.keys(raw)) {
    if (key !== 'role' && key !== 'instanceId' && key !== 'persistence' && key !== 'idleTimeoutMs' && key !== 'limits' && key !== 'timeouts' && key !== 'backoff' && key !== 'hub' && key !== 'peer') {
      violations.push({ path: key, reason: `unknown top-level key: ${key}` });
    }
  }
  const role = raw.role;
  if (role !== 'hub' && role !== 'peer') {
    violations.push({ path: 'role', reason: "role is mandatory and must be 'hub' | 'peer' (no default)" });
  }
  checkStringPattern(raw.instanceId, INSTANCE_ID_PATTERN, 'instanceId', 'instanceId', violations);
  const persistence = validatePersistence(raw.persistence, violations);
  if (raw.idleTimeoutMs !== undefined && !isPositiveFinite(raw.idleTimeoutMs)) {
    violations.push({ path: 'idleTimeoutMs', reason: 'idleTimeoutMs must be a positive finite number' });
  }
  validatePartialNumberBlock(raw.limits, 'limits', LIMIT_KEYS, 'limits', violations);
  validatePartialNumberBlock(raw.timeouts, 'timeouts', TIMEOUT_KEYS, 'timeouts', violations);
  validatePartialNumberBlock(raw.backoff, 'backoff', BACKOFF_KEYS, 'backoff', violations);

  const hasHub = raw.hub !== undefined;
  const hasPeer = raw.peer !== undefined;
  if (role === 'hub' && hasPeer) {
    violations.push({ path: 'peer', reason: 'role=hub config must not carry a peer block' });
  }
  if (role === 'peer' && hasHub) {
    violations.push({ path: 'hub', reason: 'role=peer config must not carry a hub block' });
  }
  if (role === 'hub' && !hasHub) {
    violations.push({ path: 'hub', reason: 'role=hub config requires a hub block' });
  }
  if (role === 'peer' && !hasPeer) {
    violations.push({ path: 'peer', reason: 'role=peer config requires a peer block' });
  }
  if (role === 'hub' && raw.backoff !== undefined) {
    violations.push({ path: 'backoff', reason: 'backoff is peer-only; role=hub must not carry it (HubReplicationOptions has no backoff field)' });
  }

  if (violations.length > 0) {
    throw new ConfigValidationError(violations);
  }

  const hub = hasHub ? validateHub(raw.hub, violations) : undefined;
  const peer = hasPeer ? validatePeer(raw.peer, violations) : undefined;
  if (violations.length > 0) {
    throw new ConfigValidationError(violations);
  }

  const config: AppConfig = {
    role: role as 'hub' | 'peer',
    instanceId: raw.instanceId as string,
    persistence: persistence as PersistenceConfig,
    ...(raw.idleTimeoutMs !== undefined ? { idleTimeoutMs: raw.idleTimeoutMs as number } : {}),
    ...(raw.limits !== undefined ? { limits: raw.limits as Readonly<Partial<ReplicationLimits>> } : {}),
    ...(raw.timeouts !== undefined ? { timeouts: raw.timeouts as Readonly<Partial<ReplicationTimeouts>> } : {}),
    ...(raw.backoff !== undefined ? { backoff: raw.backoff as Readonly<Partial<ReplicationBackoff>> } : {}),
    ...(hub !== undefined ? { hub } : {}),
    ...(peer !== undefined ? { peer } : {}),
  };
  return deepFreeze(config);
}

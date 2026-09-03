import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/cordis-plugin-timer';
import { requireClock } from '@nomicore/clock';
import {
  requireNomicoreInstance,
  type Instance,
} from '@nomicore/instance';
import { requireNomicoreRegistry } from '@nomicore/namespace-registry';
import { createHubReplication } from './hub-connection.js';
import { createPeerReplication } from './peer-connection.js';
import type {
  DuplexTransport,
  HubReplication,
  NamespaceAuthorizer,
  PeerConnectionState,
  PeerNamespaceState,
  PeerReplication,
  PeerTokenVerifier,
  ReplicationBackoff,
  ReplicationLimits,
  ReplicationObserver,
  ReplicationTarget,
  ReplicationTimeouts,
  UpgradeIdentity,
} from './types.js';

export const NOMICORE_HUB_REPLICATION_SERVICE = 'nomicoreHubReplication' as const;
export const NOMICORE_PEER_REPLICATION_SERVICE = 'nomicorePeerReplication' as const;

export interface HubReplicationStatus {
  readonly state: 'ready' | 'stopped';
  readonly connections: number;
}

export interface HubReplicationService {
  readonly status: HubReplicationStatus;
  requestReauth(instanceId: string): Promise<void>;
  /** Explicitly drain listener/connections without touching upstream services. */
  stop(): Promise<void>;
}

export interface PeerReplicationStatus {
  readonly state: 'ready' | 'stopped';
  readonly connection: PeerConnectionState;
  getNamespaceState(namespaceId: string): PeerNamespaceState | undefined;
}

export interface PeerReplicationService {
  readonly status: PeerReplicationStatus;
  addTarget(target: ReplicationTarget): void;
  removeTarget(namespaceId: string): Promise<void>;
  notifyAuthChanged(): void;
  waitForLive(namespaceId: string): Promise<void>;
  /** Explicitly drain the dial/controller without touching upstream services. */
  stop(): Promise<void>;
}

export interface HubListener {
  readonly port?: number;
  close(): Promise<void>;
}

export interface HubListenAdapter {
  listen(options: Readonly<{
    host: string;
    port: number;
    path: string;
    authenticate(token: string): Promise<UpgradeIdentity | undefined>;
    accept(transport: DuplexTransport, identity: UpgradeIdentity): void;
  }>): Promise<HubListener>;
}

export interface HubStaticToken {
  readonly token: string;
  readonly instanceId: string;
}

export interface HubStaticAuthorization {
  readonly instanceId: string;
  readonly namespaceId: string;
  readonly localOwner: Readonly<{ userId: string }>;
  readonly read: boolean;
  readonly submit: boolean;
}

export interface HubReplicationPluginConfig {
  readonly listen: Readonly<{ readonly host: string; readonly port: number; readonly path?: string }>;
  readonly tokens?: readonly HubStaticToken[];
  readonly authorization?: readonly HubStaticAuthorization[];
  readonly limits?: Readonly<Partial<ReplicationLimits>>;
  readonly timeouts?: Readonly<Partial<ReplicationTimeouts>>;
}

export interface HubReplicationPluginOverrides {
  readonly verifyToken?: PeerTokenVerifier;
  readonly authorize?: NamespaceAuthorizer;
  readonly listen?: HubListenAdapter;
  readonly observer?: ReplicationObserver;
  /** Whole static collection replacement; undefined keeps config tokens. */
  readonly tokens?: readonly HubStaticToken[];
  /** Whole static collection replacement; undefined keeps config authorization. */
  readonly authorization?: readonly HubStaticAuthorization[];
  readonly limits?: Readonly<Partial<ReplicationLimits>>;
  readonly timeouts?: Readonly<Partial<ReplicationTimeouts>>;
}

export interface PeerDialAdapterFactoryOptions {
  readonly hubUrl: string;
  readonly token: string;
}

/** Portable seam for hosts that can turn a URL and credential into a transport dialer. */
export type PeerDialAdapterFactory = (
  options: PeerDialAdapterFactoryOptions,
) => () => DuplexTransport;

export interface PeerReplicationPluginConfig {
  readonly expectedHubInstanceId: string;
  readonly hubUrl?: string;
  readonly token?: string;
  readonly targets?: readonly ReplicationTarget[];
  readonly limits?: Readonly<Partial<ReplicationLimits>>;
  readonly timeouts?: Readonly<Partial<ReplicationTimeouts>>;
  readonly backoff?: Readonly<Partial<ReplicationBackoff>>;
}

export interface PeerReplicationPluginOverrides {
  readonly dial?: () => DuplexTransport;
  readonly createDial?: PeerDialAdapterFactory;
  readonly observer?: ReplicationObserver;
  readonly random?: () => number;
  readonly deferTask?: (task: () => void) => void;
  /** Whole initial-target collection replacement; undefined keeps config targets. */
  readonly targets?: readonly ReplicationTarget[];
  readonly limits?: Readonly<Partial<ReplicationLimits>>;
  readonly timeouts?: Readonly<Partial<ReplicationTimeouts>>;
  readonly backoff?: Readonly<Partial<ReplicationBackoff>>;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    nomicoreHubReplication: HubReplicationService;
    nomicorePeerReplication: PeerReplicationService;
  }
}

const HUB_CONFIG_KEYS = new Set(['listen', 'tokens', 'authorization', 'limits', 'timeouts']);
const PEER_CONFIG_KEYS = new Set(['expectedHubInstanceId', 'hubUrl', 'token', 'targets', 'limits', 'timeouts', 'backoff']);
const HUB_OVERRIDE_KEYS = new Set(['verifyToken', 'authorize', 'listen', 'observer', 'tokens', 'authorization', 'limits', 'timeouts']);
const PEER_OVERRIDE_KEYS = new Set(['dial', 'createDial', 'observer', 'random', 'deferTask', 'targets', 'limits', 'timeouts', 'backoff']);
const LIMIT_KEYS = new Set(['maxFrameBytes', 'maxBootstrapBytes', 'maxSyncDiffBytes', 'maxUpdateBytes', 'maxQueuedUpdateBytes', 'maxQueuedUpdateCount', 'maxInFlightUpdates', 'maxQueuedBytesPerConnection', 'lowWater', 'highWater', 'maxQueuedControlBytes']);
const TIMEOUT_KEYS = new Set(['helloTimeoutMs', 'openTimeoutMs', 'bootstrapTimeoutMs', 'reconcileTimeoutMs', 'reconcileIntervalMs', 'closeTimeoutMs', 'ackTimeoutMs', 'pingIntervalMs', 'pongTimeoutMs']);
const BACKOFF_KEYS = new Set(['baseMs', 'maxMs', 'resetAfterMs']);
const INSTANCE_ID = /^[a-z][a-z0-9-]{0,62}$/;
const NAMESPACE_ID = /^ns-[0-9a-f]{32}$/;

function assertRecord(value: unknown, label: string, keys: ReadonlySet<string>): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !keys.has(key))) {
    throw new TypeError(`${label}: invalid configuration`);
  }
}

function assertRole(identity: Instance, expected: 'hub' | 'peer'): void {
  if (identity.role !== expected) {
    throw new Error(`nomicore ${expected} replication requires instance role "${expected}"`);
  }
}

interface OwnedTimer {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  dispose(): void;
}

function timerFromContext(ctx: Context): OwnedTimer {
  const timer = ctx.get('timer') as {
    ctx?: Context;
    timeout?: unknown;
  } | undefined;
  if (timer === undefined || typeof timer.timeout !== 'function') {
    throw new Error('required Cordis service "timer" is unavailable');
  }
  const root = timer.ctx?.root ?? ctx.root;
  if (typeof root.timeout !== 'function') {
    throw new Error('required Cordis root timer context is unavailable');
  }
  const handles = new Set<() => void>();
  return {
    setTimeout(callback, delayMs) {
      let dispose!: () => void;
      dispose = root.timeout(() => {
        handles.delete(dispose);
        callback();
      }, delayMs);
      handles.add(dispose);
      return dispose;
    },
    clearTimeout(handle) {
      const dispose = handle as () => void;
      handles.delete(dispose);
      dispose();
    },
    dispose() {
      for (const dispose of handles) dispose();
      handles.clear();
    },
  };
}

function mergeNested<T extends object>(base: T | undefined, override: T | undefined): T | undefined {
  if (base === undefined && override === undefined) return undefined;
  return { ...(base ?? {} as T), ...(override ?? {} as T) };
}

function assertOptionalRecord(value: unknown, label: string, keys: ReadonlySet<string>): void {
  if (value !== undefined) assertRecord(value, label, keys);
}

function validateTokens(tokens: unknown): asserts tokens is readonly HubStaticToken[] {
  if (!Array.isArray(tokens)) throw new TypeError('hub replication config: invalid token collection');
  const values = new Set<string>();
  for (const entry of tokens) {
    assertRecord(entry, 'hub replication token entry', new Set(['token', 'instanceId']));
    if (typeof entry.token !== 'string' || entry.token.length === 0
      || typeof entry.instanceId !== 'string' || !INSTANCE_ID.test(entry.instanceId)
      || values.has(entry.token)) {
      throw new TypeError('hub replication config: invalid token entry');
    }
    values.add(entry.token);
  }
}

function validateAuthorization(entries: unknown): asserts entries is readonly HubStaticAuthorization[] {
  if (!Array.isArray(entries)) throw new TypeError('hub replication config: invalid authorization collection');
  const pairs = new Set<string>();
  for (const entry of entries) {
    assertRecord(entry, 'hub replication authorization entry', new Set(['instanceId', 'namespaceId', 'localOwner', 'read', 'submit']));
    assertRecord(entry.localOwner, 'hub replication authorization local owner', new Set(['userId']));
    const pair = `${String(entry.instanceId)}\0${String(entry.namespaceId)}`;
    if (typeof entry.instanceId !== 'string' || !INSTANCE_ID.test(entry.instanceId)
      || typeof entry.namespaceId !== 'string' || !NAMESPACE_ID.test(entry.namespaceId)
      || typeof entry.localOwner.userId !== 'string' || entry.localOwner.userId.length === 0
      || typeof entry.read !== 'boolean' || typeof entry.submit !== 'boolean' || pairs.has(pair)) {
      throw new TypeError('hub replication config: invalid authorization entry');
    }
    pairs.add(pair);
  }
}

function validateTargets(targets: unknown): asserts targets is readonly ReplicationTarget[] {
  if (!Array.isArray(targets)) throw new TypeError('peer replication config: invalid target collection');
  const ids = new Set<string>();
  for (const entry of targets) {
    assertRecord(entry, 'peer replication target', new Set(['namespaceId', 'localOwner']));
    assertRecord(entry.localOwner, 'peer replication target local owner', new Set(['userId']));
    if (typeof entry.namespaceId !== 'string' || !NAMESPACE_ID.test(entry.namespaceId)
      || typeof entry.localOwner.userId !== 'string' || entry.localOwner.userId.length === 0
      || ids.has(entry.namespaceId)) {
      throw new TypeError('peer replication config: invalid target');
    }
    ids.add(entry.namespaceId);
  }
}

function staticVerifier(tokens: readonly HubStaticToken[]): PeerTokenVerifier {
  const table = new Map(tokens.map((entry) => [entry.token, entry.instanceId] as const));
  return async (token) => {
    const instanceId = table.get(token);
    return instanceId === undefined ? { ok: false } : { ok: true, instanceId };
  };
}

function staticAuthorizer(entries: readonly HubStaticAuthorization[]): NamespaceAuthorizer {
  const table = new Map(entries.map((entry) => [`${entry.instanceId}\0${entry.namespaceId}`, entry] as const));
  return async (instanceId, namespaceId) => {
    const entry = table.get(`${instanceId}\0${namespaceId}`);
    return entry === undefined ? { ok: false } : {
      ok: true,
      localOwner: entry.localOwner,
      permissions: { read: entry.read, submit: entry.submit },
    };
  };
}

function validateHubConfig(config: HubReplicationPluginConfig, overrides: HubReplicationPluginOverrides): void {
  assertRecord(config, 'hub replication config', HUB_CONFIG_KEYS);
  assertRecord(overrides, 'hub replication overrides', HUB_OVERRIDE_KEYS);
  assertRecord(config.listen, 'hub replication listen', new Set(['host', 'port', 'path']));
  if (typeof config.listen.host !== 'string' || config.listen.host.length === 0
    || !Number.isInteger(config.listen.port) || config.listen.port < 0 || config.listen.port > 65535
    || (config.listen.path !== undefined && (typeof config.listen.path !== 'string' || !config.listen.path.startsWith('/')))) {
    throw new TypeError('hub replication config: invalid listen settings');
  }
  if (overrides.listen === undefined) throw new TypeError('hub replication config: listen adapter is required');
  const tokens = overrides.tokens ?? config.tokens;
  const authorization = overrides.authorization ?? config.authorization;
  if (overrides.verifyToken === undefined && tokens === undefined) throw new TypeError('hub replication config: authentication is required');
  if (overrides.authorize === undefined && authorization === undefined) throw new TypeError('hub replication config: authorization is required');
  if (tokens !== undefined) validateTokens(tokens);
  if (authorization !== undefined) validateAuthorization(authorization);
  assertOptionalRecord(config.limits, 'hub replication limits', LIMIT_KEYS);
  assertOptionalRecord(overrides.limits, 'hub replication override limits', LIMIT_KEYS);
  assertOptionalRecord(config.timeouts, 'hub replication timeouts', TIMEOUT_KEYS);
  assertOptionalRecord(overrides.timeouts, 'hub replication override timeouts', TIMEOUT_KEYS);
  if (overrides.verifyToken !== undefined && typeof overrides.verifyToken !== 'function') throw new TypeError('hub replication overrides: invalid verifier adapter');
  if (overrides.authorize !== undefined && typeof overrides.authorize !== 'function') throw new TypeError('hub replication overrides: invalid authorization adapter');
  if (overrides.listen === null || typeof overrides.listen !== 'object'
    || typeof (overrides.listen as { listen?: unknown }).listen !== 'function') {
    throw new TypeError('hub replication overrides: invalid listen adapter');
  }
  if (overrides.observer !== undefined && typeof overrides.observer !== 'function') throw new TypeError('hub replication overrides: invalid observer adapter');
}

function validatePeerConfig(config: PeerReplicationPluginConfig, overrides: PeerReplicationPluginOverrides): void {
  assertRecord(config, 'peer replication config', PEER_CONFIG_KEYS);
  assertRecord(overrides, 'peer replication overrides', PEER_OVERRIDE_KEYS);
  if (typeof config.expectedHubInstanceId !== 'string' || !INSTANCE_ID.test(config.expectedHubInstanceId)) throw new TypeError('peer replication config: invalid expected hub instance id');
  if (config.hubUrl !== undefined && (typeof config.hubUrl !== 'string' || !/^wss?:\/\//.test(config.hubUrl))) throw new TypeError('peer replication config: invalid hub URL');
  if (config.token !== undefined && (typeof config.token !== 'string' || config.token.length === 0)) throw new TypeError('peer replication config: invalid credential');
  const hasStaticDial = config.hubUrl !== undefined || config.token !== undefined;
  if (hasStaticDial && (config.hubUrl === undefined || config.token === undefined)) throw new TypeError('peer replication config: hub URL and credential must be provided together');
  if (overrides.dial !== undefined && typeof overrides.dial !== 'function') throw new TypeError('peer replication overrides: invalid dial adapter');
  if (overrides.createDial !== undefined && typeof overrides.createDial !== 'function') throw new TypeError('peer replication overrides: invalid dial factory');
  if (overrides.dial !== undefined && overrides.createDial !== undefined) throw new TypeError('peer replication config: choose one dial adapter');
  if (overrides.dial === undefined && (!hasStaticDial || overrides.createDial === undefined)) throw new TypeError('peer replication config: provide dial or static hubUrl/token with createDial');
  const targets = overrides.targets ?? config.targets;
  if (targets !== undefined) validateTargets(targets);
  assertOptionalRecord(config.limits, 'peer replication limits', LIMIT_KEYS);
  assertOptionalRecord(overrides.limits, 'peer replication override limits', LIMIT_KEYS);
  assertOptionalRecord(config.timeouts, 'peer replication timeouts', TIMEOUT_KEYS);
  assertOptionalRecord(overrides.timeouts, 'peer replication override timeouts', TIMEOUT_KEYS);
  assertOptionalRecord(config.backoff, 'peer replication backoff', BACKOFF_KEYS);
  assertOptionalRecord(overrides.backoff, 'peer replication override backoff', BACKOFF_KEYS);
  if (overrides.observer !== undefined && typeof overrides.observer !== 'function') throw new TypeError('peer replication overrides: invalid observer adapter');
  if (overrides.random !== undefined && typeof overrides.random !== 'function') throw new TypeError('peer replication overrides: invalid random adapter');
  if (overrides.deferTask !== undefined && typeof overrides.deferTask !== 'function') throw new TypeError('peer replication overrides: invalid defer adapter');
}

export function requireHubReplication(ctx: Context): HubReplicationService {
  const service = ctx.get(NOMICORE_HUB_REPLICATION_SERVICE);
  if (service === undefined) throw new Error('required Cordis service "nomicoreHubReplication" is unavailable');
  return service;
}

export function requirePeerReplication(ctx: Context): PeerReplicationService {
  const service = ctx.get(NOMICORE_PEER_REPLICATION_SERVICE);
  if (service === undefined) throw new Error('required Cordis service "nomicorePeerReplication" is unavailable');
  return service;
}

export function createHubReplicationPlugin(
  config: HubReplicationPluginConfig,
  overrides: HubReplicationPluginOverrides = {},
) {
  validateHubConfig(config, overrides);
  const limits = mergeNested(config.limits, overrides.limits);
  const timeouts = mergeNested(config.timeouts, overrides.timeouts);
  const verifyToken = overrides.verifyToken ?? staticVerifier(overrides.tokens ?? config.tokens ?? []);
  const authorize = overrides.authorize ?? staticAuthorizer(overrides.authorization ?? config.authorization ?? []);
  const listen = overrides.listen!;
  let replication: HubReplication | undefined;
  let listener: HubListener | undefined;
  let stopPromise: Promise<void> | undefined;
  let stopped = false;
  return {
    inject: ['nomicoreInstance', 'clock', 'timer', 'nomicoreRegistry'],
    apply(ctx: Context): void | Promise<void> {
      const identity = requireNomicoreInstance(ctx);
      assertRole(identity, 'hub');
      const clock = requireClock(ctx);
      const registry = requireNomicoreRegistry(ctx);
      const timer = timerFromContext(ctx);
      return start(ctx, identity, clock, registry, timer);
    },
    get replication(): HubReplication | undefined { return replication; },
    get listener(): HubListener | undefined { return listener; },
  };

  async function start(
    ctx: Context,
    identity: Instance,
    clock: Readonly<{ now(): number }>,
    registry: ReturnType<typeof requireNomicoreRegistry>,
    timer: ReturnType<typeof timerFromContext>,
  ): Promise<void> {
      replication = createHubReplication({
        instanceId: identity.instanceId,
        registry,
        authorize,
        verifyToken,
        timer,
        clock: { now: () => clock.now() },
        ...(limits === undefined ? {} : { limits }),
        ...(timeouts === undefined ? {} : { timeouts }),
        ...(overrides.observer === undefined ? {} : { observer: overrides.observer }),
      });
      const acceptTrusted = replication.acceptTrusted;
      if (acceptTrusted === undefined) throw new Error('hub replication trusted upgrade support is unavailable');
      try {
        listener = await listen.listen({
          host: config.listen.host,
          port: config.listen.port,
          path: config.listen.path ?? '/replication',
          authenticate: async (token) => {
            const result = await verifyToken(token);
            return result.ok ? { peerInstanceId: result.instanceId } : undefined;
          },
          accept: (transport, trustedIdentity) => { void acceptTrusted.call(replication, transport, trustedIdentity); },
        });
      } catch {
        await replication.close();
        replication = undefined;
        throw new Error('nomicore hub replication failed to start');
      }
      const stop = (): Promise<void> => stopPromise ??= (async () => {
        stopped = true;
        try {
          try { await listener?.close(); } finally { await replication?.close(); }
        } finally {
          timer.dispose();
          listener = undefined;
          replication = undefined;
        }
      })();
      const service: HubReplicationService = Object.freeze({
        get status(): HubReplicationStatus {
          return { state: stopped ? 'stopped' : 'ready', connections: replication?.connections.length ?? 0 };
        },
        requestReauth: (instanceId: string) => replication?.requestReauth(instanceId) ?? Promise.resolve(),
        stop,
      });
      ctx.effect(function* () {
        // Re-parent the provide disposer into this ordered effect. Cordis then runs
        // [stop, revoke] in reverse-yield order, keeping the service during drain.
        const revoke = ctx.provide(NOMICORE_HUB_REPLICATION_SERVICE, service);
        yield revoke;
        yield stop;
      }, 'ws-replication: hub service');
  }
}

export function createPeerReplicationPlugin(
  config: PeerReplicationPluginConfig,
  overrides: PeerReplicationPluginOverrides = {},
) {
  validatePeerConfig(config, overrides);
  const limits = mergeNested(config.limits, overrides.limits);
  const timeouts = mergeNested(config.timeouts, overrides.timeouts);
  const backoff = mergeNested(config.backoff, overrides.backoff);
  const targets = overrides.targets ?? config.targets ?? [];
  const dial = overrides.dial ?? overrides.createDial!({ hubUrl: config.hubUrl!, token: config.token! });
  if (typeof dial !== 'function') throw new TypeError('peer replication config: dial factory returned an invalid adapter');
  let replication: PeerReplication | undefined;
  let stopPromise: Promise<void> | undefined;
  let stopped = false;
  const liveWaits = new Set<{
    handle: unknown;
    reject(error: Error): void;
  }>();
  return {
    inject: ['nomicoreInstance', 'clock', 'timer', 'nomicoreRegistry'],
    apply(ctx: Context): void | Promise<void> {
      const identity = requireNomicoreInstance(ctx);
      assertRole(identity, 'peer');
      const clock = requireClock(ctx);
      const registry = requireNomicoreRegistry(ctx);
      const timer = timerFromContext(ctx);
      replication = createPeerReplication({
        instanceId: identity.instanceId,
        hubInstanceId: config.expectedHubInstanceId,
        registry,
        dial,
        timer,
        targets,
        clock: { now: () => clock.now() },
        ...(limits === undefined ? {} : { limits }),
        ...(timeouts === undefined ? {} : { timeouts }),
        ...(backoff === undefined ? {} : { backoff }),
        ...(overrides.observer === undefined ? {} : { observer: overrides.observer }),
        ...(overrides.random === undefined ? {} : { random: overrides.random }),
        ...(overrides.deferTask === undefined ? {} : { deferTask: overrides.deferTask }),
      });
      replication.start();
      const stop = (): Promise<void> => stopPromise ??= (async () => {
        stopped = true;
        try {
          for (const wait of [...liveWaits]) {
            timer.clearTimeout(wait.handle);
            wait.reject(new Error('peer replication stopped'));
          }
          await replication?.stop();
        } finally {
          timer.dispose();
          replication = undefined;
        }
      })();
      const service: PeerReplicationService = Object.freeze({
        get status(): PeerReplicationStatus {
          const current = replication;
          return {
            state: stopped ? 'stopped' : 'ready',
            connection: current?.getConnectionState() ?? 'stopped',
            getNamespaceState: (namespaceId) => current?.getNamespaceState(namespaceId),
          };
        },
        addTarget: (target: ReplicationTarget) => replication?.addTarget(target),
        removeTarget: (namespaceId: string) => replication?.removeTarget(namespaceId) ?? Promise.resolve(),
        notifyAuthChanged: () => replication?.notifyAuthChanged(),
        waitForLive: (namespaceId: string) => new Promise<void>((resolve, reject) => {
          let settled = false;
          const wait = {
            handle: undefined as unknown,
            reject: (error: Error): void => settle(() => reject(error)),
          };
          const settle = (complete: () => void): void => {
            if (settled) return;
            settled = true;
            if (liveWaits.delete(wait)) timer.clearTimeout(wait.handle);
            complete();
          };
          const check = (): void => {
            const current = replication;
            if (current === undefined || stopped) { wait.reject(new Error('peer replication stopped')); return; }
            if (current.getNamespaceState(namespaceId) === 'live') { settle(resolve); return; }
            wait.handle = timer.setTimeout(check, 25);
            liveWaits.add(wait);
          };
          check();
        }),
        stop,
      });
      ctx.effect(function* () {
        // Re-parent provide so reverse-yield disposal drains before revocation.
        const revoke = ctx.provide(NOMICORE_PEER_REPLICATION_SERVICE, service);
        yield revoke;
        yield stop;
      }, 'ws-replication: peer service');
    },
    get replication(): PeerReplication | undefined { return replication; },
  };
}

/**
 * `createNomicoreApp` —— 最小 Cordis composition root（设计 §3.1/§3.4/§3.6）。
 *
 * 装配序（严格按 hosting 文档 L51-73）：clock fiber → `new TimerService(ctx)` →
 * persistence fiber（memory|file 按 config）→ registry fiber（**显式传 `role`，
 * 与部署角色一致**）→ hub/peer 复制插件（`inject ['nomicoreRegistry','clock']`
 * 使其 fiber 位于依赖图下游 → 卸载时先于 registry fiber）。
 *
 * 启动序（R1 #2 冻结：**绑定先于接纳**，§3.4）：fiber 组装完成、registry ready
 * 之后，先执行 provisioning + 授权绑定表构建（直引条目启动即绑定；provision 条目
 * 在 provision 完成时刻绑定），**完成后才** `httpServer.listen()`（hub）/
 * `peer.start()`（peer）——任何网络端点开启之前授权查找已完备（硬崩溃 backoff
 * 重拨/首拨/显式恢复重拨命中 boot 窗口时，authorize 不可能 miss）。
 *
 * 停机（§3.6 单一拆卸链）：宿主显式执行复制 drain → registry shutdown →
 * persistence dispose → timer/clock teardown；复制插件不另注册重复 disposer；
 * `stop()` 幂等（single-flight promise）。
 */
import { Context } from '@deepseek-ai/cordis';
import TimerService from '@deepseek-ai/cordis-plugin-timer';
import { createSystemClockPlugin } from '@nomicore/clock';
import { createInstancePlugin } from '@nomicore/instance';
import {
  createFilePersistencePlugin,
  createMemoryPersistencePlugin,
} from '@nomicore/persistence';
import {
  createNamespaceRegistryPlugin,
  requireNomicoreRegistry,
  type NamespaceLease,
  type NamespaceRegistry,
  type ResetReplicaResult,
} from '@nomicore/namespace-registry';
import {
  createHubReplicationPlugin,
  createPeerReplicationPlugin,
  requireHubReplication,
  requirePeerReplication,
  type HubListenAdapter,
  type HubReplicationService,
  type NamespaceAuthorizer,
  type NamespaceAuthorization,
  type PeerReplicationService,
  type PeerTokenVerifier,
  type ReplicationObserver,
} from '@nomicore/ws-replication';
import {
  parseAppConfig,
  NAMESPACE_ID_PATTERN,
  type AppConfig,
  type AuthorizationEntry,
} from './config.js';
import { createStdoutEventSink, type EventSink } from './lifecycle.js';
import { createPeerDial } from './transport/ws-client.js';
import { createHubListenAdapter } from './transport/ws-server.js';

const OP_TIMEOUT_DEFAULT_MS = 30_000;
const OP_TIMEOUT_MIN_MS = 1;
const OP_TIMEOUT_MAX_MS = 120_000;
const READ_READY_TIMEOUT_MS = 10_000;
const LIVE_POLL_INTERVAL_MS = 100;
/** open 物化等待重试间隔（F1：本地记录未物化时的 `NAMESPACE_NOT_FOUND` 重试）。 */
const OPEN_RETRY_INTERVAL_MS = 50;
/** file adapter 缺省 flush 上限（persistence DEFAULT_PERSISTENCE_SCHEDULE.maxDirtyMs）。 */
const DEFAULT_MAX_DIRTY_MS = 5_000;
/** 调空窗口边距（flush 提交的保守余量）。 */
const DRAIN_MARGIN_MS = 500;
/** peer 侧 closeTimeoutMs 缺省（ws-replication defaults.ts:38；app 不 import 包内部缺省）。 */
const DEFAULT_PEER_CLOSE_TIMEOUT_MS = 5_000;
/** reset 编排 controller 收口结算预算的边距（closeTimeout 兜底之外的保守余量）。 */
const RESET_SETTLE_MARGIN_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSegmentArray(value: unknown): value is readonly (string | number)[] {
  return Array.isArray(value) && value.every((s) => typeof s === 'string' || typeof s === 'number');
}

interface Binding {
  readonly ownerUserId: string;
  readonly read: boolean;
  readonly submit: boolean;
}

/** `opVerifyWrite` 的 open 三态结果（F1 有界物化等待）。 */
type WriteOpenResult =
  | Readonly<{ kind: 'ok'; lease: NamespaceLease }>
  | Readonly<{ kind: 'timeout' }>
  | Readonly<{ kind: 'rejected' }>;

export interface NomicoreApp {
  /** 启动完成（`ready` 事件已发射）；失败 → reject（对应 error 事件已发射）。 */
  readonly ready: Promise<void>;
  /** 单一拆卸链有序停机；幂等。 */
  stop(): Promise<void>;
  /** stdout NDJSON 事件面（进程内宿主测试用）。 */
  readonly sink: EventSink;
  /** stdin NDJSON 控制通道：输入一行，回执一行（每行恰一回执；进程不因控制输入退出）。 */
  handleControlLine(line: string): Promise<Readonly<Record<string, unknown>> | undefined>;
}

export interface CreateNomicoreAppOptions {
  readonly emitter?: EventSink;
}

export function createNomicoreApp(
  rawConfig: unknown,
  options: CreateNomicoreAppOptions = {},
): NomicoreApp {
  const config = parseAppConfig(rawConfig);
  const sink = options.emitter ?? createStdoutEventSink();
  return new AppHandle(config, sink).publicFace();
}

class AppHandle {
  private readonly ctx: Context;
  private readonly config: AppConfig;
  private readonly sink: EventSink;
  private readonly bindings = new Map<string, Binding>();
  private readonly knownNamespaces = new Map<string, string>(); // nsId → ownerUserId（hub 侧）
  private readonly peerOwners = new Map<string, string>(); // nsId → ownerUserId（peer 侧）

  private registry: NamespaceRegistry | undefined;
  private persistenceFiber: { dispose(): Promise<unknown> } | undefined;
  private hubService: HubReplicationService | undefined;
  private peerService: PeerReplicationService | undefined;
  private hubListener: Awaited<ReturnType<HubListenAdapter['listen']>> | undefined;

  private stopPromise: Promise<void> | undefined;
  private bootPromise: Promise<void> | undefined;
  /** 停机请求标志：boot 在每个 await 边界检查——停机中的 boot 静默取消（不抛
   *  未处理拒绝；SIGTERM 落在 boot 窗口 ⇒ 干净 exit 0 而非 boot 失败 exit 1）。 */
  private stopRequested = false;

  constructor(config: AppConfig, sink: EventSink) {
    this.config = config;
    this.sink = sink;
    this.ctx = new Context();
  }

  publicFace(): NomicoreApp {
    const handle = this;
    return {
      ready: (this.bootPromise ??= this.boot()),
      stop: () => handle.stop(),
      get sink() {
        return handle.sink;
      },
      handleControlLine: (line: string) => handle.handleControlLine(line),
    };
  }

  private get role(): 'hub' | 'peer' {
    return this.config.role;
  }

  // ─────────────────────────────── 观测 ───────────────────────────────

  /** 复制域事件：包判别联合 → NDJSON（type 字段改名为 event；其余字段直通——包已脱敏）。 */
  private readonly observer: ReplicationObserver = (event) => {
    const { type, ...rest } = event;
    this.sink({ event: type, ...rest });
  };

  // ─────────────────────────────── 启动 ───────────────────────────────

  private async boot(): Promise<void> {
    const ctx = this.ctx;
    createInstancePlugin().apply(ctx, {
      instanceId: this.config.instanceId,
      role: this.config.role,
    });
    const clockFiber = ctx.plugin(createSystemClockPlugin());
    await clockFiber;
    if (this.stopRequested) return;
    new TimerService(ctx);
    const persistenceFiber =
      this.config.persistence.kind === 'file'
        ? ctx.plugin(
            createFilePersistencePlugin({
              rootDir: this.config.persistence.rootDir,
              ...(this.config.persistence.schedule !== undefined
                ? { schedule: this.config.persistence.schedule }
                : {}),
            }),
          )
        : ctx.plugin(createMemoryPersistencePlugin());
    this.persistenceFiber = persistenceFiber;
    await persistenceFiber;
    if (this.stopRequested) return;
    const registryFiber = ctx.plugin(
      createNamespaceRegistryPlugin({
        ...(this.config.idleTimeoutMs !== undefined ? { idleTimeoutMs: this.config.idleTimeoutMs } : {}),
      }),
    );
    await registryFiber;
    if (this.stopRequested) return;
    this.registry = requireNomicoreRegistry(ctx);
    if (this.role === 'hub') {
      await this.bootHub();
    } else {
      await this.bootPeer();
    }
  }

  private async bootHub(): Promise<void> {
    const hubConfig = this.config.hub;
    if (hubConfig === undefined) throw new Error('hub config missing (validated)');
    // ── 授权绑定表：直引条目启动即绑定（localOwner 唯一来源 = ownerUserId）──
    if (hubConfig.authorization !== undefined) {
      for (const entry of hubConfig.authorization) {
        if ('namespaceId' in entry) {
          this.bindings.set(`${entry.peerInstanceId}\u0000${entry.namespaceId}`, {
            ownerUserId: entry.ownerUserId,
            read: entry.read,
            submit: entry.submit,
          });
          this.knownNamespaces.set(entry.namespaceId, entry.ownerUserId);
        }
      }
    }
    const tokenToPeer = new Map<string, string>();
    for (const [peerInstanceId, token] of Object.entries(hubConfig.tokens)) {
      tokenToPeer.set(token, peerInstanceId);
    }
    const verifyToken: PeerTokenVerifier = async (token) => {
      const peerInstanceId = tokenToPeer.get(token);
      return peerInstanceId !== undefined ? { ok: true, instanceId: peerInstanceId } : { ok: false };
    };
    const authorize: NamespaceAuthorizer = async (instanceIdentity, namespaceId): Promise<NamespaceAuthorization> => {
      const binding = this.bindings.get(`${instanceIdentity}\u0000${namespaceId}`);
      if (binding === undefined) return { ok: false };
      return {
        ok: true,
        localOwner: { userId: binding.ownerUserId },
        permissions: { read: binding.read, submit: binding.submit },
      };
    };
    // ── provisioning（NDJSON `provisioned(×N)` — 先于 listen；失败 → 事件 + loud）──
    if (hubConfig.provision !== undefined) {
      for (const entry of hubConfig.provision) {
        if (this.stopRequested) return;
        await this.provision(entry.id, entry.ownerUserId, entry.schema, entry.root, hubConfig.authorization);
      }
    }
    if (this.stopRequested) return;

    // Package plugin owns the listener/controller, but is not installed until every
    // provision-derived authorization binding is complete.
    const listenAdapter = createHubListenAdapter();
    const hubPlugin = createHubReplicationPlugin(
      {
        listen: {
          host: hubConfig.listen.host,
          port: hubConfig.listen.port,
          path: '/replication',
        },
        ...(this.config.limits !== undefined ? { limits: this.config.limits } : {}),
        ...(this.config.timeouts !== undefined ? { timeouts: this.config.timeouts } : {}),
      },
      {
        verifyToken,
        authorize,
        listen: listenAdapter,
        observer: this.observer,
      },
    );
    await this.ctx.plugin(hubPlugin);
    if (this.stopRequested) return;

    this.hubService = requireHubReplication(this.ctx);
    this.hubListener = listenAdapter.listener;
    if (this.hubListener === undefined) throw new Error('hub listener unavailable after plugin startup');
    if (this.stopRequested) return;
    this.sink({ event: 'listening', host: hubConfig.listen.host, port: this.hubListener.port ?? hubConfig.listen.port });
    this.sink({ event: 'ready', role: this.role, instanceId: this.config.instanceId });
  }

  /** 单条目 provision：create → enableReplication → release；失败 → `provision-failed` 事件 + loud throw。 */
  private async provision(
    provisionId: string,
    ownerUserId: string,
    schema: unknown,
    root: unknown,
    authorization: readonly AuthorizationEntry[] | undefined,
  ): Promise<void> {
    const registry = this.registry;
    if (registry === undefined) throw new Error('registry unavailable (provision before ready)');
    const created = await registry.create({ owner: { userId: ownerUserId }, schema, root });
    if (!created.ok) {
      this.sink({ event: 'provision-failed', provisionId, code: 'PROVISION_CREATE_REJECTED' });
      throw new Error(`provision "${provisionId}" rejected by registry.create: ${created.code}`);
    }
    const lease = created.lease;
    try {
      const enabled = await lease.enableReplication();
      if (!enabled.ok) {
        this.sink({ event: 'provision-failed', provisionId, code: 'PROVISION_REPLICATION_REJECTED' });
        throw new Error(`provision "${provisionId}": enableReplication rejected`);
      }
      const namespaceId = lease.namespaceId;
      this.knownNamespaces.set(namespaceId, ownerUserId);
      // provision 形式的授权条目此刻绑定（owner 唯一来源 = provision.ownerUserId）。
      if (authorization !== undefined) {
        for (const entry of authorization) {
          if ('provisionId' in entry && entry.provisionId === provisionId) {
            this.bindings.set(`${entry.peerInstanceId}\u0000${namespaceId}`, {
              ownerUserId,
              read: entry.read,
              submit: entry.submit,
            });
          }
        }
      }
      const status = lease.getStatus();
      const replicationId =
        status.lease === 'active' && status.runtime.replication.state === 'enabled'
          ? status.runtime.replication.replicationId
          : undefined;
      await lease.release();
      this.sink({
        event: 'provisioned',
        provisionId,
        namespaceId,
        ...(replicationId !== undefined ? { replicationId } : {}),
      });
    } catch (error) {
      await lease.release().catch(() => {
        // release 幂等；失败不掩盖原始 provision 错误。
      });
      throw error;
    }
  }

  private async bootPeer(): Promise<void> {
    const peerConfig = this.config.peer;
    if (peerConfig === undefined) throw new Error('peer config missing (validated)');
    const peerPlugin = createPeerReplicationPlugin(
      {
        expectedHubInstanceId: peerConfig.hub.hubInstanceId,
        hubUrl: peerConfig.hub.url,
        token: peerConfig.hub.token,
        ...(peerConfig.targets !== undefined
          ? {
              targets: peerConfig.targets.map((t) => ({
                namespaceId: t.namespaceId,
                localOwner: { userId: t.ownerUserId },
              })),
            }
          : {}),
        ...(this.config.limits !== undefined ? { limits: this.config.limits } : {}),
        ...(this.config.timeouts !== undefined ? { timeouts: this.config.timeouts } : {}),
        ...(this.config.backoff !== undefined ? { backoff: this.config.backoff } : {}),
      },
      {
        createDial: ({ hubUrl, token }) => createPeerDial(hubUrl, token),
        observer: this.observer,
      },
    );
    await this.ctx.plugin(peerPlugin);
    if (this.stopRequested) return;
    this.peerService = requirePeerReplication(this.ctx);
    for (const target of peerConfig.targets ?? []) {
      this.peerOwners.set(target.namespaceId, target.ownerUserId);
    }
    if (this.stopRequested) return;
    this.sink({ event: 'ready', role: this.role, instanceId: this.config.instanceId });
  }

  // ─────────────────────────────── 停机 ───────────────────────────────

  stop(): Promise<void> {
    if (this.stopPromise !== undefined) return this.stopPromise;
    this.stopRequested = true;
    this.stopPromise = this.performStop();
    return this.stopPromise;
  }

  private async performStop(): Promise<void> {
    try {
      // 1. 停止接纳 + 复制 drain（设计 §3.6：GOAWAY → drain → deadline 后 WS 1001）。
      if (this.hubListener !== undefined) {
        await this.hubListener.close();
      }
      if (this.hubService !== undefined) {
        await this.hubService.stop();
      }
      if (this.peerService !== undefined) {
        await this.peerService.stop();
      }
      this.sink({ event: 'replication-drained' });
      // 2. registry shutdown（lease release、已接纳 apply 排空、idle runtime 回收）。
      if (this.registry !== undefined) {
        await this.registry.shutdown();
      }
      this.sink({ event: 'registry-stopped' });
      // 3. persistence fiber 卸载前：给 file adapter 的排空窗口——adapter 的 dirty
      // flush 走 debounce 调度（saveDoc → maxDirtyMs 内保证提交；dispose() 只
      // abort+destroy，**不冲刷 dirty**，file.ts:27「dispose and drain first」）。
      // registry.shutdown 后立即拆 fiber 会把停机前最后写入（如 provision 的
      // enableReplication META）丢弃——先等调度窗（maxDirtyMs + 边距）落盘。
      if (this.config.persistence.kind === 'file') {
        const drainMs = (this.config.persistence.schedule?.maxDirtyMs ?? DEFAULT_MAX_DIRTY_MS) + DRAIN_MARGIN_MS;
        await sleep(drainMs);
      }
      // 3b. persistence fiber 卸载（撤服务 → 级联依赖 fiber 卸载 → adapter dispose 落盘）。
      if (this.persistenceFiber !== undefined) {
        await this.persistenceFiber.dispose();
      }
      this.sink({ event: 'persistence-disposed' });
      // 4. 根 fiber dispose（Timer/Clock 最后）。
      await this.ctx.fiber.dispose();
      this.sink({ event: 'app-stopped' });
    } catch (error) {
      this.sink({
        event: 'app-stop-failed',
        ...(error instanceof Error ? { message: error.message } : { message: String(error) }),
      });
      throw error;
    }
  }

  // ─────────────────────────────── 控制通道 ───────────────────────────────

  /** stdin NDJSON 控制通道：每行恰一回执；进程绝不因控制输入退出。 */
  async handleControlLine(line: string): Promise<Readonly<Record<string, unknown>> | undefined> {
    if (line.trim() === '') {
      return { event: 'reply', ok: false, code: 'malformed-line' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return { event: 'reply', ok: false, code: 'malformed-line' };
    }
    if (!isPlainObject(parsed) || typeof parsed.op !== 'string') {
      return { event: 'reply', ok: false, code: 'malformed-line' };
    }
    const op = parsed.op;
    const id = parsed.id;
    const result = await this.dispatch(op, parsed);
    return {
      event: 'reply',
      op,
      ...(id !== undefined ? { id } : {}),
      ...result,
    };
  }

  private async dispatch(op: string, args: Record<string, unknown>): Promise<Readonly<Record<string, unknown>>> {
    switch (op) {
      case 'status':
        return {
          ok: true,
          role: this.role,
          instanceId: this.config.instanceId,
          ...(this.peerService !== undefined ? { connectionState: this.peerService.status.connection } : {}),
        };
      case 'shutdown':
        return { ok: true }; // main.ts 在回执发射后执行有序停机
      case 'read':
        return this.opRead(args);
      case 'verify-write':
        return this.opVerifyWrite(args);
      case 'add-target':
        return this.opAddTarget(args);
      case 'remove-target':
        return this.opRemoveTarget(args);
      case 'notify-auth-changed':
        return this.opNotifyAuthChanged();
      case 'request-reauth':
        return this.opRequestReauth(args);
      case 'replace-schema':
        return this.opReplaceSchema(args);
      case 'bump-epoch':
        return this.opBumpEpoch(args);
      case 'reset-replica':
        return this.opResetReplica(args);
      default:
        return { ok: false, code: 'unknown-op' };
    }
  }

  private async opRead(args: Record<string, unknown>): Promise<Readonly<Record<string, unknown>>> {
    const { namespaceId, path } = args;
    if (typeof namespaceId !== 'string' || !NAMESPACE_ID_PATTERN.test(namespaceId) || !isSegmentArray(path)) {
      return { ok: false, code: 'invalid-op-args' };
    }
    if (this.registry === undefined) return { ok: false, code: 'namespace-unknown' };
    const ownerUserId = this.knownOwner(namespaceId);
    if (ownerUserId === undefined) return { ok: false, code: 'namespace-unknown' };
    const opened = await this.registry.open({ userId: ownerUserId }, namespaceId);
    if (!opened.ok) return { ok: false, code: 'read-failed' };
    const lease = opened.lease;
    try {
      if (!(await this.waitLeaseReadable(lease, READ_READY_TIMEOUT_MS))) {
        return { ok: false, code: 'read-failed' };
      }
      const result = lease.readData(path);
      if (!result.ok) return { ok: false, code: 'read-failed' };
      return { ok: true, value: result.value };
    } finally {
      await lease.release();
    }
  }

  private async opVerifyWrite(args: Record<string, unknown>): Promise<Readonly<Record<string, unknown>>> {
    const { namespaceId, set, path, value, timeoutMs } = args;
    if (typeof namespaceId !== 'string' || !NAMESPACE_ID_PATTERN.test(namespaceId) || !isSegmentArray(set)) {
      return { ok: false, code: 'invalid-op-args' };
    }
    if (!('value' in args)) return { ok: false, code: 'invalid-op-args' };
    if (path !== undefined && !isSegmentArray(path)) return { ok: false, code: 'invalid-op-args' };
    if (path !== undefined && JSON.stringify(path) !== JSON.stringify(set)) {
      return { ok: false, code: 'invalid-op-args' };
    }
    let waitMs = OP_TIMEOUT_DEFAULT_MS;
    if (timeoutMs !== undefined) {
      if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < OP_TIMEOUT_MIN_MS || timeoutMs > OP_TIMEOUT_MAX_MS) {
        return { ok: false, code: 'invalid-op-args' };
      }
      waitMs = timeoutMs;
    }
    if (this.registry === undefined) return { ok: false, code: 'namespace-unknown' };
    const ownerUserId = this.knownOwner(namespaceId);
    if (ownerUserId === undefined) return { ok: false, code: 'namespace-unknown' };
    // F1（SA7 §2.5 修复方向）：已知集 ns 的本地记录可能尚未物化（peer 复制收敛中 /
    // hub 重启恢复路径 / 直引 ns 尚未到达）——`registry.open` 的 `NAMESPACE_NOT_FOUND`
    // 在 op deadline 内重试（有界物化等待）；deadline 达成仍未物化 → 与「等待达成后
    // 仍未 live」同一稳定码 `verify-write-timeout`；非 NOT_FOUND 的真实错误
    // （`NAMESPACE_LOAD_FAILED`/`REGISTRY_NOT_ACCEPTING`）不重试、立即按
    // `write-failed` 收缩——write-failed 仅保留给「物化后/真实错误」，不再于正常
    // 收敛窗口内误报（设计 §3.4 有界等待契约）。
    const deadline = Date.now() + waitMs;
    const opened = await this.openWriteNamespace(namespaceId, ownerUserId, deadline);
    if (opened.kind === 'timeout') return { ok: false, code: 'verify-write-timeout' };
    if (opened.kind === 'rejected') return { ok: false, code: 'write-failed' };
    const lease = opened.lease;
    try {
      if (!(await this.waitNamespaceLive(lease, namespaceId, Math.max(0, deadline - Date.now())))) {
        return { ok: false, code: 'verify-write-timeout' };
      }
      const mutation = { op: 'set', path: set, value };
      const result = await lease.mutateData(mutation);
      if (!result.ok) return { ok: false, code: 'write-failed' };
      return { ok: true };
    } finally {
      await lease.release();
    }
  }

  private async opAddTarget(args: Record<string, unknown>): Promise<Readonly<Record<string, unknown>>> {
    if (this.role !== 'peer' || this.peerService === undefined) return { ok: false, code: 'unknown-op' };
    const { namespaceId, ownerUserId } = args;
    if (typeof namespaceId !== 'string' || !NAMESPACE_ID_PATTERN.test(namespaceId)) {
      return { ok: false, code: 'invalid-op-args' };
    }
    if (typeof ownerUserId !== 'string' || ownerUserId.length === 0) {
      return { ok: false, code: 'invalid-op-args' };
    }
    // 幂等短路（SA7 F1 修正）：仅当通道仍处连接层恢复机制接管面（非终态/controller
    // 缺席）时短路——终态 closed/conflicted/failed 的通道上短路会吞掉文档化恢复入口
    // （reset 后重引导链失败场景：G5c 已恢复 peerOwners 而通道停在 closed → 旧短路
    // 返回伪 ok:true 零动作）。终态 → 走底层 addTarget（re-add 分支 → §14.1 整连接重建，
    // 发射 target-added）；disconnected → 连接重建机制（openActiveTargets, intent='active'）自恢复。
    const state = this.peerService.status.getNamespaceState(namespaceId);
    if (
      this.peerOwners.has(namespaceId) &&
      state !== 'closed' &&
      state !== 'conflicted' &&
      state !== 'failed'
    ) {
      return { ok: true };
    }
    this.peerService.addTarget({ namespaceId, localOwner: { userId: ownerUserId } });
    this.peerOwners.set(namespaceId, ownerUserId);
    this.sink({ event: 'target-added', namespaceId });
    return { ok: true };
  }

  private async opRemoveTarget(args: Record<string, unknown>): Promise<Readonly<Record<string, unknown>>> {
    if (this.role !== 'peer' || this.peerService === undefined) return { ok: false, code: 'unknown-op' };
    const { namespaceId } = args;
    if (typeof namespaceId !== 'string' || !NAMESPACE_ID_PATTERN.test(namespaceId)) {
      return { ok: false, code: 'invalid-op-args' };
    }
    await this.peerService.removeTarget(namespaceId); // 幂等；未知 nsId 无副作用
    this.peerOwners.delete(namespaceId);
    return { ok: true };
  }

  private async opNotifyAuthChanged(): Promise<Readonly<Record<string, unknown>>> {
    if (this.role !== 'peer' || this.peerService === undefined) return { ok: false, code: 'unknown-op' };
    this.peerService.notifyAuthChanged(); // 仅 blocked 生效（其余态文档化 no-op，不抛错）
    return { ok: true, connectionState: this.peerService.status.connection };
  }

  private async opRequestReauth(args: Record<string, unknown>): Promise<Readonly<Record<string, unknown>>> {
    if (this.role !== 'hub' || this.hubService === undefined) {
      return { ok: false, code: 'unknown-op' };
    }
    const { instanceIdentity } = args;
    if (typeof instanceIdentity !== 'string' || !/^[a-z][a-z0-9-]{0,62}$/.test(instanceIdentity)) {
      return { ok: false, code: 'invalid-op-args' };
    }
    await this.hubService.requestReauth(instanceIdentity);
    return { ok: true };
  }

  // ─────────────────────────────── Phase 5 管理动词（#140） ───────────────────────────────

  private async opReplaceSchema(args: Record<string, unknown>): Promise<Readonly<Record<string, unknown>>> {
    // G1 角色守卫（hub 专属，peer → unknown-op）
    if (this.role !== 'hub' || this.registry === undefined) return { ok: false, code: 'unknown-op' };
    const { namespaceId, schema } = args;
    // G2 参数门禁 → invalid-op-args
    if (typeof namespaceId !== 'string' || !NAMESPACE_ID_PATTERN.test(namespaceId)) {
      return { ok: false, code: 'invalid-op-args' };
    }
    // schema 四键形状门禁（形状归 app；编译语义单源归 runtime compile）
    if (
      !isPlainObject(schema) ||
      typeof schema.lang !== 'string' ||
      typeof schema.id !== 'string' ||
      typeof schema.text !== 'string' ||
      typeof schema.version !== 'number' ||
      !Number.isSafeInteger(schema.version)
    ) {
      return { ok: false, code: 'invalid-op-args' };
    }
    // root 形状门禁：提供时必须 plain JSON 对象（ROOT 恒 Y.Map 物化——ADR 0003）；
    // null/数组/标量不是「未提供」而是形状违约，与 schema 形状错同码族；
    // write-failed 只留给 compile 失败/degraded/fatal 等真实写失败
    if ('root' in args && !isPlainObject(args.root)) {
      return { ok: false, code: 'invalid-op-args' };
    }
    // G3 known-set 门禁（owner 来源 = hub 侧 knownNamespaces，与 read/verify-write 同款）
    const ownerUserId = this.knownOwner(namespaceId);
    if (ownerUserId === undefined) return { ok: false, code: 'namespace-unknown' };
    // G4 open → replaceSchema → release（与 opRead 同款 lease 模式；无 F1 重试——见设计 §4.4）
    const opened = await this.registry.open({ userId: ownerUserId }, namespaceId);
    if (!opened.ok) return { ok: false, code: 'write-failed' };
    try {
      // 键存在性判定（schema-write.ts:73-77 的 runtime 契约）；G2 已保证 root 存在即 plain object。
      // schema **原样透传**（G2 门禁后仅类型收窄 cast——严禁重建对象）：
      // 未声明键的封闭校验单源在 runtime SCHEMA 写槽（compile 严格门 ENV-5「恰含四键」），
      // app 不重复语义校验也不静默剥离额外键（否则运行时防线失活、回执契约漂移）。
      const input =
        'root' in args
          ? { schema: schema as { lang: string; version: number; id: string; text: string }, root: args.root }
          : { schema: schema as { lang: string; version: number; id: string; text: string } };
      const result = await opened.lease.replaceSchema(input); // 结果联合 resolve（fatal 除外）
      return result.ok ? { ok: true } : { ok: false, code: 'write-failed' };
    } catch {
      return { ok: false, code: 'write-failed' }; // RuntimeWriteFatalError 折叠
    } finally {
      await opened.lease.release().catch(() => undefined);
    }
  }

  private async opBumpEpoch(args: Record<string, unknown>): Promise<Readonly<Record<string, unknown>>> {
    // G1 角色守卫（hub 专属，peer → unknown-op）
    if (this.role !== 'hub' || this.registry === undefined) return { ok: false, code: 'unknown-op' };
    const { namespaceId } = args;
    // G2 参数门禁 → invalid-op-args
    if (typeof namespaceId !== 'string' || !NAMESPACE_ID_PATTERN.test(namespaceId)) {
      return { ok: false, code: 'invalid-op-args' };
    }
    // G3 known-set 门禁
    const ownerUserId = this.knownOwner(namespaceId);
    if (ownerUserId === undefined) return { ok: false, code: 'namespace-unknown' };
    const opened = await this.registry.open({ userId: ownerUserId }, namespaceId);
    if (!opened.ok) return { ok: false, code: 'write-failed' };
    try {
      const bumped = await opened.lease.bumpReplicationEpoch(); // ok | issues | released；fatal → reject
      if (!bumped.ok) return { ok: false, code: 'write-failed' };
      // 新 epoch 投影（bump ok ⟹ replication 两态联合必为 enabled——结构性；
      // 防御分支读不出 enabled 时回执省略该字段，绝不虚构数值）
      const status = opened.lease.getStatus();
      const epoch =
        status.lease === 'active' && status.runtime.replication.state === 'enabled'
          ? status.runtime.replication.replicationEpoch
          : undefined;
      return { ok: true, ...(epoch !== undefined ? { replicationEpoch: epoch } : {}) };
    } catch {
      return { ok: false, code: 'write-failed' };
    } finally {
      await opened.lease.release().catch(() => undefined);
    }
  }

  private async opResetReplica(args: Record<string, unknown>): Promise<Readonly<Record<string, unknown>>> {
    // G1 角色守卫（peer 专属，hub → unknown-op）
    if (this.role !== 'peer' || this.peerService === undefined || this.registry === undefined) {
      return { ok: false, code: 'unknown-op' };
    }
    const { namespaceId, ownerUserId, expectedReplicationId, expectedReplicationEpoch } = args;
    // G2 参数门禁 → invalid-op-args
    if (typeof namespaceId !== 'string' || !NAMESPACE_ID_PATTERN.test(namespaceId)) {
      return { ok: false, code: 'invalid-op-args' };
    }
    if (typeof ownerUserId !== 'string' || ownerUserId.length === 0) {
      return { ok: false, code: 'invalid-op-args' };
    }
    if (typeof expectedReplicationId !== 'string' || !/^[0-9a-f]{32}$/.test(expectedReplicationId)) {
      return { ok: false, code: 'invalid-op-args' };
    }
    if (
      typeof expectedReplicationEpoch !== 'number' ||
      !Number.isSafeInteger(expectedReplicationEpoch) ||
      expectedReplicationEpoch < 1
    ) {
      return { ok: false, code: 'invalid-op-args' };
    }
    // G3 无 known-set 门禁（显式 owner 参数 + registry 零存在性泄露核对——见设计 §4.3）
    // G4 编排第 1 步：guarded reset（冻结次序 AD-2：失败即透传，零通道动作）
    let reset: ResetReplicaResult;
    try {
      reset = await this.registry.resetReplica(
        { userId: ownerUserId },
        namespaceId,
        { replicationId: expectedReplicationId, replicationEpoch: expectedReplicationEpoch },
      );
    } catch {
      return { ok: false, code: 'reset-replica-failed' }; // branded fatal（committed 事实见 registry observer）
    }
    if (!reset.ok) return { ok: false, code: reset.code }; // 窄 issue 码透传（含 MISMATCH——零通道动作、零 peerOwners 动作）
    // G5a peerOwners 先删——幂等集在重引导入队完成前不得持有该 ns：
    //   防两处撕裂——(i) 重引导链失败后运维重试 add-target 被 opAddTarget 幂等短路
    //   拦截为伪 ok:true 零动作；(ii) 本步与并发 remove-target 的 delete 幂等合流。
    this.peerOwners.delete(namespaceId);
    // G5b 编排第 2/3 步：收口旧 channel + 重引导（removeTarget 恒 resolve、addTarget 同步无
    //   throw——catch 为结构性不可达的纯防御边界；peerOwners 保持 deleted，add-target 重试可达）
    try {
      await this.peerService.removeTarget(namespaceId); // 幂等；恒 resolve
      // F1（SA7 复验收编）：await removeTarget 返回时 controller 可能仍处 closing（CLOSE 路径
      //   的结算与 CLOSE_OK 往返竞争）——引擎 addTarget 的 re-add 分支只在终态触发，
      //   closing 态落入合流分支（intent='active' 零动作），close 完成后无人再触发重建：
      //   通道永久 closed、重引导不发生。等待 controller 离开 closing 再 addTarget——
      //   终态（closed/conflicted/failed）→ re-add 分支（§14.1 整连接重建）；
      //   disconnected → 连接重建机制（openActiveTargets，intent='active'）自恢复。
      //   预算 = closeTimeout 兜底（缺省 5s）+ 边距；超限 = 真实异常 → 诚实失败
      //   （peerOwners 保持 deleted，add-target 重试真正可达）。
      const settleBudgetMs =
        (this.config.timeouts?.closeTimeoutMs ?? DEFAULT_PEER_CLOSE_TIMEOUT_MS) + RESET_SETTLE_MARGIN_MS;
      if (!(await this.waitPeerTargetSettled(namespaceId, settleBudgetMs))) {
        return { ok: false, code: 'reset-replica-failed' };
      }
      this.peerService.addTarget({ namespaceId, localOwner: { userId: ownerUserId } }); // §14.1 re-add → 重建 → OPEN → bootstrap
    } catch {
      return { ok: false, code: 'reset-replica-failed' };
    }
    // G5c 重引导已入队后恢复幂等集：此后 add-target 幂等短路 = 真 no-op 语义；
    // remove-target→reset-replica 运维序列经此恢复 read/verify-write 的 knownOwner 来源
    this.peerOwners.set(namespaceId, ownerUserId);
    this.sink({ event: 'replica-reset', namespaceId });
    return { ok: true };
  }

  // ─────────────────────────────── 内部助手 ───────────────────────────────

  private knownOwner(namespaceId: string): string | undefined {
    if (this.role === 'hub') return this.knownNamespaces.get(namespaceId);
    return this.peerOwners.get(namespaceId);
  }

  private async waitLeaseReadable(lease: NamespaceLease, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const status = lease.getStatus();
      if (status.lease === 'active' && status.runtime.lifecycle === 'ready' && status.runtime.read.enabled) {
        return true;
      }
      if (Date.now() > deadline) return false;
      await sleep(50);
    }
  }

  /**
   * 已知集 ns 的 `registry.open` 有界物化等待（F1）。本地记录未物化时 open 返回
   * `NAMESPACE_NOT_FOUND`（persistence.loadDoc → null——复制收敛/恢复路径上的
   * **瞬态**），非真实错误：在 `deadline` 内以 `OPEN_RETRY_INTERVAL_MS` 间隔重试；
   * 一次失败尝试后判 deadline（超时检测 ≤ deadline + 间隔，无静默挂起）。
   * 三态返回：`ok`（拿到 lease）/ `timeout`（deadline 达成仍未物化 → 调用方
   * `verify-write-timeout`）/ `rejected`（**非** NOT_FOUND 的真实错误 → 调用方
   * `write-failed`——不吞错、不重试、不冒充超时）。
   */
  private async openWriteNamespace(
    namespaceId: string,
    ownerUserId: string,
    deadline: number,
  ): Promise<WriteOpenResult> {
    const registry = this.registry;
    if (registry === undefined) return { kind: 'rejected' }; // 结构性不可达（knownOwner 校验已过）
    for (;;) {
      const opened = await registry.open({ userId: ownerUserId }, namespaceId);
      if (opened.ok) return { kind: 'ok', lease: opened.lease };
      if (opened.code !== 'NAMESPACE_NOT_FOUND') return { kind: 'rejected' };
      if (Date.now() >= deadline) return { kind: 'timeout' };
      await sleep(OPEN_RETRY_INTERVAL_MS);
    }
  }

  private async waitNamespaceLive(lease: NamespaceLease, namespaceId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      let live: boolean;
      if (this.role === 'peer') {
        live = this.peerService?.status.getNamespaceState(namespaceId) === 'live';
      } else {
        const status = lease.getStatus();
        live = status.lease === 'active' && status.runtime.lifecycle === 'ready' && status.runtime.read.enabled;
      }
      if (live) return true;
      if (Date.now() > deadline) return false;
      await sleep(LIVE_POLL_INTERVAL_MS);
    }
  }

  /**
   * F1（SA7 复验收编）：等 peer controller 离开 closing（收口结算窗口）。
   * 引擎时钟保证：CLOSE 路径的 controller 必在 closeTimeout 内结算
   * （CLOSE_OK / closeTimeout 兜底 / 断线 → disconnected / closing 期终局 → failed），
   * 因此预算 = closeTimeoutMs + 边距内必有终局。返回 true = 终态（closed/conflicted/
   * failed，addTarget 的 re-add 分支可达）或 disconnected（连接重建机制 intent='active'
   * 自恢复，且 addTarget 合流会翻转 intent）；false = 预算超限（真实异常，调用方诚实
   * 报告）。controller 缺席（结构性不可达——controllers map 无 delete 路径）视同 settled
   * （addTarget 将新建 controller）。
   */
  private async waitPeerTargetSettled(namespaceId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const state = this.peerService?.status.getNamespaceState(namespaceId);
      if (
        state === undefined ||
        state === 'closed' ||
        state === 'conflicted' ||
        state === 'failed' ||
        state === 'disconnected'
      ) {
        return true;
      }
      if (Date.now() > deadline) return false;
      await sleep(LIVE_POLL_INTERVAL_MS);
    }
  }
}

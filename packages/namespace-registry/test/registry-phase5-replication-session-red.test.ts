/**
 * SA6 红灯锚定 — issue #134（Phase 5: expose trusted NamespaceLease
 * ReplicationSession，切片 3/4）AC-1..AC-7 + SA8 冲突门禁 O-5 两项补锚：
 *
 *   (a) hub persistence-degraded 拒绝 peer→hub raw apply（ADR 0010 L125–129）；
 *   (b) peer 本地 replaceSchema() 以稳定角色权限错误拒绝（ADR 0010 L118，切片 4 L80）。
 *
 * 契约来源（ADR 0010 §NamespaceLease 与 ReplicationSession L71–90、
 * §Trusted raw update 与现有不变量 L92–113、§SCHEMA 与 META 权限 L115–121、
 * §Persistence degraded 语义 L123–139；docs/phases/phase-5-websocket-replication.md
 * §实施切片 3/4；SA8 冲突门禁相关决议 T-1..T-7 与 O-1..O-12）：
 * - AC-1：`lease.openReplicationSession(options)` 存在；每 Lease 至多一个 duplex
 *   session；创建时冻结 localRole / remoteInstanceId / replicationId /
 *   replicationEpoch（四域在 session 上可查询且不随 Runtime 状态漂移）；
 * - AC-2：六项窄能力（state-vector / diff / owned 订阅 / sequenced trusted apply /
 *   独立 status / 幂等 close）真实可用，且 session 不暴露 Y.Doc / DocHandle /
 *   sequencer / live shared types（运行时属性探测 + 类型面 test-d 双面锚）；
 * - AC-3：远端 apply 进入该 namespace 唯一 write sequencer，槽内完成 dirty
 *   notification 后才 resolve（通知序 = 提交序；与业务写共享同一 FIFO）；
 * - AC-4：hub 对 peer update 做 scratch-check——改变 SCHEMA 或复制身份保留
 *   META 字段的 update 整体拒绝（零写入）；ROOT raw update 不做 VFSL 预校验
 *   （违反 schema 类型的 update 仍被接受）并标记 `replication-unvalidated`；
 *   peer 收 hub update 允许 ROOT/SCHEMA/允许 META（单向复制语义）；
 * - AC-5：peer persistence-degraded → 本地业务写禁用（RUNTIME_WRITE_DISABLED）、
 *   已冻结 hub→peer session 的 apply 仍允许（内存生效 + saveDoc 仍登记 +
 *   内存/磁盘状态可区分，不声称 durable）；hub persistence-degraded → 拒绝
 *   peer→hub raw apply，读取/身份检查/state-vector 交换保留（O-5 补锚 a）；
 * - AC-6：单 Runtime observer 向多 session 扇出 immutable owned updates；远程
 *   apply 的源 origin 被排除（回声抑制）；observer 抛错不伤已提交事务、不致命、
 *   不阻断其他 session 扇出；
 * - AC-7：session close 幂等 + close 后 apply 不生效；Registry shutdown（Runtime
 *   close）→ apply 被 lifecycle gate 拒绝；epoch 冻结在 session、bump 后旧
 *   session 的 apply 被 epoch gate fenced（零写入）；apply 的 notify-dirty 失败 →
 *   RuntimeWriteFatalError committed:true、committed 事实保留；idle 期 open 复用
 *   同一 Runtime（新 lease 新 session 观察到旧写状态）；FilePersistence 重启后
 *   session state-vector 与重启前逐字节一致。
 *
 * 角色权限矩阵（O-4 注入点以 createNamespaceRegistryForTesting overrides.role 为
 * SA6 建议形状；行为契约与注入机制分离——改注入点不改断言）：
 * - hub 实例：本地 replaceSchema 正常；enableReplication/bump 正常（L120）；
 *   其 session 对 peer update 执行 scratch-check（L105）；
 * - peer 实例：本地 replaceSchema → 稳定角色权限错误（L118，O-5 补锚 b）；
 *   enableReplication/bump hub-only（L120）；其 session 接收 hub update 允许
 *   ROOT/SCHEMA/允许 META（L105）。
 *
 * 红灯机制（基线 = NamespaceLease 无 openReplicationSession；Runtime 无角色概念）：
 * 每用例的第一行为锚是 `expect(typeof lease.openReplicationSession).toBe('function')`
 * ——基线上该方法缺席（特征缺失），断言立即红；其余断言在 SA3 落位后依次成为
 * 行为验证。本文件以本地结构声明 + cast 表达新契约调用面（沿
 * registry-phase5-replication-red.test.ts 先例），保证 tsconfig.typecheck.json
 * 程序内零 TS2339 噪声。类型面锚见 registry-phase5-replication-session-surface.test-d.ts。
 *
 * 测试纪律：零源码 grep 断言；真实 Yjs / 真实 Runtime / 真实 Memory+File
 * Persistence；全部确定性（受控随机源、受控 scheduler、受控 notifier）；
 * 零真实时间等待、零网络。词汇未冻结处锚「行为可区分」，待冻结词汇清单见
 * wiki/raw/task_namespace-lease-replication-session_sa6_red.md。
 *
 * 确定性 Yjs 纪律：一切「远端 update」用 live doc 全量状态 bootstrap 独立 Y.Doc
 * 后仅写入**新键**（Yjs 并发键胜者按随机 clientID 决胜——写既有键会产生不可确定
 * 结果）；新键无并发项，合并结果确定。快照字节重放同理（同 clientID 项重放无冲突）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  FilePersistence,
  createMemoryPersistence,
  DocDuplicateError,
  type DocHandle,
  type DocPersistence,
  type User,
} from '@nomicore/persistence';
import { createTestScheduler } from '@nomicore/persistence/testing';
import {
  createNamespaceRegistryForTesting,
  createRegistryTestScheduler,
} from '@nomicore/namespace-registry/testing';
import { createNamespaceRuntimeForRegistry } from '@nomicore/namespace-runtime/internal';
import { RuntimeWriteFatalError } from '@nomicore/namespace-runtime';
import type { NamespaceRuntime } from '@nomicore/namespace-runtime';
import type { NamespaceLease, NamespaceRegistry, RegistryRandomBytes } from '@nomicore/namespace-registry';
import { waitDurableSnapshot } from '../../namespace-runtime/test/durable-snapshot-wait.js';

// ═══════════════════════════════ 契约面本地声明 ═══════════════════════════════

/** 实例静态角色（O-4：SA6 建议形状 hub/peer；冻结权属 SA1 设计——行为契约不变）。 */
type InstanceRole = 'hub' | 'peer';

/**
 * ADR 0010 L81 冻结的 session 创建输入面（SA6 建议形状：localRole +
 * remoteInstanceId；replicationId/replicationEpoch 由 Runtime 投影链冻结，
 * 非调用方输入——SA8 关联决议 T-6/O-7；SA1 可演进出更多字段）。
 */
interface OpenSessionOptions {
  readonly localRole: InstanceRole;
  readonly remoteInstanceId: string;
}

/** openReplicationSession 结果（O-3：一切拒绝经返回的 Promise 结算——结果面联合）。 */
interface OpenSessionResult {
  readonly ok: boolean;
  readonly session?: unknown;
  readonly code?: string;
  readonly message?: string;
}

/** ReplicationSession 窄能力面（ADR 0010 L81–88 六项 + 冻结四域；方法名 SA6 建议，
 * 待 SA1 冻结——见红灯记录「待设计冻结的稳定词汇清单」）。 */
interface ReplicationSessionLike {
  readonly localRole: string;
  readonly remoteInstanceId: string;
  readonly replicationId: string;
  readonly replicationEpoch: number;
  encodeStateVector(): Uint8Array;
  encodeDiff(remoteStateVector: Uint8Array): Uint8Array;
  subscribeOwnedUpdates(listener: (update: Uint8Array) => void): () => void;
  applyRemoteUpdate(update: Uint8Array): Promise<{ readonly ok: boolean; readonly code?: string; readonly message?: string }>;
  getStatus(): Readonly<Record<string, unknown>>;
  close(): Promise<unknown>;
}

/** Lease → 复制管理面（#132 已交付：enable/bump）。 */
interface ReplicationManagementLease {
  readonly enableReplication: () => Promise<Readonly<{ ok: boolean }>>;
  readonly bumpReplicationEpoch: () => Promise<Readonly<{ ok: boolean }>>;
}

/** Lease → session 打开面（本切片目标：基线缺席 → 首锚即红）。 */
interface SessionLeaseExt {
  readonly openReplicationSession: (options: OpenSessionOptions) => Promise<OpenSessionResult>;
}

function asRepLease(lease: NamespaceLease): NamespaceLease & ReplicationManagementLease {
  return lease as unknown as NamespaceLease & ReplicationManagementLease;
}

function asSessionLease(lease: NamespaceLease): NamespaceLease & SessionLeaseExt {
  return lease as unknown as NamespaceLease & SessionLeaseExt;
}

/** 解出成功 session（断言 ok:true 且 session 存在——open 成功面的最小契约）。 */
function expectSession(opened: OpenSessionResult | undefined): ReplicationSessionLike {
  expect(opened !== undefined, 'openReplicationSession 必须返回结果对象').toBe(true);
  const o = opened as OpenSessionResult;
  expect(o.ok, `期望 open 成功，实际：${JSON.stringify(o)}`).toBe(true);
  if (!o.ok || o.session === undefined) throw new Error('unreachable');
  return o.session as ReplicationSessionLike;
}

/** status 复制域投影（基线 absent → undefined，断言点判红/绿）。 */
interface ReplicationStatusDomain {
  readonly state: 'disabled' | 'enabled';
  readonly replicationId?: string;
  readonly replicationEpoch?: number;
}

function repStatus(lease: NamespaceLease): ReplicationStatusDomain {
  const runtime = lease.getStatus().runtime as unknown as { replication?: ReplicationStatusDomain };
  return runtime.replication as ReplicationStatusDomain;
}

/** Lease → runtime status 投影（cast 消除 released 联合与基线缺字段）。 */
function leaseRuntimeStatus(lease: NamespaceLease): {
  readonly schema: { readonly state: string };
  readonly fatal: unknown;
  readonly read: { readonly enabled: boolean };
  readonly rootWrite: { readonly enabled: boolean };
  readonly schemaWrite: { readonly enabled: boolean };
} {
  return (lease.getStatus() as unknown as { runtime: unknown }).runtime as {
    readonly schema: { readonly state: string };
    readonly fatal: unknown;
    readonly read: { readonly enabled: boolean };
    readonly rootWrite: { readonly enabled: boolean };
    readonly schemaWrite: { readonly enabled: boolean };
  };
}

// ═══════════════════════════════ 基础设施 ═══════════════════════════════

const SCHEMA_ENVELOPE = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'phase5-replication-session-red',
  text: 'type ROOT = { n: number; ext?: number; k1?: number; k2?: number; k3?: number; };\n',
});
const GOOD_ROOT = Object.freeze({ n: 42 });
const FIXED_MS = 1_700_000_123_456;
const ALICE: User = Object.freeze({ userId: 'u-alice' });
const REP_ID_PATTERN = /^[0-9a-f]{32}$/;

/** 确定性计数随机源（Registry namespaceId 生成面）。 */
function makeCounterRandomBytes(): RegistryRandomBytes {
  let counter = 0;
  return (length: number): Uint8Array => {
    if (length !== 16) {
      throw new Error(`受控随机源必须按 128-bit（16 字节）请求，实际请求 ${length} 字节`);
    }
    counter += 1;
    const hex = counter.toString(16).padStart(32, '0');
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i += 1) {
      out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  };
}

/** stub Persistence：真实 Y.Doc 全链载体；saveDoc 通知时刻的 ROOT/SCHEMA/META
 *  快照（dirty 时序与 FIFO 序的可观测面——沿 #132 red 套件先例）。 */
class SessionStubPersistence implements DocPersistence {
  readonly saveEvents: Array<{
    readonly n: unknown;
    readonly ext: unknown;
    readonly k1: unknown;
    readonly k2: unknown;
    readonly k3: unknown;
    readonly schemaNote: unknown;
    readonly replicationId: unknown;
    readonly replicationEpoch: unknown;
  }> = [];
  readonly docs = new Map<string, Y.Doc>();

  seedDocument(docId: string, doc: Y.Doc): void {
    this.docs.set(docId, doc);
  }

  async createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    if (this.docs.has(docId)) {
      throw new DocDuplicateError();
    }
    this.docs.set(docId, doc);
    return this.makeHandle(owner, docId, doc);
  }

  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    const doc = this.docs.get(docId);
    return doc === undefined ? null : this.makeHandle(owner, docId, doc);
  }

  async saveDoc(handle: DocHandle): Promise<void> {
    const root = handle.doc.getMap('ROOT');
    const schema = handle.doc.getMap('SCHEMA');
    const meta = handle.doc.getMap('META');
    this.saveEvents.push({
      n: root.get('n'),
      ext: root.get('ext'),
      k1: root.get('k1'),
      k2: root.get('k2'),
      k3: root.get('k3'),
      schemaNote: schema.get('note'),
      replicationId: meta.get('replicationId'),
      replicationEpoch: meta.get('replicationEpoch'),
    });
  }

  private makeHandle(owner: User, docId: string, doc: Y.Doc): DocHandle {
    return {
      owner,
      docId,
      doc,
      getStatus: () => 'ready' as const,
      release: async () => {},
    };
  }

  /** Runtime 持有的 live Y.Doc（createDoc/loadDoc 收到即 Runtime 使用的同一引用）。 */
  liveDoc(): Y.Doc {
    const docs = [...this.docs.values()];
    if (docs.length !== 1) throw new Error(`stub 应持恰一个文档，当前 ${docs.length}`);
    return docs[0] as Y.Doc;
  }
}

/** 手工种子文档：META 含 docId/createdAt + 可选复制保留字段（预启用场景）。 */
function makeSeedDoc(
  docId: string,
  opts: { replicationId?: string; replicationEpoch?: number; rootN?: number } = {},
): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(SCHEMA_ENVELOPE)) sc.set(k, v);
  const meta = doc.getMap('META');
  meta.set('docId', docId);
  meta.set('createdAt', FIXED_MS);
  if (opts.replicationId !== undefined) meta.set('replicationId', opts.replicationId);
  if (opts.replicationEpoch !== undefined) meta.set('replicationEpoch', opts.replicationEpoch);
  doc.getMap('ROOT').set('n', opts.rootN ?? 42);
  return doc;
}

/**
 * 生成「远端实例状态更新」：以 liveDoc 当前全量状态 bootstrap 独立 Y.Doc（同内容
 * 同 clientID 项——零跨实例冲突），再在指定共享类型上写入**新键**（pre-existing
 * 键一律不写：并发键胜者按随机 clientID 决胜，写既有键引入不可确定性），编码为
 * 完整 update。新键无并发项 → 应用结果确定。
 */
function makeRemoteUpdate(
  liveDoc: Y.Doc,
  mutate: (doc: Y.Doc) => void,
): { update: Uint8Array; replica: Y.Doc } {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(liveDoc));
  mutate(peer);
  return { update: Y.encodeStateAsUpdate(peer), replica: peer };
}

/** 以 liveDoc 当前状态 bootstrap 的独立副本（同 clientID 项——确定性合并）。 */
function makeReplica(liveDoc: Y.Doc): Y.Doc {
  const r = new Y.Doc();
  Y.applyUpdate(r, Y.encodeStateAsUpdate(liveDoc));
  return r;
}

/** 从 bootstrap 副本编码的 state vector 恢复「写前状态」，重放增量字节。 */
function replayDelta(preState: Y.Doc, delta: Uint8Array): Y.Doc {
  const r = new Y.Doc();
  Y.applyUpdate(r, Y.encodeStateAsUpdate(preState));
  Y.applyUpdate(r, delta);
  return r;
}

function newContractInput(overrides: { owner?: User; schema?: unknown; root?: unknown } = {}): Parameters<
  NamespaceRegistry['create']
>[0] {
  return {
    owner: overrides.owner ?? ALICE,
    schema: overrides.schema ?? SCHEMA_ENVELOPE,
    root: overrides.root ?? GOOD_ROOT,
  };
}

/** Registry 工厂：role（O-4 建议注入点）/ runtimeFactory 可覆盖；暴露 registry scheduler。 */
function makeRegistry(
  persistence: DocPersistence,
  opts: {
    role?: InstanceRole;
    runtimeFactory?: (handle: DocHandle, notifyDirty: () => Promise<void>) => NamespaceRuntime;
  } = {},
): { registry: NamespaceRegistry; scheduler: ReturnType<typeof createRegistryTestScheduler> } {
  const scheduler = createRegistryTestScheduler();
  const registry = createNamespaceRegistryForTesting(persistence, {
    clock: { now: () => FIXED_MS },
    scheduler,
    idleTimeoutMs: 25,
    randomBytes: makeCounterRandomBytes(),
    ...(opts.role !== undefined ? { role: opts.role } : {}),
    ...(opts.runtimeFactory !== undefined ? { runtimeFactory: opts.runtimeFactory } : {}),
  } as never);
  return { registry, scheduler };
}

function okLease(result: unknown): NamespaceLease {
  const r = result as { ok?: boolean; lease?: NamespaceLease };
  expect(r.ok, `期望成功，实际：${JSON.stringify(result)}`).toBe(true);
  if (!r.ok || r.lease === undefined) throw new Error('unreachable');
  return r.lease;
}

/** 微任务预算内等待 Runtime P0 就绪（真实 Runtime + 全微任务链的确定性栅栏）。 */
async function schemaReady(lease: NamespaceLease): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (leaseRuntimeStatus(lease).schema.state === 'ready') return;
    await Promise.resolve();
  }
  throw new Error(`schema 未在微观任务预算内就绪：${JSON.stringify(lease.getStatus())}`);
}

/** 有界微任务展开（observer 扇出/订阅投递的确定性栅栏；零 real sleep）。 */
async function flushMicrotasks(budget = 40): Promise<void> {
  for (let i = 0; i < budget; i += 1) await Promise.resolve();
}

/** settled 结果统一收编（resolve 值或 reject 原因，不使测试直接崩散）。 */
type Settled = { kind: 'resolved'; value: unknown } | { kind: 'rejected'; reason: unknown };

async function settleOf(p: Promise<unknown>): Promise<Settled> {
  try {
    return { kind: 'resolved', value: await p };
  } catch (reason) {
    return { kind: 'rejected', reason };
  }
}

/** settle 收编结果 → resolve 值（非 resolved 返回 undefined；伴 narrow 语义）。 */
function settledValue(s: Settled): unknown {
  return s.kind === 'resolved' ? s.value : undefined;
}

/** settle 收编结果 → 是否「成功结算且 ok:true」（严格成功面判别）。 */
function settledOk(s: Settled): boolean {
  return s.kind === 'resolved' && (s.value as { ok?: unknown }).ok === true;
}

/** settle 收编结果 → 是否「非成功」（reject 或 resolved ok:false——拒绝形态不限）。 */
function settledNonOk(s: Settled): boolean {
  return s.kind === 'rejected' || (s.kind === 'resolved' && (s.value as { ok?: unknown }).ok !== true);
}

/** settle 收编结果 → reject 原因（非 rejected 返回 undefined；伴 narrow 语义）。 */
function settledReason(s: Settled): unknown {
  return s.kind === 'rejected' ? s.reason : undefined;
}

// ─── degraded 矩阵夹具：真实 MemoryPersistence + 共享磁盘 store + saveDoc 计数 ───

/** saveDoc 计数包装：部署真实 MemoryPersistence，仅叠加 dirty 通知计数观测面。 */
class CountingDocPersistence implements DocPersistence {
  saveCount = 0;
  constructor(private readonly inner: DocPersistence) {}
  async createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    return this.inner.createDoc(owner, docId, doc);
  }
  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    return this.inner.loadDoc(owner, docId);
  }
  async saveDoc(handle: DocHandle): Promise<void> {
    this.saveCount += 1;
    return this.inner.saveDoc(handle);
  }
  /** 透传底层持久层 dispose（MemoryPersistence 生命周期清理；测试助手面）。 */
  async dispose(): Promise<void> {
    const inner = this.inner as unknown as { dispose?: () => Promise<void> };
    if (inner.dispose !== undefined) return inner.dispose();
  }
}

/**
 * 共享磁盘 store + 三个可切换故障面的 MemoryPersistence 实例族：
 * - writer：先导写期（创建/启用/首次业务写，failing=false）；
 * - main：被测期（role 开箱的 Registry 使用；failing 可注入 → persistence-degraded）；
 * - reader：磁盘事实观侧面（loadDoc 读 store 当前快照——「磁盘未追上」的观侧面）。
 * 两阶段（先导写 → 被测）经真实磁盘字节 round-trip 传递复制身份事实，无需知道
 * store 内部 key 格式。
 */
interface MemoryStoreFixture {
  readonly writer: CountingDocPersistence;
  readonly writerScheduler: ReturnType<typeof createTestScheduler>;
  readonly main: CountingDocPersistence;
  readonly mainScheduler: ReturnType<typeof createTestScheduler>;
  readonly reader: DocPersistence;
  readonly readerScheduler: ReturnType<typeof createTestScheduler>;
  setFailing(failing: boolean): void;
  flushAll(): Promise<void>;
  disposeReader(): Promise<void>;
  freshReader(): DocPersistence;
}

function makeMemoryStoreFixture(): MemoryStoreFixture {
  const store = new Map<string, Uint8Array>();
  let failing = false;
  const schedule = { debounceMs: 1, maxDirtyMs: 1 };
  const make = (): { persistence: CountingDocPersistence; scheduler: ReturnType<typeof createTestScheduler> } => {
    const scheduler = createTestScheduler();
    const persistence = new CountingDocPersistence(
      createMemoryPersistence({
        scheduler,
        schedule,
        writeSnapshot: async (key, snapshot) => {
          if (failing) throw new Error('io down (deterministic)');
          store.set(key, snapshot.slice());
        },
        readSnapshot: async (key) => store.get(key),
      }),
    );
    return { persistence, scheduler };
  };
  const w = make();
  const m = make();
  const readerScheduler = createTestScheduler();
  const reader = createMemoryPersistence({
    scheduler: readerScheduler,
    readSnapshot: async (key) => store.get(key),
  });
  return {
    writer: w.persistence,
    writerScheduler: w.scheduler,
    main: m.persistence,
    mainScheduler: m.scheduler,
    reader,
    readerScheduler,
    setFailing: (f) => {
      failing = f;
    },
    flushAll: async () => {
      for (let i = 0; i < 60; i += 1) {
        await w.scheduler.advanceBy(1_000);
        await m.scheduler.advanceBy(1_000);
        await readerScheduler.advanceBy(1_000);
      }
    },
    disposeReader: async () => {
      await (reader as unknown as { dispose(): Promise<void> }).dispose();
    },
    /** 新建一个读取同一 store 的独立 reader（活单元缓存规避：第二次观测磁盘事实
     * 前用全新实例——loadDoc 必然重新读 store，不命中 MemoryPersistence cache）。 */
    freshReader: () =>
      createMemoryPersistence({
        scheduler: createTestScheduler(),
        readSnapshot: async (key) => store.get(key),
      }),
  };
}

/** 捕获运行时 live Y.Doc 的委托 Persistence（File 重启锚：拿到磁盘载入的 doc）。 */
class DocCapturingPersistence implements DocPersistence {
  lastDoc: Y.Doc | undefined;
  constructor(private readonly inner: DocPersistence) {}
  async createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    this.lastDoc = doc;
    return this.inner.createDoc(owner, docId, doc);
  }
  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    const handle = await this.inner.loadDoc(owner, docId);
    if (handle !== null) this.lastDoc = handle.doc;
    return handle;
  }
  async saveDoc(handle: DocHandle): Promise<void> {
    return this.inner.saveDoc(handle);
  }
  /** 透传底层持久层 dispose（FilePersistence 生命周期清理——沿 CountingDocPersistence 先例）。 */
  async dispose(): Promise<void> {
    const inner = this.inner as unknown as { dispose?: () => Promise<void> };
    if (inner.dispose !== undefined) return inner.dispose();
  }
}

// ═══════════════════════════════ AC-1：open 与冻结 ═══════════════════════════════

describe('AC-1 openReplicationSession：存在、每 Lease 至多一个、冻结 role/remote/lineage/epoch', () => {
  it('open 成功：session 冻结四域（localRole/remoteInstanceId/replicationId/replicationEpoch=1）', async () => {
    const stub = new SessionStubPersistence();
    const { registry } = makeRegistry(stub, { role: 'hub' });
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);
    expect((await asRepLease(lease).enableReplication()).ok).toBe(true);
    const facts = repStatus(lease);
    expect(facts.state).toBe('enabled');
    expect(facts.replicationId).toMatch(REP_ID_PATTERN);
    expect(facts.replicationEpoch).toBe(1);

    const opened = await asSessionLease(lease).openReplicationSession({
      localRole: 'hub',
      remoteInstanceId: 'peer-a',
    });
    const session = expectSession(opened);

    // 冻结四域（ADR 0010 L81）：localRole / remoteInstanceId / lineage / epoch
    expect(session.localRole).toBe('hub');
    expect(session.remoteInstanceId).toBe('peer-a');
    expect(session.replicationId).toBe(facts.replicationId);
    expect(session.replicationEpoch).toBe(1);

    // 新 session 正常使用：apply 一路到底（AC-2/AC-3 交叉验证 open 面真的可用）
    const { update } = makeRemoteUpdate(stub.liveDoc(), (peer) => {
      peer.getMap('ROOT').set('k1', 1);
    });
    const applied = await session.applyRemoteUpdate(update);
    expect(applied.ok).toBe(true);
    expect(stub.liveDoc().getMap('ROOT').get('k1')).toBe(1);
    await registry.shutdown();
  });

  it('每 Lease 至多一个 duplex session：二次 open 不得产生第二个可工作 session；首个 session 不受影响', async () => {
    const stub = new SessionStubPersistence();
    const { registry } = makeRegistry(stub, { role: 'hub' });
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);
    expect((await asRepLease(lease).enableReplication()).ok).toBe(true);

    const first = expectSession(
      await asSessionLease(lease).openReplicationSession({ localRole: 'hub', remoteInstanceId: 'peer-a' }),
    );

    const second = await settleOf(
      asSessionLease(lease).openReplicationSession({ localRole: 'hub', remoteInstanceId: 'peer-b' }),
    );
    // 行为可区分锚（O-9 语义未冻结，不锁具体拒绝形状）：
    // - 幂等实现：返回同一 session（同一对象引用）→ 合法；
    // - 拒绝实现：ok:false 结算或 rejection → 合法；
    // - 绝不出现「第二个独立且可 apply 的 session」（每个 Lease 最多一个 duplex session）。
    if (second.kind === 'rejected') {
      // 合法：拒绝通道
    } else {
      const value = second.value as OpenSessionResult | undefined;
      if (value?.ok === true && value.session !== first) {
        const s2 = value.session as ReplicationSessionLike;
        const { update } = makeRemoteUpdate(stub.liveDoc(), (peer) => {
          peer.getMap('ROOT').set('k2', 2);
        });
        const apply2 = await settleOf(s2.applyRemoteUpdate(update));
        const appliedOk =
          apply2.kind === 'resolved' && (apply2.value as { ok?: unknown }).ok === true;
        expect(appliedOk, '每 Lease 至多一个工作 session：第二个 session 不得成功 apply').toBe(false);
      }
    }

    // 首个 session 仍可工作（权威 session 不因二次 open 失效）
    const { update } = makeRemoteUpdate(stub.liveDoc(), (peer) => {
      peer.getMap('ROOT').set('k3', 3);
    });
    const applied = await first.applyRemoteUpdate(update);
    expect(applied.ok).toBe(true);
    expect(stub.liveDoc().getMap('ROOT').get('k3')).toBe(3);
    await registry.shutdown();
  });

  it('released lease：openReplicationSession 经 NAMESPACE_LEASE_RELEASED 结果面拒绝（O-3 通道表增补）', async () => {
    const stub = new SessionStubPersistence();
    const { registry } = makeRegistry(stub, { role: 'hub' });
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);

    await lease.release();
    const result = await asSessionLease(lease).openReplicationSession({
      localRole: 'hub',
      remoteInstanceId: 'peer-a',
    });
    // 窄化后断言：真实类型落地后 ok:true 分支无 code——须先判别再取 code（SA3 §5 #8）。
    if (result.ok) {
      throw new Error(`期望 released 拒绝，实际成功：${JSON.stringify(result)}`);
    }
    expect(result.code).toBe('NAMESPACE_LEASE_RELEASED');
    await registry.shutdown();
  });

  it('MEDIUM-1 补锚（ADR 0010 L90 既有 session 半边）：open session + 订阅 → lease.release() → session 终态 closed、apply 拒 NAMESPACE_LEASE_RELEASED、存量订阅零新投递', async () => {
    const stub = new SessionStubPersistence();
    const { registry } = makeRegistry(stub, { role: 'hub' });
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);
    expect((await asRepLease(lease).enableReplication()).ok).toBe(true);
    const nsId = lease.namespaceId;
    // 同 Runtime 第二 Lease：release 后本 namespace 写面仍可用（存量订阅停投的可观测面）
    const lease2 = okLease(await registry.open(ALICE, nsId));
    const session = expectSession(
      await asSessionLease(lease).openReplicationSession({ localRole: 'hub', remoteInstanceId: 'peer-a' }),
    );
    const events: Uint8Array[] = [];
    session.subscribeOwnedUpdates((u) => events.push(u.slice()));

    // 前置：订阅正常运行（release 前一次本地写投递恰 1 条）
    expect((await lease2.mutateRoot({ op: 'set', path: ['n'], value: 7 }))?.ok).toBe(true);
    await flushMicrotasks();
    expect(events.length).toBe(1);

    await lease.release(); // L90：release 同步停止 session 接纳（既有 session 半边）
    await flushMicrotasks();

    // ① 既有 session 进入终态 closed（O-9：release 同步 close 既有 session）
    const status = session.getStatus() as { state?: string };
    expect(status.state).toBe('closed');

    // ② apply 经 released 通道拒绝（ok:false 结算 + 冻结码 NAMESPACE_LEASE_RELEASED）+ 零写入
    const { update } = makeRemoteUpdate(stub.liveDoc(), (peer) => {
      peer.getMap('ROOT').set('ext', 7);
    });
    const applied = await settleOf(session.applyRemoteUpdate(update));
    expect(settledNonOk(applied)).toBe(true);
    expect((settledValue(applied) as { code?: string }).code).toBe('NAMESPACE_LEASE_RELEASED');
    expect(stub.liveDoc().getMap('ROOT').get('ext')).toBeUndefined(); // 零写入

    // ③ 存量订阅零新投递（closed session 已退订——同 Runtime 后续写零投递到该订阅）
    const before = events.length;
    expect((await lease2.mutateRoot({ op: 'set', path: ['n'], value: 8 }))?.ok).toBe(true);
    await flushMicrotasks();
    expect(events.length).toBe(before);
    await registry.shutdown();
  });

  it('LOW-1 补锚：Lease 层 open 拒绝码精确匹配 INPUT_INVALID / ROLE_MISMATCH / SESSION_EXISTS（各一条）', async () => {
    const stub = new SessionStubPersistence();
    const { registry } = makeRegistry(stub, { role: 'hub' });
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);
    expect((await asRepLease(lease).enableReplication()).ok).toBe(true);

    const expectOpenRefusal = async (options: OpenSessionOptions, code: string): Promise<void> => {
      const r = await asSessionLease(lease).openReplicationSession(options);
      if (r.ok) {
        throw new Error(`期望 open 拒绝 ${code}，实际成功：${JSON.stringify(r)}`);
      }
      expect(r.code).toBe(code);
    };

    // ① INPUT_INVALID：畸形 options（remoteInstanceId 空串违约安全文法——敌意输入面）
    await expectOpenRefusal(
      { localRole: 'hub', remoteInstanceId: '' },
      'REPLICATION_SESSION_INPUT_INVALID',
    );
    // ② ROLE_MISMATCH：options.localRole 与实例 role（hub）不符
    await expectOpenRefusal({ localRole: 'peer', remoteInstanceId: 'peer-a' }, 'REPLICATION_ROLE_MISMATCH');
    // ③ 成功 open 后：同 Lease 二次 open → SESSION_EXISTS（活跃 session 唯一性）
    const session = expectSession(
      await asSessionLease(lease).openReplicationSession({ localRole: 'hub', remoteInstanceId: 'peer-a' }),
    );
    await expectOpenRefusal(
      { localRole: 'hub', remoteInstanceId: 'peer-b' },
      'REPLICATION_SESSION_EXISTS',
    );
    expect(session.localRole).toBe('hub'); // 首 session 未被二次 open 影响
    await registry.shutdown();
  });
});

// ═══════════════════════════════ AC-2：窄能力六项 + 不暴露 ═══════════════════════

describe('AC-2 窄能力六项与不暴露内部句柄（ADR 0010 L81–88）', () => {
  it('六项能力真实可用：state-vector / diff / owned 订阅 / sequenced apply / 独立状态 / 幂等 close', async () => {
    const stub = new SessionStubPersistence();
    const { registry } = makeRegistry(stub, { role: 'hub' });
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);
    expect((await asRepLease(lease).enableReplication()).ok).toBe(true);
    const session = expectSession(
      await asSessionLease(lease).openReplicationSession({ localRole: 'hub', remoteInstanceId: 'peer-a' }),
    );

    // ① state vector：反射 live doc 的真实状态向量（与 Y.encodeStateVector 逐字节一致）
    const sv = session.encodeStateVector();
    expect(sv).toBeInstanceOf(Uint8Array);
    expect(new Uint8Array(sv)).toEqual(new Uint8Array(Y.encodeStateVector(stub.liveDoc())));

    // ② diff：本地业务写 n→8 前捕获远端视角（remoteView），写后按该 state vector 编码 diff，
    //    diff 重放到「写前状态」副本必须使 n=8（真实 Yjs 语义，非类型/形状断言）。
    const remoteView = makeReplica(stub.liveDoc()); // 写前远端视角（n=42）
    expect((await lease.mutateRoot({ op: 'set', path: ['n'], value: 8 }))?.ok).toBe(true);
    const diff = session.encodeDiff(new Uint8Array(Y.encodeStateVector(remoteView)));
    expect(diff).toBeInstanceOf(Uint8Array);
    expect(diff.length).toBeGreaterThan(0);
    const replay1 = replayDelta(remoteView, diff);
    expect(replay1.getMap('ROOT').get('n')).toBe(8);
    // R2.2 发现 1（SA1 裁决 2 授权，§15.3-3）：异步 fanout 的交付集 = 交付时刻 listener
    // 快照（§4.2 要点 8 at-least-once——晚订阅者可收到订阅前入队项）——排空步骤 ② 写
    // （n→8）的入队积压，使锚回到「订阅先于写」时序域；断言语义零变化。
    await flushMicrotasks();

    // ③ owned 订阅：本地写投递 owned bytes（应用到写前副本=ext 7）；unsubscribe 后不再投递
    const received: Uint8Array[] = [];
    const unsubscribe = session.subscribeOwnedUpdates((update) => {
      received.push(update.slice());
    });
    expect(typeof unsubscribe).toBe('function');
    const preExt = makeReplica(stub.liveDoc()); // 写前（n=8，无 ext）
    expect((await lease.mutateRoot({ op: 'set', path: ['ext'], value: 7 }))?.ok).toBe(true);
    await flushMicrotasks();
    expect(received.length).toBe(1);
    const replay2 = replayDelta(preExt, received[0] as Uint8Array);
    expect(replay2.getMap('ROOT').get('ext')).toBe(7);
    unsubscribe();
    expect((await lease.mutateRoot({ op: 'set', path: ['ext'], value: 9 }))?.ok).toBe(true);
    await flushMicrotasks();
    expect(received.length).toBe(1); // unsubscribe 后不再投递

    // ④ sequenced apply：远程 update（k3=10 为新键——零并发冲突）→ ok:true、live 可见
    const { update } = makeRemoteUpdate(stub.liveDoc(), (peer) => {
      peer.getMap('ROOT').set('k3', 10);
    });
    expect((await session.applyRemoteUpdate(update)).ok).toBe(true);
    expect(stub.liveDoc().getMap('ROOT').get('k3')).toBe(10);

    // ⑤ 独立状态：session.getStatus 返回对象；raw apply 后复制状态标记 replication-unvalidated
    expect(typeof session.getStatus()).toBe('object');
    const { update: u2 } = makeRemoteUpdate(stub.liveDoc(), (peer) => {
      peer.getMap('ROOT').set('k1', 5);
    });
    expect((await session.applyRemoteUpdate(u2)).ok).toBe(true);
    expect(JSON.stringify(session.getStatus())).toContain('replication-unvalidated');

    // ⑥ 幂等 close：两次 close 均结算、结果一致；close 后 apply 不生效（非 ok、零写入）
    const c1 = await settleOf(session.close());
    expect(c1.kind).toBe('resolved');
    const c2 = await settleOf(session.close());
    expect(c2.kind).toBe('resolved');
    expect(settledValue(c2)).toBe(settledValue(c1));
    const postClose = await settleOf(
      session.applyRemoteUpdate(
        makeRemoteUpdate(stub.liveDoc(), (peer) => {
          peer.getMap('ROOT').set('k2', 6);
        }).update,
      ),
    );
    expect(settledOk(postClose), 'close 后 apply 必须不生效').toBe(false);
    expect(stub.liveDoc().getMap('ROOT').get('k2')).toBeUndefined();
    await registry.shutdown();
  });

  it('session 不暴露 Y.Doc / DocHandle / sequencer / live shared types（属性探测面）', async () => {
    const stub = new SessionStubPersistence();
    const { registry } = makeRegistry(stub, { role: 'hub' });
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);
    expect((await asRepLease(lease).enableReplication()).ok).toBe(true);
    const session = expectSession(
      await asSessionLease(lease).openReplicationSession({ localRole: 'hub', remoteInstanceId: 'peer-a' }),
    );

    const FORBIDDEN = ['doc', 'handle', 'sequencer', 'ydoc', 'yDoc', 'YDoc', 'sharedTypes', 'writeQueue', 'runtime'];
    for (const key of FORBIDDEN) {
      expect(Object.prototype.hasOwnProperty.call(session, key), `session 不得暴露 ${key}`).toBe(false);
      expect((session as unknown as Record<string, unknown>)[key], `session.${key} 必须为空`).toBeUndefined();
    }
    // 键集本身（Object.keys = 可观测运行时面）不得出现句柄类标识
    const keys = Object.keys(session);
    expect(keys.includes('doc')).toBe(false);
    expect(keys.includes('handle')).toBe(false);
    expect(keys.includes('sequencer')).toBe(false);
    expect(keys.includes('runtime')).toBe(false);
    // 能力面键齐全（窄能力六项 + 冻结四域——键集即公共契约）
    for (const required of [
      'localRole',
      'remoteInstanceId',
      'replicationId',
      'replicationEpoch',
      'encodeStateVector',
      'encodeDiff',
      'subscribeOwnedUpdates',
      'applyRemoteUpdate',
      'getStatus',
      'close',
    ]) {
      expect(keys.includes(required), `session 必须暴露能力键 ${required}`).toBe(true);
    }
    await registry.shutdown();
  });
});

// ═══════════════════════════════ AC-3：唯一 sequencer + dirty 时序 ═══════════════

describe('AC-3 远端 apply 进入唯一 write sequencer，槽内完成 dirty notification', () => {
  it('apply 与业务写共享严格 FIFO：通知序 = 提交序；apply resolve 时 dirty 已登记', async () => {
    const stub = new SessionStubPersistence();
    const { registry } = makeRegistry(stub, { role: 'hub' });
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);
    expect((await asRepLease(lease).enableReplication()).ok).toBe(true);
    const session = expectSession(
      await asSessionLease(lease).openReplicationSession({ localRole: 'hub', remoteInstanceId: 'peer-a' }),
    );

    // 提交序：apply(k1=1) → 业务写(n=9) → apply(k2=2)（同一队列不同槽体——唯一 FIFO）
    // 计数基准：enable 的 E6 槽已经 notifyDirty 一次（#132 基线语义——绝对计数以
    // 基准化相对增量断言，FIFO 相对序即契约）。
    const saveBaseline = stub.saveEvents.length;
    const { update: uA } = makeRemoteUpdate(stub.liveDoc(), (peer) => {
      peer.getMap('ROOT').set('k1', 1);
    });
    const { update: uB } = makeRemoteUpdate(stub.liveDoc(), (peer) => {
      peer.getMap('ROOT').set('k2', 2);
    });
    const pA = session.applyRemoteUpdate(uA);
    const pW = lease.mutateRoot({ op: 'set', path: ['n'], value: 9 });
    const pB = session.applyRemoteUpdate(uB);

    const rA = await settleOf(pA);
    expect(settledOk(rA), 'apply A 必须成功结算').toBe(true);
    // dirty 先于 resolve：apply A resolve 时，该槽的 saveDoc 已发生（快照含 k1=1、业务写未至）
    expect(stub.saveEvents.length).toBeGreaterThanOrEqual(saveBaseline + 1);
    expect(stub.saveEvents[saveBaseline]?.k1).toBe(1);
    expect(stub.saveEvents[saveBaseline]?.n).toBe(42);

    const rW = await settleOf(pW);
    expect(settledOk(rW), '业务写必须成功结算').toBe(true);
    const rB = await settleOf(pB);
    expect(settledOk(rB), 'apply B 必须成功结算').toBe(true);

    // FIFO 证据：通知序 [applyA, write, applyB]，快照逐槽累计（相对基准三槽）
    expect(stub.saveEvents.length).toBe(saveBaseline + 3);
    const [e1, e2, e3] = [
      stub.saveEvents[saveBaseline],
      stub.saveEvents[saveBaseline + 1],
      stub.saveEvents[saveBaseline + 2],
    ];
    expect(e1?.k1).toBe(1);
    expect(e1?.k2).toBeUndefined();
    expect(e1?.n).toBe(42);
    expect(e2?.k1).toBe(1);
    expect(e2?.k2).toBeUndefined();
    expect(e2?.n).toBe(9);
    expect(e3?.k1).toBe(1);
    expect(e3?.k2).toBe(2);
    expect(e3?.n).toBe(9);
    await registry.shutdown();
  });
});

// ═══════════════════════════════ AC-4：scratch-check 与 raw 语义 ═══════════════════

describe('AC-4 hub scratch-check SCHEMA/保留 META；raw ROOT 不预校验并标 replication-unvalidated', () => {
  async function readyHub(): Promise<{
    stub: SessionStubPersistence;
    registry: NamespaceRegistry;
    lease: NamespaceLease;
    session: ReplicationSessionLike;
  }> {
    const stub = new SessionStubPersistence();
    const { registry } = makeRegistry(stub, { role: 'hub' });
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);
    expect((await asRepLease(lease).enableReplication()).ok).toBe(true);
    const session = expectSession(
      await asSessionLease(lease).openReplicationSession({ localRole: 'hub', remoteInstanceId: 'peer-a' }),
    );
    return { stub, registry, lease, session };
  }

  it('hub 对「改变 SCHEMA」的 peer update：scratch-check 拒绝（ok:false、SCHEMA/ROOT 零写入、拒绝行为稳定）', async () => {
    const { stub, registry, lease, session } = await readyHub();
    // 计数基准：enable 的 E6 槽已 notify——拒绝路径断言「零新增」而非绝对零。
    const saveBaseline = stub.saveEvents.length;
    const { update } = makeRemoteUpdate(stub.liveDoc(), (peer) => {
      peer.getMap('SCHEMA').set('note', 'mutated-by-peer');
    });
    const r1 = await settleOf(session.applyRemoteUpdate(update));
    expect(settledNonOk(r1), 'SCHEMA 变更必须被 scratch-check 拒绝').toBe(true);
    expect(stub.liveDoc().getMap('SCHEMA').get('note')).toBeUndefined(); // 零写入
    expect(stub.liveDoc().getMap('ROOT').get('n')).toBe(42);
    expect(stub.saveEvents.length).toBe(saveBaseline); // 拒绝路径不登记 dirty（零新增）

    // 再次拒绝（拒绝行为稳定、可重复）
    const r2 = await settleOf(session.applyRemoteUpdate(update));
    expect(settledNonOk(r2)).toBe(true);
    expect(stub.liveDoc().getMap('SCHEMA').get('note')).toBeUndefined();
    expect(lease.read(['n'])).toMatchObject({ ok: true, value: 42 });
    await registry.shutdown();
  });

  it('hub 对「改变 META.replicationId」的 peer update：拒绝（保留字段 hub-only）；META 零写入', async () => {
    const { stub, registry, lease, session } = await readyHub();
    const saveBaseline = stub.saveEvents.length; // 基准：enable 的 E6 已 notify
    const live = stub.liveDoc();
    const idBefore = live.getMap('META').get('replicationId');
    const epochBefore = live.getMap('META').get('replicationEpoch');
    const { update } = makeRemoteUpdate(live, (peer) => {
      peer.getMap('META').set('replicationId', 'f'.repeat(32));
    });
    const r = await settleOf(session.applyRemoteUpdate(update));
    expect(settledNonOk(r), 'META 保留字段变更必须被拒绝').toBe(true);
    expect(live.getMap('META').get('replicationId')).toBe(idBefore); // 保留字段不变
    expect(live.getMap('META').get('replicationEpoch')).toBe(epochBefore);
    expect(stub.saveEvents.length).toBe(saveBaseline); // 拒绝零新增
    expect(repStatus(lease).replicationId).toBe(idBefore);
    await registry.shutdown();
  });

  it('raw ROOT update 不做 VFSL 预校验：违反 schema 类型的 update 仍被接受并标 replication-unvalidated；后续业务写被拒零写入', async () => {
    const { stub, registry, lease, session } = await readyHub();
    // 计数基准：enable 的 E6 槽已 notify——接受路径断言「相对基准 +1」。
    const saveBaseline = stub.saveEvents.length;
    // 违反 schema：ext 声明为 number，远端写入字符串（新键无并发冲突——确定性）
    const { update } = makeRemoteUpdate(stub.liveDoc(), (peer) => {
      peer.getMap('ROOT').set('ext', 'zzz');
    });
    const r = await settleOf(session.applyRemoteUpdate(update));
    expect(settledOk(r), 'raw update 必须被接受（无 VFSL 预校验）').toBe(true);
    expect(stub.liveDoc().getMap('ROOT').get('ext')).toBe('zzz');
    expect(JSON.stringify(session.getStatus())).toContain('replication-unvalidated');
    expect(stub.saveEvents.length).toBe(saveBaseline + 1); // 接受路径正常登记 dirty

    // 后续普通业务写：完整 ROOT 校验 → 当前 ROOT 已不符合 schema → 拒绝、零写入
    const w = await lease.mutateRoot({ op: 'set', path: ['n'], value: 9 });
    expect(w?.ok).toBe(false);
    expect(stub.liveDoc().getMap('ROOT').get('n')).toBe(42); // 零写入
    expect(stub.liveDoc().getMap('ROOT').get('ext')).toBe('zzz');

    // 合法类型的 raw update 同样标记 replication-unvalidated（raw 从不执行 VFSL 预校验）
    const saveBaseline2 = stub.saveEvents.length; // 第二次 apply 前重新取基准
    const { update: u2 } = makeRemoteUpdate(stub.liveDoc(), (peer) => {
      peer.getMap('ROOT').set('k1', 7);
    });
    const r2 = await settleOf(session.applyRemoteUpdate(u2));
    expect(settledOk(r2)).toBe(true);
    expect(stub.liveDoc().getMap('ROOT').get('k1')).toBe(7); // 新键已并入（无冲突）
    expect(JSON.stringify(session.getStatus())).toContain('replication-unvalidated');
    expect(stub.saveEvents.length).toBe(saveBaseline2 + 1); // 第二次 apply 也恰登记一次
    await registry.shutdown();
  });

  it('角色权限对比：peer 实例的 session 接收 hub update——允许 ROOT 与 SCHEMA 同步（单向复制语义）', async () => {
    const stub = new SessionStubPersistence();
    const id0 = 'a'.repeat(32);
    stub.seedDocument(
      'ns-peer-seeded',
      makeSeedDoc('ns-peer-seeded', { replicationId: id0, replicationEpoch: 1 }),
    );
    const { registry } = makeRegistry(stub, { role: 'peer' });
    const lease = okLease(await registry.open(ALICE, 'ns-peer-seeded'));
    await schemaReady(lease);
    expect(repStatus(lease).state).toBe('enabled');

    const session = expectSession(
      await asSessionLease(lease).openReplicationSession({ localRole: 'peer', remoteInstanceId: 'hub-1' }),
    );
    // hub 的 SCHEMA 单向复制：SCHEMA.note 新键（无并发冲突）应用后可达
    const { update: uSchema } = makeRemoteUpdate(stub.liveDoc(), (peer) => {
      peer.getMap('SCHEMA').set('note', 'from-hub');
    });
    const r1 = await settleOf(session.applyRemoteUpdate(uSchema));
    expect(settledOk(r1), 'peer 必须允许 hub 的 SCHEMA 同步').toBe(true);
    expect(stub.liveDoc().getMap('SCHEMA').get('note')).toBe('from-hub');

    // hub 的 ROOT 同步：ROOT.ext 新键
    const { update: uRoot } = makeRemoteUpdate(stub.liveDoc(), (peer) => {
      peer.getMap('ROOT').set('ext', 7);
    });
    const r2 = await settleOf(session.applyRemoteUpdate(uRoot));
    expect(settledOk(r2), 'peer 必须允许 hub 的 ROOT 同步').toBe(true);
    expect(stub.liveDoc().getMap('ROOT').get('ext')).toBe(7);

    // 但 META 保留字段在 peer 侧同样不可经 raw 改变（L120 hub-only）
    const { update: uMeta } = makeRemoteUpdate(stub.liveDoc(), (peer) => {
      peer.getMap('META').set('replicationEpoch', 999);
    });
    const r3 = await settleOf(session.applyRemoteUpdate(uMeta));
    expect(settledNonOk(r3), 'META 保留字段必须 hub-only').toBe(true);
    expect(stub.liveDoc().getMap('META').get('replicationEpoch')).toBe(1);
    await registry.shutdown();
  });
});

// ═══════════════════════════════ AC-5 / O-5：degraded 矩阵与角色权限 ═══════════════

describe('AC-5 peer degraded 只允许 hub→peer trusted apply；O-5 补锚 (a)(b)', () => {
  it('peer persistence-degraded：业务写禁用（RUNTIME_WRITE_DISABLED）；hub→peer apply 允许（内存生效 + saveDoc 仍登记 + 内存/磁盘可区分）', async () => {
    const fx = makeMemoryStoreFixture();
    // ── 先导写期（writer：hub 角色创建并启用复制身份，落盘）──
    const { registry: writerRegistry } = makeRegistry(fx.writer, { role: 'hub' });
    const writerLease = okLease(await writerRegistry.create(newContractInput()));
    await schemaReady(writerLease);
    expect((await asRepLease(writerLease).enableReplication()).ok).toBe(true);
    const id0 = repStatus(writerLease).replicationId as string;
    expect(id0).toMatch(REP_ID_PATTERN);
    await fx.flushAll();
    await writerRegistry.shutdown();
    await (fx.writer as unknown as { dispose(): Promise<void> }).dispose();
    const nsId = writerLease.namespaceId;

    // ── 被测期（main：peer 角色从磁盘打开——复制身份经真实字节 round-trip）──
    const { registry } = makeRegistry(fx.main, { role: 'peer' });
    const lease = okLease(await registry.open(ALICE, nsId));
    await schemaReady(lease);
    expect(repStatus(lease).state).toBe('enabled');
    expect(repStatus(lease).replicationId).toBe(id0);
    expect(repStatus(lease).replicationEpoch).toBe(1);

    // 1) 一次业务写 + I/O 故障 flush → entry persistence-degraded
    expect((await lease.mutateRoot({ op: 'set', path: ['n'], value: 2 }))?.ok).toBe(true);
    fx.setFailing(true);
    await fx.flushAll();
    const degraded = leaseRuntimeStatus(lease);
    expect(degraded.rootWrite.enabled).toBe(false);
    expect(degraded.schemaWrite.enabled).toBe(false);
    expect(degraded.read.enabled).toBe(true);

    const session = expectSession(
      await asSessionLease(lease).openReplicationSession({ localRole: 'peer', remoteInstanceId: 'hub-1' }),
    );
    const savesBefore = fx.main.saveCount;

    // 2) degraded 期业务写：拒绝（RUNTIME_WRITE_DISABLED 码族）+ 零写入
    const business = await lease.mutateRoot({ op: 'set', path: ['n'], value: 3 });
    expect(business?.ok).toBe(false);
    expect(JSON.stringify(business)).toContain('RUNTIME_WRITE_DISABLED');
    expect((await fx.main.loadDoc(ALICE, nsId))?.doc.getMap('ROOT').get('n')).toBe(2);

    // 3) 已冻结 hub→peer 的 trusted apply：允许（内存更新 + saveDoc 仍登记——L134/L135）
    const liveDoc = (await fx.main.loadDoc(ALICE, nsId))?.doc as Y.Doc;
    const remote = makeRemoteUpdate(liveDoc, (peer) => {
      peer.getMap('ROOT').set('ext', 7);
    });
    const applied = await settleOf(session.applyRemoteUpdate(remote.update));
    expect(settledOk(applied), 'degraded 期 hub→peer trusted apply 必须允许').toBe(true);
    await flushMicrotasks();
    expect(fx.main.saveCount).toBe(savesBefore + 1); // saveDoc 继续登记（degraded 非拒绝理由，#79）
    expect(liveDoc.getMap('ROOT').get('ext')).toBe(7); // 内存已追上

    // 4) 内存/磁盘区分：磁盘 reader 还看不到 ext=7（磁盘未追上——不得声称 durable）
    const diskFirst = await fx.reader.loadDoc(ALICE, nsId);
    expect(diskFirst?.doc.getMap('ROOT').get('ext')).toBeUndefined();
    expect(JSON.stringify(session.getStatus())).toMatch(/memory/i); // 状态区分内存面
    await diskFirst?.release(); // 释放首读句柄（活单元缓存规避：见下）

    // 5) 恢复 I/O → Persistence retry 保存完整 live doc → 磁盘与内存合一（L135 retry 语义）
    fx.setFailing(false);
    await fx.flushAll();
    // 用全新 reader 实例重新读磁盘（MemoryPersistence 活单元缓存：同实例二次
    // loadDoc 命中 live cell 返回旧解码 doc——新实例必然走 store 读取路径）。
    const diskAfter = await fx.freshReader().loadDoc(ALICE, nsId);
    expect(diskAfter?.doc.getMap('ROOT').get('ext')).toBe(7);
    expect(diskAfter?.doc.getMap('ROOT').get('n')).toBe(2);
    await registry.shutdown();
    await fx.disposeReader();
  });

  it('补锚 (a)：hub persistence-degraded 拒绝 peer→hub raw apply；读取、身份检查和 state-vector 交换保留', async () => {
    const fx = makeMemoryStoreFixture();
    // 先导写期：创建 + enable 落盘（writer 与 main 共享 store——身份事实经磁盘传递）
    const { registry: writerRegistry } = makeRegistry(fx.writer, { role: 'hub' });
    const writerLease = okLease(await writerRegistry.create(newContractInput()));
    await schemaReady(writerLease);
    expect((await asRepLease(writerLease).enableReplication()).ok).toBe(true);
    const id0 = repStatus(writerLease).replicationId as string;
    await fx.flushAll();
    await writerRegistry.shutdown();
    await (fx.writer as unknown as { dispose(): Promise<void> }).dispose();
    const nsId = writerLease.namespaceId;

    // 被测期：hub 角色从磁盘打开 → 业务写 + 故障 flush → degraded
    const { registry } = makeRegistry(fx.main, { role: 'hub' });
    const lease = okLease(await registry.open(ALICE, nsId));
    await schemaReady(lease);
    expect(repStatus(lease).state).toBe('enabled');
    expect((await lease.mutateRoot({ op: 'set', path: ['n'], value: 2 }))?.ok).toBe(true);
    fx.setFailing(true);
    await fx.flushAll();
    expect(leaseRuntimeStatus(lease).rootWrite.enabled).toBe(false);

    const session = expectSession(
      await asSessionLease(lease).openReplicationSession({ localRole: 'hub', remoteInstanceId: 'peer-a' }),
    );
    // 身份检查保留：session 冻结 lineage/epoch 未被降级破坏
    expect(session.replicationId).toBe(id0);
    expect(session.replicationEpoch).toBe(1);

    // peer→hub raw apply：拒绝（L127）+ 零写入
    const liveDoc = (await fx.main.loadDoc(ALICE, nsId))?.doc as Y.Doc;
    const remote = makeRemoteUpdate(liveDoc, (peer) => {
      peer.getMap('ROOT').set('ext', 7);
    });
    const applied = await settleOf(session.applyRemoteUpdate(remote.update));
    expect(settledNonOk(applied), 'hub degraded 必须拒绝 peer→hub raw apply').toBe(true);
    expect(liveDoc.getMap('ROOT').get('ext')).toBeUndefined(); // 零写入

    // 读取与 state-vector 交换保留（L128）
    expect(lease.read(['n'])).toMatchObject({ ok: true, value: 2 });
    expect(session.encodeStateVector()).toBeInstanceOf(Uint8Array);
    expect(new Uint8Array(session.encodeStateVector())).toEqual(new Uint8Array(Y.encodeStateVector(liveDoc)));
    await registry.shutdown();
    await fx.disposeReader();
  });

  it('补锚 (b)：peer 实例本地 replaceSchema() 以稳定角色权限错误拒绝；hub 实例正常；peer 的 enable/bump 同为 hub-only', async () => {
    // peer 实例：本地 replaceSchema 拒绝且稳定（同码同文）、SCHEMA 载体完整；ROOT 业务写仍可用
    const stubPeer = new SessionStubPersistence();
    const { registry: peerRegistry } = makeRegistry(stubPeer, { role: 'peer' });
    const peerLease = okLease(await peerRegistry.create(newContractInput()));
    await schemaReady(peerLease);
    const r1 = await peerLease.replaceSchema({ schema: SCHEMA_ENVELOPE });
    expect(r1.ok).toBe(false); // 稳定角色权限错误（L118）
    expect(JSON.stringify(r1)).toContain('REPLICATION_ROLE_PERMISSION'); // LOW-2：冻结码字面锁死（修订节 L260）
    const r2 = await peerLease.replaceSchema({ schema: SCHEMA_ENVELOPE });
    expect(r2.ok).toBe(false);
    expect(JSON.stringify(r2)).toBe(JSON.stringify(r1)); // 稳定：重复调用同形状错误
    expect(peerLease.getSchemaEnvelope()).not.toBeNull(); // SCHEMA 载体未被破坏
    expect((await peerLease.mutateRoot({ op: 'set', path: ['n'], value: 5 }))?.ok).toBe(true); // ROOT 业务写不受角色限制
    // peer 的复制管理操作（enable/bump）hub-only（L120）
    const enable = await asRepLease(peerLease).enableReplication();
    expect(enable.ok).toBe(false);
    // 对照：hub 实例 replaceSchema 正常（唯一差异项）
    const stubHub = new SessionStubPersistence();
    const { registry: hubRegistry } = makeRegistry(stubHub, { role: 'hub' });
    const hubLease = okLease(await hubRegistry.create(newContractInput()));
    await schemaReady(hubLease);
    const hubOk = await hubLease.replaceSchema({ schema: SCHEMA_ENVELOPE });
    expect(hubOk.ok).toBe(true);
    await peerRegistry.shutdown();
    await hubRegistry.shutdown();
  });
});

// ═══════════════════════════════ AC-6：fan-out / 回声抑制 / observer 隔离 ═══════════

describe('AC-6 单 Runtime observer 扇出；排除源 origin；observer 失败不伤已提交事务', () => {
  async function readyFanOut(): Promise<{
    stub: SessionStubPersistence;
    registry: NamespaceRegistry;
    leaseA: NamespaceLease;
    leaseB: NamespaceLease;
    sessionA: ReplicationSessionLike;
    sessionB: ReplicationSessionLike;
  }> {
    const stub = new SessionStubPersistence();
    const { registry } = makeRegistry(stub, { role: 'hub' });
    const leaseA = okLease(await registry.create(newContractInput()));
    await schemaReady(leaseA);
    expect((await asRepLease(leaseA).enableReplication()).ok).toBe(true);
    const nsId = leaseA.namespaceId;
    const leaseB = okLease(await registry.open(ALICE, nsId)); // 同 namespace 第二 Lease（同一 Runtime）
    const sessionA = expectSession(
      await asSessionLease(leaseA).openReplicationSession({ localRole: 'hub', remoteInstanceId: 'peer-a' }),
    );
    const sessionB = expectSession(
      await asSessionLease(leaseB).openReplicationSession({ localRole: 'hub', remoteInstanceId: 'peer-b' }),
    );
    return { stub, registry, leaseA, leaseB, sessionA, sessionB };
  }

  it('本地业务写扇出到同 Runtime 的多个 session；apply@A 回声抑制（A 不收、B 收）；字节为快照拷贝', async () => {
    const { stub, registry, leaseA, sessionA, sessionB } = await readyFanOut();
    const eventsA: Uint8Array[] = [];
    const eventsB: Uint8Array[] = [];
    // R2-10 加严（评审项 10 允许范围，仅此一档）：listener 直存 callback 原始参数——
    // 不先 slice——断言每投递数组独立且 buffer 不共享（byteOffset/length/底 buffer identity）
    sessionA.subscribeOwnedUpdates((u) => eventsA.push(u));
    sessionB.subscribeOwnedUpdates((u) => eventsB.push(u));

    // 1) 本地业务写（本地 origin）：两个 session 均投递；字节内容真实生效于远端副本
    const preWrite = makeReplica(stub.liveDoc()); // 写前远端视角（n=42）
    expect((await leaseA.mutateRoot({ op: 'set', path: ['n'], value: 7 }))?.ok).toBe(true);
    await flushMicrotasks();
    expect(eventsA.length).toBe(1);
    expect(eventsB.length).toBe(1);
    // R2-10 加严：数组互异 + 全幅独立 buffer（byteOffset=0、length=全幅、buffer 不共享）
    expect(eventsA[0]).not.toBe(eventsB[0]);
    expect((eventsA[0] as Uint8Array).byteOffset).toBe(0);
    expect((eventsA[0] as Uint8Array).length).toBe((eventsA[0] as Uint8Array).buffer.byteLength);
    expect((eventsA[0] as Uint8Array).buffer).not.toBe((eventsB[0] as Uint8Array).buffer);
    const replayA = replayDelta(preWrite, eventsA[0] as Uint8Array);
    expect(replayA.getMap('ROOT').get('n')).toBe(7);

    // 2) 经 sessionA 的远程 apply（源 origin = A 的通道）：A 回声抑制、B 照常收到
    const preApply = makeReplica(stub.liveDoc()); // apply 前视角（n=7、无 ext）
    const { update } = makeRemoteUpdate(stub.liveDoc(), (peer) => {
      peer.getMap('ROOT').set('ext', 7);
    });
    expect((await sessionA.applyRemoteUpdate(update)).ok).toBe(true);
    await flushMicrotasks();
    expect(eventsA.length).toBe(1); // 排除源 origin（O-10 回声抑制）
    expect(eventsB.length).toBe(2);
    // R2-10 加严：同一 session 的相邻投递 buffer 亦不共享
    expect((eventsB[0] as Uint8Array).buffer).not.toBe((eventsB[1] as Uint8Array).buffer);
    const replayB = replayDelta(preApply, eventsB[1] as Uint8Array);
    expect(replayB.getMap('ROOT').get('ext')).toBe(7); // B 收到的即 apply@A 的所有权增量

    // 3) 字节不可变：对已交付字节的突变不影响 live doc 后续读取；后续写继续投递
    const delivered = eventsB[1] as Uint8Array;
    delivered.fill(0xff);
    expect(stub.liveDoc().getMap('ROOT').get('ext')).toBe(7);
    expect((await leaseA.mutateRoot({ op: 'set', path: ['n'], value: 8 }))?.ok).toBe(true);
    await flushMicrotasks();
    expect(eventsB.length).toBe(3); // 后续写继续投递（扇出未被破坏）
    await registry.shutdown();
  });

  it('订阅 observer 抛错：事务不回滚、Runtime 不 fatal、其他 session 扇出不受影响', async () => {
    const { registry, leaseA, leaseB, sessionA, sessionB } = await readyFanOut();
    const eventsB: Uint8Array[] = [];
    // observer 抛错（T-2 和解条件：fan-out 自捕获——绝不向 Yjs transaction 栈抛）
    sessionA.subscribeOwnedUpdates(() => {
      throw new Error('observer channel down (deterministic)');
    });
    sessionB.subscribeOwnedUpdates((u) => eventsB.push(u.slice()));

    const w = await leaseA.mutateRoot({ op: 'set', path: ['n'], value: 5 });
    expect(w?.ok).toBe(true); // 已提交事务不被 observer 拖垮
    await flushMicrotasks();
    expect(leaseA.read(['n'])).toMatchObject({ ok: true, value: 5 });
    expect(leaseRuntimeStatus(leaseA).fatal).toBeNull(); // 不使 Runtime fatal
    expect(eventsB.length).toBe(1); // 另一 session 不受失败 observer 阻断

    // 后续写仍提交、B 仍收到（observer 失败未杀死扇出面）
    expect((await leaseA.mutateRoot({ op: 'set', path: ['n'], value: 6 }))?.ok).toBe(true);
    await flushMicrotasks();
    expect(leaseA.read(['n'])).toMatchObject({ ok: true, value: 6 });
    expect(eventsB.length).toBe(2);
    expect(leaseRuntimeStatus(leaseA).fatal).toBeNull();
    expect(typeof leaseB.getStatus).toBe('function'); // 第二 Lease 面未受伤害
    await registry.shutdown();
  });
});

// ═══════════════════════════════ AC-7：生命周期 / 竞态 / fencing / fatal ═══════════

describe('AC-7 生命周期确定性契约：close / Runtime close / epoch fencing / fatal committed facts / idle', () => {
  it('Registry shutdown（Runtime close）：session apply 被 lifecycle gate 拒绝（RUNTIME_WRITE_DISABLED 族、零写入）', async () => {
    const stub = new SessionStubPersistence();
    const { registry } = makeRegistry(stub, { role: 'hub' });
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);
    expect((await asRepLease(lease).enableReplication()).ok).toBe(true);
    const session = expectSession(
      await asSessionLease(lease).openReplicationSession({ localRole: 'hub', remoteInstanceId: 'peer-a' }),
    );
    const { update } = makeRemoteUpdate(stub.liveDoc(), (peer) => {
      peer.getMap('ROOT').set('ext', 7);
    });
    await registry.shutdown(); // Runtime close（主动关闭 active Runtime，不等待 lease release）

    const applied = await settleOf(session.applyRemoteUpdate(update));
    expect(settledNonOk(applied), 'Runtime close 后 apply 必须被拒绝').toBe(true);
    expect(JSON.stringify(settledValue(applied))).toContain('RUNTIME_WRITE_DISABLED');
    expect(stub.liveDoc().getMap('ROOT').get('ext')).toBeUndefined(); // 零写入
  });

  it('epoch fencing：冻结 epoch 不漂移；bump 后旧 session apply 被身份/epoch gate 拒绝零写入；新 session 正常', async () => {
    const stub = new SessionStubPersistence();
    const { registry } = makeRegistry(stub, { role: 'hub' });
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);
    expect((await asRepLease(lease).enableReplication()).ok).toBe(true);
    const session1 = expectSession(
      await asSessionLease(lease).openReplicationSession({ localRole: 'hub', remoteInstanceId: 'peer-a' }),
    );
    expect(session1.replicationEpoch).toBe(1);

    expect((await asRepLease(lease).bumpReplicationEpoch()).ok).toBe(true);
    expect(repStatus(lease).replicationEpoch).toBe(2);
    expect(session1.replicationEpoch).toBe(1); // 冻结值不随 Runtime 漂移（L81）

    // 计数基准：enable 与 bump 的 E6 槽均已 notify（两次）——fence 断言「零新增」。
    const saveBaseline = stub.saveEvents.length;
    const { update } = makeRemoteUpdate(stub.liveDoc(), (peer) => {
      peer.getMap('ROOT').set('ext', 7);
    });
    const fenced = await settleOf(session1.applyRemoteUpdate(update));
    expect(settledNonOk(fenced), 'bump 后旧 session 的 apply 必须被 epoch gate fenced').toBe(true);
    expect(stub.liveDoc().getMap('ROOT').get('ext')).toBeUndefined(); // epoch gate 零写入
    expect(stub.saveEvents.length).toBe(saveBaseline); // fenced 零新增（无 dirty）

    // 新 session 冻结新 epoch → 同 update 可 apply（显式 reset/bootstrap 语义）
    const session2 = expectSession(
      await asSessionLease(lease).openReplicationSession({ localRole: 'hub', remoteInstanceId: 'peer-a' }),
    );
    expect(session2.replicationEpoch).toBe(2);
    const applied = await settleOf(session2.applyRemoteUpdate(update));
    expect(settledOk(applied)).toBe(true);
    expect(stub.liveDoc().getMap('ROOT').get('ext')).toBe(7);
    await registry.shutdown();
  });

  it('idle 保留：全部 lease release 后 Runtime idle 期 open 复用同一 Runtime——新 lease 新 session 观察到旧写状态', async () => {
    const stub = new SessionStubPersistence();
    const { registry, scheduler } = makeRegistry(stub, { role: 'hub' });
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);
    expect((await asRepLease(lease).enableReplication()).ok).toBe(true);
    expect((await lease.mutateRoot({ op: 'set', path: ['n'], value: 6 }))?.ok).toBe(true);

    await lease.release(); // 最后 lease 释放 → Runtime idle 保留（不立即 close）
    await scheduler.advanceBy(10); // < idleTimeoutMs(25)——idle 窗口内

    const lease2 = okLease(await registry.open(ALICE, lease.namespaceId)); // 复用同一 Runtime
    const session2 = expectSession(
      await asSessionLease(lease2).openReplicationSession({ localRole: 'hub', remoteInstanceId: 'peer-a' }),
    );
    // 观察到旧写状态（同一 Runtime 的连续状态——idle 复用语义）
    expect(lease2.read(['n'])).toMatchObject({ ok: true, value: 6 });
    expect(session2.replicationEpoch).toBe(1);
    const { update } = makeRemoteUpdate(stub.liveDoc(), (peer) => {
      peer.getMap('ROOT').set('ext', 7);
    });
    expect((await session2.applyRemoteUpdate(update)).ok).toBe(true);
    expect(stub.liveDoc().getMap('ROOT').get('ext')).toBe(7);
    await registry.shutdown();
  });

  it('fatal committed facts：apply 的 notify-dirty 失败 → RuntimeWriteFatalError committed:true；committed 事实保留；后续写 RUNTIME_WRITE_DISABLED；读取保留', async () => {
    const stub = new SessionStubPersistence();
    const gate: { failing: boolean; calls: number; cause: Error } = {
      failing: false,
      calls: 0,
      cause: new Error('notify channel down (deterministic)'),
    };
    const { registry } = makeRegistry(stub, {
      role: 'hub',
      runtimeFactory: (handle: DocHandle): NamespaceRuntime =>
        createNamespaceRuntimeForRegistry(handle, () => {
          gate.calls += 1;
          return gate.failing ? Promise.reject(gate.cause) : Promise.resolve();
        }),
    });
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);
    expect((await asRepLease(lease).enableReplication()).ok).toBe(true);
    expect(gate.calls).toBe(1); // enable 通知成功恰一次
    const session = expectSession(
      await asSessionLease(lease).openReplicationSession({ localRole: 'hub', remoteInstanceId: 'peer-a' }),
    );

    gate.failing = true;
    const { update } = makeRemoteUpdate(stub.liveDoc(), (peer) => {
      peer.getMap('ROOT').set('ext', 7);
    });
    const failure = await settleOf(session.applyRemoteUpdate(update));
    expect(failure.kind).toBe('rejected');
    const fatal = settledReason(failure) as RuntimeWriteFatalError;
    expect(fatal).toBeInstanceOf(RuntimeWriteFatalError);
    expect(fatal.committed).toBe(true); // 诚实 committed 事实（write 已提交、登记通道损坏）

    // committed facts 保留：ext=7 已在 live doc 提交；读取面仍可用（fatal 只禁写）
    expect(stub.liveDoc().getMap('ROOT').get('ext')).toBe(7);
    expect(lease.read(['ext'])).toMatchObject({ ok: true, value: 7 });
    expect(leaseRuntimeStatus(lease).fatal).not.toBeNull();

    // 后续写（再次 apply 与业务写）→ RUNTIME_WRITE_DISABLED、零写入
    const laterApply = await settleOf(
      session.applyRemoteUpdate(
        makeRemoteUpdate(stub.liveDoc(), (peer) => {
          peer.getMap('ROOT').set('k1', 1);
        }).update,
      ),
    );
    expect(settledNonOk(laterApply), 'fatal 后 apply 必须不生效').toBe(true);
    expect(stub.liveDoc().getMap('ROOT').get('k1')).toBeUndefined();
    const laterRoot = await lease.mutateRoot({ op: 'set', path: ['n'], value: 9 });
    expect(laterRoot?.ok).toBe(false);
    expect(JSON.stringify(laterRoot)).toContain('RUNTIME_WRITE_DISABLED');
    expect(lease.read(['n'])).toMatchObject({ ok: true, value: 42 });
    await registry.shutdown();
  });
});

describe('AC-7/AC-2 FilePersistence：重启后 session state-vector 与重启前逐字节一致', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
  });

  it('File 全链：create → enable → 业务写 n=8 → 沉淀盘 → 重启 open → 新 session state vector 与旧 session 一致；apply 仍可用', async () => {
    const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nomicore-rsession-'));
    roots.push(rootDir);
    const makeFile = (): { persistence: DocCapturingPersistence; scheduler: ReturnType<typeof createTestScheduler> } => {
      const scheduler = createTestScheduler();
      const persistence = new DocCapturingPersistence(
        new FilePersistence({
          rootDir,
          scheduler,
          schedule: { debounceMs: 1, maxDirtyMs: 1 },
        }),
      );
      return { persistence, scheduler };
    };

    const first = makeFile();
    const { registry: registry1 } = makeRegistry(first.persistence, { role: 'hub' });
    const lease = okLease(await registry1.create(newContractInput()));
    await schemaReady(lease);
    expect((await asRepLease(lease).enableReplication()).ok).toBe(true);
    expect((await lease.mutateRoot({ op: 'set', path: ['n'], value: 8 }))?.ok).toBe(true);
    const session1 = expectSession(
      await asSessionLease(lease).openReplicationSession({ localRole: 'hub', remoteInstanceId: 'peer-a' }),
    );
    const sv1 = session1.encodeStateVector();

    await first.scheduler.advanceBy(1_000);
    const nsId = lease.namespaceId;
    await waitDurableSnapshot(ALICE, nsId, rootDir, (doc) => doc.getMap('ROOT').get('n'), 8);
    await registry1.shutdown();
    await (first.persistence as unknown as { dispose(): Promise<void> }).dispose();

    const second = makeFile();
    const { registry: registry2 } = makeRegistry(second.persistence, { role: 'hub' });
    const reopened = okLease(await registry2.open(ALICE, nsId));
    await schemaReady(reopened);
    const session2 = expectSession(
      await asSessionLease(reopened).openReplicationSession({ localRole: 'hub', remoteInstanceId: 'peer-a' }),
    );
    expect(repStatus(reopened).replicationEpoch).toBe(1);
    // 同内容 → 同 state vector（Yjs 语义确定性；新 generation 的 SV 与重启前一致）
    expect(new Uint8Array(session2.encodeStateVector())).toEqual(new Uint8Array(sv1));
    // 重启后 diff/apply 仍可用：远端新键 ext 照常并入
    expect(session2.encodeStateVector()).toBeInstanceOf(Uint8Array);
    const liveDoc = second.persistence.lastDoc as Y.Doc;
    expect(liveDoc).toBeDefined();
    const remote = makeRemoteUpdate(liveDoc, (peer) => {
      peer.getMap('ROOT').set('ext', 7);
    });
    expect((await session2.applyRemoteUpdate(remote.update)).ok).toBe(true);
    expect(liveDoc.getMap('ROOT').get('ext')).toBe(7);
    await registry2.shutdown();
    await (second.persistence as unknown as { dispose(): Promise<void> }).dispose();
  });
});

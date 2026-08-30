/**
 * SA6 红灯契约 — issue #151：trusted replication apply / replication enable /
 * replication epoch bump 接入 namespace 诊断变更日志
 * （wiki/raw/task_trusted-replication-management-diagnostic-change-log.md；
 * SA8 verdict clear；Phase 1 实现前初始契约：anchoring acceptance contract
 * before design——沿 #150 先例）。
 *
 * 契约来源：
 * - 任务简报 AC1–AC5（三条 operation 的 frozen v1 词表 + 受控 replication
 *   source/context；identity/epoch/capability/validation/transaction/
 *   dirty-notification/committed-aware fatal 保留既有稳定 phase/code/issues/
 *   committed 事实；committed 复制事务提供 detached owned Yjs update bytes，
 *   no-op 与 update-omitted 显式分置；日志故障/队列压力零业务影响；双向 +
 *   拒绝路径 + 与 transport observability 隔离）；
 * - ADR-0011（覆盖范围最后两项、`identity` 阶段词表、committed update owned
 *   bytes「replication transaction seam 提供」、业务隔离、transport 排除面）；
 * - ADR-0012（operation 封闭词表三值、source/context 逐字形状、direction 双
 *   字面量、result 六分支、阶段八值、attemptId att-+32hex、observedAt 注入
 *   Clock、per-record context 承载 replication 身份——不进 manifest）；
 * - #149 先例（NamespaceRuntimeSeamInput 的 diagnosticEmitter/clock 字段名与
 *   基态链式重放消费形态、as never 透传、waitAttempts poll、inline carrier）；
 * - Phase 5 复制业务面（SA8 盘点注记 1/3：ADR-0010 不在本仓、replication 业务
 *   实现属其交付票）：本契约仅选用其结果通道上**既有稳定**的形状
 *   （runtime.enableReplication/bumpReplicationEpoch、lease.openReplicationSession、
 *   session.applyRemoteUpdate 与既有稳定拒绝码），作为 AC2「保留既有 stable
 *   phase/code/committed」的锚；业务语义细节（epoch 单调性、fence 时点、ACK
 *   时序、transport 健康面字段）不在本契约断言面内——AC4/AC5 只断言**日志侧
 *   故障与 transport 事件不改变/不混入**业务面。
 *
 * 红灯核心（当前 worktree 基线，实测记录于
 * task_trusted-replication-management-diagnostic-change-log_sa6_red.md）：
 * - 操作面缺失：本 worktree 的 NamespaceRuntime 无 enableReplication /
 *   bumpReplicationEpoch 键、NamespaceLease 无 openReplicationSession（Phase 5
 *   复制业务层不在本工作树——SA8 已记录为外部交付票）→ 每个用例在首个操作
 *   调用处 TypeError（“xxx is not a function”），即红灯 = 操作面缺失；
 * - 发射层缺失：即使操作面存在，三条 operation 亦零 emit（当前 worktree 仅
 *   诊断词表冻结面命中 replication）→ 修复后同一用例自动转为「记录必须存在且
 *   分类正确」的断言红（waitAttempts 时间到 / 断言失败）；
 * - 本契约没有为「记录级红」虚构永远 TypeErrror 的假路径：每个用例都是 SA3
 *   落地后必须真实通过的行为断言（记录存在/分类正确/owned bytes 精确回放/
 *   隔离不变），当前失败证据为操作面 TypeError（基线事实诚实呈现）。
 *
 * 行为锚点（全部为运行时行为断言，无任何源码 grep）：
 * - enable：`replication-enable` attempt record（stage transaction / committed /
 *   source {kind:'local'} / context {replicationId, replicationEpoch:1}），
 *   committed update 为 META 两键安装的精确事务增量（基态 → 链条重放可见两键；
 *   真增量对空 Y.Doc 不物化——防「事务后整文档编码」冒充）；
 * - 幂等重入（同 replicationId）：committed + noop 显式（零写入、身份不变）；
 * - 输入格式拒绝（非法 replicationId）：stage validation / 既有拒绝码
 *   REPLICATION_INPUT_INVALID / rejected / 零写入；
 * - bump：`replication-epoch-bump` record（context.replicationEpoch 递增、
 *   identity 保留——replicationId 不变），committed update 为 epoch 键精确增量；
 * - apply（session）：`replication-apply` record，source
 *   {kind:'replication', direction: 'hub-to-peer'|'peer-to-hub', remoteInstanceId}，
 *   context {replicationId, replicationEpoch}；committed update = applied raw
 *   update 的精确 effect（基态链式重放 + 真增量空 doc 不物化）；无新状态
 *   update → committed + noop 显式（零写入零 dirty）；
 * - apply 拒绝路径保留既有稳定码（AC2）：identity/epoch → stage identity /
 *   REPLICATION_EPOCH_CONFLICTED；session closed → stage acceptance /
 *   REPLICATION_SESSION_CLOSED；raw update 损坏 → stage validation /
 *   REPLICATION_RAW_UPDATE_INVALID；均 rejected + 零写入；
 * - committed-aware fatal（AC2/AC4）：notifier 失败 → fatal committed:true +
 *   stage dirty-notification + 精确事务 update + 业务 rejection 保留 phase/
 *   committed 事实；getStatus 抛错 → fatal committed:false + stage
 *   capability-gate + 既有 fatal 码 **NSRT-FATAL-REPLICATION-APPLY-INTERNAL**
 *   （SA1/SA2 设计裁决勘误：主线上限稳定码值为不含 WRITE 的
 *   'NSRT-FATAL-REPLICATION-APPLY-INTERNAL'——常量名
 *   FATAL_REPLICATION_APPLY_WRITE_INTERNAL_CODE 含 WRITE 是命名、值不含；语义断言不变）；
 * - AC4/AC5：emitter 违约 throw/队列满不改业务结果与槽序；session open/close/
 *   status 零记录（transport 事件不混入）；只有变更尝试入日志。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import { createMemoryPersistence } from '@nomicore/persistence';
// 依赖层注记：#151 红灯契约的 fixture 需要 registry lease（apply 会话从 lease 打开）。
// 本 worktree @nomicore/namespace-runtime 不依赖 @nomicore/namespace-registry（方向正确
// ——runtime 不得反向依赖 registry），故以相对路径 import registry 包内模块走通
// （沿 #149 红灯契约相对路径 import 诊断包先例；registry package.json 未声明
// ./testing 子路径导出到 workspace 依赖图，属包依赖修复，SA3 在装配期处理）。
import { createNamespaceRegistryForTesting, createRegistryTestScheduler } from '../../namespace-registry/src/testing.js';
import type { CreateNamespaceInput, NamespaceLease } from '../../namespace-registry/src/index.js';
import type { NamespaceRuntime } from '../src/index.js';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import { realPersistenceScheduler } from './real-persistence-scheduler.js';
import {
  createBoundedMemoryDiagnosticLog,
  type AttemptRecord,
  type AttemptResult,
  type BoundedMemoryDiagnosticLog,
  type DiagnosticLogConfig,
  type NamespaceDiagnosticChangeEmission,
  type NamespaceDiagnosticChangeEmitter,
  type UpdateCarrier,
} from '../../namespace-diagnostic-log/src/index.js';

// ── 固定夹具 ────────────────────────────────────────────────────────────────

const NOW_MS = 1_700_000_000_000; // 固定注入 Clock：observedAt 必须来自注入 Clock
const NOW_ISO = new Date(NOW_MS).toISOString(); // '2023-11-14T22:13:20.000Z'

const OWNER: User = { userId: 'u-alice' };
const ENVELOPE = { lang: 'vfsl', version: 1, id: 'ns-1', text: 'type ROOT = { n: number; a: string; };' } as const;
const ROOT0 = { n: 1, a: 'x' };
const NAMESPACE_ID = 'k-ns';
const REPLICATION_ID = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'; // ADR-0010 冻结格式：32 位小写 hex
const REMOTE_HUB_ID = 'hub-1';
const REMOTE_PEER_ID = 'peer-9';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
  doc.getMap('META').set('docId', NAMESPACE_ID);
  doc.getMap('META').set('createdAt', 1_700_000_000_000);
  const root = doc.getMap('ROOT');
  for (const [k, v] of Object.entries(ROOT0)) root.set(k, v);
  return doc;
}

/** 从基态产生「远端」增量 update：对基态副本施加 mutation 后，以基态 state vector
 *  求增量——增量引用 pre-state struct（left origin），应用需基态即可物化。 */
function buildRemoteDiff(baseState: Uint8Array, mutate: (doc: Y.Doc) => void): Uint8Array {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, baseState);
  mutate(remote);
  const baseDoc = new Y.Doc();
  Y.applyUpdate(baseDoc, baseState);
  return Y.encodeStateAsUpdate(remote, Y.encodeStateVector(baseDoc));
}

/** 无新状态 update（合法 Yjs 编码、零新增 struct——应用后零变化）。 */
function emptyDiff(): Uint8Array {
  return Y.encodeStateAsUpdate(new Y.Doc());
}

function makeLog(config?: Partial<DiagnosticLogConfig>): BoundedMemoryDiagnosticLog {
  return createBoundedMemoryDiagnosticLog({ inputPolicy: 'digest', updateCapture: true, ...config });
}

/** seam 装配（diagnosticEmitter/clock 字段名 = #149 既有契约锚点；replication
 *  操作键当前不存在——调用即 TypeError → 红灯）。 */
async function makeRuntime(
  seam: Record<string, unknown>,
  expectedState: 'ready' | 'unavailable' = 'ready',
): Promise<NamespaceRuntime> {
  const runtime = createNamespaceRuntimeWithSeam(seam as never) as unknown as NamespaceRuntime;
  await expect
    .poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 })
    .toBe(expectedState);
  return runtime;
}

/** Phase 5 既有形状（操作面契约锚点；本 worktree 键缺失）：
 *  NamespaceRuntime.enableReplication / bumpReplicationEpoch。 */
interface RuntimeReplicationManagementSurface {
  readonly enableReplication: (input: { readonly replicationId: string }) => Promise<
    Readonly<{ ok: true }> | Readonly<{ ok: false; issues: unknown[] }>
  >;
  readonly bumpReplicationEpoch: () => Promise<
    Readonly<{ ok: true }> | Readonly<{ ok: false; issues: unknown[] }>
  >;
}

/** Phase 5 既有形状：lease.openReplicationSession + ReplicationSession 面
 *  （仅声明本契约消费的子集——localRole/remoteInstanceId/replicationId/
 *  replicationEpoch/applyRemoteUpdate/getStatus/close）。 */
interface ReplicationSessionSurface {
  readonly localRole: 'hub' | 'peer';
  readonly remoteInstanceId: string;
  readonly replicationId: string;
  readonly replicationEpoch: number;
  applyRemoteUpdate(update: Uint8Array): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; code: string; message: string }>>;
  getStatus(): Readonly<{ state: 'open' | 'closed' | 'conflicted'; direction: 'hub-to-peer' | 'peer-to-hub' }>;
  close(): Promise<void>;
}

type ReplicationSessionOpenResult =
  | Readonly<{ ok: true; session: ReplicationSessionSurface }>
  | Readonly<{ ok: false; code: string; message: string }>;

interface ReplicationLeaseSurface {
  readonly openReplicationSession: (options: {
    readonly localRole: 'hub' | 'peer';
    readonly remoteInstanceId: string;
  }) => Promise<ReplicationSessionOpenResult>;
}

// ── 记录读取 / 解码 helpers（沿用 #149 消费形态）─────────────────────────────

async function waitAttempts(log: BoundedMemoryDiagnosticLog, expected: number): Promise<AttemptRecord[]> {
  await expect
    .poll(() => log.records().filter((r) => r.recordKind === 'attempt').length, { interval: 5, timeout: 3_000 })
    .toBe(expected);
  return log.records().filter((r): r is AttemptRecord => r.recordKind === 'attempt');
}

function firstAttempt(recs: AttemptRecord[]): AttemptRecord {
  const r = recs[0];
  if (r === undefined) throw new Error('waitAttempts 返回 0 条记录（poll 已保证非空——不可达防御）');
  return r;
}

function inlineBytes(carrier: UpdateCarrier): Uint8Array {
  if (carrier.storage !== 'inline') throw new Error(`预期 inline carrier，实际 ${carrier.storage}`);
  return new Uint8Array(Buffer.from(carrier.base64, 'base64'));
}

/** 同源基态 + 既有增量链 + 本条 carrier → 重放 doc（#149 §13.8 消费形态）。 */
function applyCarrier(carrier: UpdateCarrier, baseState: Uint8Array, prior: UpdateCarrier[] = []): Y.Doc {
  expect(carrier.storage).toBe('inline');
  expect(carrier.format).toBe('yjs-update-v1');
  const bytes = inlineBytes(carrier);
  expect(bytes.length).toBe(carrier.payloadLength);
  const fresh = new Y.Doc();
  Y.applyUpdate(fresh, baseState);
  for (const p of prior) Y.applyUpdate(fresh, inlineBytes(p));
  Y.applyUpdate(fresh, bytes);
  return fresh;
}

/** §13.8d 反向鉴别：真事务增量对无基态空 doc 不物化（防整文档编码冒充）。 */
function expectNoMaterializeWithoutBase(carrier: UpdateCarrier): void {
  const empty = new Y.Doc();
  Y.applyUpdate(empty, inlineBytes(carrier));
  expect(empty.getMap('ROOT').size).toBe(0);
  expect(empty.getMap('SCHEMA').size).toBe(0);
  expect(empty.getMap('META').size).toBe(0);
}

function updateCarrierOf(result: AttemptResult): UpdateCarrier {
  if (result.kind !== 'committed' && result.kind !== 'fatal') {
    throw new Error(`预料之外的 result kind: ${result.kind}`);
  }
  if (result.kind === 'committed' && result.effect === 'update') return result.update;
  if (result.kind === 'fatal' && result.committed === true && result.effect === 'update') return result.update;
  throw new Error(`预期 effect:update，实际 ${JSON.stringify(result)}`);
}

function expectEnableResult(res: unknown): void {
  expect(res).toMatchObject({ ok: true });
}

function readValue(runtime: NamespaceRuntime, path: readonly (string | number)[]): unknown {
  const read = runtime.read(path);
  expect(read.ok).toBe(true);
  return (read as { value: unknown }).value;
}

// ── Runtime 直接装配（管理写：enable / bump）─────────────────────────────────

interface RuntimeFixture {
  runtime: NamespaceRuntime;
  writer: ReturnType<typeof createMemoryPersistence>;
  handle: DocHandle;
  baseState: Uint8Array;
  log: BoundedMemoryDiagnosticLog;
}

/** 管理写 fixture：内存 persistence + #149 诊断 seam 装配（无 Registry——enable/bump
 *  是 runtime 键）。baseState = 事务前基态（同 clientID；禁模块级常量）。 */
async function makeRuntimeFixture(log: BoundedMemoryDiagnosticLog): Promise<RuntimeFixture> {
  const store = new Map<string, Uint8Array>();
  const writer = createMemoryPersistence({
    scheduler: realPersistenceScheduler,
    schedule: { debounceMs: 5, maxDirtyMs: 60 },
    writeSnapshot: async (key, snapshot) => {
      store.set(key, snapshot.slice());
    },
  });
  const handle = await writer.createDoc(OWNER, NAMESPACE_ID, makeDoc());
  const baseState = Y.encodeStateAsUpdate(handle.doc);
  const runtime = await makeRuntime({
    handle,
    notifyDirty: () => writer.saveDoc(handle),
    diagnosticEmitter: log.emitter,
    clock: () => NOW_MS,
  });
  return { runtime, writer, handle, baseState, log };
}

function managementSurface(runtime: NamespaceRuntime): RuntimeReplicationManagementSurface {
  return runtime as unknown as RuntimeReplicationManagementSurface;
}

// ── Registry 装配（apply：create → lease → openReplicationSession）────────────

class StubHandle implements DocHandle {
  releaseCalls = 0;
  constructor(
    readonly owner: User,
    readonly docId: string,
    readonly doc: Y.Doc,
  ) {}
  getStatus(): 'ready' {
    return 'ready';
  }
  release(): Promise<void> {
    this.releaseCalls += 1;
    return Promise.resolve();
  }
}

/** 可控 Persistence stub（沿 registry-create.test.ts StubPersistence 先例；
 *  wrapHandle 供 fatal 用例注入敌意 handle）。 */
class StubPersistence implements DocPersistence {
  readonly createCalls: Array<{ owner: User; docId: string; doc: Y.Doc }> = [];
  readonly loadCalls: Array<{ owner: User; docId: string }> = [];
  saveCalls = 0;
  wrapHandle: ((handle: DocHandle) => DocHandle) | undefined;
  private readonly committedDocs = new Map<string, Y.Doc>();

  async createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    this.createCalls.push({ owner, docId, doc });
    this.committedDocs.set(docId, doc);
    const raw = new StubHandle(owner, docId, doc);
    return this.wrapHandle === undefined ? raw : this.wrapHandle(raw);
  }

  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    this.loadCalls.push({ owner, docId });
    const doc = this.committedDocs.get(docId);
    return doc === undefined ? null : new StubHandle(owner, docId, doc);
  }

  async saveDoc(): Promise<void> {
    this.saveCalls += 1;
  }
}

interface RegistryFixture {
  registry: ReturnType<typeof createNamespaceRegistryForTesting>;
  persistence: StubPersistence;
  runtime: NamespaceRuntime;
  lease: NamespaceLease;
  /** create 提交时点基态快照（事务前；同 clientID——重放链起点）。 */
  baseState: Uint8Array;
  log: BoundedMemoryDiagnosticLog;
}

async function makeRegistryFixture(
  log: BoundedMemoryDiagnosticLog,
  opts: {
    notifyDirty?: () => Promise<void>;
    wrapHandle?: (handle: DocHandle) => DocHandle;
  } = {},
): Promise<RegistryFixture> {
  const persistence = new StubPersistence();
  if (opts.wrapHandle !== undefined) persistence.wrapHandle = opts.wrapHandle;
  let runtimeRef: NamespaceRuntime | undefined;
  const registry = createNamespaceRegistryForTesting(persistence, {
    clock: { now: () => NOW_MS },
    scheduler: createRegistryTestScheduler(),
    runtimeFactory: (handle, notifyDirty) => {
      const runtime = createNamespaceRuntimeWithSeam({
        handle,
        notifyDirty: opts.notifyDirty ?? notifyDirty,
        diagnosticEmitter: log.emitter,
        clock: () => NOW_MS,
      } as never) as unknown as NamespaceRuntime;
      runtimeRef = runtime;
      return runtime;
    },
  });
  const result = await registry.create({
    owner: OWNER,
    namespaceId: NAMESPACE_ID,
    schema: ENVELOPE,
    root: ROOT0,
  } satisfies CreateNamespaceInput);
  const created = result as { ok?: boolean; lease?: NamespaceLease; issues?: unknown[] };
  expect(created.ok, `create 应成功，实际：${JSON.stringify(result)}`).toBe(true);
  if (!created.ok || created.lease === undefined) throw new Error('unreachable');
  const runtime = runtimeRef;
  if (runtime === undefined) throw new Error('runtimeFactory 未调用（不可达）');
  await expect
    .poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 })
    .toBe('ready');
  const doc = persistence.createCalls[0]?.doc;
  if (doc === undefined) throw new Error('createDoc 未调用（不可达）');
  const baseState = Y.encodeStateAsUpdate(doc); // create 提交时点快照（enable 之前）
  return { registry, persistence, runtime, lease: created.lease, baseState, log };
}

/** enable replication（等记录落日志）。 */
async function enableReplication(fixture: RegistryFixture): Promise<void> {
  const enable = await managementSurface(fixture.runtime).enableReplication({ replicationId: REPLICATION_ID });
  expectEnableResult(enable);
  await waitAttempts(fixture.log, 1);
}

async function openSession(
  lease: NamespaceLease,
  localRole: 'hub' | 'peer',
  remoteInstanceId: string,
): Promise<ReplicationSessionSurface> {
  const open = await (lease as unknown as ReplicationLeaseSurface).openReplicationSession({
    localRole,
    remoteInstanceId,
  });
  if (!open.ok) {
    throw new Error(`openReplicationSession 应成功，实际：${JSON.stringify(open)}`);
  }
  return open.session;
}

/** 攻击性 emitter：每次 emit 抛错并计数（AC4 违约隔离锚点）。 */
function makeHostileEmitter(): { emitter: NamespaceDiagnosticChangeEmitter; readonly calls: () => number } {
  let calls = 0;
  return {
    emitter: {
      emit: () => {
        calls += 1;
        throw new Error('adapter boom (injected)');
      },
    },
    calls: () => calls,
  };
}

// ── 测试主体 ────────────────────────────────────────────────────────────────

describe('#151 replication 管理写（enable / bump）诊断记录（红灯契约）', () => {
  it('AC1/AC2/AC3 enable committed：replication-enable 记录 + 受控 context + META 两键精确事务 update', async () => {
    const log = makeLog({ inputPolicy: 'full' });
    const { runtime, writer, handle, baseState } = await makeRuntimeFixture(log);

    const res = await managementSurface(runtime).enableReplication({ replicationId: REPLICATION_ID });
    expectEnableResult(res);

    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.operation).toBe('replication-enable');
    expect(rec.stage).toBe('transaction');
    expect(rec.source).toEqual({ kind: 'local' }); // 管理写：本地变更尝试
    expect(rec.observedAt).toBe(NOW_ISO);
    expect(rec.attemptId).toMatch(/^att-[0-9a-f]{32}$/);
    expect(rec.context).toMatchObject({ replicationId: REPLICATION_ID, replicationEpoch: 1 });
    expect(rec.result.kind).toBe('committed');
    if (rec.result.kind === 'committed') {
      expect(rec.result.effect).toBe('update');
      const fresh = applyCarrier(updateCarrierOf(rec.result), baseState);
      expect(fresh.getMap('META').get('replicationId')).toBe(REPLICATION_ID);
      expect(fresh.getMap('META').get('replicationEpoch')).toBe(1);
      expectNoMaterializeWithoutBase(updateCarrierOf(rec.result)); // 真增量：空 doc 不物化
    }

    // 业务面闭环：META 已提交（live doc 可观测）
    expect(handle.doc.getMap('META').get('replicationId')).toBe(REPLICATION_ID);
    expect(handle.doc.getMap('META').get('replicationEpoch')).toBe(1);
    await handle.release();
    await writer.dispose();
  });

  it('AC3 noop 显式：幂等重入（同 replicationId）→ committed + noop、身份不变、零写入', async () => {
    const log = makeLog();
    const { runtime, writer, handle } = await makeRuntimeFixture(log);
    const surface = managementSurface(runtime);

    const r1 = await surface.enableReplication({ replicationId: REPLICATION_ID });
    expectEnableResult(r1);
    await waitAttempts(log, 1);
    const r2 = await surface.enableReplication({ replicationId: REPLICATION_ID }); // 幂等重入
    expectEnableResult(r2);

    const recs = await waitAttempts(log, 2);
    const rec = recs[1]!;
    expect(rec.operation).toBe('replication-enable');
    expect(rec.result).toEqual({ kind: 'committed', effect: 'noop' }); // 零写入 → noop 显式
    expect(rec.context).toMatchObject({ replicationId: REPLICATION_ID, replicationEpoch: 1 });

    // 业务面：身份与 epoch 不变（零写入）
    expect(handle.doc.getMap('META').get('replicationId')).toBe(REPLICATION_ID);
    expect(handle.doc.getMap('META').get('replicationEpoch')).toBe(1);
    await handle.release();
    await writer.dispose();
  });

  it('AC1/AC2 输入格式拒绝：非法 replicationId → validation / REPLICATION_INPUT_INVALID / rejected / 零写入', async () => {
    const log = makeLog({ inputPolicy: 'full' });
    const { runtime, writer, handle } = await makeRuntimeFixture(log);

    const res = await managementSurface(runtime).enableReplication({ replicationId: 'NOT-32HEX!!' });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).toContain('REPLICATION_INPUT_INVALID');

    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.operation).toBe('replication-enable');
    expect(rec.stage).toBe('validation');
    expect(rec.result).toEqual({ kind: 'rejected' });
    expect(rec.code).toBe('REPLICATION_INPUT_INVALID'); // 既有稳定码保留（AC2）
    // 零写入：META 无复制键
    expect(handle.doc.getMap('META').has('replicationId')).toBe(false);
    await handle.release();
    await writer.dispose();
  });

  it('AC1/AC2/AC3 epoch bump committed：replication-epoch-bump 记录 + context.epoch 递增 + identity 保留 + 精确 update', async () => {
    const log = makeLog();
    const { runtime, writer, handle, baseState } = await makeRuntimeFixture(log);
    const surface = managementSurface(runtime);

    expectEnableResult(await surface.enableReplication({ replicationId: REPLICATION_ID }));
    await waitAttempts(log, 1);

    const res = await surface.bumpReplicationEpoch();
    expectEnableResult(res);

    const recs = await waitAttempts(log, 2);
    const rec = recs[1]!;
    expect(rec.operation).toBe('replication-epoch-bump');
    expect(rec.stage).toBe('transaction');
    expect(rec.source).toEqual({ kind: 'local' });
    expect(rec.context).toMatchObject({
      replicationId: REPLICATION_ID, // identity 保留（INV-R1：replicationId 永不被改写）
      replicationEpoch: 2,
    });
    if (rec.result.kind === 'committed') {
      expect(rec.result.effect).toBe('update');
      const fresh = applyCarrier(updateCarrierOf(rec.result), baseState);
      expect(fresh.getMap('META').get('replicationEpoch')).toBe(2);
      expect(fresh.getMap('META').get('replicationId')).toBe(REPLICATION_ID);
      expectNoMaterializeWithoutBase(updateCarrierOf(rec.result));
    }

    // 业务面：epoch 已提升、身份未变
    expect(handle.doc.getMap('META').get('replicationEpoch')).toBe(2);
    expect(handle.doc.getMap('META').get('replicationId')).toBe(REPLICATION_ID);
    await handle.release();
    await writer.dispose();
  });
});

describe('#151 trusted replication apply（session）诊断记录（红灯契约）', () => {
  it('AC1/AC2/AC3 committed apply（hub-to-peer）：replication-apply 记录 + 受控 source/context + 精确 owned update bytes', async () => {
    const log = makeLog({ inputPolicy: 'full' });
    const fixture = await makeRegistryFixture(log);
    await enableReplication(fixture);
    const session = await openSession(fixture.lease, 'peer', REMOTE_HUB_ID); // peer 侧接收 → hub-to-peer
    expect(session.localRole).toBe('peer');
    expect(session.remoteInstanceId).toBe(REMOTE_HUB_ID);
    expect(session.replicationId).toBe(REPLICATION_ID);
    expect(session.replicationEpoch).toBe(1);

    const update = buildRemoteDiff(fixture.baseState, (doc) => {
      doc.getMap('ROOT').set('n', 42);
    });
    const res = await session.applyRemoteUpdate(update);
    expect(res).toEqual({ ok: true });

    const recs = await waitAttempts(log, 2); // [enable, apply]
    const rec = recs[1]!;
    expect(rec.operation).toBe('replication-apply');
    expect(rec.stage).toBe('transaction');
    expect(rec.source).toEqual({ kind: 'replication', direction: 'hub-to-peer', remoteInstanceId: REMOTE_HUB_ID });
    expect(rec.observedAt).toBe(NOW_ISO);
    expect(rec.context).toMatchObject({ replicationId: REPLICATION_ID, replicationEpoch: 1 });
    expect(rec.result.kind).toBe('committed');
    if (rec.result.kind === 'committed') {
      expect(rec.result.effect).toBe('update');
      const enableRec = recs[0]!;
      // 链式重放：基态 → enable 事务 → apply 事务（apply 增量 left origin 依赖前一状态）
      const fresh = applyCarrier(
        updateCarrierOf(rec.result),
        fixture.baseState,
        enableRec.result.kind === 'committed' && enableRec.result.effect === 'update'
          ? [updateCarrierOf(enableRec.result)]
          : [],
      );
      expect(fresh.getMap('ROOT').get('n')).toBe(42);
      expect(fresh.getMap('ROOT').get('a')).toBe('x');
      expect(fresh.getMap('META').get('replicationId')).toBe(REPLICATION_ID);
      expectNoMaterializeWithoutBase(updateCarrierOf(rec.result)); // 真增量：空 doc 不物化
    }

    // 业务面闭环：apply 已提交（live read 可见）——前向（操作）+ 后向（状态）闭环
    expect(readValue(fixture.runtime, ['n'])).toBe(42);
    expect((session.getStatus() as { state: string }).state).toBe('open');
    await session.close();
  });

  it('AC5 both directions：peer-to-hub 记录方向字面量 + remoteInstanceId 精确', async () => {
    const log = makeLog();
    const fixture = await makeRegistryFixture(log);
    await enableReplication(fixture);
    const session = await openSession(fixture.lease, 'hub', REMOTE_PEER_ID); // hub 侧接收 → peer-to-hub

    const update = buildRemoteDiff(fixture.baseState, (doc) => {
      doc.getMap('ROOT').set('a', 'y');
    });
    const res = await session.applyRemoteUpdate(update);
    expect(res).toEqual({ ok: true });

    const recs = await waitAttempts(log, 2);
    const rec = recs[1]!;
    expect(rec.operation).toBe('replication-apply');
    expect(rec.source).toEqual({ kind: 'replication', direction: 'peer-to-hub', remoteInstanceId: REMOTE_PEER_ID });
    expect(rec.context).toMatchObject({ replicationId: REPLICATION_ID, replicationEpoch: 1 });
    expect(rec.result).toMatchObject({ kind: 'committed', effect: 'update' });

    // 业务面闭环
    const read = fixture.runtime.read(['a']);
    expect(read.ok).toBe(true);
    expect((read as { value: unknown }).value).toBe('y');
    await session.close();
  });

  it('AC3 noop 显式：无新状态 update → committed + noop、零写入零 dirty', async () => {
    const log = makeLog();
    const fixture = await makeRegistryFixture(log);
    await enableReplication(fixture);
    const session = await openSession(fixture.lease, 'peer', REMOTE_HUB_ID);
    const dirtyBefore = fixture.persistence.saveCalls;

    const res = await session.applyRemoteUpdate(emptyDiff());
    expect(res).toEqual({ ok: true });

    const recs = await waitAttempts(log, 2);
    const rec = recs[1]!;
    expect(rec.operation).toBe('replication-apply');
    expect(rec.result).toEqual({ kind: 'committed', effect: 'noop' }); // 零写入 → noop 显式

    // 业务面：零写入零 dirty（只有 enable 的一次 saveDoc）
    expect(fixture.persistence.saveCalls).toBe(dirtyBefore);
    expect(readValue(fixture.runtime, ['n'])).toBe(1);
    await session.close();
  });

  it('AC2 identity/epoch 拒绝：fence 后 apply → stage identity / REPLICATION_EPOCH_CONFLICTED / rejected / 零写入', async () => {
    const log = makeLog();
    const fixture = await makeRegistryFixture(log);
    await enableReplication(fixture);
    const session = await openSession(fixture.lease, 'peer', REMOTE_HUB_ID); // session 冻结 epoch=1

    // 提升 epoch（fence 旧 session：session 冻结 epoch 1 ≠ 当前 epoch 2）
    expectEnableResult(await managementSurface(fixture.runtime).bumpReplicationEpoch());
    await waitAttempts(log, 2);

    const update = buildRemoteDiff(fixture.baseState, (doc) => {
      doc.getMap('ROOT').set('n', 99);
    });
    const res = await session.applyRemoteUpdate(update);
    expect(res).toEqual({ ok: false, code: 'REPLICATION_EPOCH_CONFLICTED', message: expect.any(String) });

    const recs = await waitAttempts(log, 3); // [enable, bump, apply]
    const rec = recs[2]!;
    expect(rec.operation).toBe('replication-apply');
    expect(rec.stage).toBe('identity'); // 复制谱系/epoch 不满足 → identity 阶段（词表无独立 epoch 阶段）
    expect(rec.result).toEqual({ kind: 'rejected' });
    expect(rec.code).toBe('REPLICATION_EPOCH_CONFLICTED'); // 既有稳定码保留（AC2）

    // 零写入：ROOT 未变
    expect(readValue(fixture.runtime, ['n'])).toBe(1);
    await session.close();
  });

  it('AC2 capability-gate（session closed）：acceptance / REPLICATION_SESSION_CLOSED / rejected / not-accessed / 零写入', async () => {
    const log = makeLog();
    const fixture = await makeRegistryFixture(log);
    await enableReplication(fixture);
    const session = await openSession(fixture.lease, 'peer', REMOTE_HUB_ID);
    await session.close();

    const update = buildRemoteDiff(fixture.baseState, (doc) => {
      doc.getMap('ROOT').set('n', 7);
    });
    const res = await session.applyRemoteUpdate(update);
    expect(res).toEqual({ ok: false, code: 'REPLICATION_SESSION_CLOSED', message: expect.any(String) });

    const recs = await waitAttempts(log, 2);
    const rec = recs[1]!;
    expect(rec.operation).toBe('replication-apply');
    expect(rec.stage).toBe('acceptance'); // 接纳期拒绝（槽外/session 面）
    expect(rec.result).toEqual({ kind: 'rejected' });
    expect(rec.code).toBe('REPLICATION_SESSION_CLOSED');
    expect(rec.input).toEqual({ capture: 'not-accessed' }); // 拒绝先于任何输入访问

    // 零写入
    expect(readValue(fixture.runtime, ['n'])).toBe(1);
  });

  it('AC2 validation（raw update 损坏）：validation / REPLICATION_RAW_UPDATE_INVALID / rejected / 零写入', async () => {
    const log = makeLog();
    const fixture = await makeRegistryFixture(log);
    await enableReplication(fixture);
    const session = await openSession(fixture.lease, 'peer', REMOTE_HUB_ID);

    const res = await session.applyRemoteUpdate(new Uint8Array([0xff, 0xff, 0x01]));
    expect(res).toEqual({ ok: false, code: 'REPLICATION_RAW_UPDATE_INVALID', message: expect.any(String) });

    const recs = await waitAttempts(log, 2);
    const rec = recs[1]!;
    expect(rec.operation).toBe('replication-apply');
    expect(rec.stage).toBe('validation');
    expect(rec.result).toEqual({ kind: 'rejected' });
    expect(rec.code).toBe('REPLICATION_RAW_UPDATE_INVALID'); // 既有稳定码保留（AC2）

    // 零写入
    expect(readValue(fixture.runtime, ['n'])).toBe(1);
    await session.close();
  });

  it('AC2/AC4 committed-aware fatal：notifier 失败 → fatal committed:true + dirty-notification + 精确事务 update + live doc 已提交', async () => {
    const log = makeLog();
    let armed = false;
    const fixture = await makeRegistryFixture(log, {
      notifyDirty: async () => {
        if (armed) throw new Error('persistence down (injected)');
      },
    });
    await enableReplication(fixture);
    const session = await openSession(fixture.lease, 'peer', REMOTE_HUB_ID);
    armed = true; // 此后 notifier 失败（含 apply 的 E6/notifyDirty）

    const update = buildRemoteDiff(fixture.baseState, (doc) => {
      doc.getMap('ROOT').set('n', 42);
    });
    await expect(session.applyRemoteUpdate(update)).rejects.toMatchObject({
      phase: 'notify-dirty-failed',
      committed: true,
    });

    const recs = await waitAttempts(log, 2);
    const rec = recs[1]!;
    expect(rec.operation).toBe('replication-apply');
    expect(rec.stage).toBe('dirty-notification');
    expect(rec.result.kind).toBe('fatal');
    if (rec.result.kind === 'fatal') {
      // committed 事实保留（AC2）：notifier 失败发生于事务提交之后 → 必为 committed:true
      expect(rec.result.committed).toBe(true);
      if (rec.result.committed === true) {
        expect(rec.result.effect).toBe('update');
        expect(rec.code).toBe('NSRT-FATAL-REPLICATION-APPLY-INTERNAL'); // 既有 fatal 码（AC2；SA1/SA2 裁决值）
        expect(rec.sourcePhase).toBe('notify-dirty-failed');
        const enableRec = recs[0]!;
        const fresh = applyCarrier(
          updateCarrierOf(rec.result),
          fixture.baseState,
          enableRec.result.kind === 'committed' && enableRec.result.effect === 'update'
            ? [updateCarrierOf(enableRec.result)]
            : [],
        );
        expect(fresh.getMap('ROOT').get('n')).toBe(42);
        expectNoMaterializeWithoutBase(updateCarrierOf(rec.result));
      }
    }

    // 业务面：committed 事实为真 —— live doc 已提交（notifier 失败不撤销事务）
    expect(readValue(fixture.runtime, ['n'])).toBe(42);
  });

  it('AC2 fatal-before-commit：getStatus 抛错 → fatal committed:false + capability-gate + 既有 fatal 码', async () => {
    const log = makeLog();
    let armed = false;
    const fixture = await makeRegistryFixture(log, {
      wrapHandle: (raw) =>
        new Proxy(raw, {
          get(target, prop) {
            if (prop === 'getStatus') {
              return () => {
                if (armed) throw new Error('adapter getStatus exploded (injected)');
                return 'ready' as const;
              };
            }
            return Reflect.get(target, prop);
          },
        }),
    });
    await enableReplication(fixture);
    const session = await openSession(fixture.lease, 'peer', REMOTE_HUB_ID);
    armed = true;

    const update = buildRemoteDiff(fixture.baseState, (doc) => {
      doc.getMap('ROOT').set('n', 42);
    });
    await expect(session.applyRemoteUpdate(update)).rejects.toMatchObject({
      phase: 'write-slot-internal',
      committed: false,
    });

    const recs = await waitAttempts(log, 2);
    const rec = recs[1]!;
    expect(rec.operation).toBe('replication-apply');
    expect(rec.stage).toBe('capability-gate');
    expect(rec.result).toEqual({ kind: 'fatal', committed: false });
    expect(rec.code).toBe('NSRT-FATAL-REPLICATION-APPLY-INTERNAL'); // 既有 fatal 码（AC2；SA1/SA2 裁决值）
    expect(rec.sourcePhase).toBe('write-slot-internal');
  });
});

describe('#151 AC4/AC5 日志故障与 transport 隔离（红灯契约）', () => {
  it('AC4 emitter 违约 throw：enable + bump 业务结果/顺序/identity 状态全不变', async () => {
    const hostile = makeHostileEmitter();
    const store = new Map<string, Uint8Array>();
    const writer = createMemoryPersistence({
      scheduler: realPersistenceScheduler,
      schedule: { debounceMs: 5, maxDirtyMs: 60 },
      writeSnapshot: async (key, snapshot) => {
        store.set(key, snapshot.slice());
      },
    });
    const handle = await writer.createDoc(OWNER, NAMESPACE_ID, makeDoc());
    const runtime = await makeRuntime({
      handle,
      notifyDirty: () => writer.saveDoc(handle),
      diagnosticEmitter: hostile.emitter,
      clock: () => NOW_MS,
    });
    const surface = managementSurface(runtime);

    const r1 = await surface.enableReplication({ replicationId: REPLICATION_ID });
    expectEnableResult(r1);
    const r2 = await surface.bumpReplicationEpoch();
    expectEnableResult(r2);

    // 业务面：顺序提交（enable → bump）、无 internal fatal、dirty 登记完成
    expect(handle.doc.getMap('META').get('replicationId')).toBe(REPLICATION_ID);
    expect(handle.doc.getMap('META').get('replicationEpoch')).toBe(2); // FIFO：bump 在 enable 之后
    expect(runtime.getStatus().fatal).toBeNull();
    expect(handle.getStatus()).toBe('ready');
    // 修复后：两次尝试各一次 emit，且 throw 被吞没（不改变上面全部业务结果）
    expect(hostile.calls()).toBe(2);
    await handle.release();
    await writer.dispose();
  });

  it('AC4 队列满：drop 只影响日志，不改业务返回值与 sequencer 顺序', async () => {
    const log = makeLog({ capacity: 1 });
    const { runtime, handle } = await makeRuntimeFixture(log);
    const surface = managementSurface(runtime);

    expectEnableResult(await surface.enableReplication({ replicationId: REPLICATION_ID }));
    expectEnableResult(await surface.bumpReplicationEpoch());

    await waitAttempts(log, 1); // 第一条被接纳；第二条因队列满被丢
    const stats = log.stats();
    expect(stats.accepted).toBe(1);
    expect(stats.droppedTotal).toBe(1);

    // 业务面：两次写都成功且顺序正确（FIFO：enable → bump）
    expect(handle.doc.getMap('META').get('replicationId')).toBe(REPLICATION_ID);
    expect(handle.doc.getMap('META').get('replicationEpoch')).toBe(2);
    await handle.release();
  });

  it('AC5 transport 隔离：session open/close/status 零记录；仅变更尝试入日志', async () => {
    const emissions: NamespaceDiagnosticChangeEmission[] = [];
    const log = makeLog();
    // 记录全部 emission（emitter 包一层 spy——运行时装配走同 seam）
    const spyEmitter: NamespaceDiagnosticChangeEmitter = {
      emit: (e) => {
        emissions.push(e);
        log.emitter.emit(e);
      },
    };
    const persistence = new StubPersistence();
    let runtimeRef: NamespaceRuntime | undefined;
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: { now: () => NOW_MS },
      scheduler: createRegistryTestScheduler(),
      runtimeFactory: (handle, notifyDirty) => {
        const runtime = createNamespaceRuntimeWithSeam({
          handle,
          notifyDirty,
          diagnosticEmitter: spyEmitter,
          clock: () => NOW_MS,
        } as never) as unknown as NamespaceRuntime;
        runtimeRef = runtime;
        return runtime;
      },
    });
    const result = await registry.create({
      owner: OWNER,
      namespaceId: NAMESPACE_ID,
      schema: ENVELOPE,
      root: ROOT0,
    } satisfies CreateNamespaceInput);
    const created = result as { ok?: boolean; lease?: NamespaceLease };
    expect(created.ok).toBe(true);
    if (!created.ok || created.lease === undefined) throw new Error('unreachable');
    const runtime = runtimeRef!;
    await expect
      .poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 })
      .toBe('ready');

    // enable（变更尝试 #1）
    expectEnableResult(await managementSurface(runtime).enableReplication({ replicationId: REPLICATION_ID }));

    // transport/session 面事件：open、getStatus、close——零诊断记录
    const session = await openSession(created.lease, 'peer', REMOTE_HUB_ID);
    void session.getStatus();
    void session.getStatus();
    await session.close();
    await session.close(); // 幂等 close
    void session.getStatus();

    // apply 是变更尝试（#2），前面不是——记录计数与 emission 面断言
    const session2 = await openSession(created.lease, 'peer', REMOTE_HUB_ID);
    const update = buildRemoteDiff(Y.encodeStateAsUpdate(persistence.createCalls[0]!.doc), (doc) => {
      doc.getMap('ROOT').set('n', 42);
    });
    expectEnableResult(await session2.applyRemoteUpdate(update));

    const recs = await waitAttempts(log, 2); // enable + apply
    expect(recs.map((r) => r.operation)).toEqual(['replication-enable', 'replication-apply']);
    // 只有变更尝试产生 emission：open/getStatus/close 等 session 面事件零混入
    // （transport 事件——连接建立/心跳/普通 frame/auth 失败——按 ADR-0011 属 transport
    // observability，不得进入 namespace 诊断变更日志）
    expect(emissions.length).toBe(2);
    for (const e of emissions) {
      expect(e.source.kind === 'replication' || e.source.kind === 'local').toBe(true);
    }
    await session2.close();
  });
});

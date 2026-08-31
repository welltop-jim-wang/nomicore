/**
 * SA6 红灯锚定（Round 2 修订轮，registry 侧）— 评审 12 项的红/Lock 契约锚（issue #134，PR #146）：
 *
 *   R2-1 epoch fence 立即停投（Lease 面：bump 后旧 session listener 零投递 / getStatus
 *        终态 / 同 Lease 可 open 新 epoch session）；
 *   R2-5 lease release hostile seam（getStatus/close 抛错不得半释放：released 标记、
 *        entry 删除、onReleased 恰一次、session.close 幂等直调全部完成；首次 release
 *        不得同步抛出——ADR 0009 L42 same-Promise 稳定面）；
 *   R2-8 生产 Cordis plugin 的 role 贯通（config 接受 role:'hub'|'peer'、缺省 hub、
 *        非法值 loud 拒绝、构造的 Registry 具正确静态角色——peer 本地 replaceSchema
 *        以 REPLICATION_ROLE_PERMISSION 拒、enable 同 hub-only）；
 *   R2-9 竞态矩阵真实缺口补锚（accepted apply→Lease release / Runtime close /
 *        epoch bump 的确定性 FIFO 与终态）。
 *
 * 规范权威：ADR-0010 issue #134 round-2 修订节；设计记录（历史证据，非规范）：
 * wiki/raw/task_namespace-lease-replication-session_round2.md（评审全文 +
 * AC-R2 映射）；round2_conflict_report（verdict: clear；#1/#2/#5/#7/#8 对账与登记义务）；
 * round2_relevant_decisions（R2-1/R2-5/R2-8/R2-9 裁决增量）。
 *
 * 盘点说明（R2-9 只补真实缺口）：round-1 既有覆盖 = ① Registry shutdown → apply 拒绝
 * （AC-7 用例 16）；② idle 期保留复用（AC-7 用例 18，fake-timer scheduler）；③ 两终态
 * 幂等 close（AC-2/AC-7）；④ epoch fencing（AC-7 用例 17，但只锚「下一次 inbound
 * apply 触发的 fence」——bump 槽边界主动 fence 缺失）；⑤ committed fatal（AC-7 用例 19）。
 * 本文件补：in-flight apply × {Lease release / Runtime close / epoch bump} 三个矩阵格
 * （round-1 完全未覆盖 in-flight 竞态），其余矩阵格按既有覆盖在报告中如实登记。
 *
 * 红灯纪律：真实 Yjs / 真实 Runtime / 真实 registry 工厂（testing seam 受控依赖）；
 * 零源码 grep 断言；一切拒绝经返回 Promise 结算；零真实 sleep（全部微任务/门闩驱动）；
 * 预期当前代码必红的用例在标题标注「必红」，预期直接绿的锁定用例标注「绿锁定」。
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import { createMemoryPersistencePlugin } from '@nomicore/persistence';
import { createFakeTimerPlugin } from '@nomicore/persistence/testing';
import { createManualClock, createManualClockPlugin } from '@nomicore/clock/testing';
import { createNamespaceRegistryPlugin } from '@nomicore/namespace-registry';
import type { NamespaceLease, NamespaceRegistry, RegistryRandomBytes } from '@nomicore/namespace-registry';
import { createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import { Context } from '@deepseek-ai/cordis';
import { createLeaseController } from '../src/lease.js';
import type { ReplicationSessionOpenCore } from '../src/lease.js';
import type { ReplicationSessionStatus } from '../src/types.js';
import type { NamespaceRuntime } from '@nomicore/namespace-runtime';
import { createNamespaceRegistryForTesting } from '@nomicore/namespace-registry/testing';

// ═══════════════════════════════ 契约面本地声明（round-1 同款 + cast 纪律） ═══════════════════════════════

type InstanceRole = 'hub' | 'peer';

interface OpenSessionOptions {
  readonly localRole: InstanceRole;
  readonly remoteInstanceId: string;
}

interface OpenSessionResult {
  readonly ok: boolean;
  readonly session?: unknown;
  readonly code?: string;
  readonly message?: string;
}

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

interface ReplicationManagementLease {
  readonly enableReplication: () => Promise<Readonly<{ ok: boolean }>>;
  readonly bumpReplicationEpoch: () => Promise<Readonly<{ ok: boolean }>>;
}

interface SessionLeaseExt {
  readonly openReplicationSession: (options: OpenSessionOptions) => Promise<OpenSessionResult>;
}

function asRepLease(lease: NamespaceLease): NamespaceLease & ReplicationManagementLease {
  return lease as unknown as NamespaceLease & ReplicationManagementLease;
}

function asSessionLease(lease: NamespaceLease): NamespaceLease & SessionLeaseExt {
  return lease as unknown as NamespaceLease & SessionLeaseExt;
}

function expectSession(opened: OpenSessionResult | undefined): ReplicationSessionLike {
  expect(opened !== undefined, 'openReplicationSession 必须返回结果对象').toBe(true);
  const o = opened as OpenSessionResult;
  expect(o.ok, `期望 open 成功，实际：${JSON.stringify(o)}`).toBe(true);
  if (!o.ok || o.session === undefined) throw new Error('unreachable');
  return o.session as ReplicationSessionLike;
}

// ═══════════════════════════════ 基础设施（round-1 同款自包含） ═══════════════════════════════

const SCHEMA_ENVELOPE = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'phase5-replication-session-round2',
  text: 'type ROOT = { n: number; ext?: number; k1?: number; k2?: number; k3?: number; };\n',
});
const GOOD_ROOT = Object.freeze({ n: 42 });
const FIXED_MS = 1_700_000_123_456;
const ALICE: User = Object.freeze({ userId: 'u-alice' });
const REP_ID = 'c'.repeat(32);

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

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (cause: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<void>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}

/** stub Persistence：真实 Y.Doc 全链载体；saveDoc 支持可选门闩（in-flight apply 竞态
 *  确定性拉开——R6 await notifyDirty 挂起 ⇒ 已接纳 apply 处于在途）。 */
class GatedStubPersistence implements DocPersistence {
  readonly saveEvents: Array<{ readonly n: unknown }> = [];
  readonly docs = new Map<string, Y.Doc>();
  gate: Deferred | undefined;

  seedDocument(docId: string, doc: Y.Doc): void {
    this.docs.set(docId, doc);
  }

  async createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    this.docs.set(docId, doc);
    return this.makeHandle(owner, docId, doc);
  }

  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    const doc = this.docs.get(docId);
    return doc === undefined ? null : this.makeHandle(owner, docId, doc);
  }

  async saveDoc(handle: DocHandle): Promise<void> {
    if (this.gate !== undefined) await this.gate.promise;
    this.saveEvents.push({ n: handle.doc.getMap('ROOT').get('n') });
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

  liveDoc(): Y.Doc {
    const docs = [...this.docs.values()];
    if (docs.length !== 1) throw new Error(`stub 应持恰一个文档，当前 ${docs.length}`);
    return docs[0] as Y.Doc;
  }
}

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

function makeRemoteUpdate(liveDoc: Y.Doc, mutate: (doc: Y.Doc) => void): { update: Uint8Array; replica: Y.Doc } {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(liveDoc));
  mutate(peer);
  return { update: Y.encodeStateAsUpdate(peer), replica: peer };
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

/** 构造 registry（testing seam；role 经 overrides 注入——O-4 建议形状）。 */
function buildRegistry(
  persistence: DocPersistence,
  opts: { role?: InstanceRole } = {},
): { registry: NamespaceRegistry; scheduler: ReturnType<typeof createRegistryTestScheduler> } {
  const scheduler = createRegistryTestScheduler();
  const registry = createNamespaceRegistryForTesting(persistence, {
    clock: { now: () => FIXED_MS },
    scheduler,
    idleTimeoutMs: 25,
    randomBytes: makeCounterRandomBytes(),
    ...(opts.role !== undefined ? { role: opts.role } : {}),
  } as never);
  return { registry, scheduler };
}

function okLease(result: unknown): NamespaceLease {
  const r = result as { ok?: boolean; lease?: NamespaceLease };
  expect(r.ok, `期望成功，实际：${JSON.stringify(result)}`).toBe(true);
  if (!r.ok || r.lease === undefined) throw new Error('unreachable');
  return r.lease;
}

function leaseRuntimeStatus(lease: NamespaceLease): {
  readonly schema: { readonly state: string };
  readonly fatal: unknown;
} {
  return (lease.getStatus() as unknown as { runtime: unknown }).runtime as {
    readonly schema: { readonly state: string };
    readonly fatal: unknown;
  };
}

async function schemaReady(lease: NamespaceLease): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (leaseRuntimeStatus(lease).schema.state === 'ready') return;
    await Promise.resolve();
  }
  throw new Error(`schema 未在微观任务预算内就绪：${JSON.stringify(lease.getStatus())}`);
}

async function flushMicrotasks(budget = 40): Promise<void> {
  for (let i = 0; i < budget; i += 1) await Promise.resolve();
}

type Settled = { kind: 'resolved'; value: unknown } | { kind: 'rejected'; reason: unknown };

async function settleOf(p: Promise<unknown>): Promise<Settled> {
  try {
    return { kind: 'resolved', value: await p };
  } catch (reason) {
    return { kind: 'rejected', reason };
  }
}

function settledOk(s: Settled): boolean {
  return s.kind === 'resolved' && (s.value as { ok?: unknown }).ok === true;
}

// ═══════════════════════════════ R2-1：epoch fence 立即停投（Lease 面） ═══════════════════════════════

describe('R2-1 epoch fence 立即停投（Lease 面：bump 槽边界主动 fence）', () => {
  let cleanupRegistries: Array<{ shutdown(): Promise<void> }> = [];
  afterEach(async () => {
    await Promise.all(cleanupRegistries.map((r) => r.shutdown()));
    cleanupRegistries = [];
  });

  it('bump settle 后旧 session listener 对后续本地写零投递（不等下一次 inbound apply）【必红】', async () => {
    const stub = new GatedStubPersistence();
    const { registry } = buildRegistry(stub, { role: 'hub' });
    cleanupRegistries.push(registry);
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);
    expect((await asRepLease(lease).enableReplication()).ok).toBe(true);
    const session = expectSession(
      await asSessionLease(lease).openReplicationSession({ localRole: 'hub', remoteInstanceId: 'peer-a' }),
    );
    const events: Uint8Array[] = [];
    session.subscribeOwnedUpdates((u) => events.push(u));

    expect((await lease.mutateData({ op: 'set', path: ['n'], value: 7 }))?.ok).toBe(true);
    await flushMicrotasks();
    expect(events.length).toBe(1); // 基线：bump 前投递活着

    expect((await asRepLease(lease).bumpReplicationEpoch()).ok).toBe(true);
    const afterBump = events.length;

    expect((await lease.mutateData({ op: 'set', path: ['n'], value: 8 }))?.ok).toBe(true);
    await flushMicrotasks();
    expect(events.length, 'bump 后（无 inbound apply）旧 session listener 仍收到投递——fence 未在 bump 槽边界生效').toBe(afterBump);
  });

  it('bump settle 后旧 session getStatus 转终态（conflicted——当前保持 open）【必红】', async () => {
    const stub = new GatedStubPersistence();
    const { registry } = buildRegistry(stub, { role: 'hub' });
    cleanupRegistries.push(registry);
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);
    expect((await asRepLease(lease).enableReplication()).ok).toBe(true);
    const session = expectSession(
      await asSessionLease(lease).openReplicationSession({ localRole: 'hub', remoteInstanceId: 'peer-a' }),
    );
    expect(session.replicationEpoch).toBe(1);

    expect((await asRepLease(lease).bumpReplicationEpoch()).ok).toBe(true);

    const st = session.getStatus() as { state?: string; currentEpoch?: number };
    expect(st.currentEpoch).toBe(2); // fence 可观测
    expect(st.state, 'bump 后旧 session 未转 conflicted（fence 需下一次 inbound apply 才触发）').toBe('conflicted');
  });

  it('bump settle 后同 Lease 可 open 新 epoch session（终态释放槽位——当前 SESSION_EXISTS）【必红】', async () => {
    const stub = new GatedStubPersistence();
    const { registry } = buildRegistry(stub, { role: 'hub' });
    cleanupRegistries.push(registry);
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);
    expect((await asRepLease(lease).enableReplication()).ok).toBe(true);
    expectSession(
      await asSessionLease(lease).openReplicationSession({ localRole: 'hub', remoteInstanceId: 'peer-a' }),
    );

    expect((await asRepLease(lease).bumpReplicationEpoch()).ok).toBe(true);

    const reopened = await asSessionLease(lease).openReplicationSession({
      localRole: 'hub',
      remoteInstanceId: 'peer-b',
    });
    const s2 = expectSession(reopened); // 旧 session 必须已终态释放槽位
    expect(s2.replicationEpoch).toBe(2); // 新 open 冻结新 epoch
  });
});

// ═══════════════════════════════ R2-5：lease release hostile seam ═══════════════════════════════

describe('R2-5 lease release hostile seam（ADR 0009 L42/L150 + 修订节 L246）', () => {
  /** 敌意 session core（十键面——类型面完整满足 ReplicationSessionOpenCore；敌意行为
   * 只在实现体内注入（抛错/计数），不以 `as unknown as` 破坏/放宽签名）。 */
  function makeHostileCore(opts: {
    counts: { close: number; getStatus: number };
    getStatus?: () => Readonly<ReplicationSessionStatus>;
    closeImpl?: () => Promise<void>;
  }): ReplicationSessionOpenCore {
    const core: ReplicationSessionOpenCore = {
      localRole: 'hub',
      remoteInstanceId: 'peer-a',
      replicationId: REP_ID,
      replicationEpoch: 1,
      encodeStateVector: () => new Uint8Array(0),
      encodeDiff: () => new Uint8Array(0),
      subscribeOwnedUpdates: () => () => {},
      applyRemoteUpdate: async () => ({ ok: true }),
      getStatus:
        opts.getStatus ??
        ((): Readonly<ReplicationSessionStatus> => {
          opts.counts.getStatus += 1;
          return makeHostileStatus();
        }),
      close:
        opts.closeImpl ??
        (async (): Promise<void> => {
          opts.counts.close += 1;
        }),
    };
    return core;
  }

  /** 全形冻结 status 产物（敌意 core 的 getStatus 默认/分叉值——类型面完整，零缺字段）。
   *  §15.3-1（R2.2 同步清单）：ReplicationSessionStatus 增第 11 字段 needsResync
   *  （ADR 0010 L113 溢出标记）——fixture 类型面同步，断言本体零改动。 */
  function makeHostileStatus(
    overrides: { state?: 'open' | 'closed' | 'conflicted' } = {},
  ): Readonly<ReplicationSessionStatus> {
    return Object.freeze({
      state: overrides.state ?? 'open',
      localRole: 'hub',
      direction: 'hub-to-peer',
      remoteInstanceId: 'peer-a',
      replicationId: REP_ID,
      replicationEpoch: 1,
      currentEpoch: 1,
      rootValidation: 'none',
      durability: Object.freeze({ memoryCaughtUp: false, diskCaughtUp: false as const }),
      observerFailures: 0,
      needsResync: false,
    });
  }

  /** 直构 lease controller（registry.ts 经 deps 注入 seam；测试经包内通道直取——
   *  hostile seam 需要绕过真实 core 的注入面，属评审要求的最小 seam 测试）。 */
  function makeLeaseWithHostileCore(core: ReplicationSessionOpenCore): { lease: NamespaceLease; onReleased: { called: number }; set: Set<NamespaceLease> } {
    const set = new Set<NamespaceLease>();
    const onReleased = { called: 0 };
    const entry = {
      key: 'ns-r2',
      generation: 1n,
      owner: Object.freeze({ userId: 'u-alice' }),
      namespaceId: 'ns-r2',
      runtime: {} as NamespaceRuntime,
      leases: set,
    };
    const lease = createLeaseController(
      entry,
      undefined,
      () => {
        onReleased.called += 1;
      },
      {
        drawReplicationId: () => ({ ok: true, replicationId: REP_ID }),
        role: 'hub' as const,
        openReplicationSessionCore: () => ({ ok: true, core }),
      },
    );
    set.add(lease);
    return { lease, onReleased, set };
  }

  async function openHostile(lease: NamespaceLease): Promise<void> {
    const opened = await asSessionLease(lease).openReplicationSession({
      localRole: 'hub',
      remoteInstanceId: 'peer-a',
    });
    expect(opened.ok, `hostile open 应成功：${JSON.stringify(opened)}`).toBe(true);
  }

  it('getStatus 同步抛错：release 不同步抛；released 标记 + entry 删除 + onReleased 恰一次；close 仍被尝试【必红】', async () => {
    const counts = { close: 0, getStatus: 0 };
    const core = makeHostileCore({
      counts,
      getStatus: () => {
        counts.getStatus += 1;
        throw new Error('session status seam down (deterministic)');
      },
    });
    const { lease, onReleased, set } = makeLeaseWithHostileCore(core);
    await openHostile(lease);

    let syncThrow: unknown;
    try {
      void lease.release();
    } catch (err) {
      syncThrow = err;
    }
    expect(syncThrow, '首次 release() 不得同步抛出（ADR 0009 L42 same-Promise 稳定面）').toBeUndefined();

    // 释放事实完整（半释放 = 释放事实缺失或清理缺失）
    expect(lease.getStatus()).toMatchObject({ lease: 'released' });
    expect(set.has(lease)).toBe(false); // entry 删除完成
    expect(onReleased.called, 'onReleased 必须恰一次（guaranteed cleanup 路径）').toBe(1);
    expect(counts.close, 'session.close 仍被尝试（幂等直调——不先查状态）').toBe(1);

    // same-Promise 稳定：二次 release 返回同一实例且不抛
    const r1 = lease.release();
    const r2 = lease.release();
    expect(r1).toBe(r2);
  });

  it('close 同步抛错：release 不同步抛；released 可观测；onReleased 恰一次【必红】', async () => {
    const counts = { close: 0, getStatus: 0 };
    const core = makeHostileCore({
      counts,
      closeImpl: () => {
        counts.close += 1;
        throw new Error('session close seam down (deterministic)');
      },
    });
    const { lease, onReleased } = makeLeaseWithHostileCore(core);
    await openHostile(lease);

    let syncThrow: unknown;
    try {
      void lease.release();
    } catch (err) {
      syncThrow = err;
    }
    expect(syncThrow, 'close 抛错不得使首次 release 同步抛出（隔离到 guaranteed cleanup 路径）').toBeUndefined();
    expect(lease.getStatus()).toMatchObject({ lease: 'released' });
    expect(onReleased.called, 'close 抛错不得跳过 onReleased（半释放）').toBe(1);
  });

  it('session 已终态（state 非 open）：release 仍幂等直调 close【必红】', async () => {
    const counts = { close: 0, getStatus: 0 };
    const core = makeHostileCore({
      counts,
      getStatus: () => {
        counts.getStatus += 1;
        return makeHostileStatus({ state: 'closed' }); // 终态——但 release 仍应尝试 close（幂等直调）
      },
    });
    const { lease, onReleased } = makeLeaseWithHostileCore(core);
    await openHostile(lease);

    let syncThrow: unknown;
    try {
      void lease.release();
    } catch (err) {
      syncThrow = err;
    }
    expect(syncThrow).toBeUndefined();
    expect(lease.getStatus()).toMatchObject({ lease: 'released' });
    expect(onReleased.called).toBe(1);
    expect(counts.close, '非 open 状态的既有 session 也必须收到 close()（幂等直调——不先查状态）').toBe(1);
  });
});

// ═══════════════════════════════ R2-8：plugin role 贯通 ═══════════════════════════════

describe('R2-8 生产 Cordis plugin 的 peer role 装配（config → 校验 → 构造 → 静态角色行为）', () => {
  it("plugin config 接受 role:'hub'|'peer'（缺省 hub）；role 与 idleTimeoutMs 可组合【必红】", () => {
    // 当前 resolvePluginIdleTimeoutMs 仅接受 idleTimeoutMs 单键——任何 role 键 → TypeError
    //（config 的 TS 类型面同样尚未含 role——类型错误即契约缺口；行为断言以运行时为准）
    expect(() => createNamespaceRegistryPlugin({ role: 'hub' } as never)).not.toThrow();
    expect(() => createNamespaceRegistryPlugin({ role: 'peer' } as never)).not.toThrow();
    expect(() => createNamespaceRegistryPlugin({ role: 'peer', idleTimeoutMs: 25 } as never)).not.toThrow();
    expect(() => createNamespaceRegistryPlugin({ role: 'hub', idleTimeoutMs: 0 } as never)).not.toThrow();
    expect(() => createNamespaceRegistryPlugin()).not.toThrow(); // 缺省 → 'hub'（既有零回归面）
  });

  it('非法 role 值 loud 拒绝（NAMESPACE_REGISTRY_ROLE_INVALID 语义——当前误报 PLUGIN_CONFIG）【必红】', () => {
    for (const bad of ['solo', 'HUB', 42, null] as unknown[]) {
      let threw: unknown;
      try {
        createNamespaceRegistryPlugin({ role: bad } as never);
      } catch (err) {
        threw = err;
      }
      expect(threw, `非法 role ${JSON.stringify(bad)} 必须 loud 拒绝`).toBeInstanceOf(Error);
      if (threw instanceof Error) {
        expect(threw.message, '非法 role 拒绝必须报 ROLE_INVALID 域（O-4 既有词汇），而非键集误报').toContain(
          'NAMESPACE_REGISTRY_ROLE_INVALID',
        );
      }
    }
  });

  it('peer-role Registry 经 plugin 组合：本地 replaceSchema/enableReplication 以 REPLICATION_ROLE_PERMISSION 拒；hub 对照正常【必红】', async () => {
    // peer 装配：插件工厂当前对 { role } 抛 NAMESPACE_REGISTRY_PLUGIN_CONFIG —— 组合无法成立
    const peerCtx = new Context();
    createManualClockPlugin(createManualClock(FIXED_MS)).apply(peerCtx);
    createFakeTimerPlugin(createRegistryTestScheduler()).apply(peerCtx);
    createMemoryPersistencePlugin().apply(peerCtx);
    const peerPlugin = createNamespaceRegistryPlugin({ role: 'peer', idleTimeoutMs: 300_000 } as never);
    const peerFiber = peerCtx.plugin(peerPlugin);
    await peerFiber;
    const peerRegistry = peerPlugin.instance;
    expect(peerRegistry, 'peer 插件配置必须可装配出 Registry（静态 role 贯通）').toBeDefined();
    if (peerRegistry === undefined) throw new Error('unreachable');

    const created = await peerRegistry.create(newContractInput());
    expect(created.ok).toBe(true);
    const peerLease = okLease(created);
    await schemaReady(peerLease);

    const r1 = await peerLease.replaceSchema({ schema: SCHEMA_ENVELOPE });
    expect(r1.ok, 'peer Registry 的本地 replaceSchema 必须角色权限拒绝（ADR 0010 L118）').toBe(false);
    expect(JSON.stringify(r1)).toContain('REPLICATION_ROLE_PERMISSION');
    const r2 = await peerLease.replaceSchema({ schema: SCHEMA_ENVELOPE });
    expect(JSON.stringify(r2)).toBe(JSON.stringify(r1)); // 稳定：重复调用同形状错误
    const enable = await asRepLease(peerLease).enableReplication();
    expect(enable.ok).toBe(false); // peer 的 enable hub-only（L120）
    expect(JSON.stringify(enable)).toContain('REPLICATION_ROLE_PERMISSION');

    // hub 对照：同一 plugin 面（缺省 role）装配 → replaceSchema 正常
    const hubCtx = new Context();
    createManualClockPlugin(createManualClock(FIXED_MS)).apply(hubCtx);
    createFakeTimerPlugin(createRegistryTestScheduler()).apply(hubCtx);
    createMemoryPersistencePlugin().apply(hubCtx);
    const hubPlugin = createNamespaceRegistryPlugin({ idleTimeoutMs: 300_000 }); // 缺省 role → hub
    const hubFiber = hubCtx.plugin(hubPlugin);
    await hubFiber;
    const hubRegistry = hubPlugin.instance;
    expect(hubRegistry).toBeDefined();
    if (hubRegistry === undefined) throw new Error('unreachable');
    const hubCreated = await hubRegistry.create(newContractInput());
    expect(hubCreated.ok).toBe(true);
    const hubLease = okLease(hubCreated);
    await schemaReady(hubLease);
    const hubOk = await hubLease.replaceSchema({ schema: SCHEMA_ENVELOPE });
    expect(hubOk.ok, 'hub 实例本地 replaceSchema 不受角色限制').toBe(true);

    await peerRegistry.shutdown();
    await hubRegistry.shutdown();
    await peerCtx.fiber.dispose();
    await hubCtx.fiber.dispose();
  });
});

// ═══════════════════════════════ R2-9：竞态矩阵真实缺口（in-flight apply 三格） ═══════════════════════════════

describe('R2-9 竞态矩阵缺口补锚：accepted apply × {Lease release / Runtime close / epoch bump}', () => {
  async function setupInFlight(): Promise<{
    stub: GatedStubPersistence;
    registry: NamespaceRegistry;
    lease: NamespaceLease;
    session: ReplicationSessionLike;
  }> {
    const stub = new GatedStubPersistence();
    const { registry } = buildRegistry(stub, { role: 'hub' });
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);
    expect((await asRepLease(lease).enableReplication()).ok).toBe(true);
    const session = expectSession(
      await asSessionLease(lease).openReplicationSession({ localRole: 'hub', remoteInstanceId: 'peer-a' }),
    );
    return { stub, registry, lease, session };
  }

  it('accepted apply → Lease release：在途 apply 不被取消、先于 close barrier 结算；release 同步失效【绿锁定】', async () => {
    const { stub, registry, lease, session } = await setupInFlight();
    const gate = deferred();
    stub.gate = gate; // 此后 saveDoc（R6）进入门闩 → in-flight apply 确定挂起

    const { update } = makeRemoteUpdate(stub.liveDoc(), (peer) => {
      peer.getMap('ROOT').set('k1', 1);
    });
    const order: string[] = [];
    const applyP = session.applyRemoteUpdate(update);
    void applyP.then(() => order.push('apply'));
    const releaseP = lease.release();
    const closeP = session.close(); // 与 release 调用的 close 同一核心 promise（幂等缓存）
    void closeP.then(() => order.push('close'));

    await flushMicrotasks();
    expect(order, 'in-flight apply（门闩）与 close barrier 均未 settle').toEqual([]);
    expect(lease.getStatus()).toMatchObject({ lease: 'released' }); // release 同步失效

    gate.resolve();
    const applied = await settleOf(applyP);
    expect(settledOk(applied), 'release 不取消已接纳 apply（ADR 0009 L42）').toBe(true);
    await releaseP;
    await closeP;
    expect(order, 'FIFO：已接纳 apply 先于 close barrier 结算').toEqual(['apply', 'close']);

    // release 后新 apply：NAMESPACE_LEASE_RELEASED 拒绝
    const late = await settleOf(
      session.applyRemoteUpdate(
        makeRemoteUpdate(stub.liveDoc(), (peer) => {
          peer.getMap('ROOT').set('k2', 2);
        }).update,
      ),
    );
    expect(late.kind).toBe('resolved');
    if (late.kind === 'resolved') {
      expect((late.value as { ok?: boolean; code?: string }).ok).toBe(false);
      expect(JSON.stringify(late.value)).toContain('NAMESPACE_LEASE_RELEASED');
    }
    await registry.shutdown();
  });

  it('accepted apply → Runtime close（registry shutdown）：apply 先于 close barrier 排空；session 终态非 open【必红】', async () => {
    const { stub, registry, lease, session } = await setupInFlight();
    const gate = deferred();
    stub.gate = gate;

    const { update } = makeRemoteUpdate(stub.liveDoc(), (peer) => {
      peer.getMap('ROOT').set('k1', 1);
    });
    const order: string[] = [];
    const applyP = session.applyRemoteUpdate(update);
    void applyP.then(() => order.push('apply'));
    const shutdownP = registry.shutdown();
    void shutdownP.then(() => order.push('shutdown'));

    await flushMicrotasks();
    expect(order, 'in-flight apply + close barrier 均挂起').toEqual([]);

    gate.resolve();
    const applied = await settleOf(applyP);
    expect(settledOk(applied), 'close 前已接纳 apply 无条件排空（ADR 0008 L93）').toBe(true);
    await shutdownP;
    expect(order, 'FIFO：已接纳 apply 先于 Runtime close barrier').toEqual(['apply', 'shutdown']);

    const st = session.getStatus() as { state?: string };
    expect(st.state, 'Runtime close 后 session 必须已终止（当前保持 open）').not.toBe('open');
  });

  it('accepted apply → epoch bump：FIFO 结算序；bump 后旧 session 终态【必红】', async () => {
    const { stub, registry, lease, session } = await setupInFlight();
    const gate = deferred();
    stub.gate = gate;

    const { update } = makeRemoteUpdate(stub.liveDoc(), (peer) => {
      peer.getMap('ROOT').set('k1', 1);
    });
    const order: string[] = [];
    const applyP = session.applyRemoteUpdate(update);
    void applyP.then(() => order.push('apply'));
    const bumpP = asRepLease(lease).bumpReplicationEpoch();
    void bumpP.then(() => order.push('bump'));

    await flushMicrotasks();
    expect(order).toEqual([]);

    gate.resolve();
    expect(settledOk(await settleOf(applyP)), '在途 apply（epoch 1 仍有效）必须完成').toBe(true);
    const bump = await bumpP;
    expect(bump.ok).toBe(true);
    expect(order, 'FIFO：[apply, bump]——bump 槽排在已接纳 apply 之后').toEqual(['apply', 'bump']);

    const st = session.getStatus() as { state?: string };
    expect(st.state, 'bump 后旧 session 必须已终态（fence 于 bump 槽边界主动生效）').not.toBe('open');
    await registry.shutdown();
  });
});

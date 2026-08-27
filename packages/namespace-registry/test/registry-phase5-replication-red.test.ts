/**
 * SA6 红灯锚定 — issue #132（Phase 5: enable replication identity and epoch
 * management）AC-1..AC-6：Hub 显式复制管理操作 enableReplication /
 * bumpReplicationEpoch 与 META 复制保留字段（ADR 0010「复制谱系与 epoch」节）。
 *
 * 契约来源（ADR 0010 / docs/phases/phase-5-websocket-replication.md §实施切片 1 /
 * 相关决议文件 task_phase5-replication-identity-epoch_relevant_decisions.md）：
 * - AC-1：META 保留并投影 replicationId（128-bit 随机值 = 32 位小写 hex）与
 *   replicationEpoch（从 1 开始的十进制安全整数）；
 * - AC-2：enableReplication 经唯一 write sequencer 原子安装身份 + epoch 1并登记
 *   dirty（notifyDirty 时刻身份已提交——同一槽序）；
 * - AC-3：重复 enable 幂等或返回稳定文档化结果，绝不改变身份（含枚举后重复 enable
 *   不得重置 epoch）；
 * - AC-4：bumpReplicationEpoch 是 Hub 的唯一独占写面（普通业务写 zero-touch META
 *   复制保留字段）、sequenced（与 enable 共享唯一 FIFO）、monotonic、达
 *   MAX_SAFE_INTEGER 拒绝提升不回绕、committed/fatal 事实诚实保留；
 * - AC-5：Lease/Open 与 Runtime status 可区分 replication-disabled / enabled
 *   identity / identity change（值比较可判别），且不暴露 mutable META 引用；
 * - AC-6：并发 enable/bump、persistence-degraded、close/fatal 竞态、retry 行为、
 *   Memory/File 持久化恢复全链覆盖。
 *
 * 红灯机制（基线 = 无任何复制管理面；META 无保留字段；status 无 replication 域）：
 * - 一切 `lease.enableReplication()` / `lease.bumpReplicationEpoch()` 调用在基线上
 *   抛 `TypeError: … is not a function`（方法不存在）——特征缺失的红；
 * - `getMetadata()` 的 replicationId/replicationEpoch 键与
 *   `getStatus().runtime.replication` 域在基线上缺席；
 * - 本文件以本地结构声明 + cast 表达新契约调用面（SA3 落地后类型锚见
 *   registry-phase5-replication-surface.test-d.ts），避免 tsconfig.typecheck.json
 *   程序内的 TS2339 噪声污染类型轴信号（沿 registry-phase5-identity-red.test.ts
 *   R2 修订先例：as never / 结构性 cast）。
 *
 * 全部 test 在基线上必须失败（红）；本文件零源码 grep 断言、零 mock 本地服务
 * （yjs/Memory/File Persistence 全部真实），仅脚本化可控随机源与受控 scheduler。
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
// issue #108 正式耐久等待模式（只读引用，未修改）：直接轮询磁盘 committed 快照文件，
// 规避 FilePersistence flush 的 writeFile→rename 与 dispose abort 的已知竞态。
import { waitDurableSnapshot } from '../../namespace-runtime/test/durable-snapshot-wait.js';

// ═══════════════════════════════ 契约面本地声明 ═══════════════════════════════

/**
 * 新契约 Lease 复制管理面（ADR 0010 冻结名 enableReplication /
 * bumpReplicationEpoch；返回值仅锚定 `ok` 判别——结果联合的其余字段属 SA1 设计，
 * 测试不预设）。SA3 落地后类型面锚见 surface.test-d.ts。
 */
interface ReplicationManagementLease {
  readonly enableReplication: () => Promise<Readonly<{ ok: boolean }>>;
  readonly bumpReplicationEpoch: () => Promise<Readonly<{ ok: boolean }>>;
}

/** 新契约 status 复制域（AC-5 判别面：disabled / enabled 两态 + 事实值）。 */
interface ReplicationStatusDomain {
  readonly state: 'disabled' | 'enabled';
  readonly replicationId?: string;
  readonly replicationEpoch?: number;
}

/** getMetadata 的复制保留字段投影（AC-1 格式面）。 */
interface ReplicationMetaProjection {
  readonly replicationId?: unknown;
  readonly replicationEpoch?: unknown;
}

/** Lease → 复制管理面（cast 仅为类型面消除；运行时对象原样）。 */
function asRepLease(lease: NamespaceLease): NamespaceLease & ReplicationManagementLease {
  return lease as unknown as NamespaceLease & ReplicationManagementLease;
}

/** Lease → status 复制域投影（基线 absent → undefined，断言点判红/绿）。 */
function repStatus(lease: NamespaceLease): ReplicationStatusDomain {
  const runtime = lease.getStatus().runtime as unknown as { replication?: ReplicationStatusDomain };
  return runtime.replication as ReplicationStatusDomain;
}

/** Lease → META 复制字段投影（getMetadata 深拷贝面）。 */
function repMeta(lease: NamespaceLease): ReplicationMetaProjection {
  return lease.getMetadata() as unknown as ReplicationMetaProjection;
}

/**
 * Lease → runtime status 投影（cast 消除 released 联合的 runtime:null 分支与
 * 基线缺失字段——本文件一律经此观察 status，避免 tsconfig.typecheck.json 程序内
 * 的 TS2531/TS18047 噪声）。
 */
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
  id: 'phase5-replication-red',
  text: 'type ROOT = { n: number; };\n',
});
const GOOD_ROOT = Object.freeze({ n: 42 });
const FIXED_MS = 1_700_000_123_456;
const ALICE: User = Object.freeze({ userId: 'u-alice' });

/** 确定性计数随机源（第 n 次 = `ns-`+n 的 32 位 hex；仅用于 Registry 的 namespaceId
 *  生成面——复制身份随机源的注入位置属 SA1 设计，SA6 不做消耗计数锚定）。 */
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

/**
 * stub Persistence：真实 Y.Doc / 真实 Runtime 全链载体（create 经 doc-runtime
 * 构造含 META/SCHEMA/ROOT 的真实文档），仅 saveDoc 为计数 + 通知时刻 META 快照
 * 记录（AC-2 原子可见性 / AC-4 FIFO 序的可观测面）。不 mock I/O 语义。
 */
class StubReplicationPersistence implements DocPersistence {
  readonly saveEvents: Array<{ readonly replicationId: unknown; readonly replicationEpoch: unknown }> = [];
  readonly createCalls: Array<{ owner: User; docId: string }> = [];
  readonly loadCalls: Array<{ owner: User; docId: string }> = [];
  private readonly committed = new Map<string, Y.Doc>();

  seedDocument(docId: string, doc: Y.Doc): void {
    this.committed.set(docId, doc);
  }

  async createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    this.createCalls.push({ owner, docId });
    if (this.committed.has(docId)) {
      throw new DocDuplicateError();
    }
    this.committed.set(docId, doc);
    return this.makeHandle(owner, docId, doc);
  }

  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    this.loadCalls.push({ owner, docId });
    const doc = this.committed.get(docId);
    return doc === undefined ? null : this.makeHandle(owner, docId, doc);
  }

  async saveDoc(handle: DocHandle): Promise<void> {
    // 通知时刻快照：write sequencer 槽序 = transaction 提交 → notifyDirty，
    // 因此本快照即该槽提交后的 META 状态（原子安装 / FIFO 次序的观测面）。
    const meta = handle.doc.getMap('META');
    this.saveEvents.push({
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
}

/** 手工种子文档（溢出/预启用场景）：META 含 docId/createdAt + 可选复制保留字段。 */
function makeSeedDoc(
  docId: string,
  opts: { replicationId?: string; replicationEpoch?: number; root?: number } = {},
): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(SCHEMA_ENVELOPE)) sc.set(k, v);
  const meta = doc.getMap('META');
  meta.set('docId', docId);
  meta.set('createdAt', FIXED_MS);
  if (opts.replicationId !== undefined) meta.set('replicationId', opts.replicationId);
  if (opts.replicationEpoch !== undefined) meta.set('replicationEpoch', opts.replicationEpoch);
  doc.getMap('ROOT').set('n', opts.root ?? 42);
  return doc;
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

function makeRegistry(
  persistence: DocPersistence,
  opts: {
    runtimeFactory?: (handle: DocHandle, notifyDirty: () => Promise<void>) => NamespaceRuntime;
  } = {},
): NamespaceRegistry {
  return createNamespaceRegistryForTesting(persistence, {
    clock: { now: () => FIXED_MS },
    scheduler: createRegistryTestScheduler(),
    idleTimeoutMs: 25,
    randomBytes: makeCounterRandomBytes(),
    ...(opts.runtimeFactory !== undefined ? { runtimeFactory: opts.runtimeFactory } : {}),
  } as never);
}

function okLease(result: unknown): NamespaceLease {
  const r = result as { ok?: boolean; lease?: NamespaceLease };
  expect(r.ok, `期望成功，实际：${JSON.stringify(result)}`).toBe(true);
  if (!r.ok || r.lease === undefined) throw new Error('unreachable');
  return r.lease;
}

function okIssue(result: unknown): { ok: false; code: string | undefined; message: string | undefined } {
  const r = result as { ok?: boolean; code?: string; message?: string };
  expect(r.ok, `期望领域拒绝，实际：${JSON.stringify(result)}`).toBe(false);
  return { ok: false, code: r.code, message: r.message };
}

/** 微任务预算内等待 Runtime P0 就绪（真实 Runtime + 全微任务链的确定性栅栏）。 */
async function schemaReady(lease: NamespaceLease): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (leaseRuntimeStatus(lease).schema.state === 'ready') return;
    await Promise.resolve();
  }
  throw new Error(`schema 未在微观任务预算内就绪：${JSON.stringify(lease.getStatus())}`);
}

const REP_ID_PATTERN = /^[0-9a-f]{32}$/;

// ═══════════════════════════════ AC-1：META 保留字段 ═══════════════════════════════

describe('AC-1 META 保留并投影 replicationId / replicationEpoch（ADR 0010 冻结格式）', () => {
  it('未 enable 时 META 无复制字段、status 为 replication-disabled；enable 后两字段以冻结格式投影', async () => {
    const stub = new StubReplicationPersistence();
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);

    // —— 基线红点 1：enableReplication 不存在（TypeError）——
    const installed = await asRepLease(lease).enableReplication();
    expect(installed.ok).toBe(true);

    // AC-1 格式面（ADR 0010 冻结：32 位小写 hex / 从 1 开始的十进制安全整数）
    const meta = repMeta(lease);
    expect(typeof meta.replicationId).toBe('string');
    expect(meta.replicationId).toMatch(REP_ID_PATTERN);
    expect(meta.replicationId).toHaveLength(32);
    expect(meta.replicationEpoch).toBe(1);
    expect(Number.isSafeInteger(meta.replicationEpoch as number)).toBe(true);
    // 复制身份 ≠ namespaceId / ≠ SCHEMA 信封 id（ADR 0010 明文区分）
    expect(meta.replicationId).not.toBe(lease.namespaceId);
    expect(meta.replicationId).not.toBe(SCHEMA_ENVELOPE.id);

    // status 同步投影（AC-5 判别面；值与 META 一致）
    const status = repStatus(lease);
    expect(status.state).toBe('enabled');
    expect(status.replicationId).toBe(meta.replicationId);
    expect(status.replicationEpoch).toBe(1);

    // —— 基线红点 2：META 复制字段与 status.replication 域在基线上均缺席，
    //     上方断言在 enableReplication 调用处即红；以下为绿判后的完整链 ——
    const fresh = repMeta(lease);
    expect(fresh.replicationId).toBe(meta.replicationId);
    expect(fresh.replicationEpoch).toBe(1);
  });

  it('未启用命名空间：META 无 replicationId/replicationEpoch 键，status 判别为 disabled（AC-5 判别面）', async () => {
    const stub = new StubReplicationPersistence();
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);

    expect(repMeta(lease).replicationId).toBeUndefined();
    expect(repMeta(lease).replicationEpoch).toBeUndefined();
    expect(repStatus(lease)).toEqual({ state: 'disabled' });
  });
});

// ═══════════════════════════════ AC-2：enable 原子安装 + dirty ═══════════════════

describe('AC-2 enableReplication 原子安装 128-bit 身份 + epoch 1（sequencer + dirty notification）', () => {
  it('enable 成功：通知时刻 META 已含身份+epoch 1（同槽原子），saveDoc 恰一次，status 同步 enabled', async () => {
    const stub = new StubReplicationPersistence();
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);

    const result = await asRepLease(lease).enableReplication();
    expect(result.ok).toBe(true);

    // 原子安装：notifyDirty（saveDoc）时刻 META 已同时含两字段（单槽单事务提交后才通知）
    expect(stub.saveEvents).toHaveLength(1);
    expect(stub.saveEvents[0]?.replicationId).toMatch(REP_ID_PATTERN);
    expect(stub.saveEvents[0]?.replicationEpoch).toBe(1);

    // dirty 登记后 META/状态一致（read-your-write：写 Promise 返回后观察）
    const meta = repMeta(lease);
    expect(meta.replicationId).toBe(stub.saveEvents[0]?.replicationId);
    expect(meta.replicationEpoch).toBe(1);
    expect(repStatus(lease).state).toBe('enabled');
    expect(repStatus(lease).replicationEpoch).toBe(1);
  });

  it('并发 enable×2 + bump×2 与唯一 sequencer 同序：通知序 [1,2,3]、monotonic、单一身份不漂移', async () => {
    const stub = new StubReplicationPersistence();
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);

    const rep = asRepLease(lease);
    const results = await Promise.all([
      rep.enableReplication(),
      rep.bumpReplicationEpoch(),
      rep.bumpReplicationEpoch(),
    ]);
    for (const r of results) expect(r.ok).toBe(true);

    // FIFO 序 = 通知序（enable 槽先交付 epoch1，bump 槽依次 2、3）
    expect(stub.saveEvents).toHaveLength(3);
    expect(stub.saveEvents.map((e) => e.replicationEpoch)).toEqual([1, 2, 3]);
    const ids = new Set(stub.saveEvents.map((e) => e.replicationId));
    expect(ids.size).toBe(1); // 单一复制身份贯穿（enable 只安装一次）

    const meta = repMeta(lease);
    expect(meta.replicationEpoch).toBe(3);
    expect(repStatus(lease).replicationEpoch).toBe(3);
  });
});

// ═══════════════════════════════ AC-3：重复 enable ═══════════════════════════════

describe('AC-3 重复 enable 幂等/稳定结果，绝不改变身份', () => {
  it('二次 enable：结果稳定、身份不变、epoch 不重置；bump 后再 enable 亦不重置 epoch', async () => {
    const stub = new StubReplicationPersistence();
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);

    const rep = asRepLease(lease);
    expect((await rep.enableReplication()).ok).toBe(true);
    const id1 = repMeta(lease).replicationId;
    const epoch1 = repMeta(lease).replicationEpoch;
    expect(id1).toMatch(REP_ID_PATTERN);
    expect(epoch1).toBe(1);

    // 重复 enable：必须结算且不改变身份（幂等或稳定文档化结果——本测试只锚定不变式）
    const again = await rep.enableReplication();
    expect(again.ok).toBe(true);
    expect(repMeta(lease).replicationId).toBe(id1);
    expect(repMeta(lease).replicationEpoch).toBe(1);
    expect(repStatus(lease).replicationId).toBe(id1);

    // bump 后再 enable：epoch 保持 2，绝不回置 1
    expect((await rep.bumpReplicationEpoch()).ok).toBe(true);
    expect(repMeta(lease).replicationEpoch).toBe(2);
    const afterBump = await rep.enableReplication();
    expect(afterBump.ok).toBe(true);
    expect(repMeta(lease).replicationId).toBe(id1);
    expect(repMeta(lease).replicationEpoch).toBe(2);
  });
});

// ═══════════════════════════════ AC-4：bumpReplicationEpoch ═══════════════════════

describe('AC-4 bumpReplicationEpoch：独占写面、sequenced、monotonic、overflow 拒升、committed/fatal 事实', () => {
  it('bump monotonic：epoch 2→3 递进、身份不变、status 同步；普通 ROOT/SCHEMA 写 zero-touch 复制字段', async () => {
    const stub = new StubReplicationPersistence();
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);

    const rep = asRepLease(lease);
    expect((await rep.enableReplication()).ok).toBe(true);
    const id0 = repMeta(lease).replicationId;

    expect((await rep.bumpReplicationEpoch()).ok).toBe(true);
    expect(repMeta(lease).replicationEpoch).toBe(2);
    expect(repMeta(lease).replicationId).toBe(id0);
    expect((await rep.bumpReplicationEpoch()).ok).toBe(true);
    expect(repMeta(lease).replicationEpoch).toBe(3);
    expect(repStatus(lease).replicationEpoch).toBe(3);
    expect(repStatus(lease).replicationId).toBe(id0);

    // Hub-only 独占写面（ADR 0010「只能由 hub 的显式复制管理操作修改」）：
    // 普通业务写（ROOT mutate + SCHEMA replace）对复制字段 zero-touch
    expect((await lease.mutateRoot({ op: 'set', path: ['n'], value: 7 }))?.ok).toBe(true);
    expect((await lease.mutateRoot({ op: 'set', path: ['n'], value: 8 }))?.ok).toBe(true);
    expect((await lease.replaceSchema({ schema: SCHEMA_ENVELOPE }))?.ok).toBe(true);
    expect(repMeta(lease).replicationId).toBe(id0);
    expect(repMeta(lease).replicationEpoch).toBe(3);

    // 试图经普通业务写触达 META 复制字段：领域拒绝、零写入（META 不变）
    const foreign = await lease.mutateRoot({
      op: 'set',
      path: ['META', 'replicationEpoch'],
      value: 999,
    });
    expect(foreign?.ok).toBe(false);
    expect(repMeta(lease).replicationEpoch).toBe(3);
    expect(repMeta(lease).replicationId).toBe(id0);
  });

  it('overflow：epoch 达 Number.MAX_SAFE_INTEGER 拒绝提升、绝不回绕', async () => {
    const stub = new StubReplicationPersistence();
    const id0 = 'f'.repeat(32);
    stub.seedDocument('ns-seeded-overflow', makeSeedDoc('ns-seeded-overflow', { replicationId: id0, replicationEpoch: Number.MAX_SAFE_INTEGER }));
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.open(ALICE, 'ns-seeded-overflow'));
    await schemaReady(lease);

    expect(repStatus(lease).state).toBe('enabled'); // 预启用文档：status 从 META 投影
    expect(repStatus(lease).replicationEpoch).toBe(Number.MAX_SAFE_INTEGER);

    const rejected = await asRepLease(lease).bumpReplicationEpoch();
    expect(rejected.ok).toBe(false); // 拒绝提升（结果面拒绝，非回绕）
    expect(repMeta(lease).replicationEpoch).toBe(Number.MAX_SAFE_INTEGER);
    expect(repMeta(lease).replicationId).toBe(id0);
  });

  it('overflow 边界：MAX-1 → bump 成功至 MAX → 再 bump 拒绝，epoch 保持 MAX', async () => {
    const stub = new StubReplicationPersistence();
    const id0 = 'e'.repeat(32);
    stub.seedDocument('ns-seeded-edge', makeSeedDoc('ns-seeded-edge', { replicationId: id0, replicationEpoch: Number.MAX_SAFE_INTEGER - 1 }));
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.open(ALICE, 'ns-seeded-edge'));
    await schemaReady(lease);

    const rep = asRepLease(lease);
    expect((await rep.bumpReplicationEpoch()).ok).toBe(true);
    expect(repMeta(lease).replicationEpoch).toBe(Number.MAX_SAFE_INTEGER);
    expect(repMeta(lease).replicationId).toBe(id0);

    const rejected = await rep.bumpReplicationEpoch();
    expect(rejected.ok).toBe(false);
    expect(repMeta(lease).replicationEpoch).toBe(Number.MAX_SAFE_INTEGER); // 不回绕为 1
    expect(repStatus(lease).replicationEpoch).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('fatal 事实：notify-dirty 失败 → RuntimeWriteFatalError committed:true；META 已提升（事实保留）；后续写 RUNTIME_WRITE_DISABLED；读取保留', async () => {
    const stub = new StubReplicationPersistence();
    const gate: { failing: boolean; calls: number; cause: Error } = {
      failing: false,
      calls: 0,
      cause: new Error('notify channel down (deterministic)'),
    };
    const registry = makeRegistry(stub, {
      runtimeFactory: (handle: DocHandle): NamespaceRuntime =>
        createNamespaceRuntimeForRegistry(handle, () => {
          gate.calls += 1;
          return gate.failing ? Promise.reject(gate.cause) : Promise.resolve();
        }),
    });
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);

    const rep = asRepLease(lease);
    expect((await rep.enableReplication()).ok).toBe(true); // notifier ok
    const id0 = repMeta(lease).replicationId;
    expect(gate.calls).toBe(1);

    gate.failing = true; // 登记通道损坏（写已提交后通知失败）
    const failure = await rep.bumpReplicationEpoch().then(
      () => null,
      (e: unknown) => e,
    );
    expect(failure, 'notify-dirty 失败必须 reject，绝不 resolve 伪成功').toBeInstanceOf(
      RuntimeWriteFatalError,
    );
    const fatal = failure as RuntimeWriteFatalError;
    expect(fatal.committed).toBe(true); // 诚实 committed 事实（写已提交、通道损坏）

    // committed 事实保留：META 已反映 epoch 2（读取面仍可用——fatal 只禁写）
    expect(repMeta(lease).replicationId).toBe(id0);
    expect(repMeta(lease).replicationEpoch).toBe(2);
    expect(leaseRuntimeStatus(lease).fatal).not.toBeNull(); // status.fatal 稳定摘要
    expect(leaseRuntimeStatus(lease).read.enabled).toBe(true); // 读取保留

    // fatal 后一切新写（含再 bump 与 ROOT 业务写）→ RUNTIME_WRITE_DISABLED、零写入
    const laterBump = await rep.bumpReplicationEpoch();
    expect(laterBump.ok).toBe(false);
    expect(JSON.stringify(laterBump)).toContain('RUNTIME_WRITE_DISABLED');
    expect(repMeta(lease).replicationEpoch).toBe(2); // 零写入
    const laterRoot = await lease.mutateRoot({ op: 'set', path: ['n'], value: 9 });
    expect(laterRoot?.ok).toBe(false);
    expect(JSON.stringify(laterRoot)).toContain('RUNTIME_WRITE_DISABLED');
    expect(lease.read(['n'])).toMatchObject({ ok: true }); // read 保留
  });
});

// ═══════════════════════════════ AC-5：状态判别与无 mutable META 引用 ═══════════════

describe('AC-5 状态区分 disabled/enabled/identity change；不暴露 mutable META 引用', () => {
  it('判别面：disabled → enabled(id,epoch1) → bump 后 epoch 变而身份不变（可比较判别演进）', async () => {
    const stub = new StubReplicationPersistence();
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);

    expect(repStatus(lease)).toEqual({ state: 'disabled' });

    const rep = asRepLease(lease);
    expect((await rep.enableReplication()).ok).toBe(true);
    expect(repStatus(lease).state).toBe('enabled');
    const id1 = repStatus(lease).replicationId;
    expect(repStatus(lease).replicationEpoch).toBe(1);

    expect((await rep.bumpReplicationEpoch()).ok).toBe(true);
    const after = repStatus(lease);
    expect(after.state).toBe('enabled');
    expect(after.replicationId).toBe(id1); // 相同复制谱系
    expect(after.replicationEpoch).toBe(2); // epoch 演进可判别（identity-change 判别面）
  });

  it('status 每次调用为新鲜对象、值稳定，对象突变不逃逸（无 mutable META 引用）', async () => {
    const stub = new StubReplicationPersistence();
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);

    expect((await asRepLease(lease).enableReplication()).ok).toBe(true);
    const actualId = repMeta(lease).replicationId as string;
    expect(actualId).toMatch(REP_ID_PATTERN);

    const s1 = lease.getStatus();
    const s2 = lease.getStatus();
    expect(s1).not.toBe(s2); // 每次调用全新对象

    // 突变逃逸探针：返回对象被冻结 → 赋值抛（期望路径）；未被冻结 → 赋值后必须不影响后续读取
    const probe = (repStatus(lease) as { replicationId?: string }).replicationId;
    try {
      (repStatus(lease) as { replicationId?: string }).replicationId = 'f'.repeat(32);
    } catch {
      // 冻结路径：结构不可变即可
    }
    expect(probe).toBe(actualId);
    expect(repStatus(lease).replicationId).toBe(actualId); // 后续读取不受突变影响

    // getMetadata 深拷贝：对返回对象的突变不影响 META 真实值
    const m1 = repMeta(lease);
    try {
      (m1 as { replicationId?: string }).replicationId = '0'.repeat(32);
    } catch {
      // 冻结路径
    }
    expect(repMeta(lease).replicationId).toBe(actualId);
  });
});

// ═══════════════════════════════ AC-6：竞态 / degraded / retry / 恢复 ═══════════════

/** Memory/File 共享 store 夹具：真实 yjs 编码解码 + 确定性 flush 驱动。 */
interface RealStoreFixture {
  readonly writer: DocPersistence;
  readonly writerScheduler: ReturnType<typeof createTestScheduler>;
  readonly reader: DocPersistence;
  readonly readerScheduler: ReturnType<typeof createTestScheduler>;
  setFailing(failing: boolean): void;
  flushAll(): Promise<void>;
}

function makeMemoryStoreFixture(): RealStoreFixture {
  const store = new Map<string, Uint8Array>();
  let failing = false;
  const schedule = { debounceMs: 1, maxDirtyMs: 1 };
  const writerScheduler = createTestScheduler();
  const writer = createMemoryPersistence({
    scheduler: writerScheduler,
    schedule,
    writeSnapshot: async (key, snapshot) => {
      if (failing) throw new Error('io down (deterministic)');
      store.set(key, snapshot.slice());
    },
  });
  const readerScheduler = createTestScheduler();
  const reader = createMemoryPersistence({
    scheduler: readerScheduler,
    readSnapshot: async (key) => store.get(key),
  });
  return {
    writer,
    writerScheduler,
    reader,
    readerScheduler,
    setFailing: (f) => {
      failing = f;
    },
    flushAll: async () => {
      for (let i = 0; i < 60; i += 1) {
        await writerScheduler.advanceBy(1_000);
        await readerScheduler.advanceBy(1_000);
      }
    },
  };
}

describe('AC-6 close/fatal 竞态与 Memory persistence 恢复', () => {
  it('close 竞态：enable 已接纳后 close（registry shutdown）——enable 排空成功、身份经真实持久化恢复', async () => {
    const fx = makeMemoryStoreFixture();
    const registry1 = makeRegistry(fx.writer);
    const lease = okLease(await registry1.create(newContractInput()));
    await schemaReady(lease);
    const nsId = lease.namespaceId;

    // enable 已接纳（sequencer 入队）后立即 shutdown：close barrier 排在 enable 之后
    const enableP = asRepLease(lease).enableReplication();
    const shutdownP = registry1.shutdown();

    await expect(enableP).resolves.toMatchObject({ ok: true }); // 已接纳任务无条件排空
    await expect(shutdownP).resolves.toBeUndefined();
    await fx.flushAll(); // 排空 + dirty 登记后由持久层 flush（真实编码）

    // 全新 Registry（真实 loadDoc 解码）：身份 epoch 1 完整恢复（enable 未被 close 击穿）
    const registry2 = makeRegistry(fx.reader);
    const reopened = okLease(await registry2.open(ALICE, nsId));
    expect(repMeta(reopened).replicationId).toMatch(REP_ID_PATTERN);
    expect(repMeta(reopened).replicationEpoch).toBe(1);
    expect(repStatus(reopened).state).toBe('enabled');
    await registry2.shutdown();
    await (fx.reader as unknown as { dispose(): Promise<void> }).dispose();
  });

  it('persistence-degraded：gate 通过后降级——enable 成功、后续 bump 被 RUNTIME_WRITE_DISABLED 拒绝零写入；恢复后 retry 覆盖、bump 成功；Memory 恢复可见', async () => {
    const fx = makeMemoryStoreFixture();
    const registry1 = makeRegistry(fx.writer);
    const lease = okLease(await registry1.create(newContractInput()));
    await schemaReady(lease);
    const nsId = lease.namespaceId;

    // 1) 降级注入：gate 瞬时观察仍 ready → enable 成功（提交 + dirty 登记）
    fx.setFailing(true);
    expect((await asRepLease(lease).enableReplication()).ok).toBe(true);
    const id0 = repMeta(lease).replicationId;
    expect(id0).toMatch(REP_ID_PATTERN);

    // 2) flush 失败 → entry persistence-degraded；status 位如实（rootWrite/schemaWrite 关、read 开）
    await fx.flushAll();
    const degraded = leaseRuntimeStatus(lease);
    expect(degraded.rootWrite.enabled).toBe(false);
    expect(degraded.schemaWrite.enabled).toBe(false);
    expect(degraded.read.enabled).toBe(true);
    expect(degraded.schema.state).toBe('ready');

    // 3) degraded 后续 bump 被写前 gate 拒绝：RUNTIME_WRITE_DISABLED、零写入
    const blocked = await asRepLease(lease).bumpReplicationEpoch();
    expect(blocked.ok).toBe(false);
    expect(JSON.stringify(blocked)).toContain('RUNTIME_WRITE_DISABLED');
    expect(repMeta(lease).replicationEpoch).toBe(1);
    expect(repMeta(lease).replicationId).toBe(id0);

    // 4) 恢复 I/O → 持久层 retry 覆盖最新完整 live doc（含 enable 提交的身份）
    fx.setFailing(false);
    await fx.flushAll();

    // 5) 恢复后 bump 成功 → epoch 2
    expect((await asRepLease(lease).bumpReplicationEpoch()).ok).toBe(true);
    expect(repMeta(lease).replicationEpoch).toBe(2);
    await fx.flushAll();

    // 6) Memory recovery：全新 Registry 实例（真实 loadDoc 解码）恢复身份 + epoch 2
    const registry2 = makeRegistry(fx.reader);
    const reopened = okLease(await registry2.open(ALICE, nsId));
    expect(repMeta(reopened).replicationId).toBe(id0);
    expect(repMeta(reopened).replicationEpoch).toBe(2);
    expect(repStatus(reopened).state).toBe('enabled');
    expect(repStatus(reopened).replicationId).toBe(id0);
    await registry2.shutdown();
    await (fx.reader as unknown as { dispose(): Promise<void> }).dispose();
  });

  it('fatal committed-not-durable（committed-state recovery，非 File durability recovery）：bump 提交后 notify 失败 → 仅从失败 bump 的同一 live Y.Doc 编码克隆 seed 构造新 generation，facts 保留、bump 至 3；failed notifier persistence 不充当 durable/reopen 前提', async () => {
    // 注释声明：本用例验证的是 **committed-state recovery**——failed bump transaction 的
    // committed META facts 被正确交接到 recovery 边界（同一 live Y.Doc → clone seed →
    // 新 generation），**不是** File durability recovery；notifier failure 后 committed
    // ≠ durable（ADR 0008 issue #132 修订节），失败 notifier 的持久层绝不作为成功前提。
    const stub = new StubReplicationPersistence();
    const gate: { failing: boolean; calls: number; cause: Error } = {
      failing: false,
      calls: 0,
      cause: new Error('notify channel down (deterministic)'),
    };
    let liveDoc: Y.Doc | undefined;
    const registry1 = makeRegistry(stub, {
      runtimeFactory: (handle: DocHandle): NamespaceRuntime => {
        liveDoc = handle.doc; // 捕获 Runtime 使用的同一 live Y.Doc（V3a 同引用）
        return createNamespaceRuntimeForRegistry(handle, () => {
          gate.calls += 1;
          return gate.failing ? Promise.reject(gate.cause) : Promise.resolve();
        });
      },
    });
    const lease = okLease(await registry1.create(newContractInput()));
    await schemaReady(lease);
    const nsId = lease.namespaceId;
    const rep = asRepLease(lease);

    // 1) 用可失败 notifier 构造的同一 live Y.Doc 上 enable 成功，记录 id0 并在该 live
    //    doc 断言 META 为 id0/1。
    expect((await rep.enableReplication()).ok).toBe(true);
    expect(gate.calls).toBe(1); // enable 的 notifier 恰一次（成功槽 E6）
    const id0 = repMeta(lease).replicationId;
    expect(id0).toMatch(REP_ID_PATTERN);
    expect(liveDoc, 'runtimeFactory 必须捕获与 Runtime 同一的 live Y.Doc 引用').toBeDefined();
    const doc = liveDoc as Y.Doc;
    expect(doc.getMap('META').get('replicationId')).toBe(id0);
    expect(doc.getMap('META').get('replicationEpoch')).toBe(1);

    // 2) bump 的 notifier reject → RuntimeWriteFatalError committed:true；仅在原 live doc
    //    断言 META 与 status.replication 均为 enabled/id0/epoch 2 且 status.fatal 非空；
    //    不在 fatal Runtime 上再写。
    gate.failing = true;
    const failure = await rep.bumpReplicationEpoch().then(
      () => null,
      (e: unknown) => e,
    );
    expect(failure, 'notify-dirty 失败必须 reject，绝不 resolve 伪成功').toBeInstanceOf(
      RuntimeWriteFatalError,
    );
    const fatal = failure as RuntimeWriteFatalError;
    expect(fatal.committed).toBe(true); // 诚实 committed 事实（写已提交、登记通道损坏）
    expect(gate.calls).toBe(2); // bump 的 notifier 恰一次（failed 尝试已发生——committed 真相）
    expect(doc.getMap('META').get('replicationId')).toBe(id0);
    expect(doc.getMap('META').get('replicationEpoch')).toBe(2);
    expect(repStatus(lease)).toEqual({ state: 'enabled', replicationId: id0, replicationEpoch: 2 });
    expect(leaseRuntimeStatus(lease).fatal).not.toBeNull();

    // 3) rejection 之后才从失败 bump 已提交后的**同一 live Y.Doc** 制作独立 recovery
    //    seed：先断言源 META=id0/2，encodeStateAsUpdate → applyUpdate 克隆后再次断言
    //    seed META=id0/2。不得使用预制 epoch=2 seed 或失败 notifier 的 persistence。
    expect(doc.getMap('META').get('replicationEpoch')).toBe(2); // 源 META 断言（clone 前）
    const update = Y.encodeStateAsUpdate(doc);
    const seedDoc = new Y.Doc();
    Y.applyUpdate(seedDoc, update);
    expect(seedDoc.getMap('META').get('replicationId')).toBe(id0);
    expect(seedDoc.getMap('META').get('replicationEpoch')).toBe(2); // seed META 断言（clone 后）

    // 4) 新建仅承载该 seedDoc 的独立 DocPersistence 与新 Registry；新 Registry 只能从
    //    该 seed open。断言新 generation 为 enabled/id0/2、fatal 为空；其 bump 成功至 3。
    const seedPersistence = new StubReplicationPersistence();
    seedPersistence.seedDocument(nsId, seedDoc);
    const registry2 = makeRegistry(seedPersistence);
    const reopened = okLease(await registry2.open(ALICE, nsId));
    await schemaReady(reopened);
    expect(repMeta(reopened).replicationId).toBe(id0);
    expect(repMeta(reopened).replicationEpoch).toBe(2);
    expect(repStatus(reopened)).toEqual({ state: 'enabled', replicationId: id0, replicationEpoch: 2 });
    expect(leaseRuntimeStatus(reopened).fatal).toBeNull(); // 新 generation 不继承旧 fatal
    expect((await asRepLease(reopened).bumpReplicationEpoch()).ok).toBe(true);
    expect(repMeta(reopened).replicationEpoch).toBe(3);
    await registry2.shutdown();

    // 5) failed notifier 所绑定 persistence（registry1 stub）：其读面（loadDoc/committed
    //    表）与 live doc 是同一对象引用而非独立 durable 记录——本用例从不以它 reopen 作为
    //    成功路径，其状态不升级为 durability 证据（committed ≠ durable）。
    expect(stub.loadCalls).toEqual([]);
    expect(stub.saveEvents).toEqual([]);
  });
});

describe('AC-6 File persistence 恢复', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
  });

  it('FilePersistence 全链：create → enable → flush → 重启（同 rootDir）→ open 恢复身份与 epoch', async () => {
    const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nomicore-replication-red-'));
    roots.push(rootDir);
    const makeFile = (): { persistence: DocPersistence; scheduler: ReturnType<typeof createTestScheduler> } => {
      const scheduler = createTestScheduler();
      const persistence = new FilePersistence({
        rootDir,
        scheduler,
        schedule: { debounceMs: 1, maxDirtyMs: 1 },
      });
      return { persistence, scheduler };
    };

    const first = makeFile();
    const registry1 = makeRegistry(first.persistence);
    const lease = okLease(await registry1.create(newContractInput()));
    await schemaReady(lease);
    const nsId = lease.namespaceId;

    expect((await asRepLease(lease).enableReplication()).ok).toBe(true);
    const id0 = repMeta(lease).replicationId;
    expect(id0).toMatch(REP_ID_PATTERN);
    // kick flush：enable 的 saveDoc 只登记 dirty + 武装 debounce（ADR 0006）；advanceBy
    // 触发 flush 后，真实 fs 的 writeFile→rename 在事件循环上异步进行——固定 advanceBy
    // 后立即 shutdown/dispose 会在 rename 前 abort，磁盘快照停留在 create 时刻
    // （Phase 1 回流修订前 3/3 确定性失败：重启后 replicationId undefined）。
    await first.scheduler.advanceBy(1_000);
    // issue #108 正式耐久等待：有界轮询磁盘 committed 快照文件（直接读文件 + decode，
    // 不干扰 flush 写路径），直到复制键落盘才进入 shutdown/dispose——磁盘事实成立后
    // 无在途写，重启断言确定。
    await waitDurableSnapshot(ALICE, nsId, rootDir, (doc) => doc.getMap('META').get('replicationEpoch'), 1);
    await waitDurableSnapshot(ALICE, nsId, rootDir, (doc) => doc.getMap('META').get('replicationId'), id0);
    await registry1.shutdown();
    await (first.persistence as unknown as { dispose(): Promise<void> }).dispose();

    // 重启（全新 FilePersistence 实例，同 rootDir）
    const second = makeFile();
    const registry2 = makeRegistry(second.persistence);
    const reopened = okLease(await registry2.open(ALICE, nsId));
    expect(repMeta(reopened).replicationId).toBe(id0);
    expect(repMeta(reopened).replicationEpoch).toBe(1);
    expect(repStatus(reopened).state).toBe('enabled');
    expect(repStatus(reopened).replicationId).toBe(id0);
    expect(repStatus(reopened).replicationEpoch).toBe(1);
    await registry2.shutdown();
    await (second.persistence as unknown as { dispose(): Promise<void> }).dispose();
  });

  it('FilePersistence bump 恢复（AC-6 矩阵补全）：enable → bump 至 2 → 双字段 waitDurableSnapshot 后 dispose → 同 rootDir 重启 open 恢复 id0/2（dirty 登记 ≠ durable）', async () => {
    const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nomicore-replication-bump-'));
    roots.push(rootDir);
    const makeFile = (): { persistence: DocPersistence; scheduler: ReturnType<typeof createTestScheduler> } => {
      const scheduler = createTestScheduler();
      const persistence = new FilePersistence({
        rootDir,
        scheduler,
        schedule: { debounceMs: 1, maxDirtyMs: 1 },
      });
      return { persistence, scheduler };
    };

    const first = makeFile();
    const registry1 = makeRegistry(first.persistence);
    const lease = okLease(await registry1.create(newContractInput()));
    await schemaReady(lease);
    const nsId = lease.namespaceId;
    const rep = asRepLease(lease);

    // 1) enable + bump 均为 {ok:true}；durable wait 之前 live META 已是 id0 + epoch 2
    //    （dirty 已登记 ≠ 已落盘——落盘证据以 2) 的磁盘事实为准，不提前 dispose）
    expect((await rep.enableReplication()).ok).toBe(true);
    const id0 = repMeta(lease).replicationId;
    expect(id0).toMatch(REP_ID_PATTERN);
    expect((await rep.bumpReplicationEpoch()).ok).toBe(true);
    expect(repMeta(lease).replicationId).toBe(id0);
    expect(repMeta(lease).replicationEpoch).toBe(2);
    expect(repStatus(lease)).toEqual({ state: 'enabled', replicationId: id0, replicationEpoch: 2 });

    // 2) kick flush + issue #108 正式耐久等待：**双字段**磁盘证据（epoch===2 且 id===id0
    //    同在 committed 快照）达成才 shutdown/dispose——仅 scheduler advance 或 saveDoc
    //    resolve 不算 durable（反向控制：此处分隔 live 提交时刻与落盘时刻）。
    await first.scheduler.advanceBy(1_000);
    await waitDurableSnapshot(ALICE, nsId, rootDir, (doc) => doc.getMap('META').get('replicationEpoch'), 2);
    await waitDurableSnapshot(ALICE, nsId, rootDir, (doc) => doc.getMap('META').get('replicationId'), id0);
    await registry1.shutdown();
    await (first.persistence as unknown as { dispose(): Promise<void> }).dispose();

    // 3) 同 rootDir 全新 FilePersistence / Registry：open 恢复 committed 事实 id0/2，
    //    status.replication 精确等于 enabled 联合（无额外键）
    const second = makeFile();
    const registry2 = makeRegistry(second.persistence);
    const reopened = okLease(await registry2.open(ALICE, nsId));
    expect(repMeta(reopened).replicationId).toBe(id0);
    expect(repMeta(reopened).replicationEpoch).toBe(2);
    expect(repStatus(reopened)).toEqual({ state: 'enabled', replicationId: id0, replicationEpoch: 2 });
    await registry2.shutdown();
    await (second.persistence as unknown as { dispose(): Promise<void> }).dispose();
  });
});

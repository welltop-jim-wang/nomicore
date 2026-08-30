/**
 * SA6 红灯锚定 — issue #133（Phase 5: bootstrap import, archive, and guarded
 * replica reset）AC-1/AC-2/AC-4/AC-6 的 registry 侧：内部受信任 bootstrap 导入
 * 路径（临时契约名 `importReplica`，**待 SA1 冻结**——ADR 0010 只称「内部受信任
 * 导入/受控复制导入能力」）与 `resetReplica(owner, namespaceId,
 * expectedLocalIdentity)` 编排（phase 文档 §实施切片 8 冻结名）。
 *
 * 契约来源（ADR 0010 §Namespace identity / §复制谱系与 epoch / §Bootstrap 与
 * 重连 / docs/phases/phase-5-websocket-replication.md §实施切片 2·8）：
 * - AC-1：受信导入保留 Hub namespaceId（不是普通 create——普通 create 的
 *   namespaceId 由注入受控 CSPRNG 生成且不接受调用方指定）；detached 完整
 *   Y.Doc 应用后 META 复制身份（docId/replicationId/replicationEpoch）在
 *   persistence ownership 转移前严格核对——缺失/格式违约/与期望不符 → 稳定
 *   拒绝且零持久化写入（store 无残留、loadDoc 仍 null）；
 * - AC-2：bootstrap 排他——本地已有 live entry 拒绝、本地无 entry 但已有
 *   committed snapshot 拒绝（绝不覆盖/合并；normal create 不受影响）；
 * - AC-4：resetReplica 串行化 close→archive→允许 bootstrap；owner mismatch →
 *   NAMESPACE_NOT_FOUND（存在性零泄露）；identity mismatch → 稳定拒绝且本地
 *   文档完好（零部分删除）；reset 后 open → NOT_FOUND（bootstrap eligibility），
 *   随后受信导入成功（完整 reset→bootstrap 闭环）；在途写/并发 open 经
 *   carrier FIFO 串行结算；
 * - AC-6：owner 分区独立（ALICE reset 零影响 BOB 同 namespaceId 分区）；
 *   Memory/File 真实持久化全链闭环。
 *
 * 红灯机制（基线 = NamespaceRegistry 公共面仅 open/create/getStatus/shutdown）：
 * 一切 `resetReplica(...)` / `importReplica(...)` 调用抛
 * `TypeError: … is not a function`——特征缺失的红。
 *
 * 锚定纪律：真实 yjs / 真实 Registry+Runtime / 真实 MemoryPersistence·
 * FilePersistence（真实 tmpdir、真实 fs rename）；stub 仅作持久化 seam 编排
 * 观测（记录调用面 + 受控 store——零 mock 本地服务）；fault 注入零；受控
 * 随机源（RegistryRandomBytes）+ fake scheduler 脚本化；File flush 落盘等待
 * 走 issue #108 正式 waitDurableSnapshot 模式（禁 real sleep 轮询）。
 *
 * 临时契约声明（全部在报告中显式标记「临时名/临时形状，待 SA1 冻结」）：
 * - `importReplica(owner, namespaceId, doc: Y.Doc)`（临时名；结果面 = 成功
 *   {ok:true; lease} / 拒绝 {ok:false; code; message}，shape 仿 create 先例）；
 * - `expectedLocalIdentity`/`expectedReplicationIdentity` 的临时形状
 *   `{ replicationId; replicationEpoch }`（N-1 待 SA1 定义映射与核对时点，
 *   判据应复用 readReplicationFacts 单点——本测试只锚「reset 把本地事实传给
 *   归档守卫」的可观察结果，存档调用面观测见 StubReplicaPersistence.archiveCalls）；
 * - 拒绝 code 拼写：NAMESPACE_IMPORT_INVALID_IDENTITY（复制身份缺失/格式违约）、
 *   NAMESPACE_IMPORT_IDENTITY_MISMATCH（META.docId ≠ namespaceId）、
 *   NAMESPACE_RESET_IDENTITY_MISMATCH；duplicate 与 not-found 直接用已冻结
 *   词汇 NAMESPACE_ALREADY_EXISTS / NAMESPACE_NOT_FOUND。
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
  type MemoryPersistenceOptions,
  type PersistedIdentityProbeResult,
  type User,
} from '@nomicore/persistence';
import { createTestScheduler } from '@nomicore/persistence/testing';
import {
  createNamespaceRegistryForTesting,
  createRegistryTestScheduler,
} from '@nomicore/namespace-registry/testing';
import type {
  NamespaceLease,
  NamespaceOwner,
  NamespaceRegistry,
  RegistryRandomBytes,
} from '@nomicore/namespace-registry';
// issue #108 正式耐久等待模式（只读引用，未修改）：直接轮询磁盘 committed 快照文件，
// 规避 FilePersistence flush 的 writeFile→rename 与 dispose abort 的已知竞态。
import { waitDurableSnapshot } from '../../namespace-runtime/test/durable-snapshot-wait.js';

// ═══════════════════════════════ 契约面本地声明（临时名/临时形状，待 SA1 冻结） ═══════════════

/** 复制身份引用（临时形状：freeze 字段包装——N-1 待 SA1 定义）。 */
interface ReplicationIdentityRef {
  readonly replicationId: string;
  readonly replicationEpoch: number;
}

/** resetReplica 编排面（phase 文档冻结名；结果面 shape 临时——仿 open/create 窄结果先例）。 */
interface ResetReplicaRegistry {
  readonly resetReplica: (
    owner: NamespaceOwner,
    namespaceId: string,
    expectedLocalIdentity: ReplicationIdentityRef,
  ) => Promise<
    | Readonly<{ ok: true }>
    | Readonly<{ ok: false; code: string; message: string }>
  >;
}

/** 内部受信任 bootstrap 导入面（临时名 importReplica，待 SA1 冻结）。 */
interface ImportReplicaRegistry {
  readonly importReplica: (
    owner: NamespaceOwner,
    namespaceId: string,
    doc: Y.Doc,
  ) => Promise<
    | Readonly<{ ok: true; lease: NamespaceLease }>
    | Readonly<{ ok: false; code: string; message: string }>
  >;
}

function asResetRegistry(registry: NamespaceRegistry): NamespaceRegistry & ResetReplicaRegistry {
  return registry as unknown as NamespaceRegistry & ResetReplicaRegistry;
}

function asImportRegistry(registry: NamespaceRegistry): NamespaceRegistry & ImportReplicaRegistry {
  return registry as unknown as NamespaceRegistry & ImportReplicaRegistry;
}

// ═══════════════════════════════ 基础设施 ═══════════════════════════════

const SCHEMA_ENVELOPE = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'phase5-bootstrap-red',
  text: 'type ROOT = { n: number; };\n',
});
const FIXED_MS = 1_700_000_123_456;
const ALICE: User = Object.freeze({ userId: 'u-alice' });
const BOB: User = Object.freeze({ userId: 'u-bob' });
const NS_B = `ns-${'b'.repeat(32)}`;
const ID_A = 'a'.repeat(32);
const ID_B = 'b'.repeat(32);
const NAMESPACE_ID_PATTERN = /^ns-[0-9a-f]{32}$/;

/** 确定性计数随机源（仅 Registry 的 namespaceId 生成面；非 16 字节请求 → 拒——
 *  与 RegistryRandomBytes 冻结契约同构（注入源只按 128-bit 请求）。） */
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

function makeRegistry(
  persistence: DocPersistence,
  opts: {
    runtimeFactory?: (handle: DocHandle, notifyDirty: () => Promise<void>) => unknown;
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

/** 手工种子文档（真实 Runtime 可构造）：SCHEMA 信封 + META（docId/createdAt +
 *  可选复制身份）+ ROOT。 */
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

function newContractInput(overrides: { owner?: NamespaceOwner; schema?: unknown; root?: unknown } = {}): Parameters<
  NamespaceRegistry['create']
>[0] {
  return {
    owner: overrides.owner ?? ALICE,
    schema: overrides.schema ?? SCHEMA_ENVELOPE,
    root: overrides.root ?? { n: 42 },
  };
}

/** 微任务预算内等待 Runtime P0 就绪（真实 Runtime + 全微任务链的确定性栅栏）。 */
async function schemaReady(lease: NamespaceLease): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    const status = lease.getStatus() as unknown as {
      lease?: string;
      runtime?: { schema?: { state?: string } };
    };
    if (status.lease === 'released') return;
    if (status.runtime?.schema?.state === 'ready') return;
    await Promise.resolve();
  }
  throw new Error(`schema 未在微观任务预算内就绪：${JSON.stringify(lease.getStatus())}`);
}

function leaseStatus(lease: NamespaceLease): {
  lease: string;
  runtime: { schema: { state: string }; read: { enabled: boolean } } | null;
} {
  return lease.getStatus() as unknown as {
    lease: string;
    runtime: { schema: { state: string }; read: { enabled: boolean } } | null;
  };
}

function leaseReadN(lease: NamespaceLease): unknown {
  const read = lease.read(['n']) as { ok?: boolean; value?: unknown };
  expect(read.ok, `期望读取成功，实际：${JSON.stringify(read)}`).toBe(true);
  return read.value;
}

function leaseMeta(lease: NamespaceLease): Record<string, unknown> {
  return lease.getMetadata();
}

/** Lease → 复制管理面（enable 仅在真实持久化全链闭环需要）。 */
interface ReplicationManagementLease {
  readonly enableReplication: () => Promise<Readonly<{ ok: boolean }>>;
}
interface ReplicationSessionLike {
  getStatus(): Readonly<{ state: string; closedBy?: string }>;
}
interface SessionLeaseExt {
  readonly openReplicationSession: (options: {
    readonly localRole: 'hub' | 'peer';
    readonly remoteInstanceId: string;
  }) => Promise<Readonly<{
    ok: boolean;
    session?: ReplicationSessionLike;
    code?: string;
  }>>;
}
function asRepLease(lease: NamespaceLease): NamespaceLease & ReplicationManagementLease {
  return lease as unknown as NamespaceLease & ReplicationManagementLease;
}
function asSessionLease(lease: NamespaceLease): NamespaceLease & SessionLeaseExt {
  return lease as unknown as NamespaceLease & SessionLeaseExt;
}

// 基线上 resetReplica/importReplica 不存在 → 一切调用抛 TypeError: … is not a function（红）。

// ═══════════════════════════════ Stub 持久化 seam（编排观测；零 mock 本地服务） ═══════════════

/**
 * stub Persistence：真实 Y.Doc / 真实 Runtime 全链载体（loadDoc 返回的 handle
 * 的 doc 与 store 同引用——写路径可见性真实）；archiveDoc/importDoc 为编排面
 * 观测（记录归档调用/期望身份/归档内容；duplicate 与身份违约按持久层契约
 * 分类）。不 mock I/O 语义。
 */
class StubReplicaPersistence implements DocPersistence {
  readonly importCalls: Array<{ owner: User; docId: string }> = [];
  readonly archiveCalls: Array<{ owner: User; docId: string; expected: unknown }> = [];
  readonly archives: Array<{ owner: User; docId: string; doc: Y.Doc }> = [];
  private readonly docs = new Map<string, Y.Doc>();

  seedDocument(owner: User, docId: string, doc: Y.Doc): void {
    this.docs.set(`${owner.userId}\u0000${docId}`, doc);
  }

  async createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    if (this.docs.has(`${owner.userId}\u0000${docId}`)) throw new DocDuplicateError();
    this.docs.set(`${owner.userId}\u0000${docId}`, doc);
    return this.makeHandle(owner, docId, doc);
  }

  /** 受控复制导入排他创建（临时契约：duplicate → 已冻结 DOC_DUPLICATE；docId 违约拒绝）。 */
  async importDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    this.importCalls.push({ owner, docId });
    const existing = this.docs.get(`${owner.userId}\u0000${docId}`);
    if (existing !== undefined) throw new DocDuplicateError();
    if (doc.getMap('META').get('docId') !== docId) {
      throw Object.assign(new Error('import identity mismatch'), { code: 'DOC_IMPORT_IDENTITY_MISMATCH' });
    }
    this.docs.set(`${owner.userId}\u0000${docId}`, doc);
    return this.makeHandle(owner, docId, doc);
  }

  async archiveDoc(owner: User, docId: string, expected: unknown): Promise<{ ok: true }> {
    this.archiveCalls.push({ owner, docId, expected });
    const key = `${owner.userId}\u0000${docId}`;
    const doc = this.docs.get(key);
    if (doc === undefined) {
      throw Object.assign(new Error('nothing to archive'), { code: 'DOC_ARCHIVE_DUPLICATE' });
    }
    const expectedRef = expected as ReplicationIdentityRef | undefined;
    const gotId = doc.getMap('META').get('replicationId');
    const gotEpoch = doc.getMap('META').get('replicationEpoch');
    if (
      expectedRef === undefined ||
      gotId !== expectedRef.replicationId ||
      gotEpoch !== expectedRef.replicationEpoch
    ) {
      throw Object.assign(new Error('archive identity mismatch'), {
        code: 'DOC_ARCHIVE_IDENTITY_MISMATCH',
      });
    }
    this.docs.delete(key);
    this.archives.push({ owner, docId, doc });
    return { ok: true };
  }

  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    const doc = this.docs.get(`${owner.userId}\u0000${docId}`);
    return doc === undefined ? null : this.makeHandle(owner, docId, doc);
  }

  /** R2 只读 committed-identity probe（round-2 演进，设计 §3.3）：stub 的 store 即
   *  docs map（单一 Y.Doc 对象 = live==persisted 世界）；按复制事实判据读取 META。
   *  fixture 能力补充，非行为断言改动。 */
  async readPersistedReplicationIdentity(
    owner: User,
    docId: string,
  ): Promise<PersistedIdentityProbeResult> {
    const doc = this.docs.get(`${owner.userId}\u0000${docId}`);
    if (doc === undefined) return { kind: 'missing' };
    const id = doc.getMap('META').get('replicationId');
    const epoch = doc.getMap('META').get('replicationEpoch');
    const ok =
      typeof id === 'string' &&
      /^[0-9a-f]{32}$/.test(id) &&
      typeof epoch === 'number' &&
      Number.isSafeInteger(epoch) &&
      epoch >= 1;
    return {
      kind: 'found',
      identity: ok
        ? { ok: true, value: { replicationId: id as string, replicationEpoch: epoch as number } }
        : { ok: false },
    };
  }

  async saveDoc(_handle: DocHandle): Promise<void> {}

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

// ═══════════════════════════════ AC-1：受信任 bootstrap 导入 ═══════════════════════════════

describe('AC-1 受信导入保留 Hub namespaceId + detached 完整 update + META 核对先于 ownership 转移', () => {
  it('成功导入：namespaceId 原样保留（非生成）、META.docId/复制身份原样、完整内容可读、open 复用同一身份', async () => {
    const stub = new StubReplicaPersistence();
    const registry = makeRegistry(stub);
    const hubDoc = makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 1, root: 123 });

    const result = await asImportRegistry(registry).importReplica(ALICE, NS_B, hubDoc, {
      replicationId: ID_A,
      replicationEpoch: 1,
    });
    expect(result.ok, `导入应成功：${JSON.stringify(result)}`).toBe(true);
    const lease = (result as { lease: NamespaceLease }).lease;
    await schemaReady(lease);

    // namespaceId 原样（Hub 身份），绝不是普通 create 的生成 ID（ns-001… 或其它计数）
    expect(lease.namespaceId).toBe(NS_B);
    // META：docId === namespaceId；复制身份完整原样（replicationId/epoch 不丢失、不改写）
    const meta = leaseMeta(lease);
    expect(meta.docId).toBe(NS_B);
    expect(meta.replicationId).toBe(ID_A);
    expect(meta.replicationEpoch).toBe(1);
    // 完整 update 内容在场（detached 全量应用后的 ROOT 值——不是默认/部分状态）
    expect(leaseReadN(lease)).toBe(123);
    // Registry 内以同身份复用：再 open 得到同一 namespaceId 与内容（生成入口没有介入）
    const reopened = okLease(await registry.open(ALICE, NS_B));
    await schemaReady(reopened);
    expect(reopened.namespaceId).toBe(NS_B);
    expect(leaseReadN(reopened)).toBe(123);
    expect(leaseMeta(reopened).replicationId).toBe(ID_A);
    await registry.shutdown();
  });

  it('复制身份核对失败（缺失）：META 无 replicationId/replicationEpoch → 稳定拒绝 + 零持久化写入', async () => {
    const stub = new StubReplicaPersistence();
    const registry = makeRegistry(stub);
    const plainDoc = makeSeedDoc(NS_B, { root: 1 }); // 无复制身份（disabled 态文档）

    const issue = okIssue(await asImportRegistry(registry).importReplica(ALICE, NS_B, plainDoc, {
      replicationId: ID_A,
      replicationEpoch: 1,
    }));
    expect(issue.code).toBe('NAMESPACE_IMPORT_INVALID_IDENTITY');

    // 零持久化写入：store 无残留、loadDoc 仍 null、persistence 导入路径未被触达
    expect(stub.importCalls).toEqual([]);
    expect(await stub.loadDoc(ALICE, NS_B)).toBeNull();
    await registry.shutdown();
  });

  it('复制身份核对失败（格式违约）：replicationId 非 32 小写 hex / replicationEpoch 越域 → 稳定拒绝 + 零持久化写入', async () => {
    const stub = new StubReplicaPersistence();
    const registry = makeRegistry(stub);

    const badId = makeSeedDoc(NS_B, { replicationId: 'z'.repeat(32), replicationEpoch: 1 });
    expect(okIssue(await asImportRegistry(registry).importReplica(ALICE, NS_B, badId, {
      replicationId: ID_A,
      replicationEpoch: 1,
    })).code)
      .toBe('NAMESPACE_IMPORT_INVALID_IDENTITY');

    const badEpoch = makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 0 });
    expect(okIssue(await asImportRegistry(registry).importReplica(ALICE, NS_B, badEpoch, {
      replicationId: ID_A,
      replicationEpoch: 1,
    })).code)
      .toBe('NAMESPACE_IMPORT_INVALID_IDENTITY');

    const epochType = makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: Number.NaN });
    expect(okIssue(await asImportRegistry(registry).importReplica(ALICE, NS_B, epochType, {
      replicationId: ID_A,
      replicationEpoch: 1,
    })).code)
      .toBe('NAMESPACE_IMPORT_INVALID_IDENTITY');

    expect(stub.importCalls).toEqual([]);
    expect(await stub.loadDoc(ALICE, NS_B)).toBeNull();
    await registry.shutdown();
  });

  it('复制身份核对失败（与期望不符）：META.docId ≠ namespaceId → 稳定拒绝 + 零持久化写入', async () => {
    const stub = new StubReplicaPersistence();
    const registry = makeRegistry(stub);
    // doc 宣称自己是别个 namespace（Hub 身份纪律：META.docId 必须等于请求 namespaceId）
    const foreign = makeSeedDoc(`ns-${'c'.repeat(32)}`, {
      replicationId: ID_A,
      replicationEpoch: 1,
    });

    const issue = okIssue(await asImportRegistry(registry).importReplica(ALICE, NS_B, foreign, {
      replicationId: ID_A,
      replicationEpoch: 1,
    }));
    expect(issue.code).toBe('NAMESPACE_IMPORT_IDENTITY_MISMATCH');

    expect(stub.importCalls).toEqual([]);
    expect(await stub.loadDoc(ALICE, NS_B)).toBeNull();
    await registry.shutdown();
  });

  it('普通 create 面不受导入路径影响：import 后 create 仍生成 ns-+32hex 新身份且不与导入重复', async () => {
    const stub = new StubReplicaPersistence();
    const registry = makeRegistry(stub);
    await asImportRegistry(registry).importReplica(ALICE, NS_B, makeSeedDoc(NS_B, {
      replicationId: ID_A,
      replicationEpoch: 1,
      root: 123,
    }), {
      replicationId: ID_A,
      replicationEpoch: 1,
    });

    const created = okLease(await registry.create(newContractInput()));
    await schemaReady(created);
    // 随机生成纪律不变：create 生成注入源序列的 ns-+32hex，绝不借用导入的 Hub ID
    expect(created.namespaceId).toMatch(NAMESPACE_ID_PATTERN);
    expect(created.namespaceId).not.toBe(NS_B);

    // 导入文档不受 create 噪音扰动：身份与内容原样
    const imported = okLease(await registry.open(ALICE, NS_B));
    await schemaReady(imported);
    expect(leaseReadN(imported)).toBe(123);
    expect(leaseMeta(imported).replicationId).toBe(ID_A);
    await registry.shutdown();
  });
});

// ═══════════════════════════════ AC-2：bootstrap 排他（不覆盖、不合并） ═══════════════════

describe('AC-2 bootstrap 排他创建：live entry / committed snapshot 双形态拒绝、并发恰一、零覆盖', () => {
  it('本地已有 live entry：导入拒绝（NAMESPACE_ALREADY_EXISTS，已冻结词汇）+ 零覆盖零合并', async () => {
    const stub = new StubReplicaPersistence();
    const registry = makeRegistry(stub);
    const created = okLease(await registry.create(newContractInput()));
    await schemaReady(created);
    const nsId = created.namespaceId;

    const issue = okIssue(
      await asImportRegistry(registry).importReplica(ALICE, nsId, makeSeedDoc(nsId, {
        replicationId: ID_A,
        replicationEpoch: 1,
        root: 999,
      }), {
        replicationId: ID_A,
        replicationEpoch: 1,
      }),
    );
    expect(issue.code).toBe('NAMESPACE_ALREADY_EXISTS');

    // 零覆盖零合并：live 文档内容与 META 原样（导入的身份没有被合并进来）
    expect(leaseReadN(created)).toBe(42);
    expect(leaseMeta(created).replicationId).toBeUndefined();
    expect(leaseMeta(created).docId).toBe(nsId);
    await registry.shutdown();
  });

  it('本地无 entry 但已有 committed snapshot：导入拒绝（NAMESPACE_ALREADY_EXISTS）+ 旧快照零改动', async () => {
    const stub = new StubReplicaPersistence();
    const registry1 = makeRegistry(stub);
    const created = okLease(await registry1.create(newContractInput()));
    await schemaReady(created);
    const nsId = created.namespaceId;
    // registry1 保持 live entry；registry2 是全新 Registry（无 entry）：同一 stub store
    // 表示「本地无 entry、但持久层已有 committed snapshot」的 bootstrap 场景。
    const registry2 = makeRegistry(stub);

    const issue = okIssue(
      await asImportRegistry(registry2).importReplica(ALICE, nsId, makeSeedDoc(nsId, {
        replicationId: ID_A,
        replicationEpoch: 1,
        root: 999,
      }), {
        replicationId: ID_A,
        replicationEpoch: 1,
      }),
    );
    expect(issue.code).toBe('NAMESPACE_ALREADY_EXISTS');

    // 旧快照零改动：open（registry1，同 store）内容与 META 原样——没有覆盖或合并
    const reopened = okLease(await registry1.open(ALICE, nsId));
    await schemaReady(reopened);
    expect(leaseReadN(reopened)).toBe(42);
    expect(leaseMeta(reopened).replicationId).toBeUndefined();
    await registry1.shutdown();
    await registry2.shutdown();
  });

  it('同 key 并发两个导入（空 key bootstrap）：恰一个成功、一个 NAMESPACE_ALREADY_EXISTS；winner 内容完整', async () => {
    const stub = new StubReplicaPersistence();
    const registry = makeRegistry(stub);
    const doc = makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 1, root: 7 });

    const [r1, r2] = await Promise.all([
      asImportRegistry(registry).importReplica(ALICE, NS_B, doc, {
        replicationId: ID_A,
        replicationEpoch: 1,
      }),
      asImportRegistry(registry).importReplica(ALICE, NS_B, makeSeedDoc(NS_B, {
        replicationId: ID_A,
        replicationEpoch: 1,
        root: 7,
      }), {
        replicationId: ID_A,
        replicationEpoch: 1,
      }),
    ]);
    const results = [r1, r2];
    const oks = results.filter((r) => r.ok === true);
    const refusals = results.filter((r) => r.ok === false);
    expect(oks).toHaveLength(1);
    expect(refusals).toHaveLength(1);
    expect((refusals[0] as { code?: string }).code).toBe('NAMESPACE_ALREADY_EXISTS');

    // 恰一份内容：winner lease 可读、内容完整
    const winner = (oks[0] as { lease: NamespaceLease }).lease;
    await schemaReady(winner);
    expect(leaseReadN(winner)).toBe(7);
    expect(leaseMeta(winner).replicationId).toBe(ID_A);
    await registry.shutdown();
  });
});

// ═══════════════════════════════ AC-4：resetReplica 编排（close→archive→bootstrap eligibility） ═══════════════

describe('AC-4 resetReplica 编排：close→archive→allow bootstrap；owner/identity race 拒绝零部分删除', () => {
  it('成功闭环：reset 关闭 Runtime generation → open NOT_FOUND（bootstrap eligibility）→ 受信导入成功（Hub 身份/新内容）', async () => {
    const stub = new StubReplicaPersistence();
    stub.seedDocument(ALICE, NS_B, makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 1, root: 5 }));
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.open(ALICE, NS_B));
    await schemaReady(lease);

    const reset = await asResetRegistry(registry).resetReplica(ALICE, NS_B, {
      replicationId: ID_A,
      replicationEpoch: 1,
    });
    expect(reset.ok, `reset 应成功：${JSON.stringify(reset)}`).toBe(true);

    // close 事实：原 lease 的 runtime generation 已关（released）
    expect(leaseStatus(lease).lease).toBe('released');
    // archive 事实：归档守卫收到与本地 META 一致的期望身份；归档内容身份完整
    expect(stub.archiveCalls).toHaveLength(1);
    expect(stub.archiveCalls[0]).toMatchObject({ owner: ALICE, docId: NS_B, expected: { replicationId: ID_A, replicationEpoch: 1 } });
    expect(stub.archives).toHaveLength(1);
    expect(stub.archives[0]!.doc.getMap('META').get('replicationId')).toBe(ID_A);
    expect(stub.archives[0]!.doc.getMap('META').get('replicationEpoch')).toBe(1);
    // bootstrap eligibility：open → NAMESPACE_NOT_FOUND；持久层 loadDoc → null（已归档）
    expect(okIssue(await registry.open(ALICE, NS_B)).code).toBe('NAMESPACE_NOT_FOUND');
    expect(await stub.loadDoc(ALICE, NS_B)).toBeNull();

    // 完整 reset→bootstrap 闭环：受信导入成功——Hub namespaceId 原样、内容全新、epoch 前进
    const imported = await asImportRegistry(registry).importReplica(ALICE, NS_B, makeSeedDoc(NS_B, {
      replicationId: ID_A,
      replicationEpoch: 2,
      root: 999,
    }), {
      replicationId: ID_A,
      replicationEpoch: 2,
    });
    expect(imported.ok, `导入应成功：${JSON.stringify(imported)}`).toBe(true);
    const importedLease = (imported as { lease: NamespaceLease }).lease;
    await schemaReady(importedLease);
    expect(importedLease.namespaceId).toBe(NS_B);
    expect(leaseReadN(importedLease)).toBe(999);
    expect(leaseMeta(importedLease).replicationId).toBe(ID_A);
    expect(leaseMeta(importedLease).replicationEpoch).toBe(2);
    await registry.shutdown();
  });

  it('owner mismatch → NAMESPACE_NOT_FOUND（存在性零泄露）+ 零归档副作用 + 本地文档完好', async () => {
    const stub = new StubReplicaPersistence();
    stub.seedDocument(ALICE, NS_B, makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 1, root: 5 }));
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.open(ALICE, NS_B));
    await schemaReady(lease);

    // 非 owner（BOB）reset：与 open 同款 not-found——绝不泄露该 namespace 存在性
    const issue = okIssue(
      await asResetRegistry(registry).resetReplica(BOB, NS_B, {
        replicationId: ID_A,
        replicationEpoch: 1,
      }),
    );
    expect(issue.code).toBe('NAMESPACE_NOT_FOUND');
    expect(stub.archiveCalls).toEqual([]); // 零副作用：归档 seam 未被触达
    // 本地文档完好：ALICE 仍可 open、内容与身份原样
    const again = okLease(await registry.open(ALICE, NS_B));
    await schemaReady(again);
    expect(leaseReadN(again)).toBe(5);
    expect(leaseMeta(again).replicationId).toBe(ID_A);
    await registry.shutdown();
  });

  it('identity mismatch → 稳定拒绝（NAMESPACE_RESET_IDENTITY_MISMATCH，临时拼写）+ 本地文档完好（零部分删除）', async () => {
    const stub = new StubReplicaPersistence();
    stub.seedDocument(ALICE, NS_B, makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 1, root: 5 }));
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.open(ALICE, NS_B));
    await schemaReady(lease);

    const issue = okIssue(
      await asResetRegistry(registry).resetReplica(ALICE, NS_B, {
        replicationId: ID_B,
        replicationEpoch: 1,
      }),
    );
    expect(issue.code).toBe('NAMESPACE_RESET_IDENTITY_MISMATCH');

    // 零部分删除：本地文档完好可 open、META 身份/ROOT 零改动、entry 未被破坏
    const again = okLease(await registry.open(ALICE, NS_B));
    await schemaReady(again);
    expect(leaseReadN(again)).toBe(5);
    expect(leaseMeta(again).replicationId).toBe(ID_A);
    expect(leaseMeta(again).replicationEpoch).toBe(1);
    expect(await stub.loadDoc(ALICE, NS_B)).not.toBeNull();
    await registry.shutdown();
  });

  it('missing key：reset → NAMESPACE_NOT_FOUND（与 open 相同 not-found 契约；不制造伪归档）', async () => {
    const stub = new StubReplicaPersistence();
    const registry = makeRegistry(stub);
    const issue = okIssue(
      await asResetRegistry(registry).resetReplica(ALICE, `ns-${'d'.repeat(32)}`, {
        replicationId: ID_A,
        replicationEpoch: 1,
      }),
    );
    expect(issue.code).toBe('NAMESPACE_NOT_FOUND');
    expect(stub.archiveCalls).toEqual([]);
    await registry.shutdown();
  });

  it('串行化：在途 ROOT 写 + 同 key reset（close 排空已接纳写槽）→ 写完整结算后归档（归档内容含写后值）、终态 NOT_FOUND + loadDoc null', async () => {
    const stub = new StubReplicaPersistence();
    stub.seedDocument(ALICE, NS_B, makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 1, root: 5 }));
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.open(ALICE, NS_B));
    await schemaReady(lease);

    // 在途写先入队，reset 随后：carrier FIFO / close-drain 必须让已接纳写槽完整结算
    const writeP = lease.mutateRoot({ op: 'set', path: ['n'], value: 7 });
    const resetP = asResetRegistry(registry).resetReplica(ALICE, NS_B, {
      replicationId: ID_A,
      replicationEpoch: 1,
    });
    const [writeResult, resetResult] = await Promise.all([writeP, resetP]);
    expect(resetResult.ok, `reset 应成功：${JSON.stringify(resetResult)}`).toBe(true);
    expect((writeResult as { ok?: boolean } | undefined)?.ok).toBe(true);

    // 写后值完整结算并被归档（close→archive 串行：归档的内容 = 已排空写槽后的终态）
    expect(stub.archives).toHaveLength(1);
    expect(stub.archives[0]!.doc.getMap('ROOT').get('n')).toBe(7);
    // 终态：bootstrap eligibility + 持久面已归档
    expect(okIssue(await registry.open(ALICE, NS_B)).code).toBe('NAMESPACE_NOT_FOUND');
    expect(await stub.loadDoc(ALICE, NS_B)).toBeNull();
    await registry.shutdown();
  });

  it('并发 open + reset（reset 先接纳）：串行结算无部分状态——R2 冻结语义（设计 §3.4 ④ + SA2 R1-1）：无 live entry 且主键仍在 → RESET_FAILED（绝不从 persisted 事实单独归档）；open 后续恢复成功', async () => {
    // 【round-2 行为演进（SA2 R1-1 冻结）】round-1 阶段「无 entry + 主键仍在 → 直接
    // loadDoc 探针后归档」已被 R2 设计取代：reset 的 destructive preflight 必须基于
    // live/persisted 双源核对；无 live generation 时不得仅凭持久化事实归档——主键
    // 仍在 → 稳定 NAMESPACE_RESET_FAILED、主键缺失 → NAMESPACE_NOT_FOUND（零归档 seam）。
    const stub = new StubReplicaPersistence();
    stub.seedDocument(ALICE, NS_B, makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 1, root: 5 }));
    const registry = makeRegistry(stub);

    const resetP = asResetRegistry(registry).resetReplica(ALICE, NS_B, {
      replicationId: ID_A,
      replicationEpoch: 1,
    });
    const openP = registry.open(ALICE, NS_B);
    const [resetResult, openResult] = await Promise.all([resetP, openP]);
    // reset 先结算（carrier FIFO）：R2 冻结拒绝——零破坏、零归档
    expect(okIssue(resetResult).code).toBe('NAMESPACE_RESET_FAILED');
    expect(stub.archiveCalls).toEqual([]); // 零归档 seam（绝不从 persisted 事实单独归档）
    // open 后结算：从持久主键恢复新 generation（无部分状态）
    expect(openResult.ok, `open 应成功：${JSON.stringify(openResult)}`).toBe(true);
    const restored = (openResult as { lease: NamespaceLease }).lease;
    await schemaReady(restored);
    expect(restored.namespaceId).toBe(NS_B);
    expect(await stub.loadDoc(ALICE, NS_B)).not.toBeNull();
    await registry.shutdown();
  });

  it('并发 open + reset（open 先接纳）：open 得 lease → reset 对 active generation 预核对后归档成功（lease 强制失效）→ 终态 NOT_FOUND + loadDoc null', async () => {
    const stub = new StubReplicaPersistence();
    stub.seedDocument(ALICE, NS_B, makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 1, root: 5 }));
    const registry = makeRegistry(stub);

    const openP = registry.open(ALICE, NS_B);
    const resetP = asResetRegistry(registry).resetReplica(ALICE, NS_B, {
      replicationId: ID_A,
      replicationEpoch: 1,
    });
    const [openResult, resetResult] = await Promise.all([openP, resetP]);
    expect(openResult.ok, `open 应成功：${JSON.stringify(openResult)}`).toBe(true);
    expect(resetResult.ok, `reset 应成功：${JSON.stringify(resetResult)}`).toBe(true);
    // open 先结算：open 得到的 lease 被 reset 强制失效（已关闭 generation）
    expect((openResult as { lease: NamespaceLease }).lease.getStatus()).toMatchObject({ lease: 'released' });
    // 终态 = bootstrap eligibility + 持久面已归档（无部分删除）
    expect(okIssue(await registry.open(ALICE, NS_B)).code).toBe('NAMESPACE_NOT_FOUND');
    expect(stub.archives).toHaveLength(1);
    expect(await stub.loadDoc(ALICE, NS_B)).toBeNull();
    await registry.shutdown();
  });
});

// ═══════════════════════════════ AC-6：owner 分区独立 + 真实持久化全链闭环 ═══════════════════

describe('AC-6 owner 分区独立与 Memory/File 真实全链闭环', () => {
  it('owner 分区独立：ALICE reset 零影响 BOB 同 namespaceId 分区（内容/身份原样、BOB 可 open）', async () => {
    const stub = new StubReplicaPersistence();
    stub.seedDocument(ALICE, NS_B, makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 2, root: 11 }));
    stub.seedDocument(BOB, NS_B, makeSeedDoc(NS_B, { replicationId: ID_B, replicationEpoch: 9, root: 22 }));
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.open(ALICE, NS_B));
    await schemaReady(lease);

    const reset = await asResetRegistry(registry).resetReplica(ALICE, NS_B, {
      replicationId: ID_A,
      replicationEpoch: 2,
    });
    expect(reset.ok, `reset 应成功：${JSON.stringify(reset)}`).toBe(true);
    // 归档内容 = ALICE 分区
    expect(stub.archives).toHaveLength(1);
    expect(stub.archives[0]!.doc.getMap('META').get('replicationId')).toBe(ID_A);
    // BOB 分区零影响：同 namespaceId 不同 owner 的持久副本完整；entry 移除后可 open
    expect(await stub.loadDoc(BOB, NS_B)).not.toBeNull();
    const bobLease = okLease(await registry.open(BOB, NS_B));
    await schemaReady(bobLease);
    expect(leaseReadN(bobLease)).toBe(22);
    expect(leaseMeta(bobLease).replicationId).toBe(ID_B);
    expect(leaseMeta(bobLease).replicationEpoch).toBe(9);
    await registry.shutdown();
  });

  it('Memory 真实全链闭环：create → enable → flush → resetReplica → open NOT_FOUND → import（新 epoch）→ 身份/内容正确', async () => {
    // 真实 MemoryPersistence + hook-backed store（写/读钩子 = 唯一 store 权威）
    const store = new Map<string, Uint8Array>();
    const writerScheduler = createTestScheduler();
    const writer = createMemoryPersistence({
      scheduler: writerScheduler,
      schedule: { debounceMs: 1, maxDirtyMs: 1 },
      writeSnapshot: async (key, snapshot) => {
        store.set(key, snapshot.slice());
      },
      readSnapshot: async (key) => store.get(key),
      // R-1（设计 §4.10/§4.14.1 回流清单）：deleteSnapshot hook——本用例断言
      // reset 后 `store.has(key) === false`（主键移除的真实持久面证据），hook store
      // 的 Map.delete 只能由夹具提供的能力触达；无删除钩子则任何诚实设计都无法
      // 满足该断言（锚的前置缺口）。仅主键直传（R2：writeArchive 不经 writeSnapshot
      // hook、独立 archiveSnapshots 分区——本夹具不预设 archive-scoped key）。
      deleteSnapshot: async (key: string) => {
        store.delete(key);
      },
    } as MemoryPersistenceOptions);
    const registry = makeRegistry(writer);
    const lease = okLease(await registry.create(newContractInput({ root: { n: 42 } })));
    await schemaReady(lease);
    const nsId = lease.namespaceId;

    // 安装 Hub 复制身份（真实 enableReplication——META 复制保留字段经唯一写槽原子安装）
    expect((await asRepLease(lease).enableReplication()).ok).toBe(true);
    const id0 = leaseMeta(lease).replicationId as string;
    expect(id0).toMatch(/^[0-9a-f]{32}$/);
    // flush：enable 只登记 dirty（ADR 0006）——kick 后 store 才含复制身份（identity 持久事实）。
    // 直接 decode store 字节验证：落盘的 committed snapshot 已携带 identity（归档守卫无论读
    // 内存还是读持久快照，期望身份均成立——N-1 两种读法下测试都确定）。
    await writerScheduler.advanceBy(1_000);
    const persisted = new Y.Doc();
    Y.applyUpdate(persisted, store.get(`${ALICE.userId}\u0000${nsId}`) as Uint8Array);
    expect(persisted.getMap('META').get('replicationEpoch')).toBe(1);
    expect(persisted.getMap('META').get('replicationId')).toBe(id0);
    persisted.destroy();

    // Registry 公共 seam 回归：reset 驱动的 Runtime close 必须与普通 close 同样终止
    // 已打开的 ReplicationSession，不能让旧 generation 在 archive/bootstrap 后仍 attached。
    const openedSession = await asSessionLease(lease).openReplicationSession({
      localRole: 'hub',
      remoteInstanceId: 'peer-reset-regression',
    });
    expect(openedSession.ok, `session 应成功打开：${JSON.stringify(openedSession)}`).toBe(true);
    if (!openedSession.ok || openedSession.session === undefined) throw new Error('unreachable');
    const session = openedSession.session;
    expect(session.getStatus().state).toBe('open');

    const reset = await asResetRegistry(registry).resetReplica(ALICE, nsId, {
      replicationId: id0,
      replicationEpoch: 1,
    });
    expect(reset.ok, `reset 应成功：${JSON.stringify(reset)}`).toBe(true);
    expect(session.getStatus()).toMatchObject({ state: 'closed', closedBy: 'runtime-close' });
    // bootstrap eligibility：持久层主键已移除（真实 Memory archive）、open NOT_FOUND
    expect(store.has(`${ALICE.userId}\u0000${nsId}`)).toBe(false);
    expect(await writer.loadDoc(ALICE, nsId)).toBeNull();
    expect(okIssue(await registry.open(ALICE, nsId)).code).toBe('NAMESPACE_NOT_FOUND');

    // reset→bootstrap 闭环：受信导入（Hub 侧已 bump epoch 2）——身份同谱系、epoch 前进、
    // 内容全新
    const imported = await asImportRegistry(registry).importReplica(ALICE, nsId, makeSeedDoc(nsId, {
      replicationId: id0,
      replicationEpoch: 2,
      root: 888,
    }), {
      replicationId: id0,
      replicationEpoch: 2,
    });
    expect(imported.ok, `导入应成功：${JSON.stringify(imported)}`).toBe(true);
    const importedLease = (imported as { lease: NamespaceLease }).lease;
    await schemaReady(importedLease);
    expect(importedLease.namespaceId).toBe(nsId);
    expect(leaseReadN(importedLease)).toBe(888);
    expect(leaseMeta(importedLease).replicationId).toBe(id0);
    expect(leaseMeta(importedLease).replicationEpoch).toBe(2);
    await registry.shutdown();
    await (writer as unknown as { dispose(): Promise<void> }).dispose();
  });

  it('File 真实全链闭环（同 rootDir 重启语义）：create → enable → waitDurableSnapshot → reset → 归档文件在 rootDir → import → 重启恢复', async () => {
    const rootDir = path.join(
      os.tmpdir(),
      `nomicore-bootstrap-reset-file-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    );
    fileRootDirs.push(rootDir);
    const first = makeFileFixture(rootDir);
    const registry1 = makeRegistry(first.persistence);
    const lease = okLease(await registry1.create(newContractInput({ root: { n: 42 } })));
    await schemaReady(lease);
    const nsId = lease.namespaceId;

    expect((await asRepLease(lease).enableReplication()).ok).toBe(true);
    const id0 = leaseMeta(lease).replicationId as string;
    expect(id0).toMatch(/^[0-9a-f]{32}$/);
    // kick flush + issue #108 正式耐久等待：复制身份（epoch 1 + id0）落盘后才 reset
    // （归档守卫若读持久快照身份，identity 必须已 durable——两种守卫读法下均确定）
    await first.scheduler.advanceBy(1_000);
    await waitDurableSnapshot(ALICE, nsId, rootDir, (doc) => doc.getMap('META').get('replicationEpoch'), 1);
    await waitDurableSnapshot(ALICE, nsId, rootDir, (doc) => doc.getMap('META').get('replicationId'), id0);

    const reset = await asResetRegistry(registry1).resetReplica(ALICE, nsId, {
      replicationId: id0,
      replicationEpoch: 1,
    });
    expect(reset.ok, `reset 应成功：${JSON.stringify(reset)}`).toBe(true);
    expect(okIssue(await registry1.open(ALICE, nsId)).code).toBe('NAMESPACE_NOT_FOUND');
    expect(await first.persistence.loadDoc(ALICE, nsId)).toBeNull();

    // 归档文件在 rootDir 内且 decode 完整（AC-5 行为侧，Registry 编排可达面）
    const snapshotRel = `users/${ALICE.userId}/${nsId}.snapshot`;
    const files = await listFilesUnder(rootDir);
    expect(files).not.toContain(snapshotRel);
    expect(files.length).toBeGreaterThan(0);
    for (const rel of files) expect(rel.endsWith('.tmp')).toBe(false);

    // reset→bootstrap 闭环：受信导入（hub bump epoch 3）→ 内容/身份正确
    const imported = await asImportRegistry(registry1).importReplica(ALICE, nsId, makeSeedDoc(nsId, {
      replicationId: id0,
      replicationEpoch: 3,
      root: 777,
    }), {
      replicationId: id0,
      replicationEpoch: 3,
    });
    expect(imported.ok, `导入应成功：${JSON.stringify(imported)}`).toBe(true);
    const importedLease = (imported as { lease: NamespaceLease }).lease;
    await schemaReady(importedLease);
    expect(importedLease.namespaceId).toBe(nsId);
    expect(leaseReadN(importedLease)).toBe(777);
    expect(leaseMeta(importedLease).replicationEpoch).toBe(3);
    await registry1.shutdown();
    await first.dispose();

    // 进程重启语义：全新 FilePersistence（同 rootDir）+ 全新 Registry → open 恢复导入副本
    const second = makeFileFixture(rootDir);
    const registry2 = makeRegistry(second.persistence);
    const reopened = okLease(await registry2.open(ALICE, nsId));
    await schemaReady(reopened);
    expect(leaseReadN(reopened)).toBe(777);
    expect(leaseMeta(reopened).replicationId).toBe(id0);
    expect(leaseMeta(reopened).replicationEpoch).toBe(3);
    await registry2.shutdown();
    await second.dispose();
  });
});

// ═══════════════════════════════ 保持性守卫（基线已满足，预期绿） ═══════════════════════════════

describe('bootstrap/reset 保持性守卫（基线已满足，预期绿）', () => {
  it('普通 create 随机生成纪律不变：namespaceId 为 ns-+32hex、owner 分区持久化（#131/#132 冻结行为不受影响）', async () => {
    const stub = new StubReplicaPersistence();
    const registry = makeRegistry(stub);
    const created = okLease(await registry.create(newContractInput({ root: { n: 1 } })));
    await schemaReady(created);
    expect(created.namespaceId).toMatch(NAMESPACE_ID_PATTERN);
    // create 产物经 owner 分区（stub 存于 `${userId}\0${docId}`）——导入/reset 路径
    // 不得改变普通 create 的 owner-only 接纳与生成序列
    expect(await stub.loadDoc(ALICE, created.namespaceId)).not.toBeNull();
    await registry.shutdown();
  });
});

// ═══════════════════════════════ File 夹具（真实 tmpdir；afterEach 清理） ═══════════════════

const fileRootDirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    fileRootDirs.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })),
  );
});

interface FileFixture {
  readonly persistence: DocPersistence;
  readonly scheduler: ReturnType<typeof createTestScheduler>;
  dispose(): Promise<void>;
}

function makeFileFixture(rootDir: string): FileFixture {
  const scheduler = createTestScheduler();
  const persistence = new FilePersistence({
    rootDir,
    scheduler,
    schedule: { debounceMs: 1, maxDirtyMs: 1 },
  });
  return {
    persistence,
    scheduler,
    dispose: async () => {
      await (persistence as unknown as { dispose(): Promise<void> }).dispose();
    },
  };
}

async function listFilesUnder(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const rel = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), `${rel}/`);
      else files.push(rel);
    }
  }
  await walk(rootDir, '');
  return files.sort();
}

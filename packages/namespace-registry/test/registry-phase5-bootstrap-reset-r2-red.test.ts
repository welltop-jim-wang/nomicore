/**
 * SA6 红灯锚定（round=2）— issue #133（Phase 5: bootstrap import, archive, and
 * guarded replica reset）R2-AC-1..R2-AC-4 的 registry 侧：
 *
 * - R2-AC-1（反馈 1）：`resetReplica` 在**任何破坏性动作**（forceRelease / close /
 *   archive）之前，先将 live（Runtime/META 当前值）与 persisted replication
 *   identity 对 `expectedLocalIdentity` 做可靠核对；不匹配 → 领域拒绝（词汇
 *   `NAMESPACE_RESET_IDENTITY_MISMATCH`，round-1 已冻结），且当前
 *   generation/lease/runtime **完全保持可用（零破坏）**。
 * - R2-AC-2（反馈 1 竞态）：dirty identity/epoch（已 enableReplication /
 *   bumpReplicationEpoch 但尚未 flush、持久化仍为旧 identity）场景下 reset 不得
 *   关闭或归档错误 generation；身份核对必须读取正确的真相源（live vs persisted
 *   的核对口径以本锚 + 报告注释为基线，判定规则已由 SA1 R2/R3 设计冻结）。
 * - R2-AC-3/4（反馈 2）：bootstrap/import 路径（契约名 `importReplica`，
 *   **round-2 新增第 4 参数 expectedReplicationIdentity——已由 R2/R3 设计冻结；
 *   沿用 round-1 SA6 回流惯例**）在 persistence ownership 转移（importDoc
 *   resolve）之前校验 META 复制事实与 Hub 广告 expected `{replicationId,
 *   replicationEpoch}` **完全一致**（不止格式校验）：格式正确但 lineage 错误或
 *   epoch 不符 → 拒绝（词汇 `NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH`，
 *   已由 R2/R3 设计冻结），且**零持久化写入、零 entry 登记**。
 *
 * 红灯机制（HEAD = round-1 close-out 6784645，SA3 已落地 round-1 全部 52 红用例）：
 * - reset 前置核对缺失：当前 `runResetSlot` 先 forceRelease + close（破坏
 *   generation）后才由 archiveDoc 守卫（持久层、close 之后）拒绝 → 本锚的
 *   「零破坏」断言全部失败（lease 已 release、runtime 已 close、归档 seam 已触达）；
 * - import 广告身份绑定缺失：当前 `importReplica(owner, namespaceId, doc)` 不接收
 *   expected identity → 第 4 参数被忽略 → 格式合规的文档直接导入成功（本应拒绝）→
 *   拒绝码/零写入/零 entry 断言全部失败。
 *
 * 锚定纪律（沿 round-1）：真实 yjs / 真实 Registry+Runtime / 真实
 * MemoryPersistence（hook store 字节级）；stub 仅作持久化 seam 编排观测（真实
 * 调用面）；fake scheduler 脚本化驱动（零 real sleep）；零源码 grep 断言。
 *
 * 契约冻结声明（SA6 期「临时，待 SA1 冻结」措辞已按 R2/R3 设计冻结现状更新；
 * 行为断言零改动）：
 * - `importReplica(owner, namespaceId, doc, expectedReplicationIdentity)` ——
 *   **round-2 冻结签名**（第 4 参数 = Hub 广告 expected 身份）；调用面按
 *   round-1 回流惯例校准，行为断言（拒绝码/零写入/零 entry）不变；
 * - `NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH` —— **round-2 冻结拼写**（与
 *   round-1 的 NAMESPACE_IMPORT_IDENTITY_MISMATCH（META.docId ≠ namespaceId）
 *   语义区分：本码特指「格式合规但与 Hub 广告身份不一致」）；
 * - 核对口径：R2-AC-1 按简报原文「live/persisted 均与 expected 做可靠核对；
 *   任一不匹配 → 拒绝 + 零破坏」锚定（严格口径；其中「live 不匹配」用例两种口径
 *   下均拒绝，鲁棒；「仅 persisted 不匹配」用例为严格口径专属，见报告 §4 flag）；
 * - `ReplicationIdentityRef` 形状 `{ replicationId; replicationEpoch }`
 *   （round-1 已冻结形状，沿用户）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
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

// ═══════════════════════════════ 契约面本地声明（冻结名/冻结形状/冻结签名；与公共类型面结构一致） ═══════════════

/** 复制身份引用（冻结形状：与公共 ReplicationIdentityRef 逐字段一致——round-1 字段包装）。 */
interface ReplicationIdentityRef {
  readonly replicationId: string;
  readonly replicationEpoch: number;
}

/** resetReplica 编排面（round-1 冻结签名；结果面 shape 沿 round-1 窄结果先例）。 */
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

/** 内部受信任 bootstrap 导入面（冻结名 importReplica + **round-2 冻结第 4 参数**）。 */
interface ImportReplicaRegistry {
  readonly importReplica: (
    owner: NamespaceOwner,
    namespaceId: string,
    doc: Y.Doc,
    expectedReplicationIdentity: ReplicationIdentityRef,
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

// ═══════════════════════════════ 基础设施（沿 round-1 同款） ═══════════════════════════════

const SCHEMA_ENVELOPE = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'phase5-bootstrap-red-r2',
  text: 'type ROOT = { n: number; };\n',
});
const FIXED_MS = 1_700_000_123_456;
const ALICE: User = Object.freeze({ userId: 'u-alice' });
const NS_B = `ns-${'b'.repeat(32)}`;
const ID_A = 'a'.repeat(32);
const ID_B = 'b'.repeat(32);
const NAMESPACE_ID_PATTERN = /^ns-[0-9a-f]{32}$/;

/** 确定性计数随机源（仅 Registry 的 namespaceId 生成面；非 16 字节请求 → 拒）。 */
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

/** Lease status 观测（active 期 runtime 投影含复制身份事实——#132 第八键）。 */
function leaseStatus(lease: NamespaceLease): {
  lease: string;
  runtime: {
    lifecycle: string;
    schema: { state: string };
    read: { enabled: boolean };
    replication: { state: string; replicationId?: string; replicationEpoch?: number };
  } | null;
} {
  return lease.getStatus() as unknown as {
    lease: string;
    runtime: {
      lifecycle: string;
      schema: { state: string };
      read: { enabled: boolean };
      replication: { state: string; replicationId?: string; replicationEpoch?: number };
    } | null;
  };
}

function leaseReadN(lease: NamespaceLease): unknown {
  const read = lease.readData(['n']) as { ok?: boolean; value?: unknown };
  expect(read.ok, `期望读取成功，实际：${JSON.stringify(read)}`).toBe(true);
  return read.value;
}

function leaseMeta(lease: NamespaceLease): Record<string, unknown> {
  return lease.getMetadata();
}

/** 真实持久化 store 字节解码器（Memory hook store 为唯一读权威）。 */
function decodeStoredIdentity(store: Map<string, Uint8Array>, key: string): { replicationId: unknown; replicationEpoch: unknown } | null {
  const bytes = store.get(key);
  if (bytes === undefined) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bytes);
  const meta = doc.getMap('META');
  const out = { replicationId: meta.get('replicationId'), replicationEpoch: meta.get('replicationEpoch') };
  doc.destroy();
  return out;
}

// ═══════════════════════════════ Stub 持久化 seam（编排观测；沿 round-1 同款，零 mock 本地服务） ═══════════════

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

  /** 受控复制导入排他创建（round-1 契约：duplicate → 已冻结 DOC_DUPLICATE；docId 违约拒绝）。 */
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

  /** R2 只读 committed-identity probe（设计 §3.3：R2 test stub 必须提供——stub 的
   *  store 即 docs map，单一 Y.Doc 对象 = live==persisted 世界；按复制事实判据
   *  读取 META）。fixture 能力补充，非行为断言改动。 */
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

// ═══════════════════════════════ R2-AC-1：reset 前置身份核对（破坏性动作之前） ═══════════════════

describe('R2-AC-1 resetReplica 前置身份核对：不匹配 → 领域拒绝 + 当前 generation/lease/runtime 零破坏', () => {
  it('replicationId（lineage）不匹配：live/persisted 均 = ID_A，expected = ID_B → NAMESPACE_RESET_IDENTITY_MISMATCH + 零破坏', async () => {
    const stub = new StubReplicaPersistence();
    stub.seedDocument(ALICE, NS_B, makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 1, root: 5 }));
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.open(ALICE, NS_B));
    await schemaReady(lease);

    // live 真相源（Runtime status 复制域投影——#132 第八键）：enabled ID_A/1
    expect(leaseStatus(lease).runtime?.replication).toEqual({
      state: 'enabled',
      replicationId: ID_A,
      replicationEpoch: 1,
    });

    const issue = okIssue(
      await asResetRegistry(registry).resetReplica(ALICE, NS_B, {
        replicationId: ID_B,
        replicationEpoch: 1,
      }),
    );
    expect(issue.code).toBe('NAMESPACE_RESET_IDENTITY_MISMATCH');

    // —— R2-AC-1 核心：零破坏（身份不匹配时不得破坏当前 generation）——
    expect(leaseStatus(lease).lease).toBe('active'); // 原 lease 未被强制释放
    expect(leaseStatus(lease).runtime?.lifecycle).toBe('ready'); // Runtime generation 未关闭
    expect(leaseStatus(lease).runtime?.read.enabled).toBe(true);
    expect(leaseStatus(lease).runtime?.replication).toEqual({
      // live 身份不受干扰（仍 = 本地事实 ID_A/1）
      state: 'enabled',
      replicationId: ID_A,
      replicationEpoch: 1,
    });
    expect(leaseReadN(lease)).toBe(5); // 原 lease 仍可用（读路径未破）
    expect(stub.archiveCalls).toEqual([]); // 零归档调用（核对先于归档 seam 触达）
    expect(await stub.loadDoc(ALICE, NS_B)).not.toBeNull();
    await registry.shutdown();
  });

  it('同 id 不同 epoch：live/persisted 均 = ID_A/1，expected = ID_A/5 → NAMESPACE_RESET_IDENTITY_MISMATCH + 零破坏', async () => {
    const stub = new StubReplicaPersistence();
    stub.seedDocument(ALICE, NS_B, makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 1, root: 5 }));
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.open(ALICE, NS_B));
    await schemaReady(lease);

    const issue = okIssue(
      await asResetRegistry(registry).resetReplica(ALICE, NS_B, {
        replicationId: ID_A,
        replicationEpoch: 5,
      }),
    );
    expect(issue.code).toBe('NAMESPACE_RESET_IDENTITY_MISMATCH');

    // 零破坏 + 原 lease 可用
    expect(leaseStatus(lease).lease).toBe('active');
    expect(leaseStatus(lease).runtime?.lifecycle).toBe('ready');
    expect(leaseStatus(lease).runtime?.replication).toEqual({
      state: 'enabled',
      replicationId: ID_A,
      replicationEpoch: 1,
    });
    expect(leaseReadN(lease)).toBe(5);
    expect(stub.archiveCalls).toEqual([]);
    await registry.shutdown();
  });

  it('live 无复制身份（disabled）：expected 与任何复制身份都不符 → NAMESPACE_RESET_IDENTITY_MISMATCH + 零破坏', async () => {
    const stub = new StubReplicaPersistence();
    stub.seedDocument(ALICE, NS_B, makeSeedDoc(NS_B, { root: 5 })); // 无 replicationId/epoch（disabled 态）
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.open(ALICE, NS_B));
    await schemaReady(lease);

    expect(leaseStatus(lease).runtime?.replication).toEqual({ state: 'disabled' });

    const issue = okIssue(
      await asResetRegistry(registry).resetReplica(ALICE, NS_B, {
        replicationId: ID_A,
        replicationEpoch: 1,
      }),
    );
    expect(issue.code).toBe('NAMESPACE_RESET_IDENTITY_MISMATCH');

    // 零破坏：无复制身份的文档同样不得被 close/归档
    expect(leaseStatus(lease).lease).toBe('active');
    expect(leaseStatus(lease).runtime?.lifecycle).toBe('ready');
    expect(leaseReadN(lease)).toBe(5);
    expect(stub.archiveCalls).toEqual([]);
    await registry.shutdown();
  });
});

// ═══════════════════════════════ R2-AC-2：dirty 竞态（真实 persistent Memory） ═══════════════════

describe('R2-AC-2 dirty identity/epoch 竞态（真实 MemoryPersistence）：reset 不得关闭/归档错误 generation', () => {
  /** 竞态夹具：create → enable（epoch 1，flush 落盘）→ bump（live epoch 2，dirty 未 flush）。
   *  返回 { registry, lease, writer, store, primaryKey, id0, nsId }——调用方随后发起
   *  reset 并断言「不关闭/归档错误 generation」与「零强制 flush」。
   */
  async function makeDirtyRaceFixture(): Promise<{
    registry: NamespaceRegistry;
    lease: NamespaceLease;
    writer: ReturnType<typeof createMemoryPersistence>;
    store: Map<string, Uint8Array>;
    primaryKey: string;
    id0: string;
    nsId: string;
  }> {
    const store = new Map<string, Uint8Array>();
    const sched = createTestScheduler();
    const writer = createMemoryPersistence({
      scheduler: sched,
      schedule: { debounceMs: 1, maxDirtyMs: 1 },
      writeSnapshot: async (key, snapshot) => {
        store.set(key, snapshot.slice());
      },
      readSnapshot: async (key) => store.get(key),
      deleteSnapshot: async (key: string) => {
        store.delete(key);
      },
    } as MemoryPersistenceOptions);
    const registry = makeRegistry(writer);
    const lease = okLease(await registry.create(newContractInput({ root: { n: 42 } })));
    await schemaReady(lease);
    const nsId = lease.namespaceId;
    const primaryKey = `${ALICE.userId}\u0000${nsId}`;

    // 安装 Hub 复制身份（epoch 1）并 flush 落盘
    expect((await lease.enableReplication()).ok).toBe(true);
    const id0 = leaseMeta(lease).replicationId as string;
    expect(id0).toMatch(/^[0-9a-f]{32}$/);
    await sched.advanceBy(1_000);
    expect(decodeStoredIdentity(store, primaryKey)).toEqual({ replicationId: id0, replicationEpoch: 1 });

    // bump：live epoch 2（dirty——不 advance，persisted 仍 = epoch 1）——竞态前置成立
    expect((await lease.bumpReplicationEpoch() as { ok?: boolean }).ok).toBe(true);
    expect(leaseMeta(lease).replicationEpoch).toBe(2);
    expect(leaseStatus(lease).runtime?.replication).toEqual({
      state: 'enabled',
      replicationId: id0,
      replicationEpoch: 2,
    });
    expect(decodeStoredIdentity(store, primaryKey)).toEqual({ replicationId: id0, replicationEpoch: 1 });

    return { registry, lease, writer, store, primaryKey, id0, nsId };
  }

  it('竞态 A：expected = 持久化旧身份（ID_A/1）而 live 已 bump 至 epoch 2（dirty 未 flush）→ 拒绝 + 零破坏 + 无强制 flush', async () => {
    const { registry, lease, writer, store, primaryKey, id0, nsId } = await makeDirtyRaceFixture();

    // 调用方（复制插件）仍以 stale 的「持久化旧身份」为期望发起 reset——live 真相源
    // 已领先（epoch 2）：核对必须命中 live 不匹配 → 拒绝且先于任何破坏性动作
    const issue = okIssue(
      await asResetRegistry(registry).resetReplica(ALICE, nsId, {
        replicationId: id0,
        replicationEpoch: 1,
      }),
    );
    expect(issue.code).toBe('NAMESPACE_RESET_IDENTITY_MISMATCH');

    // 零破坏：live generation（epoch 2 的 Runtime）未被关闭/强制释放
    expect(leaseStatus(lease).lease).toBe('active');
    expect(leaseStatus(lease).runtime?.lifecycle).toBe('ready');
    expect(leaseStatus(lease).runtime?.replication).toEqual({
      state: 'enabled',
      replicationId: id0,
      replicationEpoch: 2,
    });
    expect(leaseReadN(lease)).toBe(42);
    // 竞态关键：拒绝路径零副作用——归档 seam 未被触达（主键仍在、未被移除）
    expect(store.has(primaryKey)).toBe(true);
    // 竞态关键：dirty 状态未被「顺带」强制 flush（持久化字节原样 = 旧 identity epoch 1）
    expect(decodeStoredIdentity(store, primaryKey)).toEqual({ replicationId: id0, replicationEpoch: 1 });
    await registry.shutdown();
    await (writer as unknown as { dispose(): Promise<void> }).dispose();
  });

  it('竞态 B：expected = live 新身份（ID_A/2）而 persisted 仍为旧（epoch 1，dirty 未 flush）→ 拒绝 + 零破坏 + 无强制 flush（严格口径）', async () => {
    const { registry, lease, writer, store, primaryKey, id0, nsId } = await makeDirtyRaceFixture();

    // 严格口径（R2-AC-1 原文：「live/persisted 均与 expected 做可靠核对；不匹配 → 拒绝」）：
    // persisted（epoch 1）≠ expected（epoch 2）→ 前置核对拒绝，零破坏——
    // 绝不出现「先关闭 live generation、再由归档守卫在 close 之后拒绝」的 round-1 缺陷
    const issue = okIssue(
      await asResetRegistry(registry).resetReplica(ALICE, nsId, {
        replicationId: id0,
        replicationEpoch: 2,
      }),
    );
    expect(issue.code).toBe('NAMESPACE_RESET_IDENTITY_MISMATCH');

    expect(leaseStatus(lease).lease).toBe('active');
    expect(leaseStatus(lease).runtime?.lifecycle).toBe('ready');
    expect(leaseStatus(lease).runtime?.replication).toEqual({
      state: 'enabled',
      replicationId: id0,
      replicationEpoch: 2,
    });
    expect(leaseReadN(lease)).toBe(42);
    expect(store.has(primaryKey)).toBe(true);
    // 持久化字节原样（epoch 1）——拒绝路径不排空 dirty（无 settle/flush 副作用）
    expect(decodeStoredIdentity(store, primaryKey)).toEqual({ replicationId: id0, replicationEpoch: 1 });
    await registry.shutdown();
    await (writer as unknown as { dispose(): Promise<void> }).dispose();
  });
});

// ═══════════════════════════════ R2-AC-3/4：import 绑定 Hub 广告身份 ═══════════════════

describe('R2-AC-3/4 importReplica 绑定 Hub 广告 expected {replicationId, replicationEpoch}：格式正确但身份不符 → 拒绝 + 零持久化写入 + 零 entry 登记', () => {
  it('META 格式正确但 replicationId（lineage）≠ Hub 广告 expected → NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH（已冻结拼写）+ 零持久化写入 + 零 entry 登记', async () => {
    const stub = new StubReplicaPersistence();
    const registry = makeRegistry(stub);
    // 文档身份：ID_B/1（格式完全合规——32 小写 hex / 从 1 起安全整数）
    const doc = makeSeedDoc(NS_B, { replicationId: ID_B, replicationEpoch: 1, root: 7 });

    const issue = okIssue(
      await asImportRegistry(registry).importReplica(ALICE, NS_B, doc, {
        replicationId: ID_A, // Hub 广告：lineage = ID_A → 与文档 ID_B 不符
        replicationEpoch: 1,
      }),
    );
    expect(issue.code).toBe('NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH');

    // 零持久化写入：persistence 导入 seam 未被触达、store 无残留、loadDoc 仍 null
    expect(stub.importCalls).toEqual([]);
    expect(await stub.loadDoc(ALICE, NS_B)).toBeNull();
    // 零 entry 登记：open → NAMESPACE_NOT_FOUND（与 open 的 not-found 契约同款零泄露）
    expect(okIssue(await registry.open(ALICE, NS_B)).code).toBe('NAMESPACE_NOT_FOUND');
    await registry.shutdown();
  });

  it('META 格式正确但 replicationEpoch ≠ Hub 广告 expected → NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH + 零持久化写入 + 零 entry 登记', async () => {
    const stub = new StubReplicaPersistence();
    const registry = makeRegistry(stub);
    // 文档：ID_A/1（格式合规）；Hub 广告：ID_A/2（epoch 不符——相同谱系不同代际
    // 即冲突，CONTEXT「复制代际」定义——不得在冲突状态转移 ownership）
    const doc = makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 1, root: 7 });

    const issue = okIssue(
      await asImportRegistry(registry).importReplica(ALICE, NS_B, doc, {
        replicationId: ID_A,
        replicationEpoch: 2,
      }),
    );
    expect(issue.code).toBe('NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH');

    expect(stub.importCalls).toEqual([]);
    expect(await stub.loadDoc(ALICE, NS_B)).toBeNull();
    expect(okIssue(await registry.open(ALICE, NS_B)).code).toBe('NAMESPACE_NOT_FOUND');
    await registry.shutdown();
  });

  it('真实 Memory：格式正确但 lineage 不符 → 拒绝 + store 零残留 + 零 entry；随后以正确 expected 重试成功（key 未被毒化）', async () => {
    const store = new Map<string, Uint8Array>();
    const sched = createTestScheduler();
    const writer = createMemoryPersistence({
      scheduler: sched,
      schedule: { debounceMs: 1, maxDirtyMs: 1 },
      writeSnapshot: async (key, snapshot) => {
        store.set(key, snapshot.slice());
      },
      readSnapshot: async (key) => store.get(key),
      deleteSnapshot: async (key: string) => {
        store.delete(key);
      },
    } as MemoryPersistenceOptions);
    const registry = makeRegistry(writer);
    const primaryKey = `${ALICE.userId}\u0000${NS_B}`;

    // 文档：ID_B/1 格式合规；Hub 广告：ID_A/1
    const issue = okIssue(
      await asImportRegistry(registry).importReplica(ALICE, NS_B, makeSeedDoc(NS_B, {
        replicationId: ID_B,
        replicationEpoch: 1,
        root: 7,
      }), {
        replicationId: ID_A,
        replicationEpoch: 1,
      }),
    );
    expect(issue.code).toBe('NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH');
    // 零持久化写入：store 无任何残留字节
    expect(store.has(primaryKey)).toBe(false);
    expect(await writer.loadDoc(ALICE, NS_B)).toBeNull();
    expect(okIssue(await registry.open(ALICE, NS_B)).code).toBe('NAMESPACE_NOT_FOUND');

    // key 未被毒化：同一 Hub 身份以正确期望重试 → 排他导入成功、内容完整
    const okResult = await asImportRegistry(registry).importReplica(ALICE, NS_B, makeSeedDoc(NS_B, {
      replicationId: ID_A,
      replicationEpoch: 1,
      root: 7,
    }), {
      replicationId: ID_A,
      replicationEpoch: 1,
    });
    expect(okResult.ok, `重试导入应成功：${JSON.stringify(okResult)}`).toBe(true);
    const importedLease = (okResult as { lease: NamespaceLease }).lease;
    await schemaReady(importedLease);
    expect(importedLease.namespaceId).toBe(NS_B);
    expect(leaseReadN(importedLease)).toBe(7);
    expect(leaseMeta(importedLease).replicationId).toBe(ID_A);
    expect(leaseMeta(importedLease).replicationEpoch).toBe(1);
    await registry.shutdown();
    await (writer as unknown as { dispose(): Promise<void> }).dispose();
  });
});

// ═══════════════════════════════ 保持性守卫（基线已满足，预期绿） ═══════════════════════════════

describe('R2 保持性守卫（基线已满足，预期绿）', () => {
  it('守卫绿：META 格式合法且与 Hub 广告 expected 完全一致 → 导入成功路径不受新增核对影响（身份/内容原样）', async () => {
    const stub = new StubReplicaPersistence();
    const registry = makeRegistry(stub);
    const doc = makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 1, root: 123 });

    const result = await asImportRegistry(registry).importReplica(ALICE, NS_B, doc, {
      replicationId: ID_A,
      replicationEpoch: 1,
    });
    expect(result.ok, `导入应成功：${JSON.stringify(result)}`).toBe(true);
    const lease = (result as { lease: NamespaceLease }).lease;
    await schemaReady(lease);
    expect(lease.namespaceId).toBe(NS_B);
    expect(leaseReadN(lease)).toBe(123);
    expect(leaseMeta(lease).replicationId).toBe(ID_A);
    expect(leaseMeta(lease).replicationEpoch).toBe(1);
    await registry.shutdown();
  });

  it('守卫绿：普通 create 随机生成纪律不变（namespaceId 为 ns-+32hex；导入/重置路径不改变 create 接纳）', async () => {
    const stub = new StubReplicaPersistence();
    const registry = makeRegistry(stub);
    const created = okLease(await registry.create(newContractInput({ root: { n: 1 } })));
    await schemaReady(created);
    expect(created.namespaceId).toMatch(NAMESPACE_ID_PATTERN);
    expect(await stub.loadDoc(ALICE, created.namespaceId)).not.toBeNull();
    await registry.shutdown();
  });
});

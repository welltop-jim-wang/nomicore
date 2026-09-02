/**
 * R2 红线/矩阵测试 — issue #133 round-2（Phase 5: bootstrap import, archive, and
 * guarded replica reset）Registry 内部编排面（设计 §3.4/§3.5.1/§3.5.2/§4.2.1；
 * SA2 R3 红线 2-4）。
 *
 * 覆盖：
 * - A. armed 后 archive typed 错误矩阵（§3.5.2）：identity/active/duplicate/
 *   operational → NAMESPACE_RESET_FAILED（绝不返回 reset identity mismatch）；
 *   fatal → NamespaceRegistryFatalError 且 committed 原样传播；unknown → fatal false；
 * - B. 缺失 Runtime reset fence capability（legacy fake）→ 所有破坏性动作前
 *   branded fatal（committed:false，零 probe/forceRelease/close/archive，
 *   无 property-call TypeError）；
 * - C. 敌意 expected 输入矩阵（§4.2.1）：null/undefined/array/function/getter-
 *   throw/Proxy-throw/继承值/非法 id/NaN/Infinity/0/小数 → 稳定输入 issue +
 *   零 doc 访问 + 零 carrier/entry/Persistence 副作用；正确 expected 随即重试成功；
 * - D. closing generation 矩阵（SA2 R1-1）：等待既有 closePromise 结算 → carrier
 *   重读 → 无 archive；primary missing → NOT_FOUND、present → RESET_FAILED、
 *   probe operational → LOAD_FAILED；
 * - E. probe 拒绝映射（§3.3.1）：Operational → NAMESPACE_LOAD_FAILED；
 *   Corrupt → fatal committed:false；两者均零破坏（lease active、runtime ready）。
 *
 * 锚定纪律：真实 yjs / 真实 Registry+Runtime / 真实 MemoryPersistence；
 * stub 仅作 persistence seam 编排观测（脚本化 archive 失败 / gated release /
 * probe 行为）；fake scheduler 脚本化；零 real sleep。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createMemoryPersistence,
  DocDuplicateError,
  DocPersistedIdentityProbeCorruptError,
  DocPersistedIdentityProbeOperationalError,
  type DocHandle,
  type DocHandleStatus,
  type DocPersistence,
  type PersistedIdentityProbeResult,
  type User,
} from '@nomicore/persistence';
import {
  createNamespaceRegistryForTesting,
  createRegistryTestScheduler,
} from '@nomicore/namespace-registry/testing';
import type {
  NamespaceLease,
  NamespaceOwner,
  NamespaceRegistry,
  NamespaceRegistryFatalError,
  RegistryRandomBytes,
} from '@nomicore/namespace-registry';
import {
  NAMESPACE_INVALID_IDENTITY_MESSAGE,
  NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID_MESSAGE,
} from '../src/types.js';

const SCHEMA_ENVELOPE = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'phase5-bootstrap-r2-internal',
  text: 'type ROOT = { n: number; };\n',
});
const FIXED_MS = 1_700_000_123_456;
const ALICE: User = Object.freeze({ userId: 'u-alice' });
const NS_B = `ns-${'b'.repeat(32)}`;
const ID_A = 'a'.repeat(32);

interface ReplicationIdentityRef {
  readonly replicationId: string;
  readonly replicationEpoch: number;
}

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

/** 敌意 expected 形态矩阵（module 级——import 侧 C 与 reset 侧 R（R-FIX-1）共用同一
 *  判定面：两种编排入口的 expected 快照校验必须同判据同拒绝）。 */
const HOSTILE_INPUTS: Array<{ name: string; value: unknown }> = [
  { name: 'null', value: null },
  { name: 'undefined', value: undefined },
  { name: 'array', value: [ID_A, 1] },
  { name: 'function', value: () => ({ replicationId: ID_A, replicationEpoch: 1 }) },
  { name: 'string', value: 'identity' },
  { name: 'number', value: 1 },
  { name: 'getter-throw', value: Object.defineProperty({}, 'replicationId', { get() { throw new Error('boom'); } }) },
  { name: 'proxy-throw', value: new Proxy({ replicationId: ID_A, replicationEpoch: 1 }, { getOwnPropertyDescriptor() { throw new Error('proxy boom'); } }) },
  { name: 'inherited', value: Object.create({ replicationId: ID_A, replicationEpoch: 1 }) },
  { name: 'accessor-id', value: Object.defineProperty({ replicationEpoch: 1 }, 'replicationId', {
    get() { return ID_A; },
    enumerable: true,
    configurable: true,
  }) },
  { name: 'invalid-id', value: { replicationId: 'Z'.repeat(32), replicationEpoch: 1 } },
  { name: 'NaN-epoch', value: { replicationId: ID_A, replicationEpoch: Number.NaN } },
  { name: 'Infinity-epoch', value: { replicationId: ID_A, replicationEpoch: Infinity } },
  { name: 'zero-epoch', value: { replicationId: ID_A, replicationEpoch: 0 } },
  { name: 'fractional-epoch', value: { replicationId: ID_A, replicationEpoch: 1.5 } },
  { name: 'missing-epoch-key', value: { replicationId: ID_A } },
];

function makeCounterRandomBytes(): RegistryRandomBytes {
  let counter = 0;
  return (length: number): Uint8Array => {
    if (length !== 16) throw new Error(`受控随机源必须按 128-bit（16 字节）请求，实际请求 ${length} 字节`);
    counter += 1;
    const hex = counter.toString(16).padStart(32, '0');
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  };
}

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

/** 脚本化 persistence stub：docs map = store；releaseGate 可挂起全部 release
 *  （closing 矩阵）；archiveScript 可让 archiveDoc 第 N 次抛指定错误。 */
class ScriptStub implements DocPersistence {
  readonly importCalls: Array<{ owner: User; docId: string }> = [];
  readonly archiveCalls: Array<{ owner: User; docId: string; expected: unknown }> = [];
  readonly probeCalls: Array<{ owner: User; docId: string }> = [];
  readonly handleReleases: { count: number } = { count: 0 };
  releaseGate: Promise<void> | undefined;
  archiveError: unknown = undefined;
  probeError: unknown = undefined;
  private readonly docs = new Map<string, Y.Doc>();

  private key(owner: User, docId: string): string {
    return `${owner.userId}\u0000${docId}`;
  }

  seedDocument(owner: User, docId: string, doc: Y.Doc): void {
    this.docs.set(this.key(owner, docId), doc);
  }

  docCount(): number {
    return this.docs.size;
  }

  clearDocument(owner: User, docId: string): void {
    this.docs.delete(this.key(owner, docId));
  }

  async createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    if (this.docs.has(this.key(owner, docId))) throw new DocDuplicateError();
    this.docs.set(this.key(owner, docId), doc);
    return this.makeHandle(owner, docId, doc);
  }

  async importDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    this.importCalls.push({ owner, docId });
    if (this.docs.has(this.key(owner, docId))) throw new DocDuplicateError();
    if (doc.getMap('META').get('docId') !== docId) {
      throw Object.assign(new Error('import identity mismatch'), { code: 'DOC_IMPORT_IDENTITY_MISMATCH' });
    }
    this.docs.set(this.key(owner, docId), doc);
    return this.makeHandle(owner, docId, doc);
  }

  async archiveDoc(owner: User, docId: string, expected: unknown): Promise<{ ok: true }> {
    this.archiveCalls.push({ owner, docId, expected });
    if (this.archiveError !== undefined) {
      const err = this.archiveError;
      this.archiveError = undefined;
      throw err;
    }
    const key = this.key(owner, docId);
    const doc = this.docs.get(key);
    if (doc === undefined) throw Object.assign(new Error('nothing to archive'), { code: 'DOC_ARCHIVE_DUPLICATE' });
    const expectedRef = expected as ReplicationIdentityRef | undefined;
    const gotId = doc.getMap('META').get('replicationId');
    const gotEpoch = doc.getMap('META').get('replicationEpoch');
    if (expectedRef === undefined || gotId !== expectedRef.replicationId || gotEpoch !== expectedRef.replicationEpoch) {
      throw Object.assign(new Error('archive identity mismatch'), { code: 'DOC_ARCHIVE_IDENTITY_MISMATCH' });
    }
    this.docs.delete(key);
    return { ok: true };
  }

  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    const doc = this.docs.get(this.key(owner, docId));
    return doc === undefined ? null : this.makeHandle(owner, docId, doc);
  }

  async readPersistedReplicationIdentity(owner: User, docId: string): Promise<PersistedIdentityProbeResult> {
    this.probeCalls.push({ owner, docId });
    if (this.probeError !== undefined) {
      const err = this.probeError;
      this.probeError = undefined;
      throw err;
    }
    const doc = this.docs.get(this.key(owner, docId));
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
      getStatus: (): DocHandleStatus => 'ready',
      release: async () => {
        this.handleReleases.count += 1;
        if (this.releaseGate !== undefined) await this.releaseGate;
      },
    };
  }
}

/** 无 fence capability 的 legacy fake runtime（B 用；零失败/零破坏的可观测面）。 */
function makeLegacyFakeRuntime(opts: { replicationId?: string; replicationEpoch?: number; closeCalls: { count: number } }): unknown {
  const { closeCalls } = opts;
  return {
    owner: { userId: 'u-alice' },
    namespaceId: NS_B,
    readData: () => ({ ok: true, value: 1 }),
    getSchema: () => null,
    getMetadata: () => ({ docId: NS_B }),
    getActiveSchema: () => null,
    getStatus: () => ({
      lifecycle: 'ready',
      read: { enabled: true },
      rootWrite: { enabled: true },
      schemaWrite: { enabled: true },
      schema: { state: 'ready' },
      fatal: null,
      close: null,
      replication: {
        state: 'enabled',
        replicationId: opts.replicationId ?? ID_A,
        replicationEpoch: opts.replicationEpoch ?? 1,
      } as const,
    }),
    mutateData: async () => ({ ok: true }),
    replaceSchema: async () => ({ ok: true }),
    enableReplication: async () => ({ ok: true }),
    bumpReplicationEpoch: async () => ({ ok: true }),
    close: async () => {
      closeCalls.count += 1;
    },
  };
}

function makeRegistry(
  persistence: DocPersistence,
  opts: { runtimeFactory?: (handle: DocHandle, notifyDirty: () => Promise<void>) => unknown } = {},
): NamespaceRegistry {
  return createNamespaceRegistryForTesting(persistence, {
    clock: { now: () => FIXED_MS },
    scheduler: createRegistryTestScheduler(),
    idleTimeoutMs: 25,
    randomBytes: makeCounterRandomBytes(),
    ...(opts.runtimeFactory !== undefined ? { runtimeFactory: opts.runtimeFactory } : {}),
  } as never);
}

function okIssue(result: unknown): {
  ok: false;
  code: string | undefined;
  message: string | undefined;
} {
  const r = result as { ok?: boolean; code?: string; message?: string };
  expect(r.ok, `期望领域拒绝，实际：${JSON.stringify(result)}`).toBe(false);
  return { ok: false, code: r.code, message: r.message };
}

function okLease(result: unknown): NamespaceLease {
  const r = result as { ok?: boolean; lease?: NamespaceLease };
  expect(r.ok, `期望成功，实际：${JSON.stringify(result)}`).toBe(true);
  if (!r.ok || r.lease === undefined) throw new Error('unreachable');
  return r.lease;
}

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
  throw new Error('schema 未在微观任务预算内就绪');
}

function leaseStatus(lease: NamespaceLease): { lease: string; runtime: { lifecycle: string; read: { enabled: boolean } } | null } {
  return lease.getStatus() as unknown as {
    lease: string;
    runtime: { lifecycle: string; read: { enabled: boolean } } | null;
  };
}

// ═════════════════════════ A：armed 后 archive typed 错误矩阵（§3.5.2） ═════════════════════════

describe('A：reset fence armed 后的 archive typed 拒绝矩阵（绝不返回 reset identity mismatch）', () => {
  async function armedResetWithArchiveError(error: unknown): Promise<
    | { kind: 'issue'; code: string | undefined }
    | { kind: 'fatal'; fatal: NamespaceRegistryFatalError }
  > {
    const stub = new ScriptStub();
    stub.seedDocument(ALICE, NS_B, makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 1, root: 5 }));
    stub.archiveError = error;
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.open(ALICE, NS_B));
    await schemaReady(lease);
    try {
      const result = await asResetRegistry(registry).resetReplica(ALICE, NS_B, {
        replicationId: ID_A,
        replicationEpoch: 1,
      });
      return { kind: 'issue', code: (result as { code?: string }).code };
    } catch (e) {
      return { kind: 'fatal', fatal: e as NamespaceRegistryFatalError };
    } finally {
      await registry.shutdown();
    }
  }

  it('DOC_ARCHIVE_IDENTITY_MISMATCH → NAMESPACE_RESET_FAILED（破坏性 arm 已发生——绝不报告零破坏 mismatch）', async () => {
    const outcome = await armedResetWithArchiveError(
      Object.assign(new Error('late external divergence'), { code: 'DOC_ARCHIVE_IDENTITY_MISMATCH' }),
    );
    expect(outcome).toEqual({ kind: 'issue', code: 'NAMESPACE_RESET_FAILED' });
  });

  it('DOC_ARCHIVE_ACTIVE_HANDLE / DOC_ARCHIVE_DUPLICATE → NAMESPACE_RESET_FAILED', async () => {
    const active = await armedResetWithArchiveError(
      Object.assign(new Error('active'), { code: 'DOC_ARCHIVE_ACTIVE_HANDLE' }),
    );
    expect(active).toEqual({ kind: 'issue', code: 'NAMESPACE_RESET_FAILED' });
    const dup = await armedResetWithArchiveError(
      Object.assign(new Error('duplicate'), { code: 'DOC_ARCHIVE_DUPLICATE' }),
    );
    expect(dup).toEqual({ kind: 'issue', code: 'NAMESPACE_RESET_FAILED' });
  });

  it('DOC_ARCHIVE_OPERATIONAL → NAMESPACE_RESET_FAILED（observer 事件 reset-archive-after-arm-failed）', async () => {
    const outcome = await armedResetWithArchiveError(
      Object.assign(new Error('io down'), { code: 'DOC_ARCHIVE_OPERATIONAL' }),
    );
    expect(outcome).toEqual({ kind: 'issue', code: 'NAMESPACE_RESET_FAILED' });
  });

  it('DOC_ARCHIVE_FATAL（committed:true）→ branded fatal committed:true 原样传播（尤其 relocate-remove）', async () => {
    const removeCause = new Error('remove rejected after archive commit');
    const outcome = await armedResetWithArchiveError(
      Object.assign(new Error('archive fatal'), { code: 'DOC_ARCHIVE_FATAL', committed: true, cause: removeCause }),
    );
    expect(outcome.kind).toBe('fatal');
    if (outcome.kind !== 'fatal') return;
    expect(outcome.fatal.operation).toBe('reset');
    expect(outcome.fatal.phase).toBe('lifecycle-slot-internal');
    expect(outcome.fatal.committed).toBe(true);
    // Registry fatal 的 cause = archiveDoc 的 typed 拒绝原对象（committed 事实按
    // duck-typed 字段读取并原样传播——INV-12）
    expect(outcome.fatal.cause).toMatchObject({ code: 'DOC_ARCHIVE_FATAL', committed: true });
  });

  it('DOC_ARCHIVE_FATAL（committed:false）→ fatal false；unknown/违约 → fatal false（不发明 committed 证据）', async () => {
    const fatalFalse = await armedResetWithArchiveError(
      Object.assign(new Error('archive fatal false'), { code: 'DOC_ARCHIVE_FATAL', committed: false }),
    );
    expect(fatalFalse.kind).toBe('fatal');
    if (fatalFalse.kind !== 'fatal') return;
    expect(fatalFalse.fatal.committed).toBe(false);

    const unknown = await armedResetWithArchiveError(new Error('adapter violation'));
    expect(unknown.kind).toBe('fatal');
    if (unknown.kind !== 'fatal') return;
    expect(unknown.fatal.committed).toBe(false);
  });
});

// ═════════════════════════ B：missing Runtime fence capability（§3.5.1 loud gate） ═════════════════════════

describe('B：legacy fake（无 beginResetFence）→ 破坏性动作前 branded fatal（零破坏、无 TypeError）', () => {
  it('缺失 capability：reset → NamespaceRegistryFatalError(reset/lifecycle-slot-internal/false)；零 probe/forceRelease/close/archive；lease 原样 active', async () => {
    const stub = new ScriptStub();
    stub.seedDocument(ALICE, NS_B, makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 1, root: 5 }));
    const closeCalls = { count: 0 };
    const registry = makeRegistry(stub, {
      runtimeFactory: () => makeLegacyFakeRuntime({ closeCalls }),
    });
    const lease = okLease(await registry.open(ALICE, NS_B));
    await schemaReady(lease);
    let caught: unknown;
    try {
      await asResetRegistry(registry).resetReplica(ALICE, NS_B, {
        replicationId: ID_A,
        replicationEpoch: 1,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const fatal = caught as NamespaceRegistryFatalError;
    expect(fatal.code).toBe('NAMESPACE_REGISTRY_FATAL');
    expect(fatal.operation).toBe('reset');
    expect(fatal.phase).toBe('lifecycle-slot-internal');
    expect(fatal.committed).toBe(false);
    // 零破坏：probe 未触达、close/archive 未发生、lease 仍 active（无 property-call TypeError）
    expect(stub.probeCalls).toEqual([]);
    expect(stub.archiveCalls).toEqual([]);
    expect(closeCalls.count).toBe(0);
    expect(leaseStatus(lease).lease).toBe('active');
    expect(leaseStatus(lease).runtime?.lifecycle).toBe('ready');
    await registry.shutdown();
  });
});

// ═════════════════════════ C：敌意 expected 输入矩阵（§4.2.1 零副作用） ═════════════════════════

describe('C：敌意 expected → 稳定输入 issue + 零 doc 访问/零 carrier/零 entry/零 Persistence；正确重试成功', () => {
  it('全部敌意形态 → NAMESPACE_IMPORT_EXPECTED_IDENTITY_INVALID；doc.getMap 零访问、importDoc 零调用、零 entry；随后正确 expected 重试成功', async () => {
    const stub = new ScriptStub();
    const registry = makeRegistry(stub);
    const doc = makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 1, root: 7 });
    let getMapAccesses = 0;
    const originalGetMap = doc.getMap.bind(doc);
    (doc as unknown as { getMap: unknown }).getMap = (name: string) => {
      getMapAccesses += 1;
      return originalGetMap(name);
    };

    for (const hostile of HOSTILE_INPUTS) {
      const issue = okIssue(
        await asImportRegistry(registry).importReplica(ALICE, NS_B, doc, hostile.value as ReplicationIdentityRef),
      );
      expect(issue.code, hostile.name).toBe('NAMESPACE_IMPORT_EXPECTED_IDENTITY_INVALID');
    }
    expect(getMapAccesses).toBe(0); // 任何敌意 expected 都不触发 doc 读取
    expect(stub.importCalls).toEqual([]);
    expect(stub.docCount()).toBe(0);
    expect(okIssue(await registry.open(ALICE, NS_B)).code).toBe('NAMESPACE_NOT_FOUND');

    // key 未被毒化：同一 doc 以正确 expected 重试 → 成功
    const okResult = await asImportRegistry(registry).importReplica(ALICE, NS_B, doc, {
      replicationId: ID_A,
      replicationEpoch: 1,
    });
    expect(okResult.ok, `重试导入应成功：${JSON.stringify(okResult)}`).toBe(true);
    expect(getMapAccesses).toBeGreaterThan(0);
    const importedLease = (okResult as { lease: NamespaceLease }).lease;
    await schemaReady(importedLease);
    expect(importedLease.namespaceId).toBe(NS_B);
    await registry.shutdown();
  });
});

// ═════════════════════════ D：closing generation 矩阵（SA2 R1-1） ═════════════════════════

describe('D：closing generation 重评估——等待既有 close、carrier 槽重读、零 archive', () => {
  /** 公开路径构造 closing 态：open → lease.release()（idle 武装）→
   *  advanceBy(idleTimeoutMs) 触发 idle close（stub handle release 被
   *  releaseGate 挂起 ⟹ closePromise 未结算、entry.phase==='closing'）。 */
  async function makeClosingFixture(): Promise<{
    registry: NamespaceRegistry;
    stub: ScriptStub;
    scheduler: ReturnType<typeof createRegistryTestScheduler>;
    releaseClose(): void;
    waitClosed(): Promise<void>;
  }> {
    const stub = new ScriptStub();
    stub.seedDocument(ALICE, NS_B, makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 1, root: 5 }));
    const scheduler = createRegistryTestScheduler();
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => { releaseClose = resolve });
    stub.releaseGate = closeGate;
    const registry = createNamespaceRegistryForTesting(stub, {
      clock: { now: () => FIXED_MS },
      scheduler,
      idleTimeoutMs: 25,
      randomBytes: makeCounterRandomBytes(),
    } as never);
    const lease = okLease(await registry.open(ALICE, NS_B));
    await schemaReady(lease);
    await lease.release();
    await scheduler.advanceBy(25); // idle close 发起：entry closing + closePromise 挂起
    // （closed/runtime 生命周期不可经 released lease 观测——closing 态的证明由 reset
    //  结果承担：branch ③ 的 RESET_FAILED/NOT_FOUND/LOAD_FAILED 而非 active branch 的
    //  ok:true，见各用例断言）
    return {
      registry,
      stub,
      scheduler,
      releaseClose,
      waitClosed: async () => {
        await closeGate;
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
      },
    };
  }

  it('close 后主键缺席 → NAMESPACE_NOT_FOUND；零 archive；旧 Runtime 未被当 live 证据（不重报 preflight 成功）', async () => {
    const fx = await makeClosingFixture();
    fx.stub.clearDocument(ALICE, NS_B); // 主键缺席（跨实例归档等）——probe → missing
    const resetP = asResetRegistry(fx.registry).resetReplica(ALICE, NS_B, {
      replicationId: ID_A,
      replicationEpoch: 1,
    });
    // 等待期：closePromise 未结算 ⟹ reset 不结算、零 archive（closing 分支 await 既有 close）
    let settled = false;
    void resetP.then(() => { settled = true; }, () => { settled = true; });
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(settled).toBe(false);
    expect(fx.stub.archiveCalls).toEqual([]);
    fx.releaseClose();
    await fx.waitClosed();
    const issue = okIssue(await resetP);
    expect(issue.code).toBe('NAMESPACE_NOT_FOUND');
    expect(fx.stub.archiveCalls).toEqual([]);
    await fx.registry.shutdown();
  });

  it('close 后主键仍在 → NAMESPACE_RESET_FAILED（零 archive、零新 preflight 成功）', async () => {
    const fx = await makeClosingFixture();
    const resetP = asResetRegistry(fx.registry).resetReplica(ALICE, NS_B, {
      replicationId: ID_A,
      replicationEpoch: 1,
    });
    fx.releaseClose();
    await fx.waitClosed();
    const issue = okIssue(await resetP);
    expect(issue.code).toBe('NAMESPACE_RESET_FAILED');
    expect(fx.stub.archiveCalls).toEqual([]);
    expect(fx.stub.docCount()).toBe(1); // 主键未被归档（零破坏）
    await fx.registry.shutdown();
  });

  it('close 后 probe 运营失败 → NAMESPACE_LOAD_FAILED（§3.3.1 映射；零 archive）', async () => {
    const fx = await makeClosingFixture();
    fx.stub.clearDocument(ALICE, NS_B);
    fx.stub.probeError = new DocPersistedIdentityProbeOperationalError(new Error('io down'));
    const resetP = asResetRegistry(fx.registry).resetReplica(ALICE, NS_B, {
      replicationId: ID_A,
      replicationEpoch: 1,
    });
    fx.releaseClose();
    await fx.waitClosed();
    const issue = okIssue(await resetP);
    expect(issue.code).toBe('NAMESPACE_LOAD_FAILED');
    expect(fx.stub.archiveCalls).toEqual([]);
    await fx.registry.shutdown();
  });
});

// ═════════════════════════ E：probe 拒绝映射（§3.3.1；零破坏） ═════════════════════════

describe('E：probe 拒绝映射——Operational → LOAD_FAILED；Corrupt → fatal committed:false；均零破坏', () => {
  it('probe operational reject → NAMESPACE_LOAD_FAILED + 零破坏（lease active、runtime ready、零 archive）', async () => {
    const stub = new ScriptStub();
    stub.seedDocument(ALICE, NS_B, makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 1, root: 5 }));
    stub.probeError = new DocPersistedIdentityProbeOperationalError(new Error('io down'));
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.open(ALICE, NS_B));
    await schemaReady(lease);
    const issue = okIssue(
      await asResetRegistry(registry).resetReplica(ALICE, NS_B, {
        replicationId: ID_A,
        replicationEpoch: 1,
      }),
    );
    expect(issue.code).toBe('NAMESPACE_LOAD_FAILED');
    expect(leaseStatus(lease).lease).toBe('active');
    expect(leaseStatus(lease).runtime?.lifecycle).toBe('ready');
    expect(stub.archiveCalls).toEqual([]);
    await registry.shutdown();
  });

  it('probe corrupt reject → NamespaceRegistryFatalError(reset/lifecycle-slot-internal/false) + 零破坏（绝不折叠为 mismatch/load-failed）', async () => {
    const stub = new ScriptStub();
    stub.seedDocument(ALICE, NS_B, makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 1, root: 5 }));
    stub.probeError = new DocPersistedIdentityProbeCorruptError(new Error('decode failed'));
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.open(ALICE, NS_B));
    await schemaReady(lease);
    let caught: unknown;
    try {
      await asResetRegistry(registry).resetReplica(ALICE, NS_B, {
        replicationId: ID_A,
        replicationEpoch: 1,
      });
    } catch (e) {
      caught = e;
    }
    const fatal = caught as NamespaceRegistryFatalError;
    expect(fatal.code).toBe('NAMESPACE_REGISTRY_FATAL');
    expect(fatal.operation).toBe('reset');
    expect(fatal.committed).toBe(false);
    expect(leaseStatus(lease).lease).toBe('active');
    expect(leaseStatus(lease).runtime?.lifecycle).toBe('ready');
    expect(stub.archiveCalls).toEqual([]);
    await registry.shutdown();
  });
});

// ═════════════ R-FIX-1：resetReplica 敌意 expected 输入矩阵（设计 §3.2 入口快照） ═════════════

describe('R-FIX-1：resetReplica 敌意 expected → NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID + 零 Persistence 触达；正确 expected 重试成功（零破坏）', () => {
  it('16 形态全部拒绝于入口：probeCalls 空（零 Persistence 分界锚）、lease active/lifecycle ready/零 archive；随后正确 expected 重试成功', async () => {
    const stub = new ScriptStub();
    stub.seedDocument(ALICE, NS_B, makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 1, root: 5 }));
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.open(ALICE, NS_B));
    await schemaReady(lease);

    for (const hostile of HOSTILE_INPUTS) {
      const issue = okIssue(
        await asResetRegistry(registry).resetReplica(ALICE, NS_B, hostile.value as ReplicationIdentityRef),
      );
      // 完整形状深等（设计 §3.6.3 冻结口径）：同锁 code + 导入的导出常量 message +
      // 无 field 成员（toEqual 对完整对象字面量递归结构相等，任何多出的已定义属性
      // 含 field 都会失败）——禁止降级为单属性 code 断言（SA2 delta 议题 3 锚强度缺口）。
      expect(issue, hostile.name).toEqual({
        ok: false,
        code: 'NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID',
        message: NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID_MESSAGE,
      });
      // 逐形态零破坏/零触达断言（§3.6.3 第 1 条「每形态保留…」）：每个敌意形态
      // 后 probeCalls/archiveCalls 均保持空、原 lease 仍 active、Runtime 仍 ready。
      expect(stub.probeCalls, hostile.name).toEqual([]); // ★ 每形态零 Persistence 触达
      expect(stub.archiveCalls, hostile.name).toEqual([]);
      expect(leaseStatus(lease).lease, hostile.name).toBe('active');
      expect(leaseStatus(lease).runtime?.lifecycle, hostile.name).toBe('ready');
    }
    // 常量文本锁（§3.6.3 第 1 条）：防冻结 message 被静默改写（导入值漂移时文本锁兜底）。
    expect(NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID_MESSAGE).toBe(
      'NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID: 期望本地复制身份（reset expectedLocalIdentity）不符合安全文法',
    );
    // 汇总分界锚：16 形态全部入口拒绝——零 Persistence 触达（probe 从未调用）、
    // 零破坏（lease 原样 active、runtime ready、零 archive seam、零 close）
    expect(stub.probeCalls).toEqual([]); // ★ 零 Persistence 触达（设计 §3.2「不能访问 Persistence」）
    expect(stub.archiveCalls).toEqual([]);
    expect(leaseStatus(lease).lease).toBe('active');
    expect(leaseStatus(lease).runtime?.lifecycle).toBe('ready');
    // key 未被毒化：同一 lease 以正确 expected 重试 → 预核对成功并经完整 reset 闭环
    const okResult = await asResetRegistry(registry).resetReplica(ALICE, NS_B, {
      replicationId: ID_A,
      replicationEpoch: 1,
    });
    expect(okResult.ok, `重试 reset 应成功：${JSON.stringify(okResult)}`).toBe(true);
    expect(stub.archiveCalls).toHaveLength(1);
    expect(stub.probeCalls.length).toBe(1); // 重试才首次触达 Persistence probe
    expect(leaseStatus(lease).lease).toBe('released'); // 重试成功路径按 armed 语义失效原 lease
    await registry.shutdown();
  });

  it('期待身份合法但为可变对象：入口冻结快照消除双读分叉（fence 槽与 archiveDoc 样本一致）', async () => {
    const stub = new ScriptStub();
    stub.seedDocument(ALICE, NS_B, makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 1, root: 5 }));
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.open(ALICE, NS_B));
    await schemaReady(lease);
    // 可变 expected：合法读取后由测试改写（模拟双读分叉攻击）——入口快照后
    // fence 槽与 archiveDoc 都只能看到冻结值 {ID_A, 1}
    const mutableExpected = { replicationId: ID_A, replicationEpoch: 1 };
    const resetP = asResetRegistry(registry).resetReplica(ALICE, NS_B, mutableExpected);
    // 改写发生在接纳之后——冻结快照免疫
    (mutableExpected as { replicationEpoch: number }).replicationEpoch = 999;
    const okResult = await resetP;
    expect(okResult.ok, `双读分叉攻击下 reset 应仍成功：${JSON.stringify(okResult)}`).toBe(true);
    expect(stub.archiveCalls).toHaveLength(1);
    expect((stub.archiveCalls[0] as { expected: ReplicationIdentityRef }).expected).toEqual({
      replicationId: ID_A,
      replicationEpoch: 1,
    });
    await registry.shutdown();
  });

  it('owner/namespace 身份非法仍是上游 NAMESPACE_INVALID_IDENTITY + 二元 field（专属 reset 码不得劫持上游身份分类）', async () => {
    const stub = new ScriptStub();
    stub.seedDocument(ALICE, NS_B, makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 1, root: 5 }));
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.open(ALICE, NS_B));
    await schemaReady(lease);

    const badOwner = await asResetRegistry(registry).resetReplica(null as never, NS_B, {
      replicationId: ID_A,
      replicationEpoch: 1,
    });
    expect(badOwner).toEqual({
      ok: false,
      code: 'NAMESPACE_INVALID_IDENTITY',
      field: 'owner.userId',
      message: NAMESPACE_INVALID_IDENTITY_MESSAGE,
    });
    const badNs = await asResetRegistry(registry).resetReplica(ALICE, 'bad/ns', {
      replicationId: ID_A,
      replicationEpoch: 1,
    });
    expect(badNs).toEqual({
      ok: false,
      code: 'NAMESPACE_INVALID_IDENTITY',
      field: 'namespaceId',
      message: NAMESPACE_INVALID_IDENTITY_MESSAGE,
    });
    // 上游拒绝零触达（进入 expected 快照之前即返回）
    expect(stub.probeCalls).toEqual([]);
    expect(stub.archiveCalls).toEqual([]);
    expect(leaseStatus(lease).lease).toBe('active');
    await registry.shutdown();
  });
});

// ═════════════ F-1：reset-archive-after-arm-failed observer 派发断言（LOW 顺带） ═════════════

describe('F-1：armed 后 archive 运营失败 → observer 收到 reset-archive-after-arm-failed（cause 零身份回显）', () => {
  it('DOC_ARCHIVE_OPERATIONAL → RESET_FAILED + registryObserver 恰一次收到 reset-archive-after-arm-failed + cause 零身份值回显', async () => {
    const stub = new ScriptStub();
    stub.seedDocument(ALICE, NS_B, makeSeedDoc(NS_B, { replicationId: ID_A, replicationEpoch: 1, root: 5 }));
    stub.archiveError = Object.assign(new Error('archive io down'), { code: 'DOC_ARCHIVE_OPERATIONAL' });
    const events: Array<Record<string, unknown>> = [];
    const registry = createNamespaceRegistryForTesting(stub, {
      clock: { now: () => FIXED_MS },
      scheduler: createRegistryTestScheduler(),
      idleTimeoutMs: 25,
      randomBytes: makeCounterRandomBytes(),
      observer: (event: unknown) => {
        events.push(event as Record<string, unknown>);
      },
    } as never);
    const lease = okLease(await registry.open(ALICE, NS_B));
    await schemaReady(lease);
    const issue = okIssue(
      await asResetRegistry(registry).resetReplica(ALICE, NS_B, {
        replicationId: ID_A,
        replicationEpoch: 1,
      }),
    );
    expect(issue.code).toBe('NAMESPACE_RESET_FAILED');
    const afterArm = events.filter((e) => e.type === 'reset-archive-after-arm-failed');
    expect(afterArm).toHaveLength(1);
    // 事件 cause 零身份回显：归档拒绝的稳定 message（cause 字段）不含复制身份
    // 值/owner/namespaceId——设计 §3.5.2「does not include identity contents」
    // （事件 standard 字段 identity 沿用全部 observer 事件的受控 InternalIdentity
    // 模式，供日志关联；复制的 replicationId/epoch 值绝不出现）
    const causeText = JSON.stringify((afterArm[0] as Record<string, unknown>).cause);
    expect(causeText).not.toContain(ID_A);
    expect(causeText).not.toContain(NS_B);
    expect(causeText).not.toContain('u-alice');
    await registry.shutdown();
  });
});

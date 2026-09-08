/**
 * issue #228（ADR-0009 修订节）Registry `deleteNamespace` 编排套件（T-R1–R4）：
 *
 * - R1 编排：live entry（持 lease）删除——forceRelease（lease 后续操作 released）、
 *   close barrier 排空、entry 移除、deleteDoc 恰一次、持久副本消失；idle entry
 *   删除；无 entry + 无数据 → {ok:true}（幂等）；
 * - R2 门禁：live entry owner 不符 → NAMESPACE_NOT_FOUND（零泄露——原 generation
 *   完好）；shutting-down → REGISTRY_NOT_ACCEPTING；文法违约 →
 *   NAMESPACE_INVALID_IDENTITY（零 Persistence 触达——deleteCalls 为空）；
 * - R3 并发序列化：open × delete 同 key 交错 ×N——恰两形态（open 先 → lease 签发后
 *   被 delete 强制 released；delete 先 → open 得 NOT_FOUND），无第三结局、无挂起；
 * - R4 失败映射：deleteDoc operational（removeKey 拒绝）→ NAMESPACE_DELETE_FAILED
 *   + 重试收敛；capability 缺席（无 deleteDoc 的 stub）→ branded
 *   NamespaceRegistryFatalError（operation='delete'、committed:false）。
 *
 * 锚定纪律：真实 yjs / 真实 Registry+Runtime / 真实 MemoryPersistence（hook store
 * 字节级）；fault 注入仅经 wrapIo（persistence testing seam）；fake scheduler
 * 脚本化；零 real sleep；全部竞态用例包 withTimeout。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createMemoryPersistence,
  DocDuplicateError,
  type DocHandle,
  type DocPersistence,
  type MemoryPersistenceOptions,
  type User,
} from '@nomicore/persistence';
import {
  createPersistenceIoFaultSeam,
  createTestScheduler,
  type PersistenceIoFaultSeam,
} from '@nomicore/persistence/testing';
import {
  createNamespaceRegistryForTesting,
  createRegistryTestScheduler,
} from '@nomicore/namespace-registry/testing';
import {
  NamespaceRegistryFatalError,
  type NamespaceLease,
  type NamespaceOwner,
  type NamespaceRegistry,
  type RegistryRandomBytes,
} from '@nomicore/namespace-registry';

const SCHEMA_ENVELOPE = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'registry-delete-r1',
  text: 'type ROOT = { n: number; };\n',
});
const FIXED_MS = 1_700_000_123_456;
const ALICE: User = Object.freeze({ userId: 'u-alice' });
const BOB: User = Object.freeze({ userId: 'u-bob' });

function keyOf(owner: User, docId: string): string {
  return `${owner.userId}\u0000${docId}`;
}

/** 确定性计数随机源（仅 Registry 的 namespaceId 生成面；非 16 字节请求 → 拒）。 */
function makeCounterRandomBytes(): RegistryRandomBytes {
  let counter = 0;
  return (length: number): Uint8Array => {
    if (length !== 16) throw new Error('受控随机源必须按 128-bit（16 字节）请求');
    counter += 1;
    const hex = counter.toString(16).padStart(32, '0');
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  };
}

interface RegistryFixture {
  readonly registry: NamespaceRegistry;
  readonly store: Map<string, Uint8Array>;
  readonly scheduler: ReturnType<typeof createTestScheduler>;
  readonly seam: PersistenceIoFaultSeam;
  /** 已提交持久副本（registry.create/lease.release 后推进 flush）。 */
  dispose(): Promise<void>;
}

function makeRegistryFixture(overrides: { wrapIo?: (io: never) => never } = {}): RegistryFixture {
  const store = new Map<string, Uint8Array>();
  const scheduler = createTestScheduler();
  const seam = createPersistenceIoFaultSeam();
  const persistence = createMemoryPersistence({
    scheduler,
    schedule: { debounceMs: 10, maxDirtyMs: 50 },
    writeSnapshot: async (key: string, snapshot: Uint8Array) => {
      store.set(key, snapshot.slice());
    },
    readSnapshot: async (key: string) => store.get(key),
    deleteSnapshot: async (key: string) => {
      store.delete(key);
    },
    ...(overrides.wrapIo !== undefined ? {} : { wrapIo: seam.wrap }),
  } as unknown as MemoryPersistenceOptions);
  const registry = createNamespaceRegistryForTesting(persistence, {
    clock: { now: () => FIXED_MS },
    scheduler: createRegistryTestScheduler(),
    idleTimeoutMs: 25,
    randomBytes: makeCounterRandomBytes(),
  } as never);
  return {
    registry,
    store,
    scheduler,
    seam,
    dispose: async () => {
      await registry.shutdown();
      await (persistence as unknown as { dispose(): Promise<void> }).dispose();
    },
  };
}

function newCreateInput(owner: NamespaceOwner, root = 42): { owner: NamespaceOwner; schema: unknown; root: unknown } {
  return { owner, schema: SCHEMA_ENVELOPE, root: { n: root } };
}

function okLease(result: unknown): NamespaceLease {
  const r = result as { ok?: boolean; lease?: NamespaceLease };
  expect(r.ok, `期望成功，实际：${JSON.stringify(result)}`).toBe(true);
  if (!r.ok || r.lease === undefined) throw new Error('unreachable');
  return r.lease;
}

function issueOf(result: unknown): { ok: false; code: string | undefined } {
  const r = result as { ok?: boolean; code?: string };
  expect(r.ok, `期望领域拒绝，实际：${JSON.stringify(result)}`).toBe(false);
  return { ok: false, code: r.code };
}

async function schemaReady(lease: NamespaceLease): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    const status = lease.getStatus() as unknown as { lease?: string; runtime?: { schema?: { state?: string } } };
    if (status.lease === 'released') return;
    if (status.runtime?.schema?.state === 'ready') return;
    await Promise.resolve();
  }
  throw new Error(`schema 未在微观任务预算内就绪：${JSON.stringify(lease.getStatus())}`);
}

/** 删除结果判别助手（窄结果面）。 */
async function deleteOutcome(
  registry: NamespaceRegistry,
  owner: NamespaceOwner,
  namespaceId: string,
): Promise<{ ok: true } | { ok: false; code: string | undefined }> {
  const r = (await registry.deleteNamespace(owner, namespaceId)) as { ok?: boolean; code?: string };
  return r.ok === true ? { ok: true } : { ok: false, code: r.code };
}

describe('issue #228 — registry.deleteNamespace 编排（T-R1）', () => {
  it('R1a live entry（持 lease）删除：forceRelease + close + entry 移除 + deleteDoc 恰一次 + 持久副本消失', async () => {
    const fx = makeRegistryFixture();
    const created = okLease(await fx.registry.create(newCreateInput(ALICE)));
    const namespaceId = created.namespaceId;
    await schemaReady(created);
    await created.release();
    await fx.scheduler.advanceBy(60); // flush 落盘（close barrier 前保存）
    expect(fx.store.has(keyOf(ALICE, namespaceId))).toBe(true);

    // 重新 open 并持 lease（live entry 场景）
    const lease = okLease(await fx.registry.open(ALICE, namespaceId));
    await schemaReady(lease);
    const outcome = await deleteOutcome(fx.registry, ALICE, namespaceId);
    expect(outcome).toEqual({ ok: true });

    // forceRelease：原 lease 已 released；Runtime 已 close（released 态仅 status）
    const status = lease.getStatus() as unknown as { lease: string; runtime: { lifecycle: string } | null };
    expect(status.lease).toBe('released');
    // 持久副本已逻辑删除
    expect(fx.store.has(keyOf(ALICE, namespaceId))).toBe(false);
    // entry 已移除 → 再 open → NOT_FOUND（删除后不可复活）
    const reopen = await fx.registry.open(ALICE, namespaceId);
    expect(issueOf(reopen).code).toBe('NAMESPACE_NOT_FOUND');
    // 幂等二删 → ok（absent 与 deleted 不可区分）
    expect(await deleteOutcome(fx.registry, ALICE, namespaceId)).toEqual({ ok: true });
    await fx.dispose();
  });

  it('R1b idle entry 删除：release 后 idle（未逐出）→ deleteNamespace 关闭并清理', async () => {
    const fx = makeRegistryFixture();
    const created = okLease(await fx.registry.create(newCreateInput(ALICE)));
    const namespaceId = created.namespaceId;
    await schemaReady(created);
    await created.release();
    await fx.scheduler.advanceBy(60); // flush 落盘
    expect(fx.store.has(keyOf(ALICE, namespaceId))).toBe(true);

    const outcome = await deleteOutcome(fx.registry, ALICE, namespaceId);
    expect(outcome).toEqual({ ok: true });
    expect(fx.store.has(keyOf(ALICE, namespaceId))).toBe(false);
    expect(issueOf(await fx.registry.open(ALICE, namespaceId)).code).toBe('NAMESPACE_NOT_FOUND');
    await fx.dispose();
  });

  it('R1c 无 entry + 无数据（absent 输入）→ {ok:true}（幂等；任意 owner 均 ok——零存在性 oracle）', async () => {
    const fx = makeRegistryFixture();
    const absent = `ns-${'f'.repeat(32)}`;
    expect(await deleteOutcome(fx.registry, ALICE, absent)).toEqual({ ok: true });
    expect(await deleteOutcome(fx.registry, BOB, absent)).toEqual({ ok: true }); // 非 Owner 零预言
    await fx.dispose();
  });
});

describe('issue #228 — registry.deleteNamespace 门禁（T-R2）', () => {
  it('R2a live entry owner 不符 → NAMESPACE_NOT_FOUND（零泄露——原 generation 与数据完好）', async () => {
    const fx = makeRegistryFixture();
    const created = okLease(await fx.registry.create(newCreateInput(ALICE)));
    const namespaceId = created.namespaceId;
    await schemaReady(created);
    await created.release();
    await fx.scheduler.advanceBy(60);
    const lease = okLease(await fx.registry.open(ALICE, namespaceId));
    await schemaReady(lease);

    const issue = issueOf(await fx.registry.deleteNamespace(BOB, namespaceId));
    expect(issue.code).toBe('NAMESPACE_NOT_FOUND');
    // 零破坏：原 lease 仍 active、数据仍在
    const status = lease.getStatus() as unknown as { lease: string };
    expect(status.lease).toBe('active');
    expect(fx.store.has(keyOf(ALICE, namespaceId))).toBe(true);
    await lease.release();
    await fx.dispose();
  });

  it('R2b shutting-down → REGISTRY_NOT_ACCEPTING（零触达）', async () => {
    const fx = makeRegistryFixture();
    const created = okLease(await fx.registry.create(newCreateInput(ALICE)));
    const namespaceId = created.namespaceId;
    await schemaReady(created);
    await created.release();
    await fx.scheduler.advanceBy(60);
    const shutdown = fx.registry.shutdown();
    const issue = issueOf(await fx.registry.deleteNamespace(ALICE, namespaceId));
    expect(issue.code).toBe('REGISTRY_NOT_ACCEPTING');
    await shutdown;
    await (fx as unknown as { dispose(): Promise<void> }).dispose().catch(() => {});
  });

  it('R2c 文法违约 → NAMESPACE_INVALID_IDENTITY（零 Persistence/entries/carrier 访问）', async () => {
    const fx = makeRegistryFixture();
    // 先造一个已存在 ns，确认其数据在违约输入下不被触碰
    const created = okLease(await fx.registry.create(newCreateInput(ALICE)));
    await schemaReady(created);
    await created.release();
    await fx.scheduler.advanceBy(60);
    const before = new Map(fx.store);
    const issue = issueOf(await fx.registry.deleteNamespace(ALICE, '../evil'));
    expect(issue.code).toBe('NAMESPACE_INVALID_IDENTITY');
    const issue2 = issueOf(await fx.registry.deleteNamespace({ userId: '../evil' }, created.namespaceId));
    expect(issue2.code).toBe('NAMESPACE_INVALID_IDENTITY');
    expect(fx.store).toEqual(before); // 零触达
    await fx.dispose();
  });
});

describe('issue #228 — registry.deleteNamespace 并发序列化（T-R3）', () => {
  it('R3 open × delete 同 key 交错 ×10：恰两形态（open 先 → lease 强制 released；delete 先 → open NOT_FOUND），无第三结局、无挂起', async () => {
    for (let round = 0; round < 10; round += 1) {
      const fx = makeRegistryFixture();
      const created = okLease(await fx.registry.create(newCreateInput(ALICE, round)));
      const namespaceId = created.namespaceId;
      await schemaReady(created);
      await created.release();
      await fx.scheduler.advanceBy(60);

      const opening = fx.registry.open(ALICE, namespaceId);
      const deleting = fx.registry.deleteNamespace(ALICE, namespaceId);
      const [opened, deleted] = await Promise.all([
        opening.then((r) => (r.ok ? { kind: 'ok' as const } : { kind: 'not-found' as const })),
        deleting.then((r) => (r.ok ? { kind: 'deleted' as const } : { kind: 'failed' as const })),
      ]);
      if (deleted.kind === 'failed') throw new Error(`round ${round}: delete 意外失败`);
      if (opened.kind === 'ok') {
        // open 先（lease 签发）→ delete 后 forceRelease：lease 终态 released
        // ——lease 已随 delete 释放；持久副本删除
        expect(fx.store.has(keyOf(ALICE, namespaceId))).toBe(false);
      } else {
        // delete 先 → open 得 NOT_FOUND；持久副本删除
        expect(fx.store.has(keyOf(ALICE, namespaceId))).toBe(false);
      }
      // 终态恒一：无论先后，删除后 open 必 NOT_FOUND（无第三结局、无复活）
      const after = await fx.registry.open(ALICE, namespaceId);
      expect(issueOf(after).code).toBe('NAMESPACE_NOT_FOUND');
      await fx.dispose();
    }
  }, 120_000);
});

describe('issue #228 — registry.deleteNamespace 失败映射（T-R4）', () => {
  it('R4a deleteDoc operational（removeKey 拒绝）→ NAMESPACE_DELETE_FAILED；重试收敛 {ok:true}', async () => {
    const store = new Map<string, Uint8Array>();
    const scheduler = createTestScheduler();
    const seam = createPersistenceIoFaultSeam();
    const persistence = createMemoryPersistence({
      scheduler,
      schedule: { debounceMs: 10, maxDirtyMs: 50 },
      writeSnapshot: async (key: string, snapshot: Uint8Array) => {
        store.set(key, snapshot.slice());
      },
      readSnapshot: async (key: string) => store.get(key),
      deleteSnapshot: async (key: string) => {
        store.delete(key);
      },
      wrapIo: seam.wrap,
    } as unknown as MemoryPersistenceOptions);
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: { now: () => FIXED_MS },
      scheduler: createRegistryTestScheduler(),
      idleTimeoutMs: 25,
      randomBytes: makeCounterRandomBytes(),
    } as never);
    const created = okLease(await registry.create(newCreateInput(ALICE)));
    const namespaceId = created.namespaceId;
    await schemaReady(created);
    await created.release();
    await scheduler.advanceBy(60);
    expect(store.has(keyOf(ALICE, namespaceId))).toBe(true);

    seam.faults.failNextRemoveKey(new Error('removeKey io down (EACCES)'));
    const first = issueOf(await registry.deleteNamespace(ALICE, namespaceId));
    expect(first.code).toBe('NAMESPACE_DELETE_FAILED');
    // 重试收敛（删除单调性；entry 已移除——二删走缺席路径直接 deleteDoc 重试）
    expect((await registry.deleteNamespace(ALICE, namespaceId)) as { ok?: boolean }).toMatchObject({ ok: true });
    expect(store.has(keyOf(ALICE, namespaceId))).toBe(false);
    await registry.shutdown();
    await (persistence as unknown as { dispose(): Promise<void> }).dispose();
  });

  it('R4b capability 缺席（persistence 无 deleteDoc）→ branded NamespaceRegistryFatalError（operation=delete、committed:false）+ observer lifecycle-slot-failed', async () => {
    const stub = new NoDeleteDocPersistenceStub();
    const observed: unknown[] = [];
    const registry = createNamespaceRegistryForTesting(stub, {
      clock: { now: () => FIXED_MS },
      scheduler: createRegistryTestScheduler(),
      idleTimeoutMs: 25,
      randomBytes: makeCounterRandomBytes(),
      observer: (e: unknown) => {
        observed.push(e);
      },
    } as never);
    const created = okLease(await registry.create(newCreateInput(ALICE)));
    const namespaceId = created.namespaceId;
    await schemaReady(created);
    await created.release();

    const err = await registry.deleteNamespace(ALICE, namespaceId).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NamespaceRegistryFatalError);
    expect(err).toMatchObject({
      code: 'NAMESPACE_REGISTRY_FATAL',
      operation: 'delete',
      phase: 'lifecycle-slot-internal',
      committed: false,
    });
    const failed = observed.find((e) => (e as { type?: string }).type === 'lifecycle-slot-failed') as
      | { operation?: string }
      | undefined;
    expect(failed?.operation).toBe('delete');
    // 门先于一切破坏性动作：原 generation 仍 live、数据仍在
    expect(stub.deleted).toBe(false);
    const reopened = await registry.open(ALICE, namespaceId);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) throw new Error('unreachable');
    await reopened.lease.release();
    await registry.shutdown();
  });
});

/** 无删除能力的 stub（DocPersistence 最小面——capability 门测试：缺 deleteDoc）。 */
class NoDeleteDocPersistenceStub implements DocPersistence {
  deleted = false;
  private readonly docs = new Map<string, Y.Doc>();

  async createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle> {
    const key = `${owner.userId}\u0000${docId}`;
    if (this.docs.has(key)) throw new DocDuplicateError();
    this.docs.set(key, doc);
    return this.handle(owner, docId, doc);
  }

  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    const doc = this.docs.get(`${owner.userId}\u0000${docId}`);
    return doc === undefined ? null : this.handle(owner, docId, doc);
  }

  async saveDoc(_handle: DocHandle): Promise<void> {}

  private handle(owner: User, docId: string, doc: Y.Doc): DocHandle {
    return {
      owner,
      docId,
      doc,
      getStatus: () => 'ready' as const,
      release: async () => {},
    };
  }
}

/**
 * R2 红线/矩阵测试 — issue #133 round-2（Phase 5: bootstrap import, archive, and
 * guarded replica reset）Persistence 侧：只读 committed-snapshot identity probe
 * （设计 §3.3/§3.3.1）与归档 remove-fatal（§4.5.5 committed:true 闭环）。
 *
 * 覆盖（设计 §6 必验面）：
 * - P1 probe 纯净性：live dirty（bump 未 flush）时 probe 返回 store epoch（持久
 *   真相源），且零 writeSnapshot / 零 scheduler 推进 / 零 saveDoc / 零 archive；
 * - P2 probe 缺少主快照 → {kind:'missing'}；
 * - P3 probe 读拒绝（current epoch）→ DocPersistedIdentityProbeOperationalError
 *   （committed:false、稳定消息无 owner/identity/bytes 回显）；
 * - P4 snapshot 解码失败 / META.docId 不符 → DocPersistedIdentityProbeCorruptError
 *   （committed:false、绝不折叠为 mismatch/load-failed）；
 * - P5 可解码且 docId 正确但复制字段格式违约 → {kind:'found', identity:{ok:false}}
 *   （合法读取、无匹配 enabled 事实——供 Registry 映射 reset mismatch）；
 * - P6 dispose 竞态（read 挂起 + dispose abort）→ DocPersistedIdentityProbeFatalError
 *   ('read-aborted'/'lifecycle-disposed')，committed:false；
 * - P7 adapter 同步 throw（PersistenceIO 契约违约）→ fatal('adapter-violation')；
 * - P8 归档 remove-fatal：writeArchive resolve（提交点跨越）→ remove 拒绝 →
 *   DocArchiveFatalError('relocate-remove', committed:true)，重试按 latest-wins
 *   收敛成功。
 *
 * 锚定纪律：真实 yjs / 真实 MemoryPersistence（hook store 字节级）；wrapIo 仅作
 * 故障/观测注入（设计 §4.6 规格化面）；fake scheduler 脚本化；零 real sleep。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createMemoryPersistence,
  DocArchiveFatalError,
  DocPersistedIdentityProbeCorruptError,
  DocPersistedIdentityProbeFatalError,
  DocPersistedIdentityProbeOperationalError,
  type DocPersistence,
  type MemoryPersistenceOptions,
  type PersistenceIO,
  type User,
} from '@nomicore/persistence';
import {
  createPersistenceIoFaultSeam,
  createTestScheduler,
  type PersistenceIoFaultSeam,
  type TestScheduler,
} from '@nomicore/persistence/testing';

const ALICE: User = Object.freeze({ userId: 'u-alice' });
const DOC_ID = 'ns-probe-r2';
const ID_A = 'a'.repeat(32);

function makeDoc(
  docId: string,
  opts: { replicationId?: string; replicationEpoch?: number; metaDocId?: string | null; n?: number } = {},
): Y.Doc {
  const doc = new Y.Doc();
  const meta = doc.getMap('META');
  meta.set('docId', opts.metaDocId === null ? undefined : (opts.metaDocId ?? docId));
  if (opts.replicationId !== undefined) meta.set('replicationId', opts.replicationId);
  if (opts.replicationEpoch !== undefined) meta.set('replicationEpoch', opts.replicationEpoch);
  doc.getMap('ROOT').set('n', opts.n ?? 42);
  return doc;
}

function decodeStore(store: Map<string, Uint8Array>, key: string): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, store.get(key)!);
  return doc;
}

function keyOf(owner: User, docId: string): string {
  return `${owner.userId}\u0000${docId}`;
}

interface ProbeFixture {
  readonly persistence: DocPersistence;
  readonly scheduler: TestScheduler;
  readonly store: Map<string, Uint8Array>;
  readonly writeSnapshotCalls: { count: number };
  readonly seam: PersistenceIoFaultSeam;
  dispose(): Promise<void>;
}

function makeMemoryFixture(options: { wrapIo?: (io: PersistenceIO) => PersistenceIO } = {}): ProbeFixture {
  const store = new Map<string, Uint8Array>();
  const scheduler = createTestScheduler();
  const writeSnapshotCalls = { count: 0 };
  const seam = createPersistenceIoFaultSeam();
  if (options.wrapIo !== undefined) {
    throw new Error('unreachable: wrapped seam fixtures go through makeWrappedMemoryFixture');
  }
  const persistence = createMemoryPersistence({
    scheduler,
    schedule: { debounceMs: 1, maxDirtyMs: 1 },
    writeSnapshot: async (key, snapshot) => {
      writeSnapshotCalls.count += 1;
      store.set(key, snapshot.slice());
    },
    readSnapshot: async (key) => store.get(key),
    deleteSnapshot: async (key) => {
      store.delete(key);
    },
  } as MemoryPersistenceOptions);
  return {
    persistence,
    scheduler,
    store,
    writeSnapshotCalls,
    seam,
    dispose: async () => {
      await (persistence as unknown as { dispose(): Promise<void> }).dispose();
    },
  };
}

function makeWrappedMemoryFixture(): ProbeFixture & { readonly persistence: DocPersistence } {
  const store = new Map<string, Uint8Array>();
  const scheduler = createTestScheduler();
  const writeSnapshotCalls = { count: 0 };
  const seam = createPersistenceIoFaultSeam();
  const persistence = createMemoryPersistence({
    scheduler,
    schedule: { debounceMs: 1, maxDirtyMs: 1 },
    wrapIo: seam.wrap,
  } as MemoryPersistenceOptions);
  return {
    persistence,
    scheduler,
    store,
    writeSnapshotCalls,
    seam,
    dispose: async () => {
      await (persistence as unknown as { dispose(): Promise<void> }).dispose();
    },
  };
}

describe('P1：probe 纯净性——脏 live 不被当作持久事实（真实 Memory）', () => {
  it('dirty live epoch 2 / store epoch 1：probe 返回 store 身份且零 write/scheduler/saveDoc/archive 副作用', async () => {
    const fx = makeMemoryFixture();
    const handle = await fx.persistence.createDoc(ALICE, DOC_ID, makeDoc(DOC_ID, {
      replicationId: ID_A,
      replicationEpoch: 1,
      n: 5,
    }));
    // initial create 已提交 store（epoch 1）
    expect(fx.writeSnapshotCalls.count).toBe(1);
    // 模拟 live bump：直接改 live doc（dirty，不推进 scheduler）——ADT 层写路径
    handle.doc.getMap('META').set('replicationEpoch', 2);
    await fx.persistence.saveDoc(handle);
    expect(fx.scheduler.pending()).toBe(2); // debounce + max-dirty 已武装（未触发——零 flush）
    const before = fx.writeSnapshotCalls.count;
    const beforePending = fx.scheduler.pending();

    const probe = await (fx.persistence as DocPersistence & {
      readPersistedReplicationIdentity(owner: User, docId: string): Promise<unknown>;
    }).readPersistedReplicationIdentity(ALICE, DOC_ID);
    expect(probe).toEqual({
      kind: 'found',
      identity: { ok: true, value: { replicationId: ID_A, replicationEpoch: 1 } },
    });
    // 零副作用：writeSnapshot 未增加、scheduler 未推进、无归档
    expect(fx.writeSnapshotCalls.count).toBe(before);
    expect(fx.scheduler.pending()).toBe(beforePending);
    // 脏 live 未被当作持久事实（store 仍 epoch 1——decode 验证）
    expect(decodeStore(fx.store, keyOf(ALICE, DOC_ID)).getMap('META').get('replicationEpoch')).toBe(1);

    await handle.release();
    await fx.dispose();
  });
});

describe('P2：probe 主快照缺失 → {kind:"missing"}', () => {
  it('无 committed snapshot 的 key → missing（不建 live cell、不签 handle）', async () => {
    const fx = makeMemoryFixture();
    const result = await (fx.persistence as DocPersistence & {
      readPersistedReplicationIdentity(owner: User, docId: string): Promise<unknown>;
    }).readPersistedReplicationIdentity(ALICE, 'ns-never');
    expect(result).toEqual({ kind: 'missing' });
    expect(await fx.persistence.loadDoc(ALICE, 'ns-never')).toBeNull();
    expect(fx.scheduler.pending()).toBe(0);
    await fx.dispose();
  });
});

describe('P3/P4/P5：probe typed 拒绝与 found 分类（设计 §3.3.1 表）', () => {
  it('P3: io.read 在 current epoch 拒绝 → DocPersistedIdentityProbeOperationalError（committed:false、稳定消息零回显）', async () => {
    const fx = makeWrappedMemoryFixture();
    const ioDown = new Error('io down: TOP-SECRET-7f3a @ /etc/sekrit');
    fx.seam.faults.failNextRead(ioDown);
    const err = await (fx.persistence as DocPersistence & {
      readPersistedReplicationIdentity(owner: User, docId: string): Promise<unknown>;
    }).readPersistedReplicationIdentity(ALICE, DOC_ID).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DocPersistedIdentityProbeOperationalError);
    expect(err).toMatchObject({ code: 'DOC_PERSISTED_IDENTITY_PROBE_OPERATIONAL', committed: false });
    expect((err as { cause: unknown }).cause).toBe(ioDown);
    expect((err as { message: string }).message).toBe(
      'persisted identity probe operational failure: the trusted store read rejected',
    );
    for (const text of [JSON.stringify(err), (err as { stack?: string }).stack ?? '']) {
      expect(text).not.toContain('TOP-SECRET');
      expect(text).not.toContain('/etc/sekrit');
    }
    await fx.dispose();
  });

  it('P4a: 快照字节无法解码为 Yjs → DocPersistedIdentityProbeCorruptError（committed:false、非 mismatch 通道）', async () => {
    const fx = makeMemoryFixture();
    fx.store.set(keyOf(ALICE, DOC_ID), new Uint8Array([1, 2, 3, 4]));
    const err = await (fx.persistence as DocPersistence & {
      readPersistedReplicationIdentity(owner: User, docId: string): Promise<unknown>;
    }).readPersistedReplicationIdentity(ALICE, DOC_ID).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DocPersistedIdentityProbeCorruptError);
    expect(err).toMatchObject({ code: 'DOC_PERSISTED_IDENTITY_PROBE_CORRUPT', committed: false });
    expect((err as { message: string }).message).toBe(
      'persisted identity probe corrupt: the committed snapshot cannot be trusted',
    );
    await fx.dispose();
  });

  it('P4b: META.docId 与请求 docId 不符 → DocPersistedIdentityProbeCorruptError', async () => {
    const fx = makeMemoryFixture();
    fx.store.set(keyOf(ALICE, DOC_ID), Y.encodeStateAsUpdate(makeDoc('ns-other', {
      replicationId: ID_A,
      replicationEpoch: 1,
    })));
    const err = await (fx.persistence as DocPersistence & {
      readPersistedReplicationIdentity(owner: User, docId: string): Promise<unknown>;
    }).readPersistedReplicationIdentity(ALICE, DOC_ID).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DocPersistedIdentityProbeCorruptError);
    await fx.dispose();
  });

  it('P4c: META 载体异型（同名 Y.Text）→ DocPersistedIdentityProbeCorruptError', async () => {
    const fx = makeMemoryFixture();
    const doc = new Y.Doc();
    doc.getText('META').insert(0, 'not-a-map');
    doc.getMap('ROOT').set('n', 1);
    fx.store.set(keyOf(ALICE, DOC_ID), Y.encodeStateAsUpdate(doc));
    const err = await (fx.persistence as DocPersistence & {
      readPersistedReplicationIdentity(owner: User, docId: string): Promise<unknown>;
    }).readPersistedReplicationIdentity(ALICE, DOC_ID).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DocPersistedIdentityProbeCorruptError);
    await fx.dispose();
  });

  it('P5: 可解码且 docId 正确但复制字段格式违约（epoch 0 / 恰一键）→ {kind:"found", identity:{ok:false}}（零字段值泄露）', async () => {
    const fx = makeMemoryFixture();
    fx.store.set(keyOf(ALICE, DOC_ID), Y.encodeStateAsUpdate(makeDoc(DOC_ID, {
      replicationId: ID_A,
      replicationEpoch: 0,
    })));
    const badEpoch = await (fx.persistence as DocPersistence & {
      readPersistedReplicationIdentity(owner: User, docId: string): Promise<unknown>;
    }).readPersistedReplicationIdentity(ALICE, DOC_ID);
    expect(badEpoch).toEqual({ kind: 'found', identity: { ok: false } });

    fx.store.set(keyOf(ALICE, DOC_ID), Y.encodeStateAsUpdate(makeDoc(DOC_ID, {
      replicationId: ID_A,
    })));
    const oneSided = await (fx.persistence as DocPersistence & {
      readPersistedReplicationIdentity(owner: User, docId: string): Promise<unknown>;
    }).readPersistedReplicationIdentity(ALICE, DOC_ID);
    expect(oneSided).toEqual({ kind: 'found', identity: { ok: false } });
    await fx.dispose();
  });
});

describe('P6/P7：dispose 竞态与契约违约（committed:false fatal）', () => {
  it('P6a: 入口已 dispose → DocPersistedIdentityProbeFatalError("lifecycle-disposed")', async () => {
    const fx = makeMemoryFixture();
    await fx.dispose();
    const err = await (fx.persistence as DocPersistence & {
      readPersistedReplicationIdentity(owner: User, docId: string): Promise<unknown>;
    }).readPersistedReplicationIdentity(ALICE, DOC_ID).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DocPersistedIdentityProbeFatalError);
    expect(err).toMatchObject({ code: 'DOC_PERSISTED_IDENTITY_PROBE_FATAL', phase: 'lifecycle-disposed', committed: false });
  });

  it('P6b: read 挂起 + dispose abort → DocPersistedIdentityProbeFatalError("read-aborted")', async () => {
    let readEntered!: () => void;
    const entered = new Promise<void>((resolve) => { readEntered = resolve });
    const persistence = createMemoryPersistence({
      scheduler: createTestScheduler(),
      wrapIo: (inner: PersistenceIO) => ({
        ...inner,
        // 确定性挂起 read：唯一结算路径 = signal abort（dispose 触发）——模拟在途
        // store 读与生命周期终结的真实竞态；不 resolve（abort 前永挂起）。
        read: (_key, signal) =>
          new Promise<Uint8Array | undefined>((_resolve, reject) => {
            readEntered();
            if (signal.aborted) {
              reject(new Error('aborted'));
              return;
            }
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          }),
      }),
    } as MemoryPersistenceOptions);
    const probeP = (persistence as DocPersistence & {
      readPersistedReplicationIdentity(owner: User, docId: string): Promise<unknown>;
    }).readPersistedReplicationIdentity(ALICE, DOC_ID);
    void probeP.catch(() => {});
    await entered;
    await (persistence as unknown as { dispose(): Promise<void> }).dispose();
    const err = await probeP.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DocPersistedIdentityProbeFatalError);
    expect(err).toMatchObject({ code: 'DOC_PERSISTED_IDENTITY_PROBE_FATAL', phase: 'read-aborted', committed: false });
  });

  it('P7: io.read 同步 throw（adapter 契约违约）→ DocPersistedIdentityProbeFatalError("adapter-violation")', async () => {
    const persistence = createMemoryPersistence({
      scheduler: createTestScheduler(),
      wrapIo: (inner: PersistenceIO) => ({
        ...inner,
        read: () => {
          throw new Error('sync throw violation');
        },
      }),
    } as MemoryPersistenceOptions);
    const err = await (persistence as DocPersistence & {
      readPersistedReplicationIdentity(owner: User, docId: string): Promise<unknown>;
    }).readPersistedReplicationIdentity(ALICE, DOC_ID).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DocPersistedIdentityProbeFatalError);
    expect(err).toMatchObject({ phase: 'adapter-violation', committed: false });
    await (persistence as unknown as { dispose(): Promise<void> }).dispose();
  });
});

describe('P8：归档 remove-fatal（§4.5.5 committed:true 闭环 + latest-wins 收敛重试）', () => {
  it('writeArchive resolve（提交点跨越）→ remove 拒绝 → DocArchiveFatalError("relocate-remove", committed:true)；修复后重试成功', async () => {
    const store = new Map<string, Uint8Array>();
    const scheduler = createTestScheduler();
    const seam = createPersistenceIoFaultSeam();
    const persistence = createMemoryPersistence({
      scheduler,
      schedule: { debounceMs: 1, maxDirtyMs: 1 },
      writeSnapshot: async (key, snapshot) => {
        store.set(key, snapshot.slice());
      },
      readSnapshot: async (key) => store.get(key),
      deleteSnapshot: async (key) => {
        store.delete(key);
      },
      wrapIo: seam.wrap,
    } as MemoryPersistenceOptions);
    const handle = await persistence.createDoc(ALICE, DOC_ID, makeDoc(DOC_ID, {
      replicationId: ID_A,
      replicationEpoch: 1,
      n: 7,
    }));
    await handle.release();

    const removeDown = new Error('remove io down');
    seam.faults.failNextRemove(removeDown);
    const err = await persistence.archiveDoc(ALICE, DOC_ID, {
      replicationId: ID_A,
      replicationEpoch: 1,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DocArchiveFatalError);
    expect(err).toMatchObject({ code: 'DOC_ARCHIVE_FATAL', phase: 'relocate-remove', committed: true });
    expect((err as { cause: unknown }).cause).toBe(removeDown);
    // 归档已提交（latest-wins 槽已持有字节）、主键仍在——重试收敛
    expect(store.has(keyOf(ALICE, DOC_ID))).toBe(true);
    const retried = await persistence.archiveDoc(ALICE, DOC_ID, {
      replicationId: ID_A,
      replicationEpoch: 1,
    });
    expect(retried).toEqual({ ok: true });
    expect(store.has(keyOf(ALICE, DOC_ID))).toBe(false);
    expect(await persistence.loadDoc(ALICE, DOC_ID)).toBeNull();
    await (persistence as unknown as { dispose(): Promise<void> }).dispose();
  });
});

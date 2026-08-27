/**
 * SA7 动态验证补充用例 — issue #132（Phase 5 复制身份与 epoch）。
 *
 * 对应 SA4 静态验尸报告 §四「动态审核重点」三条（2/3/5），全部走真实运行链路：
 *
 * - **重点 2（真实调度交错）**：`enable 已接纳后 registry.shutdown()` 的排空观测在
 *   **真实计时器**下复核（registry idle/close 调度器 + FilePersistence debounce 全部
 *   直通宿主全局 setTimeout——零 fake scheduler、零虚拟时间）。磁盘 committed 事实经
 *   issue #108 正式 `waitDurableSnapshot` 有界轮询（直接文件读，不干扰 flush 写路径），
 *   重启后经真实 FilePersistence loadDoc 解码断言身份恢复。
 * - **重点 3（磁盘级 undefined round-trip）**：`Y.Map.set(k, undefined)` 形态（has()=true
 *   且 get()=undefined）经 FilePersistence 磁盘快照字节格式（Y.encodeStateAsUpdate 全量
 *   快照）round-trip 后**仍存活**的实证 + 该形态 open 响亮拒绝（V2.5 构造期
 *   ReplicationMetaCorruptError → NamespaceRegistryFatalError('open',
 *   'runtime-construction')）；反向守卫：两键真缺席的同款磁盘种子 open 成功且
 *   status=disabled（防过纠）。
 * - **重点 5（载体异型，SA4 L4 可选用例）**：META 同名为 Y.Text 载体的 **live doc 同
 *   实例**种子（in-memory persistence 返回同一 Y.Doc 引用）→ open 响亮拒绝（getMap
 *   异型 throw 被读取器收编为 corrupt）。SA7 实证补充：yjs 13.6.x 下该形态经
 *   encodeStateAsUpdate→applyUpdate 磁盘 round-trip 后载体被**去特化**为 AbstractType
 *   （getMap 不抛、Map 门面为空 → 两键真缺席 → disabled）——「载体异型 corrupt」
 *   分支仅在 live 同实例上可达；磁盘级实证记录见 SA7 报告（生产管线不可能产生异型
 *   载体快照，双路径均属防御性验证）。
 *
 * 全部用例驱动真实 Registry/Runtime/Yjs/FilePersistence（真实 fs mkdtemp 目录）；
 * 零源码 grep 断言、零 mock 本地服务；随机源为受控计数源（仅 namespaceId 生成面）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { FilePersistence, type DocPersistence, type User } from '@nomicore/persistence';
import type { PersistenceScheduler } from '@nomicore/persistence';
import { createTestScheduler } from '@nomicore/persistence/testing';
import { NamespaceRegistryFatalError, type RegistryTimeoutScheduler } from '@nomicore/namespace-registry';
import type { NamespaceLease, NamespaceRegistry, RegistryRandomBytes } from '@nomicore/namespace-registry';
import {
  createNamespaceRegistryForTesting,
  createRegistryTestScheduler,
} from '@nomicore/namespace-registry/testing';
// issue #108 正式耐久等待模式（只读引用，未修改）+ issue #107 真实计时器注入器（只读引用）。
import { waitDurableSnapshot } from '../../namespace-runtime/test/durable-snapshot-wait.js';
import { realPersistenceScheduler } from '../../namespace-runtime/test/real-persistence-scheduler.js';

// ═══════════════════════════════ 基础设施 ═══════════════════════════════

const SCHEMA_ENVELOPE = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'phase5-replication-sa7-dynamic',
  text: 'type ROOT = { n: number; };\n',
});
const GOOD_ROOT = Object.freeze({ n: 42 });
const FIXED_MS = 1_700_000_123_456;
const ALICE: User = Object.freeze({ userId: 'u-alice' });
const REP_ID_PATTERN = /^[0-9a-f]{32}$/;

/** 真实计时器 registry 调度器：直通宿主全局 timer（零虚拟时间、零 advanceBy）。 */
const realRegistryScheduler: RegistryTimeoutScheduler = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

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

function makeRegistry(persistence: DocPersistence, opts: { realTimers?: boolean } = {}): NamespaceRegistry {
  return createNamespaceRegistryForTesting(persistence, {
    clock: { now: () => FIXED_MS },
    scheduler: opts.realTimers === true ? realRegistryScheduler : createRegistryTestScheduler(),
    idleTimeoutMs: 300_000, // 真实计时器下不让 idle 提前关写面（排空观测只由 shutdown 驱动）
    randomBytes: makeCounterRandomBytes(),
  } as never);
}

function okLease(result: unknown): NamespaceLease {
  const r = result as { ok?: boolean; lease?: NamespaceLease };
  expect(r.ok, `期望成功，实际：${JSON.stringify(result)}`).toBe(true);
  if (!r.ok || r.lease === undefined) throw new Error('unreachable');
  return r.lease;
}

/** 微任务预算内等待 Runtime P0 就绪（真实构造链的确定性栅栏——零 real sleep）。 */
async function schemaReady(lease: NamespaceLease): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    const runtime = (lease.getStatus() as unknown as { runtime?: unknown }).runtime as {
      schema: { state: string };
    };
    if (runtime.schema.state === 'ready') return;
    await Promise.resolve();
  }
  throw new Error(`schema 未在微观任务预算内就绪：${JSON.stringify(lease.getStatus())}`);
}

function repMeta(lease: NamespaceLease): { readonly replicationId?: unknown; readonly replicationEpoch?: unknown } {
  return lease.getMetadata() as unknown as { replicationId?: unknown; replicationEpoch?: unknown };
}

function repStatus(lease: NamespaceLease): { readonly state: string; readonly replicationId?: string; readonly replicationEpoch?: number } {
  const runtime = lease.getStatus().runtime as unknown as {
    replication?: { state: string; replicationId?: string; replicationEpoch?: number };
  };
  return runtime.replication as { state: string; replicationId?: string; replicationEpoch?: number };
}

/**
 * 手工磁盘种子：构造 Y.Doc 后以 FilePersistence committed 快照同款字节布局
 * （rootDir/users/{userId}/{docId}.snapshot = Y.encodeStateAsUpdate 全量快照）直接落盘。
 */
async function seedSnapshotFile(rootDir: string, docId: string, doc: Y.Doc): Promise<string> {
  const dir = path.join(rootDir, 'users', ALICE.userId);
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${docId}.snapshot`);
  await fsp.writeFile(file, Buffer.from(Y.encodeStateAsUpdate(doc)));
  return file;
}

/** 从磁盘 committed 快照字节直读复制身份（不触碰任何 lease 读面）。 */
async function readDiskReplicationId(rootDir: string, docId: string): Promise<string> {
  const raw = await fsp.readFile(path.join(rootDir, 'users', ALICE.userId, `${docId}.snapshot`));
  const doc = new Y.Doc();
  Y.applyUpdate(doc, raw);
  const id = doc.getMap('META').get('replicationId');
  doc.destroy();
  return id as string;
}

/** 标准种子文档（SCHEMA/META/ROOT 三载体 + META docId/createdAt）。 */
function makeSeedDoc(docId: string): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(SCHEMA_ENVELOPE)) sc.set(k, v);
  const meta = doc.getMap('META');
  meta.set('docId', docId);
  meta.set('createdAt', FIXED_MS);
  doc.getMap('ROOT').set('n', 42);
  return doc;
}

/** 捕获 open rejection（非断言吞没——原样返回 settled 形状）。 */
async function settleOpen(
  registry: NamespaceRegistry,
  namespaceId: string,
): Promise<{ kind: 'resolved'; value: unknown } | { kind: 'rejected'; reason: unknown }> {
  try {
    return { kind: 'resolved', value: await registry.open(ALICE, namespaceId) };
  } catch (reason) {
    return { kind: 'rejected', reason };
  }
}

/** 构造只读 FilePersistence（open 拒绝面无需真实 debounce——确定性 fake scheduler）。 */
function makeReaderPersistence(rootDir: string): FilePersistence {
  const scheduler: PersistenceScheduler = createTestScheduler();
  return new FilePersistence({ rootDir, scheduler, schedule: { debounceMs: 1, maxDirtyMs: 1 } });
}

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
});

// ═════════════════ 重点 2：真实计时器下 enable-已接纳-后-shutdown 排空 ═════════════════

describe('SA4 动态重点 2：真实计时器（零 fake scheduler）下 enable 已接纳后 shutdown 的排空与恢复', () => {
  it(
    'registry/FilePersistence 调度全直通真实 timer：enable→shutdown 竞态排空，身份经真实磁盘 committed 事实恢复',
    { timeout: 20_000 },
    async () => {
      const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nomicore-sa7-rep-real-'));
      roots.push(rootDir);

      // 写侧：真实计时器 FilePersistence（issue #107 迁移裁决后的显式注入直通全局 timer）。
      const writer = new FilePersistence({
        rootDir,
        scheduler: realPersistenceScheduler,
        schedule: { debounceMs: 5, maxDirtyMs: 60 },
      });
      const registry1 = makeRegistry(writer, { realTimers: true });
      const lease = okLease(await registry1.create({ owner: ALICE, schema: SCHEMA_ENVELOPE, root: GOOD_ROOT }));
      await schemaReady(lease);
      const nsId = lease.namespaceId;

      // enable 同步接纳（sequencer 入队）后立即 shutdown——close barrier 排在 enable 槽之后；
      // 全链零虚拟时间：排空、handle release、dirty 登记的 debounce 武装均为真实事件循环次序。
      const enableP = lease.enableReplication();
      const shutdownP = registry1.shutdown();
      await expect(enableP).resolves.toMatchObject({ ok: true }); // 已接纳任务无条件排空
      await expect(shutdownP).resolves.toBeUndefined();

      // 真实 debounce(5ms)/maxDirty(60ms) 之后 flush 的 writeFile→rename 为真实异步 fs；
      // 有界轮询磁盘 committed 快照（直接文件读，不干扰写路径；超时响亮失败）。
      // （shutdown 后 lease 已 closed——RUNTIME_READ_DISABLED 停接纳，身份事实一律取自
      // 磁盘 committed 字节本身，不触碰 closed 读面。）
      await waitDurableSnapshot(ALICE, nsId, rootDir, (doc) => doc.getMap('META').get('replicationEpoch'), 1);
      const id0 = await readDiskReplicationId(rootDir, nsId);
      expect(id0).toMatch(REP_ID_PATTERN);
      await waitDurableSnapshot(ALICE, nsId, rootDir, (doc) => doc.getMap('META').get('replicationId'), id0);
      await (writer as unknown as { dispose(): Promise<void> }).dispose();

      // 重启（全新 FilePersistence + 全新 Registry，真实 loadDoc 磁盘解码）。
      const reader = makeReaderPersistence(rootDir);
      const registry2 = makeRegistry(reader);
      const reopened = okLease(await registry2.open(ALICE, nsId));
      expect(repMeta(reopened).replicationId).toBe(id0);
      expect(repMeta(reopened).replicationEpoch).toBe(1);
      expect(repStatus(reopened)).toEqual({ state: 'enabled', replicationId: id0, replicationEpoch: 1 });
      await registry2.shutdown();
      await (reader as unknown as { dispose(): Promise<void> }).dispose();
    },
  );
});

// ═════════════════ 重点 3：undefined 值磁盘级 round-trip ═════════════════

describe('SA4 动态重点 3：set(k, undefined) 经 FilePersistence 磁盘快照 round-trip 存活 + open 响亮拒绝', () => {
  it('磁盘字节事实：epoch 键 set(undefined) round-trip 后 has()=true 且 get()=undefined（损坏形态可持续）', async () => {
    const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nomicore-sa7-rep-undef-'));
    roots.push(rootDir);
    const docId = 'ns-sa7-undefined-epoch';
    const seed = makeSeedDoc(docId);
    const meta = seed.getMap('META');
    meta.set('replicationId', 'f'.repeat(32));
    meta.set('replicationEpoch', undefined as never); // 键存在而值显式 undefined

    const file = await seedSnapshotFile(rootDir, docId, seed);

    // 磁盘 round-trip 事实（FilePersistence committed 快照同款字节 → 全新 Y.Doc 解码）：
    // undefined 值不丢键——「键存在而值 undefined」是可从磁盘复原的持续损坏形态。
    const raw = await fsp.readFile(file);
    const decoded = new Y.Doc();
    Y.applyUpdate(decoded, raw);
    const decodedMeta = decoded.getMap('META');
    expect(decodedMeta.has('replicationId')).toBe(true);
    expect(decodedMeta.get('replicationId')).toBe('f'.repeat(32));
    expect(decodedMeta.has('replicationEpoch')).toBe(true);
    expect(decodedMeta.get('replicationEpoch')).toBeUndefined();

    // 该磁盘形态 open：V2.5 读取器判 corrupt → 构造 throw 收编为 runtime-construction fatal。
    const reader = makeReaderPersistence(rootDir);
    const registry = makeRegistry(reader);
    const settled = await settleOpen(registry, docId);
    expect(settled.kind).toBe('rejected');
    if (settled.kind !== 'rejected') return;
    expect(settled.reason).toBeInstanceOf(NamespaceRegistryFatalError);
    const fatal = settled.reason as NamespaceRegistryFatalError;
    expect(fatal.operation).toBe('open');
    expect(fatal.phase).toBe('runtime-construction');
    expect(fatal.committed).toBe(false);
    // cause 保留 exact 原始异常（ReplicationMetaCorruptError 稳定码；类不公共导出，按码断言）。
    expect((fatal.cause as Error).message).toContain('NSRT-REPLICATION-META-CORRUPT');
    await registry.shutdown();
    await (reader as unknown as { dispose(): Promise<void> }).dispose();
  });

  it('反向守卫：两键真缺席的同款磁盘种子 open 成功且 status=disabled（防过纠）', async () => {
    const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nomicore-sa7-rep-absent-'));
    roots.push(rootDir);
    const docId = 'ns-sa7-absent-keys';
    await seedSnapshotFile(rootDir, docId, makeSeedDoc(docId));

    const reader = makeReaderPersistence(rootDir);
    const registry = makeRegistry(reader);
    const lease = okLease(await registry.open(ALICE, docId));
    await schemaReady(lease);
    expect(repStatus(lease)).toEqual({ state: 'disabled' });
    expect(repMeta(lease).replicationId).toBeUndefined();
    expect(repMeta(lease).replicationEpoch).toBeUndefined();
    await registry.shutdown();
    await (reader as unknown as { dispose(): Promise<void> }).dispose();
  });
});

// ═════════════════ 重点 5（SA4 L4 可选）：载体异型（META 同名 Y.Text，live 同实例） ═════════════════

/** in-memory persistence：loadDoc 返回种子 live Y.Doc 同一实例（corrupt 分支可达前提）。 */
class LiveDocPersistence {
  private readonly docs = new Map<string, Y.Doc>();
  constructor(private readonly docId: string, doc: Y.Doc) {
    this.docs.set(docId, doc);
  }
  async loadDoc(_owner: User, docId: string): Promise<{
    owner: User; docId: string; doc: Y.Doc;
    getStatus: () => 'ready'; release: () => Promise<void>;
  } | null> {
    const doc = this.docs.get(docId);
    if (doc === undefined) return null;
    return {
      owner: _owner,
      docId,
      doc,
      getStatus: () => 'ready' as const,
      release: async () => {},
    };
  }
}

describe('SA4 动态重点 5：META 载体异型（同名 Y.Text，live doc 同实例）→ open 响亮拒绝', () => {
  it('getText("META") 的 live 种子文档 → open 以 runtime-construction + NSRT-REPLICATION-META-CORRUPT 拒绝', async () => {
    const docId = 'ns-sa7-text-carrier';
    const seed = new Y.Doc();
    const sc = seed.getMap('SCHEMA');
    for (const [k, v] of Object.entries(SCHEMA_ENVELOPE)) sc.set(k, v);
    seed.getText('META').insert(0, 'hostile-text-carrier'); // META 同名异型载体（生产不可达形态）
    seed.getMap('ROOT').set('n', 42);

    // live 同实例前提自证：本 doc 上 getMap('META') 确实 throw（yjs 同文档异型语义）。
    expect(() => seed.getMap('META')).toThrow();

    const events: Array<{ type: string }> = [];
    const registryWithObserver = createNamespaceRegistryForTesting(
      new LiveDocPersistence(docId, seed) as never,
      {
        clock: { now: () => FIXED_MS },
        scheduler: createRegistryTestScheduler(),
        randomBytes: makeCounterRandomBytes(),
        observer: (e: unknown) => {
          events.push(e as { type: string });
        },
      } as never,
    );

    const settled = await settleOpen(registryWithObserver, docId);
    expect(settled.kind).toBe('rejected');
    if (settled.kind !== 'rejected') return;
    expect(settled.reason).toBeInstanceOf(NamespaceRegistryFatalError);
    const fatal = settled.reason as NamespaceRegistryFatalError;
    expect(fatal.operation).toBe('open');
    expect(fatal.phase).toBe('runtime-construction');
    expect(fatal.committed).toBe(false);
    expect((fatal.cause as Error).message).toContain('NSRT-REPLICATION-META-CORRUPT');
    expect(events.map((e) => e.type)).toContain('open-runtime-construction-failed');
    await registryWithObserver.shutdown();
  });
});

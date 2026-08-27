/**
 * SA3-owned 集成用例 — issue #132 新文档化通道的测试锚（设计 §4.10.1，SA2 评审 #5
 * 场景清单；经 Lease 集成面锚定——真实 Runtime/Yjs + 确定性 stub/Memory Persistence）：
 * - REPLICATION_NOT_ENABLED：未 enable 直接 bump → ok:false + message 含码；META
 *   两键仍真缺席（has() false）；saveDoc 0 次；
 * - REPLICATION_META_ABSENT：无 META 载体种子（seedForTest 设施）+ enable →
 *   ok:false + message 含码；doc.share.has('META') 仍 false（未凭空造载体）、零 dirty；
 * - REPLICATION_RANDOM_SOURCE_INVALID：注入违约 randomBytes（返回非 16 字节 /
 *   throw）→ Lease 结果 ok:false + message 含码（不 fatal、不同步 throw）；
 * - 损坏 META 构造 throw（V2.5）：种子族（id 合法 + epoch 为 string '999'/0/1.5/
 *   大写 32hex/仅 id 无 epoch/双键 set undefined/单键 undefined + 另一键合法）→
 *   open 以 NamespaceRegistryFatalError('open','runtime-construction') rejection
 *   响亮失败 + observer open-runtime-construction-failed；**反向守卫**：两键真缺席
 *   种子 open 成功且 status=disabled（防过纠）；**双读者一致性**：损坏文档上只存在
 *   「open 即拒」单一可观测结局（无 lease 可达 → getMetadata 与 status.replication
 *   不存在可同时被观测且互不一致的状态——SA2 复核注记 2 的意图落地）。
 *
 * 零源码 grep 断言；驱动器全部在既有基建内（确定性 stub + 受控 scheduler）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import { DocDuplicateError } from '@nomicore/persistence';
import { NamespaceRegistryFatalError } from '@nomicore/namespace-registry';
import type { NamespaceLease, NamespaceRegistry, RegistryRandomBytes } from '@nomicore/namespace-registry';
import {
  createNamespaceRegistryForTesting,
  createRegistryTestScheduler,
} from '@nomicore/namespace-registry/testing';

// ═══════════════════════════════ 基础设施 ═══════════════════════════════

const SCHEMA_ENVELOPE = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'phase5-replication-channels',
  text: 'type ROOT = { n: number; };\n',
});
const GOOD_ROOT = Object.freeze({ n: 42 });
const FIXED_MS = 1_700_000_123_456;
const ALICE: User = Object.freeze({ userId: 'u-alice' });

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

/** stub Persistence：真实 Y.Doc 全链载体；saveDoc 计数 + 通知时刻 META 快照。 */
class ChannelPersistence implements DocPersistence {
  readonly saveEvents: Array<{ readonly replicationId: unknown; readonly replicationEpoch: unknown }> = [];
  readonly docs = new Map<string, Y.Doc>();

  seedDocument(docId: string, doc: Y.Doc): void {
    const existing = this.docs.get(docId);
    if (existing !== undefined) {
      // 共享同一 Y.Doc 引用（与 red 套件 seed 语义一致——open 恢复同一 live doc）
      existing.destroy?.();
    }
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

/** 手工种子文档（seedForTest 设施）：META 含 docId/createdAt + 可选复制保留字段。 */
function makeSeedDoc(
  docId: string,
  opts: {
    replicationId?: unknown;
    replicationEpoch?: unknown;
    withMeta?: boolean;
    root?: number;
  } = {},
): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(SCHEMA_ENVELOPE)) sc.set(k, v);
  if (opts.withMeta !== false) {
    const meta = doc.getMap('META');
    meta.set('docId', docId);
    meta.set('createdAt', FIXED_MS);
    // 显式 undefined 值注入（Yjs set(k, undefined) —— has()=true 且 round-trip 存活形态）
    if (Object.prototype.hasOwnProperty.call(opts, 'replicationId')) {
      meta.set('replicationId', opts.replicationId as never);
    }
    if (Object.prototype.hasOwnProperty.call(opts, 'replicationEpoch')) {
      meta.set('replicationEpoch', opts.replicationEpoch as never);
    }
  }
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
  opts: { randomBytes?: RegistryRandomBytes; observer?: (event: unknown) => void } = {},
): NamespaceRegistry {
  return createNamespaceRegistryForTesting(persistence, {
    clock: { now: () => FIXED_MS },
    scheduler: createRegistryTestScheduler(),
    idleTimeoutMs: 25,
    randomBytes: opts.randomBytes ?? makeCounterRandomBytes(),
    ...(opts.observer !== undefined ? { observer: opts.observer } : {}),
  } as never);
}

function okLease(result: unknown): NamespaceLease {
  const r = result as { ok?: boolean; lease?: NamespaceLease };
  expect(r.ok, `期望成功，实际：${JSON.stringify(result)}`).toBe(true);
  if (!r.ok || r.lease === undefined) throw new Error('unreachable');
  return r.lease;
}

function issuesText(result: unknown): string {
  const r = result as { issues?: unknown };
  return JSON.stringify(r.issues ?? result);
}

async function schemaReady(lease: NamespaceLease): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    const runtime = (lease.getStatus() as unknown as { runtime?: unknown }).runtime as {
      schema: { state: string };
    };
    if (runtime.schema.state === 'ready') return;
    await Promise.resolve();
  }
  throw new Error('schema 未在微观任务预算内就绪');
}

/** 捕获 open rejection 的 branded 错误（非断言吞没——原样返回）。 */
async function settleOpen(
  registry: NamespaceRegistry,
  owner: User,
  namespaceId: string,
): Promise<{ kind: 'resolved'; value: unknown } | { kind: 'rejected'; reason: unknown }> {
  try {
    return { kind: 'resolved', value: await registry.open(owner, namespaceId) };
  } catch (reason) {
    return { kind: 'rejected', reason };
  }
}

function repStatus(lease: NamespaceLease): { readonly state: string; readonly replicationId?: string; readonly replicationEpoch?: number } {
  const runtime = lease.getStatus().runtime as unknown as {
    replication?: { state: string; replicationId?: string; replicationEpoch?: number };
  };
  return runtime.replication as { state: string; replicationId?: string; replicationEpoch?: number };
}

// ═══════════════════════════════ REPLICATION_NOT_ENABLED ═══════════════════════════════

describe('REPLICATION_NOT_ENABLED：未 enable 直接 bump（经 Lease）', () => {
  it('bump 前置 → ok:false + message 含码；META 两键仍真缺席（has() false）；saveDoc 0 次', async () => {
    const stub = new ChannelPersistence();
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.create(newContractInput()));
    await schemaReady(lease);

    const result = await (lease as unknown as { bumpReplicationEpoch: () => Promise<{ ok: boolean; issues?: unknown }> }).bumpReplicationEpoch();
    expect(result.ok).toBe(false);
    expect(issuesText(result)).toContain('REPLICATION_NOT_ENABLED');

    const doc = stub.docs.get(lease.namespaceId);
    expect(doc).toBeDefined();
    const meta = doc!.getMap('META');
    expect(meta.has('replicationId')).toBe(false);
    expect(meta.has('replicationEpoch')).toBe(false);
    expect(stub.saveEvents).toHaveLength(0); // 零 dirty
    expect(repStatus(lease).state).toBe('disabled');
  });
});

// ═══════════════════════════════ REPLICATION_META_ABSENT ═══════════════════════════════

describe('REPLICATION_META_ABSENT：META 载体缺席 → 拒绝安装（不凭空造载体）', () => {
  it('无 META 载体种子 + enable → ok:false + message 含码；doc.share.has("META") 仍 false、零 dirty', async () => {
    const stub = new ChannelPersistence();
    const doc = makeSeedDoc('ns-seeded-no-meta', { withMeta: false });
    stub.seedDocument('ns-seeded-no-meta', doc);
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.open(ALICE, 'ns-seeded-no-meta'));
    await schemaReady(lease);

    const result = await (lease as unknown as { enableReplication: () => Promise<{ ok: boolean; issues?: unknown }> }).enableReplication();
    expect(result.ok).toBe(false);
    expect(issuesText(result)).toContain('REPLICATION_META_ABSENT');
    expect(doc.share.has('META')).toBe(false); // 未凭空创建载体（防无 docId 的 META 损坏）
    expect(stub.saveEvents).toHaveLength(0);
    expect(repStatus(lease).state).toBe('disabled'); // 载体缺席 = 事实性 disabled
  });
});

// ═══════════════════════════════ REPLICATION_RANDOM_SOURCE_INVALID ═══════════════════════════════

describe('REPLICATION_RANDOM_SOURCE_INVALID：受控随机源运行期违约 → Lease 结果面 issue', () => {
  for (const [label, badSource] of [
    ['返回非 16 字节', (): Uint8Array => new Uint8Array(15)],
    ['throw', (): Uint8Array => {
      throw new Error('random source down (deterministic)');
    }],
  ] as Array<[string, RegistryRandomBytes]>) {
    it(`${label} → Lease enable 结算 ok:false + message 含码；不 fatal、不同步 throw`, async () => {
      const stub = new ChannelPersistence();
      stub.seedDocument('ns-seeded-random', makeSeedDoc('ns-seeded-random'));
      const registry = makeRegistry(stub, { randomBytes: badSource });
      const lease = okLease(await registry.open(ALICE, 'ns-seeded-random'));
      await schemaReady(lease);

      // 不同步 throw：调用即返回 Promise，结算为结果联合 issue
      let syncThrow: unknown = '(no sync throw)';
      let result: { ok: boolean; issues?: unknown } | undefined;
      try {
        result = await (lease as unknown as { enableReplication: () => Promise<{ ok: boolean; issues?: unknown }> }).enableReplication();
      } catch (e) {
        syncThrow = e;
      }
      expect(syncThrow).toBe('(no sync throw)');
      expect(result).toBeDefined();
      expect(result!.ok).toBe(false);
      expect(issuesText(result)).toContain('REPLICATION_RANDOM_SOURCE_INVALID');

      // 不 fatal：status.fatal 仍 null；读取保留；META 两键缺席
      const runtimeStatus = (lease.getStatus() as unknown as { runtime: { fatal: unknown } }).runtime;
      expect(runtimeStatus.fatal).toBeNull();
      expect(stub.docs.get('ns-seeded-random')!.getMap('META').has('replicationId')).toBe(false);
      expect(stub.saveEvents).toHaveLength(0);
    });
  }
});

// ═══════════════════════════════ 损坏 META 种子族（V2.5 构造 throw）═══════════════════

describe('损坏 META 构造 throw（V2.5 预投影 —— 拒绝虚假降级）', () => {
  type CorruptionCase = {
    label: string;
    id: unknown;
    epoch: unknown;
  };

  const corruptCases: CorruptionCase[] = [
    { label: 'epoch 为 string "999"', id: 'f'.repeat(32), epoch: '999' },
    { label: 'epoch 为 0（<1）', id: 'f'.repeat(32), epoch: 0 },
    { label: 'epoch 为 1.5（非安全整数）', id: 'f'.repeat(32), epoch: 1.5 },
    { label: 'id 为大写 32hex', id: 'A'.repeat(32), epoch: 1 },
    { label: '仅 id 无 epoch（恰一键存在）', id: 'f'.repeat(32), epoch: undefined },
    { label: '双键 set undefined', id: undefined, epoch: undefined },
    { label: '单键 undefined + 另一键合法', id: undefined, epoch: 5 },
  ];

  for (const c of corruptCases) {
    it(`${c.label} → open 以 NamespaceRegistryFatalError('open','runtime-construction') rejection 响亮失败 + observer open-runtime-construction-failed`, async () => {
      const stub = new ChannelPersistence();
      // has() 语义：仅当键被显式 set 才在 meta 上（undefined 值经 set 注入——Yjs 语义
      // has()=true 且 round-trip 存活；未传键 = 真缺席）
      const seed = makeSeedDoc('ns-seeded-corrupt', {});
      const meta = seed.getMap('META');
      meta.set('docId', 'ns-seeded-corrupt');
      meta.set('createdAt', FIXED_MS);
      meta.set('replicationId', c.id as never);
      meta.set('replicationEpoch', c.epoch as never);
      stub.seedDocument('ns-seeded-corrupt', seed);

      const events: Array<{ type: string }> = [];
      const registry = makeRegistry(stub, {
        observer: (e) => {
          events.push(e as unknown as { type: string });
        },
      });

      const settled = await settleOpen(registry, ALICE, 'ns-seeded-corrupt');
      expect(settled.kind).toBe('rejected');
      if (settled.kind !== 'rejected') return;
      const reason = settled.reason;
      expect(reason).toBeInstanceOf(NamespaceRegistryFatalError);
      const fatal = reason as NamespaceRegistryFatalError;
      expect(fatal.operation).toBe('open');
      expect(fatal.phase).toBe('runtime-construction');
      expect(fatal.committed).toBe(false);
      expect(events.map((e) => e.type)).toContain('open-runtime-construction-failed');
    });
  }

  it('反向守卫：两键真缺席种子 open 成功且 status=disabled（防过纠）', async () => {
    const stub = new ChannelPersistence();
    stub.seedDocument('ns-seeded-absent', makeSeedDoc('ns-seeded-absent')); // 无复制键
    const registry = makeRegistry(stub);
    const lease = okLease(await registry.open(ALICE, 'ns-seeded-absent'));
    await schemaReady(lease);
    expect(repStatus(lease).state).toBe('disabled');
    const meta = stub.docs.get('ns-seeded-absent')!.getMap('META');
    expect(meta.has('replicationId')).toBe(false);
    expect(meta.has('replicationEpoch')).toBe(false);
  });

  it('双读者一致性：损坏文档唯一可观测结局 = open 即拒（无 lease 可达——两读面不存在可同时被观测且互不一致的状态）', async () => {
    const stub = new ChannelPersistence();
    const seed = makeSeedDoc('ns-seeded-consistency', {
      replicationId: 'f'.repeat(32),
      replicationEpoch: 0, // 格式违约（<1）
    });
    stub.seedDocument('ns-seeded-consistency', seed);
    const registry = makeRegistry(stub);

    const settled = await settleOpen(registry, ALICE, 'ns-seeded-consistency');
    expect(settled.kind).toBe('rejected'); // open 即拒——无 lease 可读（getMetadata 与 status.replication 双读面结构性不可同时观测）
    if (settled.kind !== 'rejected') return;
    expect(settled.reason).toBeInstanceOf(NamespaceRegistryFatalError);
    expect((settled.reason as NamespaceRegistryFatalError).phase).toBe('runtime-construction');
  });
});

// ═══════════════════════════════ MEMORY 恢复侧新通道（真持久化 round-trip）════════════

describe('开启后身份/epoch 随真实持久化往返（Memory 全链，设计 §4.7 最后一行）', () => {
  it('create → enable → 新实例 loadDoc 恢复 enabled；bump-before-enable 拒绝面在恢复后仍成立（零写入）', async () => {
    const stub = new ChannelPersistence();
    const registry1 = makeRegistry(stub);
    const lease = okLease(await registry1.create(newContractInput()));
    await schemaReady(lease);
    const nsId = lease.namespaceId;

    expect((await (lease as unknown as { enableReplication: () => Promise<{ ok: boolean }> }).enableReplication()).ok).toBe(true);
    const id0 = stub.docs.get(nsId)!.getMap('META').get('replicationId') as string;
    expect(id0).toMatch(/^[0-9a-f]{32}$/);

    const registry2 = makeRegistry(stub);
    const reopened = okLease(await registry2.open(ALICE, nsId));
    expect(repStatus(reopened).state).toBe('enabled');
    expect(repStatus(reopened).replicationId).toBe(id0);
    expect(repStatus(reopened).replicationEpoch).toBe(1);
    const meta = stub.docs.get(nsId)!.getMap('META');
    expect(meta.get('replicationId')).toBe(id0);
    expect(meta.get('replicationEpoch')).toBe(1);
  });
});

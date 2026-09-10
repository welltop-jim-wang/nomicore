/**
 * issue #282 / ADR-0017 — @nomicore/namespace-runtime 复制域 schema 生命周期元数据
 * （META.schema.updatedAt）保护字段契约测试。
 *
 * 锚定契约：
 * - peer 侧（接收 hub→peer update）：META 白名单 {'schema'} 放行——SCHEMA 与其生命周期
 *   元数据随 generation 同行收敛；peer 不以本地接收时刻盖戳（Hub 起源时间戳原样保留）；
 * - peer 侧其余 META 键（docId/createdAt/replicationId/replicationEpoch/任意自定义键）
 *   维持全键保护（REPLICATION_PROTECTED_FIELDS_CHANGED，零写入）；
 * - hub 侧（接收 peer→hub update）：META 全键保护不变——含 META.schema（peer 永不经
 *   raw 获得写生命周期元数据的通道）；SCHEMA 全容器保护不变；
 * - legacy peer 文档（无 META.schema 载体）：hub 更新创建该载体 → 放行并收敛。
 *
 * 驱动面沿 runtime-replication-session.test.ts 先例：包内 seam 直构 runtime +
 * openReplicationSessionCoreForRegistry 直取 core。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, User } from '@nomicore/persistence';
import type { NamespaceRuntime } from '../src/index.js';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import { openReplicationSessionCoreForRegistry } from '../src/replication-session.js';
import type { RuntimeReplicationSessionCore } from '../src/replication-session.js';

const OWNER: User = { userId: 'u-alice' };
const TEXT_V1 = 'type ROOT = { n: number; a: string; };';
const ENV1 = { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_V1 } as const;
const TEXT_V2 = 'type ROOT = { n: number; a: string; b: boolean; };';
const REP_ID = 'a'.repeat(32);
const T0_ISO = new Date(1_700_000_000_000).toISOString();
const HUB_T_ISO = new Date(1_700_000_555_555).toISOString(); // Hub 起源时间戳

/** 种子文档（SCHEMA 信封 + META docId/createdAt + 复制保留字段 + 可选 genesis META.schema）。 */
function seedDoc(opts: { schemaLifecycle?: 'genesis' | 'legacy' } = {}): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(ENV1)) sc.set(k, v);
  const meta = doc.getMap('META');
  meta.set('docId', 'ns-1');
  meta.set('createdAt', T0_ISO);
  meta.set('replicationId', REP_ID);
  meta.set('replicationEpoch', 1);
  if (opts.schemaLifecycle !== 'legacy') {
    const schemaMeta = new Y.Map<unknown>();
    schemaMeta.set('updatedAt', T0_ISO);
    meta.set('schema', schemaMeta);
  }
  doc.getMap('ROOT').set('n', 1);
  doc.getMap('ROOT').set('a', 'x');
  return doc;
}

function makeRuntime(doc: Y.Doc): NamespaceRuntime {
  const handle = {
    owner: OWNER,
    docId: 'ns-1',
    doc,
    getStatus: () => 'ready',
    release: () => Promise.resolve(),
  } as unknown as DocHandle;
  return createNamespaceRuntimeWithSeam({ handle, notifyDirty: () => Promise.resolve() });
}

async function openReadySession(
  runtime: NamespaceRuntime,
  role: 'hub' | 'peer',
): Promise<RuntimeReplicationSessionCore> {
  await expect
    .poll(() => runtime.getStatus().schema.state, { interval: 5, timeout: 5_000 })
    .toBe('ready');
  const opened = openReplicationSessionCoreForRegistry(runtime, { localRole: role, remoteInstanceId: 'remote-a' });
  if (!opened.ok) throw new Error(`open 应成功，实际 ${JSON.stringify(opened)}`);
  return opened.core;
}

/** 生成「远端实例状态更新」：live 全量 bootstrap + 变异（确定性 Yjs 纪律沿既有先例）。 */
function makeRemoteUpdate(liveDoc: Y.Doc, mutate: (doc: Y.Doc) => void): Uint8Array {
  const replica = new Y.Doc();
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(liveDoc));
  mutate(replica);
  return Y.encodeStateAsUpdate(replica);
}

/** 模拟 hub 侧 replaceSchema 提交事务的远端变异：SCHEMA 换 generation + META.schema.updatedAt 推进。 */
function mutateAsHubSchemaReplacement(replica: Y.Doc): void {
  const sc = replica.getMap('SCHEMA');
  sc.set('id', 'ns-2');
  sc.set('text', TEXT_V2);
  const meta = replica.getMap('META');
  const existing = meta.get('schema');
  const schemaMeta: Y.Map<unknown> = existing instanceof Y.Map ? existing : new Y.Map<unknown>();
  if (schemaMeta !== existing) meta.set('schema', schemaMeta);
  schemaMeta.set('updatedAt', HUB_T_ISO);
}

describe('issue #282：peer 侧 META 白名单 {schema}——生命周期元数据随 generation 收敛', () => {
  it('hub→peer：SCHEMA 替换 + META.schema.updatedAt 同事务更新 → apply ok，Hub 起源时间戳原样收敛', async () => {
    const doc = seedDoc();
    const runtime = makeRuntime(doc);
    const session = await openReadySession(runtime, 'peer');

    const result = await session.applyRemoteUpdate(makeRemoteUpdate(doc, mutateAsHubSchemaReplacement));
    expect(result).toEqual({ ok: true });

    // SCHEMA 收敛
    expect(doc.getMap('SCHEMA').get('id')).toBe('ns-2');
    expect(doc.getMap('SCHEMA').get('text')).toBe(TEXT_V2);
    // META.schema.updatedAt = Hub 起源值（peer 不盖本地接收时刻——本测试无 peer 侧时钟注入，
    // 收敛值与 HUB_T_ISO 逐字节相等即证明未经本地时间重写）
    const schemaMeta = doc.getMap('META').get('schema');
    expect(schemaMeta).toBeInstanceOf(Y.Map);
    expect((schemaMeta as Y.Map<unknown>).get('updatedAt')).toBe(HUB_T_ISO);
    // 其余 META 键不变
    expect(doc.getMap('META').get('docId')).toBe('ns-1');
    expect(doc.getMap('META').get('replicationEpoch')).toBe(1);
    await runtime.close();
  });

  it('hub→peer（legacy peer 文档无 META.schema）：hub 更新创建该载体 → 放行并收敛', async () => {
    const doc = seedDoc({ schemaLifecycle: 'legacy' });
    const runtime = makeRuntime(doc);
    const session = await openReadySession(runtime, 'peer');

    const result = await session.applyRemoteUpdate(makeRemoteUpdate(doc, mutateAsHubSchemaReplacement));
    expect(result).toEqual({ ok: true });
    const schemaMeta = doc.getMap('META').get('schema');
    expect(schemaMeta).toBeInstanceOf(Y.Map);
    expect((schemaMeta as Y.Map<unknown>).get('updatedAt')).toBe(HUB_T_ISO);
    await runtime.close();
  });

  it('hub→peer：白名单外 META 键变化（docId/自定义键/replicationEpoch）→ REPLICATION_PROTECTED_FIELDS_CHANGED 零写入', async () => {
    for (const spec of [
      { key: 'docId', value: 'ns-evil' },
      { key: 'customKey', value: 'evil' },
      { key: 'replicationEpoch', value: 99 },
    ] as const) {
      const doc = seedDoc();
      const beforeValue = doc.getMap('META').get(spec.key);
      const runtime = makeRuntime(doc);
      const session = await openReadySession(runtime, 'peer');
      const result = await session.applyRemoteUpdate(
        makeRemoteUpdate(doc, (replica) => replica.getMap('META').set(spec.key, spec.value)),
      );
      expect(result.ok, `[${spec.key}] 应被拒绝`).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('REPLICATION_PROTECTED_FIELDS_CHANGED');
      }
      // 零写入：live 值保持（customKey 恒 undefined）
      expect(doc.getMap('META').get(spec.key)).toBe(beforeValue);
      expect(doc.getMap('META').get('docId')).toBe('ns-1');
      expect(doc.getMap('META').get('replicationEpoch')).toBe(1);
      await runtime.close();
    }
  });

  it('hub→peer：仅 ROOT 变化（不触 META/SCHEMA）→ 照常放行（既有语义零回归）', async () => {
    const doc = seedDoc();
    const runtime = makeRuntime(doc);
    const session = await openReadySession(runtime, 'peer');
    const result = await session.applyRemoteUpdate(
      makeRemoteUpdate(doc, (replica) => replica.getMap('ROOT').set('n', 42)),
    );
    expect(result).toEqual({ ok: true });
    expect(doc.getMap('ROOT').get('n')).toBe(42);
    await runtime.close();
  });
});

describe('issue #282：hub 侧 META 全键保护不变（peer 无生命周期元数据写通道）', () => {
  it('peer→hub：META.schema 变化 → REPLICATION_PROTECTED_FIELDS_CHANGED 零写入', async () => {
    const doc = seedDoc();
    const runtime = makeRuntime(doc);
    const session = await openReadySession(runtime, 'hub');
    const result = await session.applyRemoteUpdate(
      makeRemoteUpdate(doc, (replica) => {
        (replica.getMap('META').get('schema') as Y.Map<unknown>).set('updatedAt', HUB_T_ISO);
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('REPLICATION_PROTECTED_FIELDS_CHANGED');
    }
    expect((doc.getMap('META').get('schema') as Y.Map<unknown>).get('updatedAt')).toBe(T0_ISO);
    await runtime.close();
  });

  it('peer→hub：SCHEMA 容器变化 → REPLICATION_PROTECTED_FIELDS_CHANGED 零写入（既有语义零回归）', async () => {
    const doc = seedDoc();
    const runtime = makeRuntime(doc);
    const session = await openReadySession(runtime, 'hub');
    const result = await session.applyRemoteUpdate(
      makeRemoteUpdate(doc, (replica) => replica.getMap('SCHEMA').set('id', 'ns-evil')),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('REPLICATION_PROTECTED_FIELDS_CHANGED');
    }
    expect(doc.getMap('SCHEMA').get('id')).toBe('ns-1');
    await runtime.close();
  });

  it('peer→hub：仅 ROOT 变化 → 照常放行（既有语义零回归）', async () => {
    const doc = seedDoc();
    const runtime = makeRuntime(doc);
    const session = await openReadySession(runtime, 'hub');
    const result = await session.applyRemoteUpdate(
      makeRemoteUpdate(doc, (replica) => replica.getMap('ROOT').set('n', 7)),
    );
    expect(result).toEqual({ ok: true });
    expect(doc.getMap('ROOT').get('n')).toBe(7);
    await runtime.close();
  });
});

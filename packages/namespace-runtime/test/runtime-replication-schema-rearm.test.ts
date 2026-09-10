/**
 * issue #286 / ADR 0018 §1–§3 — @nomicore/namespace-runtime peer apply 槽提交后
 * schema re-arm（成功 + fatal 双码完整路径）契约测试。
 *
 * 锚定契约：
 * - 成功路径：peer apply 槽提交 SCHEMA 变化后、同一槽结算前 active schema 已切换
 *   （getActiveSchema() 新 fingerprint + 投影自 META.schema 的 updatedAt），后续写按
 *   新 tools 校验；纯格式差异（semantic fingerprint 相同）照常安装且 updatedAt 推进；
 * - fatal 路径：编译结果失败 → NSRT-FATAL-SCHEMA-REARM-INVALID（带稳定 schema issue
 *   摘要）；内部异常 → NSRT-FATAL-SCHEMA-REARM-INTERNAL；写永久禁用、读保留、status
 *   摘要诚实透出、tools 保持旧的不动、apply 已提交事实不回滚、同一文本不自动重试；
 * - re-arm 同时是 P0 编译结果失败 Runtime 的运行期自愈路径；
 * - re-arm 在 persistence-degraded bypass apply 路径照常执行；
 * - apply 结果 ok:true 分支携带 detached re-arm outcome（成功/失败两态），零 live
 *   对象泄漏（冻结纯数据、JSON 往返安全）；
 * - hub 角色 apply 槽结构性不触发 re-arm（钉死）；peer 无 SCHEMA 变化的 apply 不
 *   触发编译（检测成本纪律：text 字节不等才编译）。
 *
 * 驱动面沿 runtime-replication-schema-lifecycle.test.ts 先例：包内 seam 直构
 * runtime + openReplicationSessionCoreForRegistry 直取 core。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, DocHandleStatus, User } from '@nomicore/persistence';
import { compileSchemaEnvelope } from '@nomicore/vfsl';
import type { CompileSchemaEnvelopeResult, SchemaEnvelope } from '@nomicore/vfsl';
import type { NamespaceRuntime } from '../src/index.js';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import { openReplicationSessionCoreForRegistry } from '../src/replication-session.js';
import type { RuntimeReplicationSessionCore } from '../src/replication-session.js';
import {
  FATAL_SCHEMA_REARM_INTERNAL_CODE,
  FATAL_SCHEMA_REARM_INTERNAL_MESSAGE,
  FATAL_SCHEMA_REARM_INVALID_CODE,
  FATAL_SCHEMA_REARM_INVALID_MESSAGE,
} from '../src/errors.js';

const OWNER: User = { userId: 'u-alice' };
const TEXT_V1 = 'type ROOT = { n: number; a: string; };';
/** 与 V1 语义等价、字节不同（格式/注释差异）——semantic fingerprint 相同。 */
const TEXT_V1_FMT = 'type ROOT = {\n  // 纯格式差异\n  n: number;\n  a: string;\n};';
const TEXT_V2 = 'type ROOT = { n: number; a: string; b: boolean; };';
/** 语法非法（编译结果失败——结果联合内 ok:false）。 */
const TEXT_BAD = 'type ROOT = { broken';
const ENV1 = { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_V1 } as const;
const REP_ID = 'a'.repeat(32);
const T0_ISO = new Date(1_700_000_000_000).toISOString();
const HUB_T_ISO = new Date(1_700_000_555_555).toISOString(); // Hub 起源时间戳

const COMPILED_V1 = compileSchemaEnvelope(ENV1);
const COMPILED_V1_FMT = compileSchemaEnvelope({ ...ENV1, text: TEXT_V1_FMT });
const COMPILED_V2 = compileSchemaEnvelope({ ...ENV1, text: TEXT_V2 });
if (!COMPILED_V1.ok || !COMPILED_V1_FMT.ok || !COMPILED_V2.ok) {
  throw new Error('前置失败：V1/V1_FMT/V2 应编译成功');
}
// 前置锚：格式差异语义指纹相同、信封指纹不同（ADR 0017 前提）
expect(COMPILED_V1_FMT.semanticFingerprint).toBe(COMPILED_V1.semanticFingerprint);
expect(COMPILED_V1_FMT.envelopeFingerprint).not.toBe(COMPILED_V1.envelopeFingerprint);
expect(COMPILED_V2.semanticFingerprint).not.toBe(COMPILED_V1.semanticFingerprint);

/** 种子文档（SCHEMA 信封 + META docId/createdAt + 复制保留字段 + genesis META.schema）。 */
function seedDoc(opts: { schemaText?: string } = {}): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(ENV1)) sc.set(k, v);
  if (opts.schemaText !== undefined) sc.set('text', opts.schemaText);
  const meta = doc.getMap('META');
  meta.set('docId', 'ns-1');
  meta.set('createdAt', T0_ISO);
  meta.set('replicationId', REP_ID);
  meta.set('replicationEpoch', 1);
  const schemaMeta = new Y.Map<unknown>();
  schemaMeta.set('updatedAt', T0_ISO);
  meta.set('schema', schemaMeta);
  doc.getMap('ROOT').set('n', 1);
  doc.getMap('ROOT').set('a', 'x');
  return doc;
}

interface RuntimeKit {
  runtime: NamespaceRuntime;
  setStatus: (fn: () => DocHandleStatus) => void;
  notifyCount: () => number;
}

function makeRuntime(
  doc: Y.Doc,
  opts: {
    compile?: (envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult;
  } = {},
): RuntimeKit {
  let statusFn: () => DocHandleStatus = () => 'ready';
  let notifyCalls = 0;
  const handle = {
    owner: OWNER,
    docId: 'ns-1',
    doc,
    getStatus: () => statusFn(),
    release: () => Promise.resolve(),
  } as unknown as DocHandle;
  const runtime = createNamespaceRuntimeWithSeam({
    handle,
    notifyDirty: () => {
      notifyCalls += 1;
      return Promise.resolve();
    },
    ...(opts.compile !== undefined ? { compile: opts.compile } : {}),
  });
  return { runtime, setStatus: (fn) => { statusFn = fn; }, notifyCount: () => notifyCalls };
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
  return Y.encodeStateAsUpdate(replica, Y.encodeStateVector(liveDoc));
}

/** 模拟 hub 侧 replaceSchema 提交事务的远端变异：SCHEMA 四键换 generation +
 *  META.schema.updatedAt 推进（同事务原子——ADR 0017）。 */
function mutateAsHubSchemaReplacement(replica: Y.Doc, text: string, updatedAt: string = HUB_T_ISO): void {
  replica.getMap('SCHEMA').set('text', text);
  const meta = replica.getMap('META');
  const existing = meta.get('schema');
  const schemaMeta: Y.Map<unknown> = existing instanceof Y.Map ? existing : new Y.Map<unknown>();
  if (schemaMeta !== existing) meta.set('schema', schemaMeta);
  schemaMeta.set('updatedAt', updatedAt);
}

describe('issue #286 AC1/AC2：成功路径——同槽切换 + 后续写按新 tools 校验', () => {
  it('peer apply 提交 SCHEMA 变化后同一槽结算前 active schema 已切换；后续写按新 tools 校验', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    const session = await openReadySession(runtime, 'peer');

    // 前置：旧 tools 下写新字段 b 诚实失败（closed ROOT——V1 无 b）
    const before = await runtime.mutateData({ op: 'set', path: ['b'], value: true });
    expect(before.ok).toBe(false);
    expect(runtime.getActiveSchema()?.semanticFingerprint).toBe(COMPILED_V1.semanticFingerprint);

    const result = await session.applyRemoteUpdate(
      makeRemoteUpdate(doc, (replica) => mutateAsHubSchemaReplacement(replica, TEXT_V2)),
    );

    // 同一槽结算前 re-arm 已完成（ADR 0018 §1「ACK 语义附带 active schema 已同步切换」）
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.schemaRearm).toEqual({
      kind: 'applied',
      semanticFingerprint: COMPILED_V2.semanticFingerprint,
      updatedAt: HUB_T_ISO, // 投影自复制来的 META.schema——peer 不读本地时钟（本测试无时钟注入）
    });
    // detached 纪律（AC6 成功态）：冻结纯数据、恰三键、JSON 往返安全
    expect(Object.isFrozen(result.schemaRearm)).toBe(true);
    expect(Object.keys(result.schemaRearm ?? {}).sort()).toEqual(['kind', 'semanticFingerprint', 'updatedAt']);
    expect(JSON.parse(JSON.stringify(result.schemaRearm))).toEqual(result.schemaRearm);

    // getActiveSchema() 投影新 generation（指纹 + Hub 起源 updatedAt 逐字节一致）
    const active = runtime.getActiveSchema();
    expect(active?.semanticFingerprint).toBe(COMPILED_V2.semanticFingerprint);
    expect(active?.envelopeFingerprint).toBe(COMPILED_V2.envelopeFingerprint);
    expect(active?.updatedAt).toBe(HUB_T_ISO);

    // 后续业务写按新 tools 校验：V2 新字段 b 可写；V2 下 n 仍受 number 约束
    const after = await runtime.mutateData({ op: 'set', path: ['b'], value: true });
    expect(after).toEqual({ ok: true });
    const wrongType = await runtime.mutateData({ op: 'set', path: ['n'], value: 'oops' });
    expect(wrongType.ok).toBe(false);
    await runtime.close();
  });

  it('AC2：纯格式差异（semantic fingerprint 相同）照常安装并投影新 updatedAt（与 Hub 逐字节一致）', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    const session = await openReadySession(runtime, 'peer');

    const result = await session.applyRemoteUpdate(
      makeRemoteUpdate(doc, (replica) => mutateAsHubSchemaReplacement(replica, TEXT_V1_FMT)),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    // 不据 fingerprint 跳过——照常安装且 updatedAt 推进（ADR 0017「每次提交都推进」）
    expect(result.schemaRearm).toEqual({
      kind: 'applied',
      semanticFingerprint: COMPILED_V1.semanticFingerprint, // 语义指纹不变
      updatedAt: HUB_T_ISO,
    });
    const active = runtime.getActiveSchema();
    expect(active?.semanticFingerprint).toBe(COMPILED_V1.semanticFingerprint);
    expect(active?.envelopeFingerprint).toBe(COMPILED_V1_FMT.envelopeFingerprint); // 信封指纹随字节更新
    expect(active?.updatedAt).toBe(HUB_T_ISO);
    await runtime.close();
  });

  it('检测成本纪律：SCHEMA text 不变的 apply 不触发编译、结果不携带 schemaRearm', async () => {
    const doc = seedDoc();
    let compileCalls = 0;
    const { runtime } = makeRuntime(doc, {
      compile: (envelope) => {
        compileCalls += 1;
        return compileSchemaEnvelope(envelope);
      },
    });
    const session = await openReadySession(runtime, 'peer');
    const afterP0 = compileCalls;

    // lang/version/id 变化而 text 不变（契约外但判据字面：唯一起行为判据是 text）
    const result = await session.applyRemoteUpdate(
      makeRemoteUpdate(doc, (replica) => {
        replica.getMap('SCHEMA').set('id', 'ns-1-renamed');
        replica.getMap('ROOT').set('n', 2);
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect('schemaRearm' in result).toBe(false);
    expect(compileCalls, 'text 字节相等 ⇒ 零编译成本').toBe(afterP0);
    expect(runtime.getActiveSchema()?.semanticFingerprint).toBe(COMPILED_V1.semanticFingerprint);
    await runtime.close();
  });
});

describe('issue #286 AC3：fatal 双码完整路径', () => {
  it('编译结果失败 → NSRT-FATAL-SCHEMA-REARM-INVALID：写永久禁用/读保留/摘要透出/已提交不回滚/同一文本不重试', async () => {
    const doc = seedDoc();
    let badTextCompiles = 0;
    const { runtime } = makeRuntime(doc, {
      compile: (envelope) => {
        if (envelope.text === TEXT_BAD) badTextCompiles += 1;
        return compileSchemaEnvelope(envelope);
      },
    });
    const session = await openReadySession(runtime, 'peer');

    const result = await session.applyRemoteUpdate(
      makeRemoteUpdate(doc, (replica) => {
        mutateAsHubSchemaReplacement(replica, TEXT_BAD);
        replica.getMap('ROOT').set('n', 42); // 同事务业务事实——committed 不回滚锚
      }),
    );

    // apply 槽本身不失败（ADR 0008 修订节第 3 条）：ok:true + detached failed outcome
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.schemaRearm?.kind).toBe('failed');
    if (result.schemaRearm?.kind !== 'failed') throw new Error('unreachable');
    expect(result.schemaRearm.code).toBe(FATAL_SCHEMA_REARM_INVALID_CODE);
    // 稳定 schema issue 摘要（SCHEMA_TEXT_INVALID 族——非原始异常文本）
    expect(result.schemaRearm.issue?.code).toBe('SCHEMA_TEXT_INVALID');
    expect(Object.isFrozen(result.schemaRearm)).toBe(true);
    expect(JSON.parse(JSON.stringify(result.schemaRearm))).toEqual(result.schemaRearm);
    expect(badTextCompiles).toBe(1); // re-arm 编译恰一次

    // 结算：写永久禁用、读保留、status fatal 摘要诚实透出（带稳定 issue 摘要）
    const status = runtime.getStatus();
    expect(status.fatal?.code).toBe(FATAL_SCHEMA_REARM_INVALID_CODE);
    expect(status.fatal?.message.startsWith(FATAL_SCHEMA_REARM_INVALID_MESSAGE)).toBe(true);
    expect(status.fatal?.message).toContain('schema issue 摘要：SCHEMA_TEXT_INVALID:');
    const write = await runtime.mutateData({ op: 'set', path: ['n'], value: 7 });
    expect(write.ok).toBe(false);
    if (!write.ok) expect(JSON.stringify(write.issues)).toContain('RUNTIME_WRITE_DISABLED');
    // 读保留 + apply 已提交事实不回滚
    expect(runtime.readData(['n'])).toMatchObject({ ok: true, value: 42 });
    // tools 保持旧的不动（active 身份仍是 V1 generation）
    expect(runtime.getActiveSchema()?.semanticFingerprint).toBe(COMPILED_V1.semanticFingerprint);
    expect(runtime.getActiveSchema()?.updatedAt).toBe(T0_ISO);

    // 同一文本不自动重试：后续 apply 在 R1 fatal gate 拒绝，编译不再发生
    const retry = await session.applyRemoteUpdate(
      makeRemoteUpdate(doc, (replica) => {
        replica.getMap('ROOT').set('n', 43);
      }),
    );
    expect(retry.ok).toBe(false);
    if (!retry.ok) expect(retry.code).toBe('RUNTIME_WRITE_DISABLED');
    expect(badTextCompiles, 'fatal 后零重试（R1 短路，编译不再调用）').toBe(1);
    expect(runtime.readData(['n'])).toMatchObject({ ok: true, value: 42 }); // 零写入
    await runtime.close();
  });

  it('内部异常（compile throw）→ NSRT-FATAL-SCHEMA-REARM-INTERNAL：恒定文案不含原始异常文本', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc, {
      compile: (envelope) => {
        if (envelope.text === TEXT_V2) throw new Error('boom-sentinel-internal-fault');
        return compileSchemaEnvelope(envelope);
      },
    });
    const session = await openReadySession(runtime, 'peer');

    const result = await session.applyRemoteUpdate(
      makeRemoteUpdate(doc, (replica) => mutateAsHubSchemaReplacement(replica, TEXT_V2)),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    // 失败两态之 INTERNAL：稳定码，无 issue 键（结果联合之外无领域摘要可派生）
    expect(result.schemaRearm).toEqual({ kind: 'failed', code: FATAL_SCHEMA_REARM_INTERNAL_CODE });

    const status = runtime.getStatus();
    expect(status.fatal?.code).toBe(FATAL_SCHEMA_REARM_INTERNAL_CODE);
    expect(status.fatal?.message, '恒定文案——不含原始异常文本/stack（INV-N7）').toBe(
      FATAL_SCHEMA_REARM_INTERNAL_MESSAGE,
    );
    expect(status.fatal?.message).not.toContain('boom-sentinel');
    // 写禁读留、tools 不动
    const write = await runtime.mutateData({ op: 'set', path: ['n'], value: 7 });
    expect(write.ok).toBe(false);
    expect(runtime.getActiveSchema()?.semanticFingerprint).toBe(COMPILED_V1.semanticFingerprint);
    expect(runtime.readData(['n'])).toMatchObject({ ok: true, value: 1 });
    await runtime.close();
  });
});

describe('issue #286 AC4/AC5：自愈与 degraded bypass', () => {
  it('AC4：P0 编译结果失败 Runtime 经 re-arm 自愈恢复写能力（无需 reset/重启）', async () => {
    const doc = seedDoc({ schemaText: TEXT_BAD }); // 构造即坏 schema → P0 结果失败
    const { runtime } = makeRuntime(doc);
    await expect
      .poll(() => runtime.getStatus().schema.state, { interval: 5, timeout: 5_000 })
      .toBe('unavailable');
    // P0 失败面：fatal 未置位、rootWrite 不可用、session open 无 schemaState gate（既定行为）
    expect(runtime.getStatus().fatal).toBeNull();
    const blocked = await runtime.mutateData({ op: 'set', path: ['n'], value: 9 });
    expect(blocked.ok).toBe(false);
    const opened = openReplicationSessionCoreForRegistry(runtime, { localRole: 'peer', remoteInstanceId: 'hub-1' });
    if (!opened.ok) throw new Error(`P0 失败 Runtime 的 session open 应成功，实际 ${JSON.stringify(opened)}`);

    // Hub 修正 schema 经复制到达 → re-arm 编译成功 → 自愈
    const result = await opened.core.applyRemoteUpdate(
      makeRemoteUpdate(doc, (replica) => mutateAsHubSchemaReplacement(replica, TEXT_V2)),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.schemaRearm).toEqual({
      kind: 'applied',
      semanticFingerprint: COMPILED_V2.semanticFingerprint,
      updatedAt: HUB_T_ISO,
    });
    // 写能力恢复 + unavailable 摘要不残留
    expect(runtime.getStatus().schema.state).toBe('ready');
    const healed = await runtime.mutateData({ op: 'set', path: ['b'], value: true });
    expect(healed).toEqual({ ok: true });
    await runtime.close();
  });

  it('AC5：persistence-degraded bypass apply 路径 re-arm 照常执行', async () => {
    const doc = seedDoc();
    const { runtime, setStatus, notifyCount } = makeRuntime(doc);
    const session = await openReadySession(runtime, 'peer');
    setStatus(() => 'persistence-degraded'); // open 后降级（沿既有 bypass 测试先例）

    const result = await session.applyRemoteUpdate(
      makeRemoteUpdate(doc, (replica) => mutateAsHubSchemaReplacement(replica, TEXT_V2)),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.schemaRearm).toEqual({
      kind: 'applied',
      semanticFingerprint: COMPILED_V2.semanticFingerprint,
      updatedAt: HUB_T_ISO,
    });
    expect(runtime.getActiveSchema()?.semanticFingerprint).toBe(COMPILED_V2.semanticFingerprint);
    expect(notifyCount(), 'bypass 路径仍登记 dirty（ADR 0010 L135）').toBeGreaterThan(0);
    await runtime.close();
  });
});

describe('issue #286 AC7：角色不对称钉死', () => {
  it('hub 角色 apply 槽结构性不触发 re-arm（compile 零调用、结果零 schemaRearm 键）', async () => {
    const doc = seedDoc();
    let compileCalls = 0;
    const { runtime } = makeRuntime(doc, {
      compile: (envelope) => {
        compileCalls += 1;
        return compileSchemaEnvelope(envelope);
      },
    });
    const session = await openReadySession(runtime, 'hub');
    const afterP0 = compileCalls;

    // 合法 peer→hub 业务写：apply 成功，无 re-arm
    const applied = await session.applyRemoteUpdate(
      makeRemoteUpdate(doc, (replica) => {
        replica.getMap('ROOT').set('n', 5);
      }),
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error('unreachable');
    expect('schemaRearm' in applied).toBe(false);
    expect(compileCalls).toBe(afterP0);

    // SCHEMA 变化在 hub 侧被 protected-field 检查整体拒绝（既有不变量）——结构性
    // 不可能到达 re-arm 段
    const rejected = await session.applyRemoteUpdate(
      makeRemoteUpdate(doc, (replica) => mutateAsHubSchemaReplacement(replica, TEXT_V2)),
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.code).toBe('REPLICATION_PROTECTED_FIELDS_CHANGED');
    expect(compileCalls, 'hub apply 槽永不触发 re-arm 编译').toBe(afterP0);
    expect(runtime.getActiveSchema()?.semanticFingerprint).toBe(COMPILED_V1.semanticFingerprint);
    await runtime.close();
  });
});

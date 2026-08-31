/**
 * [SA7 owned] issue #151 动态验证 — SA4 R2 移交的动态审核重点 2/3/4（Phase 4）。
 *
 * 对应 `wiki/raw/task_trusted-replication-management-diagnostic-change-log_sa4_review.md`
 * 「动态审核重点」清单：
 *
 * - **重点 2（设计 §15.7(b)）updateCapture:false 活链路**：以
 *   `makeLog({ updateCapture: false })`（生产默认捕获关闭，ADR 0011 §数据保护）跑
 *   hub-to-peer committed apply → attempt record `result` 必须为
 *   `committed + update-omitted` 且 reason ∈ 冻结三词表
 *   （`payload-too-large` / `update-capture-disabled` / `empty-update`，本路径预期
 *   `update-capture-disabled`），业务 `ok:true` 与 live 集成效果不变。
 *   该分支 producer 侧恒不产出（设计 §10 钉死 #1），由日志存储面承载——本用例
 *   在活链路兑现。
 *
 * - **重点 3（A-c 未覆盖路径）Runtime close 终止 session**：
 *   (a) `runtime.close()` 同步段 `terminateAll('runtime-close')` → session
 *       `getStatus()` 呈 `{state:'closed', closedBy:'runtime-close'}` → 后续
 *       `applyRemoteUpdate` 在接纳层 A1 被拒：`RUNTIME_WRITE_DISABLED` +
 *       记录 stage `acceptance` / sourceModule `runtime` / input
 *       `{capture:'not-accessed'}`（§9.3 A-c 行；红灯 15 用例只测了显式 close 的
 *       REPLICATION_SESSION_CLOSED 分支——A-a）；对照：显式 `session.close()` 后
 *       保持 REPLICATION_SESSION_CLOSED（码域分野）。
 *   (b) close-while-apply-in-flight：apply 槽已接纳（R6 await notifyDirty 挂起）时
 *       调 `runtime.close()` → 已接纳槽照常排空（ADR-0008 FIFO barrier 语义），
 *       close barrier 在其后结算；in-flight apply `ok:true` + 集成生效 + committed
 *       记录照发；close 后新 apply 走 (a) 拒绝路径。
 *
 * - **重点 4（F1 修复后）无诊断基线行为等价 sweep**：同一操作序列
 *   （enable → bump → apply 真集成 → apply 空 diff → fenced apply）分别在
 *   无 emitter 基线（生产默认 seam）与有日志装配基线上运行，断言
 *   saveCalls 计数轨迹 / 结果联合 / 最终业务状态逐项一致（§3 补充隔离 +
 *   §13.5「无日志基线行为等价」），且有日志基线恰产出 5 条 attempt 记录、
 *   记录面零影响业务面。
 *
 * 断言全部锚定运行时可观察行为（结果联合 / 计数 / record 内容 / doc 状态），
 * 无源码 grep。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import type { NamespaceRuntime } from '../src/index.js';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import { openReplicationSessionCoreForRegistry } from '../src/replication-session.js';
import {
  createBoundedMemoryDiagnosticLog,
  type AttemptRecord,
  type BoundedMemoryDiagnosticLog,
} from '../../namespace-diagnostic-log/src/index.js';

// ── 固定夹具（沿 SA4 探针先例——StubHandle/CountingPersistence/裸 seam 装配）────

const NOW_MS = 1_700_000_000_000;
const OWNER: User = { userId: 'u-alice' };
const ENVELOPE = { lang: 'vfsl', version: 1, id: 'ns-1', text: 'type ROOT = { n: number; a: string; };' } as const;
const ROOT0 = { n: 1, a: 'x' };
const NAMESPACE_ID = 'k-ns';
const REPLICATION_ID = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const REMOTE_HUB_ID = 'hub-1';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
  doc.getMap('META').set('docId', NAMESPACE_ID);
  doc.getMap('META').set('createdAt', 1_700_000_000_000);
  const root = doc.getMap('ROOT');
  for (const [k, v] of Object.entries(ROOT0)) root.set(k, v);
  return doc;
}

class StubHandle implements DocHandle {
  releaseCalls = 0;
  constructor(
    readonly owner: User,
    readonly docId: string,
    readonly doc: Y.Doc,
  ) {}
  getStatus(): 'ready' {
    return 'ready';
  }
  release(): Promise<void> {
    this.releaseCalls += 1;
    return Promise.resolve();
  }
}

/** 计数 persistence：saveCalls 是两基线等价性 sweep 的核心观测面。 */
class CountingPersistence implements DocPersistence {
  saveCalls = 0;
  constructor(private readonly doc: Y.Doc) {}
  async createDoc(owner: User, docId: string, _doc: Y.Doc): Promise<DocHandle> {
    void _doc;
    return new StubHandle(owner, docId, this.doc);
  }
  async loadDoc(): Promise<DocHandle | null> {
    return null;
  }
  async saveDoc(): Promise<void> {
    this.saveCalls += 1;
  }
}

/** 可阻塞 notifyDirty：close-while-in-flight 用例的时序控制柄。 */
function makeBlockingNotify(): {
  notify: () => Promise<void>;
  release: () => void;
  calls: () => number;
} {
  let resolvers: Array<() => void> = [];
  let calls = 0;
  return {
    notify: () =>
      new Promise<void>((resolve) => {
        calls += 1;
        resolvers.push(resolve);
      }),
    release: () => {
      const pending = resolvers;
      resolvers = [];
      for (const r of pending) r();
    },
    calls: () => calls,
  };
}

interface Sa7Fixture {
  runtime: NamespaceRuntime;
  handle: StubHandle;
  persistence: CountingPersistence;
  log: BoundedMemoryDiagnosticLog | undefined;
}

/** 装配基线：withDiagnostics=false 即无 emitter 生产默认（F1 修复的验证面）。 */
async function makeFixture(withDiagnostics: boolean): Promise<Sa7Fixture> {
  const doc = makeDoc();
  const persistence = new CountingPersistence(doc);
  const handle = (await persistence.createDoc(OWNER, NAMESPACE_ID, doc)) as StubHandle;
  const log = withDiagnostics
    ? createBoundedMemoryDiagnosticLog({ inputPolicy: 'digest', updateCapture: true })
    : undefined;
  const runtime = createNamespaceRuntimeWithSeam({
    handle,
    notifyDirty: () => persistence.saveDoc(),
    ...(log !== undefined ? { diagnosticEmitter: log.emitter, clock: () => NOW_MS } : {}),
  } as never) as unknown as NamespaceRuntime;
  await expect
    .poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 })
    .toBe('ready');
  return { runtime, handle, persistence, log };
}

/** 从基态构造「远端」真增量（红灯契约 buildRemoteDiff 同款语义）。 */
function buildRemoteDiff(baseState: Uint8Array, mutate: (doc: Y.Doc) => void): Uint8Array {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, baseState);
  mutate(remote);
  const baseDoc = new Y.Doc();
  Y.applyUpdate(baseDoc, baseState);
  return Y.encodeStateAsUpdate(remote, Y.encodeStateVector(baseDoc));
}

function emptyDiff(): Uint8Array {
  return Y.encodeStateAsUpdate(new Y.Doc());
}

// 会话 core 面（内部 seam——与 lease 薄通道同一 core 入口；沿 SA4 探针 A 先例）
interface SessionCoreSurface {
  readonly localRole: 'hub' | 'peer';
  readonly remoteInstanceId: string;
  readonly replicationId: string;
  readonly replicationEpoch: number;
  applyRemoteUpdate(update: Uint8Array): Promise<Readonly<{ ok: true } | { ok: false; code: string; message: string }>>;
  getStatus(): Readonly<{
    state: 'open' | 'closed' | 'conflicted';
    closedBy?: 'explicit-close' | 'runtime-close';
    direction: 'hub-to-peer' | 'peer-to-hub';
  }>;
  close(): Promise<void>;
}

async function openSession(
  runtime: NamespaceRuntime,
  localRole: 'hub' | 'peer',
): Promise<SessionCoreSurface> {
  const opened = openReplicationSessionCoreForRegistry(runtime, {
    localRole,
    remoteInstanceId: REMOTE_HUB_ID,
  });
  if (!opened.ok) throw new Error(`openReplicationSession 应成功：${JSON.stringify(opened)}`);
  return opened.core as unknown as SessionCoreSurface;
}

async function waitAttempt(log: BoundedMemoryDiagnosticLog, expected: number): Promise<AttemptRecord[]> {
  await expect
    .poll(() => log.records().filter((r) => r.recordKind === 'attempt').length, { interval: 5, timeout: 3_000 })
    .toBe(expected);
  return log.records().filter((r): r is AttemptRecord => r.recordKind === 'attempt');
}

/** 重点 4 的操作序列（两基线共用——结果逐项对照）。 */
interface SweepOutcome {
  enableResult: Readonly<{ ok: boolean }>;
  bumpResult: Readonly<{ ok: boolean }>;
  applyIntegrated: Readonly<{ ok: boolean }>;
  applyNoop: Readonly<{ ok: boolean }>;
  applyFenced: Readonly<{ ok: boolean; code?: string }>;
  saveCallsAfterEachStep: number[];
  rootN: unknown;
  metaId: unknown;
  metaEpoch: unknown;
  epochAfterBump: number;
}

async function runSweepSequence(fixture: Sa7Fixture): Promise<SweepOutcome> {
  const { runtime, handle, persistence } = fixture;
  const saves: number[] = [];

  const enable = await runtime.enableReplication({ replicationId: REPLICATION_ID });
  saves.push(persistence.saveCalls);
  const bump = await runtime.bumpReplicationEpoch();
  saves.push(persistence.saveCalls);

  // 会话在 bump 之后打开（冻结 epoch=2）→ apply 走已接纳路径
  const session = await openSession(runtime, 'peer');
  const baseState = Y.encodeStateAsUpdate(handle.doc);
  const diff = buildRemoteDiff(baseState, (d) => {
    d.getMap('ROOT').set('n', 42);
  });
  const applyIntegrated = await session.applyRemoteUpdate(diff);
  saves.push(persistence.saveCalls);
  const applyNoop = await session.applyRemoteUpdate(emptyDiff());
  saves.push(persistence.saveCalls);

  // bump 使现存 session 被动 fence（E5.5' 主动 fence）→ 再 apply 走 identity 拒绝
  await runtime.bumpReplicationEpoch();
  saves.push(persistence.saveCalls);
  const applyFenced = await session.applyRemoteUpdate(diff);
  saves.push(persistence.saveCalls);

  return {
    enableResult: enable,
    bumpResult: bump,
    applyIntegrated,
    applyNoop,
    applyFenced,
    saveCallsAfterEachStep: saves,
    rootN: handle.doc.getMap('ROOT').get('n'),
    metaId: handle.doc.getMap('META').get('replicationId'),
    metaEpoch: handle.doc.getMap('META').get('replicationEpoch'),
    epochAfterBump: session.replicationEpoch,
  };
}

// ── 测试主体 ────────────────────────────────────────────────────────────────

describe('[SA7] #151 SA4 移交动态验证（重点 2/3/4）', () => {
  it('重点 2（§15.7(b)）：updateCapture:false 的 hub-to-peer committed apply → committed + update-omitted / reason update-capture-disabled，业务 ok:true 不变', async () => {
    // 生产默认捕获关闭（README §config：updateCapture 默认 false）
    const log = createBoundedMemoryDiagnosticLog({ inputPolicy: 'digest', updateCapture: false });
    const doc = makeDoc();
    const persistence = new CountingPersistence(doc);
    const handle = (await persistence.createDoc(OWNER, NAMESPACE_ID, doc)) as StubHandle;
    const runtime = createNamespaceRuntimeWithSeam({
      handle,
      notifyDirty: () => persistence.saveDoc(),
      diagnosticEmitter: log.emitter,
      clock: () => NOW_MS,
    } as never) as unknown as NamespaceRuntime;
    await expect
      .poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 })
      .toBe('ready');

    const enable = await runtime.enableReplication({ replicationId: REPLICATION_ID });
    expect(enable).toMatchObject({ ok: true });
    const session = await openSession(runtime, 'peer'); // localRole peer ⇒ hub-to-peer
    expect(session.getStatus().direction).toBe('hub-to-peer');

    const baseState = Y.encodeStateAsUpdate(handle.doc);
    const diff = buildRemoteDiff(baseState, (d) => {
      d.getMap('ROOT').set('n', 42);
    });
    const res = await session.applyRemoteUpdate(diff);
    expect(res).toMatchObject({ ok: true }); // 业务结果不变

    const recs = await waitAttempt(log, 2); // enable + apply
    const applyRec = recs.find((r) => r.operation === 'replication-apply');
    if (applyRec === undefined) throw new Error('replication-apply 记录缺失');
    // update-omitted 显式分置：effect 不冒充 noop / update，reason ∈ 冻结三词表
    expect(applyRec.stage).toBe('transaction');
    expect(applyRec.result).toEqual({
      kind: 'committed',
      effect: 'update-omitted',
      reason: 'update-capture-disabled',
    });
    expect(['payload-too-large', 'update-capture-disabled', 'empty-update']).toContain(
      (applyRec.result as { reason: string }).reason,
    );
    expect(applyRec.source).toEqual({ kind: 'replication', direction: 'hub-to-peer', remoteInstanceId: REMOTE_HUB_ID });
    expect(applyRec.context).toMatchObject({ replicationId: REPLICATION_ID, replicationEpoch: 1 });
    expect(applyRec.input).toEqual({ capture: 'none' }); // raw bytes 非 plain-data——省略投影

    // 对照：enable 记录在 updateCapture:false 下同样 update-omitted（存储面策略一致）
    const enableRec = recs.find((r) => r.operation === 'replication-enable');
    if (enableRec === undefined) throw new Error('replication-enable 记录缺失');
    expect(enableRec.result).toEqual({
      kind: 'committed',
      effect: 'update-omitted',
      reason: 'update-capture-disabled',
    });

    // 业务面不受日志捕获策略影响：集成生效 + 持久化触发（F1 修复后两基线同构）
    expect(handle.doc.getMap('ROOT').get('n')).toBe(42);
    expect(persistence.saveCalls).toBe(2); // enable E6 + apply R6（有集成）
  });

  it('重点 3(a)（A-c）：runtime.close() 终止 session → closedBy runtime-close，后续 apply acceptance/RUNTIME_WRITE_DISABLED + input not-accessed；显式 close 对照保持 SESSION_CLOSED', async () => {
    const fixture = await makeFixture(true);
    const { runtime, handle } = fixture;
    const log = fixture.log;
    if (log === undefined) throw new Error('makeFixture(true) 必须装配诊断日志（不可达防御）');
    const enable = await runtime.enableReplication({ replicationId: REPLICATION_ID });
    expect(enable).toMatchObject({ ok: true });
    await waitAttempt(log, 1);

    // 显式 close 对照（A-a：红灯已覆盖分支——此处作码域分野对照）
    const explicitSession = await openSession(runtime, 'peer');
    await explicitSession.close();
    expect(explicitSession.getStatus().state).toBe('closed');
    expect(explicitSession.getStatus().closedBy).toBe('explicit-close');
    const explicitRefusal = await explicitSession.applyRemoteUpdate(emptyDiff());
    expect(explicitRefusal).toMatchObject({ ok: false, code: 'REPLICATION_SESSION_CLOSED' });

    // 主验面：runtime.close() 同步段 terminateAll('runtime-close')
    const session = await openSession(runtime, 'peer');
    expect(session.getStatus().state).toBe('open');
    await runtime.close();
    expect(session.getStatus().state).toBe('closed');
    expect(session.getStatus().closedBy).toBe('runtime-close');

    const diff = buildRemoteDiff(Y.encodeStateAsUpdate(handle.doc), (d) => {
      d.getMap('ROOT').set('n', 7);
    });
    const refusal = await session.applyRemoteUpdate(diff);
    // A-c 映射：acceptance / RUNTIME_WRITE_DISABLED（runtime 模块）
    expect(refusal).toMatchObject({ ok: false, code: 'RUNTIME_WRITE_DISABLED' });
    // 零写入零通知：ROOT 未被触碰（saveCalls 停在 enable 的 1）
    expect(handle.doc.getMap('ROOT').get('n')).toBe(1);
    expect(fixture.persistence.saveCalls).toBe(1);

    // 记录面：A-c 行 stage acceptance / code RUNTIME_WRITE_DISABLED / input not-accessed
    const recs = await waitAttempt(log, 3); // enable + explicit-close A-a + runtime-close A-c
    const aC = recs.filter((r) => r.operation === 'replication-apply').at(-1);
    if (aC === undefined) throw new Error('runtime-close apply 记录缺失');
    expect(aC.stage).toBe('acceptance');
    expect(aC.code).toBe('RUNTIME_WRITE_DISABLED');
    expect(aC.sourceModule).toBe('runtime');
    expect(aC.result).toEqual({ kind: 'rejected' });
    expect(aC.input).toEqual({ capture: 'not-accessed' });
    expect(aC.source).toEqual({ kind: 'replication', direction: 'hub-to-peer', remoteInstanceId: REMOTE_HUB_ID });
    // 对照：显式 close 的 A-a 记录码域分野（REPLICATION_SESSION_CLOSED）
    const aA = recs.filter((r) => r.operation === 'replication-apply').at(-2);
    if (aA === undefined) throw new Error('explicit-close apply 记录缺失');
    expect(aA.code).toBe('REPLICATION_SESSION_CLOSED');
    expect(aA.stage).toBe('acceptance');
  });

  it('重点 3(b)：close-while-apply-in-flight — 已接纳 apply 槽照常排空（FIFO barrier），close 后新 apply 走 runtime-close 拒绝', async () => {
    // 独立装配：notifyDirty 可阻塞（挂起 apply 槽 R6 → close 介入窗口）
    const doc = makeDoc();
    const persistence = new CountingPersistence(doc);
    const handle = (await persistence.createDoc(OWNER, NAMESPACE_ID, doc)) as StubHandle;
    const log = createBoundedMemoryDiagnosticLog({ inputPolicy: 'digest', updateCapture: true });
    const blocker = makeBlockingNotify();
    const runtime = createNamespaceRuntimeWithSeam({
      handle,
      notifyDirty: blocker.notify,
      diagnosticEmitter: log.emitter,
      clock: () => NOW_MS,
    } as never) as unknown as NamespaceRuntime;
    await expect
      .poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 })
      .toBe('ready');

    // enable 的 E6 同样经 blocker（槽序 FIFO 的第一项）——不 await：先挂起、再放行
    const enablePromise = runtime.enableReplication({ replicationId: REPLICATION_ID });
    await expect
      .poll(() => blocker.calls(), { interval: 5, timeout: 3_000 })
      .toBe(1); // enable E6 无条件通知（挂起中）
    blocker.release(); // 放行 enable
    expect(await enablePromise).toMatchObject({ ok: true });

    const session = await openSession(runtime, 'peer');
    const diff = buildRemoteDiff(Y.encodeStateAsUpdate(handle.doc), (d) => {
      d.getMap('ROOT').set('n', 42);
    });

    // 已接纳 apply（不 await）——槽体 R6 await notifyDirty 挂起
    const applyPromise = session.applyRemoteUpdate(diff);
    await expect
      .poll(() => blocker.calls(), { interval: 5, timeout: 3_000 })
      .toBe(2); // apply R6 已进入挂起 ⇒ in-flight

    // close 介入：同步段 terminateAll + barrier 入队（排在已接纳 apply 之后）。
    // 不 await close——barrier 在被挂起的 apply 槽之后，await 会死等（结构性证明：
    // barrier 结算 ⟹ apply 已先结算）。
    const closePromise = runtime.close();
    // close() 返回前即可观测终止（同步段）；barrier 未结算（apply 槽还挂着）
    expect(session.getStatus().state).toBe('closed');
    expect(session.getStatus().closedBy).toBe('runtime-close');

    let applySettled = false;
    void applyPromise.then(() => {
      applySettled = true;
    });
    expect(applySettled).toBe(false); // FIFO：barrier 之前 apply 必须先结算

    blocker.release(); // 放行 apply R6 → 槽释放 → close barrier 结算
    await closePromise; // barrier 在全部已接纳任务之后结算（INV-C4）
    const applyResult = await applyPromise;
    expect(applyResult).toMatchObject({ ok: true }); // 已接纳任务无条件排空（ADR-0008）
    expect(handle.doc.getMap('ROOT').get('n')).toBe(42); // 集成确实生效
    expect(blocker.calls()).toBe(2); // 恰一次 apply 通知（无重复/无跳过）

    // close 之后的 apply：runtime-close 接纳拒绝（A-c）
    const after = await session.applyRemoteUpdate(diff);
    expect(after).toMatchObject({ ok: false, code: 'RUNTIME_WRITE_DISABLED' });

    // 记录面：in-flight apply 的 committed 记录照发（emit 不因 close 被吞）
    const recs = await waitAttempt(log, 3); // enable + in-flight apply + after-close A-c
    const applyRecs = recs.filter((r) => r.operation === 'replication-apply');
    expect(applyRecs).toHaveLength(2);
    expect(applyRecs[0]).toMatchObject({
      stage: 'transaction',
      result: { kind: 'committed', effect: 'update' },
    });
    expect(applyRecs[1]).toMatchObject({
      stage: 'acceptance',
      code: 'RUNTIME_WRITE_DISABLED',
      result: { kind: 'rejected' },
    });
    expect(handle.releaseCalls).toBe(1); // close barrier release 恰一次
  });

  it('重点 4（F1 修复后）：无 emitter 基线 enable/bump/apply 三面行为等价 sweep（§3/§13.5）', async () => {
    const bare = await runSweepSequence(await makeFixture(false)); // 生产默认：无诊断
    const logged = await runSweepSequence(await makeFixture(true)); // 有日志装配

    // 结果联合逐项一致（日志装配不改变业务结果）
    expect(bare.enableResult).toEqual(logged.enableResult);
    expect(bare.bumpResult).toEqual(logged.bumpResult);
    expect(bare.applyIntegrated).toEqual(logged.applyIntegrated);
    expect(bare.applyNoop).toEqual(logged.applyNoop);
    expect(bare.applyFenced).toEqual(logged.applyFenced);

    // saveCalls 轨迹一致（notifyDirty 触发面一致：enable E6 / bump E6 / apply R6 有集成；
    // 空 diff apply 零通知（R-3.1）；fenced apply 零通知）
    expect(bare.saveCallsAfterEachStep).toEqual([1, 2, 3, 3, 4, 4]);
    expect(logged.saveCallsAfterEachStep).toEqual(bare.saveCallsAfterEachStep);

    // 最终业务状态一致（ROOT 集成 / META 身份与 epoch）
    expect(logged.rootN).toBe(42);
    expect(bare.rootN).toBe(logged.rootN);
    expect(bare.metaId).toBe(REPLICATION_ID);
    expect(logged.metaId).toBe(bare.metaId);
    expect(bare.metaEpoch).toBe(3); // enable=1 → bump → 2 → bump → 3
    expect(logged.metaEpoch).toBe(bare.metaEpoch);

    // 拒绝码分野在两基线同构（identity fence）
    expect(bare.applyFenced).toMatchObject({ ok: false, code: 'REPLICATION_EPOCH_CONFLICTED' });
    expect(logged.applyFenced).toMatchObject({ ok: false, code: 'REPLICATION_EPOCH_CONFLICTED' });
  });
});

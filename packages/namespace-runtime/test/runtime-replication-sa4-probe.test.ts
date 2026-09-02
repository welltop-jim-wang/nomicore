/**
 * [SA4 owned] issue #151 静态验尸复现探针（Phase 3 static review）。
 *
 * 本文件是 SA4 审查报告
 * `wiki/raw/task_trusted-replication-management-diagnostic-change-log_sa4_review.md`
 * 的可执行证据，复现两个实现缺陷（对照 SA1 设计 §9.1/§2-D-6/R-3.1/§3/§13.5）：
 *
 * - 探针 A（P0）：诊断 emitter 未装配（生产默认——createNamespaceRuntime 无 seam）
 *   时，apply 槽 R6 的 notifyDirty 门控（R-3.1「捕获窗口零字节 ⇒ 跳过」）依赖
 *   **diag 条件**的 update 订阅窗口：无 emitter ⇒ handler 未挂 ⇒ capturedUpdate
 *   恒 undefined ⇒ **一切成功 apply 均跳过 notifyDirty**——复制写入永不经
 *   saveDoc 落盘（静默持久化丢失），且「日志缺席改变业务行为」直接违反设计 §3
 *   补充隔离 / §13.5「无日志基线行为等价」与 AC4/SA8 钉死 #5。
 *   期望（设计契约）：有真实集成的 apply 在无 emitter 基线同样触发 notifyDirty。
 *
 * - 探针 B（P1）：enable 槽 E3 校验**成功**后未把 diag.input 置为
 *   `{snapshot:{replicationId}}`（对照 ROOT 槽 S3 成功的 diagInputReady 先例与设计
 *   §9.1 表 E-f…E-k 六行 input=snapshot）——E4/E5/E6 一切结局点的记录面
 *   input.capture 谎报 'not-accessed'（「拒绝先于任何输入访问」），committed
 *   记录携带 not-accessed 属设计 §9.3 表头注明文的契约违规（同源禁则）。
 *   期望（设计契约）：enable committed 记录 input.capture === 'full' 且
 *   value === {replicationId}（inputPolicy 'full' 下）。
 *
 * 两探针在 SA3 修复后应转绿；断言全部锚定运行时可观察行为（saveCalls 计数 /
 * 诊断 record 内容），无源码 grep。
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
  constructor(
    readonly owner: User,
    readonly docId: string,
    readonly doc: Y.Doc,
  ) {}
  getStatus(): 'ready' {
    return 'ready';
  }
  release(): Promise<void> {
    return Promise.resolve();
  }
}

class CountingPersistence implements DocPersistence {
  saveCalls = 0;
  constructor(private readonly doc: Y.Doc) {}
  async createDoc(owner: User, docId: string, _doc: Y.Doc): Promise<DocHandle> {
    void docId;
    void _doc;
    return new StubHandle(owner, NAMESPACE_ID, this.doc);
  }
  async loadDoc(): Promise<DocHandle | null> {
    return null;
  }
  async saveDoc(): Promise<void> {
    this.saveCalls += 1;
  }
}

interface BareFixture {
  runtime: NamespaceRuntime;
  handle: DocHandle;
  persistence: CountingPersistence;
}

/** 无诊断 seam 装配（生产默认基线——emitter 缺席）。notifyDirty = persistence.saveDoc。 */
async function makeBareFixture(): Promise<BareFixture> {
  const doc = makeDoc();
  const persistence = new CountingPersistence(doc);
  const handle = await persistence.createDoc(OWNER, NAMESPACE_ID, doc);
  const runtime = createNamespaceRuntimeWithSeam({
    handle,
    notifyDirty: () => persistence.saveDoc(),
  } as never) as unknown as NamespaceRuntime;
  await expect
    .poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 })
    .toBe('ready');
  return { runtime, handle, persistence };
}

describe('[SA4 probe] #151 无诊断基线与 enable input 快照（设计 §3/§9.1 契约）', () => {
  it('探针 A：emitter 未装配时，有真实集成的 apply 仍必须触发 notifyDirty（R-3.1 判据 ≠ 诊断装配）', async () => {
    const fixture = await makeBareFixture();
    const { runtime, handle } = fixture;

    // enable：E6 无条件 notifyDirty（无 emitter 基线亦然）→ saveCalls=1（对照组：
    // enable/bump 的 dirty 通知不依赖诊断装配）
    const enable = await runtime.enableReplication({ replicationId: REPLICATION_ID });
    expect(enable).toMatchObject({ ok: true });
    expect(fixture.persistence.saveCalls).toBe(1);

    // 经 runtime internal 面开会话（与 lease 薄通道同一 core 入口）
    const opened = openReplicationSessionCoreForRegistry(runtime, {
      localRole: 'peer',
      remoteInstanceId: REMOTE_HUB_ID,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error('unreachable');
    const core = opened.core;

    // 构造「远端」真实增量（红灯契约 buildRemoteDiff 同款）：对基态副本改
    // ROOT.n → 42，以基态 state vector 求增量——应用后必然产生集成（非空 diff）
    const baseState = Y.encodeStateAsUpdate(handle.doc);
    const remote = new Y.Doc();
    Y.applyUpdate(remote, baseState);
    remote.getMap('ROOT').set('n', 42);
    const baseDoc = new Y.Doc();
    Y.applyUpdate(baseDoc, baseState);
    const diff = Y.encodeStateAsUpdate(remote, Y.encodeStateVector(baseDoc));

    const before = handle.doc.getMap('ROOT').get('n');
    const res = await core.applyRemoteUpdate(diff);
    expect(res).toMatchObject({ ok: true });
    // 集成确已发生（排除「空 diff ⇒ noop ⇒ 跳过 R6」的合法路径）
    expect(handle.doc.getMap('ROOT').get('n')).toBe(42);
    expect(before).not.toBe(42);

    // 【设计 §2/§9.3 A-j + §3 补充隔离】：有集成 ⇒ 必须 notifyDirty——无 emitter
    // 基线不得改变业务持久化行为。缺陷实现：saveCalls 停在 1。
    expect(fixture.persistence.saveCalls).toBe(2);
  });

  it('探针 B：enable committed 记录的 input 必须是已捕获快照（capture full + replicationId），不得谎报 not-accessed', async () => {
    const log: BoundedMemoryDiagnosticLog = createBoundedMemoryDiagnosticLog({
      inputPolicy: 'full',
      updateCapture: true,
    });
    const doc = makeDoc();
    const persistence = new CountingPersistence(doc);
    const handle = await persistence.createDoc(OWNER, NAMESPACE_ID, doc);
    const runtime = createNamespaceRuntimeWithSeam({
      handle,
      notifyDirty: () => persistence.saveDoc(),
      diagnosticEmitter: log.emitter,
      clock: () => 1_700_000_000_000,
    } as never) as unknown as NamespaceRuntime;
    await expect
      .poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 })
      .toBe('ready');

    const res = await runtime.enableReplication({ replicationId: REPLICATION_ID });
    expect(res).toMatchObject({ ok: true });

    await expect
      .poll(() => log.records().filter((r) => r.recordKind === 'attempt').length, { interval: 5, timeout: 3_000 })
      .toBe(1);
    const rec = log.records().find((r): r is AttemptRecord => r.recordKind === 'attempt');
    if (rec === undefined) throw new Error('attempt record 缺失');

    // 设计 §9.1 E-i：E3 成功捕获 ⇒ input = snapshot（record 面 full + value）
    expect(rec.input).toMatchObject({ capture: 'full' });
    expect(rec.input).toMatchObject({ value: { replicationId: REPLICATION_ID } });
  });
});

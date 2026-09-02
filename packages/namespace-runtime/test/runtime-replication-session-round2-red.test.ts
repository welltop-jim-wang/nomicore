/**
 * SA6 红灯锚定（Round 2 修订轮）— 评审 12 项的红/Lock 契约锚（issue #134，PR #146）：
 *
 *   R2-1 epoch fence 立即停投（bump 槽边界主动 fence——不等下一次 inbound apply）；
 *   R2-2 Runtime close 同步段终止并摘除 sessions（终态 + 存量 listener 零投递 +
 *        已接纳 apply 先于 close barrier 排空的确定性 FIFO）；
 *   R2-3 fanout 投递非阻塞（慢 listener 不阻塞 transaction/sequencer 槽）+ 队列溢出
 *        needs-resync 可观测（ADR 0010 L113）；
 *   R2-4 受保护字段内容投影相等支持合法结构值（规范化深比较）——仅改 ROOT 放行、
 *        真改受保护结构值仍拒；
 *   R2-6 applyUpdate 异常 committed 诚实（beforeTransaction 抛错零 mutation →
 *        committed:false；afterTransaction 抛错 mutation 已发生 → committed:true）；
 *   R2-7 no-op/重复 update 成功 apply 后 rootValidation/memoryCaughtUp 置位
 *        （SA8 放行方向「成功接纳即置位」——绿锁定）；
 *   R2-10 owned bytes 加严：listener 直存 callback 原始参数，断言每投递数组独立且
 *         buffer 不共享（byteOffset/length/底 buffer identity 层面）。
 *
 * 规范权威：ADR-0010 issue #134 round-2 修订节；设计记录（历史证据，非规范）：
 * wiki/raw/task_namespace-lease-replication-session_round2.md（评审全文 +
 * AC-R2 映射）；round2_conflict_report（verdict: clear；R2-1/R2-2 放行方向与登记义务
 * D-1/D-2a/D-2b/D-3/D-4）；round2_relevant_decisions（R2-3/R2-4/R2-6/R2-7 裁决增量）。
 *
 * 红灯纪律：真实 Yjs / 真实 Runtime（经包内 seam createNamespaceRuntimeWithSeam）/
 * 真实 vfsl 编译；零源码 grep 断言；一切拒绝经返回 Promise 结算断言；零真实 sleep
 * （时序探针除外——R2-3 用有界同步自旋 + 宽裕墙钟阈值，禁 real sleep）；
 * 预期当前代码必红的用例在标题标注「必红」，预期直接绿的锁定用例标注「绿锁定」。
 *
 * 本文件与 round-1 runtime-replication-session.test.ts 并列（新红灯套件独立文件）；
 * round-1 文件仅做 R2-10 允许范围内的 listener 原始参数改造（见该文件头注）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, DocHandleStatus, User } from '@nomicore/persistence';
import { RuntimeWriteFatalError } from '../src/index.js';
import type { NamespaceRuntime } from '../src/index.js';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import { openReplicationSessionCoreForRegistry } from '../src/replication-session.js';
import type {
  RuntimeReplicationSessionApplyResult,
  RuntimeReplicationSessionCore,
  RuntimeReplicationSessionStatus,
} from '../src/replication-session.js';

// ─────────────────────────────── fixture（round-1 同款自包含） ───────────────────────────────

const OWNER: User = { userId: 'u-alice' };
const TEXT_VALID =
  'type ROOT = { n: number; a?: string; ext?: number; k1?: number; k2?: number; k3?: number; };\n';
const ENVELOPE = { lang: 'vfsl', version: 1, id: 'ns-r2', text: TEXT_VALID } as const;
const REP_ID = 'b'.repeat(32);

/** 种子文档：SCHEMA 信封 + META（docId/createdAt + 复制保留字段——默认已启用）。 */
function seedDoc(opts: { epoch?: number; enabled?: boolean; metaExtra?: (meta: Y.Map<unknown>) => void } = {}): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
  const meta = doc.getMap('META');
  meta.set('docId', 'ns-r2');
  meta.set('createdAt', 1_700_000_123_456);
  if (opts.enabled !== false) {
    meta.set('replicationId', REP_ID);
    meta.set('replicationEpoch', opts.epoch ?? 1);
  }
  opts.metaExtra?.(meta);
  doc.getMap('ROOT').set('n', 1);
  return doc;
}

interface RuntimeHarness {
  readonly runtime: NamespaceRuntime;
  notifyCount(): number;
  setStatus(f: () => DocHandleStatus): void;
}

function makeRuntime(
  doc: Y.Doc,
  opts: { bindNotify?: boolean; notifyDirty?: () => Promise<void>; setStatus?: (f: () => DocHandleStatus) => void } = {},
): RuntimeHarness {
  let notifyCount = 0;
  let statusFn: () => DocHandleStatus | undefined = () => undefined;
  const notifyDirty = opts.bindNotify === false ? undefined : async () => {
    notifyCount += 1;
    if (opts.notifyDirty !== undefined) await opts.notifyDirty();
  };
  const handle = {
    owner: OWNER,
    docId: 'ns-r2',
    doc,
    getStatus: () => statusFn() ?? 'ready',
    release: async () => {},
  } as unknown as DocHandle;
  const runtime = createNamespaceRuntimeWithSeam({
    handle,
    ...(notifyDirty !== undefined ? { notifyDirty } : {}),
  });
  return {
    runtime,
    notifyCount: () => notifyCount,
    setStatus: (f) => {
      statusFn = f;
    },
  };
}

async function readyOf(runtime: NamespaceRuntime): Promise<void> {
  await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
}

function openSession(
  runtime: NamespaceRuntime,
  role: 'hub' | 'peer' = 'hub',
  remoteInstanceId = 'peer-a',
): RuntimeReplicationSessionCore {
  const opened = openReplicationSessionCoreForRegistry(runtime, { localRole: role, remoteInstanceId });
  if (!opened.ok) throw new Error(`open 应成功，实际 ${JSON.stringify(opened)}`);
  return opened.core;
}

/** 生成「远端实例状态更新」：live 全量 bootstrap + 新键写入（零并发冲突——确定性）。 */
function makeRemoteUpdate(liveDoc: Y.Doc, mutate: (doc: Y.Doc) => void): { update: Uint8Array; replica: Y.Doc } {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(liveDoc));
  mutate(peer);
  return { update: Y.encodeStateAsUpdate(peer), replica: peer };
}

type Settled = { kind: 'resolved'; value: unknown } | { kind: 'rejected'; reason: unknown };

async function settleOf(p: Promise<unknown>): Promise<Settled> {
  try {
    return { kind: 'resolved', value: await p };
  } catch (reason) {
    return { kind: 'rejected', reason };
  }
}

async function flushMicrotasks(budget = 60): Promise<void> {
  for (let i = 0; i < budget; i += 1) await Promise.resolve();
}

function settledOk(s: Settled): boolean {
  return s.kind === 'resolved' && (s.value as { ok?: unknown }).ok === true;
}

function expectRefusal(settled: Settled, code: string): void {
  expect(settled.kind, `期望 resolved（拒绝经返回 Promise 结算），实际 ${settled.kind}`).toBe('resolved');
  if (settled.kind !== 'resolved') throw new Error('unreachable');
  const v = settled.value as { ok?: unknown; code?: unknown; message?: unknown };
  expect(v.ok).toBe(false);
  expect(v.code).toBe(code);
  expect(typeof v.message).toBe('string');
  expect(JSON.stringify(v)).toContain(code);
}

/** 有界同步自旋（R2-3 慢 listener 时序探针；有界——绝不影响测试进程终局）。 */
function busySpinMs(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* 同步自旋：模拟慢/不返回 listener 的阻塞面 */
  }
}

// ═══════════════════════════════ R2-1：epoch fence 立即停投 ═══════════════════════════════

describe('R2-1 epoch fence 立即停投（bump 槽边界主动 fence——不等下一次 inbound apply）', () => {
  it('bump settle 后（无下一次 inbound apply）旧 session listener 对后续本地写零投递【必红】', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session1 = openSession(runtime, 'hub', 'peer-a');
    const events1: Uint8Array[] = [];
    session1.subscribeOwnedUpdates((u) => events1.push(u)); // R2-10 纪律：直存原始参数

    // 基线：bump 前本地写投递给存量 listener（证明扇出链路活着）
    expect((await runtime.mutateData({ op: 'set', path: ['n'], value: 7 })).ok).toBe(true);
    await flushMicrotasks();
    expect(events1.length).toBe(1);

    // bump（不得有下一次 inbound apply 作为 fence 触发面）
    expect((await runtime.bumpReplicationEpoch()).ok).toBe(true);
    const afterBump = events1.length;

    // 契约：bump 槽 settle 后，旧 session listener 对任何新本地写零投递
    expect((await runtime.mutateData({ op: 'set', path: ['n'], value: 8 })).ok).toBe(true);
    await flushMicrotasks();
    expect(events1.length, 'bump 后（无 inbound apply）存量 listener 仍收到投递——fence 未立即生效').toBe(afterBump);
  });

  it('bump settle 后旧 session getStatus 转 conflicted（fence 可观测；当前保持 open）【必红】', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session1 = openSession(runtime, 'hub', 'peer-a');
    expect(session1.getStatus().state).toBe('open');

    expect((await runtime.bumpReplicationEpoch()).ok).toBe(true);

    const st = session1.getStatus();
    expect(st.replicationEpoch).toBe(1); // 冻结值不漂移
    expect(st.currentEpoch).toBe(2); // fence 可观测
    expect(st.state, 'bump 后旧 session 未转 conflicted（需下一次 inbound apply 才 fence）').toBe('conflicted');
  });

  it('FIFO 锁定：apply A → bump → apply B 严格按序结算；A 落盘、B 被 fence 零写入【绿锁定】', async () => {
    const doc = seedDoc();
    const { runtime, notifyCount } = makeRuntime(doc);
    await readyOf(runtime);
    const session1 = openSession(runtime, 'hub', 'peer-a');
    const { update: uA } = makeRemoteUpdate(doc, (peer) => {
      peer.getMap('ROOT').set('k1', 1);
    });
    const { update: uB } = makeRemoteUpdate(doc, (peer) => {
      peer.getMap('ROOT').set('k2', 2);
    });

    const order: string[] = [];
    const pA = session1.applyRemoteUpdate(uA).then((r) => {
      order.push('applyA');
      return r;
    });
    const pBump = runtime.bumpReplicationEpoch();
    void pBump.then(() => order.push('bump'));
    const pB = session1.applyRemoteUpdate(uB).then((r) => {
      order.push('applyB');
      return r;
    });

    const rA = await settleOf(pA);
    expect(settledOk(rA), 'applyA（epoch 1）必须成功').toBe(true);
    const rb = await settleOf(pBump);
    expect(rb.kind).toBe('resolved');
    if (rb.kind !== 'resolved') throw new Error('unreachable');
    expect((rb.value as { ok?: unknown }).ok).toBe(true);
    const rB = await settleOf(pB);
    expectRefusal(rB, 'REPLICATION_EPOCH_CONFLICTED');
    expect(order, '严格 FIFO：[applyA, bump, applyB]').toEqual(['applyA', 'bump', 'applyB']);
    expect(doc.getMap('ROOT').get('k1')).toBe(1); // A 落盘
    expect(doc.getMap('ROOT').get('k2')).toBeUndefined(); // B 零写入
    expect(runtime.getStatus().replication).toMatchObject({ state: 'enabled', replicationEpoch: 2 });
    expect(notifyCount()).toBe(2); // A 槽 + bump 槽（E6 登记 META dirty）各一次
  });
});

// ═══════════════════════════════ R2-2：Runtime close 终止 sessions ═══════════════════════════════

describe('R2-2 Runtime close 同步段终止并摘除 sessions（ADR 0008 L93 session 面等价物）', () => {
  it('Runtime close 后既有 session getStatus 进入终态（非 open；当前保持 open）【必红】', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session1 = openSession(runtime, 'hub', 'peer-a');
    expect(session1.getStatus().state).toBe('open');

    await runtime.close();

    const st = session1.getStatus();
    expect(st.state, 'Runtime close 后 session 仍为 open（close 只切 lifecycle，未终止 session）').not.toBe('open');
  });

  it('Runtime close 后存量 listener 对后续 doc 写零投递（fanout 摘除；当前仍投递）【必红】', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session1 = openSession(runtime, 'hub', 'peer-a');
    const events1: Uint8Array[] = [];
    session1.subscribeOwnedUpdates((u) => events1.push(u));

    // 基线：close 前本地写投递
    expect((await runtime.mutateData({ op: 'set', path: ['n'], value: 7 })).ok).toBe(true);
    await flushMicrotasks();
    expect(events1.length).toBe(1);

    await runtime.close();
    const afterClose = events1.length;

    // close 后 doc 上的任何本地写（origin null）都不得再投给存量 listener
    doc.getMap('ROOT').set('k9', 9); // 直接 doc 写：模拟 sequencer 层本地写（未经公共 gate）
    await flushMicrotasks();
    expect(events1.length, 'Runtime close 后存量 listener 仍收到投递（session channel 未摘除）').toBe(afterClose);
  });

  it('已接纳 apply 先于 close barrier 排空：在途 apply 完成、close 后 settle（FIFO 确定性序——绿锁定）', async () => {
    const doc = seedDoc();
    let releaseNotify: () => void = () => {};
    const notifyGate = new Promise<void>((resolve) => {
      releaseNotify = resolve;
    });
    const { runtime } = makeRuntime(doc, { notifyDirty: () => notifyGate });
    await readyOf(runtime);
    const session1 = openSession(runtime, 'hub', 'peer-a');

    const order: string[] = [];
    const applyP = session1.applyRemoteUpdate(
      makeRemoteUpdate(doc, (peer) => {
        peer.getMap('ROOT').set('k1', 1);
      }).update,
    );
    void applyP.then(() => order.push('apply'));
    const closeP = runtime.close();
    void closeP.then(() => order.push('close'));

    await flushMicrotasks(80);
    expect(order, 'notify 门未放行前：apply（在途）与 close barrier 均未 settle').toEqual([]);

    releaseNotify();
    const applied = await settleOf(applyP);
    expect(settledOk(applied), 'close 前已接纳 apply 必须照常完成（无条件排空）').toBe(true);
    await closeP;
    expect(order, 'FIFO：已接纳 apply 先于 close barrier 结算').toEqual(['apply', 'close']);
    expect(doc.getMap('ROOT').get('k1')).toBe(1); // 在途 apply 落盘
  });
});

// ═══════════════════════════════ R2-3：非阻塞投递 + needs-resync ═══════════════════════════════

describe('R2-3 fanout 投递非阻塞（owned bytes 复制 + 有界异步队列 + 溢出 needs-resync 契约）', () => {
  it('慢 listener（同步自旋 400ms）不阻塞本地 mutateData 槽 settle（当前随 listener 同步阻塞）【必红】', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session1 = openSession(runtime, 'hub', 'peer-a');
    session1.subscribeOwnedUpdates(() => {
      busySpinMs(400); // 慢/不返回 listener 的确定性替身
    });

    const t0 = performance.now();
    const w = await runtime.mutateData({ op: 'set', path: ['n'], value: 5 });
    const elapsed = performance.now() - t0;

    expect(w.ok).toBe(true);
    expect(doc.getMap('ROOT').get('n')).toBe(5); // transaction 已返回（先于慢 listener 完成的证明面）
    expect(elapsed, `mutateData 槽被慢 listener 同步阻塞（耗时 ${Math.round(elapsed)}ms ≥ 400ms）`).toBeLessThan(250);

    // R2.2 发现 2 / 裁决 3(a)（§4.3(d) 测试隔离义务）：spin fixture 收尾——close 终止
    // channel + 清队 ⇒ 自延伸泵于下一让步点退出，零跨测试泄漏（断言零改动）
    await session1.close();
  });

  it('慢 listener 不阻塞 apply 槽与后续 sequencer 槽 settle（跨 channel——回声抑制面）【必红】', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const sessionA = openSession(runtime, 'hub', 'peer-a'); // apply 源（回声抑制——自身 channel 不投）
    const sessionB = openSession(runtime, 'hub', 'peer-b'); // 慢消费者所在 channel
    sessionB.subscribeOwnedUpdates(() => {
      busySpinMs(400);
    });

    const { update } = makeRemoteUpdate(doc, (peer) => {
      peer.getMap('ROOT').set('ext', 7);
    });
    const t0 = performance.now();
    const applied = await settleOf(sessionA.applyRemoteUpdate(update));
    const t1 = performance.now();
    expect(settledOk(applied)).toBe(true);
    expect(doc.getMap('ROOT').get('ext')).toBe(7);
    expect(t1 - t0, `apply 槽被慢 listener 同步阻塞（耗时 ${Math.round(t1 - t0)}ms）`).toBeLessThan(250);

    // 后续 sequencer 槽（同 namespace 下一项）同样不被阻塞
    const t2 = performance.now();
    const w = await runtime.mutateData({ op: 'set', path: ['n'], value: 6 });
    const t3 = performance.now();
    expect(w.ok).toBe(true);
    expect(t3 - t2, `后续 sequencer 槽被慢 listener 同步阻塞（耗时 ${Math.round(t3 - t2)}ms）`).toBeLessThan(250);

    // R2.2 发现 2 / 裁决 3(a)（§4.3(d) 测试隔离义务）：spin fixture 收尾——两 session
    // 均 close（B 为慢泵源、A 为 apply 源），终止 channel + 清队，零跨测试泄漏
    await sessionA.close();
    await sessionB.close();
  });

  it('溢出可观测：慢消费者 + 突发写 → 该 channel 标 needs-resync；突发槽零阻塞（ADR 0010 L113）【必红】', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session1 = openSession(runtime, 'hub', 'peer-a');
    session1.subscribeOwnedUpdates(() => {
      busySpinMs(15); // 每次投递 15ms——吞吐远低于突发频率
    });

    const t0 = performance.now();
    for (let i = 0; i < 64; i += 1) {
      const w = await runtime.mutateData({ op: 'set', path: ['k1'], value: i });
      expect(w.ok).toBe(true);
    }
    const elapsed = performance.now() - t0;

    // ① 溢出可观测（当前实现无队列 ⇒ 无 needs-resync 标记——可观测面缺失）
    const status = session1.getStatus() as unknown as { needsResync?: boolean };
    expect(status.needsResync, '慢消费者突发投递后未见 needs-resync 可观测标记（队列溢出契约）').toBe(true);
    // ② 投递零阻塞：64 个槽的总耗时远小于同步阻塞下的 64×15ms（当前 ≈ 960ms+）
    expect(elapsed, `突发 64 槽总耗时 ${Math.round(elapsed)}ms——槽被同步阻塞`).toBeLessThan(400);

    // R2.2 发现 2 / 裁决 3(a)（§4.3(d) 测试隔离义务）：spin fixture（15ms 同款义务）
    // 收尾——close 终止 channel + 清队（含溢出遗留排队项），零跨测试泄漏
    await session1.close();
  });
});

// ═══════════════════════════════ R2-4：受保护字段结构值（规范化深比较） ═══════════════════════════════

describe('R2-4 受保护字段内容投影相等支持合法结构值（ADR 0008 L31 plain value 值域）', () => {
  it('META 含合法 object/array 值：仅改 ROOT 的 raw update 必须放行（当前非 primitive 恒判变 → 误拒）【必红】', async () => {
    const doc = seedDoc({
      metaExtra: (meta) => {
        meta.set('labels', ['a', 'b']); // 合法 JSON-compatible plain value（array）
        meta.set('extra', { foo: 1, bar: 'x' }); // 合法 plain value（object）
      },
    });
    const { runtime, notifyCount } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub', 'peer-a');

    const { update } = makeRemoteUpdate(doc, (peer) => {
      peer.getMap('ROOT').set('k1', 1); // 仅 ROOT —— 受保护字段零触碰
    });
    const applied = await settleOf(session.applyRemoteUpdate(update));
    expect(settledOk(applied), '受保护字段内容投影相等：未变化必须放行（ROOT-only update）').toBe(true);
    expect(doc.getMap('ROOT').get('k1')).toBe(1);
    expect(doc.getMap('META').get('replicationId')).toBe(REP_ID);
    expect(notifyCount()).toBe(1);
  });

  it('peer 方向：META 含结构值时 ROOT-only 更新同样放行（当前恒拒）【必红】', async () => {
    const doc = seedDoc({
      metaExtra: (meta) => {
        meta.set('labels', ['x', 'y']);
      },
    });
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'peer', 'hub-1');

    const { update } = makeRemoteUpdate(doc, (peer) => {
      peer.getMap('ROOT').set('ext', 7);
    });
    const applied = await settleOf(session.applyRemoteUpdate(update));
    expect(settledOk(applied), 'peer 收 hub update：META 结构值未变时 ROOT 更新必须放行').toBe(true);
    expect(doc.getMap('ROOT').get('ext')).toBe(7);
  });

  it('真改受保护结构值仍拒（绿锁定）：META 新增键（值为对象）→ 拒绝零写入', async () => {
    const doc = seedDoc({
      metaExtra: (meta) => {
        meta.set('labels', ['a', 'b']);
      },
    });
    const { runtime, notifyCount } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub', 'peer-a');

    const { update } = makeRemoteUpdate(doc, (peer) => {
      peer.getMap('META').set('blob', { x: 1 }); // 新键 —— 真正的受保护结构值变化
    });
    const r = await settleOf(session.applyRemoteUpdate(update));
    expectRefusal(r, 'REPLICATION_PROTECTED_FIELDS_CHANGED');
    expect(doc.getMap('META').get('blob')).toBeUndefined(); // 零写入
    expect(doc.getMap('ROOT').get('k1')).toBeUndefined();
    expect(notifyCount()).toBe(0);
  });
});

// ═══════════════════════════════ R2-6：committed 诚实 ═══════════════════════════════

describe('R2-6 applyUpdate 异常 committed 诚实（可判则精确——零 mutation 不得谎报 committed:true）', () => {
  it('beforeTransaction 抛错（零 mutation）：rejection committed:false + ROOT 零变更（当前恒 committed:true）【必红】', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub', 'peer-a');

    // hostile seam：live doc 的 beforeTransaction observer 抛错——yjs transact 的
    // emit 在事务函数执行之前 ⇒ 零 mutation（Yjs 无 rollback 面——只发生在事务前）
    doc.on('beforeTransaction', () => {
      throw new Error('hostile beforeTransaction (deterministic)');
    });

    const { update } = makeRemoteUpdate(doc, (peer) => {
      peer.getMap('ROOT').set('k1', 1);
    });
    const applied = await settleOf(session.applyRemoteUpdate(update));
    expect(applied.kind).toBe('rejected');
    if (applied.kind !== 'rejected') throw new Error('unreachable');
    expect(applied.reason).toBeInstanceOf(RuntimeWriteFatalError);
    const fatal = applied.reason as RuntimeWriteFatalError;
    expect(fatal.committed, '零 mutation 的 apply 异常不得谎报 committed:true（诚实区分）').toBe(false);
    expect(doc.getMap('ROOT').get('k1')).toBeUndefined(); // 零 mutation 事实
    expect(doc.getMap('ROOT').get('n')).toBe(1);
    expect(runtime.getStatus().fatal).not.toBeNull(); // 保守 fatal 纪律（不补偿、不回滚、不静默）
  });

  it('afterTransaction observer 抛错（mutation 已发生）：rejection committed:true + mutation 保留（绿锁定）', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub', 'peer-a');

    doc.on('afterTransaction', () => {
      throw new Error('hostile afterTransaction (deterministic)');
    });

    const { update } = makeRemoteUpdate(doc, (peer) => {
      peer.getMap('ROOT').set('k1', 1);
    });
    const applied = await settleOf(session.applyRemoteUpdate(update));
    expect(applied.kind).toBe('rejected');
    if (applied.kind !== 'rejected') throw new Error('unreachable');
    expect(applied.reason).toBeInstanceOf(RuntimeWriteFatalError);
    expect((applied.reason as RuntimeWriteFatalError).committed).toBe(true);
    expect(doc.getMap('ROOT').get('k1')).toBe(1); // mutation 事实保留（committed:true 诚实）
  });
});

// ═══════════════════════════════ R2-7：no-op update 置位语义（成功接纳即置位） ═══════════════════════════════

describe('R2-7 no-op/重复 update 成功 apply：rootValidation/memoryCaughtUp 置位（SA8 放行方向「成功接纳即置位」）', () => {
  it('重复 update（内容已全部在场）apply 成功：仍置位且不回落（绿锁定）', async () => {
    const doc = seedDoc();
    const { runtime, notifyCount } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub', 'peer-a');
    expect(session.getStatus().rootValidation).toBe('none');
    expect(session.getStatus().durability.memoryCaughtUp).toBe(false);

    const { update } = makeRemoteUpdate(doc, (peer) => {
      peer.getMap('ROOT').set('k1', 1);
    });
    expect(settledOk(await settleOf(session.applyRemoteUpdate(update)))).toBe(true);
    // 重复投递同一 update（所有 struct 已在场——Y.applyUpdate 成功、零状态推进）
    const second = await settleOf(session.applyRemoteUpdate(update));
    expect(settledOk(second), 'no-op 重复 update：成功接纳（apply 成功后置位——无「且推进」限定）').toBe(true);

    const st = session.getStatus();
    expect(st.rootValidation).toBe('replication-unvalidated');
    expect(st.durability.memoryCaughtUp).toBe(true);
    expect(st.durability.diskCaughtUp).toBe(false); // 永不声称 durable（ADR 0010 L139）
    expect(notifyCount()).toBe(2); // 两次成功 apply 均登记 dirty（ADR 0006 #79 互证）
  });

  it('空效果 update（与 live 同状态的全量编码）apply 成功：同样置位（绿锁定）', async () => {
    const doc = seedDoc();
    const { runtime, notifyCount } = makeRuntime(doc);
    await readyOf(runtime);
    const session = openSession(runtime, 'hub', 'peer-a');

    // 同状态 bootstrap 后零新写：全量编码 = 内容全部已在场的 no-op update
    const noop = makeRemoteUpdate(doc, () => {
      /* 零 mutation——空效果 */
    });
    const applied = await settleOf(session.applyRemoteUpdate(noop.update));
    expect(settledOk(applied), '空效果 update 同样算作成功接纳（raw apply 成功）').toBe(true);
    expect(notifyCount()).toBe(1);
    const st = session.getStatus();
    expect(st.rootValidation).toBe('replication-unvalidated');
    expect(st.durability.memoryCaughtUp).toBe(true);
  });
});

// ═══════════════════════════════ R2-10：owned bytes 严格加严 ═══════════════════════════════

describe('R2-10 owned bytes：listener 直存 callback 原始参数，断言数组与 buffer 均不共享', () => {
  it('每投递 callback 原始参数独立：数组互异、byteOffset=0、length=全幅、底 buffer 不共享（绿锁定）', async () => {
    const doc = seedDoc();
    const { runtime } = makeRuntime(doc);
    await readyOf(runtime);
    const sessionA = openSession(runtime, 'hub', 'peer-a');
    const sessionB = openSession(runtime, 'hub', 'peer-b');
    const eventsA: Uint8Array[] = [];
    const eventsB: Uint8Array[] = [];
    sessionA.subscribeOwnedUpdates((u) => eventsA.push(u)); // 直存原始参数（不禁用 slice 防御）
    sessionB.subscribeOwnedUpdates((u) => eventsB.push(u));

    expect((await runtime.mutateData({ op: 'set', path: ['n'], value: 7 })).ok).toBe(true);
    expect((await runtime.mutateData({ op: 'set', path: ['n'], value: 8 })).ok).toBe(true);
    await flushMicrotasks();
    expect(eventsA.length).toBe(2);
    expect(eventsB.length).toBe(2);

    // 数组独立性：每投递（每 listener 每次）不是同一数组
    expect(eventsA[0]).not.toBe(eventsA[1]);
    expect(eventsA[0]).not.toBe(eventsB[0]);
    // byteOffset/length/底 buffer identity：全幅独立视图（共享底层 buffer 的 subarray 会
    // 表现为 byteOffset>0 或 buffer 恒等）
    for (const arr of [eventsA[0], eventsA[1], eventsB[0], eventsB[1]] as Uint8Array[]) {
      expect(arr.byteOffset).toBe(0);
      expect(arr.length).toBe(arr.buffer.byteLength);
    }
    expect((eventsA[0] as Uint8Array).buffer).not.toBe((eventsA[1] as Uint8Array).buffer);
    expect((eventsA[0] as Uint8Array).buffer).not.toBe((eventsB[0] as Uint8Array).buffer);
    expect((eventsA[1] as Uint8Array).buffer).not.toBe((eventsB[1] as Uint8Array).buffer);
    // 内容真值（不是空副本）
    const replay = new Y.Doc();
    Y.applyUpdate(replay, Y.encodeStateAsUpdate(makeReplica(doc)));
    Y.applyUpdate(replay, eventsA[1] as Uint8Array);
    expect(replay.getMap('ROOT').get('n')).toBe(8);
  });
});

function makeReplica(liveDoc: Y.Doc): Y.Doc {
  const r = new Y.Doc();
  Y.applyUpdate(r, Y.encodeStateAsUpdate(liveDoc));
  return r;
}

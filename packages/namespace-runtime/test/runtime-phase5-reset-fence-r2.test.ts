/**
 * R2 红线/矩阵测试 — issue #133 round-2（Phase 5: bootstrap import, archive, and
 * guarded replica reset）Runtime 侧 reset fence（设计 §3.4/§3.5；SA2 R3 红线 1/2）。
 *
 * 覆盖（设计 §6 必验面 + SA2 R2-1/R2-3 红线）：
 * - T0 公共面：十二键不变（non-enumerable fence 键，Object.keys 审计零漂移）、
 *   index 值导出面不变、beginResetFence 为 function；
 * - T1 FIFO 交错：bump 先于 fence 入队 → fence 采样到新 live 身份 →
 *   {kind:'mismatch'}（零 lifecycle/close 副作用——lifecycle 仍 ready、release 零调用）；
 * - T2 arm 后写接纳拒绝：匹配 arm 后 bumpReplicationEpoch 零入队即时
 *   RUNTIME_WRITE_DISABLED（META 字节不变）、普通 close() 与 startCloseAfterFence()
 *   返回同一 Promise（barrier 恰一次、release 恰一次）；
 * - T3 无自等待 + 槽后懒 barrier：readPersisted 挂起期间 beginResetFence 不结算；
 *   放行后顺序 = probe → armed → startCloseAfterFence → release；一切在有界
 *   微任务内结算（测试自身完成即证明无 fence/close 互等）；
 * - T4 fence 挂起期已接纳 mutation：生命周期仍 ready 期间被接纳的 bump 在 arm 后
 *   仍按 ADR-0008「已接纳任务无条件排空」执行（drain 语义），fence 不等待它——
 *   barrier 排空后才 release（顺序 = bump-notify → release）。
 *
 * 锚定纪律：真实 Runtime（包内确定性 seam createNamespaceRuntimeWithSeam——
 * 模块相对导入 ../src/runtime.js）；fake handle（getStatus/release 可观测）；
 * 零 real sleep；全部经微任务/受控 gate 驱动。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, DocHandleStatus } from '@nomicore/persistence';
import * as publicEntry from '../src/index.js';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import type { NamespaceRuntime } from '../src/runtime.js';

const ID_A = 'a'.repeat(32);
const ID_B = 'b'.repeat(32);
const NS_1 = 'ns-1';

const SCHEMA_ENVELOPE = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: NS_1,
  text: 'type ROOT = { n: number; };\n',
});

function makeDoc(opts: { replicationId?: string; replicationEpoch?: number } = {}): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(SCHEMA_ENVELOPE)) sc.set(k, v);
  const meta = doc.getMap('META');
  meta.set('docId', NS_1);
  meta.set('createdAt', 1_700_000_000_000);
  if (opts.replicationId !== undefined) meta.set('replicationId', opts.replicationId);
  if (opts.replicationEpoch !== undefined) meta.set('replicationEpoch', opts.replicationEpoch);
  doc.getMap('ROOT').set('n', 1);
  return doc;
}

interface HandleProbe {
  readonly handle: DocHandle;
  readonly releaseCalls: { count: number };
  readonly statuses: DocHandleStatus[];
}

function makeHandle(doc: Y.Doc): HandleProbe {
  const releaseCalls = { count: 0 };
  const statuses: DocHandleStatus[] = [];
  const handle: DocHandle = {
    owner: { userId: 'u-alice' },
    docId: NS_1,
    doc,
    getStatus: () => {
      const s: DocHandleStatus = 'ready';
      statuses.push(s);
      return s;
    },
    release: async () => {
      releaseCalls.count += 1;
      statuses.push('released');
    },
  };
  return { handle, releaseCalls, statuses };
}

interface RuntimeFixture {
  readonly runtime: NamespaceRuntime;
  readonly handle: DocHandle;
  readonly releaseCalls: { count: number };
  readonly notifyCalls: { count: number };
}

async function makeReadyRuntime(opts: { replicationId?: string; replicationEpoch?: number } = {}): Promise<RuntimeFixture> {
  const doc = makeDoc(opts);
  const probe = makeHandle(doc);
  const notifyCalls = { count: 0 };
  const runtime = createNamespaceRuntimeWithSeam({
    handle: probe.handle,
    notifyDirty: async () => {
      notifyCalls.count += 1;
    },
  });
  // 等待 P0 就绪（真实 vfsl compile 微任务链）
  for (let i = 0; i < 400 && runtime.getStatus().schema.state !== 'ready'; i += 1) {
    await Promise.resolve();
  }
  return { runtime, handle: probe.handle, releaseCalls: probe.releaseCalls, notifyCalls };
}

interface FenceRuntime {
  readonly beginResetFence: (
    expected: { replicationId: string; replicationEpoch: number },
    readPersisted: () => Promise<
      | { kind: 'found'; identity: { ok: true; value: { replicationId: string; replicationEpoch: number } } | { ok: false } }
      | { kind: 'missing' }
    >,
  ) => Promise<
    | { kind: 'mismatch' }
    | { kind: 'missing' }
    | { kind: 'armed'; startCloseAfterFence: () => Promise<void> }
  >;
}

function fenceOf(runtime: NamespaceRuntime): FenceRuntime {
  return runtime as unknown as FenceRuntime;
}

const expectedIdentity = (replicationId: string, replicationEpoch: number) =>
  ({ replicationId, replicationEpoch });

describe('T0：公共面不漂移——fence 以 non-enumerable 键挂载、index 值导出不变', () => {
  it('Object.keys(runtime) 恰十二键（fence 键不可枚举）；beginResetFence 为 function；index 值导出仍恰一键', async () => {
    const fx = await makeReadyRuntime();
    expect(Object.keys(fx.runtime).sort()).toEqual([
      'bumpReplicationEpoch',
      'close',
      'enableReplication',
      'getActiveSchema',
      'getMetadata',
      'getSchema',
      'getStatus',
      'mutateData',
      'namespaceId',
      'owner',
      'readData',
      'replaceSchema',
    ]);
    const desc = Object.getOwnPropertyDescriptor(fx.runtime, 'beginResetFence');
    expect(desc).toBeDefined();
    expect(desc!.enumerable).toBe(false);
    expect(typeof (fx.runtime as unknown as { beginResetFence?: unknown }).beginResetFence).toBe('function');
    expect(Object.keys(publicEntry).sort()).toEqual(['RuntimeWriteFatalError']);
  });
});

describe('T1：FIFO 交错——bump 先于 fence 入队 → 采样即新身份 → mismatch 零破坏', () => {
  it('bump(epoch2) 先结算、fence 采样 live=epoch2 → expected epoch1 → {kind:"mismatch"}；lifecycle 仍 ready、release 零调用', async () => {
    const fx = await makeReadyRuntime({ replicationId: ID_A, replicationEpoch: 1 });
    const bumpP = (fx.runtime as unknown as { bumpReplicationEpoch: () => Promise<{ ok: boolean }> }).bumpReplicationEpoch();
    // 同一同步段紧随入队：FIFO = [bump, fence]
    const fenceP = fenceOf(fx.runtime).beginResetFence(
      expectedIdentity(ID_A, 1),
      async () => ({ kind: 'found', identity: { ok: true, value: { replicationId: ID_A, replicationEpoch: 1 } } }),
    );
    expect(await bumpP).toEqual({ ok: true });
    const result = await fenceP;
    expect(result).toEqual({ kind: 'mismatch' });
    // 零破坏：lifecycle 无迁移、close 未发（release 零调用）、状态身份仍 enabled epoch2
    expect(fx.runtime.getStatus().lifecycle).toBe('ready');
    expect(fx.releaseCalls.count).toBe(0);
    expect(fx.runtime.getStatus().replication).toEqual({
      state: 'enabled',
      replicationId: ID_A,
      replicationEpoch: 2,
    });
  });
});

describe('T2：arm 后写接纳拒绝 + close/startCloseAfterFence 同一 Promise（barrier 恰一次）', () => {
  it('匹配 arm 后 bumpReplicationEpoch 零入队即时拒绝（META 字节不变）；close() 与 startCloseAfterFence() 同一 promise、release 恰一次', async () => {
    const fx = await makeReadyRuntime({ replicationId: ID_A, replicationEpoch: 1 });
    const fence = fenceOf(fx.runtime);
    const result = await fence.beginResetFence(
      expectedIdentity(ID_A, 1),
      async () => ({ kind: 'found', identity: { ok: true, value: { replicationId: ID_A, replicationEpoch: 1 } } }),
    );
    if (result.kind !== 'armed') throw new Error(`期望 armed，实际 ${JSON.stringify(result)}`);
    // arm 后（barrier 尚未创建）先试 bump：lifecycle gate 同步拒绝、零写入、零 notify
    const bumped = await (fx.runtime as unknown as { bumpReplicationEpoch: () => Promise<{ ok: boolean }> }).bumpReplicationEpoch();
    expect(bumped.ok).toBe(false);
    expect(fx.notifyCalls.count).toBe(0);
    expect(fx.runtime.getStatus().replication).toEqual({
      state: 'enabled',
      replicationId: ID_A,
      replicationEpoch: 1,
    });
    // 公共 close() 先到：创建 barrier；fence continuation 的 startCloseAfterFence 复用同一 promise
    const closeP = fx.runtime.close();
    const startP = result.startCloseAfterFence();
    expect(startP).toBe(closeP);
    expect(await closeP).toBeUndefined();
    expect(fx.releaseCalls.count).toBe(1);
    expect(fx.runtime.getStatus().lifecycle).toBe('closed');
    // 幂等：后续 close 仍同一 promise（INV-C2/C5）
    expect(fx.runtime.close()).toBe(closeP);
    expect(fx.releaseCalls.count).toBe(1);
  });

  it('fence continuation 先闭（startCloseAfterFence 先调）→ 公共 close() 返回同一 promise（普通 close 幂等，不建第二 barrier）', async () => {
    const fx = await makeReadyRuntime({ replicationId: ID_A, replicationEpoch: 1 });
    const result = await fenceOf(fx.runtime).beginResetFence(
      expectedIdentity(ID_A, 1),
      async () => ({ kind: 'found', identity: { ok: true, value: { replicationId: ID_A, replicationEpoch: 1 } } }),
    );
    if (result.kind !== 'armed') throw new Error('期望 armed');
    const startP = result.startCloseAfterFence();
    const closeP = fx.runtime.close();
    expect(closeP).toBe(startP);
    await closeP;
    expect(fx.releaseCalls.count).toBe(1);
  });
});

describe('T3：无自等待——readPersisted 挂起期 fence 不结算；放行后 probe→armed→barrier→release 有界结算', () => {
  it('gate 挂起：beginResetFence 不 resolve；放行：顺序 probe→armed→startCloseAfterFence→release', async () => {
    const fx = await makeReadyRuntime({ replicationId: ID_A, replicationEpoch: 1 });
    const events: string[] = [];
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => { releaseGate = resolve });
    const fenceP = fenceOf(fx.runtime).beginResetFence(
      expectedIdentity(ID_A, 1),
      async () => {
        await gate;
        events.push('probe');
        return { kind: 'found', identity: { ok: true, value: { replicationId: ID_A, replicationEpoch: 1 } } };
      },
    );
    // 挂起期：fence 未结算（外部 I/O 不结算是 liveness 事实——非 fence/close 互等）
    let settled = false;
    void fenceP.then(() => { settled = true; });
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(settled).toBe(false);
    expect(fx.releaseCalls.count).toBe(0);
    releaseGate();
    const result = await fenceP;
    if (result.kind !== 'armed') throw new Error('期望 armed');
    // 槽后懒 barrier：此刻才创建并启动；release 只在 barrier 槽内发生一次
    const closeP = result.startCloseAfterFence();
    await closeP;
    expect(fx.releaseCalls.count).toBe(1);
    expect(events).toEqual(['probe']);
    // 状态：closed；bump 仍被拒绝（admission gate）
    expect(fx.runtime.getStatus().lifecycle).toBe('closed');
  });

  it('mismatch 后公共 close 照常可发起（fence 未动 lifecycle——零破坏前提的 Runtime 侧验证）', async () => {
    const fx = await makeReadyRuntime({ replicationId: ID_A, replicationEpoch: 1 });
    const result = await fenceOf(fx.runtime).beginResetFence(
      expectedIdentity(ID_B, 1),
      async () => ({ kind: 'found', identity: { ok: true, value: { replicationId: ID_A, replicationEpoch: 1 } } }),
    );
    expect(result).toEqual({ kind: 'mismatch' });
    expect(fx.runtime.getStatus().lifecycle).toBe('ready');
    // 普通 close 仍完全可用（fence 未介入）
    const closeP = fx.runtime.close();
    await closeP;
    expect(fx.releaseCalls.count).toBe(1);
    expect(fx.runtime.getStatus().lifecycle).toBe('closed');
  });
});

describe('T4：fence 挂起期已接纳 mutation 按 ADR-0008 无条件排空（不等待 fence/不被 fence 等待）', () => {
  it('readPersisted 挂起期间 bump 被接纳（lifecycle 仍 ready）→ arm 后 bump 仍执行（drain）；顺序 = bump-notify → release；fence 不等待 bump', async () => {
    const fx = await makeReadyRuntime({ replicationId: ID_A, replicationEpoch: 1 });
    const events: string[] = [];
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => { releaseGate = resolve });
    const fenceP = fenceOf(fx.runtime).beginResetFence(
      expectedIdentity(ID_A, 1),
      async () => {
        await gate;
        events.push('probe');
        return { kind: 'found', identity: { ok: true, value: { replicationId: ID_A, replicationEpoch: 1 } } };
      },
    );
    // 挂起期接纳 bump（lifecycle 仍 ready → 入队；fence 之后执行）
    const bumpP = (fx.runtime as unknown as { bumpReplicationEpoch: () => Promise<{ ok: boolean }> }).bumpReplicationEpoch();
    await Promise.resolve();
    let fenceSettled = false;
    void fenceP.then(() => { fenceSettled = true; });
    releaseGate();
    const result = await fenceP;
    expect(fenceSettled).toBe(true);
    if (result.kind !== 'armed') throw new Error('期望 armed');
    // fence 不等待 bump：armed 已可观测，bump 仍在排空（槽内执行 notify）
    expect(await bumpP).toEqual({ ok: true });
    expect(fx.notifyCalls.count).toBe(1); // 已接纳 bump 按 ADR-0008 排空（含 notify）
    // barrier 在 bump 之后 → 排空 bump 后才 release
    const closeP = result.startCloseAfterFence();
    await closeP;
    expect(fx.releaseCalls.count).toBe(1); // barrier 恰一次 release（在 bump drain 后）
    expect(events).toEqual(['probe']);
    expect(fx.runtime.getStatus().replication).toEqual({
      state: 'enabled',
      replicationId: ID_A,
      replicationEpoch: 2,
    });
  });
});

/**
 * SA7 动态验证测试 — issue #90（SA4 静态验尸报告「动态审核重点」1/2/4 三项）。
 *
 * 验证对象：SA3 实现 commit 6cb6f17 的真实运行链路（非静态推断）。
 *
 * 覆盖的 SA4 动态审核重点：
 * - 重点 1（§6.2 #8 notifier 挂住双窗口）：
 *   · S6 成功路径挂住：live commit 已发生、槽停滞（完成信号永不产生）、后续写按
 *     FIFO 永排队（不结算、零输入访问）、read 照常观察已提交状态、无 fatal/无
 *     disabled 降级——「停滞而非静默跳过/降级」；
 *   · fatal committed:true 路径挂住：`status.fatal` 先于（永不送达的）rejection 可
 *     观测、pA 永 pending、提交值保留（不虚假回滚）、新调用因队列停滞（非 gate）
 *     不结算、best-effort notifier 恰一次（挂住的那次）；
 * - 重点 2（O1）：handle.getStatus() adapter 持续抛错——写槽统一 fatal
 *   （committed:false、phase 'write-slot-internal'）、公共 runtime.getStatus() 读面
 *   原样 throw（既有 #89 loud-throw 契约）、runtime.readData() 保留；
 * - 重点 4（深嵌套栈溢出收编）：200,000 层嵌套数组 → snapshotter 递归 RangeError 被
 *   收编为 ok:false（MUTATION_INPUT_NOT_PLAIN_DATA）——进程不崩、fatal 不置位
 *   （写能力不被永久禁用——防「深嵌套 → 永久禁写」DoS）、后续有效写照常成功。
 *
 * 断言纪律：全部经公共接缝（mutateData/read/getStatus/update 事件计数/state 字节/
 * notifier 调用计数/Proxy 输入访问计数）观测，不读实现内部。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, User } from '@nomicore/persistence';
import { RuntimeWriteFatalError } from '../src/index.js';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import type { NamespaceRuntime, MutateDataResult } from '../src/index.js';

// —— fixture（与 SA6 冻结测试同族的种子形状）——

const OWNER: User = { userId: 'u-alice' };
const TEXT_VALID = 'type ROOT = { n: number; a: string; };';
const ENVELOPE = { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_VALID } as const;
const ROOT0 = { n: 1, a: 'x' };
const SET_N = (value: unknown) => ({ op: 'set', path: ['n'], value });

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function stateBytes(doc: Y.Doc): number[] {
  return [...Y.encodeStateAsUpdate(doc)];
}

function countUpdates(doc: Y.Doc): { count: number } {
  const counter = { count: 0 };
  doc.on('update', () => {
    counter.count += 1;
  });
  return counter;
}

function readValue(runtime: NamespaceRuntime, path: readonly (string | number)[]): unknown {
  const read = runtime.readData(path);
  if (!read.ok) throw new Error(`读取应成功，实际 code=${read.code}`);
  return read.value;
}

async function settleOf(
  p: Promise<MutateDataResult>,
): Promise<{ kind: 'resolved'; value: MutateDataResult } | { kind: 'rejected'; reason: unknown }> {
  try {
    return { kind: 'resolved', value: await p };
  } catch (reason) {
    return { kind: 'rejected', reason };
  }
}

/** 挂住探测器：ms 后仍 pending → true（停滞语义断言；settle → false 并返回结算）。 */
async function stillPendingAfter(
  p: Promise<unknown>,
  ms: number,
): Promise<{ pending: boolean; settled?: 'resolved' | 'rejected' }> {
  let settled: 'resolved' | 'rejected' | undefined;
  const raced = await Promise.race([
    p.then(
      () => {
        settled = 'resolved';
        return 'settled' as const;
      },
      () => {
        settled = 'rejected';
        return 'settled' as const;
      },
    ),
    sleep(ms).then(() => 'timeout' as const),
  ]);
  if (raced === 'timeout') return { pending: true };
  if (settled !== undefined) return { pending: false, settled };
  throw new Error('stillPendingAfter 不变量破坏：settled 未随 settle 路径赋值');
}

/** 输入访问观测 Proxy（零 throw；任何 get/ownKeys/descriptor/has 计数）。 */
function makeAccessProbe(value: unknown): { probe: unknown; accesses: () => number } {
  const inner = { op: 'set', path: ['n'], value };
  let accesses = 0;
  const probe = new Proxy(inner, {
    get(target, key, receiver) {
      accesses += 1;
      return Reflect.get(target, key, receiver);
    },
    ownKeys(target) {
      accesses += 1;
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, key) {
      accesses += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    has(target, key) {
      accesses += 1;
      return Reflect.has(target, key);
    },
  });
  return { probe, accesses: () => accesses };
}

/** 可翻转 throw 的 fake handle（DV-2/O1：adapter 持续违约）。 */
function makeThrowingHandle(doc: Y.Doc): {
  handle: DocHandle;
  flipToThrow: () => void;
} {
  let broken = false;
  const handle = {
    owner: OWNER,
    docId: 'ns-1',
    doc,
    getStatus: () => {
      if (broken) throw new Error('adapter-boom: getStatus 契约违背');
      return 'ready' as const;
    },
    release: async () => {},
  } as unknown as DocHandle;
  return { handle, flipToThrow: () => { broken = true; } };
}

function seededDoc(): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
  doc.getMap('META').set('docId', 'ns-1');
  const root = doc.getMap('ROOT');
  for (const [k, v] of Object.entries(ROOT0)) root.set(k, v);
  return doc;
}

async function waitReady(runtime: NamespaceRuntime): Promise<void> {
  await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
}

const hasCode = (v: unknown, code: string): boolean => JSON.stringify(v).includes(code);

// —— DV-1a：S6 成功路径 notifier 永久挂住（SA4 动态重点 1 前半）——

describe('SA7 动态验证 — SA4 重点 1：notifier 挂住双窗口', () => {
  it('DV-1a S6 成功路径挂住：槽停滞、后续写永排队（非 disabled 结算）、read 照常、无 fatal 降级', async () => {
    const doc = seededDoc();
    let notifierCalls = 0;
    // 永不 resolve 的 notifier（挂住注入——设计 §6.2 #8 哲学：停滞而非静默 timeout）
    const neverNotify = (): Promise<void> => {
      notifierCalls += 1;
      return new Promise<void>(() => {});
    };
    const runtime = createNamespaceRuntimeWithSeam({ handle: makeThrowingHandle(doc).handle, notifyDirty: neverNotify });
    await waitReady(runtime);

    const updates = countUpdates(doc);
    const pA = runtime.mutateData(SET_N(9));
    const { probe, accesses } = makeAccessProbe(11);
    const pB = runtime.mutateData(probe); // 同 tick FIFO 排队第二笔
    await sleep(200); // 给足微任务/事件循环余量——若实现静默跳过/降级，此处即暴露

    // 事务已 live commit（S5 完成）：恰 1 次更新事件 + notifier 恰一次被调用
    expect(updates.count).toBe(1);
    expect(notifierCalls).toBe(1);
    // read 不进 sequencer：照常观察到调用瞬间已提交状态（挂住不影响读面）
    expect(readValue(runtime, ['n'])).toBe(9);

    // 槽停滞：pA 永不产生完成信号（完成信号 = live commit + dirty 登记两者）
    const aState = await stillPendingAfter(pA, 120);
    expect(aState.pending).toBe(true);
    // 后续写永排队：不结算（既不 ok:true 也不 ok:false/disabled——静默跳过即违例）
    const bState = await stillPendingAfter(pB, 120);
    expect(bState.pending).toBe(true);
    // B 未取得槽：输入零访问（Proxy 观测）、零额外 Y.Doc 写
    expect(accesses()).toBe(0);
    expect(updates.count).toBe(1);

    // 停滞 ≠ 降级：无 fatal、写能力观察面未被静默关闭
    const status = runtime.getStatus();
    expect(status.fatal).toBeNull();
    expect(status.rootWrite.enabled).toBe(true);
    expect(status.read.enabled).toBe(true);
  });

  it('DV-1b fatal committed:true 路径挂住：status.fatal 先于（永不送达的）rejection 可观测、pA 永 pending、提交值保留、新调用因队列停滞不结算', async () => {
    const doc = seededDoc();
    let notifierCalls = 0;
    const neverNotify = (): Promise<void> => {
      notifierCalls += 1;
      return new Promise<void>(() => {});
    };
    const runtime = createNamespaceRuntimeWithSeam({ handle: makeThrowingHandle(doc).handle, notifyDirty: neverNotify });
    await waitReady(runtime);

    // 触发 committed:true fatal：事务提交后 observer cleanup 逃逸（yjs 实证：提交不撤销）
    doc.getMap('ROOT').observe(() => {
      throw new Error('observer-boom');
    });

    const updates = countUpdates(doc);
    const pA = runtime.mutateData(SET_N(9));
    const { probe, accesses } = makeAccessProbe(11);
    const pB = runtime.mutateData(probe); // 已接纳未执行的后续写
    await sleep(200);

    // fatal 摘要先于（永不送达的）rejection 可观测——markWriteFatal 同步先行兑现
    const status = runtime.getStatus();
    expect(status.fatal).not.toBeNull();
    expect(status.fatal!.code).toBe('NSRT-FATAL-WRITE-INTERNAL');
    expect(status.rootWrite.enabled).toBe(false); // 写能力已永久禁用（观察面诚实）

    // 提交值保留（不虚假回滚）+ read 保留
    expect(readValue(runtime, ['n'])).toBe(9);
    expect(status.read.enabled).toBe(true);

    // committed:true → 槽内 best-effort notifyDirty 恰一次（挂住的那次）
    expect(notifierCalls).toBe(1);
    expect(updates.count).toBe(1);

    // pA 永 pending：原始 fatal rejection 被挂住的 best-effort notifier 阻断（设计内：
    // 停滞而非静默 timeout/吞没——信号由 status.fatal 承载）
    const aState = await stillPendingAfter(pA, 120);
    expect(aState.pending).toBe(true);

    // 新调用因队列停滞（非 S1 gate）不结算——若实现以 gate 立即结算 RUNTIME_WRITE_DISABLED
    // 则此处违例（区别于 SA6 冻结锚的正常通道：notifier 正常 resolve 时后续写经 gate 结算）
    const bState = await stillPendingAfter(pB, 120);
    expect(bState.pending).toBe(true);
    expect(accesses()).toBe(0); // 输入零访问（未取得槽）
    expect(updates.count).toBe(1); // 零额外 Y.Doc 写
  });
});

// —— DV-2：adapter 持续抛错（SA4 动态重点 2 / O1）——

describe('SA7 动态验证 — SA4 重点 2（O1）：getStatus adapter 持续抛错', () => {
  it('DV-2 写槽统一 fatal（committed:false / write-slot-internal）；runtime.getStatus 原样 throw；read 保留；队列后续写经 S1 gate 结算 disabled', async () => {
    const doc = seededDoc();
    const { handle, flipToThrow } = makeThrowingHandle(doc);
    let notifierCalls = 0;
    const runtime = createNamespaceRuntimeWithSeam({
      handle,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await waitReady(runtime); // 构造 V2 状态门在 flip 之前放行（ready）

    const updates = countUpdates(doc);
    const before = stateBytes(doc);
    flipToThrow(); // adapter 从此刻起持续违约

    const settled = await settleOf(runtime.mutateData(SET_N(5)));
    // 写槽必须经 Promise 结算：统一 fatal（不出裸异常第二通道）
    expect(settled.kind).toBe('rejected');
    if (settled.kind !== 'rejected') return;
    expect(settled.reason).toBeInstanceOf(RuntimeWriteFatalError);
    const fatal = settled.reason as RuntimeWriteFatalError;
    expect(fatal.committed).toBe(false); // S2 检查点时尚零 doc 写——诚实 committed:false
    expect(fatal.phase).toBe('write-slot-internal'); // 稳定 phase
    // P1 后公共 message 只含稳定 code/phase/committed + 固定处置说明
    expect(fatal.message).toContain('NSRT-WRITE-FATAL');
    expect(fatal.message).toContain('phase=write-slot-internal');
    expect(fatal.message).toContain('committed=false');
    expect(fatal.message).not.toContain('adapter-boom');
    expect(fatal.message).not.toContain('getStatus() 抛错');

    // committed:false → 不调用 dirty notifier；零写入
    expect(notifierCalls).toBe(0);
    expect(updates.count).toBe(0);
    expect(stateBytes(doc)).toEqual(before);

    // O1 场景：adapter 持续抛错下，公共 runtime.getStatus() 读面原样传播（#89 既有
    // loud-throw 契约——fatal 摘要经该面暂不可观测）
    expect(() => runtime.getStatus()).toThrowError(/adapter-boom/);

    // 读取保留：read 不经 handle adapter，照常观察 live Y.Doc
    expect(readValue(runtime, ['n'])).toBe(1);

    // 队列不被毒死：后续写取得槽、经 S1 fatal gate 结算（非挂住）——与 DV-1b 的
    // 队列停滞（notifier 挂住阻断槽释放）形成对照
    const { probe, accesses } = makeAccessProbe(77);
    const second = await settleOf(runtime.mutateData(probe));
    expect(second.kind).toBe('resolved');
    if (second.kind !== 'resolved') return;
    expect(second.value).toMatchObject({ ok: false });
    expect(hasCode(second.value, 'RUNTIME_WRITE_DISABLED')).toBe(true);
    expect(accesses()).toBe(0); // 零输入访问
    expect(readValue(runtime, ['n'])).toBe(1); // 零写入
  });
});

// —— DV-4：深嵌套栈溢出收编（SA4 动态重点 4）——

describe('SA7 动态验证 — SA4 重点 4：200k 层深嵌套栈溢出收编', () => {
  it('DV-4 200,000 层嵌套数组 → RangeError 收编为 ok:false（MUTATION_INPUT_NOT_PLAIN_DATA）；进程不崩、写能力不关闭、后续有效写成功', async () => {
    const doc = seededDoc();
    let notifierCalls = 0;
    const runtime = createNamespaceRuntimeWithSeam({
      handle: makeThrowingHandle(doc).handle,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await waitReady(runtime);

    // 200,000 层嵌套 plain 数组（逐层包裹——输入本身是合法 plain data 形状，
    // 拒绝只能来自受控 snapshotter 的递归深度，而非四查纪律）
    let deep: unknown = [];
    for (let i = 0; i < 200_000; i += 1) deep = [deep];

    const updates = countUpdates(doc);
    const before = stateBytes(doc);
    const settled = await settleOf(runtime.mutateData(SET_N(deep)));

    // 收编为普通失败（类 B 分级）：不升格 internal fatal、不崩进程
    expect(settled.kind).toBe('resolved');
    if (settled.kind !== 'resolved') return;
    expect(settled.value).toMatchObject({ ok: false });
    expect(hasCode(settled.value, 'MUTATION_INPUT_NOT_PLAIN_DATA')).toBe(true);

    // 零写入
    expect(updates.count).toBe(0);
    expect(stateBytes(doc)).toEqual(before);
    expect(notifierCalls).toBe(0);

    // 防 DoS 关键断言：输入缺陷不永久禁写——fatal 不置位、后续有效写照常成功
    const status = runtime.getStatus();
    expect(status.fatal).toBeNull();
    expect(status.rootWrite.enabled).toBe(true);

    const followUp = await settleOf(runtime.mutateData(SET_N(42)));
    expect(followUp.kind).toBe('resolved');
    if (followUp.kind !== 'resolved') return;
    expect(followUp.value).toMatchObject({ ok: true });
    expect(readValue(runtime, ['n'])).toBe(42);
    expect(notifierCalls).toBe(1); // 仅有效写触发一次 notifier
  });
});

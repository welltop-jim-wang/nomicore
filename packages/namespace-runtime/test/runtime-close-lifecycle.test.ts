/**
 * SA6 红灯测试 — @nomicore/namespace-runtime close 生命周期、七键 capability status 与
 * fatal×close 交叉（issue #92 / ADR-0008「生命周期、状态与所有权」+「Fatal 与失败通道」节，
 * 功能开发）。
 *
 * 契约来源：
 * - wiki/raw/task_namespace-runtime-fatal-status-close.md（AC1–AC9）与
 *   task_namespace-runtime-fatal-status-close_relevant_decisions.md（ADR-0008 摘录）；
 * - ADR-0008：「close() 幂等。首次调用同步进入 closing，立即停止接纳公共 read 和 write，
 *   并在队尾加入 close barrier；此前已接纳任务无条件排空，不取消、不设内部 timeout。
 *   barrier 只调用一次 handle.release()；无论 release 成败，Runtime 都进入 closed，
 *   失败时 close Promise reject，后续 close 返回同一个已结算 Promise」；
 * - ADR-0008：「Runtime 提供结构化瞬时 capability status……lifecycle、read、ROOT write、
 *   SCHEMA write，以及稳定且不含原始 Error/stack/SCHEMA 全文/ROOT 数据的 schema、fatal、
 *   close issue 摘要。status 不暴露队列长度、任务类型或 sequence。v1 不提供公共事件订阅」；
 * - ADR-0008 读取能力节：「预期路径、载体和 lifecycle 失败使用同步结果联合，只有 internal
 *   bug 才抛异常」；失败通道节：「普通、可预期且零写入的读取或写入失败使用领域化结果联合」。
 *
 * 锚定纪律（红包线）：
 * - 当前基线（HEAD 588fa2b）公共面九键无 close、status 六键无 close 摘要、lifecycle 恒
 *   'ready'——本文件全部用例在 close 存在性断言处红（TS 侧另由
 *   runtime-close-lifecycle-type-guard.test-d.ts 锚定类型面）；
 * - closing 期 read/write 拒绝形状按 ADR-0008 只锚「同步结果联合 / 领域化结果联合」与
 *   零写入、不入队，不锚具体拒绝码字面量（SA1 设计面，未由 ADR 冻结）；
 * - 不读源码、不 grep 文本形状；全部断言锚定公共面可观测输出（状态机迁移、Promise
 *   结算、release 调用计数、Y.Doc 字节/值、notifier 计数）。
 *
 * fixture 纪律：handle 一律经包内确定性 seam 注入（fake handle 计数 release + 真实
 * createMemoryPersistence 不参与——close 的 release 语义在此以 seam 控制面观测）；
 * P0/编译/notifier 走真实实现或注入受控接缝，零网络、零端口。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { RuntimeWriteFatalError } from '../src/index.js';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import type { NamespaceRuntime } from '../src/index.js';
import type { DocHandle, User } from '@nomicore/persistence';
import type { CompileSchemaEnvelopeResult, SchemaEnvelope } from '@nomicore/vfsl';

const OWNER: User = { userId: 'u-alice' };
const TEXT_VALID = 'type ROOT = { n: number; a: string; };';
const ENVELOPE = { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_VALID } as const;
const ROOT0 = { n: 1, a: 'x' };
const SET_N = (value: unknown) => ({ op: 'set', path: ['n'], value });

// —— fixture ——

interface HandleCtl {
  handle: DocHandle;
  releaseCalls: () => number;
}

/** fake handle（seam 注入面）：getStatus 可配置；release 计数 + 可注入失败。 */
function makeFakeHandle(opts: {
  doc: Y.Doc;
  release?: () => Promise<void>;
  statusMode?: 'ready' | 'persistence-degraded';
}): HandleCtl {
  let calls = 0;
  const handle = {
    owner: OWNER,
    docId: 'ns-1',
    doc: opts.doc,
    getStatus: () => opts.statusMode ?? 'ready',
    release: () => {
      calls += 1;
      return opts.release !== undefined ? opts.release() : Promise.resolve();
    },
  } as unknown as DocHandle;
  return { handle, releaseCalls: () => calls };
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
  const meta = doc.getMap('META');
  meta.set('docId', 'ns-1');
  meta.set('createdAt', 1_700_000_000_000);
  const root = doc.getMap('ROOT');
  for (const [k, v] of Object.entries(ROOT0)) root.set(k, v);
  return doc;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function stateBytes(doc: Y.Doc): number[] {
  return [...Y.encodeStateAsUpdate(doc)];
}

async function settleOf(
  p: Promise<unknown>,
): Promise<{ kind: 'resolved'; value: unknown } | { kind: 'rejected'; reason: unknown }> {
  try {
    return { kind: 'resolved', value: await p };
  } catch (reason) {
    return { kind: 'rejected', reason };
  }
}

/** 七键 status 观测面（当前类型未含 close 键——经 unknown 宽化，行为断言负责红/绿）。 */
interface StatusView {
  readonly lifecycle: string;
  readonly read: { readonly enabled: boolean };
  readonly rootWrite: { readonly enabled: boolean };
  readonly schemaWrite: { readonly enabled: boolean };
  readonly schema: { readonly state: string };
  readonly fatal: { readonly code: string; readonly message: string } | null;
  readonly close: { readonly code: string; readonly message: string } | null;
}

function statusOf(runtime: NamespaceRuntime): StatusView {
  return runtime.getStatus() as unknown as StatusView;
}

/** close 公共方法观测面（当前类型未含 close 键——经 unknown 宽化）。 */
function closeOf(runtime: NamespaceRuntime): () => Promise<void> {
  return (runtime as unknown as { close: () => Promise<void> }).close;
}

/** 受控 seam runtime（真 P0/真编译/真 read；fake handle + 注入 notifier/gate/compile）。 */
function readyRuntime(opts: {
  doc?: Y.Doc;
  compile?: (envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult;
  notifyDirty?: () => Promise<void>;
  p0Gate?: Promise<void>;
  handleCtl?: HandleCtl;
}): { runtime: NamespaceRuntime; handleCtl: HandleCtl } {
  const doc = opts.doc ?? makeDoc();
  const handleCtl = opts.handleCtl ?? makeFakeHandle({ doc });
  const input: Record<string, unknown> = { handle: handleCtl.handle };
  if (opts.notifyDirty !== undefined) input.notifyDirty = opts.notifyDirty;
  if (opts.compile !== undefined) input.compile = opts.compile;
  if (opts.p0Gate !== undefined) input.p0Gate = opts.p0Gate;
  const runtime = createNamespaceRuntimeWithSeam(input as never);
  return { runtime, handleCtl };
}

async function waitReady(runtime: NamespaceRuntime): Promise<void> {
  await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
}

describe('close 生命周期（AC6/AC7）', () => {
  it('AC6/AC8：公共面第十二键 close 为 function；键集恰十二键；无事件订阅键', async () => {
    const { runtime } = readyRuntime({ notifyDirty: async () => {} });
    await waitReady(runtime);
    // 当前基线红：无 close 键
    expect(typeof closeOf(runtime)).toBe('function');
    const keys = Object.keys(runtime).sort();
    expect(keys).toEqual([
      'bumpReplicationEpoch',
      'close',
      'enableReplication',
      'getActiveSchema',
      'getMetadata',
      'getSchemaEnvelope',
      'getStatus',
      'mutateRoot',
      'namespaceId',
      'owner',
      'read',
      'replaceSchema',
    ]);
    // AC8 负向：v1 无公共事件订阅键
    const anyRT = runtime as unknown as Record<string, unknown>;
    for (const k of ['on', 'off', 'subscribe', 'unsubscribe', 'emit', 'addEventListener', 'removeEventListener', 'once']) {
      expect(k in runtime).toBe(false);
      expect(anyRT[k]).toBeUndefined();
    }
  });

  it('AC6：close 首次调用同步进入 closing（返回前 lifecycle=closing）；返回 Promise；并发重复调用同实例；read 立即同步拒（结果联合，非抛非 Promise）', async () => {
    const { runtime, handleCtl } = readyRuntime({ notifyDirty: async () => {} });
    await waitReady(runtime);
    expect(typeof closeOf(runtime)).toBe('function');
    const closeFn = closeOf(runtime);
    // 闭前基线（post-close 停接纳对照）：ready 期三数据投影 getter 正常工作——值仅作
    // 对照说明（D-2 后 post-close 读取已停接纳，不再断言 post-close 与闭前相等）
    const envBefore = runtime.getSchemaEnvelope();
    const metaBefore = runtime.getMetadata();
    const activeBefore = runtime.getActiveSchema();

    const p: Promise<void> = closeFn();
    // 同步断言：close() 调用返回前 lifecycle 已是 closing
    expect(statusOf(runtime).lifecycle).toBe('closing');
    expect(p).toBeInstanceOf(Promise);
    // 幂等：并发重复调用返回同一 Promise 实例（barrier 只 release 一次的前提）
    expect(closeFn()).toBe(p);
    // read 立即停止接纳：同步结果联合（不是 Promise、不抛错）
    let readOut: unknown;
    expect(() => {
      readOut = runtime.read(['n']);
    }).not.toThrow();
    expect(readOut).not.toBeInstanceOf(Promise);
    expect((readOut as { ok: boolean }).ok).toBe(false);
    // capability 位值：closing 期 read/rootWrite/schemaWrite 全 false
    const st = statusOf(runtime);
    expect(st.read.enabled).toBe(false);
    expect(st.rootWrite.enabled).toBe(false);
    expect(st.schemaWrite.enabled).toBe(false);
    expect(st.close).toBeNull();

    await p; // 空队列：排空即结算 → closed
    expect(statusOf(runtime).lifecycle).toBe('closed');
    expect(handleCtl.releaseCalls()).toBe(1);
    // D-2（#93 rev2，SA8 裁决 B）：close 停接纳扩展至三个数据投影 getter——post-close
    // 各 getter 同步 throw：code==='RUNTIME_READ_DISABLED'、message 含 'closed' 与各自
    // getter 名、非 Promise（拒绝先于触碰 live Y.Doc——零投影）。闭前基线值仅作对照：
    // envBefore 四键相等断言保留（ready 期投影正确性）；metaBefore/activeBefore 不再
    // 断言 post-close 相等（读取已停接纳）。
    expect(envBefore).toEqual({ lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_VALID });
    for (const [getter, call] of [
      ['getSchemaEnvelope', () => runtime.getSchemaEnvelope()],
      ['getMetadata', () => runtime.getMetadata()],
      ['getActiveSchema', () => runtime.getActiveSchema()],
    ] as const) {
      expect(call, `${getter} post-close 应同步 throw（D-2 停接纳）`).toThrow();
      let thrown: unknown = '(no throw)';
      try {
        call();
      } catch (e) {
        thrown = e;
      }
      expect(thrown, `${getter} post-close 应同步 throw`).not.toBe('(no throw)');
      expect(thrown).not.toBeInstanceOf(Promise);
      expect((thrown as { code?: unknown }).code).toBe('RUNTIME_READ_DISABLED');
      expect(String((thrown as { message?: unknown }).message)).toContain('closed');
      expect(String((thrown as { message?: unknown }).message)).toContain(getter);
    }
    // 已结算后再次 close 仍是同一 Promise 实例（AC7）
    expect(closeFn()).toBe(p);
  });

  it('AC6：close 前已接纳任务无条件排空（不取消）；barrier 最后执行、release 恰一次；close 后新写不入队、立即 ok:false 零写入', async () => {
    const doc = makeDoc();
    const gate = deferred();
    let notifierCalls = 0;
    const { runtime, handleCtl } = readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
        await gate.promise; // 写槽挂在 S6：已提交、dirty 登记挂住
      },
    });
    await waitReady(runtime);
    expect(typeof closeOf(runtime)).toBe('function');
    const closeFn = closeOf(runtime);

    // close 前已接纳的写：排队 → 提交 → 挂在 notifier 门
    const pA = runtime.mutateRoot(SET_N(42));
    await expect.poll(() => notifierCalls, { interval: 10, timeout: 5_000 }).toBe(1);
    expect(doc.getMap('ROOT').get('n')).toBe(42); // 已提交（close 不取消已接纳写）

    const pc = closeFn();
    expect(statusOf(runtime).lifecycle).toBe('closing');
    // barrier 在队尾：A 未 settle 前 release 绝不能发生
    expect(handleCtl.releaseCalls()).toBe(0);
    expect(closeFn()).toBe(pc);

    // close 后新写：立即拒绝、不入队——在 A 结算前即 settle ok:false（领域化结果联合）
    const bytesBefore = stateBytes(doc);
    const s2 = await settleOf(runtime.mutateRoot(SET_N(99)));
    expect(s2.kind).toBe('resolved'); // 拒绝属普通零写入失败（领域化联合），非 rejection
    if (s2.kind === 'resolved') {
      expect(s2.value).toMatchObject({ ok: false });
      const issues = (s2.value as { issues?: unknown }).issues;
      expect(Array.isArray(issues)).toBe(true);
      expect((issues as unknown[]).length).toBeGreaterThanOrEqual(1);
    }
    const s3 = await settleOf(runtime.replaceSchema({ schema: { ...ENVELOPE } }));
    expect(s3.kind).toBe('resolved');
    if (s3.kind === 'resolved') expect(s3.value).toMatchObject({ ok: false });
    // 拒绝零副作用：A 已提交状态不被新写改变
    expect(stateBytes(doc)).toEqual(bytesBefore);
    expect(doc.getMap('SCHEMA').get('text')).toBe(TEXT_VALID);
    expect(doc.getMap('ROOT').get('n')).toBe(42);

    // A 仍 pending（未被取消）
    let aDone = false;
    void pA.then(
      () => {
        aDone = true;
      },
      () => {
        aDone = true;
      },
    );
    await flush();
    expect(aDone).toBe(false);

    // 放行 A → 排空 → barrier → release 恰一次 → close 结算
    gate.resolve();
    expect(await settleOf(pA)).toMatchObject({ kind: 'resolved', value: { ok: true } });
    await pc;
    expect(statusOf(runtime).lifecycle).toBe('closed');
    expect(handleCtl.releaseCalls()).toBe(1);
    expect(doc.getMap('ROOT').get('n')).toBe(42); // A 无条件执行完毕（非取消、非零写入）
    // closed 期：read 停止、三能力位 false、close 摘要 null（正常路径无 close issue）
    expect(runtime.read(['n']).ok).toBe(false);
    const st = statusOf(runtime);
    expect(st.read.enabled).toBe(false);
    expect(st.rootWrite.enabled).toBe(false);
    expect(st.schemaWrite.enabled).toBe(false);
    expect(st.close).toBeNull();
    expect(closeFn()).toBe(pc); // AC7：后续 close 返回同一个已结算 Promise
  });

  it('AC6：close 时 P0 尚在准备——P0 属已接纳任务、无条件结算于 barrier 之前；release 恰一次；read 停接纳不等待 P0', async () => {
    const gate = deferred();
    const { runtime, handleCtl } = readyRuntime({ p0Gate: gate.promise, notifyDirty: async () => {} });
    expect(typeof closeOf(runtime)).toBe('function');
    expect(statusOf(runtime).schema.state).toBe('preparing');
    const closeFn = closeOf(runtime);

    const pc = closeFn();
    expect(statusOf(runtime).lifecycle).toBe('closing');
    // read 拒绝不等待 P0（lifecycle gate 即时生效）
    expect(runtime.read(['n']).ok).toBe(false);
    // P0 未结算 → barrier 不可能已执行 → release 零次、close 未结算
    let settled = false;
    void pc.then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);
    expect(handleCtl.releaseCalls()).toBe(0);
    expect(statusOf(runtime).schema.state).toBe('preparing');

    gate.resolve();
    await expect.poll(() => statusOf(runtime).schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
    await pc;
    expect(statusOf(runtime).lifecycle).toBe('closed');
    expect(handleCtl.releaseCalls()).toBe(1); // P0 结算后 barrier 才 release
  });

  it('AC7：release 失败——close Promise reject；Runtime 仍 closed；close 摘要稳定且不含原始 Error/stack；后续 close 返回同一已结算（reject）Promise', async () => {
    const doc = makeDoc();
    const handleCtl = makeFakeHandle({
      doc,
      release: () => Promise.reject(new Error('RELEASE_BOOM_SENTINEL: lease release failed')),
    });
    const { runtime } = readyRuntime({ doc, handleCtl, notifyDirty: async () => {} });
    await waitReady(runtime);
    expect(typeof closeOf(runtime)).toBe('function');
    const closeFn = closeOf(runtime);

    const p = closeFn();
    expect(statusOf(runtime).lifecycle).toBe('closing');
    const first = await settleOf(p);
    expect(first.kind).toBe('rejected'); // release 失败 → close Promise reject
    if (first.kind !== 'rejected') return;
    const firstReason = first.reason;
    // 无论 release 成败：Runtime 进入 closed
    expect(statusOf(runtime).lifecycle).toBe('closed');
    expect(handleCtl.releaseCalls()).toBe(1);
    expect(runtime.read(['n']).ok).toBe(false);
    const st = statusOf(runtime);
    expect(st.read.enabled).toBe(false);
    expect(st.rootWrite.enabled).toBe(false);
    expect(st.schemaWrite.enabled).toBe(false);
    // close 摘要：稳定 {code,message}，不含原始 Error 文本 / stack
    expect(st.close).not.toBeNull();
    const closeSum = st.close as { code: string; message: string };
    expect(typeof closeSum.code).toBe('string');
    expect(closeSum.code.length).toBeGreaterThan(0);
    expect(typeof closeSum.message).toBe('string');
    expect(closeSum.message.length).toBeGreaterThan(0);
    const json = JSON.stringify(closeSum);
    expect(json).not.toContain('RELEASE_BOOM_SENTINEL');
    expect(json).not.toContain('stack');
    // 幂等：后续 close 返回同一 Promise、同一 rejection 原因
    const p2 = closeFn();
    expect(p2).toBe(p);
    const second = await settleOf(p2);
    expect(second.kind).toBe('rejected');
    if (second.kind !== 'rejected') return;
    expect(second.reason).toBe(firstReason);
    expect(statusOf(runtime).close).toEqual(st.close); // 摘要跨调用稳定
  });

  it('T2.2（D-2，新增）：closing 排空窗口内三数据投影 getter 同步 throw（message 含 closing）；放行排空 closed 后 throw（closed）；全窗口 getStatus 可用且 lifecycle 真话', async () => {
    const doc = makeDoc();
    const gate = deferred();
    let notifierCalls = 0;
    const { runtime, handleCtl } = readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
        await gate.promise; // 写槽挂在 S6：已提交、dirty 登记挂住——closing 排空窗口
      },
    });
    await waitReady(runtime);
    const closeFn = closeOf(runtime);

    // close 前已接纳的写：排队 → 提交 → 挂在 notifier 门
    const pA = runtime.mutateRoot(SET_N(42));
    await expect.poll(() => notifierCalls, { interval: 10, timeout: 5_000 }).toBe(1);
    expect(doc.getMap('ROOT').get('n')).toBe(42);

    const pc = closeFn();
    expect(statusOf(runtime).lifecycle).toBe('closing');

    // closing 窗口：三 getter 同步 throw（message 含 'closing'）；拒绝非 Promise
    for (const [getter, call] of [
      ['getSchemaEnvelope', () => runtime.getSchemaEnvelope()],
      ['getMetadata', () => runtime.getMetadata()],
      ['getActiveSchema', () => runtime.getActiveSchema()],
    ] as const) {
      expect(call, `${getter} closing 窗口应同步 throw`).toThrow();
      let thrown: unknown = '(no throw)';
      try {
        call();
      } catch (e) {
        thrown = e;
      }
      expect(thrown).not.toBeInstanceOf(Promise);
      expect((thrown as { code?: unknown }).code).toBe('RUNTIME_READ_DISABLED');
      expect(String((thrown as { message?: unknown }).message)).toContain('closing');
      expect(String((thrown as { message?: unknown }).message)).toContain(getter);
    }
    // 全窗口 getStatus 可用且 lifecycle 真话（排空观察面不被停接纳波及）
    expect(statusOf(runtime).lifecycle).toBe('closing');
    expect(statusOf(runtime).read.enabled).toBe(false);
    expect(handleCtl.releaseCalls()).toBe(0); // barrier 仍在队尾（A 未结算）

    // 放行排空 → closed
    gate.resolve();
    expect(await settleOf(pA)).toMatchObject({ kind: 'resolved', value: { ok: true } });
    await pc;
    expect(statusOf(runtime).lifecycle).toBe('closed');
    expect(handleCtl.releaseCalls()).toBe(1);
    // closed 后三 getter 同步 throw（message 含 'closed'）；getStatus 仍可用
    for (const [getter, call] of [
      ['getSchemaEnvelope', () => runtime.getSchemaEnvelope()],
      ['getMetadata', () => runtime.getMetadata()],
      ['getActiveSchema', () => runtime.getActiveSchema()],
    ] as const) {
      expect(call, `${getter} closed 期应同步 throw`).toThrow();
      let thrown: unknown = '(no throw)';
      try {
        call();
      } catch (e) {
        thrown = e;
      }
      expect((thrown as { code?: unknown }).code).toBe('RUNTIME_READ_DISABLED');
      expect(String((thrown as { message?: unknown }).message)).toContain('closed');
      expect(String((thrown as { message?: unknown }).message)).toContain(getter);
    }
    expect(statusOf(runtime).lifecycle).toBe('closed');
  });

  it('T2.4（D-2，新增）：cyclic META 注入 + close → getMetadata() throw RUNTIME_READ_DISABLED（非原始 RangeError）——门禁先于深拷贝递归的零触碰证明', async () => {
    const doc = makeDoc();
    // F-3 同款 cyclic META 直注（live ContentAny 持原引用；ready 期 getMetadata 将抛
    // 原始 RangeError——登记态，见 runtime-boundary-supplementary F-3 锚）
    const cyc: Record<string, unknown> = { name: 'loop' };
    cyc.self = cyc;
    doc.getMap('META').set('cyc', cyc);
    const { runtime, handleCtl } = readyRuntime({ doc, notifyDirty: async () => {} });
    await waitReady(runtime);
    const closeFn = closeOf(runtime);
    const p = closeFn();
    await p;
    expect(statusOf(runtime).lifecycle).toBe('closed');
    expect(handleCtl.releaseCalls()).toBe(1);

    // D-2：closed 期门禁先于投影——收到 lifecycle 停接纳错误而非深拷贝递归的 RangeError
    let thrown: unknown = '(no throw)';
    try {
      runtime.getMetadata();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).not.toBe('(no throw)');
    expect(thrown).not.toBeInstanceOf(RangeError);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as { code?: unknown }).code).toBe('RUNTIME_READ_DISABLED');
    expect(String((thrown as { message?: unknown }).message)).toContain('getMetadata');
    expect(String((thrown as { message?: unknown }).message)).toContain('closed');
  });
});

describe('capability status 七键与 fatal×close 交叉（AC5/AC1–AC4 交叉）', () => {
  it('AC5：getStatus 八键形状——lifecycle/read/rootWrite/schemaWrite/schema/fatal/close/replication；closed 期三能力全 false；不暴露队列长度/任务类型/sequence', async () => {
    const { runtime } = readyRuntime({ notifyDirty: async () => {} });
    // 当前基线红：七键无 replication
    expect(Object.keys(runtime.getStatus()).sort()).toEqual([
      'close',
      'fatal',
      'lifecycle',
      'read',
      'replication',
      'rootWrite',
      'schema',
      'schemaWrite',
    ]);
    await waitReady(runtime);
    const st0 = statusOf(runtime);
    expect(st0.lifecycle).toBe('ready');
    expect(st0.read.enabled).toBe(true);
    expect(st0.rootWrite.enabled).toBe(true);
    expect(st0.schemaWrite.enabled).toBe(true);
    expect(st0.close).toBeNull();
    expect(st0.fatal).toBeNull();
    // 不暴露队列长度/任务类型/sequence（ADR-0008）
    const anyStatus = runtime.getStatus() as unknown as Record<string, unknown>;
    expect(anyStatus.queue).toBeUndefined();
    expect(anyStatus.sequence).toBeUndefined();
    expect(anyStatus.taskType).toBeUndefined();
    expect(Object.values(anyStatus).some((v) => Array.isArray(v))).toBe(false);

    expect(typeof closeOf(runtime)).toBe('function');
    await closeOf(runtime)();
    const closed = statusOf(runtime);
    expect(closed.lifecycle).toBe('closed');
    expect(closed.read.enabled).toBe(false);
    expect(closed.rootWrite.enabled).toBe(false);
    expect(closed.schemaWrite.enabled).toBe(false);
    expect(closed.schema.state).toBe('ready'); // schema 摘要不受 close 影响
    expect(closed.fatal).toBeNull();
    expect(closed.close).toBeNull();
  });

  it('AC1/fatal×close：fatal 后 close 照常工作——read 在 fatal 后保留（ok:true）、close 后才停；release 恰一次；fatal 摘要不受 close 影响', async () => {
    const { runtime, handleCtl } = readyRuntime({
      compile: () => {
        throw new Error('P0_COMPILE_BOOM');
      },
      notifyDirty: async () => {},
    });
    await expect.poll(() => statusOf(runtime).fatal, { interval: 10, timeout: 5_000 }).not.toBeNull();
    expect(typeof closeOf(runtime)).toBe('function');
    // fatal 后：写永久禁用、读取保留
    expect(statusOf(runtime).rootWrite.enabled).toBe(false);
    expect(statusOf(runtime).schemaWrite.enabled).toBe(false);
    expect(statusOf(runtime).read.enabled).toBe(true);
    expect(runtime.read(['n']).ok).toBe(true);
    // T2.3（D-2/裁决 H 显式负向锚）：fatal 置位不改 lifecycle（仍 'ready'）→ 三数据
    // 投影 getter 照常（不 throw——门禁 key 仅 lifecycle，绝不 keyed on fatal）：
    // envelope/meta 照常投影；active 为 null（P0 fatal 未安装 active——「照常」= 不抛、
    // 形状正常，非「有 active 值」）
    expect(runtime.getSchemaEnvelope()).not.toBeNull();
    expect(runtime.getSchemaEnvelope()!.id).toBe('ns-1');
    expect(runtime.getMetadata().docId).toBe('ns-1');
    expect(runtime.getActiveSchema()).toBeNull();
    expect(statusOf(runtime).lifecycle).toBe('ready');
    const fatalBefore = statusOf(runtime).fatal as { code: string; message: string };

    const p = closeOf(runtime)();
    expect(statusOf(runtime).lifecycle).toBe('closing');
    await p;
    expect(statusOf(runtime).lifecycle).toBe('closed');
    expect(handleCtl.releaseCalls()).toBe(1);
    // read 现在停了（close 后才停）
    expect(statusOf(runtime).read.enabled).toBe(false);
    expect(runtime.read(['n']).ok).toBe(false);
    // T2.3（续）：close 后三 getter 才 throw（D-2 停接纳——fatal 期照常的反面证据）
    for (const [getter, call] of [
      ['getSchemaEnvelope', () => runtime.getSchemaEnvelope()],
      ['getMetadata', () => runtime.getMetadata()],
      ['getActiveSchema', () => runtime.getActiveSchema()],
    ] as const) {
      expect(call, `${getter} fatal×close 后应同步 throw`).toThrow();
      let thrown: unknown = '(no throw)';
      try {
        call();
      } catch (e) {
        thrown = e;
      }
      expect((thrown as { code?: unknown }).code).toBe('RUNTIME_READ_DISABLED');
      expect(String((thrown as { message?: unknown }).message)).toContain(getter);
    }
    // fatal 摘要不受 close 影响（code/message 原样）
    expect(statusOf(runtime).fatal).toEqual(fatalBefore);
    expect(statusOf(runtime).close).toBeNull(); // release 成功 → 无 close issue
  });

  it('AC2/fatal×close：排空期内写槽 fatal 照常——committed:true reject RuntimeWriteFatalError + 槽内 best-effort notifier 恰一次 + 不虚假回滚；close 仍完成（release 恰一次、closed）', async () => {
    const doc = makeDoc();
    let notifierCalls = 0;
    const { runtime, handleCtl } = readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await waitReady(runtime);
    expect(typeof closeOf(runtime)).toBe('function');
    // 事务提交后 observer cleanup 逃逸 → committed:true fatal（yjs 实证：提交不撤销）
    doc.getMap('ROOT').observe(() => {
      throw new Error('observer-boom-close');
    });

    const pa = runtime.mutateRoot(SET_N(9)); // close 前已接纳
    const pc = closeOf(runtime)(); // 排空期内 fatal 写槽（在 barrier 之前执行）
    expect(statusOf(runtime).lifecycle).toBe('closing');
    expect(handleCtl.releaseCalls()).toBe(0); // 写槽未 settle，barrier 未执行

    const aSettle = await settleOf(pa);
    expect(aSettle.kind).toBe('rejected'); // internal fatal 走 rejection
    if (aSettle.kind === 'rejected') {
      expect(aSettle.reason).toBeInstanceOf(RuntimeWriteFatalError);
      expect((aSettle.reason as { committed?: unknown }).committed).toBe(true); // 诚实 committed
      expect(typeof (aSettle.reason as { phase?: unknown }).phase).toBe('string'); // 稳定 phase
    }
    expect(notifierCalls).toBe(1); // committed:true → 槽内 best-effort 恰一次
    expect(doc.getMap('ROOT').get('n')).toBe(9); // 不虚假回滚：提交值保留
    expect(statusOf(runtime).fatal).not.toBeNull();

    await pc; // barrier 照常 release → close 结算（队列不因单项 fatal rejection 断裂）
    expect(statusOf(runtime).lifecycle).toBe('closed');
    expect(handleCtl.releaseCalls()).toBe(1);
    expect(statusOf(runtime).close).toBeNull();
    expect(runtime.read(['n']).ok).toBe(false);
  });
});

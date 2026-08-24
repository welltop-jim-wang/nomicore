/**
 * SA6 红灯验收测试 — @nomicore/namespace-runtime 唯一 write sequencer 与 validated
 * ROOT write（issue #90 / 任务简报 AC1–AC9，功能开发）。
 *
 * 契约来源：
 * - docs/adr/0008「单一 write sequencer」节：「同一 namespace 内所有受控 Y.Doc 写共享
 *   唯一严格 FIFO write sequencer」；「写方法调用时同步决定接纳顺序。输入引用在排队期间
 *   可以变化；任务取得槽后立即用受控 snapshotter 复制并递归冻结 plain data」；「每个真正
 *   写任务的槽依次执行：lifecycle/fatal gate、DocHandle.getStatus() writable gate、输入
 *   快照、领域校验和 detached 构造、一次 Yjs transaction、await notifyDirty()，然后才
 *   释放给下一任务」；「persistence-degraded 阻止 ROOT……写；它不阻止 read……gate 是
 *   瞬时观察：检查后才发生的降级不撤销已提交事务，dirty notification 仍必须登记最新
 *   live doc」；
 * - docs/adr/0008「ROOT write」节：「ROOT write 在自己的槽开始时使用当时 active schema；
 *   它不绑定调用时 schema generation」；「没有可用 schema 时零写入失败」；
 * - docs/adr/0008「读取能力」节：「读取只观察调用瞬间已经提交的 live Y.Doc，不等待已接纳
 *   但尚未提交的写。调用方需要 read-your-write 时必须先等待对应写 Promise」；
 * - docs/adr/0008「Fatal 与失败通道」节（ROOT mutation 部分逐句验收锚）：独立窄结果联合；
 *   DocRuntimeFatalError committed/phase；「committed:false 不调用 dirty notifier」；
 *   「committed:true 或未知异常……在当前槽内 best-effort notifyDirty()，但始终 reject
 *   原始 fatal」；「post-commit fatal 以带 committed:true 的稳定 RuntimeWriteFatalError
 *   reject」；「已排队的后续写仍按 FIFO 取得槽，且不访问输入、零写入返回
 *   RUNTIME_WRITE_DISABLED」；
 * - docs/adr/0007：「applyValidatedMutation(derived, doc, mutation)……单次 Yjs
 *   transaction」；「成功只返回 { ok:true }」；零写入承诺；
 * - 任务简报 AC1–AC9（逐条对照）与「关键上下文」5（notifyDirty 窄接缝）/7（snapshotter）/
 *   8（读取语义）。
 *
 * 本文件冻结的契约锚点（SA1 设计 / SA3 实现的验收行为锚）：
 * - seam 输入新增 `notifyDirty?: () => Promise<void>`（ADR-0008 原文对此窄接缝的命名；
 *   构造方绑定 persistence.saveDoc(handle) 的注入点——SA3 若采用其他字段名，本测试即契约
 *   要求对齐）；生产工厂由构造方绑定，测试经 seam 注入确定性 notifier；
 * - `runtime.mutateRoot(mutation)` 为唯一公共 ROOT 写入口：异步、返回完成信号
 *   （Acceptance-order 在调用时同步决定——调用本身不同步 throw、不同步结算）；
 *   形状 `{ op: 'set', path: readonly (string|number)[], value: unknown }`
 *   （ADR-0007 首版子集的当前仓库事实 set-only；与 applyValidatedMutation 公共入口同形状）；
 * - 结果联合：成功 `{ ok: true }`；普通失败（校验/快照拒绝/write-disabled）`{ ok: false,
 *   issues: { message, path }[] }` 且零写入；fatal（internal）走 Promise rejection；
 * - 成功路径：槽内 gate（lifecycle/fatal + writable）→ 槽开始时刻快照（排队期间输入
 *   引用可变化）→ 执行时 active schema 校验 + 单事务 → 事务成功后同槽 await notifier →
 *   槽释放；成功写恰好 1 次 Y.Doc 更新事件 + 1 次 notifier 调用；
 * - 失败（ok:false）路径：0 次更新事件、0 次 notifier 调用、Y.Doc state 字节不变；
 * - writable gate 或 fatal 状态拒绝：settle ok:false、issues 含稳定码
 *   RUNTIME_WRITE_DISABLED、输入零访问（Proxy 观测）、零写入、notifier 不调用；
 * - committed:true fatal：reject 稳定 RuntimeWriteFatalError（committed:true + 稳定
 *   phase 字符串）＋ 槽内 best-effort notifyDirty 恰一次 ＋ 写入已提交事实保留（不虚假
 *   回滚）＋ 全部写永久关闭（后续队列项仍 FIFO 取得槽、零访问输入、零写入返回
 *   RUNTIME_WRITE_DISABLED）＋ 读取保留；
 * - committed:false fatal：reject（committed:false + phase 字符串）、notifier 不调用、
 *   零写入、全部写永久关闭、读取保留；
 * - degraded gate：不阻止 P0（schema.state 照常 ready）、不阻止 read；写被拒且零写入；
 * - 快照器拒绝非 plain data（class instance / symbol 键 / 循环引用 / 非有限 number /
 *   function）→ ok:false、零写入（输入缺陷属普通领域失败，不升格 internal fatal）；
 * - 输入对象在排队期间被调用方改动 → 槽开始时刻的快照获胜（不是调用时快照）。
 *
 * 红灯现状（构造性红灯）：runtime.mutateRoot 尚未实现（当前公共面只有七键只读面）——
 * 全部用例在首个 mutateRoot 调用处红（TypeError: runtime.mutateRoot is not a function）。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, User } from '@nomicore/persistence';
import { createMemoryPersistence } from '@nomicore/persistence';
import { compileSchemaEnvelope } from '@nomicore/vfsl';
import type { CompileSchemaEnvelopeResult, DerivedSchema, SchemaEnvelope } from '@nomicore/vfsl';
import { createNamespaceRuntimeWithSeam } from '../src/index.js';
import type { NamespaceRuntime } from '../src/index.js';

// —— 契约类型（测试侧声明：公共入口尚无 mutateRoot / RuntimeWriteFatalError 类型名目）——

interface MutationIssue {
  message: string;
  path: Array<string | number>;
}

type MutateRootResult = { ok: true } | { ok: false; issues: MutationIssue[] };

type MutateRoot = (mutation: unknown) => Promise<MutateRootResult>;

interface MutateRootRuntime extends NamespaceRuntime {
  mutateRoot: MutateRoot;
}

type RuntimeWriteFatalCtor = new (...args: unknown[]) => Error;

// —— fixture ——

const OWNER: User = { userId: 'u-alice' };
const TEXT_VALID = 'type ROOT = { n: number; a: string; };';
const ENVELOPE = { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_VALID } as const;
const ROOT0 = { n: 1, a: 'x' };
const SET_N = (value: unknown) => ({ op: 'set', path: ['n'], value });

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function stateBytes(doc: Y.Doc): number[] {
  return [...Y.encodeStateAsUpdate(doc)];
}

function readValue(runtime: NamespaceRuntime, path: readonly (string | number)[]): unknown {
  const read = runtime.read(path);
  if (!read.ok) throw new Error(`读取应成功，实际 code=${read.code}`);
  return read.value;
}

function countUpdates(doc: Y.Doc): { count: number } {
  const counter = { count: 0 };
  doc.on('update', () => {
    counter.count += 1;
  });
  return counter;
}

/** 写入输入访问观测 Proxy：任何 get/ownKeys/descriptor/has 都计数（绝不 throw）。 */
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

/** 注入的输入：值必然非 plain（class 实例 / 符号键 / 循环 / NaN / function）。 */
function valueOf(kind: string): unknown {
  switch (kind) {
    case 'class-instance':
      return new (class Foo {})();
    case 'symbol-key': {
      const v: Record<string | symbol, unknown> = { ok: 1 };
      v[Symbol('hidden')] = 2;
      return v;
    }
    case 'circular': {
      const v: Record<string, unknown> = { a: 1 };
      v.self = v;
      return v;
    }
    case 'nan':
      return Number.NaN;
    case 'function':
      return () => 1;
    default:
      throw new Error(`未知 input kind: ${kind}`);
  }
}

/** 受控 seam 手柄（fake handle + 计数器 + 可翻转状态机）。 */
function makeFakeHandle(opts: {
  doc: Y.Doc;
  statusMode?: 'ready' | 'persistence-degraded' | undefined;
}): {
  handle: DocHandle;
  setMode: (mode: 'ready' | 'persistence-degraded') => void;
  mode: () => 'ready' | 'persistence-degraded';
} {
  let mode: 'ready' | 'persistence-degraded' = opts.statusMode ?? 'ready';
  const handle = {
    owner: OWNER,
    docId: 'ns-1',
    doc: opts.doc,
    getStatus: () => mode,
    release: async () => {},
  } as unknown as DocHandle;
  return {
    handle,
    setMode: (m) => {
      mode = m;
    },
    mode: () => mode,
  };
}

/** 真实内存 Persistence + 合法 SCHEMA/META/ROOT 的 handle（degraded 场景用）。 */
async function makeRealHandle(opts: {
  writeSnapshot?: (key: string, snapshot: Uint8Array) => Promise<void> | void;
} = {}): Promise<{ persistence: ReturnType<typeof createMemoryPersistence>; handle: DocHandle; doc: Y.Doc }> {
  const persistence = createMemoryPersistence({
    schedule: { debounceMs: 5, maxDirtyMs: 60 },
    ...(opts.writeSnapshot !== undefined ? { writeSnapshot: opts.writeSnapshot } : {}),
  });
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
  const meta = doc.getMap('META');
  meta.set('docId', 'ns-1');
  meta.set('createdAt', 1_700_000_000_000);
  const root = doc.getMap('ROOT');
  for (const [k, v] of Object.entries(ROOT0)) root.set(k, v);
  const handle = await persistence.createDoc(OWNER, 'ns-1', doc);
  return { persistence, handle, doc };
}

/** 就绪 Runtime（真实 P0：真 SCHEMA + 真编译；fake handle；注入 notifier）。 */
function readyRuntime(opts: {
  doc: Y.Doc;
  compile?: (envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult;
  notifyDirty: () => Promise<void>;
  statusMode?: 'ready' | 'persistence-degraded';
  p0Gate?: Promise<void>;
}): { runtime: MutateRootRuntime; handleCtl: ReturnType<typeof makeFakeHandle> } {
  const ctl = makeFakeHandle({ doc: opts.doc, statusMode: opts.statusMode });
  const input: Record<string, unknown> = {
    handle: ctl.handle,
    notifyDirty: opts.notifyDirty,
  };
  if (opts.compile !== undefined) input.compile = opts.compile;
  if (opts.p0Gate !== undefined) input.p0Gate = opts.p0Gate;
  const runtime = createNamespaceRuntimeWithSeam(input as never) as unknown as MutateRootRuntime;
  return { runtime, handleCtl: ctl };
}

async function waitReady(runtime: NamespaceRuntime): Promise<void> {
  await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
}

/** 收集 settled 结果/拒绝（resolve 值或 throw 值统一返回，不使测试直接崩散）。 */
async function settleOf(p: Promise<unknown>): Promise<{ kind: 'resolved'; value: unknown } | { kind: 'rejected'; reason: unknown }> {
  try {
    return { kind: 'resolved', value: await p };
  } catch (reason) {
    return { kind: 'rejected', reason };
  }
}

function issuesOf(value: unknown): MutationIssue[] {
  if (typeof value !== 'object' || value === null) return [];
  const issues = (value as { issues?: unknown }).issues;
  return Array.isArray(issues) ? (issues as MutationIssue[]) : [];
}

/** 稳定码 RUNTIME_WRITE_DISABLED 是否落在结果联合的 issue 域（message 或 code 字段）。 */
function hasDisabledCode(value: unknown): boolean {
  return issuesOf(value).some((issue) =>
    JSON.stringify(issue).includes('RUNTIME_WRITE_DISABLED'),
  );
}

// —— 模块级动态取成员（公共入口当前无 mutateRoot / RuntimeWriteFatalError）——

let entry: Record<string, unknown> | undefined;
let runtimeWriteFatalCtor: RuntimeWriteFatalCtor | undefined;
let mutateRootOfEntry: unknown;

beforeAll(async () => {
  entry = (await import('../src/index.js')) as Record<string, unknown>;
  runtimeWriteFatalCtor = entry['RuntimeWriteFatalError'] as RuntimeWriteFatalCtor | undefined;
  mutateRootOfEntry = entry['mutateRoot'];
});

describe('namespace-runtime 唯一 write sequencer 与 validated ROOT write（AC1–AC9）', () => {
  it('AC9 + AC5/AC6 幸福路径：mutateRoot → ok:true；恰 1 次 Y.Doc 更新、恰 1 次 notifier；read-your-write 经 await 写 Promise', async () => {
    const doc = new Y.Doc();
    const sc = doc.getMap('SCHEMA');
    for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
    doc.getMap('META').set('docId', 'ns-1');
    const root = doc.getMap('ROOT');
    for (const [k, v] of Object.entries(ROOT0)) root.set(k, v);

    let notifierCalls = 0;
    const { runtime } = readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await waitReady(runtime);

    // 红灯锚：runtime 公共面方法 mutateRoot 必须存在且为函数（当前未实现 → 此行红）
    expect(typeof runtime.mutateRoot).toBe('function');
    // 护栏（当前契约保持）：mutateRoot 是 runtime 面方法，不是模块级导出——入口保持窄
    expect(mutateRootOfEntry).toBeUndefined();

    const updates = countUpdates(doc);
    const before = stateBytes(doc);
    const p = runtime.mutateRoot(SET_N(2));
    const res = await p;

    expect(res).toEqual({ ok: true });
    // 前向：写入已提交（单事务无旁路——恰 1 次更新事件）
    expect(updates.count).toBe(1);
    expect(stateBytes(doc)).not.toEqual(before);
    // 后向：read-your-write = await 写 Promise 后 read 观察提交值（前后闭环）
    expect(readValue(runtime, ['n'])).toBe(2);
    expect(readValue(runtime, ['a'])).toBe('x');
    // dirty notification 登记：成功写恰好 1 次
    expect(notifierCalls).toBe(1);
  });

  it('AC1 + AC6 + AC8：严格 FIFO——前项事务后、notifier resolve 前不放行；read 只观察已提交状态、不等待已接纳未提交写', async () => {
    const doc = new Y.Doc();
    const sc = doc.getMap('SCHEMA');
    for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
    doc.getMap('META').set('docId', 'ns-1');
    const root = doc.getMap('ROOT');
    for (const [k, v] of Object.entries(ROOT0)) root.set(k, v);

    const gateA = deferred();
    let notifierCalls = 0;
    const { runtime } = readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
        await gateA.promise; // 首次调用（写 A）挂住——模拟持久层慢登记
      },
    });
    await waitReady(runtime);

    const order: string[] = [];
    const pA = runtime.mutateRoot(SET_N(2));
    pA.then(
      () => order.push('A'),
      () => order.push('A'),
    );

    // 写 A 已提交（事务在 notifier 之前完成）但其 Promise 未 resolve（notifier 未放行）
    await expect.poll(() => notifierCalls, { interval: 10, timeout: 5_000 }).toBe(1);
    expect(order).toEqual([]); // 槽未释放：A 的完成信号未发出
    expect(readValue(runtime, ['n'])).toBe(2); // read 观察调用瞬间已提交状态（A 已提交）

    // 写 B 排队（同步接纳，FIFO）——read 不等待 B：仍只见 A
    const pB = runtime.mutateRoot(SET_N(3));
    pB.then(
      () => order.push('B'),
      () => order.push('B'),
    );
    await sleep(25);
    expect(readValue(runtime, ['n'])).toBe(2); // B 尚未执行（A 的 notifier 仍挂住）
    expect(order).toEqual([]);

    // 放行 notifier → 槽释放 → B 才取得槽
    gateA.resolve();
    await expect(pA).resolves.toEqual({ ok: true });
    await expect(pB).resolves.toEqual({ ok: true });

    expect(order).toEqual(['A', 'B']); // FIFO 完成顺序
    expect(notifierCalls).toBe(2); // 每次成功写恰一次登记
    expect(readValue(runtime, ['n'])).toBe(3); // 第二笔后到（严格按接纳顺序）
  });

  it('AC1：单项失败不毒死后续队列——校验失败 ok:false 零写入，后续写仍按 FIFO 成功', async () => {
    const doc = new Y.Doc();
    const sc = doc.getMap('SCHEMA');
    for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
    doc.getMap('META').set('docId', 'ns-1');
    const root = doc.getMap('ROOT');
    for (const [k, v] of Object.entries(ROOT0)) root.set(k, v);

    let notifierCalls = 0;
    const { runtime } = readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await waitReady(runtime);

    const updates = countUpdates(doc);
    const before = stateBytes(doc);
    // 同一同步时刻发送失败 + 成功两笔（FIFO 接纳顺序固定；失败不阻塞队列）
    const pFail = runtime.mutateRoot(SET_N('not-a-number'));
    // 同步注册结算探针（先于 pOk 入队）：捕获「失败写结算瞬间」的零写入证据——
    // 不依赖 await 续体相对 pOk 槽体的微任务时序（await 包装多一跳即可跨过 pOk 提交点）
    const failProbe = { updates: -1, bytesSame: false, notifier: -1 };
    pFail.then(
      () => {
        failProbe.updates = updates.count;
        failProbe.bytesSame = stateBytes(doc).join(',') === before.join(',');
        failProbe.notifier = notifierCalls;
      },
      () => {
        // 失败写若走 rejection（fatal）由下方 result 断言暴露；探针仅承担零写入证据
      },
    );
    const pOk = runtime.mutateRoot(SET_N(5));

    const failSettle = await settleOf(pFail);
    expect(failSettle.kind).toBe('resolved');
    if (failSettle.kind !== 'resolved') return;
    expect(failSettle.value).toMatchObject({ ok: false });
    expect(issuesOf(failSettle.value).length).toBeGreaterThanOrEqual(1);
    for (const issue of issuesOf(failSettle.value)) {
      expect(typeof issue.message).toBe('string');
      expect(Array.isArray(issue.path)).toBe(true);
    }

    // 失败：零写入（探针于失败写结算瞬间捕获：0 更新事件、state 字节不变、0 notifier）
    expect(failProbe.updates).toBe(0);
    expect(failProbe.bytesSame).toBe(true);
    expect(failProbe.notifier).toBe(0);

    // 后续写仍按 FIFO 正常执行（队列未被毒死）
    await expect(pOk).resolves.toEqual({ ok: true });
    expect(notifierCalls).toBe(1);
    expect(updates.count).toBe(1);
    expect(readValue(runtime, ['n'])).toBe(5);
  });

  it('AC2 + AC4：fatal 状态 gate——write-disabled 后仍 FIFO 取得槽、零访问输入、零写入返回 RUNTIME_WRITE_DISABLED', async () => {
    const doc = new Y.Doc();
    const sc = doc.getMap('SCHEMA');
    for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
    doc.getMap('META').set('docId', 'ns-1');
    const root = doc.getMap('ROOT');
    for (const [k, v] of Object.entries(ROOT0)) root.set(k, v);

    let notifierCalls = 0;
    const BOOM = 'NSRT-WRITE-GATE-SENTINEL-7c1f';
    const { runtime } = readyRuntime({
      doc,
      compile: () => {
        throw new Error(BOOM); // P0 internal fault → 永久关写（fatal）
      },
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await expect.poll(() => runtime.getStatus().fatal, { interval: 10, timeout: 5_000 }).not.toBeNull();

    const { probe, accesses } = makeAccessProbe(99);
    const updates = countUpdates(doc);
    const before = stateBytes(doc);
    const settled = await settleOf(runtime.mutateRoot(probe));

    expect(settled.kind).toBe('resolved');
    if (settled.kind !== 'resolved') return;
    expect(settled.value).toMatchObject({ ok: false });
    expect(hasDisabledCode(settled.value)).toBe(true); // 稳定码 RUNTIME_WRITE_DISABLED
    expect(accesses()).toBe(0); // 不可写时零访问输入（快照/信封均不得读取）
    expect(updates.count).toBe(0); // 零写入
    expect(stateBytes(doc)).toEqual(before);
    expect(notifierCalls).toBe(0);
    // 读取保留
    expect(readValue(runtime, ['n'])).toBe(1);

    // 队列持续流转（FIFO 不因 fatal 断链）：再次写入仍 settle（disabled），不挂死
    const again = await settleOf(runtime.mutateRoot(SET_N(7)));
    expect(again.kind).toBe('resolved');
    if (again.kind !== 'resolved') return;
    expect(again.value).toMatchObject({ ok: false });
    expect(hasDisabledCode(again.value)).toBe(true);
  });

  it('AC7 + AC2：persistence-degraded 阻止 ROOT write（RUNTIME_WRITE_DISABLED、零访问、零写入）但不阻止 read/P0', async () => {
    let failFlush = false;
    const { persistence, handle, doc } = await makeRealHandle({
      writeSnapshot: async () => {
        if (failFlush) throw new Error('io down (deterministic)');
      },
    });
    // 触发 entry 降级：saveDoc → flush 失败 → persistence-degraded
    failFlush = true;
    await persistence.saveDoc(handle);
    await sleep(30);
    expect(handle.getStatus()).toBe('persistence-degraded');

    let notifierCalls = 0;
    // 构造于 degraded handle：V2 接受 degraded（ADR-0008：degraded 不阻止 P0）
    const runtime = createNamespaceRuntimeWithSeam({
      handle,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    }) as unknown as MutateRootRuntime;

    // P0 不被 degraded 阻止 → ready + active schema
    await waitReady(runtime);
    expect(runtime.getActiveSchema()).not.toBeNull();
    expect(runtime.getStatus().rootWrite.enabled).toBe(false);
    expect(runtime.getStatus().read.enabled).toBe(true);

    const { probe, accesses } = makeAccessProbe(42);
    const updates = countUpdates(doc);
    const before = stateBytes(doc);
    const settled = await settleOf(runtime.mutateRoot(probe));

    expect(settled.kind).toBe('resolved');
    if (settled.kind !== 'resolved') return;
    expect(settled.value).toMatchObject({ ok: false });
    expect(hasDisabledCode(settled.value)).toBe(true);
    expect(accesses()).toBe(0);
    expect(updates.count).toBe(0);
    expect(stateBytes(doc)).toEqual(before);
    expect(notifierCalls).toBe(0);
    expect(readValue(runtime, ['n'])).toBe(1); // 读取保留（不等待、不拒绝）

    await handle.release();
    await persistence.dispose();
  });

  it('AC7：检查后才降级的写——gate 通过后照常提交并登记 dirty；后续写才被新降级 gate 阻止', async () => {
    const doc = new Y.Doc();
    const sc = doc.getMap('SCHEMA');
    for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
    doc.getMap('META').set('docId', 'ns-1');
    const root = doc.getMap('ROOT');
    for (const [k, v] of Object.entries(ROOT0)) root.set(k, v);

    const { runtime, handleCtl } = readyRuntime({
      doc,
      notifyDirty: async () => {
        // 确定性降级注入：gate（槽开始）已通过后——notifier 阶段才转为 degraded
        handleCtl.setMode('persistence-degraded');
      },
    });
    await waitReady(runtime);

    const updates = countUpdates(doc);
    // 第一笔：gate 通过 → 提交 + notifier 登记（降级发生在检查后，不撤销已提交事务）
    await expect(runtime.mutateRoot(SET_N(11))).resolves.toEqual({ ok: true });
    expect(updates.count).toBe(1);
    expect(readValue(runtime, ['n'])).toBe(11);
    expect(runtime.getStatus().rootWrite.enabled).toBe(false); // 新降级已反映

    // 第二笔：新降级 gate 阻止 → RUNTIME_WRITE_DISABLED，零写入
    const { probe, accesses } = makeAccessProbe(12);
    const before = stateBytes(doc);
    const settled = await settleOf(runtime.mutateRoot(probe));
    expect(settled.kind).toBe('resolved');
    if (settled.kind !== 'resolved') return;
    expect(settled.value).toMatchObject({ ok: false });
    expect(hasDisabledCode(settled.value)).toBe(true);
    expect(accesses()).toBe(0);
    expect(updates.count).toBe(1); // 无新增写入
    expect(stateBytes(doc)).toEqual(before);
    expect(readValue(runtime, ['n'])).toBe(11); // 读取保留
  });

  it('AC3：排队期间输入引用可变化——槽开始时刻快照获胜（不是调用时快照）', async () => {
    const doc = new Y.Doc();
    const sc = doc.getMap('SCHEMA');
    for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
    doc.getMap('META').set('docId', 'ns-1');
    const root = doc.getMap('ROOT');
    for (const [k, v] of Object.entries(ROOT0)) root.set(k, v);

    const gate = deferred();
    const { runtime } = readyRuntime({
      doc,
      p0Gate: gate.promise, // P0 挂住 → ROOT 写排队在 P0 后
      notifyDirty: async () => {},
    });

    const mut = { op: 'set', path: ['n'], value: 7 };
    const p = runtime.mutateRoot(mut);
    mut.value = 999; // 调用方在排队期间改动输入引用内容（合法：快照时点=槽开始）
    gate.resolve();

    await expect(p).resolves.toEqual({ ok: true });
    expect(readValue(runtime, ['n'])).toBe(999); // 槽开始时刻快照 = 999，而非调用时 7
  });

  it('AC3 + 异常输入：snapshotter 拒绝非 plain data——class 实例/symbol 键/循环引用/NaN/function/非对象信封 → ok:false 零写入', async () => {
    const inputs = [
      ['class instance value', { op: 'set', path: ['n'], value: valueOf('class-instance') }],
      ['symbol key value', { op: 'set', path: ['n'], value: valueOf('symbol-key') }],
      ['circular value', { op: 'set', path: ['n'], value: valueOf('circular') }],
      ['non-finite number value (NaN)', { op: 'set', path: ['n'], value: valueOf('nan') }],
      ['function value', { op: 'set', path: ['n'], value: valueOf('function') }],
      ['non-plain mutation envelope (primitive)', 42],
    ] as Array<[string, unknown]>;

    for (const [name, input] of inputs) {
      const doc = new Y.Doc();
      const sc = doc.getMap('SCHEMA');
      for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
      doc.getMap('META').set('docId', 'ns-1');
      const root = doc.getMap('ROOT');
      for (const [k, v] of Object.entries(ROOT0)) root.set(k, v);

      let notifierCalls = 0;
      const { runtime } = readyRuntime({
        doc,
        notifyDirty: async () => {
          notifierCalls += 1;
        },
      });
      await waitReady(runtime);

      const updates = countUpdates(doc);
      const before = stateBytes(doc);
      const settled = await settleOf(runtime.mutateRoot(input));

      expect(settled.kind, `[${name}] 输入拒绝应 settle（resolved ok:false）`).toBe('resolved');
      if (settled.kind !== 'resolved') continue;
      expect(settled.value, `[${name}] 拒绝非 plain 输入属普通领域失败（ok:false 联合）`).toMatchObject({ ok: false });
      expect(issuesOf(settled.value).length, `[${name}] issues 非空`).toBeGreaterThanOrEqual(1);
      expect(updates.count, `[${name}] 零写入（0 更新事件）`).toBe(0);
      expect(stateBytes(doc), `[${name}] zero-write：state 字节不变`).toEqual(before);
      expect(notifierCalls, `[${name}] 未提交不得登记 dirty`).toBe(0);
      expect(readValue(runtime, ['n']), `[${name}] 读取保留`).toBe(1);
    }
  });

  it('AC4：preparing 期接纳的 ROOT 写使用执行时 active schema——P0 结算后按已安装 schema 成功提交', async () => {
    const doc = new Y.Doc();
    const sc = doc.getMap('SCHEMA');
    for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
    doc.getMap('META').set('docId', 'ns-1');
    const root = doc.getMap('ROOT');
    for (const [k, v] of Object.entries(ROOT0)) root.set(k, v);

    const gate = deferred();
    const { runtime } = readyRuntime({
      doc,
      p0Gate: gate.promise,
      notifyDirty: async () => {},
    });

    // P0 仍准备中（preparing）时接纳写——FIFO 排在 P0 后
    expect(runtime.getStatus().schema.state).toBe('preparing');
    const p = runtime.mutateRoot(SET_N(8));
    gate.resolve();

    await expect(p).resolves.toEqual({ ok: true }); // 槽开始时 active schema 已安装（执行时绑定）
    expect(runtime.getStatus().schema.state).toBe('ready');
    expect(readValue(runtime, ['n'])).toBe(8);
  });

  it('AC4：schema-unavailable（P0 正常 compile failure）→ ROOT write 零写入失败（无可用 schema）且读取保留', async () => {
    const doc = new Y.Doc();
    const sc = doc.getMap('SCHEMA');
    for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
    doc.getMap('META').set('docId', 'ns-1');
    const root = doc.getMap('ROOT');
    for (const [k, v] of Object.entries(ROOT0)) root.set(k, v);

    let notifierCalls = 0;
    const { runtime } = readyRuntime({
      doc,
      compile: (): CompileSchemaEnvelopeResult => {
        const injected: unknown = {
          ok: false,
          issues: [{ kind: 'text', issue: { code: 'TEXT_BAD', message: 'seam unavailable' } }],
        };
        return injected as CompileSchemaEnvelopeResult;
      },
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('unavailable');

    const updates = countUpdates(doc);
    const before = stateBytes(doc);
    const settled = await settleOf(runtime.mutateRoot(SET_N(6)));
    expect(settled.kind).toBe('resolved');
    if (settled.kind !== 'resolved') return;
    expect(settled.value).toMatchObject({ ok: false }); // 没有可用 schema → 零写入失败
    expect(issuesOf(settled.value).length).toBeGreaterThanOrEqual(1);
    expect(updates.count).toBe(0);
    expect(stateBytes(doc)).toEqual(before);
    expect(notifierCalls).toBe(0);
    expect(readValue(runtime, ['n'])).toBe(1);
    expect(runtime.getStatus().schemaWrite.enabled).toBe(true); // SCHEMA 仍可修复
  });

  it('AC9 + fatal 通道（committed:true）：observer 逃逸 → reject 稳定 RuntimeWriteFatalError；best-effort notifier；不虚假回滚；FIFO 继续；写永久关闭、读取保留', async () => {
    const doc = new Y.Doc();
    const sc = doc.getMap('SCHEMA');
    for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
    doc.getMap('META').set('docId', 'ns-1');
    const root = doc.getMap('ROOT');
    for (const [k, v] of Object.entries(ROOT0)) root.set(k, v);

    let notifierCalls = 0;
    const { runtime } = readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await waitReady(runtime);

    // 触发 committed:true fatal：事务提交后 observer cleanup 逃逸（yjs 实证：提交不撤销）
    doc.getMap('ROOT').observe(() => {
      throw new Error('observer-boom');
    });

    // 同 tick 排队第二笔（已接纳未执行的写）——fatal 后仍按 FIFO 取得槽
    const { probe, accesses } = makeAccessProbe(77);
    const pA = runtime.mutateRoot(SET_N(9));
    const pB = runtime.mutateRoot(probe);

    const aSettle = await settleOf(pA);
    expect(aSettle.kind).toBe('rejected');
    if (aSettle.kind !== 'rejected') return;
    expect(runtimeWriteFatalCtor).toBeTypeOf('function'); // ADR-0008 命名：稳定 RuntimeWriteFatalError
    expect(aSettle.reason).toBeInstanceOf(runtimeWriteFatalCtor as RuntimeWriteFatalCtor);
    expect(typeof (aSettle.reason as { committed?: unknown }).committed).toBe('boolean');
    expect((aSettle.reason as { committed?: unknown }).committed).toBe(true); // 诚实 committed
    expect(typeof (aSettle.reason as { phase?: unknown }).phase).toBe('string'); // 稳定 phase
    // committed:true → 槽内 best-effort notifyDirty 恰一次（登记最新 live doc）
    expect(notifierCalls).toBe(1);
    // 不虚假回滚：事务已提交的值保留（read 观察调用瞬间已提交状态）
    expect(readValue(runtime, ['n'])).toBe(9);

    // fatal 永久关闭全部写 + 稳定摘要（不含原始 Error/stack/cause）
    const status = runtime.getStatus();
    expect(status.rootWrite.enabled).toBe(false);
    expect(status.schemaWrite.enabled).toBe(false);
    expect(status.read.enabled).toBe(true);
    expect(status.fatal).not.toBeNull();
    expect(typeof status.fatal!.code).toBe('string');
    expect(typeof status.fatal!.message).toBe('string');
    expect((status.fatal as unknown as Record<string, unknown>).stack).toBeUndefined();
    expect((status.fatal as unknown as Record<string, unknown>).cause).toBeUndefined();

    // 已排队后续写仍按 FIFO 取得槽：不访问输入、零写入返回 RUNTIME_WRITE_DISABLED（不挂死、不毒死队列）
    const bSettle = await settleOf(pB);
    expect(bSettle.kind).toBe('resolved');
    if (bSettle.kind !== 'resolved') return;
    expect(bSettle.value).toMatchObject({ ok: false });
    expect(hasDisabledCode(bSettle.value)).toBe(true);
    expect(accesses()).toBe(0);
    expect(readValue(runtime, ['n'])).toBe(9); // B 零写入
  });

  it('AC9 + fatal 通道（committed:false）：写前 internal 失败 → reject（committed:false）；notifier 不调用；零写入；写永久关闭、读取保留', async () => {
    const doc = new Y.Doc();
    const sc = doc.getMap('SCHEMA');
    for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
    doc.getMap('META').set('docId', 'ns-1');
    const root = doc.getMap('ROOT');
    for (const [k, v] of Object.entries(ROOT0)) root.set(k, v);

    // 注入畸形派生物（structure 非 root）——P0 形状守卫放行，写槽内才暴露 internal 不变量破坏
    const real = compileSchemaEnvelope({ ...ENVELOPE });
    if (!real.ok) throw new Error('fixture 信封必须可编译');
    const brokenDerived = {
      ...real.derived,
      structure: { kind: 'array', element: { kind: 'leaf' } },
    } as unknown as DerivedSchema;
    const brokenResult = { ...real, derived: brokenDerived };

    let notifierCalls = 0;
    const { runtime } = readyRuntime({
      doc,
      compile: () => brokenResult,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await waitReady(runtime); // P0 形状守卫只管最小形状 → 畸形 derived 安装为 ready

    const updates = countUpdates(doc);
    const before = stateBytes(doc);
    const settled = await settleOf(runtime.mutateRoot(SET_N(4)));

    expect(settled.kind).toBe('rejected'); // internal fatal 走 rejection（不出 ok:false 后门）
    if (settled.kind !== 'rejected') return;
    expect(typeof (settled.reason as { committed?: unknown }).committed).toBe('boolean');
    expect((settled.reason as { committed?: unknown }).committed).toBe(false); // 写前失败：诚实 committed:false
    expect(typeof (settled.reason as { phase?: unknown }).phase).toBe('string');
    // committed:false 不调用 dirty notifier
    expect(notifierCalls).toBe(0);
    // 零写入
    expect(updates.count).toBe(0);
    expect(stateBytes(doc)).toEqual(before);

    // 全部写永久关闭 + 读取保留
    const status = runtime.getStatus();
    expect(status.rootWrite.enabled).toBe(false);
    expect(status.schemaWrite.enabled).toBe(false);
    expect(status.read.enabled).toBe(true);
    expect(status.fatal).not.toBeNull();
    expect(readValue(runtime, ['n'])).toBe(1);
  });
});

/**
 * SA6 红灯验收测试 — @nomicore/namespace-runtime replaceSchema：原子 SCHEMA replacement
 * 与 ROOT generation（issue #91 / 任务简报 AC1–AC9，功能开发）。
 *
 * 契约来源：
 * - docs/adr/0008「SCHEMA write」节逐句验收锚：
 *   「SCHEMA write 不依赖当前 schema 可编译。它在自己的完整 sequencer 槽内：
 *   1. 编译 proposed SCHEMA 并构造新 tools；2. 未提供 root 时，按 proposed derived
 *   严格提取并验证当前 ROOT，证明逻辑值与实际载体均已兼容；3. 提供 root 时，将其视为
 *   最终完整 logical ROOT snapshot，验证并 detached 构造完整新内容；4. 在一个
 *   transaction 中原子替换 SCHEMA 与必要的 ROOT generation；5. transaction 返回后
 *   立即安装新 active tools，再 await notifyDirty()。」；
 * - docs/adr/0008「单一 write sequencer」节：「同一 namespace 内所有受控 Y.Doc 写共享
 *   唯一严格 FIFO write sequencer」；「输入引用在排队期间可以变化；任务取得槽后立即用
 *   受控 snapshotter 复制并递归冻结 plain data」；「persistence-degraded 阻止 ROOT、
 *   SCHEMA 以及未来所有 Y.Doc 写」；「已排队后续写仍取得槽、零访问输入、零写入返回
 *   RUNTIME_WRITE_DISABLED」；
 * - docs/adr/0008「SCHEMA 是顶层具名 Y.Map」段：「成功替换时在 transaction 内 clear()
 *   后写入恰好 lang/version/id/text 四个字符串键。提供完整 ROOT 时保留顶层
 *   doc.getMap('ROOT') identity，在同一 transaction 内清空并安装已 detached 构造的
 *   内容；其下旧 Yjs 子类型 identity 可失效。不提供 ROOT 时不修改 ROOT，也不破坏其
 *   identity。」；
 * - docs/adr/0008「新 SCHEMA 的编译、最终 ROOT 校验或 detached 构造失败均发生在
 *   transaction 前，SCHEMA/ROOT 零写入，active tools 不变。读取在准备期间继续观察旧
 *   committed generation；transaction 后才观察新 SCHEMA/ROOT，且 active identity
 *   同步切换。」；
 * - docs/adr/0008「P0 与 active schema」节：「正常 compile result failure 仅使 ROOT
 *   write unavailable；SCHEMA write 仍可修复」；
 * - 任务简报「关键上下文」5（P0 经 seam 注入 compile 并构造 schema-dependent tools；
 *   replaceSchema 成功后须安装新 active tools（AC6））、7（replaceSchema 的
 *   { schema, root? } 输入受受控 snapshotter 约束（S3 同款））、8（unavailable 态
 *   schemaWrite 仍 enabled）。
 *
 * ⚠️ 测试侧声明：replaceSchema 的 proposed 编译必须经既有 seam 注入的 `compile`
 * （缺省 vfsl compileSchemaEnvelope）路由——本文件以按 envelope.id 分发的 compile
 * 包装器注入确定性编译失败/成功，若 SA3 绕过该 seam 硬编码 vfsl 编译，AC7 编译失败
 * 用例将无法确定性注入而红（契约要求对齐）。
 *
 * 本文件冻结的契约锚点（SA1 设计 / SA3 实现的验收行为锚）：
 * - `runtime.replaceSchema({ schema: proposedEnvelope, root?: completeLogicalRoot })`
 *   成为 runtime 公共面方法（第九键；模块级入口保持窄——entry.replaceSchema undefined）；
 * - 独立窄结果联合：成功 `{ ok: true }`；普通失败（compile/提取/校验/快照拒绝/
 *   write-disabled）`{ ok: false, issues: { message, path }[] }` 且零写入；
 * - 与 mutateRoot 共享唯一严格 FIFO sequencer（占槽互斥 + notifier 屏障互通）；
 * - 不依赖当前 schema 可编译（P0 unavailable 态 replaceSchema 仍可入槽执行并恢复）；
 * - 未提供 root：按 proposed derived 严格提取并验证当前 ROOT——载体不兼容或逻辑不兼容
 *   均零写入失败，ROOT 不修改、identity 保持；
 * - 提供 root：完整 logical ROOT 验证 + detached 构造后整体替换，顶层 ROOT identity
 *   保持；旧子类型 identity 不承诺；
 * - 成功：恰 1 次 Y.Doc 更新事件（SCHEMA 与必要 ROOT 变化同一 transaction 原子提交）
 *   + 恰 1 次 notifier；SCHEMA clear 后恰写 lang/version/id/text（值型 lang/id/text
 *   string、version number——ADR-0008「四个字符串键」指键名，非值）；
 * - AC6 时序：transaction 后、notifier resolve 前，getActiveSchema 已切换新
 *   active tools（notifier 挂住窗口内可观测）；
 * - 失败零写入：0 更新事件、0 notifier、state 字节不变、SCHEMA/ROOT 内容不变、
 *   active tools（getActiveSchema）不变、读取保留；
 * - write-disabled（persistence-degraded / prior fatal）：ok:false + issues 含稳定码
 *   RUNTIME_WRITE_DISABLED、输入零访问（Proxy 观测）、零写入；
 * - snapshotter 拒绝非 plain data（class 实例 / symbol 键 / 非有限 number / 循环引用 /
 *   function）→ ok:false 含稳定码 MUTATION_INPUT_NOT_PLAIN_DATA、零写入；
 * - 输入对象在排队期间被调用方改动 → 槽开始时刻的快照获胜（不是调用时快照）；
 * - AC9：准备/排队期间 read/getSchemaEnvelope/getActiveSchema 继续观察旧 committed
 *   generation；transaction 后才观察新 SCHEMA/ROOT。
 *
 * 红灯现状（构造性红灯）：runtime.replaceSchema 尚未实现（公共面只有八键）——全部用例
 * 在首个 replaceSchema 调用/类型断言处红（TypeError: runtime.replaceSchema is not a
 * function / expected 'undefined' to be 'function'）。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, User } from '@nomicore/persistence';
import { compileSchemaEnvelope } from '@nomicore/vfsl';
import type { CompileSchemaEnvelopeResult, SchemaEnvelope } from '@nomicore/vfsl';
import { createNamespaceRuntimeWithSeam } from '../src/index.js';
import type { NamespaceRuntime } from '../src/index.js';

// —— 契约类型（测试侧声明：公共入口尚无 replaceSchema 名目）——

interface ReplaceSchemaIssue {
  message: string;
  path: Array<string | number>;
}

type ReplaceSchemaResult = { ok: true } | { ok: false; issues: ReplaceSchemaIssue[] };

type ReplaceSchema = (input: { schema: unknown; root?: unknown }) => Promise<ReplaceSchemaResult>;

interface ReplaceSchemaRuntime extends NamespaceRuntime {
  replaceSchema: ReplaceSchema;
}

// —— fixture ——

const OWNER: User = { userId: 'u-alice' };
/** v1 现有 schema：ROOT 逻辑形状 { n: number; a: string }——P0 编译用（id ns-1）。 */
const TEXT_V1 = 'type ROOT = { n: number; a: string; };';
const ENV1: Readonly<SchemaEnvelope> = { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_V1 };
/** v2 新 schema：ROOT 逻辑形状 { n: number; a: string; b: boolean }（b 为必填）。 */
const TEXT_V2 = 'type ROOT = { n: number; a: string; b: boolean; };';
const ENV2: Readonly<SchemaEnvelope> = { lang: 'vfsl', version: 1, id: 'ns-2', text: TEXT_V2 };
/** v2b：与 v1 同逻辑形状（字段重排）——未提供 root 的替换路径用（当前 ROOT 兼容）。 */
const TEXT_V2B = 'type ROOT = { a: string; n: number; };';
const ENV2B: Readonly<SchemaEnvelope> = { lang: 'vfsl', version: 1, id: 'ns-2b', text: TEXT_V2B };
/** v3：a 要求 string[] 载体——与当前 ROOT（a 为 plain string）载体不兼容（AC2 负例）。 */
const TEXT_V3 = 'type ROOT = { n: number; a: string[]; };';
const ENV3: Readonly<SchemaEnvelope> = { lang: 'vfsl', version: 1, id: 'ns-3', text: TEXT_V3 };
/** 完整 logical ROOT（v2 形状）。 */
const ROOT_WITH_B = { n: 2, a: 'y', b: true };
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

/** 顶层具名 Y.Map 的键集 + 四键值型断言（AC4：键集恰四键；lang/id/text string、version number）。 */
function assertSchemaExactlyFourKeys(doc: Y.Doc, expected: Readonly<SchemaEnvelope>): void {
  const sc = doc.getMap('SCHEMA');
  expect([...sc.keys()].sort()).toEqual(['id', 'lang', 'text', 'version']);
  expect(sc.get('lang')).toBe(expected.lang);
  expect(sc.get('version')).toBe(expected.version);
  expect(sc.get('id')).toBe(expected.id);
  expect(sc.get('text')).toBe(expected.text);
  expect(typeof sc.get('lang')).toBe('string');
  expect(typeof sc.get('version')).toBe('number');
  expect(typeof sc.get('id')).toBe('string');
  expect(typeof sc.get('text')).toBe('string');
}

/** 写入输入访问观测 Proxy：任何 get/ownKeys/descriptor/has 都计数（绝不 throw）。 */
function makeReplaceInputProbe(
  schema: unknown,
  root: unknown,
): { probe: { schema: unknown; root?: unknown }; accesses: () => number } {
  let accesses = 0;
  const probe = new Proxy({ schema, root }, {
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

/** 注入的输入：值必然非 plain（class 实例 / 符号键 / 非有限 number / 循环 / function）。 */
function valueOf(kind: string): unknown {
  switch (kind) {
    case 'class-instance':
      return new (class Foo {})();
    case 'symbol-key': {
      const v: Record<string | symbol, unknown> = { n: 1 };
      v[Symbol('hidden')] = 2;
      return v;
    }
    case 'circular': {
      const v: Record<string, unknown> = { n: 1 };
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

/** 按 envelope.id 分发的 compile 构造器（P0 与 replaceSchema proposed 编译共用同一 seam 注入）。 */
function dispatchCompile(
  handlers: Record<string, (envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult>,
): (envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult {
  return (envelope) => {
    const h = handlers[envelope.id];
    if (h !== undefined) return h(envelope);
    return compileSchemaEnvelope(envelope); // 未命中处理器 → 真实 vfsl 编译
  };
}

/** 确定性 compile 失败（结果联合内 ok:false + 单 issue——P0/SCHEMA write 共用形状）。 */
function injectedCompileFail(message: string): CompileSchemaEnvelopeResult {
  const injected: unknown = {
    ok: false,
    issues: [{ kind: 'text', issue: { code: 'TEXT_BAD', message } }],
  };
  return injected as CompileSchemaEnvelopeResult;
}

/** 种子 doc：SCHEMA(ENV1) + META + ROOT(ROOT0)。 */
function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(ENV1)) sc.set(k, v);
  doc.getMap('META').set('docId', 'ns-1');
  doc.getMap('META').set('createdAt', 1_700_000_000_000);
  const root = doc.getMap('ROOT');
  for (const [k, v] of Object.entries(ROOT0)) root.set(k, v);
  return doc;
}

/** 就绪 Runtime（真实 P0：真 SCHEMA + 编译；fake handle；注入 notifier）。 */
function readyRuntime(opts: {
  doc: Y.Doc;
  compile?: (envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult;
  notifyDirty: () => Promise<void>;
  statusMode?: 'ready' | 'persistence-degraded';
  p0Gate?: Promise<void>;
}): { runtime: ReplaceSchemaRuntime; handleCtl: ReturnType<typeof makeFakeHandle> } {
  const ctl = makeFakeHandle({ doc: opts.doc, statusMode: opts.statusMode });
  const input: Record<string, unknown> = {
    handle: ctl.handle,
    notifyDirty: opts.notifyDirty,
  };
  if (opts.compile !== undefined) input.compile = opts.compile;
  if (opts.p0Gate !== undefined) input.p0Gate = opts.p0Gate;
  const runtime = createNamespaceRuntimeWithSeam(input as never) as unknown as ReplaceSchemaRuntime;
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

function issuesOf(value: unknown): ReplaceSchemaIssue[] {
  if (typeof value !== 'object' || value === null) return [];
  const issues = (value as { issues?: unknown }).issues;
  return Array.isArray(issues) ? (issues as ReplaceSchemaIssue[]) : [];
}

/** 稳定码 RUNTIME_WRITE_DISABLED / MUTATION_INPUT_NOT_PLAIN_DATA 是否落在结果联合的 issue 域。 */
function hasIssueCode(value: unknown, code: string): boolean {
  return issuesOf(value).some((issue) => JSON.stringify(issue).includes(code));
}

// —— 模块级动态取成员（公共入口当前无 replaceSchema）——

let entry: Record<string, unknown> | undefined;
let replaceSchemaOfEntry: unknown;

beforeAll(async () => {
  entry = (await import('../src/index.js')) as Record<string, unknown>;
  replaceSchemaOfEntry = entry['replaceSchema'];
});

describe('namespace-runtime replaceSchema：原子 SCHEMA replacement 与 ROOT generation（AC1–AC9）', () => {
  it('AC1+AC2+AC4+AC5+AC6 幸福路径（未提供 root）：新 SCHEMA 四键原子安装、ROOT 零修改、active tools 切换、恰 1 次更新 + 1 次 notifier', async () => {
    const doc = makeDoc();

    let notifierCalls = 0;
    const { runtime } = readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await waitReady(runtime);

    // 红灯锚：runtime 公共面方法 replaceSchema 必须存在且为函数（当前未实现 → 此行红）
    expect(typeof runtime.replaceSchema).toBe('function');
    // 护栏（当前契约保持）：replaceSchema 是 runtime 面方法，不是模块级导出——入口保持窄
    expect(replaceSchemaOfEntry).toBeUndefined();

    const updates = countUpdates(doc);
    const rootBefore = doc.getMap('ROOT');
    const schemaBefore = doc.getMap('SCHEMA');
    const bytesBefore = stateBytes(doc);

    const res = await runtime.replaceSchema({ schema: ENV2B });

    expect(res).toEqual({ ok: true });
    // 前向：SCHEMA 替换恰 1 次 Y.Doc 更新（单 transaction——无 schema/root 旁路两次提交）
    expect(updates.count).toBe(1);
    // AC4：事务内 clear 后写恰好 lang/version/id/text 四键（键名四字符串；值型 lang/id/text string、version number）
    assertSchemaExactlyFourKeys(doc, ENV2B);
    expect(runtime.getSchemaEnvelope()).toEqual(ENV2B);
    // AC5：未提供 root → 不修改 ROOT，也不破坏 identity（顶层 Y.Map 同一实例 + 内容原样）
    expect(doc.getMap('ROOT')).toBe(rootBefore);
    expect(doc.getMap('SCHEMA')).toBe(schemaBefore);
    expect(readValue(runtime, ['n'])).toBe(1);
    expect(readValue(runtime, ['a'])).toBe('x');
    // AC6：transaction 后安装新 active tools（getActiveSchema 投影随新 compile 切换）
    expect(runtime.getActiveSchema()?.id).toBe('ns-2b');
    expect(runtime.getStatus().schema.state).toBe('ready');
    // 后向：dirty notification 登记恰一次（完成信号 = live commit + dirty 登记）
    expect(notifierCalls).toBe(1);
    expect(stateBytes(doc)).not.toEqual(bytesBefore);
  });

  it('AC1 + AC9 共享严格 FIFO（mutateRoot 先占槽 → replaceSchema 排队）：准备期 read/getSchemaEnvelope/getActiveSchema 观察旧 committed generation', async () => {
    const doc = makeDoc();

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
    // 写 A 先占槽（mutateRoot：共享 sequencer 的前项）
    const pM = runtime.mutateRoot(SET_N(2));
    pM.then(
      () => order.push('M'),
      () => order.push('M'),
    );
    await expect.poll(() => notifierCalls, { interval: 10, timeout: 5_000 }).toBe(1);
    expect(order).toEqual([]); // 槽未释放：A 的完成信号未发出

    // replaceSchema 排在同一 sequencer 的 A 之后——同步接纳、未开始执行
    const pR = runtime.replaceSchema({ schema: ENV2B });
    pR.then(
      () => order.push('R'),
      () => order.push('R'),
    );

    // AC9 准备期（本调用尚未取得槽）：read/getSchemaEnvelope/getActiveSchema 全部观察旧 committed
    // generation——SCHEMA 仍 ns-1、active schema 仍 ns-1、ROOT 值 = A 已提交的 2（旧 generation 对 replace 而言）
    expect(runtime.getSchemaEnvelope()?.id).toBe('ns-1');
    expect(runtime.getActiveSchema()?.id).toBe('ns-1');
    expect(readValue(runtime, ['n'])).toBe(2);
    await sleep(25);
    expect(runtime.getSchemaEnvelope()?.id).toBe('ns-1'); // R 尚未执行（A 的 notifier 仍挂住）
    expect(order).toEqual([]);

    // 放行 notifier → 槽释放 → replaceSchema 才取得槽（FIFO 完成顺序 M → R）
    gateA.resolve();
    await expect(pM).resolves.toEqual({ ok: true });
    await expect(pR).resolves.toEqual({ ok: true });
    expect(order).toEqual(['M', 'R']);
    expect(notifierCalls).toBe(2);
    // transaction 后才观察新 generation
    expect(runtime.getSchemaEnvelope()?.id).toBe('ns-2b');
    expect(runtime.getActiveSchema()?.id).toBe('ns-2b');
    expect(readValue(runtime, ['n'])).toBe(2); // 未提供 root：ROOT 零修改
  });

  it('AC1 + AC5 + AC6 反向：replaceSchema 占槽（notifier 挂住）→ mutateRoot 排队；挂住期新 active tools 已安装、新 SCHEMA/ROOT 已提交', async () => {
    const doc = makeDoc();

    const gateR = deferred();
    let notifierCalls = 0;
    const { runtime } = readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
        await gateR.promise; // 首次调用（replaceSchema）挂住
      },
    });
    await waitReady(runtime);

    const order: string[] = [];
    const pR = runtime.replaceSchema({ schema: ENV2, root: { n: 20, a: 'x', b: true } });
    pR.then(
      () => order.push('R'),
      () => order.push('R'),
    );
    await expect.poll(() => notifierCalls, { interval: 10, timeout: 5_000 }).toBe(1);

    // 同 tick 排队 mutateRoot（共享 sequencer——排在 R 后）
    const pM = runtime.mutateRoot(SET_N(30));
    pM.then(
      () => order.push('M'),
      () => order.push('M'),
    );

    // AC6 时序锚：transaction 已提交（SCHEMA/ROOT 新 generation 可观测）而 notifier 未放行——
    // 此时 getActiveSchema 必须已切换新 active tools（install 先于 await notifyDirty）
    expect(runtime.getActiveSchema()?.id).toBe('ns-2');
    expect(runtime.getSchemaEnvelope()?.id).toBe('ns-2');
    expect(runtime.getStatus().schema.state).toBe('ready');
    // ROOT 新内容已提交（root 提供路径：完整 logical ROOT 替换）
    expect(readValue(runtime, ['n'])).toBe(20);
    expect(readValue(runtime, ['a'])).toBe('x');
    expect(readValue(runtime, ['b'])).toBe(true);
    await sleep(25);
    // 后项 mutateRoot 未开始（R 的 notifier 仍挂住；FIFO 屏障）
    expect(readValue(runtime, ['n'])).toBe(20);
    expect(order).toEqual([]);

    // 放行 → R 先结算、M 后执行（严格 FIFO 完成顺序）
    gateR.resolve();
    await expect(pR).resolves.toEqual({ ok: true });
    await expect(pM).resolves.toEqual({ ok: true });
    expect(order).toEqual(['R', 'M']);
    expect(notifierCalls).toBe(2);
    expect(readValue(runtime, ['n'])).toBe(30);
  });

  it('AC2 未提供 root：proposed derived 严格提取失败（载体不兼容）→ 零写入失败、SCHEMA/ROOT/active tools 不变', async () => {
    const doc = makeDoc();

    let notifierCalls = 0;
    const { runtime } = readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await waitReady(runtime);

    const updates = countUpdates(doc);
    const bytesBefore = stateBytes(doc);
    // ENV3：a 要求 Y.Array 载体，而当前 ROOT.a 是 plain string → 严格提取失败（载体不兼容）
    const settled = await settleOf(runtime.replaceSchema({ schema: ENV3 }));

    expect(settled.kind).toBe('resolved');
    if (settled.kind !== 'resolved') return;
    expect(settled.value).toMatchObject({ ok: false });
    expect(issuesOf(settled.value).length).toBeGreaterThanOrEqual(1);
    for (const issue of issuesOf(settled.value)) {
      expect(typeof issue.message).toBe('string');
      expect(Array.isArray(issue.path)).toBe(true);
    }
    // 零写入：0 更新事件、0 notifier、state 字节不变
    expect(updates.count).toBe(0);
    expect(notifierCalls).toBe(0);
    expect(stateBytes(doc)).toEqual(bytesBefore);
    // SCHEMA/ROOT/active tools 均不变
    expect(runtime.getSchemaEnvelope()?.id).toBe('ns-1');
    expect(runtime.getActiveSchema()?.id).toBe('ns-1');
    expect(readValue(runtime, ['n'])).toBe(1);
    expect(readValue(runtime, ['a'])).toBe('x');
    expect(runtime.getStatus().schema.state).toBe('ready');
  });

  it('AC2 未提供 root：proposed derived 逻辑校验失败（缺必填字段）→ 零写入失败、active tools 不变', async () => {
    const doc = makeDoc();

    let notifierCalls = 0;
    const { runtime } = readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await waitReady(runtime);

    const updates = countUpdates(doc);
    const bytesBefore = stateBytes(doc);
    // ENV2：b 为必填而当前 ROOT 无 b → 提取成功（缺键跳过）但逻辑校验失败
    const settled = await settleOf(runtime.replaceSchema({ schema: ENV2 }));

    expect(settled.kind).toBe('resolved');
    if (settled.kind !== 'resolved') return;
    expect(settled.value).toMatchObject({ ok: false });
    expect(issuesOf(settled.value).length).toBeGreaterThanOrEqual(1);
    expect(updates.count).toBe(0);
    expect(notifierCalls).toBe(0);
    expect(stateBytes(doc)).toEqual(bytesBefore);
    expect(runtime.getSchemaEnvelope()?.id).toBe('ns-1');
    expect(runtime.getActiveSchema()?.id).toBe('ns-1');
    expect(readValue(runtime, ['n'])).toBe(1);
    expect(runtime.getStatus().schema.state).toBe('ready');
  });

  it('AC3+AC4+AC5 提供 root 幸福路径：完整 logical ROOT 验证并整体替换（单事务、顶层 ROOT identity 保持、SCHEMA 恰四键）', async () => {
    const doc = makeDoc();

    let notifierCalls = 0;
    const { runtime } = readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await waitReady(runtime);

    const updates = countUpdates(doc);
    const rootBefore = doc.getMap('ROOT');
    const bytesBefore = stateBytes(doc);

    const res = await runtime.replaceSchema({ schema: ENV2, root: { ...ROOT_WITH_B } });

    expect(res).toEqual({ ok: true });
    // AC5：SCHEMA 与 ROOT 变化在同一 transaction 中原子提交（恰 1 次更新事件）
    expect(updates.count).toBe(1);
    expect(notifierCalls).toBe(1);
    // 顶层 ROOT Y.Map identity 保持（同一元素集上的内容替换，不是换 map）
    expect(doc.getMap('ROOT')).toBe(rootBefore);
    // 新内容整体安装（完整 logical ROOT）
    expect(readValue(runtime, ['n'])).toBe(2);
    expect(readValue(runtime, ['a'])).toBe('y');
    expect(readValue(runtime, ['b'])).toBe(true);
    // AC4：SCHEMA 恰四键 + 新 envelope
    assertSchemaExactlyFourKeys(doc, ENV2);
    expect(runtime.getSchemaEnvelope()).toEqual(ENV2);
    // AC6：active tools 已切换
    expect(runtime.getActiveSchema()?.id).toBe('ns-2');
    expect(stateBytes(doc)).not.toEqual(bytesBefore);
  });

  it('AC3+AC7 提供 root：逻辑校验失败（缺必填字段）→ 零写入失败、SCHEMA/ROOT/active tools 不变', async () => {
    const doc = makeDoc();

    let notifierCalls = 0;
    const { runtime } = readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await waitReady(runtime);

    const updates = countUpdates(doc);
    const bytesBefore = stateBytes(doc);
    // ENV2 需要 b，但提供的 root 缺 b → 完整逻辑 ROOT 校验失败（transaction 前）
    const settled = await settleOf(runtime.replaceSchema({ schema: ENV2, root: { n: 5, a: 'z' } }));

    expect(settled.kind).toBe('resolved');
    if (settled.kind !== 'resolved') return;
    expect(settled.value).toMatchObject({ ok: false });
    expect(issuesOf(settled.value).length).toBeGreaterThanOrEqual(1);
    expect(updates.count).toBe(0);
    expect(notifierCalls).toBe(0);
    expect(stateBytes(doc)).toEqual(bytesBefore);
    expect(runtime.getSchemaEnvelope()?.id).toBe('ns-1');
    expect(runtime.getActiveSchema()?.id).toBe('ns-1');
    expect(readValue(runtime, ['n'])).toBe(1);
    expect(readValue(runtime, ['a'])).toBe('x');
    expect(runtime.getStatus().schema.state).toBe('ready');
  });

  it('AC7 编译失败（proposed compile ok:false）→ 零写入，SCHEMA/ROOT/active tools 均不变（旧 generation 继续服务）', async () => {
    const doc = makeDoc();

    let notifierCalls = 0;
    const { runtime } = readyRuntime({
      doc,
      // P0（ns-1）真实编译成功；proposed（ns-2）确定性编译失败——替代编译必须经 seam 路由
      compile: dispatchCompile({
        'ns-2': () => injectedCompileFail('seam proposed compile fail'),
      }),
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await waitReady(runtime);

    const updates = countUpdates(doc);
    const bytesBefore = stateBytes(doc);
    const settled = await settleOf(runtime.replaceSchema({ schema: ENV2, root: { ...ROOT_WITH_B } }));

    expect(settled.kind).toBe('resolved');
    if (settled.kind !== 'resolved') return;
    expect(settled.value).toMatchObject({ ok: false });
    expect(issuesOf(settled.value).length).toBeGreaterThanOrEqual(1);
    // 编译失败发生在 transaction 前：零写入（SCHEMA/ROOT 字节不变）、0 notifier、active tools 不变
    expect(updates.count).toBe(0);
    expect(notifierCalls).toBe(0);
    expect(stateBytes(doc)).toEqual(bytesBefore);
    expect(runtime.getSchemaEnvelope()?.id).toBe('ns-1');
    expect(runtime.getActiveSchema()?.id).toBe('ns-1'); // 旧 active tools 继续服务
    expect(readValue(runtime, ['n'])).toBe(1);
    expect(runtime.getStatus().schema.state).toBe('ready');
  });

  it('AC7+AC3 非 plain 输入（shared snapshotter 拒绝）→ ok:false 含 MUTATION_INPUT_NOT_PLAIN_DATA、零写入', async () => {
    const badInputs = [
      ['schema 为 class 实例', { schema: valueOf('class-instance') }],
      ['root 携带 symbol 键', { schema: ENV2, root: valueOf('symbol-key') }],
      ['root 含非有限 number (NaN)', { schema: ENV2, root: { n: valueOf('nan'), a: 'x', b: true } }],
      ['root 循环引用', { schema: ENV2, root: valueOf('circular') }],
      ['root 含 function', { schema: ENV2, root: { n: 1, a: 'x', b: valueOf('function') } }],
    ] as Array<[string, { schema: unknown; root?: unknown }]>;

    for (const [name, input] of badInputs) {
      const doc = makeDoc();

      let notifierCalls = 0;
      const { runtime } = readyRuntime({
        doc,
        notifyDirty: async () => {
          notifierCalls += 1;
        },
      });
      await waitReady(runtime);

      const updates = countUpdates(doc);
      const bytesBefore = stateBytes(doc);
      const settled = await settleOf(runtime.replaceSchema(input));

      expect(settled.kind, `[${name}] 输入拒绝应 settle（resolved ok:false）`).toBe('resolved');
      if (settled.kind !== 'resolved') continue;
      expect(settled.value, `[${name}] 拒绝非 plain 输入属普通领域失败（ok:false 联合）`).toMatchObject({ ok: false });
      expect(hasIssueCode(settled.value, 'MUTATION_INPUT_NOT_PLAIN_DATA'), `[${name}] 稳定码`).toBe(true);
      expect(updates.count, `[${name}] 零写入（0 更新事件）`).toBe(0);
      expect(notifierCalls, `[${name}] 未提交不得登记 dirty`).toBe(0);
      expect(stateBytes(doc), `[${name}] zero-write：state 字节不变`).toEqual(bytesBefore);
      expect(runtime.getSchemaEnvelope()?.id, `[${name}] SCHEMA 不变`).toBe('ns-1');
      expect(runtime.getActiveSchema()?.id, `[${name}] active tools 不变`).toBe('ns-1');
      expect(readValue(runtime, ['n']), `[${name}] 读取保留`).toBe(1);
    }
  });

  it('AC3 排队期间输入引用可变化——槽开始时刻快照获胜（不是调用时快照）', async () => {
    const doc = makeDoc();

    const gate = deferred();
    let notifierCalls = 0;
    const { runtime } = readyRuntime({
      doc,
      p0Gate: gate.promise, // P0 挂住 → replaceSchema 排队在 P0 后
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });

    // rev2 契约（D7 投影废止）：槽起点快照的 root 必须对槽起点 schema（ns-2b，声明
    // {a,n}）原样封闭合法——故输入初始 root 不含 b（b 是调用时 schema ns-2 才声明的键，
    // 保留它会让新契约下的快照校验 ok:false，遮蔽「槽起点快照获胜」的测试意图）
    const input = { schema: { ...ENV2 }, root: { n: 1, a: 'x' } };
    const p = runtime.replaceSchema(input);
    // 调用方在排队期间改动输入引用内容（合法：快照时点 = 槽开始）
    input.schema = { ...ENV2, id: 'ns-2b', text: TEXT_V2B };
    input.root.n = 999;
    gate.resolve();

    await expect(p).resolves.toEqual({ ok: true });
    expect(notifierCalls).toBe(1);
    // 槽开始时刻快照 = 改动后的引用（999 / ns-2b），而非调用时（1 / ns-2）
    expect(readValue(runtime, ['n'])).toBe(999);
    expect(runtime.getSchemaEnvelope()?.id).toBe('ns-2b');
  });

  it('AC1+AC2+AC8：P0 schema-unavailable（当前 schema 编译失败）→ replaceSchema 合法恢复 → ROOT write 恢复可用', async () => {
    const doc = makeDoc();

    let notifierCalls = 0;
    const { runtime } = readyRuntime({
      doc,
      // 当前 schema（ns-1）编译失败 → P0 unavailable；proposed（ns-2b）真实编译成功
      compile: dispatchCompile({
        'ns-1': () => injectedCompileFail('seam p0 unavailable'),
      }),
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('unavailable');
    expect(runtime.getStatus().rootWrite.enabled).toBe(false);
    expect(runtime.getStatus().schemaWrite.enabled).toBe(true); // unavailable 态 SCHEMA write 仍可修复

    // 不依赖当前 schema 编译成功：未提供 root（ns-2b 与当前 ROOT 逻辑兼容）→ 原子替换 SCHEMA
    const updates = countUpdates(doc);
    const res = await runtime.replaceSchema({ schema: ENV2B });
    expect(res).toEqual({ ok: true });
    expect(updates.count).toBe(1);
    expect(notifierCalls).toBe(1);
    expect(runtime.getStatus().schema.state).toBe('ready');
    expect(runtime.getStatus().rootWrite.enabled).toBe(true); // ROOT write 恢复
    expect(runtime.getActiveSchema()?.id).toBe('ns-2b');
    expect(runtime.getSchemaEnvelope()?.id).toBe('ns-2b');
    assertSchemaExactlyFourKeys(doc, ENV2B);
    expect(readValue(runtime, ['n'])).toBe(1); // 未提供 root：ROOT 零修改

    // AC8 后向：ROOT write 已恢复——mutateRoot 使用新 active schema 成功提交
    await expect(runtime.mutateRoot(SET_N(7))).resolves.toEqual({ ok: true });
    expect(notifierCalls).toBe(2);
    expect(readValue(runtime, ['n'])).toBe(7);
  });

  it('AC8 persistence-degraded：replaceSchema 拒绝（RUNTIME_WRITE_DISABLED、输入零访问、零写入），不阻止 read/P0，active tools 不变', async () => {
    const doc = makeDoc();

    let notifierCalls = 0;
    const { runtime } = readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
      statusMode: 'persistence-degraded',
    });
    // degraded 不阻止 P0 → ready + active schema
    await waitReady(runtime);
    expect(runtime.getActiveSchema()).not.toBeNull();
    expect(runtime.getStatus().schemaWrite.enabled).toBe(false);
    expect(runtime.getStatus().read.enabled).toBe(true);

    const { probe, accesses } = makeReplaceInputProbe(ENV2, { ...ROOT_WITH_B });
    const updates = countUpdates(doc);
    const bytesBefore = stateBytes(doc);
    const settled = await settleOf(runtime.replaceSchema(probe));

    expect(settled.kind).toBe('resolved');
    if (settled.kind !== 'resolved') return;
    expect(settled.value).toMatchObject({ ok: false });
    expect(hasIssueCode(settled.value, 'RUNTIME_WRITE_DISABLED')).toBe(true);
    expect(accesses()).toBe(0); // 不可写时零访问输入（gate 先于快照）
    expect(updates.count).toBe(0);
    expect(notifierCalls).toBe(0);
    expect(stateBytes(doc)).toEqual(bytesBefore);
    expect(runtime.getSchemaEnvelope()?.id).toBe('ns-1');
    expect(runtime.getActiveSchema()?.id).toBe('ns-1'); // active tools 不变
    expect(readValue(runtime, ['n'])).toBe(1); // 读取保留
  });

  it('AC8 prior fatal：replaceSchema 拒绝（RUNTIME_WRITE_DISABLED、输入零访问、零写入），读取保留', async () => {
    const doc = makeDoc();

    const BOOM = 'NSRT-REPLACE-GATE-SENTINEL-2f91';
    let notifierCalls = 0;
    const { runtime } = readyRuntime({
      doc,
      compile: () => {
        throw new Error(BOOM); // P0 internal fault → 永久禁用写能力（fatal）
      },
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await expect.poll(() => runtime.getStatus().fatal, { interval: 10, timeout: 5_000 }).not.toBeNull();

    const { probe, accesses } = makeReplaceInputProbe(ENV2, { ...ROOT_WITH_B });
    const updates = countUpdates(doc);
    const bytesBefore = stateBytes(doc);
    const settled = await settleOf(runtime.replaceSchema(probe));

    expect(settled.kind).toBe('resolved');
    if (settled.kind !== 'resolved') return;
    expect(settled.value).toMatchObject({ ok: false });
    expect(hasIssueCode(settled.value, 'RUNTIME_WRITE_DISABLED')).toBe(true);
    expect(accesses()).toBe(0);
    expect(updates.count).toBe(0);
    expect(notifierCalls).toBe(0);
    expect(stateBytes(doc)).toEqual(bytesBefore);
    expect(runtime.getStatus().schemaWrite.enabled).toBe(false);
    expect(runtime.getStatus().read.enabled).toBe(true);
    expect(readValue(runtime, ['n'])).toBe(1); // 读取保留

    // 队列持续流转（FIFO 不因 fatal 断链）：再次调用仍 settle（disabled），不挂死
    const again = await settleOf(runtime.replaceSchema({ schema: ENV2B }));
    expect(again.kind).toBe('resolved');
    if (again.kind !== 'resolved') return;
    expect(again.value).toMatchObject({ ok: false });
    expect(hasIssueCode(again.value, 'RUNTIME_WRITE_DISABLED')).toBe(true);
  });
});

/**
 * SA7 动态验证测试 — issue #91 replaceSchema（SA4 静态验尸报告 §10/§12 移交项 +
 * 设计 D9 末条 fatal 注入路径 α/β/γ + SA2 §5 红线动态核验）。
 *
 * 验证对象：SA3 实现（工作树 diff）的真实运行链路（非静态推断）。补锚形式沿 #90
 * runtime-mutate-root-sa7-dynamic.test.ts 先例（SA7 新增测试文件）。
 *
 * 覆盖（SA4 §10「SA7 补锚规格」逐条）：
 * - 注入路径 α（E201 + A3 撕裂态）：doc 级 update observer 在事务提交后改坏 SCHEMA
 *   四键（delete text）→ ⑤-S verifySchemaFourKeys 检出偏离 → branded
 *   post-commit-verification committed:true → 槽内 markWriteFatal + best-effort
 *   notify 恰一次 + RuntimeWriteFatalError rejection。撕裂态五要素断言：
 *   getActiveSchema 永久旧 id / read+getSchemaEnvelope 新 generation / 双写位
 *   false / 后续写 RUNTIME_WRITE_DISABLED / status.fatal 显式标记；
 * - 注入路径 β（E203）：doc 级 update observer throw → transactGuarded 包装
 *   observer-cleanup-throw committed:true → 同 fatal 走线；
 * - 注入路径 γ（E204）：seam 注入 compile 返回 ok:true 但 derived 为手造环 ref
 *   结构 → buildTopEntries 内 makeRefResolver 环守卫 → DerivedInvariantError
 *   → ① catch instanceof 分支 → branded pre-commit-internal committed:false →
 *   rejection（**非** ok:false DOCRT-E200——A4 红线）；
 * - SA2 §5.1 A1 变体（独立动态确认）：注入 compile 畸形 ok:true envelope 四变体
 *   （多一键 / text 非 string / version 非 number / 缺 text 键）→ 一律
 *   schema-compile-throw fatal（committed:false、零写入、active tools 不变）；
 * - SA2 §5.2 A2 边界（独立动态确认，rev2 契约修订——D7 顶层投影废止）：顶层未声明
 *   键 loud（ok:false + issue path=[<k>]）、嵌套未声明键 loud、union 形 ROOT ×
 *   未声明键 loud（不投影）；
 * - AC9 时序实证：notifier 挂住窗口（前项 mutateRoot 占槽）内
 *   read/getSchemaEnvelope/getActiveSchema 观察旧 generation、transaction 后同步切换；
 * - SA4 §12 动态审核重点 4：⑥ verifySnapshotIntact 喂原样 snapshot 的对称性——嵌套
 *   Y.Array 载体（a: string[]）replace-root 快乐路径双侧提取等价。
 *
 * 断言纪律：全部经公共接缝（replaceSchema/mutateRoot/read/getSchemaEnvelope/
 * getActiveSchema/getStatus/update 事件计数/state 字节/notifier 计数）观测，
 * 不读实现内部、零源码字符串断言。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, User } from '@nomicore/persistence';
import { compileSchemaEnvelope } from '@nomicore/vfsl';
import type { CompileSchemaEnvelopeResult, DerivedSchema, SchemaEnvelope } from '@nomicore/vfsl';
import { RuntimeWriteFatalError } from '../src/index.js';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import type { NamespaceRuntime } from '../src/index.js';

// —— 契约类型（测试侧声明：replaceSchema 公共面）——

interface ReplaceSchemaIssue {
  message: string;
  path: Array<string | number>;
}

type ReplaceSchemaResult = { ok: true } | { ok: false; issues: ReplaceSchemaIssue[] };

interface ReplaceSchemaRuntime extends NamespaceRuntime {
  replaceSchema: (input: { schema: unknown; root?: unknown }) => Promise<ReplaceSchemaResult>;
}

// —— fixture ——

const OWNER: User = { userId: 'u-alice' };
/** v1 现有 schema（P0 编译用，id ns-1）。 */
const TEXT_V1 = 'type ROOT = { n: number; a: string; };';
const ENV1: Readonly<SchemaEnvelope> = { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_V1 };
/** v2b：与 v1 同逻辑形状（字段重排）——replace-root / keep-root 均可。 */
const TEXT_V2B = 'type ROOT = { a: string; n: number; };';
const ENV2B: Readonly<SchemaEnvelope> = { lang: 'vfsl', version: 1, id: 'ns-2b', text: TEXT_V2B };
/** 嵌套 schema：嵌套未声明键 loud 用（inner 封闭对象只声明 x）。 */
const TEXT_NESTED = 'type ROOT = { inner: { x: number; }; };';
const ENV_NESTED: Readonly<SchemaEnvelope> = { lang: 'vfsl', version: 1, id: 'ns-nest', text: TEXT_NESTED };
/** union 形 ROOT：顶层节点 kind=union → D7 不投影（交下游严格拒绝）。 */
const TEXT_UNION = 'type ROOT = { a: number; } | { b: string; };';
const ENV_UNION: Readonly<SchemaEnvelope> = { lang: 'vfsl', version: 1, id: 'ns-union', text: TEXT_UNION };
/** 嵌套载体 schema：a 为 string[]（Y.Array 物化）——⑥ 双侧提取等价用。 */
const TEXT_ARR = 'type ROOT = { n: number; a: string[]; };';
const ENV_ARR: Readonly<SchemaEnvelope> = { lang: 'vfsl', version: 1, id: 'ns-arr', text: TEXT_ARR };

const ROOT0 = { n: 1, a: 'x' };
const SET_N = (value: unknown) => ({ op: 'set', path: ['n'], value });

/** SCHEMA 写槽 fatal 摘要稳定码（errors.ts append-only 新码——status.fatal 来源判别）。 */
const FATAL_SCHEMA_CODE = 'NSRT-FATAL-SCHEMA-WRITE-INTERNAL';

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

function countUpdates(doc: Y.Doc): { count: number } {
  const counter = { count: 0 };
  doc.on('update', () => {
    counter.count += 1;
  });
  return counter;
}

function readValue(runtime: NamespaceRuntime, path: readonly (string | number)[]): unknown {
  const read = runtime.read(path);
  if (!read.ok) throw new Error(`读取应成功，实际 code=${read.code}`);
  return read.value;
}

/** 受控 seam fake handle（真实 ready 状态机，无额外行为）。 */
function makeFakeHandle(doc: Y.Doc): DocHandle {
  return {
    owner: OWNER,
    docId: 'ns-1',
    doc,
    getStatus: () => 'ready' as const,
    release: async () => {},
  } as unknown as DocHandle;
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

function readyRuntime(opts: {
  doc: Y.Doc;
  compile?: (envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult;
  notifyDirty: () => Promise<void>;
}): ReplaceSchemaRuntime {
  const input: Record<string, unknown> = {
    handle: makeFakeHandle(opts.doc),
    notifyDirty: opts.notifyDirty,
  };
  if (opts.compile !== undefined) input.compile = opts.compile;
  return createNamespaceRuntimeWithSeam(input as never) as unknown as ReplaceSchemaRuntime;
}

async function waitReady(runtime: NamespaceRuntime): Promise<void> {
  await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
}

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

function hasIssueCode(value: unknown, code: string): boolean {
  return issuesOf(value).some((issue) => JSON.stringify(issue).includes(code));
}

/** 按 envelope.id 分发的 compile 构造器（P0 与 replaceSchema 共用同一 seam 注入）。 */
function dispatchCompile(
  handlers: Record<string, (envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult>,
): (envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult {
  return (envelope) => {
    const h = handlers[envelope.id];
    if (h !== undefined) return h(envelope);
    return compileSchemaEnvelope(envelope);
  };
}

/** 注入 compile：真实编译成功后篡改 envelope（A1 变体——畸形 ok:true）。 */
function compileWithEnvelopePatch(
  patch: (env: Record<string, unknown>) => void,
): (envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult {
  return (envelope) => {
    const real = compileSchemaEnvelope(envelope);
    if (!real.ok) return real;
    const env = { ...real.envelope } as Record<string, unknown>;
    patch(env);
    return { ...real, envelope: env } as unknown as CompileSchemaEnvelopeResult;
  };
}

// —— 注入路径 α（E201 + A3 撕裂态五要素）——

describe('SA7 动态验证 — replaceSchema fatal 通道注入路径 α：observer 改坏 SCHEMA 四键 → E201 + 撕裂态', () => {
  it('α doc observer 提交后删 SCHEMA.text → rejection phase=post-commit-verification/committed=true；撕裂五要素 + best-effort notify 恰一次 + 后续写 DISABLED', async () => {
    const doc = makeDoc();
    let notifierCalls = 0;
    const runtime = readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await waitReady(runtime);

    // 事务提交后一次性改坏 SCHEMA 四键（⑤-S 检测窗口：tx-guard 只守入口，⑤-S 收编）
    let armed = true;
    doc.on('update', () => {
      if (!armed) return;
      armed = false;
      doc.getMap('SCHEMA').delete('text');
    });

    const updates = countUpdates(doc);
    const settled = await settleOf(runtime.replaceSchema({ schema: ENV2B, root: { n: 999, a: 'x' } }));

    // fatal 走 rejection（非 ok:false 二态联合）
    expect(settled.kind).toBe('rejected');
    if (settled.kind !== 'rejected') return;
    expect(settled.reason).toBeInstanceOf(RuntimeWriteFatalError);
    const fatal = settled.reason as RuntimeWriteFatalError;
    expect(fatal.phase).toBe('post-commit-verification'); // E201 透传
    expect(fatal.committed).toBe(true); // 事务已提交——诚实 committed:true
    expect(fatal.message).toContain('NSRT-WRITE-FATAL');
    expect(fatal.message).toContain('SCHEMA write');
    expect(fatal.message).toContain('phase=post-commit-verification');
    expect(fatal.message).toContain('committed=true');

    // committed:true → 槽内 best-effort notifyDirty 恰一次；事务已 live commit
    expect(notifierCalls).toBe(1);
    expect(updates.count).toBeGreaterThanOrEqual(1);

    // ── A3 撕裂态五要素 ──
    // ① getActiveSchema 永久停留旧 id（installActive 未执行；本 Runtime 生命周期内不再切换）
    expect(runtime.getActiveSchema()?.id).toBe('ns-1');
    // ② read/getSchemaEnvelope 观察已提交的新 generation（读取以 live doc 为准）
    expect(runtime.getSchemaEnvelope()?.id).toBe('ns-2b');
    expect(readValue(runtime, ['n'])).toBe(999);
    expect(readValue(runtime, ['a'])).toBe('x');
    // doc 保持 observer 留下的实际状态（不回滚、不补偿——E201 文案承诺）
    expect([...doc.getMap('SCHEMA').keys()].sort()).toEqual(['id', 'lang', 'version']);
    expect(runtime.getSchemaEnvelope()?.text).toBeUndefined(); // text 已被 observer 删除（键省略投影）
    // ③ 双写位 false（fatal 永久禁写）
    const status = runtime.getStatus();
    expect(status.rootWrite.enabled).toBe(false);
    expect(status.schemaWrite.enabled).toBe(false);
    // ⑤ status.fatal 显式标记（撕裂态被显式标记，不静默冒充健康；来源码可判别）
    expect(status.fatal).not.toBeNull();
    expect(status.fatal!.code).toBe(FATAL_SCHEMA_CODE);
    expect(status.read.enabled).toBe(true); // 永久禁写保读

    // ④ 后续写一律 RUNTIME_WRITE_DISABLED（队列持续流转不挂死）
    const bytesAfter = stateBytes(doc);
    const followRoot = await settleOf(runtime.mutateRoot(SET_N(7)));
    expect(followRoot.kind).toBe('resolved');
    if (followRoot.kind !== 'resolved') return;
    expect(followRoot.value).toMatchObject({ ok: false });
    expect(hasIssueCode(followRoot.value, 'RUNTIME_WRITE_DISABLED')).toBe(true);

    const followSchema = await settleOf(runtime.replaceSchema({ schema: ENV2B }));
    expect(followSchema.kind).toBe('resolved');
    if (followSchema.kind !== 'resolved') return;
    expect(followSchema.value).toMatchObject({ ok: false });
    expect(hasIssueCode(followSchema.value, 'RUNTIME_WRITE_DISABLED')).toBe(true);

    // 撕裂态永久：后续读面不变（active 仍旧 id × live doc 仍新 generation）
    expect(updates.count).toBeGreaterThanOrEqual(1); // 无新事务（disabled 零写入）
    expect(stateBytes(doc)).toEqual(bytesAfter);
    expect(runtime.getActiveSchema()?.id).toBe('ns-1');
    expect(runtime.getSchemaEnvelope()?.id).toBe('ns-2b');
    expect(readValue(runtime, ['n'])).toBe(999);
  });
});

// —— 注入路径 β（E203 observer-cleanup-throw）——

describe('SA7 动态验证 — replaceSchema fatal 通道注入路径 β：observer throw → E203', () => {
  it('β doc observer throw → rejection phase=observer-cleanup-throw/committed=true；事务已提交、best-effort notify 恰一次、撕裂（active 旧 × live 新）、后续写 DISABLED', async () => {
    const doc = makeDoc();
    let notifierCalls = 0;
    const runtime = readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await waitReady(runtime);

    const updates = countUpdates(doc); // 先登记计数器（注册序在 thrower 之前）
    doc.on('update', () => {
      throw new Error('sa7-observer-boom');
    });

    const bytesBefore = stateBytes(doc);
    const settled = await settleOf(runtime.replaceSchema({ schema: ENV2B }));

    expect(settled.kind).toBe('rejected');
    if (settled.kind !== 'rejected') return;
    expect(settled.reason).toBeInstanceOf(RuntimeWriteFatalError);
    const fatal = settled.reason as RuntimeWriteFatalError;
    expect(fatal.phase).toBe('observer-cleanup-throw'); // E203 透传（transactGuarded 包装）
    expect(fatal.committed).toBe(true); // 事务已提交（yjs 提交不因 observer 逃逸撤销）
    expect(fatal.message).toContain('phase=observer-cleanup-throw');
    expect(fatal.cause).toBeInstanceOf(Error); // 原始异常零信息损失保留

    // 事务已 live commit：SCHEMA 四键新内容在 live doc 上（doc 保持事务留下的实际状态）
    expect(updates.count).toBe(1);
    expect(stateBytes(doc)).not.toEqual(bytesBefore);
    expect(runtime.getSchemaEnvelope()?.id).toBe('ns-2b');
    expect([...doc.getMap('SCHEMA').keys()].sort()).toEqual(['id', 'lang', 'text', 'version']);

    // best-effort notify 恰一次；撕裂（active 旧 id × live 新 generation）；双写位 false
    expect(notifierCalls).toBe(1);
    expect(runtime.getActiveSchema()?.id).toBe('ns-1');
    const status = runtime.getStatus();
    expect(status.fatal!.code).toBe(FATAL_SCHEMA_CODE);
    expect(status.rootWrite.enabled).toBe(false);
    expect(status.schemaWrite.enabled).toBe(false);

    // 后续写 DISABLED（队列流转）+ 读取保留
    const follow = await settleOf(runtime.mutateRoot(SET_N(7)));
    expect(follow.kind).toBe('resolved');
    if (follow.kind !== 'resolved') return;
    expect(hasIssueCode(follow.value, 'RUNTIME_WRITE_DISABLED')).toBe(true);
    expect(readValue(runtime, ['n'])).toBe(1); // keep-root：ROOT 未被触碰
  });
});

// —— 注入路径 γ（E204 pre-commit-internal，A4 红线）——

describe('SA7 动态验证 — replaceSchema fatal 通道注入路径 γ：手造环 ref derived → E204', () => {
  it('γ seam 注入 compile 返回 ok:true + 环 ref derived → rejection phase=pre-commit-internal/committed=false（非 E200 ok:false）、零写入', async () => {
    const doc = makeDoc();
    let notifierCalls = 0;
    const runtime = readyRuntime({
      doc,
      // P0（ns-1）真实编译；proposed（ns-2b）注入手造环 ref derived（合规调用者不可达）
      compile: dispatchCompile({
        'ns-2b': (envelope) => {
          const real = compileSchemaEnvelope(envelope);
          if (!real.ok) return real;
          // 手造环 ref：structure.node=ref A，aliases.A=ref A（resolve.ts 环守卫 →
          // DerivedInvariantError → seam ① catch instanceof 分支 → E204）
          const cyclic = {
            ...real.derived,
            structure: { kind: 'root', node: { kind: 'ref', name: 'SA7CYC' } },
            aliases: { ...real.derived.aliases, SA7CYC: { kind: 'ref', name: 'SA7CYC' } },
          } as unknown as DerivedSchema;
          return { ...real, derived: cyclic } as unknown as CompileSchemaEnvelopeResult;
        },
      }),
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await waitReady(runtime);

    const updates = countUpdates(doc);
    const bytesBefore = stateBytes(doc);
    // 提供 root → 走 buildTopEntries → makeRefResolver 环守卫（A4 登记路径）
    const settled = await settleOf(runtime.replaceSchema({ schema: ENV2B, root: { n: 999, a: 'x' } }));

    // A4 红线：必须是 branded rejection（pre-commit-internal），而非 ok:false DOCRT-E200
    expect(settled.kind).toBe('rejected');
    if (settled.kind !== 'rejected') return;
    expect(settled.reason).toBeInstanceOf(RuntimeWriteFatalError);
    const fatal = settled.reason as RuntimeWriteFatalError;
    expect(fatal.phase).toBe('pre-commit-internal'); // E204 透传
    expect(fatal.committed).toBe(false); // 写前 internal——确定零写入
    expect(fatal.cause).toBeInstanceOf(Error); // 原始 DerivedInvariantError 保留

    // committed:false → 不调用 dirty notifier；零写入（字节不变）；SCHEMA/ROOT/active 均不变
    expect(notifierCalls).toBe(0);
    expect(updates.count).toBe(0);
    expect(stateBytes(doc)).toEqual(bytesBefore);
    expect(runtime.getSchemaEnvelope()?.id).toBe('ns-1');
    expect(runtime.getActiveSchema()?.id).toBe('ns-1');
    expect(readValue(runtime, ['n'])).toBe(1);

    // fatal 置位（NSRT-FATAL-SCHEMA-WRITE-INTERNAL）+ 永久禁写保读
    const status = runtime.getStatus();
    expect(status.fatal!.code).toBe(FATAL_SCHEMA_CODE);
    expect(status.rootWrite.enabled).toBe(false);
    expect(status.schemaWrite.enabled).toBe(false);
    expect(status.read.enabled).toBe(true);
  });
});

// —— SA2 §5.1 A1 变体：畸形 ok:true envelope → schema-compile-throw fatal（独立动态确认）——

describe('SA7 动态验证 — SA2 §5.1 A1：注入 compile 畸形 ok:true envelope 四变体 → schema-compile-throw fatal', () => {
  const variants: Array<[string, (env: Record<string, unknown>) => void]> = [
    ['envelope 多一键（extra）', (env) => { env.extra = 1; }],
    ['text 非 string（42）', (env) => { env.text = 42; }],
    ['version 非 number（"1"）', (env) => { env.version = '1'; }],
    ['缺 text 键', (env) => { delete env.text; }],
  ];

  it('A1 四变体全部 RuntimeWriteFatalError rejection（phase=schema-compile-throw、committed=false、零写入、active tools 不变）', async () => {
    for (const [name, patch] of variants) {
      const doc = makeDoc();
      let notifierCalls = 0;
      const runtime = readyRuntime({
        doc,
        compile: dispatchCompile({ 'ns-2b': compileWithEnvelopePatch(patch) }),
        notifyDirty: async () => {
          notifierCalls += 1;
        },
      });
      await waitReady(runtime);

      const updates = countUpdates(doc);
      const bytesBefore = stateBytes(doc);
      const settled = await settleOf(runtime.replaceSchema({ schema: ENV2B, root: { n: 999, a: 'x' } }));

      // A1 红线：畸形 ok:true 是 internal 产物劣化 → fatal loud，绝不降级为 ok:false
      expect(settled.kind, `[${name}] 应为 fatal rejection（非 ok:false）`).toBe('rejected');
      if (settled.kind !== 'rejected') continue;
      expect(settled.reason, `[${name}] RuntimeWriteFatalError`).toBeInstanceOf(RuntimeWriteFatalError);
      const fatal = settled.reason as RuntimeWriteFatalError;
      expect(fatal.phase, `[${name}] phase`).toBe('schema-compile-throw');
      expect(fatal.committed, `[${name}] committed=false（结构上先于一切 doc 写）`).toBe(false);

      // 零写入五件套 + active tools 不变 + fatal 摘要可判别
      expect(notifierCalls, `[${name}] 0 notifier`).toBe(0);
      expect(updates.count, `[${name}] 0 update`).toBe(0);
      expect(stateBytes(doc), `[${name}] state 字节不变`).toEqual(bytesBefore);
      expect(runtime.getSchemaEnvelope()?.id, `[${name}] SCHEMA 不变`).toBe('ns-1');
      expect(runtime.getActiveSchema()?.id, `[${name}] active tools 不变`).toBe('ns-1');
      expect(runtime.getStatus().fatal?.code, `[${name}] fatal 摘要码`).toBe(FATAL_SCHEMA_CODE);
    }
  });
});

// —— SA2 §5.2 A2 边界：顶层未声明键响亮拒绝 × 嵌套 loud × union 不投影（独立动态确认；
//    rev2 契约修订——D7「顶层声明域投影」废止，provided root 原样封闭校验）——

describe('SA7 动态验证 — SA2 §5.2 A2（rev2 契约）：provided root 未声明键响亮拒绝边界', () => {
  it('R2-1 顶层未声明键：ns-2b（声明 {a,n}）× root 含未声明顶层键 b → ok:false、issue 指向 b（path=["b"]）、0 update、0 notifier、state 字节不变、SCHEMA/ROOT/active tools 三不变', async () => {
    const doc = makeDoc();
    let notifierCalls = 0;
    const runtime = readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await waitReady(runtime);

    const updates = countUpdates(doc);
    const bytesBefore = stateBytes(doc);
    const rootBefore = doc.getMap('ROOT');
    const settled = await settleOf(runtime.replaceSchema({ schema: ENV2B, root: { n: 999, a: 'x', b: true } }));

    // 新契约（issue #91 AC3 / ADR 0008 §SCHEMA write 第 3 条）：provided root 是完整最终
    // logical ROOT——未声明顶层键与嵌套未知键同族响亮拒绝，绝不先剥离输入再校验
    expect(settled.kind).toBe('resolved');
    if (settled.kind !== 'resolved') return;
    expect(settled.value).toMatchObject({ ok: false });
    // issue 明确指向未知顶层键：path 恰为 ["b"] 且 message 点名该键（验证/构造双 loud 任一）
    const issues = issuesOf(settled.value);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    const bIssue = issues.find((i) => i.path.length === 1 && i.path[0] === 'b');
    expect(bIssue).toBeDefined();
    if (bIssue === undefined) return;
    expect(bIssue.message).toContain('"b"');
    // 失败零写入：0 Yjs update、0 dirty notifier、state 字节不变
    expect(updates.count).toBe(0);
    expect(notifierCalls).toBe(0);
    expect(stateBytes(doc)).toEqual(bytesBefore);
    // SCHEMA / ROOT / active tools 三不变（旧 generation 继续服务）
    expect(runtime.getSchemaEnvelope()?.id).toBe('ns-1');
    expect(runtime.getActiveSchema()?.id).toBe('ns-1');
    expect(doc.getMap('ROOT')).toBe(rootBefore);
    expect([...rootBefore.keys()].sort()).toEqual(['a', 'n']);
    expect(rootBefore.has('b')).toBe(false);
    expect(readValue(runtime, ['n'])).toBe(1);
    expect(readValue(runtime, ['a'])).toBe('x');
    // 普通领域失败：不升 fatal、写能力保留（非注入型）
    expect(runtime.getStatus().fatal).toBeNull();
    expect(runtime.getStatus().schemaWrite.enabled).toBe(true);
  });

  it('A2-嵌套 loud：嵌套未声明键 y → ok:false 且 issue 指明未声明键、零写入', async () => {
    const doc = makeDoc();
    let notifierCalls = 0;
    const runtime = readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await waitReady(runtime);

    const updates = countUpdates(doc);
    const bytesBefore = stateBytes(doc);
    const settled = await settleOf(runtime.replaceSchema({ schema: ENV_NESTED, root: { inner: { x: 1, y: 2 } } }));

    expect(settled.kind).toBe('resolved');
    if (settled.kind !== 'resolved') return;
    expect(settled.value).toMatchObject({ ok: false }); // 嵌套层保持响亮拒绝（F7 严格性）
    const joined = issuesOf(settled.value).map((i) => i.message).join(' | ');
    expect(joined).toMatch(/未声明|"y"/); // issue 明示未声明键 y（validate「未知字段」/build F7 双 loud 之一）
    expect(joined).toContain('y');
    expect(updates.count).toBe(0);
    expect(notifierCalls).toBe(0);
    expect(stateBytes(doc)).toEqual(bytesBefore);
    expect(runtime.getSchemaEnvelope()?.id).toBe('ns-1');
    expect(runtime.getActiveSchema()?.id).toBe('ns-1');
  });

  it('A2-union 不投影：union 形 ROOT × 未声明顶层键 → loud 失败零写入（无静默剥离）', async () => {
    const doc = makeDoc();
    let notifierCalls = 0;
    const runtime = readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await waitReady(runtime);

    const updates = countUpdates(doc);
    const bytesBefore = stateBytes(doc);
    // union 形 root 不投影（D7 边界登记）——extra 未被任何成员声明 → 下游严格拒绝
    const settled = await settleOf(runtime.replaceSchema({ schema: ENV_UNION, root: { a: 1, extra: 2 } }));

    expect(settled.kind).toBe('resolved');
    if (settled.kind !== 'resolved') return;
    expect(settled.value).toMatchObject({ ok: false });
    expect(issuesOf(settled.value).length).toBeGreaterThanOrEqual(1);
    expect(updates.count).toBe(0);
    expect(notifierCalls).toBe(0);
    expect(stateBytes(doc)).toEqual(bytesBefore);
    expect(runtime.getSchemaEnvelope()?.id).toBe('ns-1');
    expect(runtime.getActiveSchema()?.id).toBe('ns-1');
  });
});

// —— AC9 时序实证：notifier 挂住窗口观察旧 generation、transaction 后同步切换 ——

describe('SA7 动态验证 — AC9 时序：准备期观察旧 committed generation、transaction 后同步切换', () => {
  it('AC9 前项 mutateRoot notifier 挂住 → replaceSchema 排队窗口三读面均观察旧 generation；放行后 transaction 提交并同步切换', async () => {
    const doc = makeDoc();
    const gateA = deferred();
    let notifierCalls = 0;
    const runtime = readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
        await gateA.promise; // 首次调用（mutateRoot）挂住——replaceSchema 排队窗口
      },
    });
    await waitReady(runtime);

    const order: string[] = [];
    const pM = runtime.mutateRoot(SET_N(2));
    pM.then(
      () => order.push('M'),
      () => order.push('M'),
    );
    await expect.poll(() => notifierCalls, { interval: 10, timeout: 5_000 }).toBe(1);

    const pR = runtime.replaceSchema({ schema: ENV2B, root: { n: 42, a: 'q' } });
    pR.then(
      () => order.push('R'),
      () => order.push('R'),
    );

    // 排队窗口：三读面全部观察旧 committed generation（ns-1 / ROOT n=2 为 M 已提交值）
    expect(runtime.getSchemaEnvelope()?.id).toBe('ns-1');
    expect(runtime.getActiveSchema()?.id).toBe('ns-1');
    expect(readValue(runtime, ['n'])).toBe(2);
    await sleep(25); // 给足微任务余量——若 R 提前提交此处即暴露
    expect(runtime.getSchemaEnvelope()?.id).toBe('ns-1');
    expect(runtime.getActiveSchema()?.id).toBe('ns-1');
    expect(readValue(runtime, ['n'])).toBe(2);
    expect(order).toEqual([]); // R 未完成（FIFO 屏障）

    // 放行 → R 取得槽 → transaction 提交 → 读面同步切换新 generation
    gateA.resolve();
    await expect(pM).resolves.toEqual({ ok: true });
    await expect(pR).resolves.toEqual({ ok: true });
    expect(order).toEqual(['M', 'R']);
    expect(notifierCalls).toBe(2);
    expect(runtime.getSchemaEnvelope()?.id).toBe('ns-2b');
    expect(runtime.getActiveSchema()?.id).toBe('ns-2b');
    expect(readValue(runtime, ['n'])).toBe(42);
    expect(readValue(runtime, ['a'])).toBe('q');
  });
});

// —— SA4 §12 动态审核重点 4：⑥ verifySnapshotIntact 喂原样 snapshot × 嵌套 Y.Array 载体 ——

describe('SA7 动态验证 — ⑥ 对称性：嵌套 Y.Array 载体 replace-root 快乐路径', () => {
  it('⑥ ns-arr（a: string[]）× root {n:5,a:["x","y"]} → ok:true；真实 Y.Array 载体安装、路径下钻可读、⑥ 双侧提取等价', async () => {
    const doc = makeDoc();
    let notifierCalls = 0;
    const runtime = readyRuntime({
      doc,
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await waitReady(runtime);

    const updates = countUpdates(doc);
    const rootBefore = doc.getMap('ROOT');
    const settled = await settleOf(runtime.replaceSchema({ schema: ENV_ARR, root: { n: 5, a: ['x', 'y'] } }));

    expect(settled.kind).toBe('resolved');
    if (settled.kind !== 'resolved') return;
    expect(settled.value).toEqual({ ok: true }); // ⑥ 喂原样 snapshot 后对称重物化通过
    expect(updates.count).toBe(1);
    expect(notifierCalls).toBe(1);
    // 顶层 ROOT identity 保持
    expect(doc.getMap('ROOT')).toBe(rootBefore);
    // 真实 yjs 载体安装：a 是 Y.Array（非 plain array 序列化旁路）
    expect(doc.getMap('ROOT').get('a')).toBeInstanceOf(Y.Array);
    // 读取面（载体投影）：深拷贝数组 + 严格整数段下钻
    expect(readValue(runtime, ['a'])).toEqual(['x', 'y']);
    expect(readValue(runtime, ['a', 0])).toBe('x');
    expect(readValue(runtime, ['a', 1])).toBe('y');
    expect(readValue(runtime, ['n'])).toBe(5);
    expect(runtime.getActiveSchema()?.id).toBe('ns-arr');
  });
});

// —— 注入路径 δ（rev2，评审项 5/SA8 裁决 C）：provide-root × 手造派生物裸 throw → E206 ——

describe('SA7 动态验证 — replaceSchema fatal 通道注入路径 δ：非 map 形 structure node 裸 throw → E206 pre-commit-internal（rev2）', () => {
  it('δ seam 注入 compile 返回 ok:true + structure.node=42（非 map 形手造派生物）→ 现 resolved ok:false(DOCRT-E200) → 绿 rejection phase=pre-commit-internal committed=false cause 含 DOCRT-E206、零写入', async () => {
    const doc = makeDoc();
    let notifierCalls = 0;
    const runtime = readyRuntime({
      doc,
      // P0（ns-1）真实编译；proposed（ns-2b）注入 structure.node=42 的手造派生物——
      // assertCompiledShape 不查 structure、validateLogicalSnapshot 只读 derived.values、
      // makeRefResolver.resolve(42) 不进 ref 循环不 throw —— 裸 throw 唯一落在
      // buildTopEntries→rootEntries 的「ROOT 结构节点非 map 形（手造派生物）」
      compile: dispatchCompile({
        'ns-2b': (envelope) => {
          const real = compileSchemaEnvelope(envelope);
          if (!real.ok) return real;
          const derived = {
            ...real.derived,
            structure: { kind: 'root', node: 42 },
          } as unknown as DerivedSchema;
          return { ...real, derived } as unknown as CompileSchemaEnvelopeResult;
        },
      }),
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await waitReady(runtime);

    const updates = countUpdates(doc);
    const bytesBefore = stateBytes(doc);
    const settled = await settleOf(runtime.replaceSchema({ schema: ENV2B, root: { n: 999, a: 'x' } }));

    // rev2 红线（评审项 5）：非 sentinel 未知异常必须 fatal 化——绝不降级为
    // ok:false DOCRT-E200（internal 缺陷伪装成领域失败 = A4 红线同族分级漂移）。
    // 【红灯现状】：settle resolved {ok:false, issues:[DOCRT-E200…]} → 断言失败。
    expect(settled.kind, '应为 fatal rejection（非 ok:false domain result）').toBe('rejected');
    if (settled.kind !== 'rejected') return;
    expect(settled.reason).toBeInstanceOf(RuntimeWriteFatalError);
    const fatal = settled.reason as RuntimeWriteFatalError;
    expect(fatal.phase).toBe('pre-commit-internal'); // E206 透传
    expect(fatal.committed).toBe(false); // 唯一事务尚未开始——确定零写入
    expect(fatal.cause).toBeInstanceOf(Error); // 原始异常经 cause 保留
    if (fatal.cause instanceof Error) {
      expect(fatal.cause.message).toContain('DOCRT-E206');
    }

    // T3.2 零写入面：notifier 恰 0、0 update、字节不变、SCHEMA/ROOT/active 不变；
    // fatal 摘要置位（SCHEMA 槽独立码）；读照常；后续两写 RUNTIME_WRITE_DISABLED
    expect(notifierCalls).toBe(0);
    expect(updates.count).toBe(0);
    expect(stateBytes(doc)).toEqual(bytesBefore);
    expect(runtime.getSchemaEnvelope()?.id).toBe('ns-1');
    expect(runtime.getActiveSchema()?.id).toBe('ns-1');
    expect(readValue(runtime, ['n'])).toBe(1);
    const status = runtime.getStatus();
    expect(status.fatal!.code).toBe(FATAL_SCHEMA_CODE);
    expect(status.rootWrite.enabled).toBe(false);
    expect(status.schemaWrite.enabled).toBe(false);
    expect(status.read.enabled).toBe(true);

    const bytesAfter = stateBytes(doc);
    const followRoot = await settleOf(runtime.mutateRoot(SET_N(7)));
    expect(followRoot.kind).toBe('resolved');
    if (followRoot.kind === 'resolved') {
      expect(followRoot.value).toMatchObject({ ok: false });
      expect(hasIssueCode(followRoot.value, 'RUNTIME_WRITE_DISABLED')).toBe(true);
    }
    const followSchema = await settleOf(runtime.replaceSchema({ schema: ENV2B }));
    expect(followSchema.kind).toBe('resolved');
    if (followSchema.kind === 'resolved') {
      expect(followSchema.value).toMatchObject({ ok: false });
      expect(hasIssueCode(followSchema.value, 'RUNTIME_WRITE_DISABLED')).toBe(true);
    }
    expect(stateBytes(doc)).toEqual(bytesAfter); // 后续写零字节变化
  });
});

// —— ε 路径（rev2，SA2 R1 #1.4）：真实深 doc × keep-root → 领域级 E 层吸收（T3.4）——

describe('SA7 动态验证 — T3.4（rev2）：深 doc × keep-root → E 层吸收为领域失败 + 零写入 + fatal 零置位 + provide-root 修复通道开放', () => {
  const DEEP = 20_000; // rev2 标定先例值（materialize-root-rev2:365-367：depth≥10_000 溢出确定、20_000 留 2× 余量）

  function deepSchemaText(): string {
    let text = '';
    for (let i = 0; i < DEEP; i++) text += `type N${i} = { n: N${i + 1} };\n`;
    text += `type N${DEEP} = { n: number };\n`;
    text += `type ROOT = N0;`;
    return text;
  }

  function makeDeepDoc(): Y.Doc {
    const doc = new Y.Doc();
    const sc = doc.getMap('SCHEMA');
    sc.set('lang', 'vfsl');
    sc.set('version', 1);
    sc.set('id', 'ns-deep');
    sc.set('text', deepSchemaText());
    doc.getMap('META').set('docId', 'ns-1');
    doc.getMap('META').set('createdAt', 1_700_000_000_000);
    // 迭代构建嵌套（构建本身零递归；extract walk 由派生结构驱动、按 doc 实深下钻）
    let cur = doc.getMap('ROOT');
    for (let i = 0; i < DEEP; i++) {
      const next = new Y.Map<unknown>();
      cur.set('n', next);
      cur = next;
    }
    cur.set('n', 1);
    cur.set('x', 'bottom');
    doc.getMap('ROOT').set('a', 'shallow');
    return doc;
  }

  it('深 doc × keep-root replaceSchema({schema: ENV_DEEP}) → resolved ok:false（/DOCRT-E100|VFSL-E100|校验工作预算耗尽/）+ 零写入 + fatal 零置位 + 写位未禁（运行时修复通道开放）；同 runtime provide-root 修复尝试的实测结果按 SA6 偏差锚登记（见注释）',
    { timeout: 60_000 }, async () => {
      const doc = makeDeepDoc();
      let notifierCalls = 0;
      const ENV_DEEP = { lang: 'vfsl', version: 1, id: 'ns-deep', text: deepSchemaText() } as const;
      const runtime = readyRuntime({
        doc,
        notifyDirty: async () => {
          notifierCalls += 1;
        },
      });
      // 预检 fixture 可用性：P0 真实编译深 schema 结算 ready（深 schema 可编译）；
      // 浅路径 read 照常（runtime 可用）
      await waitReady(runtime);
      expect(runtime.getStatus().fatal).toBeNull();
      expect(readValue(runtime, ['a'])).toBe('shallow');

      const updates = countUpdates(doc);
      const bytesBefore = stateBytes(doc);
      const settled = await settleOf(runtime.replaceSchema({ schema: ENV_DEEP })); // keep-root

      // 领域级失败（非 fatal）：doc 源深度溢出 extract/validate 各自的全函数体崩溃边界
      // ——哪层先吸收非契约面（断言按「任一 E 层吸收」书写）
      expect(settled.kind).toBe('resolved');
      if (settled.kind !== 'resolved') return;
      expect(settled.value).toMatchObject({ ok: false });
      const joined = issuesOf(settled.value).map((i) => i.message).join(' | ');
      expect(joined).toMatch(/DOCRT-E100|VFSL-E100|校验工作预算耗尽/);

      // 零写入 + fatal 零置位 + 写位未被禁（keep-root 失败不锁定 Runtime——修复通道
      // 的运行时级前提；E206 不产生 = 设计 §3.2.2 修正 2/3 的行为证据）
      expect(updates.count).toBe(0);
      expect(stateBytes(doc)).toEqual(bytesBefore);
      expect(notifierCalls).toBe(0);
      const st = runtime.getStatus();
      expect(st.fatal).toBeNull();
      expect(st.rootWrite.enabled).toBe(true);
      expect(st.schemaWrite.enabled).toBe(true);
      expect(runtime.getSchemaEnvelope()?.id).toBe('ns-deep');
      expect(runtime.getActiveSchema()?.id).toBe('ns-deep');
      expect(readValue(runtime, ['a'])).toBe('shallow');

      // ── SA6 偏差锚（登记见 wiki …_sa6_anchor.md §T3.4）：同 runtime provide-root
      // 修复尝试的真实结果 ──
      // 设计 §8 T3.4 原案断言「后续 provide-root replaceSchema({schema, root: 浅完整
      // root}) ok:true——修复通道开放」。实测（Node 24）：20_000 深嵌套 Y.Map ROOT 上
      // provide-root 的 doc 级 clear+install 在 `ROOT.clear()` 触发 **yjs destroy
      // 递归栈溢出**（引擎集成限制，非 Runtime 写面锁定——此处 clear 前的写位 enabled
      // 断言即证明）→ branded rejection（phase=observer-cleanup-throw, committed:true,
      // cause=RangeError）→ 该实例 fatal。即「同 doc 原地修复」在此深度不成立；设计
      // §3.2.3.4 的「或带外重建 doc」分支是正确形态（修复通道的语义 = keep-root 失败
      // 不锁 Runtime + 修复尝试可发生且得到诚实结果，而非承诺任意深度原地可修）。
      const repair = await settleOf(runtime.replaceSchema({ schema: ENV2B, root: { n: 1, a: 'x' } }));
      expect(repair.kind).toBe('rejected');
      if (repair.kind === 'rejected') {
        const rfatal = repair.reason as RuntimeWriteFatalError;
        expect(rfatal).toBeInstanceOf(RuntimeWriteFatalError);
        expect(rfatal.phase).toBe('observer-cleanup-throw');
        expect(rfatal.committed).toBe(true);
        expect(rfatal.cause).toBeInstanceOf(Error);
        if (rfatal.cause instanceof Error) {
          expect(rfatal.cause.message).toContain('Maximum call stack size exceeded');
        }
      }
      expect(runtime.getStatus().fatal?.code).toBe(FATAL_SCHEMA_CODE);
    });
});

/**
 * SA6 红灯契约 — issue #149：NamespaceRuntime ROOT mutation / SCHEMA replacement
 * 接入 namespace 诊断变更日志（task_root-schema-diagnostic-change-log.md）。
 *
 * 红灯核心（当前 worktree 现状，2026-08-29 验证）：
 * - 依赖层：@nomicore/namespace-runtime 未依赖 @nomicore/namespace-diagnostic-log
 *   ——本文件以相对路径 import 走通（包依赖修复属 SA3）；
 * - seam 层：NamespaceRuntimeSeamInput 无诊断注入字段——本文件以
 *   `diagnosticEmitter`（NamespaceDiagnosticChangeEmitter）+ `clock`（() => number，
 *   结构兼容 @nomicore/clock 的 Clock.now / emission.ts observedAtFrom）两个约定字段经
 *   createNamespaceRuntimeWithSeam 装配；字段名即本契约锚点；
 * - 发射层：两个写槽与接纳层零 emit——以下所有「记录必须存在且分类正确」的断言在
 *   当前 worktree 全部红灯（0 记录、0 accepted）。
 *
 * 契约来源：
 * - 任务简报 AC1–AC5（objectiv 的 committed/no-op/expected-rejection/committed-aware
 *   fatal 四分类 + owned bytes + not-accessed + 故障隔离 + Proxy/accessor 零额外读取）；
 * - ADR-0011（结局/阶段词表、输入捕获四态、owned update bytes、emit 不 throw 的
 *   producer 防御义务、冒号后「日志不改变业务面」）；
 * - ADR-0012（operation/stage 封闭词表、attemptId att-+32hex、observedAt 注入 Clock）。
 *
 * 行为锚点（全部为运行时行为断言，无任何源码 grep）：
 * - 每次变更尝试（committed/rejected/fatal）恰好产生 1 条 attempt record；
 * - committed 记录携带精确事务 update bytes（设计 §6.4/§13.8 消费形态：**同源基态
 *   （事务前 pre-state，同 clientID）+ 依序增量链**重放——事务增量 left origin 依赖
 *   pre-state struct，空 Y.Doc 不物化；链式重放可观察到该次事务的真实效果；真增量对
 *   无基态空 doc 不物化的反向鉴别断言防「整文档编码」冒充）；
 * - gate/acceptance 拒绝记录 input.capture = not-accessed；快照失败记录
 *   unsafe-input 且不执行 accessor、不重读敌意输入（get trap 计数与无日志基线相等）；
 * - 日志侧故障（emitter throw、队列满）不改业务返回值、sequencer 顺序、dirty
 *   notification 与 Runtime capability。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, User } from '@nomicore/persistence';
import { createMemoryPersistence } from '@nomicore/persistence';
import { compileSchemaEnvelope } from '@nomicore/vfsl';
import { realPersistenceScheduler } from './real-persistence-scheduler.js';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import type { NamespaceRuntime } from '../src/index.js';
import {
  createBoundedMemoryDiagnosticLog,
  type AttemptRecord,
  type AttemptResult,
  type BoundedMemoryDiagnosticLog,
  type DiagnosticLogConfig,
  type NamespaceDiagnosticChangeEmitter,
  type UpdateCarrier,
} from '../../namespace-diagnostic-log/src/index.js';

// ── 固定夹具 ────────────────────────────────────────────────────────────────

const NOW_MS = 1_700_000_000_000; // 固定注入 Clock：observedAt 必须来自注入 Clock
const NOW_ISO = new Date(NOW_MS).toISOString(); // '2023-11-14T22:13:20.000Z'

const OWNER: User = { userId: 'u-alice' };
const ENVELOPE = { lang: 'vfsl', version: 1, id: 'ns-1', text: 'type ROOT = { n: number; a: string; };' } as const;
const ROOT0 = { n: 1, a: 'x' };
/** 与 ROOT0 结构兼容但文本不同的合法 schema（keep-root 通过 + 事务 update 非空）。 */
const ENV_KEEP = { lang: 'vfsl', version: 1, id: 'ns-1', text: 'type ROOT = { n: number; a: string; }; type EXTRA = { x: boolean };' } as const;
/** 新 ROOT 形状 + 提供完整 root（replace-root 通过）。 */
const ENV_REPLACE = { lang: 'vfsl', version: 1, id: 'ns-1', text: 'type ROOT = { n: number; a: string; b: boolean; };' } as const;
const ROOT_REPLACE = { n: 2, a: 'y', b: true };

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
  doc.getMap('META').set('docId', 'ns-1');
  doc.getMap('META').set('createdAt', 1_700_000_000_000);
  const root = doc.getMap('ROOT');
  for (const [k, v] of Object.entries(ROOT0)) root.set(k, v);
  return doc;
}

async function makeWriter(): Promise<{ writer: ReturnType<typeof createMemoryPersistence>; handle: DocHandle }> {
  const store = new Map<string, Uint8Array>();
  const writer = createMemoryPersistence({
    scheduler: realPersistenceScheduler,
    schedule: { debounceMs: 5, maxDirtyMs: 60 },
    writeSnapshot: async (key, snapshot) => {
      store.set(key, snapshot.slice());
    },
  });
  const handle = await writer.createDoc(OWNER, 'ns-1', makeDoc());
  return { writer, handle };
}

function makeLog(config?: Partial<DiagnosticLogConfig>): BoundedMemoryDiagnosticLog {
  return createBoundedMemoryDiagnosticLog({ inputPolicy: 'digest', updateCapture: true, ...config });
}

/** seam 装配（diagnosticEmitter/clock 字段名 = 本契约锚点；当前 seam 无此字段——
 *  传参被忽略 → 红灯）。expectedState 支持 'ready'（默认）与 'unavailable'。 */
async function makeRuntime(
  seam: Record<string, unknown>,
  expectedState: 'ready' | 'unavailable' = 'ready',
): Promise<NamespaceRuntime> {
  const runtime = createNamespaceRuntimeWithSeam(seam as never) as unknown as NamespaceRuntime;
  await expect
    .poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 })
    .toBe(expectedState);
  return runtime;
}

/** 等待 attempt record 数量达到 expected（record 计数 ≥ expected 后返回快照）。 */
async function waitAttempts(log: BoundedMemoryDiagnosticLog, expected: number): Promise<AttemptRecord[]> {
  await expect
    .poll(() => log.records().filter((r) => r.recordKind === 'attempt').length, { interval: 5, timeout: 3_000 })
    .toBe(expected);
  return log.records().filter((r): r is AttemptRecord => r.recordKind === 'attempt');
}

/** 单条记录提取（类型收窄专用——waitAttempts 已 poll 至 1 条，运行时恒非空；
 *  防御分支与原「rec 为 undefined 时属性访问 TypeError 判失败」同判失败语义）。 */
function firstAttempt(recs: AttemptRecord[]): AttemptRecord {
  const r = recs[0];
  if (r === undefined) throw new Error('waitAttempts 返回 0 条记录（poll 已保证非空——不可达防御）');
  return r;
}

/** inline carrier 的 bytes 提取（类型收窄专用——与 expect(carrier.storage==='inline')
 *  同义；防御 throw 与原断言失败同判失败语义）。 */
function inlineBytes(carrier: UpdateCarrier): Uint8Array {
  if (carrier.storage !== 'inline') throw new Error(`预期 inline carrier，实际 ${carrier.storage}`);
  return new Uint8Array(Buffer.from(carrier.base64, 'base64'));
}

/**
 * 同源基态 + 既有增量链 + 本条 carrier → 重放 doc。消费形态按设计 §6.4/§13.8：
 * 事务增量是**增量**（left origin / delete set 引用 pre-state struct）——应用到空
 * Y.Doc 不物化（P8 实测），必须从事务前基态（同 clientID）起步并依序重放 prior 增量链，
 * 这正是 ADR-0011「连续的 committed Yjs updates 可用于诊断性重放」的原生语义。
 * inline/format/payloadLength 三断言与既有面不变。
 */
function applyCarrier(carrier: UpdateCarrier, baseState: Uint8Array, prior: UpdateCarrier[] = []): Y.Doc {
  expect(carrier.storage).toBe('inline');
  expect(carrier.format).toBe('yjs-update-v1');
  const bytes = inlineBytes(carrier);
  expect(bytes.length).toBe(carrier.payloadLength);
  const fresh = new Y.Doc();
  Y.applyUpdate(fresh, baseState); // 基态先立（pre-state struct 就位——origin 可解析）
  for (const p of prior) Y.applyUpdate(fresh, inlineBytes(p));
  Y.applyUpdate(fresh, bytes); // 本条事务增量
  return fresh;
}

/** §13.8d 反向鉴别：真事务增量对无基态空 doc 不物化——若 producer 回归为「事务后整
 *  文档编码」冒充则 ROOT/SCHEMA 必然物化、本断言立即红（防冒充回归；P8 实测钉死）。 */
function expectNoMaterializeWithoutBase(carrier: UpdateCarrier): void {
  const empty = new Y.Doc();
  Y.applyUpdate(empty, inlineBytes(carrier));
  expect(empty.getMap('ROOT').size).toBe(0);
  expect(empty.getMap('SCHEMA').size).toBe(0);
}

/** 从 committed/fatal 结果中取出 inline update carrier（effect 必须为 update）。 */
function updateCarrierOf(result: AttemptResult): UpdateCarrier {
  if (result.kind !== 'committed' && result.kind !== 'fatal') {
    throw new Error(`预料之外的 result kind: ${result.kind}`);
  }
  if (result.kind === 'committed' && result.effect === 'update') return result.update;
  if (result.kind === 'fatal' && result.committed === true && result.effect === 'update') return result.update;
  throw new Error(`预期 effect:update，实际 ${JSON.stringify(result)}`);
}

function readOk(runtime: NamespaceRuntime, path: readonly (string | number)[]): unknown {
  const read = runtime.readData(path);
  expect(read.ok).toBe(true);
  return (read as { value: unknown }).value;
}

// ── ROOT mutation ───────────────────────────────────────────────────────────

describe('#149 ROOT mutation 诊断记录（红灯契约）', () => {
  it('AC1/AC2 committed：全字段 + 精确事务 update bytes（基态链式重放）+ 注入 Clock', async () => {
    const log = makeLog({ inputPolicy: 'full' });
    const { writer, handle } = await makeWriter();
    const baseState = Y.encodeStateAsUpdate(handle.doc); // 事务前基态（同 clientID；禁模块级常量）
    const runtime = await makeRuntime({
      handle,
      notifyDirty: () => writer.saveDoc(handle),
      diagnosticEmitter: log.emitter,
      clock: () => NOW_MS,
    });

    const res = await runtime.mutateData({ op: 'set', path: ['n'], value: 42 });
    expect(res).toEqual({ ok: true });

    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.operation).toBe('root-mutation');
    expect(rec.stage).toBe('transaction');
    expect(rec.source).toEqual({ kind: 'local' });
    expect(rec.observedAt).toBe(NOW_ISO); // 注入 Clock 生效
    expect(rec.attemptId).toMatch(/^att-[0-9a-f]{32}$/);
    expect(rec.input).toMatchObject({ capture: 'full', value: { op: 'set', path: ['n'], value: 42 } });
    // committed 事实 + effect 分类（AC2：精确事务 effect，非 noop 非 update-omitted）
    expect(rec.result.kind).toBe('committed');
    if (rec.result.kind === 'committed') {
      expect(rec.result.effect).toBe('update');
      const fresh = applyCarrier(updateCarrierOf(rec.result), baseState); // 基态 → tx₁（§13.8c 单笔）
      expect(fresh.getMap('ROOT').get('n')).toBe(42);
      expect(fresh.getMap('ROOT').get('a')).toBe('x');
      expectNoMaterializeWithoutBase(updateCarrierOf(rec.result)); // §13.8d：真增量空 doc 不物化
    }

    // 业务面闭环：live doc 已提交
    expect(readOk(runtime, ['n'])).toBe(42);
    await handle.release();
    await writer.dispose();
  });

  it('AC1 rejection/validation：领域校验拒绝 → rejected + issues + 零写入', async () => {
    const log = makeLog();
    const { writer, handle } = await makeWriter();
    const runtime = await makeRuntime({
      handle,
      notifyDirty: () => writer.saveDoc(handle),
      diagnosticEmitter: log.emitter,
      clock: () => NOW_MS,
    });

    const res = await runtime.mutateData({ op: 'set', path: ['a'], value: 99 }); // a 是 string
    expect(res.ok).toBe(false);

    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.operation).toBe('root-mutation');
    expect(rec.stage).toBe('validation');
    expect(rec.result).toEqual({ kind: 'rejected' });
    expect(rec.input.capture).toBe('digest'); // 快照已成功 → 日志只消费既有安全快照
    expect(rec.issues).toBeDefined();
    expect((rec.issues?.items.length ?? 0)).toBeGreaterThan(0);

    // 业务面零写入
    expect(readOk(runtime, ['a'])).toBe('x');
    await handle.release();
    await writer.dispose();
  });

  it('AC3/AC5 敌意 accessor 输入：input-snapshot 拒绝 + unsafe-input + accessor 零执行', async () => {
    const log = makeLog();
    const { writer, handle } = await makeWriter();
    const runtime = await makeRuntime({
      handle,
      notifyDirty: () => writer.saveDoc(handle),
      diagnosticEmitter: log.emitter,
      clock: () => NOW_MS,
    });

    let fired = 0;
    const hostile: Record<string, unknown> = { op: 'set', path: ['n'] };
    Object.defineProperty(hostile, 'value', {
      enumerable: true,
      get: () => {
        fired += 1;
        return 42;
      },
    });

    const res = await runtime.mutateData(hostile);
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).toContain('MUTATION_INPUT_NOT_PLAIN_DATA');
    expect(fired).toBe(0); // 快照器拒绝先于任何值读取

    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.operation).toBe('root-mutation');
    expect(rec.stage).toBe('input-snapshot');
    expect(rec.result).toEqual({ kind: 'rejected' });
    expect(rec.code).toBe('MUTATION_INPUT_NOT_PLAIN_DATA');
    expect(rec.input.capture).toBe('unsafe-input'); // 不重读敌意输入、不强捕
    expect(rec.issues?.items.length ?? 0).toBeGreaterThan(0);
    expect(fired).toBe(0); // 日志侧零额外读取（accessor 仍未执行）
    await handle.release();
    await writer.dispose();
  });

  it('AC5 零额外读取：合法 Proxy 输入下，装配日志与无日志基线的 get-trap 计数相等', async () => {
    async function runTracked(log?: BoundedMemoryDiagnosticLog): Promise<{ gets: number; attempts: number }> {
      const { writer, handle } = await makeWriter();
      const counts = { gets: 0 };
      const mutation = new Proxy({ op: 'set', path: ['n'], value: 42 }, {
        get(target, prop, receiver) {
          counts.gets += 1;
          return Reflect.get(target, prop, receiver);
        },
      });
      const runtime = await makeRuntime({
        handle,
        notifyDirty: () => writer.saveDoc(handle),
        ...(log === undefined ? {} : { diagnosticEmitter: log.emitter, clock: () => NOW_MS }),
      });
      const res = await runtime.mutateData(mutation);
      expect(res).toEqual({ ok: true });
      const attempts = log === undefined ? 0 : await waitAttempts(log, 1).then((r) => r.length);
      await handle.release();
      await writer.dispose();
      return { gets: counts.gets, attempts };
    }

    const baseline = await runTracked(undefined);
    const logged = await runTracked(makeLog());
    expect(logged.attempts).toBe(1); // 对照不是空转：日志确实产生了记录
    // 日志不得对调用方原输入造成任何额外读取（只能消费既有 frozen 快照）
    expect(logged.gets).toBe(baseline.gets);
  });

  it('AC1 acceptance：close 后写 → acceptance / RUNTIME_WRITE_DISABLED / not-accessed（ROOT+SCHEMA）', async () => {
    const log = makeLog({ inputPolicy: 'full' }); // full 策略下仍必须 not-accessed —— 输入零访问
    const { writer, handle } = await makeWriter();
    const runtime = await makeRuntime({
      handle,
      notifyDirty: () => writer.saveDoc(handle),
      diagnosticEmitter: log.emitter,
      clock: () => NOW_MS,
    });

    await runtime.close();

    const res = await runtime.mutateData({ op: 'set', path: ['n'], value: 7 });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).toContain('RUNTIME_WRITE_DISABLED');
    const resS = await runtime.replaceSchema({ schema: ENVELOPE });
    expect(resS.ok).toBe(false);

    const recs = await waitAttempts(log, 2);
    expect(recs[0]?.operation).toBe('root-mutation');
    expect(recs[1]?.operation).toBe('schema-replacement');
    for (const rec of recs) {
      expect(rec.stage).toBe('acceptance');
      expect(rec.result).toEqual({ kind: 'rejected' });
      expect(rec.code).toBe('RUNTIME_WRITE_DISABLED');
      expect(rec.input).toEqual({ capture: 'not-accessed' });
    }
    await writer.dispose();
  });

  it('AC1/AC4 fatal-before-commit：getStatus 抛错 → fatal committed:false + 后续写 S1 门记录', async () => {
    const log = makeLog();
    const { writer, handle } = await makeWriter();

    let armed = false;
    const hostileHandle = new Proxy(handle, {
      get(target, prop) {
        if (prop === 'getStatus') {
          return () => {
            if (armed) throw new Error('adapter getStatus exploded (injected)');
            return 'ready' as const;
          };
        }
        return Reflect.get(target, prop);
      },
    });
    const runtime = await makeRuntime({
      handle: hostileHandle,
      notifyDirty: () => writer.saveDoc(handle),
      diagnosticEmitter: log.emitter,
      clock: () => NOW_MS,
    });
    armed = true;

    await expect(runtime.mutateData({ op: 'set', path: ['n'], value: 5 })).rejects.toMatchObject({
      phase: 'write-slot-internal',
      committed: false,
    });

    let recs = await waitAttempts(log, 1);
    const fatalRec = recs[0]!;
    expect(fatalRec.operation).toBe('root-mutation');
    expect(fatalRec.stage).toBe('capability-gate');
    expect(fatalRec.result).toEqual({ kind: 'fatal', committed: false });
    expect(fatalRec.code).toBe('NSRT-FATAL-WRITE-INTERNAL');
    expect(fatalRec.sourcePhase).toBe('write-slot-internal');
    expect(fatalRec.sourceModule).toBe('runtime');
    expect(fatalRec.input).toEqual({ capture: 'not-accessed' }); // S2 在输入访问前拒绝

    // 已排队后续写：S1 fatal 门 → 零写入 RUNTIME_WRITE_DISABLED（第二条记录，顺序保持）
    const res2 = await runtime.mutateData({ op: 'set', path: ['a'], value: 'zz' });
    expect(res2.ok).toBe(false);
    recs = await waitAttempts(log, 2);
    expect(recs[1]?.operation).toBe('root-mutation');
    expect(recs[1]?.stage).toBe('capability-gate');
    expect(recs[1]?.code).toBe('RUNTIME_WRITE_DISABLED');
    expect(recs[1]?.result).toEqual({ kind: 'rejected' });
    await handle.release();
    await writer.dispose();
  });

  it('AC1/AC2/AC4 fatal-after-commit：notifyDirty 失败 → fatal committed:true + 精确事务 update + live doc 已提交', async () => {
    const log = makeLog();
    const { writer, handle } = await makeWriter();
    const baseState = Y.encodeStateAsUpdate(handle.doc); // 事务前基态（同 clientID；禁模块级常量）
    const runtime = await makeRuntime({
      handle,
      notifyDirty: async () => {
        throw new Error('persistence down (injected)');
      },
      diagnosticEmitter: log.emitter,
      clock: () => NOW_MS,
    });

    await expect(runtime.mutateData({ op: 'set', path: ['n'], value: 42 })).rejects.toMatchObject({
      phase: 'notify-dirty-failed',
      committed: true,
    });

    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.operation).toBe('root-mutation');
    expect(rec.stage).toBe('dirty-notification');
    expect(rec.sourcePhase).toBe('notify-dirty-failed');
    expect(rec.code).toBe('NSRT-FATAL-WRITE-INTERNAL');
    expect(rec.input.capture).toBe('digest');
    expect(rec.result.kind).toBe('fatal');
    if (rec.result.kind === 'fatal') {
      expect(rec.result.committed).toBe(true);
      // committed-aware：携带该事务精确 effect（effect:update 断言由 updateCarrierOf 承担——
      // 非 update 即 throw 判失败，断言语义等价）
      const fresh = applyCarrier(updateCarrierOf(rec.result), baseState); // 基态 → tx₁（§13.8c 单笔）
      expect(fresh.getMap('ROOT').get('n')).toBe(42);
      expectNoMaterializeWithoutBase(updateCarrierOf(rec.result)); // §13.8d：真增量空 doc 不物化
    }

    // 业务面：committed 事实为真 —— live doc 已含 42（notifier 失败不撤销已提交事务）
    expect(readOk(runtime, ['n'])).toBe(42);
    await handle.release();
    await writer.dispose();
  });

  it('AC1 capability-gate：schema unavailable → SCHEMA_UNAVAILABLE 拒绝 + 快照已捕获', async () => {
    const log = makeLog();
    const { writer, handle } = await makeWriter();
    const runtime = await makeRuntime(
      {
        handle,
        notifyDirty: () => writer.saveDoc(handle),
        diagnosticEmitter: log.emitter,
        clock: () => NOW_MS,
        compile: () => ({
          ok: false as const,
          issues: [{ kind: 'vfsl' as const, issue: { message: 'VFSL-E1: injected compile failure', line: 1, column: 1 } }],
        }),
      },
      'unavailable',
    );

    const res = await runtime.mutateData({ op: 'set', path: ['n'], value: 42 });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).toContain('SCHEMA_UNAVAILABLE');

    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.operation).toBe('root-mutation');
    expect(rec.stage).toBe('capability-gate');
    expect(rec.result).toEqual({ kind: 'rejected' });
    expect(rec.code).toBe('SCHEMA_UNAVAILABLE');
    expect(rec.input.capture).toBe('digest'); // S3 快照成功后才到 S4 —— 消费既有快照
    expect(readOk(runtime, ['n'])).toBe(1);
    await handle.release();
    await writer.dispose();
  });

  it('AC1 capability-gate：notifyDirty 未绑定 → RUNTIME_WRITE_DISABLED / not-accessed', async () => {
    const log = makeLog();
    const { writer, handle } = await makeWriter();
    const runtime = await makeRuntime({
      handle,
      diagnosticEmitter: log.emitter, // 故意不注入 notifyDirty —— S2 loud 拒绝
      clock: () => NOW_MS,
    });

    const res = await runtime.mutateData({ op: 'set', path: ['n'], value: 3 });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).toContain('RUNTIME_WRITE_DISABLED');

    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.operation).toBe('root-mutation');
    expect(rec.stage).toBe('capability-gate');
    expect(rec.result).toEqual({ kind: 'rejected' });
    expect(rec.code).toBe('RUNTIME_WRITE_DISABLED');
    expect(rec.input).toEqual({ capture: 'not-accessed' });
    await handle.release();
    await writer.dispose();
  });
});

// ── SCHEMA replacement ──────────────────────────────────────────────────────

describe('#149 SCHEMA replacement 诊断记录（红灯契约）', () => {
  it('AC1/AC2 committed ×2：keep-root → replace-root，两条记录各带精确事务 update', async () => {
    const log = makeLog({ inputPolicy: 'full' });
    const { writer, handle } = await makeWriter();
    const baseState = Y.encodeStateAsUpdate(handle.doc); // 事务前基态（同 clientID；禁模块级常量）
    const runtime = await makeRuntime({
      handle,
      notifyDirty: () => writer.saveDoc(handle),
      diagnosticEmitter: log.emitter,
      clock: () => NOW_MS,
    });

    // ① keep-root：新 schema 与当前 ROOT 结构兼容（ROOT 零修改）
    const r1 = await runtime.replaceSchema({ schema: ENV_KEEP });
    expect(r1).toEqual({ ok: true });
    // ② replace-root：提供完整最终 logical ROOT
    const r2 = await runtime.replaceSchema({ schema: ENV_REPLACE, root: ROOT_REPLACE });
    expect(r2).toEqual({ ok: true });

    const recs = await waitAttempts(log, 2);
    expect(recs[0]?.operation).toBe('schema-replacement');
    expect(recs[1]?.operation).toBe('schema-replacement');
    for (const rec of recs) {
      expect(rec.stage).toBe('transaction');
      expect(rec.source).toEqual({ kind: 'local' });
      expect(rec.observedAt).toBe(NOW_ISO);
      expect(rec.result.kind).toBe('committed');
    }
    // ① 精确 effect：SCHEMA 换成 ENV_KEEP.text（ROOT 未动）——基态 → tx₁（§13.8c 单笔）
    const rec0 = recs[0]!;
    const rec1 = recs[1]!;
    if (rec0.result.kind === 'committed' && rec0.result.effect === 'update') {
      const fresh = applyCarrier(updateCarrierOf(rec0.result), baseState);
      expect(fresh.getMap('SCHEMA').get('text')).toBe(ENV_KEEP.text);
      expect(fresh.getMap('SCHEMA').get('id')).toBe('ns-1');
    }
    // ② 精确 effect：SCHEMA + ROOT 同事务——基态 → tx₁ → tx₂（§13.8c：prior = recs[0] 的 carrier，
    //   第二笔事务的 left origin 依赖第一笔后的状态，链式依序是机制必需）
    if (rec1.result.kind === 'committed' && rec1.result.effect === 'update') {
      const fresh = applyCarrier(updateCarrierOf(rec1.result), baseState, [updateCarrierOf(rec0.result)]);
      expect(fresh.getMap('SCHEMA').get('text')).toBe(ENV_REPLACE.text);
      expect(fresh.getMap('ROOT').get('n')).toBe(2);
      expect(fresh.getMap('ROOT').get('a')).toBe('y');
      expect(fresh.getMap('ROOT').get('b')).toBe(true);
      expectNoMaterializeWithoutBase(updateCarrierOf(rec1.result)); // §13.8d：真增量空 doc 不物化
    }
    // ② 输入捕获：完整 root 快照被日志消费（既有安全快照）
    expect(recs[1]?.input).toMatchObject({ capture: 'full', value: { schema: ENV_REPLACE, root: ROOT_REPLACE } });

    // 业务面：active schema 已切换、ROOT 已替换
    expect(runtime.getSchema()?.text).toBe(ENV_REPLACE.text);
    expect(readOk(runtime, ['n'])).toBe(2);
    expect(readOk(runtime, ['b'])).toBe(true);
    await handle.release();
    await writer.dispose();
  });

  it('AC1 rejection/schema-compile：畸形 text → rejected + SCHEMA_TEXT_INVALID + 零写入', async () => {
    const log = makeLog();
    const { writer, handle } = await makeWriter();
    const runtime = await makeRuntime({
      handle,
      notifyDirty: () => writer.saveDoc(handle),
      diagnosticEmitter: log.emitter,
      clock: () => NOW_MS,
    });

    const res = await runtime.replaceSchema({ schema: { lang: 'vfsl', version: 1, id: 'ns-1', text: 'type ROOT = {{{{' } });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).toContain('SCHEMA_TEXT_INVALID');

    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.operation).toBe('schema-replacement');
    expect(rec.stage).toBe('schema-compile');
    expect(rec.result).toEqual({ kind: 'rejected' });
    expect(rec.code).toBe('SCHEMA_TEXT_INVALID');
    expect(rec.issues?.items.length ?? 0).toBeGreaterThan(0);
    expect(rec.input.capture).toBe('digest'); // 快照（含 proposed schema）已被既有快照链消费

    // 业务面：active schema 与 ROOT 不变
    expect(runtime.getSchema()?.text).toBe(ENVELOPE.text);
    expect(readOk(runtime, ['n'])).toBe(1);
    await handle.release();
    await writer.dispose();
  });

  it('AC1/AC4 fatal-before-commit（schema 槽）：compile 抛错 → schema-compile-throw committed:false', async () => {
    const log = makeLog();
    const { writer, handle } = await makeWriter();
    const runtime = await makeRuntime({
      handle,
      notifyDirty: () => writer.saveDoc(handle),
      diagnosticEmitter: log.emitter,
      clock: () => NOW_MS,
      compile: (envelope: { text: string }) => {
        // P0 编译 doc 内良好 envelope 放行；proposed 坏 envelope → 编译通道抛错
        if (envelope.text === ENVELOPE.text) return compileSchemaEnvelope(envelope);
        throw new Error('compile channel boom (injected)');
      },
    });

    await expect(runtime.replaceSchema({ schema: ENV_REPLACE })).rejects.toMatchObject({
      phase: 'schema-compile-throw',
      committed: false,
    });

    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.operation).toBe('schema-replacement');
    expect(rec.stage).toBe('schema-compile');
    expect(rec.result).toEqual({ kind: 'fatal', committed: false });
    expect(rec.code).toBe('NSRT-FATAL-SCHEMA-WRITE-INTERNAL');
    expect(rec.sourcePhase).toBe('schema-compile-throw');
    expect(rec.input.capture).toBe('digest'); // S3 快照成功后才编译 —— 消费既有快照

    // 业务面：零写入 —— active schema 不变
    expect(runtime.getSchema()?.text).toBe(ENVELOPE.text);
    await handle.release();
    await writer.dispose();
  });
});

// ── AC4 日志故障隔离（logging 不得改变业务面）────────────────────────────────

describe('#149 日志故障隔离（AC4 红灯契约）', () => {
  it('AC4 emitter 违约 throw：业务返回值/顺序/dirty notification/Runtime capability 全不变', async () => {
    let emitCalls = 0;
    const hostileEmitter: NamespaceDiagnosticChangeEmitter = {
      emit: () => {
        emitCalls += 1;
        throw new Error('adapter boom (injected)');
      },
    };
    const { writer, handle } = await makeWriter();
    const runtime = await makeRuntime({
      handle,
      notifyDirty: () => writer.saveDoc(handle),
      diagnosticEmitter: hostileEmitter,
      clock: () => NOW_MS,
    });

    // 当前 worktree 红灯点：emitter 从未被调用（接线缺失）→ 末尾 emitCalls === 2 断言红。
    // 修复后：两次尝试各一次 emit，且 throw 被吞没（不改变下面全部业务结果）。
    const r1 = await runtime.mutateData({ op: 'set', path: ['n'], value: 42 });
    expect(r1).toEqual({ ok: true });
    const r2 = await runtime.mutateData({ op: 'set', path: ['n'], value: 7 });
    expect(r2).toEqual({ ok: true });

    // 业务面：顺序提交、dirty notification 完成、无 internal fatal
    expect(readOk(runtime, ['n'])).toBe(7);
    expect(runtime.getStatus().fatal).toBeNull();
    expect(handle.getStatus()).toBe('ready');

    // 修复后：两次尝试各一次 emit，且 throw 被吞没（不改变上面全部业务结果）
    expect(emitCalls).toBe(2);
    await handle.release();
    await writer.dispose();
  });

  it('AC4 队列满：drop newest 只影响日志，不改业务返回值与 sequencer 顺序', async () => {
    const log = makeLog({ capacity: 1 });
    const { writer, handle } = await makeWriter();
    const runtime = await makeRuntime({
      handle,
      notifyDirty: () => writer.saveDoc(handle),
      diagnosticEmitter: log.emitter,
      clock: () => NOW_MS,
    });

    const r1 = await runtime.mutateData({ op: 'set', path: ['n'], value: 11 });
    expect(r1).toEqual({ ok: true });
    const r2 = await runtime.mutateData({ op: 'set', path: ['n'], value: 22 });
    expect(r2).toEqual({ ok: true });

    await waitAttempts(log, 1); // 第一条被接纳；第二条因队列满被丢
    const stats = log.stats();
    expect(stats.accepted).toBe(1);
    expect(stats.droppedTotal).toBe(1);
    expect(stats.queueDepth).toBe(1);

    // 业务面：两次写都成功且顺序正确（FIFO：11 → 22）
    expect(readOk(runtime, ['n'])).toBe(22);
    await handle.release();
    await writer.dispose();
  });
});

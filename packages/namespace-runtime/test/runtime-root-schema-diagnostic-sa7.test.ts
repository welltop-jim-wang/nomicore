/**
 * SA7 动态验证补充测试 — issue #149（task_root-schema-diagnostic-change-log_sa4_review.md §3）。
 *
 * 逐条对应 SA4 移交的动态审核重点：
 * - DV-1 慢 emit 槽间延迟（I-2）：人为延迟 emitter（同步自旋）下实测连续写场景的
 *   槽间耦合与 FIFO/槽窗口不变（amendment C 动态面证据）。
 * - DV-2 acceptance 同步 emit 延迟（I-3）：慢 emitter 下 close() 后拒绝路径的同步耗时，
 *   确认无隐藏 await、业务返回仍为已 settle 的 Promise.resolve。
 * - DV-3 unhandledRejection 抑制面（I-4）：未 await 的 fatal 写在装配/未装配 emitter
 *   两形态下进程级 unhandledRejection 均不触发；子进程阳性对照证明探针语义与
 *   附加反应抑制机制；生产面无依赖方（grep 证据见 sa7 报告）。
 * - DV-4 未钉死结局点运行时行为（§13.7 清单）：R3 / S2′a / S2′b / S2′c / S3′b /
 *   S5′a / S6′ + seam 校验守卫 + R8 结构不可达的动态演示（p0Gate 保持下槽体不可启动）。
 * - DV-6 队列满 + inputPolicy=full 组合：capacity=1 + full 策略下第二条 drop 的
 *   stats 断言与 input 投影无副作用。
 *
 * 全部为运行时行为断言（真实 memory persistence + 真实诊断管线装配），零源码文本断言。
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as Y from 'yjs';
import type { DocHandle, User } from '@nomicore/persistence';
import { createMemoryPersistence } from '@nomicore/persistence';
import { realPersistenceScheduler } from './real-persistence-scheduler.js';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import type { NamespaceRuntime } from '../src/index.js';
import {
  createBoundedMemoryDiagnosticLog,
  type AttemptRecord,
  type BoundedMemoryDiagnosticLog,
  type DiagnosticLogConfig,
  type NamespaceDiagnosticChangeEmitter,
  type UpdateCarrier,
} from '../../namespace-diagnostic-log/src/index.js';

// ── 固定夹具（与红灯契约套件同源约定） ────────────────────────────────────────

const NOW_MS = 1_700_000_000_000;
const NOW_ISO = new Date(NOW_MS).toISOString();
const OWNER: User = { userId: 'u-alice' };
const ENVELOPE = { lang: 'vfsl', version: 1, id: 'ns-1', text: 'type ROOT = { n: number; a: string; };' } as const;
const ROOT0 = { n: 1, a: 'x' };
const ENV_KEEP = { lang: 'vfsl', version: 1, id: 'ns-1', text: 'type ROOT = { n: number; a: string; }; type EXTRA = { x: boolean };' } as const;
const ENV_REPLACE = { lang: 'vfsl', version: 1, id: 'ns-1', text: 'type ROOT = { n: number; a: string; b: boolean; };' } as const;

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

async function makeRuntime(seam: Record<string, unknown>): Promise<NamespaceRuntime> {
  const runtime = createNamespaceRuntimeWithSeam(seam as never) as unknown as NamespaceRuntime;
  await expect
    .poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 })
    .toBe('ready');
  return runtime;
}

async function waitAttempts(log: BoundedMemoryDiagnosticLog, expected: number): Promise<AttemptRecord[]> {
  await expect
    .poll(() => log.records().filter((r) => r.recordKind === 'attempt').length, { interval: 5, timeout: 3_000 })
    .toBe(expected);
  return log.records().filter((r): r is AttemptRecord => r.recordKind === 'attempt');
}

/** 单条记录提取（类型收窄专用——waitAttempts 已 poll 至 1 条，运行时恒非空）。 */
function firstAttempt(recs: AttemptRecord[]): AttemptRecord {
  const r = recs[0];
  if (r === undefined) throw new Error('waitAttempts 返回 0 条记录（poll 已保证非空——不可达防御）');
  return r;
}

/** inline carrier 的 bytes 提取（类型收窄专用——与 expect(carrier.storage==='inline') 同义）。 */
function inlineBytes(carrier: UpdateCarrier): Uint8Array {
  if (carrier.storage !== 'inline') throw new Error(`预期 inline carrier，实际 ${carrier.storage}`);
  return new Uint8Array(Buffer.from(carrier.base64, 'base64'));
}

function readOk(runtime: NamespaceRuntime, path: readonly (string | number)[]): unknown {
  const read = runtime.readData(path);
  expect(read.ok).toBe(true);
  return (read as { value: unknown }).value;
}

/** 同步自旋（慢 emitter 注入——模拟慢 adapter 的同步 I/O；无 await、无定时器）。 */
function spinMs(ms: number): void {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    /* busy wait */
  }
}

/** 真实事务增量 carrier 重放（同源基态——红灯套件 §13.8 同款消费形态）。 */
function applyCarrier(carrier: UpdateCarrier, baseState: Uint8Array, prior: UpdateCarrier[] = []): Y.Doc {
  expect(carrier.storage).toBe('inline');
  expect(carrier.format).toBe('yjs-update-v1');
  const bytes = inlineBytes(carrier);
  expect(bytes.length).toBe(carrier.payloadLength);
  const fresh = new Y.Doc();
  Y.applyUpdate(fresh, baseState);
  for (const p of prior) Y.applyUpdate(fresh, inlineBytes(p));
  Y.applyUpdate(fresh, bytes);
  return fresh;
}

function updateCarrierOf(result: AttemptRecord['result']): UpdateCarrier {
  if (result.kind !== 'committed' && result.kind !== 'fatal') {
    throw new Error(`预料之外的 result kind: ${result.kind}`);
  }
  if (result.kind === 'committed' && result.effect === 'update') return result.update;
  if (result.kind === 'fatal' && result.committed === true && result.effect === 'update') return result.update;
  throw new Error(`预期 effect:update，实际 ${JSON.stringify(result)}`);
}

/** getStatus 抛错注入用 hostile handle（仅劫持 getStatus，其余透传真 handle）。 */
function hostileGetStatusHandle(handle: DocHandle, isArmed: () => boolean): DocHandle {
  return new Proxy(handle, {
    get(target, prop) {
      if (prop === 'getStatus') {
        return () => {
          if (isArmed()) throw new Error('adapter getStatus exploded (injected)');
          return 'ready' as const;
        };
      }
      return Reflect.get(target, prop);
    },
  });
}

// ── DV-1 慢 emit 槽间延迟 ─────────────────────────────────────────────────────

describe('#149 SA7 DV-1 慢 emit 槽间延迟（amendment C 动态面）', () => {
  it('慢同步 emit 推迟下一槽输入快照起点；emit 严格在槽间（tx 后/下槽前）；FIFO 与业务结果不变', async () => {
    const SPIN_MS = 40;
    const log = makeLog({ inputPolicy: 'full' });
    const { writer, handle } = await makeWriter();
    const baseState = Y.encodeStateAsUpdate(handle.doc);

    const timeline: Array<{ ev: string; t: number }> = [];
    let txCount = 0;
    let emitCount = 0;
    const slowEmitter: NamespaceDiagnosticChangeEmitter = {
      emit: (e) => {
        emitCount += 1;
        const n = emitCount;
        timeline.push({ ev: `emit${n}-start`, t: performance.now() });
        spinMs(SPIN_MS);
        timeline.push({ ev: `emit${n}-end`, t: performance.now() });
        log.emitter.emit(e); // 慢速后仍进入真实管线（记录顺序可比对 sequence）
      },
    };
    // 测试侧观察锚：doc update 事件 = 槽内事务时点（与 runtime 诊断订阅互不干扰）
    handle.doc.on('update', () => {
      txCount += 1;
      timeline.push({ ev: `tx${txCount}`, t: performance.now() });
    });

    const runtime = await makeRuntime({
      handle,
      notifyDirty: () => writer.saveDoc(handle),
      diagnosticEmitter: slowEmitter,
      clock: () => NOW_MS,
    });

    // 第二笔写输入带 get-trap 计时：S3 快照是槽 2 起点第一个可观测动作
    let slot2FirstRead = 0;
    const m2 = new Proxy({ op: 'set', path: ['n'], value: 7 }, {
      get(target, prop, receiver) {
        if (slot2FirstRead === 0) slot2FirstRead = performance.now();
        return Reflect.get(target, prop, receiver);
      },
    });

    // 连续两写（同步背靠背入队——FIFO 场景）
    const p1 = runtime.mutateData({ op: 'set', path: ['n'], value: 42 });
    const p2 = runtime.mutateData(m2);
    const [r1, r2] = await Promise.all([p1, p2]);

    // 业务面：两写均成功、FIFO 顺序（终值 = 第二笔）
    expect(r1).toEqual({ ok: true });
    expect(r2).toEqual({ ok: true });
    expect(readOk(runtime, ['n'])).toBe(7);
    expect(emitCount).toBe(2);

    const at = (ev: string): number => {
      const hit = timeline.find((x) => x.ev === ev);
      if (hit === undefined) throw new Error(`timeline 缺少 ${ev}: ${JSON.stringify(timeline)}`);
      return hit.t;
    };

    // ① emit 严格在槽间：槽内事务之后（不在槽窗口内）
    expect(at('emit1-start')).toBeGreaterThan(at('tx1'));
    expect(at('emit2-start')).toBeGreaterThan(at('tx2'));
    // ② FIFO：emit 顺序 ≡ 槽完成顺序（emit1 全部先于 emit2）
    expect(at('emit1-end')).toBeLessThan(at('emit2-start'));
    // ③ 慢 emit 耦合（I-2 动态证据）：槽 2 的首个输入读取发生在 emit1 完成之后
    //    （emit1 的 40ms 自旋真实推迟了下一槽 thunk 启动）
    expect(at('emit1-end') - at('emit1-start')).toBeGreaterThanOrEqual(SPIN_MS - 5); // 自旋真实生效
    expect(slot2FirstRead).toBeGreaterThanOrEqual(at('emit1-end')); // 下一槽在 emit 之后才启动
    expect(slot2FirstRead - at('emit1-end')).toBeLessThan(200); // 除 emit 外无额外显著延迟
    // ④ 槽窗口不受 emit 影响：emit1 不在槽 1 窗口内（先于 tx1 不可能——①已证），
    //    槽 2 的事务在 emit1 之后正常发生
    expect(at('tx2')).toBeGreaterThan(at('emit1-end'));
    expect(at('tx2')).toBeLessThan(at('emit2-start'));

    // ⑤ 记录面：emit 顺序 ≡ sequence 升序（FIFO）；两笔均 transaction/committed 且携带精确 bytes
    const recs = await waitAttempts(log, 2);
    expect(recs.map((r) => r.sequence)).toEqual(['1', '2']);
    for (const rec of recs) {
      expect(rec.operation).toBe('root-mutation');
      expect(rec.stage).toBe('transaction');
      expect(rec.result.kind).toBe('committed');
    }
    const fresh = applyCarrier(updateCarrierOf(recs[1]!.result), baseState, [updateCarrierOf(recs[0]!.result)]);
    expect(fresh.getMap('ROOT').get('n')).toBe(7);
    expect(runtime.getStatus().fatal).toBeNull();
    await handle.release();
    await writer.dispose();
  });
});

// ── DV-2 acceptance 同步 emit 延迟 ────────────────────────────────────────────

describe('#149 SA7 DV-2 acceptance 同步 emit 延迟', () => {
  it('慢 emitter 下 close() 后 mutateRoot 的同步耗时含 emit；返回为已 settle 的 Promise，无隐藏 await', async () => {
    const SPIN_MS = 30;
    const log = makeLog({ inputPolicy: 'full' });
    const { writer, handle } = await makeWriter();
    let emitCalls = 0;
    const slowEmitter: NamespaceDiagnosticChangeEmitter = {
      emit: (e) => {
        emitCalls += 1;
        spinMs(SPIN_MS);
        log.emitter.emit(e);
      },
    };
    const runtime = await makeRuntime({
      handle,
      notifyDirty: () => writer.saveDoc(handle),
      diagnosticEmitter: slowEmitter,
      clock: () => NOW_MS,
    });
    await runtime.close();

    const t0 = performance.now();
    const p = runtime.mutateData({ op: 'set', path: ['n'], value: 7 });
    const syncMs = performance.now() - t0;

    // emit 在公共方法调用栈内同步发生（恰一次）
    expect(emitCalls).toBe(1);
    // 慢 emitter 的耗时耦合进同步拒绝路径（I-3 动态证据）
    expect(syncMs).toBeGreaterThanOrEqual(SPIN_MS - 5);

    // 无隐藏 await/异步化：返回 promise 在当前微任务排空后必已 settle
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    await null;
    await null;
    expect(settled).toBe(true);

    const res = await p;
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).toContain('RUNTIME_WRITE_DISABLED');

    // 记录分类与 §9 表一致：acceptance / RUNTIME_WRITE_DISABLED / rejected / not-accessed
    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.operation).toBe('root-mutation');
    expect(rec.stage).toBe('acceptance');
    expect(rec.result).toEqual({ kind: 'rejected' });
    expect(rec.code).toBe('RUNTIME_WRITE_DISABLED');
    expect(rec.input).toEqual({ capture: 'not-accessed' }); // full 策略下仍零输入访问
    await writer.dispose();
  });

  it('对照：快 emitter 同一拒绝路径同步耗时为无自旋量级（延迟差全部来自 emit 本身）', async () => {
    const log = makeLog({ inputPolicy: 'full' });
    const { writer, handle } = await makeWriter();
    const runtime = await makeRuntime({
      handle,
      notifyDirty: () => writer.saveDoc(handle),
      diagnosticEmitter: log.emitter,
      clock: () => NOW_MS,
    });
    await runtime.close();
    const t0 = performance.now();
    const res = await runtime.mutateData({ op: 'set', path: ['n'], value: 7 });
    const syncMs = performance.now() - t0;
    expect(res.ok).toBe(false);
    // 无自旋：同步段 = acceptance 路径上的**一次真实 memory 管线 emit**（本沙箱实测
    // 稳态 14–27ms——JCS 规范化/记录构造/冻结，非亚毫秒级）。上界 100ms（BLOCKER-1 修订：
    // 原 20ms 贴界、实测 ~1/3 失败率——CI 矩阵 node 20/24 × 满载下随机红）：
    // 断言语义为「无自旋量级」——与慢 emitter 首测的下界 `>= SPIN_MS-5`（25ms）构成
    // 完整对照；若同步段出现自旋级或更高异常延迟（隐藏同步环路等）本断言即红。
    expect(syncMs).toBeLessThan(100);
    await waitAttempts(log, 1);
    await writer.dispose();
  });
});

// ── DV-3 unhandledRejection 抑制面 ────────────────────────────────────────────

describe('#149 SA7 DV-3 unhandledRejection 抑制面', () => {
  /** 探针装配 + fire-and-forget fatal 写（R5：getStatus 抛错）+ 若干 macrotask 轮回观察。 */
  async function fireAndForgetFatalWrite(withEmitter: boolean): Promise<string[]> {
    const unhandled: string[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(String(reason));
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const log = makeLog();
      const { writer, handle } = await makeWriter();
      let armed = false;
      const runtime = await makeRuntime({
        handle: hostileGetStatusHandle(handle, () => armed),
        notifyDirty: () => writer.saveDoc(handle),
        ...(withEmitter ? { diagnosticEmitter: log.emitter, clock: () => NOW_MS } : {}),
      });
      armed = true;
      void runtime.mutateData({ op: 'set', path: ['n'], value: 5 }); // 故意不 await
      // 数个 macrotask 轮回（Node 在 turn 检查点派发 unhandledRejection）
      for (let i = 0; i < 6; i++) {
        await new Promise<void>((r) => setImmediate(r));
        await new Promise<void>((r) => setTimeout(r, 5));
      }
      const out = [...unhandled];
      await runtime.close().catch(() => undefined);
      await writer.dispose();
      return out;
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  }

  it('未 await 的 fatal 写（装配 emitter）：进程级 unhandledRejection 不触发', async () => {
    const unhandled = await fireAndForgetFatalWrite(true);
    expect(unhandled).toEqual([]);
  });

  it('未 await 的 fatal 写（未装配 emitter）：进程级 unhandledRejection 同样不触发', async () => {
    const unhandled = await fireAndForgetFatalWrite(false);
    expect(unhandled).toEqual([]);
  });

  it('子进程阳性对照：裸拒绝必触发事件；附加反应形态（本实现挂点）抑制事件', async () => {
    // 隔离子进程执行——不污染本 vitest 进程（真实 unhandledRejection 会干扰 runner）
    const script = [
      "let fired=0;",
      "process.on('unhandledRejection',()=>{fired++;});",
      "Promise.reject(new Error('bare-control'));", // 裸拒绝 → 事件必发（探针有效性）
      "const p2=Promise.reject(new Error('attach-reaction-shape'));",
      "void p2.then(()=>{},()=>{});", // 附加反应形态（settled.then 挂点）→ 事件不发
      "setTimeout(()=>{process.stdout.write('FIRED='+fired);},50);",
    ].join('\n');
    const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 10_000 });
    expect(r.status).toBe(0);
    // 裸拒绝计 1；附加反应形态的拒绝不计（否则为 2）——探针语义 + 抑制机制双证
    expect(r.stdout).toContain('FIRED=1');
  });
});

// ── DV-4 未钉死结局点运行时行为（§13.7 清单） ─────────────────────────────────

describe('#149 SA7 DV-4 未钉死结局点（§13.7 清单）', () => {
  it('R3：handle.release 后写 → capability-gate / RUNTIME_WRITE_DISABLED / rejected / not-accessed', async () => {
    const log = makeLog({ inputPolicy: 'full' }); // full 策略下仍必须 not-accessed
    const { writer, handle } = await makeWriter();
    const runtime = await makeRuntime({
      handle,
      notifyDirty: () => writer.saveDoc(handle),
      diagnosticEmitter: log.emitter,
      clock: () => NOW_MS,
    });

    await handle.release(); // 调用方越过 runtime 直接 release（v1 边界场景）

    const res = await runtime.mutateData({ op: 'set', path: ['n'], value: 5 });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).toContain('RUNTIME_WRITE_DISABLED');

    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.operation).toBe('root-mutation');
    expect(rec.stage).toBe('capability-gate');
    expect(rec.result).toEqual({ kind: 'rejected' });
    expect(rec.code).toBe('RUNTIME_WRITE_DISABLED');
    expect(rec.input).toEqual({ capture: 'not-accessed' }); // S2 在输入访问前拒绝
    expect(rec.sourceModule).toBe('runtime'); // code↔sourceModule 成对

    // 业务面：读取仍观察 live doc，零写入
    expect(readOk(runtime, ['n'])).toBe(1);
    await runtime.close().catch(() => undefined);
    await writer.dispose();
  });

  it('S2′a：fatal 已置位后的 replaceSchema → S1 fatal 门 / RUNTIME_WRITE_DISABLED / not-accessed', async () => {
    const log = makeLog();
    const { writer, handle } = await makeWriter();
    let armed = false;
    const runtime = await makeRuntime({
      handle: hostileGetStatusHandle(handle, () => armed),
      notifyDirty: () => writer.saveDoc(handle),
      diagnosticEmitter: log.emitter,
      clock: () => NOW_MS,
    });
    // 先以 ROOT 槽 R5 触发 fatal（getStatus 抛错）；观察 status 前解除 arm
    //（hostile Proxy 同时劫持 runtime.getStatus() 公共面——buildStatus 亦读 handle.getStatus）
    armed = true;
    await expect(runtime.mutateData({ op: 'set', path: ['n'], value: 5 })).rejects.toMatchObject({ committed: false });
    armed = false;
    expect(runtime.getStatus().fatal).not.toBeNull();
    armed = true;

    // SCHEMA 槽 S1 fatal 门（SCHEMA write 本可修复 fatal，但 fatal 后排队写先被 S1 拒绝——
    // 与 §9 表 S2′a 一致：capability-gate / RUNTIME_WRITE_DISABLED / rejected / not-accessed）
    const res = await runtime.replaceSchema({ schema: ENV_KEEP });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).toContain('RUNTIME_WRITE_DISABLED');

    const recs = await waitAttempts(log, 2);
    const rec = recs[1]!;
    expect(rec.operation).toBe('schema-replacement');
    expect(rec.stage).toBe('capability-gate');
    expect(rec.result).toEqual({ kind: 'rejected' });
    expect(rec.code).toBe('RUNTIME_WRITE_DISABLED');
    expect(rec.input).toEqual({ capture: 'not-accessed' });
    // 业务面：active schema 不变
    expect(runtime.getSchema()?.text).toBe(ENVELOPE.text);
    await runtime.close().catch(() => undefined);
    await writer.dispose();
  });

  it('S2′b：SCHEMA 槽 notifyDirty 未绑定 → RUNTIME_WRITE_DISABLED / not-accessed', async () => {
    const log = makeLog();
    const { writer, handle } = await makeWriter();
    const runtime = await makeRuntime({
      handle,
      diagnosticEmitter: log.emitter, // 故意不注入 notifyDirty —— S2′b loud 拒绝
      clock: () => NOW_MS,
    });

    const res = await runtime.replaceSchema({ schema: ENV_KEEP });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).toContain('RUNTIME_WRITE_DISABLED');

    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.operation).toBe('schema-replacement');
    expect(rec.stage).toBe('capability-gate');
    expect(rec.result).toEqual({ kind: 'rejected' });
    expect(rec.code).toBe('RUNTIME_WRITE_DISABLED');
    expect(rec.input).toEqual({ capture: 'not-accessed' });
    expect(runtime.getSchema()?.text).toBe(ENVELOPE.text); // 零写入
    await runtime.close().catch(() => undefined);
    await writer.dispose();
  });

  it('S2′c：SCHEMA 槽 getStatus 抛错 → fatal committed:false / NSRT-FATAL-SCHEMA-WRITE-INTERNAL / write-slot-internal', async () => {
    const log = makeLog();
    const { writer, handle } = await makeWriter();
    let armed = false;
    const runtime = await makeRuntime({
      handle: hostileGetStatusHandle(handle, () => armed),
      notifyDirty: () => writer.saveDoc(handle),
      diagnosticEmitter: log.emitter,
      clock: () => NOW_MS,
    });
    armed = true;

    await expect(runtime.replaceSchema({ schema: ENV_KEEP })).rejects.toMatchObject({
      phase: 'write-slot-internal',
      committed: false,
    });
    armed = false; // 观察面前解除 arm（runtime.getStatus 公共面同样读 handle.getStatus）

    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.operation).toBe('schema-replacement');
    expect(rec.stage).toBe('capability-gate');
    expect(rec.result).toEqual({ kind: 'fatal', committed: false });
    expect(rec.code).toBe('NSRT-FATAL-SCHEMA-WRITE-INTERNAL'); // SCHEMA 槽独立摘要码
    expect(rec.sourcePhase).toBe('write-slot-internal');
    expect(rec.sourceModule).toBe('runtime');
    expect(rec.input).toEqual({ capture: 'not-accessed' }); // S2 在输入访问前
    // 业务面：零写入 + fatal 置位（SCHEMA 码）
    expect(runtime.getSchema()?.text).toBe(ENVELOPE.text);
    expect(runtime.getStatus().fatal).toMatchObject({ code: 'NSRT-FATAL-SCHEMA-WRITE-INTERNAL' });
    await runtime.close().catch(() => undefined);
    await writer.dispose();
  });

  it('S3′b：replaceSchema 未知键 → validation / rejected / 快照已捕获 / 零写入', async () => {
    const log = makeLog({ inputPolicy: 'full' });
    const { writer, handle } = await makeWriter();
    const runtime = await makeRuntime({
      handle,
      notifyDirty: () => writer.saveDoc(handle),
      diagnosticEmitter: log.emitter,
      clock: () => NOW_MS,
    });

    const bad = { schema: ENV_KEEP, extra: 1 } as unknown as Parameters<NamespaceRuntime['replaceSchema']>[0];
    const res = await runtime.replaceSchema(bad);
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).toContain('extra');

    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.operation).toBe('schema-replacement');
    expect(rec.stage).toBe('validation'); // S3′b：形状检查失败 → validation 面
    expect(rec.result).toEqual({ kind: 'rejected' });
    expect(rec.code).toBeUndefined(); // 领域校验面无顶层 code（issues 通道）
    expect(rec.input).toMatchObject({ capture: 'full', value: { schema: ENV_KEEP, extra: 1 } }); // 快照已捕获
    expect((rec.issues?.items.length ?? 0)).toBeGreaterThan(0);
    // 业务面：零写入
    expect(runtime.getSchema()?.text).toBe(ENVELOPE.text);
    expect(readOk(runtime, ['n'])).toBe(1);
    await handle.release();
    await writer.dispose();
  });

  it('S5′a：keep-root 与当前 ROOT 不兼容 → validation / rejected / issues 非空 / 零写入', async () => {
    const log = makeLog();
    const { writer, handle } = await makeWriter();
    const runtime = await makeRuntime({
      handle,
      notifyDirty: () => writer.saveDoc(handle),
      diagnosticEmitter: log.emitter,
      clock: () => NOW_MS,
    });

    // ENV_REPLACE 要求 ROOT {n,a,b}，当前 ROOT0 缺 b 且未提供 root → keep-root 分支组合 seam 校验失败
    const res = await runtime.replaceSchema({ schema: ENV_REPLACE });
    expect(res.ok).toBe(false);

    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.operation).toBe('schema-replacement');
    expect(rec.stage).toBe('validation'); // S5′a：组合 seam 校验失败 → validation 面
    expect(rec.result).toEqual({ kind: 'rejected' });
    expect(rec.input.capture).toBe('digest'); // 快照成功后被消费
    expect((rec.issues?.items.length ?? 0)).toBeGreaterThan(0);
    // 业务面：active schema 与 ROOT 均不变
    expect(runtime.getSchema()?.text).toBe(ENVELOPE.text);
    expect(readOk(runtime, ['n'])).toBe(1);
    await handle.release();
    await writer.dispose();
  });

  it('S6′：SCHEMA 槽 notifyDirty 失败 → fatal committed:true + 精确事务 bytes + live doc 已提交（三联）', async () => {
    const log = makeLog();
    const { writer, handle } = await makeWriter();
    const baseState = Y.encodeStateAsUpdate(handle.doc);
    const runtime = await makeRuntime({
      handle,
      notifyDirty: async () => {
        throw new Error('persistence down (injected)');
      },
      diagnosticEmitter: log.emitter,
      clock: () => NOW_MS,
    });

    await expect(runtime.replaceSchema({ schema: ENV_KEEP })).rejects.toMatchObject({
      phase: 'notify-dirty-failed',
      committed: true,
    });

    const rec = firstAttempt(await waitAttempts(log, 1));
    expect(rec.operation).toBe('schema-replacement');
    expect(rec.stage).toBe('dirty-notification');
    expect(rec.code).toBe('NSRT-FATAL-SCHEMA-WRITE-INTERNAL');
    expect(rec.sourcePhase).toBe('notify-dirty-failed');
    expect(rec.input.capture).toBe('digest');
    expect(rec.result.kind).toBe('fatal');
    if (rec.result.kind === 'fatal') {
      // 三联之一：fatal committed:true + 精确事务 bytes（基态重放可见新 SCHEMA.text，ROOT 未动）
      expect(rec.result.committed).toBe(true);
      const fresh = applyCarrier(updateCarrierOf(rec.result), baseState); // 非 effect:update 即 throw 判失败
      expect(fresh.getMap('SCHEMA').get('text')).toBe(ENV_KEEP.text);
      expect(fresh.getMap('ROOT').get('n')).toBe(1);
    }
    // 三联之二/三：live doc 已提交（notifier 失败不撤销事务）；fatal 置位（SCHEMA 码）
    expect(runtime.getSchema()?.text).toBe(ENV_KEEP.text);
    expect(runtime.getStatus().fatal).toMatchObject({ code: 'NSRT-FATAL-SCHEMA-WRITE-INTERNAL' });
    await runtime.close().catch(() => undefined);
    await writer.dispose();
  });

  it('R8 结构不可达的动态演示：p0Gate 挂住时写槽永不启动（schemaState preparing 在槽体不可观测），放行后写正常完成', async () => {
    const log = makeLog();
    const { writer, handle } = await makeWriter();
    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => {
      releaseGate = r;
    });
    const runtime = createNamespaceRuntimeWithSeam({
      handle,
      notifyDirty: () => writer.saveDoc(handle),
      p0Gate: gate,
      diagnosticEmitter: log.emitter,
      clock: () => NOW_MS,
    } as never) as unknown as NamespaceRuntime;

    // P0 挂住：写被接纳但槽不启动（FIFO——P0 是队首真实节点）
    const wp = runtime.mutateData({ op: 'set', path: ['n'], value: 9 });
    let done = false;
    void wp.then(() => {
      done = true;
    });
    await new Promise<void>((r) => setTimeout(r, 40));
    expect(done).toBe(false); // 槽未启动——'preparing' 永不可被槽体观察（R8 前置结构性成立）
    expect(runtime.getStatus().schema.state).toBe('preparing');
    expect(log.records().length).toBe(0);

    releaseGate();
    await expect(wp).resolves.toEqual({ ok: true }); // P0 ready 后写正常完成——无 R8 fatal 触发
    expect(runtime.getStatus().fatal).toBeNull();
    expect(readOk(runtime, ['n'])).toBe(9);
    await handle.release();
    await writer.dispose();
  });

  it('seam 校验守卫：装配 emitter 而 doc 无 on/off ⇒ 构造 TypeError；真 Y.Doc ⇒ 不 throw', async () => {
    const log = makeLog();
    const fakeHandle = {
      getStatus: () => 'ready' as const,
      release: () => Promise.resolve(),
      owner: OWNER,
      docId: 'ns-1',
      doc: { notAYDoc: true }, // 无 on/off —— owned bytes 捕获依赖缺失
    };
    expect(() =>
      createNamespaceRuntimeWithSeam({
        handle: fakeHandle as never,
        notifyDirty: async () => undefined,
        diagnosticEmitter: log.emitter,
        clock: () => NOW_MS,
      }),
    ).toThrowError(/on\/off/);

    // 真 Y.Doc：构造不 throw（合法装配——Proxy handle 下 h.doc 透传真 Y.Doc 亦同）
    const { writer, handle } = await makeWriter();
    let constructed = false;
    try {
      const runtime = createNamespaceRuntimeWithSeam({
        handle,
        notifyDirty: () => writer.saveDoc(handle),
        diagnosticEmitter: log.emitter,
        clock: () => NOW_MS,
      } as never) as unknown as NamespaceRuntime;
      constructed = true;
      await expect
        .poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 })
        .toBe('ready');
      const res = await runtime.mutateData({ op: 'set', path: ['n'], value: 2 });
      expect(res).toEqual({ ok: true });
      await waitAttempts(log, 1); // 正常 emit
      await runtime.close();
    } finally {
      expect(constructed).toBe(true);
      await writer.dispose();
    }
  });
});

// ── DV-6 队列满 + inputPolicy=full 组合 ───────────────────────────────────────

describe('#149 SA7 DV-6 队列满 + inputPolicy=full', () => {
  it('capacity=1 + full 策略：第二条 drop 的 stats 断言；drop 路径对 input 投影无副作用', async () => {
    const log = makeLog({ capacity: 1, inputPolicy: 'full', updateCapture: true });
    let emitCalls = 0;
    const countingEmitter: NamespaceDiagnosticChangeEmitter = {
      emit: (e) => {
        emitCalls += 1;
        log.emitter.emit(e);
      },
    };
    const { writer, handle } = await makeWriter();
    const runtime = await makeRuntime({
      handle,
      notifyDirty: () => writer.saveDoc(handle),
      diagnosticEmitter: countingEmitter,
      clock: () => NOW_MS,
    });

    const r1 = await runtime.mutateData({ op: 'set', path: ['n'], value: 11 });
    expect(r1).toEqual({ ok: true });
    const r2 = await runtime.mutateData({ op: 'set', path: ['n'], value: 22 });
    expect(r2).toEqual({ ok: true });

    // 等两次 emit 尝试都发生（第二次在管线内被 queue-full drop）
    await expect.poll(() => emitCalls, { interval: 5, timeout: 3_000 }).toBe(2);

    const stats = log.stats();
    expect(stats.accepted).toBe(1); // 第一条接纳
    expect(stats.droppedTotal).toBe(1); // 第二条 drop newest
    expect(stats.queueDepth).toBe(1);
    expect(stats.droppedByReason['queue-full']).toBe(1);
    expect(stats.droppedByOperationReason['root-mutation:queue-full']).toBe(1);

    // drop 对 input 投影无副作用：已接纳记录保持完整 full 快照（未被降级/篡改/冻结失效；
    // full 策略下 adapter 同时携带 digest——toMatchObject 部分匹配，digest 存在合法）
    const recs = log.records();
    expect(recs.length).toBe(1);
    const rec = recs[0] as AttemptRecord;
    expect(rec.input).toMatchObject({ capture: 'full', value: { op: 'set', path: ['n'], value: 11 } });
    expect(Object.isFrozen(rec)).toBe(true);
    expect(rec.result.kind).toBe('committed');

    // 业务面：两写均成功、FIFO 顺序正确（drop 只影响日志）
    expect(readOk(runtime, ['n'])).toBe(22);
    expect(runtime.getStatus().fatal).toBeNull();
    await handle.release();
    await writer.dispose();
  });
});

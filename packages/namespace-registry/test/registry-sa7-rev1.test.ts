/**
 * SA7 补充动态测试 — issue #112 round 2 修订轮（rev1，commit d183d3b 动态验证）。
 *
 * 攻击目标（对 SA6 4 红灯转绿面之外的缺口，全部运行时行为断言、零源码文本断言）：
 * - 19d（P1 floating-window 对抗）：同步 throw entry **不居 Map 插入序首位** + 首位
 *   entry 的 close Promise 为 gated rejection（挂起）——聚合循环 `await` 被首位挂起
 *   期间，合成 rejected Promise 必须已 handled（`void promise.catch(()=>{})` 防御的
 *   载荷场景；19b/19c 中同步 throw entry 均居首位，该防御非其转绿前提——SA2 评审
 *   明示）。跨 setImmediate/setTimeout 宏任务 checkpoint 后零 unhandled rejection，
 *   放行后聚合次序/恰一次/stopped 全保持。
 * - 19d-CTRL（探针灵敏度对照）：同款 turn 结构下裸 `Promise.reject`（零 handler）
 *   必被探针捕获——证明 19d 的「零 unhandled」断言具备真判别力（若移除即刻空
 *   catch 防御，19d 将转红）。
 * - R5P（R5′ 残余窗口活链路契约化，SA4 动态审核重点 #1）：真实 cordis-plugin-timer
 *   TimerService + 真实 MemoryPersistence + 真实 registry plugin + gated 写排空窗口：
 *   窗口内（persistence fiber UNLOADING）到达 saveDoc 的在途写按设计 §8 R5′ 声明
 *   reject——写调用方收到响亮 rejection（runtime 冻结稳定形态 RuntimeWriteFatalError
 *   'notify-dirty-failed'/committed=true，cause 链终端 = CordisError('INACTIVE_EFFECT')
 *   零信息损失）；close barrier/shutdown 终态不受影响（resolve undefined）；次序契约
 *   （registry-shutdown-settled < persistence-adapter-disposed）在真实 timer 在场下
 *   成立；adapter dispose 恰一次；零 unhandled rejection。门控拓扑使全程确定性
 *   （零 native timer 到期、零 real sleep——真实 timer 仅作为装配在场）。
 * - 11d（P2 活链路，**确定性**）：testing seam registry + 经
 *   createCordisRegistryScheduler 的**真实 ctx.timeout 桥**（TimerService/ctx.effect/
 *   native setTimeout 真实武装；idleTimeoutMs=300_000 → 测试期内 native 必不到期，
 *   零真实时钟依赖）+ 回调捕获后**确定性手动触发**——close 同步 throw 不逃出回调
 *   （逃逸即沿本测试调用栈直接失败；收编/逃逸语义位于 beginIdleClose、在回调触发者
 *   上游，与触发者无关——判别器等价）；真实 disposer 取消语义（clearTimeout 路径）；
 *   observer idle-close-failed exact cause 恰一次；entry 移除（后续 open 全新
 *   generation）；零 unhandled rejection。
 * - 11d-SMOKE（P2 活链路 native 到期冒烟，**显式 smoke 豁免——本文件唯一非确定性
 *   点：60ms real sleep**）：同拓扑但 idleTimeoutMs=15ms，native setTimeout 真实到期
 *   触发同步 throw——异常不逃出 native timer 回调（若逃逸 = uncaughtException =
 *   进程级崩溃，测试自身即判别器）。豁免理由：「native 到期 → TimerService
 *   dispose() → callback() → beginIdleClose」的到期链路（含进程级崩溃面）无法以
 *   fake scheduler/受控 gate 等价复刻，必须有真实墙钟到期；确定性分工 = 11b（fake
 *   scheduler 全链路）+ 11d（真实桥武装 + 确定性触发，除「native 到期」外全链路），
 *   本冒烟仅锚定 native 到期交付与 throw 形态下进程存活（SA7-P4 烟囱先例：native
 *   到期 happy path 已锚定，本例补 throw 形态）。60ms = idleTimeoutMs(15ms)×4 余量。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import { createMemoryPersistencePlugin, provideNomicorePersistence } from '@nomicore/persistence';
import { createManualClock, createManualClockPlugin } from '@nomicore/clock/testing';
import type { NamespaceRuntime, NamespaceRuntimeStatus } from '@nomicore/namespace-runtime';
import { NamespaceRegistryShutdownError } from '@nomicore/namespace-registry';
import type { NamespaceLease, RegistryTimeoutScheduler } from '@nomicore/namespace-registry';
import { createNamespaceRegistryForTesting, createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import { createNamespaceRegistryPlugin } from '@nomicore/namespace-registry';
import { createCordisRegistryScheduler } from '../src/plugin.js';
import { Context } from '@deepseek-ai/cordis';
import TimerService from '@deepseek-ai/cordis-plugin-timer';

const FIBER_STATE_PENDING = 0;
const FIBER_STATE_UNLOADING = 5;

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (cause: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<void>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(times = 40): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

/** 宏任务 checkpoint 展开（P1 floating-window 判别的载荷：跨 turn 检查
 * unhandledRejection——Node 在 turn 结束的检查点对无 handler 的 rejected Promise
 * 触发事件）。setTimeout(0) 为 0ms 定时器**轮转**（queue 语义的宏任务 checkpoint，
 * 非真实墙钟等待——确定性，与 real sleep 无关）。 */
async function flushMacrotasks(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

function manualClock(): { now: () => number } {
  return { now: () => 1_700_000_123_456 };
}

function collectUnhandledRejections(): { readonly events: unknown[]; dispose(): void } {
  const events: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    events.push(reason);
  };
  process.on('unhandledRejection', onRejection);
  return {
    events,
    dispose() {
      process.off('unhandledRejection', onRejection);
    },
  };
}

class StubHandle implements DocHandle {
  releaseCalls = 0;
  readonly doc: Y.Doc;

  constructor(
    readonly owner: User,
    readonly docId: string,
  ) {
    this.doc = new Y.Doc();
  }

  getStatus(): 'ready' {
    return 'ready';
  }

  release(): Promise<void> {
    this.releaseCalls += 1;
    return Promise.resolve();
  }
}

class StubPersistence implements DocPersistence {
  readonly loadCalls: Array<{ owner: User; docId: string }> = [];
  private readonly queue: Array<DocHandle | null> = [];

  queueLoad(result: DocHandle | null): void {
    this.queue.push(result);
  }

  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    this.loadCalls.push({ owner, docId });
    return this.queue.shift() ?? null;
  }

  async saveDoc(): Promise<void> {
    /* idle/shutdown 路径不消费 */
  }

  async createDoc(owner: User, docId: string): Promise<DocHandle> {
    return new StubHandle(owner, docId);
  }
}

const READY_STATUS: NamespaceRuntimeStatus = {
  lifecycle: 'ready',
  read: { enabled: true },
  rootWrite: { enabled: true },
  schemaWrite: { enabled: true },
  schema: { state: 'ready' },
  fatal: null,
  close: null,
};

interface RuntimeClosePlan {
  gate?: Deferred;
  rejectWith?: unknown;
  syncThrowWith?: unknown;
}

class ObservableRuntime implements NamespaceRuntime {
  closeCalls = 0;
  readonly owner = Object.freeze({ userId: 'u-sa7-rev1' });

  constructor(
    readonly marker: string,
    readonly namespaceId: string,
    private readonly closePlan: RuntimeClosePlan = {},
  ) {}

  read() {
    return { ok: true as const, value: this.marker };
  }

  getSchemaEnvelope(): null {
    return null;
  }

  getMetadata(): { marker: string } {
    return { marker: this.marker };
  }

  getActiveSchema(): null {
    return null;
  }

  getStatus(): NamespaceRuntimeStatus {
    return READY_STATUS;
  }

  mutateRoot(): Promise<{ ok: true }> {
    return Promise.resolve({ ok: true });
  }

  replaceSchema(): Promise<{ ok: true }> {
    return Promise.resolve({ ok: true });
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    if (this.closePlan.syncThrowWith !== undefined) {
      throw this.closePlan.syncThrowWith;
    }
    if (this.closePlan.gate !== undefined) {
      return this.closePlan.gate.promise;
    }
    if (this.closePlan.rejectWith !== undefined) {
      return Promise.reject(this.closePlan.rejectWith);
    }
    return Promise.resolve();
  }
}

function okLease(result: unknown): NamespaceLease {
  const r = result as { ok?: boolean; lease?: NamespaceLease };
  expect(r.ok, `应成功，实际：${JSON.stringify(result)}`).toBe(true);
  if (!r.ok || r.lease === undefined) throw new Error('unreachable');
  return r.lease;
}

interface ObservedEvent {
  readonly type: string;
  readonly cause?: unknown;
}

function collectObserver(): { readonly events: ObservedEvent[]; sink: (event: unknown) => void } {
  const events: ObservedEvent[] = [];
  return {
    events,
    sink: (event: unknown) => {
      events.push(event as ObservedEvent);
    },
  };
}

describe('SA7 rev1 补充动态（P1 floating-window / R5′ 活链路 / P2 real timer）', () => {
  it('19d. P1 floating-window 对抗：同步 throw entry 不居首位——首位 gated rejection 挂起聚合循环期间（跨宏任务 checkpoint），合成 rejected Promise 零 unhandled rejection；放行后聚合次序/恰一次/stopped 全保持', async () => {
    const probe = collectUnhandledRejections();
    try {
      const persistence = new StubPersistence();
      persistence.queueLoad(new StubHandle({ userId: 'u-sa7-rev1' }, 'k1'));
      persistence.queueLoad(new StubHandle({ userId: 'u-sa7-rev1' }, 'k2'));
      const scheduler = createRegistryTestScheduler();
      const k1Gate = deferred();
      const k1Cause = new Error('shutdown-close-gated-reject-19d-k1');
      const syncCause = new Error('shutdown-close-sync-throw-19d');
      const runtimes = new Map<string, ObservableRuntime>();
      const registry = createNamespaceRegistryForTesting(persistence, {
        clock: manualClock(),
        scheduler,
        idleTimeoutMs: 300_000,
        runtimeFactory: (handle) => {
          // k1 居 Map 插入序首位：close 返回 gated Promise（挂起）；
          // k2 居次位：close 同步 throw——其合成 rejected Promise 在聚合循环 await
          // 到它之前，跨过「k1 的 await 挂起」窗口（floating window 载荷场景）。
          const closePlan: RuntimeClosePlan =
            handle.docId === 'k1' ? { gate: k1Gate, rejectWith: k1Cause } : { syncThrowWith: syncCause };
          const r = new ObservableRuntime(`R-${handle.docId}`, handle.docId, closePlan);
          runtimes.set(handle.docId, r);
          return r;
        },
      });
      const l1 = okLease(await registry.open({ userId: 'u-sa7-rev1' }, 'k1'));
      const l2 = okLease(await registry.open({ userId: 'u-sa7-rev1' }, 'k2'));

      const shutdownPromise = registry.shutdown();
      // 聚合循环此刻应挂起在 k1 的 gated close Promise 上（k2 的合成 rejected
      // Promise 已存在）。跨多个宏任务 checkpoint（Node 在 turn 结束检查无 handler
      // 的 rejected Promise）——零 unhandled rejection = 即刻空 catch 防御在载荷
      // 场景下真实生效。
      await flushMacrotasks(3);
      expect(probe.events).toEqual([]); // ★ floating window 判别核心
      expect(runtimes.get('k1')?.closeCalls).toBe(1);
      expect(runtimes.get('k2')?.closeCalls).toBe(1);

      // 放行首位 rejection → 聚合循环继续 → k2 的合成 Promise 被第二次 await（合法
      // 多 handler）→ 双 cause 同构聚合（次序 = Map 插入序，恰一次）。
      k1Gate.reject(k1Cause);
      const err = await shutdownPromise.then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(NamespaceRegistryShutdownError);
      if (err instanceof NamespaceRegistryShutdownError) {
        expect(err.failures.length).toBe(2);
        expect(err.failures[0]?.namespaceId).toBe('k1');
        expect(err.failures[0]?.cause).toBe(k1Cause);
        expect(err.failures[1]?.namespaceId).toBe('k2');
        expect(err.failures[1]?.cause).toBe(syncCause); // exact 同步 cause（恰一次，无重复收录）
      }
      expect(registry.getStatus()).toEqual({ state: 'stopped' });
      await Promise.all([
        l1.release().catch(() => {}),
        l2.release().catch(() => {}),
      ]);
      await flushMacrotasks(1);
      expect(probe.events).toEqual([]); // 全程零 unhandled rejection
    } finally {
      probe.dispose();
    }
  });

  it('19d-CTRL. 探针灵敏度对照：同款 turn 结构（await 挂起 + setImmediate/setTimeout checkpoint）下裸 Promise.reject（零 handler）必被探针捕获——19d 的「零 unhandled」具备真判别力', async () => {
    const probe = collectUnhandledRejections();
    try {
      const neverSettles = new Promise<void>(() => {});
      const p = (async () => {
        // 复刻 19d 的结构：先 await 一个挂起 Promise，随后（挂起前同步段）制造一个
        // 无 handler 的 rejected Promise。
        void Promise.reject(new Error('control-bare-reject-19d-ctrl'));
        await neverSettles;
      })();
      void p;
      await flushMacrotasks(3);
      expect(probe.events.length).toBeGreaterThanOrEqual(1); // 探针在该 turn 结构下确有检出
      expect(probe.events.map(String).join('\n')).toContain('control-bare-reject-19d-ctrl');
    } finally {
      probe.dispose();
    }
  });

  it('R5P. R5′ 活链路契约（真实 TimerService + gated drain）：窗口内在途写 reject（cause 链终端 CordisError INACTIVE_EFFECT）交付写调用方；shutdown resolve undefined；registry-shutdown-settled < persistence-adapter-disposed；dispose 恰一次；零 unhandled', async () => {
    const probe = collectUnhandledRejections();
    try {
      const ctx = new Context();
      createManualClockPlugin(createManualClock(0)).apply(ctx);
      new TimerService(ctx); // 真实 timer 服务（native setTimeout/clearTimeout，经 ctx.effect 注册）
      const memoryPlugin = createMemoryPersistencePlugin();
      const memoryFiber = ctx.plugin(memoryPlugin);
      await memoryFiber;
      const registryPlugin = createNamespaceRegistryPlugin({ idleTimeoutMs: 300_000 });
      const registryFiber = ctx.plugin(registryPlugin);
      await registryFiber;
      const registry = registryPlugin.instance!;
      expect(registry).toBeDefined();
      const adapter = memoryPlugin.instance!;
      expect(adapter).toBeDefined();

      const events: string[] = [];
      const originalDispose = adapter.dispose.bind(adapter);
      adapter.dispose = async () => {
        events.push('persistence-adapter-disposed');
        await originalDispose();
        events.push('persistence-adapter-disposed-complete');
      };
      const saveGate = deferred();
      const originalSaveDoc = adapter.saveDoc.bind(adapter);
      let gated = false;
      adapter.saveDoc = async (handle: DocHandle) => {
        if (!gated) {
          gated = true;
          await saveGate.promise;
        }
        return originalSaveDoc(handle);
      };

      const created = await registry.create({
        owner: { userId: 'u-r5p' },
        namespaceId: 'ns-r5p',
        schema: { lang: 'vfsl', version: 1, id: 'ns-r5p', text: 'type ROOT = { n: number; };\n' },
        root: { n: 42 },
      });
      expect(created.ok).toBe(true);
      const lease = okLease(created);
      const writePromise = lease.mutateRoot({ op: 'set', path: ['n'], value: 43 });
      await flushMicrotasks(30);
      expect(gated).toBe(true); // 写槽 S6 已挂于 gated saveDoc（排空窗口拉开）

      const shutdownPromise = registry.shutdown();
      let shutdownSettled = false;
      void shutdownPromise.then(
        () => {
          shutdownSettled = true;
          events.push('registry-shutdown-settled');
        },
        () => {
          shutdownSettled = true;
          events.push('registry-shutdown-settled');
        },
      );
      await flushMicrotasks(20);
      expect(shutdownSettled).toBe(false); // shutdown 严格挂起（写排空门控中）

      const disposal = memoryFiber.dispose();
      await flushMicrotasks(30);
      // ★ 窗口锚定：persistence fiber 处于 UNLOADING（drain 窗口），adapter dispose
      //   未发生，shutdown 未 settle。
      expect(memoryFiber.state).toBe(FIBER_STATE_UNLOADING);
      expect(events).toEqual([]);
      expect(shutdownSettled).toBe(false);

      // ★ R5′ 核心：窗口内放行写 → saveDoc → scheduleFlush → ctx.timeout（绑定调用
      //   方 fiber = memory fiber，UNLOADING 态）→ CordisError('INACTIVE_EFFECT')。
      saveGate.resolve();
      const writeRejection = await writePromise.then(
        () => undefined,
        (e: unknown) => e,
      );
      // 写调用方收到响亮 rejection：runtime 冻结稳定形态（notify-dirty-failed /
      // committed=true），cause 链终端 = 原始 CordisError（零信息损失）。
      expect(writeRejection).toBeInstanceOf(Error);
      const terminal = (() => {
        let cursor = writeRejection as { cause?: unknown } | undefined;
        while (cursor instanceof Error && cursor.cause !== undefined) cursor = cursor.cause as { cause?: unknown };
        return cursor as { code?: unknown; message?: unknown; constructor?: { name?: string } };
      })();
      expect(writeRejection?.constructor?.name).toBe('RuntimeWriteFatalError');
      expect(String(writeRejection)).toContain('notify-dirty-failed');
      expect(terminal.constructor?.name).toBe('CordisError');
      expect(terminal.code).toBe('INACTIVE_EFFECT');
      expect(String(terminal.message)).toContain('cannot create effect on inactive context');

      await disposal;
      await flushMicrotasks(30);
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });

      // close barrier/shutdown 终态不受写失败影响：resolve undefined（若聚合失败则
      // reject NamespaceRegistryShutdownError）。
      await expect(shutdownPromise).resolves.toBeUndefined();
      // 次序契约（真实 timer 在场）：settled 严格先于 adapter dispose。
      expect(events.indexOf('registry-shutdown-settled')).toBeGreaterThanOrEqual(0);
      expect(events.indexOf('registry-shutdown-settled')).toBeLessThan(
        events.indexOf('persistence-adapter-disposed'),
      );
      expect(events.filter((e) => e === 'persistence-adapter-disposed').length).toBe(1);
      expect(events.filter((e) => e === 'persistence-adapter-disposed-complete').length).toBe(1);
      expect(registry.getStatus()).toEqual({ state: 'stopped' });
      expect(ctx.get('nomicoreRegistry')).toBeUndefined();
      expect(ctx.get('nomicorePersistence')).toBeUndefined();
      expect(registryPlugin.instance).toBeUndefined();
      expect(registryFiber.state).toBe(FIBER_STATE_PENDING);
      await lease.release().catch(() => {});
      await ctx.fiber.dispose();
      await flushMicrotasks(30);
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]); // 零 unhandled rejection（写 rejection 归写调用方）
    } finally {
      probe.dispose();
    }
  });

  it('11d. P2 活链路（确定性）：真实 TimerService 经 ctx.timeout 真实桥武装 idle timer（native setTimeout@300_000ms，测试期内必不到期——零真实时钟依赖）+ 确定性手动触发——同步 throw 不逃出回调；真实 disposer 取消语义；observer exact cause 恰一次；entry 移除（新 generation）；零 unhandled rejection', async () => {
    const probe = collectUnhandledRejections();
    try {
      const ctx = new Context();
      createManualClockPlugin(createManualClock(0)).apply(ctx);
      new TimerService(ctx); // 真实 timer 服务（ctx.timeout → TimerService → ctx.effect → native setTimeout）
      const persistence = new StubPersistence();
      persistence.queueLoad(new StubHandle({ userId: 'u-sa7-rev1' }, 'k'));
      persistence.queueLoad(new StubHandle({ userId: 'u-sa7-rev1' }, 'k'));
      provideNomicorePersistence(ctx, persistence); // scheduler 桥的宿主依赖断言所需（SA7-P4 同款）
      const syncCause = new Error('idle-close-sync-throw-11d');
      const observer = collectObserver();
      const runtimes: ObservableRuntime[] = [];
      // ★ 真实桥 + 回调捕获：武装路径完全走真实 TimerService/ctx.effect/native
      //   setTimeout（与生产 plugin 同款 wiring，idleTimeoutMs=300_000 → native 到期
      //   在 300s 后，测试期内必不到期——确定性、零真实时钟依赖）；registry 的 idle
      //   回调被捕获后由本测试**确定性手动触发**。同步 throw 的收编/逃逸语义位于
      //   beginIdleClose（在回调触发者的上游），与触发者无关：若收编缺失，异常沿本
      //   测试调用栈传播 → 本用例直接失败——与 11b 的 advanceBy 拒绝同构的判别器。
      //   native 到期链路（含进程级崩溃面）由 11d-SMOKE 显式冒烟。
      const bridge = createCordisRegistryScheduler(ctx);
      const armedCallbacks: Array<() => void> = [];
      const armedHandles: unknown[] = [];
      const scheduler: RegistryTimeoutScheduler = {
        setTimeout: (callback, delayMs) => {
          const handle = bridge.setTimeout(callback, delayMs); // 真实武装（native setTimeout）
          armedCallbacks.push(callback);
          armedHandles.push(handle);
          return handle;
        },
        clearTimeout: (handle) => {
          bridge.clearTimeout(handle); // registry 取消路径照走真实 disposer（幂等语义）
        },
      };
      const registry = createNamespaceRegistryForTesting(persistence, {
        clock: { now: () => 1_700_000_123_456 },
        scheduler,
        idleTimeoutMs: 300_000,
        runtimeFactory: () => {
          const r = new ObservableRuntime(
            `R${runtimes.length + 1}`,
            'k',
            runtimes.length === 0 ? { syncThrowWith: syncCause } : {},
          );
          runtimes.push(r);
          return r;
        },
        observer: observer.sink,
      });
      const lease1 = okLease(await registry.open({ userId: 'u-sa7-rev1' }, 'k'));
      await lease1.release(); // last lease → idle → 真实桥武装 native timer@300_000ms
      expect(armedCallbacks.length).toBe(1); // 真实武装确证（TimerService 零 throw）
      // ★ 确定性触发（同步调用栈 = 本测试）：同步 throw 被收编——不逃出回调。
      armedCallbacks[0]!();
      await flushMicrotasks();
      expect(runtimes[0]?.closeCalls).toBe(1); // close 发起恰一次（收编后正常记账）
      const failed = observer.events.filter((e) => e.type === 'idle-close-failed');
      expect(failed.length).toBe(1); // exact cause 恰一次
      if (failed[0]) {
        expect(failed[0].cause).toBe(syncCause);
      }
      // entry 移除 → 后续 open 全新 generation（loadCalls 2 + 新 Runtime）。
      const lease2 = okLease(await registry.open({ userId: 'u-sa7-rev1' }, 'k'));
      expect(persistence.loadCalls.length).toBe(2);
      expect(runtimes.length).toBe(2);
      expect(lease2.read(['x'])).toEqual({ ok: true, value: 'R2' });
      // 清扫：release → 重武装（真实桥第二枚 native timer）→ shutdown 同步取消
      // （registry 的 clearTimeout 路径走真实 disposer）+ 关闭 R2。
      await lease2.release();
      expect(armedCallbacks.length).toBe(2);
      await registry.shutdown();
      expect(runtimes[1]?.closeCalls).toBe(1);
      expect(registry.getStatus()).toEqual({ state: 'stopped' });
      // 兜底清扫：对全部曾武装的真实 native timer 显式取消（首次触发的回调其 native
      // 注册仍在——真实 disposer 幂等，双重取消无害；确保零 pending native timer、
      // 事件循环零残留，测试出口确定性）。
      for (const handle of armedHandles) bridge.clearTimeout(handle);
      await ctx.fiber.dispose();
      await flushMicrotasks();
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]); // 零 unhandled rejection
    } finally {
      probe.dispose();
    }
  });

  it('11d-SMOKE. P2 活链路 native 到期冒烟（smoke 豁免：60ms real sleep，本文件唯一非确定性点）：idleTimeoutMs=15ms 下 native setTimeout 真实到期触发同步 throw——不逃出 native timer 回调（进程零崩溃）；observer exact cause 恰一次；entry 移除（新 generation）；零 unhandled rejection', async () => {
    const probe = collectUnhandledRejections();
    try {
      const ctx = new Context();
      createManualClockPlugin(createManualClock(0)).apply(ctx);
      new TimerService(ctx); // 真实 timer：idle 武装经 createCordisRegistryScheduler → ctx.timeout
      const persistence = new StubPersistence();
      persistence.queueLoad(new StubHandle({ userId: 'u-sa7-rev1' }, 'k'));
      persistence.queueLoad(new StubHandle({ userId: 'u-sa7-rev1' }, 'k'));
      provideNomicorePersistence(ctx, persistence); // scheduler 桥的宿主依赖断言所需（SA7-P4 同款）
      const syncCause = new Error('idle-close-sync-throw-11d-smoke');
      const observer = collectObserver();
      const runtimes: ObservableRuntime[] = [];
      const registry = createNamespaceRegistryForTesting(persistence, {
        clock: { now: () => 1_700_000_123_456 },
        // ★ 真实 ctx.timeout 桥（与生产 plugin 同款 wiring）：idle timer 经
        //   TimerService → ctx.effect → native setTimeout(15ms) 武装，并真实到期。
        scheduler: createCordisRegistryScheduler(ctx),
        idleTimeoutMs: 15, // 15ms native 窗口
        runtimeFactory: () => {
          const r = new ObservableRuntime(
            `R${runtimes.length + 1}`,
            'k',
            runtimes.length === 0 ? { syncThrowWith: syncCause } : {},
          );
          runtimes.push(r);
          return r;
        },
        observer: observer.sink,
      });
      const lease1 = okLease(await registry.open({ userId: 'u-sa7-rev1' }, 'k'));
      await lease1.release(); // last lease → idle → ctx.timeout(15ms) native 武装
      // ★ 本用例唯一非确定性点：60ms real sleep（= idleTimeoutMs 15ms × 4 余量）。
      //   豁免理由（见文件头注）：「native 到期 → TimerService dispose() →
      //   callback() → beginIdleClose」链路无法以 fake scheduler/受控 gate 等价复刻；
      //   确定性分工由 11b + 11d 承载，本冒烟仅锚定 native 到期交付与 throw 形态下
      //   进程存活（SA7-P4 烟囱先例）。若同步 throw 逃出 native timer 回调 =
      //   uncaughtException = 进程崩溃，本测试无法到达下方断言（判别器即测试自身存活）。
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 60);
      });
      await flushMicrotasks();
      expect(runtimes[0]?.closeCalls).toBe(1); // close 发起恰一次（收编后正常记账）
      const failed = observer.events.filter((e) => e.type === 'idle-close-failed');
      expect(failed.length).toBe(1); // exact cause 恰一次
      if (failed[0]) {
        expect(failed[0].cause).toBe(syncCause);
      }
      // entry 移除 → 后续 open 全新 generation（loadCalls 2 + 新 Runtime）。
      const lease2 = okLease(await registry.open({ userId: 'u-sa7-rev1' }, 'k'));
      expect(persistence.loadCalls.length).toBe(2);
      expect(runtimes.length).toBe(2);
      expect(lease2.read(['x'])).toEqual({ ok: true, value: 'R2' });
      // 清扫：release → 重武装 → shutdown 同步取消 native timer + 关闭 R2。
      await lease2.release();
      await registry.shutdown();
      expect(runtimes[1]?.closeCalls).toBe(1);
      expect(registry.getStatus()).toEqual({ state: 'stopped' });
      await ctx.fiber.dispose();
      await flushMicrotasks();
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]); // 零 unhandled rejection
    } finally {
      probe.dispose();
    }
  });

  it('11e. P2 reject 臂对抗：observer sink 在 idle-close-failed 分发时同步 throw——隔离生效（零 unhandled、零逃逸），removeEntryAfterClose 仍执行（entry 移除、后续 open 新 generation）', async () => {
    const probe = collectUnhandledRejections();
    try {
      const persistence = new StubPersistence();
      persistence.queueLoad(new StubHandle({ userId: 'u-sa7-rev1' }, 'k'));
      persistence.queueLoad(new StubHandle({ userId: 'u-sa7-rev1' }, 'k'));
      const scheduler = createRegistryTestScheduler();
      const syncCause = new Error('idle-close-sync-throw-11e');
      let sinkThrows = 0;
      const runtimes: ObservableRuntime[] = [];
      const registry = createNamespaceRegistryForTesting(persistence, {
        clock: manualClock(),
        scheduler,
        idleTimeoutMs: 300_000,
        runtimeFactory: () => {
          const r = new ObservableRuntime(
            `R${runtimes.length + 1}`,
            'k',
            runtimes.length === 0 ? { syncThrowWith: syncCause } : {},
          );
          runtimes.push(r);
          return r;
        },
        // ★ 敌意 sink：在 idle-close-failed 分发点同步 throw——若隔离失效，
        //   throw 会沿 reject 臂传播：派生 Promise reject → unhandled rejection
        //   且 removeEntryAfterClose 被跳过（entry 残留 → 后续 open 复用旧 Runtime）。
        observer: () => {
          sinkThrows += 1;
          throw new Error('hostile-sink-throw-11e');
        },
      });
      const lease1 = okLease(await registry.open({ userId: 'u-sa7-rev1' }, 'k'));
      await lease1.release();
      const advanceOutcome = await scheduler.advanceBy(300_000).then(
        () => 'settled',
        (e: unknown) => `rejected:${String(e)}`,
      );
      expect(advanceOutcome).toBe('settled'); // 隔离生效：敌意 sink throw 不逃出 timer 回调
      await flushMicrotasks();
      expect(sinkThrows).toBeGreaterThanOrEqual(1); // sink 确被调用（throw 确实发生）
      expect(runtimes[0]?.closeCalls).toBe(1);
      // ★ 移除不受 sink throw 影响：后续 open 建立全新 generation。
      const lease2 = okLease(await registry.open({ userId: 'u-sa7-rev1' }, 'k'));
      expect(persistence.loadCalls.length).toBe(2);
      expect(runtimes.length).toBe(2);
      expect(lease2.read(['x'])).toEqual({ ok: true, value: 'R2' });
      await lease2.release();
      await scheduler.advanceBy(300_000);
      await flushMicrotasks();
      expect(runtimes[1]?.closeCalls).toBe(1);
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]); // 敌意 sink 下仍零 unhandled rejection
    } finally {
      probe.dispose();
    }
  });
});

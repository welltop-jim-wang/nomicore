/**
 * SA7 动态攻击验证 — issue #112：敌意注入（总控攻击面 3）。
 *
 * 攻击目标（全部确定性、零 real sleep）：
 * - SA7-H1 scheduler.setTimeout 重武装时同步 throw（idle-arm-failed 通道的重武装变体：
 *   首次武装成功、第二次武装失败 → entry 停留 active、open 零 loadDoc 复用、shutdown 兜底）；
 * - SA7-H2 违约 scheduler 同 callback 双重 fire（gate 挂起 close 与立即 close 两变体：
 *   arm-token 判别 + phase 守卫使第二次 fire no-op，close 恰一次、零异常）；
 * - SA7-H3 observer 每事件 throw（公开结果不变、零 unhandled rejection——dispatchObserver 隔离）；
 * - SA7-H4 close 永不 settle：withTimeout 探针（经注入 scheduler 实现，零 real timer）
 *   证明 shutdown/open 处于「等待」而非崩溃（R3 契约）；
 * - SA7-H5 Clock.now 回跳（wall-clock 不承诺单调）：idle 窗口纯由 scheduler 计时，
 *   回跳不提前/推迟 close；create 在回跳时钟下照常；
 * - SA7-H6 getStatus 冻结常量身份锚（mutation h 杀伤补充锚：跨调用/跨实例 same
 *   identity + Object.isFrozen——设计 §2.E「恒冻结常量」纪律的可观测锚）。
 *
 * 补充用例登记（SA7 报告 §补充用例）：H1-H6。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import type { NamespaceRuntime, NamespaceRuntimeStatus } from '@nomicore/namespace-runtime';
import type { NamespaceLease } from '@nomicore/namespace-registry';
import type { RegistryTimeoutScheduler } from '@nomicore/namespace-registry';
import { createNamespaceRegistryForTesting, createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import type { RegistryObserverEvent } from '../src/observer.js';

// ── 确定性并发原语（禁 real sleep）────────────────────────────────────────────

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


// ── phase-5 切片 1（ADR 0010）：受控随机源确定性 helper（测试内定义；禁止从 src 导出）──
// 第 n 次生成 = `ns-` + n 的 32 位小写 hex；每调用恰按 128-bit（16 字节）请求。

function makeDeterministicRandomBytes(): {
  randomBytes: (length: number) => Uint8Array;
  readonly id: (n: number) => string;
} {
  let counter = 0;
  return {
    randomBytes(length: number): Uint8Array {
      if (length !== 16) {
        throw new Error(`受控随机源必须按 128-bit（16 字节）请求，实际请求 ${length} 字节`);
      }
      counter += 1;
      const hex = counter.toString(16).padStart(32, '0');
      const out = new Uint8Array(16);
      for (let i = 0; i < 16; i += 1) {
        out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      return out;
    },
    id: (n: number) => `ns-${n.toString(16).padStart(32, '0')}`,
  };
}

const TEST_RANDOM_BYTES: (length: number) => Uint8Array = makeDeterministicRandomBytes().randomBytes;

// ── stub（沿用 registry-idle.test.ts 形态）────────────────────────────────────

class StubHandle implements DocHandle {
  releaseCalls = 0;
  readonly doc: Y.Doc;

  constructor(readonly owner: User, readonly docId: string) {
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
  readonly createCalls: Array<{ owner: User; docId: string }> = [];
  saveCalls = 0;

  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    this.loadCalls.push({ owner, docId });
    return new StubHandle(owner, docId);
  }

  async saveDoc(): Promise<void> {
    this.saveCalls += 1;
  }

  async createDoc(owner: User, docId: string): Promise<DocHandle> {
    this.createCalls.push({ owner, docId });
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
  replication: { state: 'disabled' },
};

interface RuntimeClosePlan {
  gate?: Deferred;
  neverSettle?: boolean;
}

class ObservableRuntime implements NamespaceRuntime {
  closeCalls = 0;
  readonly owner = Object.freeze({ userId: 'u-hostile' });

  constructor(
    readonly marker: string,
    readonly namespaceId: string,
    private readonly closePlan: RuntimeClosePlan = {},
  ) {}

  readData() {
    return { ok: true as const, value: this.marker };
  }

  getSchema(): null {
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

  mutateData(): Promise<{ ok: true }> {
    return Promise.resolve({ ok: true });
  }

  replaceSchema(): Promise<{ ok: true }> {
    return Promise.resolve({ ok: true });
  }

  enableReplication(): Promise<{ ok: true }> {
    return Promise.resolve({ ok: true });
  }

  bumpReplicationEpoch(): Promise<{ ok: true }> {
    return Promise.resolve({ ok: true });
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    if (this.closePlan.neverSettle) {
      return new Promise<void>(() => {});
    }
    if (this.closePlan.gate !== undefined) {
      return this.closePlan.gate.promise;
    }
    return Promise.resolve();
  }
}

function okLease(result: unknown): NamespaceLease {
  const r = result as { ok?: boolean; lease?: NamespaceLease };
  expect(r.ok, `open 应成功，实际：${JSON.stringify(result)}`).toBe(true);
  if (!r.ok || r.lease === undefined) throw new Error('unreachable');
  return r.lease;
}

interface ObservedEvent {
  readonly type: string;
  readonly identity?: { readonly namespaceId: string };
  readonly cause?: unknown;
}

function collectObserver(): { events: ObservedEvent[]; sink: (e: RegistryObserverEvent) => void } {
  const events: ObservedEvent[] = [];
  return {
    events,
    sink: (e) => {
      events.push(e as unknown as ObservedEvent);
    },
  };
}

/** 双重 fire 注入面：记录每次武装（可判别 token + callback），fire 不消费（可重复触发）。 */
interface DoubleFireScheduler extends RegistryTimeoutScheduler {
  readonly armed: Array<{ readonly token: unknown; readonly callback: () => void }>;
  fire(index: number): void;
}

function createDoubleFireScheduler(): DoubleFireScheduler {
  const armed: DoubleFireScheduler['armed'] = [];
  let next = 0;
  return {
    armed,
    setTimeout(callback) {
      const token = { doubleFireToken: next };
      next += 1;
      armed.push({ token, callback });
      return token;
    },
    clearTimeout() {
      // 违约 no-op（与 adversarial 面同款：取消无效）
    },
    fire(index) {
      const timer = armed[index];
      if (timer === undefined) throw new Error(`无第 ${index} 个武装回调`);
      timer.callback();
    },
  };
}

describe('SA7 敌意注入（攻击面 3）：确定性、零 real sleep', () => {
  it('SA7-H1 scheduler.setTimeout 重武装时同步 throw：idle-arm-failed exact cause 恰一次、entry 停留 active、open 零 loadDoc 复用、shutdown 兜底关闭', async () => {
    const probe = collectUnhandledRejections();
    try {
      const inner = createRegistryTestScheduler();
      const armCause = new Error('SA7-H1: re-arm setTimeout throws');
      let arms = 0;
      const scheduler: RegistryTimeoutScheduler = {
        setTimeout: (callback, delayMs) => {
          arms += 1;
          if (arms >= 2) throw armCause; // 首次武装成功；重武装失败
          return inner.setTimeout(callback, delayMs);
        },
        clearTimeout: (handle) => inner.clearTimeout(handle),
      };
      const persistence = new StubPersistence();
      const observer = collectObserver();
      const runtime = new ObservableRuntime('R-H1', 'ns-h1');
      const registry = createNamespaceRegistryForTesting(persistence, {
        clock: manualClock(),
        scheduler,
        randomBytes: TEST_RANDOM_BYTES,
        idleTimeoutMs: 300_000,
        runtimeFactory: () => runtime,
        observer: observer.sink,
      });

      // 首次武装成功 → idle。
      const lease1 = okLease(await registry.open({ userId: 'u-hostile' }, 'ns-h1'));
      const p1 = lease1.release();
      expect(p1).toBe(lease1.release()); // same-Promise 不因回调通道破坏
      await p1;
      expect(inner.pending()).toBe(1);
      expect(observer.events.filter((e) => e.type === 'entry-idle').length).toBe(1);

      // 激活复用（取消首武装）→ 再释放：重武装 throw。
      const lease2 = okLease(await registry.open({ userId: 'u-hostile' }, 'ns-h1'));
      expect(inner.pending()).toBe(0);
      const p2 = lease2.release();
      await p2; // release 仍 resolve undefined（武装失败不破坏 release 契约）
      const failures = observer.events.filter((e) => e.type === 'idle-arm-failed');
      expect(failures.length).toBe(1);
      expect((failures[0] as { cause?: unknown }).cause).toBe(armCause); // exact cause

      // entry 停留 active：open 复用（零 loadDoc）。
      const lease3 = okLease(await registry.open({ userId: 'u-hostile' }, 'ns-h1'));
      expect(persistence.loadCalls.length).toBe(1);
      expect(lease3.getMetadata().marker).toBe('R-H1');
      expect(inner.pending()).toBe(0);

      // shutdown 兜底关闭。
      await lease3.release();
      await registry.shutdown();
      expect(runtime.closeCalls).toBe(1);
      expect(registry.getStatus()).toEqual({ state: 'stopped' });
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('SA7-H2 违约 scheduler 同 callback 双重 fire：gate 挂起与立即 settle 两变体均恰一次 close、零异常', async () => {
    const probe = collectUnhandledRejections();
    try {
      // 变体 A：close 挂于 gate——第一次 fire 建立 closing（entry 仍在 map），第二次 fire
      // 必须 no-op（arm-token 失配 + phase 守卫双保险），close 恰一次。
      {
        const closeGate = deferred();
        const runtime = new ObservableRuntime('R-H2a', 'ns-h2a', { gate: closeGate });
        const persistence = new StubPersistence();
        const observer = collectObserver();
        const scheduler = createDoubleFireScheduler();
        const registry = createNamespaceRegistryForTesting(persistence, {
          clock: manualClock(),
          scheduler,
          randomBytes: TEST_RANDOM_BYTES,
          idleTimeoutMs: 300_000,
          runtimeFactory: () => runtime,
          observer: observer.sink,
        });
        const lease = okLease(await registry.open({ userId: 'u-hostile' }, 'ns-h2a'));
        await lease.release();
        expect(scheduler.armed.length).toBe(1);

        scheduler.fire(0); // 第一次 fire：closing 建立（close 挂起、entry 仍在 map）
        expect(runtime.closeCalls).toBe(1);
        scheduler.fire(0); // 第二次 fire（同 callback 双重 fire）：必须 no-op
        scheduler.fire(0); // 第三次：同上（超额敌意）
        expect(runtime.closeCalls).toBe(1); // 恰一次 close
        expect(observer.events.filter((e) => e.type === 'idle-close-failed').length).toBe(0);

        closeGate.resolve();
        await flushMicrotasks();
        expect(runtime.closeCalls).toBe(1);
        // close settle 后 entry 已移除：open 走全新 loadDoc（零污染）。
        const lease2 = okLease(await registry.open({ userId: 'u-hostile' }, 'ns-h2a'));
        expect(persistence.loadCalls.length).toBe(2);
        await lease2.release();
      }

      // 变体 B：close 立即 resolve——settle 前后连发 fire 均不重复 close。
      {
        const runtime = new ObservableRuntime('R-H2b', 'ns-h2b');
        const persistence = new StubPersistence();
        const scheduler = createDoubleFireScheduler();
        const registry = createNamespaceRegistryForTesting(persistence, {
          clock: manualClock(),
          scheduler,
          randomBytes: TEST_RANDOM_BYTES,
          idleTimeoutMs: 0,
          runtimeFactory: () => runtime,
        });
        const lease = okLease(await registry.open({ userId: 'u-hostile' }, 'ns-h2b'));
        await lease.release();
        scheduler.fire(0); // 建立 closing（close 已发起、微任务内 settle）
        scheduler.fire(0); // settle 前重复 fire：no-op
        await flushMicrotasks();
        scheduler.fire(0); // settle 后重复 fire（entry 已移除）：no-op
        expect(runtime.closeCalls).toBe(1);
        const lease2 = okLease(await registry.open({ userId: 'u-hostile' }, 'ns-h2b'));
        expect(persistence.loadCalls.length).toBe(2);
        await lease2.release();
      }
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('SA7-H3 observer 每事件 throw：公开结果不变（open/复用/close/再 open 全链）、零 unhandled rejection', async () => {
    const probe = collectUnhandledRejections();
    try {
      const persistence = new StubPersistence();
      const scheduler = createRegistryTestScheduler();
      const hostileCause = new Error('SA7-H3: hostile observer throws on every event');
      const observer = {
        sink: (): void => {
          throw hostileCause;
        },
      };
      const runtime = new ObservableRuntime('R-H3', 'ns-h3');
      const registry = createNamespaceRegistryForTesting(persistence, {
        clock: manualClock(),
        scheduler,
        randomBytes: TEST_RANDOM_BYTES,
        idleTimeoutMs: 300_000,
        runtimeFactory: () => runtime,
        observer: observer.sink,
      });

      // 全链驱动：open（carrier 事件 throw）→ release（lease-released/entry-idle throw）→
      // advance（close）→ 再 open（全新 generation）。
      const lease1 = okLease(await registry.open({ userId: 'u-hostile' }, 'ns-h3'));
      expect(lease1.readData(['n'])).toEqual({ ok: true, value: 'R-H3' });
      await lease1.release();
      expect(scheduler.pending()).toBe(1);
      await scheduler.advanceBy(300_000);
      await flushMicrotasks();
      expect(runtime.closeCalls).toBe(1);
      const lease2 = okLease(await registry.open({ userId: 'u-hostile' }, 'ns-h3'));
      expect(persistence.loadCalls.length).toBe(2);
      await lease2.release();
      await scheduler.advanceBy(300_000);
      await flushMicrotasks();
      expect(runtime.closeCalls).toBe(2);
      // shutdown 亦不受 hostile observer 影响。
      await registry.shutdown();
      expect(registry.getStatus()).toEqual({ state: 'stopped' });
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]); // observer throw 被隔离：零 unhandled
    } finally {
      probe.dispose();
    }
  });

  it('SA7-H4 close 永不 settle：withTimeout 探针证明 shutdown 与后续 open 均为等待而非崩溃（R3 契约）', async () => {
    const probe = collectUnhandledRejections();
    try {
      const persistence = new StubPersistence();
      const scheduler = createRegistryTestScheduler();
      const runtime = new ObservableRuntime('R-H4', 'ns-h4', { neverSettle: true });
      const registry = createNamespaceRegistryForTesting(persistence, {
        clock: manualClock(),
        scheduler,
        randomBytes: TEST_RANDOM_BYTES,
        idleTimeoutMs: 300_000,
        runtimeFactory: () => runtime,
      });

      const lease = okLease(await registry.open({ userId: 'u-hostile' }, 'ns-h4'));
      await lease.release();
      await scheduler.advanceBy(300_000);
      await flushMicrotasks();
      expect(runtime.closeCalls).toBe(1); // close 已发起、永不 settle → entry 停留 closing

      // ① 后续 open 同 key（registry 仍 running）：closing-wait 挂起 = 等待而非崩溃。
      const openPromise = registry.open({ userId: 'u-hostile' }, 'ns-h4');
      const probeOpen = raceWithSchedulerTimeout(scheduler, openPromise, 1_000);
      await scheduler.advanceBy(1_000);
      expect(await probeOpen).toBe('timeout');
      expect(persistence.loadCalls.length).toBe(1); // 未发起第二次 loadDoc（等待 closePromise）

      // ② withTimeout 探针（经注入 scheduler 实现，零 real timer）：shutdown 挂起 = 等待
      //    （在途 closing-wait 槽与 never-settle close 均传导——R3 契约）。
      const shutdownPromise = registry.shutdown();
      const probeShutdown = raceWithSchedulerTimeout(scheduler, shutdownPromise, 1_000);
      await scheduler.advanceBy(1_000);
      expect(await probeShutdown).toBe('timeout'); // 未崩溃、未错误 settle——纯等待
      expect(registry.getStatus()).toEqual({ state: 'shutting-down' });

      // 幂等：重复 shutdown 同一 Promise 实例（仍挂起）。
      expect(registry.shutdown()).toBe(shutdownPromise);
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]); // 零 unhandled rejection
    } finally {
      probe.dispose();
    }
  });

  it('SA7-H5 Clock.now 回跳：idle 窗口纯由 scheduler 计时（回跳不提前/推迟 close）；create 在回跳时钟下照常', async () => {
    const probe = collectUnhandledRejections();
    try {
      const persistence = new StubPersistence();
      const scheduler = createRegistryTestScheduler();
      let clockValue = 1_700_000_000_000;
      const rollbackClock = {
        now: (): number => {
          clockValue -= 60_000; // 每次读数回跳一分钟（wall-clock 不承诺单调）
          return clockValue;
        },
      };
      const runtime = new ObservableRuntime('R-H5', 'ns-h5');
      const registry = createNamespaceRegistryForTesting(persistence, {
        clock: rollbackClock,
        scheduler,
        randomBytes: TEST_RANDOM_BYTES,
        idleTimeoutMs: 300_000,
        runtimeFactory: () => runtime,
      });

      const lease = okLease(await registry.open({ userId: 'u-hostile' }, 'ns-h5'));
      await lease.release();
      expect(scheduler.pending()).toBe(1);
      await scheduler.advanceBy(299_999); // 差 1ms：回跳的 clock 不影响窗口
      await flushMicrotasks();
      expect(runtime.closeCalls).toBe(0);
      await scheduler.advanceBy(1);
      await flushMicrotasks();
      expect(runtime.closeCalls).toBe(1); // 恰在 scheduler 边界关闭

      // create 在回跳时钟下照常（单次读数、无单调性校验）。
      // phase-5 切片 1（ADR 0010）：create 恒三键（namespaceId 由注入随机源生成）；
      // 回跳时钟下单次读数、无单调性校验的断言面保持。
      const created = await registry.create({
        owner: { userId: 'u-hostile' },
        schema: { lang: 'vfsl', version: 1, id: 'ns-h5-create', text: 'type ROOT = { n: number; };\n' },
        root: { n: 7 },
      });
      expect(created).toMatchObject({ ok: true });
      expect(persistence.createCalls.length).toBe(1);
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('SA7-H6 getStatus 冻结常量身份锚（mutation h 杀伤锚）：跨调用/跨相位/跨实例 same identity + Object.isFrozen', async () => {
    const persistence = new StubPersistence();
    const scheduler = createRegistryTestScheduler();
    const persistence2 = new StubPersistence();
    const make = (): ReturnType<typeof createNamespaceRegistryForTesting> =>
      createNamespaceRegistryForTesting(persistence2, {
        clock: manualClock(),
        scheduler: createRegistryTestScheduler(),
        randomBytes: TEST_RANDOM_BYTES,
        runtimeFactory: () => new ObservableRuntime('R-H6', 'ns-h6'),
      });
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
      runtimeFactory: () => new ObservableRuntime('R-H6', 'ns-h6'),
    });
    const other = make();

    // running 相位：跨调用 same identity（冻结常量，非每次新建）。
    const running1 = registry.getStatus();
    expect(registry.getStatus()).toBe(running1);
    expect(running1).toEqual({ state: 'running' });
    expect(Object.isFrozen(running1)).toBe(true);
    // 跨实例共享同一模块级冻结常量（设计 §2.E 模块级常量投影）。
    expect(other.getStatus()).toBe(running1);

    const shutdownPromise = registry.shutdown();
    const shuttingDown1 = registry.getStatus();
    expect(shuttingDown1).toBe(registry.getStatus());
    expect(shuttingDown1).toEqual({ state: 'shutting-down' });
    expect(Object.isFrozen(shuttingDown1)).toBe(true);
    expect(shuttingDown1).not.toBe(running1); // 相位间不同常量

    await shutdownPromise;
    const stopped1 = registry.getStatus();
    expect(registry.getStatus()).toBe(stopped1);
    expect(stopped1).toEqual({ state: 'stopped' });
    expect(Object.isFrozen(stopped1)).toBe(true);
    // 终态投影恒定：重复调用不再变化。
    expect(registry.getStatus()).toBe(stopped1);
  });
});

/** withTimeout 探针：以注入 scheduler 武装超时（零 real timer），与目标 Promise 竞速。
 * 目标 settle → 'settled'（附结果形态）；超时先到 → 'timeout'（目标仍挂起——等待而非崩溃）。 */
function raceWithSchedulerTimeout(
  scheduler: RegistryTimeoutScheduler,
  target: Promise<unknown>,
  timeoutMs: number,
): Promise<'timeout' | 'settled'> {
  return Promise.race([
    target.then(
      () => 'settled' as const,
      () => 'settled' as const, // reject 也算 settle（探针只区分等待/崩溃外终结）
    ),
    new Promise<'timeout'>((resolve) => {
      scheduler.setTimeout(() => resolve('timeout'), timeoutMs);
    }),
  ]);
}

/**
 * SA6 红灯锚定 — issue #112：namespace-registry Host shutdown 状态机
 * （AC8/9/10/12；冻结设计 §7 测试 13-21 + R1/M5 测试 15a）。
 *
 * 契约来源：wiki/raw/task_registry-idle-plugin-shutdown.md（冻结设计，R1 修订）：
 * - §2.D shutdown 状态机（acceptance 三相、接纳门迁移至公共入口同步段、
 *   首次 shutdown 同步段原子序：翻相→取消 idle timer→缓存 promise；
 *   runShutdown 冻结次序：carrier 快照等待 → 全量发起 close（复用
 *   closePromise）→ 全量尝试聚合 → 终态 stopped + NamespaceRegistryShutdownError）；
 * - §2.E getStatus 三相投影（running/shutting-down/stopped 恒冻结常量）；
 * - §2.H NamespaceRegistryShutdownError（code/name/恒定 message/failures 冻结与顺序）；
 * - §2.I shutdown 不加 observer 事件（聚合错误交付）；
 * - §2.K AC12 幂等 same-Promise（含 reject 实例）。
 *
 * 红灯纪律：全部并发用 deferred gate + 显式微任务排空；时间全经
 * createRegistryTestScheduler().advanceBy；零 real sleep；clock 固定 manual；
 * 公开文本零回显负锁（message 级；failures 结构化字段与 cause 为纪律显式边界，
 * 不进 sentinel 负锁循环——见设计 M4 注记）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import type { NamespaceRuntime, NamespaceRuntimeStatus } from '@nomicore/namespace-runtime';
import { NamespaceRegistryShutdownError } from '@nomicore/namespace-registry';
import type { NamespaceLease, NamespaceOwner } from '@nomicore/namespace-registry';
import type { RegistryTimeoutScheduler } from '@nomicore/namespace-registry';
import { createNamespaceRegistryForTesting, createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import type { RegistryObserverEvent } from '../src/observer.js';

// ── 确定性并发原语（禁 real sleep；沿用 registry-open.test.ts 既有原语）────────────

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

/** 显式微任务展开（禁 real sleep）；默认 20 层覆盖 shutdown 链（carrier 快照等待 →
 * close 发起 → 聚合 catch → 终态翻转 → 结果交付）。 */
async function flushMicrotasks(times = 20): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

/** manual Clock 固定值（shutdown 路径不消费 Clock 值）。 */
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

// ── 可控 Persistence stub ──────────────────────────────────────────────────────

interface LoadPlan {
  gate?: Deferred;
  result?: DocHandle | null;
  error?: unknown;
}

class StubHandle implements DocHandle {
  releaseCalls = 0;
  readonly doc: Y.Doc;

  constructor(
    readonly owner: User,
    readonly docId: string,
    private readonly rejectReleaseWith: unknown = undefined,
  ) {
    this.doc = new Y.Doc();
  }

  getStatus(): 'ready' {
    return 'ready';
  }

  release(): Promise<void> {
    this.releaseCalls += 1;
    if (this.rejectReleaseWith !== undefined) {
      return Promise.reject(this.rejectReleaseWith);
    }
    return Promise.resolve();
  }
}

class StubPersistence implements DocPersistence {
  readonly loadCalls: Array<{ owner: User; docId: string }> = [];
  readonly createCalls: Array<{ owner: User; docId: string }> = [];
  saveCalls = 0;
  private readonly queue: LoadPlan[] = [];

  queueLoad(plan: LoadPlan): void {
    this.queue.push(plan);
  }

  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    this.loadCalls.push({ owner, docId });
    const plan = this.queue.shift() ?? {};
    if (plan.gate !== undefined) {
      await plan.gate.promise;
    }
    if (plan.error !== undefined) {
      throw plan.error;
    }
    return plan.result ?? null;
  }

  async saveDoc(): Promise<void> {
    this.saveCalls += 1;
  }

  async createDoc(owner: User, docId: string, _doc: Y.Doc): Promise<DocHandle> {
    this.createCalls.push({ owner, docId });
    return new StubHandle(owner, docId);
  }
}

// ── 可控 Observable Runtime（close 计数 / gate / reject / marker）───────────────

interface RuntimeClosePlan {
  gate?: Deferred;
  rejectWith?: unknown;
  /** rev1 问题 1/2：close() 同步 throw（与 rejectWith 同为失败通道，触发面不同）。 */
  syncThrowWith?: unknown;
}

class ObservableRuntime implements NamespaceRuntime {
  closeCalls = 0;
  readonly owner = Object.freeze({ userId: 'u-shutdown' });

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
    return {
      lifecycle: 'ready',
      read: { enabled: true },
      rootWrite: { enabled: true },
      schemaWrite: { enabled: true },
      schema: { state: 'ready' },
      fatal: null,
      close: null,
      replication: { state: 'disabled' },
    };
  }

  mutateRoot(): Promise<{ ok: true }> {
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
    if (this.closePlan.syncThrowWith !== undefined) {
      throw this.closePlan.syncThrowWith; // 同步抛错路径（rev1 问题 1 收编目标）
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
  expect(r.ok, `open 应成功，实际：${JSON.stringify(result)}`).toBe(true);
  if (!r.ok || r.lease === undefined) throw new Error('unreachable');
  return r.lease;
}

interface ObservedEvent {
  readonly type: string;
  readonly identity?: { readonly owner: { readonly userId: string }; readonly namespaceId: string; readonly key: string };
  readonly generation?: bigint;
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

// ── 违约 adversarial scheduler（与 registry-idle.test.ts 3a 共用注入面）──────────
// 只暴露自身 timer 队列；clearTimeout 为 no-op——「取消后回调仍可被手动触发」。

interface ArmedTimer {
  readonly token: unknown;
  readonly callback: () => void;
}

interface AdversarialScheduler extends RegistryTimeoutScheduler {
  readonly armed: ArmedTimer[];
  fire(index: number): void;
}

function createLooseClearScheduler(): AdversarialScheduler {
  const armed: ArmedTimer[] = [];
  let next = 0;
  return {
    armed,
    setTimeout(callback) {
      const token = { adversarialArmToken: next };
      next += 1;
      armed.push({ token, callback });
      return token;
    },
    clearTimeout() {
      // 违约 no-op：取消无效——已武装回调仍可被手动触发
    },
    fire(index) {
      const [timer] = armed.splice(index, 1);
      if (timer === undefined) throw new Error(`adversarial scheduler 无第 ${index} 个武装回调`);
      timer.callback();
    },
  };
}

// ── AC8（§7 测试 13）：getStatus 三相投影 ───────────────────────────────────────

describe('AC8（§7.13）：getStatus 三相投影（running → shutting-down → stopped）', () => {
  it('13. 构造 running；shutdown 同步段后 shutting-down（promise 未 settle 前可观测）；settle 后 stopped', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-shutdown' }, 'k') });
    const scheduler = createRegistryTestScheduler();
    const closeGate = deferred();
    const runtime = new ObservableRuntime('R1', 'k', { gate: closeGate });
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
      runtimeFactory: () => runtime,
    });
    expect(registry.getStatus()).toEqual({ state: 'running' });

    const lease = okLease(await registry.open({ userId: 'u-shutdown' }, 'k'));
    const p = registry.shutdown();
    // 首次 shutdown 同步段：acceptance 已在返回前翻相（run-to-completion 内立即可观测）
    expect(registry.getStatus()).toEqual({ state: 'shutting-down' });
    let settled: 'pending' | 'resolved' | 'rejected' = 'pending';
    void p.then(
      () => {
        settled = 'resolved';
      },
      () => {
        settled = 'rejected';
      },
    );
    await flushMicrotasks();
    expect(settled).toBe('pending'); // close gate 未放行：shutting-down 停留
    expect(registry.getStatus()).toEqual({ state: 'shutting-down' });
    closeGate.resolve();
    await p;
    expect(registry.getStatus()).toEqual({ state: 'stopped' }); // 终态不再迁移
    await lease.release().catch(() => {});
  });
});

// ── AC9（§7 测试 14-16）：同步停接纳 / 零输入访问 / 等待已接纳结算 ────────────────

describe('AC9（§7.14-16）：同步停接纳、零输入访问、等待已接纳槽完整结算', () => {
  it('14. shutdown 后 open(Proxy owner)/create(Proxy input)：REGISTRY_NOT_ACCEPTING 且 trap 零执行、零 Persistence/Runtime', async () => {
    const persistence = new StubPersistence();
    const scheduler = createRegistryTestScheduler();
    let factoryCalls = 0;
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
      runtimeFactory: () => {
        factoryCalls += 1;
        return new ObservableRuntime('R1', 'never');
      },
    });
    const p = registry.shutdown();

    let ownerTraps = 0;
    const hostileOwner = new Proxy(
      { userId: 'u' },
      {
        getPrototypeOf() {
          ownerTraps += 1;
          throw new Error('trap');
        },
      },
    );
    const openResult = await registry.open(hostileOwner as unknown as NamespaceOwner, 'ns');
    expect(openResult).toMatchObject({ ok: false, code: 'REGISTRY_NOT_ACCEPTING' });
    expect(ownerTraps).toBe(0); // 停接纳先于一切输入访问（AC9）

    let inputTraps = 0;
    const hostileInput = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          inputTraps += 1;
          throw new Error('trap');
        },
      },
    );
    const createResult = await registry.create(hostileInput as never);
    expect(createResult).toMatchObject({ ok: false, code: 'REGISTRY_NOT_ACCEPTING' });
    expect(inputTraps).toBe(0); // 零 descriptor/Proxy trap 执行

    expect(persistence.loadCalls.length).toBe(0);
    expect(persistence.createCalls.length).toBe(0);
    expect(persistence.saveCalls).toBe(0);
    expect(factoryCalls).toBe(0);
    await p;
    expect(registry.getStatus()).toEqual({ state: 'stopped' });
    // stopped 终态同样停接纳（不再开）
    const after = await registry.open({ userId: 'u' }, 'ns');
    expect(after).toMatchObject({ ok: false, code: 'REGISTRY_NOT_ACCEPTING' });
    expect(persistence.loadCalls.length).toBe(0);
  });

  it('15. 取消全部 idle timer：两 key 各武装 → shutdown → pending()===0 且无自发 close', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-shutdown' }, 'k1') });
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-shutdown' }, 'k2') });
    const scheduler = createRegistryTestScheduler();
    const observer = collectObserver();
    const runtimes = new Map<string, ObservableRuntime>();
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
      runtimeFactory: (handle) => {
        const r = new ObservableRuntime(`R-${handle.docId}`, handle.docId);
        runtimes.set(handle.docId, r);
        return r;
      },
      observer: observer.sink,
    });
    const l1 = okLease(await registry.open({ userId: 'u-shutdown' }, 'k1'));
    const l2 = okLease(await registry.open({ userId: 'u-shutdown' }, 'k2'));
    await l1.release();
    await l2.release();
    expect(scheduler.pending()).toBe(2); // 两 key 各自 idle 武装
    expect(observer.events.filter((e) => e.type === 'entry-idle').length).toBe(2);

    const p = registry.shutdown();
    expect(scheduler.pending()).toBe(0); // 同步段取消全部 idle timer（无自发 close 的入口）
    expect(runtimes.get('k1')?.closeCalls).toBe(0); // 同步段零 close 发起（取消先于关闭发起）
    expect(runtimes.get('k2')?.closeCalls).toBe(0);
    await p; // shutdown 自身关闭全集（含 idle 取消后的 entry）
    expect(runtimes.get('k1')?.closeCalls).toBe(1);
    expect(runtimes.get('k2')?.closeCalls).toBe(1);
    // timer 已真取消：推进完整窗口不追加任何额外 close
    await scheduler.advanceBy(300_000);
    expect(scheduler.pending()).toBe(0);
    expect(runtimes.get('k1')?.closeCalls).toBe(1);
    expect(runtimes.get('k2')?.closeCalls).toBe(1);
  });

  it('15a. adversarial（R1/M5）：取消后手动触发旧回调 → 恰单次 close、聚合恰一次、终态 stopped', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-shutdown' }, 'k') });
    const adversarial = createLooseClearScheduler(); // clearTimeout no-op
    const observer = collectObserver();
    const closeCause = new Error('shutdown-close-reject-15a');
    const runtime = new ObservableRuntime('R1', 'k', { rejectWith: closeCause });
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler: adversarial,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
      runtimeFactory: () => runtime,
      observer: observer.sink,
    });
    const lease = okLease(await registry.open({ userId: 'u-shutdown' }, 'k'));
    await lease.release();
    expect(adversarial.armed.length).toBe(1); // 武装 T1（取出但未执行）

    const p = registry.shutdown();
    expect(runtime.closeCalls).toBe(0); // shutdown 同步段不发起 close
    adversarial.fire(0); // 取消后手动触发【旧】回调：I4 arm-token 失配 → no-op
    expect(runtime.closeCalls).toBe(0); // ★ 判别核心：旧回调不得发起 close（无 I4 则红）

    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NamespaceRegistryShutdownError);
    expect(runtime.closeCalls).toBe(1); // 恰单次 close：仅来自 shutdown 步骤 2 的发起
    if (err instanceof NamespaceRegistryShutdownError) {
      expect(err.failures.length).toBe(1); // 聚合恰收录该 close 失败一次（不重复收录）
      expect(err.failures[0]?.cause).toBe(closeCause); // exact cause
      expect(err.failures[0]?.namespaceId).toBe('k');
    }
    // shutdown 发起的 close 失败经聚合交付：零 observer idle-close-failed 事件（§2.I）
    expect(observer.events.filter((e) => e.type === 'idle-close-failed').length).toBe(0);
    expect(registry.getStatus()).toEqual({ state: 'stopped' }); // 失败不回滚终态
  });

  it('16. 等待已接纳结算：open 的 loadDoc 挂于 gate 时 shutdown 未 settle；放行后 open 完整成功（非 NOT_ACCEPTING）→ 全部 close → resolve', async () => {
    const persistence = new StubPersistence();
    const loadGate = deferred();
    persistence.queueLoad({ gate: loadGate, result: new StubHandle({ userId: 'u-shutdown' }, 'k') });
    const scheduler = createRegistryTestScheduler();
    const runtime = new ObservableRuntime('R1', 'k');
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
      runtimeFactory: () => runtime,
    });
    const pOpen = registry.open({ userId: 'u-shutdown' }, 'k'); // 已接纳（shutdown 前）
    await flushMicrotasks();
    expect(persistence.loadCalls.length).toBe(1); // 槽已开始（loadDoc 挂于 gate）

    const p = registry.shutdown();
    let shutdownSettled = false;
    void p.then(
      () => {
        shutdownSettled = true;
      },
      () => {
        shutdownSettled = true;
      },
    );
    await flushMicrotasks();
    expect(shutdownSettled).toBe(false); // 等待已接纳槽结算（AC9）

    loadGate.resolve(); // 放行：已接纳 open 按自身事实完整结算
    const openResult = await pOpen;
    expect(openResult.ok).toBe(true); // 绝非 NOT_ACCEPTING（ADR-0009:99）
    const lease = okLease(openResult);
    expect(lease.getStatus()).toMatchObject({ lease: 'active' });
    await p; // 槽结算后：关闭在途槽新建的 entry → resolve undefined
    expect(runtime.closeCalls).toBe(1); // 闭环完整：在途槽新建 entry 被 shutdown 关闭
    await lease.release().catch(() => {});
  });
});

// ── AC10（§7 测试 17-19）：不等外部 release / 复用在途 close / 聚合错误形状 ──────

describe('AC10（§7.17-19）：不等外部 release、复用在途 close Promise、稳定聚合错误', () => {
  it('17. 不等外部 release：entry 持未释放 lease 时 shutdown 照常关闭并 resolve（聚合空）；release 之后仍幂等', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-shutdown' }, 'k') });
    const scheduler = createRegistryTestScheduler();
    const runtime = new ObservableRuntime('R1', 'k');
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
      runtimeFactory: () => runtime,
    });
    const lease = okLease(await registry.open({ userId: 'u-shutdown' }, 'k')); // lease 未释放
    const p = registry.shutdown();
    await expect(p).resolves.toBeUndefined(); // 聚合空 → resolve undefined
    expect(runtime.closeCalls).toBe(1); // close 照常发起（不等外部 release）
    expect(registry.getStatus()).toEqual({ state: 'stopped' });
    // shutdown 后的 release 仍幂等 same-Promise（lease 契约回归锚）
    const r1 = lease.release();
    const r2 = lease.release();
    expect(r2).toBe(r1);
    await r1;
    expect(lease.getStatus()).toEqual({ lease: 'released', runtime: null });
  });

  it('18. 复用在途 close：idle close 挂于 gate 时 shutdown → 放行 → 同一 close Promise 结算一次、聚合收录其失败恰一次', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-shutdown' }, 'k') });
    const scheduler = createRegistryTestScheduler();
    const closeGate = deferred();
    const closeCause = new Error('idle-close-inflight-18');
    const observer = collectObserver();
    const runtime = new ObservableRuntime('R1', 'k', { gate: closeGate });
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
      runtimeFactory: () => runtime,
      observer: observer.sink,
    });
    const lease = okLease(await registry.open({ userId: 'u-shutdown' }, 'k'));
    await lease.release();
    await scheduler.advanceBy(300_000); // idle timer 到期：beginIdleClose → close 挂起
    expect(runtime.closeCalls).toBe(1);

    const p = registry.shutdown(); // 复用在途 close Promise（步 2：closePromise !== undefined）
    await flushMicrotasks();
    expect(runtime.closeCalls).toBe(1); // 未发起第二次 close（同一 Promise 结算一次）
    closeGate.reject(closeCause); // 放行且失败

    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NamespaceRegistryShutdownError);
    if (err instanceof NamespaceRegistryShutdownError) {
      expect(err.failures.length).toBe(1);
      expect(err.failures[0]?.cause).toBe(closeCause); // exact cause 入聚合
      expect(err.failures[0]?.namespaceId).toBe('k');
    }
    expect(runtime.closeCalls).toBe(1); // 恰一次（AC10 复用同一实例）
    // 双通道各恰一次：发起侧 observer idle-close-failed（§2.C）+ shutdown 聚合（不同受众）
    expect(observer.events.filter((e) => e.type === 'idle-close-failed').length).toBe(1);
    expect(registry.getStatus()).toEqual({ state: 'stopped' });
  });

  it('19. 聚合错误形状：三 key、两个不同 cause 的 close reject → ShutdownError（code/name/恒定 message/failures 冻结+顺序）、第三 key 仍被尝试、status stopped', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-shutdown' }, 'k1') });
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-shutdown' }, 'k2') });
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-shutdown' }, 'k3') });
    const scheduler = createRegistryTestScheduler();
    const causeA = new Error('shutdown-close-fail-A-9f3a');
    const causeB = new Error('shutdown-close-fail-B-9f3a');
    const runtimes = new Map<string, ObservableRuntime>();
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
      runtimeFactory: (handle) => {
        const closePlan: RuntimeClosePlan =
          handle.docId === 'k1'
            ? { rejectWith: causeA }
            : handle.docId === 'k2'
              ? { rejectWith: causeB }
              : {};
        const r = new ObservableRuntime(`R-${handle.docId}`, handle.docId, closePlan);
        runtimes.set(handle.docId, r);
        return r;
      },
    });
    // 逐 key 打开（await 串行 → Map 插入序 k1/k2/k3 确定，聚合顺序 = 插入序）
    const l1 = okLease(await registry.open({ userId: 'u-shutdown' }, 'k1'));
    const l2 = okLease(await registry.open({ userId: 'u-shutdown' }, 'k2'));
    const l3 = okLease(await registry.open({ userId: 'u-shutdown' }, 'k3'));

    const p = registry.shutdown();
    await expect(p).rejects.toBeInstanceOf(NamespaceRegistryShutdownError);
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NamespaceRegistryShutdownError);
    if (err instanceof NamespaceRegistryShutdownError) {
      expect(err.name).toBe('NamespaceRegistryShutdownError');
      expect(err.code).toBe('NAMESPACE_REGISTRY_SHUTDOWN_FAILED');
      // R1/M4：shutdown 零回显负锁专测——message 恒定常量、零插值、零 cause 文本回显
      expect(err.message).toBe(
        'NAMESPACE_REGISTRY_SHUTDOWN_FAILED: Registry shutdown 期间部分 Runtime 关闭失败',
      );
      expect(err.message).not.toContain('shutdown-close-fail-A-9f3a');
      expect(err.message).not.toContain('shutdown-close-fail-B-9f3a');
      expect(err.message).not.toContain('k1');
      expect(err.message).not.toContain('u-shutdown');
      // failures 冻结、顺序 = 插入序（k1 先于 k2）、逐项 exact cause/受控 identity
      // （结构化字段与 cause 为 message 级纪律的显式边界，不进 sentinel 负锁循环——
      //   本测试只对 err.message 做负锁）
      expect(Object.isFrozen(err.failures)).toBe(true);
      expect(err.failures.length).toBe(2);
      expect(Object.isFrozen(err.failures[0])).toBe(true);
      expect(Object.isFrozen(err.failures[1])).toBe(true);
      expect(err.failures[0]?.owner).toEqual({ userId: 'u-shutdown' });
      expect(err.failures[0]?.namespaceId).toBe('k1');
      expect(err.failures[0]?.cause).toBe(causeA); // exact cause（instance 级）
      expect(err.failures[1]?.owner).toEqual({ userId: 'u-shutdown' });
      expect(err.failures[1]?.namespaceId).toBe('k2');
      expect(err.failures[1]?.cause).toBe(causeB);
    }
    // 全部尝试：首败不跳过其余（AC10）——k3 也被关闭
    expect(runtimes.get('k1')?.closeCalls).toBe(1);
    expect(runtimes.get('k2')?.closeCalls).toBe(1);
    expect(runtimes.get('k3')?.closeCalls).toBe(1);
    // 失败不回滚终态：status 仍 stopped
    expect(registry.getStatus()).toEqual({ state: 'stopped' });
    expect(persistence.loadCalls.length).toBe(3);
    await Promise.all([
      l1.release().catch(() => {}),
      l2.release().catch(() => {}),
      l3.release().catch(() => {}),
    ]);
  });

  it('19b. rev1 问题 1：首个 close 同步 throw 被收编——后续 Runtime 仍全部尝试关闭、entries 清空且 getStatus 推进 stopped、错误聚合为 NamespaceRegistryShutdownError 且 failures 收录该同步 cause（与 rejection 同构）', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-shutdown' }, 'k1') });
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-shutdown' }, 'k2') });
    const scheduler = createRegistryTestScheduler();
    const syncCause = new Error('shutdown-close-sync-throw-19b');
    const runtimes = new Map<string, ObservableRuntime>();
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
      runtimeFactory: (handle) => {
        // 首个 Runtime（k1，Map 插入序第一）close 同步 throw；k2 正常 close。
        const closePlan: RuntimeClosePlan =
          handle.docId === 'k1' ? { syncThrowWith: syncCause } : {};
        const r = new ObservableRuntime(`R-${handle.docId}`, handle.docId, closePlan);
        runtimes.set(handle.docId, r);
        return r;
      },
    });
    // 逐 key 打开（await 串行 → 插入序 k1/k2 确定；shutdown 关闭发起序 = 插入序）
    const l1 = okLease(await registry.open({ userId: 'u-shutdown' }, 'k1'));
    const l2 = okLease(await registry.open({ userId: 'u-shutdown' }, 'k2'));

    const p = registry.shutdown();
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    // ★ 判别核心 1：同步 throw 与 rejection 同构进入聚合——err 必须是聚合错误
    //   （当前实现：runShutdown 在 close() 同步 throw 处逃逸，抛的是裸原因 → 红）。
    expect(err).toBeInstanceOf(NamespaceRegistryShutdownError);
    if (err instanceof NamespaceRegistryShutdownError) {
      expect(err.failures.length).toBe(1); // 恰收录一次（不重复）
      expect(err.failures[0]?.namespaceId).toBe('k1');
      expect(err.failures[0]?.cause).toBe(syncCause); // exact 同步 cause
    }
    // ★ 判别核心 2：全部 Runtime 仍被尝试关闭（当前实现：首抛中断关闭枚举 → k2 红）。
    expect(runtimes.get('k1')?.closeCalls).toBe(1);
    expect(runtimes.get('k2')?.closeCalls).toBe(1);
    // ★ 判别核心 3：entries.clear + acceptance='stopped' 恒执行（当前实现：停在 shutting-down → 红）。
    expect(registry.getStatus()).toEqual({ state: 'stopped' });
    await Promise.all([
      l1.release().catch(() => {}),
      l2.release().catch(() => {}),
    ]);
  });

  it('19c. rev1 问题 1（R2 增补，SA2 攻击点 #4①）：多 entry 全同步 throw——failures 按 Map 插入序收录、每 cause 恰一次、全部 Runtime 均被尝试、终态 stopped、零 unhandled rejection', async () => {
    const probe = collectUnhandledRejections();
    try {
      const persistence = new StubPersistence();
      persistence.queueLoad({ result: new StubHandle({ userId: 'u-shutdown' }, 'k1') });
      persistence.queueLoad({ result: new StubHandle({ userId: 'u-shutdown' }, 'k2') });
      const scheduler = createRegistryTestScheduler();
      const cause1 = new Error('shutdown-close-sync-throw-19c-k1');
      const cause2 = new Error('shutdown-close-sync-throw-19c-k2');
      const runtimes = new Map<string, ObservableRuntime>();
      const registry = createNamespaceRegistryForTesting(persistence, {
        clock: manualClock(),
        scheduler,
        randomBytes: TEST_RANDOM_BYTES,
        idleTimeoutMs: 300_000,
        runtimeFactory: (handle) => {
          // k1/k2 均同步 throw（不同 cause 实例）：同构聚合 + 插入序 + 恰一次的多元锚
          // （19b 只锚单 entry；合成 rejected Promise 出生即 handled 的「零 floating
          // window」防御在任意 entries 次序下均为正确性要件——本节为多 throw 的直接观测）。
          const closePlan: RuntimeClosePlan =
            handle.docId === 'k1' ? { syncThrowWith: cause1 } : { syncThrowWith: cause2 };
          const r = new ObservableRuntime(`R-${handle.docId}`, handle.docId, closePlan);
          runtimes.set(handle.docId, r);
          return r;
        },
      });
      // 逐 key 打开（await 串行 → 插入序 k1/k2 确定；shutdown 关闭发起序 = 插入序）
      const l1 = okLease(await registry.open({ userId: 'u-shutdown' }, 'k1'));
      const l2 = okLease(await registry.open({ userId: 'u-shutdown' }, 'k2'));

      const err = await registry.shutdown().then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(NamespaceRegistryShutdownError);
      if (err instanceof NamespaceRegistryShutdownError) {
        // 每 cause 恰一次、次序 = Map 插入序（k1 先于 k2）、failures 冻结（与 19 同款）
        expect(err.failures.length).toBe(2);
        expect(Object.isFrozen(err.failures)).toBe(true);
        expect(Object.isFrozen(err.failures[0])).toBe(true);
        expect(Object.isFrozen(err.failures[1])).toBe(true);
        expect(err.failures[0]?.namespaceId).toBe('k1');
        expect(err.failures[0]?.cause).toBe(cause1); // exact cause（instance 级 恒等）
        expect(err.failures[1]?.namespaceId).toBe('k2');
        expect(err.failures[1]?.cause).toBe(cause2);
      }
      // 多同步 throw 下全部 Runtime 仍被尝试；失败不回滚终态
      expect(runtimes.get('k1')?.closeCalls).toBe(1);
      expect(runtimes.get('k2')?.closeCalls).toBe(1);
      expect(registry.getStatus()).toEqual({ state: 'stopped' });
      await Promise.all([
        l1.release().catch(() => {}),
        l2.release().catch(() => {}),
      ]);
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]); // 零 unhandled rejection（所有合成 rejected Promise 出生即 handled）
    } finally {
      probe.dispose();
    }
  });
});

// ── AC12（§7 测试 20）与 shutdown 后拒绝面（§7 测试 21）──────────────────────────

describe('AC12（§7.20-21）：幂等 same-Promise（含 reject 实例）、shutdown 后 open/create 恒 NOT_ACCEPTING', () => {
  it('20. 幂等 same-Promise：并发双调用与结算后重调用返回同一实例（resolve 与 reject 两相）', async () => {
    // 相 1：空 registry → resolve undefined；并发 + 结算后重调用
    const persistence = new StubPersistence();
    const scheduler = createRegistryTestScheduler();
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
    });
    const p1 = registry.shutdown();
    const p2 = registry.shutdown();
    expect(p2).toBe(p1); // 并发双调用 exact same Promise
    await expect(p1).resolves.toBeUndefined();
    const p3 = registry.shutdown();
    expect(p3).toBe(p1); // 结算后重调用复用同一实例

    // 相 2：close reject → rejected same-Promise 亦复用（含已 reject 实例）
    const persistence2 = new StubPersistence();
    persistence2.queueLoad({ result: new StubHandle({ userId: 'u-shutdown' }, 'k') });
    const scheduler2 = createRegistryTestScheduler();
    const closeCause = new Error('shutdown-reject-20');
    const runtime2 = new ObservableRuntime('R1', 'k', { rejectWith: closeCause });
    const registry2 = createNamespaceRegistryForTesting(persistence2, {
      clock: manualClock(),
      scheduler: scheduler2,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
      runtimeFactory: () => runtime2,
    });
    const lease = okLease(await registry2.open({ userId: 'u-shutdown' }, 'k'));
    const rp1 = registry2.shutdown();
    const rp2 = registry2.shutdown();
    expect(rp2).toBe(rp1);
    const err = await rp1.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NamespaceRegistryShutdownError);
    const rp3 = registry2.shutdown();
    expect(rp3).toBe(rp1); // 已 reject 实例同样复用（AC12）
    expect(registry2.getStatus()).toEqual({ state: 'stopped' });
    await lease.release().catch(() => {});
  });

  it('21. shutdown 后 create/open 有效输入 → REGISTRY_NOT_ACCEPTING（零 Persistence、零 Runtime）；getStatus 恒可用', async () => {
    const persistence = new StubPersistence();
    const scheduler = createRegistryTestScheduler();
    let factoryCalls = 0;
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
      runtimeFactory: () => {
        factoryCalls += 1;
        return new ObservableRuntime('R1', 'never');
      },
    });
    await registry.shutdown();
    const openResult = await registry.open({ userId: 'u-shutdown' }, 'k');
    expect(openResult).toMatchObject({ ok: false, code: 'REGISTRY_NOT_ACCEPTING' });
    // 豁免（设计 §7 shutdown 行）：公共入口停接纳检查先于一切输入访问——四键字面量
    // 永不被校验，shape 无关结果；`as never` 仅消除类型面（CreateNamespaceInput 已
    // 三键化，四键字面量在 typecheck 程序内产生 TS2353）。
    const createResult = await registry.create({
      owner: { userId: 'u-shutdown' },
      namespaceId: 'k',
      schema: { lang: 'vfsl', version: 1, id: 'k', text: 'type ROOT = { n: number; };\n' },
      root: { n: 1 },
    } as never);
    expect(createResult).toMatchObject({ ok: false, code: 'REGISTRY_NOT_ACCEPTING' });
    expect(persistence.loadCalls.length).toBe(0);
    expect(persistence.createCalls.length).toBe(0);
    expect(persistence.saveCalls).toBe(0);
    expect(factoryCalls).toBe(0);
    expect(registry.getStatus()).toEqual({ state: 'stopped' }); // getStatus 恒可用
  });
});

/**
 * SA6 红灯锚定 — issue #112：namespace-registry idle retention（AC4/5/6/7）
 * （冻结设计 §7 AC4+AC6 测试 1-6、AC5 测试 7-10、AC7 测试 11-12 + R1/H1 测试 3a）。
 *
 * 契约来源：wiki/raw/task_registry-idle-plugin-shutdown.md（冻结设计，R1 修订）：
 * - §2.A RegistryTimeoutScheduler / scheduler 必需（构造门禁）/ idleTimeoutMs 单点校验；
 * - §2.B idle 状态机（entry phase 三态、I1/I2/I3 不变量、I4 arm-token、
 *   beginIdleClose / activateEntry / handleLeaseReleased / removeEntryAfterClose、
 *   runOpenSlot 三态伪码、runCreateSlot idle 分派、timeout=0 异步性）；
 * - §2.C idle-close failure 通道（零 unhandled rejection、观察者 exact cause 恰一次、
 *   entry 代际局部清理、后续 open 不被污染）；
 * - §2.I observer 十形（entry-idle / idle-arm-failed / idle-close-failed）。
 *
 * 红灯纪律：全部并发用 deferred gate + 显式微任务排空（沿用 registry-open.test.ts
 * 原语）；时间全经 createRegistryTestScheduler().advanceBy；零 real sleep；clock 用
 * createManualClock 固定值；公开文本零回显负锁；observer 收 exact cause/identity/
 * generation。基线（#112 前）本文件红灯类别 = testing 子路径未导出
 * createRegistryTestScheduler（import 失败）+ scheduler 覆盖字段缺失（构造门禁）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import type { NamespaceRuntime, NamespaceRuntimeStatus } from '@nomicore/namespace-runtime';
import type { NamespaceLease } from '@nomicore/namespace-registry';
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

/** 显式微任务展开（禁 real sleep）。默认 20 层：覆盖 idle close 链
 * （timer 回调 → beginIdleClose → closePromise settle → removeEntryAfterClose →
 * slot 续体 → recheck）与 open/create 的完整嵌套深度。 */
async function flushMicrotasks(times = 20): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

// ── phase-5 切片 1（ADR 0010）：受控随机源确定性 helpers（测试内定义；禁止从 src 导出）──
// 计数源：第 n 次生成 = `ns-` + n 的 32 位小写 hex；剧本源：按 16 字节 hex 序列精确建模
// 碰撞/重试（entry 碰撞与 DOC_DUPLICATE 重试的确定性布置）。

const X_HEX_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // ns-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
const Y_HEX_ID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; // ns-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
const Z_HEX_ID = 'cccccccccccccccccccccccccccccccc'; // ns-cccccccccccccccccccccccccccccccc

function hexToBytes16(hex: string): Uint8Array {
  if (hex.length !== 32 || !/^[0-9a-f]+$/.test(hex)) {
    throw new Error(`fixture 脚本 hex 必须为 32 位小写 hex：${hex}`);
  }
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function makeDeterministicRandomBytes(): { randomBytes: (length: number) => Uint8Array } {
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
  };
}

/** 剧本源（碰撞/重试确定性布置）：按给定 hex 序列逐一吐字节；超出剧本即 throw。 */
function makeScriptedRandomBytes(hexChunks: readonly string[]): { randomBytes: (length: number) => Uint8Array } {
  let consumed = 0;
  const chunks = hexChunks.map(hexToBytes16);
  return {
    randomBytes(length: number): Uint8Array {
      if (length !== 16) {
        throw new Error(`受控随机源必须按 128-bit（16 字节）请求，实际请求 ${length} 字节`);
      }
      const chunk = chunks[consumed];
      if (chunk === undefined) {
        throw new Error('受控随机源超出剧本：实现的重试次数超过契约预算');
      }
      consumed += 1;
      return chunk;
    },
  };
}

const TEST_RANDOM_BYTES: (length: number) => Uint8Array = makeDeterministicRandomBytes().randomBytes;

/** manual Clock 固定值（零 real 时间依赖；idle 路径不消费 Clock 值）。 */
function manualClock(): { now: () => number } {
  return { now: () => 1_700_000_123_456 };
}

/** unhandledRejection 探针（AC7 显式探针手法；绝不用 vitest 全局忽略兜底）。 */
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

// ── 可控 Persistence stub（deferred load gate / createDoc 计数 / typed 注入）──────

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

/** release() 永不 settle（close 永挂起契约测试专用）。 */
class NeverSettleStubHandle extends StubHandle {
  override release(): Promise<void> {
    this.releaseCalls += 1;
    return new Promise<void>(() => {});
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

// ── 可控 Observable Runtime（close 计数 / gate / reject / never-settle / marker）──

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
  rejectWith?: unknown;
  neverSettle?: boolean;
  /** rev1 问题 2：close() 同步 throw（与 rejectWith 同为失败通道，触发面不同）。 */
  syncThrowWith?: unknown;
}

class ObservableRuntime implements NamespaceRuntime {
  closeCalls = 0;
  readonly owner = Object.freeze({ userId: 'u-idle' });

  constructor(
    readonly marker: string,
    readonly namespaceId: string,
    private readonly closePlan: RuntimeClosePlan = {},
    private readonly statusProvider: () => NamespaceRuntimeStatus = () => READY_STATUS,
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
    return this.statusProvider();
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
      throw this.closePlan.syncThrowWith; // 同步抛错路径（rev1 问题 2 收编目标）
    }
    if (this.closePlan.neverSettle) {
      return new Promise<void>(() => {});
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

// ── 观察者事件本地投影（内部 observer 事件联合在 #112 前为七形——本文件只按其
//    type 判别；identity/generation/cause 字段单独收窄）───────────────────────────

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

// ── 3a/15a 共用注入面：违约 adversarial scheduler（clearTimeout 为 no-op）─────────
//
// 只暴露自身 timer 队列（武装回调与触发能力），不读取 Registry 任何内部状态
// （§2.J 冻结边界：entry map/lease count/queue/timer handle 均不暴露）。
// 语义 =「取消/替换后回调仍可被手动触发」的违约 scheduler + 可判别 handle。

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
      // 违约 no-op：取消无效——已武装回调仍可被手动触发（模拟 native 已到期入队回调）
    },
    fire(index) {
      const [timer] = armed.splice(index, 1);
      if (timer === undefined) throw new Error(`adversarial scheduler 无第 ${index} 个武装回调`);
      timer.callback();
    },
  };
}

/** setTimeout 直接 throw 的 scheduler（idle-arm-failed 通道专属）。 */
function createThrowingScheduler(cause: Error): RegistryTimeoutScheduler {
  return {
    setTimeout() {
      throw cause;
    },
    clearTimeout() {},
  };
}

// ── 构造门禁（§2.A）：scheduler 必需字段 + 形状门禁（同 clock 同款纪律）──────────

const SCHEDULER_GATE_MESSAGE =
  'NAMESPACE_REGISTRY_SCHEDULER_REQUIRED: Registry 必须提供可调用的 setTimeout/clearTimeout 调度能力';

describe('scheduler 构造门禁（§2.A）：scheduler 必需，缺失/坏形状 → 同步固定 TypeError（零回显传入值）', () => {
  it('omitted / null / 非 object / setTimeout 非函数 / clearTimeout 非函数 → 同步 TypeError 恒定文案', () => {
    const persistence = new StubPersistence();
    const cases: Array<{ name: string; overrides: unknown }> = [
      { name: 'omitted', overrides: { clock: manualClock() } },
      { name: 'null scheduler', overrides: { clock: manualClock(), scheduler: null } },
      { name: 'non-object scheduler', overrides: { clock: manualClock(), scheduler: 42 } },
      { name: 'setTimeout 非函数', overrides: { clock: manualClock(), scheduler: { setTimeout: 'x', clearTimeout: () => {} } } },
      { name: 'clearTimeout 非函数', overrides: { clock: manualClock(), scheduler: { setTimeout: () => 0, clearTimeout: undefined } } },
    ];
    for (const c of cases) {
      let thrown: unknown;
      try {
        void createNamespaceRegistryForTesting(persistence, c.overrides as never);
      } catch (e) {
        thrown = e;
      }
      expect(thrown, `${c.name} → 同步 TypeError`).toBeInstanceOf(TypeError);
      if (thrown instanceof TypeError) {
        expect(thrown.message).toBe(SCHEDULER_GATE_MESSAGE);
      }
    }
  });
});

// ── AC4+AC6（§7 测试 1-6）：最后 lease release → idle 武装 / 完整时限 / 重进重置 / ──
//    3a arm-token / timeout=0 / fatal+degraded 同语义 / idle 期 lease 回归

describe('AC4+AC6（§7.1-6）：idle 武装、完整时限、重进重置、arm-token、timeout=0、capability 同语义', () => {
  it('1. 最后 lease release → entry 进入 idle：entry-idle 恰一次、timer 武装、runtime 未 close、release same-Promise', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-idle' }, 'k') });
    const scheduler = createRegistryTestScheduler();
    const observer = collectObserver();
    const runtime = new ObservableRuntime('R1', 'k');
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
      runtimeFactory: () => runtime,
      observer: observer.sink,
    });
    const a = okLease(await registry.open({ userId: 'u-idle' }, 'k'));
    const b = okLease(await registry.open({ userId: 'u-idle' }, 'k'));
    expect(scheduler.pending()).toBe(0);

    await a.release(); // 第一个 release：还剩一个 lease——不得 idle
    expect(scheduler.pending()).toBe(0);
    expect(runtime.closeCalls).toBe(0);

    const p1 = b.release(); // 最后 lease release（同步段）→ idle 武装
    expect(scheduler.pending()).toBe(1);
    expect(runtime.closeCalls).toBe(0); // release 栈内零 close
    const p2 = b.release();
    expect(p2).toBe(p1); // same-Promise 不变量（idle 后依旧）
    const pd = (b as unknown as Record<symbol, () => Promise<void>>)[Symbol.asyncDispose as symbol]!();
    expect(pd).toBe(p1);
    await p1;

    const idleEvents = observer.events.filter((e) => e.type === 'entry-idle');
    expect(idleEvents.length).toBe(1); // entry-idle 恰一次
    if (idleEvents[0]?.type === 'entry-idle') {
      expect(idleEvents[0].identity?.owner).toEqual({ userId: 'u-idle' });
      expect(idleEvents[0].identity?.namespaceId).toBe('k');
      expect(typeof idleEvents[0].identity?.key).toBe('string');
      expect(typeof idleEvents[0].generation).toBe('bigint');
    }
    expect(runtime.closeCalls).toBe(0); // 完整窗口内零 close
  });

  it('2. 完整 idleTimeoutMs：advanceBy(299_999) 不 close；advanceBy(1) close、entry 清理、新 open 全新 generation', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-idle' }, 'k') });
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-idle' }, 'k') });
    const scheduler = createRegistryTestScheduler();
    const runtimes: ObservableRuntime[] = [];
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
      runtimeFactory: () => {
        const r = new ObservableRuntime(`R${runtimes.length + 1}`, 'k');
        runtimes.push(r);
        return r;
      },
    });
    const lease = okLease(await registry.open({ userId: 'u-idle' }, 'k'));
    await lease.release();
    expect(scheduler.pending()).toBe(1);

    await scheduler.advanceBy(299_999); // 差 1ms：窗口未满
    expect(runtimes[0]?.closeCalls).toBe(0);
    expect(scheduler.pending()).toBe(1);

    await scheduler.advanceBy(1); // 满窗口 → beginIdleClose → close
    expect(runtimes[0]?.closeCalls).toBe(1);
    expect(scheduler.pending()).toBe(0);
    await flushMicrotasks();

    // entry 已移除（generation 全新）：再 open → 全新 loadDoc + 全新 Runtime marker
    const lease2 = okLease(await registry.open({ userId: 'u-idle' }, 'k'));
    expect(persistence.loadCalls.length).toBe(2);
    expect(runtimes.length).toBe(2);
    expect(lease2.read(['x'])).toEqual({ ok: true, value: 'R2' });
    await lease2.release();
  });

  it('3. 重进 idle 重置完整时限：重武装后新窗口从零起算（advance(299_999) 不 close，再 advance(1) close）', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-idle' }, 'k') });
    const scheduler = createRegistryTestScheduler();
    const runtime = new ObservableRuntime('R1', 'k');
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
      runtimeFactory: () => runtime,
    });
    const lease1 = okLease(await registry.open({ userId: 'u-idle' }, 'k'));
    await lease1.release();
    await scheduler.advanceBy(150_000); // 第一窗口走一半
    expect(runtime.closeCalls).toBe(0);

    // 窗口内 open：同步取消 timer、复用同一 Runtime（AC5）
    const lease2 = okLease(await registry.open({ userId: 'u-idle' }, 'k'));
    expect(scheduler.pending()).toBe(0); // 取消
    expect(persistence.loadCalls.length).toBe(1); // 零 loadDoc
    expect(lease2.read(['x'])).toEqual({ ok: true, value: 'R1' }); // 同一 Runtime marker

    await lease2.release(); // 重武装：全新完整 idleTimeoutMs
    expect(scheduler.pending()).toBe(1);
    await scheduler.advanceBy(299_999); // 新窗口未满
    expect(runtime.closeCalls).toBe(0);
    await scheduler.advanceBy(1); // 新窗口满 → close
    expect(runtime.closeCalls).toBe(1);
  });

  it('3a. arm-token adversarial（R1/H1）：旧回调手动触发 no-op、新 timer 存活、完整窗口后才 close', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-idle' }, 'k') });
    const adversarial = createLooseClearScheduler(); // clearTimeout = no-op（违约）
    const observer = collectObserver();
    const runtime = new ObservableRuntime('R1', 'k');
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler: adversarial,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
      runtimeFactory: () => runtime,
      observer: observer.sink,
    });
    const lease1 = okLease(await registry.open({ userId: 'u-idle' }, 'k'));
    await lease1.release(); // 武装 T1
    expect(adversarial.armed.length).toBe(1);
    const token1 = adversarial.armed[0]?.token;

    const lease2 = okLease(await registry.open({ userId: 'u-idle' }, 'k')); // 激活：取消（no-op）+ 复用
    expect(adversarial.armed.length).toBe(1); // 违约取消：T1 仍在（仍在登记的旧回调）
    expect(lease2.read(['x'])).toEqual({ ok: true, value: 'R1' });
    expect(persistence.loadCalls.length).toBe(1);

    await lease2.release(); // 重武装 T2（时间窗口重新起算）
    expect(adversarial.armed.length).toBe(2);
    expect(adversarial.armed[0]?.token).toBe(token1); // 旧 token 仍被登记

    adversarial.fire(0); // 手动触发【旧】回调（T1）：I4 arm-token 失配 → no-op
    expect(runtime.closeCalls).toBe(0); // runtime 未 close（AC5 窗口完整）
    expect(observer.events.filter((e) => e.type === 'idle-close-failed').length).toBe(0);
    expect(observer.events.filter((e) => e.type === 'entry-idle').length).toBe(2); // 两次 armed 各一次
    // 旧回调 no-op 的可观测证据：entry 仍在——open 复用 entry（零新增 loadDoc、
    // runtime 未 close）；phase-5 切片 1（ADR 0010）create 不再产出 ALREADY_EXISTS
    // （ID 由随机源生成、恒为新鲜候选），改锚「create 重生成新 ID 成功 + entry 'k'
    // 原样保留」。
    const dupLease = okLease(
      await registry.create({
        owner: { userId: 'u-idle' },
        schema: { lang: 'vfsl', version: 1, id: 'k', text: 'type ROOT = { n: number; };\n' },
        root: { n: 1 },
      }),
    );
    expect(dupLease.namespaceId).toMatch(/^ns-[0-9a-f]{32}$/);
    expect(persistence.createCalls.length).toBe(1); // 新 ID 正常落盘（与 'k' 无碰撞）
    expect(persistence.loadCalls.length).toBe(1); // entry 'k' 仍在（零额外 loadDoc）
    // 注意：不经 release——新 entry 保持 active（零额外 idle timer），T2（entry 'k'
    // 的新 timer）仍独占队列首位供下方 fire 判别。
    // 新 timer 存活：旧回调消费后，T2 仍在 adversarial 队列（`pending()===1` 语义等价锚）
    expect(adversarial.armed.length).toBe(1);
    expect(adversarial.armed[0]?.token).not.toBe(token1);

    adversarial.fire(0); // 手动触发【新】回调（T2）：token 匹配 → beginIdleClose
    expect(runtime.closeCalls).toBe(1); // 完整窗口后才 close（I4 判别与新 token 生效双锚）
    expect(persistence.loadCalls.length).toBe(1); // 旧回调全程未触发任何 close/重建
  });

  it('4. timeout=0：release resolve 后（微任务排空）runtime 仍未 closed；advanceBy(0) 后才 close（异步性双锚）', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-idle' }, 'k') });
    const scheduler = createRegistryTestScheduler();
    const runtime = new ObservableRuntime('R1', 'k');
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 0,
      runtimeFactory: () => runtime,
    });
    const lease = okLease(await registry.open({ userId: 'u-idle' }, 'k'));
    await lease.release();
    expect(runtime.closeCalls).toBe(0);
    await flushMicrotasks();
    expect(runtime.closeCalls).toBe(0); // 锚①：release 调用栈内零 close、零 runtime 状态变更
    expect(scheduler.pending()).toBe(1); // 0ms 也已异步调度（武装在 fake 队列）
    await scheduler.advanceBy(0); // 锚②：advanceBy(0) 触发
    expect(runtime.closeCalls).toBe(1);
  });

  it('5a. fatal Runtime 同 idle 语义：release → idle → 完整窗口 advance → close 照常（capability 零特判）', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-idle' }, 'k') });
    const scheduler = createRegistryTestScheduler();
    const runtime = new ObservableRuntime('R1', 'k', {}, () => ({
      lifecycle: 'ready',
      read: { enabled: true },
      rootWrite: { enabled: false },
      schemaWrite: { enabled: false },
      schema: { state: 'unavailable', issue: { code: 'RUNTIME_SCHEMA_X', message: 'fatal-msg' } },
      fatal: { code: 'RUNTIME_FATAL', message: 'fatal-msg' },
      close: null,
      replication: { state: 'disabled' },
    }));
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
      runtimeFactory: () => runtime,
    });
    const lease = okLease(await registry.open({ userId: 'u-idle' }, 'k'));
    expect(lease.read(['x'])).toEqual({ ok: true, value: 'R1' }); // fatal 期读面仍可用
    await lease.release();
    expect(scheduler.pending()).toBe(1);
    await scheduler.advanceBy(300_000);
    expect(runtime.closeCalls).toBe(1); // 零特判：fatal 照常 idle→close
  });

  it('5b. degraded Runtime 同 idle 语义：release → idle → 完整窗口 advance → close 照常', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-idle' }, 'k') });
    const scheduler = createRegistryTestScheduler();
    const runtime = new ObservableRuntime('R1', 'k', {}, () => ({
      lifecycle: 'ready',
      read: { enabled: true },
      rootWrite: { enabled: true },
      schemaWrite: { enabled: false },
      schema: { state: 'ready' },
      fatal: null,
      close: null,
      replication: { state: 'disabled' },
    }));
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
      runtimeFactory: () => runtime,
    });
    const lease = okLease(await registry.open({ userId: 'u-idle' }, 'k'));
    const st = lease.getStatus();
    if (st.lease === 'active') {
      expect(st.runtime.schemaWrite.enabled).toBe(false);
    }
    await lease.release();
    expect(scheduler.pending()).toBe(1);
    await scheduler.advanceBy(300_000);
    expect(runtime.closeCalls).toBe(1);
  });

  it('6. idle 期第二次 release / asyncDispose 回归：same-Promise 与 released status 保持；open 复用仍同步取消', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-idle' }, 'k') });
    const scheduler = createRegistryTestScheduler();
    const observer = collectObserver();
    const runtime = new ObservableRuntime('R1', 'k');
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
      runtimeFactory: () => runtime,
      observer: observer.sink,
    });
    const a = okLease(await registry.open({ userId: 'u-idle' }, 'k'));
    const b = okLease(await registry.open({ userId: 'u-idle' }, 'k'));
    const pa = a.release();
    await flushMicrotasks();
    expect(scheduler.pending()).toBe(0); // 还有 b：不得 idle
    const pb = b.release();
    expect(scheduler.pending()).toBe(1); // idle 武装
    expect(pb).toBe(b.release()); // idle 期重复 release same-Promise
    expect(pb).toBe((b as unknown as Record<symbol, () => Promise<void>>)[Symbol.asyncDispose as symbol]!());
    expect(pa).toBe(a.release());
    expect(a.getStatus()).toEqual({ lease: 'released', runtime: null });
    expect(b.getStatus()).toEqual({ lease: 'released', runtime: null });
    await pb;
    // lease-released 观察者事件两份（remainingLeases 1 → 0）
    const releasedEvents = observer.events.filter((e) => e.type === 'lease-released');
    expect(releasedEvents.length).toBe(2);
  });
});

// ── AC5（§7 测试 7-10）：idle 期 open 同步取消 / timer 先行 open 等待 / closing-wait ──
//    reject / create 于 idle

describe('AC5（§7.7-10）：idle → active 复用、closing-wait、create idle 分派', () => {
  it('7. idle 期 open（advance 前）：同步取消 timer（pending 0）、复用同一 Runtime、零 loadDoc、新 lease', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-idle' }, 'k') });
    const scheduler = createRegistryTestScheduler();
    const runtime = new ObservableRuntime('R1', 'k');
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
      runtimeFactory: () => runtime,
    });
    const lease1 = okLease(await registry.open({ userId: 'u-idle' }, 'k'));
    await lease1.release();
    expect(scheduler.pending()).toBe(1);

    const lease2 = okLease(await registry.open({ userId: 'u-idle' }, 'k'));
    expect(scheduler.pending()).toBe(0); // AC5 同步取消 timer
    expect(lease2).not.toBe(lease1);
    expect(persistence.loadCalls.length).toBe(1); // 零 loadDoc
    expect(lease2.read(['x'])).toEqual({ ok: true, value: 'R1' }); // 同一 Runtime identity
    expect(lease2.getMetadata()).toEqual({ marker: 'R1' });
    // 再次 release → 重新武装（open 后 entry 为 active，release 再入 idle）
    await lease2.release();
    expect(scheduler.pending()).toBe(1);
    // 清理：完整窗口 close，避免 test 间 timer 残留（fake 无真实副作用，但保持纪律）
    await scheduler.advanceBy(300_000);
    expect(runtime.closeCalls).toBe(1);
  });

  it('8. timer 先行（closing 已建立）：open 等待同一 close Promise 结算 → entry 移除 → 全新 generation', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-idle' }, 'k') });
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-idle' }, 'k') });
    const scheduler = createRegistryTestScheduler();
    const closeGate = deferred();
    const runtimes: ObservableRuntime[] = [];
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
      runtimeFactory: () => {
        const r = new ObservableRuntime(`R${runtimes.length + 1}`, 'k',
          runtimes.length === 0 ? { gate: closeGate } : {});
        runtimes.push(r);
        return r;
      },
    });
    const lease1 = okLease(await registry.open({ userId: 'u-idle' }, 'k'));
    await lease1.release();
    await scheduler.advanceBy(300_000); // timer 先行：beginIdleClose，close 挂于 gate
    expect(runtimes[0]?.closeCalls).toBe(1);

    const p2 = registry.open({ userId: 'u-idle' }, 'k'); // closing：入槽等待（不 loadDoc）
    await flushMicrotasks();
    expect(persistence.loadCalls.length).toBe(1); // 未新建 generation
    let settled = false;
    void p2.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await flushMicrotasks();
    expect(settled).toBe(false); // 等待契约：close 未 settle 前 open 不结算

    closeGate.resolve(); // 放行 release → close settle → entry 移除 → open 继续
    const lease2 = okLease(await p2);
    expect(persistence.loadCalls.length).toBe(2); // 全新 loadDoc
    expect(runtimes.length).toBe(2);
    expect(lease2.read(['x'])).toEqual({ ok: true, value: 'R2' }); // 新 generation marker
    await lease2.release();
  });

  it('9. closing-wait 中 close reject：open 吞掉并继续建新 generation；observer idle-close-failed exact cause 恰一次', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-idle' }, 'k') });
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-idle' }, 'k') });
    const scheduler = createRegistryTestScheduler();
    const closeGate = deferred();
    const closeCause = new Error('idle-close-reject-9a');
    const observer = collectObserver();
    const runtimes: ObservableRuntime[] = [];
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
      runtimeFactory: () => {
        const r = new ObservableRuntime(`R${runtimes.length + 1}`, 'k',
          runtimes.length === 0 ? { gate: closeGate } : {});
        runtimes.push(r);
        return r;
      },
      observer: observer.sink,
    });
    const lease1 = okLease(await registry.open({ userId: 'u-idle' }, 'k'));
    await lease1.release();
    await scheduler.advanceBy(300_000); // close 挂起于 gate
    const p2 = registry.open({ userId: 'u-idle' }, 'k');
    await flushMicrotasks();
    closeGate.reject(closeCause); // 旧 generation close reject：发起侧上报 observer 后清理

    const lease2 = okLease(await p2); // open 吞掉 close reject 并继续（新 generation）
    expect(persistence.loadCalls.length).toBe(2);
    expect(runtimes.length).toBe(2);
    expect(lease2.read(['x'])).toEqual({ ok: true, value: 'R2' });
    await lease2.release();
    const failedEvents = observer.events.filter((e) => e.type === 'idle-close-failed');
    expect(failedEvents.length).toBe(1);
    if (failedEvents[0]?.type === 'idle-close-failed') {
      expect(failedEvents[0].cause).toBe(closeCause); // exact cause
      expect(failedEvents[0].identity?.namespaceId).toBe('k');
      expect(typeof failedEvents[0].generation).toBe('bigint');
    }
  });

  it('10. create 于 idle：首个候选撞 idle entry → 重生成新 ID 成功（colliding 候选零 Persistence 尝试）；完整窗口后 entry 清理、再 create 成功', async () => {
    // phase-5 切片 1（ADR 0010）：create 不再产出 ALREADY_EXISTS——entry（active/idle/
    // closing 一律）碰撞是编排循环的重试条件；DQ-5「idle 同码」语义迁移为「idle 亦占
    // 命名空间（碰撞）」，排他性由「重生成 + 耗尽 fatal」承载。
    const persistence = new StubPersistence();
    const scheduler = createRegistryTestScheduler();
    const clock = {
      calls: 0,
      now() {
        this.calls += 1;
        return 1_700_000_123_456;
      },
    };
    const runtimes: ObservableRuntime[] = [];
    const random = makeScriptedRandomBytes([X_HEX_ID, X_HEX_ID, Y_HEX_ID, Z_HEX_ID]);
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock,
      scheduler,
      randomBytes: random.randomBytes,
      idleTimeoutMs: 300_000,
      runtimeFactory: () => {
        const r = new ObservableRuntime(`R${runtimes.length + 1}`, 'k');
        runtimes.push(r);
        return r;
      },
    });
    const lease1 = okLease(await registry.create({
      owner: { userId: 'u-idle' },
      schema: { lang: 'vfsl', version: 1, id: 'k', text: 'type ROOT = { n: number; };\n' },
      root: { n: 1 },
    }));
    expect(lease1.namespaceId).toBe(`ns-${X_HEX_ID}`);
    await lease1.release();
    expect(scheduler.pending()).toBe(1); // idle 武装
    expect(clock.calls).toBe(1);

    // create#2：首选候选 X 撞 idle entry（payload/Clock 之前短路）→ 重生成 Y 成功；
    // 证据 = createDoc 恰 [X, Y]（colliding 候选零 Persistence 尝试）。
    const lease2 = okLease(await registry.create({
      owner: { userId: 'u-idle' },
      schema: { lang: 'vfsl', version: 1, id: 'k', text: 'type ROOT = { n: number; };\n' },
      root: { n: 1 },
    }));
    expect(lease2.namespaceId).toBe(`ns-${Y_HEX_ID}`);
    expect(persistence.createCalls.map((c) => c.docId)).toEqual([`ns-${X_HEX_ID}`, `ns-${Y_HEX_ID}`]);
    expect(persistence.loadCalls.length).toBe(0);
    expect(persistence.saveCalls).toBe(0);
    expect(clock.calls).toBe(2); // 每次 create 单读；colliding 候选在 payload/Clock 前短路
    await lease2.release();
    // 完整窗口 close 后 entry（X/Y）清理 → 再 create 新 ID 成功（idle 不遗留）
    await scheduler.advanceBy(300_000);
    await flushMicrotasks();
    expect(runtimes[0]?.closeCalls).toBe(1); // X 代际被 idle close
    const lease3 = okLease(await registry.create({
      owner: { userId: 'u-idle' },
      schema: { lang: 'vfsl', version: 1, id: 'k', text: 'type ROOT = { n: number; };\n' },
      root: { n: 1 },
    }));
    expect(persistence.createCalls.length).toBe(3);
    await lease3.release();
  });
});

// ── §2.B 派生：idle-arm-failed 通道（scheduler.setTimeout throw → 不破坏 release）──

describe('idle-arm-failed（§2.B 派生）：武装失败 loud 上报、release same-Promise 保持、shutdown 兜底', () => {
  it('scheduler.setTimeout 同步 throw → release 仍 resolve undefined；observer idle-arm-failed exact cause；entry 停留 active', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-idle' }, 'k') });
    const armCause = new Error('arm-boom-13');
    const scheduler = createThrowingScheduler(armCause);
    const observer = collectObserver();
    const runtime = new ObservableRuntime('R1', 'k');
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(),
      scheduler,
      randomBytes: TEST_RANDOM_BYTES,
      idleTimeoutMs: 300_000,
      runtimeFactory: () => runtime,
      observer: observer.sink,
    });
    const lease = okLease(await registry.open({ userId: 'u-idle' }, 'k'));
    const p1 = lease.release();
    await expect(p1).resolves.toBeUndefined(); // same-Promise 契约不被武装失败破坏
    expect(lease.getStatus()).toEqual({ lease: 'released', runtime: null });
    const armFailed = observer.events.filter((e) => e.type === 'idle-arm-failed');
    expect(armFailed.length).toBe(1);
    if (armFailed[0]?.type === 'idle-arm-failed') {
      expect(armFailed[0].cause).toBe(armCause); // exact cause
      expect(armFailed[0].identity?.namespaceId).toBe('k');
      expect(typeof armFailed[0].generation).toBe('bigint');
    }
    expect(runtime.closeCalls).toBe(0); // 武装失败绝不 close
    // entry 停留 active（零 lease）可复用：open 零 loadDoc、同一 Runtime marker
    const lease2 = okLease(await registry.open({ userId: 'u-idle' }, 'k'));
    expect(persistence.loadCalls.length).toBe(1);
    expect(lease2.read(['x'])).toEqual({ ok: true, value: 'R1' });
    await lease2.release();
  });
});

// ── AC7（§7 测试 11-12）：idle-close 失败三通道 + close 永挂起契约 ────────────────

describe('AC7（§7.11-12）：idle-close failure 零 unhandled rejection、观察者、零污染、永挂起等待契约', () => {
  it('11. close reject 全链：零 unhandled rejection；observer exact cause 恰一次；后续 open 全新 generation；create 于 idle 碰撞重生成、窗口后恢复（跨 generation 零残留）', async () => {
    // phase-5 切片 1（ADR 0010）：create 的排他性由「重生成 + 耗尽 fatal」承载——
    // ID 由注入随机源生成，entry（含 idle）碰撞即换 ID 重试；「跨 generation 零残留」
    // 断言意图 = 完整窗口结算后 entry 移除、create 恢复（无需同 key 重建表达——
    // 普通 create 已不能指定 key）。
    const probe = collectUnhandledRejections();
    try {
      const persistence = new StubPersistence();
      persistence.queueLoad({ result: new StubHandle({ userId: 'u-idle' }, 'k') });
      const scheduler = createRegistryTestScheduler();
      const closeCause = new Error('idle-close-reject-11');
      const observer = collectObserver();
      const runtimes: ObservableRuntime[] = [];
      const random = makeScriptedRandomBytes([X_HEX_ID, X_HEX_ID, Y_HEX_ID, Z_HEX_ID]);
      const registry = createNamespaceRegistryForTesting(persistence, {
        clock: manualClock(),
        scheduler,
        randomBytes: random.randomBytes,
        idleTimeoutMs: 300_000,
        runtimeFactory: () => {
          const r = new ObservableRuntime(`R${runtimes.length + 1}`, 'k',
            runtimes.length === 0 ? { rejectWith: closeCause } : {});
          runtimes.push(r);
          return r;
        },
        observer: observer.sink,
      });
      // 宿主代际 X（R1）：create 生成 → release → idle → 完整窗口 close reject
      const lease1 = okLease(await registry.create({
        owner: { userId: 'u-idle' },
        schema: { lang: 'vfsl', version: 1, id: 'k', text: 'type ROOT = { n: number; };\n' },
        root: { n: 1 },
      }));
      expect(lease1.namespaceId).toBe(`ns-${X_HEX_ID}`);
      await lease1.release();
      await scheduler.advanceBy(300_000); // close reject
      await flushMicrotasks();
      expect(runtimes[0]?.closeCalls).toBe(1);
      // 未处理 rejection 探针必须有足够宏任务展开暴露潜在漏网
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]); // AC7①：零 unhandled rejection

      // AC7②：observer idle-close-failed exact cause 恰一次
      const failed = observer.events.filter((e) => e.type === 'idle-close-failed');
      expect(failed.length).toBe(1);
      if (failed[0]?.type === 'idle-close-failed') {
        expect(failed[0].cause).toBe(closeCause);
        expect(failed[0].identity?.namespaceId).toBe(`ns-${X_HEX_ID}`);
        expect(typeof failed[0].generation).toBe('bigint');
      }
      // AC7④：后续 open 不被污染 → 全新 generation（entry 已移除 → 走 loadDoc 恢复）
      const lease2 = okLease(await registry.open({ userId: 'u-idle' }, `ns-${X_HEX_ID}`));
      expect(persistence.loadCalls.length).toBe(1);
      expect(runtimes.length).toBe(2);
      expect(lease2.read(['x'])).toEqual({ ok: true, value: 'R2' });
      await lease2.release();
      expect(scheduler.pending()).toBe(1); // R2 代际 idle 武装
      // create#2：首选候选 X 撞 idle entry → 重生成 Y 成功（colliding 候选零 Persistence）
      const dupIdleLease = okLease(await registry.create({
        owner: { userId: 'u-idle' },
        schema: { lang: 'vfsl', version: 1, id: 'k', text: 'type ROOT = { n: number; };\n' },
        root: { n: 1 },
      }));
      expect(dupIdleLease.namespaceId).toBe(`ns-${Y_HEX_ID}`);
      expect(persistence.createCalls.map((c) => c.docId)).toEqual([`ns-${X_HEX_ID}`, `ns-${Y_HEX_ID}`]);
      // 完整窗口推进 → R2 代际（entry X）idle close 结算 → entry 移除
      await scheduler.advanceBy(300_000);
      await flushMicrotasks();
      expect(runtimes[1]?.closeCalls).toBe(1);
      // 零残留：再 create 新 ID 成功（跨 generation 零残留——完整窗口结算后无占用）
      const rLease = okLease(await registry.create({
        owner: { userId: 'u-idle' },
        schema: { lang: 'vfsl', version: 1, id: 'k', text: 'type ROOT = { n: number; };\n' },
        root: { n: 1 },
      }));
      expect(persistence.createCalls.length).toBe(3);
      await rLease.release();
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]); // 全程零 unhandled rejection（再次确认）
    } finally {
      probe.dispose();
    }
  });

  it('11b. rev1 问题 2：idle close 同步 throw——异常不逃出 timer 回调；observer idle-close-failed exact cause 恰一次；entry 移除（后续 open 建立新 generation）；零 unhandled rejection', async () => {
    const probe = collectUnhandledRejections();
    try {
      const persistence = new StubPersistence();
      persistence.queueLoad({ result: new StubHandle({ userId: 'u-idle' }, 'k') });
      persistence.queueLoad({ result: new StubHandle({ userId: 'u-idle' }, 'k') }); // 新 generation 的 load
      const scheduler = createRegistryTestScheduler();
      const syncCause = new Error('idle-close-sync-throw-11b');
      const observer = collectObserver();
      const runtimes: ObservableRuntime[] = [];
      const registry = createNamespaceRegistryForTesting(persistence, {
        clock: manualClock(),
        scheduler,
        randomBytes: TEST_RANDOM_BYTES,
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
      const lease1 = okLease(await registry.open({ userId: 'u-idle' }, 'k'));
      await lease1.release(); // last lease → idle 武装
      expect(scheduler.pending()).toBe(1);
      // ★ 判别核心 1：timer 回调内同步 throw 被收编——advanceBy 不 reject、不逃出
      //   （当前实现：beginIdleClose 的 runtime.close() 同步 throw 逃出 timer 回调 →
      //   advanceBy 拒绝 → 红）。
      const advanceOutcome = await scheduler.advanceBy(300_000).then(
        () => 'settled',
        (e: unknown) => `rejected:${String(e)}`,
      );
      expect(advanceOutcome).toBe('settled');
      await flushMicrotasks();
      expect(runtimes[0]?.closeCalls).toBe(1);
      // ★ 判别核心 2：observer idle-close-failed exact cause 恰一次
      //   （当前实现：同步 throw 不产生该事件 → 红）。
      const failed = observer.events.filter((e) => e.type === 'idle-close-failed');
      expect(failed.length).toBe(1);
      if (failed[0]?.type === 'idle-close-failed') {
        expect(failed[0].cause).toBe(syncCause);
      }
      // ★ 判别核心 3：entry 已被移除 → 后续 open 建立全新 generation
      //   （当前实现：entry 残留 idle（phase 未翻、closePromise 未写）→ open 复用
      //   同一 Runtime、loadCalls 不增 → 红）。
      const lease2 = okLease(await registry.open({ userId: 'u-idle' }, 'k'));
      expect(persistence.loadCalls.length).toBe(2);
      expect(runtimes.length).toBe(2);
      expect(lease2.read(['x'])).toEqual({ ok: true, value: 'R2' });
      await lease2.release();
      // 收尾：R2 代际正常 idle close 结算（清扫 timer，避免测试残留武装）
      await scheduler.advanceBy(300_000);
      await flushMicrotasks();
      expect(runtimes[1]?.closeCalls).toBe(1);
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]); // 零 unhandled rejection（AC7① 同步 throw 同构）
    } finally {
      probe.dispose();
    }
  });

  it('11c. rev1 问题 2（P2 防御守卫防误伤）：同步 throw 武装回调在 entry 被并发 open 激活后触发——close 零发起、open 复用同 Runtime、零 idle-close-failed 事件', async () => {
    const probe = collectUnhandledRejections();
    try {
      const persistence = new StubPersistence();
      persistence.queueLoad({ result: new StubHandle({ userId: 'u-idle' }, 'k') });
      const adversarial = createLooseClearScheduler(); // clearTimeout = no-op（违约）
      const observer = collectObserver();
      const syncCause = new Error('idle-close-sync-throw-11c');
      const runtime = new ObservableRuntime('R1', 'k', { syncThrowWith: syncCause });
      const registry = createNamespaceRegistryForTesting(persistence, {
        clock: manualClock(),
        scheduler: adversarial,
        randomBytes: TEST_RANDOM_BYTES,
        idleTimeoutMs: 300_000,
        runtimeFactory: () => runtime,
        observer: observer.sink,
      });
      const lease1 = okLease(await registry.open({ userId: 'u-idle' }, 'k'));
      await lease1.release(); // 武装 T1（同步 throw 计划已就位）
      expect(adversarial.armed.length).toBe(1);
      // 窗口内并发 open：同步取消 timer（违约 clear 无效——回调仍可被手动触发）、
      // 复用同一 Runtime（零 loadDoc）、翻相 active（非 idle）。
      const lease2 = okLease(await registry.open({ userId: 'u-idle' }, 'k'));
      expect(persistence.loadCalls.length).toBe(1); // 零 loadDoc：复用同 Runtime
      expect(lease2.read(['x'])).toEqual({ ok: true, value: 'R1' });
      expect(adversarial.armed.length).toBe(1); // 违约束：T1 回调仍存活
      // 手动触发旧回调：守卫链（I4 token 失配先行；phase !== 'idle' 为结构性防御）——P2
      // 收编逻辑不得在守卫之前发起 close（防误伤）：同步 throw 计划零触发、零事件。
      adversarial.fire(0);
      await flushMicrotasks();
      expect(runtime.closeCalls).toBe(0);
      expect(observer.events.filter((e) => e.type === 'idle-close-failed')).toEqual([]);
      // 清理：lease2 释放 → 重武装 → 手动触发 → beginIdleClose 正常路径（同步 throw
      // 收编照常工作，与 11b 同构——11c 断言主体 = 守卫不被收编逻辑破坏）。
      await lease2.release();
      expect(adversarial.armed.length).toBe(1);
      adversarial.fire(0);
      await flushMicrotasks();
      expect(runtime.closeCalls).toBe(1);
      expect(observer.events.filter((e) => e.type === 'idle-close-failed').length).toBe(1);
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]); // 全程零 unhandled rejection
    } finally {
      probe.dispose();
    }
  });

  it('12. close 永挂起：open 等待属契约（等待而非崩溃）；create 对 closing entry 一律碰撞重生成（绝不等待 closePromise）；零 unhandled rejection', async () => {
    // phase-5 切片 1（ADR 0010，§4.3.3 ①）：create 的 entry 碰撞检查把 active/idle/
    // closing 一律视为碰撞 → 换 ID 重试——「create 等待 closePromise」旧语义删除，
    // 等待契约保留在 open（closing-wait，见测试 8）；never-settle close 不击穿 create。
    const probe = collectUnhandledRejections();
    try {
      const persistence = new StubPersistence();
      persistence.queueLoad({ result: new StubHandle({ userId: 'u-idle' }, 'k') });
      const scheduler = createRegistryTestScheduler();
      const runtimes: ObservableRuntime[] = [];
      const random = makeScriptedRandomBytes([X_HEX_ID, X_HEX_ID, Y_HEX_ID]);
      const registry = createNamespaceRegistryForTesting(persistence, {
        clock: manualClock(),
        scheduler,
        randomBytes: random.randomBytes,
        idleTimeoutMs: 300_000,
        runtimeFactory: () => {
          const r = new ObservableRuntime(`R${runtimes.length + 1}`, 'k',
            runtimes.length === 0 ? { neverSettle: true } : {});
          runtimes.push(r);
          return r;
        },
      });
      const lease = okLease(await registry.create({
        owner: { userId: 'u-idle' },
        schema: { lang: 'vfsl', version: 1, id: 'k', text: 'type ROOT = { n: number; };\n' },
        root: { n: 1 },
      }));
      expect(lease.namespaceId).toBe(`ns-${X_HEX_ID}`);
      await lease.release();
      await scheduler.advanceBy(300_000); // close 发起但永不 settle → entry X closing
      expect(runtimes[0]?.closeCalls).toBe(1);

      // create#2：首选候选 X 撞 closing entry → 不等待、不阻塞 → 重生成 Y 成功
      const createdPromise = registry.create({
        owner: { userId: 'u-idle' },
        schema: { lang: 'vfsl', version: 1, id: 'k', text: 'type ROOT = { n: number; };\n' },
        root: { n: 1 },
      });
      let settled: 'pending' | 'resolved' | 'rejected' = 'pending';
      void createdPromise.then(
        () => {
          settled = 'resolved';
        },
        () => {
          settled = 'rejected';
        },
      );
      await flushMicrotasks(30);
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      // create 不被 never-settle closePromise 击穿：碰撞 → 重生成 settle（成功）
      expect(settled).toBe('resolved');
      const lease2 = okLease(await createdPromise);
      expect(lease2.namespaceId).toBe(`ns-${Y_HEX_ID}`);
      expect(persistence.createCalls.map((c) => c.docId)).toEqual([`ns-${X_HEX_ID}`, `ns-${Y_HEX_ID}`]);
      await lease2.release();
      expect(probe.events).toEqual([]); // 只锚：不产生 unhandled rejection
    } finally {
      probe.dispose();
    }
  });
});

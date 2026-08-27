/**
 * SA6 红灯锚定 — issue #112：namespace-registry Cordis plugin（AC1/2/3/11）
 * （冻结设计 §7 测试 22-28 + R1/M1 测试 28a；真实 `new Context()` 组合）。
 *
 * 契约来源：wiki/raw/task_registry-idle-plugin-shutdown.md（冻结设计，R1 修订）：
 * - §2.F plugin 形状（NOMICORE_REGISTRY_SERVICE / provide / require / inject /
 *   有序 disposer / assertNamespaceRegistryHostDependencies / createCordisRegistryScheduler /
 *   resolvePluginIdleTimeoutMs / 双通道 AC3 裁决）；
 * - §2.A DEFAULT_IDLE_TIMEOUT_MS 单点化（registry.ts 唯一定义点，plugin.ts 纯
 *   re-export，index 沿 plugin 链转出——本文件锚定值 300_000）；
 * - §2.G 主入口导出面增量（createNamespaceRegistryPlugin 等九值）；
 * - §2.H NamespaceRegistryShutdownError（聚合 reject 通道）；
 * - §5 协议依据（#3 逆序串行、#4 re-parent、#5 依赖图 join、#8 PENDING 门）。
 *
 * 红灯纪律：真实 Cordis Context 组合；确定性 fake timer（createFakeTimerPlugin）+
 * manual clock；deferred gate + 显式微任务展开；零 real sleep；零 unhandled
 * rejection 探针。基线（#112 前）本文件红灯类别 = 主入口未导出
 * createNamespaceRegistryPlugin/NOMICORE_REGISTRY_SERVICE/...（import 失败）+
 * packages/namespace-registry 依赖清单缺少 @deepseek-ai/cordis（模块解析失败）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import { createMemoryPersistencePlugin } from '@nomicore/persistence';
import { provideNomicorePersistence } from '@nomicore/persistence';
import { createFakeTimerPlugin } from '@nomicore/persistence/testing';
import { createManualClock, createManualClockPlugin } from '@nomicore/clock/testing';
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  NOMICORE_REGISTRY_SERVICE,
  NamespaceRegistryShutdownError,
  createNamespaceRegistryPlugin,
  provideNomicoreRegistry,
  requireNomicoreRegistry,
} from '@nomicore/namespace-registry';
import type { NamespaceLease } from '@nomicore/namespace-registry';
import { createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import { Context } from '@deepseek-ai/cordis';

// FiberState（cordis fiber.d.ts const enum）：PENDING=0 / LOADING=1 / ACTIVE=2 /
// FAILED=3 / DISPOSED=4 / UNLOADING=5。const enum 无运行时对象，本文件以数值
// 常量断言 fiber.state（28a 依赖门语义）。
const FIBER_STATE_PENDING = 0;
const FIBER_STATE_ACTIVE = 2;

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

async function flushMicrotasks(times = 20): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
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

function okLease(result: unknown): NamespaceLease {
  const r = result as { ok?: boolean; lease?: NamespaceLease };
  expect(r.ok, `open 应成功，实际：${JSON.stringify(result)}`).toBe(true);
  if (!r.ok || r.lease === undefined) throw new Error('unreachable');
  return r.lease;
}

// ── 可控 persistence stub（plugin 组合经 nomicorePersistence 服务注入）──────────
// 真实 runtime 工厂消费：doc 携带合法 SCHEMA/META/ROOT（P0 编译正常）；
// release 支持 gate（25）/reject（27）/计数（28）。

class PluginStubHandle implements DocHandle {
  releaseCalls = 0;
  readonly doc: Y.Doc;
  readonly releaseGate: Deferred | undefined;
  readonly releaseRejectWith: unknown;

  constructor(readonly owner: User, readonly docId: string, opts: { gate?: Deferred; rejectWith?: unknown } = {}) {
    this.releaseGate = opts.gate;
    this.releaseRejectWith = opts.rejectWith;
    const doc = new Y.Doc();
    doc.getMap('SCHEMA').set('lang', 'vfsl');
    doc.getMap('SCHEMA').set('version', 1);
    doc.getMap('SCHEMA').set('id', docId);
    doc.getMap('SCHEMA').set('text', 'type ROOT = { n: number; };\n');
    doc.getMap('META').set('docId', docId);
    doc.getMap('ROOT').set('n', 42);
    this.doc = doc;
  }

  getStatus(): 'ready' {
    return 'ready';
  }

  release(): Promise<void> {
    this.releaseCalls += 1;
    if (this.releaseGate !== undefined) {
      return this.releaseGate.promise;
    }
    if (this.releaseRejectWith !== undefined) {
      return Promise.reject(this.releaseRejectWith);
    }
    return Promise.resolve();
  }
}

class PluginStubPersistence implements DocPersistence {
  loadCalls = 0;
  saveCalls = 0;
  createCalls = 0;
  private readonly planned: Array<PluginStubHandle | null> = [];

  planLoad(handle: PluginStubHandle | null): void {
    this.planned.push(handle);
  }

  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    this.loadCalls += 1;
    const planned = this.planned.shift();
    return planned === undefined ? new PluginStubHandle(owner, docId) : planned;
  }

  async saveDoc(): Promise<void> {
    this.saveCalls += 1;
  }

  async createDoc(owner: User, docId: string): Promise<DocHandle> {
    this.createCalls += 1;
    return new PluginStubHandle(owner, docId);
  }
}

// ── AC1/AC2（§7 测试 22/24）：组合 / config 矩阵 ────────────────────────────────

describe('AC1/AC2/AC3 组合（§7.22-24）：真实 Context 组合与配置校验', () => {
  it('22. 组合：manualClockPlugin + createFakeTimerPlugin + createMemoryPersistencePlugin + createNamespaceRegistryPlugin → ctx.nomicoreRegistry 为真实 Registry（open/create/getStatus 可用）', async () => {
    const ctx = new Context();
    createManualClockPlugin(createManualClock(1_700_000_123_456)).apply(ctx);
    createFakeTimerPlugin(createRegistryTestScheduler()).apply(ctx);
    createMemoryPersistencePlugin().apply(ctx);
    const plugin = createNamespaceRegistryPlugin();
    const fiber = ctx.plugin(plugin);
    await fiber;

    // require 通道（公开 require 通道；缺失即 throw——组合上下文服务必在；返回类型
    // NamespaceRegistry（非 undefined），消除 TS18048 收窄噪声）
    const registry = requireNomicoreRegistry(ctx);
    expect(registry).toBe(plugin.instance);
    expect(registry).toBe(requireNomicoreRegistry(ctx)); // require 通道可读
    expect(provideNomicoreRegistry).toBeTypeOf('function');
    expect(NOMICORE_REGISTRY_SERVICE).toBe('nomicoreRegistry'); // issue #104 冻结名

    // open：真实 memory persistence（无此 doc → NAMESPACE_NOT_FOUND）
    const missing = await registry.open({ userId: 'u-compose' }, 'missing-ns');
    expect(missing).toMatchObject({ ok: false, code: 'NAMESPACE_NOT_FOUND' });
    // create：真实建立（doc 提交）→ 返回 lease；getStatus 真实三相投影
    // phase-5 切片 1（ADR 0010）：create 恒三键——namespaceId 由 plugin 桥接的
    // node:crypto 受控随机源生成（ns-+32hex），调用方不再提供。
    const created = await registry.create({
      owner: { userId: 'u-compose' },
      schema: { lang: 'vfsl', version: 1, id: 'ns-1', text: 'type ROOT = { n: number; };\n' },
      root: { n: 42 },
    });
    expect(created.ok).toBe(true);
    const lease = okLease(created);
    expect(lease.read(['n'])).toEqual({ ok: true, value: 42 });
    expect(registry.getStatus()).toEqual({ state: 'running' });
    await lease.release();
    await ctx.fiber.dispose();
    expect(ctx.get('nomicoreRegistry')).toBeUndefined(); // 全拆下 service 撤销
  });

  it('23. 缺依赖 loud（直接 apply 通道）：clock/timer/nomicorePersistence 逐一剔除 → 稳定文案 throw + 零 service 提供', async () => {
    // ① 裸 Context：clock 缺失（断言订单 clock 先行）
    const pluginA = createNamespaceRegistryPlugin();
    expect(() => pluginA.apply(new Context())).toThrow(
      'required Cordis service "clock" is unavailable',
    );
    expect(pluginA.instance).toBeUndefined();

    // ② 已装 clock、缺 timer：timer 专属文案
    const ctxB = new Context();
    createManualClockPlugin(createManualClock(0)).apply(ctxB);
    const pluginB = createNamespaceRegistryPlugin();
    expect(() => pluginB.apply(ctxB)).toThrow(
      'required Cordis service "timer" is unavailable: install @deepseek-ai/cordis-plugin-timer before the namespace-registry plugin',
    );
    expect(ctxB.get('nomicoreRegistry')).toBeUndefined();
    expect(pluginB.instance).toBeUndefined();
    await ctxB.fiber.dispose();

    // ③ 已装 clock + timer、缺 nomicorePersistence：persistence 现有文案
    const ctxC = new Context();
    createManualClockPlugin(createManualClock(0)).apply(ctxC);
    createFakeTimerPlugin(createRegistryTestScheduler()).apply(ctxC);
    const pluginC = createNamespaceRegistryPlugin();
    expect(() => pluginC.apply(ctxC)).toThrow(
      'required Cordis service "nomicorePersistence" is unavailable',
    );
    expect(ctxC.get('nomicoreRegistry')).toBeUndefined();
    expect(pluginC.instance).toBeUndefined();
    await ctxC.fiber.dispose();
  });

  it('24. config 校验矩阵：缺省 300_000（M3 单点值锚）；0/2147483647 接受；类型/数值域/键集二分 TypeError/RangeError 恒定文案', () => {
    // M3：DEFAULT_IDLE_TIMEOUT_MS 单点化——值锚定（定义点在 registry.ts，plugin/index 链 re-export）
    expect(DEFAULT_IDLE_TIMEOUT_MS).toBe(300_000);
    // 缺省与合法边界接受
    expect(() => createNamespaceRegistryPlugin()).not.toThrow();
    expect(() => createNamespaceRegistryPlugin({ idleTimeoutMs: 0 })).not.toThrow();
    expect(() => createNamespaceRegistryPlugin({ idleTimeoutMs: 2_147_483_647 })).not.toThrow();
    // TypeError = 形状/键集（§2.F resolvePluginIdleTimeoutMs）
    expect(() => createNamespaceRegistryPlugin({ idleTimeoutMs: '300000' } as never)).toThrow(
      'NAMESPACE_REGISTRY_IDLE_TIMEOUT_TYPE: idleTimeoutMs 必须是 number（0..2147483647 有限整数）',
    );
    expect(() => createNamespaceRegistryPlugin({ foo: 1 } as never)).toThrow(
      'NAMESPACE_REGISTRY_PLUGIN_CONFIG: namespace-registry 插件配置仅接受 idleTimeoutMs 键',
    );
    // RangeError = 数值域（§2.A 二分）
    for (const bad of [-1, 1.5, Number.NaN, 2_147_483_648]) {
      expect(() => createNamespaceRegistryPlugin({ idleTimeoutMs: bad })).toThrow(
        'NAMESPACE_REGISTRY_IDLE_TIMEOUT_RANGE: idleTimeoutMs 必须是 0..2147483647 的有限整数',
      );
    }
  });
});

// ── AC11（§7 测试 25/26/27）：有序 disposer / 先于 Persistence / close 失败 dispose ──

describe('AC11（§7.25-27）：有序 async disposer、fiber 级先序、失败路径 finally', () => {
  it('25. 有序 disposer：shutdown 完成前 fiber dispose 不 settle；探针次序 shutdownStarted → statusWhileDisposing → shutdownSettled → serviceRevoked', async () => {
    const ctx = new Context();
    createManualClockPlugin(createManualClock(0)).apply(ctx);
    createFakeTimerPlugin(createRegistryTestScheduler()).apply(ctx);
    const handleGate = deferred();
    const stub = new PluginStubPersistence();
    stub.planLoad(new PluginStubHandle({ userId: 'u-order' }, 'k', { gate: handleGate }));
    provideNomicorePersistence(ctx, stub); // 服务在场（形状完整）；撤销时机由 fiber dispose 决定
    const plugin = createNamespaceRegistryPlugin({ idleTimeoutMs: 300_000 });
    const fiber = ctx.plugin(plugin);
    await fiber;
    const registry = plugin.instance!;
    expect(registry).toBeDefined();
    const lease = okLease(await registry.open({ userId: 'u-order' }, 'k'));

    // 窗口拉开手法（O-R2-2）：测试先行直调 shutdown 拿 same-Promise（AC12 幂等使
    // disposer 内 await 共享同一实例）并先行挂接 settle 续体；close 挂于 gate 卡住窗口。
    const probe: string[] = [];
    const p = registry.shutdown();
    probe.push('shutdownStarted');
    expect(registry.getStatus()).toEqual({ state: 'shutting-down' });
    expect(ctx.get('nomicoreRegistry')).toBe(registry); // 同步段后、dispose 前：service 仍在（未撤）
    probe.push('statusWhileDisposing');
    void p.then(() => {
      probe.push('shutdownSettled');
    });
    await flushMicrotasks();

    const disposal = fiber.dispose(); // disposer：await registry.shutdown()（close 挂于 gate）
    let disposalSettled = false;
    void disposal.then(
      () => {
        disposalSettled = true;
      },
      () => {
        disposalSettled = true;
      },
    );
    await flushMicrotasks();
    expect(disposalSettled).toBe(false); // ★ 判别核心：shutdown 完成前 fiber dispose 不得 settle
    expect(probe).toEqual(['shutdownStarted', 'statusWhileDisposing']); // 尚未 settle/撤销

    handleGate.resolve(); // 放行 close → p settle → 测试续体先醒（先注册）→ 链上 revoke 后置
    await disposal;
    probe.push('serviceRevoked');
    expect(ctx.get('nomicoreRegistry')).toBeUndefined(); // 首个稳定可观测撤销时刻（dispose 完成后）
    expect(plugin.instance).toBeUndefined();
    expect(probe).toEqual(['shutdownStarted', 'statusWhileDisposing', 'shutdownSettled', 'serviceRevoked']);
    await lease.release().catch(() => {});
    await ctx.fiber.dispose();
  });

  it('26. 先于 Persistence dispose（fiber 级）：撤 persistence fiber → registry fiber 先卸载；其 shutdown 探针先于 persistence fiber dispose settle；根级全拆无 unhandled rejection', async () => {
    const probe = collectUnhandledRejections();
    try {
      const ctx = new Context();
      createManualClockPlugin(createManualClock(0)).apply(ctx);
      createFakeTimerPlugin(createRegistryTestScheduler()).apply(ctx);
      const memoryPlugin = createMemoryPersistencePlugin();
      const memoryFiber = ctx.plugin(memoryPlugin);
      await memoryFiber;
      const registryPlugin = createNamespaceRegistryPlugin();
      const registryFiber = ctx.plugin(registryPlugin);
      await registryFiber;
      const registry = ctx.get('nomicoreRegistry');
      expect(registry).toBeDefined();

      const probes: string[] = [];
      const p = (registry as { shutdown(): Promise<void> }).shutdown();
      void p.then(() => {
        probes.push('registry-shutdown-settled');
      });
      // 撤 persistence 服务：provide disposer → notify → 依赖 fiber（registry）先 settle
      const disposal = memoryFiber.dispose();
      await disposal;
      probes.push('persistence-fiber-dispose-settled');
      expect(probes).toEqual(['registry-shutdown-settled', 'persistence-fiber-dispose-settled']);
      expect(ctx.get('nomicoreRegistry')).toBeUndefined();
      expect(ctx.get('nomicorePersistence')).toBeUndefined();
      expect(registryPlugin.instance).toBeUndefined();
      // cordis `_getState()` 语义：依赖消失触发 _setEpoch(INACTIVE) → _unload，卸载后
      // uid 仍非 null → state===0（FiberState.PENDING——可重载，设计 §2.F R5 reload
      // 语义正依赖此态）；FiberState.DISPOSED=4 仅显式 fiber.dispose() 才到达。
      expect(registryFiber.state).toBe(0); // PENDING（非 ACTIVE，非 DISPOSED）
      await ctx.fiber.dispose();
      // 根级全拆：全部 service 撤销、零 unhandled rejection
      expect(ctx.get('clock')).toBeUndefined();
      expect(ctx.get('timer')).toBeUndefined();
      await flushMicrotasks();
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('27. close 失败的 dispose：reject release 的 persistence → plugin disposer 仍完成撤 service（finally 路径）；聚合 rejection 交 cordis，零 unhandled rejection', async () => {
    const probe = collectUnhandledRejections();
    try {
      const ctx = new Context();
      createManualClockPlugin(createManualClock(0)).apply(ctx);
      createFakeTimerPlugin(createRegistryTestScheduler()).apply(ctx);
      const releaseCause = new Error('release-reject-plugin-27');
      const stub = new PluginStubPersistence();
      stub.planLoad(new PluginStubHandle({ userId: 'u-fail' }, 'k', { rejectWith: releaseCause }));
      provideNomicorePersistence(ctx, stub);
      const plugin = createNamespaceRegistryPlugin();
      const fiber = ctx.plugin(plugin);
      await fiber;
      const registry = plugin.instance!;
      const lease = okLease(await registry.open({ userId: 'u-fail' }, 'k'));

      const p = registry.shutdown();
      void p.catch(() => {}); // 测试侧先行处理（设计：rejection 交 cordis fiber 日志）
      const disposal = fiber.dispose();
      await disposal; // finally 撤 service：dispose 不因聚合 rejection 崩溃
      expect(ctx.get('nomicoreRegistry')).toBeUndefined();
      expect(plugin.instance).toBeUndefined();
      const err = await p.then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(NamespaceRegistryShutdownError);
      if (err instanceof NamespaceRegistryShutdownError) {
        expect(err.failures.length).toBe(1);
        // 真实 runtime close 语义（namespace-runtime/src/close.ts）：release reject
        // 被包装为 NamespaceRuntimeCloseError（稳定 code NSRT-CLOSE-RELEASE-FAILED、
        // 恒定 message、.cause 保留原始 release 异常）——聚合 exact cause = 该包装
        // 错误（设计 §2.C 明文）。该类不经 @nomicore/namespace-runtime 主入口导出
        // （包内类），本测试只按 code + cause 链判别，不 import。
        const failureCause = err.failures[0]?.cause;
        expect(failureCause).toBeInstanceOf(Error);
        expect((failureCause as { code?: unknown }).code).toBe('NSRT-CLOSE-RELEASE-FAILED');
        expect((failureCause as { cause?: unknown }).cause).toBe(releaseCause);
      }
      await flushMicrotasks();
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]); // 聚合 rejection 已被处置：零 unhandled
      await lease.release().catch(() => {});
      await ctx.fiber.dispose();
    } finally {
      probe.dispose();
    }
  });
});

// ── AC3/AC11（§7 测试 28/28a）：ctx.timeout 真实桥 + 通道 B 依赖门 ───────────────

describe('AC3/AC11（§7.28/28a）：timer 经 ctx.timeout 真实桥；ctx.plugin 依赖门 PENDING↔ACTIVE', () => {
  it('28. timer 经 ctx.timeout 真实桥：idle close 由 fake timer service 的 ctx.timeout 通道触发（advance 驱动）', async () => {
    const scheduler = createRegistryTestScheduler();
    const ctx = new Context();
    createManualClockPlugin(createManualClock(0)).apply(ctx);
    createFakeTimerPlugin(scheduler).apply(ctx);
    const stub = new PluginStubPersistence();
    const handle = new PluginStubHandle({ userId: 'u-timer' }, 'k');
    stub.planLoad(handle);
    provideNomicorePersistence(ctx, stub);
    const plugin = createNamespaceRegistryPlugin({ idleTimeoutMs: 300_000 });
    const fiber = ctx.plugin(plugin);
    await fiber;
    const registry = plugin.instance!;

    const lease = okLease(await registry.open({ userId: 'u-timer' }, 'k'));
    await lease.release();
    expect(scheduler.pending()).toBe(1); // idle timer 经 ctx.timeout 桥武装到 fake 队列
    await scheduler.advanceBy(300_000); // 假 timer 到期 → 桥回调 → beginIdleClose → close
    await flushMicrotasks(30);
    expect(scheduler.pending()).toBe(0);
    expect(handle.releaseCalls).toBe(1); // 真实 runtime close 恰一次（releaseCalls===1）
    // entry 已清理：再次 open 全新 loadDoc
    const lease2 = okLease(await registry.open({ userId: 'u-timer' }, 'k'));
    expect(stub.loadCalls).toBe(2);
    await lease2.release();
    await ctx.fiber.dispose();
  });

  it('28a. 通道 B（ctx.plugin）依赖门：缺依赖 → fiber PENDING（非 ACTIVE）、零 service、零 instance；补装缺失服务 → ACTIVE + service/instance 就绪（双向）', async () => {
    const ctx = new Context();
    const plugin = createNamespaceRegistryPlugin();
    const fiber = ctx.plugin(plugin); // 全部依赖缺失 → cordis 原生依赖门
    await fiber;
    expect(fiber.state).toBe(FIBER_STATE_PENDING);
    expect(ctx.get('nomicoreRegistry')).toBeUndefined();
    expect(plugin.instance).toBeUndefined();

    createManualClockPlugin(createManualClock(0)).apply(ctx);
    createFakeTimerPlugin(createRegistryTestScheduler()).apply(ctx);
    await fiber;
    expect(fiber.state).toBe(FIBER_STATE_PENDING); // 仍缺 nomicorePersistence：PENDING 停留（不半启动）
    expect(ctx.get('nomicoreRegistry')).toBeUndefined();
    expect(plugin.instance).toBeUndefined();

    createMemoryPersistencePlugin().apply(ctx); // 补齐 → notify → reload → ACTIVE
    await fiber;
    expect(fiber.state).toBe(FIBER_STATE_ACTIVE);
    expect(ctx.get('nomicoreRegistry')).toBeDefined();
    expect(plugin.instance).toBe(ctx.get('nomicoreRegistry'));
    expect(requireNomicoreRegistry(ctx)).toBe(plugin.instance);
    await ctx.fiber.dispose();
    expect(ctx.get('nomicoreRegistry')).toBeUndefined();
  });
});

// ── rev1 问题 3（§7 测试 29）：adapter 级 dispose 次序——Registry shutdown settle 先于
//    persistence adapter dispose（真实 MemoryPersistence + 写排空门控探针）───────────────

describe('rev1 问题 3：Registry shutdown settle 严格先于 persistence adapter dispose（adapter 级）', () => {
  it('29. 裁撤 persistence fiber 级联：gated 写排空窗口内 adapter dispose 不先于 registry-shutdown-settled；旧实例 stopped/撤销；零聚合失败、零 unhandled', async () => {
    const probe = collectUnhandledRejections();
    try {
      const ctx = new Context();
      createManualClockPlugin(createManualClock(0)).apply(ctx);
      createFakeTimerPlugin(createRegistryTestScheduler()).apply(ctx);
      const memoryPlugin = createMemoryPersistencePlugin();
      const memoryFiber = ctx.plugin(memoryPlugin);
      await memoryFiber;
      const registryPlugin = createNamespaceRegistryPlugin({ idleTimeoutMs: 300_000 });
      const registryFiber = ctx.plugin(registryPlugin);
      await registryFiber;
      const registry = requireNomicoreRegistry(ctx);
      const adapter = memoryPlugin.instance;
      expect(adapter).toBeDefined();
      if (adapter === undefined) throw new Error('unreachable: memory adapter instance');

      // adapter dispose 探针（effect disposer 的 `this.dispose()` 在卸载时点动态解析 →
      // 实例级影子方法被调用；开始/完成双探针）。
      const events: string[] = [];
      const originalDispose = adapter.dispose.bind(adapter);
      adapter.dispose = async () => {
        events.push('persistence-adapter-disposed');
        await originalDispose();
        events.push('persistence-adapter-disposed-complete');
      };
      // saveDoc 门控：首个 dirty notification 挂起 → Runtime close 排空窗口确定性拉开
      // （registry 的 notifyDirty = () => persistence.saveDoc(handle)，写槽 S6 同槽 await）。
      const saveGate = deferred();
      const originalSaveDoc = adapter.saveDoc.bind(adapter);
      let gated = false;
      adapter.saveDoc = async (handle) => {
        if (!gated) {
          gated = true;
          await saveGate.promise;
        }
        return originalSaveDoc(handle);
      };

      const created = await registry.create({
        owner: { userId: 'u-order' },
        schema: { lang: 'vfsl', version: 1, id: 'k', text: 'type ROOT = { n: number; };\n' },
        root: { n: 42 },
      });
      expect(created.ok).toBe(true);
      const lease = okLease(created);
      expect(lease.read(['n'])).toEqual({ ok: true, value: 42 });
      // 接受一个写（shutdown 关闭排空的对象）：写槽异步起步 → S6 挂于 gated saveDoc。
      const writePromise = lease.mutateRoot({ op: 'set', path: ['n'], value: 43 });
      await flushMicrotasks(30);
      expect(gated).toBe(true); // 写槽已到 S6（排空窗口挂起中）

      // 窗口拉开（沿用测试 25 手法）：先以 instame-Promise 挂接 shutdown settle 探针
      // ——plugin disposer 内 `await registry.shutdown()` 共享同一 Promise 实例（AC12）。
      const p = registry.shutdown();
      let shutdownSettled = false;
      void p.then(
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
      expect(shutdownSettled).toBe(false); // 写排空未放行：shutdown 严格挂起

      // 裁撤 persistence 服务 → provider disposer → notify → registry fiber 级联卸载
      // （卸载期间 adapter dispose 与 registry shutdown 的历史并发点——rev1 问题 3）。
      const disposal = memoryFiber.dispose();
      await flushMicrotasks(30);
      // ★ 当前实现红点证据锚：shutdown 仍未 settle（写排空门控中），adapter dispose
      //   探针却已触发——先记录事实，终值断言见下。
      expect(shutdownSettled).toBe(false);

      saveGate.resolve(); // 放行写排空 → close 结算 → shutdown settle
      await writePromise.catch(() => {}); // 写槽自身结果非本测试契约（可能 fatal/成功均不关键）
      await disposal; // 级联完成（registry fiber 卸载 → memory fiber 卸载完成）
      await flushMicrotasks(30);

      // ★ 判别核心：registry-shutdown-settled 必须先于 persistence-adapter-disposed
      //   （当前实现：adapter dispose 与 registry shutdown 并发、先完成 → 红）。
      expect(events.indexOf('registry-shutdown-settled')).toBeGreaterThanOrEqual(0);
      expect(events.indexOf('registry-shutdown-settled')).toBeLessThan(
        events.indexOf('persistence-adapter-disposed'),
      );
      // adapter dispose 恰好一次（开始/完成探针各一）。
      expect(events.filter((e) => e === 'persistence-adapter-disposed').length).toBe(1);
      expect(events.filter((e) => e === 'persistence-adapter-disposed-complete').length).toBe(1);
      // 旧实例回收 + 级联终态：stopped、service/instance 撤销、registry fiber PENDING。
      expect(registry.getStatus()).toEqual({ state: 'stopped' });
      expect(ctx.get('nomicoreRegistry')).toBeUndefined();
      expect(ctx.get('nomicorePersistence')).toBeUndefined();
      expect(registryPlugin.instance).toBeUndefined();
      expect(registryFiber.state).toBe(FIBER_STATE_PENDING);
      // 序次契约下关闭不得撞已销毁 adapter → 无 close 失败聚合（shutdown resolve——若
      // 聚合失败则 reject NamespaceRegistryShutdownError，红）。
      await expect(p).resolves.toBeUndefined();
      await lease.release().catch(() => {});
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
});

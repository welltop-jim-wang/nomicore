/**
 * SA7 动态攻击验证 — issue #112：Cordis 组合动态（总控攻击面 4；SA4 §7 交验事项 2/3）。
 *
 * 攻击目标（除 SA7-P4 烟囱用例外全部确定性、零 real sleep）：
 * - SA7-P1 完整装配→工作→根级 dispose：真实 `new Context()` + manual clock + fake
 *   timer + persistence 服务 + registry plugin；create→read→release（idle 武装）→
 *   根级 `ctx.fiber.dispose()` → idle timer 被取消（pending 0，非到期触发）、runtime
 *   close 恰一次、service/instance 回收、零 unhandled rejection 探针；
 * - SA7-P2 persistence fiber 先 dispose 的 fiber 级次序 + R1 残余并发通道：close 写
 *   排空撞「已销毁 handle」（release reject）→ shutdown 聚合错误通道真实工作
 *   （held instance 经 AC12 幂等 same-Promise 取回聚合错误；cause 链
 *   NSRT-CLOSE-RELEASE-FAILED）；
 * - SA7-P3 registry plugin reload：persistence 服务撤除→重提供 → 旧 Registry 实例
 *   shutdown（stopped）、fiber PENDING→重载 → 全新实例可用（service/instance 换新）；
 * - SA7-P4 烟囱用例（real native timer + real sleep，SA4 §7.2 交错证据）：真实
 *   cordis-plugin-timer TimerService + idleTimeoutMs=10ms，arm→取消→重武装交错后
 *   native 到期恰一次 close。
 *
 * 补充用例登记（SA7 报告 §补充用例）：P1-P4。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import { provideNomicorePersistence } from '@nomicore/persistence';
import { createFakeTimerPlugin } from '@nomicore/persistence/testing';
import { createManualClock, createManualClockPlugin } from '@nomicore/clock/testing';
import {
  NamespaceRegistryShutdownError,
  createNamespaceRegistryPlugin,
  requireNomicoreRegistry,
} from '@nomicore/namespace-registry';
import type { NamespaceLease } from '@nomicore/namespace-registry';
import { createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import { Context } from '@deepseek-ai/cordis';
import TimerService from '@deepseek-ai/cordis-plugin-timer';

// FiberState（cordis fiber.d.ts const enum，无运行时对象——数值常量断言）。
const FIBER_STATE_PENDING = 0;
const FIBER_STATE_ACTIVE = 2;

async function flushMicrotasks(times = 40): Promise<void> {
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
  expect(r.ok, `应成功，实际：${JSON.stringify(result)}`).toBe(true);
  if (!r.ok || r.lease === undefined) throw new Error('unreachable');
  return r.lease;
}

// ── 带合法 SCHEMA/META/ROOT 的 stub（真实 runtime 工厂可消费；沿用 plugin 测试形态）──

class Sa7StubHandle implements DocHandle {
  releaseCalls = 0;
  readonly doc: Y.Doc;
  readonly releaseRejectWith: unknown;

  constructor(readonly owner: User, readonly docId: string, opts: { rejectWith?: unknown } = {}) {
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
    if (this.releaseRejectWith !== undefined) {
      return Promise.reject(this.releaseRejectWith);
    }
    return Promise.resolve();
  }
}

class Sa7StubPersistence implements DocPersistence {
  loadCalls = 0;
  createCalls = 0;
  saveCalls = 0;
  private planned: Sa7StubHandle[] = [];

  planLoad(handle: Sa7StubHandle): void {
    this.planned.push(handle);
  }

  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    this.loadCalls += 1;
    const planned = this.planned.shift();
    return planned === undefined ? new Sa7StubHandle(owner, docId) : planned;
  }

  async saveDoc(): Promise<void> {
    this.saveCalls += 1;
  }

  async createDoc(owner: User, docId: string): Promise<DocHandle> {
    this.createCalls += 1;
    return new Sa7StubHandle(owner, docId);
  }
}

/** 把 stub persistence 以独立 fiber 提供（dispose 该 fiber = 撤服务 + 依赖级联）。 */
function stubPersistencePlugin(stub: Sa7StubPersistence): { name: string; apply(ctx: Context): void } {
  return {
    name: 'sa7-stub-persistence',
    apply(ctx: Context): void {
      provideNomicorePersistence(ctx, stub);
    },
  };
}

const CREATE_PAYLOAD = (namespaceId: string) => ({
  owner: { userId: 'u-sa7' },
  namespaceId,
  schema: { lang: 'vfsl', version: 1, id: namespaceId, text: 'type ROOT = { n: number; };\n' },
  root: { n: 42 },
});

describe('SA7 Cordis 组合动态（攻击面 4）', () => {
  it('SA7-P1 完整装配→工作→根级 dispose：idle timer 取消（非到期）、close 恰一次、service/instance 回收、零 unhandled', async () => {
    const probe = collectUnhandledRejections();
    try {
      const scheduler = createRegistryTestScheduler();
      const ctx = new Context();
      createManualClockPlugin(createManualClock(1_700_000_123_456)).apply(ctx);
      createFakeTimerPlugin(scheduler).apply(ctx);
      const stub = new Sa7StubPersistence();
      const persistenceFiber = ctx.plugin(stubPersistencePlugin(stub));
      await persistenceFiber;
      const plugin = createNamespaceRegistryPlugin();
      const registryFiber = ctx.plugin(plugin);
      await registryFiber;
      const registry = requireNomicoreRegistry(ctx);
      expect(registry.getStatus()).toEqual({ state: 'running' });

      // 工作：create → read → release（idle 武装经 ctx.timeout 桥）。
      const lease = okLease(await registry.create(CREATE_PAYLOAD('ns-p1')));
      expect(lease.read(['n'])).toEqual({ ok: true, value: 42 });
      expect(stub.createCalls).toBe(1);
      await lease.release();
      expect(scheduler.pending()).toBe(1); // idle timer 武装

      // 根级 dispose：shutdown 同步段取消 idle timer（pending→0，非到期触发）→
      // 关闭 Runtime（handle release 恰一次）→ 撤 service/instance。
      await ctx.fiber.dispose();
      expect(scheduler.pending()).toBe(0);
      expect(stub.loadCalls).toBe(0); // 全程零额外 loadDoc
      expect(registry.getStatus()).toEqual({ state: 'stopped' });
      expect(ctx.get('nomicoreRegistry')).toBeUndefined();
      expect(ctx.get('nomicorePersistence')).toBeUndefined();
      expect(plugin.instance).toBeUndefined();
      // close 侧：runtime close → handle.release 恰一次（create 路径 handle）。
      expect(stub.createCalls).toBe(1);
      await flushMicrotasks();
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]); // 零 unhandled rejection
    } finally {
      probe.dispose();
    }
  });

  it('SA7-P2 persistence fiber 先 dispose（R1 残余并发通道）：close 撞已销毁 handle → 聚合错误通道真实工作（fiber 级次序保持）', async () => {
    const probe = collectUnhandledRejections();
    try {
      const scheduler = createRegistryTestScheduler();
      const ctx = new Context();
      createManualClockPlugin(createManualClock(0)).apply(ctx);
      createFakeTimerPlugin(scheduler).apply(ctx);
      // R1 场景：persistence adapter 已 dispose → runtime close 的 release 撞已销毁
      // handle → close 失败 → shutdown 聚合错误（设计 §8 R1 的预期通道）。
      const releaseCause = new Error('SA7-P2: release on disposed adapter handle');
      const stub = new Sa7StubPersistence();
      stub.planLoad(new Sa7StubHandle({ userId: 'u-sa7' }, 'ns-p2', { rejectWith: releaseCause }));
      const persistenceFiber = ctx.plugin(stubPersistencePlugin(stub));
      await persistenceFiber;
      const plugin = createNamespaceRegistryPlugin();
      const registryFiber = ctx.plugin(plugin);
      await registryFiber;
      const held = plugin.instance!;
      expect(held).toBeDefined();
      const lease = okLease(await held.open({ userId: 'u-sa7' }, 'ns-p2'));

      // persistence fiber 先 dispose：provider disposer → notify → 依赖级联触发 registry
      // fiber 卸载（disposer: shutdown → close → release reject）→ fiber 级先序 =
      // registry 卸载 settle 先于 persistence dispose 完成（§5#5；probe 次序锚在
      // SA6 测试 26，此处聚焦聚合通道）。
      await persistenceFiber.dispose();

      // 旧实例已 shutdown（聚合失败不回滚终态）。
      expect(held.getStatus()).toEqual({ state: 'stopped' });
      expect(plugin.instance).toBeUndefined();
      expect(ctx.get('nomicoreRegistry')).toBeUndefined();
      expect(registryFiber.state).toBe(FIBER_STATE_PENDING); // PENDING（可重载），非 DISPOSED

      // ★ 聚合错误通道真实工作：held.shutdown() 幂等 same-Promise（AC12 含已 reject
      // 实例）→ 取回依赖级联期间的聚合 rejection。
      const err = await held.shutdown().then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(NamespaceRegistryShutdownError);
      if (err instanceof NamespaceRegistryShutdownError) {
        expect(err.failures.length).toBe(1);
        expect(err.failures[0]?.namespaceId).toBe('ns-p2');
        // 真实 runtime close 包装语义：NSRT-CLOSE-RELEASE-FAILED + .cause 保留原始异常。
        const failureCause = err.failures[0]?.cause;
        expect(failureCause).toBeInstanceOf(Error);
        expect((failureCause as { code?: unknown }).code).toBe('NSRT-CLOSE-RELEASE-FAILED');
        expect((failureCause as { cause?: unknown }).cause).toBe(releaseCause);
      }
      await lease.release().catch(() => {}); // 旧 lease 幂等（回收后 release 不炸）
      await ctx.fiber.dispose();
      await flushMicrotasks();
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]); // 聚合 rejection 已被处置：零 unhandled
    } finally {
      probe.dispose();
    }
  });

  it('SA7-P3 registry plugin reload：persistence 撤除→重提供 → 旧实例 shutdown（stopped）、新实例可用（service/instance 换新）', async () => {
    const probe = collectUnhandledRejections();
    try {
      const scheduler = createRegistryTestScheduler();
      const ctx = new Context();
      createManualClockPlugin(createManualClock(0)).apply(ctx);
      createFakeTimerPlugin(scheduler).apply(ctx);
      const stub1 = new Sa7StubPersistence();
      stub1.planLoad(new Sa7StubHandle({ userId: 'u-sa7' }, 'ns-p3'));
      const persistenceFiber1 = ctx.plugin(stubPersistencePlugin(stub1));
      await persistenceFiber1;
      const plugin = createNamespaceRegistryPlugin();
      const registryFiber = ctx.plugin(plugin);
      await registryFiber;
      const oldRegistry = plugin.instance!;
      expect(registryFiber.state).toBe(FIBER_STATE_ACTIVE);
      const oldLease = okLease(await oldRegistry.open({ userId: 'u-sa7' }, 'ns-p3'));
      expect(stub1.loadCalls).toBe(1);

      // 撤 persistence 服务 → registry fiber 级联卸载：旧实例 shutdown（带存活 lease
      // 照常关闭——AC9 不等外部 release）。
      await persistenceFiber1.dispose();
      expect(oldRegistry.getStatus()).toEqual({ state: 'stopped' });
      expect(plugin.instance).toBeUndefined();
      expect(registryFiber.state).toBe(FIBER_STATE_PENDING); // 可重载态

      // 重提供（新 persistence 实例）→ registry fiber reload → 全新 Registry 实例。
      const stub2 = new Sa7StubPersistence();
      stub2.planLoad(new Sa7StubHandle({ userId: 'u-sa7' }, 'ns-p3'));
      const persistenceFiber2 = ctx.plugin(stubPersistencePlugin(stub2));
      await persistenceFiber2;
      await registryFiber;
      expect(registryFiber.state).toBe(FIBER_STATE_ACTIVE);
      const newRegistry = plugin.instance!;
      expect(newRegistry).not.toBe(oldRegistry); // 全新实例（reload 冻结声明）
      expect(requireNomicoreRegistry(ctx)).toBe(newRegistry);
      expect(newRegistry.getStatus()).toEqual({ state: 'running' });

      // 新实例可用（经新 persistence 服务 open）。
      const newLease = okLease(await newRegistry.open({ userId: 'u-sa7' }, 'ns-p3'));
      expect(stub2.loadCalls).toBe(1);
      expect(newLease.read(['n'])).toEqual({ ok: true, value: 42 });
      await newLease.release();
      await oldLease.release(); // 旧 lease 随旧实例回收（幂等、不炸）
      await ctx.fiber.dispose();
      await flushMicrotasks();
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('SA7-P4 烟囱用例（real native timer + real sleep）：真实 TimerService 下 arm→取消→重武装交错，native 到期恰一次 close', async () => {
    const probe = collectUnhandledRejections();
    try {
      const ctx = new Context();
      createManualClockPlugin(createManualClock(0)).apply(ctx);
      new TimerService(ctx); // 真实 timer 服务（native setTimeout/clearTimeout）
      const stub = new Sa7StubPersistence();
      const handle = new Sa7StubHandle({ userId: 'u-sa7' }, 'ns-p4');
      stub.planLoad(handle);
      provideNomicorePersistence(ctx, stub);
      const plugin = createNamespaceRegistryPlugin({ idleTimeoutMs: 10 }); // 10ms native 窗口
      const registryFiber = ctx.plugin(plugin);
      await registryFiber;
      const registry = plugin.instance!;
      expect(registry).toBeDefined();

      // 交错（SA2 H1 生产形态的最小烟囱）：open → release（武装 T1@10ms）→ 立即
      // re-open（clearTimeout 取消 T1）→ release（重武装 T2@10ms 完整窗口）。
      const lease1 = okLease(await registry.open({ userId: 'u-sa7' }, 'ns-p4'));
      await lease1.release(); // T1 武装
      const lease2 = okLease(await registry.open({ userId: 'u-sa7' }, 'ns-p4')); // T1 取消（激活复用）
      expect(stub.loadCalls).toBe(1); // 复用：零新 loadDoc
      await lease2.release(); // T2 重武装（完整 10ms 新窗口）

      // real sleep 40ms（≫ 10ms 窗口）——本用例唯一非确定性点，已注明。
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 40);
      });
      expect(handle.releaseCalls).toBe(1); // native 到期 → close 恰一次
      expect(stub.loadCalls).toBe(1); // T1 已被真实取消：零重复 close/零多余 loadDoc

      // close 后 entry 清理：再 open 全新 generation。
      const lease3 = okLease(await registry.open({ userId: 'u-sa7' }, 'ns-p4'));
      expect(stub.loadCalls).toBe(2);
      await lease3.release();
      await ctx.fiber.dispose();
      await flushMicrotasks();
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });
});

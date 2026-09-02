/**
 * SA7 动态攻击验证 — issue #112：并发压力（总控攻击面 2）。
 *
 * 攻击目标（全部确定性、零 real sleep；时间全经 createRegistryTestScheduler().advanceBy）：
 * - SA7-C1 单 key 100 次并发 open + 交错 release/重 open（carrier FIFO 串行化下的
 *   批量并发；活跃 entry 复用；部分释放不得武装 idle；终态恰一次 close）；
 * - SA7-C2 多 key（50）并行 open→release→idle→advance→close 全流程（每 key 独立
 *   carrier 并行；50 个 idle timer 同时武装、一次 advanceBy 齐发关闭）；
 * - SA7-C3 shutdown 与 50 个在途 open 竞态（已接纳槽按自身事实完整结算——非
 *   NOT_ACCEPTING；shutdown 等待 carrier tail 后关全部 Runtime）；
 * - SA7-C4 确定性三轮复跑：C2 场景 3 轮，canonical digest 逐字节一致。
 *
 * 补充用例登记（SA7 报告 §补充用例）：C1/C2/C3/C4。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import type { NamespaceRuntime, NamespaceRuntimeStatus } from '@nomicore/namespace-runtime';
import type { NamespaceLease } from '@nomicore/namespace-registry';
import { createNamespaceRegistryForTesting, createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import type { RegistryTestScheduler } from '@nomicore/namespace-registry/testing';
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

// ── 可控 Persistence / Runtime stub（沿用 registry-idle.test.ts 形态）─────────

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

/** Map 式 persistence：loadDoc 按需建 handle（计数按 key），可选共享 gate。 */
class MapPersistence implements DocPersistence {
  readonly loadCallsPerKey = new Map<string, number>();
  readonly handles = new Map<string, StubHandle>();
  saveCalls = 0;
  private sharedGate: Deferred | undefined;

  gateAllLoads(gate: Deferred): void {
    this.sharedGate = gate;
  }

  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    this.loadCallsPerKey.set(docId, (this.loadCallsPerKey.get(docId) ?? 0) + 1);
    if (this.sharedGate !== undefined) {
      await this.sharedGate.promise;
    }
    let handle = this.handles.get(docId);
    if (handle === undefined) {
      handle = new StubHandle(owner, docId);
      this.handles.set(docId, handle);
    }
    return handle;
  }

  async saveDoc(): Promise<void> {
    this.saveCalls += 1;
  }

  async createDoc(owner: User, docId: string): Promise<DocHandle> {
    const handle = new StubHandle(owner, docId);
    this.handles.set(docId, handle);
    return handle;
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

class CountingRuntime implements NamespaceRuntime {
  closeCalls = 0;
  readonly owner = Object.freeze({ userId: 'u-stress' });

  constructor(readonly marker: string, readonly namespaceId: string) {}

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

const KEYS = Array.from({ length: 50 }, (_, i) => `stress-ns-${i}`);
const KEY0 = KEYS[0] as string; // noUncheckedIndexedAccess 收窄（首 key 恒存在）

describe('SA7 并发压力（攻击面 2）：确定性、零 real sleep', () => {
  it('SA7-C1 单 key 100 次并发 open + 交错 release/重 open：单 Runtime 复用、部分释放不武装、终态恰一次 close', async () => {
    const probe = collectUnhandledRejections();
    try {
      const persistence = new MapPersistence();
      const scheduler = createRegistryTestScheduler();
      const observer = collectObserver();
      const shared = new CountingRuntime('R-stress', 'stress-ns-0');
      const registry = createNamespaceRegistryForTesting(persistence, {
        clock: manualClock(),
        scheduler,
        randomBytes: TEST_RANDOM_BYTES,
        idleTimeoutMs: 300_000,
        runtimeFactory: () => shared,
        observer: observer.sink,
      });

      // Phase 1：同 tick 100 次并发 open（carrier FIFO 串行化；首槽 loadDoc，其余复用）。
      const burst = Array.from({ length: 100 }, () => registry.open({ userId: 'u-stress' }, KEYS[0]!));
      const leases = (await Promise.all(burst)).map(okLease);
      expect(leases.length).toBe(100);
      expect(persistence.loadCallsPerKey.get(KEY0)).toBe(1); // 恰一次 loadDoc
      expect(shared.closeCalls).toBe(0);
      expect(scheduler.pending()).toBe(0); // 全部活跃：零 idle 武装

      // Phase 2：交错释放 50（仍有 50 活跃——不得武装 idle）+ 并发重 open 50。
      await Promise.all(leases.slice(0, 50).map((l) => l.release()));
      expect(scheduler.pending()).toBe(0);
      const reopens = Array.from({ length: 50 }, () => registry.open({ userId: 'u-stress' }, KEYS[0]!));
      const leases2 = (await Promise.all(reopens)).map(okLease);
      expect(persistence.loadCallsPerKey.get(KEY0)).toBe(1); // 复用，零新 loadDoc
      expect(scheduler.pending()).toBe(0);

      // Phase 3：全部释放（150 个 lease 中的剩余 100）→ 最后一个 release 武装 idle。
      await Promise.all([...leases.slice(50), ...leases2].map((l) => l.release()));
      expect(scheduler.pending()).toBe(1); // 恰一个 idle timer
      expect(shared.closeCalls).toBe(0);
      const idleEvents = observer.events.filter((e) => e.type === 'entry-idle');
      expect(idleEvents.length).toBe(1); // entry-idle 恰一次

      // Phase 4：完整窗口 → 恰一次 close；再 open 全新 loadDoc。
      await scheduler.advanceBy(300_000);
      await flushMicrotasks();
      expect(shared.closeCalls).toBe(1);
      expect(scheduler.pending()).toBe(0);
      const after = okLease(await registry.open({ userId: 'u-stress' }, KEYS[0]!));
      expect(after.getMetadata().marker).toBe('R-stress'); // 同一注入工厂 marker（共享 runtime 工厂形态）
      expect(persistence.loadCallsPerKey.get(KEY0)).toBe(2); // 新 generation 全新 loadDoc
      await after.release();
      await scheduler.advanceBy(300_000);
      await flushMicrotasks();
      expect(shared.closeCalls).toBe(2); // 第二代亦被 idle close
      await flushMicrotasks();
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]); // 零 unhandled rejection
    } finally {
      probe.dispose();
    }
  });

  it('SA7-C2 多 key（50）并行 open→release→idle→advance→close 全流程：每 key 独立 carrier、50 timer 齐发恰一次 close', async () => {
    const probe = collectUnhandledRejections();
    try {
      const persistence = new MapPersistence();
      const scheduler = createRegistryTestScheduler();
      const runtimes: CountingRuntime[] = [];
      const registry = createNamespaceRegistryForTesting(persistence, {
        clock: manualClock(),
        scheduler,
        randomBytes: TEST_RANDOM_BYTES,
        idleTimeoutMs: 300_000,
        runtimeFactory: (handle) => {
          const runtime = new CountingRuntime(`R-${handle.docId}`, handle.docId);
          runtimes.push(runtime);
          return runtime;
        },
      });

      // 50 key 并行 open（各自 carrier 并行推进）。
      const opens = KEYS.map((key) => registry.open({ userId: 'u-stress' }, key));
      const leases = (await Promise.all(opens)).map(okLease);
      expect(leases.length).toBe(50);
      for (const key of KEYS) {
        expect(persistence.loadCallsPerKey.get(key)).toBe(1);
      }
      expect(runtimes.length).toBe(50);
      expect(scheduler.pending()).toBe(0);

      // 交错释放（倒序——与 open 序相反，验证无次序依赖）。
      for (const lease of [...leases].reverse()) {
        await lease.release();
      }
      expect(scheduler.pending()).toBe(50); // 每 key 恰一个 idle timer

      // 一次 advanceBy 齐发 50 个到期回调 → 每 key 恰一次 close。
      await scheduler.advanceBy(300_000);
      await flushMicrotasks(60);
      expect(scheduler.pending()).toBe(0);
      for (const runtime of runtimes) {
        expect(runtime.closeCalls).toBe(1);
      }
      // 全部 entry 已清理：50 key 全部可重新 open（全新 generation + 全新 loadDoc）。
      const reopens = KEYS.map((key) => registry.open({ userId: 'u-stress' }, key));
      const leases2 = (await Promise.all(reopens)).map(okLease);
      for (const key of KEYS) {
        expect(persistence.loadCallsPerKey.get(key)).toBe(2);
      }
      expect(runtimes.length).toBe(100); // 第二代 50 个新 runtime
      await Promise.all(leases2.map((l) => l.release()));
      await scheduler.advanceBy(300_000);
      await flushMicrotasks(60);
      for (const runtime of runtimes) {
        expect(runtime.closeCalls).toBe(1); // 第二代 close 恰一次（前 50 个不再重复）
      }
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('SA7-C3 shutdown 与 50 个在途 open 竞态：已接纳槽完整结算（非 NOT_ACCEPTING）、全部 Runtime 被关闭、resolve undefined', async () => {
    const probe = collectUnhandledRejections();
    try {
      const persistence = new MapPersistence();
      const gate = deferred();
      persistence.gateAllLoads(gate); // 50 个 loadDoc 全部挂于共享 gate
      const scheduler = createRegistryTestScheduler();
      const runtimes: CountingRuntime[] = [];
      const registry = createNamespaceRegistryForTesting(persistence, {
        clock: manualClock(),
        scheduler,
        randomBytes: TEST_RANDOM_BYTES,
        idleTimeoutMs: 300_000,
        runtimeFactory: (handle) => {
          const runtime = new CountingRuntime(`R-${handle.docId}`, handle.docId);
          runtimes.push(runtime);
          return runtime;
        },
      });

      // 同 tick 50 个在途 open + 立即 shutdown（竞态窗口在 gate 期间）。
      const opens = KEYS.map((key) => registry.open({ userId: 'u-stress' }, key));
      const shutdownPromise = registry.shutdown();
      let shutdownSettled = false;
      void shutdownPromise.then(
        () => {
          shutdownSettled = true;
        },
        () => {
          shutdownSettled = true;
        },
      );
      await flushMicrotasks();
      expect(registry.getStatus()).toEqual({ state: 'shutting-down' });
      expect(shutdownSettled).toBe(false); // 在途槽未结算，shutdown 不 settle
      // 竞态窗口内的新 open 被拒（接纳门已关）。
      const late = await registry.open({ userId: 'u-stress' }, KEYS[0]!);
      expect(late).toMatchObject({ ok: false, code: 'REGISTRY_NOT_ACCEPTING' });

      gate.resolve(); // 放行 50 个 loadDoc
      const results = await Promise.all(opens);
      for (const result of results) {
        // 已接纳槽按自身事实完整结算：全部 ok（绝非 NOT_ACCEPTING / 折损）。
        expect(result, `在途 open 应完整结算：${JSON.stringify(result)}`).toMatchObject({ ok: true });
      }
      await shutdownPromise; // resolve undefined
      expect(registry.getStatus()).toEqual({ state: 'stopped' });
      expect(runtimes.length).toBe(50);
      for (const runtime of runtimes) {
        expect(runtime.closeCalls).toBe(1); // shutdown 关闭全部 50 个 Runtime
      }
      // 结算后重复调用幂等 same-Promise。
      expect(registry.shutdown()).toBe(shutdownPromise);
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('SA7-C4 确定性三轮复跑：50 key 全流程 digest 逐字节一致', async () => {
    const probe = collectUnhandledRejections();
    try {
      const digests: string[] = [];
      for (let round = 0; round < 3; round += 1) {
        const persistence = new MapPersistence();
        const scheduler: RegistryTestScheduler = createRegistryTestScheduler();
        const observer = collectObserver();
        const runtimes: CountingRuntime[] = [];
        const registry = createNamespaceRegistryForTesting(persistence, {
          clock: manualClock(),
          scheduler,
          randomBytes: TEST_RANDOM_BYTES,
          idleTimeoutMs: 300_000,
          runtimeFactory: (handle) => {
            const runtime = new CountingRuntime(`R-${handle.docId}`, handle.docId);
            runtimes.push(runtime);
            return runtime;
          },
          observer: observer.sink,
        });
        const opens = KEYS.map((key) => registry.open({ userId: 'u-stress' }, key));
        const leases = (await Promise.all(opens)).map(okLease);
        await Promise.all(leases.map((l) => l.release()));
        await scheduler.advanceBy(300_000);
        await flushMicrotasks(60);
        const reopens = KEYS.map((key) => registry.open({ userId: 'u-stress' }, key));
        const leases2 = (await Promise.all(reopens)).map(okLease);
        await Promise.all(leases2.map((l) => l.release()));
        await scheduler.advanceBy(300_000);
        await flushMicrotasks(60);

        // canonical digest：逐 key 载荷 + observer 事件类型全序（确定性指纹；不含轮次标签）。
        const lines: string[] = [];
        for (const key of KEYS) {
          const loads = persistence.loadCallsPerKey.get(key) ?? -1;
          const keyEvents = observer.events
            .filter((e) => e.identity?.namespaceId === key)
            .map((e) => e.type)
            .join(',');
          const handle = persistence.handles.get(key);
          lines.push(`${key}|loads=${loads}|release=${handle?.releaseCalls ?? -1}|events=[${keyEvents}]`);
        }
        lines.push(`closes=${runtimes.map((r) => r.closeCalls).join('')}`);
        digests.push(lines.join('\n'));
      }
      expect(digests[1]).toBe(digests[0]); // 逐字节一致
      expect(digests[2]).toBe(digests[0]);
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });
});

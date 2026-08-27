/**
 * SA6 红灯锚定 — issue #110：namespace-registry open 主链、唯一 Runtime、
 * 同键 lifecycle 串行、lease 全语义（设计 §9 测试矩阵）。
 *
 * 契约来源：wiki/raw/task_namespace-registry-open_design.md（冻结设计）§4/§5/§6/§7/§8。
 * 纪律：全部并发用 deferred gate + 显式 microtask settle，零 real sleep；
 * 公开文本零回显负锁；observer 收 exact cause/identity；observer throw 被隔离。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocLoadOperationalError, createMemoryPersistence } from '@nomicore/persistence';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import type {
  NamespaceRuntime,
  NamespaceRuntimeReadResult,
  NamespaceRuntimeStatus,
} from '@nomicore/namespace-runtime';
import {
  NamespaceLeaseReleasedError,
  NamespaceRegistryFatalError,
} from '@nomicore/namespace-registry';
import type {
  NamespaceLease,
  NamespaceOwner,
  NamespaceRegistry,
  OpenNamespaceResult,
} from '@nomicore/namespace-registry';
import { createNamespaceRegistryForTesting, createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import type { RegistryObserverEvent } from '../src/observer.js';

// ── 确定性并发原语（禁 real sleep）────────────────────────────────────────────
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * 显式微任务展开（禁 real sleep）。默认 12 层：覆盖开放链涉及的嵌套 promise 深度上界
 * （accept→slot→load gate→factory→entry→lease→cleanup 逐层微任务；任意断言前调用
 * 足够展开量即确定性——不依赖时间、不依赖具体调度器）。需要更多展开处显式传参。
 */
async function flushMicrotasks(times = 12): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

// #111 设计 §14：testing 工厂 Clock 必需化迁移——本文件全部 factory 调用注入
// 单一 manual Clock helper（固定 ms；open 路径不消费 Clock 值，零行为变化）。

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

function manualClock(): { now: () => number } {
  return { now: () => 1_700_000_123_456 };
}

// ── 可控 Persistence stub（deferred load gate / typed / unknown 注入）──────────

interface LoadPlan {
  gate?: { promise: Promise<void>; resolve: () => void };
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

/**
 * rev2 反馈 1 专用 handle：release() 永不 settle（既不 resolve 也不 reject）。
 * 实现若仍以 `await releaseHandleBestEffort(...)`（内部 `await handle.release()`）
 * 阻塞，open() 将永久挂起；配合「排空微任务 + setImmediate 宏任务后断言 settled」
 * 手法确定性判定「未永久挂起」（红灯证据为断言失败而非框架超时）。
 */
class NeverSettleStubHandle extends StubHandle {
  override release(): Promise<void> {
    this.releaseCalls += 1;
    return new Promise<void>(() => {}); // 永不 settle
  }
}

class StubPersistence implements DocPersistence {
  readonly loadCalls: Array<{ owner: User; docId: string }> = [];
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

  async createDoc(): Promise<DocHandle> {
    throw new Error('StubPersistence.createDoc 未在 open 路径使用');
  }
}

// ── 可控 Fake Runtime（capability 透传锚）────────────────────────────────────
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

function makeRuntime(overrides: {
  status?: () => NamespaceRuntimeStatus;
  read?: (path: readonly (string | number)[]) => NamespaceRuntimeReadResult;
  mutate?: () => Promise<{ ok: true } | { ok: false; issues: unknown[] }>;
  owner?: User;
  namespaceId?: string;
} = {}): NamespaceRuntime {
  return {
    owner: overrides.owner ?? { userId: 'runtime-owner' },
    namespaceId: overrides.namespaceId ?? 'runtime-ns',
    read: overrides.read ?? (() => ({ ok: true, value: 'runtime-value' })),
    getSchemaEnvelope: () => null,
    getMetadata: () => ({ marker: 'meta' }),
    getActiveSchema: () => null,
    getStatus: overrides.status ?? (() => READY_STATUS),
    mutateRoot: overrides.mutate ?? (async () => ({ ok: true })),
    replaceSchema: async () => ({ ok: true }),
    enableReplication: async () => ({ ok: true }),
    bumpReplicationEpoch: async () => ({ ok: true }),
    close: async () => {},
  };
}

function okLease(result: OpenNamespaceResult): NamespaceLease {
  expect(result.ok, `open 应成功，实际：${JSON.stringify(result)}`).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return result.lease;
}

describe('identity 分支（§4/§6.1）：最小安全规则 + 零访问', () => {
  it('namespaceId 非 primitive string 先短路：String object 与任何 owner trap 零执行、零 map/Persistence/factory', async () => {
    let ownerTrapCount = 0;
    const hostileOwner = new Proxy(
      {},
      {
        getPrototypeOf() {
          ownerTrapCount += 1;
          throw new Error('trap');
        },
      },
    );
    const persistence = new StubPersistence();
    let factoryCalls = 0;
    const diagnostics: unknown[] = [];
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES,
      runtimeFactory: () => {
        factoryCalls += 1;
        return makeRuntime();
      },
      diagnostics: (e) => {
        diagnostics.push(e);
      },
    });

    const result = await registry.open(hostileOwner as unknown as NamespaceOwner, new String('n1') as unknown as string);
    expect(result).toMatchObject({
      ok: false,
      code: 'NAMESPACE_INVALID_IDENTITY',
      field: 'namespaceId',
    });
    expect(ownerTrapCount).toBe(0); // typeof 短路在 owner 形状读取之前
    expect(persistence.loadCalls.length).toBe(0);
    expect(factoryCalls).toBe(0);
    expect(diagnostics.length).toBe(0);
  });

  it('null / 非对象 / 数组 / 继承型 / accessor / trap throw owner 全部 resolve invalid（零 map/Persistence/factory）', async () => {
    const cases: Array<{ owner: unknown; field: 'owner.userId' | 'namespaceId' }> = [
      { owner: null, field: 'owner.userId' },
      { owner: undefined, field: 'owner.userId' },
      { owner: 'str', field: 'owner.userId' },
      { owner: 42, field: 'owner.userId' },
      { owner: [], field: 'owner.userId' },
      {
        owner: new (class Inherited {
          userId = 'u';
        })(),
        field: 'owner.userId',
      },
      {
        owner: { get userId() { return 'u'; } },
        field: 'owner.userId',
      },
      {
        owner: new Proxy(
          { userId: 'u' },
          {
            getPrototypeOf() {
              throw new Error('proto trap');
            },
          },
        ),
        field: 'owner.userId',
      },
      {
        owner: new Proxy(
          { userId: 'u' },
          {
            getOwnPropertyDescriptor() {
              throw new Error('desc trap');
            },
          },
        ),
        field: 'owner.userId',
      },
      { owner: { userId: '' }, field: 'owner.userId' },
      { owner: { userId: '.' }, field: 'owner.userId' },
      { owner: { userId: '..' }, field: 'owner.userId' },
      { owner: { userId: 'a/b' }, field: 'owner.userId' },
      { owner: { userId: 'a\\b' }, field: 'owner.userId' },
      { owner: { userId: 'a\u0000b' }, field: 'owner.userId' },
      { owner: { userId: 'a\u001fb' }, field: 'owner.userId' },
      { owner: { userId: 'a\u007fb' }, field: 'owner.userId' },
      { owner: { userId: 'a\u009fb' }, field: 'owner.userId' },
    ];
    const persistence = new StubPersistence();
    let factoryCalls = 0;
    const diagnostics: unknown[] = [];
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES,
      runtimeFactory: () => {
        factoryCalls += 1;
        return makeRuntime();
      },
      diagnostics: (e) => {
        diagnostics.push(e);
      },
    });
    for (const c of cases) {
      const result = await registry.open(c.owner as never, 'n1');
      expect(result).toMatchObject({ ok: false, code: 'NAMESPACE_INVALID_IDENTITY', field: c.field });
      expect((result as unknown as { message: string }).message).toBe(
        'NAMESPACE_INVALID_IDENTITY: owner.userId 或 namespaceId 不符合安全文法',
      );
    }
    expect(persistence.loadCalls.length).toBe(0);
    expect(factoryCalls).toBe(0);
    expect(diagnostics.length).toBe(0);
  });

  it('invalid 不 reject、不 fatal：任意无效输入都是 resolve 的窄结果', async () => {
    const persistence = new StubPersistence();
    const registry = createNamespaceRegistryForTesting(persistence, { clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES });
    for (const bad of [undefined, null, {}, { userId: 5 }, { userId: {} }]) {
      const result = await registry.open(bad as never, 'ns');
      expect(result.ok).toBe(false);
    }
  });

  it('Unicode / 长字符串 / 含空格 identity 对 MemoryPersistence 全链路 round-trip open（N2 锚）', async () => {
    const persistence = createMemoryPersistence({
      scheduler: {
        setTimeout: () => 0,
        clearTimeout: () => {},
      },
    });
    const owner: User = {
      userId: '用 户 🚀🚀 user-id-with-1e2-length-padding-中文-空格 以及 very-long-'.padEnd(1400, 'x'),
    };
    const docId = 'namespace id with spaces 中文 🚀 and-a-very-long-'.padEnd(1100, 'y');
    expect(typeof owner.userId).toBe('string');
    expect(docId.length).toBeGreaterThan(1000); // 长字符串锚

    const doc = new Y.Doc();
    const sc = doc.getMap('SCHEMA');
    sc.set('lang', 'vfsl');
    sc.set('version', 1);
    sc.set('id', 'unicode-ns');
    sc.set('text', 'type ROOT = { n: number; };');
    doc.getMap('META').set('docId', docId);
    doc.getMap('ROOT').set('n', 42);
    const handle = await persistence.createDoc(owner, docId, doc);
    await persistence.saveDoc(handle);
    await handle.release();

    const registry = createNamespaceRegistryForTesting(persistence, { clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES });
    const result = await registry.open(owner, docId);
    const lease = okLease(result);
    expect(lease.namespaceId).toBe(docId);
    expect(lease.owner).toEqual({ userId: owner.userId });
    // 真实 Runtime 构造（生产内部 factory 默认路径）：read 对已提交 ROOT 可用
    expect(lease.read(['n'])).toEqual({ ok: true, value: 42 });
    await lease.release();
  });
});

describe('singleton / 并发 / 串行（§5/§6.2-§6.3）', () => {
  it('同 key 两个并发 open 仅 load/factory 一次、两个独立 lease', async () => {
    const persistence = new StubPersistence();
    const handle = new StubHandle({ userId: 'u' }, 'k');
    persistence.queueLoad({ result: handle });
    let factoryCalls = 0;
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES,
      runtimeFactory: (h, notifyDirty) => {
        factoryCalls += 1;
        expect(typeof h).toBe('object');
        expect(typeof notifyDirty).toBe('function');
        return makeRuntime({ owner: { userId: 'u' }, namespaceId: 'k' });
      },
    });
    const [a, b] = await Promise.all([registry.open({ userId: 'u' }, 'k'), registry.open({ userId: 'u' }, 'k')]);
    expect(persistence.loadCalls.length).toBe(1);
    expect(factoryCalls).toBe(1);
    const leaseA = okLease(a);
    const leaseB = okLease(b);
    expect(leaseA).not.toBe(leaseB);
    expect(factoryCalls).toBe(1);
    await leaseA.release();
    await leaseB.release();
  });

  it('同 key 同步接纳先后的两次 open：FIFO——第一个 slot 未结算前第二个 slot 不开始', async () => {
    const persistence = new StubPersistence();
    const gate1 = deferred();
    persistence.queueLoad({ gate: gate1, result: null });
    persistence.queueLoad({ result: new StubHandle({ userId: 'u' }, 'k') });
    const registry = createNamespaceRegistryForTesting(persistence, { clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES });
    const p1 = registry.open({ userId: 'u' }, 'k');
    await flushMicrotasks();
    const p2 = registry.open({ userId: 'u' }, 'k');
    expect(persistence.loadCalls.length).toBe(1); // slot2 尚未进入 load（同键串行）
    gate1.resolve();
    const r1 = await p1;
    expect(r1).toMatchObject({ ok: false, code: 'NAMESPACE_NOT_FOUND' });
    const r2 = await p2;
    expect(r2.ok).toBe(true);
    expect(persistence.loadCalls.length).toBe(2); // slot2 在 slot1 结算后独立执行
    await okLease(r2).release();
  });

  it('不同 key 不互相阻塞：k1 停在 gate 时 k2 已完整 open', async () => {
    const persistence = new StubPersistence();
    const gate1 = deferred();
    persistence.queueLoad({ gate: gate1, result: new StubHandle({ userId: 'u' }, 'k1') });
    persistence.queueLoad({ result: new StubHandle({ userId: 'u' }, 'k2') });
    const registry = createNamespaceRegistryForTesting(persistence, { clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES });
    const p1 = registry.open({ userId: 'u' }, 'k1');
    const p2 = registry.open({ userId: 'u' }, 'k2');
    await flushMicrotasks();
    expect(persistence.loadCalls.map((c) => c.docId)).toEqual(['k1', 'k2']); // 并行到 load
    const r2 = await p2;
    expect(okLease(r2).getStatus()).toMatchObject({ lease: 'active' });
    gate1.resolve();
    const r1 = await p1;
    expect(r1.ok).toBe(true);
    await okLease(r1).release();
    await okLease(r2).release();
  });

  it('同 key fail 后 retry 独立 load；slot rejection 不毒化 tail', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ error: new Error('unknown-load-boom') });
    persistence.queueLoad({ result: new StubHandle({ userId: 'u' }, 'k') });
    const registry = createNamespaceRegistryForTesting(persistence, { clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES });
    const p1 = registry.open({ userId: 'u' }, 'k');
    await expect(p1).rejects.toBeInstanceOf(NamespaceRegistryFatalError);
    const r2 = await registry.open({ userId: 'u' }, 'k');
    expect(r2.ok).toBe(true);
    expect(persistence.loadCalls.length).toBe(2);
    await okLease(r2).release();
  });
});

describe('carrier 清理与 ABA（§5）', () => {
  it('fail 后 diagnostics carrier-created/deleted 成对、generation 单调、无 orphan（null/typed/unknown 三类）', async () => {
    const persistence = new StubPersistence();
    // N=3 个 key、三种失败形态
    persistence.queueLoad({ result: null }); // k1 → NOT_FOUND
    persistence.queueLoad({ error: new DocLoadOperationalError(new Error('store-read-boom')) }); // k2 → LOAD_FAILED
    persistence.queueLoad({ error: new Error('unknown-boom') }); // k3 → fatal rejection
    const events: Array<{ type: string; keyDigest: string; generation: bigint }> = [];
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES,
      diagnostics: (e) => {
        events.push({ type: e.type, keyDigest: e.keyDigest, generation: e.generation });
      },
    });
    const o = { userId: 'carrier-user' };
    const r1 = await registry.open(o, 'k1');
    expect(r1).toMatchObject({ ok: false, code: 'NAMESPACE_NOT_FOUND' });
    const r2 = await registry.open(o, 'k2');
    expect(r2).toMatchObject({ ok: false, code: 'NAMESPACE_LOAD_FAILED' });
    await expect(registry.open(o, 'k3')).rejects.toBeInstanceOf(NamespaceRegistryFatalError);
    await flushMicrotasks();

    const created = new Map<string, bigint>();
    const deleted = new Map<string, bigint>();
    for (const e of events) {
      expect(e.keyDigest).toMatch(/^keydigest:v1:[0-9a-f]{16}$/);
      if (e.type === 'carrier-created') created.set(e.keyDigest, e.generation);
      else deleted.set(e.keyDigest, e.generation);
    }
    expect(created.size).toBe(3);
    expect(deleted.size).toBe(3);
    for (const [digest, gen] of created) {
      expect(deleted.get(digest), `carrier ${digest} 的 deleted 必须成对`).toBe(gen);
    }
    // generation 单调（事件序）
    const gens = events.map((e) => e.generation);
    for (let i = 1; i < gens.length; i += 1) {
      expect(gens[i]).toBeGreaterThanOrEqual(gens[i - 1] as bigint);
    }
  });

  it('cleanup microtask 前接纳第二个同 key slot：旧 cleanup 不删除新 tail/carrier（三守卫）', async () => {
    const persistence = new StubPersistence();
    const gate1 = deferred();
    persistence.queueLoad({ gate: gate1, result: null }); // slot1 → NOT_FOUND
    persistence.queueLoad({ result: new StubHandle({ userId: 'u' }, 'k') }); // slot2 → success
    const events: Array<{ type: string; keyDigest: string; generation: bigint }> = [];
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES,
      diagnostics: (e) => {
        events.push({ type: e.type, keyDigest: e.keyDigest, generation: e.generation });
      },
    });
    const p1 = registry.open({ userId: 'u' }, 'k');
    await flushMicrotasks();
    const p2 = registry.open({ userId: 'u' }, 'k'); // 在 slot1 cleanup 前接纳
    gate1.resolve();
    const r1 = await p1;
    expect(r1).toMatchObject({ ok: false, code: 'NAMESPACE_NOT_FOUND' });
    const r2 = await p2;
    expect(r2.ok).toBe(true);
    await flushMicrotasks();

    // slot2 成功建立 entry → 条件 (1) 失败 → carrier 保留（与 entry 共存，§5）
    expect(events.filter((e) => e.type === 'carrier-created').length).toBe(1);
    expect(events.filter((e) => e.type === 'carrier-deleted').length).toBe(0);
    await okLease(r2).release();
  });

  it('旧 carrier 删除后新 open 创建新 generation carrier（事件代际严格递增、成对）', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: null }); // 轮 1 → NOT_FOUND
    persistence.queueLoad({ result: null }); // 轮 2 → NOT_FOUND（新 carrier generation）
    const events: Array<{ type: string; keyDigest: string; generation: bigint }> = [];
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES,
      diagnostics: (e) => {
        events.push({ type: e.type, keyDigest: e.keyDigest, generation: e.generation });
      },
    });
    await registry.open({ userId: 'u' }, 'k');
    await flushMicrotasks();
    await registry.open({ userId: 'u' }, 'k');
    await flushMicrotasks();

    const created = events.filter((e) => e.type === 'carrier-created');
    const deleted = events.filter((e) => e.type === 'carrier-deleted');
    expect(created.length).toBe(2);
    expect(deleted.length).toBe(2);
    expect(created[1]!.generation).toBeGreaterThan(created[0]!.generation);
    // 代际成对（旧代 cleanup 只可能对旧代）
    for (const e of created) {
      expect(deleted.filter((d) => d.generation === e.generation).length).toBe(1);
    }
  });

  it('最后一个 lease 成功首次 release 后 entry 保留为 active：重开复用同一 Runtime（loadDoc 不再调用）', async () => {
    const persistence = new StubPersistence();
    const firstHandle = new StubHandle({ userId: 'u' }, 'k');
    persistence.queueLoad({ result: firstHandle });
    let factoryCalls = 0;
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES,
      runtimeFactory: () => {
        factoryCalls += 1;
        return makeRuntime({ owner: { userId: 'u' }, namespaceId: 'k' });
      },
    });
    const lease1 = okLease(await registry.open({ userId: 'u' }, 'k'));
    await lease1.release();
    expect(lease1.getStatus()).toMatchObject({ lease: 'released', runtime: null });
    // 同一 key 重开：不 load、不 factory——entry 保留、generation 不变（§1.2 切片语义）
    const lease2 = okLease(await registry.open({ userId: 'u' }, 'k'));
    expect(persistence.loadCalls.length).toBe(1);
    expect(factoryCalls).toBe(1);
    expect(lease2.getStatus()).toMatchObject({ lease: 'active' });
    expect(lease2).not.toBe(lease1);
    await lease2.release();
  });
});

describe('open 分支与 fatal 分类（§6.4-§6.7）', () => {
  it('loadDoc null → NAMESPACE_NOT_FOUND（不发 observer 失败事件）', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: null });
    const events: RegistryObserverEvent[] = [];
    const registry = createNamespaceRegistryForTesting(persistence, { clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES, observer: (e) => events.push(e) });
    const result = await registry.open({ userId: 'u' }, 'missing');
    expect(result).toMatchObject({
      ok: false,
      code: 'NAMESPACE_NOT_FOUND',
      message: 'NAMESPACE_NOT_FOUND: namespace 不存在',
    });
    expect(events.length).toBe(0);
  });

  it('DocLoadOperationalError → NAMESPACE_LOAD_FAILED 窄结果 + observer open-load-failed 带 exact cause', async () => {
    const persistence = new StubPersistence();
    const cause = new Error('store-read-failed-xxx');
    const typed = new DocLoadOperationalError(cause);
    persistence.queueLoad({ error: typed });
    const events: RegistryObserverEvent[] = [];
    const registry = createNamespaceRegistryForTesting(persistence, { clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES, observer: (e) => events.push(e) });
    const result = await registry.open({ userId: 'u' }, 'k');
    expect(result).toMatchObject({
      ok: false,
      code: 'NAMESPACE_LOAD_FAILED',
      message: 'NAMESPACE_LOAD_FAILED: namespace 持久化读取发生运营故障',
    });
    const ev = events.find((e) => e.type === 'open-load-failed');
    expect(ev).toBeDefined();
    if (ev?.type === 'open-load-failed') {
      expect(ev.cause).toBe(typed); // exact error（instance 级）
      expect(ev.identity.owner).toEqual({ userId: 'u' });
      expect(ev.identity.namespaceId).toBe('k');
      expect(typeof ev.identity.key).toBe('string');
    }
  });

  it('未知 load throw → NamespaceRegistryFatalError(open/lifecycle-slot-internal/false) + exact cause + lifecycle-slot-failed', async () => {
    const persistence = new StubPersistence();
    const boom = new Error('protocol-violation');
    persistence.queueLoad({ error: boom });
    const events: RegistryObserverEvent[] = [];
    const registry = createNamespaceRegistryForTesting(persistence, { clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES, observer: (e) => events.push(e) });
    const p = registry.open({ userId: 'u' }, 'k');
    await expect(p).rejects.toMatchObject({
      code: 'NAMESPACE_REGISTRY_FATAL',
      operation: 'open',
      phase: 'lifecycle-slot-internal',
      committed: false,
    });
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NamespaceRegistryFatalError);
    if (err instanceof NamespaceRegistryFatalError) {
      expect(err.cause).toBe(boom); // exact cause 保留供诊断
      expect(err.message).toBe(
        'NAMESPACE_REGISTRY_FATAL: open 在 lifecycle-slot-internal 发生内部故障（committed=false）',
      );
    }
    const ev = events.find((e) => e.type === 'lifecycle-slot-failed');
    expect(ev).toBeDefined();
    if (ev?.type === 'lifecycle-slot-failed') {
      expect(ev.cause).toBe(boom);
      expect(ev.operation).toBe('open');
    }
  });

  it('factory throw → handle.release 恰一次；release reject 与 observer throw 都不替换 runtime-construction fatal', async () => {
    const persistence = new StubPersistence();
    const handle = new StubHandle({ userId: 'u' }, 'k');
    persistence.queueLoad({ result: handle });
    const factoryCause = new Error('factory-boom');
    const events: RegistryObserverEvent[] = [];
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES,
      runtimeFactory: () => {
        throw factoryCause;
      },
      observer: (e) => {
        events.push(e);
        throw new Error('observer-boom'); // observer 自身 throw 必须被隔离
      },
    });
    const p = registry.open({ userId: 'u' }, 'k');
    await expect(p).rejects.toMatchObject({
      code: 'NAMESPACE_REGISTRY_FATAL',
      operation: 'open',
      phase: 'runtime-construction',
      committed: false,
    });
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NamespaceRegistryFatalError);
    if (err instanceof NamespaceRegistryFatalError) {
      expect(err.cause).toBe(factoryCause); // 主 fatal 保留 factory cause
      expect(err.message).toContain('runtime-construction');
      expect(err.message).not.toContain('factory-boom'); // 零回显
    }
    expect(handle.releaseCalls).toBe(1); // 恰一次
    // observer 收到 factory 事件（handle release 成功无失败事件）；自身 throw 未传播
    expect(events.some((e) => e.type === 'open-runtime-construction-failed')).toBe(true);
    expect(events.some((e) => e.type === 'handle-release-failed')).toBe(false);
  });

  it('factory throw 且 handle.release reject：release 恰一次、handle-release-failed 上报 exact cause、主 fatal 仍为 factory cause', async () => {
    const persistence = new StubPersistence();
    const releaseError = new Error('release-reject-boom');
    const handle = new StubHandle({ userId: 'u' }, 'k', releaseError);
    persistence.queueLoad({ result: handle });
    const factoryCause = new Error('factory-boom-2');
    const events: RegistryObserverEvent[] = [];
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES,
      runtimeFactory: () => {
        throw factoryCause;
      },
      observer: (e) => events.push(e),
    });
    const p = registry.open({ userId: 'u' }, 'k');
    await p.catch(() => {});
    expect(handle.releaseCalls).toBe(1);
    const releaseEv = events.find((e) => e.type === 'handle-release-failed');
    expect(releaseEv).toBeDefined();
    if (releaseEv?.type === 'handle-release-failed') {
      expect(releaseEv.cause).toBe(releaseError);
    }
    const factoryEv = events.find((e) => e.type === 'open-runtime-construction-failed');
    expect(factoryEv).toBeDefined();
    if (factoryEv?.type === 'open-runtime-construction-failed') {
      expect(factoryEv.cause).toBe(factoryCause);
    }
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NamespaceRegistryFatalError);
    if (err instanceof NamespaceRegistryFatalError) {
      expect(err.cause).toBe(factoryCause);
    }
  });

  it('factory throw 且 handle.release 永不 settle：open() 仍 reject 原 factory branded fatal（清理不阻塞交付）', async () => {
    const persistence = new StubPersistence();
    const handle = new NeverSettleStubHandle({ userId: 'u' }, 'k');
    persistence.queueLoad({ result: handle });
    const factoryCause = new Error('factory-boom-never-settle');
    const events: RegistryObserverEvent[] = [];
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES,
      runtimeFactory: () => {
        throw factoryCause;
      },
      observer: (e) => events.push(e),
    });

    const p = registry.open({ userId: 'u' }, 'k');
    let settled: 'pending' | 'resolved' | 'rejected' = 'pending';
    let outcome: unknown;
    void p.then(
      (v) => {
        settled = 'resolved';
        outcome = v;
      },
      (e) => {
        settled = 'rejected';
        outcome = e;
      },
    );

    // 确定性判定「未永久挂起」：排空全部微任务链 + 一个 setImmediate 宏任务后
    // 检查 settled 状态。若实现仍以 `await releaseHandleBestEffort(...)`（内部
    // `await handle.release()`）阻塞，open() 在此刻仍是 pending——断言失败即
    // 红灯证据（真实断言失败，不接受框架超时兜底）。
    await flushMicrotasks(20);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(
      settled,
      'handle.release() 永不 settle 时 open() 必须仍 settle 并 reject runtime-construction fatal，不得永久挂起',
    ).not.toBe('pending');
    expect(settled).toBe('rejected');
    expect(outcome).toBeInstanceOf(NamespaceRegistryFatalError);
    if (outcome instanceof NamespaceRegistryFatalError) {
      expect(outcome.operation).toBe('open');
      expect(outcome.phase).toBe('runtime-construction');
      expect(outcome.committed).toBe(false);
      expect(outcome.cause).toBe(factoryCause); // exact factory cause，未被 release 替换
      expect(outcome.message).not.toContain('factory-boom-never-settle'); // 零回显契约
    }
    expect(handle.releaseCalls).toBe(1); // release 仍恰调用一次
    const factoryEv = events.find((e) => e.type === 'open-runtime-construction-failed');
    expect(factoryEv).toBeDefined();
    if (factoryEv?.type === 'open-runtime-construction-failed') {
      expect(factoryEv.cause).toBe(factoryCause);
    }
  });

  it('getStatus 三相与 shutdown 真实语义：无 entry 时 shutdown resolve undefined、零 Persistence 访问（主断言在 registry-shutdown.test.ts）', async () => {
    // #112（设计 §2.D/§2.H）：shutdown 不再是 NAMESPACE_OPERATION_UNAVAILABLE 占位——
    // 首次调用同步段翻 acceptance、runShutdown 聚合关闭、空集群 resolve undefined。
    // 本文件只保留轻量回归锚（三相投影 + resolve undefined）；shutdown 主断言集
    // （等待结算/取消 idle timer/聚合 reject/幂等）由 registry-shutdown.test.ts 全量锚定。
    const persistence = new StubPersistence();
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES,
      runtimeFactory: () => {
        throw new Error('factory 不得被调用');
      },
    });
    expect(registry.getStatus()).toEqual({ state: 'running' });
    const p = registry.shutdown();
    // 首次 shutdown 同步段：acceptance 返回前已翻相（run-to-completion 内立即可观测）
    expect(registry.getStatus()).toEqual({ state: 'shutting-down' });
    await expect(p).resolves.toBeUndefined(); // Promise<void> 签名：空集群 resolve undefined
    expect(registry.getStatus()).toEqual({ state: 'stopped' }); // 终态
    expect(persistence.loadCalls.length).toBe(0);
    expect(persistence.saveCalls).toBe(0);
  });
});

describe('capability：fatal/unavailable/degraded Runtime 均可 open 并透传真实能力（§6/AC6）', () => {
  it('fatal runtime：open 成功，lease 透传 fatal 状态与读取', async () => {
    const runtimeStatus: NamespaceRuntimeStatus = {
      lifecycle: 'ready',
      read: { enabled: true },
      rootWrite: { enabled: false },
      schemaWrite: { enabled: false },
      schema: { state: 'unavailable', issue: { code: 'RUNTIME_SCHEMA_X', message: 'schema-unavailable-msg' } },
      fatal: { code: 'RUNTIME_FATAL', message: 'fatal-msg' },
      close: null,
      replication: { state: 'disabled' },
    };
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u' }, 'k') });
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES,
      runtimeFactory: () => makeRuntime({ status: () => runtimeStatus, read: () => ({ ok: true, value: 'still-readable' }) }),
    });
    const result = await registry.open({ userId: 'u' }, 'k');
    const lease = okLease(result);
    expect(lease.getStatus().lease).toBe('active');
    const projected = lease.getStatus();
    if (projected.lease === 'active') {
      expect(projected.runtime.fatal).toEqual({ code: 'RUNTIME_FATAL', message: 'fatal-msg' });
      expect(projected.runtime.rootWrite.enabled).toBe(false);
      expect(projected.runtime.schemaWrite.enabled).toBe(false);
      expect(projected.runtime.read.enabled).toBe(true);
    }
    expect(lease.read(['x'])).toEqual({ ok: true, value: 'still-readable' }); // 读取保留
    expect(lease.getActiveSchema()).toBeNull();
    await lease.release();
  });

  it('unavailable/degraded runtime：open 成功且 status 逐键透传', async () => {
    const degradedStatus: NamespaceRuntimeStatus = {
      lifecycle: 'ready',
      read: { enabled: true },
      rootWrite: { enabled: true },
      schemaWrite: { enabled: false },
      schema: { state: 'ready' },
      fatal: null,
      close: null,
      replication: { state: 'disabled' },
    };
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u' }, 'k') });
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES,
      runtimeFactory: () => makeRuntime({ status: () => degradedStatus }),
    });
    const lease = okLease(await registry.open({ userId: 'u' }, 'k'));
    const st = lease.getStatus();
    expect(st).toEqual({ lease: 'active', runtime: degradedStatus });
    await lease.release();
  });
});

describe('publish 时机：factory 返回即成功，不等待 P0（§6/AC4）', () => {
  it('P0 仍 deferred 时 open 已 resolve，lease read/status 立即可用', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u' }, 'k') });
    const p0Gate = deferred();
    let p0Resolved = false;
    void p0Gate.promise.then(() => {
      p0Resolved = true;
    });
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES,
      runtimeFactory: () =>
        makeRuntime({
          read: () => ({ ok: true, value: 'pre-p0-value' }),
          status: () => ({
            lifecycle: 'ready',
            read: { enabled: true },
            rootWrite: { enabled: true },
            schemaWrite: { enabled: true },
            schema: { state: 'preparing' },
            fatal: null,
            close: null,
            replication: { state: 'disabled' },
          }),
        }),
    });
    const result = await registry.open({ userId: 'u' }, 'k'); // factory 已返回；P0 未解
    expect(result.ok).toBe(true);
    expect(p0Resolved).toBe(false);
    const lease = okLease(result);
    expect(lease.getStatus()).toMatchObject({ lease: 'active' });
    const st = lease.getStatus();
    if (st.lease === 'active') {
      expect(st.runtime.schema.state).toBe('preparing'); // P0 未结算的忠实投影
    }
    expect(lease.read(['a'])).toEqual({ ok: true, value: 'pre-p0-value' });
    p0Gate.resolve();
    await lease.release();
  });
});

describe('lease 语义（§7 逐方法表格）', () => {
  async function makeLeasePair(): Promise<{
    lease: NamespaceLease;
    other: NamespaceLease;
    registry: NamespaceRegistry;
    persistence: StubPersistence;
  }> {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-alice' }, 'ns-1') });
    const registry = createNamespaceRegistryForTesting(persistence, { clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES });
    const a = okLease(await registry.open({ userId: 'u-alice' }, 'ns-1'));
    const b = okLease(await registry.open({ userId: 'u-alice' }, 'ns-1'));
    return { lease: a, other: b, registry, persistence };
  }

  it('owner 为冻结独立投影；lease 冻结；十二键面 + asyncDispose 键；不暴露 runtime/doc', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u-alice' }, 'ns-1') });
    const runtime = makeRuntime({ owner: { userId: 'runtime-owner-marker' }, namespaceId: 'runtime-ns' });
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES,
      runtimeFactory: () => runtime,
    });
    const lease = okLease(await registry.open({ userId: 'u-alice' }, 'ns-1'));
    expect(Object.isFrozen(lease)).toBe(true);
    expect(Object.isFrozen(lease.owner)).toBe(true);
    expect(lease.owner).toEqual({ userId: 'u-alice' });
    expect(lease.owner).not.toBe(runtime.owner); // 独立投影
    expect(lease.namespaceId).toBe('ns-1');
    expect(Object.keys(lease).sort()).toEqual(
      [
        'bumpReplicationEpoch',
        'enableReplication',
        'getActiveSchema',
        'getMetadata',
        'getSchemaEnvelope',
        'getStatus',
        'mutateRoot',
        'namespaceId',
        'owner',
        'read',
        'release',
        'replaceSchema',
      ].sort(),
    );
    expect(typeof (lease as unknown as Record<symbol, unknown>)[Symbol.asyncDispose as symbol]).toBe('function');
    expect('runtime' in lease).toBe(false);
    expect('doc' in lease).toBe(false);
    await lease.release();
  });

  it('active 期透传：read/三 getter/两写 delegate 到 Runtime', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u' }, 'k') });
    const calls: string[] = [];
    const runtime = makeRuntime({
      owner: { userId: 'u' },
      namespaceId: 'k',
      status: () => READY_STATUS,
      read: () => {
        calls.push('read');
        return { ok: false, code: 'PATH_NOT_ALLOWED', path: ['nope'] };
      },
      mutate: async () => {
        calls.push('mutate');
        return { ok: true };
      },
    });
    const registry = createNamespaceRegistryForTesting(persistence, { clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES, runtimeFactory: () => runtime });
    const lease = okLease(await registry.open({ userId: 'u' }, 'k'));
    expect(lease.read(['nope'])).toEqual({ ok: false, code: 'PATH_NOT_ALLOWED', path: ['nope'] });
    expect(lease.getSchemaEnvelope()).toBeNull();
    expect(lease.getMetadata()).toEqual({ marker: 'meta' });
    expect(lease.getActiveSchema()).toBeNull();
    await lease.mutateRoot({ op: 'set', path: ['a'], value: 1 });
    await lease.replaceSchema({ schema: { lang: 'vfsl', version: 1, id: 'a', text: 'type ROOT = { n: number; };' } });
    expect(calls).toEqual(['read', 'mutate']);
    await lease.release();
  });

  it('首次 release 同步失效：同步段后 status 已 released；重复 release / asyncDispose 同一 Promise', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u' }, 'k') });
    const events: RegistryObserverEvent[] = [];
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES,
      observer: (e) => events.push(e),
    });
    const lease = okLease(await registry.open({ userId: 'u' }, 'k'));
    const p1 = lease.release();
    // 同步段内（未 await）：released 已生效
    expect(lease.getStatus()).toEqual({ lease: 'released', runtime: null });
    const p2 = lease.release();
    expect(p2).toBe(p1); // exact same Promise
    const disposeKey = Symbol.asyncDispose as symbol;
    const p3 = (lease as unknown as Record<symbol, () => Promise<void>>)[disposeKey]!();
    expect(p3).toBe(p1);
    await p1;
    expect(lease.getStatus()).toEqual({ lease: 'released', runtime: null });
    const releasedEvent = events.find((e) => e.type === 'lease-released');
    expect(releasedEvent).toBeDefined();
    if (releasedEvent?.type === 'lease-released') {
      expect(releasedEvent.identity.namespaceId).toBe('k');
      expect(releasedEvent.remainingLeases).toBe(0);
      expect(typeof releasedEvent.generation).toBe('bigint');
    }
  });

  it('released 逐方法通道：read 同步 issue；三 getter 同步 throw 公开 NamespaceLeaseReleasedError；两写 resolve issue；status 唯一成功', async () => {
    const { lease, other } = await makeLeasePair();
    await lease.release();
    // read
    const readResult = lease.read(['x']);
    expect(readResult).toEqual({
      ok: false,
      code: 'NAMESPACE_LEASE_RELEASED',
      message: 'NAMESPACE_LEASE_RELEASED: 此 NamespaceLease 已 release，不能再接纳业务操作',
    });
    // 三投影 getter：同步 throw 且可由 instanceOf/code 判别
    for (const getter of ['getSchemaEnvelope', 'getMetadata', 'getActiveSchema'] as const) {
      let thrown: unknown;
      try {
        (lease as unknown as Record<string, () => unknown>)[getter]!();
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(NamespaceLeaseReleasedError);
      expect((thrown as { code?: unknown }).code).toBe('NAMESPACE_LEASE_RELEASED');
      if (thrown instanceof NamespaceLeaseReleasedError) {
        expect(thrown.message).toBe(
          'NAMESPACE_LEASE_RELEASED: 此 NamespaceLease 已 release，不能再接纳业务操作',
        );
      }
    }
    // 两写：Promise resolve，不 reject
    const m = await lease.mutateRoot({ op: 'set', path: ['a'], value: 1 });
    expect(m).toMatchObject({ ok: false, code: 'NAMESPACE_LEASE_RELEASED' });
    const s = await lease.replaceSchema({ schema: { lang: 'vfsl', version: 1, id: 'a', text: 't' } });
    expect(s).toMatchObject({ ok: false, code: 'NAMESPACE_LEASE_RELEASED' });
    // status 唯一成功
    expect(lease.getStatus()).toEqual({ lease: 'released', runtime: null });
    // 其他 lease 不受影响
    expect(other.getStatus()).toMatchObject({ lease: 'active' });
    await other.release();
  });

  it('多次 open 各自独立 lease：release 一个不影响另一个', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u' }, 'k') });
    const registry = createNamespaceRegistryForTesting(persistence, { clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES });
    const r1 = okLease(await registry.open({ userId: 'u' }, 'k'));
    const r2 = okLease(await registry.open({ userId: 'u' }, 'k'));
    expect(r1).not.toBe(r2);
    await r1.release();
    expect(r1.getStatus()).toMatchObject({ lease: 'released' });
    expect(r2.getStatus()).toMatchObject({ lease: 'active' });
    await r2.release();
  });

  it('release 不取消已接纳写（fake runtime 已接纳的 mutate 正常结算）', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ result: new StubHandle({ userId: 'u' }, 'k') });
    let settled = false;
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES,
      runtimeFactory: () =>
        makeRuntime({
          mutate: async () => {
            await flushMicrotasks();
            settled = true;
            return { ok: true };
          },
        }),
    });
    const lease = okLease(await registry.open({ userId: 'u' }, 'k'));
    const write = lease.mutateRoot({ op: 'set', path: ['a'], value: 1 }); // release 前已接纳
    await lease.release();
    const result = await write;
    expect(result).toEqual({ ok: true });
    expect(settled).toBe(true);
  });
});

describe('observer 隔离与公开文本零回显（§8/AC11）', () => {
  it('observer throw 被隔离：typed load 仍返回窄 issue、后续 open 正常、无二次污染', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ error: new DocLoadOperationalError(new Error('x')) });
    persistence.queueLoad({ result: new StubHandle({ userId: 'u' }, 'k') });
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES,
      observer: () => {
        throw new Error('observer-isolated');
      },
    });
    const r1 = await registry.open({ userId: 'u' }, 'k');
    expect(r1).toMatchObject({ ok: false, code: 'NAMESPACE_LOAD_FAILED' });
    const r2 = await registry.open({ userId: 'u' }, 'k');
    expect(r2.ok).toBe(true);
    await okLease(r2).release();
  });

  it('公开文本/JSON 零回显：identity、schema/root、cause/stack 均不出现在任何 public message 中', async () => {
    const sentinelOwner = 'SENTINEL_OWNER_9f3a';
    const sentinelNs = 'SENTINEL_NS_9f3a';
    const sentinelCause = 'SENTINEL_CAUSE_9f3a';
    const sentinelSchema = 'SENTINEL_SCHEMA_9f3a';
    const sentinelRoot = 'SENTINEL_ROOT_9f3a';
    const persistence = new StubPersistence();
    persistence.queueLoad({ error: new DocLoadOperationalError(new Error(sentinelCause)) });
    persistence.queueLoad({ result: null });
    const events: RegistryObserverEvent[] = [];
    const diagnostics: unknown[] = [];
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES,
      observer: (e) => events.push(e),
      diagnostics: (e) => diagnostics.push(e),
    });
    const owner = { userId: sentinelOwner };
    const publicTexts: string[] = [];
    // invalid
    const invalid = await registry.open({ userId: `${sentinelOwner}/bad` }, sentinelNs);
    publicTexts.push(JSON.stringify(invalid));
    // load failed（typed）
    const loadFailed = await registry.open(owner, `${sentinelNs}-1`);
    publicTexts.push(JSON.stringify(loadFailed));
    // not found
    const notFound = await registry.open(owner, `${sentinelNs}-2`);
    publicTexts.push(JSON.stringify(notFound));
    // fatal（unknown load）
    persistence.queueLoad({ error: new Error(sentinelCause) });
    const fatal = await registry.open(owner, `${sentinelNs}-3`).then(
      () => null,
      (e: unknown) => e,
    );
    publicTexts.push(JSON.stringify(fatal));
    if (fatal instanceof NamespaceRegistryFatalError) {
      publicTexts.push(fatal.message);
    }
    // released issue
    persistence.queueLoad({ result: new StubHandle(owner, `${sentinelNs}-4`) });
    const lease = okLease(await registry.open(owner, `${sentinelNs}-4`));
    await lease.release();
    publicTexts.push(JSON.stringify(lease.read(['x'])));
    try {
      lease.getMetadata();
    } catch (e) {
      publicTexts.push(JSON.stringify(e));
    }
    // create（#111：缺 owner/namespaceId → NAMESPACE_INVALID_IDENTITY 恒定 message，
    // 零回显不变）。缺键敌意输入经 `as never`（typed 签名下）
    publicTexts.push(JSON.stringify(await registry.create({ schema: sentinelSchema, root: sentinelRoot } as never)));
    // shutdown（#112 真实语义）：resolve undefined + getStatus stopped 两断言，**零
    // JSON.stringify 入 publicTexts**（M4 精确化：undefined 的 stringify 破坏 sentinel
    // 循环；shutdown 零回显负锁由 shutdown 侧专测对 NamespaceRegistryShutdownError.
    // message 恒定常量断言承载——见 registry-shutdown.test.ts 测试 19）。
    await expect(registry.shutdown()).resolves.toBeUndefined();
    expect(registry.getStatus()).toEqual({ state: 'stopped' });
    publicTexts.push(JSON.stringify(registry.getStatus()));
    publicTexts.push(JSON.stringify(lease.getStatus()));

    for (const text of publicTexts) {
      expect(text).not.toContain(sentinelOwner);
      expect(text).not.toContain(sentinelNs);
      expect(text).not.toContain(sentinelCause);
      expect(text).not.toContain(sentinelSchema);
      expect(text).not.toContain(sentinelRoot);
    }
    // observer 侧在同一 sentinel cause/identity 下收到结构化事件（内部诊断面不受零回显约束）
    const ev = events.find((e) => e.type === 'open-load-failed');
    expect(ev).toBeDefined();
    if (ev?.type === 'open-load-failed') {
      // exact DocLoadOperationalError 实例；其 inner cause 保留 sentinel 原文
      const inner = (ev.cause as { cause?: unknown }).cause as Error | undefined;
      expect(inner?.message).toContain(sentinelCause);
      expect(ev.identity.namespaceId).toContain(sentinelNs);
    }
    // diagnostics token 不含 raw identity
    const jsonOf = (value: unknown): string =>
      JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v));
    for (const d of diagnostics) {
      expect(jsonOf(d)).not.toContain(sentinelOwner);
      expect(jsonOf(d)).not.toContain(sentinelNs);
    }
  });
});

describe('observer reentrancy（SA4 非阻断建议落实）：observer 内同步对同 key 再 open', () => {
  it('typed load observer 内同步 reentrant open：严格 FIFO、独立 load、不破坏 carrier/entry 状态', async () => {
    const persistence = new StubPersistence();
    const gate2 = deferred();
    persistence.queueLoad({ error: new DocLoadOperationalError(new Error('typed-reentrant')) }); // slot1 → LOAD_FAILED
    persistence.queueLoad({ gate: gate2, result: new StubHandle({ userId: 'u' }, 'k') }); // slot2 → success
    const diagnostics: Array<{ type: string; keyDigest: string; generation: bigint }> = [];
    let reentrant: Promise<OpenNamespaceResult> | undefined;
    let loadCallsAtObserverTime = -1;
    let reentrantSettledInObserverStack = true;
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES,
      observer: (e) => {
        if (e.type === 'open-load-failed') {
          // 同步栈内（slot1 尚未返回）：记录 load 计数并同步 reentrant open 同 key
          loadCallsAtObserverTime = persistence.loadCalls.length;
          reentrant = registry.open({ userId: 'u' }, 'k');
          let settled = false;
          void reentrant.then(
            () => {
              settled = true;
            },
            () => {
              settled = true;
            },
          );
          reentrantSettledInObserverStack = settled; // 同步栈内捕获：只排队、未结算
        }
      },
      diagnostics: (e) => diagnostics.push({ type: e.type, keyDigest: e.keyDigest, generation: e.generation }),
    });

    const r1 = await registry.open({ userId: 'u' }, 'k');
    expect(r1).toMatchObject({ ok: false, code: 'NAMESPACE_LOAD_FAILED' });

    // FIFO：observer 同步栈内 reentrant open 只是排队——slot1 的 load 是唯一记录，
    // reentrant 的 slot2 未开始、未结算（没有插队）。
    expect(loadCallsAtObserverTime).toBe(1);
    expect(reentrantSettledInObserverStack).toBe(false);
    expect(reentrant).toBeDefined();
    // slot1 结算后 slot2 独立执行（停在 gate2 上）
    await flushMicrotasks();
    expect(persistence.loadCalls.length).toBe(2);
    // gate2 解 → slot2 成功：entry 建立、lease 独立、tail 未被 slot1 窄 issue 毒化
    gate2.resolve();
    const r2 = await reentrant!;
    expect(r2.ok).toBe(true);
    const lease = okLease(r2);
    expect(lease.getStatus()).toMatchObject({ lease: 'active' });
    await lease.release();
    // carrier/entry 不破坏：同 key 共用同一 carrier generation 一次创建；
    // slot2 成功 → 条件(1) 不满足 → carrier 与 entry 共存（deleted 0）
    expect(diagnostics.filter((d) => d.type === 'carrier-created').length).toBe(1);
    expect(diagnostics.filter((d) => d.type === 'carrier-deleted').length).toBe(0);
    // 事后重开仍复用 entry：load 不再发生
    const r3 = okLease(await registry.open({ userId: 'u' }, 'k'));
    expect(persistence.loadCalls.length).toBe(2);
    await r3.release();
  });

  it('fatal observer 内同步 reentrant open：fatal rejection 不毒化同 key tail', async () => {
    const persistence = new StubPersistence();
    persistence.queueLoad({ error: new Error('reentrant-fatal') }); // slot1 → unknown fatal rejection
    persistence.queueLoad({ result: new StubHandle({ userId: 'u' }, 'k') }); // slot2 → success
    const diagnostics: Array<{ type: string; keyDigest: string; generation: bigint }> = [];
    let reentrant: Promise<OpenNamespaceResult> | undefined;
    let reentrantSettledInObserverStack = true;
    const registry = createNamespaceRegistryForTesting(persistence, {
      clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES,
      observer: (e) => {
        if (e.type === 'lifecycle-slot-failed') {
          reentrant = registry.open({ userId: 'u' }, 'k');
          let settled = false;
          void reentrant.then(
            () => {
              settled = true;
            },
            () => {
              settled = true;
            },
          );
          reentrantSettledInObserverStack = settled; // 同步栈内捕获：只排队、未结算
        }
      },
      diagnostics: (e) => diagnostics.push({ type: e.type, keyDigest: e.keyDigest, generation: e.generation }),
    });

    const p1 = registry.open({ userId: 'u' }, 'k');
    await expect(p1).rejects.toBeInstanceOf(NamespaceRegistryFatalError);
    // 同步栈内：slot1 尚未 reject，reentrant 只排队（插队会被此断言与 load 计数捕获）
    expect(reentrantSettledInObserverStack).toBe(false);
    await flushMicrotasks();
    expect(persistence.loadCalls.length).toBe(2); // slot2 独立 load 已发生
    const r2 = await reentrant!;
    expect(r2.ok).toBe(true); // fatal 之后的 tail 依然绿、slot2 正常结算
    await okLease(r2).release();
    // 二者共用同一 carrier generation：fatal 未产生 orphan carrier
    expect(diagnostics.filter((d) => d.type === 'carrier-created').length).toBe(1);
    expect(diagnostics.filter((d) => d.type === 'carrier-deleted').length).toBe(0);
  });
});

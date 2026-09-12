/**
 * issue #336（ADR-0024 T3）registry lease 预算 options 原样透传 —— **红灯**（设计 §12-T5）。
 *
 * 红灯机理：当前 `lease.readData(path)` 单参、无 options 透传（lease.ts L276–279）——
 * 捕获 stub 断言「第二参同一引用」在 `undefined` 处红；真实装配五键断言在
 * `truncated`/`truncations` 处红。
 *
 * 契约面：
 * 1. active 期 `lease.readData(path, opts)` → runtime 收到**同一引用**（raw 直传：零复制、
 *    零净化上移、零预算解释）；敌意 options 构造器直传亦然（lease 层零触达敌意 trap）；
 * 2. released 短路先于一切透传（`NAMESPACE_LEASE_RELEASED` 冻结 issue 原样，含带 options 调用）；
 * 3. 单参 `lease.readData(path)` 仍走 legacy 通道（第二参未传）；
 * 4. 真实装配（production runtime factory 路径）：lease 预算结果与 runtime 直调逐字段相等。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import type {
  NamespaceRuntime,
  NamespaceRuntimeReadDataResult,
  NamespaceRuntimeStatus,
} from '@nomicore/namespace-runtime';
import type { NamespaceLease, NamespaceLeaseReadDataBudgetResult } from '@nomicore/namespace-registry';
import { createNamespaceRegistryForTesting, createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import { readDataOk, expectReadDataOkKeys } from '../../namespace-runtime/test/helpers/readdata-ok-shape.js';
import {
  TXT_336,
  createBudgetRuntimeFromHandle,
  seedStrictRoot,
  waitForSchemaReady,
} from '../../namespace-runtime/test/runtime-readdata-shape-budget-fixture.js';

// ── 确定性装配（沿 registry-open/ddocs-sync 先例：manual clock + test scheduler + 受控随机源）──

function manualClock(): { now: () => number } {
  return { now: () => 1_700_000_123_456 };
}

let randomCounter = 0;
function deterministicRandomBytes(length: number): Uint8Array {
  randomCounter += 1;
  const hex = randomCounter.toString(16).padStart(32, '0');
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = Number.parseInt(hex.slice((i % 16) * 2, (i % 16) * 2 + 2), 16);
  }
  return out;
}

class StubHandle implements DocHandle {
  readonly doc: Y.Doc;

  constructor(readonly owner: User, readonly docId: string) {
    const doc = new Y.Doc();
    doc.getMap('SCHEMA').set('lang', 'vfsl');
    doc.getMap('SCHEMA').set('version', 1);
    doc.getMap('SCHEMA').set('id', 'ns-336');
    doc.getMap('SCHEMA').set('text', TXT_336);
    doc.getMap('META').set('docId', docId);
    doc.getMap('META').set('createdAt', 1_700_000_000_000);
    seedStrictRoot(doc.getMap('ROOT'));
    this.doc = doc;
  }

  getStatus(): 'ready' {
    return 'ready';
  }

  release(): Promise<void> {
    return Promise.resolve();
  }
}

class StubPersistence implements DocPersistence {
  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    return new StubHandle(owner, docId);
  }

  async saveDoc(): Promise<void> {}

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
  replication: { state: 'disabled' },
};

interface ReadCall {
  readonly path: unknown;
  readonly options: unknown;
  readonly argc: number;
}

/** 记录型 fake runtime：捕获 readData 实参（引用同一性锚）+ 固定返回面。 */
function makeRecordingRuntime(): {
  readonly runtime: NamespaceRuntime;
  readonly calls: ReadCall[];
  readonly result: NamespaceRuntimeReadDataResult;
} {
  const calls: ReadCall[] = [];
  const result: NamespaceRuntimeReadDataResult = readDataOk('runtime-value', null);
  const runtime: NamespaceRuntime = {
    owner: { userId: 'runtime-owner' },
    namespaceId: 'runtime-ns',
    readData: (...args: unknown[]): NamespaceRuntimeReadDataResult => {
      calls.push({ path: args[0], options: args[1], argc: args.length });
      return result;
    },
    getSchema: () => null,
    getMetadata: () => ({ marker: 'meta' }),
    getActiveSchema: () => null,
    getStatus: () => READY_STATUS,
    mutateData: async () => ({ ok: true }),
    replaceSchema: async () => ({ ok: true }),
    enableReplication: async () => ({ ok: true }),
    bumpReplicationEpoch: async () => ({ ok: true }),
    close: async () => {},
  };
  return { runtime, calls, result };
}

async function openLease(runtimeFactory?: (handle: DocHandle) => NamespaceRuntime): Promise<NamespaceLease> {
  const registry = createNamespaceRegistryForTesting(new StubPersistence(), {
    clock: manualClock(),
    scheduler: createRegistryTestScheduler(),
    randomBytes: deterministicRandomBytes,
    ...(runtimeFactory !== undefined ? { runtimeFactory } : {}),
  });
  const opened = await registry.open({ userId: 'u-336' }, 'ns-336');
  expect(opened.ok, `open 应成功：${JSON.stringify(opened)}`).toBe(true);
  if (!opened.ok) throw new Error('unreachable');
  return opened.lease;
}

describe('lease 预算 options 原样透传（active 期 raw 引用直传）', () => {
  it('active 期 lease.readData(path, opts) → runtime 收到同一 path/options 引用（零复制、零 lease 层解释）', async () => {
    const recording = makeRecordingRuntime();
    const lease = await openLease(() => recording.runtime);
    const path = ['meta'];
    const opts = { depth: 1 };
    const r = lease.readData(path, opts);
    expect(r).toBe(recording.result); // 结果逐字段直传（同一对象）
    expect(recording.calls).toHaveLength(1);
    expect(recording.calls[0]!.argc).toBe(2);
    expect(recording.calls[0]!.path).toBe(path); // 引用同一性（无复制）
    expect(recording.calls[0]!.options).toBe(opts); // 原样透传锚
    await lease.release();
  });

  it('单参 lease.readData(path)：仍走 legacy 通道（runtime 未收到第二实参）', async () => {
    const recording = makeRecordingRuntime();
    const lease = await openLease(() => recording.runtime);
    const path = ['meta'];
    lease.readData(path);
    expect(recording.calls).toHaveLength(1);
    expect(recording.calls[0]!.argc).toBe(1);
    expect(recording.calls[0]!.options).toBeUndefined();
    await lease.release();
  });

  it('敌意 options 构造器直传：lease 层零触达（get trap 零执行）、同一引用到达 runtime', async () => {
    const recording = makeRecordingRuntime();
    const lease = await openLease(() => recording.runtime);
    let trapCalls = 0;
    const hostile = new Proxy(
      { depth: 1 },
      {
        get(target, key, receiver) {
          trapCalls += 1;
          return Reflect.get(target, key, receiver);
        },
      },
    );
    lease.readData(['meta'], hostile);
    expect(trapCalls).toBe(0); // lease 层零预算解释/零探测
    expect(recording.calls[0]!.options).toBe(hostile);
    await lease.release();
  });

  it('released 短路先于一切透传：带 options 调用同样返回冻结 released issue，零 runtime 触达', async () => {
    const recording = makeRecordingRuntime();
    const lease = await openLease(() => recording.runtime);
    await lease.release();
    const r = lease.readData(['meta'], { depth: 1 });
    expect(r.ok).toBe(false);
    expect((r as { code: string }).code).toBe('NAMESPACE_LEASE_RELEASED');
    expect(Object.keys(r).sort()).toStrictEqual(['code', 'message', 'ok']);
    expect(recording.calls).toHaveLength(0); // released 先于透传
    const again = lease.readData(['meta'], { depth: 1 });
    expect(again).toBe(r); // 冻结单例原文
  });
});

describe('真实装配：lease 预算读与 runtime 直调逐字段相等（production factory 路径）', () => {
  it('lease.readData([], {depth:1}) 五键 + 截断事实 ≡ runtime.readData([], {depth:1})', async () => {
    let realRuntime: NamespaceRuntime | undefined;
    const lease = await openLease((handle) => {
      realRuntime = createBudgetRuntimeFromHandle(handle);
      return realRuntime;
    });
    if (realRuntime === undefined) throw new Error('契约前提失败：runtimeFactory 未被调用');
    await waitForSchemaReady(realRuntime);

    const viaLease = lease.readData([], { depth: 1 }) as NamespaceLeaseReadDataBudgetResult;
    const direct = realRuntime.readData([], { depth: 1 });
    expect(viaLease).toStrictEqual(direct);
    expectReadDataOkKeys(viaLease);
    if (!viaLease.ok) throw new Error(`契约前提失败：${JSON.stringify(viaLease)}`);
    expect(viaLease.truncated).toBe(true);
    expect(viaLease.truncations.length).toBeGreaterThan(0);
    await lease.release();
  });
});

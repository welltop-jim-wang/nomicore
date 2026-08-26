/**
 * SA6 红灯锚定 — issue #110：Node 20/24 对 `await using lease` 做实际 dispose
 * （设计 §9 node 行；§7 asyncDispose 委托 release）。
 *
 * 语言级 `await using` 与 Symbol.asyncDispose 都是 Node 20/24 CI 的硬门禁：
 * driver 经 new Function 编译，任一能力缺失均使测试响亮失败而不是 skip。
 * 断言的是真实 dispose 机器语义（块退出时调用 lease 的 asyncDispose 并把 lease
 * 置 released），非仅 type test。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import type { NamespaceLease } from '@nomicore/namespace-registry';
import { createNamespaceRegistryForTesting, createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';

// #111 设计 §14：testing 工厂 Clock 必需化迁移——本文件唯一 factory 调用注入
// 单一 manual Clock helper（固定 ms；open 路径不消费 Clock 值，零行为变化）。
function manualClock(): { now: () => number } {
  return { now: () => 1_700_000_123_456 };
}

const hasAsyncDisposeSymbol =
  typeof (Symbol as unknown as { asyncDispose?: unknown }).asyncDispose === 'symbol';

/** 语言级 await using driver：new Function 编译（语法不可用 → undefined → skip）。 */
const awaitUsingDriver: ((lease: NamespaceLease) => Promise<void>) | undefined = (() => {
  try {
    const fn = new Function(
      'return async function (lease) { await using x = lease; void x; };',
    )() as (lease: NamespaceLease) => Promise<void>;
    return fn;
  } catch {
    return undefined;
  }
})();

const awaitUsingThrowDriver: ((lease: NamespaceLease) => Promise<void>) | undefined = (() => {
  try {
    const fn = new Function(
      'return async function (lease) { await using x = lease; void x; throw new Error("boom-in-block"); };',
    )() as (lease: NamespaceLease) => Promise<void>;
    return fn;
  } catch {
    return undefined;
  }
})();

const run = (name: string, fn: () => void | Promise<void>): void => {
  it(name, async () => {
    expect(hasAsyncDisposeSymbol, 'Node must provide Symbol.asyncDispose').toBe(true);
    expect(awaitUsingDriver, 'Node must parse await using').toBeDefined();
    expect(awaitUsingThrowDriver, 'Node must parse await using in the throw-path driver').toBeDefined();
    await fn();
  });
};

class StubHandle implements DocHandle {
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
    return Promise.resolve();
  }
}

class StubPersistence implements DocPersistence {
  private consumed = false;
  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    if (this.consumed) return null;
    this.consumed = true;
    return new StubHandle(owner, docId);
  }
  async saveDoc(): Promise<void> {}
  async createDoc(): Promise<DocHandle> {
    throw new Error('unused');
  }
}

async function makeLease(): Promise<NamespaceLease> {
  const persistence = new StubPersistence();
  const registry = createNamespaceRegistryForTesting(persistence, { clock: manualClock(), scheduler: createRegistryTestScheduler() });
  const result = await registry.open({ userId: 'dispose-user' }, 'dispose-ns');
  if (!result.ok) {
    throw new Error('open 应成功');
  }
  return result.lease;
}

describe('Node runtime：await using lease 实际 dispose（§7/§9）', () => {
  run('await using 块正常退出 → lease 已 release（asyncDispose 委托 release）', async () => {
    const lease = await makeLease();
    expect(lease.getStatus()).toMatchObject({ lease: 'active' });
    await awaitUsingDriver?.(lease);
    // 块退出即实际调用 asyncDispose —— lease 同步失效（released）
    expect(lease.getStatus()).toEqual({ lease: 'released', runtime: null });
    expect(lease.read(['x'])).toMatchObject({ ok: false, code: 'NAMESPACE_LEASE_RELEASED' });
    const again = lease.release();
    const first = lease[Symbol.asyncDispose]!;
    expect(again).toBe(first());
  });

  run('await using 块内 throw 也完成 dispose（异常路径不跳过释放）', async () => {
    const lease = await makeLease();
    await expect(awaitUsingThrowDriver?.(lease)).rejects.toThrow('boom-in-block');
    expect(lease.getStatus()).toEqual({ lease: 'released', runtime: null });
  });
});

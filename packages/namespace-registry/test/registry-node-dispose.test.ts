/**
 * SA6 红灯锚定 — issue #110：Node 20/24 对 `await using lease` 做实际 dispose
 * （设计 §9 node 行；§7 asyncDispose 委托 release）。
 *
 * `await using` 由仓库 TypeScript 编译为 Node 20/24 均可执行的 helper；
 * Symbol.asyncDispose 与编译后行为都是硬门禁，不条件 skip。
 * 断言的是真实 dispose 机器语义（块退出时调用 lease 的 asyncDispose 并把 lease
 * 置 released），非仅 type test。
 */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import * as Y from 'yjs';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import type { NamespaceLease } from '@nomicore/namespace-registry';
import { createNamespaceRegistryForTesting, createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';


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

// #111 设计 §14：testing 工厂 Clock 必需化迁移——本文件唯一 factory 调用注入
// 单一 manual Clock helper（固定 ms；open 路径不消费 Clock 值，零行为变化）。
function manualClock(): { now: () => number } {
  return { now: () => 1_700_000_123_456 };
}

const hasAsyncDisposeSymbol =
  typeof (Symbol as unknown as { asyncDispose?: unknown }).asyncDispose === 'symbol';

/** Compile real TypeScript `await using` syntax to portable disposal helpers. */
function compileAwaitUsingDriver(body: string): (lease: NamespaceLease) => Promise<void> {
  const output = ts.transpileModule(
    `export async function run(lease: any) { await using x = lease; void x; ${body} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const exports = {} as { run?: (lease: NamespaceLease) => Promise<void> };
  new Function('exports', output)(exports);
  if (exports.run === undefined) throw new Error('TypeScript did not emit await-using driver');
  return exports.run;
}

const awaitUsingDriver = compileAwaitUsingDriver('');
const awaitUsingThrowDriver = compileAwaitUsingDriver('throw new Error("boom-in-block");');

const run = (name: string, fn: () => void | Promise<void>): void => {
  it(name, async () => {
    expect(hasAsyncDisposeSymbol, 'Node must provide Symbol.asyncDispose').toBe(true);
    expect(awaitUsingDriver).toBeTypeOf('function');
    expect(awaitUsingThrowDriver).toBeTypeOf('function');
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
  const registry = createNamespaceRegistryForTesting(persistence, { clock: manualClock(), scheduler: createRegistryTestScheduler(), randomBytes: TEST_RANDOM_BYTES });
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
    await awaitUsingDriver(lease);
    // 块退出即实际调用 asyncDispose —— lease 同步失效（released）
    expect(lease.getStatus()).toEqual({ lease: 'released', runtime: null });
    expect(lease.readData(['x'])).toMatchObject({ ok: false, code: 'NAMESPACE_LEASE_RELEASED' });
    const again = lease.release();
    const first = lease[Symbol.asyncDispose]!;
    expect(again).toBe(first());
  });

  run('await using 块内 throw 也完成 dispose（异常路径不跳过释放）', async () => {
    const lease = await makeLease();
    await expect(awaitUsingThrowDriver(lease)).rejects.toThrow('boom-in-block');
    expect(lease.getStatus()).toEqual({ lease: 'released', runtime: null });
  });
});

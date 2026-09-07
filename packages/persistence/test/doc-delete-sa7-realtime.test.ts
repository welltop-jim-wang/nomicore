/**
 * issue #228 — SA7 动态验证（SA4「动态审核重点」第 6 项 / 发现 F-6）：
 * `runDeleteDoc` claim 环 break fall-through 微任务间隙的**真实时钟**运行时抽查。
 *
 * P1d/P1e（doc-delete-semantics）以 fake scheduler 脚本化了确定性交错窗口；本套件
 * 用真实定时器在真实时钟下锤击同一不变量（SA4 静态推演「无复活、无伪数据」的
 * 运行时复核）：
 * - delete 与 loadDoc 同 key 并发（release 后 dirty、真实 debounce/maxDirty 定时器
 *   在武装中）：delete 恒诚实 {ok:true}；并发 load 结果 ∈ {null, handle}（不得 throw、
 *   不得在孤儿 entry 上签发伪 handle）；结算后终态 load → null；
 * - 定时器复活窗口：删除越过 4× maxDirtyMs 真实时间后，store 无重建、load 恒 null；
 * - 删除后同 key 重建（真实时钟）：createDoc 正常新建（新 generation 合法语义），
 *   再次删除后同样无复活。
 *
 * 纪律：真实 yjs + 真实 MemoryPersistence hook store（字节级断言）；真实
 * `setTimeout`/`clearTimeout` scheduler；零 mock、零 fake clock、零 skip。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createMemoryPersistence,
  DocDeleteActiveHandleError,
  type DocHandle,
  type PersistenceScheduler,
  type ReplicaPersistence,
  type User,
} from '@nomicore/persistence';

const ALICE: User = Object.freeze({ userId: 'u-alice' });
const SCHEDULE = { debounceMs: 5, maxDirtyMs: 25 } as const;

/** 真实时钟 scheduler（globalThis 定时器——与生产 Cordis scheduler 同语义面）。 */
const realScheduler: PersistenceScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeDoc(docId: string, n: number): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('META').set('docId', docId);
  doc.getMap('ROOT').set('n', n);
  return doc;
}

function keyOf(owner: User, docId: string): string {
  return `${owner.userId}\u0000${docId}`;
}

interface RealtimeFixture {
  readonly persistence: ReplicaPersistence;
  readonly store: Map<string, Uint8Array>;
  dispose(): Promise<void>;
}

function makeRealtimeFixture(): RealtimeFixture {
  const store = new Map<string, Uint8Array>();
  const persistence = createMemoryPersistence({
    scheduler: realScheduler,
    schedule: { ...SCHEDULE },
    writeSnapshot: async (key, snapshot) => {
      store.set(key, snapshot.slice());
    },
    readSnapshot: async (key) => store.get(key),
    deleteSnapshot: async (key) => {
      store.delete(key);
    },
  });
  return {
    persistence,
    store,
    dispose: async () => {
      await (persistence as unknown as { dispose(): Promise<void> }).dispose();
    },
  };
}

describe('issue #228 — SA7 真实时钟抽查：delete × load 微任务交错（F-6）无复活/无伪数据', () => {
  it('锤击 ×30：release 后（真实 debounce/maxDirty 定时器武装中）delete 与 loadDoc 并发 → delete 恒 ok、load ∈ {null,handle} 且可正常 release；终态 null；越过 4×maxDirtyMs 后 store 无重建', async () => {
    const fx = makeRealtimeFixture();
    for (let i = 0; i < 30; i++) {
      const docId = `ns-rt-${i.toString().padStart(2, '0')}`;
      const handle = await fx.persistence.createDoc(ALICE, docId, makeDoc(docId, i));
      await handle.release(); // 零 handle dirty entry：真实 debounce/maxDirty 定时器武装中
      expect(fx.store.has(keyOf(ALICE, docId)), `迭代 ${i}：dirty entry 在删除前可在场`).toBe(true);

      // 并发交错（真实时钟、同一微任务批次发射）。两种诚实结局（AD-5 设计语义）：
      // (a) delete 先赢（deleting claim）：loadDoc 等待结算后重读 → null，delete ok；
      // (b) load 先赢（签发活 handle）：deleteDoc 诚实拒绝 DocDeleteActiveHandleError
      //     （P1c——调用方释放后重试）→ release 后重试必收敛 ok。
      const [deleted, loaded] = await Promise.all([
        fx.persistence.deleteDoc(ALICE, docId).then(
          (r) => r,
          (err: unknown) => err,
        ),
        fx.persistence.loadDoc(ALICE, docId),
      ]);
      // load ∈ {null, handle}；若为 handle，必须可正常 release（不得是孤儿 entry 上
      // 的伪 handle——release 不得 throw/挂起）
      expect(loaded === null || typeof (loaded as DocHandle).release === 'function').toBe(true);
      if (loaded !== null) {
        await (loaded as DocHandle).release();
      }
      if (deleted instanceof Error) {
        // 结局 (b)：唯一合法的拒绝 = 活 handle 诚实拒绝（其它任何 throw 都不合格）
        expect(deleted, `迭代 ${i}：非 ok 结局只允许 DocDeleteActiveHandleError`).toBeInstanceOf(DocDeleteActiveHandleError);
        // 释放后重试收敛（AD-5 契约「调用方释放后重试」）
        await expect(fx.persistence.deleteDoc(ALICE, docId)).resolves.toEqual({ ok: true });
      } else {
        expect(deleted, `迭代 ${i}：delete 必须诚实 ok`).toEqual({ ok: true });
      }
      // 结算后终态：null
      expect(await fx.persistence.loadDoc(ALICE, docId), `迭代 ${i}：结算后 load 必须 null`).toBeNull();
    }

    // 定时器复活窗口：越过 4× maxDirtyMs 的真实时间，任何武装中/在途定时器都应已
    // 点火或被取消——store 不得出现任何重建
    await sleep(SCHEDULE.maxDirtyMs * 4 + 30);
    for (let i = 0; i < 30; i++) {
      const docId = `ns-rt-${i.toString().padStart(2, '0')}`;
      expect(fx.store.has(keyOf(ALICE, docId)), `迭代 ${i}：真实定时器点火后不得重建快照`).toBe(false);
      expect(await fx.persistence.loadDoc(ALICE, docId)).toBeNull();
    }
    await fx.dispose();
  }, 60_000);

  it('真实时钟删除后同 key 重建：createDoc 正常新建（合法重建语义）→ 再删 → 无复活', async () => {
    const fx = makeRealtimeFixture();
    const docId = 'ns-rt-rebuild';
    const h1 = await fx.persistence.createDoc(ALICE, docId, makeDoc(docId, 1));
    await h1.release();
    await sleep(SCHEDULE.debounceMs + SCHEDULE.maxDirtyMs + 20);
    expect(fx.store.has(keyOf(ALICE, docId))).toBe(true);

    // 删除（终态）
    await expect(fx.persistence.deleteDoc(ALICE, docId)).resolves.toEqual({ ok: true });
    expect(await fx.persistence.loadDoc(ALICE, docId)).toBeNull();

    // 同 key 重建 = 新 generation（D4 第二分支的进程内同构——P1e 语义的真实时钟面）
    const h2 = await fx.persistence.createDoc(ALICE, docId, makeDoc(docId, 2));
    expect(h2.doc.getMap('META').get('docId')).toBe(docId);
    await h2.release();
    await expect
      .poll(() => fx.store.has(keyOf(ALICE, docId)), { interval: 5, timeout: 2_000 })
      .toBe(true);

    // 再删 → 终态 + 复活窗口无重建
    await expect(fx.persistence.deleteDoc(ALICE, docId)).resolves.toEqual({ ok: true });
    await sleep(SCHEDULE.maxDirtyMs * 4 + 30);
    expect(fx.store.has(keyOf(ALICE, docId))).toBe(false);
    expect(await fx.persistence.loadDoc(ALICE, docId)).toBeNull();
    await fx.dispose();
  }, 60_000);
});

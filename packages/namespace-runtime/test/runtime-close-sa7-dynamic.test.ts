/**
 * SA7 动态验证测试 — @nomicore/namespace-runtime close 生命周期（issue #92，SA4 静态
 * 验尸 pass 后的动态审核重点）。
 *
 * 覆盖 SA4 报告《动态审核重点（交 SA7）》中的可锚项：
 * - 重点 3（真实 handle close 冒烟）：SA6 close 锚全部用 fakeHandle（fixture 纪律）；
 *   本文件用真实 createMemoryPersistence handle 走完整 close——release 真实实现生效
 *   （handle.getStatus()==='released' 终态，ADR-0006 契约「release(): Promise<void>，
 *   getStatus() 在 released 后返回 'released'」）+ close 前已接纳写排空落盘、
 *   跨实例 loadDoc 可见、close 后能力位停摆、幂等同 Promise。
 * - 重点 5（function-thenable release 运行时锚）：release 返回「带可调用 .then 的
 *   function」（ECMAScript thenable 的函数形态）→ close 接收并正常 await，不把实际
 *   成功的 release 误报为失败通道（close.ts thenable 判定分支此前只有静态证据）。
 * - 破坏性补充（INV-C12 同一守卫的另一臂）：release 返回非 thenable（非 object 且非
 *   function）= adapter 契约违背 → 拒绝虚假降级：不静默当成功，收敛为 close 失败通道
 *   （reject 稳定 NamespaceRuntimeCloseError.code + cause 保留原始 TypeError、
 *   lifecycle 仍 closed、closeIssue 冻结稳定、后续 close 同一已结算 Promise）。
 * - 重点 2 相关锚：失败 close 的 rejection 责任归属调用方——本套件内同步 catch 后零
 *   进程面噪声；「未 catch 时不被任何仓内 process 级 handler 吞掉/引爆」由独立进程
 *   探针证明（见 wiki/raw/task_namespace-runtime-fatal-status-close_sa7_report.md §重点2）。
 *
 * 锚定纪律：只断言公共面可观测输出（状态机迁移、Promise 身份/结算、release 计数、
 * handle 终态、跨实例 Y.Doc 值）；零网络、零端口、真实时钟仅用于 debounce flush 轮询。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createNamespaceRuntimeWithSeam } from '../src/index.js';
import { createMemoryPersistence } from '@nomicore/persistence';
import type { DocHandle, User } from '@nomicore/persistence';

const OWNER: User = { userId: 'u-alice' };
const TEXT_VALID = 'type ROOT = { n: number; a: string; };';
const ENVELOPE = { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_VALID } as const;
const ROOT0 = { n: 1, a: 'x' };

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
  const meta = doc.getMap('META');
  meta.set('docId', 'ns-1');
  meta.set('createdAt', 1_700_000_000_000);
  const root = doc.getMap('ROOT');
  for (const [k, v] of Object.entries(ROOT0)) root.set(k, v);
  return doc;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('SA7 动态验证 — SA4 重点 3/5：真实 handle close 冒烟与 release thenable 守卫运行时锚', () => {
  it('DV-3 真实 MemoryPersistence handle：close 排空已接纳写 → release 真实生效（handle released 终态）→ Runtime closed/close 摘要 null/能力位停摆 → 跨实例 loadDoc 见该写', async () => {
    const store = new Map<string, Uint8Array>();
    const writer = createMemoryPersistence({
      schedule: { debounceMs: 5, maxDirtyMs: 60 },
      writeSnapshot: async (key, snapshot) => {
        store.set(key, snapshot.slice());
      },
    });
    const reader = createMemoryPersistence({
      readSnapshot: async (key) => store.get(key),
    });
    try {
      const handle = await writer.createDoc(OWNER, 'ns-1', makeDoc());
      // 生产绑定形态窄接缝（ADR-0008「由构造方绑定 persistence.saveDoc(handle)」）
      const runtime = createNamespaceRuntimeWithSeam({
        handle,
        notifyDirty: () => writer.saveDoc(handle),
      });
      await expect
        .poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 })
        .toBe('ready');
      expect(handle.getStatus()).toBe('ready');

      // close 前已接纳写：await 完成信号（含 dirty notification 登记）
      const res = await runtime.mutateRoot({ op: 'set', path: ['n'], value: 42 });
      expect(res).toEqual({ ok: true });

      // 等 debounce flush 真实落盘（release 不冲刷 pending flush——先落盘再 close 保持确定）
      let flushed = false;
      for (let i = 0; i < 300 && !flushed; i++) {
        const probe = await reader.loadDoc(OWNER, 'ns-1');
        if (probe !== null) {
          flushed = probe.doc.getMap('ROOT').get('n') === 42;
          await probe.release();
        }
        if (!flushed) await sleep(10);
      }
      expect(flushed).toBe(true);

      const p = runtime.close();
      expect(runtime.getStatus().lifecycle).toBe('closing'); // 同步进入 closing（返回前可观测）
      await p;

      // 真实 release 实现生效：DocHandle 终态 released（contract.ts DocHandle 契约）
      expect(handle.getStatus()).toBe('released');
      const st = runtime.getStatus();
      expect(st.lifecycle).toBe('closed');
      expect(st.close).toBe(null); // 正常路径 close 摘要 null
      expect(st.read.enabled).toBe(false);
      expect(st.rootWrite.enabled).toBe(false);
      expect(st.schemaWrite.enabled).toBe(false);

      // close 后停接纳：read 同步结果联合拒、新写零入队即时 ok:false
      expect(runtime.read(['n'])).toMatchObject({ ok: false, code: 'RUNTIME_READ_DISABLED' });
      const blocked = await runtime.mutateRoot({ op: 'set', path: ['n'], value: 99 });
      expect(JSON.stringify(blocked)).toContain('RUNTIME_WRITE_DISABLED');

      // 幂等（AC7）：后续 close 返回同一 Promise 实例
      expect(runtime.close()).toBe(p);

      // 跨实例持久化证明：close 后全新实例（空缓存）仍观察到 Runtime 写入值
      const loaded = await reader.loadDoc(OWNER, 'ns-1');
      expect(loaded).not.toBeNull();
      if (loaded !== null) {
        expect(loaded.doc.getMap('ROOT').get('n')).toBe(42);
        expect(loaded.doc.getMap('ROOT').get('a')).toBe('x');
        await loaded.release();
      }
    } finally {
      await reader.dispose();
      await writer.dispose();
    }
  });

  it('DV-5 function-thenable release：release 返回带可调用 .then 的 function → close 接收并正常 resolve（release 恰一次、closed、close 摘要 null——不误报失败通道）', async () => {
    let releaseCalls = 0;
    const handle = {
      owner: OWNER,
      docId: 'ns-1',
      doc: makeDoc(),
      getStatus: (): 'ready' => 'ready',
      release: () => {
        releaseCalls += 1;
        // function-thenable：可调用 function 自带可调用 .then（ECMAScript thenable 函数形态）
        const fn = function releasePayload(): void {
          /* callable——形态要件，非行为面 */
        };
        const carrier = fn as unknown as { then: (onFulfilled: (value?: undefined) => void) => void };
        carrier.then = (onFulfilled) => {
          queueMicrotask(() => onFulfilled(undefined));
        };
        return fn as unknown as Promise<void>;
      },
    } as unknown as DocHandle;
    const runtime = createNamespaceRuntimeWithSeam({ handle });

    const p = runtime.close();
    expect(runtime.getStatus().lifecycle).toBe('closing');
    await p; // function-thenable 被接收并正常 await——实际成功的 release 不被误报为失败

    expect(releaseCalls).toBe(1);
    const st = runtime.getStatus();
    expect(st.lifecycle).toBe('closed');
    expect(st.close).toBe(null);
    expect(runtime.close()).toBe(p); // 已结算后调用仍同一 Promise
  });

  it('DV-6 破坏性补充：release 返回非 thenable（契约违背）→ 拒绝虚假降级：close reject（稳定 code + cause 保留 TypeError）、仍 closed、closeIssue 冻结稳定、后续 close 同一 Promise 同 rejection', async () => {
    let releaseCalls = 0;
    const handle = {
      owner: OWNER,
      docId: 'ns-1',
      doc: makeDoc(),
      getStatus: (): 'ready' => 'ready',
      release: () => {
        releaseCalls += 1;
        return 42 as unknown as Promise<void>; // 非 object 且非 function：thenable 守卫的契约违背臂
      },
    } as unknown as DocHandle;
    const runtime = createNamespaceRuntimeWithSeam({ handle });

    const p = runtime.close();
    // SA4 重点 2 锚：失败 close 的 rejection 责任归属调用方——同步 catch 后零进程面噪声
    let reason: unknown;
    await p.catch((r: unknown) => {
      reason = r;
    });
    expect(reason).toBeInstanceOf(Error);
    const err = reason as Error & { code?: unknown; cause?: unknown };
    expect(err.code).toBe('NSRT-CLOSE-RELEASE-FAILED'); // 稳定 close 域 code（不导出类，按 code 消费）
    expect(err.cause).toBeInstanceOf(TypeError); // cause 零信息损失保留原始守卫异常
    expect(releaseCalls).toBe(1);

    // 无论 release 成败 Runtime 都进入 closed；read/write 停接纳
    const st1 = runtime.getStatus();
    expect(st1.lifecycle).toBe('closed');
    expect(st1.close).toMatchObject({ code: 'NSRT-CLOSE-RELEASE-FAILED' });
    const st2 = runtime.getStatus();
    expect(st2.close).toBe(st1.close); // closeIssue 冻结——跨调用同引用稳定
    expect(runtime.read(['n'])).toMatchObject({ ok: false, code: 'RUNTIME_READ_DISABLED' });
    const blocked = await runtime.mutateRoot({ op: 'set', path: ['n'], value: 7 });
    expect(JSON.stringify(blocked)).toContain('RUNTIME_WRITE_DISABLED');

    // 幂等（AC7）：后续 close 返回同一已结算 Promise，rejection 原因同身份
    expect(runtime.close()).toBe(p);
    let reason2: unknown;
    await p.catch((r: unknown) => {
      reason2 = r;
    });
    expect(reason2).toBe(reason);
  });

  it('DV-7 丢弃失败 close 不产生 process 级 unhandledRejection（结构不可引爆），且 rejection 仍送达任意晚观察者（不吞没）', async () => {
    const handle = {
      owner: OWNER,
      docId: 'ns-1',
      doc: makeDoc(),
      getStatus: (): 'ready' => 'ready',
      release: () => Promise.reject(new Error('probe: release 失败（确定性注入）')),
    } as unknown as DocHandle;
    const runtime = createNamespaceRuntimeWithSeam({ handle });

    // 临时进程级监听（用后即撤——沿 file-persistence-sa7-dynamic 先例）：宿主误用形态
    // 「close() 不 catch 直接丢弃」若产生 unhandledRejection，本监听必捕获
    const seen: unknown[] = [];
    const onUnhandled = (r: unknown) => {
      seen.push(r);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const dropped: Promise<void> = runtime.close(); // 故意不 catch——宿主误用形态
      // 排空微任务 + 真实时钟窗口：unhandled 检测点早已越过（Node 在 tick 末检查）
      await sleep(50);
      expect(seen).toEqual([]); // 结构性零事件：返回的 Promise 即 sequencer 链节点，
      // 链尾 settled.then(noop, noop) 已在其上挂拒绝处理器（sequencer.ts 链尾恒绿）——
      // 未 catch 的失败 close 永不升级为进程级 unhandledRejection/exit
      expect(runtime.getStatus().close).toMatchObject({ code: 'NSRT-CLOSE-RELEASE-FAILED' }); // 失败仍经 status 面可观测
      // 不吞没：晚到观察者仍收到 rejection（code 面消费）
      const late = await dropped.then(
        () => 'unexpected-resolve',
        (r: unknown) => (r as Error & { code?: unknown }).code,
      );
      expect(late).toBe('NSRT-CLOSE-RELEASE-FAILED');
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

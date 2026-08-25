/**
 * SA7 动态补充测试 — issue #109 internal factory 破坏性探测（SA4 动态审核重点：
 * 「internal factory 产物的活链路行为」）。
 *
 * 与 SA6 runtime-registry-internal-seam.test.ts 的分工：SA6 锚 AC1/AC2/AC4/AC5/AC6
 * 的正向契约（导出面、注入面零效果、P0/FIFO/close/status 全链、import 图审计）；
 * 本文件补充 SA6 未锚的**破坏性路径**——全部经 `@nomicore/namespace-runtime/internal`
 * 真实 specifier 动态导入（活链路，非包内相对通道）：
 *
 * 1. V1 形状守卫经 internal seam 同步透传（null handle / 非函数 notifyDirty 均 loud
 *    TypeError，稳定 message），且 throw 后零副作用（INV-N4）——同一 handle 随后仍可
 *    成功构造并正常读写 close（所有权未被错误消费、无残留入队）。
 * 2. V2 状态门透传 + 独占租约不可复活：close() 释放 handle 后，经 internal factory
 *    对同一 released handle 二次构造 → loud HANDLE_NOT_USABLE——released 租约上
 *    不可能建立第二个 Runtime/sequencer（ADR-0009 独占租约语义的运行时半环）。
 * 3. 无缺省绑定降级：notifyDirty 缺席（undefined）时构造可成立（类型面由 type-guard
 *    锁死必填；运行时探测 JS 调用方绕类型后的行为），但一切写 loud 拒绝
 *    （RUNTIME_WRITE_DISABLED +「notifyDirty 未绑定」）——不存在静默 no-op 持久化
 *    （SA4 §4「无降级」判定的行为锚）。
 * 4. 深导入绕行阻断：`@nomicore/namespace-runtime/src/internal.js`（绕过 ./internal
 *    specifier 直捣源文件）经 exports map 不可解析——internal subpath 是唯一通道
 *    （SA4 §5 攻击面表的动态复核）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, User } from '@nomicore/persistence';
import { createMemoryPersistence } from '@nomicore/persistence';

const OWNER: User = { userId: 'u-sa7' };

const TEXT_V1 = 'type ROOT = { n: number; a: string; };';
const ENV1 = { lang: 'vfsl', version: 1, id: 'ns-sa7', text: TEXT_V1 } as const;

async function makeDoc(): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(ENV1)) sc.set(k, v);
  const meta = doc.getMap('META');
  meta.set('docId', 'ns-sa7');
  meta.set('createdAt', 1_700_000_000_000);
  const root = doc.getMap('ROOT');
  root.set('n', 1);
  root.set('a', 'x');
  return doc;
}

/** 经真实 package specifier 装载 internal entry（与生产消费方同一通道）。 */
async function loadFactory(): Promise<(...args: unknown[]) => unknown> {
  const entry = (await import('@nomicore/namespace-runtime/internal')) as Record<string, unknown>;
  const factory = entry.createNamespaceRuntimeForRegistry;
  if (typeof factory !== 'function') throw new Error('internal entry 缺少 createNamespaceRuntimeForRegistry');
  return factory as (...args: unknown[]) => unknown;
}

type RuntimeLike = {
  read: (p: readonly string[]) => { ok: boolean; value?: unknown; code?: string };
  mutateRoot: (m: { op: 'set'; path: readonly string[]; value: unknown }) => Promise<
    { ok: true } | { ok: false; issues: { message: string; path: readonly (string | number)[] }[] }
  >;
  getStatus: () => { lifecycle: string };
  close: () => Promise<void>;
};

describe('SA7 动态补充：internal factory 破坏性探测（构造门透传 / 零副作用 / 无缺省绑定 / 深导入阻断）', () => {
  it('V1 形状守卫同步透传且 throw 零副作用：null handle 与非函数 notifyDirty 均 loud TypeError，同一 handle 随后仍可成功构造读写 close', async () => {
    const writer = createMemoryPersistence({
      schedule: { debounceMs: 5, maxDirtyMs: 60 },
      writeSnapshot: async () => {},
    });
    const handle: DocHandle = await writer.createDoc(OWNER, 'ns-sa7', await makeDoc());
    try {
      const factory = await loadFactory();
      const notify = async (): Promise<void> => {
        await writer.saveDoc(handle);
      };

      // 破坏性输入 ①：handle 缺席（null）→ V1 loud TypeError（稳定 message，同步 throw）。
      expect(() => factory(null, notify)).toThrow(TypeError);
      expect(() => factory(null, notify)).toThrow(/seam 输入缺少 handle/);

      // 破坏性输入 ②：notifyDirty 非函数（绕过类型面的 JS 调用）→ V1 loud TypeError。
      expect(() => factory(handle, 'not-a-function')).toThrow(TypeError);
      expect(() => factory(handle, 'not-a-function')).toThrow(/input\.notifyDirty 若提供必须是 function/);

      // INV-N4 零副作用：两次 throw 后 handle 仍 ready，未被消费/入队/降级——
      // 随后以正确输入构造成功，读写 close 全链正常（所有权归调用方）。
      expect(handle.getStatus()).toBe('ready');
      const runtime = factory(handle, notify) as RuntimeLike;
      expect(runtime.getStatus().lifecycle).toBe('ready');
      const r = runtime.read(['n']);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(1);
      const wr = await runtime.mutateRoot({ op: 'set', path: ['n'], value: 7 });
      expect(wr.ok).toBe(true);
      const r2 = runtime.read(['n']);
      if (r2.ok) expect(r2.value).toBe(7);
      await runtime.close();
      expect(handle.getStatus()).toBe('released');
    } finally {
      await handle.release().catch(() => {});
      await writer.dispose();
    }
  });

  it('V2 状态门透传 + 独占租约不可复活：close 释放后的 released handle 经 internal factory 二次构造 → loud HANDLE_NOT_USABLE', async () => {
    const writer = createMemoryPersistence({
      schedule: { debounceMs: 5, maxDirtyMs: 60 },
      writeSnapshot: async () => {},
    });
    const handle: DocHandle = await writer.createDoc(OWNER, 'ns-sa7', await makeDoc());
    try {
      const factory = await loadFactory();
      const notify = async (): Promise<void> => {
        await writer.saveDoc(handle);
      };
      const runtime = factory(handle, notify) as RuntimeLike;
      await runtime.close();
      expect(handle.getStatus()).toBe('released');

      // released 租约上不可建立第二个 Runtime/sequencer——同步 loud throw，
      // 非 reject、非静默返回（构造 throw 前置，ADR-0008 V2 状态门）。
      expect(() => factory(handle, notify)).toThrow(/HANDLE_NOT_USABLE/);
      expect(() => factory(handle, notify)).toThrow(/released/);
    } finally {
      await handle.release().catch(() => {});
      await writer.dispose();
    }
  });

  it('无缺省绑定：notifyDirty 缺席（undefined）构造可成立，但一切写 loud 拒绝（RUNTIME_WRITE_DISABLED + notifyDirty 未绑定）', async () => {
    const writer = createMemoryPersistence({
      schedule: { debounceMs: 5, maxDirtyMs: 60 },
      writeSnapshot: async () => {},
    });
    const handle: DocHandle = await writer.createDoc(OWNER, 'ns-sa7', await makeDoc());
    try {
      const factory = await loadFactory();

      // 绕过类型面（JS 调用方传 undefined）——运行时探测：工厂不补缺省 no-op。
      const runtime = factory(handle, undefined) as RuntimeLike;
      expect(runtime.getStatus().lifecycle).toBe('ready');

      // 读取不受 notifier 影响（读取能力独立于持久化绑定）。
      const r = runtime.read(['n']);
      expect(r.ok).toBe(true);

      // 写 → S2 loud 拒绝：无「提交成功但永无 dirty 登记」的静默失信。
      const wr = await runtime.mutateRoot({ op: 'set', path: ['n'], value: 2 });
      expect(wr.ok).toBe(false);
      if (!wr.ok) {
        // noUncheckedIndexedAccess：issues[0] 判空后单读捕获（与包内「单读捕获」纪律同款）。
        const issue = wr.issues[0];
        expect(issue?.message).toContain('RUNTIME_WRITE_DISABLED');
        expect(issue?.message).toContain('notifyDirty 未绑定');
      }
      await runtime.close();
    } finally {
      await handle.release().catch(() => {});
      await writer.dispose();
    }
  });

  it('深导入绕行阻断：@nomicore/namespace-runtime/src/internal.js 经 exports map 不可解析——internal subpath 是唯一通道', async () => {
    // specifier 运行时拼接：避开 vite transform 期对字面量动态 import 的静态解析
    // （静态分析会在收集期把整个测试文件炸掉，而非运行期 rejects）。
    const deepSpec = '@nomicore/namespace-runtime' + '/src/internal.js';
    // exports map 存在且无 ./src/* 子路径 → Node/vite 解析器同规则拒绝深导入。
    await expect(import(deepSpec)).rejects.toThrow(/specifier|EXPORTED|internal/i);
  });
});

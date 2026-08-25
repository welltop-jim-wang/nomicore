/**
 * SA6 红灯测试（类型面）— @nomicore/namespace-runtime 公共面新增 close 成员与
 * getStatus() 的 close 摘要键、lifecycle 三态演进（issue #92 / ADR-0008
 * 「生命周期、状态与所有权」节 + 任务简报 AC5/AC6/AC8，类型层锚）。
 *
 * 契约来源：
 * - ADR-0008：「close() 幂等。首次调用同步进入 closing……失败时 close Promise reject，
 *   后续 close 返回同一个已结算 Promise」；
 * - ADR-0008：「Runtime 提供结构化瞬时 capability status……lifecycle、read、ROOT write、
 *   SCHEMA write，以及稳定且不含原始 Error/stack/SCHEMA 全文/ROOT 数据的 schema、fatal、
 *   close issue 摘要」；
 * - 任务简报 AC5（getStatus 七键形状 + lifecycle 三态）与 AC6（公共 close 方法）、
 *   AC8（无事件订阅键）。
 *
 * 锚定机制（在 vitest --typecheck 配置下红/绿翻转）：
 * - `NamespaceRuntime` 公共接口必须包含 `close` 成员；当前基线接口无 `close` →
 *   `runtime.close` 报 TS2339 → **红**；修绿（SA3 在公共接口加入成员）→ TS2339 消失 → **绿**。
 * - `getStatus()` 返回的 status 必须包含 `close` 摘要键；当前基线六键无 `close` →
 *   `runtime.getStatus().close` 报 TS2339 → **红**。
 * - `lifecycle` 类型须从当前单值 `'ready'` 演进为 `'ready' | 'closing' | 'closed'` 三态
 *   联合（AC5）——以 `expectTypeOf(...).toEqualTypeOf` 锁定（当前单值不匹配 → 类型面红）。
 * - 本文件不锚 close 摘要的字段名目/拒绝码字面量（属运行时行为面，由
 *   runtime-close-lifecycle.test.ts 行为锚定）。
 *
 * 红灯现状（当前基线）：`runtime.close` 与 `runtime.getStatus().close` 均 TS2339 →
 * 红；lifecycle 单值不满足三态联合 → 红。
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { NamespaceRuntime } from '../src/index.js';

declare const runtime: NamespaceRuntime;

describe('类型面：close 成员 / close 摘要键 / lifecycle 三态（AC5/AC6/AC8）', () => {
  it('NamespaceRuntime 公共接口包含 close 成员且返回 Promise<void>', () => {
    runtime.close; // TS2339（当前红）：Property 'close' does not exist on type 'NamespaceRuntime'
    expectTypeOf(runtime.close).returns.toEqualTypeOf<Promise<void>>();
  });

  it('getStatus 返回对象含 close 摘要键（七键形状）', () => {
    runtime.getStatus().close; // TS2339（当前红）：status 无 close 键
  });

  it('lifecycle 类型为 ready | closing | closed 三态联合（AC5）', () => {
    expectTypeOf(runtime.getStatus().lifecycle).toEqualTypeOf<'ready' | 'closing' | 'closed'>();
  });
});

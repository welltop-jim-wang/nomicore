/**
 * SA6 红灯测试（类型面）— @nomicore/namespace-runtime 公共面新增 replaceSchema 成员
 * （issue #91 / ADR-0008「SCHEMA write」节 + 任务简报 AC1/AC10，类型层锚）。
 *
 * 契约来源：
 * - docs/adr/0008：「v1 公开两个窄方法：runtime.mutateRoot(mutation) 与
 *   runtime.replaceSchema({ schema: proposedEnvelope, root?: completeLogicalRoot })」；
 * - 任务简报 AC1（replaceSchema 与 mutateRoot 共享唯一 write sequencer）与 AC10
 *   （通过全量 typecheck/test）。
 *
 * 锚定机制（在 vitest --typecheck 配置下红/绿翻转）：
 * - `NamespaceRuntime` 公共接口必须包含 `replaceSchema` 成员（runtime 面方法，第九键）；
 *   当前基线接口只有八键 → `runtime.replaceSchema` 报 TS2339 → **红**；
 *   修绿（SA3 在公共接口加入成员）→ TS2339 消失 → **绿**。
 * - 本文件不锚类型名目（窄结果联合名目属设计命名，行为形状由运行时测试锚定）——
 *   只锚公共接口成员存在性。
 *
 * 红灯现状（当前基线，NamespaceRuntime 无 replaceSchema 成员）：
 * - 本文件 `runtime.replaceSchema` 报 TS2339 → 红。
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { NamespaceRuntime } from '../src/index.js';

declare const runtime: NamespaceRuntime;

describe('namespace-runtime 公共面 — replaceSchema 成员（类型层）', () => {
  it('NamespaceRuntime 公共面包含 replaceSchema 方法（当前缺失 → TS2339 红；SA3 加入后绿）', () => {
    expectTypeOf(runtime.replaceSchema).toBeFunction();
  });
});

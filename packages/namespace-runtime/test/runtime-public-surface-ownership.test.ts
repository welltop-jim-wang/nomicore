/**
 * SA6 红灯测试 — @nomicore/namespace-runtime public surface、所有权与状态形状
 * （issue #89 / ADR-0008，功能开发：Runtime 骨架 + 同步读取面 + 队首 P0，子集）。
 *
 * 契约来源：
 * - 任务简报 wiki/raw/task_namespace-runtime-skeleton-p0.md 验收标准 AC1/AC2（+AC7
 *   的状态形状约束）+ AC8（seam 是唯一可达构造路径）；
 * - docs/adr/0008「生命周期、状态与所有权」节：「Runtime 成功构造后独占一个
 *   DocHandle；构造失败时所有权仍归调用方。Runtime 不公开 handle、Y.Doc、
 *   ROOT/SCHEMA/META live 引用或生产构造器。生产工厂保留包内，由未来 Registry
 *   使用；测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault」；
 *   又：「Runtime 公开冻结的 owner.userId 与 namespaceId 身份投影」；
 *   又：「Runtime 提供结构化瞬时 capability status，而不是单一扁平枚举：lifecycle、
 *   read、ROOT write、SCHEMA write，以及稳定且不含原始 Error/stack/SCHEMA 全文/ROOT
 *   数据的 schema、fatal、close issue 摘要。status 不暴露队列长度、任务类型或
 *   sequence」。
 *
 * 本文件冻结的公共契约（SA3 实现的唯一行为锚点；SA1 设计不得收窄，仅可补充）：
 * - 公共入口 packages/namespace-runtime/src/index.ts（package `@nomicore/namespace-runtime`
 *   的 "." 导出）不得导出任何生产构造器（本文件锁定工厂名 createNamespaceRuntime 缺席）；
 * - 包内确定性 seam 构造器 `createNamespaceRuntimeWithSeam(input)` 从包内
 *   `'../src/runtime.js'` 导入（AC6 rev2：公共入口零 seam 暴露——测试经包内模块
 *   通道相对导入，不经 index.ts；沿 doc-runtime getCompiledWith 先例）。契约形状：
 *     interface NamespaceRuntimeSeamInput {
 *       readonly handle: DocHandle;                             // 注入的独占租约
 *       readonly p0Gate?: Promise<void>;                        // P0 编译前 await 的可控门
 *       readonly compile?: (envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult; // 注入编译步
 *     }
 *     接受 getStatus() ∈ {'ready','persistence-degraded'}（读与 P0 不受 degraded 影响）；
 *     'released'/'disposed' → 同步 throw（失败时所有权不转移）。
 * - Runtime 对象公共形状（对象字面量 or 等价同类面，方法同源）：
 *     { owner(冻结,{userId}), namespaceId(=handle.docId), read, getSchemaEnvelope,
 *       getMetadata, getActiveSchema, getStatus }——除键集外无任何属性（不公开
 *       doc/handle/docHandle/yDoc/sequencer 等）；
 * - getStatus() 返回结构化对象（非扁平枚举）：
 *     { lifecycle: 'ready'（close 属后续 issue，v1 恒 'ready'）,
 *       read: { enabled: boolean }, rootWrite: { enabled: boolean },
 *       schemaWrite: { enabled: boolean },
 *       schema: { state: 'preparing'|'ready'|'unavailable'; issue?: {code,message} },
 *       fatal: { code, message } | null }；
 *     不得包含 queue/sequence/taskType 等队列内部字段，不得含数组值字段。
 *
 * 红灯现状（构造性红灯）：@nomicore/namespace-runtime 包不存在，../src/index.js
 * 无法解析 → 本文件全部用例在 import 阶段红（模块未找到）；SA3 建包后行为断言接管。
 * 本文件不预设实现内部结构（不读源码、不 grep 文本形状），全部断言锚定公共接缝的
 * 可观测输出。
 *
 * fixture 纪律：handle 一律经真实 MemoryPersistence.createDoc 构造（最小 Mock 原则——
 * 唯一缝是包内 seam 的 p0Gate/compile 注入，P0 与读取全部走真实实现）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createMemoryPersistence } from '@nomicore/persistence';
import type { DocHandle, User } from '@nomicore/persistence';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import * as publicEntry from '../src/index.js';

const OWNER: User = { userId: 'u-alice' };
const TEXT_VALID = 'type ROOT = { n: number; a: string; };';

async function makeHandle(): Promise<{
  persistence: ReturnType<typeof createMemoryPersistence>;
  handle: DocHandle;
  doc: Y.Doc;
}> {
  const persistence = createMemoryPersistence();
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  sc.set('lang', 'vfsl');
  sc.set('version', 1);
  sc.set('id', 'ns-1');
  sc.set('text', TEXT_VALID);
  const meta = doc.getMap('META');
  meta.set('docId', 'ns-1');
  meta.set('createdAt', 1_700_000_000_000);
  const root = doc.getMap('ROOT');
  root.set('n', 'str');
  root.set('a', 'val');
  const handle = await persistence.createDoc(OWNER, 'ns-1', doc);
  return { persistence, handle, doc };
}

describe('namespace-runtime 公共面与所有权（AC1/AC2/AC7 状态形状/AC8 seam）', () => {
  it('AC1：生产构造器与测试 seam 均不从公共 package entry 导出（seam 经包内模块通道消费）', () => {
    const entry = publicEntry as Record<string, unknown>;
    expect(entry.createNamespaceRuntime).toBeUndefined();
    // 【rev2 D-1/裁决 A】seam 一并撤出公共面：公共入口零 seam 暴露；测试消费经
    // 包内相对路径 ../src/runtime.js —— 正值面（seam 可达构造）由本文件其余用例覆盖。
    expect(entry.createNamespaceRuntimeWithSeam).toBeUndefined();
  });

  it('AC1/AC2：构造经 seam 同步成功，公开冻结 owner.userId 与 namespaceId(=docId)', async () => {
    const { handle } = await makeHandle();
    const runtime = createNamespaceRuntimeWithSeam({ handle }); // 同步返回，不 await
    const owner = runtime.owner;
    expect(owner.userId).toBe('u-alice');
    expect(Object.isFrozen(owner)).toBe(true);
    expect(runtime.namespaceId).toBe('ns-1');
    expect(runtime.namespaceId).toBe(handle.docId);
  });

  it('AC2：不公开 DocHandle、Y.Doc 或任何 writable Yjs 引用（own/原型链均不得暴露）', async () => {
    const { handle } = await makeHandle();
    const runtime = createNamespaceRuntimeWithSeam({ handle });
    // 公共方法/属性必须可达
    expect(typeof runtime.read).toBe('function');
    expect(typeof runtime.getSchemaEnvelope).toBe('function');
    expect(typeof runtime.getMetadata).toBe('function');
    expect(typeof runtime.getActiveSchema).toBe('function');
    expect(typeof runtime.getStatus).toBe('function');
    expect('owner' in runtime).toBe(true);
    expect('namespaceId' in runtime).toBe(true);
    // 禁止暴露 handle / Y.Doc / 可写 Yjs 引用 / 序列器（own 或原型链任一层）
    for (const forbidden of ['doc', 'handle', 'docHandle', 'yDoc', 'sequencer', 'persistence']) {
      expect(forbidden in runtime).toBe(false);
    }
  });

  it('AC1：构造失败（released handle）时所有权不转移——handle 状态原样、doc 仍归调用方、持久层条目未被消耗', async () => {
    const { persistence, handle, doc } = await makeHandle();
    await handle.release();
    expect(handle.getStatus()).toBe('released');
    expect(() => createNamespaceRuntimeWithSeam({ handle })).toThrow();
    // 失败不改变 handle 状态、不破坏调用方的 doc 访问（所有权未转移的事实证据）
    expect(handle.getStatus()).toBe('released');
    expect(doc.getMap('ROOT').get('n')).toBe('str');
    expect(doc.getMap('SCHEMA').get('id')).toBe('ns-1');
    // 持久层条目依然存活：同 (owner, docId) 重新 load 并成功构造 —— 未被失败构造吞掉
    const reloaded = await persistence.loadDoc(OWNER, 'ns-1');
    expect(reloaded).not.toBeNull();
    const runtime = createNamespaceRuntimeWithSeam({ handle: reloaded! });
    expect(runtime.getStatus().schema.state).toBe('preparing');
    await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
  });

  it('AC3/AC7：getStatus 是结构化 capability status（非扁平枚举），不暴露队列长度/任务类型/sequence', async () => {
    const { handle } = await makeHandle();
    const runtime = createNamespaceRuntimeWithSeam({ handle });
    const status = runtime.getStatus();
    expect(status).toBeTypeOf('object');
    expect(Array.isArray(status)).toBe(false);
    expect(typeof status.lifecycle).toBe('string');
    expect(status.lifecycle).toBe('ready');
    // 能力槽位是结构化对象而非扁平值
    const statusAny = status as unknown as Record<string, unknown>;
    for (const cap of ['read', 'rootWrite', 'schemaWrite'] as const) {
      const slot = statusAny[cap];
      expect(slot).toBeTypeOf('object');
      expect(typeof (slot as { enabled: unknown }).enabled).toBe('boolean');
    }
    // schema 状态机只允许三态（AC7）
    expect(['preparing', 'ready', 'unavailable']).toContain(status.schema.state);
    // 不暴露队列长度/任务类型/sequence（ADR-0008）
    const keys = Object.keys(status);
    expect(keys).not.toContain('queue');
    expect(keys).not.toContain('sequence');
    expect(keys).not.toContain('taskType');
    expect(Object.values(status).some((v) => Array.isArray(v))).toBe(false);
    // 结算后读取能力恒可用
    await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
    const settled = runtime.getStatus();
    expect(settled.read.enabled).toBe(true);
    expect(settled.fatal).toBeNull();
  });

  it('AC3：read/getSchemaEnvelope/getMetadata/getActiveSchema/getStatus 均为同步返回值（非 Promise）', async () => {
    const { handle } = await makeHandle();
    const runtime = createNamespaceRuntimeWithSeam({ handle });
    const values: unknown[] = [
      runtime.read(['n']),
      runtime.getSchemaEnvelope(),
      runtime.getMetadata(),
      runtime.getActiveSchema(),
      runtime.getStatus(),
    ];
    for (const value of values) {
      expect(value).not.toBeInstanceOf(Promise);
    }
  });
});

/**
 * SA6 红灯测试 — @nomicore/namespace-runtime 同步只读面（AC3/AC4/AC8）
 * （issue #89 / ADR-0008，功能开发：Runtime 骨架 + 同步读取面 + 队首 P0，子集）。
 *
 * 契约来源：
 * - docs/adr/0008「读取能力」节：「Runtime 获得并信任有效 DocHandle 后，在对外发布前
 *   把 P0 放入 write sequencer 队首，同时立即开放同步读取；读取不等待 P0 或任何写任务，
 *   也不进入 sequencer」；「getSchemaEnvelope() 从顶层 SCHEMA Y.Map 投影
 *   lang/version/id/text 四个 primitive string 键，忽略额外键，不 coercion 或补默认值」；
 *   「getMetadata() 深拷贝顶层 META Y.Map 的全部键」；「读取只观察调用瞬间已经提交的
 *   live Y.Doc」；
 * - 任务简报 AC3/AC4/AC8：读、getSchemaEnvelope、getMetadata、getActiveSchema、getStatus
 *   均为同步只读能力，读取不等待 P0；getSchemaEnvelope 只投影四标准键并忽略额外键、
 *   META 返回全部 plain JSON 字段；包内确定性 seam 能控制 P0 resolve/reject，并证明
 *   读取在 P0 pending 时立即工作。
 *
 * 本文件冻结的契约锚点（SA3 实现的行为锚，仅可补充）：
 * - seam 输入 p0Gate：P0 在编译前 await 该门。门未 resolve 时 P0 保持队首 pending，
 *   getStatus().schema.state === 'preparing'，且五个读取面立即可用（同步、正确值）；
 * - P0 经 sequencer 异步执行（构造同步返回，P0 绝不同步结算在构造调用栈内）——
 *   若 P0 同步执行，p0Gate 未 resolve 时构造本身即挂死（可观测死锁），本测试直接红；
 * - getSchemaEnvelope() 返回 vfsl SchemaEnvelope 形状（lang/version/id/text；
 *   version 为 number——与 @nomicore/vfsl compileSchemaEnvelope 严格门一致，不 coercion）；
 *   额外键（任意值）一律不出现；
 * - getMetadata() 返回 META 全部键的普通深拷贝（每次调用独立副本，与 live Y.Doc
 *   无引用共享：突变返回值不影响再次读取）；
 * - read(path) 透传 @nomicore/doc-runtime readLogicalValueAtPath(doc, path) 的同步
 *   结果联合（缺键 → ok:true value:undefined 合法形态）；
 * - getActiveSchema() 在 P0 pending/未安装时返回 null。
 *
 * 红灯现状（构造性红灯）：@nomicore/namespace-runtime 包不存在，../src/index.js
 * 无法解析 → 全部用例 import 阶段红（模块未找到）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createMemoryPersistence } from '@nomicore/persistence';
import type { DocHandle, User } from '@nomicore/persistence';
import { realPersistenceScheduler } from './real-persistence-scheduler.js';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';

const OWNER: User = { userId: 'u-alice' };
const TEXT_VALID = 'type ROOT = { n: number; a: string; };';
const ENVELOPE_FIXTURE = { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_VALID } as const;
const META_FIXTURE = {
  docId: 'ns-1',
  createdAt: 1_700_000_000_000,
  revision: 3,
  tags: ['v1', 'v2'],
  nested: { origin: 'seed', owner: 'alice' },
  flag: true,
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function makeHandle(opts: {
  schema?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  rootValues?: Record<string, unknown>;
} = {}): Promise<{ handle: DocHandle; doc: Y.Doc; persistence: ReturnType<typeof createMemoryPersistence> }> {
  const persistence = createMemoryPersistence({ scheduler: realPersistenceScheduler });
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(opts.schema ?? { ...ENVELOPE_FIXTURE })) {
    sc.set(k, v);
  }
  const meta = doc.getMap('META');
  for (const [k, v] of Object.entries(opts.meta ?? META_FIXTURE)) {
    meta.set(k, v);
  }
  const root = doc.getMap('ROOT');
  for (const [k, v] of Object.entries(opts.rootValues ?? { n: 'str', a: 'val' })) {
    root.set(k, v);
  }
  const handle = await persistence.createDoc(OWNER, 'ns-1', doc);
  return { handle, doc, persistence };
}

describe('namespace-runtime 同步只读面（AC3/AC4/AC8）', () => {
  it('AC8：P0 pending（p0Gate 未 resolve）时读取立即工作——读取不等待 P0、不进入 sequencer', async () => {
    const gate = deferred();
    const { handle } = await makeHandle();
    const runtime = createNamespaceRuntimeWithSeam({ handle, p0Gate: gate.promise });

    // 构造同步返回；P0 在队首 pending —— 读取面立即可用且值正确
    expect(runtime.getStatus().schema.state).toBe('preparing');
    expect(runtime.getSchemaEnvelope()).toEqual(ENVELOPE_FIXTURE);
    expect(runtime.getMetadata()).toEqual(META_FIXTURE);
    const read = runtime.read(['n']);
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error(`期望 ok:true，实际 code=${read.code}`);
    expect(read.value).toBe('str');
    expect(runtime.getActiveSchema()).toBeNull();

    // 门未 resolve：经过一段事件循环，P0 仍未结算（preparing 保持）——读取与 P0 互不阻塞的证据
    await new Promise((r) => setTimeout(r, 25));
    expect(runtime.getStatus().schema.state).toBe('preparing');

    // 门 resolve 后 P0 结算 → ready（P0 是真实队首任务，不是构造内同步步骤）
    gate.resolve();
    await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
    expect(runtime.getActiveSchema()).not.toBeNull();
  });

  it('AC4：getSchemaEnvelope 只投影四个 primitive string 标准键并忽略额外键', async () => {
    const schema: Record<string, unknown> = {
      ...ENVELOPE_FIXTURE,
      extraKey: 'extra-value',
      extraNum: 42,
      extraNull: null,
    };
    const { handle } = await makeHandle({ schema });
    const runtime = createNamespaceRuntimeWithSeam({ handle });

    const envelope = runtime.getSchemaEnvelope();
    expect(envelope).toEqual(ENVELOPE_FIXTURE);
    if (envelope === null) throw new Error('SCHEMA 存在且为标准四键，投影应为信封');
    expect([...Object.keys(envelope)].sort()).toEqual(['id', 'lang', 'text', 'version']);
    // 额外键被忽略（不 coercion、不补默认值、不外泄）
    for (const extra of ['extraKey', 'extraNum', 'extraNull']) {
      expect((envelope as unknown as Record<string, unknown>)[extra]).toBeUndefined();
    }
    // P0 只读取标准四键：额外键存在时严格编译仍然成功 → ready
    await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
  });

  it('AC4：getMetadata 返回 META 全部键的普通深拷贝（与 live Y.Doc 无共享引用）', async () => {
    const { handle } = await makeHandle();
    const runtime = createNamespaceRuntimeWithSeam({ handle });

    const first = runtime.getMetadata();
    expect(first).toEqual(META_FIXTURE);
    expect([...new Set(Object.keys(first))]).toEqual([...new Set(Object.keys(META_FIXTURE))]);

    // 深拷贝隔离：突变/删除返回副本不影响再次读取（每调用独立副本 + 非 live 引用）
    const mutated = runtime.getMetadata();
    (mutated.nested as Record<string, unknown>).origin = 'MUTATED';
    (mutated.tags as string[]).push('MUTATED');
    delete mutated.docId;
    const second = runtime.getMetadata();
    expect(second).toEqual(META_FIXTURE);
  });

  it('AC3：read 透传 readLogicalValueAtPath 同步结果联合——缺键合法返回 ok:true undefined', async () => {
    const { handle } = await makeHandle();
    const runtime = createNamespaceRuntimeWithSeam({ handle });

    const missing = runtime.read(['nope']);
    expect(missing.ok).toBe(true);
    if (!missing.ok) throw new Error(`期望 ok:true，实际 code=${missing.code}`);
    expect(missing.value).toBeUndefined();

    const invalidPath = runtime.read(['n', 0]);
    expect(invalidPath.ok).toBe(false);
    if (invalidPath.ok) throw new Error('Y.Map 上数字段应被段纪律拒绝');
    expect(invalidPath.code).toBe('PATH_NOT_ALLOWED');
  });
});

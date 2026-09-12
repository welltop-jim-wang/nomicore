/**
 * issue #336（ADR-0024 T3）readData 形状预算 —— 主缝契约 fixture（red/control/类型面共用；
 * 非测试文件，vitest 不收集）。
 *
 * 构造形态**复制**自 `readdata-schema-projection-fixture.ts`（MemoryPersistence +
 * createNamespaceRuntimeWithSeam + `expect.poll` 等 ready）——**零编辑**该既有文件
 * （其由既有 projection-red/control 套件共享；设计 §11 N4 钉死）。
 *
 * 数据设计（对齐断言的可判定前提 = 单一引用、无 raw 外键与 schema 混读）：
 * - 严格变体（缺省）：ROOT 仅含 schema 声明字段——`meta`（ref → Meta，2 直接子项）、
 *   `tags`（Y.Array，5 元素）、`nick`（optional 缺席）——供两通道对齐（§12-T1 组 D）与
 *   width 逐字节相等（组 E）锚定；
 * - raw 变体（`raw: true`）：追加 schema 外数据 `rogue` / `blob` / `sentinel`——`blob`
 *   直接子项 2 ≠ 后代总数 6（omitted 语义锚，组 C）；`sentinel` 内含 non-finite 值
 *   （零物化哨兵，组 G：折叠读 ok、无预算读响亮失败 = 哨兵真实）；
 * - 敌意 options 构造器集中在文件下半部分（组 F-x：descriptor/get 分叉、抛错 get trap、
 *   状态化/交替 descriptor trap、非 enumerable own 键）。
 */
import * as Y from 'yjs';
import { expect } from 'vitest';
import { createMemoryPersistence } from '@nomicore/persistence';
import type { DocHandle, User } from '@nomicore/persistence';
import { realPersistenceScheduler } from './real-persistence-scheduler.js';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import type { NamespaceRuntime } from '../src/index.js';

/** 对齐锚定用 schema：ROOT 直接子项 = 2 个标量 + 1 ref 容器 + 1 数组 + 1 optional 缺席。 */
export const TXT_336 = `
type Meta = YMap<{
  /** 备注内容 */
  content: YLeaf<string>;
  /** 附加计数 */
  extra: YLeaf<number>;
}>;
type ROOT = YMap<{
  /** 页面标题 */
  title: YLeaf<string>;
  count: YLeaf<number>;
  /** 元数据 */
  meta: Meta;
  /** 标签组 */
  tags: YLeaf<string>[];
  /** 可选昵称 */
  nick?: YLeaf<string>;
}>;
`.trim();

export const ENV_336 = { lang: 'vfsl', version: 1, id: 'ns-336', text: TXT_336 } as const;

export const OWNER: User = { userId: 'u-336' };

/** 严格 ROOT：仅 schema 声明字段（对齐断言的可判定前提）。 */
export function seedStrictRoot(root: Y.Map<unknown>): void {
  root.set('title', 'hello');
  root.set('count', 3);
  const meta = new Y.Map<unknown>();
  meta.set('content', 'hi');
  meta.set('extra', 7);
  root.set('meta', meta);
  const tags = new Y.Array<string>();
  tags.push(['a', 'b', 'c', 'd', 'e']); // 5 元素：width 预算（保留 3）锚定面
  root.set('tags', tags);
  // 'nick'（optional）刻意缺席：optional 对计层透明、无标记位。
}

/** raw ROOT：严格字段 + schema 外数据（omitted 语义 / 零物化哨兵）。 */
export function seedRawRoot(root: Y.Map<unknown>): void {
  seedStrictRoot(root);
  root.set('rogue', 'x'); // 路径偏离 schema → schema:null
  const blob = new Y.Map<unknown>();
  const p = new Y.Map<number>();
  p.set('a', 1);
  p.set('b', 2);
  p.set('c', 3);
  const q = new Y.Map<number>();
  q.set('d', 4);
  q.set('e', 5);
  q.set('f', 6);
  blob.set('p', p);
  blob.set('q', q); // 直接子项 2；每子项 3 后代（后代总数 6）→ omitted=2 ≠ 6（AC4 锚）
  root.set('blob', blob);
  const sentinel = new Y.Map<unknown>();
  sentinel.set('bad', Number.NaN); // 展开即值域违规
  const deep = new Y.Map<unknown>();
  deep.set('inf', Number.POSITIVE_INFINITY);
  sentinel.set('deep', deep);
  root.set('sentinel', sentinel);
}

export interface BudgetFixture {
  readonly handle: DocHandle;
  readonly doc: Y.Doc;
  readonly persistence: ReturnType<typeof createMemoryPersistence>;
}

/** 经 MemoryPersistence 构造带 SCHEMA/ROOT 的 DocHandle（读取面测试无需写与 notifier）。 */
export async function makeBudgetHandle(opts: {
  text?: string;
  seedSchema?: boolean;
  raw?: boolean;
} = {}): Promise<BudgetFixture> {
  const persistence = createMemoryPersistence({ scheduler: realPersistenceScheduler });
  const doc = new Y.Doc();
  const env = { lang: 'vfsl', version: 1, id: 'ns-336', text: opts.text ?? TXT_336 };
  if (opts.seedSchema !== false) {
    const sc = doc.getMap('SCHEMA');
    for (const [k, v] of Object.entries(env)) sc.set(k, v);
  }
  const meta = doc.getMap('META');
  meta.set('docId', 'ns-336');
  meta.set('createdAt', 1_700_000_000_000);
  if (opts.raw === true) seedRawRoot(doc.getMap('ROOT'));
  else seedStrictRoot(doc.getMap('ROOT'));
  const handle = await persistence.createDoc(OWNER, 'ns-336', doc);
  return { handle, doc, persistence };
}

/** 以既有 handle 构造 runtime（registry 侧 runtimeFactory 复用同一入口）。 */
export function createBudgetRuntimeFromHandle(
  handle: DocHandle,
  opts: { p0Gate?: Promise<void> } = {},
): NamespaceRuntime {
  return createNamespaceRuntimeWithSeam({
    handle,
    ...(opts.p0Gate !== undefined ? { p0Gate: opts.p0Gate } : {}),
  });
}

/** 构造 runtime 并等待 P0 结算到 ready（schemaState === 'ready'）。 */
export async function makeBudgetRuntime(
  opts: { text?: string; seedSchema?: boolean; raw?: boolean; p0Gate?: Promise<void> } = {},
): Promise<NamespaceRuntime> {
  const { handle } = await makeBudgetHandle(opts);
  const runtime = createBudgetRuntimeFromHandle(handle, {
    ...(opts.p0Gate !== undefined ? { p0Gate: opts.p0Gate } : {}),
  });
  await waitForSchemaReady(runtime);
  return runtime;
}

/** 等待 runtime 的 schemaState 到 'ready'（沿既有 fixture 的 poll 纪律）。 */
export async function waitForSchemaReady(runtime: NamespaceRuntime): Promise<void> {
  await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
}

/** 构造 runtime + 暴露 handle/doc（差分矩阵与零物化哨兵需要独立预言机消费同一 doc）。 */
export async function makeBudgetRuntimeWithDoc(
  opts: { raw?: boolean } = {},
): Promise<{ runtime: NamespaceRuntime; doc: Y.Doc; handle: DocHandle }> {
  const { handle, doc } = await makeBudgetHandle(opts);
  const runtime = createBudgetRuntimeFromHandle(handle);
  await waitForSchemaReady(runtime);
  return { runtime, doc, handle };
}

// ───────────────────────── 敌意 options 构造器（组 F-x；§12-T1-F） ─────────────────────────

/** descriptor/get 分叉型伪装数据属性 Proxy（F-x3）：descriptor 报 data 值，get trap 回另一值。 */
export function descriptorGetSplitProxy(
  depthFromDescriptor: number,
  valueFromGet: unknown,
): { readonly options: object; readonly getCalls: () => number } {
  let getCalls = 0;
  const options = new Proxy(
    { depth: depthFromDescriptor },
    {
      get(target, key, receiver) {
        getCalls += 1;
        if (key === 'depth') return valueFromGet;
        return Reflect.get(target, key, receiver);
      },
    },
  );
  return { options, getCalls: () => getCalls };
}

/** 抛错 get trap Proxy（F-x4）：ownKeys/getOwnPropertyDescriptor 诚实转发，get trap 恒抛。 */
export function throwingGetProxy(depth: number): { readonly options: object; readonly getCalls: () => number } {
  let getCalls = 0;
  const options = new Proxy(
    { depth },
    {
      get(target, key, receiver) {
        getCalls += 1;
        void key;
        void receiver;
        throw new Error('probe: hostile get trap');
      },
    },
  );
  return { options, getCalls: () => getCalls };
}

/**
 * 状态化 descriptor trap（F-x5）：第 `throwFromCall` 次（含）起的 getOwnPropertyDescriptor
 * 抛错——首次校验（T1；2 次 descriptor 读：Object.keys 枚举过滤 + 显式 descriptor 读）
 * 通过、接缝净化期复掷。调用计数经 `descriptorCalls()` 暴露。
 */
export function statefulDescriptorProxy(
  depth: number,
  throwFromCall: number,
): { readonly options: object; readonly descriptorCalls: () => number } {
  let descriptorCalls = 0;
  const options = new Proxy(
    { depth },
    {
      getOwnPropertyDescriptor(target, key) {
        descriptorCalls += 1;
        if (descriptorCalls >= throwFromCall) throw new Error('probe: stateful descriptor trap');
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    },
  );
  return { options, descriptorCalls: () => descriptorCalls };
}

/**
 * 交替 descriptor trap（F-x6）：仅第 `throwOnCall` 次 getOwnPropertyDescriptor 抛错——
 * 使接缝净化失败而 T1 重派发又成功（出口② 接缝终态成员）。
 */
export function throwOnceDescriptorProxy(
  depth: number,
  throwOnCall: number,
): { readonly options: object; readonly descriptorCalls: () => number } {
  let descriptorCalls = 0;
  const options = new Proxy(
    { depth },
    {
      getOwnPropertyDescriptor(target, key) {
        descriptorCalls += 1;
        if (descriptorCalls === throwOnCall) throw new Error('probe: alternating descriptor trap');
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    },
  );
  return { options, descriptorCalls: () => descriptorCalls };
}

/** 非 enumerable own `depth` 键（F-x1）：T1 键空间（Object.keys）之外 → 无预算。 */
export function nonEnumerableDepthOptions(depth: number): object {
  const options: Record<string, unknown> = {};
  Object.defineProperty(options, 'depth', {
    value: depth,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return options;
}

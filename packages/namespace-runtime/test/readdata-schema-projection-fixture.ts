/**
 * issue #273 readData 语义 schema 投影 —— 共享契约 fixture（供 red 契约与负控两
 * 个测试文件共用；沿 vfsl resolve-schema-at-path-fixture.ts 与
 * real-persistence-scheduler.ts 先例——非测试文件，vitest 不收集）。
 *
 * TXT_273 覆盖位：scalar 标量终点 / ref 别名终点（按名保留）/ 别名内深读 / 数组元素
 * 终点 / optional 缺席 / Record + keyPattern / 字段级与别名级文档注释。数据载体：
 * `rogue` 与 `skus.ZZ1` 为 raw 复制式 schema 外数据（ADR-0010 raw 例外）；`nick`
 * （optional）与 `skus.cd`（Record 动态键）缺席——值缺席照常返 schema 的锚。
 */
import * as Y from 'yjs';
import { expect } from 'vitest';
import { createMemoryPersistence } from '@nomicore/persistence';
import type { DocHandle, User } from '@nomicore/persistence';
import { realPersistenceScheduler } from './real-persistence-scheduler.js';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import type { NamespaceRuntime } from '../src/index.js';

export const TXT_273 = `
type Sku = string & Pattern<"^[a-z]{2,6}$">;
/** 备注实体 */
type Meta = YMap<{
  /** 备注内容 */
  content: YLeaf<string>;
}>;
type ROOT = YMap<{
  /** 页面标题 */
  title: YLeaf<string>;
  count: YLeaf<number>;
  /** 元数据 */
  meta: Meta;
  /** 标签组 */
  tags: YLeaf<string>[];
  /** 库存（Record + keyPattern） */
  skus: Record<Sku, YLeaf<number>>;
  /** 可选昵称 */
  nick?: YLeaf<string>;
}>;
`.trim();

export const ENV_273 = { lang: 'vfsl', version: 1, id: 'ns-273', text: TXT_273 } as const;

export const OWNER: User = { userId: 'u-alice' };

/** ROOT 载体数据：字段大多在 schema 内；`rogue` 与 `skus.ZZ1` 为 raw 复制式
 *  schema 外数据（ADR-0010 raw 例外），供「路径偏离 schema → schema:null」锚定；
 *  `nick`（optional）与 `skus.cd`（Record 动态键）缺席——供「值缺席照常返 schema」。 */
export function seedRoot(root: Y.Map<unknown>): void {
  root.set('count', 3);
  root.set('title', 'hello');
  const meta = new Y.Map<string>();
  meta.set('content', 'hi');
  root.set('meta', meta);
  const tags = new Y.Array<string>();
  tags.push(['a', 'b', 'c']);
  root.set('tags', tags);
  const skus = new Y.Map<number>();
  skus.set('ab', 1);
  skus.set('ZZ1', 9); // keyPattern ^[a-z]{2,6}$ 失配 → 静态解析失败
  root.set('skus', skus);
  root.set('rogue', 'x'); // ROOT 封闭对象外的数据键
}

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** 经 MemoryPersistence 构造带 SCHEMA/ROOT 的 DocHandle（读取面测试无需写与 notifier）。 */
export async function makeHandle(opts: {
  text?: string;
  seedSchema?: boolean;
} = {}): Promise<{ handle: DocHandle; doc: Y.Doc; persistence: ReturnType<typeof createMemoryPersistence> }> {
  const persistence = createMemoryPersistence({ scheduler: realPersistenceScheduler });
  const doc = new Y.Doc();
  const env = { lang: 'vfsl', version: 1, id: 'ns-273', text: opts.text ?? TXT_273 };
  if (opts.seedSchema !== false) {
    const sc = doc.getMap('SCHEMA');
    for (const [k, v] of Object.entries(env)) sc.set(k, v);
  }
  const meta = doc.getMap('META');
  meta.set('docId', 'ns-273');
  meta.set('createdAt', 1_700_000_000_000);
  seedRoot(doc.getMap('ROOT'));
  const handle = await persistence.createDoc(OWNER, 'ns-273', doc);
  return { handle, doc, persistence };
}

/** 构造 runtime 并等待 P0 结算到 ready（schemaState === 'ready'）。 */
export async function makeReadyRuntime(): Promise<NamespaceRuntime> {
  const { handle } = await makeHandle();
  const runtime = createNamespaceRuntimeWithSeam({ handle });
  await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
  return runtime;
}

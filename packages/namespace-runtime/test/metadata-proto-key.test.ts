/**
 * SA6 F-1 回归锚 — getMetadata() 对 META `'__proto__'` 键的全键保真
 * （issue #89 / ADR-0008；SA4 静态验尸 verdict reject 唯一阻断项 F-1 回流）。
 *
 * 契约来源：
 * - wiki/raw/task_namespace-runtime-skeleton-p0_sa4_review.md F-1【REJECT】：
 *   「getMetadata() 深拷贝顶层 META Y.Map 的**全部键**」（ADR-0008 L31）/ AC4「META
 *   返回全部 plain JSON 字段」/ 设计 D5「逐键深拷贝」——projection.ts:134 顶层与
 *   :180 嵌套的裸赋值 `out[k] = …` 命中 Object.prototype.__proto__ accessor：
 *   标量值被 setter 静默忽略（键蒸发）、对象值替换返回对象原型（键丢失 + 原型被
 *   doc 内数据接管，属性回退链可见攻击者属性）。
 * - 仓内先例：doc-runtime extract.ts putSnapshotKey（R2.2/F-1 同型漏洞修复回流，
 *   注释明文「禁赋值式」）、read.ts putKey（E8/E9「经 defineProperty 写入 __proto__
 *   自有键不触发原型 setter」）。
 * - 可达性实证（SA4 附录 A）：P1 yjs Y.Map 可持 '__proto__' 键；P4 MemoryPersistence
 *   createDoc 接受含该键的 META（生产路径可达，仅校验 docId）；C1 Yjs 编解码
 *   round-trip 后键存活（持久化/跨会话可达）。
 *
 * 本文件断言纪律（SA2 N2）：全部锚公共接缝可观测输出——Object.hasOwn /
 * Object.getPrototypeOf / Object.keys / 属性值 / 引用同一性；禁 JSON.stringify 判等、
 * 禁读源码、不预设实现内部（SA3 用 defineProperty 或 null-proto 容器均可，只要可观测
 * 契约一致）。用例均为行为级红灯锚：当前实现（裸赋值）下断言真实失败（键丢失/原型
 * 替换），非模块缺失。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createMemoryPersistence } from '@nomicore/persistence';
import type { DocHandle, User } from '@nomicore/persistence';
import { realPersistenceScheduler } from './real-persistence-scheduler.js';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';

const OWNER: User = { userId: 'u-alice' };
const TEXT_VALID = 'type ROOT = { n: number; a: string; };';

/** META 含 docId/createdAt + 调用方给定其余键的 doc/handle（createDoc 生产路径）。
 *  fixture 纪律（R2 fixture 修订）：`'__proto__'` 键一律经 computed key
 *  `{ ['__proto__']: v }`（真 own enumerable data property）注入——字面量裸写
 *  `{ __proto__: v }` 是原型设置语法（标量值整条丢弃/对象值设置字面量自身原型），
 *  键永远不会进入 Y.Map，任何正确实现都无法转绿。 */
async function makeHandle(metaEntries: Record<string, unknown>): Promise<{
  persistence: ReturnType<typeof createMemoryPersistence>;
  handle: DocHandle;
  doc: Y.Doc;
}> {
  const persistence = createMemoryPersistence({ scheduler: realPersistenceScheduler });
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  sc.set('lang', 'vfsl');
  sc.set('version', 1);
  sc.set('id', 'ns-1');
  sc.set('text', TEXT_VALID);
  const meta = doc.getMap('META');
  meta.set('docId', 'ns-1');
  meta.set('createdAt', 1_700_000_000_000);
  for (const [k, v] of Object.entries(metaEntries)) {
    meta.set(k, v);
  }
  const root = doc.getMap('ROOT');
  root.set('n', 'str');
  const handle = await persistence.createDoc(OWNER, 'ns-1', doc);
  return { persistence, handle, doc };
}

describe('getMetadata META __proto__ 键保真（SA4 F-1 回归锚）', () => {
  it('顶层标量值 __proto__ 键：own 键保真、值原样、返回对象原型不被替换', async () => {
    const { handle } = await makeHandle({ ['__proto__']: 'evil-scalar' });
    const runtime = createNamespaceRuntimeWithSeam({ handle });

    const meta = runtime.getMetadata();
    expect(meta).toBeTypeOf('object');
    // 键保真：own 自有键存在（不因 Object.prototype.__proto__ accessor 静默蒸发）
    expect(Object.hasOwn(meta, '__proto__')).toBe(true);
    expect(Object.keys(meta)).toContain('__proto__');
    // 值原样（自身 data property 遮蔽继承 accessor；标量无 coercion）
    expect(meta['__proto__']).toBe('evil-scalar');
    // 原型未被替换：prototype 仍为 Object.prototype
    expect(Object.getPrototypeOf(meta)).toBe(Object.prototype);
  });

  it('顶层对象值 __proto__ 键：键保真 + 值深拷贝 + 返回对象原型不被 doc 数据替换', async () => {
    const payload = { evil: 'payload', level: 1, z: { deep: true } };
    const { handle } = await makeHandle({ ['__proto__']: payload });
    const runtime = createNamespaceRuntimeWithSeam({ handle });

    const meta = runtime.getMetadata();
    expect(Object.hasOwn(meta, '__proto__')).toBe(true);
    // 原型不被替换：不得经 setter 把原型切到 doc 内对象（getPrototypeOf 即公共可观测面）
    expect(Object.getPrototypeOf(meta)).toBe(Object.prototype);
    // 值深拷贝且内容一致
    expect(meta['__proto__']).toEqual(payload);
    expect((meta['__proto__'] as Record<string, unknown>).evil).toBe('payload');
    // 深拷贝隔离：突变本份副本不改 live/不影响重读（每调用独立副本）
    const first = runtime.getMetadata();
    ((first as Record<string, unknown>)['__proto__'] as Record<string, unknown>).evil = 'MUTATED';
    const second = runtime.getMetadata();
    expect((second as Record<string, unknown>)['__proto__']).toEqual(payload);
    expect(Object.getPrototypeOf(second)).toBe(Object.prototype);
  });

  it('嵌套 plain object 的 own __proto__ 键：嵌套层同样保真、嵌套副本原型不被替换', async () => {
    // JSON.parse 构造 own enumerable data property '__proto__'（真实可入 doc 的嵌套 plain 值）
    const nested = JSON.parse('{"origin":"seed","__proto__":{"evil":"nested-payload"}}') as Record<string, unknown>;
    const { handle } = await makeHandle({ sub: nested });
    const runtime = createNamespaceRuntimeWithSeam({ handle });

    const meta = runtime.getMetadata();
    const sub = meta['sub'] as Record<string, unknown>;
    expect(sub).toBeTypeOf('object');
    expect(sub).not.toBe(nested); // 深拷贝：非同一引用
    expect(Object.hasOwn(sub, 'origin')).toBe(true);
    expect(Object.hasOwn(sub, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(sub)).toBe(Object.prototype);
    expect(sub['__proto__']).toEqual({ evil: 'nested-payload' });
  });

  it('persistence round-trip（SA4 C1）：Yjs 编解码往返后 __proto__ 键存活且 Runtime 投影保真', async () => {
    const payload = { evil: 'payload', level: 1 };
    const { handle } = await makeHandle({ ['__proto__']: payload });
    // 经 Yjs 编码/应用创建第二个 live doc（模拟持久化/跨会话载入路径）
    const update = Y.encodeStateAsUpdate(handle.doc);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, update);
    const persistence2 = createMemoryPersistence({ scheduler: realPersistenceScheduler });
    const restoredHandle = await persistence2.createDoc(OWNER, 'ns-1', restored);
    const runtime = createNamespaceRuntimeWithSeam({ handle: restoredHandle });

    const meta = runtime.getMetadata();
    expect(Object.hasOwn(meta, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(meta)).toBe(Object.prototype);
    expect(meta['__proto__']).toEqual(payload);
  });

  it('T7.2 场景①（D-7 语义锁定锚）：META 数组值 non-enumerable 下标（值 5）照常投影——数组元素面无键空间概念（R2 映射①行为证据）', async () => {
    const { handle } = await makeHandle({ arr: [1, 2, 3] });
    // 注入通道纪律（R2.1-C）：注入后不经 loadDoc decode——yjs ContentAny 在同一 doc
    // 实例内本地持有原对象引用（F-3 cyclic 直注即存在性证明：decode 无法还原环；反之
    // ContentAny 编解码会把 descriptor 标准化）。本文件 makeHandle 为真实
    // MemoryPersistence createDoc 前 set、handle.doc 与预构建 doc 同一实例（fullchain
    // 同实例监听先例）——直注保持原引用，勿经「另实例 loadDoc 读回」通道。
    const arr = handle.doc.getMap('META').get('arr') as unknown[];
    Object.defineProperty(arr, 0, { value: 5, enumerable: false });
    const runtime = createNamespaceRuntimeWithSeam({ handle });

    const meta = runtime.getMetadata();
    // 现行语义锁定：数组元素面 non-enumerable data 下标照常读值（与对象键面 skip 有意不同）
    expect(meta['arr']).toEqual([5, 2, 3]);
  });

  it('T7.2 场景②（R2.1-A 姊妹断言：消息锁定锚）：non-enumerable ∧ value undefined 下标 → NSRT-META-E1 + 现行 violation 消息「数组位置 undefined 不可投影」', async () => {
    const { handle } = await makeHandle({ arr: [1, 2, 3] });
    const arr = handle.doc.getMap('META').get('arr') as unknown[];
    // 非枚举 ∧ 值 undefined 下标：显式给出 value:undefined + enumerable:false——
    // 注：`Object.defineProperty(arr, 1, {})`（空描述符）对**既有**下标不生效
    // （ES DefineProperty 对已存在可配置属性保留未提及字段），必须显式声明。
    Object.defineProperty(arr, 1, { value: undefined, enumerable: false });
    const runtime = createNamespaceRuntimeWithSeam({ handle });

    let err: unknown = '(no throw)';
    try {
      runtime.getMetadata();
    } catch (e) {
      err = e;
    }
    expect(err).not.toBe('(no throw)');
    const e = err as { code?: unknown; message?: unknown };
    expect(e.code).toBe('NSRT-META-E1');
    // 锁定现行 violation 消息（防 SA3 适配 ownDataFact 时漂移到「值域违规：undefined」）
    expect(String(e.message)).toContain('数组位置 undefined 不可投影');
  });
});

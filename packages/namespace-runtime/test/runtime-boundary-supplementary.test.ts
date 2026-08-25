/**
 * SA7 补充锚 — SA4 动态审核重点 #4/#5 的回归锚化（issue #89，动态验证轮产出）。
 *
 * 契约来源（均为公共接缝可观测行为，不预设实现内部）：
 * - SA4 动态清单 #4（F-3 登记态，LOW 备案）：seam 直通注入的循环引用 META 值 →
 *   getMetadata() 外抛**可捕获的原始 RangeError**（loud 家族、无稳定 code——
 *   SA4 R1 D1 / R2 复核登记态：不加环检测、维持 loud），进程/其余读取面不受影响、
 *   fatal 零污染。经 createDoc 不可达（persistence 编码期先崩），故用例在
 *   createDoc 之后向 live META 直注（SA4 探针同款路径）。
 * - SA4 动态清单 #5（设计 R3 边界「外部违约 release 后读取面」）：调用方越过
 *   runtime 直接 handle.release() → 读取面继续观察 live Y.Doc 引用（不崩、不静默
 *   换源），写位瞬时观察转 false（rootWrite/schemaWrite），read.enabled 保持 true。
 * - R1 附录 A P6（下游崩溃向量）：META `'__proto__'` 对象值键修复后，返回对象可被
 *   String()/模板字符串正常消费（裸赋值病理期继承 toString 为字符串 → TypeError）。
 *
 * 断言纪律（沿 SA2 N2）：Object.hasOwn / Object.getPrototypeOf / 值断言 /
 * toThrow / instanceof；禁 JSON.stringify 判等、禁读源码。
 * fixture 纪律（沿 R4）：`'__proto__'` 键一律 computed key 注入（真 own 键入 Y.Map）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createMemoryPersistence } from '@nomicore/persistence';
import type { DocHandle, User } from '@nomicore/persistence';
import { realPersistenceScheduler } from './real-persistence-scheduler.js';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import type { NamespaceRuntime } from '../src/index.js';

const OWNER: User = { userId: 'u-sa7' };
const TEXT_VALID = 'type ROOT = { n: number; a: string; };';

/** SCHEMA 有效 + META(docId/createdAt+extra) + ROOT(n:'str') 的 doc/handle。
 *  `'__proto__'` 键必须经 computed key 注入（字面量裸写是原型设置语法，键不入 Y.Map）。 */
async function makeHandle(
  docId: string,
  metaEntries: Record<string, unknown>,
): Promise<{ handle: DocHandle }> {
  const persistence = createMemoryPersistence({ scheduler: realPersistenceScheduler });
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  sc.set('lang', 'vfsl');
  sc.set('version', 1);
  sc.set('id', docId);
  sc.set('text', TEXT_VALID);
  const meta = doc.getMap('META');
  meta.set('docId', docId);
  meta.set('createdAt', 1_700_000_000_000);
  for (const [k, v] of Object.entries(metaEntries)) {
    meta.set(k, v);
  }
  doc.getMap('ROOT').set('n', 'str');
  const handle = await persistence.createDoc(OWNER, docId, doc);
  return { handle };
}

/** 轮询等待 P0 离开 preparing（微任务起步；SCHEMA 有效 → ready）。 */
async function settleP0(runtime: NamespaceRuntime): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (runtime.getStatus().schema.state !== 'preparing') return;
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }
  throw new Error('P0 未在预期时间内结算');
}

describe('SA7 补充锚：外部边界与登记态行为（SA4 动态清单 #4/#5）', () => {
  it('F-3 登记态：seam 直通循环 META 值 → getMetadata() 抛可捕获 RangeError，其余读取面与 fatal 零污染', async () => {
    const { handle } = await makeHandle('ns-f3', {});
    // createDoc 之后向 live META 直注循环引用（绕过 persistence 编码面——SA4 D1 同款可达路径）
    const cyc: Record<string, unknown> = { name: 'loop' };
    cyc.self = cyc;
    cyc.arr = [cyc];
    handle.doc.getMap('META').set('cyc', cyc);
    const runtime = createNamespaceRuntimeWithSeam({ handle });
    await settleP0(runtime);
    expect(runtime.getStatus().schema.state).toBe('ready');

    // loud：可捕获的原始 RangeError（登记态：无稳定 code，非 MetaProjectionError 包装）
    let caught: unknown = '(no throw)';
    try {
      runtime.getMetadata();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RangeError);

    // 其余读取面不受影响（同一 runtime 上照常工作）
    const env = runtime.getSchemaEnvelope();
    expect(env).not.toBeNull();
    expect(Object.keys(env as object).sort()).toEqual(['id', 'lang', 'text', 'version']);
    expect(runtime.read(['n'])).toEqual({ ok: true, value: 'str' });
    // fatal 零污染：循环值是 META 投影问题，不升级 internal fault
    const st = runtime.getStatus();
    expect(st.fatal).toBeNull();
    expect(st.schema.state).toBe('ready');
    expect(st.read.enabled).toBe(true);
  });

  it('外部违约 release 后：读取面照常（live 引用、不崩、值不变），写位瞬时观察转 false，read.enabled 保持 true', async () => {
    const { handle } = await makeHandle('ns-rel', { note: 'x' });
    let openGate: () => void = () => {};
    const p0Gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const runtime = createNamespaceRuntimeWithSeam({ handle, p0Gate });
    // 构造同步返回时 P0 未结算（INV-N1）
    expect(runtime.getStatus().schema.state).toBe('preparing');
    openGate();
    await settleP0(runtime);

    const before = runtime.getStatus();
    expect(before.schema.state).toBe('ready');
    expect(before.rootWrite.enabled).toBe(true);
    expect(before.schemaWrite.enabled).toBe(true);

    // 调用方越过 runtime 直接 release（调用方违约，设计 R3 边界）
    await handle.release();
    expect(handle.getStatus()).toBe('released');

    const after = runtime.getStatus();
    expect(after.read.enabled).toBe(true);
    expect(after.rootWrite.enabled).toBe(false);
    expect(after.schemaWrite.enabled).toBe(false);
    expect(after.schema.state).toBe('ready');
    expect(after.fatal).toBeNull();

    // 读取面照常：同一 live Y.Doc 引用，值不变、不崩
    expect(runtime.read(['n'])).toEqual({ ok: true, value: 'str' });
    const env = runtime.getSchemaEnvelope();
    expect(env?.lang).toBe('vfsl');
    const meta = runtime.getMetadata();
    expect(meta['docId']).toBe('ns-rel');
    expect(meta['note']).toBe('x');
    const active = runtime.getActiveSchema();
    expect(active).not.toBeNull();
    expect(active?.id).toBe('ns-rel');
  });

  it('P6 下游崩溃向量：META __proto__ 对象值键（含字符串 toString）的返回对象可被 String()/模板字符串消费', async () => {
    const { handle } = await makeHandle('ns-p6', { ['__proto__']: { evil: 'payload', toString: 'NOT-A-FUNCTION' } });
    const runtime = createNamespaceRuntimeWithSeam({ handle });
    const meta = runtime.getMetadata();
    expect(Object.hasOwn(meta, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(meta)).toBe(Object.prototype);
    // 修复后原型未被替换 → 转换走 Object.prototype.toString，不再 TypeError
    expect(() => String(meta)).not.toThrow();
    expect(`${meta}`).toBeTypeOf('string');
  });
});

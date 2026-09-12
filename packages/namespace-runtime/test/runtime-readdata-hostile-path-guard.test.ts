/**
 * SA3 验收测试（SA2 F-1 / 设计 D8）— readData schema 通道的敌意 path 规范化守卫
 * （issue #273 / ADR-0016）。
 *
 * 契约来源（SA2 评审 F-1 验收 ①②③ + 设计 §12 F-1 行 + SA8 iter-2 §10 复查清单
 * 第 6 条）：
 * - T1：重定义 `Symbol.iterator`（索引读正常）的敌意数组 → readData 不抛、返回恰
 *   `{ ok:true, value:3, schema:null }`，且敌意迭代器函数**从未被调用**（`iteratorCalls
 *   === 0`——「绝不调用迭代协议」的载荷锚，可执行断言）；
 * - T2：Proxy 数组（get 陷阱对 `Symbol.iterator` 键抛错、索引键反射透传）→ 不抛、
 *   恰 `{ ok:true, value:3, schema:null }`；
 * - T3：值通道缺席吸收后尾段异态（`['absent-key', Symbol()]`）→ 不抛、恰
 *   `{ ok:true, value:undefined, schema:null }` 且 `'schema' in r === true`（键在场）；
 * - 局部负控：合法 path `['count']` 不受守卫影响——schema 非 null 且内容等于
 *   红契约 #2 的字面量锚（防守卫过拒）。
 *
 * 共享夹具 readdata-schema-projection-fixture.ts **import-only，不改**（DENY）。
 * 值语义对照：readData 的 value 通道（doc-runtime 索引导航 + 吸收）对上述敌意 path
 * 的既有行为保持——schema 通道收敛 null、绝不外抛（D3b 内层 try 只包裹敌意 path
 * 扫描，不包裹 resolver 调用——InternalError 通道不受影响）。
 */
import { describe, expect, it } from 'vitest';
import { makeReadyRuntime } from './readdata-schema-projection-fixture.js';
import { expectReadDataOk } from './helpers/readdata-ok-shape.js';

describe('issue #273 F-1（D8）：readData schema 通道敌意 path 规范化守卫——收敛 schema:null、零 throw、零敌意函数调用', () => {
  it('T1：重定义 Symbol.iterator 的敌意数组（索引读正常）→ 不抛、恰 {ok:true,value:3,schema:null}，敌意迭代器零调用', async () => {
    const runtime = await makeReadyRuntime();
    const arr = ['count'] as (string | number)[];
    let iteratorCalls = 0;
    Object.defineProperty(arr, Symbol.iterator, {
      value() {
        iteratorCalls++;
        throw new Error('hostile iterator');
      },
    });
    const r = runtime.readData(arr);
    // ① 调用不抛且结果恰为收敛形状（读恒 ok、值语义与 doc-runtime 一致、schema null）
    expectReadDataOk(r, { value: 3, schema: null });
    // ② 敌意迭代器从未被调用（守卫只做同一性比较，绝不调用迭代协议）
    expect(iteratorCalls).toBe(0);
    await runtime.close();
  });

  it('T2：Proxy 数组（Symbol.iterator 键 get 陷阱抛错、索引键反射）→ 不抛、恰 {ok:true,value:3,schema:null}', async () => {
    const runtime = await makeReadyRuntime();
    const proxy = new Proxy(['count'], {
      get(t, p) {
        if (p === Symbol.iterator) throw new Error('hostile get');
        return Reflect.get(t, p);
      },
    });
    const r = runtime.readData(proxy as (string | number)[]);
    expectReadDataOk(r, { value: 3, schema: null });
    await runtime.close();
  });

  it('T3：值通道缺席吸收后尾段异态（["absent-key", Symbol()]）→ 不抛、恰 {ok:true,value:undefined,schema:null} 且 schema 键在场', async () => {
    const runtime = await makeReadyRuntime();
    const hostile = ['absent-key', Symbol('rogue')] as unknown as readonly (string | number)[];
    const r = runtime.readData(hostile);
    expectReadDataOk(r, { value: undefined, schema: null });
    expect('schema' in (r as unknown as Record<string, unknown>)).toBe(true);
    await runtime.close();
  });

  it('局部负控：合法 path ["count"] 不受守卫影响——schema 非 null 且等于字面量锚（红 #2 投影）', async () => {
    const runtime = await makeReadyRuntime();
    const r = runtime.readData(['count']);
    expectReadDataOk(r, {
      value: 3,
      schema: {
        valueSchema: { kind: 'scalar', type: 'number' },
        aliases: {},
        docs: {},
        aliasDocs: {},
      },
    });
    if (r.ok && r.schema !== null) {
      // 深拷贝可变异面抽检：结果投影非冻结（D5 可变普通副本纪律）
      expect(Object.isFrozen(r.schema.valueSchema)).toBe(false);
    }
    await runtime.close();
  });
});

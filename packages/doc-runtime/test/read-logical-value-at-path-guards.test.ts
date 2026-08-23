/**
 * 守卫移植测试 — @nomicore/doc-runtime readLogicalValueAtPath(doc, path) 双参形态
 * （issue #86 / ADR-0008；设计 §6.2 移植清单 R3 定稿，SA2 R3 verdict=pass）。
 *
 * 来源：原 read-logical-value-at-path-supplementary.test.ts 的载体无关通用守卫锚
 * （F2 非数组 path 全量家族 + E100 前缀 sub-family / 零副作用幂等 / -0 / NaN±∞ /
 * 2^53 / 对照修订 / SUP-5 vfsl seam 签名锁）按设计 §6.2 表中的**新双参形态**逐锚移植，
 * 期望值以设计表为准；另含 R2 新增锚（null 哨兵碰撞锁 / detached 载体守卫三形态并列 +
 * 别名集成对照 / 循环引用 E100 前缀锁 / 运行时野段锁 / __proto__ 防劫持锁 / Date 原型
 * 守卫锁 / Proxy trap-throw 收编锁）与 SA2 红线思路 1–10 的落地。
 *
 * 被删除锚（§6.2「不移植的旧锚」）：keyPattern/compilePattern 双参 seam——R1 事实错误
 * 更正（vfsl/test 26 个 .test.ts 零命中），SUP-5 是本公共接缝唯一签名锁，移植保全；
 * SUP-4（pattern 引擎 throw → C3）——keyPattern 概念随 schema-aware 语义消亡，E100
 * 前缀家族改由 F2 sub-family + 循环引用前缀锚钉住；Phase A 零 doc 触碰——Phase A 消亡，
 * 探针先行必然惰性创建 ROOT（机制变化，可观测断言由零副作用主锚改写后保全）。
 *
 * fixture 纪律（设计 §6.2「guards fixture 规格」）：每个 it 自造 doc、零跨 it 共享状态；
 * 零副作用锚的 doc.on('update') 计数器在 fixture 构造之后挂接（fixture 写入不计入读侧
 * 断言）；专用 fixture（holder/detached 族、cyc、__proto__、Date、Proxy）就地构造。
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as Y from 'yjs';
import { compilePattern, matchPattern, type CompiledPattern } from '@nomicore/vfsl';
import { readLogicalValueAtPath } from '../src/index.js';

// —— 测试契约类型（冻结形态，与 SA6 套件同款；message 为诊断增补，非契约字段）——

type ReadLogicalValueResult =
  | { ok: true; value: unknown }
  | { ok: false; code: 'PATH_NOT_ALLOWED'; path: readonly (string | number)[]; message?: string };

// —— 测试辅助（与 SA6 冻结套件同形）——

function expectOkValue(result: ReadLogicalValueResult): unknown {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`期望 ok:true，实际 code=${result.code}（path: ${JSON.stringify(result.path)}）`);
  }
  return result.value;
}

function expectUndefinedValue(result: ReadLogicalValueResult): void {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`期望 ok:true（合法缺键），实际 code=${result.code}`);
  }
  expect(Object.prototype.hasOwnProperty.call(result, 'value')).toBe(true);
  expect(result.value).toBeUndefined();
}

function expectNotAllowed(result: ReadLogicalValueResult, attemptedPath: readonly (string | number)[]): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error(`期望 PATH_NOT_ALLOWED，实际 ok:true（value=${JSON.stringify(result.value)}）`);
  }
  expect(result.code).toBe('PATH_NOT_ALLOWED');
  expect(result.path).toEqual(attemptedPath);
}

// —— 主 fixture（设计 §6.2「guards fixture 规格」精简子集；与冻结 buildDoc 同构命名）——

function buildMain(): { doc: Y.Doc } {
  const doc = new Y.Doc();
  const root = doc.getMap('ROOT');
  root.set('title', 'Hello');
  const items = new Y.Array();
  items.insert(0, ['k1', 'k2']);
  root.set('items', items);
  const cfg = new Y.Map();
  cfg.set('mode', 'fast');
  cfg.set('limit', 10);
  root.set('cfg', cfg);
  root.set('meta', { createdBy: 'jim', tags: ['a', 'b'] });
  root.set('arr', [1, 'two', true, null, { n: 'obj' }]); // arr[3] === null（哨兵碰撞锁双位之一）
  root.set('nothing', null);
  return { doc };
}

// —— 一、移植锚：F2 非数组 path 守卫（全量家族 11 变体 + E100 前缀 sub-family）——

describe('F2 守卫移植 — 非数组 path 全量家族（11 变体）', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['42', 42],
    ["'zz'", 'zz'],
    ['true', true],
    ['{}', {}],
    ['array-like {length:2}', { length: 2 }],
    ['Set', new Set<unknown>()],
    ['Map', new Map<unknown, unknown>()],
    ['1n', 1n],
    ['function', () => undefined],
  ])('非数组 path（%s）→ 归一失败 {ok:false, code:PATH_NOT_ALLOWED, path:[]} + message 非空，不抛出', (_label, badPath) => {
    const doc = new Y.Doc();
    const r = readLogicalValueAtPath(doc, badPath as never); // 守卫义务 = 不抛（直接调用，不包 try）
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('期望 PATH_NOT_ALLOWED');
    expect(r.code).toBe('PATH_NOT_ALLOWED');
    expect(r.path).toEqual([]);
    expect(typeof r.message).toBe('string');
    expect((r.message ?? '').length).toBeGreaterThan(0);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('非数组 path E100 前缀 sub-family（%s）：message 匹配 /^DOCRT-E100:/', (_label, badPath) => {
    const doc = new Y.Doc();
    const r = readLogicalValueAtPath(doc, badPath as never);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('期望 PATH_NOT_ALLOWED');
    expect(r.code).toBe('PATH_NOT_ALLOWED');
    expect(r.path).toEqual([]);
    expect(r.message).toMatch(/^DOCRT-E100:/);
  });
});

// —— 一、移植锚：零副作用 / 幂等（主锚 = 空 doc，R3 方案 (i)；对照锚 = 有数据 doc，方案 (ii)）——

describe('零副作用 / 幂等移植（主锚 + 对照锚，R2-1 拆锚）', () => {
  it('主锚（空 doc）：拒绝路径 [0] 零副作用 + 探针惰性创建后仍空 + 幂等含 message + 随读吸收', () => {
    const doc = new Y.Doc(); // ROOT 未建、零 set
    let updates = 0;
    doc.on('update', () => { updates++; }); // fixture 构造后挂接（零 set，无写入计数污染）
    // 拒绝路径 [0]：number 段下钻空 ROOT Y.Map → C1 段型不符（非空 path 回显，与 E100 path:[] 形态区分）
    const r1 = readLogicalValueAtPath(doc, [0]);
    expect(r1.ok).toBe(false);
    if (r1.ok) throw new Error('期望 PATH_NOT_ALLOWED');
    expect(r1.code).toBe('PATH_NOT_ALLOWED');
    expect(r1.path).toEqual([0]);
    // 探针惰性创建后仍空（机制变化：探针先行必然惰性创建；可观测断言：size 仍 0）
    expect(doc.getMap('ROOT').size).toBe(0);
    expect(updates).toBe(0);
    // 重复调用幂等（含 message；path 新鲜副本非别名）
    const r2 = readLogicalValueAtPath(doc, [0]);
    expect(r2).toEqual(r1);
    // 同一 doc 随读：空 map 缺键吸收 → ok:true undefined
    expectUndefinedValue(readLogicalValueAtPath(doc, ['nope']));
    // 空 path → 完整 ROOT 深拷贝 {}（update 仍 0）
    expect(expectOkValue(readLogicalValueAtPath(doc, []))).toEqual({});
    expect(updates).toBe(0);
  });

  it('对照锚（有数据 doc，独立 it）：标量下钻拒绝 + update 0 + toJSON 前后相等（不断言 size===0）', () => {
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('title', 'Hello');
    let updates = 0;
    doc.on('update', () => { updates++; }); // fixture 构造（set）之后挂接——写入不计入读侧断言
    expectNotAllowed(readLogicalValueAtPath(doc, ['title', 'x']), ['title', 'x']); // 标量下钻 C2
    expect(updates).toBe(0);
    const before = doc.getMap('ROOT').toJSON();
    expect(before).toEqual({ title: 'Hello' });
    expect(doc.getMap('ROOT').toJSON()).toEqual(before); // 读前后键集不变（toJSON 纯读零副作用）
  });
});

// —— 一、移植锚：对照锚（期望翻转修正，R2 #4i）——

describe('对照锚移植（期望翻转修正）', () => {
  it('["title"] → "Hello"；["nope"] → ok:true undefined（红线下期望翻转——原锚 notAllowed 与冻结 AC2 互斥）', () => {
    const { doc } = buildMain();
    expect(expectOkValue(readLogicalValueAtPath(doc, ['title']))).toBe('Hello');
    expectUndefinedValue(readLogicalValueAtPath(doc, ['nope']));
  });

  it('真拒绝对照：["title","x"] → PATH_NOT_ALLOWED（path 回显保留）', () => {
    const { doc } = buildMain();
    expectNotAllowed(readLogicalValueAtPath(doc, ['title', 'x']), ['title', 'x']);
  });
});

// —— 一、移植锚：段纪律（-0 归一 / NaN±∞ 守卫 / 超大合法下标 2^53）——

describe('段纪律锚移植（-0 / NaN / ±∞ / 2^53）', () => {
  it('-0 段归一 0：["items", -0] → "k1"', () => {
    const { doc } = buildMain();
    expect(expectOkValue(readLogicalValueAtPath(doc, ['items', -0]))).toBe('k1');
  });

  it.each([NaN, Infinity, -Infinity])('NaN/±∞ 段（%s）→ PATH_NOT_ALLOWED + path 回显', (seg) => {
    const { doc } = buildMain();
    const r = readLogicalValueAtPath(doc, ['items', seg]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('期望 PATH_NOT_ALLOWED');
    expect(r.code).toBe('PATH_NOT_ALLOWED');
    expect(r.path).toEqual(['items', seg]);
  });

  it('超大合法下标 2^53：越界 → ok:true undefined（吸收）', () => {
    const { doc } = buildMain();
    expectUndefinedValue(readLogicalValueAtPath(doc, ['items', 2 ** 53]));
  });
});

// —— 一、移植锚：SUP-5 vfsl seam 签名锁（R2 #3；vfsl/test 零命中，本锚是唯一覆盖）——

describe('SUP-5 移植 — vfsl pattern 公共接缝签名锁', () => {
  it('compilePattern/matchPattern 双参、返回 boolean；3 参负锁（charge 回调非公共契约）', () => {
    const compiled: CompiledPattern = compilePattern('^a+$');
    expect(matchPattern(compiled, 'aaa')).toBe(true);
    expect(matchPattern(compiled, 'bbb')).toBe(false);
    expectTypeOf(compiled).toEqualTypeOf<CompiledPattern>();
    expectTypeOf(compilePattern).parameters.toEqualTypeOf<[string]>();
    expectTypeOf(compilePattern).returns.toEqualTypeOf<CompiledPattern>();
    expectTypeOf(matchPattern).parameters.toEqualTypeOf<[CompiledPattern, string]>();
    expectTypeOf(matchPattern).returns.toEqualTypeOf<boolean>();
    // @ts-expect-error —— 3 参负锁：charge 记账参数是 validate 内部工作预算的实现细节，不进公共契约
    matchPattern(compiled, 'aaa', () => {});
  });
});

// —— 二、新增锚：null 哨兵碰撞锁（R2 #1：ProjectOutcome 判别联合防退化）——

describe('null 哨兵碰撞锁（R2 #1）', () => {
  it('["nothing"] → ok:true 且 value===null（区分 undefined）；["arr",3] → ok:true null', () => {
    const { doc } = buildMain();
    const r1 = readLogicalValueAtPath(doc, ['nothing']);
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error('期望 ok:true');
    expect(r1.value).toBeNull();
    expect(r1.value).not.toBeUndefined();
    expect(expectOkValue(readLogicalValueAtPath(doc, ['arr', 3]))).toBeNull();
  });
});

// —— 二、新增锚：detached 载体守卫（R2 #2 方案 a，三形态并列 + 别名集成对照 E20）——

describe('detached 载体守卫锁（R2 #2，导航与投影一律 loud）', () => {
  function buildHolder(): { doc: Y.Doc } {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    // 三形态 fixture：detached 实例（从未集成 doc）嵌入 plain 容器（公共 API 直接可达）
    const frag = new Y.XmlFragment();
    const p = new Y.XmlElement('p');
    p.insert(0, [new Y.XmlText('content')]);
    frag.insert(0, [p]);
    const ys = new Y.Map();
    root.set('holder', { frag, ys });
    // 别名集成对照（E20）：同一实例先 set 进 doc 集成、再别名塞进 plain 容器 → 借道读真实数据
    const inner = new Y.Map();
    inner.set('k', 1);
    root.set('innerRef', inner);
    root.set('holder2', { inner });
    return { doc };
  }

  it('借道中途遇 detached：["holder","ys","x"] → PATH_NOT_ALLOWED（navClassify 前置判别）', () => {
    const { doc } = buildHolder();
    expectNotAllowed(readLogicalValueAtPath(doc, ['holder', 'ys', 'x']), ['holder', 'ys', 'x']);
  });

  it('路径在 detached 上耗尽：["holder","ys"] → PATH_NOT_ALLOWED（projectValue 守卫）', () => {
    const { doc } = buildHolder();
    expectNotAllowed(readLogicalValueAtPath(doc, ['holder', 'ys']), ['holder', 'ys']);
  });

  it('detached XmlFragment 目标投影：["holder","frag"] → PATH_NOT_ALLOWED + path 回显', () => {
    const { doc } = buildHolder();
    expectNotAllowed(readLogicalValueAtPath(doc, ['holder', 'frag']), ['holder', 'frag']);
  });

  it('别名集成载体借道：["holder2","inner","k"] → ok:true 1（loud 判别是 detached 而非「内嵌即拒」，E20）', () => {
    const { doc } = buildHolder();
    expect(expectOkValue(readLogicalValueAtPath(doc, ['holder2', 'inner', 'k']))).toBe(1);
  });
});

// —— 二、新增锚：循环引用 → E100 前缀锁（D10/E10：同步不抛 + 崩溃边界通道）——

describe('循环引用 E100 前缀锁（D10/E10）', () => {
  it('cyc.self=cyc：["cyc"] → ok:false + message 匹配 /^DOCRT-E100:/（同步不抛）', () => {
    const doc = new Y.Doc();
    const cyc: Record<string, unknown> = { name: 'cyc' };
    cyc.self = cyc;
    doc.getMap('ROOT').set('cyc', cyc);
    const r = readLogicalValueAtPath(doc, ['cyc']);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('期望 PATH_NOT_ALLOWED');
    expect(r.message).toMatch(/^DOCRT-E100:/);
    expect(() => readLogicalValueAtPath(doc, ['cyc'])).not.toThrow();
  });
});

// —— 二、新增锚：运行时野段锁（E17：类型层已拒，运行时防御零抛点）——

describe('运行时野段锁（E17）', () => {
  it('["cfg", Symbol] / ["cfg", {}] → PATH_NOT_ALLOWED + path 回显，零外抛', () => {
    const { doc } = buildMain();
    const symPath: readonly (string | number)[] = ['cfg', Symbol('x')] as unknown as readonly (string | number)[];
    const objPath: readonly (string | number)[] = ['cfg', {}] as unknown as readonly (string | number)[];
    expectNotAllowed(readLogicalValueAtPath(doc, symPath), symPath);
    expectNotAllowed(readLogicalValueAtPath(doc, objPath), objPath);
  });
});

// —— 二、新增锚：__proto__ 防劫持锁（E8/E9：defineProperty 四真写入 + 原型不劫持）——

describe('__proto__ 防劫持锁（E8/E9）', () => {
  it('Y.Map 键 "__proto__"：["__proto__"] → ok:true 1；[] 全量读输出原型不劫持且键保留', () => {
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('__proto__', 1);
    expect(expectOkValue(readLogicalValueAtPath(doc, ['__proto__']))).toBe(1);
    const v = expectOkValue(readLogicalValueAtPath(doc, [])) as Record<string, unknown>;
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
    expect(Object.hasOwn(v, '__proto__')).toBe(true);
    expect(Reflect.get(v, '__proto__')).toBe(1);
  });

  it('plain object own "__proto__" 数据键（defineProperty 造）：正常投影 + 输出原型不劫持', () => {
    const doc = new Y.Doc();
    const po: Record<string, unknown> = {};
    Object.defineProperty(po, '__proto__', { value: 'pp', writable: true, enumerable: true, configurable: true });
    doc.getMap('ROOT').set('po', po);
    const r = readLogicalValueAtPath(doc, ['po']);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('期望 ok:true');
    const v = r.value as Record<string, unknown>;
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
    expect(Object.hasOwn(v, '__proto__')).toBe(true);
    expect(Reflect.get(v, '__proto__')).toBe('pp');
    expect(JSON.stringify(v)).toBe('{"__proto__":"pp"}'); // 普通 JSON 域（往返无损）
  });
});

// —— 二、新增锚：Date 原型守卫锁（nonPlainObject 家族：投影与下钻与全量读一律 loud）——

describe('Date 原型守卫锁（nonPlainObject 家族）', () => {
  it('new Date()：["d"] loud / ["d","x"] loud / [] 全量读亦 loud', () => {
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('d', new Date());
    expectNotAllowed(readLogicalValueAtPath(doc, ['d']), ['d']);
    expectNotAllowed(readLogicalValueAtPath(doc, ['d', 'x']), ['d', 'x']);
    expectNotAllowed(readLogicalValueAtPath(doc, []), []);
  });
});

// —— 二、新增锚：敌意抛出物二次异常防护（F1/P1+P9+P10：错误通道构造零外抛）——

describe('敌意抛出物二次异常防护（F1/P1+P9+P10）', () => {
  it('P1 敌意 toString：trap 抛出非 Error 对象且 toString 再抛 → ok:false 结构化不外抛（message 回退 unstringifiable）', () => {
    const doc = new Y.Doc();
    const evil = { toString() { throw new Error('toString boom'); } };
    doc.getMap('ROOT').set('p', new Proxy({ a: 1 }, { ownKeys() { throw evil; } }));
    let r: ReadLogicalValueResult | undefined;
    expect(() => { r = readLogicalValueAtPath(doc, ['p']); }).not.toThrow();
    expect(r?.ok).toBe(false);
    if (r === undefined || r.ok) throw new Error('期望结构化失败');
    expect(r.code).toBe('PATH_NOT_ALLOWED');
    expect(r.path).toEqual(['p']);
    expect(r.message).toMatch(/^DOCRT-E100:/);
    expect(r.message).toContain('unstringifiable');
  });

  it('P9 敌意 message getter：Error 实例 message 为 throwing getter → ok:false 结构化不外抛（message 回退 unstringifiable）', () => {
    const doc = new Y.Doc();
    const evilErr = new Error('x');
    Object.defineProperty(evilErr, 'message', { get() { throw new Error('message-getter boom'); } });
    doc.getMap('ROOT').set('p', new Proxy({ a: 1 }, { ownKeys() { throw evilErr; } }));
    let r: ReadLogicalValueResult | undefined;
    expect(() => { r = readLogicalValueAtPath(doc, ['p']); }).not.toThrow();
    expect(r?.ok).toBe(false);
    if (r === undefined || r.ok) throw new Error('期望结构化失败');
    expect(r.code).toBe('PATH_NOT_ALLOWED');
    expect(r.path).toEqual(['p']);
    expect(r.message).toMatch(/^DOCRT-E100:/);
    expect(r.message).toContain('unstringifiable');
  });

  it('P10 敌意 path 迭代器：Proxy 包装数组 path（Symbol.iterator get trap 抛）→ ok:false 不外抛（path 回退 []）', () => {
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('title', 'Hello');
    const evilPath = new Proxy(['title', 'x'], {
      get(target, key, receiver) {
        if (key === Symbol.iterator) throw new Error('iterator boom');
        return Reflect.get(target, key, receiver);
      },
    });
    let r: ReadLogicalValueResult | undefined;
    expect(() => { r = readLogicalValueAtPath(doc, evilPath); }).not.toThrow();
    expect(r?.ok).toBe(false);
    if (r === undefined || r.ok) throw new Error('期望结构化失败');
    expect(r.code).toBe('PATH_NOT_ALLOWED');
    expect(r.path).toEqual([]); // 敌意迭代器 → 归一回退 []
    expect(typeof r.message).toBe('string');
    expect((r.message ?? '').length).toBeGreaterThan(0);
  });

  it('R2-F1a NEW1 敌意 message 数据属性：Error 实例 message 覆写为敌意对象（toString 抛）→ ok:false 不外抛（收窄回退 unstringifiable）', () => {
    const doc = new Y.Doc();
    // 与 P9 的 throwing getter 不同：own **数据属性**覆写——属性读不抛、内层 try 原样
    // 放行；此前 ${safeDetail(err)} 模板插值的 ToString 发生在内层 try 之外 → 外泄。
    // 修复后按原始 string 收窄回退 'unstringifiable'
    const evilErr = new Error('x');
    Object.defineProperty(evilErr, 'message', {
      value: { toString() { throw new Error('hostile msg toString boom'); } },
      configurable: true,
    });
    doc.getMap('ROOT').set('p', new Proxy({ a: 1 }, { ownKeys() { throw evilErr; } }));
    let r: ReadLogicalValueResult | undefined;
    expect(() => { r = readLogicalValueAtPath(doc, ['p']); }).not.toThrow();
    expect(r?.ok).toBe(false);
    if (r === undefined || r.ok) throw new Error('期望结构化失败');
    expect(r.code).toBe('PATH_NOT_ALLOWED');
    expect(r.path).toEqual(['p']);
    expect(r.message).toMatch(/^DOCRT-E100:/);
    expect(r.message).toContain('unstringifiable');
  });

  it('R2-F1a NEW2 敌意 message Symbol：Error 实例 message 覆写为 Symbol → ok:false 不外抛（收窄回退 unstringifiable）', () => {
    const doc = new Y.Doc();
    // Symbol 的模板插值 ToString 恒抛 TypeError——若不做收窄，外泄向量与 NEW1 同构
    const evilErr = new Error('x');
    Object.defineProperty(evilErr, 'message', { value: Symbol('hostile'), configurable: true });
    doc.getMap('ROOT').set('p', new Proxy({ a: 1 }, { ownKeys() { throw evilErr; } }));
    let r: ReadLogicalValueResult | undefined;
    expect(() => { r = readLogicalValueAtPath(doc, ['p']); }).not.toThrow();
    expect(r?.ok).toBe(false);
    if (r === undefined || r.ok) throw new Error('期望结构化失败');
    expect(r.code).toBe('PATH_NOT_ALLOWED');
    expect(r.path).toEqual(['p']);
    expect(r.message).toMatch(/^DOCRT-E100:/);
    expect(r.message).toContain('unstringifiable');
  });
});

// —— 二、新增锚：Proxy trap-throw 收编锁（E22：traps 属调用方数据自带代码，throw → E100 不外抛）——

describe('Proxy trap-throw 收编锁（E22）', () => {
  it('ownKeys trap 抛出的 Proxy：["p"] → ok:false 结构化返回（E100 收编），不外抛', () => {
    const doc = new Y.Doc();
    // 注意：只让 ownKeys 抛（getPrototypeOf 保持默认）——yjs set 期对顶层值做 instanceof
    // 判定（getPrototypeOf trap），若该 trap 也抛则连 fixture 构造都会失败；E22 划界
    // 「trap throw → E100 收编」用 ownKeys 通道可达且零 fixture 污染
    const trap = new Proxy(
      { a: 1 },
      {
        ownKeys() { throw new Error('proxy trap boom'); },
      },
    );
    doc.getMap('ROOT').set('p', trap);
    let r: ReadLogicalValueResult | undefined;
    expect(() => { r = readLogicalValueAtPath(doc, ['p']); }).not.toThrow();
    expect(r?.ok).toBe(false);
    if (r === undefined || r.ok) throw new Error('期望结构化失败');
    expect(r.code).toBe('PATH_NOT_ALLOWED');
    expect(r.message).toMatch(/^DOCRT-E100:/);
  });
});

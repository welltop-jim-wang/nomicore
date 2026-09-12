/**
 * 形状预算 options 校验守卫 — @nomicore/doc-runtime readLogicalValueAtPath(doc, path, options?)
 * （issue #334 / ADR-0024 决策 1；SA6 验收契约 §12.2 校验矩阵 + §12.5 V1–V6 + §12.8 NC-5）。
 *
 * 契约来源：
 * - ADR-0024 决策 1：非法 options（负数、非整数、非有限数、非对象、含未知多余键）响亮拒绝，
 *   新稳定失败码 READ_OPTIONS_INVALID——同步、不抛；不借用路径失败码或生命周期失败码；
 * - SA6 §12.5：V1 定序（G0 → options 校验 → N0 → N1 → P1；G0 优先）、V2 零 doc 触碰、
 *   V3 零 throw/零副作用（绝不执行 getter/setter、不改 options、Proxy trap 抛收编）、
 *   V5 失败字段（path 新鲜回显 + 非空 message；禁带 value/truncated/truncations）、
 *   V6 码字面量稳定；
 * - SA6 §12.2 键空间口径：own enumerable string **data** 属性；symbol / 非 enumerable /
 *   继承键忽略；accessor 键非法且不执行（D5 同源）。
 *
 * 红灯现状（构造性红灯）：第三参今日被 JS 静默丢弃——非法 options 全部被静默接受为
 * ok:true 全量投影（无 READ_OPTIONS_INVALID 分支）→ 本文件红。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readLogicalValueAtPath } from '../src/index.js';
import type {
  ReadLogicalValueAtPathBudgetResult,
  ReadLogicalValueAtPathOptions,
} from '../src/index.js';

type Path = readonly (string | number)[];
type OptionsInvalid = Extract<
  ReadLogicalValueAtPathBudgetResult,
  { ok: false; code: 'READ_OPTIONS_INVALID' }
>;

function readBudget(
  doc: Y.Doc,
  path: Path,
  options: ReadLogicalValueAtPathOptions,
): ReadLogicalValueAtPathBudgetResult {
  return readLogicalValueAtPath(doc, path, options);
}

/** READ_OPTIONS_INVALID 失败形态（V5/V6）：同步单码、path 新鲜回显、非空 message、禁带预算成功键。 */
function expectOptionsInvalid(
  result: ReadLogicalValueAtPathBudgetResult,
  attemptedPath: Path,
): OptionsInvalid {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('期望 READ_OPTIONS_INVALID，实际 ok:true（非法 options 被静默接受）');
  expect(result.code).toBe('READ_OPTIONS_INVALID');
  expect(result.path).toEqual(attemptedPath);
  expect(typeof result.message).toBe('string');
  expect((result.message ?? '').length).toBeGreaterThan(0);
  expect(Object.prototype.hasOwnProperty.call(result, 'value')).toBe(false);
  expect(Object.prototype.hasOwnProperty.call(result, 'truncated')).toBe(false);
  expect(Object.prototype.hasOwnProperty.call(result, 'truncations')).toBe(false);
  if (result.code !== 'READ_OPTIONS_INVALID') throw new Error('期望 READ_OPTIONS_INVALID');
  return result;
}

/** 预算成功形态（合法 options）：恰四键、truncated 与清单一致。 */
function expectBudgetOk(result: ReadLogicalValueAtPathBudgetResult): {
  value: unknown;
  truncated: boolean;
  truncations: readonly unknown[];
} {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`期望预算读 ok:true，实际 code=${result.code}`);
  expect(Object.keys(result).sort()).toEqual(['ok', 'truncated', 'truncations', 'value']);
  expect(result.truncated).toBe(result.truncations.length > 0);
  return result;
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('ROOT').set('title', 'Hello');
  return doc;
}

// —— §12.2 非法矩阵：非对象 / 非 plain 宿主 / 未知键 / 值域 ——

const INVALID_OPTIONS: Array<[string, unknown]> = [
  ['null', null],
  ['42', 42],
  ["'x'", 'x'],
  ['true', true],
  ['1n', 1n],
  ['Symbol()', Symbol('options')],
  ['function', () => undefined],
  ['数组 []', []],
  ['数组 [0]', [0]],
  ['new Date()', new Date()],
  ['new Map()', new Map()],
  ['class 实例', new (class Probe { depth = 1; })()],
  ['Object.create({depth:1})', Object.create({ depth: 1 })],
  ['{bogus:1}', { bogus: 1 }],
  ['{bogus:undefined}', { bogus: undefined }],
  ['{depth:1,bogus:1}', { depth: 1, bogus: 1 }],
  ['{depth:-1}', { depth: -1 }],
  ['{maxChildrenPerNode:-1}', { maxChildrenPerNode: -1 }],
  ['{depth:1.5}', { depth: 1.5 }],
  ['{depth:NaN}', { depth: NaN }],
  ['{depth:Infinity}', { depth: Infinity }],
  ['{depth:-Infinity}', { depth: -Infinity }],
  ['{maxChildrenPerNode:NaN}', { maxChildrenPerNode: NaN }],
  ['{maxChildrenPerNode:Infinity}', { maxChildrenPerNode: Infinity }],
  ["{depth:'0'}", { depth: '0' }],
  ['{depth:null}', { depth: null }],
  ['{depth:{}}', { depth: {} }],
  ['{depth:1n}', { depth: 1n }],
  ['{depth:true}', { depth: true }],
  ['{maxChildrenPerNode:null}', { maxChildrenPerNode: null }],
];

describe('§12.2 options 校验矩阵 — 非法值响亮拒绝（READ_OPTIONS_INVALID，NC-5）', () => {
  it.each(INVALID_OPTIONS)(
    '非法 options（%s）→ {ok:false, code:READ_OPTIONS_INVALID, path 回显, 非空 message}，同步零外抛',
    (_label, options) => {
      const doc = makeDoc();
      let result: ReadLogicalValueAtPathBudgetResult | undefined;
      expect(() => {
        result = readBudget(doc, ['title'], options as ReadLogicalValueAtPathOptions);
      }).not.toThrow();
      if (result === undefined) throw new Error('期望结构化失败');
      expectOptionsInvalid(result, ['title']);
    },
  );

  it.each(INVALID_OPTIONS)('非法 options（%s）不得返回 ok:true（NC-5 反例）', (_label, options) => {
    const doc = makeDoc();
    const result = readBudget(doc, ['title'], options as ReadLogicalValueAtPathOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('READ_OPTIONS_INVALID');
  });
});

// —— §12.2 accessor 值 / accessor 未知键：绝不执行（V3） ——

describe('§12.2 accessor 纪律 — options 上的 getter/setter 绝不执行', () => {
  it('{get depth(){…}, set depth(v){…}} → READ_OPTIONS_INVALID 且 get/set 触发计数为 0', () => {
    const doc = makeDoc();
    const counters = { get: 0, set: 0 };
    const accessorValue: Record<string, unknown> = {};
    Object.defineProperty(accessorValue, 'depth', {
      enumerable: true,
      configurable: true,
      get() {
        counters.get++;
        return 1;
      },
      set() {
        counters.set++;
      },
    });
    expectOptionsInvalid(
      readBudget(doc, ['title'], accessorValue as unknown as ReadLogicalValueAtPathOptions),
      ['title'],
    );
    expect(counters.get).toBe(0);
    expect(counters.set).toBe(0);
  });

  it('setter-only {set maxChildrenPerNode(v){…}} → READ_OPTIONS_INVALID 且 setter 零执行', () => {
    const doc = makeDoc();
    const counters = { set: 0 };
    const setterOnly: Record<string, unknown> = {};
    Object.defineProperty(setterOnly, 'maxChildrenPerNode', {
      enumerable: true,
      configurable: true,
      set() {
        counters.set++;
      },
    });
    expectOptionsInvalid(
      readBudget(doc, ['title'], setterOnly as unknown as ReadLogicalValueAtPathOptions),
      ['title'],
    );
    expect(counters.set).toBe(0);
  });

  it('own enumerable accessor 未知键 {get bogus(){…}} → READ_OPTIONS_INVALID 且 getter 零执行', () => {
    const doc = makeDoc();
    const counters = { get: 0 };
    const unknownAccessor: Record<string, unknown> = {};
    Object.defineProperty(unknownAccessor, 'bogus', {
      enumerable: true,
      configurable: true,
      get() {
        counters.get++;
        return 1;
      },
    });
    expectOptionsInvalid(
      readBudget(doc, ['title'], unknownAccessor as unknown as ReadLogicalValueAtPathOptions),
      ['title'],
    );
    expect(counters.get).toBe(0);
  });
});

// —— §12.2 键空间口径：symbol / 非 enumerable / 继承键忽略（D5 同源） ——

describe('§12.2 options 键空间口径 — own enumerable string data 属性', () => {
  it('symbol / 非 enumerable 键忽略；继承键忽略（null 原型与 Object.prototype 原型均合法）', () => {
    const doc = makeDoc();
    const withIgnored: Record<string | symbol, unknown> = { depth: 0 };
    withIgnored[Symbol('bogus')] = 1;
    Object.defineProperty(withIgnored, 'hidden', { value: 1, enumerable: false, configurable: true });
    const r = expectBudgetOk(readBudget(doc, ['title'], withIgnored as unknown as ReadLogicalValueAtPathOptions));
    expect(r.value).toBe('Hello');
    expect(r.truncated).toBe(false);

    const nullProto = Object.create(null) as Record<string, unknown>;
    nullProto.depth = 0;
    const r2 = expectBudgetOk(readBudget(doc, [], nullProto as unknown as ReadLogicalValueAtPathOptions));
    expect(r2.value).toEqual({});
  });
});

// —— §12.2 合法矩阵 ——

const VALID_OPTIONS: Array<[string, unknown]> = [
  ['{}', {}],
  ['{depth:0}', { depth: 0 }],
  ['{depth:-0}', { depth: -0 }],
  ['{maxChildrenPerNode:0}', { maxChildrenPerNode: 0 }],
  ['{depth:0,maxChildrenPerNode:0}', { depth: 0, maxChildrenPerNode: 0 }],
  ['{depth:2**53}', { depth: 2 ** 53 }],
  ['{maxChildrenPerNode:2**53}', { maxChildrenPerNode: 2 ** 53 }],
  ['{depth:undefined}', { depth: undefined }],
  ['{depth:undefined,maxChildrenPerNode:undefined}', { depth: undefined, maxChildrenPerNode: undefined }],
];

describe('§12.2 合法 options — 预算读（4 键成功面、truncated:false、空清单）', () => {
  it.each(VALID_OPTIONS)('合法 options（%s）→ ok:true 恰四键，undefined 值键 ≡ 缺席', (_label, options) => {
    const doc = new Y.Doc();
    const r = expectBudgetOk(readBudget(doc, [], options as ReadLogicalValueAtPathOptions));
    expect(r.value).toEqual({});
    expect(r.truncated).toBe(false);
    expect(r.truncations).toEqual([]);
  });

  it('合法宿主：frozen / sealed / null 原型均接受（封闭形状只约束键与值）', () => {
    const doc = new Y.Doc();
    const frozen = Object.freeze({ depth: 0, maxChildrenPerNode: 1 });
    expect(expectBudgetOk(readBudget(doc, [], frozen)).truncated).toBe(false);
    const sealed = Object.seal({ depth: 1 });
    expect(expectBudgetOk(readBudget(doc, [], sealed)).truncated).toBe(false);
    const nullProto = Object.create(null) as Record<string, unknown>;
    nullProto.maxChildrenPerNode = 2;
    expect(expectBudgetOk(readBudget(doc, [], nullProto as unknown as ReadLogicalValueAtPathOptions)).truncated).toBe(
      false,
    );
  });

  it('depth:-0 ≡ 0（H10）：含内容 ROOT 上 → 骨架折叠 + depth 条目（与 depth:0 逐字同形）', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    root.set('a', 1);
    root.set('b', 2);
    const zero = expectBudgetOk(readBudget(doc, [], { depth: 0 }));
    const negativeZero = expectBudgetOk(readBudget(doc, [], { depth: -0 }));
    expect(negativeZero.value).toEqual(zero.value);
    expect(negativeZero.truncations).toEqual(zero.truncations);
    expect(negativeZero.truncations).toEqual([{ path: [], kind: 'depth', omitted: 2 }]);
  });
});

// —— §12.5 V3：敌意对象（Proxy trap 抛）—— 绝不外抛 ——

describe('§12.5 V3 敌意 options — Proxy trap 抛一律收编为 READ_OPTIONS_INVALID', () => {
  it('ownKeys trap 抛 → READ_OPTIONS_INVALID，零外抛', () => {
    const doc = makeDoc();
    const hostile = new Proxy({ depth: 1 }, { ownKeys() { throw new Error('ownKeys boom'); } });
    expectOptionsInvalid(readBudget(doc, ['title'], hostile), ['title']);
  });

  it('getOwnPropertyDescriptor trap 抛 → READ_OPTIONS_INVALID，零外抛', () => {
    const doc = makeDoc();
    const hostile = new Proxy(
      { depth: 1 },
      {
        ownKeys() {
          return ['depth'];
        },
        getPrototypeOf() {
          return Object.prototype;
        },
        getOwnPropertyDescriptor() {
          throw new Error('descriptor boom');
        },
      },
    );
    expectOptionsInvalid(readBudget(doc, ['title'], hostile), ['title']);
  });

  it('getPrototypeOf trap 抛 → READ_OPTIONS_INVALID，零外抛', () => {
    const doc = makeDoc();
    const hostile = new Proxy({}, { getPrototypeOf() { throw new Error('prototype boom'); } });
    expectOptionsInvalid(readBudget(doc, ['title'], hostile), ['title']);
  });

  it('get trap 抛：校验全程零 [[Get]]（get trap 计数 0），同步不抛', () => {
    const doc = makeDoc();
    const counters = { get: 0 };
    const hostile = new Proxy(
      { depth: 1 },
      {
        get(target, prop, receiver) {
          counters.get++;
          throw new Error('get boom');
        },
        getPrototypeOf() {
          return Object.prototype;
        },
      },
    );
    let result: ReadLogicalValueAtPathBudgetResult | undefined;
    expect(() => {
      result = readBudget(doc, ['title'], hostile);
    }).not.toThrow();
    expect(counters.get).toBe(0); // 探测不使用 [[Get]]（descriptor 读纪律）
    expect(result?.ok).toBe(true); // 仅 descriptor 可读时按 data 键判定（get trap 从不进入）
  });
});

// —— §12.5 V1 定序 + V2 零 doc 触碰 ——

describe('§12.5 V1/V2 options 校验定序与零 doc 触碰', () => {
  it('V1：G0 path 守卫优先于 options 校验（path 与 options 双非法 → PATH_NOT_ALLOWED）', () => {
    const doc = new Y.Doc();
    const result = readBudget(
      doc,
      null as unknown as Path,
      { depth: -1 } as unknown as ReadLogicalValueAtPathOptions,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('期望 PATH_NOT_ALLOWED');
    expect(result.code).toBe('PATH_NOT_ALLOWED');
    expect(result.path).toEqual([]);
  });

  it('V1：path 合法 + options 非法 → READ_OPTIONS_INVALID（校验在 N0 之前）', () => {
    const doc = makeDoc();
    expectOptionsInvalid(
      readBudget(doc, ['title'], { depth: -1 } as unknown as ReadLogicalValueAtPathOptions),
      ['title'],
    );
  });

  it('V2：非法 options 在 N0 前短路——fresh doc 的 ROOT 未被惰性创建、update 事件 +0', () => {
    const doc = new Y.Doc();
    let updates = 0;
    doc.on('update', () => {
      updates++;
    });
    expect(doc.share.has('ROOT')).toBe(false);
    expectOptionsInvalid(
      readBudget(doc, ['title'], { depth: 1.5 } as unknown as ReadLogicalValueAtPathOptions),
      ['title'],
    );
    expect(doc.share.has('ROOT')).toBe(false);
    expect(updates).toBe(0);
  });

  it('V2 对照自证：合法 options 读会触碰 doc（fresh doc 惰性建 ROOT）——零触碰锚有判别力', () => {
    const doc = new Y.Doc();
    expect(doc.share.has('ROOT')).toBe(false);
    expectBudgetOk(readBudget(doc, ['title'], {}));
    expect(doc.share.has('ROOT')).toBe(true);
  });

  it('V2：既有 doc 上非法 options 读不产生任何 update 事件（零写零事件）', () => {
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('title', 'Hello');
    let updates = 0;
    doc.on('update', () => {
      updates++;
    });
    expectOptionsInvalid(
      readBudget(doc, ['title'], { bogus: 1 } as unknown as ReadLogicalValueAtPathOptions),
      ['title'],
    );
    expect(updates).toBe(0);
  });
});

// —— §12.5 V3：零副作用 + §12.5 V5：path 新鲜回显 ——

describe('§12.5 V3/V5 零副作用与失败分支字段构成', () => {
  it('V3：合法/非法 options 读前后 options 深等且 own 键集不变（零变异）', () => {
    const doc = makeDoc();
    const legal = { depth: 1, maxChildrenPerNode: 2 };
    const beforeLegal = { ...legal };
    readBudget(doc, ['title'], legal);
    expect(legal).toEqual(beforeLegal);
    expect(Object.keys(legal)).toEqual(Object.keys(beforeLegal));

    const illegal = { depth: 1.5, extra: 1 };
    const beforeIllegal = { depth: illegal.depth, extra: illegal.extra };
    readBudget(doc, ['title'], illegal as unknown as ReadLogicalValueAtPathOptions);
    expect(illegal.depth).toBe(beforeIllegal.depth);
    expect(illegal.extra).toBe(beforeIllegal.extra);
    expect(Object.keys(illegal)).toEqual(['depth', 'extra']);
  });

  it('V5：失败分支 path 为 path 实参的新鲜回显副本（非别名）；非数组 path 走 G0 → []', () => {
    const doc = makeDoc();
    const callerPath: (string | number)[] = ['title'];
    const r = expectOptionsInvalid(
      readBudget(doc, callerPath, { depth: -1 } as unknown as ReadLogicalValueAtPathOptions),
      ['title'],
    );
    expect(r.path).not.toBe(callerPath);
    callerPath.push('mutated');
    expect(r.path).toEqual(['title']);
  });

  it('NC-4：合法 options + 路径缺陷仍 PATH_NOT_ALLOWED + path 回显，不被 options 分支掩盖', () => {
    const doc = makeDoc();
    const r = readBudget(doc, ['title', 'x'], { depth: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('期望 PATH_NOT_ALLOWED');
    expect(r.code).toBe('PATH_NOT_ALLOWED');
    expect(r.path).toEqual(['title', 'x']);
    expect(Object.prototype.hasOwnProperty.call(r, 'truncated')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(r, 'truncations')).toBe(false);
  });

  it('NC-5：非法 options 必须是 READ_OPTIONS_INVALID 单码（不得借 PATH_NOT_ALLOWED / RUNTIME_READ_DISABLED）', () => {
    const doc = makeDoc();
    const r = expectOptionsInvalid(
      readBudget(doc, ['title'], { depth: NaN } as unknown as ReadLogicalValueAtPathOptions),
      ['title'],
    );
    expect(r.code).not.toBe('PATH_NOT_ALLOWED');
  });
});

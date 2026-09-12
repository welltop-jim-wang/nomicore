/**
 * 形状预算行为验收 — @nomicore/doc-runtime readLogicalValueAtPath(doc, path, options?)
 * （issue #334 / ADR-0024 决策 1/2/3/6；SA6 验收契约 §12.7 S1–S27）。
 *
 * 契约来源：
 * - 任务简报 wiki/raw/task_issue-334.md（What-to-build + AC1–AC5）；
 * - docs/adr/0024-readdata-shape-budget.md 决策 1（depth/maxChildrenPerNode 语义、递归内生效、
 *   未展开分支零物化、depth:0 骨架读、终态 no-op、封闭 options 响亮拒绝 READ_OPTIONS_INVALID）、
 *   决策 2（截断省略为值内唯一形态=键省略；depth:0 目标自身同形空容器唯一例外）、
 *   决策 3（截断清单恒在场；条目 path/kind/omitted；omitted = 直接子项数，非后代总数）、
 *   决策 6（载体投影读取公共面三参化；预算贯通既有双递归，不新增第二条读路径）；
 * - SA6 验收契约 §12.3 B1–B16 / §12.4 / §12.6 F1–F14 / §12.7 S1–S27 / §12.8 NC-1…NC-8。
 *
 * SA6 迭代 1（detached 容器 d===0 裁决，消解 SA3 实现报告 §7）：S19④ 原「detached `Y.Map` 有 1 个
 * raw 子项 → omitted 1」前提与 Yjs 语义及 S21 互斥（未集成容器公共 count 恒 0）；本文件按 B16/R9
 * 修订为——折叠照常（B15）、rawTotal := 0（无条目、truncated:false）、对 detached 实例零公共 count 读；
 * d≥1 展开/保留物化仍走现行 detached 响亮失败面（S21/NC-8）。其余断言零改动。
 *
 * 断言纪律：
 * - 全部锚定公共接缝 ../src/index.js 的可观测行为（值形状 / 条目多重集 / 结果 own 键集）；
 * - 条目顺序不承诺（Y.Map 序不承诺）→ 一律按 (path, kind, omitted) 多重集断言；
 * - 精确前缀断言仅用于 Y.Array / plain array（下标序稳定）；Y.Map 前缀由现场 keys() 派生。
 *
 * 红灯现状（迭代 0 构造性红灯：缺口 = 三参形态 + 预算递归 + 截断事实通道整体不存在）：
 * - 类型层：`readLogicalValueAtPath` 只有双参签名 → 本文件 3 参调用报 TS2554；
 * - 运行时：第三参被 JS 语义静默丢弃 → 预算零效果（depth:0 仍全量物化、width 无操作）、
 *   非法 options 静默接受、成功面恒两键（无 truncated/truncations）、零物化哨兵必红。
 * SA3 实现预算递归后除 B16④ 外全部转绿（不弱化任何断言）；B16④ = 本版新增的 detached 零公共
 * count 读门禁，红因 = 实现折叠时仍读 `size`/`length`（yjs invalid access）；SA3 迭代 1 按 SA6
 * §15 A-1 在 `budgetFold` 加 `doc === null` 短路（rawTotal := 0）后本文件 33/33 全绿
 * （结果面断言不随之变化；m7/m8 变异反证见 SA3 实现报告 §6）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readLogicalValueAtPath } from '../src/index.js';
import type {
  ReadLogicalValueAtPathBudgetResult,
  ReadLogicalValueAtPathOptions,
  ReadLogicalValueResult,
  ReadLogicalValueTruncationEntry,
} from '../src/index.js';

// —— 测试辅助（SA6 §12.7 断言口径） ——

type Path = readonly (string | number)[];
/** 期望条目三元组（path, kind, omitted）。 */
type Entry = readonly [Path, 'depth' | 'width', number];

/** 三参（预算）读：静态型恰为 ReadLogicalValueAtPathBudgetResult（T1-2）。 */
function readBudget(doc: Y.Doc, path: Path, options: ReadLogicalValueAtPathOptions): ReadLogicalValueAtPathBudgetResult {
  return readLogicalValueAtPath(doc, path, options);
}

/** 预算成功形态：恰四键 {ok,value,truncated,truncations}（SA6 §12.4 决议）。 */
function expectBudgetOk(result: ReadLogicalValueAtPathBudgetResult): {
  ok: true;
  value: unknown;
  truncated: boolean;
  truncations: readonly ReadLogicalValueTruncationEntry[];
} {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`期望预算读 ok:true，实际 code=${result.code}（message=${String(result.message)}）`);
  }
  expect(Object.keys(result).sort()).toEqual(['ok', 'truncated', 'truncations', 'value']);
  expect(result.truncated).toBe(result.truncations.length > 0); // B14 不变量
  expect(Array.isArray(result.truncations)).toBe(true); // 恒在场（空清单仍是数组）
  return result;
}

/** 无 options 成功形态：旧契约两键（F1/NC-6）。 */
function expectLegacyOk(result: ReadLogicalValueResult): unknown {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`期望无 options 读 ok:true，实际 code=${result.code}`);
  expect(Object.keys(result).sort()).toEqual(['ok', 'value']);
  expect(Object.prototype.hasOwnProperty.call(result, 'truncated')).toBe(false);
  expect(Object.prototype.hasOwnProperty.call(result, 'truncations')).toBe(false);
  return result.value;
}

/** PATH_NOT_ALLOWED 失败形态（含合法 options 的路径缺陷读，NC-4）。 */
function expectNotAllowed(
  result: ReadLogicalValueAtPathResult,
  attemptedPath: Path,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error(`期望 PATH_NOT_ALLOWED，实际 ok:true`);
  expect(result.code).toBe('PATH_NOT_ALLOWED');
  expect(result.path).toEqual(attemptedPath);
  expect(Object.prototype.hasOwnProperty.call(result, 'truncations')).toBe(false); // 失败面禁带截断键
  expect(Object.prototype.hasOwnProperty.call(result, 'truncated')).toBe(false);
}

type ReadLogicalValueAtPathResult = ReadLogicalValueResult | ReadLogicalValueAtPathBudgetResult;

function entryKey(e: ReadLogicalValueTruncationEntry): string {
  return JSON.stringify([e.path, e.kind, e.omitted]);
}

function expectedEntryKey(e: Entry): string {
  return JSON.stringify([e[0], e[1], e[2]]);
}

/** 条目多重集断言（顺序不承诺；R6/B14：条目 (path,kind) 唯一 + omitted ≥ 1）。 */
function expectEntries(
  result: { truncations: readonly ReadLogicalValueTruncationEntry[] },
  expected: Entry[],
): void {
  for (const e of result.truncations) {
    expect(e.omitted).toBeGreaterThanOrEqual(1); // B14
    expect(e.kind === 'depth' || e.kind === 'width').toBe(true);
    expect(Array.isArray(e.path)).toBe(true);
  }
  const actualKeys = result.truncations.map(entryKey).sort();
  const expectedKeys = expected.map(expectedEntryKey).sort();
  expect(actualKeys).toEqual(expectedKeys);
}

// —— 夹具 ——

/** F-CANON（SA6 §12.7）：ROOT 插入序 9 键；cfg 供 Y.Map 现场序派生断言。 */
function makeCanonDoc(): { doc: Y.Doc; cfg: Y.Map<unknown> } {
  const doc = new Y.Doc();
  const root = doc.getMap('ROOT');
  root.set('title', 'Hello');
  root.set('count', 42);
  root.set('nothing', null);
  const items = new Y.Array<unknown>();
  items.insert(0, ['a', 'b', 'c', 'd']);
  root.set('items', items);
  const cfg = new Y.Map<unknown>();
  cfg.set('mode', 'fast');
  cfg.set('limit', 10);
  const extra = new Y.Array<unknown>();
  extra.insert(0, [1, 2]);
  cfg.set('extra', extra);
  root.set('cfg', cfg);
  const nested = new Y.Map<unknown>();
  const nk1 = new Y.Map<unknown>();
  nk1.set('x', 1);
  nested.set('k1', nk1);
  nested.set('k2', 'v');
  root.set('nested', nested);
  root.set('plainObj', { a: 1, b: { c: 2 } });
  root.set('plainArr', [10, 20, 30]);
  const xmlEl = new Y.XmlElement('p');
  xmlEl.insert(0, [new Y.XmlText('hi')]);
  root.set('xmlEl', xmlEl);
  return { doc, cfg };
}

// —— S1–S8：depth 预算（折叠 / 骨架 / 终态 / 恒在场） ——

describe('S1–S8 depth 预算 — 截断省略、depth:0 骨架、终态 no-op、恒在场', () => {
  it('S1 无 options（2 参）→ 恰两键全量投影、无截断键（F1/NC-6 冻结回归锚）', () => {
    const { doc } = makeCanonDoc();
    const value = expectLegacyOk(readLogicalValueAtPath(doc, ['cfg']));
    expect(value).toEqual({ mode: 'fast', limit: 10, extra: [1, 2] });
  });

  it('S2 depth:0 目标 Y.Map → 同形空容器 {}（proto=Object.prototype）+ 恰 1 条 depth 条目 omitted=raw 直接子项数', () => {
    const { doc } = makeCanonDoc();
    const r = expectBudgetOk(readBudget(doc, ['cfg'], { depth: 0 }));
    expect(r.value).toEqual({});
    expect(Object.getPrototypeOf(r.value as object)).toBe(Object.prototype);
    expect(r.truncated).toBe(true);
    expectEntries(r, [[['cfg'], 'depth', 3]]);
  });

  it('S3 depth:0 目标 Y.Array → 同形空数组 [] + 单条 depth 条目 omitted=length', () => {
    const { doc } = makeCanonDoc();
    const r = expectBudgetOk(readBudget(doc, ['items'], { depth: 0 }));
    expect(r.value).toEqual([]);
    expect(Array.isArray(r.value)).toBe(true);
    expectEntries(r, [[['items'], 'depth', 4]]);
  });

  it('S4 depth:0 空 path → ROOT 骨架 {} + 条目 path=[]（与实参同基，B9）', () => {
    const { doc } = makeCanonDoc();
    const r = expectBudgetOk(readBudget(doc, [], { depth: 0 }));
    expect(r.value).toEqual({});
    expect(r.truncated).toBe(true);
    expectEntries(r, [[[], 'depth', 9]]); // ROOT.size = 9
  });

  it('S5 depth:1 目标 Y.Map → 终态子项原样、容器子项折叠 + 条目 path 尾段即被裁键名（B1/B10）', () => {
    const { doc } = makeCanonDoc();
    const r = expectBudgetOk(readBudget(doc, ['nested'], { depth: 1 }));
    expect(r.value).toEqual({ k1: {}, k2: 'v' });
    expectEntries(r, [[['nested', 'k1'], 'depth', 1]]);
  });

  it('S6 depth:1 空 path → 终态原样 / 容器折叠；恰 5 条 depth 条目（B1/B2）', () => {
    const { doc } = makeCanonDoc();
    const r = expectBudgetOk(readBudget(doc, [], { depth: 1 }));
    expect(r.value).toEqual({
      title: 'Hello',
      count: 42,
      nothing: null,
      items: [],
      cfg: {},
      nested: {},
      plainObj: {},
      plainArr: [],
      xmlEl: '<p>hi</p>',
    });
    expect(r.truncated).toBe(true);
    expectEntries(r, [
      [['items'], 'depth', 4],
      [['cfg'], 'depth', 3],
      [['nested'], 'depth', 2],
      [['plainObj'], 'depth', 2],
      [['plainArr'], 'depth', 3],
    ]);
    // 终态子项不耗层、不记条目（title/count/nothing/xmlEl 无条目 = 上面恰 5 条已覆盖）
  });

  it('S7/S8 depth=2 或 depth=5（预算大于实际深度）→ 全量、truncated:false、truncations 空数组仍在场', () => {
    const { doc } = makeCanonDoc();
    for (const options of [{ depth: 2 }, { depth: 5 }] as const) {
      const r = expectBudgetOk(readBudget(doc, ['cfg'], options));
      expect(r.value).toEqual({ mode: 'fast', limit: 10, extra: [1, 2] });
      expect(r.truncated).toBe(false);
      expect(r.truncations).toEqual([]);
      expect(Object.prototype.hasOwnProperty.call(r, 'truncations')).toBe(true); // 恒在场（非条件在场）
    }
  });
});

// —— S9–S14：width 预算 ——

describe('S9–S14 width 预算 — 前缀保留、裁减在槽位枚举层、父路径单条条目', () => {
  it('S9 maxChildrenPerNode:2 目标 Y.Array → 前 2 项 + 单条 width 条目 omitted=rawTotal-K', () => {
    const { doc } = makeCanonDoc();
    const r = expectBudgetOk(readBudget(doc, ['items'], { maxChildrenPerNode: 2 }));
    expect(r.value).toEqual(['a', 'b']);
    expectEntries(r, [[['items'], 'width', 2]]);
  });

  it('S10 maxChildrenPerNode:0 → 全裁、同形空数组 + width 条目（B6）', () => {
    const { doc } = makeCanonDoc();
    const r = expectBudgetOk(readBudget(doc, ['items'], { maxChildrenPerNode: 0 }));
    expect(r.value).toEqual([]);
    expectEntries(r, [[['items'], 'width', 4]]);
  });

  it('S11 rawTotal ≤ K 边界（K=4 / K=99）→ 无截断、truncated:false、空清单', () => {
    const { doc } = makeCanonDoc();
    for (const options of [{ maxChildrenPerNode: 4 }, { maxChildrenPerNode: 99 }] as const) {
      const r = expectBudgetOk(readBudget(doc, ['items'], options));
      expect(r.value).toEqual(['a', 'b', 'c', 'd']);
      expect(r.truncated).toBe(false);
      expect(r.truncations).toEqual([]);
    }
  });

  it('S12 Y.Map 现场序派生：K=2 → Object.keys(value)=现场 keys() 前 2 项 + 父路径单条 width 条目', () => {
    const { doc, cfg } = makeCanonDoc();
    const expectedPrefix = [...cfg.keys()].slice(0, 2);
    const r = expectBudgetOk(readBudget(doc, ['cfg'], { maxChildrenPerNode: 2 }));
    expect(Object.keys(r.value as object)).toEqual(expectedPrefix);
    expectEntries(r, [[['cfg'], 'width', 1]]);
  });

  it('S13 plain 载体：plainArr K=1 → [10] omitted 2；plainObj K=1 → {a:1} omitted 1（B5/B6）', () => {
    const { doc } = makeCanonDoc();
    const arr = expectBudgetOk(readBudget(doc, ['plainArr'], { maxChildrenPerNode: 1 }));
    expect(arr.value).toEqual([10]);
    expectEntries(arr, [[['plainArr'], 'width', 2]]);
    const obj = expectBudgetOk(readBudget(doc, ['plainObj'], { maxChildrenPerNode: 1 }));
    expect(obj.value).toEqual({ a: 1 });
    expectEntries(obj, [[['plainObj'], 'width', 1]]);
  });

  it('S14 depth×width 复合：ROOT depth:1 + K=3 → 恰 1 条 width 条目（depth 折叠条目零出现，B3/B8）', () => {
    const { doc } = makeCanonDoc();
    const r = expectBudgetOk(readBudget(doc, [], { depth: 1, maxChildrenPerNode: 3 }));
    expect(r.value).toEqual({ title: 'Hello', count: 42, nothing: null });
    expectEntries(r, [[[], 'width', 6]]);
  });
});

// —— S15–S18：终态 no-op / 缺席吸收 / 键空间 / 路径缺陷 ——

describe('S15–S18 终态 no-op / 缺席吸收 / 键空间纪律 / 路径缺陷纪律', () => {
  it('S15 终态目标预算 no-op：标量/null 原样；xmlEl → 语义字符串；全部 truncated:false、空清单（B2）', () => {
    const { doc } = makeCanonDoc();
    const scalar = expectBudgetOk(readBudget(doc, ['title'], { depth: 0 }));
    expect(scalar.value).toBe('Hello');
    expect(scalar.truncated).toBe(false);
    expect(scalar.truncations).toEqual([]);
    const scalarBounded = expectBudgetOk(readBudget(doc, ['title'], { depth: 0, maxChildrenPerNode: 0 }));
    expect(scalarBounded.value).toBe('Hello');
    const nothing = expectBudgetOk(readBudget(doc, ['nothing'], { depth: 0 }));
    expect(nothing.value).toBeNull();
    const xml = expectBudgetOk(readBudget(doc, ['xmlEl'], { depth: 0 }));
    expect(xml.value).toBe('<p>hi</p>');
    expect(xml.truncated).toBe(false);
    expect(xml.truncations).toEqual([]);
  });

  it('S16 缺席吸收 + 预算：缺键 / 越界 / undefined 值键 → ok:true、value 键显式在场且 undefined、truncated:false', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const items = new Y.Array<unknown>();
    items.insert(0, ['a']);
    root.set('items', items);
    const cfg = new Y.Map<unknown>();
    cfg.set('u', undefined);
    root.set('cfg', cfg);
    for (const [path, options] of [
      [['absent'], {}],
      [['items', 99], { depth: 0 }],
      [['cfg', 'u'], { depth: 0 }],
    ] as ReadonlyArray<readonly [Path, ReadLogicalValueAtPathOptions]>) {
      const r = expectBudgetOk(readBudget(doc, path, options));
      expect(Object.prototype.hasOwnProperty.call(r, 'value')).toBe(true);
      expect(r.value).toBeUndefined();
      expect(r.truncated).toBe(false);
      expect(r.truncations).toEqual([]);
    }
  });

  it('S17 键空间纪律不破：accessor 零执行且不产出、原型链不参与、non-enumerable 不产出（F3）', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const counters = { secretReads: 0, protoReads: 0 };
    const acc: Record<string, unknown> = { own: 'x' };
    Object.defineProperty(acc, 'secret', {
      enumerable: true,
      configurable: true,
      get() {
        counters.secretReads++;
        return 's';
      },
    });
    root.set('acc', acc);
    const proto = Object.create({ inherited: 'from-proto' });
    Object.defineProperty(proto, 'inheritedGetter', {
      enumerable: true,
      configurable: true,
      get() {
        counters.protoReads++;
        return 'pg';
      },
    });
    const protoObj: Record<string, unknown> = Object.create(proto);
    protoObj.own = 'v';
    root.set('protoObj', protoObj);
    const nonEnum: Record<string, unknown> = { visible: 'v' };
    Object.defineProperty(nonEnum, 'hidden', {
      value: 'h',
      writable: true,
      enumerable: false,
      configurable: true,
    });
    root.set('nonEnum', nonEnum);

    const accValue = expectBudgetOk(readBudget(doc, ['acc'], { depth: 1 })).value as Record<string, unknown>;
    expect(accValue).toEqual({ own: 'x' });
    expect('secret' in accValue).toBe(false);
    expect(counters.secretReads).toBe(0);
    const protoValue = expectBudgetOk(readBudget(doc, ['protoObj'], { depth: 1 })).value as Record<string, unknown>;
    expect(protoValue).toEqual({ own: 'v' });
    expect(counters.protoReads).toBe(0);
    const nonEnumValue = expectBudgetOk(readBudget(doc, ['nonEnum'], { depth: 1 })).value as Record<string, unknown>;
    expect(nonEnumValue).toEqual({ visible: 'v' });
    expect('hidden' in nonEnumValue).toBe(false);
  });

  it('S18 路径缺陷纪律不破（NC-4）：合法 options 下段型不符 / 终态下钻 / 敌意 path 仍 PATH_NOT_ALLOWED + 回显、零外抛', () => {
    const { doc } = makeCanonDoc();
    expectNotAllowed(readBudget(doc, ['title', 'x'], {}), ['title', 'x']);
    expectNotAllowed(readBudget(doc, ['items', '0'], { depth: 0 }), ['items', '0']);
    expectNotAllowed(readBudget(doc, ['xmlEl', 'child'], {}), ['xmlEl', 'child']);
    expectNotAllowed(
      readBudget(doc, null as unknown as Path, { depth: 0 }),
      [],
    );
    // 敌意 path（Symbol.iterator get trap 抛）：导航在 ['title','x'] 第 2 段失败 → path 回显
    // 经 safeSpreadPath 收编回退 []，零外抛（与既有 guards P10 锚同款）
    const hostilePath = new Proxy(['title', 'x'] as (string | number)[], {
      get(target, prop, receiver) {
        if (prop === Symbol.iterator) throw new Error('hostile iterator');
        return Reflect.get(target, prop, receiver);
      },
    });
    let hostileResult: ReadLogicalValueAtPathResult | undefined;
    expect(() => {
      hostileResult = readBudget(doc, hostilePath, { depth: 0 });
    }).not.toThrow();
    expect(hostileResult?.ok).toBe(false);
    if (hostileResult === undefined) throw new Error('期望结构化失败');
    expectNotAllowed(hostileResult, []);
  });
});

// —— S19–S21：零物化哨兵与反证 ——

/** F-POISON：被预算覆盖的子树埋入投影不可表示值 / detached 载体。 */
function makePoisonDoc(): { doc: Y.Doc } {
  const doc = new Y.Doc();
  const root = doc.getMap('ROOT');
  root.set('title', 'Hello');
  root.set('poison', { ok: 1, bad: NaN, deep: { more: NaN } });
  const sparse: unknown[] = [1, , 3]; // 稀疏空洞（位置 1 无 descriptor）
  root.set('sparse', sparse);
  const detached = new Y.Map<unknown>();
  detached.set('k', 1); // 仅写内部 _prelimContent（非文档状态）；未集成容器公共 raw 计数恒 0（B16/R9）
  root.set('holder', { ys: detached });
  return { doc };
}

/**
 * detached 折叠夹具（SA6 §12.3 B16 / §12.11 R9）：plain holder 内嵌未集成 Y.Map / Y.Array，
 * 各挂一个公共 count 读计数器——用于证明折叠 detached 容器时实现不执行 yjs invalid access。
 */
function makeDetachedFoldDoc(): {
  doc: Y.Doc;
  detachedMap: Y.Map<unknown>;
  detachedArr: Y.Array<unknown>;
  mapCountReads: { count: number };
  arrCountReads: { count: number };
} {
  const doc = new Y.Doc();
  const root = doc.getMap('ROOT');
  const detachedMap = new Y.Map<unknown>();
  detachedMap.set('k', 1); // 仅写内部 _prelimContent（非文档状态）
  const detachedArr = new Y.Array<unknown>();
  detachedArr.insert(0, [1, 2, 3]); // 仅写内部 _prelimContent
  const mapCountReads = instrumentPublicCount(detachedMap, 'size');
  const arrCountReads = instrumentPublicCount(detachedArr, 'length');
  root.set('holder', { ys: detachedMap });
  root.set('holderArr', { ys: detachedArr });
  return { doc, detachedMap, detachedArr, mapCountReads, arrCountReads };
}

/**
 * 以 own accessor 覆盖 detached 容器的公共 count 读（`size` / `length`）并计数。
 * B16④：折叠 detached 容器时该读必须为 0（yjs 对未集成类型的读报 Invalid access，返回 0 只是回退）。
 */
function instrumentPublicCount(t: Y.Map<unknown> | Y.Array<unknown>, key: 'size' | 'length'): { count: number } {
  const state = { count: 0 };
  Object.defineProperty(t, key, {
    configurable: true,
    get() {
      state.count += 1;
      return 0;
    },
  });
  return state;
}

describe('S19–S21 零物化哨兵（depth/width）与反证', () => {
  it('NC-1 夹具自证：F-POISON 无 options 读 poison → PATH_NOT_ALLOWED（NaN 真不可表示）', () => {
    const { doc } = makePoisonDoc();
    expectNotAllowed(readLogicalValueAtPath(doc, ['poison']), ['poison']);
  });

  it('S19① depth:0 折叠 poison → ok:true {} + 条目 omitted=3（NaN 未读）', () => {
    const { doc } = makePoisonDoc();
    const r = expectBudgetOk(readBudget(doc, ['poison'], { depth: 0 }));
    expect(r.value).toEqual({});
    expectEntries(r, [[['poison'], 'depth', 3]]);
  });

  it('S19② ROOT depth:1 → poison/sparse/holder 在 D=0 折叠，不可表示值与 detached 载体均未被触碰', () => {
    const { doc } = makePoisonDoc();
    const r = expectBudgetOk(readBudget(doc, [], { depth: 1 }));
    expect(r.value).toEqual({ title: 'Hello', poison: {}, sparse: [], holder: {} });
    expectEntries(r, [
      [['poison'], 'depth', 3],
      [['sparse'], 'depth', 3],
      [['holder'], 'depth', 1],
    ]);
  });

  it('S19③ depth:0 折叠稀疏数组 → ok:true [] + 条目 omitted=3（空洞未读）', () => {
    const { doc } = makePoisonDoc();
    const r = expectBudgetOk(readBudget(doc, ['sparse'], { depth: 0 }));
    expect(r.value).toEqual([]);
    expectEntries(r, [[['sparse'], 'depth', 3]]);
  });

  it('S19④ detached 容器 d===0 折叠：{ys:{}} / {ys:[]}、truncated:false、无条目、零公共 count 读（B16/R9）', () => {
    // Yjs 13.6 实证（SA6 §5.4 / SA3 §7.2）：未集成容器的 set()/insert() 只写内部 _prelimContent，
    // 公共读数 size/length/keys() 恒为空且报「Invalid access」——真 detached（doc === null，S21
    // 成立的前提）与「公共 raw 子项数 ≥ 1」不可同时构造。故 B16 钉死：折叠照常发生（B15）、
    // rawTotal := 0（无 depth 条目、truncated:false）、且对被折 detached 实例零公共 count 读。
    const { doc, detachedMap, detachedArr, mapCountReads, arrCountReads } = makeDetachedFoldDoc();
    expect(detachedMap.doc).toBeNull(); // 真 detached（S21 前提）
    expect(detachedArr.doc).toBeNull();

    const mapFold = expectBudgetOk(readBudget(doc, ['holder'], { depth: 1 }));
    expect(mapFold.value).toEqual({ ys: {} }); // 折叠未被 detached 守卫拦截（B15）
    expect(mapFold.truncated).toBe(false);
    expectEntries(mapFold, []); // B16③：rawTotal 0 → 不记 depth 条目

    const arrFold = expectBudgetOk(readBudget(doc, ['holderArr'], { depth: 1 }));
    expect(arrFold.value).toEqual({ ys: [] }); // 同形载体一致（Y.Array）
    expect(arrFold.truncated).toBe(false);
    expectEntries(arrFold, []);

    expect(mapCountReads.count).toBe(0); // B16④：不执行 yjs invalid access（size）
    expect(arrCountReads.count).toBe(0); // B16④：不执行 yjs invalid access（length）
  });

  it('O-1（SA2 §14）目标入口折叠先于 detached 守卫：["holder","ys"],{depth:0} → ok:true {}（折叠读法锚定）', () => {
    const { doc, mapCountReads } = makeDetachedFoldDoc();
    const r = expectBudgetOk(readBudget(doc, ['holder', 'ys'], { depth: 0 }));
    expect(r.value).toEqual({}); // 目标入口折叠先于 detached 守卫（SA2 O-1 两读法择一：取折叠读法）
    expect(r.truncated).toBe(false);
    expectEntries(r, []); // B16③：detached 目标入口同款（rawTotal 0 → 无条目）
    expect(mapCountReads.count).toBe(0); // B16④：零公共 count 读
  });

  it('S20①② width 裁减在槽位枚举层：稀疏数组 K=1 → ["a"] omitted 2；K=0 → [] omitted 3（空洞未读）', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const mix: unknown[] = ['a', , 'c'];
    root.set('mix', mix);
    const one = expectBudgetOk(readBudget(doc, ['mix'], { maxChildrenPerNode: 1 }));
    expect(one.value).toEqual(['a']);
    expectEntries(one, [[['mix'], 'width', 2]]);
    const zero = expectBudgetOk(readBudget(doc, ['mix'], { maxChildrenPerNode: 0 }));
    expect(zero.value).toEqual([]);
    expectEntries(zero, [[['mix'], 'width', 3]]);
  });

  it('S20③ 折叠容器内的 Y.Text 未被读取：["textHolder"],{depth:1} → {wrap:{}} + 条目 omitted=1', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    root.set('textHolder', { wrap: { t: new Y.Text('x') } });
    const r = expectBudgetOk(readBudget(doc, ['textHolder'], { depth: 1 }));
    expect(r.value).toEqual({ wrap: {} });
    expectEntries(r, [[['textHolder', 'wrap'], 'depth', 1]]);
  });

  it('S20④ ROOT K=0 → {} + 单条 width 条目 omitted=ROOT.size（被裁子项零读取）', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const mix: unknown[] = ['a', , 'c'];
    root.set('mix', mix);
    root.set('textHolder', { wrap: { t: new Y.Text('x') } });
    const r = expectBudgetOk(readBudget(doc, [], { maxChildrenPerNode: 0 }));
    expect(r.value).toEqual({});
    expectEntries(r, [[[], 'width', root.size]]);
  });

  it('S21/NC-2/NC-7/NC-8 反证：预算覆盖到不可表示值时仍响亮失败（预算不洗白值域；折叠/展开对称）', () => {
    const { doc: poisonDoc } = makePoisonDoc();
    expectNotAllowed(readBudget(poisonDoc, ['poison'], { depth: 2 }), ['poison']);
    expectNotAllowed(readBudget(poisonDoc, ['holder'], { depth: 2 }), ['holder']); // detached 被展开
    const { doc: detachedDoc } = makeDetachedFoldDoc();
    expectNotAllowed(readBudget(detachedDoc, ['holder'], { depth: 2 }), ['holder']); // B16⑤：d≥1 走现行守卫
    expectNotAllowed(readBudget(detachedDoc, ['holderArr'], { depth: 2 }), ['holderArr']); // 同形载体一致
    const mixDoc = new Y.Doc();
    const root = mixDoc.getMap('ROOT');
    const mix: unknown[] = ['a', , 'c'];
    root.set('mix', mix);
    expectNotAllowed(readBudget(mixDoc, ['mix'], { maxChildrenPerNode: 2 }), ['mix']);
  });
});

// —— S22–S27：规模 / 显式 undefined / 直接子项数 / 空容器 / 值形态 / 隔离 ——

describe('S22–S27 规模形状（不计时）/ 隔离新鲜 / 直接子项数 / 空容器 / 值内形态', () => {
  it('S22 10k Y.Array 规模形状：K=5 → length 5 + omitted 9995；K=0 → [] + omitted 10000；K=10001 → 全量无截断', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const big = new Y.Array<unknown>();
    big.insert(
      0,
      Array.from({ length: 10000 }, (_, i) => i),
    );
    root.set('big', big);
    const five = expectBudgetOk(readBudget(doc, ['big'], { maxChildrenPerNode: 5 }));
    expect((five.value as unknown[]).length).toBe(5);
    expect(five.value).toEqual([0, 1, 2, 3, 4]);
    expectEntries(five, [[['big'], 'width', 9995]]);
    const zero = expectBudgetOk(readBudget(doc, ['big'], { maxChildrenPerNode: 0 }));
    expect(zero.value).toEqual([]);
    expectEntries(zero, [[['big'], 'width', 10000]]);
    const all = expectBudgetOk(readBudget(doc, ['big'], { maxChildrenPerNode: 10001 }));
    expect((all.value as unknown[]).length).toBe(10000);
    expect(all.truncated).toBe(false);
    expect(all.truncations).toEqual([]);
  });

  it('S23 显式 undefined 第三参（JS 形态）≡ 无 options：恰两键、无截断键（T1-5 运行时侧）', () => {
    const { doc } = makeCanonDoc();
    const r = readLogicalValueAtPath(doc, ['title'], undefined as never);
    expect(r.ok).toBe(true);
    expect(Object.keys(r).sort()).toEqual(['ok', 'value']);
    expect(Object.prototype.hasOwnProperty.call(r, 'truncated')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(r, 'truncations')).toBe(false);
    if (r.ok) expect(r.value).toBe('Hello');
  });

  it('S24 omitted = 直接子项数（非后代总数）：nested2 depth:0 → omitted 2 且显式断言 !== 4', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const nested2 = new Y.Map<unknown>();
    const nk1 = new Y.Map<unknown>();
    nk1.set('x', 1);
    nk1.set('y', 2);
    nk1.set('z', 3);
    const nk2 = new Y.Map<unknown>();
    nk2.set('w', 4);
    nested2.set('k1', nk1);
    nested2.set('k2', nk2);
    root.set('nested2', nested2);

    const folded = expectBudgetOk(readBudget(doc, ['nested2'], { depth: 0 }));
    expect(folded.value).toEqual({});
    expect(folded.truncations).toHaveLength(1);
    const only = folded.truncations[0]!;
    expect(only.path).toEqual(['nested2']);
    expect(only.kind).toBe('depth');
    expect(only.omitted).toBe(2); // 直接子项数
    expect(only.omitted).not.toBe(4); // 后代键总数（x,y,z,w）——反证：统计后代违背零物化

    const expanded = expectBudgetOk(readBudget(doc, ['nested2'], { depth: 1 }));
    expect(expanded.value).toEqual({ k1: {}, k2: {} });
    expectEntries(expanded, [
      [['nested2', 'k1'], 'depth', 3],
      [['nested2', 'k2'], 'depth', 1],
    ]);
  });

  it('S25 空容器 depth:0 折叠不记条目：{} / [] 均 truncated:false、清单为空（B4/R2）', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    root.set('emptyObj', {});
    root.set('emptyArr', []);
    const obj = expectBudgetOk(readBudget(doc, ['emptyObj'], { depth: 0 }));
    expect(obj.value).toEqual({});
    expect(obj.truncated).toBe(false);
    expect(obj.truncations).toEqual([]);
    const arr = expectBudgetOk(readBudget(doc, ['emptyArr'], { depth: 0 }));
    expect(arr.value).toEqual([]);
    expect(arr.truncated).toBe(false);
    expect(arr.truncations).toEqual([]);
    const arrWidth = expectBudgetOk(readBudget(doc, ['emptyArr'], { maxChildrenPerNode: 0 }));
    expect(arrWidth.value).toEqual([]);
    expect(arrWidth.truncated).toBe(false);
    expect(arrWidth.truncations).toEqual([]);
  });

  it('S26 值内形态纪律：被裁键缺席（非 undefined 在场）、无哨兵、D:0 目标是唯一空容器形态（F7/B12）', () => {
    const { doc } = makeCanonDoc();
    const width = expectBudgetOk(readBudget(doc, ['items'], { maxChildrenPerNode: 2 }));
    const arrValue = width.value as unknown[];
    expect(Object.hasOwn(arrValue, 2)).toBe(false);
    expect(Object.hasOwn(arrValue, 3)).toBe(false);
    expect(Object.keys(arrValue)).toEqual(['0', '1']);
    for (const k of Object.keys(arrValue)) expect(arrValue[Number(k)]).not.toBeUndefined();

    const composite = expectBudgetOk(readBudget(doc, [], { depth: 1, maxChildrenPerNode: 3 }));
    const objValue = composite.value as Record<string, unknown>;
    expect(Object.hasOwn(objValue, 'items')).toBe(false);
    expect(Object.hasOwn(objValue, 'cfg')).toBe(false);
    expect(Object.hasOwn(objValue, 'nested')).toBe(false);
    expect(Object.keys(objValue)).toEqual(['title', 'count', 'nothing']);
    for (const k of Object.keys(objValue)) expect(objValue[k]).not.toBeUndefined();

    const skeleton = expectBudgetOk(readBudget(doc, ['items'], { depth: 0 }));
    expect(Array.isArray(skeleton.value)).toBe(true); // D:0 目标自身同形空容器 = 唯一例外
  });

  it('S27 隔离/新鲜/幂等：深等但身份互异；突变返回值/条目/调用方 path/options 不影响后续读与原结果', () => {
    const { doc } = makeCanonDoc();
    const path: (string | number)[] = ['items'];
    const options = { maxChildrenPerNode: 2 };
    const first = expectBudgetOk(readBudget(doc, path, options));
    const second = expectBudgetOk(readBudget(doc, path, options));
    expect(first.value).toEqual(second.value);
    expect(first.truncations).toEqual(second.truncations);
    expect(first).not.toBe(second);
    expect(first.truncations).not.toBe(second.truncations); // 不得是模块级共享
    expect(first.truncations[0]).not.toBe(second.truncations[0]);
    expect(first.truncations[0]!.path).not.toBe(second.truncations[0]!.path);
    expect(first.truncations[0]!.path).not.toBe(path); // 与调用方实参非别名

    (first.value as unknown[]).push('mutated');
    (first.truncations[0]!.path as (string | number)[]).push('mutated-entry');
    const third = expectBudgetOk(readBudget(doc, path, options));
    expect(third.value).toEqual(['a', 'b']);
    expectEntries(third, [[['items'], 'width', 2]]);

    path.push('mutated-caller');
    options.maxChildrenPerNode = 99;
    expect(second.value).toEqual(['a', 'b']);
    expect(second.truncations).toEqual([{ path: ['items'], kind: 'width', omitted: 2 }]);

    const mutable = expectBudgetOk(readBudget(doc, ['plainArr'], { maxChildrenPerNode: 3 }));
    (mutable.value as unknown[]).push(99);
    expect(expectLegacyOk(readLogicalValueAtPath(doc, ['plainArr']))).toEqual([10, 20, 30]);
  });
});

/**
 * SA4 补充验证锚点 — readLogicalValueAtPath（issue #75，R1–R6 修订的行为锁）。
 *
 * 归属：设计 §5.1（SUP-1..SUP-6）/ §11 ALLOW LIST 明示本文件由 SA4/SA7 落地、SA3 不编写。
 * 锚点来源：SA2 R1 轮「红线测试思路」1–5 + SA1 设计 §5.1 收纳表：
 * - SUP-1 union 成员键空间交叉一致性锁（R1/D15）：`read(['items','BAD'])` 与
 *   `extractYjsSnapshot` ground truth 逐字相等——防实现给 Phase B 加回 per-member
 *   pattern 检查（那会与 extract 投影分歧，击穿 AC6-19 立论前提）；
 * - SUP-2 重叠联合成本护栏（R2/D13）：26 层重叠二员联合 + 末段全拒路径——memo 实现毫秒级；
 *   无 memo 实现指数级（Phase A 2^26 / Phase B 2^25 次访问）确定性超时；
 * - SUP-3 被拒路径零 doc 触碰（R3/D14/INV-10）+ probeRoot 惰性创建零 update（P4/INV-5）；
 * - SUP-4 pattern 引擎 throw → C3（R4）：message 以 `DOCRT-E100:` 开头（fail-closed，
 *   不冒充「不匹配」）；同锚兼证 required 缺席不冒充吸收式 undefined（伪降级禁令）；
 * - SUP-5 matchPattern 双参公共签名（R5）：charge 不进公共契约；
 * - SUP-6 模块级零可变态（R6/INV-11）：SA4 静态审查项，无运行时断言（见 SA4 审查报告）；
 * - 补充：D9 段形态边界（-0 / NaN / ±∞ / 超大整数下标）——SA6 20 用例未覆盖的 AC4 邻域。
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as Y from 'yjs';
import { compilePattern, matchPattern, parseVfsl, evaluate } from '@nomicore/vfsl';
import type { CompiledPattern, DerivedSchema } from '@nomicore/vfsl';
import { extractYjsSnapshot, readLogicalValueAtPath } from '../src/index.js';

function derivedOf(text: string): DerivedSchema {
  const parsed = parseVfsl(text);
  if (!parsed.ok) throw new Error(`前置 parseVfsl 失败（fixture 缺陷）：${JSON.stringify(parsed.issues)}`);
  const evaluated = evaluate(parsed.module);
  if (!evaluated.ok) throw new Error(`前置 evaluate 失败（fixture 缺陷）：${JSON.stringify(evaluated.issues)}`);
  return evaluated.derived;
}

function expectNotAllowed(result: ReturnType<typeof readLogicalValueAtPath>, attemptedPath: readonly (string | number)[]): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('期望 PATH_NOT_ALLOWED，实际 ok:true');
  expect(result.code).toBe('PATH_NOT_ALLOWED');
  expect(result.path).toEqual(attemptedPath);
}

// —— SUP-1：union 成员键空间交叉（R1/D15，设计 §4.5 反例同款 fixture）——

const MIXED_FIXTURE = `
type StrictId = string & Pattern<"^[a-z]+$">;
type Mixed = Record<StrictId, YXmlFragment<{ p: YArray<YLeaf<string>> }>> | Record<string, YLeaf<string>>;
type ROOT = YMap<{ items: Mixed }>;
`.trim();

const MIXED_DERIVED = derivedOf(MIXED_FIXTURE);

/** live：items = { BAD: <xml> }——'BAD' 违反成员 0 的 ^[a-z]+$，但被成员 1 键空间放行。 */
function buildMixedDoc(): Y.Doc {
  const doc = new Y.Doc();
  const items = new Y.Map();
  const frag = new Y.XmlFragment();
  const p = new Y.XmlElement('p');
  p.insert(0, [new Y.XmlText('BAD content')]);
  frag.insert(0, [p]);
  items.set('BAD', frag);
  doc.getMap('ROOT').set('items', items);
  return doc;
}

describe('SUP-1 union 键空间交叉一致性锁（R1/D15：Phase B 零 keyPattern 消费）', () => {
  it("['items','BAD']：成员 0（违其 pattern 的键）胜出并产出 XML 串，与 extractYjsSnapshot ground truth 逐字相等", () => {
    const doc = buildMixedDoc();
    const r = readLogicalValueAtPath(MIXED_DERIVED, doc, ['items', 'BAD']);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(`期望 ok:true，实际 ${r.code}`);
    expect(typeof r.value).toBe('string');

    // ground truth 双向锁：extract walkUnion 对 Record 形成员试验 = 直接 walk（零 pattern 消费）
    const snap = extractYjsSnapshot(MIXED_DERIVED, doc);
    expect(snap.ok).toBe(true);
    if (!snap.ok) throw new Error('extract ground truth 失败');
    const extracted = (snap.snapshot as { items: Record<string, unknown> }).items;
    expect(extracted).toHaveProperty('BAD');
    expect(r.value).toBe(extracted.BAD); // 两条读取路径对同 doc 投影必须逐字一致
  });

  it("对照 ['items','abc']（两成员键空间均许可）：live 缺席 → 吸收式 value:undefined（value 键显式存在）", () => {
    const doc = buildMixedDoc();
    const r = readLogicalValueAtPath(MIXED_DERIVED, doc, ['items', 'abc']);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(`期望 ok:true，实际 ${r.code}`);
    expect(Object.prototype.hasOwnProperty.call(r, 'value')).toBe(true);
    expect(r.value).toBeUndefined();
  });

  it("对照 ['items','BAD','x']：xml/leaf 双终态拒绝剩余段 → PATH_NOT_ALLOWED", () => {
    const doc = buildMixedDoc();
    expectNotAllowed(readLogicalValueAtPath(MIXED_DERIVED, doc, ['items', 'BAD', 'x']), ['items', 'BAD', 'x']);
  });
});

// —— SUP-2：重叠联合最坏路径成本护栏（R2/D13；层数取 26，SA2 复审观察 #1）——

const CHAIN_DEPTH = 26;

function chainFixture(depth: number): string {
  const lines: string[] = [`type L${depth} = { t1: YLeaf<string> } | { t2: YLeaf<string> };`];
  for (let k = depth - 1; k >= 1; k--) {
    lines.push(`type L${k} = { x: L${k + 1}; t1: YLeaf<string> } | { x: L${k + 1}; t2: YLeaf<string> };`);
  }
  lines.push('type ROOT = YMap<{ e: L1 }>;');
  return lines.join('\n');
}

const CHAIN_DERIVED = derivedOf(chainFixture(CHAIN_DEPTH));

/** live：e = 26 层嵌套 Y.Map（每层 {x: 下一层}，底层空 map）；bottomFilled 时底层带 t1。 */
function buildChainDoc(bottomFilled: boolean): Y.Doc {
  const doc = new Y.Doc();
  let cur: Y.Map<unknown> = new Y.Map();
  if (bottomFilled) cur.set('t1', 'v');
  for (let k = 0; k < CHAIN_DEPTH - 1; k++) {
    const outer = new Y.Map();
    outer.set('x', cur);
    cur = outer;
  }
  doc.getMap('ROOT').set('e', cur);
  return doc;
}

describe('SUP-2 重叠联合成本护栏（R2/D13：memo 折叠指数回溯）', () => {
  const xs: string[] = Array.from({ length: CHAIN_DEPTH - 1 }, () => 'x');

  it(`Phase A：${CHAIN_DEPTH} 层 × 末段全拒路径（['e',x×${CHAIN_DEPTH - 1},'absent']）→ PATH_NOT_ALLOWED 且 <2s（无 memo 为 2^${CHAIN_DEPTH} 级）`, () => {
    const doc = new Y.Doc();
    const t0 = performance.now();
    const r = readLogicalValueAtPath(CHAIN_DERIVED, doc, ['e', ...xs, 'absent']);
    const elapsed = performance.now() - t0;
    expectNotAllowed(r, ['e', ...xs, 'absent']);
    expect(elapsed).toBeLessThan(2000);
  });

  it(`Phase B：${CHAIN_DEPTH} 层 × required 缺席路径（['e',x×${CHAIN_DEPTH - 1},'t1']，底层空）→ PATH_NOT_ALLOWED（非吸收式 undefined）且 <2s（无 memo 为 2^${CHAIN_DEPTH - 1} 级）`, () => {
    const doc = buildChainDoc(false);
    const t0 = performance.now();
    const r = readLogicalValueAtPath(CHAIN_DERIVED, doc, ['e', ...xs, 't1']);
    const elapsed = performance.now() - t0;
    // 伪降级禁令锚：required 缺席（C2，不变量外）必须 loud 拒绝，不得冒充 AC3 吸收式 undefined
    expectNotAllowed(r, ['e', ...xs, 't1']);
    expect(elapsed).toBeLessThan(2000);
  });

  it(`正向对照：底层 t1 在场 → ['e',x×${CHAIN_DEPTH - 1},'t1'] 穿透 ${CHAIN_DEPTH} 层联合返回 'v'（fixture 正当性自证）`, () => {
    const doc = buildChainDoc(true);
    const r = readLogicalValueAtPath(CHAIN_DERIVED, doc, ['e', ...xs, 't1']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('v');
  });
});

// —— SUP-3：被拒路径零 doc 触碰（R3/D14/INV-10）+ 惰性创建零 update（P4/INV-5）——

const BASIC_FIXTURE = `
type ROOT = YMap<{ title: YLeaf<string> }>;
`.trim();

const BASIC_DERIVED = derivedOf(BASIC_FIXTURE);

describe('SUP-3 被拒路径零 doc 触碰 + probeRoot 惰性创建零事件', () => {
  it("['nope'] 拒绝后：ROOT 仍为空、零 update 事件、重复调用幂等；随后 [] 读取 {} 仍零 update", () => {
    const doc = new Y.Doc();
    let updates = 0;
    doc.on('update', () => { updates += 1; });

    const r1 = readLogicalValueAtPath(BASIC_DERIVED, doc, ['nope']);
    expectNotAllowed(r1, ['nope']);
    expect(doc.getMap('ROOT').size).toBe(0); // 拒绝路径不触发惰性创建（Phase A 先行，probeRoot 后置）
    expect(updates).toBe(0);

    const r2 = readLogicalValueAtPath(BASIC_DERIVED, doc, ['nope']);
    expect(r2).toEqual(r1); // 幂等（含 message 一致；path 为新鲜副本非别名）

    const r3 = readLogicalValueAtPath(BASIC_DERIVED, doc, []);
    expect(r3.ok).toBe(true);
    if (r3.ok) expect(r3.value).toEqual({});
    expect(updates).toBe(0); // P4：probeRoot 惰性创建实测零 update 事件（INV-5 读取零写入）
    expect(doc.getMap('ROOT').size).toBe(0);
  });
});

// —— SUP-4：pattern 引擎 throw → C3（R4：DOCRT-E100 前缀，fail-closed）——

const BAD_PATTERN_FIXTURE = `
type BadKey = string & Pattern<"(">;
type ROOT = YMap<{ recs: Record<BadKey, YLeaf<string>> }>;
`.trim();

const BAD_PATTERN_DERIVED = derivedOf(BAD_PATTERN_FIXTURE);

describe('SUP-4 pattern 编译失败 → C3（message 前缀 DOCRT-E100）', () => {
  it("不可编译 keyPattern + 零键 Record：['recs','any'] → PATH_NOT_ALLOWED 且 message 以 'DOCRT-E100:' 开头", () => {
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('recs', new Y.Map()); // Record 零键（validate 从未编译过该 pattern）
    const r = readLogicalValueAtPath(BAD_PATTERN_DERIVED, doc, ['recs', 'any']);
    expectNotAllowed(r, ['recs', 'any']);
    if (r.ok) throw new Error('unreachable');
    expect(typeof r.message).toBe('string');
    expect(r.message).toMatch(/^DOCRT-E100:/); // R4 统一裁定：引擎 throw 归 C3，不冒充「不匹配」
  });
});

// —— SUP-5：matchPattern 双参公共签名（R5：charge 不进公共契约）——

describe('SUP-5 matchPattern 双参公共签名（R5）', () => {
  it('compilePattern + matchPattern(compiled, input) 双参可调；3 参形态非公共契约（类型层拒绝）', () => {
    const compiled = compilePattern('^a+$');
    expect(matchPattern(compiled, 'aaa')).toBe(true);
    expect(matchPattern(compiled, 'b')).toBe(false);
    expectTypeOf(matchPattern).parameter(0).toEqualTypeOf<CompiledPattern>();
    expectTypeOf(matchPattern).parameter(1).toEqualTypeOf<string>();
    expectTypeOf(matchPattern).returns.toEqualTypeOf<boolean>();
    // @ts-expect-error —— 3 参形态（charge 记账回调）非公共契约：多参调用必须编译错误（R5）
    matchPattern(compiled, 'a', () => {});
  });
});

// —— D9 段形态边界补充锚（SA6 20 用例未覆盖的 AC4 邻域；设计 §4.4 分段规则表）——

const ARRAY_FIXTURE = `
type ROOT = YMap<{ kw: YArray<YLeaf<string>> }>;
`.trim();

const ARRAY_DERIVED = derivedOf(ARRAY_FIXTURE);

describe('D9 段形态边界补充锚（-0 / NaN / ±∞ / 超大整数下标）', () => {
  it('[-0] 经 JS 属性访问语义归一为 0 → 返回首元素', () => {
    const doc = new Y.Doc();
    const kw = new Y.Array();
    kw.insert(0, ['a', 'b']);
    doc.getMap('ROOT').set('kw', kw);
    const r = readLogicalValueAtPath(ARRAY_DERIVED, doc, ['kw', -0]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('a');
  });

  it.each([NaN, Infinity, -Infinity])('%s 下标 → PATH_NOT_ALLOWED（非整数/非法）', (seg) => {
    const doc = new Y.Doc();
    const kw = new Y.Array();
    kw.insert(0, ['a', 'b']);
    doc.getMap('ROOT').set('kw', kw);
    expectNotAllowed(readLogicalValueAtPath(ARRAY_DERIVED, doc, ['kw', seg]), ['kw', seg]);
  });

  it('超大但合法的整数下标（2^53，越界）→ 吸收式 value:undefined', () => {
    const doc = new Y.Doc();
    const kw = new Y.Array();
    kw.insert(0, ['a', 'b']);
    doc.getMap('ROOT').set('kw', kw);
    const r = readLogicalValueAtPath(ARRAY_DERIVED, doc, ['kw', 2 ** 53]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeUndefined();
  });
});

// —— SA7 动态验证锚（2026-08-22，SA4 R2「动态审核重点」第 1 项）——
// F2 崩溃边界守卫回归锁：非数组 path（JS/运行时动态调用方可达面）必须结构化返回、
// 绝不外抛（FC-1/INV-3/D11 + 设计 §4.1 SA4-F2 勘误守卫）。此前该守卫仅由 SA4
// 运行后即删的探针验证（10 变体），已提交测试面零覆盖——本节将其钉为持久回归锚。

describe('SA7 F2 守卫回归锁（非数组 path → 结构化返回，零外抛）', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['number 42', 42],
    ["string 'zz'", 'zz'],
    ['boolean true', true],
    ['plain object {}', {}],
    ['array-like {length:2}', { length: 2 }],
    ['Set', new Set(['a'])],
    ['Map', new Map([['a', 1]])],
    ['BigInt 1n', 1n],
    ['function（有 length=0，穿到 Phase B 的 [...fullPath] 抛点）', () => {}],
  ])('类型外 path（%s）→ {ok:false, code:PATH_NOT_ALLOWED, path:[]}，不外抛', (_name, badPath) => {
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('title', 'v');
    // 若外抛，本 it 直接失败（调用不被 try 包裹——守卫的义务就是「不抛」）
    const r = readLogicalValueAtPath(BASIC_DERIVED, doc, badPath as unknown as readonly (string | number)[]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.code).toBe('PATH_NOT_ALLOWED');
    expect(r.path).toEqual([]); // F2 守卫归一：一切类型外 path 回显 []
    expect(typeof r.message).toBe('string');
    expect(r.message).not.toBe('');
  });

  it.each([['null', null], ['undefined', undefined]])(
    '%s（Phase A segs.length 即抛）→ catch 收编 → C3（message 以 DOCRT-E100: 开头）',
    (_name, badPath) => {
      const doc = new Y.Doc();
      const r = readLogicalValueAtPath(BASIC_DERIVED, doc, badPath as unknown as readonly (string | number)[]);
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error('unreachable');
      expect(r.message).toMatch(/^DOCRT-E100:/);
    },
  );

  it('合法路径对照零回归：["title"] → ok:true "v"；["nope"] → PATH_NOT_ALLOWED(["nope"])（回显保留）', () => {
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('title', 'v');
    const good = readLogicalValueAtPath(BASIC_DERIVED, doc, ['title']);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value).toBe('v');
    expectNotAllowed(readLogicalValueAtPath(BASIC_DERIVED, doc, ['nope']), ['nope']);
  });
});

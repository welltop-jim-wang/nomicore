/**
 * SA4 裁量落地（设计 §8.1 可选锚点 H-a/H-b；SA2 R1 攻击点 #3/#4 建议采纳）—
 * readLogicalValueAtPath rev1 value-first 硬化的补充护栏（issue #75 / PR #83 rev1）。
 *
 * 落地裁量记录（SA4 静态验尸轮，2026-08-22，详见 wiki/raw/task_read-logical-value-at-path_rev1_sa4_review.md）：
 * - **H-b（mixed 反序锚，SA2 建议 #4「优先纳入」）**：`{ bar } | { foo? }` + live `x={}` 读
 *   `['x','foo']` → reject 先、missing 后仍 **missing 胜** → `ok:true` + value 键显式存在且
 *   undefined。与 R4-3（missing 先）构成双向锚：错误实现「循环遇 reject 提前终止」在本锚转红；
 *   「见 reject 即整体 reject」在 R4-3 转红。「首 missing 即返回」（owner Review 指认的原 bug
 *   行为）两锚均无检测力——观测等价必然（SA5 结论 (c) 成文），非护栏缺口。
 * - **H-a（value-first 新增成本面护栏，SA2 攻击点 #3）**：26 层链式重叠联合 × **中段 optional
 *   缺席**。该成本面在 SUP-2（全 required fixture）上结构性不存在（成员结局全 reject / 真值
 *   短路，首 ok 短路与 value-first 的试探集相同）；唯「前序成员 missing 后继续试探后序成员
 *   子树」是 D17 的新增试探面。本护栏断言 `<2s`，锚定 §3.4 memo 摊销论证（每 (节点, live, i)
 *   至多计算一次）。红灯触发条件：实现丢失 memoB 或 value-first 试探未摊销 → 2^24 级成员
 *   子树重探（指数回潮）。
 *   **对 SA2 红线原案的两处裁量修正**（原案：fixture 同款但「live 构造到第 13 层后缺 x」、
 *   读 `['e', ...x×12]`）：
 *   1. 缺口深度 13 → 25：缺口在第 13 层时无 memo 回潮仅 2^12 ≈ 4×10³ 次试探（毫秒级），
 *      `<2s` 红灯在 memo 丢失时**不会点亮**；缺口置于最深 optional 层（第 25 层，
 *      2^24 ≈ 1.7×10⁷ 次）红灯才真实触发——护栏必须能红才有锚定力；
 *   2. 路径终点 `['e',x×12]` → `['e',x×25,'t1']`：原案路径耗尽在 union L13 自身，空 live
 *      走终点 `walkUnion`（提交层仲裁）全软拒回退成员 0，产出 `{ok:true, value:{}}` 而非
 *      undefined——原案期望值即错。修正案使缺席发生在**中段导航**（消费第 25 个 'x' 段时
 *      live 缺该键），恰是 D17 仲裁的管辖域，与设计 §4「中段 optional 缺席」语义一致。
 *
 * fixture 构建纪律：同既有测试（parseVfsl → evaluate → derived 公共管线；
 * Y.Doc + getMap('ROOT').set('e', …) 构造 live）。全部为**绿灯行为锁**（含计时护栏），
 * 无红灯用例——竞争类输入在现行结构系统内不可构造（SA5 结论 (c)）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { evaluate, parseVfsl } from '@nomicore/vfsl';
import type { DerivedSchema } from '@nomicore/vfsl';
import { readLogicalValueAtPath } from '../src/index.js';

function derivedOf(text: string): DerivedSchema {
  const parsed = parseVfsl(text);
  if (!parsed.ok) throw new Error(`前置 parseVfsl 失败（fixture 缺陷）：${JSON.stringify(parsed.issues)}`);
  const evaluated = evaluate(parsed.module);
  if (!evaluated.ok) throw new Error(`前置 evaluate 失败（fixture 缺陷）：${JSON.stringify(evaluated.issues)}`);
  return evaluated.derived;
}

/** 构造 live 值：Y.Map 直接量（H-c 组用；同 union-arbitration 测试文件 harness 形态）。 */
function liveMap(entries: Record<string, unknown>): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(entries)) m.set(k, v);
  return m;
}

// —— H-b：mixed 反序锚（reject 先、missing 后 → missing 胜；SA2 攻击点 #4，建议优先纳入）——

describe('H-b 绿灯锁：mixed missing+reject 反序（reject 先、missing 后仍 missing 胜；D17/§3.3.2）', () => {
  it('{bar} | {foo?} + live x={} 读 ["x","foo"] → ok:true 且 value 键显式存在、值为 undefined（非 PATH_NOT_ALLOWED）', () => {
    const derived = derivedOf(`
type U = { bar: YLeaf<string> } | { foo?: YLeaf<string> };
type ROOT = YMap<{ x: U }>;
`.trim());
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('x', new Y.Map());
    const r = readLogicalValueAtPath(derived, doc, ['x', 'foo']);
    expect(r.ok).toBe(true); // 「循环遇 reject 提前终止」类漂移在此转红（reject → PATH_NOT_ALLOWED）
    if (!r.ok) throw new Error(`期望 ok:true（missing 胜），实际 code=${r.code}（path: ${JSON.stringify(r.path)}）`);
    expect(Object.prototype.hasOwnProperty.call(r, 'value')).toBe(true);
    expect(r.value).toBeUndefined();
  });
});

// —— H-a：value-first 新增成本面护栏（中段 optional 缺席 × 26 层重叠联合；SA2 攻击点 #3）——

const CHAIN_DEPTH = 26;

/** 链式 fixture：SUP-2 同款形状，但成员 0 的 x 改 optional（`{ x?: L_{k+1}; t1 } | { x: L_{k+1}; t2 }`）。 */
function optionalChainFixture(depth: number): string {
  const lines: string[] = [`type L${depth} = { t1: YLeaf<string> } | { t2: YLeaf<string> };`];
  for (let k = depth - 1; k >= 1; k--) {
    lines.push(`type L${k} = { x?: L${k + 1}; t1: YLeaf<string> } | { x: L${k + 1}; t2: YLeaf<string> };`);
  }
  lines.push('type ROOT = YMap<{ e: L1 }>;');
  return lines.join('\n');
}

const CHAIN_DERIVED = derivedOf(optionalChainFixture(CHAIN_DEPTH));

/**
 * live：e = 嵌套 Y.Map 链。nestX = 实际嵌套的 'x' 层数；最内层 map 为空（缺 'x'）——
 * 中段缺席点。bottomT1 = true 时最内层带 t1（正向对照用）。
 */
function buildChainDoc(nestX: number, bottomT1: boolean): Y.Doc {
  const doc = new Y.Doc();
  let cur: Y.Map<unknown> = new Y.Map();
  if (bottomT1) cur.set('t1', 'v');
  for (let k = 0; k < nestX; k++) {
    const outer = new Y.Map();
    outer.set('x', cur);
    cur = outer;
  }
  doc.getMap('ROOT').set('e', cur);
  return doc;
}

describe('H-a 成本护栏：26 层链 × 中段 optional 缺席（value-first 新增试探面；D17/§3.4/D13）', () => {
  const xs: string[] = Array.from({ length: CHAIN_DEPTH - 1 }, () => 'x');

  it(`中段缺席：live 嵌 x×${CHAIN_DEPTH - 2} 后缺 x，读 ['e',x×${CHAIN_DEPTH - 1},'t1'] → ok:true value:undefined 且 <2s（memo 摊销锚；无 memo 为 2^${CHAIN_DEPTH - 2} 级回潮）`, () => {
    // 缺口在第 25 层（最深 optional 层）：读路径消费 25 个 'x'，live 仅嵌 24 层 → 第 25 个 'x'
    // 在中段导航中被判 optional 缺席（missing）→ 逐层聚合上浮。value-first 下每一层 union 在
    // 成员 0 得 missing 后继续试探成员 1（同 (L_{k+1}, live_{k+1}, k+1) 键 → memo 命中）——
    // 本用例锚定的正是这条 D17 新增试探路径的摊销；memoB 丢失即指数回潮，<2s 转红。
    const doc = buildChainDoc(CHAIN_DEPTH - 2, false);
    const t0 = performance.now();
    const r = readLogicalValueAtPath(CHAIN_DERIVED, doc, ['e', ...xs, 't1']);
    const elapsed = performance.now() - t0;
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(`期望 ok:true（中段 optional 缺席 → missing 上浮），实际 code=${r.code}`);
    expect(Object.prototype.hasOwnProperty.call(r, 'value')).toBe(true);
    expect(r.value).toBeUndefined();
    expect(elapsed).toBeLessThan(2000);
  });

  it(`正向对照：live 嵌 x×${CHAIN_DEPTH - 1} 且底层 t1='v'，同路径 → 'v'（fixture 正当性自证，optional 链不改变真值读取）`, () => {
    const doc = buildChainDoc(CHAIN_DEPTH - 1, true);
    const r = readLogicalValueAtPath(CHAIN_DERIVED, doc, ['e', ...xs, 't1']);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(`期望 ok:true，实际 code=${r.code}`);
    expect(r.value).toBe('v');
  });
});

// —— H-c：嵌套 union 三态上浮（SA7 动态验证轮追加，2026-08-22）——
// 背景：D17 递归聚合（子 union value/missing/reject 上浮至外层仲裁）此前仅 SA4 tsx 探针实证
// （SA4 报告 §3「嵌套 union 5 例探针」），测试库内无 union 直接嵌 union 的行为锚。本组将探针
// 四形态固化为绿灯锁：错误实现「子 union reject 提前终止外层循环」在 H-c-3 转红、「子 union
// missing 覆盖外层后序 value 试探」在 H-c-3 转红、「子 union 任意结局整体 reject」在 H-c-2 转红。

describe('H-c 绿灯锁：嵌套 union 三态上浮（D17 递归聚合；SA7 补充）', () => {
  it('H-c-1 子 union 产 value → 外层首 value 胜：{a}|{a?} | {b} + live {a:"v"} 读 ["x","a"] → "v"', () => {
    const derived = derivedOf(`
type INNER = { a: YLeaf<string> } | { a?: YLeaf<string> };
type OUTER = INNER | { b: YLeaf<string> };
type ROOT = YMap<{ x: OUTER }>;
`.trim());
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('x', liveMap({ a: 'v' }));
    const r = readLogicalValueAtPath(derived, doc, ['x', 'a']);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(`期望 ok:true，实际 code=${r.code}`);
    expect(r.value).toBe('v');
  });

  it('H-c-2 子 union mixed（missing）+ 外层成员 reject → missing 上浮胜：{a?}|{q} | {b} + live {} 读 ["x","a"] → 显式 undefined（非 PATH_NOT_ALLOWED）', () => {
    const derived = derivedOf(`
type INNER = { a?: YLeaf<string> } | { q: YLeaf<string> };
type OUTER = INNER | { b: YLeaf<string> };
type ROOT = YMap<{ x: OUTER }>;
`.trim());
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('x', liveMap({}));
    const r = readLogicalValueAtPath(derived, doc, ['x', 'a']);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(`期望 ok:true（子 missing 上浮胜），实际 code=${r.code}`);
    expect(Object.prototype.hasOwnProperty.call(r, 'value')).toBe(true);
    expect(r.value).toBeUndefined();
  });

  it('H-c-3 子 union 全 reject 不短路外层循环 → 外层后序成员 value 胜：{q}|{r} | {a} + live {a:"v"} 读 ["x","a"] → "v"', () => {
    const derived = derivedOf(`
type INNER2 = { q: YLeaf<string> } | { r: YLeaf<string> };
type OUTER2 = INNER2 | { a: YLeaf<string> };
type ROOT = YMap<{ x: OUTER2 }>;
`.trim());
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('x', liveMap({ a: 'v' }));
    const r = readLogicalValueAtPath(derived, doc, ['x', 'a']);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(`期望 ok:true（后序成员 value 胜），实际 code=${r.code}`);
    expect(r.value).toBe('v');
  });

  it('H-c-4 全员 reject（子 union 全 reject + 外层 required 缺席）→ PATH_NOT_ALLOWED：同 fixture + live {} 读 ["x","a"]', () => {
    const derived = derivedOf(`
type INNER2 = { q: YLeaf<string> } | { r: YLeaf<string> };
type OUTER2 = INNER2 | { a: YLeaf<string> };
type ROOT = YMap<{ x: OUTER2 }>;
`.trim());
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('x', liveMap({}));
    const r = readLogicalValueAtPath(derived, doc, ['x', 'a']);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('期望 ok:false（全员 reject）');
    expect(r.code).toBe('PATH_NOT_ALLOWED');
    expect(r.path).toEqual(['x', 'a']);
  });
});

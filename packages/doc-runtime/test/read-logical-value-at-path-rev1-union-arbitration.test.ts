/**
 * SA6 修订轮（rev1）契约测试 — readLogicalValueAtPath Phase B union 仲裁（issue #75 / PR #83
 * owner Review）。owner 要求的五类回归测试，按 SA5 结论 (c) 可构造性表落测。
 *
 * 契约来源：
 * - 任务简报 wiki/raw/task_read-logical-value-at-path_rev1.md「必须补充的回归测试」五条；
 * - SA5 报告 wiki/raw/20260822-bug-read-logical-value-union-arbitration.md 结论 (a)/(b)/(c)：
 *   owner 反例在现行实现与现行结构系统内**结构性不可达**（四步归谬：① live 导航确定性——
 *   深度 k 处 live_k 是 (ROOT live, segs[0..k-1]) 的纯函数，成员形状零参与；② 段消耗无跳跃——
 *   容器下钻每层恰耗一段，任何成员不能少耗段抵达终点；③ value:undefined 三源（Record 缺键
 *   read.ts:324 / optional 缺席 read.ts:331 / 数组越界 read.ts:340）皆为 **live 数据缺席事实**，
 *   与成员形状无关，终点 walk 快照恒非 undefined；④ 归谬：设成员 j 以合法缺席胜出 ⟹ 存在深度
 *   k<n 使 live_k 在 segs[k] 缺席 ⟹ 后序成员或已在深度 k 前拒、或面对同一缺席，不可能产出真值。
 *   推论：现行「首个 ok 胜」与 owner「value-first」仲裁在一切合法输入上观测等价（(i) 首 ok 为
 *   真值 X ⟹ X 亦为首真值；(ii) 首 ok 为 missing ⟹ 无任何成员可产真值，同为 ok:true,
 *   value:undefined）。修订 = 防御性语义硬化，对合法输入零可观测行为变更。
 * - 相关决议 wiki/raw/task_read-logical-value-at-path_rev1_relevant_decisions.md：D4/D8/D15、
 *   INV-7（union 导航声明序确定性）、INV-8（extract 提交层声明序平局裁决）、D9（段形态边界）、
 *   ADR-0003（union any-of：任一成员出现即存在、重叠成员不构成错误）。
 *
 * 红/绿定性（如实标注）：**本文件全部用例预期绿灯（行为锁）**，无一红灯——按 SA5 结论 (c)，
 * 五类要求中三类竞争（Record 缺键 vs 后序在场 / optional 缺席 vs 后序在场 / 数组越界 vs 后序
 * 可解析）在结构系统内**不可构造红灯**，降级为绿灯行为锁（两成员声明序均返回真值/正确结果，
 * 锁死未来实现把在场合键误判缺席、或 value-first 硬化引入行为偏移）；「全部可行成员合法缺席
 * → ok:true, value:undefined」直接落测；「交换声明序结果不变」限域落测（仅终点=叶子/标量的
 * 多段读）。这些绿灯锁同时是 AC-R1/AC-R2 硬化（NavOutcome 三态 + value-first 仲裁）的行为不
 * 变护栏：硬化后本文件必须保持全绿。若任一用例现测为红，即为与 SA5 论证不符的实证发现，须
 * 按真实状态上报（本文件注释不预设结果，断言即证据）。
 *
 * ⛔ 禁写断言（限域纪律）：**严禁对终点=union 自身的重叠成员整树投影（如 ['x']）写 swap 不变
 * 断言**——SA5 6a/6b 反例在案：`{foo:"v",bar:"w"}` 两序投影分别为 `{foo:"v",bar:"w"}` 与
 * `{foo:"v"}`，交换声明序**合法改变**结果（ADR-0003 重叠合法性 + extract INV-8 声明序平局
 * 裁决）。swap 不变式仅对终点为叶子/标量的多段读成立。本文件不含任何终点=union 的 swap 断言。
 *
 * fixture 构建纪律：同 read-logical-value-at-path-supplementary.test.ts（parseVfsl → evaluate →
 * derived 公共管线；Y.Doc + getMap('ROOT').set('x', …) 构造 live）；VFSL 可选字段 `foo?:` 语法、
 * `Record<string, YLeaf<string>>`、`YArray<YLeaf<string>>` 均经既有测试实证。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { evaluate, parseVfsl } from '@nomicore/vfsl';
import type { DerivedSchema } from '@nomicore/vfsl';
import { extractYjsSnapshot, readLogicalValueAtPath } from '../src/index.js';

// —— 测试辅助（与既有测试同款 harness）——

function derivedOf(text: string): DerivedSchema {
  const parsed = parseVfsl(text);
  if (!parsed.ok) throw new Error(`前置 parseVfsl 失败（fixture 缺陷）：${JSON.stringify(parsed.issues)}`);
  const evaluated = evaluate(parsed.module);
  if (!evaluated.ok) throw new Error(`前置 evaluate 失败（fixture 缺陷）：${JSON.stringify(evaluated.issues)}`);
  return evaluated.derived;
}

/** 成功读取：断言 ok:true 并返回 value。 */
function expectOkValue(result: ReturnType<typeof readLogicalValueAtPath>): unknown {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`期望 ok:true，实际 code=${result.code}（path: ${JSON.stringify(result.path)}）`);
  return result.value;
}

/** AC3 缺键形态：ok:true 且 value 键显式存在、值为 undefined（禁省略 value 键）。 */
function expectUndefinedValue(result: ReturnType<typeof readLogicalValueAtPath>): void {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`期望 ok:true（合法缺席），实际 code=${result.code}`);
  expect(Object.prototype.hasOwnProperty.call(result, 'value')).toBe(true);
  expect(result.value).toBeUndefined();
}

/** 构建 live：ROOT.x = x（Y.Map / Y.Array 容器；set 即集成）。 */
function buildXDoc(x: unknown): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('ROOT').set('x', x);
  return doc;
}

/** 构造 live 值：Y.Map 直接量（键 → 值，值可为 plain 或 Y 类型）。 */
function liveMap(entries: Record<string, unknown>): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(entries)) m.set(k, v);
  return m;
}

function liveArray(items: unknown[]): Y.Array<unknown> {
  const a = new Y.Array<unknown>();
  a.insert(0, items);
  return a;
}

// —— R1：前序 Record 缺键 vs 后序封闭 map 字段在场（SA5 结论 (c) 行 1：结构性不可达 → 绿灯行为锁）——
// 论证出处：SA5 Root Cause 四步归谬——Record 成员对在场键 `ymap.get('foo')` 恒得同值并直接产出，
// 「把在场的 foo 解释为缺失键」的前提不成立（实证 1a/3b）。本组锁死：两成员声明序下在场合键必须
// 返回真值 "v"；真缺席必须返回显式 undefined。若未来实现（含 value-first 硬化）把在场合键误判
// 缺席或改变缺键形态，本组即转红。

const RECORD_FIRST = `
type U = Record<string, YLeaf<string>> | { foo: YLeaf<string> };
type ROOT = YMap<{ x: U }>;
`.trim();
const CLOSED_FIRST = `
type U = { foo: YLeaf<string> } | Record<string, YLeaf<string>>;
type ROOT = YMap<{ x: U }>;
`.trim();
const RECORD_FIRST_DERIVED = derivedOf(RECORD_FIRST);
const CLOSED_FIRST_DERIVED = derivedOf(CLOSED_FIRST);

describe('R1 绿灯锁：Record 缺键 vs 封闭 map 字段在场（两序均返回真值；SA5 结论 (c) 行 1）', () => {
  it('Record 先序：live x={foo:"v"}，读 ["x","foo"] → ok:true value:"v"（owner 反例直接翻案实证）', () => {
    const doc = buildXDoc(liveMap({ foo: 'v' }));
    const r = readLogicalValueAtPath(RECORD_FIRST_DERIVED, doc, ['x', 'foo']);
    expectOkValue(r);
    expect(r.value).toBe('v');
  });

  it('封闭 map 先序：同一 live 与路径 → 同为 "v"（交换序不变；两序均不被缺席短路）', () => {
    const doc = buildXDoc(liveMap({ foo: 'v' }));
    const r = readLogicalValueAtPath(CLOSED_FIRST_DERIVED, doc, ['x', 'foo']);
    expectOkValue(r);
    expect(r.value).toBe('v');
  });

  it('ground truth 交叉锁：两序读值 === extractYjsSnapshot 投影（SUP-1 同款双向锁）', () => {
    for (const derived of [RECORD_FIRST_DERIVED, CLOSED_FIRST_DERIVED]) {
      const doc = buildXDoc(liveMap({ foo: 'v' }));
      const r = readLogicalValueAtPath(derived, doc, ['x', 'foo']);
      const snap = extractYjsSnapshot(derived, doc);
      expect(snap.ok).toBe(true);
      if (!snap.ok) throw new Error('extract ground truth 失败');
      const x = (snap.snapshot as { x: Record<string, unknown> }).x;
      expect(x.foo).toBe('v');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(x.foo);
    }
  });

  it('真缺席对照：live x={} 读 ["x","foo"] → ok:true value 键显式存在且 undefined（两序一致）', () => {
    for (const derived of [RECORD_FIRST_DERIVED, CLOSED_FIRST_DERIVED]) {
      const doc = buildXDoc(liveMap({}));
      expectUndefinedValue(readLogicalValueAtPath(derived, doc, ['x', 'foo']));
    }
  });
});

// —— R2：前序 optional 缺席 vs 后序实际值在场（SA5 结论 (c) 行 2：结构性不可达 → 绿灯行为锁）——
// 论证出处：optional 缺席 ⟹ `live.get('foo') === undefined` ⟹ 后序成员同见同一 live 同一缺席
// （实证 2a-2f）——缺席是 live 数据事实，非成员形状事实。本组锁死两序在场→"v"、缺席→undefined。

const OPTIONAL_FIRST = `
type U = { foo?: YLeaf<string> } | { foo: YLeaf<string> };
type ROOT = YMap<{ x: U }>;
`.trim();
const REQUIRED_FIRST = `
type U = { foo: YLeaf<string> } | { foo?: YLeaf<string> };
type ROOT = YMap<{ x: U }>;
`.trim();
const OPTIONAL_FIRST_DERIVED = derivedOf(OPTIONAL_FIRST);
const REQUIRED_FIRST_DERIVED = derivedOf(REQUIRED_FIRST);

describe('R2 绿灯锁：optional 缺席 vs 后序实际值在场（两序均直读在场值；SA5 结论 (c) 行 2）', () => {
  it('optional 先序：live {foo:"v"} 读 ["x","foo"] → "v"（在场值被 optional 成员直读，不被判缺席）', () => {
    const doc = buildXDoc(liveMap({ foo: 'v' }));
    const r = readLogicalValueAtPath(OPTIONAL_FIRST_DERIVED, doc, ['x', 'foo']);
    expectOkValue(r);
    expect(r.value).toBe('v');
  });

  it('required 先序：同一 live 与路径 → 同为 "v"（required 成员直读，两序结果一致）', () => {
    const doc = buildXDoc(liveMap({ foo: 'v' }));
    const r = readLogicalValueAtPath(REQUIRED_FIRST_DERIVED, doc, ['x', 'foo']);
    expectOkValue(r);
    expect(r.value).toBe('v');
  });

  it('真缺席对照：live {} 读 ["x","foo"] → ok:true value 键显式存在且 undefined（两序一致）', () => {
    for (const derived of [OPTIONAL_FIRST_DERIVED, REQUIRED_FIRST_DERIVED]) {
      const doc = buildXDoc(liveMap({}));
      expectUndefinedValue(readLogicalValueAtPath(derived, doc, ['x', 'foo']));
    }
  });
});

// —— R3：前序数组越界 vs 后序可解析同一路径（SA5 结论 (c) 行 3：结构性不可达 → 绿灯行为锁）——
// 论证出处：数字段仅数组成员可接受（D9），同位数组成员读同一 live 数组的同一 `ya.length`，同界
// 同判（实证 4a-4d）；owner 自带保留措辞「如结构系统允许」。本组用 YArray | Record 两序锁定：
// 界内→真值、越界→显式 undefined，均与成员序无关。

const ARRAY_FIRST = `
type U = YArray<YLeaf<string>> | Record<string, YLeaf<string>>;
type ROOT = YMap<{ x: U }>;
`.trim();
const RECORD_FIRST_ARRAY = `
type U = Record<string, YLeaf<string>> | YArray<YLeaf<string>>;
type ROOT = YMap<{ x: U }>;
`.trim();
const ARRAY_FIRST_DERIVED = derivedOf(ARRAY_FIRST);
const RECORD_FIRST_ARRAY_DERIVED = derivedOf(RECORD_FIRST_ARRAY);

describe('R3 绿灯锁：数组越界 vs 后序可解析同一路径（两序同界同判；SA5 结论 (c) 行 3）', () => {
  it('live x=[] 读 ["x",0] → ok:true value 键显式存在且 undefined（越界=合法缺失，两序一致）', () => {
    for (const derived of [ARRAY_FIRST_DERIVED, RECORD_FIRST_ARRAY_DERIVED]) {
      const doc = buildXDoc(liveArray([]));
      expectUndefinedValue(readLogicalValueAtPath(derived, doc, ['x', 0]));
    }
  });

  it('live x=["v"] 读 ["x",0] → "v"（界内真值，两序一致；成员序不改变同界观测）', () => {
    for (const derived of [ARRAY_FIRST_DERIVED, RECORD_FIRST_ARRAY_DERIVED]) {
      const doc = buildXDoc(liveArray(['v']));
      const r = readLogicalValueAtPath(derived, doc, ['x', 0]);
      expectOkValue(r);
      expect(r.value).toBe('v');
    }
  });

  it('live x=["v"] 读 ["x",1] → ok:true value:undefined（非空数组越界对照，两序一致）', () => {
    for (const derived of [ARRAY_FIRST_DERIVED, RECORD_FIRST_ARRAY_DERIVED]) {
      const doc = buildXDoc(liveArray(['v']));
      expectUndefinedValue(readLogicalValueAtPath(derived, doc, ['x', 1]));
    }
  });
});

// —— R4：全部可行成员合法缺席 → ok:true, value:undefined（SA5 结论 (c) 行 4：可构造 → 直接落测）——
// owner 规则 3 / AC-R2 的直接锚：所有可行成员均只能得到 missing 时返回 `{ok:true, value:undefined}`
// （value 键显式存在）。含 mixed missing+reject 变体（SA5 实证 5a/5c）：reject 成员非可行，
// 存在可行成员 missing 且无 value → undefined——现行行为与 SA5 结论 (b)1 成文建议一致，本组锁死。

describe('R4 绿灯锁：全部可行成员合法缺席 → ok:true value:undefined（owner 规则 3 / AC-R2）', () => {
  it('Record | {foo}（两序）+ live {}：全部可行成员 missing → value 键显式存在且 undefined', () => {
    for (const derived of [RECORD_FIRST_DERIVED, CLOSED_FIRST_DERIVED]) {
      const doc = buildXDoc(liveMap({}));
      expectUndefinedValue(readLogicalValueAtPath(derived, doc, ['x', 'foo']));
    }
  });

  it('{foo?} | {foo}（两序）+ live {}：optional/required 全体 missing → 显式 undefined（missing 胜，无 PATH_NOT_ALLOWED）', () => {
    for (const derived of [OPTIONAL_FIRST_DERIVED, REQUIRED_FIRST_DERIVED]) {
      const doc = buildXDoc(liveMap({}));
      expectUndefinedValue(readLogicalValueAtPath(derived, doc, ['x', 'foo']));
    }
  });

  it('mixed missing+reject：{foo?} | {bar} 读 ["x","foo"] + live {} → missing 胜 → 显式 undefined（reject 成员非可行，SA5 5a/5c）', () => {
    const derived = derivedOf(`
type U = { foo?: YLeaf<string> } | { bar: YLeaf<string> };
type ROOT = YMap<{ x: U }>;
`.trim());
    const doc = buildXDoc(liveMap({}));
    expectUndefinedValue(readLogicalValueAtPath(derived, doc, ['x', 'foo']));
  });

  it('YArray | Record（两序）+ live []：全体成员同界越界 → 显式 undefined（非 PATH_NOT_ALLOWED）', () => {
    for (const derived of [ARRAY_FIRST_DERIVED, RECORD_FIRST_ARRAY_DERIVED]) {
      const doc = buildXDoc(liveArray([]));
      expectUndefinedValue(readLogicalValueAtPath(derived, doc, ['x', 0]));
    }
  });
});

// —— R5：交换声明序结果不变（限域：终点=叶子/标量的多段读；SA5 结论 (c) 行 5）——
// 限域声明：swap 不变式仅对终点为叶子/标量的多段读成立（SA5 6c/6d 实证域）；终点=union 自身的
// 重叠成员整树投影（['x']）交换序**合法改变**结果（6a/6b 反例在案：{foo,bar} 两序投影
// {foo,bar} vs {foo}）——本组**不包含**任何终点=union 的 swap 断言。以下每条：同一 live 内容
// （每 doc 经工厂 thunk 独立新建实例）用两序派生物各读一次，断言结果逐字一致 + 锚定期望值
// （真值本身也是绿灯锁）。

/**
 * 同一 live 内容下两序派生物读同一路径 → 结果 toEqual 一致。
 * fixture 纪律（R2 修复）：Yjs 禁止同一 Y 类型实例二次集成——集成后实例绑定首个 doc，第二处
 * `doc.getMap('ROOT').set('x', x)` 抛 TypeError（ContentType.integrate 栈）。故参数为工厂 thunk
 * `() => unknown`：每个 doc 集成**独立新建**的 live 实例，两序读到的 live 内容逐键一致；断言语义
 * （swap 不变式限域绿灯锁）不变。
 */
function assertSwapInvariant(
  derivedA: DerivedSchema,
  derivedB: DerivedSchema,
  makeX: () => unknown,
  path: readonly (string | number)[],
): void {
  const ra = readLogicalValueAtPath(derivedA, buildXDoc(makeX()), path);
  const rb = readLogicalValueAtPath(derivedB, buildXDoc(makeX()), path);
  expect(rb).toEqual(ra); // 交换声明序：可观测结果（ok/value/拒绝形态）逐字一致
}

describe('R5 限域绿灯锁：交换声明序结果不变（终点=叶子/标量的多段读）', () => {
  it('Record | {foo} 两序 + live {foo:"v",bar:"w"}：读 ["x","foo"] → 两序均 "v" 且结果逐字一致', () => {
    assertSwapInvariant(RECORD_FIRST_DERIVED, CLOSED_FIRST_DERIVED, () => liveMap({ foo: 'v', bar: 'w' }), ['x', 'foo']);
    const r = readLogicalValueAtPath(RECORD_FIRST_DERIVED, buildXDoc(liveMap({ foo: 'v', bar: 'w' })), ['x', 'foo']);
    expectOkValue(r);
    expect(r.value).toBe('v');
  });

  it('仅 Record 成员可解析的键：两序读 ["x","bar"] → 两序均 "w" 且结果逐字一致（Phase A any-of 放行 + Phase B Record 产出）', () => {
    assertSwapInvariant(RECORD_FIRST_DERIVED, CLOSED_FIRST_DERIVED, () => liveMap({ foo: 'v', bar: 'w' }), ['x', 'bar']);
    const r = readLogicalValueAtPath(CLOSED_FIRST_DERIVED, buildXDoc(liveMap({ foo: 'v', bar: 'w' })), ['x', 'bar']);
    expectOkValue(r);
    expect(r.value).toBe('w');
  });

  it('optional/required 两序 + live {foo:"v"}：读 ["x","foo"] → 两序均 "v" 且结果逐字一致', () => {
    assertSwapInvariant(OPTIONAL_FIRST_DERIVED, REQUIRED_FIRST_DERIVED, () => liveMap({ foo: 'v' }), ['x', 'foo']);
    const r = readLogicalValueAtPath(OPTIONAL_FIRST_DERIVED, buildXDoc(liveMap({ foo: 'v' })), ['x', 'foo']);
    expectOkValue(r);
    expect(r.value).toBe('v');
  });

  it('YArray | Record 两序 + live ["v"]：读 ["x",0] → 两序均 "v" 且结果逐字一致', () => {
    assertSwapInvariant(ARRAY_FIRST_DERIVED, RECORD_FIRST_ARRAY_DERIVED, () => liveArray(['v']), ['x', 0]);
    const r = readLogicalValueAtPath(ARRAY_FIRST_DERIVED, buildXDoc(liveArray(['v'])), ['x', 0]);
    expectOkValue(r);
    expect(r.value).toBe('v');
  });
});

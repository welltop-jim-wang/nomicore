/**
 * SA6 补充红灯测试（R2 增补，ALLOW LIST 备位）— plain 值域违规行为面（issue #73）。
 *
 * 落位依据：SA2 攻击评审 R2（wiki/raw/task_doc-runtime-extract-yjs-snapshot_sa2_review.md）
 * verdict: pass 的「残留处置建议②」——R2 修复的 plain 值域行为面（bigint/Date/undefined/
 * 词表四字段形状）在冻结 21 用例中零锚定；总控按
 * task_doc-runtime-extract-yjs-snapshot_design.md §11 ALLOW LIST 增补流程派发本文件。
 *
 * 行为语义（以 R2 设计 §4.1/§4.6/§4.8 + D9② 为准，含 SA2 R2 复审 R-2 改判）：
 * - 两层判定：粗判 carrierOf 把 bigint/Date/一切非 Y 对象归 'plain value'（结构错位位
 *   actual 恒五值词汇表）；细判 copyPlainValue 的 JSON 值域断言产真 issue——leaf/plain
 *   终态位的违规绝不落入 E100 'internal'（§4.8 实证口径：bigint 三路由可达、Date 本地
 *   可达、undefined 数组元素可达）；
 * - D9② 申报词（expected 恒 'plain value'）：可达 'bigint'（直存 A1 / 数组内嵌 D2 /
 *   跨端同步 E1）、'undefined'（plain 数组元素 D1）、'non-plain object'（Date/类实例
 *   原型守卫 C1）；**function/symbol 按 SA2 R2 复审 R-2 改判：直接位 set 期即抛不可达
 *   （A2/A3），plain 子树内嵌可达（N1–N3：set('a',[fn]) 成功且读回原类型）→ 真 issue，
 *   词表按设计 D9② 归类（总控增补指令明示）**；
 * - Y 类型内嵌 plain 子树（P22：plain 数组内嵌 Y.Map 活引用）→ 真 issue，actual 为词汇
 *   表载体名（§4.6 nested 再分类）；
 * - 四字段形状完整：message/path/expected/actual 全须在场（红线 5，防省略字段违约）；
 *   actual !== 'internal' 为 E100 误分类回归守卫（SA2 红线 2：跨端脏数据不得变内部错误）。
 *
 * 断言全部锚定公共接缝 `extractYjsSnapshot` 的可观测输出，不读取源码。
 *
 * 红灯现状（构造性红灯，与冻结 21 用例同构）：`../src/index.js` 尚不存在（新包无 src），
 * 本文件静态 import 即失败——vitest 报告 Failed to resolve import，全部用例红。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { evaluate, parseVfsl } from '@nomicore/vfsl';
import type { DerivedSchema } from '@nomicore/vfsl';
// 构造性红灯：新包 src 尚不存在，本 import 在 vitest 收集阶段即失败（全用例红）。
import { extractYjsSnapshot } from '../src/index.js';

interface ExtractIssue {
  message: string;
  path: Array<string | number>;
  expected: string;
  actual: string;
}

type ExtractResult =
  | { ok: true; snapshot: unknown }
  | { ok: false; issues: ExtractIssue[] };

function derivedOf(text: string): DerivedSchema {
  const parsed = parseVfsl(text);
  if (!parsed.ok) throw new Error(`前置 parseVfsl 失败（fixture 缺陷）：${JSON.stringify(parsed.issues)}`);
  const evaluated = evaluate(parsed.module);
  if (!evaluated.ok) throw new Error(`前置 evaluate 失败（fixture 缺陷）：${JSON.stringify(evaluated.issues)}`);
  return evaluated.derived;
}

/**
 * 断言失败结果：ok:false + 恰 1 条 issue（fail-fast）+ 四字段形状完整（红线 5）
 * + 非 E100 'internal' 回归守卫（红线 2/4），返回该 issue。
 */
function expectFailIssue(result: ExtractResult, path: Array<string | number>, expected: string, actual: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error(`期望 ok:false，实际 ok:true（snapshot: ${JSON.stringify(result.snapshot)}）`);
  }
  expect(result.issues).toHaveLength(1);
  const issue = result.issues[0];
  expect(issue).toBeDefined();
  if (!issue) throw new Error('issues 数组为空');
  // 四字段形状完整（D9② 词表用例统一锚：message 非空、path 精确、expected/actual 字符串）
  expect(typeof issue.message).toBe('string');
  expect(issue.message.length).toBeGreaterThan(0);
  expect(Array.isArray(issue.path)).toBe(true);
  expect(issue.path).toEqual(path);
  expect(typeof issue.expected).toBe('string');
  expect(issue.expected).toBe(expected);
  expect(typeof issue.actual).toBe('string');
  expect(issue.actual).toBe(actual);
  // E100 误分类回归守卫：可达脏数据绝不报 'internal'
  expect(issue.expected).not.toBe('internal');
  expect(issue.actual).not.toBe('internal');
}

function expectOkSnapshot(result: ExtractResult): unknown {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`期望 ok:true，实际 ok:false（issues: ${JSON.stringify(result.issues)}）`);
  }
  return result.snapshot;
}

describe('extractYjsSnapshot — plain 域违规：bigint（D9② 可达词，SA2 #2 红线 2）', () => {
  it('leaf 位直存 bigint → 单 issue 锚 [\'n\']，expected plain value / actual bigint，非 internal', () => {
    const derived = derivedOf('type ROOT = { n: YLeaf<number> };');
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('n', 10n);
    expectFailIssue(extractYjsSnapshot(derived, doc), ['n'], 'plain value', 'bigint');
  });

  it('跨端同步（encodeStateAsUpdate/applyUpdate）后仍 bigint → 同断言（E1：跨端脏数据不得变内部错误）', () => {
    const derived = derivedOf('type ROOT = { n: YLeaf<number> };');
    const source = new Y.Doc();
    source.getMap('ROOT').set('n', 10n);
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(source));
    expectFailIssue(extractYjsSnapshot(derived, remote), ['n'], 'plain value', 'bigint');
  });

  it('plain 数组内嵌 bigint → 单 issue 锚 [\'arr\']，expected plain value / actual bigint', () => {
    const derived = derivedOf('type ROOT = { arr: YPlainArray<YLeaf<number>> };');
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('arr', [1, 10n]); // D2：数组内嵌可达
    expectFailIssue(extractYjsSnapshot(derived, doc), ['arr'], 'plain value', 'bigint');
  });
});

describe('extractYjsSnapshot — plain 域违规：undefined / 类实例（D9② 可达词，SA2 #3 红线 3）', () => {
  it('plain 数组内 undefined 元素 → loud 单 issue 锚 [\'arr\' ]，expected plain value / actual undefined', () => {
    const derived = derivedOf('type ROOT = { arr: YPlainArray<YLeaf<number>> };');
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('arr', [1, undefined]); // D1：可达；禁止静默 JSON null 化
    expectFailIssue(extractYjsSnapshot(derived, doc), ['arr'], 'plain value', 'undefined');
  });

  it('leaf 位放 Date（类实例代表）→ 原型守卫 loud 真 issue，expected plain value / actual non-plain object，非 internal', () => {
    const derived = derivedOf('type ROOT = { d: YLeaf<string> };');
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('d', new Date(0)); // C1：本地读回 Date 实例；禁止静默投影 {}
    expectFailIssue(extractYjsSnapshot(derived, doc), ['d'], 'plain value', 'non-plain object');
  });
});

describe('extractYjsSnapshot — plain 域违规：function/symbol 内嵌可达（SA2 R2 复审 R-2 改判）', () => {
  it('plain 数组内嵌 function → 单 issue 锚 [\'arr\']，actual function（N1 路由：直接位 set 即抛、内嵌可达）', () => {
    const derived = derivedOf('type ROOT = { arr: YPlainArray<YLeaf<number>> };');
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('arr', [() => 1]); // N1：内嵌可达，读回原类型
    expectFailIssue(extractYjsSnapshot(derived, doc), ['arr'], 'plain value', 'function');
  });

  it('plain 数组内嵌 symbol → 单 issue 锚 [\'arr\']，actual symbol（N3 路由）', () => {
    const derived = derivedOf('type ROOT = { arr: YPlainArray<YLeaf<number>> };');
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('arr', [Symbol('s')]); // N3：内嵌可达
    expectFailIssue(extractYjsSnapshot(derived, doc), ['arr'], 'plain value', 'symbol');
  });
});

describe('extractYjsSnapshot — plain 域违规：Y 类型内嵌 plain 子树（§4.6 nested 再分类，P22）', () => {
  it('plain 数组内嵌 Y.Map 活引用 → 单 issue 锚 [\'arr\']，expected plain value / actual Y.Map（词汇表载体名）', () => {
    const derived = derivedOf('type ROOT = { arr: YPlainArray<YLeaf<number>> };');
    const doc = new Y.Doc();
    const nested = new Y.Map();
    nested.set('k', 'v');
    doc.getMap('ROOT').set('arr', [nested]); // P22：yjs 允许，读回活引用
    expectFailIssue(extractYjsSnapshot(derived, doc), ['arr'], 'plain value', 'Y.Map');
  });
});

describe('extractYjsSnapshot — plain 域正向对照：合法 JSON 值不被误伤', () => {
  it('leaf 标量 + plain 数组（含嵌套对象）→ ok:true，snapshot JSON 往返无损', () => {
    const derived = derivedOf('type ROOT = { n: YLeaf<number>; arr: YPlainArray<YLeaf<number>> };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    root.set('n', 42);
    root.set('arr', [1, 2]);
    const snapshot = expectOkSnapshot(extractYjsSnapshot(derived, doc));
    expect(snapshot).toEqual({ n: 42, arr: [1, 2] });
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});

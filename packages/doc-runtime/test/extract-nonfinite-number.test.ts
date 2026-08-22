/**
 * SA6 红灯回归测试（PR #81 owner review P1，发布后修订轮）— 非有限 number
 * （NaN / Infinity / -Infinity）值域违约行为面（issue #73）。
 *
 * 落位依据：owner review「合并前需修复」P1（packages/doc-runtime/src/extract.ts:258-260
 * copyPlainValue() 对全部 JavaScript number 直通放行——NaN/±Infinity 进入 ok:true 快照，
 * JSON.stringify 后静默变 null，零信号数据变化）+ SA5 报告 §7 锚点表
 * （wiki/raw/20260822-bug-doc-runtime-extract-yjs-snapshot.md，owner 必补 8 条逐条对应）。
 *
 * 修复形态（owner 立法冻结，本文件为其行为锚）：copyPlainValue() number 分支拆出——
 * 仅 Number.isFinite(v) 直通（JSON 数值域 = 有限十进制数，RFC 8259 §6）；否则
 * plainDomainIssue(path, loc, 'non-finite number')——复用既有 D9② 申报词构造器，
 * 四字段形状 / path 锚定 / loc 位置线纪律全部继承。
 *
 * 冻结申报词（本文件 docblock 显式声明，沿 extract-plain-domain.test.ts :14-18 词表先例）：
 * - actual === 'non-finite number'：D9② 家族新词（'bigint'/'undefined'/'non-plain
 *   object'/'function'/'symbol' 之后，第六词）。风格与 'non-plain object' 完全同构
 *   （「non- + 违反的域属性 + 值类型名」，小写空格分隔、稳定词）；备选词否决：
 *   'NaN' 不能覆盖 ±Infinity、'Infinity' 以偏概全、'number' 与放行的有限 number 无法
 *   区分——owner 建议词即最优，直接冻结；
 * - expected 恒 'plain value'（五值词汇表辖域 = 结构错位位；D9② 扩展词走既有申报
 *   通道，expected 侧不变）；
 * - 四字段形状完整：message/path/expected/actual 全须在场（红线 5，防省略字段违约）；
 *   actual !== 'internal' 为 E100 误分类回归守卫（SA2 红线 2：跨端脏数据不得变内部错误）。
 *
 * path 锚定纪律（R2/#8 锚定精度）：issue.path 锚定 schema 声明节点（['n'] / ['arr']）；
 * 违规内部位置线（plain object 内 '[1].x'、plain array 内 '[1]'）只进 message 不进 path
 * ——与 bigint D2 用例（锚 ['arr']）同构。
 *
 * 红灯现状（行为级红，非构造性）：src/extract.ts:259 现行实现对所有 number 直通放行
 * （无 Number.isFinite 守卫）——三条违规场景均返回 ok:true（SA5 §2 复现输出即失败
 * 实况），本文件违规断言全部真实失败；正向对照（有限 number）现即绿、修复后必须保持。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { evaluate, parseVfsl } from '@nomicore/vfsl';
import type { DerivedSchema } from '@nomicore/vfsl';
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
 * 断言失败结果：ok:false + 恰 1 条 issue（fail-fast，owner 必补 #4）+ 四字段形状完整
 * （红线 5）+ 非 E100 'internal' 回归守卫（#4 内建），返回该 issue 供 message 级补充断言。
 */
function expectFailIssue(result: ExtractResult, path: Array<string | number>, expected: string, actual: string): ExtractIssue {
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
  return issue;
}

function expectOkSnapshot(result: ExtractResult): unknown {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`期望 ok:true，实际 ok:false（issues: ${JSON.stringify(result.issues)}）`);
  }
  return result.snapshot;
}

describe('extractYjsSnapshot — 非有限 number：leaf 位三值各自独立（owner 必补 #1/#4-7）', () => {
  it('leaf 位 NaN → 单 issue 锚 [\'n\']，expected plain value / actual non-finite number，非 internal', () => {
    const derived = derivedOf('type ROOT = { n: YLeaf<number> };');
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('n', NaN); // owner 原始 schema 与写入逐字
    expectFailIssue(extractYjsSnapshot(derived, doc), ['n'], 'plain value', 'non-finite number');
  });

  it('leaf 位 Infinity → 同断言（owner 报告三值分列，各占独立用例）', () => {
    const derived = derivedOf('type ROOT = { n: YLeaf<number> };');
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('n', Infinity);
    expectFailIssue(extractYjsSnapshot(derived, doc), ['n'], 'plain value', 'non-finite number');
  });

  it('leaf 位 -Infinity → 同断言', () => {
    const derived = derivedOf('type ROOT = { n: YLeaf<number> };');
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('n', -Infinity);
    expectFailIssue(extractYjsSnapshot(derived, doc), ['n'], 'plain value', 'non-finite number');
  });
});

describe('extractYjsSnapshot — 非有限 number：plain 子树内嵌（owner 必补 #2/#3/#7）', () => {
  it('plain object 内 Infinity → 单 issue 锚 [\'arr\']（内部位置 [1].x 只进 message 不进 path）', () => {
    const derived = derivedOf('type ROOT = { arr: YPlainArray<{ x: number }> };');
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('arr', [{ x: 1 }, { x: Infinity }]); // SA5 复现 [2]：当前 ok:true——真实红
    const issue = expectFailIssue(extractYjsSnapshot(derived, doc), ['arr'], 'plain value', 'non-finite number');
    // R2/#8 锚定精度：违规内部位置线进 message（message 非冻结域，仅做包含性断言）
    expect(issue.message).toContain('内部位置 [1].x');
  });

  it('plain array 内 -Infinity → 单 issue 锚 [\'arr\']（内部位置 [1] 只进 message 不进 path）', () => {
    const derived = derivedOf('type ROOT = { arr: YPlainArray<number> };');
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('arr', [1, -Infinity]); // SA5 复现 [3]：当前 ok:true——真实红
    const issue = expectFailIssue(extractYjsSnapshot(derived, doc), ['arr'], 'plain value', 'non-finite number');
    expect(issue.message).toContain('内部位置 [1]');
  });
});

describe('extractYjsSnapshot — 非有限 number：跨端同步（E1 式路由，可选加固；SA5 §2 [4] 实证可达）', () => {
  it('NaN 经 encodeStateAsUpdate/applyUpdate 后远端提取 → 单 issue 锚 [\'n\']，非 internal', () => {
    const derived = derivedOf('type ROOT = { n: YLeaf<number> };');
    const source = new Y.Doc();
    source.getMap('ROOT').set('n', NaN);
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(source));
    expectFailIssue(extractYjsSnapshot(derived, remote), ['n'], 'plain value', 'non-finite number');
  });
});

describe('extractYjsSnapshot — 有限 number 正向对照（owner 必补 #8：修复不得误伤）', () => {
  it('leaf 42 + plain 数组 [1,2,3] → ok:true，快照深等原值且 JSON 往返全等', () => {
    const derived = derivedOf('type ROOT = { n: YLeaf<number>; arr: YPlainArray<number> };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    root.set('n', 42);
    root.set('arr', [1, 2, 3]);
    const snapshot = expectOkSnapshot(extractYjsSnapshot(derived, doc));
    expect(snapshot).toEqual({ n: 42, arr: [1, 2, 3] });
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('边界有限值 0 / -0 / 0.1 → 各自 ok:true 且往返全等（-0 以 Object.is 保真，防误伤）', () => {
    const derived = derivedOf('type ROOT = { n: YLeaf<number> };');
    for (const value of [0, -0, 0.1]) {
      const doc = new Y.Doc();
      doc.getMap('ROOT').set('n', value);
      const snapshot = expectOkSnapshot(extractYjsSnapshot(derived, doc));
      expect(snapshot).toEqual({ n: value });
      if (Object.is(value, -0)) {
        // JSON 值域无法表达 -0（JSON.stringify(-0) === '0'，RFC 8259 无符号零）：
        // -0 保真只做内存级 Object.is 断言，不做 JSON 往返（往返签名丢失属 JSON 规范行为）
        expect(Object.is((snapshot as { n: number }).n, -0)).toBe(true);
      } else {
        expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
      }
    }
  });
});

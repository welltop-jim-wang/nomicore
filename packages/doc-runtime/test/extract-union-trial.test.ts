/**
 * SA6 补充红灯测试（R2 增补，ALLOW LIST 备位）— union 试验语义行为面（issue #73）。
 *
 * 落位依据：SA2 攻击评审 R2（wiki/raw/task_doc-runtime-extract-yjs-snapshot_sa2_review.md）
 * verdict: pass 的「残留处置建议②」——R2 修复的 union 试验行为面（Record 形成员接受、
 * 成员根载体前置判定、成员声明序仲裁）在冻结 21 用例中零锚定；总控按
 * task_doc-runtime-extract-yjs-snapshot_design.md §11 ALLOW LIST 增补流程派发本文件。
 *
 * 行为语义（以 R2 设计 §4.5 为准）：
 * - trialMember 三结局试验：第一步恒为成员根载体前置判定（§4.5.1，SA2 #5）——map 形
 *   成员要求 `carrierOf(live) === 'Y.Map'`，不匹配 → 拒 + 真 issue（与 walk mismatch
 *   同款），封死「live 非 Y.Map 时调 Y.Map API → TypeError → E100 误分类」与「全可选
 *   成员裸接受」两病态；
 * - Record 形 map 成员（`fields` 单字段 `'<key>'`）无「缺失」概念，试验 = 直接 walk
 *   （键集即在场集，§4.5.1 第二步，SA2 #1）——`'<key>'` 是字面段名而非可缺席字段，
 *   按「缺必填」字面实现会对任何真实 Y.Map 恒软拒、违反 ADR-0003 any-of；
 * - 提交层仲裁（§4.5.2）：首个接受者胜（声明序，INV-8）；全拒 → 声明序首个真 issue；
 *   全软拒 → 回退成员 0（本文件不锚定全软拒——21 用例既有覆盖由 SA3 保证）；
 * - 未知键在封闭 map 成员内不报不进快照（D4，与 21 用例同契约）。
 *
 * 断言全部锚定公共接缝 `extractYjsSnapshot` 的可观测输出；`actual !== 'internal'`
 * 为 E100 误分类回归守卫（SA2 红线 4：TypeError→E100 绝非预期）。
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
 * 断言失败结果：ok:false + 恰 1 条 issue（fail-fast 单 issue）+ 四字段形状完整
 * （红线 5：防「省略字段」违约）+ 非 E100 'internal' 回归守卫，返回该 issue。
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
  // 四字段形状完整
  expect(typeof issue.message).toBe('string');
  expect(issue.message.length).toBeGreaterThan(0);
  expect(Array.isArray(issue.path)).toBe(true);
  expect(issue.path).toEqual(path);
  expect(typeof issue.expected).toBe('string');
  expect(issue.expected).toBe(expected);
  expect(typeof issue.actual).toBe('string');
  expect(issue.actual).toBe(actual);
  // E100 误分类回归守卫（SA2 红线 4）：可达脏数据绝不报 'internal'
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

describe('extractYjsSnapshot — union 试验：Record 形成员（SA2 #1 红线 1）', () => {
  it('Record<string,YLeaf<string>> | { b: YArray<...> } + live {x:\'hello\', b:\'plainstring\'} → ok:true（Record 成员直接 walk，any-of 兑现）', () => {
    const derived = derivedOf('type ROOT = Record<string, YLeaf<string>> | { b: YArray<YLeaf<string>> };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    root.set('x', 'hello');
    root.set('b', 'plainstring'); // member 1 的 b 要求 Y.Array——plain string 使 member 1 必拒，member 0 必须接受
    const snapshot = expectOkSnapshot(extractYjsSnapshot(derived, doc));
    expect(snapshot).toEqual({ x: 'hello', b: 'plainstring' });
  });

  it('Record 与对象成员均可接受时声明序前者（Record）胜（红线 1b：Record/对象仲裁锚）', () => {
    const derived = derivedOf('type ROOT = Record<string, YLeaf<string>> | { a: YLeaf<string>; extra?: YLeaf<string> };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    root.set('a', 'x');
    root.set('k', 'y'); // 对象成员视角：未知键 k 被跳过 → snapshot {a}；Record 视角：k 保留 → {a, k}
    const snapshot = expectOkSnapshot(extractYjsSnapshot(derived, doc));
    expect(snapshot).toEqual({ a: 'x', k: 'y' }); // k 在场 = Record 视角胜出（声明序前者）
  });

  it('声明序反向：对象成员在前时前者（对象）胜，未知键被跳过', () => {
    const derived = derivedOf('type ROOT = { a: YLeaf<string>; extra?: YLeaf<string> } | Record<string, YLeaf<string>>;');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    root.set('a', 'x');
    root.set('k', 'y');
    const snapshot = expectOkSnapshot(extractYjsSnapshot(derived, doc));
    expect(snapshot).toEqual({ a: 'x' }); // 对象成员胜：k 是封闭对象未知键 → 不报不进快照（D4）
  });

  it('any-of 载体分流：Record 成员拒（b 为 Y.Array 落 leaf 位），对象成员接受 → ok:true', () => {
    const derived = derivedOf('type ROOT = Record<string, YLeaf<string>> | { b: YArray<YLeaf<string>> };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    root.set('x', 'hello');
    const b = new Y.Array();
    root.set('b', b);
    b.insert(0, ['a']);
    const snapshot = expectOkSnapshot(extractYjsSnapshot(derived, doc));
    expect(snapshot).toEqual({ b: ['a'] }); // 对象成员视角：x 为未知键被跳过
  });

  it('跨成员 fail-fast：Record 成员真 issue（x 为 bigint）保留，对象成员软拒 → 报声明序首真 issue', () => {
    const derived = derivedOf('type ROOT = Record<string, YLeaf<string>> | { b: YArray<YLeaf<string>> };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    root.set('x', 10n); // leaf 位 bigint → copyPlainValue 真 issue（D9②）
    expectFailIssue(extractYjsSnapshot(derived, doc), ['x'], 'plain value', 'bigint');
  });
});

describe('extractYjsSnapshot — union 试验：成员根载体前置判定（SA2 #5 红线 4）', () => {
  it('{ a?: ... } | YArray<...> + live u=plain 数组 → 单 issue 锚 [\'u\']，expected Y.Map，绝非 E100 internal', () => {
    const derived = derivedOf('type ROOT = { u: { a?: YLeaf<string> } | YArray<YLeaf<string>> };');
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('u', ['x']); // plain 数组：member 0 前置判定拒、member 1 walk 拒
    expectFailIssue(extractYjsSnapshot(derived, doc), ['u'], 'Y.Map', 'plain value');
  });

  it('全可选 map 成员不得对任意 plain 值裸接受（前置判定封死病态 b）', () => {
    const derived = derivedOf('type ROOT = { u: { a?: YLeaf<string> } | YArray<YLeaf<string>> };');
    const doc = new Y.Doc();
    doc.getMap('ROOT').set('u', 'x'); // plain string：无前置判定则 member 0 零字段零软标记裸接受
    expectFailIssue(extractYjsSnapshot(derived, doc), ['u'], 'Y.Map', 'plain value');
  });

  it('live u=Y.Array（正确载体）→ member 1 接受 → ok:true', () => {
    const derived = derivedOf('type ROOT = { u: { a?: YLeaf<string> } | YArray<YLeaf<string>> };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const u = new Y.Array();
    root.set('u', u);
    u.insert(0, ['x']);
    const snapshot = expectOkSnapshot(extractYjsSnapshot(derived, doc));
    expect(snapshot).toEqual({ u: ['x'] });
  });
});

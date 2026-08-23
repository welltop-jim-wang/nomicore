/**
 * SA4 红灯复现锚 — applyValidatedMutation 嵌套路径 placeSet 返回值缺陷
 * （issue #87，SA4 静态验尸发现；审查报告 wiki/raw/task_doc-runtime-transaction-fatal_sa4_review.md F-1）。
 *
 * 【缺陷】`mutation.ts` 的 `placeAt` 返回 `{ value: 终段父对象 }`，`placeSet` 原样转发——
 * path 长度 ≥ 2 时 `placed.value` 是**子树**而非完整 proposed ROOT；prepareMutation 随后把
 * 该子树当完整 ROOT 送入 (F) validateLogicalSnapshot 与 (G) buildTopEntries：
 * - 常规 schema：嵌套 set 恒 ok:false，且诊断失真（对存在的顶层键谎报「缺少必填字段」、
 *   对子树键谎报「未知字段」）——嵌套 set 能力完全不可用；
 * - 同构可互验 schema（字段类型与 ROOT 结构相同/可被 ROOT 验证接受，无环）：(F)/(G) 通过、
 *   (G½) dropped 为空 → (H) 把子树当新 ROOT 安装 → **ok:true + 值写错层级 + 子树塌缩**
 *   （静默错误写入，虚假成功——AC-4/W1 精神违反面）。
 *
 * 【契约基准】SA1 设计 §7.2 (E)/(F)：placeSet 作用于 proposed，(F) 校验的是**完整
 * proposed ROOT**；§7.3 中间段导航规则意味着嵌套 path 属于 set 语义范围（仅「中间容器
 * 缺失」等真不可达才拒绝）。
 *
 * 【修复方向（SA3 owned，行为锚非实现锚）】placeSet 对 length ≥ 1 的 path 返回 mutated
 * proposed 根（克隆对象被原地变更，直接返回 root 即可；空 path 整体替换语义不变）。
 * 修复后本文件两条用例转绿；SA6 既有 4 用例（仅 1 段 path）不受影响。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { evaluate, parseVfsl } from '@nomicore/vfsl';
import type { DerivedSchema } from '@nomicore/vfsl';
import { materializeRoot } from '../src/index.js';
// applyValidatedMutation 已从公共入口收缩（owner 修改要求 1 / rev1 AC R1）：本文件经包内
// 内部 seam 直接导入（../src/mutation.js），fatal 契约覆盖不丢（rev1 AC R2）。
import { applyValidatedMutation } from '../src/mutation.js';

function derivedOf(text: string): DerivedSchema {
  const p = parseVfsl(text);
  if (!p.ok) throw new Error(`前置 parseVfsl 失败（fixture 缺陷）：${JSON.stringify(p.issues)}`);
  const e = evaluate(p.module);
  if (!e.ok) throw new Error(`前置 evaluate 失败（fixture 缺陷）：${JSON.stringify(e.issues)}`);
  return e.derived;
}

describe('SA4 F-1 复现 — applyValidatedMutation 嵌套路径必须作用于完整 proposed ROOT（设计 §7.2 (F)）', () => {
  it('常规 schema：set([\'u\',\'n\'], 5) → ok:true 且 u.n=5、u.s 与其余顶层键原样保留（当前缺陷：ok:false + 对存在键谎报缺少必填字段）', () => {
    const derived = derivedOf('type ROOT = { u: { n: number; s: string } };');
    const doc = new Y.Doc();
    const seed = materializeRoot(derived, { u: { n: 1, s: 'x' } }, doc);
    expect(seed.ok).toBe(true);
    const r = applyValidatedMutation(derived, doc, { op: 'set', path: ['u', 'n'], value: 5 });
    expect(r.ok).toBe(true); // 红因①：当前实现校验的是子树 {n:5,s:'x'} → 谎报「缺少必填字段 u」
    const u = doc.getMap('ROOT').get('u') as Y.Map<unknown>;
    expect(u.get('n')).toBe(5); // 请求的写真实发生（红因②：当前未写入）
    expect(u.get('s')).toBe('x'); // 兄弟字段保留
  });

  it('同构可互验 schema：set([\'a\',\'x\'], 9) 不得 ok:true + 数据重塑（当前缺陷：ok:true 但 x 被写成 9、a.a 塌缩消失）', () => {
    // 无环三别名：A 可作为 ROOT 验证通过（a 为 optional），制造「子树冒充完整 ROOT」通道
    const derived = derivedOf('type ROOT = { a?: A; x: number }; type A = { a?: B; x: number }; type B = { x: number };');
    const doc = new Y.Doc();
    const seed = materializeRoot(derived, { a: { a: { x: 1 }, x: 2 }, x: 3 }, doc);
    expect(seed.ok).toBe(true);
    const r = applyValidatedMutation(derived, doc, { op: 'set', path: ['a', 'x'], value: 9 });
    // 契约：要么响亮 ok:false（若设计方裁决嵌套 set 另行收紧——目前无此裁决），要么 ok:true
    // 且最终 ROOT = 正确的完整 proposed 投影 { a: { a: { x: 1 }, x: 9 }, x: 3 }。
    // 绝不容忍：ok:true + 值写错层级 + 子树塌缩（虚假成功）。
    const root = doc.getMap('ROOT');
    const a = root.get('a') as Y.Map<unknown> | undefined;
    const aa = a?.get('a') as Y.Map<unknown> | undefined;
    expect(root.get('x')).toBe(3); // 红因①：当前缺陷下被写成 9（子树冒充 ROOT 安装）
    expect(a?.get('x')).toBe(9); // 红因②：请求的写未落在正确层级（当前 a.x=1）
    expect(aa?.get('x')).toBe(1); // 红因③：嵌套 a.a 子树当前被静默丢弃
    if (r.ok) {
      // 若声明成功，最终状态必须与上述完整投影一致（断言组已锁定）；此行仅锁「成功不得谎报」
      expect(r.ok).toBe(true);
    }
  });
});

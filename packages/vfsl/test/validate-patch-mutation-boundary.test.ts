/**
 * issue #237 vfsl 增量接缝单测：planMutationBoundary（结构侧边界规划）与
 * applyMutationAtBoundary（边界尺度重建 + 校验）。纯 JSON base、零 Yjs——vfsl
 * 无 Yjs 依赖纪律保持；doc-runtime 的端到端行为由 issue-237 红/绿套件锚定。
 *
 * 契约要点：
 * - planMutationBoundary 是 (derived, path, op) 纯函数：零 base 读、零 doc 状态、
 *   同步、不抛错（崩溃边界 E100）；拒绝 = { ok:false, result: ValidateResult }。
 * - R1–R6 × mutation 词表：union 穿越（R1）/ Record 键（R2）/ array-* 目标（R4）/
 *   delete 父位（R5）/ set 目标位（R6）；set/delete 终段禁数字下标、delete [] 拒。
 * - applyMutationAtBoundary：relPath 域规则（不自动创建中间容器/不 clamp/拒 no-op）
 *   + 拷贝式重建（批量一次）+ validateSubtree 整体判定；issue 按 prefix rebase 为
 *   绝对路径；返回 proposedBoundary 供提交后对照。
 */
import { describe, expect, it } from 'vitest';
import {
  evaluate,
  parseVfsl,
  planMutationBoundary,
  applyMutationAtBoundary,
} from '../src/index.js';
import type { DerivedSchema } from '../src/index.js';
import type { MutationBoundaryPlan, BoundaryMutationPayload } from '../src/index.js';

function derivedOf(text: string): DerivedSchema {
  const parsed = parseVfsl(text);
  if (!parsed.ok) throw new Error(`前置 parseVfsl 失败: ${JSON.stringify(parsed.issues)}`);
  const evaluated = evaluate(parsed.module);
  if (!evaluated.ok) throw new Error(`前置 evaluate 失败: ${JSON.stringify(evaluated.issues)}`);
  return evaluated.derived;
}

type PlanOk = { ok: true; plan: MutationBoundaryPlan };
type PlanFail = { ok: false; result: { ok: false; issues: Array<{ message: string; path: Array<string | number> }> } };

function planOf(derived: DerivedSchema, path: Array<string | number>, op: 'set' | 'delete' | 'array-insert' | 'array-delete'): PlanOk | PlanFail {
  return planMutationBoundary(derived, path, op) as PlanOk | PlanFail;
}

function applyOf(
  derived: DerivedSchema,
  plan: MutationBoundaryPlan,
  base: unknown,
  payload: BoundaryMutationPayload,
): { ok: true; proposedBoundary: unknown } | { ok: false; result: { ok: false; issues: Array<{ message: string; path: Array<string | number> }> } } {
  return applyMutationAtBoundary(derived, plan, base, payload) as never;
}

const LIB =
  'type Item = { name: string; qty: number };\n'
  + 'type ROOT = { target: { value: number; note?: string }; library: YArray<Item>; assets: Record<string, Item>; m: { kind: "a"; x: string } | { kind: "b"; y: string } };';

describe('planMutationBoundary — 边界定夺（R1–R6 × mutation 词表；纯结构，零 base 读）', () => {
  it('set 叶子（exact 字段）→ kind target，prefix = 全路径、relPath = []、node 归一化', () => {
    const derived = derivedOf(LIB);
    const p = planOf(derived, ['target', 'value'], 'set');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.plan.kind).toBe('target');
    expect(p.plan.prefix).toEqual(['target', 'value']);
    expect(p.plan.relPath).toEqual([]);
    expect(p.plan.node).toMatchObject({ kind: 'scalar', type: 'number' });
  });

  it('set Record 动态键 → kind record（边界 = Record map 位）', () => {
    const derived = derivedOf(LIB);
    const p = planOf(derived, ['assets', 'k1'], 'set');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.plan.kind).toBe('record');
    expect(p.plan.prefix).toEqual(['assets']);
    expect(p.plan.relPath).toEqual(['k1']);
  });

  it('delete 必填叶子 → kind parent（边界 = 父 map 位）', () => {
    const derived = derivedOf(LIB);
    const p = planOf(derived, ['target', 'value'], 'delete');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.plan.kind).toBe('parent');
    expect(p.plan.prefix).toEqual(['target']);
    expect(p.plan.relPath).toEqual(['value']);
  });

  it('delete Record 动态键 → kind record', () => {
    const derived = derivedOf(LIB);
    const p = planOf(derived, ['assets', 'k1'], 'delete');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.plan.kind).toBe('record');
    expect(p.plan.relPath).toEqual(['k1']);
  });

  it('set 穿越 union（路径中段）→ kind union（边界 = 穿越位，relPath = 剩余段）', () => {
    const derived = derivedOf(LIB);
    const p = planOf(derived, ['m', 'x'], 'set');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.plan.kind).toBe('union');
    expect(p.plan.prefix).toEqual(['m']);
    expect(p.plan.relPath).toEqual(['x']);
    expect(p.plan.node.kind).toBe('union');
  });

  it('array-insert / array-delete → kind array（目标数组位）', () => {
    const derived = derivedOf(LIB);
    const ins = planOf(derived, ['library'], 'array-insert');
    expect(ins.ok).toBe(true);
    if (ins.ok) {
      expect(ins.plan.kind).toBe('array');
      expect(ins.plan.prefix).toEqual(['library']);
      expect(ins.plan.relPath).toEqual([]);
    }
    const del = planOf(derived, ['library'], 'array-delete');
    expect(del.ok).toBe(true);
    if (del.ok) expect(del.plan.kind).toBe('array');
  });

  it('array-insert 目标非数组结构（leaf/plain/map）→ ok:false（终段行 7/8/9 拒绝域）', () => {
    const derived = derivedOf(LIB);
    const p = planOf(derived, ['target'], 'array-insert');
    expect(p.ok).toBe(false);
  });

  it('set / delete 终段数字下标 → 拒绝（placeSet/placeDelete 现行拒绝域）', () => {
    const derived = derivedOf('type ROOT = { values: YArray<number> };');
    const s = planOf(derived, ['values', 0], 'set');
    expect(s.ok).toBe(false);
    const d = planOf(derived, ['values', 0], 'delete');
    expect(d.ok).toBe(false);
    const deep = planOf(derived, ['values', 0], 'array-delete');
    expect(deep.ok).toBe(false); // 下标 0 处是 number leaf——数组操作目标非数组结构
    const top = planOf(derived, ['values'], 'array-delete');
    expect(top.ok).toBe(true);
    if (top.ok) expect(top.plan.kind).toBe('array');
  });

  it('未知字段 / delete [] / 空路径 → 拒绝', () => {
    const derived = derivedOf(LIB);
    expect(planOf(derived, ['nope'], 'set').ok).toBe(false);
    expect(planOf(derived, [], 'delete').ok).toBe(false);
    expect(planOf(derived, [], 'set').ok).toBe(false); // set([]) 由 doc-runtime legacy 接管，本接缝不服务空路径
  });
});

describe('applyMutationAtBoundary — 边界尺度重建 + 校验（域规则 + rebase + proposedBoundary）', () => {
  it('kind target：payload 过目标位子 schema（类型错 → ok:false，issue rebase 全路径）', () => {
    const derived = derivedOf(LIB);
    const plan = (planOf(derived, ['target', 'value'], 'set') as PlanOk).plan;
    const ok = applyOf(derived, plan, 1, { op: 'set', value: 7 });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.proposedBoundary).toBe(7);
    const bad = applyOf(derived, plan, 1, { op: 'set', value: 'x' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.result.issues[0]!.path).toEqual(['target', 'value']);
    }
  });

  it('kind parent：delete 必填字段 → 整体校验拒绝（缺必填）；delete optional → ok + proposedBoundary', () => {
    const derived = derivedOf(LIB);
    const parent = (planOf(derived, ['target', 'value'], 'delete') as PlanOk).plan;
    const r = applyOf(derived, parent, { value: 1, note: 'n' }, { op: 'delete' });
    expect(r.ok).toBe(false); // value 必填：删除后父 map 缺必填
    if (!r.ok) expect(r.result.issues[0]!.path).toEqual(['target', 'value']);

    const optPlan = (planOf(derived, ['target', 'note'], 'delete') as PlanOk).plan;
    const ok = applyOf(derived, optPlan, { value: 1, note: 'n' }, { op: 'delete' });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.proposedBoundary).toEqual({ value: 1 });
  });

  it('kind parent：delete 目标键不存在 → 拒 no-op（零写入面）', () => {
    const derived = derivedOf(LIB);
    const plan = (planOf(derived, ['target', 'note'], 'delete') as PlanOk).plan;
    const r = applyOf(derived, plan, { value: 1 }, { op: 'delete' });
    expect(r.ok).toBe(false);
  });

  it('kind record：动态键 set（新建键）/ delete 与 Record keyPattern 语义一致', () => {
    const derived = derivedOf('type ROOT = { assets: Record<string, { name: string; qty: number }> };');
    const setPlan = (planOf(derived, ['assets', 'k2'], 'set') as PlanOk).plan;
    const ok = applyOf(derived, setPlan, { k1: { name: 'a', qty: 1 } }, { op: 'set', value: { name: 'b', qty: 2 } });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.proposedBoundary).toEqual({ k1: { name: 'a', qty: 1 }, k2: { name: 'b', qty: 2 } });
    }
    const delPlan = (planOf(derived, ['assets', 'k1'], 'delete') as PlanOk).plan;
    const del = applyOf(derived, delPlan, { k1: { name: 'a', qty: 1 } }, { op: 'delete' });
    expect(del.ok).toBe(true);
    if (del.ok) expect(del.proposedBoundary).toEqual({});
  });

  it('kind union：成员内合法 set 通过；交叉写非本成员字段拒绝（与全量 any-of 同语义）', () => {
    const derived = derivedOf('type ROOT = { m: { kind: "a"; x: string } | { kind: "b"; y: string } };');
    const plan = (planOf(derived, ['m', 'x'], 'set') as PlanOk).plan;
    const ok = applyOf(derived, plan, { kind: 'a', x: 's' }, { op: 'set', value: 't' });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.proposedBoundary).toEqual({ kind: 'a', x: 't' });

    const cross = applyOf(derived, plan, { kind: 'a', x: 's' }, { op: 'set', value: 5 });
    expect(cross.ok).toBe(false); // x 类型错 → 整值 any-of 重仲裁拒绝
  });

  it('kind array：批量 insert 一次重建 + 整体校验（任一元素非法 → 整批拒）；proposedBoundary = 重建后数组', () => {
    const derived = derivedOf('type ROOT = { items: YArray<{ name: string; qty: number }> };');
    const plan = (planOf(derived, ['items'], 'array-insert') as PlanOk).plan;
    const ok = applyOf(derived, plan, [{ name: 'a', qty: 1 }], {
      op: 'array-insert', index: 1, values: [{ name: 'b', qty: 2 }, { name: 'c', qty: 3 }],
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.proposedBoundary).toEqual([
        { name: 'a', qty: 1 }, { name: 'b', qty: 2 }, { name: 'c', qty: 3 },
      ]);
    }
    const bad = applyOf(derived, plan, [{ name: 'a', qty: 1 }], {
      op: 'array-insert', index: 1, values: [{ name: 'b', qty: 'bad' }],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.result.issues[0]!.path).toEqual(['items', 1, 'qty']);
  });

  it('kind array：index/count 越界不 clamp → ok:false；delete 合法段 ok', () => {
    const derived = derivedOf('type ROOT = { items: YArray<number> };');
    const plan = (planOf(derived, ['items'], 'array-insert') as PlanOk).plan;
    expect(applyOf(derived, plan, [1, 2], { op: 'array-insert', index: 5, values: [9] }).ok).toBe(false);
    const delPlan = (planOf(derived, ['items'], 'array-delete') as PlanOk).plan;
    expect(applyOf(derived, delPlan, [1, 2], { op: 'array-delete', index: 1, count: 2 }).ok).toBe(false);
    const ok = applyOf(derived, delPlan, [1, 2], { op: 'array-delete', index: 0, count: 2 });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.proposedBoundary).toEqual([]);
  });

  it('域规则：relPath 中间容器缺失 → 拒绝（不自动创建）', () => {
    const derived = derivedOf('type ROOT = { m: { kind: "a"; inner: { v: number } } | { kind: "b"; y: string } };');
    const plan = (planOf(derived, ['m', 'inner', 'v'], 'set') as PlanOk).plan;
    expect(plan.kind).toBe('union');
    const ok = applyOf(derived, plan, { kind: 'a', inner: { v: 1 } }, { op: 'set', value: 5 });
    expect(ok.ok).toBe(true);
    const missing = applyOf(derived, plan, { kind: 'a' }, { op: 'set', value: 5 });
    expect(missing.ok).toBe(false); // inner 缺失 → 不自动创建中间容器
  });

  it('崩溃边界：手造派生物缺别名 → E100 结构化返回（不抛错、零静默 ok）', () => {
    const derived = derivedOf(LIB);
    const hacked = { ...derived, values: {} } as unknown as DerivedSchema;
    const p = planMutationBoundary(hacked, ['target', 'value'], 'set');
    expect(p.ok).toBe(false);
    if (!p.ok) {
      const r = p.result as { ok: false; issues: Array<{ message: string }> };
      expect(r.issues[0]!.message).toContain('VFSL-E100');
    }
  });
});

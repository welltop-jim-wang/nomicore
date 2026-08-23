/**
 * SA7 补充测试 — validatePatch 红线 fixture 家族 + 动态验证锚定（issue #53 H2）。
 *
 * 契约来源（SA2 R1 攻击点 F1–F6 的 R2 冻结条款 + SA4 动态审核重点）：
 *
 * - D13/R2①（SA2 F1 HIGH）：值树游标归一化——mid-walk ref、optional(ref)、双层 ref 链
 *   （SA2 R2 复审明邀 fixture）、ROOT 身体 ref 的深层写入不产假 E100；与
 *   validateLogicalSnapshot 同重建值 issue 全等（AC5 同款单一来源锚）。
 * - D14/R2②（SA2 F2 MEDIUM）：base 段检查两段式（形态 + 在场）——垃圾基座
 *   （`{assets:42}` / `{profile:42}`）深层写 loud 拒绝（矩阵行 11），spread 塌缩
 *   静默 ok:true 路径清零。
 * - D15/R2③（SA2 F3 MEDIUM）：嵌套 union-of-ref 链 + 长路径同步有界返回（O(L×N)）。
 * - D16/R2④（SA2 F4 LOW）：map|array 混合联合三态（0/'x'/1.5）——拒绝消息按冻结取序。
 * - D17/R2⑤（SA2 F5 LOW）：矩阵行 12——三操作目标缺失/非 Array，path=path 参数原样。
 * - D18/R2⑥（SA2 F6 LOW）+ SA4 F-1：E100 path 相位区分——守卫/规整相位 path=[]；
 *   子树解释器内部 E100（边界之下值树 ref 环，手造派生物）经 finish rebase 边界前缀
 *   （SA4 review §5 F-1 实测 path=["p"]，行为确定性 loud，交 SA1 裁定注记）。
 * - §3.3 规则 1>4：穿透 union 的数组三操作（边界=union 位，重建后下标报错）。
 * - D2/D3：insert 闭区间上界 [0,len]（>len 拒 path=path++[index]）、delete [0,len-1]。
 * - 预算穿透（SA4 动态重点#3）：WorkBudgetExceeded 经 validateSubtree 单条 issue +
 *   rebase 边界前缀（与 validateLogicalSnapshot 同一 interpret()，三重可区分措辞）。
 *
 * 断言全部锚定可观测运行时行为（结果形状 / issue 内容 / path 段数组 / 等价性），
 * 不读源码、不 grep 文本形状。篡改派生物（删 ROOT / 造值树环）是测试合法操作
 * （手造垃圾 → loud E100 边界，validateLogicalSnapshot 同款契约）。
 */
import { describe, expect, it } from 'vitest';
import {
  parseVfsl,
  evaluate,
  validateLogicalSnapshot,
  validatePatch,
  validateAppendToArray,
  validateInsertIntoArray,
  validateDeleteFromArray,
} from '../src/index.js';
import type { DerivedSchema, VfslModule } from '../src/index.js';

function ev(text: string): DerivedSchema {
  const m = parseVfsl(text);
  if (!m.ok) throw new Error('parse failed: ' + JSON.stringify(m.issues?.slice(0, 2)));
  const d = evaluate(m.module as unknown as VfslModule);
  if (!d.ok) throw new Error('evaluate failed');
  return d.derived;
}

/** 失败分支窄化（测试内断言用）。 */
function issuesOf(r: { ok: boolean; issues?: { message: string; path: Array<string | number> }[] }) {
  expect(r.ok).toBe(false);
  return r.issues!;
}

describe('SA7 补充：D13/R2① 值树游标归一化（SA2 F1 HIGH——mid-walk ref 家族）', () => {
  it('mid-walk ref 深层写 [p,d] -> ok:true（不再假 E100），坏值与 validateLogicalSnapshot 全等', () => {
    const d = ev('type P = { d: string };\ntype ROOT = { p: P };');
    const base = { p: { d: 'x' } };
    expect(validatePatch(d, base, ['p', 'd'], 'y')).toEqual({ ok: true });
    const rBad = validatePatch(d, base, ['p', 'd'], 123);
    const snap = validateLogicalSnapshot(d, { p: { d: 123 } });
    expect(rBad).toEqual(snap); // message+path 逐条全等（单一来源）
  });

  it('optional(ref) 字段：在场基座深层写归一化放行；终段整值写缺席基座 ok:true（D10）', () => {
    const d = ev('type P = { d: string };\ntype ROOT = { p: P; po?: P };');
    const base = { p: { d: 'x' }, po: { d: 'old' } };
    expect(validatePatch(d, base, ['po', 'd'], 'new')).toEqual({ ok: true });
    const rBad = validatePatch(d, base, ['po', 'd'], 123);
    const snap = validateLogicalSnapshot(d, { ...base, po: { d: 123 } });
    expect(rBad).toEqual(snap);
    // D10：optional 终段整值写（缺席基座免在场——创建语义）
    expect(validatePatch(d, { p: { d: 'x' } }, ['po'], { d: 'created' })).toEqual({ ok: true });
  });

  it('optional 字段缺席基座 + 中间段下钻 -> 矩阵行 11 loud 拒绝（R2② 在场检查）', () => {
    const d = ev('type P = { d: string };\ntype ROOT = { p: P; po?: P };');
    const r = issuesOf(validatePatch(d, { p: { d: 'x' } }, ['po', 'd'], 'x'));
    expect(r).toHaveLength(1);
    expect(r[0]!.path).toEqual(['po', 'd']); // 完整尝试路径（D3）
    expect(r[0]!.message).toContain('需要 plain object');
    expect(r[0]!.message).toContain('实际 undefined');
  });

  it('双层 ref 链（SA2 R2 明邀 fixture）：type A = B; type B = {d:string} 深层写全等', () => {
    const d = ev('type B = { d: string };\ntype A = B;\ntype ROOT = { a: A };');
    expect(validatePatch(d, { a: { d: 'x' } }, ['a', 'd'], 'z')).toEqual({ ok: true });
    const rBad = validatePatch(d, { a: { d: 'x' } }, ['a', 'd'], null);
    const snap = validateLogicalSnapshot(d, { a: { d: null } });
    expect(rBad).toEqual(snap);
  });

  it('ROOT 身体 ref（初始化位 ref）：type ROOT = M 顶层字段写 -> ok:true', () => {
    const d = ev('type M = { d: string };\ntype ROOT = M;');
    expect(validatePatch(d, { d: 'x' }, ['d'], 'y')).toEqual({ ok: true });
  });
});

describe('SA7 补充：D14/R2② base 两段式（SA2 F2 MEDIUM——spread 塌缩清零）', () => {
  it('Record 垃圾基座 {assets:42} 写 [assets,k] -> 行 11 恰 1 issue（不再静默 ok:true）', () => {
    const d = ev('type ROOT = { assets: Record<string, number> };');
    const r = issuesOf(validatePatch(d, { assets: 42 }, ['assets', 'k'], 1));
    expect(r).toHaveLength(1);
    expect(r[0]!.path).toEqual(['assets', 'k']);
    expect(r[0]!.message).toContain('需要 plain object');
    expect(r[0]!.message).toContain('实际 number');
  });

  it('规则 5 叶位垃圾基座 {profile:42} 写 [profile,displayName] -> 行 11 拒绝', () => {
    const d = ev('type P = { displayName: string };\ntype ROOT = { profile: P };');
    const r = issuesOf(validatePatch(d, { profile: 42 }, ['profile', 'displayName'], 'bob'));
    expect(r).toHaveLength(1);
    expect(r[0]!.path).toEqual(['profile', 'displayName']);
    expect(r[0]!.message).toContain('需要 plain object');
    expect(r[0]!.message).toContain('实际 number');
  });
});

describe('SA7 补充：D15/R2③ 节点集去重与工作量界（SA2 F3 MEDIUM）', () => {
  it('12 层 union-of-ref 链 + 61 段路径 -> 同步返回不抛错、毫秒级（O(L×N) 界）', () => {
    const lines: string[] = ['type T0 = { k: "t0"; v: string };'];
    for (let i = 1; i <= 12; i++) lines.push(`type T${i} = T${i - 1} | { k: "t${i}"; v: string };`);
    lines.push('type ROOT = { m: T12 };');
    const d = ev(lines.join('\n'));
    const path: Array<string | number> = ['m'];
    for (let i = 0; i < 60; i++) path.push(i % 2 === 0 ? 'v' : 'deep' + i);
    const t0 = Date.now();
    const r = validatePatch(d, { m: { k: 't3', v: 'x' } }, path, 1);
    const ms = Date.now() - t0;
    expect(r.ok).toBe(false); // 结构拒绝（未知键族），但必须有界 loud
    expect(ms).toBeLessThan(1000); // 无去重的 O(M^L) 实现将远超此界（vitest 超时兜底）
    expect(r.ok === false && r.issues).toHaveLength(1);
  });
});

describe('SA7 补充：D16/R2④ map|array 混合联合三态（SA2 F4 LOW）', () => {
  it('[m,0] array 候选放行 / [m,x] map 候选放行 / [m,1.5] 恰 1 issue 按数组形消息', () => {
    const d = ev('type A = { x: string };\ntype B = string[];\ntype ROOT = { m: A | B };');
    expect(validatePatch(d, { m: ['a'] }, ['m', 0], 'b')).toEqual({ ok: true });
    expect(validatePatch(d, { m: { x: 's' } }, ['m', 'x'], 'y')).toEqual({ ok: true });
    const r = issuesOf(validatePatch(d, { m: { x: 's' } }, ['m', 1.5], 1));
    expect(r).toHaveLength(1);
    expect(r[0]!.path).toEqual(['m', 1.5]);
    expect(r[0]!.message).toContain('数组位置需要整数 number 下标段'); // 取序：array 形（D16）
    expect(r[0]!.message).toContain('收到 number'); // <实况> = jsonTypeOf
  });
});

describe('SA7 补充：D17/R2⑤ 矩阵行 12——三操作目标非 Array（SA2 F5 LOW）', () => {
  it('append 目标 {items:42} -> path=[items] 原样 + 行 12 消息含实际 number', () => {
    const d = ev('type ROOT = { items: string[] };');
    const r = issuesOf(validateAppendToArray(d, { items: 42 }, ['items'], 1));
    expect(r).toHaveLength(1);
    expect(r[0]!.path).toEqual(['items']);
    expect(r[0]!.message).toContain('目标数组缺失或当前值不是数组');
    expect(r[0]!.message).toContain('实际 number');
  });

  it('append 目标缺失（{} 无 items）-> 行 12 消息含实际 undefined', () => {
    const d = ev('type ROOT = { items: string[] };');
    const r = issuesOf(validateAppendToArray(d, {}, ['items'], 1));
    expect(r[0]!.message).toContain('实际 undefined');
  });
});

describe('SA7 补充：D18/R2⑥ + SA4 F-1——E100 path 相位区分', () => {
  it('规整/初始化相位（删 values[ROOT] 手造派生物）-> E100 且 path=[]（D18）', () => {
    const d = ev('type ROOT = { a: string };');
    const tampered = { ...d, values: { ...d.values } } as DerivedSchema;
    delete (tampered.values as Record<string, unknown>)['ROOT'];
    const r = issuesOf(validatePatch(tampered, { a: 'x' }, ['a'], 'y'));
    expect(r).toHaveLength(1);
    expect(r[0]!.message).toMatch(/^VFSL-E100: 内部错误（意外异常）: /);
    expect(r[0]!.path).toEqual([]);
  });

  it('SA4 F-1：边界之下值树 ref 环 -> 子树解释器 E100 经 rebase 取边界前缀 [p]', () => {
    const d = ev('type P2 = { d: string };\ntype ROOT = { p: { d: P2 } };');
    const tampered = { ...d, values: { ...d.values } } as DerivedSchema;
    // 手造垃圾：值树 P2 别名指自环 ref（合法派生物经 evaluate 不会产出）
    (tampered.values as Record<string, unknown>)['P2'] = { kind: 'ref', name: 'P2' };
    const r = issuesOf(validatePatch(tampered, { p: { d: { d: 'x' } } }, ['p'], { d: { d: 'y' } }));
    expect(r).toHaveLength(1);
    expect(r[0]!.message).toMatch(/^VFSL-E100: 内部错误（意外异常）: 值树引用环: P2$/);
    // 子树相位 E100 按 D5 取绝对前缀——SA1 R3 裁定（D18 收窄：validatePatch 顶层 E100=[]
    // / 子树内部 E100=边界前缀，后续票契约）；SA4 review §5 F-1 实测同款
    expect(r[0]!.path).toEqual(['p']);
  });

  it('对照：守卫相位 E100（结构树缺 root）-> path=[]，与子树相位可区分', () => {
    const d = ev('type ROOT = { a: string };');
    const tampered = { ...d, structure: { kind: 'map' } } as unknown as DerivedSchema;
    const r = issuesOf(validatePatch(tampered, { a: 'x' }, ['a'], 'y'));
    expect(r[0]!.message).toMatch(/^VFSL-E100: /);
    expect(r[0]!.path).toEqual([]);
  });
});

describe('SA7 补充：§3.3 规则 1>4——穿透 union 的数组三操作', () => {
  const SCHEMA = `
type Img = { kind: "img"; url: string };
type File = { kind: "file"; url: string; tags: string[] };
type Asset = Img | File;
type ROOT = { assets: Record<string, Asset> };`;
  const BASE = {
    assets: {
      file1: { kind: 'file', url: 'u', tags: ['a'] },
      img1: { kind: 'img', url: 'u' },
    },
  };

  it('有 tags 成员穿透 append 合法 -> ok:true（边界=union 位整体重建）', () => {
    expect(validateAppendToArray(ev(SCHEMA), BASE, ['assets', 'file1', 'tags'], 'new')).toEqual({ ok: true });
  });

  it('穿透 append 坏元素 -> 拒绝且 path=重建后下标 [assets,file1,tags,1]', () => {
    const r = issuesOf(validateAppendToArray(ev(SCHEMA), BASE, ['assets', 'file1', 'tags'], 42));
    expect(r[0]!.path).toEqual(['assets', 'file1', 'tags', 1]);
  });

  it('对无 tags 成员（img1）append -> loud 拒绝（非静默）', () => {
    const r = validateAppendToArray(ev(SCHEMA), BASE, ['assets', 'img1', 'tags'], 'x');
    expect(r.ok).toBe(false);
  });
});

describe('SA7 补充：D2/D3 insert-delete 闭区间上界 + Record 规则 2', () => {
  it('insert index=len 通过（append 位）/ index=len+1 拒且 path=path++[index]', () => {
    const d = ev('type ROOT = { items: string[] };');
    const base = { items: ['a', 'b'] };
    expect(validateInsertIntoArray(d, base, ['items'], 2, 'c')).toEqual({ ok: true });
    const r = issuesOf(validateInsertIntoArray(d, base, ['items'], 3, 'c'));
    expect(r[0]!.path).toEqual(['items', 3]);
  });

  it('delete index=len-1 通过 / index=len 拒绝', () => {
    const d = ev('type ROOT = { items: string[] };');
    const base = { items: ['a', 'b'] };
    expect(validateDeleteFromArray(d, base, ['items'], 1)).toEqual({ ok: true });
    expect(validateDeleteFromArray(d, base, ['items'], 2).ok).toBe(false);
  });

  it('Record 规则 2：新键合法写入 ok:true / 坏值拒绝且 path 含键段（Record 位重建）', () => {
    const d = ev('type ROOT = { r: Record<string, number> };');
    expect(validatePatch(d, { r: { a: 1 } }, ['r', 'newKey'], 5)).toEqual({ ok: true });
    const r = issuesOf(validatePatch(d, { r: { a: 1 } }, ['r', 'newKey'], 'x'));
    expect(r[0]!.path).toEqual(['r', 'newKey']);
  });
});

describe('SA7 补充：WorkBudgetExceeded 穿透 validateSubtree（SA4 动态重点#3）', () => {
  function wideUnionSchema(members: number): string {
    const parts: string[] = [];
    for (let i = 0; i < members; i++) parts.push('{ k: "m' + i + '"; v: string }');
    return 'type U = ' + parts.join(' | ') + ';\ntype ROOT = { m: Record<string, U> };';
  }
  function bigRecord(keys: number): Record<string, unknown> {
    const inner: Record<string, unknown> = {};
    for (let i = 0; i < keys; i++) inner['k' + i] = 'zzz';
    return { m: inner };
  }

  it('预算内对照：100k 键 × 120 成员联合经 validatePatch 新键写 -> 101 条截断输出（不误伤）', () => {
    const d = ev(wideUnionSchema(120));
    const r = validatePatch(d, bigRecord(100_000), ['m', 'kNEW'], { k: 'zzz', v: 'v' });
    const rs = issuesOf(r);
    expect(rs).toHaveLength(101);
    expect(rs[100]!.message).toContain('truncated');
  }, 120_000);

  it('超预算 loud fail-closed：900k 键 × 120 成员联合写入 -> 单条预算 issue + rebase 边界前缀 [m]', () => {
    const d = ev(wideUnionSchema(120));
    const r = validatePatch(d, bigRecord(900_000), ['m', 'kNEW'], { k: 'zzz', v: 'v' });
    const rs = issuesOf(r);
    expect(rs).toHaveLength(1); // 不进 emit 通道、无截断标记
    const msg = rs[0]!.message;
    expect(msg).toMatch(/^校验工作预算耗尽（全局已执行 \d+ 工作单位，上限 200000000）：无法在预算内完成整份校验$/);
    expect(Number(msg.match(/全局已执行 (\d+) 工作单位/)![1])).toBeGreaterThan(200_000_000);
    expect(rs[0]!.path).toEqual(['m']); // 相对 [] 经 finish rebase 边界前缀（D5 绝对路径）
    expect(msg).not.toContain('VFSL-E100'); // 三重可区分：非 E100、非截断标记、非单次 Pattern 预算
    expect(msg).not.toContain('truncat');
    expect(msg).not.toContain('Pattern');
  }, 300_000);
});

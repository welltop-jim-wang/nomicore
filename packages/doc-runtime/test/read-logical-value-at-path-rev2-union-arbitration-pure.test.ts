/**
 * SA6 修订轮（rev2）契约测试 — arbitrateUnion 包内纯函数表驱动仲裁（issue #75 / PR #83
 * owner 第二轮 Review P1：回归测试缺乏对 D17 value-first 核心分支的变异判别力）。
 *
 * 契约来源：
 * - 任务简报 wiki/raw/task_read-logical-value-at-path_rev2.md「建议的最小修订」六行表
 *   （AC-R2-2）：[missing, value('v')] → value('v')；[value('v'), missing] → value('v')；
 *   [missing, reject] → missing；[reject, missing] → missing；[missing, missing] → missing；
 *   [reject, reject] → reject；
 * - 相关决议 …_rev2_relevant_decisions.md：D17 union value-first 仲裁四规则（(1) 首个真实
 *   value 胜（声明序）；(2) missing 不胜出、继续后序成员；(3) 无 value 且有 missing →
 *   missing；(4) 全 reject → reject）+ mixed 优先级（§3.3：value > missing > reject）；
 *   INV-7 精确化「声明序迭代与首 value 短路惰性（不预先消费后序成员）语义不变」
 *   （AC-R2-1 尾句）——`Iterable<NavOutcome>` 形态的 seam 必须惰性消费，预先物化数组
 *   （如 `Array.from(outcomes)`）即破坏短路惰性；
 *   INV-14「三态不泄漏」的约束单位是**包边界**（index.ts 公共导出面），模块级 export
 *   （从 read.ts 导出 arbitrateUnion / NavOutcome 供同包测试 deep import）仍属包内私有。
 *
 * 红/绿定性（如实标注）：**本文件全部用例为红灯锚**——seam `arbitrateUnion` 在 rev1 实现
 * 中尚不存在（SA3 将把 read.ts union 分支（351-360 行）的仲裁循环抽取为包内纯函数）。
 * 当前运行本文件预期失败：deep import 的命名导出缺失（模块加载/类型错误）。SA3 落地 seam
 * 后本文件转绿；若实现被退回「首 missing 即返回」旧逻辑（owner 指认的变异），行 1 即转红
 * ——这正是 rev1 R1/R2/R3 绿灯锁缺失的变异判别力（AC-R2-4 mutation proof 锚点）。
 *
 * 断言目标：`NavOutcome` 包内三态（kind: 'value' | 'missing' | 'reject'），非公共两态结果
 * 联合——仲裁契约锚在 seam 返回值本身，不经 readLogicalValueAtPath 顶层两态收束。
 *
 * fixture 纪律：直接以包内私有类型构造 outcome 序列，不经过 schema/live 管线（竞争场景在
 * 现行合法 schema/live 模型下结构性不可构造——见 rev1 测试文件头注释与 SA5 报告结论 (c)；
 * 纯函数 seam 是可控注入该场景的唯一途径）。拉动记录（trackedOutcomes）为具象化证据：
 * 断言「仲裁实际拉动了哪些成员、在何处停止」，锚定惰性消费语义本身。
 *
 * ⛔ 本文件不含任何 `fs.readFileSync`/源码文本断言——全部锚点为运行时行为（返回值 + 拉动
 * 序列），符合「测试验行为不验文本形状」铁律。
 */
import { describe, expect, it } from 'vitest';
import { arbitrateUnion } from '../src/read.js';
import type { NavOutcome } from '../src/read.js';

/**
 * 拉动记录型 Iterable：逐项惰性产出 outcomes 并把已拉动下标记入 records.pulled。
 * 具象化证据载体——断言仲裁的拉动序列，可区分「继续扫描后序成员」与「首 value 短路」。
 */
function trackedOutcomes(
  records: { pulled: number[] },
  outcomes: readonly NavOutcome[],
): Iterable<NavOutcome> {
  return {
    [Symbol.iterator]() {
      let i = 0;
      return {
        next(): IteratorResult<NavOutcome> {
          if (i < outcomes.length) {
            const n = i;
            i += 1;
            records.pulled.push(n);
            return { value: outcomes[n]!, done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };
}

describe('arbitrateUnion 表驱动契约（owner 六行表，AC-R2-2；断言目标 = NavOutcome 包内三态）', () => {
  it('行 1：[missing, value("v")] → value("v") —— 前序已产 missing 后仲裁仍继续拉动，后序真实 value 胜出', () => {
    const pulled: number[] = [];
    const r = arbitrateUnion(
      trackedOutcomes({ pulled }, [{ kind: 'missing' }, { kind: 'value', value: 'v' }]),
    );
    expect(r.kind).toBe('value');
    if (r.kind === 'value') expect(r.value).toBe('v');
    // 具象化证据：首成员已产出 missing 后，仲裁继续拉动第 2 成员（若「首 missing 即返回」变异，
    // 本行拉动序列与结果双双转红——owner P1 指认的判别力缺口即在此）
    expect(pulled).toEqual([0, 1]);
  });

  it('行 2：[value("v"), missing] → value("v") —— 首 value 短路惰性：胜出后不再拉动后序 outcomes（SA8 注记 R2-2 攻击面）', () => {
    const pulled: number[] = [];
    const r = arbitrateUnion(
      trackedOutcomes({ pulled }, [{ kind: 'value', value: 'v' }, { kind: 'missing' }]),
    );
    expect(r.kind).toBe('value');
    if (r.kind === 'value') expect(r.value).toBe('v');
    // 短路惰性：仅拉动首成员（下标 0），后序未消费——预先物化（Array.from）实现即违此契约
    expect(pulled).toEqual([0]);
  });

  // —— 行 3-6 表驱动：missing/reject 均不短路，仲裁须全量拉动后按 mixed 优先级
  //    （value > missing > reject，§3.3）收束 ——
  const ROWS_3_6: Array<{
    label: string;
    outcomes: [NavOutcome, NavOutcome];
    expected: NavOutcome['kind'];
  }> = [
    {
      label: '行 3：[missing, reject] → missing —— mixed 优先级，missing 胜于 reject',
      outcomes: [{ kind: 'missing' }, { kind: 'reject' }],
      expected: 'missing',
    },
    {
      label: '行 4：[reject, missing] → missing —— 前序 reject 后仲裁继续扫描，后序 missing 胜',
      outcomes: [{ kind: 'reject' }, { kind: 'missing' }],
      expected: 'missing',
    },
    {
      label: '行 5：[missing, missing] → missing —— 全 missing → missing（D17 规则 3）',
      outcomes: [{ kind: 'missing' }, { kind: 'missing' }],
      expected: 'missing',
    },
    {
      label: '行 6：[reject, reject] → reject —— 全 reject → reject（D17 规则 4）',
      outcomes: [{ kind: 'reject' }, { kind: 'reject' }],
      expected: 'reject',
    },
  ];

  for (const row of ROWS_3_6) {
    it(`${row.label}`, () => {
      const pulled: number[] = [];
      const r = arbitrateUnion(trackedOutcomes({ pulled }, row.outcomes));
      expect(r.kind).toBe(row.expected);
      // 无 value 场景不短路：两成员均被实际拉动（reject 继续 / missing 继续均需证明）
      expect(pulled).toEqual([0, 1]);
    });
  }
});

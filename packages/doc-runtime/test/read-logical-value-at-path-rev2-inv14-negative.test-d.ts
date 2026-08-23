/**
 * SA4 rev2 静态验尸裁量锚点（H-d，可选补充，设计 §4.3/§8.1）— INV-14 公共面负锁
 * （issue #75 / PR #83 rev2）。
 *
 * 契约来源：
 * - 设计 wiki/raw/task_read-logical-value-at-path_rev2_design.md §4.3 H-d + §7 INV-14：
 *   `arbitrateUnion` / `NavOutcome` 为包内 seam（D19），**不得经 `src/index.ts` 公共
 *   barrel 转出口**——三态（missing/reject）不泄漏公共面；公共结果联合冻结为两态。
 * - 方法学出处 ADR-0004 D4（`@ts-expect-error` 自反转断言）：任一负例被实现误放行
 *   （如未来实现者把 seam 挂上公共 barrel，设计 §4.3 H-3 诱惑面）→ 对应指令变
 *   unused → TS2578 编译错 → 本文件转红，公共面污染在类型层死锁。
 * - 结构性后盾（设计 §3.1.1/§7）：package.json `"private": true` + `"exports": { ".":
 *   "./src/index.ts" }` 已在 Node/TS 两侧阻断包外 deep import——本负锁只需锁 barrel 面。
 *
 * 红灯触发条件：`src/index.ts` 出现 `export { arbitrateUnion }` 或
 * `export type { NavOutcome }`（或任何等价转出口形态）。
 *
 * 断言纪律：全部锚定类型层行为；负例经 `@ts-expect-error` 自反转（同
 * read-logical-value-at-path.test-d.ts 先例）。本文件不触碰任何既有 test-d 冻结文件
 * （SA6 owned 纪律）；SA3 无编写义务（设计 §4.3「SA3 不编写」）。
 */
import { describe, expectTypeOf, it } from 'vitest';
import { arbitrateUnion } from '../src/read.js';
import type { NavOutcome } from '../src/read.js';

// —— INV-14 负锁：以下两个 barrel 导入当前必须编译失败（TS2305），指令因抑制真实
//    错误而被视为已使用 → 现行态绿；若 seam 被误挂上 index.ts，导入成功 → 无错可抑制
//    → TS2578 unused directive → 本文件红。别名仅供本文件唯一化，不构成任何使用授权。 ——
// @ts-expect-error —— INV-14：arbitrateUnion 不得经公共 barrel（src/index.ts）导出
import { arbitrateUnion as arbitrateUnionFromBarrel } from '../src/index.js';
// @ts-expect-error —— INV-14：NavOutcome 三态不得经公共 barrel（src/index.ts）导出
import type { NavOutcome as NavOutcomeFromBarrel } from '../src/index.js';

describe('INV-14 公共面负锁（H-d）——seam 三态不经 index.ts 泄漏（rev2/D19）', () => {
  it('正锁：包内 deep import 通道成立（SA8 注记 R2-1 批准的唯一破例形态）', () => {
    // seam 签名冻结（AC-R2-1，owner 建议形态逐字采纳）
    expectTypeOf(arbitrateUnion).toBeFunction();
    expectTypeOf<Parameters<typeof arbitrateUnion>[0]>().toEqualTypeOf<Iterable<NavOutcome>>();
    expectTypeOf<ReturnType<typeof arbitrateUnion>>().toEqualTypeOf<NavOutcome>();
  });

  it('负锁自反证：barrel 别名存在即编译失败（TS2305 被上方指令抑制）', () => {
    // 现行态：两个 barrel 导入均 TS2305（模块无此导出）→ 指令已使用 → 文件绿。
    // 违规态（seam 挂上 barrel）：导入成功 → TS2578 unused directive（文件级编译错）。
    // 本用例不引用别名——负锁的断言即编译本身，别名仅承载导入语句。
    expectTypeOf(true).toBeBoolean();
  });
});

/**
 * 协议包导出面事实（issue #45 冻结快照）——发射器接线行与碰撞守卫名单的单一数据源。
 *
 * - 冻结依据：packages/vfsl-protocol/src/index.ts 实测导出 12 名（2026-08-21 基点 5907dc3）。
 * - 为何冻结名单：协议包是纯类型模块（ADR-0004 D3，零运行时导出），运行时不可枚举；
 *   生产发射器不得依赖 typescript 编译器 API。
 * - 同步锚（单向，v1.1 披露——SA2 #4）：test/generate-alias-collision-guard.test.ts 经
 *   checker.getExportsOfModule 实测枚举导出面逐一作碰撞别名断言必抛——协议导出面
 *   【增名】而本名单未跟 → 实测新名不抛 → silent 清单非空 → 该测试红。
 *   【删名】方向不红：名单残留条目 → 守卫过度拦截（fail-closed 方向，无害）。
 *   名单更新只改本文件一处。
 */
export const PROTOCOL_EXPORT_NAMES: ReadonlySet<string> = new Set([
  'VfslKind', 'PathSchema', 'UnknownPath', 'RootSchema', 'PathAt', 'VfslValueOf',
  'PathValue', 'PathKind', 'PathPatchValue', 'PathElementValue', 'VfslTypedAccess', 'VfslPathMap',
]);

/** N1+N2 恒定接线行（AC-1）：头注之后第一行代码，任意域（含零别名域）无条件发射（§3）。 */
export const PROTOCOL_IMPORT_LINE = "import type { PathSchema } from '@nomicore/vfsl-protocol';";

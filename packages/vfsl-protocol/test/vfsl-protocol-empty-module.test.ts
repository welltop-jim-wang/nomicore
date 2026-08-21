/**
 * SA6 红灯测试 — `@nomicore/vfsl-protocol` 编译产物为空模块（零运行时）（issue #24）。
 *
 * 契约来源（ADR 0004 D3 + 任务简报验收标准：「包导出齐备且编译产物为空模块（零运行时）」）。
 * 本文件是**可执行**的运行时断言（普通 `*.test.ts`）：namespace import 整个编译产物后，
 * 断言其运行时空导出——`Object.keys(...)` 为空数组。
 *
 * 注意：该断言是「空模块（零运行时）」的真·模块级行为断言（非源码 grep）；
 * 锚定 D3「含工厂/默认值即为违约」——若 SA1/SA3 把任一台实现/枚举/常量泄露进编译产物，
 * 本断言转红即暴露回归。
 *
 * ⚠️ 运行验证延期（如实标注）：本会话主机命令执行不可用，本文件未实际执行。
 * `@nomicore/vfsl-protocol` 尚不存在 → namespace import 将抛 module-not-found；这构成
 * 预期红灯锚点（运行时 import 失败 + 静态类型层面 TS2307）。红灯运行验证延期到具备
 * 命令执行能力的会话补跑（pnpm test；vitest include 覆盖各包 test 目录下全部 *.test-d.ts 与 *.test.ts）。
 */
import { describe, expect, it } from 'vitest';
import * as vfslProtocol from '@nomicore/vfsl-protocol';

describe('编译产物为空模块（D3 零运行时）', () => {
  it('namespace 导出的运行时键集合为空数组', () => {
    // D3：类型空间产物（幻影 pocket / PathSchema / PathAt / UnknownPath / VfslPathMap /
    // VfslTypedAccess）均为纯类型，编译后零运行时代码。任何 run-time 泄漏（工厂/默认值/常量）
    // 都会让此断言变红。
    expect(Object.keys(vfslProtocol)).toEqual([]);
  });
});

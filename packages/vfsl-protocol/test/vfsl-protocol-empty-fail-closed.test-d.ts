/**
 * SA6 红灯测试 — `@nomicore/vfsl-protocol` 空表 fail-closed（issue #24）。
 *
 * 契约来源（ADR 0004 D3 + 任务简报验收标准：「空 VfslPathMap fail-closed：未增广时任何
 * patch/read 调用编译错误」）。
 *
 * ⚠️ 隔离说明：module augmentation 在 vitest typecheck 编译单元中是**程序级全局**——projection
 * 文件的 `declare module '@nomicore/vfsl-protocol'` 增广会泄漏进同一 typecheck program 的其他文件，
 * 使本文件的 `VfslTypedAccess<VfslPathMap>` 也看到已增广接口。因此本文件不再依赖「未增广的
 * VfslPathMap 就是空接口」这一不可靠前提，改用本地空接口 `LocalEmptyMap`（`interface LocalEmptyMap {}`）
 * 作为访问器根，锚定 fail-closed 语义。语义等价：增广前的 `VfslPathMap` 本质就是空接口，故 `LocalEmptyMap`
 * 等价于「未增广空表」。本文件仍**不使用** `declare module` 增广；任何 `patch`/`read`/`kindOf` 调用
 * 落在 `UnknownPath` 上应抛编译错误（fail-closed 扩散到访问面），依此锚定「空表 default fail-closed」验收点。
 * 不再依赖与 projection 文件的分隔来保证空表语义——空表语义由本地 `LocalEmptyMap` 自身保证，与增广无关。
 *
 * ⚠️ 运行验证延期（如实标注）：本会话主机命令执行不可用，本文件未实际执行。
 * `package` 尚不存在 → import 即 TS2307（模块不存在）→ 全编译单元红灯（预期红灯锚点）。
 *
 * 编码假设（与 augmented 测试一致，见该文件头清单第 6/7 条）：
 * - `VfslTypedAccess<LocalEmptyMap>` 以本地空接口为根；由于空表无字段，任意路径解析 → `UnknownPath`。
 * - 访问面 `patch`/`read`/`kindOf` 在路径落到 `UnknownPath` 时应报编译错误（fail-closed 到 D3 层）。
 * - vitest typecheck 接线同 augmented 文件假设（最终由 SA1 钉死 / SA3 落地）。
 *
 * 断言纪律：全部锚定类型投影行为；负例用 `@ts-expect-error` 自我反转断言。
 */
import { describe, it } from 'vitest';
import type { VfslTypedAccess } from '@nomicore/vfsl-protocol';

// 本地空接口锚定「未增广空表」fail-closed 语义：无论如何恒为空，不受其他文件的 declare module
// 增广影响（module augmentation 是程序级全局，不能靠编译单元隔离保证空表）。
interface LocalEmptyMap {}

// 未增广访问器：根为空接口 → 停在任何路径上的调用都应编译错误。
declare const access: VfslTypedAccess<LocalEmptyMap>;

describe('空 VfslPathMap fail-closed — 未增广时任何 patch/read 调用编译错误', () => {
  it('fail-closed 1: patch 任意路径编译错误', () => {
    // @ts-expect-error 空表无字段，patch(['name']) 应编译错误
    access.patch(['name'], 'ok');
    // @ts-expect-error 空表无字段，patch(['assets']) 应编译错误
    access.patch(['assets'], {});
  });

  it('fail-closed 2: read 任意路径编译错误', () => {
    // @ts-expect-error 空表无字段，read(['name']) 应编译错误
    access.read(['name']);
  });

  it('fail-closed 3: kindOf 任意路径编译错误', () => {
    // @ts-expect-error 空表无字段，kindOf(['name']) 应编译错误
    access.kindOf(['name']);
  });
});

/**
 * 运行验证（延期）：本会话命令执行不可用，未真实执行。预期红灯：import 抛 TS2307 → 全红。
 * 实现后该文件应转绿：三条 `@ts-expect-error` 均为真实错误（任何一条被误放行 → 本测试自我反转失败）。
 */

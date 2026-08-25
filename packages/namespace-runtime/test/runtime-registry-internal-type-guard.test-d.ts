/**
 * SA6 红灯测试（类型面）— issue #109 AC1/AC2/AC3/AC6：internal subpath 类型契约。
 *
 * 契约来源：
 * - ADR-0009 §模块与 Cordis service：「Registry 通过 `@nomicore/namespace-runtime/internal`
 *   唯一导出的 `createNamespaceRuntimeForRegistry` 构造生产 Runtime」；
 * - 任务简报 AC1（internal 仅导出 Registry 专用生产 factory）、AC2（factory 只接收构造真实
 *   Runtime 所需的 handle 与 dirty notifier，不暴露 compile/fault/testing seam）、
 *   AC3（主 entry 不导出生产构造器）、AC6（testing seam 不进入任何 package entry）；
 * - ADR-0008 D6.3（构造方绑定 notifyDirty 的窄接缝）。
 *
 * 锚定机制（vitest --typecheck 下红/绿翻转）：
 * - 首行 `import type` internal subpath 当前不存在（package.json exports 仅 "."）→
 *   TS2307 → **红**（type-only import 在 transform 期被擦除，不冲击运行期文件收集；
 *   值面/行为锚见 runtime-registry-internal-seam.test.ts）；SA3 建立 ./internal → 绿。
 * - 输入形状条件类型：`Parameters<工厂>` 必须匹配两参形 `(DocHandle, notifyDirty)` 或
 *   恰 `{handle, notifyDirty}` 单对象形——多出必填参数/缺参/其他形状 → 条件 false →
 *   `never` 赋值 TS2322 → **红**；
 * - AC2 负向（类型层）：单对象形参数必须不存在 `p0Gate`/`compile` 属性面；两参形第 0 参
 *   必须仍是 DocHandle（而非放宽为接受测试注入面的对象）→ 任一泄漏 → `never` 赋值 → **红**；
 * - AC3/AC6 副锚（@ts-expect-error，保持性守卫）：主 entry 不导出 createNamespaceRuntime、
 *   internal subpath 不导出 createNamespaceRuntimeWithSeam / NamespaceRuntimeSeamInput——
 *   现状即满足；任何收口回潮（或泄漏）→ TS2578 未用指令 → **红**。
 *
 * 说明：本文件全部经 `import type` 消费 internal subpath——类型契约以纯条件类型判别
 * 表达（不依赖 expectTypeOf 的函数链 API，也不对工厂做值级调用）；工厂「值」级调用验证
 * 与注入面零效果由运行时行为测试（双探针调用 + 哨兵）承担。
 */
import { describe, it } from 'vitest';
import type { DocHandle } from '@nomicore/persistence';
import type { NamespaceRuntime } from '@nomicore/namespace-runtime';

// 【红灯主锚】internal subpath 尚不存在（exports 仅 "."）→ TS2307 → 本文件红。
// （type-only import 擦除后不产生运行期解析错误，红只体现在 typecheck 段。）
import type { createNamespaceRuntimeForRegistry } from '@nomicore/namespace-runtime/internal';

// AC3 副锚（保持性守卫）：主 entry 类型面不导出生产工厂（运行时锚见 exports-audit）。
// @ts-expect-error —— AC3：主 entry 不导出生产构造器 createNamespaceRuntime
import type { createNamespaceRuntime } from '@nomicore/namespace-runtime';

// AC6 副锚：测试 seam 构造器不得从 internal subpath 导出。
// @ts-expect-error —— AC6：createNamespaceRuntimeWithSeam 只属于包内模块通道，不进任何 package entry
import type { createNamespaceRuntimeWithSeam } from '@nomicore/namespace-runtime/internal';

// AC2 副锚：测试 seam 输入类型不得从 internal subpath 导出。
// @ts-expect-error —— AC2：NamespaceRuntimeSeamInput（含 p0Gate/compile 注入面）不得进入生产 internal subpath
import type { NamespaceRuntimeSeamInput } from '@nomicore/namespace-runtime/internal';

type Factory = typeof createNamespaceRuntimeForRegistry;
type FactoryParams = Parameters<Factory>;

describe('类型面：internal subpath 唯一工厂与受限输入（AC1/AC2/AC3/AC6）', () => {
  it('唯一值导出 createNamespaceRuntimeForRegistry 是函数，返回可赋给公共 NamespaceRuntime', () => {
    type FnOk = Factory extends (...args: any[]) => unknown ? true : false;
    const fnOk: FnOk extends true ? true : never = true;
    void fnOk;
    type RetOk = Factory extends (...args: any[]) => infer R ? (R extends NamespaceRuntime ? true : false) : false;
    const retOk: RetOk extends true ? true : never = true;
    void retOk;
  });

  it('工厂输入形态必须是真实构造输入：两参形 (handle, notifyDirty) 或恰 {handle, notifyDirty} 单对象形', () => {
    // 任一允许形态 =「构造真实 Runtime 所需的最小输入」（AC2）；Arity 与参数名由 SA3
    // 实现选择，本断言不预锁具体形态，但拒绝一切其他形状（多出必填参数等）。
    // 形状越界 → Allowed=false → never 赋值 TS2322 → 红。
    type Allowed = FactoryParams extends [DocHandle, () => Promise<void>]
      ? true
      : FactoryParams extends [{ readonly handle: DocHandle; readonly notifyDirty: () => Promise<void> }]
        ? true
        : false;
    const shapeOk: Allowed extends true ? true : never = true;
    void shapeOk;
  });

  it('AC2 负向：输入面不得包含 p0Gate/compile 测试注入字段（类型层判别）', () => {
    // 单对象形：参数对象类型若声明 p0Gate/compile（哪怕可选）→ 泄漏 → 红。
    // 两参形：第 0 参必须仍是 DocHandle 形状；第 1 参必须是函数（由形状判别保证）。
    // （ObjParam 非单对象形时取 never——keyof never 是全键宇宙，必须显式规避。）
    type ObjParam = FactoryParams extends [{ readonly handle: DocHandle; readonly notifyDirty: () => Promise<void> }]
      ? FactoryParams[0]
      : never;
    type LeakObj = ObjParam extends never
      ? false
      : 'p0Gate' extends keyof ObjParam
        ? true
        : 'compile' extends keyof ObjParam
          ? true
          : false;
    type LeakTwoArg = FactoryParams extends [DocHandle, () => Promise<void>]
      ? false
      : FactoryParams extends [infer A, unknown]
        ? A extends DocHandle
          ? false
          : true // 两参但第 0 参放宽为可接受注入面的对象 → 泄漏
        : false; // 非两参形（即单对象形）→ 由 LeakObj 判别
    type L = LeakObj extends true ? true : LeakTwoArg extends true ? true : false;
    const noLeak: L extends false ? true : never = true;
    void noLeak;
  });
});

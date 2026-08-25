/**
 * @nomicore/namespace-runtime/internal —— Registry 专用受限生产构造 seam
 * （ADR-0009 §模块与 Cordis service；issue #109）。
 *
 * 消费边界：本 subpath 仅允许 @nomicore/namespace-registry 生产代码消费
 * （模块边界测试 import 图审计强制；当前仓库消费方为空集）。
 * 导出面纪律：值导出恰本函数一键；不导出测试 seam（createNamespaceRuntimeWithSeam
 * / NamespaceRuntimeSeamInput 保留包内模块通道，ADR-0008「测试通过包内确定性
 * seam 注入」）、不导出生产工厂别名（createNamespaceRuntime）、不导出运行态
 * 与任何类型——主 entry 的公共类型面（NamespaceRuntime 等）不在此重复。
 */
import type { DocHandle } from '@nomicore/persistence';
import { createNamespaceRuntime } from './runtime.js';   // 相对导入，绝不走本包 subpath specifier（§D-F）
import type { NamespaceRuntime } from './runtime.js';

/**
 * 构造生产 NamespaceRuntime（ADR-0009 冻结名）。
 *
 * - handle：独占 DocHandle 租约，所有权随构造成功转移给 Runtime；
 *   构造 throw（形状守卫/状态门）时所有权仍归调用方，零副作用（ADR-0008）。
 * - notifyDirty：构造方绑定的 dirty notification 窄接缝——Registry 应绑定
 *   `() => persistence.saveDoc(handle)`；本工厂不提供缺省绑定。
 *
 * 构造序（形状守卫 → 状态门 → 所有权转移/P0 入队）与十键公共面语义
 * 由 src/runtime.ts 既有实现逐字节承载：本函数纯委托，无任何自有分支。
 */
export function createNamespaceRuntimeForRegistry(
  handle: DocHandle,
  notifyDirty: () => Promise<void>,
): NamespaceRuntime {
  return createNamespaceRuntime(handle, notifyDirty);
}

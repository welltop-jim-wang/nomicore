/**
 * @nomicore/namespace-runtime/internal —— Registry 专用受限生产构造 seam
 * （ADR-0009 §模块与 Cordis service；issue #109）。
 *
 * 消费边界：本 subpath 仅允许 @nomicore/namespace-registry 生产代码消费
 * （模块边界测试 import 图审计强制；白名单谓词 = `packages/namespace-registry/src/`
 * 前缀，零改动放行——issue #134 设计 §14）。
 * 导出面纪律：值导出恰两键——
 *   `createNamespaceRuntimeForRegistry`（ADR-0009 冻结 factory，issue #109）+
 *   `openReplicationSessionCoreForRegistry`（issue #134 冻结的复制会话宿主打开面，
 *   设计 D-2 显式裁决：import 图可见、审计谓词自动放行、公共面零污染）；
 * 不导出测试 seam（createNamespaceRuntimeWithSeam / NamespaceRuntimeSeamInput 保留
 * 包内模块通道，ADR-0008「测试通过包内确定性 seam 注入」）、不导出生产工厂别名
 * （createNamespaceRuntime）、不导出运行态。
 */
import type { DocHandle } from '@nomicore/persistence';
import { createNamespaceRuntime } from './runtime.js';   // 相对导入，绝不走本包 subpath specifier（§D-F）
import type { NamespaceRuntime, RuntimeForRegistryDiagnostic } from './runtime.js';
import { openReplicationSessionCoreForRegistry } from './replication-session.js';
import type {
  RuntimeReplicationSessionApplyRefusalCode,
  RuntimeReplicationSessionApplyResult,
  RuntimeReplicationSessionCore,
  RuntimeReplicationSessionOpenResult,
  RuntimeReplicationSessionOptions,
  RuntimeReplicationSessionStatus,
} from './replication-session.js';

/**
 * 构造生产 NamespaceRuntime（ADR-0009 冻结名）。
 *
 * - handle：独占 DocHandle 租约，所有权随构造成功转移给 Runtime；
 *   构造 throw（形状守卫/状态门）时所有权仍归调用方，零副作用（ADR-0008）。
 * - notifyDirty：构造方绑定的 dirty notification 窄接缝——Registry 应绑定
 *   `() => persistence.saveDoc(handle)`；本工厂不提供缺省绑定。
 * - diagnostic（#155 §4-D6，第三参可选）：`{ emitter, clock }` 成对诊断注入——
 *   不传 = 既有两参行为逐字节不变（测试 override 两参函数对三参可选签名兼容）。
 *
 * 构造序（形状守卫 → 状态门 → 所有权转移/P0 入队）与十键公共面语义
 * 由 src/runtime.ts 既有实现逐字节承载：本函数纯委托，无任何自有分支。
 *
 * 签名形态说明（SA6 #109 类型守卫锁：`runtime-registry-internal-type-guard.test-d.ts`
 * 对 `Parameters<typeof createNamespaceRuntimeForRegistry>` 断言两参形）——以「两参
 * 重载居末」承载：`typeof`/`Parameters` 见到的公共签名恒为两参（守卫零漂移），三参
 * 重载（可选第三参）供 #155 Registry 生产装配注入诊断；实现签名为三参可选。
 */
export function createNamespaceRuntimeForRegistry(
  handle: DocHandle,
  notifyDirty: () => Promise<void>,
  diagnostic: RuntimeForRegistryDiagnostic | undefined,
): NamespaceRuntime;
export function createNamespaceRuntimeForRegistry(
  handle: DocHandle,
  notifyDirty: () => Promise<void>,
): NamespaceRuntime;
export function createNamespaceRuntimeForRegistry(
  handle: DocHandle,
  notifyDirty: () => Promise<void>,
  diagnostic?: RuntimeForRegistryDiagnostic,
): NamespaceRuntime {
  return createNamespaceRuntime(handle, notifyDirty, diagnostic);
}

export { openReplicationSessionCoreForRegistry };
export type {
  RuntimeReplicationSessionApplyRefusalCode,
  RuntimeReplicationSessionApplyResult,
  RuntimeReplicationSessionCore,
  RuntimeReplicationSessionOpenResult,
  RuntimeReplicationSessionOptions,
  RuntimeReplicationSessionStatus,
};
export type { RuntimeForRegistryDiagnostic } from './runtime.js';

/**
 * @nomicore/namespace-registry —— 公共入口（issue #110 设计 §2.2 精确导出面；
 * issue #112 设计 §2.G 增量清单）。
 *
 * 仅导出：createNamespaceRegistry 工厂 + 三个公开错误类 + Cordis plugin 面
 * （createNamespaceRegistryPlugin / NOMICORE_REGISTRY_SERVICE /
 * provideNomicoreRegistry / requireNomicoreRegistry）+ DEFAULT_IDLE_TIMEOUT_MS
 * （值）；公共类型白名单（类型）。不导出运行时实例或构造器、租约句柄、编辑器文档、
 * User 能力类型、任何 entry/sequencer/observer/testing/internal 类型或内部依赖替换
 * 面（createRegistryTestScheduler / createRegistryInternal / removeOnlySelf /
 * createCordisRegistryScheduler / assertNamespaceRegistryHostDependencies 均不进主
 * 入口——testing 子路径由 package.json exports 另行暴露）。
 *
 * #112 导出链纪律（R1/M3）：DEFAULT_IDLE_TIMEOUT_MS 唯一运行时定义点在
 * registry.ts，plugin.ts 相对 import 后 re-export，本文件沿 plugin 链转出——零第二
 * 定义点。
 */
export {
  createNamespaceRegistry,
  NamespaceRegistryFatalError,
  NamespaceLeaseReleasedError,
  NamespaceRegistryShutdownError,
} from './registry.js';
export {
  NOMICORE_REGISTRY_SERVICE,
  createNamespaceRegistryPlugin,
  provideNomicoreRegistry,
  requireNomicoreRegistry,
  DEFAULT_IDLE_TIMEOUT_MS,
} from './plugin.js';
export type {
  CreateNamespaceInput,
  CreateNamespaceIssue,
  CreateNamespaceRegistryOptions,
  CreateNamespaceResult,
  NamespaceLease,
  NamespaceLeaseReleasedIssue,
  NamespaceLeaseStatus,
  NamespaceOwner,
  NamespaceRegistry,
  NamespaceRegistryFatalPhase,
  NamespaceRegistryShutdownFailure,
  NamespaceRegistryStatus,
  OpenNamespaceIssue,
  OpenNamespaceResult,
  RegistryRandomBytes,
  RegistryTimeoutScheduler,
} from './types.js';
export type { NamespaceRegistryPluginConfig } from './plugin.js';

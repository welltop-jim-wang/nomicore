/**
 * @nomicore/namespace-registry —— 公共入口（issue #110 设计 §2.2 精确导出面）。
 *
 * 仅导出：createNamespaceRegistry 工厂 + 两个公开错误类（值）；公共类型白名单
 * （类型）。不导出运行时实例或构造器、租约句柄、编辑器文档、User 能力类型、
 * 任何 entry/sequencer/observer/testing 类型或内部依赖替换面。`./testing`
 * 子路径由 package.json exports 另行暴露。
 */
export { createNamespaceRegistry, NamespaceRegistryFatalError, NamespaceLeaseReleasedError } from './registry.js';
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
  NamespaceRegistryStatus,
  OpenNamespaceIssue,
  OpenNamespaceResult,
} from './types.js';

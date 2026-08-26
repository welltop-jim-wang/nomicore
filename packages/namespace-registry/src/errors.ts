/**
 * @nomicore/namespace-registry —— 稳定错误（issue #110 设计 §3.2/§3.3）。
 *
 * - NamespaceRegistryFatalError：仅跨出公开窄结果的异常以该 branded error reject。
 *   它保留 exact cause 供受控调用方/observer 诊断，但 stable message 不含 cause 文本
 *   （零回显）；`committed` 为本票恒 false（#111 create 后才有 committed 语义）。
 * - NamespaceLeaseReleasedError：sync 数据投影 getter 在 released 后的唯一诚实拒绝
 *   通道（设计 §3.2）——code 固定常量；调用方以 `instanceof` 或 `code` 判别，
 *   不要求靠 message 窄化。
 */
import { NAMESPACE_LEASE_RELEASED_MESSAGE } from './types.js';
import type { NamespaceRegistryFatalPhase } from './types.js';

/**
 * Registry 内部故障（设计 §3.3）：operation/phase/committed 为稳定判别面；
 * cause 保留 exact 原始异常；message 为不可插值常量模板。
 */
export class NamespaceRegistryFatalError extends Error {
  readonly code = 'NAMESPACE_REGISTRY_FATAL' as const;
  readonly operation: 'open' | 'create' | 'shutdown';
  readonly phase: NamespaceRegistryFatalPhase;
  readonly committed: boolean;
  override readonly cause: unknown;

  constructor(
    operation: 'open' | 'create' | 'shutdown',
    phase: NamespaceRegistryFatalPhase,
    committed: boolean,
    cause: unknown,
  ) {
    super(`NAMESPACE_REGISTRY_FATAL: ${operation} 在 ${phase} 发生内部故障（committed=${committed}）`);
    this.name = 'NamespaceRegistryFatalError';
    this.operation = operation;
    this.phase = phase;
    this.committed = committed;
    this.cause = cause;
  }
}

/**
 * Lease released 后的同步 getter 拒绝（设计 §3.2）：恒定 message 与
 * NAMESPACE_LEASE_RELEASED issue 一致；read/两写走原结果联合 / Promise 通道，
 * 唯 getStatus 保持成功。
 */
export class NamespaceLeaseReleasedError extends Error {
  readonly code = 'NAMESPACE_LEASE_RELEASED' as const;

  constructor() {
    super(NAMESPACE_LEASE_RELEASED_MESSAGE);
    this.name = 'NamespaceLeaseReleasedError';
  }
}

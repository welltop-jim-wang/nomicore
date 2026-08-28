/**
 * @nomicore/namespace-registry —— 稳定错误（issue #110 设计 §3.2/§3.3；
 * issue #111 §7 operation/phase 词表连续性）。
 *
 * - NamespaceRegistryFatalError：仅跨出公开窄结果的异常以该 branded error reject。
 *   它保留 exact cause 供受控调用方/observer 诊断，但 stable message 不含 cause 文本
 *   （零回显）；`committed` 语义：#110 open 恒 false；#111 create 后带真实提交事实
 *   （runtime-construction=true；DocCreateFatalError 的 committed 原样传播；
 *   unknown/clock/create-document 按 §7 表）。
 * - NamespaceLeaseReleasedError：sync 数据投影 getter 在 released 后的唯一诚实拒绝
 *   通道（设计 §3.2）——code 固定常量；调用方以 `instanceof` 或 `code` 判别，
 *   不要求靠 message 窄化。
 */
import { NAMESPACE_LEASE_RELEASED_MESSAGE, NAMESPACE_REGISTRY_SHUTDOWN_FAILED_MESSAGE } from './types.js';
import type { NamespaceRegistryFatalPhase, NamespaceRegistryShutdownFailure } from './types.js';

/**
 * Registry 内部故障（设计 §3.3）：operation/phase/committed 为稳定判别面；
 * cause 保留 exact 原始异常；message 为不可插值常量模板。
 */
export class NamespaceRegistryFatalError extends Error {
  readonly code = 'NAMESPACE_REGISTRY_FATAL' as const;
  // Phase 5（issue #133；ADR 0010:222 授权 append-only）：+ 'reset' | 'import'
  // ——reset/archive 编排与受信 bootstrap 导入的内部故障通道（word 表既有三值
  // 语义不变，沿 #131 namespace-id-generation phase 增补先例）。
  readonly operation: 'open' | 'create' | 'shutdown' | 'reset' | 'import';
  readonly phase: NamespaceRegistryFatalPhase;
  readonly committed: boolean;
  override readonly cause: unknown;

  constructor(
    operation: 'open' | 'create' | 'shutdown' | 'reset' | 'import',
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

/**
 * Registry shutdown 聚合失败（#112 设计 §2.D/§2.H/§2.I）：部分 Runtime close 失败时
 * shutdown Promise reject 本错误——`code`/`name` 稳定、message 为恒定常量（零插值、
 * 零 identity/cause 回显）；`failures` 为冻结数组（逐元素 Object.freeze），顺序 =
 * shutdown 枚举时的 entries Map 插入序（Registry 生命周期内确定）。结构化字段
 * （owner/namespaceId）与 cause（exact 事实）是 message 级零回显纪律的显式边界
 * （与 NamespaceRegistryFatalError.cause 同款先例），供宿主运维定位。
 */
export class NamespaceRegistryShutdownError extends Error {
  readonly code = 'NAMESPACE_REGISTRY_SHUTDOWN_FAILED' as const;
  readonly failures: ReadonlyArray<NamespaceRegistryShutdownFailure>;

  constructor(failures: ReadonlyArray<NamespaceRegistryShutdownFailure>) {
    super(NAMESPACE_REGISTRY_SHUTDOWN_FAILED_MESSAGE);
    this.name = 'NamespaceRegistryShutdownError';
    this.failures = failures;
  }
}

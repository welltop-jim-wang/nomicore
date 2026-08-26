/**
 * @nomicore/namespace-registry —— 内部 observer seam（issue #110 设计 §8.1）。
 *
 * 仅由构造 options / testing seam 注入；同步调用必须被 try/catch 隔离——observer
 * 自身 throw 不得改变 Registry public result、主 fatal、handle release 调用次数或
 * queue tail（诊断 sink 失败不是业务失败）。event 携带 exact cause 与受控 identity，
 * 仅供日志/metrics/trace adapter；v1 无 public subscription；所有 public
 * error/issue 文本零回显本文件事件内容。
 */
import type { DocCreateOperationalError, DocLoadOperationalError } from '@nomicore/persistence';
import type { InternalIdentity } from './identity.js';

/** 内部 observer 事件（§8.1 冻结五形；#111 扩展为七形——设计 §8 DQ-8）。 */
export type RegistryObserverEvent =
  | { type: 'open-load-failed'; identity: InternalIdentity; cause: DocLoadOperationalError }
  | { type: 'open-runtime-construction-failed'; identity: InternalIdentity; cause: unknown }
  | { type: 'create-persist-failed'; identity: InternalIdentity; cause: DocCreateOperationalError }
  | { type: 'create-runtime-construction-failed'; identity: InternalIdentity; cause: unknown }
  | { type: 'handle-release-failed'; identity: InternalIdentity; cause: unknown }
  | { type: 'lease-released'; identity: InternalIdentity; generation: bigint; remainingLeases: number }
  | {
      type: 'lifecycle-slot-failed';
      identity: InternalIdentity;
      operation: 'open' | 'create';
      cause: unknown;
    };

/** observer 回调：同步调用；throw 由 dispatchObserver 隔离（静默丢弃）。 */
export type RegistryObserver = (event: RegistryObserverEvent) => void;

/**
 * 受控 diagnostics 诊断事件（§8.2）：仅测试诊断，不返回或读取 carrier/entry map；
 * keyDigest 是不可逆 token、非 raw identity；generation 为不复用 bigint。
 * 生产工厂不注入 diagnostics sink；仅 testing seam 注入。
 */
export type RegistryDiagnosticsEvent = {
  type: 'carrier-created' | 'carrier-deleted';
  keyDigest: string;
  generation: bigint;
};

/** diagnostics sink 回调：同步调用；throw 由 dispatchDiagnostics 隔离（静默丢弃）。 */
export type RegistryDiagnosticsSink = (event: RegistryDiagnosticsEvent) => void;

/** 隔离分发：observer 缺失或 throw 均为 no-op；绝不向调用栈传播。 */
export function dispatchObserver(
  observer: RegistryObserver | undefined,
  event: RegistryObserverEvent,
): void {
  if (observer === undefined) return;
  try {
    observer(event);
  } catch {
    // 诊断 sink 失败不是业务失败：静默丢弃（设计 §8.1）。
  }
}

/** 隔离分发（diagnostics 同款纪律）：sink 缺失或 throw 均为 no-op。 */
export function dispatchDiagnostics(
  sink: RegistryDiagnosticsSink | undefined,
  event: RegistryDiagnosticsEvent,
): void {
  if (sink === undefined) return;
  try {
    sink(event);
  } catch {
    // 诊断 sink 失败不是业务失败：静默丢弃（§8.1 同款隔离）。
  }
}

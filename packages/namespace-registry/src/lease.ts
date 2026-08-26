/**
 * @nomicore/namespace-registry —— lease 代理与 release（issue #110 设计 §7）。
 *
 * Lease 在签发时创建私有 controller（released/releasePromise 闭包状态）；`owner`
 * 为冻结独立投影、`namespaceId` 写入冻结对象；不返回 entry/runtime 引用。首个
 * release() 的同步段先置 released、从 entry.leases 删除自身，随后一次性创建并缓存
 * release promise（本票 resolve undefined），最后调用第三参 `onReleased` 回调
 * （#112：registry 据此在最后 lease 释放的同步段内武装 idle timer）。所有后续
 * release 与 [Symbol.asyncDispose] 返回**同一 Promise 实例**。
 *
 * released 逐方法通道（§7 表格）：read 同步返回 released issue；三投影 getter 同步
 * throw NamespaceLeaseReleasedError；getStatus 恒成功（released → runtime:null）；
 * 两写 resolve released issue（不 reject）。release 不追踪/取消已接纳写。
 *
 * 类型面：public alias 与 Runtime 对应成员逐字段锁死（编译期 Equal 断言）——
 * 本文件位于主入口不可达声明图之外，允许引用 Runtime 命名类型作断言锚。
 */
import { NamespaceLeaseReleasedError } from './errors.js';
import type {
  NamespaceLease,
  NamespaceLeaseActiveSchema,
  NamespaceLeaseMetadata,
  NamespaceLeaseMutateRootResult,
  NamespaceLeaseReadResult,
  NamespaceLeaseReleasedIssue,
  NamespaceLeaseReplaceSchemaInput,
  NamespaceLeaseReplaceSchemaResult,
  NamespaceLeaseSchemaEnvelope,
  NamespaceRuntimeStatusProjection,
} from './types.js';
import { ASYNC_DISPOSE, NAMESPACE_LEASE_RELEASED_MESSAGE } from './types.js';
import type { NamespaceRuntime } from '@nomicore/namespace-runtime';
import type { NamespaceRuntimeStatus } from '@nomicore/namespace-runtime';
import { dispatchObserver, type RegistryObserver } from './observer.js';

/** entry 的 lease 侧只读引用面（registry.ts 的 Entry 结构性满足）。 */
export interface LeaseEntryRef {
  readonly key: string;
  readonly generation: bigint;
  readonly owner: Readonly<{ readonly userId: string }>;
  readonly namespaceId: string;
  readonly runtime: NamespaceRuntime;
  readonly leases: Set<NamespaceLease>;
}

/** released issue 单例（冻结；message 引用 types.ts 单一真相源常量，不插值、无 identity 回显）。 */
const RELEASED_ISSUE: NamespaceLeaseReleasedIssue = Object.freeze({
  ok: false,
  code: 'NAMESPACE_LEASE_RELEASED',
  message: NAMESPACE_LEASE_RELEASED_MESSAGE,
});

/**
 * 签发 lease controller（§7）：对象冻结；owner 为独立冻结投影（不是 entry.owner
 * 引用，也不暴露 entry/runtime）。observer 经 dispatchObserver 隔离。
 *
 * #112 增量（设计 §2.B）：第三参 `onReleased?`——在**首次** release() 同步段内、
 * entry.leases.delete(controller) 与 `lease-released` observer 事件**之后**调用
 * （恰一次，仅首次 release；registry 侧以 onReleased 闭包绑定 idle 武装
 * handleLeaseReleased）。release 的 same-Promise / 同步失效契约不为回调改动：
 * released 标记与 releasePromise 缓存先于回调；回调 throw 由调用方（registry
 * handleLeaseReleased 的 setTimeout try/catch）隔离，不影响 release() 结果。
 */
export function createLeaseController(
  entry: LeaseEntryRef,
  observer: RegistryObserver | undefined,
  onReleased?: () => void,
): NamespaceLease {
  const owner = Object.freeze({ userId: entry.owner.userId });
  const namespaceId = entry.namespaceId;
  let released = false;
  let releasePromise: Promise<void> | undefined;
  let controller: NamespaceLease;

  const doRelease = (): Promise<void> => {
    if (releasePromise === undefined) {
      released = true;
      entry.leases.delete(controller);
      releasePromise = Promise.resolve();
      dispatchObserver(observer, {
        type: 'lease-released',
        identity: { owner, namespaceId, key: entry.key },
        generation: entry.generation,
        remainingLeases: entry.leases.size,
      });
      onReleased?.();
    }
    return releasePromise;
  };

  const lease: NamespaceLease = {
    owner,
    namespaceId,
    read(path) {
      if (released) return RELEASED_ISSUE;
      return entry.runtime.read(path);
    },
    getSchemaEnvelope() {
      if (released) throw new NamespaceLeaseReleasedError();
      return entry.runtime.getSchemaEnvelope();
    },
    getMetadata() {
      if (released) throw new NamespaceLeaseReleasedError();
      return entry.runtime.getMetadata();
    },
    getActiveSchema() {
      if (released) throw new NamespaceLeaseReleasedError();
      return entry.runtime.getActiveSchema();
    },
    getStatus() {
      if (released) {
        return Object.freeze({ lease: 'released' as const, runtime: null });
      }
      // 设计 §7「status 产物都冻结」字面：active 分支内层 runtime 投影亦冻结
      // （runtime.getStatus() 每次调用返回全新对象，冻结不共享、零副作用）。
      return Object.freeze({
        lease: 'active' as const,
        runtime: Object.freeze(entry.runtime.getStatus()),
      });
    },
    mutateRoot(mutation) {
      if (released) return Promise.resolve(RELEASED_ISSUE);
      return entry.runtime.mutateRoot(mutation);
    },
    replaceSchema(input) {
      if (released) return Promise.resolve(RELEASED_ISSUE);
      return entry.runtime.replaceSchema(input);
    },
    release: doRelease,
    [ASYNC_DISPOSE]: doRelease,
  };
  controller = Object.freeze(lease);
  return controller;
}

// —— 类型级锁：public alias 与 Runtime 能力逐字段相等（形状漂移 → 编译期红）——
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type AssertTrue<T extends true> = T;

type _readAlias = AssertTrue<
  Equal<NamespaceLeaseReadResult, ReturnType<NamespaceRuntime['read']> | NamespaceLeaseReleasedIssue>
>;
type _schemaEnvelopeAlias = AssertTrue<
  Equal<NamespaceLeaseSchemaEnvelope, ReturnType<NamespaceRuntime['getSchemaEnvelope']>>
>;
type _metadataAlias = AssertTrue<
  Equal<NamespaceLeaseMetadata, ReturnType<NamespaceRuntime['getMetadata']>>
>;
type _activeSchemaAlias = AssertTrue<
  Equal<NamespaceLeaseActiveSchema, ReturnType<NamespaceRuntime['getActiveSchema']>>
>;
type _projectionAlias = AssertTrue<Equal<NamespaceRuntimeStatusProjection, NamespaceRuntimeStatus>>;
type _mutateAlias = AssertTrue<
  Equal<
    NamespaceLeaseMutateRootResult,
    Awaited<ReturnType<NamespaceRuntime['mutateRoot']>> | NamespaceLeaseReleasedIssue
  >
>;
type _replaceInputAlias = AssertTrue<
  Equal<NamespaceLeaseReplaceSchemaInput, Parameters<NamespaceRuntime['replaceSchema']>[0]>
>;
type _replaceResultAlias = AssertTrue<
  Equal<
    NamespaceLeaseReplaceSchemaResult,
    Awaited<ReturnType<NamespaceRuntime['replaceSchema']>> | NamespaceLeaseReleasedIssue
  >
>;

// 声明期证明（仅 typecheck 用，零运行时值）。
export type LeaseTypeAssertions = {
  readonly read: _readAlias;
  readonly schemaEnvelope: _schemaEnvelopeAlias;
  readonly metadata: _metadataAlias;
  readonly activeSchema: _activeSchemaAlias;
  readonly projection: _projectionAlias;
  readonly mutate: _mutateAlias;
  readonly replaceInput: _replaceInputAlias;
  readonly replaceResult: _replaceResultAlias;
};

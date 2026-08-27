/**
 * SA6 红灯锚定（类型面）— issue #132（Phase 5: enable replication identity and
 * epoch management）AC-1/AC-4/AC-5：Lease 复制管理操作与 status 复制域的公共类型
 * 契约（运行时行为锚见 registry-phase5-replication-red.test.ts）。
 *
 * 锚定机制（vitest --typecheck 下红/绿翻转）：
 * - 【红】`NamespaceLease` 必须暴露 ADR 0010 冻结名的 Hub 复制管理操作
 *   `enableReplication()` / `bumpReplicationEpoch()`（返回 `Readonly<{ok:boolean}>`
 *   结果联合——与 replaceSchema/mutateRoot 的写结果联合同构；具体返回字段属 SA1
 *   设计，本锚只锁 `ok` 判别与 Promise 通道）→ 当前类型面两方法均缺席 →
 *   条件类型求值 `never` → `true` 赋值 TS2322 → 红；SA3 落位 → 绿。
 * - 【红】`NamespaceRuntimeStatus`（runtime 包）与
 *   `NamespaceRuntimeStatusProjection`（registry 包）必须暴露复制域
 *   `replication: {state:'disabled'} | {state:'enabled'; replicationId; replicationEpoch}`
 *   （AC-5：Open/Runtime status 可区分 disabled/enabled 并以值判别身份演进；
 *   ADR-0008「键集/形状即公共契约」）→ 当前两类型面均无该域 → 红。
 * - 【绿（保持性守卫）】Lease 不新增通用 META 写面（ADR 0010「META.replicationId/
 *   replicationEpoch 只能由 hub 的显式复制管理操作修改」——无 setMetadata/
 *   writeMeta/rawUpdate 旁路）——现契约已满足，防回潮。
 * - 【绿（保持性守卫）】Lease 不暴露 doc/handle/runtime 原始引用（ADR 0009 能力
 *   代理边界沿袭）——现契约已满足。
 */
import { describe, it } from 'vitest';
import type { NamespaceLease, NamespaceLeaseStatus } from '@nomicore/namespace-registry';
import type { NamespaceRuntimeStatus } from '@nomicore/namespace-runtime';

/** 复制域形状（ADR 0010 冻结格式：replicationId=32 小写 hex、replicationEpoch=安全整数）。 */
type ReplicationStatusDomain =
  | Readonly<{ state: 'disabled' }>
  | Readonly<{ state: 'enabled'; replicationId: string; replicationEpoch: number }>;

type HasEnableReplication<T> = T extends {
  readonly enableReplication: () => Promise<Readonly<{ ok: boolean }>>;
}
  ? true
  : never;

type HasBumpReplicationEpoch<T> = T extends {
  readonly bumpReplicationEpoch: () => Promise<Readonly<{ ok: boolean }>>;
}
  ? true
  : never;

type HasReplicationStatus<T> = T extends { readonly replication: ReplicationStatusDomain } ? true : never;

/**
 * Lease status 联合 → active 分支的 runtime 投影（即 NamespaceRuntimeStatusProjection，
 * 该投影类型本身非 index 导出——经已导出的 NamespaceLeaseStatus 条件推断提取）。
 *
 * 修订（Phase 1 回流）：原 `ActiveRuntimeHasReplication<T>` 对联合 T 分布式求值
 * 产生 `true | false` = boolean，再 `extends true` 恒判定为 never——正确实现也
 * 永远红。现改为两步：先以分布式推断把联合消解为单类型（active 分支 → 投影 R；
 * released 分支 runtime:null 失配 → never，结果恰为投影类型本身），再以单层判别
 * 锚定 `replication` 域——无分布残留，锚定语义不变（active 分支 runtime 投影必须
 * 携带复制域）。
 */
type LeaseActiveRuntime<T> = T extends { readonly lease: 'active'; readonly runtime: infer R }
  ? R
  : never;

type HasGenericMetaWrite<T> = T extends
  | { readonly setMetadata: unknown }
  | { readonly writeMetadata: unknown }
  | { readonly mutateMeta: unknown }
  | { readonly rawUpdate: unknown }
  ? true
  : false;

type HasRawDocRef<T> = T extends
  | { readonly doc: unknown }
  | { readonly handle: unknown }
  | { readonly runtime: unknown }
  ? true
  : false;

describe('类型面：Lease Hub 复制管理操作（AC-2/AC-3/AC-4，ADR 0010 冻结名）', () => {
  it('NamespaceLease 暴露 enableReplication(): Promise<{ok:boolean}>', () => {
    const leaseHasEnable: HasEnableReplication<NamespaceLease> = true;
    void leaseHasEnable;
  });

  it('NamespaceLease 暴露 bumpReplicationEpoch(): Promise<{ok:boolean}>', () => {
    const leaseHasBump: HasBumpReplicationEpoch<NamespaceLease> = true;
    void leaseHasBump;
  });
});

describe('类型面：status 复制域（AC-5）', () => {
  it('NamespaceRuntimeStatus（runtime 包）暴露 replication 复制域', () => {
    const runtimeHasStatus: HasReplicationStatus<NamespaceRuntimeStatus> = true;
    void runtimeHasStatus;
  });

  it('NamespaceLeaseStatus.active.runtime（即 registry 包 Lease status 投影）暴露同款复制域', () => {
    const projectionHasStatus: HasReplicationStatus<LeaseActiveRuntime<NamespaceLeaseStatus>> = true;
    void projectionHasStatus;
  });
});

describe('类型面：Lease 无通用 META 写面与无原始引用（AC-4 Hub-only 独占面保持性守卫）', () => {
  it('NamespaceLease 无 setMetadata/writeMetadata/mutateMeta/rawUpdate 成员', () => {
    const noGenericWrite: HasGenericMetaWrite<NamespaceLease> extends true ? never : true = true;
    void noGenericWrite;
  });

  it('NamespaceLease 无 doc/handle/runtime 原始引用成员', () => {
    const noRawRef: HasRawDocRef<NamespaceLease> extends true ? never : true = true;
    void noRawRef;
  });
});

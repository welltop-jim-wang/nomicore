/**
 * SA6 红灯锚定（类型面）— issue #134（Phase 5: expose trusted NamespaceLease
 * ReplicationSession）AC-1/AC-2/AC-4：Lease session 打开面与 ReplicationSession
 * 窄能力面的公共类型契约（运行时行为锚见
 * registry-phase5-replication-session-red.test.ts）。
 *
 * 锚定机制（vitest --typecheck 下红/绿翻转；沿
 * registry-phase5-replication-surface.test-d.ts 条件类型探针先例）：
 * - 【红】`ReplicationSession` 必须以公共类型名自
 *   `@nomicore/namespace-registry` 导出——基线不存在 → 本文件导入即编译失败
 *   （TS2305），属任务简报允许的「导入即编译失败」级类型红；
 * - 【红】`NamespaceLease` 必须暴露 `openReplicationSession(options)`
 *   （ADR 0010 L73–77，Options 形状未由 ADR 冻结——探针以 `(options: any)` 只锁
 *   方法存在与 Promise/ok 判别通道，不锁 options 形状）→ 基线类型面该方法缺席 →
 *   条件类型求值 `never` → `true` 赋值 TS2322 → 红；SA3 落位 → 绿；
 * - 【红】`ReplicationSession` 类型形状必须携带冻结四域（localRole /
 *   remoteInstanceId / replicationId / replicationEpoch——L81「创建时冻结」的
 *   类型投影）与六项窄能力（encodeStateVector / encodeDiff /
 *   subscribeOwnedUpdates / applyRemoteUpdate / getStatus / close——L83–88），
 *   且**不得**携带 doc/handle/sequencer/runtime/ydoc/sharedTypes 键
 *   （L81「而不暴露 Y.Doc」+ L109–111 observer「不暴露 live Y.Doc」；
 *   类型键集=公共契约，运行时 Property 探测见行为文件）；
 * - 【绿（保持性守卫）】Lease 不新增裸 raw apply / 通用 update 旁路
 *   （ADR 0010 L79「不得把它暴露为普通客户端写入口」——raw 能力只经
 *   ReplicationSession，经 Lease 直调 applyRemoteUpdate 属来源违反）；
 * - 【绿（保持性守卫）】ReplicationSession 类型不携带任何持久化/句柄标识类型。
 */
import { describe, it } from 'vitest';
import type { NamespaceLease } from '@nomicore/namespace-registry';
// 基线红点 1：ReplicationSession 类型不存在 → 导入即编译失败（TS2305）。
import type { ReplicationSession } from '@nomicore/namespace-registry';

/** 窄能力面（六项 + 冻结四域；方法名 SA6 建议、SA1 冻结——见红灯记录词汇清单）。 */
type SessionCapsShape = {
  readonly localRole: 'hub' | 'peer';
  readonly remoteInstanceId: string;
  readonly replicationId: string;
  readonly replicationEpoch: number;
  encodeStateVector(): Uint8Array;
  encodeDiff(remoteStateVector: Uint8Array): Uint8Array;
  subscribeOwnedUpdates(listener: (update: Uint8Array) => void): () => void;
  applyRemoteUpdate(update: Uint8Array): Promise<Readonly<{ ok: boolean }>>;
  getStatus(): Readonly<Record<string, unknown>>;
  close(): Promise<unknown>;
};

type HasSessionCaps<T> = T extends SessionCapsShape ? true : never;

/** 内部句柄/运行时对象键身位——命中即契约违反（ADR 0010 L81/L109–111）。 */
type HasForbiddenRefs<T> = T extends
  | { readonly doc: unknown }
  | { readonly handle: unknown }
  | { readonly sequencer: unknown }
  | { readonly runtime: unknown }
  | { readonly ydoc: unknown }
  | { readonly sharedTypes: unknown }
  ? true
  : false;

/** Lease 打开面：方法存在 + Promise<ok 判别>通道（options 形状不锁——SA1 冻结）。 */
type HasOpenReplicationSession<T> = T extends {
  readonly openReplicationSession: (options: any) => Promise<Readonly<{ ok: boolean }>>;
}
  ? true
  : never;

/** Lease 不得提供裸 raw apply 旁路（ADR 0010 L79：不暴露为普通客户端写入口）。 */
type HasLeaseRawApply<T> = T extends
  | { readonly applyRemoteUpdate: unknown }
  | { readonly applyUpdate: unknown }
  | { readonly rawUpdate: unknown }
  ? true
  : false;

describe('类型面：ReplicationSession 公共类型（AC-1/AC-2，ADR 0010 L81–88）', () => {
  it('ReplicationSession 自 @nomicore/namespace-registry 导出（基线：导入即编译失败）', () => {
    const exists: HasSessionCaps<ReplicationSession> | HasForbiddenRefs<ReplicationSession> = true;
    void exists;
  });

  it('ReplicationSession 类型键集含冻结四域 + 六项窄能力', () => {
    const caps: HasSessionCaps<ReplicationSession> = true;
    void caps;
  });

  it('ReplicationSession 类型键集不含 doc/handle/sequencer/runtime/ydoc/sharedTypes', () => {
    const forbidden: HasForbiddenRefs<ReplicationSession> = false;
    void forbidden;
  });
});

describe('类型面：NamespaceLease 打开面（AC-1/AC-4，ADR 0010 L73–79）', () => {
  it('NamespaceLease 暴露 openReplicationSession(options): Promise<{ok:boolean}>', () => {
    const leaseHasOpen: HasOpenReplicationSession<NamespaceLease> = true;
    void leaseHasOpen;
  });

  it('保持性守卫：NamespaceLease 无裸 raw apply 旁路（raw 只经 ReplicationSession）', () => {
    const leaseRawApply: HasLeaseRawApply<NamespaceLease> = false;
    void leaseRawApply;
  });
});

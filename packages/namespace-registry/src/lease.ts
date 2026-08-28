/**
 * @nomicore/namespace-registry —— lease 代理与 release（issue #110 设计 §7；
 * issue #132 增复制管理两方法；issue #134 增 openReplicationSession 会话编排）。
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
 * 四写（mutateRoot/replaceSchema/enableReplication/bumpReplicationEpoch）resolve
 * released issue（不 reject）。release 不追踪/取消已接纳写。
 *
 * #132 增量（D-7）：第 4 参 `deps.drawReplicationId`（包内签名；必选——无缺省即无
 * 降级）——enableReplication 在 Lease 接纳段（released 检查之后）同步抽取 128-bit
 * 复制谱系 id，作为**值输入**传给 runtime.enableReplication({ replicationId })；
 * 随机源违约（throw/形状违约/格式违约）→ 结果面 issue
 * （REPLICATION_RANDOM_SOURCE_INVALID，不同步 throw、不走 rejection——Lease 写操作
 * 纪律「一切拒绝经返回的 Promise 结算」）。
 *
 * 类型面：public alias 与 Runtime 对应成员逐字段锁死（编译期 Equal 断言）——
 * 本文件位于主入口不可达声明图之外，允许引用 Runtime 命名类型作断言锚。
 */
import { NamespaceLeaseReleasedError } from './errors.js';
import type {
  NamespaceLease,
  NamespaceLeaseActiveSchema,
  NamespaceLeaseBumpReplicationEpochResult,
  NamespaceLeaseEnableReplicationResult,
  NamespaceLeaseMetadata,
  NamespaceLeaseMutateRootResult,
  NamespaceLeaseReadResult,
  NamespaceLeaseReleasedIssue,
  NamespaceLeaseReplaceSchemaInput,
  NamespaceLeaseReplaceSchemaResult,
  NamespaceLeaseSchemaEnvelope,
  NamespaceRuntimeStatusProjection,
  ReplicationSession,
  ReplicationSessionApplyResult,
  ReplicationSessionStatus,
  InstanceRole,
} from './types.js';
import {
  ASYNC_DISPOSE,
  NAMESPACE_LEASE_RELEASED_MESSAGE,
  REPLICATION_ROLE_MISMATCH_MESSAGE,
  REPLICATION_ROLE_PERMISSION_MESSAGE,
  REPLICATION_SESSION_EXISTS_MESSAGE,
  REPLICATION_SESSION_INPUT_INVALID_MESSAGE,
} from './types.js';
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

/**
 * 复制谱系 id 抽取结果（#132 D-7；类型落位本文件并包内导出——registry.ts 经既有
 * './lease.js' import 引用，单项零循环；不进主入口可达声明图）。
 * 永不 throw（Lease 写操作纪律：一切拒绝经返回的 Promise 结算）。
 */
export type ReplicationIdDraw =
  | { readonly ok: true; readonly replicationId: string }
  | { readonly ok: false; readonly issue: { readonly message: string; readonly path: readonly [] } };

/** released issue 单例（冻结；message 引用 types.ts 单一真相源常量，不插值、无 identity 回显）。 */
const RELEASED_ISSUE: NamespaceLeaseReleasedIssue = Object.freeze({
  ok: false,
  code: 'NAMESPACE_LEASE_RELEASED',
  message: NAMESPACE_LEASE_RELEASED_MESSAGE,
});

/** openReplicationSession 的 released 通道结果（O-3 通道表增补；与四写同款——经返回
 *  Promise 结算，message 复用既有冻结常量）。 */
const RELEASED_SESSION_OPEN_ISSUE = Object.freeze({
  ok: false as const,
  code: 'NAMESPACE_LEASE_RELEASED' as const,
  message: NAMESPACE_LEASE_RELEASED_MESSAGE,
});

/** peer 实例角色权限 issue（O-5b / INV-S14）：冻结常量实例——重复调用 JSON 逐字节相同
 *  （SA6 用例 13 稳定锚）；形状 = 既有 `{ok:false; issues}` 联合零改形（码前缀 message，
 *  沿 REPLICATION_INPUT_INVALID 族先例；issues 元素 path 恒 []——gate 级 issue 同款）。 */
const ROLE_PERMISSION_ISSUE: Readonly<{ ok: false; issues: unknown[] }> = Object.freeze({
  ok: false as const,
  issues: [{ message: REPLICATION_ROLE_PERMISSION_MESSAGE, path: [] }],
});

/**
 * openReplicationSession 输入形状校验（§5.1 ②）：**单读捕获 + 全探测 try/catch**——沿
 * enableReplication D-7 纪律；敌意 Proxy/getter/ownKeys trap 的任何 throw 收编为
 * REPLICATION_SESSION_INPUT_INVALID（绝不同步 throw、绝不升格 fatal）。
 * 判据：input 为对象 ∧ own 键集恰含 {localRole, remoteInstanceId} ∧ localRole ∈
 * {'hub','peer'} ∧ remoteInstanceId 匹配 instanceId 安全文法（ADR 0010 L156）。
 */
function parseOpenSessionOptions(
  input: unknown,
):
  | { readonly ok: true; readonly localRole: 'hub' | 'peer'; readonly remoteInstanceId: string }
  | { readonly ok: false } {
  try {
    if (typeof input !== 'object' || input === null) return { ok: false };
    const record = input as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length !== 2) return { ok: false };
    if (!keys.includes('localRole') || !keys.includes('remoteInstanceId')) return { ok: false };
    const localRole = record.localRole; // 单读捕获（此后零再读 input——双读分叉不可达）
    const remoteInstanceId = record.remoteInstanceId;
    if (localRole !== 'hub' && localRole !== 'peer') return { ok: false };
    if (typeof remoteInstanceId !== 'string' || !INSTANCE_ID_PATTERN.test(remoteInstanceId)) {
      return { ok: false };
    }
    return { ok: true, localRole, remoteInstanceId };
  } catch {
    return { ok: false }; // 敌意 Proxy trap throw → 输入缺陷（类 B issue 语义）
  }
}

/**
 * registry 本地 instanceId 结构守卫常量——沿 NAMESPACE_ID_PATTERN / REPLICATION_ID_PATTERN
 * 本地常量先例（跨包 import @nomicore/replication-protocol 属切片 6 接线，本切片非依赖）：
 * runtime 侧：packages/replication-protocol/src/constants.ts INSTANCE_ID_RE（ADR 0010
 * L156 安全文法）；两份副本互为结构守卫（注释互相引用对方落点）。
 */
const INSTANCE_ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;

/**
 * runtime internal seam 消费面的结构性描述（§3.2 面；**本文件零 internal subpath
 * import**——import 图审计的「Registry 包内仅 registry.ts 消费 internal subpath」单
 * 消费者纪律（registry-surface.test.ts）；seam 函数经 registry.ts 注入 deps，类型面
 * 以本结构性接口表达。与 Runtime 包 internal 面逐字段同构：由 registry.ts 侧
 * `Equal<RuntimeReplicationSessionCore, ReplicationSession>` 断言（真锁，T-1）+ 本文件
 * `Equal<ReplicationSessionOpenCore, ReplicationSession>` 断言（声明面自锁）双重锁死）。
 */
export interface ReplicationSessionOpenCore {
  readonly localRole: 'hub' | 'peer';
  readonly remoteInstanceId: string;
  readonly replicationId: string;
  readonly replicationEpoch: number;
  encodeStateVector(): Uint8Array;
  encodeDiff(remoteStateVector: Uint8Array): Uint8Array;
  subscribeOwnedUpdates(listener: (update: Uint8Array) => void): () => void;
  applyRemoteUpdate(update: Uint8Array): Promise<ReplicationSessionApplyResult>;
  getStatus(): Readonly<ReplicationSessionStatus>;
  close(): Promise<void>;
}

/** open seam 结果（结构复制型；与 runtime 侧 RuntimeReplicationSessionOpenResult 同构——
 *  code 闭集 = registry §3.1 OpenReplicationSessionIssueCode 的 open 域成员）。 */
export type ReplicationSessionOpenCoreResult =
  | Readonly<{ ok: true; core: ReplicationSessionOpenCore }>
  | Readonly<{
      ok: false;
      code: 'REPLICATION_NOT_ENABLED' | 'RUNTIME_WRITE_DISABLED' | 'REPLICATION_SESSION_UNSUPPORTED';
      message: string;
    }>;

/**
 * 签发 lease controller（§7）：对象冻结；owner 为独立冻结投影（不是 entry.owner
 * 引用，也不暴露 entry/runtime）。observer 经 dispatchObserver 隔离。
 *
 * #112 增量（设计 §2.B）：第三参 `onReleased`——在**首次** release() 同步段内、
 * entry.leases.delete(controller) 与 `lease-released` observer 事件**之后**调用
 * （恰一次，仅首次 release；registry 侧以 onReleased 闭包绑定 idle 武装
 * handleLeaseReleased）。release 的 same-Promise / 同步失效契约不为回调改动：
 * released 标记与 releasePromise 缓存先于回调；回调 throw 由调用方（registry
 * handleLeaseReleased 的 setTimeout try/catch）隔离，不影响 release() 结果。
 * 无回调时传 undefined（TS 必选参数位——保持第 4 参 deps 必选无缺省，见下）。
 *
 * #132 增量（D-7）：第 4 参 `deps.drawReplicationId`（包内签名；**必选——无缺省即无
 * 降级**）。
 */
export function createLeaseController(
  entry: LeaseEntryRef,
  observer: RegistryObserver | undefined,
  onReleased: (() => void) | undefined,
  deps: {
    readonly drawReplicationId: () => ReplicationIdDraw;
    /** 实例静态角色（O-4；构造期已过形状门禁——闭包绑定）。 */
    readonly role: InstanceRole;
    /** runtime 复制会话 seam（registry.ts 单消费者注入——import 图审计纪律；值 =
     *  @nomicore/namespace-runtime/internal 的 openReplicationSessionCoreForRegistry）。 */
    readonly openReplicationSessionCore: (
      runtime: NamespaceRuntime,
      options: { readonly localRole: 'hub' | 'peer'; readonly remoteInstanceId: string },
    ) => ReplicationSessionOpenCoreResult;
  },
): NamespaceLease {
  const owner = Object.freeze({ userId: entry.owner.userId });
  const namespaceId = entry.namespaceId;
  let released = false;
  let releasePromise: Promise<void> | undefined;
  let activeSession: ReplicationSession | undefined; // 每 Lease 一活跃 session 计数（O-9：Lease 层——Runtime 多 Lease 共享不可计数）
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
      // issue #134 round-2（R2-5，§6.1）：幂等直调 session.close()——不先查状态
      // （getStatus seam 异常不得跳过 close / 不得同步抛出）；close 的同步/异步异常
      // 全部隔离（guaranteed cleanup 路径——onReleased 无条件执行，半释放结构性
      // 不可达）。既有 session（含终态 closed/conflicted）同样直调（close 幂等
      // same-promise / 恒绿 barrier——L246「永不 reject」使直调零风险，red #6 锚
      // 终态仍收到 close 调用）。不追踪已接纳 apply 槽（ADR 0009 L42——release
      // 不等待/取消已成接纳写）；release 事实由 Lease getStatus() 单点投影，session
      // status 不复写（O-11——不双写）。
      if (activeSession !== undefined) {
        try {
          // 【R2.1 / SA2 #5 加固】Promise.resolve(closing) 同化：敌意返回值（undefined /
          // 原始值 / thenable / 假 catch 方法返回 rejecting promise 的对象）一律经原生
          // promise 吸收——.catch 为原生方法，兜底分支结构性零 unhandled rejection
          //（前版 closing.catch 直接调用敌意 catch 方法的尾巴已闭合）。
          const closing = activeSession.close() as unknown;
          void Promise.resolve(closing).catch(() => {});
        } catch {
          /* session seam 同步 throw 隔离——不阻断 onReleased（guaranteed cleanup 路径） */
        }
      }
      onReleased?.();
    }
    return releasePromise;
  };

  /**
   * 包装公共 session（§5.1 ⑥）：恰十键冻结字面量（能力键齐 + 句柄键零——INV-S13）；
   * 冻结四域以构造时捕获常量直读（结构性不漂移）；getter 域 throw 由 core 承担；
   * apply 的 lease release 先行映射（A0 revoked → NAMESPACE_LEASE_RELEASED——唯一产出点）。
   */
  function wrapCore(core: ReplicationSessionOpenCore, isRevoked: () => boolean): ReplicationSession {
    // 显式类型化字面量（不内联 Object.freeze——冻结在类型化字面量之后，上下文类型
    // 对参数/返回全部生效；产物为冻结的恰十键对象——INV-S13）
    const session: ReplicationSession = {
      localRole: core.localRole,
      remoteInstanceId: core.remoteInstanceId,
      replicationId: core.replicationId,
      replicationEpoch: core.replicationEpoch,
      encodeStateVector: () => core.encodeStateVector(),
      encodeDiff: (sv) => core.encodeDiff(sv),
      subscribeOwnedUpdates: (listener) => core.subscribeOwnedUpdates(listener),
      applyRemoteUpdate: (update): Promise<ReplicationSessionApplyResult> =>
        isRevoked()
          ? Promise.resolve({
              ok: false,
              code: 'NAMESPACE_LEASE_RELEASED',
              message: NAMESPACE_LEASE_RELEASED_MESSAGE,
            })
          : core.applyRemoteUpdate(update),
      getStatus: () => core.getStatus(),
      close: () => core.close(), // 幂等 same-promise 在 core
    };
    return Object.freeze(session);
  }

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
      // O-5b / INV-S14：peer 实例无 SCHEMA 本地修改权（ADR 0010 L118）——Lease 接纳段
      // 稳定角色权限拒绝（常量 issue——重复调用 JSON 逐字节相同）；hub 透传零改动
      if (deps.role === 'peer') return Promise.resolve(ROLE_PERMISSION_ISSUE);
      return entry.runtime.replaceSchema(input);
    },
    enableReplication() {
      // D-7/#132：released 通道与两写同款；随机源抽取在接纳段同步执行（released/peer 后
      // 零消耗——gate 先于 drawReplicationId）；违约 → 结果面 issue（绝不同步 throw、绝不
      // unhandled rejection——写操作纪律「一切拒绝经返回的 Promise 结算」）
      if (released) return Promise.resolve(RELEASED_ISSUE);
      // L120：复制管理操作 hub-only——peer 同 replaceSchema 角色权限拒绝
      if (deps.role === 'peer') return Promise.resolve(ROLE_PERMISSION_ISSUE);
      const drawn = deps.drawReplicationId();
      if (!drawn.ok) {
        return Promise.resolve({ ok: false as const, issues: [drawn.issue] });
      }
      return entry.runtime.enableReplication({ replicationId: drawn.replicationId });
    },
    bumpReplicationEpoch() {
      if (released) return Promise.resolve(RELEASED_ISSUE);
      if (deps.role === 'peer') return Promise.resolve(ROLE_PERMISSION_ISSUE); // L120 hub-only
      return entry.runtime.bumpReplicationEpoch();
    },
    openReplicationSession(options) {
      // issue #134 编排（§5.1，全同步——check-then-set 原子；①–⑥ 顺序冻结）
      // ① released 通道（O-3 通道表增补：经返回 Promise 结算 NAMESPACE_LEASE_RELEASED）
      if (released) return Promise.resolve(RELEASED_SESSION_OPEN_ISSUE);
      // ② 输入校验（单读捕获 + 全探测 try/catch——敌意 Proxy 零升级 fatal）
      const parsed = parseOpenSessionOptions(options);
      if (!parsed.ok) {
        return Promise.resolve({
          ok: false,
          code: 'REPLICATION_SESSION_INPUT_INVALID',
          message: REPLICATION_SESSION_INPUT_INVALID_MESSAGE,
        });
      }
      // ③ 角色匹配（O-4）：options.localRole ≠ 实例 role → 稳定拒绝
      if (parsed.localRole !== deps.role) {
        return Promise.resolve({
          ok: false,
          code: 'REPLICATION_ROLE_MISMATCH',
          message: REPLICATION_ROLE_MISMATCH_MESSAGE,
        });
      }
      // ④ 每 Lease 至多一个活跃 session（活跃 ⟺ state==='open'；closed/conflicted 终态
      //    同步释放槽位——O-8/O-9，终态后同 Lease 可再 open）
      if (activeSession !== undefined && activeSession.getStatus().state === 'open') {
        return Promise.resolve({
          ok: false,
          code: 'REPLICATION_SESSION_EXISTS',
          message: REPLICATION_SESSION_EXISTS_MESSAGE,
        });
      }
      // ⑤ internal seam（经 registry.ts 注入的 deps.openReplicationSessionCore——全同步；
      //    门序 host 缺席→lifecycle→fatal→disabled→冻结 facts 建 core；无 schemaState
      //    gate——§3.2 有意行为）
      const opened = deps.openReplicationSessionCore(entry.runtime, {
        localRole: parsed.localRole,
        remoteInstanceId: parsed.remoteInstanceId,
      });
      if (!opened.ok) {
        return Promise.resolve({ ok: false, code: opened.code, message: opened.message });
      }
      // ⑥ 包装公共 session（恰十键冻结字面量；冻结四域以构造时捕获常量直读）
      activeSession = wrapCore(opened.core, () => released);
      return Promise.resolve({ ok: true, session: activeSession });
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
// —— #132 增量：复制管理结果 alias 与 Runtime 对应成员逐字段相等（形状漂移 → 编译期红）——
type _enableReplicationResultAlias = AssertTrue<
  Equal<
    NamespaceLeaseEnableReplicationResult,
    Awaited<ReturnType<NamespaceRuntime['enableReplication']>> | NamespaceLeaseReleasedIssue
  >
>;
type _bumpReplicationEpochResultAlias = AssertTrue<
  Equal<
    NamespaceLeaseBumpReplicationEpochResult,
    Awaited<ReturnType<NamespaceRuntime['bumpReplicationEpoch']>> | NamespaceLeaseReleasedIssue
  >
>;
// —— issue #134 增量（O-3 新锁面机制 §3.3）：公共 Session 面与本文件结构性描述面逐字段
//    相等（含 close() 无参 `Promise<void>`——release 路径复用同一方法面；apply 六码联合
//    逐字相同是相等成立的前提——SA2 R1 HIGH-1 修法）。跨包真锁（Runtime internal 面 ≡
//    公共面）在 registry.ts（单消费者注入点，import 图审计纪律——本文件不 import internal）。——
type _sessionOpenCoreAlias = AssertTrue<Equal<ReplicationSessionOpenCore, ReplicationSession>>;

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
  readonly enableReplication: _enableReplicationResultAlias;
  readonly bumpReplicationEpoch: _bumpReplicationEpochResultAlias;
  readonly sessionOpenCore: _sessionOpenCoreAlias;
};

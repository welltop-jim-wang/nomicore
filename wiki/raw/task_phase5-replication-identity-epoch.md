# 任务简报 — Phase 5: enable replication identity and epoch management

- **Issue**: #132 (welltop-jim-wang/nomicore)
- **Task Type**: 功能开发 (feature)
- **Branch**: fix/issue-132-on-docs-phase-5-websocket-replication
- **Worktree**: /home/wangjian/nomicore-fix-issue-132
- **run_id**: issue-132-1787809226-3529662
- **round**: 1

## Parent

PR #130（docs/phase-5-websocket-replication）。

## What to build

Allow a Hub to explicitly enable replication for a namespace and manage its immutable replication lineage and monotonic epoch through the existing namespace write ordering and dirty-notification guarantees.

## Acceptance criteria

- [ ] AC-1: META reserves and projects replicationId and replicationEpoch with the formats frozen by ADR 0010.
- [ ] AC-2: enableReplication atomically installs a random 128-bit lineage ID and epoch 1 through the namespace write sequencer and dirty notification.
- [ ] AC-3: Re-enabling an enabled namespace is idempotent or returns a stable documented result without changing identity.
- [ ] AC-4: bumpReplicationEpoch is Hub-only, sequenced, monotonic, rejects overflow, and preserves committed/fatal facts.
- [ ] AC-5: Open and Runtime status can distinguish replication-disabled, enabled identity, and identity change without exposing mutable META references.
- [ ] AC-6: Tests cover concurrent enable/bump, persistence-degraded, close/fatal races, retry behavior, and Memory/File persistence recovery.

## 上游状态

阻塞 issue #131（generate namespaceId and migrate Registry identity）已 CLOSED + ci-passed，其合并提交 7425164 已在本分支 HEAD，直接在其上继续。#131 已交付：Registry entry key=namespaceId、注入式受控 128-bit CSPRNG（`RegistryRandomBytes`）、`ns-`+32hex 生成与重试纪律。

## 设计基准（相关文档）

- `docs/adr/0010-hub-peer-websocket-ydoc-replication.md`：「复制谱系与 epoch」节（META 两个保留字段格式：`replicationId` = 128-bit 随机值 32 位小写 hex；`replicationEpoch` = 从 1 开始的十进制安全整数；epoch 达 `Number.MAX_SAFE_INTEGER` 拒绝提升不回绕；enableReplication 显式原子写入 + 登记 dirty；连接不得静默补写旧文档；META.replicationId/replicationEpoch 只能由 hub 的显式复制管理操作修改）。
- `docs/phases/phase-5-websocket-replication.md` §实施切片 1：`META.replicationId`/`META.replicationEpoch` 投影、严格格式校验和保留字段定义；Hub 管理操作 `enableReplication()` 与 `bumpReplicationEpoch()`。
- ADR 0006：Persistence、DocHandle、saveDoc 仅为 dirty notification、degraded/retry。
- ADR 0008：单 NamespaceRuntime、唯一 write sequencer、lifecycle gate、committed/fatal 事实。
- ADR 0009：NamespaceRegistry、NamespaceLease、Runtime generation。
- `CONTEXT.md`：复制谱系（replication lineage）、复制代际（replication epoch）词汇（117-122 行）。
- `docs/protocols/instance-replication-v1.md`：wire 身份核对参考（本票不实现 WS 层）。

## 边界提示（非本票范围）

- 不实现 WS transport、ReplicationSession、bootstrap/reconcile、archive/resetReplica（后续切片）。
- 不新增 Persistence 跨 owner catalog；owner 分区语义不变。

## Blocked by

- #131（已 CLOSED，阻塞解除）。

## SA6 红灯锚定（Phase 1，2026-08-27）

**结论**：baseline 无任何复制管理面（Lease 无 enableReplication/bumpReplicationEpoch、
META 无复制保留字段、status 无 replication 域）。已产出 2 个验收测试文件，全部 18 条
红灯锚真实失败（14/14 运行时红 + 4/6 类型红；2 条保持性守卫绿）；`packages/
namespace-registry/test` 全目录既有 192 例用例保持全绿，无回归。明细、契约锚点与
AC→用例映射见 `wiki/raw/task_phase5-replication-identity-epoch_sa6_red.md`。

| 文件 | 类型 | 用例数 | 基线状态 |
|---|---|---|---|
| `packages/namespace-registry/test/registry-phase5-replication-red.test.ts` | 运行时行为（真实 Runtime/Yjs/Memory+File Persistence） | 14 | 14/14 红 |
| `packages/namespace-registry/test/registry-phase5-replication-surface.test-d.ts` | 类型面契约（`--typecheck` 段） | 6 | 4 红 + 2 绿 |

**核心契约锚点（SA1/SA3 落位基准）**：

1. `lease.enableReplication()` / `lease.bumpReplicationEpoch()`（ADR 0010 冻结名）→
   `Promise<Readonly<{ok: boolean}>>`；overflow 以结果面 `ok:false` 拒绝、绝不回绕；
   写管线 fatal 以 `RuntimeWriteFatalError` rejection（committed 事实诚实）。
2. status（`NamespaceRuntimeStatus` 与 registry 侧 `NamespaceLeaseStatus.active.runtime`
   投影同构）新增复制域 `replication: {state:'disabled'} | {state:'enabled';
   replicationId; replicationEpoch}`；getMetadata 投影 META 两字段（replicationId =
   `/^[0-9a-f]{32}$/`、replicationEpoch = 从 1 的安全整数，≠namespaceId、≠SCHEMA id）。
3. enable/bump 走唯一 write sequencer：通知（saveDoc）时刻 META 已含本槽提交
   （原子安装）；并发 [enable,bump,bump] 通知序恒 [1,2,3]；每槽恰一次 dirty。
4. Hub-only 独占写面：普通写（mutateRoot/replaceSchema）对复制字段 zero-touch；类型面
   无通用 META 写；Lease 不暴露 doc/handle/runtime 原始引用。
5. degraded/fatal/close 竞态与 Memory/File 恢复全链覆盖（AC-6）。

边缘提示：AC-3 允许幂等或稳定文档化结果（套件只锚不变式）；「identity change」判别
面 = 两读值比较（SA1 若加显式 `changed` 态需回流本记录）；随机源注入位置属 SA1
设计（套件不做消耗计数锚定）。

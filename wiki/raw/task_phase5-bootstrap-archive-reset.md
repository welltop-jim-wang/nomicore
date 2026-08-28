# 任务简报 — Phase 5: bootstrap import, archive, and guarded replica reset

- **Issue**: #133 (welltop-jim-wang/nomicore)
- **Task Type**: 功能开发 (feature)
- **Branch**: fix/issue-133-on-docs-phase-5-websocket-replication
- **Worktree**: /home/wangjian/nomicore-fix-issue-133
- **run_id**: issue-133-1787847735-3529662
- **round**: 1
- **slug**: phase5-bootstrap-archive-reset（全部流水线档案以 `wiki/raw/task_phase5-bootstrap-archive-reset_*` 命名）

## Parent

PR #130（docs/phase-5-websocket-replication）

## What to build（原文）

Provide the complete local lifecycle for installing an absent replica from a trusted Hub snapshot and safely resetting a conflicted Peer by closing its Runtime generation, archiving the old persisted document, and allowing a new bootstrap.

## Acceptance criteria（编号为 AC-1..AC-6）

- [ ] AC-1: A trusted internal bootstrap path preserves the Hub namespaceId, applies a full update to a detached Y.Doc, and verifies META replication identity before persistence ownership transfers.
- [ ] AC-2: Bootstrap creation is exclusive and never overwrites or silently merges an existing local document.
- [ ] AC-3: MemoryPersistence and FilePersistence implement behavior-equivalent archive semantics guarded by expected replication identity.
- [ ] AC-4: Registry resetReplica serializes close, archive, and bootstrap eligibility and rejects owner/identity races without partial deletion.
- [ ] AC-5: File archives use a controlled path and atomic rename; WS code never accesses snapshot files directly.
- [ ] AC-6: Tests cover duplicate bootstrap, crash/error committed facts, active handle rejection, identity mismatch, archive recovery, and independent owner partitions.

## Blocked by（均已解除）

- #131（CLOSED + ci-passed；合并提交 7425164 在本分支 HEAD）
- #132（CLOSED + ci-passed；合并提交 ebc5419 在本分支 HEAD）

## 上游状态

本分支 HEAD = ebc5419，已含：#131（Registry entry key=namespaceId、注入式受控 128-bit CSPRNG `RegistryRandomBytes`、`ns-`+32hex 生成与 8 次重试纪律）、#132（META 复制保留字段 replicationId/replicationEpoch、`readReplicationFacts` 事实读取单点、`enableReplication()`/`bumpReplicationEpoch()` 经唯一 write sequencer 的 Hub 管理写）、#135（`@nomicore/replication-protocol` 纯 codec 包，30cf1aa）。本票直接在其上继续。

## 设计基准（相关文档）

- `docs/adr/0010-hub-peer-websocket-ydoc-replication.md`：
  - §Namespace identity：「复制 bootstrap 使用内部受信任导入保留 Hub namespaceId，不是普通 create」；
  - §复制谱系与 epoch：「Peer 冲突恢复使用带 `expectedLocalIdentity` 的 `resetReplica()`：Registry 先关闭本地 Runtime generation，再通过 Persistence 归档旧副本，最后允许重新 bootstrap。Persistence 为此增加受身份前置条件保护的归档 seam；WS 层不得直接读写 snapshot 文件」；「peer 不得普通 create 一个准备从 hub 复制的同 key namespace；首次 bootstrap 继承 hub 的完整 META 身份」；
  - §Bootstrap 与重连 5 步：peer 在 detached Y.Doc 应用基线、严格核对 META 身份，再通过 Persistence 的受控复制导入能力排他创建；Registry 打开新 Runtime generation；竞态窗口由后续 reconciliation 补齐（本票只交付本地生命周期，reconciliation 属后续切片）；
  - §取代与关联：「它为 Persistence 增加复制导入与归档所需的受控能力；namespaceId 的概率全局唯一由生成策略负责，Persistence 不增加跨 owner catalog 或原子唯一约束」。
- `docs/phases/phase-5-websocket-replication.md`：
  - §实施切片 2（Persistence 复制导入与归档）：detached 已核对身份完整 Y.Doc 排他创建副本的受控 seam；`archiveDoc(owner, docId, expectedReplicationIdentity)` 仅在无有效 handle/Runtime generation 时执行；FilePersistence 同 rootDir 内受控 archive 路径 + 原子 rename；MemoryPersistence 行为等价可测试归档语义；duplicate、identity mismatch、operational failure 与 committed-aware fatal 使用稳定分类；不得由 WS 插件直接操作文件；
  - §实施切片 8（Reset）：Peer `resetReplica(owner, namespaceId, expectedLocalIdentity)` 编排 close→archive→允许 bootstrap；
  - §必须通过的场景 15b：replication identity conflict 与 `resetReplica` archive 流程（本票交付其本地部分）；
  - §测试 seam：「FilePersistence 做进程重启、归档和恢复验收」。
- ADR 0006：Persistence 单 rootDir owner、全量 snapshot、saveDoc 仅为 dirty notification、degraded/retry 语义（archive 不得破坏这些不变量）。
- ADR 0008：单 NamespaceRuntime、唯一 write sequencer、lifecycle gate、committed/fatal 事实诚实。
- ADR 0009：NamespaceRegistry、Lease、本地唯一 Runtime generation、Host shutdown；其 Registry identity 节已被 ADR 0010 修订（entry key=namespaceId；Registry 仍负责 reset/archive 编排）。
- `CONTEXT.md`：复制谱系（replication lineage）/复制代际（replication epoch）词汇（117-126 行）。

## 现有资产盘点（实现基线）

- `packages/persistence`：`DocPersistence`（createDoc/loadDoc/saveDoc）公共面（src/index.ts 受控导出）；`PersistenceLifecycle`（src/lifecycle.ts）= 每 key cell 协调器（reading/creating/live、claim 排他、committed-aware 错误分类）；错误家族 `DocDuplicateError`/`DocCreateOperationalError`/`DocCreateFatalError`（phase 词表 probe-read/snapshot-encode/store-write/post-commit + `DOC_CREATE_FATAL_PHASE_COMMITTED` 映射）/`DocLoadOperationalError`；`PersistenceIO` seam（read/write + AbortSignal 契约）；Memory/File 双 adapter（writeSnapshot/readSnapshot/wrapIo 注入面；File = mkdir→writeFile tmp→rename 原子提交，`SAFE_PATH_SEGMENT = /^[a-z][a-z0-9-]{0,62}$/` 路径守卫，users/<userId>/<docId>.snapshot 布局）；`seedForTest` 测试缝。
- `packages/namespace-registry`：`NamespaceRegistry`（open/create/getStatus/shutdown）；每 key LifecycleCarrier FIFO 串行槽；Entry generation 永不复用 + removeOnlySelf 双守卫；idle/active/closing 三相；identity.ts（validateOpenIdentity/validateOwnerIdentity 最小安全文法）；lease.ts（enableReplication/bumpReplicationEpoch 代理 + ReplicationIdDraw 注入）；testing.ts 受控注入面（runtimeFactory/observer/diagnostics/testEntries）；`NamespaceRegistryFatalError(operation, phase, committed, cause)`。
- `packages/namespace-runtime`：`readReplicationFacts(doc)` META 复制事实读取单点（disabled/enabled 两态 + ReplicationMetaCorruptError 损坏判据）；`REPLICATION_ID_PATTERN = /^[0-9a-f]{32}$/`（registry.ts 持有本地结构守卫副本，互为守卫）；Runtime close 语义（close.ts）。

## 边界提示（非本票范围）

- 不实现 WS transport、@nomicore/ws-replication、ReplicationSession、bootstrap/reconcile wire 流程、认证授权（切片 3–7）；
- 不实现 apps/yjs-server 部署装配（切片 9）；
- 不实现在线 epoch bump 的 IDENTITY_CHANGED fencing、degraded bypass 复制写（切片 4/6）；
- 不新增 Persistence 跨 owner catalog 或原子唯一约束；owner 分区语义不变；
- 本票交付的是**本地生命周期**：Persistence 受控导入 + 归档 seam、Registry 受信任 bootstrap 路径与 resetReplica 编排、稳定错误词汇与测试面。WS 层后续切片只能经这些 seam 间接操作（AC-5 后半句是对本票 seam 设计的约束：文件访问封闭在 Persistence 包内）。

## AC→组件映射预判（SA1 设计输入，非定论）

- AC-1/AC-2 → Persistence 新增受控复制导入 seam（detached、已核对身份的完整 Y.Doc 排他创建）+ Registry 内部受信任 bootstrap 路径（保留 Hub namespaceId；META 复制身份核对发生在 Persistence ownership 转移之前）；
- AC-3 → Memory/File 双 adapter 的 `archiveDoc(owner, docId, expectedReplicationIdentity)`（行为等价语义；身份前置条件守卫）；
- AC-4 → Registry `resetReplica(owner, namespaceId, expectedLocalIdentity)`：close→archive→bootstrap eligibility 串行化，owner/identity race 拒绝且零部分删除；
- AC-5 → File archive 受控路径 + 原子 rename；文件访问封闭在 Persistence 包内；
- AC-6 → 测试面：duplicate bootstrap / crash·error committed 事实 / active handle 拒绝 / identity mismatch / archive 恢复 / owner 分区独立。

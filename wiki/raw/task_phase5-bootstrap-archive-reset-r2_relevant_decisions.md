# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
>
> 被审任务：`task_phase5-bootstrap-archive-reset-r2.md`（issue #133，round=2）。本清单在 round-1 相关决议基础上复用，并补入本轮反馈直接触发的 ADR 修订体例约束。

## 相关 ADR

### ADR-0006 Cordis 持久化插件——DocPersistence 接口与 doc 三条目内容布局（accepted）

- 与本任务的关联点：`importDoc` / `archiveDoc` 的 Persistence 生命周期契约、所有权转移、快照与原子提交语义，本轮明确授权修订本 ADR。
- 核心条款（原文摘录）：
  - 「持久层 = Y.Doc 的存储引擎（store + cache 一体），看得见 Y.Doc（结构、update 事件、state vector），看不见 schema 语义（VFSL/校验规则属引擎领地）。」（§决策）
  - 「共享 doc，独立 handle：同一 `(user, docId)` 的所有成功 load 共享同一 live Y.Doc 实例……但每次 load 返回独立 DocHandle/lease；」（§决策）
  - 「saveDoc = 脏状态通知，不是同步落盘：持有有效 handle 的调用方在 Doc 每次发生变更后调用 saveDoc 通知持久层；saveDoc 返回仅表示脏状态已登记，不构成该次写入已落盘的承诺；」（§决策）
  - 「`META.docId` 必须等于请求的 namespaceId；不一致视为持久化损坏并响亮失败。」（§v1 磁盘布局与持久化格式）
  - 「持久层内部的 flush 在触发时以 `Y.encodeStateAsUpdate(doc)` 编码**完整 Y.Doc 状态**，写入 `{namespaceId}.snapshot.tmp` 后以原子 rename 覆盖 `{namespaceId}.snapshot`。」（§v1 磁盘布局与持久化格式）
  - 「创建成功前初始完整 snapshot 已提交（`Y.encodeStateAsUpdate(doc)` 直写；FilePersistence 以 temp→rename 完成为提交点；不新增 fsync 保证）；成功签发有效 lease 且 `handle.doc === doc`，持久层接管该 doc 生命周期（eviction/dispose 时销毁）；」（§createDoc 与 owner 语义修订）
  - 「持久层仍仅校验 `META.docId === docId`，不校验 VFSL/ROOT/createdAt；」（§createDoc 与 owner 语义修订）
  - 「本节为**增量演进**：扩展 DocHandle 接口形状（新增 `getStatus()`），并修订「save 失败按 doc 只读降级」条款中 degraded 拒绝面的归属。除下列明示条款外，未提及的条款……维持原文效力。」（§DocHandle entry status 与 saveDoc 职责修订）
  - 「本说明只对齐 Registry 身份演进，**不修改本 ADR 任何 Persistence 契约条款**。」（§对齐说明：issue #131）

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted）

- 与本任务的关联点：reset 前 Runtime/lease 生命周期、复制事实的构造期窄读取例外、identity 的 live/persisted 真相边界。
- 核心条款（原文摘录）：
  - 「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer；不同 namespace 可并行。」（§单一 write sequencer）
  - 「`close()` 幂等。首次调用同步进入 `closing`，立即停止接纳公共 read 和 write，并在队尾加入 close barrier；此前已接纳任务无条件排空，不取消、不设内部 timeout。」（§生命周期、状态与所有权）
  - 「仅允许 Runtime 在构造、**对外发布前**同步读取 `META.replicationId` 和 `META.replicationEpoch` 两个保留字段，仅为生成 status 的复制持久事实（lineage identity/epoch）投影；不读取其他 META 键。」（issue #132 修订，第 1 条）
  - 「唯一允许的判定是双键均真缺席 → `{state:'disabled'}`，或双键均存在且均合规 → `{state:'enabled'; replicationId; replicationEpoch}`；恰一键存在、键存在而值为显式 `undefined`、格式不合法……、META 载体异型均为**持久化损坏**，Runtime 构造同步拒绝……」（issue #132 修订，第 2 条）
  - 「`enableReplication()` / `bumpReplicationEpoch()` 的成功仍只表示 live commit + dirty notification 已登记，**不等于已落盘**……」（issue #132 修订，第 6 条）
  - 「复制字段格式、不可变性、epoch 上限与 hub-only 管理权以 ADR 0010 为权威；ADR 0008 仅规定 Runtime 的 sequencer 槽序、status 投影、构造期窄例外与失败通道。」（issue #132 修订，第 7 条）

### ADR-0009 NamespaceRegistry、调用方租约与 Cordis Host 生命周期（accepted；identity 旧条款由 ADR-0010 修订）

- 与本任务的关联点：Registry 对 Runtime generation/lease 的编排，identity/owner 防泄露规则，以及 reset 后 generation 的安全清理。
- 核心条款（原文摘录）：
  - 「同 key 的 open、create 和 Runtime generation close 按同步接纳顺序串行。每个操作取得 lifecycle 槽后，根据当时的 Registry/Persistence 事实独立结算；前项的领域失败或 branded rejection 不成为后项结果，也不毒化 queue tail。旧异步操作只能按 entry identity/generation 清理自己，不得删除后来建立的新 entry。」（§唯一 Runtime 与同键生命周期串行）
  - 「首次 `release()` 在调用栈内同步将 lease 标记为 released，之后不再接纳新操作。」（§NamespaceLease）
  - 「idle 期间 open 同步取消 timer、转回 active 并签发 lease。若 timer callback 先同步将 entry 转为 closing，则该转换不可逆；后续 open 等待同一个 close Promise 结算，再 load 并建立新 generation。」（§空闲保留）
  - 「Registry不承担authorization、REST/WS、raw Yjs sync、META后续写或分布式协调。」（§后果）
  - 「namespace identity、owner、普通 create 的 ID 生成与碰撞处理均以 ADR 0010 的 namespaceId-only identity 与普通 create 规则取代。owner 仍是 create/open 的必需本地属性与 Persistence 分区键；复用既有 entry 前必须核对 owner，不匹配返回 `NAMESPACE_NOT_FOUND`。」（issue #131 修订，第 1 条）

### ADR-0010 Hub/Peer WebSocket Y.Doc 复制与最终一致（accepted）

- 与本任务的关联点：本轮 feedback 1/2 所修订的 reset/import 身份前置条件和操作顺序，以及 feedback 3 要求修订本 ADR。
- 核心条款（原文摘录）：
  - 「`replicationId` 是 namespace 不可变的复制谱系身份；它不同于 namespaceId 和 SCHEMA 信封 `id`。」（§复制谱系与 epoch）
  - 「`replicationEpoch` 是 hub 显式提升的权威代际；达到 `Number.MAX_SAFE_INTEGER` 后拒绝继续提升，不回绕。」（§复制谱系与 epoch）
  - 「身份与 epoch 相同才允许双向 state-vector reconciliation；缺失或不同进入稳定 `conflicted` 状态，绝不自动覆盖或合并。」（§复制谱系与 epoch）
  - 「Hub 丢失只能从 hub 自身备份恢复，不自动选择 peer 回灌。Peer 冲突恢复使用带 `expectedLocalIdentity` 的 `resetReplica()`：Registry 先关闭本地 Runtime generation，再通过 Persistence 归档旧副本，最后允许重新 bootstrap。Persistence 为此增加受身份前置条件保护的归档 seam；WS 层不得直接读写 snapshot 文件。」（§复制谱系与 epoch）
  - 「peer 在 detached Y.Doc 应用基线、严格核对 META 身份，再通过 Persistence 的受控复制导入能力排他创建；」（§Bootstrap 与重连）
  - 「Registry 打开新 Runtime generation；」（§Bootstrap 与重连）
  - 「本 ADR 扩展 ADR 0006 的异机冗余预留，但不改变`saveDoc`仅为dirty notification、全量snapshot、owner目录分区或单rootDir owner语义。它为Persistence增加复制导入与归档所需的受控能力；」（§取代与关联）
  - 「Registry仍负责本地Runtime generation、Lease、reset/archive编排和Host生命周期。」（§取代与关联）

## ADR 修订体例约束（feedback 3）

- ADR-0006 的既有修订体例（原文摘录）：
  - 「本节修订上方两处早期决策条款，取代关系如下；未提及的条款维持原文效力。」（§createDoc 与 owner 语义修订）
  - 「本节为**增量演进**……除下列明示条款外，未提及的条款……维持原文效力。」（§DocHandle entry status 与 saveDoc 职责修订）
- ADR-0010 当前是 Phase 5 复制规范的权威记录；修订必须将与 feedback 1/2 冲突的旧次序用明确的「取代/修订范围」文字收口，保留未触及条款，不把 `wiki/raw/*` 当作规范来源。

## CONTEXT.md 相关术语与惯例

- `namespaceId`：「Registry entry 与实例复制 wire 的唯一 namespace 身份……Registry 在当前进程内只以 namespaceId 排他索引。Persistence 仍用 owner.userId 分区，owner 是 open/create 的本地重要属性但不上 wire，也不参与复制身份；不同实例可为同一 namespaceId 使用不同 owner。」
- `复制谱系（replication lineage）`：「由 `META.replicationId` 标识的 namespace 复制身份；只有 namespaceId、replicationId 与 replication epoch 全部匹配的副本才允许直接执行 Yjs state-vector reconciliation。」
- `复制代际（replication epoch）`：「`META.replicationEpoch` 中从 1 开始、只由 Hub 显式提升的安全整数；相同复制谱系但 epoch 不同的副本进入冲突状态，必须显式 reset/bootstrap，不自动覆盖或合并。」
- `ReplicationSession`：「由 NamespaceLease 打开的受信任 duplex raw Yjs 复制会话；冻结本地角色、远端实例、复制谱系与 epoch……不暴露 live Y.Doc。」
- `零写入（zero-write）`：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」

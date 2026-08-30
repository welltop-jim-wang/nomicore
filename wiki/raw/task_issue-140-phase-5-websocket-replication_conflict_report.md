# 冲突门禁报告

- 被审对象：任务简报 `wiki/raw/task_issue-140-phase-5-websocket-replication.md`（Issue #140 — Phase 5 收口；任务类型：功能开发；阶段：前置门禁）
- 冲突基准：`docs/adr/0001`–`0010` 全集（10 篇，逐篇全量读取，禁止抽样）+ `CONTEXT.md`
- 审查日期：2026-08-30（SA8 前置门禁，Round 1）
- 配套产出：`wiki/raw/task_issue-140-phase-5-websocket-replication_relevant_decisions.md`（全链 SA 复用约束清单）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（2026-08-19 修订节生效） | 低 | 无冲突。测试 fixture 使用 VFSL 文本属明文豁免（「测试 fixture 除外」）；任务不触及 schema 文本入仓/SchemaSource 纪律 |
| ADR 0002 | nomicore 是全新重写，authority 出范围 | accepted | 低 | 无冲突。任务不含 authority 规则；AC 词汇（Hub/Peer/epoch/reset）均在复制域 |
| ADR 0003 | 求值器与派生 schema | accepted | 低 | 无冲突。AC1「Concurrent ROOT writes」的对象与 ROOT=Y.Map/getMap('ROOT') 约定一致 |
| ADR 0004 | vfsl-protocol 类型投影 | accepted | 低 | 无冲突。AC8「aggregate no-emit compilation / typecheck」与 D3/D4 纪律同向 |
| ADR 0005 | 投影生成管线 | accepted | 低 | 无冲突。AC8「diff checks」即本 ADR 的 CI regen-diff 义务，任务只验收不改动投影面 |
| ADR 0006 | 持久化 DocPersistence 与三条目布局 | accepted（+#64/#79/#131 对齐/#133 round-2 修订） | 高 | 无冲突。AC4 degraded/retry、AC6 restart/archive/crash recovery 逐条对应 #79 修订（dirty notification、拒绝面归业务编排层）与 #133 round-2（importDoc 排他、archiveDoc 身份守卫、committed 边界、只读 probe、.tmp 纪律）；AC6「independent roots」正是 ADR 0010「每台机器必须使用独立 Persistence/rootDir」的测试落实 |
| ADR 0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（Runtime/open/read 条款由 ADR 0008 部分取代） | 中 | 无冲突。被取代条款不构成约束；active 条款（validated mutation、零写入、observer no-rollback）约束 AC1 的普通业务写——raw 复制写的例外由 ADR 0010 明文声明，任务未越出该声明 |
| ADR 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（+#93/#132/#134 增补） | 高 | 无冲突。AC3 epoch fencing（bump 槽 E5.5 fence）、guarded reset（reset-fence 槽）、AC1 全部写经唯一 sequencer、AC4 degraded 写前 gate（getStatus + `RUNTIME_WRITE_DISABLED` 码族）均有明文条款支撑 |
| ADR 0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（+#131/#134 修订节） | 高 | 无冲突。identity 已迁 namespaceId-only；Lease 第十四成员 openReplicationSession 及 released 通道、shutdown 语义与 AC5 ordered shutdown 的 Registry 段一致 |
| ADR 0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（+#134/#133 round-2/#161/#172 修订节）——本任务核心权威 | 极高 | 无冲突。八条 AC 全部逐条落在本 ADR 正文与修订节的明文条款内（详见下节对照） |
| CONTEXT.md | 术语与硬性惯例 | 现行 | 高 | 无冲突。任务简报用词（Hub/Peer、lineage/epoch、fencing、guarded reset、graceful drain、converge）与冻结词条一致；未使用任何 _Avoid_ 词汇（master/slave/leader/follower/自动回滚等） |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| （无） | — | — | — | — | 未发现任何直接违反、明文推翻或未声明演进 |

## AC 逐条对照（佐证 verdict）

| 任务 AC | 对应权威条款（可回查） | 结论 |
|---|---|---|
| AC1 并发 ROOT 写收敛 | ADR 0010「hub 与 peer 都……接受本地 ROOT 业务写」「复制提供最终一致」「恢复连接后通过 Yjs state vector/diff 合并」；one-Hub/two-Peer 合于静态星型拓扑；equivalent state 合于 CRDT 最终一致（非目标清单只排除强一致/quorum，不排除收敛断言） | no-conflict |
| AC2 断线重连对账 / 缺席 bootstrap / 竞态修复 | ADR 0010「Bootstrap 与重连」五步（第 5 步即「补齐编码基线与安装之间的竞态窗口」）；恢复纪律「连接断开即close sessions/release Leases，不保留outbox；重连重新OPEN并reconcile」 | no-conflict |
| AC3 lineage/epoch 冲突、受保护字段、SCHEMA 传播、fencing、guarded reset、归档 | ADR 0010「复制谱系与 epoch」「SCHEMA 与 META 权限」「Trusted raw update」+ #134 修订（受保护字段冻结集合、判据、bump fence）+ #133 round-2（resetReplica 严格前置核对、importReplica 绑定 Hub 广告身份、归档 committed 诚实）+ ADR 0006 #133 round-2（archiveDoc） | no-conflict |
| AC4 Hub degraded 拒绝 / Peer degraded 内存跟随 / retry / 旧快照重启 / Hub diff 补齐（双 Adapter） | ADR 0010「Persistence degraded 语义」Hub/Peer 矩阵逐句对应；degraded 拒绝面归属与 retry 依据 ADR 0006 #79 修订；Memory/File 双 Adapter 即 ADR 0006「两个真实 Adapter」 | no-conflict |
| AC5 背压、frame/update/channel 上限、丢 ACK、坏帧、auth/authz/撤销、无秘密日志、优雅 drain | ADR 0010「WebSocket 复制协议与状态机」（sequence 纪律、唯一 wire contract 指向 protocol v1）、「认证、授权和传输安全」（token/instanceId/撤销/日志禁项/TLS 边界）、「资源限制」（单 channel vs 连接级关闭）、「包、应用与生命周期」（GOAWAY drain 与停机次序）+ #161 修订（背压终态口径等） | no-conflict |
| AC6 FilePersistence 独立 root、进程重启、archive/reset、崩溃恢复 | ADR 0010「每台机器必须使用独立 Persistence/rootDir；共享文件目录多写仍不受支持」+ ADR 0006 全量快照 temp→rename、`.tmp` 启动清理、单进程无文件锁 | no-conflict |
| AC7 公共导出、稳定错误、包文档、ADR 0010、protocol v1、Phase 5、CONTEXT、应用配置、第三方托管指引一致 | 对齐性工作，与 #172 修订一致（wire 冻结值不变、`maxQueuedControlBytes` 收敛、`wiki/raw` 非规范、交付边界只在 phase-5 文档维护）；ADR 0010「第三方 Host 可直接基于公开 NamespaceLease/ReplicationSession 构造自己的可信 transport」支撑托管指引 | no-conflict（附注意事项见下） |
| AC8 typecheck / 全量测试 / no-emit 编译 / diff 检查 / Node 矩阵 / 终审 | 与 ADR 0004/0005 的 CI 纪律同向，无任何条款被触碰 | no-conflict |

## 结论

**verdict = clear，冲突点 0，裁决分布：no-conflict × 全部对照项**（override-declared 0 / evolution 0 / hard-violation 0）。前置门禁放行，SA 派发可继续。

被审任务简报本质是 Phase 5 已接受契约（ADR 0010 及其修订节、ADR 0006/0008/0009 对应修订、CONTEXT 词条）的**验收与对齐**任务，未提出任何推翻、绕行或未声明演进的决策。

### 非阻塞注意事项（供 SA1/SA2/SA3 执行时遵守，不构成门禁拦截）

1. **ADR 0010 的任何更新必须走 append-only 修订节纪律**（沿 #134/#161/#172 先例），不得改写正文冻结条款；wire 冻结值不得变更（#172 修订第 1 条）。
2. **规范指向纪律**：源码与规范中的公共行为表述必须指向 `CONTEXT.md`、ADR 或 `docs/protocols/`；`wiki/raw/` 仅为历史证据（#172 修订第 2 条）。
3. **交付边界**：切片状态与后续依赖只写在 `docs/phases/phase-5-websocket-replication.md`「交付现状与边界」节，ADR 不复制交付清单（#172 修订第 3 条）。
4. **受保护字段判据与「删后同值重写」议题**（#134 修订 O-12）已被明文冻结为不可重开：「后续审查者不得重开此议题视为缺陷」——SA2 评审不得据此报缺陷。
5. AC4「stale-snapshot restart」在 MemoryPersistence 侧需以受控方式模拟（内存 Adapter 无物理快照）；这是测试设计问题，不触碰任何 ADR 条款。

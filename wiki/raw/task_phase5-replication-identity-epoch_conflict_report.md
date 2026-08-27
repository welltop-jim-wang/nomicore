# 冲突门禁报告

- 被审对象：任务简报 `wiki/raw/task_phase5-replication-identity-epoch.md`（Phase 0 前置门禁；issue #132，功能开发）
- 冲突基准：`docs/adr/` 全集 10 份（逐个全读，无抽样）+ 根 `CONTEXT.md`
- 门禁产出时间：2026-08-27（run_id: issue-132-1787809226-3529662，round 1）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（2026-08-19 修订；2026-08-21 命名修订） | 间接（顶层具名条目/信封命名背景） | 无冲突：任务不动 schema 文本、方言与 codegen 面 |
| 0002 | nomicore 是全新重写、authority 出范围 | accepted | 无关 | 无冲突 |
| 0003 | 求值器与派生 schema | accepted | 无关（ROOT/求值契约） | 无冲突 |
| 0004 | vfsl-protocol 类型投影 | accepted | 无关 | 无冲突 |
| 0005 | 投影生成管线 | accepted | 无关 | 无冲突 |
| 0006 | Cordis 持久化插件与 doc 三条目布局 | accepted（含 #64/#79 修订节、#131 对齐说明） | 高（dirty notification、degraded 拒绝面归属、META 布局与持久层校验边界、owner 分区） | 无冲突（注记 2）：META 新增两个保留字段由 ADR 0010 明文扩展；持久层契约不变，任务边界亦声明「不新增 Persistence 跨 owner catalog；owner 分区语义不变」，与 #131 对齐说明一致 |
| 0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（Runtime/open/read 条款由 ADR 0008 部分取代） | 中（写串行化、META/SCHEMA 在校验面之外） | 无冲突：仍有效条款（业务写串行化 + 写后标脏 + 不得旁路）与任务一致；被取代条款不构成约束 |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 2026-08-24 稳定码注册修订） | 高（唯一 sequencer、写槽次序、META 投影、fatal/停接纳、稳定码族） | 无冲突（注记 1）：复制管理专用写经 ADR 0010 明文授权新增，且任务要求其走 write sequencer 与 dirty notification，正是本 ADR 安全不变量的落实 |
| 0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（含 issue #131 修订节） | 高（唯一 Runtime/sequencer 不变量、open 语义、Lease 代理边界、CSPRNG 注入纪律） | 无冲突：AC-5 的 Open/状态观测与「open 不等待 P0、不验证 ROOT」「fatal/degraded 只改变 capability」相容；replicationId 随机生成可沿用 #131 交付的注入式 CSPRNG 纪律 |
| 0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（2026-08-27） | 核心（复制谱系与 epoch、SCHEMA/META 权限、取代关系） | 无冲突：任务 6 条 AC 与本 ADR「复制谱系与 epoch」「SCHEMA 与 META 权限」条款逐条对应，边界提示与后续切片划分一致 |

无任何 ADR 处于被 superseded 状态（0007 的被取代范围、0006/0009 的被修订条款均由各自 ADR 内部修订节显式记载，均不构成对任务的约束冲突）。

## 冲突点

未发现 hard-violation、override-declared 或 evolution 级冲突。以下 4 条为对照中最接近冲突的注记，逐条给出裁决与依据（全部为 no-conflict，不影响 Verdict）：

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | 注记（潜在条款张力，已消解） | ADR 0008：「v1 不提供 META 写」；「v1 公开两个窄方法：`mutateRoot` / `replaceSchema`」 | AC-2/AC-4：新增 `enableReplication()` / `bumpReplicationEpoch()` 两个对 META 的受控写操作 | no-conflict | ADR 0010（更晚接受，Phase 5 权威）已明文决定「hub 对现有 namespace 通过显式 `enableReplication()` 原子写入复制身份并登记 dirty」「`META.replicationId` 与 `META.replicationEpoch` 只能由 hub 的显式复制管理操作修改」——即专用窄操作而非通用 META 写 API。ADR 0008 条款约束的是通用 META 写面；两专用操作仍进入唯一 write sequencer，满足 ADR 0008 安全不变量。ADR 集内部已自洽，任务不构成对 0008 的违反，亦无需声明 override |
| 2 | 注记（潜在条款张力，已消解） | ADR 0006 doc 三条目布局：「META 元信息（Y.Map：docId, createdAt）」 | AC-1：META 增加并投影 `replicationId` / `replicationEpoch` 两个保留字段 | no-conflict | ADR 0010 明文「`META` 增加两个复制层保留字段」，其「取代与关联」节声明对 0006「扩展……异机冗余预留」且不改变 saveDoc/快照/owner 分区契约；ADR 0006 的 #131 对齐说明亦声明不修改 Persistence 契约条款。持久层仍仅校验 `META.docId`，字段值为 plain string / number，符合 ADR 0008「值只允许 JSON-compatible plain value」 |
| 3 | 注记（简报对 ADR 的收紧，非冲突） | ADR 0010：「`replicationId` 是 namespace 不可变的复制谱系身份」（未明文规定重复 enable 的返回形状） | AC-3：重复 enable 幂等或返回稳定文档化结果，且不改变身份 | no-conflict | AC-3 是对不可变条款的遵守性细化（「不改变 identity」直接落实不可变性），允许实现自由度，不与任何条款相抵触 |
| 4 | 注记（边界澄清，供 SA1 参考） | ADR 0010：「网络状态保留在 ReplicationSession/复制插件，不塞入 Runtime 的业务 capability status。」 | AC-5：Open 与 Runtime status 能区分 replication-disabled / enabled identity / identity change | no-conflict | AC-5 观测的是 META 中持久的身份/代际事实（数据投影 + status 摘要），非网络/传输状态；ADR 0010 禁入 Runtime status 的是连接类网络状态。ReplicationSession 冻结身份、conflicted 状态判定均属后续切片，本票不提前实现其能力面即无冲突 |

## 结论

**Verdict: clear —— 放行，总控可继续派发 SA1 设计。**

- 冲突点统计：4 条对照注记，裁决分布 = no-conflict × 4；hard-violation 0、override-declared 0、evolution 0。
- 无需任何 override 声明，无需上报 Jim 裁决的演进条目。
- 两条条款张力（注记 1/2）均已在 ADR 集内部由 ADR 0010 的明文决策消解：ADR 0008 的「v1 不提供 META 写」按「无通用 META 写 API」解读，专用复制管理写为其明文授权的扩展；本任务必须继续遵守 ADR 0008 全部写纪律（唯一 sequencer、槽序、degraded/fatal/停接纳、`RUNTIME_WRITE_DISABLED` 码族、committed 事实、不自动重试非幂等写）。
- 全链约束清单见同目录 `task_phase5-replication-identity-epoch_relevant_decisions.md`（SA1 设计 / SA2 评审 / SA3 实现复用）。
- 设计后复审（SA1 产出后）将按技能要求复审设计与 ADR 一致性，并追加设计引入的新决策点到相关决议文档。

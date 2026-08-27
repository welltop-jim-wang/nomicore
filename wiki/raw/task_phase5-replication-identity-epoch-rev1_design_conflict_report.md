# 冲突门禁报告

## Verdict

`clear`

**clear with recorded implementation conditions**：设计中的 ADR 0008 窄演进已获 issue owner Jim 的正式授权。已核验 issue #132 中 `welltop-jim-wang`（OWNER）于 2026-08-27T14:33:17Z 的 PR #145 review：反馈 1 明示二选一路径，其中第一条为「若构造期校验是预期设计：显式修订/增补 ADR 0008，说明复制保留字段是普通 open 规则的例外，并记录损坏时拒绝构造的语义」。设计 §2 选择并完整限定该第一条路径。因此原报告记录的 ADR 0008 演进不是未授权冲突，不需要额外 Jim 裁决；SA3 须满足本报告「落地条件」后方可完成该 ADR 增补。除该已授权演进外，四个复制管理写、`status.replication` 与 Phase 5 文档扩充均未与仍有效 ADR/CONTEXT 条款冲突。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR 0001 | VFSL 文本单一真相源 | accepted | 否（仅 SCHEMA 背景） | 无冲突 |
| ADR 0002 | 重写与 authority 出范围 | accepted | 否 | 无冲突 |
| ADR 0003 | 求值器与派生 schema | accepted | 否 | 无冲突 |
| ADR 0004 | VFSL 协议类型投影 | accepted | 否 | 无冲突 |
| ADR 0005 | 投影生成管线 | accepted | 否 | 无冲突 |
| ADR 0006 | Persistence 与 doc 布局 | accepted（含有效修订） | 是 | 无冲突：设计保留 `saveDoc` 仅为 dirty notification、全量快照、META/ROOT 边界与 owner 分区。 |
| ADR 0007 | logical validation 与 Runtime bridge | accepted；open/read 部分已由 ADR 0008 取代 | 是 | 无冲突：设计不恢复被取代的 schema/ROOT/logical validation。 |
| ADR 0008 | Runtime 能力与 sequencer | accepted（含稳定码注册修订） | 是 | 构造期 META 复制事实读取/损坏拒绝是对第 14 行普通 open 排除面的窄演进；该演进已由 issue #132 owner review（2026-08-27）明示授权，设计选择获准路径。其余拟增补项与 sequencer/status/稳定码条款一致。 |
| ADR 0009 | Registry、Lease 与 Host 生命周期 | accepted（issue #131 修订有效） | 是 | 无冲突：open 仍在 Runtime 构造完成后成功；构造期损坏可通过既有 `runtime-construction` fatal 通道表达。 |
| ADR 0010 | Hub/Peer Y.Doc 复制 | accepted | 是 | 无冲突：ADR 已明确授权 Hub 的 `enableReplication()` / `bumpReplicationEpoch()`、META 两保留字段、epoch 上限与 hub-only 权限；设计未将网络状态放入 Runtime status。 |
| CONTEXT.md | 术语与硬性惯例 | 有效 | 是 | 无冲突：维持两态持久事实投影、FIFO、普通 open 不重复 schema/ROOT 校验、ReplicationSession 网络状态边界及 epoch 不回绕。 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | evolution（已授权，非阻塞） | ADR 0008「读取能力」：普通 open「不执行 schema、ROOT 载体或 logical validation，持久化文件被其他程序错误修改不在本契约范围内」；ADR 0007 被取代范围亦列出「META 检查」随旧 open 编排被取代。 | 设计 §2.1、§2.3、§6 保留构造期 `readReplicationFacts(doc)`，要求 Runtime 发布前读取 `META.replicationId` / `META.replicationEpoch`，并在部分存在、undefined、格式违约或 META 载体异型时拒绝构造；拟向 ADR 0008 增加该窄例外。 | `override-declared` | **保留原 evolution 分析作为记录**：该动作实质修改 ADR 0008 的普通 open 契约，若无授权本应上报 Jim。但已核验 issue #132 的 owner review（welltop-jim-wang，2026-08-27T14:33:17Z，PR #145 feedback 1）明示允许「显式修订/增补 ADR 0008」并记录复制保留字段例外及构造拒绝语义；设计 §2 选择该第一条合规路径。该 issue-owner 授权链（review feedback → 设计 §2 → ADR 增补）构成本轮明确 override/evolution 批准，放行但受下述落地条件约束。 |

## 无冲突的重点核验

1. **四个窄写方法与唯一 sequencer**：ADR 0008 原称 v1 公开两个窄方法，但 ADR 0010 已在「复制谱系与 epoch」「SCHEMA 与 META 权限」中明确要求 Hub 提供 `enableReplication()`、`bumpReplicationEpoch()`，且限定两个保留字段只能由该显式管理操作修改。设计 §2.3 第 3 项将原句限定为「基础 v1 两个 + ADR 0010 授权的复制管理例外两个」，并要求四者共用 FIFO 与完整写槽；与 ADR 0008 第 36–47 行、ADR 0010 第 50–53、120–121 行一致，不构成冲突。
2. **`status.replication`**：ADR 0008 的 status 负面约束仅禁止队列长度、任务类型、sequence 及原始 Error/stack/SCHEMA 全文/ROOT 数据；ADR 0010 仅禁止将网络状态置入 Runtime capability status。设计限定 `replication` 为 `{state:'disabled'}` 或含 identity/epoch 的 enabled 持久事实，排除 session、网络、队列与 sync 状态，符合两份 ADR 和 CONTEXT.md。
3. **稳定码注册修订一致性**：设计没有另造关闭/停接纳码域；fatal、handle non-ready、notifier 缺失、close 的零写入拒绝仍复用 ADR 0008 稳定码修订规定的 `RUNTIME_WRITE_DISABLED` 码族，以 message 区分域。epoch 上限被设计归为预期且零写入的结果联合，符合 ADR 0010「拒绝继续提升、不回绕」与 ADR 0008「普通、可预期且零写入失败使用领域化结果联合」。
4. **持久化与恢复扩充**：设计 §3 / §4 仍以 ADR 0006 和 ADR 0010 的 dirty-not-durable、全量 snapshot、committed 事实不回滚为边界；测试要求 durable wait 后再 restart，且不将 notify failure 误称为 durability，未改变 Persistence 契约。
5. **Phase 5 文档扩充**：Phase 文档不是 ADR/CONTEXT 约束来源；设计所述扩充复述 ADR 0006/0008/0010 已有语义，没有新增与其相抵触的设计决策。

## 结论

- **放行结论**：`clear`。原 evolution 已由 issue #132 owner review 正式授权，无需再次请求 Jim 裁决。已核验命令与结果：`gh issue view 132 --repo welltop-jim-wang/nomicore --json comments` 返回 `welltop-jim-wang`（OWNER）于 `2026-08-27T14:33:17Z` 的 review，其中反馈 1 明示「若构造期校验是预期设计：显式修订/增补 ADR 0008，说明复制保留字段是普通 open 规则的例外，并记录损坏时拒绝构造的语义」。
- **落地条件（SA3 必须满足）**：ADR 0008 的 issue #132 增补节必须明文注明本修订由 issue #132、PR #145 review feedback 1（welltop-jim-wang，2026-08-27）授权，并明确该授权选择的是构造期复制事实窄例外路径。
- **落地条件（契约边界）**：增补必须保留 ADR 0008 第 14 行对 schema、ROOT 载体与 logical validation 的排除；明确 ADR 0010 是字段格式、不可变性、epoch 上限与 Hub 权限的权威；不得把网络/session 状态加入 `status.replication`；不得改变 ADR 0006 的 dirty-not-durable 语义。
- **保留记录**：若上述授权注记或任一契约边界未在 ADR 落地中满足，则本报告的 clear 不再适用，原 evolution 分析应重新作为门禁依据。

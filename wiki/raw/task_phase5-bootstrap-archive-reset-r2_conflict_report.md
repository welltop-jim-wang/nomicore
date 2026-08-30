# 冲突门禁报告

## Verdict

`clear`

- 被审对象：`wiki/raw/task_phase5-bootstrap-archive-reset-r2.md`（issue #133，功能开发修订轮 round=2）
- 冲突基准：`docs/adr/` 全集 10 份（逐个完整读取）+ `CONTEXT.md`
- 判定说明：ADR-0007 的 Runtime/open/read 被 ADR-0008 明确取代部分不作为约束；本轮无其他 superseded ADR。代码、phase 文档和 round-1 档案仅作为背景/基线证据，不作为自动阻断依据。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 单一真相源 | accepted | 否 | no-conflict：不涉及 schema 文本、方言或投影。 |
| ADR-0002 | 重写定位、authority 出范围 | accepted | 否 | no-conflict：无 authority 规则或旧系统兼容要求。 |
| ADR-0003 | 求值器与派生 schema | accepted | 否 | no-conflict：不改变 evaluate/ROOT/派生 schema。 |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | no-conflict：无类型投影语义变更。 |
| ADR-0005 | 投影生成管线 | accepted | 否 | no-conflict：无 SchemaSource/生成管线变更。 |
| ADR-0006 | Server Persistence docstore | accepted | 是 | evolution（已获 owner 明示修订授权）：反馈 3 要求修订其 Persistence 生命周期规范；反馈 1/2 的行为不违反其剩余有效条款。 |
| ADR-0007 | 逻辑校验与 Yjs runtime bridge | accepted，Runtime/open/read 部分由 0008 取代 | 间接 | no-conflict：任务不改有效的 logical validation、detached materialization 或普通 mutation 零写入规则。 |
| ADR-0008 | NamespaceRuntime 读写能力与 sequencer | accepted | 是 | no-conflict：反馈 1 要求在破坏性 close 前预检身份，未改变单 sequencer、close 排空或复制事实两态/dirty-not-durable 事实。 |
| ADR-0009 | NamespaceRegistry、Lease 与 Host 生命周期 | accepted，identity 旧条款由 0010 修订 | 是 | no-conflict：任务保持 Registry 编排、owner 防泄露、generation 清理与 lease 生命周期边界。 |
| ADR-0010 | Hub/Peer WebSocket Y.Doc 复制 | accepted | 是（核心） | evolution（已获 owner 明示修订授权）：反馈 1/2 改正其现有 reset/import 次序描述，须在本 ADR 显式修订并收口。 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | 无 | ADR-0008 issue #132：「`enableReplication()` / `bumpReplicationEpoch()` 的成功仍只表示 live commit + dirty notification 已登记，**不等于已落盘**」；构造期复制事实仅为对外发布前的窄读取例外。 | 反馈 1 / R2-AC-1、R2-AC-2：reset 在 forceRelease/close/archive 前核对 live（Runtime/META 当前值）与 persisted identity 对 `expectedLocalIdentity`；dirty identity/epoch 尚未 flush 时不可关闭或归档错误 generation。 | no-conflict | 要求承认且处理 live 与 persisted 可暂时不一致，正与 dirty-not-durable 条款一致；其目标是把正确真相源的身份核对提前到 destructive 动作之前，未声称 dirty 即 durable，也未扩张 Runtime 的通用 META 读取面。 |
| 2 | 无 | ADR-0010：「Registry 先关闭本地 Runtime generation，再通过 Persistence 归档旧副本，最后允许重新 bootstrap。」 | 反馈 1 / R2-AC-1：先可靠核对身份；不匹配时不得破坏当前 generation/lease/runtime。 | evolution | 对 reset 的操作次序存在实质演进：新增的非破坏性 preflight 必须位于旧文句所列 close 前。反馈 3 已由 owner 明文授权修订 ADR-0010，且简报第 52 行明确授权将冲突次序一并解决；不构成 hard-violation。修订后应冻结为「身份核对成功 → close → archive → bootstrap eligibility」，并明确 preflight 失败零破坏。 |
| 3 | 无 | ADR-0010：「peer 在 detached Y.Doc 应用基线、严格核对 META 身份，再通过 Persistence 的受控复制导入能力排他创建；」 | 反馈 2 / R2-AC-3、R2-AC-4：import 接收或可靠绑定 Hub 广告 expected `{replicationId, replicationEpoch}`，在 ownership 转移前校验 META 复制事实与广告完全一致。 | evolution | 既有「严格核对 META 身份」未明确外部 Hub 广告身份绑定。新要求是对同一核对契约的具体化/强化，不违反 detached→核对→受控排他创建的既有顺序；反馈 3 已授权将其写入 ADR-0010，并在 ADR-0006 记录 Persistence 生命周期契约。 |
| 4 | 无 | ADR-0006：「成功签发有效 lease 且 `handle.doc === doc`，持久层接管该 doc 生命周期」；「持久层仍仅校验 `META.docId === docId`，不校验 VFSL/ROOT/createdAt」。 | 反馈 2：META 对 Hub 广告 identity 的完全一致性必须在 persistence ownership 转移前校验。 | no-conflict | 核对在 Persistence 接管前由 import/Registry 编排层完成，未要求 Persistence 将一般 VFSL/ROOT/createdAt 校验纳入既有 `createDoc` 条款；可通过本轮已授权的 ADR-0006 增补明确 import lifecycle seam 的前置条件。 |
| 5 | 无 | ADR-0008：「`close()`……此前已接纳任务无条件排空，不取消、不设内部 timeout。」；ADR-0009：旧异步操作只能按 entry identity/generation 清理自己。 | 反馈 1：不匹配时 generation/lease/runtime 完全保持可用。 | no-conflict | 身份预检失败时根本不进入 close/forceRelease/archive，不取消已接纳任务也不改变 close barrier 语义；反而避免错误 generation 被关闭。实现仍须保持同 key lifecycle 串行和 generation 守卫。 |
| 6 | 无 | ADR-0010：「身份与 epoch 相同才允许双向 state-vector reconciliation；缺失或不同进入稳定 `conflicted` 状态，绝不自动覆盖或合并。」 | 反馈 2：lineage 或 epoch 正确格式但与广告不符必须拒绝，零持久化写入、零 entry 登记。 | no-conflict | 这是对 lineage/epoch 不同即不允许继续的本地 bootstrap 前置落实，强化而非削弱「不自动覆盖或合并」。 |
| 7 | 无 | ADR-0006 既有修订体例：「本节修订上方两处早期决策条款，取代关系如下；未提及的条款维持原文效力。」；「本节为**增量演进**……除下列明示条款外，未提及的条款……维持原文效力。」 | 反馈 3 / R2-AC-5：修订 ADR-0006 和 ADR-0010，记录新增契约、归档布局与原子语义、import/reset 的身份前置与顺序。 | override-declared | owner review 明示授权 ADR 修订；任务也明确「演进经 owner 裁决放行体例，与两 ADR 既有修订段格式一致」。修订须使用明确 scope/取代关系、保留未触及条款、以 ADR 本身为规范（不得以 `wiki/raw/*` 代替）。 |

## 结论

`clear`。放行进入 SA6/SA1 流程。

- 实质冲突点数：0（无 hard-violation）。
- 裁决分布：no-conflict × 4；override-declared × 1；evolution × 2；hard-violation × 0。
- evolution × 2 均非阻断：反馈 3 已提供 owner review 的明示 ADR 修订授权；须由本轮 ADR-0006/0010 修订正式收口，不能只落在实现或 `wiki/raw/*` 历史档案。

### ADR 修订的门禁性体例要求

1. ADR-0010 必须明确取代/修订原「reset 先关闭 Runtime generation」和 bootstrap 的泛化「严格核对 META 身份」描述中与新契约相冲突或不足的部分；应记录 reset 的 preflight 身份核对先于 forceRelease/close/archive、失败时零破坏，以及 import 以 Hub 广告 expected identity 为绑定事实且核对先于 ownership transfer。
2. ADR-0006 必须在增补中限定 importDoc/archiveDoc 的 Persistence 生命周期边界、归档布局与原子提交语义；不得改写既有 owner 分区、全量 snapshot、`saveDoc` 为 dirty notification、单 rootDir owner 或 `META.docId` 校验的有效契约，除非在修订节逐项说明取代关系。
3. 两份 ADR 必须沿用既有修订节的「明确受影响条款 / 取代关系 / 未提及条款维持效力」体例，并标明 owner 授权来源（本轮 feedback 3）；不以代码、任务简报或 `wiki/raw/*` 作为规范替代物。
4. SA1 仍须明确 live 与 persisted identity 在 dirty-not-flushed 场景下的真相源及比对口径；该设计选择不得把「dirty notification 已登记」误称为已落盘，也不得绕过 ADR-0008 的 FIFO/close 排空或 ADR-0009 的 generation 安全清理。

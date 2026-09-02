# 冲突门禁报告

> SA8 前置门禁（Phase 0）。被审对象：任务简报 `wiki/raw/task_trusted-replication-management-diagnostic-change-log.md`（Issue #151 round=1（SA8 retry 1），feature；父 PR #142 `docs/namespace-diagnostic-change-log`）。
> 冲突基准：`docs/adr/` 全集（11 个文件，逐个全读，禁止抽样）+ `CONTEXT.md`。代码与 wiki 其他档案（#148/#156/#159/#166/#167 的交付面）不构成自动阻塞依据。
> 盘点注记 1：ADR-0011/0012 正文引用「ADR 0010 trusted replication」，但 `docs/adr/` 无 0010 文件——**不在本门禁基准内**。简报中「replication identity gates、ACK timing、transport observability」的语义本身无仓内 ADR 条款可撞；基准内对它们的约束是 ADR-0011/0012 的**不修改声明**（「不修改……ADR 0010 的 trusted replication、ACK 和 transport observability 语义」），而简报恰是同向的「without changing」。
> 盘点注记 2：ADR-0012 的 2026-08-28 首切片 amendment 为现行条款，且其接线纪律**点名本票**（#151）：「不满足该条件的接线为不合规，必须由 #149–#151/#155 或后续接线票修复后方可启用」。
> 盘点注记 3（背景，非基准）：本 worktree 代码面尚无 trusted replication apply/enable/epoch-bump 实现（`grep` 仅命中诊断词表冻结面 `packages/namespace-diagnostic-log/src/{schema,vocabulary}.ts`）；replication 业务实现属其交付票，其结果通道形状不在 ADR/CONTEXT 基准内，SA1 按「保留既有」处理并在设计中声明依赖落点。

## Verdict

`clear`

Objective 与五条 AC 逐条对照：本票是把 ADR-0011 §覆盖范围最后两项（「trusted replication raw update apply」「写入复制身份或提升 epoch 等 replication management 操作」）接入诊断日志的直接实施票，三条 operation（`replication-apply` / `replication-enable` / `replication-epoch-bump`）已在 ADR-0012 v1 封闭词表内，source/context（direction 双向、remoteInstanceId、replicationId、replicationEpoch）、结局六分支、`identity` 阶段（明文覆盖「复制谱系、epoch 或 namespace identity 不满足」）、owned update bytes（ADR-0011 Consequences 明文授权「doc-runtime/**replication transaction seam** 未来需要提供 owned update bytes」）全部是既有条款的逐条复述或直接兑现。对 replication identity gates、ACK timing、transport observability、槽序，简报显式声明「without changing」，与 ADR-0011/0012 关联节的不修改声明同向。无 override 声明、无未走正式 supersede 的演进意图、无直接违反。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（2026-08-19 修订；2026-08-21 SCHEMA 键名修订） | 间接（record schema 冻结纪律的根源） | no-conflict |
| ADR-0002 | nomicore 是重写，authority 出范围 | accepted | 否 | no-conflict |
| ADR-0003 | 求值器与派生 schema（ROOT 约定） | accepted | 否（本票不触碰 ROOT 写路径） | no-conflict |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | no-conflict |
| ADR-0005 | 投影生成管线 | accepted | 否 | no-conflict |
| ADR-0006 | Cordis 持久化插件 | accepted（含两轮修订） | 间接（notifyDirty→saveDoc 脏通知语义不得被日志包裹；dirty-notification 阶段记录其既有失败） | no-conflict |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge | accepted；open/read 条款被 0008 取代 | 是（零写入、observer no-rollback、fatal 不虚构回滚——AC2 fatal 路径与 owned-bytes 捕获窗口共用的底层纪律） | no-conflict（被取代范围不构成约束） |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 2026-08-24 稳定码注册修订） | 是（AC4 钉死的 write-sequencer 槽序与 notifyDirty 槽位；committed-aware fatal 的 committed 事实来源；「以稳定码定义处 append-only 注册表为准」的透传纪律） | no-conflict |
| ADR-0009 | NamespaceRegistry/租约/Host 生命周期 | accepted | 间接（lease 停接纳/lifecycle 拒绝是 acceptance 阶段记录来源；shutdown 不无限等待日志 sink） | no-conflict |
| （0010） | trusted replication（被 0011/0012 引用） | **文件不存在于 docs/adr/** | ——（简报所指 replication 语义无仓内 ADR 条款） | 不在基准内（盘点注记 1） |
| ADR-0011 | Best-effort namespace 诊断变更日志 | accepted | 是（本票主规范：覆盖范围最后两项、identity 阶段、业务隔离、owned update bytes、transport 排除面） | no-conflict |
| ADR-0012 | VFSL JSONL 与 framed sidecar 日志格式 | accepted（含 2026-08-28 首切片 amendment） | 是（三条 operation/direction/context 词表、result 判别联合、manifest 身份边界、amendment write-slot 接线纪律点名 #151） | no-conflict（含 7 条钉死语义，见下） |

## 冲突点

无阻塞冲突。以下为逐条裁决记录（均为 no-conflict，#1–#5 为设计必须钉死的语义约束，SA1/SA2 重点核验）：

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | info（seam 归属） | ADR-0011 §Committed update：「对 committed transaction，日志可携带该 transaction 产生的 owned Yjs update bytes……日志不能通过事务后编码整个文档来冒充”该次 transaction update“。底层 transaction 模块应在不暴露 live Y.Doc 的前提下返回或投递 owned bytes。」；（Consequences）「doc-runtime/**replication transaction seam** 未来需要提供 owned update bytes；该演进不得暴露 live Y.Doc。」；ADR-0012 result 判别联合：「committed + `noop`；committed + `update`；committed + `update-omitted`；……rejected 与 fatal committed:false 禁止携带 update。」 | AC3："Committed replication transactions provide detached owned Yjs update bytes for the exact applied effect, with no-op and update-omitted represented explicitly." | **no-conflict**（钉死） | 本票正是 ADR-0011 Consequences 点名授权的「replication transaction seam 提供 owned update bytes」兑现票。**钉死**：捕获点在 replication 事务 seam（不暴露 live Y.Doc；#167 的 update 事件订阅窗口先例可参照，handler 遵守 ADR-0007「Yjs observer 不得向事务调用栈抛异常」）；禁止事务后 `Y.encodeStateAsUpdate(doc)` 全文档编码冒充本次 applied effect；no-op（无实际 update 的成功）与 update-omitted 按 result 判别联合显式分置；update-omitted 的 reason 只用冻结词表 `payload-too-large` / `update-capture-disabled` / `empty-update`（CONTEXT.md「语义 emission」），新增 reason 属词表演进须过设计评审。 |
| 2 | info（接线纪律） | ADR-0012 amendment（2026-08-28，规范性，点名本票）：「**任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot 之外，或在该 slot 已释放之后；不得在 slot 内执行同步 File adapter `emit`。**不满足该条件的接线为不合规，必须由 #149–**#151**/#155 或后续接线票修复后方可启用。」；ADR-0011 §时序：「committed record 的 sequence 分配与 emitter 接收可发生在 transaction committed 事实可知之后，但 emitter 不被 `await`」「`notifyDirty` 仍按 ADR 0008/0010 的原有槽序执行。日志记录 dirty failure，但不替代或包裹 dirty notification」「adapter 慢、失败或队列满都不得延长 write slot 或阻塞 close/shutdown」 | Objective："without changing …… or business write ordering"；AC4："Logger failure or queue pressure never changes apply results, replication ACKs, identity/epoch state, **write-sequencer order**, or transport health reporting." | **no-conflict**（钉死） | 简报要求保全槽序与业务隔离，与 amendment 接线纪律同向；#151 正是 amendment 点名的接线责任票。**钉死**：emit 调用点必须在 write sequencer slot 之外或 slot 释放之后（首切片同步有界 append 的必然要求）；emit 不被 `await`、不得延长槽时长；`notifyDirty` 槽序不动，日志记录 dirty failure 但不替代或包裹 dirty notification；replication apply/enable/epoch-bump 的业务排序仍由既有 sequencer/lifecycle slot 决定，日志不得引入第二个业务排序机构。 |
| 3 | info（词表保真） | ADR-0012：「v1 operation 是封闭词表：……`replication-apply` `replication-enable` `replication-epoch-bump`。新增 operation 需要新的 record schema 版本与 stream generation。」；source/context 形状（direction `'hub-to-peer' \| 'peer-to-hub'`、remoteInstanceId、replicationId、replicationEpoch）；ADR-0011 阶段词表：「`identity`：**复制谱系、epoch 或 namespace identity 不满足**」；「每条结局记录保留所属模块已有的稳定 code、phase、issues 顺序与 committed 事实；日志层不得发明 retryable、rollback 或成功语义。」；ADR-0012：「`code` 与 `sourcePhase` 使用安全 Pattern 字符串并标注 source module，不复制 Registry、Runtime、Persistence 与 replication 的全部错误枚举」 | AC1："……emit their **frozen v1 operation** and controlled replication source/context."；AC2："Identity, epoch, capability, validation, transaction, dirty-notification, and committed-aware fatal outcomes **retain existing** stable phase, code, issues, and committed facts." | **no-conflict**（钉死） | 所需词表全部既有：三条 operation 已在 v1 封闭词表内，无需新增；direction 双字面量、context 四可选键、结局六分支、阶段八项全部冻结。**钉死**：简报 AC2 的「Identity, epoch」结局映射到阶段 `identity`（词表无独立 epoch 阶段）；stage/code/issues/committed 全部取自 replication 模块既有结果通道（以其定义处 append-only 注册表为准，ADR-0008 稳定码注册修订第 5 条同款纪律），日志层零新造、零改 message；正常路径禁用结局 `unknown`（ADR-0012 result 判别联合中 fatal+committed:true 的 effect `unknown` 是存储 schema 显式分支，不得与结局分类混用）；任何 operation/stage/reason 新增属词表演进，须过设计评审并回 SA8。 |
| 4 | info（transport 排除面） | ADR-0011 §覆盖范围：「针对具体 namespace 变更的角色、authorization、identity 和 epoch 拒绝属于该变更尝试。**连接建立、心跳、普通 frame、无 namespace 目标的认证失败等 transport 事实仍属于复制 transport observability，不混入 namespace 诊断变更日志；两者可通过受控 `correlationId` 关联。**」；（排除面）「普通 read/open 不尝试修改 Y.Doc，不属于变更尝试。」；（数据保护）「默认不记录 token、凭证、原始 Authorization、完整 Error stack、任意 cause 文本或**未经控制的 transport payload**」 | What-to-build："Investigators must distinguish local and replicated effects and inspect controlled direction and identity context, without changing …… transport observability"；AC5："……and **isolation from transport observability**." | **no-conflict**（钉死） | 简报与 ADR-0011 逐字同向。**钉死**：本票只为 namespace 变更尝试发记录（apply/enable/epoch-bump 三条 operation）；连接建立、心跳、普通 frame、无 namespace 目标的认证失败不得混入诊断变更日志，也不得改变 transport 健康上报面（AC4）；两侧需要关联时只用受控 `correlationId`（context 键，非新词表项）。 |
| 5 | info（能力态与业务隔离） | ADR-0011：「日志 emit、排队、持久化、背压、丢弃或关闭失败不得改变业务操作的返回值、rejection、提交事实、sequencer 顺序或 Runtime 状态」「日志不得成为 `createDoc`、Yjs transaction、dirty notification 或 **replication ACK** 的成功前置条件」「日志实现不得因失败将 namespace 标记为 fatal、persistence-degraded 或只读，也不得触发业务请求重试」「**Runtime/Registry/复制实现仍防御 adapter 违约**；adapter 同步 throw 或异步失败均被隔离，并只进入独立的日志健康 metrics/observer」；ADR-0011 §Interface：「完整查询、导出、重放、保留与健康检查属于日志存储/工具模块的 interface，**不扩张 …… 或 replication wire interface**」 | AC4："Logger failure or queue pressure never changes apply results, **replication ACKs**, **identity/epoch state**, write-sequencer order, or transport health reporting." | **no-conflict** | AC4 是 ADR-0011 产品契约的逐条复述（replication ACK 被明文点名）。**钉死**：任何日志故障不得改变 apply 结果、ACK 时序与内容、identity/epoch 状态或 transport 健康；不得置位 fatal/persistence-degraded/只读；不得进入业务结果联合或 replication wire 面；producer（复制实现）对 emitter 违约做防御（同步 throw 全吞没隔离），故障只走日志健康 observer。 |
| 6 | info（身份上下文落点） | ADR-0012：「**owner、instanceId、replicationId 与 replication epoch 不冻结在 manifest；适用时由每条记录的受控 context 表达。**」；「日志启用与配置是本地 Host/Registry 旁路状态，**不写入 namespace `SCHEMA`、`META` 或 `ROOT`，也不随 Hub/Peer 复制**。」；CONTEXT.md「诊断日志 stream generation」_Avoid_:「Runtime generation、**replication epoch**、跨 generation 隐式连续日志」 | AC1："……and controlled replication **source/context**."（调查者按 direction 与 identity context 区分本地/复制效果） | **no-conflict**（护栏） | **钉死（护栏）**：replicationId / replicationEpoch / remoteInstanceId / direction 一律走**每条记录的受控 source/context**，不进 manifest、不作为 stream 分代依据；replication epoch 与日志 stream generation 是两个概念，不得混同或互推；日志启用与配置是本地旁路状态，不写入 SCHEMA/META/ROOT、不随 Hub/Peer 复制——与「写复制身份/提升 epoch」的业务写（属变更尝试）分属两个事实面，SA1 不得把日志配置当成复制数据。 |
| 7 | info（emission 公共面边界） | CONTEXT.md 语义 emission：「不含 streamId/sequence/segment/frameOffset/Base64/CRC 等物理表示（storage projection 归 adapter）。emit 同步、不 throw、不阻塞；**快照与 updateBytes 所有权移交后不得再变异**。」；storage projection：「emitter 只做语义投影，不构造物理字段。」_Avoid_: 业务侧构造物理载体、emission 面物理键、VFSL 双 schema；genesis baseline record：「v1 冻结的 emission/sink 公共面无构造路径，由 #152 adapter 内部构造。」；ADR-0011：「多副本环境中，同一 CRDT effect 可能分别作为本地提交与远端 apply 出现在不同 stream；本 ADR 不定义跨 stream 去重或全局排序。」 | AC1 emission 字段（frozen v1 operation + controlled source/context）；AC3 detached owned bytes | **no-conflict**（护栏） | 简报要求的 emission 字段全部是语义面字段，与本票 replication producer 角色一致。**钉死（护栏）**：producer 只做语义投影——不构造 segment/offset/Base64/CRC 物理字段，不在 emission/sink 公共面新增 genesis 构造路径，不暴露 live Y.Doc；快照与 updateBytes 所有权移交后不得再变异；本地提交与远端 apply 双侧各留记录属预期，不做跨 stream 去重/排序。 |
| 8 | info（措辞精度） | ADR-0012 amendment：「该首切片不维护 writer queue、不做 batch flush……」；ADR-0011：「日志队列溢出可以丢弃记录。」；ADR-0008：「测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault。」 | AC4："Logger failure or **queue pressure** never changes……"；AC5 测试面 | **no-conflict** | AC4 的 "queue pressure" 列举的是**须被隔离的日志故障模式**（防御性测试面），不要求实现 writer queue；首切片无 queue 时该模式经注入 seam 模拟（ADR-0008 测试 seam 条款），未来 queue 切片落地时同一 AC 语义已由 ADR-0011「日志队列溢出可以丢弃记录」覆盖。测试注入不得改变生产面形状。 |

## 结论

**Verdict: `clear`，放行进入 SA1 设计。** 无 hard-violation、无 override-declared、无 evolution。

随报告移交 SA1/SA2 的钉死约束（原文依据均已在冲突点表与相关决议文档 `task_trusted-replication-management-diagnostic-change-log_relevant_decisions.md` 给出）：

1. **owned update bytes 走 replication transaction seam**：不暴露 live Y.Doc；禁止事务后全文档编码冒充本次 applied effect；no-op 与 update-omitted 显式分置；update-omitted reason 只用冻结三词表，新增属词表演进（冲突点 #1）；
2. **emit 调用点在 write sequencer slot 之外或 slot 释放之后**（ADR-0012 amendment 点名 #151 的规范性接线纪律）；emit 不被 await、不延长槽；notifyDirty 槽序不动、日志不替代或包裹 dirty notification；不引入第二个业务排序机构（冲突点 #2）；
3. **词表零新造**：三条 operation、direction 双字面量、context 四可选键、结局六分支、阶段八项全部取冻结词表；「Identity, epoch」结局映射阶段 `identity`；stage/code/issues/committed 取自 replication 模块既有通道（以其稳定码定义处注册表为准），零改 message；正常路径禁用结局 `unknown`；任何词表新增须过设计评审并回 SA8（冲突点 #3）；
4. **transport 排除面**：只发 namespace 变更尝试；连接/心跳/普通 frame/无 namespace 目标的认证失败不混入、不改变 transport 健康面；关联只用受控 `correlationId`（冲突点 #4）；
5. **业务与能力态隔离**：任何日志故障零业务影响——不改 apply 结果、ACK、identity/epoch 状态、槽序、transport 健康；不置位 fatal/degraded/只读；producer 防御 emitter 违约，故障只走日志健康 observer；不扩张 replication wire interface（冲突点 #5）；
6. **身份上下文落点**：replicationId/epoch/remoteInstanceId/direction 走每条记录的受控 context，不进 manifest、不作 stream 分代依据；replication epoch ≠ 日志 stream generation；日志配置是本地旁路状态，不入 SCHEMA/META/ROOT、不复制（冲突点 #6）；
7. **emission 公共面边界**：不构造物理字段、不加 genesis 构造路径、不暴露 live Y.Doc；所有权移交后不得再变异；跨 stream 不去重不排序（冲突点 #7）。

范围注记（非冲突）：
- 本 worktree 代码面尚无 replication apply/enable/epoch-bump 实现（盘点注记 3）——replication 业务实现的既有结果通道（AC2 所指 stable phase/code/issues/committed）不在 ADR/CONTEXT 基准内；SA1 须在设计中显式锚定其所依赖的 replication seam 落点，若依赖未合入，按简报「record any resulting limitation」纪律记录。
- ADR-0010 缺席（盘点注记 1）：replication 语义无可撞条款，本票对其只有「不修改」义务（经 ADR-0011/0012 关联节 + 简报同向声明确立）。

设计后复审（SA1 产出后）将按本报告七条钉死语义逐条复核，并追加设计引入的新决策点到相关决议文档。

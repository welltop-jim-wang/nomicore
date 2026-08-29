# 冲突门禁报告

> SA8 前置门禁（Phase 0）。被审对象：任务简报 `wiki/raw/task_root-schema-diagnostic-change-log.md`（Issue #149 round=1，Bug 修复；父 PR #142 `docs/namespace-diagnostic-change-log`）。
> 冲突基准：`docs/adr/` 全集（11 个文件，逐个全读）+ `CONTEXT.md`。代码与 wiki 其他档案（#148 v1 contract、#152 File adapter、#153 stream roll repair 的交付面）不构成自动阻塞依据。
> 盘点注记：ADR-0011/0012 正文引用「ADR 0010 trusted replication」，但 `docs/adr/` 无 0010 文件——不构成本门禁基准的一部分；本票不涉及 replication 路径。ADR-0012 的 2026-08-28 首切片 amendment 为现行条款，且其接线纪律**点名本票**（#149）为合规接线责任票。

## Verdict

`clear`

Objective 与五条 AC 逐条对照：本票是把 ADR-0011 §覆盖范围中「ROOT mutation」「SCHEMA replacement」两条既有义务接入 NamespaceRuntime 的直接实施票，全部要求（stage/code/issues/committed/effect 投影、owned update bytes、not-accessed 与单快照纪律、日志故障业务隔离、判别分支与敌意输入测试）均为 ADR-0011/0012 已接受条款的逐条复述或直接推论；对 ADR-0006/0007/0008 的槽序、零写入、dirty notification、能力态与公共返回形状，简报显式声明「preserving」而非修改。无 override 声明、无未走正式 supersede 的演进意图、无直接违反。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（2026-08-19 修订；2026-08-21 SCHEMA 键名修订） | 间接（record schema 冻结纪律的根源） | no-conflict |
| ADR-0002 | nomicore 是重写，authority 出范围 | accepted | 否 | no-conflict |
| ADR-0003 | 求值器与派生 schema（ROOT 约定） | accepted | 间接（ROOT 固定 Y.Map 是 mutation 操作对象的存在前提，本票不触碰） | no-conflict |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | no-conflict |
| ADR-0005 | 投影生成管线 | accepted | 否 | no-conflict |
| ADR-0006 | Cordis 持久化插件 | accepted（含 createDoc/owner、entry status/saveDoc 两轮修订） | 间接（notifyDirty→saveDoc 脏通知语义不得被日志包裹；degraded 写前 gate 是 capability-gate 记录来源） | no-conflict |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge | accepted；open/read 条款被 0008 取代 | 是（零写入、observer no-rollback、公共 mutation 返回 `{ok:true}`——与 AC2 owned bytes 的关系见冲突点 #1） | no-conflict |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 2026-08-24 稳定码注册修订） | 是（本票接线宿主：mutateRoot/replaceSchema 槽序、fatal 通道、停接纳码族） | no-conflict |
| ADR-0009 | NamespaceRegistry/租约/Host 生命周期 | accepted | 间接（lease 停接纳/lifecycle 拒绝是 acceptance 阶段记录来源；shutdown 不无限等待日志） | no-conflict |
| （0010） | trusted replication（被 0011/0012 引用） | **文件不存在于 docs/adr/** | 否 | 不在基准内（盘点注记） |
| ADR-0011 | Best-effort namespace 诊断变更日志 | accepted | 是（本票主规范：结局/阶段词表、输入捕获、业务隔离、owned update bytes） | no-conflict |
| ADR-0012 | VFSL JSONL 与 framed sidecar 日志格式 | accepted（含 2026-08-28 首切片 amendment） | 是（operation/result/stage 词表、semantic emission 边界、amendment write-slot 接线纪律点名 #149） | no-conflict（含 7 条钉死语义，见下） |

## 冲突点

无阻塞冲突。以下为逐条裁决记录（均为 no-conflict，#1/#2/#3 为设计必须钉死的语义约束，SA1/SA2 重点核验）：

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | info（seam 归属） | ADR-0007：「- 成功只返回 `{ ok:true }`，不返回 snapshot、Yjs update 或内部类型。」；ADR-0011 §Committed update：「底层 transaction 模块应在不暴露 live Y.Doc 的前提下返回或投递 owned bytes。」「日志不能通过事务后编码整个文档来冒充“该次 transaction update”。」；（Consequences）「doc-runtime/replication transaction seam 未来需要提供 owned update bytes；该演进不得暴露 live Y.Doc。」 | AC2："Successful transactions provide detached owned Yjs update bytes for the exact transaction effect; no-op and update-omitted outcomes remain explicit and no live Y.Doc escapes." | **no-conflict**（钉死） | AC4 同时要求业务返回值不变——AC2 是 emission 面要求，不是公共返回面要求。ADR-0011（更晚、专门）明文授权 owned bytes 由 **transaction seam** 返回/投递且禁止暴露 live Y.Doc；ADR-0007 的 `{ok:true}` 条款辖公共业务结果，两者各辖其面、不相交。**钉死**：SA1 不得以扩展 `mutateRoot`/`replaceSchema`/`applyValidatedMutation` 公共结果联合携带 update bytes 的方式实现（那将触及 ADR-0007/0008 条款，属 evolution，须上报 Jim 裁决）；捕获点必须在 transaction seam，且禁止事务后 `Y.encodeStateAsUpdate(doc)` 全文档编码冒充本次 transaction update。no-op（无实际 update 的成功）与 update-omitted 必须按 ADR-0012 result 判别联合显式分置。 |
| 2 | info（接线纪律） | ADR-0012 amendment（2026-08-28，规范性）：「**任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot 之外，或在该 slot 已释放之后；不得在 slot 内执行同步 File adapter `emit`。**不满足该条件的接线为不合规，必须由 #149–#151/#155 或后续接线票修复后方可启用。」；ADR-0011 §时序：「committed record 的 sequence 分配与 emitter 接收可发生在 transaction committed 事实可知之后，但 emitter 不被 `await`」「- adapter 慢、失败或队列满都不得延长 write slot 或阻塞 close/shutdown」 | Objective："while preserving sequencer ordering, zero-write guarantees, dirty notification behavior, capability state…"；AC4："…do not alter business return values, commits, write-sequencer order, dirty notification, or Runtime capability." | **no-conflict**（钉死） | 简报要求保全槽序与业务隔离，与 amendment 接线纪律同向；#149 正是 amendment 点名的接线责任票。**钉死**：emit 调用点必须在 write sequencer slot 之外或 slot 释放之后（首切片同步有界 append 的必然要求）；emit 不被 `await`、不得延长槽时长；`notifyDirty` 仍按 ADR-0008/0010 原有槽序执行，日志记录 dirty failure 但不替代或包裹 dirty notification。SA1 设计须显式给出 emit 调用点与槽生命周期的关系及顺序保证（emitterSequence 只表 emitter 本地顺序，日志不得引入第二个业务排序机构）。 |
| 3 | info（词表保真） | ADR-0011：「`rejected` 不得折叠成统一 `failed`。至少保留下列阶段：acceptance…capability-gate…input-snapshot…schema-compile…validation…identity…transaction…dirty-notification」「每条结局记录保留所属模块已有的稳定 code、phase、issues 顺序与 committed 事实；日志层不得发明 retryable、rollback 或成功语义。」「`unknown`：仅用于缺少可判定结局的诊断记录……不能由正常操作路径主动代替既有结果分类。」；ADR-0012：「result 使用严格判别联合：committed+`noop`；committed+`update`；committed+`update-omitted`；rejected；fatal+`committed:false`；fatal+`committed:true`，effect 为 `update \| update-omitted \| unknown`。rejected 与 fatal committed:false 禁止携带 update。」「顶层诊断 `stage` 使用日志 schema 的封闭枚举；`code` 与 `sourcePhase` 使用安全 Pattern 字符串并标注 source module……不发明 retryable、rollback 或提交事实。」；CONTEXT.md：update-omitted reason 受控词表「`payload-too-large` / `update-capture-disabled` / `empty-update`——新增 reason 属词表演进，须过设计评审」 | AC1："ROOT mutation and SCHEMA replacement attempts emit frozen operation, source/context, stage, stable code, issues, committed fact, and effect classification for every existing result path." | **no-conflict**（钉死） | 所需词表全部既有：`root-mutation`/`schema-replacement` 已在 ADR-0012 v1 operation 封闭词表内，无需新增（新增 operation 需新 record schema 版本+新 stream generation）；结局六分支、阶段八项、update-omitted 三 reason 均冻结。**钉死**：stage/code/issues/committed 全部取自所属模块既有通道（ADR-0008 结果联合、fatal 的 `committed` 与稳定 `phase`、停接纳 `RUNTIME_WRITE_DISABLED` 码族），日志层零新造；正常路径不得使用 `unknown` 结局（ADR-0012 result 判别联合中 fatal+committed:true 的 effect `unknown` 是存储 schema 显式分支，不是结局分类，不得混用）；新增任何 reason/stage/operation 属词表演进，须过设计评审并回 SA8。 |
| 4 | info（输入捕获纪律） | ADR-0011 §输入捕获与零额外读取：「capability/acceptance gate 在输入访问前拒绝时，记录 `input.capture = not-accessed`，不得随后序列化、hash 或检查原始请求」「快照成功后，日志只能消费该操作已经生成的同一份 detached frozen plain-data snapshot，不得再次遍历调用方原对象」「快照失败时，记录稳定 issue 与 `input.capture = unavailable/unsafe-input`，不得为了“记录完整请求”重新读取 Proxy、accessor、循环引用或其他敌意输入」「对 create 等已有独立快照实现的路径，同样复用该路径的安全快照，不建立第二套序列化规则」；ADR-0008：「任务取得槽后立即用受控 snapshotter 复制并递归冻结 plain data，之后编译、校验、构造和提交只使用该内部快照。」 | AC3："Acceptance and capability-gate rejection records mark input as not accessed; later records consume only the operation's existing detached safe snapshot."；AC5："…Proxy/accessor inputs with zero additional reads caused by logging." | **no-conflict**（钉死） | AC3/AC5 是 ADR-0011 §输入捕获的逐条复述。**钉死**：mutateRoot 的 mutation 输入与 replaceSchema 的 proposedEnvelope/optional root 各自复用 ADR-0008 受控 snapshotter 的那一份冻结快照，日志不建立第二套序列化/快照规则；快照失败按 `unavailable/unsafe-input` 记录且禁重读原始对象（含 Proxy/accessor 陷阱属性不得因日志而触发——ADR-0012 验收门槛 5 同款）。 |
| 5 | info（能力态隔离） | ADR-0011：「日志 emit、排队、持久化、背压、丢弃或关闭失败不得改变业务操作的返回值、rejection、提交事实、sequencer 顺序或 Runtime 状态」「日志不得成为 `createDoc`、Yjs transaction、dirty notification 或 replication ACK 的成功前置条件」「日志实现不得因失败将 namespace 标记为 fatal、persistence-degraded 或只读，也不得触发业务请求重试」「adapter 同步 throw 或异步失败均被隔离，并只进入独立的日志健康 metrics/observer」 | AC4："Logger throw, queue-full, validation failure, and sink failure do not alter business return values, commits, write-sequencer order, dirty notification, or Runtime capability." | **no-conflict** | AC4 是 ADR-0011 产品契约的逐条复述；「validation failure」对应 ADR-0012「append 前 VFSL validation failure……丢弃 record……不改变业务结果」（日志侧校验失败与业务校验失败分属两面，均零业务影响）。**钉死**：任何日志故障不得置位 Runtime fatal/degraded/只读，不得进入业务结果联合；emitter 违约由调用方防御并只走日志健康 observer。 |
| 6 | info（措辞精度） | ADR-0012 amendment：「该首切片不维护 writer queue、不做 batch flush、不提供 fsync 开关，也不保持常驻 file descriptor。」；ADR-0011：「日志队列溢出可以丢弃记录。」；ADR-0008：「测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault。」 | AC4："**queue-full** … do not alter business return values…" | **no-conflict** | AC4 的 "queue-full" 列举的是**须被隔离的日志故障模式**（防御性测试面），不要求实现 writer queue；首切片无 queue 时该模式经注入 seam 模拟（ADR-0008 测试 seam 条款），未来 queue 切片落地时同一 AC 语义已由 ADR-0011「日志队列溢出可以丢弃记录」覆盖。测试注入不得改变生产面形状。 |
| 7 | info（emission 公共面边界） | CONTEXT.md 语义 emission：「不含 streamId/sequence/segment/frameOffset/Base64/CRC 等物理表示（storage projection 归 adapter）。emit 同步、不 throw、不阻塞；快照与 updateBytes 所有权移交后不得再变异。」；storage projection：「日志 adapter 独占的物理表示决策……emitter 只做语义投影，不构造物理字段。」_Avoid_: 业务侧构造物理载体、emission 面物理键、VFSL 双 schema；genesis baseline record：「v1 冻结的 emission/sink 公共面无构造路径，由 #152 adapter 内部构造。」；ADR-0012：「业务 producer 只提交 semantic emission，不构造 segment/offset/Base64 等物理表示。」 | AC1 emission 字段清单（operation/source/context/stage/code/issues/committed/effect）；AC2 "no live Y.Doc escapes" | **no-conflict**（护栏） | 简报要求的 emission 字段全部是语义面字段，与本票 Runtime producer 角色一致。**钉死（护栏）**：Runtime 侧只做语义投影——不构造 segment/offset/Base64/CRC 等物理字段（storage projection 归 adapter），不在 emission/sink 公共面新增 genesis 构造路径，不暴露 live Y.Doc/DocHandle（ADR-0009 lease 条款同向）；快照与 updateBytes 所有权移交 emitter 后不得再变异。 |

## 结论

**Verdict: `clear`，放行进入 SA1 设计。** 无 hard-violation、无 override-declared、无 evolution。

随报告移交 SA1/SA2 的钉死约束（原文依据均已在冲突点表与相关决议文档 `task_root-schema-diagnostic-change-log_relevant_decisions.md` 给出）：

1. **owned update bytes 走 transaction seam**：公共业务返回形状（`{ok:true}`、结果联合）不得扩展携带 update bytes；禁止事务后全文档编码冒充本次 transaction update；no-op 与 update-omitted 显式分置（冲突点 #1）；
2. **emit 调用点在 write sequencer slot 之外或 slot 释放之后**（ADR-0012 amendment 点名 #149 的规范性接线纪律）；emit 不被 await、不延长槽；notifyDirty 槽序不动、日志不替代或包裹 dirty notification（冲突点 #2）；
3. **词表零新造**：operation/stage/结局判别/update-omitted reason 全部取冻结词表；stage/code/issues/committed 取自所属模块既有通道；正常路径禁用 `unknown` 结局；任何词表新增属演进、须过设计评审（冲突点 #3）；
4. **输入零额外读取**：gate 拒绝记 `not-accessed`；快照成功后只消费既有 detached 冻结快照；快照失败记 `unavailable/unsafe-input` 且禁重读 Proxy/accessor/循环引用；不建第二套快照规则（冲突点 #4）；
5. **能力态隔离**：任何日志故障（throw/queue-full/VFSL 校验失败/sink 失败）零业务影响、不置位 fatal/degraded/只读；故障注入仅限测试 seam（冲突点 #5/#6）；
6. **P0 编译故障不属于变更尝试**（ADR-0011 排除面）——本票只为 ROOT mutation 与 SCHEMA replacement 两条 operation 发射，不得为 P0/open/read 补造变更记录（ADR 盘点 #0008/#0011 行）；
7. **emission 公共面边界**：不构造物理字段、不加 genesis 构造路径、不暴露 live Y.Doc（冲突点 #7）。

范围注记（非冲突）：简报声明「Blocked by #148, which may not yet be merged. Execute against the current worktree and record any resulting limitation」——属流程处置，不构成 ADR 冲突；emitter seam 的形状锚定在 ADR-0011 §Interface 与 seam（ADR 级契约），#148 的代码层交付不构成门禁基准，但 SA1 若因 #148 未合入而需要自立接缝形状，须与 ADR-0011 emitter interface 条款逐字对齐并在设计中声明该限制的记录方式。

设计后复审（SA1 产出后）将按本报告七条钉死语义逐条复核，并追加设计引入的新决策点到相关决议文档。

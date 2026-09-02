# 冲突门禁报告（设计后复审）

> SA8 设计后复审（Phase 2 gate）。被审对象：SA1 设计 `wiki/raw/task_trusted-replication-management-diagnostic-change-log_design.md`（基线 `722bddf`）。
> 冲突基准：`docs/adr/` 全集（11 个文件：0001–0009、0011、0012；**无 0010**，本次复审逐个全读，非抽样）+ `CONTEXT.md`。代码与 wiki 其他档案不构成自动阻塞依据（前置门禁纪律维持；主线 `b66615c` 形状仅作设计声明的事实核验对象，不作基准）。
> 输入链：前置门禁 `_conflict_report.md`（verdict `clear` + 七条钉死约束）、`_relevant_decisions.md`、SA6 红灯契约 `_sa6_red.md`（15/15 FAIL，`enableReplication is not a function`）。
> 本报告对总控点名四项作专项核验：**最小复制业务面物化 / 槽后 emit / owned bytes / 三项仲裁**（见「特别核验」节）。

## Verdict

`clear`

SA1 设计对 ADR/CONTEXT 基准无 hard-violation、无 override-declared、无 evolution。七条钉死约束逐条落实（冲突点表 #3–#9）；设计引入的复制业务面物化、公共面扩张与三处行为仲裁均不撞基准条款——replication 业务面在仓内无 ADR 条款（ADR-0010 缺席，前置注记 1/3 维持），而设计触碰的 ADR-0006/0007/0008/0009/0011/0012 实质条款全部保全（逐条见盘点表与冲突点表）。所有相对主线代码的偏差（三仲裁 + 六局限）均在设计内显式登记，无静默漂移。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含两轮修订） | 间接 | no-conflict：本票是诊断日志纯消费方，不改 record schema 版本/指纹/词表（设计 §1.1、DENY LIST `namespace-diagnostic-log/**`） |
| ADR-0002 | nomicore 重写、authority 出范围 | accepted | 否 | no-conflict |
| ADR-0003 | 求值器与派生 schema | accepted | 否 | no-conflict：不触碰 ROOT 写路径；META 复制键写入属复制业务面，非本 ADR 条款域 |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | no-conflict |
| ADR-0005 | 投影生成管线 | accepted | 否 | no-conflict |
| ADR-0006 | Cordis 持久化插件 | accepted（含 createDoc/owner、entry status/saveDoc 两轮修订） | 间接 | no-conflict：R-3.1 与「saveDoc 是 **mutation 后**的 dirty notification」同向（见特别核验 D.1）；日志不包裹/不替代 notifyDirty（E6/R6 槽位原样） |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge | accepted；open/read 条款被 0008 取代 | 是 | no-conflict：owned-bytes 捕获窗口 handler 为单赋值不抛（§8），「Yjs observer 不得向事务调用栈抛异常」保全；apply 域拒绝零写入；被取代范围不构成约束 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 2026-08-24 稳定码注册修订） | 是 | no-conflict（含一条解释注记，冲突点 #2）：单一 FIFO sequencer（INV-S1）、槽组成镜像、committed-aware fatal、close barrier、status 边界全部保全；「v1 公开两个窄方法」为版本范围陈述而非永久冻结（依据见 #2） |
| ADR-0009 | NamespaceRegistry/租约/Host 生命周期 | accepted | 是 | no-conflict（含解释注记，冲突点 #2）：released 门（`NAMESPACE_LEASE_RELEASED`）保全；lease 不公开裸 Runtime/DocHandle/Y.Doc/live Yjs 引用（session 为冻结七键对象）；observer seam 零触碰；「唯一导出的 createNamespaceRuntimeForRegistry」为时点陈述（#2） |
| （0010） | trusted replication（被 0011/0012 引用） | **文件不存在于 docs/adr/** | —— | 不在基准内（前置注记 1 维持）：replication 业务语义（role 门、ACK、fanout、R6 无条件通知）无仓内 ADR 条款可撞；本票对其只有经 ADR-0011/0012 关联节确立的「不修改」义务，设计以「形状锚定 + 偏差显式登记」履行 |
| ADR-0011 | Best-effort namespace 诊断变更日志 | accepted | 是（主规范一） | no-conflict：七条钉死约束落实核验见冲突点 #3–#9；业务隔离、结局/阶段词表、输入捕获、数据保护、transport 排除面、emitter seam 逐条对照通过 |
| ADR-0012 | VFSL 校验的 JSONL 与 framed sidecar 日志格式 | accepted（含 2026-08-28 首切片 amendment） | 是（主规范二） | no-conflict：amendment C 接线纪律（点名 #151）核验见特别核验 B；operation/source/context/result 词表纯消费（`vocabulary.ts:12-33` 实核）；manifest 边界与语义/物理分工保全 |

## 冲突点

无阻塞冲突。以下为逐条裁决记录（全部 no-conflict；#1–#2 为设计引入的最大新增面，#3–#9 为七条钉死约束的设计落实核验）：

| # | 严重度 | ADR 条款 | 被审对象要求（设计） | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | info（范围物化） | 基准内无 replication 业务面条款（ADR-0010 缺席）；间接触及 ADR-0008（「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer」、槽组成、fatal 契约）、ADR-0006（dirty 语义）、ADR-0009（lease/内部通道） | §0.2/§0.3：在本 worktree 物化最小复制业务闭包（≈1,100 行：enable/bump 两写槽、最小会话核心、lease 薄通道、稳定码族、WriteSlot 扩展），形状锚定主线 `b66615c` 定义处；不物化 fanout/角色门/会话计数/status 域/reset fence | **no-conflict** | 物化对象无基准条款（前置注记 3 已裁定 replication 业务实现「不在 ADR/CONTEXT 基准内，SA1 按既有形状处理并声明依赖落点」——设计 §0 恰是该裁定的执行：锚定 + 显式偏差登记 + §12 局限 + 合并策略声明）。物化代码遵守的全部既有 ADR 实质条款逐条核验通过：INV-S1 单一 sequencer（enable/bump/apply 与 ROOT/SCHEMA 同一实例）、槽序 E1–E7/R1–R7 镜像 S1–S7（E3 输入校验/E4 领域事实/E5 单事务/E6 同槽 await notifyDirty）、committed-aware fatal 经 `RuntimeWriteFatalError{phase, committed}` 既有通道、close barrier 零改动、leased 面无裸引用暴露 |
| 2 | info（公共面扩张——解释注记） | ADR-0008「v1 公开两个窄方法：`mutateRoot` / `replaceSchema`」；ADR-0009「Lease……代理 Runtime 除 `close()` 外的同步读取、投影、status、ROOT mutation 和 SCHEMA replacement；不公开裸 Runtime、DocHandle、Y.Doc 或 live Yjs 引用」；ADR-0009「Registry 通过 `@nomicore/namespace-runtime/internal` **唯一导出的** `createNamespaceRuntimeForRegistry` 构造生产 Runtime」；ADR-0011 §Interface「完整查询、导出、重放、保留与健康检查属于日志存储/工具模块的 interface，**不扩张 `NamespaceRuntime`、`NamespaceLease`、`DocPersistence` 或 replication wire interface**」 | §6：runtime 十键→十二键（+`enableReplication`/`bumpReplicationEpoch`，主线同位）；`NamespaceLease` +`openReplicationSession`（方向无关薄通道）；internal.ts 第二值导出 `openReplicationSessionCoreForRegistry`；`WriteSlot` +'replication'/'replication-apply' | **no-conflict**（解释注记，非演进） | 三处枚举（「两个窄方法」「代理……和 SCHEMA replacement」「唯一导出的」）是 ADR 时点的 **v1 范围陈述**，其规范实质是紧随其后的约束条款而非键集永久冻结；设计保全全部实质：所有新写仍走唯一 sequencer、lease/session 不公开裸 Runtime/DocHandle/Y.Doc/live Yjs 引用（session 冻结七键、`Equal` 断言锁死）、internal subpath 仍仅 Registry 生产代码可消费（import 审计谓词自动放行）、主 entry 零新增（DENY LIST `index.ts`）。**且扩张不源自日志**：ADR-0011 §Interface 禁止的是日志面扩张这些 interface——本票诊断面公共键零新增（diagEnv seam 为 #149 既有），扩张全部来自复制业务面，而业务操作面是任务简报 AC 契约（SA6 15 用例）结构性要求、前置门禁 clear 已涵盖。主线 `b66615c` 已含同款十二键/lease 通道/internal 双导出（实核：`b66615c:runtime.ts`、`errors.ts`），设计为主线决策的本谱系端口。`writeFatalMessage` 既有 'root'/'schema' 渲染逐字节不变（既有子串锚测试保全） |
| 3 | info（钉死 #2 复核） | ADR-0012 amendment C（2026-08-28，规范性，点名 #151）：「任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot **之外**，或在该 slot **已释放之后**；不得在 slot 内执行同步 File adapter `emit`」；ADR-0011 §时序「acceptance 前拒绝在对应公共入口记录」「emitter 不被 `await`」「`notifyDirty` 仍按……原有槽序执行。日志记录 dirty failure，但不替代或包裹 dirty notification」「日志不得引入第二个业务排序机构」 | §3/§6.1/§5.3：enable/bump/apply 三挂点全部 `settled.then(emitSlot)`（槽后微任务）；A 层与 lifecycle 拒绝在公共入口同步段（任何槽之外）；emit 不被 await；E6/R6 仍在槽内原槽位；排序仍由唯一 WriteSequencer 承载 | **no-conflict** | 特别核验 B（专项核验节）：两类别挂点（槽后 / 槽外）均满足 amendment C 的字面析取；`#149` §7.1 微任务序证明对三挂点逐字适用（emit 回调注册晚于 sequencer 内部 `tail.then(noop)`、早于下一任务 thunk）；ADR-0011 四句时序条款逐句核验通过 |
| 4 | info（钉死 #1/#7 复核） | ADR-0011 §Committed update：「日志可携带该 transaction 产生的 owned Yjs update bytes……**日志不能通过事务后编码整个文档来冒充"该次 transaction update"**。底层 transaction 模块应在**不暴露 live Y.Doc** 的前提下返回或投递 owned bytes」；（Consequences）「doc-runtime/**replication transaction seam** 未来需要提供 owned update bytes；该演进不得暴露 live Y.Doc」；ADR-0012 result 判别联合「rejected 与 fatal committed:false 禁止携带 update」；CONTEXT.md「语义 emission」「快照与 updateBytes 所有权移交后不得再变异」「update-omitted 稳定 reason 受控词表（v1）……新增 reason 属词表演进」 | §8/D-6：三处 update 事件订阅窗口（enable/bump E5 `doc.transact`、apply R5 `Y.applyUpdate`）捕获本事务增量；§16 实证防冒充；noop 经 INV-DIAG 显式；本票零 update-omitted 产出；emit 后 producer 零触碰 | **no-conflict** | 特别核验 C（专项核验节）：捕获点在事务 seam 内（非事务后编码）；§16 P2 反向鉴别实证（空 doc 不物化）结构性排除全文档编码冒充；emission 只携带捕获的 `Uint8Array`，live Y.Doc 不经 emitter seam；§9 表全部 rejected 行与 fatal committed:false 行零 update、fatal committed:true 行恒有捕获 bytes；reason 三词表零触碰；窗口 handler 单赋值不抛（ADR-0007 observer 纪律） |
| 5 | info（钉死 #3 复核） | ADR-0012 operation 封闭词表、source/context 形状、result 判别联合；ADR-0011 阶段词表（含「`identity`：复制谱系、epoch 或 namespace identity 不满足」）、「每条结局记录保留所属模块已有的稳定 code、phase、issues 顺序与 committed 事实；日志层不得发明 retryable、rollback 或成功语义」；ADR-0008 稳定码注册修订 5（以定义处 append-only 注册表为准） | §1.1/§9/D-9：三条 operation/source 双向/context 四键/六分支/八阶段全部消费冻结词表；稳定码族主线原值端口零改 message；R-3.2 维持单一注册表；正常路径零 unknown | **no-conflict** | 实核 `vocabulary.ts`（三条 operation、direction 双字面量、context 四可选键、`SourceModule` 含 `'replication'`）与 `pipeline.ts`（cleanContext 字段级清洗、code↔sourceModule 成对性 §10-J3）——设计是纯消费方。epoch 族结局映射：epoch-conflict/fence 族（红灯用例 8，`:644` 锚 `identity`）→ stage `identity` ✓；epoch 上溢（B-f）/无谱系（B-e）→ stage `validation`（§9.2）——两判均在封闭枚举内、零新造，且红灯契约对二者无阶段锚定（grep 实核零命中），不构成与钉死 #3 的冲突（「epoch 不满足」的承载者是 conflict 族；上溢属管理写域不变量拒绝）。**移交 SA2 注意**（非冲突）：B-e/B-f 映射为设计裁决，词表内自洽 |
| 6 | info（钉死 #4 复核） | ADR-0011 §覆盖范围「连接建立、心跳、普通 frame、无 namespace 目标的认证失败等 transport 事实仍属于复制 transport observability，不混入……两者可通过受控 `correlationId` 关联」；（排除面）「普通 read/open 不尝试修改 Y.Doc，不属于变更尝试」 | §5.2/D-4：open/getStatus/close 零 emission 接线（AC5 `emissions.length===2` 锚）；本票 transport 面结构性不存在（fanout 未物化）；correlationId 预留零产出 | **no-conflict** | open 非变更尝试（ADR-0011 排除面原文），设计拒绝为其发记录——与前置钉死 #4 同向；transport 关联面在未物化状态下结构性满足 |
| 7 | info（钉死 #5 复核） | ADR-0011 §产品契约（日志故障零业务影响五款）+ §Interface「不扩张……replication wire interface」 | §3：#149 四道防线全复用（emitAttempt 全吞没 `diagnostic.ts` 既有实现零改动；emit 路径零写 state/fatal/lifecycle；敌意 emitter/容量 drop 隔离）；零 wire interface 新增 | **no-conflict** | 复用 #149 已验收机械（14 用例绿）；本票新增面（host/WeakMap/会话终态机）不在 emit 路径上（§3 第四防线行）；lease/internal 面是 host 内部通道方向、非 wire |
| 8 | info（钉死 #6 复核） | ADR-0012 §manifest「owner、instanceId、replicationId 与 replication epoch **不冻结在 manifest**；适用时由每条记录的受控 context 表达」「日志启用与配置是本地 Host/Registry 旁路状态，**不写入 namespace `SCHEMA`、`META` 或 `ROOT`，也不随 Hub/Peer 复制**」；CONTEXT.md「诊断日志 stream generation」_Avoid_「Runtime generation、**replication epoch**」 | D-7：identity context 全走 per-record `context`；E4 前零 context（零额外读取纪律）；不进 manifest、不作 stream 分代依据；diagEnv 构造注入旁路状态不写 Y.Doc | **no-conflict** | per-record context 落点逐行核验（§9 三表 context 列）；emission 面无 stream/manifest 构造路径（§13.8）；diagEnv 与复制业务写（META 两键/epoch 键的 Y.Doc 变更尝试）分属两个事实面，设计未混同 |
| 9 | info（钉死 #1 输入面/#8 既有面复核） | ADR-0011 §输入捕获（not-accessed / 单快照 / 不重读敌意输入）+ §数据保护「默认不记录……**未经控制的 transport payload**」；ADR-0012 输入投影（gate 前拒绝 not-accessed；快照失败 unavailable/unsafe-input）；CONTEXT.md genesis baseline record「v1 冻结的 emission/sink 公共面无构造路径」 | D-8：apply 槽内一切路径省略 input（raw bytes 非 plain-data 不得作 snapshot；意图由 source+context 表达）；A2 → unavailable；gate 拒绝 → not-accessed；enable E3 单读捕获 snapshot/unsafe-input；bump policy none；零 genesis 构造路径 | **no-conflict** | 输入捕获四形态（not-accessed/snapshot/unsafe-input/unavailable/省略）逐行对照 ADR-0011 §E 与 ADR-0012 投影条款；「未经控制的 transport payload」纪律经「apply 永不快照 raw bytes」结构性满足；emission 公共面零 genesis 路径（DENY LIST 佐证） |

## 特别核验（总控点名四项）

### A. 最小复制业务面物化（§0.2–§0.4 / §12）

**结论：no-conflict。** 物化对象（enable/bump 写槽、会话核心、lease 薄通道、稳定码族、WriteSlot 扩展）在冲突基准内无对应条款（ADR-0010 缺席，前置注记 1/3 已裁定）；前置门禁范围注记明文预期 SA1「显式锚定其所依赖的 replication seam 落点，若依赖未合入，按简报『record any resulting limitation』纪律记录」——设计以三重机制履行：①形状锚定主线 `b66615c` 定义处（实核通过：`b66615c:replication-write.ts` 440 行 / `replication-session.ts` 889 行 / `errors.ts` 码族存在）；②全部偏差显式化（R-3.1/2/3 三仲裁 + L1–L6 六局限 + 合并策略声明「映射表是接线知识的单一真相源」）；③不物化清单收窄爆炸半径（fanout/角色门/会话计数/status 域/reset fence——验收契约零消费）。设计触碰的 ADR 实质条款（0006 dirty 语义、0008 sequencer/槽/fatal/close/status、0009 lease/内部通道）逐条保全（冲突点 #1、#2）。「物化 vs 等待交付票」的范围抉择属任务可行性裁决（总控指令授权），非冲突门禁事项。

### B. 槽后 emit（§3 / §5.3 / §6.1 / §7）

**结论：合规（ADR-0012 amendment C 字面满足）。** 逐挂点核验：

| 挂点 | 时点 | amendment C 判定 |
|---|---|---|
| enable/bump 公共方法 lifecycle≠ready（E-a/B-a） | 公共入口同步段，未入队 | 槽**之外** ✓（ADR-0011「acceptance 前拒绝在对应公共入口记录」同向） |
| apply A1/A2/A3 拒绝 | 会话方法同步段，未入队 | 槽**之外** ✓ |
| enable/bump/apply 槽内结局 | 槽体只写 `SlotDiag`（内存收集器），不发 emit | 不在禁列 ✓ |
| enable/bump/apply 成功/fatal 结算 | `settled.then(emitSlot)` 微任务回调 | slot**已释放之后** ✓（#149 §7.1 微任务序证明逐字适用；`sequencer.ts` enqueue 机械实核） |

emit 不被 `await`（`void settled.then(...)`）；E6/R6 notifyDirty 留在槽内原槽位、不被日志包裹或替代（R-3.1 是业务侧零写仲裁，见 D.1，非日志改变槽序）；排序机构唯一（三操作与 ROOT/SCHEMA 同一 WriteSequencer 实例，无第二排序机构）。

### C. owned bytes（§8 / §16 / D-6）

**结论：合规（ADR-0011 §Committed update + Consequences 逐款满足）。**

1. **seam 归属**：捕获窗口开在 E5 `doc.transact(...)` / R5 `Y.applyUpdate(...)` 调用夹持的 update 事件订阅上——事务 seam 投递的本事务增量，非事务后编码。
2. **防冒充**（「不能通过事务后编码整个文档来冒充」）：§16 P2 实证给出反向鉴别——捕获增量对同源基态链式重放精确物化、对无基态空 doc **不物化**（E1b/E2b/E3b size 全 0）；全文档编码（`Y.encodeStateAsUpdate`）在空 doc 上必物化非零内容，结构性不可冒充。P3：空 diff 集成零事件 ⇒ 捕获 undefined ⟺ noop（A-k/E-g 显式 `committed+noop`）。
3. **不暴露 live Y.Doc**：emission 只携带捕获的 `Uint8Array`；窗口 try/finally 退订在 emit 之前（§13.7），所有权移交后 producer 零触碰（CONTEXT.md「语义 emission」纪律）；emitter 管线 slice 复制（#149 §2.6 既有）。
4. **判别联合**：§9 三表全部 rejected 行与 fatal committed:false 行（E-c/E-f/B-b/A-e/A-f/A-g/A-h/A-i/A-b）零 update；fatal committed:true 行（E-j/E-k/B-h/B-i/A-l(true)/A-m）恒携带捕获 bytes → effect `update`，零 `unknown` 产出；本票零 update-omitted（存储面策略归 SA7，红灯注记 5 同判）——reason 三词表零触碰。
5. **observer 纪律**（ADR-0007）：handler 为单赋值 `if (capturedUpdate === undefined) capturedUpdate = u`，不向事务调用栈抛异常。

### D. 三项仲裁（R-3.1 / R-3.2 / R-3.3，§0.4）

| # | 仲裁 | 裁决 | 依据 |
|---|---|---|---|
| D.1 | **R-3.1** noop apply 跳过 R6 notifyDirty（主线无条件通知，实核 `b66615c:replication-session.ts` R6 段确为无条件 `await notifyDirty()`） | **no-conflict** | 基准内无条款要求零 mutation 的 apply 通知 dirty：ADR-0006「saveDoc 是 **mutation 后**的 dirty notification」——零 mutation 无可通知事实；ADR-0008 槽序条款限定「每个**真正写任务**」——零集成 apply 非真正写任务；ADR-0011「`notifyDirty` 仍按……原有槽序执行」约束的是**日志不得改变**槽序，R-3.1 是业务物化侧对「主线未覆盖场景」的域内仲裁（判据精确：捕获窗口有字节 ⟺ 有集成 ⟺ 通知），方向与主线自身 INV-R3「零写入路径零通知」及 ADR-0006 原则同向，且以 L6 显式登记分歧并建议合并仲裁票——非静默漂移，非演进（无 ADR 条款被修订） |
| D.2 | **R-3.2** apply fatal 码取值 `'NSRT-FATAL-REPLICATION-APPLY-INTERNAL'`（SA6 红灯两处断言 `'...-APPLY-WRITE-...'` 判定为常量名转录笔误） | **no-conflict** | 事实核验：`b66615c:errors.ts:184` 常量名 `FATAL_REPLICATION_APPLY_WRITE_INTERNAL_CODE`、**值** `'NSRT-FATAL-REPLICATION-APPLY-INTERNAL'`——SA6 断言的字面量值从未存在于任何谱系（红灯文件 `:729/:782` 两处断言、`:65` 注释）；设计取主线原值 = 钉死 #3「以其定义处 append-only 注册表为准，零改 message」与 ADR-0008 修订 5 注册表纪律的正面执行；SA6 修订走其报告注记 2 自有协议（`:71`「按合并后既有形状修订（红线不变）」实核存在），断言语义不变 |
| D.3 | **R-3.3** lease.openReplicationSession 方向无关薄通道（剥离主线实例 role 门） | **no-conflict** | role 门无基准条款（ADR-0010 缺席；ADR-0009 的 authorization 条款位于 Registry 之前，role 门是 Phase 5 host 装配关切而非授权）；ADR-0009 实质保全：released 门（`NAMESPACE_LEASE_RELEASED`）+ 输入形状校验 + 既有结果通道，session 不暴露裸 Runtime/DocHandle/Y.Doc；剥离理由（AC1/AC5 双方向用例在同一无 role fixture 上结构性要求）与 L2/L3 局限登记构成完整披露 |

## 结论

**Verdict: `clear`，放行 SA2 全维度攻击评审。** 无 hard-violation、无 override-declared、无 evolution。

- 七条钉死约束全部在设计内落实且经本复审逐条核验（冲突点 #3–#9）；
- 总控点名四项（最小物化 / 槽后 emit / owned bytes / 三项仲裁）专项核验全部通过（特别核验 A–D）；
- ADR-0008/0009 的 v1 公共面枚举（「两个窄方法」/lease 代理清单/internal「唯一导出」）按版本范围陈述解读，实质条款全部保全——该解释已透明记录于冲突点 #2，供 SA2/Jim 复核；
- 移交 SA2 的注意点（非冲突，SA8 不裁优劣）：①§9.2 B-e/B-f（epoch 上溢/无谱系 → validation）为词表内设计裁决，红灯无锚；②R-3.1（L6）跨谱系行为分叉的合并仲裁建议；③SA6 两处字面量修订须按其注记 2 协议由 SA6 自己执行（SA3 禁改断言）。

相关决议文档已追加「设计后复审追加」节（设计引入的新决策点，供 SA2/SA3/SA4/SA7 复用）。

# 冲突门禁报告 — issue #171（前置门禁）

- 被审对象：`wiki/raw/task_issue-171.md`（Phase 5 follow-up：close namespace lifecycle races across connection generations；bugfix）
- 冲突基准：`docs/adr/` 全集 10 份（逐个全文读取，无抽样）+ `CONTEXT.md`
- 产出：本报告 + `task_issue-171_relevant_decisions.md`（全链 SA 复用约束清单）
- Worktree：`/home/wangjian/nomicore-fix-issue-171`；run_id `issue-171-1788042048-447205`；round 1

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致（含 #134/#133/#161 修订节） | accepted | 是（核心） | no-conflict：任务七项 Scope 全部是 ADR-0010 既有条款（L90/L143/L147/L151/L179）与 #161 修订节（代际安全脱离、同步静默订阅先于异步 drain）的竞态收口实现，无条款被推翻或实质修订 |
| ADR-0009 | NamespaceRegistry、调用方租约与 Host 生命周期（含 #131/#134 修订节） | accepted | 是 | no-conflict：任务 Scope 2 的旧清理不得跨代际清除新资源 = L32 generation 纪律的 ws-replication 层落实；立即释放/幂等释放与 L42/L44/L150 一致；release 后进 idle（L48）不被违背 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器（含 #93/#132 修订节） | accepted | 是 | no-conflict：任务清理路径不取消已接纳槽（与 L93 close barrier 无条件排空、#134 修订节「已接纳 apply 槽无条件排空」同向）；不触碰 status/稳定码面 |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted（Runtime/open/read 条款已被 ADR-0008 取代） | 弱 | no-conflict：被取代条款不构成约束；保留有效条款（零写入、observer no-rollback）零接触 |
| ADR-0006 | Cordis 持久化插件与 doc 三条目布局（含 #64/#79/#133 修订节） | accepted | 弱 | no-conflict：任务不改持久层；lease/handle 引用计数语义（L32）仅作清理路径背景，无违反 |
| ADR-0001 | VFSL 单一真相源 | accepted | 否 | no-conflict：不触及 schema 来源/方言/投影 |
| ADR-0002 | nomicore 重写定位、authority 出范围 | accepted | 否 | no-conflict：未长出任何 authority 语义 |
| ADR-0003 | 求值器与派生 schema | accepted | 否 | no-conflict：不触及求值/ROOT 约定 |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | no-conflict：零交集 |
| ADR-0005 | 投影生成管线 | accepted | 否 | no-conflict：零交集 |

无整份 superseded 的 ADR；分条取代关系（0007←0008、0009 复合 key←0010、0006 创建语义←#64 修订节）均已按「被取代条款不构成约束」处理，且本任务未与任何被取代条款发生需要援引的冲突。

## 冲突点

（verdict 为 clear：下列为逐条对照记录，全部 no-conflict；0 hard-violation / 0 evolution / 0 override-declared）

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | — | ADR-0010 L151「连接断开即close sessions/release Leases，不保留outbox」；L90「channel 关闭先关闭 session，再释放 Lease」；ADR-0009 L42「首次 release() 在调用栈内同步标记 released……重复 release 返回 exact same Promise」 | Scope 1：Hub 连接静默后，迟到 authorize/open/session 续体以 closing/静默为 abort，新获 lease/session 立即释放，不补发 OPEN_OK/bootstrap | no-conflict | 任务是该恢复纪律在「迟到续体」窗口的收口（此前实现存在竞态漏网），方向与条款逐字同向；立即释放走幂等 release/close 既有机制，非新语义 |
| 2 | — | ADR-0009 L32「旧异步操作只能按 entry identity/generation 清理自己，不得删除后来建立的新 entry」；ADR-0010 L143「同一连接内同一 namespace只允许一个生命周期，关闭后重开必须重建连接」 | Scope 2：peer 排队清理携带 generation、session/lease 与退订所有权；旧 `cleanupTail` 不得为新连接代际退订或清资源 | no-conflict | generation 所有权隔离是 L32 纪律在 ws-replication 层的直接移植；「重开必须重建连接」即不同 connection generation，两者互相印证 |
| 3 | — | ADR-0010 L151 恢复纪律；#161 修订节「peer pong 超时 close(1001) + 代际安全脱离后重连」；ADR-0008 L93「此前已接纳任务无条件排空，不取消、不设内部 timeout」；ADR-0010 #134 修订节 L246/L271「已接纳 apply 槽无条件排空」「close() 永不 reject」 | Scope 3：`onConnectionLost()` 全分支（含 closing、failed）完成 generation 安全清理：listener、session、lease、watchdog、round、ACK timer、channel state | no-conflict | 「代际安全脱离」是 #161 修订节已登记决策词汇，本任务是其全分支补全；清理列举的是连接域资源，未提议取消已接纳 Runtime/apply 槽——与无条件排空纪律无触碰（SA1 落实时须保持该边界，见结论注 1） |
| 4 | — | ADR-0010 L35「removeTarget 停止同步并释放复制 lease，但保留本地持久副本」；L179「不无限等待网络 ACK」 | Scope 4 / AC3：`removeTarget()` 仅当 CLOSE_NAMESPACE 取得正 sequence 且已上网才等 CLOSE_OK；发送被抑制时本地清理并立即结算（不等 `closeTimeoutMs`） | no-conflict | ADR 只定义 removeTarget 的资源语义（停同步、释 lease、留本地副本），未规定 CLOSE_OK 等待时序——wire 时序唯一权威被 L151 指定为协议文档（非门禁基准）；「不上 wire 即不等」与 L179「不无限等待网络 ACK」同向收紧 |
| 5 | — | ADR-0010 L147「gap、repeat或错误ACK关联关闭连接」 | Scope 5 / AC4：伪造/过期/错配 CLOSE_OK 产生显式错误与关闭行为，不静默完成、不无限悬挂 | no-conflict | 「错误ACK关联关闭连接」是该要求的直接 ADR 依据；任务是对该条款的忠实落实，非修订 |
| 6 | — | ADR-0010 L147「GOAWAY提供相对drain timeout」；#161 修订节「GOAWAY/blocked/连接收口同步静默订阅先于异步 drain」 | Scope 6 / AC5：GOAWAY SERVER_RESTARTING/SHUTTING_DOWN 按协议时序同步静默订阅；deadline 只管 transport close，不推迟 namespace 静默 | no-conflict | 「同步静默订阅先于异步 drain」是 #161 修订节明文登记决策；「drain timeout 管连接侧」与 L147 的 GOAWAY 定位一致，任务未改变 drain timeout 的归属面 |
| 7 | — | （无对应 ADR 条款——ADR-0010 L173–174 只约束 `@nomicore/ws-replication` 的包职责面，不约束包内抽象归属） | Scope 7：评估 Hub `LifecycleQueue` 与 Peer memoized promise + `cleanupTail` 的生命周期权威性；统一语义或分别定责并移除死抽象 | no-conflict | 包内部抽象的统一/移除属实现组织决策，ADR 全集无条款触碰；不越 ADR-0008 L93/#134 排空与 L90 session→lease 次序等行为边界即可 |
| 8 | — | ADR-0009 L42/L44；ADR-0010 #134 修订节 L246（release 同步段调用活跃 session close；幂等 same-promise） | AC1/AC2：迟到续体不得复活旧 namespace 或清除新代际 listener；每个已获取 lease/session 恰一次释放，无订阅/watchdog/round/ACK timer/channel-state 泄漏 | no-conflict | 「恰一次释放」的语义载体即幂等 same-promise 机制（重复调用返回同一结算）；泄漏收口与「连接断开即 close sessions/release Leases」同向 |

## 结论

**Verdict：clear。放行。** 0 条冲突点：8 项对照全部 no-conflict，
0 hard-violation、0 evolution、0 override-declared。任务简报没有声明推翻任何 ADR，
也没有任何条目实质构成对既有决策的修订——它是对 ADR-0010（含 #161 修订节
「代际安全脱离」「同步静默订阅先于异步 drain」）与 ADR-0009 L32 generation 纪律的
竞态修复落实。无需 override，无需 Jim 裁决条目。

给下游 SA 的三点边界注记（均为既有条款的重申，非新约束）：

1. **清理不得取消已接纳槽**：Scope 3 的 generation 安全清理只作用于连接域资源
   （listener/session/lease/watchdog/round/ACK timer/channel state）；已被 Runtime
   接纳的写与 apply 槽按 ADR-0008 L93 与 ADR-0010 #134 修订节无条件排空、不取消。
   SA1 设计清理路径时不得把「abort 迟到续体」外溢为「取消已接纳任务」。
2. **释放次序与幂等**：channel 关闭先关闭 session 再释放 Lease（ADR-0010 L90）；
   release/close 均幂等 same-promise（ADR-0009 L42、ADR-0010 修订节 L246）——
   「恰一次释放」以此机制兑付，不得发明新的释放语义。
3. **术语纪律**：connection generation ≠ CONTEXT「复制代际（replication epoch）」
   （后者只由 Hub 显式提升、存于 META.replicationEpoch）；两者在设计中不得混用词汇。

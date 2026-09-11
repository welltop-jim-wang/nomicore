# SA8 冲突门禁报告 — issue #270 Server 集成验收：REST 与 WebSocket 共享 Registry + 有序停止

- 被审对象：issue #270（GitHub Issues，`gh api` REST 读取全文；标题「Server 集成验收：REST 与 WebSocket 共享 Registry + 有序停止」）
- 冲突基准：`docs/adr/` 全集 0001–0012、0014、0015（无 0013；全量逐份读取）+ `CONTEXT.md`；停机语义按 ADR 0010 L179 明文并入（「停止与重连语义以 `docs/protocols/instance-replication-v1.md` §21 为权威」——下称 protocol §21，引用格式 §n；ADR 0010 issue #172 修订节 L321 重申「composition root 只按 protocol §21 编排包级停机顺序」）
- 门禁类型：Phase 0 前置门禁（SA 派发前）
- 审查日期：2026-09-11 基线（branch `mabf/issue-270`，HEAD = `0b06050`，即 #267 经 PR #296 合入的 REST router 骨架提交）
- Issue comments：dispatch 前 REST 读为空 `[]`——无 owner feedback 适用项；owner requirements：Issue body 之外无附加。SA8 只读裁决，未改动任何被审文件（本报告为唯一新增产物）
- 技能加载注记：`sa8-conflict-gate` 技能在本环境技能目录（`.agents/skills/`）中不存在（skill 工具返回 unknown）——本报告按 SA8 章程（冲突基准只有 ADR 全集 + CONTEXT.md；被 superseded 的 ADR 不构成约束；代码与 wiki 其他文档不构成自动阻塞依据）独立执行

## Verdict

**`clear`** —— 无冲突、前置就绪，可放行 SA 派发。

裁决分布：**0 条 hard-violation、0 条 evolution（需 override）、0 条 override-declared、6/6 要求项 no-conflict**；另有 3 条
advisory 设计裁决点（A1–A3，移交 SA1，均不构成对 Issue 的阻塞）与 1 条文档状态注记（ADR 0015 = 提议态，见「ADR 0015
状态注记」）。

一句话理由：issue #270 的四条验收标准是 ADR 0015 自带条款的**逐字执行**——L20（composition root 注入并共享同一
`NamespaceRegistry` 引用、核心 Module 不读 Cordis Context、不运行时替换）、L32（server 先按 raw path 选择 REST 与
WebSocket route family）、L210（「server集成验收验证REST与WebSocket Module确实共享同一个Registry引用，并按顺序停止
intake、等待已接纳REST/WS工作、释放Lease/Session，再shutdown Registry与Persistence」——Issue 停止顺序句的直接来源）、
L232（「WebSocket Module不依赖REST create，而是直接使用Registry/Lease/ReplicationSession」）——并与 ADR 0009 的单
Runtime/单 sequencer 安全不变量、ADR 0012 的最终服务所有权与 teardown 顺序、protocol §21 六步停机梯子完全同构。
前置阻塞 #267 已关闭（closed，经 PR #296 合入，即本分支 HEAD），Parent 集成 PR #158 OPEN → 基线分支
`docs/rest-namespace-create`。Issue 没有任何一条要求修订、绕过或取代 ADR/CONTEXT 冻结条款。

## 前置就绪（prerequisite readiness）

| 项 | 事实（REST 实证） | 结论 |
|---|---|---|
| `Blocked by: #267` | `gh api .../issues/267` → state **closed**，labels `ci-passed`，标题「REST router 骨架：Hub create 成功路径 + Peer role gate + Lease 生命周期」；其实现经 PR #296 合入 = 本 worktree HEAD `0b06050` | **就绪**（blocker 已关闭；`gh issue view` 的 GraphQL projectCards 弃用错误与 native dependencies API 404 均为工具面噪声，body 行 `Blocked by: #267` 是 issue-tracker 文档认可的 fallback 表示，指向唯一且已关闭的 blocker） |
| `## Parent: PR #158` | `gh pr view 158` → state **OPEN**，head `docs/rest-namespace-create`，base `main`，标题「Vertical REST namespace create and content-addressed schema ID」 | 集成 PR active → 按 issue-tracker 约定（`## Branch` > `## Parent` > `main`），实现落 `docs/rest-namespace-create` 支；本 worktree 已基于其上游提交 |
| Issue comments | dispatch 前 REST 读为 `[]` | 无附加 owner 要求；冲突面只按 Issue body 审 |
| 标签 | `in-progress`（非 5 个 canonical triage 标签之一） | 观察项，非 ADR/CONTEXT 冲突面——SA8 无权按标签阻塞（MABF 派发态标记，总控自理） |

## ADR 盘点（全量 14 份 + CONTEXT.md）

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 单一真相源 | accepted（含 2026-08-19/08-21 修订） | 否 | schema 语言域，不触及 server 组装 |
| 0002 | 重写定位、authority 出范围 | accepted | 否 | 范围界定，无涉 |
| 0003 | 求值器与派生 schema | accepted | 否 | 无涉 |
| 0004 | vfsl-protocol 类型投影 | accepted | 否 | 编译期投影域，无涉 |
| 0005 | 投影生成管线 | accepted | 否 | 无涉 |
| 0006 | Cordis 持久化插件 | accepted（#64/#79/#131 对齐/#133/#228 修订节） | 低 | L86：dispose 时「宿主负责按依赖逆序停止插件」、Persistence 内部 timer 绑定 Host root Context 使依赖方排空期间已接纳写仍可完成 dirty notification——与 Issue 停止顺序兼容；本 issue 不触碰 saveDoc/degraded/import/archive/delete 语义 |
| 0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（Runtime/open/read 条款被 0008 部分取代） | 否 | 被取代部分不构成约束；#237 修订节（边界级校验）与本 issue 无涉 |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（#93/#132/#237 修订节） | 低 | L40 单一 write sequencer 是「同一 namespace 只有一个 Runtime 与一个 write sequencer」验收的底层依据；L99 close barrier「已接纳任务无条件排空」支撑「等待已接纳工作 settle」 |
| 0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（#131/#134/#228 修订节） | **核心** | L8：分别构造 Runtime 会产生多 sequencer、破坏 FIFO 安全不变量（Issue 共享 Registry 要求的原始动机）；L118：REST、WS 和管理任务共享一个安全生命周期入口；L99–103 Shutdown 语义与 Registry 先于 Persistence；L16 `ctx.nomicoreRegistry` 与「不经 Cordis Context 查找」分层相容（见对照表 R1/R5） |
| 0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（#134 两轮 / #133 / #161 / #172 / #238 / #237 / #254 修订节） | **核心** | L73–79/L177：`lease.openReplicationSession` 受信集成入口、第三方 Host 可直接基于公开 NamespaceLease/ReplicationSession 构造自己的可信 transport（WS Module 直接使用 Registry/Lease/ReplicationSession 的依据）；L90「channel 关闭先关闭 session，再释放 Lease」；L151/L179/L321：停机语义以 protocol §21 为权威、composition root 只按 §21 编排包级停机顺序；L175：`apps/yjs-server` = 最小 Cordis composition root 装配 Clock、Timer、Persistence、Registry、WS replication 与优雅停机 |
| 0011 | Best-effort namespace 诊断变更日志 | accepted（#228 澄清性修订节） | 低 | L129：Host shutdown 可 best-effort drain 日志，但 Registry/Persistence 的停止不得无限等待日志 sink——对 Issue 停止顺序的边界约束（兼容，见 A3） |
| 0012 | 实例身份单一真相与 WebSocket plugin 所有权 | accepted | **核心** | L5/L33：composition root 拥有 Instance、Clock、Timer、Persistence 与 Registry 的创建与最终 teardown，显式组装 Instance → Clock/Timer → Persistence → Registry → role-specific WebSocket plugin；L19/L37：WS plugin Fiber dispose 只 drain/close 自身资源，不调用 Registry shutdown 或 Persistence dispose，上游随后按 Registry → Persistence → Timer/Clock 释放——与 Issue「server 编排停止顺序、最后 shutdown Registry 与 Persistence」同构；L29 被否决方案见对照表 R4 |
| 0014 | VFSL 校验 JSONL 与 framed sidecar 日志 | accepted（2026-08-28 首切片 amendment） | 低 | 停机面仅「不无限等待日志 sink」（验收门槛 13）——与 A3 同条；其余为日志存储域，无涉 |
| 0015 | 纵向 REST namespace create 与内容寻址 schema ID | **提议**（ rides OPEN 集成 PR #158） | **核心** | Issue 全部四条 AC 的直接来源：L20、L32、L210、L232（逐字）；状态注记见下节 |
| CONTEXT.md | 术语与惯例 | — | 中 | 「写序列器」（每 Runtime 独有严格 FIFO）、「namespaceId」（Registry 进程内只以 namespaceId 排他索引）、「ReplicationSession」（Lease 打开的受信 duplex 会话；host 只把该高级能力交给可信 transport）、「实例角色」——均与 Issue 要求同向，无触碰 |
| protocol | instance-replication-v1 §21（ADR 0010 并入的停机权威） | 已接受 | **核心** | 六步停机梯子：① replication 停止接纳连接/target + 直接 WS 1001 关闭 Hub transport（#229 临时措施）→ ② namespace 停止新 frame、排空已接纳 apply → ③ close sessions 并 release replication leases → ④ Registry shutdown → ⑤ Persistence dispose → ⑥ Timer/Clock 停止——Issue 停止顺序的展开形态 |

## 要求项对照表（Issue body 四条 AC + 交付范围 + 前置）

| # | 任务要求 | 基线冻结条款（出处） | 裁决 |
|---|---|---|---|
| R1/AC1 | 集成测试证明 REST 与 WebSocket Module 持有同一个 `NamespaceRegistry` 引用（同一 namespace 进程内只有一个 Runtime 与一个 write sequencer） | ADR 0015 L20 逐字：「composition root 构造 REST 与 WebSocket Module时注入并共享同一个 `NamespaceRegistry` 引用」；ADR 0009 L8（多 sequencer 破坏「同一 namespace 的所有受控写严格 FIFO」安全不变量）+ L118；CONTEXT.md「写序列器」「namespaceId」 | **no-conflict**（要求实现契约已承诺的行为；共享 Registry 正是安全不变量的实现形态） |
| R2/AC2 | 不经 Cordis Context 查找、不运行时替换 | ADR 0015 L20 逐字：「核心 Module 不读取 Cordis Context，不按请求或消息重新查找 Registry，也不在运行时静默替换 Registry」；与 ADR 0009 L16（Registry Cordis plugin 经 `ctx.nomicoreRegistry` 提供 service）分层相容：service 暴露面面向 Cordis 宿主（DSH），Host 无关 Module（REST router 非 Cordis plugin，ADR 0015 L18–20）由 composition root 取得引用后直接注入——两层无矛盾，ADR 0015 L230 明文本 ADR「不取代 ADR 0008、0009或0010」 | **no-conflict** |
| R3/AC3 | raw path 正确分流 REST 与 WebSocket route family | ADR 0015 L32 逐字：「server 先按 raw path 选择 REST 与 WebSocket route family；REST router 不拥有 listener、authentication、authorization、CORS、TLS、Request ID、全局并发或 graceful drain」 | **no-conflict** |
| R4/AC4 | 停止顺序被验证：停止 intake → 等待已接纳工作 → 释放 Lease/Session → shutdown Registry 与 Persistence | ADR 0015 L210 逐字（server 集成验收句，与 Issue 停止顺序句逐词对应）；ADR 0012 L19/L37（WS plugin dispose 只收自身资源，不调 Registry shutdown/Persistence dispose；上游按 Registry → Persistence → Timer/Clock 释放）；ADR 0009 L99–103（shutdown 同步停接纳、等待已接纳 lifecycle 操作结算、close 全部 Runtime、Cordis 依赖图保证 Registry 先于 Persistence 停止）；protocol §21 六步梯子（①停接纳/关 transport ②排空已接纳 apply ③close sessions + release leases ④Registry shutdown ⑤Persistence dispose ⑥Timer/Clock）；ADR 0006 L86（宿主按依赖逆序停止插件） | **no-conflict**（Issue 顺序是 §21 梯子的 server 级投影；「先释放 Lease 再 shutdown Registry」严于 ADR 0009 L99「shutdown 不等待外部 lease release」——更严格的编排不构成冲突） |
| R5/AC5 | WebSocket Module 不依赖 REST create，仍直接使用 Registry/Lease/ReplicationSession | ADR 0015 L232 逐字：「WebSocket Module不依赖REST create，而是直接使用Registry/Lease/ReplicationSession。二者由composition root共享同一个Registry引用与server lifecycle」；ADR 0010 L73–79（`lease.openReplicationSession` 高级受信任集成入口，Host 搭建方负责只把 Lease 交给可信代码）+ L177（第三方 Host 可直接基于公开 NamespaceLease/ReplicationSession 构造自己的可信 transport）；CONTEXT.md「ReplicationSession」 | **no-conflict**（受信消费与 ADR 0012 L29 被否决项「WebSocket plugin **暴露** raw Registry、ReplicationSession 或 live Y.Doc」不同域——后者禁的是 plugin 公共 service 面向外暴露裸能力，非内部受信消费；Server 侧 WS Module 是 composition root 接线的受信消费方） |
| R6 | 交付范围：本票基于骨架 router 即可落地，不等待完整错误契约与 observer 行为；后续 ticket 叠加的 router 行为不得破坏本验收 | ADR 0015 自身把「server 集成验收」单列为测试决策（L210），与 §错误契约/§Observability 的完整交付正交；增量切片在 active 集成 PR #158 内累积属 issue-tracker 约定的既定流程；「不得破坏本验收」条款钉住 ADR 0015 合同的最终收敛 | **no-conflict**（切片序不构成对终态合同的偏离承诺；但构造期义务不随切片豁免——见 A2） |

无任何要求项要求新增 wire 帧、改 envelope/错误码注册表、改 Registry/Runtime 公共 interface、触碰 SCHEMA/META 权限或
identity/epoch 语义——**本票可以零契约变更交付**（纯 server 组装 + 集成测试）。

## 冲突点

| # | 严重度 | 基线条款 | 被审对象表述 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | 无（措辞注记 → SA1） | ADR 0010 L90 + protocol §21 第 ③ 步：「close sessions 并 release replication leases」「channel 关闭先关闭 session，再释放 Lease」 | Issue 停止顺序写作「释放 Lease/Session」——命名该对偶，未规定对内次序 | **no-conflict（advisory A1）** | 实现按 §21/ADR 0010 保持「先 close session、后 release Lease」次序即可；Issue 措辞是集合式列举非次序主张，不构成冲突。移交 SA1 在集成测试断言次序 |
| 2 | 无（构造期义务存续注记） | ADR 0015 §Observability L186：「构造时必须显式注入两个同步 void observer；传 no-op 也必须是显式决定」 | Issue「不等待完整错误契约与 observer **行为**」 | **no-conflict（advisory A2）** | Issue 豁免的是 observer **行为**的验收等待，不是 composition root 构造 REST Module 时的注入义务；骨架路由（#267）已带该注入面。SA3 实现不得因切片省略显式注入 |
| 3 | 无（停机有界性注记） | ADR 0011 L129 / ADR 0014（验收门槛 13）：Host shutdown 可 best-effort drain 日志，但 Registry/Persistence 的停止不得无限等待日志 sink | Issue 停止顺序未提及诊断日志 drain | **no-conflict（advisory A3）** | 停机编排须把日志清理保持为 O(1)/best-effort 位置（app 级契约 `apps/yjs-server/AGENTS.md`：单条 disposal 链 replication drain → registry shutdown → diagnostics O(1) close → persistence dispose → timer/clock teardown，且「Never trigger a second concurrent teardown chain」）；模块级文档非 SA8 阻塞基准，但其形态与 ADR 0012 L37/§21 相容 |
| 4 | 无（文档状态注记，非冲突） | ADR 0015 头部「状态：提议」（非已接受）；rides OPEN 集成 PR #158 | Issue #270 全文逐字实施 ADR 0015 L20/L32/L210/L232 | **no-conflict（状态登记）** | 两种读法下均无冲突：(a) 提议态 ADR 作为在途阶段规格（issue-tracker 约定：阶段设计 PR 转任集成 PR、ticket 挂其下——Issue 的 `## Parent` 正是 PR #158），Issue 实施其条款 = 同向；(b) 若仅认已接受 ADR 为约束，则该要求面无既定约束，亦无违反。ADR 0015 未被 superseded，且 L230 明确不取代 0008/0009/0010；其与已接受 ADR 0006/0008/0009/0010/0012 的组装相容性已逐份核验（见盘点表）。PR #158 合入 main 时状态自会收敛，不构成本票阻塞 |

无 hard-violation、无 evolution（需 owner override 的修订）、无 override-declared、无待 owner 裁决项。

## 实证核验（前置事实，非阻塞依据）

| 主张 | 证据 | 结论 |
|---|---|---|
| Issue #270 全文与元数据 | `gh api repos/welltop-jim-wang/nomicore/issues/270`：state open、labels `[in-progress]`、assignees `[]`、body 含 Parent/AC×4/Blocked by #267；dispatch 前 comments REST 读为 `[]` | ✓ |
| Blocker #267 已关闭 | `gh api .../issues/267` → `{"state":"closed","labels":["ci-passed"],...}`；其骨架 router 已在 `packages/namespace-api/src/rest.ts` / `create-namespace.ts` 落地（本分支 HEAD `0b06050`「fix(#267): REST router 骨架…(#296)」） | ✓（前置就绪） |
| Parent 集成 PR active | `gh pr view 158` → OPEN，head `docs/rest-namespace-create`，base `main` | ✓（基线分支确定） |
| 组装面已存在 | `apps/yjs-server/src/`（app.ts/config.ts/lifecycle.ts/shutdown-watchdog.ts/transport.ts/…）；`apps/yjs-server/AGENTS.md` 声明 Hub/Peer composition root 角色与单条 disposal 链 | ✓（代码现状非阻塞基准，仅证实现挂点存在） |
| ADR 引文逐字性 | L20/L32/L210/L232 均自 `docs/adr/0015-vertical-rest-namespace-create.md`（HEAD `0b06050`）直接读取核对 | ✓ |

## 结论

**`clear`，放行 SA 派发。** issue #270 是 ADR 0015 自带「server 集成验收」测试决策（L210）与装配条款（L20/L32/L232）的
逐字落地票：共享 Registry 引用直接兑现 ADR 0009 的单 Runtime/单 sequencer 安全不变量；停止顺序与 ADR 0012 最终服务
所有权、ADR 0009 Shutdown、protocol §21 六步梯子同构；WS Module 直接使用 Registry/Lease/ReplicationSession 落在
ADR 0010 受信集成入口的既定边界内。前置 #267 已关闭，Parent PR #158 OPEN 指定基线分支 `docs/rest-namespace-create`。
零契约变更即可交付。

移交 SA1 的已知裁决点（均非冲突）：**A1** 停止顺序对内次序按「先 close session、后 release Lease」断言
（ADR 0010 L90 / §21 ③）；**A2** REST Module 构造期两个 observer 的显式注入义务不因「不等待 observer 行为」豁免
（ADR 0015 L186）；**A3** 停机编排保持日志清理 O(1)/best-effort、单条 disposal 链（ADR 0011 L129、ADR 0014 验收
门槛 13；app 级 AGENTS.md 同款）——不得在 Registry/Persistence 停止上引入对日志 sink 的无限等待，也不得触发第二条
并发 teardown 链。

## 附录 A：相关决议摘录（全链 SA 复用，只摘不裁）

> 引用行号为当前基线（HEAD `0b06050`）行号；protocol 以 §n 引用。

**ADR 0015 L18–20（模块与装配）**：「建立 `@nomicore/namespace-api`，REST Adapter 由 `@nomicore/namespace-api/rest`
暴露。……REST router 是 Host 无关的普通 Module，不是 Cordis plugin。composition root 构造 REST 与 WebSocket
Module时注入并共享同一个 `NamespaceRegistry` 引用。核心 Module 不读取 Cordis Context，不按请求或消息重新查找
Registry，也不在运行时静默替换 Registry。」

**ADR 0015 L32**：「router 使用标准 Web `Request → Response` 接口，并以判别结果表达 route 是否匹配。server 先按
raw path 选择 REST 与 WebSocket route family；REST router 不拥有 listener、authentication、authorization、CORS、
TLS、Request ID、全局并发或 graceful drain。」

**ADR 0015 L210（测试决策）**：「server集成验收验证REST与WebSocket Module确实共享同一个Registry引用，并按顺序停止
intake、等待已接纳REST/WS工作、释放Lease/Session，再shutdown Registry与Persistence。」

**ADR 0015 L232（取代与关联）**：「server的REST route依赖本Module；WebSocket Module不依赖REST create，而是直接使用
Registry/Lease/ReplicationSession。二者由composition root共享同一个Registry引用与server lifecycle。」

**ADR 0009 L8**：「若 REST、WS 或管理任务分别从 Persistence 加载 handle 并构造 Runtime，同一个 live Y.Doc 会出现多个
sequencer，破坏『同一 namespace 的所有受控写严格 FIFO』这一安全不变量。」**L118**：「同一namespace的所有受控写保持
唯一Runtime和唯一sequencer；REST、WS和管理任务共享一个安全生命周期入口。」**L99–103**：「shutdown 取消全部 idle
timer，等待此前已接纳的 lifecycle 操作结算，然后主动 close 全部 active/idle Runtime，不等待外部 lease
release。……Cordis依赖图保证 Registry先于Persistence停止。」

**ADR 0012 L5**：「Standalone yjs-server 继续作为上层 composition root，显式组装 Instance → Clock → Timer →
Persistence → Registry → role-specific WebSocket plugin。」**L19**：「Fiber dispose 只 drain/close WebSocket plugin
自身资源并撤 service；上游 Registry/Persistence 生命周期由其拥有者处理。」**L37**：「WebSocket plugin Fiber dispose
先停止自身网络接纳并 drain/close controller，再撤自身 service；它不调用 Registry shutdown 或 Persistence dispose。
上游资源随后由 composition root 按 Registry → Persistence → Timer/Clock 的顺序释放。」

**ADR 0010 L73–79**：「`NamespaceLease` 正式增加高级受信任集成入口：`lease.openReplicationSession(options)`……所有
Lease 都可调用该入口，不设置不可伪造 capability；Host 搭建方负责只把 Lease 交给可信代码。」**L90**：「Lease release
同步停止 session 接纳；channel 关闭先关闭 session，再释放 Lease。」**L175**：「`apps/yjs-server`：最小 Cordis
composition root，装配 Clock、Timer、Memory/File Persistence、Registry、WS replication、配置加载和优雅停机。」
**L179**：「停止与重连语义以 `docs/protocols/instance-replication-v1.md` §21 为权威。」

**protocol §21（停机顺序，节选）**：「1. replication停止接纳连接/target，并直接以 WS 1001 关闭 Hub transport……
2. namespace停止新frame，排空已接纳apply；3. close sessions并release replication leases；4. Registry shutdown；
5. Persistence dispose；6. Timer/Clock停止。……不得从 notifier 或 sequencer 槽内 await Runtime close、Lease release
或 Registry shutdown。」

**ADR 0011 L129**：「adapter 慢、失败或队列满都不得延长 write slot 或阻塞 close/shutdown；Host shutdown 可
best-effort drain 日志，但 Registry/Persistence 的停止不得无限等待日志 sink。」

**CONTEXT.md「写序列器」（节选）**：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc
写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。」

**CONTEXT.md「ReplicationSession」（节选）**：「由 NamespaceLease 打开的受信任 duplex raw Yjs 复制会话……host
负责只把该高级能力交给可信 transport。」

# SA8 冲突门禁报告 — issue #254 ws-replication：reconcile 超时 failed/needs-resync 僵尸与自愈

- 被审对象：`wiki/raw/task_issue-254.md`（issue #254 任务简报，AC1–AC6 + 契约冲突节 + 确定性回归场景）
- 冲突基准：`docs/adr/` 全集 0001–0012（全量逐份读取）+ `CONTEXT.md`；wire 语义按 ADR 0010 L151 明文并入（「连接与namespace状态、消息码、payload字段、错误码、timeout、close code、backpressure和完整时序以 `docs/protocols/instance-replication-v1.md` 为唯一wire contract」——下称 protocol，引用格式 §n）
- 门禁类型：Phase 0 前置门禁（SA 派发前）
- 审查日期：2026-09-07 基线（branch `mabf/issue-254`，HEAD = 6a005a4）
- Issue comments：REST 读为空——无 owner feedback 适用项；SA8 只读裁决，未改动任何被审文件

## Verdict

**`clear`** —— 无冲突，可放行 SA 派发。

裁决分布：**0 条 hard-violation、0 条 evolution、0 条 override-declared、6/6 AC no-conflict**；另有 5 条
advisory 设计裁决点（D1–D5，移交 SA1，均不构成对简报的阻塞）。

一句话理由：issue #254 的全部验收标准是对既有决议自带恢复纪律的**回归执行**——protocol §1 不变量 4、
§9.4 pending-resync 合并规则、§13.2 `NAMESPACE_TIMEOUT → failed(reconnect)`、§16 `failed` 等待连接重建、
§15.1 自动 backoff 重拨——简报没有任何一条要求修订、绕过或取代 ADR/CONTEXT 冻结条款，反而以 AC3 显式
钉住最容易被修坏的不变量（同一连接内终态 namespace 不重开）。真正的病灶是**基线文本自身的未指明缺口**
（failed channel + 仍存活连接 + 仍活跃 target 时，谁触发 §16 所述的「连接重建」无处落笔），以及当前实现
把该缺口走成了死局；两个修复方向（A：failed + 触发连接重建；B：非终态恢复 round）中 A 完全落在现行
条款内，B 需要显式 protocol 修订——简报对两者保持开放，故不构成简报级冲突。

## ADR 盘点（全量 12 份 + CONTEXT.md）

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 单一真相源 | accepted（含 2026-08-19 修订） | 否 | schema 语言域，不触及 ws-replication 状态机 |
| 0002 | 重写定位、authority 出范围 | accepted | 否 | 范围界定，无涉 |
| 0003 | 求值器与派生 schema | accepted | 否 | 无涉 |
| 0004 | vfsl-protocol 类型投影 | accepted | 否 | 编译期投影域，无涉 |
| 0005 | 投影生成管线 | accepted | 否 | 无涉 |
| 0006 | Cordis 持久化插件 | accepted（#64/#79/#133 修订节） | 低 | 本 issue 不触碰 saveDoc/degraded/import/archive 语义；恢复路径若触发断线，Persistence 行为按既有条款不变 |
| 0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（Runtime/open/read 条款被 0008 部分取代） | 低 | 被取代部分不构成约束；raw apply 无 VFSL 预校验（replication-unvalidated）与本 issue 无涉 |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含稳定码注册修订） | 低 | 「已接纳 apply 无条件排空」纪律（AC4）的 sequencer 层先例；本 issue 不改槽序 |
| 0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted | 低 | Lease/session 生命周期释放（AC4）落在 ADR 0010 L90 的既有编排，Registry 层无新义务 |
| 0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（#134 两轮 / #133 / #161 / #172 / #238 修订节） | **核心** | 全部 6 AC 的直接依据；L151 把 protocol 并入为唯一 wire contract；L179（issue #229）确立 Peer 重拨所有权；L165「普通超限关单 channel」仅辖资源超限域，不辖 timeout 域 |
| 0012 | 实例身份单一真相与 WebSocket plugin 所有权 | accepted | 中 | L36：Peer plugin 拥有 dial loop 与连接——本地发起的连接重建属 Peer plugin 既有所有权边界内，无越权 |
| CONTEXT.md | 术语与惯例 | — | 中 | 「ReplicationSession」（fanout 溢出 sticky needs-resync，transport 须 reset/bootstrap）与 ws-replication channel 级 `needs-resync` 是**两个不同域**，见 D4；「实例角色」「复制谱系/代际」词条未被触碰 |
| protocol | instance-replication-v1（ADR 0010 规范 wire contract） | 已接受 | **核心** | §1.4 / §9.4 / §13.2 / §15.1 / §16 / §17 / §18 / §21 逐条对照见下；无 superseded |

## AC 对照表

| AC | 任务要求 | 基线冻结条款（出处） | 裁决 |
|---|---|---|---|
| AC1 | 周期 reconciliation 超时后无需人工重启即可恢复 | protocol §15.1（backoff 自动重拨全状态机）+ §21 issue #229（无 GOAWAY 的 1001 = 普通临时断线，Peer 进 backoff 重拨）+ §16（failed 等待连接重建）+ ADR 0010 L22（恢复连接后 state vector/diff 合并）——自动恢复是拓扑的设计意图，人工重启从来不是契约出口 | **no-conflict**（要求实现契约已承诺的行为） |
| AC2 | 不再出现长期稳定的 `Peer failed + Hub needs-resync + connection ready/ESTABLISHED` | §9.4「RESYNC_REQUIRED……始终由 Peer 用新 roundId 发起下一轮」+ §13.2 `ACK_TIMEOUT → needs-resync`——Hub 侧 needs-resync 以 Peer 仍能开 round 为前提；Peer 终态 + 连接存活 + 无人重建的组合在状态机任何路径上都无出口，属**契约外状态**，删除它是回归收敛而非契约变更 | **no-conflict** |
| AC3 | 恢复路径遵守「同一连接内终态 namespace 不重开」的协议不变量 | §1 不变量 4 原文（「closed、conflicted 或 failed 后不得重新 open，重新 add 必须重建连接」）+ §7.1「closed/conflicted/failed 后返回 `NAMESPACE_REOPEN_REQUIRES_RECONNECT`」+ §16「addTarget 因本连接禁止重开而触发整连接重建」——AC3 是该不变量的逐字重述 | **no-conflict**（显式钉住最易被修坏的不变量） |
| AC4 | 已接纳 apply 正常排空，session/lease 生命周期无泄漏 | ADR 0010 L90「channel 关闭先关闭 session，再释放 Lease」+ §12/§16「已被 sequencer 接纳的 apply 无条件结算……Cleanup 只在 apply promises settle 后执行，绝不在 sequencer 槽内 await session/Lease/Registry shutdown」+ §16「socket 断开时……立即停止 session、排空已接纳 apply 并 release Lease；target 保留」 | **no-conflict**（同款纪律的执行要求） |
| AC5 | 增加确定性超时与自动恢复回归测试（fake duplex transport + injected timer） | §22 conformance 清单「fake duplex transport 上的 connection、namespace、sync、resync、drain 状态迁移」——所要求测试类型恰在强制 conformance 面内；无 ADR 条款限制测试形态 | **no-conflict**（流程性 + conformance 落实） |
| AC6 | 覆盖 Peer/Hub channel 状态、连接重建和最终数据收敛 | §22「真实 WebSocket + MemoryPersistence 的 1 Hub + 2 Peers 收敛」+ §16 双侧对称 cleanup——覆盖面要求与 conformance 面一致 | **no-conflict** |

无任何 AC 要求新增 wire 帧、新增错误码、改状态机边、改 envelope/payload 或触碰 SCHEMA/META 权限——
**本修复可以完全零 wire 字节变更交付**（若走方向 A，见 D1）。

## 契约条款对照（简报「契约冲突」节三项引文核验）

简报对 protocol 的三条引文经核对**全部准确**：

1. 「ACK timeout 进入 needs-resync，由 Peer 发起新 state-vector round」= §18 末句 + §13.2 `ACK_TIMEOUT` 行 + §9.4。✓
2. 「failed 等待连接重建或配置变化」= §16 状态注记原文。✓
3. 「同一连接内终态 namespace 不得重新 OPEN」= §1 不变量 4 + §7.1。✓

简报的病灶论证链（failed 终态 × 连接内禁重开 × `onConnectionReady` 只在重连后生效 × reconcile 超时不
重建连接 ⇒ 自愈不可达）与基线条款逻辑自洽：这是**实现落入基线未指明缺口**，不是基线条款互相矛盾。

关键交叉核验——「§18 timeout 只收口 namespace」与方向 A 的字面张力：

- §18 原文：「HELLO/pong timeout 关闭连接。Open/bootstrap/reconcile/close/ACK timeout **只收口
  namespace**」——该句区分的是**超时动作的直接收口对象**（namespace vs 连接），与 §13.2
  `NAMESPACE_TIMEOUT` 的 `retryable=reconnect` 分类、§16「failed 等待连接重建」共同读时，唯一自洽解读
  是：超时本身不拆连接，但 failed 终态的既定恢复路径是连接重建。若读成「reconcile 超时后连接永不得因
  该 namespace 重建」，则 §16 的「等待连接重建」与 `retryable=reconnect` 将结构性落空——该读法使基线
  自相矛盾，不采信。
- §16 已有整连接重建先例：「随后 addTarget 因本连接禁止重开而**触发整连接重建**」——为仍被需要的
  target 在禁重开约束下重建连接，是状态机已登记的机制，不是新发明。
- ADR 0010 L165「普通超限以稳定错误关闭单个 channel；framing、认证等连接级错误才关闭整条连接」——
  该条辖**资源超限域**（max frame/update/queue bytes），不辖 timeout 域；不得援引该条否定方向 A。

## 冲突点

| # | 严重度 | 基线条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | 低（基线文本缺口，非简报冲突） | protocol §16「failed：等待连接重建」——**谁、在何条件下触发该重建**全文未指明 | 简报：若 reconcile 超时进 failed，实现需同时触发连接重建（方向 A） | **no-conflict（缺口登记 → SA1 裁决 + protocol 补记义务）** | ① 简报只要求让 §16 已承诺的恢复真正可达，未改任何条款；② 缺口是基线自身的未指明项——「等待」蕴含预期到达，`retryable=reconnect` 蕴含重连为既定恢复模态；③ 方向 A 落地时应以 protocol §16（或 §18）补一句登记性文本：failed channel + 活跃 target + 连接存活 ⇒ 由 Peer controller 触发连接重建（含 close code 选择与 §18「epoch 必须在调用可能同步重入的 transport close() 前失效」纪律）。属 doc-gap 收口，非契约修订 |
| 2 | 中（若选方向 B 则为 evolution 级契约修订） | protocol §13.2 `NAMESPACE_TIMEOUT → failed`（open/bootstrap/reconcile/close timeout 的唯一既有映射）+ §16 状态链未列 `reconciling → needs-resync` 边 | 简报备选：采用「仍能推进恢复 round 的非终态路径」（方向 B） | **no-conflict（简报保持开放；选 B 须显式修订，静默落地 = hard-violation）** | ① §9.4 pending-resync 合并规则（「至多一个紧随其后的 round」）与 §13.2 `ACK_TIMEOUT → needs-resync` 为 B 提供语义先例；② 但 reconcile timeout 现行自然映射是 `NAMESPACE_TIMEOUT → failed`，B 需要么本地无帧迁移 + 显式重映射说明，要么 append-only 新错误码（§5/§13.2 注册表设计上 append-only，允许演进）；③ 无论哪种，都必须同步修订 `docs/protocols/instance-replication-v1.md`（§13.2/§16/§18 相应节）并按 docs/AGENTS.md 以 ADR 修订节登记——**不得静默改映射**；④ 简报自身未指定方向，故不构成简报冲突 |
| 3 | 无（实证注记） | 无（代码现状不构成阻塞依据——SA8 边界） | 简报「已定位的实现路径」四条事实主张 | **no-conflict（实证为真）** | `packages/ws-replication/src/peer-namespace.ts` 核验：非周期 timer 到期统一 `finalize('failed')`（含 reconcile，onTimerFired 尾段，注释自引「timeout 只收口 namespace（零 wire 帧）」）；`onConnectionReady()` 仅在重连后把 `disconnected/failed` 复位 `targeted` 并 startOpen；全文件无任何「超时后重建连接」路径。简报事实链成立 |
| 4 | 无（范围注记 → SA1） | 同 #1（open/bootstrap/close timeout 走同一 `finalize('failed')` 路径；§13.2 三者同映射 `NAMESPACE_TIMEOUT`） | 简报只点名周期 reconcile 超时 | **no-conflict（范围裁决点）** | 同一结构性死局对 open/bootstrap timeout 同样成立（failed + 连接 ready + target 活跃 + 无重建）。SA1 应裁决恢复规则是**一般化**（failed channel + 活跃 target ⇒ 重建）还是 reconcile 专项；一般化与 §13.2 `retryable=reconnect` 分类对齐度更高 |
| 5 | 无（建议性场景措辞） | — | 简报「确定性回归场景」第 6 步断言「连接被重建并重新 OPEN/reconcile」 | **no-conflict** | 第 6 步内嵌方向 A 预期；AC1–AC6 本身方向中立。若 SA1 选 B，回归断言应改为「新 round 推进、双方回 live（连接可不断）」。测试建议不构成契约要求 |

无 hard-violation、无 override-declared、无待 owner 裁决的未授权演进项。

## 实证核验（前置事实，非阻塞依据）

| 主张 | 证据 | 结论 |
|---|---|---|
| 非 periodic timer 到期统一 `finalize('failed')` | `peer-namespace.ts` `onTimerFired()`：`'periodic-reconcile'` 与 `'close'` 分支外，尾部一律 `this.finalize('failed')`（全文件 20+ 处调用点，含 reconcile timer 路径 L1521 附近） | ✓ |
| reconcile 超时缺省 10s | `defaults.ts` L37 `reconcileTimeoutMs: 10_000`；`validate.ts` L197 positiveSafeInteger | ✓ |
| `onConnectionReady()` 只在连接 ready 后复活 failed target | `peer-namespace.ts` L832：仅 `disconnected/failed` → `targeted` → `startOpen()` | ✓ |
| 现有测试未推进到超时之后 | `test/ws-replication-periodic-reconcile.test.ts` L33「进行中的周期 round 不重叠」配置 `reconcileTimeoutMs: 10_000`，未跨过该窗口 | ✓ |
| 事故时间线与协议语义吻合 | Peer `reconciling→failed`（20:24:04）+ Hub `ack-timeout → needs-resync` + `RESYNC_REQUIRED`（20:24:26）+ 连接持续 ready——正是 §9.4「Peer 发起下一轮」前提被 Peer 终态打破的死局形态 | ✓ |

## 结论

**`clear`，放行 SA 派发。** issue #254 的 6 条验收标准全部是基线决议（ADR 0010 + protocol v1 + CONTEXT.md）
自带恢复纪律的回归执行：AC3 逐字钉住 §1 不变量 4，AC1/AC2 要求的状态机出口在 §15.1/§16/§21 中均已
存在，AC4/AC5/AC6 与 ADR 0010 L90、§12/§16 cleanup 纪律、§22 conformance 面一致。简报对 protocol 的
三条引文准确，修复可以零 wire 字节变更交付（方向 A）。

移交 SA1 的已知裁决点（均非冲突）：**D1** 修复方向 A/B 二择——A 需在 protocol §16/§18 补登记性文本
（谁触发重建、close code、epoch 先失效纪律 §18 L525）；B 属 evolution 级 wire contract 修订，必须
同步改 `docs/protocols/instance-replication-v1.md` 并以 ADR 0010 修订节登记，静默改映射即 hard-violation。
**D2** 恢复规则一般化 vs reconcile 专项（open/bootstrap timeout 同构死局）。**D3** 回归场景第 6 步措辞
内嵌方向 A 预期，选 B 时需改写断言。**D4** 勿混淆 channel 级 `needs-resync`（新 round 即恢复，§9.4/§17）
与 CONTEXT.md「ReplicationSession」fanout 溢出 sticky needs-resync（仅 reset/bootstrap 清零）——Hub 事故
态是前者。**D5** 方向 A 的整连接重建会波及同连接其他 live namespace（按 §16 断线纪律全部 re-OPEN/
reconcile 可恢复；churn/风暴风险属 SA2 设计质量域）。

## 附录 A：相关决议摘录（全链 SA 复用，只摘不裁）

> 引用行号为当前基线（HEAD 6a005a4）行号；protocol 以 §n 引用。

**protocol §1 不变量 4**：「同一连接内，同一 namespaceId 只允许一个生命周期；closed、conflicted 或
failed 后不得重新 open，重新 add 必须重建连接。」

**protocol §9.4（周期 reconciliation）**：「任一端可声明当前增量连续性作废，但始终由 Peer 用新 roundId
发起下一轮……Peer 等待 in-flight 窗口收口后开始新 round；断线则重连后重新 OPEN/reconcile。」「timer
只在完整 round 收口并进入 live 后武装……round 进行期间不武装下一次周期 timer……期间发生的 queue
overflow、ACK timeout 或显式 RESYNC_REQUIRED 仍按既有 pending-resync 规则合并为至多一个紧随其后的
round。连接断开、GOAWAY、remove/close、终态与 shutdown 必须清理 timer。」

**protocol §13.2（节选）**：`ACK_TIMEOUT | no | resync | needs-resync`；`NAMESPACE_TIMEOUT | yes |
reconnect | failed`；`BOOTSTRAP_FAILED | yes | reconnect | failed`。

**protocol §15.1（Peer 连接态，节选）**：`ready ├─ temporary-close → backoff`；`backoff ├─ timer →
connecting`；「Backoff 使用 full jitter……只有 ready 稳定超过 `backoffResetAfterMs` 才清零 attempt。」

**protocol §16**：「`failed`：等待连接重建或配置变化」「socket 断开时，控制器投影为 disconnected，立即
停止 session、排空已接纳 apply 并 release Lease；target 保留」「Target controller 用单一生命周期队列
串行化 removeTarget、socket close、session close 与 Lease release……随后 addTarget 因本连接禁止重开而
触发整连接重建。」

**protocol §18**：「HELLO/pong timeout 关闭连接。Open/bootstrap/reconcile/close/ACK timeout 只收口
namespace；ACK timeout 不重发同一 UPDATE，而进入 needs-resync 并由新 state-vector round 修复。」
「pong 超时按临时失败处理：先停止旧 liveness、退订旧 transport listener 并使 connection epoch 失效，
再关闭传输（close code 1001）并经 backoff 重连；epoch 必须在调用可能同步重入的 transport `close()`
前失效。」（本地发起 transport close 的代际安全纪律——方向 A 适用）

**protocol §21（issue #229 节选）**：「只要本地 target 仍存在，Peer 必须将该无 GOAWAY 的 1001 视为
普通临时断线，进入 backoff 并在同一 endpoint 恢复后重新 OPEN/reconcile。」（Peer 拥有重拨所有权）

**ADR 0010 L151**：「关键恢复纪律为：连接断开即 close sessions/release Leases，不保留 outbox；重连
重新 OPEN 并 reconcile。」**L165**：「普通超限以稳定错误关闭单个 channel；framing、认证等连接级错误
才关闭整条连接。」（资源超限域——不得援引否定 timeout 域重建）**L179**：「issue #229 决定临时以直接
关闭 Hub transport 取代停机 GOAWAY，使本地 target 仍存在的 Peer 保有重拨所有权。」

**ADR 0010 L90**：「Lease release 同步停止 session 接纳；channel 关闭先关闭 session，再释放 Lease。
网络状态保留在 ReplicationSession/复制插件，不塞入 Runtime 的业务 capability status。」

**ADR 0012 L36**：「Peer WebSocket plugin 只拥有 dial loop、Peer replication controller、连接/channel、
进程内 targets 与 `nomicorePeerReplication` service。」（本地发起重建的属主边界）

**CONTEXT.md「ReplicationSession」（节选）**：「fanout 投递有界队列溢出将 session 标记
`needs-resync`（sticky）——transport 须 reset/bootstrap。」（runtime session 域 needs-resync，与
channel 域不同——见 D4）

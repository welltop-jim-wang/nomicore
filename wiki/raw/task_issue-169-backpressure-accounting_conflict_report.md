# 冲突门禁报告

- 被审对象：`wiki/raw/task_issue-169-backpressure-accounting.md`（issue #169，bug，Phase 5 follow-up）
- 阶段：前置门禁（任务简报 vs ADR 全集 + CONTEXT.md）
- 基准：`docs/adr/` 全部 10 个 ADR（全读，无抽样）+ `CONTEXT.md`。`docs/protocols/instance-replication-v1.md` §13.1/§14/§17/§18 经 ADR-0010 L151/L296「唯一 wire contract」**收录为约束**；除此之外的代码与 wiki 文档未作为基准（PR #162 / PR #165 / issue #161 review 本身不构成自动阻塞依据）。
- SA8 产出：本报告 + `task_issue-169-backpressure-accounting_relevant_decisions.md`（全链复用约束清单）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19 目标态/阶段态、08-21 命名修订节） | 否 | 任务不触碰 schema/信封/投影域，无接触点 |
| ADR-0002 | nomicore 是全新重写，authority 出范围 | accepted | 否 | 无接触点 |
| ADR-0003 | 求值器与派生 schema | accepted | 否 | 无接触点 |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | 无接触点 |
| ADR-0005 | 投影生成管线 | accepted | 否 | 无接触点 |
| ADR-0006 | Cordis 持久化插件 | accepted（含 #64/#79/#131 对齐/#133-r2 修订节） | 否 | 任务不动 Persistence/存储布局，无接触点 |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（Runtime/open/read 条款由 ADR-0008 取代） | 否 | 被 superseded 的条款不构成约束；其余条款与传输层背压无接触 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 #93/#132/#134 修订节） | 是（负向） | ADR-0010「网络背压不得进入Runtime sequencer」所指 sequencer 即本文唯一 FIFO；任务全部位于 ws-replication 传输层、不触碰 sequencer → no-conflict |
| ADR-0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（含 #131/#134 修订节） | 弱 | needs-resync 恢复对应 transport reset/bootstrap；任务不改 Registry/Lease 公共面 → no-conflict |
| ADR-0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（含 #134/#133-r2/**#161-r2** 修订节） | 是（直接） | 任务即其 §资源限制与 #161-r2 修订节所登记背压终态口径的实现纠偏；七项 Scope 与 ADR-0010 L151/L165 及收录的协议 §17/§13.1/§14 逐点一致 → no-conflict |

## 冲突点

无。逐条对照未发现直接违反任何 accepted ADR 条款或 CONTEXT.md 惯例的冲突点：

| 裁决 | 数量 |
|---|---|
| hard-violation | 0 |
| evolution | 0 |
| override-declared | 0 |
| no-conflict | 10/10 ADR（直接相关 1、负向相关 1、弱相关 1、无关联 7） |

### 任务要求 ↔ 基准条款对照（复核用）

| # | 任务简报要求 | 基准条款（ADR-0010 及其收录协议） | 一致性 |
|---|---|---|---|
| 1 | 严格接纳记账：不重计当前帧、不留 pending handoff / in-flight 缝隙（`bufferedAmount` 异步更新期） | 协议 §17「总队列记账 = 每 namespace 排队字节 + socket `bufferedAmount`（连接级 pipeline）」「**严格接纳**：shed 后（或空队列时）接纳 incoming 仍会越限则拒纳该帧并同批丢弃该 namespace 幸存排队帧，以 needs-resync 声明显影（不静默吞、不静默纳）」+ #161-r2「pipeline = queued+buffered、shed 仅 queued 侧、严格接纳 + onDataShed 显影、pending handoff 计入 per-ns 溢出双口径」 | 一致——handed-off/in-flight 记账是对异步 `bufferedAmount` 观察缝隙的实现级落实，非口径变更 |
| 2 | `maxQueuedBytesPerConnection` 统一台账（queued + handed-off 未吸收 + 协议要求的 socket 压力） | 同上 §17 记账条款；配置验证块 `maxQueuedBytesPerConnection >= highWater`（既有链式不变量） | 一致 |
| 3 | shedding 触发与恢复目标至 lowWater（不止步于 cap）；多 namespace 受害者选择 | 协议 §17「溢出触发时按最大排队 namespace 整队丢弃至 queued 侧 ≤ low-water——shed 只作用于排队侧（socket 缓冲不可撤回，由水位暂停与 1011 承接）」 | 一致 |
| 4 | 控制保留额度 = socket 未冲刷控制字节的台账（非整个 paused 期累计发送量） | 协议 §17「额度按 socket 缓冲内未冲刷控制字节计，耗尽为 `CONNECTION_BACKPRESSURE`（close 1011）」 | 一致 |
| 5 | `maxQueuedControlBytes` 缺省 8 MiB、≥ `maxBootstrapBytes` + 帧开销；移除/迁移旧 `controlReserveBytes` | #161-r2「控制独立保留额度 maxQueuedControlBytes 缺省 8MiB」+ 协议 §17 同款 + 验证块 `maxQueuedControlBytes >= maxBootstrapBytes + protocol overhead`；`controlReserveBytes` 未见于任何 ADR/CONTEXT/协议条款（非被收录决策） | 一致；移除旧名无约束 |
| 6 | 轮询间隔由 `ackTimeoutMs` 权威公式推导，不用固定 1000ms | #161-r2「checkpoint = max(1, floor(ackTimeoutMs/100))」+ 协议 §17「水位检查点间隔 = `max(1, floor(ackTimeoutMs / 100))`」；§18 `ackTimeoutMs` 为独立配置 | 一致；固定 1000ms 非任何基准条款 |
| 7 | 控制帧超限：不上 wire + 恰一次 `CONNECTION_BACKPRESSURE` + close(1011) | 协议 §13.1「CONNECTION_BACKPRESSURE / Fatal yes / WS close 1011」、§14「`1011`：不可恢复内部错误或 control backpressure」「如果 framing仍可信，关闭前 best-effort发送 connection ERROR」、§17「耗尽为 `CONNECTION_BACKPRESSURE`（close 1011）」 | 一致 |
| 8 | 保持 `ConnectionSender`/`DataSenderFacet` 单数据面，不引入第二个 OutboundQueue 调度器 | 协议 §17「Connection使用 per-namespace队列和 round-robin：control/error/ACK高优先级，data每轮每 namespace最多一个」+ ADR-0010 L151 同款（PR #162 非基准） | 一致（单调度面与公平调度条款相容） |
| 9 | 公平性、控制优先、无饥饿、有界内存回归保持绿 | ADR-0010 L151「connection按namespace round-robin公平发送，control/ACK保留额度，网络背压不得进入Runtime sequencer」+ 协议 §17「round-robin 派发扫描有界：……连续一整轮无可派发 namespace 才停止本轮」 | 一致 |

## 结论

**Verdict = `clear`，冲突点 0，裁决分布：no-conflict ×10（hard-violation 0 / evolution 0 / override-declared 0）。放行，无停止原因、无需 override、无需 Jim 裁决条目。**

任务简报在事实上是 ADR-0010「issue #161 round 2 修订节」所登记背压终态口径 + 其收录协议 §17 权威契约的**实现纠偏**（修正 PR #165 实现与权威口径的偏差），不修订、不推翻任何既有决策。

对照注记（非冲突，供 SA1/SA2 参考）：

1. **L165 与 1011 并存的读法**：ADR-0010 §资源限制「普通超限以稳定错误关闭单个 channel；framing、认证等连接级错误才关闭整条连接」与「控制额度耗尽即整连 close(1011)」并存——后者由更晚、更具体的 #161-r2 修订节（「1011 终止」）与协议 §13.1/§14/§17 显式登记。按「后订且具体的条款优先」：数据侧超限走 per-namespace shedding + needs-resync（不动整连），仅控制额度耗尽才 1011 整连终止。任务简报的两种行为分界与此一致，不构成冲突，也不构成演进。
2. **协议文档的基准地位**：`instance-replication-v1.md` 不是独立冲突基准；本报告引用其条款的唯一依据是 ADR-0010 L151/L296 在 backpressure/close code/timeout 域的明文收录。
3. **范围切割无冲突**：简报声明只处理连接发送调度与记账、不处理 ping/pong 与 namespace lifecycle；被排除项（pong 超时 close(1001)、GOAWAY、代际重连等）另有 #161-r2 已登记决策，不在本任务面内，亦不受本任务影响。
4. **实现层细节不设门**：`ConnectionSender`/`DataSenderFacet`/`OutboundQueue` 等类名与内部结构、`controlReserveBytes` 的迁移方式、`onDataShed` 显影细节等属 SA1/SA2/SA4 职责，非 ADR 约束项，本门禁不作裁决。

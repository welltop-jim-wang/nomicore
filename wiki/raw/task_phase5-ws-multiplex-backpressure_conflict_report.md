# 冲突门禁报告

- 被审对象：`wiki/raw/task_phase5-ws-multiplex-backpressure.md`（issue #137，任务类型：功能开发；Phase 5：multiplex namespaces with bounded fair backpressure——单连接多 namespace 多路复用 + 有界公平背压）
- 冲突基准：ADR 全集 `docs/adr/0001`–`0010`（10 个，全量逐个读取）+ `CONTEXT.md` + 任务指定的 Phase 5 规格基准（`docs/phases/phase-5-websocket-replication.md`、`docs/protocols/instance-replication-v1.md`——后者为 ADR 0010 L151 指定的唯一 wire contract，具 ADR 级约束力）
- 审查日期：2026-08-28（run_id: issue-137-1787922674-8367, round 1）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19/08-21 修订节） | 否 | 任务不新建 schema/投影/脚手架；SCHEMA 只作为复制受保护域被整体保护/放行，不解释其内容。无冲突 |
| 0002 | nomicore 是全新 yjs-server 重写，authority 出范围 | accepted | 否 | 任务不引入任何 authority 规则体系。无冲突 |
| 0003 | 求值器与派生 schema | accepted | 否 | 求值器/ROOT 别名约定不触及。无冲突 |
| 0004 | vfsl-protocol 类型投影 | accepted | 否 | 类型投影/编译期护栏不触及。无冲突 |
| 0005 | 投影生成管线 | accepted | 否 | 无 SchemaSource 消费、无生成物、无新 domain 包。无冲突 |
| 0006 | Cordis 持久化插件 | accepted（含 #64/#79 修订节、#131 对齐说明、#133 修订节） | 否（弱） | 任务不改 Persistence 契约；AC-3「preserves already accepted local Y.Doc state」落在 Y.Doc/sequencer 域，`saveDoc` dirty-notification 语义仅为背景。无冲突 |
| 0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（Runtime/open/read 条款由 0008 部分取代） | 否（弱） | raw update 受控通道已由 ADR 0010 裁决为 ReplicationSession；本任务背压丢弃只影响未发送 wire 增量，不触碰 apply 语义。被取代条款不构成约束。无冲突 |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 #93、#132 修订节） | 是 | AC-6「never blocks the Runtime sequencer」= 连接级调度/水位门控完全位于 sequencer 之外（ADR 0010 L113/L151 同款纪律）；「不同 namespace 可并行」是 round-robin 公平调度的结构前提；#132 status 边界（replication 域不含 session/网络/队列状态）禁止把连接级状态塞进 Runtime status——简报未违反。无冲突 |
| 0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（含 #131、#134 修订节） | 是 | 连接断开/关闭时的 Lease release 编排、release 同步调 session close、已接纳 apply 槽照常排空——简报恢复纪律（AC-3/AC-7 reconnect repair）沿用 #136 已交付编排，未越权；AC-6「Cordis scheduler」与本 ADR「不各自实现或 fallback 到系统 timer」生态纪律一致（协议 §17 对 WS 层显式同款要求）。无冲突 |
| 0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（含 #134 round-2、#133 round-2 修订节） | 是（权威 ADR） | 任务全部 AC 逐条溯源见下；范围边界（非目标清单）与 L177 transport 抽象纪律逐字一致；「切片 3 对账注记」与 #134 round-2 两级队列属主边界修订一致。无冲突 |

Phase 5 规格基准对照：

| 文档 | 对照结论 |
|---|---|
| docs/phases/phase-5-websocket-replication.md | 任务自认切片 6 背压/调度条目（L110）+ 切片 7 multiplex 条目（L114）；AC-7 对应场景 10/11/13/16 与「测试 seam」fake-duplex/故障注入要求；非目标与简报范围边界逐项同源。无冲突 |
| docs/protocols/instance-replication-v1.md | AC-1 = §1 不变量 3/4 + §7.1 重开矩阵 + §16 target controller；AC-2 = §10.1 未发送合并 + §10.2 滑动窗口 + §17 上限清单 + §18 ACK timeout；AC-3 = §17 溢出丢弃条款；AC-4 = §17 round-robin/control 优先级；AC-5 = §17 总压恢复 + control 保留额度 + §13.1 `CONNECTION_BACKPRESSURE`；AC-6 = §17 bufferedAmount/Cordis Timer 条款。逐条吻合，无冲突 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| （无） | — | — | — | — | 未发现任何直接违反 ADR/CONTEXT/规格基准的要求；亦无未声明推翻（无 override 需求）与未走正式 supersede 的实质演进 |

### 逐条溯源（佐证上表「无冲突」结论）

| 被审对象条目 | 基准条款（溯源） |
|---|---|
| AC-1 单连接按 namespaceId 直接多路复用 + 禁止同连接重开已关闭 namespace | ADR 0010 L143「每个 Peer→Hub维持一条长期 WebSocket并 multiplex多个 namespace。Wire不使用 channelId……同一连接内同一 namespace只允许一个生命周期，关闭后重开必须重建连接」；协议 §1 不变量 3/4；§7.1「closed/conflicted/failed 后返回 `NAMESPACE_REOPEN_REQUIRES_RECONNECT`」；§16「随后 addTarget因本连接禁止重开而触发整连接重建」 |
| AC-2 每 namespace 有界队列 count/bytes、可配置 in-flight UPDATE 窗口、ACK timeout、未发送合并 | 协议 §17 上限清单（`maxQueuedUpdateBytes`/`maxQueuedUpdateCount`/`maxInFlightUpdates` 默认 32）+ §10.2「每 namespace每方向采用可配置滑动窗口，默认 32 个 in-flight UPDATE」+ §18「ACK timeout……进入 needs-resync」+ §10.1「尚未分配 sequence、尚未发送的 updates允许 `Y.mergeUpdates()` 合并；发出后不得改写」；ADR 0010 L165「以下上限均为插件配置并提供安全默认值」 |
| AC-3 溢出只丢弃受影响 namespace 的未发送增量、进入 needs-resync、保持已接受本地 Y.Doc 状态 | ADR 0010 L151「Per-namespace有界队列溢出时丢弃未发送增量并进入needs-resync」+ L113「队列溢出只把 channel 标记为 `needs-resync`，不得阻塞 write sequencer」；协议 §17「未发送队列任一上限超出：丢弃全部未发送增量，标记 needs-resync，停止新 UPDATE。已发送窗口等待 ACK或连接断开」；切片 6「溢出丢弃未发送增量并重新diff，不阻塞Runtime sequencer」 |
| AC-4 control/error/ACK 优先 + data round-robin 每轮每 namespace 至多一帧 | ADR 0010 L151「connection按namespace round-robin公平发送，control/ACK保留额度」；协议 §17「Connection使用 per-namespace队列和 round-robin：control/error/ACK高优先级，data每轮每 namespace最多一个」 |
| AC-5 连接总压恢复按 queued 最大 namespace 依次选为 resync、保留 control 额度、额度耗尽为分类连接失败 | 协议 §17「总队列超限时，按最大 queued namespace依次丢弃未发送增量并标记 needs-resync，直到回到低水位。Control frame有独立保留额度，耗尽为 `CONNECTION_BACKPRESSURE`」+ §13.1 注册表行（fatal/retryable/WS close 1011） |
| AC-6 bufferedAmount 高/低水位门控用 Cordis 调度、绝不阻塞 Runtime sequencer | 协议 §17「Adapter观察 WebSocket `bufferedAmount`：超过 high-water暂停 dequeue，降至 low-water恢复。无 drain event时使用 Cordis Timer调度检查，不使用原生 timer，也不进入 Runtime sequencer」+ `low-water < high-water` 启动校验；ADR 0010 L151「网络背压不得进入Runtime sequencer」 |
| AC-7 公平性/无饥饿/独立失败/上限/重连修复/敌意流量有界内存测试 | phase-5 场景 10（慢消费者 needs-resync 不阻塞 sequencer）、11（重复/乱序/重连收敛）、13（上限按 channel 或连接隔离）、16（优雅停机）；「测试 seam」：内存双端 transport/fake socket、故障注入（丢帧/重复/乱序/连接中断/队列溢出/shutdown race）、不用真实时间等待；协议 §22 conformance |
| 范围边界：不做 durable outbox/增量 WAL/跨重连 update ID 去重表；不做第二种 transport 或提前抽取 transport-independent seam | ADR 0010 非目标「durable outbox、增量 WAL 或跨重连 update ID 表」+ L177「在出现第二种 transport 前，不提前提取 transport-independent replication package」；phase-5 非目标同源逐项一致 |
| 切片 3 对账注记：fanout 投递队列（容量 16、溢出弃新置 needsResync）属切片 3 已交付域；WS 发送队列/连接级背压属切片 6 域 | ADR 0010 #134 round-2 修订节：「L241「熔断/背压属切片 6 队列属主」**收窄**为「WS 发送队列/连接级背压（正文 L151 域）」——投递队列（runtime 内、session 域）属本切片」；「容量 **16** 冻结常量 `FANOUT_CHANNEL_QUEUE_CAPACITY`——不可配置」。简报对属主边界的转述与 ADR 登记一致，未混淆、未改写 |
| 流水线路由（功能开发，跳过 SA5） | 与任务类型一致的过程决策，非 ADR 约束域。无冲突 |

## 结论

**Verdict: `clear` —— 放行。**

- 冲突点数：0；裁决分布：no-conflict 10/10（ADR 层面），override-declared 0，evolution 0，hard-violation 0。无需 override、无需 Jim 裁决条目、无需停止运行。
- 任务简报不是新决策提案，而是 ADR 0010（L143/L151/L113/L165 及 #134 round-2 属主边界修订）+ 协议 v1（§1 不变量、§10、§13.1、§16、§17、§18、§21）+ Phase 5 切片 6/7 的忠实实施切片；全部 AC 可逐条溯源到已接受条款（溯源表见上）。
- 三条非冲突范围注记（供总控/SA1/SA2 参考，不构成门禁约束）：
  1. **两级队列属主是本任务最大的设计红线**：切片 3 fanout 投递队列（session 域、容量 16 冻结常量、溢出弃新保旧、`status.needsResync` sticky）与本任务的 WS 发送队列/连接级背压（L151 域）是**两套队列、两个属主、两种溢出语义**（前者弃新保旧标记 session；后者丢全部未发送、标记 namespace needs-resync、停发新 UPDATE）。简报已明文对账；SA1 设计与 SA3 实现不得把两者混同或互相代管。
  2. **AC-6 的 `bufferedAmount` 是真实 socket 面**：协议 §17 把它定为 Adapter 观察义务（Cordis Timer 调度、不进 Runtime sequencer）。#136 设计曾以「DuplexTransport 无 `bufferedAmount` 面、真实 WS 背压接线登记为切片 7 演进位」处理——该 wiki 设计文档不构成冲突基准；本任务 AC-6 将其拉入验收面，SA1 须在「不提前提取 transport-independent seam」（ADR 0010 L177）纪律内定义最小 socket 背压接缝（fake duplex 测试面 + 真实 WS Adapter 观察面），不得借机长出第二种 transport 抽象。
  3. **切片 7 其余部分（认证/授权细节）与切片 9 composition root 划出范围**：简报措辞「除非为多路复用/背压所必需的最小接缝」与 phase-5 切片划分相容；连接多路复用条目（切片 7 L114）本身在本任务 AC-1 验收面内，SA1 应只经 #136 已交付的注入 seam 消费，不实现生产认证 Adapter。
- 相关决议清单（全链复用）：`wiki/raw/task_phase5-ws-multiplex-backpressure_relevant_decisions.md`

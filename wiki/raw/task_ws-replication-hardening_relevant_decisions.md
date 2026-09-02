# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（Phase 0，任务 `ws-replication-hardening` / issue #161）。
> 只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 行号锚点基于本 worktree `docs/adr/` 与 `CONTEXT.md` 当前版本。

---

## 相关 ADR

### ADR-0010 Hub/Peer WebSocket Y.Doc 复制与最终一致（accepted；含 issue #134 / #133 修订节）

本任务全部 21 条要求的活动域。核心条款摘录：

**认证与连接身份（L145–147、L153–159）**

- L147：「Bearer token在HTTP Upgrade前认证；Upgrade后Peer发送HELLO，Hub回复HELLO_ACK并绑定Peer/Hub instance identity。每方向sequence从1严格递增，不回绕；gap、repeat或错误ACK关联关闭连接。WS ping/pong负责活性，GOAWAY提供相对drain timeout。」
- L155：「WebSocket upgrade 使用 bearer token 认证实例身份；token 映射到安全文法约束的 `instanceId` 与 namespace 权限。」
- L156：「`instanceId` 使用 `^[a-z][a-z0-9-]{0,62}$`，仅用于连接身份、受控日志和指标，不写入 namespace META。」
- L157：「Hub 检查 peer 对每个 namespace 的读取和提交权限；peer 验证配置的 hub 身份，并只接受已请求且批准的 channel。」
- L158：「权限撤销关闭对应 channel，不必关闭整条 WS；授权结果不跨连接生命周期缓存。」
- L143：「Wire不使用 channelId：每个 namespace-scope frame直接携带namespaceId；同一连接内同一 namespace只允许一个生命周期，关闭后重开必须重建连接。」
- L145：「Envelope version只决定头布局，HELLO显式协商完整protocol version与capabilities；不得按消息数值猜版本。」

**恢复纪律、公平发送与背压（L149–151）**

- L149：「每个sync round由Peer以uint32 roundId发起，双方Step2完成sequenced apply + dirty后以SYNC_APPLIED确认；两个方向均确认才进入live。UPDATE_ACK同样只表示sequenced live apply + dirty notification，不表示物理flush或其他副本确认。」
- L151：「连接与namespace状态、消息码、payload字段、错误码、timeout、close code、backpressure和完整时序以`docs/protocols/instance-replication-v1.md`为唯一wire contract。关键恢复纪律为：连接断开即close sessions/release Leases，不保留outbox；重连重新OPEN并reconcile。Per-namespace有界队列溢出时丢弃未发送增量并进入needs-resync；connection按namespace round-robin公平发送，control/ACK保留额度，网络背压不得进入Runtime sequencer。」

**资源限制（L163–165）**

- L165：「以下上限均为插件配置并提供安全默认值：最大 WS frame、最大单 update/diff、每连接最大 channel 数、per-channel/连接待发送字节、bootstrap/idle timeout、心跳与失联判定。普通超限以稳定错误关闭单个 channel；framing、认证等连接级错误才关闭整条连接。」

**Session/Lease 关闭与停止顺序（L90、L179）**

- L90：「Lease release 同步停止 session 接纳；channel 关闭先关闭 session，再释放 Lease。」
- L179：「停止顺序为：复制插件停止接纳连接/target，关闭 channels，等待已被 Runtime 接纳的 apply 槽完成但不无限等待网络 ACK，释放 replication leases，随后 Registry shutdown、Persistence dispose，最后停止 Timer/Clock。」

**observer 与 needs-resync（L109–113）**

- L113：「队列溢出只把 channel 标记为 `needs-resync`，不得阻塞 write sequencer。」

**包边界（L171–175）**

- L173：「`@nomicore/replication-protocol`：纯二进制 codec、显式版本协商、消息与稳定错误，不依赖 Cordis、WS 或 Registry」
- L174：「`@nomicore/ws-replication`：WebSocket client/server、multiplex、认证授权、bootstrap/reconcile/live 状态机、背压和observer」
- L175：「`apps/yjs-server`：最小 Cordis composition root，装配 Clock、Timer、Memory/File Persistence、Registry、WS replication、配置加载和优雅停机。」

**observability 最小观测面（L167）**

- L167：「复制插件提供结构化 observer seam 给日志/metrics/trace Adapter，不提供业务公共 update events。最小观测面包括：连接状态与重连、channel 状态、bootstrap/reconcile 次数和字节、updates/bytes in/out、apply/ACK latency、backpressure resync、auth/authz failure、identity/epoch conflict、peer degraded bypass apply 和稳定错误计数。」

**issue #134 修订节与本任务相邻的冻结词汇（transport 层不得误触）**

- R2-3（L267）：fanout 投递经「每 session 有界异步队列（容量 **16** 冻结常量 `FANOUT_CHANNEL_QUEUE_CAPACITY`——不可配置）+ 自延伸微任务泵（每项投递前让步 **20** 次……合法区间 [16,24]）」；「队列溢出 → 丢弃新项（保序）+ 置 `status.needsResync`（sticky）」——该泵属 **namespace-runtime session fanout 域**（`packages/namespace-runtime/src/replication-session.ts`），不是 ws-replication 传输层对象。
- R2-2（L271）：「Runtime `close()` 同步段……经 `fanout.terminateAll('runtime-close')` 逐 channel `finalize('closed', 'runtime-close')`」「已接纳 apply 槽无条件排空」。
- L245（#134 生命周期词义）：「`closed`（显式 close 或 Lease release 同步调用 `session.close()`）与 `conflicted`（epoch fence）皆终态并释放槽位」。
- L262（踩坑注记）：「epoch 传播走控制面（切片 6 `IDENTITY_CHANGED`），不依赖 raw update 携带」。

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted；含 #93 / #132 修订节）

- L93：「`close()` 幂等。首次调用同步进入 `closing`，立即停止接纳公共 read 和 write，并在队尾加入 close barrier；此前已接纳任务无条件排空，不取消、不设内部 timeout。」
- L36（#132 修订 4）：四个写方法「均进入同一严格 FIFO write sequencer，完整槽序（lifecycle/fatal gate → `DocHandle.getStatus()` writable gate → 输入校验 → 领域事实读取 → 单 Yjs transaction → 同步投影 → `await notifyDirty()`）不变」。
- L119（#93 修订 2）：`RUNTIME_WRITE_DISABLED` 是写停接纳/写禁用的统一码族，覆盖 fatal 后排队写、写前 writable gate 拒绝、notifyDirty 未绑定、close 后 lifecycle≠ready 的接纳拒绝，「区分域靠 issue message 文案，不另设新码」。
- L135（#132 修订 5）：status 的 `replication` 域「仅含持久 identity/epoch 的两态联合……不含 session、网络、队列或 sync 状态」。

### ADR-0009 NamespaceRegistry、调用方租约与 Cordis Host 生命周期（accepted；含 #131 / #134 修订节）

- L42：「首次 `release()` 在调用栈内同步将 lease 标记为 released，之后不再接纳新操作。……release 不追踪或等待此前已经由 Runtime 接纳的写；这些写仍由 Runtime sequencer 管理。」
- L48：「idle 期间 open 同步取消 timer、转回 active 并签发 lease。若 timer callback 先同步将 entry 转为 closing，则该转换不可逆。」
- L83：「Persistence 和 Registry 都依赖外部 Clock 与 Cordis Timer，不各自实现或 fallback 到系统 timer。……确定性测试使用 manual Clock 状态与 fake timer协调推进。」
- L150（#134 修订 2）：released lease 的 `openReplicationSession` 经返回 Promise 结算 `{ok:false, code:'NAMESPACE_LEASE_RELEASED'}`；「release 同步段调用既有活跃 session 的 `close()`（停接纳 + 退订 + 释放 slot；零新增方法面）；release 不追踪/取消已接纳 apply 槽」。

### ADR-0006 Cordis 持久化插件（accepted；多次增量修订）——弱相关，边界参照

- 本任务不动 Persistence 契约；needs-resync 后的 reset/bootstrap 走既有受控 seam（ADR-0010 L57 resetReplica + #133 修订、ADR-0006 #133 修订节的 `importDoc`/`archiveDoc`/identity probe）。
- L211（#133 修订 1）：「复制身份与 Hub 广告的完全一致核对是调用方（Registry 受信 bootstrap 编排）在所有权转移之前的职责——Persistence 不是、也不得成为 Hub 广告授权/复制策略引擎」。

### ADR-0001–0005、0007（与本任务无直接约束面）

- 0001（VFSL 单一真相源）、0002（重写定位/authority 出范围）、0003（求值器与派生 schema）、0004（类型协议包）、0005（投影生成管线）：任务不触及 schema 文本、信封、求值、投影或 codegen。
- 0007（逻辑验证与 Yjs bridge；Runtime/open/read 条款被 0008 取代）：任务不触及校验管线；trusted raw update 的 zero-write 例外已由 ADR-0010 L94–107 定界，本任务不扩大该例外。

---

## CONTEXT.md 相关术语与惯例

- **Hub（中心实例）**：「静态星型复制拓扑中接受 peer WebSocket 连接、转发 Yjs updates、管理 SCHEMA 与复制身份的完整 Nomicore 实例……」_Avoid_: master、leader。
- **Peer（边缘实例）**：「静态连接唯一 Hub 的完整 Nomicore 实例；使用独立 Persistence，断线时保持本地 ROOT 读写，重连后按 state vector/diff 与 Hub 双向合并。……」_Avoid_: slave、follower。
- **namespaceId**：「Registry entry 与实例复制 wire 的唯一 namespace 身份……owner 是 open/create 的本地重要属性但不上 wire，也不参与复制身份」。
- **复制谱系（replication lineage）**：「只有 namespaceId、replicationId 与 replication epoch 全部匹配的副本才允许直接执行 Yjs state-vector reconciliation」。
- **复制代际（replication epoch）**：「从 1 开始、只由 Hub 显式提升的安全整数；相同复制谱系但 epoch 不同的副本进入冲突状态，必须显式 reset/bootstrap，不自动覆盖或合并」。
- **ReplicationSession**：「……每 Lease 至多一个活跃 session；`close` 或 epoch fence 后进入终态（closed/conflicted）并释放槽位；host 负责只把该高级能力交给可信 transport。fanout 投递有界队列溢出将 session 标记 `needs-resync`（sticky）——transport 须 reset/bootstrap。」_Avoid_: 裸 Y.Doc WS handler、绕过本地 write sequencer 的 apply、把网络状态塞进 Runtime capability status。
- **实例角色（instance role）**：「实例静态角色 hub/peer，经 Registry 构造 `options.role` 注入（可选、缺省 `'hub'`）；……session 的 localRole 必须等于实例角色。生产 composition root（phase-5 切片 9）必须显式传入。」
- **停接纳（stop-acceptance）**：「close 首次调用同步进入 `closing` 后，capability 槽立即停止接纳新调用……close 前已接纳任务仍无条件排空」（Runtime 域纪律；任务要求的 channel/session 层「同步停接纳」为同构方向）。
- **复制未校验（replication-unvalidated）**：raw update 不享有 zero-write 保证，不自动回滚——本任务不得以「加固」名义给 raw apply 加 VFSL 校验或回滚。

---

## 与本任务各修复组的对应关系速览（供 SA1/SA2/SA3 定位，非裁决）

| 任务简报修复组 | 主要 ADR 锚点 |
|---|---|
| Authentication and connection generations | ADR-0010 L143/L147/L155–158 |
| ACK correlation and recovery | ADR-0010 L147/L149/L151 |
| Backpressure and fairness | ADR-0010 L151/L165；CONTEXT「ReplicationSession」needs-resync 词条 |
| Close, GOAWAY, and async race safety | ADR-0010 L90/L143/L147/L151/L179；ADR-0008 L93；ADR-0009 L42/L48；#134 R2-2 |
| Liveness and testability | ADR-0010 L147/L174；ADR-0009 L83 |
| Delivery clarification | ADR-0010 L57/L167/L175（范围条款，仅澄清不修改） |

---

## 设计后复审追加（Phase 2，SA8）— SA1 设计引入的新决策点

> 依据 SA1 设计 `task_ws-replication-hardening_design.md`（R1，2026-08-28）追加，供 SA2/SA3 复用。
> 只登记设计引入的行为决策与 ADR 对照结论（SA8 设计后复审 Verdict: **clear**，详见 `task_ws-replication-hardening_design_conflict_report.md`）；引用条目为设计节号。

1. **受信身份 seam（设计 §1.1）**：`HubReplication.accept(transport, identity?: UpgradeIdentity)`；identity 缺失 → 同步 `TypeError`（响亮拒绝，绝不采信 HELLO 自述）；HELLO `peerInstanceId` ≠ 受信身份 → `INSTANCE_IDENTITY_MISMATCH` 连接 fatal 1008（授权前收口）；`authorize`/`openReplicationSession` 只消费受信身份。ADR-0010 L155/L157、协议 §2 L36–38、§6.1 L120。
2. **连接代际闸（设计 §1.2）**：peer 传输回调按 `connectionEpoch` 闭包先验 + 主动退订；旧 socket 迟到 message/close 静默丢弃、不触发 backoff。注：「连接代际」≠ CONTEXT 冻结词「复制代际」（META.replicationEpoch），不上 wire、不入 META。
3. **BOOTSTRAP_ACK 错配策略（设计 §2.1）**：留存发送序、错配 → `ACK_STATE_VIOLATION` 连接 fatal 1002（ADR-0010 L147「错误ACK关联关闭连接」的直接适用；沿用 UPDATE_ACK 先例）。
4. **CLOSE_OK 错配策略（设计 §2.2）**：错配 → 不完成 close、保持 closing、`closeTimeout` 收口该 namespace，**非**连接 fatal。SA8 裁定 no-conflict（冲突报告 #1：协议分级违例模式 + §12 L313 丢包容 + ADR-0010 L165 爆炸半径 + 简报 G2.2 措辞差异）；字面张力已上报 Jim 知悉。
5. **hub ACK 超时恢复（设计 §2.3）**：`onAckTimeoutFired` → 复用既有 `declareHubResync()` 记忆化声明（恰一帧 RESYNC_REQUIRED），不新增机制；peer 经 `onResyncReceived` 同步路径发起恢复 round。协议 §9.4 L248/L250、§18 L520、注册表 `ACK_TIMEOUT`(no/resync/needs-resync)。
6. **ACK 计时器重挂（设计 §2.4）**：最老在途被 ACK 且窗口非空 → disarm+arm 重挂（锚点=最老剩余在途的发送时刻）；配合 §3.1 改为实际派发时刻 arm。
7. **连接级数据面（设计 §3）**：出站调度唯一权威 = 改造后 `OutboundQueue`（控制绝对优先 + per-ns 数据队列 + 持久游标 round-robin 每轮每 ns 至多一帧 + 入队容量核算 shed 最大 ns 至低水位 + `bufferedAmount` 高低水位经注入 timer 周期检查点 + 控制保留额度耗尽 → `CONNECTION_BACKPRESSURE` 1011 关连接）。UPDATE 迁出控制路径；序列在实际派发时单点分配（入队不占序列）。ADR-0010 L151、L165；协议 §17 L490–492、§10.1 L261。SA8 对 1011 关整条连接的对照：冲突报告 #2（no-conflict）。
8. **checkpoint 间隔推导常量（设计 §3.4）**：`max(1, floor(ackTimeoutMs/100))`（缺省 100ms）——推导值，非新配置字段（`ReplicationLimits/Timeouts` 冻结面零专属字段）。`DuplexTransport` 加性可选 `bufferedAmount?/ping?/onPong?`，缺省 dormant。
9. **CLOSE 同步停接纳（设计 §4.1/§4.2）**：双侧帧分发同步段置 `closing`；收到对端 CLOSE 不 arm closeTimeout（ADR-0008 L93「无条件排空」同构方向）；本地 removeTarget 路径 closeTimeout 保持。hub `onRoundSettled` 白名单守卫（仅 reconciling/needs-resync 可回 live；closing/终态不复活，且 `resyncDeclared` 清零只在真实回 live 时发生）。
10. **GOAWAY 处理（设计 §4.4）**：`SERVER_SHUTTING_DOWN`/`REAUTH_REQUIRED` → `enterBlocked()`；`SERVER_RESTARTING` → drain deadline（句柄保存）→ 同步 `quiesceControllers()` → close(1001) → backoff 重连；`goawayActive` 抑制新 OPEN/新 round；订阅摘除（`unsubscribe()`）前移至 cleanup 入口同步段。协议 §6.3 L147、§15.1。
11. **closing 期 OPEN waiter 必答（设计 §4.5）**：close 终局统一以 namespace ERROR `NAMESPACE_REOPEN_REQUIRES_RECONNECT` 答复 closing 期挂入的重复 OPEN waiter。协议 §7.1 L164、ADR-0010 L143。
12. **活性接线（设计 §5.1）**：仅 WS ping/pong（零应用层帧、零新消息码）；仅当 transport 同时提供 `ping`/`onPong` 时武装（缺省 dormant、零 timer）；`ReplicationTimeouts` 加性可选 `pingIntervalMs?`（缺省 30_000）/`pongTimeoutMs?`（缺省 10_000，Resolved 必填，构造期响亮校验 pong < ping）；pong timeout 关连接。ADR-0010 L147/L165、协议 §2 L40、§18 L518–520。
13. **deferTask seam（设计 §5.2）**：`PeerReplicationOptions.deferTask?`；生产缺省单次 `queueMicrotask`（512 环删除）；测试侧 `TEST_DEFER`（512 跳）注入 `test/driver.ts`。定时调度不涉及（ADR-0009 L83 的 timer 注入纪律不受影响）。
14. **死抽象清理（设计 §5.3）**：删 `LifecycleQueue` 类（保留 `Memoized`）、`OutboundQueue.sendData` 死直发、hub 侧 `cleanupTail`、`NamespaceChannelCore` 接口——单一权威机制收敛。
15. **交付澄清归属（设计 §6）**：`resetReplica` 已在 Registry 侧交付（ADR-0010 L57 + #133 修订）；结构化 observability（ADR-0010 L167）与 apps/yjs-server 组合根（L175 切片 9）判未交付、建议独立票——**义务保持开放**，总控须落实票据。
16. **SA6 测试构造调整请求（设计 §3.7，非 ADR 事项）**：AC5-RR 断言语义不变（`[a,b,a,b]`），构造需改为 gate+advanceBy 同款确定性形态；属总控→SA6 裁决项，SA8 不裁。

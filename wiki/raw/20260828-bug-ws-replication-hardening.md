# [Bug] ws-replication 协议/生命周期加固点全景分析（issue #161，PR #160 post-review 6 组 required fixes）

**Status**: analyzed | **Date**: 2026-08-28
**Severity**: critical（G1.2 身份冒充可达；G2.3 恢复死锁；其余 high）
**Type**: new-feature-defect（PR #160 merge `6f2676f` 新增功能的 post-review 缺陷，非回归——加固面从未实现，非「曾经正常后损坏」）
**Layer**: backend（`packages/ws-replication` 为主；`packages/replication-protocol` 仅涉及已定义未使用的错误码；接线缺失涉及 apps/）

> 审计对象：worktree `/home/wangjian/nomicore-fix-issue-161`（branch `fix/issue-161-on-docs-phase-5-websocket-replication`）。
> 对照基准：任务简报 6 组 required fixes + `docs/protocols/instance-replication-v1.md`（唯一 wire contract）+ ADR-0010/0008/0009（见 `_relevant_decisions.md`）。
> 结论先行：**6 组 21 项中 18 项缺陷确认存在（含整组未实现的 G3），3 项为范围澄清（G6，非缺陷、需开票）**。静态代码证据充分，未添加任何诊断日志，现场零改动。

## Symptoms

本报告是 post-review 加固审计：多数缺陷表现为「契约已定义/类型面已预留，但逻辑面缺失或半实现」，而非用户可见报错。按组的实际/潜在症状：

| 组 | 症状（现状行为） |
|---|---|
| G1 认证与连接代际 | 任意持有 WS 连接的客户端可在 HELLO 中**声明任意 `peerInstanceId`** 并以该身份通过 Hub namespace 授权（身份冒充）；Peer 换代重连后，**旧 socket 的迟到 message/close 回调可污染新连接**（改序列期望、触发错误 backoff、把新连接打进 disconnected） |
| G2 ACK 关联与恢复 | 伪造/错序 `BOOTSTRAP_ACK` 任意 `ackedSequence` 均可推进 hub 状态机；`CLOSE_OK` 任意值即可完成 peer 收口；**Hub 侧 UPDATE ACK 超时后 Peer 永远收不到 RESYNC_REQUIRED → 恢复死锁**（hub 卡 needs-resync 直到断线）；ACK 计时器不按最老在途重挂 → 持续流量下周期性假性 needs-resync |
| G3 背压与公平 | UPDATE 数据帧走**控制帧路径**（control 优先=数据帧也插队控制语义）；连接级 per-namespace 队列/round-robin/字节上限/shedding/控制保留额度/`CONNECTION_BACKPRESSURE`/bufferedAmount 高低水位**全部未实现**（`maxQueuedBytesPerConnection`/`lowWater`/`highWater` 仅存在于类型与启动校验，零逻辑使用） |
| G4 Close/GOAWAY/竞态 | CLOSE 收到后**不同步停接纳**（hub 延迟到微任务；peer 完全不进 closing，drain 期间照常收 UPDATE）；hub 迟到 round 结算可把 **closing 通道复活为 live**；GOAWAY/blocked **不静默任何 namespace channel/订阅**；closing 期间到达的重复 OPEN **永远无响应** |
| G5 活性与可测性 | **无任何 WS ping/pong 活性机制**（静默死链永驻 ready/live）；生产代码存在 **512 次链式 `queueMicrotask` 延迟环**（纯为测试可观测性）；4 处**死抽象**（`LifecycleQueue`、`OutboundQueue` 数据面、`cleanupTail`、`NamespaceChannelCore`） |
| G6 交付澄清 | resetReplica 接线 / 结构化 observability / apps 组合根均未交付（属后续切片，需开票，见下） |

## Reproduction

所有缺陷均为确定性代码路径，可用现有测试基建复现（`test/harness.ts` 内存双端 transport + `test/driver.ts` 帧注入，`createMemoryDuplexTransport` 同形）。代表性复现路径（供 SA4 写 red test）：

1. **G1.2 冒充**：harness 起 hub（authorize 按 identity 放行 ns-A 给 `peer-alpha`），用未认证 transport 发 `HELLO{peerInstanceId:'peer-alpha'}` → 现状：握手成功、OPEN(ns-A) 被授权通过（`hub-connection.ts:215` 无对照源）。修复后应 1008 `INSTANCE_IDENTITY_MISMATCH`。
2. **G1.3 旧 socket 污染**：peer ready 后触发 `requestRebuild`（`addTarget` 到 closed target），在旧 transport 上注入一条 sequence=1 的帧/一次 `close(1000)` —— 现状：新连接（已重拨、`expectedSeq=1`）接受该帧；新连接被打进 backoff。
3. **G2.3 恢复死锁**：hub↔peer live 后，让 peer 停发 UPDATE_ACK（harness 拦截）+ 推进注入 timer 越过 `ackTimeoutMs` → 现状：hub 进入 needs-resync，**wire 上零 RESYNC_REQUIRED 帧**（`hubFrames('RESYNC_REQUIRED')` 为空），peer 停留 live，双方状态机永久不对称。
4. **G4.1/4.3**：live 期注入 `CLOSE_NAMESPACE`，同 tick 内再注入 UPDATE（peer 侧）/观察微任务窗口（hub 侧）；或在 Step2 apply 在途时注入 CLOSE 并放行 apply → 现状：peer 在 drain 期照常 apply 新 UPDATE；hub 状态出现 `closing → live → closed` 抖动。
5. **G3 全组**：构造多 namespace 大流量，断言 UPDATE 帧携带 round-robin 交错序、超限 shedding、`CONNECTION_BACKPRESSURE` —— 现状全部不可观测（无实现）。

## Investigation

阅读顺序与证据链（`packages/ws-replication/src`，行号以当前 worktree 为准）：

1. `types.ts`（冻结公共契约）——发现 `ReplicationLimits` 已含 `maxQueuedBytesPerConnection/lowWater/highWater`（L26-28）但全包无逻辑引用（grep 仅 `defaults.ts` 赋值与 `validate.ts` 启动校验）；`HubReplication.accept(transport)` 签名（L90）与 `HubReplicationOptions`（L80-87）均无认证上下文；`ReplicationTimeouts`（L31-38）无 ping/pong 字段；`DuplexTransport`（L47-53）无 bufferedAmount/活性面；`NamespaceChannelCore`（L172-178）零引用。
2. `hub-connection.ts` / `peer-connection.ts`（连接 FSM）——`onHello` 直接采信 wire 身份；peer 侧传输回调未绑代际；GOAWAY 处理不通知控制器；`requestRebuild` 用 `queueMicrotask`。
3. `hub-namespace.ts` / `peer-namespace.ts`（通道状态机）——`onBootstrapAck` `void message`；`onCloseOk()` 丢参；hub `onAckTimeoutFired` 不发 RESYNC；双侧 close 停接纳非同步（peer 根本不进 closing）；hub `onRoundSettled` 只判终态可复活 closing；`onOpen` closing 期 waiter 无人 flush；peer `onAckTimeoutFired` 512 次微任务环。
4. `frame-io.ts`（出站队列）——`OutboundQueue` 控制队列无界、数据队列机制（`dataQueues/dataOrder/dataCursor` + `drain` 数据循环 + `sendData`）**无入队 API 且 `sendData` 零调用者** = 死代码；UPDATE 实际走 `sendControl`。
5. `update-channel.ts`（per-ns 窗口）——ACK 计时器单次挂载、部分进度不重挂；per-ns 字节/条数上限已实现（对照组，证明缺失的是连接级聚合面）。
6. `lifecycle-queue.ts`/`round-engine.ts`/`fence-watchdog.ts`/`defaults.ts`/`testing.ts`——`LifecycleQueue` 零引用；watchdog 是 session 状态探测（fence/needsResync），非 socket 活性，进一步证实 G5.1。
7. 对照 wire contract：`docs/protocols/instance-replication-v1.md` §6.1（L120 HELLO 身份=Upgrade 身份）、§6.3（L147 GOAWAY）、§7.1（L164 每个 OPEN 必有答复）、§8.2（L197 BOOTSTRAP_ACK 关联）、§9.4（L248 恢复由 peer 发起）、§12（L304-313 CLOSE 同步停接纳/CLOSE_OK 关联）、§13.1（L350 `CONNECTION_BACKPRESSURE`）、§15.1（L411 GOAWAY→draining）、§16（L475 同步停接纳）、§17（L490-492 连接级公平/背压/水位）、§18（L518-520 ping/pong 与 ACK timeout 语义）、L40（活性仅 WS ping/pong）。
8. 范围核查：`packages/namespace-registry` 已含 `resetReplica`（phase5-bootstrap-archive-reset 切片交付）；`apps/` 仅 README/AGENTS（无 yjs-server）；`replication-protocol/src/errors.ts:27,108` 已定义 `CONNECTION_BACKPRESSURE`（1011）——契约先行、实现欠账的模式贯穿全包。

未添加诊断日志（静态证据已完备）；未改动任何源文件。

## Root Cause

**总根因**：PR #160 交付了协议 happy path（open/bootstrap/reconcile/live/close 主链、UPDATE_ACK 的 in-flight/zombie 关联、双向 sequence 纪律），但 post-review 识别的加固面系统性缺失；其中三项呈现「类型/错误码/常量已冻结预留、运行时逻辑为零」的半实现形态（连接级背压三常量、`CONNECTION_BACKPRESSURE` 错误码、Upgrade 身份语义），两项呈现「机制已建成但被旁路」形态（OutboundQueue 数据面被 `sendControl` 直发旁路；hub `declareHubResync` 记忆化声明被 `onAckTimeoutFired` 旁路）。逐项定位：

### G1 Authentication and connection generations（3/3 确认）

**G1.1 `accept()` 未绑定 Upgrade 受信身份 —— 存在**
- `packages/ws-replication/src/types.ts:90`：`accept(transport: DuplexTransport): HubConnection`；`types.ts:80-87` `HubReplicationOptions`（instanceId/registry/authorize/timer/limits/timeouts）**无任何 bearer-token 验证产物或受信 peer 身份入参**。
- `packages/ws-replication/src/hub-connection.ts:75-83`：`accept()` 直接构造 `HubConnectionImpl`，无认证上下文可绑定。
- 违反：ADR-0010 L155（「WebSocket upgrade 使用 bearer token 认证实例身份；token 映射到…instanceId 与 namespace 权限」）、协议 §6.1 L120。

**G1.2 HELLO wire 身份直接用于授权（冒充）—— 存在（critical）**
- `hub-connection.ts:215`：`this.peerInstanceId = message.peerInstanceId;`（HELLO 帧自述身份，无对照）。
- `hub-connection.ts:136-137`：`channelHost.peerInstanceId = () => this.peerInstanceId ?? ''` → `authorize(instanceIdentity, namespaceId)`；消费点 `hub-namespace.ts:205`（OPEN 授权）与 `hub-namespace.ts:281`（`openReplicationSession({ remoteInstanceId: this.host.peerInstanceId() })`）。
- codec 仅校验文法（`replication-protocol/src/payloads.ts:63,122` `checkInstanceId` = `INSTANCE_ID_RE`），不校验受信来源。→ 任一连接可声明他人 instanceId 获得其 namespace 权限/建立其名义 session。
- 违反：协议 §6.1 L120「peerInstanceId … **必须等于 Upgrade 身份**」；ADR-0010 L157。

**G1.3 Peer 传输回调未绑定连接代际 —— 存在**
- `peer-connection.ts:199-200`：`transport.onMessage((bytes) => this.onMessage(bytes)); transport.onClose((info) => this.onClose(info));` —— 回调闭包**未捕获当次 transport/epoch**，且 `DuplexTransport.onMessage/onClose` 返回的退订函数被丢弃（hub 侧同样丢弃，`hub-connection.ts:146-147`）。
- `peer-connection.ts:212-213`：`onMessage` 只按 `connStateValue ∈ {handshaking, ready}` 门禁 —— 重建后新连接处于这两个状态时，**旧 socket 的迟到帧直接进入新连接分发**（`dialNow` 已把 `expectedSeq` 重置为 1，`peer-connection.ts:185`，sequence=1 的旧帧可解码通过）。
- `peer-connection.ts:427-438`：`onClose` 在新连接 ready 期收到旧 socket 的 1000/1001 关闭 → `onTemporaryFailure()`（L463-480）→ **新连接被打进 backoff、`attempts+1`、全部控制器 `onConnectionLost()`**。
- `connectionEpochValue`（L44-46 注释自证设计意图「控制器异步续体以此判别迟到性」）确实只用于控制器续体（`peer-namespace.ts:143,154,254,333,727,754`），**未覆盖传输回调本身**。
- Hub 侧天然隔离（每次 `accept()` 新建独立 `HubConnectionImpl`，旧回调只触达旧实例，`hub-connection.ts:75-83,111`）→ 缺陷集中在 peer 侧重建路径（`requestRebuild` L482-503 / backoff 重拨 L476-479）。

### G2 ACK correlation and recovery（4/4 确认）

**G2.1 BOOTSTRAP_ACK 关联缺失 —— 存在**
- `hub-namespace.ts:397-403`：`sendChecked({kind:'BOOTSTRAP_SNAPSHOT',…})` 返回的帧序被丢弃，未保存。
- `hub-namespace.ts:412-423`：`onBootstrapAck(message)` 首行 `void message;` —— **`ackedSequence` 完全不校验**，任何值都执行 `bootstrapping → reconciling`。伪造/复用的 BOOTSTRAP_ACK 可推进状态机。
- 违反：协议 §8.2 L197「ackedSequence = BOOTSTRAP_SNAPSHOT sequence」；对照 UPDATE_ACK 已有完整关联（`update-channel.ts:74-86` inFlight/zombie/violation → `hub-namespace.ts:492-499` `ACK_STATE_VIOLATION` connection fatal）。

**G2.2 CLOSE_OK 关联缺失（peer 侧）—— 存在**
- `peer-connection.ts:307-309`：`case 'CLOSE_OK': this.withController(…, (c) => c.onCloseOk())` —— **丢弃 `message.ackedSequence`**。
- `peer-namespace.ts:473-481`：`onCloseOk()` 无参，`state==='closing'` 即 `setState('closed')` 并 settle close memo —— **任意/伪造 CLOSE_OK 都能完成收口**。
- `peer-namespace.ts:521-525`：`removeTarget` 发送 `CLOSE_NAMESPACE` 时丢弃 `sendChecked` 返回序，未留存待关联。
- 违反：协议 §12 L311「CLOSE_OK.ackedSequence = CLOSE_NAMESPACE sequence」。（hub 侧回 CLOSE_OK 时正确回显请求序，`hub-namespace.ts:510-514`；缺陷在 peer 侧接收校验。）

**G2.3 Hub ACK 超时不通知 Peer（恢复死锁）—— 存在（high）**
- `hub-namespace.ts:624-626`：`onAckTimeoutFired()` 仅 `this.setState('needs-resync')`，**不发送 RESYNC_REQUIRED**。
- 记忆化声明机制已存在但未被该路径使用：`declareHubResync()`（`hub-namespace.ts:612-622`，`resyncDeclared` 记忆化）只被队列溢出（L604-608）和 watchdog 边沿（L561-570）调用；代码注释 L566-569 自证语义：「hub 的声明是 peer 发起恢复 round 的唯一通路（§9.4）」。
- 后果：hub 进入 needs-resync 后**被动等待 peer round，而 peer 无任何触发** → 双方状态不对称直至连接断开。违反：协议 §9.4 L248、§18 L520（ACK timeout → needs-resync + 新 round 修复）、错误注册表 `ACK_TIMEOUT` retryable=resync（L376）。

**G2.4 ACK 超时未按「最老剩余在途」重挂 —— 存在（语义缺陷）**
- `update-channel.ts:160-168`：`armAckTimer()` 带 `ackTimerArmed` 单次挂载守卫；`onAck`（L74-79）仅在 `inFlight.size === 0` 时 disarm。**部分进度（最老在途被 ACK、窗口非空）既不复位也不重挂** —— 计时器锚定在本窗口第一帧发送时刻。
- 后果：持续流量下，`t≈T-ε` 时 flush 出的新 UPDATE 只有 ε 预算即被 `abandonInFlight()`（L141-149）整窗弃置 → 周期性假性 needs-resync（不违反安全性，但违反 §18 超时语义并放大 resync 频率）。验收项「verify correctly re-armed」判定：**未正确重挂**。

### G3 Backpressure and fairness（5/5 确认——连接级面整组未实现）

**G3.1 UPDATE 走控制帧路径 —— 存在**
- 发送链：`peer-namespace.ts:714-724` `sendUpdateFrame → sendChecked → host.sendControl`；hub 同构（`hub-namespace.ts:630-639`）。`peer-namespace.ts:40-41` 注释自证：「控制面帧（**含 UPDATE**——单 ns 场景直发路径）」。
- `OutboundQueue`（`frame-io.ts:98-189`）的 per-namespace 数据面（`dataQueues/dataOrder/dataCursor` L102-104、`drain()` 数据循环 L135-148、`nextDataNamespace` L165-171）**无任何入队 API**；`sendData(namespaceId,…)`（L124-127）`void namespaceId` 直发且**全包零调用者**（grep 证实）——数据帧与控制帧同走 `sendControl` 的控制队列（L117-121）。
- 违反：协议 §17 L490「Connection 使用 per-namespace 队列和 round-robin：control/error/ACK 高优先级，data 每轮每 namespace 最多一个」。

**G3.2 连接级 round-robin 公平调度 —— 不存在**（同上，机制死置；多 ns 时 UPDATE 顺序完全取决于 `sendControl` 调用序，控制帧与数据帧无优先级分离之外也无 ns 间公平）。

**G3.3 `maxQueuedBytesPerConnection` 与 shedding —— 不存在**
- 常量链仅三处：`types.ts:26`、`defaults.ts:24`、`validate.ts:111`（启动校验）。**零运行时引用**（grep 全 src 证实）。
- 无连接级待发字节记账、无「按最大 queued namespace 依次丢弃 → 标 needs-resync → 回低水位」逻辑。违反：协议 §17 L490。

**G3.4 控制帧保留额度与 `CONNECTION_BACKPRESSURE` —— 不存在**
- `OutboundQueue.controlQueue` 无界（`frame-io.ts:117-121` push 无上限、无保留额度核算）。
- `CONNECTION_BACKPRESSURE` 已在协议包定义（`replication-protocol/src/errors.ts:27,108`，fatal/retryable/1011）但 **ws-replication 从不发出**（grep 零命中）。违反：§17 L490 末句、§13.1 L350、§14 L389（1011 = control backpressure）。

**G3.5 bufferedAmount 高低水位 —— 不存在**
- `lowWater/highWater` 仅类型+校验（`types.ts:27-28`、`validate.ts:112-113,138-140`），无 pause/resume dequeue 逻辑；`DuplexTransport`（`types.ts:47-53`）无 bufferedAmount 面。违反：§17 L492（「Adapter 观察 bufferedAmount…无 drain event 时使用 Cordis Timer 调度检查」）。
- 对照组：**per-namespace** 侧上限已实现（`update-channel.ts:101-107` maxQueuedUpdateCount/maxQueuedUpdateBytes、L53 maxInFlightUpdates；溢出 L59-67 丢弃+needs-resync）——缺失的恰是简报要求的**连接级**聚合面。

### G4 Close, GOAWAY, and async race safety（5/5 确认）

**G4.1 CLOSE 不同步停接纳 —— 存在（双侧，peer 侧实质违例）**
- hub：`hub-namespace.ts:501-518` `onCloseRequest` 把 `setState('closing')` 放进 `closeQueue.then(...)` 异步续体——**非帧分发同步段**（微任务延迟；依赖「WS 回调是宏任务」才未实际漏纳）。
- peer：`peer-namespace.ts:457-471` `onCloseRequest` **完全不设置 'closing'**，直接进入 async drain；drain 期间 state 仍为 live/needs-resync，`onHubUpdate`（L425-443）照常接受并 apply 新 UPDATE（`isQuietState()` L871-878 不含当前态）。
- 违反：协议 §12 L304「Receiver **同步**停止 session 接纳」、§16 L475（「收到 CLOSE 或终止 ERROR 时同步停止接纳…未接纳 frame 视为 closing violation」——peer 现状把收后帧当正常流量处理）。

**G4.2 已接纳 apply 的 drain 完整性 —— peer 侧存在缺口**
- `peer-namespace.ts:887-889` `drainPendingApplies` 以 `[...this.pendingApplies]` 快照（在 async IIFE 首个 await 前同步取得）；由于 G4.1（不停接纳），**CLOSE 之后快照之后接纳的 apply 不在 drain 集合内**，与 `closeSessionAndRelease()` 并发（其正确性最终依赖 Runtime close barrier 的兜底，而非本层纪律——违反「apply settle 后才 cleanup」的通道层保证）。hub 侧快照完备性靠微任务时序成立，但同样非同步段（见 G4.1）。

**G4.3 迟到 round 结算复活 closing —— 存在（hub 单侧）**
- `hub-namespace.ts:725-737` `onRoundSettled`：守卫仅 `if (!this.isTerminal())`（L731）——**'closing' 不在终态集**（`isTerminal` L769-773 = closed/conflicted/failed）→ `setState('live')`（L732）+ `channel.resetForLive()`（L733，flush 队列可再发 UPDATE）+ `resyncDeclared=false` 清记忆化。
- 可达路径：Step2 apply 在途时收到 CLOSE → close 链 drain 等待该 apply → apply settle 触发 `checkSettled → onRoundSettled` → closing 被复活（随后又被 close 链压回 closed，状态抖动 + 收口期外发帧风险）。
- peer 侧已正确防护（`peer-namespace.ts:615-623`：`state !== 'reconciling'` 早退，B-1 注释明确该纪律）——**双侧不对称**，hub 缺同款守卫。

**G4.4 GOAWAY/blocked 不同步静默 channel/订阅 —— 存在**
- `peer-connection.ts:342-353` `onGoaway`：`SERVER_SHUTTING_DOWN/REAUTH_REQUIRED` 分支仅 `this.setState('blocked')` 后 return——**未走 `enterBlocked()`**（L452-461 才会通知全部控制器 `onConnectionFatal()`），namespace 停留 live 投影、`UpdateChannel` 状态、`session.subscribeOwnedUpdates` 订阅全部保留。
- `SERVER_RESTARTING` 分支 `scheduleDrainClose()`（L357-365）：timer 句柄未保存（stop()/重拨不可清除）、`goawayDrainMs`（L355）跨连接残留。
- 违反：协议 §6.3 L147、§15.1 L411（GOAWAY → draining）；CONTEXT「停接纳」词条（channel/session 层同步停接纳为同构方向）。

**G4.5 closing 期重复 OPEN waiter 悬挂 —— 存在（hub 侧）**
- `hub-namespace.ts:160-167`：`onOpen` 的 'closing' 分支把「close 后回 `NAMESPACE_REOPEN_REQUIRES_RECONNECT`」的 waiter push 进 `openWaiters`；但 close 完成路径（`onCloseRequest` L501-518 / `finalize` L762-767 / `onConnectionClosed` L533-539）**从不 flush `openWaiters`** → 该 OPEN 永无响应（peer 只能靠 openTimeout 收口 failed）。
- 违反：协议 §7.1 L164「每个请求都收到 OPEN_OK 或 ERROR」。（'opening' 合流 waiter 由 `flushOpenWaitersOk`/`finishOpenError`/`finishOpenSilently` L326-352 覆盖——仅 closing 案例悬挂。）

### G5 Liveness and testability（3/3 确认）

**G5.1 WS ping/pong 活性未接线 —— 存在**
- 全包零 `ping/pong/bufferedAmount` 面（grep src 零命中）；`ReplicationTimeouts`（`types.ts:31-38`）无 `pingIntervalMs/pongTimeoutMs`；`DuplexTransport` 无活性钩子；`apps/` 无宿主适配。
- 现有 `FenceWatchdog`（`fence-watchdog.ts`）是 **session 状态探测**（fence/needsResync 谓词），非 socket 活性。静默死链（NAT 超时等无 close 帧场景）将使连接永驻 ready、通道永驻 live。
- 违反：协议 L40「活性检测只使用 WebSocket ping/pong。协议不定义业务 PING/PONG frame」、§18 L518-520（「HELLO/pong timeout 关闭连接」）；ADR-0010 L147（「WS ping/pong 负责活性」）。（注意：修复不得引入应用层 PING/PONG 帧——协议明确禁止。）

**G5.2 生产 `queueMicrotask` 延迟环 —— 存在**
- `peer-namespace.ts:637-657` `onAckTimeoutFired`：`deferRecovery()` 递归链式 `queueMicrotask`，**至多 512 次让步后才 `maybeStartRecovery()`**；注释自证目的是「保证测试的 settleUntil 至少观察到一次 needs-resync 投影」——生产代码为测试可观测性引入非确定延迟。
- 次要同类：`peer-connection.ts:499-503` `requestRebuild` 用裸 `queueMicrotask` 延迟 `dialNow()`（非注入 seam）。（`src/testing.ts` 与 `test/harness.ts` 中的 queueMicrotask 属测试载体，不在本项范围。）
- 违反：ADR-0009 L83（确定性测试使用注入 Clock/fake timer 协调推进）、协议 §15.1 L431（「Scheduler 和 random 必须注入测试 seam」）。

**G5.3 死抽象（应删除或启用，确保单一权威机制）—— 存在，4 处**
- `lifecycle-queue.ts:7-24` `LifecycleQueue`：**全包零引用**（仅 `Memoized` 被 `peer-namespace.ts:14` 使用；hub 用内联 `closeQueue` promise 链 `hub-namespace.ts:83`，peer 用 `Memoized`+`cleanupTail`——两套并存本身就是「非单一权威机制」）。
- `frame-io.ts:102-104,124-127,135-148,159-171`：`OutboundQueue` 数据面（dataQueues/dataOrder/dataCursor/drain 数据循环/`sendData`）——无入队 API、`sendData` 零调用者（详见 G3.1）。
- `hub-namespace.ts:82`：`cleanupTail` 声明后从未使用。
- `types.ts:172-178`：`NamespaceChannelCore` 接口零实现零引用（round-engine/update-channel 实际经各自 Host 接口回调）。

### G6 Delivery clarification（澄清结论：三者均未交付，非本包缺陷，需按简报开票）

| 项 | 现状 | 证据 | 处置建议 |
|---|---|---|---|
| `resetReplica` | **Registry 侧已交付**（`packages/namespace-registry/src/registry.ts` 含 resetReplica，phase5-bootstrap-archive-reset 切片）；ws-replication 的 needs-resync 恢复走 state-vector round（协议 §18 L520），conflicted→reset 编排按 ADR-0006 L211 属调用方（Registry 受信编排） | grep 命中 registry 源+测试 | 开跟踪票说明「transport 不负责 reset 编排」，避免误当缺陷 |
| 结构化 observability（ADR-0010 L167 最小观测面） | **未交付**：`index.ts` 导出面零观测 API；两 Options 无 observer 字段；connectionId（协议 §6.2 L137）已生成但无消费面 | `src/index.ts` 全文 | 独立实现票（连接/通道状态、字节、latency、backpressure resync 等最小面） |
| apps/yjs-server 组合根（ADR-0010 L175 切片 9） | **未交付**：`apps/` 仅 README.md + AGENTS.md；无真实 WS 适配（DuplexTransport 无 bufferedAmount，G3.5/G5.1 的宿主侧前提不存在） | `ls apps/`；`peer-connection.ts:344` 注释「slice 9 前不做 deadline 完整编排」 | 留切片 9；G3.5/G5.1 的修复需为其预留 seam 而非在包内补宿主 |

**Fix direction**（供 SA1 设计参考，不展开实现方案）：
1. G1：为 `accept()`/Options 引入 Upgrade 认证产物（受信 peerInstanceId 或 token→identity 解析结果）作为唯一授权依据，HELLO 自述身份与之不符即 `INSTANCE_IDENTITY_MISMATCH`(1008)；peer 侧在 `dialNow` 捕获当次 transport/epoch 的回调闭包（或先退订旧 transport），message/close 回调先验代际再进入共享 FSM。
2. G2：通道留存 BOOTSTRAP_SNAPSHOT/CLOSE_NAMESPACE 发送序并在 ACK 接收路径校验（错配走既有 violation 策略）；hub ACK 超时复用 `declareHubResync` 记忆化声明；`UpdateChannel` 在「最老在途被 ACK 且窗口非空」时重挂 ack timer。
3. G3：给 `OutboundQueue` 补数据入队 API 并让两侧 UPDATE 走之；连接级字节记账 + 按 ns shedding 回低水位 + 控制保留额度耗尽发 `CONNECTION_BACKPRESSURE`(1011)；transport 面暴露 bufferedAmount 观察点，经注入 Cordis Timer 做 high/low-water 暂停与恢复。
4. G4：CLOSE/GOAWAY 处理器在帧分发同步段先行进入 closing/draining 并停接纳/静默 channel 与订阅，再串行 drain→cleanup；hub `onRoundSettled` 补 closing 守卫（对齐 peer B-1）；close 终局统一 flush/settle `openWaiters`。
5. G5：传输/host 集成补 WS ping/pong 活性配置与超时收口（禁应用层帧）；`deferRecovery` 微任务环与 `requestRebuild` 延迟改为注入 seam；删除 `LifecycleQueue`、`OutboundQueue` 死数据面或 `cleanupTail`、`NamespaceChannelCore`，收敛为单一权威调度/生命周期机制。
6. G6：为 observability 与 apps/yjs-server（切片 9）开/链接独立票，注明 resetReplica 编排归属。

## Evidence

关键代码摘录（均为当前 worktree 实测行号）：

```ts
// G1.2 hub-connection.ts:215（onHello 尾段）——wire 自述身份直接成为授权身份
this.peerInstanceId = message.peerInstanceId;
// hub-connection.ts:136-137
peerInstanceId: () => this.peerInstanceId ?? '',
authorize: (instanceIdentity, namespaceId) => hub.authorize(instanceIdentity, namespaceId),

// G1.3 peer-connection.ts:199-200 —— 回调未绑代际，退订句柄被丢弃
transport.onMessage((bytes) => this.onMessage(bytes));
transport.onClose((info) => this.onClose(info));
// peer-connection.ts:185 —— 新连接重置序列期望，旧 socket 迟到 seq=1 帧可被接受
this.expectedSeq = 1;

// G2.1 hub-namespace.ts:412-413
onBootstrapAck(message: { ackedSequence: number }): void {
  void message;   // ← ackedSequence 完全未校验

// G2.2 peer-connection.ts:308 —— CLOSE_OK 丢参
this.withController(message.namespaceId, (c) => c.onCloseOk());
// peer-namespace.ts:473-481 onCloseOk() 无参：'closing' 态任意 CLOSE_OK 即完成收口

// G2.3 hub-namespace.ts:624-626 —— ACK 超时只改本地态，不发 RESYNC_REQUIRED
private onAckTimeoutFired(): void {
  if (!this.isQuietState()) this.setState('needs-resync');
}
// 对照：declareHubResync（L612-622，记忆化 RESYNC_REQUIRED）仅由溢出/watchdog 调用

// G2.4 update-channel.ts:74-79 + 160-168 —— ack timer 单次挂载，部分进度不重挂
if (this.inFlight.has(sequence)) { this.inFlight.delete(sequence);
  if (this.inFlight.size === 0) this.disarmAckTimer();  // 仅清空才 disarm
  ... }
private armAckTimer(): void { if (this.ackTimerArmed) return; ... }

// G3.1 peer-namespace.ts:40-41 注释自证 UPDATE 走控制面
/** 控制面帧（含 UPDATE——单 ns 场景直发路径）；返回分配帧序。 */
// frame-io.ts:124-126 sendData 死代码（无入队 API、零调用者）
sendData(namespaceId: string, message: ReplicationMessage): number {
  void namespaceId; return this.emitOne(message); }

// G4.1 peer-namespace.ts:457-471 —— onCloseRequest 不设 closing，直接 async drain
onCloseRequest(message): void {
  if (this.isQuietState()) return;
  void (async () => { await this.drainPendingApplies(); ... })();  // 无同步停接纳
// hub-namespace.ts:503-505 —— setState('closing') 在 closeQueue.then 微任务内

// G4.3 hub-namespace.ts:731-735 —— 仅判终态，'closing' 可被复活为 live
if (!this.isTerminal()) { this.setState('live'); this.channel.resetForLive(); ... }

// G4.4 peer-connection.ts:347-349 —— GOAWAY blocked 只改连接态，不静默 namespace
if (message.reasonCode === 'SERVER_SHUTTING_DOWN' || ...) {
  this.setState('blocked'); return;   // 未调用 enterBlocked()（不通知控制器）

// G5.2 peer-namespace.ts:644-655 —— 512 次链式 queueMicrotask（测试可观测性目的）
const deferRecovery = (): void => {
  queueMicrotask(() => { attempts += 1;
    if (attempts >= 512) { if (this.state === 'needs-resync') this.maybeStartRecovery(); }
    else { deferRecovery(); } }); };
```

Grep 汇总（`packages/ws-replication`，src+test）：
- `maxQueuedBytesPerConnection|lowWater|highWater`：src 仅 `types.ts`/`defaults.ts`/`validate.ts`（类型+校验），**零逻辑引用**。
- `CONNECTION_BACKPRESSURE`：ws-replication src **零命中**（仅协议包 errors.ts 定义）。
- `ping|pong|bufferedAmount`：src **零命中**。
- `LifecycleQueue`：src 仅自身定义文件；`sendData`：仅 frame-io.ts 定义零调用；`cleanupTail`（hub-namespace）：仅声明行；`NamespaceChannelCore`：仅 types.ts 声明。
- `queueMicrotask`：src 命中 `peer-namespace.ts:646`（延迟环）、`peer-connection.ts:499`（rebuild 延迟）、`testing.ts:18,25`（测试载体，非缺陷）。

Git 证据：`git log --oneline -1` → `6f2676f Merge pull request #160 …`（整包 ws-replication 由 PR #160 引入，缺陷为新增功能缺陷而非回归）。工作区状态：除 4 个新增 wiki 任务文件与 `.mabf-dispatch-ts` 外无源码改动（`git status --short` 证实，SA5 零残留）。

测试基线：`./node_modules/.bin/vitest run packages/ws-replication`（repo root）→ **12 test files / 82 tests 全部通过，typecheck 无错误，exit 0**（AC1-AC7、R3-R4 regressions、SA4-red、SA7-dynamic、spec-b1-b2 全绿）——证明上述缺陷均为**未覆盖的缺口**而非已知失败；简报验收项「Existing PR #160 acceptance tests remain green」当前成立。

协议锚点速查：§6.1 L120（HELLO 身份=Upgrade）、§6.3 L147（GOAWAY）、§7.1 L164（OPEN 必答）、§8.2 L197（BOOTSTRAP_ACK 关联）、§9.4 L248（恢复由 peer 发起）、§12 L304-313（CLOSE 同步停接纳/CLOSE_OK 关联）、§13.1 L350（CONNECTION_BACKPRESSURE）、§15.1 L411/L431（GOAWAY→draining；seam 注入）、§16 L475（同步停接纳）、§17 L490-492（公平/背压/水位）、§18 L518-520（ping/pong、ACK timeout）、L40（活性仅 WS ping/pong）。

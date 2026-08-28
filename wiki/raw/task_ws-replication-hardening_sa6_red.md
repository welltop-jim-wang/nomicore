# SA6 红灯契约 — issue #161 ws-replication 协议加固（PR #160 post-review）

**Status**: red-tests written & verified | **Date**: 2026-08-28
**SA6 产出**（仅测试，零生产代码改动）：

| 文件 | 覆盖 |
|---|---|
| `packages/ws-replication/test/ws-replication-sa6-hardening-g1-g2-red.test.ts` | AC1（G1.2 伪造 HELLO 身份）/ AC2（G1.3 旧 socket 迟到回调 ×2）/ AC3a（G2.1 伪造 BOOTSTRAP_ACK）/ AC3b（G2.2 伪造 CLOSE_OK）—— 5 例 |
| `packages/ws-replication/test/ws-replication-sa6-hardening-g3-g4-red.test.ts` | AC4（G2.3 Hub ACK 超时 → RESYNC + Peer 恢复收敛 ×2）/ AC5（G3 round-robin · 高低水位 · 控制优先 · shedding ×4）/ AC6（G4 CLOSE 同步停接纳 · 排空 · 终态不可复活 · OPEN waiter flush ×4）—— 10 例 |

**红灯命令**（repo root）：
```bash
./node_modules/.bin/vitest run packages/ws-replication
```
当前基线：**15 failed（两新文件全部红灯）/ 82 passed（PR #160 既有测试含 SA4/SA7 红灯全部保持绿）/ Type Errors none / `git diff --check` 通过**。全部测试零 real sleep（fake scheduler + 门闩 + 微任务驱动），单文件运行 < 3s。

## 逐条红灯锚（现实现行为 → 断言期望）

| # | 缺陷 | 现实现可观测行为（红灯证据，来自实际运行） | 断言（修复后应为真） |
|---|---|---|---|
| AC1 | G1.2 身份冒充 | `authorize` 以 HELLO 自述身份 `peer-loki` 被调用 1 次（`expected [ {…} ] to have a length of +0 but got 1`）；连接状态 'ready' 而非收口 | 冒充在命名空间授权前被拒（authorize 零调用 + 连接 1008/ERROR `INSTANCE_IDENTITY_MISMATCH`） |
| AC2a | G1.3 迟到 message | 新连接（重建后）被旧 socket 迟到帧打进 `blocked`（`expected 'blocked' to be 'ready'`） | 新连接保持 ready/live；旧 socket 帧被代际隔离 |
| AC2b | G1.3 迟到 close | 新连接被旧 socket 迟到 close 打进 `backoff`（`expected 'backoff' to be 'ready'`） | 新连接保持 ready |
| AC3a | G2.1 BOOTSTRAP_ACK 关联 | hub 零 ERROR 帧（`expected [] to include 'ACK_STATE_VIOLATION'`）——伪造 ackedSequence 被静默采信、状态机推进 | 错配 ACK 走违例策略（ERROR `ACK_STATE_VIOLATION` / connection fatal `blocked`） |
| AC3b | G2.2 CLOSE_OK 关联 | 伪造 ackedSequence 使 peer 立即 `closed`（`expected 'closed' not to be 'closed'`）、removeTarget 完成 | 错配 CLOSE_OK 不完成 close（保持 closing 或停连接）；close 只由关联帧/closeTimeout 收口 |
| AC4-1 | G2.3 恢复死锁 | hub ACK 超时后 wire 零 RESYNC_REQUIRED（`expected [] to have a length of 1 but got +0`）；hub 仅置本地 needs-resync | hub 记忆化声明 RESYNC_REQUIRED（§18 L520） |
| AC4-2 | G2.3 恢复收敛 | peer 停留 live、零恢复 round（`settleUntil 预算耗尽：等待 peer 发送 SYNC_STEP1×2，当前 1`） | peer 收到 RESYNC → needs-resync → roundId+1 → diff 收敛（n=9 双侧一致） |
| AC5-RR | G3.1/3.2 round-robin | burst A,A,B,B → wire 序 A,A,B,B（`to deeply equal` 失败）——UPDATE 走控制 FIFO | 每轮每 ns 至多一帧：A,B,A,B |
| AC5-WATER | G3.5 高低水位 | 越过 highWater（4KiB）后仍 dispatch 3 笔数据帧（`expected [ { kind: 'UPDATE', …(2) }, …(2) ] to have a length of +0 but got 3`） | 高于 highWater 暂停数据出队；释放回低水位以下恢复（注入 timer 检查） |
| AC5-PRI | G3.4 控制优先 | 暂停窗口内数据帧与 ACK 混排 dispatch（`… got 2`） | 暂停期间只 dispatch 控制/ACK 帧，数据帧零 |
| AC5-SHED | G3.3 连接级 shedding | 超限（64KiB）后零 shed 信号（`expected 0 to be >= 1`）——`maxQueuedBytesPerConnection` 纯死配置 | 弃置最大排队 ns + needs-resync 声明（RESYNC_REQUIRED 或 `CONNECTION_BACKPRESSURE`(1011) 至少一帧） |
| AC6-1 | G4.1 同步停接纳 | peer CLOSE 分发后状态停留 `live`（`expected 'live' to be 'closing'`）——onCloseRequest 不进 closing | CLOSE 帧分发同步段即进入 closing |
| AC6-2 | G4.1/4.2 排空 | CLOSE 之后到达的 UPDATE 被接纳并应用（`expected 7 to be 6`） | CLOSE 后 UPDATE 不应用；已接纳 apply 排空后才收口 |
| AC6-3 | G4.3 终态复活 | hub 通道状态采样序列实测 `live → closing → live → closed`（`expected [ 'closing', 'live', 'closed' ] to equal [ 'closing', 'closed' ]`）——closing 被迟到 round 结算复活 | `['closing','closed']`；onRoundSettled 补 closing 守卫 |
| AC6-4 | G4.5 OPEN waiter | closing 期重复 OPEN 后零 ERROR 回复（`expected [] to include 'NAMESPACE_REOPEN_REQUIRES_RECONNECT'`） | close 完成后 flush 答复（§7.1 每 OPEN 必答） |

## 确定性方法（全部零 real sleep / 零源码 grep）

- **复用既有基建**：真实 yjs / Registry / Runtime（`test/harness.ts` + `test/driver.ts`），
  fake-duplex 微任务投递 + fake scheduler（`createRegistryTestScheduler`）+ 单次门闩
  （StubPersistence.saveGate/importHold）控制竞态窗口。
- **自制「慢 socket」栅门 transport**（仅测试文件内，行为观测面）：
  `send()` 只计入 socket 缓冲并记录 dispatch 日志（可读 `bufferedAmount`/heldBytes），
  test 侧 `setGate(true)` / `releaseAll()` 控制投递——AC5 水位/优先级/shedding 全靠它
  在没有真实 WebSocket 的情况下确定性制造「停留缓冲」的流量形态。修复侧若将
  `bufferedAmount` 加入 `DuplexTransport` 冻结面，本 harness 的 `hubEnd` 已带该字段。
- **代际/竞态锚**：AC2 走 `removeTarget → addTarget`（closed 后整连接重建 §14.1）得到旧
  socket；经旧 wire 的 hubEnd/closeHubSide 注入迟到帧与关闭事件（旧 transport 回调在现
  实现未退订——回调仍可达共享 FSM）。AC6-3 用「peer 出站 ACK 超时 → 干净恢复 round 2
  （零丢帧、无序列 gap）+ hub 侧双门闩（gate1 挂 UPDATE apply、gate2 挂 Step2 apply）+
  逐微任务采样 hub 通道状态」确定性复现 `closing → live → closed` 抖动；hub 通道状态无
  公开 API，经运行时对象图只读投影观测（非源码断言）。
- **序列纪律**：手工注入帧均遵守 driver 的「静默期注入」不变量；AC6-3 的恢复 round 用
  真实 RESYNC 路径（F1 溢出 → declareHubResync）而非手工注入（避免注入帧与真实出站
  序列撞号——初版踩过，已修正）。

## 给 SA3 的实现提示（仅观察，不锁定修复方案）

- AC1 的受信身份注入点：测试按 `accept(transport, { peerInstanceId })` 形状传参（现实现
  忽略该参数——按 SA5 修复方向 #1 为 `accept()`/Options 引入 Upgrade 认证产物；若落点在
  Options，SA3 同步调整该调用处，断言面不变）。
- AC3a/AC3b 的违例策略沿用 UPDATE_ACK 先例（`ACK_STATE_VIOLATION` connection fatal）；
  若 SA3 选择「忽略并等待正确 ACK」策略，则把 AC3a 断言改为「停留 bootstrapping →
  bootstrapTimeout → failed」（行为等价的另一锚），AC3b 保持「不完成 close」。
- AC5-WATER/PRI 的暂停检查点（注入 timer）与高低水位阈值取自 `ReplicationLimits`
  （lowWater/highWater 现仅类型+校验，零逻辑引用——本测试是它们的第一批行为锚）。
- AC6-3 断言 `['closing','closed']` 要求 onRoundSettled 在 closing 态早退（对齐 peer 侧
  B-1 守卫），或等效地把 closing 纳入不可复活集合实现。

## R2 调整段（SA2 §3.8 裁决一次下发，2026-08-28 复测）

调整依据：`wiki/raw/task_ws-replication-hardening_design.md` §3.8 测试构造裁决清单（SA2 R1/R2
通过）。落地后复测：`./node_modules/.bin/vitest run packages/ws-replication` →
**21 failed（全部红灯，含 6 项补充锚）/ 82 passed（PR #160 既有全绿）/ Type Errors none**（103 例）。

### 裁决 1：AC5-RR 替换构造（原构造在规约合规实现下恒绿=伪红）

- 原构造「顺序写 a×2 → b×2」在 hub session fanout 泵（每项投递前让步 ~20 微任务）下四帧从
  不同时在队——round-robin 只约束同时排队帧，合规实现下旧断言照样成立（伪红）。替换为
  「水位暂停期排队 → gate 解除释放 → 恢复 drain」形态（§3.8 裁决 1 原文），断言面不变
  （`[a, b, a, b]` + 4 帧）。**A4 强制修正已并入**：`releaseAll()` 不解除 gate，恢复前必须
  `setGate(false)`（否则恢复派发滞留 held、`updates=[a]` 恒红）。
- 现实现复测：前置锚（暂停期零数据派发）0 vs 3 → 红（UPDATE 走控制 FIFO 的缺陷仍在）。

### 裁决 2：AC1 第二锚替换断言组（A3 定案）

- 原断言 `hub.connections[0]?.state === 'closed'` 在 fatal→cleanupAll（≈2 跳）→dropConnection
  生命周期下于 600 跳后恒红（连接已摘除，`connections[0]` 为 undefined）。按 A3 替换为：
  `wire.hubSideClosed === true` + `hub.connections` 长度 0（保留 prompt-drop 生产语义）。
- 现实现复测（独立探针）：`hubSideClosed=false`、`connections=1`、wire 帧
  `HELLO_ACK,OPEN_OK,BOOTSTRAP_SNAPSHOT`（零 INSTANCE_IDENTITY_MISMATCH）→ 三断言各自独立为红 ✓。

### 六项补充锚（SA2 §五建议，随 §3.8 一并下发；实测均红）

| 锚 | 构造 | 红证（现实现可观测） |
|---|---|---|
| A1 窄锚 | gated 单 ns + tiny highWater(16)/lowWater(8)：首帧派发 → advanceBy(100) 检查点 → 第二笔零 dispatch | 前置派发断言 0 vs 1 |
| A2 滞回锚 | 先置停（checkpoint 暂停）再突发 16 笔（8KiB）：连接级排队增长 → 滞回触发（超 maxQueuedBytesPerConnection 按最大 ns 整队丢弃至 ≤ lowWater）→ 恢复后仅残余（≤2 帧）派发 + RESYNC 声明 | 暂停期零派发断言 0 vs 16（现有实现无暂停恒派发）；RESYNC 零帧 |
| A2 单检查点 1011 锚 | 循环内仅 settle（检查点不运行、无暂停）→ 10×8KiB 全派发（held ≈80KiB > 64KiB 上限）∈ 队列空 → **单次 advanceBy** 检查点 A+C 并列评估 → CONNECTION_BACKPRESSURE(1011)（ERROR 帧 + close(1011) + peer backoff 分类） | ERROR 0 帧；传输未关 |
| A5 语义锚 | hub ACK 超时（cap=1 窗口 + 2 排队）→ 自声明 RESYNC → 恢复后**该批排队 UPDATE 保留派发**（总 3 帧）+ 迟到 ACK zombie 容忍（无 fatal） | RESYNC 0 帧（恢复死锁） |
| A6 行为锚 | 三帧窗口（maxInFlight=3）：u1 派发于 t0 → peer gate 悬挂（首 ACK 延至 t0+100）→ u2/u3 入窗口（u3 快 ACK）→ u1 ACK（最老在途清、窗口非空 {u2}，计时器须重挂至 +100+200）→ 越原 deadline（+200）不得 fire | hub 通道 'needs-resync'（整窗弃置——现实现单次挂载、部分进度不重挂）vs 期望 'live' |
| A7 记账锚 | paused 期大量入队（窗口 8 + 23 笔 8KiB）→ 恢复单轮派发 ≤ maxInFlightUpdates（inFlight+pendingData 窗口不变量） | 暂停期零派发断言 0 vs 7（现实现无暂停恒派发；窗口侧 8 满后余量入通道队列，无 A7 面） |

**补充锚注释**：A1/A2/A7 的第一红锚落在「暂停/检查点」前置锚（现实现无水位面——该组行为
整体缺失）；锚内的修复侧断言（恢复后 ≤ lowWater 残余、恢复轮 ≤ maxInFlightUpdates、窗口
不弃置）为设计 §3.1–§3.5 的验收面，SA3 实现并转绿后按 §3.6/§3.7 推演核验。A2-1011 的 C
规则按 A2-3 定案为**与 A 规则同检查点并列评估**（不依赖第二次 checkpoint）——测试即按单次
advanceBy 断言。A5/A6 双门闩时钟结构（gate 换挂 + advanceBy 拆分派发/ACK 时刻）与 AC6-3
同族，零 real sleep。

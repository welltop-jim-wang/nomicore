# SA5 缺陷分析 — PR #165 八项 review 修订（round 2）

**Status**: analyzed | **Date**: 2026-08-30
**Severity**: high（8 项中 5 项为协议正确性/资源收口缺陷，2 项为确定性测试基建，1 项为权威文档缺口）
**Type**: new-feature-defect（PR #165 增量 review 修订；非回归——均为现实现已知边界口径的收紧）
**Layer**: backend（`packages/ws-replication`）+ architecture（docs 权威面）
**Worktree**: `/home/wangjian/nomicore-fix-issue-161`（branch `fix/issue-161-on-docs-phase-5-websocket-replication`，基线 commit `0a18661`）

## 0. 范围与方法

对 PR #165 review 提出的 8 项修订逐条做证据映射：修订要求 → 现实现缺陷定位（file:line）→ 现有测试锚 → 拟议验收断言 → 影响文件 → 依赖联动。阅读面：`src/frame-io.ts`、`src/update-channel.ts`、`src/peer-connection.ts`、`src/hub-connection.ts`、`src/hub-namespace.ts`、`src/peer-namespace.ts`、`src/liveness.ts`、`src/types.ts`、`src/defaults.ts`、`src/validate.ts`、`test/driver.ts`、`test/ws-replication-sa6-hardening-g3-g4-red.test.ts`、`test/ws-replication-sa7-hardening-dynamic.test.ts`、`docs/protocols/instance-replication-v1.md`、`docs/adr/0010-*`、`docs/phases/phase-5-*`。零源码/测试改动（本分析只写 wiki/raw）。

行号基线：commit `0a18661`（如后续 commit 变动，以符号名 + 行号区间定位）。

## 1. 总览表

| # | 修订主题 | 缺陷定位 | 严重度 | 影响文件（src / test / docs） |
|---|---|---|---|---|
| R1 | cap/low-water 严格接纳保证 | frame-io.ts:161-175（enqueueData 断点接纳） | high | frame-io.ts；g3-g4-red AC5-SHED/A2 锚 |
| R2 | 真实有界控制帧保留额度 | frame-io.ts:237-256（runCheckpoint 规则 C）+ 125（controlQueue 无记账） | high | frame-io.ts、types.ts（可选新 limit）；g3-g4-red A2-1011 锚 |
| R3 | GOAWAY/blocked 同步静默订阅（双侧） | hub-namespace.ts:557-567/856-877；peer-namespace.ts:624-631/981-988；peer-connection.ts:436-467/577-595 | high | hub-namespace.ts、hub-connection.ts、peer-namespace.ts、peer-connection.ts；sa7-dynamic D5 |
| R4 | peer pong 超时关传输 + 代际安全脱离 | peer-connection.ts:345-350（onPongTimeout）→ 597-615（onTemporaryFailure 不 close/不脱离） | high | peer-connection.ts、liveness.ts；sa7-dynamic D4、driver.ts |
| R5 | round-robin 有界整轮扫描 | frame-io.ts:205-210（drain 头部 ns 阻塞即 return） | medium | frame-io.ts；sa7-dynamic D3（需收紧） |
| R6 | UpdateChannel 溢出计入 pending handoff | update-channel.ts:127-133（overflows） | medium | update-channel.ts；新增锚（A7 系） |
| R7 | 确定性 seam：重建不硬编码 queueMicrotask；driver 去 512 跳 | peer-connection.ts:638（requestRebuild 硬编码）；test/driver.ts:395-408（TEST_DEFER 512） | medium | peer-connection.ts、driver.ts、peer-namespace.ts:685-694 注释 |
| R8 | 权威文档四缺口 + 陈旧叙事清理 | docs/protocols/instance-replication-v1.md §2/§17/§18、docs/adr/0010 L141-167、docs/phases/phase-5 L75-83 | medium | docs 三件 + types.ts/defaults.ts 注释对齐 |

## R1 — cap/low-water 严格接纳保证（frame-io.ts 161-175）

**修订要求**：shedding 之后，若接纳 incoming 帧会违反字节约束，则**绝不接纳**；断言须落到字节级。

**现缺陷**：`OutboundQueue.enqueueData()`（frame-io.ts:155-177）。触发面检查在 L161：`pipelineBytes() + bytes > maxQueuedBytesPerConnection` 时先 shed 到 `queuedDataBytes ≤ lowWater`（L162-166）；但 shed 循环结束后**无条件接纳 incoming**（L173-174 `push + queuedDataBytes += bytes`）。L167-169 注释明示这是有意口径：「queued 侧已压到 ≤ lowWater…而总队列仍 > max：无可 shed 面——按断点接纳（不丢弃 incoming）」。后果：

1. `bufferedAmount` 大（socket 缓冲滞留）时，queued 侧可能已 ≤ lowWater 甚至为空，但 `pipelineBytes()` 仍 > max —— incoming 仍被接纳，连接级总字节持续超 `maxQueuedBytesPerConnection`，只在下一检查点由规则 C（R2）兜底；
2. 单帧 `bytes > maxQueuedBytesPerConnection`（队列全空）也被接纳；
3. 接纳帧本身不产生任何 shed/needs-resync 显影（A7「不允许静默吞帧面」的镜像违规：超限接纳同样无声明）。

**现有测试锚**：`ws-replication-sa6-hardening-g3-g4-red.test.ts` A2 滞回锚（L668-697）以 `updateCount ≤ 2` 容忍「首帧缓冲 + **断点接纳帧**」——即当前测试**固化了**宽松口径；AC5-SHED（L488-516）只断言 wire 信号计数（`resyncCount + backpressureCount ≥ 1`），无字节断言。

**拟议验收断言**（字节级）：
- A1a（严格不变量）：gate 置停（buffered 钉高）+ 连续突发后，对每个可观测时点，恢复释放后实际派发的 UPDATE 字节总和 ≤ `lowWater + maxUpdateBytes` 之外不新增——精确形式：`Σ(释放后派发 UPDATE bytes) ≤ lowWater`（无断点帧），且 shed 信号（RESYNC_REQUIRED）≥1；
- A1b（超限拒纳）：构造单帧 `bytes > maxQueuedBytesPerConnection`（空队列）→ 该帧不被派发（wire 零该帧）、该 ns 产生 onDataShed 显影（needs-resync 声明）、`OutboundQueue.lastSequence` 不为该帧分配序号；
- A1c（byte-level 观测面）：断言基于 `wire.deliveredToPeer`/`heldBytes` 的字节求和（decode 后逐帧 `update.byteLength`），非帧计数；必要时经对象图只读观测 `outbound.queuedDataBytes`（既有 `hubChannelStateOf` 同款只读投影模式，不改生产 API）。
- 现有 A2 锚须同步收紧：`toBeLessThanOrEqual(2)` → `toBeLessThanOrEqual(1)`（或精确值），注释删除「断点接纳帧」表述。

**影响文件**：`src/frame-io.ts`（enqueueData 收口分支）；`test/ws-replication-sa6-hardening-g3-g4-red.test.ts`（A2/AC5-SHED 收紧 + 新字节锚）。

**依赖联动**：拒纳路径必须走 `deps.onDataShed(namespaceId)`（与 R6 的 needs-resync 声明链一致）；`maxUpdateBytes ≤ maxQueuedBytesPerConnection` 的配置关系在默认值下成立（512KiB ≪ 8MiB），但 validate.ts 目前不校验该关系——若依赖它保证「单帧必可接纳」，需在 R8 文档/校验面明示（或按 A1b 直接拒纳，不依赖该关系）。

## R2 — 真实有界控制帧保留额度（frame-io.ts 237-253）

**修订要求**：独立跟踪/保留控制帧容量；额度耗尽 → `CONNECTION_BACKPRESSURE` 终止。

**现缺陷**：控制面完全无字节记账、无上限：
- `controlQueue`（frame-io.ts:125）无 bytes 计数；`sendControl()`（L148-151）无任何容量检查，控制帧恒排空（「控制恒先于 data」）；
- 规则 C（runCheckpoint L247-253）只在 `buffered > maxQueuedBytesPerConnection && largestQueuedNamespace() === undefined` 时调 `onControlExhausted()` —— 即**只有当数据面已无物可 shed** 才触发。有排队数据时控制帧可无界堆入 socket 缓冲（控制路径不受 `paused` 约束），"保留额度"并不存在；
- 协议 §17 L490 已写明「Control frame有独立保留额度，耗尽为 `CONNECTION_BACKPRESSURE`」——即这是**协议既有权威句**，代码未真实实现。

**终止接线已存在**：hub-connection.ts:161 与 peer-connection.ts:229 均为 `onControlExhausted: () => this.connectionFatal('CONNECTION_BACKPRESSURE', 1011)`；协议 §14 L389「1011：不可恢复内部错误或 control backpressure」。缺的只是额度判定本身。

**现有测试锚**：A2 单检查点 1011 锚（g3-g4-red L700-729）只覆盖「无可 shed 数据」分支。

**拟议验收断言**：
- A2a（独立记账）：数据 gate 置停 + 控制帧风暴（如持续 ERROR/RESYNC 注入）使控制侧字节越过其保留额度 → 单检查点内 `ERROR CONNECTION_BACKPRESSURE` + close 1011（即使 `largestQueuedNamespace() !== undefined`——控制额度判定独立于数据可 shed 面）；
- A2b（额度不被数据侵占/不侵占数据）：数据 shed 不消耗控制额度；控制帧排队不计入数据 round-robin 字节；
- A2c（默认有界）：额度来源须显式（新增 limit（如 `maxQueuedControlBytes`，默认值待 SA1 定）或从 `maxQueuedBytesPerConnection` 划分保留区）——无论哪种，`ResolvedLimits`/validate/文档三处同步（联动 R8）；
- 既有 A2-1011 锚保持绿（无可 shed 分支语义不变）。

**影响文件**：`src/frame-io.ts`（控制字节计数 + 耗尽判定 + runCheckpoint 规则 C 扩展）、`src/types.ts` + `src/defaults.ts` + `src/validate.ts`（若新增 limit）、双侧连接文件零改动（回调已接）；`test/ws-replication-sa6-hardening-g3-g4-red.test.ts`（新锚 + 1011 锚保留）。

**依赖联动**：与 R1 共用 `pipelineBytes()` 记账口径；控制额度耗尽的终止路径复用 `connectionFatal('CONNECTION_BACKPRESSURE', 1011)`（peer 侧 1011 close → `onClose` → `onTemporaryFailure` → backoff 重连，hub 侧 → cleanupAll——与 R3 的同步静默联动）。

## R3 — GOAWAY/blocked 同步静默命名空间订阅（peer 与 hub 双侧）

**修订要求**：GOAWAY/blocked 处理必须**同步**静默每个 namespace channel 与订阅（peer 侧与 hub 侧），先于重连/清理。

**现缺陷（hub 侧，最重）**：连接收口（`connectionFatal` L424-437 / `onTransportClosed` L401-406 / `close()` L197-205）→ `cleanupAll()`（L408-422）→ `channel.onConnectionClosed()`（hub-namespace.ts:557-567）：

```
onConnectionClosed() {
  this.openWaiters = [];
  return this.closeQueue.then(async () => {
    await this.drainPendingApplies();     // ← 异步屏障 1：等全部在途 apply
    await this.closeSessionAndRelease();  // ← 订阅摘除在此函数内（L861-864）
    if (!this.isTerminal()) this.setState('closed');  // ← 状态收口在最后
  });
}
```

- channel 的 `unsubscribe`（`session.subscribeOwnedUpdates` 句柄，注册于 hub-namespace.ts:309）要等 `closeQueue` 链 + `drainPendingApplies()` 全部结算后才摘除；**channel state 在整个 drain 窗口仍为 `live`**（与 peer 侧 B-2d「投影先行」不同，hub 无同步投影）；
- 窗口内 `onOwnedUpdate`（L571-587）按 `live` 继续 `channel.deliver(bytes,'live')` → handoff → `outbound.enqueueData` → drain → `emitRaw` 的 `if (!transport.closed) transport.send(bytes)`（hub-connection.ts:165）静默跳过发送，但序列已分配、`onDataDispatched` 已登记 in-flight + ACK 计时器——**死连接上的幻影 in-flight + 静默丢帧**（outbound.dispose 在 cleanupAll 末尾 L420 才执行）。

**现缺陷（peer 侧，较轻）**：`onGoaway`（peer-connection.ts:436-455）：SHUTTING_DOWN/REAUTH → `enterBlocked()`（L577-595）同步投影 + `outbound.dispose()`；SERVER_RESTARTING → deadline 定时器内 `quiesceControllers()`（L458-460）先于 `transport.close`（顺序已对）。但两侧的订阅摘除都经 `controller.onConnectionFatal()`（peer-namespace.ts:624-631）→ `void this.cleanupResources()`（L981-988）→ `cleanupTail.then(() => closeSessionAndRelease())` —— **至少晚一个微任务链**，且 `closeSessionAndRelease` 内才调 `unsubscribe()`（L958-961）。peer 侧靠同步 `setState('disconnected')` 使 `onOwnedUpdate` 落入 default 分支（L746-747）实现「事实静默」，但订阅句柄本身未同步摘除，不满足「synchronously quiesce subscriptions」的字面要求；若 session 侧 fanout 队列（容量 16）在此窗口溢出还会误置 `status.needsResync`（ADR 0010 L267——session 级 sticky 标记污染新连接判定）。

**现有测试锚**：SA7 D5（sa7-dynamic L750+）断言「blocked 后零后续 UPDATE 帧」——只覆盖 wire 出站，未断言订阅摘除同步性；hub 侧无任何锚。

**拟议验收断言**：
- A3a（hub 同步静默）：hub 连接收口触发点（如注入 SEQUENCE_VIOLATION fatal / pong-timeout close / HubReplication.close）**同一同步栈内**：（i）对 channel 注入一次 owned update → `wire.dispatchLog` 零增量、`outbound` 零新 in-flight（对象图只读断言）；（ii）channel state 已离开 `live`（quiesced 投影）；（iii）registry/session 的 listener 计数归零（经 session seam 观测 subscribeOwnedUpdates 的 off 被调用）；
- A3b（peer 同步静默）：GOAWAY(SERVER_SHUTTING_DOWN) 分发同步段与 blocked（connectionFatal）同步段，同样三断言（订阅 off 在同一栈被调、owned update 零 handoff）；
- A3c（GOAWAY drain deadline）：SERVER_RESTARTING deadline 触发栈内先静默后 close（既有顺序回归锚 + 订阅 off 断言）；
- A3d（无幻影 in-flight）：hub 收口后 drain 窗口内的 owned update 不产生 `onDataDispatched`/ACK 计时器登记（对象图断言 inFlight.size 不增）。

**影响文件**：`src/hub-namespace.ts`（onConnectionClosed 拆分：同步 quiesce 段 + 异步 drain/释放段）、`src/hub-connection.ts`（cleanupAll 同步段调用点）、`src/peer-namespace.ts`（onConnectionFatal/onConnectionLost 同步 unsubscribe）、`src/peer-connection.ts`（quiesceControllers/enterBlocked 传递同步静默）；`test/ws-replication-sa7-hardening-dynamic.test.ts`（D5 扩展 + hub 侧新锚）。

**依赖联动**：hub 侧需保留 B-2d/R4-2 语义——迟到 cleanup 不得摧毁新连接 session/订阅（peer-namespace.ts:965-975 的「仅收口当前 session」守卫）；同步摘除只针对**当次捕获**的 unsubscribe 句柄。与 R4 的 hub cleanup 断言共用观测面；与 D6（closing drain 期终局结算）不冲突（那是 ns 级 CLOSE 路径，本项是连接级）。

## R4 — peer pong 超时关传输 + 代际安全脱离后再重连

**修订要求**：pong 超时必须**关闭并代际安全地脱离当前 transport**，然后才重连；测试断言 transport close、Hub 清理、超时窗口内无静默 update 丢失。

**现缺陷**：peer-connection.ts:345-350 `onPongTimeout: () => { this.onTemporaryFailure(); }` → `onTemporaryFailure()`（L597-615）：只清 hello/reset timer、停 liveness、投影 backoff、排 controllers `onConnectionLost()`、挂 backoff 定时器。**不 close transport、不退订 transport 回调、不推进 epoch**——三者全部延迟到 backoff 到期后的 `dialNow()`（L190-265）才做。后果：
1. 旧 transport（`wire1`）保持打开：hub 侧连接/通道/订阅全部存活（hub 只在 `onTransportClosed` 收口），死连接上 hub 继续持有 channel 并向其派发——资源泄漏 + hub 视角连接僵死；
2. 失联窗口内旧 socket 回调仍绑定当前 epoch：迟到的 hub 帧在 peer 落入状态门静默丢弃（`onMessage` L289 非 handshaking/ready 即 return）——丢弃本身无显影；迟到 close 事件靠状态门兜底（backoff 态 `onClose` L555 return）而非代际闸；
3. 对照 hub 侧（hub-connection.ts:293-296）：hub pong 超时**有** `transport.close(1001,'pong-timeout')` ——peer 侧为单侧缺失。

**现有测试锚**：SA7 D4（sa7-dynamic L698-733）断言状态机（backoff/重拨 ready/wire2 活性重武装/stop 零 timer 残留），**未断言** `wire1.closed`、hub 连接清理、超时窗口丢帧语义——`run.wires.length === 2` 恰好暴露 wire1 未关。

**拟议验收断言**：
- A4a（同步关闭）：`advanceBy(pingIntervalMs + pongTimeoutMs)` 触发 pong 超时后，**进入 backoff 的同一栈**内 `wire1.closed === true`（close code 可断言，建议 1001 对齐 hub 侧行为——具体值由 SA1 定）；重拨发生前 `wires.length === 1` 且该 wire 已关；
- A4b（代际安全脱离）：超时处理后向 wire1 注入迟到 message 与迟到 close → 新连接（backoff 到期重拨后）状态保持 ready/live、零 backoff 重入（现有 AC2a/AC2b 锚的 liveness 变体）；
- A4c（Hub 清理）：wire1 关闭传播后 `hub.connections` 不再含该连接 / 通道 settled（`settle()` resolve）——与 R3 的 hub cleanup 观测共用；
- A4d（无静默丢失）：超时前已 apply 的 hub 更新在 peer 副本保持；超时窗口内 hub 发出的更新在重连+re-OPEN+reconcile 后收敛（双侧 ROOT 相等）；窗口内 peer 侧任何被弃置的 in-flight/排队更新经 needs-resync/round diff 显影修复（不得出现「hub 认为已送达、peer 永久缺失」）。

**影响文件**：`src/peer-connection.ts`（onTemporaryFailure 或 onPongTimeout 专属路径：close transport + unsubscribeTransport + epoch 前移 + outbound.dispose 的收口次序）、`src/liveness.ts`（零改动预期——onPongTimeout 回调面已够）；`test/ws-replication-sa7-hardening-dynamic.test.ts`（D4 扩展）、`test/driver.ts`（wire close 可观测面，若缺）。

**依赖联动**：收口次序须与既有 dialNow 卫生序（stopLiveness → unsubscribe → outbound.dispose → epoch+1）一致，避免双 close/双 dispose 竞态（幂等守卫：`transport.closed` / `outbound !== undefined`）；注意 GOAWAY drain 期 pong 超时与 goawayDrainHandle 的清理互斥（N1 纪律——超时路径须 clearGoawayDrain 或证明互斥）；`onTemporaryFailure` 亦被 dial 抛错/hello 超时共用——若只改 pong 路径需拆分入口，若改公共路径则三处行为一起变（SA1 决策点）。

## R5 — round-robin 有界整轮扫描（不因队首 ns 阻塞而 return）

**修订要求**：drain 的 round-robin 必须扫描**有界的一整轮**，而不是队首 namespace 被阻塞即返回。

**现缺陷**：`drain()` frame-io.ts:205-233：

```ts
while (!this.paused && this.queuedDataCount() > 0) {
  const nsId = this.nextDataNamespace();
  if (nsId === undefined) return lastControlSeq;
  if (this.deps?.canDispatchData !== undefined && !this.deps.canDispatchData(nsId)) {
    return lastControlSeq;   // ← L208-210：队首 ns 窗口满 → 整个 drain 终止
  }
  ...
}
```

`canDispatchData` 由通道 in-flight 窗口决定（hub-connection.ts:157-160 / peer-connection.ts:227-228：`inFlightCount < maxInFlightUpdates`）。队首 ns 窗口满时**直接 return**，同轮后续已就绪的兄弟 ns 全部被头部阻塞——公平性缺口。SA7 D3（sa7-dynamic L506-560）文档化了现状妥协：「canDispatchData=false 持续占位时，滞留帧在**下一个 100ms 检查点**派发（无饿死）」——即兄弟 ns 的派发被推迟整整一个 checkpoint 周期，靠 timer 兜底而非本轮扫描。

**拟议验收断言**：
- A5a（整轮扫描）：ns A 窗口满（un-ACKed in-flight ≥ max，gate 悬挂 ACK）且 ns B 有排队帧 → 单次 drain（无 timer 推进、无 ACK 释放）后 B 的帧已派发（wire dispatchLog 含 B 的 UPDATE）；对照现状需 `advanceBy(checkpointIntervalMs)` 才派发 → 修订后零 timer 推进即派发；
- A5b（有界）：全部 ns 均阻塞 + 均有排队 → drain 单次执行扫描 ≤ 一整轮（`dataOrder.length` 次 nextDataNamespace）即停，零派发、零死循环（可经 dispatchLog 增量 + 单步 settle 断言）；
- A5c（公平性保持）：AC5-RR 锚（每轮每 ns 至多一帧，A,B,A,B）保持绿——整轮扫描不得退化为逐 ns 排空。

**影响文件**：`src/frame-io.ts`（drain 循环改造：blocked ns 跳过并计数，扫描满一轮或无帧可派即止；注意 `unregisterDataNamespace` 会使 `dataOrder` 收缩——扫描上界须按进入本轮时的快照或以「连续跳过数 ≥ 当前注册数」收口）；`test/ws-replication-sa7-hardening-dynamic.test.ts`（D3 收紧：兜底锚改为同轮派发锚）。

**依赖联动**：D3 现锚「下一个检查点兜底」与 A5a 语义冲突——**必须同步改写 D3**（它是 PR #165 既有绿锚，收紧实现后 D3 仍会过但断言变弱；review 要求改为强锚）；与 R2 无冲突（控制帧仍在数据循环前排空）；与 R1 的 drain 调用点无冲突。

## R6 — UpdateChannel 溢出计入未派发 pending handoff（count/bytes）

**修订要求**：UpdateChannel 的溢出判定必须把「已 handoff 给连接级队列、尚未派发」的帧计入 count 与 bytes。

**现缺陷**：`UpdateChannel.overflows()` update-channel.ts:127-133：

```ts
const pending = this.inFlight.size + this.queued.length;          // ← 不含 pendingDataCount
if (pending >= this.host.limits.maxQueuedUpdateCount) return true;
let pendingBytes = this.queuedBytes;                                // ← 不含 pending handoff 字节
for (const bytes of this.inFlight.values()) pendingBytes += bytes.byteLength;
return pendingBytes + incoming.byteLength > this.host.limits.maxQueuedUpdateBytes;
```

`pendingDataCount`（L36，handoff 时 +1（L144），派发时 -1（L113））只在窗口不变量（L56/L153）中出现，溢出判定的 count 与 bytes 双口径均漏计。后果：gate 置停（帧已 handoff 未派发）期间 `overflows()` 低估负载，per-ns 上限被突破 M 帧（M = 待派发 pending 数）才触发溢出。REPORT.md「遗留问题 2」已记录该观察（「overflows() per-ns 计数口径不含 pendingDataCount（总量仍由连接级预算收口）」）——PR #165 review 将其升格为必修。

**拟议验收断言**：
- A6a（count 口径）：`maxQueuedUpdateCount = N`；gate 置停使 M 帧已 handoff 未派发（`pendingDataCount = M`，可经对象图只读观测）；继续 deliver → 第 `N - M`（而非第 `N`）帧即触发溢出（discardQueued + live 路径 declareLocalResync/notePendingResync 断言 wire RESYNC_REQUIRED 或状态 needs-resync）；
- A6b（bytes 口径）：同构造按 `maxQueuedUpdateBytes`：`queuedBytes + ΣinFlight + ΣpendingHandoffBytes + incoming > max` 即触发（字节和断言，非帧数）；
- A6c（不变量回归）：A7 窗口锚（inFlight+pendingData ≤ maxInFlightUpdates）与 flushQueued 循环保持绿。

**影响文件**：`src/update-channel.ts`（overflows 双口径 + 需要按帧保留 pending 字节合计——现 QueuedItem 只有 queued 侧有 bytes 记账，pending 侧只有 count；需新增 `pendingDataBytes` 或在 handoff/onDataDispatched/onDataShed/teardown 四出口同步维护）；测试新增锚（g3-g4-red A7 补充锚或新 describe）。

**依赖联动**：pending 字节记账的四个变更点必须与既有出口对齐：`handoff()`（+）、`onDataDispatched()`（−）、`onDataShed()`（清零）、`teardown()`（清零）——漏任何一处会与 A7 记账锚冲突；与 R1 的连接级 shed（`onDataShed` → pendingDataCount=0）联动一致。

## R7 — 确定性 seam：peer 重建不硬编码 queueMicrotask；driver 去 512 跳魔法

**修订要求**：重建调度不得硬编码 `queueMicrotask`；测试 driver 不得依赖 512 跳微任务链魔法。

**现缺陷**：
1. peer-connection.ts:617-642 `requestRebuild()`：L638 `queueMicrotask(() => { this.rebuildPending = false; if (!this.stopping) this.dialNow(); })` —— **绕过** `this.deferTask` seam。L634-637 注释自认：「重建调度保持单跳 queueMicrotask…seam（deferTask/TEST_DEFER 512 跳）只作用于 ACK-timeout 恢复路径…不作用于本单跳调度点」。seam 已存在（types.ts L130 `deferTask?`；构造器 L83 `options.deferTask ?? defaultDefer`；ACK-timeout 路径 peer-namespace.ts:690 已正确走 `host.deferTask`），重建路径是唯一硬编码漏点；
2. test/driver.ts:395-408 `TEST_DEFER`：512 跳 `queueMicrotask` 自延伸链（`if (hops >= 512) task(); else step();`）——以魔法常数换「> settle(300) 且 < settleUntil(3000)」的时序窗。peer-connection.ts:636 与 peer-namespace.ts:689 注释把「512 跳」写进生产注释，属测试基建泄漏进生产叙事（REVIEW 修订点）。

**拟议验收断言**：
- A7a（seme 生效）：注入手动 latch 型 `deferTask`（resolve 前挂起）→ `addTarget` 触发 config-change 重建后，`dialCount` 不增直至 latch 放行；放行后恰好 +1；
- A7b（生产缺省不变）：缺省 `deferTask`（单微任务）下重建仍在微任务内推进（既有 spec B-1 锚「addTarget 后 settle 内 dialCount+1」保持绿）；
- A7c（driver 零魔法）：`test/driver.ts` 无 `512` 常数（替换为确定性机制：fake scheduler 的 `setTimeout(0)`/显式 flush 原语/步进函数——具体由 SA1/SA6 定）；既有依赖 TEST_DEFER 时序的测试（sa6 AC4 系、sa7 D1）在替换后保持绿且零 real sleep；
- A7d（可选 grep 锚）：`src/` 中 `queueMicrotask` 仅剩 `defaultDefer` 定义一处（peer-connection.ts:36）。

**影响文件**：`src/peer-connection.ts`（L638 → `this.deferTask(...)`；同步清理 L34-37/L634-637 注释中的「512 跳」表述）、`src/peer-namespace.ts`（L688-689 注释清理）；`test/driver.ts`（TEST_DEFER 重实现）、受时序影响的测试文件（sa6-hardening-g3-g4 AC4 系、sa7-dynamic D1/D2——需回归跑）。

**依赖联动**：TEST_DEFER 语义变化影响所有经 `boot()` 注入 deferTask 的测试的时序窗（sa7 D1 依赖「needs-resync 投影先可观测」的延迟）——替换机制必须保持「恢复调度晚于投影断言点」的可观测序，否则 AC4-2/D1 锚闪断；`requestRebuild` 改走 seam 后，生产缺省行为不变（单微任务），但测试可注入延迟——与 A7a/b 两面锚对应。

## R8 — 权威文档四缺口 + 陈旧叙事清理（ADR/docs/protocol）

**修订要求**：公共权威文档（ADR/protocol/phase docs）补齐：公共受信身份、transport facets、liveness 缺省/约束、背压边界；移除陈旧的红灯测试阶段叙事。

**现状证据（逐项）**：
1. **公共受信身份**：protocol §2（L34-42）有「Bearer token 在 HTTP Upgrade 前验证…Upgrade 身份、HELLO Peer instanceId…必须一致」+ §6.1 L120 字段注「必须等于 Upgrade 身份」；ADR 0010 L155 有对应句。**缺**：实现侧 §1.1 修复建立的权威句——「hub 的公共身份投影（`HubConnection.peerInstanceId`）只消费受信 Upgrade 产物，绝不采信 wire 自述；`accept(transport, identity)` 缺身份 = 宿主接线 bug（同步 TypeError，非降级）」（hub-connection.ts:78-95 行为已如此，文档未立）。types.ts L64-67 注释是唯一载体。
2. **transport facets**：`DuplexTransport` 可选三面 `bufferedAmount`/`ping`/`onPong`（types.ts L48-61，含「生产 adapter 必须暴露…缺面 = dormant」语义）只在代码注释与 wiki 设计文档；protocol §17 L492 只提 bufferedAmount 观察点、§18 L518 只列配置项；ADR 0010 L165 一句「心跳与失联判定…安全默认值」。**缺**：transport facet 契约本身（哪些面、缺面降级语义、#164 组合根的装配期 loud 断言要求）。
3. **liveness 缺省/约束**：`pingIntervalMs=30_000`、`pongTimeoutMs=10_000`（defaults.ts L39-40）与约束 `pongTimeoutMs < pingIntervalMs`（validate.ts L161-166 强制）**均未入 protocol §18 / ADR**——§18 只列配置项名；defaults.ts 注释自认「协议 §18 只列配置项、ADR-0010 L165 只要求『安全默认值』，均无数值规定」。
4. **背压边界**：protocol §17 L477-506 已有 per-ns 上限、round-robin、shed-to-low-water、控制保留额度、水位规则与启动校验清单——但**实现边界口径**（pipeline 记账 = queued + buffered；shed 只作用 queued 侧；R1 的严格接纳 vs 现「断点接纳」；R2 控制额度独立判定；checkpoint 间隔 = `max(1, floor(ackTimeoutMs/100))`；1011 终止）全部只存在于 frame-io.ts 注释 + `wiki/raw/task_ws-replication-hardening_design.md`（内部件）——修订后须把**最终口径**（含 R1/R2/R5/R6 的裁决结果）回写 protocol §17/ADR。
5. **陈旧红灯/阶段叙事**：公共 docs 中未发现字面「红灯」文本（已 grep docs/ 全树：adr/protocols/phases 零命中）；最接近的陈旧阶段叙事在 `docs/phases/phase-5-websocket-replication.md` L75-83——「切片 3/4 落地锚定（issue #134 已接受…）」「切片 3『needs-resync 通知』对账注记（**SA8 放行条件 C-1，issue #134 round 2 改写——撤销 round-1…读法**）」等流水线回合叙事嵌入公共 phase 文档；字面红灯叙事（15 failed/82 passed 等）在 `REPORT.md` 与 `wiki/raw/*sa6_red*`（任务工件，非公共权威——REPORT.md 属交付物边缘，建议 SA3 确认其归属）。**SA5 无法从公共 docs 中定位到更多字面红灯段**——此项的精确清理清单需 SA1/SA2 复核 review 原文所指（见「阻塞与保留意见」）。

**拟议验收断言**（docs 断言 = 评审核对项）：
- A8a：protocol §2 或 §6.1 增「公共身份投影只取受信 Upgrade 身份；缺受信身份的 accept = 响亮拒绝」句；
- A8b：ADR 0010（或 protocol §17/§18）增 transport facet 契约（三可选面 + 缺面 dormant/视为 0 语义 + 生产 adapter 必须暴露 + 装配期断言要求——与 #164 票面一致）；
- A8c：protocol §18 增 liveness 缺省值（30s/10s）与约束 `pongTimeout < pingInterval`（及 validate 强制事实）；
- A8d：protocol §17 增背压边界句：pipeline 记账口径、shed 作用域、严格接纳保证（R1 裁决后）、控制额度独立性（R2 裁决后）、checkpoint 间隔推导、1011 终止；与实现注释/wiki 设计文档口径一致（单一权威源）；
- A8e：phase-5 doc（及 ADR 修订节）清理流水线回合叙事（round-N 撤销/SA8 放行条件类表述改写为终态规范句）；grep 锚：公共 docs 零「红灯/SA6 契约/round-N 撤销」叙事残留。

**影响文件**：`docs/protocols/instance-replication-v1.md`、`docs/adr/0010-hub-peer-websocket-ydoc-replication.md`、`docs/phases/phase-5-websocket-replication.md`；可选对齐 `packages/ws-replication/src/types.ts`/`defaults.ts` 注释中的条款引用。

**依赖联动**：A8d 的边界句依赖 R1/R2/R5/R6 的**裁决结果**（先裁后排期文档）；A8b/A8c 与 #164（组合根票）内容交叠——避免两处权威分叉。

## 2. 依赖图（跨 finding）

```
R1（严格接纳）──┬─→ 复用 onDataShed 声明链（与 R6 的 needs-resync 闭环同构）
               └─→ R2（控制额度）共用 pipelineBytes 口径；R8d 文档回写
R2（控制额度）──→ 终止路径 connectionFatal(1011) → R3（hub 同步静默）联动
R3（同步静默）─┬─→ hub 侧修复需保留 peer 侧 B-2d「迟到 cleanup 不毁新 session」守卫
              └─→ 与 R4c（Hub 清理断言）共用观测面
R4（pong 收口）┬─→ onTemporaryFailure 为三入口共用（dial 抛错/hello 超时/pong）——拆分决策影响面
              └─→ 与 GOAWAY drain timer 的清理互斥（N1）需核查
R5（整轮扫描）─→ 必须同步收紧 SA7 D3 现锚（否则既有绿锚与新语义冲突）
R6（溢出口径）─→ 四出口记账对齐（handoff/dispatched/shed/teardown）
R7（seam）────→ TEST_DEFER 语义替换波及 sa6 AC4 系 + sa7 D1/D2 时序锚
R8（文档）────→ A8d 依赖 R1/R2/R5/R6 裁决；A8b/c 与 issue #164 交叠
```

## 3. 与既有测试的关系汇总

| 既有锚 | 状态 | 动作 |
|---|---|---|
| A2 滞回锚（≤2 帧容忍断点接纳） | 与 R1 冲突 | 收紧为精确值，删「断点接纳帧」注释 |
| AC5-SHED（仅 wire 信号计数） | 不足 | 增字节级断言 |
| A2 单检查点 1011 锚 | 保持 | R2 不得破坏；另增「有排队数据时控制耗尽」新锚 |
| SA7 D3（检查点兜底派发） | 与 R5 冲突 | 改写为同轮派发强锚 |
| SA7 D4（pong 超时状态机） | 不足 | 增 A4a-d（close/代际/hub 清理/无丢失） |
| SA7 D5（blocked 零出站） | 不足 | 增 A3a-d（同步订阅静默 + hub 侧） |
| A7 窗口锚（inFlight+pendingData） | 保持 | R6 不得破坏；增 A6a/b |
| spec B-1（addTarget 后 settle 内 dial+1） | 保持 | R7 改 seam 后必须仍绿 |

## 4. Fix direction 汇总（供 SA1 设计，非实现方案）

1. **frame-io enqueueData**：shed 循环后加严格准入判定——仍超限则拒纳 incoming 并经 onDataShed 显影；单帧超限同路径。控制面新增独立字节记账与保留额度，耗尽走既有 `onControlExhausted` → 1011。drain 改有界整轮扫描（跳过 blocked ns，上界按轮快照）。
2. **双侧同步静默**：把「订阅摘除 + channel 投影 quiesced」提为连接收口同步段（hub 于 cleanupAll 同步前缀、peer 于 enterBlocked/quiesceControllers 同步段），drain/释放仍异步；保留「仅处理当次捕获句柄」守卫。
3. **peer pong 超时收口**：失联回调内同步 close transport + 退订 + epoch 前移 + outbound dispose（幂等），再进 backoff；注意 onTemporaryFailure 多入口共用与 GOAWAY drain 互斥。
4. **update-channel overflows**：pending handoff 的 count 与 bytes 双口径计入（新增 pending 字节合计，四出口同步）。
5. **确定性 seam**：requestRebuild 改走 deferTask；driver TEST_DEFER 去 512 魔法（fake-scheduler/显式步进），生产注释清除 512 叙事。
6. **文档回写**：protocol/ADR/phase 三处补身份投影/facet 契约/liveness 缺省约束/背压边界终态口径；清理阶段回合叙事。

## 5. 阻塞与保留意见

- **R8-e（陈旧红灯叙事）定位不完整**：公共 docs（adr/protocols/phases）经全树 grep 无字面「红灯」文本；最接近目标为 phase-5 L75-83 流水线回合叙事与 REPORT.md/wiki 任务工件。SA5 不排除 review 原文另有所指（如协议 §22 conformance 段或 wiki/Index 面）——建议 SA1/SA2 对照 PR #165 review 原帖逐字确认清理清单，避免误删 append-only ADR 修订节的合法历史。
- **R2 额度来源**（新 limit vs 从既有预算划分）与 **R4 收口入口拆分**（pong 专属 vs onTemporaryFailure 公共）为设计裁决点，超出 SA5 职责。
- 全部分析基于静态阅读 + 既有测试锚交叉验证，未运行时注入诊断日志（静态证据已足定位；如需运行时确证 R3 hub 窗口行为，建议 SA7 动态锚先行）。

## Evidence（关键代码摘录索引）

- frame-io.ts:161-175 断点接纳注释与无条件 push；167-169「按断点接纳（不丢弃 incoming）」。
- frame-io.ts:247-253 规则 C 仅 `largestQueuedNamespace() === undefined` 触发；125 controlQueue 无记账。
- frame-io.ts:208-210 `canDispatchData` 假即 `return lastControlSeq`。
- hub-namespace.ts:562-566 `closeQueue.then(… drainPendingApplies … closeSessionAndRelease … setState('closed'))`；861-864 订阅摘除位于异步函数内；309 订阅注册。
- peer-namespace.ts:624-631 `onConnectionFatal` → `void this.cleanupResources()`；981-988 `cleanupTail.then`；958-961 unsubscribe。
- peer-connection.ts:345-350 onPongTimeout → onTemporaryFailure；597-615 无 close/退订/epoch；638 `queueMicrotask` 硬编码；229 onControlExhausted 接线。
- hub-connection.ts:293-296 hub 侧 pong 超时 close(1001)（peer 缺失的对照）；161 onControlExhausted 接线；165 emitRaw closed 守卫（静默跳过）。
- update-channel.ts:127-133 overflows 双口径漏 pendingDataCount/字节；36 pendingDataCount 注释；144/113/121/182 四出口。
- types.ts:48-61 transport facets；64-67 UpgradeIdentity；130 deferTask seam。validate.ts:161-166 pongTimeout < pingInterval。
- defaults.ts:24-26 连接级限制缺省；39-40 liveness 缺省 30s/10s。
- docs/protocols/instance-replication-v1.md：§2 L34-42、§6.1 L120、§14 L389、§17 L477-506（L490 控制保留额度句）、§18 L508-520、§22 L570-586。
- docs/adr/0010：L141-167（协议/认证/资源限制节）、L262-277（修订节叙事样例）。
- docs/phases/phase-5-websocket-replication.md：L75-83（切片 3/4 回合叙事）、L103-135（切片 6-9）、L166-188（场景）。
- test/driver.ts:395-408 TEST_DEFER 512 跳；test g3-g4-red L320-344（WATER/SHED_LIMITS、BLOB 8KiB）、L488-516（AC5-SHED）、L668-697（A2 滞回 ≤2 容忍）、L700-729（A2 1011 锚）；test sa7-dynamic L506-560（D3 兜底）、L698-733（D4）、L750+（D5）。

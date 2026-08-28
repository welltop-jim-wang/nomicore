# Spec 终审报告 — issue #161 ws-replication 协议/生命周期加固（PR #160 post-review）

Verdict: clear

**审查员**：Spec review 终审（独立于此前所有 SA） | **日期**：2026-08-29
**审查范围**：`git diff origin/docs/phase-5-websocket-replication HEAD`（基线 6f2676f → HEAD 610c16e；31 文件，+5435/−163）
**对照基准**：issue #161 正文（`wiki/raw/task_ws-replication-hardening.md`，21 项 required fixes + 7 条 AC）；权威设计 `task_ws-replication-hardening_design.md`（R2 + §3.8 裁决 1/2/3）；验收核对 `task_ws-replication-hardening_ac_checklist.md`；wire contract `docs/protocols/instance-replication-v1.md`
**方法**：全文读 diff（19 个 package 文件逐 hunk）+ 全部测试文件断言面直读（不只信报告）+ 协议文本逐节 sed 核验 + 终审亲跑只读验证命令（结果见 §五）。

---

## 一、Required fixes 逐项核对（21/21 全部实现/处置）

| # | 要求 | 实现证据（文件:关键机制） | 结论 |
|---|---|---|---|
| G1.1 | accept() 绑定 Upgrade 受信身份 | `types.ts` 新增 `UpgradeIdentity` + `accept(transport, identity?)`；`hub-connection.ts` accept：identity 缺失 → 同步 `TypeError('HUB_ACCEPT_IDENTITY_REQUIRED')`（拒绝虚假降级）+ `validateInstanceId` 复用安全文法；构造器保存 `trust` | ✅ |
| G1.2 | HELLO 自述身份 ≠ 受信身份即拒 | `hub-connection.ts onHello`：expectedHubInstanceId 校验之后、版本协商之前新增首查 → `connectionFatal('INSTANCE_IDENTITY_MISMATCH', 1008)`；`channelHost.peerInstanceId` 改为 `() => this.trust.peerInstanceId`（authorize/openReplicationSession 只消费受信值）；公共投影赋值源从 wire 改为 trust | ✅ |
| G1.3 | 传输回调绑连接代际 | `peer-connection.ts dialNow`：`connectionEpochValue += 1` 当次捕获，`onMessage/onClose` 闭包先验代际（迟到静默丢弃）+ `unsubscribeTransport()` 卫生退订（dialNow/stop/enterBlocked 均调用）；hub 侧对称保存退订句柄并于 `cleanupAll` 退订 | ✅ |
| G2.1 | BOOTSTRAP_ACK 关联 | `hub-namespace.ts`：`bootstrapSnapshotSeq` 留存（`seq > 0 ? seq : undefined`）；`onBootstrapAck` 错配/无关联序 → `connectionFatal('ACK_STATE_VIOLATION', 1002)`（UPDATE_ACK 同款违例策略）；一次性消费 | ✅ |
| G2.2 | CLOSE_OK 关联 | `peer-namespace.ts`：`closeNamespaceSeq` 留存；`onCloseOk(ackedSequence)` 非 closing 静默 / 无关联序不完成 / 错配不完成（保持 closing，closeTimeout 兜底）；dispatch 点（`peer-connection.ts`）同步传参 | ✅ |
| G2.3 | Hub ACK 超时 → 记忆化 RESYNC_REQUIRED | `hub-namespace.ts onAckTimeoutFired` → `declareHubResync()`（`isQuietState` 守卫 + `resyncDeclared` 记忆化，恰一帧；清零点在 `onRoundSettled` 真实回 live 时） | ✅ |
| G2.4 | 部分进度后计时器按最老剩余在途重挂 | `update-channel.ts onAck`：`wasOldest` 判定 → 窗口非空时 disarm+arm 重挂；乱序 ACK 不重挂（最老锚点未变） | ✅ |
| G3.1 | UPDATE 走真实 per-ns 队列 | `frame-io.ts OutboundQueue.enqueueData/dataQueues/dataOrder`；双侧 `sendUpdateFrame` → `host.sendData`（`hub-namespace.ts/peer-namespace.ts`），控制路径不再承载 UPDATE | ✅ |
| G3.2 | 控制优先 + 连接级 round-robin | `drain()`：控制队列任何入口先排空（暂停不约束控制）；数据循环 `nextDataNamespace` 持久游标、每轮每 ns 至多一帧 | ✅ |
| G3.3 | maxQueuedBytesPerConnection 强制 + shed 至低水位 + needs-resync | `enqueueData` 滞回：触发 `pipelineBytes()+incoming > max`（口径 = queued + bufferedAmount，§3.2 R2 定案）→ 按 `largestQueuedNamespace()` 整队 shed（`onDataShed` 显影 → 通道 needs-resync + 记忆化声明）至 `queuedDataBytes ≤ lowWater`；无可 shed 面按断点接纳 | ✅ |
| G3.4 | 控制保留额度 + CONNECTION_BACKPRESSURE | 控制帧不入数据预算、不受暂停约束（结构性保留额度）；`runCheckpoint` 规则 C（buffered > max 且无可 shed）→ `onControlExhausted` → `connectionFatal('CONNECTION_BACKPRESSURE', 1011)`（错误码为协议包既有注册，只消费）；peer 侧 1011 分类 = temporary → backoff（协议 §15.1 L440 核对一致） | ✅ |
| G3.5 | bufferedAmount 高低水位（注入 timer） | `runCheckpoint` 规则 A/B（≥highWater 暂停 / ≤lowWater 恢复）；`ensureCheckpoint` 起挂/续挂条件 = paused ∨ 有排队 ∨ buffered>0（A1 修复）；`checkpointIntervalMs = max(1, floor(ackTimeoutMs/100))`（默认 100ms）；`DuplexTransport` 加性可选 `bufferedAmount?`（缺省 0 → dormant）；`validateLimits` 新增 `highWater ≤ maxQueuedBytesPerConnection` 链式校验 | ✅ |
| G4.1 | CLOSE 同步停接纳 | peer `onCloseRequest`：帧分发同步段 `setState('closing')`（随后串行 drain → cleanup → CLOSE_OK）；hub `onCloseRequest`：setState 从微任务续体上提到同步段 | ✅ |
| G4.2 | 已接纳 apply 全数 drain 后收口 | apply 接纳为同步登记（首 await 前入 `pendingApplies`）；同步 closing 后经 `isQuietState` 门拒新 UPDATE/Step → `drainPendingApplies` 快照覆盖全部已接纳 → `closeSessionAndRelease`（session.close barrier → lease.release） | ✅ |
| G4.3 | 迟到 round 结算不复活 closing/终态 | hub `onRoundSettled` 白名单守卫（仅 reconciling/needs-resync 可回 live；closing/终态/live/opening 零迁移；`resyncDeclared` 清零只在真实回 live）；peer 侧 B-1 同款纪律为既有 | ✅ |
| G4.4 | GOAWAY/blocked 同步静默 channel 与订阅 | `onGoaway` 重构：SHUTTING_DOWN/REAUTH_REQUIRED → `enterBlocked()`（清 timer + dispose 出站队列 + 全控制器 `onConnectionFatal`）；RESTARTING → drain deadline（句柄保存，`clearGoawayDrain`）→ `quiesceControllers()` → close(1001)；`goawayActive` 抑制新 OPEN/新 round（`openActiveTargets`/`maybeStartRecovery` 门禁，`dialNow` 重置）；双侧 `closeSessionAndRelease` 的 `unsubscribe()` 前移到入口同步段（保留 B-2d 捕获句柄守卫） | ✅ |
| G4.5 | closing 期 OPEN waiter flush | hub `settleClosingOpenWaiters()`（`NAMESPACE_REOPEN_REQUIRES_RECONNECT` 必答，协议 §7.1 L164 核对一致）；三调用点：onCloseRequest 完成段 / finalize(closing 期) / onConnectionClosed（零 wire 仅清空） | ✅ |
| G5.1 | WS ping/pong 活性接线（零应用层帧） | 新建 `src/liveness.ts`（54 行）：仅当 transport 同时提供 `ping`/`onPong` 时武装（缺面 dormant 零 timer）；hub 握手成功后 / peer `onHelloAck` 后武装；pong 超时 → hub close(1001) / peer `onTemporaryFailure`；stop/重拨/blocked/backoff 全路径清 timer；`ReplicationTimeouts` 加性可选 `pingIntervalMs?/pongTimeoutMs?`（缺省 30_000/10_000，Resolved 必填，构造期校验 pong < ping）；协议包零改动（无业务 PING/PONG 码） | ✅ |
| G5.2 | 生产 512 环 → 显式确定性 seam | `peer-namespace.ts onAckTimeoutFired` 512 跳 `queueMicrotask` 环整体删除 → `host.deferTask(...)`；`PeerReplicationOptions.deferTask?` 加性 seam，生产缺省单微任务；`test/driver.ts` 注入 512 跳 `TEST_DEFER`（常数移入测试侧）；`requestRebuild` 保持单跳（设计 §5.2 偏离声明，SA4 R1 N1 追认——生产等价、防 DENY 面 B-1 锚恒红）；`grep queueMicrotask src/` 仅剩缺省 seam 单跳 + requestRebuild 单跳 + testing.ts 既有投递 | ✅ |
| G5.3 | 死抽象清理（单一权威机制） | `LifecycleQueue` 类删除（`Memoized` 保留）；`OutboundQueue.sendData` 死直发删除（数据面复活为真实机制）；hub 侧 `cleanupTail` 声明删除；`NamespaceChannelCore` 接口删除——grep 零残留（仅注释提及删除事实） | ✅ |
| G6 | 交付澄清 + 开票 | 设计 §6 记录 resetReplica 归属（Registry 侧已交付，`packages/namespace-registry/src/registry.ts` grep 实证，#133 切片）；结构化 observability → **#163（OPEN，gh 实证）**；apps/yjs-server 组合根（含 A11 adapter 强制面）→ **#164（OPEN，gh 实证）** | ✅ |

**结论：21/21 全部落地（G6 三项按简报口径为澄清+开票，非代码缺口）。**

---

## 二、Acceptance criteria 逐条核对（测试断言面直读 + 终审亲跑）

| AC | 断言证据（测试文件 · 用例 · 关键断言，全部亲读原文） | 结论 |
|---|---|---|
| AC1 伪造 HELLO 授权前被拒 | `sa6-hardening-g1-g2-red.test.ts` AC1：`accept(hubEnd, {peerInstanceId: 'peer-alpha'})` + HELLO 自述 `peer-loki` → `spy.calls` 长度 0（authorize 零调用）+ `wire.hubSideClosed === true` + `hub.connections` 长度 0（§3.8 裁决 2 替换锚，与 prompt-drop 语义一致）+ ERROR 帧含 `INSTANCE_IDENTITY_MISMATCH` | ✅ |
| AC2 旧 socket 迟到回调不影响替代连接 | 同文件 AC2a：removeTarget→addTarget 整连接重建（dialCount ≥ 2）后旧 wire 注入 seq=1 帧 → 新连接保持 `ready`/ns 保持 `live`，且造证锚（注入帧确实到达对端，`hubToPeer` 计数 = 1，清零基准为断言面前置构造调整）；AC2b：旧 socket `closeHubSide(1000)` → 新连接保持 `ready`（无 backoff） | ✅ |
| AC3 伪造/陈旧 ACK 不推进状态 | 同文件 AC3a：伪造 BOOTSTRAP_ACK（snapSeq+7）→ ERROR 含 `ACK_STATE_VIOLATION` + 连接 `blocked`；AC3b：drop 真实 CLOSE_OK 后注入错配 CLOSE_OK → ns `not.toBe('closed')` + `closeSettled === false` + `advanceMs(5000)` closeTimeout 兜底收口 | ✅ |
| AC4 Hub ACK 超时 → Peer 发起恢复并收敛 | `sa6-hardening-g3-g4-red.test.ts` AC4-1：peer saveGate 悬挂 + `advanceBy(200)` → `RESYNC_REQUIRED` 恰 1 帧；AC4-2：peer `SYNC_STEP1` 第 2 帧 `syncRoundId === 2` + 双侧 `n === 9` 收敛；补充锚 A5（排队 UPDATE 保留 3 帧 + zombie ACK 容忍无 fatal）；SA7 D1 全链路（3+1 ns 竞争下关联恒等、零 false-fatal） | ✅ |
| AC5 控制优先/round-robin/shedding/水位 | 同文件 AC5-RR（§3.8 裁决 1 替换构造 + A4 `setGate(false)` 修正：暂停窗零派发前置锚 + 恢复 drain wire 序 `toEqual([a, b, a, b])` + 4 帧前提锚）；AC5-WATER（越 highWater 后 dispatchLog 增量 UPDATE = 0，释放后收敛）；AC5-PRI（暂停期 UPDATE = 0 且 UPDATE_ACK ≥ 1）；AC5-SHED（held > 64KiB 后 RESYNC_REQUIRED + CONNECTION_BACKPRESSURE ≥ 1）；补充锚 A1 窄锚 / A2 滞回（恢复后残余派发 ≤ 2 帧）/ A2 单检查点 1011（ERROR + `hubEnd.closed === true` + peer → backoff）/ A7 记账（恢复轮派发 ≤ maxInFlightUpdates）；SA7 D3（窗口满占位 ns 不饿死兄弟 ns：每检查点周期一帧） | ✅ |
| AC6 CLOSE 同步停接纳/排空/终态不复活 | 同文件 AC6-1（CLOSE 分发后 ns 即 `closing`）；AC6-2（CLOSE 后注入 UPDATE 不应用：双侧 `n === 6` 而非 7）；AC6-3（500 次微任务采样序列恰 `['closing','closed']`，无 closing→live 复活）；AC6-4（closing 期重复 OPEN → ERROR 含 `NAMESPACE_REOPEN_REQUIRES_RECONNECT`）；SA7 D6（CLOSE_OK 丢失 + closeTimeout 未推进下 closeP 经 E5 终局在微任务预算内结算） | ✅ |
| AC7 既有测试绿 + typecheck + diff --check | **终审亲跑**（repo root，独立进程）：`./node_modules/.bin/vitest run packages/ws-replication` → **15 files / 110 tests 全绿，Type Errors none**（PR #160 既有 82 例文件全部在列且全绿）；`npm run typecheck`（11 包 tsc 链）→ **exit 0**；`git diff --check origin/docs/phase-5-websocket-replication HEAD` → **零输出（exit 0）** | ✅ |

**结论：7/7 AC 全部有真实断言面覆盖，且经本审查员独立复跑证实（非转述报告）。**

---

## 三、Scope creep 检查（diff vs 设计 §10 ALLOW LIST 含后续扩展条目）

**diff 文件全集（31）= package 19 + wiki 12，逐一对账：**

| 类别 | 文件 | ALLOW 对账 |
|---|---|---|
| src（12） | types/defaults/index/validate/frame-io/update-channel/hub-connection/hub-namespace/peer-connection/peer-namespace/lifecycle-queue（修改）+ liveness（新建 54 行） | 全部在 §10 ALLOW LIST（liveness.ts 为 SA4 R1 N2 触发的显式扩展条目，已在 §10 补列）✅ |
| package.json | 仅 `"version": "0.1.0" → "0.1.1"` 一行（diff 实测恰一行） | §10 显式扩展条目（SA4 R1 R2 → SA1 补列，理由 = 硬门禁 #9）✅ |
| test 修改（4） | driver.ts（TEST_DEFER + 2 处 accept 传 identity）、spec-b1-b2（1 处 accept 调用点）、sa6-g1g2（AC1 锚替换，裁决 2）、sa6-g3g4（accept 调用点 + AC5-RR 裁决 1 构造 + 6 补充锚）、r3-r4（**仅用例 ⑦**：`await removeTarget` → 发起/结算分离 + `await closeP` 一行，两 hunk 均落 L241-276 区间，断言面零触碰） | 全部在 §10 ALLOW/豁免条目内 ✅（r3-r4 ⑦ 豁免 = §3.8 裁决 3(3)，其余用例 diff 实证零触碰） |
| test 新建（2+1） | sa6-g1g2 / sa6-g3g4（SA6 红灯契约交付物，§10 列名）✅；**sa7-hardening-dynamic.test.ts（945 行，7 例）——§10 未列名** | 见下方专项裁定 ✅（非阻断） |
| wiki（12） | 简报/冲突报告×2/设计/决议/review×2/sa6_red/sa7_report/ac_checklist/dispatch/bug 分析 | 流水线档案面，与 merged #133 同款惯例（其 REPORT.md 记载同形态 wiki 档案提交）✅ |

**DENY LIST 零触碰（diff --name-only 实测）**：`replication-protocol/**`、`namespace-registry/**`、`namespace-runtime/**`、`persistence/**`、`apps/**`、`docs/**`、`src/testing.ts`、`test/harness.ts`、`api.test-d.ts`、`ac1-ac7*`、`sa4-*`、`sa7-dynamic.test.ts`（PR #160 既有 SA7 文件——注意与本次新文件 `sa7-hardening-dynamic.test.ts` 名称不同）全部零命中 ✅。BLACKLIST（lockfile/TASK.md/.bak）零命中 ✅。`git status` 无 diff 外源码残留（仅 dispatch wiki 修改 + `.mabf-dispatch-ts` 标记）。

**专项裁定 — sa7-hardening-dynamic.test.ts 不在 §10 字面清单**：(a) 零生产代码、零 DENY 面触碰；(b) 该文件是 SA4 §六 动态审核重点 1–4 + R2-6 O1 的直接委托产物（SA4 R1 明文「建议随修复补一条多 ns 竞争下的关联完整性测试锚（交 SA6/SA7 契约面）」，dispatch #23 派发记录授权）；(c) 总控 Phase 3.5 AC 门禁已将 D1/D3/D6 引为 AC4/AC5/AC6 证据并接受（ac_checklist）；(d) SA 动态验证产出新测试文件有 merged 先例（#133 REPORT：「SA7 动态 2 文件 24 用例」）。**裁定：属流水线委托内的补充测试产出，非范围蔓延**；瑕疵仅为 §10 未做形式补列（文档级 nit，非阻断，建议总控在收尾 REPORT 留痕即可）。

---

## 四、疑似不正确行为审查（实现 vs 设计/协议语义）

**协议文本逐节 sed 核验**（非转述）：§2 L34-40（bearer 预验证产可信 instanceId；活性仅 WS ping/pong）、§6.1 L120（HELLO peerInstanceId 必须等于 Upgrade 身份）、§8.2（BOOTSTRAP_ACK.ackedSequence = 快照序）、§9.4（声明后不再发新 UPDATE；恢复恒由 peer 发起；窗口收口后新 round）、§12（CLOSE_OK 关联；close 不等丢失 UPDATE_ACK；终止性 ERROR 已收口不再追加 CLOSE 握手）、§15.1 L440（1011 继续 backoff 不永久 blocked）、§17（per-ns 队列 + round-robin 每轮每 ns 至多一帧；总队列超限按最大 queued ns 丢弃至低水位；控制保留额度耗尽 = CONNECTION_BACKPRESSURE；bufferedAmount 经 Cordis Timer 检查）、§18（HELLO/pong timeout 关连接；ACK timeout 不重发、进 needs-resync 由新 round 修复）、§7.1 L164（每个 OPEN 必答）、§6.3（GOAWAY 后停止 OPEN/新 round）。**实现语义与上述全部一致；协议/ADR 文本零改动（只消费）。**

**重点推演面**（逐项过）：sendControl 返回值 = 控制帧自身序（SA4 R1 修复——`drain()` 返回 `lastControlSeq`，关联基准不被数据帧派发污染；SA7 D1/D2 动态锚锁定）；滞回 shed 滞回条件与停机线与 §3.2 逐字一致；规则 C 与 A 同检查点并列评估（无 else-if 短路）；pendingData 三出口（dispatched/shed/teardown）记账闭环（`update-channel.ts` + `frame-io.ts dispose` 逐 ns onDataShed）；hub `cleanupAll` 先通道收口后 dispose（isQuietState 守卫 → 零向死连接发帧）；E1–E5 close 结算事件集接线（onCloseOk/onTimerFired/onConnectionLost·Fatal·Stopped/onCloseRequest 完成段/finalize 无条件 settle）grep 逐点核全。

**非阻断观察（均非本 diff 引入或属既有裁量，不构成本轮阻断）**：
1. peer `onCloseRequest` drain 后段 `if (state !== 'closed') setState('closed')` 无 `isTerminal()` 守卫（hub 侧有）——closing drain 期若 apply 终局 finalize，理论可 failed→closed 覆写并在终态 ERROR 后追加 CLOSE_OK（协议 §12 L313 字面张力）。**与 PR #160 基线逐字节同形**（本 diff 仅新增同步 closing），且与设计 §4.1 伪码一致；SA4 N5 已记录同族方向纪律观察。建议另开票评估，不在本票范围。
2. SA4 已记录并经动态验证的非阻断项：N3（drain 在窗口满 ns 处整轮回退——检查点 timer 兜底，SA7 D3 证有界无饿死）、N4（pong 无载荷代际关联，协议未定义）、O2（closeMemo 跨周期复用，promise 语义偏弱但状态机正确）、O3（`sendData` 无队列门静默返回——结构性不可达，teardown 兜底记账清零）。
3. §10 未形式补列 SA7 新测试文件（见 §三专项裁定，文档级 nit）。

---

## 五、终审亲跑验证记录（只读命令，repo root = worktree）

| 命令 | 结果 |
|---|---|
| `./node_modules/.bin/vitest run packages/ws-replication` | Test Files 15 passed (15) / Tests 110 passed (110) / Type Errors no errors（3.00s） |
| `npm run typecheck`（11 包 tsc 链，含 ws-replication） | exit 0 |
| `git diff --check origin/docs/phase-5-websocket-replication HEAD` | 零输出，exit 0 |
| `gh issue view 163 / 164` | 均 OPEN（observability / slice-9 组合根） |
| `git status --short` | 无 diff 外业务/测试改动（仅 dispatch wiki + 调度标记） |

## 六、结论

**Verdict: clear** — 21 项 required fixes 全部实现/处置（G6 为澄清 + #163/#164 开票，gh 实证）；7 条 AC 全部有真实断言面覆盖且经本审查员独立复跑证实；diff 全部落在设计 §10 ALLOW LIST 及后续扩展条目/流水线委托面内，DENY/BLACKLIST 零触碰；协议与设计语义逐节核验一致，无疑似的本 diff 引入的错误行为。无阻断项。

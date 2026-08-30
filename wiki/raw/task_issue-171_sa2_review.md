# SA2 攻击评审报告 — issue #171 设计（`task_issue-171_design.md`）

**Date**: 2026-08-30（R1 首轮）
**Verdict（R1，已被 R2 取代）**: reject（2 CRITICAL + 2 MAJOR + 4 MINOR；CRITICAL 项落在任务核心 Scope 上，须修订设计后重审）
**最终 Verdict（R2，2026-08-30）**: **pass** —— R1 修订版八项发现全部实质落实并经机制级复核（见文末「SA2 R2 复审」节）；残留 2 项非阻塞注记（§R2-N1 总则措辞对齐、§R2-N2 SA7 动态确认项），零阻塞项。

**审查方式**：全新视角通读设计全文 + 独立对照源码逐条验证（`peer-namespace.ts` 1043 行 / `hub-namespace.ts` 893 行 / `peer-connection.ts` 706 行 / `hub-connection.ts` 关键段 / `update-channel.ts` / `fence-watchdog.ts` / `backpressure.ts` / `lifecycle-queue.ts` 全读；协议文档 §5/§6.3/§9.4/§10.2/§12 核对；红灯契约 336 行逐锚推演；既有锚 `sa6-hardening AC3b`、`sa7-issue137 D5` 原文核对）。前提：`task_issue-171_relevant_decisions.md` 全文（ADR-0010 含 #161/#134 修订节、ADR-0009 L32/L42、ADR-0008 L93）作为约束基准。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议（可执行修订要求） |
|---|--------|--------|---------|------|
| 1 | **CRITICAL** | §D1 `cleanupResources()`（设计 L125-128） | **claim 捕获时点自相矛盾：代码在任务体内捕获，违反设计自己的总则 1 与 §4.2 表**。`return this.enqueueLifecycle(() => this.runDisposal(this.claimForDisposal()))` 中 `claimForDisposal()` 在**任务执行时**才求值，不是「排队时/事件同步段」。§4.2 表声称 loss/fatal/stop/finalize/closeTimeout 各行「捕获时点＝事件同步段」，与 §4.1 代码直接矛盾。**可达成 P3 同款杀新代**：① gen1 hub-CLOSE 续体 T1 挂在 `drainPendingApplies`（saveGate，SA6 P3 已证可达）；② 挂起期间连接 fatal（另一 ns 的 UPDATE_ACK 违例 / GOAWAY SHUTTING_DOWN / 本 ns 迟到违例帧 finalize）→ §D8.1 `onConnectionFatal` **closing 分支也无条件** `void this.cleanupResources()`（对照 §8.1：`onConnectionLost` 的 closing 分支不排、`onConnectionFatal` 排）→ T2 入队尾随 T1；③ blocked 后 re-add/config-change 触发 `requestRebuild` → dialNow(epoch2) → gen2 建成 session2/lease2/listener2；④ 放行 saveGate → T1 结算（正确处置 gen1）→ **T2 开始执行时才调用 `claimForDisposal()` → 捕获到 gen2 字段，且 epoch 比对（当前 e2 === 捕获 e2）恒真** → 摘 listener2、close session2、release lease2、teardown round/channel/watchdog → gen2 端到端死亡。这正是 Scope 2 / AC1 要消灭的缺陷，经设计自己的核心原语复活。 | `cleanupResources()` 改为排队前捕获：`const claim = this.claimForDisposal(); return this.enqueueLifecycle(() => this.runDisposal(claim));`。同步修正 §4.2 表使其与代码一致，并明确 `onConnectionFatal`（closing 分支）与 `onConnectionLost`（closing 分支）的处置排队不对称是有意为之还是遗漏（若 `onConnectionFatal` closing 分支的补排队只为「finalize 未排过的保底」，注释须写明其幂等兑付前提是 #1 修复后的排队时捕获）。 |
| 2 | **CRITICAL** | §D4 `onCloseOk` 例外分支（设计 L274-280、§14 边界 #8、§15 假设 #6） | **「closeSequence===undefined 时接受任意 CLOSE_OK」分支接受的是协议上不可能合法的帧，直接违反 ADR-0010 L147「错误ACK关联关闭连接」与任务 Scope 5「no silent completion」**。协议 §5 注册表：`CLOSE_OK` 的发送方是 `CLOSE_NAMESPACE` 的**接收方**——hub 应答 peer 的 CLOSE_NAMESPACE；hub 自己发起 CLOSE_NAMESPACE 时应答帧是 peer→hub 方向，**hub→peer 的 CLOSE_OK 只能由 peer 发出的 CLOSE_NAMESPACE 触发**。peer 全库唯一 CLOSE_NAMESPACE 发送点是 `removeTarget`（peer-namespace.ts:561，grep 证实 hub 侧零发送）：seq>0 → `closeSequence` 必有值；seq≤0 → 设计 §D3 走本地收口（终态 `closed`，静默域）。因此「state==='closing' ∧ closeSequence===undefined」（唯一入口 = hub 发起 CLOSE 的 `onCloseRequest`）时，peer **从未发出** CLOSE_NAMESPACE → 任何入站 CLOSE_OK 按定义就是 unmatched。该分支却对其「幂等推进收口」——伪造帧静默完成 close 承诺 + 提前投影 `closed`，恰是 C4/AC4 要消灭的缺陷类在窄窗口复活。§D4 自己的注释「hub 恒不主动 CLOSE（§5 注册表）」与 §D7 表「hub 发起的 CLOSE 在 drain 窗口照常履行」、§15#6「hub 发起 CLOSE_NAMESPACE」三处互相矛盾。 | 删除该例外分支：closing 且 `closeSequence===undefined` 时收到 CLOSE_OK → 与活跃态同款 `connectionFatal('ACK_STATE_VIOLATION', 1002)`。若为未来 hub 发起 CLOSE 保留接受语义，必须**关联校验**：`onCloseRequest` 已持有 hub CLOSE 帧的 `message.sequence`，捕获它并要求 `ackedSequence === 捕获值`，否则 fatal。同时修正 §15#6 的依据表述（§5 L104 的 either 方向指 CLOSE_NAMESPACE 可双向发起，不产生「hub 对自身 CLOSE 的 CLOSE_OK」）与 §D4/§D7 的矛盾注释。 |
| 3 | **MAJOR** | §D1 `runDisposal` epoch 守卫（设计 L115-122）+ §D5.2 | **跨代跳过 aux teardown 在「新代永不 open」的控制器上造成无限期资源泄漏，违反 AC2 明文（"no subscription, watchdog, round, ACK timer, or channel-state leak"）**。`FenceWatchdog.startIdle` 每 `idleProbeMs` 自我重武装（fence-watchdog.ts:56-66），只有 `teardown()` 能停；`UpdateChannel` 持有 queued bytes/inFlight/zombieSeqs（update-channel.ts:255-261）。可达成路径：gen1 live → `removeTarget`（seq>0，ensureCloseMemo 排队 T=[drain+runDisposal(claim₁)]）→ 断线（closing 分支：settle + `disconnected`，处置交 T）→ 重连 epoch2，但 `intent='removed'` → `openActiveTargets` 跳过（peer-connection.ts:447-448）→ **§D5.2 的 aux 重置永不发生**（它只挂在 gen2 open 路径上）→ T 执行：epoch2≠epoch1 → 只关 session1/release lease1，**watchdog idle timer 永久重武装（每 ackTimeoutMs 一次 no-op 探测）、channel 残留 gen1 队列/簿记、round 残留 wasLive/在途序**，controller 又永不从 map 移除 → 泄漏随 PeerReplication 生命周期存续。§4.1 注释「gen-N 残留的 round/channel/watchdog 簿记由新代 open 路径自重置」仅对 `intent='active'` 成立。 | epoch 守卫改为**身份守卫**：aux teardown / 字段清空条件从 `connectionEpoch() === claim.epoch` 改为 `this.session === claim.session`（自捕获以来无新 session 建立 ⇒ aux 仍归本代，无论 epoch）。该判据同时正确覆盖：P3（session2 已建立 → 不等 → 跳过 ✓）与泄漏场景（无 gen2 → `this.session` 仍 === 捕获值 → teardown ✓）。或在设计中明文补「epoch 已推进 ∧（intent='removed' ∨ 终态）⇒ 仍执行 aux teardown」的兜底规则。 |
| 4 | **MAJOR** | §13.2 兼容表 `sa7-issue137 D5` 行（设计 L557） | **绿灯论证建立在错误前提上：「watchdog 由处置段清——时点不变」不成立**。现状（peer-connection.ts:404-411）处置发生在 **deadline 回调**；§D6 后处置移到**收帧同步段**。D5（test L536-544，`ackTimeoutMs=120_000` ⇒ watchdog idle timer 自 subscribe 起一直武装并计入 `beforePause`/`pausedPending` 基线）在「注入 GOAWAY → `await settle()` → `expect(pending).toBe(pausedPending + 1)`」检查点：设计下将发生 −1（watchdog idle 于收帧段处置中被 teardown）+1（drain timer）±1（`lease.release()` 触发 registry idle-eviction timer 计面）——断言是否仍绿取决于 registry idle 计时的簿记巧合，而非设计所陈述的理由。设计不能以错误论证放行冻结锚；若该锚翻转而未登记 §13.1（SA6 owned），SA3/SA7 将陷入「就地改测试」的违规境地。 | 在设计 §13.2 中重推 D5/D5B1 全检查点（`beforePause`/`pausedPending`/L544/L552/L557）在新时序下的精确 timer 账目（含 watchdog idle、registry idle-eviction、drain、poll 四项的增减时点）；若任一断言翻转，把它移入 §13.1 翻转清单（SA6 owned），并给出翻转后断言。D5B1（SHUTTING_DOWN→enterBlocked 收帧即静默）确实不变，可保留 ✓。 |
| 5 | MINOR | §D8.3 `startOpen` registry.open 之后的失败分支（设计 L479「既有 NAMESPACE_NOT_FOUND / INTERNAL_ERROR 分支不变（活连接）」、L483 identity/mode 判定） | 伪代码未对 `!opened.ok`（registry 拒绝）与 `REPLICATION_ID/EPOCH_MISMATCH` 分支标明 `isOpenAborted()` 先行判别；中止态下走 `finishOpenError` 会向已静默连接补发 ERROR 帧——违反总则 3「迟到续体零 wire」。实测影响有限（hub `isEmitAllowed: () => !this.closedFlag`（hub-connection.ts:152）+ transport 关闭守卫使帧实际不出 wire；`finishOpenError` 的 setState 有终态守卫），但这是设计自身规则的执行漏洞，SA3 照抄伪代码即产生违反总则 3 的路径。 | 明确规定 registry.open 之后**每一个**失败出口先判 `isOpenAborted()`：已中止 → `finishOpenSilently(已取得资源)` 静默回收；未中止 → 既有 ERROR 行为不变。伪代码补齐该两行的显式形态。 |
| 6 | MINOR | §D8.4 `finishOpenSilently` 清空 `openWaiters`（设计 L508） | hub `onOpen` 在 closing 态收到的第二个 OPEN 会把「收口后答复 `NAMESPACE_REOPEN_REQUIRES_RECONNECT`」的 waiter 压入队列（hub-namespace.ts:189-196）；startOpen 续体中止时 `finishOpenSilently` 把 waiters **整体静默丢弃** → 该 peer 的 OPEN 无任何应答 → 只能等 openTimeout 把 ns 打成 failed。协议 §7 明文「每个请求都收到 OPEN_OK 或 ERROR」。系既有行为非回归，但本任务恰好重写该流程，且 Scope 1 的主旨就是迟到续体的闭环。 | 设计明文登记此窗口并二选一：(a) 维持静默丢弃（论证：连接已静默、总则 3 零 wire 优先，peer 由 openTimeout 收口）并写入 §13.3 不变式；(b) 中止时对 waiters 统一发 reopen 错误（仅限连接未死窗口）。不得留白。 |
| 7 | MINOR | §D1 `enqueueLifecycle`（设计 L91-95）+ §16 caller 审计 | `enqueueLifecycle` 返回的 `run` promise 由调用方处置：§D2 以 `void this.enqueueLifecycle(...)` 调用——任务体一旦 throw（`unsubscribe()` 来自 session seam 的用户回调、`session.close()` 在 ADR「永不 reject」之外的实现偏差等），rejection 成为 unhandled rejection（进程级告警/崩溃面）。§16 声称「cleanupTail 链尾吞错」只对链尾 `this.cleanupTail` 成立，不对返回值成立。现状 `onCloseRequest` IIFE 同样裸奔，非回归，但设计正把该原语升格为「单一权威」，应自带 contained 语义。 | `enqueueLifecycle` 内对 fire-and-forget 场景提供吞错包装（或规定 `void` 调用点一律 `.catch(() => undefined)`），并在 §16 caller 表补一行说明。 |
| 8 | MINOR | §D5.4 / §D7：drain 窗口内 SYNC_APPLIED 抑制 vs UPDATE_ACK 放行的非对称 | 同一 GOAWAY drain 窗口、同为「已接纳工作 的 ACK」：非 Step2 路径 UPDATE_ACK 照发（§D7 表，依据协议 §9.4 L250「已接纳 update 正常 apply/ACK」），Step2 路径 SYNC_APPLIED 抑制（§D5.4 `isInboundQuiet` 含 disconnected）。设计给出的理由「消耗死连接出站序列」与事实相反——drain 窗口连接存活（G5-③ 断言 connState 恒 ready），帧可正常出站。抑制并非协议义务（§6.3 只要求「停止 OPEN、不开始新 round」，在途 round 的收尾 ACK 未被禁止），但非对称缺乏依据，hub 侧 round 簿记因此悬置到 deadline。 | 二选一并写明依据：(a) 与 UPDATE_ACK 对称——drain 窗口（连接 ready、epoch 未变）内 SYNC_APPLIED 照发，完成在途 round 收尾；(b) 维持抑制，但理由改为真实依据（如「在途 round 在 deadline 关连接后由重连 reconcile 修复，无义务收尾」）并核对协议 §9.1.4/§9.4 无相悖条款。禁止以错误理由固化行为。 |

### 已验证为成立的设计要点（攻击未穿透，供 SA1/SA3/SA4 复用）

- **H1 / D-H1**：机制推演成立。`finishOpenSilently(pendingLease?)` 对「registry.open 已交付、未赋字」的 lease 显式回收（`pendingLease !== this.lease` 判据在 H1 窗口恒真）→ 锚①恰 1 事件、锚② finalRemaining=1，与红灯契约逐锚吻合；释放次序（先 session 后 lease）符合 ADR-0010 L90。observer seam 依据属实（observer.ts:27 仅 `lease-released`；lease.ts:213 发射点）。
- **C4 全链**：closing+`closeSequence≠undefined` 错配 → `connectionFatal('ACK_STATE_VIOLATION',1002)` → ERROR 直发 outbound（peer-connection.ts:542-561 豁免路径）→ `enterBlocked`（transport close + `controller.onConnectionFatal` closing 分支 settleCloseMemo）→ removeTarget 承诺有限结算。四锚全兑付；与库内权威策略（hub `onBootstrapAck` hub-namespace.ts:450-456、`onUpdateAck` violation 同款）及 ADR-0010 L147 一致。
- **G5 全链**：收帧同步段 `quiesceControllers()` → 各控制器 `onConnectionFatal`（摘订阅/投影 disconnected/处置排队）；`sendFacet.pullAndSendOne` 的 `state==='live'` 门（peer-namespace.ts:106）+ 订阅摘除双保险 → 零 UPDATE 出站；deadline 只关 transport、connState 保持 ready（本地 close 不触发本地 onClose 的 seam 事实成立）。与 #161 修订节「同步静默订阅先于异步 drain」对齐。
- **AC3 抑制发送路径**：`sendControl` 返回 0 的两类成因均不留下「hub 侧孤悬 live 通道」——connState≠ready 意味连接已死/在断；control 保留额度耗尽会**立即**触发 `onBackpressureExhausted → failConnectionBackpressure → close(1011)`（backpressure.ts:77-90 + peer-connection.ts:571-593）。本地收口 + 立即 settle 的处置正确。
- **P3 主路径（§D2）**：claim 于 `onCloseRequest` 同步段捕获（quiesceSync 之后，unsubscribe=undefined）、epoch 守卫 CLOSE_OK/状态迁移、§D5.2 新代 aux 重置——四锚推演全绿（前提：#1 修复后 `cleanupResources` 不再构成旁路错代载体）。
- **死抽象清理**：`isGoawayDraining`（peer-namespace.ts:52 声明 + peer-connection.ts:94 装配，零消费）与 hub `cleanupTail`（hub-namespace.ts:92，零引用）grep 复核属实；§D9 的「双侧分责 + 清死抽象」符合 Scope 7 的第二选项（"define separate authoritative duties and remove dead abstraction"）。
- **`openActiveTargets` 的 `goawayActive` 门**确有消费者（peer-connection.ts:446），保留判断正确。

---

## 协议假设依据审查（2026-06-13 立法）

- **章节存在**：§15 共 7 行，依据类型全部为「源码引用 / 现有测试引用 / 设计期实测」的组合，无「应该/通常/预计」类无据推断；实测项（#0.1 红灯复跑、H1 探针）附命令与输出摘要，可被 SA4 重跑。**通过**。
- **依据可定位性**：逐条回查——#1（协议 §6.3 L149 原文 + #161 修订节）✓；#2（hub-namespace.ts:450-456 / peer-namespace.ts:482-487 / §10.2 L283 / §13.1 L351）✓；#3（harness 本地 close 不自通知的 seam 事实，与 G5-③ 断言自洽）✓；#4（observer.ts:27 / lease.ts:213）✓；#5（ADR-0009 L42 + #134 修订节 L246）✓；#7（ADR-0009 lease 计数 + 探针）✓。
- **#6 不成立（→攻击点 #2）**：`CLOSE_NAMESPACE either 方向 / Result=CLOSE_OK`（§5 L104）推导不出「hub 对其自身 CLOSE_NAMESPACE 的 CLOSE_OK 是合法应答」——Result 语义决定 CLOSE_OK 的**发送方是 CLOSE 的接收方**；either 方向只说明谁都可以发起 CLOSE。全库唯一 CLOSE_NAMESPACE 发送点是 peer `removeTarget`（grep 证实）。该假设需按攻击点 #2 修正。
- 补充核对：协议 §12（L306-311）「Receiver 同步停止接纳…然后 close session、release Lease 并发 CLOSE_OK」「正常 close 不等待丢失的 UPDATE_ACK」——设计 §D2/§D3 的处置次序与 §D3 不等 ACK 的本地收口均与此吻合。

## 错误处理链路审查（2026-05-07 立法）

- **静默失败检查**：removeTarget 承诺的结算闭环完整——matched CLOSE_OK（§D4）/ violation fatal（§D4 → enterBlocked → settle）/ 断线（§D5.1）/ blocked（§D5.1）/ stop（onConnectionStopped）/ closeTimeout（onTimerFired）/ 发送抑制（§D3 同步 settle）七条路径全部有显式结算点，无「无反馈悬挂」残余（C4-④ 兑付）。**两处静默洞**：攻击点 #2（伪造 CLOSE_OK 在 hub 发起 closing 窗口被静默接受而非显式错误——正是 AC4 禁止的 silent completion）；攻击点 #6（hub 收口期迟到 OPEN 的 waiter 被静默丢弃，peer 只能靠 openTimeout 兜底）。
- **状态闭环检查**：错误态写入面完整——`disconnected` 投影在 loss/fatal 全分支同步完成；violation 收口经 `connectionFatal → enterBlocked` 闭环；close 承诺 settle 在所有终局路径可达。攻击点 #1 是状态闭环的反向破坏（错误续体把**新代**已正确的状态错误地终局化）。
- **降级路径检查**：依赖死亡（断线/blocked/GOAWAY）的降级策略齐备——同步投影 + claim 化处置 + 重连 reconcile；GOAWAY 双 reasonCode 分派（SHUTTING_DOWN/REAUTH → blocked；RESTARTING → drain）符合协议 §6.3。
- **虚假降级识别**：设计的唯一「合法忽略」= 静默域（closing/终态/disconnected）内带显式状态门的协议规定忽略（§D7 表逐 handler 编码），非把「本应恒真前提的缺失」伪装成降级——**未发现虚假降级**。唯一边缘项是攻击点 #8 的非对称抑制（属理由错误，非伪装降级）。

## 红线测试思路（每漏洞对应的 IT 编写方向；均可用现有 harness/driver 确定性构造）

- **#1（cleanupResources 执行期捕获）**：`ws-replication-issue171-red` 同族新锚 P3b——gen1 live + `saveGate` 悬挂 + hub CLOSE（T1 挂 drain）→ 第二 ns 注入错配 `UPDATE_ACK` 触发 `ACK_STATE_VIOLATION` 连接 fatal（blocked）→ re-add target（config-change rebuild）→ gen2 live（订阅在、state live）→ 放行 saveGate → 断言：gen2 保持 `live`、`controller.unsubscribe` 仍为 function、`writePeer` 收敛到 hub、无迟到 CLOSE_OK 打穿 hub gen2 通道。（现行设计实现下四锚预期红。）
- **#2（CLOSE_OK 例外分支）**：新锚 C4b——live 期注入 hub→peer `CLOSE_NAMESPACE`（`reasonCode:'hub-side-close'`）→ `waitNamespace('closing')`（此态 `closeSequence===undefined`）→ 注入 `CLOSE_OK{ackedSequence: hubCloseSeq+7}` → 按权威策略断言：`ACK_STATE_VIOLATION` ERROR 帧 + 连接 `blocked` + transport 关闭 + close 承诺结算；**不得**断言到 `closed`（silent completion 即红）。
- **#3（aux 泄漏）**：新锚 L1——live + `removeTarget`（drop 真实 CLOSE_OK）+ 断线（closing→disconnected settle）+ `advanceMs(backoff)` 重连 gen2（intent removed ⇒ 不重开）+ 放行悬挂 apply + `advanceMs(ackTimeoutMs*3)` → 对象图投影断言：controller 的 watchdog 无 idle timer 残留（经 `peerNode.scheduler.pending()` 计面或 `watchdog` 内部投影）、`channel.queuedBytes===0`、`inFlightCount===0`。
- **#4（D5 计面）**：直接原样重跑 `ws-replication-sa7-issue137-dynamic.test.ts` D5，按新时序重列 `beforePause/pausedPending/L544/L552/L557` 四检查点的 timer 账目（watchdog idle / registry idle-eviction / drain / poll）；若 L544 翻转 → 按 SA6 流程登记翻转而非就地改断言。
- **#5（迟到 ERROR 零 wire）**：gen1 OPEN（authorize 门闩悬挂）+ `registry.open` 返回 `NAMESPACE_NOT_FOUND` 的注入 seam + 连接静默 → 放行 → 断言死亡连接出站帧数冻结（`framesFrozen` 模式）+ observer 零新事件。
- **#6（waiter 丢弃）**：hub authorize 悬挂期间，同 ns 二次 OPEN（合流 waiter）→ 连接静默 → 放行 → 断言 peer 侧最终经 openTimeout `failed`（现状）或收到 reopen 错误（若设计改为 (b)）——按设计裁决固化其一。
- **#8（SYNC_APPLIED 非对称）**：live + 在途 round（Step2 已达 peer、apply 悬挂）→ GOAWAY RESTARTING → 放行 apply → 按设计最终选定的语义断言 SYNC_APPLIED 出站与否（钉死决策，防 SA3/SA4 各自解释）。

---

## 结论（R1 轮，已被 R2 取代）

**reject**。设计的根因分析（RC1–RC7 复核）、红灯锚对位、H1/C4/G5 三链处置与兼容面盘点整体质量高，但：核心原语 `cleanupResources` 的 claim 捕获时点与自身总则矛盾并保留 P3 同款杀新代路径（#1，CRITICAL）；`onCloseOk` 例外分支对协议上不可合法关联的帧静默收口，违反 ADR-0010 L147 与 Scope 5（#2，CRITICAL）；epoch 守卫在「新代永不 open」路径上留下 watchdog/channel 永久泄漏（#3，MAJOR，违反 AC2 明文）；D5 兼容论证基于错误前提（#4，MAJOR）。请 SA1 按上表修订（#1/#2/#3 均为一行至数行的精确修改，不动设计骨架），连同 #5–#8 的登记/澄清一并重审。

---

# SA2 R2 复审（最终轮）— R1 修订版设计

**Date**: 2026-08-30
**被审对象**：`task_issue-171_design.md`（R1 修订版，773 行，含 R1 修订头注 + 「SA2 反馈逐条回应（R1）」表）
**审查方式**：全新攻击视角重读 R1 全文（不止对照回应表）：逐项验证 8 条发现的**机制级落实**（非措辞承认），并对 R1 新引入的机制（轻量/全量两层静默、身份守卫、onConnectionQuiesce 新方法、fatal 后收口闭环）做**新一轮攻击推演**；对每条兼容性主张回查测试原文。

## R1 发现闭环验证（逐条机制级复核）

| R1 # | 修订声称 | R2 独立验证结论 |
|---|---|---|
| 1（CRITICAL）claim 执行期捕获 | §4.1 `cleanupResources` 伪代码改为 `const claim = this.claimForDisposal();` 于 lambda **外**求值；§4.2 表「捕获时点」列重写；Lost/Fatal closing 分支不对称裁决为「有意保底」+ 不变量 I-C | **✅ 落实**。代码字面正确（求值点 = caller 同步栈）；I-C 不变量独立复核成立——peer 侧进入 `closing` 的全部入口（`onCloseRequest` L496、`removeTarget` L558）均在进入同步段内经 §D2 续体 / `ensureCloseMemo`→`closeMemo.get()`（Memoized executor 首调即执行，同步段内 enqueue）排队带 claim 处置任务，无第三入口。SA2 #1 攻击路径（T1 挂 drain → 他 ns 违例 fatal → T2 补排 → blocked→re-add→gen2 → T2 执行）重推：T2 的 claim 于 fatal 同步段求值 = gen1 资源；执行时 `runDisposal` 只处置 session1/lease1，身份守卫（§4.1）不命中 session2 → gen2 零触碰（§14 行 17 对位正确）。**封死**。 |
| 2（CRITICAL）CLOSE_OK 接受例外 | §D4 重写：closing 期除「closeSequence 有值且匹配」外一律 `connectionFatal('ACK_STATE_VIOLATION',1002)`；§15#6 依据重写；矛盾注释消除 | **✅ 落实**。协议推演独立复核：CLOSE_OK 发送方恒为 CLOSE_NAMESPACE 接收方（§5 L104 Result 语义 + §12 L306）；peer 唯一发送点 `removeTarget`（peer-namespace.ts:561）seq>0 必设 closeSequence、seq≤0 走本地终态——「closing ∧ closeSequence===undefined」入站 CLOSE_OK 按定义 unmatched。**新证据补强**：hub 侧 hub-connection.ts:323-326 原文即「hub 不发 CLOSE（CLOSE 恒由 peer 发起）；收到即方向异常」——设计引用属实，且双侧对称证实。fatal 后收口闭环复核：blocked 不拨号 → epoch 不变 → §D2 续体照常 `setState('closed')` + settle（sendChecked 经非 ready 门零出站）——无悬挂。全库 CLOSE_OK 注入测试仅 2 处（issue171-red C4 / sa6-hardening AC3b），均落在错配窗口——**universal fatal 不破坏任何既有绿灯锚**。 |
| 3（MAJOR）跨代 aux 泄漏 | `CleanupClaim` 删 epoch；`runDisposal` 改身份守卫 `this.session === claim.session`；`this.lease === lease` 子守卫 | **✅ 落实**。三路径重推：P3（session2 已建 → 守卫不命中 → gen2 零触碰 ✓）；泄漏面（intent removed + 重连 → openActiveTargets 跳过（peer-connection.ts:447-448）→ `this.session` 保持捕获值 → 守卫命中 → 清字段 + watchdog/round/channel teardown，fence-watchdog.ts:56-66 自重武装链终止 ✓）；部分建立的新代（gen2 opening 已赋 lease2 未建 session2）：session 守卫命中但 lease 子守卫不命中 → lease2 保留 ✓、aux teardown 幂等安全（§D5.2 将在 session2 建成时再重置）✓。session 对象不复用（Registry 语义）→「先不等后复等」不可达，判据健全。**附赠验证**：stop()/finalize() 在 stuck-disposal 期间对**当前代**的处置经身份守卫正确命中（claim 捕获的是 stop/finalize 时刻的字段）。 |
| 4（MAJOR）D5 计面错误论证 | §D6 重写为轻量/全量两层：收帧段 `onConnectionQuiesce`（摘订阅/清 timer/投影，**零处置排队**）；处置留 deadline 回调全量层 | **✅ 落实且机制复核通过**。关键机制独立验证：轻量层 `clearAllTimers` 只清 ns 级 `timers` 记录（open/bootstrap/reconcile/close），**不触碰** watchdog 自管的 idle timer（fence-watchdog 内部 handle，仅 `watchdog.teardown()` 可清，而 teardown 在 `runDisposal` 内 = deadline 全量层）——live 态收帧段 timer delta 恰为 **+drain** → D5 L544 `toBe(pausedPending+1)` 与现状逐值一致；deadline 段（watchdog teardown −1 / lease release→registry idle +1 / sender.teardown −poll）与现状同点同款 → L552/L557 不变。**G5 三锚在新两层下全绿**（锚①②轻量段即兑付、锚③ deadline 只关 transport + connState 恒 ready）。G1/R3-5 原文回查：G1 在 drain 窗口仅断言 connectionState/peerSideClosed（L187-189，注释明言「不断言」ns 态）、`waitNamespace('disconnected')` 在投影提前后仍真；R3-5 断言「订阅 undefined」在提前后平凡成立——**无锚翻转**。 |
| 5（MINOR）取得后失败分支缺中止判别 | §11.3 补齐：registry.open 之后每个失败出口两行式（isOpenAborted → finishOpenSilently(已取得资源)） | **✅ 落实**。`!opened.ok` / getStatus catch / replication disabled / identity+mode mismatch / `!sessionResult.ok` 五处均显式或以规则行覆盖；`finishOpenSilently()` 无参形态在已赋字分支由 `closeSessionAndRelease` 兜底回收（注释指明）。 |
| 6（MINOR）waiter 静默丢弃留白 | §11.4 裁决 (a) + §13.3 登记 | **✅ 落实**。三段论证（总则 3 零 wire 优先 / openTimeout→failed→重连后 §7 L166 reopen 错误闭环 / 与现状一致非回归）成立，已登记不变式。 |
| 7（MINOR）enqueueLifecycle 吞错 | 任务体结构性零 throw（unsubscribe 包 try/catch、close/release 各自 `.catch`）+ 全部 void 调用点显式 `.catch(()=>undefined)` + §16 表改写 | **✅ 落实**。§D2/§D3/§D5.1 伪代码逐点带 `.catch`；§16 cleanupResources 行注明返回值 rejection 只传播给显式 await 方（ensureCloseMemo body）。 |
| 8（MINOR）SYNC_APPLIED 非对称 | 裁决 (a) 对称放行：peer 维持既有 epoch 门**零改动**；hub 补 isQuietState 门（理由修正） | **✅ 落实**。与 UPDATE_ACK 统一口径（§9.4 已接纳工作 ACK 义务）；B-1 守卫防 disconnected 复活（onRoundSettled state≠reconciling → return）；drain 窗口内 hub 发起 CLOSE 的履行链（§D7 表 + §D2 出站 CLOSE_OK 经 ready 门照发）独立推演通过。 |

## R2 新攻击扫描（对 R1 新引入机制的独立推演，未再发现阻塞项）

- **轻量层的 timer/结算副作用**：GOAWAY 收帧期控制器在 `closing`（removeTarget 等待中）→ 轻量层清 'close' timer + settleCloseMemo → 承诺经 gate 结算，deadline 全量层/失联路径处置资源——无悬挂；drain 窗口内迟到**匹配** CLOSE_OK 按 §D4 首行 disconnected 静默（承诺已结算）——闭环。
- **轻量层投影后的重建路径**：deadline 被取消（pong 超时先重连，dialNow→clearGoawayDrain）→ 全量层永不跑 → 处置由 `onConnectionLost`（state 已 'disconnected' → 活跃分支）排队承接 ✓；stop() 在 deadline 前调用 → onConnectionStopped 直接处置 ✓——「轻量层投影后无人处置」窗口不存在。
- **opening/bootstrapping 控制器遇 GOAWAY**：轻量层清 open/bootstrap timer（RC3 修复面）+ 投影 disconnected → 在途 startOpen/导入续体经既有 B-2c/B-2a isConnectionDead 判别静默回收 ✓。
- **`onOpenOk`/`onCloseRequest` 在 disconnected 的精准豁免**（§D7 表行独立核对）：onOpenOk 追加 disconnected 静默但 closing 保留 finalize（sa7-hardening D6 锚不动）；onCloseRequest 不豁免（drain 窗口照常履行 → §D2 续体经 ready 门出站 CLOSE_OK ✓）——与各测试锚一致。
- **矛盾残留扫描**：`grep closeSequence===undefined / isInboundQuietState` 仅存于「已删除」描述与 C4b 锚定义（其断言恰为 fatal）——无功能残留；peer applyStep2 确为零改动形态。

## 残留注记（非阻塞，不构成退回理由）

| # | 注记 | 处置建议 |
|---|---|---|
| R2-N1 | **总则 1/3 措辞残留**：总则 1 仍写 claim 含 `epoch` 且「字段只在处置完成且代际未推进时清空」、总则 3 仍写「epoch 已推进 → 零字段触碰/零 aux teardown」——均已被 §4.1 R1 的身份守卫语义取代（无新 session 建立时**有意**跨代清字段 + teardown）。规范载体（§4.1 代码/§4.2 表/§13/§14/§16-§18）全部一致，仅原则段措辞滞后；SA3 若先读总则可能误读处置规则。 | SA1/总控在 SA3 开工前做两行措辞对齐（不构成新一轮评审）；或由总控在派发 prompt 中注明「§4.1/§4.2 为处置规则唯一权威」。 |
| R2-N2 | **SA7 动态确认项**：① 收帧段 ns `disconnected` 提前投影是真实可观测时序变化（G1 明言不断言、R3-5 断言提前后平凡成立——静态核对无翻转，动态面留证）；② hub applyStep2 新增 isQuietState 门（设计自核「零既有测试依赖此帧在 closing 期发出」）；③ §13.4 六新锚（P3b/C4b/L1/W1/W2/W3）为 SA6 决策项，未冻结前不构成 AC 门槛。 | SA7 动态轮按 §13.2/§13.4 清单执行；若发现非预期翻转，按 DENY LIST 纪律回到 SA1 而非就地改测试。 |

## R2 最终裁决

**pass**。八项 R1 发现在 R1 修订版中全部获得**机制级**（非措辞级）落实：两条 CRITICAL 的修复分别经攻击路径重推（#1 杀新代路径封死）与协议推演 + 双侧源码证据补强（#2 hub-connection.ts:323-326 对称证实）；身份守卫在 P3/泄漏面/部分建立新代/stop/finalize 五条路径上推演全部正确；D5 计面论证由「错误前提」变为「机制正确」（轻量层不触 watchdog 自管 timer 的关键事实经 fence-watchdog.ts 源码核实）；新增两层静默机制经独立攻击扫描未见新漏洞；G1/R3-5/D5/CLOSE_OK 注入面逐一回查测试原文，无绿灯锚翻转。残留仅两项非阻塞注记（R2-N1 措辞对齐、R2-N2 SA7 动态确认）。

**放行至 SA3 实现。** *pass 仅表示设计层通过；实现与活链路验证仍由 SA4/SA7 承担。*

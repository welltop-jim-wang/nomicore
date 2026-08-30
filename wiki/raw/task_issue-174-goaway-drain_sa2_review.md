# SA2 攻击评审报告

**Date**: 2026-08-30
**Verdict**: **reject**（3 MAJOR + 3 MINOR + 3 NOTE；架构主轴独立验证全部成立，修订均为局部补充，无需推翻任何主决策。SA1 按下列修订要求更新设计后重审。）

- 被审对象：`wiki/raw/task_issue-174-goaway-drain_design.md`（SA1 R1 初版）
- 约束基准：`task_issue-174-goaway-drain_relevant_decisions.md`（ADR-0010/0008/0009 摘录 + SA8 设计后复审追加节，verdict clear）
- 评审方法：全新视角独立复核——SA5 缺陷报告、SA6 红灯契约（R1–R4）逐断言对读源码（`hub-connection.ts` / `hub-namespace.ts` / `peer-connection.ts` / `backpressure.ts` / `frame-io.ts` / `round-engine.ts` / `defaults.ts` / `namespace-registry/src/testing.ts` / driver + harness fake-duplex）、协议 `instance-replication-v1.md` §6.3/§13/§14/§15.2/§21、既有测试锚（AC-6/D4/r2-transport/issue137-r2/review-revisions R3/sa7-dynamic）逐个到行验证。
- 先说结论：**本设计的核心架构（GOAWAY 与 close(1001) 解耦、drainTail 结算闸、deadline 硬顶、两等待域分离、dispatchReady 前置门、onChannelSettled 提前完成观测）经 SA2 独立推演全部成立**。红灯契约 R1–R4 的映射、AC-6 × R1 冲突的五步证明（SA2 逐步复核了 defaults/resolveTimeouts 合并、fake scheduler 边界 `at <= deadline` 恰好 fire、advanceBy 与 settle 的分工）、D4/r2-transport 的兼容性判定、§4.7 码型论证（协议 §13.2 逐码核对）均准确。reject 的原因是三处 MAJOR：一处实现指令级疏漏（drain 句柄清理矩阵漏了 fatal 路径）、两处完备性声称与源码事实不符（终态入口枚举、hub.close() 消费点盘点）——它们不推翻架构，但 SA3 照设计实现会留下真实缺陷，且 SA4 会把设计声称当比对基准。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议（修订要求） |
|---|--------|--------|---------|------|
| 1 | **MAJOR** | §4.4/§4.6/§6.3 — drain 句柄清理矩阵 | **`connectionFatal()` 与 `onSequenceExhausted()` 两条连接终结路径不清 `drainDeadline` 句柄、不复位 `drainActive`**。设计宣称「§8 timer 纪律：句柄必清」且 §6.3 称「`finishDrain`/`close` 双点清句柄」——但 drain 窗口期内发生连接级 fatal（malformed 帧、SEQUENCE_VIOLATION、方向违例 D9、PONG_TIMEOUT、D1 拒绝帧额度耗尽触发的 CONNECTION_BACKPRESSURE 1011）或出站序列耗尽时，这两条路径**不经过 `close()` 也不经过 `finishDrain()`**（各自直接置 `closedFlag` + `void cleanupAll()`，hub-connection.ts:555-573/607-616），`drainDeadline` timer 残留在 `hub.timer` 上直到 fire。fire 回调 `finishDrain()` 首行 `closedFlag` 早退使**行为安全**，但：(a) 违反设计自设的 §8 纪律与 #161 修订节「句柄必清」精神；(b) fake scheduler 下 `scheduler.pending()` 计面污染 +1 直至 advanceBy 越过 deadline——任何未来「drain 期 fatal + pending() 断言」组合的测试都会踩坑；(c) 回调闭包持有 connection 引用阻碍 GC（有界 ≤drainMs）。现有测试与红灯契约恰好都不踩（R1/R3/R4 的 advanceBy(5000) 会触发 fire；175 基线不调 hub.close() 于 fatal 态）——**缺陷存在但被测试盲区掩护**。 | §4.6 扩为「drain 互锁四路径」：`connectionFatal()` 与 `onSequenceExhausted()` 同步段加与 `close()`/`onTransportClosed()` 相同的 drain 复位 + `clearTimeout`（建议提取私有 `clearDrainHandles()` 单点，四处调用）；§6.3 sa7-dynamic 行的「双点清」表述同步更正为「四路径清」。 |
| 2 | **MAJOR** | §4.3 — 终态通知入口枚举 | **「在全部三个终态入口调用（且仅这三个——终态只能从这里进入）」与源码事实不符**：`onConnectionClosed()`（hub-namespace.ts:593-600）的 closeQueue 链尾 `if (!this.isTerminal()) this.setState('closed')`（:598）是**第四个终态转移点**。结论碰巧正确——onConnectionClosed 只被 cleanupAll 调用、cleanupAll 的全部调用方都先置 `closedFlag=true`，`maybeFinishDrainEarly` 首行早退使第四处无需通知——但设计的**枚举完备性论证前提本身是错的**，SA3/SA4 被指令「仅这三处」的依据是一个不成立的事实陈述。若后续维护者以同样的错误枚举法重构（例如认为 `maybeFinishDrainEarly` 的 `closedFlag` 检查冗余而删除），防御纵深消失。 | §4.3 改述：列出全部四个终态 setState 点，说明第四处（onConnectionClosed :598）无需通知的**真实理由**（执行时 `closedFlag` 恒真 → drain 必已终结），把「终态只能从这里进入」改为「drain 语义相关的通知只需这三处」。 |
| 3 | **MAJOR** | §6.1/§11 — hub.close() 消费点盘点 | **「直接受 hub.close() 时序变化影响的既有锚（全量 3 处，grep 证据）」漏了第 4 处**：`ws-replication-sa7-r1-transport-auth.test.ts:312`（afterAll 清理，`await Promise.race([hub.close(), 3s setTimeout])`）。SA2 独立 grep 证实测试域消费点为 4 处（312 + r2:363 + AC-6:385/393 + D4:503），生产域 1 处（§11 的生产盘点正确）。行为推演：afterAll 先 `peer.stop()`（关 peer transport → hub `onTransportClosed` → 连接收口）→ 随后 `hub.close()` 时连接已 `closedFlag` → `shutdownWithGoaway` 首行早退 → settle() 返回已结算 `settleTail` → race 3s 兜底甚至不触发——**测试不会失败**。但：(a) 设计的「全量 3 处」声称是错的，且 §11 把它标为「SA4 比对基准」，漏项会传导给 SA4；(b) 残余边界——若某 peer.stop() 恰超 3s（race 兜底先行），对应 hub 连接未收口 → hub.close() 进入真实 drain（5s 真实 timer）→ race 3s 再兜底 → afterAll 返回时 drain timer 残留，进程退出尾部最多延迟 drainMs（低概率、无断言失败，但设计对 r2-transport afterAll 逐字论证「零残留 timer」而对同型态的 sa7-r1 afterAll 只字未提——论证覆盖不对称）。 | §6.1 表补登第 4 处（sa7-r1 :312 afterAll），说明「peer.stop 先行 → 连接已收口 → 快速结算；race 3s 兜底覆盖 peer.stop 超时的残余情形（代价：进程退出尾部最多 +drainMs）」。SA3 无需代码改动，文档补登即可。 |
| 4 | MINOR | §4.7 — peer 侧副作用审计 | 「peer 侧既有处理：`onErrorFrame` → 终态 closed → 重连后 re-OPEN」在**生产 drain 时序下不可达**：hub 先发 GOAWAY（窗口开启）→ peer 收 GOAWAY → `enterBlocked()`；peer 的 `onMessage`（peer-connection.ts:255）对非 handshaking/ready 状态**丢弃一切后续入站帧**——在途 OPEN 的拒绝 ERROR 帧永远到不了 peer controller。结果等价（peer blocked 本身即终态，重连后 re-OPEN + reconcile 恢复），无行为缺陷；R3 的 ERROR 断言锚在 hub 出站帧面、用 injectPeer 绕过 peer 状态门，测试安全。但审计引用了一条不会执行的路径，属论证瑕疵。 | §4.7 副作用审计改述：「生产时序下 GOAWAY 先于拒绝帧到达 peer → blocked 门丢弃（结果等价：peer 已终态化）；R3 断言锚在 hub 出站帧面，不依赖 peer 处理」。 |
| 5 | MINOR | §4.3 — notifySettled 调用点含糊 | `finishOpenError`（hub-namespace.ts:364-375）的 setState 有守卫 `if (this.state === 'opening' \|\| !this.isTerminal())`——已终态时**跳过 setState**。设计说「`setState(targetState)` 之后调用」：若 SA3 把调用放进守卫内，跳过分支不通知（先前入口已通知 → 无害）；放守卫外无条件调（记忆位防重 → 无害）。两种实现都安全，但设计应给出确定指令，避免实现歧义与 SA4 比对噪音。 | §4.3 明确「`notifySettled()` 在每个入口的函数尾部无条件调用（`settledNotified` 记忆位保证每 channel 至多一次），不依附于 setState 分支」。 |
| 6 | MINOR | §4.1 — `shutdownWithGoaway` 重入防御 | 首行仅 `if (this.closedFlag) return;`，不检查 `drainActive`。若在 drain 窗口期内被再次调用（当前无现实路径——grep 全仓唯一调用点 hub-connection.ts:221 受 `HubReplicationImpl.closed` 门保护；apps/** 零引用），会**覆盖旧 `drainTail`/`drainDone`** → 旧 promise 永不 resolve（挂起的 `hub.close()` 泄漏）。防御成本一行。 | §4.1 首行改双门：`if (this.closedFlag \|\| this.drainActive) return;`。 |
| 7 | NOTE | D1 拒绝帧背压边界（已自申报，SA2 复核确认） | `sendControlChecked` 在 paused + 控制额度耗尽时**不抛异常**而是内部 `onBackpressureExhausted` → `connectionFatal('CONNECTION_BACKPRESSURE', 1011)` 杀连接（backpressure.ts:77-88）——D1 的 try/catch 只覆盖编码错。即极端背压下「拒绝不杀连接」不成立、窗口提前以 1011 终结。设计 D1 边界注记与决议档案登记一致，语义自洽（停机关键帧豁免仅 GOAWAY），测试无背压注入不受影响。**已接受边界，无需修订**；记录在案供 SA7 活链路观测。 | 无。 |
| 8 | NOTE | R2 的「peer 自然收口」现实语义 | peer `enterBlocked()` 后 sendControl 有非 ready 状态门（peer-connection.ts:489）+ controller.onConnectionFatal 本地静默——**生产中 peer 不会在窗口内主动发 CLOSE_NAMESPACE**。R2 的 injectPeer(CLOSE) 实测的是「GOAWAY 到达前已在途的 CLOSE」的 wire 层防御契约。hub 义务成立（任何合法入站帧须正确处理），非缺陷。 | 建议 §4.2-D6 加一句注记说明该帧的现实来源（in-flight CLOSE），避免后续维护者误以为 peer 会在 blocked 后发 CLOSE。 |
| 9 | NOTE | 生产 Host 停机时长上界（设计 §5/§12-1 已如实申报） | `hub.close()` Promise = max(drain 窗口, 已接纳 apply 槽排空尾长)——Runtime apply 槽无 deadline（ADR-0008 L93 授权「不取消、不设内部 timeout」），若 Runtime 槽挂死则 Host 停机无限等待。这是 ADR 决定而非本设计缺陷；ADR-0010 L179「不无限等待」仅罩网络 ACK 域。 | 无（范围外）。若未来需 Host 停机硬上界，走 ADR 演进。 |

---

## 协议假设依据审查

**章节存在性**：§10 存在，7 条假设（P1–P7），符合立法要求。

**依据可验证性抽验（SA2 逐条到源码）**：

| # | 设计声称 | SA2 验证结果 |
|---|---|---|
| P1 | peer 收 GOAWAY(SHUTTING_DOWN) → blocked、零出站、wire 保持 | ✅ `peer-connection.ts:398-416`（onGoaway → enterBlocked）；`enterBlocked()`（:655-676）clearDrainClose + teardown + outbound.clear + controller.onConnectionFatal；sendControl 非 ready 门（:489）；onMessage 非 handshaking/ready 早退（:255）。R1 的 blocked 断言当前已绿与 SA6 红灯结果一致。 |
| P2 | hub timer 仅 advanceBy 触发 | ✅ `testing.ts:74-109` 纯 map 队列 fake；**SA2 补验边界**：`timer.at <= deadline`（:96）——`advanceBy(5000)` **恰好触发** t0+5000 的 drainDeadline，R1/R3/R4 的断言锚成立。driver boot `timer: hubNode.scheduler`（driver.ts:476）；hub/peer 双 scheduler 独立，peer 侧 blocked 已清 drain timer，零跨钟交互。 |
| P3 | 控制帧同步上 wire、先于 close 事件 | ✅ `frame-io.ts:126-129` sendControl 入队即同步 `drain()` → `emitOne` → `if (!transport.closed) transport.send`；`makeEnd`（harness.ts:571-599）send/close 均 queueMicrotask FIFO。**SA2 补验 D4 独立锚**：真实 TCP 用例 it timeout 90s（sa7-r1:439）> 5s 窗口，`await hub.close()` 阻塞至窗口末在预算内，次序断言（goawayIndex < closeIndex）不变。**SA2 代补的依据缺口**（设计未列、验证为安全）：R1 迟到帧注入在 hub transport closed 后——`makeEnd.send` 检查的是**发送端**（peerEnd，未关）→ 正常投递 → hub 端监听器已在 cleanupAll 摘除（listeners 空）→ 零投递零异常，`rejections.events === []` 成立。 |
| P4 | CLOSE_OK.ackedSequence = CLOSE 帧序 | ✅ `hub-namespace.ts:548-552` 以 `message.sequence` 回执。 |
| P5/P6 | vitest 无 fake timers；AC-6 ≡ R1 输入等价 | ✅ 抽验 defaults：`DEFAULT_REPLICATION_TIMEOUTS.closeTimeoutMs = 5_000`（defaults.ts:38）≡ R1 显式值；`resolveTimeouts` 为 `{...DEFAULT, ...partial}` 逐字段合并（:56-61）→ 其余字段全缺省等价；CONTRACT_TIMEOUTS.closeTimeoutMs = 5_000（harness.ts:146）≡ 缺省。AC-6 在 `await closePromise` 前仅 1×settle()（auth-lifecycle:386）——冻结虚拟时间下修复后必挂，**矛盾真实存在**。P6 申请 SA6 实证的处理恰当。 |
| P7 | handshaking 分支保留 | ✅ 源码注释 + 简报明令。 |

**「应该/通常」类无据推断**：未发现。所有依据给出可定位行号。P5/P6 风险=中的自我标注诚实。

**D2（SYNC_STEP1 丢弃）的协议依据独立复核**：协议 §6.3「收到 GOAWAY 后停止 OPEN，不开始新 sync round」+ §13.2 逐码核对——`NAMESPACE_REOPEN_REQUIRES_RECONNECT`（Fatal-for-namespace=yes, Retryable=reconnect, Terminal=closed）采纳理由准确；`relatedSequence` 是 ERROR 帧既有 optional 字段（协议 §13.1 帧表 L327 + `namespaceErrorFrame(code, namespaceId, relatedSequence?)` 既有签名）——零新 wire 面声称属实。**SA2 独立验证 D2 红线论证**：round-engine.ts:99-105——hub 收 Step1 若非丢弃，新 round 分支会发 STEP1+STEP2（违反 R3「零 round 响应」）、重复 round 分支 `onViolation` → `sendNsError('SYNC_STATE_VIOLATION') + finalize('failed')` → channel 终态 → §4.3 通知 → 唯一 channel 时提前收口（违反 R3「窗口保持到 deadline」）——**两个分支都破坏 R3，丢弃是唯一满足契约的处置**。设计论证成立。

---

## 错误处理链路审查

（本任务为传输层 Bug 修复，无 UI/按钮面；按静默失败/状态闭环/降级路径/虚假降级四项审查）

- **静默失败**：✅ 无新增静默失败面。GOAWAY 发送失败 catch → `finishDrain()` 响亮收口（1001）——framing 不可信是外部故障域，真降级非静默。D1 拒绝帧 catch 忽略与既有 `withChannel` 同款防御（仅覆盖「连接已收口」）；额度耗尽路径不抛而是内部 fatal（见攻击点 #7，已自申报）。D2 丢弃是协议履约（§6.3 义务）且经四点论证 + SA2 独立复核两分支均违约，非静默吞。迟到帧（R1 deadline 后）经监听摘除零投递零异常——SA2 已代验 fake-duplex 行为。
- **状态闭环**：✅ `drainTail` resolve-only（构造器仅捕获 resolve）+ `cleanupAll` 尾部 **finally** 释放 `drainDone`——即使清理链异常，`hub.close()` Promise 也绝不悬挂（所有四条 drain 终结路径——deadline/提前完成/对端关/宿主 force-close——都经 cleanupAll）。R1 的 `rejections.events === []` 断言面闭合。
- **降级路径**：✅ deadline fire 不检查任何 channel/apply 状态（网络域硬顶，AC4）；apply 槽走既有 `drainPendingApplies`（allSettled，不取消无 deadline，ADR-0008 L93）。两等待域（§5）不混同、不互相豁免——SA2 复核与 ADR-0010 L179 / ADR-0008 L93 逐字对齐。
- **虚假降级识别**：✅ 无「if (!x) return fallback」形态。GOAWAY catch → finishDrain 是真降级（外部故障响亮收口）；`onChannelSettled` 非 drain 期 no-op 是事件面常驻 + 消费者按态过滤；D2 非 null-guard。设计 §13 自检与 SA2 独立判定一致。

---

## 红线测试思路（SA4/SA7 参考输入；对应攻击点逐条）

1. **（对应 #1）drain 期 fatal 后的 timer 计面回归**：boot（fake scheduler）→ hub.close()（窗口开启，`pending()` 基线含 drainDeadline +1）→ `injectPeer` 错序帧（`sequence: nextPeerSeq()+2`，复用 review-revisions R3-3 的触发面）→ SEQUENCE_VIOLATION fatal → `settle()` → 断言 `run.hubNode.scheduler.pending()` 回落到 fatal 前的 drain timer 计面（即 drainDeadline 已清，**当前设计实现下此断言红**）；并断言 `closePromise` 正常结算（drainDone 经 cleanupAll finally 释放——两条 fatal 路径都调 cleanupAll，结算面应恒绿）。
2. **（对应 #1 同型）CONNECTION_BACKPRESSURE fatal 的 drain 计面**：boot + 极限 `controlReserveBytes` + 高水位注入 → 窗口内 OPEN 拒绝帧触发额度耗尽 → 1011 收口后 `pending()` 无 drain 残留。（可选——依赖背压注入 seam 的可用性。）
3. **（对应 #6）shutdownWithGoaway 重入不泄漏旧 drainTail**：hub.close() 后窗口内再次对同一连接调 `shutdownWithGoaway`（需经公共 `HubConnection` 面——若该面未暴露给测试可降级为类型层验证）→ 断言首个 `hub.close()` Promise 仍随 deadline/提前完成正常结算（当前防御缺失下第二次调用覆盖 drainDone，首 Promise 悬挂 → 红）。
4. **（既有红灯回归守卫）R1–R4 全绿 + 175 基线全绿**：`npx vitest run packages/ws-replication`——特别守卫 D4（真实 TCP，GOAWAY 先于 close 事件、间隔从 0 变 5s）、AC-6 适配后全断言原值、r2-transport/sa7-r1 afterAll 无新增挂起（vitest 退出时长无 +5s 尾巴——攻击点 #3 的活链路观测点，归 SA7）。
5. **（对应 #5，可选）notifySettled 幂等观测**：opening 期先经 fatal 终态化 channel，再触发 authorize 迟归失败（finishOpenError 路径）→ 断言 hub 出站 `ERROR` 帧恰 1 条（无二次通知引发的重复收口帧）、`close(1001)` 恰一次。

---

## 验证证据（SA2 评审期间执行）

- `grep -rn "hub\.close()" packages/ws-replication/test/` → **4 处**消费点（sa7-r1:312/r2:363/auth-lifecycle:385/sa7-r1:503）——证攻击点 #3。
- `sed -n '555,616p' hub-connection.ts` → `connectionFatal`/`onSequenceExhausted` 直接置 closedFlag + cleanupAll，**不经 close()/finishDrain**——证攻击点 #1。
- `grep -n "setState" hub-namespace.ts` + 逐行读 → 终态 setState 共 **4 处**（:372/:553/:826/:598）——证攻击点 #2。
- `sed -n '74,109p' namespace-registry/src/testing.ts` → `timer.at <= deadline` 边界 fire——证 P2 与 R1/R3/R4 的 advanceBy 锚。
- `sed -n '77,88p' backpressure.ts` → sendControl 额度耗尽走 onBackpressureExhausted 不抛——证攻击点 #7。
- `sed -n '255p;489p' peer-connection.ts` → blocked 后入站丢弃/出站门——证攻击点 #4、#8。
- `sed -n '99,105p' round-engine.ts` → Step1 两分支（新 round 响应/重复违例 finalize）均破坏 R3——证 D2 论证。
- defaults.ts:38 + resolveTimeouts(:56-61) + harness CONTRACT_TIMEOUTS(:141-146) → AC-6 ≡ R1 输入等价——证 P6 第 1 步。
- 协议 §6.3（L149）/§13.1 帧表（L327 relatedSequence）/§13.2 registry/§15.2（L447）/§21（L565-574）逐节对读——证 §4.7/§4.2/两等待域对齐。

## 结论

架构主轴（解耦、结算闸、deadline 硬顶、两等待域、前置门、提前完成观测、AC-6 冲突上报与最小适配方案）**全部通过独立攻击验证**；ADR 约束（L143/L147/L90/L165/L179、#161 L303、ADR-0008 L93、ADR-0009 L99）逐条对齐无违犯。**reject 仅针对三处 MAJOR**：#1（drain 句柄清理矩阵漏 fatal/exhausted 两路径——实现指令级缺陷，SA3 照现设计实现会留下 timer 残留）必须修订；#2（终态入口枚举与源码不符）、#3（hub.close() 消费点「全量 3 处」漏第 4 处——SA4 比对基准的完整性）必须更正。三个 MINOR + 三个 NOTE 随修订一并处理或记录。修订完成后 SA2 复审预计快速通过（改动均局部、不触及任何主决策）。

---

# SA2 R2 复审（2026-08-30）

**R2 Verdict**: **pass** —— R1 评审全部 9 项（3 MAJOR + 3 MINOR + 3 NOTE）逐条验证充分落实，零主决策变更（逐节对照 R1 属实），修订未引入新攻击点。同意放行 SA3 实现。

被审对象：`wiki/raw/task_issue-174-goaway-drain_design.md`（R2 修订版，2026-08-30 就地修订）。

## R1 攻击点逐条核销

| R1 # | 严重度 | 修订位置（R2） | 核销验证 |
|---|---|---|---|
| 1 | MAJOR | §4.6 重写「drain 互锁四路径」+ `clearDrainHandles()` 单点伪代码 + 四路径指令表；§4.4 finishDrain 改调单点；§6.3「双点清」→「四路径」；§8 骨架；§7.1 守卫锚定表；§11 改动面 +2 行、风险评估新增「drain 句柄残留代价」 | ✅ **充分**。四路径（close / onTransportClosed / connectionFatal / onSequenceExhausted）全覆盖且调用点位置明确可实现（幂等 helper；路径 3/4 指定于 `sender.teardown()` 前——同步段内位置无行为差，指令无歧义）；并正确补充「路径 3/4 的 drainDone 结算不依赖句柄清理（都经 cleanupAll finally）」——与 SA2 R1 的结算面分析一致，纪律修正与结算链解耦。deadline-fire 回调先置 `drainDeadline = undefined` 再 finishDrain → 单点内跳过 clearTimeout（已 fire 句柄）——幂等成立。 |
| 2 | MAJOR | §4.3 终态 `setState` 点全量枚举更正为 **4 处**（含 `finishOpenError` 守卫注记）；第 4 处（onConnectionClosed :598）免通知理由改为**调用图推导**；删除「终态只能从这里进入」表述；新增防御纵深声明（maybeFinishDrainEarly 的 closedFlag 检查非冗余、不得删） | ✅ **充分**。4 处枚举与 SA2 R1 grep 结果（:372/:553/:826/:598）一致；免通知理由与 SA2 R1 分析逐字同构；**防御纵深声明超出 R1 要求**（明确禁止未来维护者以「第四处免通知」为由删除 closedFlag 闸——正确封堵了 SA2 R1 指出的重构风险）。grep 复核：全文无「且仅这三个」「终态只能从这里进入」活体残留（仅存于更正说明的引用语境）。 |
| 3 | MAJOR | §6.1 标题与 grep 证据更正为 4 处 + sa7-r1 afterAll（:307-313）补登行（peer.stop 先行 → 快速结算 + 残余边界申报：peer.stop 超 3s → drain timer 残留 → 退出尾部 +drainMs，活链路观测归 SA7）；§11 caller 表新增消费方② + grep 更新 + 风险评估「3 个」→「4 个」 | ✅ **充分**。4 处 grep 结果与 SA2 R1 独立 grep 完全一致（sa7-r1:312 / r2:363 / auth-lifecycle:385+393 / sa7-r1:503）；残余边界申报诚实（含 R1 指出的「论证覆盖不对称」自认）；SA4 比对基准已修复。 |
| 4 | MINOR | §4.7 副作用审计改述两面（① R3 测试面：injectPeer 绕过 peer 状态机、锚在 hub 出站帧面；② 生产等价性：:255 非 ready 门丢弃、结果等价）；采纳行同步改 | ✅ **充分**。删除不可达路径引用；补充论证「拒绝帧价值保留于 GOAWAY 丢失/乱序异常时序（peer 未 blocked 时可正确消费）」——**比 R1 要求更完整**：该场景下（GOAWAY 帧丢失、peer 未知停机继续 OPEN）拒绝帧是 peer 获知「须重连」的信号之一，价值论证成立。 |
| 5 | MINOR | §4.3「调用指令（R2-M5）」段：钉死「每个入口的函数尾部无条件调用，不依附 setState 分支」+ finishOpenError 守卫跳过分支同样走到尾部（记忆位吸收）+ §8 注释 | ✅ **充分**。实现歧义消除；「两种放置方式经记忆位等价、钉死尾部无条件以消除 SA4 比对噪音」的处置正确。 |
| 6 | MINOR | §4.1 首行双门 `if (this.closedFlag \|\| this.drainActive) return;` + 覆盖危害注释 + 无现实重入路径声明；§8/§7.1 守卫 #3 | ✅ **充分**。一行防御；危害注释准确（旧 drainTail 永不 resolve = hub.close() 挂起泄漏）。 |
| 7 | NOTE | 记录在案 + §4.6 路径 3 触发场景表把 CONNECTION_BACKPRESSURE 列入 fatal 面 | ✅ **增值**：背压 1011 fatal 现在也经 `clearDrainHandles()` 清句柄——R1 的 NOTE 边界被四路径修正自然覆盖。 |
| 8 | NOTE | §4.2-D6「现实来源注记」 | ✅ **充分**（blocked peer 不发 CLOSE + in-flight 来源 + wire 防御契约定位 + 维护者警示）。 |
| 9 | NOTE | 记录在案（§5/§12-1 保持） | ✅。 |

## R2 新增内容独立审查（修订是否引入新问题）

- **`clearDrainHandles()` 单点**：幂等（`drainActive=false` 无条件 + 条件清句柄）；非 drain 期调用零副作用；finishDrain → close() 链上的重复调用无害。✅
- **四路径指令表**：每条路径的调用位置（close 同步段首部 / onTransportClosed 既有体前 / connectionFatal、onSequenceExhausted 的 `sender.teardown()` 前）均在同步段内、语义等价可实现。`onSequenceExhausted` 的 `if (transport.closed) return;` 首行早退场景由路径 2（onTransportClosed 已先行清句柄）覆盖——闭环。✅
- **§7.1 守卫锚定表**：SA2 R1 五条红灯思路逐条锚到设计条款与红/绿预期，红/绿判定准确（#1「R1 设计实现下计面断言红 → 修后绿；结算面恒绿」、#3「无防御下首 Promise 悬挂 → 红；双门下绿」）。✅
- **§6.2.1 import 行号引用**：SA2 实测 `auth-lifecycle-red.test.ts` 第 52 行 = `CONTRACT_TIMEOUTS`、第 60 行 = `settle`（均在既有 import 块内）——引用精确，2 行插入零新增 import。✅
- **「零主决策变更」声称**：逐节对照 R1——§1/§3/§4.2 处置矩阵/§4.5/§4.7 采纳行/§5/§10/§12/§13 主决策文本未动，仅增补。✅

## AC-6 时序适配协议（§6.2.1）充分性确认 —— **adequate**

总控指令要求显式确认。六维度评估：

| 维度 | SA2 评估 |
|---|---|
| **技术方案** | ✅ R1 已独立验证：`advanceBy(5000)` 边界语义 `at <= deadline`（testing.ts:96）恰好触发 drainDeadline；advanceBy 内置 3 次微任务展开 + 跟随 `await settle()`（300 泵）覆盖 cleanupAll 异步链深度；适配后 AC-6 全部既有断言原值成立（GOAWAY 断言在插入点前；`hub.closed` 在 close() 同步段置位；`connections.length===0` 由 dropConnection 在推进后微任务内达成）。R2 将「1 行」统一为「2 行插入」与代码块一致——文字一致性修正。 |
| **所有权** | ✅ SA6 独占 + 2026-06-13 立法依据 + `SA3 的实现 PR 不得包含此文件`——与简报「SA6 红灯契约」及 ALLOW LIST `[SA6 owned]` 登记自洽，防 Scope Creep Guard 比对错位。 |
| **时序** | ✅ 「与 SA3 实现同一任务轮次、先于 SA4 全量验证门禁」——正确封堵「假回归（AC-6 在 vitest 默认 testTimeout 下挂起）污染 175 基线绿判定」的风险窗口；并给出建议派发序（同轮先行/并行先行合入）。 |
| **裁决链** | ✅ 总控终裁 + SA6 资源不可用时的代执行路径（总控裁定，不得 SA3 越权）——与相关决议档案「SA2/SA3 不得绕过该裁决自行改测试断言逻辑」一致。 |
| **方向锁死** | ✅ 反向适配（改实现迁就 AC-6）被明确禁止并给出三重冲突理由（SA5 Fix direction / SA6 R1 RED@2 显式断言 / AC4 宿主停机门闩语义）。 |
| **回归守卫** | ✅ 明确引用 SA2 红线思路 #4（AC-6 全断言原值 + afterAll 无 +5s 退出尾巴归 SA7）。 |

**结论**：该所有权协议覆盖了 SA2 能构想的全部分歧面（谁改/何时改/谁裁决/能否反向/如何守卫），且每条都有可执行的锚点（文件、行号、时序、立法依据）。**adequate，无补充要求。** 唯一提醒（非缺陷）：§6.2.1「何时改」的落地依赖总控派发纪律——SA7 活链路验证时应确认 SA3 合入的 PR diff 中**不含** `ws-replication-auth-lifecycle-red.test.ts`（所有权协议的可观测验证点）。

## R2 最终结论

**pass**。R1 全部攻击点核销，零新攻击点，AC-6 适配协议 adequate。设计可交付 SA3 实现；SA4 静态门禁比对基准（§11 四路径/四消费点）已修复完整；SA7 活链路验证点：① drain 期 fatal 后 `scheduler.pending()` 计面回归（红线思路 #1）② afterAll 无 +5s 退出尾巴（红线思路 #4）③ SA3 PR 不含 SA6 owned 测试文件。

**R2 验证证据**：`sed -n '45,62p' ws-replication-auth-lifecycle-red.test.ts` → 第 52 行 `CONTRACT_TIMEOUTS`、第 60 行 `settle`（§6.2.1 引用精确）；`grep -n "双点清\|全量 3 处\|且仅这三个\|终态只能从" design.md` → 命中全部位于修订记录/更正说明/回应表的引用语境，无活体残留；R2 全文（576 行）逐节与 R1 对照——主决策章节（§1/§3/§4.2 矩阵/§4.5/§4.7 采纳行/§5/§10/§12/§13）文本未动。

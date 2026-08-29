# AC 逐条核对表 — PR #165 review 八项修订（issue #161 round 2）

**核对时间**：2026-08-30 | **核对者**：SA8 acceptance auditor（证据全部来自 SA 产出 + 本轮独立复跑实测，非口头声明）
**实现基线**：`4bc57dd`（R1–R8 主体）+ `218ca3a`（SA7 D1–D5 冻结锚）+ `06db53c`（F1 §D9 wipe-credit）——worktree HEAD = `06db53c`
**上游链**：SA5 分析 → SA6 红灯契约（15 例）→ SA1 设计 R1→R2→R3（SA2 窄域 reject→reject→**pass**）→ SA3 实现 → SA4 **pass** → SA7 **fail-needs-fix（F1）** → SA1 §D9 → SA2 R4 **pass** → SA3 F1 → SA4 F1 **pass** → SA7 F1 复测 **pass**

---

## Verdict: **PASS**（8/8 修订 + F1 闭合 + 全部静态/动态门禁独立复核绿；D5 开票 #168；两项非阻断遗留移交总控）

---

## 一、八项 review 修订逐条核对（R1–R8）

| # | 修订要求（PR #165 review） | 红灯契约 | 实现证据 | SA4/SA7 | 状态 |
|---|---|---|---|---|---|
| **R1** | cap/low-water 严格接纳：shed 后接纳 incoming 仍越限则**绝不接纳**（字节级断言） | R1-1 / R1-2 / R1-3（review-red L362/L384/L401） | `frame-io.ts enqueueData` L174-195：触发面 → shed 循环 → **再判定** `pipelineBytes()+bytes > max` → 拒纳分支「清同 ns 幸存桶（逐帧回减 queuedDataBytes）→ 无条件 `onDataShed(ns)`（空桶也显影）→ ensureCheckpoint → return false」；单帧超限与 buffered 主导同一路径无特例；重入安全（先清桶后显影）。R1-3（B1 契约，8192B 字面 payload）：拒纳 × 幸存面同批全弃 + pendingData 归零 + A7 窗口不变量 | SA4 ✅（§2 R1，含攻击点①重入/②幸存面负记账结构性不可达推演）；SA7 D2 动态证实攻击点②不可达 + 记账闭环（F1 后） | ✅ |
| **R2** | 真实有界控制帧保留额度：独立记账，耗尽 → `CONNECTION_BACKPRESSURE` | R2-A2a（review-red L494） | `maxQueuedControlBytes` 必填字段（types.ts L31-35）+ 缺省 8 MiB（defaults.ts）+ `positiveSafeInteger` + 构造期校验 `≥ maxBootstrapBytes + 128`（validate.ts）；尾窗 ledger（`emitOne(message, plane)` + `endOffset` 累计 + 检查点 `flushed = totalEmittedBytes − buffered`，`>0` 才裁剪）+ 规则 C 析取（控制额度 ∨ 总量+无可 shed 面）+ `sendControl` 补 `ensureCheckpoint`；N6（三字段仅 `clear()` 重置）/N7（`onSequenceExhausted` 终态旁路不入 ledger） | SA4 ✅（§2 R2 全要素）；SA7 D4 动态绿（冲刷回落裁剪不误杀 + 全量冲刷归零 + 真实越限仍 `exhausted===1`） | ✅ |
| **R3** | GOAWAY/blocked **同步**静默每个 namespace channel 与订阅（hub + peer 双侧），先于重连/清理 | R3-1 / R3-2 / R3-3 / R3-4 / R3-5（review-red L535/L546/L569/L588/L608） | hub `onConnectionClosed`：同步段 `openWaiters=[]` + `quiesceSync()`（摘订阅置 undefined + 非 terminal 投影 `closed`），异步尾巴（drain → release → setState 兜底）不变；peer `onConnectionFatal`/`onConnectionLost` closing/failed/活跃三分支各自**内联** quiesceSync 于迁移之前（N3）；B-2d 守卫保持（`closeSessionAndRelease` 入口捕获 `this.unsubscribe`——迟到尾巴结构性跳过，不误摘新代句柄） | SA4 ✅（§2 R3）；SA7 D1 动态绿（closing/failed 分支断线承诺兑现 + re-add 跨代零误摘 + 写送达） | ✅ |
| **R4** | pong 超时**关闭并代际安全脱离**当前 transport，然后才重连 | R4-1 / R4-2（review-red L796/L814） | `onPongTimeoutDetached()` ①–⑦：stopLivenessNow → clearGoawayDrain → 退订 → `close(1001,'pong-timeout')` → epoch+1 → onTemporaryFailure（投影 backoff）→ 投影后 `outbound.dispose()`（零出站噪声）；重入门 `stopping`/`connState!=='ready'`；公共 `onTemporaryFailure` 其余三入口（dial 抛错/hello 超时/onClose）零改动（diff 实证） | SA4 ✅（§2 R4 ①–⑦ 逐项对位）；SA7 D3 动态绿（drain 窗口 × pong 互斥 + 迟到 deadline 幂等 + 重连收敛） | ✅ |
| **R5** | round-robin 扫描**有界的一整轮**，不因队首 ns 阻塞即返回 | D3 改写锚（sa7-hardening-dynamic L511）+ 有界伴生锚（L547） | `drain()` 数据循环 `consecutiveSkipped` 计数 + 顶界 `>= dataOrder.length`（当前值，收缩只收紧）；终止性证明（每迭代或推进游标/或收缩 dataOrder/或消耗排队帧——皆单调）；`canDispatchData` 缺席或恒真时逐行为等价（AC5-RR 公平性保持） | SA4 ✅（§2 R5 终止性证明 + N4 假设钉死复核）；SA7 动态绿（就绪 ns 同轮派发、全阻塞单轮即停零死循环） | ✅ |
| **R6** | UpdateChannel 溢出判定计入「已 handoff 未派发」的 count 与 bytes | R6-1 / R6-2（review-red L863/L884） | `update-channel.ts`：`pendingDataBytes` 新字段 + `overflows()` count 口径纳入 `pendingDataCount`、bytes 口径纳入 `pendingDataBytes` + 四出口（handoff `+` / onDataDispatched `−` / onDataShed 清零 / teardown 清零）对称；与 R1 闭环（拒纳 → 清桶 → 无条件 onDataShed → 双字段清零） | SA4 ✅（§2 R6 四出口对称）；SA7 D2 动态绿（F1 后 pendingData 恒 ≥ 0） | ✅ |
| **R7** | 重建调度不硬编码 `queueMicrotask`；driver 去 512 跳魔法 | R7-1（review-red L918） | `requestRebuild` L638 → `this.deferTask(...)`（生产缺省 `defaultDefer` = 单微任务，行为等价）；driver `DeferPump`（入队零隐式执行 / flush FIFO ≤1000 轮 / `settleUntil` 谓词先行冲刷、`settle()` 永不冲刷）；`DEFER_MICROTASK_HOPS`/`TEST_DEFER` 整块删除；B4 两处注释同步（review-red 头 L13-14 + spec-b1-b2 L90） | SA4 ✅（§2 R7 四条 grep 锚实测）；SA8 本轮独立复跑锚 1→**0**、锚 3→**恰 1**（peer-connection.ts:36）、锚 4→**0** | ✅ |
| **R8** | 公共权威文档补齐四缺口 + 清理阶段回合叙事 | 无文本断言（SA6 §5 纪律：R8 = 评审核对 + 行为锚保持绿）；A8a–A8e 证据见下节 | protocol/ADR/phase 三处 + types.ts/defaults.ts 注释对齐（N5）；ADR 0010 append-only +13 行（diff 实测 `13 +++++++++++++`，零删改） | SA4 ✅（§2 R8 逐字对位）；SA8 本轮独立复核全部在位（下节 file:line） | ✅ |

## 二、R8 documentary 证据（A8a–A8e，SA8 独立复核 file:line）

| 项 | 要求 | 证据位置（本轮实测） | 复核结果 |
|---|---|---|---|
| A8a | 公共身份投影只取受信 Upgrade 身份；缺身份 accept = 响亮 TypeError | `docs/protocols/instance-replication-v1.md` **L40**：「Hub 的公共身份投影（`HubConnection.peerInstanceId`）只消费 Upgrade 认证产生的受信身份，绝不采信 HELLO 自述身份；宿主 `accept` 未提供受信身份即接线缺陷——实现必须响亮拒绝（同步 TypeError）」；§2 L38 + §6.1 L122（peerInstanceId 必须等于 Upgrade 身份）既有 | ✅ |
| A8b | transport facet 契约（三可选面 + 缺面语义 + 生产必暴露 + 装配期断言） | protocol **§17 L496**：「传输 Adapter 暴露三个可选能力面：`bufferedAmount`（缺面视为 0）…`ping`/`onPong`（缺面 = dormant 降级）。生产 Adapter 必须暴露三面；组合根在装配期对缺面做响亮断言（见 issue #164）」 | ✅（与 #164 单一权威源衔接） |
| A8c | liveness 缺省 30s/10s + `pongTimeout < pingInterval` 约束 | protocol **§18 L524**：「工程缺省：`pingIntervalMs = 30_000`、`pongTimeoutMs = 10_000`；约束 `pongTimeoutMs < pingIntervalMs` 在配置解析期响亮验证（TypeError）…pong 超时按临时失败处理：关闭传输（close code 1001）并经 backoff 重连」 | ✅ |
| A8d | 背压边界终态口径回写 §17 | protocol **§17 L492**：段首句「Connection使用 per-namespace队列和 round-robin：control/error/ACK高优先级，data每轮每 namespace最多一个。」**逐字节保留**（B3 修正，本轮 grep 在位）+ 追加：pipeline = queued+buffered、shed 仅 queued 侧、**严格接纳**（拒纳 + 同批丢弃幸存帧 + needs-resync 显影）、`maxQueuedControlBytes` 独立额度（缺省 8 MiB、≥ maxBootstrapBytes+开销、耗尽 1011）、checkpoint = `max(1, floor(ackTimeoutMs/100))`、有界整轮扫描；校验清单 +2 行（maxQueuedControlBytes / maxQueuedBytesPerConnection ≥ highWater） | ✅ |
| A8e | phase-5 清理流水线回合叙事 | `docs/phases/phase-5-websocket-replication.md` 三处终态化（diff 实测 L75/L81/L83）：「issue #134 已接受；零改形」→「冻结词汇」；「SA8 放行条件 C-1，issue #134 round 2 改写——撤销 round-1…」→「needs-resync 通知归属」；「issue #134 round 2 冻结词汇」→「切片 3/4 冻结词汇（补充）」；叙事 grep 锚（红灯/SA6 契约/SA8 放行/撤销 round；round-1/round 1）docs/phases + docs/protocols **均 0 命中**（本轮复跑） | ✅ |
| （附） | ADR 0010 指针型登记（append-only） | `docs/adr/0010-*` 文末「### issue #161 round 2 修订（PR #165 review 八项——2026-08-30）」+13 行，声明 protocol 为唯一权威；既有修订节零改动（`git diff 0a18661..4bc57dd -- docs/adr/0010-*` = `13 +++++++++++++`） | ✅ |

## 三、15 例红灯契约全转绿（基线 0a18661 实测 15 failed / 110 passed → 本轮 131/131）

| # | 契约 | 位置 | 基线红灯签名（SA6 §1 实测） | 本轮 |
|---|---|---|---|---|
| 1 | R1-1 buffered 主导耗尽断点接纳必须拒纳（第 9 笔零派发 + RESYNC） | review-red L362 | 期望 8 帧，实际 9（断点接纳帧被派发） | ✅ 绿 |
| 2 | R1-2 超预算单帧拒纳（wire 零该帧 + RESYNC） | review-red L384 | 期望 0，实际 1；RESYNC 期望 ≥1 实际 0 | ✅ 绿 |
| 3 | R1-3 拒纳 × 幸存面：同批丢弃 + 无条件显影 + pendingData 归零 + A7（8192B 字面 payload） | review-red L401 | RESYNC 0；幸存帧被派发；pendingData=−1 | ✅ 绿 |
| 4 | R2-A2a 有排队数据时控制风暴越过保留额度 → 单检查点 onControlExhausted | review-red L494 | exhausted 期望 1 实际 0 | ✅ 绿 |
| 5 | R3-1 hub close() 同步栈内 channel 离开 live | review-red L535 | 实际 `live` | ✅ 绿 |
| 6 | R3-2 hub close() 同步栈内订阅已摘除（收口后零投递/零幻影 in-flight） | review-red L546 | 实际仍 function | ✅ 绿 |
| 7 | R3-3 SEQUENCE_VIOLATION fatal 收口同步栈内已静默 | review-red L569 | 实际 `live` | ✅ 绿 |
| 8 | R3-4 GOAWAY(SHUTTING_DOWN) blocked 同步段订阅已摘除 | review-red L588 | 实际仍注册 | ✅ 绿 |
| 9 | R3-5 GOAWAY(SERVER_RESTARTING) deadline 栈内先静默后 close | review-red L608 | 实际仍 function | ✅ 绿 |
| 10 | R4-1 pong 超时同栈关闭传输 + hub 清理死连接 | review-red L796 | peerSideClosed false；hub connections=1 | ✅ 绿 |
| 11 | R4-2 重拨 hub 只见新连接；迟到帧零影响；跨代收敛 | review-red L814 | hub connections=2 | ✅ 绿 |
| 12 | R6-1 pending handoff 计入 count 口径（第 9 笔而非第 14 笔溢出） | review-red L863 | RESYNC 期望 ≥1 实际 0 | ✅ 绿 |
| 13 | R6-2 pending handoff 计入 bytes 口径 | review-red L884 | 同上 | ✅ 绿 |
| 14 | R7-1 重建经 deferTask seam（latch 挂起零拨号，放行恰 +1） | review-red L918 | dialCount 期望 1 实际 2 | ✅ 绿 |
| 15 | R5 D3 改写：占位 ns 之间就绪帧**同轮**派发（无须检查点兜底） | sa7-hardening-dynamic L511 | emissions 期望 2 实际 1 | ✅ 绿 |

（SA8 本轮独立复跑：`ws-replication-review-revisions-r1-r7-red.test.ts` 14 tests ✓、`ws-replication-sa7-hardening-dynamic.test.ts` 8 tests ✓——含 15 号锚与「全阻塞有界」伴生锚；`ws-replication-sa6-hardening-g3-g4-red.test.ts` 16 ✓ 含 A2 滞回（≤2 维持，SA6 §4 仲裁）与 A2-1011 校准锚。）

## 四、D1–D5 动态锚（SA7 commit `218ca3a` 冻结；F1 后零改动 6/6 绿）

| # | 动态重点 | 锚（ws-replication-sa7-round2-dynamic.test.ts） | 结果 |
|---|---|---|---|
| D1 | peer `onConnectionLost` closing/failed 分支 `cleanupResources` 排程 + 跨代安全（SA4 §7-D1 / R2-N2 交接） | D1a/D1b（L96/L147）：closing 期断线承诺即兑现（不等 60s closeTimeout）+ re-add 跨代零误摘 + 写送达 n=101；failed → disconnected → 重连再入 failed（dialCount 恰 2 无卡死） | ✅ 绿 |
| D2 | hub 真实过载（live、首次 declareHubResync）shed 循环：RESYNC 发射窗口零幸存派发 + pendingData 恒 ≥ 0（SA4 攻击点②动态确认） | L378：**曾红（F1）**——滞回接纳帧恢复派发后 `pendingDataCount === -1`；**06db53c 后转绿**：wipe-credit 信用消费，终值 0 非 −1；逐子锚原语义保持（首帧 pending 0 / 触发面前置 6 / RESYNC 首次显影 / UPDATE 恒 1 / shed 后 0 / A7 ≤16 / 收敛 n=5） | ✅ 绿（F1 闭合） |
| D3 | GOAWAY drain 窗口 × pong 超时互斥（R4 N1）+ 重连 reconcile | L630：drain 窗口内 pong 超时 → 同栈 backoff + close(1001,'pong-timeout') + hub 收口 connections=0；越过 deadline 再推 5000ms wire2 保持开启（迟到 deadline 幂等）；断线窗口写经重连收敛；stop 零 timer 残留 | ✅ 绿 |
| D4 | R2 尾窗 ledger 冲刷回落：裁剪正确、归零不误杀、真实越限仍触发 | L701：6×8KiB 风暴尾窗 ≈49KiB → FIFO 冲刷 ≈40KiB → 检查点 exhausted===0（防高估误杀）；全量冲刷 outstanding 归零；无冲刷再投 5×8KiB → exhausted===1 | ✅ 绿 |
| D5 | hello 超时 peer 侧孤儿传输竞速窗口（设计 §D4 N2 登记项——观察，非缺陷断言） | L774 区：peer hello 超时 → backoff 且 `wire1.peerSideClosed===false`（孤儿传输在场——现状证实）；重拨 wire2 ready→live；hub 缺省 10s HELLO_TIMEOUT fatal(1002) 兜底关闭 hub 半边并 drop 连接 | ✅ 绿（观察完成；处置见第六节） |

## 五、F1 §D9 闭合（负记账修复链）

| 环节 | 证据 |
|---|---|
| 缺陷 | SA7 D2 破坏性锚（冻结于 `218ca3a` L377-431）：shed 循环 `onDataShed` 清零把已 handoff 计数的 incoming 一并抹除，滞回接纳帧恢复派发时 `onDataDispatched` 再减一 → `pendingDataCount = -1`（R6 溢出/A7 窗口各低估 1 帧；无数据丢失） |
| 设计 | SA1 §D9 wipe-credit：handoff **increment-before** → 布尔判定回传链（enqueueData → boolean，5 src 文件）→ `accepted ∧ needsResync 翻转` 信用登记（不重计 pending）→ `onDataDispatched` 信用消费先于减记 → `onDataShed`/`teardown` credit 双清零 → 三门（deliver/flushQueued/overflows）精确负载 pending+uncounted 双口径；S1–S10 枚举；SA2 R4 **pass**（含 R4-N1 排除引理/R4-N2 双清零不可省/R4-N3 口径 131） |
| 实现 | SA3 commit `06db53c`：恰 5 src + 2 wiki；`git diff 218ca3a..06db53c -- packages/ws-replication/test/` = **0 行**（冻结锚字节不变）；hub-connection.ts（DENY）= **0 行**（L181 表达式体布尔自动回流）——SA8 本轮复跑同判 |
| 静态 | SA4 F1 复审 **pass**：与 §D9 (2) 伪码逐行等价；判定链全表达式体封闭于非公共导出；R4-N1 引理独立重推成立；双侧对称；冻结锚字节不变 |
| 动态 | SA7 F1 复测 **pass**：冻结锚零改动 6/6 绿；D2 转绿且逐子锚原语义保持；D1/D3/D4/D5 零回归；包级 **131/131**、整仓 **2002/2002** |
| 源码复核 | SA8 本轮抽查 `update-channel.ts`：`uncountedAccepted/uncountedAcceptedBytes` 子账本（L49-50）、窗口门三和式（L74）、信用消费先于减记（L136-138）、onDataShed credit 双清（L153-154）、overflows 双口径（L166-168）、increment-before（L180+）全部在位 |

## 六、D5 裁决（hello 超时孤儿传输——总控移交项）

**Decision: 开跟踪票，不在本轮修复，不放弃跟踪 → issue #168**
**Ticket**: https://github.com/welltop-jim-wang/nomicore/issues/168（OPEN，2026-08-30 经 `gh issue create` 创建；**未加/未改任何 label**；issue #161、PR #165、分支、push 零触碰）

**裁决依据**（scope / severity / design N2 三轴）：

1. **Scope（不在八项修订冻结面内）**：PR #165 review 修订 R4 只绑定 pong 超时路径（「pong 超时必须关闭并代际安全地脱离当前 transport」）。SA1 §D4 裁决表将 hello 超时明示「本轮范围外（hub 侧自有 HELLO_TIMEOUT fatal 关闭其半边；双侧同值竞速——登记为观察项）」；SA5/SA6 未列为修订项、无红灯锚。本轮修复 = 对冻结 §C ALLOW 面与冻结锚集的 scope creep。
2. **Severity（低、有界）**：SA7 D5 动态证实——hub 侧缺省 10s `HELLO_TIMEOUT` fatal(1002) 兜底关闭 hub 半边并 drop 连接（hub 最终只剩新连接）；peer 恢复不受影响（重拨 wire2 → ready → live）；无数据丢失（reconcile 承接）；暴露窗 ≤ ~hub HELLO_TIMEOUT + 每次失败拨号一个孤儿 socket，无无界增长。不构成正确性缺陷，不阻断验收。
3. **Design N2（既有处置建议）**：SA1 §D4 N2 明文「建议随本轮 REPORT.md 开跟踪票（总控决定是否立项）」；SA3 报告 §5.7 与 SA7 报告 §5 均同向移交。完全 waive 将推翻三份 SA 产物的处置建议，留下一个已动态复现的残留竞速窗口无跟踪——故取「开票 + 出本轮范围」。
4. **先例**：round 1 对范围外交接项已开 #163（observability）/ #164（组合根）——同型处置。
5. **修复方向（票面已记）**：复用 R4 `onPongTimeoutDetached` ①–⑦ 脱离序（或抽公共 guarded detach helper）作用于 hello 超时入口，保持 dial 抛错/onClose 两入口行为冻结；`dialNow` 既有卫生序使迟到步骤幂等 no-op。

**对验收的影响**：无——D5 属登记观察项（锚绿），验收面为八项修订 + F1；#168 仅登记残留工程项。

## 七、全量门禁（SA8 独立复跑，2026-08-30，HEAD `06db53c`）

| 门禁 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 包级全量 | `npx vitest run packages/ws-replication` | **Test Files 17 passed (17); Tests 131 passed (131); Type Errors no errors**（= SA3/SA7 口径 R4-N3：125 + SA7 六锚） | `/tmp/sa8-pkg.log` |
| 整仓全量 | `pnpm test` | **Test Files 170 passed (170); Tests 2002 passed (2002); Type Errors no errors**（既有 1996 + SA7 六锚，全绿） | `/tmp/sa8-repo.log` |
| 类型 | `npx tsc --noEmit -p tsconfig.typecheck.json` | exit 0 | — |
| diff 卫生 | `git diff --check 0a18661..06db53c`；`git diff --check`（工作树） | 均零输出（干净） | — |
| 零 skip/伪红 | `grep -rn "\.skip\|\.todo\|\.only" packages/ws-replication/test/*.test.ts` | 0 命中 | — |
| 零 real sleep | `grep -n "setTimeout" packages/ws-replication/test/*.test.ts \| grep -v clearTimeout` | 0 命中（全 fake scheduler + 微任务推进） | — |
| R7 冻结 grep 锚 | 锚1 `512 跳\|TEST_DEFER\|DEFER_MICROTASK_HOPS` / 锚3 `queueMicrotask(` 排除 testing.ts / 锚4 `512 * 1024` diff | **0 / 恰 1（peer-connection.ts:36 defaultDefer）/ 0** | — |
| R8 冻结 grep 锚 | `红灯\|SA6 契约\|SA8 放行\|撤销 round`；`round-1\|round 1`（docs/phases + docs/protocols） | 均 **0 命中** | — |
| B3 首句 | `grep -n "高优先级\|每轮每 namespace最多一个" docs/protocols/instance-replication-v1.md` | §17 L492 段首两短语在位（逐字节保留） | — |
| F1 冻结不可变 | `git diff 218ca3a..06db53c -- test/` / `src/hub-connection.ts` | 0 行 / 0 行 | — |
| 源码 grep 断言禁令 | `grep -l readFileSync packages/ws-replication/test/*.test.ts` | 无命中（SA4 §5；R8 走评审核对） | — |

## 八、SA4 五项测试面校准账本（SA8 复核采信）

SA3 §4 五处「超出 §C 零改动预期」的校准，SA4 §6 逐项裁决**全部成立**（必要 + 断言语义保持/更强 + 文件内注释 + 报告登记）：#1 R3-2 companion 引用先捕获（谓词零改动）、#2 R3-5 inject 后补 settle（断言零改动）、#3 sa7-dynamic D2 临时窗口满构造（判别属性不变）、#4 AC5-SHED 改不变量对 `>48KiB ∧ ≤64KiB`（**更强**）、#5 A2-1011 控制帧抬总预算（精确保留原终止分支判别）。SA8 抽查锚文本（review-red/sa7-hardening-dynamic/g3-g4）与账本一致，无 unjustified calibration。

## 九、遗留（非阻断，移交总控）

1. **CI 动态日志摘录**：commit `06db53c` 未 push（SA3 按指令不 push）——push 后以 PR #165 CI run log 中 `ws-replication` 包 `Test Files 17 passed` 摘录为最终动态证据（本地 131/131 + 2002/2002 已先行；SA7 §4 同判）。
2. **REPORT.md round-2 重写 + 未提交 wiki 工件**（含本核对表与 dispatch 行）：按控制器口径不纳入 SA3 提交——归总控随发布处置。
3. **D5 跟踪票 #168**：已开（见第六节）；处置进度归 #168 自身。
4. SA4 非阻断备注（A2-1011 注释措辞、§D6 文字与实现次序措辞、设计「三 return 点」计数文案、peer-connection namespaceId 防御分支登记）：登记不动代码，留后续轮次。

## 结论

- 八项 PR #165 review 修订（R1–R8）全部交付且经冻结红灯契约 + 双侧评审（SA4 pass / SA7 pass）+ SA8 独立复核证实；
- 15 例红灯契约全转绿；D1–D5 动态锚 6/6 绿（F1 闭合）；包级 **131/131**、整仓 **2002/2002**、tsc 零错、diff --check 干净、零 skip/零 real sleep、R7×4 + R8×2 冻结 grep 锚全过；
- D5 按裁决开跟踪票 **#168**（scope 出轮 + severity 低 + design N2 建议）；
- **Verdict: PASS** —— 建议进入双轴终审（Standards/Spec final review）。

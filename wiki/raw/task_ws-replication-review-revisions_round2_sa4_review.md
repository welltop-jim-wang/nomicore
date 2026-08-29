# SA4 静态验尸报告 — PR #165 review 八项修订（issue #161 round 2）

**Date**: 2026-08-30
**Reviewer**: SA4（独立静态审核，未参与本轮 SA1/SA2/SA5/SA6/SA3 任何产出）
**对象**: SA3 实现 commit `4bc57dd1c160746de3b7148302c89ce5c7f02786`（基线 `0a18661`，单 commit）
**依据**: SA1 R3 绑定设计 `..._round2_design.md`（SA2 R3 pass）；SA6 红灯契约 `..._round2_sa6_red.md`（15 例）；SA3 报告 `..._round2_sa3_impl.md` §4 五项校准账本；PR #165 八项 review 修订。
**Verdict**: **pass**

---

## 0. 结论速览

| 轴 | 结论 |
|---|---|
| §C 文件范围（scope creep / DENY / blacklist） | ✅ 24 文件全在 ALLOW；DENY 零触碰；blacklist 零命中 |
| R1 严格接纳（幸存面全弃 + 无条件显影 + 记账闭环） | ✅ 与 §D1 伪码逐行等价（含 B1 清桶→回减→显影次序） |
| R2 控制额度（字段/校验/尾窗 ledger/检查点评估/生命周期） | ✅ 全要素落位，N6/N7 语义保持 |
| R3 双侧同步静默 + 迟到 cleanup 安全 | ✅ hub/peer 与 §D3 伪码一致，B-2d 守卫结构性保持 |
| R4 pong 专属收口（①–⑦ 次序/重入/代际/GOAWAY 互斥） | ✅ 逐项对位；其余三入口零改动实证 |
| R5 有界整轮扫描（终止性/公平性） | ✅ 终止性证明成立；无阻塞场景逐字节等价 |
| R6 四出口（count/bytes 双口径） | ✅ 四出口全对称；与 R1 闭环成立 |
| R7 defer 泵 seam（生产等价/driver 机制/四条 grep 锚/两处注释同步） | ✅ 全绿（本轮实测复核） |
| R8 权威文档（A8a–A8e/§17 首句逐字保留/ADR append-only/叙事 grep） | ✅ 逐项对位（本轮实测复核） |
| 五项测试面校准（SA3 §4） | ✅ 全部判「必要 + 断言语义保持（1 处更强）」——不构成阻断 |
| 类型面 / CI 触发性 / 源码 grep 断言禁令 | ✅ tsc 0 错；`pnpm test`（vitest include `packages/*/test/**`）覆盖；零 readFileSync 断言 |

---

## 1. §C 文件清单范围审计（scope creep guard）

实际 diff（`git diff --name-only 0a18661..4bc57dd`）= 24 文件：

- 生产 src 8 文件（frame-io / update-channel / peer-connection / peer-namespace / hub-namespace / types / defaults / validate）——逐一对上 §C ALLOW LIST 的 8 个生产条目，无多余文件。
- 测试 8 文件（harness / driver / api.test-d / review-red / sa7-hardening-dynamic / g3-g4 / spec-b1-b2 + 无其他）——全在 ALLOW；g3-g4 与 sa7-hardening-dynamic 的改动即 SA3 登记的校准 #3/#4/#5（见 §6），spec-b1-b2 仅 B4 一行注释 + SA6 既授权的 settleUntil 放宽（sa6_red §0 表明该放宽属 SA6 产出）。
- docs 3 文件 + wiki/raw 6 文件 + REPORT.md **不在 commit 内**（SA3 §5.8：控制器禁改——正确执行）。
- **DENY LIST 核验**：`hub-connection.ts`、`liveness.ts`、`round-engine.ts`、`fence-watchdog.ts`、`error-mapping.ts`、`index.ts`、跨包（replication-protocol / namespace-registry / namespace-runtime / persistence*）、`apps/**`、以及 §C 列明的「不在条件允许面」测试文件（ac3/ac4/ac5/ac7/sa4-r4-1）——**全部不在 diff** ✅。
- **blacklist**（package-lock.json / yarn.lock / .DS_Store / TASK.md / *.bak）零命中 ✅。

## 2. 逐项静态审查（R1–R8）

### R1 — 严格接纳（frame-io.ts enqueueData L174-195）

- 触发面 → shed 循环 → **再判定** `pipelineBytes() + bytes > max` → 拒纳分支：先清该 ns 幸存桶（逐帧回减 `queuedDataBytes`、`bucket.length = 0` 空桶保留注册）→ **无条件** `onDataShed(ns)`（空桶也显影，保 R1-2）→ `ensureCheckpoint()` → return。与 §D1 伪码（B1 修复版）逐行等价。
- 单帧超限与缓冲主导同一判定路径，无特例分支 ✅。
- **重入安全（本轮攻击点①）**：拒纳分支「先清桶后显影」的次序保证 `onDataShed → declareHubResync → sendChecked → outbound.sendControl → drain()` 重入时桶已空、`queuedDataBytes` 已回减——重入 drain 观察一致状态 ✅。
- **幸存面负记账攻击（本轮攻击点②，针对既有 `shedNamespace` 的「显影先于清桶」次序）**：推演结论为**结构性不可达**——`canDispatchMore()` 只看 `inFlightCount < maxInFlightUpdates`（hub-namespace.ts:705-707 / peer-namespace.ts:794-796），而 `onDataShed` 清 `pendingData` 但**从不清 inFlight**；桶非空驻留 ⟹ 上一次 drain 退出时该 ns 窗口满 ⟹ inFlight == max ⟹ 重入 drain 对该 ns 恒 skip（R5 计数跳过）→ 幸存帧不可能在回调窗口内被派发 → `pendingData` 不可能经此路径转负。该结论同时覆盖 `dropData` 与 `dispose` 的同形次序。已列为 SA7 动态观察点（见 §7-D2），非缺陷。

### R2 — 控制独立额度（frame-io.ts + types/defaults/validate + harness/api.test-d）

- `ReplicationLimits.maxQueuedControlBytes` 必填字段（types.ts L31-35）+ 缺省 `8 * 1024 * 1024`（defaults.ts）+ `positiveSafeInteger` + `assertCollKind(≥ maxBootstrapBytes + PROTOCOL_OVERHEAD_BYTES)`（validate.ts；实测 `PROTOCOL_OVERHEAD_BYTES = 128`）——与 §D2 裁决 1 逐项一致。
- 尾窗 ledger 三字段 + `emitOne(message, plane)` + `endOffset` 累计 + 检查点 `flushed = totalEmittedBytes − buffered`（`flushed > 0` 才裁剪——设计的「≤0 零裁剪防御」等价实现）+ 规则 C 析取（控制额度 ∨ 总量+无可 shed 面）+ `sendControl` 补 `ensureCheckpoint`——与 §D2 裁决 2/3 一致。
- **生命周期（N6）**：三字段重置仅在 `clear()`；`dispose()` 末尾经 `clear()` ✅。**N7**：`onSequenceExhausted` 直发路径不入 ledger（注释在位，终态旁路合理）。
- 空闲连接零 timer：`ensureCheckpoint` 既有起挂条件（paused ∨ queued>0 ∨ buffered>0）未被破坏——sendControl 后 buffered>0 才挂 ✅。
- 兼容面：全仓 `maxQueuedBytesPerConnection` 字面构造仅 ws-replication 包内（本轮 grep 实证 + 全仓 tsc 0 错双证）；`CONTRACT_LIMITS` 镜像与 api.test-d 形状断言已同步。

### R3 — 双侧同步静默（hub-namespace / peer-namespace）

- hub `onConnectionClosed`：同步段 `openWaiters = []` + `quiesceSync()`（摘订阅置 undefined + 非 terminal 投影 `closed`）；异步尾巴（drainPendingApplies → closeSessionAndRelease → setState 兜底）不变。`setState` 为纯赋值（hub-namespace.ts:898-900），无迁移合法性抛错面。closing 期 OPEN waiter 已由同步段被动清空（§4.5(c) 既有语义，无回归）。
- peer `onConnectionFatal` / `onConnectionLost`：closing（先 settleCloseMemo）/ failed / 活跃态三分支各自**内联** quiesceSync 于迁移之前，终态分支跳过——与 §D3 N3 钉死形态一致；closing/failed 分支新增 `void this.cleanupResources()` 排程为设计明文（§D3 伪码含此行）。
- **迟到 cleanup 安全（B-2d）**：`closeSessionAndRelease` 入口捕获 `this.unsubscribe`（hub L875-883 / peer 同形）；quiesceSync 已置 undefined → 迟到尾巴结构性跳过退订——新连接 `subscribe()` 写入的新句柄不可能被误摘 ✅。
- 四触发面同栈可达性：`cleanupAll` 同步前缀含 `channels.map(onConnectionClosed)`（设计 §P 已引源码；hub-connection 本轮零改动，前提仍成立）。

### R4 — pong 专属收口（peer-connection.ts onPongTimeoutDetached）

- liveness 回调改接专属入口；①stopLivenessNow → ②clearGoawayDrain → ③退订 → ④`close(1001,'pong-timeout')`（transport.closed 守卫）→ ⑤epoch+1 → ⑥onTemporaryFailure → ⑦投影后 `outbound.dispose()`——与 §D4 ①–⑦ 逐项对位。
- 重入门：`stopping` / `connStateValue !== 'ready'` 双守卫——stop/blocked/backoff 已收口的迟到超时零动作 ✅。
- ⑥⑦零噪声论证复核：⑥ 内 `setState('backoff')` 先于 ⑦ dispose；dispose 的逐 ns `onDataShed → declareLocalResync → sendControl` 命中 peer-connection.ts:499 非 ready 门（实测行号在位）→ 零出站 ✅。①② 先清 timer 防收口途中自重入；③ 先于 ④ 使 close 事件到达时监听已摘。
- 公共 `onTemporaryFailure` 其余三入口（dial 抛错 L208 / hello 超时 L650 / onClose L562）零改动——diff 实证 ✅。hello 超时孤儿传输为设计 §D4 登记观察项（N2，建议开跟踪票——归总控）。

### R5 — 有界整轮扫描（frame-io.ts drain）

- `consecutiveSkipped` 循环顶界检查（`>= this.dataOrder.length` 当前值）、skip +1、派发归零、空桶守卫注销不增计数——与 §D5 伪码一致。
- **终止性（本轮攻击点③）**：每迭代或推进游标（skip）、或收缩 `dataOrder`（unregister）、或消耗一个排队帧（dispatch）——三者皆单调，且界取当前 `dataOrder.length`（收缩只收紧）→ 无死循环；全阻塞场景首个 enqueue 的 drain 至多一整轮即 return（D3 伴生锚「全阻塞有界」在位）。
- **公平性**：`canDispatchData` 缺席或恒真时 `consecutiveSkipped` 恒 0 → 与基线逐行为等价（AC5-RR 不受影响）✅。
- N4 假设（循环体无 `enqueueData` 调用点）复核：循环体回调面仅 `onDataDispatched`（通道记账 + ACK 计时器）与 `emitRaw`（transport.send）——零 enqueueData ✅。

### R6 — pending handoff 双口径（update-channel.ts）

- `pendingDataBytes` 字段 + `overflows()` count 口径纳入 `pendingDataCount`、bytes 口径纳入 `pendingDataBytes` + 四出口（handoff `+` / onDataDispatched `−` / onDataShed 清零 / teardown 清零）——全部在位且对称。
- 与 R1 闭环：拒纳 → 清幸存桶 → 无条件 onDataShed → channel 双字段清零——handed-off-未派发面全弃后清零，无负记账（R1-3 锚 (b) 直测）。
- `abandonInFlight` / `markResyncReceived` / `flushQueued` 不触碰 pending 字段——域正确（in-flight / channel 队列侧），窗口不变量循环条件已含 pendingDataCount ✅。

### R7 — 确定性 seam + 去 512 跳魔法

- 生产：`requestRebuild` L638 `queueMicrotask` → `this.deferTask(...)` + L634-637 注释改写 ✅；生产缺省 `defaultDefer` = 单次 `queueMicrotask`（peer-connection.ts:34-36）——行为等价。
- driver/harness：`DeferPump`（defer/flush/pendingCount）+ `makeDeferPump()`（入队零隐式执行、flush FIFO ≤1000 轮防自旋）+ 模块级注册表 + `settleUntil` ①谓词→②flush 全部已注册泵→③谓词 + `settle()` 永不冲刷——与 §D7 逐行一致；`boot`/`bootFanout` 双处 `opts.deferTask ?? pump.defer` + `Run.deferPump` 暴露 + `BootOptions.deferTask` 注释更新 ✅；`DEFER_MICROTASK_HOPS`/`TEST_DEFER` 整块删除 ✅。
- **四条 grep 锚本轮实测**：锚 1（`512 跳|TEST_DEFER|DEFER_MICROTASK_HOPS`）→ 0 命中；锚 3（`queueMicrotask(` 排除 testing.ts）→ 恰 1 命中 `peer-connection.ts:36`；锚 4（`512 * 1024` 冻结值 diff）→ 0。B4 两处注释同步（review-red 头部 L13-14「显式 defer 泵 flush seam，见 driver.ts/harness.ts」+ spec-b1-b2 L90「测试侧显式 defer 泵」）逐字对位设计 §D7 配套①②，断言与测试体未动 ✅。

### R8 — 权威文档

- A8a（§2 身份投影句）/ A8b（§17 Adapter 三可选面 + 生产装配期断言 + #164 指针）/ A8c（§18 工程缺省 30s/10s + 构造期校验 + pong 超时 close(1001)/backoff）——三句逐字对位设计 §D8。
- A8d（B3 合并文本）：§17 L492 首句「Connection使用 per-namespace队列和 round-robin：control/error/ACK高优先级，data每轮每 namespace最多一个。」**逐字节保留**（本轮 grep 实测在位且为段首）；终态口径句追加；校验清单 +2 行（maxQueuedControlBytes ≥ maxBootstrapBytes + overhead；maxQueuedBytesPerConnection ≥ highWater）✅。
- A8e：phase-5 L75/L81/L83 三处终态化改写与设计表格逐字一致（冻结词汇「有界 **16** 项冻结常量」等正文保留）✅。
- ADR 0010：diff 仅文末 +13 行（issue #161 round 2 节，与设计 §D8 代码块逐字一致——指针型登记，protocol 为唯一规范源）；既有修订节零改动 ✅。
- 叙事 grep：`红灯|SA6 契约|SA8 放行|撤销 round` 与 `round-1|round 1` 在 docs/phases + docs/protocols 均零命中（本轮实测）✅。
- N5 必做（types.ts facets 两层语义注释 + defaults.ts L29-31 指向 protocol §18）均落地 ✅；frame-io「断点接纳」叙事零残留（grep 实证）✅。

## 3. 静默失败 / 降级 / 读写路径 / 错误处理

- 静默失败：R1 拒纳以 `onDataShed` 显影（RESYNC 声明链既有）；R4 ⑦ dispose 声明经非 ready 门静默是**有意的零噪声**（连接已死，恢复由重连 reconcile 承担，R4-2 A4d 收敛锚在位）——非静默失败。✅
- 降级方案：无新增降级路径。R2 尾窗 `flushed ≤ 0` 零裁剪为防御性不裁剪（只会高估 outstanding，不漏检）——设计明文。✅
- 读写路径一致性：R1/R2/R6 全部记账字段写读同源（OutboundQueue 桶/queuedDataBytes ↔ channel pendingData 双字段 ↔ bufferedAmount 观察面），无分叉。✅
- 错误处理链：无新增未捕获 throw 路径（§X 连锁审计与实现一致：行为契约收紧经回调显影；R2 类型面由编译器兜底——全仓 tsc 0 错实测）。✅

## 4. 架构与过度设计

- 无架构死胡同信号：零 FIXME/临时补丁；变更半径与八项修订一一对应。
- 无过度设计：R4 专属入口 +5 行级方法替代改公共路径（半径最小化正确）；R7 泵为设计裁决的机制本体。✅

## 5. 测试质量门禁

- **源码 grep 断言禁令（§1.7）**：全部 ws-replication 测试零 `readFileSync`（本轮 grep）——R8 按设计走评审核对而非文本断言（review-red 头部「零 docs grep」声明在位）。✅
- **vitest 触发性（§1.4）**：ci.yml L39 `pnpm test` = `vitest run --typecheck`，include `packages/*/test/**/*.test.ts` + `*.test-d.ts`——本任务全部测试文件（含新增 review-red）落在 CI 覆盖面。✅
- **E2E spec**：本任务零 E2E spec 改动（§1.3 不触发）。

## 6. 五项测试面校准逐项裁决（SA3 报告 §4 账本——本轮重点）

判定标准：(a) 校准是否**事实必要**（原构造在绑定语义下是否真的结构性不可满足）；(b) 断言谓词/判别分支是否**语义保持**（或更强）；(c) 是否在文件内留注释 + 报告登记。

| # | 锚 | (a) 必要性验证 | (b) 语义裁决 | (c) 登记 | 结论 |
|---|---|---|---|---|---|
| 1 | review-red **R3-2** companion 引用先捕获 | ✅ 实证：hub `cleanupAll` 既有 `dropConnection` 在 settle 后移除 `hub.connections[0]`（DENY 文件不可改）；`hubChannelOf` 经 connections[0] 重取必抛 | ✅ 三断言谓词零改动（state=closed / inFlight=0 / 零 UPDATE）——同一对象可见终态，投影面不变 | ✅ 文件内注释 + 报告 §4.1 | **保持** |
| 2 | review-red **R3-5** inject 后补 `settle()` | ✅ GOAWAY 经 wire 微任务送达；不补 settle 则 deadline timer 在 advanceBy 已推进 fake now 之后才武装（at=now+500 已过）→ 永不触发——纯测试时序构造缺陷 | ✅ 断言零改动（订阅摘除 + peerEnd.closed）；与 sa7-dynamic G1「先送达后推进」同款模式 | ✅ 注释 + §4.2 | **保持** |
| 3 | sa7-dynamic **D2** 临时窗口满构造 Y2 滞留 | ✅ R5 绑定语义下「blocked 头不终止整轮」⇒ 就绪 ns 恒同轮派发——旧「Y2 滞留」恰依赖被 R5 修复的早退缺陷，构造前提失效 | ✅ 判别属性不变（ret === 控制帧自身序 2、同 drain 数据帧 seq=3、污染前提在场断言）——本轮逐行核验 | ✅ 注释 + §4.3 | **保持** |
| 4 | g3-g4 **AC5-SHED** held 断言改不变量对 | ✅ 数学必要：R1 接纳蕴含 `pipeline ≤ max` ⇒ held（数据面）恒 ≤ max——旧 `> 64KiB` 结构不可达 | ✅ **更强**：`> 48KiB`（近满前提）∧ `≤ 64KiB`（严格接纳字节级不变量直测）；shed 信号断言（RESYNC∨BACKPRESSURE ≥ 1）零改动 | ✅ 注释 + §4.4 | **保持且加强** |
| 5 | g3-g4 **A2-1011** 控制帧抬总预算 | ✅ 同上不变量：数据面单独不可越 max ⇒ 规则 C 总量分支失去纯数据触发面 | ✅ 精确保留原判别分支：数据（严格接纳下恒 ≤ max）+ 控制帧（≈30×40B ≪ 缺省 8MiB 控制额度——SHED_LIMITS 为 Partial 不覆盖该字段，R2 分支不误触）合计越总预算、无可 shed 面、**单检查点** A+C 并列 → 1011；R2 独立分支由 R2-A2a 独立锚定，无交叉弱化 | ✅ 注释 + §4.5 | **保持** |

**总裁决：五项校准全部成立**——均为「设计绑定语义下构造面不可满足」的机制性调整，断言语义零减弱（#4 更强），逐处留注释并登记。SA2 R3 放行边界中「review-red 断言与测试体零改动 / g3-g4 与 sa7-dynamic 零改动预期」被这五处越过，但越过的正当性由不可满足性实证支撑，且 SA3 如实开账（§4 + §5.9 责任边界）——按「 unjustified calibration is blocking」标准，无一项 unjustified。

## 7. 动态审核重点（交 SA7）

- **D1（R2-N2 交接）**：peer `onConnectionLost` closing/failed 分支新增的 `cleanupResources()` 排程——对 B-2d/AC6 系锚做一次断线回归观察（身份守卫下资源提前释放无跨代误摘）。
- **D2（本轮攻击点②的动态确认）**：hub 侧真实过载（live、首次 `declareHubResync`）下 shed 循环触发时，断言 channel `pendingDataCount` 恒 ≥ 0、RESYNC 发射不派发 victim 幸存帧（静态结论：inFlight-only 窗口门使其结构性不可达——动态廉价复核）。
- **D3（R4 N1 互斥）**：GOAWAY drain 窗口内 pong 超时 → `clearGoawayDrain` + close(1001) → 重连 reconcile 恢复（迟到的 deadline 触发只剩幂等 no-op）。
- **D4（R2 ledger 生命周期）**：真实 wire 冲刷推进 `bufferedAmount` 回落时 emitTail 裁剪正确、`controlOutstandingBytes` 归零后不误触 `onControlExhausted`（防高估误杀）。
- **D5（设计 §D4 N2 登记项）**：hello 超时 peer 侧孤儿传输竞速窗口——跟踪票决策归总控，SA7 仅观察记录。

## 8. 非阻断备注（登记不动代码）

1. g3-g4 A2-1011 锚内遗留注释「控制保留额度耗尽必须发出 CONNECTION_BACKPRESSURE」措辞与现判别分支（总量分支）不完全对应（该注释文本先于 R2 双分支存在，非本轮引入）——纯注释瑕疵，断言无影响，建议后续轮次顺带润色。
2. 设计 §D6 对 `shedNamespace` 的文字描述「整桶丢弃后显影」与实现次序（显影后清桶）在回调窗口内不一致——终态不变量成立且经本轮推演不可利用（§2 R1 攻击点②），建议 SA1 后续修订措辞；无需代码改动。
3. `REPORT.md` round-2 重写（§C ALLOW 项）按控制器指令未纳入提交——交付面归总控处置；工作树余留的未提交改写为 round-1 遗留。
4. SA6 红灯基线仅存于工作树（未独立 commit），committed review-red 与 SA6 契约文本的逐字节不可差分——本轮以 sa6_red.md 冻结契约描述逐锚比对（全部吻合），SA3 自报的两处校准 + 头注释同步均在文件内在位。

## 9. 本轮验证命令与结果（SA4 实测）

```bash
# 范围
git diff --name-only 0a18661..4bc57dd          # 24 文件，全在 §C ALLOW / 白名单
# R7 锚（§D7 四条）
grep -rn "512 跳\|TEST_DEFER\|DEFER_MICROTASK_HOPS" packages/ws-replication   # → 0
grep -rn "queueMicrotask(" packages/ws-replication/src | grep -v src/testing.ts # → 恰 1：peer-connection.ts:36
git diff 0a18661..4bc57dd -- packages/ws-replication/src/defaults.ts packages/ws-replication/test/harness.ts | grep -c "^[+-].*512 \* 1024"  # → 0
# R8 锚（§D8e / B3）
grep -rn "红灯\|SA6 契约\|SA8 放行\|撤销 round" docs/phases docs/protocols   # → 0
grep -rn "round-1\|round 1" docs/phases docs/protocols                       # → 0
grep -n "高优先级\|每轮每 namespace最多一个" docs/protocols/instance-replication-v1.md  # → §17 L492 段首（首句逐字保留）
git diff 0a18661..4bc57dd -- docs/adr/0010-*.md                              # → 仅文末 +13 行
# 类型面（最小静态检查）
npx tsc --noEmit -p tsconfig.typecheck.json                                  # → exit 0
# 测试质量门禁
grep -l readFileSync packages/ws-replication/test/*.test.ts                  # → 无命中
# CI 触发性
grep -n '"test"' package.json + vitest.config.ts include                     # pnpm test = vitest run --typecheck，include packages/*/test/**——全覆盖
```

未重跑 vitest（静态审核定位；15 红转绿与 125/1996 全绿以 SA3 报告 + SA7 动态验证为准）。

---

**Verdict: pass** —— SA3 实现与 SA1 R3 绑定设计、SA6 冻结契约、PR #165 八项修订要求静态一致；五项测试面校准全部成立（必要 + 语义保持/更强 + 已登记）；SA7 可进入动态验证（重点见 §7）。

---

# SA4 F1 复审（§D9 wipe-credit 修复轮）

**Date**: 2026-08-30
**对象**: SA3 commit `06db53c8fe6ca6be4ae9605f5d455bb79aa706bd`（基线 `218ca3a` = SA7 冻结锚 commit）
**依据**: SA1 design R4 增补节 **§D9**（SA2 R4 verdict pass——含 R4-N1 排除引理 / R4-N2 credit 清零不可省 / R4-N3 计数口径）；SA7 报告 §2（F1 = D2 滞回接纳帧负记账，破坏性锚冻结于 `218ca3a` L377-431）；SA3 报告 F1 增补节。
**范围**: 仅 F1 实现（wipe-credit 记账 / 布尔判定链与内部 API 范围 / hub-connection DENY / R4-N1 引理与三门 / R4-N2 清零 / 双侧对称 / 冻结 D2 锚不可变）。
**Verdict**: **pass**

## F1.0 范围与文件审计

`git diff --name-only 218ca3a..06db53c` = 恰 5 个 src 文件 + 2 个 wiki 工件（sa3_impl F1 增补节 + dispatch 行）——逐一对上 §C ALLOW 的 §D9 增量条目；**零测试改动、零 docs 改动**；5 文件 diff 逐行复核无 F1 之外夹带。blacklist 零命中。

## F1.1 wipe-credit 记账（update-channel.ts 核心）

- `uncountedAccepted/uncountedAcceptedBytes` 子账本 + handoff **increment-before**（先计保留——无 wipe 路径派发减记命中已计帧，零瞬态负值，S3）→ `const accepted = host.enqueueUpdate(bytes)` → `!accepted` 早退（拒纳已清零含先计，一致）→ `accepted && needsResync 翻转` 双条件信用登记（**不重计 pending**——冻结 D2 锚 L403/L407 = 0 观测面保持，§9.0 推论落实）→ onDataDispatched **信用消费先于减记**（else 分支减记已计帧）→ onDataShed/teardown **credit 双清零**——与 §D9 (2) 伪码逐行等价。
- **冻结 D2 锚逐子锚静态推演**（D2_LIMITS 64KiB/1KiB/4096/16 实测读取后逐步走算）：#1 派发 pending 0（L388）→ #2..#7 计 6 无 wipe（L392/L394）→ #8 触发面：pipeline ≈57.7+8.2 > 65,536 → shed 弃 6 帧桶 + onDataShed（pending 7→0、needsResync、首次 declareHubResync → sendControl 重入 drain：paused 数据循环跳过 → UPDATE 恒 1，L402）→ 再判定 16.4 ≤ 64KiB 滞回接纳 → return true → handoff 检出 needsResync → credit=1、pending 恒 0（L403）→ #9/#10 deliver 首行弃（L407）→ 恢复派发 #8 信用消费跳过减记 → pending 0（L430 ≥ 0）+ inFlight+pending ≤ 16（L423）+ 收敛（L418-420）——**全部子锚在实现下静态成立**。
- **wipe 检测精确性**：handoff 入口 needsResync 恒 false（deliver 首行守卫 + flushQueued 循环条件；handoff 仅此两调用点——grep 实证）⟹ `enqueueUpdate 同步栈内 needsResync 置位 ⟺ 本 ns onDataShed`（shed 循环 victim=本 ns / 拒纳分支 / 非 ready 门三源，后者均回 false）——「翻转即 wipe」判别无假阳性。

## F1.2 布尔判定链与内部 API 范围

- 链路逐环核验（全部**表达式体**，布尔无吞没）：`UpdateChannel.handoff` → `enqueueUpdate: (bytes) => this.enqueueUpdateFrame(bytes)`（hub-namespace:128 / peer-namespace:129）→ `return this.host.sendData({...})`（hub-namespace:696 / peer-namespace:784）→ hub 侧 `sendData: (message) => this.outbound.enqueueData(...)`（hub-connection:181）/ peer 侧 `sendData: (message) => this.sendData(message)`（peer-connection:91）→ `return this.outbound.enqueueData(...)`（peer-connection:519）→ `enqueueData: boolean`（拒纳 false / 接纳 true）。
- **公共面**：`index.ts` 冻结导出（两工厂 + DEFAULT_* + types.ts 类型）零触碰——`UpdateChannelHost`/`HubChannelHost`/`PeerNamespaceHost`/`OutboundQueue` 均不在公共导出；`enqueueData` void→boolean 为返回类型放宽，既有调用方（含类级锚深导入忽略返回值）源兼容；全仓 tsc 0 错双证。
- 消费方封闭：`enqueueUpdate`/host `sendData` 唯一消费方 = UpdateChannel.handoff 两侧各一（grep 实证）；peer-connection 私有 sendData 新增 `namespaceId === undefined → false` 防御分支（结构不可达，语义一致「未接纳」——超设计字面三支的防御性补充，同文件同关注面，安全）。

## F1.3 hub-connection DENY 保持

`git diff 218ca3a..06db53c -- packages/ws-replication/src/hub-connection.ts` = **0 行**；L181 实测为表达式体 `(message) => this.outbound.enqueueData(...)`——类型放宽后布尔自动回流，§D9「零文本改动」条款成立，无需回 SA1 扩 ALLOW。

## F1.4 R4-N1 排除引理与三门精确负载

- **三门实测**：deliver live 门 = `inFlight.size + pendingDataCount + uncountedAccepted < maxInFlightUpdates`；flushQueued 循环条件同三和；overflows count = `inFlight + queued + pendingDataCount + uncountedAccepted`、bytes = `queuedBytes + pendingDataBytes + uncountedAcceptedBytes + ΣinFlight + incoming`——**pendingDataCount 保留于和式且 uncounted 双口径纳入**（R4-N1「不可被优化掉」检查项逐字满足，S6 零 off-by-one）。
- **引理独立重推**（本轮攻击点）：wipe ⟹ shed 循环 victim = 本 ns ⟹ 触发前本 ns 桶非空；归纳不变量「每次 enqueueData 末尾同步 drain + R5 退出条件（paused / 队列空 / 全部非空桶 ns 连接门 blocked）」⟹ 桶非空驻留 ⟹ paused ∨ inFlight == max；handoff 门通过（三和 ≥ inFlight 单项 ⟹ inFlight < max = 连接门开）⟹ **paused** ⟹ 同栈 drain 数据循环跳过 ⟹ 未计帧入桶、信用先登记——「未计帧同栈派发先于信用登记」角落结构性排除。与实现内 binding 注释及 SA2 R4.1 推导一致。
- **S5 混桶对位**：wipe 后 needsResync 阻断一切新 handoff ⟹ 未计帧为该桶代内唯一在桶帧；resetForLive 后新已计帧 FIFO 追加其后；派发序 counted*→uncounted→counted* 与信用消费/减记严格对位；新一轮 wipe 弃桶时 credit 同步清零——无错位、无悬挂。

## F1.5 R4-N2 credit 清零

`onDataShed` 与 `teardown` 均双清（count+bytes）——**未**以「恒 ≤1」为由简化（注释明引 R4-N2）。跨代正确性复核：credit 域 ∈ {0,1} 成立（代内单 wipe + needsResync 阻断新 handoff），而跨代 wipe（resetForLive 后再过载）依赖 onDataShed 清零防悬挂——实现保留通用 N 计数器 + 双清，与 SA2 指引一致。

## F1.6 hub/peer 对称

共享层（UpdateChannel）单点记账；双侧 disposition 链同形（F1.2 逐环）；双侧 `enqueueUpdateFrame` 均带超限早退 → false 防御双门（channel 侧 handoff 先行门已拦，结构性不可达——与 §D9 S10 一致）；peer 侧特有非 ready 门（onConnectionDataShed 显影 + false，S9）为结构差异（hub 无 connState 门），设计明文。

## F1.7 冻结 D2 锚不可变

`git diff 218ca3a..06db53c -- packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts` = **0 行**（字节不变）；F1 commit 不含任何测试文件——15 红锚/既有锚面同样零触碰。SA3 声称 6/6 转绿 + 包级 131（R4-N3 口径）+ 整仓 2002——静态推演支持（F1.1），动态复测归 SA7。

## F1.8 本轮验证命令与结果（SA4 实测）

```bash
git diff --name-only 218ca3a..06db53c                       # → 5 src + 2 wiki，无测试/docs
git diff 218ca3a..06db53c -- packages/ws-replication/src/hub-connection.ts                     # → 0 行（DENY）
git diff 218ca3a..06db53c -- packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts  # → 0 行（冻结锚）
npx tsc --noEmit -p tsconfig.typecheck.json                 # → exit 0
git diff --check 218ca3a..06db53c                           # → 干净
# 消费方封闭 / 表达式体接线 / handoff 双入口守卫 / 三门和式 —— grep 逐点实证（见 F1.2/F1.4）
```

未重跑 vitest（静态定位；D2 转绿与 131/2002 口径以 SA3 实测 + SA7 动态复测为准）。

## F1.9 非阻断备注

1. 设计 §C「enqueueData 三 return 点」与实现 2 个显式 return（false/true）计数不符——TS boolean 返回类型保证穷尽，纯文案计数瑕疵，无行为差。
2. peer-connection sendData 的 `namespaceId === undefined → false` 为超设计字面的防御分支（结构不可达）——语义一致、同关注面，登记不阻断。
3. 动态复核点交 SA7：冻结 D2 6/6、包级 131、整仓 2002（R4-N3 口径）+ §D9 S1 场景实测复跑。

---

**F1 Verdict: pass** —— §D9 wipe-credit 实现与设计逐行等价；判定回传链封闭于内部 API 且全表达式体回流；hub-connection DENY 零 diff；R4-N1 引理地基（三门和式）与 R4-N2 清零均落实；双侧对称；冻结 D2 锚字节不变且静态推演全子锚成立。SA7 可进入 F1 动态复测。

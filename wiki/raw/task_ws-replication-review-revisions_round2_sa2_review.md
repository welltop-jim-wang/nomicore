# SA2 攻击评审报告 — PR #165 review 八项修订设计（round 2）

**Date**: 2026-08-30（R1 首审 → R2 窄域复审 → R3 限定复审，见文末各节）
**Reviewer**: SA2（adversarial / wallfacer）
**对象**: `wiki/raw/task_ws-replication-review-revisions_round2_design.md`（SA1，2026-08-30，基线 commit `0a18661`）
**输入交叉**: SA5 分析（`..._round2_sa5_analysis.md`）、SA6 红灯契约（`..._round2_sa6_red.md`，13+1 红灯基线）、`packages/ws-replication/src/*`、`test/driver.ts`、`test/harness.ts`、五个测试文件锚、`docs/protocols/instance-replication-v1.md`、`docs/adr/0010-*`、`docs/phases/phase-5-websocket-replication.md`、round-1 relevant_decisions。
**Verdict（最新 = R3）**: **pass**——B4 三处修正（§D7 配套注释同步②属主 / §C 限定性条目 / 锚 1 清单实测全列 11 处）逐项核验通过，四条 grep 锚修后全部可满足；R1 阻塞 B1/B2/B3 与 R2 阻塞 B4 全部闭环。详见文末「R3 限定复审」。裁决历史：R1 reject（B1 CRITICAL/B2/B3）→ R2 reject（B4 残留）→ R3 pass。

---

## 0. 核验方法与证据基线

- 全部源码引用按 worktree 现状（commit `0a18661` + SA6 未提交测试 diff）逐行核对；行号与设计文档引用一致性已抽查（frame-io.ts L155-177/L199-235/L239-256、update-channel.ts L112-133/L142-146/L180-187、peer-connection.ts L345-350/L597-615/L617-642、hub-connection.ts L161/L181/L293-296/L408-437、hub-namespace.ts L557-567/L856-877、peer-namespace.ts L606-631/L950-988、types.ts L18-29/L57-63/L130、defaults.ts L16-41、validate.ts L107-152）。
- 红锚通过性做了**字节级重算**（UPDATE 帧开销按协议 20B 大端 envelope + 变长字段；`BLOB`=8000/8005B）：R1-1（第 8 笔接纳边界 64,180 ≤ 65,536 < 72,205——恰好 8 派发）、R1-2、R2-A2a（16×~8.25KiB ≈132KiB > 32KiB，检查点 #2 单触发）、R6-1（1+0+7=8 ≥ 6）、R6-2（≈9L > 4L）、A2 滞回（首次 shed 使 channel 转 needs-resync → 后续交付走 deferred 而非 handoff → 恢复后恒 2——SA6 仲裁成立，SA5 若按 SA1 口径≤1 会成永久红灯）、D3（skip 计数 2 < 3 → Y2 同轮派发）。
- 逐项核验了控制器指定的八轴：R2 FIFO 尾窗 ledger 与校验、R3 同步性与代际安全、R4 close 同步触发 onClose 的回调序/重入、R5 终止性、R6 记账出口完备性、R7 显式 seam 是否真实替代魔法、R8 权威源与历史不被误改。

---

## 1. 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 修订要求 |
|---|--------|--------|---------|---------|
| B1 | **CRITICAL** | §D1 R1 拒纳路径 × §D6 R6 记账闭环 | 拒纳分支只调 `onDataShed(namespaceId)` 而**不丢弃该 ns 仍留在 `dataQueues` 的排队帧**。拒纳可达时 shed 循环条件 `queuedDataBytes > lowWater` 常已不成立（总量 ≤ lowWater 的幸存帧合法存在），幸存帧不受影响；`onDataShed` 却把 channel 侧 `pendingDataCount`/`pendingDataBytes`（R6 新字段）**清零**。幸存帧随后在 unpause 派发 → `onDataDispatched` 再减一 → **负记账**：A7 窗口门（`inFlight + pendingData < maxInFlightUpdates`，L56/L153）与 R6 溢出判定双双低估负载（负 pending 使窗口等效放宽 \|负值\| 帧，破坏被锚冻结的窗口不变量）；且该 ns 已发 RESYNC_REQUIRED 声明后**仍向 wire 派发其旧帧**（声明语义「发送队列溢出」与行为矛盾）。触发条件具体：buffered 主导近 max（单检查点间隔内数据突发即可达）+ 拒纳 ns 自有 ≤ lowWater 排队字节（shed 循环不触发即幸存）。现红锚 R1-1/R1-2 拒纳时队列皆空——**零覆盖**，SA4/SA7 也不会撞见。 | 拒纳分支改为「无条件显影 + 丢弃该 ns 幸存排队面」：先清空 `dataQueues.get(namespaceId)` 桶并回减 `queuedDataBytes`，再 `deps?.onDataShed(namespaceId)`（注意 `shedNamespace`/`dropData` 对空桶**跳显影**，而 R1-2 要求空桶也显影——需无条件 declare 的组合）。修订后锚零扰动（R1-1/R1-2 空桶场景不变；A2 首次触发走接纳分支不进拒纳）。补红灯锚 R1-3（见 §5）。 |
| B2 | **HIGH** | §D7/§V.4 R7 grep 验收锚 | 两条 grep 锚**事实性不可满足**：①`grep -rn "512" src test/driver.ts test/harness.ts → 零命中`——实际必中 6 处**冻结契约值**：`src/types.ts:22,28`（`// 512 KiB` 注释）、`src/defaults.ts:20,26` 与 `test/harness.ts:130,136`（`512 * 1024`——maxUpdateBytes/highWater 冻结缺省，不得动）；②`grep -n "queueMicrotask" src/*.ts → 仅 defaultDefer 一处`——实际 `src/testing.ts:18,25` 有两处**合法调用**（导出的内存双工 transport 微任务投递，必须保留），另有 `types.ts:130`、`peer-connection.ts:34` 注释含词。SA4 按 §V.4 执行必然假失败；更危险的是诱导 SA3「改绿 grep」——篡改冻结值或删合法注释。 | 换成模式定向锚（可满足且更精确）：`grep -rn "512 跳\|TEST_DEFER\|DEFER_MICROTASK_HOPS" packages/ws-replication` → 0；`grep -rn "queueMicrotask(" packages/ws-replication/src | grep -v "src/testing.ts"` → 仅 `peer-connection.ts:36`（defaultDefer）一处。（已实测：全仓「512 跳/TEST_DEFER」叙事命中恰为 driver.ts L400-401/407-418、peer-connection.ts L636、peer-namespace.ts L689、red 测试头 L13——全部在 §D7 清理面内。） |
| B3 | **HIGH** | §D8 A8d——protocol §17 L490 段改写 | A8d 的替换文本**丢掉原段两条既有冻结不变量**：原文「Connection使用 per-namespace队列和 round-robin：**control/error/ACK高优先级，data每轮每 namespace最多一个**」——新文本只重写了总量记账/shed/严格接纳/控制额度/检查点/有界扫描，**未重述** (a) 控制恒先于 data（AC5-PRI 锚的行为基础）、(b) 每轮每 ns 至多一帧（AC5-RR 锚）。「扩写为」若被 SA3 执行成整段替换，protocol（§22 conformance 的被引权威）将无声失去两条行为不变量——正是本轮 R8 要防的「accidental rewriting」，只是方向反过来：误删而非误留。 | A8d 明确「保留原段两句不变量 + 追加终态口径句」的合并文本（或在新文本内逐字重述两句），并在 §V.5 增加对应 doc-diff 核对项：改写后 §17 必须仍含「高优先级」与「每轮每 namespace最多一个」字样。 |

---

## 2. 逐项核验结论（控制器指定八轴）

### R2 — FIFO buffered ledger 与 limits 校验：**成立（含 B2 关联的验收命令修正）**

- **尾窗归因正确性**：`flushed = totalEmittedBytes − buffered` 单调不减（增量恰为冲刷量；`flushed ≤ 0` 防御裁剪正确处理 adapter 计入非本队列字节的情形）；FIFO 冲刷假设与 WHATWG `bufferedAmount` 语义及 GatedWire 实现（releaseAll 按序 splice）一致；乱序 adapter 下偏差方向为高估 outstanding（保守，不漏检）——§P 风险标注属实。
- **重置安全**：双侧 OutboundQueue 均 per-connection/per-generation（peer dialNow 重建、hub cleanupAll 后死亡），dispose 后不复用——三字段重置无跨代污染。
- **检查点评估而非 send 时拒发**：三条理由核验成立——①终止路径自举（hub-connection.ts:424-437 确先 sendControlChecked 再 close；send 时拒发会使 CONNECTION_BACKPRESSURE ERROR 自身不可发）；②AC5-PRI 结构基础；③与 A2-1011 锚同节奏。`sendControl` 补 `ensureCheckpoint()` 起挂条件复核：空闲连接（buffered=0、无排队、未暂停）零 timer——N1 不破；sa7 W1（buffered=0）不起挂。
- **校验链**：`maxQueuedControlBytes ≥ maxBootstrapBytes + PROTOCOL_OVERHEAD_BYTES(128)` 与缺省 8MiB=maxFrameBytes 的「单笔合法帧不可独自耗尽」核算成立（严格 `>` 判定下 8MiB 帧不越 8MiB 额度）；R2-A2a 锚 32KiB < 下限属类级直构绕过 validateLimits 的**有意**测试配置（OutboundQueue 不调 validate——核实无误），设计已显式注明。
- **编译破坏面**：实测全仓限值字面量——必填字段仅破坏 `harness CONTRACT_LIMITS`（无 cast）与 api.test-d 形状断言；两处 `QUEUE_LIMITS` 均 `as ResolvedLimits` cast 不破坏；其余测试用 Partial。§B 风险 1 与 §X caller 审计**准确**。
- **锚算术**：R2-A2a 全步骤重算通过（检查点 #1 规则 A 暂停 → 第二帧排队保 `largestQueuedNamespace()=W` → 16×~8.25KiB 控制风暴 → 检查点 #2 尾窗零冲刷 → ≈132KiB > 32KiB → exhausted 恰 1）；A2-1011 保持绿（控制尾窗 ≈0，总量分支照旧）。

### R3 — 同步性 + 代际安全：**成立**

- hub 侧同步性论证核验：`cleanupAll` 为 async，`channels.map(ch => ch.onConnectionClosed())`（hub-connection.ts:415）位于首个 `await`（L417）之前的同步前缀；`close()/onTransportClosed()/connectionFatal()/onSequenceExhausted()` 四触发面均 `void cleanupAll()`——R3-1/R3-2/R3-3 同步栈断言可达。
- `quiesceSync` 提前置 `closed` 的语义安全：drain 窗口内迟到 apply 续体走 `isTerminal()` 静默回收（§13.4）；bootstrap/close timer 回调的 `isTerminal()` 早退反而**关闭**了现实现下「drain 窗口 timer 可 finalize('failed')」的潜在竞态；`declareHubResync` 的 `isQuietState()` 守卫因提前终态更严（零噪声）。
- peer 侧 B-2d 守卫：`closeSessionAndRelease` 入口捕获 `this.unsubscribe`——quiesceSync 先置 undefined → 迟到尾巴捕获 undefined → 结构性跳过退订；新连接 `subscribe()` 写入的新句柄不被触碰（比「比对后置空」强）。核验成立。
- R3-4/R3-5 走查成立（enterBlocked L577-595 同步循环、goaway deadline L449-454 先 quiesceControllers 后 close 的既有顺序保持）。

### R4 — 回调序/重入（含 close 同步触发 onClose）：**成立**

- **同步 onClose 敌意适配器推演**：③退订先于④close——peer 自身 onClose 零到达；hub 半边由 close 事件驱动 `onTransportClosed → cleanupAll`（R3 同步静默 + dropConnection），与 peer 剩余步骤 ⑤⑥⑦ 操作不相交对象，无重入危害。fake wire（queueMicrotask 送达）与真实 WS（异步）之外，同步送达亦安全。
- **⑥⑦ 顺序**：先投影（backoff）后 dispose——dispose 的逐 ns `onDataShed → declareLocalResync → sendChecked → sendControl` 撞 `connState !== 'ready'` 门（peer-connection.ts:499）→ 零出站噪声；与 enterBlocked L584-591 同款纪律，核验成立。
- **GOAWAY 互斥**：drain 窗口（state 仍 ready）内 pong 超时 → 入口收口 + `clearGoawayDrain()`；迟到 deadline 只剩幂等重复；`goawayActive` 由 dialNow 复位（L194）——N1 成立。
- **幂等重入**：`stopping`/`connState !== 'ready'` 双门；dialNow 到期重执行全部步骤为 no-op（与 L195-201 卫生序同族）。R4-1（同栈 peerSideClosed + settle 后 hub 清零）/R4-2（单连接、迟到帧零影响、n=9 收敛）字节级走查通过（backoff 0.99×100=99ms 观察窗成立）。
- hello 超时路径不关传输登记为观察项——同意本轮不开票（SA5/SA6 均未列为修订项），见 N2。

### R5 — 终止性：**成立**

- 两次派发间至多 `dataOrder.length` 次 skip（游标每 skip 前进一格）；比较取**当前**长度，`unregisterDataNamespace` 收缩只收紧界。drain 同步执行期间 `canDispatchData` 只会因 `onDataDispatched`（inFlight 增）更假、ACK 不可能到达（无 timer 推进）——无活锁。无阻塞场景 `consecutiveSkipped` 恒 0 → 与现实现逐行为等价（AC5-RR 保持）。D3 改写锚与「全阻塞有界」伴生锚推演通过（含 Y2 二次派发后的 3-skip 收尾终止）。

### R6 — 记账出口完备性：**成立**

- 实测 `pendingDataCount` 全部变更点 = handoff(L144,+)/onDataDispatched(L113,−)/onDataShed(L121,=0)/teardown(L182,=0)——**恰四出口，无第五处**；`pendingDataBytes` 镜像完备。`abandonInFlight` 不动 pending（域为 in-flight）正确；窗口不变量循环条件未动。R6-1/R6-2 算术重算通过；F1 旧口径本已溢出（行为不变）。
- **但**：R6 的闭环正确性依赖「`onDataShed(ns)` ⇒ 该 ns handed-off-未派发面已全弃」这一队列侧不变量——正是 B1 打破的点。B1 修复后 R6 才真正闭环。

### R7 — 显式 seam 是否真实替代魔法：**机制成立，验收命令需修（B2）**

- 生产侧：`deferTask` seam 已存在（peer-connection.ts:83/L96 host 接线），L638 改道 + L634-637/peer-namespace L688-689 注释去 512 叙事——覆盖实测全部 512 叙事命中点（driver L400-418、peer-connection L636、peer-namespace L689、red 测试头 L13）。
- driver 泵：入队零隐式执行、`flush()` FIFO 有界（1000 轮防自旋）、唯一自动冲刷点 = settleUntil 谓词未决轮（谓词先行）、`settle()` 永不冲刷——「needs-resync 投影先可观测」结构化保持（投影是 timer 回调同步 setState，先于任何 flush）；「延迟任务出现于 settle 之后」窗口收窄为「首个未决轮」且 §D7 逐文件依赖面核对与 B-1 预放宽一致（settle 300 跳 < 512 结构性排除旧依赖）。R7-1 latch 锚与 `opts.deferTask ?? pump.defer` 覆盖序兼容。
- **唯一缺陷是 B2 的两条 grep 锚**：机制清理本身干净，但验收命令把冻结的 512KiB 契约值与 src/testing.ts 合法调用一并误伤。

### R8 — 权威源/不误改历史：**主体成立，A8d 有 B3**

- 分层正确：规范句全部落 protocol；ADR 0010 只追加节（文末 append-only，既有 L228-291 修订节零改动——实测文件恰 291 行）；phase-5 L75/L81/L83 三处改写与现文本逐字对位（已读原文核对），冻结词汇正文保留。
- A8a/A8c 依据核实（hub-connection.ts:78-95 TypeError + L269 受信投影；defaults L39-40 + validate L161-166）。A8d 校验清单增行与 validate.ts L147-151 对应正确。
- R8 grep 锚实测可行：`docs/phases`+`docs/protocols` 中「红灯/SA6 契约/SA8 放行/撤销 round」当前零命中；「round-1|round 1」唯一命中 = phase-5 L81（在改写面内）——SA5 §5 的 R8-e 定位不完整保留意见由本设计 + 锚封闭。
- **B3**：A8d 替换文本本身漏掉原段两句冻结不变量（控制高优先级、每轮每 ns 一帧）——这是本轮发现的唯一「误改权威」风险，方向是误删。

---

## 3. 协议假设依据审查（§P）

章节存在 ✓；六条假设均给了可定位依据（源码行号/既有测试/官方语义+类比），无「应该/预计」类无据推断；「实测验证」类依据（SA6 基线 14 failed/110 passed）有命令与输出可复跑。两条 nit（非阻塞）：WHATWG `bufferedAmount` 官方语义未附规范链接（语义描述准确、且与 GatedWire 实现互证，可过）；vitest `isolate` 默认值建议在 §P 补一句版本无关性说明（现有「闲泵 flush 为 no-op」论证已兜底）。依据可被 SA4 复核：命令可重跑、引用行号实测对位。

## 4. 错误处理链路审查

- **静默失败**：本轮主命题即反静默（拒纳必显影、shed 必声明、teardown 必清账）。B1 是本轴唯一漏洞（负记账 = 静默状态腐蚀 + 声明后仍派发的语义撕裂）——已列 CRITICAL。
- **状态闭环**：R6 四出口完备（实测无第五变更点）；R1 拒纳路径的通道侧清零经 onDataShed 闭环（B1 修复后成立）。
- **降级路径**：transport 缺面 dormant 是 adapter 能力协商（合法降级，非 bug 掩盖）；A8b 同时要求生产组合根装配期响亮断言——**无虚假降级**（缺面在正常生产装配中不允许存在，运行时 dormant 仅测试/内存 transport 语义）。
- **可感知性**：全部丢弃面经 RESYNC_REQUIRED/needs-resync 显影；连接级终止经 ERROR + close code（1011/1008/1001）可观测。

## 5. 红线测试思路（per 漏洞）

- **B1 → R1-3（建议新增红灯锚，SA6 可补）**：`max=64KiB、lowWater=1KiB、highWater=4096`；ns A 突发 7×8KiB（gate 置停，不推检查点）→ 推进一个检查点置 paused（buffered ≈56KiB）；ns W 排队 1 帧 512B（admission 通过、paused 保排队）；再向 W 投 8KiB 帧 → 触发面（queued 512B ≤ lowWater → shed 循环不运行）→ 严格判定 56KiB+0.5KiB+8KiB > 64KiB → 拒纳 + `onDataShed(W)`。断言：(a) 该 RESYNC 声明之后 wire **零 W UPDATE**（幸存 512B 帧必须同批丢弃——现设计下会派发 → 红）；(b) 释放 gate + unpause 排空后对象图只读 `channel.pendingDataCount === 0`（现设计为 −1 → 红）；(c) 恢复 round 后 `inFlight.size + pendingDataCount ≤ maxInFlightUpdates`（A7 窗口不变量）。
- **B2 → 静态门禁命令**（非行为测试）：修正后的两条 grep 按 §1-B2 给出的替换命令执行并断言输出（`512 跳|TEST_DEFER|DEFER_MICROTASK_HOPS` → 0；`queueMicrotask(` 排除 testing.ts → 恰 1 处）。附防回归断言：`defaults.ts`/`harness.ts` 的 `512 * 1024` 冻结值 diff 为零。
- **B3 → doc-diff 核对项**（SA6 §5 documentary 模式）：改写后 `docs/protocols/instance-replication-v1.md` §17 L490 段仍含「control/error/ACK高优先级」与「每轮每 namespace最多一个」两短语（`grep -n "高优先级" docs/protocols/instance-replication-v1.md` ≥1 且位于 §17）。

## 6. 修订要求汇总（blocking——SA1 修订设计后重审，仅需改设计文档）

1. **§D1 拒纳分支**（B1）：改为「丢弃该 ns 幸存排队帧（清桶 + 回减 queuedDataBytes）+ 无条件 `onDataShed` 显影（空桶也显影，保 R1-2）」；同步更新 §X 中 `enqueueData` 行为契约描述与 §A 增补 R1-3 锚映射；§D6「与 R1 的闭环」段补一句该不变量（onDataShed(ns) ⇒ ns 队列面已全弃）。
2. **§D7 grep 锚 + §V.4**（B2）：按 §1-B2 替换命令重写三条锚中的 #1/#3；#2（DEFER_MICROTASK_HOPS 零命中）保留。
3. **§D8 A8d**（B3）：替换文本合并原段「control/error/ACK高优先级，data每轮每 namespace最多一个」两句（或逐字重述），§V.5 增 doc-diff 核对项。

## 7. 修正后验证范围（fixed verification scope——SA3 完成后）

1. 原有：红转绿 14 例（review-r1-r7-red + sa7-dynamic D3）+ 全量 `packages/ws-replication` 124 例 + `pnpm test`（typecheck）。
2. **新增 R1-3 红灯锚**（B1 行为面，见 §5）纳入红转绿集合。
3. R7 grep：**修正后**的两条命令（§1-B2）+ 冻结值防回归 diff（defaults/harness 的 512\*1024 不动）。
4. R8 doc-diff：protocol §17 两句不变量短语在位（B3）+ ADR 0010 既有节 diff 为零 + phase-5 L75/81/83 之外的 phases/protocols 零改动。
5. 既有保持面复跑：g3-g4（A2/A2-1011/AC5 系）、spec-b1-b2（B-1）、sa7-dynamic D1/D2/D4/D5/D6、sa7 W1 零 timer 锚。

## 8. 非阻塞观察（SA1/SA3 可择机采纳，不阻断）

| # | 观察 | 建议 |
|---|---|---|
| N1 | R7 泵注册表模块级共享：同文件另一活跃 Run 的泵会在无关 settleUntil 等待中被冲刷（提前推进其延迟任务） | 顺序测试风格 + 闲泵 no-op 下无实际影响；建议 flush 仅限当前 Run 注册的泵，或在 §D7 注明「同文件并发 Run 禁止」约束 |
| N2 | hello 超时 peer 侧传输不关（依赖 hub 侧同值 HELLO_TIMEOUT 兜底，双侧 10s 竞速窗） | 已被设计登记为观察项；建议随本轮 REPORT.md 开跟踪票（不阻断） |
| N3 | §D3 peer `onConnectionLost` 伪码中 quiesceSync 对 closing/failed 分支的归属（分支内早 return 与尾部统一 quiesce 二义） | SA1 重审时补一句明确（实现细节，锚只覆盖 onConnectionFatal 面） |
| N4 | R5 界用「当前 dataOrder.length」依赖「drain 循环内 dataOrder 不增长」（当前结构性成立：嵌套 enqueueData 只重注册既有 ns） | 在 §D5 不变量 1 补一行注释钉死该假设，防未来嵌套路径引入新 ns 注册 |
| N5 | A8b「装配期响亮断言」与 types.ts L57-61「缺面 = dormant 正确降级」注释并存，存在双口径误读空间 | 把 §D8「附带注释对齐（可选）」升级为必做（runtime dormant vs 组合根装配断言的两层语义写入注释） |
| N6 | §D2 三字段重置写在 dispose/clear 两处 | 归位到 `clear()` 单点（dispose 已调 clear），防未来第三调用点漏重置 |
| N7 | `onSequenceExhausted` 直发 transport.send 绕过尾窗 ledger（不入账） | 终态路径（随后 1008 收口 + dispose 重置），无害——设计可加半句注明，避免 SA4 误报 |

---

## 9. 结论

八项修订的**架构裁决全部核验成立**（R2 显式字段 + 尾窗 ledger、R3 双侧同步静默保留 B-2d、R4 pong 专属入口与收口序、R5 有界整轮、R6 四出口双口径、R7 deferTask seam + 显式泵、R8 三层权威分层），锚映射表（§A）与文件清单（§C）与实测编译/行为面一致。reject 仅针对三处**可外科修复**的缺陷：B1（拒纳路径记账腐蚀——核心新机制的边角漏洞，CRITICAL）、B2（验收 grep 锚不可满足——会假失败或诱导破坏冻结值）、B3（A8d 改写误删两条既有协议不变量）。SA1 按第 6 节修订后重审，预计一轮通过；第 7 节为重审后的固定验证范围。

**pass 的边界说明**：本评审只覆盖设计与红锚的可满足性推演；实现与活链路验证仍归 SA4（静态门禁 + 修正后 grep/doc-diff）与 SA7（动态活链路）。

---

# R2 窄域复审（SA1 修订版 design 2026-08-30 R2）

**Date**: 2026-08-30 | **对象**: SA1 R2 修订版（in-place 修订 + 文末「SA2 反馈逐条回应」表）
**范围声明**: 仅核验 R1 报告 §6 的 B1–B3 修正清单与 R1-3 映射；非阻塞 N1–N7 采纳情况顺带核对；不扩界——除修正本身暴露的新具体缺陷（B4，见 R2.2）。
**Verdict**: **reject（窄域，单项）**——B1/B3/R1-3 修正**完整且正确**；B2 修正**形态正确但有一处可证明的残留**（B4：锚命中清单不完整 + 一处过时注释无清理属主 → 修正后锚 1/2 仍将假失败）。SA1 补一行注释同步属主即可转 pass。

## R2.1 逐项核验矩阵

| 项 | R1 要求（本报告 §6） | 修订落实 | 核验证据 | 结论 |
|---|---|---|---|---|
| **B1** | 拒纳分支 = 清幸存桶 + 回减 queuedDataBytes + **无条件** onDataShed（空桶也显影保 R1-2）；§X 契约行、§A R1-3 映射、§D6 不变量句同步 | §D1 伪码（先清桶回减、再无条件显影，注释明示「shedNamespace/dropData 空桶跳显影不可复用」）；语义要点 2「三个面不可拆」+ 双理由（负记账/声明语义）；§X enqueueData 行（含不变量）；§A R1-3 行；§D6「与 R1 的闭环」显式队列侧不变量（三处调用面满足性逐一列明）+ drain 编码错路径例外注记（结构性不可达，诚实登记） | 伪码重入安全复核：onDataShed → declareHubResync → sendControl → drain 重入时桶已清、记账已减；重入 drain 内 flushQueued 被 needsResync 门挡——同 ns 不可能再 handoff。记账终值 0 正确（incoming 未入队 + 幸存帧已弃 → 永无 onDataDispatched 减记） | ✅ 完整 |
| **B1/R1-3 映射** | §A 增补锚映射 + 契约定稿 | §D1「R1-3（B1 新增红灯契约，SA2 §5 定稿）」：构造/三断言 (a)(b)(c)/首版缺陷签名；§A 行（review-r1-r7-red、SA6 补写、A7 窗口回归面）；§C red-test 条目增「+ B1 新增 R1-3」；§V.1/§V.2 红转绿 15 例 / 全量 125 例（14+1+110 三处一致） | 构造算术复核（字面 8KiB=8192B 口径）：7×8257 + 512 + 8192 = 66,503 > 65,536 ✓ 触发，裕度 ~967B；shed 循环不运行（512 ≤ 1024）✓；断言 (a) 声明后零派发 / (b) pendingData==0（首版 −1）/ (c) 窗口不变量——判别力成立。**SA6 构造注记（非阻塞，R2-N1）**：须用 ≥8192B 字面 payload——若沿用 BLOB=8000 常量（帧 ≈8,071B），触发面差 ~520B **不达限**（65,015 < 65,536） | ✅ 完整（含一条给 SA6 的构造精度注记） |
| **B2** | 按 §1-B2 替换锚 #1/#3；#2 保留 | §D7「grep 验收锚（B2 修订）」四条：锚 1 `512 跳\|TEST_DEFER\|DEFER_MICROTASK_HOPS` → 0（= 我的替换）；锚 2 保留；锚 3 `queueMicrotask(` 排除 src/testing.ts → 恰 1 处 defaultDefer（= 我的替换）；锚 4 新增冻结值防回归 diff（对应我 §7.3）；§V.4 同步 | 锚 3 可行性实测：现命中 peer-connection.ts:36（defaultDefer）+ :638（改 deferTask 后消除）→ 修后恰 1 ✓；注释全角（ 无 ASCII ( 干扰 ✓。**锚 1/2 可行性实测否证**：现命中 11 处/5 文件——driver.ts ×7（131/400/407/408/413/467/619，均在 §D7/§C 清理面内）、peer-connection:636 ✓、peer-namespace:689 ✓、review-red:13 ✓（配套注释同步）、**spec-b1-b2-red.test.ts:90 ✗ 无清理属主**（§C 明文「SA3 零改动预期」；§D7 配套注释同步只列 review-red 头）→ 修后锚 1/2 仍 ≥1 命中，§V.4 门禁假失败。设计内嵌断言「实测清理前命中恰为 driver.ts L400-401/L407、…」**与实测不符**（漏 5 处 driver 命中 + spec-b1-b2:90；所列 L401 实不含「512 跳」） | ⚠️ **B4 残留**（R2.2） |
| **B3** | A8d 合并文本保留/重述 §17 两句冻结不变量；§V.5 增 doc-diff 核对项 | §D8 A8d 重写为合并文本；doc-diff 核对项（两短语 grep 在位 + 原段第一句逐字节保留）+ §V.5 落位 | **字节级比对实测**：合并文本首句「Connection使用 per-namespace队列和 round-robin：control/error/ACK高优先级，data每轮每 namespace最多一个。」与 protocol L490 原句**逐字一致**（blockquote `> ` 前缀除外）；「高优先级」「每轮每 namespace最多一个」均在位；原段第二、三句由语义超集覆盖（shed-to-lowWater + 控制额度精确化）✓；协议拒纳句同步 B1 语义（「同批丢弃该 namespace 幸存排队帧」）✓；§V.5 grep 实测当前即中 L490 ✓ | ✅ 完整 |
| N1–N7 | 非阻塞建议 | 全部采纳：N1 泵并发约束声明（§D7）；N2 处置建议（§D4）；N3 三分支内联 quiesceSync + 说明（§D3）；N4 假设钉死 + 依据修正（§D5——「循环体回调面零 enqueueData 调用点」与我 R1 核验一致）；N5 升级必做两层语义（§D8 + §C）；N6 clear() 单点重置（§D2）；N7 终态旁路注记（§D2） | 逐条比对落实位置与内容——无走样（N3 落实略超字面要求，见 R2-N2） | ✅ |

## R2.2 新阻塞项（由 B2 核验本身暴露——与 R1-B2 同类缺陷，范围收窄到一处）

**B4（HIGH，B2 残留）：修正后锚 1/2 仍不可满足——`test/ws-replication-spec-b1-b2-red.test.ts:90` 的过时注释无清理属主。**

- **证据**（实测命令）：`grep -rn "512 跳\|TEST_DEFER\|DEFER_MICROTASK_HOPS" packages/ws-replication` → **11 处 / 5 文件**。10 处在 §D7/§C 清理面内；唯 `spec-b1-b2-red.test.ts:90`（SA6 本轮为 B-1 放宽所写注释「重建调度经 deferTask seam（测试侧 DEFER_MICROTASK_HOPS=512）」）不在任何清理面：§D7「配套注释同步」只列 review-red 头部，§C 对该文件明文「SA3 零改动预期」。
- **后果**：SA3 按 §C 执行后，锚 1 与锚 2（`DEFER_MICROTASK_HOPS` 零命中，同文件同行）各余 1 命中 → §V.4 门禁**假失败**——与 R1-B2 完全同类的可证明验收缺陷；且设计内嵌命中清单断言（「命中恰为 driver.ts L400-401/L407、peer-connection.ts L636、peer-namespace.ts L689、red 测试头 L13」）与实测不符（漏 driver 131/408/413/467/619 与 spec-b1-b2:90；所列 L401 实不匹配模式）——SA4 复核将以错误的内置清单为基准产生混乱。
- **修正要求（一处属主 + 一处清单，SA1 改设计即可）**：
  1. §D7「配套注释同步」增：`ws-replication-spec-b1-b2-red.test.ts` L90 B-1 注释同步（「（测试侧 DEFER_MICROTASK_HOPS=512）」→ 泵描述句，与 review-red 头同款），断言与测试体零改动；
  2. §C 该文件条目「SA3 零改动预期」→「仅 B-1 注释一行同步（B4）；断言与测试体零改动预期」；
  3. 锚 1 注释的清理前命中清单改为实测全列（driver.ts:131/400/407/408/413/467/619、peer-connection.ts:636、peer-namespace.ts:689、review-red:13、spec-b1-b2:90），并注明 driver.ts:131 由「BootOptions.deferTask 注释更新」覆盖。
- **修后可行性复核（SA2 已推演）**：11 处全部落入清理面 → 锚 1/2 → 0 ✓；锚 3 → 恰 1 ✓；锚 4 冻结值不动 ✓。

## R2.3 非阻塞观察（R2 新增）

| # | 观察 | 处置建议 |
|---|---|---|
| R2-N1 | R1-3 构造裕度对 payload 尺寸敏感：字面 8KiB（8192B）裕度 ~967B ✓；若 SA6 沿用 `BLOB`=8000 常量（帧 ≈8,071B）则触发面差 ~520B 不达限（65,015 < 65,536） | SA6 补写 R1-3 时用 ≥8192B 字面 payload（或 8×A 帧/加大 W 帧）——设计契约按字面 KiB 读法成立，无需改设计 |
| R2-N2 | N3 落实超出字面要求：closing/failed 分支除 quiesceSync 外还新增 `cleanupResources()`（现实现该两分支不排 cleanup）——资源更早释放方向正确，B-2d 身份守卫保护，但无独立锚 | SA7 动态验证时对「closing/failed 态断线」路径加一次回归观察（既有 B-2d/AC6/r3-r4 锚覆盖面内） |
| R2-N3 | 锚 4 的 `git diff <base>..HEAD` 占位符未落具体基线 | SA4 执行时以 `0a18661` 代入（设计头部已载明基线）——提示而已 |

## R2.4 结论

- **B1（CRITICAL）→ 已修复**：拒纳 = 幸存面全弃 + 无条件显影，三面不可拆；记账终值/重入安全/锚判别力全部复核通过；R1-3 契约与映射完整（§D1/§A/§C/§V 四处一致，15/125 计数自洽）。
- **B3（HIGH）→ 已修复**：§17 合并文本首句与 protocol 原句字节级一致，两句冻结不变量在位，doc-diff 核对项落位 §V.5。
- **B2（HIGH）→ 形态已修，残留 B4**：四条锚本体正确（锚 3/4 已可满足），但锚 1/2 因 spec-b1-b2:90 无属主仍将假失败，且设计内嵌命中清单与实测不符。
- **裁决：reject（窄域，仅 B4）**。修正动作 = §D7/§C 各一行 + 锚 1 清单改实测全列——SA1 一轮内可完成；下次重审只需复核 B4 三处修订，其余结论以 R2.1 矩阵为准（已固化）。

---

# R3 限定复审（SA1 design 2026-08-30 R3 修订版）

**Date**: 2026-08-30 | **范围声明**: 仅核验 R2.2 列出的 B4 三处修正——①§D7 spec-b1-b2 L90 注释同步属主、②§C 允许清单限定性注释改动、③锚 1 命中清单实测全列；不重开已决范围（B1/B3/R1-3/锚 3/4 及 N1–N7 以 R2.1 矩阵为准）。
**Verdict**: **pass** ——B4 三处修正全部落实且与实测一致；四条 grep 锚修后全部可满足（推演固化于 R2.2，本轮实测背书）；顺带 R2-N3 已收口（锚 4 base=0a18661）。

## R3.1 B4 修正核验矩阵

| B4 修正要求（R2.2） | 设计落实位置 | 核验证据 | 结论 |
|---|---|---|---|
| ① §D7 配套注释同步增 spec-b1-b2 L90 属主 | §D7「配套注释同步（B4 修订后共两处…）」②（design L545）：文件+行号（L90）+ 现文本逐字引用（「重建调度经 deferTask seam（测试侧 DEFER_MICROTASK_HOPS=512）——」）+ 替换文本（泵描述句、settleUntil 等待语义表述保留）+ **断言与测试体零改动**（SA6 契约面冻结）；锚 2 注释（L532）同步标注两处注释同步依赖 | 与 worktree 实际注释（spec-b1-b2-red L90，R2 轮已读原文）逐字比对——引用准确；改动面 = 一行注释，契约面冻结声明与 SA6 §6 纪律一致 | ✅ |
| ② §C 条目「SA3 零改动预期」→ 限定性注释改动 | §C spec-b1-b2 条目（design L711）：「SA3 仅做 L90 B-1 注释一行同步（B4——…改泵描述，见 §D7 配套注释同步②）；断言与测试体零改动预期」 | 允许面收窄为单行注释同步，与 ① 相互引用一致（§D7↔§C 双处对齐） | ✅ |
| ③ 锚 1 命中清单改实测全列 | 锚 1 注释（design L522-528）：11 处/5 文件全列——driver.ts:131（归属「BootOptions.deferTask 注释更新」）/400/407/408/413（跳数链块整删）/467/619（boot/bootFanout 泵装配）、peer-connection.ts:636、peer-namespace.ts:689、review-red:13（同步①）、spec-b1-b2:90（同步②），并注「11 处全部清理后零命中」 | **本轮实测复核**：`grep -rn "512 跳\|TEST_DEFER\|DEFER_MICROTASK_HOPS" packages/ws-replication` → **恰 11 处/5 文件**，逐处与设计清单一一对应（driver ×7、peer-connection ×1、peer-namespace ×1、spec-b1-b2 ×1、review-red ×1）；锚 2 子集实测 5 处（driver 131/407/413 + 两注释同步点）——锚 2 注释只列两处注释同步依赖（driver 三处在整删块/注释更新内，锚 1 已覆盖），无失实 | ✅ |
| （顺带）R2-N3：锚 4 base 占位符 | 锚 4（design L538-539）：`git diff 0a18661..HEAD -- …` | base 已落 0a18661（与设计头部基线一致） | ✅ 收口 |

## R3.2 修后可行性（引 R2.2 推演 + 本轮实测背书）

11 处命中现全部有清理属主（driver×7 → §D7 泵装配/BootOptions 注释更新；peer-connection:636 / peer-namespace:689 → §D7 注释改写；review-red:13 / spec-b1-b2:90 → 配套注释同步①②）→ **锚 1/2 修后 → 0**；锚 3 → 恰 1（defaultDefer，L638 改道后）；锚 4 → 0（冻结值不动）。§V.4 门禁可满足。

## R3.3 结论与放行边界

- **B4 → 已修复**：三处修正逐项对上，设计内嵌清单与 worktree 实测**零偏差**；R1（B1/B2/B3）→ R2（B4）全部阻塞项闭环。
- **Verdict: pass**——设计放行 SA3 实现。放行边界（非阻塞、随行提醒）：(i) SA6 补写 R1-3 时须用 ≥8192B 字面 payload（R2-N1——BLOB=8000 常量差 ~520B 不达限）；(ii) SA7 对 N3 落实新增的 closing/failed 分支 cleanupResources 做「断线态资源回收」回归观察（R2-N2）；(iii) SA3 严格执行 §C 允许面（spec-b1-b2 仅一行注释、review-red 仅头注释，断言/测试体零改动）；(iv) pass 仅覆盖设计与红锚可满足性——实现与活链路验证归 SA4（修正后四条 grep + §V.5 doc-diff + 冻结值防回归）与 SA7（动态活链路 + R1-3 转绿）。

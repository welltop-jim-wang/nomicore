# 设计冲突门禁报告 — Issue #226（design iteration 4 recovery 后复审）

- 被审对象：`wiki/raw/task_issue-226_design.md`（SA1 design iteration 4 recovery respawn，331 行）+ 其指认的三组契约层冲突（§10.1/§10.2/§10.3 + 修订集 R1–R4）
- 任务简报：`wiki/raw/task_issue-226.md`（AC1–AC5）
- 前置产物：`task_issue-226_conflict_report.md`（前置门禁 clear，R5 复核维持；卫生注记 2 预告「隔离载体形态」为设计后复审必查项——本轮即该项裁决）、`task_issue-226_relevant_decisions.md`、`task_issue-226_sa5.md`、`task_issue-226_sa6_red.md`（红灯契约固话：判定无需修正）
- 冲突基准：`docs/adr/` 13 文件中被引 6 份的关键条款**本轮直接回查原文**（ADR-0011 L18–28/L55–60/L115–131；ADR-0014 诊断日志版 L22–26/L65–69/L238–254（含 2026-08-28 amendment）/L266–270；ADR-0008 L49–53；ADR-0009 L60–64/L95–102；ADR-0010 L27–29）+ `CONTEXT.md` 日志词条（经 R5 已复核摘录比对）
- 独立核验方式：被审设计的关键代码锚点全部亲读源码（registry.ts / create-diagnostic.ts / types.ts / sequencer.ts / runtime.ts / diagnostic.ts / close.ts / testing.ts / registry-surface.test.ts / diagnostics.ts）；三份契约测试锚文本亲读（#226 两文件全文、#149 L607–642、#155 SA7 L219–292）；红灯契约独立重跑（本轮后台 Job `bash-1`：**12 failed | 1 passed，Type Errors 0**）、绿灯基线独立重跑（`bash-2`：**30 passed**）、#155 SA7 独立重跑（`bash-2`：**6 passed**——C1 现状 GREEN）
- 裁决人：SA8 Conflict Gatekeeper（设计后复审轮）
- Worktree：`/home/wangjian/nomicore-fix-issue-226`（branch `mabf/issue-226`，HEAD `45a22f0`）
- 时间：2026-09-05T09:55Z

## Verdict

**conflict**（契约层；`requiresConflictRecheck: true`）

裁决分两层，二者结论不同，必须分开陈述：

1. **ADR 层：设计合规，0 冲突**。设计的生产架构（§2–§9：per-namespace 延迟投递泵 + create-diagnostic 路由改造 + Runtime 零改动 + 生产 wiring 延迟 wrapper）逐条对照 ADR-0011/0012/0008/0009/0010 被引条款全部 no-conflict（对照表见 §3），前置门禁登记的三个设计敏感点（隔离载体形态 / shutdown drain 预算 / 建流前归属）全部得到合规裁决（§3 对照 #1/#6/#8）。
2. **契约层：三组冲突成立，阻断实现进入**。冻结红灯契约 T8/T9/T10（+T12 联合锚）对实现空间封闭；T12/T13 冻结注入形状与 #149 AC4 同步锚互斥；#155 SA7 C1 三锚冻结缺陷 A 行为本身、与简报 AC1 语义正面冲突。SA1 的修订集 R1/R2/R3 为阻断项、R4 为推荐项——**本轮独立复核全部维持**（§1）。实现（SA3）必须在 SA6 重新固话修订契约之后进入。

## 1. SA1 三项冲突主张的独立复核（全部成立，含一处证明精度勘误）

### C1（阻断）：#226 红契约 T8/T9/T10 顺序锚 + T12 联合锚对任意实现不可满足 — 成立

本轮独立重建调度序核对锚文本（T8 L459–474 / T9 L494–505 / T10 L520–532 / T12 L113–131），不沿用 SA1 推导：

- **T8/T10**：结算标记 push（`create:settled`/`open:settled`）与 `indexOf` 顺序断言之间为**纯同步段**（`okLease` + 同步 expect，零调度点）。顺序断言通过要求存储完成标记（`initStream/emit/ensure:<ns>:end`，由测试自供 Host 在 seam 调用内同步 push）**在场且晚于结算标记**。穷举存储位置：槽内/窗口内同步 → 早于结算标记（红，现状）；微任务 deferral → FIFO 下要么早于结算标记要么在场性缺席（`indexOf === -1`，非负索引 < -1 恒假）；排入被测结算链 → 墙钟锚（createMs<120 / openMs<75）翻红；macrotask → 断言时缺席（测试函数从结算到断言全程微任务链，不回事件循环）→ -1 翻红。封闭。✅
- **T9**：push 与断言之间唯一间隙 = 一次已 settle Promise 的 `await createPromise`（微任务 hop）。macrotask drain 不可能在微任务 hop 内执行；实现侧微任务若在 shutdown 结算链内排队则必早于 push 之前的续段或使 shutdown 等待存储（墙钟 <100 翻红）。封闭。✅
- **T12**：顺序锚要求 `emit1:start` **在场且晚于 `notify:2`**，墙钟锚要求 `gap < 50`（注入阻塞 100ms）。emit1 执行落点穷举：早于 notify:2 → 顺序锚红；落 [notify:2, w2Settled 测量] 内 → 必在 w2 结算链或其前的微任务内 → `w2Settled = Date.now()` 在 100ms 块之后 → gap ≥ 100 → 墙钟红；落 [w2Settled 测量, 断言] 内 → 该区间零调度点（push/readRoot/gap 判均为同步）→ 不可达；macrotask/缺席 → -1 → 顺序锚红。**联合锚封闭**。✅
- **T13（证明精度勘误，不改结论）**：SA1 §10.1 称五锚「对实现空间封闭」。本轮构造出一条**病态但可写出的** Runtime 接线可使 T13 单独翻绿：把待发 emission 缓冲、并在 sequencer tail 的 noop-hop 再跳一拍后 flush（`this.tail = settled.then(noop, noop).then(flush)` 形），使 emit1 恰落在测试 `push('close:settled')` 之后的 `await expect(closePromise).resolves` hop 内——closeMs 已测得（小）、`emit1:end` 在场且晚于 close:settled，两锚同绿。**但**：同一接线在 T12 下 flush 必然晚于 w2 调用方续段（注册序：enqueue 内 noop→flush 链先于调用方 await 注册，settled resolve 后调用方续段先于 flush µtask）→ `emit1:start` 断言时缺席 → T12 红；且任何此类 Runtime 侧 deferral 使 #149 AC4 `emitCalls===2`（同步断言，L628–639 零 yield）得 0/1 → #149 红（即落入 C2）。⇒ **冻结契约作为整体仍不可满足，R1/R2 阻断地位不变**；勘误仅限于「T13 单锚逐一封闭」的表述精度，登记供 SA6 修订时知悉（修订后的到达 poll 形状天然免疫该病态接线）。

### C2（阻断）：T12/T13 冻结注入形状与 #149 AC4 同步锚互斥 — 成立

- #149 `runtime-root-schema-diagnostic-red.test.ts` AC4（L610–642，本轮亲读）：两次 `await mutateData` 后**零 yield** 同步断言 `expect(emitCalls).toBe(2)`——emitter 为注入 seam 直连（构造期一次成型）。
- T12/T13（runtime 红契约 L109/L142）把慢同步 emitter **直接注入同一冻结 seam**，不经任何 Registry wiring。翻绿唯一途径 = Runtime 自身把 emit 调用移出「槽释放 → 调用方续段」窗口；而任何这样的移动（微任务多跳或 macrotask）都使 emit 调用晚于 #149 的同步断言点 → `emitCalls` 0/1 → #149 红。同一 Runtime 代码不可同时满足。✅（本轮将 §C1 勘误中的病态接线也纳入穷举：其 deferral 恰构成 #149 红例，互斥性无例外。）
- **R2 修订方向合规**：注入形状改「生产 wiring 同构」wrapper（testing 助手导出，seam 字段名零新增——测试助手非 seam 成员，不触 §7.7 冻结面）；#149 直连注入不经 wrapper → 零漂移。修订后修复前仍红（无 wrapper 时同步直发 → 墙钟/顺序锚红）。✅

### C3（阻断）：#155 SA7 C1 三锚冻结缺陷 A 行为，与简报 AC1 正面冲突 — 成立

- 锚文本本轮亲读 + 独立重跑（现状 6 passed）：L243–246（B 结局同步断言恰 1 条 `unattributed` 丢弃、事件不含 namespaceId）、L265（`namespaces/NS_B` 目录 **不存在**）、L279–281（全程丢弃恰 1、全 unattributed）。
- 简报 AC1 明文：建流前 Persistence 等结局「不再被无归属通道确定性丢弃，并以正确 namespace 归属进入诊断流」。B 的 `DocCreateOperationalError` 即该类结局 → 修复后 B 以 NS_B 归属落自己的流、零 unattributed 丢弃、目录存在 → 三锚必然翻红。语义正面冲突，非时序细节。✅
- 全 repo `unattributed` 期望锚检索（本轮重跑）：反向锚唯此一文件（#226 契约自身 `unattributedDrops===0` 与修复同向）。✅
- **R3 修订方向合规**：期望改为 B 归属落盘（attempt：stage `transaction` / code `NAMESPACE_CREATE_FAILED` / result `rejected`）、B 目录存在、全程 0 unattributed；A 流干净面（恰 genesis+#17、segment 无 B marker、A replay complete）保持——攻防价值（跨 ns 误归因不可达）强化而非削弱。修订属全量门必红面的随票修订，归 SA6 重新固话。✅

## 2. 红灯契约与基线现状（本轮独立重跑证据）

| 套件 | 本轮实测 | 判读 |
|---|---|---|
| `registry-issue-226-red.test.ts` + `runtime-issue-226-red.test.ts` | **12 failed \| 1 passed (13)，Type Errors 0**（T7 GREEN 对照唯一通过；T12 gap 101ms、T13 closeMs 109ms 先触墙钟锚） | 与 SA5/SA6/verify2–6/design 各轮一致——红灯稳定复现 #226，非环境噪声 |
| `registry-create-diagnostic-red.test.ts`（#150，16）+ `runtime-root-schema-diagnostic-red.test.ts`（#149，14） | **30 passed (30)** | 环境健全；#149 AC4 `emitCalls===2` 现状绿（C2 互斥的「另一端」在場） |
| `diagnostic-replay-host-lifecycle-sa7.test.ts`（#155 SA7，6） | **6 passed (6)** | C1 用例现状 GREEN——三锚今日通过 = 冻结缺陷 A；修复后必翻红（C3 实证） |

## 3. 设计 × ADR 逐条对照（ADR 层 0 冲突）

| # | 设计决策 | ADR 条款（本轮回查原文） | 裁决 | 依据 |
|---|---|---|---|---|
| 1 | **隔离载体 = amendment L250 选项 (a)**：泵只搬调用点（macrotask drain），adapter 每 record 同步单条 append 语义一字不动，无 batch/周期 flush/fsync | ADR-0014 amendment L250（调用点必须在 sequencer slot 之外/释放后）/ L252（queue/batch 切片须另定义四类语义） | no-conflict | L252 义务附着于「以逻辑 writer queue **替换**同步 append」的切片；本设计不替换 adapter 存储语义，属 L250 明文授权的搬移路径。即使按严格读法把泵视作「调用方侧有界队列」，队列满（per-ns 256、drop-newest、保序——L240 精神）与 close/shutdown（零耦合、天然有界）语义亦已在设计中定义；flush/fsync 不适用（无 batching）。前置门禁卫生注记 2 的「必查项」就此裁决：选项 (a) 合规 |
| 2 | **被拒 create 建 genesis-less 流**（`initStream(ns, undefined)`，不伪造 genesis） | ADR-0014 **L22**「genesis 未成功写入时 stream 仍可记录诊断事实，但不得声称完整重放」+ L24（重试建流 genesis 只代表该时点，不得伪称连续） | no-conflict | L22 是比设计所引 L24 更直接的授权条款（建议 SA3 实现注释补引）：无 doc 的被拒 create 诚实缺席 genesis、流仅记 attempt 事实——恰为条款原文覆盖的形态；R3 修订锚只要求 B 目录/attempt 记录，不要求 replay complete（replay 期望仅在含 genesis 的 A 流） |
| 3 | **per-ns 延迟泵**：槽内 O(1) 入队、macrotask drain、有界 drop-newest、全程非抛、per-ns 单飞 | ADR-0011 L20–25（排队/丢弃/关闭失败不得改变业务结果；队列溢出可丢弃）/ L24（emitter seam non-throwing 有界）/ L123（不得引入第二个业务排序机构） | no-conflict | 泵只序诊断投递、不序业务；入队 O(1) 非抛不阻塞；溢出丢弃在「日志允许缺失」的 best-effort 授权域内（见注记 N1） |
| 4 | **drain 内经冻结 seam 调 Host**（`initStream`/`runtimeEmitterFor`/emit 成员名零新增；wrapper 实现既有 emitter 接口：同步、void、不 throw） | ADR-0011 L117（emit 立即接收 detached record、不阻塞不 throw 不返回 durability promise）；types.ts L720–724 冻结 seam 形状（本轮亲读） | no-conflict | seam 形状与字段名零漂移；wrapper 的 O(1) 入队即 seam 语义本身；真实存储延迟留 Host/adapter 侧（与现状同构，只是调用栈位置搬出业务路径——amendment L250 的目的本身） |
| 5 | **槽内组装语义 emission（载荷/observedAt 捕获点同位）+ 泵只搬运 detached record** | ADR-0011 L69–77（输入零访问/复用既有安全快照/不建第二套序列化）+ L127（sequence 分配与 emitter 接收可在 committed 事实之后，emitter 不被 await） | no-conflict | 组装点同位 ⇒ AC2 纪律与 observedAt 单源（DC-3）零漂移；ADR-0014 L67「writer 准备 append 时才分配 sequence」由 adapter 在 drain 内 append 时兑现，不受投递延后影响 |
| 6 | **shutdown 与泵零耦合**（不清泵、不等待、不注册 disposer；迟到 drain 落 Host `manager-closed` 丢弃桩） | ADR-0011 L129（不得阻塞 close/shutdown；Host 可 best-effort drain，Registry/Persistence 停止不得无限等待 sink）/ ADR-0009 L95–102（shutdown 公共契约） | no-conflict | 「不等待」是「不得无限等待」的平凡满足；shutdown 公共契约（同 Promise、聚合错误、停止接纳）零改动；迟到投递的收口走既有 Host 词表（本轮亲读 diagnostics.ts L74–76/L130+） |
| 7 | **Runtime 包零生产改动**（B3 由 wiring wrapper 解决；#149 直连注入不经 wrapper） | ADR-0008 L51（槽内步骤清单）/ #132 修订（四公共方法同 FIFO 完整槽序不变） | no-conflict | 槽结构、fatal/close 语义、emit 调用点全部不动；生产 emitSlot 调 wrapper（O(1)）即移出关键路径——与 #149 冻结锚正交（§1 C2 论证） |
| 8 | **id 耗尽 fatal 零诊断发射**（§7.1 边界裁决：所有候选已证明属他人，任选即伪造归属） | ADR-0010 L28（8 次重试耗尽 `committed:false` fatal）/ ADR-0014 数据键控原则 | no-conflict（边界登记） | 无任何 ADR 条款要求为无归属终局发明无 ns 落盘面；不伪造归属与 Host 侧「绝不伪造归属」词义一致。维持 SA1 的登记：留待后续 SA8 recheck 复核（非本轮阻断项） |
| 9 | **词表零新增 / 词法路由判据静态**（resolver 在场与否） | ADR-0014 L70–89（operation/result/stage 封闭词表）/ L268（冻结项变更须新 stream generation） | no-conflict | 只改同一 record 的传输通道与时机，不改 record 内容面（AC5 内容锚逐字段维持即证明）；无新 stream generation 触发点 |
| 10 | **泵调度用全局 `setImmediate`（不经注入 scheduler）** | `registry-surface.test.ts` §2.M 三正则（本轮逐字符核对 L279–284）：`setTimeout|setInterval|clearTimeout|clearInterval`（裸/globalThis 两式）+ `Date.now` ——**均不含 setImmediate**；`testing.ts` L77–110 注入 scheduler 为纯 Map fake（仅 advanceBy 触发） | no-conflict（守卫面） | 泵源码裸调 `setImmediate(` 不命中任何守卫；注入 scheduler 结构性不可承载泵（#226/#150/#155 契约测试均不 advanceBy，经其调度的泵永不触发）；registry 为 node 服务端部署面（yjs-server），setImmediate 恒在。**R4（守卫测试注释固化该许可）为推荐项，随 SA6 一并落地** |

## 4. 卫生注记（非冲突，登记移交）

- **N1（泵溢出静默丢弃的健康上报）**：ADR-0011 L25「实现应尽力上报 dropped count」为 best-effort 措辞（「应尽力」），非硬门禁；设计以「Registry 侧无日志健康通道（ADR-0009 L95 v1 无公共事件订阅）」为由静默丢弃，可接受。建议 SA3 在 diag-pump 内留一个零成本内部计数（不进公共面），为未来健康通道预留——非阻断。
- **N2（T13 单锚证明精度勘误）**：见 §1 C1 末段。结论与修订集不变；SA6 采纳 R1/R2 的「到达 poll + 顺序」形状后，病态接线自然失效（poll 让出事件循环 ⇒ macrotask/微任务 drain 均可被观测到，判据回到语义本体）。
- **N3（引用补强）**：设计 §3.2.2 论 genesis 缺席时建议补引 ADR-0014 L22（比 L24 更直接），SA3 实现注释同。
- **N4（genesis-less 流的工具行为验证点）**：`readStreamStrict`/`replayNamespaceDiagnosticLog` 对仅含 attempt 的流的读取行为（status/issues 形态）应由 SA3/SA6 在 R3 修订锚定范围内实证（R3 现形状只锚目录存在 + attempt 可读，不锚 replay complete——保持该边界即可）。
- **N5（#150 相邻面零漂移）**：legacy Host（无 `runtimeEmitterFor`）全程同步共享通道逐字节现行（设计 §3.2 路由表 + 本轮判据形态核对：`waitAttempts`/`expect.poll` 为主，两处 `flushMicrotasks` 锚定业务槽推进与「恰一条」计数，与诊断到达时机正交）——SA3 回归时保持该路径为第一验证面。

## 5. 裁决与移交

1. **Verdict：conflict**（契约层三组冲突 C1/C2/C3 成立；ADR 层设计 0 冲突）。`requiresConflictRecheck: true`。
2. **修订集裁定**：**R1/R2/R3 为阻断项**（红灯契约 T8/T9/T10 顺序锚改「到达 poll + 顺序」；T12/T13 注入形状 wrapper 化 + `namespace-runtime/testing` 助手导出；#155 SA7 C1 三锚改 #226 后语义）——与 SA1 提请一致，本轮独立复核维持，且 §10.4「修订后修复前仍红」的证明成立（修复前槽内同步执行 → 存储标记早于结算标记 → 顺序锚仍红；无 wrapper → 墙钟仍红；B 落 unattributed/无目录 → 修订锚仍红）。**R4 为推荐项**（守卫注释固化 setImmediate 许可）。
3. **路由**：SA6 重新固话 R1/R2/R3 修订契约（R4 一并）→ SA8 conflict recheck（对修订后契约与本报告 N2/N4 复核）→ 方可进 SA3 实现。设计 §2–§9 的生产架构本体无需返工，ADR 合规面已由本报告 §3 放行。
4. **本轮边界**：零产品代码改动、零测试/守卫改动（红灯契约两文件与 #149/#155 测试仅读）；唯一写入 = 本文件。测试运行全部经后台 Job（`bash-1`/`bash-2`），完整输出见 Job 记录，关键计数摘录于 §2。

Verdict: **conflict** — `requiresConflictRecheck: true`

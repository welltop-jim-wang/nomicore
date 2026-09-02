# Spec 终审报告 — issue #161 round 2（PR #165 review 八项修订 + F1 增补）

Verdict: **clear**

**审查员**：Spec review 终审（独立于本轮 SA1/SA2/SA5/SA6/SA3/SA4/SA7 所有产出） | **日期**：2026-08-30
**审查范围**：`git diff 0a18661..HEAD`（基线 `0a18661` → HEAD `06db53c`，3 个实现 commit：`4bc57dd` R1–R8 实现 + 15 红锚转绿、`218ca3a` SA7 D1–D5 冻结动态锚、`06db53c` F1 §D9 wipe-credit 修复；合计 25 文件 = src 8 + test 8 + docs 3 + wiki 6）
**对照基准**：直接用户请求（PR #165 review 八项修订 + F1 remediation + 冻结红契约 + 动态验证 + R8 权威文档）；SA1 绑定设计 `task_ws-replication-review-revisions_round2_design.md`（R3 主体 + R4/§D9 F1 增补，SA2 裁决链 R1 reject → R2 reject → R3 pass → R4 pass）；SA5 分析 / SA6 红灯契约（15 例，基线 15 failed / 110 passed）；SA7 动态报告（含 F1 复测 pass）；wire contract `docs/protocols/instance-replication-v1.md`。
**方法**：全部 8 个 src 文件逐行读终态 + 关键 hunk diff 复核（R1/R2/R5/F1 的 frame-io、R6/F1 的 update-channel、R4/R7/F1 的 peer-connection、R3/F1 的双侧 namespace、R2 的 types/defaults/validate、R7 的 harness/driver）；测试断言面直读（review-red 15 锚、sa7-round2 冻结 D1–D5、g3-g4 五项校准 diff、spec-b1-b2 B4 注释）；协议/ADR/phase 文本逐处 sed/grep 核验；终审亲跑全部验证命令（§六，非转述报告）。

---

## 一、八项 PR #165 review 修订逐项核对（8/8 落地）

| # | 修订要求 | 实现证据（文件 : 机制，终审亲读） | 锚/验证 | 结论 |
|---|---|---|---|---|
| **R1** | cap/low-water 严格接纳：shed 循环后仍越限即拒纳 + 显影，单帧超限同路径，不断点接纳 | `frame-io.ts` enqueueData L170-206：触发面 → shed 循环 → **再判定** `pipelineBytes()+bytes > max` → 拒纳分支**先清该 ns 幸存桶（逐帧回减 queuedDataBytes、`bucket.length=0` 空桶保留注册）→ 无条件 `onDataShed(ns)`（空桶亦显影）→ ensureCheckpoint → return false**；单帧超限与缓冲主导同一判定，无特例分支；「断点接纳」生产叙事零残留（grep 实证——仅红锚文件的历史锚名合理保留） | R1-1/R1-2/R1-3 三锚亲跑绿；R1-3 为 B1 契约（声明后零该 ns UPDATE + `pendingDataCount===0` + A7 窗口不变量），构造用 8192B 字面 payload 且含 R2-N1 精度自检断言（review-red L414） | ✅ |
| **R2** | 控制帧真实有界保留额度 | `types.ts:33` `maxQueuedControlBytes` 必填（11 字段+1）+ `defaults.ts:29` 缺省 `8*1024*1024` + `validate.ts:118/157` `positiveSafeInteger` + `≥ maxBootstrapBytes + PROTOCOL_OVERHEAD_BYTES(128)` 构造期响亮校验 + harness `CONTRACT_LIMITS`/`WsReplicationLimits` 镜像 + api.test-d 形状断言；`frame-io.ts` 尾窗 ledger 三字段（L137-139，clear() 单点重置——N6）+ `emitOne(message, plane)`（L409-434，N7 注记在位）+ runCheckpoint 裁剪（`flushed>0` 防御，L283-289）+ 规则 C 析取（L295-302：控制独立额度 ∨ 总量+无可 shed 面）+ `sendControl` 补 `ensureCheckpoint`（L162） | R2-A2a 亲跑绿（16×8KiB 控制风暴 → exhausted 恰 1）；A2-1011 既有锚经校准 #5 精确保留总量分支判别（§四.5） | ✅ |
| **R3** | GOAWAY/blocked/连接收口同步静默（双侧） | hub：`hub-namespace.ts` onConnectionClosed L564-574 同步段（清 openWaiters + `quiesceSync()` L580-587：摘订阅置 undefined + 非 terminal 投影 `closed`），异步尾巴（drainPendingApplies → closeSessionAndRelease → 兜底 setState）不变；peer：`peer-namespace.ts` onConnectionFatal L634-642 / onConnectionLost L611-631——closing（先 settleCloseMemo）/ failed / 活跃态三分支**各自内联** quiesceSync 于迁移之前（N3 钉死形态），终态分支跳过；B-2d 守卫结构性保持（quiesceSync 置 undefined → 迟到 `closeSessionAndRelease` 捕获 undefined 必跳过退订——字段已空强于比对后置空） | R3-1..R3-5 五锚亲跑绿；校准 #1（R3-2 引用先捕获）/#2（R3-5 inject 后补 settle）经 diff 亲读——纯测试力学调整，三断言谓词零改动 | ✅ |
| **R4** | pong 超时关传输 + 代际安全 | `peer-connection.ts` onPongTimeoutDetached L631-647：`stopping`/非 ready 双重入守卫 + ①stopLivenessNow → ②clearGoawayDrain（GOAWAY 互斥）→ ③unsubscribeTransport → ④`close(1001,'pong-timeout')`（closed 守卫）→ ⑤epoch+1 → ⑥onTemporaryFailure（投影 backoff）→ ⑦**投影后** dispose（onDataShed 声明经非 ready 门 → 零出站噪声）；liveness 回调改接 L348；公共 `onTemporaryFailure` 其余三入口（dial 抛错 L681 区域 / hello 超时 L681 / onClose L564）行为零改动 | R4-1/R4-2 亲跑绿；D3（drain 窗口 × pong 互斥 + 迟到 deadline 幂等）亲跑绿 | ✅ |
| **R5** | round-robin 有界整轮扫描 | `frame-io.ts` drain L231-273：`consecutiveSkipped` 循环顶界检查（`>= dataOrder.length` **当前值**）、blocked ns `+1` 跳过不终止、成功派发归零；终止性成立（每迭代或推进游标、或收缩 dataOrder（空桶注销）、或消耗一帧——三者单调，界随收缩只收紧）；N4 假设（循环体零 enqueueData 调用点）与实现一致（循环体回调面仅 onDataDispatched/emitRaw）；无 blocked ns 时计数恒 0——与基线逐行为等价（AC5-RR 保绿即证） | D3 改写强锚（W/X blocked + Y 就绪同轮派发 emissions==2）+ 全阻塞有界伴生锚亲跑绿 | ✅ |
| **R6** | pending handoff 计入溢出判定（count/bytes 双口径） | `update-channel.ts`：`pendingDataBytes` 字段 L43 + overflows() L164-171（count 口径 `inFlight+queued+pendingDataCount(+uncounted)`、bytes 口径 `queuedBytes+pendingDataBytes(+uncountedBytes)+ΣinFlight+incoming`）+ 四出口对称（handoff L187-188 `+` / onDataDispatched L140-141 `−` / onDataShed L151-152 清零 / teardown L245-246 清零） | R6-1/R6-2 亲跑绿（第 9 笔即溢出 + RESYNC ≥1） | ✅ |
| **R7** | 确定性 seam + 去 512 跳魔法 | 生产：`peer-connection.ts` requestRebuild L669 `this.deferTask(...)`（L666-668 注释改写为泵描述；缺省 `defaultDefer` L35-37 单次 queueMicrotask，行为等价）；driver/harness：`DEFER_MICROTASK_HOPS`/`TEST_DEFER` 跳数链整块删除 → `makeDeferPump()`（入队零隐式执行、flush FIFO ≤1000 轮防自旋、pendingCount）+ `registerDeferPump` 模块级注册表 + `settleUntil` 谓词先行冲刷（①谓词 → ②flush → ③再查；`settle()` 永不冲刷——L217-220 注释明示）；boot/bootFanout 双处 `opts.deferTask ?? pump.defer` + `Run.deferPump` 暴露 | R7-1 latch 锚亲跑绿；四条 grep 锚终审亲跑全过（§六） | ✅ |
| **R8** | 权威文档四缺口 + 陈旧叙事 | 见 §五（A8a–A8e + ADR + N5 逐处核验） | 两条叙事 grep + B3 doc-diff 终审亲跑全过 | ✅ |

**结论：八项修订全部实现且与 SA1 绑定设计（含 SA2 R1–R4 修正 B1–B4）逐项对位。**

## 二、F1 remediation（§D9 wipe-credit）核对

**要求**：修复 SA7 D2 发现的滞回接纳帧 `pendingDataCount = −1` 负记账（R6 溢出口径与 A7 窗口门双低估），且不破坏 `218ca3a` 冻结破坏性锚（L403/L407 派发前 pending===0、L430 派发后 ≥0）。

**实现证据（终审亲读）**：
- **判定回传链**：`enqueueData → boolean`（frame-io L170/196/205 三点：拒纳 false / 接纳 true）；`hub-namespace.ts:128/692-696`、`peer-namespace.ts:129/780-784` `enqueueUpdate`/`sendData`/`enqueueUpdateFrame` 布尔透传（超限早退 → false 防御双门）；`peer-connection.ts:509-520` sendData 三分支（outbound undefined / 非 ready 显影后 / namespaceId 缺失 → false；ready → 透传）；**`hub-connection.ts:181` 零文本改动**（实测确为表达式体 `(message) => this.outbound.enqueueData(...)`，布尔自动回流——DENY 保持，`git diff` 0 行实证）。
- **wipe-credit 记账**（update-channel L185-207）：increment-before（先计保留——无 wipe 路径派发减记命中已计帧，零瞬态负值）→ `accepted` 回传 → `!accepted` 早退（拒纳已清零含先计，一致）→ `accepted && needsResync 翻转` 双条件信用登记（**不重计 pending**——保冻结锚 L403/L407 = 0 观测面；「翻转即 wipe」判别精确：handoff 入口 needsResync 恒 false（deliver 首行守卫 L71 + flushQueued 循环条件 L214），enqueueUpdate 同步栈内唯一置位源 = 本 ns onDataShed）；`onDataDispatched` L135-145 **信用消费先于减记**（保 L430 ≥ 0）；`onDataShed` L150-157 / `teardown` L243-253 credit **双清零**（R4-N2：跨代正确性）；三门（deliver L73-76 / flushQueued L213-218 / overflows L164-170）读 `pending + uncounted` 双口径（R4-N1 精确负载，零 off-by-one）；R4-N1 排除引理以 binding 注释入 handoff L192-198（引理地基 = 窗口门保留 pendingDataCount 于和式——两门实测在位）。
- **SA2 深攻角落复核**（终审独立推演）：未计帧同栈派发先于信用登记的路径经引理结构性排除——wipe ⟹ shed 循环运行且 victim=本 ns ⟹ 本 ns 桶非空 ⟹（每 enqueueData 末尾同步 drain 的归纳不变量）paused ∨ 本 ns 窗口满；handoff 三和门已通过 ⟹ 窗口未满 ⟹ **paused** ⟹ 同栈 drain 数据循环跳过 ⟹ 信用先登记。victim=他 ns 时 onDataShed 按路由只触他 ns channel，本 channel needsResync 不翻、先计保留——两条路径均正确。

**验证**：冻结 D2 锚文件字节不变（`git diff 218ca3a..HEAD` = 0 行）下 **6/6 全绿**（终审亲跑）；F1 commit 范围恰 5 src + 2 wiki（name-only 实证，零测试夹带）。

**结论：F1 remediation 落地且为冻结锚约束下的唯一自洽解（§9.0 推论经锚文复核成立）。✅**

## 三、冻结红契约核对（15 锚 + 冻结面）

| 项 | 证据 | 结论 |
|---|---|---|
| 15 例红锚（SA6 契约：R1-1/R1-2/R1-3/R2-A2a/R3-1..5/R4-1/R4-2/D3 改写/R6-1/R6-2/R7-1） | 终审亲跑 review-red + sa7-hardening-dynamic → **Tests 22 passed (22)**（15 红锚 + 7 既有），Type Errors no errors，exit 0 | ✅ |
| 冻结破坏性锚（SA7 `218ca3a` L377-431，D2 唯一红） | 文件 vs 218ca3a **零 diff**；亲跑 6/6 全绿（D2 转绿 + D1/D3/D4/D5 保绿） | ✅ |
| 锚不可变性（SA3 五处校准之外零改动） | 五处校准逐一 diff 亲读：#1 R3-2 companion 三断言谓词零改动（仅引用先捕获）；#2 R3-5 断言零改动（仅补 settle 时序）；#3 D2 交错锚判别属性不变（ret===2、seq===3，临时窗口满构造）；#4 AC5-SHED **更强**（`>48KiB ∧ ≤64KiB` 不变量对替代旧不可满足断言，shed 信号断言零改动）；#5 A2-1011 判别分支精确保留（数据恒 ≤ max + 控制帧抬总预算、无可 shed、单检查点 → 1011）。无 unjustified calibration | ✅ |
| 冻结值/纪律 | `512 * 1024` 冻结缺省 diff = 0；零 `.skip/.todo/.only`、零 `readFileSync` 测试断言、零 real `setTimeout`（grep 实证） | ✅ |

## 四、动态验证（终审独立复跑，全部亲测非转述）

| 命令 | 结果 |
|---|---|
| `npx vitest run packages/ws-replication/test/ws-replication-review-revisions-r1-r7-red.test.ts packages/ws-replication/test/ws-replication-sa7-hardening-dynamic.test.ts` | Test Files 2 passed；**Tests 22 passed (22)**；Type Errors no errors |
| `npx vitest run packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts` | Test Files 1 passed；**Tests 6 passed (6)**（D2 破坏性锚绿） |
| `npx vitest run packages/ws-replication` | Test Files 17 passed；**Tests 131 passed (131)**（= SA6 基线 110 + 15 红转绿 + SA7 六锚——R4-N3 口径恰合） |
| `pnpm test`（整仓 = vitest run --typecheck） | Test Files **170 passed (170)**；Tests **2002 passed (2002)**；Type Errors no errors；exit 0 |
| `npx tsc --noEmit -p tsconfig.typecheck.json` | exit 0 |
| `git diff --check 0a18661..HEAD` | 零输出 |

## 五、R8 权威文档逐处核验（终审亲读原文）

- **A8a**：protocol §2 身份投影句逐字在位（「只消费 Upgrade 认证产生的受信身份…同步 TypeError…不得降级」）✅
- **A8b**：§17 L494 三可选能力面段（bufferedAmount 缺面视为 0 / ping/onPong 缺面 dormant + **生产组合根装配期响亮断言 + issue #164 指针**）✅
- **A8c**：§18 L524 工程缺省 `pingIntervalMs = 30_000`、`pongTimeoutMs = 10_000` + `pongTimeoutMs < pingIntervalMs` 构造期 TypeError + pong 超时 close(1001) backoff ✅
- **A8d（B3 合并文本）**：§17 L492 原段首句「Connection使用 per-namespace队列和 round-robin：control/error/ACK高优先级，data每轮每 namespace最多一个。」**逐字节保留为段首**（终审 grep 实测两冻结短语均在位且位于 L492 段首）；终态口径句追加（pipeline = queued+buffered、shed 仅排队侧、严格接纳 + 同批丢弃幸存帧 + needs-resync 显影、maxQueuedControlBytes 缺省 8MiB/校验、尾窗归因、checkpoint = max(1, floor(ackTimeoutMs/100))、有界整轮扫描）；校验清单 +2 行（`maxQueuedControlBytes >= maxBootstrapBytes + protocol overhead`、`maxQueuedBytesPerConnection >= highWater`）✅
- **A8e**：phase-5 L75「切片 3/4 落地锚定（冻结词汇）」/ L81「needs-resync 通知归属」/ L83「切片 3/4 冻结词汇（补充）」三处终态化改写，冻结词汇正文逐字保留（含「有界 **16** 项冻结常量」）✅
- **ADR 0010**：`git diff 0a18661..HEAD` **仅文末 +13 行**（「issue #161 round 2 修订」节，指针型登记、protocol 为唯一规范源），既有修订节零改动 ✅
- **N5 必做**：`types.ts` facets 注释两层语义（运行时 dormant vs 生产组合根装配断言）✅；`defaults.ts` L32-34 注释指向 protocol §18 ✅
- **叙事 grep**：`红灯|SA6 契约|SA8 放行|撤销 round` 与 `round-1|round 1` 在 docs/phases + docs/protocols 均 **0 命中**（终审亲跑）✅

## 六、Scope 与门禁核查

- **范围**：25 文件 = src 8（全部在 §C ALLOW LIST）+ test 8（ALLOW，含 SA6 owned 产出与登记的 5 处校准）+ docs 3（ALLOW）+ wiki 6（任务工件）；**DENY 全保持**——`hub-connection.ts` diff 0 行（§D9 零文本改动条款成立）、`liveness.ts`/`round-engine.ts`/`fence-watchdog.ts`/`error-mapping.ts`/`index.ts`/跨包/apps 零命中；blacklist 零命中。F1 commit（218ca3a..06db53c）恰 5 src + 2 wiki，无夹带。
- **R7 四条 grep 锚（终审亲跑）**：锚 1 `512 跳|TEST_DEFER|DEFER_MICROTASK_HOPS` → **0**；锚 3 `queueMicrotask(` 排除 testing.ts → **恰 1（peer-connection.ts:36 defaultDefer）**；锚 4 `512 * 1024` 冻结值 diff → **0**（锚 2 为锚 1 子集）；B4 两处注释同步（review-red L13-14 / spec-b1-b2 L90）逐字在位。
- **兼容面**：`maxQueuedControlBytes` 必填字段的全部字面量构造点（harness/api.test-d）已同步；`Partial<ReplicationLimits>` 用户零破坏；全仓 tsc 0 错双证。
- **CI 触发性**：`pnpm test` = vitest run --typecheck，include 覆盖 `packages/*/test/**`——本任务全部测试文件结构性全覆盖（commit 未 push 属总控发布阶段事项，见 §七）。

## 七、非阻塞观察（记录在案，均不构成 blocker）

1. **REPORT.md round-2 重写未入库**：工作树有未提交改写（实现阶段控制器指令禁改、交付归总控）——**commits through HEAD 不含 REPORT.md**，最终发布前应由总控随发布 commit 一并落地。
2. **后续阶段工件未提交**：dispatch 行（SA4 F1 复审 / SA7 F1 复测 / AC gate / 双轴终审）、SA4 F1 复审节、SA7 F1 复测节、本报告均为工作树/未跟踪状态——属本轮收尾 commit 的正常时序，归总控。
3. **设计 §V.2 陈旧计数**：「包级 126 例」为 §D9 首版数字，实际口径 131/2002（R4-N3 已登记修正，验收按 131/2002 执行——终审亲跑恰合）。
4. **D5 hello 超时孤儿传输跟踪票**：设计 §D4 N2 建议开票、SA7 D5 动态锚已证实现状（peer 侧不关 + hub 侧 HELLO_TIMEOUT 兜底 + 恢复无碍）——AC 门禁已裁决开跟踪票 **#168**（不 waive），非实现缺陷，本审查无异议。
5. **CI 动态日志摘录**：PR #165 最新绿 run（33209997984）早于 `4bc57dd`（SA3 按指令未 push）——push 后补摘录归总控发布阶段；本地全量 2002/2002 已先行。
6. **SA4 非阻断备注**（设计文案「三 return 点」计数、peer-conn `namespaceId===undefined` 防御分支、§D6 shedNamespace 措辞次序）——终审复核均无行为差，维持非阻断。

## 八、结论

**Verdict: clear** —— PR #165 review 八项修订（R1–R8）、F1 remediation（§D9 wipe-credit）、冻结红契约（15 锚全绿 + 冻结 D2 锚字节不变转绿 + 五处校准全部 justified）、动态验证（D1–D5 + F1 复测，包级 131/131、整仓 2002/2002）与 R8 权威文档（A8a–A8e + ADR append-only + N5）在 `0a18661..06db53c` 全部落地且经本审查员独立源码亲读与全量命令亲跑证实；范围零蔓延、DENY/blacklist 零触碰、无 unjustified calibration、无疑似错误行为。无具体 blocker；§七所列均归总控收尾/发布阶段处置。

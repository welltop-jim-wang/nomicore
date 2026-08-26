# SA2 攻击评审报告 — registry-idle-plugin-shutdown rev1 设计（issue #112 round 2）

**Date**: 2026-08-26
**Verdict**: reject（1 项 HIGH 需 SA1 修订设计文本后复审；P1/P2/P3 的机制主体经独立源码亲核 + 双实验证实成立，修订面窄、路径明确）

**评审方法声明**：本评审以全新视角执行，未接受 round 1 框架的任何默认妥协。除静态核对
`registry.ts`/`plugin.ts`/`persistence/src/*`/`dsh-persistence/profile.ts`/4 个红灯测试源码与
Cordis 4.0.1 随包 TS 源码（`node_modules/.pnpm/@deepseek-ai+cordis@4.0.1/.../src/{fiber,reflect,utils}.ts`
及 `cordis-plugin-timer/src/index.ts`）逐条对照外，另做**两个一次性机制实验**
（`/tmp/sa2-cordis-probe.mjs`、`/tmp/sa2-cordis-unloading-probe.mjs`，仓库零改动）与**两次测试基线复跑**。
证据命令与输出摘录见文末「验证证据」。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | **CRITICAL→HIGH（修订级）** | P3 §2.C.3 终值断言 / §2.C.6 / §8 R2′ 的**生产 timer 行为** | **「排空期 saveDoc 可用 / 聚合失败被机制性消灭」在生产接线（真实 `cordis-plugin-timer`）下不成立，且设计全文零分析。** 实测（实验 2，真实 TimerService + cordis 4.0.1）：当 persistence 自身 fiber 处于 `UNLOADING`（正是 §2.C drain 窗口）时，从该 fiber 捕获的 ctx 调 `ctx.timeout` **抛 `CordisError('INACTIVE_EFFECT')`（"cannot create effect on inactive context"）**——`fiber.effect()` 对 `state === UNLOADING` 有显式 throw 分支。生产链路：`MemoryPersistence` 的 scheduler 由 `createCordisPersistenceScheduler(ctx)` 捕获 **memory fiber 自己的 ctx**（memory.ts:145）；drain 窗口内写排空 `saveDoc → scheduleFlush → this.scheduler.setTimeout`（lifecycle.ts:518-528，`maxDirtyTimer`/`debounceTimer` 同步武装，仅 `flushing/closed/retryTimer` 守卫，**无 fiber 状态守卫**）→ `ctx.timeout → this.ctx.effect` → throw → `core.saveDoc` reject → 已接纳写的 dirty notification 失败（按 ADR-0009「open/create 自身的结果只交付原调用者」，该 rejection 交付写调用方；close barrier 经 sequencer 在前项 **settle**（含 reject）后仍执行，`handle.release()` 面对活 core 可成功——shutdown 本身可能仍 settle，但**写本身失败**）。红灯 29 / SA7-P2 用的是 `createFakeTimerPlugin`（persistence/src/testing.ts）：其 service 是**箭头函数纯对象，完全不触碰 `ctx.effect`**（timer 直接进 fake scheduler）——**测试 seam 对该窗口结构性失明**，4 红灯转绿不受影响，但设计的下述文本把 test-seam 行为泛化成了普适契约：① §2.C.3 终值断言「排空全程 adapter 活：saveDoc/release **无一撞失败** → close 零失败」＋「聚合失败被**机制性消灭**」；② §8 R2′「依赖 fiber 卸载完成前 adapter 保持 ready（**saveDoc 仍可写入**）——次序契约的目的态」；③ §2.C.6 第 3 弹「S6 = saveDoc（记账 + 调度 flush 后**即返回**）」在窗口内不返回而是 throw。round 1 同窗口的失败因是 `'persistence is disposed'`（M-C），rev1 把失败因换成 INACTIVE_EFFECT——**失败类别（响亮、非静默）未回归，但「消灭」的声明是假的**，且既有宿主契约注记（service.ts 头注「timer fiber 生命周期 ⊇ adapter」/ plugin.ts 注 1）**不覆盖**本窗口（timer fiber 全程健康，抛错源自 persistence fiber 自身 UNLOADING 态）。 | 三选一（推荐 a+b）：**(a) 修文本**——§2.C.3 终值断言与 §2.C.6/R2′ 增加显式限定「fake-timer 测试 seam 下的行为」，新增 R5′ 残余风险条目：生产 teardown + 在途写 → saveDoc 在 drain 窗口抛 INACTIVE_EFFECT（cause 链写明），写调用方收到响亮 rejection；**(b) 契约面补记**——§2.C.5 头注改写与 service.ts 宿主契约注记追加「persistence fiber 卸载窗口内经 `ctx.timeout` 的 flush/retry 武装会抛 INACTIVE_EFFECT（生产 timer）」或显式声明该项超出本票（附理由：宿主可在拆 persistence fiber 前先 settle 依赖方）；**(c) 若欲真根治**——flush 武装改经独立于 persistence fiber 的 timer 归属（触及 lifecycle.ts/scheduler 契约，超出当前 DENY 边界，须另立票裁决）。修订后须保证 §7 回归面分析与 plugin.ts 头注（ALLOW LIST 内纯注释改动）同步。 |
| 2 | LOW | §5#5 机制归因精度 | 「wrapper `.then` 覆写使直接 `await revoke()` 在未启动时启动并全程等待」——`await revoke()`（**调用后 await**）等待的是 wrapper 调用**返回值**（`finalizeDisposal` 的 inFlight promise）；`.then` 覆写服务的是对 wrapper **本身** thenable-await 的路径。两条路径最终都「直启 + 全程等待」（实验 1 已证实复合行为），§5#5 的 caveat（join 只在 `runDisposable` 路径完整、故必须 yield re-parent）本身正确且 load-bearing——仅归因措辞混淆两条路径。 | §5#5 一句话修正归因（调用返回值 vs `.then` 覆写各自覆盖哪条路径）；非阻塞。 |
| 3 | LOW | §2.C.2/§2.C.6 失败路由未写 | `drainStep` 的 `finally { await adapter.dispose() }` 若 `revoke()` reject：dispose 仍执行（不漏资源）✓，但串行链 task 转 rejected → 链尾 `runDisposable(revoke)` 被 `.then` 短路跳过——因 P 的 disposal 已在 `await revoke()` 内经 `disposeAsync` 启动，无泄漏、无二次执行；最终 rejection 经 `_unload` 的 composeError catch → `ctx.logger.error`。该结局（adapter dispose 失败/revoke 失败的最终归宿）设计未写明。 | §2.C.6 补一句「dispose/revoke rejection 的最终通道 = cordis fiber logger.error（响亮、非静默）」；非阻塞。 |
| 4 | LOW | §7 测试面（增强建议） | 19b 仅覆盖「单个 entry 同步 throw」；多 entry 全同步 throw（failures 次序 = Map 插入序、每 cause 恰一次）无锚。F1 的生产窗口在现有 fake-timer seam 下不可测（见 #1）。 | 可选增强：① 19c（全 throw 变体：k1/k2 均 `syncThrowWith`，断言 `failures.length===2` 且次序）；② 针对残余窗口的「effect-faithful timer stub」用例（fake timer service 改为经 `ctx.effect` 注册到调用方 fiber，复刻生产语义）→ 断言窗口内写 reject 的 cause 与 shutdown 终态（把残余行为钉成声明式契约而非未定义行为）。非阻塞，归 SA3/SA6 裁量。 |

**未成立的攻击（已尝试并排除，供 SA4/SA7 复用）**：

- **P1 合成 reject 的 unhandledRejection 免疫**：`Promise.reject(cause)` + **同一同步段** `void promise.catch(()=>{})` 使 Promise 出生即 handled；聚合循环的 `await` 是第二 handler（合法），cause 仍恰一次入 failures。设计的「零 floating window」论证**正确且必要**——同步 throw entry 不居 closures 首位、前置 close 未结算时，聚合循环首个 `await` 前存在微任务排空 checkpoint（Node docs「no error handler … within a turn of the event loop」，§5#9 引文属实）。19b 中 k1 恰居首位故该防御非该用例的转绿前提，但为任意次序下的正确性要件——**不是过度工程**。
- **P2 免疫与四通道**：`beginIdleClose` 收编点后三条同步语句内挂接 `.then(onF, onR)`，零 await 间隙 → 零 floating window（与 §2.A 的不对称是有理由的最小防御，非不一致）；I4 token 收缴先于 close 发起（设计代码保持既有次序）；I2 以 rejected Promise 落位 = relevant_decisions 明示的「保持而非修订」；reject 臂 `dispatchObserver` 被 observer.ts:53-63 try/catch 隔离（亲核属实）→ 派生 Promise 不 reject；entry 移除经 removeOnlySelf 双守卫 → 后续 open 新 generation（11b 断言 `loadCalls===2` 与设计条款一致）。shutdown 遇该 entry 走 AC10 复用分支——P1/P2 交互闭合。
- **P3 机制链（8 步 trace 的测试环境闭合）**：逐条亲核 cordis 4.0.1 —— `_unload` 的 `Promise.all(_disposables.clear().map(runDisposable))`（fiber.ts:675-687 + utils.ts:27-31 `clear().reverse()`）✓；`collect` 的 re-parent `disposables.push + _disposables.delete`（fiber.ts:447-454）✓；effect 本地 `splice(0).reverse()` + `task.then(runDisposable)` 逆序串行（fiber.ts:424-436）✓；provide disposer「delete store → notify → `await Promise.allSettled(fibers.map(f.await()))`」（reflect.ts:277-304 逐字）✓；`runDisposable`+`effectInertia` join（fiber.ts:116-120）✓；`fiber.await()` 的 `while(this.inertia)` 循环（fiber.ts:690-696）✓；plugin.ts:159-177 先例 ✓。**实验 1（真实 cordis，old/new 双 wiring 对照）**：old wiring 复现红点（dispose 先于 settle）；new wiring 在 shutdown 挂起窗口 `adapterDisposed=0`，settle 后 dispose 恰一次且严格晚于 `registry-shutdown-settled` —— **次序契约与恰一次在生产级 cordis 行为下成立**。红灯 29/SA7-P2 中 memoryFiber `_disposables` 确为仅剩 W（fake timer 不建 fiber effect；provide wrapper 已 re-parent）——步骤 1 措辞在测试环境成立（生产环境的 timer effect 归属差异归入 #1）。
- **死锁/挂起**：无环——`revoke()` 的 notify **就是**触发依赖 fiber 卸载的机制（被等者由等待发起者启动）；registry 侧 disposer 不等待 persistence fiber；「等待有界性/非新挂起类/在途 close 传导」论证与 cordis 源码一致；`saveDoc 不 await io.write`（lifecycle.ts:277-287 亲核）、`handle.release()` 不等待 flush（:511-516 `maybeEvict` 仅 saved===dirty 回收）——无「dispose 等 registry、registry 等 flush、flush 等 abort」环（注：#1 的 throw 不构成挂起，只构成失败）。
- **双 Adapter 不对称**：memory/file 单源 helper（service.ts），两 `apply` 同款替换、label 保持（'memory-persistence: service'/'file-persistence: service'），无状态机复制——ADR-0006 :157-159/:196 满足；`lifecycle.ts`/`contract.ts` 零改动，service.ts→contract.ts 运行时导入不构成环（contract 为依赖叶，亲核无运行时 import），module-graph 守卫（reverse-barrel/host-global timer）不触碰（测试源码亲核）。
- **dsh-persistence 直调边界**：profile.dispose() = 先 `persistence.dispose()` 后 `ctx.fiber.dispose()`（profile.ts 亲核）；新 wiring 下 fiber drain 中 `revoke()` 无依赖 fiber → allSettled([]) 即 settle → `adapter.dispose()` 命中 lifecycle.ts:315-318 幂等分支——**无挂起、语义零变化**；仓内确无 `createDshPersistenceProfile` 外部消费方（grep 实证）。`memory-persistence.test.ts:548-571`（root-fiber 重复卸载恰一次）在新 wiring 下保持（无依赖 fiber → drain 即返；serviceEvents 恒 1；实验 1 的恰一次结果旁证）。
- **回归面抽查**：test 26（真实 memory plugin，`['registry-shutdown-settled','persistence-fiber-dispose-settled']` 次序）——p.then 探针注册先于 plugin disposer 的 await，p resolve 时先入 events，adapter dispose 在 disposer 完成后、disposal settle 前——次序保持；tests 25/27/28/28a 走 stub provide / timer 通道，不经新 wiring；sa7-concurrency/hostile/node-dispose 零 cordis（grep 实证）。
- **版本/清单**：0.1.2→0.1.3、0.2.0→0.2.1 与现状一致；ALLOW/DENY 与简报及 SA8 放行边界一致；plugin.ts 仅注释改动。

---

## 协议假设依据审查

**章节存在**（§5，11 条，rev1 新增 #9-#11）——**通过**。本轮 SA2 对 #1-#11 全部独立重核：

- #1-#6、#8、#10、#11：cordis 4.0.1 / persistence 源码引用**逐条属实**（行号偏差 ≤3，语义零偏差）；
  其中 #3/#4/#5 的 re-parent + 逆序串行 + join 三件套另经实验 1 在真实 cordis 上复合验证。
- #9：Node docs「no error handler is attached to the Promise within a turn of the event loop」引文属实
  （P1 即刻空 catch / P2 同步段挂接的直接依据成立）。
- #5 的归因措辞瑕疵见攻击点 #2；**#9/#5 未外推出「生产 timer 在 UNLOADING fiber 上的 `ctx.effect`
  行为」这一缺失假设**——即攻击点 #1，这是 §5 唯一的实质缺口（依据并非「应该/通常」类推断，而是
  **遗漏了一条已被实测证伪的行为假设**）。
- 无 HTTP/WS/端口类假设；依据均可被 SA4 重跑（引用可定位、实验脚本形态已附）。

## 错误处理链路审查

- **静默失败**：未发现。P1 同步 throw → 聚合错误（failures 收录 exact cause 恰一次）；P2 → observer
  `idle-close-failed` 恰一次 + entry 移除；P3 drainStep `try/finally` 保证 revoke 异常不漏 adapter
  dispose；dispose/revoke rejection 归 cordis logger（攻击点 #3 要求写明）。
- **状态闭环**：P1 全路径 `entries.clear + acceptance='stopped'` 恒达（发起段零逃逸后 runShutdown 必然
  到达步骤 4——「先到 stopped 再 throw」对同步 throw 成立）；P2 成败两臂均 removeOnlySelf。
- **降级路径 / 虚假降级**：**无虚假降级**。P1/P2 把同步 throw 当真实失败响亮上报（exact cause），未以
  降级掩盖 bug；设计 §1.2 明示「这不是降级场景……是收编缺口」并按纪律设计统一失败通道。攻击点 #1 的
  生产窗口失败也是响亮的（写调用方 rejection / aggregate），非静默——但设计**声称其为成功**，属
  「契约文本与真实行为不符」，非降级掩盖。
- **用户/调用方可感知性**：shutdown caller 收 `NamespaceRegistryShutdownError`（含 failures）；写调用方
  收原始 rejection；observer sink 收 exact cause。✓

## 红线测试思路

1. **（对应攻击点 #1，必做其一）** 生产语义残余窗口钉死：构造「effect-faithful timer stub」
   （fake timer service 的 `timeout` 改为经 `ctx.effect` 注册到**调用方 fiber**，复刻真实
   TimerService 行为），复用测试 29 的门控手法：gated 写 → `memoryFiber.dispose()` → 窗口内
   `saveGate.resolve()` → 断言：① 写 promise reject 且 cause 为 `CordisError('INACTIVE_EFFECT')`
   （或设计修订后声明的稳定形态）；② `p`（shutdown）终态与设计修订文本一致（resolve undefined 或
   聚合 reject——以修订后的声明为准）；③ 零 unhandled rejection；④ 次序断言
   （`registry-shutdown-settled` < `persistence-adapter-disposed`）仍成立。若 SA1 选择「显式声明
   超出本票」而非测试，则须在 §8 R5′ 写明宿主规避手段（先 settle 依赖方再拆 persistence fiber）。
2. **（对应攻击点 #4①）** 19c：k1/k2 均 `syncThrowWith`（不同 cause 实例）→ 断言
   `failures.length===2`、`failures[0].cause===cause1`、`failures[1].cause===cause2`（Map 插入序）、
   `getStatus()==={state:'stopped'}`、双 `closeCalls===1`、零 unhandled rejection。
3. **（P2 边界加固，可选）** 11c：同步 throw entry 在 throw 前已被并发 open 激活（phase 守卫路径）——
   断言 `closeCalls===0`、open 复用同 Runtime、零事件（锁死「结构性防御分支不被收编逻辑误伤」）。

---

## 结论

- **P1（§2.A）**：通过。同构聚合、全尝试、终态恒达、零 floating window 设计正确且必要；19b 三组断言
  与条款一一对应。
- **P2（§2.B）**：通过。四通道结构对同步 throw 同构成方，I2/I4/removeOnlySelf 次序保持，11b 四组断言
  覆盖完整。
- **P3（§2.C）**：**机制主体通过**（次序契约经源码亲核 + 实验证实；路径甲/乙拒绝理由成立——乙的
  微任务次序洞分析正确，甲的「探针挂在 dispose 入口 → 结构性不可行」与
  `registry-plugin.test.ts:485-490` 亲核一致）；**但生产的 drain 窗口可用性声明（终值断言/R2′/§2.C.6）
  与真实 timer 行为不符（攻击点 #1），必须修订设计文本（+ 契约注记/残余风险条目）后方可放行**。
- 13 AC 不回归矩阵（§3）与 150 绿用例回归面（§7）分析质量高，抽查全部成立；SA6 4 红灯用例断言
  100% 被设计条款覆盖（映射表核对无遗漏）。

**Verdict: reject** —— 仅需按攻击点 #1 修订（#2/#3 顺手，#4 可选）；修订局限设计文档与 plugin.ts/
service.ts 注释层，不触碰已验证的机制主体。修订后提交 R 轮复审，SA2 将只复核 #1 的修订落实。

---

## 验证证据（SA2 独立执行）

```bash
# 1) 红灯基线复跑（SA6 声明复核）
cd /home/wangjian/nomicore-fix-issue-112 && pnpm exec vitest run packages/namespace-registry/test/
# → Test Files 4 failed | 7 passed (11)；Tests 4 failed | 150 passed (154)；Type Errors: no errors  ✅与 SA6 一致

# 2) persistence 包基线（P3 回归面基线）
pnpm exec vitest run packages/persistence/test/
# → Tests 94 passed (94)  ✅全绿基线

# 3) 实验 1：P3 次序机制（真实 cordis 4.0.1，old/new wiring 对照；脚本 /tmp/sa2-cordis-probe.mjs）
node /tmp/sa2-cordis-probe.mjs
# → OLD wiring events: ["persistence-adapter-disposed:1","window-check:adapterDisposed=1","registry-shutdown-settled"]
# → NEW wiring events: ["window-check:adapterDisposed=0","registry-shutdown-settled","persistence-adapter-disposed:1"]
# → NEW: settled-before-disposed: true；exactly-once dispose: true；OLD 红点复现: true
#    ✅re-parent+逆序串行+依赖 join 的次序契约与恰一次性成立；round 1 并发缺陷复现

# 4) 实验 2：生产 timer 的 UNLOADING 窗口（攻击点 #1 证据；脚本 /tmp/sa2-cordis-unloading-probe.mjs）
node /tmp/sa2-cordis-unloading-probe.mjs
# → baseline ACTIVE ctx.timeout threw: no
# → memoryFiber state in window (5=UNLOADING): 5
# → ctx.timeout during OWN fiber UNLOADING threw: Error: cannot create effect on inactive context
# → drain completed
#    ❌生产语义下 drain 窗口内 ctx.timeout（= saveDoc→scheduleFlush 通道）抛 INACTIVE_EFFECT

# 5) 源码亲核（节选）
sed -n '421,455p' node_modules/.pnpm/@deepseek-ai+cordis@4.0.1/node_modules/@deepseek-ai/cordis/src/fiber.ts
# → effect 内 dispose() 的 splice(0).reverse()+task.then(runDisposable) 串行链与 collect 的 re-parent 逐字确认
sed -n '277,304p' .../cordis/src/reflect.ts   # → provide disposer: delete store → notify → await Promise.allSettled(fibers.map(f=>f.await()))
sed -n '675,687p' .../cordis/src/fiber.ts     # → _unload: await Promise.all(this._disposables.clear().map(...))
grep -n "UNLOADING" .../cordis/src/fiber.ts   # → effect(): if (this.state === FiberState.UNLOADING) throw new CordisError('INACTIVE_EFFECT')
sed -n '518,528p' packages/persistence/src/lifecycle.ts  # → scheduleFlush 同步武装 maxDirty/debounce timer，无 fiber 状态守卫
# 红灯测试断言核对：registry-shutdown.test.ts:629-675(19b)/registry-idle.test.ts:893-957(11b)/
# registry-plugin.test.ts:465-576(29)/registry-sa7-cordis.test.ts:206-311(SA7-P2)
```

---

# SA2 R2 复审（同一修订轮续审）

**Date**: 2026-08-26（R1 评审同日续审）
**复审对象**：`wiki/raw/task_registry-idle-plugin-shutdown-rev1_design.md` R2 版（782 行，文末含
「SA2 反馈逐条回应（R2）」表）
**复审范围**：按 R1 声明——只复核攻击点 #1 的修订落实（seam 限定 / R5′ / §2.C.5+§2.C.2 契约注记 /
§5#12），顺手确认 #2/#3 落实与 SA8 勘误；另核「R2 未触碰机制主体」的边界自检声明。

## 逐点复核结果

| R1 要求 | 落实 | 复核证据（本轮新增验证） |
|---|:--:|---|
| #1-(a) 全部泛化声明改为 seam 显式限定 | ✅ | §2.C.3 新增「运行环境限定（R2 修订，SA2 攻击点 #1）」段（:382-388）+ 步骤 5 生产差异内注（:396）+ 终值断言加「**fake-timer seam 环境**」前缀（:401）；§7 红灯映射两行加 seam 限定（:634-635）+ 回归面新增环境限定段（:639-641）。grep 全文扫描：「无一撞/零失败/机制性消灭/仍可写入」共 3 处残留实例（:404、:635、:711）**均已带限定**（seam 前缀 / close 聚合失败类 / timer 分层表述），无未限定泛化声明残留 |
| #1-(a)「消灭」声明精确化 | ✅ | §2.C.3「消灭声明的精确边界」（:405-413）：消灭的 = 「close 撞已销毁 handle（adapter closed=true）→ close 聚合失败」类，**对两种 timer 均真**（wiring 级保证与 timer 实现无关——与 SA2 实验 1 及机制分析一致）；生产 timer 写路径残余失败单列 R5′ 不混同。区分准确 |
| #1-(b) §8 R5′ 残余风险条目 | ✅ | §8 R5′（:719-760）七段结构完整：触发面（drain 窗口 = UNLOADING 起 → adapter.dispose 止，准确）；机制链（与 SA2 实验 2 实测完全一致，四处源码引用全部亲核属实——见下）；影响边界（写调用方收响亮 rejection、close/shutdown 终态不受影响——**本轮新验证**：`sequencer.ts:39-41` `this.tail.then(run, run)` 前项 settle（含 reject）后 barrier 照常执行 + 链尾恒绿 noop，交付通道与 ADR-0009:101「只交付原调用者」纪律同型，属实）；与 round 1 对比（窗口收窄而非消灭；正确指出残余与 dispose 时序正交——UNLOADING 态 `ctx.timeout` 一律 throw）；seam 失明（结构性）；宿主规避（先 settle 依赖方再拆 persistence fiber；**正确指出根级一把全拆时窗口同样存在**）；出票边界（scheduler 所有权迁移受 ADR-0006 共享 core 纪律约束、超 SA8 放行边界、建议后续票——裁决合理且与 DENY LIST 一致） |
| #1-(b) §2.C.5 plugin.ts 头注补记 | ✅ | 头注改写含「⚠️ 残余窗口（R5′，生产 timer 限定）」段（:437-445）：窗口、INACTIVE_EFFECT cause、响亮交付、close 不受影响、宿主规避、seam 失明、round 1 R1 声明废止的准确处置（R1 并发已根治 vs 本窗口为 cordis fiber 状态门独立残余）。「Registry shutdown settle（含 handle.release 全程与 saveDoc 的 entry 断言）」措辞已收窄为准确表述（不再含 flush 武装） |
| #1-(b) §2.C.2 helper 宿主契约注记 | ✅ | helper 文档注释新增「⚠️ 宿主接线契约（R5′，生产 timer 限定）」段（:318-324），与 §2.C.5 同源同口径 |
| #1 §5#12 缺失假设补记 | ✅ | §5 新增 #12（:579）：caller-fiber 绑定 + UNLOADING throw + seam 失明，依据 = SA2 实验 2 + 四处源码引用。**本轮逐条亲核全部属实**：`cordis-plugin-timer/src/index.ts:35-42`（`timeout` 经 `this.ctx.effect`）✓；`utils.ts:163-170` 原文「Non-noShadow services strip — their side effects bind to caller, not origin」**逐字命中**（SA2 实验 2 实测行为的源码级机制，R2 找到了 SA1 R1 未引用的准确出处）✓；`fiber.ts:418-421`（assertActive + UNLOADING throw）✓；`persistence/src/testing.ts`（fake `timeout` 纯箭头零 ctx.effect）✓。风险栏「中」+ 处置指向 R5′，闭环 |
| #2 §5#5 归因两路径区分 | ✅ | §5#5 重写（:572）：①调用路径（`await revoke()` = 先调用后 await 返回值；未启动 → `finalizeDisposal` 返 inFlight 全程等待；已启动 → 返 undefined **不 join**）；②thenable 路径（`.then` 覆写 → disposeAsync 同型）；完整 join 仅 `runDisposable` 路径。**与 fiber.ts 源码逐句相符**（wrapper 体 `if (!runner.epoch) return setupFailed ? inFlight : undefined`、`disposeAsync` 的 `if (!runner.epoch) return`——SA2 本轮亲核）。load-bearing caveat（必须 yield re-parent）保留并强化为「两路径已启动态均不 join」；§2.C.1 第 3 条（:275-283）与 §2.C.2 行内注释（:344-346）同步 |
| #3 dispose/revoke rejection 最终通道 | ✅ | §2.C.6 新增末弹（:471-478）：finally 兜底不漏资源；串行链短路跳过链尾 revoke（已启动、无泄漏/无二次执行）；rejection 经外层 disposalTask → `_unload` per-disposable try/catch → `ctx.logger.error`——引用 `fiber.ts:676-686` 与源码相符（SA2 R1 已亲核该 catch 块）；「响亮非静默」结论成立 |
| SA8 勘误（ADR-0006 :103 → ADR-0009:103） | ✅ | §2.C.2 helper 注释首行改为「ADR-0006 :86 宿主逆序停止职责 + ADR-0009 :103 Plugin dispose 有序 disposer」（:302-303）——对照 relevant_decisions 核实：ADR-0009:103 = Plugin dispose 条款、ADR-0006:86 = dispose/宿主职责，归属正确；§7 SA3 实现注意第 5 条（:672-674）指示勘误随实现落纸 |
| #4 可选测试思路记录 | ✅ | §7「R2 增补测试思路」（:676-696）：19c / effect-faithful timer stub（把 R5′ 残余行为钉成声明式契约，断言组与 SA2 R1 红灯构想一致）/ 11c——以「可选、SA3/SA6 裁量」记录，与 R1 定级（非阻塞）相符 |

## 边界自检复核（R2 未触碰机制主体）

- §2.A/§2.B 代码块与 R1 **逐字节相同**（:145-168、:201-229 重读比对：try/catch 形状、即刻空 catch、
  I2/I4 次序、四通道挂接全部不变）；§2.C.2 helper 的 generator 主体（yield 序 + try/finally 形状）
  不变，增量仅文档注释与行内归因注释；§2.C.0/§2.C.4/§2.D/§3/§4/§6 与 R1 相同。
- `git status`：design.md 为 staged 且工作区无 diff（staged == working tree），无 R1/R2 混写痕迹。
- 4 红灯映射、13 AC 矩阵、ALLOW/DENY 清单与 R1 一致——R1 已通过的 P1/P2 结论与 P3 机制主体结论
  全部延续有效，无需重跑测试基线（本轮零代码改动，R1 基线 `4 failed | 150 passed (154)`、
  persistence `94 passed` 仍为当前工作区事实）。

## INFO 级备注（无需行动）

§2.C.3 :386-387 称次序契约「经 SA2 实验 1 在真实 cordis + 真实 timer 接线下验证」——精确事实：
实验 1 为真实 cordis **未装 timer 服务**（次序不涉及 timer，机制上 timer 无关）；实验 2/4 为真实
TimerService + 同款 gated drain 拓扑（窗口行为验证）但未挂 dispose 探针。两实验联合 + 机制论证
（adapter dispose 次序纯由 fiber/effect 机器决定、路径不含 `ctx.timeout`）足以支撑该结论，仅证据
归因措辞略超单实验覆盖面。不构成缺陷，留此备注供 SA4 佐证时知悉证据边界。

## R2 复审结论

R1 全部攻击点（#1 HIGH 的 (a)+(b)、#2/#3 LOW、#4 可选、SA8 勘误）已按要求落实且与源码逐条相符；
新增的 R5′/§5#12/头注补记把 R1 发现的生产残余窗口从「未声明的过度承诺」转为「机制链完整、影响
边界经源码验证、宿主规避手段与出票边界明确」的声明式契约。修订零触碰已验证的机制主体，未引入
新缺陷。

**Verdict: pass**（放行 SA3 实现；`pass` 不替代 SA4 静态门禁与 SA7 活链路动态验证——R5′ 残余窗口
的生产语义、fake-timer seam 限定下的红灯 29/SA7-P2 转绿、以及 19b/11b/29/SA7-P2 四红灯全绿 +
150 既有用例零回归仍属 SA4/SA7 验证面）。

# SA7 动态验证报告 — SA3 实现（commit d183d3b，issue #112 round 2 修订轮）

**Date**: 2026-08-27
**被验对象**: `fix/issue-112-on-docs-namespace-registry` @ `d183d3b`（基线 `05cc030`）
**Verdict**: **pass**

---

## 0. Step 0：SA4 verdict 校对

- `wiki/raw/task_registry-idle-plugin-shutdown-rev1_sa4_review.md` 顶部（第 5 行）：**`Verdict: pass`**
- 操作：进入动态验证（SA7 无「下发」空间；本报告仅在 SA4 pass 之上独立给出动态面结论）。

## 1. Step 1：SA6 红灯 → 绿灯复核（4/4 转绿）

命令（后台独立进程 `setsid nohup`，verbose 定向 5 文件）：

```bash
pnpm exec vitest run \
  packages/namespace-registry/test/registry-shutdown.test.ts \
  packages/namespace-registry/test/registry-idle.test.ts \
  packages/namespace-registry/test/registry-plugin.test.ts \
  packages/namespace-registry/test/registry-sa7-cordis.test.ts \
  packages/namespace-registry/test/registry-sa7-rev1.test.ts --reporter=verbose
# → Test Files 5 passed (5)；Tests 47 passed (47)；Type Errors no errors；VERBOSE_EXIT=0
```

4 个红灯用例逐名转绿（verbose 输出逐条命中）：`19b ✓`（registry-shutdown AC10 describe）、
`19c ✓`（R2 增补①）、`11b ✓`（registry-idle AC7 describe）、`11c ✓`（R2 增补③）、
`29 ✓`（rev1 问题 3 describe）、`SA7-P2 ✓`（改写版，旧「close 撞已销毁 handle → 聚合失败」
假设已删除）。文件级计数与 SA4 申报吻合：shutdown 12（10+19b+19c）、idle 18（16+11b+11c）、
plugin 9（8+29）、sa7-cordis 4、**sa7-rev1 5（本轮 SA7 新增，见 §5）**。

[SA7 Step 1 结论] SA6 红灯: 🟢 GREEN（4/4）→ 进入 Step 2。

## 2. 全量 typecheck + test 实跑复现（动态验证要点 1）

后台独立进程（`setsid nohup bash -c '…' & disown`，零前台阻塞），对**含 SA7 补充测试的
最终工作区**：

```bash
pnpm typecheck   # → TYPECHECK_EXIT=0（9 个 tsc project 全过，含 persistence 与 namespace-registry）
pnpm test        # → vitest run --typecheck（根 config，include = packages/*/test/**/*.test.ts）
```

结果（`/tmp/sa7-final.log`，2026-08-27T00:22:32）：

```
TYPECHECK_EXIT=0
 Test Files  117 passed (117)
      Tests  1402 passed (1402)
Type Errors  no errors
VITEST_EXIT=0
```

（基线 1397 + SA7 本轮新增 5 = 1402；SA3 申报的 1397 基线先经第一轮独立复跑证实：
`Test Files 116 passed (116)；Tests 1397 passed (1397)；Type Errors no errors`，
`/tmp/sa7-full.log`。）

### vitest 触发证据段（两包命中）

根 config 单进程跑全部 workspace package，`✓ packages/<pkg>/test/` 逐文件命中计数
（`/tmp/sa7-final.log`）：

| Workspace Package | 触发结果 | log 摘录 |
|---|---|---|
| **packages/namespace-registry** | ✓ 12 个 test 文件全绿（含 4 个改动文件 + SA7 新增） | `✓ packages/namespace-registry/test/registry-shutdown.test.ts (12 tests)`、`✓ …/registry-idle.test.ts (18 tests)`、`✓ …/registry-plugin.test.ts (9 tests)`、`✓ …/registry-sa7-cordis.test.ts (4 tests)`、`✓ …/registry-sa7-rev1.test.ts (5 tests)`、`✓ …/registry-open.test.ts (32 tests)`、`✓ …/registry-create.test.ts (50 tests)` 等 |
| **packages/persistence** | ✓ 10 个 test 文件全绿 | `✓ packages/persistence/test/memory-persistence.test.ts (41 tests)`、`✓ …/file-persistence.test.ts (21 tests)`、`✓ …/module-graph-regression.test.ts (4 tests)`、`✓ …/persistence-contract.test.ts (6 tests)` 等 |
| 其余（vfsl 27 / doc-runtime 20 / namespace-runtime 23 / clock 3 / dsh-persistence 3 / vfsl-codegen 6 / vfsl-protocol 1 …） | ✓ 全绿 | 合计 117 文件 |

**verdict**: ✅ all-vitest-packages-triggered（两包在 runner 输出中逐文件命中，无 skip、无未触发）。

## 3. R5′ 残余窗口动态证实（SA4 交验首位 / 动态验证要点 3）——实测与声明**一致**

### 3.1 实验设计（一次性脚本，仓库零改动；SA2 /tmp 实验先例）

`/tmp/sa7-rev1-r5prime-probe.mjs`：真实 `new Context()` + manual clock + **真实
`TimerService`（cordis-plugin-timer 1.1.3，native setTimeout 经 `this.ctx.effect` 注册）**
+ **真实 `createMemoryPersistencePlugin`** + **真实 `createNamespaceRegistryPlugin`**
（真实 runtime）+ 测试 29 同款门控拓扑（`adapter.saveDoc` 影子门控 + `adapter.dispose`
开始/完成双探针 + AC12 same-Promise shutdown settle 探针）。Node 24.13.0
`--experimental-transform-types`（+ `.js→.ts` resolve hook）直跑 worktree TS 源，
产物仅写 /tmp。这是 SA2 实验 1（次序，无 timer）与实验 2/4（窗口，无 dispose 探针）之外的
**联合形态**——正是 SA4 指出 fake-timer seam 结构性失明、4 红灯转绿不构成证据的那一面。

### 3.2 实测结果（18/18 PASS，`/tmp/sa7-r5p.log`）

| # | 断言（设计 §8 R5′ 声明） | 实测 |
|---|---|---|
| Q0a | drain 窗口前 shutdown 严格挂起（写排空门控中） | PASS |
| Q0b | 窗口内 memory fiber `UNLOADING(5)` | PASS（state=5） |
| Q0c | 窗口内 adapter dispose 未被调用 | PASS（events=[]） |
| Q0d | 窗口内 shutdown 仍未 settle | PASS |
| **Q1** | 窗口内到达 saveDoc 的在途写**响亮 reject**，cause 链终端 = **`CordisError[INACTIVE_EFFECT]: cannot create effect on inactive context`**（零信息损失） | **PASS** |
| Q1b | 顶层为 runtime 冻结**稳定形态**：`RuntimeWriteFatalError`（`NSRT-WRITE-FATAL`，phase=`notify-dirty-failed`，`committed=true`） | PASS |
| **Q2** | rejection **交付写调用方**（`mutateRoot` promise reject） | **PASS** |
| **Q3/Q3b** | close barrier/shutdown 终态不受影响：`shutdown()` **resolve undefined**（非 `NamespaceRegistryShutdownError` 聚合 reject） | **PASS** |
| **Q4** | **次序契约在真实 timer 在场下成立**：`registry-shutdown-settled` < `persistence-adapter-disposed` | **PASS**（events 逐字：`["registry-shutdown-settled","persistence-adapter-disposed","persistence-adapter-disposed-complete"]`） |
| Q5 | adapter dispose 恰一次（开始/完成探针各一） | PASS |
| Q6/Q6b | 零 unhandled rejection（含收尾后） | PASS |
| Q7a-e | 旧实例 `{state:'stopped'}`、双 service 撤销、`plugin.instance` 撤销、registry fiber `PENDING(0)` | PASS |

完整 rejection 形态（原文摘录）：

```
writeRejection top = RuntimeWriteFatalError: NSRT-WRITE-FATAL: ROOT write internal fatal
  （phase=notify-dirty-failed, committed=true）；internal fatal 已永久禁用本 Runtime 的全部写能力…
chain terminal = CordisError[INACTIVE_EFFECT]: cannot create effect on inactive context
chain = ["RuntimeWriteFatalError: NSRT-WRITE-FATAL: …","CordisError[INACTIVE_EFFECT]: cannot create effect on inactive context"]
```

### 3.3 「实测 vs 声明」裁定：**一致（无 fail-needs-fix 项）**

- 设计 R5′ 写「写调用方收到响亮 rejection（**exact cause = INACTIVE_EFFECT**）」。实测的
  exact `CordisError('INACTIVE_EFFECT')` **原文逐字保留在 cause 链终端**（runtime 冻结通道
  write.ts:152-161 以 `{ cause: err }` 零信息损失包裹——`git diff 05cc030 d183d3b --
  packages/namespace-runtime/` 为空，该包裹是 #92/#91 期冻结行为，非本轮引入）。顶层
  `RuntimeWriteFatalError` 即 SA2 红线构想 #1 预留的「**或实现后声明的稳定形态**」——
  形态确定、可断言、跨运行稳定（in-repo 契约测试 R5P 已将其钉死，见 §5）。
- 影响边界三声明（close 照常 settle / shutdown 终态不受影响 / 零 unhandled）逐条实测通过；
  次序契约在真实 timer 联合形态下成立（补上 SA2 实验 1「未装 timer」的证据缺口）。

### 3.4 差分对照：宿主规避手段实证（`/tmp/sa7-rev1-r5host-probe.mjs`，5/5 PASS）

同款拓扑唯一变量 = 卸载次序（设计声明的规避路径：先 settle 依赖方再拆 persistence fiber）：

| # | 断言 | 实测 |
|---|---|---|
| H1 | registry fiber 卸载期间 memory fiber 仍 `ACTIVE(2)`（窗口未打开） | PASS |
| **H2** | **规避次序下同一位置写成功**（`saveDoc→scheduleFlush→ctx.timeout` 武装成功，无 INACTIVE_EFFECT） | **PASS** |
| H3 | shutdown resolve undefined | PASS |
| H4 | 次序契约仍成立（dispose 恰一次） | PASS |
| H5 | 零 unhandled rejection | PASS |

主实验（persistence fiber 先拆 → 写 reject INACTIVE_EFFECT）与对照实验（registry fiber
先拆 → 同一写成功）构成**差分证明**：窗口真实存在且纯由卸载次序门控，设计声明的宿主
规避手段有效。

## 4. 三项修复的活链路 adversarial 验证（动态验证要点 2）

### 4.1 P1：shutdown 聚合收编（含 SA2 指出的 floating-window 载荷缺口——本轮补锚）

既有 19b/19c 均为「同步 throw entry 居 Map 插入序**首位**」——SA2 评审明示即刻空 catch
防御（`void promise.catch(()=>{})`）「非该用例的转绿前提」。本轮新增 **19d**
（`registry-sa7-rev1.test.ts`）：k1 居首位 = gated rejection（挂起聚合循环的 `await`），
k2 居次位 = 同步 throw——合成 rejected Promise 跨「首位 await 挂起」窗口存活多个
**宏任务 checkpoint**（setImmediate + setTimeout(0)×3，Node 在 turn 结束检查点对无
handler 的 rejected Promise 触发事件）：

- ✅ 窗口期零 unhandled rejection（即刻空 catch 防御在载荷场景真实生效）
- ✅ 放行后双 cause 同构聚合：`failures=[{k1, k1Cause},{k2, syncCause}]`，Map 插入序、
  每 cause 恰一次（instance 级恒等）
- ✅ 双 `closeCalls===1`（全部尝试）、`getStatus()==={state:'stopped'}`（终态恒达）
- ✅ **19d-CTRL**（探针灵敏度对照）：同款 turn 结构下裸 `Promise.reject`（零 handler）
  必被探针捕获——证明 19d 的「零 unhandled」具备真判别力（若移除该防御，19d 转红）。

### 4.2 P2：idle-close observer 收编（fake timer 面由 11b/11c 覆盖；本轮补两条活链路面）

> **（R2′ 修订）** 原 11d 以 60ms 真实 sleep 驱动 native 到期，违反简报「测试须确定性
> （fake scheduler/受控 gate），禁止真实 sleep」明文约束（且头注误写 40ms）。已按
> spec 轴终审要求**拆分**：确定性主体保留为 11d，native 到期链路单列为 11d-SMOKE
> 显式冒烟（豁免理由随用例头注落纸；头注/代码数字一致 60ms=15ms×4）。见 §10 修订记录。

- **11d（real native timer 烟囱）**：testing seam registry + **生产同款
  `createCordisRegistryScheduler(ctx)` 真实 ctx.timeout 桥**（TimerService → ctx.effect →
  native setTimeout，idleTimeoutMs=15ms）+ `runtimeFactory` 同步 throw。native timer 回调
  到期 → `beginIdleClose` 同步 throw 被收编——**进程零崩溃**（若逃逸 = uncaughtException，
  测试无法到达断言，判别器即测试自身存活）；`idle-close-failed` exact cause 恰一次；
  entry 移除（`loadCalls===2`、新 Runtime R2）；零 unhandled rejection。〔R2′ 起拆分为
  11d（确定性，2ms）+ 11d-SMOKE（60ms 冒烟）两用例，验证意图零削减——确定性分工：
  11b fake 全链路 / 11d 真实桥武装+确定性触发 / 11d-SMOKE native 到期交付〕
- **11e（敌意 observer sink）**：sink 在 `idle-close-failed` 分发点同步 throw——
  `dispatchObserver` 隔离生效（`advanceBy` 正常 settle、零 unhandled、零逃逸），
  **`removeEntryAfterClose` 仍执行**（entry 移除 → 后续 open 全新 generation）——锁死
  P2 reject 臂「dispatch → remove」次序在敌意 sink 下不破。

### 4.3 P3：dispose 次序（真实 cordis 4.0.1 + 真实 timer）

- 测试 29 / SA7-P2（fake timer seam）+ 本轮 **R5P**（真实 TimerService 联合形态，见 §3.2
  Q4/Q5）：`registry-shutdown-settled` 严格先于 `persistence-adapter-disposed`、双探针恰一次。
- **重复卸载恰一次（SA4 动态重点 #3，`/tmp/sa7-rev1-e2e3-probe.mjs` E2，17 项全 PASS）**：
  - E2a：`memoryFiber.dispose()` 三次重入 → 全部 settle（同卸载 join），
    `persistence-adapter-disposed` **恰一次**，fiber 终态 `DISPOSED(4)`；
  - E2b：根级全拆（`ctx.fiber.dispose()`）+ 子 fiber 直拆**并发双触发** → 仍恰一次、
    旧 registry `stopped`、双 service 撤销。
- **dsh-persistence profile 直调路径烟囱（SA4 动态重点 #4，E3）**：真实生产装配
  （system clock + 真实 TimerService）+ registry plugin 接进 profile.ctx →
  `profile.dispose()`（先 `persistence.dispose()` 后 `ctx.fiber.dispose()`）**11ms settle
  零挂起**（drainStep 命中 lifecycle 幂等分支，非 `allSettled` 死等）；二次 dispose 幂等；
  终态 `'disposed'`；registry 子 fiber 级联 `DISPOSED(4)` + `plugin.instance` 撤销；
  adapter dispose 进入计数 = 2（宿主直调 1 + drainStep 幂等进入，core 级零重复副作用）；
  全程零 unhandled rejection——与设计 §2.C.6「双路并发处置」推演逐项吻合。

### 4.4 零 unhandled rejection（横向）

本轮全部 4 个验证载体（全量 1402、R5′ 主/对照实验、E2/E3 实验、5 个补充测试）均挂
`process.on('unhandledRejection')` 探针（拒绝 vitest 全局忽略兜底），**全部零事件**。

## 5. SA7 补充测试（新增，唯一仓库改动）

`packages/namespace-registry/test/registry-sa7-rev1.test.ts`（R2′ 修订后 **6 用例**，全绿；命中根
vitest config include `packages/*/test/**/*.test.ts`；typecheck 随 `--typecheck` 通过；
**零 src 改动**——`git diff HEAD --name-only -- packages/*/src/` 为空；**除 11d-SMOKE 外
全部确定性、零真实 sleep**）：

| 用例 | 攻击面 | 结果 |
|---|---|---|
| 19d | P1 floating-window（同步 throw 不居首位 + 首位 gated rejection 挂起聚合循环，跨宏任务 checkpoint） | ✓ |
| 19d-CTRL | 探针灵敏度对照（同 turn 结构裸 reject 必检出） | ✓ |
| R5P | **R5′ 活链路契约化**：真实 TimerService + gated drain——写 reject（cause 链终端 CordisError INACTIVE_EFFECT）/ shutdown resolve undefined / 次序契约 / dispose 恰一次 / 零 unhandled（门控拓扑全程确定性，零 real sleep） | ✓ |
| 11d | P2 活链路（**确定性，2ms**）：真实 TimerService 经真实 ctx.timeout 桥武装（native setTimeout@300_000ms 测试期内必不到期）+ 回调捕获确定性手动触发——同步 throw 不逃出回调（逃逸沿测试调用栈直接失败，判别器等价）；真实 disposer 取消语义；敌意场景全断言 | ✓ |
| 11d-SMOKE | P2 native 到期冒烟（**显式 smoke 豁免，60ms real sleep = 15ms×4，本文件唯一非确定性点**；豁免理由：native 到期→dispose→callback 链路含进程级崩溃面，无法以 fake/gate 等价复刻；确定性分工由 11b+11d 承载；SA7-P4 烟囱先例） | ✓ |
| 11e | P2 reject 臂敌意 sink（隔离生效 + remove 仍执行） | ✓ |

注：R5P 把设计 §7「R2 增补测试思路 #2」（effect-faithful 残余窗口契约化，SA3 裁量未落地）
以**更強形态**落地——不经 stub 复刻，直接用真实 TimerService 装配（比 stub 复刻更接近
生产；门控拓扑使其无需 real sleep 即确定性）。

## 6. 13 AC 不回归抽查（动态验证要点 4；重点 AC9/AC10/AC11/AC12）

| AC | 抽查载体（verbose 逐名绿） | 结论 |
|---|---|---|
| 9 停接纳/取消 timer/等待已接纳/不等外部 release | `14`（停接纳+Proxy trap 零执行）、`15`（取消全部 idle timer，pending→0）、`15a`（adversarial 旧回调）、`16`（等待已接纳 open 完整结算）、`17`（不等外部 release 照常关闭） | ✅ |
| 10 复用/全尝试/稳定聚合 | `17`、`18`（复用在途 close Promise）、`19`（聚合错误形状/顺序/frozen）、`19b`、`19c`、**SA7 19d**（混合失败 + floating window） | ✅ |
| 11 有序 disposer 先于 Persistence dispose | `25`（shutdownStarted→…→serviceRevoked）、`26`（fiber 级先序）、`27`（close 失败 finally 撤 service）、`29`（adapter 级次序）、`SA7-P2`、**SA7 R5P**（真实 timer 联合形态） | ✅ |
| 12 幂 same-Promise | `20`（resolve/reject 两相同实例）、`21`（shutdown 后恒 NOT_ACCEPTING） | ✅ |
| 1-8（泛抽查） | 22（组合/真实 service 面）、23（缺依赖 loud）、24（config 矩阵 0..2147483647）、28/28a（ctx.timeout 桥 + 依赖门）、idle 1-12（武装/重置/arm-token/timeout=0/四通道）、13（三相投影）、surface 审计 | ✅（全量绿承载） |
| 13 确定性/全量/Node 20/24 CI | 本地：全量 1402 + typecheck 0（Node 24.13.0）✅；CI 矩阵见 §7 | ⚠️ 本地绿 / CI 待 push |

## 7. 环境阻塞项（非失败，交总控）

- **Node 20/24 CI 矩阵（AC13 / SA4 动态重点 #2）对 `d183d3b` 无 CI run 可观测**：
  `git branch -r --contains d183d3b` 为空（commit 未 push，本地领先远端 3 commits）；
  PR #126 的 CI head = `05cc030def…`（round 1 完成态，`test (20)`/`test (24)` 均
  SUCCESS——非本轮被验对象）。SA7 无 push/建 PR 职权，该项属 push 后的 CI 观测面，
  由总控在发布阶段收口（本地单版本全绿已复现，AC13 的双版本矩阵不由此降级）。

## 8. 验证证据总表（命令 + 结果）

```bash
cd /home/wangjian/nomicore-fix-issue-112
# 1) 全量 typecheck + test（后台独立进程 setsid nohup，含 SA7 补充测试的最终态）
pnpm typecheck            # → TYPECHECK_EXIT=0
pnpm test                 # → Test Files 117 passed (117)；Tests 1402 passed (1402)；
                          #    Type Errors no errors；VITEST_EXIT=0   （/tmp/sa7-final.log）
#    （SA3 基线独立复跑：116 files / 1397 tests / 0 errors，/tmp/sa7-full.log）
# 2) SA6 红灯 4 用例 + SA7 补充（verbose 逐名）
pnpm exec vitest run <shutdown/idle/plugin/sa7-cordis/sa7-rev1>.test.ts --reporter=verbose
                          # → 19b ✓ / 19c ✓ / 11b ✓ / 11c ✓ / 29 ✓ / SA7-P2 ✓；
                          #    19d ✓ / 19d-CTRL ✓ / R5P ✓ / 11d ✓ / 11e ✓；
                          #    Test Files 5 passed (5)；Tests 47 passed (47)   （/tmp/sa7-full3.log）
# 3) R5′ 联合证实（真实 TimerService + gated drain + dispose 探针；仓库零改动）
node --experimental-transform-types /tmp/sa7-rev1-r5prime-probe.mjs
                          # → 18/18 PASS；R5P_EXIT=0；events=[registry-shutdown-settled,
                          #    persistence-adapter-disposed, …-complete]；写 reject：
                          #    chain terminal = CordisError[INACTIVE_EFFECT]:
                          #    cannot create effect on inactive context   （/tmp/sa7-r5p.log）
# 4) R5′ 宿主规避差分对照
node --experimental-transform-types /tmp/sa7-rev1-r5host-probe.mjs
                          # → 5/5 PASS；规避次序下同一写 resolved（无 INACTIVE_EFFECT）
# 5) 重复卸载恰一次 + dsh profile 直调烟囱（SA4 动态重点 #3/#4）
node --experimental-transform-types /tmp/sa7-rev1-e2e3-probe.mjs
                          # → 17/17 PASS；dispose 恰一次（重入/根级全拆）；profile 11ms settle
# 6) 范围守卫（SA7 只加测试）
git status --short        # → 仅 ?? packages/namespace-registry/test/registry-sa7-rev1.test.ts（+staged wiki 台账）
git diff HEAD --name-only -- packages/*/src/   # → 空（零生产代码改动）
# 7) CI 可观测性
git branch -r --contains d183d3b                # → 空（未 push）
gh pr view 126 --json headRefOid                # → head=05cc030def…（round 1 态）
```

## 9. 结论

- **R5′ 残余窗口（SA4 交验首位）：实测与设计声明一致**——窗口真实（UNLOADING=5 可锚定）、
  窗口内在途写响亮 reject 且 exact `CordisError('INACTIVE_EFFECT')` 逐字保留于 cause 链
  终端（顶层为 runtime 冻结稳定形态）、交付写调用方、shutdown 终态不受影响（resolve
  undefined）、次序契约在真实 timer 联合形态下成立、零 unhandled rejection；宿主规避
  手段经差分对照实证有效。**不触发 fail-needs-fix。**
- 三项修复活链路行为全部属实：P1 同步 throw 收编（含 floating-window 载荷 + 探针灵敏度
  对照）、P2 收编在 real native timer 与敌意 sink 下零逃逸零崩溃、P3 adapter 级次序在
  真实 cordis 4.0.1（fake 与真实 timer 双形态、重入/根拆双触发、dsh 直调双路）下恰一次
  且严格后于 registry shutdown settle。
- 全量 typecheck + test 复现绿（1403/1403 + 0 errors，R2′ 修订后最终态；修订前 1402/1402），
  vitest 触发面两包（namespace-registry 12 文件 / persistence 10 文件）逐文件命中；
  13 AC 不回归（重点 AC9/AC10/AC11/AC12 逐名绿）。
- 唯一遗留：`d183d3b` 未 push → Node 20/24 CI 矩阵无 run 可观测（环境阻塞，交总控 push 后
  收口；本地 Node 24.13.0 全绿已复现）。

**Verdict: pass**

---

## 10. 修订记录（R2′——spec 轴终审整改，2026-08-27）

**发现**（独立 spec 轴终审）：本报告原 11d 用例含 60ms 真实 sleep 驱动 native 到期
（且文件头注误写 40ms，与代码 60ms 不一致）——违反任务简报「测试须确定性
（fake scheduler/受控 gate），禁止真实 sleep」明文约束。

**整改**（按终审给出的拆分路径，验证意图零削减）：

1. **11d 重写为确定性形态**（耗时 2ms，原 sleep 版 62ms）：真实 `TimerService` 经生产同款
   `createCordisRegistryScheduler(ctx)` 真实 ctx.timeout 桥**真实武装** native
   setTimeout（`idleTimeoutMs=300_000` → 测试期内 native 必不到期，零真实时钟依赖）；
   registry 的 idle 回调被透传 wrapper 捕获后**确定性手动触发**。等价性论证（已落纸于
   用例注释）：同步 throw 的收编/逃逸语义位于 `beginIdleClose`（在回调触发者的上游），
   与触发者无关——若收编缺失，异常沿测试调用栈传播 → 用例直接失败，与 11b 的
   `advanceBy` 拒绝同构的判别器。附带增益：真实 disposer 取消语义（registry 的
   clearTimeout 路径）与「武装确证」断言（`armedCallbacks.length===1`）显式入测；
   收尾对全部曾武装的真实 native timer 显式取消（真实 disposer 幂等），事件循环零残留。
2. **11d-SMOKE 新增为显式冒烟**：native 到期链路（native setTimeout 到期 → TimerService
   `dispose(); callback()` → beginIdleClose 同步 throw → 进程存活）保留端到端验证——
   用例名与头注均含「smoke 豁免」与「60ms real sleep（本文件唯一非确定性点）」，豁免
   理由随头注落纸：该到期链路含进程级 uncaughtException 面，无法以 fake scheduler/受控
   gate 等价复刻；确定性分工 = 11b（fake 全链路）+ 11d（真实桥武装 + 确定性触发，除
   「native 到期」外全链路）；参照既有 SA7-P4 烟囱先例（native 到期 happy path 已锚定，
   本冒烟补 throw 形态）。**头注/代码数字一致：60ms = idleTimeoutMs(15ms)×4 余量。**
3. 顺手澄清：`flushMacrotasks` 的 `setTimeout(resolve, 0)` 为 0ms 定时器**轮转**
   （宏任务 checkpoint 的 queue 语义，非墙钟等待——确定性），注释已补。

**整改后复验**（全部后台独立进程 `setsid nohup`）：

```bash
# a) 文件级 verbose（逐名 + 耗时）
pnpm exec vitest run packages/namespace-registry/test/registry-sa7-rev1.test.ts --reporter=verbose
# → 19d ✓ 8ms / 19d-CTRL ✓ 4ms / R5P ✓ 19ms / 11d ✓ 2ms / 11d-SMOKE ✓ 62ms / 11e ✓ 1ms；
#    Test Files 1 passed (1)；Tests 6 passed (6)；Type Errors no errors   （/tmp/sa7-rev1-r2.log）
# b) packages/namespace-registry 全包
pnpm exec vitest run packages/namespace-registry/test/
# → Test Files 12 passed (12)；Tests 162 passed (162)；Type Errors no errors；NR_EXIT=0
pnpm typecheck   # → TC_EXIT=0                                      （/tmp/sa7-nr-final.log）
# c) 全量终态
pnpm typecheck && pnpm test
# → TYPECHECK_EXIT=0；Test Files 117 passed (117)；Tests 1403 passed (1403)；
#    Type Errors no errors；VITEST_EXIT=0                            （/tmp/sa7-final-r2.log）
```

整改不触及任何断言语义面（observer exact cause 恰一次 / entry 移除 / 新 generation /
零 unhandled / 真实桥武装），仅改变触发方式与豁免标注；**Verdict 维持 pass**。

# SA7 动态验证报告 — PR #165 review 八项修订（issue #161 round 2）

**Date**: 2026-08-29 | **Role**: SA7（独立动态验证——未参与本轮 SA1/SA2/SA5/SA6/SA3/SA4 任何产出）
**Worktree**: `/home/wangjian/nomicore-fix-issue-161`（branch `fix/issue-161-on-docs-phase-5-websocket-replication`）
**验证对象**: SA3 实现 commit `4bc57dd1c160746de3b7148302c89ce5c7f02786`（基线 `0a18661`）
**SA7 补充锚 commit**: `218ca3a`（仅测试文件 `packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts`，+832 行；零生产/docs 改动）

## Verdict: **fail-needs-fix**（单项缺陷 F1——D2 负记账；D1/D3/D4/D5 全绿；15 红锚全绿；既有 1996 回归全绿）

---

## 0. Step 0/1 结论

- **Step 0**：SA4 verdict = **pass**（`..._round2_sa4_review.md` L7）→ 合规进入动态验证。
- **Step 1**（SA6 红灯转绿，独立进程后台模式实测）：

```bash
npx vitest run packages/ws-replication/test/ws-replication-review-revisions-r1-r7-red.test.ts \
  packages/ws-replication/test/ws-replication-sa7-hardening-dynamic.test.ts
# → Test Files 2 passed (2); Tests 22 passed (22); Type Errors no errors; exit 0
```

15 例红锚全绿（review-red 14：R1-1/R1-2/R1-3/R2-A2a/R3-1..R3-5/R4-1/R4-2/R6-1/R6-2/R7-1 + sa7-hardening-dynamic D3 改写 1）+ 该两文件既有 7 例保绿。

## 1. SA4 §7 动态重点 D1–D5 逐项验证

新增锚文件 `ws-replication-sa7-round2-dynamic.test.ts`（commit `218ca3a`），全部真实 yjs/Registry/Runtime/Hub/Peer + fake scheduler，零 real sleep、零 skip、零源码 grep 断言。

```bash
npx vitest run packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts
# → Tests 1 failed | 5 passed (6); Type Errors no errors
```

| # | 重点 | 结果 | 关键证据（断言名 → 实测） |
|---|---|---|---|
| **D1** | peer `onConnectionLost` closing/failed 分支 `cleanupResources` 排程 + 跨代安全 | ✅ **绿**（2 锚） | D1a（closing）：closing 期断线（closePeerSide 1001）→ 同步栈内 `disconnected` + **关闭承诺即兑现**（closePromise 微任务内结算，不等 60s closeTimeout）；re-add → 重拨 wire2 → re-OPEN live → 新代订阅注册（`unsubscribe` function）→ peer 写 n=101 送达 hub（`rootValue('hub','n')===101`）——**身份守卫下资源提前释放零跨代误摘**。D1b（failed）：failed 态断线 → `disconnected`+backoff → 重连 re-OPEN → 仍 NOT_FOUND → 再入 `failed`（dialCount 恰 2，无循环无卡死） |
| **D2** | hub 真实过载（live、首次 `declareHubResync`）shed 循环：`pendingDataCount` 恒 ≥ 0、RESYNC 发射不派发 victim 幸存帧 | ❌ **红——发现 F1**（见 §2） | 正向部分全过：RESYNC_REQUIRED ≥1（live 首次声明 ✓）；**声明发射（sendControl→drain 重入）窗口内 victim 幸存帧零派发**（dispatchLog UPDATE 恒 1 ✓——SA4 静态结论「回调窗口结构性不可达」动态证实）；shed 清面 pendingData 归零 ✓；声明后零新 handoff ✓；恢复收敛（round 后新写 peer n=5 ✓）；A7 数值不变量 ✓。**破坏性断言失败**：滞回接纳帧恢复派发后 `channel.pendingDataCount === -1`（期望 ≥ 0） |
| **D3** | GOAWAY drain 窗口 × pong 超时互斥 + 重连 reconcile | ✅ **绿** | 构造：GOAWAY(SERVER_RESTARTING, drain 5000ms)，ping 1000/pong 500 → pong 超时落在 drain 窗口内。实测：同栈 `backoff`（非 blocked）+ 传输同步关闭 + hub 侧收到的 close **恰为 {code:1001, reason:'pong-timeout'}**；收口后旧 wire 零新出站帧（⑦ dispose 非_ready 门零噪声）；hub `connections===0`（close 传播清理）；重拨（25ms）→ wire2 → ready+live → hub 只见 1 连接；**越过 drain deadline 再推 5000ms：wire2 保持开启、ready/live 不动**（`clearGoawayDrain` 生效——若未清除，迟到 deadline 回调会以 'goaway-drain' 关掉 `this.transport`＝新 wire2，锚必红）；断线窗口 hub 写 n=99 经重连 reconcile 双侧收敛；stop 后 stopped（零 timer 残留） |
| **D4** | R2 尾窗 ledger 冲刷回落：emitTail 裁剪 / `controlOutstandingBytes` 归零不误杀 / 真实越限仍触发 | ✅ **绿** | 类级 OutboundQueue（quota 32KiB，highWater 8KiB）：6×8KiB BOOTSTRAP 控制风暴（尾窗 ≈49KiB > 额度）→ **FIFO 冲刷 ≈40KiB** → 检查点：`exhausted===0`（无裁剪则 49KiB>32KiB 必触发——防高估误杀证实）且规则 A paused 旁证（后续 enqueue 零派发）；**全量冲刷** → `flushed=totalEmitted` → emitTail 全裁 → outstanding 归零、恢复派发排队帧；**正向对照**：无冲刷再投 5×8KiB → `exhausted===1`（裁剪不吞真实越限） |
| **D5** | hello 超时 peer 侧孤儿传输竞速窗口（登记观察——设计 §D4 N2，处置归总控） | ✅ **观察完成**（锚绿） | 构造：首代 wire 扣 peer→hub HELLO（hub 收不到 → 起 hub 侧 HELLO_TIMEOUT）；peer `helloTimeoutMs=100` 先行。实测：peer hello 超时 → backoff 且 **`wire1.peerSideClosed===false`（孤儿传输在场——登记项现状证实，非缺陷断言）**；恢复不受影响（重拨 wire2 HELLO 放行 → ready → live）；hub 侧缺省 10s `HELLO_TIMEOUT` fatal(1002) 兜底关闭 hub 半边并 drop 连接（hub 只剩新连接）。**建议随 REPORT.md 开跟踪票（总控裁决）**；本轮不修（设计明文） |

## 2. F1 缺陷详情（唯一 fail 项——D2 负记账）

**一句话**：`enqueueData` 的「shed 循环 → 再判定接纳」路径（A2 滞回接纳路径）中，`onDataShed` 把 channel `pendingDataCount/Bytes` 清零时**把尚未判定、已 handoff 计数的 incoming 帧一并抹除**；该帧随后被接纳入桶、恢复期派发时 `onDataDispatched` 再减一 → **pendingDataCount = −1**。

**复现**（`ws-replication-sa7-round2-dynamic.test.ts` D2 锚，确定性、fake scheduler、约 20ms）：

1. hub→peer 单 ns live；gate 置停；limits：max 64KiB / lowWater 1KiB / highWater 4096 / maxInFlightUpdates 16。
2. 写 #1（8192B 字面 payload）→ 派发（buffered ≈8.2KiB）→ 检查点 → paused。
3. 写 #2..#7 → handoff ×6（`pendingDataCount===6`，桶 ≈49.5KiB queued）。
4. 写 #8 → `enqueueData`：pipeline ≈57.8KiB + 8.2KiB > 64KiB → **shed 循环**（victim=本 ns，桶非空）→ `shedNamespace` → `onDataShed` → **`pendingDataCount: 7(含 #8 的 handoff) → 0`**（`needsResync` 置位、RESYNC_REQUIRED 发射）→ 桶清空。
5. 再判定：8.2+8.2 ≤ 64KiB → **接纳 #8**（入桶；channel 侧记账已为 0）。
6. #9/#10 写被 `deliver` 首行 `needsResync` 守卫丢弃（pending 保持 0）。
7. 恢复：释放 gate → 检查点 rule B → drain 派发 #8 → `onDataDispatched` → **`pendingDataCount = 0 − 1 = −1`**（对象图只读投影直测，终态稳定）。

**机制根因**（frame-io.ts L174-201 × update-channel.ts L125-130）：`onDataShed` 的清零语义前提是「该 ns 的 handed-off-未派发面已全弃」（SA1 §D6 不变量、R6 出口 3）；但在触发面内，incoming 在 `enqueueData` **之前**已 handoff 计数，而 shed 循环先于接纳判定执行——清零时 incoming 未被弃（随后被接纳），前提被打破。SA1 §D1 伪码与实现同序（设计级缺口，非实现走样）；SA4 §2 R1 攻击点②只推演了「回调窗口内幸存帧被派发」路径（经 inFlight-only 窗口门判不可达——本报告 D2 动态证实该结论成立），未覆盖「shed 后接纳帧的迟后派发」路径。

**影响评估**（锚内实测佐证）：

- `overflows()` count 口径（update-channel L136：`inFlight+queued+pendingData`）低估 1 帧 → R6 溢出边界 off-by-one（应溢出的第 N 笔可能放行至 N+1）；每多一次「过载 shed→滞回接纳→恢复」循环再 −1（累计），直到下一次 `onDataShed`/`teardown` 清零复位。
- `deliver` 窗口门（L60：`inFlight+pendingData < maxInFlightUpdates`）等效放宽 1 帧。
- **无数据丢失/收敛破坏**：D2 锚内恢复后 round 收敛（peer n=5）✓、A7 数值不变量 `inFlight+pending ≤ max` 因负值更小仍成立 ✓——这正是既有绿锚（A2 ≤2、A7、R6-1/R6-2 均锚拒纳/溢出路径）未捕获的原因：该路径无任何既有锚断言 `pendingDataCount ≥ 0`。
- 双侧对称：hub（hub-connection sendData）与 peer（peer-connection sendData）共用 OutboundQueue + UpdateChannel——peer 侧同形可达。

**修复方向**（归 SA1/SA3 下一轮，SA7 不改生产代码）：任选其一——(a) 接纳分支为滞回接纳帧补记（新增「re-handoff」出口：accept 后将 incoming 的 count/bytes 重新计入 pending，保持四出口对称）；(b) `onDataShed` 由清零改为按桶内实际弃置帧逐帧减记（破坏面大，需重审 R1-3 (b)）；(c) 触发面判定提前（handoff 前预判接纳，拒纳时不产生 handoff 计数——改动 update-channel 与 enqueueData 契约）。(a) 半径最小；修复后本 D2 破坏性锚即转绿（断言已冻结）。

## 3. 回归与门禁复核（全部独立进程后台模式实测）

| 项 | 命令 | 结果 |
|---|---|---|
| 15 红锚转绿 | `npx vitest run .../ws-replication-review-revisions-r1-r7-red.test.ts .../ws-replication-sa7-hardening-dynamic.test.ts` | **22/22 passed**（15 红锚 + 7 既有）；Type Errors no errors；exit 0 |
| 包级全量（commit 4bc57dd 原状） | `npx vitest run packages/ws-replication` | **16 文件 / 125/125 passed**；Type Errors no errors；exit 0（与 SA3 报告一致） |
| 整仓（含 SA7 新锚） | `pnpm test` | 170 文件：169 passed + 1 failed（仅本报告 D2 破坏性锚）；**2001/2002 passed**——既有 **1996/1996 全绿**（两次运行双证：含锚运行中既有面全绿）；Type Errors no errors |
| 零 skip/伪红 | `grep -rn "\.skip\|\.todo\|\.only" packages/ws-replication/test/*.test.ts` | 0 命中（含新锚文件） |
| 零 real sleep | `grep -n "setTimeout" packages/ws-replication/test/*.test.ts`（排除 clearTimeout） | 0 命中——全部 fake scheduler（`createRegistryTestScheduler`）+ 微任务推进 |
| R7 冻结 grep 锚 ×4 | 见 §9 命令 | 锚1 `512 跳\|TEST_DEFER\|DEFER_MICROTASK_HOPS` → **0**；锚3 `queueMicrotask(` 排除 testing.ts → **恰 1**（peer-connection.ts:36 defaultDefer）；锚4 `512 * 1024` 冻结值 diff（0a18661..4bc57dd）→ **0** |
| R8 冻结 grep 锚 ×2 | `grep -rn "红灯\|SA6 契约\|SA8 放行\|撤销 round" docs/phases docs/protocols`；`grep -rn "round-1\|round 1" docs/phases docs/protocols` | 均 **0 命中** |
| B3 首句保留 | `grep -n "高优先级\|每轮每 namespace最多一个" docs/protocols/instance-replication-v1.md` | §17 段首两短语在位（SA4 已逐字节核验，本轮 grep 复核在位） |

## 4. CI 触发证据（Step 3/4 口径）

- **Step 3（E2E spec）**：本轮设计/实现零 E2E spec 改动 → **不触发**（SA4 §5 同判）。
- **Step 4（vitest package）**：`.github/workflows/ci.yml` `Test` step = `pnpm test`（vitest run --typecheck，include `packages/*/test/**/*.test.ts`）→ **ws-replication 全部测试文件（含 SA3 五处校准文件与本轮新锚）结构性全覆盖**。
- **PR #165 CI 现状**：`gh pr view 165` → OPEN，branch `fix/issue-161-on-docs-phase-5-websocket-replication`，最新 run `33209997984`（test(20)/test(24) 均 SUCCESS）——**但该 run 完成于 2026-08-28，早于 commit `4bc57dd`（未 push，SA3 按 Controller 指令不 push）**。故「本 commit 的 CI 动态触发日志」属环境阻塞项：**push/发布归总控**；push 后以 run log 中 `ws-replication` 包 `Test Files N passed` 摘录为最终动态证据。本地全量动态证据（§3 整仓 1996/1996）已先行。

## 5. 结论与移交

- **D1/D3/D4/D5 动态全绿**；D4 的「防高估误杀 + 真实越限仍触发」与 D3 的「迟到 deadline 幂等」均为本轮新增独立锚（既有锚未覆盖）。
- **F1（D2 负记账）为 SA4 pass 基础上的 SA7 独立发现**——破坏性红灯锚已冻结在 commit `218ca3a`，修复（建议方向 (a)）后应直接转绿。
- D5 孤儿传输观察项：现状证实（peer 侧不关、hub 侧同值 HELLO_TIMEOUT 兜底、恢复无碍）——**跟踪票决策移交总控**（设计 §D4 N2 处置建议）。
- 遗留：`REPORT.md` 与 round-1 遗留工作树改动未触碰（SA3 §5.8 口径，归总控）。

## 6. 验证命令与结果汇总（原文可复跑）

```bash
# 15 红锚 + 既有 7（SA4 pass 前置下的 Step 1）
npx vitest run packages/ws-replication/test/ws-replication-review-revisions-r1-r7-red.test.ts \
  packages/ws-replication/test/ws-replication-sa7-hardening-dynamic.test.ts
# Tests 22 passed (22); Type Errors no errors; exit 0

# 包级回归（commit 4bc57dd）
npx vitest run packages/ws-replication
# Test Files 16 passed (16); Tests 125 passed (125); exit 0

# D1–D5 补充锚（commit 218ca3a）
npx vitest run packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts
# Tests 1 failed | 5 passed (6)——唯一红 = D2 破坏性锚（F1）

# 整仓
pnpm test
# Test Files 1 failed | 169 passed (170); Tests 1 failed | 2001 passed (2002)
# ——唯一红 = D2 破坏性锚；既有 1996/1996 全绿；Type Errors no errors

# 冻结 grep 锚（R7 ×4 / R8 ×2）
grep -rn "512 跳\|TEST_DEFER\|DEFER_MICROTASK_HOPS" packages/ws-replication            # → 0
grep -rn "queueMicrotask(" packages/ws-replication/src | grep -v "src/testing.ts"       # → 恰 1（peer-connection.ts:36）
git diff 0a18661..4bc57dd -- packages/ws-replication/src/defaults.ts \
  packages/ws-replication/test/harness.ts | grep -c "^[+-].*512 \* 1024"                # → 0
grep -rn "红灯\|SA6 契约\|SA8 放行\|撤销 round" docs/phases docs/protocols               # → 0
grep -rn "round-1\|round 1" docs/phases docs/protocols                                  # → 0

# 零 skip / 零 real sleep
grep -rn "\.skip\|\.todo\|\.only" packages/ws-replication/test/*.test.ts                # → 0
grep -n "setTimeout" packages/ws-replication/test/*.test.ts | grep -v clearTimeout      # → 0
```

（全部测试命令经 `setsid nohup bash -c '...' &` 独立进程后台模式执行，日志存 `/tmp/sa7-step1.log`、`/tmp/sa7-fullpkg.log`、`/tmp/sa7-d15-3.log`、`/tmp/sa7-fullrepo2.log`。）

---

**Verdict: fail-needs-fix** —— 唯一缺陷 F1（D2 负记账，破坏性锚可复现、影响面已界定、修复方向已给）；其余全部验证面（15 红锚、包级 125、既有整仓 1996、D1/D3/D4/D5、冻结 grep 锚、零 skip/零 real sleep）全绿。修复 F1 后无需重开八项修订主体——半径限于 `frame-io.ts` 接纳分支或 `update-channel.ts` 记账出口（建议方向 (a)）。

---

# F1 动态复测（revalidation）— commit `06db53c8fe6ca6be4ae9605f5d455bb79aa706bd`

**Date**: 2026-08-29 | **Scope**: 仅 F1 修复面 + 受影响验证（Controller 指令限定）；零生产/测试/docs 改动（本轮 SA7 纯验证）。
**前置**: SA4 F1 复审 verdict = **pass**（`..._sa4_review.md` F1 节末「F1 Verdict: pass——SA7 可进入 F1 动态复测」）。

## R0. 范围与不可变性核验（SA4 声称的独立复核）

```bash
git diff 218ca3a..06db53c -- packages/ws-replication/test/                        # → 0 行（全部测试字节不变——冻结锚不可变 ✅）
git diff 218ca3a..06db53c -- packages/ws-replication/src/hub-connection.ts        # → 0 行（DENY 保持 ✅）
git diff --name-only 218ca3a..06db53c
# → 恰 5 src（frame-io / hub-namespace / peer-connection / peer-namespace / update-channel）+ 2 wiki（dispatch / sa3_impl）——无夹带 ✅
```

修复机制落地确认（只读检查）：`update-channel.ts` wipe-credit 子账本（`uncountedAccepted/uncountedAcceptedBytes`）——handoff **increment-before** → `enqueueUpdate` 布尔回传 → `accepted ∧ needsResync 翻转` 登记信用（**不重计 pending**）→ `onDataDispatched` **信用消费先于减记** → `onDataShed`/`teardown` credit 双清 → 窗口门/溢出双口径均纳入 `uncountedAccepted`（R4-N1 三门和式在位）。

## R1. 冻结锚复跑（零改动 6/6）

```bash
npx vitest run packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts
# → Tests 6 passed (6); Type Errors no errors; exit 0
```

- **D2（F1 破坏性锚）转绿 ✅**——原红断言「恢复派发后 pendingData ≥ 0」现过：滞回接纳帧（#8）派发时消费 wipe-credit 跳过减记，终值 0（非 −1）。
- **D2 原始观测全部保持活性 ✅**：首帧派发 pending===0；#2..#7 每笔后 pending ≥ 0 且触发面前置 ===6；shed 触发面 RESYNC_REQUIRED ≥1（live 首次 declareHubResync）+ **声明发射（sendControl→drain 重入）窗口内 victim 幸存帧零派发（UPDATE 恒 1）**；shed 清面后 pending===0（信用登记不重计——L403 观测面保持）；声明后零新 handoff；恢复后 pending ≥ 0 + A7 窗口 `inFlight+pending ≤ 16` + round 后新写收敛（peer n=5）。
- **D1/D3/D4/D5 零回归 ✅**：D1a（closing 断线承诺兑现 + re-add 跨代零误摘 + 写送达）/ D1b（failed→disconnected→重连→failed）全过；D3（drain 窗口内 pong 超时 close(1001,'pong-timeout') + 迟到 deadline 幂等不关新传输 + 收敛）全过；D4（冲刷回落裁剪不误杀 + 全量冲刷归零 + 真实越限仍触发 exhausted===1）全过；D5（孤儿传输观察 + hub HELLO_TIMEOUT 兜底 + 恢复无碍）全过。

## R2. 包级与整仓

```bash
npx vitest run packages/ws-replication
# → Test Files 17 passed (17); Tests 131 passed (131); Type Errors no errors; exit 0（R4-N3 口径恰 131 ✅）

pnpm test
# → Test Files 170 passed (170); Tests 2002 passed (2002); Type Errors no errors; exit 0
```

包级 131 = 原 125 + SA7 六锚（含 D2 由红转绿）；整仓 2002/2002 全绿（上一轮整仓唯一红即 D2 锚，本轮清零）。15 冻结红锚（review-red 14 + D3 改写 1）与既有全部锚面经包级/整仓全覆盖复核保绿。

## F1 Revalidation Verdict: **pass**

F1（§D9 wipe-credit）修复在冻结破坏性锚下动态转绿且逐子锚观测保持原语义（pending 恒 ≥ 0、RESYNC 显影、幸存帧零派发、A7 窗口、收敛）；D1/D3/D4/D5 零回归；包级 131/131、整仓 2002/2002、Type Errors 零。**本报告 Verdict 由 fail-needs-fix 升级为 pass（F1 已闭合）**——PR #165 八项修订实现 + F1 修复动态验证全数通过；遗留事项不变：D5 孤儿传输跟踪票决策与 CI 动态日志门禁（commit 推送后）均归总控。

（复测命令均经 `setsid nohup bash -c '...' &` 独立进程后台模式执行，日志：`/tmp/sa7f1-frozen.log`、`/tmp/sa7f1-pkg.log`、`/tmp/sa7f1-repo.log`。）

# SA7 动态验证报告 — `@nomicore/ws-replication`（issue #136 切片 6，Phase 3）

**Date**: 2026-08-30（R1）/ R2 / R3 复验轮 / 2026-08-30（R4 复验轮，见文末「SA7 R4 复验节——D2/R4-1 修复复验 + 终局裁决」）
**Verdict（终局，R4）**: **pass** —— R3 的 D2（迟到 cleanup 误退订新 session listener）与并行 SA4 轮的 R4-1/R4-3（代际守卫接线不完备）已由 SA3 R5（commit `12258c2`，仅 `peer-namespace.ts` +38/−21）治本修复：**D2 红锚全链转绿**（跨重连在途 apply → live → writePeer → UPDATE ≥1 + hub 收敛；3/3 确定性）、**R4-1 红锚转绿**（迟到导入零 wire、新 OPEN 先行、零 NAMESPACE_STATE_VIOLATION、收敛 live）；修复形态动态风险扫描无新增风险（epoch 守卫捕获点与最终检查间无 await 翻转窗口、isConnectionDead/epoch 双守卫互补；unsubscribe 句柄语义矩阵全边闭合）；全仓 165 文件 / 1953 测试 + typecheck/diff-check 复跑全绿（与总控亲跑逐值一致）。R3/R2/R1 历史 verdict 原样保留于下。

**R3 Verdict（历史，保留）**: **fail-needs-fix** —— R3 复验：SA6 五条 Spec 红锚（B-1/B-2b/c/d/e）全部转绿、B-2a 闭项探针绿、全仓零意外回归、typecheck/diff-check 全绿；**但动态风险扫描在 B-2d 修复面上发现残留缺陷 D2（MAJOR）**：迟到 cleanup 的 `unsubscribe` 步骤位于「当前 session/lease 判别」守卫之外——跨重连在途 apply 场景下误退订**新** session 的 owned-updates listener → peer→hub live 更新静默停摆（实测 live 后 peer 本地写零 UPDATE 帧、hub 永久缺失，3/3 确定性；红锚已落 `ws-replication-sa7-dynamic.test.ts` D2 IT）。修复面窄（单方法内句柄捕获/守卫内移），无需 redesign。

**R2 Verdict（历史，保留）**: **pass** —— R1 的 D1（watchdog 空闲探测一次性）与 N1（hub hello timer 未 clear）已由 SA3 R3（commit `f175e3e`）治本修复：W1 红锚转绿且全链闭合（armed / ackTimeoutMs 边界节奏 / 重武装 / busy 隔离对照 / 边沿记忆 / teardown 零泄漏）；全仓 163 文件 / 1945 测试 + typecheck 复跑全绿（与总控亲跑逐值一致）；修复形态（重武装先于 probe）经 timer 计量轨迹动态证明无新增风险。R1 fail-needs-fix 依据全部消解。

**R1 Verdict（历史，保留）**: **fail-needs-fix** —— SA4 R2 verdict 为 pass（静态门通过），SA7 在其「动态审核重点 #3」上独立发现一条真实实现缺陷 **D1（hub/peer watchdog 空闲探测不重武装——一次性节奏）**，附可复现红锚（`packages/ws-replication/test/ws-replication-sa7-dynamic.test.ts` W1，现实现实测红）。SA4 清单其余各项（#1/#2/#4/#5）动态复核全部通过或维持登记。修复面窄（`src/fence-watchdog.ts` 单点 + 顺手 N1），不触及架构——无需 redesign。

- **被验实现**: `packages/ws-replication`（基线 `ff50d47..HEAD`：24642a9 + 0cd1ae6 + 4333593/c1ec56c + ade002c + fa6d61c/3a18dfa/784dea5）
- **输入**: 任务简报（含 SA6 全记录）/ 设计定稿 R4.2（§12/§16/§4.3/§23）/ SA4 静态验尸 R2 pass（文末「动态审核重点」）
- **SA6 红灯基线**: 9 文件 70 IT 全绿（Phase 3 终轮，本报告 Step 1 复跑确认）

---

## Step 0 — SA4 verdict 校对

SA4 报告顶部（L4）：`Verdict（当前，R2）: pass` → **进 Step 1**（SA7 不存在「下发」，本报告 fail 为 pass 基础上的独立发现，方向合法）。

## Step 1 — SA6 红灯（回流锚定 F1/F2/F3）复跑

独立进程 `pnpm exec vitest run packages/ws-replication`（/tmp/sa7-pkg.log，exit 0）：

```
Test Files  9 passed (9)
      Tests  70 passed (70)
Type Errors  no errors
```

含 `ws-replication-sa4-f1-f2-f3-red.test.ts`（3 it：F1 hub 溢出声明 / F2 重连超时兜底 / F3 closing 序列纪律）全绿——SA6 红灯锚定链在 SA3 R2 修复后维持绿。**🟢 GREEN → 进 Step 2。**

## Step 2 — SA4「动态审核重点」逐条动态验证

| # | SA4 要求 | 验证方式 | 结果 |
|---|---|---|---|
| **#3** | **hub watchdog 空闲节奏（§12 timer 面 / §16 末行）零覆盖**——须以手动推进 hub scheduler 的专测确认 armed/重武装行为 | 新增专测 `ws-replication-sa7-dynamic.test.ts` **W1**（手动推进 hub scheduler + deep-drain 隔离 busy 微任务节奏 + 注入 scheduler `pending()` 计面观测） | **❌ FAIL —— D1 缺陷（详见下节）**：idle 探测一次性，首次探测后节奏死亡；空闲通道 fence 永不检出。W1 落为红锚 |
| #1（降级建议项） | F1 修复后动态确认：延迟 seam 下 hub 溢出 → wire 出现 RESYNC_REQUIRED → peer 恢复 round → 收敛 | 冻结测试 F1（绿，Step 1）+ 新增 **W2**：hub 本地 20 笔连发（单 lease 并发提交）→ hub session fanout 容量 16 溢出 → watchdog needsResync 边沿 → `declareHubResync` | ✅ PASS：W2 绿——hub 声明恰 1 帧 `RESYNC_REQUIRED{send-queue-overflow}` → peer §10.6 同连接 roundId=2 → hub/peer `n=20` 双向收敛、hub UPDATE<20（丢弃投递由 diff 修复）、零 unhandled。**hub 侧第二溢出检测面（`onWatchdogEdge('needsResync')`，R3 ③ 只盖 peer 侧）就此补上动态覆盖** |
| #2（降级建议项） | F3 修复后动态确认：closing 窗口错序/重复帧 → blocked；seam 撞号修复后不误红 | 冻结测试 F3 + ⑤d 无撞号形态（Step 1 全绿复核） | ✅ PASS（静态已闭，动态维持绿） |
| #4 | R-11 真实背压——切片 7 接入后 SA7 重点，当前结构性不可达，维持关注 | 设计 §23 L856 登记核对 + src 引用面复核 | ✅ 维持登记（不阻塞）：`grep -rn "lowWater\|highWater\|maxQueuedBytesPerConnection\|CONNECTION_BACKPRESSURE" src/` → 仅 `types.ts:26-28`（契约形状）/`validate.ts:111-140`（构造校验）/`defaults.ts:24-26`——**零记账、零行为引用**，与 R-11 登记文逐字一致（v1 内存同步 transport 下结构性不可达）。**切片 7 接入真实 WS 适配层时须复审（bufferedAmount 水位 / 排队字节记账 / round-robin 喂入 / CONNECTION_BACKPRESSURE close(1011) + UPDATE 门序收口）** |
| #5 | R-12 GOAWAY——SERVER_RESTARTING deadline 关闭 + backoff 重连全链路（本切片无覆盖），维持关注 | 设计 §23 L857 登记核对 + 新增 **G1/G2** 动态测试（本切片已实现面） | ✅ 已实现面动态验证通过（G1/G2 绿）；「drain 期停新 OPEN/round」维持切片 9 登记（G1 明确不断言该未实现面）。G1 证据：注入 `GOAWAY{SERVER_RESTARTING,drainTimeoutMs:60}` → deadline 前 `ready` 不动 → `advanceMs(60)` → `transport.close(1001,'goaway-drain')` → 本地 close 事件（真实 WS 语义，经 harness `closePeerSide` 同模交付——makeEnd 不自通知，见测试文件头保真度注记）→ `backoff` + ns `disconnected` → 25ms（full jitter 0.5×50）→ dial#2 → `HELLO/OPEN_NAMESPACE/SYNC_*/SYNC_APPLIED` → `live`，hub/peer 数据不丢（n=42/extra=77）。G2：`SERVER_SHUTTING_DOWN` → 连接 `blocked`（§4.3 reasonCode 分类）且不走 deadline 关闭 |

### 阅读上限合规

Step 2 文档阅读共 3 个（sa4_review / 任务简报 / 设计定稿相关节），≤15 ✓；其余为源码/测试基建读取（写测试所需的工作面）。

---

## D1（MAJOR，本轮 fail-needs-fix 依据）—— watchdog 空闲探测不重武装：一次性节奏

- **静态证据**: `packages/ws-replication/src/fence-watchdog.ts:51-60`——`startIdle()` 到期回调内 `this.idleHandle = undefined; probe(); onEvent(); this.startIdle();`，但**未清 `this.idleArmed`**：递归 `startIdle()` 首行 `if (this.idleArmed) return;` 直接返回——重武装被守卫挡死。`idleArmed` 唯二写点为 `startIdle()`（置 true）与 `teardown()`（置 false）。
- **设计依据**: §16 timer 清单末行「fence/session-溢出 watchdog 空闲节奏……**每 ackTimeoutMs 探测**（……）**+ 重武装**（§12）」；§12 机制 2「**每** ackTimeoutMs 经注入 timer 探测一次……**生产空闲期由该节奏覆盖**」；§12 问题一「协议 §11 要求 hub **主动**在 bump 时发送 IDENTITY_CHANGED……不能等下一笔 peer UPDATE 才被动发现」的空闲期承诺即由此承载。
- **动态证据（独立进程，临时诊断套件跑毕已删；行为链已固化入 W1 红锚）**:
  1. boot 至 live（ackTimeoutMs=10s）：hub scheduler `pending()=2`（watchdog idle + hub hello timer，见 N1）；
  2. `advanceBy(10_000)`（首探测边界）：**`pending()` 2→0——idle timer fire 后未重武装**（应仍 ≥1）；
  3. deep-drain 5,000 让步（> 链预算 4,096）耗尽 busy 微任务节奏 → 空闲期 `bumpHubEpoch()`（bump 字节不经 `subscribeOwnedUpdates`，无通道事件）→ settle → `IDENTITY_CHANGED=0`（对照通过：busy 节奏确已死）；
  4. 推进至 2×ackTimeoutMs（`advanceBy(9_999)`+`advanceBy(1)`）→ **`IDENTITY_CHANGED` 恒 0**；继续推进至 5× → 仍 0，peer ns 投影恒 `live`。
- **影响**: 会话建立后首个 ackTimeoutMs 窗口之外、发生在**空闲通道**上的一切 watchdog 谓词命中（hub：fence/needsResync；peer：needsResync——`src/fence-watchdog.ts` 双侧共用，同缺陷）**永不检出**：peer 在已作废谱系上无限运行（IDENTITY_CHANGED 不发），直到下一笔流量才由 §11.1 围栏钩子被动收口——「主动检出」义务在空闲期静默失效（静默失败立法红线同族；检测延迟无上界）。busy 通道不受影响（微任务节奏照常，W2/R3 ③ 绿即其证）。
- **红锚**: `ws-replication-sa7-dynamic.test.ts` W1——失败信息原文：`idle 探测必须重武装：第二个 ackTimeoutMs 探测边界仍须探测（§16「每 ackTimeoutMs 探测 + 重武装」）: expected [] to have a length of 1 but got +0`（/tmp/sa7-new2.log）。W1 同时覆盖 armed（live 空闲期 `pending()≥1`）/ 节奏（边界 −1 不 fire）/ 重武装（第二次边界须 fire——红锚即此）/ 边沿记忆与 teardown（修复后可达：fence 后恰 1 帧 + `pending()` 严格递减 + 30s 推进零新帧）。
- **处置（回流 SA3）**: 到期回调内重武装前先置 `this.idleArmed = false`（或去守卫直连周期性 `armTimer`）；双侧共用文件单点修复。修后 W1 转绿即 armed/节奏/重武装/边沿/teardown 全链动态闭合。**注意**：修复不得以「延长单次探测」或「删 timer 节奏」替代——§12 明文双节奏（微任务突发 + timer 空闲兜底）缺一不可。

## N1（nano-note，不阻塞，建议与 D1 同修）— hub 侧 hello timer 未按 §16 在 HELLO_ACK 解除

- **静态证据**: `hub-connection.ts:141` 武装 `helloHandle`，全文件无 `clearTimeout(this.helloHandle)`（peer 侧 `peer-connection.ts:496-504` 有完整清除——不对称）。
- **动态证据**: live 空闲期 hub scheduler `pending()=2` 之一；`advanceBy(10_000)` 后随 watchdog 一同 fire，回调守卫 `state === 'handshaking'` 已不成立 → **no-op、零 wire/状态效应**（行为惰性）。
- **影响**: 无行为偏差；仅每连接多挂一个 helloTimeoutMs 空 timer（真实 timer 面下 10s 资源滞留）。§16 行 1「HELLO_ACK 解除」字面未落实。
- **处置**: SA3 顺手在 HELLO_ACK 处理点 clear（一行）。

## 测试侧缺陷记录（本轮自查，非实现问题）

- G1 首版断言误用帧 kind `'OPEN'`（协议实际为 `'OPEN_NAMESPACE'`）→ 修正后绿。该误用**未掩盖任何实现问题**：诊断输出显示 GOAWAY 全链路帧序完整（wire1: `HELLO/OPEN_NAMESPACE/SYNC_STEP1/SYNC_STEP2/SYNC_APPLIED`）。

---

## 新增测试产物

**`packages/ws-replication/test/ws-replication-sa7-dynamic.test.ts`（1 文件 / 4 IT；本轮唯一代码改动，`git status` 干净面仅此未跟踪文件 + 本报告）**

| IT | 状态 | 锚定 |
|---|---|---|
| W1 hub watchdog 空闲节奏（armed @ackTimeoutMs / 重武装 / busy 隔离 / 边沿记忆 / teardown） | 🔴 **红锚（D1，预期红）** | SA4 #3；设计 §12 机制 2 / §16 末行 |
| W2 hub session fanout 溢出 → watchdog needsResync 边沿 → RESYNC 声明 → peer round+1 → 收敛 | 🟢 | SA4 #1 补面（hub 侧第二溢出面，§12 R4.2「声明 + 等待」）；R3 ③ 的 hub 镜像 |
| G1 GOAWAY(SERVER_RESTARTING) deadline close(1001) → backoff → 重连 re-OPEN → live | 🟢 | SA4 #5；设计 §4.3/R-12 已实现面 |
| G2 GOAWAY(SERVER_SHUTTING_DOWN) → blocked | 🟢 | SA4 #5；§4.3 reasonCode 分类 |

纪律核对：零源码 grep 断言（wire 帧 / 状态投影 / 收敛数据 / 注入 scheduler `pending()` 计面）；零 real sleep（fake scheduler + 微任务；hub 侧经 `run.hubNode.scheduler.advanceBy` 手动推进——P-2 缺口补面）；真实 yjs/Registry/Runtime；`collectUnhandledRejections` 探针（W1/W2 断言零 unhandled）。

## 门禁执行记录

| 命令（独立进程） | 结果 | 日志 |
|---|---|---|
| `pnpm exec vitest run packages/ws-replication`（新增测试后） | **10 文件：1 failed（=W1 红锚）\| 9 passed；74 测试：1 failed \| 73 passed；Type Errors no errors；exit 1**（红即 D1 锚，预期） | /tmp/sa7-pkg-final.log |
| `pnpm test`（全仓） | **163 文件：1 failed \| 162 passed；1945 测试：1 failed \| 1944 passed；Type Errors no errors；exit 1**——基线 162/1941 全绿之上**零意外回归**（唯一 fail = W1 红锚；+1 文件 +4 IT 均为本轮新增） | /tmp/sa7-full.log |
| `pnpm typecheck` | **exit 0**（含 `tsc -p packages/ws-replication/tsconfig.json`） | /tmp/sa7-tc.log |
| `git status --short` | 仅 `?? packages/ws-replication/test/ws-replication-sa7-dynamic.test.ts`（未触碰生产代码 ✓） | — |

## Spec 触发证据（Step 3 立法）

**N/A**——本任务设计零 `*.spec.ts`（SA4 §1.3 同判）。

## vitest 触发证据（Step 4 立法，2026-06-15）

**CI Run**: ⛔ **环境阻塞——分支未推送、无 PR**：`gh pr list --head fix/issue-136-on-docs-phase-5-websocket-replication` 为空、`gh run list --branch <branch>` 为空（gh 已认证 welltop-jim-wang，token 有效；最近 run 均属其他分支）。SA7 无 push/建 PR 职权，**CI runner 摘录须待总控 push/PR 后补做**。以下为本地动态门证据 + 静态接线复核：

**本地全量触发证据**（`pnpm test`，/tmp/sa7-full.log）：

```
Test Files  1 failed | 162 passed (163)
      Tests  1 failed | 1944 passed (1945)
Type Errors  no errors
```

| Workspace Package | 触发结果（本地） | 备注 |
|---|---|---|
| **ws-replication**（本任务） | ✓ 10 文件全触发（9 设计冻结/回流文件 + 1 SA7 新增），74 IT，唯一红 = W1 红锚 | 逐文件：ac1-ac2(12)/ac3(4)/ac4(5)/ac5(7)/ac6(7)/ac7(12)/r3-r4(11)/sa4-f1-f2-f3-red(3)/api.test-d(9, TS)/sa7-dynamic(4) |
| namespace-registry | ✓ 全触发全绿 | 既有包零回归 |
| namespace-runtime | ✓ 全触发全绿 | 同上 |
| vfsl | ✓ 全触发全绿 | 同上 |
| doc-runtime | ✓ 全触发全绿 | 同上 |
| persistence | ✓ 全触发全绿 | 同上 |
| replication-protocol | ✓ 全触发全绿 | 同上 |
| vfsl-codegen | ✓ 全触发全绿 | 同上 |
| clock | ✓ 全触发全绿 | 同上 |
| vfsl-protocol | ✓ 全触发全绿 | 同上 |
| dsh-persistence | ✓ 全触发全绿 | 同上 |
| domains/vfs3-assets | ✓ 全触发全绿 | 同上 |

**静态接线复核**（CI 侧待动态补证的前提成立）：`.github/workflows/ci.yml` push/PR 均跑 `pnpm typecheck` + `pnpm test`（node 20/24 矩阵）；`vitest.config.ts` include `packages/*/test/**/*.test.ts` 覆盖本包（P-12 vitest 半句）；根 `package.json` typecheck 枚举含 `packages/ws-replication/tsconfig.json`（0cd1ae6 接线，本轮 exit 0 复核）。

**verdict（本段）**: ✅ 本地 all-vitest-packages-triggered（12 package 全触发）/ ⏸ CI 侧摘录阻塞于「分支未推送、无 PR」——**非 spec-not-triggered 类失败**，待总控 push 后以 `gh run view --log` 补 `Test Files N passed` 原文。

---

## 裁决理由与处置

SA4 动态清单五项中四项（#1/#2/#4/#5）通过或维持登记；**#3 的专测挖出 D1**：`fence-watchdog.ts` 的 idle 探测一次性化使「生产空闲期由该节奏覆盖」的设计承诺落空——空闲通道 fence 检出延迟无上界（静默失败面）。SA4 静态审曾判「startIdle 实现正确，但零覆盖」——动态验证证伪其正确性判断，恰为 SA4→SA7 两层门互补的实证。修复为共用文件单点（回调内清 `idleArmed` 再重武装）+ N1 顺手（hub hello timer clear），不触及架构/契约/wire 行为面。

**Verdict: fail-needs-fix —— SA3 修复 D1（顺手 N1）后 W1 转绿，复跑包级 + 全量 + typecheck 全绿后回 SA4/总控收口。**

## 验证证据总表（命令 + 结果）

| # | 命令（独立进程，setsid nohup） | 结果 |
|---|---|---|
| 1 | `pnpm exec vitest run packages/ws-replication`（Step 1 基线） | 9 文件 / 70 测试全绿，Type Errors no errors，exit 0（/tmp/sa7-pkg.log） |
| 2 | `pnpm exec vitest run packages/ws-replication/test/ws-replication-sa7-dynamic.test.ts` | 4 测试：W1 红（D1 锚）+ W2/G1/G2 绿，Type Errors no errors，exit 1（/tmp/sa7-new2.log） |
| 3 | `pnpm exec vitest run packages/ws-replication`（终轮） | 1 failed（W1）\| 9 passed；74 测试 1 failed \| 73 passed，exit 1（/tmp/sa7-pkg-final.log） |
| 4 | `pnpm test`（全仓） | 163 文件 1 failed \| 162 passed；1945 测试 1 failed \| 1944 passed，零意外回归，exit 1（/tmp/sa7-full.log） |
| 5 | `pnpm typecheck` | exit 0，含 ws-replication 枚举（/tmp/sa7-tc.log） |
| 6 | D1 诊断链（临时套件，跑毕已删） | `pending@live=2` → `advanceBy(10_000)` 后 `pending=0`；deep-drain+bump 后 `IDENTITY_CHANGED=0`；推进至 2×/5× ackTimeoutMs 仍 0、ns 恒 live（/tmp/sa7-diag.log） |
| 7 | `grep -rn "lowWater\|highWater\|maxQueuedBytesPerConnection\|CONNECTION_BACKPRESSURE" packages/ws-replication/src/` | 仅 types/validate/defaults 三文件，零行为引用（R-11 维持） |
| 8 | `grep -n "helloHandle" packages/ws-replication/src/hub-connection.ts` | 仅 :113/:141（武装）——无清除点（N1） |
| 9 | `gh pr list --head <branch>` / `gh run list --branch <branch>` | 双空（未推送/无 PR）→ CI 触发证据环境阻塞 |
| 10 | `git status --short` | 仅新增 `?? packages/ws-replication/test/ws-replication-sa7-dynamic.test.ts` |

---

# SA7 R2 复验节 —— D1/N1 修复复验 + 终局裁决（2026-08-30，同会话第二轮）

**Verdict: pass** —— R1 两条发现治本修复，红锚转绿，全量零回归，修复形态无新增动态风险。

- **被验增量**: `ffe8e84..f175e3e`（SA3 R3：`src/fence-watchdog.ts` D1 修复 +10/−2、`src/hub-connection.ts` N1 修复 +3）——仅 2 个生产文件、11 行插入，零测试改动、零契约面触碰。
- **修复形态核对（源码级）**: `startIdle()` 到期回调现为 `idleHandle=undefined → idleArmed=false → startIdle()（重武装新 timer）→ probe() → onEvent()`——先清守卫再重武装（D1 根因消除）；N1 在 HELLO_ACK 处理同步段 `clearTimeout(this.helloHandle)`（§16 行 1「HELLO_ACK 解除」落实）。

## 一、复验任务 1 —— W1 红锚转绿确认（重武装/边界节奏/teardown 全链）

独立进程 `pnpm exec vitest run packages/ws-replication/test/ws-replication-sa7-dynamic.test.ts`（/tmp/sa7r2-file.log，exit 0）：**4/4 通过（W1/W2/G1/G2）**。W1 通过即下列全链断言逐项成立：armed（live 空闲期 `pending()≥1`）→ 首探测健康零动作 → deep-drain 隔离 + bump 后 busy 对照零帧 → 边界 −1ms 不 fire（`identity@19_999=0`）→ **2×ackTimeoutMs 边界 fire 检出 fence（R1 红锚位，现 `identity@20_000=1`）** → epoch=2 + ns `conflicted` → teardown 后 `pending()` 严格递减 → 30s 追加推进零新帧（边沿记忆 + 零残留活动）。

**timer 计量轨迹（临时诊断套件，跑毕已删；/tmp/sa7r2-diag 快照）——三合一精确证据**：

```json
{"pending_live":1, "pending_after_probe1":1, "identity_after_bump_settle":0,
 "identity_at_19_999":0, "identity_at_20_000":1,
 "pending_after_fence_teardown":0, "identity_at_50_000":1, "pending_at_50_000":0}
```

| 计量点 | R1（缺陷态） | R2（修复态） | 证明对象 |
|---|---|---|---|
| `pending_live` | 2（idle + 永不清除的 hello timer） | **1** | **N1 修复**：HELLO_ACK 同步段解除 hello timer |
| `pending_after_probe1` | **0（节奏死亡）** | **1** | **D1 修复（重武装）**：首探测后下一周期 timer 在位 |
| `identity 19_999→20_000` | 0→0（永不检出） | 0→**1** | **边界节奏**：检出恰在 2×ackTimeoutMs（且由重武装的第二周期 timer 完成——R1 红锚位转绿） |
| `pending_after_fence_teardown` | —（无可清） | **0** | **teardown 零泄漏**（见下节风险分析） |
| `identity_at_50_000` | 0（缺陷态另一面） | 1 | 边沿记忆 + 残留链惰性（零重复帧/零 ERROR） |

## 二、复验任务 2 —— 全量动态回归

| 命令（独立进程） | 结果 | 日志 |
|---|---|---|
| `pnpm exec vitest run packages/ws-replication` | **10 文件 / 74 测试全绿，Type Errors no errors，exit 0**（含 SA7 4 IT + SA6 回流红转绿 3 IT + 冻结 67 IT） | /tmp/sa7r2-pkg.log |
| `pnpm test`（全仓） | **163 文件 / 1945 测试全绿，Type Errors no errors，exit 0**——**与总控亲跑逐值一致**；R1 基线 162/1941 之上仅 +1 文件 +4 IT（SA7 补充测试），零回归 | /tmp/sa7r2-full.log |
| `pnpm typecheck` | **exit 0**（含 `packages/ws-replication/tsconfig.json` 枚举） | /tmp/sa7r2-tc.log |

## 三、复验任务 3 —— D1 修复形态新风险分析（重武装先于 probe 的 teardown 交互）

修复采用「先重武装、后 probe」次序。逐场景核验：

| 场景 | 分析 | 证据 |
|---|---|---|
| probe 触发终局（fence → one-shot 终结器 → finalize → cleanup → `watchdog.teardown()`） | teardown 清除的恰是**本回调刚重武装的下一周期 timer**——零泄漏。次序正确性关键：若反之「先 probe 后重武装」，终局 teardown 先行、随后 arm 会在已收口 watchdog 上留下孤儿 timer（真泄漏）——SA3 选型正确（commit message 明文记录该取舍） | `pending_after_fence_teardown=0`（若泄漏此处=1）；W1 `pending()` 严格递减断言绿 |
| teardown 时序 | `closeSessionAndRelease()` 先 `this.session = undefined`（hub-namespace.ts:799）**再** `watchdog.teardown()`（:800）——回调尾部残留的 `onEvent()` 微任务链（teardown 后重启的 4096 让步链）probe 时 `session()` 恒 undefined → 早退，**惰性有代码级保证**；且该「probe→onEvent」次序为修复前既有形态，非本轮新引入 | `identity_at_50_000=1`、W1 断言 ERROR×0 / 30s 零新帧 |
| 非终局边沿（hub needsResync → `declareHubResync`，无 teardown） | 重武装 timer 存续——恢复期通道探测节奏延续，符合设计（§12 空闲兜底覆盖恢复等待窗） | W2 绿（20 笔连发 → RESYNC×1 → round 2 → 收敛）+ 全量绿 |
| 双重武装 / 重入 | 守卫 `if (this.idleArmed) return` + 回调先清 idleArmed → 任一时刻至多一个在位 timer；外部 teardown（socket close 等）清除在位者；teardown 后新会话 `startIdle()` 重新武装（idleArmed 已 false） | 单线程无交错；W1 全程 pending ∈ {0,1} |
| 双侧对称 | 共用文件单点修复，peer 侧（`peer-namespace.ts:815` 起同样节奏）同步获益 | 包级 74/74 绿 |

**结论：无新增动态风险。** 唯一行为差异（探测节奏由一次性变为周期性）即设计 §16 本义；全量 1945 测试零回归佐证无溢出效应。

## 四、R2 裁决

- D1/N1 修复均为**根因消除**（守卫清除 + 次序选型 / HELLO_ACK 同步解除），非表面补丁；R1 红锚同源场景翻绿，timer 计量轨迹与 R1 缺陷签名逐点对偶消解。
- 范围守卫：`git status --short` 干净（R1 产物已随 ffe8e84 入仓；本轮仅本报告更新）。
- CI 触发证据（Step 4 立法）状态不变：分支仍未推送、无 PR（`gh pr list`/`gh run list` 双空，ahead 13）——**环境阻塞维持**，本地动态门（12 package 全触发 + 全绿）已闭环；CI 侧 `gh run view --log` 摘录仍待总控 push/PR 后补做（非本轮 fail 因素，R1 已如实登记）。

**Verdict: pass** —— SA7 动态验证闭合（SA4 清单 #1/#2/#3/#4/#5 全部落动态证据或维持登记；D1/N1 治本；全仓零回归）。可进总控收口流程。

## R2 验证证据总表

| # | 命令（独立进程，setsid nohup） | 结果 |
|---|---|---|
| 1 | `pnpm exec vitest run packages/ws-replication/test/ws-replication-sa7-dynamic.test.ts` | 4/4 通过（W1 转绿），exit 0（/tmp/sa7r2-file.log） |
| 2 | `pnpm exec vitest run packages/ws-replication` | 10 文件 / 74 测试全绿，Type Errors no errors，exit 0（/tmp/sa7r2-pkg.log） |
| 3 | `pnpm test`（全仓） | 163 文件 / 1945 测试全绿，Type Errors no errors，exit 0——与总控亲跑逐值一致（/tmp/sa7r2-full.log） |
| 4 | `pnpm typecheck` | exit 0（/tmp/sa7r2-tc.log） |
| 5 | timer 计量轨迹诊断（临时套件，跑毕已删） | `pending_live=1 / after_probe1=1 / identity@20_000=1 / pending_after_teardown=0 / identity@50_000=1`——D1 重武装 + N1 解除 + 边界节奏 + teardown 零泄漏四点齐证 |
| 6 | `git show f175e3e --stat` / `-- src` | 2 生产文件 +11/−2；修复形态与 commit message 一致 |
| 7 | `gh pr list --head <branch>` / `gh run list --branch <branch>` | 双空（未推送/无 PR）→ CI 摘录维持环境阻塞登记 |
| 8 | `git status --short` | 干净（本轮仅更新本报告） |

---

# SA7 R3 复验节 —— Spec B-1/B-2 修复复验 + D2 发现（2026-08-30，同会话第三轮）

**Verdict: fail-needs-fix** —— 五条红锚 + B-2a 闭项全绿、全仓零意外回归；但风险扫描发现 **D2（MAJOR）**：B-2d「当前 session/lease 判别」守卫遗漏 `unsubscribe` 面——迟到 cleanup 误退订新 session listener，peer→hub live 更新静默停摆（红锚已落，确定性复现）。

- **被验增量**: `60fbf41..3e1c5f7`（0336dce SA6 五红锚 + 0324d8f SA3 R4 修复 + 2a34d4a/f557b68/3e1c5f7 记录）——修复面 `peer-connection.ts`（connectionEpoch 代际 + sendControl ready 门 + HELLO 直发 + rebuild 通知）+ `peer-namespace.ts`（onRoundSettled 状态守卫 / 迟到续体代际守卫 / 投影先行 / cleanup 当前判别 / lease 静默回收）+ harness `loadGate` 单次消费；合计 3 文件 +105/−28。
- **输入新增**: `wiki/raw/task_phase5-ws-namespace-sync_spec_review.md`（双轴终审 Spec 轴 B-1/B-2 簇）。

## 一、复验任务 1 —— 五条红锚转绿 + B-2a 闭项核验

| 项 | 结果 | 证据 |
|---|---|---|
| B-1 removeTarget×reconcile 竞态 | ✅ 绿——closing 不复活 live、CLOSE_OK/closeTimeout 收口 closed、re-add 触发重建（dialCount +1）→ live | `ws-replication-spec-b1-b2-red.test.ts` 5/5 通过，exit 0（/tmp/sa7r3-spec.log） |
| B-2b 导入迟到遇 disconnected | ✅ 绿——零假迁 reconciling、重连 re-OPEN ×2 → reconcile → live | 同上 |
| B-2c startOpen 迟到续体 | ✅ 绿——迟到续体零 wire + lease 静默回收、重连恒单 OPEN → live | 同上 |
| B-2d 在途 apply 跨重连 | ✅ 绿（主断言面）——投影先行不滞留 live、重连 re-OPEN ×2、旧 ACK 不落新连接、收敛 live + hub/peer n=1 | 同上；**残留缺陷 D2 见下节（主断言未覆盖 post-live peer 写）** |
| B-2e rebuild 不投影 disconnected | ✅ 绿——兄弟 ns 投影 disconnected、重连 OPEN 总数 4、兄弟 ns 后续写不误 failed（仍 live） | 同上 |
| **B-2a 闭项**（无红灯——Registry 无 lease 列表公共观测面） | ✅ **闭项成立**（代码路径 + 后继功能两级）：(a) 代码——迟到导入分支 `releaseLeaseOrNoop(importResult.lease)`（0324d8f diff，§8 L361「仅做静默回收」落实）；(b) 动态——**新增终态变体探针**（SA7 文件 B2a IT，绿）：导入在途 → removeTarget 收口 closed → 迟到导入**零 wire、零状态机迁移、wire 帧冻结**（BOOTSTRAP_ACK×0 / ERROR×0 / 双向帧数不变）→ re-add 重建 → reconcile live → 业务写经后继 lease 双向收敛（hub/peer ext=3——被回收 lease 的 release 未损伤文档/持久化面） | /tmp/sa7r3-file3.log（B2a ✓） |

## 二、复验任务 2 —— 修复形态动态风险扫描

### 风险面 A：connectionEpoch 代际翻转 —— ✅ 无误压制路径

epoch 仅在 `dialNow()` +1（拨号 ⇔ 旧连接已死）：跨代续体必属迟到（§13.4），抑制正确；死亡→拨号之间的 backoff 窗口由 `isConnectionDead()`（'disconnected' 投影，投影先行保证即时置位）覆盖——双守卫互补无缝。同连接恢复 round（§10.5）不拨号 → epoch 稳定 → ACK/Applied 正常（R1 W2 绿 + 本轮全量绿佐证）。requestRebuild → dialNow → epoch+1 + 全控制器 onConnectionLost（B-2e）→ 兄弟在途续体被新连接 openActiveTargets 的重 OPEN 取代——B-2e 红锚绿即该面闭环。未发现「合法续体被误抑制」的反例路径。

### 风险面 B：投影先行 × 在途 apply —— ⚠ 发现 D2（见下节）

正面闭环（B-2d 红锚绿）：投影即时 disconnected → 重连 re-OPEN；旧 ACK/Applied 经代际守卫不落新连接（零 SEQUENCE/SYNC_STATE_VIOLATION）；数据保留（peer n=1 经 round diff 收口）；迟到 cleanup 的 teardown 面被「当前 session/lease 判别」正确保护。**但该守卫漏了 `unsubscribe` 步骤——D2**。

### 风险面 C：sendControl ready 门对 HELLO 的例外时序 —— ✅ 例外正确，一处已审阅行为变化（可接受）

HELLO 在 `dialNow()` 经 `outbound.sendControl` 直发（绕过 ready 门）——握手帧时序不受影响（全量绿佐证）。门对控制器帧的抑制（非 ready 零出站）即 §13.4 迟到纪律的放大器。**已审阅行为变化**：握手期 `connectionFatal`（如 HELLO_TIMEOUT→1002）的 best-effort connection ERROR 帧现被门抑制（`sendControl` 返回 0）——close(1002) + blocked 照常执行；语义可接受（HELLO_ACK 前 framing 未立、ERROR 帧本属 best-effort；无冻结断言依赖该帧——全量绿）。**hub 侧无同类风险**：hub 通道为 per-connection 实例（每次 accept/OPEN 新建），不存在跨代共享控制器。

## 三、D2（MAJOR，本轮 fail-needs-fix 依据）—— 迟到 cleanup 误退订新 session listener（B-2d 守卫遗漏 unsubscribe 面）

- **静态证据**: `peer-namespace.ts` `closeSessionAndRelease()`——入口捕获 `session`/`lease`，`await session.close()`（**S1 屏障 = 在途 apply 排空**）之后、于「当前 session/lease 判别」守卫块**之前**无条件执行 `this.unsubscribe(); this.unsubscribe = undefined;`。屏障期间重连已完成 `tryOpenReplicationSession`：`this.session = S2` + `subscribe()` 把 `this.unsubscribe` 换成新 listener U2——迟到 cleanup 苏醒后 `this.unsubscribe()` **击中 U2**；守卫（`this.session === session && this.lease === lease`）只保护 session/lease/watchdog/round/channel 的 teardown 面。
- **动态证据（确定性 3/3，已固化为红锚）**: B-2d 同构场景（peer saveGate 悬挂 hub→peer UPDATE 的 apply → 断线 → backoff 25ms 重连 → re-OPEN/reconcile，round Step2 apply 排队于 `pendingApplies` 中的悬挂旧 apply 之后、U2 已于 round 启动时订阅）→ 释放 gate（同一微任务级联：旧 apply 迟结算 → round 收口 **live** + S1.close() 解除 → 旧 cleanup 苏醒 → unsubscribe 击杀 U2）→ **live 后 peer 本地写（ext=5）：`UPDATE` 帧数 0（wire2 peer→hub 帧序终于 SYNC_APPLIED）、hub `ext` 恒缺、peer `ext=5`**——peer 投影恒 live、零 ERROR、零 RESYNC、无任何恢复触发（无在途即无 ackTimeout）→ **静默单向发散**（F1 同族立法红线）。
- **红锚**: `ws-replication-sa7-dynamic.test.ts` D2 IT——失败信息原文：`expected 0 to be greater than or equal to 1`（live 后 peer UPDATE ≥1 断言，/tmp/sa7r3-file3.log）。
- **波及面**: 该缺口同样存在于 `onConnectionFatal`（blocked）+ re-add 重建路径（同款迟到 cleanup × 新订阅时序）；hub 侧不受影响（per-connection 实例）。注意 D2 并非 0324d8f 新引入——修复前该场景下迟到 cleanup 会整体 teardown 新连接（更大破坏），守卫收窄破坏面后残留此单点；属 **B-2d 修复的不完全收口**。
- **处置（回流 SA3）**: `closeSessionAndRelease` 入口同步捕获 unsubscribe 句柄（与 session/lease 同款），仅当仍为当前句柄才调用/清除；或把 unsubscribe 调用移入「当前 session/lease」守卫块内。单方法内修复，修后 D2 IT 转绿。

## 四、复验任务 3 —— 全量动态回归

| 命令（独立进程） | 结果 | 日志 |
|---|---|---|
| `pnpm exec vitest run packages/ws-replication/test/ws-replication-spec-b1-b2-red.test.ts` | **5/5 通过，exit 0** | /tmp/sa7r3-spec.log |
| `pnpm exec vitest run packages/ws-replication` | **11 文件：1 failed（=D2 红锚）\| 10 passed；81 测试：1 failed \| 80 passed；Type Errors no errors；exit 1**（红即 D2 锚，预期） | /tmp/sa7r3-pkg2.log |
| `pnpm test`（全仓） | **164 文件：1 failed \| 163 passed；1952 测试：1 failed \| 1951 passed；Type Errors no errors；exit 1**——总控基线 164/1950 全绿之上 +2 IT（B2a 探针 + D2 锚），**零意外回归**（唯一 fail = D2 红锚） | /tmp/sa7r3-full2.log |
| `pnpm typecheck && git diff --check` | **exit 0**（G-1 EOF 修复维持） | /tmp/sa7r3-tc2.log |

## 五、本轮产物与测试侧缺陷记录

- **新增 IT ×2**（`ws-replication-sa7-dynamic.test.ts`，现 6 IT）：B2a 终态变体闭项探针（绿）+ D2 红锚（红，预期）。
- 测试侧缺陷（自查，已修正）：B2a 首版漏 import `deferred`（ReferenceError + typecheck TS2304 同因）——修正后绿；未掩盖任何实现问题。
- 范围守卫：本轮改动仅 SA7 测试文件与本报告（`git status`：`M ws-replication-sa7-dynamic.test.ts` + 本报告；`M task_phase5-ws-namespace-sync_sa4_review.md` 属并行 SA4 复核者，未触碰）；诊断套件跑毕已删；CI 触发证据维持环境阻塞登记（分支未推送/无 PR）。

## R3 验证证据总表

| # | 命令（独立进程，setsid nohup） | 结果 |
|---|---|---|
| 1 | `pnpm exec vitest run packages/ws-replication/test/ws-replication-spec-b1-b2-red.test.ts` | 5/5 通过（B-1/B-2b/c/d/e 全转绿），exit 0（/tmp/sa7r3-spec.log） |
| 2 | `pnpm exec vitest run packages/ws-replication/test/ws-replication-sa7-dynamic.test.ts` | 6 IT：1 failed（D2 锚）\| 5 passed（W1/W2/G1/G2/B2a），exit 1（/tmp/sa7r3-file3.log） |
| 3 | `pnpm exec vitest run packages/ws-replication` | 11 文件 81 测试：1 failed（D2 锚）\| 80 passed，Type Errors no errors，exit 1（/tmp/sa7r3-pkg2.log） |
| 4 | `pnpm test`（全仓） | 164 文件 1952 测试：1 failed（D2 锚）\| 1951 passed，Type Errors no errors，exit 1——零意外回归（/tmp/sa7r3-full2.log） |
| 5 | `pnpm typecheck && git diff --check` | exit 0（/tmp/sa7r3-tc2.log） |
| 6 | D2 定向诊断（临时套件，跑毕已删；3/3 复现） | `peerExt=5 / wire2PeerUpdates=0 / hubExt 缺失`，wire2 p2h 帧序终于 SYNC_APPLIED——live UPDATE 通道静默死亡实证 |
| 7 | `git show 0324d8f --stat / -- src` | 3 文件 +105/−28；修复形态与 commit message 一致（epoch 守卫/投影先行/当前判别/sendControl 门逐点核对） |
| 8 | `git status --short` | 本轮仅 `M ws-replication-sa7-dynamic.test.ts` + 本报告（sa4_review.md 属并行 SA4 复核者） |

---

# SA7 R4 复验节 —— D2/R4-1 修复复验 + 终局裁决（2026-08-30，同会话第四轮）

**Verdict: pass** —— D2 与 R4-1 治本修复，红锚全链转绿（确定性 3/3），风险扫描无新增面，全仓零回归。

- **被验增量**: `d112647..f49f12d`（6ab9e32 SA4 R4-1 红锚 + R-13 登记 / 12258c2 SA3 R5 修复——仅 `peer-namespace.ts` +38/−21 / d112647·f49f12d 记录）。
- **修复形态核对（源码级）**: (a) **R4-2/D2**——`closeSessionAndRelease` 入口捕获 `unsubscribe` 句柄，退订/清空移入「`this.session === session && this.lease === lease`」当前身份守卫块内、且加 `this.unsubscribe === 捕获值` 双确认（迟到 cleanup 不再触碰新 listener）；(b) **R4-1/R4-3**——导入续体（`onBootstrapSnapshot` async 入口）与 `openSessionAndStartRound` 均捕获 `connectionEpoch`，`importReplica`/`openReplicationSession` 每个 await 之后按「`isConnectionDead() ∨ epoch !== 当前`」判别：迟到交付物静默回收（lease/session）、零 wire、零状态机迁移（不发迟到 BOOTSTRAP_ACK/STEP1）。

## 一、复验任务 1 —— D2 红锚全链转绿确认

独立进程 `pnpm exec vitest run packages/ws-replication/test/ws-replication-sa7-dynamic.test.ts`（/tmp/sa7r4-file.log，exit 0）：**6/6 通过**——D2 IT 全链闭合：跨重连在途 apply（saveGate 悬挂）→ 断线 → backoff 25ms 重连 → re-OPEN ×2 → 释放 gate → round 收口 **live** → **writePeer(ext=5) → 当前连接 UPDATE ≥1 + hub `ext=5` + peer `ext=5` 双向收敛**（R1 红锚位「`expected 0 to be ≥ 1`」翻绿）——新 session listener 存活、上行通道畅通。`-t "D2"` 三连跑 3/3 绿（确定性）。

## 二、复验任务 2 —— R4-1 红锚转绿确认

独立进程 `pnpm exec vitest run packages/ws-replication/test/ws-replication-sa4-r4-1-red.test.ts`（/tmp/sa7r4-r41.log，exit 0）：**1/1 通过**——三锚全绿：① 双向零 `NAMESPACE_STATE_VIOLATION`（旧续体 BOOTSTRAP_ACK/STEP1 不再落新连接）；② wire2 首个非握手帧 = `OPEN_NAMESPACE`（迟到续体零 wire、新 OPEN 先行）；③ 收敛 `live` + hub/peer `n=42`（R4-1 场景的原「ns 永久 failed」面消除）。结构性 staging（Registry 每-ns carrier FIFO → 释放门闩时 state 恒 'opening'——isConnectionDead 失效域）经 epoch 比对兜底后闭环。

## 三、复验任务 3 —— 修复形态动态风险扫描

### 风险面 A：epoch 守卫翻转面 —— ✅ 无翻转窗口/无误压制

- **捕获点→最终检查间无翻转窗口**：导入续体「tryOpen 后 epoch 检查 → sendChecked(BOOTSTRAP_ACK)」与 `openSessionAndStartRound`「epoch 检查 → setState('reconciling')/startRound」均为同步段（无 await）——检查通过后至帧发出/round 启动之间连接代际不可能翻转；round 内帧另有 B-2d 的 applyStep2/applyRemoteUpdate epoch 守卫 + sendControl ready 门双层兜底。
- **无误压制**：epoch 仅 `dialNow()` +1（拨号 ⇔ 旧连接已死）——续体 epoch ≠ 当前 ⇔ 跨代 ⇔ 迟到（§13.4），抑制恒正确；死亡→拨号之间的 backoff 窗由 `isConnectionDead()`（投影先行保证即时 'disconnected'）覆盖——双守卫互补、无公共失效域（R4-1 红锚即专测 'opening' 停留域的 epoch 兜底面）。
- 同连接恢复 round（§10.5，不拨号）epoch 稳定——W2 绿（本轮 6/6 内）佐证。

### 风险面 B：unsubscribe 守卫句柄语义 —— ✅ 语义矩阵全边闭合

| 场景 | 捕获值 vs 当前值 | 行为 | 动态/代码证据 |
|---|---|---|---|
| 正常收口（无重连穿插） | 三者同（session/lease/unsubscribe） | 退订捕获句柄 + 清空 + teardown ——正常 unsubscribe 功能无损 | B2a 探针（本轮 6/6 内）：re-add → live → writePeer 收敛 = 正常路径退订后新 listener 全功能 |
| 迟到 cleanup（跨重连在途 apply，D2 场景） | session/lease 失配 → 外层守卫 false | **不退订任何句柄**（新 listener 保全）；旧 lease 照常 release | D2 锚转绿（3/3）——live 后 writePeer UPDATE ≥1 + hub 收敛 |
| 捕获时 undefined、await 期间新订阅 | `undefined !== undefined` → false | 不误杀新 listener | 代码级（`unsubscribe !== undefined` 条件）+ 全量绿 |
| 内层 `this.unsubscribe === 捕获值` 条件 | 外层失配时恒不到达 | 冗余但安全（unsubscribe 替换必然伴随 session 替换） | 代码级 |
| 旧 listener（U1）滞留 | 迟到路径不退订 U1 | U1 挂在已 close 的 S1 上——session.close() 内部回收，无泄漏面 | registry session close 语义（§13.2 barrier） |

### 其他

- 修复仅触 `peer-namespace.ts` 单文件 +38/−21，零契约/wire 行为面变化（无新帧、无码变更）。
- hub 侧不受影响（per-connection 实例，无跨代共享控制器——R3 节结论维持）。

## 四、复验任务 4 —— 全量动态回归

| 命令（独立进程） | 结果 | 日志 |
|---|---|---|
| `pnpm exec vitest run packages/ws-replication` | **12 文件 / 82 测试全绿，Type Errors no errors，exit 0**（含 SA7 6 IT〔W1/W2/G1/G2/B2a/D2 全绿〕、Spec B-1/B-2 5 IT、SA4 R4-1 1 IT、F1-F3 3 IT、冻结 67 IT） | /tmp/sa7r4-pkg.log |
| `pnpm test`（全仓） | **165 文件 / 1953 测试全绿，Type Errors no errors，exit 0——与总控亲跑逐值一致**（R3 基线 164/1952 上 +1 文件〔R4-1 锚〕+1 IT，D2 锚转绿） | /tmp/sa7r4-full.log |
| `pnpm typecheck && git diff --check` | **exit 0** | /tmp/sa7r4-tc.log |

## 五、R4 裁决

- D2/R4-1/R4-3 修复均为**根因消除**：unsubscribe 收进当前身份守卫（非「重订阅补偿」类补丁）、epoch 判别补全到每个 await 续体（结构性 'opening' 失效域闭环）——R3 红锚同源场景翻绿（3/3 确定性），R4-1 三锚全绿。
- SA7 四轮累计发现（D1 watchdog 节奏 / N1 hello timer / D2 unsubscribe 误杀）全部治本闭合；SA4/Spec 各红锚链（F1-F3、B-1/B-2、R4-1）在 SA7 会话内逐轮复验转绿。
- 范围守卫：本轮零代码改动（`git status` 干净——R3 产物已随前序 commit 入仓；本轮仅更新本报告）。CI 触发证据维持环境阻塞登记（分支未推送/无 PR，非 fail 因素）。

**Verdict: pass** —— SA7 动态验证四轮闭合。可进总控收口流程（push/PR 后补 CI `gh run view --log` 摘录）。

## R4 验证证据总表

| # | 命令（独立进程，setsid nohup） | 结果 |
|---|---|---|
| 1 | `pnpm exec vitest run packages/ws-replication/test/ws-replication-sa4-r4-1-red.test.ts` | 1/1 通过（三锚全绿），exit 0（/tmp/sa7r4-r41.log） |
| 2 | `pnpm exec vitest run packages/ws-replication/test/ws-replication-sa7-dynamic.test.ts` | 6/6 通过（含 D2 全链转绿），exit 0（/tmp/sa7r4-file.log） |
| 3 | 同上 `-t "D2"` ×3 | 3/3 通过——D2 转绿确定性 |
| 4 | `pnpm exec vitest run packages/ws-replication` | 12 文件 / 82 测试全绿，Type Errors no errors，exit 0（/tmp/sa7r4-pkg.log） |
| 5 | `pnpm test`（全仓） | 165 文件 / 1953 测试全绿，Type Errors no errors，exit 0——与总控亲跑逐值一致（/tmp/sa7r4-full.log） |
| 6 | `pnpm typecheck && git diff --check` | exit 0（/tmp/sa7r4-tc.log） |
| 7 | `git show 12258c2 --stat / -- src` | 单文件 +38/−21；修复形态与 commit message 逐点一致（epoch 捕获/续体判别/unsubscribe 守卫内移） |
| 8 | `git status --short` | 干净（本轮仅更新本报告） |

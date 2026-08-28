# SA7 动态验证报告 — `@nomicore/ws-replication`（issue #136 切片 6，Phase 3）

**Date**: 2026-08-30
**Verdict**: **fail-needs-fix** —— SA4 R2 verdict 为 pass（静态门通过），SA7 在其「动态审核重点 #3」上独立发现一条真实实现缺陷 **D1（hub/peer watchdog 空闲探测不重武装——一次性节奏）**，附可复现红锚（`packages/ws-replication/test/ws-replication-sa7-dynamic.test.ts` W1，现实现实测红）。SA4 清单其余各项（#1/#2/#4/#5）动态复核全部通过或维持登记。修复面窄（`src/fence-watchdog.ts` 单点 + 顺手 N1），不触及架构——无需 redesign。

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

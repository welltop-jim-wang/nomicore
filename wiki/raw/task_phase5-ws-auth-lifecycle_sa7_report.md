# SA7 动态验证报告 — issue #138 Phase 5 切片 7：实例认证与连接生命周期

**Date**: 2026-08-29
**Reviewer**: SA7（Dynamic Verifier）
**Worktree**: `/home/wangjian/nomicore-fix-issue-138` @ `556d6da`（实现）+ `f749c89`（档案）；SA7 新增 1 个补充测试文件（见 §三）
**任务类型**: feature（SA5 N/A）
**Verdict**: **pass**（SA4=pass 前提下独立动态验证通过；1 项 CI 触发证据因分支未推送属环境阻塞登记，非触发缺陷——见 §五）

---

## Step 0 — SA4 verdict 校对

- `wiki/raw/task_phase5-ws-auth-lifecycle_sa4_review.md` 顶部：`**Verdict**: **pass**`（行 6）。
- 操作：进入 Step 1。SA4 动态审核重点 D1–D5 全部处置（§二）。

## Step 1 — SA6 红灯测试（第二关）

命令（独立后台进程，无端口依赖）：

```text
node node_modules/vitest/vitest.mjs run \
  packages/ws-replication/test/ws-replication-auth-lifecycle-red.test.ts \
  packages/ws-replication/test/ws-replication-sa7-dynamic.test.ts --reporter=verbose
```

结果（verbose 逐 IT 摘录）：

```text
Test Files  2 passed (2)
      Tests  21 passed (21)          ← 红灯契约 15 IT 全绿（#1–#10 + A2-a/b/c/d/e）
Type Errors  no errors               ← G1 改锚（sa7-dynamic:189 'draining'）+ G2/W1/W2/B2a/D2 同绿
EXIT=0
```

**[Step 1 结论] SA6 红灯：🟢 GREEN → 进入 Step 2。**

---

## Step 2 — SA4「动态审核重点」逐条验证（D1–D5）

验证载体：SA7 新增补充测试 `packages/ws-replication/test/ws-replication-sa7-r1-transport-auth.test.ts`
（5 IT，真实 TCP loopback + 真实 timer + 真实 Registry 双实例；传输适配器形态同
`sa7-r2-transport` 的 TcpTransport——4B 长度前缀成帧、`onMessage` 注册即同步重放积压、
`bufferedAmount = socket.writableLength` 真值；增认证窗口观测钩子）。运行命令与结果：

```text
node node_modules/vitest/vitest.mjs run \
  packages/ws-replication/test/ws-replication-sa7-r1-transport-auth.test.ts --reporter=verbose
→ Test Files 1 passed (1) | Tests 5 passed (5) | Type Errors no errors | EXIT=0
```

### D1 — 全仓 suite `Errors 2` 基线归属 → ✅ 非 ws-replication、非任何包测试代码（vitest 自身 RPC 噪声）

独立全仓运行（后台独立进程，启动于 SA7 新增文件创建**之前**——与 SA4 基线同构可比）：

```text
node node_modules/vitest/vitest.mjs run
→ Test Files 171 passed (171) | Tests 1992 passed (1992) | Type Errors no errors | Errors 2 errors
   Duration 487.52s | EXIT=1（vitest 对 unhandled errors 置非零退出，测试本体全绿）
```

`Errors 2` 归属摘录（log 原文，两条完全同型）：

```text
Unhandled Error
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
 ❯ Object.onTimeoutError node_modules/.pnpm/vitest@3.2.7_*/node_modules/vitest/dist/chunks/rpc.-pEldfrD.js:53:10
 ❯ Timeout._onTimeout node_modules/.pnpm/vitest@3.2.7_*/node_modules/vitest/dist/chunks/index.B521nVV-.js:59:62
 ❯ listOnTimeout node:internal/timers:605:17
 ❯ processTimers node:internal/timers:541:7
```

**判定**：栈帧全部位于 `node_modules/vitest/dist`（worker↔main 的 `onTaskUpdate` RPC 超时）+
`node:internal/timers`——**零包测试代码 involvement**；171 文件/1992 用例全绿与 SA4 记录
逐数一致。结论：vitest 框架级 infra 噪声（本沙箱并行负载下偶发），**非本切片引入**。
封口条件达成（D1 动态确认完毕）。

### D2 — 真实 WS 栈 bearer 通道 → ⚠ 结构性 N/A（切片 9 前无生产注入点；静态面已封口，动态面移交切片 9）

SA4 判断「切片 9 composition root 前无生产注入点」经动态复核成立——全仓 grep 证据
（全部空集）：

| grep | 结果 |
|---|---|
| `createHubReplication\|\.accept(`（packages/apps/domains/src，排除 packages/ws-replication/） | **零命中**（无包外消费方） |
| `from 'node:http'\|from 'ws'\|require('ws')\|upgrade`（packages/*/src/） | **零命中**（无 HTTP Upgrade/ws 栈接入点） |
| `console\.\|process\.env`（packages/ws-replication/src/） | **零命中**（无日志/env 落盘面） |
| `token` × `url\|query\|log`（packages/*/src/） | **零命中**（无 token 入 URL/日志模式） |

契约面（`types.ts:81-83`）：`HubUpgradeRequest { readonly token?: string }`——token 为
类型化字段，**与 URL/query 无任何耦合**（wire 半边 AC-7 由红灯 #1 全字节扫描已锚：token 零上 wire）。
**「真实 HTTP Upgrade → header 取值 + 网关日志零 token」的动态验证随切片 9 composition root
落地后补做**（届时验证点：header 注入 + 访问日志扫描）。本轮按 N/A-deferred 登记，非缺陷。

### D3 — 认证期早到帧洪泛资源界（真实 socket + 内存观测）→ ✅ 三探针全过

**测量学声明**：RSS 为钝器（glibc arena 滞留——本机实测洪泛后 RSS 不随 GC 回落，见
`rssDelta=77.5MiB` vs `extDelta=17.1MiB`）；本报告资源断言一律采用 `process.memoryUsage().external`
（GC 两轮后 = 活对象外部内存，免疫分配器滞留噪声；`--expose-gc` 经 v8 flag 回退可得，
本次运行 `gc=expose-gc`）。RSS 原始读数仍随附作参考。

| 探针 | 断言与实测 | 结果 |
|---|---|---|
| **①条数界洪泛**：未认证 raw socket 灌 40×1MiB（40MiB 上 wire） | 第 17 帧即 `close(1008, 'upgrade-frame-limit')`；`hub.connections.length===0`（零协议连接分配）；`framesParsed=17`（第 18 帧起零进入任何缓冲）；活外部内存增量 **17.1MiB ≤ 24MiB**（结构界 16×1MiB + 余量；若第 18+ 帧被缓冲将 ≥40MiB） | ✅ |
| **②认证等待封顶 + 回收**：界内 16×1MiB，验证器挂起，`helloTimeoutMs=2000`（时间面 seam；limits 零覆写） | 2s 到点 `close(1008, 'upgrade-timeout')`、零分配；持有态活外部内存增量 **17.0MiB ∈ [8,40]**（16MiB 载荷被有界缓冲真实持有，非静默丢弃；≪16×maxFrameBytes=128MiB 结构界）；迟归验证器放行后 **1.0MiB**（回收 ≥94%，`≤ held×50%` 断言过）；迟归不复活（放行后 `connections===0`）；参考 RSS：rawPeak 56.4 → final 0.1MiB | ✅ |
| **③单帧界**：首帧 maxFrameBytes+1（8MiB+1，真实 TCP 分段重组） | `close(1009, 'upgrade-frame-limit')`；零协议连接分配；**零协议帧**（`hubSent.length===0`——拒绝先于任何 FSM 分配） | ✅ |

**观察项（非缺陷，设计一致性确认）**：帧 17 拒绝路径的早到监听**有意保留**（设计 §8.3 L780
「后续灌帧被 listener 幂等早退 + 已关 transport 双重吸收」），其闭包使被拒连接的早到缓冲
（≤16×maxFrameBytes）驻留至 **transport 对象被服务器丢弃**为止（SA7 中间仪器实测：transport
被测试引用时迟归放行后 ext 不回落 20.8→20.8MiB；超时路径 detachEarly 后放行即回落
② 17.0→1.0MiB）。驻留逐连接有界、transport 已关（1008/1009）、随连接对象生命周期释放——
在设计「资源账上界 16×maxFrameBytes + helloTimeoutMs / 每 accept」记账内。**卫生建议**（随
切片 8/9 回顾，非本轮义务）：门 4 迟归收口路径（hub-connection.ts:158/165）可补一次
`detachEarly()` 缩短驻留窗口，效果纯增益、零契约影响。

### D4 — GOAWAY → close(1001) 真实 TCP 次序 → ✅

真实 TCP 全栈（DEFAULT_PEER_VERIFIER 快速验证器 → ready → ns live），`hub.close()` 后在
peer 侧**原始 socket**（独立于适配器的纯 wire 观测器）记录事件序：

```text
wireEvents: [... 'frame:GOAWAY', 'socket-close']      ← GOAWAY 帧先于 close 事件
GOAWAY: reasonCode='SERVER_SHUTTING_DOWN', drainTimeoutMs>0（closeTimeoutMs 缺省 5000）
hub 侧终局: meta.hub = { code: 1001, reason: 'hub-shutdown' }
wireFrames: 零 ERROR（优雅停机——§7.2 帧序保证在真实 TCP 半关闭下成立）
peer 终态: blocked（SERVER_SHUTTING_DOWN 永久类分类，§15.1）
断言: goawayIndex(≥0) < closeIndex —— index 序断言硬性成立
```

### D5 — 真实 TcpTransport × 认证窗口叠加（无双重投递）→ ✅

同一 hub/namespace 上两形态各一连接（`verifyToken` 门控挂起 = 真实异步认证窗口）：

- **形态一 `after-first-frame`**（数据先于注册到达 → pendingFrames 积压，适配器在首帧入积压时
  同步发起 accept → 注册期同步重放——**确定性触发积压路径**）：放行前实测
  `hubTransport.framesReceived ≥ 1`（HELLO 字节确在认证窗口内早到）、
  `replayedFromBacklog ≥ 1`（积压重放路径确实走了）、`connections===0`（窗口内零分配）；
  放行后 → ready → live。
- **形态二 `immediate`**（注册先于数据 → 直达路径，gate 已开 = 即时验证器）：ready → live。

两形态主断言（设计 A3「二者叠加无双重投递」的动态面）：

```text
HELLO_ACK 恰 1（每连接）；ERROR=0；RESYNC_REQUIRED=0；SEQUENCE_VIOLATION 不可能出现
（重复投递必落 HELLO_ACK×2 或 CONNECTION_POLICY_VIOLATION/SEQUENCE ERROR——均被帧计数捕获）
verifyCalls 每连接恰 1 次记账；双向收敛：peer 写 n=41/43 → hub 收敛；hub 写 n=42 → peer 收敛
```

---

## 三、SA7 产出（补充测试，SA7-owned）

| 文件 | 内容 |
|---|---|
| `packages/ws-replication/test/ws-replication-sa7-r1-transport-auth.test.ts`（新增，5 IT，~740 行） | D3 三探针（条数界洪泛/封顶+回收/单帧界）+ D4（GOAWAY→close TCP 次序）+ D5（认证窗口×积压重放叠加，双形态）。真实 TCP loopback（server.listen(0) 临时端口，无固定端口依赖）；GC 诱导优先 `--expose-gc`（v8 flag 回退）+ 分配压力兜底 |

回归整合验证（本文件并入后全包）：

```text
node node_modules/vitest/vitest.mjs run packages/ws-replication/test/ --typecheck
→ Test Files 19 passed (19) | Tests 126 passed (126) | Type Errors no errors | EXIT=0
   （SA4 基线 18 文件/121 用例 + 本文件 5 IT = 19/126，零既有面扰动）
```

诊断日志（`[SA7-DIAG]` 前缀，随测试 stdout 留档）：

```text
[SA7-DIAG] D3-① flood40MiB framesParsed=17 extDeltaAfterClose=17.1MiB rssDelta=77.5MiB
[SA7-DIAG] D3-② cap16MiB extHeldDelta=17.0MiB extReleasedDelta=1.0MiB rssRawPeak=56.4MiB rssSteady=56.0MiB rssFinal=0.1MiB gc=expose-gc
```

**可重复性**：单文件独立复跑一趟全绿（5/5，EXIT=0），external 系读数逐位复现
（17.1 / 17.0 / 1.0MiB）；同趟 RSS 读数漂移（77.5→81.2、56.4→22.5MiB）——印证资源断言
弃 RSS 用 external 的测量学选择。

未修改任何生产代码（`git status`：仅新增本测试文件 + 本报告；DENY LIST 零触碰）。

---

## 四、Spec 触发证据（Step 3，verdict 升级 — 2026-06-09 立法）

本任务 SA1 设计**零新增/改动 `*.spec.ts`**（E2E 面）——**N/A**（SA4 §1.3 同判）。

## 五、vitest 触发证据（Step 4，verdict 升级 — 2026-06-15 立法）

### CI Run 摘录——⚠ 环境阻塞登记（非 vitest-package-not-triggered；先例：issue #73 SA7 报告同款处置）

- 本分支 `fix/issue-138-on-docs-phase-5-websocket-replication` **未推送**（`git log origin/<branch>` 无此分支）→ GitHub 无本分支任何 CI run/PR（`gh run list --branch <branch>` 空；gh 已登录，其他分支 run 正常可见）。push/PR/CI 观察归总控（SA7 职责边界）。
- **静态门禁（SA4 §1.4 已 pass）**：CI `Test` step = `pnpm test` = `vitest run --typecheck`；根 `vitest.config.ts` include `packages/*/test/**/*.test.ts`（typecheck 另含 `*.test-d.ts`）→ 本切片全部新增/改动 test 文件（含 SA7 本轮新增的 `ws-replication-sa7-r1-transport-auth.test.ts`）**确定落入** CI 触发范围。
- **本地动态替证（本轮实跑）**：与 CI 完全同构的收集/运行面在本机三趟全绿——单文件（5/5）、双文件红灯契约（21/21）、全包 `--typecheck`（19 文件/126 用例/Type Errors 0/EXIT=0）。
- **CI 后收口步骤（移交总控）**：PR 建立后 `gh pr view <PR> --json statusCheckRollup` → 取 `Test (20)` / `Test (24)` job log，对 `ws-replication` 包 grep `Test Files.*passed`（预期 19 文件含 `ws-replication-sa7-r1-transport-auth`）+ 全仓 `1992+5=1997` 用例级核对。

| Workspace Package | CI Step Name | 触发结果 | 证据 |
|---|---|---|---|
| ws-replication | Test (`pnpm test` → vitest run --typecheck, matrix node 20/24) | ⚠ CI run 待发布后摘录（分支未推送） | 静态：SA4 §1.4 pass（include 模式覆盖）；动态：本地同构命令 19 文件/126 用例/EXIT=0 |

**verdict**: ⏸ CI 侧证据挂起（环境阻塞：分支未推送）——非 `vitest-package-not-triggered`；不构成本轮 FAIL 依据。

---

## 六、结论

- **SA6 红灯契约**：15/15 全绿（含 G1 改锚面、A2-a..e）——Step 1 通过。
- **D1**：`Errors 2` = vitest worker RPC infra 噪声，非本切片、非任何包测试代码——封口。
- **D2**：真实 WS bearer 通道动态面随切片 9 补（静态面全封口：类型化 token 字段、零包外消费方、零日志/env 面、token 零上 wire）——N/A-deferred 登记。
- **D3**：洪泛资源界三探针全过（条数界/封顶/单帧界；活外部内存 17.1/17.0→1.0MiB 实测，界内驻留真实、迟归放行回收 ≥94%）。
- **D4**：GOAWAY 先于 close(1001) 的真实 TCP 次序实测成立；peer 终态 blocked 正确。
- **D5**：认证窗口 × 积压重放叠加恰一次投递（双形态恰 1 HELLO_ACK、零 ERROR、双向收敛）。
- **全包回归**：19 文件/126 用例/Type Errors 0/EXIT=0，零既有面扰动。
- **备忘移交**：① D2 的 header 注入 + 网关日志动态验证（切片 9）；② 迟归收口路径补 `detachEarly()` 卫生建议（切片 8/9 回顾，非阻塞）；③ CI vitest 触发证据按 §五步骤收口（总控 push 后）。

**Verdict: pass** —— 动态验证范围内全项通过；唯一未收口项为 CI run log 摘录（环境阻塞：分支未推送，移交总控，不影响本轮裁决）。

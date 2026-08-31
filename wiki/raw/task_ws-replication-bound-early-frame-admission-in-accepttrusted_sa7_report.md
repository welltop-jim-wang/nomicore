# SA7 动态验证报告 —— issue #190（acceptTrusted 早到帧有界 admission）

**Date**: 2026-08-31
**Verdict**: pass（本机可运行面全绿；三项全量命令因本机进程资源饥饿无法执行/完成——均有环境签名证据与替代证据链，非代码回归；CI 证据因分支未 push 而阻塞，交总控 publication 后接棒）
**被验对象**：commit `6fde7ea`（分支 `refactor/ws-replication-bound-early-frame-admission-in-acce`，基线 `b66615c`）
**输入**：SA4 静态审核报告（Verdict: pass，动态审核重点 4 项）+ SA5 分析报告 + 任务简报

---

## Step 0 / Step 1 结论

```
[SA7 Step 0 结论]
SA4 verdict: pass（sa4_review.md 第 4 行）
操作: 进 Step 1

[SA7 Step 1 结论]
SA6 红灯: 🟢 GREEN —— npx vitest run packages/ws-replication/test/ws-replication-issue190-red.test.ts
  → Test Files 1 passed (1) / Tests 4 passed (4)（AC1 + AC2 + AC3 + 保真锚），exit 0，04:44:31
操作: 进入 Step 2
```

---

## 环境注记（本机进程资源饥饿 —— 与 SA4 记录同源，本轮完整定性）

1. 会话早期 `spawn bash EAGAIN` 持续约 7 分钟（工具层无法起 shell）。恢复后定位根因之一：**SA4 遗留的 yjs-server vitest 进程树悬挂**（stdout → `/tmp/sa4-yjs.log`；其日志尾 = Go runtime `fatal error: newosproc`（esbuild service 线程创建失败，errno=11=EAGAIN）+ 5 测试 `Cannot fork` 失败）。该树已**精确识别归属**（SA4 的 log writer、cwd = 本 worktree、结果终态）后定向 kill（PID 910266/910267/910278/910279），未触碰任何未知进程，未使用 `fuser -k`。
2. 机器级线程/进程预算由全机多 agent 共享：任何 spawn 型负载运行期间连 shell 都无法 fork（本轮 yjs 套件运行期间 `spawn bash EAGAIN` 再次持续约 40 分钟；期间 ripgrep 同样无法启动）。凡下文标注 **env-blocked** 的项均为该预算问题。
3. 应对纪律：全部验证命令按 Skill 规范以 `setsid nohup` 独立进程运行；vitest 统一 `--pool=threads --maxWorkers=1 --minWorkers=1`（最小化线程面）；全部 ephemeral `port:0`（零固定端口、零 fuser）。

## 测试证据（独立进程实跑，2026-08-31 04:44–05:0x）

| # | 验证 | 命令（均加 `--pool=threads --maxWorkers=1 --minWorkers=1`） | 结果 |
|---|---|---|---|
| 1 | SA6 红灯转绿（Step 1） | `npx vitest run packages/ws-replication/test/ws-replication-issue190-red.test.ts --typecheck.enabled=false` | **Tests 4 passed (4)**，exit 0（AC1/AC2/AC3/保真锚全绿） |
| 2 | 全聚焦套件（无 typecheck） | `npx vitest run packages/ws-replication/test --typecheck.enabled=false` | **44 文件 301 tests 全绿**，exit 0 |
| 3 | 全聚焦套件（含 typecheck，SA4 同款） | `npx vitest run packages/ws-replication/test --typecheck` | **46 文件 322 tests 全绿 + Type Errors no errors**，exit 0（= SA4 基线 45 文件 317 + SA7 新增文件 A 的 1 文件 5 tests；含 red 4 / guard 1 / 新文件 A 5） |
| 4 | 包类型面（含两新测试文件） | `npx tsc -p packages/ws-replication/tsconfig.json && npx tsc -p apps/yjs-server/tsconfig.json` | exit 0，零错误 |
| 5 | RT-1 守卫锚 | 含于 #2/#3 | `ws-replication-issue190-guard.test.ts (1 test)` ✓ |
| 6 | SA7 补充测试 A（包级边界/parity/AC4 保真） | `npx vitest run packages/ws-replication/test/ws-replication-sa7-issue190-dynamic.test.ts --typecheck.enabled=false` | **Tests 5 passed (5)**，exit 0 |
| 7 | SA7 补充测试 B（生产 wrapWs 真实链路，SA4 动态重点 4） | `npx vitest run apps/yjs-server/test/ws-replication-issue190-sa7-real-transport.test.ts --typecheck.enabled=false` | **Tests 3 passed (3)**，exit 0 |
| 8 | yjs-server 全套件（SA4 动态重点 3） | `npx vitest run apps/yjs-server/test --typecheck.enabled=false`（仍在后台独立进程推进，完整日志 `/tmp/sa7-yjs.log`） | **env-blocked（部分完成）**：已产出 4 文件——`phase5-mgmt-verbs-sa7` 5 failed（全部 `timeout 60000ms waiting for peer-1 ready` + stderr `tsx: Cannot fork`）、`stdin-error-chain-red` 4 failed（3× `Cannot fork` 超时 + 1× `process exited with code 134`）、`app-config-red` **22 passed ✓**（非 spawn 文件全绿）、`hub-restart-static-target-red` 1 failed（同 `Cannot fork` 签名）。失败签名与 SA4 独立跑（`/tmp/sa4-yjs.log` 同款）逐字一致——纯环境（spawn 子进程预算耗尽），非本任务回归 |
| 9 | 根 `pnpm typecheck`（12×tsc 链） | — | **env-blocked**（fork 预算）。替代证据链：链中与本 diff 相关的两个项目 `packages/ws-replication` + `apps/yjs-server` 已单独 tsc 通过（#4，含两新测试文件）；其余 10 项目自 SA4 在同一 HEAD（`6fde7ea`）根链 exit 0 后零改动；HEAD 其后仅新增本 SA7 两测试文件 |
| 10 | 根 `pnpm test` 全仓 | — | **env-blocked**：SA4 已做基线对照（HEAD 与基线 `b66615c` 两次全仓跑均崩于 tinypool `ERR_IPC_CHANNEL_CLOSED`）+ 本轮 yjs 套件/工具层 fork 耗尽实证。任务简报该项须由 CI 覆盖（交总控） |
| 11 | `git diff --check` | `git diff --check b66615c HEAD` | **clean**（零空白违规）；tracked 工作区零改动（新文件仅本报告 + 两测试文件） |

## SA4 动态审核重点逐项核验

### 重点 1 + 重点 2：CI 全仓 `pnpm test` 绿 + 两测试文件触发证据 —— 🔒 环境阻塞（分支未发布，非代码问题）

- 事实：分支**尚未 push**（`origin` refs 无该分支）、GitHub 无 PR、无 CI run——SA7 无权 push/建 PR。
- CI 触发证据（`gh run view --log` 摘录）必须在 publication 之后采集。静态门禁已由 SA4 §1.4 通过：根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` + `apps/*/test/**/*.test.ts` 覆盖全部四个文件（含 SA7 新增两文件），CI test job = 无 filter 全仓 `pnpm test`。
- **交总控**：publication 后按 Skill Step 3/4 采集 run log 摘录，补齐文末两张触发证据表。

### 重点 3：yjs-server 回归（caller ripple 动态面）—— 部分完成 + env-blocked 定性

- 全套件：见测试证据 #8——spawn 型测试文件全部环境失败（`Cannot fork` / exit 134 签名，与 SA4 独立跑一致）；非 spawn 文件（`app-config-red` 22/22）绿；套件在独立进程继续，日志持久于 `/tmp/sa7-yjs.log` 供总控追看。
- caller ripple 的**任务相关面已由更强向量闭合**：
  1. `apps/yjs-server` tsc 全绿（#4）——`acceptTrusted` 签名/契约对唯一生产 caller `app.ts:274`（fire-and-forget）零破坏；
  2. **测试文件 B（#7）以生产组合跑通真实链路**：`startHubWsServer`（HTTP Upgrade + Bearer 认证）→ `accept` 回调镜像 app.ts:274 fire-and-forget `acceptTrusted` → `wrapWs`——合法 HELLO → HELLO_ACK + 1 连接 ready（R1 绿灯）。
- 该 diff 不触碰 `apps/yjs-server/src`（SA4 §1.1 ALLOW LIST 核验）；spawn 型套件失败与 diff 无因果（失败原因全部是子进程 fork 耗尽，基线亦然）。

### 重点 4：真实链路 smoke（生产 wrapWs + 合法 HELLO）—— ✅ 完成（#7）+ 超预期动态发现

见下节。

## 动态发现：生产 wrapWs 链路上 admission 窗口对任何帧都已关闭

SA7 首版真实链路测试曾以「wrapWs 单帧超界 → 客户端收 {1009,'upgrade-frame-limit'}」为期望，**实测收到的是 {1002,'protocol-error'}**。定位（实测 + 源码时序核证）：

- `wss.handleUpgrade` 回调内**同步**执行 `options.accept(wrapWs(ws), identity)` → `app.ts:274` fire-and-forget `acceptTrusted`（零 await）→ admission 安装 → 同步收口 → `detach()` → `HubConnectionImpl` 构造——全部同一 tick；
- ws `message` 事件恒在后续 macrotask 投递 → 生产 wrapWs 链路上**任何帧都晚于 admission 摘除**，落在连接 FSM 的 `decodeInbound`（既有语义：非协议字节先判 MALFORMED → `close(1002,'protocol-error')` + ERROR 帧上 wire + 异步回收——SA5 Investigation #4 记录的正是该路径）；
- 结论：issue #190 的触发面是**同步重放型 transport**（TcpTransport 实存形态——onMessage 注册即同步重放积压），生产 wrapWs 不属于该形态。修复对生产链路的可观测效果 = **合法路径零变化**（AC4 证据：R1 绿灯），有界 admission 保护的是包级 API 契约（任意 transport 形态，含宿主自定义 adapter / 未来 TCP framing adapter）。
- 该时序事实已固化为「链路特征锁」测试（文件 B R2/R3），防未来误读生产链路的帧限语义。**这不构成对修复的否定**——包级契约（SA6 红 IT AC1–AC3 + guard）在同步重放形态下全绿，正是修复目标面。

## SA7 新增测试（产物，均独立进程实跑全绿）

| 文件 | 测试 | 锚 |
|---|---|---|
| `packages/ws-replication/test/ws-replication-sa7-issue190-dynamic.test.ts` | 5 IT | B1 恰 16 帧界值内接纳（条数界只拒第 17 帧——两遍重放 32 = 保留证据）；B2 恰 `maxFrameBytes` 严格不等式界值内接纳（`>`，两遍重放 2）；P1/P2 accept()（token 路径）parity——1009/1008 + `frame-too-large`/`early-frame-limit` + 恒 resolve undefined + 零分配 + **验证器零调用**（admission 拒绝先于门 4——A2-e 未覆盖的 observer/验证器面）；F1 AC4 保真——合法 bearer + 认证后 HELLO → ready + 恰 1 个 HELLO_ACK + 零拒绝事件 |
| `apps/yjs-server/test/ws-replication-issue190-sa7-real-transport.test.ts` | 3 IT | R1 生产链路保真（合法 HELLO → HELLO_ACK + 1 连接 ready，SA4 动态重点 4）；R2/R3 生产 wrapWs 链路特征锁（单帧超界 / 17 帧落连接层 {1002,'protocol-error'} + 1 ERROR 帧 + 连接回收归零——admission 层零参与的时序事实） |

（文件 A 定稿后仅有一处注释文字修正——「P1/P3」→「P1/P2」，零行为/类型影响。）

## 源码改动

零（SA7 纪律：仅新增测试与报告）。`git status` tracked 区零改动。

## 总结论

1. **SA4 verdict = pass 前提下的独立动态验证全绿**：红灯转绿（4/4）、全聚焦套件 322 tests + typecheck、RT-1 守卫、双包类型面、生产链路 smoke（3/3）、边界/parity/AC4 保真补充（5/5）。
2. **未发现任何可归因于修复的失败**；两项链路特征观察（wrapWs admission 窗口时序）均已定性为既有行为并以特征锁测试固化。
3. env-blocked 项（全仓 `pnpm test`、根 typecheck 链、yjs spawn 型套件、CI 触发证据）均有环境签名 + 基线对照/替代证据，**须由 CI 在 publication 后覆盖**——交总控。

## Spec 触发证据 (verdict 升级 — 2026-06-09)

CI Run: 无（分支未 push、无 PR）。本任务 diff 无 `*.spec.ts`（SA4 §1.3 静态判定：不触发）——本节不适用；publication 后如需可由总控采集。

## vitest 触发证据 (verdict 升级 — 2026-06-15)

CI Run: 无（分支未 push、无 PR）。静态门禁（SA4 §1.4）已过；**本机触发证据** = 测试证据 #1–#7（四个测试文件全部实际执行且全绿）。publication 后由总控采集 CI run log 摘录补全下表：

| Workspace Package | CI Step Name | 触发结果 | log 摘录 |
|---|---|---|---|
| ws-replication | Test (`pnpm test`) | 🔒 待 publication 后采集（静态门禁过 + 本机实跑全绿） | — |
| yjs-server | Test (`pnpm test`) | 🔒 待 publication 后采集（同上；本机 env-blocked 项亦须 CI 覆盖） | — |

---

# R2/R3 补充验证（2026-08-31 05:43–05:52）—— smoke-skeleton 锁测试超时的 flaky 分类

## Verdict: **pre-existing environment/timing flaky —— 非 #190 回归**（不可复现于 6 次隔离重跑；受害测试在同机跨运行漂移；#190 diff 与失败路径零因果）

## 触发背景

Final Spec R2 独立全量（`pnpm test -- --maxWorkers=2`，log：`.mabf-bg/issue190-final-spec-r2.log`，exit 1）恰 1 失败：
`apps/yjs-server/test/smoke-skeleton-red.test.ts` > `a second instance sharing an active file root is rejected loudly (lock guard, AC2)`
—— `timeout 30000ms waiting for second instance to exit`（`waitForExit` :114，调用点 **:331**），文件 3/4 @ 65.1s。
对照权威 test4（同命令，`.mabf-bg/issue190-root-test4.log`，exit 0）：**214 文件 / 2267 tests 全过**，本文件 4/4 @ 41.2s（`:213`）。

## 复核证据（全部命令 + 完整输出存 `.mabf-bg/`）

| # | 版本 | 命令（独立进程 `setsid nohup`） | 结果 | log |
|---|---|---|---|---|
| F1 | HEAD `6fde7ea` | `npx vitest run apps/yjs-server/test/smoke-skeleton-red.test.ts --maxWorkers=1`（×3） | **3× 4/4 passed**；文件 41.18/41.19/41.24s；**锁测试 6169ms**（30s 预算余量 ≈24s） | `r2-iso-single-head-{1,2,3}.log` |
| F2 | HEAD `6fde7ea` | `pnpm test -- apps/…smoke-skeleton-red.test.ts --maxWorkers=1`（`--` 后过滤未生效 → 意外成为全量复现：`vitest run --typecheck -- … --maxWorkers=1`，214 文件/2267 tests） | smoke-skeleton **4/4 @ 40.9s**（`:41`）；全量 1 failed = **另一** spawn 型时序测试 `stdin-error-chain-red` F1 race（`timeout 60000ms waiting for peer ready (round 1)`，:123）——同机同时段受害测试漂移的直接实证 | `r2-isolated-head-1.log` |
| F3 | 基线 `b66615c` | 同 F1 命令 ×3，于 `git worktree add --detach /tmp/sa7-190-baseline b66615c`（零触碰当前分支；node_modules 以符号链接复用主装；`apps/yjs-server` 源码 = 纯基线） | **3× 4/4 passed**；文件 41.20/41.23/41.28s；**锁测试 6179ms**——与 HEAD Δ10ms，零版本依赖时序差 | `/tmp/sa7-190-baseline-base-{1,2,3}.log`（worktree 已 `remove --force` 清理，`git worktree list` 复核无残留） |

## 分类论证（四条独立证据线）

1. **不可复现**：6 次隔离重跑（HEAD×3 + 基线×3）锁测试全绿，单测耗时 ~6.2s，对 30s 预算有 ~24s 余量；R2 的失败需要 hub2「spawn→boot→取锁失败→exit(1)」路径整体劣化 ~5×。
2. **同码不同果（flaky 定义性证据）**：test4 与 R2 同命令、同代码（同 commit `6fde7ea`）、同机，仅运行时负载不同——4/4 vs 3/4。且我复核时段的全量跑中失败迁移到**另一个**同族测试（stdin-error-chain F1，60s peer-ready 超时）——本机 spawn 型真实进程测试的墙钟预算在机器负载下间歇性耗尽，受害者在运行间漂移。
3. **因果排除（#190 diff 与失败路径零交集）**：
   - `git diff --stat b66615c HEAD` = 仅 `packages/ws-replication/src/hub-connection.ts` + 2 个 ws-replication 测试文件；`git diff b66615c HEAD -- apps/yjs-server/` 为空（失败测试与其被测应用两版本**字节一致**）；
   - hub2 的退出路径：`main.ts:181-188` —— config 解析后**同步** `acquireRootLock` 失败 → `process.exit(1)`，发生在 `createNomicoreApp`（ws-replication 唯一载入点，main.ts:193）**之前**——hub2 全程不加载 #190 改动文件；
   - hub1 侧 #190 改动仅限早到帧 admission 同步段（零新 timer/零新异步等待；AC4 + 生产链路 smoke R1 已证合法路径零变化）。
4. **环境背景（同机同日文档化）**：本会话 R1 段记录的进程预算饥饿（`spawn bash EAGAIN`、`tsx: Cannot fork`、esbuild Go `newosproc` errno=11、22 个 spawn 型失败）；`git worktree list` 显示同机并行多任务 worktree（issue-191/pubtest-lifecycle/issue-154）——共享进程/线程预算的间歇性争用与 R2 单点 30s 超时形态一致。

## 对 AC/Spec review 的结论

- R2 的唯一失败**不构成 #190 回归或可复现缺陷**，不阻塞验收；其证据等级：6/6 隔离复跑绿 + 基线等时 + 因果零交集 + 同命令 test4 全绿。
- 该测试族（`apps/yjs-server` spawn 型真实进程冒烟）在本机为已知环境敏感项（R1 段已记录）；CI（ubuntu runner 独占资源）为此提供权威裁决面——test4 形态（全绿）为其预期形态。
- 佐证更新 R1 段 #10 项：机器空闲时段全量 `pnpm test` 族命令**可完整跑完**（本段 F2：214 文件 133.6s，唯一失败为同族 flaky；test4：全绿）——R1 时点的 `ERR_IPC_CHANNEL_CLOSED` 为当时负载所致，非恒定阻塞。

## 本段操作纪律

零代码/测试改动（`git status` tracked 区 clean）；零 push/PR；基线经 detached worktree 对照后已彻底清理；全部输出归档于 worktree `.mabf-bg/`（含总控 test4/R2 原始 log 与本段 6 次复跑 log）。

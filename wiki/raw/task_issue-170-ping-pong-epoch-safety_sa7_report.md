# SA7 动态验证报告 — issue #170 ping/pong epoch safety

**Date**: 2026-08-30
**Verdict**: **pass**（本地动态验证全绿；CI 侧 vitest 触发证据因分支尚未建 PR 而环境阻塞,已按 Step 4 立法以本机 CI 等价命令 + 收集配置第一手证据替代并留待 PR 后补录——详见「vitest 触发证据」节）
**被验对象**: worktree HEAD `ea1fdfe`（基线 `ef19bae`,分支 `fix/issue-170-on-docs-phase-5-websocket-replication`）
**前置门禁**: SA4 静态验尸 **pass**（`task_issue-170-ping-pong-epoch-safety_sa4_review.md` 顶部 Verdict 行亲读）
**验证方式**: 全部测试命令独立进程执行（setsid nohup）;虚拟时钟套件零 real sleep;真实链路套件真实 TCP + 真实 OS timer + 有界 real wait（r2-transport 先例测试类）。**零生产代码改动**（git status 仅有 2 个新增测试文件 + 本报告;`packages/ws-replication/src` 与 SA3 交付态逐字节一致）。

---

## Step 0 — SA4 verdict 校验

`wiki/raw/task_issue-170-ping-pong-epoch-safety_sa4_review.md` 第 4 行:**`Verdict: pass`** → SA7 进入动态验证,不上发不下发。

## Step 1 — SA6 红灯测试复跑（独立进程）

```
$ pnpm exec vitest run packages/ws-replication/test/ws-replication-issue170-r1-r4-red.test.ts
 ✓ packages/ws-replication/test/ws-replication-issue170-r1-r4-red.test.ts (6 tests) 181ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
Type Errors  no errors
```

**SA6 红灯: 🟢 GREEN（6/6）** → 进入 Step 2。

---

## 一、SA6 H1/P1–P5 契约逐项动态证据

红灯文件 `ws-replication-issue170-r1-r4-red.test.ts`（6 tests）全部转绿。逐项断言面（行号 = 测试文件）:

| 契约 | 锚定缺陷 | 动态证据（断言 + 结果） |
|---|---|---|
| **H1**（R1,hub 协议违约） | SA5 R1 | `hubCloseLog()[0].code === 1001`（:359-362,基线 1002）✓;wire 零 `PONG_TIMEOUT` ERROR 帧（:365-369,§10 护栏）✓;peer `backoff`（:371-375,基线 blocked 终态）✓;backoff 到期 `dialCount===2`（:376-379,基线恒 1）✓;重连后 `hub.connections.length===1`（:383）+ 数据收敛 peer n=99（:384-386）✓ |
| **P1**（迟到 pong） | SA5 R2 | 属 ping1 的迟到回声注入于 ping2 在途窗 → t=70 `state==='backoff'` + `close(1001)`（:406-416;基线滞留 ready——死对端误判存活）✓ |
| **P2**（重复 pong） | SA5 R2 | 同一 pong 二次投递 → ping2 超时照常收口 backoff + 1001（:429-437）✓ |
| **P3**（未请求 pong） | SA5 R2 | 从未发送过的载荷 `[0xde,0xad]`（长度 2≠8,credentialMatches 长度判否）→ ping1 超时照常收口 backoff + 1001（:448-457）✓ |
| **P4**（R3,peer 收口顺序 + old-epoch） | SA5 R3 | pong 超时同步栈:pong/message/close 三监听 `===0`（:483-495;基线 1）✓;backoff 窗 [40s,90s) `peerPingsAfterClose()===0` + `closedTransportPingErrors()` 空（:499-507;基线僵尸 ping 已关 socket + ws 语义抛错逃出 timer 回调）✓;重拨 `dialCount===2`、`hub.connections===1`（:513-514）✓;旧代 pong 注入旧传输 → 新连接状态/ns/旧 liveness 零扰动（:516-521）✓;收敛 peer n=77（:523-525）✓ |
| **P5**（R4,blocked 泄漏） | SA5 R4 | hub 1002 → blocked 后:三监听 `===0`（:542-544;基线 1）✓;30s+10s 零 ping 活动（:546-550;基线 1）✓;零自发二次 close(1001)（:551-557;基线有）✓;blocked 终态不重拨护栏（:558-560）✓ |

配套基线差分（SA4 已做基线还原取证:src 还原 `ef19bae` → 同文件 `6 failed (6)`,失败消息与简报红灯证据逐字一致）——本轮不重复还原操作,以 SA4 取证 + 本轮 6 passed 构成「断言钉住缺陷且修复后转绿」的完整双向证据。

## 二、验收命令复跑（独立进程,最终电池）

| 命令 | 结果 |
|---|---|
| `pnpm run typecheck` | exit 0（含 `tsc -p packages/ws-replication/tsconfig.json`,覆盖 2 个新增测试文件） |
| `pnpm exec vitest run packages/ws-replication --typecheck` | **Test Files 25 passed (25),Tests 164 passed (164),Type Errors no errors,零 unhandled errors,exit 0**（161 既有 + 探针 1 + 真实 transport 2） |
| `git diff --check` | exit 0;两个新增测试文件另经 `grep -E ' +$'` 亲查零尾随空白（未跟踪文件不在 git diff --check 覆盖内） |
| `pnpm test`（CI `Test` 步等价,全仓） | **178 files / 2035 tests 全过,Type Errors no errors**;2 个 unhandled error = vitest 内部 `[vitest-worker]: Timeout calling "onTaskUpdate"` RPC 超时 → 本机 exit 1。**判定与本任务无关的既有环境现象**,论证见「五、既有环境现象」节 |

包级测试明细（最终电池 [C3] 摘录）:三个 issue-170 相关文件全部收集且通过——

```
 ✓ packages/ws-replication/test/ws-replication-sa7-issue170-real-transport.test.ts (2 tests)
 ✓ packages/ws-replication/test/ws-replication-issue170-r1-r4-red.test.ts (6 tests)
 ✓ packages/ws-replication/test/ws-replication-sa7-issue170-minor3-observation.test.ts (1 test)
```

## 三、真实 / 假 transport reconnect 收敛

- **假 transport（内存双端 wire + 虚拟时钟）**:H1 与 P4 内建「重连后 `hub.connections.length===1` + 数据最终收敛」（H1 n=99 / P4 n=77）——验收 5 的 fake 面,6/6 绿。
- **真实 transport（真实 TCP + 真实 OS timer,新增强补充测试）**:`ws-replication-sa7-issue170-real-transport.test.ts`（2 tests,1599ms,绿;零 unhandled errors）。适配器在 `node:net` TCP 流上实现 WS 控制帧语义的镜像面:record = `[type 1B][len 4B][payload]`,PING(0x02)→PONG(0x03) 回显载荷（RFC 6455 §5.5.2 忠实建模）,协议帧走 DATA(0x01);pong 载荷透传给复制层（seam §3 契约的活链路证明）;`ping()` 对已关 socket 抛 `WebSocket is not open: readyState 3 (CLOSED)`（ws 语义 A4 忠实建模 + 计数判别）。
  - **用例 1（死对端 pong 超时全链路）**:首代 hub 适配器不复 PING → 真实 timer 触发 pong 超时 → peer `backoff` + 传输关闭（socket.end→FIN 往返）→ **hub 侧真实观测 `{code:1001, reason:'pong-timeout'}`**（临时失败语义,非 1002/blocked）✓;收口后旧传输 pong/message/close 三监听归零、wire 零 `PONG_TIMEOUT` ERROR 帧 ✓;hub registry 异步清死连接 `connections===0`（真实 socket 面,SA2 MINOR #4 同构）✓;backoff（150ms 真实时钟）到期重拨 dialCount===2 → ready → ns live → **`hub.connections.length===1`** ✓;新代 ≥2 个 ping 周期真实 PING→PONG 往返应答、连接保持 ready ✓;hub 写 n=99 → peer 副本收敛 ✓;全程 `pingsOnClosedTransport()===0`、`closedTransportPingErrors()` 空 ✓。
  - **用例 2（A4 故障注入）**:适配器 `ping()` 首调抛错（socket 仍开放）→ **liveness catch 吸收**（异常未逃出 timer 回调——进程持续运行即测试本体继续执行）→ 同样收口 `close(1001,'pong-timeout')` + `backoff`（hub 侧观测一致）→ 重连健康 → `hub.connections===1` → 收敛 n=77 ✓。注:开发中曾以原型方法形态暴露 ping/onPong,被 `peer-connection.ts:307-308` 的分离引用调用（`ping: transport.ping`）暴露丢 `this` 绑定问题——已改为实例箭头属性;这是测试开发迭代,非生产缺陷。

## 四、SA4「动态审核重点」清单逐条核销

| # | SA4 要求 | SA7 动态结论 |
|---|---|---|
| 1 | CI 触发证据:从 PR CI `gh run view --log` 摘录三个测试文件的收集/通过行 | **环境阻塞**:分支尚无 PR / 无 CI run（`gh pr list --head <branch>` 空、`gh run list --branch <branch>` 空;SA7 职责不含 push/建 PR）。以本机 CI 等价替代:全仓 `pnpm test`（= CI `Test` 步命令）中三文件收集+通过行已摘录（见「二」）;静态面 SA4 §1.4 已核（`vitest.config.ts` include `packages/*/test/**/*.test.ts` 第一手复核 + `.github/workflows/ci.yml:38-40` `Test: pnpm test`）→ PR 建立后从 run log 补录即闭环 |
| 2 | 真实 `ws` adapter 语义（A4/A6）:pong 透传回显载荷、closed socket ping 抛错被 catch 吸收 | 仓内无 `ws` 依赖（`node_modules` 亲查无,非本包依赖）——生产 ws adapter 属切片 9,维持 types.ts 契约注释约束。**本轮以真实 TCP 适配器补齐可执行面**:pong 载荷经真实 socket 往返透传（用例 1 新代 ≥2 周期应答）、closed-ping 抛错面忠实建模且结构性零发生（两用例计数均 0）、ping 抛错被 catch 吸收（用例 2 故障注入直证） |
| 3 | SA2 MINOR #4（hub 异步 drop）:H1/P4 `hub.connections.length===1` 依赖 cleanupAll 微任务排水,关注 flaky | **不 flaky**:红灯文件连跑 ×10 全绿（60/60 断言组,每轮含 H1+P4 的 connections 断言）;真实 socket 面（异步 FIN 往返 + registry 异步收口）同样 `0 → 1` 收敛稳定（真实 transport 用例）;探针用例同断言绿。结论:cleanupAll 收口不依赖 hub 时钟推进,与 round2 D3 先例一致 |
| 4 | SA2 MINOR #3（GOAWAY drain × 长 backoff）:观察探针 | **已执行并固化**——见「五」节专述 |
| 5 | 既有观察项:`enterBlocked`/`onTemporaryFailure` 不清 `goawayDrainHandle`（本 commit 未改该面） | 静态:`git diff ef19bae HEAD -- src` 中 goaway/drain 仅 2 行 enterBlocked 注释;handle 清除点全仓仅 `onGoaway:412`（重排程前清旧）与 `dialNow:189`。动态:MINOR #3 探针里 deadline 于 backoff 窗内真实触发,即该语义的直接运行时证据——既有语义保持,非本任务缺陷面 |

## 五、SA2 MINOR #3 观察探针（新增强补充测试）

`ws-replication-sa7-issue170-minor3-observation.test.ts`（1 test,113ms,绿）——按 SA2 #3 构思固化:GOAWAY(SERVER_RESTARTING, drain 5_000) + ping 1s/pong 0.5s + backoff 100k×0.5=50s,虚拟时钟逐时刻驱动:

| 时刻 | 事件 | 观测断言（全部通过） |
|---|---|---|
| t=0 | GOAWAY 注入（raw 帧,`nextHubSeq()`） | FSM 仍 `ready`（drain 窗口期连接照常）、传输未关 |
| t=1.5s | pong 超时（首代 wire 不复 pong） | `close(1001,'pong-timeout')` 恰一条 → `backoff`（至 t=51.5s）;hub 侧观测码一致;hub 异步清死连接 `connections===0`;backoff 窗内零已关传输 ping（ping 计数停在 1） |
| t=4.999s | deadline 前一刻 | FSM 仍 `backoff`、零重拨 |
| t≈5.0s | **drain deadline 在长 backoff 窗内触发** | **FSM 恒 `backoff`**（deadline 回调不触碰连接 FSM）;**peerCloseLog 仍恰一条**（传输已关 → deadline 的 close 调用幂等 no-op,零二次 close）;ns 投影幂等（保持 `disconnected`,quiesceControllers 对已 onConnectionLost 的控制器无可见变化）;不触发重拨 |
| t=51.498→51.501s | backoff 到期 → `dialNow` | `clearGoawayDrain` 幂等（handle 已消费）+ `goawayActive=false`;重连恰一次（dialCount 2）→ ready → ns 重开 → `live`;`hub.connections===1` |
| t≈106.5s | 重连后再推进 55s | 无残留 drain 定时器关新传输（wire2 保持开放、ready、live）;hub 写 n=99 → peer 收敛 ✓ |

**记录**:SA2 构思原文表述「ns 经 failed→targeted 重开」——实测 ns 在 backoff 期投影为 `disconnected`（`onConnectionLost` :621-637 投影,deadline 的 `onConnectionFatal` 对 disconnected 幂等 :640-648）,重连后经 `onConnectionReady`/`openActiveTargets` 从 disconnected→targeted 重开收敛。语义与 SA2 意图一致（断线投影 → 重连自愈重开）,仅中间态命名差异,如实记录。

## 六、既有环境现象（与本任务无关,登记备查）

全仓 `pnpm test`（CI `Test` 步等价命令）在本机两次执行均出现**恰 2 个** `[vitest-worker]: Timeout calling onTaskUpdate` unhandled error → vitest exit 1,但 **176→178 文件 / 2032→2035 测试全部通过、Type Errors none**。归因论证:

1. 错误为 vitest worker↔主进程 RPC 内部超时,非任何测试失败;
2. 两次运行各恰 2 个,与两个 >60s 的**基线既有重型测试文件**强相关:`packages/vfsl/test/validate-patch-sa7.test.ts`（92s,单测 77s）与 `validate-snapshot-sa7.test.ts`（81s,单测 69s）——worker 长时间同步占用超过 RPC 超时阈值的机械性表现;
3. 两文件在基线 `ef19bae` 均存在（`git show ef19bae:<file>` 亲验）,且本任务 diff **零 vfsl 文件**（`git diff --name-only ef19bae HEAD | grep -c vfsl` = 0）;
4. 首次全仓运行时我的两个新测试文件尚未被收集（创建晚于收集点）,同样出现该 2 错误 → 与新增文件无关;
5. 包级 `vitest run packages/ws-replication`（含全部 issue-170 测试）零 unhandled、exit 0。

**结论**:pre-existing、本机负载相关现象;main 分支近期 CI 绿（8-26,该时点早于相关重型测试合入与否未逐项考证）。PR 建立后若 CI `Test` 步复现同款 RPC 超时,应按本节归因处置（vfsl 重型测试的运行时长问题）,与 issue #170 改动无关。

## vitest 触发证据（Step 4 立法,2026-06-15）

**CI Run**: 🔥 **不可得——分支尚无 PR / 无 CI run**（`gh pr list --head fix/issue-170-on-docs-phase-5-websocket-replication` → 空;`gh run list --branch <同>` → 空。SA7 职责边界:不 push、不建 PR、不宣称 CI 已绿）。

本机 CI 等价替代证据（同一命令 `pnpm test` = `vitest run --typecheck`,同一收集 glob `packages/*/test/**/*.test.ts` 于 `vitest.config.ts` 第一手复核;CI 定义 `.github/workflows/ci.yml` L38-40 `Test: pnpm test`,Node 20/24 矩阵）:

| Workspace Package | CI Step Name | 触发结果 | log 摘录（本机全仓 `pnpm test`,最终电池 [D3]） |
|---|---|---|---|
| ws-replication | Test（`pnpm test`） | ✓ 164 tests passed（包级）/ 全仓 2035 passed | ` ✓ packages/ws-replication/test/ws-replication-issue170-r1-r4-red.test.ts (6 tests)`、` ✓ packages/ws-replication/test/ws-replication-sa7-issue170-minor3-observation.test.ts (1 test)`、` ✓ packages/ws-replication/test/ws-replication-sa7-issue170-real-transport.test.ts (2 tests)` |

**verdict**: ⚠ local-equivalent-verified / **ci-log-pending（环境阻塞:PR 未建）**——非 `vitest-package-not-triggered`（收集配置静态+动态双确认覆盖;SA4 §1.4 静态门禁已过）。总控建 PR 后应从 `gh run view <run-id> --log --job=test (20/24)` 补录同款三行,预期 `✓`。

## 产物清单

| 产物 | 路径 | 类型 |
|---|---|---|
| 动态验证报告（本文件） | `wiki/raw/task_issue-170-ping-pong-epoch-safety_sa7_report.md` | 报告 |
| SA2 MINOR #3 观察探针 | `packages/ws-replication/test/ws-replication-sa7-issue170-minor3-observation.test.ts`（1 test） | 补充性测试（既有语义观察,非红灯契约） |
| 真实 transport 补充测试 | `packages/ws-replication/test/ws-replication-sa7-issue170-real-transport.test.ts`（2 tests,真实 TCP + 真实 timer） | 补充性测试（验收 5 真实面 + A4 故障注入直证） |

生产代码零改动（`git diff ef19bae HEAD -- packages/ws-replication/src` 与 SA3 交付一致;工作区新增仅上表文件）。

## 结论

**pass**。SA6 六条红灯契约（H1/P1–P5）复跑 6/6 绿;验收三命令（typecheck / 包级 vitest --typecheck / git diff --check）全过;假 transport（H1/P4）与真实 TCP transport（新增 2 用例）双双证明「重连后 hub 只保留新连接 + 数据最终收敛」;A4 的 pong 载荷透传与 ping 抛错吸收经真实链路直证;SA2 MINOR #3 探针与 #4 抗 flaky 观察（×10 连跑 + 真实 socket 面）全部按登记执行并固化成仓内测试;SA4 五条动态审核重点逐条核销。唯一未闭环项 = CI run log 侧 vitest 触发摘录,阻塞于「PR 未建」（SA7 职责边界外）,已提供本机等价证据与补录指引。另登记与本任务无关的既有全仓 RPC 超时现象（第六节）供总控与 CI 观察参考。

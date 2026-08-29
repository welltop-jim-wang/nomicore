# SA7 动态验证报告 — issue #174 GOAWAY drain 真实窗口与关闭时序

**Date**: 2026-08-30
**Verdict**: pass
**被验对象**: SA3 实现 commit `739e1bb`（工作区含 SA6 owned auth-lifecycle +2 行适配与 SA7 新增补充测试，均未提交）
**Worktree**: `/home/wangjian/nomicore-fix-issue-174`（branch `fix/issue-174-on-fix-issue-138-on-docs-phase-5-websocket-`）
**输入**: 任务简报 `task_issue-174-goaway-drain.md` / SA4 报告 `task_issue-174-goaway-drain_sa4_review.md`（Verdict: pass，「动态审核重点」5 项）/ SA5 缺陷报告 `20260830-bug-issue-174-goaway-drain.md` / SA6 红灯契约 `ws-replication-issue174-goaway-drain-red.test.ts`

---

## Step 0 — SA4 verdict 校对

```
[SA7 Step 0 结论]
SA4 verdict: pass（sa4_review.md L4）
操作: 进 Step 1
```

## Step 1 — SA6 红灯契约复跑（第二关）

| 命令 | 结果 |
|---|---|
| `npx vitest run packages/ws-replication/test/ws-replication-issue174-goaway-drain-red.test.ts` | `Test Files 1 passed (1)` / `Tests 4 passed (4)` / `Type Errors: no errors` / exit 0（tests 43ms） |

```
[SA7 Step 1 结论]
SA6 红灯: 🟢 GREEN（4/4 转绿——R1 窗口/deadline/迟到回调、R2 自然收口、R3 显式拒绝、R4 pending apply 排空）
操作: 进入 Step 2
```

## Step 2 — SA4「动态审核重点」逐项验证

### 2.1 重点 #1：vitest 退出时长无 +5s afterAll 尾巴 ✅（活链路实测）

**方法**：全量与定向运行均以逐行毫秒时间戳包裹 vitest 输出，测「最后 summary 行时间戳 → 进程实际退出」的尾部时长；残留的 drainDeadline 真实 timer（realTimer 测试）会使该尾巴 ≥ 数秒。

| 运行 | 命令 | 结果 |
|---|---|---|
| 全量（26 文件/182 用例） | `npx vitest run packages/ws-replication` | WALL **10.580s**；`Test Files 26 passed (26)` / `Tests 182 passed (182)` / `Type Errors: no errors`；Duration 10.14s；**退出尾巴 = 0.086s** |
| 定向 afterAll 文件 | `npx vitest run ws-replication-sa7-r1-transport-auth.test.ts ws-replication-sa7-r2-transport.test.ts` | 2 文件 / 7 用例全绿；WALL 10.181s；**退出尾巴 = 0.081s**（Duration 行 → 进程退出） |

**结论**：SA4 担忧的「afterAll 若 peer.stop 超 3s race 兜底先行 → drain timer 残留 → 进程尾部最多 +closeTimeoutMs(5s)」在真实运行链路中**未发生**——正路径与 SA4 静态推演一致：afterAll 先 `peer.stop()` → hub 侧连接经 `onTransportClosed`（§4.6 路径 2，`clearDrainHandles`）先行收口 → `hub.close()` 时 connectionList 已空 → 零 timer 残留。实测尾巴 81–86ms（进程正常退出开销量级），**无 +5s 尾巴**。

附注：`sa7-r1` D4 用例**用例内**耗时 5108ms——这是真实 timer 下 `await hub.close()` 的真实 5s drain 窗口（见 2.5），属用例内时长而非退出尾巴。

### 2.2 重点 #2：drain 期 fatal 后 timer 计面回归（新测试 S1，无既有锚 → SA7 补充）✅

新增 `packages/ws-replication/test/ws-replication-sa7-issue174-dynamic.test.ts` S1：

- `boot({timeouts:{closeTimeoutMs:5_000}})` → `hub.close()` → 窗口开启（GOAWAY×1、transport 未关）且 **`hubNode.scheduler.pending()` 恰 +1**（drainDeadline 是窗口期唯一新增计面）；
- 窗口内注入错序帧（`injectPeer(UPDATE_ACK, {sequence: nextPeerSeq()+5})`）→ `SEQUENCE_VIOLATION` 连接级 fatal：ERROR 帧（code=SEQUENCE_VIOLATION）上 wire、transport 以 **1002/'protocol-error'** 关闭；
- **主锚 1（timer 清理）**：fatal 后 `scheduler.pending()` **回落**（`clearDrainHandles()` §4.6 路径 3 生效；不清则计面残留至 deadline fire）；
- **主锚 2（closePromise 结算）**：**零 `advanceBy`** 即 `await closePromise` 结算——结算走 fatal → cleanupAll 尾部 finally 释放 drainDone，不依赖 deadline fire，绝不悬挂；
- **主锚 3（残留零副作用）**：越过 deadline 再推 `closeTimeoutMs+1000` 虚拟时间 → hub→peer 帧冻结、close info 不变（仍 1002）、零 unhandled rejection。

### 2.3 重点 #3：R4 变体——apply 越过 deadline 两域独立结算（新测试 S2）✅

S2 与 R4 的差异：saveGate **保持悬挂越过 deadline**（R4 只测门内释放）。实测：

- saveGate 悬挂下 `writePeer({n:7})` → UPDATE 上 wire、saveDoc 发起（saveEvents+1，StubPersistence 在 await 门闩前记账）但悬挂、**ACK 未出**；
- `hub.close()` → 窗口开启（GOAWAY×1、transport 未关、close Promise 未结算）；
- `advanceBy(closeTimeoutMs)` → **网络域硬顶**：transport 以 **1001** 关闭（不等待 apply）——而 **Runtime 域 barrier 仍持**：`closeSettled === false`、saveEvents 冻结（无第二笔 save 被发起、悬挂的 saveDoc 不因传输死亡而取消或完成）；
- 释放门闩 → 悬挂 saveDoc 穿越传输死亡后完成（rootValue n=7、全程恰 1 笔 save）→ **close Promise 此后才结算**；零 unhandled rejection。

**结论**：transport 关闭时点（deadline）与 `hub.close()` Promise 结算时点（apply 排空）**两域独立**，与设计 §5 推论/AC4（不等待网络 ACK 超 deadline）+ §21（Runtime 排空）逐点吻合。

### 2.4 重点 #4：shutdownWithGoaway 窗口期重入（新测试 S3，SA4 列可选 → 已验）✅

窗口期二次 `hub.close()`：**零二次 GOAWAY**（GOAWAY 计数恒 1）、`scheduler.pending()` 恒 base+1（deadline 不重复武装、drainTail 零覆盖）、窗口不被打扰（transport 未关、首个 close Promise 未被提前/异常结算）；deadline 到 → 两个 close Promise 同点结算、1001 收口。双门防御（`closedFlag || drainActive`，hub-connection.ts:337）动态成立。

### 2.5 重点 #5：生产 Host 停机时长变化（设计 §12-1 如实申报项，非缺陷）✅ 观测确认

真实 timer 链路（sa7-r1 D4，真实 TCP）：`await hub.close()` 实测 **5108ms** ≈ closeTimeoutMs(5s) drain 窗口 + 收口开销——hub 优雅停机从「立即」变为 ≤closeTimeoutMs + apply 尾长，与设计申报一致；部署侧可经既有 `timeouts.closeTimeoutMs` 调节。既有 D4 断言（GOAWAY 帧先于 close 事件、hub 侧 1001、peer 终态 blocked）在真实 5s 间隔下保持绿。

## SA6 所有权核验（总控指令专项）✅

| 项 | 证据 | 结论 |
|---|---|---|
| SA3 提交不含 auth-lifecycle | `git show 739e1bb --name-only` = 恰 3 文件（hub-connection.ts / hub-namespace.ts / issue174 红灯测试）；auth-lifecycle 最后提交 = 上游 `01e6801`（issue #138） | **通过** |
| 工作区 +2 行 = SA6 §6.2.1 逐字一致 | `git diff --numstat` = `+2/-0`（仅该文件）；L393 `await run.hubNode.scheduler.advanceBy(CONTRACT_TIMEOUTS.closeTimeoutMs); ...` + `await settle();`，插入点在 `await closePromise` 前、GOAWAY 断言后，既有断言零改动 | **通过** |
| 红灯契约未被 SA3 弱化 | SA4 基线复红取证（sa4_review 证据 4）+ 本次 Step 1 提交版 4/4 绿 | **通过** |

## 全量回归 ✅

`npx vitest run packages/ws-replication`：**26 文件 / 182 用例全绿**（25 文件/179 用例基线 + SA7 新增 1 文件/3 用例），`Type Errors: no errors`，exit 0。SA6 §6.2.1 适配后的 auth-lifecycle（15 用例）与既有锚（D4 GOAWAY 次序等）全部保持绿。

## vitest 触发证据（Step 4 门禁）

- 本任务**无 .spec.ts**（Step 3 N/A）。
- 新增 `*.test.ts`：`packages/ws-replication/test/ws-replication-sa7-issue174-dynamic.test.ts`——本地运行动态证明被根 `vitest.config.ts`（include `packages/*/test/**/*.test.ts`）收集执行（输出行 `✓ ...ws-replication-sa7-issue174-dynamic.test.ts (3 tests)`），与 CI `pnpm test`（ci.yml test job，Node 20/24 矩阵，`vitest run --typecheck`）同一收集面。
- **CI run 观察**：当前分支无 PR、无 GitHub run（`gh pr list --head <branch>` = `[]`）——发布（push/PR）由 Runner 流程执行，CI log 摘录待发布后观察。此项非阻塞：SA4 静态门禁（§1.3/§1.4）+ 本次本地动态收集证据双确认无孤儿测试。

## 现场清理

- 未添加任何 `[SA7-DIAG]` 诊断日志，源码零改动（本次 SA7 全程仅读）。
- 工作区改动 = ① SA7 新增测试文件（本报告产物之一，建议随本任务提交）② SA6 owned auth-lifecycle +2 行（SA3 提交范围外，维持原状）③ wiki/raw 未跟踪档案（含本报告）。
- 无端口/进程残留：全部测试零端口（fake-duplex + fake scheduler）；真实 TCP 用例由 vitest 进程内自清理，实测进程正常退出（尾巴 <0.1s）。

## 结论

| # | SA4 动态审核重点 | 结果 |
|---|---|---|
| 1 | vitest 退出无 +5s afterAll 尾巴 | ✅ 实测尾巴 0.086s / 0.081s |
| 2 | drain 期 fatal 后 timer 计面回归 + closePromise 结算 | ✅ S1 绿（无既有锚，已补测试） |
| 3 | apply 越过 deadline 两域独立结算 | ✅ S2 绿（R4 变体，已补测试） |
| 4 | shutdownWithGoaway 重入双门（可选） | ✅ S3 绿 |
| 5 | 生产 Host 停机时长变化（申报项） | ✅ 观测确认（D4 实测 5108ms，可调 knob） |
| — | SA3 diff 排除 SA6 owned auth-lifecycle | ✅ 3 文件提交 + 工作区恰 +2 行逐字一致 |

**SA6 红灯 4/4 绿；SA7 补充测试 3/3 绿；全量 26 文件/182 用例 + typecheck 全绿；所有权边界零越界。**

## verdict: pass

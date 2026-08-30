# Issue #174 — 修复 PR #173：实现真实 GOAWAY drain 与关闭时序

- Repository: `welltop-jim-wang/nomicore`
- Issue: #174
- Task type: Bug 修复
- Branch: `fix/issue-174-on-fix-issue-138-on-docs-phase-5-websocket-`
- Run ID: `issue-174-1788036227-447205`
- Round: 1

## Problem

PR #173 的 `HubConnectionImpl.shutdownWithGoaway()` 发送 `GOAWAY` 后立即调用 `close(1001)`，同步 quiesce namespace 并关闭 transport，因此宣告的 `drainTimeoutMs` 没有形成真实 drain 窗口。

这不符合 `docs/protocols/instance-replication-v1.md`：收到 GOAWAY 后停止新 OPEN/新 sync round，现有 namespace 在 deadline 前自然收口，之后才以 WS 1001 关闭；Hub shutdown 还应排空已接纳 apply，但不无限等待网络 ACK。

## Acceptance Criteria

1. Hub shutdown 首先停止接纳新连接、新 namespace OPEN 和新 sync round。
2. GOAWAY 在 transport close 之前发送，且 peer 可观测。
3. deadline 前允许已接纳的 namespace apply 排空和自然收口。
4. 不等待未完成的网络 ACK 超过 drain deadline。
5. drain 完成或 deadline 到达后，以 WS 1001 关闭 transport。
6. session close、lease release 与 transport close 顺序符合 v1 协议。
7. 增加动态测试，覆盖 pending apply、GOAWAY 可见性、deadline、提前完成和迟到回调。
8. Node 20/24 CI、typecheck 和 ws-replication 全量测试通过。

## References

- `packages/ws-replication/src/hub-connection.ts`
- `docs/protocols/instance-replication-v1.md`
- `docs/adr/0010-hub-peer-websocket-ydoc-replication.md`

## SA6 红灯契约（Round 1）

- **测试文件**：`packages/ws-replication/test/ws-replication-issue174-goaway-drain-red.test.ts`（4 it，全红灯）。
- **运行命令**：`npx vitest run packages/ws-replication/test/ws-replication-issue174-goaway-drain-red.test.ts`
- **红灯验证结果**：`4 failed (4)`，`Type Errors: no errors`。全部在窗口开启断言失败（R1/R2/R3/R4 首条 `RED@` 断言 `expect(run.wire.hubSideClosed).toBe(false)` 实测 `true`）——即 GOAWAY 后 t0 同步 `transport.close(1001)`、drain 窗口长度 = 0 的可观测复现（与 SA5 复现证据一致）。连续 3 次运行（1 次前台 + 2 次复跑）均为 4 failed / 4，红灯确定性成立。
- **全量基线验证**：`npx vitest run packages/ws-replication`（后台独立进程）→ `Test Files 1 failed | 24 passed (25)`，`Tests 4 failed | 175 passed (179)`，`Type Errors: no errors`——既有 175 用例全部保持绿（AC-6「GOAWAY 先行」、D4「GOAWAY 帧先于 close 事件」等既有锚均未受新红灯影响），仅新增 4 条红灯契约失败。
- **测试锚点（断言均在 wire 帧 / transport 关闭观测 / 连接状态 / 持久化生效上，零源码 grep）**：

  | it | 契约锚（AC） | 红灯点（当前实现） |
  |---|---|---|
  | R1 窗口与 deadline | AC2/AC3/AC4/AC5/AC7（GOAWAY 可见性、deadline、迟到回调） | ① t0 hub transport 已关（窗口=0）② close Promise t0 即结算（deadline 前）；fixed 后：GOAWAY(SERVER_SHUTTING_DOWN, 5000) 帧先行、peer 观测 blocked、deadline 到 → hubSideClosed + peerSideCloseInfo=1001、迟到 UPDATE_ACK/CLOSE_NAMESPACE 零响应零异常 |
  | R2 自然收口 | AC3/AC5/AC6/AC7（提前完成、pending 收口帧处理） | t0 关传输 + CLOSE_NAMESPACE 被静默吞（零 CLOSE_OK）；fixed 后：窗口内 CLOSE→CLOSE_OK(ackedSequence) → 唯一 channel 自然收口 → drain 提前完成 → 零时间推进 1001 提前关 |
  | R3 新 OPEN/新 round 拒绝 | AC1（停止接纳的显式面——SA5 缺陷报告「次要缺陷面」） | t0 关传输 + 窗口内 OPEN_NAMESPACE/SYNC_STEP1 被静默吞（零 ERROR、零拒绝面）；fixed 后：零 OPEN_OK/零 round 响应 + 显式 ERROR 帧 + 拒绝不杀连接（窗口保持到 deadline） |
  | R4 pending apply 排空 | AC3/AC4/AC7（pending apply、不取消） | t0 关传输（apply 在途时窗口=0）；fixed 后：saveGate 悬挂的已接纳 apply 在窗口内排空（doc 收敛 + saveEvents+1）→ 排空后窗口仍开放 → deadline 1001 收口 |

- **SA3 修复实现不得回退既有行为**：`shutdownWithGoaway` 的 handshaking 分支（不发 GOAWAY 直接 close(1001)）必须保留（SA5 论证为正确）；既有 24 文件 / 175 用例基线（含 AC-6「GOAWAY 先行」、D4「GOAWAY 帧先于 close 事件」）必须保持绿。
- **测试文件不新增包/端口依赖**：仅 vitest + 既有 harness/driver（fake-duplex + fake scheduler，零 real sleep、零端口）；`scripts/test-lock.sh` 在本 Worktree 不存在，无需更新。

## SA6 AC-6 时序适配（设计 §6.2.1，SA6 独占；SA2 R2 通过后落实）

- **改动**：`packages/ws-replication/test/ws-replication-auth-lifecycle-red.test.ts` AC-6（`await closePromise` 前）插入设计 §6.2.1 登记的两行——`await run.hubNode.scheduler.advanceBy(CONTRACT_TIMEOUTS.closeTimeoutMs);`（hub 侧虚拟时钟推进至 drain deadline；`driver.advanceMs` 推进的是 peer scheduler，不可用）+ `await settle();`。**diff 恰好 +2 行**，既有断言零改动（GOAWAY 断言在插入点前；`accept → undefined` 依赖的 `hub.closed` 在 `close()` 同步段置位；`connections.length===0` 由 deadline → finishDrain → cleanupAll → dropConnection 在推进后的微任务内达成）。
- **依据**：设计 §6.2 五步证明（AC-6 `await closePromise` 内嵌 issue-#138 时代「close 随 cleanupAll 立即结算」旧时序假设；新契约下 close Promise 结算时点 = drain 完成（提前）或 deadline 达到——测试侧必须推进虚拟时钟）。所有权协议 §6.2.1：SA6 独占、SA3 实现 PR 不得包含本文件改动（Scope Creep Guard）。
- **验证证据**（`npx vitest run`，fake scheduler 零 real sleep）：
  - 适配前完整文件 `ws-replication-auth-lifecycle-red.test.ts`：`Tests 15 passed (15)`，`Type Errors: no errors`；
  - 适配后完整文件：`Tests 15 passed (15)`，`Type Errors: no errors`（同基线，无一断言回退）；
  - 适配后定向 `-t "AC-6"`：`Tests 1 passed | 14 skipped (15)`；
  - 本适配未触碰 issue #174 红灯契约：`ws-replication-issue174-goaway-drain-red.test.ts` 复跑仍 `Tests 4 failed (4)`（全部失败在窗口开启断言——与 SA6 红灯契约原状一致）。
- **回归守卫**（设计 §6.2.1 行）：适配后 AC-6 全断言原值 + 定向运行通过；SA3 实现轮次后由全量 `npx vitest run packages/ws-replication`（简报 AC-8）+ SA7 观察 vitest 退出时长（无 +5s 尾巴）闭环。
- **边界**：当前（未修复）实现下 closePromise 于 t0 即结算，插入的 advanceBy 无副作用、AC-6 仍绿；SA3 修复后 advanceBy 推进真实 drain deadline，AC-6 在新契约下同样绿（设计 §6.2 归属裁决的预期形态）。

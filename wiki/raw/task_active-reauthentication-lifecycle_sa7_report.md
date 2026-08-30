# SA7 动态验证报告 — task_active-reauthentication-lifecycle（issue #175）

**Date**: 2026-08-30
**Verdict**: **pass**（六项 SA4 动态重点全部实测通过；SA6 红灯套件 6/6 绿；全包回归 26 files / 187 tests 零回归；typecheck 零错误。唯一未闭环项 = CI 触发证据——分支未推送、无 PR、无 run，属发布链路环境未就绪，非触发失败，交总控在发布后观察）

- 被验对象：HEAD `6c7d9cf`（含 `0d80a36` 实现 + `6c7d9cf` HG9 版本 bump 0.1.2→0.1.3，`git log` 与 `grep '"version"' packages/ws-replication/package.json` = `0.1.3` 实证）
- 依据输入：SA4 review `task_active-reauthentication-lifecycle_sa4_review.md`（R2 pass，动态审核重点六项）、任务简报、SA5 `20260830-bug-active-reauthentication-lifecycle.md`
- 新增产物：`packages/ws-replication/test/ws-replication-sa7-175-dynamic.test.ts`（6 IT，D1-D6 与 SA4 六项一一对应；真实 yjs/Registry/Runtime 双实例、零源码 grep、零 mock 被测对象）
- 独立性声明：未采信 SA3/SA4 报告断言为前提；六项重点全部以独立运行的可执行断言取证，非静态推断。

---

## Step 0：SA4 verdict 校对

SA4 review 顶部：R1 **reject**（唯一阻断 F-1 版本 bump）→ **R2 pass**（`6c7d9cf` 回流核验通过，文末「R2 Verdict: pass」）。SA4 已 pass → SA7 进入动态验证。HEAD 双 commit 与 bump 落位独立复核一致。

## Step 1：SA6 红灯套件复跑（第二关）

```
命令：npx vitest run packages/ws-replication/test/ws-replication-reauth-lifecycle-red.test.ts
结果：Tests  6 passed (6)；Type Errors  no errors；EXIT=0（后台独立进程，exit 码落盘 /tmp/sa7-red-exit）
```

**SA6 红灯：🟢 GREEN** —— 6 IT（IT1 端到端 / IT2 定向性 / IT3 接收侧 deadline / IT4 恢复 / IT5 幂等竞态 / IT6 零 token 暴露）全部在实现后转绿，红灯锚（TypeError / wire 无限开放）全部被修复覆盖。

---

## Step 2：SA4 六项动态重点逐项验证

> 全部经 `ws-replication-sa7-175-dynamic.test.ts` 独立运行取证。套件级证据：`Tests 6 passed (6)，Type Errors: no errors，EXIT=0`。

### 重点 1 —— 真实 socket 事件序（SA2 红线思路 2）✅ 通过

**验证方式**：D1 IT——真实 TCP loopback（`net.Server`/`net.connect` + 4B 长度前缀成帧 transport，r1-transport-auth D4 同款基建）+ 真实 timer，`closeTimeoutMs=800` 作 drain 预算载体；peer 侧**原始 socket** 事件记录器独立于协议适配器。

**证据（实测断言）**：
- `hub.requestReauth(PEER_INSTANCE)` 后 peer 原始 socket 事件序：`frame:GOAWAY` 先达、`socket-close` 严格晚于它（`closeIndex > goawayIndex`，TCP 半关闭次序）；GOAWAY = `REAUTH_REQUIRED`、`drainTimeoutMs=800 > 0`；
- **drain 窗保持开放**：blocked 观测点 `wireEvents.includes('socket-close') === false`（GOAWAY 已达而 socket 未关——区别于 `hub.close()` 零窗口）；
- **双侧 close reason 静态码零 token**：hub 主动收口 `meta.hub = { code: 1001, reason: 'hub-reauth' }`，`reason.includes(TEST_TOKEN) === false`；peer 观测到的远程 close 即该 info；
- **全 wire 原始字节零 token**：双向 socket data 字节序列（含帧头）`bytesContain(peerRawChunks/hubRawChunks, TEST_TOKEN) === false`；
- 零协议 ERROR 帧；收口后 1.2s 真实时钟内 blocked 保持、`dialCount === 1`（零自动重拨）。

### 重点 2 —— requestReauth ↔ accept 同 tick 竞态（SA2 攻击点 3）✅ 通过

**验证方式**：D2 IT——fake-duplex；`requestReauth`（同步拷贝迭代）与 `hub.accept(wire2)` 背靠背同 tick 发起；wire2 以真实 peer 的 HELLO 原始字节完成协议握手至 hub 侧 ready。

**证据（实测断言）**：
- 第一次 `requestReauth` 后：wire1 恰 1 GOAWAY、**wire2 零 GOAWAY**（迭代错过未注册的新连接——竞态形态真实复现，契约无害：无 throw、无副作用）；
- wire2 握手完成后 `hub.connections.length === 2`（同身份双连接并存）；
- **第二次 `requestReauth` 覆盖新连接**：wire2 恰再 1 GOAWAY（`REAUTH_REQUIRED, drain>0`）、wire1 仍 1（幂等不重发）；
- 覆盖完整性：hub scheduler 推进 drain 后 wire2 hub 侧收口，peer 端观察者记录 `{ code: 1001, reason: 'hub-reauth' }`；
- peer 全程 blocked、`dialCount === 1`；`probe.events` 空（**零 unhandled rejection**）。

### 重点 3 —— SHUTTING_DEADLINE 武装后半段（SA2 红线思路 4；G2 只覆盖 fire 前）✅ 通过

**验证方式**：D3 IT——注入 `GOAWAY(SERVER_SHUTTING_DOWN, drainTimeoutMs=60)` → `advanceBy(60)` 跨过 fire 点。

**证据（实测断言）**：
- fire 前：blocked、双侧 wire 开放（G2 已覆盖面的即时复核）；
- **fire 后半段**：`wire.peerSideClosed === true`，hub 侧观察 `hubSideCloseInfo = { code: 1001, reason: 'blocked-deadline' }`；
- **state 仍 blocked（不 backoff、不重拨）**：fire 后立即 `connectionState() === 'blocked'`（非 backoff）；再推进 60_000 后仍 blocked、`dialCount === 1`、`wires.length === 1`；零 unhandled rejection。

### 重点 4 —— drain=0 × REAUTH_REQUIRED（SA2 红线思路 5；D5-B1 语义自 SHUTTING_DOWN 扩展锚到 REAUTH）✅ 通过

**验证方式**：D4 IT——注入 `GOAWAY(REAUTH_REQUIRED, drainTimeoutMs: 0)`（协议编码 `assertNonNegativeSafeInteger` 容许 0，payloads.ts:234 实证），fake scheduler `pending()` 计面对比。

**证据（实测断言）**：
- 注入后 `connectionState() === 'blocked'` 且 **`scheduler.pending()` 计面不增**（`after ≤ before`——零新 timer，D5-B1「0 值不产生任何新 timer」在 REAUTH_REQUIRED 上成立）；
- **wire 冻结**：双侧 `hubSideClosed/peerSideClosed === false`；
- 推进 60_000 后仍冻结、blocked 保持、`dialCount === 1`（若误武装 0ms deadline，任意推进都会收口 wire——冻结即无 timer 的行为证伪面）；零 unhandled rejection。

### 重点 5 —— receiver deadline ↔ rebuild 先后序镜像锚（SA2 红线思路 1）✅ 通过

**验证方式**：D5 IT——注入 `GOAWAY(REAUTH_REQUIRED, drain=60)` 后**一次** `advanceBy(60 + 60_000)`（跨 deadline 再远超 60s）、零通知。

**证据（实测断言）**：
- 旧 wire 以 `peerSideClosed === true`、hub 侧 `hubSideCloseInfo = { code: 1001, reason: 'blocked-deadline' }` **自行收口**；
- 收口后仍 `blocked`、`dialCount === 1`、`wires.length === 1`（无 rebuild 新 wire）——deadline 先于且独立于 rebuild 编排（若未来实现把 deadline 挪到 rebuild 之后，无通知则永无 rebuild，wire 无限开放，本断言红灯）；零 unhandled rejection。

### 重点 6 —— blocked 期 liveness backstop（SA2 3b）✅ 通过

**验证方式**：D6 IT——手工组装（boot 的 dial 闭包不可注入活性面）；fake wire peer 端外包裹生产可选缝 `ping/onPong`（与生产 WS transport 同形，types.ts:64-65）；`pingIntervalMs=30_000 / pongTimeoutMs=10_000`。

**证据（实测断言）**：
- 前置：ready 期 ping #1 正常往返（`pingCount === 1`、仍 ready）——活性面真实武装；
- pong 失联（`autoPong=false` 模拟 hub 死亡）+ 注入 `GOAWAY(REAUTH_REQUIRED, drainTimeoutMs=300_000)` → blocked；
- **blocked 期 liveness 值守**：`advanceBy(30_000)` → ping #2（`pingCount === 2`，无 pong）；`advanceBy(10_000)` → pong 超时 → `wire.peerSideClosed === true`、hub 侧 `hubSideCloseInfo = { code: 1001, reason: 'pong-timeout' }`（协议 §15.1 L524 活性失联收口）——**巨值 drain 下 wire 生命周期有界**；
- `onTemporaryFailure` 的 blocked 守卫（peer-connection.ts:713）实证：活性收口不触发重拨；再推进 300_000（跨巨值 drain 的 stale deadline）后仍 blocked、`dialCount === 1`、`wires.length === 1`；零 unhandled rejection。

---

## Step 3：E2E spec 触发证据

**N/A**——本任务无 `*.spec.ts`（SA4 §1.3 同判；纯 vitest 任务）。

## Step 4：vitest 触发证据（verdict 升级 — 2026-06-15）

**CI Run**: 无（环境未就绪——见下）

| Workspace Package | CI Step Name | 触发结果 | 证据 |
|---|---|---|---|
| `@nomicore/ws-replication` | Test（`pnpm test` = `vitest run --typecheck`） | ⚠ **CI 待触发**（分支未推送） | `git log origin/<branch>` → NO REMOTE BRANCH；`gh pr list --head <branch>` → `[]`；`gh run list --branch <branch>` → 空。SA7 无权 push/建 PR（职责边界），非 `vitest-package-not-triggered`（无 run 可供 runner 列表比对） |

**本地等价证据（触发接通性）**：
- `vitest.config.ts:5` include = `packages/*/test/**/*.test.ts` → 新文件 `packages/ws-replication/test/ws-replication-sa7-175-dynamic.test.ts` 与红灯套件均被 `pnpm test` 全量覆盖；
- 本地全量套件（含 `--typecheck`，与 CI Test 步同参）：`Test Files 26 passed (26)，Tests 187 passed (187)，Type Errors: no errors，EXIT=0`。

**verdict**: ⚠ ci-not-yet-run（发布链路待推送；**交总控**：push/建 PR 后观察 CI run，确认 `@nomicore/ws-replication` 出现在 runner 列表且全绿。本地触发接通性与全绿证据已在手。）

---

## 独立验证证据总表（全部命令在 worktree 根实跑，独立后台进程 + exit 码落盘）

| # | 命令 | 结果 | 判定 |
|---|---|---|---|
| V1 | `npx vitest run packages/ws-replication/test/ws-replication-reauth-lifecycle-red.test.ts` | 6 passed / Type Errors: no errors / EXIT=0 | Step 1 红灯套件绿（SA4 V1 等价复现） |
| V2 | `npx vitest run packages/ws-replication/test/ws-replication-sa7-175-dynamic.test.ts --typecheck` | 6 passed（D1-D6）/ Type Errors: no errors / EXIT=0 | 六项动态重点逐项通过 |
| V3 | `npx vitest run packages/ws-replication/test/ --typecheck` | **26 files / 187 tests passed**（SA4 R1 V1 为 25/181 → +1 文件 +6 IT 恰为本报告新增）/ Type Errors: no errors / EXIT=0 | 全包零回归 |
| V4 | `git log --oneline -3` + `grep '"version"' packages/ws-replication/package.json` | HEAD=6c7d9cf（0d80a36 在下）；version=**0.1.3** | SA4 R2 F-1 修复在位 |
| V5 | `git status --short`（tracked） | 零漂移；untracked = 任务档案 + 本报告 + 新测试文件 | 生产代码零触碰（SA7 边界） |
| V6 | 端口检查（`fuser 8000/tcp 8081/tcp 3005/tcp`） | no listeners | 无需清场；全程零 `fuser -k` |

## 结论

1. **六项 SA4 动态重点全部通过**：真实 TCP 事件序（GOAWAY 先于 socket-close、drain 窗开放、双侧静态 close 码零 token、全 wire 字节零凭据）、同 tick 竞态（错过无害 + 幂等重发覆盖新连接）、SHUTTING_DEADLINE 后半段（1001/'blocked-deadline' 收口且仍 blocked 不重拨）、drain=0（pending 计面不增 + wire 冻结）、receiver deadline 先于 rebuild（无通知自行收口）、blocked 期 liveness backstop（pong-timeout 1001 收传输、巨值 drain 有界）。
2. SA6 红灯套件 6/6 绿（第二关通过）；全包 26/187 零回归；typecheck 零错误。
3. 新增补充测试 `ws-replication-sa7-175-dynamic.test.ts` 为 CI 资产（vitest include 覆盖），同时构成六项重点的回归锁。
4. 唯一待办：CI run 触发证据——分支未推送无 PR，属发布链路环节（总控处置），本地等价证据（include 模式 + 全量绿）已在手。

**Verdict: pass**

# [Bug] HubConnectionImpl.shutdownWithGoaway() 的 drainTimeoutMs 是虚构窗口——GOAWAY 与 transport.close(1001) 同步栈收口

**Status**: analyzed | **Date**: 2026-08-30
**Severity**: high
**Type**: new-feature-defect (broke at: `01e6801` — issue #138 切片 7「D5 hub.close() GOAWAY 先行」引入，该功能自诞生即不完整，非回归)
**Layer**: backend (`packages/ws-replication`)

## Symptoms

`HubReplication.close()` → `HubConnectionImpl.shutdownWithGoaway(drainMs)` 对 peer 宣告 GOAWAY（`SERVER_SHUTTING_DOWN` + `drainTimeoutMs`），但**发送 GOAWAY 后在同一个同步调用栈内立即调用 `this.close(1001, 'hub-shutdown')` 关闭 transport**。因此：

1. 宣告的 `drainTimeoutMs` 没有形成任何真实 drain 窗口（窗口长度 = 0）。
2. peer 收到 GOAWAY 后没有任何时间窗口执行协议 §6.3 要求的行为（停止新 OPEN、现有 namespace 自然收口）——`ws-replication-sa7-r1-transport-auth.test.ts` D4 已证明 wire 上 GOAWAY 帧先于 close 事件（次序正确），但两者间隔为零，peer 的 drain 逻辑来不及做任何事。
3. hub 侧连接状态 `ready → draining → closed` 在同一同步栈内完成，`draining` 状态形同虚设（协议 §15.2 hub FSM 的 draining 是独立状态）。
4. hub 已接纳的 namespace apply 排空发生在 transport 关闭**之后**的 `cleanupAll()` 异步链里，且 drain 期间到达的 peer 收口帧（UPDATE_ACK / SYNC_APPLIED / CLOSE_NAMESPACE）被全部丢弃。
5. `HubReplication.close()` 返回的 Promise 不等待 drain deadline 也不等待自然收口，直接随 cleanupAll 结算——宿主 Host shutdown 序列（ADR-0010 L179）中「等待已被 Runtime 接纳的 apply 槽完成但不无限等待网络 ACK」的等待域被完全跳过。

影响范围：所有触发 Hub 优雅停机的部署（Host shutdown / 复制插件 stop）；peer 在停机瞬间可能丢失最后一轮已送达 hub 但未完成 ACK 语义确认的收口机会，且只能走「无明确 GOAWAY 的 1001」之外的 path——实际上 peer 收到的是 GOAWAY(SERVER_SHUTTING_DOWN) → 立即 blocked（永久失败面），drain 承诺落空。

## Reproduction

（临时复现文件 `packages/ws-replication/test/ws-replication-tmp-sa5-repro.test.ts`，已运行取证后删除；fake scheduler 虚拟时间冻结，零 real sleep）

1. `boot({ timeouts: { ...CONTRACT_TIMEOUTS, closeTimeoutMs: 5_000 } })`——hub/peer 双实例、namespace live。
2. `const p = run.hub.close()`，随后**仅 `await settle()` 排空 microtask，绝不调用 `advanceMs`**（虚拟时间冻结在 t0，drain deadline = t0+5000 永未到达）。
3. 断言：
   - `run.hubFramesAll('GOAWAY').length === 1` 且 `drainTimeoutMs === 5000` ✓（GOAWAY 确实发出并宣告了 5 秒窗口）
   - `run.wire.hubEnd.closed === true`（t0 时刻 transport 已关）
   - `p` 已结算（hub close Promise 在 deadline 前完成）
4. 第二个用例：hub.close() 后、deadline 前从 peer 侧 `send(UPDATE_ACK)` → 帧被静默吞掉（hub 的 transport 监听器已在 cleanupAll 中 detach，且 `onMessage` 的 `closedFlag` 早退）。

基线：全部既有 ws-replication 测试 24 文件 / 175 用例在当前实现下通过（`npx vitest run packages/ws-replication`）——证明既有套件没有任何锚覆盖「GOAWAY 与 close(1001) 之间的真实窗口」，这正是 issue #174 AC7 要求新增动态测试的原因。

## Investigation

阅读顺序（≤10 文件）：

1. `wiki/raw/task_issue-174-goaway-drain.md`（任务简报）+ `task_issue-174-goaway-drain_relevant_decisions.md`（SA8 门禁摘录的 ADR-0010/0008/0009 条款）。
2. `packages/ws-replication/src/hub-connection.ts`——缺陷点 `shutdownWithGoaway()`（L324-340）与 `close()`（L308-318）、`cleanupAll()`（L544-553）、`HubReplicationImpl.close()`（L217-227）。
3. `docs/protocols/instance-replication-v1.md`——§6.3 GOAWAY（L141-149）、§15.1 peer FSM（L413-417 draining）、§15.2 hub FSM（L447）、§21 停机顺序（L561-574）。
4. `packages/ws-replication/src/hub-namespace.ts`——`quiesceConnection()`（L574-581，同步静默）、`onConnectionClosed()`（L593-600，closeQueue → `drainPendingApplies()` → `settleClose()` session close + lease release）、`drainPendingApplies()`（L866-868）、`closeSessionAndRelease()`（L870-890）。
5. `packages/ws-replication/src/peer-connection.ts`（grep 对照）——peer 侧 `onGoaway`（L398-414）→ `draining` + 武装 `drainCloseHandle` deadline timer（L418-429，fire 时 teardown + `close(1001,'goaway-drain')`）；drain 期 `goawayActive` 停新 OPEN（L470）。**peer 侧 drain 语义完整，唯独 hub 发送侧不兑现自己宣告的窗口。**
6. git 考古：`git log -S shutdownWithGoaway` → 引入于 `01e6801`（issue #138 D5「hub.close() GOAWAY 先行 + 关闭后零接纳」），提交信息自称「GOAWAY 先行」但实现只是把 GOAWAY 帧塞在 close 之前同栈发出——自诞生即无 drain 窗口，判定 new-feature-defect 而非 regression。

数据流（§21 停机顺序 vs 实现现状）：

- 协议要求的链路：`replication 停止接纳 + 发 GOAWAY` → `namespace 停新 frame、排空已接纳 apply（≤drainTimeoutMs，不无限等网络 ACK）` → `自然收口或 deadline 到达` → `close(1001)` → `close sessions + release leases` →（Host 侧）Registry shutdown → Persistence dispose → Timer/Clock 停止。
- 实际链路：`closed=true（accept 门 0 生效）✓` → `GOAWAY 发出 ✓` → **同一栈内 `transport.close(1001)` + 同步 `quiesceConnection()` 全部 channel ✗** → `cleanupAll()` 异步排空已接纳 apply + session close + lease release（顺序本身符合 §6 语义，但发生在传输已死之后）。
- 断点：GOAWAY 之后没有任何等待（无 timer、无 Promise.race(deadline)、无「namespace 全部 quiet 即提前完成」观测）——`drainTimeoutMs` 参数传入后仅被编码进 GOAWAY 帧，从未参与本地调度。

## Root Cause

`packages/ws-replication/src/hub-connection.ts` L324-340（`shutdownWithGoaway`）：

```ts
shutdownWithGoaway(drainMs: number): void {
    if (this.closedFlag) return;
    if (this.state === 'handshaking') { this.close(1001, 'hub-shutdown'); return; }
    try {
      this.outbound.sendControl({ kind: 'GOAWAY', reasonCode: 'SERVER_SHUTTING_DOWN', drainTimeoutMs: drainMs });
    } catch { /* best-effort */ }
    this.close(1001, 'hub-shutdown'); // ← 根因：GOAWAY 后无条件同步 close，drainMs 从未用于本地调度
  }
```

`drainMs` 只被写进 wire 帧，本地零消费：无 deadline timer（经注入的 `hub.timer`）、无对 channels 自然收口（`isQuietState()`）的观测、无对已接纳 apply 排空（`channel.onConnectionClosed()` 的 `drainPendingApplies()`）完成或超时的等待。`close()`（L308-318）随即同步执行 `sender.teardown()` + 全 channel `quiesceConnection()`（强制 `closing`，而非自然收口）+ `transport.close(1001)`，并在 `cleanupAll()`（L544-553）里 detach transport 监听器，使 drain 期间到达的一切入站帧（UPDATE_ACK/SYNC_APPLIED/CLOSE_NAMESPACE）无法被处理。

次要缺陷面（同一根因的直接后果，修复时需一并考虑）：

- **AC1 停接纳粒度**：drain 窗口内 hub 对新 OPEN_NAMESPACE / 新 sync round 应显式拒绝（协议语义），当前实现因 `closedFlag` 早退（`onMessage` L355）而**静默丢弃**所有入站帧——「不接纳」成立但「显式拒绝」缺失。
- **AC4/AC6 顺序**：session close + lease release（`closeSessionAndRelease`，hub-namespace.ts L870-890）目前发生在 transport 关闭之后的异步 cleanup 中；协议 §21 要求先排空再关传输，session/lease 收口逻辑上属于 close(1001) 之后并无冲突，但若修复改为「窗口内自然收口」，channel 级 quiet→settleClose 提前完成后 close(1001) 到来时不得重复收口（幂等性已由 settleClose 链式追加保证）。
- `HubReplicationImpl.close()`（L217-227）以 `this.timeouts.closeTimeoutMs`（默认 5_000，defaults.ts L38）作为 GOAWAY drain 时长，并把 `settle()`（各 connection 的 `settleTail`）聚合成 close Promise——修复后该 Promise 的结算时点自然变为「drain 完成（提前）或 deadline 到达」，无需改结构。
- handshaking 分支（L326-329）不发 GOAWAY 直接 close(1001) 是**正确**的（HELLO 未完成，GOAWAY-before-ACK 反而是协议伤害，注释 L320-323 已论证），修复时必须保留。

**Fix direction**（供 SA1 设计参考，不展开实现）：`shutdownWithGoaway` 需要把「GOAWAY 发出」与「transport.close(1001)」解耦为真实的 drain 阶段——连接进入 `draining`（停新 OPEN/sync round 的显式拒绝面），经注入 timer 武装 `drainMs` deadline，窗口内允许 channels 自然收口（提前完成即提前关），deadline 到达不等待未完成网络 ACK，随后才走既有 close(1001)/cleanupAll 路径；`HubReplication.close()` 的 settle 聚合面不变。

## Evidence

1. **动态复现（临时测试，已删除）**——`packages/ws-replication/test/ws-replication-tmp-sa5-repro.test.ts`，`npx vitest run`：2 passed：
   - R1：`hub.close()` 后仅 `await settle()`（零 `advanceMs`，虚拟时间 t0，deadline t0+5000 未到）→ `GOAWAY×1 且 drainTimeoutMs=5000` ✓；`run.wire.hubEnd.closed === true` ✓；close Promise 已结算 ✓ ——drain 窗口长度为 0。
   - R2：deadline 前 `peerEnd.send(UPDATE_ACK)` → 零 ERROR、零处理（监听器已 detach + closedFlag 早退）——drain 期无入站处理窗口。
2. **基线绿灯**：`npx vitest run packages/ws-replication`（排除临时文件）→ 24 files / 175 tests passed, typecheck 0 errors——现有套件不覆盖窗口时长（D4 只断言 GOAWAY 帧 wire 次序先于 close 事件，不断言间隔）。
3. **代码证据**：`hub-connection.ts` L330-339（GOAWAY 发送后紧邻 `this.close(1001, 'hub-shutdown')`）；L308-318（`close()` 同步 teardown + quiesce + `transport.close`）；L355（`onMessage` 的 `if (this.closedFlag) return;` 静默早退）；L544-553（`cleanupAll` detach 监听器后才异步跑 `onConnectionClosed()` → `drainPendingApplies()`）。
4. **协议证据**：`docs/protocols/instance-replication-v1.md` L149「收到 GOAWAY 后停止 OPEN，不开始新 sync round；现有 namespace 到 deadline 前自然收口，之后发送方以 WS 1001 关闭」；L447 hub FSM `upgraded → handshaking → ready → draining → closed`；L565-574 §21 停机顺序 + 「Drain 不无限等待网络 ACK」。
5. **git 考古**：`git log -S shutdownWithGoaway --oneline -- packages/ws-replication/src/hub-connection.ts` → 单一提交 `01e6801`（2026-08-29，issue #138 切片 7）。提交说明 D5 自述「GOAWAY 先行 + 关闭后零接纳」，未声称实现 drain 窗口——功能自引入即缺半。
6. **peer 侧对照**：`peer-connection.ts` L398-429（onGoaway → draining + `drainCloseHandle` deadline timer → `close(1001,'goaway-drain')`；L470 drain 期停新 OPEN）——接收侧语义完整，佐证缺口仅在 hub 发送侧。

## 现场清理

- 临时复现文件已删除；`git status --porcelain` 仅余 4 个任务自带未跟踪文件（task_issue-174-*），`git diff --stat` 为空。未在源码中添加任何 `[SA5-DIAG]` 日志。

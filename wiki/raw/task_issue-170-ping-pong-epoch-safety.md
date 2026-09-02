# Issue #170 — Phase 5 ping/pong timeout epoch safety

- **Repository:** `welltop-jim-wang/nomicore`
- **Branch:** `fix/issue-170-on-docs-phase-5-websocket-replication`
- **Run ID:** `issue-170-1788047268-4073122`
- **Round:** 1
- **Task type:** bugfix

## Issue requirement

Title: Phase 5 follow-up: make ping/pong timeout handling epoch-safe and protocol-correct

Parent: #130 (Phase 5 integration base; implementation branch must be based on `docs/phase-5-websocket-replication`).

PR #165 was merged into #130. The ping/pong seam exists, but timeout handling, old-connection unbinding, and pong association still have cross-connection-generation risk. This task covers liveness and transport generation, not backpressure or namespace cleanup.

### Scope

- On peer pong timeout, synchronously finish old-liveness stopping, old transport message/close/pong listener unsubscription, old transport close, and old connection epoch invalidation before scheduling backoff.
- Every pong-timeout callback must capture and validate transport identity plus connection epoch; an old timer cannot affect a replacement connection.
- Hub pong timeout must use the authoritative protocol temporary-failure semantics and WebSocket close code 1001; do not emit an unregistered `PONG_TIMEOUT` protocol error or use 1002.
- Associate each pong with an outstanding ping; delayed or unsolicited pong must not clear the next ping timeout.
- Preserve the constraint of no application-level PING/PONG frames.

### Acceptance criteria

- A stale connection pong timeout firing after a replacement is ready does not affect new state, sequence, backoff, or namespaces.
- Within the synchronous timeout-to-backoff stack, old transport is closed and old listeners/liveness are unbound.
- Hub timeout close code and error behavior fully match `docs/protocols/instance-replication-v1.md`.
- Deterministic tests cover delayed, duplicate, unsolicited, and old-epoch pong.
- Real/fake transport tests prove that after reconnect the hub retains only the new connection and data eventually converges.
- `pnpm run typecheck`, `pnpm exec vitest run packages/ws-replication --typecheck`, and `git diff --check` pass.

## SA6 初始红灯契约（Round 1，2026-08-30）

**红灯测试文件**：`packages/ws-replication/test/ws-replication-issue170-r1-r4-red.test.ts`（6 tests）

**测试设计**（锚点 = SA5 报告 `wiki/raw/20260830-bug-ping-pong-epoch-safety.md` R1–R4 + 验收标准）：

- 全链路真实栈：真实 `createHubReplication`/`createPeerReplication` + 真实 Registry/Runtime/Y.Doc（harness `makeNode`/`makeHubNamespace`）+ 内存双端 liveness wire（两端独立 ping/pong 面；**pong 回显 ping 载荷**——WS 关联凭据；可手动注入任意载荷 pong；可模拟"已关传输上 ping 的 ws 语义抛错"）；fake scheduler 虚拟时钟（30s/10s 契约超时、backoff 100k×0.5），零 real sleep、零 skip、零源码 grep、断言全部为运行时行为（wire 帧/close 码/监听计数/ping 计数/FSM 状态/副本收敛值）。
- **H1（R1，hub 协议违约）**：hub pong 超时 → `hubCloseLog()[0].code === 1001`（现 1002）+ wire 上零 `PONG_TIMEOUT` ERROR 帧（§10 注册表无此码）+ peer 走 `backoff`（现 `blocked` 终态）+ backoff 到期重拨 `dialCount===2`（现恒 1）+ 重连后 `hub.connections.length===1`、数据收敛（hub 写 n→peer 副本 n）。
- **P1/P2/P3（R2，pong↔ping 零关联）**：驱动真实 peer 连接 liveness——迟到 pong（载荷 = 上一 ping 回声）、重复 pong（同一回声二次投递）、未请求 pong（从未发送过的载荷）分别注入在途 ping 窗口；断言下一 ping 的 pong 超时**必须照常收口**（t+10s 后 `state==='backoff'` + `close(1001)`）。现实现：任何 pong 无条件清当前 `pongHandle` → 连接滞留 `ready`（死对端被误判存活）。
- **P4（R3，peer 超时收口顺序 + old-epoch）**：peer pong 超时的同步栈内 `pongListeners/messageListeners/closeListeners === 0`（现 1）、backoff 窗口 [40s,90s) 内 `peerPingsAfterClose()===0` 且零 `closedTransportPingErrors`（现僵尸 liveness 对已关传输 ping、真实 ws 语义 = timer 回调内未捕获异常）；重拨后 hub 只留新连接、旧传输注入旧代 pong 后新连接状态/ns 零扰动、数据收敛。
- **P5（R4，blocked 泄漏）**：hub 1002 关闭 → peer `blocked`；blocked 态 `pongListeners/messageListeners/closeListeners === 0`（现 1）、30s+10s 推进零 ping 活动（现 1）、零自发二次 close(1001)（现有）；blocked 终态不重拨（护栏，非缺陷面）。

**红灯运行结果**（`pnpm exec vitest run packages/ws-replication/test/ws-replication-issue170-r1-r4-red.test.ts`）：

```
Test Files  1 failed (1)
     Tests  6 failed (6)
```

关键红灯证据（全部为断言失败，非崩溃/超时）：
1. H1 → `AssertionError: BUG R1：hub pong 超时必须 close(1001)... expected 1002 to be 1001`
2. P1 → `BUG R2：迟到（旧 ping）pong 不得清掉下一 ping 的超时...: expected 'ready' to be 'backoff'`
3. P2 → `BUG R2：重复（旧 ping）pong 不得清掉下一 ping 的超时...: expected 'ready' to be 'backoff'`
4. P3 → `BUG R2：未请求 pong 不得清掉在途 ping 的超时...: expected 'ready' to be 'backoff'`
5. P4 → `BUG R3：pong 超时同步退订 pong 监听...: expected 1 to be +0`
6. P5 → `BUG R4：blocked 必须退订 pong 监听...: expected 1 to be +0`

**无损伤验证**：`pnpm exec vitest run packages/ws-replication` → `22 passed (22), Tests 155 passed (155) | 6 failed (6, 新增文件), Type Errors no errors`；`tsc -p packages/ws-replication/tsconfig.json --noEmit` 通过；`git diff --check` 通过（新文件零尾随空白）。

**对 SA1/SA3 的契约提示**：P1–P3 以「pong 回显 ping 载荷」为关联凭据（wire 只忠实回显 `ping(data)` 的载荷）；当前 `DuplexTransport.onPong?(listener: () => void)`（types.ts:63）丢弃载荷，需按契约扩展 seam 透传 pong 载荷（或等价关联面），否则 P1–P3 无法转绿。**约束**：不得引入应用级 PING/PONG 帧（协议 L42）；hub 超时不得发明未注册连接错误码（§10）——H1 护栏断言零 `PONG_TIMEOUT` ERROR 帧上 wire。

## Issue comments

No comments.

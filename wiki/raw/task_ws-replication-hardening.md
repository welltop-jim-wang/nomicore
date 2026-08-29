# MABF Task Brief — Follow-up: harden WebSocket replication protocol after PR #160

## 任务身份
- repository: welltop-jim-wang/nomicore
- issue: #161
- worktree: /home/wangjian/nomicore-fix-issue-161
- branch: fix/issue-161-on-docs-phase-5-websocket-replication
- base branch: docs/phase-5-websocket-replication
- run_id: issue-161-1787928711-327517
- round: 1
- 任务类型（总控自判）: Bug 修复 — PR #160 post-review 识别的协议/生命周期缺陷加固（含新增加固能力与确定性测试要求）
- slug: ws-replication-hardening

## Parent

#130（Phase 5 integration base；实现票分支应以其分支为基线）

## Context

PR #160 delivered the Phase 5 namespace replication slice and passed its package tests/typecheck, but post-review identified protocol and lifecycle gaps that must be fixed before the Phase 5 integration branch is merged to `main`.

## Required fixes

### Authentication and connection generations

- [ ] Bind `HubReplication.accept()` to the trusted identity/auth context produced by the HTTP Upgrade bearer-token verification.
- [ ] Reject a HELLO whose `peerInstanceId` differs from the trusted Upgrade identity; do not authorize using an identity asserted only by the wire frame.
- [ ] Bind Peer transport message/close callbacks to the active transport or connection epoch so late callbacks from an old socket cannot mutate the new connection's sequence counter/state or trigger backoff.

### ACK correlation and recovery

- [ ] Retain the sent `BOOTSTRAP_SNAPSHOT` sequence and require `BOOTSTRAP_ACK.ackedSequence` to match it; mismatches must follow the protocol violation/error policy.
- [ ] Retain the sent `CLOSE_NAMESPACE` sequence and require `CLOSE_OK.ackedSequence` to match it; invalid ACK correlation must not complete close.
- [ ] On Hub-side UPDATE ACK timeout, notify the Peer with a memoized `RESYNC_REQUIRED` so the Peer can initiate the required recovery round.
- [ ] Verify ACK timeout handling is correctly re-armed for the oldest remaining in-flight update after partial window progress.

### Backpressure and fairness

- [ ] Route UPDATE/data frames through real per-namespace queues rather than the control-frame path.
- [ ] Implement connection-level round-robin scheduling: control/error/ACK priority, then at most one data frame per namespace per round.
- [ ] Enforce `maxQueuedBytesPerConnection`; shed the largest queued namespace(s), mark them `needs-resync`, and return to the configured low-water mark.
- [ ] Reserve bounded capacity for control frames and terminate with `CONNECTION_BACKPRESSURE` when exhausted.
- [ ] Observe WebSocket `bufferedAmount`: pause dequeue above `highWater` and resume below `lowWater` using the injected Cordis timer.

### Close, GOAWAY, and async race safety

- [ ] On CLOSE, synchronously stop namespace/session acceptance before awaiting pending applies or cleanup.
- [ ] Ensure every apply accepted before CLOSE is included in the drain and settles before session/Lease release.
- [ ] Prevent late round settlement from reviving `closing`, terminal, or disconnected namespaces to `live` on both Hub and Peer.
- [ ] Ensure GOAWAY/blocked connection handling synchronously quiesces every namespace channel and subscriptions before reconnect/cleanup.
- [ ] Flush or settle duplicate OPEN waiters when a namespace closes while OPEN work is pending.

### Liveness and testability

- [ ] Wire the required WebSocket ping/pong liveness behavior through the transport/host integration without introducing application-level PING/PONG frames.
- [ ] Replace the production `queueMicrotask` delay loop used for test observability with an explicit deterministic test seam.
- [ ] Remove or use the currently dead per-namespace queue/lifecycle abstractions so the implementation has one authoritative scheduling and lifecycle mechanism.

### Delivery clarification

- [ ] Clarify whether Phase 5 `resetReplica`, structured observability, and app/deployment composition are delivered by later slices; create/link separate tickets if they are outside this fix.

## Acceptance criteria

- [ ] A spoofed HELLO identity is rejected before namespace authorization.
- [ ] Delayed message/close callbacks from an old socket cannot affect a replacement connection.
- [ ] Forged/stale BOOTSTRAP_ACK and CLOSE_OK frames cannot advance state.
- [ ] Hub ACK timeout deterministically causes Peer-initiated reconciliation and convergence.
- [ ] Deterministic multi-namespace tests prove control priority, round-robin fairness, queue shedding, and high/low-water behavior.
- [ ] Deterministic race tests prove CLOSE stops acceptance synchronously, drains all accepted applies, and terminal states cannot revive.
- [ ] Existing PR #160 acceptance tests remain green, along with repository typecheck and `git diff --check`.

## References

- PR #160
- Issue #136
- `docs/protocols/instance-replication-v1.md` §§2, 8.2, 10.2, 12, 16–18
- `docs/adr/0010-hub-peer-websocket-ydoc-replication.md`

## SA6 红灯契约（2026-08-28，issue #161 加固轮）

- 契约记录：`wiki/raw/task_ws-replication-hardening_sa6_red.md`（逐条红灯锚、确定性方法、实现提示）。
- 红灯测试（新增，仅测试文件）：
  - `packages/ws-replication/test/ws-replication-sa6-hardening-g1-g2-red.test.ts`（AC1/AC2/AC3，5 例）
  - `packages/ws-replication/test/ws-replication-sa6-hardening-g3-g4-red.test.ts`（AC4/AC5/AC6，10 例）
- 红灯命令（repo root）：`./node_modules/.bin/vitest run packages/ws-replication`
- 实测基线：15 failed（两新文件全部红灯）/ 82 passed（PR #160 既有测试全绿）/ Type Errors none / `git diff --check` 通过；零 real sleep，全用例 <3s。

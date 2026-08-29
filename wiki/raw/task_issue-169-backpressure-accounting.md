# Issue #169 — Phase 5 follow-up: correct connection backpressure accounting and control reserve

## Task Type
bug

## Parent
#130 (Phase 5 integration base; implementation branch must use `docs/phase-5-websocket-replication` as baseline)

## Context
PR #165 merged into #130. Post-merge review found connection-level backpressure still disagrees with the authoritative protocol regarding accounting, control reserve, and budget behavior. This issue only handles connection send scheduling and accounting; it does not handle ping/pong or namespace lifecycle.

## Scope
- Correct strict admission accounting in `packages/ws-replication/src/backpressure.ts`: avoid double-counting the current frame and gaps for pending handoff/in-flight encoded bytes while transport `bufferedAmount` updates asynchronously.
- Define and implement a unified ledger for `maxQueuedBytesPerConnection`: queued data, handed-off-but-not-yet-absorbed data, and protocol-required socket pressure must not leave an accounting gap.
- Implement authoritative shedding trigger and recovery target; if recovery must reach `lowWater`, do not stop merely at cap.
- Implement control reserve as a ledger of control-frame bytes not yet flushed by the socket, rather than cumulative data sent during an entire paused period.
- Implement authoritative field/default/constraint: `maxQueuedControlBytes`, default 8 MiB, and no smaller than `maxBootstrapBytes + framing overhead`; remove or migrate the old `controlReserveBytes` contract.
- Derive the backpressure poll interval from `ackTimeoutMs` using the authoritative formula; do not use a fixed 1000ms interval.
- Preserve the `ConnectionSender` / `DataSenderFacet` single data plane established by PR #162; do not reintroduce a second OutboundQueue data scheduler.

## Acceptance criteria
- With continuous sends in one synchronous stack and delayed transport `bufferedAmount` updates, total pressure never exceeds configured budget.
- Boundary coverage: exactly cap; first frame that would cross cap; shedding recovery target; a single frame bigger than cap; multiple namespace victim selection.
- Once control is flushed, quota is released correctly; before flushing, the first over-limit control frame is not put on wire and emits exactly one `CONNECTION_BACKPRESSURE` plus close(1011).
- A custom `ackTimeoutMs` produces the protocol-formula poll interval.
- Fairness, control priority, no-starvation, and bounded-memory regression tests remain green.
- `pnpm run typecheck`, `pnpm exec vitest run packages/ws-replication --typecheck`, and `git diff --check` pass.

## References
- PR #130, PR #165, issue #161 review feedback
- `docs/protocols/instance-replication-v1.md` §17
- `docs/adr/0010-hub-peer-websocket-ydoc-replication.md`

## Source note
Runner supplied this complete authoritative specification after `gh issue view` failed due to the deprecated GraphQL Projects classic field. The issue has no comments.

---

## SA6 红灯契约（Phase 1，2026-08-29）

### 新增红灯测试

`packages/ws-replication/test/ws-replication-issue169-backpressure-accounting-red.test.ts`（14 断言组 / 17 用例，直构真实 `ConnectionSender` + 真实 `OutboundQueue` + 真实 codec；仅传输边界与注入调度器为 seam；G9 为真实 Hub/Peer E2E）。

| 用例 | 契约锚点（协议 §17） | 预期绿灯修复 |
|------|----------------------|--------------|
| G1 | 同步栈 10×16KiB 直发 + bufferedAmount 滞后(恒 0)：放行帧数 = floor(cap/帧长)=3，上线字节 ≤ cap，零 1011 | admission 账本计 pending-handoff（每帧恰一次） |
| G2a | cap = 3×帧长（恰好）：3 帧放行、第 4 帧拒纳 | 严格 `projected ≤ cap` |
| G2b | cap = 3×帧长 − 1：2 帧放行（首帧越界） | 同上 |
| G2c | 单帧 > cap → 0 帧放行（锚：既有守卫） | 保持 |
| G3a | 冲刷前首个过限控制帧不上线 + 恰一次 onBackpressureExhausted（锚） | 保持（首过限帧语义） |
| G3b | socket 全冲刷（buffered 恰好降 ≥ 帧长，仍 paused）→ 额度释放，第二帧放行、零 1011 | 控制额度 = 未冲刷控制字节账本（冲刷即释放） |
| G4 | ns-a 40KiB+ns-b 25KiB（65KiB>cap）：两 ns 整队丢弃，幸存 queued ≤ lowWater；victim=最大优先 | shed 恢复目标 = queued 侧 ≤ lowWater |
| G4b | 单 ns 超 cap、另一 ns 未超：仅超限 victim 丢弃（锚） | 保持 |
| G5 | ns-b incoming 12KiB 使总压越限：拒纳该帧 + ns-b 幸存排队帧同批丢弃，零 1011 | 严格接纳（不静默纳、不静默吞） |
| G6a | ackTimeoutMs=5000 → poll=50ms 恢复（49ms 未动；非 1000ms） | interval = max(1, floor(ackTimeoutMs/100)) |
| G6b | ackTimeoutMs=1 → max(1, 0)=1ms 恢复 | 同上 |
| G7a | 缺省物 `maxQueuedControlBytes` = 8 MiB | 字段/缺省迁移 |
| G7b | 旧 `controlReserveBytes` 从缺省物移除 | 字段迁移 |
| G7c | maxQueuedControlBytes < maxBootstrapBytes+128 → 构造期响亮 TypeError | validate 启动约束 |
| G7d | 恰值 maxBootstrapBytes+128 与缺省组合合法（锚） | 保持 |
| G8 | 缺省配置下暂停窗口内 100KiB BOOTSTRAP_SNAPSHOT 放行（8 MiB 额度）、零 1011 | 缺省 8 MiB，≥ maxBootstrapBytes+开销 |
| G9 | 真实 Hub/Peer E2E：hub 侧 socket 塞住(buffered>highWater)时 100KiB 文档 bootstrap 照常上线；零 CONNECTION_BACKPRESSURE ERROR / 零 close | 同上 + close(1011) 接线 |

**对 SA3 的接口提示**（契约面，非锁死实现）：G6 的 host 提供 flat `ackTimeoutMs: number`（权威公式输入；当前 `ConnectionSenderHost` 未消费——实现需在宿主上暴露 ackTimeoutMs 或等价物）。测试侧 limits 同时携带旧 `controlReserveBytes`（当前相位宿 Hook）与新 `maxQueuedControlBytes`（Authority）；G7b 断言生产缺省物中旧字段必须消失。

### 红灯运行证据（2026-08-29，HEAD=ef19bae，未修改任何生产代码）

命令：`pnpm exec vitest run packages/ws-replication/test/ws-replication-issue169-backpressure-accounting-red.test.ts`（后台独立进程，fake scheduler，零 real sleep）

```text
Test Files  1 failed (1)
      Tests  13 failed | 4 passed (17)     ← 13 条红灯全红（G1/G2a/G2b/G3b/G4/G5/G6a/G6b/G7a/G7b/G7c/G8/G9）
Type Errors  no errors
```

关键失败输出（节选）：

```text
[G1] 严格接纳：放行帧数受预算约束: expected 10 to be 3            → 同步栈 10/10 击穿（2.5× 超限，零拒纳）
[G4] 恢复目标 = queued ≤ lowWater：ns-b 幸存帧亦被丢弃: expected [UPDATE] to have length 0 but got 1 → 停在 cap 非 lowWater
[G6a] 50ms：公式间隔恢复 drain: expected [] to have a length of 1 but got 0 → poll 慢 20×（1000ms）
[G9] 缺省 8MiB 控制额度：合法 BOOTSTRAP 不清零连接: expected undefined, got { code: 1011, reason: "protocol-error" } → 缺省自伤误杀 + close(1011) 接线确证
```

4 条锚定测试（G2c 单帧守卫 / G3a 首过限帧+恰一次 / G4b victim 选择 / G7d 合法组合）在现实现下保持绿色——锁定既有正确行为、防止修复回归。

`tsc -p packages/ws-replication/tsconfig.json`（含新测试文件）与 `git diff --check` 均通过。

# Issue #171 — Phase 5 follow-up: close namespace lifecycle races across connection generations

## Task Type
bugfix

## Context
PR #165 has merged into parent branch `docs/phase-5-websocket-replication` (parent #130). Review found namespace opening/closing, connection loss, and delayed cleanup can install or clear resources across connection generations.

## Scope
- Once a Hub connection quiesces, all delayed authorize/open/session continuations treat `closing` or connection-quiesced as abort; newly acquired lease/session releases immediately and no late `OPEN_OK`/bootstrap is sent.
- Peer queued cleanup captures generation, session/lease and unsubscribe ownership; an old `cleanupTail` cannot unsubscribe or clear resources for a new connection generation.
- Every `onConnectionLost()` branch, including `closing` and `failed`, completes generation-safe cleanup: listener, session, lease, watchdog, round, ACK timer, and channel state.
- `removeTarget()` waits for `CLOSE_OK` only if `CLOSE_NAMESPACE` received a positive sequence and went on wire; if send is suppressed, clean locally and settle immediately.
- Incorrectly correlated `CLOSE_OK` follows authoritative ACK/protocol-violation policy: no silent completion or indefinite hang.
- GOAWAY `SERVER_RESTARTING` / `SHUTTING_DOWN` follows protocol timing and quiesces subscriptions synchronously.
- Evaluate Hub `LifecycleQueue` and Peer memoized promise + `cleanupTail` as lifecycle authorities; unify semantics or define separate authoritative duties and remove dead abstraction.

## Acceptance Criteria
1. Delayed authorize, open lease, session open, and cleanup continuation cannot revive an old namespace or clear a new-generation listener after disconnect/reconnect/close.
2. Every acquired lease/session is released exactly once; no subscription, watchdog, round, ACK timer, or channel-state leak.
3. If CLOSE is not put on wire, `removeTarget` does not wait for `closeTimeoutMs`.
4. Forged/stale/mismatched `CLOSE_OK` produces explicit error and closure behavior.
5. GOAWAY synchronously stops new data acceptance; its deadline only controls transport close and does not delay needed namespace quiesce.
6. `pnpm run typecheck`, `pnpm exec vitest run packages/ws-replication --typecheck`, and `git diff --check` pass.

## SA6 红灯契约（2026-08-30，issue #171）

测试文件：`packages/ws-replication/test/ws-replication-issue171-red.test.ts`（新文件；四组确定性红灯 H1/P3/C4/G5，对应 Scope 1/2/5/6）。
运行命令：`pnpm exec vitest run packages/ws-replication/test/ws-replication-issue171-red.test.ts`（从 worktree 根执行；本 worktree 需先 `pnpm install`）。

### 测试设计与预期红灯

- **H1（Scope 1 / AC1+AC2·SA5 E2 泄漏变体）**：custom boot（registry observer 官方 seam 记录 `lease-released.remainingLeases`）+ authorize 首调门闩。gen1 hub 通道 `startOpen` 挂死在 authorize → `closeHubSide`（连接静默 → `quiesceConnection` → 收口链 → 通道终局 `closed`）→ 放行门闩 → 续体恢复，`registry.open` 成功交付 lease 后命中 `isTerminal()` → `finishOpenSilently` 只回收字段、`opened.lease` 局部值永不 release。断言：① 续体恢复后必有 `lease-released` 事件（现实现零事件 → 红灯）；② gen2 重连 live 并 `peer.stop()` 后最终 `remainingLeases === 1`（fixture 仅存；现实现 = 2 → 红灯）。
- **P3（Scope 2 / AC1+AC2·SA5 RC2/E3）**：gen1 live + peer 侧 `saveGate` 悬挂在途 apply → hub 发 `CLOSE_NAMESPACE`（peer `onCloseRequest` 收口 IIFE 先 `drainPendingApplies` → 挂起）→ `closePeerSide` 断线 → backoff 重连 gen2 → session2+listener2 建成 `live` → 放行 saveGate → 旧代 IIFE 恢复：入口捕获**当前（gen2）**`session/lease/unsubscribe` → 无条件 `quiesceSync` 摘新 listener、全量 teardown、`setState('closed')`、把旧代 `CLOSE_OK` 落到新连接（hub 侧 `CLOSE_OK` 方向异常 → `NAMESPACE_STATE_VIOLATION` → channel failed）。断言：peer 状态保持 `live`、gen2 订阅仍在、hub gen2 通道仍 `live`、`writePeer({n:101})` 收敛到 hub（现实现四处皆反 → 红灯）。
- **C4（Scope 5 / AC4·SA5 RC5/E5）**：`removeTarget`（`closeTimeoutMs=60s`）+ 扣真实 `CLOSE_OK` → peer 停留 `closing` → 注入错配 `CLOSE_OK`（ackedSequence=999999）。断言（按库内 ACK 关联权威策略，对照 hub `onBootstrapAck` 错配 → `connectionFatal('ACK_STATE_VIOLATION', 1002)`）：`ACK_STATE_VIOLATION` ERROR 帧 + 连接 `blocked` + transport 关闭 + `removeTarget` 承诺有限结算（现实现：静默忽略 → 零 ERROR、滞留 ready、挂满 closeTimeout → 红灯）。
- **G5（Scope 6 / AC5·SA5 RC6/E6）**：live 期注入 `GOAWAY{SERVER_RESTARTING, drainTimeoutMs:5000}`。断言：收帧后（deadline 未到）订阅已摘除 + `writePeer({n:4242})` 零 UPDATE 出站（同步静默先于异步 drain；现实现：quiesceControllers 整体挂在 deadline 回调 → 订阅仍在、UPDATE 照发 → 红灯）；companion：deadline 到期 transport 关闭（双侧一致，非红灯锚）。

### 红灯验证结果

- 2026-08-30 实测（worktree 根：`pnpm install` 后 `pnpm exec vitest run packages/ws-replication/test/ws-replication-issue171-red.test.ts`）：
  - 结果：**4 tests | 4 failed**（`Test Files 1 failed`；Type Errors: no errors；duration ~766ms）。
  - H1 → `迟到的 hub open 续体必须释放其已取得 lease: expected [] to have a length of 1 but got +0`（`lease-released` 事件为零——`opened.lease` 泄漏）。
  - P3 → `旧代收口续体不得终结新代命名空间: expected 'closed' to be 'live'`（旧代 CLOSE 收口 IIFE 恢复后把 gen2 端到端杀死到 `closed`；随后订阅摘除/CLOSE_OK 落新连接/零收敛锚同批红）。
  - C4 → `错配 CLOSE_OK 必须产生 ACK_STATE_VIOLATION 显式错误帧: expected false to be true`（forged CLOSE_OK 被静默忽略，连接滞留 ready）。
  - G5 → `GOAWAY 收帧同步段必须已静默订阅: expected [Function] to be undefined`（GOAWAY 收帧后订阅仍在，静默被推迟到 deadline）。
  - 即：四锚全部以**预期的缺陷症状**红灯，无一构造性假红；绿灯面与 SA5「Fix direction 1/2/3/4」逐条对齐（续体中止+显式回收 lease 后 H1 锚 1/2 转绿；收口续体代际/所有权捕获后 P3 四锚转绿；错配按库内 ACK 权威策略发 fatal 后 C4 四锚转绿；GOAWAY 收帧同步静默后 G5 锚 1/2 转绿）。

## References
- Issue #161 review feedback; PR #130; PR #165
- `packages/ws-replication/src/hub-namespace.ts`
- `packages/ws-replication/src/peer-namespace.ts`
- `docs/protocols/instance-replication-v1.md` §§7, 13, 16, 18

## Fixed runtime identity
- Worktree: `/home/wangjian/nomicore-fix-issue-171`
- Branch: `fix/issue-171-on-docs-phase-5-websocket-replication`
- run_id: `issue-171-1788042048-447205`
- round: `1`
- Repository: `welltop-jim-wang/nomicore`
- Required baseline: `docs/phase-5-websocket-replication`

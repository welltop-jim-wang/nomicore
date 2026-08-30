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

## SA6 R2 契约更新（2026-08-30，SA3 实现 202558b 后；仅测试侧）

依据：`wiki/raw/task_issue-171_sa3_impl.md` §2.2 + `wiki/raw/task_issue-171_design.md` §13.1/§13.4。

### ① C4 注入时序竞态消除（issue171-red.test.ts C4）

冻结版 C4 的构造竞态（SA3 §2.2 实证，与生产无关的 fixture 时序）：`waitNamespace('closing')` 后**立即** `injectHub(CLOSE_OK{999999})` → 注入帧在 hub 真实 CLOSE_OK 发出**之前**到达 wire → 单向 `dropNextHubFrame('CLOSE_OK')` 谓词吞掉的是**注入帧** → hub 真实 CLOSE_OK（匹配序）随后正常收口 → 锚 1「错配帧必须被处理」不可达（时序性假红/假绿）。
修正（逐字采用 SA3 §2.2 文档化的同步点，零断言语义改动——锚 1–4 断言原文保持）：在 `waitNamespace('closing')` 之后、`injectHub` 之前插入

```ts
await settleUntil(
  () => hubChannelStateOf(run, run.nsId) === 'closed',
  'hub 通道 closed（CLOSE_OK 已发出并被 drop）',
);
```

即以 hub 通道投影 `closed`（hub closeQueue 链完成 = 真实 CLOSE_OK 已发出并被 drop 谓词拦截）为同步点；此后注入帧不再抢占 drop。与既有 AC3b「时序修正」同款。

### ② AC3b 期望翻转（sa6-hardening-g1-g2-red.test.ts，设计 §13.1 登记）

`closeSettled` 断言 `toBe(false)` → `toBe(true)`（伪造 CLOSE_OK 按库内 ACK 关联权威策略 `connectionFatal('ACK_STATE_VIOLATION',1002)` → violation 结算关闭承诺）；`ns !== 'closed'` 保持（violation 路径投影 `disconnected`）；追加 violation 显影锚：`peerFramesAll('ERROR')` 含 `ACK_STATE_VIOLATION`、`connectionState()==='blocked'`、`wire.peerSideClosed===true`。原始意图「无效 ACK 不得**成功**收口为 closed」不变（错配不再被静默完成，而是显式违例收口）。

### ③ §13.4 建议新锚的 SA6 决策

| 锚 | 决策 | 理由 |
|---|---|---|
| **C4b** | **已新增**（issue171-red.test.ts） | hub 发起 CLOSE（`closeSequence===undefined`）窗口的错配 CLOSE_OK → 同款 `ACK_STATE_VIOLATION` 显式收口（ERROR 帧 + blocked + transport 关 + violation 窗口 `not.toBe('closed')`——零静默完成）。锚定 §D4 R1#2（SA2 #2 CRITICAL「删除 undefined 例外」）——C4（removeTarget 路径）之外的第二入口，构造确定性（saveGate 悬挂 drain → closing 窗口稳定）；收尾放行后本代 CLOSE 续体正常收口 `closed`。 |
| P3b | **不新增** | 覆盖增量 =「fatal×stuck-disposal×rebuild」交叉；现有 P3（断线/CLOSE 续体跨代捕获）+ AC3b（fatal 路径）+ 设计 §4.2 幂等裁决已分别覆盖两侧路径；双 ns + 注入 UPDATE_ACK 违例构造复杂、风险/收益比不佳。 |
| L1 | **不新增** | watchdog/queuedBytes/inFlightCount 零残留面由 H1（observer lease 恰一次）、P3（无跨代损伤）+ sa7-issue137 D5（timer 计面四检查点）代偿；其余构造依赖深层内部投影（queuedBytes/inFlightCount），与「测试锚定可观察运行时行为」纪律边际。 |
| W1 | **不新增** | 需要「registry.open 返回 NAMESPACE_NOT_FOUND 的注入 seam」——registry 属 DENY LIST 且无该注入面；构造将迫使 mock 被测对象（registry），违反最小 Mock 原则。 |
| W2 | **不新增** | 断言「peer 最终经 openTimeout failed」= 裁决 (a) 固化的**非回归**面（设计 §13.3 明言「与现状一致，非回归」）；需推进 10s openTimeout，代价高、修复判别力低（既有 waitFor:'failed' 类锚已覆盖相邻面）。 |
| W3 | **不新增** | 断言「drain 窗口内 SYNC_APPLIED 照发」= 决策 (a) 固化，§D5.4 peer 侧零代码改动（既有 epoch 门）——属不变式而非修复面；G5 + sa7-hardening D6 已覆盖相邻面。 |

### ④ R2 实测证据（worktree 根）

- 更新后两文件：`pnpm exec vitest run packages/ws-replication/test/ws-replication-issue171-red.test.ts packages/ws-replication/test/ws-replication-sa6-hardening-g1-g2-red.test.ts` → **10 passed | 0 failed**（Type Errors: no errors）：issue171-red 5/5 绿（H1/P3/C4(修正时序)/C4b(新增)/G5）；g1-g2 5/5 绿（AC1/AC2a/AC2b/AC3a/AC3b(翻转)）。
- 全量回归：`pnpm exec vitest run packages/ws-replication` → **23 files | 160 tests | 0 failed**（Type Errors: no errors；SA3 §2.3 基线 157 passed | 2 failed → 更新后 2 项修复 + C4b 新增 = 160 全绿）。

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

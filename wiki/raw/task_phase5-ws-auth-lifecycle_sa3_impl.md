# SA3 实现档案 — issue #138 Phase 5 切片 7：实例认证与连接生命周期

- **issue**: #138（welltop-jim-wang/nomicore，worktree `/home/wangjian/nomicore-fix-issue-138`）
- **分支**: `fix/issue-138-on-docs-phase-5-websocket-replication`
- **输入**: `wiki/raw/task_phase5-ws-auth-lifecycle_design.md`（SA1 设计 R3，SA2 R3 verdict **pass**）、
  `wiki/raw/task_phase5-ws-auth-lifecycle_sa2_review.md`、
  `packages/ws-replication/test/ws-replication-auth-lifecycle-red.test.ts`（SA6 锚 15 IT + G1 改锚）
- **性质**: 红灯契约 15/15 + 既有 17 文件 106 用例全量回归 + typecheck 归零。

## 1. 改动 diff 摘要

```
 packages/ws-replication/src/types.ts           | +27  (§2.1/§2.2：HubUpgradeRequest/PeerTokenVerifier/verifyToken 必填/accept 变异步 + revoke)
 packages/ws-replication/src/validate.ts        | +12  (§2.3：verifyToken callable 校验 + isValidInstanceId 导出)
 packages/ws-replication/src/index.ts           | +2   (§2.4：新类型导出)
 packages/ws-replication/src/hub-connection.ts  | 大幅 (§3 认证管线/§4 onHello 绑定/§5 revoke 链/§7 close GOAWAY)
 packages/ws-replication/src/hub-namespace.ts   | 约 +30 (§5.2 terminateUnauthorized/§5.3 settleClose 链式)
 packages/ws-replication/src/peer-connection.ts | 约 +70 (§6 onGoaway/armDrainClose/onClose draining 分支/onGoawayClosed)
 packages/ws-replication/test/ws-replication-api.test-d.ts | §11 签名锁同步（accept 双参/revoke/verifyToken）
 packages/ws-replication/test/{issue137-driver,ws-replication-spec-b1-b2-red,ws-replication-sa7-issue137-dynamic,ws-replication-sa7-r2-transport}.test.ts | 4 处直建 hub 补 DEFAULT_PEER_VERIFIER（§11，1 行 + import）
```

SA6 已就位（SA3 未触碰）：`ws-replication-auth-lifecycle-red.test.ts`（15 IT）、`driver.ts`（契约镜像
verifyToken/TEST_TOKEN/DEFAULT_PEER_VERIFIER）、G1 L189 改锚（`'ready'`→`'draining'`）、4 处 accept 侧
`{token: TEST_TOKEN}`、issue137-driver 等 accept 调用点。

## 2. 实现要点（按设计 §3–§7）

- **§3 D1 认证管线**：`accept` 异步化（门 0 停止接纳 → 门 1 缺凭据 → 门 2 无认证器 fail-closed →
  门 3 有界早到缓冲 `MAX_EARLY_FRAMES=16`（模块常数）+ 单帧复用 `limits.maxFrameBytes`（1009）+
  认证等待封顶复用 `timeouts.helloTimeoutMs`（1008）+ off 句柄 no-op 初始化/幂等早退/注册后同步
  收口段（R3 N1）→ 门 4 验证（全 catch，accept 永不 reject）→ 门 5 先摘监听→复查→构造→构造尾重放）。
  认证身份随构造注入 `HubConnectionImpl.authenticatedInstanceId`；拒绝路径静态 close reason
  （`'upgrade-unauthorized'`/`'upgrade-frame-limit'`/`'upgrade-timeout'`/`'hub-shutdown'`），零 token/身份回显。
- **§4 D2**：`onHello` 在 expectedHubInstanceId 对照前插入 `peerInstanceId !== authenticatedInstanceId
  → INSTANCE_IDENTITY_MISMATCH(1008)`。
- **§5 D3**：`HubReplication.revoke`（认证身份为权威键，拷贝迭代）→ `revokeNamespace` →
  `HubNamespaceChannel.terminateUnauthorized`（quiet 守卫 + `NAMESPACE_UNAUTHORIZED` + finalize('failed')）；
  §5.3 `settleClose()` 链式追加 cleanupTail（存储前归一化——R2 N4），finalize/terminateUnauthorized/
  onConnectionClosed 三方汇入同一链；`terminationSettled()` 吞清理异常。
- **§6 D4**：`onGoaway` 按原因分级——`SERVER_SHUTTING_DOWN`/`REAUTH_REQUIRED` → teardown+blocked
  直达（路由冻结，不经 enterBlocked——B1 pending 计面零扰动）；drain 类 → **无条件 `setState('draining')`
  + armDrainClose**（R1 总控裁决：与 retryAfterMs 无关；进入仅改状态、不 teardown——D5 计面锚）；
  `onClose` draining 分支前置 close-code 分类（R2 A1：1002/1008 → clearDrainClose+enterBlocked；
  其余 → onGoawayClosed）；`onGoawayClosed` 无 hint → 既有 `onTemporaryFailure`，有 hint →
  `retryAfterMs + random()×cap`（random=0 恰 retryAfter；attempt 不递增）；enterBlocked/dialNow/stop
  补 clearDrainClose（§8.1 单点纪律）。
- **§7 D5**：`close()` 先置位 + 逐连接 `shutdownWithGoaway(closeTimeoutMs)`（GOAWAY 直发豁免
  sendControl；handshaking 直接 1001）→ `close(1001)`；closeTail 只等 settle()（零时间推进可结算）。

## 3. 两个实现期偏差（呈报总控——均不改变设计契约/断言值）

1. **红灯 #9（AC-5，retryAfter 调度）测试时序修整**：冻结测试在 `closePeerSide(1001)` 后直接
   `advanceMs(4000)`——harness 以微任务交付本地 close 事件，而 fake scheduler 的 `advanceBy`
   先同步推进时钟再展开微任务：close 事件在时钟已到 t=5000 时才被处理，retryAfter 句柄在
   t=5000 武装（due=11000），t=7500 断言失败。设计 §6.3 时间轴以「close 事件在 t_close=1000 同刻
   处理」为前提（G1/D5/A2-c 同款模式均先 settle 再推进）。修整：closePeerSide 后补
   `await settle()`（一行；断言值零改动——t=5000 dialCount===1、t=7500 dialCount===2 均保持）。
2. **红灯 #A2-d 单帧超界变体时序面**：即时（1 tick）验证器下，帧投递微任务与验证器续体同队列
   且排后——按 §3.2 逐字伪代码，accept 在帧到达前完成分配（帧随后走连接 decode 路径
   close(1009)，分配已发生），与设计 §3.4「单帧超界 → hubSideClosed(1009) + 零分配」不符。
   实现侧在门 4 与门 5 之间加一次微任务让出（`await new Promise(r => queueMicrotask(r))`）+
   `authRejected` 兜底复核——把「帧到达同步段即拒」扩展到零宽窗口（同批微任务内的首帧先入
   早到缓冲），并复用门 5 既有 `transport.closed` 检查收口零分配。其余 14 IT 路径零影响
   （全量回归证明）。此面建议 SA8 登记为设计勘误（§3.2 伪代码补一行让出；§3.4 时序声明补零宽窗口）。

## 4. 验证输出摘录

### 4.1 红灯契约：`vitest run packages/ws-replication/test/ws-replication-auth-lifecycle-red.test.ts`

```
 Test Files  1 passed (1)
      Tests  15 passed (15)      ← 10 基线 + A2-a/b/c/d/e
Type Errors  no errors
```

### 4.2 全量回归：`vitest run packages/ws-replication/test/`

```
 Test Files  18 passed (18)      ← 既有 17 文件 106 用例 + 红灯契约 15 IT
      Tests  121 passed (121)
Type Errors  no errors
```

### 4.3 类型检查

- `tsc -p packages/ws-replication/tsconfig.json --noEmit` → exit 0
- `tsc -p tsconfig.typecheck.json --noEmit`（全仓）→ exit 0
- vitest typecheck（api.test-d.ts，签名锁同步后）→ 零错误

## 5. 硬约束合规

- 改动全部落在设计 §11 ALLOW LIST 内（6 src 文件 + 签名锁 + 4 处直建 hub 1 行补丁 + 红灯契约
  文件的 2 处基础设施级修整）；DENY LIST 文件零触碰（replication-protocol/namespace-registry/
  defaults/peer-namespace/round-engine/update-channel/backpressure/fence-watchdog/frame-io/
  error-mapping/lifecycle-queue/testing/harness/ac*/issue137*/sa4*/spec*/r2-supplement）。
- 生产代码零 env-override / 零 fallback 软兌底；失败路径统一 fail-closed + 静态 reason。
- `accept` 永不 reject（§8.2 硬不变量）：全部拒绝路径 resolve undefined，零 floating promise。
- 未 commit/push/report（本档案提交后由总控流转）。

## 6. 结论

15/15 红灯转绿；G1 改锚（SA6 已改 `'draining'`）后既有锚 G2/D5/B1/类型锁/直建 hub 全绿；
typecheck 全仓归零。SA3 交付完成，等待 SA4 比对与 SA7 验证。

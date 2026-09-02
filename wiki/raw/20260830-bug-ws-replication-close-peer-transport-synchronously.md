# [Bug] ws-replication: peer 侧 hello 超时未同步关闭旧 transport（孤儿传输竞速窗口，issue #168 / PR #165 round 2 D5）

**Status**: analyzed | **Date**: 2026-08-30
**Severity**: low（窗口有界——hub 侧同值 HELLO_TIMEOUT 兜底收口；但违反 wire contract §18 显式条款）
**Type**: new-feature-defect（Phase 5 交付中经 SA7 round 2 D5 显式 scoped-out 的已知缺陷，跟踪票即本 issue；非回归）
**Layer**: backend（packages/ws-replication）

## Symptoms

Peer 侧 HELLO 握手超时后，peer 仅进入 backoff 并排程重拨，**不关闭旧 peer transport**。旧 transport 的 peer 半边在「peer hello 超时（立即）→ hub 侧 HELLO_TIMEOUT（默认同值 10s）兜底关闭 hub 半边」的窗口内保持开放——即孤儿传输（orphan transport）：

- peer 半边：socket 开着，但监听已被 `onTemporaryFailure` 退订（`unsubscribeTransport`），既不读也不写；
- hub 半边：仍在等 HELLO，直到自己的 `helloTimeoutMs` 到点才 `connectionFatal('HELLO_TIMEOUT', 1002)` 收口；
- 期间重拨已产生 wire2 新连接，wire1 两端无人认领。

影响范围：仅 ws-replication peer 连接建立期（handshaking 态）HELLO_ACK 迟到/丢失场景；后果是短暂的半开 socket 滞留与 hub 连接表多占，无数据正确性影响（旧代 epoch 已作废、监听已退订）。

## Reproduction

D5 锚测试（当前断言的是缺陷现状——"登记观察"）：
`packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts:758`

```ts
// peer helloTimeoutMs: 100（探针调快以确定性展开窗口）；首代 wire 扣掉 peer→hub HELLO 帧
timeouts: { helloTimeoutMs: 100 },
...
await peerNode.scheduler.advanceBy(100);
await settleUntil(() => peer.getConnectionState() === 'backoff', 'hello 超时 → backoff');
const wire1 = wires[0]!;
expect(wire1.peerSideClosed, '登记观察：hello 超时不关 peer 侧传输（孤儿窗口在场）').toBe(false);  // ← 缺陷现状
...
await hubNode.scheduler.advanceBy(10_000);
expect(wire1.hubEnd.closed, 'hub 侧 HELLO_TIMEOUT 兜底关闭其半边').toBe(true);   // ← hub 兜底收口
expect(wire1.peerSideClosed, 'peer 侧仍未自关（孤儿面——登记项非缺陷）').toBe(false);
```

验证命令与结果（本 worktree，基准 `ffca4f6`）：

```
$ npx vitest run packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts -t "D5"
 Test Files  1 passed (1)
      Tests  1 passed | 5 skipped (6)
```

测试通过 = 缺陷行为在场且可复现（`peerSideClosed === false` 是被显式断言的现状）。

## Investigation

阅读（Step 1+2 共 6 个文件，限内）：

1. 任务简报 + SA8 前置门禁决策文档 `wiki/raw/task_ws-replication-close-peer-transport-synchronously*.md`（4 份）——确认 frozen behavior 面（dial-throw / onClose）与 wire contract 引用；
2. `packages/ws-replication/src/peer-connection.ts`——`dialNow`(:276-338)、pong-timeout detach-close 序列(:421-432)、`onTemporaryFailure`(:845-872)、`armHello`(:908-914)、helper 定义(:601-609)；
3. `packages/ws-replication/src/hub-connection.ts`(:372-376)——hub 侧 HELLO_TIMEOUT 兜底；
4. `packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts`(:755-816)——D5 登记观察测试；
5. `docs/protocols/instance-replication-v1.md` §18(:526)——「HELLO/pong timeout关闭连接」权威条款；
6. git 历史归属（见 Root Cause）。

数据流/时序追踪（无需诊断日志——路径单一、静态证据闭环）：

```
peer.start() → dialNow() :276
  ├─ epoch+1 → setState('connecting')
  ├─ dial() 成功 → this.transport = wire1.peerEnd :295
  ├─ 发 HELLO :323 → setState('handshaking') :332 → armHello() :333
  │     helloHandle = setTimeout(() => {
  │       if (state==='handshaking') this.onTemporaryFailure('hello-timeout');   // ← 断点：只进 backoff，不关 transport
  │     }, helloTimeoutMs)
  └─ 订阅 transport onMessage/onClose（epoch 门）:334-337

helloTimeoutMs 到点 → onTemporaryFailure('hello-timeout') :845
  ├─ stopLivenessNow / unsubscribeTransport / epoch+1 / sender.teardown   ✅ 代际收口
  ├─ setState('backoff') → backoff timer → dialNow()（wire2）
  └─ ❌ 不 close(this.transport)——注释 :849-851 明示「不关传输(I5)：……hello 超时孤儿
       传输窗口是 D5 登记处置项，本任务不动」

对照（pong-timeout 路径 :421-432——任务简报所指 established detach-close 序列）：
  onPongTimeout: () => {
    if (this.stopping) return;
    if (this.transport !== transport || this.connectionEpochValue !== epoch) return;  // 双凭据
    this.stopLivenessNow();
    this.unsubscribeTransport();
    this.connectionEpochValue += 1;                          // epoch 先于可重入 close() 失效（§18 R4）
    if (!transport.closed) transport.close(1001, 'pong-timeout');
    this.onTemporaryFailure('pong-timeout', true);
  }
```

hub 半边（wire1.hubEnd）：`hub-connection.ts:372-376` 自起 `helloTimeoutMs` timer → 到点 `connectionFatal('HELLO_TIMEOUT', 1002)` 关闭——这是孤儿窗口的有界兜底面。

## Root Cause

**`packages/ws-replication/src/peer-connection.ts:908-914`（`armHello`）**——hello 超时回调只调用 `this.onTemporaryFailure('hello-timeout')`，而 `onTemporaryFailure`（:845）按设计不关传输（关闭是"路径特定的"）：pong-timeout 在自己的回调里自关（:430）、远端关闭路径传输已死、**hello-timeout 路径没有对应的自关代码**——旧 transport 无人关闭，成为孤儿。

这违反 wire contract `docs/protocols/instance-replication-v1.md` §18 :526：「HELLO/pong timeout关闭连接」。pong 超时已按 §18 R4 detach-close 序列对齐；hello 超时未对齐。

历史归属（git log -S）：
- 登记测试引入：`ef19bae`（PR #165 round 2，SA7 D5 scoped-out 决议——测试断言即"登记观察，非缺陷断言"）；
- 「不关传输」注释固化：`ffca4f6`（PR #185，epoch-safe pong/ping 重构保持该行为并写明「本任务不动」）；
- 结论：非回归，是显式推迟的已知缺陷；issue #168 即其跟踪票，现按任务要求收口。

**冻结面（任务简报明示保留，修复不得触碰）**：
- dial-throw（:289-294）：`dial()` 抛错 → `onTemporaryFailure('dial-failed')`——无新 transport 可关；
- onClose（:713-737）：远端关闭路径，传输已死 → `onTemporaryFailure('socket-closed')`。

**Fix direction**（供 SA1 设计参考，不展开实现）：
在 hello 超时入口（`armHello` 回调，或与 pong-timeout 共用的 guarded detach-close helper）于进入 backoff 前同步执行 §18 R4 同款收口栈：停 liveness → 退订 transport → **epoch 先失效** → `if (!transport.closed) transport.close(1001, 'hello-timeout')` → `onTemporaryFailure('hello-timeout', true)`（epochAlreadyInvalidated=true 防重复递增）。要点：(a) 次序纪律——epoch 必须先于可能同步重入的 `close()`（`onClose` 订阅有 epoch 门，退订 + epoch 失效后本地 close 零重入副作用）；(b) close code 参照 pong-timeout 用 1001（peer 本地超时是内部路径，无 wire ERROR 帧——协议 §13.1 注册表只管 hub 侧），如 SA1 另有裁决以设计文档为准；(c) `connStateValue === 'handshaking'` 状态守卫保留（迟到 timer 零副作用），`!transport.closed` 守卫保证幂等（迟到的并发 dial 步骤不重复关）；(d) 状态机迁移（handshaking → backoff）与观测面（backoff reason `hello-timeout` 已在词表）零变化；(e) D5 锚测试需从"登记观察"翻转为缺陷修复断言（`peerSideClosed === true`），恢复链路断言（重拨 ready/live、hub 兜底）保留。

## Evidence

1. **缺陷代码**（peer-connection.ts:908-914）：
   ```ts
   private armHello(): void {
     this.clearHello();
     this.helloHandle = this.options.timer.setTimeout(() => {
       this.helloHandle = undefined;
       if (this.connStateValue === 'handshaking') this.onTemporaryFailure('hello-timeout');
     }, this.timeouts.helloTimeoutMs);
   }
   ```
2. **scoped-out 注释**（peer-connection.ts:848-851，`onTemporaryFailure` 头部）：
   ```
   // 同步代际收口（issue #170 验收 2 / I4）：停旧 liveness、退订旧 transport 全部监听、
   // 作废连接代际——先于一切 backoff 排程。不关传输（I5）：关闭是路径特定的——
   // pong 超时路径在可重入 close 前已作废 epoch，故传 true 防止重复递增；远端关闭路径
   // 传输已死；hello 超时孤儿传输窗口是 D5 登记处置项，本任务不动。
   ```
3. **wire contract 条款**（docs/protocols/instance-replication-v1.md:526）：「HELLO/pong timeout关闭连接。Open/bootstrap/reconcile/close/ACK timeout只收口 namespace；……」
4. **hub 侧兜底**（hub-connection.ts:372-376）：
   ```ts
   this.helloHandle = hub.timer.setTimeout(() => {
     if (this.state === 'handshaking') {
       this.connectionFatal('HELLO_TIMEOUT', 1002);
     }
   }, hub.timeouts.helloTimeoutMs);
   ```
5. **git 历史**：
   ```
   $ git log --oneline -S "D5：hello 超时不关 peer 侧传输" -- packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts
   ef19bae Follow-up: harden WebSocket replication protocol after PR #160 (#165)
   $ git log --oneline -S "hello 超时孤儿传输窗口是 D5 登记处置项" -- packages/ws-replication/src/peer-connection.ts
   ffca4f6 Phase 5 follow-up: make ping/pong timeout handling epoch-safe and protocol-correct (#185)
   ```
6. **测试运行**（复现确认）：
   ```
   $ npx vitest run packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts -t "D5"
   ✓ packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts (6 tests | 5 skipped) 24ms
   Tests  1 passed | 5 skipped (6)
   ```
7. **工作区清洁**：`git status --short` 仅含 wiki/raw 任务简报类 untracked 文件；`git diff` 为空（未添加任何诊断日志，无需还原）。

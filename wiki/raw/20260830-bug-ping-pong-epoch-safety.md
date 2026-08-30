# [Bug] ws-replication ping/pong 超时处理：hub 协议违约（未注册 PONG_TIMEOUT + 1002 误用 → peer 永久 blocked）+ pong 无 ping 关联 + peer 侧 teardown 顺序/代际不安全

**Status**: analyzed | **Date**: 2026-08-30
**Severity**: high
**Type**: new-feature-defect (broke at: `ef19bae` — PR #165 引入的 ping/pong seam，从未正确工作)
**Layer**: backend（`packages/ws-replication`）
**Task**: issue #170（Phase 5 ping/pong timeout epoch safety）

## Symptoms

1. **hub 侧 pong 超时把「临时失联」错误升级为「协议错误」**：hub 以 close code **1002** 关闭连接（`reason='protocol-error'`），并试图发送错误码为 `PONG_TIMEOUT` 的 connection ERROR 帧。
2. **下游灾难性放大**：peer 收到 close 1002 → `enterBlocked()` → 连接进入 **blocked 终态，永不 backoff 重拨**。一次纯活性超时（网络抖动）导致 peer 永久失联，需外部干预（stop/start 或 re-add target）才能恢复。
3. **hub 的 best-effort ERROR 帧从未上线**：收口前最后帧仍是 `HELLO_ACK`（协议 §14「framing 仍可信时关闭前 best-effort 发送 connection ERROR」义务静默失效）。
4. **pong 与 ping 无关联**：迟到/重复/未请求的 pong 会清掉**下一次** ping 的超时定时器——死对端被误判存活。
5. **peer 侧 pong 超时收口顺序违约**：backoff 排程后、重拨前（backoff 窗口内），旧 liveness 循环继续对**已关闭**的旧 transport 周期发 ping；旧 transport 的 pong 监听仍订阅；生产 `ws` adapter 语义下 `ping()` 对 closed socket 抛错 → **timer 回调内未捕获异常**。
6. **blocked 态永久泄漏**：任何 1002/1008 收口路径（`enterBlocked`）完全不停 liveness、不退订 transport——blocked 期间旧 liveness 周期性 ping 死对端/已关 socket，直到它自己的 pong 超时再以 1001 关一次 peer 侧 socket（FSM 仍停留 blocked）。

## Reproduction

复现环境：worktree `/home/wangjian/nomicore-fix-issue-170`，`pnpm exec vitest run`（依赖 `pnpm install` 后可用）。复现测试为临时文件 `packages/ws-replication/test/sa5-issue170-repro.test.ts`（SA5 纪律：取证后已删除，本节给出完整可重建步骤）。

**fixture**（同 `ws-replication-sa7-round2-dynamic.test.ts` 的 LivenessLogWire 模式）：

- `VirtualTimer`：手写虚拟时钟，实现 `ReplicationTimer`（`setTimeout/clearTimeout`），`advance(ms)` 按到期序执行回调，`pending()` 返回存活 timer 数。
- pong wire：内存双端 transport，两端各暴露 `ping()`（计数；可选 `autoPong`——ping 后微任务自动回 pong 模拟对端应答；可选 `throwPingWhenClosed`——closed 时抛 `Error('WebSocket is not open: readyState 3 (CLOSED)')`，即真实 `ws` 库语义）与 `onPong()`（可查订阅数、可手动注入 pong）。帧/close 经 `queueMicrotask` 投递对端，双向帧与双端 closeLog 全记录。
- `makePair(timer, opts)`：真 `createHubReplication`（instanceId `hub-omega`，stub registry，timeouts `{pingIntervalMs:30_000, pongTimeoutMs:10_000, helloTimeoutMs:10_000}`）+ 真 `createPeerReplication`（instanceId `peer-alpha`，`dial()` 内 `hub.accept(hubEnd, {peerInstanceId:'peer-alpha'})`，`random:()=>0.5`，backoff 可调）。`peer.start()` + 微任务 flush 后握手完成（`getConnectionState()==='ready'`，双向帧 `HELLO`/`HELLO_ACK`）。

**R1 — hub pong 超时协议违约（peerAutoPong=true, hubAutoPong=false, backoff base/max=100_000）**

| 步骤 | 操作 | 观测（当前行为） |
|---|---|---|
| 1 | `advance(30_000)` + flush | `hubEnd.pings()===1`（hub 发第 1 个 WS ping，无人复） |
| 2 | `advance(10_000)` + flush | hub pong 超时触发 `connectionFatal('PONG_TIMEOUT', 1002)` |
| 3 | 断言 `encodeMessage(connectionErrorFrame('PONG_TIMEOUT'))` | **throws `/unknown error code/`**（codec 拒绝未注册码） |
| 4 | 检查 `hubToPeer` 最后帧 | **`HELLO_ACK`**（ERROR 帧未上线——发送在 `connectionFatal` 的 try/catch 中被吞） |
| 5 | 检查 `hubEnd.closeLog()` | **`{code:1002, reason:'protocol-error'}`**（协议要求 1001） |
| 6 | flush（close 投递到 peer） | `peer.getConnectionState()==='blocked'`（`onClose` code 1002 → `enterBlocked`） |
| 7 | `advance(300_000)` + flush | `dialCount()===1` —— **blocked 永不重拨，peer 永久卡死** |

**R2 — 迟到/重复 pong 清掉下一次 ping 的超时（`startLiveness` 单元，pingInterval=30s, pongTimeout=10s）**

| 时刻 | 操作 | 观测 |
|---|---|---|
| t=30s | `advance(30_000)` | `pings===1`（ping1，超时应于 t=40 触发） |
| t=30s+ε | `emitPong()` | ping1 的合法 pong，清掉 t=40 超时 ✓ |
| t=60s | `advance(30_000)` | `pings===2`（ping2，超时应于 t=70 触发） |
| t=60s+ε | `emitPong()`（**属 ping1 的迟到重复 pong**） | **清掉了 ping2 的超时** ✗ |
| t=70s | `advance(10_000)` | **`timeouts===0`** —— ping2 从未被应答，超时被吞（BUG） |
| t=100s | `advance(30_000)`（ping3）+ `advance(10_000)`（无任何 pong） | `timeouts===1` —— 对照：无杂散 pong 时机制本身工作 |

同机制下，周期性注入未请求 pong 可让从不应答 ping 的死对端被无限期判为存活。

**R3 — peer pong 超时 teardown 顺序违约（peerAutoPong=false, hubAutoPong=true, throwPingWhenClosed=true, backoff base/max=100_000 → delay 50s，观察窗 [40s, 90s)）**

| 时刻 | 操作 | 观测 |
|---|---|---|
| t=30s | `advance(30_000)` + flush | `peerEnd.pings()===1` |
| t=40s | `advance(10_000)` + flush | pong 超时：`peerEnd.closeLog()===[{code:1001, reason:'pong-timeout'}]` ✓（peer 侧关闭码正确）；`peer.getConnectionState()==='backoff'` |
| t=40s | 立即检查 | **`peerEnd.pongListeners()===1`**（旧 pong 监听仍订阅——应同步退订）；`timer.pending()>0`（liveness ping timer 未清）；`peerEnd.transport.closed===true` |
| t=70s | `advance(30_000)`（backoff 于 t=90 才重拨） | **`peerEnd.pingsAfterClose()===1`**（旧 liveness 对已关 transport 发 ping）且抛出 `Error: WebSocket is not open: readyState 3 (CLOSED)` **从 timer 回调中传播出来**（生产 `ws` adapter = 进程级未捕获异常） |

**R4 — `enterBlocked` 路径同样漏停 liveness（peerAutoPong=false, hubAutoPong=true, throwPingWhenClosed=false）**

| 时刻 | 操作 | 观测 |
|---|---|---|
| t=0 | 握手后 `hubEnd.transport.close(1002,'protocol-error')` + flush | `peer.getConnectionState()==='blocked'`；`peerEnd.transport.closed===false`（peer 侧 socket 未关） |
| t=30s | `advance(30_000)` | `peerEnd.pings()===1`（向已死对端发 ping1） |
| t=40s | `advance(10_000)` | peer 自身 pong 超时 → `peerEnd.closeLog()===[{code:1001,reason:'pong-timeout'}]`（**blocked 态的 liveness 仍在运行并自行收口**）；FSM 仍 `blocked`（`onTemporaryFailure` 被状态守卫吞掉） |
| t=60s / t=90s | `advance(20_000)` / `advance(30_000)` | `peerEnd.pingsAfterClose()` 1 → 2（**周期性重复 ping 已关闭 transport**）；`peerEnd.pongListeners()===1` |
| t=390s | `advance(300_000)` | `dialCount()===1`（blocked 永不重拨） |

**运行结果**（复现文件存在时）：`pnpm exec vitest run packages/ws-replication/test/sa5-issue170-repro.test.ts` → `Test Files 1 passed (1), Tests 4 passed (4)`——全部断言钉住的都是**当前缺陷行为**（断言消息以 `BUG：` 前缀标注）。

## Investigation

1. **任务简报**：`wiki/raw/task_issue-170-ping-pong-epoch-safety.md` —— PR #165 已并入 #130，ping/pong seam 存在，但超时处理、旧连接解绑、pong 关联存在跨代际风险。
2. **代码考古**（按调用链）：
   - `src/liveness.ts`（全文 54 行）：`startLiveness` 循环。静态读出三个疑点：① `onPong` 监听清「当前任意」`pongHandle`，无 ping↔pong 关联；② `onPongTimeout` 触发后循环不停止（`pingHandle` 已预排，`stopped` 仍 false）；③ pong 超时回调由调用方闭包承担一切收口。
   - `src/hub-connection.ts:254-263`：HELLO 完成处武装 liveness，`onPongTimeout: () => this.connectionFatal('PONG_TIMEOUT', 1002)`。对照协议文档 `docs/protocols/instance-replication-v1.md`：L524「pong 超时按临时失败处理：关闭传输（close code 1001）并经 backoff 重连」、L387-388（1001=GOAWAY/停机类临时关闭；1002=framing/sequence/message/ACK 协议错误）、L336-352 错误码注册表（**无 `PONG_TIMEOUT`**）。`grep -rn PONG_TIMEOUT packages/ docs/` 全仓唯一命中即缺陷行本身。
   - `src/peer-connection.ts`：`dialNow`（:186-243）在换 transport 前有 `stopLivenessNow + unsubscribeTransport + epoch+1` 纪律；但 `onHelloAck`（:300-313）的 pong-timeout 闭包只 `close(1001)+onTemporaryFailure`，**不**做同步收口，也不校验 epoch；`onTemporaryFailure`（:615-633）与 `enterBlocked`（:595-613）都**不**停 liveness/退订 transport；`onClose`（:529-540）对 1002/1008 → `enterBlocked`。
   - `src/frame-io.ts:34-42` + `packages/replication-protocol/src/payloads.ts:310-315`：`connectionErrorFrame('PONG_TIMEOUT')` 构帧成功，但 `encodeMessage` 内 `encodeError` 对未注册码 `throwMalformed('unknown error code for connection scope: PONG_TIMEOUT')`。
   - `src/types.ts:52-64`：transport seam `ping?(data?: Uint8Array)` / `onPong?(listener: () => void)` —— **onPong 不透传 pong 载荷**（WS pong 会回显 ping payload，是唯一关联凭据）→ 当前 seam 下 pong 关联在结构上不可实现。
3. **数据流追踪**：hub liveness 超时 → `connectionFatal('PONG_TIMEOUT',1002)` → ERROR 帧编码抛错被 `try/catch`（hub-connection.ts:400-407）吞 → transport.close(1002) → 对端 onClose(1002) → peer `enterBlocked`（peer-connection.ts:535-537）→ 无重拨。peer liveness 超时 → close(1001)（正确）→ `onTemporaryFailure` 排程 backoff → 窗口内旧 liveness 继续循环（ping 定时器在超时前已预排，liveness.ts:38）→ 对 closed transport ping。
4. **动态验证**：上述 R1–R4 四个确定性实验（虚拟时钟 + 可控 pong wire），全部按预期复现。
5. **回归判定**：`git log -S PONG_TIMEOUT` 与 `--diff-filter=A liveness.ts` 均指向 `ef19bae`（PR #165）——seam 首次引入即带缺陷，属 new-feature-defect 而非回归。

## Root Cause

四个相互独立但同源（PR #165 seam 收口不完整）的缺陷：

1. **`packages/ws-replication/src/hub-connection.ts:261`** — `onPongTimeout: () => this.connectionFatal('PONG_TIMEOUT', 1002)`：
   - 错误码 `PONG_TIMEOUT` 未在协议 §10 注册表登记（docs/protocols/instance-replication-v1.md L336-352），`encodeError`（replication-protocol/src/payloads.ts:310-315）抛 `unknown error code`，被 `connectionFatal` 的 best-effort try/catch（hub-connection.ts:400-407）吞掉 → ERROR 帧不上线；
   - close code 用 1002，违反 §18 L524（pong 超时=临时失败，应 1001）与 §14 L387 的 close code 分类；
   - 放大链：peer `onClose` 见 1002 → `enterBlocked`（peer-connection.ts:535-537）→ 永不 backoff 重拨。
2. **`packages/ws-replication/src/liveness.ts:25-30`** — pong 监听无条件清除当前 pending 的 `pongHandle`，ping↔pong 零关联：迟到/重复/未请求的 pong 清掉**下一次** ping 的超时（死对端误判存活）。seam 级根因：`types.ts:63` `onPong?(listener: () => void)` 丢弃 pong 载荷（WS pong 回显的 ping payload 是唯一关联凭据），不改 seam 则关联无法实现。
3. **`packages/ws-replication/src/peer-connection.ts:308-311`** — pong-timeout 闭包只 `close(1001)` + `onTemporaryFailure()`（排程 backoff），**未同步**执行：停旧 liveness、退订旧 transport 的 message/close/pong 监听、作废旧连接 epoch。`liveness.ts:31-39` 的循环在 `onPongTimeout` 后继续运转（ping timer 已预排且不随超时清除）→ backoff 窗口内旧 liveness 对已关闭 transport 周期 ping（真实 `ws` adapter 下为 timer 回调内未捕获异常）。闭包捕获了 `transport` 身份但从不校验 `connectionEpochValue`（issue 明确要求的防御缺失；当前正常路径靠 `dialNow` 的先停后换纪律兜底，属时序窗口漏洞而非结构性跨代污染）。
4. **`packages/ws-replication/src/peer-connection.ts:595-613`** — `enterBlocked` 完全遗漏 `stopLivenessNow()` 与 `unsubscribeTransport()`：任何 1002/1008 收口后，旧 liveness 在 blocked 终态无限期运行（周期 ping 死对端/已关 socket；其自身 pong 超时还会再以 1001 关一次 peer 侧 socket，而 FSM 仍停留 blocked——`onTemporaryFailure` 被 :617 状态守卫吞掉）。

**边界澄清**：hub 侧不存在跨代际问题（每 `HubConnectionImpl` 独占 transport，`cleanupAll` 同步调 `stopLiveness`，hub-connection.ts:386-395）；hub 侧缺陷纯属协议语义（缺陷 1）。peer 侧 `dialNow`（:186-243）已具备「停旧→退订→epoch+1→换新」纪律，跨代泄漏被限制在 backoff 窗口（缺陷 3）与 blocked 终态（缺陷 4，永久）。

**Fix direction**（供 SA1 设计参考，不展开实现）：
hub pong 超时改走协议权威语义——临时失败：close(1001)、不发明未注册错误码（也不经 connectionFatal 的 ERROR 帧义务路径），随后按 hub 侧既有连接收口清理；peer 侧把 pong 超时回调改为同步收口栈（停旧 liveness → 退订旧 transport 全部监听 → 关旧 transport → 作废/推进 epoch 校验）后排程 backoff，并在回调内校验 transport 身份 + epoch 双凭据；liveness 增加 ping↔pong 关联（以 ping 载荷为凭据，需要把 `onPong` seam 扩为透传 pong 载荷或等价关联面），迟到/重复/未请求 pong 一律不得清除下一次 ping 的超时；`enterBlocked` 与 `onTemporaryFailure` 补齐 liveness/transport 订阅的同步拆除。

## Evidence

1. **复现测试运行输出**（临时文件 `packages/ws-replication/test/sa5-issue170-repro.test.ts`，取证后已删除；断言消息即缺陷编号）：

   ```
   $ pnpm exec vitest run packages/ws-replication/test/sa5-issue170-repro.test.ts
    ✓ packages/ws-replication/test/sa5-issue170-repro.test.ts (4 tests) 31ms
   Test Files  1 passed (1)
        Tests  4 passed (4)
   ```

   （开发过程中的中间观测：hub pong 超时后 `hubClose=[{"code":1002,"reason":"protocol-error"}] peerState=blocked`、`frames=HELLO_ACK` —— ERROR 帧缺失的直接痕迹。）

2. **codec 拒绝未注册码**（R1 内联断言）：`encodeMessage(connectionErrorFrame('PONG_TIMEOUT'))` → `unknown error code for connection scope: PONG_TIMEOUT`（payloads.ts:314）。

3. **协议文档**（docs/protocols/instance-replication-v1.md）：
   - L42：活性检测只使用 WebSocket ping/pong，协议不定义业务 PING/PONG frame（现状符合——无应用级 PING/PONG 帧，修复须保持）；
   - L336-352 错误码注册表：含 `HELLO_TIMEOUT`/`CONNECTION_BACKPRESSURE` 等，**无 `PONG_TIMEOUT`**；
   - L387-388：1001=GOAWAY/计划重启/服务停止；1002=bad framing、sequence、message、ACK 等协议错误；
   - L524：工程缺省 `pingIntervalMs=30_000`、`pongTimeoutMs=10_000`；**「pong 超时按临时失败处理：关闭传输（close code 1001）并经 backoff 重连」**。

4. **全仓唯一命中**：`grep -rn "PONG_TIMEOUT" packages/ docs/ | grep -v node_modules` → 仅 `packages/ws-replication/src/hub-connection.ts:261: onPongTimeout: () => this.connectionFatal('PONG_TIMEOUT', 1002),`。

5. **git 考古**：
   ```
   $ git log --oneline -1 -S "PONG_TIMEOUT" -- packages/ws-replication/src/hub-connection.ts
   ef19bae Follow-up: harden WebSocket replication protocol after PR #160 (#165)
   $ git log --oneline -1 --diff-filter=A -- packages/ws-replication/src/liveness.ts
   ef19bae Follow-up: harden WebSocket replication protocol after PR #160 (#165)
   ```

6. **关键代码**：
   - liveness.ts:25-30（无关联 pong 清除）：
     ```ts
     const offPong = deps.onPong(() => {
       if (pongHandle !== undefined) {
         deps.timer.clearTimeout(pongHandle);
         pongHandle = undefined;
       }
     });
     ```
   - liveness.ts:31-39（超时后循环继续：ping timer 在 :38 预排，`onPongTimeout` 不置 `stopped`）。
   - peer-connection.ts:308-311（peer pong 超时闭包：无 stopLivenessNow/unsubscribeTransport/epoch 校验）：
     ```ts
     onPongTimeout: () => {
       if (!transport.closed) transport.close(1001, 'pong-timeout');
       this.onTemporaryFailure();
     },
     ```
   - peer-connection.ts:595-613（enterBlocked：仅 sender.teardown/clearHello/clearReset/clearBackoff/outbound.clear——无 stopLivenessNow、无 unsubscribeTransport）。
   - peer-connection.ts:535-537（`if (code === 1002 || code === 1008) { this.enterBlocked(); return; }`——hub 1002 误用把 peer 打入终态的接合点）。

7. **现场清理确认**：复现文件删除后 `git status --short` 仅剩派发前已存在的两个任务简报（`task_issue-170-ping-pong-epoch-safety.md` / `_dispatch.md`，均非 SA5 产物）；`git diff --stat` 为空。

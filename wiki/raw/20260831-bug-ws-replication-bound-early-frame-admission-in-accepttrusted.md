# [Bug] acceptTrusted 早到帧无界接纳——缺失 accept() 的有界 admission 门

**Status**: analyzed | **Date**: 2026-08-31
**Severity**: high
**Type**: new-feature-defect (broke at: `b66615c`——PR #130 随功能首发，非回归)
**Layer**: backend (`packages/ws-replication`)

## Symptoms

同一类「同步重放型 transport 在认证/接纳窗口灌入越界早到帧」的输入，两个 upgrade 入口行为分裂：

| 输入 | `accept()`（token 验证路径） | `acceptTrusted()`（可信路径，现状） |
|---|---|---|
| 单帧 > `maxFrameBytes` | resolve `undefined`；`close(1009, 'upgrade-frame-limit')`；observer `auth-upgrade-rejected/frame-too-large`；零 `HubConnectionImpl` 分配 | 8MB+1 字节**先完整保留**；**分配了** `HubConnectionImpl`；构造尾重放才经 `decodeInbound` 拒绝 → `close(1002, 'protocol-error')`（MALFORMED 先于 FRAME_TOO_LARGE 判定）；observer 走 `connection-failed` 而非 `auth-upgrade-rejected` |
| 早到帧数 > `MAX_EARLY_FRAMES`(16) | 第 17 帧即拒：`close(1008, 'upgrade-frame-limit')`；observer `early-frame-limit`；零分配 | 全部帧无条件入缓冲（条数无界）；分配连接后死于构造尾重放（1002） |

影响面：可信 upgrade 路径（宿主在 HTTP Upgrade 前已完成认证、`types.ts:141-145` 声明「不再 verifyToken」）失去 §3.2 R2 A2 立法的安全不变量——**内存保留无界**（单帧字节数与帧条数均无 admission 界），且被拒 transport 违规分配了 `HubConnectionImpl`（消耗 connectionCounter、进入 connectionList、依赖异步 cleanupAll 回收、发射错误类型的 observer 事件）。

## Reproduction

worktree：`/home/wangjian/nomicore-fix-issue-190`（HEAD = `b66615c`）。

用既有测试同款 fixture `makeReplayTransport`（`ws-replication-auth-lifecycle-red.test.ts:110-157`——`onMessage(listener)` 注册即把整个 backlog 同步灌给 listener，模拟 TcpTransport 实存形态 `sa7-r2-transport:132-144`）：

1. `makeReplayTransport([new Uint8Array(CONTRACT_LIMITS.maxFrameBytes + 1)])`（8MB+1 字节单帧）
2. `await hub.acceptTrusted(replay.transport, { peerInstanceId: PEER_INSTANCE })`（hub 由 `createHubReplication` + harness 默认 limits 组装）
3. 观测（[SA5-DIAG] 实测输出，复现测试已运行后删除）：
   ```json
   R1 oversized: {"connectionAllocated":true,"connectionState":"closed",
                  "closeInfos":[{"code":1002,"reason":"protocol-error"}],
                  "replayedCount":2,"hubConnections":1}
   R2 17帧:      {"connectionAllocated":true,"connectionState":"closed",
                  "closeInfos":[{"code":1002,"reason":"protocol-error"}],
                  "replayedCount":34,"hubConnections":1}
   ```
   对照 `accept()` 同输入（既有绿灯 `ws-replication-auth-lifecycle-red.test.ts` A2-e，:655-678）：`resolve undefined`、`[{1009|1008,'upgrade-frame-limit'}]`、`hub.connections.length === 0`、重放循环零流产。

## Investigation

1. **任务简报 + wiki**：PR #130（`b66615c`）合并后 review 发现 trusted 路径缺 token 路径的有界早到帧 admission 保证。
2. **代码考古**（`packages/ws-replication/src/hub-connection.ts`，本文件诞生于 `b66615c`，无更早历史 → new-feature-defect）：
   - `accept()` 门 3（:140-188）：early listener 内联三重纪律——`authRejected` 幂等早退（:156）、`maxFrameBytes` 单帧界 → `close(1009)` + `emitUpgradeRejected('frame-too-large')`（:157-163）、`MAX_EARLY_FRAMES` 条数界 → `close(1008)` + `'early-frame-limit'`（:164-170）；注册后同步收口 `if (authRejected || earlyClosed) { detachEarly(); return undefined; }`（:177-180）。
   - `acceptTrusted()`（:241-290）：early listener 仅 `earlyFrames.push(bytes)`（**:259-261**）——无 `authRejected` 等价标志、无字节界、无条数界、无拒绝 close/observer 事件。no-op 句柄初始化（:257-258，R3 N1 形式在）但拒绝语义缺失。
   - `HubConnectionImpl` 构造尾重放（:434-436）经 `onMessage` → `decodeInbound`（`frame-io.ts:60-68` → `decodeMessage` 带 `maxFrameBytes`）——**检查发生在保留与分配之后**，且对非协议字节先判 MALFORMED（1002）而非帧限语义（1009）。
3. **数据流追踪**：帧字节产生于 transport backlog → `onMessage` 注册点同步重放（hub-connection.ts:259，**唯一脆弱窗口**——`acceptTrusted` 全程无 `await`，注册到 `detachEarly()`(:280) 之间无微任务边界）→ listener 无条件 push 进 `earlyFrames` →（无界保留发生在此）→ `new HubConnectionImpl`（:281）→ 构造尾重放才首次检查 → `connectionFatal`/`close(1002)` → 异步 `cleanupAll` 回收连接。
4. **动态验证**：临时复现测试（vitest，上述 Reproduction）实测确认连接分配、1002 收口、无 `upgrade-frame-limit`。测试文件已删除，`git status` 无源码/测试残留。
5. **观察者面**：`emitUpgradeRejected` 的 reason union（hub-connection.ts:98-106）**已含** `'frame-too-large' | 'early-frame-limit'`——修复所需事件面已存在，零新码。

## Root Cause

`packages/ws-replication/src/hub-connection.ts:259-261`——`acceptTrusted()` 的早到帧监听器对每帧无条件 `earlyFrames.push(bytes)`，未实现 `accept()` 门 3（:155-172）已有的三重有界 admission 纪律（幂等拒绝标志 / `limits.maxFrameBytes` 单帧界 / `MAX_EARLY_FRAMES` 条数界）及其拒绝出口（`close(1009|1008, 'upgrade-frame-limit')` + `auth-upgrade-rejected` observer 事件 + 注册后同步收口返回 `undefined` 零分配）。两入口的 admission 逻辑是**独立实现**而非共享机制，PR #130 只给 token 路径落了 R2 A2 立法。

后果链：越界字节先入内存（无界保留）→ 被拒 transport 仍分配 `HubConnectionImpl`（违反零分配不变量，且不能被「later callbacks revive」的要求无对应标志位保障）→ 拒绝语义错档（1002/'protocol-error' + connection-failed 事件，而非文档化帧限语义）。

**Fix direction**（供 SA1 设计参考，不展开实现方案）：
把 `accept()`/`acceptTrusted()` 的早到帧 admission 收敛为**同一有界机制**（共享的 admission listener 工厂或等价单点）：push 前强制 `maxFrameBytes` 与 `MAX_EARLY_FRAMES`（≤16×maxFrameBytes 总保留界），拒绝时沿用既有 close code/reason（1009/1008 `'upgrade-frame-limit'`）与 `auth-upgrade-rejected`（`frame-too-large`/`early-frame-limit`）事件；保留 no-op 句柄 + 注册后同步收口模式（R3 N1），拒绝路径零 `HubConnectionImpl` 分配、`acceptTrusted` 恒 resolve `undefined`，并以拒绝标志使后续帧/回调不可复活。trusted 路径无验证器与 auth timer，无需该两件的清理面。

## Evidence

- **git 考古**：`git log --oneline --all -- packages/ws-replication/src/hub-connection.ts` → 仅 `b66615c`（PR #130）；`git show b66615c^:...hub-connection.ts` → path 不存在（文件随功能首发）。
- **缺陷代码**（hub-connection.ts:255-264）：
  ```ts
  const earlyFrames: Uint8Array[] = [];
  let earlyClosed = false;
  let offMessage: () => void = () => {};
  let offClose: () => void = () => {};
  offMessage = transport.onMessage((bytes) => {
    earlyFrames.push(bytes);          // ← 无 authRejected 守卫 / 无 maxFrameBytes / 无 MAX_EARLY_FRAMES
  });
  ```
  对照 accept()（:156-171）三重检查 + 拒绝出口。
- **动态实测**（临时 vitest 复现，[SA5-DIAG] 输出见 Reproduction；`acceptTrusted` + 同步重放 8MB+1 单帧 / 17 帧 → connectionAllocated:true、closeInfos=[{1002,'protocol-error'}]、hubConnections:1）。
- **既有绿灯锚**（accept 侧期望语义的权威定义）：`ws-replication-auth-lifecycle-red.test.ts` A2-e（:655-678）与 trusted HELLO 保真用例（:634-653，`replayedCount()===2`、connection 定义——修复不得破坏后者合法 HELLO 重放路径）。
- **类型面**：`types.ts:141-145` `acceptTrusted?` 可选、宿主已前置认证；`emitUpgradeRejected` reason union（hub-connection.ts:98-106）已含 `'frame-too-large' | 'early-frame-limit'`。
- **现场清理**：复现测试已删除，`git status --short` 仅余任务自身 `wiki/raw/task_*` 未跟踪文件；无 `[SA5-DIAG]` 日志残留（诊断日志仅存在于已删除的测试文件中，源码零改动）。

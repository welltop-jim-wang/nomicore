# Task Brief — ws-replication: bound early-frame admission in acceptTrusted

- Repository: `welltop-jim-wang/nomicore`
- Issue: #190
- Task type: bugfix
- Branch: `refactor/ws-replication-bound-early-frame-admission-in-acce`
- Run ID: `issue-190-1788118603-447205`
- Round: 1

## Context

PR #130 was merged to `main` as `b66615c`. Post-merge review found the trusted WebSocket upgrade path lacks the token-verification path's bounded early-frame admission guarantee.

## Problem

`packages/ws-replication/src/hub-connection.ts` has bounded early-frame admission in `accept()`, while `acceptTrusted()` independently buffers every early frame. A synchronously replaying/re-entrant transport can retain unbounded frames before `HubConnectionImpl` construction.

## Required outcome

- Use one bounded early-frame admission mechanism for `accept()` and `acceptTrusted()`.
- Enforce `maxFrameBytes` and `MAX_EARLY_FRAMES` before retaining bytes.
- Preserve existing close codes/reasons and observer events for limit rejection.
- Preserve synchronous replay safety when listener handles are not yet assigned.
- A rejected transport must allocate no `HubConnectionImpl` and cannot be revived by later callbacks.

## Acceptance criteria

1. Trusted transport synchronous replay of one oversized frame is rejected with documented frame-limit semantics.
2. Trusted transport synchronous replay of more than `MAX_EARLY_FRAMES` is rejected at first over-limit frame.
3. Frames after rejection are not retained or replayed.
4. Ordinary token-verification behavior remains unchanged.
5. Focused ws-replication tests, root `pnpm typecheck`, full `pnpm test`, and `git diff --check` pass.

## Required validation

- Focused ws-replication tests
- `pnpm typecheck`
- `pnpm test`
- `git diff --check`

## SA6 红灯测试契约（issue #190）

**测试文件**：`packages/ws-replication/test/ws-replication-issue190-red.test.ts`

**设计**（行为锚定，零源码 grep、零 mock 被测对象；fixture = 既有 A2-e 同款同步重放型
transport——TcpTransport 实存形态：`onMessage` 注册即同步重放积压、重放先于 return；
单帧界/条数界契约值取自既有 A2-e 锚：`maxFrameBytes`（harness CONTRACT_LIMITS）与
`MAX_EARLY_FRAMES = 16`；每条红 IT 先对全部观测面拍快照，再一次性 `toEqual` 冻结契约
快照——失败 diff 同时暴露全部偏差面，单一 expect 点不预锁修复路径）：

| IT | 锚 | 断言（契约快照） |
|---|---|---|
| AC1 | 单帧 `maxFrameBytes+1` trusted 同步重放 | `resolved:'undefined'`、`closeInfos:[{1009,'upgrade-frame-limit'}]`、`connections:0`、`rejectedReasons:['frame-too-large']`、零 `connection-failed`/`connection-state-changed`、`replayedCount:1`（重放零流产）、`sentCount:0`（零 wire 输出） |
| AC2 | 17 帧（>16 契约值）trusted 同步重放 | 同上形态，`[{1008,'upgrade-frame-limit'}]`、`rejectedReasons:['early-frame-limit']`、`replayedCount:17`（无保留帧二次重放） |
| AC3 | 64 帧积压 + 拒绝后泵入 8 帧 + 合法 HELLO | 拒绝恰于首越界帧（第 17 帧）一次 close；`replayedCount:64`；泵入帧 → 零新 close/零新 observer 事件/`connections:0`/零 wire 输出（后期回调不可复活） |
| 保真锚（绿灯） | 恰 1 帧合法 HELLO trusted 同步重放 | `connection` 定义、`replayedCount:2`、state `'closed'`、零拒绝事件——SA5 命名既有绿灯锚行为面，修复不得破坏 |

**红灯实跑证据**（HEAD `b66615c`，2026-08-31）：

```bash
# 聚焦
npx vitest run packages/ws-replication/test/ws-replication-issue190-red.test.ts
# →  Test Files  1 failed (1)
#     Tests  3 failed | 1 passed (4)   （AC1/AC2/AC3 红灯；保真锚绿灯）
#     Type Errors  no errors
# 全聚焦套件（无干扰）
npx vitest run packages/ws-replication/test
# →  Test Files  1 failed | 43 passed (44)
#     Tests  3 failed | 313 passed (316)   （仅 3 条新红 IT 失败）
# 类型面
npx tsc -p packages/ws-replication/tsconfig.json → 零错误
```

各红 IT 实测偏差（Received 侧，与 SA5 Reproduction 完全一致——`connectionAllocated:true`、
`closeInfos=[{1002,'protocol-error'}]`、无 `auth-upgrade-rejected`、走 `connection-failed`、
`replayedCount` 为积压条数 2 倍=保留后二次重放）：

- AC1：`{resolved:'allocated:closed', closeInfos:[{1002,'protocol-error'}], connections:1,
  rejectedReasons:[], connectionFailedEvents:1, stateChangedEvents:1, replayedCount:2, sentCount:1}`
- AC2：同上形态，`closeInfos:[{1002,'protocol-error'}]`、`replayedCount:34`（17 保留 + 17 构造重放）
- AC3：同上形态，`closeInfos:[{1002,'protocol-error'}]`、`replayedCount:128`（64 保留 + 64 构造重放）

**SA3 实现指引（仅引 SA5 Fix direction，不锁方案）**：把 `accept()`/`acceptTrusted()` 的
早到帧 admission 收敛为同一有界机制；拒绝时沿用既有 close code/reason（1009/1008
`'upgrade-frame-limit'`）+ `auth-upgrade-rejected`（`frame-too-large`/`early-frame-limit`）；
拒绝路径零 `HubConnectionImpl` 分配、`acceptTrusted` 恒 resolve `undefined`；拒绝标志使
后续帧/回调不可复活；保真锚（合法 HELLO）行为不得改变。实现后红 IT 转绿且既有
`ws-replication-auth-lifecycle-red.test.ts` A2-e/A2-d/trusted-HELLO 锚保持绿。

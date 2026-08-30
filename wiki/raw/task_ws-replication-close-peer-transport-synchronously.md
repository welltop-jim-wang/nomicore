# Task Brief — issue #168

## Task Type: Bug 修复

## Source

GitHub issue #168 (welltop-jim-wang/nomicore); fetched 2026-08-30. No comments.

## Title

ws-replication: close peer transport synchronously on hello timeout (orphan transport race, PR #165 round 2 D5)

## Requirement

On peer-side HELLO timeout, synchronously close the old peer transport via the established pong-timeout detach-close sequence (or an equivalent guarded helper), while preserving the frozen behavior of the dial-throw and onClose entries. Ensure late concurrent-dial steps remain idempotent and recovery remains functional.

## Evidence / scope

Issue reports SA7 D5 showed peer hello timeout enters backoff without closing peer transport; hub HELLO_TIMEOUT later closes it. Low, bounded orphan transport race. This is the tracking ticket for a previously scoped-out finding.

## SA6 Phase 1 — 红灯契约（2026-08-30）

### 产出文件

1. **新增（主红灯契约）**：`packages/ws-replication/test/ws-replication-issue168-hello-timeout-close-peer-red.test.ts`
   - T1（红色核心，预期失败）：hello 超时（探针 100ms，首代 wire 扣 peer→hub HELLO）→ backoff 时
     peer 侧旧 transport 必须已同步关闭（`wire1.peerSideClosed === true`；当前实现为 false=缺陷在场）；
     且 hub 侧可观测到 established detach-close 序列签名 `{ code: 1001, reason: 'hello-timeout' }`
     （pong-timeout 同构；reason 沿用观测词表既有词）；观测面恰好一次
     `connection-backoff-scheduled{reason: hello-timeout, attempt: 1}`、零 `connection-failed`
     （临时失败非 blocked）；迟到 in-flight HELLO_ACK 落旧 wire → epoch/退订双闸零扰动；
     恢复链 backoff(25ms) → wire2 → ready → live；hub.connections 收口至 1；hub 侧同值
     HELLO_TIMEOUT（缺省 10s）到点只剩幂等 no-op（state 守卫），新连接/旧 wire 关闭态不被打扰。
   - T2/T3（冻结面锁定，当前即绿——SA3 实现后必须保持绿）：dial-throw 仍
     `backoff(dial-failed)` + 重试恢复（关闭动作不外溢到无 transport 入口）；handshaking 期远端
     1001 关闭（onClose 入口）仍 `backoff(socket-closed)` + 恢复，且迟到 hello 定时器零副作用。
2. **翻转 SA7 D5 登记观察锚**：`packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts`
   - 原「登记观察：peerSideClosed === false（孤儿窗口在场）」按 SA5 修复方向 (e) 翻转为修复契约
     `peerSideClosed === true` + close 签名断言；hub 侧兜底段落改为「close 事件先到 →
     onTransportClosed 收口，其 HELLO_TIMEOUT 定时器仅剩幂等 no-op」；恢复链断言（重拨
     ready/live、hub.connections=1）保留。D1–D4 锚零改动。

### 设计要点（与实现约束的对应）

- 主断言锚定可观察运行时行为（transport close 标志、wire 对端 close 事件、observer 事件流、
  连接/命名空间状态机），零源码 grep、零 skip、零 real sleep、零 mock 外部依赖。
- close code/reason（1001 / hello-timeout）对齐 wire contract §18 R4 与 SA5 修复方向 (b)；
  如 SA1 设计裁决不同，仅需调整次要断言（核心契约 = `peerSideClosed === true`）。
- `scripts/test-lock.sh` 在本 worktree 不存在；本契约零新增端口/依赖（vitest + 内存双端），
  无需更新测试策略。
- 幂等/恢复锚来自任务简报「Ensure late concurrent-dial steps remain idempotent and
  recovery remains functional」的显式要求，作为冻结锁定而非冗余校验。

### 红灯验证证据（2026-08-30，worktree `ffca4f6`）

```
$ npx vitest run packages/ws-replication/test/ws-replication-issue168-hello-timeout-close-peer-red.test.ts
 Test Files  1 failed (1)
      Tests  1 failed | 2 passed (3)        ← T1 × / T2 ✓ / T3 ✓
Type Errors  no errors

关键失败（缺陷复现）：
  AssertionError: hello 超时同步关闭 peer 侧旧 transport（孤儿窗口收口）: expected false to be true
  ❯ ws-replication-issue168-hello-timeout-close-peer-red.test.ts:284

$ npx vitest run packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts
 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)        ← 仅翻转后的 D5 ×（注册观察 → 修复契约）；D1–D4 ✓

关键失败（同缺陷面）：
  AssertionError: hello 超时同步关闭 peer 侧旧传输（孤儿窗口收口）: expected false to be true
  ❯ ws-replication-sa7-round2-dynamic.test.ts:802

$ npx tsc -p packages/ws-replication/tsconfig.json --noEmit   ← exit 0（零类型错误）
```

结论：红灯真实——peer 侧 hello 超时不关旧 transport 的缺陷在两个锚上稳定复现；T2/T3
（dial-throw / onClose 冻结面）保持绿色，实现后仍须为绿。修复实现与修绿属 SA3。

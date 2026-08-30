---
status: complete
run_id: issue-168-1788095633-447205
branch: refactor/ws-replication-close-peer-transport-synchronously-
round: 1
---

# issue #168 — Synchronously close peer transport on HELLO timeout

## 需求摘要

修复 peer 侧 HELLO 握手超时后仅进入 backoff、未立即关闭旧 transport 所造成的有界 orphan-transport race。修复须复用既有 pong-timeout detach-close 纪律（或等价受保护 helper），同时保持 dial-throw、onClose 与 hub 侧行为不变，并确保迟到并发步骤幂等、重拨恢复正常。

## 改动

- `1092d34 fix(ws-replication): close peer transport synchronously on hello timeout (#168)`
  - 在 `PeerConnectionImpl` 中抽取受保护的 timeout detach-close helper；HELLO timeout 在进入 backoff 前同步停止 liveness、退订、作废 epoch，并以 `close(1001, 'hello-timeout')` 收口旧 transport。
  - HELLO 路径增加 transport/epoch 双凭据守卫；pong-timeout 改用同一 helper；dial-throw、onClose、hub timeout 冻结面未改变。
  - 新增/翻转 SA6 契约以覆盖 peer close、close 签名、幂等、迟到 ACK 与恢复链。
- `5591c2f test(yjs-server): replace package-internal test seam imports with in-test public-API fixture (#168)`
  - 修复终审 Standards S1：真实 WS 应用测试删除对 ws-replication 内部测试夹具的跨包导入，改用测试内最小 fixture 和包公共导出，保留 RT-1..RT-4 语义。
- `a85f767 test(ws-replication): add hello timeout dynamic coverage (#168)`
  - 提交 SA7 动态故障注入测试、SA4/SA7/SA3 任务存档与 dispatch 记录。

## 审查与验证

- **SA4 静态审查**：`pass`。范围严格为 `git diff ffca4f6..HEAD`；确认无 scope creep，设计一致，冻结面未触碰，且静态攻击面与契约连锁通过。报告：`wiki/raw/task_ws-replication-close-peer-transport-synchronously_sa4_review.md`。
- **SA7 动态验证**：`pass`。确认红基线非空转、真实 WS adapter close/re-entry 行为、hello/pong close-throw 后恢复；报告：`wiki/raw/task_ws-replication-close-peer-transport-synchronously_sa7_report.md`。
- **终审双轴 R2**：Standards `pass`（S1 修复后边界合规）；Spec `pass`（issue #168 要求完整，RT-1..RT-4 未削弱）。
- **最终整合验收**（commit `a85f7670e172bb2a68e612c6e083784564a74fff`）：
  ```text
  npx vitest run packages/ws-replication apps/yjs-server/test/ws-hello-timeout-close-issue168.test.ts
  → Test Files 44 passed (44), Tests 312 passed (312), Type Errors no errors

  npx tsc -p packages/ws-replication/tsconfig.json --noEmit
  → exit 0

  npx tsc -p apps/yjs-server/tsconfig.json --noEmit
  → exit 0
  ```
  后台完整输出：`.mabf-bg/issue168-final.log`；退出码：`.mabf-bg/issue168-final.exit`（`0`）。

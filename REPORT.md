---
status: complete
run_id: issue-191-1788112074-447205
branch: refactor/yjs-server-make-stale-root-lock-reclamation-atomic
round: 1
---

# issue #191 — Make stale root-lock reclamation atomic

## 概要

修复 `apps/yjs-server` 文件持久化根目录锁的两个竞态：stale lock 回收不再通过非独占覆写获得所有权；迟到的 lock handle 不再能删除后继持有者的锁。所有权转移现在均由独占 `wx` 创建裁决，并保留既有活 owner、PID reuse 和不可写根目录诊断。

## 变更

- `f2bc4f0 fix(yjs-server): make stale root lock reclamation atomic (issue #191)`
  - 在 `acquireRootLock()` 中以有界的 `unlink` + `wx` 重试环取代 stale lock 的 `flag: 'w'` 覆写；判定 stale 后在 unlink 前按原始字节重读确认，竞争者获锁时回环并给出 held 诊断。
  - 为每次获取生成 `nonce`，`release()` 仅在当前文件内容仍逐字节等于该 handle 的 payload 时才 unlink。
  - 增加可确定性编排的 stale-reclaim hooks、公共类型导出和 T1–T9 回归契约，覆盖双回收者、迟到 release、empty/malformed lock 与不可读 lock 行为。
  - 更新部署文档以描述原子重取、ownership-checked release 与 PID reuse caveat。

## 验证

- **SA2 设计破壁复审**：R2 `pass / APPROVE`；原子 wx 回收、原始字节守卫、nonce ownership 和测试契约均获批准。报告：`wiki/raw/task_191_sa2.md`。
- **SA4 独立静态审查**：`pass / APPROVE`；确认无生产 `flag: 'w'`、只有 wx 持锁出口、回环有界、诊断逐字保留、范围合规。报告：`wiki/raw/task_191_sa4.md`。
- **SA7 独立动态验证**：`APPROVE`；基线契约为 5 failed / 6 passed，修复后 T1–T9 两次均 11/11；门控真进程探针从基线 9/20 多持有违例改善为修复 20/20 恰一胜。报告：`wiki/raw/task_191_sa7.md`。
- **SA5 本地完成复核**：`APPROVE`；任务档案和 AC1–AC5 证据完备。报告：`wiki/raw/task_191_sa5.md`。
- **本地命令结果**（SA5 独立复跑，真实后台进程）：
  ```text
  pnpm exec vitest run apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts
  → Test Files 1 passed (1), Tests 11 passed (11), Type Errors no errors

  pnpm typecheck
  → exit 0

  pnpm exec vitest run --typecheck --no-file-parallelism
  → Test Files 211 passed (211), Tests 2265 passed (2265), Type Errors no errors, exit 0

  git diff --check && git show --check f2bc4f0
  → clean
  ```

本地 MABF 验收完成；CI、push 与 PR 发布由 Host 后续处理。

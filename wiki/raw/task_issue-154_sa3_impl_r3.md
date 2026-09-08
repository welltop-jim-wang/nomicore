# SA3 实现报告 R3 — Issue #154：T-A9 钉死测试提交（SA4 R2 PASS → Publication 前置）

- **Worktree**: `/home/wangjian/nomicore-fix-issue-154`（branch `fix/issue-154-on-docs-namespace-diagnostic-change-log`）
- **本轮提交**: `739a24b` `test(namespace-diagnostic-log): pin byte-budget independence from age (T-A9, SA4 R1 #154)`（父提交 `385a376` = SA4 R1 修复；再父 `c0f6cbc` = 首轮实现）
- **前置背景**: SA4 R2 PASS（P1 关闭）；Publication 前置 = T-A9 为未提交测试修改——本文件即该前置的完成记录。

---

## 1. 提交内容（仅一个文件；无 wiki/REPORT）

```
packages/namespace-diagnostic-log/test/file-adapter-retention.test.ts | 32 insertions(+)
```

确认步骤（提交前）：
- `git status --short` → 唯一业务改动 = 该测试文件的 `M`；其余全部为 `?? wiki/raw/task_issue-154_*.md`（任务元数据，按简报不提交）。
- `git diff` 全文核对 → **纯增量**：在 T-A8 之后追加 `T-A9 [红灯] 字节预算独立达标…` 一个测试块（末尾 `});` 前插入），**零既有断言变更**、零既有函数改动。

T-A9 断言面（SA4 §3-2 建议的钉死锚，逐项）：
- 非 null 非 0 maxAge（30d 名义值）+ 新鲜数据（age 1000ms）⇒ 年龄遍历（P1）零删除（`fresh.deletedGroups === 0`，新鲜度对照证明）；
- `maxBytesPerNamespace = total − 1` ⇒ **字节遍历独立达标**：删最老合格闭组（段 1）恰 1 组、`reclaimedBytes === g1`、`orphanBinsDeleted === 0`；
- 开组保护：段 3（开组）原样；段 2（闭组、预算已达标）原样；
- 保留历史如实：`earliestRetained === [{streamId, sequence:'2'}]`、`historyTrimmedStreams` 含该流、`retainedBytes === g2 + g3` 且 ≤ total−1。

## 2. 聚焦测试结果（提交后实测）

```bash
$ npx vitest run packages/namespace-diagnostic-log/test/file-adapter-retention.test.ts
# Test Files  1 passed (1)
#      Tests  16 passed (16)     # 15 既有（T-A1…A8 + T-B*）+ 新 T-A9
# Type Errors  no errors
```

相关背景验证（前两轮已录，引用）：
- `npx tsc -p packages/namespace-diagnostic-log/tsconfig.json` → exit 0；
- 包级全量 `npx vitest run packages/namespace-diagnostic-log/` → 27 files / 426 tests 全绿（本提交 +1 文件内测试数，不影响文件计数）。

## 3. 链上状态

```
739a24b test(namespace-diagnostic-log): pin byte-budget independence from age (T-A9, SA4 R1 #154)
385a376 fix(namespace-diagnostic-log): P2 byte sweep must not gate on age freshness (SA4 R1 #154)
c0f6cbc feat(namespace-diagnostic-log): retention, read-session leases, and namespace logical deletion (#154)
```

- 提交后工作树：仅 `wiki/raw/task_issue-154_*.md`（9 个）未跟踪——任务元数据，预期内。
- 未包含：`wiki/`、`REPORT.md`、任何其他包/文件。

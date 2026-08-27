# SA7 动态验证报告 — issue #133 round=2

**Date**: 2026-08-28  
**Worktree**: `/home/wangjian/nomicore-fix-issue-133`  
**Baseline**: `8b1398f`（R-FIX-1）；SA4 全量评审为 pass（带必须修复项），SA4 增量复审 `task_phase5-bootstrap-archive-reset-r2_sa4_review_incremental.md` 为 pass。  
**Verdict**: pass

## 前置门禁

- SA4 Step 0：通过。前轮 `pass（带 1 项必须修复）` 已由增量评审确认修复为 `Verdict: pass`。
- SA6 红灯锚定转绿：R2 red、R-FIX-1 hostile expected、Runtime fence、Persistence probe 的真实运行测试均通过；无静态推断替代运行证据。

## SA4 动态审核重点逐项证据

1. **F-3：fence probe 挂起 × idle-close**：`runtime-phase5-reset-fence-r2.test.ts` 随 targeted run 通过；其 fence 挂起/arm 前写入与 close 共享 barrier 的时序已执行。SA7 Registry 真链并发矩阵又覆盖 idle 自然关闭后重开、open/reset 50 轮，未出现悬挂或 entry 残留：`registry-sa7-phase5-bootstrap-reset-dynamic.test.ts` 10/10 通过。
2. **窗口 mutation 端到端**：真实 Registry + Runtime + MemoryPersistence 测试运行通过。fence 前已接纳写排空、真实 archive 的写入/移除，以及 reset 在 archive 后的终态由 SA7 §1a 和并发矩阵实际验证；targeted run 53/53 通过。Runtime T4 同次执行覆盖 fence 后 arm 前的 bump 接纳/排空，Registry armed archive failure 映射由 internal 15 tests 覆盖。
3. **`reset-archive-after-arm-failed` observer**：真实 armed `DOC_ARCHIVE_OPERATIONAL` 失败用例执行通过；断言事件恰一次、返回 `NAMESPACE_RESET_FAILED`，且序列化 cause 不含 replication ID、namespace 或 owner。见 internal test（targeted 15/15）和 SA4 增量评审 §3。
4. **File adapter 真磁盘路径**：真实 FilePersistence、真实 tmpdir、`.snapshot` 读取和 archive 目录布局的动态测试通过。`persistence-sa7-phase5-bootstrap-dynamic.test.ts` + `persistence-phase5-archive-red.test.ts` + R2 probe 测试合计 48/48；覆盖 archive `archive/users/{userId}/{docId}.snapshot`、重启恢复、tmp/rename 与 SAFE_PATH_SEGMENT 入口路径。
5. **armed 后 archive 挂起 × shutdown**：SA7 §2c 以真实 Memory IO `writeArchive` gate 暂停 archive commit 后并发 shutdown，断言 reset 与 shutdown 各自在 5s bound 内结算、shutdown same-Promise、已接纳 reset `ok:true`、零 unhandled rejection；targeted 10/10 通过。该测试是实际三方链路而非注入式静态检查。
6. **R-FIX-1 回归**：真实 Registry/Runtime/Memory seam 的 16 hostile expected 输入均返回 `NAMESPACE_INVALID_IDENTITY`；`probeCalls === []`、archive 空、lease active、runtime ready；随后合法 expected 重试成功。可变对象快照/TOCTOU 与 observer 分支同在 internal 测试运行，15/15 通过。

## 常规动态面

- **针对性测试**（后台独立进程）：
  ```bash
  pnpm vitest run packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-red.test.ts packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-internal.test.ts packages/namespace-runtime/test/runtime-phase5-reset-fence-r2.test.ts packages/persistence/test/persistence-phase5-bootstrap-reset-r2.test.ts packages/namespace-registry/test/registry-sa7-phase5-bootstrap-reset-dynamic.test.ts
  ```
  结果：`Test Files 5 passed (5)`，`Tests 53 passed (53)`，`Type Errors no errors`，exit 0。
- **新测试连跑 / flake**：上述核心 SA7/R2 集合（4 文件）连续 3 次均为 `Test Files 4 passed (4)`、`Tests 43 passed (43)`、`Type Errors no errors`，exit 0。
- **真实 File 动态集**：
  ```bash
  pnpm vitest run packages/persistence/test/persistence-sa7-phase5-bootstrap-dynamic.test.ts packages/persistence/test/persistence-phase5-archive-red.test.ts packages/persistence/test/persistence-phase5-bootstrap-reset-r2.test.ts
  ```
  结果：`Test Files 3 passed (3)`，`Tests 48 passed (48)`，exit 0。
- **全量测试**：`pnpm test` → `Test Files 147 passed (147)`，`Tests 1757 passed (1757)`，`Type Errors no errors`，exit 0。
- **类型检查**：`pnpm typecheck` exit 0。
- **禁词/探针公共面审计**：SA7 动态 Registry public-surface 用例实际枚举 instance keys，仅为 `create,getStatus,importReplica,open,resetReplica,shutdown`；禁词 API 均不存在，targeted run 通过。

## vitest 触发证据

本任务含 `*.test.ts` 变动。当前轮尚未 push/创建 PR，无法诚实声称 CI runner 已执行；以下是本地 vitest 的实际触发证据，CI 触发性仍由后续 PR CI 观察闭环。

| Workspace Package | 本地 Vitest 触发结果 | 摘录 |
|---|---|---|
| `@nomicore/namespace-registry` | ✓ 触发且通过 | `registry-phase5-bootstrap-reset-r2-red` 10、`...internal` 15、`registry-sa7...dynamic` 10 tests all passed |
| `@nomicore/namespace-runtime` | ✓ 触发且通过 | `runtime-phase5-reset-fence-r2.test.ts (7 tests)` |
| `@nomicore/persistence` | ✓ 触发且通过 | R2 probe 11 + File dynamic/archive 48 tests all passed |

**本地 verdict**: ✅ all-vitest-packages-triggered。  
**CI 观察状态**: 未适用（SA7 不 push、不建 PR，未提供 CI Run URL）；不得将此记为 CI 已绿。

## E2E spec 触发证据

不适用：本任务无 `*.spec.ts` 改动，且 SA4 未标识 `spec-not-triggered`。

## 非阻断记录

`git diff --check 6784645..HEAD` / `8b1398f..HEAD` 返回 2，唯一输出是已提交的 SA4 增量评审 markdown 第 3–4 行尾随空白：`wiki/raw/task_phase5-bootstrap-archive-reset-r2_sa4_review_incremental.md`。这不是生产或测试代码问题，未影响运行/类型检查；仍建议总控在后续文档收口时清理。验证开始/结束工作树均无未提交生产或测试变更。

## 结论

动态证据覆盖 SA4 移交的 6 项风险；核心三方并发、真实 Memory/File adapter、R-FIX-1 hostile 输入与 observer 行为均实际通过。基于 SA4 pass，SA7 verdict 为 **pass**。

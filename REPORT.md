---
status: complete
run_id: controller-welltop-jim-wang-nomicore-155-1788486400000-a4ac1bb8-b42e-4706-af36-f3119ac63b8d
task_type: feature
branch: mabf/issue-155
started_at: 2026-09-03T00:00:00Z
finished_at: 2026-09-04T10:15:00Z
---

# Issue #155 — Expose diagnostic replay and Host lifecycle configuration

## 概要

完成 Host/Registry 诊断日志启用、生命周期管理与严格 replay 的本地 MABF 验收。恢复轮已补齐 SA3 回归诊断、SA4 静态复审与 SA7 动态验证；二者均为 pass/approve。

## 变更

- 为 yjs-server Host 配置、诊断管理器和停机生命周期接入诊断日志。
- 为 Registry/Runtime 接入按 namespace 键控的诊断 emitter，并暴露 replay 能力。
- 增加 Host 生命周期 E2E 契约及 SA7 动态验证覆盖。
- 更新相关包版本及 lockfile；完整任务档案位于 `wiki/raw/task_expose-diagnostic-replay-host-lifecycle*.md`。

## 验证

最终由 Controller 后台独立进程运行：

```text
pnpm typecheck && pnpm test
exit code: 0
Test Files  259 passed (259)
Tests  2854 passed (2854)
Type Errors  no errors
Duration 504.28s
```

本恢复轮（job `bash-1`）已重新执行完整验证；类型检查覆盖 14 个 tsconfig 且成功，随后 Vitest 完整通过（259 files / 2854 tests，Duration 503.34s）。

首次按过时项目脚本策略尝试 `source scripts/test-lock.sh` 因该脚本不存在而以 exit 1 结束；已检查根 `package.json` 的权威 scripts 后，以上直接 `pnpm typecheck && pnpm test` 重跑为最终通过证据。

附加门禁：

- `git diff --check`：通过。
- SA4 R3：pass/approve；独立全量 259/2854 通过。
- SA7 R4：pass/approve；SA6 契约 22/22、SA7 补充 6/6、全量 259/2854 与 typecheck 均通过。
- AC checklist：AC1–AC6 全部满足（`wiki/raw/task_expose-diagnostic-replay-host-lifecycle_ac_checklist.md`）。

提交受共享 gitdir 只读沙箱阻塞：`/home/wangjian/nomicore/.git/worktrees/nomicore-fix-issue-155/index.lock` 无法创建。已生成未跟踪的本地收尾脚本 `.mabf-bg/finalize-commit.sh`，供外层无沙箱环境执行；该目录不应入库。

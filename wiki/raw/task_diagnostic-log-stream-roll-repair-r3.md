# Issue #153 — round=3 修订简报

- **run_id**: `issue-153-1787937652-3942974`
- **branch**: `fix/issue-153-on-docs-namespace-diagnostic-change-log`
- **任务类型**: 发布后修订轮 / bugfix
- **反馈**: PR #166 审查指出无 sidecar 引用（`Refs` 为空）时，C2/C3 不得将截断点由 `0` 推进至完整 orphan frame 前缀末端；最大 segment 的完整未引用 BIN 尾帧必须全截断。

## 权威行为

设计 `task_diagnostic-log-stream-roll-repair_design.md` §5.2、§5.4 与包级 `AGENTS.md`：`Refs` 为空时 `T=0`；C2/C3 对最大 segment 的可证明未引用尾部统一 `truncate(bin, T)`。

## 本轮要求

1. 确认 `reader.ts` 两处分析路径均遵从上述语义；不得保留/重新引入 `walkCompletePrefixEnd()` 式例外。
2. 更新或补足回归锚：完整 orphan BIN 尾帧修复后长度 `0`；其后追加 sidecar record 的 `frameOffset === "0"`；strict reader 成功。
3. 包级验证必须包括：`git diff --check`、`pnpm exec tsc -p packages/namespace-diagnostic-log/tsconfig.json --noEmit`、`pnpm exec vitest run --typecheck packages/namespace-diagnostic-log`。
4. 仅在独立复核发现实际缺陷时修改代码；无差异亦须形成本轮 SA4/SA7 审计证据。

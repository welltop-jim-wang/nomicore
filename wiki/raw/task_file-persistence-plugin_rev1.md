# 修订轮简报 R1 — PR #66 owner review 反馈（run_id: issue-58-rev-1787312499）

- 原任务简报：`wiki/raw/task_file-persistence-plugin.md`（Issue #58，功能开发）
- 触发：runner 转达 owner 对 PR #66 的 review 评论「合并前需修复」
- branch: `fix/issue-58-on-adr-server-design`，base: `adr/server-design`
- 修订轮路由（SKILL §发布后修订轮）：设计层条目 → SA1 修订后走 SA3/SA4；代码/测试类 → SA3（+SA4 复查）；动态语义大变 → 补 SA7

## 反馈逐条研判

| # | 反馈条目 | 级别 | 总控研判 | 关键证据 | 路由 |
|---|---------|------|---------|---------|------|
| 1 | 删除全部 `.mabf-bg/**` | BLOCKER | **真问题**。PR diff 含 `.mabf-bg/baseline.log`、`final-verify.log`、`sa3-verify.log`（DENY LIST 运行时产物入仓）。`.gitignore` 已列 `.mabf-bg/` 但文件先于 ignore 被跟踪。另查明：base 分支 `adr/server-design` 自身遗留 3 个 `.mabf-bg` 文件（baseline-test.log / red-confirm.log / sa3-verify.log），不在本 PR diff 内；若在本分支删除它们会把 `.mabf-bg/**` 路径重新带进 PR diff，违反复审门禁字面要求，故 base 遗留清理另案处理 | `git diff origin/adr/server-design..HEAD -- .mabf-bg/` | SA3 执行 git 清理（详见 §A），审计结论整理入本文件 §B |
| 2 | 拆 barrel 循环依赖 + 导入顺序 TDZ | HIGH | **真问题（设计层）**。`lifecycle.ts:12-19`、`file.ts:13`、`memory.ts:3-6`、`testing.ts:2` 均反向 import barrel `./index.js`；`file-persistence-sa7-dynamic.test.ts` 靠先导入 `index.ts` 规避 TDZ | grep import 输出 | SA1 修订设计（抽 `contract.ts` 叶子模块）→ SA3 实现 + 删 workaround + 增直导 TDZ 回归测试 |
| 3 | degraded/retry 改 namespace/entry 级 | HIGH | **真问题（设计层）**。`lifecycle.ts:88` Adapter 全局 `status`，`:334` 全局拒绝写入；任一 doc 失败拖垮全部、无关 doc 成功误恢复 | ADR 0006 语义；owner 4 条测试契约 | SA1 修订设计（degraded 归入 CoreEntry）→ SA3 实现 + 改写 sa7-dynamic 反向冻结测试，覆盖 owner 指定 4 场景 |
| 4 | `.tmp` 删除失败不能全静默 | MEDIUM | **真问题**。`file.ts` `fsp.rm(tmpPath,{force:true}).catch(()=>undefined)` 吞掉 EACCES/EPERM/IO 错误 | owner 给出二选一 | SA1 采用**推荐方案**：仅 ENOENT 视为无文件，其余响亮拒绝（不改 ADR，与 ADR 0006 决策 E「忽略内容并删除遗留 tmp」一致——删除失败即无法保证该语义，必须响亮）；SA3 补非 ENOENT 删除失败测试 |
| 5 | 同 rootDir 实例所有权注释 | 文档 | **真问题（文档类）**。固定 `.snapshot.tmp` 在同 rootDir 双实例间有删除/rename 竞态；本轮不实现多实例并发安全，只加 Interface/配置注释 | owner 原文 | SA1 写入设计 + SA3 落到 Interface/配置注释 |

## §A `.mabf-bg` 清理执行方案（满足门禁「PR diff 不含任何 `.mabf-bg/**` / `TASK.md`」）

1. `.mabf-bg/baseline.log`、`.mabf-bg/final-verify.log`：base 不存在 → `git rm --cached` 解除跟踪（本地文件保留，被 .gitignore 覆盖不再出现在 status）。
2. `.mabf-bg/sa3-verify.log`：base 存在且被本 PR 修改 → 先把当前内容另存为未跟踪副本（如 `.mabf-bg/sa3-verify.rev0.log`），再 `git checkout origin/adr/server-design -- .mabf-bg/sa3-verify.log` 恢复 base 内容，使其从 PR diff 消失。
3. `.mabf-bg/baseline-test.log`、`.mabf-bg/red-confirm.log`：与 base 完全一致、本不在 PR diff → 不动。
4. `TASK.md`：确认未被跟踪（`.gitignore` 已覆盖，PR diff 无此路径）。
5. 结果：PR files 列表中 `.mabf-bg/**` 路径清零；本地 `.mabf-bg/` 运行时产物不丢失。

## §B 被删日志的审计结论整理（owner 要求保留的结论）

| 日志 | 阶段 | 结论 |
|------|------|------|
| baseline.log | 改版前基线 | Test Files 32 passed / Tests 480 passed / Type Errors none / TYPECHECK_EXIT=0 / TEST_EXIT=0 |
| sa3-verify.log | SA3 交付复核 | Test Files 33 passed / Tests 493 passed / Type Errors none / 双 EXIT=0 |
| final-verify.log | Phase 4 收尾验收 | Test Files 34 passed / Tests 496 passed / Type Errors none / 双 EXIT=0 |

完整过程结论另见 `task_file-persistence-plugin_dispatch.md`（派遣日志）、`task_file-persistence-plugin_sa4_review.md`、`task_file-persistence-plugin_sa7_report.md`、`task_file-persistence-plugin_ac_checklist.md`（9/9 ✅），均已入仓。

## 复审门禁（owner 原文，修订轮验收标准）

- [ ] PR diff 不含任何 `.mabf-bg/**` / `TASK.md`
- [ ] 无 `index → adapter → lifecycle → index` 循环
- [ ] adapter 模块可直接导入，不依赖导入顺序
- [ ] degraded/recovery 按 namespace/entry 隔离
- [ ] 无关 doc 成功不能提前恢复失败 doc
- [ ] `.tmp` 非 ENOENT 删除失败按最终 ADR 语义处理并测试
- [ ] 全量 `pnpm test`、`pnpm typecheck` 与 Node 20/24 CI 通过（CI 由 runner 跟踪，本地必须双全绿）

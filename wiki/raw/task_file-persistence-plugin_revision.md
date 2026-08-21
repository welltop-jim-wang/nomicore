# 发布后修订轮简报 — PR #66 owner review 反馈（issue #58 / file-persistence-plugin）

- run_id: issue-58-rev-1787312820
- branch: fix/issue-58-on-adr-server-design
- PR: #66（base 保持原样 adr/server-design）
- 触发：runner 转达 owner review 评论「合并前需修复」

## Owner 反馈全文（逐字转录）

> ## PR #66 review：合并前需修复
>
> 结论：**当前不应合并**。FilePersistence 主链路和测试覆盖较完整，但以下问题必须闭环。
>
> ### 1. BLOCKER：删除全部 `.mabf-bg/**`
>
> PR 当前提交了：
>
> - `.mabf-bg/baseline.log`
> - `.mabf-bg/final-verify.log`
> - `.mabf-bg/sa3-verify.log`
>
> `.mabf-bg/` 是 runner 运行时产物，属于仓库 DENY LIST，不能进入分支提交。需要保留的审计结论应整理进允许提交的 `wiki/raw/task_*.md`。
>
> ### 2. HIGH：拆除 barrel 循环依赖和导入顺序 TDZ
>
> 当前依赖形成循环：
>
> ```text
> index.ts
>   → re-export file.ts / memory.ts
>       → lifecycle.ts
>           → import index.ts
> ```
>
> `file-persistence-sa7-dynamic.test.ts` 已需要先导入 `index.ts` 才能避免直接导入 `file.ts` 时触发 TDZ，说明导入顺序已成为隐藏契约。
>
> 建议把以下内容抽到依赖叶子模块（如 `contract.ts`）：
>
> - `User`
> - `DocHandle`
> - `DocPersistence`
> - schedule types/defaults
> - `provideDocPersistence`
>
> 然后：
>
> ```text
> lifecycle.ts → contract.ts
> memory.ts    → contract.ts + lifecycle.ts
> file.ts      → contract.ts + lifecycle.ts
> index.ts     → 仅聚合 re-export
> ```
>
> 内部实现模块不得反向 import barrel `index.ts`。删除测试中的导入顺序 workaround，并增加"直接导入 adapter 不发生 TDZ"的回归验证。
>
> ### 3. HIGH：将 degraded/retry 改为 namespace/entry 级
>
> ADR 0006 的语义是：
>
> > save 失败按 doc 只读降级；失败后 namespace 进入 `persistence-degraded`；该 namespace retry 成功后恢复可写。
>
> 当前 `PersistenceLifecycleCore` 只有 Adapter 全局 `status`：
>
> - 任一 doc flush 失败会拒绝所有用户/文档的后续写入；
> - 任一无关 doc flush 成功又会把整个 Adapter 恢复为 `ready`；
> - 失败 doc 可能在自身 retry 成功前被错误恢复为可写。
>
> 应把 degraded 状态归入 `CoreEntry`，`saveDoc(handle)` 仅检查该 handle 对应 entry；retry 成功只能恢复该 entry。同步修正 `file-persistence-sa7-dynamic.test.ts`：当前测试反向冻结了 Adapter 全局降级的错误行为。
>
> 至少覆盖：
>
> 1. Bob/doc1 失败后只拒绝 Bob/doc1 写入；
> 2. Alice/doc2 仍可读写；
> 3. Alice/doc2 成功 flush 不得恢复 Bob/doc1；
> 4. Bob/doc1 自身 retry 成功后才恢复写入。
>
> ### 4. MEDIUM：`.tmp` 删除失败不能全部静默吞掉
>
> 当前实现：
>
> ```ts
> await fsp.rm(tmpPath, { force: true }).catch(() => undefined)
> ```
>
> 会吞掉 `EACCES`、`EPERM`、I/O 故障等全部错误。ADR 要求发现遗留 `.tmp` 时忽略其内容并删除；只读 workload 也未必会有后续 flush 来暴露故障。
>
> 请二选一：
>
> - 推荐：仅将 `ENOENT` 视为已无文件；其他删除失败响亮拒绝；
> - 如果确实要 best-effort，先显式修改 ADR，并说明可观测性与清理保证。
>
> 补充测试应覆盖非 `ENOENT` 删除错误，而不是只验证文件不存在/正常删除。
>
> ### 5. 明确同 rootDir 的实例所有权
>
> 固定 `.snapshot.tmp` 会在两个同 rootDir 的活跃 FilePersistence 实例之间产生删除/rename 竞态。Issue 只要求不同实例可指向不同 rootDir，ADR v1 也不提供文件锁，因此本轮不要求实现多实例同目录并发安全；但需要在 Interface/配置注释中明确：
>
> > 同一 rootDir 同时只能由一个活跃 FilePersistence 实例拥有；HMR 必须等待旧实例 dispose/drain 后再加载新实例。
>
> ### 复审门禁
>
> - [ ] PR diff 不含任何 `.mabf-bg/**` / `TASK.md`
> - [ ] 无 `index → adapter → lifecycle → index` 循环
> - [ ] adapter 模块可直接导入，不依赖导入顺序
> - [ ] degraded/recovery 按 namespace/entry 隔离
> - [ ] 无关 doc 成功不能提前恢复失败 doc
> - [ ] `.tmp` 非 ENOENT 删除失败按最终 ADR 语义处理并测试
> - [ ] 全量 `pnpm test`、`pnpm typecheck` 与 Node 20/24 CI 通过

## 总控逐条研判

| # | 级别 | 研判 | 路由 |
|---|------|------|------|
| 1 | BLOCKER | **真问题**。`git ls-tree` 确认分支实际提交了 5 个 `.mabf-bg/**` 文件（owner 列出 3 个，另有 baseline-test.log、red-confirm.log），全部须从分支删除；其中有保留价值的审计结论由 SA3 摘要进 `wiki/raw/task_file-persistence-plugin_*.md` 后再删。机械清理+git 操作 → SA3 | SA3 |
| 2 | HIGH | **真问题，设计层**。barrel 循环 + TDZ 隐藏契约（SA4 首轮 F-1 已预警深路径 TDZ）。按 owner 建议抽 `contract.ts` 依赖叶子模块，目标依赖图由 owner 直接给出。→ SA1 设计修订 → SA3 实现；须删除测试 import 顺序 workaround 并加"直接导入 adapter 无 TDZ"回归 | SA1→SA2→SA3 |
| 3 | HIGH | **真问题，设计层**。owner 引 ADR 0006 语义（namespace 级 degraded/recovery），当前实现为 Adapter 全局 status，属实现偏离 ADR。归入 `CoreEntry`，saveDoc 只查本 entry，retry 仅恢复本 entry；SA7 动态测试须重写为冻结正确语义（owner 给定 4 条最低覆盖）。→ SA1 设计修订 → SA3 实现 | SA1→SA2→SA3 |
| 4 | MEDIUM | **真问题**。采纳 owner 推荐方案：仅 `ENOENT` 视为无文件，其余删除错误响亮拒绝（不修改 ADR——ADR 规定的"忽略内容并删除遗留 .tmp"语义不变，本项只是错误处理收紧）。需补非 ENOENT 删除失败测试。→ SA1 设计修订定语义 → SA3 实现 | SA1→SA2→SA3 |
| 5 | 澄清 | **真问题（文档级）**。本轮不实现多实例同目录并发安全；在 Interface/配置注释写明"同一 rootDir 同一时刻仅一个活跃实例；HMR 须先 dispose/drain 旧实例"。→ SA1 设计修订写明文案 → SA3 落实注释 | SA1→SA3 |

## 修订轮工作流（总控构造）

SA1（设计修订，覆盖 #2/#3/#4/#5）→ SA2（设计复审）→ SA3（实现全部 5 项 + commit + push）→ 总控亲跑全量验证 → SA4（静态复查）→ SA7（动态复查，含 entry 级 degraded 4 条语义）→ 按需修订迭代 → 确认 push 后回报 runner。

修订轮允许 push（`git push origin HEAD`，更新 PR #66）；**严禁提交 `.mabf-bg/**`**。

## 复审门禁映射（owner checklist → 验证责任）

- diff 无 `.mabf-bg/**`/`TASK.md` → SA3 删除 + 总控 push 前 `git ls-tree` 复核
- 无循环 / 直接导入无 TDZ → SA1 设计 + SA3 实现 + SA4 静态 + SA7 动态回归
- entry 级 degraded/recovery 4 条语义 → SA3 重写 SA7 动态测试 + SA7 复查
- `.tmp` 非 ENOENT 响亮失败 → SA3 实现 + 测试
- 全量 test/typecheck/CI → 总控亲跑 + runner/CI 跟踪

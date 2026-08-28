# 任务简报 — Issue #152 修订轮 round=2（File diagnostic-log adapter 规格修正）

## 任务身份

- repositoryId: nomicore
- issue: 152（PR #159，round=1 已交付并过 CI）
- round: 2（发布后修订轮：owner 人工 review 反馈）
- worktree: /home/wangjian/nomicore-fix-issue-152
- branch: fix/issue-152-on-docs-namespace-diagnostic-change-log
- run_id: issue-152-1787906642-3529662
- 基线 commit：fde8034（round=1 HEAD）
- round=1 档案：wiki/raw/task_diagnostic-log-file-adapter{,_design,_sa2_review,_sa3_impl,_sa4_review,_sa7_report,_ac_checklist,_relevant_decisions,_conflict_report,_design_conflict_report,_standards_review,_spec_review,_dispatch}.md

## 反馈来源

人工 review（welltop-jim-wang @ 2026-08-28T12:49:30Z）对 round=1 交付提出 3 项规格修正要求。以下为反馈全文（逐字，译述不得失真）：

### 反馈 1：Strict reader 没有执行 manifest 冻结的 format policy

> ADR 0012 要求 manifest 冻结 committed-update capture、input policy、inline threshold 和 line limit，AC4 要求 strict reader 严格解释这些策略。当前 `reader.ts` 主要检查字段类型，没有验证具体记录是否遵守 `committedUpdateCapture`、`inlineUpdateMaxBytes` 等策略。例如 manifest 声明 capture=false 时仍可能接受带 update 的记录，超过阈值的 update 仍以 inline 形式存储时也可能返回 `ok`。

### 反馈 2：Stream sequence 只验证递增，没有验证连续

> Issue AC4 明列 stream sequence 校验，ADR 0012 的 storage validator 要求 stream 连续性。当前 reader 只拒绝重复或倒序，允许 sequence gap；例如物理记录从 `[1, 2, 3]` 删除 sequence 2 后，`[1, 3]` 仍可能被判定为 `ok`，无法发现记录缺失。

### 反馈 3：同步文件 I/O 与 ADR 的 non-blocking emitter 契约冲突

> ADR 0011 要求 adapter 的慢操作不得延长 producer write slot；ADR 0012 描述的是有界 writer queue 和周期性批量 flush。当前 File adapter 在 `emit()` 调用栈内执行同步 append，文件系统延迟会直接阻塞业务调用方。PR 设计将同步可观察性设为生产契约，但尚未通过 ADR 修订解决与既有 non-blocking 契约的冲突。应按现有 ADR 改为有界异步写入，或先明确修订 ADR 并记录相应取舍。

## 修订范围（本票做什么）

1. **反馈 1**：strict reader 在 per-record/per-line 层面执行 manifest 冻结的 format policy——`committedUpdateCapture`、`inputCapturePolicy`、`inlineUpdateMaxBytes`（双向：超阈值不得 inline；不大于阈值不得 sidecar）、`jsonlLineLimitBytes`（行字节上限）。违规的 issue 归类（码表/状态映射）由 SA1 设计、SA2/SA8 评审，总控裁决备案。
2. **反馈 2**：strict reader 校验 stream sequence 连续性（物理记录缺失可发现）。设计必须正面处理与 round-1 §4.4「门禁失败消耗 sequence 产生合法 gap」及 §4.2「genesis 守卫跳过消耗 sequence 1」的张力——消除合法 gap 源（如 sequence 分配时点移后）或提出等效诚实语义，由 SA1 设计、SA2 攻击评审、SA8 ADR 一致性复审。目标不变量：健康 stream 不误判，物理删除必发现。
3. **反馈 3（二选一决策项，总控已定选择 b）**：**修订 ADR 0012**（必要时附 ADR 0011 适用性澄清单段），把「首切片 File adapter = emit 调用栈内有界同步 append（无队列/无 batch/无 fsync/无常驻 fd）」显性化为 ADR 级决策，记录：取舍理由（EISDIR 恢复语义、无内存-磁盘孪生状态、切片纪律）、对 ADR 0011 non-blocking seam 的保持方式（void/不抛/有界工作量 + 接线纪律：emit 调用点不得位于 namespace write slot 内——转 #149–#151/#155 接线票强制）、与「有界 writer queue + 周期 batch flush」终态形态的演进路径（公共 seam 不变、后续切片可替换）。**实现保持同步语义不变**；不改 ADR 0011 正文。
4. 同步更新受影响的文档（README / AGENTS.md / CONTEXT.md 如需）与测试锚。

## 明确排除（不做什么）

- 不实现异步 writer queue / batch flush / fsync 开关（演进路径由 ADR 修订记录，实现留后续票）。
- 不改 #148 冻结的 v1 契约包语义（memory adapter、emitter 管线、schema 词表）；strict reader 码表扩展仅限本票 reader/file-adapter 域。
- 不动 #153（rolling/打开与尾部恢复）、#154（retention）、#155（replay/Host 接线）范围。
- 不 push、不开 PR（发布归 Host/Runner）。

## 验证门槛（必须通过并记录）

- `git diff --check` 干净
- `pnpm typecheck` 全包 0 错误
- `pnpm test`（vitest run --typecheck 全量）绿，记录文件数/测试数并与基线（fde8034）对比

## 验收标准（继承 issue #152 AC + 本轮 3 项反馈）

- AC1–AC5（issue 正文五条，round=1 已 ✅）不得回退；
- R2-AC1（反馈 1）：strict reader 对 manifest 冻结四策略（committedUpdateCapture / inputCapturePolicy / inlineUpdateMaxBytes / jsonlLineLimitBytes）逐条落地执行，敌意 fixture（capture=false 却带 update、超阈值 inline、≤阈值 sidecar、超 line 上限行、policy='none' 却带 digest/full 输入等）被响亮判定且有测试锚；
- R2-AC2（反馈 2）：物理删除中间 record（[1,2,3]→[1,3]）被 strict reader 发现并如实判定；健康 stream（含全部合法终态）不误判；有测试锚；
- R2-AC3（反馈 3）：ADR 0012 修订落地（状态/决策/被否方案/后果相应更新），同步首切片的取舍与接线纪律成文，演进路径明确；ADR 0011 正文不动。

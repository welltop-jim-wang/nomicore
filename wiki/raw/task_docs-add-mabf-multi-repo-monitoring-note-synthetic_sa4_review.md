# SA4 静态验尸报告

**Date**: 2026-08-18
**Task**: docs: add MABF multi-repo monitoring note (synthetic e2e test)
**Worktree**: /home/wangjian/nomicore-refactor-docs-add-mabf-multi-repo-monitoring-note-synthetic
**HEAD**: 33b0078d77fc7c4298a867007da3566bf12d67c7
**Verdict**: pass

## 审核结论

### 1. 设计一致性（含 §1.1 File Scope Creep Guard / §6 commit-scope 门禁）

**✅ 一致 — commit-scope 门禁通过（对应设计 §6 提交入库范围表）**

`git show --name-only HEAD` 实际入库文件集合：

```
docs/mabf-poller.md
wiki/raw/task_docs-add-mabf-multi-repo-monitoring-note-synthetic.md
wiki/raw/task_docs-add-mabf-multi-repo-monitoring-note-synthetic_design.md
wiki/raw/task_docs-add-mabf-multi-repo-monitoring-note-synthetic_dispatch.md
wiki/raw/task_docs-add-mabf-multi-repo-monitoring-note-synthetic_sa2_review.md
```

- **ALLOW LIST 比对**：actual − `{docs/mabf-poller.md, wiki/raw/*}` = ∅。全部入库文件落在允许集合内。
- **BLACKLIST 扫描**：无 `package-lock.json` / `yarn.lock` / `.DS_Store` / `TASK.md` / `*.bak` / `.mabf-bg/` / `tests/` 命中。
- **DENY LIST**：未触碰 `LICENSE` / `.gitignore` / `TASK.md` / 任何 CI 配置 / 业务源码。
- **关键护栏验证**：worktree 中 `.mabf-bg/`、`TASK.md`、`tests/docs_mabf_poller.sh` 均**存在但未跟踪**（`??`），证明 SA3 严格执行了设计 §4.3(a) 的 path-scoped `git add`（仅 `git add docs/mabf-poller.md` + `git add wiki/raw/`），未使用 `git add -A`/`.`/`-u`。这正是 SA2 R1 CRITICAL 攻击点 #1 的防线，已落实。
- **wiki 档案随代码 commit**：`wiki/raw/` 下 4 份档案（task/design/dispatch/sa2_review）均已入库，满足简报「Wiki 档案必须随代码一起 commit」。

**设计偏离审查**：`docs/mabf-poller.md` 正文与设计 §3.2 骨架**逐字一致**（标题、三节结构、契约 token 落点全部对齐 §3.3 核对表），无偏离。

### 1.3 / 1.4 spec / vitest 触发性

**N/A** — 纯文档任务，diff 中无 `*.spec.ts` / `*.test.ts`。

### 1.5 协议假设

**N/A** — 设计 §7 明示「无协议级假设」，本次仅新增 markdown + path-scoped git 操作，无 HTTP/WS/端口/进程生命周期假设。SA4 复核确认无协议假设需要重跑验证。

### 1.6 契约改动连锁

**N/A** — 设计 §8 明示「无契约改动」。未修改任何已有函数签名/返回类型/throw 路径，无 caller 受影响。

### 1.7 源码 GREP 断言禁令

**✅ 不适用 / 合规** — `tests/docs_mabf_poller.sh` 用 `grep` 断言的对象是**被验收的交付文档本身**（`docs/mabf-poller.md`），而非「读源码字符串做正则断言」的反模式。交付物即文档，可观察契约 = 文档内容，这是文档任务的合法契约锚点（设计 §2.1 已论证），非 PR #540 类伪测试。

### 2. 读写路径一致性

**N/A** — 纯文档新增，无运行时数据源 / 读写闭环。

### 3. 静默失败

**N/A** — 无可执行代码路径。

### 4. 降级方案

**N/A** — 无降级 / fallback 逻辑。

### 5. 极端攻击

**✅ 安全** — 边界已由 SA6 测试覆盖并复跑确认：
- 文档非空（实测 964 字节，远超 0 字节边界）。
- 三条要点的 token 语义（multi-repo / event-watch / dispatch-idle-issue-runner）均在文档中命中，中英冗余表述抵御措辞漂移。
- 复跑 `bash tests/docs_mabf_poller.sh` → **PASS=10 FAIL=0, exit 0, GREEN**（独立进程执行，真实证据）。

### 6. 错误处理

**N/A** — 无分支 / try-catch / 错误状态路径。

### 7. 架构评估

**✅ 可行** — 无架构制约信号。纯文档任务，回滚成本为零（删除文件即可）。

### 8. 过度设计

**✅ 精简** — 交付文档 19 行、964 字节，恰好覆盖三条验收要点 + 契约 token，无多余抽象层。

## 观察项（非阻塞，供 SA6/总控知悉）

1. **工作树存在未提交的 `M wiki/raw/..._dispatch.md`**：diff 显示是流水线 dispatch 日志追加 SA3/SA4 两行（row 6/7 的 phase 记录），属运行时编排元数据，**不在 HEAD commit 内**，不构成 commit-scope 违规。后续若需保留该档案最新态，可由总控决定是否追加 commit；SA4 不要求。
2. **`.mabf-bg/` / `TASK.md` / `tests/` 仍未被 `.gitignore` 覆盖**（`.gitignore` 仅忽略 `.dsh/`）。本次靠 SA3 严格执行 path-scoped add 规约避险，未入库。这是设计 §1 R2 已识别的「.gitignore 漂移」隐患的残留面——当前任务范围内不修（DENY LIST 禁动 `.gitignore`），但建议后续工程任务考虑将 `.mabf-bg/` 纳入忽略，作为深度防御。**不影响本次 verdict。**

## 动态审核重点（交 SA7）

无。本任务为纯文档新增，无运行时行为可动态验证。SA6 shell 验收测试已静态+本地复跑双重确认 GREEN。SA7 可直接采信本报告 verdict=pass，无需动态验证。

如 SA7 仍需做一项确认，建议仅：在外部 `check.sh`（PR 检查）侧复跑 `bash tests/docs_mabf_poller.sh` 确认 exit 0，以及对 `git show --name-only HEAD` 复核 commit 范围——两者均已在 SA4 侧完成。

# SA2 攻击评审报告（R2 复审）

**Date**: 2026-08-18
**Reviewer**: SA2 (Wallfacer)
**Verdict**: pass（R1 CRITICAL 已消除；列出的 R2 新发现为非阻断项，建议 SA1/SA3 落实时修正）

**审查对象**: `wiki/raw/task_docs-add-mabf-multi-repo-monitoring-note-synthetic_design.md`（R2 修订版）
**任务类型**: 功能开发 (feature / docs)
**审查基线**: 任务简报、SA6 红灯测试 `tests/docs_mabf_poller.sh`、R1 评审报告、worktree 实际 git 状态。
**复审重点**: 确认 R1 CRITICAL（path-scoped git add 强制）已消除，并重新以全新视角扫描。

---

## R1 CRITICAL 消除确认（本轮复审核心）

R1 攻击点 #1（CRITICAL）要求三件事，R2 逐条核实如下：

| R1 要求 | R2 落实位置 | 实测验证 | 结论 |
|---|---|---|---|
| (a) 强制 path-scoped `git add`，明令禁止 `-A`/`.`/`-u` | §4.3(a) | 给出唯一允许命令 `git add docs/mabf-poller.md` + `git add wiki/raw/`，并显式标注 `git add -A` / `git add .` / `git add -u` / `git add :/` 四类禁止形式 | ✅ 已消除 |
| (b) §6 显式列入 `.mabf-bg/`、`TASK.md`、`tests/` 为禁止入库 | §4.3(c) 表 + §6 提交入库范围表 | `.mabf-bg/`、`TASK.md` 标「禁止入库」；`tests/docs_mabf_poller.sh` 留在 ALLOW（SA6 owned，符合「SA6 owned 必须进 ALLOW 不得进 DENY」立法）但标注「本地校验脚本，禁止入库」——「不入库」是 commit 维度，与「不准动」维度区分清晰，无立法冲突 | ✅ 已消除 |
| (c) §4.3 验证步骤补断言：`git diff --cached --name-only` ⊆ `{docs/mabf-poller.md, wiki/raw/*}`，`.mabf-bg/`/`TASK.md` 出现即判失败 | §4.3(b) | 新增暂存区断言 shell 片段（case 白名单 + `COMMIT_SCOPE_VIOLATION` exit 2），并补 commit 后 `git show --name-only` 复查 + §6 SA4 比对依据 | ✅ 已消除（断言存在；其实现缺陷见下方攻击点 #4，属新发现非 R1 未达标） |

**worktree 实测复核**（`git status --short`）：`?? .mabf-bg/`、`?? TASK.md`、`?? tests/`、`?? wiki/`，`.gitignore` 仅含 `.dsh/`——与 R2 §1 现状描述完全一致，`.mabf-bg/` 确实未被忽略、确为真实风险源。R2 设计已识别并从源头（path-scoped add）规避。

**R1 CRITICAL 消除判定**：✅ 已消除。path-scoped add（§4.3a）作为主控制从源头保证只有 `docs/mabf-poller.md` 与 `wiki/raw/*` 进入暂存区，不依赖 `.gitignore` 是否覆盖 `.mabf-bg/`。

### R1 其余项确认

| R1 项 | 严重度 | R2 处理 | 实测验证 | 结论 |
|---|---|---|---|---|
| #2 PASS 计数（设计写 `PASS=8`，实际优先分支 10 / 回退 9） | MEDIUM | §2.1 校正非 token 断言计数；§4 step2 改 `PASS=10 FAIL=0`（回退 9），硬门禁 `FAIL=0 && exit 0` | 逐行点算 `tests/docs_mabf_poller.sh` 的 `pass` 调用：目录存在(1)+文件存在(1)+非空(1)+要点1×2+要点2×2+要点3×3 = **10**（优先分支）；回退分支缺「文件存在」那条 = **9**。与 R2 声明一致 | ✅ 已修 |
| #3 跨仓无据断言（§2.2.4 film-studio-fe `verify-docs-*.mjs` C5） | LOW | §2.2 要点 4 删除该括注，改写为「逐条独立 grep，无 token 顺序校验」 | R2 §2.2 已无 film-studio-fe C5 任何字样；全文 `verify-docs` 无残留 | ✅ 已修 |

---

## 全新视角漏洞扫描（R2 新发现）

以第一眼心态重扫 R2 全文，发现一处新问题（非 R1 遗留）：

### 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议（可执行修订要求） |
|---|--------|--------|---------|------|
| 4 | MEDIUM | 暂存区断言实现（§4.3(b)） | §4.3(b) 的断言 shell 片段用 `echo "$staged" \| while read -r f; do ...; exit 2; done`。在 bash 中，**管道右侧的 `while` 循环运行在子 shell 中**，`exit 2` 只退出该子 shell，**不会终止外层脚本**。实测复现：越界文件 `.mabf-bg/sa1.log` 触发了 `COMMIT_SCOPE_VIOLATION` 输出，但脚本继续执行（`PIPED_EXIT=2` 仅是管道末命令退出码，未阻断后续 `git commit`）。即 SA3 若照抄该片段，断言「越界即判失败、中止 commit」的承诺**名存实亡**——这是 SKILL §4 定义的「静默失败」：有输出但无阻断效果。 | 将 `echo "$staged" \| while ... done` 改为 here-string 形式 `while IFS= read -r f; do ...; done <<< "$staged"`（循环留在当前 shell，`exit 2` 即终止脚本）。实测 here-string 变体在同样越界输入下 `FINAL_SCRIPT_EXIT=2` 且后续语句不执行，符合「中止 commit」语义。**非阻断**：主控制 §4.3(a) path-scoped add 已使越界不可能发生，本断言属 defense-in-depth；且 §6 SA4 比对依据提供 post-commit 独立门禁。故仅建议修，不阻断放行。 |

### 其他维度扫描结论（无新发现）

- **竞态/死锁**: N/A（纯文档新增，无并发路径）。
- **缓存/DB 状态撕裂**: N/A（无运行态）。
- **异常输入 Panic**: N/A（无代码执行）。
- **Feature 契约污染**: 本仓库无运行时代码，"现有代码边界"退化为"文件清单边界"。R2 §6 ALLOW/DENY/Commit-Scope 三表一致，`docs/mabf-poller.md` 为唯一交付物，不污染任何现有文件契约。✅
- **token 命中复核**：用 R2 §3.2 骨架文本逐条跑全部 7 个 grep 模式 → **全部命中**；骨架 964 字节，远超 0 字节边界。SA3 按骨架填词即可走优先分支 `PASS=10 FAIL=0`。✅

---

## 协议假设依据审查

- **章节存在性**: ✅ §7「协议假设依据」存在。
- **依据可验证性**: 合格。§7 声明「无协议级假设」，对纯文档新增 + path-scoped git 操作成立——无 HTTP/WS 端点、端口、进程生命周期、第三方库行为或跨 job 资源假设。`git diff --cached --name-only` / `git show --name-only` 为 git 既有行为，可被 SA4 重跑。R1 #3 的跨仓无据断言已删除，§7「无协议级假设」自洽。
- **「应该/通常/预计」类无据推断**: 全文未出现。✅

---

## 错误处理链路审查

本任务为**纯 markdown 文档新增**，无用户交互（无前端按钮/API 调用/异步任务/外部依赖），SKILL §4 的静默失败/状态闭环/降级路径/虚假降级维度**基本不适用**。

- 静默失败: 唯一相关链路是 §4.3(b) 暂存区断言——其「有输出无阻断」的缺陷见攻击点 #4（MEDIUM，非阻断）。
- 状态闭环: N/A（无 `exStatus` 等运行态）。
- 降级路径: N/A（无依赖服务）。
- 虚假降级: N/A（无前提条件分支；§2.2 要点 1「采用建议名命中优先分支」是性能/稳定性优化，非把 bug 当降级）。✅ 无虚假降级嫌疑。

---

## 红线测试思路

### 攻击点 #4（断言子 shell 静默失败）— 红灯 IT 思路

- **场景**：构造越界暂存区（`git add` 了 `.mabf-bg/sa1.log` 或 `TASK.md`），运行 §4.3(b) 断言脚本。
  - 当前（piped-while）实现：脚本输出 `COMMIT_SCOPE_VIOLATION` 但**退出码非 2 的终止语义**（后续 `git commit` 仍执行）→ **红灯**（断言未实际中止）。
  - 修正后（here-string）实现：脚本在第一个越界文件处 `exit 2` 终止，后续 `git commit` 不执行 → 绿灯（断言按承诺中止）。
- **断言点**：`run_assertion; rc=$?; [ $rc -eq 2 ]` 且其后 `git commit` 未被调用（可用 `git rev-list --count HEAD` 前后比对验证 commit 未发生）。
- **落地形式**：SA3 若复用该断言片段，应使用 here-string 形式；或直接由 SA4 post-commit 静态门禁 `git show --name-only HEAD` 集合比对承载（§6 SA4 比对依据已给出命令，独立于本断言）。

### R1 攻击点（commit 范围）— 红灯思路（R2 已堵，留存供 SA4/SA7 复用）

- **场景 A（误提交流水线运行态）**：commit 后断言 `git show --name-only --pretty=format: HEAD` 集合 ⊆ `{docs/mabf-poller.md, wiki/raw/*}`；出现 `.mabf-bg/*` → 红灯。
- **场景 B（误提交 TASK.md / tests/）**：同上断言出现 `TASK.md` 或 `tests/docs_mabf_poller.sh` → 红灯。
- **场景 C（漏提交 wiki 档案）**：docs/ 已提交但 `wiki/raw/*.md` 缺失 → 红灯（简报要求 wiki 随代码一起 commit）。
- R2 §6 SA4 比对依据已给出上述断言命令，可由 SA4 Phase 3 直接承载。

---

## 结论

R1 的 **CRITICAL（path-scoped git add 强制）已实质消除**：§4.3(a) 主控制从源头保证暂存区仅含 `docs/mabf-poller.md` 与 `wiki/raw/*`，不依赖 `.gitignore`；§4.3(c)/§6 将 `.mabf-bg/`、`TASK.md`、`tests/` 一致标注「禁止入库」；§4.3(b) 补了暂存区断言，§6 给出 SA4 post-commit 独立门禁。R1 #2（PASS 计数）、#3（跨仓断言）经实测均已修正。

R2 新发现攻击点 #4（§4.3(b) 断言因管道子 shell 导致 `exit 2` 不阻断脚本）为 MEDIUM 静默失败，但属 defense-in-depth 层缺陷——主控制 §4.3(a) 使越界不可能发生，SA4 post-commit 门禁独立兜底，故**不阻断放行**，建议 SA1/SA3 落实时改用 here-string 形式。

文档内容契约（§2.1/§3.2/§3.3）经逐 token 实测全部命中，可走优先分支 `PASS=10 FAIL=0`。

**Verdict: pass。** `pass` 仅表示设计通过审查，不替代 SA4/SA7 对实现与活链路的验证；SA4 仍须以 §6 比对依据做 post-commit commit-scope 静态门禁，SA7 须验证活链路 `git show` 输出符合允许集合。

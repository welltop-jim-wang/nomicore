# 设计文档 — docs: add MABF multi-repo monitoring note (synthetic e2e test)

- 任务类型: 功能开发 (feature / docs)
- Issue: #1
- 分支: `refactor/docs-add-mabf-multi-repo-monitoring-note-synthetic`
- Worktree: `/home/wangjian/nomicore-refactor-docs-add-mabf-multi-repo-monitoring-note-synthetic`
- 红灯测试: `tests/docs_mabf_poller.sh`（SA6 已写入，exit 1 = 红）
- 修订版本: R2（应 SA2 R1 reject 逐条修订）

---

## 1. 任务类型与范围确认

本任务为 **feature / docs** 类型。交付物是一份纯 markdown 文档 `docs/mabf-poller.md`，
说明 mabf-poller 的多仓库监控能力。**不涉及任何业务源码、测试代码、CI 配置改动**。

仓库现状（合成 e2e 仓库，极简）：
- 仅有 `LICENSE`、`.gitignore`、`TASK.md`，无 `package.json`、无 TS 源码、无测试框架。
- `docs/` 目录已存在但为空（红灯根因）。
- SA6 已写入自包含 shell 验收测试 `tests/docs_mabf_poller.sh`，当前红灯（exit 1）。
- **R2 关键事实**：worktree 当前除 `.gitignore`/`LICENSE` 外**全部为未跟踪状态**。
  `git status --short` 实测输出：
  ```
  ?? .mabf-bg/
  ?? TASK.md
  ?? tests/
  ?? wiki/
  ```
  `.gitignore` 仅忽略 `.dsh/`——**`.mabf-bg/`（流水线后台运行态：`sa1.log`/`sa2.log`/`sa6.log`、
  `*.pid`、`*_cmd.sh`、`*.exit`、`sa6.ts`）既未被忽略、也未在本设计 R0 任何处提及**。
  若 SA3 执行 `git add -A`/`git add .`，会把流水线日志、pid、TASK.md、tests/ 一并提交，
  直接违反简报「仅允许新增 `docs/` 下的 markdown 文件（以及流水线产出的 `wiki/raw/` 档案）」约束。
  本 R2 设计强制 path-scoped commit 规约（见 §4.3）以堵住该漏洞。

## 2. 需求推演（Feature）

新功能与现有代码的边界：本仓库无运行时代码，"现有代码边界"退化为"现有仓库文件清单边界"。
最佳切入点 = 在已存在的空 `docs/` 目录下新增一个 markdown 文件。契约锚点不在运行时行为，
而在**交付文档本身的可观察内容**——即文档必须命中 SA6 红灯测试所断言的 token 语义。

### 2.1 红灯契约逆向（SA6 测试断言逐条映射）

SA6 测试 `tests/docs_mabf_poller.sh` 用 `grep -qi` / `grep -qEi` 对交付文档做内容断言。
设计必须保证文档命中**全部**断言（任一缺失 → 测试 FAIL → 红）。逐条映射如下：

| # | 测试断言（grep 模式） | 模式标志 | 文档必须包含 | 验收标准对应 |
|---|---|---|---|---|
| 1 | `film-studio-fe` | `-qi`（子串，大小写不敏感） | 字面 `film-studio-fe` | multi-repo monitoring |
| 2 | `multi-repo\|multi repo\|多仓库\|多个仓库\|同时监控` | `-qEi`（ERE，大小写不敏感） | 至少其一，建议 `多仓库` + `multi-repo` + `同时监控` 三者皆出（冗余加固） | multi-repo monitoring |
| 3 | `event-watch` | `-qi` | 字面 `event-watch` | event-watch discovery |
| 4 | `discover\|发现\|detect\|新任务\|新事件` | `-qEi` | 至少其一，建议 `发现` + `新任务/新事件` + `discover` | event-watch discovery |
| 5 | `issue-runner` | `-qi` | 字面 `issue-runner` | dispatch to idle issue-runner |
| 6 | `dispatch\|派发\|分发\|调度` | `-qEi` | 至少其一，建议 `派发` + `dispatch` + `调度` | dispatch to idle issue-runner |
| 7 | `idle\|空闲` | `-qEi` | 至少其一，建议 `空闲` + `idle` | dispatch to idle issue-runner |

此外测试还有**非 token 断言**，R2 校正其计数（SA2 攻击点 #2）：
- **存在性（2 条 pass）**：`docs/` 目录存在（pass 1）+ 交付物文件存在（优先分支
  `docs/mabf-poller.md` 命中时 pass 2；回退分支走 `INFO` echo，不产 pass）。
- **边界条件（1 条 pass）**：文档非空（`[ -s "$DOC" ]`，0 字节视为失败）。

**pass 计数结论（R2 校正）**：
- 优先分支（`docs/mabf-poller.md` 存在且命中全部 token）：**目录存在(1) + 文件存在(1) + 非空(1)
  + 要点1×2 + 要点2×2 + 要点3×3 = 10 条 pass**。
- 回退分支（采用替代 `*.md` 文件名）：目录存在(1) + 非空(1) + 要点1×2 + 要点2×2 + 要点3×3
  = **9 条 pass**（文件存在那条降级为 INFO，不产 pass）。
- 本设计采用建议名 `docs/mabf-poller.md`，**走优先分支，期望 `PASS=10 FAIL=0`**。
  SA3 复跑时以 `FAIL=0 && exit 0` 为唯一硬门禁，`PASS=` 数值仅作信息提示。

### 2.2 防御性设计要点

1. **文件名选择**：采用建议名 `docs/mabf-poller.md`，命中测试优先分支（`-f "$DOCS_DIR/mabf-poller.md"`），
   避免落入"替代文档名"回退路径——虽然回退路径也能 PASS，但优先分支消除任何 `ls` 排序不确定性风险，
   并使 pass 计数稳定为 10。
2. **token 冗余**：每个"多选一"断言（#2/#4/#6/#7）都在文档中**同时**给出中英两种表述，
   任一正则分支命中即可，但冗余覆盖抵御 SA3 措辞微调导致的意外漏匹配。
3. **非空保证**：文档正文有实质内容（>200 字节），远超 0 字节边界。
4. **无需防御 token 顺序**：本测试为逐条独立 `grep`，无 token 首现位置 / 顺序校验，
   故无需规避子串抢跑问题。但仍应避免在文档中引入与契约无关的歧义 token。

## 3. 交付文档结构设计

### 3.1 文件路径

```
docs/mabf-poller.md   （新建）
```

### 3.2 文档骨架（伪代码 / 内容规约）

SA3 实现时应产出如下结构的 markdown（措辞可调，但**必须保留方括号标注的契约 token**）：

```markdown
# mabf-poller 多仓库监控说明

mabf-poller 是 MABF 流水线的轮询调度组件。本文档说明其多仓库监控、事件发现与任务派发机制。

## 1. 多仓库监控 (Multi-repo monitoring)

mabf-poller 同时监控 (multi-repo) 多个仓库：除原有的 `film-studio-fe` 外，
现已纳入对本仓库的监控。poller 周期性轮询多仓库监控清单中每个被监控仓库的状态。

## 2. 事件发现 (Event-watch discovery)

mabf-poller 通过 event-watch 机制发现新任务 / 新事件。当被监控仓库产生待处理事件时，
event-watch 负责检测 (detect) 并上报，使 poller 能够及时发现 (discover) 待派发的工作项。

## 3. 任务派发 (Dispatch to idle issue-runner machines)

发现新任务后，mabf-poller 将任务派发 (dispatch) 给空闲 (idle) 的 issue-runner 机器执行。
调度策略确保任务只派发给当前空闲的 issue-runner，避免对繁忙机器重复派发。
```

### 3.3 契约 token 落点核对表

| 断言 # | 落点文本（来自 §3.2 骨架） | 命中 |
|---|---|---|
| 1 | `film-studio-fe` | ✅ |
| 2 | `同时监控` / `multi-repo` / `多仓库` | ✅（三分支冗余） |
| 3 | `event-watch` | ✅ |
| 4 | `发现` / `新任务` / `新事件` / `detect` / `discover` | ✅ |
| 5 | `issue-runner` | ✅ |
| 6 | `派发` / `dispatch` / `调度` | ✅ |
| 7 | `空闲` / `idle` | ✅ |

## 4. 实现步骤（SA3 指引）

1. 新建 `docs/mabf-poller.md`，内容按 §3.2 骨架填写（措辞可润色，保留契约 token）。
2. 复跑红灯测试：`bash tests/docs_mabf_poller.sh`，预期 `PASS=10 FAIL=0`（优先分支）、
   `GREEN`、exit 0。若 SA3 改用替代文件名走回退分支，则期望 `PASS=9 FAIL=0`。
   **硬门禁为 `FAIL=0 && exit 0`，`PASS=` 数值仅作信息提示。**
3. **提交入库范围规约（R2 新增，SA2 攻击点 #1 CRITICAL）**：见 §4.3，强制 path-scoped
   `git add` 并校验暂存区文件集合 ⊆ `{docs/mabf-poller.md, wiki/raw/*}`。
4. 将文档与 wiki 档案一起 commit（简报约束：Wiki 档案必须随代码一起 commit）。

### 4.3 提交入库范围规约 (Commit Scope) — R2 新增

**背景**：worktree 当前除 `.gitignore`/`LICENSE` 外全部未跟踪（`.mabf-bg/`、`TASK.md`、
`tests/`、`wiki/` 均 `??`），且 `.gitignore` 仅忽略 `.dsh/`。若 SA3 执行
`git add -A` / `git add .` / `git add -u`，会把流水线后台运行态、TASK.md、tests/ 一并提交，
违反简报「仅允许新增 `docs/` 下 markdown 文件（及流水线产出的 `wiki/raw/` 档案）」约束，
并把运行态垃圾永久写入仓库历史。本节为强制规约。

**(a) 强制 path-scoped add**：

```bash
# 唯一允许的 add 命令——显式枚举入库路径
git add docs/mabf-poller.md
git add wiki/raw/

# ⛔ 明令禁止以下任一形式：
# git add -A
# git add .
# git add -u
# git add :/
```

**理由**：path-scoped add 从源头保证只有 `docs/mabf-poller.md` 与 `wiki/raw/` 下档案进入暂存区，
不依赖 `.gitignore` 是否覆盖 `.mabf-bg/`（当前未覆盖）。即使未来 `.gitignore` 漂移，本规约仍成立。

**(b) 暂存区断言（提交前必跑）**：

```bash
# 断言暂存区文件集合 ⊆ 允许集合；越界即判失败、中止 commit
staged=$(git diff --cached --name-only)
echo "$staged" | while read -r f; do
  case "$f" in
    docs/mabf-poller.md) ;;
    wiki/raw/*) ;;
    *) echo "COMMIT_SCOPE_VIOLATION: $f 不在允许入库范围"; exit 2 ;;
  esac
done
```

**判定**：
- 暂存区出现 `.mabf-bg/*`（如 `sa1.log`/`sa2.pid`/`sa6_cmd.sh`）、`TASK.md`、
  `tests/docs_mabf_poller.sh` 任一 → **判失败，中止 commit**。
- `docs/` 已暂存但 `wiki/raw/*` 缺失 → **判失败**（简报要求「Wiki 档案必须随代码一起 commit」）。
- commit 后复查命令：`git show --name-only --pretty=format: HEAD` 的输出集合必须
  ⊆ `{docs/mabf-poller.md, wiki/raw/*}`，作为 SA4 静态门禁 `git diff --cached --name-only`
  检查的承载（见 §6 提交入库范围表）。

**(c) 禁止入库项（明示）**：

| 路径 | 性质 | 禁止入库理由 |
|---|---|---|
| `.mabf-bg/` | 流水线后台运行态（日志/pid/cmd/exit/sa6.ts） | 运行态垃圾，与交付物无关；简报仅放行 docs/+wiki/raw/ |
| `TASK.md` | 任务描述文件 | 简报未放行；属任务编排元数据，非交付物 |
| `tests/docs_mabf_poller.sh` | SA6 拥有的本地校验脚本 | 简报仅放行 docs/+wiki/raw/；本测试为**本地流水线校验脚本，不入库**——SA3 在本地复跑验收，但不得 `git add tests/` |
| `.dsh/` | 已被 `.gitignore` 忽略 | 已忽略，双重保险仍不入库 |

## 5. 业务影响评估

- **无运行时影响**：纯新增 markdown 文档，不导入、不执行任何代码。
- **无配置影响**：不改 CI、不改 `.gitignore`、不改任何配置文件。
- **无契约影响**：不修改任何已有文件，不引入函数签名/返回类型变更。
- **回滚成本**：删除 `docs/mabf-poller.md` 即可完全回滚，零副作用。

---

## §6. 文件清单（File Scope）

### ALLOW LIST（本任务允许改动的文件）

- `docs/mabf-poller.md` — 新建，本任务唯一交付文档（覆盖三条要点，命中红灯契约），**入库**
- `tests/docs_mabf_poller.sh` — `[SA6 owned]` 验收红灯测试，SA6 已创建。SA3 不准改断言逻辑；
  仅允许在测试基础设施层做无伤调整（本任务预期无需任何改动）。**本地校验脚本，禁止入库**
  （简报仅放行 docs/+wiki/raw/；SA3 在本地复跑但不 `git add tests/`）。
- `wiki/raw/task_docs-add-mabf-multi-repo-monitoring-note-synthetic_design.md` — 本设计文档（流水线产出档案），**入库**

### DENY LIST（任何 SA 不准动）

- `LICENSE` — 项目许可证，本任务不动
- `TASK.md` — 任务描述文件，本任务不动；且禁止入库（见 §4.3(c)）
- `.gitignore` — git 忽略规则，本任务不动（不依赖修改 `.gitignore` 堵 `.mabf-bg/` 漏洞，改用 path-scoped add 从源头规避）
- 任何 CI 配置文件（本仓库当前无，若未来出现亦不动） — 工程任务范围外
- 任何业务源码 / `package.json` / `pnpm-workspace.yaml`（本仓库当前无） — 本任务为纯 docs，不动

### 提交入库范围 (Commit Scope) — R2 新增

> 独立于 ALLOW/DENY LIST 的「入库」维度。ALLOW LIST 列 SA 可改动的文件，本表列**实际进入 commit 的文件**。
> 「本地存在但不入库」= 该文件在 worktree 中、SA 可读写，但**不得** `git add`。

| 路径 | 入库? | 说明 |
|---|:--:|---|
| `docs/mabf-poller.md` | ✅ | 唯一交付文档 |
| `wiki/raw/*.md` | ✅ | 流水线产出档案（design/dispatch/review 等），简报要求随代码一起 commit |
| `tests/docs_mabf_poller.sh` | ❌ | 本地校验脚本，不入库（SA6 owned，SA3 本地复跑验收） |
| `.mabf-bg/` | ❌ | 流水线后台运行态，禁止入库 |
| `TASK.md` | ❌ | 任务描述，禁止入库 |
| `.dsh/` | ❌ | 已被 `.gitignore` 忽略 |
| `LICENSE` / `.gitignore` | ❌ | 已跟踪且本任务不动 |

### SA4 比对依据（R2 新增）

SA4 Phase 3 静态评审执行（针对 commit 后的暂存/HEAD）：
```bash
git show --name-only --pretty=format: HEAD | sed '/^$/d' | sort > /tmp/actual-committed.txt
# 允许集合 = {docs/mabf-poller.md, wiki/raw/*}
# 任何 actual 里出现 .mabf-bg/ / TASK.md / tests/ → SA4 reject，标 commit-scope-violation
```
- 实际 commit 含 `.mabf-bg/`、`TASK.md`、`tests/` 任一 → **reject**（commit 范围越界，违反简报约束）。
- `docs/` 已提交但 `wiki/raw/` 缺失 → **reject**（简报要求 wiki 档案随代码一起 commit）。

---

## §7. 协议假设依据 (Protocol Assumption Evidence)

无协议级假设：本设计仅涉及**纯文档新增**（新建一个 markdown 文件）+ path-scoped git add，
不涉及任何 HTTP/WS 端点、端口占用、进程生命周期、第三方库行为或跨 job 资源假设。
验收方式为 shell `grep` 对文档内容做字面 token 断言，已通过 §2.1 逐条映射落实到文档骨架。
`git diff --cached --name-only` / `git show --name-only` 为 git 既有行为，无假设风险。

---

## §8. 契约改动连锁审计 (Contract Change Caller Audit)

无契约改动：本设计仅涉及**新增 markdown 文件** + path-scoped git 操作，不修改任何已有函数、
不改变任何函数签名或返回类型、不新增 throw 路径、不改变同步/异步契约。无 caller 受影响。

---

## SA2 反馈逐条回应（R2 修订）

对应 SA2 评审 `wiki/raw/task_docs-add-mabf-multi-repo-monitoring-note-synthetic_sa2_review.md`（R1 verdict=reject）。
逐条落实如下，每条均有实质改动（非「承认但不改」）。

| SA2 要求 | 严重度 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|:--:|---|---|
| #1 强制 path-scoped `git add`，明令禁止 `git add -A`/`.`/`-u` | CRITICAL | ✅ | §4.3(a) | 新增「提交入库范围规约」小节，给出唯一允许的 `git add docs/mabf-poller.md` + `git add wiki/raw/` 命令，显式标注四类禁止形式（`-A`/`.`/`-u`/`:/`） |
| #1 §6 DENY LIST 显式列入 `.mabf-bg/`（流水线后台运行态）与 `TASK.md`、`tests/` | CRITICAL | ✅ | §4.3(c) 表 + §6 提交入库范围表 | `.mabf-bg/`、`TASK.md`、`tests/docs_mabf_poller.sh` 均标注「禁止入库」及理由；DENY LIST 补 `TASK.md`（不动且不入库），`tests/` 因 SA6 owned 留在 ALLOW 但标注「本地校验脚本，禁止入库」 |
| #1 §4.3 验证步骤补断言：`git diff --cached --name-only` ⊆ `{docs/mabf-poller.md, wiki/raw/*}`，`.mabf-bg/`/`TASK.md` 出现即判失败 | CRITICAL | ✅ | §4.3(b) | 新增暂存区断言 shell 片段（case 白名单 + `COMMIT_SCOPE_VIOLATION` exit 2），并补 commit 后 `git show --name-only` 复查 + SA4 比对依据 |
| #2 §4.2 期望值对齐为实际 `PASS=10`（优先分支 10 / 回退分支 9），同步修正 §2.1 非 token 断言计数 | MEDIUM | ✅ | §4 step2 + §2.1 | §2.1 把「两条非 token 断言」校正为「存在性 2 条 pass（优先分支）+ 边界 1 条 pass」并给出 10/9 计数推导；§4 step2 期望改为 `PASS=10 FAIL=0`（回退分支 9），明确硬门禁为 `FAIL=0 && exit 0` |
| #3 §2.2.4 跨仓断言（film-studio-fe `verify-docs-*.mjs` C5 trace-chain-order）无据，删除括注或补可定位引用 | LOW | ✅ | §2.2 要点 4 | 删除该括注。R2 §2.2 要点 4 改写为「本测试为逐条独立 `grep`，无 token 首现位置/顺序校验，故无需规避子串抢跑问题」，不再断言另一仓库测试行为，消除跨仓无据假设 |

### 一致性自检（R2）

- 全文搜索 `PASS=8`：R2 已无残留，§4 step2 与 §2.1 均改为 10（回退 9）。
- 全文搜索 `git add -A`/`git add .`：仅出现在 §4.3(a) 的「禁止」标注中，不存在于任何「执行」指令。
- `.mabf-bg/`：在 §1 现状、§4.3(b)/(c)、§6 提交入库范围表、§6 SA4 比对依据 中一致标注「禁止入库」，无矛盾。
- `tests/docs_mabf_poller.sh`：ALLOW LIST 标 `[SA6 owned]` + 「禁止入库」，§4.3(c) + §6 提交入库范围表一致，不与 SKILL 立法「SA6 owned 测试必须进 ALLOW、不得进 DENY」冲突（留在 ALLOW，未进 DENY；「不入库」是 commit 维度而非「不准动」维度）。
- 跨仓断言：R2 已删除，§7「无协议级假设」成立。

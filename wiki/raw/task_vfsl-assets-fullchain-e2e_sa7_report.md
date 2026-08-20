# SA7 动态验证报告 — vfs3.assets 全链路端到端编排测试（issue #32）

**Date**: 2026-08-20（本地验证真实运行 12:22:25 起，后台独立进程）
**Verdict**: **pass**（活链路本地全绿 + 触发连通性本地实证 + 分支侧 TASK.md 卫生闭环；CI 侧 run log 摘录**环境阻塞**——分支未 push、PR 未建，属外部 issue-runner 职责，SA7 禁止代办 push/建 PR，阻塞取证与补录处方见「vitest 触发证据」节与文末移交清单。SA7 不宣称 CI 已绿）

- 验证对象：交付物 `packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts`（16 用例 / 4 describe / 298 行，import 仅 `../src/index.js` 公共导出，纯消费者）+ 三层活链路（parseVfsl #9 → evaluate #28 → validateSnapshot #21）
- 前置门禁：SA4 R2 Final Verdict = **pass**（`task_vfsl-assets-fullchain-e2e_sa4_review.md:4` / `:135`）
- 方法：全部验证命令按测试执行规范起 `setsid nohup` 后台独立进程，完整日志 `/tmp/sa7-issue32.log`；本票纯 vitest 无端口依赖，按「默认保留未知进程」未执行盲 `fuser -k` 清场
- 运行面：node v24.13.0 / pnpm 10.28.2 / vitest v3.2.7（本地 node 与 CI matrix 24 腿同族；node 20 腿属 CI 侧待验项）

---

## Step 0 — SA4 verdict 校对（2026-06-13 立法）

```
[SA7 Step 0 结论]
SA4 verdict: pass（R2 Final Verdict，回滚 8e511ae 闭环后翻绿）
操作: 进 Step 1
```

## Step 1 — SA6 验收锚运行（本票即验收锚；真实输出摘录）

本票为纯测试收官票，SA6 记录已明示「红灯语义 = 验收锚本身」（16 条断言锚定可观测运行时行为，任一三层契约面回归即红）。SA7 后台独立进程第三方复现，四段全部 exit 0：

| 段 | 命令 | 真实输出（log 原文摘录） | exit |
|---|---|---|---|
| 收集性 | `pnpm vitest list packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts` | 16 用例全枚举（AC1×2 / AC2×5 / AC3×1 / AC4×8，describe 标题逐条可见） | 0 |
| 单文件 | `pnpm vitest run packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts` | `✓ packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts (16 tests) 33ms` / `Test Files 1 passed (1)` / `Tests 16 passed (16)` | 0 |
| 全量 | `pnpm test` | `Test Files 15 passed (15)` / `Tests 341 passed (341)`（含本文件 16 tests 行，基线 325 + 16，零回归） | 0 |
| 类型 | `pnpm typecheck` | `tsc -p packages/vfsl/tsconfig.json` 无输出 | 0 |

```
[SA7 Step 1 结论]
SA6 验收锚: 🟢 GREEN（16/16、341/341、typecheck 0——与 SA6/SA4 双方记录逐值一致，本报告为独立第三方复现）
操作: 进入 Step 2
```

## Step 2 — SA4 动态审核重点逐条验证

### 重点 #1 CI 触发证据（§1.4 联动，必检）→ ⏸ 环境阻塞 + 本地补偿实证

**阻塞取证（三条独立探针，2026-08-20 12:2x 实跑，可复现）**：

| 探针 | 命令 | 结果 |
|---|---|---|
| 远端分支 | `git ls-remote --heads origin \| grep issue-32` | **空**（远端仅有 adr/union-representation 与 issue-19/20/21/29 分支，无 `fix/issue-32-on-adr-union-representation`） |
| PR 存在性 | `gh pr list --state all --limit 15` | 15 条全列（#2…#31），**无** head 为本分支的 PR；#17 为 parent PR（head=`adr/union-representation` → main） |
| CI run | `gh run list --branch fix/issue-32-on-adr-union-representation` | **空**；近 10 条 run 全属其他分支（#21×3、#29、#20、parent 分支等，均 success） |

→ 分支未 push、PR 未建，CI run 不存在。push/建 PR 由外部 issue-runner/check.sh 负责（简报明文「总控与 SA 一律禁止自行创建 PR / push」），SA7 权限外，**非交付物缺陷**。

**本地补偿实证（与 CI job 步骤逐字同命令——SA7 实读 `.github/workflows/ci.yml` 核对）**：

- workflow 实况：`on: pull_request`（全 PR 触发，PR 建立即跑）；job `test`，matrix `node: [20, 24]`，`fail-fast: false`；步骤序 `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm test`
- `pnpm test`（≡ CI「Test」步骤，根级裸调用无 `--filter`/`--project`）→ 341/341，log 含 `✓ packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts (16 tests) 37ms`
- `pnpm typecheck`（≡ CI「Typecheck」步骤）→ exit 0
- `vitest list` 16/16 收集（触发连通性的动态证据，非 config 推断）
- 版本面：本地 node v24.13.0 与 matrix 24 腿同族；node 20 腿未本地复现（零新增依赖下漂移面趋零，留 CI 侧终验）

**判定**：触发连通性 **pass**（收集级 + 同命令执行级双证）；CI run log 摘录**待 PR 建立后补录**（处方见「移交总控」）。

### 重点 #2 PR diff 卫生（阻断项闭环终验，必检）→ ✓ 分支侧闭环（PR 侧待建后终验）

- `gh pr diff` 当前不可执行（PR 不存在，同上）——转为分支侧活证据 + blob 级复核：
- `git diff --name-only origin/adr/union-representation HEAD` = **7 文件**：交付物测试文件 ×1 + `wiki/raw/task_vfsl-assets-fullchain-e2e*.md` ×6；`grep -E '^TASK\.md$'` **零命中**（与 SA4 R2 ① 一致）
- **blob 级**：`git rev-parse HEAD:TASK.md` = `db2d979d3bfe6aca82af25a8d936d5e1a1201f2c` ≡ `origin/adr/union-representation:TASK.md` 同 hash（**字节级同一 blob**）；`git status --porcelain TASK.md` 为空（worktree 无漂移）
- BLACKLIST 复扫（`^TASK\.md$` / package-lock.json / yarn.lock / .DS_Store / *.bak 五模式 × 7 diff 文件）= **0 命中**

**判定**：分支侧 TASK.md 净零复写，PR 建立后 diff 结构上不可能携带（7 文件集合封闭）；runner 侧重注入防线按 SA4 R2 预设留待 PR 建立后 `gh pr diff` 终验（见移交清单第 2 条）。

### 重点 #3 CI 环境绿灯与全量数核对（可选）→ ⏸ 同 #1 阻塞；本地全量数已复现

CI 全量数（预期 341/341）待 run 存在后核对；本地值已由 SA7 独立复现（SA6 / SA4 / SA7 三方逐值一致：16/16、341/341、exit 0）。

## Step 3 — E2E spec 触发证据

**N/A**：分支 diff 7 文件中无任何 `*.spec.ts`（上节文件清单实证），门禁不适用（SA4 §1.3 同判）。

## vitest 触发证据 (verdict 升级 — 2026-06-15)

CI Run: **不存在**（环境阻塞——重点 #1 三探针；本票 push/PR 属外部 issue-runner/check.sh 职责，SA7 按 CLAUDE.md 边界禁止代办）

| Workspace Package | CI Step Name | 触发结果 | 证据摘录 |
|---|---|---|---|
| `@nomicore/vfsl` | Test（`pnpm test`，matrix node 20/24 两腿） | ⏸ `ci-run-not-created`（**非** 🔥 not-triggered） | CI 侧：无 run 可摘录。本地同命令补偿：`✓ packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts (16 tests)` / `Test Files 15 passed (15)` / `Tests 341 passed (341)`；收集性 `vitest list` 16/16 |

**verdict**: ✅ **触发连通性成立**（vitest list 实跑收集 16 用例 + 根 config 裸 `pnpm test` 无 filter + 与 CI 步骤逐字同命令的本地执行全绿）/ ⏸ **CI run log 摘录待补**（PR 建立后按下方处方执行，SA7 届时可再派补录）

**分类说明（不标 🔥 的理由）**：`vitest-package-not-triggered` 的立法语义（issue #289 事故形态）是「CI run 存在但 workspace package 被 filter 漏掉」。本仓 CI 为根级单 job 裸 `pnpm test`（无 `--filter`/`--project`，SA4 §1.4 已静态核 + SA7 实读 ci.yml 复核），该形态不成立；当前是**根本没有 CI run**（外部时序阻塞），属 CLAUDE.md「区分本地验证、CI 验证与环境阻塞」中的第三类，如实标注移交，不以 FAIL 误报交付物缺陷。

## 补充 / 破坏性测试决策：未新增（有意为之）

1. 本票交付物本身即测试（全链路编排验收锚，16 用例覆盖简报全部 6 条 AC），SA4 R1/R2 九维审核**未提出任何覆盖缺口**；
2. 简报边界明令「不重复单点覆盖」（解析单点属 #9、校验器单点属 #21）；
3. 破坏性/资源攻击面（fuzz 烟雾、截断上限、预算耗尽 fail-closed、深栈 RangeError 收编、lookMemo 稀疏物化钳制）已由既有 `parse-vfsl-sa7-supplementary.test.ts`（8 用例）与 `validate-snapshot-sa7.test.ts`（14 用例）覆盖，本次全量运行全绿（log 原文在场）。

## 移交总控（环境阻塞处置处方）

外部 issue-runner push 分支并建 PR 后：

1. **CI 触发证据补录（SA4 重点 #1 / 本报告 vitest 节的待办）**：
   ```bash
   gh run list --branch fix/issue-32-on-adr-union-representation --limit 3
   # 对 node 20 与 node 24 两条 matrix 腿各摘录一次（job 名形如 "test (20)" / "test (24)"）：
   gh run view <run-id> --log --job "test (20)" 2>&1 | grep -E "vfsl-assets-fullchain-e2e|Test Files.*passed|Tests.*passed" | head -20
   ```
   预期锚：`✓ packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts (16 tests)`、`Test Files 15 passed (15)`、`Tests 341 passed (341)`；缺任一锚 → 届时按 `vitest-package-not-triggered` 升级 FAIL。
2. **PR diff 终验（SA4 重点 #2 收尾，防 runner 侧重注入）**：`gh pr diff <PR-num> | grep -E '^TASK\.md$'` 预期为空。
3. 如需 SA7 出具含 run-url 的补录报告，再派一次即可——本处方即完整操作清单。

## 结论

1. **活链路全绿**：同一 §10 fixture 文本驱动 parseVfsl → evaluate → validateSnapshot 三层串联，16/16 通过；全量 341/341 零回归；typecheck exit 0——全部为后台独立进程真实输出，与 SA6/SA4 记录逐值一致。
2. **SA4 三条动态重点**：#2 分支侧闭环实证（TASK.md blob 级同一 + blacklist 0 命中 + 7 文件集合封闭）；#1/#3 的 CI 侧摘录属**环境阻塞**（分支未 push / PR 未建，三探针取证），已用「CI 步骤逐字同命令本地执行 + vitest list 收集级」双证补偿，阻塞原因与补录处方移交总控。
3. SA7 未独立发现任何 fail；SA4 pass 维持不下调。

**Verdict: pass**（CI 侧证据链待 PR 建立后按处方补录，不影响本 verdict 对交付物与活链路的判定）

— SA7 Dynamic Verifier，2026-08-20

# SA7 动态验证报告 — validateSnapshot → validateLogicalSnapshot 更名迁移

**Date**: 2026-08-22
**Verdict**: **pass**（本地动态验证 + 双 Node CI 步骤仿真全绿；G4「真实 CI run」证据阻塞于 commit 未 push——已登记待总控 push 后补证，非缺陷信号）
**被测对象**: commit `06d6796`（worktree HEAD，未 push；基线 `ee3643c`）
**任务类型**: refactor（深度重构·纯更名迁移）· Phase 3
**上游门**: SA4 verdict **pass**（`task_rename-validate-logical-snapshot_sa4_review.md` L4，Step 0 独立读取确认）

---

## 执行环境与方法声明

- 全部测试命令均以独立进程执行（`setsid nohup … & disown`，技能规范）；本任务为纯 vitest 单测，**无服务端口依赖，`fuser` 清场不适用**（精确归属判断，未盲清任何端口/进程）。
- 双 Node 覆盖策略：host **node v24.13.0**（Job A）+ docker `node:20-slim` **v20.20.2**（Job B，忠实复刻 ci.yml 步骤序列：`CI=true` 环境变量、pnpm 经 PATH 可见、同 `pnpm@10.28.2`——与根 `packageManager` 精确一致，即 CI `pnpm/action-setup` 实际安装的版本）。
- 阅读量：6 个文件（简报 / SA4 报告 / design / ci.yml / 探针测试 / vitest.config.ts），未超 15 文件上限。

## Step 0 / Step 1 结论（技能两关）

```
[SA7 Step 0 结论]  SA4 verdict: pass → 进 Step 1（不存在洗白：SA4 reject 时本报告不得为 pass）
[SA7 Step 1 结论]  SA6 红灯探针: 🟢 GREEN（29/29 转绿）→ 进入 Step 2
```

Step 1 证据（原 29/29 红灯文件，显式单跑，D12 纪律形态）：

```
$ pnpm exec vitest run packages/vfsl/test/validate-logical-snapshot.test.ts --passWithNoTests=false
 ✓ packages/vfsl/test/validate-logical-snapshot.test.ts (29 tests) 4589ms
 Test Files  1 passed (1)
      Tests  29 passed (29)      G3A_EXIT=0
```

红灯对账（design §5）：AC1（新名 typeof function）、AC2（旧名 `toBeUndefined`）与 27 条共享行为断言全部由「新名可用」单因素转绿——探针文件本票零改动（commit 内纯新增 484 insertions / 0 deletions，`git diff ee3643c..06d6796` 实证）。

## 独立验证证据（命令 + 结果）

### Job A — host node v24.13.0 · pnpm 10.28.2（G1→G3b + CI 附加步骤 + frozen-lockfile）

| 门/步骤 | 命令 | 结果 |
|---|---|---|
| **G1 白名单全仓门** | `git grep -n "validateSnapshot" -- ':!wiki' ':!docs/adr' ':!TASK.md' ':!CONTEXT.md' ':!.scratch' ':!.scratch*' ':!packages/vfsl/test/validate-logical-snapshot.test.ts' ':!packages/vfsl/test/validate-logical-snapshot.contract.ts'` | **零输出（G1_EXIT=1）** ✓ |
| **G2 静态指纹门** | `grep -n "整份 JSON 快照校验" packages/vfsl/src/index.ts` | **零输出（G2_EXIT=1）** ✓ |
| **G3a 探针显式单跑** | `pnpm exec vitest run packages/vfsl/test/validate-logical-snapshot.test.ts --passWithNoTests=false` | **Test Files 1 passed (1) / Tests 29 passed (29) / exit 0** ✓ |
| **G3b-1 全量** | `pnpm test` | **Test Files 47 passed (47) / Tests 669 passed (669) / exit 0**；运行清单含 `✓ packages/vfsl/test/validate-logical-snapshot.test.ts (29 tests) 8419ms` ✓ |
| **G3b-2 类型** | `pnpm typecheck` | **exit 0**（五包 tsc 链零诊断）✓ |
| CI 步骤 ci.yml L43-44 | `pnpm exec vitest run packages/persistence/test/persistence-contract.test.ts --typecheck --passWithNoTests=false` | **7 passed / exit 0** ✓ |
| CI 步骤 ci.yml L48-49 | `pnpm exec vitest run packages/vfsl/test/domains-scaffold.test.ts --passWithNoTests=false` | **2 passed / exit 0** ✓ |
| CI 步骤 ci.yml L55-56 | `pnpm generate --check` | **exit 0** ✓ |
| **SA4 动态重点 #2** | `pnpm install --frozen-lockfile` | **exit 0**（`Done in 362ms using pnpm v10.28.2`）——version bump 0.1.10→0.2.0 下 lockfile 无冲突 ✓ |

日志：`/tmp/sa7-host.log`（逐步 `_EXIT=` 标记：1/1/0/0/0/0/0/0/0，九门全过）。

### Job B v2 — docker node:20-slim v20.20.2 · pnpm 10.28.2（corepack）· `CI=true`（CI node:20 matrix leg 忠实仿真）

| ci.yml 对应步骤 | 容器内命令 | 结果 |
|---|---|---|
| L32-33 Install | `pnpm install --frozen-lockfile` | **N20_INSTALL_EXIT=0** ✓ |
| L35-36 Typecheck | `pnpm typecheck` | **N20_TYPE_EXIT=0** ✓ |
| L38-39 Test | `pnpm test` | **Test Files 47 passed (47) / Tests 669 passed (669) / N20_TEST_EXIT=0**；运行清单含 `✓ packages/vfsl/test/validate-logical-snapshot.test.ts (29 tests) 8700ms` ✓ |
| （D12 纪律本地 leg） | `pnpm exec vitest run packages/vfsl/test/validate-logical-snapshot.test.ts --passWithNoTests=false` | **Tests 29 passed (29) / N20_PROBE_EXIT=0** ✓ |
| L55-56 regen-diff | `pnpm generate --check` | **N20_GEN_EXIT=0** ✓ |

容器整体退出码 0。日志：`/tmp/sa7-node20v2.log`（ANSI 剥离版 `/tmp/sa7-node20v2-clean.log`）。

**更名半径内 7 个迁移测试文件在两个 Node leg 下逐一全绿**（node20 实录）：`validate-snapshot.test.ts (35)` / `validate-snapshot-sa7.test.ts (14)` / `validate-patch.test.ts (36)` / `validate-patch-sa7.test.ts (22)` / `docscope-guards.test.ts (6)` / `vfsl-assets-fullchain-e2e.test.ts (16)` / `evaluate-derived-schema.test.ts (37)`——design §2.2「既有绿基座全绿」的零回归承诺在双 Node 下动态成立。

### 环境伪红归因记录（区分本地验证 / CI 验证 / 环境阻塞）

Job B v1 首跑出现 12 个失败（5 文件），逐一定位归属后确认**全部为容器环境伪红，非代码回归**，已在 v2 修正复跑全绿：

| v1 现象 | 精确归属 | 处置 |
|---|---|---|
| `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` install exit 1 | 容器缺 `CI=true`（真实 GHA 恒设该变量）——pnpm 交互确认被拒，非 lockfile 冲突 | v2 注入 `CI=true` → install exit 0 |
| 12 个 CLI-spawn 测试失败（`expected null to be +0`，DSH 探针/pnpm generate 端到端，均属 vfsl-codegen/dsh-persistence 域，**不在本票改动半径**） | 容器内 `pnpm` 不在 PATH → 子进程 spawn status null | v2 加 `/tmp/ci20home/bin/pnpm` corepack shim → 47/47 文件全绿 |
| 参照系 | 同一批测试 host node24 全绿（Job A）+ node20 v2 全绿 | 双向印证伪红结论 |

v1 期间的独立有效信号：探针 29/29 绿、typecheck exit 0（即使在伪红环境中，更名相关面无恙）。未知进程零清理：v1 容器自行结束，无残留（`docker ps` 复核为空）。

### 收尾健全性检查

容器重建 node_modules 后 host 复跑探针：**Tests 29 passed (29) / exit 0**（`/tmp/sa7-post-host-probe.log`）；`git status` 仅余两个 wiki 流程产物（dispatch.md 修改 + sa4_review.md 新增），生产/测试代码零扰动、untracked 为零。

## SA4「动态审核重点」逐条闭环

### 1. AC4 CI 证据 —— 🟢 本地等价证据补齐 / 🔶 真实 CI run 阻塞于未 push（登记）

- **阻塞事实**：`git ls-remote origin refs/heads/fix/issue-71-on-docs-doc-runtime-validation` 空输出、本地分支 `ahead 1` → commit `06d6796` 确未 push。SA7 无 push/建 PR 权责，**不宣称 CI 已绿**。
- **本地等价证据（本报告上节）**：ci.yml 全部六个执行步骤在 node 24（host）与 node 20（容器忠实仿真）双 leg 全绿——matrix 两元的每一步（install/typecheck/test/两个显式 vitest 步骤/regen-diff）均有 exit 0 实录。
- **push 后待补清单（交总控，push + PR 后执行）**：

```bash
gh run list --branch fix/issue-71-on-docs-doc-runtime-validation --limit 5     # 取 run id
gh run view <run-id> --log --job=test --matrix 2>/dev/null || gh run view <run-id> --log
# 门 1：node [20, 24] 两个 matrix job 全绿
# 门 2（D12 原文要求）：Test 步骤日志含
#   ✓ packages/vfsl/test/validate-logical-snapshot.test.ts (29 tests)
#   Tests  29 passed (29)   ← 原文贴入本报告补遗或 PR 描述
```

### 2. `pnpm install --frozen-lockfile` + version bump —— 🟢 GREEN（双 leg 实跑）

- host（node24/pnpm10.28.2）：exit 0，`Done in 362ms`。
- node20 容器（CI 忠实形态）：`N20_INSTALL_EXIT=0`。
- 结论：`0.1.10 → 0.2.0` bump 与 lockfile 零冲突——与 SA4 静态分析（`workspace:*`/`link:` 无版本锚）动态互证。SA4 预期「仅形式确认」成立。

### 3. R8 残留持续防护 —— 📌 登记（沿用 SA4 结论，无新增动作）

- 现状：CI 无探针专用 `--passWithNoTests=false` 步骤（ci.yml 改动超本票 ALLOW LIST）；根 `vitest.config.ts` `passWithNoTests: true` 实读复核，R8 威胁模型在案。
- 本票防护（证据纪律）：G3a 显式单跑双 leg 各一次（29 passed × 2）+ 全量运行清单双确认。探针被删/漏收集时，本报告形态的显式单跑会响亮 exit 1。
- 建议（超出本票半径，仅登记）：后续任何触及 CI 的任务，为 `packages/vfsl/test/validate-logical-snapshot.test.ts` 补专用步骤，对齐 ci.yml L43-49 persistence-contract / domains-scaffold 先例。

## Spec 触发证据（Step 3 立法 — 2026-06-09）

**触发条件不成立**：本任务 SA1 design 无任何新增/改动的 `*.spec.ts` 文件（SA4 结论 10 同向；全量 47 文件均为 vitest `*.test.ts`）。**本节不适用，无 E2E runner 触发性检查项。**

## vitest 触发证据（Step 4 立法 — 2026-06-15）

**触发条件成立**：design §10 含新增/改动的 `*.test.ts`（SA6 探针 `validate-logical-snapshot.test.ts` 新入库 + 7 个迁移测试文件），workspace package = `@nomicore/vfsl`。

| Workspace Package | CI Step Name | 触发结果 | log 摘录 |
|---|---|---|---|
| @nomicore/vfsl | Test (`pnpm test`, ci.yml L38-39) | 🔶 **CI run 不存在（commit 未 push）→ 无法在 CI log 中分类；本地等价证据全绿** | 本地 node24：`✓ packages/vfsl/test/validate-logical-snapshot.test.ts (29 tests) 8419ms`；本地 node20 容器：`✓ …(29 tests) 8700ms` |

- **本地触发机制证据**：根 `vitest.config.ts` include 实读 = `packages/*/test/**/*.test.ts`（探针被根收集器覆盖）；`pnpm test` 双 leg 运行清单均含探针文件行——「vitest package 未触发」在本地不存在任何迹象。
- **分类裁定**：`vitest-package-not-triggered` 判定需要 CI run log 作为判据；CI run 因未 push 不存在，属**环境阻塞**而非未触发证据。不据此判 FAIL；真实 CI 分类待 push 后按上节待补清单执行（届时本表更新为 `✓/⚠/❌/🔥` 四类之一）。

## 破坏性/补充性测试新增

**零新增**——SA6 Phase 1 双文件（探针 29 条 + 共享断言集 27 条）已完整覆盖更名验收（AC1/AC2）与行为零回归（issues 语义/资源预算/纯函数/零写入/E100/截断边界），本票动态验证复用该套件即可完备定性；额外测试无增量信息面。既有 7 套件迁移断言零改动（SA4 机械等价证明 + 本报告双 Node 全量 669 绿动态背书）。

## 结论

| 维度 | 判定 |
|---|---|
| SA4 verdict 校验 | pass（Step 0 读取确认） |
| SA6 红灯转绿 | 🟢 29/29（host）+ 29/29（node20 容器），AC1/AC2/27 条行为断言全绿 |
| 设计 §6 四门独立重跑 | 🟢 G1 零输出 / G2 零输出 / G3a 29 passed / G3b 669 passed + 五包 typecheck 0 |
| CI 步骤序列（双 Node leg 仿真） | 🟢 node24 + node20 各六步 exit 0（install --frozen-lockfile 含 0.2.0 bump） |
| 更名半径内测试面 | 🟢 7 迁移文件双 Node 逐一全绿，零回归 |
| 真实 CI run（G4） | 🔶 阻塞于未 push——本地双 leg 等价证据补齐，push 后待补清单已交总控 |
| 伪红排查纪律 | 🟢 12 处容器伪红逐项归因（缺 CI=true / PATH 缺 pnpm），v2 修正后全绿，未盲清任何进程 |

**Verdict: pass** —— 更名迁移在真实运行链路（双 Node 版本 × 全 CI 步骤序列 × 显式探针单跑）下零回归；SA4 三条动态重点中 #2 双 leg 闭环、#3 登记在案、#1 的本地等价证据补齐、真实 CI 证据缺口按权责边界（SA7 不 push）移交总控 push 后补录。未发现任何 SA4 静态审未见的缺陷信号。

# SA7 动态验证报告 — materializeRoot 修订轮 rev1（PR #84 owner Review 闭环）

**Date**: 2026-08-22
**Verdict**: **pass**
**验对象**: commit `638ad949ec1924504362ec2595b361d87afefb0d`（638ad94，分支 fix/issue-74-on-docs-doc-runtime-validation，已 push origin）
**Worktree**: /home/wangjian/nomicore-fix-issue-74
**上游输入**: SA4 静态验尸 pass（`wiki/raw/task_doc-runtime-materialize-root-rev1_sa4_review.md`，2026-08-22）
**CI Run**: https://github.com/welltop-jim-wang/nomicore/actions/runs/32579701331（pull_request #84，headSha=638ad949，completed success）

---

## Step 0 — SA4 verdict 校对

```
SA4 verdict: pass（sa4_review.md 顶部 L4）
操作: 进 Step 1
```

## Step 1 — SA6 锚定门禁本地动态复现（独立后台进程）

- **命令**：`pnpm exec vitest run packages/doc-runtime/test/materialize-root.test.ts --typecheck --passWithNoTests=false`（`setsid nohup` 后台独立进程，/tmp/sa7-mat.log）
- **结果**：`✓ packages/doc-runtime/test/materialize-root.test.ts (60 tests)` / `Test Files 1 passed (1)` / `Tests 60 passed (60)` / `Type Errors no errors` / **exit 0**
- **红灯→绿灯闭环**：SA6 首锚记录（简报 L108-114）为 `5 failed | 55 passed`（⑤ verifyInstall 未实现，5 个 R1 E201 用例红）；commit 638ad94 后本地 60/60 + CI 双腿 60/60 全绿——红灯确已转绿，且失败点正是本轮生产变更的行为面。
- 端口/进程：本轮测试为纯内存 Yjs 单测，无端口监听；`fuser -k 8000/8081/3005` 预清理执行（无占用输出，无未知进程被杀）。

## Step 2 — SA4「动态审核重点」逐条验证

### 重点 1：CI 触发证据（Materialize root tests 步骤在双腿真实执行）— ✅

Run 32579701331（headSha 精确匹配本轮 commit）双 job 摘录（`gh run view --log --job=<id>`）：

| Job | 步骤名 | log 原文摘录 |
|---|---|---|
| test (20)（job 97047112686） | Materialize root tests | `Run pnpm exec vitest run packages/doc-runtime/test/materialize-root.test.ts --typecheck --passWithNoTests=false` → `✓ packages/doc-runtime/test/materialize-root.test.ts (60 tests)` → `Test Files 1 passed (1)` / `Tests 60 passed (60)` / `Type Errors no errors` |
| test (24)（job 97047112821） | Materialize root tests | 同命令 → `Tests 60 passed (60)` / `Type Errors no errors` |

### 重点 2：全量回归 820 用例口径双腿绿灯 — ✅

| Job | 步骤 | log 原文摘录（/tmp/sa7-ci20.log L316-318、/tmp/sa7-ci24.log L310-311） |
|---|---|---|
| test (20) | Test | `Test Files 57 passed (57)` / `Tests 820 passed (820)` / `Type Errors no errors` |
| test (24) | Test | `Test Files 57 passed (57)` / `Tests 820 passed (820)` / `Type Errors no errors` |

后续门禁步骤 Persistence contracts（1 passed）与 Domain scaffolds check（1 passed）双腿亦绿；PR #84 statusCheckRollup `test (20)`/`test (24)` 均 SUCCESS。

### 重点 3（可选）：R-7 前提可运维性观察 — 登记不动作

按 SA4 原文登记：若后续 ADR-0006 create 流程将 materializeRoot 包进外层事务，SA6 的 T-1 characterization 用例即红灯——属设计预警（JSDoc 前置条件段已明文「事务必须是最外层事务」），非本轮缺陷，SA7 无需动作。

## Step 2.5 — SA7 独立活链路探针（临时文件 `packages/doc-runtime/test/sa7-probe-rev1.test.ts`，验证后已删除）

独立于 SA6 断言向量：独立 fixture（三键混合 ROOT：`title: YLeaf<string>` / `meta: YMap<{version, tags[]}>` / `body: YXmlFragment`）、独立错误消息、模拟真实 Runtime 调用方视角直接驱动生产入口。

**命令**：`pnpm exec vitest run packages/doc-runtime/test/sa7-probe-rev1.test.ts --typecheck --passWithNoTests=false`（后台独立进程，/tmp/sa7-probe.log）
**结果**：`Tests 8 passed (8)` / `Type Errors no errors` / **exit 0**

| 探针 | 验证面（活链路） | 结果 |
|---|---|---|
| PRB-1 正向基线 | 无 observer → ok:true + 恰 1 update + 恰 1 observer 回调 + extractYjsSnapshot 全量语义比较（meta toEqual 含 Y.Array 顺序、body normalizeXml）+ revalidate ok | ✓ |
| PRB-2 | observer delete 中间计划键 `meta` → throw `DOCRT-E201`；残留：meta 缺席、title/body 保留（不回滚、不补偿）；update ≥1（首事务已提交） | ✓ |
| PRB-3 | observer overwrite 计划键 → `DOCRT-E201`；残留 title==='PWNED'（doc 保持 observer 实际状态） | ✓ |
| PRB-4 | 组合向量 delete `title` + insert `extra`（root.size 3===3 相等而身份破坏）→ `DOCRT-E201`——size 单查必漏、身份断言兜底（G5 双断言必要性） | ✓ |
| PRB-5 | 身份级保守：delete `meta` + 重插 deep-equal 异实例 plain object → 仍 `DOCRT-E201`（检测基准 === 非语义等价，R-8） | ✓ |
| PRB-6 | RAC-2 原子性：unknown 位 Date 先证 `validateLogicalSnapshot ok:true` → materialize ok:false + 恰 1 issue + 0 update + `encodeStateAsUpdate` 字节不变 | ✓ |
| PRB-7 | RAC-3 定谳：`<p title='a"b'>x</p>` 逻辑校验通过但 materialize 拒（恰 1 issue + 零写入）——validator/materializer 接受域差异被测试锁定非事故 | ✓ |
| PRB-8 | AC-6 回归：observer 抛独有消息 `'sa7-boom-7734'` → 原样 toThrow 传播（非 E200/E201 包装、排除字符串匹配巧合）+ update ≥1 + title 值不回滚 | ✓ |

## Step 2.6 — 门禁破坏性验证（RAC-6 有效性，防删除/防未收集声称的活证据）

- **操作**：临时 `mv` 移走 `materialize-root.test.ts` → 后台跑 CI 同款门禁命令 → 恢复（/tmp/sa7-gate.log）。
- **结果**：`No test files found, exiting with code 1` → **gate exit = 1**（`--passWithNoTests=false` 真实拦截测试文件丢失，门禁非摆设）。
- **恢复无损证明**：复跑门禁 `Tests 60 passed (60)` + `Type Errors no errors`（/tmp/sa7-restore.log）；`git status --porcelain packages/` 空输出——SA6 测试文件与生产代码零改动，探针临时文件已删除，worktree 干净。

## Step 3 — E2E spec 触发证据

不适用：本任务设计（rev1_design.md R2）无新增/改动 `*.spec.ts`（Playwright E2E）；SA4 review 无 `spec-not-triggered` 字段。本任务验收面为 vitest 单元/集成测试，由 Step 4 覆盖。

## Step 4 — vitest 触发证据（verdict 升级 — 2026-06-15 立法）

CI Run: https://github.com/welltop-jim-wang/nomicore/actions/runs/32579701331

| Workspace Package | CI Step Name | 触发结果 | log 摘录 |
|---|---|---|---|
| doc-runtime（materialize-root 专项） | Materialize root tests（test (20)，job 97047112686） | ✓ 60 tests passed | `✓ packages/doc-runtime/test/materialize-root.test.ts (60 tests)` / `Tests 60 passed (60)` / `Type Errors no errors` |
| doc-runtime（materialize-root 专项） | Materialize root tests（test (24)，job 97047112821） | ✓ 60 tests passed | `Tests 60 passed (60)` / `Type Errors no errors` |
| doc-runtime（全量回归承载） | Test（双腿） | ✓ 820 tests passed | `Test Files 57 passed (57)` / `Tests 820 passed (820)` / `Type Errors no errors` |

**verdict**: ✅ all-vitest-packages-triggered（设计 §11 所列 `packages/doc-runtime/test/materialize-root.test.ts` 在 CI runner 列表真实出现、真实执行、双腿全绿）

---

## rev1 RAC 逐条动态确认

| RAC | 动态证据 | 结论 |
|---|---|---|
| RAC-1（P1） | SA6 R1 组（CI 60/60 内含）+ SA7 探针 PRB-2/3/4/5：delete/overwrite/insert/组合/身份级保守五向量均 `DOCRT-E201` 响亮失败，残留状态与「不回滚、不补偿」逐键断言一致 | ✅ |
| RAC-2（High） | SA6 R2 十行矩阵（CI 绿）+ 探针 PRB-6 独立复证 Date 支路：validate ok:true 先证 → ok:false + 恰 1 issue + 0 update + state 字节不变 | ✅ |
| RAC-3（High） | SA6 R3 表驱动 25 行（CI 绿）+ 探针 PRB-7 独立锁定 attr-`"` 接受域差异定谳 | ✅ |
| RAC-4（Medium） | SA6 R4 用例 A/B/C（CI 绿）+ 探针 PRB-1 独立 extract 全量语义比较 + revalidate | ✅ |
| RAC-5（Low） | SA6 U13 收紧（CI 绿）+ 探针 PRB-8 独有消息原样传播（排除匹配巧合） | ✅ |
| RAC-6（建议） | CI「Materialize root tests」步骤双腿存在且通过 + SA7 破坏性验证 exit 1（门禁有效） | ✅ |

## 复验命令（SA7 已执行，可复制重跑）

```bash
WT=/home/wangjian/nomicore-fix-issue-74
# 1. 本地门禁（SA6 锚定 60 用例）
cd $WT && pnpm exec vitest run packages/doc-runtime/test/materialize-root.test.ts --typecheck --passWithNoTests=false
#    → Tests 60 passed (60) / Type Errors no errors / exit 0
# 2. CI 侧 vitest 触发证据（run headSha 必须等于本轮 commit 638ad949…）
gh run list --branch fix/issue-74-on-docs-doc-runtime-validation --limit 6 --json databaseId,headSha
gh run view 32579701331 --log --job=97047112686 | grep -E "Materialize root tests|Tests  "
gh run view 32579701331 --log --job=97047112821 | grep -E "Materialize root tests|Tests  "
# 3. 门禁破坏性（移走测试文件 → exit 1 → 恢复 → 60/60）
# 4. SA7 探针（临时 sa7-probe-rev1.test.ts，8 用例，已删除）
```

## 环境与边界说明

- 所有测试均经 `setsid nohup` 后台独立进程执行（立法合规），exit code 经落盘文件核对。
- CI 双腿为 GitHub-hosted runner（node 20/24）；本地动态证据为同命令复现，二者结论一致。
- SA7 未修改任何生产代码与既有测试；仅新增临时探针与破坏性验证脚本，均已完成清理（git status packages/ 空输出）。
- Node 20 deprecation annotation（pnpm/action-setup@v4）为仓库既有 CI 环境提示，与本轮变更无关。

---

**最终判定：pass** —— SA6 锚定门禁 60/60（本地 + CI 双腿）、全量回归 820/820（双腿）、SA7 独立活链路探针 8/8（RAC-1/2/3/5 独立复证 + 正向基线）、RAC-6 门禁破坏性验证有效（exit 1）；无未触发、无静默跳过、无环境阻塞。SA4 verdict=pass 基础上 SA7 独立验证未发现任何 fail。

**Verdict: pass** —— 修订轮 rev1 动态验证收口（RAC-1~RAC-6 全 ✅，可交总控收尾）

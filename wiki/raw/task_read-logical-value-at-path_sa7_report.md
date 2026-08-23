# SA7 动态验证报告 — readLogicalValueAtPath（issue #75）

**Date**: 2026-08-22
**验证对象**: SA3 commits `02cb596`（readLogicalValueAtPath 实现）+ `87ec9c3`（F2 崩溃边界守卫）
**上游状态**: SA4 R2 轮终审 **pass**（F1/F2 闭环；本文 Step 0 校验通过）
**SA7 verdict**: **pass（本地动态验证全绿；CI 触发证据因分支未推送无法采集——环境阻塞，非实现缺陷，附本地 CI 同款命令等效证据）**

---

## Step 0 — SA4 verdict 校验（硬门禁）

`wiki/raw/task_read-logical-value-at-path_sa4_review.md` L4：`Verdict: pass（R2 轮终审）`（R1 reject 已由 F1/F2 闭环消除）→ 满足 SA7 进入条件，进 Step 1。

```
[SA7 Step 0 结论]
SA4 verdict: pass（R2 终审）
操作: 进 Step 1
```

## Step 1 — SA6 红灯测试复跑

**命令**：`pnpm exec vitest run packages/doc-runtime/test/read-logical-value-at-path.test.ts packages/doc-runtime/test/read-logical-value-at-path.test-d.ts --typecheck`（独立进程 setsid 后台执行）

```
 ✓ packages/doc-runtime/test/read-logical-value-at-path.test.ts (20 tests) 40ms
 ✓  TS  packages/doc-runtime/test/read-logical-value-at-path.test-d.ts (3 tests)
 Test Files  2 passed (2)
      Tests  23 passed (23)
Type Errors  no errors
```

```
[SA7 Step 1 结论]
SA6 红灯: 🟢 GREEN（Phase 1 构造性红灯已按冻结契约全数转绿）
操作: 进入 Step 2
```

## Step 2 — SA4 动态审核重点逐条验证（5/5）

### 重点 1 — F2 修复复验（非数组 path 重放）✅

**方法**：SA7 独立探针（不复用 SA4 脚本，独立重写；`tsx` 直跑，运行后已删），覆盖 SA4 全部 10 变体并新增 2 个变体（`function`、`BigInt 1n`）+ 2 个合法对照：

| 变体 | 结果 | 归类 |
|---|---|---|
| `null` / `undefined` | 结构化返回，message `DOCRT-E100: 内部错误（意外异常）…` | C3（Phase A `segs.length` 抛 → catch 收编） |
| `42` / `'zz'` / `Symbol` / `true` / `{}` / `{length:2}` / `Set` / `Map` / `1n` | 结构化返回 C1「路径不被 schema 允许」，path 归一 `[]` | C1（N2 字符拆分怪异回显同步消化） |
| `function`（`length=0`） | 结构化返回，message `DOCRT-E100: … fullPath is not iterable` | **C3——额外实证 read.ts L306 `[...fullPath]` 抛点位于 try 链内被顶层 catch 收编**（「收编者自身无抛点」闭环的活体证据） |
| 对照 `['title']` / `['nope']` | `ok:true "v"` / `PATH_NOT_ALLOWED(["nope"])` | 正常语义零回归 |

**总计 14/14 结构化返回、零外抛**（探针 exit 0；任何外抛都会使探针以非零退出）。

**持久化**：F2 守卫此前仅由 SA4 运行后即删的探针覆盖、已提交测试面零锚——SA7 已将其钉为持久回归测试（见「SA7 测试产物」），28/28 绿 + tsc exit 0。

### 重点 2 — CI 触发证据 ⚠ 环境阻塞（附本地等效证据）

- `gh pr list --head fix/issue-75-on-docs-docs-runtime-validation` → `[]`（无 PR）
- `gh run list --branch fix/issue-75-on-docs-docs-doc-runtime-validation` → 空（无 run）；分支未推送（`git status -sb`：ahead 2，tracking `origin/docs/doc-runtime-validation`）
- SA7 职责边界不含 push/建 PR → **CI 动态门禁证据无法采集，判定为环境阻塞而非 spec-not-triggered/vitest-package-not-triggered**（静态门禁 SA4 §1.3/§1.4 已 pass）
- **本地等效动态证据**（与 ci.yml Test 步逐字同款命令 `pnpm test` = `vitest run --typecheck`）：exit 0，**57 文件 / 789 用例全绿 + Type Errors none**，三文件执行行原文摘录：

```
 ✓  TS  packages/doc-runtime/test/read-logical-value-at-path.test-d.ts (3 tests)
 ✓ packages/doc-runtime/test/read-logical-value-at-path.test.ts (20 tests) 40ms
 ✓ packages/doc-runtime/test/read-logical-value-at-path-supplementary.test.ts (14 tests) 24ms
```

（SA7 扩展该文件后复跑全量见「最终回归」——28 用例版本同样全绿。）

### 重点 3 — SUP-2 时间护栏稳定性（SA4 N4）✅

**命令**：supplementary 文件连续 10 轮 vitest run（独立进程循环）。

**结果**：**10/10 轮全绿**；SUP-2 两个 `<2000ms` 断言所在文件每轮整体耗时 **14–16ms**（26 层构造 + 两次全路径判定含在内），护栏预算边际 **>100×**——与 SA4 预判一致（memo 版毫秒级），慢 runner 上无 flake 风险。

### 重点 4 — N3 演进警戒（memo 先写后验模式）✅（现状安全，警戒已入档）

- 动态面：read.ts 当前 `grep -c 'try {'` = **1**（仅 L46 顶层 try/catch），**无任何分支级 try/catch** ——污染 memo 无第二次消费机会，N3 描述的「无限循环挂起」在当前代码不可达。
- 本轮 F2 探针的 `function` 变体走的就是「首次 throw 冒泡 → 顶层 catch 终止整次调用」路径，实测无挂起。
- 警戒条款已由设计 §4.3「演进警戒」段（design.md L326）与 read.ts L216 注释双入档；SA4 要求的「后继引入分支级 try/catch 前必须先改造两解析器为链验证后写 memo」对后继任务有效。**无动作项。**

### 重点 5 — 活链路 1/n 成本冒烟（可选项，预演）✅ 方向成立

**方法**：`big: Record<string, YLeaf<string>>` 子树分别 100 / 2000 / 20000 键，同 doc 上各 30 轮取中位数，对比 `readLogicalValueAtPath(['meta','title'])`（小目标子树）vs `extractYjsSnapshot`（全树）：

| big 规模 | read 中位数 | extract 中位数 | read/extract |
|---|---|---|---|
| 100 键 | 0.007ms | 0.059ms | 11.2% |
| 2000 键 | 0.013ms | 1.116ms | 1.15% |
| 20000 键 | 0.019ms | 9.663ms | **0.20%** |

read 成本平坦（0.007→0.019ms，随目标子树而非全树），extract 随规模线性（164×增长）——**「读取成本与目标子树规模相关」（AC6）的强方向性实证**；每轮 read 结果与 extract 投影 `.meta.title` 逐字相等（行为交叉锚同过）。当前零业务 caller，NamespaceRuntime 落地后的高频路径实测仍归后继任务（SA4 原文即「待 NamespaceRuntime 落地后验证」）。

## Step 3 — E2E spec 触发证据：**N/A**

本任务 SA6 产出为 `*.test.ts` + `*.test-d.ts`，两 commit diff 中 `*.spec.ts` 计数 = **0**（`git diff --name-only 44156db..HEAD | grep -cE '\.spec\.ts$'` → 0）；SA4 §八同判「无 E2E spec」。E2E 动态门禁不适用。

## Step 4 — vitest 触发证据（verdict 升级项）

**触发条件成立**（任务新增 `*.test.ts` ×2 + supplementary ×1，均 `packages/doc-runtime` workspace）。

| Workspace Package | CI Step Name | 触发结果 | log 摘录 |
|---|---|---|
| doc-runtime | Test（`pnpm test`） | ⚠ **CI run 不存在（环境阻塞）**——分支未推送、无 PR、无 run；**本地同款命令 ✓ 全绿** | 本地：`✓ …read-logical-value-at-path.test.ts (20 tests)` / `✓ …supplementary.test.ts (14 tests)`（SA7 扩展后 28） / `✓ TS …test-d.ts (3 tests)`；`Tests 789 passed (789)`、`Type Errors no errors`、exit 0 |

**verdict**: ❗ **ci-not-observable（环境阻塞）**——不判 `vitest-package-not-triggered`（该判定要求「spec 在 runner 列表内未被触发」，而本分支根本没有 runner 列表可查）。**建议总控**：push 分支/建 PR 后由后继轮（或总控）对 ci.yml Test 步 job log 复核三文件执行行；静态门禁（根 vitest.config.ts `include: packages/*/test/**/*.test.ts` + `typecheck.include: *.test-d.ts` 直覆盖）与本地同款命令双绿已构成当前可得的最强证据。

## SA7 测试产物

- **`packages/doc-runtime/test/read-logical-value-at-path-supplementary.test.ts`**（设计 §11 ALLOW LIST 明示 SA4/SA7 owned，SA3 不编写）：追加 **「SA7 F2 守卫回归锁」describe（14 用例）**——11 类型外 path 变体（`null`/`undefined`/`42`/`'zz'`/`true`/`{}`/array-like/`Set`/`Map`/`1n`/`function`）结构化返回 + path 归一 `[]` 且调用不被包裹（外抛即测试红）；null/undefined → `DOCRT-E100:` C3 前缀；合法对照零回归。文件由 14 → **28 用例**，`vitest --typecheck` 28/28 绿 + `tsc -p packages/doc-runtime/tsconfig.json` exit 0。
- 临时探针（`sa7-f2-replay.tmp.mts` / `sa7-cost-smoke.tmp.mts`）运行后已删除，worktree 无残留（`git status` 仅 supplementary 一处测试改动 + 先前 wiki 档案）。
- 未修改任何生产代码（`packages/*/src/**` 零触碰）。

## 最终回归（SA7 扩展测试入库形态）

`pnpm test`（与 ci.yml Test 步同款）：**57 文件 / 803 用例全绿 + Type Errors none，exit 0**；supplementary 执行行 `✓ … (28 tests)`。全 doc-runtime/vfsl 基线（extract 48/48）零回归。

## 验证证据索引（命令 + 结果）

| # | 验证 | 命令 | 结果 |
|---|---|---|---|
| 1 | SA6 红灯复跑 | `pnpm exec vitest run …read-logical-value-at-path.test.ts …test-d.ts --typecheck` | 23/23 绿，exit 0 |
| 2 | F2 独立重放（12 变体+2 对照） | `tsx packages/doc-runtime/sa7-f2-replay.tmp.mts`（已删） | 14/14 结构化返回零外抛；null/undefined→C3；function→C3（L306 收编实证）；exit 0 |
| 3 | 全量（CI 同款） | `pnpm test` | 57 文件 / 789 用例全绿 + type errors none，exit 0 |
| 4 | 三文件触发行摘录 | `grep -E "read-logical-value-at-path" <全量日志>` | test (20) / supplementary (14) / test-d (3) 三行齐全 |
| 5 | SUP-2 稳定性 | supplementary ×10 轮 vitest run | 10/10 绿，每轮 14–16ms（护栏 <2000ms，边际 >100×） |
| 6 | N3 现状 | `grep -n 'try {' packages/doc-runtime/src/read.ts` | 仅 1 处（L46 顶层），无分支级 try/catch |
| 7 | 1/n 成本冒烟 | `tsx …sa7-cost-smoke.tmp.mts`（已删） | read 平坦 0.007→0.019ms；extract 0.059→9.663ms；20k 键时比值 0.20%；投影逐字相等；exit 0 |
| 8 | SA7 扩展锚 | `vitest run …supplementary.test.ts --typecheck` + `tsc -p packages/doc-runtime` | 28/28 绿；tsc exit 0 |
| 9 | 最终全量 | `pnpm test`（扩展后） | 57 文件 / 803 用例全绿 + type errors none，exit 0 |
| 10 | CI 可观察性 | `gh pr list --head <branch>` / `gh run list --branch <branch>` / `git status -sb` | `[]` / 空 / ahead 2（未推送）——CI 证据环境阻塞 |

## 结论

**SA7 verdict: pass。**

- SA4 R2 终审 pass 的基础上，动态验证 5/5 全绿：F2 守卫独立复验 14/14 结构化零外抛（并落为持久回归锚）、SUP-2 护栏 10/10 无 flake（边际 >100×）、N3 现状安全无动作项、1/n 成本方向实证、SA6 冻结契约 23 用例全绿。
- SA7 未发现任何 SA4 静态结论的反例（无权亦无依据下调 pass）。
- 唯一未闭环项：**CI 触发证据环境阻塞**（分支未推送、无 PR）——非实现缺陷，本地 CI 同款命令 803 用例全绿为最强可得证据；push/建 PR 后的 CI log 复核归总控/后继轮。

**Verdict**: pass（总体裁决重申——动态验证全绿；Step 4 ci-not-observable 为 CI 触发证据采集的环境阻塞子项，非实现缺陷，待 runner push 后复核）

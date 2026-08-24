# SA7 动态验证报告

**Date**: 2026-08-24
**Verdict**: **pass（本地动态验证面全绿；CI 触发证据环境阻塞——见「Spec/vitest 触发证据」节，交总控 push 后补核）**
**被验对象**: SA3 实现 commit `6cb6f17`（`fix/issue-90-on-docs-namespace-runtime`）
**运行环境**: 本 worktree `/home/wangjian/nomicore-fix-issue-90`；Node v24.13.0（= CI 矩阵 24 腿）；pnpm vitest v3.2.7
**前置**: SA4 verdict `pass`（静态验尸报告顶部核读）

---

## Step 0 — SA4 verdict 校对

```
[SA7 Step 0 结论]
SA4 verdict: pass
操作: 进 Step 1
```

## Step 1 — SA6 红灯测试复跑（第二关）

```
[SA7 Step 1 结论]
SA6 红灯: 🟢 GREEN
操作: 进入 Step 2
```

**命令**（独立进程后台运行，per 技能测试执行规范）：

```bash
pnpm exec vitest run \
  packages/namespace-runtime/test/runtime-mutate-root-sequencer.test.ts \
  packages/namespace-runtime/test/runtime-mutate-root-persistence.test.ts \
  packages/namespace-runtime/test/runtime-mutate-root-snapshotter-array.test.ts \
  packages/doc-runtime/test/public-surface-guard.test.ts \
  packages/doc-runtime/test/public-surface-type-guard.test-d.ts --typecheck
```

**结果**: `Test Files 5 passed (5) / Tests 24 passed (24) / Type Errors no errors / exit 0`
（3 个 SA6 冻结锚文件 19 用例 + 2 个 doc-runtime 守卫 5 用例全部转绿——SA3 实现兑付全部验收锚。）

## Step 2 — SA4 动态审核重点逐条验证（清单驱动）

SA4 列 5 条动态审核重点。验证载体：新增补充测试文件
**`packages/namespace-runtime/test/runtime-mutate-root-sa7-dynamic.test.ts`**（4 用例，公共接缝驱动，断言面 = 结果联合 / read / getStatus / update 事件计数 / state 字节 / notifier 计数 / Proxy 输入访问计数）。

**命令**: `pnpm exec vitest run packages/namespace-runtime/test/runtime-mutate-root-sa7-dynamic.test.ts --typecheck`
**结果**: `Test Files 1 passed (1) / Tests 4 passed (4) / Type Errors no errors / exit 0`

| # | SA4 动态重点 | SA7 用例 | 动态证据（真实运行链路） | 判定 |
|---|---|---|---|---|
| 1 | notifier 挂住双窗口（§6.2 #8） | DV-1a（S6 成功路径）+ DV-1b（fatal committed:true 路径） | 见下「双窗口摘录」 | ✅ 停滞而非静默跳过/降级，双窗口行为均锁定 |
| 2 | O1：adapter 持续抛错下 getStatus 读面 throw 与 runtime.read 并存 | DV-2 | 见下「O1 摘录」 | ✅ 与 #89 既有 loud-throw 契约一致并存 |
| 3 | Node 20/24 CI 矩阵（AC10 动态面） | — | **环境阻塞**（见「Spec/vitest 触发证据」节） | ⛔ 交总控（本地 Node 24 腿已绿） |
| 4 | 深嵌套栈溢出收编（200k 层） | DV-4 | 见下「栈溢出摘录」 | ✅ 本机 Node 24 复跑收编成立（CI Node 20 腿待 push 后补核） |
| 5 | 跨实例持久化 round-trip（AC10） | SA6 冻结锚复跑（verbose 摘录） | 见下「round-trip 摘录」 | ✅ 实际运行证据已摘录 |

### 双窗口摘录（重点 1）

- **DV-1a S6 成功路径挂住**（never-resolve notifier 注入）：
  live commit 已发生（update 事件恰 1 次、notifier 恰一次被调用）→ 槽停滞（pA 200ms+320ms 观察窗永 pending）→ 同 tick 排队的 pB **永 pending（不结算）**、输入 Proxy 零访问、零额外 Y.Doc 写 → `read(['n'])` 照常观察到已提交值 9 → `status.fatal === null`、`rootWrite.enabled === true`（**停滞 ≠ 降级，无静默 skip/disabled 结算**）。✅
- **DV-1b fatal committed:true 路径挂住**（observer 逃逸触发 + never-resolve notifier）：
  `status.fatal`（code `NSRT-FATAL-WRITE-INTERNAL`）在 rejection **永不送达**的前提下可观测（markWriteFatal 同步先行兑现）；pA 永 pending；提交值保留（`read(['n']) === 9`，不虚假回滚）；best-effort notifier 恰一次（挂住的那次）；pB **因队列停滞（非 S1 gate）不结算**——与正常通道（notifier 正常 resolve 时后续写经 gate 结算 `RUNTIME_WRITE_DISABLED`，SA6 冻结锚已覆盖）形成行为对照。✅

### O1 摘录（重点 2）

handle.getStatus() 持续抛错（构造 V2 门放行后 flip）→ 写槽统一 fatal：`RuntimeWriteFatalError`、`committed:false`、`phase:'write-slot-internal'`、message 含「getStatus() 抛错」；0 notifier / 0 update / state 字节不变。随后：

- 公共 `runtime.getStatus()` → **原样 throw**（`/adapter-boom/` 断言命中——#89 既有 loud-throw 读面契约，非本任务缺陷，SA4 定性确认）；
- `runtime.read(['n'])` → 照常返回 1（读取保留，读面不经 handle adapter）；
- 队列不毒死：后续写取得槽、经 S1 fatal gate 结算 `{ok:false}` + `RUNTIME_WRITE_DISABLED`、输入零访问、零写入。✅

### 栈溢出摘录（重点 4，Node v24.13.0）

200,000 层嵌套 plain 数组输入 → snapshotter 递归 `RangeError` 被 `snapshotMutation` try/catch **收编为 ok:false**（issue message 含 `MUTATION_INPUT_NOT_PLAIN_DATA`），非 Promise rejection、非进程崩溃；0 update / state 字节不变 / 0 notifier；**fatal 不置位、`rootWrite.enabled === true`**；后续有效写 `SET_N(42)` → `ok:true`、`read(['n']) === 42`、notifier 恰 1 次。防「深嵌套 → 永久关写」DoS 在 Node 24 复跑成立。✅（SA4 要求的 CI Node 腿复跑属重点 3 同一环境阻塞面。）

### round-trip 摘录（重点 5）

```bash
pnpm exec vitest run packages/namespace-runtime/test/runtime-mutate-root-persistence.test.ts --reporter=verbose
```

```
✓ ... > AC10 幸福链路：Runtime 写 → saveDoc 登记 → flush → 全新 Persistence 实例 loadDoc 观察到写入值（跨实例持久化） 98ms
✓ ... > AC7 + AC10 degraded 全链：gate 通过后降级 → 写照常提交并登记 → 后续写被拦 → retry 覆盖 → 全新实例看到该写 24ms
Test Files 1 passed (1) / Tests 2 passed (2) / exit 0
```

MemoryPersistence 全新实例 loadDoc 读到写入值（含 degraded 全链 retry 覆盖后的跨实例可见性）——AC10 实际运行证据摘录完毕。✅

## Spec 触发证据（Step 3 — E2E）

**不适用**：本任务为 pnpm workspace 纯库开发（`packages/*`），SA1 设计与 SA6 冻结锚均无 `*.spec.ts` / Playwright E2E 文件。Step 3 触发条件不满足。

## vitest 触发证据（Step 4 — 2026-06-15 立法）

触发条件满足（本任务新增/改动 5 个 `*.test.ts` 文件），但 **CI 证据不可得——环境阻塞**：

| 事实 | 证据 |
|---|---|
| 分支未 push | `git branch -vv` → `fix/issue-90-on-docs-namespace-runtime ... [origin/docs/namespace-runtime: ahead 1]` |
| 远端无同名分支 | `git ls-remote origin 'refs/heads/fix/issue-90*'` → 空 |
| 无 PR / 无 CI run | `gh pr list` / `gh run list --branch fix/issue-90-on-docs-namespace-runtime` → 均空 |

CI Run: **N/A（无 run 可摘录）**

| Workspace Package | CI Step Name | 触发结果 | log 摘录 |
|---|---|---|---|
| namespace-runtime | Test（`pnpm test`） | 🔥 **CI 未运行（环境阻塞：未 push/无 PR）** | 无 run log |
| doc-runtime | Test（`pnpm test`） | 🔥 同上 | 无 run log |

**verdict**: ❌ **CI 触发证据缺失（环境阻塞，非 spec-not-triggered）**——SA7 无 push/建 PR 权责（角色边界），交总控：push 分支 + 开 PR 后，以 `gh run view --log` 对 `Typecheck` / `Test`（Node 20/24 矩阵）摘录 vitest/tsc 触发证据补核。

**静态互补证据（本地实跑）**：

- `vitest.config.ts` include `packages/*/test/**/*.test.ts` 收集全部任务测试文件——本地全量实跑收集 79 文件（含本任务 3 个 SA6 文件 + SA7 补充文件 + 2 个 doc-runtime 守卫），无 per-package filter 黑洞；
- CI `pnpm test`（= `vitest run --typecheck`）对 test 文件类型错误的拦截被 SA7 **动态自证**：本报告首版补充测试存在一处 TS 窄化缺陷（`'pending' 不可赋给 '"resolved" | "rejected"'`），全量 `pnpm test` 即以 `Errors 1 error` + `ELIFECYCLE Test failed`（exit 1）拦截——修复（测试侧）后复跑 exit 0。typecheck 通道真实咬合，非摆设。

## 全量回归（SA7 产出并入后）

| 命令 | 结果 |
|---|---|
| `pnpm test`（全量，含 SA7 补充 4 用例） | **79 文件 / 1050 用例全绿，Type Errors 无，Errors 无，exit 0**（1046 基线 + SA7 4 用例） |
| `./node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit` | **exit 0**（SA2 红线 #1 门，含新增测试文件） |
| `pnpm typecheck`（七包串联） | **exit 0** |

## 产出文件

| 文件 | 内容 |
|---|---|
| `packages/namespace-runtime/test/runtime-mutate-root-sa7-dynamic.test.ts` | SA7 补充动态测试 4 用例（DV-1a/DV-1b/DV-2/DV-4） |
| `wiki/raw/task_namespace-runtime-write-sequencer_sa7_report.md` | 本报告 |

生产代码（`src/`）零改动；既有冻结测试零触碰。

## 交总控事项（非 SA7 可闭环）

1. **push + PR + CI 触发证据补核**（重点 3 / Step 4 环境阻塞面）：CI 矩阵 Node 20/24 的 `Typecheck`/`Test` step log 摘录仍缺；
2. **SA4 O4 复核仍成立（升级为 SA7 实测确认）**：`git status` 显示 3 个 SA6 测试文件 + 本 SA7 测试文件 untracked、2 个 doc-runtime 守卫测试 modified 未提交——SA3 commit `6cb6f17` 只含 8 个 src/package.json 文件。**若 PR 不携带测试文件，全部冻结锚 + SA7 补充锚都不进 CI**（正是 Step 3/4 立法防的「spec 存在但永不触发」失败模式）。总控收尾提交时必须将 6 个测试文件（含本 SA7 文件）随 PR 提交。

## 结论

SA4 五条动态审核重点中可本地验证的 4 条（1/2/4/5）全部以真实运行链路证据 ✅ 通过；第 3 条（CI 矩阵）与 Step 4 CI 触发证据属环境阻塞（分支未 push、无 PR、无 CI run），已如实分类并给出补核路径。SA6 红灯测试全绿，全量回归 1050 用例 + 双通道 typecheck exit 0 零回归。**本地动态验证面：pass。**

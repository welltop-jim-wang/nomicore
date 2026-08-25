# SA7 动态验证报告 — replaceSchema provided-root 静默投影偏差修复（issue #91 round 2 / rev1 实现）

**Date**: 2026-02-20（round 2 修订轮，动态验证阶段）
**Verdict**: **pass**
**被验对象**: SA3 未 commit 工作树实现（`git diff HEAD`：schema-replace.ts / schema-write.ts / CONTEXT.md / 两 package.json bump）+ SA6 已暂存测试修订（sa7-dynamic / sequencer 两文件）
**输入**: `task_namespace-runtime-replace-schema-rev1.md`（简报 7 条验收 + 红灯锚定要求）、`_sa4_review.md`（Verdict: pass，末尾「动态审核重点」三节）
**方法**: 全部测试命令后台独立进程实跑（`setsid nohup … & disown`，日志落 `/tmp/sa7-*.log`）；对抗锚以临时测试文件验证后删除（零生产代码触碰、零残留）。

---

## Step 0：SA4 verdict 校对

- `wiki/raw/task_namespace-runtime-replace-schema-rev1_sa4_review.md` 顶部：**`Verdict: pass`** → 进入动态验证（SA7 不存在「下发」路径）。

## Step 1：SA6 红灯测试复跑（红→绿实证）

### 绿（当前修复态，独立后台进程）

```bash
setsid nohup bash -c 'cd <worktree> && ./node_modules/.bin/vitest run --no-typecheck \
  packages/namespace-runtime/test/runtime-replace-schema-sa7-dynamic.test.ts \
  packages/namespace-runtime/test/runtime-replace-schema-sequencer.test.ts' &
# → Test Files 2 passed (2) | Tests 22 passed (22) | SA7_EXIT=0   （/tmp/sa7-step1-targeted.log）
```

### 红（SA7 独立复现——临时回退生产文件至 HEAD 投影版）

`git stash push -- packages/doc-runtime/src/schema-replace.ts`（仅该文件回到 round-1 投影实现）→ 同命令 `-t "R2-1"` 过滤实跑 → `git stash pop`：

```bash
# → packages/.../runtime-replace-schema-sa7-dynamic.test.ts (9 tests | 1 failed | 8 skipped)
#    × R2-1 顶层未声明键 … AssertionError: expected { ok: true } to match object { ok: false }
#    ❯ runtime-replace-schema-sa7-dynamic.test.ts:461:27
#    RED_EXIT=1 ； POP_EXIT=0 ； diff stat 复原（20 insertions / 63 deletions）
```

- **R2-1 红→绿闭环成立**：同一测试在旧代码（投影在）精确红于 `:461` 的 `ok:false` 断言、在修复态全绿——与 SA6 红灯记录（简报 §红灯实跑证据）逐字吻合，且红态由 SA7 独立复现，非仅引用 SA6 记录。
- stash pop 后 `git diff HEAD --stat` 与回退前一致，工作树无损伤。

## 三道门禁独立复跑（SA4 动态审核重点 ①）— 全绿

| Gate | 命令（后台独立进程） | 结果 | 日志 |
|---|---|---|---|
| gate1 | `pnpm typecheck`（7 包 tsc 链） | **exit 0**，零输出 | `/tmp/sa7-gate1-typecheck.log` |
| gate2 | `pnpm test`（= CI 同款 `vitest run --typecheck`） | **Test Files 84 passed (84) / Tests 1078 passed (1078) / Type Errors: no errors / exit 0**（61.56s） | `/tmp/sa7-gate2-test.log` |
| gate3 | `./node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit` | **exit 0**（零输出 = 零类型错误；include 覆盖 `packages/*/test/**/*.ts`） | `/tmp/sa7-gate3-tsc.log` |

- **gate2 基线精确命中**：简报验收第 7 条「基线：84 files / 1078 tests」逐字对上，且 typecheck 通道（8 个 `*.test-d.ts`）同绿。
- **SA4 点名的 gate3 缺口已补**：SA6 红灯实跑用 `--no-typecheck`，测试文件类型面此前零实跑证据；本次 gate3 独立实跑 exit 0，R2-1 新断言所依赖的类型面（`getStatus().schemaWrite.enabled` / `getActiveSchema()?.id` / 本地 `ReplaceSchemaIssue.message/path`）全部经实跑覆盖。gate2 的 `Type Errors: no errors` 为第二通道交叉确认。

## 保持项回归（SA4 动态审核重点 ②）— 全绿

| 保持项锚 | 所在用例 | 实跑结果 |
|---|---|---|
| γ fatal 注入（E204 经 buildTopEntries 环守卫） | sa7-dynamic「注入路径 γ」 | ✓ 9/9 内含——rejection（非 ok:false）、phase=pre-commit-internal、committed=false、cause 保留、0 update/0 notifier/字节不变 |
| A2-union loud（不投影） | sa7-dynamic「A2-union 不投影」 | ✓ union 形 ROOT × 未声明键 → ok:false、零写入 |
| A2-嵌套 loud | sa7-dynamic「A2-嵌套 loud」 | ✓ issue 明示 y、零写入 |
| AC3 快照时点（R2-3 修订后） | sequencer「AC3 排队期间输入引用可变化」 | ✓ 13/13 内含——排队期间 schema→ns-2b + root.n→999 双突变，最终 ok:true、notifier 恰 1、`read(['n'])===999`、envelope id ns-2b（槽起点快照获胜，断言未削弱） |
| ⑥ 幸福路径（原样 snapshot × 嵌套 Y.Array） | sa7-dynamic「⑥ 对称性」 | ✓ ok:true、恰 1 update、`ROOT.get('a') instanceof Y.Array`、下钻可读 |
| α/β fatal、A1 四变体、AC9 时序 | sa7-dynamic 其余用例 | ✓ 9/9 全绿 |
| persistence 集成（ENV2 全声明三 call site :47/:129/:185） | `runtime-replace-schema-persistence.test.ts` | ✓ 独立实跑 **2 passed / exit 0**（/tmp/sa7-keep-persistence.log）；亦在 gate2 全量内 ✓——ENV2 声明 {n,a,b}，:129/:185 两 provided-root 键集全声明，新契约下合法路径未回归 |

## 可选对抗锚 T1/T2（SA4 动态审核重点 ③ / SA2 T1+T2）— 实跑全绿

以临时测试文件 `packages/namespace-runtime/test/sa7-r2-adversarial-tmp.test.ts` 实跑（`vitest run --no-typecheck`，3 passed / exit 0），**验证后已删除**（工作树零残留）：

- **T1-ctrl（harness 正当性）**：稳定 plain 对象经 doc-runtime seam（`replaceSchemaAndRoot`）直调 → `ok:true`、ROOT 安装正确——证明 T1 的 loud 失败源于双读发散向量本身，非 harness 损坏。
- **T1-对抗（未冻结 Proxy 双读必 loud）**：Proxy 每次读 `n` 返回递增值（发散不抛）。实测结局：
  ```
  [SA7-DIAG] T1 outcome = "fatal" | phase = post-commit-verification | committed = true | proxy reads = 5 | updates = 1
  ```
  → **E201-C 家族**（⑥ 对称重物化检出 real/scratch 产物发散），DocRuntimeFatalError branded、committed 诚实为 true（事务已提交）、绝无静默 `ok:true`——与 SA4 静态推演及 install-verify.ts:123-148 的收编点文档精确一致。Proxy 被 read 5 次证双读取向量真实存在。
- **T2（域失败优先于 E204）**：γ 环 derived fixture × root 含未声明顶层键 `b` → **resolved `ok:false`**（非 E204 rejection）、issue path=`['b']` 且 message 含 `"b"`、0 update / 0 notifier / 字节不变 / `fatal` null / active 仍 ns-1——validate 域失败先行、build 内环守卫不可达，新优先级被钉为有意行为（SA2 MINOR#2 的动态确认）。

## vitest 触发证据（HG #14，2026-06-15 立法）

**本轮改动 `*.test.ts`**：`packages/namespace-runtime/test/runtime-replace-schema-sa7-dynamic.test.ts`、`.../runtime-replace-schema-sequencer.test.ts`（既有包内既有文件，非新增包）。

**本地触发证据（实跑）**——gate2 全量（与 CI 同一命令链 `pnpm test` → 根 `vitest run --typecheck` → include `packages/*/test/**/*.test.ts`）日志原文：

```
 ✓ packages/namespace-runtime/test/runtime-replace-schema-sa7-dynamic.test.ts (9 tests) 180ms
 ✓ packages/namespace-runtime/test/runtime-replace-schema-sequencer.test.ts (13 tests) 164ms
 ✓ packages/namespace-runtime/test/runtime-replace-schema-persistence.test.ts (2 tests) 206ms
 ✓  TS  packages/namespace-runtime/test/runtime-replace-schema-type-guard.test-d.ts (1 test)
```

| Workspace Package | CI Step Name | 触发结果 | 证据 |
|---|---|---|---|
| namespace-runtime（本包，两文件所在） | CI `test (20)` / `test (24)` → `pnpm test` | ✓ 本地实跑收集且全绿（22/22）；CI 层面见下注 | gate2 日志原文如上 |

**CI 现状与边界（如实登记，不冒称 CI 已绿）**：

- `gh pr view 101`：PR #101 OPEN（headRefName `fix/issue-91-on-docs-namespace-runtime`），latest run **32735402762**（round-1 commit 7770f2f 触发）`test (20)` / `test (24)` 均 **SUCCESS**——但该 run 覆盖的是 round-1 代码，**不含本轮 rev1 修订**（rev1 尚未 commit/push）。
- 本轮完成事务边界明令禁止 push/PR（发布由 Host 唯一执行）→ rev1 代码当前不可能有任何 CI run；`gh run view --log` 对该 run 返回空（日志不可取），无法摘录逐文件 runner log。
- 静态链已由 SA4 红线 ⑥ 证闭合（ci.yml test job → `pnpm test` → 根 vitest include 两文件必被收集），本地动态证据（上表）与 CI 命令链完全同源。
- **结论：`vitest-package-not-triggered` 不成立（本地触发证据确凿 + 收集链静态闭合）；rev1 提交后的 CI 逐文件 log 复核属 Host 发布阶段必做动作，本报告不冒称该项已完成。**

## 约束合规自查

- **零生产代码触碰**：SA7 仅新增本报告文件；对抗锚临时测试文件已删除（`git status` 终态与 SA4 验证过的改动集一一对应，无新增 src/test 改动）。
- **无端口/服务需求**：本任务为纯 vitest 单元/集成验证，无 yjs-server/Next.js/Playwright 链路，未动任何端口。
- **红→绿复现手段**：`git stash push/pop` 单文件往返，pop 后 diff stat 复原核对（见 Step 1）。
- 全部测试命令均后台独立进程（`setsid nohup … < /dev/null & disown`），session 内零同步阻塞。

## 结论

| 验收面 | 结果 |
|---|---|
| SA4 verdict 前置 | pass（不下发） |
| SA6 红灯（R2-1）红→绿 | 🟢 红（SA7 独立复现，exit 1，:461 精确断言失败）→ 绿（22/22） |
| 三道门禁 | 🟢 gate1 exit 0 / gate2 84 files 1078 tests + 0 type errors / gate3 exit 0 |
| 保持项回归（γ/union/嵌套/AC3/⑥/α/β/A1/AC9/persistence） | 🟢 全绿 |
| 可选对抗锚 T1/T2 | 🟢 实跑钉死（T1 → E201-C committed:true；T2 → 域失败优先） |
| HG #14 vitest 触发 | 🟢 本地触发证据确凿；CI 逐文件复核移交 Host 发布后执行 |

**Verdict: pass** —— 简报 7 条验收在真实运行链路上全部成立：投影已删（红→绿闭环）、provided root 原样三消费、未声明顶层键 loud（path=[k] + 0 update/0 notifier/字节不变/三不变）、失败零写入、文档/版本面落位、测试契约翻转且意图保持、全量门禁 84/1078 精确命中基线。遗留仅 SA4 已登记的注释精度类 NIT（NIT-A/NIT-B/MINOR-C——其中 MINOR#1/#2 的行为面已由本轮 T1/T2 动态钉死，注释登记仍留 follow-up），无回流 SA3 必要性。

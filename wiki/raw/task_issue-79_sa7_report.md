# SA7 动态验证报告 — task_issue-79（Persistence：DocHandle entry status 与 degraded 期间 dirty registration）

**Date**: 2026-08-22（SA7 阶段）
**Verdict**: **pass**

- 被验对象：worktree `/home/wangjian/nomicore-fix-issue-79`（branch `fix/issue-79-on-docs-doc-runtime-validation`，未提交改动与 SA4 验尸时完全一致——SA7 收尾后 `git diff HEAD --name-only` 仍为 25 文件、`lifecycle.ts` sha256 不变，零污染）
- 输入：SA4 静态验尸报告（verdict: **pass**，§五「动态审核重点」5 条移交项）、SA6 红灯测试（`issue-79-entry-status.test.ts` 6 用例 + `issue-79-file-entry-status.test.ts` 2 用例）、任务简报 AC1–AC9
- 方法：全部测试以后台独立进程（`setsid nohup … & disown`）执行，无前台同步长跑；本任务无端口/服务依赖（纯进程内单测 + tsx CLI 子进程），无需 `fuser -k` 清场
- 环境：node v24.13.0 / pnpm 10.28.2 / 用户 wangjian（uid 1000，**非 root**——EACCES 注入前提成立）

---

## Step 0 结论

```
[SA7 Step 0 结论]
SA4 verdict: pass（sa4_review.md L4「**Verdict**: **pass**」）
操作: 进 Step 1
```

## Step 1 结论 — SA6 红灯测试复跑（当前应为绿灯）

```
[SA7 Step 1 结论]
SA6 红灯: 🟢 GREEN —— 两文件 8 用例全部转绿（全量 51 文件/712 用例零失败）
操作: 进入 Step 2
```

命令（后台独立进程）：`npx vitest run --reporter=verbose --typecheck packages/persistence/test/issue-79-entry-status.test.ts packages/persistence/test/issue-79-file-entry-status.test.ts packages/dsh-persistence/test/dsh-file-probe-determinism.test.ts packages/dsh-persistence/test/dsh-probe-cli.test.ts`

结果：`Test Files 4 passed (4)` / `Tests 17 passed (17)` / `Type Errors no errors` / exit 0（逐用例证据见下文「vitest 触发证据」表）。

---

## Step 2 — SA4「动态审核重点」5 条移交项逐条验证

> 总控指令明确：CI 侧证据（`gh run view --log`）属发布后 runner 职责，本阶段以**本地实跑证据替代并注明**。事实核验：branch `fix/issue-79-on-docs-doc-runtime-validation` 尚未推送（tracking `origin/docs/doc-runtime-validation` 且 behind 1），`gh run list --branch fix/issue-79-on-docs-doc-runtime-validation` 返回空——当前确无任何 CI run 可摘录。

### 移交项 1：CI 触发证据摘录 → 本地全量实跑替代 ✅

- 本地全量 `pnpm test`（= CI `Test` 步骤同命令 `vitest run --typecheck`，Node 24）：
  ```
  Test Files  51 passed (51)
       Tests  712 passed (712)
  Type Errors  no errors
    Duration  97.37s
  ```
  exit 0。完整日志 `/tmp/sa7-issue79-full.log`。
- 受影响两包 12 个测试文件逐一触发且通过（摘自同一日志，见「vitest 触发证据」表——`persistence` 9 文件 73 用例、`dsh-persistence` 3 文件 19 用例，与 SA4 独立复跑的 `12 passed (12)/92 passed (92)` 互证）。
- Node 20/24 矩阵的 CI 侧摘录：留待 push 后 runner 阶段以 `gh run view --log` 补录（静态触发链 SA4 §1.4 已核验 `vitest.config.ts` 通配 + `persistence-contract` 独立步骤双保险）。

### 移交项 2：EACCES 注入行为 → 本地非 root 机理独立验证 + 测试绿灯 ✅

- 机理独立验证（与测试同款注入法，node 一行脚本，uid 1000）：
  ```
  $ node -e '…mkdtemp→mkdir users/bob→chmodSync(dir,0o500)→writeFileSync(doc.snapshot)…'
  writeFile on 0o500 dir -> EACCES | user: 1000
  ```
  即本机非 root 下 chmod 0o500 目录 `writeFile` 确以 EACCES 失败——`issue-79-file-entry-status.test.ts:98` 的降级注入真实生效（该文件 2 用例绿，见触发证据表）。
- ubuntu-latest runner（同样非 root）上的行为：本地证据 + 既有同款注入绿灯先例（`file-persistence-sa7-dynamic.test.ts` 基线分支即绿）为强支撑；CI 实跑日志留待发布后 runner 补录。

### 移交项 3：真实时钟测试时延敏感性 → 本地时延观察 ✅（无 flake 迹象）

- `issue-79-file-entry-status.test.ts`：全量跑 28ms / 复确认跑 26ms（`waitFor` 上界 400×5ms=2s，余量 ~70 倍）
- `issue-79-entry-status.test.ts`：全量跑 14ms / 复确认跑 16ms（AC7 `withTimeout` 2s；且竞态用例本身走 fake timer，2s 上界只保护「g1 flush 开始」这一真实微任务观察点）
- 慢 runner 上的 CI 时长监控留待发布后 runner（正确性无风险，SA4 判定一致）。

### 移交项 4：CLI 子进程 n≥1 时间线 → 真实子进程实录 ✅

直接实录探针 CLI（真实 `pnpm exec tsx` 子进程，与测试同入口）：

```
$ pnpm exec tsx packages/dsh-persistence/src/cli.ts --adapter memory --fail-first-flushes 1   # exit 0
create user-a/doc-degraded handle=h6 instance=d4 t=1008
dirty doc-degraded generation=1 t=1008
flush doc-degraded generation=1 ok=false t=1508   ← g1 flush 失败
degraded doc-degraded t=1508                      ← entry 降级
save-degraded doc-degraded t=1508                 ← degraded 窗口 saveDoc resolve（登记 dirty，成为 generation=2）
flush doc-degraded generation=2 ok=true t=2008    ← retry 以完整 live Y.Doc 落盘
recovered doc-degraded t=2008                     ← 恢复 ready
dirty doc-degraded generation=3 t=2008            ← 恢复腿写入（决策 C：generation 由 saveAndEmit 返回值给出）
flush doc-degraded generation=3 ok=true t=2508
probe ok=true events=32                           ← exit 0
```

与本地 vitest 内 `dsh-probe-cli` AC4 用例（`--fail-first-flushes 1` 断言 `flush…ok=false`/`degraded`/`save-degraded`/`recovered` 序列，492ms 绿）完全一致。CI 子进程环境时间线留待发布后 runner。

### 移交项 5：探针 S4 两条回归腿的变异复核（可选加强）→ 已执行，两条腿均精确爆红 ✅

采用临时变异 + 快照还原（改动未提交，**不可用 `git checkout`**——先 `cp` 快照至 `/tmp/sa7-snap/` 并记录 sha256/diff 指纹，跑完还原后复核指纹）：

**Leg A — 临时移除 `scheduleFlush` retry guard**（`lifecycle.ts:433` `if (entry.retryTimer !== undefined) return` → `if (false && …) return`）：

```
× issue-79-file-entry-status.test.ts > AC3+AC4+AC5 …
  AssertionError: expected 2 to be +0
  151|       expect(timer.pending).toBe(0)
Test Files  1 failed | 1 passed (2)   exit 1
```

→ 无 guard 时 degraded saveDoc 武装 debounce+maxDirty 双定时器（锚点处 pending=2），`pending=0` 锚点立即引爆——与 SA4 静态算术、SA2 实验 B 实测三方一致。（注：`dsh-file-probe-determinism` 在此变异下仍绿——file n=0 时间线不经 degraded 窗口，该锚点归 Leg B 管辖，分工与设计 §3.4 论证相符。）

**Leg B — 临时恢复旧契约 degraded 拒绝**（`saveDoc` 内重插 `if (cell.entry.degraded) throw new Error('persistence-degraded: writes are rejected until retry succeeds')`）：

```
× issue-79-entry-status.test.ts     > AC5: saveDoc while degraded registers dirty …
  → promise rejected "Error: persistence-degraded: writes are r…" instead of resolving
× issue-79-entry-status.test.ts     > AC7: deterministic race …
  → promise rejected "Error: persistence-degraded: writes are r…" instead of resolving
× issue-79-file-entry-status.test.ts > AC3+AC4+AC5 …
  → promise rejected "Error: persistence-degraded: writes are r…" instead of resolving
× dsh-probe-cli.test.ts             > AC4 完整性：--fail-first-flushes 1 …
  → expected 1 to be +0            ← 真实 CLI 子进程 exit 1：S4 哨兵响亮失败（非静默假事件）
Test Files  3 failed | 1 passed (4)   Tests  4 failed | 13 passed (17)   exit 1
```

→ 内核回归「degraded 拒绝 saveDoc」被 3 条单测锚点 + 1 条真实 CLI 子进程哨兵同时抓住；探针按设计以 `scenario-error` 响亮失败而非记假事件。

**还原证明**：`cp /tmp/sa7-snap/lifecycle.ts` 回写后 `sha256 = 7935f8df…f01f6f`（与变异前快照一致）、`git diff HEAD -- packages/persistence/src/lifecycle.ts | sha256 = 7502baf4…fbfae`（与 SA7 开始前一致）、`grep -c SA7-MUTATION` = 0。还原后两包复确认跑 `Test Files 12 passed (12) / Tests 92 passed (92) / Type Errors no errors / exit 0`。

---

## 动态复验：AC7 确定性竞态 + file 适配器 EACCES 降级（强制要求 #2）

### AC7（MemoryPersistence，`issue-79-entry-status.test.ts:213-290`，verbose 跑 2ms 绿）

用例体与规格 8 步逐行对应，全手动 fake timer、无真实时钟参与竞态：

| 规格步 | 用例锚点（实测通过） |
|---|---|
| 1. seed + saveDoc → dirty g1 | L244-248（`ROOT.generation=1`、`saveDoc`、前置 `statusOf==='ready'`） |
| 2. advanceBy(debounce) → g1 flush 停在 store gate | L251-253（`withTimeout(firstWriteStarted,2_000)`、`expect(writes).toBe(1)`） |
| 3. **写前观察 ready**（flush 在途未失败） | L257（`statusOf(handle)==='ready'`） |
| 4. mutation 2 进 live Y.Doc | L260（`ROOT.generation=2`） |
| 5. 释放 gate 令其 reject → 降级 | L263-265（`releaseFirstWrite(new Error('disk unavailable'))`、`statusOf==='persistence-degraded'`） |
| 6. **degraded 状态 saveDoc resolve** | L268（`await expect(persistence.saveDoc(handle)).resolves.toBeUndefined()`） |
| 7. retry 落盘完整 live doc → ready | L271-274（`advanceBy(500)`、`writes===2`、`ready`） |
| 8. 新实例 load 可见 mutation 2 | L277-285（fresh `createMemoryPersistence` 共享 store、`loadDoc`→`ROOT.generation===2`） |

变异 B 下该用例以 `promise rejected "persistence-degraded…" instead of resolving` 爆红——竞态断言真实钉住新契约，非恒真断言。

### file 适配器 EACCES 降级（`issue-79-file-entry-status.test.ts:94-166`，verbose 跑 22ms 绿）

- L98 `fs.chmodSync(bobDir, 0o500)` 注入 → bob entry flush 以 EACCES 失败 → `persistence-degraded`（entry 级，非聚合）；L132 `chmodSync(bobDir,0o755)` 解除 → 自身 retry 成功恢复 `ready`；degraded 窗口 saveDoc resolve 登记；新实例 load 可见最新 doc；L151/L164 双 `expect(timer.pending).toBe(0)` 调度器纪律锚点全过。
- EACCES 机理在本机非 root 下独立验证成立（见移交项 2）。

---

## vitest 触发证据（硬门禁 #14，2026-06-15 立法）

> 本任务新增/改动 7 个 `*.test.ts` 全部落在 `packages/persistence` 与 `packages/dsh-persistence`。CI Run：**暂无**（分支未推送、`gh run list` 为空）——按总控指令以本地全量 `pnpm test`（与 CI `Test` 步骤同命令）实跑摘录替代，CI 侧 `gh run view` 摘录属发布后 runner 职责。

全量汇总行（`/tmp/sa7-issue79-full.log`，exit 0）：

```
 Test Files  51 passed (51)
      Tests  712 passed (712)
 Type Errors  no errors
```

受影响 workspace package 逐一触发且通过（同一日志原文摘录）：

| Workspace Package | 测试文件（全量跑原文行） | 触发结果 |
|---|---|---|
| @nomicore/persistence | `✓ packages/persistence/test/memory-persistence.test.ts (32 tests) 39ms` | ✓ 32 passed |
| @nomicore/persistence | `✓ packages/persistence/test/file-persistence.test.ts (13 tests) 1782ms` | ✓ 13 passed |
| @nomicore/persistence | `✓ packages/persistence/test/file-persistence-sa7-dynamic.test.ts (4 tests) 282ms` | ✓ 4 passed |
| @nomicore/persistence | `✓ packages/persistence/test/issue-79-file-entry-status.test.ts (2 tests) 28ms` | ✓ 2 passed |
| @nomicore/persistence | `✓ packages/persistence/test/issue-79-entry-status.test.ts (6 tests) 14ms` | ✓ 6 passed |
| @nomicore/persistence | `✓ packages/persistence/test/sa7-supplementary.test.ts (3 tests) 11ms` | ✓ 3 passed |
| @nomicore/persistence | `✓ packages/persistence/test/persistence-contract.test.ts (7 tests) 8ms` | ✓ 7 passed |
| @nomicore/persistence | `✓ packages/persistence/test/core-dsh-boundary.test.ts (3 tests) 6ms` | ✓ 3 passed |
| @nomicore/persistence | `✓ packages/persistence/test/module-graph-regression.test.ts (3 tests) 5ms` | ✓ 3 passed |
| @nomicore/dsh-persistence | `✓ packages/dsh-persistence/test/dsh-probe-cli.test.ts (7 tests) 3584ms` | ✓ 7 passed |
| @nomicore/dsh-persistence | `✓ packages/dsh-persistence/test/dsh-file-probe-determinism.test.ts (2 tests) 1259ms` | ✓ 2 passed |
| @nomicore/dsh-persistence | `✓ packages/dsh-persistence/test/dsh-profile-acceptance.test.ts (10 tests) 121ms` | ✓ 10 passed |

重点文件逐用例证据（verbose 复跑 `/tmp/sa7-issue79-targeted.log`，`Test Files 4 passed (4) / Tests 17 passed (17) / exit 0`）：

**issue-79 两测试文件 8 用例**：

| # | 用例（verbose 原文名，全部 ✓） | 耗时 |
|---|---|---|
| 1 | `issue-79-entry-status > AC1: getStatus() is synchronous and distinguishes ready / persistence-degraded / released / disposed` | 5ms |
| 2 | `issue-79-entry-status > AC2+AC3: status is entry-scoped — a degraded (owner, docId) leaves unrelated entries ready on the same adapter` | 1ms |
| 3 | `issue-79-entry-status > AC4: only the degraded entry own retry restores it to ready; an unrelated successful flush does not` | 1ms |
| 4 | `issue-79-entry-status > AC5: saveDoc while degraded registers dirty and the retry persists the latest live doc, visible to a fresh adapter` | 3ms |
| 5 | `issue-79-entry-status > AC7: deterministic race — g1 flush in flight → ready → mutation 2 → g1 fails → degraded saveDoc registers → retry → fresh load sees mutation 2` | 2ms |
| 6 | `issue-79-entry-status > AC6: foreign / released / identity-mismatched / disposed errors stay loud, and status still reports released/disposed` | 2ms |
| 7 | `issue-79-file-entry-status > AC1: released and disposed handle status over the file adapter` | 4ms |
| 8 | `issue-79-file-entry-status > AC3+AC4+AC5: entry-scoped degradation, degraded saveDoc registration, own-retry recovery, fresh-instance visibility` | 22ms |

**dsh-file-probe-determinism（events=28 钉死值）**：

| 用例 | 触发结果 | 说明 |
|---|---|---|
| `进程内连跑 3 次：每次 ok=true、record 精确 28 事件含最终 evict，且三次逐字节一致` | ✓ 158ms | 尾行断言 `probe ok=true events=28`（测试 L38）三跑逐字节一致 |
| `CLI 连跑 2 次（各自独立 rootDir）：均以 0 退出、尾行精确 events=28，且 stdout 逐字节一致` | ✓ 1064ms | 真实 CLI 子进程 ×2，stdout 逐字节一致 |

**dsh-probe-cli（CLI 子进程，7/7）**：`memory profile 完整记录并 0 退出` ✓ 482ms、`可复制性：同一命令两次运行 stdout 逐字节一致` ✓ 800ms、`file profile：命令落盘快照…两次运行记录一致` ✓ 992ms、**`AC4 完整性：--fail-first-flushes 1 使记录包含 degraded → save-degraded → recovered 完整序列` ✓ 486ms**、`file adapter 缺 rootDir → 非零退出` ✓ 485ms、`未知 adapter → 非零退出` ✓ 476ms、`package.json 提供 dsh:probe 入口` ✓ 0ms。

**触发性结论**: ✅ all-vitest-packages-triggered（本地全量实跑证据；两受影响包 12/12 文件 92/92 用例全绿。CI runner 侧摘录留待 push 后补录——静态触发链 SA4 §1.4 已先行核验）

---

## 附：补充性测试决策与最终状态

- **未新增补充测试**：SA4 移交项与 AC1–AC8 的每个动态风险点均已有现存锚点，且两条变异腿证明锚点具真实判别力（回归必爆红）；新增测试将是冗余覆盖，不符合「必要的补充测试」标准。
- **显式 typecheck**：`pnpm typecheck`（五包 tsc 链，后台独立进程）→ **exit 0**——与全量 `vitest run --typecheck` 的 `Type Errors no errors`、SA4 复跑 exit 0 三方互证。
- **零生产代码残留改动**：变异用 lifecycle.ts 已按快照还原（sha256/diff 指纹双重验证），`git diff HEAD --name-only` 仍为 SA7 开始前的 25 文件。
- 所有测试命令以后台独立进程执行（`/tmp/sa7-issue79-*.log` 与 `/tmp/sa7-mut[AB].log` 留档），无前台同步长跑。

## Verdict

**pass**

- SA6 两红灯文件 8 用例真实转绿；全量 51 文件/712 用例 + typecheck 全绿
- SA4 五条移交项中本地可完成项全部消化（1–4 以本地实跑替代并注明 CI 侧归发布后 runner；5 可选加强已执行且两条腿精确爆红）
- AC7 确定性竞态与 file EACCES 降级用例动态复验通过，且变异证明其判别力非恒真
- 发布后待办（非本阶段阻塞）：push 后由 runner 摘录 Node 20/24 两次矩阵 `gh run view --log` 中 issue-79 两文件触发证据、ubuntu-latest EACCES 实跑、慢 runner 时长观察

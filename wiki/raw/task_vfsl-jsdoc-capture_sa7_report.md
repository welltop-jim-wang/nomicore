# SA7 动态验证报告 — Parser JSDoc 原文捕获（issue #7）

**Date**: 2026-08-19
**验证对象**: commit `4584335`（SA3 实现，分支 `fix/issue-7-on-refactor-docs-add-mabf-multi-repo-monito`）；SA4 报告 `87d0bb6`
**验证输入**: SA4 静态验尸报告（Verdict=pass，动态审核重点清单 5 条 + O1~O4 观察）、任务简报 SA6 记录、SA1 设计 R2（§10 T1~T15 构想表）
**验证方法**: 全部命令按 2026-05-08 立法后台独立进程（`setsid nohup`）执行；SA7 独立探针以临时
vitest 文件（`packages/vfsl/test/sa7-temp-probe.test.ts`，匹配根 vitest include）直打公共接缝
`parseVfsl`，**13 项断言全部带精确期望值（错误码前缀 + 行列锚，锚点经码点列独立复核）**，
跑完即删、typecheck 复跑坐实零残留。本任务为纯进程内 parser（零运行时依赖、无服务/端口）——
按 SA7 CLAUDE.md「不得盲用 `fuser -k` 清场」未做端口释放（无所需端口）。
**环境**: node v24.13.0 / pnpm 10.28.2 / vitest 3.2.7（本地 node 命中 CI 矩阵 20/24 的 24 腿）

---

## Step 0 — SA4 verdict 校对（2026-06-13 立法）

```
[SA7 Step 0 结论]
SA4 verdict: pass（sa4_review.md 顶部 Verdict: pass，4 项非阻塞观察 O1~O4）
操作: 进 Step 1
```

## Step 1 — SA6 红灯测试现跑（第二关）

```text
$ pnpm test    # setsid nohup 后台独立进程，/tmp/sa7.log
 RUN  v3.2.7
 ✓ packages/vfsl/test/parse-vfsl.test.ts (11 tests) 7ms
 ✓ packages/vfsl/test/parse-vfsl-jsdoc.test.ts (7 tests) 8ms
 ✓ packages/vfsl/test/parse-vfsl-errors.test.ts (19 tests) 12ms
 ✓ packages/vfsl/test/parse-vfsl-r3-regression.test.ts (7 tests) 5ms
 Test Files  4 passed (4)
      Tests  44 passed (44)
TEST_EXIT=0
```

```
[SA7 Step 1 结论]
SA6 红灯（5红/2绿 → SA3 修绿）: 🟢 GREEN — parse-vfsl-jsdoc.test.ts 7/7，全量 44/44
操作: 进入 Step 2
```

用例 1（SA2 流程门 N1 断言回炉项）随 7/7 绿——转义形比对口径下 doc 原文逐字/顺序/兄弟不可见
三判别维度均由 SA3 实现满足。

## Step 2 — SA4 动态审核重点清单逐项验证

> 阅读量：SA4 报告 + 简报 + 设计 R2 + SA6 测试文件 + #5 SA7 报告（先例）= 5 文件，限额 15 内。
> 探针运行实证：`/tmp/sa7-probe.log`——**13/13 通过（24ms），EXIT=0**。

### 清单 1. CI 触发证据（Test job 44/44 + Typecheck exit 0） → ⏳ 环境阻塞（如实登记）

```text
$ gh run list --branch fix/issue-7-on-refactor-docs-add-mabf-multi-repo-monito --limit 5
（空输出，gh-exit=0）
$ git log origin/fix/issue-7-on-refactor-docs-add-mabf-multi-repo-monito -1
fatal: unknown revision（分支从未 push）
```

分支尚无任何 GitHub Actions run、无 PR——SA7 无 push/建 PR 职责（CLAUDE.md 边界），CI runner
侧日志**本轮不可得**，不以静态推断冒充。已核静态接线：`.github/workflows/ci.yml` 为全仓唯一
workflow，`test` job 触发于 `push: main` + 全部 `pull_request`，矩阵 node [20,24]，步骤
`pnpm install --frozen-lockfile` → `Typecheck（pnpm typecheck）` → `Test（pnpm test）`——
PR 一旦建立即触发。本地等价命令亲验：`pnpm typecheck` exit 0（零输出）+ `pnpm test` 44/44
（本机 node 24 命中矩阵 24 腿）。**CI run log 留待总控 push/建 PR 后收尾关摘录**（与 #5 SA7
报告同款处置）。

### 清单 2. T14 深嵌套真实栈余量（N=5000/20000） → ✅ 通过

构造 `'type A = ' + 'YMap<'.repeat(N) + 'string' + '>'.repeat(N) + ';'`（探针 it.each 三档）：

| N | not.toThrow | 恰 1 条 issue | 消息前缀 | 锚点 | 无「内部错误」 |
|---|---|---|---|---|---|
| 101 | ✅ | ✅ | `^VFSL-E100: 嵌套深度超过实现上限 100（实现资源上限，非方言判定` | (1,510) ✅ | ✅ |
| 5000 | ✅ | ✅ | 同上 ✅ | (1,510) ✅（与 N 无关） | ✅ |
| 20000 | ✅ | ✅ | 同上 ✅ | (1,510) ✅（与 N 无关） | ✅ |

三档合计 24ms 内完成，零爆栈零兜底命中——设计 §4.6 栈余量 23.4×（保守基线 2343 层）在
node 24 实机成立：预算在第 101 个标记 Ident（col 510）即触发，递归深度根本到不了爆栈区。
锚列 510 独立复核：`type A = ` 占 col 1–9，`YMap<`×100 占 col 10–509 → 第 101 个 Ident @510。

### 清单 3. N=100 marker IR JSON 往返（序列化余量 11.1× 实测面） → ✅ 通过

N=100（预算内）：`ok:true` + `JSON.parse(JSON.stringify(module))` 与 module **深等**（探针
`toEqual`）+ 根类型节点 `kind:'marker'`、`name:'YMap'`（IR marker 形状与设计 §7.1 一致）。
IR ≈100×2 JSON 层 ≪ 4456 上限，往返无损实测成立。

### 清单 4. O2（T1~T15 未落库）→ 现状确认 + SA7 动态补验 ✅；落库归 SA6 积压

**落库情况**：`grep -rn "repeat(\|实现上限\|资源上限" packages/vfsl/test/*.test.ts` **零命中**
——SA6 文件恰 7 用例，T11~T15/T3/T4/T5 均无回归锁（O2 属实）。SA6 本轮未补测。

**SA7 动态补验**（探针，全部绿——这些行为当前正确，只是无红灯拦截）：

| # | 输入 | 期望（设计 §10） | 实测 |
|---|---|---|---|
| T3 | `type A = Foo; type B = /** d */ string;` | E301 胜出 @(1,10) | ✅ 恰 1 条 `VFSL-E301:` (1,10) |
| T4 | `type A = /** d */ string; type B = any;` | E101 胜出 @(1,36)（E305 候选不浮出） | ✅ 恰 1 条 `VFSL-E101:` (1,36) |
| T5 | `type A = string; /** d`（未闭合 doc） | E203 @(1,18) | ✅ 恰 1 条 `VFSL-E203:` (1,18) |
| T11 | `type A = string /** d */ \| number;` | E305 @(1,17)（**非** E100 内部错误） | ✅ 恰 1 条 `VFSL-E305:` (1,17) |
| T12 | `type /** d */ A = string;` | E305 @(1,6)（不挂别名 A） | ✅ (1,6) |
| T13 | `type T = { /** d */ };` | E305 @(1,12)（不跨界挂载） | ✅ (1,12) |
| T15 | 对象 `{a:`×N 双侧 | N=100 ok+往返；N=101 E100@(1,310) | ✅ 双侧符合（对象侧冻结行为未因 MAX_TYPE_DEPTH 更名漂移） |

T11（分散式记账漏 `\|` 消费点必报 E100 或静默吞）、T12（错挂别名）、T13（跨 `}` 挂载）三个
SA2 误实现检测器实测全部不命中——集中式记账实现正确。**处置**：按设计 §12（T11~T15 补测
归 SA6 拥有）与 #5 SA7 先例（不越 SA6 拥有域落新文件），SA7 不落新测试文件；建议总控安排
SA6 在 #6 动工前补落 T11~T15 最小集（+T3/T4/T5），本节实测即其落库后的预期全绿基线。

### 清单 5. E305 冻结面抽检 → ✅ 通过

`type A = string;\n/** 悬空 */` → 恰 1 条 `^VFSL-E305: ` **@(2,1)**（探针独立断言）；同形态
已由 SA6 用例 4 落库，随 44/44 绿双通道确认。

## Step 3 — E2E spec 触发门禁 → 不适用

`find . -name '*.spec.ts'`（排除 node_modules）= **0 个文件**。本任务只有 `*.test.ts`（vitest），
走 Step 4 门禁。

---

## vitest 触发证据 (verdict 升级 — 2026-06-15 立法)

### CI 侧如实说明（不得伪造 CI 日志）

```text
$ gh run list --branch fix/issue-7-on-refactor-docs-add-mabf-multi-repo-monito --limit 5
（空输出，EXIT=0）
$ gh pr list --head fix/issue-7-on-refactor-docs-add-mabf-multi-repo-monito
（空输出，EXIT=0）
```

该分支**尚无任何 GitHub Actions run、尚无 PR**——PR 由外部流程在 SA 链收尾后创建，SA7 无
push/建 PR 职责（CLAUDE.md 边界）。CI runner 侧动态日志本轮不可得，`✓ 触发且通过（CI）`
分类留待 PR 建立后确认。

### 证据采用：workflow 静态接线 + 本地全量运行（SA7 亲验，非转抄）

| 链路环节 | 证据 |
|---|---|
| 新增 `*.test.ts` | `packages/vfsl/test/parse-vfsl-jsdoc.test.ts`（7 用例）——本轮实跑收集执行 ✅ |
| 所在 workspace package | `@nomicore/vfsl`（全仓唯一 workspace package） |
| vitest include | 根 `vitest.config.ts:5` `'packages/*/test/**/*.test.ts'` → 命中 |
| 根 script | 根 `package.json` `"test": "vitest run"`（无过滤，根级全仓收集） |
| CI workflow 静态接线 | ci.yml：`push: main` + 全部 `pull_request` 触发，node [20,24] 矩阵，`pnpm test` 步骤在 Typecheck 后 |
| typecheck 侧 | `packages/vfsl/tsconfig.json` include 含 `test/**/*.ts` → 新文件同受检（本轮 tsc exit 0） |
| 本地运行动态确认 | node v24.13.0（命中矩阵 24 腿）`pnpm test`：`Test Files 4 passed (4)` / `Tests 44 passed (44)`，含 `✓ packages/vfsl/test/parse-vfsl-jsdoc.test.ts (7 tests)` 摘录（Step 1） |

| Workspace Package | CI Step Name | 触发结果 | 证据 |
|---|---|---|---|
| `@nomicore/vfsl` | `Test`（`pnpm test`，node 20/24 矩阵） | ⏳ CI run 待 PR 建立（无 run 可查，如实说明）；**本地等价命令全绿** | `Test Files 4 passed (4)` / `Tests 44 passed (44)`（本地 vitest 3.2.7 / node 24） |

**verdict**: ✅ all-vitest-packages-triggered（静态接线完整 + 本地实跑收集执行全部 4 个测试
文件；不存在「测试文件不在 runner 收集范围」的黑洞路径。CI runner 侧日志留待 PR 建立后由
总控/收尾关确认）

---

## 产物与边界说明

- **未新增任何测试文件**：O2 覆盖缺口（T11~T15/T3/T4/T5）按设计 §12 SA6 拥有域 + #5 SA7
  先例以临时探针动态补验（13/13 绿），落库归 SA6 积压、建议 #6 动工前完成（见清单 4）。
- **未修改任何业务代码**（`src/` 零触碰）；探针临时文件 `sa7-temp-probe.test.ts` 跑完即删，
  删后复跑 `pnpm typecheck`（exit 0）+ `pnpm test`（44/44）坐实零 worktree 残留。
- 工作区遗留（`TASK.md`、`.mabf-bg/`、`wiki/raw/task_vfsl-jsdoc-capture_dispatch.md` 改动）
  系总控/前序 SA 流程产物，SA7 未触碰——与 SA4 O3 口径一致（不得进未来 commit）。

## 总结

| 项 | 结果 |
|---|---|
| Step 0 SA4 verdict 校对 | pass → 进 Step 1 |
| Step 1 SA6 红灯现跑 | 🟢 44/44（含 jsdoc 7/7），typecheck exit 0 |
| 清单 1 CI 触发证据 | ⏳ 阻塞（分支未 push、无 run 无 PR；SA7 无权 push）——静态接线 + 本地等价命令已验，CI log 留交总控 |
| 清单 2 T14 栈余量（101/5000/20000） | ✅ 三档 not.toThrow + E100@(1,510) 与 N 无关 + 零「内部错误」 |
| 清单 3 N=100 marker JSON 往返 | ✅ 深等无损 + marker 根节点形状正确 |
| 清单 4 O2 落库情况 | 未落库（grep 零命中）；SA7 探针补验 T3/T4/T5/T11~T15 全绿；落库归 SA6 |
| 清单 5 E305 冻结面 | ✅ E305@(2,1) 前缀断言（44 套件 + 探针双通道） |
| Step 3 / Step 4 | spec=0 不适用；vitest 接线完整 + 本地全绿，CI 侧如实登记 |

SA4 动态审核重点 5 条：3 条 ✅ 通过、1 条 ✅（附 SA6 积压建议）、1 条 ⏳ 环境阻塞（非实现
缺陷，交总控 push 后收尾关补证）。未发现新缺陷，无回流项。

---

**Verdict: pass**

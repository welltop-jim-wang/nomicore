# Standards 终审报告 — issue #110 round 2 修订 delta（工程标准轴）

- **审查轴**: Standards（仓库惯例 / 防御模式 / 测试纪律 / 文档档案 / 可维护性）
- **Worktree**: `/home/wangjian/nomicore-fix-issue-110`（branch `fix/issue-110-on-docs-namespace-registry`）
- **审查 diff 范围（唯一权威）**: `git diff HEAD` = fb62b86 → 当前工作树（round 2 修订 delta）：
  - `packages/namespace-registry/src/registry.ts`（factory catch 块 `await`→`void` fire-and-forget + 注释契约）
  - `packages/namespace-registry/src/testing.ts`（删 `createDocumentFactory`/`scheduler` 两个 never 字段 + docstring）
  - `packages/namespace-registry/package.json`（0.1.0→0.1.1）
  - `packages/namespace-registry/test/registry-open.test.ts`（+71：NeverSettleStubHandle + never-settle 回归用例）
  - `wiki/raw/` 4 个 tracked 档案 trailing whitespace 清理 + dispatch log R2 段 + 6 个新 rev2 档案（untracked）
  - `REPORT.md` 改动按派发说明不属本审查范围（本地元数据，tracked，仓内有 commit 先例）
- **只读纪律**: 未修改任何既有文件、未执行 git commit/push；本报告为唯一新增产出。

## 逐项结论与证据

### 1. 仓库惯例 — ✅ 通过

- **语言/风格一致**: 新增/改写注释全中文，与该包既有注释风格一致
  （`registry.ts:227-228` docstring 追加「调用方必须 fire-and-forget（void、不 await）」、
  `registry.ts:297-299` catch 块注释、`testing.ts:10-11` docstring 改写、
  测试新类注释 `registry-open.test.ts:84-90` 与用例名 `:659`）。
- **commit 前状态**: `git status --porcelain` 仅含上述应提交文件 + REPORT.md；
  `.mabf-bg/`、`.mabf/`、`.mabf-done` 均已被 `.gitignore:8-10` 覆盖
  （`git status --ignored` 显示 `!!`，不进待提交集）。无 blacklist 文件混入
  （SA4 已核 `git diff --name-only HEAD` + blacklist regex 零命中）。
- **版本 bump 立法**: `package.json:3` `0.1.0`→`0.1.1`，符合仓内
  「版本随实质变更 commit 同步 bump patch」惯例（先例：doc-runtime 0.1.0→0.1.1、
  vfsl 0.2.0 @ f07462d、persistence 0.1.2；rev2 brief 硬约束 7 明文要求）。
  patch 位选择正确：行为修复、无公开 API breaking（testing overrides 删的是
  `never` 类型不可用工位，无真实消费方）。

### 2. 防御模式 — ✅ 浮动 Promise 无 unhandled rejection 风险

实际读码判定（非凭注释）：

- `releaseHandleBestEffort`（`registry.ts:229-238`）为 async 函数，函数体第一语句即
  `try { await handle.release(); } catch (e) { dispatchObserver(..., { type: 'handle-release-failed', cause: e }); }`。
- **`handle.release()` 同步 throw 的情形**：表达式 `handle.release()` 的求值发生在
  try 块**内部**，同步 throw 直接被该 try 的 catch 捕获并上报 observer——不会逃逸为
  外层 rejected promise。rejected promise 情形同理（await rethrow → 同一 catch）。
- **catch 块内 secondary failure**：`dispatchObserver`（`observer.ts:39-49`）自身以
  try/catch 隔离 observer throw（静默丢弃，设计 §8.1）。函数无任何路径 reject，
  所有路径 resolve `undefined` → `void` 浮动的返回 Promise 永不 unhandled rejection。
- **调用点唯一**：全仓 grep 确认 `releaseHandleBestEffort` 仅 `registry.ts:300` 一个
  调用方，且符合 docstring「调用方必须 fire-and-forget」契约；注释宣称与实现一致。
- **同步发起语义**：调用 async 函数同步执行至 `await handle.release()` 求值处，
  `releaseCalls` 在 factory catch 同一调用栈内 +1（测试锚 `releaseCalls===1` 成立）。
- 旁证：SA7 进程级观察——全部真实 Vitest 子进程 exit 0，输出无
  `UnhandledPromiseRejection`/崩溃警告（`task_namespace-registry-open_rev2_sa7_report.md:91-93`）。

### 3. 测试纪律 — ✅ 零 real sleep、确定性成立、无侥幸绿

- **零 real sleep**: 新用例（`registry-open.test.ts:659-714`）唯一等待为
  `flushMicrotasks(20)`（定义 `:45-49`，纯 `await Promise.resolve()` 循环）
  + 一个 `setImmediate` 宏任务让出（`:691-693`）；全文件头 `:6` 明示
  「零 real sleep」纪律。setImmediate 宏任务手法有仓内先例
  （`dsh-persistence/test/dsh-profile-acceptance.test.ts`）。
- **确定性**: open 链为纯微任务链（StubPersistence 同步 queue，无 timer/I/O；
  SA4 报告第 24 行逐跳分析）；`setImmediate` await 前排空 20 轮微任务、本身再
  跨越整个微任务队列——凡有限 promise 链必已 settle，未 settle 即真挂起。
- **无侥幸绿**: SA7 变异抽查实证——调用点改回 `await` 后同用例精确变红
  （`expected 'pending' not to be 'pending'`，11ms 断言失败而非 5s 框架超时），
  还原后字节级一致（RESTORE_DIFF_MATCH=0）复绿
  （`task_namespace-registry-open_rev2_sa7_report.md:32-81`）。红灯/修绿/变异三态
  证据链完整。
- **命名/结构惯例**: 用例名为中文行为描述，与文件既有 30+ 条 `it` 命名风格一致；
  位置紧随 L572/L610 两条 factory-throw 锚之后，同属
  `describe('open 分支与 fatal 分类（§6.4-§6.7）')`；`NeverSettleStubHandle`
  继承复用既有 `StubHandle` 设施，diff 为纯追加（+71/-0 语义行），既有锚零改动。
- 断言面为可观察行为（settled 探针 / fatal brand 四元组 / exact cause 同一性 /
  零回显负锁 / releaseCalls / observer exact cause），无源码 grep 替代行为验证。

### 4. 文档与档案 — ✅ 齐备（一项非阻断观察，见 J1）

- **档案齐备性**: rev2 简报（评审反馈全文+硬约束）、SA6 红灯档案（含红灯命令与
  输出）、SA3 实现档案、SA4 评审（verdict=pass）、SA7 验证（verdict=pass，含变异
  抽查与进程级 unhandled-rejection 观察）、AC 核对表（R2-1a~R2-4 全 ✅ +
  N-1/N-2 记录不实现）、dispatch log Round 2 段（R2-0~R2-6 全记录）——全齐。
- **tracked wiki 清理真实**: 4 个 tracked 档案的 diff 实证删除行尾双空格
  （design_conflict_report / sa4_review / sa5_verify 头部硬换行符逐个去除）；
  清理后 `grep -c ' $'` 对这 3 个文件 + design.md 均为 0 命中。
  `git diff --check 1a7154e -- wiki/` exit 0；`git diff --check HEAD -- packages/` exit 0。

### 5. 可维护性判断项 — 见下方非阻断清单（J1-J5）

## 硬违规清单

**无。**

## 非阻断判断项清单

- **J1（文档一致性）**: 新 rev2 档案中 2 个文件头部仍含行尾双空格（markdown 硬换行）：
  `task_namespace-registry-open_rev2_sa4_review.md:3-5`（3 行）、
  `task_namespace-registry-open_rev2_sa7_report.md:3-4`（2 行）。
  本轮反馈 3 刚把 round-1 档案的同类行尾空格清掉，新档案又引入同款，方向不一致。
  方法论盲区：`git diff --check` 不覆盖 untracked 文件，故 SA7 的
  `git diff --check 1a7154e -- wiki/`（exit 0）未能发现。建议 commit 前一并清理
  （或明确接受「元数据头部双空格硬换行」为档案惯例）；后续检查手法建议改为
  `grep -rn ' $' wiki/` 全量而非仅 diff --check。属文档元数据、非代码，不阻断。
- **J2（测试可维护性）**: `flushMicrotasks(20)` 的 20 未附推导注释（文件 docstring
  `:41` 称默认 12 已覆盖开放链嵌套上界）。因有 setImmediate 宏任务兜底，无确定性
  风险，仅留档备查。
- **J3（流水线自指记录）**: `dispatch.md` R2-6 双轴终审行完成时间仍标 `(pending)`
  ——本终审即该行对象，commit 前由总控更新为完成态即可，不影响代码与测试。
- **J4（范围确认）**: REPORT.md 为 tracked 且仓内有 commit 先例（1a7154e 等），
  其改动随本轮落盘属既有惯例；派发说明已声明不属本审查范围，仅确认无其他越界
  文件混入待提交集。
- **J5（API 演进留档）**: `testing.ts:10-11` docstring 保留
  createDocumentFactory/scheduler 名字的叙述性提及（明确「不在本切片预留」）。
  属有意留档而非残留：SA4 全仓检索确认无任何类型/代码引用（`scheduler`@
  `registry-open.test.ts:286` 属 persistence 包 `createMemoryPersistence` 参数，
  与本 overrides 无关）。未来 #111/#112 按 docstring 指引引入具体类型即可。

**Verdict**: clear

# Spec 终审（规格符合轴）— issue #110 namespace-registry open · round 2 修订轮

- **审查对象**：worktree `/home/wangjian/nomicore-fix-issue-110`（branch `fix/issue-110-on-docs-namespace-registry`，PR #119）
- **审查 diff 范围（唯一权威）**：`git diff HEAD`（fb62b86 → 当前工作树，round 2 修订 delta）。涉及：
  - `packages/namespace-registry/package.json`（+1/-1）
  - `packages/namespace-registry/src/registry.ts`（+6/-2，2 hunks）
  - `packages/namespace-registry/src/testing.ts`（+4/-6，2 hunks）
  - `packages/namespace-registry/test/registry-open.test.ts`（+70/-0，2 hunks）
  - `wiki/raw/task_namespace-registry-open_design_conflict_report.md` / `_sa4_review.md` / `_sa5_verify.md`（仅空白）
  - `wiki/raw/task_namespace-registry-open_dispatch.md`（+16/-0，追加 round 2 派发日志）
  - `REPORT.md` 按指示不属本审查范围，未评。
- **对照规格**：`wiki/raw/task_namespace-registry-open_rev2.md`（owner 评审反馈三条 + 非阻断建议两条 + 硬约束 7 条）
- **只读纪律**：未修改任何被审文件、未做 git commit/push；本报告为唯一写入。

## 反馈 1（阻断）：factory fatal 不应被 handle 清理无限阻塞 —— ✅ 完整实现

实现点：`registry.ts:300` 将 `await releaseHandleBestEffort(handle, identity)` 改为 `void releaseHandleBestEffort(handle, identity)`（fire-and-forget），并附纪律注释（297-299）；`releaseHandleBestEffort` 本体（229-238）与 docstring（227-228）同步标注「调用方必须 fire-and-forget」。随后 `dispatchObserver('open-runtime-construction-failed', cause=e)`（301-305）与 `throw new NamespaceRegistryFatalError('open', 'runtime-construction', false, e)`（306）保持 round 1 原样。

逐子要求核对：

| # | 子要求 | 结论 | 证据 |
|---|--------|------|------|
| 1 | `handle.release()` 仍恰调用一次 | ✅ | `void` 调用 async 函数时其函数体同步执行至首个 `await`，故 `handle.release()`（`registry.ts:234`）在 catch 块内被**同步**发起且全路径仅此一处调用点（grep 确认 `releaseHandleBestEffort` 唯一调用点为 `registry.ts:300`）；新回归测试断言 `releaseCalls === 1`（`registry-open.test.ts:708`）；既有锚 585:617、623:638 同断言。 |
| 2 | release rejection 仍经 observer 上报且不替换 factory cause | ✅ | `releaseHandleBestEffort` 内部 try/catch 全包（233-237），reject 仅 `dispatchObserver('handle-release-failed', exact cause)`（236）；主 fatal 仍以 factory `e` 为 cause（306）。既有测试 623-657 锁定「handle-release-failed 上报 exact cause + 主 fatal 保留 factory cause」，语义无回归（见下「行为兼容性」）。 |
| 3 | 清理 Promise 不得阻塞 factory fatal 交付 | ✅ | catch 块不再 `await` 清理（300）；fatal 在同次同步执行中 throw。新测试在 release 永不 settle 下断言 open() 非 pending 且 reject branded fatal（695-704）。 |
| 4 | 确定性回归测试（release 永不 settle → 仍 reject 原 factory branded fatal） | ✅ | 新增 `NeverSettleStubHandle`（`registry-open.test.ts:84-95`，`release()` 返回 `new Promise(() => {})`）与测试 659-714。确定性手法：排空微任务 `flushMicrotasks(20)` + 一个 `setImmediate` 宏任务后断言 settled 状态（690-693），零真实定时器；红灯证据为显式断言失败（自定义消息 695-698），非框架超时——符合硬约束 4。 |

新回归测试断言面对四个子要求的覆盖：恰一次（708）、不替换 cause（705 `outcome.cause === factoryCause` + 709-713 observer 事件 exact cause）、不阻塞交付（695-704 settled/rejected + branded 字段 operation/phase/committed=false）、确定性（690-693 无定时器、断言即红灯）。另含零回显负锁（706 `message` 不含 cause 文本，符合硬约束 6）。「release rejection 经 observer 上报」在永不 settle 场景本身不可触发，该面由未改动且保持绿色的既有测试 623-657 锁定——组合覆盖完整，无缺口。

## 反馈 2（合并前清理）：删除不可用的 testing overrides —— ✅ 完整实现

- `testing.ts:20-25`：`NamespaceRegistryTestingOverrides` 中 `createDocumentFactory?: never` 与 `scheduler?: never` 两字段连同各自注释已删除，仅剩 runtimeFactory/observer/diagnostics。
- 文件头 docstring（`testing.ts:8-12`）已按反馈要求重写：不再表述「never 预留」，改为说明该 seam 不在本切片预留、待真实实现时再加入——即反馈所指「第 10-11 行相关表述」的同步清理。
- 引用面核查（grep `createDocumentFactory|scheduler` 于 src+test）：残留仅两处——`testing.ts:10` 为上述说明性 docstring（记录删除决策，非代码引用）；`registry-open.test.ts:286` 的 `scheduler:` 属 `createMemoryPersistence`（persistence 包）参数（285-291 上下文确认），与本 overrides 无关，与简报「已知引用面」预查一致。无测试断言 overrides 键集。

## 反馈 3（合并前清理）：`git diff --check` —— ✅ 通过

- 三个指定文档（design_conflict_report / sa4_review / sa5_verify）diff 均为纯行尾双空格删除，无内容改动。
- 亲跑 `git diff --check HEAD`：exit 0，无输出。

## 非阻断建议「仅记录」核查 —— ✅ 正确限制

- `git diff HEAD` 全文 grep `seam-audit|closePromise|lifecycleTail|closing`：代码 diff 中零命中——两条建议均未实现。
- 记录在案：`wiki/raw/task_namespace-registry-open_rev2_ac_checklist.md:14-15` 以 N-1/N-2「📝 记录不实现」条目记录（留后续 issue 跟踪 / #112 落地时收敛），简报本体 64-67 行亦在案。

## 行为正确性分析（事件顺序与既有测试兼容性）

1. **事件顺序变化（round1 → round2）**：release reject 场景下，round 1 顺序为 `handle-release-failed` → `open-runtime-construction-failed` → fatal throw；round 2 为（同步）`open-runtime-construction-failed` → fatal throw →（微任务）`handle-release-failed`。规格反馈 1 未规定两事件顺序，仅要求「仍上报且不替换 cause」；既有测试 623-657 用 `events.find` 无序断言，不依赖顺序——**兼容，不构成回归**。
2. **623-657 测试在 fire-and-forget 下的确定性**：`await handle.release()` 命中已 rejected promise 时，其恢复续体（catch → dispatch `handle-release-failed`）在 catch 块同步执行期间即已入微任务队列，**先于** fatal throw 沿 await 链向上传播的各传播任务；微任务队列 FIFO 保证该事件在测试 `await p.catch()` 恢复前落袋——无竞态。
3. **浮动 Promise 无 unhandled rejection**：`releaseHandleBestEffort` 体内仅 `await handle.release()`（try/catch 全包）与 `dispatchObserver`（`observer.ts` 38-49 行内部 try/catch 隔离、绝不外抛），返回 Promise 不可能 reject；`void` 浮动安全。
4. **585-621 测试（observer 自身 throw）兼容**：observer throw 仍由 `dispatchObserver` 隔离；release 成功路径无 `handle-release-failed` 事件（620 断言成立）；fatal 品牌字段与零回显不变。
5. **恰一次语义保持**：见反馈 1 子要求 1 的同步发起论证；fire-and-forget 未引入第二次调用点。

## 缺失/部分实现清单

无。三条反馈（含反馈 1 全部四子要求 + 硬约束 4/6/7 相关项：确定性测试、零回显负锁、package.json 0.1.0→0.1.1 bump）均完整落地。

## Scope creep 清单

- **代码 diff**：无。registry.ts / testing.ts / registry-open.test.ts / package.json 的每个 hunk 均可一一对应到反馈 1/反馈 2/硬约束 7，无反馈未要求的代码改动。
- **wiki 域**：`task_namespace-registry-open_dispatch.md` +16 行（round 2 派发日志表）非反馈 3 点名的三个文档，但属简报第 8 行「工作流裁剪依据已记录于 dispatch log」要求的记录义务，且在硬约束 1 允许的 `wiki/raw/` 档案范围内；纯追加、无删除——定性为在档记录，非 scope creep，此处仅透明标注。
- **diff 外工件**：`wiki/raw/` 下 6 个 untracked rev2 档案（rev2 简报、ac_checklist、sa3_impl、sa4_review、sa6_red、sa7_report）不在 `git diff HEAD` 权威范围内，未评；REPORT.md 修改按指示出界。

## 疑似错误行为清单

无。事件顺序变化经上节论证为规格允许且与既有测试兼容的行为 delta。

**Verdict**: clear

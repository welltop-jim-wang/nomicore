# SA7 动态验证报告 — 修订轮 R1（PR #66 owner review 修订，第二轮执行链）

**Date**: 2026-08-21 21:31–21:40 (+0800)
**Verifier**: SA7（Dynamic Verifier）
**被验对象**: worktree `/home/wangjian/nomicore-fix-issue-58`，HEAD `c481ac8`（代码提交 `5906ad3` = SA4 R1 审查对象 + `c481ac8` 总控 git 清理，无代码）
**输入**: `task_file-persistence-plugin.md`（P3 简报）、`task_file-persistence-plugin_rev1.md`（修订轮 5 反馈 + 7 门禁）、`task_file-persistence-plugin_design.md`（SA1 R3 设计，决策 G/H/E4/F）、`task_file-persistence-plugin_sa4_review_r1.md`（verdict: pass，§3 交 2 项动态审核重点）
**方法**: 独立进程全量复跑 + 两个活链路探针（跑毕即删 / gitignored）+ flake 连跑 + CI run log 摘录
**环境事实**: Node v24.13.0（另有 /usr/bin v18.19.1 低于 engines >=20 不可用；**本地无 Node 20**，Node 20 档只能由 CI matrix 承担）；uid=1000 非 root（chmod r-x 手法有效，§8.1 本地实跑通过即为证据）；日志归档 `.mabf-bg/sa7-r1-*.log`（gitignored）

---

## Step 0 — SA4 verdict 校对

`task_file-persistence-plugin_sa4_review_r1.md` 顶部 `**Verdict**: pass` → 进动态验证。SA7 仅在 pass 基础上独立发现 fail，不下调 SA4 结论。

## Step 1 — 全量独立复跑（setsid nohup 独立进程，非会话内阻塞）

| 命令 | 结果 | 日志 |
|---|---|---|
| `pnpm test`（vitest run --typecheck，21:31:50 起，35.49s） | **Test Files 35 passed (35) / Tests 499 passed (499) / Type Errors no errors / EXIT=0** | `.mabf-bg/sa7-r1-full-test.log` |
| `pnpm typecheck`（4 个 tsconfig 链） | **EXIT=0** | `.mabf-bg/sa7-r1-typecheck.log` |

与 SA4 R1 报告 §0 最后一行的独立实测（35/499/双 EXIT=0）**逐字一致**。SA6 套件 `file-persistence.test.ts` 13 用例含在 499 内全绿 — Step 1 关通过。

## Step 2 — SA4 §3 动态审核重点逐条验证

### 重点 1：O-4 竞态探针（`[CORE_TEST_FACTORY]` vs 在途 `loadDoc` 同 key）— ✅ 响亮落败，无静默数据丢失

临时测试 `packages/persistence/test/sa7-r1-o4-probe.test.ts`（**已删除**，`git diff HEAD --name-only -- packages/` = 0 文件，无残留）：

- **确定性构造**：先以真实 timer 提交 `d1.snapshot`；随后 `loadDoc(ALICE,'d1')` 与 `createFileHandleForTest(...)` 在相邻语句连续调用、中间零 await——工厂的同步函数体先于 restore 的 readFile 完成回调（需事件循环回合）执行，故工厂**确定性地**观察到无 entry（§测试断言 `factoryHandle.doc.getMap('ROOT').get('v') === undefined` 证明其拿到全新空 Y.Doc）。
- **实测结果**（`PROBE_EXIT=0`，612ms）：
  1. restore 完成 → `entries.set(key,…)` 覆盖工厂 entry：`loadedHandle.doc !== factoryHandle.doc`，且 restored 内容 `'committed'` 正确胜出；
  2. **败方响亮**：`saveDoc(factoryHandle)` rejects `/foreign or released DocHandle/`（与 SA4 O-4 静态预判逐字一致），非静默损坏；
  3. 竞态不降级任何 entry：`getStatus() === 'ready'`；
  4. **胜方端到端完好**：mutate → saveDoc → 真实 flush → 磁盘字节经 `Y.applyUpdate` 还原为 `'after-race'`、`META.docId==='d1'` — 无数据丢失。
- 良性脚注（不构成缺陷）：被覆盖的工厂 entry E1 成孤儿，其 Y.Doc 未显式 destroy（交由 GC；`dispose()` 只遍历 `entries` 现存项）。test-only seam、生产不可达、P2 形态继承，与 SA4 O-4 定性一致。
- 证据：`.mabf-bg/sa7-r1-o4-probe.log`（`✓ sa7-r1-o4-probe.test.ts (1 test) 614ms`）

### 重点 2：CI spec 触发证据 — ✅ 存在双绿 run，但**归属链与本地 HEAD 不同**（详见下方重大披露）

CI run `32486106443`（https://github.com/welltop-jim-wang/nomicore/actions/runs/32486106443，pull_request，2026-08-21T13:17:58Z，conclusion **success**，headSha **`443afcd`**）：

- `test (20)`（job 96782928800）与 `test (24)`（job 96782928925）双绿，各步骤 log 摘录（两 job 同型）：
  - `✓ packages/persistence/test/file-persistence.test.ts (13 tests)`
  - `✓ packages/persistence/test/file-persistence-sa7-dynamic.test.ts (3 tests)`
  - `✓ packages/persistence/test/module-graph-regression.test.ts (3 tests)`
  - `Test Files 35 passed (35)` / `Tests 499 passed (499)`
  - 独立步骤 `Persistence contracts`：`1 passed (1)` / `6 passed (6)`；`Domain scaffolds check`：`2 passed (2)`；Typecheck 步骤含 persistence tsconfig。
- **关键限定**：`443afcd` 是远端分支尖端，**不是**本 worktree HEAD `c481ac8`；`module-graph-regression.test.ts` 是**远端链**的测试文件名（本链对应文件为 `module-graph.test.ts`，从未出现在任何 CI run——见下）。

## 补充活链路验证（SA7 自加）

### 真实进程深路径导入探针（复审门禁 #3 最强证据）— ✅

脚本 `.mabf-bg/sa7-r1-deep-import.mts`（gitignored），`pnpm exec tsx` 于**全新 node 进程**运行（无 vitest 模块注册表、全程零 `index.js` 导入——深路径是唯一入口，正是 pre-R1 TDZ 崩溃形态）：

```
[SA7-DIAG] fresh-process entry src/file.js   → construct OK, status = ready
[SA7-DIAG] fresh-process entry src/memory.js → construct OK, status = ready
[SA7-DIAG] file adapter dispose → status = disposed
[SA7-DIAG] real disk write landed: true → /tmp/sa7-r1-deepimport-…/users/alice/d1.snapshot
[SA7-DIAG] PASS: deep entries safe, round-trip OK      （DEEP_EXIT=0）
```

构造 + 真实写→flush→磁盘落盘 round-trip + dispose 全通过。门禁「adapter 模块可直接导入，不依赖导入顺序」在 vitest 之外的真实进程独立成立（与 `module-graph.test.ts` 3 用例互为冗余锚点）。

### flake 连跑 — ✅

`file-persistence-sa7-dynamic.test.ts` 额外连跑 3 次 3/3 全绿（今日累计 5 次运行：全量 1 + 探针批 1 + 连跑 3，全绿）。`ManualTimer` 确定性时序 + chmod 真实 errno 链路均无抖动。证据：`.mabf-bg/sa7-r1-flake.log`。

### SA4 其余观察项

O-1（注释措辞）/O-2（flush errno 不进降级信号，历史遗留 follow-up）/O-3（静态不可达死锁面）均非动态可验证点或非阻塞，无需追加运行时证据。

---

## 重大披露 — 双链并存（chain of custody，移交总控裁决）

SA7 在摘录 CI 证据时发现**同一基线 `e8e4fb8` 上存在两条平行的修订轮产物链**：

| | 本地链（本轮 SA7 被验对象） | 远端链（CI 已验证） |
|---|---|---|
| 提交 | `5906ad3`(21:17:22, "R1 owner-review fixes") → `c481ac8`(21:19:20) | `6c895fb`(20:47:55, "R3" 实现) → `44a944f`(21:17:00, wiki 档案) → `443afcd`(21:17:53, 派遣日志收口) |
| 命名 | 修订轮 R1（rev1.md 简报、sa4_review_r1、本报告） | R3/R2（`_revision.md`、`_sa2_review_r3.md`、`_sa4_review_r2.md`、`_sa7_report_r2.md`，并**删除** `_rev1.md`） |
| SA4 | r1 pass（审 5906ad3） | r2 pass（审 6c895fb） |
| SA7 | 本报告（审 c481ac8） | `_sa7_report_r2.md` 已入仓（含 6 组变异验证；自述被验 HEAD 6c895fb 的 worktree 就是本目录——即上一轮在此 worktree 执行后分支被重做为本地 R1 链） |
| push/CI | **未 push，0 个 CI run** | 已 push，run 32486106443 双 job 全绿 |

**代码关系**：两链实现同一组 owner 5 项修复，语义等价；文本差异集中在 6 src + 3 test 文件（大量为注释/命名）。唯一实质实现差：本地 `sweepLeftoverTmp` 把非 ENOENT 删除失败包装为新 Error（含 tmpPath+errno+`cause`）上抛，远端让原始 errno 直接传播——**两者对非 ENOENT 均响亮**，各自的 §8.1 型测试均绿。远端用 `module-graph-regression.test.ts`（另含静态 grep 守卫），本地用 `module-graph.test.ts`（纯运行时 3 入口）。

**后果与移交**：唯一现存的 CI 绿证据属于远端产物 `443afcd`；本报告验证的 `c481ac8` 没有任何 CI run。SA7 无权 push（任务简报明令禁止），也不宣称 CI 已绿。可选路径交总控：(a) push 本地链 → 触发新 CI run → runner 收割本链 spec 触发证据；(b) 与远端链对账/取舍。门禁 7「CI 由 runner 跟踪，本地必须双全绿」——本地双全绿已由本报告闭环。

## Spec 触发证据（SKILL 2026-06-09 / 2026-06-15 立法格式）

CI Run: https://github.com/welltop-jim-wang/nomicore/actions/runs/32486106443（headSha `443afcd`，**远端链**）

| Spec / 测试文件 | 触发结果 | log 摘录（test (20) 与 test (24) 同型） |
|---|---|---|
| `packages/persistence/test/file-persistence-sa7-dynamic.test.ts` | ✓ 3 tests passed（两 job） | `✓ packages/persistence/test/file-persistence-sa7-dynamic.test.ts (3 tests) 285ms` |
| `packages/persistence/test/file-persistence.test.ts`（SA6，M-1 零改动） | ✓ 13 tests passed（两 job） | `✓ packages/persistence/test/file-persistence.test.ts (13 tests) 1845ms` |
| `packages/persistence/test/module-graph-regression.test.ts`（远端链文件） | ✓ 3 tests passed（两 job） | `✓ packages/persistence/test/module-graph-regression.test.ts (3 tests) 7ms` |
| `packages/persistence/test/module-graph.test.ts`（**本链** R1 新增） | 🔥 未出现在任何 CI run | 原因：本链 HEAD `c481ac8` 未 push（**非 workflow 缺陷**：同一 include glob `packages/*/test/**/*.test.ts` 已在远端链证明收集并执行 module-graph 系 spec；vitest 为仓库根单配置运行，无 workspace package 漏配面） |

**verdict（spec 触发）**: ✅ 无孤儿 spec / 无 workflow 缺口；🔥 项纯属「HEAD 未 push」的链属事实，push 后由 runner 自动闭合（SA7 无 push 权限）。

---

## 结论

- **代码动态行为 verdict: pass** —— 全量 35 文件/499 用例双 EXIT=0 独立复现；SA4 两项动态审核重点全部验证通过（O-4 竞态按静态预判响亮落败、CI spec 证据已摘录并定界）；自加真实进程深导入探针与 flake 连跑全绿。R1 四项修订（决策 G/H/E4/F）的运行时语义在活链路成立。
- **移交项（非代码缺陷）**：本链 `c481ac8` 的 CI 证据缺口（未 push）与双链并存的取舍，交总控裁决；SA7 遵守禁令未做任何 push。
- **终态卫生**：临时探针测试已删除（`packages/` 对 HEAD 零 diff）；探针脚本与全部运行日志归档于 gitignored `.mabf-bg/sa7-r1-*`；未修改任何生产代码与既有测试。

## 验证命令与证据汇总

| 命令/操作 | 结果 | 归档 |
|---|---|---|
| `pnpm test`（独立进程） | 35/499 passed，Type Errors none，EXIT=0 | `.mabf-bg/sa7-r1-full-test.log` |
| `pnpm typecheck`（独立进程） | EXIT=0 | `.mabf-bg/sa7-r1-typecheck.log` |
| O-4 竞态探针（临时 vitest 文件，已删） | 1/1 passed，EXIT=0 | `.mabf-bg/sa7-r1-o4-probe.log` |
| `pnpm exec tsx .mabf-bg/sa7-r1-deep-import.mts`（真实进程） | 全部 PASS，EXIT=0 | `.mabf-bg/sa7-r1-deep-import.log` |
| 动态套件连跑 ×3 | 3/3 passed | `.mabf-bg/sa7-r1-flake.log` |
| `gh run view 32486106443 --log --job=96782928800/96782928925` | 双 job spec 行摘录如上 | 本报告 §重点 2 |
| `git fetch origin fix/issue-58-on-adr-server-design` + `git diff c481ac8 443afcd` | 双链差异事实 | 本报告「重大披露」节 |
| `git diff HEAD --name-only -- packages/`（收尾） | 空输出（探针无残留） | — |

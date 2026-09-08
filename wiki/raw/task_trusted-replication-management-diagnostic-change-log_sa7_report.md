# SA7 动态验证报告 — Issue #151 trusted replication / 复制管理写接入诊断变更日志

**Date**: 2026-08-31（Phase 4 dynamic verification）
**Verifier**: SA7（Dynamic Verifier——真实运行链路验证）
**被验对象**: commit `b5b0cb8` + 最终 worktree（`git diff b5b0cb8 -- packages/` 为空——代码面与 SA4 R2 复验对象逐字节一致）
**输入链**: SA4 R2 review（**Verdict: pass**，五项动态审核重点移交）、SA1 设计 `_design.md`（695 行 R2 终稿）、SA6 红灯 15 用例、SA4 探针 2 用例、任务简报 AC1–AC5。
**验证基线**: node v24.13.0 / pnpm 10.28.2 / vitest 3.2.7，全部测试命令独立进程后台执行（`setsid nohup`），零 ACP session 内同步阻塞。

**Verdict: pass**

> 判定依据：SA4 R2 verdict=pass（Step 0 校对通过，SA7 无「下发」权限）；SA4 移交五项动态审核重点全部在活链路兑现，红灯 15/15 + 探针 2/2 + SA7 新增 4/4 + 两包 365/365 + 全量 1837/1837 全绿；F1 修复的破坏性反证（mutation check）成立；无本地发现的新阻断项。CI run-log 证据属**环境阻塞**（本分支未 push——SA7 禁 push），非代码缺陷，不影响 verdict（详见 §6）。

---

## 0. Step 0/1 结论

```
[SA7 Step 0 结论]
SA4 verdict: pass（R2 复验报告，「R1 reject 解除」；R1 五项动态审核重点仍移交 SA7，不因 pass 豁免）
操作: 进 Step 1
```

```
[SA7 Step 1 结论]
SA6 红灯: 🟢 GREEN —— pnpm exec vitest run packages/namespace-runtime/test/runtime-replication-diagnostic-red.test.ts
          → 15/15 passed（两包全量复跑内含，/tmp/sa7/twopack2.log），红灯契约已全部转绿
操作: 进入 Step 2（SA4 清单驱动验证）
```

阅读量：11 文件（SA4 review、任务简报、设计 §0.4/§8/§9/§10/§12/§13/§15/§18/R2 修订、SA4 探针源、红灯测试源、replication-session.ts / replication-write.ts / runtime.ts / adapters/memory.ts / testing.ts / record.ts / close.ts 源码侧读、CI workflow）——在 15 文件上限内。

---

## 1. SA4 移交重点 1 —— §15.7(a) 物化面对账（活链路复核，F1 修复后 diff 形态）

**方法**：`git diff b66615c -- packages/namespace-runtime/src/replication-session.ts packages/namespace-runtime/src/replication-write.ts`（-530/+517，session 706 行改动 / write 341 行改动），逐 hunk 对账设计 §0.4 三仲裁（R-3.1/2/3）+ §12 L1–L6 + 接线豁免。

**replication-session.ts（19 hunk）对账结论**：

| hunk 群 | 差异内容 | 归类（登记面） |
|---|---|---|
| `@@ -141,200 +122,93`（最大块） | `SessionChannel`/队列/needsResync/pump/observerFailures/failures 扇出全套删除 → `SessionRegistry`（attach/detach/fenceStale/terminateAll） | **L1**（fanout 剥离）+ §5.4 SessionRegistry 接线豁免（「替代主线 fanout」） |
| `@@ -371,95 / -468,28 / -498,17 / -523,20` | createSessionCore：diag 挂装（source/context/emitAway/setOutcome/closedBy runtime-close 码域精化）；getStatus 删 `observerFailures`/`needsResync` 域、增 `closedBy` | **L1** + §9.3 映射接线 + §5.4 close 联动接线 |
| `@@ -548,47 +416,67` | `setOutcome` 单点 + R1/R2 槽内结局写入（A-e/A-b 映射行） | §9.3 映射接线 |
| `@@ -597,88 +485,130`（**F1 修复块**） | ① R3-R4 各拒绝分支 +`setOutcome`；② **R5 捕获窗口无条件挂接**：`host.doc.on('update', updateHandler)` 无 diag 条件（当前源码 `:554`）；③ `finally` 无条件双退订（`:578-579`）+ 仅 `diag.updateBytes` 赋值 diag 条件（`:580`）；④ **R6 门控 `if (capturedUpdate !== undefined)`**（`:586`）——主线无条件 await 改判据式 | **R-3.1 仲裁**（L6 登记的行为分叉）+ §8 捕获窗口接线 + **F1 修复**（§8 R2 修订注逐点一致：窗口无条件、退订无条件、diag 赋值条件） |
| `@@ -689 / -714 / -743 / -761 / -813 / -845 / -856` 尾部七块 | 仅注释压缩/精简（protectedContentEvaluated / protectedMapEqual / isWhitelistedValueContainer / protectedValueEqual / deepEqualPlain / writeDisabledMessage / open 门序注释）——判据逻辑逐行零变化（`isWhitelistedValueContainer`/`protectedValueEqual` 函数体与主线逐 token 相同） | 无语义差（注释面） |
| `@@ -880,9 +788,9` | `facts.state === 'disabled'` → `facts === undefined \|\| facts.state === 'disabled'` | 基线适配（本 worktree `state.replication` 投影域 disabled 时为 undefined——§6.1 V2.5 预投影域形状；主线为常驻对象）。行为等价：两形态同走 `REPLICATION_NOT_ENABLED` 拒绝（红灯用例 + 开门序测试绿） |

**replication-write.ts（11 hunk）对账结论**：

| hunk 群 | 差异内容 | 归类 |
|---|---|---|
| `@@ -10,55 +10,71` 头部 | imports：diag helpers 族（diagCapGate/diagFatalTx/diagDirtyFatal/diagValidationCode…）+ `*_CODE` 常量 + `SessionFanout`→`SessionRegistry` | §7/§9 接线 + L1 适配 |
| `@@ -102,16 / -129,27 / -159,6 / -170,51` | E1/E2 共享 gate（`runReplicationWriteGate`——主线 2026-08-27 已提取的同款结构）+ gate 结局 `setOutcome` + `refusalOf` 内联为 `disabled(...)`（同 message 逐字——SA4 E-2 已核，本次活链路 grep 复核调用形状一致） | 接线 + 零语义差重构（SA4 R1 §2.1 登记） |
| `@@ -252,37` | `describeOf` 注释/文案微调 | 注释面 |
| `@@ -293,14 / -309,25 / -336,22`（enable 槽） | **F2 修复块**：E3 成功分支 `if (diag !== undefined) diag.input = { snapshot: Object.freeze({ replicationId }) }`（`:309-311`，镜像 diagInputReady freeze 形态）；E-e/E-h issues 同源透传单构造；E4 通过后 `diag.context = {replicationId, replicationEpoch:1}`；E-g 幂等分支 context=既有事实 | **F2 修复** + §9.1 映射接线（E-f…E-k input=snapshot 兑现） |
| `@@ -366,12 / -383,50`（bump 槽） | B-e/B-f/B-g/B-h/B-i 各结局 setOutcome/diagFatalTx/diagDirtyFatal + E5 捕获窗口（**diag 条件**——与 apply 的无条件形成 §8「窗口订阅分化」）+ E5.5' `sessions.fenceStale` 替代 fanout fence（调用点/语义不变） | §9.2 映射接线 + L1 适配 |

**对账结论**：**零登记外漂移**——全部差异点落在 R-3.1（apply R6 判据化）/R-3.2（fatal 码值，errors.ts 面，SA4 15/15 已核）/R-3.3（lease 通道，不在两文件）+ L1（fanout 剥离）+ L3（wrapCore 剥离，lease.ts 面）+ L6（noop 分叉登记）+ diag 接线 + 捕获窗口 + SessionRegistry 适配 + F1/F2 修复。F1 修复后 diff 形态与设计 §8 R2 修订注（窗口无条件/退订无条件/diag 赋值条件）与 SA4 R1 指定修复方向**逐点一致**。

---

## 2. SA4 移交重点 2 —— §15.7(b) updateCapture:false 活链路（T1）

**新增用例**：`runtime-replication-sa7-dynamic.test.ts` 用例 1（`makeLog({updateCapture:false})` 等价装配——`createBoundedMemoryDiagnosticLog({inputPolicy:'digest', updateCapture:false})`，即生产默认捕获关闭）。

**链路**：裸 seam runtime → enable → internal 面开 hub-to-peer 会话（peer 角色）→ `applyRemoteUpdate(基态真增量 ROOT.n→42)`。

**实测结果（PASS）**：

| 断言面 | 期望（设计 §15.7(b) + AGENTS.md 冻结词表） | 实测 |
|---|---|---|
| apply 记录 result | `committed + update-omitted` + reason `update-capture-disabled` | ✅ `toEqual({kind:'committed', effect:'update-omitted', reason:'update-capture-disabled'})` |
| reason 词表闭包 | ∈ {`payload-too-large`, `update-capture-disabled`, `empty-update`} | ✅（且精确命中 `update-capture-disabled`——设计预期值） |
| 业务 `ok:true` 不变 | apply 结果联合不受日志捕获策略影响 | ✅ `{ok:true}` |
| live 集成效果 | ROOT.n=42 | ✅ |
| 持久化触发 | saveCalls=2（enable E6 + apply R6 有集成——**F1 修复后捕获策略关闭不影响 notifyDirty**，因 R6 判据读 capturedUpdate 而非 diag） | ✅ |
| source/context/input | `{kind:'replication', direction:'hub-to-peer', remoteInstanceId}` / `{replicationId, replicationEpoch:1}` / `{capture:'none'}`（raw bytes 省略投影，P8） | ✅ |
| 对照（enable 记录） | 同一存储策略下 enable committed 亦 update-omitted/update-capture-disabled | ✅ |

存储面机理活链路确认：producer 面 emit `effect:'update'` + updateBytes（本票恒产出的形态）→ adapter `physicalizeUpdate` 三守卫（adapters/memory.ts:211-226）在 `!updateCapture` 时转换 `update-capture-disabled`——「producer 零 update-omitted 产出、存储面承载」的设计 §10 钉死 #1 裁决在活链路成立。

---

## 3. SA4 移交重点 3 —— A-c runtime-close 路径 + in-flight FIFO（T2/T3）

### 3(a) runtime-close 终止 session（红灯未覆盖的 A-c 行）

**新增用例 2**。链路：enable → 开会话 s1 → `s1.close()`（显式对照）→ 开会话 s2 → `runtime.close()` → s2 后续 apply。

**实测结果（PASS）**：

| 断言面 | 期望（设计 §9.3 A-c 行 + §5.4） | 实测 |
|---|---|---|
| close() 返回前同步可观测 | `s2.getStatus()` = `{state:'closed', closedBy:'runtime-close'}` | ✅（terminateAll 在 close() 同步段、barrier 前） |
| 显式 close 对照 | `closedBy:'explicit-close'` + apply 拒 `REPLICATION_SESSION_CLOSED`（A-a，码域分野） | ✅ |
| runtime-close 后 apply | `{ok:false, code:'RUNTIME_WRITE_DISABLED'}` | ✅ |
| 零写入零通知 | ROOT.n 保持 1；saveCalls 停在 enable 的 1 | ✅ |
| 记录面（A-c） | stage `acceptance` / code `RUNTIME_WRITE_DISABLED` / sourceModule `runtime` / result `rejected` / input `{capture:'not-accessed'}` / source 复制三键 | ✅ 全中 |
| 对照记录（A-a） | code `REPLICATION_SESSION_CLOSED` / stage `acceptance` | ✅（码域分野在记录面同样成立） |

### 3(b) close-while-apply-in-flight FIFO 排空

**新增用例 3**（时序控制：可阻塞 notifyDirty——enable 与 apply 的槽内通知均挂起于受控 deferred）。

**实测结果（PASS）**：

1. enable E6 挂起（blocker.calls()=1）→ 放行 → enable ok:true；
2. apply 已接纳（A1–A4 通过、入队）→ 槽体推进至 R6 `await notifyDirty()` 挂起（blocker.calls()=2 轮询确认 in-flight）；
3. `runtime.close()` 调用（**不 await**——结构性证明 barrier 在被挂起 apply 之后，await 即死等）→ 同步段即时可观测 `s.getStatus()={state:'closed', closedBy:'runtime-close'}`；
4. 此刻 apply 未结算（`applySettled===false`——FIFO 顺序的活链路证据：close barrier 未跑 ⟹ apply 仍挂起）；
5. 放行 → apply 结算 `{ok:true}`（**已接纳任务无条件排空，ADR-0008**）、ROOT.n=42 集成生效、blocker.calls() 恰 2（无重复/无跳过通知）→ close barrier 随后结算（`await closePromise` 完成、`handle.releaseCalls===1`）；
6. close 后新 apply → `RUNTIME_WRITE_DISABLED`（A-c 路径复现）；
7. 记录面：in-flight apply 记录 `{stage:'transaction', result:{kind:'committed', effect:'update'}}` 照发（emit 不因 close 被吞）+ after-close 记录 `{stage:'acceptance', code:'RUNTIME_WRITE_DISABLED', result:{kind:'rejected'}}`。

> 过程注记：首轮该用例自死锁（await enable 于其 E6 挂起期间、release 在 await 之后）——测试侧 bug，修正为先挂起-轮询-放行-再 await（`/tmp/sa7/sa7test.exit=1 → sa7test2.exit=0` 的差异即此修正，非被测代码问题）。

---

## 4. SA4 移交重点 4 —— 无诊断基线行为等价 sweep（T4，F1 修复后）

**新增用例 4**。同一操作序列（enable → bump → open session(epoch=2) → apply 真集成 → apply 空 diff → bump(fence) → fenced apply）分别在**无 emitter 基线**（`createNamespaceRuntimeWithSeam({handle, notifyDirty})` 两参生产默认）与**有日志装配**上运行，逐项对照：

| 等价面 | 实测（两基线一致） |
|---|---|
| 结果联合（enable/bump/apply×3） | ✅ 逐项 toEqual 相等；enable/bump/apply集成 `{ok:true}`、apply noop `{ok:true}`、fenced apply `{ok:false, code:'REPLICATION_EPOCH_CONFLICTED'}` |
| saveCalls 轨迹 | ✅ `[1, 2, 3, 3, 4, 4]`（enable E6=1 → bump E6=2 → apply R6 有集成=3 → 空 diff apply 零通知(R-3.1)=3 → bump=4 → fenced apply 零通知=4）两基线逐位相等 |
| 最终业务状态 | ✅ ROOT.n=42 / META.replicationId=REPLICATION_ID / META.replicationEpoch=3（1→2→3）两基线相等 |

**破坏性反证（mutation check，临时诊断性变更已还原）**：临时把 apply R5 窗口退化为 diag 条件（`if (diag !== undefined) host.doc.on('update', ...)`——即 F1 缺陷形态）→ 本用例**立即失败**（无 emitter 基线 saveCalls 轨迹变为 `[1,2,2,2,3,3]`，apply 集成丢失通知），SA4 探针 A 同步红——证明该 sweep 是 F1 回归的真守卫，非恒真断言。还原后 `git diff` 零残留、`:554` 恢复无条件形态（`grep -c "SA7-DIAG" = 0`），全量复绿。

---

## 5. 基线回归 + 门禁（独立进程后台执行汇总）

| # | 命令 | 结果 | 证据 |
|---|---|---|---|
| B-1 | `pnpm exec vitest run packages/namespace-runtime/test/runtime-replication-sa7-dynamic.test.ts` | **4/4 passed，Type Errors no errors，exit 0** | `/tmp/sa7/sa7test3.log` |
| B-2 | SA4 探针 + SA6 红灯（两包全量内含） | 探针 **2/2**、红灯 **15/15** | `/tmp/sa7/twopack2.log` |
| B-3 | `pnpm exec vitest run packages/namespace-runtime packages/namespace-registry` | **44 文件 / 365/365 passed，exit 0**（361 存量 + SA7 新增 4；零回归） | `/tmp/sa7/twopack2.log` |
| B-4 | `pnpm test`（= CI Test step 命令，`vitest run --typecheck` 全量） | **145 文件 / 1837/1837 passed，Type Errors no errors**；exit 1 仅因 2 条 `[vitest-worker]: Timeout calling "onTaskUpdate"`（见 §6 环境注记） | `/tmp/sa7/fulltest2.log` |
| B-5 | `pnpm typecheck`（= CI Typecheck step 命令，十包 tsc） | **exit 0** | `/tmp/sa7/typecheck.exit` |
| B-6 | `pnpm exec tsc -p tsconfig.typecheck.json --noEmit`（root 配置——含 `packages/*/test/**`，测试文件权威类型门禁） | **exit 0（0 errors）** | `/tmp/sa7/roottsc.exit` |
| B-7 | mutation check（F1 缺陷注入 → B-1 用例 4 + 探针 A 双红 → 还原 → 复绿） | 守卫有效性 ✅ | `/tmp/sa7/mutation.log` |

首轮 `pnpm test` 曾暴露 SA7 自身新文件 2 处类型窄化错误（fixture.log 可选未收窄——`BoundedMemoryDiagnosticLog \| undefined` 不可传入必选参）——scoped vitest run 的 checker 只覆盖 `*.test-d.ts` 故「假绿」，被全量门禁（B-4 的 unhandled source error）抓出后修复（显式 unreachable 防御收窄），root tsc + 复跑全绿。此与 `task_registry-idle-plugin-shutdown_sa7_report.md` OBS-3 登记的同型陷阱一致。

**环境注记（非测试失败，已定性）**：B-4 的 2 条 `[vitest-worker]: Timeout calling "onTaskUpdate"` 为 vitest worker→主进程 RPC 超时（纯 vitest 内部栈、零应用帧）——本沙箱满载并行下的已知 flake，与 `task_namespace-runtime-replace-schema_sa7_report.md` / `task_namespace-runtime-skeleton-p0_sa7_report.md` / `task_root-schema-diagnostic-change-log_sa7_report.md`（本任务前序票，**同款签名同款条数 2**）登记一致；受影响两包单独串行重跑 exit 0 零工件（B-3）佐证非本改动引入。

---

## 6. CI / vitest 触发证据（SA4 移交重点 5）

### 分类：⛔ CI run-log 证据环境阻塞（非 fail、非 skip）

- 本分支 `fix/issue-151-on-docs-namespace-diagnostic-change-log` **未 push**（`git ls-remote --heads origin | grep 151` 空、`gh run list --branch <branch>` 空、无 PR）——SA7 职责边界明令禁 push/建 PR，CI run 不存在属**预期环境态**，无 run log 可摘录。**非 `spec-not-triggered` / `vitest-package-not-triggered`**（该分类要求「spec 在 runner 列表内缺席」，前提是 run 存在）。
- `gh` 工具链本身可用（已认证 `welltop-jim-wang`，repo `welltop-jim-wang/nomicore` 可达，main 分支 run 可查）——阻塞仅此分支的推送归属。

### 已交付的可行替代证据

**静态接线（SA4 E-6 独立复核延续 + SA7 活文件复核）**：

- `.github/workflows/ci.yml` `test` job（node 20/24 矩阵）step `Test: pnpm test` → 根 `package.json` `"test": "vitest run --typecheck"` → 根 `vitest.config.ts` `include: ['packages/*/test/**/*.test.ts', ...]`——本任务全部测试文件命中该 glob：
  - `packages/namespace-runtime/test/runtime-replication-diagnostic-red.test.ts`（SA6 红灯 15）✅
  - `packages/namespace-runtime/test/runtime-replication-sa4-probe.test.ts`（SA4 探针 2）✅
  - `packages/namespace-runtime/test/runtime-replication-sa7-dynamic.test.ts`（**SA7 本轮新增 4**）✅
  - 五个 registry 替身测试（loud stub 收容面）✅
  - step `Typecheck: pnpm typecheck` 含 namespace-runtime / namespace-registry 两包 tsconfig ✅
- CI 与本地同命令等价性：B-4/B-5 即 CI 两 step 的本地全量复跑（差异仅 CI 矩阵 node 20 亦跑一轮；本机 node 24.13.0）。

### 首轮 PR CI 的验收期望（交总控/发布阶段消费）

PR 建立后首个 CI run 的 `Test` step 应呈现：全仓 `Test Files 145 passed / Tests 1837 passed`（若 SA7 文件后无新增）；定向证据 `gh run view <run-id> --log | grep -E "runtime-replication"` 应见三文件齐现（`runtime-replication-diagnostic-red.test.ts (15 tests)` / `runtime-replication-sa4-probe.test.ts (2 tests)` / `runtime-replication-sa7-dynamic.test.ts (4 tests)`）。

## Spec 触发证据 (verdict 升级 — 2026-06-09)

CI Run: ⛔ 不存在（分支未 push，见 §6 分类）。

| Spec 文件 | 触发结果 | 说明 |
|---|---|---|
| —（无） | **N/A** | 本任务 SA1 设计新增/改动面**零 `*.spec.ts`**（无 E2E——设计 §18 文件清单全为 `src/`/`test/*.test.ts`）；SA4 review 亦无 `spec-not-triggered` 字段。Step 3 触发条件不成立 |

**verdict**: N/A（无 E2E spec 面）

## vitest 触发证据 (verdict 升级 — 2026-06-15)

CI Run: ⛔ 不存在（分支未 push，见 §6 分类）。以下为本地等价证据 + 静态接线：

| Workspace Package | CI Step Name | 触发结果 | log 摘录（本地 `pnpm test`/scoped run） |
|---|---|---|---|
| namespace-runtime | Test（`pnpm test`） | ✓ 本地 1837 全绿中含本包全量；scoped 串行 `Test Files 44 passed (44) / Tests 365 passed (365)`，exit 0 | `✓ packages/namespace-runtime/test/runtime-replication-diagnostic-red.test.ts (15 tests)`、`✓ packages/namespace-runtime/test/runtime-replication-sa4-probe.test.ts (2 tests)`、`✓ packages/namespace-runtime/test/runtime-replication-sa7-dynamic.test.ts (4 tests)` |
| namespace-registry | Test（`pnpm test`） | ✓ 同上（五替身 loud stub 收容文件在 44 文件内全绿） | `Test Files 44 passed (44)`（twopack2.log） |

**verdict**: ✅ 接线与本地全量触发成立；CI run-log 面待 push 后由发布阶段摘录（预期形态见 §6）

---

## 7. AC 覆盖对照（动态面）

| AC | 动态验证证据 |
|---|---|
| AC1 三 operation + 受控 source/context | 红灯 15/15（enable/bump/apply 双向 + context 冻结值）；T1 增补 updateCapture:false 面 source/context 三键断言 |
| AC2 既有稳定 phase/code/issues/committed 保留 | 红灯用例 3/8/9/10/11/12 + T2 增补 A-c（RUNTIME_WRITE_DISABLED acceptance + not-accessed——红灯缺口，本轮补上）；fatal 码值（R-3.2）15/15 内含 |
| AC3 detached owned Yjs bytes + noop/update-omitted 显式 | 红灯用例 1/4/5/6/11（链式重放 + 空 doc 不物化反向鉴别）+ 用例 7（noop）；**T1 增补 update-omitted/update-capture-disabled 活链路**（SA4 移交 §15.7(b)——producer 恒不产出的分支由存储面兑现） |
| AC4 日志故障/队列压力零业务影响 | 红灯用例 13/14（hostile emitter + capacity:1 drop）；**T4 增补无 emitter 基线三面等价 sweep + F1 mutation 反证**（日志装配状态不改变业务结果——SA8 钉死 #5 双向兑现） |
| AC5 双向 + transport 隔离 | 红灯用例 5/6（双字面量）+ 15（session open/close/status 零记录）；T2 顺带复核 open 零记录（全程记录数恰等于操作数） |

---

## 8. 产出物与登记

| 产物 | 位置 | 状态 |
|---|---|---|
| 动态验证报告（本文） | `wiki/raw/task_trusted-replication-management-diagnostic-change-log_sa7_report.md` | ✅ |
| SA7 补充测试（4 用例：§15.7(b) / A-c×2 / 等价 sweep） | `packages/namespace-runtime/test/runtime-replication-sa7-dynamic.test.ts` | ✅ 新增（SA7 owned，断言全锚运行时行为——结果联合/saveCalls 计数/record 内容/doc 状态，零源码 grep；root tsc 0 errors；已入 B-3/B-4 全量绿） |
| 临时诊断变更（F1 mutation） | — | 已还原（`git diff -- packages/namespace-runtime/src/` 为空） |

**登记建议（非阻断，供下一轮 SA1 文档修订顺带收编）**：SA7 测试文件建议按 SA4 探针先例（§18「R2 修订追加（SA4 owned）」）补一行 `[SA7 owned]` ALLOW 条目——DENY 兜底条目「非 ALLOW LIST 已列文件」的措辞会把它误扫为超 scope；属文档形式收编，代码不回滚（SA7 补充测试是 skill 规定产出）。

---

## 9. 结论

1. **SA4 移交五项全部闭合**：§15.7(a) 对账零登记外漂移（F1 修复后 diff 形态与设计 §8 R2 修订注逐点一致）；§15.7(b) update-omitted/update-capture-disabled 活链路兑现；A-c runtime-close 路径（含显式 close 码域分野对照）+ in-flight FIFO 排空时序实测成立；无 emitter 基线三面等价 sweep 通过且经 mutation 反证具备真守卫力；CI 面以本地全量 + 静态接线交付可行证据（run-log 待 push 后摘录，预期形态已登记）。
2. 全量门禁绿：红灯 15/15、探针 2/2、SA7 4/4、两包 365/365（44 文件）、全仓 1837/1837（145 文件）、`pnpm typecheck` exit 0、root tsc exit 0——零存量回归。
3. 无本地发现的新阻断项；生产代码零触碰（mutation 已还原并验证）。
4. **Verdict: pass**。

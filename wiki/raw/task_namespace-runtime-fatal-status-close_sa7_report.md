# SA7 动态验证报告 — namespace-runtime fatal / capability status / close 生命周期（issue #92）

**Date**: 2026-08-25 10:30 CST
**Verdict**: **pass（本地动态验证全绿；CI 双矩阵证据因分支未发布而环境阻塞，非实现缺陷——见 §重点1）**
**被验对象**: commit 91103db（SA3 实现；基线 588fa2b..HEAD）+ SA7 新增动态锚
**SA4 前置**: `task_namespace-runtime-fatal-status-close_sa4_review.md` Verdict = pass（Step 0 校对通过，SA7 未越权）
**环境**: Node v24.13.0（本机唯一可用的目标矩阵版本；另仅存 v18.19.1 非目标）、pnpm 10.28.2、vitest 3.2.7、零网络零端口

---

## Step 0 — SA4 verdict 校对

- SA4 顶部 `**Verdict**: pass` → 进入 Step 1。✅

## Step 1 — SA6 红灯测试复跑（第二关）

命令（独立进程 setsid nohup，2026-08-25 10:16）：

```
pnpm exec vitest run packages/namespace-runtime/test/runtime-close-lifecycle.test.ts \
  packages/namespace-runtime/test/runtime-close-lifecycle-type-guard.test-d.ts --typecheck
```

**结果 exit 0**：

```
 ✓ packages/namespace-runtime/test/runtime-close-lifecycle.test.ts (8 tests) 46ms
 ✓  TS  packages/namespace-runtime/test/runtime-close-lifecycle-type-guard.test-d.ts (3 tests)
 Test Files  2 passed (2)
      Tests  11 passed (11)
Type Errors  no errors
```

[SA7 Step 1 结论] SA6 红灯: 🟢 GREEN → 进入 Step 2。

## Step 2 — SA4《动态审核重点（交 SA7）》五项逐项回应

### 重点 1 — Node 20/24 双矩阵 CI 证据（AC9）：⚠ 环境阻塞（非 fail，实现侧无缺口）

- `gh pr list --state all` / `gh run list` 实测：分支 `fix/issue-92-on-docs-namespace-runtime` **未 push、无 PR、无 CI run**（最近 run 为 #101/#85 的 2026-08-24/25 既有 run，无一包含 91103db）。发布属总控职责（SA7 边界：不 push、不建 PR、不宣称 CI 已绿）。
- 本机无 Node 20（仅 v24.13.0 与 v18.19.1，后者非目标版本），本地双矩阵不可替代。
- 本地 Node 24 全量门禁独立复跑全绿（见 §门禁基线）。静态接线已由 SA4 核过（ci.yml matrix node [20,24]、`Test: pnpm test`、`Typecheck: pnpm typecheck`）；发布后按 §发布后 CI 取证清单补录双矩阵 log 摘录即可闭环。
- **判定：pending-publish（环境阻塞），不计入 fail。**

### 重点 2 — 未 catch 的失败 close → unhandledRejection（R1 登记）：✅ 三层证据，且风险结构性不可达

1. **静态 grep**：生产代码/配置/CI 零 `process.on('unhandledRejection'|'uncaughtException')`（全仓命中仅 `packages/persistence/test/file-persistence-sa7-dynamic.test.ts:141-153` 的测试内临时监听，`process.off` 用后即撤；及 wiki 文档）。`vitest.config.ts`、ci.yml、根 scripts 无 `--unhandled-rejections`/`forceExit` 类旗标。
2. **独立进程探针**（tsx 裸 Node 进程，脱离 vitest；探针文件已按临时诊断纪律删除，命令与输出留档）：
   - 基线对照：`process.on('unhandledRejection')` + `Promise.reject` → 事件送达（plain node 与 tsx 行为一致——tsx 不吞事件）；
   - Probe A（调用方 catch）：失败 close rejection 正常消费 `PROBE-A-caught NSRT-CLOSE-RELEASE-FAILED lifecycle=closed`，exit 0 零噪声；
   - Probe B（**宿主误用：丢弃不 catch**）：**无 unhandledRejection、无崩溃，exit 0 存活至定时器**；
   - Probe C（宿主自注册 handler）：handler 从未收到该事件，进程存活 exit 0。
3. **结构性根因（比 SA4 的预期更强）**：`sequencer.enqueue` 返回的 `settled` 就是调用方拿到的 close Promise，而链尾恒绿接线 `this.tail = settled.then(noop, noop)`（`sequencer.ts:40`）已在**同一 Promise 对象**上挂了拒绝处理器——被丢弃的失败 close **永不**升级为进程级 unhandledRejection/exit。SA4 担心的「测试/宿主误用被引爆」在当前实现下不可达。
   - 持久锚：**DV-7**（`runtime-close-sa7-dynamic.test.ts`）——临时进程监听 + 丢弃失败 close + 50ms 真实时钟窗口断言零事件，且晚到观察者仍收到 rejection（「不吞没」成立，失败另经 `getStatus().close` 可观测）。
   - **INFO（不阻塞，建议总控留档）**：设计 R1 风险登记把「调用方不 catch → unhandled rejection」记为契约后果，而实测该后果在 Node 进程层不发生（拒绝仍按 API 契约送达任何观察者——AC7 无违反）。同一形状自 #90 起对 fatal rejection 即存在（同 sequencer 机制），非 #92 新引入。

### 重点 3 — 真实 handle 的 close 冒烟：✅ DV-3 绿（本任务首个真实 persistence close 证据）

`createMemoryPersistence`（共享 store 双实例，全部公开 I/O hook）→ `createDoc` → seam 构造（`notifyDirty: () => writer.saveDoc(handle)` 生产绑定形态）→ P0 ready → `mutateRoot n=42` ok:true → 等 debounce flush 真实落盘 → `close()`：

- close 同步进入 closing；resolve 后 `handle.getStatus() === 'released'`（**真实 release 实现终态**，ADR-0006 契约）；
- Runtime `lifecycle='closed'`、`status.close === null`、三能力位 false；
- close 后 read `RUNTIME_READ_DISABLED`（同步结果联合）、新写 `RUNTIME_WRITE_DISABLED` 零入队；
- 幂等：后续 `close()` 同一 Promise 实例；
- 跨实例持久化：close 后全新 reader `loadDoc` 读到 `n=42 / a='x'`（非 live-doc 别名）。

（SA6 锚全 fakeHandle 属 fixture 纪律；本冒烟补上真实 release 语义面。）

### 重点 4 — release 永不 settle → close 永挂起（R2）的 JSDoc 可见性：✅ 抽查通过

- `runtime.ts:112-114`（close 键 JSDoc）：「close 前已接纳任务无条件排空（**不取消、不设内部 timeout**）」；
- `runtime.ts:119-124`：notifier 内 await 本 close Promise 的自等待死锁形态文档化（「双双永挂起，属契约行为，调用方不得如此使用」）；
- `close.ts:10-11`：「release 永不 settle → close Promise 永挂起，属 ADR 契约行为」。
- vitest 不可锚（挂起即超时误报）——与 SA4 判断一致，无需补锚。

### 重点 5 — function-thenable release（§6.2 #15）运行时锚：✅ DV-5 绿 + DV-6 破坏性补充

- **DV-5**：`release()` 返回「带可调用 `.then` 的 function」（ECMAScript thenable 函数形态）→ close 接收并正常 await：resolve、release 恰一次、`closed`、`close` 摘要 null、已结算后 close 同一 Promise——**不把实际成功的 release 误报为失败通道**（close.ts:38 判定分支自此有运行时锚）。
- **DV-6（破坏性补充，同一守卫另一臂）**：`release()` 返回非 thenable（`42`）= adapter 契约违背 → 拒绝虚假降级：close reject（`code='NSRT-CLOSE-RELEASE-FAILED'` 稳定、`cause` 保留原始 TypeError）、仍 `closed`、`closeIssue` 冻结跨调用同引用、后续 close 同一 Promise 同 rejection 原因身份、read/write 停接纳。

## SA7 产出测试文件

- **新增**：`packages/namespace-runtime/test/runtime-close-sa7-dynamic.test.ts`（4 用例：DV-3 真实 handle close 冒烟 / DV-5 function-thenable / DV-6 非 thenable 契约违背 / DV-7 丢弃失败 close 零 unhandledRejection 且不吞没）。单文件复跑 `exit 0：1 file / 4 tests passed，Type Errors: no errors`（80ms，确定性）。
- **未改动**：SA6 两锚、全部冻结锚、生产代码（`git status` 净：仅本测试文件新增；`.mabf*` 为总控既有状态）。
- 临时探针 `packages/namespace-runtime/sa7-close-probe.tmp.mts` 已删除（技能纪律：临时诊断用后还原）。

## 门禁基线（SA7 独立进程复跑，2026-08-25 10:16–10:26）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 全量测试（SA7 进入前基线） | `pnpm test` | exit 0：**86 files / 1089 tests / Type Errors: no errors**（与 SA4 记录一致） |
| 七包类型 | `pnpm typecheck` | exit 0 |
| 全仓测试类型（含新增 DV 文件） | `pnpm exec tsc -p tsconfig.typecheck.json --noEmit` | exit 0 |
| **收尾全量（含 DV 新锚）** | `pnpm test && pnpm typecheck && tsc -p tsconfig.typecheck.json` | **exit 0：87 files / 1093 tests / Type Errors: no errors**（恰 +1 file/+4 tests = SA7 新锚，无意外增删） |

## Step 3 — E2E spec 触发证据：N/A

本任务 SA1 design 零 `*.spec.ts`（新增测试均为 vitest `*.test.ts`/`*.test-d.ts`）；SA4 §1.3 同判「E2E spec 本任务为零，N/A」。无未触发 spec。

## Step 4 — vitest 触发证据（2026-06-15 立法）

CI Run: **无（分支未发布——pending publish）**。本地动态证据：

| Workspace Package | CI Step Name | 触发结果 | 证据 |
|---|---|---|---|
| namespace-runtime | `Test: pnpm test`（ci.yml，Node 20/24 matrix） | 🟡 本地已触发全绿 / CI run 待发布 | 本地 `pnpm test` exit 0：`runtime-close-lifecycle.test.ts (8 tests)`、`runtime-close-lifecycle-type-guard.test-d.ts (3 tests)`、`runtime-close-sa7-dynamic.test.ts (4 tests)` 全部出现在通过列表（87 files/1093 tests） |
| namespace-runtime | `Typecheck: pnpm typecheck` | 同上 | 本地 exit 0 |

**判定**：`vitest-package-not-triggered` 不成立（包已接入 CI 静态门禁且本地实跑全绿；阻塞点仅是「CI run 尚不存在」）。**verdict: pending-publish** —— 发布后按下节清单补录双矩阵 log 摘录即闭环。

## 发布后 CI 取证清单（交总控，发布动作完成后）

```bash
gh pr view <PR-num> --json statusCheckRollup        # 或 gh run list --branch fix/issue-92-on-docs-namespace-runtime --limit 5
gh run view <run-id> --log --job='test (20)' 2>&1 | grep -E "runtime-close-lifecycle|runtime-close-sa7-dynamic|Test Files|Type Errors" | head
gh run view <run-id> --log --job='test (24)' 2>&1 | grep -E "runtime-close-lifecycle|runtime-close-sa7-dynamic|Test Files|Type Errors" | head
```

预期：两 leg 全绿且均含 `runtime-close-lifecycle.test.ts (8 tests)`、`runtime-close-lifecycle-type-guard.test-d.ts (3 tests)`、`runtime-close-sa7-dynamic.test.ts (4 tests)` 通过行。

---

## 总结论

- **verdict: pass（本地动态验证）** — SA6 两锚 11 用例绿；SA4 五项动态重点：重点 2/3/4/5 全部以运行时证据关闭（DV-3/DV-5/DV-6/DV-7 四新锚入库），重点 1（CI 双矩阵）环境阻塞于分支未发布、非实现缺陷；
- 无任何生产代码修改；唯一代码面增量 = SA7 测试文件；
- 新基线 **87 files / 1093 tests**，三重门禁全绿；
- INFO 一条（重点 2 结构性发现 + 设计 R1 措辞与实测 Node 行为的差异）供总控留档，不构成退回理由。

# SA7 动态验证报告 — doc-runtime committed-aware transaction fatal 契约（issue #87）

**Date**: 2026-08-23
**Verifier**: SA7（Dynamic Verifier；未修改任何生产代码；仅新增补充测试与本报告）
**被验对象**: SA3 实现 commit `8ef2824`（fatal 契约落地）+ commit `87ea526`（SA4 F-1 修复，placeSet 返回完整 proposed ROOT）
**输入**: SA4 静态验尸报告 R2（verdict=pass；R1 §10「动态审核重点」5 项移交清单）、SA1 设计 R3.1、SA6 红灯测试（20 用例）+ SA4 复现锚（2 用例）
**环境**: worktree `/home/wangjian/nomicore-fix-issue-87`；Node v24.13.0（本机唯一 Node 运行时）；yjs 实装 13.6.32；全部测试命令独立进程执行（`setsid nohup`，技能规范）

---

## Step 0 — SA4 verdict 校对

SA4 报告顶部 R1 行为 `reject`，但 R1 记录按惯例完整保留供溯源；**R2 定点复审段（R2.5）为最新裁决：`Verdict: pass`**（F-1 唯一阻塞项经 87ea526 外科修复、复现锚 2/2 转绿、全量 237/237 零回归、fatal 通道零触碰确认）。与总控移交简报一致（「SA4 静态验尸 R2 verdict=pass」）。

> [SA7 Step 0 结论] SA4 verdict: pass（R2.5 最新裁决） → 进 Step 1。

## Step 1 — SA6 红灯测试复跑

命令（独立进程）：
```
npx vitest run packages/doc-runtime/test/transaction-fatal-materialize-contract.test.ts \
  packages/doc-runtime/test/apply-validated-mutation-fatal-contract.test.ts \
  packages/doc-runtime/test/apply-validated-mutation-nested-path-repro.test.ts
```
结果：**3 文件 / 22 用例全绿**（SA6 16+4 + SA4 复现锚 2），`Type Errors no errors`，exit 0。

> [SA7 Step 1 结论] SA6 红灯: 🟢 GREEN → 进入 Step 2。

---

## Step 2 — SA4 R1 §10「动态审核重点」逐项处置（5/5）

### 1. F-1 修复回归 — ✅ 本地面闭合；CI 矩阵腿登记为发布后

| 命令（独立进程） | 结果 |
|---|---|
| 复现锚（上表 3 文件之一） | 2/2 转绿 ✓ |
| `npx vitest run packages/doc-runtime` | **18 文件 / 245 用例全绿**（R2 基线 237 + SA7 新增 8），`Type Errors no errors`，exit 0 |
| `pnpm test`（根，与 CI `Test` 步逐字同命令） | **69 文件 / 957 用例全绿**，`Type Errors no errors`，exit 0 |
| `pnpm typecheck`（根 6 包，与 CI `Typecheck` 步逐字同命令） | exit 0，0 error |

- F-1 双形态（常规 schema 嵌套 set / 同构可互验 schema 静默重塑）由复现锚 + 既有用例锁定全绿；SA7 未发现回归。
- **CI Node 20/24 矩阵日志（清单原文要求项）：本地不可达，如实登记**——
  `gh run list --branch fix/issue-87-on-docs-namespace-runtime` → 空；`git ls-remote origin <branch>` → 空（分支未 push、无 PR）。该证据属发布后 runner 面（SA7 职责边界：不 push、不建 PR、不宣称 CI 已绿）。
  本地覆盖情况：本机仅 Node v24.13.0（无 Node 20 运行时/nvm）→ **矩阵 24 腿已由上述本地全量运行覆盖，20 腿未本地覆盖**。
  发布后取证据命令（供总控/后续阶段执行）：`gh run list --branch fix/issue-87-on-docs-namespace-runtime --limit 3` → `gh run view <run-id> --log --job="test (20)" | grep -E "Test Files|Tests |Type Errors"`（20/24 两 job 各摘录一次）。

### 2. 伪造 branded 三投递路径 — ✅ 全部运行动态实证（新增持久测试 4 用例）

SA4 R1 §5 的 PoC 脚本（跑完即删）已固化为 CI 可回归的持久测试：**`packages/doc-runtime/test/sa7-fatal-dynamic-verify.test.ts`**（8 用例，4/8 绿 + 4 例归第 4/5 项）。

| 投递路径 | 动态结果（断言实测） |
|---|---|
| ① observer 投递（one-shot observer 抛 `new DocRuntimeFatalError('pre-commit-internal', false, …)` 伪造 committed:false） | 交付 E203 branded：`committed:true`（**伪造的 false 未被交付**，W3 不降格）、`phase='observer-cleanup-throw'`、`cause === spoof 实例`（零信息损失）、message 含 DOCRT-E203 + spoof 原文「」定界；update 计数=1、title/count 已落盘（提交事实诚实）、无回滚声称 ✓ |
| ② 信封投递（mutation 信封 Proxy 的 ownKeys trap 抛 spoof） | `ok:false` + 恰 1 issue `DOCRT-E205`（含 spoof 原文）+ **state 字节逐字节不变**（类 B 分级：敌意数据不升格 fatal）✓ |
| ②' value 投递（value Proxy get trap 在 (F) 校验读抛 spoof） | `ok:false` 领域联合，实装收敛为 **`VFSL-E100: 内部错误（意外异常）: spoof-branded-value`**（vfsl INV-6 内收，与 SA4 R1 §5 观察一致——比 E205 早一层、方向同为领域联合）+ state 字节不变 + cfg.level 保持铺底值 ✓ |
| ③ ⑥ derived 计数 Proxy 投递（ROOT 提交后首次读 `derived.structure` 抛 spoof） | 交付 E201 **变体 D** branded：`committed:true`（伪造 false 不透传）、`phase='post-commit-verification'`、message 含「无法完成」+ spoof 原文、`cause === spoof 实例`；update=1、已安装子树保留（不补偿）✓ |

### 3. Node 20/24 矩阵 CI 证据 — ⚠️ 发布后 runner 面，本地不可达（如实登记，未伪造）

- 分支未 push（`git ls-remote` 空）→ 无本任务 CI run；PR #85（base）的绿色 run（32624294850，test (20)/(24) 双 job SUCCESS）**不含**本任务两个 commit，不作为本任务证据引用。
- 覆盖面静态确认（SA4 §1.4 已做 + SA7 复核）：`.github/workflows/ci.yml` `Test` 步 = `pnpm test` = `vitest run --typecheck`，根 vitest.config include `packages/*/test/**/*.test.ts` → 本任务 4 个测试文件（SA6 ×2 + SA4 复现锚 ×1 + SA7 新增 ×1）均在 CI 触发面内；`Typecheck` 步 = `pnpm typecheck`。本地已按同命令复跑全绿（见第 1 项）。
- 缺口登记：Node 20 腿运行时证据、两 job 的 `Test Files/Tests/Type Errors` 日志摘录——待 push 后按第 1 项登记的命令补录。

### 4. (F)(G) 双读窗口（设计 §7.5 登记移交） — ✅ 无未登记行为；实测呈现登记形态 C（发散），证据披露

一次性诊断探针（tsx，跑完即删）实测：
```
[SA7-DIAG] seed.ok = {"ok":true}
[SA7-DIAG] reads = 4 | res = {"ok":true}
[SA7-DIAG] persisted level = "second-read"
[SA7-DIAG] form = C(ok:true 发散——§7.5 登记移交)
```
- **实测形态 = C**：对抗 getter（首读 'first-read'、次读起 'second-read'）经 `set(['cfg'])` 投递 → `ok:true` 且落库 'second-read'（(F) 校验首读值 ≠ (G) 构造落库值）。合计 4 次读取，(F)/(G) 两阶段均真实触达（探针有效性）。
- **判定：登记面内，非未登记行为**。设计 §7.5「(F)(G) 双读窗口」独立条目原文已登记该形态（「构造产物可能未经校验值落库且 ok:true」→「登记接受 + 移交」；「发散但不抛 → 留待完整任务（⑥ 式产物回读仲裁）」），SA2 R3 pass 附条件接受。SA7 断言的「未登记行为」（逃逸 throw / ok:false 却有写入 / ok:true 却落库捏造值 / 声称回滚）**零出现**。
- SA4 清单括注「本切片允许 ok:false 或两读一致两形态」与设计 §7.5 登记集（三形态：A/B/C）存在表述差——实测为形态 C，与设计登记完全一致，SA3 实现无走样；按设计（SA1 R3.1 + SA2 放行）判定本项 **pass（形态 C 证据披露，移交完整 validated-mutation 任务面）**。
- 持久化锚：`sa7-fatal-dynamic-verify.test.ts` 第 4 项用例——断言结果必居登记三形态之一 + 元契约（ok:false ⇒ state 字节不变；ok:true ⇒ 落库值 ∈ getter 真实产物集，禁捏造值；禁逃逸 throw）。若未来实现出现未登记行为即红。

### 5. yjs 版本面（P-5） — ✅ 实装版本一致 + genuine 三窗口谓词动态实证

- **版本一致性**：本地实装 `node_modules/.pnpm/yjs@13.6.32` = `pnpm-lock.yaml` 锁定 `yjs@13.6.32`；CI `Install dependencies` 步 `pnpm install --frozen-lockfile` → **CI 实装与本地逐字节同版**（满足 ^13.6.30）。本地动态结果即该版本下的行为证据。
- **genuine 谓词动态实证**（`sa7-fatal-dynamic-verify.test.ts` 第 5 项 3 用例，全绿）：
  - 干净语境：`doc._transaction === null` 且 `_transactionCleanups` 为空数组（genuine 字段形态，与 yjs dist `Doc.d.ts:49/53` 声明面一致）→ guard 放行，materializeRoot `ok:true`；
  - 窗口 A（genuine）：`doc.transact` 回调内 `_transaction` 非 null → E202 变体 A（「doc._transaction 非空」文本锚 + 指名 materializeRoot）+ state 字节不变；
  - 窗口 B（genuine，mutation 侧指名补证）：OTHER map observer 派发期 `tx === null && _transactionCleanups.length > 0`（谓词右支实证）→ E202 变体 B（「派发期间」+ 指名 `applyValidatedMutation`、不含 materializeRoot——E202 参数化动态面）+ 零写入。
- 窗口 C fail-closed 三形态（合成）与 cleanup 队列 wedge：既有 `materialize-root-rev2.test.ts` RT-3/RT-4 锚定，本次全量运行全绿（957/957 内）。

---

## Step 3 — E2E spec 触发证据：N/A

本任务 diff 无任何 `*.spec.ts`（SA4 §1.3 同判；SA7 新增物不含 spec）。无 E2E spec 触发面，无需 CI runner 摘录。

## Step 4 — vitest 触发证据（动态面）

| Workspace Package | CI Step Name | 触发结果 | 证据 |
|---|---|---|---|
| `@nomicore/doc-runtime`（含本任务 4 个测试文件） | `Test`（`pnpm test` = `vitest run --typecheck`） | ✓ 本地同命令全绿：69 文件 / 957 用例 / Type Errors no errors / exit 0 | 本报告第 1 项表 |
| 同上 | `Typecheck`（`pnpm typecheck`） | ✓ 本地同命令 exit 0 | 同上 |

- 触发面静态链：根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` ⊇ `packages/doc-runtime/test/*.test.ts`（SA7 新增文件匹配同一 glob，push 后自动入 CI runner）。
- **CI runner 内的实际日志摘录（`Running N tests` 形态）属发布后 runner 面**：分支未 push（见第 3 项登记），本地不可达，如实登记不伪造。

---

## 破坏性/补充性测试产物

- **新增**：`packages/doc-runtime/test/sa7-fatal-dynamic-verify.test.ts`（8 用例：重点 2 ×4 / 重点 4 ×1 / 重点 5 ×3；含元契约断言，未登记行为出现即红）。
- 复用（已有，本轮验证转绿）：SA6 两契约文件 20 用例 + SA4 复现锚 2 用例。
- 未修改任何生产代码（`git status`：生产路径零 diff；`wiki/raw/*_dispatch.md`/`*_sa4_review.md` 的未暂存修改为 SA4 轮遗留，非 SA7 所为）。临时探针（tsx / [SA7-DIAG]）已删除。

## 环境阻塞与如实登记清单（非伪造项）

| 项 | 阻塞原因 | 补证据路径 |
|---|---|---|
| CI Node 20/24 矩阵 `Test`/`Typecheck` 步日志摘录（清单第 1/3 项 CI 腿 + Step 4 runner 摘录） | 分支未 push、无 run（`gh run list --branch` 空；`git ls-remote` 空）——发布后 runner 面，SA7 无 push/PR 权责 | push 后：`gh run list --branch fix/issue-87-on-docs-namespace-runtime --limit 3` → `gh run view <id> --log --job="test (20)" / --job="test (24)"` 摘录 `Test Files/Tests/Type Errors` |
| Node 20 腿本地覆盖 | 本机仅 Node v24.13.0（无 nvm/Node 20 二进制） | 同上（CI matrix 20 job） |

## verdict: pass

- Step 0 前提成立（SA4 R2 pass）；Step 1 SA6 红灯 22/22 转绿；
- SA4 R1 §10 五项：第 1（本地面）/2/4/5 项全部动态实证通过；第 3 项（CI 矩阵日志）按总控预判属发布后 runner 面，如实登记（未伪造、未宣称 CI 已绿）；
- 独立发现面：SA7 全部动态探针（含伪造 branded 三投递、双读窗口、E202 谓词）未发现 SA4 R2 pass 之外的任何缺陷；第 4 项实测形态 C 与设计 §7.5 登记逐字一致（登记移交完整任务，非本切片缺陷）；
- 零生产代码修改；新增 8 用例补充测试全部入 CI 触发面。

verdict: pass

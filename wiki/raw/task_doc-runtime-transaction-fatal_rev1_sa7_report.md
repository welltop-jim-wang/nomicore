# SA7 动态验证报告 — 修订轮 R1（公共 API 面收缩，issue #87 / PR #96）

**Date**: 2026-08-23
**角色**: SA7 Dynamic Verifier（SKILL sa7-dynamic-verify）
**Worktree**: /home/wangjian/nomicore-fix-issue-87（branch fix/issue-87-on-docs-namespace-runtime，HEAD 18fa7c0 + 未 commit 修订改动）
**验证对象**: SA3 rev1 修订（index.ts 三名目移除 + fatal 契约测试经内部 seam 迁移 + package.json bump 0.1.7）
**方法**: 全部测试命令经后台独立进程（`setsid nohup … & disown`）实跑；公共面经 /tmp 一次性探针（tsx 运行时 / tsc 类型面 / node ESM 解析面）动态取证，零源码 grep 断言、零 worktree 污染（探针全部位于 /tmp/sa7-rev1-probe/，复跑后 `git status` 与验证前一致）
**环境**: node v24.13.0 / pnpm 10.28.2 / vitest 3.2.4（root vitest.config.ts = CI `pnpm test` 同通道）。纯库单测无端口占用，`fuser` 清场不适用（无服务拉起）。

---

## Step 0 — SA4 verdict 校对

- 读 `wiki/raw/task_doc-runtime-transaction-fatal_rev1_sa4_review.md` 第 4 行：**`Verdict: pass`**
- → 进 Step 1（SA7 仅可在 pass 基础上独立发现 fail；本报告全部验证为独立实跑，非转录 SA4）

```
[SA7 Step 0 结论]
SA4 verdict: pass
操作: 进 Step 1
```

## Step 1 — SA6 红灯锚现状（应转绿）

SA6 两个守卫文件（`public-surface-guard.test.ts` 3 用例 / `public-surface-type-guard.test-d.ts` 1 typecheck 用例）在 SA3 修绿后复跑：

- 定向跑 verbose 输出（见 §2 日志）：3 用例全 `✓`（含 9ms/0ms/1ms 真实执行时长）+ type-guard `✓ TS … (1 test)`；
- 全量跑（§3）中两文件行均在位且绿。

```
[SA7 Step 1 结论]
SA6 红灯: 🟢 GREEN（红灯锚已按 SA3 修绿路径翻转）
操作: 进入清单驱动验证
```

---

## 1. 公共面实跑验证（修订 AC R1 / owner 回归要求 1）

### 1.1 运行时命名空间（探针 A，一次性脚本 `/tmp/sa7-rev1-probe/probe-ns.mts`）

模拟下游消费者形态：`node_modules/@nomicore/doc-runtime` 符号链接 → worktree 包（pnpm workspace 同构），经**包名**解析公共入口：

```
$ node_modules/.bin/tsx /tmp/sa7-rev1-probe/probe-ns.mts        # EXIT=0
[A] runtime namespace keys = ["DocRuntimeFatalError","extractYjsSnapshot","materializeRoot","readLogicalValueAtPath","replaceRootContent"]
[A] own-prop applyValidatedMutation = false
[A] ns.applyValidatedMutation === undefined
[A] keys matching /mutation/i = [] => OK 无 mutation 管线泄露
[A] typeof ns.materializeRoot = function
[A] typeof ns.DocRuntimeFatalError = function
[A] typeof ns.extractYjsSnapshot = function
[A] typeof ns.readLogicalValueAtPath = function
[A] typeof ns.replaceRootContent = function
[A] materializeRoot() ok = true
[A] Y.Doc ROOT.title = "sa7-smoke" | ROOT.count = 42
[A] readLogicalValueAtPath(["count"]) = 42
[A] new DocRuntimeFatalError(...) instanceof Error = true | name = DocRuntimeFatalError | phase = pre-commit-internal | committed = false | message = "sa7-smoke-msg" | cause kept(===same instance) = true
```

结论：运行时公共入口命名空间**恰为五项值导出**，`applyValidatedMutation` 不存在（非 own prop、值 undefined、无任何 /mutation/i 键）；五项保留值导出全部可真实调用——`materializeRoot` 端到端冒烟（vfsl parse→evaluate→写入 Y.Doc→回读 `count=42` 一致）+ `DocRuntimeFatalError` 构造冒烟（branded name/phase/committed/ErrorOptions.cause 同实例保留）均通过。

### 1.2 tsc 层面类型名目不可导入（探针 B，独立 /tmp 工程，镜像仓库 tsconfig.base 的 bundler 解析）

| 探针 | 命令 | 结果 |
|---|---|---|
| 负例 `probe-negative.ts`（`import type { MutationIssue, ApplyValidatedMutationResult } from '@nomicore/doc-runtime'`） | `tsc --noEmit --strict --module esnext --moduleResolution bundler --types node probe-negative.ts` | **EXIT=2，恰 2 条 TS2305**：`Module '"@nomicore/doc-runtime"' has no exported member 'MutationIssue'`（probe-negative.ts(2,15)）/ `'ApplyValidatedMutationResult'`（(3,15)） |
| 正例对照 `probe-positive.ts`（`ExtractIssue / MaterializeIssue / MaterializeResult / DocRuntimeFatalPhase`） | 同上 | **EXIT=0，零错误**——同环境同解析下保留名目可导入，证明负例红非环境噪声 |
| 深路径 `probe-deep.ts`（`from '@nomicore/doc-runtime/mutation.js'`） | 同上 | **TS2307** `Cannot find module '@nomicore/doc-runtime/mutation.js'`——tsc bundler 解析同样受 exports map 封闭 |

### 1.3 既有守卫测试实跑（SA6 双文件）

见 Step 1 与 §2/§3 输出——guard 3 用例 + type-guard 1 用例全绿（type-guard 的两条 `@ts-expect-error` 被 TS2305 消费 = 类型层移除的动态证据，与探针 B 互相印证）。

**小结（AC R1）**：运行时值面、tsc 类型面、模块解析面三层独立实证：三名目（`applyValidatedMutation` / `MutationIssue` / `ApplyValidatedMutationResult`）均不可经公共入口触达；五项保留值导出在位且可调用。✅

---

## 2. fatal 契约活链路复跑（修订 AC R2/R3 / owner 回归要求 2/3）

命令（后台独立进程，`--reporter=verbose` 取逐用例证据）：

```
npx vitest run --typecheck --reporter=verbose \
  packages/doc-runtime/test/public-surface-guard.test.ts \
  packages/doc-runtime/test/public-surface-type-guard.test-d.ts \
  packages/doc-runtime/test/apply-validated-mutation-fatal-contract.test.ts \
  packages/doc-runtime/test/apply-validated-mutation-nested-path-repro.test.ts \
  packages/doc-runtime/test/sa7-fatal-dynamic-verify.test.ts \
  packages/doc-runtime/test/transaction-fatal-materialize-contract.test.ts
# 日志 /tmp/sa7-rev1-docruntime.log，EXIT=0
 Test Files  6 passed (6)
      Tests  34 passed (34)
 Type Errors  no errors
```

**skip/todo 排查**：全测试目录 grep `\.skip|\.todo|xit|xdescribe|it\.concurrent` 零命中；verbose 日志 `↓|skipped|todo` 标记计数 0。34/34 全部为真实执行（每条带 ms 时长）。

### 四类 fatal 场景 + 领域失败留结果联合 — 逐条 `✓` 证据（verbose 原文摘录）

| owner 回归要求场景 | 实跑 `✓` 摘录（文件 > describe > 用例） |
|---|---|
| ① pre-commit internal | `✓ transaction-fatal-materialize-contract … > AC-2/AC-6 — 明确 pre-commit internal failure → committed:false branded fatal + 零写入（W3）> 手造派生物（structure 非 root）→ committed:false、phase 非空；0 update、state 字节不变、ROOT 空置 5ms`；`✓ sa7-fatal-dynamic-verify … > genuine 窗口 A：doc.transact 回调内 _transaction 非 null → E202（变体 A…）+ 零写入` |
| ② observer cleanup throw | `✓ … observer cleanup throw → committed:true branded fatal > ROOT observer 抛 Error … committed:true、写入已提交（不虚假回滚：update 已发出、值已落盘）9ms`；`✓ apply-validated-mutation-fatal-contract … > mutation 事务提交后 observer 抛错 → throw DocRuntimeFatalError … committed:true、phase 非空、Y.Doc 保持提交后状态（不虚假回滚）39ms`；`✓ sa7-fatal-dynamic-verify 重点 2① … 交付 committed:true / phase observer-cleanup-throw / cause===spoof；写入已落盘 27ms` |
| ③ post-commit verification | `✓ … post-transaction verification 偏离 → committed:true branded fatal` 四变体全绿（delete 计划键 / insert 额外键 / 覆写计划键值 / 原地修改嵌套子树，5-14ms）；`✓ sa7-fatal-dynamic-verify 重点 2③ … DOCRT-E201 变体 D：committed:true / phase post-commit-verification / cause===spoof；已提交状态保留` |
| ④ 未知异常保守分类 | `✓ … AC-5 — 未识别 transaction 异常保守语义 > observer 抛非 Error 值（string，未识别形态）→ committed 保守为 true（不得降格 false）2ms` + 回归锚恒 true 4ms；`✓ sa7-fatal-dynamic-verify 重点 2②` 两例（信封 ownKeys / value Proxy get → E205 领域联合 ok:false 不升格 fatal + state 字节不变） |
| 领域失败留结果联合（R3） | `✓ … AC-3 — 普通 logical/path/materialization 失败继续使用领域结果联合，不进 fatal 通道` 三例（logical / materialization / path 各一）；`✓ apply-validated-mutation-fatal-contract … > ROOT 已损坏（逻辑不合法）→ 普通 mutation 失败：返回 ok:false + issues（领域联合），不 throw、非 fatal 形态 10ms` |
| exact identity / seam 载体 | `✓ applyValidatedMutation 经包内 seam（../src/mutation.js）导出为函数 1ms`；`✓ fatal 契约面的一致性：… 与 materializeRoot 的 fatal 为同一构造器（exact identity，AC-6）6ms`；`✓ nested-path-repro` 两例（嵌套路径完整 proposed ROOT 契约） |

**seam 迁移事实核**：三迁移文件 import 来源已拆分（fatal-contract `beforeAll` 双源动态 import：seam `../src/mutation.js` 取 `applyValidatedMutation` / 公共入口取 `DocRuntimeFatalError`；sa7-fatal-dynamic-verify L36 静态 seam 导入；nested-path-repro L26/L29 拆分）——断言按原语义在活链路真实执行。**R2/R3 ✅**

---

## 3. 全量复跑取证（修订 AC R5 前半 / owner 回归要求 4 本地部分）

两条通道均为后台独立进程、CI 同命令（`.github/workflows/ci.yml`：`pnpm test` = `vitest run --typecheck`、`pnpm typecheck`）：

### 3.1 `npx vitest run --typecheck`（root，/tmp/sa7-rev1-full-vitest.log，EXIT=0）

```
 Test Files  72 passed (72)
      Tests  974 passed (974)
 Type Errors  no errors
   Duration  46.55s
```

与 SA3 记录、SA4 复跑、总控亲跑三方数字完全一致（72/974），零回归、零波动。

### 3.2 `pnpm typecheck`（六包 tsc，/tmp/sa7-rev1-typecheck.log，EXIT=0）

```
> tsc -p packages/vfsl/tsconfig.json && … && tsc -p packages/doc-runtime/tsconfig.json
（六包零输出错误，exit 0）
```

**R5 本地部分 ✅**（CI Node 20/24 腿见 §6 登记）。

---

## 4. vitest 触发证据（SKILL Step 4 / 结论令牌）

全量日志中 doc-runtime 全部 21 个测试文件行摘录（18 个 `.test.ts` + 3 个 `.test-d.ts`，**含两个守卫文件**）：

```
 ✓  TS  packages/doc-runtime/test/public-surface-type-guard.test-d.ts (1 test)   ← 守卫（类型面）
 ✓ packages/doc-runtime/test/public-surface-guard.test.ts (3 tests) 3ms          ← 守卫（运行时值面）
 ✓ packages/doc-runtime/test/apply-validated-mutation-fatal-contract.test.ts (4 tests) 18ms
 ✓ packages/doc-runtime/test/apply-validated-mutation-nested-path-repro.test.ts (2 tests) 17ms
 ✓ packages/doc-runtime/test/sa7-fatal-dynamic-verify.test.ts (8 tests) 27ms
 ✓ packages/doc-runtime/test/transaction-fatal-materialize-contract.test.ts (16 tests) 28ms
 ✓ packages/doc-runtime/test/materialize-root.test.ts (60 tests) / materialize-root-rev2.test.ts (23 tests)
 ✓ packages/doc-runtime/test/replace-root-content.test.ts (13 tests) / extract-yjs-snapshot.test.ts (21 tests)
 ✓ packages/doc-runtime/test/read-logical-value-at-path*.test.ts（4 个常规 + 3 个 .test-d.ts，合计 102+ tests）
 ✓ packages/doc-runtime/test/extract-*.test.ts（4 个，40 tests）
```

（上行压缩排版；逐文件原文见 /tmp/sa7-rev1-full-vitest.log）

| Workspace Package | 通道 | 触发结果 | 证据 |
|---|---|---|---|
| doc-runtime（本轮全部 5 个改动/新增测试文件所在包） | 本地 `npx vitest run --typecheck`（= CI step `pnpm test` 同通道） | ✓ 21 文件全触发全绿 | `Test Files 72 passed (72) / Tests 974 passed (974)` + 上表文件行（含两守卫） |
| doc-runtime | CI 专用契约门禁 step（ci.yml L55 `vitest run packages/doc-runtime/test/materialize-root.test.ts --typecheck`） | 本地等价物已含于全量绿 | 待 CI run 取证（见 §6） |
| root 六包 | `pnpm typecheck`（= CI step `pnpm typecheck`） | ✓ EXIT=0 | §3.2 |

**结论令牌**：`vitest-package-not-triggered: ok（本地 CI 同通道全量实跑，5 个改动测试文件全部触发且绿；CI 矩阵腿未伪造，待 push 后 runner 跟踪）`

---

## 5. 可选冒烟 — 深路径旁路（探针 C，node ESM 真实解析）

```
$ node -e "import('@nomicore/doc-runtime/mutation.js')…"   # node v24.13.0，自 /tmp 消费者工程
[C] @nomicore/doc-runtime/mutation.js     => REJECTED code=ERR_PACKAGE_PATH_NOT_EXPORTED
[C] @nomicore/doc-runtime/src/mutation.js => REJECTED code=ERR_PACKAGE_PATH_NOT_EXPORTED
[C] @nomicore/doc-runtime/src/index.ts    => REJECTED code=ERR_PACKAGE_PATH_NOT_EXPORTED
[C] @nomicore/doc-runtime                 => REJECTED code=ERR_MODULE_NOT_FOUND（'…/src/extract.js'）
```

- 三条深路径（含 exports 目标字面 `./src/index.ts`）全部被 exports map 在**解析阶段**拒绝——`exports` 仅 `"."` 全封闭，`mutation.js` 只能经包内相对路径（= 内部 seam 设计形态）触达；
- `"."` 入口本身可达且加载（node24 类型剥离），其内部相对 `.js→.ts` 改写失败属本仓 source-export TS 工作区在裸 node 下的既有惯例（消费者经 TS bundler 解析编译，如 tsc bundler 探针 B 正例 EXIT=0 所证），非 rev1 改动引入、与旁路闭合结论无关。
- 叠加 §1.2 tsc 深路径 TS2307：**运行时与类型层双面无深路径旁路**。（SA4 动态审核重点第 2 项处置完毕）

## 6. CI Node 20/24 矩阵腿登记（如实，不伪造）

- `.github/workflows/ci.yml`：matrix `node: [20, 24]`，steps `pnpm typecheck` + `pnpm test`（= 本地双通道同命令）+ doc-runtime 专用契约门禁（L55）；
- 本地 node v24.13.0 与矩阵 24 腿同大版本（本地实跑即该腿等价通道）；**Node 20 腿本地未模拟**；
- 本轮修订**尚未 commit/push**（SA3 记录 4：等 SA4/SA7 双清后由总控续传）→ 无 PR CI run URL 可摘录。CI 双腿绿属 runner 阶段职责，SA7 不宣称、不伪造；push 后如需 run log 摘录归 runner/总控补充。

---

## 纪律自检

- 测试执行规范：全部测试命令 `setsid nohup … & disown` 后台独立进程（本机无端口占用，`fuser` 不适用）；探针为秒级一次性脚本，经 bash 工具带超时前台执行，未阻塞会话；
- 未修改任何生产代码与既有测试；一次性探针全部位于 `/tmp/sa7-rev1-probe/`（probe-ns.mts / probe-negative.ts / probe-positive.ts / probe-deep.ts），worktree `git status` 验证前后一致（5 modified + 2 新增测试 + wiki，均为 SA3/SA6 交付面）；
- 日志留档：/tmp/sa7-rev1-full-vitest.log、/tmp/sa7-rev1-docruntime.log、/tmp/sa7-rev1-typecheck.log（.exit 文件记 exit code 0/0/0）；
- SKILL Step 3（E2E spec）N/A：本轮无 .spec.ts 改动。

## 结论

| 项 | 结果 |
|---|---|
| AC R1 公共面三名目移除（值面/类型面/解析面） | ✅ 三层独立实跑实证 |
| AC R2 fatal 四类场景覆盖不丢（经 seam） | ✅ 34/34 定向实跑，逐用例 ✓ 零 skip |
| AC R3 领域失败留结果联合 | ✅ AC-3 三例 + fatal-contract 损坏 ROOT 例实跑绿 |
| AC R4 交付范围不变（五值导出 + fatal 契约面） | ✅ 探针 A 冒烟 + 全量绿 |
| AC R5 全量 typecheck/test 绿 | ✅ 本地双通道 EXIT=0（72/974）；CI 矩阵腿待 runner |
| AC R6 patch bump | ✅ package.json 0.1.7 实测 |
| SA6 红灯锚 | 🟢 已转绿（非自欺：断言真实翻转） |

verdict: pass

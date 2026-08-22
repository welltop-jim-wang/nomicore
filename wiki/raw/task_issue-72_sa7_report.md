# SA7 动态验证报告 — 严格编译 SchemaEnvelope：compileSchemaEnvelope（Issue #72）

- **Date**: 2026-08-22
- **Verifier**: SA7（Dynamic Verifier）
- **被验对象**: 实现 commit `7033490`（feat(vfsl): compileSchemaEnvelope）+ 哨兵 commit `c459c3c`（SA6 RT 哨兵），base `f07462d`
- **审核链输入**: SA4 verdict **pass**（task_issue-72_sa4_review.md，动态重点 DA-1~DA-4）；SA2 verdict pass（RT 系列 + 活链路义务）；约束清单 D1–D5（task_issue-72_relevant_decisions.md）
- **验证环境**: 本地 worktree `/home/wangjian/nomicore-fix-issue-72`（branch `fix/issue-72-on-docs-doc-runtime-validation`），node **v24.13.0**，vitest 3.2.7，独立 setsid 后台进程执行

---

## Step 0：SA4 verdict 校对

SA4 review 顶部（第 4 行）：`Verdict: pass（附 1 项非阻塞登记义务 F1…）` → **进入动态验证**。
F1 状态注记：验证期间总控已提交 `e50907b`（设计 §14 ALLOW LIST 登记哨兵测试文件，仅 wiki 1 行）——F1 闭合，零代码/测试影响（本报告全部测试运行先于该提交，且该提交不触及任何被测面）。

## Step 1：SA6 红灯测试复跑（独立后台进程）

**结果：🟢 GREEN（26 红基线全部转绿）**

```
$ setsid nohup bash -c 'pnpm exec vitest run <两新测试文件> …' （独立进程，日志 /tmp/sa7-tests.log）

=== [A] targeted: two new test files ===
 ✓ packages/vfsl/test/compile-schema-envelope.test.ts (28 tests) 26ms
 ✓ packages/vfsl/test/compile-schema-envelope-sentinel.test.ts (7 tests) 11ms

 Test Files  2 passed (2)
      Tests  35 passed (35)
Type Errors  no errors
TARGETED_EXIT=0

=== [B] full: pnpm test (vitest run --typecheck) ===   ← 与 CI Test step 完全同命令
 ✓ packages/vfsl/test/compile-schema-envelope.test.ts (28 tests) 26ms
 ✓ packages/vfsl/test/compile-schema-envelope-sentinel.test.ts (7 tests) 11ms
 Test Files  49 passed (49)
      Tests  704 passed (704)
Type Errors  no errors
FULL_EXIT=0
```

- 定向两文件 **35/35 绿 + 类型零错**；全量 **704/704 绿（49 文件）exit 0**，与 SA4 独立复跑（§五）及 dispatch log 数字闭环一致；两新文件在全量运行中逐文件出现（上方摘录）。
- 无既有测试回归（704 = 实现轮 697 + 哨兵轮 7）。

## Step 2：SA4 动态重点逐条验证（DA-1 ~ DA-4）

### DA-1 CI 触发证据（首要）— **CI 环境阻塞，本地替代证据成立**

阻塞事实（三重确认）：

```
$ gh run list --branch fix/issue-72-on-docs-doc-runtime-validation --limit 10
（空输出）
$ git ls-remote --heads origin | grep -i issue-72
（无命中——分支未 push）
$ gh run view 32548829010 --log | grep -c compile-schema-envelope
0        ← 父分支 docs/doc-runtime-validation 最新 run：两新文件不存在于其树，无法冒用为触发证据
```

SA7 无 push/建 PR 权责（技能边界明文）→ 按总控硬要求采用**本地 `pnpm test` 输出替代并注明**（证据见 Step 1 [B] 段：与 ci.yml Test step `pnpm test` 完全同命令、同 vitest.config include，本机可复现）。分类：**✓ 触发且通过（本地替代口径）**；CI 侧补验义务移交总控（见「环境阻塞与移交」）。

### DA-2 node 20/24 矩阵一致性 — **node 20 实测不可得（环境阻塞），静态风险面 + node 24 全绿**

- 本地 node 版本面：`/usr/local/bin/node` = v24.13.0（全量 704/704 绿即在此版本）；`/usr/bin/node` = v18.19.1 **低于 engines `node >=20`**，不构成合法矩阵点；无 nvm/node20 发行版可用。
- CI 矩阵实测同样阻塞于分支未 push（ci.yml `matrix.node-version` 双点，本分支无 run）。
- **静态风险面（低风险结论）**：
  - 任务 diff（`f07462d..HEAD`）新增代码**零 node API、零外部 import**——grep 实证仅本地模块 import（`./sha256.js`、`./schemasource.js`、`./ir.js`、`./envelope.js`、`./fingerprint.js`）；
  - `sha256.ts` 为**零 import 纯 ES2022 叶子**（头注明文排除 `node:crypto` 环境绑定），SHA-256 纯 TS 算术与 node 版本无关，且 KAT（FIPS 'abc'/'' 向量）在 28 用例内绿——摘要正确性被锚定；
  - 新增路径仅依赖 ES2015+ 稳定语义（`Object.getOwnPropertyNames`、Proxy 不变量、`JSON.stringify`、`WeakSet`、`Object.freeze`、`String.prototype.codePointAt`），无 20→24 间行为差异面。
- 结论：**环境阻塞如实登记，非实现缺陷**；矩阵一致性留待 push 后 CI 复核（总控）。

### DA-3 ENV-5 消息规模探针（可选探针——已执行）— **PASS**

临时探针 `[SA7-DIAG]`（`sa7-diag-probe.mts`，`node --import tsx --expose-gc` 独立进程，运行后已删）：

```
n=1e3 : msgLen=11945  code=5  键名覆盖 1000/1000   耗时=0.9ms
n=1e4 : msgLen=128945 code=5  键名覆盖 10000/10000  耗时=7.5ms
[PASS] n=1e4 单条 ENV-5（code=5）且消息无放大覆盖全部键名
[PASS] n=1e4 issues.length 恒 1（envelope 域单条契约不随规模破）
[PASS] 消息长度近线性 O(n)：lenRatio=10.79 timeRatio=8.77（10 倍键数 → 长度/耗时比 ≈10/≈9，无平方放大）
[PASS] 200 次 n=1e4 调用 heap 增量 = 0.7MB（--expose-gc 强制回收后测；无泄漏累积面）
```

SA4 F3（观察项）就此闭合：消息构造 O(多余键数) 精确线性、单条契约与 readOnly=false 在超大规模输入下不破、无内存异常增长。

### DA-4 未来缓存票「指纹键 = 产物值形态」假设 — **PASS（活链路证据登记）**

探针 P5 段输出：

```
[PASS] ok 产物恰五件套（ok/envelope/module/derived/envelopeFingerprint/semanticFingerprint）
[PASS] module/derived 可 JSON 序列化（纯数据，无环、无函数） :: modJson=210B derJson=575B
[PASS] 产物 envelope 值形态回灌再编译 → envelopeFingerprint 不变（跨实例值形态稳定）
```

配合 P2（两次编译引用互异——无缓存语义；双指纹逐字节相等——值确定）与 RT-1b 哨兵（module JSON round-trip 保插入序 → semantic 指纹不变，7/7 绿），未来 NamespaceRuntime 缓存票的 value 假设成立：**产物是可序列化、值确定、引用互不共享的冻结纯数据；envelope 域指纹对产物值形态回灌稳定，semantic 域指纹对 round-trip 稳定**。移交备注（非本票义务）：D1 附注的前缀耦合（任一域文档演进 ⇒ semantic 全体 miss-only 失效）应进入缓存票失效预算输入。

## SA2 RT 系列与活链路行为验证（总控点名：指纹确定性 / 冻结 loud / 五阶段可观测性）

**RT-1b / RT-1c / RT-2 / RT-3 / RT-4（哨兵文件 7/7 绿，触发证据见 Step 1）**，并以下独立探针交叉验证（与测试文件互不共享断言代码）：

**五阶段可观测性（探针 P1，每阶段一条真实输入的实际返回）**：

| 阶段 | 输入 | 实际观测（单条/原生 + kind + code） |
|---|---|---|
| envelope ENV-1 | `null` | 单条 `kind=envelope code=1`「信封必须是对象…实际收到 null」 |
| envelope ENV-2 | 缺 `text` | 单条 `code=2`「信封缺少必需键: text」 |
| envelope ENV-3 | `version:'1'` | 单条 `code=3`「version 应为 number，实际 string」 |
| envelope ENV-5 | 多余键 `extra` | 单条 `code=5`「信封多余键: extra（严格封闭…）」readOnly=false |
| dialect ENV-4 | `version:2` | 单条 `code=4`「未知方言（只读 loud-fail，不解释 text）…实际 version=2」readOnly=true |
| parse | `type ROOT = {` | 原生 `kind=vfsl` 数组 `VFSL-E100: 期望字段名标识符…line=1 column=14` |
| internal ENV-100 | 对抗 getter Proxy（任意键读取即抛） | **不外抛**，单条 `code=100`「内部错误（意外异常）: SA7-DIAG bomb」 |

evaluate 阶段可观测性：自然合法文本不存在可达的求值失败路径，owned 测试以 `vi.mock('../src/evaluate.js')` 注入锚定（28/28 绿，含原生 issues 逐条保留）——探针不经 mock 无法触达，如实注明，以测试运行为准。

**指纹确定性（探针 P2 + 跨进程）**：

```
[PASS] 双指纹格式 sha256:v1:<64 小写 hex>（env=sha256:v1:6bbfe6f3…7068b7 sem=sha256:v1:cccf4003…f47ecb）
[PASS] 域分离：双指纹互异；无缓存：两次编译产物引用互异；确定性：两次编译双指纹逐字节相等
[PASS] 敏感性：仅 id 变→envelope 变/semantic 不变（ADR-0005）；仅空白+普通注释变→envelope 变/semantic 不变；
       仅 JSDoc 变→semantic 变（ADR-0001）
跨进程：两次独立 node 进程 FP_ONLY 输出 diff 为空 → CROSS_PROCESS_IDENTICAL=yes（未来跨调用/跨进程缓存键前提）
```

**冻结 loud（探针 P3）**：

```
[PASS] 顶层/envelope/module/derived 均已冻结（Object.isFrozen）
  result.ok 赋值 → TypeError（loud ✓）
  envelope.id 赋值 → TypeError（loud ✓）
  module.aliases 赋值 → TypeError（loud ✓）
  module.aliases[0] 嵌套赋值 → TypeError（loud ✓）
[PASS] 四处赋值全部抛 TypeError :: [true,true,true,true]
```

## vitest 触发证据（Hard Gate #14 — 2026-06-15 立法）

**CI Run: N/A——本分支未 push，无 CI run 可用**（`gh run list --branch …` 空 + `git ls-remote` 无该远端分支，见 DA-1）。按总控硬要求以**本地 `pnpm test` 输出替代并注明**；本地命令与 ci.yml Test step 完全同构（root `scripts.test` = `vitest run --typecheck`，同 vitest.config include）。

| Workspace Package | CI Step Name | 触发结果 | log 摘录 |
|---|---|---|---|
| `@nomicore/vfsl`（packages/vfsl） | Test（`pnpm test`；本分支无 run，本地同命令替代） | ✓ 触发且通过（本地替代口径） | ` ✓ packages/vfsl/test/compile-schema-envelope.test.ts (28 tests) 26ms`<br>` ✓ packages/vfsl/test/compile-schema-envelope-sentinel.test.ts (7 tests) 11ms`<br>`Test Files  49 passed (49)` / `Tests  704 passed (704)` |

**verdict**: ✅ all-vitest-packages-triggered（本地替代证据口径；CI 侧补验义务移交总控）。

## Spec 触发证据（E2E，Step 3 立法）

N/A——本任务零 `*.spec.ts` 新增/改动（仅 2 个 `*.test.ts`，已由上节覆盖）。

## 补充测试与产物说明

- **未持久化新测试文件**（有意裁量）：owned 28 用例 + 哨兵 7 用例已锚定全部 DA 面；DA-3 探针属一次性规模诊断，若固化为测试文件将触发 ALLOW LIST 登记义务（F1 先例：未登记测试文件即文档债）——故以 `[SA7-DIAG]` 临时探针执行、运行后删除。清理确认：`rm sa7-diag-probe.mts` 后 `git status` 干净（唯一后续提交 e50907b 为总控 F1 闭合，非本 SA 产物）。
- 零生产代码修改、零测试代码修改（本 SA 全程只读源码 + 一次性诊断探针）。
- 完整测试日志留存：`/tmp/sa7-tests.log`（9431 B，含 [A]/[B] 两段全文）。

## 环境阻塞与移交（总控裁量）

| 项 | 阻塞原因 | 移交动作 |
|---|---|---|
| DA-1 CI 侧触发证据 | 分支未 push（SA7 无 push/建 PR 权责） | push/建 PR 后：`gh run view <run-id> --log \| grep compile-schema-envelope` 摘录 Test 步骤两文件行（本地已证同命令必触发） |
| DA-2 node 20 矩阵点 | 同上 + 本地无 node ≥20 第二版本（18.19.1 低于 engines） | push 后确认 CI 双矩阵 job（node 20/24）全绿；静态风险面已证低（零 node API + 纯 TS sha256 + KAT 锚） |

两项均为**环境阻塞，非实现缺陷**，不构成 verdict 减分。

---

## Verdict

**Verdict**: pass

依据：SA4 pass 基础上，SA6 26 红基线全转绿（35/35 + 全量 704/704 exit 0，独立进程复现）；SA2 RT 系列五锚哨兵 7/7 绿且经独立探针交叉验证（五阶段可观测性/指纹确定性含跨进程一致/冻结 loud 四处 TypeError）；DA-3 规模探针精确线性无放大（F3 闭合）；DA-4 产物值形态证据成立；DA-1/DA-2 CI 侧证据环境阻塞已如实登记并移交（本地替代证据满足 Hard Gate #14 口径）。未发现任何实现行为级缺陷。

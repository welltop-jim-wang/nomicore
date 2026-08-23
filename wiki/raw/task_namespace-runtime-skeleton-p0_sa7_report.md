# SA7 动态验证报告 — namespace-runtime 骨架/同步读取/队首 P0（issue #89）

**Date**: 2026-08-24
**Verdict**: ✅ **pass**（SA4 R2 终审 pass 基础上，SA7 动态验证 5 项清单全数通过；独立发现 0 项 fail；新增补充锚 3 用例全绿）

- **被验对象**：SA3 commits `0931269` + `088a4a2`（`packages/namespace-runtime`）+ SA6 冻结契约 4 测试文件（17 用例 + F-1 回归锚 4 用例）
- **环境**：worktree `/home/wangjian/nomicore-fix-issue-89`；Node 24.13.0（默认）/ Node 20.20.2（SA7 自行安装，见 §5.3）；vitest 3.2.7；全部测试命令独立后台进程（`setsid nohup`），与 CI 同命令
- **零生产代码改动**：未触碰 `src/` 任何文件；SA6 冻结测试零改动；仅新增 SA7 补充测试 1 个文件（§4）

---

## Step 0：SA4 verdict 校对

`task_namespace-runtime-skeleton-p0_sa4_review.md` 顶部：`Verdict: pass（R2 轮终审，2026-08-24）` → **进 Step 1**。

## Step 1：SA6 红灯测试（现应转绿）

```text
$ pnpm exec vitest run packages/namespace-runtime --typecheck --passWithNoTests=false
 ✓ packages/namespace-runtime/test/runtime-public-surface-ownership.test.ts (6 tests)
 ✓ packages/namespace-runtime/test/runtime-sync-read-face.test.ts (4 tests)
 ✓ packages/namespace-runtime/test/runtime-p0-sequencer.test.ts (7 tests)
 ✓ packages/namespace-runtime/test/metadata-proto-key.test.ts (4 tests)
 Test Files  4 passed (4)   Tests  21 passed (21)   Type Errors  no errors   exit 0
```

**结论：🟢 GREEN**——17 冻结用例 + 4 F-1 回归锚全部转绿（F-1 修复经 SA6 锚行为级确认）。

---

## Step 2：SA4「动态审核重点」清单逐条验证（5/5 ✅）

### #1 F-1 修复运行时复核（独立探针，非仅测试转绿）

探针经真实 `MemoryPersistence.createDoc` + `src/runtime.ts` seam 直跑（tsx 独立进程，探针已清理）：

```text
P5 own keys              : ["docId","createdAt","__proto__"]   ← 全键保真（R1 病理期为缺键）
P5 hasOwn __proto__      : true
P5 prototype replaced    : false                              ← 原型未被 doc 数据替换
P5 value preserved       : true                               ← 值深拷贝逐字段保真
P6 String/template usable: ok                                 ← R1 病理期 TypeError 消失
B1 nested own keys       : ["origin","__proto__"]             ← 嵌套层保真
B2 nested hasOwn/proto   : true | clean                       ← 嵌套副本原型干净
C1 round-trip own keys   : ["docId","createdAt","__proto__"]  ← Yjs 编解码往返后保真
C1 value byte-identical  : true
P3 scalar key kept       : true | proto clean                 ← 标量值键不再静默蒸发
```

**✅ 与 SA4 R2 复审结论独立一致：F-1 契约击穿面（键蒸发/原型劫持/下游 TypeError/嵌套/round-trip）全部闭合。** SA6 锚 4/4 绿为持久化回归防线（已入 CI 收集面，见 Step 4）。

### #2 vitest 触发证据（Hard Gate #14 动态门禁）→ 见 Step 4 专节

### #3 Node 20 档实测 ✅

本机初始仅有 Node 24.13.0。SA7 经 `n`（`N_PREFIX=~/.n20` 用户目录，不动系统）安装 **Node 20.20.2**，与 corepack `pnpm@10.28.2`（= 根 package.json `packageManager` 字段，即 CI `pnpm/action-setup@v4` + `setup-node@v5` 的精确本地等价）组合执行：

```text
$ PATH=~/.n20/bin:$PATH corepack pnpm@10.28.2 typecheck    # 七包串联，CI 同命令
TYPECHECK_EXIT=0
$ PATH=~/.n20/bin:$PATH corepack pnpm@10.28.2 test
 Test Files  74 passed (74)   Tests  1023 passed (1023)
 Type Errors  no errors       TEST_EXIT=0
```

**✅ Node 20 档 typecheck + 全量 test 双绿**（微任务时序/`Object.prototype.__proto__` accessor 语义与 Node 24 零差异，与 SA4 预期一致）。终态（含 SA7 补充锚）Node 20 复跑：`75 文件 / 1026 用例 / Type Errors 0 / exit 0`。

### #4 F-3 形态确认（循环 META 值 loud 行为复核）✅

探针（seam 直通：createDoc 后向 live META 注循环引用，SA4 D1 同款路径）：

```text
setup schema state       : ready
D1 getMetadata throw     : RangeError: Maximum call stack size exceeded   ← 可捕获
D1 errName               : RangeError                                    ← 原始错误（非 MetaProjectionError、无稳定 code）
post-throw SCHEMA 4 keys : ["lang","version","id","text"]                ← 其余读取面不受影响
post-throw read([])      : {"ok":true,"value":{"n":"str"}}
post-throw read([n])     : {"ok":true,"value":"str"}
post-throw status        : ready | fatal: null                           ← fatal 零污染
D1 process alive         : true
```

**✅ 与 SA4 R1 D1 登记态逐字一致、无恶化**：loud、可捕获、进程存活、隔离于其余读取面、不升级 fatal。维持 LOW 备案处置（不加环检测）正确。**SA7 已将其锚化为回归测试**（§4 用例 1），防未来「静默化/包装化」漂移。

### #5 外部违约 release 后读取面（设计 R3 边界，真实时序）✅

探针（gate 控制：构造同步 preparing → 放行 → P0 ready → `handle.release()` → 观测）：

```text
sync-construct state     : preparing                       ← INV-N1（P0 绝不构造栈内结算）
P0 settled state         : ready
pre-release write bits   : rootWrite= true | schemaWrite= true | read= true
post-release handle status: released
post-release write bits  : rootWrite= false | schemaWrite= false | read= true   ← 瞬时观察转 false
post-release schema state: ready | fatal: null
read([]) / read([n])     : {"ok":true,...} 照常            ← live Y.Doc 引用不崩不换源
getSchemaEnvelope 4 keys : ["lang","version","id","text"] | lang= vfsl
getMetadata keys         : ["docId","createdAt","note"] 照常
getActiveSchema non-null : true（五字段身份，无 module/derived/validator）
process alive            : true
```

**✅ 设计 R3 边界逐字兑现**：写位瞬时观察转 false、读取面继续观察 live 引用、无崩溃无 fatal。**已锚化为回归测试**（§4 用例 2）。

---

## Step 3：E2E spec 触发证据 — N/A

本任务 SA1 design / SA3 diff 均无 `*.spec.ts`（SA4 §三 Hard Gate #13 已核 `N/A`），SA7 复核 worktree diff 确认。**不适用**。

## Step 4：vitest 触发证据（verdict 升级 — 2026-06-15 立法，强制执行项）

**触发条件命中**：SA1 design 含新增 `*.test.ts`（3 冻结契约文件 + 1 F-1 回归锚 + SA7 补充 1）。

**口径声明**：任务分支 `fix/issue-89-on-docs-namespace-runtime` 本地未 push（ahead 2），GitHub 上**无该分支 CI run 可查**（`gh run list --branch fix/issue-89-on-docs-namespace-runtime` 空）。按总控指令口径：以**本地 `pnpm test` 全量收集输出**（CI `Test` step 同命令 `vitest run --typecheck`，include `packages/*/test/**/*.test.ts` + `domains/*/test/**/*.test.ts`）摘录触发证据。**真实 CI run 证据待 push 后由总控核对（SA7 不负责 push/宣称 CI 绿）。**

收集清单证据（Node 24 干净全量跑，`/tmp/sa7-fulltest-node24-clean.log`）：**74 文件 = 67 运行时 `.test.ts` + 7 类型面 `.test-d.ts`**，逐 workspace package 分布：

| Workspace Package | CI Step（本地等价） | 触发结果 | log 摘录 |
|---|---|---|---|
| packages/namespace-runtime | Test (`pnpm test`) | ✓ 4 文件 21 tests passed | `✓ packages/namespace-runtime/test/runtime-p0-sequencer.test.ts (7 tests)`、`✓ …runtime-sync-read-face.test.ts (4 tests)`、`✓ …runtime-public-surface-ownership.test.ts (6 tests)`、`✓ …metadata-proto-key.test.ts (4 tests)` |
| packages/vfsl | Test (`pnpm test`) | ✓ 26 文件 passed | 收集清单 26 条 `✓ packages/vfsl/test/*.test.ts` |
| packages/doc-runtime | Test (`pnpm test`) | ✓ 17+2(tsd) 文件 passed | 收集清单 19 条 |
| packages/persistence | Test (`pnpm test`) | ✓ 9 文件 passed | 收集清单 9 条 |
| packages/vfsl-codegen | Test (`pnpm test`) | ✓ 6+1(tsd) 文件 passed | 收集清单 7 条 |
| packages/vfsl-protocol | Test (`pnpm test`) | ✓ 1+2(tsd) 文件 passed | 收集清单 3 条 |
| packages/dsh-persistence | Test (`pnpm test`) | ✓ 3 文件 passed | 收集清单 3 条 |
| domains/vfs3-assets | Test (`pnpm test`) | ✓ 1+2(tsd) 文件 passed | 收集清单 3 条 |

汇总：`Test Files 74 passed (74) | Tests 1023 passed (1023) | Type Errors no errors | EXIT=0`。typecheck 覆盖：根 `pnpm typecheck` 第七包 `tsc -p packages/namespace-runtime/tsconfig.json`（Node 20/24 双档 exit 0）。

**verdict**: ✅ **all-vitest-packages-triggered**——SA1 design 列出的每个 `*.test.ts` 文件均在 `pnpm test` 收集清单中出现且全绿（非仅静态 glob 推断；Node 20/24 双档一致）。

---

## §4 SA7 补充测试（新增产物）

**文件**：`packages/namespace-runtime/test/runtime-boundary-supplementary.test.ts`（3 用例，纯新增；SA6 冻结 4 文件零改动、src/ 零改动）。将 SA4 动态清单 #4/#5 与 R1 P6 下游崩溃向量锚化为持久回归防线（命中 `packages/*/test/**/*.test.ts`，自动入 CI 收集面）：

1. **F-3 登记态**：seam 直通循环 META 值 → `getMetadata()` 抛可捕获 `RangeError`（instanceof 断言）、其余读取面照常、fatal 零污染；
2. **外部违约 release 边界**：构造同步 preparing（INV-N1）→ gate 放行 ready → `handle.release()` → 写位转 false / read.enabled 保持 true / 四读取面值不变 / active schema 保留；
3. **P6 下游崩溃向量**：META `'__proto__'` 对象值键（含字符串 `toString`）返回对象可被 `String()`/模板字符串消费（R1 病理期 TypeError）。

```text
$ pnpm exec vitest run packages/namespace-runtime --typecheck --passWithNoTests=false
 Test Files  5 passed (5)   Tests  24 passed (24)   Type Errors  no errors   exit 0
```

## §5 环境事实与偏差记录

1. **首次全量跑的 1 条基础设施 flake（非代码缺陷，已定性）**：并发跑探针时首轮全量 `pnpm test` 出现 `Errors 1 — Error: [vitest-worker]: Timeout calling "onTaskUpdate"`（vitest worker→主进程 RPC 超时），测试本体仍 74/74、1023/1023 全绿；无并发负载的干净重跑**不复现**（`Errors` 行消失，exit 0）。若未来 CI 偶发同款报错，属 vitest runner 基础设施噪声，与本任务代码无关。
2. **远程 CI 不可查**：分支未 push（SA7 职责边界不 push/不建 PR/不宣称 CI 绿）；Node 20 档已用 CI 精确等价组合（Node 20.20.2 + corepack pnpm@10.28.2）本地实测补齐，真实 runner 证据归总控 push 后核对。
3. **Node 20 安装方式**：`N_PREFIX=~/.n20 n 20`（用户目录，未动系统 Node 24）；`~/.n20` 为会话级工具目录，不属于仓库产物。

## §6 复核结论（终态全量，双档）

| 命令 | Node 24 | Node 20 |
|---|---|---|
| `pnpm typecheck`（七包串联） | exit 0（SA4 R2 已证 + 本轮包内 --typecheck 零错） | exit 0 |
| `pnpm exec vitest run packages/namespace-runtime --typecheck --passWithNoTests=false` | 5 文件 / 24 用例 / 0 类型错 / exit 0 | （全量覆盖，见下行） |
| `pnpm test`（CI 同命令，含 SA7 补充锚） | **75 文件 / 1026 用例 / Type Errors 0 / exit 0** | **75 文件 / 1026 用例 / Type Errors 0 / exit 0** |

既有 1002 基线零回归；任务合计 21 冻结用例 + SA7 补充 3 用例 = 1026（= 1002 + 21 + 3）。

**SA7 verdict: pass。** SA4 pass 基础上动态清单 5/5 验证通过，独立发现零 fail；补充锚 3 用例入 CI 收集面。探针 scratch 已全部清理（worktree 增量 = 本报告 + 补充测试文件 + 流水线运行时 `.mabf/`）。

# SA7 动态验证报告 — Issue #150：namespace create 生命周期与 genesis 接入诊断变更日志

**Date**: 2026-08-31
**Verdict**: **pass**
**SA7 测试产物**: `packages/namespace-registry/test/registry-create-diagnostic-sa7-dynamic.test.ts`（新增补充套件，10 it，全部运行时行为断言；未触碰任何业务代码——`git status` 仅本文件 untracked + 总控 wiki 档案既有修改）

- 被验对象：HEAD `6ae689f`（实现 `85f36bd` + SA6 AC5 勘误 `80a2eb8` + SA4 R1 B1/B2 修复 `0f72527` + dispatch 档案）
- 输入：任务简报（SA6 冻结契约 16/16 + R2 AC5 勘误）、SA4 review（R2 pass，「动态审核重点」五条）
- 方法：独立进程复跑冻结契约 + 新增 SA7 动态套件逐条验证 SA4 交办风险 + 全量 CI 等效命令 + baseline 判别实验

---

## Step 0 — SA4 verdict 校对

SA4 review 顶部：`Verdict: R1 reject → R2 pass（最新裁定 = pass）`。→ **进 Step 1**。

## Step 1 — SA6 冻结契约独立复跑（独立进程）

```
$ ./node_modules/.bin/vitest run packages/namespace-registry/test/registry-create-diagnostic-red.test.ts \
    packages/namespace-registry/test/registry-create-diagnostic-code-source.test.ts \
    packages/namespace-registry/test/registry-create.test.ts --typecheck.enabled=false
 ✓ registry-create-diagnostic-red.test.ts (16 tests)
 ✓ registry-create.test.ts (50 tests)
 ✓ registry-create-diagnostic-code-source.test.ts (6 tests)
 Test Files  3 passed (3) / Tests  72 passed (72)   exit 0
```

**[SA7 Step 1 结论] SA6 冻结契约：🟢 GREEN（16/16）→ 进入清单驱动验证。**

---

## 独立验证记录（命令 + 结果）

| 验证项 | 命令 | 结果 |
|---|---|---|
| SA6 冻结契约 + 既有面 + B1 回归套件 | vitest（上） | **72/72 passed，exit 0** |
| SA7 新增动态套件（本报告核心证据） | `./node_modules/.bin/vitest run packages/namespace-registry/test/registry-create-diagnostic-sa7-dynamic.test.ts --typecheck.enabled=false` | **10/10 passed，exit 0** |
| CI typecheck 门禁 | `./node_modules/.bin/tsc -p tsconfig.typecheck.json` | **exit 0、0 errors**（含新增 SA7 测试文件） |
| CI Test 步骤等效全量 | `pnpm test`（ci.yml:39 同命令同配置） | **145 文件 / 1848 测试全过、Type Errors 0**；exit 1 仅因 2 条 vitest worker RPC 超时（见「Infrastructure flake 登记」——baseline 判别证明与本题 diff 无关） |
| baseline 判别实验 | 临时 worktree @ `722bddf`（本题 diff 之前）跑同款 `pnpm test` | **142 文件 / 1816 测试全过、Type Errors 0、同样 2 条 `onTaskUpdate` 超时 → exit 1**——flake 为环境既有条件，非本题引入（worktree 已删净） |
| gh PR/CI 查询 | `gh pr list --head fix/issue-150-on-...` / `gh run list --branch ...` | 空——分支未发布，无 PR、无 CI run（SA7 不负责 push/建 PR） |

---

## SA4 动态审核重点逐条验证

### 重点 1 — B1 修复后回归面：违约/畸形 seam 注入 × create 全结局路径 ✅

**方法**：`driveAllPaths(seam)` 驱动器把 create 的 **10 条结局路径**（成功 / entry duplicate / 持久层 DOC_DUPLICATE / 敌意 payload 快照失败 / schema 编译失败 / ROOT 校验失败 / 持久层运营失败 / 提交后 Runtime 构造失败 fatal + open 恢复 / identity 拒绝 / 停接纳拒绝）各自跑通并归一化结局摘要，**与无日志基线 `toEqual` 逐位比对**；成功+duplicate 共用 registry 并以干净 shutdown 收尾（entry 泄漏守卫）。

**注入形态 × 4 it 全绿**：

| 注入形态 | 全结局 vs 基线 | 说明 |
|---|---|---|
| `diagnosticLog: null` | **逐位一致** | R1 PoC 攻击形态；成功路径不被 fatal 翻转、无 entry 泄漏、shutdown 干净 |
| 敌意 Proxy（全部 getter throw） | **逐位一致** | seam 属性读取在构造栈吞没边界内（B1 修复拓扑活链路确认） |
| `{emitter: undefined}` / `{emitter:{}}` / `{emitter:{emit:'not-a-function'}}` | **逐位一致** | 畸形形状全部收敛为日志禁用（NOOP） |
| 合法形状 emitter、`emit()` 恒 throw | **逐位一致** + **emit 恰 10 次 / 10 次 create 尝试** | 日志启用 + adapter 违约不重试、不遗漏、不改业务结局 |

基线自证锚全部命中：成功 `createdAt=NOW_ISO`、各拒绝码（`NAMESPACE_ALREADY_EXISTS`×2 / `NAMESPACE_CREATE_INVALID_INPUT` / `NAMESPACE_SCHEMA_INVALID` / `NAMESPACE_ROOT_INVALID` / `NAMESPACE_CREATE_FAILED` / `REGISTRY_NOT_ACCEPTING`）、fatal `{name:'NamespaceRegistryFatalError', phase:'runtime-construction', committed:true}` + open 恢复 ok。fixture 勘误备案：identity 拒绝（缺 namespaceId/schema/root）既有稳定码为 `NAMESPACE_INVALID_IDENTITY`（非 INVALID_INPUT——测试按事实修正，契约文件未涉及该路径）。

### 重点 2 — File adapter first-slice 同步成本与同 key FIFO ✅

**同步 I/O 证据（活链路）**：Host binding（AC2 同款真实 `createFileDiagnosticLog` 装配）在 initStream 内、**构造返回后立即**（此刻 success 路径 #17 emission 尚未发生——DC-2 冻结次序 initStream 先于 emit）严格读回磁盘：`readStreamStrict` status `'ok'` + `manifest.json` `existsSync` 真 + **恰 1 条 genesis-baseline**——证明 mkdir/manifest('wx')/genesis append/current.json rename 全部在 initStream 返回前同步完成，无延迟落盘。

**实测成本（[SA7-DV] 测试输出，两轮）**：

```
[SA7-DV] first-slice initStream（同步 mkdir+manifest('wx')+genesis append+current.json rename）耗时 126.61–173.47ms；含日志 create 总耗时 210.43–307.68ms
[SA7-DV] 同 key duplicate create（零 first-slice 成本）耗时 61.84–65.68ms
[SA7-DV] 同 key FIFO ×3（1 成功 + 2 duplicate，恰 1 次 first-slice）总耗时 58.91–108.67ms
```

（绝对毫秒受多租户机器负载影响，仅作量级参考；设计 §8.1 已明示不对磁盘 I/O 延迟作有界性声明，成本归属 create 调用方——§8.5。）

**一次性/每 namespace 至多一次**：成功 create 后 `initCalls===1`；同 key 第二次尝试（entry duplicate）`initCalls` 保持 1、不再付 stream 建立成本。
**同 key FIFO 无异常放大**：首槽以 Persistence gate 挂住，3 连 create 排队（gate 期 `createCalls===1` 证明串行）；释放后 FIFO 结算 = 1 成功 + 2×`NAMESPACE_ALREADY_EXISTS`；**单 stream**（streams 目录恰 1）、seq 严格递增 `'1'..'4'`、stage 序列 `[genesis, transaction(committed), acceptance, acceptance]`（成功先、duplicate 后，无交错损坏）、`initStream` 恰一次（无成本放大）。

### 重点 3 — shutdown 与在途 create（设计 §8.5 三条）✅

**在途槽含同步 emit/initStream**（真实 File adapter Host binding + Persistence gate）：

- shutdown() 调用后同步段即观测 `{state:'shutting-down'}`；**在途窗口（gate 未释放）`initCalls===0`、零缓冲 emission**——committed 事实未确立不建 stream，shutdown 早期段零日志动作（不调 initStream ✅）；
- gate 释放后：create `ok:true` 完整结算（含槽内同步 initStream + #17 emit），`await shutdownPromise` 干净 resolve（`carrier.tail` 自然覆盖在途槽，无死等 ✅），终态 `{state:'stopped'}`；
- `initCalls===1`（恰一次，来自 create 槽；shutdown 自身零调用 ✅）；磁盘 stream 完整（genesis seq1 + committed attempt seq2）；
- **不 drain ✅**：shutdown 结算后 64 轮微任务 flush，磁盘记录数稳定为 2（零迟到写）；
- 停后 create：`REGISTRY_NOT_ACCEPTING` resolve + **恰 +1 acceptance attempt 记录**（create 尝试本身的诚实记录，非 drain 产物），`initCalls` 保持 1（停后路径零 stream 建立）。

**零在途 + 日志启用**：空 registry `await shutdown()` 立即结算（零死等——零新增异步状态 ✅）、`initCalls===0`、记录 0 且 flush 后稳定（不 drain、零迟到写入）。

### 重点 4 — 双记录理论角（SA4 观察 2 残留）✅

- 提交后 Runtime 构造失败：**恰 1 条 attempt**（#18 形：`transaction` / `NAMESPACE_REGISTRY_FATAL` / `sourcePhase:'runtime-construction'`），64 轮 flush 后计数稳定——**无 #17+#18 双记录**（理论角 `issueLease`/`createLeaseController` 纯对象构造不可达，活链路确认未发生）；
- 成功 create：**恰 1 条**（#17 committed），flush 后稳定。

---

## vitest 触发证据 (verdict 升级 — 2026-06-15 立法)

**CI Run**: ❌ 不存在——分支 `fix/issue-150-on-docs-namespace-diagnostic-change-log` 未发布（`gh pr list` 空、`gh run list` 空）。SA7 不负责 push/建 PR/宣称 CI 已绿。**分类：环境阻塞（CI run log 不可得），以本地动态等效证据替代**。

**本地动态等效**（与 ci.yml `Test` 步骤**同命令同配置**：`pnpm test` → vitest.config.ts include `packages/*/test/**/*.test.ts`，typecheck 同步启用）——`pnpm test` 全量收集中三个测试文件均真实执行且全绿：

| Workspace Package | CI Step Name | 触发结果 | log 摘录 |
|---|---|---|---|
| namespace-registry | Test (`pnpm test`, ci.yml:39) | ✓ 触发且通过（本地等效；CI run 待发布后补录） | ` ✓ packages/namespace-registry/test/registry-create-diagnostic-red.test.ts (16 tests)` / ` ✓ ...registry-create-diagnostic-code-source.test.ts (6 tests)` / ` ✓ ...registry-create.test.ts (50 tests)` / ` ✓ ...registry-create-diagnostic-sa7-dynamic.test.ts (10 tests)`；` Test Files 145 passed (145)` ` Tests 1848 passed (1848)` `Type Errors no errors` |

（E2E spec 触发 N/A——本任务无 `*.spec.ts`，与 SA4 §1.3 一致。）

**移交总控**：发布建 PR 后，以 `gh run view <run-id> --log` 摘录两文件在 `pnpm test` 步骤的真实执行行，补齐本节 CI run 列（SA4 §1.4 静态结论的动态确认闭环）。

---

## Infrastructure flake 登记（非测试失败，已判别定性）

全量 `pnpm test` 在本机出现 **2 条 `Error: [vitest-worker]: Timeout calling "onTaskUpdate"`**（vitest worker→主进程 RPC 超时）→ exit 1，**测试本体零失败、Type Errors 0**。判别证据链：

| Run | 对象 | 并行度 | 测试结果 | RPC 超时 | exit |
|---|---|---|---|---|---|
| A（01:14） | HEAD（无 SA7 新文件） | 默认 | 144 文件/1838 全过 | 2 | 1 |
| B（01:24） | HEAD（含 SA7 新文件） | 默认（无并发负载） | 145 文件/1848 全过 | 2 | 1 |
| C（01:35） | HEAD | `--maxWorkers=1` 串行 | 145 文件/1848 全过 | 2 | 1 |
| D | 仅 vfsl 重负载两套件 | 默认 | 2 文件/35 全过 | 0 | **0** |
| E | **baseline `722bddf`（本题 diff 之前）** | 默认 | 142 文件/1816 全过 | **2（同款）** | 1 |

Run E 为决定性判别：**flake 在本题改动之前即以完全相同形态存在**，与本任务 diff 无关；诱因为本机 2 核 + 持续外部负载（load avg 3.57–4.45，多租户）下全量 7 分钟级运行饿死 worker RPC 心跳（Run D 单独跑重负载套件即 exit 0）。仓库既往 SA7 报告（task_namespace-runtime-replace-schema 等）已多次登记同款环境噪声。CI runner（专用 ubuntu-latest）不具备该饥饿条件，预期不受影响（发布后以真实 CI run 确认）。

---

## 残留（非阻断，备案）

1. **CI run log 补录**：见上「移交总控」——发布后摘录 `gh run view --log` 两文件执行行（静态面 SA4 §1.4 已过，动态面本地等效已过，仅缺真实 CI 摘录）。
2. **first-slice 绝对耗时**：本机多租户负载下 126–173ms 量级，不构成任何断言；Host 对延迟敏感可装配 memory adapter（设计 §8.5/§9.4 既定归属）。
3. SA7 套件 identity 拒绝锚实测既有稳定码为 `NAMESPACE_INVALID_IDENTITY`（identity 阶段），与 SA6 冻结面无冲突（后者未覆盖该路径）。

## 裁决

- SA4 R2 pass 前提下独立动态验证：**未发现任何 fail 证据**。
- SA4 五条动态审核重点：重点 1（B1 回归面）✅、重点 2（File adapter 同步成本/FIFO）✅、重点 3（shutdown/在途）✅、重点 4（双记录）✅、重点 5（触发证据）本地等效 ✅ + CI 摘录环境阻塞移交。
- 全量测试本体全绿（145/145 文件、1848/1848 用例、Type Errors 0），exit-1 污染源经 baseline 判别确证为环境既有 flake。

**Verdict: pass**

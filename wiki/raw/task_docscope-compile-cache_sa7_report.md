# SA7 动态验证报告 — DocScope 作用域绑定与编译缓存（H3 / issue #54）

**Date**: 2026-08-21
**Reviewer**: SA7（Dynamic Verifier）
**被验对象**: HEAD `54f7cce68a30a9e22ec96e99f5e894c149d24a62`（= SA4 审计链 e43f3a5 + cb42b6b + 54f7cce 顶端）
**依据**: SA4 verdict **pass**（`task_docscope-compile-cache_sa4_review.md` 动态审核重点 5 项）；SA6 红灯测试 `packages/vfsl/test/docscope-getcompiled.test.ts`
**方法声明**: 本会话零采信任何先行日志（含 `.mabf-bg/ctrl-*`），全部动态证据由本 SA 以独立进程（setsid detached）亲跑；环境 node v24.13.0 / worktree `/home/wangjian/nomicore-fix-issue-54`。未修改任何源码与测试。

## Step 0 — SA4 verdict 校对

SA4 review 顶部 `Verdict: pass`（:7）。→ 进 Step 1。

## Step 1 — SA6 红灯测试（现已应绿）

```
pnpm exec vitest run packages/vfsl/test/docscope-getcompiled.test.ts
→ Test Files 1 passed (1) / Tests 13 passed (13) / Type Errors no errors / exit 0
```

[SA7 Step 1 结论] SA6 红灯: 🟢 GREEN（13/13，exit 0，本会话亲跑）→ 进入 Step 2。

## 本会话亲跑证据总表（全部独立进程）

| 验证项 | 命令 | 结果 | 日志 |
|---|---|---|---|
| SA6 定向 | `pnpm exec vitest run packages/vfsl/test/docscope-getcompiled.test.ts` | 13/13 绿，exit 0 | `.mabf-bg/sa7/sa7-targeted.log` |
| 全量测试 | `pnpm test`（= `vitest run --typecheck`） | **36 files / 555/555 绿，Type Errors 0，exit 0** | `.mabf-bg/sa7/sa7-full.log` |
| 类型检查（CI 步骤本地镜像） | `pnpm typecheck`（三包 tsc） | exit 0，零错 | `.mabf-bg/sa7/sa7-tc.log` |
| 动态探针（重点 3/4/5） | `NODE_OPTIONS=--expose-gc tsx .mabf-bg/sa7/probe.ts` | 见下文（10/11 探针断言过，唯一失败项为本 SA 阈值误校准，非缺陷） | `.mabf-bg/sa7/sa7-probe.log` |

## SA4 动态审核重点逐条裁定

### 重点 2 —— 内容哈希锚定（防审计后漂移）✅ 无漂移

- `git rev-parse HEAD` = `54f7cce68a30a9e22ec96e99f5e894c149d24a62`（blob-identical 于 SA4 审计链顶端）。
- **src 自 SA4 审计的 feat commit e43f3a5 起零漂移**：`git diff e43f3a5 HEAD -- packages/vfsl/src` 为空。
- src blob 哈希（供 push 后比对远端 PR 内容）：`sha256.ts` = `40750c422326fb991673d52709ab8b3dbdb88ef7`；`envelope.ts` = `030dfde5ef122b4869c763469f36673ef11b1de0`；`index.ts` = `0b4e3a68e2b3d7898d8d4ec582b7f63386f12ee9`。
- 工作区漂移审计：`docscope-sha256.test.ts` / `docscope-guards.test.ts` HEAD=工作区逐字节一致；`docscope-getcompiled.test.ts` 工作区相对 HEAD 有 diff，但**非注释变更行数 = 0**（`git diff -U0 | grep ^[+-] | grep -v '^[+-] \*'` → 0 行；diff 内容全部为头部 SA6 事后审查裁定注释），代码与断言零漂移。wiki 两个 MM 文件为总控归属更正（staged，流程档案非代码）。
- **结论：SA4 审计对象 = 本报告验证对象，逐字节一致，无审计后漂移。**

### 重点 5 —— 并发/交错调用引用稳定性 ✅（探针 7/7 全过）

tsx 直驱 `src/index.ts` 真实实现（无 mock）：

| 探针断言 | 结果 |
|---|---|
| 500 文本 xorshift 乱序编译 → 逆序重放，引用稳定 500/500 | PASS |
| 500 条目两两互异（Set<ref> = 500，隔离性） | PASS |
| 同文本经 文本载体 / 信封载体(id=doc-a) / 信封载体(id=doc-b) → 同一条目引用（键=内容哈希，id 不参与） | PASS |
| 仅空白差异三文本 → 3 引用互异（正确重算不去重）且派生物 JSON 深相等 | PASS |
| 未知方言（wml@1）拒绝幂等（两次 issues 逐字节全等） | PASS |
| 拒绝后同文本合法信封编译 = 既有条目同引用（拒绝不占缓存键） | PASS |
| 交错负载下命中条目深冻结（变异 `module.aliases` 抛 TypeError） | PASS |

同步函数 + JS 单线程下无 in-flight 竞争（设计 §6 论证成立），交错抽测与论证一致。

### 重点 3 —— 大文本成本 sanity ✅（量级健康，含 1 项容量规划观察）

~64KB 合法文本（65,561B / 3,174 字段），tsx 亲测：

```
first-compile(miss): 33.00 ms   （sha256 + tokenize/parse/analyze/evaluate + deepFreeze + Map.set）
hit(avg of 200):     2787.3 µs  （纯哈希 + Map.get）
sha256-only(avg):    2663.9 µs  （纯 TS 实现吞吐 ≈ 24.6 MB/s）
miss/hit = 12x；hit 相对纯哈希开销 = 1.05x
```

- **命中路径成本 = 纯 sha256 成本 ×1.05**——O(hash) 论证实证，零隐藏重算/零 parse/零 evaluate。
- 首编 33ms（3,174 字段 parse+evaluate+深冻结）相对命中 12x，缓存收益方向正确。
- ⚠ 诚实登记：本 SA 预设的「hit < 1ms」阈值在 64KB 极端文本下不成立（2.8ms）——这是纯 TS sha256 吞吐（~25MB/s，零依赖设计 D8 的固有代价）而非缓存缺陷；本 SA 判该项为**自身阈值误校准**，有效断言（hit≈hash / miss≫hit / 无隐藏重算）全过。容量规划观察：hit 时延随文本长度线性增长，64KB 极端 schema 单次命中 ~2.8ms——常规 schema 文本（≪64KB，如百字节级 fixture ~4µs）完全无感；yjs-server 接入时若出现 >32KB 级信封文本需关注（与重点 4 同属 v2 触发条件监控面）。

### 重点 4 —— 无淘汰 Map 内存上界观察 ✅（观察项，非门禁）

1,000 个互异活命名空间（输入文本合计 43.7KiB），`--expose-gc` 双次 GC 后 heapUsed 增量：

```
entries=1000（compile-all 52.5ms）；heapUsed delta = 2925.5 KiB ≈ 2996 B/entry
全量保留实证：re-sweep 1000/1000 命中同引用（无淘汰 = 设计 v1 行为，非泄漏）
```

外推：10,000 活文档 × ~3KiB ≈ 30MB 驻留——「进程内命名空间数有界」论证在万级文档规模内成立；单条目驻留 ~3KiB（IR + 派生 schema + 路径索引 + 冻结容器）量级合理。v1 无淘汰 + v2 触发条件监控（§12 V2-2）裁定恰当，无缺陷。

### 重点 1 —— vitest 触发证据（PR CI）⏸ 环境阻塞（非代码缺陷，待总控 push 后补验）

- **事实链**：本地分支 `fix/issue-54-on-phase-2-engine-gaps` 领先 `origin/phase-2-engine-gaps` **3 个 commit**（e43f3a5/cb42b6b/54f7cce **均未 push**）；PR #51（head=`phase-2-engine-gaps`）最新 CI run `32463644453` 的 headSha = **a5d85bd**（16:32+08:00，早于 docscope 三 commit 的 18:23+08:00），该 run 全日志 `grep -ci docscope` = **0**。
- 即：**不存在任何包含 docscope 测试的 CI run**；SA7 无 push/建 PR 职权（边界铁律），CI 触发证据在当前状态下不可产出——分类为**环境阻塞**，不是 `vitest-package-not-triggered`（后者指 CI run 存在但包未出现在 runner 列表；此处 run 本身不存在）。
- **静态触发面已核**（push 后即生效）：`ci.yml` on `pull_request` → `pnpm typecheck` + `pnpm test`（vitest include `packages/*/test/**/*.test.ts` 覆盖三个 docscope 测试文件）；本 SA 已本地镜像 CI 两个步骤全绿（555/555 + typecheck exit 0）。
- **总控补验命令**（push 后，PR #51 刷新 CI）：
  ```
  gh run list --branch phase-2-engine-gaps --limit 3
  gh run view <run-id> --log | grep -E 'docscope|Test Files.*passed|Typecheck' | head -20
  # 预期：三个 docscope-*.test.ts 出现在 vitest 输出，555/555，typecheck 零错
  # 并核对 PR blob 与本报告哈希锚定一致（无发布漂移）
  ```

## vitest 触发证据（verdict 升级 — 2026-06-15 立法格式）

CI Run: **N/A——分支未 push，docscope 三 commit 不在任何 CI run 内（headSha 链见上）**

| Workspace Package | CI Step Name | 触发结果 | log 摘录 |
|---|---|---|---|
| vfsl（3 个 docscope 测试文件所在包） | Test (`pnpm test`) | ⏸ ci-not-yet-runnable（分支未 push；静态 include 覆盖已核；本地镜像 555/555 + typecheck exit 0） | PR #51 最新 run（a5d85bd）log 中 `docscope` 计数 = 0（该 run 早于本任务 commit） |

**verdict**: ⏸ 待 push 后补验（非 ❌ vitest-package-not-triggered——CI run 尚不存在，属环境阻塞；本 SA 已固化补验命令与哈希锚定）

## 补充测试决策说明

未新增 vitest 用例，理由：(a) AC1–AC6 正确性面已被 SA6 13 条 + guards + sha256 守卫（合记 555 全量）完整锚定，重点 5 的交错稳定性即 AC3 语义、本 SA 探针独立复证；(b) 重点 3/4 为性能/容量观察项，写入 CI 计时断言会制造易碎测试（timing flake），属报告结论而非回归锚。破坏性探针（`.mabf-bg/sa7/probe.ts`，[SA7-DIAG] 头注）置于 gitignored 区，工作树零污染（`git status` 与收工前一致）。

## 结论

- SA6 红灯全绿（13/13，exit 0，本会话亲跑）；全量 555/555 + 三包 typecheck 零错（独立进程亲跑）。
- SA4 五项动态重点：#2 无漂移 ✅、#5 交错稳定 7/7 ✅、#3 成本量级健康 ✅（1 项阈值误校准已诚实登记）、#4 无淘汰驻留观察符合论证 ✅、#1 CI 触发证据环境阻塞 ⏸（补验命令+哈希锚定已固化，待总控 push）。
- 本会话未发现任何实现缺陷；未动用任何降级/绕过；工作树与 SA4 审计对象逐字节一致。

**Verdict: pass** ——（本地动态验证全绿；唯一未闭合项为 CI 触发证据，成因是分支未 push（环境阻塞、SA7 无权处置），已向总控移交补验命令与内容哈希锚定，push 后 PR 内容与本报告锚定一致即闭环。）

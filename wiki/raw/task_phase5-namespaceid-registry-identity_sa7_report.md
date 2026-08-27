# SA7 动态验证报告 — Phase 5: generate namespaceId and migrate Registry identity

- **Issue**: #131（welltop-jim-wang/nomicore）
- **任务类型**: 功能开发（feature）
- **分支**: fix/issue-131-on-docs-phase-5-websocket-replication
- **Worktree**: /home/wangjian/nomicore-fix-issue-131
- **验证对象**: commit `b21de27`（实现）+ `b0962e9`（SA6 R4 fixture 修正）+ `7296c1e`（docs）；HEAD = `7296c1e`，工作区干净（验证时点 `git status` 零脏文件，唯二新增 = 本报告 + 补充测试）
- **日期**: 2026-08-27（Phase 3 动态验证）
- **环境**: node v24.13.0 / pnpm 10.28.2 / vitest 3.2.7（typecheck enabled）

---

## Step 0 — SA4 verdict 校对

`wiki/raw/task_phase5-namespaceid-registry-identity_sa4_review.md` 顶部结论行（:184）：**`Verdict: pass`** → 进入 Step 1。

## Step 1 — SA6 红灯测试运行（HEAD 单跑）

```
pnpm vitest run packages/namespace-registry/test/registry-phase5-identity-red.test.ts
→ Test Files 1 passed (1) / Tests 20 passed (20) / Type Errors no errors / exit 0
```

**SA6 红灯：🟢 GREEN（20/20）**——15 条 AC 用例 + 锚 A/B1/B2/B3/C 全绿。类型面文件随全量 `--typecheck` 段复验（见 §回归）。

---

## SA4 §10 动态审核重点逐项实测（5/5）

### 重点 1 — R4 提交完整性（SA4 L4 的运行时确认）

**问题**：SA4 审查时 R4 fixture 修正仅在工作区（`git diff HEAD`），已提交态 b21de27 单跑红灯文件仅 17/20。

**实测**：

| 检查 | 命令 | 结果 |
|---|---|---|
| R4 修正已入分支历史 | `git log --oneline -- <red.test.ts>` | `b0962e9 test(namespace-registry): fix SA6 red-anchor fixture — lazy consumed getter read (issue #131)` ✓ |
| HEAD 单跑红灯文件 | `pnpm vitest run packages/namespace-registry/test/registry-phase5-identity-red.test.ts` | **20/20 通过，exit 0**（Step 1） |
| 工作区无未提交漂移 | `git status --short` | 零输出（20/20 即已提交态事实，非工作区态） |

**结论：✅ 本地闭环**——SA4 L4 的操作要求（R4 修正随 commit 提交）已由 `b0962e9` 兑现，HEAD 上红灯文件 20/20。
**CI 侧确认（`gh pr diff` / run log 20/20）未执行**：分支尚未 push、无 PR（`gh pr list --head fix/issue-131-...` → `[]`）；push/PR 属总控职权（SA7 边界）。总控 push 后执行：
`gh run list --branch fix/issue-131-on-docs-phase-5-websocket-replication --limit 1` 取 run id → `gh run view <id> --log | grep -E "registry-phase5-identity-red|20 passed"` 应见 `20 passed (20)`（若见 17 passed 即 R4 修正丢失，回退 SA3）。

### 重点 2 — plugin 生产随机链路实测（格式锚）

**问题**：plugin 测试读回 lease 但未显式锚 namespaceId 格式；scripted 源格式锚只覆盖生成器逻辑。

**方法**（补充测试 D1，`registry-sa7-phase5-dynamic.test.ts`）：真实 cordis host 组合——`new Context()` + `createSystemClockPlugin()`（真实 wall clock）+ `new TimerService(ctx)`（真实 native timer）+ `createMemoryPersistencePlugin()` + `createNamespaceRegistryPlugin()` → `create({owner, schema, root})` ×2。plugin.apply 内 `randomBytes: productionRandomBytes` 是唯一随机接线（无注入 seam），故经真实 host 组合即实机走 `plugin.ts:75-76` 的 `new Uint8Array(node:crypto.randomBytes(...))` 桥接链。

**证据**（实测输出）：

```
[SA7-DYN] D1 plugin 链生成 ID: ns-4364da026e51fb62ae04771dc3a6b1c4 / ns-a1979b1739db261143c8b98f0895d094
```

断言面：两 ID 均匹配 `^ns-[0-9a-f]{32}$`、`length === 35`、互异（非常数/单值源）、`lease.owner` 投影、`lease.read(['n']) === {ok:true, value:42}`（真实 Runtime 读链路）、dispose 后 `{state:'stopped'}`、零 unhandled rejection。

**结论：✅** 生产链路（plugin 桥接 node:crypto）实机产物格式合法。

### 重点 3 — 真实 File Persistence round-trip

**问题**：单元面为 stub 分区建模；生成 ID 从未经真实文件系统落盘/重开。

**方法**（补充测试 D2）：真实 host（system clock + 真实 TimerService）+ `createFilePersistencePlugin({rootDir: mkdtemp})` + registry plugin → create ×2 → `ctx.fiber.dispose()` 全拆 → 断言真实磁盘布局 → 全新 host（新 Context/新插件实例，同 rootDir）open 恢复 + 跨 owner 探测。

**证据**（实测输出与断言）：

```
[SA7-DYN] D2 落盘文件: ns-787565205e72428a5dfa97729210d62f.snapshot, ns-f3ac41489dd73c282c131ad37e491407.snapshot（rootDir=/tmp/nomicore-sa7-131-bytWYU）
```

- 磁盘布局：`<rootDir>/users/u-sa7-file/` 下恰两个 `<nsId>.snapshot`——**owner 分区目录语义**（ADR 0006）实机成立；文件名段匹配 `^ns-[0-9a-f]{32}$`、长度 35（`SAFE_PATH_SEGMENT ^[a-z][a-z0-9-]{0,62}$` 接纳生成 ID，无路径逃逸面）；文件非空；零 `.tmp` 残留（tmp→rename 提交序）。
- round-trip：新 host `open(owner, nsId)` → ok；`read(['n']) === {ok:true, value:42}`（真实 fs 写读闭环，META/ROOT 经 Yjs snapshot 全保真）。
- AC-4 实机：跨 owner `open(u-sa7-other, nsId)` → `{ok:false, code:'NAMESPACE_NOT_FOUND'}`。

**结论：✅** 生成 ID 的真实文件持久化 round-trip（含 owner 分区 + 35 字符文件名安全性）成立。

### 重点 4 — 生产 CSPRNG 抽样观证

**问题**：核心仅形状守卫（设计 §13 显式拒绝核心统计检测）；注入方（生产桥接源）的统计健全性/无重复需抽样观证。

**方法**（补充测试 D3，双层）：
- (a) **经真实 plugin host**（生产随机链路）连续 100 次 create → 全唯一 + 全格式合法；
- (b) **桥接形状抽样**：`productionRandomBytes` 为模块私有（无 seam——这正是 D1 经真实 host 观证的原因），以同款桥接语义 `(length) => new Uint8Array(node:crypto.randomBytes(length))` 直接观证熵源，60,000 次抽样。

**证据**（实测输出）：

```
[SA7-DYN] D3 (a) plugin host 100 create → 100 唯一；(b) 60000 抽样 → 0 重复，字节频率界 [3383, 4117]（期望 3750）
```

- (a) `ids.size === 100`（零重复；常数/低熵源必红）；
- (b) 60,000 抽样：**零重复**（128-bit 空间碰撞期望 ~3.7e-30，观测 0）；抽样点恰 16 字节、普通 `Uint8Array`（`constructor === Uint8Array`——桥接拷贝语义，非 Buffer 子类外泄）；每笔 `ns-<hex>` 过 `^ns-[0-9a-f]{32}$`；**字节分布健全性**：256 值频率全部落于期望 3750 ±6σ（σ≈61.2 → 界 [3383, 4117]；越界 flake 概率 ~5e-7——Math.random/种子化/常数源会越界或先在重复检查红）。

**结论：✅** 抽样观证通过（观测性检查，非核心统计检测——与设计 §13 裁决一致）。

### 重点 5 — 锚 A 真实时序观证（shutdown × 在途重试）

**问题**：单测锚 A（`red.test.ts:597-638`）用确定性 deferred gate + fake scheduler；真实异步序下的屏障行为需抽样复跑。

**方法**（补充测试 D4）：每迭代全新 mkdtemp rootDir + **真实 FilePersistence**（probe read → mkdir → writeFile → rename 多重 macrotask 在途窗口）+ **真实 native scheduler**（`setTimeout/clearTimeout` 直桥，非 fake）+ 真实 wall clock + 真实 node:crypto 熵（剧本仅首两笔 X：create#1 建立 entry X、create#2 首候选撞 entry → 第三笔起真实 CSPRNG）+ 计数 Runtime（close 经 setImmediate 真实 macrotask 后真实 `handle.release()`，对齐真实 Runtime 所有权语义）。12 次迭代两种模式：

- **event ×6**（构造性保证）：在重试候选 Y 的 `io.write` 开始处**从 persistence 回调栈内同步发起 `shutdown()`**（对抗性 interleaving——落点必在在途窗口内）；
- **jitter ×6**（采样）：create#2 发起后 real-sleep 0..5ms 再 shutdown（落点自由分布）。

每迭代断言锚 A 全套不变量（与 `red.test.ts` 同面）：`order === ['create2','shutdown']`（屏障：shutdown settle 晚于在途 create 终局）、`constructed === [X_ID, yId]`（绝无第二个 X Runtime）、X/Y 各恰关闭一次、`{state:'stopped'}`、X/Y snapshot 真实落盘、`draws === 3`（恰三次生成）、零 unhandled rejection。

**证据**（实测输出）：

```
[SA7-DYN] D4 12 次真实调度迭代，shutdown 落点分布: {"in-write":6,"pre-write":2,"post-write":4}
```

event 6/6 构造性落在重试 write 在途窗口内（`in-write` 断言逐次成立）；jitter 6 次自由采样覆盖 pre-write/in-write/post-write 三种真实 interleaving（本次 2/4，含 0 落 in-write——分布为观测值非断言面）。**全部 12 次迭代不变量零违例**。

**结论：✅** 真实调度（native timer + 真实 fs I/O + 真实 CSPRNG）下 `admittedCreates` 结算屏障行为与确定性锚 A 一致，无时序性击穿。

---

## 补充测试登记（SA7 产出）

| 文件 | 用例 | 覆盖 |
|---|---|---|
| `packages/namespace-registry/test/registry-sa7-phase5-dynamic.test.ts` | 4（D1–D4） | SA4 §10 重点 2/3/4/5 的永久回归锚（真实 cordis host / 真实 fs / CSPRNG 抽样 / 真实调度屏障） |

- 真实性纪律：全部用例零 fake scheduler、零剧本化 persistence；real sleep 仅 D4 抖动 6×≤5ms（SA7-P4 烟囱先例，逐处注明）。
- 未修改任何 src/ 生产代码与既有测试（`git status` 仅上述新增）。
- 模块边界遵守：未 import `@nomicore/namespace-runtime/internal`（`registry-surface.test.ts` 冻结「仅 registry.ts 消费」）。

## 回归与门禁

| # | 命令 | 结果 |
|---|---|---|
| R1 | `pnpm vitest run packages/namespace-registry/test/registry-phase5-identity-red.test.ts` | exit 0；**20/20** |
| R2 | `pnpm vitest run packages/namespace-registry/test/registry-sa7-phase5-dynamic.test.ts` | exit 0；**4/4**（另 ×5 连跑全绿——时序稳定性） |
| R3 | `pnpm test`（全仓，含 `--typecheck`） | exit 0；**121 文件 / 1431/1431 通过；Type Errors: no errors**（+4 = 本任务补充用例；**两次连跑确认**） |
| R4 | `npx tsc -p tsconfig.typecheck.json --noEmit` | exit 0 零错误 |
| R5 | `pnpm vitest run packages/namespace-registry/test`（包内） | 190/190（186 既有 + 4 新增） |

**typecheck 门禁咬合自证（登记，非缺陷）**：本报告补充测试首版存在一处 TS 窄化缺陷（`freq[v] += 1` 触发 TS2532），全量 `pnpm test` 即以 `Errors 1 error` + exit 1 拦截（测试本体仍 1431/1431 绿）——与 `task_namespace-runtime-write-sequencer_sa7_report.md` 记录的同款拦截形态一致；测试侧修复（`freq[v] = (freq[v] ?? 0) + 1`）后 R3/R4 双通道复跑 exit 0。门禁真实咬合，非摆设。

## vitest 触发证据（verdict 升级 — 2026-06-15 立法）

本任务 SA6/SA7 新增 `*.test.ts`（vitest 单元测试）：`registry-phase5-identity-red.test.ts`（既有，20 用例）、`registry-phase5-identity-surface.test-d.ts`（类型面）、`registry-sa7-phase5-dynamic.test.ts`（本报告新增，4 用例）——所在 workspace package = **@nomicore/namespace-registry**。

- **静态接通**（本地核验）：根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` 收集两 .test.ts；typecheck.include `packages/*/test/**/*.test-d.ts` 收集 .test-d.ts；CI `.github/workflows/ci.yml:39` Test 步 = `pnpm test`（单步全仓 vitest，无 per-package 过滤）→ 三文件必被收集。
- **本地运行动态证据**：R1/R2/R3（1431/1431 含三文件全绿）。
- **CI run log 摘录**：**待 push**（无 PR——SA7 边界：不 push/不建 PR/不宣称 CI 绿）。总控 push 后按 Step 4 立法执行：`gh run view <run-id> --log | grep -E "registry-sa7-phase5-dynamic|registry-phase5-identity-red|Test Files.*passed"` 摘录 `Running N tests`/`N passed` 原文入发布记录。

| Workspace Package | CI Step Name | 触发结果（本地） | CI log |
|---|---|---|---|
| @nomicore/namespace-registry | Test（`pnpm test`，ci.yml:39） | ✓ 190/190（包内 R5；全仓 1431/1431） | 待 push 后摘录 |

**verdict（本地态）**: ✅ all-vitest-packages-triggered（CI 态由总控 push 后补录）

## 遗留与移交

| # | 级别 | 事项 | 移交 |
|---|---|---|---|
| H1 | 操作项 | 重点 1 的 CI 侧确认（red 文件 20/20 in CI）+ Step 4 CI log 摘录 | 总控 push 后执行（命令已给于 §重点 1 / §vitest 触发证据） |
| H2 | LOW | D4 jitter 落点分布为观测值（本次 in-write:6/pre:2/post:4），非断言面——CI 若极慢环境全落 post-write 亦不影响不变量断言 | 无需处置（记录备查） |

---

## Verdict

SA4 5 项动态审核重点全部实测通过（R4 提交完整性本地闭环、plugin 生产链格式锚、真实 File round-trip、CSPRNG 抽样、真实调度锚 A 屏障）；全仓 1431/1431 + typecheck 双通道零错误（两次连跑）；补充测试 4 例永久回归落盘；唯一未竟项为 CI 侧日志确认（分支未 push，属总控职权，命令已移交）。

**Verdict: pass**

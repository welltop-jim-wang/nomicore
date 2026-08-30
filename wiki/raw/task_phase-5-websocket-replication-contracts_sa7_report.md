# SA7 动态验证报告 — Issue #172 Phase 5 权威契约收敛

**Date**: 2026-08-31
**Verifier**: SA7（Dynamic Verifier）
**被验对象**: `ef19bae → 3141884`（SA3 实现全量 + SA4 F1 窄域文档修复；worktree `/home/wangjian/nomicore-fix-issue-172`，branch `fix/issue-172-on-docs-phase-5-websocket-replication`，HEAD = `3141884`，与 SA4 R2 复验基线一致）
**SA4 基线**: R2 = **pass**（`task_phase-5-websocket-replication-contracts_sa4_review.md` §R2-4）
**Verdict**: **pass**（动态链路全部实测通过；CI 侧 vitest 触发证据因发布阶段未到而挂起——见 §5，交总控发布后观察，不影响对本 diff 的动态结论）

---

## 0. Step 0/Step 1 结论

- **[Step 0]** SA4 verdict = R2 pass（顶部 Verdict 行 + §R2-4）→ 进入动态验证，允许给出 pass。
- **[Step 1] SA6 红灯文件现状**：`packages/ws-replication/test/ws-replication-issue172-contract-anchors.test.ts` 🟢 **17/17 绿**（8 条 `it.fails` 期望红灯 + 8 条现绿回归锁 + 1 条 D2-bis meta 守卫；独立进程 vitest run，exit 0）。随附 r1-r7 文件 14/14 绿（含 R1-3 `it.fails` 期望红灯）。

---

## 1. SA4 §5「动态审核重点」逐条验证（全部实测，独立进程运行）

| # | SA4 重点 | 方法（可重跑） | 结果 |
|---|---|---|---|
| 1 | CI 绿证据（N3） | `gh run list` + `git branch -vv` | **当前不可得**：实现 commits c271476/3141884 未推送（本地分支领先 `origin/docs/phase-5-websocket-replication` 2 commits）、无 PR、无 CI run（workflow 仅 `pull_request` + push main 触发）。SA7 无 push/建 PR 权责 → 本地等价证据 = §3 全量套件 + typecheck；CI 侧观察挂起交总控（§5） |
| 2 | r2-transport 真实 TCP quota 边界 | `pnpm exec vitest run packages/ws-replication/test/ws-replication-sa7-r2-transport.test.ts` | 🟢 **2/2**。A 存活侧：真实内核暂停段（bufferedAmount > 512KiB）+ 4 ns × 32 = 128 ACK ≈ 7.3KiB 全部上 wire、零 ERROR、连接 ready；B 耗尽侧：40 ns × 32 = 1280 ACK ≈ 73KiB > 显式 64_000 额度 → **恰 1 个 ERROR(CONNECTION_BACKPRESSURE) + close(1011) + peer backoff**。真实 TCP（`net.createServer`/`net.connect` 127.0.0.1 随机端口）+ 真实 bufferedAmount 驱动 |
| 3 | D3b 校准实测值漂移 | 临时 `[SA7-DIAG]` 日志单跑 D3b 后 `git checkout` 还原 | 🟢 实测 `{ C_live: 90793, ackBytes: 57, allowed: 23 }` —— 与 SA4 R1 记录（90_793 / 57B / 23）**逐位一致，零漂移**；触发后累计 90_793 + 23×57 = 92_104 ≤ 92_128（slack 24B），主锚 ①–④ 全绿。本环境（node v24.13.0）无需 D4 回退升档 |
| 4 | it.fails 摘标演练 | 翻转实验 ×2（改锚 → 单跑 → `git checkout` 还原，工作区清洁复核） | 🟢 见 §2。meta 守卫对计数漂移敏感（7≠8 反红）；摘标机制按设计意图工作，验证时不误判为回归 |
| 5 | F1 修复后文档一致性 | phase 文档 ↔ r1-r7 测试头 ↔ 源码三方对照 | 🟢 见 §4 |

## 2. it.fails 翻转实验（SA7 独立复演，非转抄 SA4）

| 实验 | 操作 | 实测结果 |
|---|---|---|
| A3-1 摘标（#170 缺口真实性） | `it.fails('A3-1 RED：` → `it('A3-1 RED：`，单跑 anchors | 恰 2 failed：① `pong 超时 close code 必须为 1001: expected 1002 to be 1001`（**断言级红、红因与偏差表「现 close(1002)」逐字互证**）；② meta 守卫 `it.fails 用例数 = DEFERRED_ANCHORS 清单长度…: expected 7 to be 8` |
| R1-3 摘标（严格接纳 pipeline 缺口真实性） | `it.fails('R1-3（B1 契约)` → `it('R1-3（B1 契约)`，单跑 r1-r7 | 恰 1 failed：`拒纳必须无条件 RESYNC 声明: expected 0 to be greater than or equal to 1`（**断言级红**——触发帧被接纳、零 RESYNC，phase 文档偏差表「当前实现」列的实测描述为真） |
| 还原复核 | `git checkout --` 两文件后复跑 | 🟢 2 文件 / 31 tests 全绿（与 SA4 R2-2 记录一致）；`git status` packages/ apps/ 零残留 |

**结论**：两条已知偏差（#170 hub pong 语义、R1-3 pipeline 记账）在活链路上真实存在且以文档登记的精确形态红——「known gap 未被误写为当前实现」获得了**运行时反向证明**（实现确实没有这些行为，摘掉期望红灯标记即暴露）。

## 3. 全量测试 / 基础设施抖动证据（N3 第三数据点）

独立进程 `setsid nohup pnpm test > /tmp/sa7-full.log`（node v24.13.0，本机负载）：

- **Test Files 176 passed (176)；Tests 2043 passed (2043)；Type Errors: no errors** —— 测试层面 100% 绿，零 unhandled application rejection。
- exit 1 源自 **2 个 `Error: [vitest-worker]: Timeout calling "onTaskUpdate"`**（堆栈全部位于 `node_modules/.pnpm/vitest@3.2.7/…/rpc.-pEldfrD.js` 与 vitest 自身 timer —— vitest RPC 基建超时，非测试失败、非被测代码异常）。
- 与历史对照：SA3 记录 = 2041/2043 + 2 个 5s 超时（`registry-phase5-replication-session-red.test.ts`，本票零改动文件）；SA4 复跑 = 2043/2043 + 2 个 RPC 超时；SA7 本次 = 2043/2043 + 2 个 RPC 超时。**三次运行测试全绿或仅负载超时、错误形态均指向并行负载下的环境/基建敏感面**，不可归因于本 diff。
- `pnpm typecheck`（11 个 tsc -p 串联）→ **exit 0**。
- `git diff --check ef19bae HEAD` 与工作树形态 → **均 PASS**。

**N3 处置建议（沿 SA4）**：本地三次数据点不足以定案 CI 行为；GitHub runner（node 20/24 matrix、更轻负载）上 `pnpm test` 全绿与否需**发布后**确认。若 runner 复现基建超时，属既有基建敏感，另立票处理，不回流本票。

## 4. 文档陈述核验（总控专项：R1-3 pipeline gap 与 #169/#170/#171 计划行为不得误写为当前实现）

三方对照（phase 文档「交付现状与边界」节 ↔ ADR-0010 issue #172 修订节 ↔ r1-r7 测试头）+ 源码逐条交叉验证：

| 陈述面 | 文档登记 | 源码实证 | 结论 |
|---|---|---|---|
| R1-3 严格接纳 pipeline 判据 | 切片 6 = **部分交付\***：单帧拒纳 R1-1/R1-2 已交付；「连接级 pipeline 记账（§17 L492 明文含 bufferedAmount）与『拒纳 + 幸存面同批丢弃』**未接线**」；偏差表单列一行、修复票「待总控裁决」 | `backpressure.ts` `enforceConnectionCap` 仅 Σ queued；暂停段入队（update-channel）无 pipeline 判据；**§2 翻转实验运行时证实**（0 RESYNC） | ✅ 未误写 |
| 背压恢复检查点 cadence → #169 | 偏差表：冻结 = `max(1, floor(ackTimeoutMs/100))` 缺省 100ms；当前 = 固定 1_000ms | `backpressure.ts:57` `BACKPRESSURE_POLL_INTERVAL_MS = 1_000`（硬编码常量） | ✅ 未误写 |
| hub 侧 pong 超时 → #170 | 偏差表：冻结 §18 close(1001)；当前 close(1002) 且 PONG_TIMEOUT 不在 §13.1 注册表 | `hub-connection.ts:261` `connectionFatal('PONG_TIMEOUT', 1002)`；**§2 翻转实验运行时证实**（live 观测 1002） | ✅ 未误写 |
| CLOSE_OK 关联 → #171 | 偏差表：不匹配/多余 CLOSE_OK 当前静默忽略 | `peer-namespace.ts:512` `onCloseOk` 仅 `closing && ackedSequence === closeSequence` 时推进，否则静默 return | ✅ 未误写 |
| GOAWAY drain 静默窗口 → #171 | 偏差表：`addTarget` ready 下直接 startOpen；needs-resync 未查 drain 窗口 | `peer-connection.ts:136-161` `addTarget` → `connStateValue === 'ready'` 即 `startOpen()`，无 goawayActive 门（门只在重连路径 `openActiveTargets:446`）；A5-2 锚在场期望红 | ✅ 未误写 |
| hub 停机 GOAWAY → #171 | 偏差表：`HubReplication.close()` 直接 close(1001)、零 GOAWAY 帧 | `hub-connection.ts:96-100` `close()` → `connection.close(1001, 'hub-shutdown')`，无 GOAWAY 发送 | ✅ 未误写 |
| #163/#164/resetReplica 边界 | 切片 8/9/10 + 未交付边界节：peer 侧 resetReplica、observer/metrics、apps composition root 均未交付 | `apps/` 目录零文件改动；公共 API 无 observer 面 | ✅ 未误写 |
| 冻结值不被代码现状改写 | ADR #172 修订节为**纯追加**（+28 行，零修改既有行）；`docs/protocols/instance-replication-v1.md` 本票零改动 | `git diff ef19bae HEAD --name-only` 不含 protocol 文件 | ✅ 无改写 |

同一 commit 内「文档说已交付 / 测试说未实现」的自相矛盾（R1-F1-b）已消除：phase 文档与 r1-r7 测试头对 R1-3 的表述逐点一致（单帧已交付 / 幸存面组合未实现 / 判据仅 Σ queued）。

## 5. vitest 触发证据（Step 4，2026-06-15 立法）与 E2E spec（Step 3）

**本任务 diff 含 22 个 `*.test.ts` 变更（21 改 1 新增，全在 `packages/*/test/`）→ Step 4 适用；`*.spec.ts` 变更 = 零 → Step 3 E2E 门禁 N/A。**

| Workspace Package | CI Step Name | 触发结果 | 证据 |
|---|---|---|---|
| 全部 12 包（含 ws-replication、namespace-registry、doc-runtime、vfsl 等本票触包） | Test (`pnpm test`) | **⏳ pending-publication（非 🔥 未触发）** | 无 CI run 存在：commits 未推送、无 PR（`gh run list` 最新 run 均属其他分支；`git branch -vv` 显示 ahead 2）。CI workflow `on: pull_request / push main` 决定 run 只能在发布后产生 |

- **静态触发面确认**（SA4 E2 + SA7 复核）：`ci.yml` L39 `pnpm test` → `vitest.config.ts` include `packages/*/test/**/*.test.ts`——本票全部 22 个变更测试文件落在该 glob 内；`pnpm typecheck` 串含 `packages/ws-replication/tsconfig.json`。**不存在 workflow 层面的触发缺口**。
- **本地动态等价证据**（发布前可得的最强证据）：§3 全量 `pnpm test`（= CI Test 步骤同命令，含 `--typecheck`）176 文件 / 2043 tests 全绿 + `pnpm typecheck` exit 0；锚文件、r1-r7、r2-transport、D3b 单跑证据见 §1–§2。
- **SA7 无权 push/建 PR/宣称 CI 绿**。此项按 MABF 流程归总控：发布（`mabf_task_publish`）后产生 PR run 时，按 Step 4 表格补摘 `Test Files N passed` 原文日志；若 GitHub runner 上出现基建超时（N3 形态），按 §3 处置建议另立票。

## 6. 非阻断观察（登记，交总控）

- **O1（测试叙事残留，scope-4 邻域）**：`ws-replication-sa7-r2-transport.test.ts` 的 describe/用例标题与行内注释仍写「缺省额度／缺省零漂移抽样／缺省 64KiB 额度」（L373-374、L388、L394、L403 一带），而实际 limits 为**显式** `{ maxBootstrapBytes: 1_024, maxQueuedControlBytes: 64_000 }`（#172 后缺省 = 8 MiB）；文件头与 bootReal setup 注释（L10、L26-27、L234-237）已正确写明「显式额度边界采样（缺省 8 MiB 下真实链路结构性不可达）」。行为断言正确且绿，不影响任何契约登记；属标题措辞滞后，建议随 #169 路由或下一次触碰该文件时顺手对齐（SA7 按「仅新增」纪律不改动已过 SA4 R2 固定范围复审的测试文件）。
- **O2（流程挂起项）**：严格接纳 pipeline 判据缺口的修复路由仍待总控裁决（phase 文档偏差表已显式挂起 + R1-3 it.fails 锚 + 验收锚段存在性登记契约三线在位）——与 SA4 R2-3 残余项 1 状态一致，非本票缺陷。
- **O3（CI 观察）**：见 §3/§5——发布后确认 GitHub runner 全绿；N3 基建敏感如复现则另立票。

## 7. SA7 裁决

**Verdict: pass。**

- SA6 锚文件与 r1-r7 全绿（Step 1 过关）；SA4 §5 五项动态重点中四项实测通过，第 1 项（CI 绿证据）因发布阶段未到而**流程性挂起**（非实现缺陷、非 workflow 触发缺口），已按 Step 4 立法如实分类并移交总控发布后摘证。
- 两条已知偏差（#170、R1-3）经 SA7 独立翻转实验在活链路上证实为**真实且红因精确**——文档「current contract / known gap / planned fix」三分登记获得运行时反向证明；全量 2043 tests + typecheck + `git diff --check` 全部通过。
- 未新增补充测试：本轮为 SA4 R2 pass 后的固定范围动态复验，既有 33 个锚/回归用例 + 翻转实验已完整覆盖验证面；新增测试会越出 R2 固定范围（SA4 R2-2 明确「无生产代码与断言改动」预期）。
- 后继（总控）：① 发布并按 §5 补 CI 触发证据；② 裁决 R1-3 缺口修复路由（建议并入 #169 背压域或新立票）；③ O1 叙事残留可随下一次触碰顺手修。

## 8. 可重跑命令清单

```bash
WT=/home/wangjian/nomicore-fix-issue-172; cd $WT
# Step 1 + §1-2/§1-5（预期：17/14/2 全绿，exit 0）
pnpm exec vitest run packages/ws-replication/test/ws-replication-issue172-contract-anchors.test.ts \
  packages/ws-replication/test/ws-replication-review-revisions-r1-r7-red.test.ts \
  packages/ws-replication/test/ws-replication-sa7-r2-transport.test.ts --passWithNoTests=false
# §3 全量（预期：2043/2043 绿 + Type Errors no errors；exit 可能 1 于 vitest-worker RPC 超时）
pnpm test ; pnpm typecheck ; git diff --check ef19bae HEAD
# §2 翻转实验（改锚→单跑→还原；预期红因见 §2 表）
sed -i "s/it\.fails('A3-1 RED：/it('A3-1 RED：/" packages/ws-replication/test/ws-replication-issue172-contract-anchors.test.ts
pnpm exec vitest run packages/ws-replication/test/ws-replication-issue172-contract-anchors.test.ts --passWithNoTests=false
git checkout -- packages/ws-replication/test/ws-replication-issue172-contract-anchors.test.ts
sed -i "s/it\.fails('R1-3（B1 契约)/it('R1-3（B1 契约)/" packages/ws-replication/test/ws-replication-review-revisions-r1-r7-red.test.ts
pnpm exec vitest run packages/ws-replication/test/ws-replication-review-revisions-r1-r7-red.test.ts --passWithNoTests=false
git checkout -- packages/ws-replication/test/ws-replication-review-revisions-r1-r7-red.test.ts
# §1-3 D3b 漂移（临时插桩 console.log('[SA7-DIAG]…{C_live,ackBytes,allowed}') 于 allowed 派生行后，跑后还原）
pnpm exec vitest run packages/ws-replication/test/ws-replication-sa7-issue137-dynamic.test.ts -t "D3b" --passWithNoTests=false
# §4 源码实证位点
sed -n '57p' packages/ws-replication/src/backpressure.ts        # BACKPRESSURE_POLL_INTERVAL_MS = 1_000
sed -n '261p' packages/ws-replication/src/hub-connection.ts     # connectionFatal('PONG_TIMEOUT', 1002)
sed -n '512,520p' packages/ws-replication/src/peer-namespace.ts # onCloseOk 不匹配静默忽略
sed -n '136,161p' packages/ws-replication/src/peer-connection.ts# addTarget ready 即 startOpen（无 drain 门）
sed -n '96,100p' packages/ws-replication/src/hub-connection.ts  # close() 直发 1001 hub-shutdown
# §5 CI 触发状态（预期：无本分支 run —— 发布后重查）
gh run list --limit 8 ; git branch -vv | grep issue-172
```

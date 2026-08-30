# Final Standards / Code-Quality Review — Issue #140 Phase 5（app 黑盒管理动词面）

- **Reviewer scope**: 独立最终 Standards/code-quality review；**未修改任何业务代码**（`git status` 复核：仅新增本报告；此前已存在的 worktree 变更见 §7）
- **Exact diff range reviewed**: `469ca36..HEAD`
- **Reviewed HEAD**: `f310f18`（`fix(app): SA7 F1 rework — settle-wait before re-add in reset orchestration, state-aware add-target idempotence (#140)`，branch `fix/issue-140-on-docs-phase-5-websocket-replication`）
- **Review date**: 2026-08-30
- **Verdict**: **pass**（附 2 项发布前置义务 + 4 项非阻断观察，见 §7/§8）

## 1. 审查输入与范围

- 任务简报 `task_issue-140-phase-5-websocket-replication.md`、AC checklist、SA1 设计（含 R1–R4 修订）、SA2 审查（R1 reject → R2 pass）、SA6 红灯报告、SA4 审查（R1–R4）、SA7 报告（R1 fail-needs-fix → R2 pass）、dispatch log（Step 19 = 本 review）。
- Diff（3 commit：`dbd36d4` → `3863a69` → `f310f18`）恰 6 文件 / +1375 −12：

| 文件 | 性质 |
|---|---|
| `apps/yjs-server/src/app.ts` | 生产代码：dispatch +3 case、3 个新私有 handler、`opAddTarget` 状态感知幂等门、`waitPeerTargetSettled` 助手 |
| `apps/yjs-server/src/lifecycle.ts` | `STABLE_OP_ERROR_CODES` append 8 码 + 注释 |
| `apps/yjs-server/test/phase5-three-instance-acceptance-red.test.ts` | `[SA6 owned]` 验收锚（6 用例；fixture/基建两处已授权修正） |
| `apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts` | `[SA7 owned]` 动态复验收编锚（HEAD 4 用例；worktree 另有未 commit 的 O-R3-1 第 5 例，见 §7） |
| `docs/integration/hub-peer-deployment.md` | 动词表 +3 行、稳定码注册表 +8、管理动词节、事件表 `replica-reset` |
| `docs/phases/phase-5-websocket-replication.md` | 交付现状切片 8/9/10 与未交付边界行登记更新 |

## 2. Standards 门禁执行记录（skill 清单逐项，独立复跑）

| 门禁 | 结果 | 独立证据 |
|---|---|---|
| §1.1 Scope Creep Guard | ✅ | `git diff --name-only 469ca36 HEAD`（6 文件）× 设计 §8 ALLOW LIST 集合比对 → **creep 集合为空**；DENY LIST（`packages/**`、`main.ts`/`config.ts`/`index.ts`、replication/transport、protocol/ADR/CONTEXT）**零触碰**（grep diff 路径零命中）；BLACKLIST（npm/yarn lock、TASK.md、.bak、.DS_Store）**零命中** |
| §1.2 设计偏离 | ✅ | 三 handler 与设计 §3.1–§3.3 伪代码逐行一致（G1–G4 门禁、lease 模式、epoch 防御投影、G5a/G5b/G5c 编排、`replica-reset` 仅成功分支）；R2 修正后的 schema **原样透传 cast**（零对象重建）落地于 `app.ts:646-650` |
| §1.3 E2E spec 触发性 | n/a | 本 diff 无 `*.spec.ts` |
| §1.4 vitest 触发性 | ✅（静态）| 两测试文件均在 `apps/yjs-server/test/` → `vitest.config.ts` include `apps/*/test/**/*.test.ts` 覆盖；CI `ci.yml` `pull_request` → `Test` 步骤 `pnpm test`（= `vitest run --typecheck`）必收集；类型面经 `pnpm typecheck`（`apps/yjs-server/tsconfig.json` include `test/**/*.ts`）。CI 运行期证据仍待发布（§7.2） |
| §1.5 协议假设 | ✅ | E3/E12/E16/E2 引用行**独立重读复核属实**：`peer-connection.ts:216-248`（closed/conflicted/failed → `targeted` + `requestRebuild('re-add')`；closing 等 → 合流零动作）、`openActiveTargets`（disconnected/failed → `targeted`+`startOpen`；closed/conflicted 等显式 re-add）、`peer-namespace.ts:1369-1380`（closeTimeout 兜底 `setState('closed')` + `settleCloseMemo`）、全文件 grep `controllers.delete` **零命中**。E15（keep-root × schema 演进）经锚 AC3-① 复绿实证。遗留 ±行级标注瑕疵（E14 的 `:271` 实为 notifyAuthChanged 守卫）——SA2 R2 已记录，不推翻声称本体 |
| §1.6 契约改动连锁 | ✅ | 纯加法（新 case/新 handler/数组 append/type-only import）；唯一行为改动点 `opAddTarget` 幂等门（F1 修复目标）已全 caller（stdin 单入口）复核 + 既有断言（`stdin-error-chain-red` 4/4）零回归；`ResetReplicaIssue` 失败联合 7 码与 `lifecycle.ts` append 的 7 个透传码**逐一精确匹配**（`types.ts:360-399` vs `lifecycle.ts:112-119`）→ `reset.code` 透传不产生未注册码 |
| §1.7 源码 grep 断言禁令 | ✅ | 两测试文件 `readFileSync` 仅读运行期产物（`.nomicore-lock.json`、archive snapshot）；`toMatch` 仅作用于子进程 stdout 事件值（nsId/replicationId 形状）——零「读源码字符串做断言」反模式 |
| §2 读写路径一致性 | ✅ | SCHEMA 写 = hub lease 写槽 → session fanout → peer apply，单链零分叉；reset 编排 registry probe/archive 同经 registry seam，app 零 persistence 触达 |
| §3 静默失败 | ✅ | 三 handler 全分支有回执（本节复核每个 `if/try/catch`）：G2/G1 拒绝码、`namespace-unknown`、`write-failed`、窄 issue 透传、`reset-replica-failed`（G4 fatal / G5b 防御 / 结算超限）；无「零回执零事件零状态」路径 |
| §4 降级方案 | ✅ | `epoch === undefined → 省略字段`（不虚构数值）；E14 停机窗口伪回执为设计登记的已知有限偏差（数据零丢失 + 重启重引导），未新增无必要性降级 |
| §5 极端条件攻击 | ✅ | G2 覆盖：非字符串/非 32hex-lowercase id、非安全整数/≤0 epoch、空 owner、非 plain-object root（null/数组/标量 → `invalid-op-args`）、schema 四键形状（extra key 原样透传 → runtime ENV-5 严格门响亮拒绝，SA7 用例 2 实证）；`replace-schema` 的 version 收紧（safe integer）严于 provision 面（仅 number），不对称方向无害 |
| §6 错误处理链路 | ✅ | 见 §3；`handleControlLine` 外层 catch 既有兜底未被触碰 |
| §7 架构死胡同 | ✅ 不触发 | AD-1（composition root 归属）零 `packages/**` 绕过；无 FIXME/临时补丁 |
| §8 过度设计 | ✅ 精简 | 生产代码净增 ~210 行 vs 设计预估 ~133 行 + F1 修复增量（settle-wait + 状态感知门 + 助手），量级一致；无多余抽象层 |

## 3. F1 修复（`f310f18`）专项复核 — SA7 结论独立确认

1. **G5b settle-wait**：`await removeTarget` 后轮询 `getNamespaceState`（50ms），接受 `{undefined, closed, conflicted, failed, disconnected}`；预算 = `config.timeouts?.closeTimeoutMs ?? 5000` + 2s 边距。静态闭环成立：引擎保证 closing 必在 closeTimeout 内结算（`onTimerFired('close')` 兜底，§1.5 已复核）→ 预算覆盖；`closeTimeoutMs` 为 config TIMEOUT_KEYS 白名单键（`config.ts:119`）且 app 构造 peer 时透传同一 `timeouts`（`app.ts:243`）→ 预算与引擎实际超时**同源一致**；`DEFAULT_PEER_CLOSE_TIMEOUT_MS = 5_000` 与引擎缺省（`defaults.ts:38`）一致且注释显式登记不 import 包内部缺省的理由。超限 → 诚实 `reset-replica-failed` + `peerOwners` 保持 deleted → `add-target` 重试可达。
2. **状态感知 add-target 幂等门**：短路条件 `peerOwners.has && state ∉ {closed, conflicted, failed}`。G1 角色守卫（`peer === undefined` 检查）先于 `getNamespaceState` 调用——无 undefined 解引用；「has 条目 + state undefined」结构性不可达（controllers map 无 delete + boot 同步建 controller，E12 已复核）；state 只读一次、读后态漂移由引擎 `addTarget` 全态幂等矩阵兜住。
3. **行为回归面**：既有测试对 add-target 只断言首加（`stdin-error-chain-red` 4/4 绿，本 review 独立复跑）；终态放行分支由 SA7 O-R3-1 用例钉住（本 review 复跑绿，见 §5）。

## 4. 文档对齐（AC7）复核

- 动词表 `add-target` 行（非终态短路 / 终态 re-add 恢复入口）、`replace-schema` 行（keep-root × 演进口径 + root 形状门禁）、`bump-epoch` 行（epoch 提交 vs 异步 fencing）、`reset-replica` 行（含结算超限 → `reset-replica-failed`）与实现逐字一致。
- 稳定码注册表文档串与 `lifecycle.ts` 数组**逐码同序**（15 码）。
- 「管理动词」节冻结次序 ①–④（含 ③ settle-wait 与 F1 收编注记）、整连接重建副作用、重复 reset 幂等语义、恢复指引、停机窗口偏差——全部与实现/设计一致。
- `docs/phases/phase-5-websocket-replication.md` 切片 8/9/10 登记与事实一致（A-4 修正维持）。

## 5. 独立验证命令与结果（本 review，独立后台进程串行执行）

| 命令 | 结果 |
|---|---|
| `npx vitest run apps/yjs-server/test/ --no-typecheck` | `1 failed \| 46 passed (47)`，exit 1——**唯一红 = 既有 `smoke-skeleton-red.test.ts` T3**（hub 即读 count 得 0 vs 1，读与复制传播竞态）。该轮有**另一并行全量套件**（外部进程，4+ vitest node）同机竞争，属 SA4 R2 §3 已定性的并行负载抖动家族 |
| `npx vitest run apps/yjs-server/test/smoke-skeleton-red.test.ts --no-typecheck`（卸载并发后串行复跑） | **`3 passed (3)`，exit 0** ✅——判定：环境负载抖动，非 HEAD 代码回归（该文件不在本 diff；本 diff 对其路径（静态 provision target + verify-write/read）零机制性影响） |
| 其中任务相关文件（上一行之全量运行内） | SA6 锚 `phase5-three-instance-acceptance-red.test.ts` **6/6** ✅；SA7 `phase5-mgmt-verbs-sa7.test.ts` **5/5**（含 worktree O-R3-1 例）✅；`stdin-error-chain-red` 4/4 ✅；其余 app 文件全绿 |
| `pnpm typecheck`（12 tsconfig 聚合 no-emit） | **exit 0** ✅ |
| `git diff --name-only 469ca36 HEAD` × ALLOW/DENY/BLACKLIST | creep = ∅；DENY/BLACKLIST 零命中 ✅ |
| 引擎锚点重读（§1.5 列） | 全部属实 ✅ |

**SA4/SA7 已知结论核查**：SA4 R4 pass 的技术面（scope 集合、锚 6/6、typecheck、F1 静态闭环）与 SA7 R2 pass 的动态面（F1 红锚转绿、O-R3-1 终态放行钉住、零回归）**在本 review 独立复验下全部成立**；SA7 R2 遗留的 CI 证据阻塞（分支未 push、无 PR）在 review 时点仍存在——维持「发布后补证」登记（§7.2）。

## 6. 测试行为质量评估

- 两锚文件均为真黑盒：真实 spawn（tsx main.ts）、真实 WebSocket、真实 Persistence（File 独立 rootDir）、断言只消费 stdout NDJSON 回执/事件与运行期磁盘产物；进程组 detached + afterEach 负 pid SIGKILL 回收。
- 断言语义为行为级（收敛值、事件序、回执码、崩溃重启恢复），非文本形状；F1 红锚断言真实收敛（非仅回执），O-R3-1 断言 `target-added` 事件恰在本次 op 后发射 + 通道离开终态 + reset 收敛——放行/重建双证据。
- SA6 锚 fixture 修正（`note?: string` 可选字段演进）与基建修正（`signal ?? undefined`）已由 SA4 R2 核验为断言语义零改动；本 review 抽读确认。

## 7. 发布前置义务（Host 执行，不阻断本地 verdict）

1. **[必须] O-R3-1 用例随发布入库**：HEAD `f310f18` 中 `phase5-mgmt-verbs-sa7.test.ts` 为 4 用例；SA7 R2 新增的 O-R3-1 第 5 例（SA4 R3 移交的「终态通道 + peerOwners 在册 → add-target 放行分支」回归锁）当前是 worktree 未 commit 修改（`git status` M；diff 纯增量——仅 +1 注释行改写 + 新 describe 块，既有 4 例断言零改动）。SA7 R2.7 已登记「待随发布收纳」。**发布 commit 必须包含该 M 状态文件**，否则 O-R3-1 的在库回归锁缺席（本 review 已在 worktree 状态下复跑 5/5 绿 + typecheck exit 0，入库即绿）。
2. **[必须] 发布后补 CI 触发证据**：push/PR 建立后从 `gh run view --log` 摘录 `Test` 步骤中两测试文件的运行证据 + 锚稳定性（O-A；Node 20/24 双矩阵）——SA7 §5/R2.6 既定义务。CI `pnpm test` 为单 job 串行（`concurrency` 组内 cancel），本地并行负载抖动（§5 第 1 行）不构成 CI 风险预期；若 CI 复现抖动另开测试基建票。

## 8. 非阻断观察（移交记录）

1. **O-F2**（SA7 R1，文档卫生票）：peer 侧「活动 schema 仅在（重）物化时切换」——设计 L140 传播链「→ peer installActive」表述与实现不符；建议 SA1/文档侧修订 + 部署指南补运维认知一句（peer 写新 schema 字段需先 reset/restart）。不在 #140 验收面。
2. **O-G2**（SA7 R2）：settle 预算超限分支（`reset-replica-failed` + peerOwners 保持 deleted）无动态证据——引擎 closeTimeout 兜底使其黑盒不可达（需故障注入 seam）；已按诚实口径登记。
3. **E14 行号标注瑕疵**（SA2 R2 残留）：设计 E14 引 `peer-connection.ts:271` 实为 `notifyAuthChanged` 的 stopping 守卫（真正拦截点 = dialNow `:279` + requestRebuild 条件）；±行级瑕疵，不影响声称本体。
4. **commit message 措辞**：`3863a69`「design + deployment docs」实际仅部署文档（O-C）、`f310f18`「Design doc R3 record added」漏 §8（O-R3-3，即 B1，已由 SA1 R4 闭环）——历史记录，无契约影响。

## 9. 结论

- 实现、测试、文档三层在 `469ca36..f310f18` 范围内**与 SA1 设计（R1–R4）和部署契约一致**；F1 修复经静态（引擎锚点全复核）与动态（锚/全量/串行复跑）双面独立确认；零 scope 越界、零未注册稳定码、零静默失败路径、零源码 grep 伪测试。
- 流水线 verdict 链（SA8 clear → SA6 红 → SA2 pass → SA3 ×3 → SA4 R1-R4 pass → SA7 R1 fail→R2 pass → AC complete）闭环成立；本 review 独立复验未推翻任何已记录结论。
- **Verdict: pass**——附 §7 两项发布前置义务（O-R3-1 入库 + 发布后 CI 证据）与 §8 四项非阻断观察。

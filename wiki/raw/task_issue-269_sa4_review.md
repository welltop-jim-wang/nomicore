# SA4 实现后红队审查 — Issue #269 任务树（iteration 2：CI flake 修复）

> 阶段：implementation-review（iteration 2）。派发：`sa-466ab6c6-a5cd-4bf8-89b9-7bbe9d1b3a65`（mabf-sa4）。
> 审查对象：SA3 iteration 2 的 CI 修复 —— `apps/yjs-server/test/hub-restart-static-target-red.test.ts`
> 工作树未提交改动（+73/−4）+ `wiki/raw/task_issue-269_sa3_impl.md` 原位更新。
> Worktree：`/home/wangjian/nomicore-fix-issue-269`（branch `mabf/issue-269`，HEAD `e84c160`，起手 clean）。
> 方法：纯静态审查（读源码/测试/协议/diff/git 状态/owner 评论）；未修改实现、未运行测试、未启动服务。
> **iteration 1（归档：#269 REST 实现评审，`approve`，0 BLOCKER/0 MAJOR）原文保留在文末。**

## 1. Reviewed inputs

| 输入 | 位置 | 状态 |
|---|---|---|
| 本次 dispatch | Host 提示词（sa-466ab6c6…，iteration 2 复核） | 四项专项：修复正确性与聚焦证据、断言无删除/弱化/skip、无 `[tmp-diag]`/`[tmp-gate]`/临时探针残留、仅许可范围变更 |
| Owner 评论（裁决） | GitHub issue #269 comment `5629026278`（welltop-jim-wang，updated `2026-09-11T03:31:05Z`）——**SA4 经 `gh api` 只读复核，与 dispatch 转述逐字一致** | 4 条口径：① 允许修该用例的 backoff 时序假设（根因 full jitter 无下界）；② 必须保留全部既有断言 + 提交信息与 PR 说明披露「#229 flake 收敛，非本票功能」；③ 提交前清除临时诊断输出；④ 新 head 重跑 SA9/SA10 |
| SA3 实现报告（iteration 2） | `wiki/raw/task_issue-269_sa3_impl.md` §「Iteration 2」 | 已全文读；V1–V7 证据、Changed paths、D7–D9、suggested commit message |
| 被修测试 | `apps/yjs-server/test/hub-restart-static-target-red.test.ts`（工作树 vs `HEAD` 逐行 diff + 全文） | 已全文读（362 行） |
| 协议契约（只读） | `docs/protocols/instance-replication-v1.md` §15（L426–431） | full jitter：`cap = min(maxBackoffMs, baseBackoffMs·2^attempt)`、`delay = random(0, cap)`——实测核对 |
| 实现锚点（只读） | `packages/ws-replication/src/peer-connection.ts`：`onTemporaryFailure`（L913–953）、`setState`（L1067–1077）、`emitBackoffScheduled`（L138–151）、`dialNow`（L1116+，实测 `setState('connecting')` 同步先于 dial）；`types.ts` L320–342（事件判别联合含 `delayMs: number`） | SA3 报告引用的行号/语义逐处实测吻合 |
| App 观测面（只读） | `apps/yjs-server/src/app.ts`：observer `type`→`event` 改名直通（L180–182）、`status` op 返回 `connectionState: peerService.status.connection`（L497–504）；`config.ts` `validatePartialNumberBlock`（正有限数，无上界） | 事件字段与 `status` 回执语义核对 |
| CI/类型入口 | `.github/ci/test-durations.json`（该文件条目 `19965`，零改动）、根 `package.json` `typecheck` 链含 `apps/yjs-server/tsconfig.json`（include `test/**/*.ts`）、根 `pnpm test` vitest include | 测试仍在类型门与 CI 触发面内 |
| 历史契约核查 | `wiki/raw/task_issue-139_{design,sa6_red}.md`（该文件最初 T6 契约，blocked-recovery 语义，已被 #235 commit `b551791` 重写为 #229 自动恢复语义）；`git log --follow`（该文件仅 `b66615c`、`b551791` 触及） | **本 worktree 无对该测试当前版本的 SA6 sha 冻结契约**（无 `task_229`/`task_235` 产物）⇒ 无冻结改写问题 |
| 工作树状态 | `git status --porcelain --untracked-files=all` | 恰 2 个 modified（被修测试 + SA3 报告），0 untracked，0 stash |

固定输入缺失项（非缺口）：本修复无 SA1 设计件/ALLOW 列表（owner 评论即为授权来源，SA3 D7 已披露）；#229/#235 无本地任务产物（该测试当前版本的语义基线 = `main` 上的 `b551791`）。

## 2. Verdict

**`approve`** —— 0 BLOCKER、0 MAJOR；Required revisions 为空；3 条非阻断观察（§12）。
**两项目前尚未履行的 owner 交付条件（非实现缺陷，属 Controller 收尾义务）必须在交付前完成**：
(1) commit/PR 双面披露「#229 flake-stability 修复，非 #269 功能改动」——commit message 已由 SA3 报告 staged（`fix(#229): …`），**PR 说明披露尚未存在**；(2) 新 head 重跑 SA9/SA10。详见 §11。

dispatch 四项专项结论（证据见 §3–§9）：

1. **修复正确性与聚焦证据：通过**。根因判定与 owner 裁决、协议 §15、`peer-connection.ts` 实现三方一致
   （`delay = max(0, random()×cap)`，帽值无下界——实测 L940–941）。`waitForArmedBackoffWindow` 的
   「最新一条已武装 `connection-backoff-scheduled` 且未被后续 `connection-state-changed` 取代」判据与
   事件面机制逐点吻合（见 §4）。预算推导（boot×2 + 2s，帽 = 2×预算 ⇒ 单次武装命中率 ≈ 50%）数学成立。
2. **断言无删除/弱化/skip：通过**。修复前后各 13 条 `expect(`，逐条对位；受保护断言
   `expect(statusBeforeWrite.connectionState).toBe('backoff')` 逐字保留（仅新增第二参诊断消息——
   vitest 语义下不影响判定）；无 `.skip`/`.only`/`.todo`；`it` 超时 `240_000` 未动。
3. **无临时诊断/探针残留：通过**。代码 diff 中 `tmp-diag`/`tmp-gate`/`tmp-phase`/`console.`/`debugger`
   0 命中（diff 内唯一 "console" 字样位于 SA3 报告对 V7 的文字描述，非代码）；工作树 0 untracked
   探针脚本；测试文件内唯一 `process.env` 引用是既有 `spawnApp` 的 `NODE_OPTIONS`（修复未触碰）。
4. **仅许可范围变更：通过**。恰 2 个路径：owner 逐字点名的测试文件 + SA3 固定报告产物；无生产代码、
   无 `.github/**`、无 `test-durations.json`、无其它测试。diff 的 pre-image blob `2ec6e69` 与 owner
   评论中「与 `main` 逐字节相同 sha `2ec6e69`」吻合（改动确以 main 同版为基线）。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| Owner ①（允许）：修正用例对 backoff 时序的假设；根因 = full jitter 无延迟下界 | 测试面修复：`waitForArmedBackoffWindow`（L130–163）+ 实测派生帽值（L262–265）+ 重启前取已武装窗口（L314–320）；生产代码零改动（协议 §15 full jitter 是规范行为，不可为测试加下界——SA3 论证成立且与 owner 根因表述一致） | 落实 |
| Owner ②a：必须保留全部既有断言，不得删除/放宽/skip | 见 §2 专项 2 与 §9 断言对位表（13↔13） | 落实 |
| Owner ②b：提交信息与 PR 说明明确披露「#229 flake 收敛 / CI 稳定性修复，非本票功能改动」 | SA3 报告 §Suggested commit message：`fix(#229): 消除 hub-restart-static-target 的 backoff 窗口竞争（CI shard 2/6）` + 正文「修复（仅测试面）」——commit 侧已 staged；**commit 尚未创建、PR 说明披露尚无载体**（SA3/SA4 均不执行 git 写/PR 操作） | 部分 staged——**Controller 收尾必做**（§11-R2） |
| Owner ③：提交前清除 `[tmp-diag]`/`[tmp-gate]`/临时探针 | 见 §2 专项 3（静态实测 0 残留）；SA3 V4 的临时诊断已声明移除且 diff 中不可见 | 落实 |
| Owner ④：新 head 重跑 SA9/SA10 | 尚未发生（本审查为 SA4；SA9/SA10 由 Controller 派发） | **Controller 收尾必做**（§11-R3） |
| SA3 报告 V1–V7 证据的可静态复核面 | V7（git 状态/+73/−4/无残留）实测吻合；根因锚点（协议 §15、peer-connection 三处行号、`types.ts` 事件面）实测吻合；V2–V6 为 SA3 实跑声明（SA4 纪律不复跑，入 §11） | 一致 |

## 4. 设计落实审查（修复方案语义）

| Design decision（SA3 iteration 2 方案） | Implementation location | Assessment | Finding |
|---|---|---|---|
| 根因：`backoff.baseMs/maxMs` 只定义抖动帽、无下界 | `peer-connection.ts` L940–941：`delay = Math.max(0, random() × cap)`、`cap = min(maxMs, baseMs·2^(attempts−1))`；协议 §15 同文 | 与 owner 裁决逐字同构 | — |
| helper 以「最新一条 `connection-backoff-scheduled`」为武装事实 | L139–147：从 `fromIndex` 起倒序扫到最新一条 backoff-scheduled 即评估 | 正确：`onTemporaryFailure` 在 backoff 态早退（L916）⇒ 任一时刻至多一个已武装 timer；新 schedule 必然伴随旧窗口失效 | — |
| 「未被后续 `connection-state-changed` 取代」= 窗口新鲜判据 | L143 | 正确：`setState('backoff')` 先于 `emitBackoffScheduled`（L938–940，同次武装的入态事件在 schedule **之前**，不误判 supersede）；timer fire → `dialNow` 同步 `setState('connecting')`（实测）⇒ 窗口过期必然产生后续 state-changed | — |
| `delayMs ≥ minDelayMs` 且为 number 才接受 | L144–145（`typeof delayMs === 'number'` 防 JSON 形状漂移；事件契约 `types.ts` L337 `delayMs: number`，app.ts observer `type`→`event` 直通其余字段） | 正确 | — |
| 不满足则等下一次武装；超时/进程退出响亮失败 | L146（break 等下一轮）、L148–160（exit→throw 含 stderr；timeout→throw 含全部观测到的 `delayMs` 列表） | 无静默放行路径 | — |
| 预算 = 首次 boot 实测 ×2 + 2s（500ms 上取整）；帽 = 2×预算 | L257–265：`hubV2BootStartedAt` 在 spawn 前取样、`waitForEvent('ready')`（50ms 轮询粒度计入实测）后计算 | 数学成立：v2b 与 v2 同 config/rootDir；full jitter `delay ∈ [0, 2B')` 命中 `≥ B'` 概率 = 50%（期望尝试次数 2）；窗口 ≥ B' = 2×boot + 2s 覆盖 v2b boot（≈boot）+ status RTT（ms 级），余量 ≈ boot + 2s | — |
| peer 配置帽值改运行期派生（`baseMs = maxMs = backoffCapMs`） | L278 | 合法：config 校验仅要求正有限数（`validatePartialNumberBlock`）；cap = min(maxMs, baseMs·2^n) = maxMs 恒成立，attempt 增长不改变分布 | — |
| 断言前提确定化：等已武装窗口 → spawn v2b → ready → status → `toBe('backoff')` | L314–330 | 语义保留且前提确定；残余尾巴风险（v2b boot > 2×实测+2s）以带时间信息的断言消息**响亮失败**（L327–330），SA3 已诚实披露为慢环境残余风险 | — |
| live 等待上界 60s → `backoffCapMs + 30s` | L340–346 | 上界推导正确：Peer 只能在已武装延迟（≤ cap）内离开 backoff + 30s OPEN/reconcile 余量；快环境下该界**更紧**（如 cap 5s ⇒ 35s），慢环境下更大（cap 48s ⇒ 78s）——这是派生界替换任意常量，非弱化（断言本身是事件发生，界只是失败期限） | — |
| 既有语义断言全保留 | L300–307（backoff-scheduled 出现、`goaway-received` 缺席、无 `blocked`、`exitCode === null`）、L336（断线写 ok）、L354–355（收敛到 11）、L357–358（peer/hub SIGTERM exit 0） | 逐条在位 | — |

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| full jitter 重拨语义 | `packages/ws-replication`（协议 §15 规范行为） | 零改动 | 正确——不为测试收敛改生产时序（无 env override/下界/确定性 jitter 旁路） |
| 时序前提确定化 | 测试自身（错误假设的归属方） | 测试 helper + 派生帽值 | 正确——失效的是测试推断，修在测试 |
| Hub boot 预算实测 | 测试编排 | 同一用例内先测 v2 boot 再派生 | 正确——无跨用例共享状态/全局常量 |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| 有界事件轮询 helper | 同文件 `waitForEvent`/`waitForExit`/`sendOp`（20–50ms 轮询 + 响亮 throw + stderr 附带） | `waitForArmedBackoffWindow` 同构（20ms 轮询、exit/timeout 双 throw、超时附观测 delayMs 列表） | 一致 | 复用既有 Proc 事件面与失败风格，无平行机制 |
| 进程 E2E 等待先例 | `task_expose-diagnostic-replay-host-lifecycle` 系（同款 spawn/NDJSON/SIGTERM 原语） | 未触碰 | 一致 | 无交叉 |
| 时序确定化手法 | 包内测试以注入 `random`/`timer` seam 取确定性（协议 §15「Scheduler 和 random 必须注入测试 seam」——但那是**包内** seam） | app 级真实进程测试无法注入 seam ⇒ 以事件流观测 + 预算化等待替代 | 一致（层次恰当） | app E2E 不得为注入 seam 破坏 composition root 真实性 |

### 单一事实源 / 生命周期对称性 / 平行机制

- 单一事实源：武装窗口事实 = 事件流中最新 `connection-backoff-scheduled`（与进程内 timer 同源发射，无第二份状态推导）；Hub boot 事实 = 同 config 实测。无 marker/文件存在性反推、无旁路 RPC。
- 生命周期对称性：无新增资源；helper 无 timer/监听器（纯轮询）；`afterEach` 既有 SIGKILL+tmpdir 清理未动。
- 平行机制检查：无第二套 retry/日志/状态机；helper 为文件内私有函数（与 `waitForEvent` 同族）。

## 6. 文件范围审查

`git status --porcelain --untracked-files=all`（实测）：恰 2 条 `M`，0 untracked，0 stash。`git diff --stat`：
`2 files changed, 219 insertions(+), 4 deletions(-)`（测试 +73/−4；SA3 报告 +146）。pre-image blob `2ec6e69`
与 owner 评论引用的 main sha 吻合。

| Changed path | 授权来源（ALLOW entry） | Purpose | Assessment |
|---|---|---|---|
| `apps/yjs-server/test/hub-restart-static-target-red.test.ts` | Owner 评论 ①（逐字点名该文件，dispatch 复述） | 时序前提确定化；断言语义逐条保留 | 在授权面内；无生产代码 |
| `wiki/raw/task_issue-269_sa3_impl.md` | SA3 角色固定产物 | iteration 2 报告（iteration 1 原文归档保留） | 非实现改动 |

DENY/未触碰面（实测零 diff）：`packages/**`（含 ws-replication、namespace-api）、`apps/yjs-server/src/**`、
其它 `apps/yjs-server/test/**`、`.github/**`（含 `ci/test-durations.json` 条目 `19965` 原值）、`docs/**`、
根/tsconfig/package.json。**范围结论：无越界，符合 owner「除此之外不做任何额外改动」。**

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| 事件契约消费（`connection-backoff-scheduled.delayMs`、`connection-state-changed`） | 仅本测试 helper | 与 `types.ts` 判别联合及 app.ts `type`→`event` 直通逐键核对；`delayMs` 有 `typeof` 防 | 无 | — |
| `status` op 回执 `connectionState` | 本测试 L326–330 | app.ts L497–504 实测返回 `peerService.status.connection`；backoff 态下即 `'backoff'` | 无 | — |
| 生产重拨语义（协议 §15） | 全部 Peer 部署 | 零改动（测试只读事件面） | 无 | — |
| CI 分片权重 | `scripts/ci-test-shard.mjs` | 文件路径/数量不变 ⇒ 装箱不变；`test-durations.json` 未动（SA3 已论证漂移可忽略：本机新耗时 18–24s vs 条目 19965ms 同量级） | 低（见 §11 CI 复跑） | — |
| 类型门 | 根 `pnpm typecheck`（链含 `apps/yjs-server/tsconfig.json`，include `test/**/*.ts`） | 修改后的测试在类型门内（SA3 V5 声明 exit 0；静态核对代码无类型疑点：`Record<string, unknown>` 访问均有守卫） | 低 | — |

## 8. 错误、恢复与并发

- **无静默失败**：helper 的两条失败路径（进程退出/超时）均 throw 且附带 stderr 与观测 `delayMs` 列表；断言失败消息携带「重启耗时 vs 已武装窗口」时间事实（L327–330）——比修复前更可诊断。
- **窗口过期可观测性**：timer fire → `dialNow` 同步 `setState('connecting')`（实测）⇒ 事件流必然出现后续 `connection-state-changed`；helper 的 supersede 判据与之闭合，不存在「窗口已过期仍被当作已武装」的观测空洞。
- **竞态评估**：helper 返回（20ms 轮询粒度）→ spawn v2b 之间存在 ≤ ~25ms 的窗口损耗；预算含 ×2 boot + 2s 余量 ⇒ 实际消耗（≈1×boot + status RTT）距窗口末端余量充足。已知尾巴：v2b boot > 2×实测 + 2s 时断言会失败（响亮、带时间数据）——SA3 Deferred 已披露，属慢环境可调参数，非静默错误。
- **轮询成本**：每 20ms 对事件窗口做倒序扫描；事件密度 = 每次重拨周期 ~3–4 条、90s 上限内 O(百) 级 ⇒ 可忽略。
- **无双重拨号/状态污染**：测试不改 Peer 配置于运行中（配置在 spawn 前写入）；`resetAfterMs: 60_000` 下 attempt 增长不影响 cap 分布（base=max ⇒ cap 恒等）。

## 9. 测试质量审查

SA4 不运行测试；以下为断言对位与触发入口的静态审查（V2–V6 绿证据为 SA3 实跑声明，入 §11）。

**断言对位表（HEAD 版 → 工作树版，逐条对位，13 ↔ 13，零删除/零放宽/零 skip）：**

| # | HEAD（修复前） | 工作树（修复后） | 变化 |
|---|---|---|---|
| 1 | `expect(code, …).toBe(expectedCode)`（signalAndExpectExit） | 同（L168） | 无 |
| 2 | `expect(namespaceId).toMatch(/^ns-[0-9a-f]{32}$/)` | 同（L239） | 无 |
| 3–5 | baseline `verify-write ok` / `read ok` / `value === 7` | 同（L285–288） | 无 |
| 6 | `expect(shutdownEvents.some(backoff-scheduled), JSON.stringify(…)).toBe(true)` | 同（L301–304） | 无 |
| 7 | `goaway-received` 缺席 `toBe(false)` | 同（L305） | 无 |
| 8 | `connection-state-changed → blocked` 缺席 `toBe(false)` | 同（L306） | 无 |
| 9 | `expect(peerProc.exitCode).toBeNull()` | 同（L307） | 无 |
| 10 | **`expect(statusBeforeWrite.connectionState).toBe('backoff')`** | 同一断言 + 新增第二参诊断消息（L327–330） | **判定语义逐字不变**；消息仅提升可诊断性 |
| 11 | `disconnectedWrite.ok === true` | 同（L336） | 无 |
| 12–13 | `recoveredRead.ok === true` / `value === 11` | 同（L354–355） | 无 |

- 结构面：单一 `describe`/`it`，无 `skip/only/todo`（grep 实测）；`it` 超时 `240_000` 未动；`afterEach` 进程 SIGKILL + tmpdir 清理未动。
- 行为级断言：全部基于真实进程事件流/控制通道回执，无源码字符串断言、无 mock 替代。
- 触发入口：路径/文件名未变 ⇒ 根 `pnpm test`（vitest include）与 CI 分片（磁盘枚举）必然继续装箱；该测试在 CI run `34556608627` job `test (20, 2)` 的失败本身即触发面存在的实证。
- 时序敏感面重估：修复把「随机窗口内的瞬态」断言改造为「已武装窗口内的确定前提」断言——这正是 CI 失败的根因修复，而非把断言改宽（对比：放宽为 `not.toBe('ready')` 的方案被 SA3 D8 明确拒绝）。

## 10. Required revisions

无 BLOCKER / MAJOR finding。阻断修订清单为空。

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| R1：SA3 V3（10/10 绿）/V5（typecheck 0 error）/V6（app 全量 162 绿）为 SA3 实跑声明，SA4 纪律下未复跑 | 任意评审/合并前复跑 `NODE_OPTIONS=--conditions=nomicore-source vitest run apps/yjs-server/test/hub-restart-static-target-red.test.ts --typecheck.enabled=false` 与 `pnpm typecheck` | 全绿 / exit 0 | 任一失败 |
| R2：**owner 交付条件（未履行）**：commit message（已 staged `fix(#229): …`）与 **PR 说明** 双面披露「#229 用例 flake 收敛 / CI 稳定性修复，非 #269 功能改动」 | Controller 收尾（commit + PR body 更新；SA3/SA4 均不执行 git 写/PR 操作） | 提交信息与 PR 描述均含该披露；提交不夹带本修复之外的变化 | 交付时 PR 说明未披露，或 commit 范围超出 2 个许可路径 |
| R3：**owner 交付条件（未履行）**：该文件改动使此前 SA9/SA10 评审头失效，须对**新的 head** 重跑最终评审组（SA9 + SA10） | Controller 派发（在 R2 的 commit 落盘后） | SA9 standards / SA10 spec 对新 head 出具新结论 | 新 head 未经 SA9/SA10 复审即交付 |
| R4：CI 复跑确认（SA3 已声明非其范围）：shard 2/6 × Node 20/24 两腿 | Controller push 后 Actions | `hub-restart-static-target-red` 两腿全绿；不再出现 `handshaking ≠ backoff` | 任一腿复现同类失败（此时按 SA3 Deferred 调整预算边际系数，而非放宽断言） |
| R5：极慢 runner 尾巴风险：`waitForArmedBackoffWindow` 90s 界 / 用例 240s 界在 boot 显著变慢（预算随之增大）时可能触顶 | 同 R4 的 CI 观察 | 用例耗时 < 240s；armed 等待 < 90s | 超时失败（消息自带观测 delayMs 与耗时，属响亮失败：调 timeout/边际系数即可，断言不应动） |

## 12. Non-blocking observations

| ID | 观察 | 建议 |
|---|---|---|
| OBS-C | `hubRestartBudgetMs` 以首次 v2 boot 实测 ×2 为边际。若 CI runner 上首次 boot 异常快（冷缓存倒挂：首测快、复测慢）而 v2b 显著更慢，余量可能不足——失败形态是带时间数据的响亮断言失败（非静默），SA3 已披露为可调参数 | 若 R4 出现该形态，把边际从 ×2 提为 ×3 或加下限（如 `max(measured*2, 10s)`），属测试参数调整 |
| OBS-D | `waitForArmedBackoffWindow` 倒序扫描只评估「最新一条」backoff-scheduled（正确性依赖单武装 timer 不变式，现由 `onTemporaryFailure` 的 backoff 早退保证）。该不变式目前只存在于实现行为，未在协议文显式声明 | 无需本轮动作；若协议 §15 将来增补「至多一个已武装 timer」叙述，可在注释中加协议锚点 |
| OBS-E | SA3 报告 V4 的临时诊断（budget/armedDelay/耗时打印）证据采集后移除——工作树实测无残留，符合 owner ③；但「采集后移除」的过程性证据只在报告自述，静态无法复核历史 | 已以结果态（0 残留）验收，满足 owner 条款；无需动作 |

---

# Iteration 1（归档）：#269 REST 实现评审

> 阶段：implementation-review（iteration 0/1）。派发：`sa-0f3df875-5978-4d9c-9cc5-1ee0f5c4f062`（mabf-sa4）。
> 审查对象：SA3 实际实现（当时 HEAD `0b06050`，未提交工作树改动 = 5 个 ALLOW 文件 modified + 上游 SA untracked 产物）。
> 审查基准：SA1 设计 `wiki/raw/task_issue-269_design.md` → SA2 评审 `approve`（0 BLOCKER/MAJOR）
> → SA6 契约 `approve`（29 用例冻结）→ SA3 报告 iteration 1。
> **该迭代结论 `approve`（0 BLOCKER/0 MAJOR，OBS-A/OBS-B）；iteration 2 的 CI 修复未触碰其任何改动面
> （`packages/namespace-api/**` 零 diff），其结论仍然有效。**以下为原文（含当时的实测锚点）。

## 1. Reviewed inputs

| 输入 | 位置 | 状态 |
|---|---|---|
| 任务简报（issue #269 body + AC1–AC6） | `wiki/raw/task_issue-269.md` | 已读；comments 快照空（与 dispatch/SA6/SA8 一致），无 owner override |
| SA1 批准设计 | `wiki/raw/task_issue-269_design.md` | 已全文读（§7.1 T1–T11、§7.3、§7.4、§7.6、§7.7/§7.8） |
| SA2 设计评审 | `wiki/raw/task_issue-269_sa2_review.md` | 已全文读；Required revisions 空；OBS-1~4 |
| SA6 验收契约 | `wiki/raw/task_issue-269_sa6_contract.md` | 已全文读；§12.1 H-M/H-D/H-A、§12.2 R1–R4、§13.4 哈希 |
| SA3 实现报告 | `wiki/raw/task_issue-269_sa3_impl.md` | 已全文读；Changed paths / Verification B0·V1–V4·E1·E2 |
| SA8 门禁（两轮） | `artifacts/sa8-conflict-report-issue-269{,-design-recheck}.md` | 已读头注与裁决节（clear / clear） |
| 实现源码 | `packages/namespace-api/src/{create-namespace,rest,index}.ts`（工作树版本 + HEAD 版本对照） | 已全文读 + `git diff` 逐行 |
| 包契约文档 | `packages/namespace-api/AGENTS.md`、`README.md`（diff） | 已读 |
| 冻结测试（#269，5 文件） | `test/rest-{failure-contract-harness,registry-failure-mapping-contract,abort-boundary-contract,observer-contract,failure-contract-support}*` | 已全文读；sha256 实测 |
| 冻结测试（#267，4 文件） | `test/rest-{create-hub,role-gate-routing,contract-support,public-seam-wiring}*.test.ts` + `rest-contract-harness.ts` | 已读关键面（observer 兼容/构造门/接线） |
| Registry 公共面 | `packages/namespace-registry/src/{errors,types,registry}.ts`、`@nomicore/vfsl` `deriveSchemaIdentity` | 已读；committed 矩阵锚点逐行核对 |
| ADR | `docs/adr/0015`（L110–191）、ADR 0009/0010（经设计/SA6 引用） | 已读；blob/sha256 实测 |
| CI/runner 入口 | `.github/workflows/ci.yml`、`scripts/ci-test-shard.mjs`、根 `vitest.config.ts`、根 `package.json` scripts、`tsconfig.typecheck.json` | 已读 |

固定位置缺失项（与 SA2/SA3 记录一致，非本票缺口）：`wiki/raw/task_issue-269_conflict_report.md`、
`task_issue-269_relevant_decisions.md` 不存在（SA8 产物实际在 `artifacts/`，两份均在）；替代证据链完整。

## 2. Verdict

**`approve`** —— 0 BLOCKER、0 MAJOR；Required revisions 为空；2 条非阻断观察（见文末 §12-iter1）。

dispatch 点名四项专项独立复核结论：

1. **`committed:false` 映射（R1）**：`create-namespace.ts` L202–214 以 `instanceof
   NamespaceRegistryFatalError` + `error.committed` 为唯一二分判别子；`false` → 500
   `INTERNAL_ERROR`、`true` → 500 `NAMESPACE_CREATE_OUTCOME_UNKNOWN`；`phase` 只进 diagnostic
   不参与判别。`registry.ts` 四 phase 的 committed 事实矩阵（id-generation 恒 false L897；
   create-document-internal = `DocRuntimeFatalError.committed` 或 false；lifecycle-slot-internal
   原样传播 `DocCreateFatalError.committed`；runtime-construction 恒 true）逐行实测核对成立——
   「按 phase 推断提交事实」的歧路被正确避开。**通过**。
2. **abort-before-413（R3/C5）**：`readRequestBody`（L128–148）第一动作即入口同步
   `signal.aborted` 判定，其后 raced read + 胜出后同步再核对；`limits` 本票零消费（C5 以
   pre-abort + `maxBodyBytes:16` 锁定 aborted ≠ 413，本票实现下必然绿）；「abort 优先于任何
   读取期检查」的不变量已写入 AGENTS.md/README 供 #268 引用。入口判定 → addEventListener
   → race 之间零 await（监听器注册与入口判定同属一个同步段），不存在「abort 落在两次观察
   之间」的窗口；读返回 → `registry.create` 之间全同步（形状检查 + `deriveSchemaIdentity`
   实测为同步导出函数 + envelope 组装），接纳后源码零 `signal` 读取（grep 实测）。**通过**。
3. **observer 事件隔离（O-1）**：`emitMetrics`/`emitDiagnostic` 同步 try/catch helper
   （L77–97）；全部发射点（成功/abort/errorResponse 内部/release 失败/fatal/unknown/内部违例
   共 11 处）一律经 helper，无裸 observer 调用（grep 实测）；事件类型面 `RestMetricsEvent`
   （键集恰 `{operation,outcome,code?,status?}`）/`RestDiagnosticEvent`（三类 kind + exact
   cause 引用 + 诚实可选字段）与 H-M/H-D 及冻结断言逐键一致。**通过**。
4. **ADR/文档变更与证据完整性**：ADR-0015 未触碰（blob `64daa16a…` / sha256 `3a75f99b…148`
   实测与 SA6 §3.1 逐字一致）；AGENTS.md/README 已按 SA2 OBS-2 重写三处失效表述，并补记
   seam 不变量与 `rejected` 策略延后；5 个冻结测试 sha256 与 SA6 §13.4 逐字节一致；SA3 报告
   的 diff-stat（289+/49−）、B0 红灯基线数字、git 状态声明全部与工作树实测吻合。**通过**。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| Issue body 失败映射 F1：`REGISTRY_NOT_ACCEPTING` → 503（零提交、可重试） | `create-namespace.ts` L221–222：503 + 逐字 code + metrics `unavailable`；零 diagnostic | 落实（T1） |
| F2：typed operational → 500 `NAMESPACE_CREATE_FAILED` | L223–224：窄 issue 通道专属映射；零 diagnostic（非三类事件） | 落实（T2） |
| F3：fatal `committed:true` → 500 `NAMESPACE_CREATE_OUTCOME_UNKNOWN` | L212–213：`instanceof` + `.committed === true` 判别 | 落实（T6） |
| F4：fatal `committed:false` → 500 `INTERNAL_ERROR`（SA8 OBS-2 交设计、R1 裁决） | L214：`committed` 为唯一判别子（见 §2 专项一） | 落实（T7） |
| unknown exception / 内部契约违例 → 500 `INTERNAL_ERROR` + diagnostic | L216–217（throw catch-all）、L225–230（INVALID_INPUT/ALREADY_EXISTS → `unknown-exception` kind + cause=issue 引用，R4） | 落实（T3/T4/T8） |
| REST 不返回 `NAMESPACE_ALREADY_EXISTS` | L226–230：映射为 INTERNAL_ERROR，不透传 | 落实 |
| Issue body 取消边界：body 读取尊重 `Request.signal`、中断后 Registry 零触达 | `readRequestBody` 三道闸门；`abortSettle` 有界 rejection + metrics `aborted` + 零 diagnostic | 落实（T9） |
| 调用 Registry 后不传播取消、等待 settle 并 release | 接纳点后零 signal 读取；`await lease.release()` 恰一次；release 失败仍 201 + diagnostic（L243–253） | 落实（T10/T11） |
| Observability：显式注入、throw 隔离、metrics 低基数、diagnostic 三类 | `rest.ts` L188–195 构造门保持 `typeof === 'function'`；helper 化隔离；事件形状见 §2 专项三 | 落实 |
| Host 访问控制/采样/脱敏义务 | `RestDiagnosticEvent` doc + README 明示「Host 须视为敏感运维接口」；义务未挪进 router | 落实 |
| SA2 Required revisions | 为空（`approve`） | 无遗留 |
| SA2 OBS-1（设计概括句过宽） | 实现按 T 表精确口径：#269 拥有终局恰一事件；unmapped 族/403/405 零事件 | 落实（行为层）；文档层见 OBS-A |
| SA2 OBS-2（包文档三处失效表述须同步修订） | AGENTS.md「emits no events」删除、结局条目拆分；README Public API/Deferred scope 重写（diff 实测） | 落实 |
| SA2 OBS-3（ADR 折入义务补记） | SA3 在 Deferred verification 登记去向（治理义务，非实现动作）；`docs/adr/**` 属 DENY 未触碰 | 落实（登记层面） |
| SA2 OBS-4（malformed JSON × abort） | `request.json()` rejection 原样传播（读取 try 内同步调用，rejection 穿透 race）；零事件、零 Registry 零触达 | 落实（与 SM-9 一致） |
| AC1–AC6 | 冻结 29 用例（mapping 9 / abort 5 / observer 6 / support 9）+ SA3 V1 绿证据 | 覆盖 6/6（SA6 §12.3 映射 + §9 测试质量审查） |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| T1 503 `REGISTRY_NOT_ACCEPTING` + metrics `{outcome:'unavailable', code, status:503}` | `errorResponse(…, 'REGISTRY_NOT_ACCEPTING', 503, 'unavailable')` L221–222 | 一致 | — |
| T2 500 `NAMESPACE_CREATE_FAILED` + `failed`，零 diagnostic | L223–224 | 一致 | — |
| T3/T4 内部违例 → 500 `INTERNAL_ERROR` + diagnostic `unknown-exception`（cause=窄 issue 对象引用，R4） | L225–230；cause 为 `created`（issue 对象本身） | 一致（B5/B6/D5(d) cause 引用相等面） | — |
| T5 `NAMESPACE_INVALID_IDENTITY`/`SCHEMA_INVALID`/`ROOT_INVALID` 保持 unmapped rejection（#268 边界） | default 分支 L231–233，文案 `unmapped registry issue: <code>` 与 HEAD 逐字一致（`git show` 对照） | 一致（纯加法纪律） | — |
| T6 fatal `committed:true` → 500 `NAMESPACE_CREATE_OUTCOME_UNKNOWN` + diagnostic `registry-fatal`（cause=fatal 实例本身、operation/phase/committed 透传） | L202–213 | 一致（cause 非 `fatal.cause`，与 D5(a) 引用相等面吻合） | — |
| T7 fatal `committed:false` → 500 `INTERNAL_ERROR`（R1）+ diagnostic `registry-fatal`（committed:false） | L214 | 一致（B4 正向 + B2/B3 反向排除被满足） | — |
| T8 unknown throw → 500 `INTERNAL_ERROR` + diagnostic `unknown-exception`（cause=抛出对象）；同步 throw 同样入 catch | L201–217（try 包裹 `await registry.create(...)` 调用表达式） | 一致（SM-7） | — |
| T9 abort → 有界 `handle` rejection + metrics `{operation, outcome:'aborted'}`（无 code/status）+ 零 diagnostic；私有 `RestBodyReadAbortedError` 不导出 | `abortSettle` L150–154、类定义 L57–62（无 export） | 一致（H-A/R2） | — |
| T10 成功 → metrics `{operation,'succeeded',status:201}`（省略 code） | L254 | 一致 | — |
| T11 release 失败 → 仍 201、不重试、不二次调用、diagnostic `lease-release-failure`（namespaceId 取 release 前 DTO 副本、cause=release 异常引用）+ metrics `succeeded` | L236–254（DTO freeze 先于 release；`dto.namespaceId` 为已拷贝 string） | 一致（harness `mutateNamespaceIdOnRelease` 探针防御面保留） | — |
| §7.3 三道闸门（入口同步判定 → race → 胜出再核对）+ finally 无条件移除监听器 + 不 `body.cancel()` | `readRequestBody` L128–148 | 一致；race 对两个 promise 均挂接反应（`Promise.race` 语义），败方 rejection 不产生 unhandled rejection | — |
| §7.3 signal 缺失 → 自然 TypeError（fail loud，不静默当「永不中断」） | L132 裸读 `request.signal` | 一致（ER-4） | — |
| §7.4.1 类型面定义于 rest.ts、index.ts re-export、`import type` 反向引用（运行时单向） | `rest.ts` L53–85、`index.ts` L8–15、`create-namespace.ts` L38（`import type`） | 一致 | — |
| §7.4.1 兼容性：零参 observer 仍可赋值（#267 `NOOP_OBSERVER`） | #267 冻结测试构造点全部零参（grep 实测）；TS 少参可赋多参 | 一致（静态可证；运行动态项见 §11-iter1） | — |
| §7.4.2 发射矩阵：恰一事件/orchestration（#269 拥有终局）；403/405/未匹配/T5/body 族零事件 | gates（rest.ts L206–217）不经 orchestration，零发射；单出口单发射结构 | 一致 | — |
| §7.4.2 `operation` 常量 `'namespace-create'` | `METRICS_OPERATION` L50 | 一致（D6 `operations.size===1`） | — |
| §7.4.2 diagnostic owner 字段（「提交给 Registry.create 的 owner」）+ namespaceId 仅 lease-release-failure | L173（frozen owner）、L247–252 | 一致 | — |
| §7.4.3 隔离 helper 化（全调用点） | L77–97 + 全部发射点 grep 核对 | 一致（结构性保证） | — |
| §7.5 R4 归类 + §7.6 与 #268 共享 seam/排序不变量（#269 不消费 limits） | `RestRouterLimits` 保留未消费（rest.ts L35–43/L203）；不变量写入 AGENTS/README | 一致 | — |
| §7.7 接口变更汇总（rest.ts/create-namespace.ts/index.ts 三文件 + 私有错误类） | 与 diff 一致；额外导出 `CreateNamespaceOrchestrationDeps` 接口描述私有 deps 形状（SA3 已披露；模块仍包私有、不进 exports、不被 index re-export——package.json exports 实测仅 `.`/`./rest`） | 一致（披露过的私有面细节，非偏离） | — |
| §7.8 伪代码逐分支 | 上述各行同构；`errorResponse` 增加 metricsObserver 首参（私有函数签名细节） | 一致 | — |
| §1 目标 4 文档同步 | AGENTS.md/README diff（见 §3-iter1） | 落实（精度备注见 OBS-A） | — |
| #267 冻结顺序不 reorder（route → method → role → owner → body → … → 201） | rest.ts gates 顺序未动（diff 仅 orchestration 调用与头注）；成功链路 L174–259 顺序保持 | 一致 | — |

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| HTTP 失败投影（code/status/body/metrics） | REST Adapter | `create-namespace.ts`（包私有） | 正确——Registry 语义零改动；投影不复制底层状态机 |
| committed 事实判别 | Registry（唯一事实源） | REST 只读 `fatal.committed` | 正确——无第二份提交状态、无 phase 影子推断 |
| abort 观察/结算 | 读取段 seam（#269 拥有） | `readRequestBody` | 正确——不依赖平台、不吞 body/stream 清理（归 server 票） |
| role/owner/limits/4xx/422 | composition root / #268 | 未触碰；limits 参数位保留冻结 | 正确 |
| 访问控制/采样/脱敏 | Host | 文档明示义务；router 不承担 | 正确（ADR 0015 L190） |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| 最小 problem body `{code}` + JSON content-type | rest.ts 403/405 既有先例（L145–158） | `errorResponse` 同构 | 一致 | 完整 problem shape 归 #268（家族切片纪律） |
| 同步 void observer 隔离（emit never throws） | ADR 0011/0014 诊断日志纪律；registry.ts `dispatchObserver` try/catch 先例 | `emitMetrics`/`emitDiagnostic` | 一致 | 同向纪律；与 namespace 级诊断日志无交叉 |
| 读取段 seam | #267 骨架裸 `request.json()`（唯一读取点） | 收敛为单一私有 `readRequestBody`，#268 复用 | 一致 | 无平行读取路径 |
| abort 结算面 | 无先例（本票首创） | 有界 rejection + metrics `aborted` | 一致（诚实读法） | 不发明 499/408；词表既有 `aborted` |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| committed | `NamespaceRegistryFatalError.committed` | 无（REST 零复制） | 无 |
| namespaceId | Registry lease / DTO 副本 | diagnostic 仅取 release 前冻结副本 | 无（mutation 探针防御保留） |
| owner | route 捕获段 → frozen 对象 | metrics 不携带；diagnostic 引用同一 frozen 对象 | 无 |
| metrics code | 与 response body code 同源（同一 `errorResponse` 调用点构造） | 无第二来源 | 无（B1–B8 「code=body code」断言面） |

### 生命周期对称性

| Start or acquire | Stop or release | Failure recovery | Assessment |
|---|---|---|---|
| abort listener addEventListener（once） | finally 无条件 removeEventListener | abortSettle 有界 throw；败方 promise 经 race 已挂接 | 对称（每请求零残留） |
| lease acquire（create 成功） | 恰一次 awaited release | release 失败不重试不二次调用 + diagnostic | 对称（#267 冻结语义保持） |
| 构造期校验 | TypeError（fail loud） | — | 对称（D1 门不变） |
| 无定时器/队列/worker/缓存 | — | — | router 构造后零状态（除每请求局部变量） |

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
|---|---|---|---|
| 第二套 cleanup/retry/日志框架 | 无 | 无（helper 为包内私有函数） | 无重复 |
| 第二读取路径 | `request.json()` | 单一 `readRequestBody` | 无重复 |
| 新公共子路径/导出面扩张 | package.json exports `.`/`./rest` | 未动（实测）；事件类型经既有入口流出 | 无扩张 |

## 6. 文件范围审查（iteration 1 时点）

`git status --porcelain`（当时实测）：5 文件 modified + untracked = 上游 SA 产物。`git diff --stat`：
`5 files changed, 289 insertions(+), 49 deletions(-)`——与 SA3 E2 声明逐字一致。ALLOW/DENY 逐路径核对
（`create-namespace.ts`/`rest.ts`/`index.ts`/`AGENTS.md`/`README.md` + SA3 报告），DENY 面
（`packages/namespace-api/test/**`、`packages/namespace-registry/**`、`packages/vfsl/**`、
`packages/persistence/**`、`docs/adr/**` 等）零改动。**范围结论：无越界、无 ALLOW 扩张。**
（iteration 2 复核：该批改动已随 `209b046`/`25b41dc` 链落盘，本轮 CI 修复未触碰其中任何路径。）

## 7. 契约连锁审查（iteration 1）

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| `RestRouterOptions` observer 类型收窄 `() => void` → `(event) => void` | #267 冻结测试（`NOOP_OBSERVER = (): void => {}`，全部构造点 grep 实测）；仓内无其它 `@nomicore/namespace-api` importer | 零参函数按 TS 少参规则可赋值；`RouterOptionsShape` 本地形状仅经 `as unknown as` 用于 TypeError 用例 | 低（静态可证） | — |
| `handle` 新结局族（503/500 Response + abort rejection） | composition root / 未来 server（#270） | README/AGENTS 已写明 abort 为有界 rejection（不得记 500/重试）；判别子私有性已在两文档声明 | 低（#270 设计时消费） | — |
| `orchestrateCreateNamespace` 签名改对象 deps | 唯一调用方 `rest.ts`（grep 实测仅 1 处调用 + 1 处 import） | 同票更新 | 无 | — |
| `RestMetricsEvent`/`RestDiagnosticEvent` 新导出 | `index.ts` re-export；package.json exports 未动 | 类型经既有 `.`/`./rest` 入口流出 | 无 | — |
| Registry（被调方） | 窄 issue 联合 / branded fatal / catch-all | 调用方式与输入零变化（恰三键 `{owner,schema,root}`） | 无 | — |
| #268 共享读取段 seam | #268（在途） | 排序不变量已写入 AGENTS.md/README；C5 锁定 | 低 | — |
| `@nomicore/vfsl` `deriveSchemaIdentity` / Persistence | 被调方 | 零变化（同步纯函数实测） | 无 | — |

## 8. 错误、恢复与并发（iteration 1）

- **判别面稳定性**：窄 code（switch）/ `instanceof` + `.committed` / catch-all / 私有 abort 类 /
  body 族原样传播——五类分类互斥完备；instanceof 失配的 wrapped fatal 落 T8（500 + diagnostic，诚实非静默）。
- **无静默失败**：release 失败是唯一被吞的创建后错误，且以 diagnostic 上报 + 仍 201；helper catch 仅包
  observer 调用，不吞业务错误。
- **恰一次/恰一个**：metrics 单出口单发射；release 恰一次 awaited；无重试。
- **abort race 卫生**：入口判定 → 监听器注册 → race 全同步段；`Promise.race` 挂接两 promise 反应，
  无 unhandled rejection；finally 无条件摘除监听器。
- **接纳后取消隔离**：`registry.create` 调用后源码零 `signal` 读取（grep 实测）。
- **TOCTOU/并发**：router 构造后零状态；每请求独立闭包；owner 对象 frozen。
- **进程边界**：无新持久化/wire 面；事件仅进程内同步回调。

## 9. 测试质量审查（iteration 1）

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| mapping 9 用例（B1–B7 + 负控 2） | 503/500×3 逐字 code + content-type + 敏感值零泄漏；恰一 metrics 事件且 code=body code；diagnostic 恰一 + cause 引用相等；负控零触达零事件 | 根 `pnpm test` + 包 AGENTS.md 验证命令 + CI 分片 | 无 skip/only/todo；断言全为行为级 | — |
| abort 5 用例（C1/C2/C5/C3/C4） | pre-abort/mid-read 有界 rejection + 零触达 + `['aborted']`；C5 反断言非 413；release 恰一次 | 同上 | 时序锚为计数而非 sleep | — |
| observer 6 用例（D1–D6） | 构造门；恰一事件 + 键白名单；throw 隔离；cause 引用；全分支矩阵计数 | 同上 | D6 与设计裁决一致，非弱化 | — |
| support 9 用例（恒绿锚） | 真实 Registry 四类故障产物；committed:true 可读回；平台事实 | 同上 | 不 import router，恒绿 | — |
| 冻结完整性 | 5 文件 sha256 = SA6 §13.4 逐字节 | — | 无改写、无弱化 | — |
| 类型门 | `tsconfig.typecheck.json` include `packages/*/test/**`；root `pnpm typecheck` | CI typecheck（Node 20） | 静态可证兼容 | — |

## 10. Required revisions（iteration 1）

无 BLOCKER / MAJOR finding。阻断修订清单为空。

## 11. 后续动态验证项（iteration 1 时点；R1' 已由后续全量跑覆盖，保留存档）

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| SA3 V1（64/64 绿 ×3）、V2–V4（tsc 0 error）为 SA3 实跑声明 | 评审/合并前复跑 | `Tests 64 passed (64)`、tsc exit 0 | 任一失败或红灯基线回归 |
| 冻结 support 文件钉死 Node 24 平台事实，CI 含 Node 20 腿 | CI 首跑 Node 20 分片 | support §5 两用例绿 | Node 20 平台事实不同（SA6 修订轮重估） |
| 真实 server 下 mid-read abort 的败方 promise 与 body 清理 | #270 server 票 | 无 unhandled rejection、无流泄漏 | 连接半开或 rejection 噪声 |
| `#268` 合入后 C5 与排序不变量 | #268 实现 + 冻结测试复跑 | C5 保持绿 | abort 与超限同现时得到 413/400 |

## 12. Non-blocking observations（iteration 1）

| ID | 观察 | 建议 |
|---|---|---|
| OBS-A | 重写后的包契约文档引入与 SA2 OBS-1 同源的过宽概括句（AGENTS.md「exactly one … per orchestration」、README L9；`code` 键恒在表述对成功/abort 不成立） | 后续文档修订轮按精确口径改写；SA7 可作检查点复核（**iteration 2 复核：该面本轮未触碰，观察仍开放**） |
| OBS-B | 两处实现细节（`errorResponse` 首参、`CreateNamespaceOrchestrationDeps` export）未入 Deviations 节（已披露、非偏离） | 无需动作；SA3 报告修订轮可集中列出 |

---

## 附：证据与边界（iteration 2）

- 本审查为纯静态：读取源码/测试/协议/diff/git 状态/`gh api`（只读取 owner 评论原文）；未修改任何实现、
  设计或测试；未运行测试/服务/临时进程；未执行 git 写操作。
- 实测锚点：HEAD `e84c160`；被修测试 pre-image blob `2ec6e69`（= owner 评论引用的 main sha）、
  post-image 工作树版；`peer-connection.ts` `onTemporaryFailure`/`setState`/`emitBackoffScheduled`/
  `dialNow` 行为逐点核对；协议 §15 L426–431 原文；owner 评论 `5629026278`（updated
  `2026-09-11T03:31:05Z`）`gh api` 原文复核与 dispatch 转述一致。
- 本文件为 SA4 本轮唯一可写产物（原位更新：iteration 2 置顶，iteration 1 原文归档；iteration 1 无
  阻断 finding，无需要删除的过时阻断项；OBS-A/OBS-B 保留并标注仍开放）。

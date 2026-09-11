# SA9 标准审查报告 — Issue #269 任务树（iteration 2：CI-stability 修复 + #269 既有交付的最终复审）

> 阶段：standards-review（SA9，**iteration 2 — 对新 head 的 fresh final review**）。派发：`sa-1a4b1c20-e54b-4d00-b79f-724d2b2a0dba`（mabf-sa9）。
> **Verdict：approve**（0 BLOCKER / 0 MAJOR；3 条 MINOR 非阻断观察，§10）。
> 审查对象：worktree `/home/wangjian/nomicore-fix-issue-269`，branch `mabf/issue-269`，HEAD
> `296e6462e2b843149667ad22e481d427a6b99a26`（`test(ci): stabilize issue 229 hub restart backoff`）。
> 审查范围 = (a) 最终 CI-stability 修复（`296e646`，1 个测试文件 + 2 份 SA 报告）+ (b) 既有 #269 交付
> （实现 `1e4ae72` rebase 于 #270 落地后的 base `f2de805` 之上）。
> Owner 要求来源：issue #269 comment `5629026278`（welltop-jim-wang，updated `2026-09-11T03:31:05Z`）——
> 本评审经 `gh api` 只读复核原文，与 dispatch 转述一致（§2 逐字口径）。
> 本报告**原位重写** iteration 1 的 SA9 报告（其对象为 HEAD `c739770`/实现 `25b41dc` on `209b046`，
> verdict approve；原文存于 git 历史 commit `abcabfe`）。全部行号/哈希锚点按当前 HEAD 重测。
> 方法：纯静态独立复核（read/grep/git diff/git show/sha256sum/`git diff --check`/`gh api` 只读）；
> 未修改任何代码/设计/测试，未运行测试，未启动服务，未调度其他 SA。
> 审查口径：只判断**标准与仓库质量**（AGENTS/ADR/模块责任/惯例/单一事实源/生命周期对称性/文件范围/
> 测试质量/owner 要求的落实）；Issue 需求完整实现属 SA10，不构成本评审内容。

---

## 1. 审查输入与证据链

| 输入 | 位置 | 状态 |
|---|---|---|
| Owner 评论（裁决原文） | GitHub issue #269 comment `5629026278` | `gh api` 只读实测，updated_at `2026-09-11T03:31:05Z`，与 dispatch 转述逐字一致 |
| 任务简报/派发日志 | `wiki/raw/task_issue-269.md`、`task_issue-269_dispatch.md` | 已读 |
| SA3 实现报告（iteration 2 + iteration 1 归档） | `wiki/raw/task_issue-269_sa3_impl.md` | 已全文读；V1–V7、D7–D9、Changed paths 逐项核对 |
| SA4 实现审查（iteration 2 + iteration 1 归档） | `wiki/raw/task_issue-269_sa4_review.md` | `approve`（0 BLOCKER/MAJOR；3 观察 + 2 项 Controller 收尾义务） |
| SA6 冻结契约 / SA1 设计 / SA2 评审 / SA8 两轮门禁 | `wiki/raw/task_issue-269_sa6_contract.md` 等；`artifacts/sa8-conflict-report-issue-269{,-design-recheck}.md` | 已读；冻结哈希实测（§7） |
| 被修测试 | `apps/yjs-server/test/hub-restart-static-target-red.test.ts`（362 行） | 全文读 + vs `f2de805` 版逐行 diff + 断言清单对位 |
| 协议与实现锚点（只读） | `docs/protocols/instance-replication-v1.md` §15；`packages/ws-replication/src/peer-connection.ts`；`apps/yjs-server/src/app.ts` | 行号/语义实测吻合（§6） |
| #269 合入实现 | `packages/namespace-api/src/{create-namespace,rest,index,request-body,rest-problem}.ts` | diff 哈希比对 + 冻结测试 sha256 重测（§7） |
| 规范基准 | 根 `AGENTS.md`、`apps/AGENTS.md`、`apps/yjs-server/AGENTS.md`、`packages/namespace-api/AGENTS.md`、ADR 0015/0010、`CONTEXT.md` | 已读并核对 |

---

## 2. Owner 评论 5629026278 逐字口径与落实总表

Owner 原文（`gh api` 实测）四句裁决 + 一句范围限定，落实矩阵：

| # | Owner 要求（逐字要点） | 实测证据 | 结论 |
|---|---|---|---|
| ① | **允许**修正该用例对 backoff 时序的假设；根因 = full jitter `delay = random() × cap`、`cap = min(maxMs, baseMs·2^(attempt−1))`，帽值**不提供延迟下界**；「长 backoff 配置保证写入先于重拨」前提在 CI 负载下不成立 | 根因与规范/实现三方一致：协议 §15（`docs/protocols/instance-replication-v1.md` L426–431 实测：`cap = min(maxBackoffMs, baseBackoffMs * 2^attempt)`、`delay = random(0, cap)`）；实现 `peer-connection.ts` L937–941 实测（`cap = Math.min(maxMs, baseMs * 2^(attempts-1))`、`delay = Math.max(0, random() * cap)`）。修复正是「修正时序假设」：等已武装窗口（L314–320）+ 实测派生帽值（L257–265），**未触碰任何生产代码** | ✅ 落实 |
| ②a | **必须保留全部既有断言**（不得删除、放宽或 skip 任何 `expect`），只让时序可判定 | 断言清单 13 ↔ 13 逐条对位（§3）；零 `.skip`/`.only`/`.todo`；`it` 超时 `240_000` 未动；受保护断言逐字保留 | ✅ 落实 |
| ②b | 提交信息与 PR 说明明确披露：#229 用例 flake 收敛、CI 稳定性修复、**非本票功能改动** | commit `296e646` message `test(ci): stabilize issue 229 hub restart backoff`——`test(ci)` 类型 + 指向 229，无 #269 功能声称；diff 内 SA3 iteration-2 章节（「CI 失败修复」「为什么是测试面修复而非生产代码修复」）与 SA4 iteration-2（§1/§3 Owner ②b 行）均逐字作此定性。**PR 说明披露尚无载体**——Controller 收尾义务（SA4 §11-R2 同判），不属代码面 | ✅（diff 面落实；PR 面为交付收尾义务，§10-MINOR-3） |
| ③ | 提交前清除临时诊断输出：工作树不得残留 `[tmp-diag]`/`[tmp-gate]` 调试 console.log 与临时探针脚本 | 全仓 grep `tmp-diag\|tmp-gate\|tmp_diag\|tmp_gate` 仅 4 命中且全部位于 wiki 报告对该要求自身的文字引用；被修测试与相关 src 零 `console.`/`debugger`；`git status --porcelain` 空、0 untracked；HEAD commit 恰 3 路径（§4） | ✅ 落实 |
| ④ | 该文件改动使此前 SA9/SA10 评审头失效，**须对新 head 重跑最终评审组（SA9 + SA10）**后再交付 | 本报告即 SA9 重跑（iteration 2，对象 HEAD `296e646`）；SA10 iteration-2 尚未派发（`task_issue-269_sa10_spec.md` 最后更新于 `abcabfe`，早于 `296e646`）——Controller 派发声索，非本评审缺陷（§10-MINOR-3） | ✅（SA9 半侧落实） |
| 范围 | 「除此之外本轮修复不做任何额外改动」 | `git show 296e646 --name-only` 恰 3 路径：owner 逐字点名的测试文件 + SA3/SA4 角色固定报告产物；零生产代码、零 `.github/**`、零其它测试、零 `test-durations.json` | ✅ 落实 |

---

## 3. 断言保留专项（Owner ②a）

修复前（`git show f2de805:…` 版）与修复后（HEAD 版）`expect(` 清单逐条对位：

| 断言（语义） | 前行号 | 后行号 | 对位 |
|---|---|---|---|
| `signalAndExpectExit` helper 内 `expect(code, msg).toBe(expectedCode)` | L122 | L168 | ✅ 逐字 |
| `expect(namespaceId).toMatch(/^ns-[0-9a-f]{32}$/)` | L193 | L239 | ✅ 逐字 |
| `expect(baselineWrite.ok).toBe(true)` | L232 | L285 | ✅ 逐字 |
| `expect(baselineRead.ok).toBe(true)` / `.value).toBe(7)` | L234/235 | L287/288 | ✅ 逐字 |
| `expect(shutdownEvents.some(backoff-scheduled), JSON.stringify(…)).toBe(true)` | L248–251 | L301–304 | ✅ 逐字 |
| `expect(…goaway-received…).toBe(false)` | L252 | L305 | ✅ 逐字 |
| `expect(…state-changed && to==='blocked'…).toBe(false)` | L253 | L306 | ✅ 逐字 |
| `expect(peerProc.exitCode).toBeNull()` | L254 | L307 | ✅ 逐字 |
| **`expect(statusBeforeWrite.connectionState).toBe('backoff')`**（CI 失败点） | L262 | L327–330 | ✅ 保留——实际值/匹配器/期望值逐字不变；仅新增第二参失败消息（vitest `expect(actual, message)` 签名，判定语义零变化，§10-MINOR-2 透明记录） |
| `expect(disconnectedWrite.ok).toBe(true)` | L268 | L336 | ✅ 逐字 |
| `expect(recoveredRead?.ok).toBe(true)` / `.value).toBe(11)` | L285/286 | L354/355 | ✅ 逐字 |
| 四次 `signalAndExpectExit(..., 0, ...)`（hub v1 / hub v2 / peer / hub v2b，exit 0） | L195/239/288/289 | L241/292/357/358 | ✅ 逐字 |

- **零删除、零放宽、零 skip**：13 ↔ 13；`grep` 全文件零 `.skip`/`.only`/`.todo`；matcher 与期望值零变化；`it(` 第三参超时 `240_000` 前后一致（前版 L291 实测）。
- **非断言编排参数变化**（不属于「断言」范畴，逐一登记并判定）：
  1. peer 配置 `backoff.baseMs/maxMs`：`5_000/5_000` → `backoffCapMs`（= 2× 实测重启预算，L262–265/L278）。这是进程配置/时序前提，不是 expect；改动方向是让「写入先于重拨」的前提**由概率事件变为可判定事实**，与被保留的 `toBe('backoff')` 断言同向加强，非弱化。
  2. live 恢复等待上界 `60_000` → `backoffCapMs + 30_000`（L343）。等待上界是失败期限而非行为断言（断言仍是「live 事件必然发生」）；派生界在快环境下**更紧**（如 cap 6s ⇒ 36s < 60s），慢环境下放大但有 240s 用例超时兜底——上界修正，非断言弱化。
  3. 重启前新增 `waitForArmedBackoffWindow` 等待（L314–320）与失败消息增强——纯加固：超时/进程退出均带诊断**响亮失败**（L148–160），无静默放行路径。
  4. 注释更新（删除「长 backoff 配置保证写入先于重拨」的错误前提表述，替换为 full-jitter 事实描述）——注释非断言，且新表述与协议 §15 一致。

## 4. 临时产物清除专项（Owner ③）

| 检查 | 实测 | 结论 |
|---|---|---|
| `[tmp-diag]`/`[tmp-gate]`（含 `tmp_diag`/`tmp_gate` 变体） | 全仓 grep 4 命中，全部位于 `wiki/raw/task_issue-269_sa{3,4}_*.md` 对要求自身的文字描述；代码面 0 命中 | ✅ |
| `tmp-phase`/`console.`/`debugger` | 被修测试、`apps/yjs-server/src/`、`packages/namespace-api/src/` 0 命中 | ✅ |
| 临时探针脚本 | `git status --porcelain` 空、`git ls-files --others --exclude-standard` 空；`scripts/` 仅既有发布/CI 脚本（branch diff 零触碰）；SA3 V1/V4 声明的探针与临时诊断均为仓库外/已移除，diff 中不可见 | ✅ |
| 工作树卫生 | `git diff --check f2de805 HEAD` 零输出；冲突标记扫描 0 命中 | ✅ |

## 5. 披露定性专项（Owner ②b）

- **commit 面**：`296e646` 全 message 仅一行 `test(ci): stabilize issue 229 hub restart backoff`（`git log -1 --format=%B` 实测）。conventional 类型 `test(ci)` 表明测试/CI 面、subject 指向 issue 229 与 stabilize——定性为 #229 flake/CI-stability 修复，**不含任何 #269 功能声称**。与 SA3 suggested message（`fix(#229): …`）措辞不同但定性等价且同属合规表述。
- **diff 内文档面**：SA3 报告 iteration-2 章节标题「CI 失败修复」、根因节、「为什么是测试面修复而非生产代码修复」节、suggested commit message 节；SA4 报告 §1 标题「iteration 2：CI flake 修复」、§3 Owner ②b 行——两报告均把本改动定性为 #229 用例 flake 收敛/CI 稳定性修复，并明示与 #269 功能面无文件面重叠（SA3 Inputs 表「与本修复无文件面重叠」实测成立：`296e646` 不触碰 `packages/namespace-api/**`）。
- **PR 说明面**：仓库/diff 外载体，Controller 交付收尾义务（SA4 §11-R2 同判）——§10-MINOR-3 登记，不阻断本评审。

## 6. 修复正确性与标准符合性（纯静态复核）

**根因—方案—规范三方一致性**：

| 锚点 | 实测 | 结论 |
|---|---|---|
| 协议 §15（`docs/protocols/instance-replication-v1.md` L426–431） | `cap = min(maxBackoffMs, baseBackoffMs * 2^attempt)`、`delay = random(0, cap)`；「Scheduler和random必须注入测试 seam」（包内 seam） | 与 owner 根因裁决逐字同构 |
| `peer-connection.ts` L937–941 | `cap`/`delay` 公式实测一致；`attempts` 已递增后发射 | 帽值无下界成立 |
| `setState`（L1066–1077） | 连接 FSM 唯一迁移点，同态早退、边沿 exactly-once 发射 `connection-state-changed` | helper「superseded」判据的事件源可靠 |
| `onTemporaryFailure`（L913–953） | backoff/blocked 态早退 ⇒ 任一时刻至多一个已武装 timer；`setState('backoff')` **先于** `emitBackoffScheduled`（L937 vs L942）⇒ 同次武装的入态事件不会误判 supersede | 「最新一条已武装」判据成立 |
| `dialNow`（L286–296） | 同步 `setState('connecting')`（L295）先于 dial ⇒ timer fire 必然产生后续 state-changed | 「窗口过期必可观测」成立 |
| `emitBackoffScheduled`（L138–151） | `delayMs` 在事件载荷内 | helper 可读取 |
| `app.ts` L210 / L707 | observer `type`→`event` 改名直通其余字段；`status` op 返回 `connectionState: peerService.status.connection` | 测试观测面与状态回执语义吻合 |

**helper 语义**（L130–163）：倒序取最新 `connection-backoff-scheduled`，要求未被后续 `connection-state-changed` 取代且 `delayMs ≥ minDelayMs`；不满足则等下一次武装；进程退出/超时均抛带 stderr 与已观测 delayMs 列表的诊断错误。20ms 轮询、无 timer/监听器/资源——纯轮询，与同文件 `waitForEvent`/`waitForExit`/`sendOp` 风格同构（惯例一致）。观测滞后（管道 + 轮询 ≤ 数十 ms）相对 `delayMs ≥ 预算 ≥ 4s` 的窗口可忽略；「timer 已 fire 而事件未观测到」的竞争窗口不构成实际风险（helper 返回时距武装仅 ms 级，远小于 delayMs 下界）。

**标准维度**：

| 维度 | 实测 | 结论 |
|---|---|---|
| 模块责任 | full-jitter 重拨语义归 `packages/ws-replication`（协议 §15 规范行为）——**零改动**；失效的是测试对「帽值 ⇒ 下界」的错误推断，修在测试自身。未为变绿给生产加确定性 jitter/env override/延迟下界旁路 | ✅ |
| `apps/yjs-server/AGENTS.md` 边界 | 测试仅消费 stdout 严格 NDJSON 生命周期事件通道与 stdin 控制面（文档化观测面）；经 `spawnApp` 起真实进程，无 package-internal subpath、无 testing seam、无 DSH profile；单进程单 role 保持；未动 teardown/授权/锁面 | ✅ |
| 单一事实源 | 武装窗口事实 = 进程事件流（与进程内 timer 同源发射，无第二份状态推导）；boot 预算 = 同 config 同 rootDir 实测；无 marker 文件/旁路 RPC | ✅ |
| 生命周期对称性 | helper 零资源获取（纯轮询）；`afterEach` 既有 SIGKILL + tmpdir 清理未动；无新增定时器/监听器/队列 | ✅ |
| 验证门（app AGENTS「Verification」） | SA3 V5 根 `pnpm typecheck` exit 0、V6 `vitest run apps/yjs-server/test` 30 文件/162 用例全绿、V3 修复后 10/10——SA9 纪律不复跑，动态证据以 SA3 声明 + 本评审静态语义核验为准；静态可证面全部成立 | ✅（静态面） |
| ADR/协议面 | ADR 0010/协议 v1 零触碰；修复使测试**对齐**规范而非偏离 | ✅ |

## 7. 既有 #269 交付在新 head 下的再确认

base 移动：`209b046`（#268）→ `f2de805`（#270 Server 集成，#303）。逐项重测：

| 检查 | 实测 | 结论 |
|---|---|---|
| #269 实现 diff 不变性 | `git diff f2de805..1e4ae72 -- packages/namespace-api/{src,AGENTS.md,README.md,package.json}` 的 sha256 = `57474750…`，与 iteration-1 批准的 `git diff 209b046..25b41dc` 同值——**实现逐字节同 diff** | ✅ |
| base 移动对 namespace-api 的影响 | `git diff 209b046..f2de805 -- packages/namespace-api` 为空——#270 未触碰该包，零语义冲突面 | ✅ |
| #269 五件 SA6 冻结测试 | sha256 重测 = SA6 §13.4 逐字节（harness `14062b3d…`/support `9f9688ab…`/mapping `14465a40…`/abort `2f298a8e…`/observer `dbf8778a…`） | ✅ |
| base(#268)/legacy(#267) 11 件测试 | 逐一 vs `f2de805` blob sha256：11/11 SAME | ✅ |
| iteration-1 标准结论的承继 | AGENTS（根/包两级）、ADR 0015（L103–113/L150–161/L175–182/L186–190）、模块责任、D1–D4 冲突解决忠实性、单一事实源、生命周期对称性、文件范围、测试质量——实现与冻结测试字节均未变，iteration-1 approve 的代码面结论在新 base 上继续成立；本评审不重述其逐条证据（见 git 历史 `abcabfe` 中 iteration-1 报告） | ✅ |
| `git diff --check f2de805 HEAD` / 冲突标记 / 工作树 | 零输出 / 0 命中 / clean | ✅ |
| 全 branch 文件范围（22 文件） | 1 个 app 测试（本轮修复）+ 5 个 namespace-api 源/文档 + 5 个 #269 冻结测试 + 11 个 wiki/artifacts 文档件；`scripts/`/`.scratch/`/`.github/`/`docs/`/其它包零改动 | ✅ |

## 8. 文件范围（本轮修复）

| 检查 | 实测 | 结论 |
|---|---|---|
| Owner 范围限定（「除此之外不做任何额外改动」） | `296e646` 恰 3 路径：owner 逐字点名的 `apps/yjs-server/test/hub-restart-static-target-red.test.ts`（+73/−4）+ SA3/SA4 角色固定报告产物 | ✅ |
| DENY 面 | `packages/**`（含 ws-replication/namespace-api）、`apps/yjs-server/src/**`、其它 `apps/yjs-server/test/**`、`.github/**`（`test-durations.json` 条目 `19965` 原值）、`docs/**`、tsconfig/package.json——零 diff | ✅ |
| 无 scope creep | 未发明生产时序旁路、env 开关、新配置键、新事件、新断言族；未顺手改任何不相关文件 | ✅ |

## 9. 测试质量标准

| 检查 | 实测 | 结论 |
|---|---|---|
| 行为级断言 | 断言进程事件流（backoff-scheduled/state-changed/channel live）、status 回执、读值收敛、exit code；无源码文本断言 | ✅ |
| 响亮失败 | 所有等待（含新 helper）超时/进程退出均抛含 `what`+stderr（+ 观测 delayMs 列表）的错误；无静默放行/无 catch 吞没 | ✅ |
| 确定性改善方向 | 把概率性前提（随机延迟恰好够长）替换为可判定前提（等到已武装且 ≥ 实测预算的窗口）；预算公式（boot×2 + 2s，500ms 上取整）与帽 = 2×预算（单次武装命中 ≈ 50%，期望等待最短）数学成立 | ✅ |
| flake 残余披露 | SA3 Deferred verification 诚实登记：CI 复跑待 Controller；慢环境 boot 超预算时以带时间信息的断言消息响亮失败而非静默通过 | ✅ |
| 冻结契约纪律 | #269 五件 sha256 未变；base/legacy 11 件逐字节未变；被修文件非任何 SA6 冻结对象（SA4 §1 历史契约核查：本 worktree 无该文件当前版本的 sha 冻结契约；其语义基线为 `main` 的 `b551791`，pre-image blob `2ec6e69` 与 owner 评论引用吻合） | ✅ |

## 10. Findings

无 BLOCKER、无 MAJOR。MINOR 三条（均不阻断 approve）：

| ID | 级别 | 观察 | 建议 |
|---|---|---|---|
| MINOR-1 | MINOR | 动态帽值的病态尾部：`it` 超时 `240_000` 未动，而 `backoffCapMs = 2×(boot实测×2 + 2s)`；若 hub v2 boot 逼近其自身 60s 等待上界，cap ≈ 244s，派生的 live 等待界（cap+30s）单独即可超过用例超时。性质为响亮超时失败（非静默通过），且需要 boot 慢到近 60s 的病态环境（CI 实测该用例 13.4s、本机 18–24s）；SA3 已在 Deferred verification 披露慢环境残余风险 | 后续可调：给 cap 设上限或对 `it` 超时做同公式派生；不属本轮阻塞 |
| MINOR-2 | MINOR | 受保护断言 `expect(statusBeforeWrite.connectionState).toBe('backoff')` 的调用文本新增了第二参（失败消息）。vitest `expect(actual, message)` 语义下判定零变化（同 actual/同 matcher/同期望值），不满足「删除/放宽/skip」任一项；但与 owner「保留全部既有断言」的最严格文本读法存在一处调用点字面差异，透明登记 | 无需行动；若 Controller 要求逐字还原，删除第二参亦为等价语义 |
| MINOR-3 | MINOR（流程面） | Owner ②b 的 **PR 说明**披露与 ④ 的 **SA10 重跑**尚无载体：`task_issue-269_sa10_spec.md` 最后更新于 `abcabfe`（早于 `296e646`），SA10 iteration-2 未派发；PR 说明在仓库/diff 之外。两者均为 Controller 交付收尾义务（SA4 §11-R2/R3 同判），非本 diff 的代码/文档缺陷 | Controller 在交付前派发 SA10 iteration-2 并在 PR 说明写入「#229 flake 收敛 / CI 稳定性修复，非 #269 功能改动」 |

## 11. 结论

最终 CI-stability 修复（`296e646`）符合 owner 评论 5629026278 的全部仓库面要求：①根因与协议 §15/实现三方一致、
修复方向为测试面时序前提确定化且生产代码零触碰；②既有断言 13 ↔ 13 逐条保留、零删除/放宽/skip（受保护断言
仅新增诊断消息第二参，判定语义不变），commit 与 diff 内 SA 报告均定性为 #229 flake/CI-stability 修复而非 #269
功能；③`[tmp-diag]`/`[tmp-gate]`/探针脚本零残留、工作树 clean；④SA9 半侧由本报告落实（SA10 重跑为 Controller
收尾义务）。修复本身符合 `apps/yjs-server` AGENTS 边界（仅消费文档化 NDJSON 观测面、无私有 seam）、模块责任
（jitter 语义归 ws-replication，未为测试改规范行为）、单一事实源与生命周期对称性、文件范围零越界、测试质量
达仓内标准（行为断言、响亮失败、诚实披露残余风险）。既有 #269 交付在新 base `f2de805` 上逐字节保持（实现 diff
sha256 同值、16 件冻结/基线测试全部 SAME），iteration-1 的 approve 结论继续成立。三条 MINOR 均为非阻断观察。
**Verdict：approve。**

---

*证据边界：本评审为纯静态（read/grep/git diff/git show/sha256sum/git diff --check/`gh api` 只读）；未修改任何实现、设计或测试；未运行测试/服务/临时进程；未调度其他 SA。本报告为 SA9 唯一产物（`wiki/raw/task_issue-269_sa9_standards.md`，iteration 2 原位重写；iteration 1 原文见 git 历史 commit `abcabfe`）。*

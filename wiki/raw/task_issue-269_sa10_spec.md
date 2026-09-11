# SA10 Spec 审查报告 — Issue #269：REST create 的 Registry 失败语义、取消边界与双 observer 契约

> 阶段：spec-review（**iteration 2 — CI 稳定性修复落盘后、新 head 上的 fresh final review**）。
> 派发：`sa-38d200b0-f131-4f9c-ae2c-ad5017c83a69`（mabf-sa10，iteration 2）。
> 审查对象：worktree `/home/wangjian/nomicore-fix-issue-269`，branch `mabf/issue-269`，HEAD
> `296e6462e2b843149667ad22e481d427a6b99a26`（`test(ci): stabilize issue 229 hub restart backoff`）。
> 链：`209b046`（#268）→ `f2de805`（#270 Server 集成 (#303)）→ `1e4ae72`（#269 实现，
> `feat(namespace-api): map REST create failures`）→ `a45ffae`（SA8 文档）→ `abcabfe`（iteration-1
> SA9/SA10 记录）→ `296e646`（本轮 CI 修复）。工作树 clean（`git status --porcelain
> --untracked-files=all` 空，0 untracked）。
> Owner 要求口径：issue #269 comment `5629026278`（welltop-jim-wang，updated
> `2026-09-11T03:31:05Z`）——**本轮 SA10 经 `gh api
> repos/welltop-jim-wang/nomicore/issues/comments/5629026278` 只读取得原文逐字核验**，4 条口径 +
> 收尾句「除此之外本轮修复不做任何额外改动」（§3 逐条判定）。
> 方法：纯静态独立复核（读 owner 评论原文/issue 正文/SA3 iter-2/SA4 iter-2/SA6/SA9 产物 + `git
> show`/`git diff`/sha256/grep 实测）；未修改任何代码/设计/测试，未运行测试，未启动服务，未执行
> git 写操作，未调度其他 SA。
> **iteration 1（归档：rebase 后复审，`approve`）原文保留在文末。**

## 1. 裁决

**verdict: `approve`** —— Owner 评论 4 条口径逐条核验：①（许可面）修复严格落在点名的测试文件内、
生产代码零改动；②a（断言保留）**met**：13↔13 条 `expect` 逐条对位、matcher 与期望值逐字不变、
无删除/放宽/skip/only/todo；③（临时诊断清除）**met**：代码面 0 残留、工作树 0 探针脚本；
②b（披露）commit 半项**实质满足**（`test(ci): stabilize issue 229 hub restart backoff` 将改动定性为
#229 用例的 CI 稳定性收敛而非 #269 功能），PR 说明半项尚无载体、列入 §7-P6 交付义务；④（新 head
重跑 SA9/SA10）本报告即 SA10 半项的 fresh review，SA9 半项列入 §7-P7 派发义务。既有 #269 交付在
新 head 上**逐字节维持** iteration-1 approve 的实现内容（`git diff 25b41dc 1e4ae72 -- packages/`
为空），冻结测试 sha256 5/5 与 SA6 §13.4 一致，AC1–AC6 判定原样成立（§5）。无遗漏、无部分实现、
无错误实现、无 scope creep。3 条 MINOR（§6，含前轮承继 1 条）不阻断 approve。

## 2. 审查输入与证据链

| 输入 | 位置 | 核验 |
|---|---|---|
| Owner 评论（裁决来源） | GitHub issue #269 comment `5629026278`（updated `2026-09-11T03:31:05Z`） | `gh api` 只读取得原文；与 dispatch 转述及 SA4 iter-2 引用逐字一致 |
| Issue 正文 + AC1–AC6 | `wiki/raw/task_issue-269.md` | 已读；Comments 节空（评论快照外的 owner 口径以 5629026278 为准） |
| 本轮修复 commit | `296e646`（`git show` 逐行） | 恰 3 路径：被点名测试 +73/−4、`sa3_impl.md` +146、`sa4_review.md` +334/−96；pre-image blob `2ec6e694…` 与 owner 引用的 main sha 吻合 |
| SA3 实现报告 iteration 2 | `wiki/raw/task_issue-269_sa3_impl.md` | 根因/修复面/V1–V7/D7–D9 已读；静态可复核面（范围、清理、pre-image）实测吻合 |
| SA4 实现审查 iteration 2 | `wiki/raw/task_issue-269_sa4_review.md` | `approve`（0 BLOCKER/MAJOR）；其 §9 断言对位表经本轮独立重测确认 |
| SA6 验收契约 | `wiki/raw/task_issue-269_sa6_contract.md` §13.4 | 5 个 #269 冻结测试 sha256 本轮重测逐字节一致（§5） |
| SA9 标准审查 | `wiki/raw/task_issue-269_sa9_standards.md` | 记录版为 iteration 1（head `c739770`）；对 `296e646` 的 SA9 复审尚无记录产物 → §7-P7 |
| 协议/实现锚点（只读） | `docs/protocols/instance-replication-v1.md` §15；`packages/ws-replication/src/peer-connection.ts` | full jitter `delay = random(0, cap)` 无下界——与 owner 根因裁决、SA3/SA4 判定一致 |
| 被修测试 | `apps/yjs-server/test/hub-restart-static-target-red.test.ts`（pre `2ec6e69` vs post `84a100d` 全文 + 逐行 diff） | 断言对位、结构面、清理面全部实测（§3/§4） |
| 既有 #269 交付 | `packages/namespace-api/**`（HEAD 版） | 与前轮 approve 的 `25b41dc` 内容逐字节一致（`git diff 25b41dc 1e4ae72 -- packages/` 空）；关键行号锚点重测（§5） |

**diff 范围实测**（`f2de805..HEAD`，当前 base 之上全部代码面）：恰 11 个路径 ——
`packages/namespace-api/` 5 modified（`src/create-namespace.ts`、`src/rest.ts`、`src/index.ts`、
`AGENTS.md`、`README.md`）+ 5 added（#269 冻结测试 4 test + 1 harness）+
`apps/yjs-server/test/hub-restart-static-target-red.test.ts`（本轮修复）。`.github/**`（含
`ci/test-durations.json` 条目 `19965`）、`docs/**`、`CONTEXT.md`、`package.json`、
`pnpm-lock.yaml`、`packages/ws-replication/**`、`apps/yjs-server/src/**` 零改动。

## 3. Owner 评论 5629026278 逐条判定

| Owner 口径（原文要点） | 判定 | 实测证据 |
|---|---|---|
| ① **允许**：修正该用例对 backoff 时序的假设（根因 full jitter 无下界） | **落实且未越界** | 修复全部在许可面内：新增 `waitForArmedBackoffWindow`（L130–163，等「最新一条已武装且 `delayMs ≥ minDelayMs`、未被后续 `connection-state-changed` 取代」的窗口，超时/进程退出皆响亮 throw）；backoff 帽值由硬编码 `5_000/5_000` 改为运行期实测派生（L257 `hubV2BootStartedAt`、L262 预算 = 首测 boot×2+2s 上取整 500ms、L265 `backoffCapMs = 2×预算`、L278 配置消费）；重启前先取已武装窗口（L314–320）。**生产代码零改动**（`packages/**`、`apps/yjs-server/src/**` 零 diff）——full jitter 为协议 §15 规范行为，未为测试加下界/env override/确定性旁路，与 owner 根因表述同构 |
| ②a **必须保留全部既有断言**（不得删除、放宽或 skip 任何 `expect`），只让时序可判定 | **met** | `expect(` 计数 13→13；逐条对位（pre L122/193/232/234/235/248–251/252/253/254/262/268/285/286 ↔ post L168/239/285/287/288/301–304/305/306/307/327–330/336/354/355），**matcher 与期望值逐字不变**。唯一语法增量：受保护断言 `expect(statusBeforeWrite.connectionState).toBe('backoff')` 新增 vitest 第二参诊断消息（post L327–330，`Hub restart took <ms> of the armed <ms> backoff window`）——actual/matcher/expected 三要素逐字保留，第二参仅提升失败可诊断性，不改变判定语义（非删除/放宽/skip）。结构面：无 `.skip`/`.only`/`.todo`（grep 0 命中）；单一 describe/it；`it` 超时 `240_000`（post L360）未动；`afterEach` SIGKILL+tmpdir 清理未动 |
| ②b 改动须在**提交信息与 PR 说明**明确披露：#229 用例 flake 收敛、属 CI 稳定性修复、而非本票功能改动 | **commit 半项实质满足；PR 半项尚无载体（§7-P6）** | commit message 实测为单行 `test(ci): stabilize issue 229 hub restart backoff`：type/scope `test(ci)` + issue 229 定位，将改动定性为 #229 测试的 CI 稳定性收敛而非 #269 功能（分支为 `mabf/issue-269`，消息未挂靠 269 功能语义）——定性披露成立。注意：SA3 staged 的带正文 `fix(#229): …`（含根因/保留面/上界修正三段说明）**未被采用**，commit 无正文——根因与保留面的完整披露须由 PR 说明补足（MINOR M-2 + §7-P6） |
| ③ **提交前必须清除临时诊断输出**（`[tmp-diag]`/`[tmp-gate]` 调试 console.log 与临时探针脚本） | **met** | 仓面 grep `tmp-diag\|tmp-gate\|tmp-phase`（`*.ts`/`*.mjs`/`*.js`，排除 node_modules）**0 命中**；post 测试文件 `console.`/`debugger` **0 命中**（diff 内亦无新增）；工作树 `git status --porcelain --untracked-files=all` 为空、**0 untracked 探针脚本**；wiki 中仅存的 `tmp-gate\|tmp-diag` 字样是 SA3 V7 的清理核验记录文本，非诊断输出。SA3 V4 声明的临时诊断打印在落盘代码中不可见 |
| ④ 该文件改动使此前 SA9/SA10 评审头失效，**须对新的 head 重跑最终评审组（SA9 + SA10）** | **SA10 半项由本报告履行；SA9 半项待派发（§7-P7）** | 本报告即对 head `296e646` 的 fresh SA10 spec-review（iteration 2）。仓内 SA9 记录版仍为其 iteration 1（head `c739770`），对 `296e646` 的 SA9 复审尚无产物——Controller 派发义务，非本 diff 的 spec 缺陷 |
| 收尾句「除此之外本轮修复不做任何额外改动」 | **代码面 met** | commit `296e646` 恰 3 路径：owner 点名测试 + 2 个 wiki 角色产物（SA3/SA4 报告原位更新，MABF 流程记录、非行为改动）；`.github/**`、`docs/**`、生产源码、其它测试、`test-durations.json` 零改动。wiki 产物与修复同 commit 落盘（前轮惯例为 docs-only 分离 commit）记 MINOR M-3 |

## 4. CI 修复的 spec 合规专项（修复语义独立复核）

- **根因三方一致**：协议 §15（L426–431）`cap = min(maxBackoffMs, baseBackoffMs·2^attempt)`、
  `delay = random(0, cap)`；`peer-connection.ts` L940–941 实测同构；owner 评论 ① 同文。旧断言前提
  「帽值 ⇒ 延迟下界」不成立，失效的是测试推断，修在测试——责任归属正确。
- **「只让时序可判定」的边界保持**：修复把「随机窗口内的瞬态观测」改为「已武装窗口内的确定前提」
  （先等 `delayMs ≥ 预算` 的 armed 窗口 → 再 spawn Hub v2b → status 断言），断言语义逐字保留；SA3
  D8 拒绝的「放宽为 `not.toBe('ready')`」方案未被采用——无放宽路径。
- **许可面内的时序参数变化（均非断言）**：backoff 配置帽值 5000/5000 → 派生 `backoffCapMs`（owner
  ① 明示允许）；`channel-state-changed → live` 等待上界 `60_000` → `backoffCapMs + 30_000`
  （post L343）——等待失败期限的派生修正，不断言任何行为；helper 超时 90s（L318）与进程退出
  均为响亮 throw，无静默放行。
- **事件面消费合规**：helper 只读进程事件流（`connection-backoff-scheduled.delayMs` 带 `typeof`
  守卫、`connection-state-changed` supersede 判据），不改变被测系统；`afterEach` 清理对称未动。

## 5. 既有 #269 交付在新 head 上的维持性核验（AC1–AC6 carry-over）

新 base `f2de805`（#270 Server 集成 (#303)）对 `packages/namespace-api/**` **零触碰**（`git show
f2de805 --name-only` 实测 0 命中）；#269 实现 commit 内容由 `25b41dc` 重放为 `1e4ae72`，
`git diff 25b41dc 1e4ae72 -- packages/` **为空**（两 commit 间全部差异仅为新 base 带入的 #270
wiki 证据文件）。因此 iteration-1 的 AC 逐条判定在新 head 上原样成立，本轮重测锚点：

| 复核项 | 实测 |
|---|---|
| 冻结测试完整性 | sha256 5/5 与 SA6 §13.4 逐字节一致：harness `14062b3d…`、support `9f9688ab…`、mapping `14465a40…`、abort `2f298a8e…`、observer `dbf8778a…` |
| 测试目录 delta | `git diff 209b046 HEAD --name-status -- packages/namespace-api/test/`：恰 5 `A`、0 `M` |
| AC1 失败映射锚点 | `create-namespace.ts`：fatal `instanceof` + `error.committed` 唯一二分（L268/L278）；503 `REGISTRY_NOT_ACCEPTING`（L293–294）；500 `NAMESPACE_CREATE_FAILED`（L295–296）；unknown → 500 `INTERNAL_ERROR`（L282–283 区） |
| AC2 内部契约违例 | L297–302：`NAMESPACE_CREATE_INVALID_INPUT`/`NAMESPACE_ALREADY_EXISTS` → diagnostic `unknown-exception` + 500 `INTERNAL_ERROR`，不透传 |
| AC3 取消边界 | 三道闸门 L193/L196/L200 + `abortSettle` L206；接纳点注释与零 signal 观察保持；`await lease.release()` 恰一次 L316 |
| AC4/AC5 observer 契约 | `rest.ts` 构造门 L318–325（双 observer `typeof === 'function'` 否则 TypeError）；`RestMetricsEvent` L61/`RestDiagnosticEvent` L85；成功 metrics L326（`create-namespace.ts`） |
| D1 limits 跨字段口径 | `rest.ts` L208：两键显式矛盾 TypeError 文案在位（rebase 裁决保持） |
| 旁证 | `apps/yjs-server/src/rest-hosting.ts`（#270，base 侧）经 `request-body.ts`/`create-namespace.ts` 消费 abort 语义——base 对 #269 契约面为加法消费，无改写 |

结论：AC1–AC6 全部维持 **met**（逐条判定表见文末归档的 iteration-1 §3）；本轮 CI 修复不触及
`packages/namespace-api/**`，不改变任何冻结断言、映射语义或观测面。

## 6. MINOR 观察（非阻断）

| ID | 观察 | 处置建议 |
|---|---|---|
| M-1（承 iteration-1 M-1 / SA9 MINOR-2，仍开放） | 包 AGENTS.md 映射条与 README L12 对 diagnostic 覆盖面欠述（fatal 两分支同样先发射 `registry-fatal` diagnostic，文档仅提 unknown/违例）；方向为保守欠述，冻结契约（B3/B4/D5）锁定真实行为 | 后续文档修订轮补精确表述；不阻断 |
| M-2（新） | commit `296e646` 为单行 subject，未采用 SA3 staged 的带正文 `fix(#229): …` 消息（其正文含根因、保留面、live 上界修正三段披露）。owner ②b 的 commit 半项在**定性**层面成立（`test(ci)` + issue 229），但正文级披露缺席 | PR 说明必须承载完整披露（根因 = full jitter 无下界、断言逐字保留、仅测试面），见 §7-P6 |
| M-3（新） | wiki 角色产物（SA3/SA4 报告原位更新）与测试修复同 commit 落盘（`296e646` 含 3 路径）；均为非行为流程记录，不违反 owner「不做任何额外改动」的代码面口径，但与前轮 docs-only 分离 commit（`a45ffae`/`abcabfe`）的惯例不同 | 后续可按「代码修复与 wiki 记录分离」惯例拆分；不阻断 |

## 7. PR 必须披露的未达成/延后项（披露义务，非本票 AC 缺口）

| # | 事项 | 去向 | 依据 |
|---|---|---|---|
| P1 | metrics `rejected` outcome 发射策略未实现（403/405/4xx/422 族零事件）；5xx body 无 `message`；未映射窄 issue 保持 fail-loud rejection | 后续错误契约票 | 设计 §1 非目标/§7.4.2 D-4；包 AGENTS.md Deferred 节 |
| P2 | D1 limits 跨字段口径变化（两键显式矛盾 TypeError；单键时默认值按不变量收敛）须向 reviewer 显式披露 | PR 描述 + ADR 折入（P3） | SA3 iter-1 D1/F1a；rest.ts L166–174 |
| P3 | ADR-0015 正式接受时须折入 R1/H-A/R3 与 L-1；接受前若被修订须重过 SA8 门禁 | 父 PR #158 治理 | SA8 OBS-1/OBS-R1-1；SA2 OBS-3 |
| P4 | 合并前动态验证复跑：SA3 iter-1 的 125/125 ×8 与 tsc 0 error、iter-2 的 V3（10/10）/V5/V6（162）均为其实跑声明，SA10 纪律下未复跑；CI Node 20/24 两腿首跑需确认 | 合并前 gate / CI | SA4 §11-R1/R4 |
| P5（较 iteration-1 更新） | server 装配面已由 base 上的 #270（`f2de805`：REST/WebSocket 共享 Registry + 有序停止 + drain abort 端到端）落地；「abort rejection 公共判别子（`RestBodyReadAbortedError` 包内私有）」的收口方式已由 #270 侧以 `rest-request-failed` 事件面处理——该私有判别子是否仍需加法导出属 #270/后续票的口径，非本票阻断项 | #270 已落地（base）/后续票 | git 历史 + `task_issue-270_sa10_spec.md` 例 2 |
| P6（新，owner ②b PR 半项） | **PR 说明必须明确披露**：`296e646` 是 #229 用例的 flake 收敛 / CI 稳定性修复，而非 #269 功能改动；commit message 已作定性（M-2），PR body 须补足根因与「全部断言逐字保留、无 skip/弱化」的完整披露 | Controller 收尾（PR body） | owner 评论 ②；SA4 §11-R2 |
| P7（新，owner ④ SA9 半项） | 新 head `296e646` 的 SA9 standards 复审须完成方可交付（本报告已履行 SA10 半项） | Controller 派发 | owner 评论 ④；SA4 §11-R3 |
| P8（新，承 SA4 R4/R5） | CI 复跑确认：shard 2/6 × Node 20/24 两腿全绿、不再出现 `handshaking ≠ backoff`；慢 runner 尾巴风险（v2b boot > 2×实测+2s）将以带时间数据的断言消息响亮失败，届时调预算边际系数而非动断言 | Controller push 后 Actions | SA3 Deferred；SA4 §11-R4/R5、OBS-C |

## 8. 结论

本轮 CI 修复（`296e646`）对 owner 评论 `5629026278` 的口径**逐条落实**：许可面（①）内修复、
断言零删除/零放宽/零 skip（②a，13↔13 逐条对位、唯一语法增量为 vitest 诊断消息第二参）、临时
诊断与探针零残留（③）、commit 定性披露成立且 PR 半项已登记交付义务（②b）、本报告履行新 head
SA10 复审（④ SA9 半项待派发）；代码面无任何额外改动。既有 #269 交付在新 head 上与前轮 approve
内容逐字节一致，AC1–AC6 维持 met，冻结契约零触碰。无遗漏、无部分实现、无错误实现、无 scope
creep。§6 三条 MINOR 不阻断；§7 八项为 PR/交付披露义务而非本票缺口。

**verdict: approve**

---

# Iteration 1（归档）：rebase 后复审

> 阶段：spec-review（**iteration 1 — rebase 后复审**）。派发：`sa-4c9594c5-6991-4677-9428-2a014a3e1925`（mabf-sa10）。
> 审查对象：worktree `/home/wangjian/nomicore-fix-issue-269`，branch `mabf/issue-269`，HEAD
> `c739770ff90a8d06ce8bba35dfd25d514cd7994c`（`docs(issue-269): add SA8 conflict-gate reports…`）；
> 实现 commit `25b41dc`（`feat(namespace-api): map REST create failures`）rebase 在 Parent PR 当前 base
> `209b046`（`feat(namespace-api): validate REST namespace creation (#297)`，即 #268 落地内容）之上。
> 本报告**原位重写** iteration 0 的 SA10 报告（其审查对象为 #267 骨架上的未提交 diff，HEAD `0b06050`）；
> 行号锚点全部按合入后源码重测。
> 方法：纯静态独立复核（读 issue 正文/ADR/设计/SA2/SA3/SA4/SA6/SA8/SA9 产物 + 合入实现全文 + 两侧冻结
> 测试全文/关键面 + `git diff`/sha256 实测）；未修改任何代码/设计/测试，未运行测试，未启动服务。
> Owner 要求口径：Issue-comment REST snapshot 为空（dispatch 明示；SA8 两轮/SA6/SA3/SA4 多源一致）——
> 无评论级 owner 要求；验收口径 = issue body What to build 三段 + AC1–AC6。
> **该迭代结论 `approve`；iteration 2 复核：#269 实现内容在新 head 上与 `25b41dc` 逐字节一致
> （`git diff 25b41dc 1e4ae72 -- packages/` 为空），以下判定全部仍然有效。**

## 1. 裁决

**verdict: `approve`** —— AC1–AC6 全部 met；issue body 三段要求逐条落实；对 Parent PR base（#268）
的语义冲突解决（D1–D4）忠实保持 #269 已批准契约与设计语义，且未弱化 base 任何冻结断言；无遗漏、
无部分实现、无错误实现、无 scope creep。1 条 MINOR 级观察（§6，承 SA9 MINOR-2 的文档欠述）不阻断
approve；PR 必须披露的未达成/延后项见 §7（均为显式切片边界与本轮 rebase 裁决的治理义务，非本票 AC 缺口）。

## 2. 审查输入与证据链

| 输入 | 位置 | 核验 |
|---|---|---|
| Issue 正文 + AC1–AC6 | `wiki/raw/task_issue-269.md` | 已读；Comments 节空 |
| 派发记录 | `wiki/raw/task_issue-269_dispatch.md` | SA8 conflict-gate iter 0，comments `[]` |
| SA8 前置门禁 / 设计后复审 | `artifacts/sa8-conflict-report-issue-269{,-design-recheck}.md` | `clear`/`clear`（0 冲突）；OBS-1/2/3 与 OBS-R1-1/R3-1 义务链完整 |
| SA6 验收契约 | `wiki/raw/task_issue-269_sa6_contract.md` | `approve`；29 用例冻结；H-M/H-D/H-A + R1–R4；§13.4 哈希 |
| SA1 设计 | `wiki/raw/task_issue-269_design.md` | §7.1 T1–T11 / §7.3 / §7.4 / §7.6（#268 seam）/ §7.8 |
| SA2 设计评审 / SA4 实现审查 / SA9 标准审查 | `wiki/raw/task_issue-269_sa2_review.md` / `_sa4_review.md` / `_sa9_standards.md` | 均 `approve`（0 BLOCKER/MAJOR）；OBS 落况见 §3/§6 |
| SA3 实现报告（iteration 1 重写版） | `wiki/raw/task_issue-269_sa3_impl.md` | rebase 冲突解决记录（4 冲突路径并集合并 + D1 跨票裁决）；V 证 125/125 ×8 与 tsc 0 error 为其实跑声明（§7-P4 登记合并前复跑义务） |
| ADR 0015（规范基） | `docs/adr/0015-vertical-rest-namespace-create.md` | blob `64daa16a…` / sha256 `3a75f99b…148` 实测与 SA6 §3.1 逐字一致；本 diff 零触碰 |
| 合入实现 | `packages/namespace-api/src/{create-namespace,rest,index,request-body,rest-problem}.ts` + 包 `AGENTS.md`/`README.md` | 五源文件全文读；`git diff 209b046 HEAD` 逐行 |
| 冻结测试 | #269 5 文件（SA6 §13.4）；#268 base 5 测试 + 2 harness；#267 legacy 4 测试 + 1 harness | sha256 实测 #269 5/5 逐字节一致（`14062b3d…`/`9f9688ab…`/`14465a40…`/`2f298a8e…`/`dbf8778a…`）；`git diff 209b046 HEAD -- packages/namespace-api/test/` 恰 5 个 `A`（新增），零 `M` |

**diff 范围实测**（`209b046..HEAD`）：`packages/` 下恰 5 modified（`src/create-namespace.ts`、
`src/rest.ts`、`src/index.ts`、包 `AGENTS.md`、`README.md`）+ 5 added（#269 冻结测试 4 test + 1
harness）；`namespace-registry/**`、`vfsl/**`、`persistence/**`、`docs/adr/**`、`CONTEXT.md`、
`package.json`、`src/request-body.ts`、`src/rest-problem.ts` 零改动。工作树 clean，rebase 已由
Controller 收尾（`25b41dc` + `c739770`）。

## 3. AC 逐条判定（合入后实现行号实测）

| AC | 判定 | 实现证据 | 冻结契约锚 |
|---|---|---|---|
| AC1 503 / 500 三分支（FAILED / OUTCOME_UNKNOWN / INTERNAL_ERROR）按 Registry 结果类型精确映射，committed 语义正确 | **met** | `create-namespace.ts`：`REGISTRY_NOT_ACCEPTING`→503 逐字 code（L293–294）；窄 issue `NAMESPACE_CREATE_FAILED`→500 逐字 code（L295–296）；fatal 以 `instanceof NamespaceRegistryFatalError` + `error.committed` 为**唯一**二分判别子（L268/L278–280）：`true`→500 `NAMESPACE_CREATE_OUTCOME_UNKNOWN`、`false`→500 `INTERNAL_ERROR`（R1）；unknown throw→500 `INTERNAL_ERROR`（L282–283）。phase 只进 diagnostic 不参与判别（L274–276）；5xx/503 body 为最小 `{"code"}` 面（`errorResponse` L162–174） | B1（真实 shutdown→503）/B2（真实 `DocCreateOperationalError`→500 FAILED）/B3/B4（真实 fatal 二分，B4 同点反断言 ≠FAILED/≠OUTCOME_UNKNOWN）/B7（unknown） |
| AC2 `NAMESPACE_CREATE_INVALID_INPUT` / `NAMESPACE_ALREADY_EXISTS` 从 REST 路径返回安全 500 并触发 diagnostic | **met** | L297–302：两码合并分支 → diagnostic `{kind:'unknown-exception', cause:created（issue 对象引用）, owner}` + 500 `{code:'INTERNAL_ERROR'}`；`NAMESPACE_ALREADY_EXISTS` 不透传。body 仅稳定 code，issue message 哨兵不入任何 client 面 | B5/B6（状态/code/哨兵不泄漏/diagnostic 恰一 + cause 引用相等）+ D5(d) |
| AC3 body 读取中断时 Registry 零触达；Registry 接纳后客户端中断不取消 create，仍等待 settle 并 release | **met** | `readRequestBody`（L187–203）三道闸门：①入口同步 `signal.aborted` 判定（L193，**先于任何读取期检查**，含 base 的 Content-Length 提前 413 与 stream byte 上限——二者都在其后被调用的 `readBoundedBodyText` 内部）→ ②共享 `readBoundedBodyText` 自身观察 signal（`reader.cancel()` 使挂起读有界结算；其循环内 `aborted` 核对先于 byte 上限判定，`request-body.ts` L78–92）且 seam 在 catch 处再核对 `signal.aborted`（L200）→ ③读胜出后同步再核对（L196）。`abortSettle`（L206–209）= metrics `{outcome:'aborted'}`（无 code/status）+ 有界 rejection + 零 diagnostic。零触达结构保证成立：读返回 → `registry.create`（L262）之间仅同步代码（JSON.parse/形状/资源检查/`deriveSchemaIdentity`/envelope 组装）；JS 同步段内无 abort 事件交付窗口。接纳后零 signal 读取（grep 实测：signal 仅出现于 L192–208 读取 seam 与注释；L266 注释明示接纳点）；`await lease.release()` 恰一次（L316） | C1（pre-abort 零触达 `[]` + `['aborted']`）/C2（mid-read 有界）/C5（pre-abort + `maxBodyBytes:16` 可构造 + aborted 非 413，R3）/C3（create 在途 abort → 201 + release 恰一次 + `['succeeded']`）/C4（release 在途 abort → 201 + lease released） |
| AC4 两个 observer 构造时强制显式注入；metrics 事件低基数且无敏感字段；diagnostic 仅三类事件且不带 schema/root/完整 issues | **met** | 构造门 `rest.ts` L318–325（`typeof === 'function'`，缺任一 → `TypeError`；显式 no-op 合法）。`RestMetricsEvent`（L61–68）键集恰 `{operation, outcome, code?, status?}`，`operation` 恒 `'namespace-create'`（create-namespace.ts L104），outcome 五值词表；无 owner/namespaceId/issues/schema/root/cause。`RestDiagnosticEvent`（L85–93）三类 kind + `cause: unknown`（exact 引用）+ 诚实可选字段（operation/phase/committed 仅 registry-fatal，L274–276 透传 fatal 字段；namespaceId 仅 lease-release-failure 且取 release 前 DTO 副本 L311–314/L323）；无 `issues` 键；无 schema/root | D1（TypeError 门）/D2（成功事件白名单+词表+无泄漏）/D4（release-failure）/D5(a–d)（三类 kind + cause 引用相等 + 无 schema/root/issues）/D6（跨分支矩阵 1×succeeded/1×unavailable/5×failed/1×aborted + `ns-` 泄漏扫描 + operation 单常量） |
| AC5 observer throw 不改变 HTTP 结果 | **met** | `emitMetrics`/`emitDiagnostic`（L136–156）同步 try/catch helper；全部发射点（errorResponse 内 L172 / abortSettle L207 / fatal L270 / unknown L282 / 违例 L301 / release 失败 L319 / 成功 L326）一律经 helper，无裸调用（grep 实测）——隔离为结构性保证 | D3：双 observer 同 throw 下 201/503/500 OUTCOME_UNKNOWN/release-failure 201 四分支全部不变 |
| AC6 测试覆盖：not accepting、operational failure、fatal committed 二分、中断语义、observer 隔离 | **met** | 五族全覆盖：B1（not accepting，真实 shutdown）、B2（operational，真实 persistence 注入）、B3/B4（fatal committed 二分，testing 注入真实 Registry 产物，committed:true 提交事实可被另一 registry open 读回）、C1–C5（中断语义）、D3（observer 隔离）；+ 支撑 9 恒绿锚（不 import router，不受合入影响）+ 负控 2 + base(#268) 61 + #267 legacy 35 = 125 用例。SA3 F1 实跑 125/125 绿 ×8（SA10 纪律下未复跑，见 §7-P4） | SA6 §12.3 映射 6/6 |

## 4. 语义冲突解决专项复核（dispatch 点名：rebase 对当前 Parent PR base 的冲突解决）

冲突两侧：#269 侧把 4xx/422/limits 留给后续票（rejection 结算、observer 零发射）；base `209b046`
已落地 step 3–5（owner/query/媒体层、有界读取 + 严格 UTF-8、形状/资源检查、limits 构造门）与
4xx/422 固定 problem shape。合入必须同时满足 #269 冻结 29 + base 61 + legacy 35 = 125 用例。

| 冲突解决（SA3 D1–D4） | 独立复核结论 |
|---|---|
| **D1（本轮唯一新语义裁决）**：`resolveLimits` 跨字段门由「合并默认后的有效值矛盾即 TypeError」收敛为「两键显式矛盾 ⇒ TypeError；单键时默认值按不变量 `maxSchemaTextBytes <= maxBodyBytes` 向显式值收敛」（rest.ts L204–216） | **必要且充分**：C5（#269 冻结）以 `{maxBodyBytes:16}` 单键构造并要求 aborted 非 413——旧有效值门下 256 KiB > 16 必然构造期 TypeError，C5 不可达（SA3 F1a 实测首跑即此红）；base AC2（#268 冻结，`rest-create-limits-contract.test.ts` L102–108）只钉死**两键显式**矛盾（`{1024, 2048}`→TypeError）与相等允许——D1 逐字保持。base 全部 limits 用例均为双键或 `{maxSchemaTextBytes:32}` 单键（D1 下有效配置不变：max(4 MiB, 32)=4 MiB），**零冻结断言被弱化**。行为增量仅限无冻结覆盖的输入（单键且默认键与显式值矛盾：旧 TypeError → 新收敛构造成功），已在 rest.ts 头注/L166–174 注释、`RestRouterLimits`/`RestRouterOptions` 文档、README L9 同步披露，并登记 ADR 折入义务（SA3 Deferred verification L-1）。ADR 0015 L113 不变量对有效配置恒成立。判定：诚实、最小、双侧契约同时满足的冲突解决 |
| **D2**：abort rejection 形状承接 base 既约事实（`RestBodyReadAbortedError` 携带 `ABORTED_BODY_READ_MESSAGE` + `signal.reason` 作 cause，类不导出，create-namespace.ts L107–120） | 与 base `rest-create-body-read.test.ts` D6 的逐字断言（固定 message + cause 引用相等，L98–114）兼容：mid-read 路径 base 内部 `createAbortedError` 与 seam `abortSettle` 抛出形状一致；pre-abort 经闸门①同样形状。#269 H-A 明示 rejection 值形状非契约面（唯一公共分类面是 metrics `aborted`）。判定：两票 rejection 形态不因合入改变，正确 |
| **D3**：读取段复用 base `readBoundedBodyText` 为单一读取机制，seam 只做①/③闸门与 abort 分类/发射（L187–203），不再自建 `Promise.race([request.json(), abort])` | 无平行读取路径（单一路径纪律）；mid-read abort 有界性由 base 模块内部 `reader.cancel()` + `aborted` 核对保证（request-body.ts L66–99，finally 摘除 once 监听器，生命周期对称）；「读取段内 abort 优先于任何读取期结局（含 413）」由「入口判定先于一切 + base 循环内 aborted 核对先于 byte 上限判定 + seam catch 再核对」三层结构保证。R3/C5 在合入语义下保持可执行锁定。判定：等价于设计 §7.3 的合入适配，语义无损 |
| **D4**：`CreateNamespaceOrchestrationDeps` 接口 export（含新增 `limits` 字段）但模块包私有 | `package.json` exports 恰 `.`/`./rest`（diff 实测零改动）、`index.ts` 未 re-export（L7–15 实测）——私有性由打包面结构性保证；iteration 0 已披露、SA4 确认非偏离 |
| 冲突区域并集合并（4 个 UU 路径：两源文件 + 两包文档；`index.ts` 自动合并） | create-namespace.ts 以 #269 映射/观测/abort 为骨架、逐字保留 base step 4/5 与 422 分支（L228–253/L287–292：malformed JSON 400、形状/schemaText 413/depth/nodes、derive 与 Registry 两路 422 全在）；rest.ts 保留 base step 1–3 分发与 limits 面、叠加 #269 事件类型与 deps 传递；AGENTS.md/README 合入两份 deferral 清单并落实 SA4 OBS-A 概括句修正（observers 条目改为「失败映射拥有的终局路径恰一事件」+ 明示 4xx/422 与 403/405 零发射）。冲突标记扫描 0 命中（SA3 F0）；`git diff` 实测无 base 私改（`request-body.ts`/`rest-problem.ts`/base 测试与 `209b046` 逐字节一致） |

**跨票不变量终态**：设计 §7.6 / SA6 §12.4 / SA8 OBS-R3-1 的「读取段内 abort 优先于 413 + 读取期
结局发射前再核对 `signal.aborted`」在合入代码中结构性成立（§3 AC3 行 + D3 行），C5 已由 SA3
实跑转绿（125/125 ×8 含 C5 与 base AC2 同时成立）。#267 冻结顺序 route → method → role → owner →
body → derive → create → DTO → release → 201 未 reorder（rest.ts L336–391 + create-namespace.ts
L220–331 实测）。

## 5. Issue body 非 AC 要求与关键裁决的独立复核

- **committed 二分（SA8 OBS-2 → R1 → 设计 §7.2）**：合入实现仍以 `error.committed` 为唯一判别子
  （L278），phase 仅诊断透传。Registry 事实矩阵（`namespace-id-generation` 恒 false、
  `create-document-internal`/`lifecycle-slot-internal` 可真可假、`runtime-construction` 恒 true）
  未因 rebase 改变（`packages/namespace-registry/**` 零 diff 实测）；「按 phase 推断」歧路继续被正确
  避开。M1/M2 变异锁定方向不变。
- **取消边界（ADR L113 逐字）**：body 读取尊重 signal + 零触达 + 接纳后不传播取消、等待 settle 并
  release——三道闸门 + 零异步窗口 + 恰一次 awaited release，不依赖 Node 24 平台行为（support 恒绿锚
  钉死平台事实）。abort 以有界 `handle` rejection 结算，未伪造 HTTP status。
- **Observability（ADR L186–190 逐字）**：显式注入门不变；metrics 键集/词表/operation 常量/无敏感
  字段与 H-M 逐键一致，`code` 出现时等于 body 稳定 code（同一 `errorResponse` 调用点构造，无第二
  来源），成功省略 code、abort 无 code/status 均为诚实省略；diagnostic 三类 kind、exact cause 引用
  （fatal 分支传 fatal 实例本身而非 `fatal.cause`，与 D5 引用相等面吻合）、owner 为 frozen 路由捕获
  对象、namespaceId 仅 lease-release-failure（ADR L161 逐字）；schema/root/完整 issues 绝不出现。
  「Host 须视为敏感运维接口并负责访问控制/采样/脱敏」已写入 `RestDiagnosticEvent` 类型注释
  （rest.ts L83）与 README L9；义务未挪进 router。
- **家族边界**：#269 不抢跑 #268 已落地族（本次 rebase 后 4xx/422 已由 base 实现，#269 叠加面零
  改写——diff 实测 base 源/测试零改动）；未映射窄 issue（`NAMESPACE_INVALID_IDENTITY`）保持
  fail-loud rejection（L303–306）；5xx body 未发明 message；未发明 `Retry-After`、abort HTTP status、
  第二读取路径、新公共子路径。metrics `rejected` 发射策略仍延后（403/405/4xx/422 零发射，与包
  AGENTS.md 一致）。

## 6. MINOR 观察（非阻断）

| ID | 观察 | 处置建议 |
|---|---|---|
| M-1（承 SA9 MINOR-2，合入文档仍存在） | 包 AGENTS.md 映射条「fatal `committed:false`, unknown exceptions, and internal contract violations … → `500 INTERNAL_ERROR` (the latter with a diagnostic report)」与 README L12「（后两者上报 diagnostic）」对 diagnostic 覆盖面**欠述**：实现中 fatal 两分支（committed:true → OUTCOME_UNKNOWN 与 committed:false → INTERNAL_ERROR）同样先发射 `registry-fatal` diagnostic（L270–277 实测），并非只有 unknown/违例分支上报。方向为保守欠述（实现多于文档所述），非危险方向夸大；同一文档的 observer 条目（三类 kind）与类型注释未限制发射分支，冻结契约（B3/B4/D5(a)(b)）锁定真实行为 | 后续文档修订轮把映射条补为「fatal 两分支与 unknown/违例均在 Response 前发射对应 diagnostic（503/FAILED 零 diagnostic）」或等价精确表述；不阻断本票 |

（iteration 0 的 M-1/M-2 已闭环：SA4 OBS-A 概括句过宽已在合入文档修正——AGENTS.md observers
条目实测为「every terminal path owned by the failure mapping below emits exactly one … The 4xx/422
problem family and the 403/405 gates emit no metrics event yet」；SA4 OBS-B 的实现细节已在 SA3
iteration-1 报告 Deviations D2/D3 集中披露。）

## 7. PR 必须披露的未达成/延后项（均为显式切片边界或治理义务，非本票 AC 缺口）

| # | 事项 | 去向 | 依据 |
|---|---|---|---|
| P1 | **metrics `rejected` outcome 发射策略未实现**（403/405/4xx/422 族当前零事件）；**5xx body 无 `message` 字段**（最小 `{code}` 面）；未映射窄 issue（如 `NAMESPACE_INVALID_IDENTITY`）仍以 `handle` rejection 结算 | 后续错误契约票 | 设计 §1 非目标 / §7.4.2 D-4；包 AGENTS.md Deferred 节；SA8 OBS-B/OBS-C |
| P2 | **D1 limits 跨字段口径变化须向 reviewer 显式披露**：base `209b046` 对「单键且默认键与显式值矛盾」的构造输入旧行为为 TypeError，合入后改为默认值收敛（如 `{maxBodyBytes:16}` 可构造、有效 schema 上限压缩为 16）。两键显式矛盾 TypeError（base AC2 冻结）不变；无冻结断言被改写；属 C5 + base AC2 同时成立的唯一可行解 | PR 描述 + ADR 折入（见 P3） | SA3 D1/F1a；rest.ts L166–174；README L9 |
| P3 | **ADR-0015 接受时的折入义务（较 iteration 0 扩一项）**：R1（fatal committed:false → INTERNAL_ERROR）、H-A（abort 以有界 rejection 结算、无 HTTP status）、R3（读取段内 abort 优先于 413）、以及本轮新增 **L-1 limits 跨字段口径**（两键显式矛盾 TypeError；单键收敛）须在 0015 经父 PR #158 正式接受时折入 ADR 正文或修订节；0015 仍为「提议」（blob/sha256 锚定本轮实测一致），若接受前被修订，设计+契约须重过 SA8 门禁 + 修订轮 | 父 PR #158 治理 | SA8 OBS-1/OBS-R1-1；SA2 OBS-3；SA3 Deferred verification |
| P4 | **合并前动态验证**：SA3 iteration-1 的 F1（125/125 绿 ×8，含 C5 与 base AC2 同绿）与 F2–F4（三入口 tsc 0 error）为其实跑声明，SA10 纪律下未复跑；合并前须复跑 `NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck packages/namespace-api/test` 与 `pnpm typecheck`；CI Node 20 腿首跑需关注 support 文件钉死的 Node 24 平台 abort 事实（router 语义不受影响，平台锚表述或需修订轮） | 合并前 gate / CI 首跑 | SA4 §11；SA3 Verification |
| P5 | **server 装配面未实现**：HTTP listener、graceful drain、连接级取消、abort 后 body/stream 清理；`handle` 的 abort rejection 须被 server 视为连接级取消（不得记 500 或重试）；abort rejection 公共判别子当前为包内私有 `RestBodyReadAbortedError`（不导出），留 server 票以加法决定 | #270（FR-5） | 设计 §1 非目标 / §13 残余 1；SA3 Deferred verification |

## 8. 结论

合入实现对 Issue #269 正文（失败映射 / 取消边界 / Observability 三段）与 AC1–AC6 的覆盖**完整且
忠实**：四分支映射与 committed 语义精确（含 ADR 欠规格分支的 R1 诚实填补）、内部契约违例安全 500 +
diagnostic、三道闸门 abort 边界（合入后由共享读取 seam 承载，abort 优先于 413 的跨票不变量结构
成立）与接纳后零观察、双 observer 显式注入/低基数/三类 diagnostic/全分支 throw 隔离——全部由 SA6
冻结契约（29 用例，sha256 5/5 逐字节一致）与 base/legacy 96 用例（零 diff）可执行锁定，并经 SA2/SA4/
SA9 三「approve」与 SA8 两轮「clear」。对 Parent PR base 的语义冲突解决（D1–D4）必要、最小、双侧
冻结断言同时保持，且全部披露于代码注释/包文档/SA3 报告。无遗漏、无部分实现、无错误实现、无
scope creep。§6 一条 MINOR 不阻断；§7 五项为 PR 披露义务而非本票缺口。

**verdict: approve**

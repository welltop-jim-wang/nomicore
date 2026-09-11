# SA9 Standards 审查报告 — Issue #270（Server 集成验收：REST 与 WebSocket 共享 Registry + 有序停止）

> SA9（独立 Standards 审查者）standards-review 轮产物。dispatch
> `sa-66c7ce09-8d52-480e-90c6-bebd679b4cf2`，phase standards-review，**iteration 1（修复轮复审）**。
> **被审对象**：**最终修复提交** = commit `a1cbe539542816004b4e7f188b2fdf493e2a743c`
> （`test(server): align REST behavior with parent validation`，3 文件：行为测试 +126/−23、
> SA3 报告与 SA4 评审原位更新）。其父经本轮独立核验（`git log --format='%H %P'` 亲证）
> = `8e550d4b2de9087f514d4b1cc837367c99182ea9`（#270 交付提交），祖父 =
> `209b0463890e5da33a497a845468f1f055ecec7b`（#268「validate REST namespace creation (#297)」）
> —— 与派遣简报「Parent PR #158 remains at head 209b046…」一致。branch `mabf/issue-270`，
> HEAD == 被审提交；工作树除未跟踪 wiki 证据/报告外 clean（`git status --short` 亲证）。
> **Issue 评论输入**：REST 快照空 `[]`（派遣简报明示）——无 Owner 追加要求、无评论 ID 锚定义务。
> **输入产物（全部亲读）**：`task_issue-270.md`（简报 AC1–AC4）、本文件 iteration 0 版
> （SA9 reject：S9-1 MAJOR + S9-2 MINOR + S9-3/4/5 OBS）、`task_issue-270_sa10_spec.md`
> （SA10 reject：B-1 BLOCKER + P-1–P-4）、修复轮 `task_issue-270_sa3_impl.md` 与
> `task_issue-270_sa4_review.md`（提交内原位更新版，逐 hunk 亲读 diff）、6 份
> `task_issue-270_sa3_repair_*.log` 证据、`task_issue-270_sa6_contract.md`（§13.4 冻结哈希）、
> `task_issue-270_design.md`（S9-2 现状复核）；规范链：根 `AGENTS.md`、`apps/AGENTS.md`、
> `apps/yjs-server/AGENTS.md`、`packages/namespace-api/AGENTS.md`、ADR 0015/0012/0009/0010/0011；
> 源码终态（`rest-hosting.ts`、`create-namespace.ts`、`request-body.ts`、`rest-problem.ts`、
> `rest.ts`、`index.ts`、`issue270-contract-support.ts`、修复后 `rest-hosting-behavior.test.ts`
> 全文）逐行亲读。
> **审查方式**：`git show/diff/log` 逐 hunk 亲读 + sha256 独立复算（冻结三文件 + 修复后测试文件
> 指纹）+ 定向 grep（skip/only/env、探针残留）+ 对修复后每条新断言做源码级静态推导（不运行测试）。
> **边界**：零业务代码/设计/测试改动；**未运行测试、未启动服务**（SA9 纪律——SA3 修复轮运行证据
> 作为输入核验其真实性/新鲜度/覆盖度）；零 commit/push/PR；唯一写入 = 本文件（原位更新）。
> **职责面**：只判断实现是否符合仓库 AGENTS、ADR、模块责任、既有架构惯例、单一事实源、生命周期
> 对称性、文件范围与测试质量标准；Issue 需求完整实现归属 SA10。

---

## Verdict

**approve**（`requiresConflictRecheck: false`）

- iteration 0 唯一 MAJOR（**S9-1**：rebase 使行为测试例 1 前提失效 → 确定性假红 + 证据不新鲜）
  **完全闭合**：例 1 重写为 #268 父契约断言（matched `400 MALFORMED_JSON` problem 原样透传、
  D8 事件 0 次、存活断言保留），D8 rejection 覆盖重定向为**两个互不依赖且仍以 rejection 结算
  的驱动锚**（例 1b bridge 级 + 例 2 端到端），全部验证证据在最终 rebased 基线之上按当前字节
  重新捕获（§2 逐条闭合核验）。
- 修复**未削弱交付**：生产源码与 SA6 冻结契约**零字节改动**（sha256 独立复算 = §13.4）；例 2
  只增断言、例 3/例 4 零 hunk；例 1 的删除面为零（事件期望 1→0 系语义修正而非弱化，并把
  「mapped 4xx 不得触发 D8 观测」的分界双向锁死）；D8 锚点数量由一（前提已破坏）升为二
  （独立 seam），覆盖严格更强（§3）。
- 文件范围精确最小：tracked 改动仅 ALLOW §11 行 7 条目内原位修改 + 管线固定 wiki 产物；
  DENY 面零触碰；临时复现探针零残留（§4）。
- 残余项全部为非阻断：S9-2（设计前提注记）维持 **MINOR** 并已按边界登记 routing: design；
  S9-3/S9-4/S9-5 维持 OBS 备案；新增两条 OBS（证据形式 nit、SA4 O-F 结构等价断言）见 §6。
- `requiresConflictRecheck: false`：修复为纯测试/证据对齐，未触任何生产面与 ADR 决策面；
  SA8 recheck 5 条重开条件零触发（本轮独立复核）。

---

## 2. S9-1（MAJOR）闭合核验——逐条对照 iteration 0 修复方向

iteration 0 §2.4 修复方向：「例 1 须改用在新基线下仍抵达 D8 rejection 的触发器（如对合法形状
但 Registry 返回未映射 code 的请求、或显式 abort 场景），并把断言对齐到新基线行为」。SA10 §6
B-1 同向。本轮逐项亲证：

### 2.1 例 1 断言与新基线行为逐点对拍（源码级）

| 修复后断言（test L52–87） | 本轮独立源码核验 | 判定 |
|---|---|---|
| `status === 400` | `create-namespace.ts:95-98`（`JSON.parse` catch → `createRestProblemFailure(400, MALFORMED_JSON)`）→ L108-110（`RestProblemFailure` → `problemResponse(400, payload)`，matched Response） | ✅ |
| `content-type` 含 `application/json` | `rest-problem.ts:143-146`（`problemResponse` 恒 `application/json`）；集成层 `rest-hosting.ts:116-124` matched 分支原样写回 status/headers/bytes | ✅ |
| `problem.code === 'MALFORMED_JSON'` | `rest-problem.ts:27/66` + L140（`{code, message}` 恒在） | ✅ |
| `message` 为非空 string | 固定文案 `'JSON 解析失败'`（rest-problem.ts:66/124）；断言只锁类型+非空，不固化中文文案——余量合理 | ✅ |
| `issues` undefined | `createRestProblemFailure` L125（`issues` 未给则不产键）+ `problemResponse` L141（仅存在时输出）——与包 AGENTS「`issues` 只在 422 上出现」一致 | ✅ |
| `rest-request-failed` 0 次（含后续 201 后仍 0） | `rest-hosting.ts:97-115`：matched 分支不经 `notifyRejection`；`dispatch` catch 唯一事件源不触达——「已映射 4xx 不产生 D8 观测」分界被双向锁死，反向漂移（4xx 误发事件）必红 | ✅ |
| 后续合法 create 仍 201（存活纪律） | 原例 1 存活断言全保留；T1-A/T2 冻结断言同面 | ✅ |

### 2.2 D8 rejection 覆盖重定向——两个仍以 rejection 结算的驱动（iteration 0 点名的触发器族）

**例 1b（bridge 级，test L89–133）**：

- 触发器合法性：替身实现的是 `createRestHosting` 的**公开声明依赖** `RestRouter`
  （`rest.ts:77-80` 单方法接口，包根入口导出 `index.ts:8-13`——app 测试只消费公共导出，
  合 `apps/yjs-server/AGENTS.md` Boundaries）；被测对象 `createRestHosting`
  （`rest-hosting.ts:52-195`）为**生产代码零 mock**，承载 D8 的唯一模块；rejection 文案
  `'unmapped registry issue: NAMESPACE_CREATE_FAILED'` 逐字镜像 `create-namespace.ts:139`
  的真实未映射 Registry code 路径——正是 iteration 0 建议的「Registry 返回未映射 code」族。
- 传输真实性：真实 `http.createServer` + 真实 TCP（`127.0.0.1:0`）+ 冻结 fixture 的
  `httpRequest` 客户端（只读导入，哈希不变）；零源码字符串断言。
- 断言面：500 + `text/plain` + **非空 body**（不固化 `internal error\n` 字面量——SA2 F4-(c)
  纪律保持）+ `onRejection` 恰一次且与所抛 rejection 内容相符 + 结算后 `drain(10_000)` <1s
  返回（in-flight 记账无泄漏，`runDrain` 空快照即时返回路径被真实驱动，
  `rest-hosting.ts:151-153`）。
- 补充静态核验：`writePlain` try/catch（L57-65）、`notifyRejection` 观测隔离（L67-74）、
  `handle` 外层 `.catch` 兜底（L189-192）——恰一次事件的结构性保证成立（dispatch catch 为
  唯一事件源，兜底结构性不可达）。

**例 2 追加（端到端，test L160–172）**：

- 触发链路本轮逐级亲证：drain 预算尽 → `req.socket.destroy()`（rest-hosting.ts:141-145）→
  挂起 body 读取流错误；`toWebRequest` 不传 signal（L77-93）⇒ `request-body.ts:80-83`
  `aborted === false` → **`throw error` 原样 rejection**（非 `RestProblemFailure`）→
  `create-namespace.ts:112` `throw error`（fail loud 注释原位）→ `router.handle` reject →
  `rest-hosting.ts:100-105` catch → `notifyRejection` + `writePlain(500)`（死 socket 上静默
  收口，不二次抛错）→ sink `rest-request-failed` **恰一次**。
- 异步窗口处置诚实：abort 与 `stop()` 结算之间的事件到达窗口由冻结 `waitUntil`
  （`issue270-contract-support.ts:446-458`，默认 10s 预算 + 10ms 步进，超时 **throw** 诚实
  失败而非静默通过）有界吸收；事件 `message` 非空 string 断言保持。
- 原 D4 断言（有界 ≥5s/<15s、status 0 + transportError、`app-stopped` 恰一次、无
  `app-stop-failed`、`replication-drained` ≥0）**零删除**；per-test 20s timeout 保持（O7）。

### 2.3 证据新鲜度修复（iteration 0 §2.2 第二半）

| 证据 | 时间戳 | 内容亲证 | 判定 |
|---|---|---|---|
| `repair_repro.log` | 10:24:43 | 以 `git show 8e550d4:…` 旧字节探针实跑：例 1 `expected 400 to be 500`，实际 body `{"code":"MALFORMED_JSON","message":"JSON 解析失败"}`——**确定性红复现**，与 SA9 iteration 0 §2.1 静态推导逐字吻合；探针已删除（§4） | ✅ 红→绿因果链闭环 |
| `repair-behavior.log` | 10:23:09 / 10:23:21 | 行为套件 **5/5 绿 ×2**（含例 1b 与更名后例 2，例名与提交内测试文件逐字一致），`Type Errors no errors` | ✅ |
| `repair-contract.log` | 10:23:44 | 冻结三件套 + 行为套件 3 文件 **12/12 绿**（T1-A/T1-B/T2/T3 + N1/N2/N3 + 行为 5 例），`Type Errors no errors` | ✅ |
| `repair_app-suite.log` | 10:24:57（427.70s） | 全 app 套件 **33 文件/174 例绿**（旧基线证据为 173 例；+1 = 例 1b，算术一致），`Type Errors no errors` | ✅ |
| `repair_typecheck.log`（空文件）+ `repair_root-typecheck.log` | — | 空输出 = `tsc -p` 静默成功形态；root 链（14 包 + app `&&` 链）无任何诊断输出——**standalone 偏弱**（未记录显式 exit code），但被上面四次 `--typecheck`「Type Errors no errors」独立 corroborate | ✅（形式 nit 见 §6 S9-6） |
| 证据↔提交字节同一性 | commit 10:42:18 | 证据采集于最终基线之上的工作树字节；提交内测试文件 sha256 本轮独立复算 = `b3041b1f832b0bd1a39f637202a72cab946585703d8714febc38175420d75f31`，与 SA3 报告/SA4 评审登记指纹**逐字节一致**；证据后唯一的提交增量 = 两份 wiki 报告（不影响测试结局）；HEAD == 被审提交、tracked 工作树 clean | ✅ 证据覆盖最终提交 |

## 3. 未削弱交付核验（派遣简报专项要求）

| 检查项 | 本轮亲证 | 判定 |
|---|---|---|
| 生产实现零改动 | `git show a1cbe53 --name-only`：仅行为测试 + 2 份 wiki 报告；`apps/yjs-server/src/**`、`packages/**` 零条目；AC1–AC4 生产面维持 iteration 0 已批状态 | ✅ |
| 冻结契约零字节 | 三文件 sha256 独立复算：`5cea9d4e…`（support）/`06e0bfe3…`（integration-red）/`2060e130…`（regression-anchors）= SA6 §13.4 逐字节一致 | ✅ |
| 断言删除面 | 例 1 原「500/事件恰一次」两条删除系**前提失效后的语义修正**（新基线下该结局本来就不经 D8）；其余断言（存活、后续 201、计数不增、message 非空）全保留；例 2 只增（+4 条断言）；例 3/例 4 零 hunk | ✅ 零弱化 |
| D8 覆盖强度 | iteration 0：单一锚（例 1，前提已破坏）；本轮：**双锚**——例 1b 锁 500 占位字节面 + `onRejection` 转发契约，例 2 锁端到端真实 rejection 事件面；两锚 seam 互不依赖，任一回归独立转红 | ✅ 严格更强 |
| mapped/unmapped 分界 | 例 1（mapped 4xx ⇒ 0 事件）× 例 1b/例 2（unmapped rejection ⇒ 恰一次事件 + 500）双向锁死 D8 语义分界——本轮新增的正向保护 | ✅ 增强 |
| 触发器诚实性 | 无 skip/only/todo/env override（本轮独立复跑 grep 零命中）；无源码字符串断言；无假绿路径（repro 红 → 修复绿因果闭环） | ✅ |

## 4. 文件范围（scope）与卫生

- **ALLOW 命中**：`apps/yjs-server/test/rest-hosting-behavior.test.ts` 为设计 §11 行 7 既有条目
  的**原位修改**（+126/−23，终态 233 行），非新增路径——正是 SA9 §2.4 / SA10 §6 明示的修复面；
  与 DENY glob（`issue270-*` 冻结命名）零相交。两份 wiki 报告为管线固定产物位原位更新。✅
- **DENY 零触碰（本轮独立复核 `git show --name-only`）**：`packages/**`、`docs/**`、
  `apps/yjs-server/src/{main,index}.ts`、`vitest.config.ts`、根 `package.json`、`.github/**`
  均零条目。✅
- **探针零残留**：`apps/yjs-server/test/` 目录枚举无 `*prerebase*` 文件（本轮亲查）；app 套件
  收集 33 个 `*.test.ts` 与 SA6 §14 口径一致（30 非本票 + 2 契约 + 1 行为）。✅
- **无触发面操纵**：vitest 配置、CI 分片、根脚本不在 diff；commit message
  （`test(server): align REST behavior with parent validation`）准确描述改动面。✅

## 5. 其余 standards 面延续核验（生产零改动 ⇒ iteration 0 §3–§8 合规结论全部延续）

- 模块责任/包边界、ADR 0015/0012/0009/0010/0011 保真、D1–D7 设计忠实度、单一事实源、生命周期
  对称性、平行机制检查：生产与冻结面零字节改动，iteration 0 逐项合规结论原样延续。✅
- SA8 recheck 5 条重开条件零触发（`packages/*` 零 diff；零配置键；drain 仍在
  `registry.shutdown()` 前；Registry 仅经 app face 暴露；503/500 仍为 transport 占位——例 1b
  只断言 status/CT/非空，未把占位固化为终态契约形状）。✅
- 测试对冻结 fixture 的消费保持只读（`waitUntil` 为既有导出，support 文件哈希不变）。✅

## 6. MINOR / 观察项（均不阻断）

| # | 级别 | 发现 | 状态 |
|---|---|---|---|
| S9-2 | MINOR | 设计 §2-C5/§7-D8/§12 例 1「骨架不产生 HTTP 错误 Response」前提文本对最终基线 `209b046` 仍为假（本轮复核 design L58/L282/L415/L441 原文未改）。SA3 按技能边界不修改 SA1 设计文件，已于其报告 §Deviations 1 正式登记；SA4 §12 O-G 承接并给出 routing: design。文档侧残余归属设计所有者修订轮，PR 披露面由 SA10 P-2 跟踪 | **仍开**，routing 明确，不阻断 |
| S9-3 | OBS | AGENTS.md/`rest-hosting.ts`「待 FR-3 收敛」措辞语境位移（#268 已落 problem 机制；占位服务剩余 rejection 族仍成立）——生产/文档本轮零改动 | 维持备案 |
| S9-4 | OBS | `ws-server.ts:5` 头注「回落下面的 /healthz+404」措辞 nit——本轮零改动 | 维持备案 |
| S9-5 | OBS | `drainPromise ??=` 首预算缓存——本轮未新增第二生产调用点（例 1b 的 drain 作用于独立 hosting 实例） | 维持备案 |
| S9-6 | OBS | 证据形式 nit：两份 typecheck log 未记录显式 exit code（空输出/链命令罗列依赖 tsc 静默成功语义）——已被四次 vitest `--typecheck`「Type Errors no errors」充分 corroborate，仅建议后续轮在 log 中追加 `echo exit=$?` | 新增备案 |
| S9-7 | OBS | 承接 SA4 O-F：例 1b `toEqual([rejection])` 为结构等价而非引用恒等（`observed[0] === rejection` 略强）——恰一次 + 内容相符 + 与所抛对象不可区分已充分锚定转发契约 | 新增备案 |

## 7. 结论

修复提交 `a1cbe53` 以**最小且正确的作用面**（单测试文件原位修改 + 证据/报告对齐，生产与冻结
契约零字节）精确执行了 SA9 S9-1 与 SA10 B-1 给出的修订方向：例 1 对齐 #268 父契约并与源码
逐点对拍一致，D8 rejection 覆盖重定向到两个在新基线下仍以 rejection 结算的独立驱动锚
（bridge 级 500 占位字节面 + 端到端真实 rejection 事件面），红→绿因果链以旧字节探针复现闭环，
全部验证证据在最终 rebased 基线之上按当前提交字节重新捕获（测试文件 sha256 指纹独立复算一致）。
交付未被削弱——断言删除面为零、D8 锚点由一升二、mapped/unmapped 事件分界被双向锁死。

iteration 0 的 MAJOR 已消除；残余 S9-2（MINOR，设计前提注记，routing: design）与五条 OBS
均不阻断。按「BLOCKER/MAJOR 必须 reject，MINOR 不阻断 approve」：**approve**。

**Verdict: approve**（`requiresConflictRecheck: false`）。

## 8. 交付物

- 本文件：`wiki/raw/task_issue-270_sa9_standards.md`（原位更新为 iteration 1）。
- 结构化结果：`verdict = approve`，`requiresConflictRecheck = false`，artifactPaths 见 tool call。

—— SA9 standards-review · iteration 1（修复轮复审） · 2026-09-11

# SA4 实现红队审查 — issue #270：Server 集成验收（REST 与 WebSocket 共享 Registry + 有序停止）

> 阶段：implementation-review（**iteration 1 —— rebase 后修复轮静态审查**）。Dispatch：
> `sa-41cbf9bf-d7a4-4bd9-b818-a9207279e4b3`（mabf-sa4）。
> 技能：`exploit-vulnerability` 已加载并按本报告执行（只读源码/diff/测试/日志；未修改实现、
> 未运行测试、未启动服务；唯一写入 = 本文件原位更新）。
> 被审对象：SA3 修复轮（worktree `nomicore-fix-issue-270`，branch `mabf/issue-270`，
> **HEAD `8e550d4`（父 = `209b046`，即 #268「validate REST namespace creation (#297)」——本轮
> git 亲证）之上的未提交工作树改动**：`apps/yjs-server/test/rest-hosting-behavior.test.ts`
> （233 行，sha256 `b3041b1f…75f31`，与 SA3 报告指纹一致）+ 本报告所述 wiki 证据）。
> 触发背景：iteration 0 的 SA4 `approve` 采集于 rebase 前旧基线 `0b06050`；SA9 standards
> （S9-1 MAJOR / S9-2 MINOR，`reject`）与 SA10 spec（B-1 BLOCKER / P-1–P-4，`reject`）在最终
> rebased 提交上同点位识别：#268 后畸形 JSON 由 router 映射为 matched `400 MALFORMED_JSON`
> problem Response，行为测试例 1 断言的「500 + `rest-request-failed` 恰一次」确定性假红。
> Issue comments 派遣前 REST 快照 = `[]`——无 Owner 追加要求。

## 1. Reviewed inputs

| 输入 | 位置 | 状态 |
|---|---|---|
| 任务简报（Issue #270 body；comments `[]`） | `wiki/raw/task_issue-270.md` | 已读；AC1–AC4 为验收口径 |
| SA1 设计（iteration 1） | `wiki/raw/task_issue-270_design.md` | 已读（iteration 0 全文）；§7-D1–D8/§8/§11/§12 为基准；**其 §2-C5/§7-D8/§12 例 1 前提对最终基线已过时（见 §12 O-G，routing: design）** |
| SA2 设计评审 | `wiki/raw/task_issue-270_sa2_review.md` | 已读；F1–F4/O1/O7/O8 状态延续核对 |
| **SA3 修复轮实现报告（本轮被审主报告）** | `wiki/raw/task_issue-270_sa3_impl.md`（工作树修改版） | 已读全文；其「本轮修复映射」「File scope check」「Verification」逐项独立复核 |
| **SA9 standards-review（reject 输入）** | `wiki/raw/task_issue-270_sa9_standards.md` | 已读全文；S9-1（MAJOR）事实链、S9-2–S9-5 |
| **SA10 spec-review（reject 输入）** | `wiki/raw/task_issue-270_sa10_spec.md` | 已读全文；B-1（BLOCKER）事实链、P-1–P-4、§6 修订方向、§7 重验要求 |
| SA6 验收契约（冻结） | `wiki/raw/task_issue-270_sa6_contract.md` | §13.4 冻结哈希基准（iteration 0 全文读过） |
| SA8 门禁 + 复审 | `task_issue-270_sa8_gate.md`、`task_issue-270_sa8_recheck.md` | A1–A3、R1/R2、5 条重开条件（iteration 0 读过，本轮按 0 触达复核） |
| SA3 修复轮验证证据（6 份新 log） | `task_issue-270_sa3_repair_{repro,behavior,contract,typecheck,root-typecheck,app-suite}.log` | 已读关键面：修复前复现红（1 failed \| 3 passed，`expected 400 to be 500`，实际 body `{"code":"MALFORMED_JSON","message":"JSON 解析失败"}`，Start 10:24:43）；行为 5/5 ×2（10:23:09/10:23:21）；契约 3 文件 12/12 + Type Errors none（10:23:44）；app typecheck 空输出；根 typecheck 14 包+app 无错误输出；全 app 套件 33 文件/174 例 + Type Errors none（10:24:57，427.70s，含 `hub-restart-static-target-red` 绿） |
| 实际 diff（只读 git） | `git diff`（test 文件 +126/−23）+ `git status --short` + `git log --format='%H %P'` | 逐 hunk亲读：仅例 1 重写、例 1b 新增、例 2 追加断言与更名、头注更新；**例 3/例 4 零 hunk（字节不变）**；tracked 改动 = 测试文件 + SA3 报告两处 |
| 生产/契约源码锚点 | `apps/yjs-server/src/{app,rest-hosting}.ts`、`src/transport/ws-server.ts`、`packages/namespace-api/src/{rest,create-namespace,rest-problem}.ts`、`apps/yjs-server/test/issue270-contract-support.ts` | 逐锚点核对（见 §4/§7/§9） |
| 冻结契约三文件 | `apps/yjs-server/test/issue270-*.ts` | **本轮独立复算 sha256**：`5cea9d4e…`/`06e0bfe3…`/`2060e130…` 与 SA6 §13.4 逐字节一致（零改动） |

## 2. Verdict

**`approve`** —— SA3 修复轮精确闭合 SA9 S9-1 / SA10 B-1 的全部要求，且未引入任何新的
BLOCKER/MAJOR：

- **父 400 契约兑现**：例 1 重写为 #268 后父契约断言（`400` + `application/json` +
  `code === 'MALFORMED_JSON'` + 非空 `message` + 无 `issues` + `rest-request-failed` **0** 次
  + 后续合法 create 201 存活断言）——与父源码行为逐点对拍一致（§4 D8 行）；修复前复现 log
  证明旧字节在最终基线上确实红（`expected 400 to be 500`），修复后 5/5 绿 ×2。
- **独立 500/rejection 锚保留且强化**：D8 覆盖重定向到**两个互不依赖的锚**——例 1b
  （bridge 级：真实 `http.createServer` + 真实 TCP + 生产 `createRestHosting` 未被 mock，
  仅其声明依赖 `RestRouter` 为 rejecting 替身 → 500 `text/plain` 非空占位 + `onRejection`
  恰一次 + 结算后 `drain` 即时返回）与例 2 追加（端到端：真实组合根上 drain abort → 真实
  router 流错误 rejection → sink `rest-request-failed` 恰一次含非空 `message`）。相比
  iteration 0 的单一合流锚，覆盖严格更强。
- **AC1–AC4 与全部冻结保证原样保全**：生产源码（`app.ts`/`rest-hosting.ts`/
  `ws-server.ts`/`package.json`/lockfile/AGENTS.md）与冻结契约三文件**零字节改动**（哈希独立
  复算）；T1-A/T1-B（Registry 身份）、T2/N3（routing）、T3/N2（有序停止）、N1（WS 独立）在
  最终基线上重跑 12/12 绿 + 全 app 套件 33 文件/174 例绿。
- **证据新鲜度修复**：全部证据（行为 ×2、契约、双 typecheck、全 app 套件）采集于最终
  rebased 基线之上的当前工作树字节（时间线 10:23–10:32，晚于 10:02:51 的提交；测试计数
  173→174 与「+例 1b」算术一致；行为 log 中例 2 新名「D4 + D8 端到端」与当前文件逐字一致）。
- **范围最小**：tracked 改动仅 `rest-hosting-behavior.test.ts`（§11 ALLOW 行 7 条目内原位
  修改——两份最终评审明示的修复面）+ 技能固定 wiki 产物；临时探针零残留
  （`ls apps/yjs-server/test | grep -ci prerebase` = 0；`*.test.ts` 计数 33 与 SA6 §14 口径一致）。

`requiresConflictRecheck: false` —— 测试对齐未触碰任何生产面；SA8 recheck 5 条重开条件
零触发（`packages/*` 零 diff、零配置键、drain 仍在 `registry.shutdown()` 前、Registry 仅经
app face、503/500 仍为 transport 占位非终态契约）；SA9 对同点位已裁定非 ADR 冲突。

## 3. 上游要求落实（含两份 reject 评审的 finding 闭合）

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| **SA10 B-1（BLOCKER）/ SA9 S9-1（MAJOR）**：例 1 三断言与 #268 后父行为矛盾（400 vs 500、json vs text/plain、0 vs 1 事件）；修订方向 = 「改断言为 400 `MALFORMED_JSON` problem 契约 + D8 覆盖重定向到仍未映射的驱动」 | 例 1 重写（test L52–87）：status 400 / CT `application/json` / `problem.code === 'MALFORMED_JSON'` / `message` 非空 string / `issues` undefined / `rest-request-failed` 0 / 后续 create 201 且事件仍 0。D8 重定向：例 1b（L89–133，新）+ 例 2 追加（L160–172）。父行为逐点亲证：`create-namespace.ts:95-98`（`JSON.parse` catch → `createRestProblemFailure(400, MALFORMED_JSON)`）→ `L109-110`（`RestProblemFailure` → `problemResponse(status, payload)`）→ `rest-problem.ts:135-145`（恒 `application/json`；`issues` 仅存在时输出）——断言面与父契约零偏差 | ✓ 完全闭合（repro log 证明红→修复 log 5/5 绿 ×2） |
| **SA10 §7 / SA9 §2.2 证据新鲜度**：修订后须在新基座重跑契约三件套 + 行为用例 + 全 app 套件 + 根 typecheck | 6 份 `repair_*.log` 全部落盘且内部一致（§2）；修复前复现（旧字节探针，已删除）先行证明确定性红 | ✓ 闭合 |
| **SA10 P-1（PR 披露）**：例 1 确定性失败 + 证据失效 | 已随修复消除；PR 描述按 SA3 建议 commit message 口径披露即可 | ✓ 消除 |
| **SA10 P-2 / SA9 S9-2（设计前提失效，MINOR/注记级）**：设计 §2-C5/§7-D8/§12「骨架不产生 HTTP 错误 Response」对 `209b046` 为假 | SA3 按技能边界**不修改设计文件**，在报告 §Deviations 1 正式登记漂移 + 指明归属设计/SA6 修订轮；本报告 §12 O-G 承接并给出 routing | ✓ 已登记（注记本身仍待设计所有者回传——非本轮可实现项，见 §12） |
| Issue AC1：REST 与 WS 共享同一 `NamespaceRegistry` 引用 | 生产零改动（iteration 0 已核：`app.ts` 唯一赋值 + getter 委托 + 构造一次冻结）；冻结 T1-A/T1-B 重跑绿 | ✓ 保全 |
| Issue AC2：raw path 分流 | 生产零改动；冻结 T2/N3 + 行为例 4（零 hunk）重跑绿 | ✓ 保全 |
| Issue AC3：停止顺序（intake → 已接纳 → Lease/Session → Registry → Persistence） | 生产零改动；冻结 T3/N2 + 行为例 2（含追加断言）/例 3 重跑绿 | ✓ 保全 |
| Issue AC4：WS Module 不依赖 REST create | 生产零改动（`packages/ws-replication/**` 零 diff）；冻结 N1 绿 | ✓ 保全 |
| SA8 A1/A2/A3、SA2 F1–F4/O1/O7/O8 | 生产与冻结面零字节改动 ⇒ 状态全部延续；F4-(c) 复核：例 1b 只断言 `text/plain` + **非空** body，未固化 `internal error\n` 字面量 | ✓ 保全 |
| Observer 保证（A2 显式注入 + D8 可观测） | 生产零改动（`app.ts` 显式 no-op observer、构造期 TypeError fail-loud 保持）；例 2 端到端断言 sink 事件 + 例 1b 断言 `onRejection` 回调面——观测面双层锚定 | ✓ 保全 |

Owner 评论：无（`[]`）——无遗漏或被旧状态覆盖的要求。

## 4. 设计落实审查（本轮增量：D8 驱动面重校准；D1–D7 生产零改动延续 iteration 0 结论）

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| §7-D1–D7（seam/观测面/分流/停止语义/observer/role/导入） | 生产源码零字节改动（git status 亲证：`apps/yjs-server/src/**`、`packages/**` 零条目） | ✓ 延续 iteration 0 逐行结论 | — |
| §7-D8：rejection → `rest-request-failed` + 500 `text/plain` 占位，不静默 404 | 生产路径零改动（`rest-hosting.ts:100-105` catch → `notifyRejection(error)`（**同一 error 对象**传入回调）→ `writePlain(res, 500, 'internal error\n')`，CT `text/plain`、body 非空——与例 1b 断言逐点对拍）。行为锚按评审指示重定向：例 1b（bridge 字节面）+ 例 2 追加（端到端事件面） | ✓ 生产与锚均落实；**对设计 §12 例 1 字面的偏离系两份最终评审明示的修订方向**，已按技能要求登记（§12 O-G，routing: design） | O-G（MINOR，非阻断） |
| §12 例 1（原「畸形 JSON → 500」） | 重写为父契约透传断言（§3 首行）；**删除断言面为零**——原「进程存活 + 后续 201 + 事件计数不增」存活断言全部保留（事件期望值 1→0 系语义修正而非弱化：mapped 4xx 不触发 D8 本就是 #268 后的正确行为） | ✓ | — |
| §12 例 2/例 3/例 4 | 例 2 追加断言（只增不减）；例 3/例 4 零 hunk | ✓ | — |
| 例 1b 注入 seam 合法性 | `RestRouter` = 单方法接口 `{ handle(Request): Promise<RestHandledResult> }`（`rest.ts:77-80`），替身实现该声明依赖；被测对象 `createRestHosting`（`rest-hosting.ts:52-195`）为生产代码未被 mock；真实 `http.createServer` + 真实 TCP + 冻结 `httpRequest` 客户端（`agent:false` 独立连接，resolve-不-reject，transport 失败 → status 0）。SA10 §6 明示接受「rejecting router」类等价驱动；端到端可达性由例 2 闭合（SA3 报告「D8 rejection 覆盖为何需要两个 seam」边界声明与源码事实一致） | ✓ 合法且边界诚实 | — |

## 5. 架构一致性与惯例（本轮增量核验；生产零改动 ⇒ iteration 0 §5 结论全部延续）

- 责任归属/单一事实源/生命周期对称/平行机制：生产零字节改动，无新增面。✓
- 相似能力对照（新增一行）：例 1b 的「声明依赖替身 + 真实传输」测试形态与仓库既有
  contract/support 分层（fixture 复用 + 真实组合根）一致；替身只出现在被测组件的**注入参数**
  上，未出现「mock 被测对象」或源码字符串断言。✓
- 测试复用纪律：`waitUntil` 系冻结 `issue270-contract-support.ts` **既有导出**（L446，本轮
  grep 亲证）——修复未改冻结文件分毫即获得有界轮询原语；`httpRequest`/`openAdmittedRequest`/
  `createRecordingSink` 同为既有导出。✓

## 6. 文件范围审查

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `apps/yjs-server/test/rest-hosting-behavior.test.ts`（修改，+126/−23，终态 233 行） | 设计 §11 行 7（该文件本身即条目；本轮为条目内原位修改——SA9 §2.4/SA10 §6 明示的修复面） | 父契约对齐 + D8 双锚重定向 | ✓ 与 DENY glob 零相交；指纹（233 行 / `b3041b1f…75f31`）与 SA3 报告一致 |
| `wiki/raw/task_issue-270_sa3_impl.md`（修改） | 技能固定产物 | 修复轮报告原位更新 | ✓ |
| `wiki/raw/task_issue-270_sa3_repair_*.log`（6 份，未跟踪） | 技能固定产物（证据） | 原始命令输出 | ✓ |
| 其余未跟踪 `wiki/raw/*`（SA9/SA10 报告、SA6/旧 SA3 log、简报） | 管线固定产物位 | 评审/证据档案 | ✓ 非业务改动 |

- **DENY 面零触碰（本轮独立复核 `git status --short`）**：`packages/**`、`docs/**`、
  `apps/yjs-server/src/main.ts`、`src/index.ts`、`vitest.config.ts`、根 `package.json` 均
  零条目；生产源码整体零 diff。
- 冻结契约三文件 sha256 本轮复算 = SA6 §13.4 逐字节一致。
- 临时探针 `rest-hosting-prerebase-repro.test.ts` 零残留（grep 计数 0；`*.test.ts` 总数 33
  = SA6 §14 口径 30 非本票 + 2 契约测试 + 1 行为测试）。无触发面操纵、无 skip/only/todo/
  env override（本轮独立复跑 grep，exit 1 零命中）。

## 7. 契约连锁审查（本轮增量：测试新增消费面）

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| 冻结 `issue270-contract-support.ts` 导出面（`waitUntil`/`httpRequest` 等） | 修复后的行为测试（新增 `waitUntil` 导入） | 只读导入，零修改（哈希一致）；`waitUntil` 默认 10s 有界预算 + 10ms 轮询，超时 throw（诚实失败非静默通过） | 无 | — |
| `createRestHosting` 公共导出（`apps/yjs-server/src/rest-hosting.ts`） | 例 1b 直接构造 | 生产 API `{restRouter, isStopping, onRejection}` 与测试用法逐成员对拍（L25-31 vs test L99-105）；`handle(req,res): void` 与 `http.createServer` handler 签名相容 | 无 | — |
| `RestRouter`/`RestHandledResult` 包根类型导出 | 例 1b type-only 导入 | `rest.ts:77-84` 既有公共类型；行为/契约 log `--typecheck` 双绿证明可解析 | 无 | — |
| 父契约 `400 MALFORMED_JSON` problem 形状 | 例 1 断言面 | `create-namespace.ts:95-110` + `rest-problem.ts:27/66/91-96/135-145`：code/message 恒在、`issues` 仅 422、CT 恒 `application/json`——断言与父契约零偏差且留有合理余量（message 只断言类型+非空，不固化中文文案） | 无 | — |
| `rest-hosting` matched Response 写回 | 例 1（400 透传） | `dispatch` matched 分支原样写回 status/headers/bytes（`rest-hosting.ts:116-124`）——透传断言与实现语义一致 | 无 | — |
| 生产实现其余契约面（`NomicoreApp.registry`、adapter 可选参、sink 开放事件面等） | iteration 0 §7 全表 | 生产零改动 + 全 app 套件 33/174 绿 | 无 | — |

## 8. 错误、恢复与并发（本轮增量行；其余延续 iteration 0 §8）

| 检查点 | 结论 | 证据 |
|---|---|---|
| mapped 4xx 不触发 D8（新基线关键分界） | ✓ 例 1 断言事件 0 + 后续 201 后仍 0——「已映射结局不产生失败观测」的分界被锁死，反向漂移（4xx 误发事件）必红 | test L73-81 + 行为 log 绿 |
| rejection 观测恰一次且非空 | ✓ 例 1b `onRejection` 收到恰一次（结构等于所抛 rejection）；例 2 端到端 sink 恰一次 + `message` 非空 string | test L119-122/L166-172 |
| 500 占位诚实收口 | ✓ status 500 + `text/plain` + 非空 body；未固化字面量（F4-(c) 保持） | test L113-118 |
| in-flight 记账无泄漏 | ✓ 例 1b：结算后 `drain(10_000)` < 1s 返回（`runDrain` 空快照即时返回路径被真实驱动） | test L124-127 + `rest-hosting.ts:151-153` |
| abort → 流错误 rejection → 事件的异步窗口 | ✓ 例 2 以冻结 `waitUntil`（10s 预算）有界吸收，超时即诚实失败；恰一次断言防重复观测 | test L160-169 + contract-support L446-458 |
| 观测回调 throw 隔离 / 迟到结算 no-op / 幂等 drain / boot 窗口守卫 | 生产零改动 ⇒ 延续 iteration 0 逐行结论；例 3 零 hunk 重跑绿 | §4 + 行为 log |

## 9. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| 例 1（父契约透传，重写） | 400 + `application/json` + `MALFORMED_JSON` + message 非空 + 无 `issues` + 事件 0 + 后续 201 存活 + 事件仍 0 | 根 vitest include + CI 分片；行为 log（5/5 ×2）+ 契约 log + app-suite 三重实跑命中 | 无（断言面 = 父契约 + 存活纪律，零源码字符串） | — |
| 例 1b（D8 bridge 级，新增） | 500 + `text/plain` + 非空 body + `onRejection` 恰一次 + 结算后 drain <1s | 同上（log 中 5 tests 含此例） | `toEqual([rejection])` 为结构等价而非引用恒等（标题称「同一 rejection 对象」）——转发语义（恰一次 + 内容相符）已充分锚定，见 O-F | O-F（MINOR） |
| 例 2（D4 + D8 端到端，追加） | 原 D4 断言全保留（有界 ≥5s/<15s、status 0、transportError、`app-stopped` 恰一次、无 `app-stop-failed`、`replication-drained` ≥0）+ 新增 sink `rest-request-failed` 恰一次 + message 非空 | 同上（实测 10 017ms，per-test timeout 20s） | 无（只增不减） | — |
| 例 3（F2）/ 例 4（O1） | 零 hunk 字节不变 | 同上 | 无 | — |
| 冻结契约三文件（T1-A/T1-B/T2/T3 + N1/N2/N3） | sha256 逐字节一致；新基座重跑 12/12 绿（SA10 §3 逐例静态兼容结论 + 实跑双重印证） | 真实入口 + `--typecheck` | 无 | — |
| 触发与卫生 | `grep -E '\.(only\|skip\|todo)\(\|process\.env'` 零命中（本轮独立复跑）；无探针残留；app 套件 33 文件全收集 | `vitest run apps/yjs-server/test`（AGENTS 门）实跑绿 | 无 | — |
| typecheck | app `tsc -p`（空输出）+ 根 `pnpm typecheck`（14 包+app）双 exit 0 | 真实入口 | 无 | — |
| 红灯→转绿连续性 | 修复前复现 log（旧字节探针）证明例 1 在最终基线确定性红；修复后同基线 5/5——因果链闭环且探针已清除 | repro log + behavior log | 无伪绿路径 | — |

## 10. Required revisions

**无 BLOCKER / MAJOR / MINOR 阻断项。**

（SA9 S9-1 / SA10 B-1 已由本轮修复闭合；其文档侧残余 S9-2/P-2 归属设计所有者修订轮，
以 §12 O-G 登记 + routing: design 承接，非本轮可实现项、不阻断验收。）

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| 根 `pnpm test` 全仓套件（SA3 显式 defer；本轮 tracked 改动仅 app 测试文件，deny 零触达） | 根 vitest（含 packages/domains） | 全绿 | 任何 packages/domains 用例因本票转红 |
| #229 `hub-restart-static-target-red` 时序 flake（SA6 §14 三角口径） | 全 app 套件复跑（本轮通过，18 730ms） | 单独绿 / 全量绿 | 仅与本票文件同批红且 3/3 复现 |
| 例 2 `waitUntil`（10s 预算）在高负载 CI 下的 abort→事件窗口余量 | 分片 CI 复跑行为文件 | 事件在预算内到达 | 偶发 waitUntil 超时（则按 flake 口径调预算，非正确性缺陷——事件缺失时测试诚实失败） |
| 例 1b 若未来 `RestRouter` 接口加成员，替身需同步（结构性替身的常规维护成本） | 后续 FR-3/FR-4 票改 `RestRouter` | typecheck 即时暴露缺口 | 替身漂移导致假绿（当前 typecheck 门在 vitest `--typecheck` + 双 tsc 入口内，可检测） |
| 设计 §2-C5/§7-D8/§12 例 1 前提注记未落文档（O-G） | 设计所有者修订轮 | 设计文本与 `209b046` 基线一致化 | 后续票按过时前提再派生测试/实现 |

## 12. Non-blocking observations

- **O-F（新，MINOR）**：例 1b `expect(observed).toEqual([rejection])` 是结构等价（Error 按
  message/name 比较），标题所述「同一 rejection 对象」的引用恒等未被逐字断言
  （`toBe(rejection)` 或 `observed[0] === rejection` 略强）。转发契约（恰一次 + 内容相符 +
  与所抛 rejection 无法区分）已充分锚定，不阻断；后续 FR 票顺手收紧即可。
- **O-G（承接 S9-2/P-2，routing: design）**：设计 §2-C5/§7-D8/§12 例 1 与 iteration 0 SA4
  D8/§9 行的「骨架 router 不产生 HTTP 错误 Response」前提对最终基线 `209b046` 为假（4xx/422
  族已 mapped）。SA3 已按边界在报告 §Deviations 1 登记、未擅改设计；设计注记归属 SA1/SA6
  修订轮，PR 须按 SA10 P-2 披露。本修复对其零依赖（测试锚已按父契约现实重建）。
- **O-H（新，OBS）**：例 2 新增端到端断言复用冻结 `waitUntil` 原语（10s 默认预算）——与
  冻结测试同款纪律，预算敏感度已在 §11 登记。
- **O-A..O-E（iteration 0 观察项状态更新）**：O-A（根套件 defer）延续；O-B（/healthz+404
  受控复刻，双侧 N3/T2 + 例 4 锁死）延续，S9-4 注释 nit 维持备案；O-C（例 2 下界与预算耦合）
  延续；O-D（自致 abort 计一次失败观测）本轮被例 2 显式转为**正向断言面**（恰一次 + 非空
  message）——由备案升级为受控行为；O-E（drain 首预算缓存）延续，例 1b 未新增第二预算调用点。

## 13. 结论

SA3 修复轮以最小改动面（单测试文件 + 证据）精确执行两份最终评审给出的修订方向：例 1 对齐
#268 父契约（400 `MALFORMED_JSON` problem 原样透传、零 D8 事件、存活纪律保留），D8 rejection
覆盖重定向为互不依赖的双锚（例 1b bridge 级 500 占位字节面 + 例 2 端到端真实 rejection 事件面），
例 3/例 4 与冻结契约三文件零字节改动，生产实现零触碰；全部验证证据（修复前确定性红复现、
行为 5/5 ×2、契约 12/12、双 typecheck、全 app 套件 33/174）采集于最终 rebased 基线之上的当前
字节。SA9 S9-1 与 SA10 B-1 的 reject 理由全部消除，AC1–AC4、Registry 身份、routing、有序停止与
observer 保证经冻结断言 + 行为双面重验。**verdict：`approve`**（O-F/O-G 等 MINOR 观察不阻断，
O-G 已给出 design routing）；`requiresConflictRecheck: false`。

—— SA4 implementation-review · iteration 1（修复轮） · 2026-09-11

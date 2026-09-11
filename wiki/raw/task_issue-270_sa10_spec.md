# SA10 Spec 审查报告 — issue #270：Server 集成验收（REST 与 WebSocket 共享 Registry + 有序停止）

> Phase：spec-review（**iteration 1 —— 修复轮复审**）。Dispatch：`sa-585c45cc-3063-46cf-9b01-7f8dc483ab08`（mabf-sa10）。
> **被审对象**：最终修复提交 = commit `a1cbe539542816004b4e7f188b2fdf493e2a743c`
> （`test(server): align REST behavior with parent validation`，3 文件，+382/−309：行为测试 1 文件
> +126/−23 + SA3/SA4 报告原位更新），branch `mabf/issue-270`，HEAD 即该提交。
> **基座同一性（本轮亲证）**：`git log` 亲证 `a1cbe53^` = `8e550d4`（iteration 0 被审的 rebase 后
> 实现提交）、`8e550d4^` = `209b0463890e5da33a497a845468f1f055ecec7b`（dispatch 指定的父 PR #158
> head，含 #297「validate REST namespace creation」）——修复叠加在批准的基座之上，未再 rebase。
> **Issue 评论输入**：REST 快照空 `[]`（dispatch 明示，派发前即时读取）——无 Owner 追加要求、
> 无评论 ID 锚定义务。验收口径 = 简报 AC1–AC4 + 批准设计（iteration 1）+ SA6 冻结契约。
> **审查方式（SA10 纪律）**：静态规范一致性判断——修复 diff 逐 hunk 亲读；父行为面
> （`create-namespace.ts`/`rest-problem.ts`/`request-body.ts`/`rest-hosting.ts`/`app.ts`）逐点亲读
> 对拍；冻结契约 3 文件 sha256 独立复算；测试文件指纹（233 行 / sha256）独立复算；SA3 修复轮
> 6 份证据日志亲读；SA4 iteration 1 报告全文亲读。**未运行测试、未启动服务、未改动任何
> 代码/设计/测试**；SA3 运行证据作为输入采信并核证其字节同一性（§7）。
> 通用架构风格与仓库规范归 SA9，本轮不重复审查。
> **结论：approve**——iteration 0 唯一 BLOCKER（B-1）按本报告 §6 给出的首选修订方向精确闭合：
> 例 1 改断言为 #297 冻结的 400 `MALFORMED_JSON` problem 契约（与父行为逐点对拍 + 实证锚定），
> D8 rejection 覆盖重定向到仍未映射的驱动（bridge 级 500 占位字节面 + drain abort 端到端事件面），
> 且全部验收证据已在最终提交字节上重跑转绿（§7）。AC1–AC4 生产实现零字节改动、冻结契约零字节
> 漂移，父行为被尊重、#270 要求被保全（§2/§3）。无 scope creep（§5）。

## 1. 审查输入（全部亲读）

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-270.md`（简报：AC1–AC4；Parent PR #158；comments `[]`） | 已读 |
| `wiki/raw/task_issue-270_sa6_contract.md`（SA6 `approve`；冻结 3 文件 + §13.4 哈希 + H1–H4 + M1–M6） | 已读（iteration 0 全文 422 行，本轮 §12/§13 复核） |
| `wiki/raw/task_issue-270_design.md`（SA1 iteration 1，D1–D8，§11 ALLOW/DENY、§12 验收映射、§13 FR-3 登记） | 已读（§12/§13 本轮重点复核） |
| **iteration 0 本报告（reject，B-1）** | 已读（作为被闭合对象逐条回核） |
| `wiki/raw/task_issue-270_sa3_impl.md`（iteration 1 修复轮报告）+ 6 份 `sa3_repair_*.log` | 已读全文 + 全部日志关键面 |
| `wiki/raw/task_issue-270_sa4_review.md`（iteration 1，verdict `approve`） | 已读（全文 198 行） |
| 修复 diff：`git diff 8e550d4..a1cbe53`（3 文件）逐 hunk；终态测试文件全文（233 行） | 已读 |
| 父行为面：`packages/namespace-api/src/{create-namespace,rest-problem,request-body}.ts`（#297 后状态） | 已读 |
| 集成面：`apps/yjs-server/src/{rest-hosting,app}.ts`（与 8e550d4 零 diff） | 已读关键段 |
| Git 证据：`git log`/`git diff --stat`/sha256/`git status --short`/测试目录盘点 | 已核 |

## 2. AC1–AC4 验收判定（对最终修复提交）

修复提交对生产实现**零字节改动**（`git diff 8e550d4..a1cbe53 --stat`：仅 1 测试文件 + 2 wiki
报告）——iteration 0 §2 对 AC1–AC4 的静态满足结论原样继承，且本轮新增最终基座上的实跑绿证：

| AC | 要求 | 状态（本轮复核） | 判定 |
|---|---|---|---|
| **AC1** | 集成测试证明 REST 与 WS Module 持有同一个 `NamespaceRegistry` 引用（不经 Cordis Context 查找、不运行时替换） | 生产零改动（`app.ts` bootHub 唯一赋值 + 构造一次冻结 + `registry` getter）；冻结断言 T1-A/T1-B 字节不变且在新基座重跑绿（repair-contract log 12/12） | **满足** |
| **AC2** | raw path 正确分流 REST 与 WebSocket route family | 生产零改动；冻结断言 T2/N3 + 行为例 4（零 hunk）重跑绿 | **满足** |
| **AC3** | 停止顺序：停 intake → 等已接纳工作 → 释放 Lease/Session → shutdown Registry 与 Persistence | 生产零改动；冻结断言 T3/N2 + 行为例 2（含追加断言，只增不减）/例 3 重跑绿 | **满足** |
| **AC4** | WebSocket Module 不依赖 REST create，仍直接使用 Registry/Lease/ReplicationSession | `packages/ws-replication/**` 零 diff；冻结锚 N1 重跑绿 | **满足** |

**AC 判定：4/4 满足——静态（生产零改动继承 iteration 0 逐行结论）+ 动态（冻结契约与行为套件
在最终提交字节上实跑全绿）双重闭合。**

## 3. 修复断言 vs 父行为（#158@209b046，含 #297）——逐点对拍

| 修复断言 | 父行为事实（本轮亲读源码 + 实证） | 判定 |
|---|---|---|
| 例 1：`malformed.status === 400` | `create-namespace.ts:94-99`：`JSON.parse` 失败 → `createRestProblemFailure(400, MALFORMED_JSON)`；L108-111 捕获 `RestProblemFailure` → `problemResponse(400, …)`（matched Response，非 rejection）。**实证**：repair-repro log 中旧字节在同一请求下实际返回 `400`，body `{"code":"MALFORMED_JSON","message":"JSON 解析失败"}` | ✓ |
| 例 1：`content-type` 含 `application/json` | `rest-problem.ts:143-146`：`problemResponse` 恒 `application/json` | ✓ |
| 例 1：`problem.code === 'MALFORMED_JSON'`、`message` 为非空 string、`issues` undefined | `rest-problem.ts:19-33/62-80/140-142`：400 payload = `{code, message}`；`issues` 仅 422 输出（`payload.issues !== undefined` 才写入）。断言不固化中文文案（只断言类型 + 非空）——留合理余量，不过度冻结父契约 | ✓ |
| 例 1：`rest-request-failed` **0** 次（含后续 201 后仍 0） | `rest-hosting.ts:97-115`：`{matched:true; response}` 走写回分支，`onRejection` 只在 rejection catch（L100-105）——mapped 4xx 零事件；「已映射结局不产生失败观测」的分界被锁死（反向漂移必红） | ✓ |
| 例 1：后续合法 create 仍 201（进程存活纪律） | 与冻结 T1-A/T2 同款 201 路径；repair-behavior log 实跑绿 | ✓ |
| 例 1b：rejecting router → `500` + `text/plain` + 非空 body | `rest-hosting.ts:101-104`：catch → `writePlain(res, 500, 'internal error\n')`（CT `text/plain`、body 15 bytes 非空）；未固化字面量（F4-(c) 保持） | ✓ |
| 例 1b：`onRejection` 恰一次收到所抛 rejection | `rest-hosting.ts:68-74/102`：`notifyRejection(error)` 把**同一 error 对象**传入回调（观测 throw 被隔离）；dispatch 单 catch ⇒ 恰一次 | ✓ |
| 例 1b：结算后 `drain(10_000)` <1s 返回 | `rest-hosting.ts:151-153`：空快照即时返回；响应写回后 `finally` 注销 in-flight（L186-188）——记账无泄漏 | ✓ |
| 例 2（追加）：drain abort → 真实 router rejection → sink `rest-request-failed` 恰一次 + 非空 `message` | `rest-hosting.ts:141-145` abort 销毁 socket → `request-body.ts:76-84` 挂起 `reader.read()` 以流错误 rejection（`aborted===false` ⇒ 原错误 rethrow，非 `RestProblemFailure`）→ `create-namespace.ts:112` rethrow → dispatch catch → `app.ts:327-332` 发射 `{event:'rest-request-failed', message: error.message\|String(error)}`（Node 流错误 message 非空）；冻结 `waitUntil`（10s 预算 + 10ms 步进，超时诚实失败）吸收异步窗口 | ✓ |
| 例 2 原 D4 断言（≥5s/<15s、status 0 + transportError、`app-stopped` 恰一次、无 `app-stop-failed`） | 全部保留（diff 亲证只增不减） | ✓ |
| 例 3（F2）/例 4（O1） | 零 hunk（diff 亲证；SA4 同口径核证） | ✓ |

**修复断言与父行为零偏差；D8（rejection → 500 `text/plain` 占位 + `rest-request-failed` 观测，
绝不静默 404）由两个互不依赖的锚覆盖——bridge 级字节面（例 1b，被测对象 `createRestHosting`
为生产代码未 mock，仅其声明依赖 `RestRouter` 为 rejecting 替身）+ 端到端事件面（例 2，真实组合根
上唯一仍可确定性驱动的 rejection 族：body 读取期流错误）。相比 iteration 0 的单一合流锚，覆盖
严格更强，且与本报告 iteration 0 §6 首选修订方向逐字吻合。**

## 4. Owner 评论映射

| Owner 输入 | 内容 | 落实 |
|---|---|---|
| Issue comments REST snapshot | **空 `[]`**（dispatch 明示，派发前即时读取） | 无 Owner 追加要求；验收口径 = 简报 AC1–AC4 + SA8 冻结条款（A1/A2/A3 生产零改动 ⇒ iteration 0 §4 保全结论原样延续；SA4 §3 同口径复核） |

## 5. 范围与 scope creep 核对

| 候选 | 判定 |
|---|---|
| 修复改动面 = `apps/yjs-server/test/rest-hosting-behavior.test.ts`（+126/−23）+ SA3/SA4 报告原位更新 | 测试文件即设计 §11 ALLOW 行 7 条目（条目内原位修改，两份最终评审明示的修复面）；DENY 面（`packages/**`、`docs/**`、`main.ts`、`index.ts`、`vitest.config.ts`、ADR）零条目（`git status --short` 本轮核证） | 无越界 |
| 冻结契约 3 文件 | sha256 本轮独立复算：`5cea9d4e…`/`06e0bfe3…`/`2060e130…` 与 SA6 §13.4 **逐字节一致**——无需 SA6 修订轮 | 零漂移 |
| 例 1b 新增（bridge 级 seam） | iteration 0 §6 明示接受的「等价驱动」方向；设计 §12 D8 行为面的合法落点（同文件 ALLOW 行内）；SA4 §4 裁 seam 合法且边界诚实 | 非 scope creep |
| 临时探针 `rest-hosting-prerebase-repro.test.ts` | 已删除：本轮 `ls apps/yjs-server/test/` 亲证无残留；`*.test.ts` 33 个 = SA6 §14 口径 30 + 2 契约 + 1 行为 | 零残留 |
| 卫生 | `grep -nE '\.(only\|skip\|todo)\(\|process\.env'` 对终态测试文件零命中（本轮独立复跑，exit 1） | 干净 |

**无 scope creep；ALLOW/DENY 零越界；冻结契约零漂移。**

## 6. iteration 0 阻断发现（B-1）闭合回核

| iteration 0 要求 | 本轮事实 | 判定 |
|---|---|---|
| 「或改断言为 #297 冻结的 400 `MALFORMED_JSON` problem 契约」 | 例 1 重写为 400 + `application/json` + code/message/issues 形状 + 事件 0 + 存活纪律（§3 逐点对拍 + repro log 实证） | ✓ 闭合 |
| 「并将 D8 的 rejection 覆盖重定向到仍未映射的驱动（如 admitted 请求 body 读取期 abort→`rest-request-failed` 事件可观测、无 HTTP Response）」 | 例 2 追加**正是该括注驱动**（drain abort → 流错误 rejection → sink 事件恰一次，客户端侧无 HTTP Response）；另加例 1b 在 bridge 级锚定 500 占位响应字节面 | ✓ 闭合（首选方向 + 补强） |
| 「修订后须以新基座重跑全量证据（§7）」 | 6 份 repair log 全部落盘：修复前确定性红复现 + 行为 5/5 ×2 + 契约三件套 + 行为 12/12（`--typecheck`）+ app tsc exit 0 + 根 `pnpm typecheck` exit 0 + 全 app 套件 33 文件/174 例绿（§7） | ✓ 闭合 |
| §2/§3 结论复审 | 生产零改动 ⇒ §2 AC 结论继承并获实跑印证；冻结契约哈希零漂移 ⇒ §3 结论继承 | ✓ 闭合 |

**无其他 BLOCKER/MAJOR。** MINOR/披露项见 §8。

## 7. 验证证据与时态有效性

- **本轮独立核证**：HEAD 父链 `a1cbe53 → 8e550d4 → 209b046`（`git log` 亲证）；修复 diff 仅 3 文件；
  终态测试文件 233 行 / sha256 `b3041b1f…75f31`（worktree 与 `git show HEAD:` 双源一致，与 SA3
  报告指纹相同）；冻结 3 文件 sha256 与 SA6 §13.4 逐字节一致；DENY 面零条目；探针零残留。
- **采信并核证字节同一性**：SA3 修复轮证据（6 份 log）采集于提交前工作树（行为 10:23:09/10:23:21、
  契约 10:23:44、repro 10:24:43、app 套件 10:24:57–10:32、双 typecheck），提交 `a1cbe53`（10:42:18）
  只封装同一字节——变更文件指纹双源一致 + 生产面全在 8e550d4 已提交 ⇒ 证据对最终提交有效。
  关键计数自洽：app 套件 173→174 例与「+例 1b」算术一致；log 中例 2 新名「D4 + D8 端到端」与
  终态文件逐字一致；repro log 实测 400 body 与例 1 断言面逐键一致（实证锚，非仅静态推导）。
- **红灯→转绿因果闭环**：修复前复现（旧字节探针，已删除）在最终基座确定性红
  （`expected 400 to be 500`）→ 修复后同基座 5/5 绿 ×2——B-1 的事实链与修复的因果链双闭。
- **全 app 套件**：33/33 文件、174/174 例、`Type Errors no errors`（427.70s）——含
  `hub-restart-static-target-red`（本轮未现 #229 flake）；既有面零回归。

## 8. PR 必须披露的未达成/延期项

| # | 披露项 | 性质 | 依据 |
|---|---|---|---|
| P-1 | ~~例 1 确定性失败 + 证据失效~~ | **已消除**（本轮闭合，见 §6/§7） | — |
| P-2 | 设计 §2-C5/§7-D8/§12 例 1 与 iteration 0 SA4 D8 行的「骨架契约：未映射结局以 rejection 结算」前提对基座 209b046 收窄（4xx/422 族已 mapped）。SA3 按技能边界未改设计文件，已在其报告 §Deviations 1 正式登记；SA4 O-G 承接并 routing: design——**设计注记仍待设计/契约所有者修订轮回传**，PR 须披露该文档漂移 | 设计注记级（不阻断） | SA3 §Deviations 1；SA4 §12 O-G |
| P-3 | 完整 REST 错误契约 503/500 族映射（FR-3）、observer 事件发射（FR-4）、FR-1 limits/`Request.signal`、peer REST listener、REST owner authorization、drain 预算可配置化、matched 早返回不消费 body 的 keep-alive 处置——维持设计内延期，本修复不改变其状态 | 设计内延期（本票 AC 不含） | 设计 §1/§13；SA4 §11 |
| P-4 | `#229` `hub-restart-static-target-red` 既有时序 flake 三角验证口径维持 SA6 §14（本轮全量绿）；例 2 `waitUntil` 10s 预算在高负载 CI 的余量监测（事件缺失时测试诚实失败，非静默通过） | 既有观察项 | SA6 §14；SA4 §11 |
| P-5 | SA4 O-F（MINOR）：例 1b `toEqual([rejection])` 为结构等价而非引用恒等（标题所称「同一 rejection 对象」）——转发契约（恰一次 + 内容相符）已充分锚定，后续 FR 票可顺手收紧为 `toBe` | MINOR（不阻断） | SA4 §12 O-F |

## 9. Verdict

**`approve`**

- iteration 0 reject 的唯一理由（B-1）已按本报告首选修订方向精确闭合：例 1 改断言为父契约
  （400 `MALFORMED_JSON` problem 原样透传、零 D8 事件、存活纪律保留），D8 rejection 覆盖
  重定向到仍未映射的驱动（例 1b bridge 级 500 占位字节面 + 例 2 drain abort 端到端事件面），
  删除断言面为零、覆盖严格更强。
- AC1–AC4 生产实现零字节改动、SA6 冻结契约三文件 sha256 零漂移，父 PR #158（@209b046，含
  #297）行为被尊重（断言与父契约逐点对拍 + repro log 实证锚定），#270 要求被保全；全部验收
  证据在最终提交字节上重跑转绿（12/12 + 5/5×2 + 174/174 + 双 typecheck exit 0）。
- 无 scope creep（ALLOW/DENY 零越界）；SA8 A1/A2/A3 与 recheck 5 条重开条件零触发（生产零
  触达）⇒ `requiresConflictRecheck: false`。
- 残余条目（P-2 设计注记、P-3 设计内延期、P-4 观察项、P-5 MINOR 严格度 nit）均为披露/注记级，
  按 SA10 纪律不阻断 approve；PR 描述须按 §8 逐条披露。

—— SA10 spec-review · iteration 1（修复轮复审） · 2026-09-11

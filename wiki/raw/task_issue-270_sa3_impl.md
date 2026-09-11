# SA3 Implementation Report — issue #270：Server 集成验收（REST 与 WebSocket 共享 Registry + 有序停止）

> 阶段：implementation（**iteration 1 —— rebase 后确定性失败修复轮**）。Dispatch：
> `sa-8f4da41a-4f5e-4ad3-b2f4-99716dd233f2`（mabf-sa3）。
> 触发：最终 rebase 提交 `8e550d4`（父 = `209b046`，即 #268「validate REST namespace creation
> (#297)」）使 SA3 自有行为测试**例 1** 的驱动前提失效——#268 后畸形 JSON 在 package 内被映射为
> matched `400 MALFORMED_JSON` problem Response，不再抵达 D8 rejection 路径；SA10 spec-review
> `B-1`（`reject`）与 SA9 standards `S9-1`（MAJOR，`reject`）同点位识别该确定性红，并一致裁定
> 修复面 = 测试/证据对齐（不动生产实现、不动冻结契约、不做架构改动）。
> 本轮动作：例 1 对齐**当前父契约**（matched 400 problem 原样透传），D8 rejection 覆盖重定向到
> 仍以 rejection 结算的驱动（bridge 级 rejecting router 锚定 500 占位响应的字节面；端到端
> drain abort 锚定真实 rejection → sink 事件），生产实现与 SA6 冻结契约**零字节改动**。
> 依据：SA1 设计（iteration 1）§7-D8/§11 ALLOW LIST/§12；SA6 §12/§13.4（冻结三文件哈希）；
> SA8 gate/recheck（A1–A3、R1/R2、5 条重开条件）；SA10 §6「所需修订」方向；SA9 §2.4「修复方向」。
> Issue comments REST 快照（dispatch 前）= `[]`——无 Owner 追加要求、无评论 ID 锚定义务。
> 基线：HEAD `8e550d4`（branch `mabf/issue-270` 未变）；工作树仅本报告所述测试文件被修改
> （**未 commit**）。

## Inputs consumed

| 输入 | 位置 | 用途 |
|---|---|---|
| 任务简报（Issue #270 body；comments `[]`） | `wiki/raw/task_issue-270.md` | AC1–AC4 口径 |
| SA1 设计（iteration 1） | `wiki/raw/task_issue-270_design.md` | §7-D1–D8、§8 装配序/停机状态机、§11 ALLOW/DENY、§12 行为测试面、§13 FR-3 登记 |
| SA2 设计评审 | `wiki/raw/task_issue-270_sa2_review.md` | F1–F4 闭合状态、O1/O7/O8 实现注记 |
| SA6 验收契约（冻结基线） | `wiki/raw/task_issue-270_sa6_contract.md`（§12.3 测试路径、§13.4 哈希、§14 runner） | 冻结契约边界与哈希基准 |
| SA8 前置门禁 + 设计后复审 | `wiki/raw/task_issue-270_sa8_gate.md`、`task_issue-270_sa8_recheck.md` | A1/A2/A3、R1/R2、5 条重开条件 |
| **SA10 spec-review（本轮触发输入）** | `wiki/raw/task_issue-270_sa10_spec.md`（§3 例 1 行、§6 B-1、§7 重验要求） | 失败事实链与修订方向 |
| **SA9 standards-review（本轮触发输入）** | `wiki/raw/task_issue-270_sa9_standards.md`（§2 S9-1、§2.3 影响面、§2.4 修复方向、§9 S9-2） | 失败事实链、影响面限定、设计前提失效登记 |
| SA4 动态评审 | `wiki/raw/task_issue-270_sa4_review.md` | D8/例 1 旧证据行（其基线 `0b06050`，已时态失效）；O-A..O-E |
| 现行源码/契约（只读） | `packages/namespace-api/src/{rest,create-namespace,request-body,rest-problem}.ts`、`apps/yjs-server/src/rest-hosting.ts`、`apps/yjs-server/src/app.ts`、`packages/namespace-registry/src/registry.ts` | 父契约事实：畸形 JSON → 400 `MALFORMED_JSON`；剩余 rejection 族（body 读取 abort、Registry fatal、503/500）与普通 create 的候选重试语义 |
| 冻结契约三文件（只读） | `apps/yjs-server/test/issue270-{contract-support,server-integration-red,regression-anchors}.ts` | sha256 逐字节核验（见 §Verification） |

## Existing worktree reconciliation

- 起始状态：HEAD `8e550d4`（rebase 后最终提交），`git status --short` 对 tracked 文件 clean
  （仅 `wiki/raw/*` 证据未跟踪）。
- **确定性失败复现（修复前，最终提交字节）**：以 `git show 8e550d4:…rest-hosting-behavior.test.ts`
  写入临时探针文件 `apps/yjs-server/test/rest-hosting-prerebase-repro.test.ts` 实跑 →
  `Tests 1 failed | 3 passed (4)`，例 1 断言 `expected 400 to be 500`，实际 body
  `{"code":"MALFORMED_JSON","message":"JSON 解析失败"}`（原始输出
  `wiki/raw/task_issue-270_sa3_repair_repro.log`）。探针文件已删除（零残留，见 §File scope check）。
- 生产实现（`app.ts`/`rest-hosting.ts`/`transport/ws-server.ts`/`package.json`/`pnpm-lock.yaml`/
  `AGENTS.md`）与 SA6 冻结契约三文件在本轮**零字节改动**（哈希复核见 §Verification）；SA9 §2.3 /
  SA10 §2 已静态确认生产实现对 #268 后 router 的集成正确——缺陷仅在非冻结行为测试的驱动选择。
- 报告原位更新：上一版描述 iteration 0（基线 `0b06050`）的实施与绿色证据；本版只描述**当前**
  实现状态（生产面与 iteration 0 相同、未改）与**当前**验证结果；旧日志
  `task_issue-270_sa3_{contract,app-suite,typecheck,root-typecheck}.log` 为 rebase 前基线产物，
  已被本轮 `task_issue-270_sa3_repair_*.log` 取代（未删除，仅标注时态失效）。

## Changed paths

| Path | Design section | Change |
|---|---|---|
| `apps/yjs-server/test/rest-hosting-behavior.test.ts` | §11 ALLOW 行 7（同一文件）、§12 行为测试面 | **例 1 重写**为当前父契约面：#268 后畸形 JSON → `400` `application/json` `MALFORMED_JSON` problem（无 `issues`）原样透传，`rest-request-failed` **0** 次，后续合法 create 仍 201；**新增例 1b**（bridge 级 D8 rejection 契约）：`createRestHosting` + rejecting router → 客户端 `500 text/plain` 非空占位、`onRejection` 收到同一 rejection 恰一次、结算后 `drain` 无残留工作即时返回；**例 2 追加** D8 端到端断言：drain abort 使挂起 body 读取以流错误结算 → 真实 router rejection 经 sink `rest-request-failed` 恰一次（含非空 `message`）；例 3（F2）/例 4（O1）未改 |
| `wiki/raw/task_issue-270_sa3_impl.md`（本文件） | 技能固定产物 | 原位更新为修复轮报告 |
| `wiki/raw/task_issue-270_sa3_repair-behavior.log` | 技能固定产物（证据） | 修订后行为套件 2 次复跑原始输出 |
| `wiki/raw/task_issue-270_sa3_repair-contract.log` | 技能固定产物（证据） | 冻结契约三件套 + 行为套件 `--typecheck` 原始输出 |
| `wiki/raw/task_issue-270_sa3_repair_repro.log` | 技能固定产物（证据） | 修复前最终提交字节的确定性红复现原始输出 |
| `wiki/raw/task_issue-270_sa3_repair_typecheck.log` / `_root-typecheck.log` / `_app-suite.log` | 技能固定产物（证据） | app typecheck / 根 typecheck、全 app 套件原始输出 |

**生产源码零改动**：本轮不修改任何 `apps/yjs-server/src/**`、`packages/**`、`docs/**`、
`apps/yjs-server/AGENTS.md`、`package.json`/lockfile —— 修复完全落在测试与证据面。

## SA2 Finding 落实（F1–F4 / O 项：状态延续 + 本轮影响）

| Finding ID | 实现状态（未变） | 本轮证据 |
|---|---|---|
| **F1** 停机次序文档失真 | 实现严格按 §8 执行序；`AGENTS.md` 同款措辞 | 例 2/例 3 事件链断言保持绿（§Verification） |
| **F2** boot 窗口停机未防护 | `restHost?.drain` optional 守卫 | 例 3 保持绿 |
| **F3** 行为测试无 ALLOW 落点 | 四例（现五例）全部落位 `rest-hosting-behavior.test.ts`（非 `issue270-*` 命名） | 本轮修改仍在该 ALLOW 行内，DENY glob 零相交 |
| **F4** 503/500 表面收敛未登记 | 503/500 = transport 占位；测试不固化 body 形状 | 例 1b 只断言 `text/plain` + **非空** body，不断言 `internal error\n` 字面量（F4-(c) 保持） |
| O1（回落精确匹配）/ O7（例 2 超时预算）/ O8（方法引用传递） | 落实 | 例 4 / 例 2 `it(..., 20_000)` 保持 |

### 本轮修复映射（两份最终评审的 finding → 动作）

| Finding | 评审要求 | 本轮动作 | 结果 |
|---|---|---|---|
| **SA10 B-1（BLOCKER）** | 「或改断言为 #297 冻结的 400 `MALFORMED_JSON` problem 契约，并将 D8 的 rejection 覆盖重定向到仍未映射的驱动」「修订后须以新基座重跑全量证据」 | 例 1 重写为 400 problem 契约断言；D8 覆盖重定向到 rejecting router（500 占位字节面）＋ drain abort（端到端事件面）；新基座全量重跑（§Verification） | 例 1 转绿；D8 无覆盖缺口；证据全部为本提交字节 |
| **SA9 S9-1（MAJOR）** | 「例 1 须改用在新基线下仍抵达 D8 rejection 的触发器，并把断言对齐到新基线行为」 | 同上 | 同上；另登记 S9-2（设计前提注记）为上游遗留，见 §Deviations |
| SA10 P-2 / SA9 S9-2（设计前提失效） | 设计 §2-C5/§7-D8/§12 与 SA4 D8 行的「骨架不产生 HTTP 错误 Response」对最终基线为假 | **SA3 不修改设计/契约文件**（技能：范围外不得改设计；冻结契约须走 SA6 修订轮）。以本报告登记该事实漂移，供设计/契约所有者注记 | 已登记（§Deviations 1） |
| SA10 §7 / SA9 证据新鲜度 | 修订后须在新基座重跑：契约三件套 + 行为用例 + 全 app 套件 + 根 typecheck | 全部重跑并落盘原始日志 | 全绿（12/12 + 174/174 + 双 typecheck exit 0） |

## File scope check

| Changed path | ALLOW entry | Purpose |
|---|---|---|
| `apps/yjs-server/test/rest-hosting-behavior.test.ts` | §11 ALLOW 行 7（既有条目，本轮为**修改**而非新增路径） | 父契约对齐 + D8 rejection 覆盖重定向 |
| `wiki/raw/task_issue-270_sa3_impl.md` | 技能固定产物（实现报告） | 原位更新 |
| `wiki/raw/task_issue-270_sa3_repair_*.log`（5 份） | 技能固定产物（验证证据） | 原始命令输出 |

- DENY 面核验：`packages/**`、`docs/**`、`apps/yjs-server/src/main.ts`、`src/index.ts`、
  `vitest.config.ts` 零条目；`apps/yjs-server/test/issue270-*.ts` 冻结三文件 sha256 与 SA6 §13.4
  **逐字节一致**（本轮复算，见 §Verification）。
- 临时探针 `apps/yjs-server/test/rest-hosting-prerebase-repro.test.ts`（复现用）已删除：
  `ls apps/yjs-server/test | grep -i prerebase` 零命中；当前 app 套件 33 个 `*.test.ts`
  = SA6 §14 的 30 个非本票文件 + 2 个本票契约测试文件 + 1 个本票行为测试文件
  （`issue270-contract-support.ts` 为 fixture，不被收集）——无探针残留被收集。
- 未执行 commit/push/PR/finalize；未新增 skip/only/todo/env override（grep 零命中）。
- 本轮终态指纹（供复审独立复算）：`apps/yjs-server/test/rest-hosting-behavior.test.ts`
  = 233 行、sha256 `b3041b1f832b0bd1a39f637202a72cab946585703d8714febc38175420d75f31`
  （diff = +103/−23）；生产源码与冻结契约零 diff。

## Verification

| # | Command | Result | Evidence |
|---|---|---|---|
| 1 | 修复前复现（最终提交 `8e550d4` 的测试字节，临时探针）：`vitest run --typecheck apps/yjs-server/test/rest-hosting-prerebase-repro.test.ts` | **`Test Files 1 failed (1)` / `Tests 1 failed \| 3 passed (4)`**；例 1 `expected 400 to be 500`（实际 body `{"code":"MALFORMED_JSON",…}`）——确定性红，与 SA10 B-1 / SA9 S9-1 事实链一致 | `task_issue-270_sa3_repair_repro.log` |
| 2 | `vitest run --typecheck apps/yjs-server/test/rest-hosting-behavior.test.ts`（修订后复跑 2 次） | **两次均 `Test Files 1 passed (1)` / `Tests 5 passed (5)` / `Type Errors no errors`**（例 1、1b、2、3、4；11.07s / 11.09s） | `task_issue-270_sa3_repair-behavior.log` |
| 3 | `vitest run --typecheck apps/yjs-server/test/issue270-server-integration-red.test.ts apps/yjs-server/test/issue270-regression-anchors.test.ts apps/yjs-server/test/rest-hosting-behavior.test.ts` | **`Test Files 3 passed (3)` / `Tests 12 passed (12)` / `Type Errors no errors`（exit 0）**——SA6 冻结契约 T1-A/T1-B/T2/T3（4）+ 恒绿锚 N1/N2/N3（3）+ 行为 5 例；测试字节零改动 | `task_issue-270_sa3_repair-contract.log` |
| 4 | `tsc -p apps/yjs-server/tsconfig.json` | exit 0（空输出） | `task_issue-270_sa3_repair_typecheck.log` |
| 5 | `pnpm typecheck`（根链：14 包 + app，含 `packages/namespace-api`） | exit 0 | `task_issue-270_sa3_repair_root-typecheck.log` |
| 6 | `NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run apps/yjs-server/test`（全 app 套件） | **`Test Files 33 passed (33)` / `Tests 174 passed (174)` / `Type Errors no errors`（427.70s，exit 0）**——含 `rest-hosting-behavior`（5）、冻结契约（4+3）、直用 adapter 的既有套件与 `hub-restart-static-target-red`（本轮未现 #229 flake） | `task_issue-270_sa3_repair_app-suite.log` |
| 7 | 冻结契约哈希：`sha256sum` 三文件 | `5cea9d4e…` / `06e0bfe3…` / `2060e130…` 与 SA6 §13.4 **逐字节一致** | 本会话（见 §File scope check） |
| 8 | `grep -nE '\.(only\|skip\|todo)\(\|process\.env' apps/yjs-server/test/rest-hosting-behavior.test.ts` | 零命中（exit 1） | 本会话 |
| 9 | 静态生成/check | 设计未指定（本票零 VFSL schema/codegen 变更） | — |

红灯→转绿归因（本修复轮）：唯一红点 = 例 1 的驱动前提被 #268 合法演进推翻；修订后例 1 断言当前
父契约、D8 由例 1b（bridge 级 500 占位字节面）与例 2（端到端 rejection → sink 事件）双重锚定，
**未删除任何断言面、未弱化 AC1–AC4 与冻结契约**（冻结三文件字节不变、12/12 绿）。

### D8 rejection 覆盖为何需要两个 seam（诚实边界声明）

- #268 后，router 仍以 rejection 结算的结局 = body 读取期 abort、Registry fatal、503/500 族
  （`packages/namespace-api/AGENTS.md` / `rest.ts:15-22`）。在「合法输入 + 内存 Persistence +
  未停机」的组合根上，这些结局**无法确定性驱动**：普通 create 的 entry/Doc 碰撞是候选级内部重试
  （`registry.ts:1390-1405,1505-1522`），非法 root/schema 是 mapped 422，abort 必然销毁客户端
  socket 而无法观测 500 响应字节。
- 因此：**500 占位响应字节面**在 `createRestHosting` 的公开 `RestRouter` 依赖 seam 上锚定
  （例 1b：真实 `http.createServer` + 真实 TCP + 真实 socket，仅 router 为 rejecting 替身——
  被测对象是 bridge，替身是其声明依赖，非 mock 被测对象）；**端到端真实 rejection 可达性**在真实
  组合根上由 drain abort 锚定（例 2：真实 router 流错误 rejection → 真实 sink 事件恰一次）。
- 未固化 500 body 字面量（F4-(c)：只断言 `text/plain` + 非空）。

## Deferred verification

- SA4/SA7 的最终动态与真实环境验收；#229 `hub-restart-static-target-red` 时序 flake 监测
  （本轮全量 app 套件该用例通过）。
- 根 `pnpm test`（全仓 vitest，含 packages/domains）——SA3 范围外；受影响 app 套件与根
  `pnpm typecheck` 已跑。
- 设计/契约侧事实漂移注记（SA10 P-2 / SA9 S9-2）：设计 §2-C5/§7-D8/§12 与 SA4 §4/§9 的
  「骨架不产生 HTTP 错误 Response」前提需由设计/契约所有者走修订轮注记（SA3 不修改设计文件）。
- FR-1/FR-3/FR-4 follow-up（limits/`Request.signal`、problem shape 收敛、observer 事件发射）、
  peer REST listener、REST owner authorization、drain 预算可配置化（设计 §13 已登记）。

## Deviations or blockers

无阻塞。三点需披露：

1. **设计前提漂移登记（不修设计文件）**：设计 §2-C5/§7-D8/§12 例 1 与 SA4 D8/§9 行声明的
   「骨架契约：未映射结局一律 rejection、不产生 HTTP 错误 Response」对最终基线 `209b046` 已不成立
   （4xx/422 族已 mapped）。SA3 严格在 ALLOW 内动作，**未修改** `task_issue-270_design.md` 或任何
   冻结契约文件；该注记属设计/SA6 修订轮职责（SA10 P-2、SA9 S9-2）。本修复按两份最终评审给出的
   修订方向执行，未改变 AC1–AC4 验收语义。
2. **例 1b 的注入 seam**：为在 #268 后仍锚定 500 占位响应字节，例 1b 以 rejecting `RestRouter`
   作为 bridge 的声明依赖替身（真实 HTTP server/socket；被测对象 `createRestHosting` 未被 mock）；
   端到端可达性由例 2 用真实组合根闭合。若评审认为该 seam 需改由其他合法驱动替代，请回退至设计
   修订轮裁定（不影响生产实现）。
3. **证据文件命名**：旧 `task_issue-270_sa3_*.log`（rebase 前基线）保留但时态失效；本轮证据统一
   为 `task_issue-270_sa3_repair_*.log`。

## Suggested commit message

```
test(#270): 行为验收对齐 #268 父契约——畸形 JSON 400 透传 + D8 rejection 覆盖重定向

- 例 1：畸形 JSON 现由 router 映射为 matched 400 MALFORMED_JSON problem Response（#268）；
  断言改为 400 + application/json + problem code/message + 零 rest-request-failed，并保留
  后续合法 create 201 的存活断言
- 例 1b（新）：createRestHosting 注入 rejecting router → 500 text/plain 占位 + onRejection
  恰一次 + 结算后 drain 即时返回（D8 占位响应字节面）
- 例 2：追加 D8 端到端断言——drain abort 的真实 rejection 经 sink rest-request-failed 恰一次
- 生产实现、冻结契约三文件（sha256 不变）、AC1–AC4 语义零改动
```

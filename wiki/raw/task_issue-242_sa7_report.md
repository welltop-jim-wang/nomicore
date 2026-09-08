# SA7 动态最终验证报告 — issue #242：UPDATE_CHUNK codec 与 CAP_CHUNKED_UPDATE 协商（issue #233 切片 1）

> 评审人：SA7（Dynamic Verifier，final verification），dispatch：sa-958585a4-5624-46ca-9460-f41d1dcd3a10，iteration 0。
> Worktree：`/home/wangjian/nomicore-fix-issue-242`（branch `mabf/issue-242`，基线 `cde0d49`）。
> 任务：(a) 按 controller 指令修复三个证据产物的 whitespace 问题使 staged diff 通过 `git diff --cached --check`；(b) 独立动态验证最终交付证据。
> 纪律声明：未修改任何生产代码/测试/冻结值/评审结论；唯一写产物为本报告 + `_sa7_final_runs.log` + 三份证据产物的 whitespace 修复。测试全部以独立进程（`setsid nohup`）运行。
> **Owner 评论输入：本 dispatch 内 REST 刷新（`gh api repos/welltop-jim-wang/nomicore/issues/242/comments`）= `[]` —— 无 Owner 评论要求适用**（与任务简报 §Comments、SA2/SA4/SA9/SA10 头部记录一致；已在任务简报 §Comments 补记）。

## 1. Step 0：SA4 verdict 校对

`wiki/raw/task_issue-242_sa4_review.md` §2 Verdict：**approve**（无 BLOCKER/无 MAJOR/无新增阻断 MINOR）。SA9（`_sa9_standards.md` §1）与 SA10（`_sa10_spec.md` §1，final-review 组 issue-242-final-review-0）均为 **approve**。

[SA7 Step 0 结论] SA4 verdict: pass（approve）。操作: 进入动态验证。

## 2. Whitespace 修复（controller 委派的阻断项）

controller 的精确 staging 后 `git diff --cached --check` 仅因三个生成证据产物的 whitespace 报错（exit 2）。修复内容（仅 whitespace，零内容改动）：

| 文件 | 问题 | 修复 |
|---|---|---|
| `wiki/raw/task_issue-242.md` | line 32 `new blank line at EOF` | EOF 空行删除；`## Comments` 空节补记 REST `[]` 事实（见 §7），文件现以单一内容行 + 单 `\n` 结束 |
| `wiki/raw/task_issue-242_ac_red.log` | 9 行 trailing whitespace（`:65/:68/:316/:325/:341/:350/:354/:373/:390`，vitest 断言 diff 行 `- Expected: `/`+ Received: ` 与代码摘录空行 `435| ` 等） | 仅剥离行尾空白（`sed 's/[ \t]*$//'`），行数不变（432），断言名/数值/结论零改动 |
| `wiki/raw/task_issue-242_regression.log` | 15 行 trailing whitespace（同型） | 同上，行数不变（681） |

修复后 `git add` 三文件 → `git diff --cached --check` **exit 0（零输出）**。生产代码、测试、冻结值、SA2-SA10 评审结论零触碰（`git status` 全程无任何非 wiki/raw 路径的工作树改动）。

## 3. 动态验证结果（独立进程，全部 2026-09-08 本机真实运行）

完整原始输出：`wiki/raw/task_issue-242_sa7_final_runs.log`（含 P1-P4 与 probe 全文）。

| Run | 命令 | 退出码 | 关键结果（原文摘录） |
|---|---|---|---|
| P1 包级 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck packages/replication-protocol` | **0** | `✓ packages/replication-protocol/test/codec-issue242-ac-red.test.ts (28 tests) 52ms`；`Test Files 10 passed (10)`、`Tests 169 passed (169)`、`Type Errors no errors` |
| P2 包 tsc | `pnpm exec tsc -p packages/replication-protocol/tsconfig.json` | **0** | 无输出 |
| P3 root typecheck | `pnpm typecheck`（13 个 tsconfig 项目） | **0** | 无输出 |
| P4 root 全量 | `pnpm test`（= `vitest run --typecheck` 全仓） | **0** | `Test Files 231 passed (231)`、`Tests 2396 passed (2396)`、`Type Errors no errors`、Duration 162.21s |

**P4 判读（对 SA4 §11 风险 1/3 的复核）**：本次全量 run **零失败** —— SA3 证据中需四链归因的两个先在环境性失败（`apps/yjs-server/test/stdin-error-chain-red.test.ts` 加载竞态、`packages/vfsl-codegen/test/generate-cli-check.test.ts` 超时）本次均未复现且全绿，SA4 §11-R 的「详情若显示 write-failed 语义断言失败且隔离复现仍失败才是真回归」失败条件未触发；无任何失败可归因于本任务 ALLOW LIST 文件。flake 归因链由此不再必要（更强证据：全绿）。

**验收契约转绿**：红灯期 20F|8P（`_ac_red.log`）→ 本次 `codec-issue242-ac-red.test.ts` 28/28 通过（P1 摘录），SA6 红灯断言保持性成立（用例名集合未变，SA4 §9 已逐名比对）。

## 4. 活链路逐跳探针（SA7 独立构造，非既有测试的复述）

脚本经 `pnpm exec tsx` 直接驱动包公共 API（`packages/replication-protocol/src/index.ts`），9/9 通过（全文见 `_sa7_final_runs.log` 尾部）：

| 检查 | 观测结果 |
|---|---|
| A1 encode | `UpdateChunkMsg` → 66-byte canonical frame（20B envelope 头 + payload）构建成功 |
| A2 registry | `MESSAGE_TYPES.UPDATE_CHUNK===0x42`；`MESSAGE_REGISTRY['UPDATE_CHUNK']={"code":66,"scope":"namespace","direction":"either","ack":"UPDATE_ACK"}` |
| B1 decode(negotiated) | 六字段（namespaceId/transferId/chunkIndex/chunkCount/totalBytes/bytes）全等，detached copy |
| C1 fail-closed 门控 | 无选项 decode → `ProtocolError code=UNSUPPORTED_MESSAGE_TYPE wsCloseCode=1002`（未协商端响亮关闭） |
| D1 截断扫描 | 66/66 前缀（0..len-1）全部分类 `ProtocolError` 拒绝，零 RangeError/TypeError/零接受（无越界分配的可观察证据） |
| E1 急切选项校验 | `selectedCapabilities:-1` → `CONNECTION_POLICY_VIOLATION`（不 clamp） |
| F1 错误注册表 | `UPDATE_TRANSFER_VIOLATION={fatal:true,retryable:'no',terminalState:'failed'}`；`UPDATE_TRANSFER_TOO_LARGE={fatal:true,retryable:'config',terminalState:'failed'}`（冻结值逐项吻合） |
| F2 ERROR wire roundtrip | 新码 `UPDATE_TRANSFER_TOO_LARGE` encode→decode roundtrip 成功 |
| F3 RESYNC wire roundtrip | `reasonCode='UPDATE_TRANSFER_EXPIRED'` roundtrip 成功 |

静态冻结面交叉核对：`constants.ts:45 CAP_CHUNKED_UPDATE = 0x00000001`；`messages.ts:63 UPDATE_CHUNK: 0x42`；`errors.ts` 注册表恰 22 条 namespace 码（含两新码）；`docs/protocols/instance-replication-v1.md` §9.4/§13.2 已登记 reason 与两码（:262/:410/:411）。

## 5. 数据流路线动态证据（skill Step 2.5）

设计 §8 声明本切片唯一 wire 数据流为 codec 内一跳（无持久化/缓存/最终一致性面）；SA4 数据流审计无 mismatch。逐条观测：

| 路线 | 驱动输入 | 每跳运行时证据 | 最终读取/投影 | 错误与 cleanup 证据 | Verdict |
|---|---|---|---|---|---|
| UPDATE_CHUNK encode | 探针构造合法 `UpdateChunkMsg`（probe A1） | `encodeMessage` 字段校验 → 66B canonical frame（长度/头实测） | B1 decode 六字段全等 | 非法 namespaceId（首轮探针误用 `ns-242`）实测 `MALFORMED_FRAME` fatal/1002 响亮拒绝 | pass |
| UPDATE_CHUNK decode（含敌意） | wire bytes + 66 个截断前缀 + 无能力/负能力选项 | 帧级→选项急切→门控→载荷四级分类（C1/D1/E1）；分配仅在边界检查后（D1 零未分类异常） | B1 全等对象 | C1 UNSUPPORTED_MESSAGE_TYPE/1002；E1 CONNECTION_POLICY_VIOLATION | pass |
| ERROR(新码)/RESYNC(新 reason) | 探针构造 ERROR/RESYNC_REQUIRED 消息 | 注册表单点元数据（F1）→ encodeError/encode 位推导 wire（F2/F3） | decode roundtrip code/reason 精确还原 | 位不一致→MALFORMED_FRAME（既有测试锁定，P1 绿） | pass |

真实跨版本互通（SA4 §11 风险 2）按设计属后续切片（当前证据 = 包内 v1 支持集模拟：selected=0 → 1002 fatal，本报告 C1 复现）；不在本票验收面。

## 6. Spec / vitest 触发证据（skill Step 3/4）

- **E2E spec（Step 3）**：设计 §11 文件面无任何 `*.spec.ts` 新增/改动 → 触发条件不适用。
- **vitest（Step 4）**：新增 `*.test.ts` = `packages/replication-protocol/test/codec-issue242-ac-red.test.ts`。
  - **本地动态证据**：✓ 触发且通过 —— P1 摘录 `✓ packages/replication-protocol/test/codec-issue242-ac-red.test.ts (28 tests)`；P4 全仓 231 文件/2396 用例全绿。
  - **CI runner 级证据**：⚠ 未采集 —— 本分支尚未 push、无 PR/CI run（SA7 不负责 push/建 PR/宣称 CI 已绿）。静态核对：`.github/workflows/ci.yml` 以 root `pnpm test`（含 `--typecheck`）运行全仓 vitest，覆盖该 workspace package；CI 实跑证据留待 controller push 后核验。

## 7. Issue comments 记录（dispatch 指定）

REST（`gh api .../issues/242/comments`，本 dispatch 内）= `[]` → **无 Owner 评论要求适用**，无遗漏映射风险。已补记于任务简报 §Comments（该补记同时消除了其 EOF 空白行）。与 SA2（iteration 2 头部）、SA4/SA9/SA10 头部的历次 `[]` 刷新记录一致。

## 8. Verdict

**pass**。

- 交付门全部真实运行复验：P1 包级 10 文件/169 用例含验收契约 28/28、P2/P3 typecheck、P4 全仓 231 文件/2396 用例 **全绿 exit 0**（SA4 §11 三项后续动态验证项全部闭环且无失败条件触发）；
- 活链路逐跳探针 9/9 通过（encode/roundtrip/fail-closed 门控/全偏移截断/急切校验/冻结元数据/新码新 reason wire roundtrip）；
- 冻结值静态交叉核对与 ADR 0013/设计 §7 一致；
- whitespace 修复后 staged diff `git diff --cached --check` exit 0，修复面严格限于三个证据产物。

— SA7，issue #242 final verification 完毕。Verdict：**pass**。

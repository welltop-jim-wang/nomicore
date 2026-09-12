# SA3 Implementation Report — issue #301（#295 切片 3）：分块 snapshot/sync 的 observer 8 型接线

- **dispatch**: iteration 0 = sa-a48c5643-e661-4227-b492-5d7f11fc6d0c；iteration 1（契约修订后复核）= sa-99ca6856-61f2-47ab-95fc-ee7b3675abe9；**iteration 2（当前，证据产物空白卫生）= sa-f2e81cea-2ada-47c9-9b27-303a6ebb2b01（mabf-sa3 / implementation / iteration 2）**
- **基线**: `0f3eca5`（`git rev-parse HEAD` 实测；工作树原有未跟踪产物 = SA6 契约文件 + wiki 固定输入）
- **最终裁决**: **实施完成 + 验证通过**——SA6 Revision R1 修订后的 R2 判别式（`ackedSequence` 精确锚定）下：契约 **17 passed (17)**（R1–R8 + N1–N9，连续 4 次零抖动）、全包 **71 文件 / 516 passed (516)、0 failed**、包/根 typecheck 与 api 型镜像全绿、设计验证链末端的根 `pnpm test` **332 文件 / 3503 passed (3503)、Type Errors: no errors、exit 0**；**iteration 1 零新增实现改动**（5 个实现文件 md5 与 SA6 §16 独立记录逐字相同）
- **红灯契约**: `packages/ws-replication/test/ws-replication-issue301-chunked-completeness-ac-red.test.ts`（SA6 产物，DENY，SA3 零改动；Revision R1 由 SA6 以 contract-only 方式施加，见 SA6 §17）
- **Owner-feedback 记录**: REST comments endpoint 返回空（与 dispatch/SA6 §2/SA2 §4 一致）——无 owner 补充要求；各 iteration 均无 owner override 并入
- **iteration 2 范围（当前）**: 仅修正 dispatch 点名的 5 个**已入库证据产物**的 `git diff --cached --check` 违规（EOF 多余空行 = `new blank line at EOF`）——`artifacts/sa7-issue301-{package-tests,post-removal-verify,probe-dynamic,supporting-suites}.log` + `wiki/raw/task_issue-301.md`；**零 src/test/docs/协议语义改动**（逐字节核验，§10）

---

## 1. Inputs consumed

| 输入 | 用途 |
|---|---|
| `wiki/raw/task_issue-301.md` | 任务简报（AC1–AC5；comments 空——无 owner 补充要求） |
| `wiki/raw/task_issue-301_design.md` | 最新批准设计（OD1–OD9、ALLOW/DENY、§12 验证命令、§14 iteration 1 契约修订复核） |
| `wiki/raw/task_issue-301_sa6_contract.md` | 验收契约报告（8 红 R1–R8 + 9 负控 N1–N9；**Revision R1 §17**：R2 末条 wire 计数断言判别式改为 `ackedSequence`；§17.6 修订后证据） |
| `wiki/raw/task_issue-301_sa2_review.md` | SA2 攻击评审（approve；3 条 MINOR O-1/O-2/O-3，无 BLOCKER/MAJOR） |
| `wiki/raw/task_issue-301_design_conflict_report.md` | SA8 设计后冲突复查（**clear**；D1–D14；§7 Required action 3 = 实现后复查，输出 `_implementation_conflict_report.md`，归 SA8） |
| `docs/adr/0019-chunked-sync-transfer.md`、`docs/protocols/instance-replication-v1.md` §9.2/§22/§23.1/§23.3/§23.4 | 字段集/side 信封/改道纪律/判别式规范依据（逐字对照；§9.2 L246 `SYNC_APPLIED.ackedSequence = SYNC_STEP2 sequence（分块 diff 时为末 chunk 帧序）`） |
| `packages/ws-replication/{src,test}` 当前实现与 516 用例 | 现状锚点与回归面 |
| `packages/ws-replication/AGENTS.md` | 模块契约与验证门 |

**缺失输入**：`_relevant_decisions.md` / `_conflict_report.md` 不存在（设计 §4/SA6 §15 已登记；由 `_design_conflict_report.md` 补位 clear）；无 `_sa4_review.md` / `_sa7_report.md`（无返工轮）。

## 2. Existing worktree reconciliation

- **iteration 0 实现保留**：5 个 `src` 文件 + api 型镜像 + 协议 §22 资产锚的实现改动全部核对最新设计后保留（逐点核对 OD1–OD9，无过时/冲突改动）。
- **契约面**：SA6 Revision R1 已落到契约文件 L710–718——判别式由「hub→peer 全部 `SYNC_APPLIED` 计数 = 1」改为 `syncApplied.filter(m => m.ackedSequence === <kind=2 末 chunk 帧序>)` 恰一；契约其余部分（R1、R3–R8、N1–N9）零变化。
- **iteration 1 结论**：修订为 contract-only，**不需要实现改动**；当前实现使修订后契约全绿（§6）。SA3 未修改契约（DENY）、未新增/放宽断言、未加 skip/only/todo/env override。
- **跨 SA 指纹互证**：当前 5 个实现文件 md5（`types.ts 912350fc…`、`bulk-transfer.ts 2089bfe4…`、`hub-namespace.ts 200744a0…`、`peer-namespace.ts 935c3fcf…`、`round-engine.ts dead8d68…`）与 SA6 §16 独立记录的修订前/后 md5 **逐字相同** ⇒ SA6 的 stash/pop 对照与 Revision R1 复核均在**同一实现字节**上进行；`git stash list` 为空，无悬空 stash。

## 3. Changed paths

| Path | Design section | Change |
|---|---|---|
| `packages/ws-replication/src/types.ts` | OD1 | `ReplicationObserverEvent` 追加第 29–36 型判别成员（8 型，字段集/side 信封逐字）；联合头部计数文案 28 型 → 36 型 + issue #301 出处 |
| `packages/ws-replication/src/bulk-transfer.ts` | OD2/OD3 | 新增 `BulkTransferOutboundSettlement`；`BulkTransferState.lastChunkSequence` + `settlementOf` 单点构造；`onLastChunkSent` 携结算记录（形态见 §8-1）；`settle(kind)` 返回结算记录 |
| `packages/ws-replication/src/hub-namespace.ts` | OD2/OD3/OD4/OD6/OD7 | `chunkedAckT0` + `sampleAckT0`；startBootstrap(kind=1) sent；onBootstrapAck acked；sendStep2(kind=2) sent；onSyncApplied acked；handleAssemblerResult(kind=2) chunkCount 穿线；applyStep2/applyRemoteUpdate 结构化 form + `chunked-sync-applied` 第五形态 + svBefore 跳过；clearInboundAssembly kind 选路；onAssemblyTimeout kind=1 零 aborted |
| `packages/ws-replication/src/peer-namespace.ts` | OD2/OD3/OD4/OD5/OD6/OD7 | hub 同款九处镜像 + `finishBootstrapImport` form 参数化（`'single'` 逐字节不变 / chunked 第六形态 + t0/t1）+ 两调用点 |
| `packages/ws-replication/src/round-engine.ts` | OD4-3 | `RoundHost.applyStep2` / `applyStep2Safely` 第 4 参 → `{form:'syncChunked'; chunkCount}`；`completeChunkedStep2` 增第 3 参 |
| `packages/ws-replication/test/ws-replication-api.test-d.ts` | OD9-1 | 36 型全联合 `toEqualTypeOf` 镜像 + 8 型逐字段精确性断言（含 acked 无 syncRoundId、applied 无 transferId/sequence、aborted 无 connectionId 的静态排除锚）；标题计数修正 |
| `docs/protocols/instance-replication-v1.md` | OD9-2 | §22 Conformance 资产锚补记本票契约 + 类型镜像一句（§23.1/§23.3/§23.4 冻结文本零改动） |
| `wiki/raw/task_issue-301_sa3_impl.md` | skill 固定产物 | 本报告（原位更新至 iteration 2） |
| `artifacts/sa7-issue301-package-tests.log` | —（SA7 证据产物，iteration 2 dispatch 点名） | 仅删除 EOF 多余空行（202 行 → 201 行）；其余字节零变化 |
| `artifacts/sa7-issue301-post-removal-verify.log` | —（同上） | 仅删除 EOF 多余空行（11 行 → 10 行）；其余字节零变化 |
| `artifacts/sa7-issue301-probe-dynamic.log` | —（同上） | 仅删除 EOF 多余空行（58 行 → 57 行）；其余字节零变化 |
| `artifacts/sa7-issue301-supporting-suites.log` | —（同上） | 仅删除 EOF 多余空行（14 行 → 13 行）；其余字节零变化 |
| `wiki/raw/task_issue-301.md` | —（任务简报固定输入，iteration 2 dispatch 点名） | 仅删除 EOF 多余空行（39 行 → 38 行）；正文逐字节零变化 |

**iteration 1 新增 changed path = 0**（实现面冻结；仅本报告原位更新）。

**iteration 2 新增 changed path = 上述 5 个证据产物 + 本报告原位更新**；`packages/**`、`docs/**`、SA6 契约文件（DENY）**零改动**（`git status --porcelain` 与 `git diff --cached --stat` 逐项核对，§10）。

## 4. SA2 Finding 落实

| Finding ID | Severity | Implementation | Result |
|---|---|---|---|
| O-1 | MINOR | peer 侧 acked quiet 门使用 `isInboundQuiet()`（peer 实际方法名），hub 侧使用 `isQuietState()`——按侧取正确方法名，未引用不存在方法 | 落实（双侧 typecheck 绿，jar 见 §6） |
| O-2 | MINOR | OD9-1 的 8 型 per-type `Extract` 断言全覆盖补齐（不止示例），含 `chunked-snapshot-applied.applyLatencyMs: number \| undefined`、`chunked-sync-acked` 无 `syncRoundId` 键（类型级 `extends keyof ... ? true : false` 锚） | 落实（`vitest --typecheck.only` 17/17、Type Errors: no errors） |
| O-3 | MINOR | 以 §10 调用方矩阵为准逐点接线（物理调用点 11 处：sent 3 / acked 3 / applied 3 / aborted 2） | 落实 |
| BLOCKER/MAJOR | — | SA2 §13「Required revisions：无」 | 无适用项 |

## 5. File scope check

| Changed path | ALLOW entry | Purpose |
|---|---|---|
| `packages/ws-replication/src/types.ts` | ALLOW 第 1 行 | OD1 类型面 |
| `packages/ws-replication/src/bulk-transfer.ts` | ALLOW 第 2 行 | OD2/OD3 发送侧结算回调面 |
| `packages/ws-replication/src/hub-namespace.ts` | ALLOW 第 3 行 | OD2/OD3/OD4/OD6/OD7 hub 接线 |
| `packages/ws-replication/src/peer-namespace.ts` | ALLOW 第 4 行 | 镜像 + OD5 |
| `packages/ws-replication/src/round-engine.ts` | ALLOW 第 5 行 | OD4-3 chunkCount 穿线 |
| `packages/ws-replication/test/ws-replication-api.test-d.ts` | ALLOW 第 6 行 | OD9-1 类型镜像 |
| `docs/protocols/instance-replication-v1.md` | ALLOW 第 7 行 | OD9-2 仅 §22 一句 |
| `wiki/raw/task_issue-301_sa3_impl.md` | skill 固定产物（实现报告） | 本报告 |
| `artifacts/sa7-issue301-{package-tests,post-removal-verify,probe-dynamic,supporting-suites}.log` | 设计 §11 ALLOW 外、DENY 内均未列（SA7 跟踪产物）；iteration 2 dispatch 点名 | 仅删 EOF 空行（空白卫生） |
| `wiki/raw/task_issue-301.md` | **设计 §11 DENY 行「Host/SA6 固定输入 —— 只读上游产物」**；iteration 2 dispatch 点名 | 仅删 EOF 空行（正文零变化）；冲突与处置见 §8-4 |

**DENY 面零触碰**（`git status --porcelain` + `git diff --cached --name-status` 逐项核对，iteration 1/2 复核）：SA6 契约文件（内容含 Revision R1、SA3 未写）、`ws-replication-issue300-*`、`observer-red`、`observer.ts`、`update-channel.ts`、`update-transfer.ts`、`index.ts`、`replication-protocol/**`、ADR/CONTEXT 全部未改。iteration 1 临时校验副本（`tmp-sa3-r2-verify.test.ts` / `tmp-sa3-r2-mutation.test.ts`，§6）已删除，`git status` 无 `tmp-sa3` 残留。**iteration 2 唯一例外** = dispatch 点名的 `wiki/raw/task_issue-301.md` EOF 空行删除（内容零变化；设计 §11 该行为只读上游产物，故记为偏差 §8-4）；`packages/**`、`docs/**`、`test/**` 零改动。

## 6. Verification

命令均在 worktree 根执行；`NODE_OPTIONS=--conditions=nomicore-source`（项目既定入口）。

| # | Command | Result | Evidence |
|---|---|---|---|
| V1 | `npx vitest run <契约文件> --typecheck.enabled=false`（iteration 0 实现前，SA3 实测） | **8 failed \| 9 passed (17)** | 基线红灯，与 SA6 §13.1 逐条一致（事件零发射） |
| V2 | 同 V1（iteration 0 实现后、Revision R1 前） | **1 failed \| 16 passed (17)** | 唯一失败 = R2 旧末条 wire 计数断言（契约矛盾，SA3 §8-2 上报） |
| V3 | 同 V1（**Revision R1 契约 + 当前实现，iteration 1 本次**） | **17 passed (17)** | R1–R8 全绿 + N1–N9 保持绿；连续 5 次运行均 17/17（零抖动） |
| V4 | `npx vitest run packages/ws-replication/test --typecheck.enabled=false` | **71 passed (71) / 516 passed (516), 0 failed** | 既有 70 文件 / 499 用例 + #300 契约零回归 |
| V5 | `npx tsc -p packages/ws-replication/tsconfig.json` | **exit 0** | 含 `test/**/*.ts`（含契约与 api.test-d 全联合镜像） |
| V6 | `NODE_OPTIONS=--conditions=nomicore-source npx vitest run --typecheck.only packages/ws-replication/test/ws-replication-api.test-d.ts` | **17 passed；Type Errors: no errors** | 36 型镜像 + 8 型字段精确性 |
| V7 | `pnpm typecheck`（14 tsconfig 链） | **exit 0**（`&&` 链无中断） | 根静态门 |
| V8 | 契约纪律自检：`grep -nE "\.(only\|skip\|todo)\(\|process\.env" <契约文件>`；`grep -c "^  it("` | 0 命中；`it` 计数 = 17；1392 行 | 无 skip/only/todo/env override，断言面未被弱化 |
| V9 | **R2 判别式独立校验**（临时副本 = 契约 + 探针，运行后已删；DENY 原文件零改动） | 探针输出 `{"lastChunkSeq":21,"applied":[{"acked":5,"round":1},{"acked":21,"round":2}],"anchored":1}`；用例 **1 passed** | hub→peer 确有 2 笔 `SYNC_APPLIED`（round 1 既有 ACK + round 2 分块 ACK）⇒ 旧「总数 = 1」判别式在本构型下**结构性不可满足**；新判别式精确选中 21 = kind=2 末 chunk 帧序者恰一。**确认 SA3 §8-2 事实与 SA6 §17 修订方向成立，且实现侧零缺陷** |
| V10 | **R2 断言敏感度 mutation**（临时副本：判别式改为 `末 chunk 帧序 + 1`，运行后已删） | **1 failed \| 16 skipped (17)**，失败信息 = `R2：kind=2 分块 round 必须以恰一笔 SYNC_APPLIED 锚定末 chunk 帧序…: expected [] to have a length of 1 but got +0` | 修订后断言非恒真（SA3 独立复现 SA6 §17.6 的 mutation 结论） |
| V11 | `git status --porcelain` + `git stash list` + md5 | 仅 ALLOW 面 modified + 契约/wiki 未跟踪；stash 空；5 实现文件 md5 与 SA6 §16 逐字相同 | DENY 面零触碰、临时副本零残留、实现字节与 SA6 修订复核同源 |
| V12 | `pnpm test`（根门：全仓 `vitest run --typecheck`，设计 §12 验证链末端；iteration 1 本次） | **332 passed (332) / 3503 passed (3503)，Type Errors: no errors，exit 0**（615s） | 全仓零回归；含 `ws-replication` 包 71 文件/516 用例与 api.test-d 型镜像 |
| V13 | **`git diff --cached --check`（修前，iteration 2 基线复现）** | **exit 2**；恰 5 条 `new blank line at EOF`：`artifacts/sa7-issue301-package-tests.log:202`、`...post-removal-verify.log:11`、`...probe-dynamic.log:58`、`...supporting-suites.log:14`、`wiki/raw/task_issue-301.md:39` | 与 dispatch 点名清单**逐条一致**（无其它违规、无遗漏） |
| V14 | **`git diff --cached --check`（修后 + 索引刷新，iteration 2 本次）** | **exit 0，零输出** | staging 门干净（§10） |
| V15 | **内容不变性核验**：`tail -c 12 <各文件> \| od -c`（修后）；`git diff --ignore-blank-lines -- artifacts/ wiki/raw/task_issue-301.md`；`git diff --stat`（worktree vs 索引，**索引刷新前**）；修前索引 blob `git cat-file` vs 修后内容 `diff` | 5 文件均以单一 `\n` 收尾；`--ignore-blank-lines` diff **零输出**；`--stat` = 每文件 **1 deletion**；修前 blob vs 修后内容唯一差异 = 末尾空行（`202d201`/`11d10`/`58d57`/`14d13`/`39d38`），各文件旧版独有行数 = 1 | 改动严格等价于「删除末尾空行」：正文/日志字节零变化，无夹带修改 |
| V16 | **范围与计数核验**：`git status --porcelain`；`git diff --cached --name-status`；行数 | 跟踪面仅 5 证据产物（每文件 1 行减少）+ 本报告；`packages/**`、`docs/**`、SA6 契约（DENY）零改动；行数 202→201 / 11→10 / 58→57 / 14→13 / 39→38 | 零生产语义/测试改动、零新增/重命名文件；iteration 1 的契约 17/17 等结论不受影响 |
| V17 | 契约文件复跑（iteration 2 本次）：`npx vitest run packages/ws-replication/test/ws-replication-issue301-chunked-completeness-ac-red.test.ts --typecheck.enabled=false` | **17 passed (17)**，exit 0（Start 03:50:43） | 空白卫生改动后 R1–R8 + N1–N9 仍全绿 |
| V18 | `npx tsc -p packages/ws-replication/tsconfig.json`（iteration 2 本次） | **exit 0** | 实现面零改动，包 typecheck 保持绿 |

**逐条验收锚（V3 实测，实现后）**：
- **R1**：hub `chunked-snapshot-sent` 恰一（transferId/chunkCount/totalBytes = wire 申报、无 sequence/latency）；peer `chunked-snapshot-applied` 恰一（bytes=totalBytes=100407、chunkCount=13、applyLatencyMs ≥0、无 transferId/sequence/stages）；hub `chunked-snapshot-acked` 恰一（bytes、ackLatencyMs ≥0、无 transferId/chunkCount）；`bootstrap-snapshot-sent`/`bootstrap-imported` 归零；单 `BOOTSTRAP_ACK` 锚末 chunk 帧序。✓
- **R2**：peer `chunked-sync-sent` 恰一（syncRoundId=2=wire round、无 sequence）；hub `chunked-sync-applied` 恰一（bytes=100029、chunkCount=13、syncRoundId=2、applyLatencyMs ≥0、无 transferId/sequence/效果组）；peer `chunked-sync-acked` 恰一（bytes、无 sequence/syncRoundId/transferId/chunkCount）；分块窗口 `sync-step2-sent`/`sync-diff-applied` 增量零；**修订后 wire 锚：`ackedSequence` = 末 chunk 帧序（21）的 `SYNC_APPLIED` 恰一笔**（V9 探针实证）。✓
- **R3/R4/R8**：peer `chunked-snapshot-aborted{channel-teardown / connection-teardown}` 恰一，transferId/receivedChunks/receivedBytes 与 wire 实际进度一致、无 connectionId；零 applied、零写入、零 dirty；R8 peer 进入 draining。✓
- **R5**：hub `chunked-sync-aborted{timeout}` 恰一 + 进度一致 + 零 `chunked-sync-applied`；绿半：`RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED}` 非终态、零 ERROR/零 `namespace-failed`、peer 非 failed、hub 值不变、零 dirty。✓
- **R6**：8 型全部可观测；每事件键集 ⊆ 冻结白名单；深扫无 `Uint8Array`/`ArrayBuffer`/`DataView`/`Error`；JSON 无 token/owner/文档内容哨兵。✓
- **R7**：clock 缺省 → snapshot/sync × applied/acked 四键**整键缺失**（`'applyLatencyMs' in event === false`）。✓
- **N1–N9**：全绿（kind=1 超时终局零成功型事件、observer 全 throw 与无 observer wire 逐字节等价、双 ns 公平调度/control reserve、恶意声明分配前拒绝、epoch fence 丢弃效果）。✓

## 7. Deferred verification

| 项 | 归属 | 说明 |
|---|---|---|
| shed / epoch-fence / GOAWAY 行 + 双侧 side 覆盖 + 被拒 ACK 组合的**计数**断言 | SA7 动态面 | §23.1 L782 既有归口；SA8 §7 Required action 2 |
| **SA8 实现后冲突复查**（Frozen surfaces 逐项 vs 实际 diff；尤其单帧路径逐字节不变、`observer.ts`/`index.ts` 零改动、ALLOW 七文件边界、§22 仅加一句） | SA8 | 输出 `task_issue-301_implementation_conflict_report.md`（设计 §15 / SA8 §7 Required action 3 / SA8 §9 `requiresConflictRecheck: true` 的实现后一半）；**本 iteration 未产出该报告，不属 SA3 职责** |
| `observer-red` 全 36 型覆盖扩面、§13-9 登记的 follow-up | 后续 ticket | 该文件场景不进入 chunked snapshot/sync 窗口（SA8 D14 独立核验），本票零改动 |
| iteration 2 证据产物空白卫生的**内容不变性复核** | SA4 / SA7 | 4 个 SA7 日志**正文逐字节不变**（仅删 EOF 空行）⇒ SA7 §3/§5 的计数与结论证据继续有效，无需重跑动态面；`wiki/raw/task_issue-301.md` 正文逐字节不变 ⇒ 任务简报语义未变 |

根 `pnpm test`（全仓门：332 文件 / 3503 用例）已由 SA3 在 iteration 1 实际执行并全绿（V12），不再列为 deferred。

## 8. Deviations or blockers

### 8-1（保留的偏差，已论证）OD2 `onLastChunkSent` 形态：追加第 2 参而非替换唯一参数

- **设计**：§8.1 接口表拟把 `onLastChunkSent` 参数从 `number` 替换为 `BulkTransferOutboundSettlement`。
- **实测冲突**：DENY 冻结的回归锚 `packages/ws-replication/test/ws-replication-issue300-bulk-edge-ac.test.ts` L194–196 把该唯一参数直接绑定到 `let lastSeq: number | undefined`；按设计替换参数类型后 `npx tsc -p packages/ws-replication/tsconfig.json` 报 TS2322，而该文件属 DENY、SA3 不得修改。
- **处置（iteration 1 复核维持）**：改为 `onLastChunkSent(lastChunkSequence: number, settlement: BulkTransferOutboundSettlement)`——名字、发射点（`pullOne` 末 chunk 分支同一同步栈）、单点事实源（`settlementOf` 构造一次、`settle` 同源）与 sent 事件字段全部与设计一致；TS 允许回调省略尾参，冻结锚的类型绑定不变。控制器侧与设计伪代码等价（`lastChunkSequence === settlement.lastChunkSequence`）。
- **影响面**：包内私有回调（不经 `index.ts`），零 wire/零状态机/零公共 API 影响；DENY 面零改动。V4/V5/V6/V7 全绿。建议 SA8 实现后复查确认该形态（§7）。
- **替代方案（被拒）**：修改 DENY 锚（禁止）；控制器侧自记 second source（设计 OD2 备选④已拒）；新增第二回调（设计 OD2 备选②已拒）。

### 8-2（已消解）R2 末条 wire 计数断言不可满足 → SA6 Revision R1 contract-only 修订

- **SA3 iteration 0 上报**：契约旧 L710–713 `expect(syncApplied).toHaveLength(1)` 把「分块 round 的单 ACK 锚末 chunk 帧序」表达为「hub→peer 全部 `SYNC_APPLIED` 计数 = 1」；R2 构型下该方向有 2 笔（round 1 既有 ACK `ackedSequence=5` + round 2 分块 ACK `ackedSequence=21`），旧断言结构性不可满足；帧序列为基线固有 wire 行为（SA3 iteration 0 stash 对照逐帧全等）。
- **SA6 处置**：Revision R1（SA6 §17）以 contract-only 最小修订把判别式改为 `ackedSequence` 精确锚定，并完成双向复跑与 mutation 敏感度验证（§17.6），未改生产实现。
- **iteration 1 独立复核（V9/V10/V11）**：修订后契约 R2 通过且探针证实 `anchored = 1`（恰为 kind=2 末 chunk 帧序 21）；把判别式改为 `帧序 + 1` 后 R2 恰在锚定断言处失败（非恒真）；实现文件 md5 与 SA6 §16 记录逐字相同。**该阻塞项闭合，无遗留动作。**
- **SA3 纪律**：未修改契约断言、未弱化验收、未添加 skip/only/env override（V8）。

### 8-3（无阻塞）

- 无 design 不可行、无范围不足、无红灯契约与设计矛盾、无外部环境不可用。`_design_conflict_report.md` 的 `requiresConflictRecheck: true` 的实现后一半归 SA8（§7），不构成本 iteration 阻塞。

### 8-4（dispatch 授权的范围偏差，内容中性）`wiki/raw/task_issue-301.md` 属设计 DENY，但被 iteration 2 dispatch 点名

- **设计边界**：设计 §11 DENY LIST 第 362 行把 `wiki/raw/task_issue-301.md` 列为「Host/SA6 固定输入 —— 只读上游产物」。
- **dispatch 要求**：iteration 2 dispatch 明确点名该文件为「issue #301 fixed evidence artifacts」之一，要求修正其 `git diff --cached --check` 的 `new blank line at EOF` 违规。
- **处置**：按 dispatch 执行**且仅执行 EOF 空行删除**——`git cat-file -p 5c4b4663…`（修前索引 blob）vs 修后内容 = 唯一差异为第 39 行空行；正文（L1–L38：标题/Issue body/AC1–AC5/Blocked by/Comments）逐字节不变，语义与验收输入零变化。
- **影响面**：无生产/测试/协议语义影响（该文件不参与任何构建或测试）；不动 `_sa6_contract.md`（DENY 冻结验收输入）。**登记供 SA4/SA8 复核**；如需回退，恢复末尾单个空行即可（原始 blob `5c4b4663…` 仍在对象库）。
- **替代方案（被拒）**：忽略 dispatch 点名（则不满足「staging check 干净」的显式验收）；改写文件内容（禁止且无必要）。

## 9. Suggested commit message

```text
feat(#301): feat(#295 切片 3): 分块 snapshot/sync observer 8 型接线

- types.ts：ReplicationObserverEvent 追加第 29–36 型（ADR 0019 L78–81 + 协议 §23.1）
- 发送侧：BulkTransferOutboundSettlement 结算记录；hub/peer sent（末 chunk 恰一）+ acked（单 ACK 结算）
- 接收侧：kind=1 排他复制导入 → chunked-snapshot-applied（form 参数化）；
  kind=2 完成点 → chunked-sync-applied（chunkCount 经 round-engine 穿线）
- 中止侧：clearInboundAssembly kind 选路三型；kind=1 超时（终局失败族）零 aborted
- 类型镜像 36 型全联合精确断言；协议 §22 资产锚补记
- 证据产物：删除 5 个已入库产物（4 个 artifacts/sa7-issue301-*.log + wiki/raw/task_issue-301.md）的 EOF 多余空行，
  正文零变化；`git diff --cached --check` 干净（exit 0）
- 验证：契约 17/17（R1–R8 + N1–N9，含 SA6 Revision R1 的 ackedSequence 判别式）；
  全包 71 文件 / 516 用例全绿；根 pnpm test 332 文件 / 3503 用例全绿；
  包/根 typecheck 与 test-d 型测全绿
```

## 10. iteration 2 执行记录（证据产物空白卫生）

- **dispatch**: `sa-f2e81cea-2ada-47c9-9b27-303a6ebb2b01`（mabf-sa3 / implementation / iteration 2）；Owner-feedback：REST comments endpoint 返回空 ⇒ 无 owner 补充要求。
- **任务**：仅修正 dispatch 点名的 5 个**已入库**（`git diff --cached`）证据产物的 `new blank line at EOF` 违规；不得改动生产语义或测试。

### 10.1 修前基线（V13 原始输出）

```text
$ git diff --cached --check
artifacts/sa7-issue301-package-tests.log:202: new blank line at EOF.
artifacts/sa7-issue301-post-removal-verify.log:11: new blank line at EOF.
artifacts/sa7-issue301-probe-dynamic.log:58: new blank line at EOF.
artifacts/sa7-issue301-supporting-suites.log:14: new blank line at EOF.
wiki/raw/task_issue-301.md:39: new blank line at EOF.
EXIT: 2
```

与 dispatch 点名清单**逐条一致**（恰 5 条、无其它违规、无遗漏）。

### 10.2 处置（逐文件仅删末尾空行）

- 每个文件删除**唯一**的末尾空行（EOF `\n\n` → `\n`）；`tail -c 12 | od -c` 逐文件确认以单一 `\n` 收尾。
- 不改行内容、不重排、不改编码；`git diff --ignore-blank-lines -- artifacts/ wiki/raw/task_issue-301.md` **零输出**。
- **修前索引 blob vs 修后内容**逐文件 `diff`：唯一差异即末尾空行（`202d201` / `11d10` / `58d57` / `14d13` / `39d38`），「仅存在于旧版的行数」各 = 1；修前索引 blob：`00a70374…` / `5f4f6903…` / `55a9b6b8…` / `9b9cb3d4…` / `5c4b4663…`，修后：`12ec9384…` / `3a792695…` / `712b6969…` / `bdc501f0…` / `4d969789…`。

### 10.3 索引刷新（使 staging 门可判定）

`git diff --cached --check` 比较的是**索引 vs HEAD**；5 个违规文件当时已 staged（`A`），仅修工作树不足以让该门变绿。SA3 因此对**恰好 6 个路径**（5 个证据产物 + 本报告）执行 `git add --`（无 `-A`、无其它路径、无 `-N`），使索引与工作树一致：

```text
$ git add -- artifacts/sa7-issue301-package-tests.log artifacts/sa7-issue301-post-removal-verify.log \
             artifacts/sa7-issue301-probe-dynamic.log artifacts/sa7-issue301-supporting-suites.log \
             wiki/raw/task_issue-301.md wiki/raw/task_issue-301_sa3_impl.md        # exit 0
$ git diff --cached --check   # EXIT: 0（零输出）
$ git diff --check            # EXIT: 0（工作树 vs 索引，无未暂存差异）
```

该动作为满足 dispatch「Validate the staging check is clean」所必需，且仅刷新本票已涉及路径的索引；**未执行 commit / push / PR / finalize**。

### 10.4 范围与不变性核验

| 面 | 结果 |
|---|---|
| `packages/**`（src + test，含 DENY 契约与既有回归锚） | **零改动**（`git status --porcelain` 与 iteration 1 逐项一致） |
| `docs/**`（协议 §22 资产锚） | **零改动** |
| 5 个证据产物 | 正文**逐字节不变**；行数 202→201 / 11→10 / 58→57 / 14→13 / 39→38 |
| 契约红灯面 | V17 复跑 **17 passed (17)**；V18 包 typecheck **exit 0** ⇒ 绿态保持 |
| SA7 动态证据有效性 | 日志正文不变 ⇒ SA7 §3/§5 的计数与结论证据继续有效（无需重跑动态面） |
| 唯一范围偏差 | `wiki/raw/task_issue-301.md`（设计 DENY 的只读上游产物）——dispatch 点名授权，仅删 EOF 空行，见 §8-4 |
| 有意不动的相邻现象 | `docs/protocols/instance-replication-v1.md` 末尾亦为 `\n\n`，但该空行**在 HEAD 中已存在**（`git show HEAD:…` 实测），非本票引入 ⇒ `--check` 不标记、dispatch 未点名，故不改（不在本 iteration 范围内，避免扩大 diff） |

*SA3 未执行 commit/push/PR/finalize；唯一实现报告为本文件。*

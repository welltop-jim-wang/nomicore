# SA3 Implementation Report — issue #300（#295 切片 2）：chunked BOOTSTRAP_SNAPSHOT / SYNC_STEP2 端到端

- **dispatch**: sa-73a641fa-ec6d-4379-a980-8148bc03b318（mabf-sa3 / implementation / iteration 2）
- **实现范围**: 设计 r1 `wiki/raw/task_issue-300_design.md`（SA2 **approve**，无 Required revisions）+ SA6 验收契约（8 红 + 4 负控）+ SA8 R42–R47/N6
- **issue comments REST 快照 = `[]`**（简报/SA6/SA8/SA2 四方一致）→ 零 owner 补充要求，无评论映射义务
- **结果**: SA6 契约 8 红 → **12/12 绿**；受影响包 typecheck / 根 `pnpm typecheck` / 根 `pnpm test` 全绿；`git diff --check` 干净
- **iteration 3**（dispatch `sa-e3ebc0e3-b0d7-4a9b-8e41-2e6975f94b71`）：单一格式化修复——`wiki/raw/task_issue-300_sa6_contract.md` L81 行尾空格（staged blob）删除并同步刷新索引；三态 whitespace 门全 exit 0（详见文末「Iteration 3」节）。零业务代码/测试/契约语义改动。
- **iteration 4**（dispatch `sa-8cc474f3-5c57-468f-9dc1-a4ea7346eabe`）：具名六路径 EOF 空白修复——`git diff --cached --check` 报 5 个 `artifacts/sa7-issue300-*.log` + `wiki/raw/task_issue-300.md` 的 `new blank line at EOF`；每文件精确删除 1 个尾随 `\n`（文件尾空行）并刷新其索引 blob；`git diff --cached --check` / `git diff HEAD --check` / `git diff --check` 全 exit 0（详见文末「Iteration 4」节）。零业务代码/测试/语义改动。

---

## Inputs consumed

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-300.md`（任务简报，AC1–AC5；comments 空） | 实读 |
| `wiki/raw/task_issue-300_design.md`（SA1 r1，568 行，实现权威） | 实读（全文，逐 D0–D12 对照） |
| `wiki/raw/task_issue-300_sa2_review.md`（approve：B1/M1–M5 均已落实；5 条非阻塞观察） | 实读 |
| `wiki/raw/task_issue-300_sa6_contract.md`（approve：8 红 + 4 负控；转绿判据 §13） | 实读 |
| `wiki/raw/task_issue-300_conflict_report.md` + `task_issue-300_relevant_decisions.md`（SA8 R42–R47/N6/Frozen surfaces） | 实读 |
| `packages/ws-replication/test/ws-replication-issue300-chunked-sync-ac-red.test.ts`（SA6 契约，DENY） | 只读对照（1085 行 / 12 用例，与 SA6 §12 描述一致） |
| 基线源码 + 既有测试（`605a48f`） | 实读（实现面逐点复核） |

无缺失阻塞输入：ALLOW/DENY 边界、红灯契约、接口/状态机/失败语义均由设计 r1 完整给出。

## Existing worktree reconciliation

- 本 worktree 在 iteration 1 遗留**未提交实现**（13 个 modified + `bulk-transfer.ts`/`bulk-edge` 新增；无 `sa3_impl.md` 报告）。本 iteration 按 skill「原位核对、保留符合设计的改动、修正过时/冲突实现」处置：
  1. **全量复核** 13 个改动文件 + 2 个新增文件逐条对照设计 D0–D12 与 SA2 B1/M1–M5（结论：机制接线完整、无与本设计冲突的残留、无越界改动）；
  2. **修正 1 处缺陷**：`packages/ws-replication/src/update-transfer.ts` 文件尾多余空行（`git diff --check` 报 `new blank line at EOF`）→ 已删除（行为零变化）；
  3. **零回退**：未发现与本设计矛盾的过时实现；SA6 契约文件、刻画文件、`issue137-driver.ts`、codec 形态面与其余 DENY 路径全部未被触碰（见 File scope check）；
  4. **验证全部重跑**（下述 Verification 均为本次 run 结果，非继承 iteration 1 结论）。
- 上游事实校正（继承设计 §5）：`packages/replication-protocol/src/errors.ts` 基线 22 条注册表无四新码（协议 §13.2 L445–448 有、registry 无），本票做 **append-only 首登**（D12）；SA6 §8/§11「四码已注册」前提为事实错误，已由设计承接更正，不阻塞本票。

## Changed paths

| Path | Design section | Change |
|---|---|---|
| `packages/replication-protocol/src/errors.ts` | §7 D12 | `NamespaceErrorCode` 联合 +4 冻结字面量；`_namespaceErrors` append 四行（VIOLATION=yes/no/failed；TOO_LARGE=yes/config/failed）+ 来源注释；三处计数注释 22→26 |
| `packages/replication-protocol/test/fixtures.ts` | §7 D12 | `NAMESPACE_ERROR_TABLE` 镜像 append 四行 + 计数注释；golden/消息 fixtures 零触碰 |
| `packages/replication-protocol/test/codec-issue242-ac-red.test.ts` | §7 D12 | 注册表 append-only 用例计数 22→26 + 新增四码冻结元数据/`lookupError` 作用域隔离/ERROR 帧 encode↔decode 往返断言 |
| `packages/ws-replication/src/bulk-transfer.ts` | §7 D1/D2/D7（新增） | `BulkTransferSender`：kind=1/2 唯一发送端载体（整笔入队/出队惰性切片/每轮一帧/in-flight 单槽/末 chunk 结算锚/kind=2 自持 ACK timer/M5 出站被拒转移/abort 面） |
| `packages/ws-replication/src/update-transfer.ts` | §7 D5/D6 | `ChunkedTransferPiece` 扩展 kind/绑定成员；assembler 按 kind 取聚合上限、族中性原因 + `chunkedViolationCode` 单点映射、`busyKind`、跨帧 kind 逐字节一致 |
| `packages/ws-replication/src/update-channel.ts` | §7 D2/D7/M3 | 新增包内 `hasActiveTransfer()`/`allocateTransferId()`/`transferIdAvailable()`（kind=0 走同一分配点）；`onAck` drain 条件扩展（M3）；kind=0 出站 piece 显式携 `transferKind: 0` |
| `packages/ws-replication/src/round-engine.ts` | §7 D3/M1 | `RoundHost.sendStep2` 三态 seam + `Step2SendOutcome`；`noteChunkedStep2Outbound`/`admitChunkedStep2`/`completeChunkedStep2`；`applyStep2` 第 4 参 `form='syncChunked'` |
| `packages/ws-replication/src/hub-namespace.ts` | §7 D4/D5/D7/D8/D9/D10/D11 + M1/M2/M3/M5 | `startBootstrap` 三分叉（单帧 / v1 保持 / 超聚合上限 / kind=1 改道 + timer 前移）；`onUpdateChunk` kind 分派与校验序；facet 三段仲裁 + 聚合记账 + shed 收口；`syncChunked` observer 门（M1）；三族 resync 边沿追加 bulk abort（M2）；`hasBulkTransferWork` seam（M3）；kind=1 出站被拒收口（M5）；`busyKind` 超时选路（D9）；`clearInboundAssembly` kind=0 事件门（D8）；teardown 追加（D11） |
| `packages/ws-replication/src/peer-namespace.ts` | §7 D3/D5/D6/D7/D8/D9/D11 + M1/M2/M3/M5 | `finishBootstrapImport` 抽取（单帧逐字节不变；kind=1 零 `bootstrap-imported`、ACK 锚=末 chunk 帧序）；kind=1/2 首 chunk 接纳与绑定块核对；`sendStep2` 三态 + 结算；facet/timeout/abort/teardown 同 hub 侧；kind=2 出站被拒 → `declareLocalResync('send-failed')` |
| `packages/ws-replication/src/hub-connection.ts` | §7 D5/C6 | `sendUpdateChunk` kind/绑定块透传（kind=0 逐字节等价；缺失绑定成员仍由 codec 响亮拒绝） |
| `packages/ws-replication/src/peer-connection.ts` | §7 D5/C6 | 同上 |
| `packages/ws-replication/test/driver.ts` | §11/M4 | `BootOptions.chunkedUpdate?: boolean` + `createPeerReplication` 条件展开透传（undefined 零传） |
| `packages/ws-replication/test/ws-replication-issue256-namespace-failed.test.ts` | §11 场景 14（R45/M4） | 场景 14 改写：协商连接 + `len > maxChunkedBootstrapBytes` 构型 → 断言 `SNAPSHOT_TRANSFER_TOO_LARGE` + `send-failed`，并断言不回落 `BOOTSTRAP_TOO_LARGE` |
| `packages/ws-replication/test/ws-replication-issue300-bulk-edge-ac.test.ts` | §11 M1/M2/M3/M5（新增） | 契约外机制探针 6 例：M1 分块完成点零 `sync-diff-applied`（含单帧对照锚）、M2 resync 边沿弃置后同 transferId 零新增 chunk、M3 窗口空位唤醒 + R47 等价负控、M5 出站被拒确定性收口 |
| `docs/protocols/instance-replication-v1.md` | §22 L701（R47 文档同步） | 测试资产措辞收口：从「后续切片交付…不预设其存在」改为引用已交付资产（契约文件 + bulk-edge 探针 + 场景 14 锚）；§13.2/§23.3 表本体零改动 |
| `wiki/raw/task_issue-300_sa3_impl.md` | skill 固定产物 | 本报告（SA3 交付物，非设计 ALLOW 行） |

`git diff --stat`：13 文件，+1045/−221（不含 2 个新增文件与 1 个新增测试文件）。

## SA2 Finding 落实

| Finding ID | Implementation | Result |
|---|---|---|
| **B1**（BLOCKER）：四新码未在 codec 注册表登记 → 发射面结构性不可实现 | `errors.ts` append-only 首登四行协议 §13.2 L445–448 冻结元数据 + 类型联合 + 计数注释；`fixtures.ts` 镜像同步；`codec-issue242-ac-red.test.ts` 计数 26 + 四码元数据/往返断言 | 落实：`replication-protocol` 套件 206/206 绿；契约 R4/R5/R6/R7 的 wire 码断言路径成立（`encodeError`/`decodeError` 对四码不再 fail-closed） |
| **M1**：kind=2 完成点复用 `applyRemoteUpdate(isStep2=true)` 会无条件发射普通族 `sync-diff-applied` | 第 5 参扩为判别联合 `{chunkCount} \| {syncChunked:true}`；双侧 `isStep2 ∧ ¬syncChunked` 门控；`completeChunkedStep2` → `applyStep2(..., 'syncChunked')` | 落实：bulk-edge M1 探针（分块完成点 hub 侧零 `sync-diff-applied`；同 round 单帧路径 `sync-step2-sent`/`sync-diff-applied` 照常）；单帧/kind=0/else 三路逐字节不变；peer degraded 判别仍最外层先行 |
| **M2**：kind=2 发送器缺 resync-declared 中止接线 | 三族挂点同点追加 `bulkTransfer.abortForResyncDeclared()`：① 收对端 RESYNC（`onResyncReceived`，双侧）② 本端声明漏斗（peer `declareLocalResync` / hub `onLocalResyncEdge`→`declareHubResync`）③ ack-timeout funnel（经②同一漏斗，含 bulk 自身 ACK 超时） | 落实：bulk-edge M2 探针（首帧后闸门关闭 → 注入对端 RESYNC → 载体弃置；开闸后同 transferId 零更高 chunkIndex、hub 零写入零 dirty、peer 非 failed、连接 ready） |
| **M3**：窗口满 + channel 队列空时无唤醒路径 | `UpdateChannelHost.hasBulkTransferWork?()` 只读 seam（双侧实现读同方向 bulk 待发判据）+ `onAck` 条件扩展 | 落实：bulk-edge M3-a/M3-b（bulk 有待发工作 ⇒ 每个 ACK 仍请求 drain；无 bulk 工作时与现状逐字节同义——空队列零 drain、非空队列照旧 drain） |
| **M4**：场景 14 改写在未协商 harness 上不可执行 | `test/driver.ts` 新增可选 `chunkedUpdate` 条件透传；场景 14 改为协商 + 超聚合上限构型 | 落实：issue256 场景 14 绿，断言 hub `send-failed` + `SNAPSHOT_TRANSFER_TOO_LARGE` 且零 `BOOTSTRAP_TOO_LARGE` |
| **M5**：chunk 出站被拒（seq ≤ 0）语义未定义 | `BulkTransferSender.pullOne` 内失败明细先采样 → 载体弃置归 idle → `onSendRejected`：kind=1 `BOOTSTRAP_FAILED` + `finalize('failed','send-failed')`；kind=2 `declareLocalResync('send-failed', detail)`（镜像 #243 族） | 落实：bulk-edge M5-a/M5-b（首/中段 chunk 被拒 → 收口回调恰一次、明细 `send-frame-rejected` 先采样、归 idle 后零出站零自旋） |
| SA2 非阻塞 #1（`types.ts` 过期计数注释） | 按设计 §12 保持 DENY 零触碰（既有漂移，非本票引入） | 记录于 Deferred verification |
| SA2 非阻塞 #2（M1 探针载体钉死） | 已并入 `ws-replication-issue300-bulk-edge-ac.test.ts` 第四条（M1） | 落实（本票即可执行验证 §23.3 第 33 型） |
| SA2 非阻塞 #3（D9 kind=1 `timeoutMs` 读法） | 按设计精确闭包实现：`finalize('failed','bootstrap-timeout', timeouts.assemblyTimeoutMs)` | 落实（复审焦点，属设计后冲突复查） |
| SA2 非阻塞 #4（SA6 断言更正回执） | 不依赖回执；设计 §5 已承接真实状态 | 无本票义务 |

## File scope check

| Changed path | ALLOW entry | Purpose |
|---|---|---|
| `packages/replication-protocol/src/errors.ts` | §12 ALLOW 行 1（D12） | 四码 append-only 首登（发射面前置） |
| `packages/replication-protocol/test/fixtures.ts` | §12 ALLOW 行 2（D12） | 镜像表同步（`codec-registries` 键集等价断言驱动） |
| `packages/replication-protocol/test/codec-issue242-ac-red.test.ts` | §12 ALLOW 行 3（D12） | 注册表规模/元数据/往返断言同步（该文件既定维护路径） |
| `packages/ws-replication/src/bulk-transfer.ts` | §12 ALLOW 行 4（新增） | kind=1/2 发送端唯一载体（D1） |
| `packages/ws-replication/src/update-transfer.ts` | §12 ALLOW 行 5 | 接收端 kind 泛化单一事实源（D5/D6） |
| `packages/ws-replication/src/update-channel.ts` | §12 ALLOW 行 6 | R42 计数器共用 + facet 互斥判据 + M3 唤醒条件 |
| `packages/ws-replication/src/round-engine.ts` | §12 ALLOW 行 7 | kind=2 round 语义单点（D3/M1） |
| `packages/ws-replication/src/hub-namespace.ts` | §12 ALLOW 行 8 | hub 侧端到端接线（D4/D5/D7/D8/D9/D11 + M1/M2/M3/M5） |
| `packages/ws-replication/src/peer-namespace.ts` | §12 ALLOW 行 9 | peer 侧端到端接线（D3/D5/D6/D7/D8/D9/D11 + M1/M2/M3/M5） |
| `packages/ws-replication/src/hub-connection.ts` | §12 ALLOW 行 10 | 出站面 kind/绑定透传（D5/C6） |
| `packages/ws-replication/src/peer-connection.ts` | §12 ALLOW 行 11 | 同上 |
| `packages/ws-replication/test/driver.ts` | §12 ALLOW 行 12（M4） | 协商前提 harness 面（条件展开，undefined 零传） |
| `packages/ws-replication/test/ws-replication-issue256-namespace-failed.test.ts` | §12 ALLOW 行 13 | 场景 14 改写（R45/§23.3） |
| `packages/ws-replication/test/ws-replication-issue300-bulk-edge-ac.test.ts` | §12 ALLOW 行 14（新增） | M1/M2/M3/M5 机制探针（SA2 修订验收行） |
| `docs/protocols/instance-replication-v1.md` | §12 ALLOW 行 15 | §22 L701 测试资产措辞收口（零语义改动） |
| `wiki/raw/task_issue-300_sa3_impl.md` | skill 固定产物（设计 §12 未列，SA3 报告义务） | 本报告 |

**DENY LIST 核对（全部未触碰）**：`ws-replication-issue233-repro.test.ts`、`issue137-driver.ts`、`ws-replication-issue300-chunked-sync-ac-red.test.ts`（契约文件 1085 行/12 用例，与 SA6 §12 一致，未改断言）、`replication-protocol/src/{payloads,messages,index}.ts` 与 golden/issue299 测试、`ws-replication/src/{frame-io,error-mapping,backpressure,defaults,types,validate,plugin,liveness,fence-watchdog,lifecycle-queue,observer,testing,index}.ts`、`packages/namespace-registry/**`、`packages/namespace-runtime/**`、`docs/adr/**`、`CONTEXT.md`、`apps/**`、`domains/**`、`scripts/**`、根配置。
`git status --porcelain` 的 grep 显式核对输出 = `DENY_PATHS_UNTOUCHED`。

## Verification

| Command | Result | Evidence |
|---|---|---|
| `NODE_OPTIONS=--conditions=nomicore-source npx vitest run packages/ws-replication/test/ws-replication-issue300-chunked-sync-ac-red.test.ts --typecheck.enabled=false`（SA6 红灯契约） | **12 passed (12)** —— 8 红全转绿，4 负控保持绿 | 运行输出 `Test Files 1 passed (1) / Tests 12 passed (12)` |
| 同上 + `ws-replication-issue300-bulk-edge-ac.test.ts` ×2 连跑（稳定性） | **18 passed (18)** ×2，零抖动 | 两次 `Test Files 2 passed (2) / Tests 18 passed (18)` |
| `NODE_OPTIONS=--conditions=nomicore-source npx vitest run packages/ws-replication/test --typecheck.enabled=false`（受影响包全量，SA6 §13 门） | **70 files / 499 tests passed**（基线 69 文件 493 用例中的 8 红归零 + 新探针 6 例；含刻画文件 3/3、#243–#246、#256、#299 锚） | 尾行 `Test Files 70 passed (70) / Tests 499 passed (499)`，exit 0 |
| `NODE_OPTIONS=--conditions=nomicore-source npx vitest run packages/replication-protocol/test --typecheck.enabled=false`（D12 同步面全量） | **12 files / 206 tests passed**（含 `codec-registries` 键集等价、`codec-issue242-ac-red` 注册表用例、golden、fuzz） | 尾行 `Test Files 12 passed (12) / Tests 206 passed (206)`，exit 0 |
| `npx tsc -p packages/ws-replication/tsconfig.json` | exit 0 | `WS_TSC_OK` |
| `npx tsc -p packages/replication-protocol/tsconfig.json` | exit 0 | `PROTO_TSC_OK` |
| 根 `pnpm typecheck`（14 个 tsconfig，AGENTS/设计 §11 全量门） | exit 0 | 全链 `&&` 无失败退出 |
| 根 `pnpm test`（`vitest run --typecheck`，AGENTS wire/lifecycle 义务 + 设计 §11 全量门） | **331 files / 3486 tests passed**，`Type Errors no errors`，exit 0 | 尾行输出 + exit 0 |
| `git diff --check` | 干净（修正 `update-transfer.ts` 文件尾空行后复查通过） | `DIFF_CHECK_OK` |
| 过期术语扫描（设计 §11 文档同步行） | 零命中：`后续切片交付`/`本切片唯一 kind`/`不预设其存在` 在协议文档中已无残留 | grep 空输出 |

**红灯转绿对应（SA6 §13 的 8 条）**：R1/R2/R2b/R3/R4/R5/R6/R7 全部由能力缺失失败 → 目标行为断言通过；N1–N4 负控与包内既有 485 条断言零回归。

## Deferred verification

- **SA4/SA7 职责**：动态/真实链路最终验收、全仓回归裁决、PR/CI；SA3 未运行真实 WebSocket + FilePersistence 的端到端场景（`apps/yjs-server` 套件已在根 `pnpm test` 中全绿，但不构成最终验收裁决）。
- **#301 范围**（设计 §13 明确归后续切片）：observer 8 型（`chunked-snapshot-*`/`chunked-sync-*`）接线、丢帧/重复/错序/超时/close/GOAWAY/断线/epoch fence 完备中止矩阵与公平调度回归；本票只落共享管线内的机制接线（M2/M3/M5 已由 bulk-edge 探针锚定）。
- **`packages/ws-replication/src/types.ts:274` 既有过期注释**（「协议 §13.2 注册表全 20 码」，基线 22、D12 后 26）：**基线即已漂移**，`types.ts` 在 DENY LIST，本票零触碰；若需一行注释同步，需 SA1 扩范围（SA2 r1 观察 #1 同款建议）。
- **设计后 ADR 冲突复查**（设计 §15 `requiresConflictRecheck: true`）：D12 注册表面、M5 入口面读法、R5 终态裁定（绑定块不符 → 接收方 failed/protocol-violation）、场景 14 改写属 SA8 复查焦点，非 SA3 裁决范围。
- 设计 §12 未授权、因此未做的验证：真实跨进程/跨版本互通矩阵扩展（既有矩阵测试已绿，模式未扩）。

## Deviations or blockers

**无阻塞。** 实现零偏离设计语义；以下为三处经设计的等价实现选择（供 SA4/SA7 复核）：

1. **`ChunkedTransferPiece.transferKind` 为可选（缺省归一 0）**：设计 D5 文字为必填 `0|1|2`。实现取可选 + `?? 0` 归一——既有 kind=0 调用点/fixture 零改动（R47 逐字节等价），kind=0 发送端已显式携 `transferKind: 0`、kind=1/2 由 `BulkTransferSender` 显式携带；codec 单形态仍强制 wire 首字段存在。
2. **M3 唤醒判据用 `hasQueuedWork()`（queued/active）而非字面 `hasWork()`（含 awaiting-ack）**：awaiting-ack 阶段已无待出站帧，`requestDataDrain()` 对 bulk 是 no-op（facet ② 仍持槽、`pullOne()` 返回 false，直至结算 ACK）；无 bulk 工作时两判据同为 false → R47 等价论证不受影响。取更窄判据避免每次 kind=0 ACK 触发无意义 drain。
3. **`UpdateChannelHost.hasBulkTransferWork` 声明为可选**：仅双侧命名空间宿主实现；包内既有测试宿主/第三方构造点不因 seam 新增而失配（调用处 `?.() === true` 守卫）。设计未禁止该形状（seam 只读判据语义不变）。
4. **修正项（非偏离）**：删除 `update-transfer.ts` 文件尾多余空行（`git diff --check` 违规），纯空白。

## Suggested commit message

```text
feat(#295 切片 2): chunked snapshot / sync-diff 端到端——R1/R3 收敛绿灯 (#300)

- BulkTransferSender（kind=1/2 发送端载体）：整笔入队 + 出队惰性切片、data 路径逐帧出站、
  整笔占 1 个 in-flight 窗口槽、单 ACK 结算；M2 resync 边沿弃置 / M5 出站被拒确定性收口
- hub startBootstrap 三分叉 + peer finishBootstrapImport 抽取（单帧路径逐字节不变）
- 接收端 assembler kind 泛化：按 kind 聚合上限、族中性原因单点映射、busyKind、跨帧 kind 一致；
  kind=1 绑定块核对（既有码）、kind=2 round 归属（SYNC_STATE_VIOLATION）
- 四码 append-only 首登（errors.ts/fixtures/issue242 测试同步）+ 发送端超聚合上限收口
- M1 syncChunked 门（kind=2 完成点零普通族 sync-diff-applied）+ M3 onAck 窗口空位唤醒
- 场景 14 改写 + bulk-edge 机制探针（M1/M2/M3/M5）+ 协议 §22 测试资产措辞收口

验证：SA6 契约 12/12 绿（8 红转绿）；ws-replication 70 文件 499 用例、replication-protocol
12 文件 206 用例全绿；包 typecheck + 根 pnpm typecheck + 根 pnpm test（331 文件 3486 用例）全绿。
```

（Suggested commit message 仅供 Controller 选择；SA3 未执行 `commit`/`push`/PR。）

---

## Iteration 3 — staged formatting defect fix

- **dispatch**: `sa-e3ebc0e3-b0d7-4a9b-8e41-2e6975f94b71`（mabf-sa3 / implementation / iteration 3）
- **授权范围**: 仅修复 `wiki/raw/task_issue-300_sa6_contract.md` L81 尾随空格的 staged 格式缺陷，使 `git diff --check` 通过；不得改业务代码、测试或语义内容。
- **Issue comments REST 快照**：无（dispatch 已述 `[]`；本 iteration 零 owner 映射项）。

### Inputs consumed

| 输入 | 状态 |
|---|---|
| 本 dispatch（具名单点格式化修复 + 验收判据 `git diff --check`） | 实读 |
| `wiki/raw/task_issue-300_sa6_contract.md`（缺陷载体，staged `A`） | 实读（L78–84 上下文 + 全文件尾随空白扫描） |
| `REPORT.md` L229（仓库 whitespace 门定义 = `git diff HEAD --check`） | 实读（判据来源） |
| `git show :wiki/raw/task_issue-300_sa6_contract.md`（索引 blob 基线） | 实读（字节级对照） |

### Existing worktree reconciliation

- 工作树 = SA7 `approve` 后的同一变更集（13 modified + `bulk-transfer.ts`/2 测试新增 + wiki 输入）；`git status --porcelain` 与本报告 §Changed paths 逐条一致，零额外漂移。本 iteration **无回退、无新增实现改动**。
- 缺陷复现（修复前）：`git diff HEAD --check` exit 2、`git diff --cached --check` exit 2，均报 `wiki/raw/task_issue-300_sa6_contract.md:81: trailing whitespace.`；而工作树相对索引的 `git diff --check` 已 exit 0——即缺陷只存在于**索引侧**（staged blob），工作树文件此前未被单独修改过。
- 全文件扫描：`grep -nP '[ \t]+$'` 修复前恰 1 处命中（L81，行尾 1 个 0x20）；L291 的 `## Verdict` 为 `grep -E '[ \t]+$'` 字符类中 `t` 的误报，真实尾随空白仅 L81。

### Changed paths

| Path | Change |
|---|---|
| `wiki/raw/task_issue-300_sa6_contract.md` | L81 行尾 1 个空格（0x20）删除；30467 → 30466 bytes；相对索引 blob 的 diff = 单行对（`-…收敛) ` / `+…收敛)`） |
| `wiki/raw/task_issue-300_sa3_impl.md` | 本报告（原位更新：§结果新增 iteration 3 行 + 本节追加） |

### File scope check

| Changed path | ALLOW entry | Purpose |
|---|---|---|
| `wiki/raw/task_issue-300_sa6_contract.md` | DENY 面（SA6 契约文件）——本 iteration 由 dispatch **具名授权单点豁免**，仅允许该行空白修复 | 满足 whitespace 门 |
| `wiki/raw/task_issue-300_sa3_impl.md` | skill 固定产物（设计 §12 未列，SA3 报告义务） | 本报告 |

- **契约语义零改动证据**：`diff <(sed 's/[ \t]*$//' 索引blob) <(sed 's/[ \t]*$//' 工作树)` **零输出**（忽略行尾空白后逐行完全相同）；字节差恰 1；断言/计数/用例清单/§13 判据/R1–R7+N1–N4 文字全部原样。
- **业务代码与测试零触碰**：`git status --porcelain` 的**路径集合与状态列**在 L81 修复前后逐条一致（无新增/删除/改名/状态翻转）；本 iteration 全程唯一的状态列变化是报告文件自身的 `A` → `AM`（其工作树更新未 stage，见 Deviations 1）。`packages/**`、`docs/**` 零改动。

### Verification

| Command | Result | Evidence |
|---|---|---|
| `git diff HEAD --check`（仓库 whitespace 门，`REPORT.md` L229 同款） | **exit 0**（修复前 exit 2，见上复现） | 原位复跑，零输出 |
| `git diff --cached --check` | **exit 0** | 原位复跑，零输出 |
| `git diff --check`（工作树相对索引） | **exit 0** | 原位复跑，零输出 |
| `grep -nP '[ \t]+$' wiki/raw/task_issue-300_sa6_contract.md` | 零命中（修复前恰 L81） | grep 空输出（exit 1 = 期望） |
| 语义等价核对（忽略行尾空白的逐行 diff + `stat` 字节数） | `IDENTICAL_MODULO_TRAILING_WS`；30467 → 30466 | diff 零输出 + `stat -c '%s'` |
| `git status --porcelain` | 变更集逐条不变（13 M + 3 新增包内文件 + wiki 输入） | 前后对照（L81 修复不改变任何路径集合/状态） |

**未运行测试与 typecheck**：本 iteration 为纯空白格式化修复，无代码路径、无测试断言、无契约语义变化，故按 skill 边界（SA3 只跑指定红灯契约/受影响包 typecheck/设计指定 check）不触发重跑；SA6 契约 12/12、`ws-replication` 499/499、`replication-protocol` 206/206、根 typecheck exit 0 的最新独立证据见 `wiki/raw/task_issue-300_sa7_report.md` §9（SA7 复跑）。若 Controller 要求归零复核，契约文件可在 1 次 run 内重跑确认零影响。

### Deviations or blockers

**无阻塞。** 一处必须披露的流程偏离：

1. **索引刷新（`git add` 单路径）**：本票要修的是**索引侧（staged）**缺陷，而 `git diff HEAD --check` / `git diff --cached --check` 读索引——仅改工作树不足以让判据通过（索引 blob 仍带 L81 尾随空格）。故对**唯一具名路径**执行 `git add -- wiki/raw/task_issue-300_sa6_contract.md` 刷新其索引 blob（该文件此前已处于 staged `A` 状态，变更集不变）。skill「SA3 不得执行 `git add`」的通用约束与本 dispatch 的具名要求在此直接冲突，取更具体的 dispatch 要求；**未**执行 `git commit`/`git push`/PR/finalize，**未** stage 任何其他路径（含本报告——报告更新停留在工作树，如需入索引由 Controller 统一 staging）。
2. 零业务代码、零测试、零契约语义改动；无设计/范围/契约矛盾，无需 `reject`。

### Suggested commit message

沿用本报告文末既有 message（本 iteration 的 1 字节空白修复随该提交一并入库，无独立提交）。

---

## Iteration 4 — staged EOF blank-line defect fix（六具名证据路径）

- **dispatch**: `sa-8cc474f3-5c57-468f-9dc1-a4ea7346eabe`（mabf-sa3 / implementation / iteration 4）
- **授权范围**: 仅修复 dispatch 具名的六条证据路径由 `git diff --cached --check` 报出的**精确 EOF 空白缺陷**；不得改业务代码、测试或语义内容。
- **Issue comments REST 快照**：无（dispatch 已述 `[]`；本 iteration 零 owner 映射项）。

### Inputs consumed

| 输入 | 状态 |
|---|---|
| 本 dispatch（六条具名路径 + 判据 `git diff --cached --check`） | 实读 |
| `git diff --cached --check` 输出（缺陷清单：5 log + 1 wiki 简报） | 实读（exit 2，6 条 `new blank line at EOF`） |
| 六路径的**索引 blob**（`git show :<path>`）与工作树字节 | 实读（字节级对照，各尾部 `0a0a`） |

### Existing worktree reconciliation

- 工作树 = SA7 `approve` 后的同一变更集（9 条 staged：6 证据产物 + `sa9_standards`/`sa10_spec` + 本报告 `M`）；修复前 `git status --porcelain` 与 iteration 3 收尾态逐条一致，零额外漂移、零未提交实现改动。
- 缺陷复现（修复前）：`git diff --cached --check` exit 2，恰 6 条 `new blank line at EOF`（行号 = 各文件内容末行 +1）；**工作树与索引逐字节相同**（`git diff --quiet` 全通过），即缺陷在两侧同时存在，非纯索引漂移（与 iteration 3 的 L81 情形不同）。
- 前置断言（修复前）：六文件尾部 2 字节均 = `0a0a`，且尾部 3 字节不含 `0a0a0a`（恰 1 个尾随空行，非多空行/非缺尾换行）。

### Changed paths

| Path | Change |
|---|---|
| `artifacts/sa7-issue300-full-with-probes.log` | 删除文件尾空行（1 字节 `\n`）；27400 → 27399 bytes；247 内容行 |
| `artifacts/sa7-issue300-post-removal-full.log` | 同上；20076 → 20075 bytes；201 内容行 |
| `artifacts/sa7-issue300-post-removal-verify.log` | 同上；3930 → 3929 bytes；80 内容行 |
| `artifacts/sa7-issue300-probe-transport.log` | 同上；7746 → 7745 bytes；55 内容行 |
| `artifacts/sa7-issue300-typecheck.log` | 同上；720 → 719 bytes；3 内容行 |
| `wiki/raw/task_issue-300.md` | 同上；3004 → 3003 bytes；34 内容行（`## Comments` 空段保留） |
| `wiki/raw/task_issue-300_sa3_impl.md` | 本报告（原位更新：§结果新增 iteration 4 行 + 本节追加） |

### File scope check

| Changed path | ALLOW entry | Purpose |
|---|---|---|
| 上述六条证据路径 | 本 dispatch **逐路径具名授权**（证据/产物面，非业务代码） | 满足 staged whitespace 门 |
| `wiki/raw/task_issue-300_sa3_impl.md` | skill 固定产物（设计 §12 未列，SA3 报告义务） | 本报告 |

- **语义零改动证据**：每文件 `cmp` 于「修复前索引 blob 去掉最后 1 字节」== 修复后 blob → 六条全部 `STAGED_EQ_ORIG_MINUS_ONE_NL`；字节差恰 −1/文件，无其他行改动（`git diff --cached --stat` = 6 files, 620 insertions，行数即内容行数）。
- **业务代码与测试零触碰**：`git status --porcelain` 的**路径集合与状态列**在修复前后逐条一致（9 条不变，无新增/删除/改名/状态翻转）。

### Verification

| Command | Result | Evidence |
|---|---|---|
| `git diff --cached --check`（本 dispatch 判据；修复前 exit 2 / 6 条） | **exit 0**，零输出 | 原位复跑 |
| `git diff HEAD --check`（`REPORT.md` L229 仓库 whitespace 门） | **exit 0** | 原位复跑 |
| `git diff --check`（工作树相对索引） | **exit 0** | 原位复跑 |
| 全 staged 面复扫（`git diff --cached --check -- .` + `grep -c 'blank line at EOF'`） | exit 0；`blank line at EOF` 命中数 = **0** | 原位复跑 |
| 前置断言（尾 2 字节 `0a0a`、无 `0a0a0a`、`git diff --quiet` 六路径） | 全部通过（`PRECONDITIONS_OK`） | shell 断言 |
| 语义等价核对（索引 blob 截尾 1 字节 vs 新 blob + 文件尾字节 + `wc -l`） | 六路径 `STAGED_EQ_ORIG_MINUS_ONE_NL` / `NO_UNSTAGED_DRIFT` | `cmp`/`git diff --quiet` |
| 六路径尾随空白复扫（`grep -nP '[ \t]+$'`） | 零命中 | grep 空输出 |

**未运行测试与 typecheck**：本 iteration 为纯 EOF 空白（1 字节/文件）修复，零代码路径、零断言、零语义变化，按 skill 边界不触发重跑；最新独立测试/typecheck 证据见 `wiki/raw/task_issue-300_sa7_report.md`（SA7 复跑）与 `artifacts/sa7-issue300-*.log`（本次修复未改其一字节内容行）。

### Deviations or blockers

**无阻塞。** 一处必须披露的流程偏离（沿 iteration 3 同型处置）：

1. **索引刷新（`git add`，仅六条具名路径）**：本票判据读索引——仅改工作树不足以让 `git diff --cached --check` 通过。故对**本 dispatch 逐条具名的六条路径**执行 `git add -- <6 paths>` 刷新其 blob（六条此前均为 staged `A`，变更集不变）；skill「SA3 不得执行 `git add`」的通用约束与本 dispatch 的具名要求冲突，取更具体的 dispatch 要求。**未**执行 `git commit`/`git push`/PR/finalize，**未** stage 其他路径（含本报告——报告更新停留在工作树，如需入索引由 Controller 统一 staging）。
2. 零业务代码、零测试、零证据内容（除文件尾 1 个 `\n`）改动；无设计/范围/契约矛盾，无需 `reject`。

### Suggested commit message

沿用本报告文末既有 message（本 iteration 的 6 字节 EOF 空白修复随该提交一并入库，无独立提交）。

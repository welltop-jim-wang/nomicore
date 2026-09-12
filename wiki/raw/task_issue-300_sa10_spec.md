# SA10 独立 Spec 审查 — issue #300（#295 切片 2）：chunked BOOTSTRAP_SNAPSHOT / SYNC_STEP2 端到端

- **dispatch**: sa-c59dec12-f522-47cc-8e8a-aea6391f5f99（mabf-sa10 / spec-review / iteration 0）
- **审查对象**: 已提交交付 diff `749de8e8a40a133ec3ed2118deb7efa349307317`（`feat(replication): chunk oversized snapshots and sync diffs`），父提交实测 = `605a48f284c856033761cd2320fa937d1e8c9f0a`（PR #298 head / #299 合并点，与 dispatch 声明一致）
- **对照基准**: issue #300 正文（`wiki/raw/task_issue-300.md`，What-to-build + AC1–AC5）、SA6 验收契约（`task_issue-300_sa6_contract.md`，approve，8 红 + 4 负控）、ADR 0022（`docs/adr/0022-chunked-sync-transfer.md`）、规范协议（`docs/protocols/instance-replication-v1.md`，wire 冻结值唯一权威）
- **Issue comments REST 快照 = `[]`**（dispatch 声明；简报/SA6/SA8/SA2/SA3/SA4/SA7 七方一致）→ 零 owner 评论映射义务
- **Verdict**: **approve**（1 条需 PR 披露的正文解读项 + 已登记归口项若干；无 partial/unmet/unachievable AC）

---

## 1. 审查方法与证据

- 逐文件实读已提交 diff 全部 16 个仓内文件（git show 逐 hunk）：`errors.ts`、`fixtures.ts`、`codec-issue242-ac-red.test.ts`、`bulk-transfer.ts`（新增 266 行，全文）、`update-transfer.ts`、`update-channel.ts`、`round-engine.ts`、`hub-namespace.ts`、`peer-namespace.ts`、`hub-connection.ts`、`peer-connection.ts`、`driver.ts`、`issue256` 场景 14、`issue300-chunked-sync-ac-red.test.ts`（契约，1085 行全文）、`issue300-bulk-edge-ac.test.ts`（538 行全文）、`instance-replication-v1.md` §22 L701。
- 规范逐条对照：ADR 0022 L12/L14–18/L20–43/L45–51/L52–64/L66–83/L96–116；协议 §5/§8.1–8.2/§9.2–9.4/§10.3/§13.2（L445–448 四码表逐值）/§16/§17/§18/§22（L701）/§23.3（L814 场景 14 行）。
- 冻结面独立性核对（实测，非引用上游结论）：`git diff 605a48f..749de8e --name-only` 全集 = 设计 ALLOW 清单 16 文件 + 9 个 wiki 产物，零越界；刻画文件 `ws-replication-issue233-repro.test.ts` 与 `issue137-driver.ts` **不在** diff 中（零触碰 ✓）；DENY 面（`frame-io.ts`/`backpressure.ts`/`defaults.ts`/`types.ts`/`validate.ts`/`error-mapping.ts`/`src/index.ts`/codec `messages.ts`/`payloads.ts`）经 `git show --stat -- <paths>` 扫描零命中；`CAP_CHUNKED_SYNC` 全仓零命中；`git diff 605a48f..749de8e --check` exit 0（交付 diff 无 whitespace 缺陷）；契约文件尾随空白扫描零命中。
- 工作树漂移核对：未提交改动仅 `wiki/raw/task_issue-300_sa3_impl.md`（SA3 iteration-3 报告补记，非业务面）+ untracked SA7 证据日志与 Host 简报——不影响已提交交付的审查结论。
- 测试运行证据按职责边界**引用** SA3/SA7 产物而不复跑（SA10 不运行测试）：`artifacts/sa7-issue300-post-removal-full.log`（70 文件 499 用例全绿）、`sa7-issue300-typecheck.log`（根 typecheck 全链 exit 0）、`sa7-issue300-probe-transport.log`（16 条真实 TCP 观测行）在库。

## 2. Issue 正文要求逐项核对（What-to-build）

| 正文要求 | 实现落点（已提交 diff 实读核对） | 判定 |
|---|---|---|
| 超 `maxBootstrapBytes` → kind=1 chunk 序列改道（恒用机制，触发条件非兼容回落） | `hub-namespace.ts` `startBootstrap` 三分叉：`bytes > maxBootstrapBytes` 才进入改道判定；未协商 → v1 保持 `BOOTSTRAP_TOO_LARGE`（R43 裁决面）；超 `maxChunkedBootstrapBytes` → `SNAPSHOT_TRANSFER_TOO_LARGE` + `finalize('failed','send-failed')`；其余 → `bulkTransfer.enqueue(kind=1)`，绑定块 `{replicationId, replicationEpoch}` 取自 OPEN_OK 身份重读 | 满足 |
| 双向 SYNC_STEP2 diff 超 `maxSyncDiffBytes` → kind=2 改道 | 双端 `sendStep2` 三态（`Step2SendOutcome` single/chunked/refused），D0 判据四分（超限 ∧ 已协商 ∧ ≤ 聚合上限 ∧ transferId 域未尽）→ kind=2 enqueue；hub/peer 两侧实现逐字同构 | 满足 |
| data 路径逐帧出站：独立 sequence、dataGateOpen、RR 调度、整笔占 1 in-flight 槽、队列持完整载荷出队惰性切片、control reserve 零 chunk | `BulkTransferSender`：入队持完整载荷（计入 facet queued 账本），`pullOne()` 出队时刻 `chunkBounds` 惰性切片、每轮至多一帧；出站经 `sendUpdateChunkFrame → host.sendUpdateChunk → sender.tryEmitData`（ready 门 + 水位闸门 + 连接总压账本 + 序列由 OutboundQueue 分配）；窗口空位起始判据 `windowHasRoom` + facet 三段仲裁（kind=0 在途先行 → bulk → channel live 路径）使整笔期间本方向不开新 kind=0 transfer；control 队列结构性零 chunk（chunk 不经 control 出站点） | 满足 |
| 未超单帧上限载荷仍走单帧路径 | 单帧分支逐字节保留（含 `sync-step2-sent`/`bootstrap-snapshot-sent` 观测与发送后 armTimer 次序）；负控 N1/N2 断言零 kind≠0 chunk | 满足 |
| 接收端 assembler kind 泛化，作用域 (连接,方向,namespaceId,transferId)，bootstrap 期无 Lease 按 namespaceId 记账 | `UpdateChunkAssembler` 持 `maxChunkedBootstrapBytes`/`maxChunkedSyncDiffBytes` 可选上界；装配作用域与并发上限机制零改动（per (ns,方向) 单 assembly + 连接级 `maxConcurrentAssembliesPerConnection`，记账键 namespaceId）；kind=1/2 记账不经 Lease（`admitBootstrapChunk` 只用 OPEN_OK 身份） | 满足 |
| 首 chunk 绑定块核对：kind=1 → `REPLICATION_ID_MISMATCH`/`REPLICATION_EPOCH_MISMATCH`；kind=2 → `SYNC_STATE_VIOLATION` | peer `admitBootstrapChunk`：状态门（bootstrapping ∧ OPEN_OK 身份已知）→ replicationId/epoch 逐项核对 → 既有码 + `failed/protocol-violation`（先于一切资源判定）；`round.admitChunkedStep2`：`hasActiveRound ∧ syncRoundId === currentRound ∧ ownStep1Seq ≠ undefined ∧ !receivedStep2`，不符 → 既有 `SYNC_STATE_VIOLATION` + failed | 满足 |
| 分配前二维校验（totalBytes ≤ 按 kind 聚合上限 ∧ chunkCount ≤ maxChunksPerUpdate）→ 一次性分配 detached buffer | 控制器 count 门（`chunkCount > maxChunksPerUpdate` → TOO_LARGE 族，`>` 判定含等号接纳）先于 assembler；assembler `validateFirst`：bytes ≤ maxUpdateBytes ∧ totalBytes ≥ 1 ∧ bytes ≤ totalBytes ∧ totalBytes ≤ 按 kind 聚合上限（TOO_LARGE）∧ `geometryConsistent`（chunkCount ≥ 1 ∧ totalBytes ≤ chunkCount × maxUpdateBytes，VIOLATION）——全部先于 `new Uint8Array(totalBytes)` 一次性分配（R44 全四条在库） | 满足 |
| 收齐长度精确核对 → 一次 sequenced apply / 排他复制导入 → 单 BOOTSTRAP_ACK / SYNC_APPLIED（durability 不变，重组失败零写入） | `completeIfExact`：Σbytes === totalBytes 才产 'complete'；kind=1 完成点 `finishBootstrapImport`（与单帧同一续体，detached apply + META identity + 排他导入，`bootstrap-imported` 显式不发射）后发单 BOOTSTRAP_ACK（`ackedSequence = 末 chunk 帧序`）；kind=2 完成点 `round.completeChunkedStep2` → `applyStep2(...,'syncChunked')` 一次 apply + 单 SYNC_APPLIED 同锚；一切违例先于 apply（契约 R4–R7 零写入/零 dirty 断言在库） | 满足 |
| 错误映射四新码（fatal/config/failed；fatal/no/failed）+ 绑定块既有码 | `errors.ts` append-only 首登四行，元数据逐值 = 协议 §13.2 L445–448（实读比对：VIOLATION=true/no/failed ×2；TOO_LARGE=true/config/failed ×2）；既有 22 条零改动、死码 `BOOTSTRAP_TOO_LARGE`/`SYNC_DIFF_TOO_LARGE` 保留；发射点 = 接收端首 chunk 校验/跨帧违例（`chunkedViolationCode` 单点映射）+ 发送端聚合超限预检（R45 设计选择） | 满足 |
| R1/R3 端到端绿灯 + 刻画文件不改 | 刻画文件与 `issue137-driver.ts` 零触碰（git 实测）；新增收敛绿灯 = 契约 12 用例（R1 kind=1 收敛 / R2·R2b 双向 kind=2 收敛，R2 构型 = 100KB 写 + `maxSyncDiffBytes=32KiB` 即 R3 构型逐字 / R3 data 闸门 / R4–R7 校验与违例族 / N1–N4 负控）+ bulk-edge 6 探针 + 场景 14 改写锚；**R1 构型解读项见 §4-1（PR 必须披露）** | 满足（含 §4-1 披露义务） |

## 3. 验收标准（AC1–AC5）逐项核对

| AC | 证据 | 判定 |
|---|---|---|
| AC1：snapshot 超限 → kind=1 完成初始同步；BOOTSTRAP_ACK 在导入完成后结算（ackedSequence = 末 chunk 帧序） | 契约 R1 断言：peer 收敛 live、零单帧 BOOTSTRAP_SNAPSHOT、恰一 BOOTSTRAP_ACK 锚末 chunk 序、逐字收敛；hub 侧 `bootstrapSnapshotSeq` 在 `onLastChunkSent` 同一同步栈锚定（先于任何合法 ACK）；SA7 RT 真实 TCP 双 peer 复证（13 chunk / Σ=totalBytes / ackedSequence=末 chunk 序） | met |
| AC2：diff 超限 → kind=2 完成恢复同步；SYNC_APPLIED 在一次 apply 后结算 | 契约 R2（peer→hub）/R2b（hub→peer）：kind=2 序列、恰一 SYNC_APPLIED 锚末 chunk 序、零 ERROR、收敛；`ownStep2Seq` 锚 = 末 chunk 帧序（`noteChunkedStep2Outbound`）；R42 跨 kind 计数器单调断言在库 | met |
| AC3：每 wire frame ≤ 既有 frame 与 per-chunk 上限；字节纳入 data 路径 backpressure 记账；control reserve 零 chunk | 契约 `expectWellFormedTransfer`（每 chunk ≤ maxUpdateBytes、几何一致、Σ=totalBytes）+ `expectFrameBounds`（≤ maxFrameBytes）；R3 data 闸门：关闸零 chunk 出站、终局不由控制帧判定、开闸后经 data 路径完成；facet 账本 = channel + bulk 聚合（shed/RR 可见） | met |
| AC4：绑定块违例映射既有码；声明超限/跨帧违例映射四新码（fatal/terminal failed，retryable 对齐既有族） | 注册表元数据逐值 = §13.2 冻结行（实读）；契约 R4（kind=1 声明/几何 + 恰在上界 ≤ 含等号接纳边界锚）/R5（绑定块 → REPLICATION_ID_MISMATCH/REPLICATION_EPOCH_MISMATCH，本地 failed）/R6（kind=2 跨帧漂移 → SYNC_TRANSFER_VIOLATION；syncRoundId 漂移 → SYNC_STATE_VIOLATION）/R7（声明超聚合 → SYNC_TRANSFER_TOO_LARGE，终局 failed + 零写入 + 不回落 SYNC_DIFF_TOO_LARGE） | met |
| AC5：R1/R3 构型收敛绿灯测试新增（刻画文件不动）；接收端只在完整重组后一次 apply，partial failure 零写入 | 新增测试在库且被真实 runner 收集（SA7 post-removal 22/22 绿）；刻画文件 git 实测零触碰；一次 apply 结构性成立（assembler 收齐才产 complete）+ R4–R7 零写入/零 dirty 行为断言；**「R1 构型」绿灯的逐字读法与交付解读见 §4-1** | met（含 §4-1 披露义务） |

## 4. 必须在 PR 披露的未达成/解读项

1. **【解读项，MINOR，不阻断】issue 正文「R1 构型（单笔 20KB 合法写 + maxUpdateBytes=8KiB）恢复 diff 经 data 路径分块」的逐字读法在其自身冻结约束下不可实现**：缺省 `maxSyncDiffBytes=2MiB`（`defaults.ts` 实测），R1 构型的 ≈20KB 恢复 diff 不超单帧上限，按同段正文「未超单帧上限的载荷仍走单帧路径（触发条件，非兼容回落）」必须保持单帧；且协商连接下 R1 构型的 20KB 写本身可分块（kind=0，≤ 缺省 4MiB 聚合上限），根本不产生恢复 diff。交付的实际绿灯覆盖 = 同族机制的实质修复：契约 R2/R2b（恢复 diff 超 `maxSyncDiffBytes` → kind=2 经 data 路径，且显式断言「不得出现超 maxSyncDiffBytes 的单帧 SYNC_STEP2（R1 结构性绕行修复）」）、契约 R3（data 闸门关闭时终局不由控制帧判定）、R2 phase A/N4（R1 构型 20KB 载荷本身经 kind=0 data 路径分块、零控制帧绕行）；R3 构型绿灯（100KB 写 + maxSyncDiffBytes=32KiB 收敛、零终局失败）为逐字命中（契约 R2）。该解读与 ADR 0022 L102「以分块构型新增收敛绿灯测试、不改刻画文件」一致，SA6→SA8 全链同解。PR 应如实披露此解读，避免「R1 构型 20KB 恢复 diff 已分块」的字面声明。
2. **归 #301 的切片边界（计划内中间态，须随 PR 披露）**：observer 8 型（`chunked-snapshot-*`/`chunked-sync-*`）接线未做（R46 边界；当前分块结算点普通族事件经 M1 门控归零、kind=1/2 aborted 零发射）；丢帧/重复/错序/超时/close/GOAWAY/断线/epoch fence 丢弃矩阵、超时两向收口完备覆盖、公平调度回归归 #301。
3. **R48**：§23.3 cause×failed 矩阵的 `bootstrap-timeout`/`send-failed` 新入口注记（kind=1 停滞终局、M5 出站被拒行）尚未文档同步——纯措辞补记，建议随 #301/doc commit。
4. **R49**：transferId 耗尽不对称——kind=2 有显式预检（SYNC_TRANSFER_TOO_LARGE 收口），kind=1 无（uint32 域事实不可达，依赖 enqueue 防御性重置）；观察项归 #301 注记。
5. **SA4 §11-1 遗留**：peer `finalize`→`cleanupResources` 异步间隙残帧未获动态复现（静态结论 = 静默丢弃），归 #301 生命周期矩阵；SA4 观察 1（`completeChunkedStep2` 的 `?? currentRound` 回退）仅协议外注入可达、行为受控（单次幂等 apply + 单 SYNC_APPLIED，round 归属取当前 round），#301 建议改 fail-loud。
6. **N7**：`types.ts` 过期计数注释（「全 20 码」实为 26）——基线即漂移、文件在 DENY、本票零触碰，已登记转 owner/总控。
7. **N6**：origin/main `0019-vfsl-union-member-docs.md` 曾与本基线原 `0019-chunked-sync-transfer.md` 同号；owner 已裁决本基线篇重编号为 `0022-chunked-sync-transfer.md`，冲突消解；与本交付零交集。
8. **流程披露（已被 SA3 自披露，复核属实）**：SA3 iteration-3 对 SA6 契约文件执行过单路径 `git add`（索引侧尾随空格格式化修复），与「SA3 不得 git add」通用约束冲突、取 dispatch 具名授权；已提交契约文件复核 = 1085 行/12 用例/零尾随空白/语义零改动，不影响验收效力。

## 5. 规范一致性专项核对（ADR 0022 + 协议冻结面）

- **R42（transferId 单计数器）**：`UpdateChannel.allocateTransferId()` 单点，kind=0 与 bulk 共用（bulk-transfer `host.allocateTransferId` 即 channel 方法）；契约 R2 跨 kind 单调断言。✓
- **R43（协商门不弱化）**：decode 侧 pre-parse 门零改动；`sendUpdateChunk` 保留 `isChunkedNegotiated()` 纵深防御；v1 未协商组合走既有终局码（刻画文件/互通矩阵保持绿）；负控 N3（伪造 kind=3 首字段 → `UNSUPPORTED_MESSAGE_TYPE` + close 1002 + 零 ns ERROR）在库。✓
- **R44（首 chunk 全四条）**：控制器 count 门 + assembler 聚合/几何/bytes 校验序完整，全部先于分配；恰在上界接纳（`>` 判定）。✓
- **R45（场景 14 改写义务）**：`issue256` 场景 14 已改写为协商路径 + 超聚合上限构型 → `SNAPSHOT_TRANSFER_TOO_LARGE` + `send-failed` + peer remote-error + 零回落 `BOOTSTRAP_TOO_LARGE` 断言；与 §23.3 L814 逐字对齐。✓
- **R46/R47**：零新事件类型/词表/消息码/capability bit；kind=0 出站显式 `transferKind: 0`（wire 字节不变，codec 本就编 0）；`onAck` drain 扩展经 `hasBulkTransferWork` 可选 seam，无 bulk 时逐字节同义（bulk-edge M3-b 锚）；codec 面零触碰。✓
- **文档同步义务（docs/AGENTS.md）**：§22 L701 测试资产措辞收口已随交付更新（旧文「由后续切片交付、不预设其存在」已失效，更新未发明行为）；§23.3 L814 场景 14 行已声明「由实现 ticket 改写」并兑现；过期术语扫描零命中。✓
- **超时按段收口（协议 §17/§18）**：assembly 停滞按 `busyKind` 选路——kind=0 原样、kind=2 → `RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED}`（非终态）、kind=1 → 弃 partial + `BOOTSTRAP_FAILED` + `finalize('failed','bootstrap-timeout', assemblyTimeoutMs)`；kind=2 发送端 ACK timer 锚末 chunk 出站、超时 → 载体弃置 + §10.4 处置；hub bootstrap timer 武装点前移至 enqueue（消除分块窗口无 timer 空档，语义不变）。✓

## 6. Scope creep 检查

无。已提交 diff 仓内 16 文件全部落在设计 ALLOW 清单；DENY 面（codec 形态、frame-io、backpressure、defaults/types/validate/error-mapping、包导出面、刻画文件、`issue137-driver.ts`）实测零触碰；wiki 产物 9 件为流程记录。未发现与 issue #300 正文/AC 无关的行为变化。

## 7. 结论

**approve。** 交付 diff 忠实、完整地实现 issue #300 正文与 AC1–AC5、SA6 验收契约（8 红 → 全绿 + 4 负控保持）、ADR 0022 决策与规范协议冻结面；R42–R47 边界约束逐项闭合；刻画文件与 DENY 面零触碰；四新码 append-only 首登逐值 = §13.2 冻结行；文档同步义务兑现。唯一正文解读项（§4-1：R1 构型绿灯的逐字读法在其自身冻结约束下不可实现，实质覆盖已由 R2/R2b/R3-contract + kind=0 数据路径承担）与 §4-2..8 归口/披露项均不阻断本票验收，但必须在 PR 中如实披露。

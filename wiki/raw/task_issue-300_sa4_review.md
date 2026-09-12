# SA4 实现后红队审查 — issue #300（#295 切片 2）：chunked BOOTSTRAP_SNAPSHOT / SYNC_STEP2 端到端

- **dispatch**: sa-48066a9d-3396-47fc-a006-db5e4556bfad（mabf-sa4 / implementation-review / iteration 0）
- **审查对象**: 工作树未提交实现 diff（13 modified + `bulk-transfer.ts`/`ws-replication-issue300-bulk-edge-ac.test.ts` 新增；`git diff --stat` +1045/−221）+ SA6 契约文件（untracked）
- **基线**: `mabf/issue-300` @ `605a48f`（#299/PR #321 合并点，`git rev-parse HEAD` 实测）
- **对照基准**: SA6 契约（approve，8 红 + 4 负控）、SA1 设计 r1（SA2 approve）、SA2 评审（B1/M1–M5 已落实）、SA8 前置门禁（R42–R47/N6）与 implementation 复查（clear，R48/R49/N7）
- **Issue comments REST 快照 = `[]`**（与简报/SA6/SA8/SA2/SA3 五方一致）→ 零 owner 评论映射义务

---

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-300.md`（AC1–AC5；comments 空） | 实读 |
| `wiki/raw/task_issue-300_design.md`（SA1 r1，568 行，D0–D12 + M1–M5） | 实读（全文） |
| `wiki/raw/task_issue-300_sa2_review.md`（approve；B1/M1–M5 落实核对 + 5 条非阻塞观察） | 实读 |
| `wiki/raw/task_issue-300_sa6_contract.md`（approve；R1–R7 + N1–N4；转绿判据 §13） | 实读 |
| `wiki/raw/task_issue-300_sa3_impl.md`（iteration 2；3 项声明偏离） | 实读 |
| `wiki/raw/task_issue-300_conflict_report.md`（前置门禁 clear，R42–R47/N6） | 实读 |
| `wiki/raw/task_issue-300_implementation_conflict_report.md`（implementation 复查 clear，R48/R49/N7） | 实读 |
| 实现源码逐文件实读：`bulk-transfer.ts`（全文 266 行）、`update-transfer.ts`、`update-channel.ts`、`round-engine.ts`（全文 301 行）、`hub-namespace.ts`（关键段：startBootstrap/onUpdateChunk/facet/declareHubResync/finalize/closeSessionAndRelease/onAssemblyTimeout/armTimer）、`peer-namespace.ts`（关键段：onBootstrapSnapshot/finishBootstrapImport/onHubUpdateChunk/admit*/declareLocalResync/onAssemblyTimeout/finalize/cleanupResources）、`hub-connection.ts`/`peer-connection.ts` sendUpdateChunk、`backpressure.ts`（facet 接口 + drainData/wheel/shed——零改动核对）、`errors.ts` | 实读 |
| 测试面：`ws-replication-issue300-chunked-sync-ac-red.test.ts`（完整性核对：1085 行/12 `it(`/零 skip·only·todo·env——与 SA6 §12 及 SA8 核对一致）、`ws-replication-issue300-bulk-edge-ac.test.ts`（全文 538 行/6 例）、`ws-replication-issue256-namespace-failed.test.ts` 场景 14 diff、`test/driver.ts` diff、`codec-issue242-ac-red.test.ts` diff、`test/fixtures.ts` diff、`ws-replication-ac3-bootstrap.test.ts`（v1 BOOTSTRAP_TOO_LARGE 锚在库核对）、`ws-replication-issue243-sa7-dynamic.test.ts`（assembler 旧签名兼容核对） | 实读 |
| `docs/protocols/instance-replication-v1.md` §13.2 L445–448（四码冻结值）+ §22 L701 diff、`vitest.config.ts` include | 实读 |
| Git 状态：`git status --porcelain`、`git diff --stat`、`git diff --check`（exit 0） | 实测 |

SA4 未运行测试（职责边界）；SA3 的验证结论（契约 12/12、ws-replication 70 文件 499 用例、replication-protocol 12 文件 206 用例、双包 tsc、根 `pnpm typecheck`、根 `pnpm test` 3486 用例、`git diff --check`）作为报告证据引用，本审查以静态证据独立复核其可支撑性。

## 2. Verdict

**approve。** 实现是批准设计 r1 的忠实、完整落地：D0 三分叉触发条件（单帧逐字节保持/v1 终局保持/kind=1/2 改道）、D1 `BulkTransferSender` 状态机（含 M2 三族边沿 + M5 出站被拒转移）、D2 transferId 单计数器共用（R42）、D3 RoundEngine 三态 seam + `admitChunkedStep2`/`completeChunkedStep2`/`noteChunkedStep2Outbound`、D4 hub snapshot 三分叉 + bootstrap timer 武装点前移、D5 接收端 kind 泛化（含 R5 绑定块既有码 + 本地 failed 裁定）、D6 首 chunk 全四条校验与校验序、D7 facet 三段仲裁 + 聚合记账 + M3 唤醒、D8 observer 改道归零（M1 门控 + busyKind 事件门）、D9 超时按 busyKind 选路（kind=1 精确闭包 / kind=2 SYNC_TRANSFER_EXPIRED）、D10 错误映射总表、D11 生命周期、D12 四码 append-only 首登（逐值 = 协议 §13.2 L445–448 冻结行，本轮逐值比对）全部落实且经源码逐点核对。SA2 B1/M1–M5 六条阻断 finding 的实现面全部在场（见 §3）。SA3 声明的三处偏离经复核为等价实现（见 §4 注记）。文件范围全部落在 ALLOW LIST、DENY 全部未触碰（含刻画文件、契约文件、codec 形态面）。测试面：契约文件未被修改（完整性三重核对）、bulk-edge 探针为行为断言且被真实 runner 收集、场景 14 改写为 R45/§23.3 授权义务且有零回落断言、v1 路径在 `ws-replication-ac3-bootstrap.test.ts` 保留独立锚。无 BLOCKER/MAJOR；5 条非阻塞观察与 4 项后续动态验证项见 §11/§12。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| AC1 超限 snapshot → kind=1 + 单 BOOTSTRAP_ACK 锚末 chunk 帧序 | `hub-namespace.ts` startBootstrap L573–604（三分叉 + enqueue + timer 前移）；`onLastChunkSent → bootstrapSnapshotSeq`（L592–595，与末 chunk 出站同一同步栈）；`peer-namespace.ts` `finishBootstrapImport` L627–630 `ackedSequence: anchorSequence` | ✓ 落实（D4 逐点一致；undefined 期收 ACK → 既有 `ACK_STATE_VIOLATION` connection fatal 保持，L640–646） |
| AC2 双向超限 diff → kind=2 + 单 SYNC_APPLIED | 双侧 `sendStep2` 三态（hub L697–760 / peer L1531–1596）；`round-engine.completeChunkedStep2 → applyStep2Safely → host.applyStep2(...,'syncChunked')`，`applyStep2` 以 `ackedSequence = lastChunkSequence` 发 SYNC_APPLIED（hub L1341–1360 / peer L1607–1625） | ✓ 落实 |
| AC3 data 路径记账 / control reserve 零 chunk / 每帧上限 | chunk 经 `sendUpdateChunkFrame → host.sendUpdateChunk → sender.tryEmitData`（独立 sequence、水位闸门、统一账本）；facet `queuedBytes/queuedCount` 聚合 bulk 载体（双侧 sendFacet）；control 队列结构性零 chunk（data 出站点唯一）；帧长由 codec 字段限额 + `maxUpdateBytes` 切片约束 | ✓ 落实（`backpressure.ts` 零改动，facet 接口形状不变——设计零改动声明成立） |
| AC4 四新码 + 既有绑定块码映射 | `errors.ts` 四行 append（值 = §13.2 L445–448 逐字：VIOLATION=true/no/failed、TOO_LARGE=true/config/failed ×2，本轮与协议表并排比对）；`chunkedViolationCode` 单点映射；`admitBootstrapChunk` 绑定块核对 → `REPLICATION_ID/EPOCH_MISMATCH` + failed/protocol-violation；`admitChunkedStep2` 失败 → `SYNC_STATE_VIOLATION` | ✓ 落实 |
| AC5 刻画文件不动 + 一次 apply + partial 零写入 | `ws-replication-issue233-repro.test.ts`/`issue137-driver.ts` 零触碰（git status 实测）；违例路径全部 `clearInboundAssembly → sendNsError → finalize` 先于任何 apply；完成路径恰一次 `finishBootstrapImport`/`completeChunkedStep2`（assembler reset 后不可重入；`receivedStep2` 每 round 单次） | ✓ 落实 |
| **SA2-B1**（四码注册） | errors.ts 联合 +4、注册表 +4、三处计数注释 22→26；fixtures 镜像 +4；issue242 计数 22→26 + 四码元数据/`lookupError` 作用域隔离/ERROR 帧往返断言（L461–516） | ✓ 落实（append-only：既有 22 条零改动、死码行保留、连接级零新增——实测） |
| **SA2-M1**（sync-diff-applied 抑制门） | 双侧 `applyRemoteUpdate` 第 5 参判别联合 `{chunkCount} \| {syncChunked:true}`；`isStep2 ∧ ¬syncChunked → 发射`、`syncChunked → 零事件`、`'chunkCount' in chunked → chunked-update-applied`（hub L1448–1470 / peer L1731–1753）；peer degraded 判别仍在最外层先行 | ✓ 落实（单帧/kind=0/else 三路逐字节不变论证成立） |
| **SA2-M2**（resync-declared 三族中止） | ① `onResyncReceived` 双侧同点 abort（hub L1072 / peer L680）；② 声明漏斗记忆化门后 abort（hub `declareHubResync` L1240 / peer `declareLocalResync` L1395）；③ ack-timeout funnel 经②（hub L1251–1253 / peer L1331–1335）+ bulk 自持 ACK 超时同漏斗（hub L766–768 / peer L1598–1602） | ✓ 落实（三族 × 双侧共 8 个挂点逐一在场；记忆化门后置 = 设计 D1 显式指定，语义论证见 §8） |
| **SA2-M3**（窗口空位唤醒） | `update-channel.ts` onAck L238–241：`queued.length > 0 \|\| host.hasBulkTransferWork?.() === true`；双侧 channel host 实现 `hasBulkTransferWork: () => bulkTransfer.hasQueuedWork()`；wheel 留轮经 facet 聚合 `queuedCount` | ✓ 落实（无 bulk 工作时 `?.() === true` 恒 false——与基线逐字节同义，M3-b 负控锚定） |
| **SA2-M4**（场景 14 协商前提） | `test/driver.ts` BootOptions `chunkedUpdate?` + 条件展开透传（undefined 零传）；场景 14 改写含协商 + `maxChunkedBootstrapBytes=16` 超聚合构型 + 新码断言 + 零 `BOOTSTRAP_TOO_LARGE` 回落断言 | ✓ 落实 |
| **SA2-M5**（出站被拒转移） | `bulk-transfer.ts` pullOne L178–185：明细先采样（`captureFailureDetail` 于 dispose 前）→ 载体弃置 → `onSendRejected`；kind=1 → `BOOTSTRAP_FAILED + finalize('failed','send-failed')`（hub L762–766）；kind=2 → `declareHubResync/declareLocalResync('send-failed', detail)`（hub L725 / peer L1566） | ✓ 落实（镜像 #243 采样纪律；返回 true = 消费即进展，零自旋） |
| SA8 R42/R43/R44/R45/R46/R47 | R42 `allocateTransferId()` 单点（kind=0 `startTransfer` 与 bulk 首 chunk 同源；teardown 归 1 仍在 channel）；R43 解码门零触碰（frame-io/payloads/messages/index 未改）+ 发送判据含 `chunkedUpdateNegotiated()` + 连接层 `isChunkedNegotiated()` 纵深；R44 五步校验序（绑定块 → chunkCount `>` 门 → 连接级槽 → 按 kind 聚合上限 → 几何，`≤` 含等号）；R45 发送端预检 + 场景 14；R46 零新事件 + aborted 事件 busyKind===0 门；R47 append-only 零顺手改（DENY 实测零触碰 + kind=0 piece 显式 `transferKind: 0`） | ✓ 全部落实（SA8 implementation 复查 clear 与本轮静态复核相互印证） |

Owner 评论：无（REST 快照空，五方一致）——无映射义务。

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| D0 触发条件（≤ 单帧逐字节 / 未协商 v1 终局 / 超聚合收口 / 改道） | hub startBootstrap L573–604；双侧 sendStep2 L702–714 / L1536–1548 | ✓ 四分支齐全；`transferIdAvailable()` 并入 kind=2 判据（SA8 R49 已注记 kind=1 无预检的不对称——实践不可达 uint32 边界，非阻断） | — |
| D1 BulkTransferSender 状态机（queued/active/awaiting-ack；abort 面 5 项；防御性 enqueue 重置） | `bulk-transfer.ts` 全文 | ✓ 状态机与回调面逐项一致；`replacedCount` 诊断计数（响亮防御）；kind=2 自持 ACK timer（末 chunk 出站锚）+ kind=1 依赖宿主 bootstrap timer | — |
| D2 transferId 单计数器 | `update-channel.ts` `allocateTransferId()`/`transferIdAvailable()`；双侧 bulk host `allocateTransferId: () => this.channel.allocateTransferId()` | ✓ 无第二计数器；kind=0 `startTransfer` 改走同一分配点（计数语义不变） | — |
| D3 RoundEngine seam（三态 + noteChunkedStep2Outbound/admit/complete） | `round-engine.ts` L20–29/L200–235/L245–263 | ✓ `sendStep2` 清锚先于宿主调用（注释论证正确：宿主内可能同步完成出站）；`admitChunkedStep2` 五条件与设计一致 | 观察 1（complete 的 round 回退语义，见 §12） || D4 hub 三分叉 + timer 前移 + 零 bootstrap-snapshot-sent | hub L569–604 | ✓ 与设计伪代码逐行对应；`onBootstrapAck` 零逻辑改动 + `settle(1)` | 观察 3（identity2 重读次序前移的复合边缘差异，见 §12） |
| D5 接收端 kind 泛化（assembler + 双侧管线 + finishBootstrapImport 抽取） | `update-transfer.ts`（类型/族中性原因/busyKind/跨帧 kind 一致）；hub onUpdateChunk L810–873；peer onHubUpdateChunk + admitBootstrapChunk/admitPeerSyncChunk；peer finishBootstrapImport L557–643 | ✓ kind=1 hub 侧 NAMESPACE_STATE_VIOLATION、peer 侧 bootstrapping+绑定块核对；kind=2 双侧 round 归属；残渣矩阵 kind 感知（needs-resync/reconciling 良性丢弃，其余按到达帧 kind fail-loud） | — |
| D6 首 chunk 全四条校验 + 校验序 + 分配前一次性分配 | `admitUpdateChunk`（chunkCount `>` 门 + 槽）→ assembler `validateFirst`（按 kind 聚合上限 + `geometryConsistent`）→ `new Uint8Array(totalBytes)` | ✓ R44 四条全在（`chunkCount ≥ 1` 由 `geometryConsistent` 与 codec 双承载）；`aggregateLimitFor` 对未配置 kind 响亮 throw（defaults 恒提供，生产不可达） | — |
| D7 facet 三段仲裁 + 聚合记账 + M3 唤醒 | 双侧 sendFacet（hub L164–191 / peer L214–244）；`onDataQueued → requestDataDrain` 入队接线双侧在场 | ✓ ①→②→③ 次序与设计一致；② 无 live 门 = enqueue 语境承载（bootstrapping/reconciling 承载语义，协议 §16）；互斥不变量成立（bulk hasWork 含 awaiting-ack 期间 ③ 不可达） | — |
| D8 observer 处置（M1 门 + 归零 + aborted kind 门） | 双侧 applyRemoteUpdate M1 门；`clearInboundAssembly` `busyKind === 0` 门（hub L996–1004 / peer L956–966）；`finishBootstrapImport` `emitImported=false`（kind=1）；`sync-step2-sent` 迁移至 sendStep2 single 分支（引擎是 SYNC_STEP2 唯一生产者——字段集/发射条件不变，M1 探针对照锚验证） | ✓ 落实 | — |
| D9 超时按 busyKind 选路 | 双侧 `onAssemblyTimeout`（hub L1839–1859 / peer L2244–2272）：kind=0 UPDATE_TRANSFER_EXPIRED 原样 / kind=2 SYNC_TRANSFER_EXPIRED + needs-resync / kind=1 `BOOTSTRAP_FAILED + finalize('failed','bootstrap-timeout', assemblyTimeoutMs)` 精确闭包 | ✓ 落实（SA2 非阻塞 #3 按设计闭包实现） | — |
| D10 错误映射总表 | 逐行核对：声明超限/计数超限 → TOO_LARGE 族；几何/跨帧/槽超额 → VIOLATION 族；绑定块 → 既有码；发送端预检 → SYNC/SNAPSHOT_TRANSFER_TOO_LARGE + failed/send-failed；出站被拒 → M5 分族；v1 保持 → 既有死码 | ✓ 全表一致（`transferViolation` 单点：clear + sendNsError + finalize('failed','protocol-violation')） | — |
| D11 并发/幂等/资源所有权 | 每 (ns,方向) 1 assembly + 连接级槽（kind 无关）；发送端跨 kind 互斥；双侧 teardown 三调用点（hub closeSessionAndRelease L1688；peer L503 + L2081）；finalize → 收口链含 bulk teardown（hub 同步前缀；peer 经 cleanupResources） | ✓ 落实 | 验证项 1（peer 侧 finalize→teardown 异步间隙，见 §11） |
| D12 注册表首登 | errors.ts/fixtures/issue242 三面同步；golden/消息 fixtures 零触碰 | ✓ 逐值 = 协议冻结行；`codec-registries.test.ts` 零改动经键集等价断言自动覆盖（未改，实测） | — |
| SA3 声明偏离 #1：`transferKind` 可选 + `?? 0` 归一 | `update-transfer.ts` L40–44；所有 kind 判别点均 `?? 0` | ✓ 等价：codec wire 首字段恒在（decode 侧必填）；kind=0 发送端显式携 0、kind=1/2 由 bulk 显式携带；无「缺 kind 静默归 0」的合法调用面 | — |
| SA3 声明偏离 #2：M3 判据用 `hasQueuedWork`（不含 awaiting-ack） | `bulk-transfer.ts` L100–102；双侧 host 实现 | ✓ 等价：awaiting-ack 无待发帧，drain 为 no-op；取窄判据避免无意义 drain；无 bulk 工作时两判据同 false | — |
| SA3 声明偏离 #3：`hasBulkTransferWork` 可选 seam | `update-channel.ts` L80–83 + `?.() === true` 守卫 | ✓ 等价：既有测试 fake host（如 issue243-sa7-dynamic）零失配；缺省语义 = 基线逐字节同义 | — |

设计明确但实现缺失：无。实现必要偏离设计：无（三处声明偏离均为等价形状且已声明）。

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| kind=1/2 发送端载体 | 命名空间通道域（经宿主 seam 出站） | `BulkTransferSender` 由 hub/peer 通道构造持有，经 `sendUpdateChunkFrame` 出站 | ✓ transport 不直入 Runtime/Persistence/live Y.Doc（ws-replication AGENTS 边界保持；apply/导入经既有 session/registry seam） |
| 错误族映射单点 | 控制器（assembler 纯字节重组） | `chunkedViolationCode` 于 update-transfer 导出、控制器透传结果码；assembler 返回族中性符号原因 | ✓ 与设计 D5「映射单点放控制器」语义一致（映射函数为纯查表、无状态，作为共享单点更收敛——两读法均无漂移面） |
| transferId 分配 | 既有计数器唯一载体 | `UpdateChannel.allocateTransferId()` 包内单点 | ✓ 不设第二计数器（R42） |
| 注册表首登 | codec errors.ts | D12 append-only | ✓ #242 同款先例（L136–139） |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| kind=0 分块发送端 | `UpdateChannel` | 新 `BulkTransferSender` | 有据偏离（设计 D1 备选①拒绝混载；SA2 iteration 0 裁定接受） | 结算帧/溢出语义/ackTimer 归属不同构；复用计数器、几何纯函数、wheel/RR、data 闸门、shed 账本、sendUpdateChunk 出站点 |
| 出站被拒处置 | #243 send-failed 族（update-channel sendOneChunk） | M5 镜像该族（采样→弃置→分族收口） | 一致 | 同款纪律（明细先于弃置采样） |
| resync 边沿中止 | channel 三族挂点 | M2 同点追加 bulk abort | 一致 | 8 挂点逐一与 channel 对齐 |
| 单帧 bootstrap 导入 | `onBootstrapSnapshot` 内联续体 | `finishBootstrapImport` 抽取共享 | 一致 | 单帧调用点传 `(帧身份, 帧序, emitImported=true)` 逐字节不变；差异仅 ACK 锚与事件门 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| 错误码注册 | `errors.ts`（§13.2 字节层） | fixtures 镜像表 | 低（codec-registries L109 键集等价断言 fail-loud；无第三镜像） |
| 切片几何 | `update-transfer` 纯函数 | 两发送器共用 `chunkCountOf/chunkBounds` | 无（零改动，实测） |
| transferId | channel 计数器 | 两发送器同源消费 | 无 |
| kind=1 完成点身份 | `bootstrapChunkBinding`（接纳时捕获） | `finishBootstrapImport` 消费 | 无（随 `clearInboundAssembly` 复位，双侧清理点核对） |

### 生命周期对称性

| Start or acquire | Stop or release | Failure recovery | Assessment |
|---|---|---|---|
| enqueue + timer 武装（bootstrap 前移/ACK 自持） | teardown ×3 + shed + round/epoch fence + M2 三族 + M5 | abort 面完备枚举（D1） | ✓ 对称；finalize → 收口链达 bulk teardown（hub 同步、peer 异步——验证项 1） |
| 连接级 assembly 槽 | `endAssemblyScope` 单点（kind 无关） | 违例/超时/清理全出口 | ✓ 零改动语义保持 |

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
|---|---|---|---|
| 第二调度器/cleanup/错误发射点 | wheel / clearInboundAssembly / sendNsError+finalize | 复用 | 无平行 ✓ |
| 第二 ACK 记账 | channel.inFlight | bulk 自持 awaiting-ack | 有据（结算帧不同；设计 D1 裁定） |
| 第二唤醒机制 | onAck→requestDataDrain | 条件扩展（非新机制） | ✓ 最小实现 |

## 6. 文件范围审查

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `packages/replication-protocol/src/errors.ts` | §12 行 1（D12） | 四码 append-only 首登 | ✓ 范围内（append-only，既有行零改动） |
| `packages/replication-protocol/test/fixtures.ts` | §12 行 2 | 镜像表同步 | ✓（golden/消息 fixtures 零触碰，diff 实测仅两处） |
| `packages/replication-protocol/test/codec-issue242-ac-red.test.ts` | §12 行 3 | 计数 + 四码断言 | ✓（该文件既定维护路径；抽样锚保持） |
| `packages/ws-replication/src/bulk-transfer.ts`（新增） | §12 行 4 | kind=1/2 发送端载体 | ✓ 包内私有（index.ts 零导出，实测 grep 零命中） |
| `packages/ws-replication/src/update-transfer.ts` | §12 行 5 | 接收端 kind 泛化 | ✓（几何纯函数零改动） |
| `packages/ws-replication/src/update-channel.ts` | §12 行 6 | R42/M3/互斥判据 | ✓ 加法式 + 一个 drain 条件扩展 |
| `packages/ws-replication/src/round-engine.ts` | §12 行 7 | D3/M1 | ✓ |
| `packages/ws-replication/src/hub-namespace.ts` | §12 行 8 | hub 侧接线 | ✓ |
| `packages/ws-replication/src/peer-namespace.ts` | §12 行 9 | peer 侧接线 | ✓ |
| `packages/ws-replication/src/hub-connection.ts` / `peer-connection.ts` | §12 行 10/11 | kind/绑定透传 | ✓（kind=0 字段集逐字节同构） |
| `packages/ws-replication/test/driver.ts` | §12 行 12（M4） | 协商旋钮透传 | ✓（undefined 零传） |
| `packages/ws-replication/test/ws-replication-issue256-namespace-failed.test.ts` | §12 行 13 | 场景 14 改写 | ✓（R45/§23.3 L814 授权义务） |
| `packages/ws-replication/test/ws-replication-issue300-bulk-edge-ac.test.ts`（新增） | §12 行 14 | M1/M2/M3/M5 探针 | ✓ |
| `docs/protocols/instance-replication-v1.md` | §12 行 15 | §22 L701 措辞收口 | ✓（单行 diff，表本体零改动，实测） |
| `wiki/raw/task_issue-300_sa3_impl.md` | skill 固定产物 | SA3 报告 | ✓ |

**DENY LIST 核对（git status 全量对照，全部未触碰）**：`ws-replication-issue233-repro.test.ts`、`issue137-driver.ts`、SA6 契约文件（untracked 未修改：1085 行/12 用例/零 skip·only·todo·env——与 SA6 §12 及 SA8 §2 核对一致）、`replication-protocol/src/{payloads,messages,index}.ts`、golden/issue299 测试、`ws-replication/src/{frame-io,error-mapping,backpressure,defaults,types,validate,plugin,liveness,fence-watchdog,lifecycle-queue,observer,testing,index}.ts`、`namespace-registry/runtime`、`docs/adr/**`、`CONTEXT.md`、`apps/**`、`domains/**`、根配置。`git diff --check` exit 0。

ALLOW 中未修改的路径：无（15 行 ALLOW 全部有对应改动，driver/issue256/docs 均动）。

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| `RoundHost.sendStep2`（新增必选 seam） | hub/peer 通道 host 对象（in-repo 唯二实现） | 双侧实现（三态裁决）；refused → 引擎 throw RoundAborted → `onSyncStep1` 双侧 try/catch 捕获（hub L658–662 / peer L645–653） | 无 | — |
| `RoundHost.applyStep2` 第 4 参 `form?` | 双侧 `applyStep2` 实现 | 可选参数向后兼容；`completeChunkedStep2` fire-and-forget（`void`）与既有 `onStep2 → void applyStep2Safely` 同款纪律 | 无 | — |
| `UpdateChannelHost.hasBulkTransferWork?`（新增可选 seam） | 双侧生产 host 实现；测试 fake host 不实现 | `?.() === true` 守卫——缺省 = 基线逐字节同义（issue243-sa7-dynamic 等既有 fake host 零失配） | 无 | — |
| `ChunkedTransferPiece` 扩展（transferKind?/绑定成员?） | 连接层 `sendUpdateChunk`（双侧）、UPDATE_CHUNK 分发展开、assembler、`UpdateChannel` kind=0 出站 | 透传实现；kind=0 字段集与 wire 字节逐字节同构；缺失绑定成员 → codec MALFORMED_FRAME → `sendUpdateChunkFrame` try/catch → 0 → M5 收口（fail-loud） | 无 | — |
| `UpdateChunkAssembler` 构造限额扩展 | 双侧命名空间 + issue243 既有测试（旧两字段形状） | 新字段可选——旧形状调用零破坏（实测该测试未改且 SA3 全量绿） | 无 | — |
| `assembler.accept` 违例结果码族扩宽（`ChunkedTransferViolationCode`） | `handleAssemblerResult` violation 分支 → `transferViolation` | `transferViolation` 签名同步扩宽；全部六码在注册表（D12 首登后可编码） | 无 | — |
| 公共 API 面（`src/index.ts`） | plugin/apps/其它包 | 零变化（`BulkTransferSender` 不导出） | 无 | — |
| facet 聚合口径（queuedBytes/queuedCount 含 bulk） | `ConnectionSender` wheel 留轮/shed/严格接纳投影 | 接口形状不变；聚合值单调有上界（载体 ≤ 聚合上限）——`backpressure.ts` 零改动成立 | 无 | — |

遗漏关键 caller：未发现。

## 8. 错误、恢复与并发

| 检查项 | 结论 |
|---|---|
| 错误吞掉/伪装成功 | 未发现。M5 被拒返回 true（消费即进展）但伴随确定性收口回调（`#243` 同款「消费≠成功」语义）；`onAckTimeout: () => undefined`（kind=1）非吞错——bulk 对 kind=1 不武装自持 timer（L192），回调结构性不可达，等待期由宿主 bootstrap timer 覆盖（D9） |
| 部分完成诚实报告 | 违例路径一律 `clearInboundAssembly + sendNsError + finalize('failed')`；重组失败先于 apply（live Y.Doc 零写入——detached buffer + apply 点唯一） |
| 重试幂等 | 无重试面（被拒/超时均一次性确定性收口）；重复 ACK → 引擎 violation / `ACK_STATE_VIOLATION` 防御保持；重复 OPEN/导入走既有语义 |
| 回滚/清理真实性 | 载体弃置点完备（teardown ×3、shed、M2 三族、M5、ACK 超时自弃、finalize 收口链）；入站 partial 随 `clearInboundAssembly` 全出口丢弃；零 durable 残留（assembly 纯易失） |
| 进程重启/事务中断 | 连接收口 → teardown → 载体/assembly 归零；跨重启无 partial 持久化（非目标） |
| 迟到回调/失败后复活 | `finishBootstrapImport` 入口 state 门 + epoch 双检；`completeChunkedStep2` 的 apply 失败 → 'aborted' 静默（宿主已收编——既有纪律）；finalize 幂等（终态不降级） |
| 锁/lease/TOCTOU | bootstrap 期接收端无 Lease（按 namespaceId + 连接级槽记账——协议 §8.1）；发送端跨 kind 互斥由 facet 仲裁结构性保证；`ownStep2Seq`/`bootstrapSnapshotSeq` 锚与末 chunk 出站同一同步栈（因果先于 ACK） |
| 双写/stale generation | transferId 单计数器 + 跨帧逐字节一致校验；epoch fence 经既有 watchdog/清理挂点 |
| close/dispose 与在途工作竞态 | hub finalize → `closeSessionAndRelease` 同步前缀达 bulk teardown ✓；peer finalize → `cleanupResources` 异步达 teardown（经 `await session.close()/lease.release()` 后）——存在理论间隙：终态后、teardown 前若有 drain 触发（ACK 释放/poll 恢复），facet ② 无 state 门仍可出一帧（§11 验证项 1）。缓解面：绝大多数 finalize 路径先行发出 ERROR/CLOSE 控制帧（wire 序先于残渣 chunk），对端 quiet 门静默丢弃；且该窗口与基线 kind=0 的 `channel.teardown` 时序同构（基线靠 live 门防护、本路径靠载体弃置防护——设计 D7 显式选择） |
| 内存上界 | 发送侧载体 ≤ 聚合上限（入队前预检）；接收侧一次性分配 ≤ 按 kind 上限（校验后）；连接级 ≤ `maxConcurrentAssembliesPerConnection × max(三上限)`（§17 公式，配置链已验证） |
| `declareHubResync` 记忆化门后置 abort 的语义 | 设计 D1 显式指定「记忆化门后」。复核成立：恢复周期内（memo=true）的活跃载体即恢复 round 自身的 STEP2——中止它反而破坏恢复机制；周期内 kind=0 边结构性缺席（F2 不变量：needs-resync ⇒ 无 activeTransfer），无「第二声明边漏中止旧载体」的可达路径；周期外的首声明必经漏斗真实发射 → abort 生效；`onResyncReceived`（对端边）不经 memo，恒 abort |

## 9. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| `ws-replication-issue300-chunked-sync-ac-red.test.ts`（SA6 契约，DENY） | R1–R7 + N1–N4（SA6 §12 全表） | `vitest.config.ts` include `packages/*/test/**/*.test.ts` ✓；SA3 实测 12/12 绿 | **未被修改**：1085 行/12 `it(`/零 skip·only·todo·env（本轮实测）；用例名与 SA6 §12.1/12.2 逐条对应 | 无 |
| `ws-replication-issue300-bulk-edge-ac.test.ts`（新增） | M3-a：空 channel 队列 ∧ bulk 工作 → ACK 后 drain 恰 +1；M3-b：无 bulk 工作时零 drain/照旧 drain（R47 等价负控）；M5-a：首 chunk 被拒 → 明细对象逐字段（reason/updateBytes/queued*/inFlightCount=0）+ 回调恰一次 + 归 idle 零自旋；M5-b：中段被拒同款；M1：真实 harness 分块完成点 hub 零 `sync-diff-applied`（限定恢复 round）+ 单帧对照锚（`sync-step2-sent`/peer `sync-diff-applied` 照常）+ 收敛值；M2：首帧后闸门关 → 注入 RESYNC → 同 transferId 零新增 chunk（开闸后仍零）+ hub 零写入零 dirty + peer needs-resync 非 failed + 连接 ready | 同上 include ✓（SA3 实测 18/18 ×2 连跑） | 行为断言（真实 yjs/Registry/wire 解码，零源码字符串断言、零 skip/only/env——实测）；M2 探针仅覆盖三族边沿中的「收对端 RESYNC」族（本端声明漏斗/ack-timeout 漏斗族无探针——接线已经本轮静态逐点核对） | 观察 2（非阻断） |
| `ws-replication-issue256-namespace-failed.test.ts` 场景 14 | 协商 + 超聚合构型 → hub `SNAPSHOT_TRANSFER_TOO_LARGE` sent 恰一 + `send-failed` + **零** `BOOTSTRAP_TOO_LARGE` 回落 + peer remote-error | include ✓ | 改写为 R45/§23.3 授权义务（「回归锚场景 14 由实现 ticket 改写」冻结文本）；v1 路径保留独立锚 `ws-replication-ac3-bootstrap.test.ts` L92（BOOTSTRAP_TOO_LARGE 仍可测） | 无 |
| `test/driver.ts` | `chunkedUpdate?` 条件透传 | 被多数 ws-replication 测试复用 | undefined 零传——既有测试连接形态逐字节不变 | 无 |
| `codec-issue242-ac-red.test.ts`（D12 同步） | 注册表恰 26 + 抽样锚 + 四码元数据逐字段 `toEqual` + `lookupError` 作用域隔离 + ERROR 帧往返 ×4 | include ✓ | 计数断言按该文件既定 append-only 维护路径更新（20→22→26 先例）；既有抽样锚未删 | 无 |
| `test/fixtures.ts` | 镜像表 +4 | `codec-registries.test.ts` 键集等价断言自动覆盖 | 无（golden/消息 fixtures 零触碰，diff 实测） | 无 |
| 既有回归面 | 刻画文件 3/3、#243–#246、observer 锚、#299、互通矩阵 | 全包 run（SA3：70 文件 499 用例） | issue243-sa7-dynamic 的旧两字段 assembler 构造未改（新签名向后兼容）——kind=0 等价面保留直接锚 | 无 |

测试未被真实 runner 触发或验收被弱化：未发现。

## 10. Required revisions

无。未发现 BLOCKER 或 MAJOR。

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| 1. peer 侧 finalize → `cleanupResources` 异步间隙内的残帧出站（facet ② 无 state 门；hub 侧为同步 teardown 无此窗） | 真实 transport 构型：peer 在自身 kind=2 载体 active/awaiting-ack 期间触发一个**无 ERROR 前驱帧**的 finalize 路径（如 session-missing 类），并在间隙注入 ACK 释放/poll 恢复触发 drain | 对端要么 quiet 门静默丢弃残帧、要么仅应用真实发送端生成的帧（无数据损坏、无注入面）；残帧数有界（≤ 在途窗口） | 对端因残帧落假性 `SYNC_TRANSFER_VIOLATION` 终局，或残帧持续出站超过单笔载体 |
| 2. M2 本端声明漏斗/ack-timeout 漏斗族的执行锚（探针只覆盖收对端 RESYNC 族） | bulk-edge 同款 harness：kind=2 载体进行中注入本端声明边（如 kind=0 出站被拒/`session-fanout-overflow`）与 bulk 自身 ACK 超时（虚拟时钟推进 `ackTimeoutMs`） | 边沿后同 transferId 零新增 chunk；ACK 超时 → `declareLocalResync('ack-timeout')` 族处置 | 载体未弃置或对端落假性违例 |
| 3. 真实 WebSocket + FilePersistence 的 kind=1/2 端到端（SA3 未跑真实传输介质场景；apps 套件为通用回归） | 既有真传输 harness 扩展构型：大文档 bootstrap + 恢复 round 分块 diff + 断线重连中断传输 | 收敛、单 ACK、重连后恢复；无 partial 持久化残留 | 真实 socket 缓冲行为下的闸门/唤醒时序偏差 |
| 4. `completeChunkedStep2` 的 `chunkedStep2RoundId ?? currentRound` 回退分支（静态判定不可达：round 推进在 wire 序上恒先经 RESYNC 边沿清 assembly） | 恶意/错序帧注入（测试代理改写 wire 序）：kind=2 首 chunk 接纳后注入新 round STEP1 再补残 chunk | 不可达（残 chunk 落 needs-resync 良性丢弃或 busy 违例），或即便触发也仅 apply 真实发送端帧 | 观察 apply 归属 round 与实际内容不一致且引发错误 settle/ACK |

## 12. Non-blocking observations

1. **`completeChunkedStep2` 的 round 回退语义（round-engine.ts L226）**：`chunkedStep2RoundId ?? this.state.currentRound`——设计 D3 指定显式 `syncRoundId` 参数，实现改为引擎内捕获 + 回退。回退把（不可达的）陈旧 transfer 静默归属当前 round，与代码库他处「响亮防御」纪律（如 `enqueue` 非 idle 的 `replacedCount`）不完全一致；建议 #301 或后续切片将其改为 fail-loud（violation）或断言。静态不可达（§11 验证项 4），不阻断。
2. **M2 探针覆盖面**：仅「收对端 RESYNC」族有执行锚；本端声明漏斗/ack-timeout 漏斗族靠静态核对（本轮已完成 8 挂点逐一验证）。建议 #301 补探针（§11 验证项 2）。
3. **`startBootstrap` 次序微移（hub L549–604）**：identity2 重读移到超限分支之前（设计 D4 伪代码自身即此序）；复合退化边缘（超限 ∧ lease 重读失败/replication-disabled）的错误码由 `BOOTSTRAP_TOO_LARGE` 变为 `INTERNAL_ERROR`/`internal-error`——双退化边缘、双双终态 failed，v1 主路径（issue233 刻画/ac3-bootstrap 锚）不受影响。设计一致，记录备查。
4. **`types.ts` L274–277 既有过期计数注释**（「全 20 码」，实际 26）：基线即漂移、文件在 DENY、本票零触碰——SA2 观察 #1/SA8 N7 已登记转 owner/总控，非本票义务。
5. **SA8 R48/R49**（§23.3 cause 入口注记 + transferId 耗尽不对称）：非阻塞收尾项已在 SA8 implementation 复查登记，归 #301/doc commit；实现侧无需动作。

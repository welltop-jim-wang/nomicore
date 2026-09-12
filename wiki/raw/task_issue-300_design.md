# SA1 架构与实现设计 — issue #300（#295 切片 2）：chunked BOOTSTRAP_SNAPSHOT / SYNC_STEP2 端到端（修订版 r1）

- **dispatch**: sa-e8bec9f9-2b8c-4aa3-b491-b21c021b6edc（mabf-sa1 / design / iteration 1）
- **任务简报**: `wiki/raw/task_issue-300.md`（issue #300 正文快照；comments REST 快照 = `[]`，无 owner 评论）
- **上游产物**: SA6 验收契约 `wiki/raw/task_issue-300_sa6_contract.md`（approve，8 红 + 4 负控）、SA8 前置门禁 `wiki/raw/task_issue-300_conflict_report.md`（clear，R42–R47 + N6）、SA8 决策摘录 `wiki/raw/task_issue-300_relevant_decisions.md`
- **评审修订输入**: `wiki/raw/task_issue-300_sa2_review.md`（**reject：1 BLOCKER + 5 MAJOR + 7 条非阻塞观察**）——本版为逐条修订后的 r1；修订映射见 §14
- **基线**: `mabf/issue-300` @ `605a48f`（#299/PR #321 合并点）；工作树仅含 Host 简报/上游产物快照 + SA6 契约测试文件，零未提交实现漂移
- **规范权威**: `docs/adr/0022-chunked-sync-transfer.md`（配置语义/设计理据）+ `docs/protocols/instance-replication-v1.md`（wire 冻结值唯一权威）；本设计中「ADR 0022」一律指 `0022-chunked-sync-transfer.md`（N6 消歧）

---

## 1. 任务类型、目标与非目标

**类型 = Feature（能力缺口，非 Bug）**。SA6 已裁决：现实现行为与 #233 刻画一致（预期现状），本票交付 ADR 0022 预设的传输层实现（切片 2/3）。

**目标**：

1. hub 的 BOOTSTRAP_SNAPSHOT 超 `maxBootstrapBytes` 时改道 `kind=1` UPDATE_CHUNK 序列，经 data 路径逐帧出站（独立 sequence、dataGateOpen、RR 每轮每 ns 一帧、整笔占 1 个 in-flight 窗口槽、队列持完整载荷出队惰性切片、control reserve 零 chunk）；接收端按 (连接,方向,namespaceId,transferId) 作用域重组，收齐精确核对后执行**一次**排他复制导入，再以单 BOOTSTRAP_ACK（ackedSequence = 末 chunk 帧序）结算。
2. 双向 SYNC_STEP2 diff 超 `maxSyncDiffBytes` 时改道 `kind=2` UPDATE_CHUNK 序列（同款发送端规则）；首 chunk 绑定块 `syncRoundId` 核对；收齐后在 sequencer 中**一次** apply + dirty，再以单 SYNC_APPLIED（ackedSequence = 末 chunk 帧序）结算。
3. 接收端 assembler kind 泛化：按 kind 取聚合上限的四条首 chunk 校验（R44）、跨帧一致、分配前一次性分配 detached buffer、重组失败先于 apply（live Y.Doc 零写入）、bootstrap 期无 Lease 按 namespaceId 记账 + 连接级并发槽。
4. 错误映射：声明超限 → `SNAPSHOT_TRANSFER_TOO_LARGE` / `SYNC_TRANSFER_TOO_LARGE`（fatal/config/failed）；跨帧/几何违例 → `SNAPSHOT_TRANSFER_VIOLATION` / `SYNC_TRANSFER_VIOLATION`（fatal/no/failed）；绑定块不符 → 既有 `REPLICATION_ID_MISMATCH` / `REPLICATION_EPOCH_MISMATCH` / `SYNC_STATE_VIOLATION`；hub 本端快照超聚合上限收口改挂 `SNAPSHOT_TRANSFER_TOO_LARGE`（§23.3 场景 14 改写义务）。**四码在 codec 错误注册表的首登（append-only）是上述发射面的前置实现项（D12，SA2-B1）**。
5. SA6 红灯契约 8 条全部转绿（`packages/ws-replication/test/ws-replication-issue300-chunked-sync-ac-red.test.ts` 不改），4 条负控与既有 485 条包内断言保持绿；刻画文件 `ws-replication-issue233-repro.test.ts` 不动且保持绿（见 §7 D0 的 v1 门保持）。
6. R47 文档同步：协议 §22 L701 测试资产措辞收口 + §23.3 场景 14 回归锚改写。

**非目标**（与 ADR 0022 非目标、SA8 R46 切片边界对齐）：

- 不改 0x42 codec 单形态/字段序/单帧规则（#299 已冻结，本票纯消费）；
- **零协议外新码**：不新增消息码、capability bit、RESYNC reason 词表项、observer 事件类型；四个 namespace 错误码字面量与元数据为协议 §13.2 L445–448 已冻结登记值，本票做 codec 注册表 append-only **首登**（D12）而非发明新码（SA2-B1 修订后的准确表述——原「不新增错误码」表述在注册表维度为假前提）；
- 不新增/不改任何配置键（#299 已落地 `maxChunkedBootstrapBytes`/`maxChunkedSyncDiffBytes` 配置链与链②校验）；
- 丢帧/重复/错序/超时/close/GOAWAY/断线/epoch fence 丢弃矩阵、超时两向收口的完备覆盖与公平调度回归测试、observer 8 型接线（`chunked-snapshot-*`/`chunked-sync-*`）归 #301（本票只落共享管线内的机制接线，见 §7 D2/D9）；
- 不做跨版本互通、不 fallback HTTP/bootstrap、不做无界拆分、不逐片 apply、不跨重启持久化 partial；
- 不改 kind=0 live-update 既有行为（R47 逐字节等价）；不改 `ws-replication-issue233-repro.test.ts`。

---

## 2. 当前行为与证据锚点

全部锚点为基线 `605a48f` 实测（文件 + 符号/行号）；C1–C13 与 SA2 评审核对一致（「C1–C13 全部准确」），C14–C20 为本版按评审 finding 增补的锚点：

| # | 当前行为 | 证据锚点 |
|---|---|---|
| C1 | hub bootstrap 快照在 `startBootstrap` 内同步编码（`session.encodeDiff([0])`），超 `maxBootstrapBytes` 直接 `sendNsError('BOOTSTRAP_TOO_LARGE')` + `finalize('failed','send-failed')`，零分块出站；界内走单帧 `BOOTSTRAP_SNAPSHOT` 控制帧（`sendChecked` → `host.sendControl`），记 `bootstrapSnapshotSeq = seq`，**单帧发送后** arm `bootstrap` timer | `hub-namespace.ts` L503–575（超限分支 L521–529）、L551–571；`sendChecked` L1344–1360 |
| C2 | SYNC_STEP2 恒单帧：`RoundEngine.sendStep2` 经 `host.send` → 宿主 `sendChecked`（控制路径，R1 揭示的绕行）；`ownStep2Seq = seq` 同步赋值，`onApplied` 校验 `ackedSequence === ownStep2Seq` | `round-engine.ts` L184–194、L163–175；`hub-namespace.ts` L173–192、`peer-namespace.ts` L223–242 |
| C3 | 接收端 Step2 apply + 单 SYNC_APPLIED：`applyStep2(update, step2Sequence, syncRoundId)` → `applyRemoteUpdate(..., isStep2=true, ...)` → 成功后 `sendChecked({kind:'SYNC_APPLIED', ackedSequence: step2Sequence})`；`onStep2` 校验 round/relatedStep1Sequence/receivedStep2，违例 → `onViolation`（SYNC_STATE_VIOLATION + failed） | `round-engine.ts` L141–160；`peer-namespace.ts` L1350–1375；`hub-namespace.ts` 同构 |
| C4 | 接收端 bootstrap 单帧导入：`onBootstrapSnapshot` 状态门（bootstrapping）→ 身份比对 `openOkIdentity`（不符 → NAMESPACE_STATE_VIOLATION）→ detached Y.Doc apply → `registry.importReplica`（排他复制导入）→ `tryOpenReplicationSession` → `BOOTSTRAP_ACK{ackedSequence: message.sequence}` → reconciling + startRound | `peer-namespace.ts` L482–579 |
| C5 | 入站 UPDATE_CHUNK 分发已携带 kind/绑定块字段（#299 codec decode），但接收管线按 kind=0 单语义处理：`onUpdateChunk`/`onHubUpdateChunk` 的状态门 = live/needs-resync/(reconciling∧wasLive)，bootstrapping 期 kind=1 帧 → `NAMESPACE_STATE_VIOLATION`（SA6 §5(e) 红因）；`UpdateChunkAssembler` 无 kind 字段，只按 `maxChunkedUpdateBytes` 单一聚合上限校验，violation 码恒 UPDATE_* | `hub-connection.ts` L866–871、`peer-connection.ts` L594–599（分发）；`hub-namespace.ts` L669–723、`peer-namespace.ts` L666–715（管线）；`update-transfer.ts` L23–29/L75–198（assembler） |
| C6 | 发送端 chunk 出站恒 `transferKind: 0`：`hub-connection.sendUpdateChunk`/`peer-connection.sendUpdateChunk` 硬编码，注释显式「kind=1/2 发送端属 §8.1/§9.2 后续切片」 | `hub-connection.ts` L1019–1035、`peer-connection.ts` L805–824 |
| C7 | kind=0 分块发送端（机制来源）：`UpdateChannel` 队列持完整载荷、`pullAndSendOne` 惰性切片（③a 在途 transfer 只查闸门、③b 窗口空位）、末 chunk 出站 shift 载体 + `inFlight.set(末序,{chunked:true})` + armAckTimer；`nextTransferId` = (ns,方向,连接) 域计数器（teardown 归 1） | `update-channel.ts` L117–121、L371–472、L537–544 |
| C8 | data 路径调度：连接级 `ConnectionSender`（wheel + 游标 RR，每轮每 ns 一帧 `facet.pullAndSendOne()`）；facet 门 = `state === 'live'`（bootstrapping/reconciling 期 data 出队恒 false） | `backpressure.ts` L34–37/L96–230；`hub-namespace.ts` L153–165、`peer-namespace.ts` L202–214 |
| C9 | 连接级入站并发槽（kind 无关）：`tryBeginInboundAssembly`/`endInboundAssembly` + 通道侧 `assemblySlotHeld` 守卫；assembly 进度滑动 deadline（`armTimer('assembly')`，每收一 chunk 重置），超时 → 弃 partial + `RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED}`（kind 无差别，今日仅 kind=0 可达） | `hub-namespace.ts` L77–83/L707–735/L775–808/L1598–1621；`peer-namespace.ts` 对称 |
| C10 | decode 侧 0x42 pre-parse 协商门（R43 已满足）：`decodeMessage` 在 payload 解析前对未协商连接抛 `UNSUPPORTED_MESSAGE_TYPE`（close 1002）；codec 单帧规则含 `transferKind ∈ {0,1,2}`、绑定块当且仅当 `kind≠0 ∧ chunkIndex=0`（违者 MALFORMED_FRAME） | `replication-protocol/src/payloads.ts` L651–830、L910–920；`frame-io.ts` L59–74 |
| C11 | 字段级超限判别（decode 后手工）：BOOTSTRAP_SNAPSHOT > `maxBootstrapBytes` → `BOOTSTRAP_TOO_LARGE`；SYNC_STEP2 > `maxSyncDiffBytes` → `SYNC_DIFF_TOO_LARGE`（入站防御面，保留不改，见 §7 D10） | `frame-io.ts` L76–91 |
| C12 | 刻画文件经未协商连接运行：`issue137-driver.ts` 的 `bootMulti` 不传 `chunkedUpdate`（缺省 = v1 未协商）——R3 的 `SYNC_DIFF_TOO_LARGE` 终局在 v1 组合下成立 | `ws-replication-issue233-repro.test.ts` L62–211；`test/issue137-driver.ts`；`ws-replication-api.test-d.ts` L368–371 |
| C13 | 配置链就绪：`DEFAULT_REPLICATION_LIMITS` 含两聚合上限键；`validate.ts` 链②（`maxChunkedBootstrap/SyncDiffBytes ≤ maxChunksPerUpdate × maxUpdateBytes`，显式表达才校验）已落地（#299） | `defaults.ts` L33–34；`validate.ts` L238–263；`types.ts` L53–57 |
| **C14** | **codec 错误注册表无四新码（SA2-B1 事实基础）**：`NAMESPACE_ERRORS` 恰 22 条（含 #242 追加的 UPDATE_TRANSFER_*），无 `SNAPSHOT_TRANSFER_*`/`SYNC_TRANSFER_*`；`NamespaceErrorCode` 联合同样只 22 个字面量；全库 grep 四码仅命中 SA6 契约测试文件。协议 §13.2 表已登记 26 行（L445–448 四行冻结值：VIOLATION=yes/no/failed、TOO_LARGE=yes/config/failed）——**文档有、registry 无** | `replication-protocol/src/errors.ts` L31–54（联合）、L115–146（注册表 + 计数注释 L5/L31/L145）；协议 §13.2 L443–452 |
| **C15** | **ERROR 帧 encode/decode 双侧 fail-closed**：`decodeError`/`encodeError` 均先 `lookupError(scope, code)`，undefined → `throwMalformed('unknown error code ...')`——未注册码不可编码上线、对端解码亦 fatal。`error-mapping.terminalStateOf` 经 `lookupError('namespace', code)?.terminalState ?? 'failed'` 驱动（注册后零改动生效） | `replication-protocol/src/payloads.ts` decodeError L274–276、encodeError L322–324；`ws-replication/src/error-mapping.ts` L37–39 |
| **C16** | **apply 成功路径 observer 三选一发射序（SA2-M1 机制基础）**：`applyRemoteUpdate(update, sequence, isStep2=false, syncRoundId?, chunked?: Readonly<{chunkCount:number}>)`；发射分支序 = `isStep2 → sync-diff-applied`（**无条件，先于 chunked 判别**）`else chunked≠undefined → chunked-update-applied` `else update-applied`；peer 侧 degraded 判别先行胜出（R23） | `peer-namespace.ts` L1383–1389（签名）、L1449–1490（发射）；`hub-namespace.ts` L1157+、L1228（同构，无 degraded 分支） |
| **C17** | **onAck drain 触发门（SA2-M3 活性缺口基础）**：`UpdateChannel.onAck` 仅在 `queued.length > 0` 时 `host.requestDataDrain()`；连接级 `drainData` 全轮零进度即退出（注释「ACK 后再来」），wheel 留轮靠 `facet.queuedCount() > 0` | `update-channel.ts` L215；`backpressure.ts` L218、L226 |
| **C18** | **chunk 出站被拒先例（SA2-M5 基础）**：`sendOneChunk` 中 `sendUpdateChunkFrame` 返回 `seq ≤ 0` → 失败明细**先于 discard 采样** → `discardQueued()` → `needsResync = true` → `host.declareLocalResync('send-failed', detail)`——零静默、零自旋的确定性终局/恢复动作 | `update-channel.ts` L422–441；控制器包装 `sendUpdateChunkFrame`（try/catch 收敛返回 0）peer-namespace L804–814 |
| **C19** | **resync-declared 边沿挂点（SA2-M2 基础）**：① 收对端 RESYNC：双侧 `onResyncReceived` 内 `channel.markResyncReceived()`（peer L611–627 / hub L858–870，含 `clearInboundAssembly('resync-declared')`）；② 本端 wire 声明边：peer `declareLocalResync` 单漏斗 L1192–1235（记忆化门后同点清 assembly + 发 RESYNC_REQUIRED）/ hub `onLocalResyncEdge` L996+（channel host L226 接线）；③ ack-timeout funnel：peer `onAckTimeoutFired(abortedTransfer)` L1153–1169（abortedTransfer=true → `declareLocalResync('ack-timeout')`）/ hub `onAckTimeoutFired → declareHubResync('ack-timeout')` L1037–1038。协议 §10.3「中止复用既有机制（连接 shed / 队列溢出 / ACK timeout / RESYNC_REQUIRED / 终态）」显式列 RESYNC_REQUIRED 于中止面 | `update-channel.ts` L227–235（markResyncReceived/discardQueued）；协议 §10.3 L333–334 |
| **C20** | **注册表测试同步面（SA2-B1 验收基础）**：`codec-issue242-ac-red.test.ts` L461–462 断言 `Object.keys(NAMESPACE_ERRORS)).toHaveLength(22)`（该测试的既定维护路径 = 计数随 append-only 演进更新、既有条目抽样锚不变）；`test/fixtures.ts` `NAMESPACE_ERROR_TABLE`（22 条镜像，codec-registries.test.ts L109 断言两表键集等价 + 逐条元数据一致——fixtures 更新后自动覆盖新码）；`codec-registries.test.ts` 其余断言（lookupError/freeze）为注册表驱动，零改动自动生效 | `codec-issue242-ac-red.test.ts` L24/L461–462；`test/fixtures.ts` L534–562；`codec-registries.test.ts` L88–165 |
| **C21** | **协商链与 harness 面（SA2-M4 基础）**：peer 经 `PeerReplicationOptions.chunkedUpdate === true` 置 `optionalCapabilities = CAP_CHUNKED_UPDATE`（peer-connection L395–396）；hub `HUB_SUPPORTED_CAPABILITIES = CAP_CHUNKED_UPDATE` 恒支持（hub-connection L66）——**peer 侧单旋钮即决定协商**。`test/driver.ts` BootOptions 无 `chunkedUpdate` 选项、`createPeerReplication` 调用（L538+）不设 → 经该 driver 的连接恒未协商 | `peer-connection.ts` L395–396；`hub-connection.ts` L64–66/L1039；`test/driver.ts` L155–209、L538–553 |

---

## 3. 能力缺口（承接 SA6 §8，SA1 源码复核确认；SA2 评审确认 C1–C13 全部准确）

| 缺口 | 证据 | 设计响应 |
|---|---|---|
| G1 snapshot 发送端无分块改道 | C1 | §7 D4 |
| G2 Step2 发送端无分块改道（双向） | C2/C6 | §7 D3 |
| G3 接收端 assembler 无 kind 维度（上限取键、错误族、绑定块核对、状态接纳） | C5/C9 | §7 D5/D6 |
| G4 发送端 chunk 帧无 kind/绑定块出站面 | C6 | §7 D1 |
| G5 分块载荷无 data 路径调度接线（bootstrap/reconciling 期 facet 门恒 false；snapshot/diff 仍由 control 路径承载 = R1 结构性绕行） | C8 | §7 D7 |
| G6 四新错误码**零发射点且 codec 注册表零登记**（SA6 §8「已注册」断言经 SA2/SA1 双重核实为事实错误——协议文档已登记、codec errors.ts 未登记，C14）；hub 超聚合上限仍挂 `BOOTSTRAP_TOO_LARGE` | C14/C15 | §7 D12（首登）+ D4/D10（发射面） |
| G7 transferId 计数器仅 kind=0 消费（R42 三 kind 共用未落地） | C7 | §7 D2 |
| G8 分块发送端缺 resync-declared 中止接线与出站被拒转移；窗口满时 bulk 载体无唤醒路径（SA2-M2/M3/M5） | C17/C18/C19 | §7 D1/D7 修订 |

触发条件（SA6 §8 已证）：载荷 > `maxBootstrapBytes`/`maxSyncDiffBytes` 且 ≤ `maxChunkedBootstrapBytes`/`maxChunkedSyncDiffBytes`；同版本部署（连接已协商 `CAP_CHUNKED_UPDATE`）。最深根因 = 切片划分：#299 只交付 codec 单形态 + 配置链，切片 2 的传输层路由/kind 泛化/接收端校验/错误码注册表首登未实现。

---

## 4. Owner 要求落实

| Comment ID | Updated at | Requirement | Design section |
|---|---|---|---|
| （无 — issue #300 comments REST 快照为空，SA6/SA8/SA2 三方确认） | — | 任务要求唯一来源 = issue 正文 AC1–AC5 + ADR 0022 + 协议冻结文本 | AC1→§7 D4/D5、§8 路线①；AC2→§7 D3/D5、§8 路线②③；AC3→§7 D1/D7、§8；AC4→§7 D6/D10/D12；AC5→§7 D0、§11 验收映射 |

本设计不引入任何 issue/AC/ADR/协议之外的行为，不发明错误码/字段/事件（四码为协议冻结值的 codec 首登，D12）。

## 5. 复现和根因承接

| 上游事实（SA6 契约） | 证据位置 | 设计响应 |
|---|---|---|
| (a) 超限 snapshot 单帧 `BOOTSTRAP_TOO_LARGE` 终局、peer 永久失同步 | SA6 §5(a)；C1 | D4 三分叉改道 |
| (b)(c) 超限恢复 diff 双向在发送端编码面 `SYNC_DIFF_TOO_LARGE` 终局、kind=2 chunk 数 = 0 | SA6 §5(b)(c)；C2/C6 | D3 触发判据 + D1 发送器 |
| (d) data 闸门关闭时控制帧仍决定 bootstrap 结局（R1 绕行） | SA6 §5(d)；C8 | D7 facet 仲裁 + D1 data 路径出站 |
| (e) 接收端 kind=1 六类校验现状一律 `NAMESPACE_STATE_VIOLATION`（bootstrap 期状态门拒绝） | SA6 §5(e)；C5 | D5/D6 kind 感知接纳门与校验序 |
| (f) kind=2 接收端校验面结构性不可达 | SA6 §5(f) | D3/D5 |
| (g) 同款注入在 kind=0 上成立（`UPDATE_TRANSFER_VIOLATION`）→ 注入面真实 | SA6 §5(g) | 校验逻辑复用同一 assembler 状态机（D5） |
| 8 红 4 绿基线（3 次连跑零抖动、全包 485 绿） | SA6 §4/§13 | §11 验收映射以转绿判据对齐 |
| kind=2 发送端聚合预检未逐字冻结（R45） | SA6 §3/§15 | D3 显式选择发送端预检（两种合规落地均满足 R7） |
| **SA6 §8/§11「四新错误码已注册（源码核对）」** | SA2 §5/§13 E1 + SA1 复核 C14：`NAMESPACE_ERRORS` 22 条无四码；协议 §13.2 表已登记 | **上游事实更正（非矛盾阻塞）**：该断言对 codec 注册表为事实错误（协议文档有、registry 无）。设计按 C14/C15 承接真实状态：D12 首登为 AC4 前置项；SA6 的 8 红 4 绿基线与根因链其余部分不受影响（红灯仍因能力缺失而失败）。更正建议已随 SA2 非阻塞观察 #6 转交 SA6/总控，本设计不依赖其回执 |

上游事实与源码零矛盾（C1–C21 逐条复核；SA6 唯一错误断言即上表末行，已显式更正承接）。

## 6. SA8 约束落实

| 决议或义务 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|
| **R42** 三 kind 共用同一 (连接,方向,namespace) `transferId` 计数器，不设第二计数器，测试跨 kind 单调性 | §7 D2 | `UpdateChannel` 新增包内 `allocateTransferId()`（既有 `nextTransferId` L121 的唯一分配点外移），kind=1/2 发送器与 kind=0 同源消费；分配时机 = 首 chunk 出站（与 wire 序对齐） | 否（冻结面内） |
| **R43** 解码侧 0x42 协商门不得因 kind 泛化弱化（pre-parse `UNSUPPORTED_MESSAGE_TYPE`，不分 kind）；发送端沿既有 selectedCapabilities 面，不为 sync 段新增 bit/gating | §7 D0、D3、D5；§10 | 接收管线全部位于既有 decode 门之后（C10 门在 connection 层）；发送端 kind=1/2 改道判据含 `chunkedUpdateNegotiated()`（既有 0x42 消息族发送门，非新 gating）；未协商 + 超限 → 既有 v1 终局码（D0） | 否 |
| **R44** 首 chunk 校验按协议全四条（按 kind 聚合上限 ∧ `chunkCount ≤ maxChunksPerUpdate` ∧ `totalBytes ≤ chunkCount × maxUpdateBytes` ∧ `chunkCount ≥ 1`），后两条几何校验不得遗漏 | §7 D6 | 校验序五步（绑定块内容 → chunkCount 控制器门 → 连接级槽 → assembler 声明上界 → 几何），`≤` 含等号（R4 边界用例） | 否 |
| **R45** 发送端聚合超限分支 + §23.3 场景 14 改写 | §7 D3/D4、§11、§12 | kind=1：hub 超 `maxChunkedBootstrapBytes` → `SNAPSHOT_TRANSFER_TOO_LARGE` + `finalize('failed','send-failed')`；kind=2：发送端预检超 `maxChunkedSyncDiffBytes` → `SYNC_TRANSFER_TOO_LARGE` + failed + 零写入。**场景 14 改写含协商前提与 harness 面（SA2-M4）**：改写后场景经 `test/driver.ts` 新增 `chunkedUpdate` 透传建立协商连接（C21——peer 单旋钮决定协商，hub 恒支持），在 `len > maxChunkedBootstrapBytes` 构型断言新码 | 否 |
| **R46** 切片边界：observer 8 型接线 + 生命周期完备性归 #301；本票须显式声明 chunked 结算点 observer 处置且不使既有锚红 | §7 D8、§13 | chunked 结算点发射零事件；**kind=2 完成点 `sync-diff-applied` 归零经 D3 的 syncChunked 显式门控实现（SA2-M1——非结构性绕过，单帧路径逐字节不变）**；既有 observer 锚全绿 | 否 |
| **R47** append-only 冻结面零顺手改；kind=0 逐字节等价；落地后文档同步 | §7 D5/D8/D12、§11、§12 | **codec 错误注册表首登 = append-only 首次登记四行协议冻结值（SA2-B1；replication-protocol AGENTS「error codes 为 append-only 兼容注册表」明文允许），非「重复登记」亦非顺手改**——原设计「注册表零触碰」前提为假（C14）。`ChunkedTransferPiece` 扩展为包内私有类型（wire kind=0 字节不变）；`update-channel.ts` 改动 = 只读访问器 + 分配方法 + onAck drain 条件扩展（D7/M3，无 bulk 工作时与现状逐字节同义）；文档同步入 ALLOW LIST | 是（复查焦点扩至注册表面，§15） |
| **N6** origin/main 同号 ADR（已消解：本基线篇 0019→0022） | 本文件 header | 「ADR 0022」恒指 `0022-chunked-sync-transfer.md` 全路径 | 否 |
| Frozen surfaces 全表（SA8 §5） | §7 全节、§12 DENY LIST | 逐项保持：单帧路径与触发条件（D0/N1/N2）、BOOTSTRAP_ACK/SYNC_APPLIED payload 字段集不变、`BOOTSTRAP_TOO_LARGE`/`SYNC_DIFF_TOO_LARGE` 保留注册表且 v1 组合仍可达（D0）、assembly 进度对状态机不可见（D5）、配置链零改动。**错误码注册表行的准确读法（SA2-B1 修订）**：冻结的是四码语义/分类（协议 §13.2 值），codec 侧 append-only 首登恰是兑现该冻结面；SA8 报告 L40「四码已注册」与 SA6 同源前提错误，义务本身（append-only、不改既有行、不删死码）不变且被 D12 满足 | 是（同上） |

**设计后 ADR 冲突复查：需要（`requiresConflictRecheck: true`）**。理由：本设计改动 wire 传输路径（0x42 kind=1/2 端到端）、namespace 状态机承载行为（bootstrapping/reconciling 承载分块传输）、失败语义（四新码发射点 + 发送端收口改道 + M5 出站被拒新入口面），并**触碰 codec 错误注册表面（D12 append-only 首登——SA2 §13 验收要求复审重点随之扩展）**——SA8 §10 已预告该面需设计后核对（重点 R42–R45、R47、Frozen surfaces 表与 errors.ts 注册表行）。

---

## 7. 设计决策与主要备选方案

### D0 · 触发条件与 v1 门保持（单帧路径不是兼容回落）

改道判据（发送端，编码产物已就绪时判定）：

- **kind=1（hub→peer snapshot）**：`snapshot.byteLength > maxBootstrapBytes` ∧ `chunkedUpdateNegotiated()` ∧ `≤ maxChunkedBootstrapBytes` ∧ transferId 域未耗尽 → 分块；`≤ maxBootstrapBytes` → 既有单帧路径逐字节不变（含 `bootstrap-snapshot-sent` 观测）；`> maxChunkedBootstrapBytes` → R45 收口（D4）；**未协商 ∧ 超限 → 既有 `BOOTSTRAP_TOO_LARGE` 终局路径原样保留**。
- **kind=2（双向 Step2 diff）**：`diff.byteLength > maxSyncDiffBytes` ∧ `chunkedUpdateNegotiated()` ∧ `≤ maxChunkedSyncDiffBytes` ∧ transferId 域未耗尽 → 分块；`≤ maxSyncDiffBytes` → 既有单帧 SYNC_STEP2 控制帧路径逐字节不变；`> maxChunkedSyncDiffBytes` → 发送端预检收口（D3）；**未协商 ∧ 超限 → 既有 `SYNC_DIFF_TOO_LARGE` 终局路径原样保留**。

「未协商 ∧ 超限 → v1 终局」是 R43 的直接结论（发送端沿既有 selectedCapabilities 面；v1 代际端对 0x42 照旧 connection fatal，向其分块会把 namespace 级失败升级为连接级失败）。该保持同时是 AC5 的成立前提：刻画文件 C12 经未协商连接运行（`issue137-driver.ts`，与 `test/driver.ts` 为不同文件），R3 的 `SYNC_DIFF_TOO_LARGE` 终局因此实现后仍绿、文件零改动。`BOOTSTRAP_TOO_LARGE`/`SYNC_DIFF_TOO_LARGE` 在协商（同版本）路径上不再触发 = ADR 0022 死码语义，但在 v1 组合保留触发面。

**备选（拒绝）**：恒用分块不看协商位——向 v1 对端发 0x42 致连接 fatal，违反 R43/互通矩阵；对超限载荷回落单帧——违反「触发条件，非兼容回落」。

### D1 · 新增 per-(ns, 方向) 分块载荷发送器（kind=1/2 发送端唯一载体）

新模块 `packages/ws-replication/src/bulk-transfer.ts`（类名 `BulkTransferSender`；命名建议，SA3 可在不改变职责边界时微调）。**不复用 `UpdateChannel` 队列/窗口/ACK 记账**——其结算语义（UPDATE_ACK、needsResync 溢出声明、ackTimer 归属）与 kind=1/2 的结算帧（BOOTSTRAP_ACK/SYNC_APPLIED）和失败语义（bootstrap 失败族 / round 语义）不同构，混载会把 kind=0 的 R47 等价面和 kind≠0 的正确性同时置于风险。

职责与状态机（单实例 per (ns, 方向)，与 `UpdateChannel` 同生命周期）：

```text
idle ──enqueue(kind, payload, binding, gate)──▶ queued（完整载荷入队，1 载体项）
queued ──首 chunk 出站──▶ active（chunkIndex 严格递增；transferId 于此刻分配，D2）
active ──末 chunk 出站──▶ awaiting-ack（载体出队核减；onLastChunkSent 回调携带末 chunk 帧序）
awaiting-ack ──settle(kind)（BOOTSTRAP_ACK / SYNC_APPLIED 收妥）──▶ idle
任意态 ──abort(reason)──▶ idle（onTransferAborted；reason ∈ {teardown, shed, round-end,
                            epoch-fence, resync-declared(M2), send-failed(M5)}）
queued/active ──pullOne() 出站被拒（sendChunk 返回 ≤0，M5）──▶ idle + 按 kind 的确定性收口（见下）
```

- **惰性切片**：入队持完整载荷（载体字节计入 facet `queuedBytes`，连接级 shed 账本可见）；`pullOne()` 出队时刻按 `chunkBounds(totalBytes, maxUpdateBytes, index)` 切片（复用 `update-transfer.ts` 既有几何纯函数——单一事实源）。
- **出站面**：每 chunk 经宿主 `sendChunk(piece)` → 连接层 kind 感知 `sendUpdateChunk`（D4/C6 改造点）→ `sender.tryEmitData`（既有 data 出站点：ready 门 + 水位闸门 + 独立 sequence 分配 + 连接总压账本）。控制保留额度零 chunk（结构性成立：data 出站不经 control 队列）。
- **闸门与调度**：`pullOne()` 前置 = `dataGateOpen()`；连接级 RR 由既有 wheel 消费 facet（D7）；每轮每 ns 至多一 chunk 帧 = 每 `pullOne()` 恰发一帧。
- **in-flight 窗口槽**：transfer 起始判据含 `channel.effectiveInFlightCount() < maxInFlightUpdates`（复用 #243 有效占用口径的读侧，L132/L166）；active/awaiting-ack 期间本方向 facet 仲裁使 channel 不再开新 kind=0 transfer（D7）——「整笔占 1 个 in-flight 窗口槽直至结算 ACK」的忠实落地。中段 chunk 不复查窗口（同构 §10.3 ③a）。
- **每 (ns, 方向) 至多 1 个进行中 kind≠0 transfer**：`enqueue` 在非 idle 时为协议内不可达——**其不可达性依赖 M2 的 resync 边沿中止接线**（SA2 非阻塞 #4）：round 语义上单发（活跃 round 内一次 Step2、bootstrap 期一次 snapshot），且全部 resync-declared 边沿（C19 三族）都会弃置载体归 idle，恢复 round/新 bootstrap 才可能再次 enqueue；round 终止/epoch fence/teardown/shed 同理经 abort 面收口。接线完备后该分支仅剩「实现缺陷」可达——防御性处理 = 丢弃旧载体并按新载荷重置（响亮防御，不静默），并保留计数/观测线索供排查。
- **kind=1 附加**：enqueue 时绑定块 = 重读身份 `identity2`（复用 C1 既有「编码后重读」次序）；hub 侧 `bootstrap` timer **武装点前移至 enqueue 时刻**（SA2 非阻塞 #1 修订：现状锚在单帧发送后 hub-namespace L571；分块路径在 enqueue 时武装——更早且必要，`bootstrapTimeoutMs` 覆盖排队等待 + 逐帧传输 + ACK 等待的整个传输期，timer 槽/超时语义/issue #254 重建路径零改动）。
- **kind=2 附加**：末 chunk 出站时刻为 ACK 计时锚（`ackTimeoutMs`，§10.3 平移）；超时 → `abandon`（载体弃置 + 归 idle）→ 既有 §10.4 处置（needs-resync；该边沿本身并入 M2 的 resync-declared 族，见下）。发送器自持 timer（宿主注入 armTimer/clearTimer）。
- **abort 面 = 完整枚举**（机制接线本票；完备中止矩阵测试归 #301）：
  1. `teardown()`——连接收口/新代 session 建立（与 `channel.teardown()` 同一调用点，hub L1460-1 / peer L468-9、L1812-3 三处追加，D11）；
  2. `discardForConnectionPressure()`——shed（facet 调用点 hub L157-8 / peer L206-7 追加并列）：kind=1 → `sendNsError('BOOTSTRAP_FAILED')` + `finalize('failed','send-failed')`；kind=2 → 复用既有 resync 边沿处置（`declareLocalResync('connection-shed')` 同族——peer 侧 shed 行先例 peer-namespace L209）；
  3. round 终止 / epoch fence——经宿主回调清理（载体弃置 + 归 idle）；
  4. **resync-declared 边沿（SA2-M2 显式枚举，与 channel 同一边沿挂点 C19）**：
     - 收对端 RESYNC：双侧 `onResyncReceived` 内、`channel.markResyncReceived()` 同点调用 `bulkTransfer.abortForResyncDeclared()`；
     - 本端 wire 声明边：peer `declareLocalResync` 漏斗内（记忆化门后、`clearInboundAssembly('resync-declared')` 同点）/ hub `onLocalResyncEdge` 漏斗内同点；
     - ack-timeout funnel：peer `onAckTimeoutFired` / hub `onAckTimeoutFired → declareHubResync('ack-timeout')` 入口同点；
     - kind=2 发送器自身 ACK 超时（上文）同属该族（弃置即 abort）。
     处置一律 = 载体弃置 + 状态归 idle + 拆除自持 timer；**此后本方向零新增 kind≠0 chunk 出站**（残渣只剩真正在途帧，与 kind=0 F3 窗口同构——接收端残渣矩阵 D5 按 needs-resync/reconciling 良性丢弃处理 chunkIndex>0 残渣，与 kind=0 同构）。协议 §10.3 L333–334「中止复用既有机制（… RESYNC_REQUIRED …）」为该接线的冻结文本依据。
  5. **出站被拒（SA2-M5 新增转移，见下）**。
- **出站被拒转移（SA2-M5）**：`pullOne()` 内 `sendChunk(piece)` 返回 `seq ≤ 0`（`tryEmitData` 对 ready 门瞬时关闭、单帧守卫、严格接纳投影超 cap 均可返回 0——`dataGateOpen()` 为 true 时仍可达，backpressure L124–136）时，**镜像 #243 send-failed 族（C18）**：
  ```text
  失败明细先于弃置采样（queuedBytes/queuedCount/已出 chunk 数——丢弃后计数恒零的既有纪律）
  → 载体弃置 + 状态归 idle
  → kind=2：declareLocalResync('send-failed', detail)（既有 resync 边沿处置：needs-resync + 恢复 round；hub 侧经 onLocalResyncEdge 同漏斗）
  → kind=1：sendNsError('BOOTSTRAP_FAILED') + finalize('failed', 'send-failed')
  ```
  fail-loud、零静默、零自旋（不重试、不吞错；确定性终局或恢复动作各一次）。§23.3 cause × failed 附表的 `send-failed` 行（hub 入口「控制帧编码面失败 + 快照超聚合上限」）按「出站发送异常族」读法涵盖 chunk 出站被拒这一新入口面——cause 字面量不变、闭联合 append-only 不触碰；该读法列入 §15 复查焦点。

**备选（拒绝）**：① 把 kind=1/2 载荷塞进 `UpdateChannel.deliver`——结算/溢出/ACK 语义错配（UPDATE_ACK 永不到达 → ackTimer 伪超时 → 伪 needs-resync），且污染 R47 kind=0 等价面；② 每帧同步切片直发（无队列载体）——违反「队列持完整载荷、出队惰性切片」冻结文本，且无法做 data 路径记账与闸门暂停；③ 为 kind=1/2 新建独立连接级调度器——违反「零机制新增」（RR/wheel 复用）；④ 出站被拒静默吞掉/无界重试——伪成功或停滞/自旋（SA2-M5 明确排除）。

### D2 · transferId 单计数器共用（R42）

`UpdateChannel` 的 `nextTransferId` 是 (连接, 方向, ns) 域计数的唯一现存载体。新增**包内**方法 `allocateTransferId(): number`（自增并返回；耗尽判据 `> 0xffffffff` 由调用方先行检查——kind=0 的 `isChunkable` 既有同款守卫 L268），`BulkTransferSender` 首 chunk 出站时消费。计数器生命周期不变：`teardown()` 归 1（连接收口/新代 session；`BulkTransferSender.teardown()` 与 channel 同点调用，计数器重置仍单点在 channel）。跨 kind 严格递增由同源分配结构性保证（R2 断言 kind=2 transferId > 先前 kind=0 transferId）。

**备选（拒绝）**：独立第二计数器——SA8 R42 明令禁止；把计数器提升为独立 allocator 对象注入两者——语义等价但扩大 `update-channel.ts` 改动面（构造签名变更），R47 风险大于收益。

### D3 · kind=2 Step2 发送/接收 seam（RoundEngine 扩展；含 M1 抑制门）

**发送端**：`RoundHost` 新增专用 seam，`RoundEngine.sendStep2` 改为：

```text
diff = host.encode('diff', remoteSV)                       // 不变
outcome = host.sendStep2(diff, currentRound, relatedSequence)
  ├─ { mode: 'single', sequence }   → ownStep2Seq = sequence（现行为；宿主内部走 sendChecked 控制帧 + sync-step2-sent 观测，逐字节不变）
  ├─ { mode: 'chunked' }            → ownStep2Seq 暂缺；宿主已 enqueue BulkTransferSender(kind=2, binding: syncRoundId=currentRound)
  │                                    末 chunk 出站时宿主回调 engine.noteChunkedStep2Outbound(lastChunkSeq) → ownStep2Seq = lastChunkSeq
  └─ { mode: 'refused', code }      → 宿主已完成终局收口（SYNC_TRANSFER_TOO_LARGE / SYNC_DIFF_TOO_LARGE + failed）→ 引擎 throw RoundAborted（既有「宿主已收编」纪律）
```

`noteChunkedStep2Outbound` 与末 chunk 出站同一同步调用栈执行 → 严格先于任何合法 SYNC_APPLIED 到达（ACK 因果上后于末 chunk 落线）；`ownStep2Seq === undefined` 期间收到 SYNC_APPLIED → 既有 violation 分支（防御正确，round-engine L166）。宿主侧 `sendStep2` 实现判据 = D0 kind=2 行。

**接收端**（`RoundEngine` 新增两个公共方法，复用既有校验/结算体）：

- `admitChunkedStep2(syncRoundId): boolean`——首 chunk 接纳：`hasActiveRound ∧ syncRoundId === currentRound ∧ ownStep1Seq ≠ undefined ∧ !receivedStep2`，通过则 `receivedStep2 = true`（防重复 Step2 的 chunk 形态）；不通过 → `onViolation`（SYNC_STATE_VIOLATION + failed，§9.3 既有语义）。relatedStep1Sequence 无 chunk 携带面，round 归属由绑定块承载（ADR 0022 L41）。
- `completeChunkedStep2(update, lastChunkSequence, syncRoundId): Promise<void>`——组装收齐后调用 = 既有 `applyStep2Safely` 的暴露形态：apply 成功 → remoteDiffAppliedLocally + checkSettled；SYNC_APPLIED 由 `applyStep2` 宿主实现以 `ackedSequence = lastChunkSequence` 发出——**结算单点与锚值逻辑不变（原「C3 单点不改」表述按 SA2-M1 修正）**：唯一函数内变化 = 途径的 `applyRemoteUpdate` 第 5 参携带 kind=2 形态标记以抑制普通族 observer 发射（M1 门，见下）。

**M1 · kind=2 完成点普通族 observer 抑制门（SA2-M1）**：现状 `applyRemoteUpdate` 的发射分支序为 `isStep2 → sync-diff-applied`（**无条件、先于 chunked 判别**，C16）——直接复用则 kind=2 分块完成点必然发射普通族 `sync-diff-applied`，违反协议 §23.3 第 33 型冻结改道语义（「该结算点不再发普通族 sync-diff-applied（窗口内归零）」）。设计指定抑制机制：

- 第 5 参 `chunked` 类型从 `Readonly<{ chunkCount: number }>` 扩展为判别联合 `Readonly<{ chunkCount: number }> | Readonly<{ syncChunked: true }>`（SA2 建议命名；SA3 可换等价判别名，kind=0 形态形状不变）。
- 发射分支改为：`isStep2 ∧ chunked.syncChunked ≠ true → sync-diff-applied`（**单帧 Step2 路径逐字节不变**）；`chunked.syncChunked = true → 零事件`（本切片；`chunked-sync-applied` 接线归 #301——R46）；`chunked{chunkCount} → chunked-update-applied`（kind=0，不变）；`else → update-applied`（不变）。
- `completeChunkedStep2` 的宿主实现（双侧 hub/peer 的 applyStep2）以 `syncChunked: true` 形态调用；peer 侧 degraded 判别仍在最外层先行胜出（R23 裁定不变——degraded 窗口任意来源 = degraded-bypass-applied）。
- 双侧（hub-namespace/peer-namespace）同构修改；§10 调用方矩阵补 `applyRemoteUpdate` 行。

**备选（拒绝）**：让 `host.send` 返回魔数/哨兵区分 chunked——语义藏在返回值，可读性与类型安全差；接收端在 namespace 层重写 round 校验——绕开引擎单点，重复 §9 违例矩阵；**维持「复用即发射」并放任 sync-diff-applied 上线——违 §23.3 冻结面（SA2-M1 裁定不可接受）**；为抑制而新增事件类型——违 R46 零新事件。

### D4 · hub snapshot 三分叉（`startBootstrap` 改造）

```text
snapshot = session.encodeDiff([0])                          // 不变（write sequencer 同步段）
identity2 = lease 重读（复用既有次序与异常收口）              // 不变
if (len ≤ maxBootstrapBytes)        → 既有单帧路径（含 bootstrap-snapshot-sent 观测 + 发送后 armTimer('bootstrap')）逐字节不变
else if (!chunkedUpdateNegotiated())→ 既有 BOOTSTRAP_TOO_LARGE + finalize('failed','send-failed')（v1 保持）
else if (len > maxChunkedBootstrapBytes)
                                     → sendNsError('SNAPSHOT_TRANSFER_TOO_LARGE') + finalize('failed','send-failed')
                                       （§23.3 场景 14 改写：本端资源超限归 send-failed 族；发射面依赖 D12 注册）
else                                → bulkTransfer.enqueue(kind=1, snapshot, binding=identity2)
                                       + armTimer('bootstrap')（武装点 = enqueue 时刻，D1 修订）
                                       + 末 chunk 出站回调：bootstrapSnapshotSeq = lastChunkSeq
                                       （零 bootstrap-snapshot-sent 事件——R21 平移归零，D8）
```

`onBootstrapAck` 不改逻辑：锚比对 `bootstrapSnapshotSeq`（单帧 = 快照帧序；分块 = 末 chunk 帧序——两者都在任何合法 ACK 可达之前赋值）；undefined 期间收到 ACK → 既有 `ACK_STATE_VIOLATION` connection fatal（防御保持）。

**备选（拒绝）**：分块 snapshot 仍走 BOOTSTRAP_ACK 之外的确认——违反 §8.2 单 ACK 冻结；快照在 enqueue 前预切片——违反惰性切片冻结文本。

### D5 · 接收端 kind 泛化（assembler + 两侧命名空间管线）

**类型面（包内私有）**：`ChunkedTransferPiece` 扩展：

```text
readonly transferKind: 0 | 1 | 2
readonly replicationId?: string; readonly replicationEpoch?: number   // 仅 kind=1 ∧ chunkIndex=0（codec 已强制）
readonly syncRoundId?: number                                         // 仅 kind=2 ∧ chunkIndex=0
```

kind=0 出站 piece 恒携 `transferKind: 0`、零绑定成员 → wire 字节与现状逐字节相同（codec 单形态 kind 首字段本就编 0）。连接层 `sendUpdateChunk` 的 `transferKind: 0` 硬编码（C6）替换为透传 piece 字段（含绑定成员展开）。

**assembler（`update-transfer.ts`）**：

- 构造限额扩展为 `{ maxUpdateBytes, maxChunkedUpdateBytes, maxChunkedBootstrapBytes, maxChunkedSyncDiffBytes }`；`validateFirst` 的聚合上限按 `frame.transferKind` 取键（R44 第①条）。
- 违例结果改为**族中性的符号原因**（`'transfer-too-large' | 'transfer-violation'`），由控制器按 kind 映射码（`UPDATE_*`/`SNAPSHOT_*`/`SYNC_*`）——映射单点放控制器，assembler 保持纯字节重组（模块头注释既有定位）。
- busy 跨帧一致集合扩展：`transferKind` 与 `transferId/totalBytes/chunkCount` 同列逐字节一致（异 kind 同 transferId 的恶意交错 → violation，按 **busy assembly 的 kind** 取错误族）。
- 新增只读 `busyKind`（idle → undefined）：供 assembly 超时收口按 kind 选路（D9）与 aborted 事件 kind 门（D8）。
- 几何纯函数（`chunkCountOf`/`chunkBounds`/`geometryConsistent`）零改动——kind 无关。

**两侧命名空间接收管线（hub `onUpdateChunk` / peer `onHubUpdateChunk`）**——在既有管线前段插入 kind 分派，后段（连接级槽、`afterAssemblyAccept`、`handleAssemblerResult`）共享：

```text
quiet 门（不变）→ busy 路径（assembler.accept，错误族按 busyKind 映射——不变逻辑 + kind 映射）
→ idle ∧ chunkIndex>0 残渣矩阵（kind 感知，见下）→ idle 首 chunk 按 kind 分派：
kind=0：既有门原样（live/needs-resync/reconciling∧wasLive + hub submit 门 + chunkCount 门 + 槽 + accept）
kind=1（peer；hub 侧收到 kind=1 → NAMESPACE_STATE_VIOLATION，无合法上下文）：
  state === 'bootstrapping' ∧ openOkIdentity ≠ undefined，否则 NAMESPACE_STATE_VIOLATION + failed
  → 绑定块核对：replicationId ≠ openOk.replicationId → REPLICATION_ID_MISMATCH；
    replicationEpoch ≠ openOk.replicationEpoch → REPLICATION_EPOCH_MISMATCH
    （sendNsError + finalize('failed','protocol-violation')——见下方「终态裁定」）
  → chunkCount > maxChunksPerUpdate → SNAPSHOT_TRANSFER_TOO_LARGE
  → 连接级槽超额 → SNAPSHOT_TRANSFER_VIOLATION
  → assembler.accept（kind=1 上限）→ 族中性结果映射 SNAPSHOT_TRANSFER_*
  → 'complete' → finishBootstrapImport(bytes, 绑定块身份, lastChunkSequence)（D6）
kind=2（双侧）：
  round.admitChunkedStep2(syncRoundId)（D3；失败 = SYNC_STATE_VIOLATION + failed）
  → chunkCount > maxChunksPerUpdate → SYNC_TRANSFER_TOO_LARGE
  → 连接级槽超额 → SYNC_TRANSFER_VIOLATION
  → assembler.accept（kind=2 上限）→ SYNC_TRANSFER_*
  → 'complete' → round.completeChunkedStep2(bytes, lastChunkSequence, syncRoundId)（含 M1 syncChunked 门）
```

**kind=1 绑定块不符的终态裁定（显式决策；SA2 E3 评估支持）**：wire 码 = 既有 `REPLICATION_ID_MISMATCH`/`REPLICATION_EPOCH_MISMATCH`（协议 §8.1 L202），**接收方（peer）本地终态 = `failed`（cause `protocol-violation`）**（SA2 非阻塞 #2 修正原「发送方」笔误），与已批准 SA6 契约 R5 断言一致。理由：bootstrap 期 peer 尚无本地副本身份，绑定块不符是「hub 帧 ↔ OPEN_OK 自述不一致」的协议一致性违例（§23.3 矩阵 protocol-violation 行），不是两副本身份冲突（注册表 conflicted 终态的语义域是 open/reconcile 期身份比较）；同构先例 = 单帧 `onBootstrapSnapshot` 身份不符今日即 `failed`。注册表行 terminalState=conflicted 与本地 failed 的表面张力保留至设计后复审确认（§15）。

**残渣矩阵（idle ∧ chunkIndex>0，kind 感知扩展）**：kind=0 原样（needs-resync/reconciling 良性丢弃，其余 fail-loud `UPDATE_TRANSFER_VIOLATION`）；kind=2 同 kind=0 的状态集（round 拆除/resync 边沿后的在途帧残渣——M2 接线后新出站面已归零，仅剩真正在途帧，与 kind=0 F3 同构），fail-loud 码 = `SYNC_TRANSFER_VIOLATION`；kind=1 在 bootstrapping 无「重置后残渣」合法窗口（peer assembly 重置仅发生于连接收口/新代 session，跨连接无残渣可达）→ fail-loud `SNAPSHOT_TRANSFER_VIOLATION`（防御）。完备矩阵归 #301。

**导入续体抽取**：`peer-namespace.onBootstrapSnapshot` 的导入续体（detached Y.Doc apply → `importReplica` → epoch 判别 → `tryOpenReplicationSession` → `BOOTSTRAP_ACK{ackedSequence}` → reconciling + startRound）抽取为私有 `finishBootstrapImport(snapshotBytes, identity, anchorSequence)`；单帧调用点传 `(message.snapshot, 帧身份, message.sequence)`（行为逐字节不变），kind=1 完成点传 `(assembled, 绑定块身份, lastChunkSequence)`。差异仅两处：① kind=1 路径不发射 `bootstrap-imported`（D8 改道归零——`finishBootstrapImport` kind=1 分支显式不发射）；② ACK 锚 = 末 chunk 帧序。

**备选（拒绝）**：per-kind 独立 assembler 实例——违反「每 (ns,方向) 至多 1 个 assembly」单一状态机与连接级槽的 kind 无关聚合；绑定块核对放 codec——#299 设计复审已裁定 codec 只管存在性/位置（SA8 §3 第 3 行），内容核对归本切片。

### D6 · 首 chunk 校验全四条与校验序（R44）

冻结四条的落点（`≤` 含等号，R4 边界锚）：

1. 绑定块内容核对（kind≠0；先于一切资源判定——身份语义优先，R5 构型 chunkCount/几何合法仍须映射身份码）；
2. `chunkCount ≤ maxChunksPerUpdate`——控制器门（#244 D2 先例：判定用 `>`，恰在上界接纳）；
3. `totalBytes ≤ 按 kind 聚合上限`——assembler `validateFirst`（`maxChunkedUpdateBytes`/`maxChunkedBootstrapBytes`/`maxChunkedSyncDiffBytes`）；
4. `totalBytes ≤ chunkCount × maxUpdateBytes ∧ chunkCount ≥ 1`——assembler 几何一致校验（既有 `geometryConsistent`）。

2/3 → TOO_LARGE 族；4 与后续跨帧违例 → VIOLATION 族；连接级槽超额（第 `maxConcurrentAssembliesPerConnection`+1 个并发首 chunk）→ VIOLATION 族（kind 无关槽、按 kind 取码——§17 L581）。校验全部先于 `new Uint8Array(totalBytes)` 一次性分配（分配上界已被 3/4 验证——恶意声明不可能无界分配）。

### D7 · facet 仲裁、data 路径记账与窗口空位唤醒（R1 绕行修复 + 单 assembly 接收不变量 + M3 活性）

两侧 `sendFacet.pullAndSendOne` 改为三段仲裁（其余 facet 成员扩展聚合）：

```text
pullAndSendOne():
  ① channel 有在途 kind=0 transfer（新增只读访问器 hasActiveTransfer()）
     → state==='live' ? channel.pullAndSendOne() : false        // 先让 kind=0 transfer 走完（既有 ③a）
  ② bulkTransfer.hasWork()（queued/active/awaiting-ack）
     → !dataGateOpen() ? false : bulkTransfer.pullOne()          // kind=1/2 chunk；state 门按 kind 已由 enqueue 语境承载
  ③ state === 'live' ? channel.pullAndSendOne() : false          // 既有路径，无 kind≠0 工作时逐字节不变
queuedBytes()/queuedCount() = channel 口径 + bulkTransfer 载体口径（连接级 shed 账本聚合；wheel 留轮依赖 queuedCount()>0——聚合是必要且充分条件）
discardForConnectionPressure() = channel 既有处置 + bulkTransfer.discard（D1 abort 面）
```

**互斥不变量（发送端 FIFO）**：② 在 ① 之后、③ 之前——kind≠0 transfer 排队时 channel 不会开新 kind=0 transfer（③ 不可达），channel kind=0 transfer 在途时 kind≠0 等其完成（①）。wire 上同一 (ns, 方向) 任意时刻至多一个进行中 transfer（跨 kind）→ 接收端单 assembler 的「busy ∧ 异 transferId ⇒ violation」永不误伤合法流量。控制帧（Step1/RESYNC/ERROR）仍走 control 队列优先出站，Step1 先于其 kind=2 Step2 chunks 的 wire 顺序保持（round 语义不变）。

入队接线：`bulkTransfer.enqueue` → `onDataQueued()`（wheel 登记 + 连接总压检查）→ `requestDataDrain()`（无既有触发点时放行）——与 `UpdateChannel.deliver` 同款次序纪律。

**M3 · 窗口空位唤醒路径（SA2-M3）**：`UpdateChannel.onAck` 现状仅 `queued.length > 0` 时 `requestDataDrain()`（C17）——bulk 载体不在 channel 队列，恢复期窗口 8/8 占满（生产常态构型）时 ACK 释放槽位不再触发 drain，停滞持续到 `ackTimeoutMs`（60s 缺省）abandon 或 periodic-reconcile 重入队，违 §10.3「整笔占 1 个 in-flight 窗口槽」的活语义（窗口满只暂停、不饿死）。设计指定唤醒路径：

```text
UpdateChannel.onAck：
  if (this.queued.length > 0 || this.host.hasBulkTransferWork()) this.host.requestDataDrain();
```

- `hasBulkTransferWork(): boolean` 为 **channel host seam 新增只读判据**（hub/peer namespace 的 channel host 实现各读同方向 `bulkTransfer.hasWork()`——与 channel 同域，无跨层穿透）。
- **R47 等价论证**：无 bulk 工作时 `hasBulkTransferWork() === false`，条件与现状 `queued.length > 0` 逐字节同义（纯内存布尔读，零 wire/observer/时序效应）——kind=0 回归与 N1–N4 不受影响。
- 闭合论证：槽位释放事件 = UPDATE_ACK 到达（`onAck`）——扩展后 drain 被请求 → wheel 内 facet 因 `queuedCount()` 聚合口径 > 0 仍在轮上 → ② 出站 chunk。其余槽位释放面（ack-timeout abandon、resync 边沿弃置）本身即 D1 abort/resync 处置点，载体已随之收口，无需额外唤醒。该构型登记入 §13 风险表；契约外的定向探针见 §11。

**备选（拒绝）**：接收端多 assembly 并存——违反「每 (ns,方向) 至多 1 个」冻结（ADR 0013 L62 逐字沿用）；kind≠0 直发不进 wheel——绕过 RR 公平性与连接总压账本，违反 §17；bulk 发送器自建 ACK 监听/轮询定时器唤醒——第二机制（SA2 明示「或等效再触发机制」仅此一处扩展为最小实现）；不修（维持停滞至 60s abandon）——SA2-M3 裁定为活性违例，不可接受。

### D8 · observer 处置（R46 中间态声明；M1 修订后）

- **零新事件类型**：8 型 `chunked-snapshot-*`/`chunked-sync-*` 全部不接线（#301）。
- **改道点普通族归零（本票落实行为面；归零依据逐项列明）**：
  - kind=1：`bootstrap-snapshot-sent` 不发射——**结构性成立**（不经过单帧发送点）；`bootstrap-imported` 不发射——`finishBootstrapImport` kind=1 分支**显式不发射**（§23.1 第 30 型改道语义的先行行为面）；
  - kind=2：`sync-step2-sent` 不发射——**结构性成立**（无 SYNC_STEP2 帧）；`sync-diff-applied` 不发射——**经 D3/M1 的 syncChunked 显式门控成立（原「不触发单帧 apply 的普通族发射点」的「结构性成立」论据为假，SA2-M1 修正：完成点复用 applyStep2 → applyRemoteUpdate(isStep2=true) 本会无条件发射，必须门控）**。
- **`chunked-update-aborted` 仅 kind=0**：`clearInboundAssembly(reason)` 的发射按 `busyKind === 0` 门控；kind=1/2 assembly 的 aborted 事件零发射（对应类型归 #301；终局失败族的可观测信号 = `namespace-error`/`namespace-failed`，§23.3 纪律）。
- 既有锚（`ws-replication-issue256-namespace-failed.test.ts` 除场景 14 改写外、`observer-red`、#239/#245/#231 锚）全绿；`namespace-error`/`namespace-failed` 照常发射（wire ERROR 与终态边沿，互补不重复——新码走既有 `sendNsError`/`finalize` 单点）。
- 单帧路径与 kind=0 分块路径的发射逐字节不变（M1 门只在 syncChunked 形态下改变行为）。

### D9 · 超时面机制接线（完备矩阵归 #301）

- hub `bootstrap` timer：kind=1 enqueue 时武装（既有 timer 槽/超时语义/issue #254 重建路径零改动；武装点前移说明见 D1）。
- 接收端 `assembly` 滑动 deadline：kind≠0 复用既有武装/重置点（`afterAssemblyAccept`）；**收口按 `busyKind` 选路**——kind=0 → 既有 `RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED}`（原样）；kind=2 → `RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED}` + needs-resync（词表已登记 §9.4 L270，reasonCode 为 codec 自由安全字符串零改动、无需注册）；kind=1 → BOOTSTRAP_FAILED 族终局，**闭包精确指定（SA2 非阻塞 #5 修订）**：弃 partial（零写入）→ `sendNsError('BOOTSTRAP_FAILED')`（协议 §8.1 L202「收口对齐 BOOTSTRAP_FAILED 语义族终局」；peer 侧 BOOTSTRAP_FAILED 发射先例 L512/L547）→ `finalize('failed', 'bootstrap-timeout', this.host.timeouts.assemblyTimeoutMs)`（cause 取 §23.3 闭集合内 bootstrap 族停滞字面量 `bootstrap-timeout`；`timeoutMs` 携**实际到期的配置上限** assemblyTimeoutMs——到期的是 assembly 滑动 deadline 而非 bootstrapTimeoutMs；缺省配置下 peer `bootstrap` timer（10s）先于 assembly deadline（30s）触发，该分支为配置相关的防御收口）。不选路则 kind=2 停滞会发错 reason、kind=1 停滞会误入 needs-resync（冻结面违例），故选路属 kind 泛化的必然组成而非 #301 范围扩张；**两向收口完备覆盖与测试矩阵归 #301**。
- kind=2 发送端 ACK timer：末 chunk 出站锚（D1）；超时 → 载体弃置 + 既有 §10.4 处置（该边沿属 M2 resync-declared 族的自身 ACK 情形）。

### D10 · 错误映射总表（协议冻结值；发射面依赖 D12 首登）

| 触发面 | kind | wire 码 | 分类 | 本端终态/处置 |
|---|---|---|---|---|
| 首 chunk `totalBytes` > 按 kind 聚合上限 | 1/2 | `SNAPSHOT_TRANSFER_TOO_LARGE` / `SYNC_TRANSFER_TOO_LARGE` | fatal/config/failed | ns ERROR + failed |
| 首 chunk `chunkCount` > `maxChunksPerUpdate` | 1/2 | 同上（TOO_LARGE 族） | fatal/config/failed | ns ERROR + failed |
| 几何不一致 / 跨帧元数据违例 / 收齐核对失败 / 连接级并发槽超额 | 1/2 | `SNAPSHOT_TRANSFER_VIOLATION` / `SYNC_TRANSFER_VIOLATION` | fatal/no/failed | ns ERROR + failed（槽超额：ns 级、连接保持 ready） |
| 绑定块 replicationId/epoch ≠ OPEN_OK | 1 | `REPLICATION_ID_MISMATCH` / `REPLICATION_EPOCH_MISMATCH`（既有） | fatal/reset/conflicted（注册表行） | **接收方（peer）按 protocol-violation → failed**（§7 D5 裁定；SA6 R5 锚定；SA2 非阻塞 #2 修正笔误） |
| 绑定块 syncRoundId ≠ 当前 round / 无活跃 round / 重复 Step2 | 2 | `SYNC_STATE_VIOLATION`（既有） | fatal/no/failed | ns ERROR + failed |
| hub 快照 > `maxChunkedBootstrapBytes`（发送端预检） | 1 | `SNAPSHOT_TRANSFER_TOO_LARGE` | fatal/config/failed | send-failed 族终局（场景 14 改写） |
| diff > `maxChunkedSyncDiffBytes`（发送端预检，R45 设计选择） | 2 | `SYNC_TRANSFER_TOO_LARGE` | fatal/config/failed | ns ERROR + failed + 零写入 |
| **bulk chunk 出站被拒（`sendChunk` 返回 ≤0，M5）** | 1 | `BOOTSTRAP_FAILED`（既有） | fatal/reconnect/failed | 弃载体 + `finalize('failed','send-failed')`（§23.3 send-failed 行 hub 入口的出站发送异常族读法，§15 复查焦点） |
| **bulk chunk 出站被拒（同上）** | 2 | 零 ns ERROR（RESYNC_REQUIRED 面） | 非终态 needs-resync | 弃载体 + `declareLocalResync('send-failed', detail)`（#243 同款） |
| 未协商 ∧ 超 `maxBootstrapBytes`/`maxSyncDiffBytes`（v1 保持） | 1/2 | `BOOTSTRAP_TOO_LARGE` / `SYNC_DIFF_TOO_LARGE`（既有死码保留） | fatal/config/failed | 既有终局路径原样 |
| 入站单帧超限防御（`namespaceFieldViolation`） | — | `BOOTSTRAP_TOO_LARGE` / `SYNC_DIFF_TOO_LARGE` | — | **不改**（同版本发送端已不产超限单帧；保留 fail-closed 纵深） |
| kind=0 全部既有码与行为 | 0 | `UPDATE_TRANSFER_*` 等 | — | 原样（R47） |

发射单点：`sendNsError`（wire ERROR + `namespace-error{sent}`）+ `finalize`（`namespace-failed` 边沿）——既有 HB2/#256 纪律零新增机制。**四新码的可发射性以 D12 注册表首登为前置**（未注册时 `encodeError` 对未知码 throwMalformed、目标码永不上 wire、对端解码同 fatal——C15 后果链）。

### D11 · 并发、幂等与资源所有权

- **幂等**：BOOTSTRAP_ACK/SYNC_APPLIED 单 ACK 幂等性沿用既有（重复 ACK → 引擎 violation/`ACK_STATE_VIOLATION` 面）；重复 OPEN 合流不变；重复导入（并发 duplicate bootstrap）→ 既有 `BOOTSTRAP_FAILED` 语义（C4 同一续体）。
- **并发上限**：接收端每 (ns,方向) 1 assembly + 连接级 `maxConcurrentAssembliesPerConnection`（kind 无关，既有槽零改动）；发送端每 (ns,方向) 1 个进行中 transfer（跨 kind 互斥，D7）。
- **内存上界**：发送侧载体 ≤ `maxChunkedBootstrap/SyncDiffBytes`（入队前预检）；接收侧一次性分配 ≤ 按 kind 聚合上限（校验后）；连接级聚合 ≤ `maxConcurrentAssembliesPerConnection × max(三聚合上限)`（§17 冻结公式，配置链已验证）。
- **所有权**：`BulkTransferSender` 由命名空间通道构造/持有（与 `UpdateChannel` 同域），经宿主 seam 出站——transport 层不直入 Runtime/Persistence/live Y.Doc（ws-replication AGENTS 边界）；排他复制导入与 sequenced apply 复用既有 Registry/Session seam（「与单帧路径同一导入语义」）。
- **epoch fence / 断线 / close / GOAWAY**：partial assembly 丢弃沿用既有清理挂点（`clearInboundAssembly` 全出口 + teardown 三调用点）；发送侧 `bulkTransfer.teardown()` 加入同点；resync-declared 边沿族见 D1 abort 面 4。

### D12 · 四新错误码 codec 注册表首登（SA2-B1；D10 发射面的前置实现项）

**事实基础（C14/C15）**：协议 §13.2 表已登记四码（L445–448 冻结值），但 `packages/replication-protocol/src/errors.ts` 的 `NAMESPACE_ERRORS` 恰 22 条无四码；`encodeError`/`decodeError` 对未知码 fail-closed。SA6/SA8「四码已注册」的前提为假（§5 更正行）——不首登则 D10 全部新码发射面结构性不可实现、AC4 与 SA6 R4/R6/R7 无法转绿、§23.3 L814 场景 14 行不可满足。

**改动（全部 append-only，先例 = #242 切片 1 于 errors.ts L136–139 冻结 UPDATE_TRANSFER_* 注册——「本切片只冻结注册与 wire 可编码性」）**：

1. `packages/replication-protocol/src/errors.ts`：
   - `NamespaceErrorCode` 联合 append 四个字面量（协议 §13.2 表序）：`'SNAPSHOT_TRANSFER_VIOLATION' | 'SNAPSHOT_TRANSFER_TOO_LARGE' | 'SYNC_TRANSFER_VIOLATION' | 'SYNC_TRANSFER_TOO_LARGE'`；
   - `_namespaceErrors` 末尾 append 四行**冻结元数据**（协议 §13.2 L445–448 逐字）：
     ```text
     SNAPSHOT_TRANSFER_VIOLATION: namespaceError('SNAPSHOT_TRANSFER_VIOLATION', true, 'no', 'failed'),
     SNAPSHOT_TRANSFER_TOO_LARGE: namespaceError('SNAPSHOT_TRANSFER_TOO_LARGE', true, 'config', 'failed'),
     SYNC_TRANSFER_VIOLATION:     namespaceError('SYNC_TRANSFER_VIOLATION', true, 'no', 'failed'),
     SYNC_TRANSFER_TOO_LARGE:     namespaceError('SYNC_TRANSFER_TOO_LARGE', true, 'config', 'failed'),
     ```
     附 #242 同款来源注释（issue #295 / ADR 0022 / 协议 §13.2 L445–448；发射点属本切片传输层）；
   - 注册表计数注释同步：文件头 L5、类型注释 L31、注册表注释 L145 的「22」→「26」（描述性注释，非语义）。
2. `packages/replication-protocol/test/fixtures.ts`：`NAMESPACE_ERROR_TABLE` 镜像 append 同四行（codec-registries.test.ts L109 键集等价断言要求两表同步）；计数注释 22→26。**golden 向量与消息 fixtures 零触碰**（本文件其余内容不动）。
3. `packages/replication-protocol/test/codec-issue242-ac-red.test.ts`：注册表 append-only 用例（L461–462）计数 22→26、既有条目抽样锚保持；按该文件既定维护路径补四码断言（`lookupError('namespace', code)` 命中冻结元数据 + ERROR 帧 `encodeMessage`/`decodeMessage` 往返成功）。`codec-registries.test.ts` 为注册表驱动（键集等价 + 逐条元数据 + freeze + lookupError），fixtures 更新后自动覆盖新码，零改动。

**边界自律**：仅 append 四行 + 类型联合 + 计数注释/测试同步；不改既有 22 条任何元数据、不删 `BOOTSTRAP_TOO_LARGE`/`SYNC_DIFF_TOO_LARGE` 死码行、零 codec 形态面（payloads/messages/index/golden）改动——replication-protocol AGENTS「error codes 为 append-only 兼容注册表；extend append-only where the protocol permits」的明文路径。`error-mapping.ts` 经 `lookupError` 自动获得四码 terminalState（'failed'），**零改动结论不变、前提修正为「首登落地后」**（§10 行已改）。

**备选（拒绝）**：① 不注册、经本地字符串发 ERROR——encode 面 throwMalformed（C15），不可行；② 在 ws-replication 内自带映射绕过注册表——违反「注册表是 codec 一切失败路径的元数据来源」单点纪律（errors.ts 头注释）；③ 修改既有行元数据以「腾挪」——违反 append-only 冻结面。

---

## 8. 数据流路线

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
|---|---|---|---|---|---|---|---|---|
| ① 分块 snapshot（hub→peer） | hub `startBootstrap`：encodeDiff([0]) 产物 > `maxBootstrapBytes` | `BulkTransferSender.enqueue(kind=1, snapshot, binding=identity2)`（hub-namespace 内存载体） | 出队惰性切片（`chunkBounds`）；每 chunk 经 `sendUpdateChunk` → `tryEmitData`（独立 sequence、dataGateOpen、RR） | WS data 帧 ×N（每帧 ≤ `maxUpdateBytes`+envelope ≤ `maxFrameBytes`；control 保留额度零 chunk） | peer `onHubUpdateChunk` → kind=1 接纳（bootstrapping + 绑定块核对）→ assembler detached buffer → `finishBootstrapImport`（importReplica 排他导入 + tryOpenReplicationSession） | peer `live`、副本逐字等于快照；恰一 `BOOTSTRAP_ACK{ackedSequence=末 chunk 帧序}`；hub `bootstrapSnapshotSeq` 锚末 chunk 帧序 | 违例族→ns ERROR+failed+零写入；停滞→BOOTSTRAP_FAILED 族（D9）；**出站被拒→BOOTSTRAP_FAILED + failed/send-failed（M5）**；resync/teardown/shed/fence→弃载体（D1 abort 面） | R1/R3/N1（SA6 契约） |
| ② 分块恢复 diff（peer→hub） | peer `RoundEngine.sendStep2`：encode diff > `maxSyncDiffBytes` | `host.sendStep2 → {mode:'chunked'}` → `BulkTransferSender.enqueue(kind=2, diff, binding=syncRoundId)`；`allocateTransferId()`（首 chunk 出站时） | 同①切片与 data 出站 | WS data 帧 ×N（peer→hub 方向） | hub `onUpdateChunk` → `round.admitChunkedStep2`（round 核对）→ assembler → `round.completeChunkedStep2` → `applyStep2`（**syncChunked 形态**，M1）→ sequencer 一次 apply + dirty | hub 收敛；恰一 `SYNC_APPLIED{ackedSequence=末 chunk 帧序}`（hub 发出）；peer 引擎 `ownStep2Seq` 锚末 chunk 帧序（`noteChunkedStep2Outbound`）；完成点零普通族 observer 事件（M1） | 违例→SYNC_* + failed + 零写入零 dirty；超聚合→发送端预检 SYNC_TRANSFER_TOO_LARGE；停滞→RESYNC{SYNC_TRANSFER_EXPIRED}；**出站被拒→needs-resync + declareLocalResync('send-failed')（M5）**；resync 边沿→弃载体零新增出站（M2） | R2/R6/R7/N2 |
| ③ 分块恢复 diff（hub→peer） | hub `onStep1` 响应链的 `sendStep2`（同②判据，hub 侧发送器 + hub channel 共享计数器） | 同②（hub-namespace 侧实例） | 同② | WS data 帧 ×N（hub→peer 方向） | peer `onHubUpdateChunk` → `admitChunkedStep2` → … → `SYNC_APPLIED`（peer 发出，peerToHub 方向） | peer 收敛到 hub 值 | 同② | R2b |
| ④ kind=0 既有分块 live update（不变量参照） | peer 写 > `maxUpdateBytes` | `UpdateChannel` 既有路径（唯一变化 = piece 显式携 `transferKind: 0`） | 既有 | 既有 | 既有 | `UPDATE_ACK` 锚末 chunk 帧序；跨 kind transferId 严格递增（R42） | 既有（含 #243 send-failed 先例——M5 的镜像源） | N4 + #243–#246 全包回归 |
| ⑤ 单帧路径（不变量参照） | 界内 snapshot/diff | 既有单帧控制帧 | 无 | control 帧 | 既有 | 恰一帧 + 单 ACK；`sync-diff-applied`/`bootstrap-snapshot-sent` 照常发射（M1 门不在该路径生效） | 既有 | N1/N2 + 刻画文件 R1/R2 |
| ⑥ 错误码注册表首登（D12） | 本票实现 commit | `errors.ts` 注册表 append 四行 + 联合扩展 | 无运行时数据流（静态注册表） | ERROR 帧 encode/decode 消费（`lookupError` 单点） | `sendNsError`/`decodeError`/`terminalStateOf` | 四码 wire 可编码/可解码、终态 failed 可导出 | 注册前 fail-closed（C15）即本路线的存在理由 | §11 codec 注册表行 + SA6 R4/R6/R7 |

跨边界说明：每跳数据形态均为「完整载荷（内存 Uint8Array 载体）→ 逐帧 wire 字节 → detached buffer → 一次 Registry/Session 写入」；事实源 = hub/peer 的 Y.Doc 经 session 编码；无持久化中间态（assembly 纯易失）；失败可见性 = wire ERROR + namespace 终态 + observer `namespace-error`/`namespace-failed`；清理责任 = 发送侧载体随 abort/teardown/resync 边沿丢弃、接收侧 partial 随清理挂点丢弃（零 durable 残留）。

---

## 9. 错误、恢复、并发与幂等

见 §7 D6/D9/D10/D11/D12 汇总。补充恢复语义：kind=1 失败（TOO_LARGE/VIOLATION/绑定块/BOOTSTRAP_FAILED 族/出站被拒）= terminal failed（等待连接重建/配置变化，§16/§18 既有路径）；kind=2 违例/超聚合 = terminal failed；kind=2 停滞 = 非终态 RESYNC（新 round 修复）；kind=2 发送端 ACK 超时/出站被拒/resync 边沿 = needs-resync（§10.4/#243 族——非终态，恢复 round 收敛）。重试面：TOO_LARGE 族 retryable=config（改配置后新连接/重开）；VIOLATION 族 retryable=no。**M2 覆盖后的出站静止性**：任一 resync-declared 边沿后本方向零新增 kind≠0 chunk 出站（残渣 = 真正在途帧，接收端残渣矩阵良性消化，与 kind=0 F3 同构）。回滚：本票无配置/数据迁移面，回滚 = revert 实现 commit（无运行期开关——ADR 0022 未引入也不得引入分块开关）；D12 注册行随 commit 一体回退（append-only，无既有行损伤）。

---

## 10. 调用方影响矩阵

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| `hub-connection.sendUpdateChunk` | 硬编码 `transferKind: 0` | 透传 `chunk.transferKind` + 绑定成员（`replicationId?`/`replicationEpoch?`/`syncRoundId?`） | 签名参数类型换为扩展后 piece（`HubChannelHost.sendUpdateChunk` 同步） | C6 |
| `peer-connection.sendUpdateChunk` | 同上 | 同上 | 同上（`PeerNamespaceHost.sendUpdateChunk`） | C6 |
| `hub-connection` L866 / `peer-connection` L594 UPDATE_CHUNK 分发 | `{...message, sequence}` 展开（kind 字段已随 decode 到达、被类型丢弃） | 同一展开，目标参数类型声明扩展后字段 | 零行为改动（类型面） | C5 |
| `hub-namespace.startBootstrap` / `onBootstrapAck` | 超限 BOOTSTRAP_TOO_LARGE 终局 | D4 三分叉；锚值来源扩展；bootstrap timer 武装点前移至 enqueue | 主改造点 | C1 |
| `peer-namespace.onBootstrapSnapshot` | 单帧导入续体内联 | 抽取 `finishBootstrapImport` 共享；kind=1 分支零 `bootstrap-imported` | 主改造点 | C4 |
| `hub/peer-namespace.onUpdateChunk`（双侧接收管线） | kind=0 单语义管线 | §7 D5 kind 分派 + 校验序 + 完成路由 | 主改造点 | C5 |
| `RoundEngine.sendStep2/onApplied/onStep2` | 单帧同步序 | `host.sendStep2` seam 三态 + `noteChunkedStep2Outbound` + `admitChunkedStep2`/`completeChunkedStep2` | 引擎扩展（单帧分支逐字节不变） | C2/C3 |
| **`applyRemoteUpdate`（hub L1157+ / peer L1383+，双侧宿主 applyStep2 实现）** | 发射分支序 `isStep2 → sync-diff-applied`（无条件）`else chunked → chunked-update-applied` `else update-applied` | 第 5 参扩展判别联合 `{chunkCount}` \| `{syncChunked:true}`；`isStep2` 普通族发射按 `syncChunked` 门控；kind=2 完成点零事件（#301 接 chunked-sync-applied）；单帧/kind=0/else 三路逐字节不变；peer degraded 判别仍最外层先行 | 签名类型扩展 + 双侧发射分支门控（M1） | C16 |
| `UpdateChannel`（kind=0 通道） | 计数器/在途私有；onAck 仅 `queued.length>0` 时 requestDataDrain | 新增只读 `hasActiveTransfer()`、`allocateTransferId()`（包内）；**onAck drain 条件扩展为 `queued.length>0 ∨ host.hasBulkTransferWork()`（M3）**；kind=0 出站 piece 携 `transferKind: 0` | 加法式改动 + 一个 drain 条件扩展（无 bulk 工作时逐字节同义） | C7/C17 |
| **channel host seam（hub/peer namespace 的 channel host 对象）** | 无 bulk 判据 | 新增只读 `hasBulkTransferWork(): boolean`（读同方向 `bulkTransfer.hasWork()`） | seam 接口 + 双侧实现（M3） | C17/D7 |
| `UpdateChunkAssembler` | 单一聚合上限、UPDATE_* 码 | 按 kind 取上限、族中性原因、busyKind、跨帧 kind 一致 | 泛化改动（kind=0 行为等价） | C5 |
| 两侧 `sendFacet` | live 门 + channel 单源 | §7 D7 三段仲裁 + 聚合口径 | 调度面改动 | C8 |
| **双侧 resync 边沿挂点（`onResyncReceived` / `declareLocalResync`·`onLocalResyncEdge` 漏斗 / `onAckTimeoutFired`）** | 仅 channel 弃置 + 入站 assembly 清理 | 同点追加 `bulkTransfer.abortForResyncDeclared()`（载体弃置 + 归 idle）（M2） | 加法式改动（C19 三族挂点） | C19 |
| `hub/peer-namespace` teardown 三调用点（hub L1460-1、peer L468-9/L1812-3） | channel/round teardown | 追加 `bulkTransfer.teardown()` | 加法 | C9/D11 |
| `clearInboundAssembly` | 无 reason kind 门 | `busyKind===0` 门控 aborted 事件；超时收口按 busyKind 选路（D9 精确闭包） | 观测/超时面 | C9/D8/D9 |
| **`packages/replication-protocol/src/errors.ts`（`NAMESPACE_ERRORS`/`NamespaceErrorCode`/`lookupError`）** | 22 条注册表、无四码 | **D12 append-only 首登四行冻结值 + 联合扩展 + 计数注释**（encode/decode 由 fail-closed 转为可编码） | 注册表 append（B1） | C14/C15 |
| **`packages/replication-protocol/test/fixtures.ts`（`NAMESPACE_ERROR_TABLE`）** | 22 条镜像 | append 四行 + 计数注释（golden/消息 fixtures 零触碰） | 测试镜像同步（B1） | C20 |
| **`packages/replication-protocol/test/codec-issue242-ac-red.test.ts`（注册表用例）** | `toHaveLength(22)` + 既有条目抽样锚 | 计数 26 + 四码冻结元数据/ERROR 往返断言（该测试既定 append-only 维护路径） | 测试同步（B1） | C20 |
| `frame-io.namespaceFieldViolation` / `decodeInbound` | 入站防御 + pre-parse 门 | **零改动**（R43/R47） | 无 | C10/C11 |
| `backpressure.ConnectionSender` / wheel | facet 协议消费 | **零改动**（facet 接口形状不变；wheel 留轮经聚合 queuedCount 自然覆盖 bulk） | 无 | C8/C17 |
| `defaults/types/validate/plugin`（配置链） | #299 落地 | **零改动** | 无 | C13 |
| `error-mapping.ts` | `terminalStateOf` 单点（lookupError 驱动） | **零改动**——前提修正（SA2-B1）：D12 首登落地后 `lookupError('namespace', 四码)` 命中冻结元数据、terminalState='failed' 自动导出；原「新码经 codec 注册表 lookup 生效」的隐含前提（已注册）为假 | 无（前提由 D12 兑现） | C15 |
| `packages/ws-replication/test/driver.ts` | BootOptions 无 `chunkedUpdate`、`createPeerReplication` 不设（连接恒未协商） | BootOptions 新增可选 `chunkedUpdate?: boolean` 并在 `createPeerReplication` 调用条件展开透传（undefined 时零传——其余测试零影响）（M4） | harness 加法 | C21 |
| 间接调用方（plugin.ts 组装、apps、其它包） | 经 `src/index.ts` 公共面消费 | 公共 API 面零变化（`BulkTransferSender` 包内私有，不经 index 导出；`chunkedUpdate` 旋钮为 #243 既有公共面） | 无 | ws-replication AGENTS |

---

## 11. 验收与验证映射

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
|---|---|---|---|
| AC1 分块 snapshot 收敛 + 单 ACK 锚 | SA6 R1 红（契约文件已在库） | R1 原样转绿（零修改） | ≥2 个 kind=1 chunk、结构断言、peer live、恰一 BOOTSTRAP_ACK 锚末 chunk 帧序、零 ERROR、零单帧 snapshot |
| AC2 双向分块 diff 收敛 | SA6 R2/R2b 红 | 原样转绿 | kind=2 chunk 结构、绑定 round 一致、恰一 SYNC_APPLIED 锚末 chunk 帧序、totalBytes > maxSyncDiffBytes、零超限单帧 Step2 |
| AC2·R42 跨 kind 计数器 | SA6 R2 断言 | 原样转绿 | kind=2 transferId > 先前 kind=0 transferId |
| AC3 data 路径记账 / control 零 chunk | SA6 R3 红 | 原样转绿 | 闸门关：零 chunk、零单帧 snapshot、peer 非 failed；开闸后收敛 |
| **AC4·B1 四码注册与可发射性** | C14（注册表无四码——现状红的前提）| D12 落地后：`codec-registries`（fixtures 同步后自动）+ `codec-issue242-ac-red` 注册表用例（计数 26 + 四码断言）+ `encodeMessage`/`decodeMessage` ERROR 往返 | 四码往返成功、`lookupError('namespace', code)` 命中 §13.2 L445–448 冻结元数据（VIOLATION=yes/no/failed；TOO_LARGE=yes/config/failed）；SA6 R4/R6/R7 的 wire 码断言路径成立 |
| AC4·R44 校验族与边界 | SA6 R4 红 | 原样转绿 | TOO_LARGE/VIOLATION 三类映射 + 恰在上界接纳（assembly 悬置零写入） |
| AC4 绑定块既有码 | SA6 R5 红 | 原样转绿 | REPLICATION_ID/EPOCH_MISMATCH + failed + 零写入 |
| AC4·R44 kind=2 跨帧/绑定 | SA6 R6 红 | 原样转绿 | SYNC_TRANSFER_VIOLATION / SYNC_STATE_VIOLATION + hub 零写入零 dirty + 连接 ready |
| AC4·R45 发送端聚合超限 | SA6 R7 红 | 原样转绿 | wire 出现 SYNC_TRANSFER_TOO_LARGE、无 SYNC_DIFF_TOO_LARGE 回落、failed、零写入 |
| AC5 触发条件保持 | SA6 N1/N2 绿 | 保持绿 | 界内单帧路径零 0x42 |
| R43 协商门 | SA6 N3 绿 + `codec-issue242-ac-red.test.ts` | 保持绿 | pre-parse UNSUPPORTED_MESSAGE_TYPE（不分 kind） |
| R47 kind=0 等价 | SA6 N4 + #243–#246 全部既有测试 | 全包回归保持绿 | kind=0 逐字节等价（含 onAck 扩展后——无 bulk 工作时条件同义） |
| 刻画文件不动且绿 | C12（未协商驱动 `issue137-driver.ts`） | `ws-replication-issue233-repro.test.ts` 零改动、保持 3/3 绿 | R3 在 v1 组合仍 SYNC_DIFF_TOO_LARGE 终局（D0） |
| **§23.3 场景 14 改写（M4 修订：协商前提显式化）** | `ws-replication-issue256-namespace-failed.test.ts` 场景 14（现断言 BOOTSTRAP_TOO_LARGE；`test/driver.ts` 恒未协商——仅改构型新码不可达） | 改写三要素：① 场景连接协商 `CAP_CHUNKED_UPDATE`（经 driver `chunkedUpdate: true` 透传——C21 peer 单旋钮决定协商）；② 构型 = `len > maxChunkedBootstrapBytes`（如 maxBootstrapBytes=8KiB、maxChunkedBootstrapBytes=32KiB、hub 文档 100KB，链②约束满足）；③ 断言 hub `namespace-error{sent: SNAPSHOT_TRANSFER_TOO_LARGE}` + `namespace-failed{cause:'send-failed'}` + peer remote-error | 新码在 hub send-failed 行可观察（§23.3 L814 冻结锚达成） |
| **M1 observer 改道归零** | 无既有 kind=2 分块锚（SA2 §12：现有锚测不出） | §23.3 第 33 型符合性探针（可并入 bulk-edge 探针文件或 #301 动态面；observer 在场注入）：kind=2 分块完成点 + 单帧 Step2 对照 | kind=2 分块完成点零普通族 `sync-diff-applied`（且零一切事件——#301 前）；单帧 Step2 路径 `sync-diff-applied` 逐字节不变；#239 既有锚保持绿 |
| **M2 resync 边沿出站静止性** | 契约外（SA2 S2） | bulk-edge 探针：kind=2 transfer 进行中注入对端 RESYNC_REQUIRED / 本端声明边 | 边沿后本方向零新增 kind=2 chunk 出站（wire 断言）；边沿前在途帧 ≤ 窗口内已出站数；对端不落假性 SYNC_TRANSFER_VIOLATION 终局 |
| **M3 窗口满唤醒** | 契约外（SA2 S1：契约测不出、生产可达） | bulk-edge 探针：窗口占满（`maxInFlightUpdates` 个 kind=0 在途）+ kind=2 排队 → 逐个 ACK 释放槽位 | ACK 释放后 drain 被请求、kind=2 chunk 出站、round 收敛（无 60s 级停滞）；N1–N4 与 kind=0 回归保持绿 |
| **M5 出站被拒处置** | 契约外（SA2 S3） | bulk-edge 探针：注入 data 出站被拒构型（如严格接纳投影超 cap 的 limits 组合，`dataGateOpen` 保持 true） | kind=2 → needs-resync + RESYNC_REQUIRED{send-failed 族}、零静默零自旋；kind=1 → BOOTSTRAP_FAILED + failed/send-failed；均无重复终局 |
| **M2/M3/M5 探针载体** | — | 建议新增 `packages/ws-replication/test/ws-replication-issue300-bulk-edge-ac.test.ts`（命名建议；SA3 可调，勿改契约文件）——三条机制探针经真实 harness，非 SA6 契约（契约文件仍零改动） | 全绿；全包回归零波及 |
| 互通矩阵（v1 组合） | `ws-replication-issue246-interop-matrix.test.ts` | 保持绿 | 未协商 ⇒ v1 行为逐字节保持（D0） |
| observer 锚 | issue256（除场景 14）/observer-red/#239/#245/#231 | 保持绿 | D8 零新事件 + 改道点归零不破锚 |
| 文档同步 | 协议 §22 L701 现措辞「后续切片交付…不预设其存在」 | 更新为引用已交付测试资产（SA6 契约 + 转绿后传输层 kind=1/2 资产）；`git diff --check` + 过期术语扫描 | 引用一致、无残留废弃措辞 |
| 全量门 | SA6 §13 命令集 | `npx vitest run packages/ws-replication/test --typecheck.enabled=false`（8 红 → 0 失败）、`npx vitest run packages/replication-protocol/test --typecheck.enabled=false`（**D12 后注册表/codec 套件全绿**）、`npx tsc -p packages/ws-replication/tsconfig.json`、根 `pnpm typecheck`、`pnpm test` | 全绿 |

SA1 未运行上述命令（职责边界）；SA6 已提供改动前基线，转绿判据以 SA6 §13 为准。

---

## 12. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
|---|---|---|
| `packages/replication-protocol/src/errors.ts` | **D12（SA2-B1）**：`NamespaceErrorCode` 联合 +`SNAPSHOT_TRANSFER_VIOLATION`/`SNAPSHOT_TRANSFER_TOO_LARGE`/`SYNC_TRANSFER_VIOLATION`/`SYNC_TRANSFER_TOO_LARGE`；`_namespaceErrors` append 四行协议 §13.2 L445–448 冻结元数据（yes/no/failed、yes/config/failed ×2）+ 来源注释；计数注释 22→26 | AC4/SA6 R4/R6/R7 的发射面前置（C14/C15：未注册 → encode/decode fail-closed，D10 结构性不可实现）；append-only 为模块 AGENTS 明文允许的演进路径，先例 = #242 于 L136–139 |
| `packages/replication-protocol/test/fixtures.ts` | **D12**：`NAMESPACE_ERROR_TABLE` append 四行 + 计数注释；**其余（golden 向量/消息 fixtures）零触碰** | `codec-registries.test.ts` L109 键集等价断言要求注册表与镜像表同步（C20） |
| `packages/replication-protocol/test/codec-issue242-ac-red.test.ts` | **D12**：注册表 append-only 用例（L461–462）计数 22→26 + 四码冻结元数据/ERROR 往返断言 | 该测试锁定注册表规模与元数据（C20）；其既定维护路径即随 append-only 演进同步计数（20→22 先例） |
| `packages/ws-replication/src/bulk-transfer.ts` | **新增**：`BulkTransferSender`（D1：状态机含 M5 出站被拒转移、abort 面含 M2 resync-declared 三族挂点）+ 宿主 seam 类型 | kind=1/2 发送端唯一载体 |
| `packages/ws-replication/src/update-transfer.ts` | `ChunkedTransferPiece` 扩展 kind/绑定成员；assembler 按 kind 取聚合上限、族中性违例原因、busyKind、跨帧 kind 一致（D5/D6） | 接收端 kind 泛化单一事实源 |
| `packages/ws-replication/src/update-channel.ts` | 新增包内只读 `hasActiveTransfer()` 与 `allocateTransferId()`（D2/D7）；**onAck drain 条件扩展 `∨ host.hasBulkTransferWork()`（M3）**；kind=0 出站 piece 携 `transferKind: 0` | R42 计数器共用 + facet 互斥判据 + 窗口空位唤醒（无 bulk 工作时逐字节同义） |
| `packages/ws-replication/src/round-engine.ts` | `sendStep2` 经 `host.sendStep2` seam；`noteChunkedStep2Outbound`/`admitChunkedStep2`/`completeChunkedStep2`（D3，完成点携 syncChunked 形态） | kind=2 发送/接收 round 语义单点 |
| `packages/ws-replication/src/hub-namespace.ts` | `startBootstrap` 三分叉（D4）；`onUpdateChunk` kind 分派（D5）；facet 仲裁（D7）；`applyRemoteUpdate` syncChunked 门（M1）；resync 边沿三族挂点追加 bulk abort（M2）；channel host `hasBulkTransferWork` 实现（M3）；kind=1 出站被拒收口（M5）；`sendUpdateChunkFrame` kind 透传；`onAssemblyTimeout` 按 busyKind 选路（D9）；`clearInboundAssembly` kind 门（D8）；teardown 追加（D11） | hub 侧端到端接线 |
| `packages/ws-replication/src/peer-namespace.ts` | `finishBootstrapImport` 抽取与 kind=1 完成路由（D5）；`onHubUpdateChunk` kind 分派；facet 仲裁；`applyRemoteUpdate` syncChunked 门（M1）；resync 边沿挂点（M2）；host seam 实现（M3）；kind 透传；超时选路（D9 精确闭包）；aborted kind 门；teardown 追加 | peer 侧端到端接线 |
| `packages/ws-replication/src/hub-connection.ts` | `sendUpdateChunk` kind/绑定透传（`HubChannelHost` 签名同步）（D5/C6） | 出站面 kind 泛化 |
| `packages/ws-replication/src/peer-connection.ts` | 同上（`PeerNamespaceHost` 签名同步） | 同上 |
| `packages/ws-replication/test/driver.ts` | **M4**：BootOptions 新增可选 `chunkedUpdate?: boolean` + `createPeerReplication` 条件展开透传（undefined 零传，其余测试零影响） | 场景 14 改写的协商前提（C21：peer 单旋钮决定协商；SA2-M4 要求 harness 面入列） |
| `packages/ws-replication/test/ws-replication-issue256-namespace-failed.test.ts` | 场景 14 改写（R45/§23.3 义务；M4 修订：含协商前提 + 超聚合构型） | hub send-failed 行锚更新 |
| `packages/ws-replication/test/ws-replication-issue300-bulk-edge-ac.test.ts` | **新增（命名建议）**：M2/M3/M5 三条机制探针（§11 行） | 契约外机制接线的可执行验收锚（SA2 修订验收行） |
| `docs/protocols/instance-replication-v1.md` | §22 L701 测试资产措辞收口（R47 文档同步；§13.2/§23.3 表本体已冻结正确，零语义改动——D12 是兑现 §13.2 表而非改表） | 实现票文档同步义务 |
| `wiki/raw/task_issue-300_design.md` | 本设计产物（原位更新） | SA1 产物 |

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/ws-replication/test/ws-replication-issue233-repro.test.ts` | 刻画基线 | AC5/ADR 0022 L103 显式「不改刻画文件」；D0 保证实现后仍绿 |
| `packages/ws-replication/test/issue137-driver.ts` | 刻画文件驱动（未协商 bootMulti） | 刻画基线的组成部分（C12）；协商前提只经 `test/driver.ts` 透传，不触碰刻画驱动 |
| `packages/ws-replication/test/ws-replication-issue300-chunked-sync-ac-red.test.ts` | SA6 验收契约 | 契约由实现转绿，不得为绿而改断言 |
| `packages/replication-protocol/src/payloads.ts`、`packages/replication-protocol/src/messages.ts`、`packages/replication-protocol/src/index.ts`、`packages/replication-protocol/test/codec-messages-golden.test.ts`、`packages/replication-protocol/test/codec-issue299-ac-red.test.ts` | codec 形态面（0x42 单形态/字段序/golden 冻结值/公共导出） | #299 已冻结（R47）；**SA2-B1 修订：DENY 范围从「`packages/replication-protocol/src/**`」收窄为 codec 形态面——`src/errors.ts` 注册表面按 D12 解禁（append-only 首登），其余 codec 面仍禁** |
| `packages/ws-replication/src/{frame-io,error-mapping,backpressure,defaults,types,validate,plugin,liveness,fence-watchdog,lifecycle-queue,observer,testing,index}.ts` | 解码门/错误映射单点/RR 调度器/配置链/公共导出 | 设计判定零改动（§10；error-mapping 零改动结论以 D12 落地为前提）；防顺手改。backpressure 的 wheel 留轮经 facet 聚合口径自然覆盖，无需改调度器 |
| `packages/namespace-registry/**`、`packages/namespace-runtime/**`、其余 packages | 排他导入/sequencer/lease seam | 「与单帧路径同一导入语义」——经既有 seam 消费，零改动 |
| `docs/adr/**`、`CONTEXT.md` | 决策与词汇 | ADR 0022 + 词条已冻结且与本设计一致；无新决策/新术语（D12 为既有冻结值的实现，不构成 ADR 修订） |
| `docs/adr/0019-vfsl-union-member-docs.md`（若经合并出现） | N6 同号 ADR（已消解） | 归属 origin/main 提交，非本基线决策集；owner 已裁决本基线篇重编号 0019→0022（0020/0021 已被 #311/#318 占用），VFSL 篇维持 0019 |
| `apps/**`、`domains/**`、`scripts/**`、根配置 | 无条款交集 | SA8 §3 零交集确认 |

---

## 13. 风险、回滚和残余问题

| 风险 | 等级 | 缓解 | 残余 |
|---|---|---|---|
| **窗口满 + channel 队列空的唤醒构型（SA2-M3）**：恢复期 8/8 在途占满是生产常态，bulk 载体等待槽位期间仅靠 M3 扩展条件唤醒 | 中 | onAck drain 条件扩展（D7/M3）+ bulk-edge 探针锁定；无 bulk 工作时与现状逐字节同义 | 探针为契约外新增（非 SA6 契约行），依赖实现票落实；遗漏则停滞以 60s ackTimeout 兜底（可恢复但劣化） |
| facet 仲裁引入 kind=0/kind≠0 互斥后，data 闸门长期关闭使 kind=0 transfer 滞留 → kind=2 排队延迟 → round 停滞 | 中 | 既有 reconcile/ack/bootstrap 超时面兜底（D9）；#301 覆盖两向收口矩阵 | 停滞期吞吐损失为冻结语义（data 路径记账）的固有代价 |
| **M2 边沿后在途帧残渣**：resync 边沿只保证零新增出站，已上线帧仍可达对端 | 低 | 接收端残渣矩阵 kind=2 与 kind=0 F3 同构（needs-resync/reconciling 良性丢弃）；stale 首 chunk 落 admitChunkedStep2 round 核对（与单帧 Step2 迟到帧同语义） | 恶意/极端交错仍按违例响亮拒绝（正确行为）；完备矩阵归 #301 |
| `ownStep2Seq`/`bootstrapSnapshotSeq` 异步锚与合法 ACK 的时序 | 低 | 锚在末 chunk 出站同一同步调用栈赋值（因果先于 ACK 到达）；undefined 期收到 ACK → 既有 connection fatal 防御 | 无 |
| 单 assembly 接收不变量被跨 kind 并发误伤 | 中 | D7 发送端互斥（结构性消除）；接收端 busy∧异 transferId/kind → violation 兜底 | 恶意构造仍按违例响亮拒绝（正确行为） |
| R5 终态裁定（binding mismatch → failed 而非 conflicted）与注册表行表面张力 | 低 | SA6 契约（已批准）断言锚定 + §7 D5 理由；**SA2 E3 评估后支持本裁定** | 设计后复审确认（§15） |
| **M5 出站被拒的新入口面归入 §23.3 send-failed 行（hub 入口原文「控制帧编码面失败 + 快照超聚合上限」未逐字列 chunk 出站被拒）** | 低 | cause 字面量/闭集合零触碰（append-only 不变）；「出站发送异常族」读法与 peer 入口「发送异常」同源；M5 处置镜像 #243 既有先例 | 设计后复审确认该入口面读法（§15） |
| **D12 注册表首登的测试同步遗漏**（fixtures/计数断言不同步 → codec 套件红） | 低 | C20 列全同步面（errors.ts 注释 ×3、fixtures 表、issue242 计数用例）；codec-registries 为键集等价驱动，漏同步即红（fail-loud） | 无 |
| kind=1 assembly 停滞收口选路（D9）超出 #300 字面切片 | 低 | 不选路则发错 reason/误入 needs-resync（冻结面违例）；接线最小化（既有 closeout 点 + busyKind 选路 + 精确闭包），矩阵测试归 #301 | 切片边界解释权在复审确认 |
| 观测面中间态（改道点普通族归零、8 型未接线）造成观测空窗 | 低 | R46 预告的已知中间态；#301 接线；M1 门保证归零不违 §23.3 第 33 型 | #301 |
| shed/abort 对 kind=1/2 的收口细节（BOOTSTRAP_FAILED/resync 边沿选择） | 中 | D1 abort 面完整枚举（含 M2/M5）+ 保守映射；完备 abort 矩阵归 #301 | #301 |
| 超大载体内存（发送侧持完整载荷 + 接收侧一次性分配） | 低 | 双侧均受已验证聚合上限约束（§17 公式）；无新配置 | 无 |

**任务内必要条件全部可满足，无阻塞项。** SA2-B1 + M1–M5 全部在本票范围内闭合（B1/M1 = 冻结面正确性、M2/M3/M5 = 共享管线机制接线、M4 = 本票验收义务——均非 #301 范围，SA2 §11 同裁定）。Follow-up（非本票）：#301 生命周期完备性 + observer 8 型接线 + 超时两向收口矩阵 + 公平调度回归；N6 ADR 重编号（owner/总控）；SA6 §8/§11 注册表断言更正的回执（SA2 非阻塞 #6，转 SA6/总控，不阻塞本票）。

---

## 14. 评审修订映射

评审输入 = `wiki/raw/task_issue-300_sa2_review.md`（reject：SA2-B1 + SA2-M1–M5 + 非阻塞观察 1–7）。逐条处理：

| Finding | 修订位置 | 处理结果 |
|---|---|---|
| **SA2-B1（BLOCKER）**：四新码未在 codec 注册表注册，D10 发射面在自身 DENY LIST 下结构性不可实现（AC4/SA6 R4/R6/R7 不可转绿） | §7 D12（新增决策节）；§1 目标 4/非目标措辞；§2 C14/C15/C20；§3 G6；§5 SA6 断言更正行；§6 R47/Frozen surfaces 行；§8 路线⑥；§10 errors.ts/fixtures/issue242 测试/error-mapping 四行；§11 AC4·B1 行 + 全量门（replication-protocol 套件）；§12 ALLOW（errors.ts/fixtures/issue242）+ DENY 收窄；§13 测试同步遗漏风险 | **已落实**：errors.ts 移入 ALLOW LIST，按协议 §13.2 L445–448 冻结值 append-only 首登四行 + 联合扩展 + 计数注释 + fixtures 镜像 + issue242 计数用例同步（先例 #242 L136–139）；§10 error-mapping 行前提修正（首登后零改动）；§6 R47「不得重复登记」前提修正为「首次登记」；DENY 对 replication-protocol 收窄为 codec 形态面 |
| **SA2-M1（MAJOR）**：D8 归零声明与 D3 机制矛盾（applyRemoteUpdate isStep2 无条件发射 sync-diff-applied，违 §23.3 第 33 型冻结改道语义） | §7 D3「M1 抑制门」小节；§7 D8 论据修正；§2 C16；§10 applyRemoteUpdate 行；§11 M1 探针行；§13 风险表（M1 门） | **已落实**：第 5 参扩展判别联合 `{chunkCount}` \| `{syncChunked:true}`，`isStep2` 普通族发射按 syncChunked 门控，kind=2 完成点零事件（chunked-sync-applied 归 #301）；D3「C3 单点不改」改为「结算单点与锚值逻辑不变、唯一函数内变化 = 第 5 参形态」；D8「结构性成立」论据修正为「经 M1 显式门控成立」；单帧/kind=0/else 路径逐字节不变 + peer degraded 先行保持 |
| **SA2-M2（MAJOR）**：kind=2 发送器缺 resync-declared 中止接线（被超越 round 的 chunk 继续出站 → 对端假性 SYNC_TRANSFER_VIOLATION 终局） | §7 D1 abort 面 4（resync-declared 三族挂点）+ 状态机 abort reason 集；§2 C19；§8 路线②③错误列；§10 resync 边沿挂点行；§11 M2 探针行；§13 在途帧残渣风险 | **已落实**：abort 面显式枚举三族边沿（收对端 RESYNC 的 `onResyncReceived`、本端 wire 声明漏斗 `declareLocalResync`/`onLocalResyncEdge`、ack-timeout funnel `onAckTimeoutFired`——与 channel 同一挂点 C19），载体弃置 + 归 idle + 拆 timer；「enqueue 非 idle」防御分支的不可达性依赖已显式注明（非阻塞 #4）；完备中止矩阵测试归 #301 |
| **SA2-M3（MAJOR）**：in-flight 窗口满且 channel 队列空时无唤醒路径（onAck 仅 `queued.length>0` 触发 drain——活性缺口） | §7 D7「M3 窗口空位唤醒路径」小节；§2 C17；§10 UpdateChannel 行 + channel host seam 行；§11 M3 探针行；§13 首行风险 | **已落实**：onAck drain 条件扩展为 `queued.length>0 ∨ host.hasBulkTransferWork()`（channel host seam 新增只读判据，读同方向 bulkTransfer.hasWork()）；R47 等价论证（无 bulk 工作时逐字节同义）+ 闭合论证（槽位释放事件 = UPDATE_ACK；wheel 留轮经聚合口径覆盖）；构型入 §13 风险表 |
| **SA2-M4（MAJOR）**：场景 14 改写在未协商 harness 上不可执行（driver 无 chunkedUpdate，新码结构性不可达；harness 面不在 ALLOW LIST） | §7 D6/R45 行（§6）；§2 C21；§11 场景 14 行（三要素：协商前提 + 超聚合构型 + 断言）；§10 driver.ts 行；§12 ALLOW driver.ts + DENY issue137-driver.ts | **已落实**：改写方案显式含「场景连接协商 CAP_CHUNKED_UPDATE」（经 driver BootOptions `chunkedUpdate` 透传——C21 证明 peer 单旋钮决定协商、hub 恒支持、undefined 零传不影响其余测试）；driver.ts 入 ALLOW LIST 并给理由；刻画驱动 `issue137-driver.ts` 入 DENY 保护 |
| **SA2-M5（MAJOR）**：bulk chunk 出站被拒（seq=0）语义未定义（停滞/自旋/伪成功/整笔 abort 均未指定） | §7 D1「出站被拒转移」小节 + 备选 ④；§2 C18；§7 D10 两行（kind=1/kind=2）；§8 路线①②错误列；§11 M5 探针行；§13 入口面读法风险 | **已落实**：镜像 #243 send-failed 族——失败明细先采样 → 载体弃置归 idle → kind=2 `declareLocalResync('send-failed', detail)`（needs-resync 恢复）/ kind=1 `sendNsError('BOOTSTRAP_FAILED')` + `finalize('failed','send-failed')`；fail-loud、零静默、零自旋；§23.3 send-failed 行入口面读法入 §15 复查焦点 |
| 非阻塞 #1（D4 timer 措辞不准） | §7 D1 kind=1 附加 + D4 伪代码注释 | 已落实：「武装点前移至 enqueue，bootstrapTimeoutMs 覆盖整个传输期（含排队等待）」，并注明现状锚位（hub L571 单帧发送后） |
| 非阻塞 #2（D10 绑定块行「发送方」笔误） | §7 D10 绑定块行；§7 D5 终态裁定 | 已落实：改为「接收方（peer）按 protocol-violation → failed」 |
| 非阻塞 #3（R5 终态裁定评估） | §7 D5（保留裁定 + SA2 E3 支持注记）；§13；§15 | 已保留：wire 码协议冻结、本地终态 failed 有据（SA6 R5 锚定）；设计后复审确认（§15 焦点） |
| 非阻塞 #4（enqueue 非 idle 可达性依赖） | §7 D1「每 (ns,方向) 至多 1 个」条目 | 已落实：显式注明不可达性依赖 M2 resync 边沿接线 + round/abort 面完备，接线前该分支实际可达 |
| 非阻塞 #5（D9 cause 措辞不通顺） | §7 D9 kind=1 行 | 已落实：精确闭包 = 弃 partial → `sendNsError('BOOTSTRAP_FAILED')` → `finalize('failed','bootstrap-timeout', timeouts.assemblyTimeoutMs)`，并说明 cause 字面量来源（§23.3 闭集合）与 timeoutMs 语义（实际到期上限）及与 bootstrap timer 的先序关系 |
| 非阻塞 #6（SA6 §8/§11 注册表断言为事实错误，转 SA6/总控） | §5 末行（上游事实更正承接）；§13 follow-up | 已登记：设计按 C14 真实状态承接（不依赖 SA6 回执）；更正建议随 SA2 转 SA6/总控，非本票阻塞项 |
| 非阻塞 #7（正面核实记录） | §2（C1–C13 注记「与 SA2 评审核对一致」）；§7 D0（v1 门保持的三方交叉验证注记）；D9（SYNC_TRANSFER_EXPIRED 自由字符串注记） | 已吸收：正面结论原样保留并标注双方核对一致 |

---

## 15. 设计后 ADR 冲突复查

**需要（`requiresConflictRecheck: true`）。** 触发条件（skill 第 15 节）：wire 传输路径变化（0x42 kind=1/2 端到端）、失败语义变化（四新码发射点、hub send-failed 行改挂 `SNAPSHOT_TRANSFER_TOO_LARGE`、v1 组合死码保持面、**M5 出站被拒作为 send-failed 行新入口面**）、namespace 状态机承载行为变化（bootstrapping/reconciling 承载分块传输）、**codec 错误注册表面触碰（D12 append-only 首登——公共 API/协议注册表变化，SA2 §13 验收要求复审重点扩展至 replication-protocol 注册表面）**——与 SA8 §10 预告一致。建议复审重点：① D12 首登与协议 §13.2 L445–448/R47 append-only 义务的逐值核对 + SA6/SA8「已注册」前提更正的确认；② R42 计数器共用实现；③ R43 v1 门保持（D0 与刻画文件/互通矩阵相容性）；④ R45 发送端预检选择与场景 14 改写（协商前提）；⑤ R47 冻结面零顺手改核查（codec 形态面 DENY 收窄的正当性）；⑥ §7 D5 的 R5 终态裁定；⑦ M5 入口面归入 §23.3 send-failed 行的读法确认。

# SA1 实施设计 — Issue #243（issue #233 切片 2：协商 CAP_CHUNKED_UPDATE 超限 UPDATE live 分块传输）

- Dispatch：`sa-2f765e76-f2af-4273-8d4a-17ac48174566`（mabf-sa1 / design / iteration 2，F6/F7 修订版）
- 工作区：worktree `nomicore-fix-issue-243`，分支 `mabf/issue-243`，HEAD `c20aeb0`（PR #264 slice 1 已 merge；父 PR #241 OPEN，堆叠伞）
- 输入：`wiki/raw/task_issue-243.md`（Host 简报，零评论）、`wiki/raw/task_issue-243_sa6_contract.md`（approve）、`wiki/raw/20260908-sa8-conflict-gate-issue-243.md`（clear，D1/D2 必答）、`wiki/raw/task_issue-243_design_conflict_recheck.md`（clear，O1–O4）、`wiki/raw/task_issue-243_design_conflict_recheck_r2.md`（clear + **必答观察 O5**）、`wiki/raw/task_issue-243_sa2_review.md`（**iteration 1：reject，2 MAJOR（F6/F7）——F1–F5 验证为全部正确落实**；本版逐条落实，见 §14）
- 本版为 SA2 iteration-1 reject 后的修订：**F1–F5（iteration-0 MAJOR）维持原修订不动**（SA2 iteration-1 §15 逐条验证通过，本版仅随 F6/F7 触点同步措辞）；**F6 = SA8 r2 O5 的落实，选择路径 B（slice 2 内语义闭合，§7 DD-7）→ 触发定向 SA8 复核（§15）**；**F7 = 声明发射点全集闭合（§7 DD-8）**。全文只描述当前一致设计，历史方案一律不保留。本任务无 `_relevant_decisions.md` / `_conflict_report.md` 固定产物（SA8 等价固定产物为 conflict-gate 报告 + 两轮设计后冲突复核报告）

---

## 1. 任务类型、目标和非目标

**任务类型：Feature**（能力交付设计；不存在既有 Bug 归因——SA6 契约 §1 已定性：slice 1 冻结 wire 面，连接层行为仍为 v1）。

**目标**：协商过 `CAP_CHUNKED_UPDATE` 的 Hub/Peer 连接上，`maxUpdateBytes < bytes ≤ maxChunkedUpdateBytes` 的单逻辑 live update 以 `UPDATE_CHUNK` 帧流 live 传输：

- 发送端出队时刻惰性切片，chunk 逐帧经既有 data 路径（独立 sequence、RR 每轮每 ns 一帧、dataGateOpen 水位闸门），整笔 transfer 占 1 个 in-flight 窗口槽（有效占用口径，§7 DD-3.6）；
- 接收端在 detached buffer 中按已验证上界一次性分配并重组，收齐核对总长后在唯一 write sequencer 中恰一次 trusted apply + dirty notification，以单 `UPDATE_ACK`（末 chunk 帧序）结算；
- **中止-恢复闭环在两个方向对称闭合**：任何弃置了在途 chunked transfer 的发送端路径，接收端都必然经 wire 信号或连接死亡清理 assembly——含 peer→hub 方向 ack-timeout 无信号弃置子路径（F6，§7 DD-7：peer 在该子路径补发 wire RESYNC，仅协商连接可触达）；
- Hub 对已应用增量经既有 session fan-out 广播给其他 Peer（applyOrigin 回声抑制，不回送来源）；
- 未协商双端与 v1 **在全部组态下**逐字节一致（超限仍丢弃 + needs-resync）——由「改道范围收窄到已协商 ∧ 可分块项」平凡保证（§7 DD-3.3，F1 修订），不依赖刻画测试的单一写形态；F6 新增 wire 行为以「transfer 在场」为结构门，未协商连接结构性不可达。

**非目标**（切片分工，ADR 0013 + SA8 §4）：

- 违例→两错误码的**分类完备化**与中止清理矩阵 / zombie 簿记 / 中止时窗口槽释放（#244 slice 3）；
- 4 个 `chunked-update-*` observer 事件（#245 slice 4）；
- `docs/protocols/instance-replication-v1.md` §10.2/§10.3 修订与 ADR 0013 转正（#246 slice 5）；**F6 新增发射点的协议文档追认（§9.4 发射点登记）随 #246**；混编部署建议（hub 分块增量以单帧 UPDATE 到达未协商 peer 触发其 v1 超限路径）随 #246 文档化（SA2 N5）；
- `maxChunksPerUpdate` / `maxConcurrentAssembliesPerConnection` / `assemblyTimeoutMs` 三配置及完整启动校验链（#244）；
- `SYNC_STEP2` diff / `BOOTSTRAP_SNAPSHOT` 分块、awareness、提高 `maxUpdateBytes`（ADR 0013 非目标）。

## 2. 当前行为与证据锚点（HEAD c20aeb0）

| 事实 | 锚点 |
|---|---|
| HELLO `optionalCapabilities` 硬编码 0 | `packages/ws-replication/src/peer-connection.ts:337`（:331-339 HELLO 构造） |
| HELLO_ACK `selectedCapabilities` 硬编码 0；onHello 参数结构无 optionalCapabilities | `packages/ws-replication/src/hub-connection.ts:707`（onHello :633-711，参数结构类型 :633-639；`requiredCapabilities !== 0 → UNSUPPORTED_CAPABILITY` :660-663） |
| peer `onHelloAck`：身份校验（hubInstanceId/protocolVersion/nonce）→ `connectionId` 赋值 → `clearHello` → `setState('ready')`；消息类型现无 `selectedCapabilities` | `peer-connection.ts:402-441`（F5 捕获点 = 身份校验通过后、`setState('ready')` 前） |
| 双端 decode 不传 `selectedCapabilities` → UPDATE_CHUNK 入站在 payload 解析前抛 `UNSUPPORTED_MESSAGE_TYPE`（connection fatal 1002） | `frame-io.ts:59-68` decodeInbound；`peer-connection.ts:365-368`、`hub-connection.ts:609-612` 调用点；codec 门控 `packages/replication-protocol/src/payloads.ts:826-840` |
| UPDATE_CHUNK dispatch 为防御性 connectionFatal 占位 | `peer-connection.ts:525-530`、`hub-connection.ts:790-795` |
| `deliver()` live 直发分支前置 = `dataGateOpen() && inFlight.size < maxInFlightUpdates`（裸窗口口径）；超限判定在 `sendAndRegister` 内的直发时刻 | `update-channel.ts:100-130`（直发 :105-114）；`sendAndRegister` 超限分支 :210-236 |
| `deliver()` 溢出分支：`overflows()` 命中 → `discardQueued()` +（live）`needsResync` + `declareLocalResync('queue-overflow')` /（deferred）`notePendingResync()`——**队列清空但不涉及任何 transfer 状态（现状无 transfer）** | `update-channel.ts:116-125`、`overflows()` :179-182 |
| `discardQueued()` 现仅清 `queued`/`queuedByteCount`；调用方 = deliver 溢出、markResyncReceived、sendAndRegister 两失败分支、discardForConnectionPressure、teardown | `update-channel.ts:184-187`（调用点 :117/:168/:222/:242/:335/:355） |
| **`abandonInFlight()`（ACK timeout）不调用 `discardQueued`**：inFlight→zombie + disarm timer + `needsResync` + `onAckTimeout()`；冻结队列保留、恢复 round 后经 `resetForLive` 放行续排（v1 语义） | `update-channel.ts:340-348`（timer 体 :364-372：回调内先清武装标记再 `abandonInFlight`） |
| **ack-timeout 弃置的方向不对称（F6 事实基础）**：hub `onAckTimeoutFired → declareHubResync('ack-timeout')` **发 wire RESYNC_REQUIRED**（经单漏斗，ack-timer 栈内发 wire 为既有模式）；peer `onAckTimeoutFired`（**PN6b**）仅 `clearTimer + setState('needs-resync') + emitResyncRequired('ack-timeout') + deferTask(maybeStartRecovery)`——**零 wire 帧、不经 declareLocalResync** | `hub-namespace.ts:817-818`（→ :796-815）vs `peer-namespace.ts:906-915`；host 接线 peer :230 / hub :192 |
| **wire RESYNC_REQUIRED 发射点全集（F7 事实基础）**：peer **两处**——`declareLocalResync` 漏斗 :939-960 与 `onWatchdogEdge` 内联自持声明 :962-981（**PN5②**：quiet 门 → `markSessionResyncEdge` → 记忆化门 → `resyncDeclared=true` → `sendChecked RESYNC_REQUIRED` → `setState` → `emitResyncRequired('session-fanout-overflow')` → `maybeStartRecovery`，**不经漏斗**，指令序与漏斗逐行等价）；hub **单漏斗** `declareHubResync` :796-815，调用点 :749（session 边沿，`onWatchdogEdge` :741-750）/ :785-792（queue-overflow/send-failed，`onLocalResyncEdge`）/ :817-818（ack-timeout） | 源码 grep `kind: 'RESYNC_REQUIRED'` sendChecked 发射点恰此三处（连接层匹配均为收帧 dispatch 分支） |
| `maybeStartRecovery`（needs-resync ∧ `inFlightCount===0` ∧ round 未跑 → reconciling + round）；`startPeriodicReconcile`；**round 发起自 timer 栈为既有模式**（`onTimerFired('periodic-reconcile') → startPeriodicReconcile → startRound` 同步） | `peer-namespace.ts:917-923`、:927-937、:1575-1579 |
| `resetForLive()` 仅清 `needsResync` + 请求 drain（非丢弃边）；round 结算（peer/hub `onRoundSettled`）→ `setState('live')` + `resetForLive` + `resyncDeclared=false`；peer 结算含 `pendingResync → 再开 round+1` 分支 | `update-channel.ts:327-330`；`peer-namespace.ts:881-904`、`hub-namespace.ts:1044-1056`（hub 侧 `state !== 'reconciling' && state !== 'needs-resync'` 早退——live 不经结算边） |
| **hub 收 peer STEP1 不迁出 live**（`onSyncStep1` 仅 `round.onStep1`，无 setState）——peer 周期 round 期间 hub 侧发送门保持开，跨 round 的 UPDATE/chunk 流量是常态 | `hub-namespace.ts:560-567` |
| peer 周期 reconcile 与恢复发起均以 `inFlightCount > 0` 延后（§9.4 窗口收口后） | `peer-namespace.ts:917-923`（maybeStartRecovery）、:928-936（startPeriodicReconcile） |
| 接收端 UPDATE 管线：状态门（`live \| needs-resync \| reconciling∧wasLive`；quiet 静默；违例 NAMESPACE_STATE_VIOLATION+failed）→ 尺寸门 →（hub: submit 门）→ `applyRemoteUpdate` → `UPDATE_ACK{ackedSequence=触发帧序}` | peer `peer-namespace.ts:569-587`（onHubUpdate）、:1087-1200（applyRemoteUpdate，ACK :1188-1192）；hub `hub-namespace.ts:599-623`（onUpdate）、:899-993（ACK :981-985） |
| resync 声明收帧侧（`onResyncReceived` → `markResyncReceived`（清出向队列）+ `setState('needs-resync')`；peer 侧另发起恢复）与协议语义（**任一端可声明**，始终由 peer 发起新 round；发出后不再发新 UPDATE；reason 词表 append-only：`send-queue-overflow` 既有、`UPDATE_TRANSFER_EXPIRED` #242 登记） | peer :561-567 / hub :661-666；`docs/protocols/instance-replication-v1.md` §9.4 :250-266 |
| shed 分派：peer facet live → `declareLocalResync('connection-shed')`；hub facet live → `declareHubResync('connection-shed')`；非 live → `pendingResync` | `peer-namespace.ts:158-170`、`hub-namespace.ts:120-132` |
| data 出站与 RR 调度：`pullAndSendOne` 每轮每 ns 一帧，wheel 以 `queuedCount()>0` 留轮 | `backpressure.ts:201-228`（drainData）、:124-136（tryEmitData 严格接纳）；facet `peer-namespace.ts:158-170` / `hub-namespace.ts:120-132` |
| apply 恰一次 + dirty + fan-out 回声抑制：session `applyRemoteUpdate` 入 Runtime sequencer，owned-update fan-out 以 `applyOrigin` 排除来源 | `packages/namespace-runtime/src/replication-session.ts:461+`（apply）、:281（回声抑制）、:446-460（subscribeOwnedUpdates）；hub fan-out 入口 `hub-namespace.ts:723-739` |
| `onFieldViolation` 先例（字段级超限 → ns 级 ERROR + `finalize('failed','protocol-violation')`；quiet 静默） | `hub-namespace.ts:593-597` |
| plugin 封闭键集：`PEER_CONFIG_KEYS`/`PEER_OVERRIDE_KEYS`/`LIMIT_KEYS`（assertRecord 启动期 TypeError） | `plugin.ts:147-153` 键集、:287-330 断言调用点 |
| limits 缺省/校验链；`selectCapabilities(required, optional, supported)` 纯函数（optional∩supported，已导出） | `defaults.ts:16-28`、`validate.ts:132-191`；`packages/replication-protocol/src/negotiation.ts:26-29`、index.ts:55 |
| codec 单帧自洽规则已冻结（transferId≥1、chunkCount≥1、chunkIndex<chunkCount、bytes 非空且 ≤ totalBytes）；capability/错误码注册 | `packages/replication-protocol/src/payloads.ts:651-720`；`constants.ts:45`（CAP_CHUNKED_UPDATE=0x1）、`errors.ts:138-139`（两码注册） |
| ADR 0013 中止条款：连接 shed / 队列溢出 / ACK timeout / RESYNC_REQUIRED / 终态 ⇒ 停发后续 chunk、末 chunk 序入 zombie 簿记、**needs-resync 同构处置**；接收端弃置触发清单（连接断开、close/终态、GOAWAY drain、epoch fence、**收到 RESYNC_REQUIRED** ⇒ 全部丢弃） | `docs/adr/0013-chunked-live-update-transfer.md`:54、:58 |

运行证据：SA6 红灯契约 `packages/ws-replication/test/ws-replication-issue243-ac-red.test.ts`（P1/P2/P3 红，NC0/NC1/NC2 绿，双跑一致）。**其协商上下文经测试侧 wire 代理建立**：`rewriteChunkCapability` 只改写 HELLO.optionalCapabilities / HELLO_ACK.selectedCapabilities 两握手帧、其余逐字节透传（fixture 头注 + NC0）——peer 本地旋钮为关。该事实是 F5 公式的裁决输入。fixture `ackTimeoutMs=60s` 虚拟——红灯断言面不含 ack-timeout 路径，与 F6 新增行为零交集（SA6 契约 §「规模」注）。

## 3. 能力缺口（承接 SA6 §8，非 Bug 根因）

1. **协商面**：无任何代码消费 capability 位——HELLO/HELLO_ACK 硬编码 0，会话无 negotiated 状态，decode 不透传（SA6 缺口②）。
2. **发送面**：`UpdateChannel` 无分块分支——超限项只有丢弃路径，无「出队时刻惰性切片」与 transfer 记账（SA6 缺口①）。
3. **接收面**：UPDATE_CHUNK dispatch 为收口占位；无 detached assembly / 首 chunk 上界校验 / 总长核对 / 收齐 apply（SA6 缺口③）。
4. **中止-恢复面（F6/F7 揭示）**：接收端 assembly 清理依赖「本端 wire 声明发射点」全集闭合——peer 侧发射点枚举不完备（内联路径，F7）；peer→hub 方向 ack-timeout 弃置无任何 wire 信号，接收端 doomed assembly 无清理边（F6）。
5. **最深缺口**：协商位在 wire 上出现也无任何行为差（SA6 对照实验 1）。

## 4. Owner 要求落实

Issue #243 **零评论**（Host 简报 `## Comments` 空；SA6 §2、SA8 门禁 §1.1、SA8 复核 r1 §1.1、SA8 复核 r2 §1.1、SA2 前后两轮七方 REST 扫描一致）——无评论衍生约束。需求面 = issue body 8 条验收标准：

| Comment ID | Updated at | Requirement | Design section |
|---|---|---|---|
| （无评论） | — | AC1 超限 live 传输 + 单 ACK、零 SYNC | §7 DD-3/DD-4、§12 |
| （无评论） | — | AC2 每帧 ≤ maxUpdateBytes/maxFrameBytes | §7 DD-3（切片尺寸）、§12 |
| （无评论） | — | AC3 恰一次 sequenced apply；失败先于 apply | §7 DD-4、§9 |
| （无评论） | — | AC4 多 ns RR 穿插；既有背压/公平不回归 | §7 DD-3（每轮一 chunk）、§12 |
| （无评论） | — | AC5 ACK 锚 = 末 chunk 出站；ackTimeoutMs 不变 | §7 DD-3.6、§12 |
| （无评论） | — | AC6 未协商 v1 逐字节一致（全部组态） | §7 DD-1/DD-2/DD-3.3/DD-7（新行为结构门）、§12 |
| （无评论） | — | AC7 fake-duplex 与真实 WS 双 seam 绿 | §11、§12 |
| （无评论） | — | AC8 首 chunk 基础校验（分类完备化归 #244） | §7 DD-4（校验矩阵）、§12 |

## 5. 复现和根因承接

| 上游事实 | 证据位置 | 设计响应 |
|---|---|---|
| P1：协商连接 20KB 写 → 0 帧 UPDATE_CHUNK，v1 resync 恢复 | SA6 §5/§13 红灯日志 | §7 DD-3 发送状态机补齐该路径 |
| P2：resync ×1 + 双 SYNC round；hub 收敛经由 round diff | 同上 | 零 SYNC 前提 = 分块路径零 needsResync 边沿（§9） |
| P3：合法单 chunk 注入 → decode 门控 1002 收口、hub 零写入零 dirty 零 ACK | 同上 | §7 DD-1（decode 透传）+ DD-4（接收管线） |
| NC0：wire 代理置位后协商上下文真实（位在帧上；peer 旋钮关） | 同上 §6；fixture `rewriteChunkCapability` | 设计以 **wire 协商位** 为唯一门控判据（A1 对齐）；**peer 侧逐字捕获 `HELLO_ACK.selectedCapabilities`**（F5，§7 DD-1.3）——代理改写握手帧后实现侧自然消费 |
| NC1：限内 update 单 UPDATE + 单 ACK | 同上 | 限内路径零改动（§7 DD-2 分发表） |
| NC2 + R1/R2/R3：未协商 v1 逐字节 | SA6 §6 + `ws-replication-issue233-repro.test.ts` | 门控缺省关（optional 位 0）；**未协商项保持 deliver 时刻直发分支判定时序**（F1，§7 DD-3.3）——平凡逐字节等价，混合队列窗亦不变 |
| SA8 r2 O5：peer 侧 ack-timeout（PN6b）无 wire 信号——「发送端全部弃置路径必发 RESYNC/CLOSE/ERROR 或杀连接」在 peer→hub 方向不成立，残留一扇 hub ns 终局 failed 窗口 | SA8 r2 §3（源码实读 peer-namespace.ts:906-915 vs hub-namespace.ts:817-818；SA2 §7-F6 独立复验） | **本版以路径 B 闭合**（§7 DD-7）：peer 在「ack-timeout 弃置时有 chunked transfer 在场」的子路径经单漏斗补发 wire RESYNC_REQUIRED——仅协商连接可触达（transfer 在场为结构门），未协商 v1 观测不变 |
| SA2 F7：peer `onWatchdogEdge` 内联自持声明（:962-981）不在设计挂点锚点内——按锚点实现则 session-fanout-overflow 声明路径不清本端 assembly/不置标记 → 同伤害类另一扇门 | SA2 §7-F7 / §13-F7（源码实读） | **本版闭合**（§7 DD-8）：挂点语义钉死为「本端任何 wire RESYNC_REQUIRED 发射点」+ 内联声明收敛回单漏斗（零行为变化声明） |
| 基线全绿：issue233-repro 3 测、codec-issue242 28 测、ac5-live 7 测 | SA6 §4/§13 | 回归面锚点（§12） |

上游事实与源码无矛盾（SA6 源码符号逐一对齐本设计 §2 锚点核验通过；SA2 §6/SA8 复核两轮独立实读确认锚点零漂移——唯二例外即 F6/F7 绑定面，本版 §2 已按源码更正并成为 DD-7/DD-8 输入）。

## 6. SA8 约束落实

| 决议或义务 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|
| **D1 临时期分配上界**（slice 2 即执行 totalBytes/chunkCount 上界校验；两码分类完备化与中止矩阵留 #244） | §7 DD-4 首 chunk 校验序 1–6：`totalBytes ≤ maxChunkedUpdateBytes`、`chunkCount ≥ 1`（codec 已强制）、`totalBytes ≤ chunkCount × maxUpdateBytes` 全部在**分配前**判定，通过后按已验证上界一次性分配 | slice 2 即守住「恶意声明不可能导致无界分配」；违例→`UPDATE_TRANSFER_TOO_LARGE`（上界族）/`UPDATE_TRANSFER_VIOLATION`（结构族）的**基础映射**即落地，完备化归 #244。SA8 复核 §2-D1 三层论证成立（chunkCount 纯计数无内存放大面） | 是（必答回查面；SA2 §5 独立复核维持合格） |
| **D2 配置旋钮切分**（slice 2 至少引入 `maxChunkedUpdateBytes`；发送端超此值回退 v1 须写明并测试） | §7 DD-1（协商旋钮形状）+ DD-2（limit 归属、回退矩阵、校验链边界） | slice 2 全量拥有 `maxChunkedUpdateBytes`（发送上界 + 接收首 chunk 上界 + 形状校验）；跨字段响亮链与另外三配置整体归 #244，**不建半套链**（SA6 fixture `maxQueuedUpdateBytes=1MiB` + 缺省 4MiB 组合下，建链即构造期 TypeError 击穿红灯契约——SA8 复核实读取证）；回退矩阵行 3 以 deliver/drain 双时刻 v1 同形显式化（F1）并有 P4-S 测试 | 是（必答回查面） |
| W1 ADR 0013 状态「提议」 | §11 DENY（不改 ADR） | 转正归 #246；本设计偏离面见 F1/F3 两行 + **F6 新增发射点**（§15）并申请定向复查 | 是（随 F1/F3/F6） |
| W2 协议文档暂滞后（§10.2/§10.3） | §11 DENY（不改协议文档） | transfer 1 槽（有效口径实现）、单 ACK 末 chunk 序、drain 名单 +1 均为 ADR 0013 已决内容或 §6.3 类条款延伸，#246 可追认；**F6 的 peer 新发射点属 §9.4 发射点登记 append（`send-queue-overflow` 既有 reason 零新词表），#246 一并追认** | 否（登记面，随 F6 复核确认） |
| W3 observer 四事件与中止矩阵后置 | §7 DD-3/DD-4（零新事件类型；末 chunk 发射既有 `update-sent` 类型维持 #238 三事件配对——SA2 N2 裁定；中止临时路径见 DD-3.7 全枚举） | slice 2 零 observer 新类型；详尽矩阵归 #244 | 否 |
| W4 诊断日志纪律 | §7 DD-4（apply 复用既有 `ReplicationSession.applyRemoteUpdate` 路径） | 零新诊断触发面；零新增 emission 调用点 | 否 |
| **SA8 复核 r1 O1**（未协商超限项改道时序窗：收窄改道范围 + 实现轮负控） | §7 DD-3.3 + DD-2 矩阵（**选择收窄**：仅「已协商 ∧ 可分块」项改道入队；未协商与不可分块项保持 v1 deliver 时刻判定） | 平凡逐字节等价（全部组态，非仅刻画单写形态）；实现轮负控见 §12 F1 行。SA8 r2 §2.1 复核维持无冲突 | 否（r2 已对该面复核 clear） |
| SA8 复核 r1 O2（activeTransfer 在场时 deliver 直发窗口口径） | §7 DD-3.3/.4/.6 + §8（**有效占用口径**唯一化：`inFlight.size + (activeTransfer?1:0)`，直发前置与新 transfer 初始化前置统一采用；「逐字节不变」限定于无 transfer 组态；包内只读访问器支撑 DD-3.8） | 与 ADR 0013:52 及协议 §10.2 相容；裸口径被否决。SA8 r2 §2.4 复核维持无冲突 | 否（r2 已 clear） |
| SA8 复核 r1 O3（transferId 重建生命周期） | §7 DD-3.2（钉死：peer `dialNow()` 重建归 1——新连接作用域，ADR 0013:32） | 一句话钉死，无漂移面。r2 已核验落实 | 否 |
| SA8 复核 r1 O4（P4 标号碰撞） | §12（改名：发送端回退 = **P4-S**；接收端超界申报注入 = **P4-R**） | 消除实现轮歧义。r2 已核验落实 | 否 |
| **SA8 复核 r2 O5（必答观察，条件性冲突）** | §7 DD-3.7（abandonInFlight 信号化）、§7 DD-7（F6 路径 B 决策与备选否决）、§7 DD-4 挂点行、§8/§9/§12/§13-R3 同步更正（原五处不实断言全部改写） | **已落实，选择路径 B（slice 2 内语义闭合）**：peer 在「ack-timeout 弃置时有 chunked transfer 在场」子路径经 `declareLocalResync('ack-timeout')` 单漏斗发 wire RESYNC_REQUIRED——接收端经既有挂点 1（onResyncReceived）清 doomed assembly；未协商连接结构性不可达（transfer 在场 ⇒ 已协商），PN6b 无 transfer 分支保持 v1 逐字节；协议依据 = §9.4「任一端可声明」+ ADR 0013:54「同构处置」（hub 既有行为镜像）+ :58 接收端弃置清单（零新增接收端触发）；B(i) 单独不闭合（N7）已在 DD-7 备选否决中显式论证 | **是（路径 B 触发定向 SA8 复核——SA8 r2 §3 既有规则；§15）** |

## 7. 设计决策与主要备选方案

### DD-1 协商面与旋钮形状（D2 裁定之一；F5 修订）

**决策**：

1. **Peer 侧 opt-in 旋钮**：`PeerReplicationOptions` 新增 `chunkedUpdate?: boolean`（缺省 `false`）。为 `true` 时 HELLO `optionalCapabilities |= CAP_CHUNKED_UPDATE`（`peer-connection.ts:331-339` 单点）；`requiredCapabilities: 0` 不变。`validatePeerOptions` 补形状门（非 boolean → TypeError）。
2. **Hub 侧零配置门**：hub 支持集为冻结常量 `{ CAP_CHUNKED_UPDATE }`（编译期，源自 `replication-protocol/constants.ts:45`）。`onHello` 读 `message.optionalCapabilities`（参数结构类型补字段），用已导出的 `selectCapabilities(required, optional, supported)`（`negotiation.ts:26-29`）单点计算：`ok=false`（required 超集）→ 既有 `UNSUPPORTED_CAPABILITY` 拒绝；`selected = optional ∩ SUPPORTED` 写入 HELLO_ACK `selectedCapabilities`（`hub-connection.ts:703-710` 单点替换硬编码 0），**hub 连接随即捕获 `negotiatedCapabilities = selected`**。
3. **会话协商状态——peer 侧逐字捕获（F5 钉死）**：双连接各存 `negotiatedCapabilities: number`（uint32，缺省 0）。**peer 在 `onHelloAck` 身份校验通过后、`setState('ready')` 前，逐字捕获 `negotiated = message.selectedCapabilities`——不与本地 offered 记忆求交**（交集是 hub 侧 `onHello` 单点职责，协议 §6.2 字面；HELLO_ACK.selected 即权威协商结果）。peer `dialNow()` 重建时先复位为 0（新握手前不得残留旧代协商位）；hub 连接对象单握手生命周期，无复位面。
   - **与 SA6 红灯契约的和解（F5 裁决依据）**：冻结 fixture 的协商上下文**纯粹在 wire 层**经 transport 代理建立（`rewriteChunkCapability` 改写两握手帧；peer 本地旋钮关、本地 offered 恒 0）。若 peer 公式为 `selected ∩ offered`，代理场景下 `negotiated ≡ 0` → 发送门关闭 → P1/P2 永红，击穿 §11「红灯文件随实现零编辑转绿」承诺与 SA6 A1（判据 = wire 协商位）。逐字捕获是唯一同时满足 (a) 协议 §6.2 hub 单点交集、(b) SA6 A1、(c) 零编辑转绿的公式。
4. **decode 透传**：`frame-io.ts decodeInbound` options 增加 `selectedCapabilities`（直传 codec `DecodeOptions.selectedCapabilities`，`limits.ts:21-33`）；`peer-connection.ts:365-368` 与 `hub-connection.ts:609-612` 两调用点传 `this.negotiatedCapabilities`。握手期值为 0/未定——门控只影响 UPDATE_CHUNK，与现状逐字节一致。
5. **门控判据唯一**：发送门与 decode 门都以 **wire 协商交集位** 为判据（`(negotiated & CAP_CHUNKED_UPDATE) !== 0`），不另加实例级 feature-flag（SA6 转绿假设 A1 字面）。

**备选与否决理由**：

- *peer 侧 `negotiated = selected ∩ 本地 offered`*——**否决（F5）**：把 hub 单点职责复制到 peer 侧制造第二事实源；在 wire 代理协商（SA6 冻结注入方式）下恒为 0，冻结红灯契约无法按承诺转绿。peer 不重复计算交集，只消费权威结果。
- *裸位集旋钮 `optionalCapabilities?: number`*——否决：把 wire 注册表泄漏进应用配置，引入非法值校验面；单 bit 语义用 boolean 类型安全表达。
- *hub 侧也做配置门*——否决：超出 ADR「取交集」字面（SA6 §15 明示该偏离需刷新红灯注入方式），且制造 hub/peer 双旋钮漂移面。
- *namespace 级旋钮*——否决：capability 是连接级 wire 语义，ns 级门无协议对应物。

### DD-2 `maxChunkedUpdateBytes` 归属与发送端超限分派矩阵（D2 裁定之二；F1 修订）

**决策**：

1. `ReplicationLimits` 新增 `maxChunkedUpdateBytes: number`，缺省 `4 MiB`（ADR 0013 配置表值；`defaults.ts` + `types.ts`）。`resolveLimits` Partial 合并；`validateLimits` 对合并结果仅加 `positiveSafeInteger` 形状校验。
2. **跨字段响亮链整体归 #244**（`≤ maxQueuedUpdateBytes`、`≤ maxChunksPerUpdate × maxUpdateBytes` 与其余三配置一起交付）。理由：(a) SA8 D2「避免双切片各建半套校验链」；(b) SA6 冻结 fixture（`:86-91`）组合「显式 `maxQueuedUpdateBytes=1MiB` + 缺省 `maxChunkedUpdateBytes=4MiB`」——slice 2 若加 `≤ maxQueuedUpdateBytes` 链，六条契约用例构造期 TypeError；(c) Partial 合并语义先例（`replication-protocol/limits.ts`「未传字段不参与跨字段校验」）。
3. **发送端超限分派矩阵（F1 修订：判定时序显式化，改道范围收窄到已协商 ∧ 可分块）**。定义 `chunkable(item) = bytes > maxUpdateBytes ∧ bytes ≤ maxChunkedUpdateBytes ∧ (negotiated & CAP_CHUNKED_UPDATE) ≠ 0 ∧ nextTransferId ≤ 0xffffffff`：

| 条件 | deliver 直发分支（窗口有空位 ∧ 闸门开时） | 入队后 drain 时刻（窗口满/闸门关/deferred） |
|---|---|---|
| `bytes ≤ maxUpdateBytes` | 直发单 UPDATE——v1 逐字节不变 | 既有单帧路径（takeItems/merge）不变 |
| 超限 ∧ `chunkable` | **不进直发**（改道入有界队列，出队惰性切片，DD-3） | `pullAndSendOne` 先窥队首 → 初始化 transfer → 出 chunk 0 |
| 超限 ∧ ¬`chunkable`（未协商 ∨ `bytes > maxChunkedUpdateBytes` ∨ transferId 域耗尽） | **照常进入直发** → `sendAndRegister` 超限分支在 **deliver 时刻**判定：队列空 → 丢弃 + needs-resync + `declareLocalResync('send-failed', 'update-too-large')`；队列非空 → F4 静默丢弃 + `noteUpdateDropped('update-too-large')`——与 v1 同刻同形 | drain 取帧 → `sendAndRegister` 超限分支在 **drain 时刻**判定（v1 自身的该窗口行为，逐字节不变） |

   **等价性论证（SA8 O1 一段式，F1）**：未协商连接上 `chunkable ≡ false` 恒成立，且 `activeTransfer` 结构性不可能在场（无分块能力）→ 直发分支条件字面等于 v1 的 `dataGateOpen() && inFlight.size < maxInFlightUpdates`（有效口径在无 transfer 时与裸口径同义，DD-3.6），超限项走同一 `sendAndRegister` 路径、同一分支、同一可观测量（`update-too-large` 族 reason、RESYNC_REQUIRED 帧或静默）；窗口满/闸门关/deferred 时入队 → drain 时刻判定，这本来就是 v1 在该组态下的行为（v1 自身在窗口满时也是 drain 时刻丢弃）。**两个时序窗都与 v1 逐字节一致——等价性不依赖任何刻画测试的单一写形态，混合队列窗零漂移**。协商连接上 `bytes > maxChunkedUpdateBytes` 的不可分块项同样照常直发——D2「隐含回退」即 P4-S。
4. 有效发送上界由队列接纳自然复合（chunkable 项须过 `maxQueuedUpdateBytes` 预算 ∧ 显式 `≤ maxChunkedUpdateBytes` 判定），无运行时 clamp。

**备选与否决理由**：*超限项无论协商与否统一改道入队*——**否决（F1）**：把未协商连接的丢弃判定从 deliver 时刻推迟到 drain 时刻并前置 `overflows()` 预算检查，混合队列窗产生两向 wire/分类漂移，打破 issue body「未协商双端行为与 v1 逐字节一致」；*slice 2 同时建四配置全链*——越权 #244 且击红灯 fixture；*运行时取 `min(maxChunkedUpdateBytes, maxQueuedUpdateBytes)`*——违反「绝不运行时 clamp」纪律。

### DD-3 发送端 transfer 状态机（`update-channel.ts`，惰性切片；F1/F2/F4 修订，F6 信号化）

**核心不变量（全部来自 ADR 0013 发送端规则）**：队列持完整 update、记账口径不变；首 chunk 出队即 transfer 开始；整笔占 1 in-flight 窗口槽（有效占用口径）直至 ACK；每帧独立 sequence、独立受 dataGateOpen 与 RR「每轮每 ns 一帧」；ACK 计时锚 = 末 chunk 出站。

**状态与流程**：

1. **载体 = 队列项本身**：`chunkable` 的超限项在 transfer 期间**不移出队列**，保持在队首（FIFO push-only，结构性恒为 `queued[0]`），直至**末 chunk 出站时刻**才 shift 并核减 `queuedByteCount`。由此：wheel 以 `queuedCount()>0` 留轮（`backpressure.ts:218`）自动成立——每轮 drain 恰取一 chunk；`maxQueuedUpdateBytes/Count` 记账、连接总压投影、全部既有丢弃路径对 transfer 项零改动生效。**守恒不变量：`activeTransfer ≠ undefined ⇒ queued[0] === 载体项`**（初始化不 shift；清除与队列清空同步——见 .7）。
2. **新增私有状态**：`activeTransfer { transferId, chunkIndex, offset, totalBytes, chunkCount, item } | undefined` 与 `nextTransferId`（uint32，初值 1，每 (ns, 方向, 连接) 严格递增不回绕、任何 resync/终态不复位；**peer `dialNow()` 重建归 1**——新连接作用域，ADR 0013:32；codec 仅要求 ≥1；旧作用域 assembly 随连接拆除即弃，无跨作用域歧义 [SA8 O3]）。切片几何：`chunkCount = ceil(totalBytes / maxUpdateBytes)`，chunk i = `bytes.subarray(i·maxUpdateBytes, min((i+1)·maxUpdateBytes, totalBytes))`——每 chunk 载荷 ≤ maxUpdateBytes（AC2），帧全长链式 ≤ maxFrameBytes。
3. **`deliver()`（:100-130，F1/F4 修订）**：live 直发分支准入条件改为——
   ```
   gateOpen() ∧ effectiveInFlightCount() < maxInFlightUpdates ∧ ¬chunkable(bytes)
   → sendAndRegister(bytes)   // 限内项与「不可分块超限项」照常直发
   ```
   - **未协商连接**：`chunkable ≡ false` 且 `activeTransfer` 结构性缺席 → 条件与 v1 逐字节同义，`sendAndRegister` 超限判定发生在与 v1 相同的代码点（DD-2 矩阵行 3 等价性论证）。
   - **chunkable 项**：跳过直发、落入有界队列（预算检查后），走出队惰性切片。
   - **transfer 进行中**：限内新项（¬chunkable）经直发分支即时出站 = ADR 0013:52「window 空位允许时本 ns 小 update 可在 chunk 间穿插」的实现——前置用**有效占用口径**（F4，见 .6）；**排队项**严格 FIFO（transfer 项居首），同 ns 不引入新调度机制。
4. **`pullAndSendOne()`（:285-296）重构**（前置语义不变，返回 true ⇔ 消费即进展）：
   - `needsResync` → false（F2 后：needsResync 置位路径必已清 `activeTransfer`，无悬挂）；
   - `activeTransfer` 在场：**仅查 `dataGateOpen`**（槽已自持，不查窗口空位）→ 发下一 chunk → true；
   - 否则**窗口前置采用有效占用口径**：`effectiveInFlightCount() >= maxInFlightUpdates → false`（无 transfer 时与 v1 裸口径同义；有 transfer 时结构上不可达本分支）；
   - 队列空 / 闸门关 → false（既有 ④⑤ 前置不变）；
   - **先窥 `queued[0]`**：若 `chunkable` → 在 `queued[0]` 上初始化 transfer（**不经 `takeItems`、不 shift**，前置已确认槽位可用）并出 chunk 0 → true；若队首超限但 ¬chunkable → 走既有取帧-超限分支原样（消费即进展）；队首不超限 → `takeItems` 照旧（其贪心 `avail = max - inFlight.size` 仅在本分支可达，此时 `activeTransfer` 缺席，有效口径 ≡ 裸口径，**takeItems 零改动**）。
5. **chunk 出站**：新增 `UpdateChannelHost.sendUpdateChunkFrame(chunk: {transferId, chunkIndex, chunkCount, totalBytes, bytes}): number`，由控制器转到连接层 `sender.tryEmitData({kind:'UPDATE_CHUNK', ...})`——与 UPDATE 同一 data 出站点（水位观察、单帧守卫、统一账本投影、`OutboundQueue.emit` 序列单点分配，`backpressure.ts:124-136` / `frame-io.ts:132-134`）。返回 ≤ 0（ready 门/接纳/编码拒绝）→ 与单帧失败同构：`discardQueued` + `needsResync` + `declareLocalResync('send-failed')`（transfer 随队列一并终止，`.7` 单点清账）。
6. **窗口槽与 ACK 结算（F4 钉死 + N2）**：
   - **有效占用口径（唯一口径）**：`effectiveInFlightCount() = inFlight.size + (activeTransfer !== undefined ? 1 : 0)`——包内只读访问器（不经 `src/index.ts` 导出；消费方 = `deliver()` 直发前置、`pullAndSendOne()` 新 transfer 初始化前置、peer-namespace 周期 reconcile 延后判据 DD-3.8）。**「直发路径逐字节不变」的适用域显式限定为无 activeTransfer 的组态**（未协商连接恒满足）。
   - 末 chunk 出站时：shift 队首项并核减记账；`inFlight.set(末chunk帧序, { bytes: totalBytes, sentAt: 出站时刻 })`；`armAckTimer()`；清 `activeTransfer`。**槽位转换 1→1**（transfer 槽 → inFlight 条目）：任意时刻 `effectiveInFlightCount() ≤ maxInFlightUpdates`，且裸 `inFlight.size ≤ maxInFlightUpdates` 恒成立（含末 chunk 注册后、ACK 前）——满足 ADR 0013:52 与协议 §10.2「窗口满只暂停该 namespace 发送」。
   - 对端 `UPDATE_ACK{ackedSequence=末chunk帧序}` → 既有 `onAck` 'ok' 路径结算（迟到 ACK 良性、abandon 后 zombie 良性、未知序 violation → `ACK_STATE_VIOLATION`——全部复用）。
   - 中间 chunk 帧（0..n-2）：不注册 inFlight、不挂 timer、**不发射 `update-sent`**（chunked-update-sent 归 #245；W4 零新事件类型）。**末 chunk 出站发射 `update-sent{sequence=末chunk序, bytes=totalBytes}`**（SA2 N2 裁定：维持 issue #238 `update-sent`/`update-acked`/`update-applied` 三事件面配对；`update-acked{bytes=totalBytes, sequence=末chunk序}` 经既有 inFlight 结算恰一次发射）。
   - **AC5 措辞校正（N2）**：`armAckTimer` 幂等（:364-366）——混合窗口（更早直发帧仍在途）下计时遵循既有「最老在途完成后重锚」语义；「计时锚 = 末 chunk 出站」在 timer 未武装时成立；`ackTimeoutMs` 语义不变；断言面（`ackedSequence` == 末 chunk 帧序）不受影响。
7. **发送端中止——结构性单点（F2 修订；F6 信号化）**：私有 `clearActiveTransfer()` 为唯一清除点，三处调用：
   - **`discardQueued()` 内联调用**（结构性单点）：`discardQueued` 是全部「队列清空」路径的汇聚点，内联后**任何**清队列路径自动同步终止 transfer，无需逐一枚举。覆盖路径（枚举仅作文档）：
     | # | 路径 | 触发 | 形态 |
     |---|---|---|---|
     | 1 | `deliver()` 溢出（live） | 并发写在窗口满/闸门关时 `overflows()` 命中 | `discardQueued` + `needsResync` + `declareLocalResync('queue-overflow')`——**SA2 指出的第六路径，现为单点覆盖** |
     | 2 | `deliver()` 溢出（deferred） | 同上，ns 非 live | `discardQueued` + `notePendingResync()`（deferred ⇒ 非 live ⇒ 结构性无 transfer，见 .8 论证） |
     | 3 | `markResyncReceived`（对端声明） | `onResyncReceived` | `needsResync` + `discardQueued` |
     | 4 | `markSessionResyncEdge`（session 溢出边沿） | session 层（watchdog 非 fence 谓词） | 同 3；控制器随后经漏斗发 wire 声明（DD-8） |
     | 5 | `discardForConnectionPressure`（连接 shed） | 连接总压 | `discardQueued` + `needsResync`；live → `declare('connection-shed')` wire 声明（两角色 facet 均然） |
     | 6 | `sendAndRegister` 发送拒绝（seq≤0） | 出站失败 | `discardQueued` + `needsResync` + `declare('send-failed')` |
     | 7 | `sendAndRegister` 超限-队列空（不可分块项） | v1 既有 | `discardQueued`（no-op）+ `declare('send-failed')`——transfer 在场时队列非空，本路径与 transfer 无交集，单点覆盖无副作用 |
     | 8 | chunk 出站拒绝（DD-3.5，新增） | chunk 帧 tryEmitData ≤0 | 同 6（transfer 随队列终止） |
     | 9 | `teardown`（连接收口） | 连接死亡 | `discardQueued` + `needsResync` |
   - **`abandonInFlight()`（ACK timeout）显式调用 + 中止信号（F6）**——该路径**不清队列**（v1 冻结队列跨 ack-timeout 保留、恢复后续排的语义必须保持，不得改为 discardQueued）。本版新增：**入口捕获 `abortedTransfer = (activeTransfer !== undefined)`**（于显式清除之前），在既有动作（inFlight→zombie + disarm + `needsResync` + 显式 `clearActiveTransfer()`——载体保留 `queued[0]`）之后，尾调 `host.onAckTimeout(abortedTransfer)`（`UpdateChannelHost` 回调签名 +1 布尔，§8）。**控制器分派见 DD-7**：hub 不变（`onAckTimeoutFired → declareHubResync('ack-timeout')` 既有 wire 声明）；peer 在 `abortedTransfer === true` 时经 `declareLocalResync('ack-timeout')` 单漏斗补发 wire RESYNC_REQUIRED（接收端 doomed assembly 经 DD-4 挂点 1 清除），`false` 时保持 PN6b 本地边沿（零 wire、v1 逐字节）。后果：载体保留、恢复 round（该 round 为 PN6b/漏斗既有恢复语义本就要发起的，**非新增轮次**）结算后 `resetForLive` → drain 先窥队首 chunkable → 以**新 transferId** 从 offset 0 重新初始化 transfer——落点是已被对端清理的干净 assembly。「接收端已清」在本版由「**发送端两角色均在弃置时刻发 wire 声明**」结构性成立（hub 既有 `:817-818` / peer F6 新增），不再是方向性错觉。原设计把本路径列入「transfer 项随 discardQueued 消失」是事实错误（abandonInFlight 不调用 discardQueued），前版已修正；本版进一步修正其接收端断言的方向性错误（F6）。
   - **末 chunk 结算清除**（正常路径，.6）。
   - **needsResync ⇒ 无 activeTransfer**：全部置位路径均经由上述清除点（1-6、8、9 经 discardQueued；abandonInFlight 显式）——`resetForLive` 恢复后 `pullAndSendOne` 只见空队列或无 transfer 的队首，**僵尸续传结构性不可达**（SA2 F2 后果链闭环）。
   - 末 chunk 已出站后的中止 = inFlight 条目走既有 zombie/teardown 簿记（ADR「末 chunk 序入 zombie 簿记」）。详尽矩阵（含 shed 时槽释放账）归 #244。
8. **周期 reconcile 延后判据**（`peer-namespace.ts:929`）：`inFlightCount > 0` 延后条件扩为 `effectiveInFlightCount() > 0`（含 `activeTransfer` 在场）——避免 transfer 中途被周期 round 抢占后 SYNC_STEP2 携带同载荷造成冗余 round。hub 不发起 round，无对称面。（`maybeStartRecovery` 的 §9.4 守卫 `peer-namespace.ts:919` 无需改：needsResync 置位后 activeTransfer 必已清除，两口径同义。）注意该延后只覆盖 peer 自身上行 transfer；hub→peer 下行 transfer 与 peer 周期 round 的交叠是既有常态（hub 收 STEP1 不迁出 live，§2 锚点），由 DD-4 的「busy assembly 跨 round 存活 + 后续 chunk 无状态门」承接，不需要也不得为此改 round 语义。**本判据同时是 F6 闭合的安全前提之一**（peer 决不会在自身 transfer 在场时发起 round ⇒ 对端收到 STEP1 不构成 transfer 存活信号——见 DD-7 备选 B(iv) 否决理由）。

**备选与否决理由**：

- *deliver 时刻急切切片*——否决：违反 ADR「出队时刻惰性进行；队列持完整 update」；且直发窗口判断会绕过 RR 公平性。
- *transfer 开始即 shift 入旁路槽*（`activeTransfer` 持项）——否决：`queuedCount()===0` 使 wheel 摘轮（`backpressure.ts:218-221`）→ drain 不再访问该 ns → **transfer 停摆**；且需重建记账/总压/丢弃三套路径。
- *每 chunk 注册 inFlight*——否决：违反「整笔 1 槽」；且中间序 ACK 会被误判 violation。
- *transfer 期间同 ns 排队小项插队发送*——否决（作为机制）：严格 FIFO 已满足公平性与 CRDT 安全；插队是「可」非「须」，直发路径的穿插已自然存在。
- *abandonInFlight 改为连带 discardQueued*——否决：改变 v1 冻结队列跨 ack-timeout 保留的既有语义（未协商连接亦受影响），违反逐字节等价纪律。

### DD-4 接收端 detached assembly（新模块 `update-transfer.ts`，D1 裁定主承载；F3 修订，F7 挂点钉死）

**新文件** `packages/ws-replication/src/update-transfer.ts`：`UpdateChunkAssembler`（每 ns 控制器一个实例 = 单入站方向）+ 纯函数切片几何助手（与 DD-3 共享 chunkCount/边界计算，单一事实源）。纯易失状态，作用域 = (连接, 方向, namespaceId, transferId)（ADR 接收端规则）。

**首 chunk（idle ∧ chunkIndex===0）校验序——全部先于分配（D1）**：

| # | 校验 | 违例码 |
|---|---|---|
| 0 | codec 单帧自洽（transferId≥1、chunkCount≥1、chunkIndex<chunkCount、bytes 非空 ≤ totalBytes）——slice 1 已在 decode 强制 | MALFORMED_FRAME（连接级，既有） |
| 1 | busy ∧ transferId 不同，或 busy ∧ 同 id 重复首 chunk | `UPDATE_TRANSFER_VIOLATION` |
| 2 | `bytes.byteLength ≤ maxUpdateBytes`（连接 decode 不传 FieldLimits，须手工判——对齐 `namespaceFieldViolation` 先例） | `UPDATE_TRANSFER_VIOLATION` |
| 3 | `totalBytes ≥ 1` | `UPDATE_TRANSFER_VIOLATION` |
| 4 | **`totalBytes ≤ maxChunkedUpdateBytes`** | `UPDATE_TRANSFER_TOO_LARGE` |
| 5 | **`totalBytes ≤ chunkCount × maxUpdateBytes`**（几何一致；乘积上界 ≤ 4MiB 量级，Number 安全） | `UPDATE_TRANSFER_VIOLATION` |
| 6 | 通过后 `new Uint8Array(totalBytes)` **一次性分配** detached buffer，拷贝 chunk 0 | — |

（不校验 `totalBytes > maxUpdateBytes`：limit 是端点配置不保证对称，超限前提是发送端规则——见 §13 风险 R6；SA6 P3 合法单 chunk 注入与该选择相容，SA2 §5 复核同意。）

**后续 chunk（assembly busy）**：`transferId` 一致 ∧ `totalBytes/chunkCount` 与声明逐字节一致 ∧ `chunkIndex === 已收数量`（严格递增）∧ `bytes ≤ maxUpdateBytes` ∧ `offset + len ≤ totalBytes` → 追加拷贝；任一不符 → `UPDATE_TRANSFER_VIOLATION`。**busy 路径不做 ns 状态门**（仅 quiet 静默前置）——round 期间在途 straggler chunk 必须能落入存活 assembly（hub 收 STEP1 不迁出 live、下行 transfer 与 peer 周期 round 并行是常态，§2/§7-DD-3.8）；WS 有序可靠使错序/丢失结构性不可达，出现即对端 bug ⇒ 响亮 violation（ADR 拒绝理由 3）。

**idle ∧ chunkIndex>0（残渣形态，F3 显式定义）**——按到达时刻 ns 控制器状态判别：

| ns 状态 | 行为 | 理由 |
|---|---|---|
| quiet（closing/终态/disconnected） | **静默丢弃**，零副作用 | 镜像 onUpdate/onHubUpdate 首行既有纪律 |
| `needs-resync` \| `reconciling` | **良性丢弃（残渣语义）**：不进 ERROR、不 failed、不创建 assembly、不改变任何状态 | 本端 resync 边沿已清除 assembly（下表）；发送侧弃置要经一个单向传播期（RESYNC 在途），多 chunk transfer 中途的 resync 边沿**必然**产生残渣——这是合法协议事件，属「resync 丢弃语义」的正常恢复路径，非违例。方向序论证：残渣 chunk 与 round 响应帧同向有序（残渣先于 STEP1/STEP2 出站），故残渣必然先于 round 结算到达，全部落入本行或 busy 行，**不会漏进 live** |
| `live` | **保留 fail-loud `UPDATE_TRANSFER_VIOLATION`**（ns 级 ERROR + failed） | 本版闭合论证（R3）之后，该形态回到**协议内不可达**——发送端全部弃置路径（含 peer ack-timeout 子路径，DD-7）必发 RESYNC/CLOSE/ERROR 或杀连接，且残渣经同向序先于结算到达非 live 态——保留响亮判定为防御深度（R3 闭合论证的镜像面：R3 管「新 transferId 撞 stale assembly」，本行管「残渣 chunk 撞空 assembly」） |

**收齐**（`已收数量 === chunkCount`）：`Σbytes === totalBytes` 精确核对（不符 → VIOLATION）→ 交控制器：

- 状态接纳门镜像 onUpdate/onHubUpdate（`live | needs-resync | reconciling∧wasLive`；违例 → `NAMESPACE_STATE_VIOLATION` + failed；quiet 静默）——在**首 chunk**时刻判定（busy 后续 chunk 不再复查状态，见上）；
- hub 侧在 apply 前补 **submitPermission 门**（镜像 `hub-namespace.ts:616-621`；缺 → `NAMESPACE_UNAUTHORIZED` + failed）；
- `applyRemoteUpdate(assembled, 末chunk帧序)`（isStep2=false）——**恰一次** Runtime sequencer trusted apply + dirty notification + `UPDATE_ACK{ackedSequence=末chunk帧序}` + `update-applied` observer 事件（bytes=totalBytes、sequence=末 chunk 序，SA2 N2 裁定接受 R7 推广），全部经既有管线（`peer-namespace.ts:1087-1200` / `hub-namespace.ts:899-993`）；hub fan-out 经 session owned-update 广播 + applyOrigin 回声抑制（`replication-session.ts:281`）自动到达其他 Peer、不回送来源（B7，零新机制）。
- **重组失败一律先于 apply：live Y.Doc 零写入**（全部校验在 apply 之前）——AC3。

**违例动作**：namespace 级 ERROR 帧（code 经 `sendNsError`/`namespaceErrorFrame`）+ `finalize('failed', ...)`——镜像 `onFieldViolation` 先例（`hub-namespace.ts:593-597`）。两码注册语义（slice 1 冻结）：VIOLATION = fatal/retryable no/terminal failed；TOO_LARGE = fatal/retryable config/terminal failed（对齐 `SYNC_DIFF_TOO_LARGE` 族）。分类完备化（边沿几何、恶意申报细分）归 #244。

**assembly 清理挂点（接收侧，纯易失零持久化；F3 恢复结算边 + F7 发射点全集钉死）**：

| 挂点 | 理由 | 锚点 |
|---|---|---|
| `onResyncReceived`（对端声明收帧） | ADR 0013:58「收到 RESYNC_REQUIRED ⇒ 全部丢弃」字面；对端发送侧已随其 resync 边弃置在途 transfer——**F6 后两方向对称成立**（hub 声明既有；peer 声明在 ack-timeout∧中止 transfer / session 边沿 / 溢出 / 拒绝 / shed 各面） | peer :561-567 / hub :661-666 |
| **本端 wire 声明发射点（漏斗内、记忆化门后；F7 钉死）**：清本端双方向全部 inbound assembly + 置 `resyncEpisode`。**挂点语义 = 「本端任何 wire RESYNC_REQUIRED 发射点」**，非任何具名方法——收敛后全集 = {peer `declareLocalResync` 单漏斗（F7 收敛后调用点：queue-overflow/send-failed [channel host :225]、connection-shed [facet :162-169]、session 边沿 [onWatchdogEdge 收敛，DD-8]、**ack-timeout ∧ 中止 transfer [F6 新增，DD-7]**）；hub `declareHubResync` 单漏斗（调用点 :749/:785-792/:817-818，本就单漏斗零改动）} | 本端 RESYNC_REQUIRED 送达对端后，对端 `markResyncReceived` 弃置其出向队列（含在途 transfer 项）⇒ 本端 inbound assembly 必然残缺；同理本端自身的恢复重传也必须从干净 assembly 开始。**静态核验判据：`kind:'RESYNC_REQUIRED'` 的 sendChecked 发射点全集 == 挂点全集**（§12 F7 行）——新增发射点（未来）必须落漏斗内 | peer :939-960（:962-981 内联收敛入漏斗，DD-8）/ hub :796-815 |
| **恢复 round 结算边（F3）**：`resyncEpisode` 标记（**置位 = 上两行**：onResyncReceived 收帧点 :561/:661 + 漏斗发射点；`onRoundSettled` 回 live 分支清除），结算回 live 时若标记为真 → **清除本 ns 双方向全部 assembly** 并清标记 | needs-resync 期间经镜像门接纳的**注定夭折**首 chunk（发送端将在 RESYNC 送达后弃置该 transfer）会创建注定 stale 的 assembly；不清理则恢复后新 transferId 到达时撞 busy-冲突 → 校验 1 误判 VIOLATION → 合法拥塞路径升级为 ns 终局 failed（SA2 F2+F3 复合类的另一扇门）。安全性论证：**周期 round 不置标记、结算不清除**（hub→peer 下行 transfer 与 peer 周期 round 并行时 assembly 必须跨 round 存活——§2「hub 收 STEP1 不迁出 live」锚点）；合法新 transfer 的首 chunk 经方向序论证（round 末帧同向先于任何恢复后数据帧）必然在结算**之后**到达 live，不会被误清 | 置位：peer :561/:939、hub :661/:796；清除：peer `onRoundSettled` :881-904（`pendingResync → 再开 round` 分支保持标记，直到真正回 live）、hub :1045-1056 |
| 终态/静默单点（`finalize` + `quiesceConnection`/`quiesceSync`） | 连接拆除、GOAWAY drain、CLOSE、epoch fence/conflicted、failed | hub :691-700 / peer quiesce 族 |
| **不挂 `resetForLive` 的周期面** | 周期 round 期间（hub 侧下行）transfer 合法进行、assembly 必须存活续收——「清除」仅由恢复结算边（标记门控）承担，与周期结算显式区分 | `update-channel.ts:327-330`；`round.wasLive`（round-engine.ts:79） |

slice 2 无 assembly 超时（`assemblyTimeoutMs` + 进度滑动 deadline + `RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED}` 归 #244）；**F6 闭合后**，无信号中途停摆的残留仅剩「发送侧真停摆（bug/世界暂停）」族——见 §13 R2。

**备选与否决理由**：*BEGIN/CHUNK/COMMIT、逐 chunk ACK、struct 级拆分、带外通道*——ADR 已拒绝；*按申报 totalBytes 延迟校验上界*——违反 D1 有界分配不变量；*每 (ns,方向) 多 assembly 并发*——发送端 FIFO 使并发 >1 无价值（ADR），且 slot/窗口语义会复杂化；*把首 chunk 状态门收窄为仅 live*——否决：hub 收 STEP1 不迁出 live，跨周期 round 的合法首 chunk 常态到达于 `reconciling∧wasLive`，收窄将使合法 transfer 陷入 ack-timeout 重试循环；镜像门 + 恢复结算清理边以更小代价闭合同一风险；*每次 onRoundSettled 无条件清 assembly*——否决：误杀周期 round 并行中的合法下行 transfer（见上表安全论证）。

### DD-5 连接层分发与 drain 门

- `peer-connection.ts:525-530` 占位替换：`withController(nsId, c => c.onHubUpdateChunk({...message, sequence}))`；peer draining 允许名单（:391-397）不含 UPDATE_CHUNK → drain 期自动静默丢弃，零改动。
- `hub-connection.ts:790-795` 占位替换：`withChannel(nsId, c => c.onUpdateChunk({...message, sequence}))`；**hub `drainActive` 丢弃名单（:718-732）显式追加 `'UPDATE_CHUNK'`**——chunk 帧是会启动新协议工作的 namespace 帧，reauth drain 窗口不得进入 channel（协议 §6.3 drain 语义，防 P3 类注入在 drain 期开新工作）。
- 未协商：decode 门控在 payload 前抛 `UNSUPPORTED_MESSAGE_TYPE` → 既有 onMessage catch → connectionFatal(1002)——占位分支保留为防误分发兜底（协商位透传正确时构造性不可达，与 slice 1 注释语义一致）。

### DD-6 Hub fan-out

零新机制（见 DD-4）。混编部署提示（SA2 N5，非缺陷）：hub 对已协商 peer 的分块增量 apply 后经 session fan-out 广播，未协商 peer 将以单帧 UPDATE 收到同一载荷 → 触发其 v1 超限路径（丢弃 + needs-resync + round）——ADR 互通矩阵的自然后果，部署建议（对称配置或全量升级后启用旋钮）归 #246 文档化。

### DD-7 ack-timeout 无信号弃置的接收端闭合（F6 = SA8 r2 O5，路径 B）

**问题回顾（SA2 §7-F6 / SA8 r2 §3 攻击链，源码全部实读）**：peer→hub 协商 transfer T1 进行中（chunk 0..k 已出站、末 chunk 未出站）、混合窗口下更早直发帧 F1 在途；F1 的 ACK 逾期 `ackTimeoutMs` → `armAckTimer` 触发 → `abandonInFlight`（zombie + needsResync + `onAckTimeout()`）→ peer `onAckTimeoutFired`（**PN6b：零 wire 帧、不经 declareLocalResync**，:906-915）→ 本地恢复 round（STEP1/STEP2/APPLIED；hub `onSyncStep1` 不迁出 live :560-567，hub 全程 live 且 `resyncEpisode` 未置位——既未 declare 也未收 RESYNC）→ peer 结算回 live → `resetForLive` → drain 先窥 chunkable 载体 → 新 transferId T2 首 chunk 到达 hub → **hub 侧 T1 busy assembly 无任何清理边命中** → 撞校验 1（busy ∧ transferId 不同）→ `UPDATE_TRANSFER_VIOLATION` → **hub ns 终局 failed**。触发条件为合法拥塞路径（中间 chunk 仅入 assembly 不解堵 ACK 队列；Runtime sequencer 拥塞延迟 hub apply 而 encodeDiff 读路径仍响应即可命中）——窄但无需任何 bug 或恶意。

**决策（路径 B，弃置时刻声明）**：

1. **通道信号（DD-3.7 已并入）**：`abandonInFlight()` 入口捕获 `abortedTransfer = (activeTransfer !== undefined)`，显式清除后经 `host.onAckTimeout(abortedTransfer)` 上抛。
2. **peer 分派**：`onAckTimeoutFired(abortedTransfer)`（:906-915 修订）——`abortedTransfer === true` 时调用 `declareLocalResync('ack-timeout')`（单漏斗：发 wire `RESYNC_REQUIRED{send-queue-overflow}` [既有 reason，零新词表] + `setState('needs-resync')` + `emitResyncRequired('ack-timeout')` + `maybeStartRecovery()`）并返回；`false` 时保持 PN6b 原体（clearTimer + setState + `emitResyncRequired('ack-timeout')` + deferTask(maybeStartRecovery)）——**v1 逐字节**。
3. **hub 不变**：`onAckTimeoutFired → declareHubResync('ack-timeout')` 既有（:817-818，含 wire 帧）——本决策使 peer 的 chunked 子路径与 hub 行为**对称**（ADR 0013:54「ACK timeout ⇒ … needs-resync 同构处置」：hub 的「同构处置」= 漏斗声明；peer 在 transfer 在场时取同一读法）。
4. **闭合机制（零新增接收端语义）**：hub 收 peer RESYNC_REQUIRED → `onResyncReceived`（:661-666）→ `markResyncReceived` + `setState('needs-resync')` + **DD-4 挂点 1：清 hub inbound（peer→hub）assembly + 置 `resyncEpisode`**。同向 FIFO 保证残渣 T1 chunk（弃置前已出站）先于 RESYNC_REQUIRED 到达并入 busy assembly，RESYNC 到达即整体清除；RESYNC 之后到达的任何 T1 残渣落残渣表 `needs-resync` 行（良性）。peer 侧自身 inbound assembly 同步经挂点 2 清理（漏斗内）。peer 的 RESYNC 帧先于其 STEP1 发出（漏斗内 sendChecked 先于 `maybeStartRecovery → startRound`）——hub 先置 needs-resync 再收 STEP1，round 正常推进（`onSyncStep1` 非 quiet 门通过），双端于 `onRoundSettled` 回 live；此后 drain 重传的 T2 首 chunk 落干净 assembly——**窗口闭合**。
5. **可达性门（AC6 结构保证）**：`abortedTransfer === true` ⟹ activeTransfer 在场 ⟹ 存在 chunkable 载体 ⟹ 已协商连接。未协商连接该分支结构性不可达，PN6b 原体覆盖全部未协商 ack-timeout——零新 wire 帧，逐字节一致。协商连接上无 transfer 的 ack-timeout（纯直发帧超时）同样走 PN6b 原体——新帧仅出现在「协商 ∧ transfer 中止」这一子路径。
6. **记忆化不吞声明（不变量）**：`abortedTransfer === true` ⟹ 本端无先行声明——`resyncDeclared === true` ⟹ 本端已在恢复周期（置位后仅 `onRoundSettled` 回 live 清零，peer :901 / hub :1053）⟹ needsResync 已置 ⟹（F2 不变量 needsResync ⇒ 无 activeTransfer）⟹ 后续 abandonInFlight 不可能见到 activeTransfer。故该子路径上漏斗必真实发射，且 `emitResyncRequired('ack-timeout')` 的 observer 事件恰一次发射（与 PN6b 分支互斥、cause 字符串相同——observer 面零漂移）。hub 侧同理（其 ack-timeout 声明被记忆化吞掉的形态 ⟺ 无 transfer ⟺ 无 assembly 可滞留）。
7. **时序论证（timer 栈内发 wire + 同步 round 发起）**：漏斗的 `sendChecked` 与 `maybeStartRecovery → startRound` 在 ack-timer 回调栈内同步执行——两者均为既有模式（hub 已在 ack-timer 栈内发 RESYNC :817-818；peer `onTimerFired('periodic-reconcile') → startPeriodicReconcile → startRound` 同步发起 round，:1575-1579 + :927-937）。与 PN6b 原体的 `deferTask(maybeStartRecovery)` 差异仅为进程内调度次序，wire 序不变（RESYNC 先于 STEP1 两种调度下均成立）。实现轮以既有 watchdog/recovery 套件回归该面（§12）。
8. **wire/文档面**：帧型 = 既有 `RESYNC_REQUIRED`、reasonCode = 既有 `send-queue-overflow`（hub 全部 cause 共用该 reason 的既有先例，精确 cause 走 observer）——**零 wire 格式变化、零词表新增**；协议 §9.4 发射点登记（「既有发射点：hub-namespace / peer-namespace 溢出声明」）追加本发射点，归 #246 追认（W2 边界内，append-only 合规——发射点不是新 reason）。

**备选与否决理由**：

- *路径 A（登记式更正 + R2 族登记 + #244 收口）*——否决：留一扇合法拥塞路径使 hub ns 终局 failed（`UPDATE_TRANSFER_VIOLATION` = fatal/retryable no——不可重试恢复），与 CONTEXT「分块复制传输：中断即丢弃并回退 state_vector reconciliation」词条的恢复语义构成未管理偏离（SA8 r2 §3 条款：维持现文即升级冲突）；且 #244 的 `assemblyTimeoutMs` 是**时序性**收口——T2 首 chunk 通常先于任何装配超时到达，不能确定性防撞。dispatch 明确要求 resolve 行为而非登记。
- *B(i)：校验 1 的 busy∧异 transferId 首形态按 ns 状态判别（镜像残渣表）*——**单独否决（SA2 N7）**：F6 场景 hub 在重传首 chunk 到达时处于 **live**（hub 收 STEP1 不迁出 live、resyncEpisode 未置位、未收任何声明）——状态判别落 live 行仍 fail-loud；若为闭合而把 live 行改判良性，等于把「协议内不可达防御」降级为吞错，弱化 A9 攻击面且与残渣表设计冲突。
- *B(iii)：无信号中止时直接弃置 chunked 载体*——否决：仅消除「同笔重传」这一种到达形态；hub 侧 stale busy assembly 仍无任何清理边（hub 未收信号、未离 live、标记未置）——下一次**任意**新 chunked 写的首 chunk 仍撞校验 1 → ns 终局 failed，窗口未闭合仅被推迟；且弃置载体使该笔数据退回下一轮 reconciliation 修复（等价 R1 刻画路径），传输能力退化。
- *B(ii′)：重传前（而非弃置时刻）声明*——否决：peer 结算回 live 后再声明将触发 live → needs-resync → reconciling → live 的**第二轮** recovery round（弃置时刻声明搭乘 PN6b/漏斗既有恢复 round，零新增轮次）；需载体级「静默中止」标记跨 round 存活；接收端 stale assembly 暴露窗口延长至 round 结算之后。弃置时刻声明严格占优。
- *B(iv)：接收端在收 STEP1 且 busy 时清自身 assembly（零 wire delta 方案）*——否决：为 ADR 0013:58 接收端弃置触发清单之外的静默扩展（新增触发面类别与 F3 恢复结算边同级但无声明信号佐证）；机制方向不对称（round 恒由 peer 发起，仅 hub 侧可挂，peer 接收端无对偶锚点）；assembly 生命周期与 round 事件耦合（F3 设计显式避免，且安全性依赖 DD-3.8 延后判据的传递论证：peer 决不在自身 transfer 在场时发起 round）；清理时点（round 开始）晚于本决策（弃置时刻），doomed assembly 暴露窗口更长。登记为已考虑备选。

### DD-8 声明发射点全集闭合与漏斗收敛（F7）

**问题回顾（SA2 §7-F7 / §13-F7）**：接收端清理挂点 2/3（本端声明边）的 peer 侧锚点只列 `declareLocalResync :939-960`，而 peer 实有**两处** wire 声明发射点——`onWatchdogEdge` 内联自持声明（:962-981，PN5②）不经漏斗。按锚点实现则 session-fanout-overflow 声明（合法降级路径）发 wire RESYNC 却不清本端 inbound assembly/不置 `resyncEpisode` → 恢复后对端（hub）新 transferId 首 chunk 撞 peer 侧 stale busy assembly → 校验 1 → **peer ns 终局 failed**（与 F6 同伤害类，另一扇门）。

**决策**：

1. **挂点语义钉死**（DD-4 挂点表行 2/3 已改写）：「本端声明边」= **本端任何 wire RESYNC_REQUIRED 发射点**。**静态核验判据：`kind:'RESYNC_REQUIRED'` 的 sendChecked 调用点全集 == 挂点全集**——实现轮可 grep 核验（§12 F7 行）；未来任何新发射点必须落漏斗内（结构性纪律，非约定）。
2. **peer 内联声明收敛入漏斗**：`onWatchdogEdge`（:962-981）的声明段替换为 `this.declareLocalResync('session-fanout-overflow')`；`markSessionResyncEdge()` 保持在其前无条件执行（幂等：`markResyncReceived` 置 needsResync + discardQueued，重复调用零漂移）。**零行为变化声明**（SA2 F7 备选接受条件）：收敛前后指令序逐行等价——记忆化门（`if (resyncDeclared) return`，含其前的 `markSessionResyncEdge` 位置不变）→ `clearTimer('periodic-reconcile')` → `resyncDeclared = true` → `sendChecked({kind:'RESYNC_REQUIRED', reasonCode:'send-queue-overflow'})`（同帧同 reason）→ `setState('needs-resync')` → `emitResyncRequired('session-fanout-overflow')`（cause 联合类型已含该值，:944）→ `maybeStartRecovery()`。quiet/`disconnected` 前置门（:967）与 fence 分派（:741-745 hub 侧对应）不动。
3. **收敛后发射点全集 = 两漏斗**：peer `declareLocalResync`（:939-960）+ hub `declareHubResync`（:796-815，本就单漏斗，调用点 :749/:785-792/:817-818 零改动）。挂点 2/3 的实现（清本端双方向 assembly + 置 `resyncEpisode`）落在两漏斗内、**记忆化门之后**（声明真实发射才置位/清理；被记忆化吞掉的重复声明不重复置位——该恢复周期内首次发射已置位，结算边消费）。quiet 态漏斗早退（hub :805）不发射即不置位——quiet 态由终态/静默单点收口。
4. **与 F6 的复合**：F6 新增的 peer ack-timeout 声明走既有 `declareLocalResync` 漏斗——不新增发射点，静态判据不被 F6 破坏；该子路径的本端 inbound assembly 清理与 `resyncEpisode` 置位由漏斗内挂点自动覆盖。

**备选与否决理由**：*仅枚举两处 peer 发射点为挂点、不做收敛*——否决：挂点实现 ×2 是新的漂移面（正是 F7 的成因而型：清单与代码发射点再脱节即重开同一窗口）；收敛是零行为变化的纯结构改动，锚点唯一、判据可静态核验。*把清理挂点改为轮询/对账式（每 round 结算核对 assembly 与队列一致性）*——否决：引入第二事实源与对账复杂度，且周期 round 结算面被 F3 显式排除（误杀并行下行 transfer）。

## 8. 接口、状态机与数据流

### 接口变化（全部 additive；onAckTimeout 为签名扩展）

| 接口 | 变化 |
|---|---|
| `ReplicationLimits` / `ResolvedLimits`（types.ts:23） | + `maxChunkedUpdateBytes: number`（缺省 4 MiB） |
| `PeerReplicationOptions`（types.ts:162） | + `chunkedUpdate?: boolean`（缺省 false） |
| `UpdateChannelHost`（update-channel.ts:21） | + `sendUpdateChunkFrame(chunk): number`；+ `chunkedSendEnabled(): boolean`；**`onAckTimeout` 签名扩展为 `(abortedTransfer: boolean) => void`**（F6——`abandonInFlight` 于显式清除前捕获；两实现均需适配，§10） |
| `PeerNamespaceHost` / `HubChannelHost` | + `sendUpdateChunk(nsId, chunk): number`（连接层 tryEmitData 包装）；+ `chunkedUpdateNegotiated(): boolean` |
| `PeerNamespaceController` / `HubNamespaceChannel` | + `onHubUpdateChunk(msg)` / `onUpdateChunk(msg)`（msg 含 envelope sequence；实现 DD-4 残渣判别 + resyncEpisode 标记） |
| `decodeInbound`（frame-io.ts:60） | options + `selectedCapabilities?: number`（直传 codec） |
| `UpdateChannel` | + `activeTransfer`/`nextTransferId` 私有状态；+ **包内只读访问器 `effectiveInFlightCount()`**（deliver 直发前置 / pullAndSendOne 初始化前置 / peer-namespace 延后判据消费；**不经 `src/index.ts` 导出——包公开 API 面不变**）；+ 私有 `clearActiveTransfer()` 单点；`abandonInFlight()` + 中止信号捕获与上抛（F6） |
| peer `onHelloAck` 消息类型 / hub `onHello` 消息类型 | + `selectedCapabilities: number` / + `optionalCapabilities: number`（F5 捕获与交集单点） |
| 新模块 `update-transfer.ts` | `UpdateChunkAssembler`（内部，不经 index.ts 导出）+ 切片几何纯函数 |
| index.ts | 仅当类型导出需要时补（`ReplicationLimits` 等已导出；无新公开类） |
| plugin.ts | peer 插件配置 `chunkedUpdate` 透传 + **三封闭键集扩展（SA2 N1）**：`chunkedUpdate` 入 `PEER_CONFIG_KEYS`（:148）与 `PEER_OVERRIDE_KEYS`（:150）；`maxChunkedUpdateBytes` 入 `LIMIT_KEYS`（:151）——漏改则生产组合根下显式配置该 limit 启动期 `TypeError: invalid configuration`（assertRecord :157-162，调用点 :287-330） |

### 状态机

- **连接协商**：`(dial) negotiated=0 → HELLO(optional|=bit) → HELLO_ACK(selected) → negotiated = HELLO_ACK.selectedCapabilities（**逐字捕获 hub 侧交集结果**，F5）→ ready`；dialNow 重建回 0。hub：`handshaking → onHello(selected = selectCapabilities(required, optional, SUPPORTED).selected 单点计算) → ready`。
- **发送 transfer**（每 (ns,方向) 至多 1 个）：`idle → (出队窥得 chunkable 项 ∧ 有效占用 < max) slicing{transferId, offset} → (末 chunk 出站) settled→idle（inFlight 持末 chunk 序至 ACK/zombie；期间发射 update-sent{末chunk序,totalBytes}）`；**任意队列清空路径（含 deliver 溢出）→ aborted（单点 clearActiveTransfer）**；**ack-timeout → aborted + `abortedTransfer=true` 上抛（载体保留）**——peer：经漏斗发 wire RESYNC（F6）+ 既有恢复 round，结算后新 transferId 整笔重传；hub：既有 `declareHubResync('ack-timeout')`，对称；transferId 计数任何 resync/终态不复位、dialNow 重建归 1。
- **接收 assembly**：`idle → (首 chunk 过校验 1–6) assembling{buffer(totalBytes), receivedCount} → (收齐 ∧ Σ==totalBytes) → apply(恰一次) → idle`；校验失败 → `UPDATE_TRANSFER_VIOLATION/TOO_LARGE`（ns failed 终局）；**idle∧chunkIndex>0：quiet 静默 / needs-resync∧reconciling 良性丢弃 / live 响亮 VIOLATION（协议内不可达防御）**；清理挂点 = 对端声明收帧边 + **本端 wire 声明发射点全集（两漏斗内，F7）** + **恢复 round 结算边（resyncEpisode 标记门控，F3）** + 终态/静默单点（周期 round 结算不清除）。
- **本端 resync 声明**（F7 收敛后）：peer 单漏斗 `declareLocalResync`（调用点 = queue-overflow / send-failed / connection-shed / session 边沿[收敛] / ack-timeout∧中止 transfer[F6]）；hub 单漏斗 `declareHubResync`（session 边沿 / 溢出与发送失败 / ack-timeout）——记忆化 + 漏斗内挂点（清本端 assembly + 置 resyncEpisode）为唯一实现点。

### 数据流路线

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
|---|---|---|---|---|---|---|---|---|
| ① 协商 | peer 启动（knob on）/ hub onHello | HELLO.optional 位 / HELLO_ACK.selected 位（hub 单点交集） | peer 逐字捕获（F5） | wire 握手帧 | 双端 `negotiatedCapabilities` → decode 门 + 发送门 | NC0：帧上位、连接 ready | 身份/版本/required 失败走既有 fatal；dialNow 复位 0 | NC0、AC6 |
| ② 发送分块 | 业务写 → lease sequencer → session owned-update → `onOwnedUpdate` → `channel.deliver`（chunkable 超限项入队；不可分块超限项 v1 直发判定） | 队列项（完整 update，`queuedByteCount` 记账） | RR drain 每次 `pullAndSendOne` 切一片（subarray 零拷贝视图）→ `encodeMessage` 成帧 | `tryEmitData` → `OutboundQueue.emit`（每帧独立 sequence、data 账本）→ transport | 对端连接；wire 捕获 | ≥2 帧 UPDATE_CHUNK、每帧 ≤ 上限、transferId/chunkCount/totalBytes 跨帧一致、chunkIndex 严格递增；穿插直发使 `effectiveInFlight ≤ max` 恒成立 | 出站拒绝/溢出/shed/对端声明/ack-timeout → 单点清 transfer（DD-3.7 九路径 + 显式路径）+ needs-resync + 声明（ack-timeout∧transfer：peer 补发 wire RESYNC，F6） | P1、AC2/AC4/AC8、F1/F2/F4/F6 负控 |
| ③ 接收重组 | 对端 UPDATE_CHUNK 入站 → decode（selectedCapabilities 门）→ dispatch → `onUpdateChunk` | detached `Uint8Array(totalBytes)`（校验后一次性分配） | 逐 chunk 追加拷贝（busy 无状态门）；残渣按 ns 状态判别（F3）；收齐 Σ 核对 | 内存（纯易失） | `applyRemoteUpdate(assembled, 末chunk序)` | 恰一次 sequenced apply + dirty（saveDoc +1）+ 单 UPDATE_ACK；hub fan-out 至其他 Peer | 违例 → ns ERROR + failed（apply 前零写入）；清理挂点表（发射点全集 + onResyncReceived + 恢复结算边 + 终态） | P2/P3、AC1/AC3/AC5、F3/F6/F7 负控 |
| ④ ACK 结算 | 接收端 UPDATE_ACK | 发送端 `inFlight` 条目（末 chunk 序，bytes=totalBytes） | `onAck` ok/zombie/violation 既有三分支 | wire UPDATE_ACK | `update-acked` observer 恰一次（bytes=totalBytes、sequence=末 chunk 序） | 窗口槽释放、队列续排 | 迟到良性；abandon → zombie（载体保留，恢复后新 transferId 重传）；未知序 → ACK_STATE_VIOLATION | P2、AC5 |
| ⑤ ack-timeout 弃置-恢复（F6 新增面） | 混合窗口在途直发帧 ACK 逾期 → `abandonInFlight(abortedTransfer=true)` | peer：漏斗内 wire RESYNC_REQUIRED 出站；本端 assembly/resyncEpisode 漏斗内清理置位 | 声明帧先于恢复 round STEP1（同向 FIFO）；hub `onResyncReceived` 清 doomed assembly | wire RESYNC_REQUIRED → transport | hub 挂点 1 清理 + needs-resync；双端 onRoundSettled 回 live | 恢复 round 收敛后新 transferId 整笔收齐、对端 ns 不 failed | 声明发送失败 → 本端 ns failed（连接大概率已死，对端 quiesce 清 assembly，无 stale 窗口） | §12 F6 双向行 + 未协商负控 |

跨边界说明：②→③ 跨进程 wire（每帧独立 envelope sequence，帧序即流序；残渣与 round 帧同向有序 → 残渣先于结算到达）；⑤ 内 RESYNC 帧与 chunk/STEP 帧同连接同向 FIFO（声明先于 round 帧、残渣 chunk 先于声明到达对端）。③ 内 apply 进入 Runtime 唯一 write sequencer（槽语义与既有 UPDATE 完全同构）；③→hub 其他 Peer 跨 session fan-out（applyOrigin 回声抑制，最终一致）。缓存/事实源：assembly 为内存瞬态，事实源 = live Y.Doc；无持久化新增（ADR「零 durable 残留」）。

## 9. 错误、恢复、并发与幂等

- **错误分类**：结构违例 → `UPDATE_TRANSFER_VIOLATION`（ns 级 fatal、terminal failed）；上界违例 → `UPDATE_TRANSFER_TOO_LARGE`（retryable config 族）；状态违例 → 既有 `NAMESPACE_STATE_VIOLATION`；ACK 关联违例 → 既有 `ACK_STATE_VIOLATION`（连接级）；未协商收 chunk → 既有 decode `UNSUPPORTED_MESSAGE_TYPE`（连接级 1002）。正常路径不变量缺失一律 fail loud，无静默 fallback（不可分块项走 v1 分支是**显式分派矩阵**，非静默降级；残渣良性丢弃是**显式定义的恢复语义**，其判据是 ns 状态而非吞错）。
- **恢复**：transfer 中止后与 v1 同构——needs-resync → 下一轮双向 reconciliation 修复（R1 刻画路径）。**ack-timeout 子路径（F6 闭合后，两方向对称）**：中止时 `abortedTransfer=true` → 发送端经漏斗发 wire RESYNC_REQUIRED（hub 既有 / peer 新增，仅协商连接可触达）→ 接收端收帧即清 doomed assembly 并随恢复 round 回 live → 发送端结算后以新 transferId 整笔重传，落点干净——「中断即丢弃并回退 state_vector reconciliation」（CONTEXT 词条）在两个方向均以 wire 信号落地；`abortedTransfer=false`（无 transfer）时 PN6b 本地边沿 + 冻结队列续排（v1 原体）。transferId 单调不复用（dialNow 重建归 1 = 新作用域）使恢复后新 transfer 无歧义；残渣 chunk 在 needs-resync/reconciling 良性丢弃，恢复 round 正常收敛（F3）。
- **并发**：每 (ns,方向) 至多 1 个在途 transfer（FIFO + 队首保持使第二超限项结构排在后）；连接级多 ns 并行 chunk 由 RR 互切丝（AC4）；同 ns 限内直发与 chunk 穿插受有效占用口径约束（F4），任意时刻 `inFlight.size ≤ maxInFlightUpdates`；无锁新增（单线程事件循环模型不变）。
- **幂等**：收方重复/错序 chunk = violation（fail loud，非幂等重试域）；apply 恰一次由「收齐才 apply」与 sequencer 槽语义共同保证；Yjs CRDT 幂等性仅作为 round+transfer 交叠时的收敛兜底（DD-3.8 已使周期 round 延后，消除常态交叠）。

## 10. 调用方影响矩阵

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| `UpdateChannelHost` 两实现（peer-namespace:221-239 / hub-namespace:183-192） | 无 chunk 回调；`onAckTimeout: () => this.onAckTimeoutFired()`（peer :230 / hub :192） | 实现 `sendUpdateChunkFrame`/`chunkedSendEnabled`；**`onAckTimeout: (abortedTransfer) => this.onAckTimeoutFired(abortedTransfer)`**（F6） | peer/hub-namespace.ts | §7 DD-3/DD-7 |
| peer `onAckTimeoutFired`（peer-namespace:906-915，PN6b） | setState + observer + deferTask（零 wire） | **分派（F6）**：`abortedTransfer=true` → `declareLocalResync('ack-timeout')` 漏斗（wire + 状态 + observer + 恢复）；`false` → PN6b 原体逐字节保持 | peer-namespace.ts | §7 DD-7（不变量：该子路径 `resyncDeclared` 结构性 false，声明不被记忆化吞） |
| peer `onWatchdogEdge`（peer-namespace:962-981，PN5②） | 内联自持声明（第二发射点） | **收敛（F7）**：声明段替换为 `declareLocalResync('session-fanout-overflow')`，`markSessionResyncEdge` 前置不动——零行为变化（指令序逐行等价，DD-8.2） | peer-namespace.ts | §7 DD-8 |
| 两漏斗 `declareLocalResync` / `declareHubResync`（peer :939-960 / hub :796-815） | 记忆化 + 发帧 + 状态 + observer + 恢复（peer 漏斗） | 漏斗内（记忆化门后）新增：清本端双方向 assembly + 置 `resyncEpisode`（DD-4 挂点 2/3 唯一实现点） | peer/hub-namespace.ts | §7 DD-4/DD-8 |
| `PeerNamespaceHost`/`HubChannelHost` 实现（peer-connection:103 区域 / hub-connection:470-494） | `sendData` 仅 UPDATE | + `sendUpdateChunk`（tryEmitData 包装）+ `chunkedUpdateNegotiated` | peer/hub-connection.ts | §7 DD-1/3 |
| `decodeInbound` 两调用点（peer:365 / hub:609） | 无 selectedCapabilities | 透传 negotiated | 两连接 onMessage | §7 DD-1 |
| peer `onHelloAck`（peer-connection:402-441） | 不读 capability | 身份校验后逐字捕获 `message.selectedCapabilities`（F5）；dialNow 复位 0 | peer-connection.ts | §7 DD-1.3 |
| hub `onHello`（hub-connection:633-711） | 不读 optional 位、selected 硬编码 0 | 参数补 `optionalCapabilities`；`selectCapabilities` 单点交集 → HELLO_ACK + 捕获 | hub-connection.ts | §7 DD-1.2 |
| `dispatchReady` 两 switch（peer:473 / hub:713） | UPDATE_CHUNK → connectionFatal 占位 | 转 `onHubUpdateChunk`/`onUpdateChunk`；hub drain 名单 +1 | 两连接 | §7 DD-5 |
| peer 周期 reconcile（peer-namespace:928-936） | `inFlightCount>0` 延后 | `effectiveInFlightCount()>0`（含 activeTransfer） | peer-namespace.ts | §7 DD-3.8 |
| peer/hub ns 控制器 round 结算（peer-namespace:881-904 / hub-namespace:1045-1056） | 无 assembly 概念 | `resyncEpisode` 标记置位/清除 + 恢复结算清 assembly（F3） | peer/hub-namespace.ts | §7 DD-4 |
| `resolveLimits`/`validateLimits` 调用链（createHub/createPeer） | 11 字段 | +1 字段形状校验 | defaults/validate/types | §7 DD-2 |
| plugin 装配（plugin.ts:287-330） | 键集封闭 | `chunkedUpdate` 入 PEER_CONFIG_KEYS/PEER_OVERRIDE_KEYS；`maxChunkedUpdateBytes` 入 LIMIT_KEYS（N1） | plugin.ts:147-153 | §7 DD-1/§8 |
| 公共 API 消费者（apps、测试 driver） | — | additive 可选字段，零破坏 | 无强制（api.test-d 可补正向类型断言） | types.ts/index.ts |

不隐藏未覆盖调用方：`frame-io.namespaceFieldViolation` 不扩（chunk 的字段判据在 assembler，分类为 ns 级 VIOLATION 而非 UPDATE_TOO_LARGE 连接前置——ADR 接收端规则字面）；`maybeStartRecovery` §9.4 守卫不改（needsResync 后两口径同义，§7 DD-3.8 注）；hub `onAckTimeoutFired` 不改（既有漏斗声明即 F6 目标形态）。

## 11. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
|---|---|---|
| `packages/ws-replication/src/update-channel.ts` | 发送 transfer 状态机（DD-3 全部：chunkable 直发收窄、effectiveInFlightCount、clearActiveTransfer 单点、结算/中止/重传）；**`abandonInFlight` 中止信号捕获与 `onAckTimeout(abortedTransfer)` 上抛（F6）** | 发送端缺口（F1/F2/F4/F6） |
| `packages/ws-replication/src/update-transfer.ts`（新） | Assembler + 切片几何纯函数 | 接收端缺口（DD-4，含残渣判别 API 形状） |
| `packages/ws-replication/src/peer-connection.ts` | HELLO optional 位、onHelloAck 逐字捕获 + dialNow 复位、negotiated 状态、decode 透传、dispatch 替换、host 回调 | DD-1（F5）/DD-3/DD-5 |
| `packages/ws-replication/src/hub-connection.ts` | onHello 参数 + selectCapabilities 单点交集、HELLO_ACK selected、negotiated、decode 透传、dispatch 替换 + drain 名单、host 回调 | DD-1（F5）/DD-3/DD-5 |
| `packages/ws-replication/src/peer-namespace.ts` | `onHubUpdateChunk`（残渣判别）、assembly 生命周期挂点（含 resyncEpisode 标记与恢复结算清除）、host 回调、周期 reconcile 延后有效口径；**F6：`onAckTimeoutFired(abortedTransfer)` 分派；F7：`onWatchdogEdge` 声明段收敛入 `declareLocalResync` + 漏斗内挂点** | DD-3/DD-4（F3）/DD-7（F6）/DD-8（F7） |
| `packages/ws-replication/src/hub-namespace.ts` | `onUpdateChunk`（含 submit 门 + 残渣判别）、assembly 生命周期挂点（含 resyncEpisode + **漏斗内挂点**）、host 回调（onAckTimeout 签名适配，行为不变） | DD-4（F3）/DD-8（F7） |
| `packages/ws-replication/src/frame-io.ts` | `decodeInbound` options 透传 | DD-1 |
| `packages/ws-replication/src/types.ts` | limits 字段、peer 选项、host 接口扩展（含 onAckTimeout 签名） | DD-1/DD-2/DD-7 |
| `packages/ws-replication/src/defaults.ts` | `maxChunkedUpdateBytes: 4 MiB` | DD-2 |
| `packages/ws-replication/src/validate.ts` | 形状校验 + peer 选项 boolean 门 | DD-2 |
| `packages/ws-replication/src/index.ts` | 类型导出补全（如有） | 公共面 |
| `packages/ws-replication/src/plugin.ts` | peer 插件配置 `chunkedUpdate` 透传 + 三封闭键集扩展（N1） | 生产组合根 |
| `packages/ws-replication/test/ws-replication-issue243-chunked-live.test.ts`（新，命名可由实现轮微调） | knob-on 绿灯镜像（不经 wire 代理）：P1/P2/P3 同构 + **P4-S** 发送端超上限回退 v1 同形 + **P4-R** 首 chunk 校验违例（超界申报注入）+ 中止清理（resync/teardown 丢弃 assembly）+ **F1 未协商混合队列负控**（队列已有项 + 窗口空位 + 超限写 → 零额外 RESYNC、排队项照发、`update-dropped{update-too-large}` 不变）+ **F2 queue-overflow 中途终止**（无续传 chunk、恢复后无僵尸、对端 ns 不 failed）+ **F3 残渣恢复**（transfer 中途注入对端 resync 边沿 → 残渣到达不 failed、round 收敛、新 transferId 正常收齐）+ **F4 窗口不变量**（maxInFlightUpdates=N + 穿插直发 → 任意时刻 inFlight.size ≤ N，含末 chunk 注册后 ACK 前）+ **F6 ack-timeout 中途终止（双向）**（peer→hub：peer 发恰一帧 RESYNC_REQUIRED → round 收敛 → 新 transferId 整笔收齐、hub ns 不 failed；hub→peer：hub 既有声明 → 对偶收敛、peer ns 不 failed；**未协商负控：ack-timeout 零 RESYNC_REQUIRED 帧**）+ **F7 session 边沿中的 inbound transfer**（hub→peer transfer 进行中注入 peer session 溢出边沿 → 声明经漏斗、本端 assembly 清除 + resyncEpisode 置位 → 恢复后 hub 新 transferId 首 chunk 正常收齐、peer ns 不 failed）+ **发射点静态核验**（源 grep `RESYNC_REQUIRED` sendChecked 发射点 == 两漏斗）+ knob-off 默认 + update-sent/acked/applied 三事件配对（N2）；方向敏感行显式标注被测方向（N11） | DD-2 回退、DD-3/DD-4/DD-7/DD-8 全部修订面验收（§12） |
| `packages/ws-replication/test/ws-replication-issue243-real-transport.test.ts`（新，命名可微调） | 真实 WS + MemoryPersistence 1 Hub + 2 Peers 镜像（AC7 第二 seam，含 fan-out 到第二 Peer） | AC7 |
| `packages/ws-replication/test/ws-replication-api.test-d.ts` | `chunkedUpdate`/`maxChunkedUpdateBytes` 正向类型断言（可选） | 类型面 |

既有红灯文件 `packages/ws-replication/test/ws-replication-issue243-ac-red.test.ts` **随实现转绿、零编辑**（协商上下文经 wire 代理，与旋钮形状解耦；peer 逐字捕获公式 [F5] 使代理置位后即被消费——SA6 §15 单点假设成立、P1/P2/P3 转绿可行；fixture `ackTimeoutMs=60s` 虚拟，与 F6 新增 wire 行为零交集）。

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/replication-protocol/**` | slice 1 冻结 codec/常量/错误码/门控 | 已交付且全绿；所需 API（CAP 位、selectCapabilities、DecodeOptions、两错误码）全部已导出；F6 零新帧型/零新 reason —— 无触达理由 |
| `packages/ws-replication/test/ws-replication-issue233-repro.test.ts` | 冻结刻画 R1/R2/R3 | AC6「不改刻画文件」；现状基线 |
| `packages/ws-replication/test/ws-replication-issue243-ac-red.test.ts` | 已批准红灯契约 | 断言面冻结；只能由实现转绿 |
| `docs/protocols/instance-replication-v1.md` | wire 权威文档 | §10.2/§10.3 修订与 §9.4 发射点登记（F6 追认）归 #246（SA8 W2）；混编部署建议随 #246（N5） |
| `docs/adr/0013-chunked-live-update-transfer.md` | 操作性决策 | 状态翻转归 #246（W1）；F1/F3 的面语义微调 + F6 新发射点经定向 SA8 复核追认，不改 ADR 文本 |
| `CONTEXT.md` | 词汇表 | 「分块复制传输/UPDATE_CHUNK/CAP_CHUNKED_UPDATE」词条已在（SA8 §1），无新词；F6 恰是该词条恢复语义的落地而非偏离 |
| `packages/ws-replication/src/backpressure.ts` | 连接级调度 | 设计红线：零新调度机制（DD-3 载体方案使其不需要；若实现发现需要，是设计偏离信号，须回 SA1） |
| `packages/ws-replication/src/round-engine.ts` | sync round 引擎 | round 语义零变化（resyncEpisode 标记在 ns 控制器，不动引擎；F6/F7 均不触达） |
| `packages/ws-replication/src/observer.ts` | observer 分发 | W4：零新事件类型（末 chunk update-sent 为既有类型发射，非新类型；F6 经漏斗的 emitResyncRequired 为既有事件 + 既有 cause） |
| `packages/namespace-runtime/**`、`packages/namespace-registry/**` | apply/sequencer/lease | 复用既有管线，零运行时改动（AGENTS 边界） |
| `apps/yjs-server/test/phase5-three-instance-acceptance-red.test.ts` | 真实 seam 备选 | 属于其自身 issue 的契约文件；本任务以新文件承载镜像（上文 ALLOW） |
| `wiki/raw/` 其他任务产物 | 评审/历史证据 | 只读输入 |

## 12. 验收与验证映射

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
|---|---|---|---|
| AC1 零 SYNC live 传输 + 单 ACK | P2 红（resync×1 + 双 round） | 红灯文件 P2（既有）+ knob-on 镜像 | 零 RESYNC/SYNC_* 帧；hub 收敛；saveDoc +1；单 ACK |
| AC2 帧上限 | P1 红（0 帧） | P1（既有） | 每 chunk 载荷 ≤ maxUpdateBytes、帧全长 ≤ maxFrameBytes |
| AC3 恰一次 apply、失败先于 apply | P3 红（1002 收口零写入） | P3（既有）+ 违例注入（新文件：错 chunkIndex/transferId 漂移/Σ 不符） | 合法 → 恰一次 apply+dirty+连接 ready；违例 → ns failed、Y.Doc 零写入、ERROR 帧先行 |
| AC4 RR 穿插不回归 | 既有 issue169 背压/公平 suite 绿（SA6 §4） | 双 ns 持续写 + 单 ns 大写（新文件）；全套背压/公平回归 | chunk 与他 ns 帧逐轮穿插、无饥饿；既有 suite 全绿 |
| AC5 ACK 锚 | P2/P3 断言面已冻结 | P2/P3（既有）+ 三事件配对断言（N2） | ackedSequence == 末 chunk 帧序；末 chunk 发射 update-sent{末chunk序,totalBytes} 与 update-acked/update-applied 配对；ackTimeoutMs 语义不变（计时锚措辞见 DD-3.6 校正） |
| AC6 未协商 v1 逐字节（全部组态） | NC2 + R1/R2/R3 绿（单写形态） | NC2（既有）+ **F1 未协商混合队列负控（新）**：队列已有项 A + 窗口空位 + 超限写 B；**F6 未协商 ack-timeout 负控（新）**：无 transfer（结构性）ack-timeout | 零额外 RESYNC_REQUIRED（B 走 F4 静默 + `update-dropped{update-too-large}`，A 存活照发）；ack-timeout 零 RESYNC_REQUIRED 帧（PN6b 原体）；R1/R2/R3/NC2 保持全绿 |
| AC7 双 seam | fake-duplex 红/绿（P1-P3） | 新真实 WS + MemoryPersistence 1 Hub + 2 Peers 镜像 | 收敛 + fan-out 至第二 Peer + 单 ACK |
| AC8 首 chunk 基础校验 | P1/P3 自洽断言 | P1/P3（既有）+ **P4-R** 超上限申报注入（totalBytes > maxChunkedUpdateBytes） | 一致性/递增/上界全判；超上限 → UPDATE_TRANSFER_TOO_LARGE、ns 级收口非连接级 |
| D1 有界分配 | — | P4-R 同场景 | 分配前拒绝、零大额分配 |
| D2 超上限回退 v1 | — | **P4-S**：协商连接 maxUpdateBytes < bytes 且 bytes > maxChunkedUpdateBytes | 零 chunk、丢弃 + needs-resync（deliver 直发时刻判定，与 v1 同刻同形） |
| D2 旋钮 | NC0（代理，不依赖旋钮） | knob-off：HELLO optional=0；knob-on：位在帧上 | 缺省 v1；显式开启才协商 |
| **F1 改道等价** | SA2 §7-F1 分析 | 未协商混合队列负控（AC6 行）+ 协商连接 P4-S | 两个时序窗均与 v1 同刻同形；分类词表零漂移 |
| **F2 第六清理路径** | — | transfer 中途并发写触发 queue-overflow（新文件） | 不再有 chunk 出站；needs-resync 恢复后无僵尸续传；对端 ns 不进 failed |
| **F3 残渣恢复** | — | 协商连接 transfer 中途注入对端 resync 边沿（新文件） | 残渣 chunk 到达后 ns 不 failed（needs-resync/reconciling 良性丢弃）；恢复 round 收敛；后续新 transferId 正常收齐；live 下注入 idle∧chunkIndex>0 仍 fail-loud（防御面） |
| **F4 窗口不变量** | — | maxInFlightUpdates=N + transfer 进行中并发限内直发穿插（新文件） | 任意时刻（含末 chunk 注册后、ACK 前）inFlight.size ≤ N |
| **F5 协商捕获** | NC0（代理置位）+ fixture 头注 | 冻结红灯文件 P1/P2/P3 实现轮零编辑转绿（既有路径）；knob-on 镜像断言 hub 交集 | peer.negotiated == HELLO_ACK.selectedCapabilities（逐字）；代理与旋钮双路均可建立协商 |
| **F6 ack-timeout 中途终止（双向，N11 方向标注）** | SA2 §7-F6 / SA8 r2 §3 攻击链（源码） | **peer→hub（新）**：协商连接 peer transfer 进行中（混合窗口在途直发帧）+ 延迟 hub ACK 至逾 ackTimeoutMs；**hub→peer（新）**：对偶构型；**未协商负控**见 AC6 行 | peer→hub：恰一帧 peer 侧 RESYNC_REQUIRED（新，仅协商连接）→ 恢复 round 收敛 → 新 transferId 整笔收齐 → **hub ns 不 failed**、零 UPDATE_TRANSFER_VIOLATION；hub→peer：hub 声明（既有 wire）→ 对偶收敛 → **peer ns 不 failed**；peer 侧 observer 仍恰一次 `resync-required{ack-timeout}`（漏斗 emit，cause 不变） |
| **F7 session 边沿中的 inbound transfer** | SA2 §7-F7（源码 :962-981） | hub→peer transfer 进行中（peer busy assembly）+ 注入 peer session 层溢出边沿（watchdog 非 fence 谓词）（新文件） | peer 发 RESYNC_REQUIRED（经漏斗）∧ 本端 assembly 清除 + resyncEpisode 置位 → 恢复 round → hub 新 transferId 首 chunk 正常收齐 → **peer ns 不 failed** |
| **发射点静态核验（F7 判据）** | 源码 grep（设计期三处） | 实现轮 grep `kind: 'RESYNC_REQUIRED'` sendChecked 发射点 | 发射点全集 == {peer declareLocalResync, hub declareHubResync} 两漏斗（收敛后）；漏斗内含挂点 2/3 实现 |
| 中止/清理 | — | resync 边沿丢弃 assembly、连接拆除丢弃、周期 round 中 transfer 暂停-恢复、ack-timeout 后新 transferId 整笔重传（并入 F6 行） | 无 stale assembly 误判；恢复后新 transferId 正常收齐 |
| 漏斗收敛零漂移（DD-8） | 既有 watchdog/session-edge 套件绿 | 实现轮回归：session-fanout-overflow 声明路径既有测试（watchdog/recovery 套件）全绿 | 收敛前后行为等价（同帧/同序/同状态迁移/同 observer cause） |
| 回归面 | SA6 §13 联合 38 测绿 | `pnpm test`（root）+ `pnpm typecheck` + ws-replication 全套（含 watchdog/recovery/backpressure/fairness） | 全绿 |

SA1 不编写/运行测试；上表为后续角色（SA3 实现、SA7 验证）的证据需求。

## 13. 风险、回滚和残余问题

| # | 风险 | 缓解 | 残余/归属 |
|---|---|---|---|
| R1 | 队首保持方案对调度敏感（wheel/记账口径多处隐式依赖） | DD-3.1 论证 + AC4/背压全套回归 + 新暂停-恢复用例 | 实现轮若发现需动 backpressure.ts 即设计偏离，回 SA1 |
| R2 | 无信号中途停摆（发送侧 bug/世界暂停——发送端**不再恢复**的真停摆族）→ 接收 assembly 残留至连接拆除；暴露上界 = 每 (ns,方向) 一个 `maxChunkedUpdateBytes` | 连接 liveness（ping/pong）+ 终态收口覆盖；**F6 闭合后，「合法路径下的无信号弃置」已消除**——peer ack-timeout 子路径（唯一合法无信号弃置）现经 wire 声明清理，不再属本风险族 | 系统性修复 = #244 `assemblyTimeoutMs` + 滑动 deadline（SA8 W3 切片边界，非本任务内可解决项） |
| R3 | 发送侧弃置 → 残渣/新 transferId 到达错误 assembly 形态 | **闭合论证（F2/F3/F6 修复后完整、两方向对称）**：发送端全部**可持有 transfer 的**弃置路径必发 RESYNC/CLOSE/ERROR 或杀连接——路径 1（queue-overflow → wire 声明）、3/4（对端声明/session 边沿 → 本端或对端 wire 声明）、5（shed live → wire 声明；非 live 分支结构性无 transfer）、6/8（发送/出站拒绝 → wire 声明）、9（teardown → 连接死亡，对端 quiesce 清 assembly）、**ack-timeout∧transfer（hub 既有 wire 声明；peer F6 新增——原「无信号」子路径已闭合）**；路径 2（deferred 溢出）与 7（超限-队列空）结构性无 transfer 交集。残渣与 round 帧同向有序、先于结算到达非 live 态（DD-4 方向序论证）；needs-resync 期间夭折 assembly 由恢复结算清理边收口 → live 下 idle∧chunkIndex>0 与「新 transferId 撞 stale busy assembly」均协议内不可达，fail-loud 判定保留为防御深度 | #244 完备化矩阵；测试注入 live 形态断言 ns failed（非连接收口） |
| R4 | `queuedBytes` 在 transfer 期间保守超计（整项计至末 chunk） | 压力方向安全（admission 偏严）；无正确性影响；F2 后溢出路径同步终止 transfer，保守记账不再制造悬挂 | 接受；#244 若做逐 chunk 退休再议 |
| R5 | `maxChunkedUpdateBytes > maxQueuedUpdateBytes` 组合在 #244 前无响亮链 | 发送上界由队列接纳自然复合（DD-2.4）；文档化 | #244 全链 + fixture 显式化 |
| R6 | 双端 limit 配置不对称（对端 maxUpdateBytes 更小）→ 接收端 per-chunk 判据用**本端**配置 | 每端以自身配置判据收口（与 UPDATE_TOO_LARGE 既有行为同构）；对称部署为常态 | 接受；协议文档归 #246 澄清 |
| R7 | `update-acked`/`update-applied`（bytes=totalBytes、sequence=末 chunk 序）与末 chunk `update-sent` 语义推广 | **SA2 N2 已裁定接受**：形状兼容、#238 关联键（wire ackedSequence）保持、三事件面配对维持（本版已钉死发射规则） | #245 到位后可再精化 |
| R8 | transferId uint32 耗尽 | 回退 v1 分支（响亮）+ 实践不可达论证（与 OutboundExhausted 同族） | 防御面；#244 可再定分类 |
| R9 | 混编部署（协商 hub fan-out 单帧 UPDATE 到未协商 peer 触发其 v1 超限路径） | ADR 互通矩阵自然后果，非缺陷（DD-6） | #246 文档化部署建议（对称配置或全量升级后启用旋钮，N5） |
| R10 | F6 新增 wire 行为的面收窄失守（实现轮误在无 transfer 的 ack-timeout 也声明 → 未协商 v1 观测漂移） | `abortedTransfer` 由通道在 `activeTransfer` 在场判定（结构门）而非控制器自估；§12 AC6 未协商 ack-timeout 负控 + F6 双向行 | 实现轮守门；SA8 定向复核（§15） |
| R11 | F7 漏斗收敛引入行为漂移（声明序/记忆化/observer 面） | DD-8.2 零行为变化声明（指令序逐行等价）+ §12 既有 watchdog/recovery 套件回归行 + 发射点静态核验 | 实现轮守门（无需独立冲突轮——SA2 §2 裁定；随 F6 复核顺带确认） |

**回滚**：改动集中于 ws-replication 连接层 + 新文件，revert 单切片 commit 即回 v1（slice 1 codec 面不动；红灯文件随之回红，刻画文件不受影响）。无持久化/数据迁移面。

**残余问题（明确非本任务内）**：R2 真停摆系统性矩阵、四配置链、observer 四事件、协议文档修订（§10.2/§10.3 + §9.4 发射点登记含 F6 追认）与混编部署建议（#244/#245/#246）。

## 14. 评审修订映射

评审输入：`wiki/raw/task_issue-243_sa2_review.md`（iteration 1：reject，2 MAJOR（F6/F7）+ N7–N11；其前版 iteration 0 的 F1–F5 + N1–N6 经该轮验证为**全部正确落实**）；`wiki/raw/task_issue-243_design_conflict_recheck.md`（O1–O4）；`wiki/raw/task_issue-243_design_conflict_recheck_r2.md`（clear + 必答观察 O5）。

| Finding | 修订位置 | 处理结果 |
|---|---|---|
| **F1**（iteration-0 MAJOR；iteration-1 验证通过）未协商超限项统一改道打破 v1 逐字节一致 | §1 目标、§6 O1 行、§7 DD-2.3 矩阵、§7 DD-3.3、§8 路线②、§11 测试场景、§12 F1/AC6 行 | **维持落实（本版未触碰语义；SA2 iteration-1 §15 验证为正确落实）**：仅「已协商 ∧ 可分块」项改道入队；一段式等价论证覆盖全部组态；§12 F6 行新增的未协商 ack-timeout 负控扩展该面 |
| **F2**（同上）deliver 溢出不清 activeTransfer → 僵尸续传 | §2 锚点行、§7 DD-3.7（单点 + 九路径枚举 + abandonInFlight 显式路径 + needsResync⇒无 transfer 推论）、§8 发送状态机、§12 F2 行 | **维持落实**：清除内联 `discardQueued()`；abandonInFlight 显式清除但不弃队列；本版在该路径上追加中止信号（F6）——清除语义本身未变，路径 4 行同步更新（session 边沿 → 漏斗声明） |
| **F3**（同上）idle∧chunkIndex>0 行为未定义 | §7 DD-4（残渣判别表 + resyncEpisode 标记 + 恢复结算清理边 + 方向序论证）、§8 接收状态机、§9、§12 F3 行、§13 R3 | **维持落实并加强**：本版 R3 闭合论证因 F6 补齐 peer ack-timeout 缺口而完整（原论证在该子路径为反例）；残渣表 live 行理由同步改写 |
| **F4**（同上）窗口口径未钉死 | §7 DD-3.3/.4/.6/.8、§8 接口表、§12 F4 行 | **维持落实**（iteration-1 A14 验证算术不变量成立）；本版零触碰 |
| **F5**（同上）peer 协商捕获公式自相矛盾 | §2（fixture wire 代理事实行）、§5 NC0 行、§7 DD-1.3、DD-1 备选、§8、§10、§11、§12 F5 行 | **维持落实**（iteration-1 §6 验证单一表述）；本版零触碰 |
| **F6**（iteration-1 MAJOR = SA8 r2 O5）peer ack-timeout 无信号弃置（PN6b）→ hub 侧 stale busy assembly → 重传新 transferId 撞校验 1 → hub ns 终局 failed；原设计五处不实断言掩盖 | 五处全改：**§7 DD-3.7**（abandonInFlight 括注重写——中止信号 + 双角色声明分派）、**§7 DD-4 挂点表**（「本端声明边」语义与锚点改写，ack-timeout 声明经漏斗）、**§9 恢复**（ack-timeout 子路径对称闭合语义）、**§13 R3**（闭合论证含 peer ack-timeout 声明）、**§12**（原「无 stale assembly 误判」行改为 F6 双向行 + 未协商负控，断言 = 真实行为）；新增 **§7 DD-7**（路径 B 决策 + 五备选否决含 N7/B(iii)/B(ii′)/B(iv)）、§3 缺口④、§5 承接行、§6 O5 行、§8 接口/状态机/路线⑤、§10 调用方三行、§11 ALLOW、§13 R2/R10 | **已落实（选择路径 B——slice 2 内语义闭合）**：peer 在「ack-timeout 弃置时有 chunked transfer 在场」子路径经 `declareLocalResync('ack-timeout')` 单漏斗发 wire RESYNC_REQUIRED（弃置时刻，搭乘既有恢复 round，零新增轮次）；仅协商连接可触达（transfer 在场为结构门），未协商 PN6b 原体逐字节；hub 既有行为镜像对称；零新帧型/零新 reason（协议 §9.4「任一端可声明」+ ADR 0013:54「同构处置」+ :58 接收端弃置清单）；§9.4 发射点登记归 #246 追认。**→ 触发定向 SA8 复核（§15）** |
| **F7**（iteration-1 MAJOR）接收端清理挂点 peer 侧声明发射点枚举不完备（漏 `onWatchdogEdge` 内联 :962-981）→ session-fanout-overflow 声明路径 stale assembly → peer ns 终局 failed | **§2**（「resync 声明单点」行改为「发射点全集」行：peer 两处/hub 单漏斗三调用点 + ack-timeout 方向不对称行）、**§7 DD-4 挂点表行 2/3**（挂点语义 = 本端任何 wire RESYNC_REQUIRED 发射点 + 置位清单全枚举 + 静态核验判据）、新增 **§7 DD-8**（漏斗收敛决策 + 零行为变化声明 + 备选否决）、§3 缺口④、§5 承接行、§8 状态机行、§10 调用方两行、§11 ALLOW、§12 F7 行 + 发射点静态核验行、§13 R11 | **已落实**：内联声明收敛入 `declareLocalResync('session-fanout-overflow')`（指令序逐行等价，零行为变化声明——SA2 备选 B 接受条件）；挂点语义钉死为发射点全集，静态判据（sendChecked RESYNC 发射点 == 两漏斗）入 §12；hub 单漏斗表述与源码一致（:749/:785-792/:817-818）；F6 新声明走既有漏斗不破坏判据。**无需独立冲突轮**（SA2 §2 裁定：已放行机制置位点枚举补全）；随 F6 复核顺带确认 |
| N7（B(i) 局限性提示） | §7 DD-7 备选否决（B(i) 行） | 已显式采纳：B(i) 单独不闭合（hub 在重传首 chunk 到达时处于 live），防误选 |
| N8（跨 ns 聚合内存，登记） | §1 非目标（maxConcurrentAssembliesPerConnection 归 #244） | 维持登记；#244 落地时回归核对上界声明 |
| N9（chunkable 双时刻求值，登记） | §7 DD-2.3（chunkable 定义）+ R8 | 维持 by design（R8），无动作 |
| N10（前版 N1–N6 状态） | §7 DD-1/DD-3.6/§8/§11/§12 各既有落点 | iteration-1 验证全部落实，从观察清单移除；本版保留其落点未触碰 |
| N11（测试方向性纪律） | §12 F6/F7 行（显式「peer→hub（新）/hub→peer（新）/未协商负控」标注） | 已并入 F6/F7 acceptance |

## 15. 是否需要设计后 ADR 冲突复查及理由

**需要（`requiresConflictRecheck: true`）——本轮新增复核面为 F6 路径 B（SA8 r2 §3 既有规则：路径 B 语义修订须随附定向 SA8 复核；SA2 iteration-1 §2 同裁定），理由：

1. **F6 新增 wire 行为（定向复核主面）**：peer 在「协商连接 ∧ ack-timeout 弃置时有 chunked transfer 在场」子路径经 `declareLocalResync('ack-timeout')` 发出 `RESYNC_REQUIRED{send-queue-overflow}`——peer 侧新增 wire 发射点（协议 §9.4「任一端可声明」的字面许可内，但发射点登记为 append，#246 追认）。复核点：(a) 与 ADR 0013:23「未协商 v1 观测不变」的相容性论证（结构门：`abortedTransfer=true` ⇒ 已协商——实现与测试负控双保险，§12 AC6 行）；(b) 与 ADR 0013:54「ACK timeout ⇒ needs-resync 同构处置」的读法对齐（hub 既有行为的 peer 镜像，chunked 子路径限定）；(c) 接收端零新增弃置触发（复用 ADR 0013:58「收到 RESYNC_REQUIRED ⇒ 全部丢弃」既有清单——hook 1 先于本设计存在）；(d) 恢复语义与 CONTEXT「分块复制传输：中断即丢弃并回退 state_vector reconciliation」词条的一致性（本决策使该词条首次在两方向成立）。
2. **F7 漏斗收敛（顺带确认，非独立触发）**：`onWatchdogEdge` 内联声明收敛入 `declareLocalResync` 声明为零行为变化（指令序逐行等价，DD-8.2）——SA2 §2 裁定锚点补全/收敛无需新冲突轮；因 F6 已触发定向复核，随附请 SA8 顺带确认零行为变化声明。
3. **既有回查面维持**：D1/D2 必答答案（§6）、hub `drainActive` 丢弃名单扩 `'UPDATE_CHUNK'`（协议 §6.3 admission 面）、`UPDATE_TRANSFER_TOO_LARGE/VIOLATION` 终局路径首次获得运行时触发面、`negotiatedCapabilities` 生命周期与 transfer/assembly 状态机所有权边界（F5 逐字捕获公式）——F1/F3/F4/F5 四面已经 SA8 r2 复核 clear（§6 表），本轮不重复申请，仅 F6/F7 修订面为新复核对象。

wire 格式零变化（slice 1 冻结面未触碰；F6 复用既有帧型与既有 reasonCode，零词表新增）；协议文档零修订（W2 边界内，§9.4 发射点登记归 #246）。

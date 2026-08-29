# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 被审对象：`wiki/raw/task_phase5-ws-multiplex-backpressure.md`（issue #137，Phase 5：multiplex namespaces with bounded fair backpressure——单连接多 namespace 多路复用 + 有界公平背压）。
> 摘录范围：ADR 全集（`docs/adr/0001`–`0010`，10 个全量读取）+ `CONTEXT.md` + 任务指定的 Phase 5 规格基准（`docs/phases/phase-5-websocket-replication.md`、`docs/protocols/instance-replication-v1.md`——后者为 ADR 0010 L151 指定的唯一 wire contract）。

## 相关 ADR

### ADR-0010 Hub/Peer WebSocket Y.Doc 复制与最终一致（accepted；含 issue #134 round-2、issue #133 round-2 修订节）

- 与本任务的关联点：**权威设计 ADR**。本任务（issue #137）在其「WebSocket 复制协议与状态机」节的连接级条款（multiplex、单生命周期、背压、公平调度、资源上限）上落地，全部 AC（AC-1–AC-7）以此为直接依据；#136 已交付单 namespace 同步域，本任务交付连接级多路复用与背压域。

- 核心条款（原文摘录）：

  **连接多路复用与 namespace 生命周期（AC-1 依据）**
  - 「每个 Peer→Hub维持一条长期 WebSocket并 multiplex多个 namespace。Wire不使用 channelId：每个 namespace-scope frame直接携带 namespaceId；同一连接内同一 namespace只允许一个生命周期，关闭后重开必须重建连接。」（L143）

  **wire contract 权威与恢复纪律（AC-2/3/4/5/6 依据）**
  - 「连接与namespace状态、消息码、payload字段、错误码、timeout、close code、backpressure和完整时序以`docs/protocols/instance-replication-v1.md`为唯一wire contract。关键恢复纪律为：连接断开即close sessions/release Leases，不保留outbox；重连重新OPEN并reconcile。Per-namespace有界队列溢出时丢弃未发送增量并进入needs-resync；connection按namespace round-robin公平发送，control/ACK保留额度，网络背压不得进入Runtime sequencer。」（L151）
  - 「队列溢出只把 channel 标记为 `needs-resync`，不得阻塞 write sequencer。」（L113——Runtime update observer 条款）

  **同步轮次与 ACK 语义（背景：背压恢复经新 round 修复）**
  - 「Namespace依次执行OPEN与身份检查、可选单frame bootstrap、双向state-vector reconciliation、live UPDATE。每个sync round由Peer以uint32 roundId发起，双方Step2完成sequenced apply + dirty后以SYNC_APPLIED确认；两个方向均确认才进入live。UPDATE_ACK同样只表示sequenced live apply + dirty notification，不表示物理flush或其他副本确认。」（L149）
  - 「每方向sequence从1严格递增，不回绕；gap、repeat或错误ACK关联关闭连接。WS ping/pong负责活性，GOAWAY提供相对drain timeout。」（L147）

  **资源上限与观测（AC-2/AC-5 依据）**
  - 「以下上限均为插件配置并提供安全默认值：最大 WS frame、最大单 update/diff、每连接最大 channel 数、per-channel/连接待发送字节、bootstrap/idle timeout、心跳与失联判定。普通超限以稳定错误关闭单个 channel；framing、认证等连接级错误才关闭整条连接。」（L165）
  - 「复制插件提供结构化 observer seam 给日志/metrics/trace Adapter，不提供业务公共 update events。最小观测面包括：连接状态与重连、channel 状态、bootstrap/reconcile 次数和字节、updates/bytes in/out、apply/ACK latency、backpressure resync、auth/authz failure、identity/epoch conflict、peer degraded bypass apply 和稳定错误计数。」（L167）

  **包边界（本任务交付物定义）**
  - 「`@nomicore/ws-replication`：WebSocket client/server、multiplex、认证授权、bootstrap/reconcile/live 状态机、背压和 observer；」（L174）

  **transport 抽象纪律（范围边界依据）**
  - 「在出现第二种 transport 前，不提前提取 transport-independent replication package。第三方 Host 可直接基于公开 NamespaceLease/ReplicationSession 构造自己的可信 transport。」（L177）

  **停机顺序（shutdown race 测试依据）**
  - 「停止顺序为：复制插件停止接纳连接/target，关闭 channels，等待已被 Runtime 接纳的 apply 槽完成但不无限等待网络 ACK，释放 replication leases，随后 Registry shutdown、Persistence dispose，最后停止 Timer/Clock。」（L179）

  **非目标（AC-7「bounded memory」与范围边界依据）**
  - 「durable outbox、增量 WAL 或跨重连 update ID 表；」「shared filesystem 多写。」（非目标节）

  **issue #134 round-2 修订节——两级队列属主边界（本任务「切片 3 对账注记」的权威来源，设计与实现不得混淆）**
  - fanout 投递队列（runtime 内、session 域）：「投递经**每 session 有界异步队列**（容量 **16** 冻结常量 `FANOUT_CHANNEL_QUEUE_CAPACITY`——不可配置）」「队列溢出 → 丢弃新项（保序：已入队最旧项保留）+ 置 `status.needsResync`（第 11 字段，sticky——置位后 session 生命周期内永不清除……）」——属切片 3（issue #134）已交付域。
  - WS 发送队列/连接级背压：「L241「熔断/背压属切片 6 队列属主」**收窄**为「WS 发送队列/连接级背压（正文 L151 域）」——投递队列（runtime 内、session 域）属本切片」——即 WS 层发送队列/连接级背压属本任务（切片 6 域）。
  - epoch 传播走控制面：「epoch 传播走控制面（切片 6 `IDENTITY_CHANGED`），不依赖 raw update 携带。」（本任务连接层须承载该控制帧路径，已在 #136 交付）

### ADR-0009 NamespaceRegistry、调用方租约与 Cordis Host 生命周期（accepted；含 #131、#134 修订节）

- 与本任务的关联点：连接断开/namespace 关闭时的 Lease release 编排、Cordis Timer 纪律（AC-6「Cordis scheduler」的生态惯例出处）。
- 核心条款（原文摘录）：
  - 「首次 `release()` 在调用栈内同步将 lease 标记为 released，之后不再接纳新操作。重复 release 返回 exact same Promise。……release 不追踪或等待此前已经由 Runtime 接纳的写；这些写仍由 Runtime sequencer 管理。」
  - #134 修订节：「release 同步段调用既有活跃 session 的 `close()`（停接纳 + 退订 + 释放 slot；零新增方法面）；release 不追踪/取消已接纳 apply 槽。」
  - 「Persistence 和 Registry 都依赖外部 Clock 与 Cordis Timer，不各自实现或 fallback 到系统 timer。Clock 是 wall clock，不承诺单调；elapsed scheduling 由 Timer负责。确定性测试使用 manual Clock 状态与 fake timer协调推进。」（协议 §17 对 WS 层作出同款显式要求，见下）
  - 「Registry plugin 强依赖：Cordis Timer plugin 的 `ctx.timeout()`……缺失任何依赖均在 plugin 启动时响亮失败，不 fallback 到 `Date.now()` 或全局 timer。」

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted；含 #93、#132 修订节）

- 与本任务的关联点：AC-3/AC-6「never blocks the Runtime sequencer」的义务方与边界——连接级背压/调度完全位于 Runtime sequencer 之外，不得反向进入；不同 namespace 可并行是公平调度的结构前提。
- 核心条款（原文摘录）：
  - 「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer；不同 namespace 可并行。」
  - 「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务。」
  - #132 修订节 status 边界：「该域仅含持久 identity/epoch 的两态联合……不含 session、网络、队列或 sync 状态。」（连接/队列/背压状态属 ws-replication 插件，不得塞入 Runtime status）

### ADR-0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted；Runtime/open/read 条款由 ADR 0008 部分取代）

- 与本任务的关联点：弱关联——raw update 受控通道已由 ADR 0010 裁决为 ReplicationSession；本任务的背压丢弃只影响未发送 wire 增量，不触及已 apply 的本地状态。被取代条款不构成约束。

### ADR-0006 Cordis 持久化插件（accepted；含 #64/#79 修订节、#131 对齐说明、#133 修订节）

- 与本任务的关联点：弱关联——本任务不改 Persistence；`saveDoc` dirty-notification 语义是「已接受本地 Y.Doc 状态保持」（AC-3）的持久侧背景。无直接约束条款。

### ADR-0001 ~ ADR-0005（均 accepted）

- 与本任务的关联点：无直接关联——本任务不触及 VFSL 真相源（0001）、authority 范围（0002）、求值器/ROOT 约定（0003）、类型投影（0004）、投影生成管线（0005）。SCHEMA 只作为复制受保护字段被整体保护/放行，不解释其内容。

## CONTEXT.md 相关术语与惯例

- **Hub（中心实例）**：「静态星型复制拓扑中接受 peer WebSocket 连接、转发 Yjs updates、管理 SCHEMA 与复制身份的完整 Nomicore 实例；Hub 也是可接受本地 ROOT 业务写的副本，不是 ROOT 唯一写者，也不表示自动选举的 leader。」_Avoid_: master、leader、只转发而不持有完整副本的中继
- **Peer（边缘实例）**：「静态连接唯一 Hub 的完整 Nomicore 实例；使用独立 Persistence，断线时保持本地 ROOT 读写，重连后按 state vector/diff 与 Hub 双向合并。Peer 之间不直连，且不能本地修改 SCHEMA 或复制身份。」_Avoid_: slave、follower
- **namespaceId**：「Registry entry 与实例复制 wire 的唯一 namespace 身份，普通 create 由受控 128-bit CSPRNG 生成 `ns-` + 32 位小写 hex；……owner 是 open/create 的本地重要属性但不上 wire，也不参与复制身份；不同实例可为同一 namespaceId 使用不同 owner。」_Avoid_: 用户可读名称、由调用方任意指定的 ID、`(owner.userId, namespaceId)` Registry key
- **写序列器（write sequencer）**：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。」_Avoid_: mutation queue
- **ReplicationSession**（节选，两级队列边界）：「……fanout 投递有界队列溢出将 session 标记 `needs-resync`（sticky）——transport 须 reset/bootstrap。」_Avoid_: 裸 Y.Doc WS handler、绕过本地 write sequencer 的 apply、把网络状态塞进 Runtime capability status
- **复制谱系（replication lineage）** / **复制代际（replication epoch）**：身份/epoch 匹配才允许 reconciliation；不同 → conflicted、显式 reset/bootstrap，不自动覆盖合并。
- **复制未校验（replication-unvalidated）**：「Trusted raw Yjs update 已在 sequencer 中提交并登记 dirty，但未执行完整 VFSL ROOT 预校验的复制状态……」
- **实例角色（instance role）**：「实例静态角色 hub/peer，经 Registry 构造 `options.role` 注入（可选、缺省 `'hub'`）；……生产 composition root（phase-5 切片 9）必须显式传入。」

## Phase 5 规格基准（任务指定的裁决/验收基准）

### docs/phases/phase-5-websocket-replication.md（切片 6/7 及验收基准）

- 切片 6 原文要求（本任务主域）：
  - 「Per-namespace滑动窗口、有界队列、round-robin公平调度与connection control保留额度；溢出丢弃未发送增量并重新diff，不阻塞Runtime sequencer。」
  - 「实现connection、namespace与sync-round状态机及blocked/backoff/full-jitter恢复。」
  - 「Origin回声抑制、专用ACK、RESYNC_REQUIRED和Hub单observer多session fan-out。」
- 切片 7 原文要求（本任务涉及的 multiplex 条目；其余认证/授权部分在简报中划出范围）：
  - 「一个 peer→hub 长连接 multiplex 多个 namespace。」
  - 「Peer 指数退避并带抖动重连；hub 不反向拨号。」
- 必须通过的场景（本任务相关子集）：#10「慢消费者触发 `needs-resync`，不阻塞本地业务 write sequencer」；#11「重复、乱序和重连 update 依靠 Yjs 幂等/state vector 收敛」；#13「frame/update/channel/queue 上限按 channel 或连接正确隔离」；#16「优雅停机完成已被 Runtime 接纳的 apply，不无限等待网络 ACK」。
- 测试 seam：「WS 层使用内存双端 transport/fake socket 覆盖连接与 channel 状态机，不用真实时间等待」；「故障注入覆盖丢帧、重复帧、乱序、连接中断、队列溢出、flush failure、认证撤销和 shutdown race」（AC-7 依据）。
- 非目标（与 ADR 0010 同源）：「durable outbox、增量 WAL、跨重连 update ID 去重表」「第二种 transport 及提前抽取 transport-independent replication seam」。
- 阶段门禁：「所有 frame/update/queue/channel 上限有确定性失败测试」「默认日志和 metrics 通过敏感信息/高基数审查」。

### docs/protocols/instance-replication-v1.md（ADR 0010 L151 指定的唯一 wire contract，具 ADR 级约束力）

- **不变量（§1，摘录）**：
  - 「1. 一条 WebSocket binary message 恰好承载一个完整 Nomicore frame；不粘连多个 frame，也不跨 message 分片。」
  - 「2. 每条正常 frame 都消费本发送方向的 sequence；对端严格按期望值接收。」
  - 「3. 每个 namespace frame 直接携带 namespaceId，不使用 channelId、owner 或 session nonce。」
  - 「4. 同一连接内，同一 namespaceId 只允许一个生命周期；closed、conflicted 或 failed 后不得重新 open，重新 add 必须重建连接。」
  - 「7. 所有远端 apply 进入本地 namespace 的唯一 write sequencer，并在槽内完成 dirty notification。」
  - 「8. ACK 表示 sequenced live apply + dirty notification，不表示物理 flush、其他副本确认或 quorum durability。」
  - 「9. Origin 只用于回声抑制；重连、bootstrap 竞态和队列丢弃均由 state-vector reconciliation 修复。」
- **重复 OPEN 与重开（§7.1）**：「同一连接内 opening/open 的重复 OPEN 合流底层操作，但每个请求都收到 OPEN_OK 或 ERROR；closed/conflicted/failed 后返回 `NAMESPACE_REOPEN_REQUIRES_RECONNECT`。」
- **Live UPDATE 与未发送合并（§10.1——AC-2「unsent-update merging」依据）**：「普通 UPDATE 只允许在 live 状态发送。Reconcile期间本地 updates进入有界未发送队列；round完成后发送。尚未分配 sequence、尚未发送的 updates允许 `Y.mergeUpdates()` 合并；发出后不得改写。」
- **滑动窗口（§10.2——AC-2「configurable in-flight UPDATE window」依据）**：「每 namespace每方向采用可配置滑动窗口，默认 32 个 in-flight UPDATE。窗口满只暂停该 namespace发送，不阻塞本地写或其他 namespace。」「Unknown、类型不匹配或 namespace不匹配的 ackedSequence 属 connection fatal `ACK_STATE_VIOLATION`。」
- **Connection 错误注册表（§13.1——AC-5「classified connection failure」依据）**：`CONNECTION_BACKPRESSURE | yes | yes | 1011`；另 `FRAME_TOO_LARGE`（1009）、`SEQUENCE_VIOLATION`/`ACK_STATE_VIOLATION`（1002）、`INTERNAL_ERROR`（1011）；「`config` 表示只有配置/部署变化后才重试，不是当前连接自动重试。」
- **Namespace 错误注册表相关行（§13.2）**：`ACK_TIMEOUT | no | resync | needs-resync`；`NAMESPACE_REOPEN_REQUIRES_RECONNECT | yes | reconnect | closed`；「Wire永不携带 owner、token、SCHEMA、ROOT、update、stack、原始 cause或异常 message。」
- **WS close code（§14）**：「`1002`：bad framing、sequence、message、ACK等协议错误；」「`1009`：外层 frame超限；」「`1011`：不可恢复内部错误或 control backpressure。」「如果 framing 仍可信，关闭前 best-effort发送 connection ERROR；否则直接 close。」
- **Target controller 与 socket loss（§16——AC-1 重开禁止 + 恢复纪律依据）**：
  - 「socket断开时，控制器投影为 disconnected，立即停止 session、排空已接纳 apply并release Lease；target保留；」
  - 「断线期间不维持 update outbox或subscription，重连后从当前 Y.Doc state vector恢复；」
  - 「Target controller用单一生命周期队列串行化 removeTarget、socket close、session close与Lease release。removeTarget同步把 intent标记为 removed；cleanup调用合流到同一个 Promise。随后 addTarget因本连接禁止重开而触发整连接重建。」
  - 「Cleanup只在 apply promises settle后执行，绝不在 sequencer槽内 await session/Lease/Registry shutdown。」
- **背压、公平调度与上限（§17——AC-2/3/4/5/6 全部依据）**：
  - 每 namespace限制清单：「`maxQueuedUpdateBytes`；`maxQueuedUpdateCount`；`maxInFlightUpdates`，默认 32；`maxUpdateBytes`；`maxBootstrapBytes`；`maxSyncDiffBytes`。」
  - 「未发送队列任一上限超出：丢弃全部未发送增量，标记 needs-resync，停止新 UPDATE。已发送窗口等待 ACK或连接断开；窗口收口后由 Peer开始新 reconciliation。」
  - 「Connection使用 per-namespace队列和 round-robin：control/error/ACK高优先级，data每轮每 namespace最多一个。总队列超限时，按最大 queued namespace依次丢弃未发送增量并标记 needs-resync，直到回到低水位。Control frame有独立保留额度，耗尽为 `CONNECTION_BACKPRESSURE`。」
  - 「Adapter观察 WebSocket `bufferedAmount`：超过 high-water暂停 dequeue，降至 low-water恢复。无 drain event时使用 Cordis Timer调度检查，不使用原生 timer，也不进入 Runtime sequencer。」
  - 配置启动时响亮验证：「`maxQueuedUpdateBytes >= maxUpdateBytes`」「`maxInFlightUpdates >= 1`」「所有 timeout 是有限安全整数且 > 0」「`low-water < high-water`」等；「不得运行时 clamp。」
- **Timeout（§18——AC-2「ACK timeout」依据）**：「Open/bootstrap/reconcile/close/ACK timeout只收口 namespace；ACK timeout不重发同一 UPDATE，而进入 needs-resync并由新 state-vector round修复。」
- **RESYNC_REQUIRED（§9.4）**：「任一端可声明当前增量连续性作废，但始终由 Peer用新 roundId 发起下一轮。发出后不再发送新 UPDATE；已接纳 update 正常 apply/ACK。Peer等待 in-flight 窗口收口后开始新 round；断线则重连后重新 OPEN/reconcile。」「首版不做周期 reconciliation，仅在 bootstrap、reconnect、queue overflow、ACK timeout或显式 RESYNC_REQUIRED 时运行。」
- **停机（§21——AC-7 shutdown race 依据）**：六步停机顺序（replication 停止接纳并发 GOAWAY → namespace 停新 frame 排空已接纳 apply → close sessions/release leases → Registry shutdown → Persistence dispose → Timer/Clock 停止）；「Drain不无限等待网络ACK。不得从notifier或sequencer槽内await Runtime close、Lease release或Registry shutdown。」
- **Conformance（§22）**：「fake duplex transport上的connection、namespace、sync、resync、drain状态迁移」；decoder 越界/截断/尾随矩阵；fuzz/property。

## 设计后复审追加（SA8 登记 `..._design.md` 引入的新决策点；只登记，不裁决）

> 以下为 SA1 设计（`wiki/raw/task_phase5-ws-multiplex-backpressure_design.md`，2026-08-28）钉死的、
> 基准文本（ADR/协议/Phase 5）未显式定量或留有自由度的决策点。SA8 已逐项对照裁 no-conflict
> （见 `..._design_conflict_report.md`）；此处按链路复用需求登记原文锚点，SA2/SA3/SA4 据此比对。

- **D1 bufferedAmount 读取 seam 形态**（§0 R0-3/§4.2）：对既有 `DuplexTransport` 做鸭子类型动态
  属性读取（单点 `ConnectionSender.readLevel()`）；缺失 / 非 number / 非有限数 / getter throw →
  **0 = 无压力（永不暂停）**；`DuplexTransport` 公共类型零增字段。依据：协议 §17 + ADR 0010 L177。
- **D2 poll 间隔冻结常量**（§1.3-3/§4.2）：`BACKPRESSURE_POLL_INTERVAL_MS = 1_000`（包内冻结常量、
  非配置）；仅暂停段武装，恢复/连接收口清除；经注入 `ReplicationTimer`。依据：协议 §17「无 drain
  event 时使用 Cordis Timer 调度检查」。
- **D3 control 保留额度量纲与记账**（§4.3）：额度 = `limits.lowWater` 字节（公共契约零新字段下
  唯一量纲吻合的既有水位）；暂停段内按**编码后实际字节数**累入（`OutboundQueue.onEmitted` 单点
  回报）；恢复/收口清零；非暂停段不记账。附注：「lowWater ≥ 1」保证来源为 `validate.ts` 代码
  （协议仅要求 low-water < high-water）。依据：协议 §17「Control frame有独立保留额度」。
- **D4 额度耗尽的双侧处置**（§4.3）：hub → 既有 `connectionFatal('CONNECTION_BACKPRESSURE', 1011)`；
  peer → 新私有 `failConnectionBackpressure()`（best-effort ERROR **豁免额度直发** → `transport.close(1011,
  'control-backpressure')` → `onTemporaryFailure()` backoff，非 blocked）；连接级收口 ERROR
  （connectionFatal/onSequenceExhausted）改经直发 outbound 路径。依据：协议 §13.1/§14/§15.1。
- **D5 连接总压记账域与 shed 停止条件**（§4.4）：`totalQueuedDataBytes = Σ facet.queuedBytes()`——
  只计 per-ns **未发送 data 队列**（in-flight、control 不计）；每次 data 入队即时求和（O(ns)，不做
  增量记账）；触发用**严格大于** `maxQueuedBytesPerConnection`；victim = queuedBytes 最大者（并列取
  wheel 插入序先者）；「直到回到低水位」读作 **Σ ≤ cap 停止**。依据：协议 §17。
- **D6 shed 处置 = §10.2 同构**（§4.4）：`discardQueued()` + channel `needsResync = true` + 停发新
  UPDATE；通道 live → peer `declareLocalResync()`（RESYNC_REQUIRED{reasonCode:'send-queue-overflow'}）/
  hub `declareHubResync()`（声明后等 peer 新 round）；非 live → `pendingResync = true`；shed 不触发
  连接重建/重连。依据：协议 §17 + §9.4。
- **D7 data 双路径调度**（§4.1/§4.5）：live 直发快速路径（窗口有空位 ∧ 闸门开 → 立即发送，不入队，
  不经 wheel）；排队 data 走插入序 wheel + 旋转游标 RR（一次 pass 每 ns 至多一帧）；
  `DRAIN_TURN_LIMIT = 10_000`；drain 触发点恰三个：水位恢复 / onAck 窗口空位 / resetForLive。
  依据：协议 §17（解释登记 I-1，SA2 攻击面）。
- **D8 未发送合并触发判据**（§5）：仅在 `pullAndSendOne()` 取帧时 `queuedCount > avail`
  （avail = `maxInFlightUpdates − inFlight.size`）才贪心合并（从队首累计 `Y.mergeUpdates`，累计字节
  ≤ `maxUpdateBytes`，至少一项）；`queuedCount ≤ avail` 不合并逐项一帧；合并产物一帧/一序列号/一项
  inFlight。依据：协议 §10.1（「允许」条款下的策略钉死）。
- **D9 水位观察时机**（§4.2）：恰三处同步读——① 每次 control 帧发送前；② 每次 data 发送尝试前
  （`dataGateOpen()`/`tryEmitData` 内，drain 帧间复查）；③ poll timer 到期（仅暂停段）。
  依据：协议 §17「超过 high-water暂停 dequeue」的逐帧执行面。
- **D10 内部 seam 变更（公共契约零变化）**（§6/§13）：`UpdateChannelHost` +`dataGateOpen`/
  `onDataQueued`/`requestDataDrain` 三钩子；`flushQueued` 删除 → `pullAndSendOne()`（触发责任上移
  连接层）；`OutboundQueue` 删 data 死代码（dataQueues/dataOrder/cursor/sendData 等，零 caller）、
  +公共 `emit(message)` + 可选 `onEmitted` 字节回报、`drain()` 收窄 control-only；`peer/hub-connection`
  装配 `ConnectionSender`（backpressure.ts 新模块）并在 stop/blocked/backoff/rebuild/close 路径补
  `teardown()`。`types.ts`/`defaults.ts`/`validate.ts`/`index.ts` 零改动。
- **D11 显式不加的 validate 约束**（§4.4/§15 B-3/B-4）：① `maxQueuedBytesPerConnection ≥
  maxUpdateBytes` 不入校验（会击穿 AC-5 测试配置；登记运维指导：cap ≥ maxQueuedUpdateBytes）；
  ② 「每连接最大 channel 数」上限（ADR 0010 L165 清单项）延后至演进位 B-4。依据：协议 §17 校验
  清单为封闭枚举。

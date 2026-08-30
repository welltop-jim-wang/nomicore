# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 被审任务：Issue #172 — Phase 5 follow-up: reconcile ws-replication authoritative contracts and delivery boundaries
> （简报：`wiki/raw/task_phase-5-websocket-replication-contracts.md`；Run ID `issue-172-1788016848-4073122`，Round 1）
> 盘点范围：`docs/adr/` 全部 10 份 ADR（逐个全读，无抽样）+ 根 `CONTEXT.md`。

## 相关 ADR

### ADR-0010 Hub/Peer WebSocket Y.Doc 复制与最终一致（accepted；含 issue #134 / #133 / #161 修订节）

- 与本任务的关联点：本任务全部五项要求（去权威化 `wiki/raw`、五组契约收敛、未交付边界陈述、测试叙事修正、不发明未实现行为）均落在 ADR-0010 管辖的 Phase 5 复制域；ADR-0010 同时把 wire 细节权威明文让渡给 `docs/protocols/instance-replication-v1.md`。
- 核心条款（原文摘录）：
  - 「连接与namespace状态、消息码、payload字段、错误码、timeout、close code、backpressure和完整时序以`docs/protocols/instance-replication-v1.md`为唯一wire contract。」
  - 「Per-namespace有界队列溢出时丢弃未发送增量并进入needs-resync；connection按namespace round-robin公平发送，control/ACK保留额度，网络背压不得进入Runtime sequencer。」
  - 「固定 envelope为 20-byte大端头：`NMCR` magic、envelope version、message type、flags、direction-local sequence、payload length和reserved。首版flags/reserved必须为零，一条WebSocket binary message恰好承载一个完整frame。……Envelope version只决定头布局，HELLO显式协商完整protocol version与capabilities；不得按消息数值猜版本。」
  - 「每方向sequence从1严格递增，不回绕；gap、repeat或错误ACK关联关闭连接。WS ping/pong负责活性，GOAWAY提供相对drain timeout。」
  - 「以下上限均为插件配置并提供安全默认值：最大 WS frame、最大单 update/diff、每连接最大 channel 数、per-channel/连接待发送字节、bootstrap/idle timeout、心跳与失联判定。普通超限以稳定错误关闭单个 channel；framing、认证等连接级错误才关闭整条连接。」
  - 「复制插件提供结构化 observer seam 给日志/metrics/trace Adapter，不提供业务公共 update events。最小观测面包括：连接状态与重连、channel 状态、bootstrap/reconcile 次数和字节、updates/bytes in/out、apply/ACK latency、backpressure resync、auth/authz failure、identity/epoch conflict、peer degraded bypass apply 和稳定错误计数。」
  - 「Phase 5 首版建立：1. `@nomicore/replication-protocol`：纯二进制 codec、显式版本协商、消息与稳定错误，不依赖 Cordis、WS 或 Registry；2. `@nomicore/ws-replication`：WebSocket client/server、multiplex、认证授权、bootstrap/reconcile/live 状态机、背压和 observer；3. `apps/yjs-server`：最小 Cordis composition root，装配 Clock、Timer、Memory/File Persistence、Registry、WS replication、配置加载和优雅停机。」
  - resetReplica 正文条款（注意：其执行次序描述已被 issue #133 round-2 修订节替换，见下）：「Peer 冲突恢复使用带 `expectedLocalIdentity` 的 `resetReplica()`……Persistence 为此增加受身份前置条件保护的归档 seam；WS 层不得直接读写 snapshot 文件。」

- issue #161 round-2 修订节（ws-replication 实现层八项 review 修订——本任务五组收敛项的直接 ADR 锚点）原文摘录：
  - 「wire 契约以 `docs/protocols/instance-replication-v1.md`（§2/§17/§18 本轮扩写）为唯一权威：公共身份投影只取受信 Upgrade 身份（缺身份 accept = 响亮 TypeError）；transport 三可选面（bufferedAmount/ping/onPong）缺面 dormant 语义与生产装配期断言；liveness 缺省 30s/10s 与 pongTimeout < pingInterval 构造期校验；背压终态口径（pipeline = queued+buffered、shed 仅 queued 侧、严格接纳 + onDataShed 显影、控制独立保留额度 maxQueuedControlBytes 缺省 8MiB、有界整轮扫描、pending handoff 计入 per-ns 溢出双口径、checkpoint = max(1, floor(ackTimeoutMs/100))、1011 终止）；peer pong 超时 close(1001) + 代际安全脱离后重连；GOAWAY/blocked/连接收口同步静默订阅先于异步 drain。实现证据：`packages/ws-replication/src/*`（PR #165 round 2）。」

- issue #133 round-2 修订节（resetReplica 边界陈述的现行有效文本）原文摘录：
  - 「本节替换「复制谱系与 epoch」节中 resetReplica 的执行次序描述（“Registry 先关闭本地 Runtime generation，再通过 Persistence 归档旧副本”）与「Bootstrap 与重连」节第 3 步的一般性身份核对（“严格核对 META 身份”），并以本节为准；本节未明示的其余 ADR 文本维持效力。」
  - 「**1. `resetReplica(expectedLocalIdentity)` 严格前置核对**：对 active generation，在任何 lease 强制释放、close、归档或 bootstrap 资格变更**之前**，Registry 在 Runtime 唯一 write sequencer 的 reset-fence 槽内执行「当前 live 投影 + 受信任 persisted committed-snapshot」双源核对，二者都必须是合规 enabled 复制身份且与 expected **完全一致**。……」

- 非目标节（约束「不得发明未实现行为」的边界参考，摘录）：「- awareness/presence；- 客户端 y-websocket 兼容端点；- 跨地域强一致、全局顺序或 quorum durability；- 自动覆盖 identity/epoch 冲突；- raw update 的完整 VFSL 校验；- namespace discovery/list 和通配 selector；- durable outbox、增量 WAL 或跨重连 update ID 表；- shared filesystem 多写。」

### ADR-0006 Cordis 持久化插件（accepted；含 #64 / #79 / #131 / #133 修订节）

- 与本任务的关联点：任务要求陈述 `resetReplica` 未交付边界；其依赖的 Persistence 受控能力（importDoc / archiveDoc / 只读身份探针）由本 ADR issue #133 round-2 修订节冻结。
- 核心条款（原文摘录）：
  - 「**1. `importDoc(owner, docId, doc)` 是排他创建能力**：duplicate 绝不覆盖（claim 排他 + `DOC_DUPLICATE`）；……复制身份与 Hub 广告的**完全一致核对是调用方（Registry 受信 bootstrap 编排）在所有权转移之前的职责**——Persistence 不是、也不得成为 Hub 广告授权/复制策略引擎……」
  - 「**2. `archiveDoc(owner, docId, expected)` 只允许在无有效 handle（且在途 dirty 已排空）时执行**：它先排空既有 dirty 状态，再以持久快照复制事实为权威做身份守卫读取……」
  - 「**4. Persistence 内部只读 committed-identity probe（`readPersistedReplicationIdentity(owner, docId)`）**：为 Registry reset preflight 提供……**不签发 handle、不建 live cell、不调用 saveDoc、不排空 dirty、不写/flush/archive、不转移所有权**。」

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted；含 #93 / #132 / #134 修订节）——边缘相关

- 与本任务的关联点：公共 TypeScript API 收敛若触达复制管理写 / ReplicationSession 词汇，须与本 ADR 修订节的冻结词汇一致；本任务简报未直接要求修改这些面。
- 核心条款（原文摘录）：
  - 「正文「v1 公开两个窄方法」作如下限定：“基础 v1 方法为两个（`mutateRoot` / `replaceSchema`）；经 ADR 0010 授权的复制管理例外另加 `enableReplication()` 和 `bumpReplicationEpoch()`”。四者均进入同一严格 FIFO write sequencer……」
  - 「`durability`（`memoryCaughtUp` **初值冻结 false**——open 时刻尚无经本 session 的 raw apply；首次 apply 成功置 true 后不回落；`diskCaughtUp: false` 字面量类型——该查询面结构性永不声称 durable）」

### ADR-0009 NamespaceRegistry、调用方租约与 Cordis Host 生命周期（accepted；含 #131 / #134 修订节）——边缘相关

- 与本任务的关联点：`openReplicationSession` 的 lease 面；本任务简报未直接要求修改。
- 核心条款（原文摘录）：
  - 「`NamespaceLease` 增加第十四成员 `openReplicationSession(options)`（授权已在 ADR 0010「NamespaceLease 与 ReplicationSession」L73–79）。released 通道表新增一行：released lease 的 `openReplicationSession` 经返回 Promise 结算 `{ok:false, code:'NAMESPACE_LEASE_RELEASED', message: NAMESPACE_LEASE_RELEASED_MESSAGE}`（与四写同款——resolve 不 reject）。」

### 其余 ADR（0001–0005、0007）——与本任务无关联

- 0001 / 0003 / 0004 / 0005 属 VFSL 语言、求值器、类型投影与生成管线域；0002 属仓库定位（authority 出范围）；0007 的 Runtime/open/read 条款已由 ADR-0008 部分取代，且不在本任务触碰面内。全量对照结论见 `task_phase-5-websocket-replication-contracts_conflict_report.md`。

## CONTEXT.md 相关术语与惯例

- `Hub`：「静态星型复制拓扑中接受 peer WebSocket 连接、转发 Yjs updates、管理 SCHEMA 与复制身份的完整 Nomicore 实例；Hub 也是可接受本地 ROOT 业务写的副本，不是 ROOT 唯一写者，也不表示自动选举的 leader。」_Avoid_: master、leader（会误示单写权威或选举语义）、只转发而不持有完整副本的中继
- `Peer`：「静态连接唯一 Hub 的完整 Nomicore 实例；使用独立 Persistence，断线时保持本地 ROOT 读写，重连后按 state vector/diff 与 Hub 双向合并。Peer 之间不直连，且不能本地修改 SCHEMA 或复制身份。」_Avoid_: slave、follower（会误示只读或被动复制）
- `namespaceId`：「Registry entry 与实例复制 wire 的唯一 namespace 身份，普通 create 由受控 128-bit CSPRNG 生成 `ns-` + 32 位小写 hex；Registry 在当前进程内只以 namespaceId 排他索引。Persistence 仍用 owner.userId 分区，owner 是 open/create 的本地重要属性但不上 wire，也不参与复制身份；不同实例可为同一 namespaceId 使用不同 owner。」_Avoid_: 用户可读名称、由调用方任意指定的 ID、`(owner.userId, namespaceId)` Registry key、存储层严格全局唯一承诺
- `复制谱系（replication lineage）`：「由 `META.replicationId` 标识的 namespace 复制身份；只有 namespaceId、replicationId 与 replication epoch 全部匹配的副本才允许直接执行 Yjs state-vector reconciliation。replicationId 是 128-bit 随机值的固定小写 hex，不等同于 namespaceId 或 SCHEMA 信封 `id`。」_Avoid_: 仅凭 namespaceId 判断同源、把 owner 纳入 wire identity、用 SCHEMA id 充当文档实例身份
- `复制代际（replication epoch）`：「`META.replicationEpoch` 中从 1 开始、只由 Hub 显式提升的安全整数；相同复制谱系但 epoch 不同的副本进入冲突状态，必须显式 reset/bootstrap，不自动覆盖或合并。」_Avoid_: 连接次数、自动选主 term、可回绕版本号
- `ReplicationSession`：「由 NamespaceLease 打开的受信任 duplex raw Yjs 复制会话；冻结本地角色、远端实例、复制谱系与 epoch，提供 state vector（`encodeStateVector`）、diff（`encodeDiff`）、owned update subscription（`subscribeOwnedUpdates`）和进入本地唯一 write sequencer 的 trusted apply（`applyRemoteUpdate`）、独立状态（`getStatus`）与幂等 close（`close`），但不暴露 live Y.Doc。每 Lease 至多一个活跃 session；`close` 或 epoch fence 后进入终态（closed/conflicted）并释放槽位；host 负责只把该高级能力交给可信 transport。fanout 投递有界队列溢出将 session 标记 `needs-resync`（sticky）——transport 须 reset/bootstrap。」_Avoid_: 裸 Y.Doc WS handler、绕过本地 write sequencer 的 apply、把网络状态塞进 Runtime capability status
- `复制未校验（replication-unvalidated）`：「Trusted raw Yjs update 已在 sequencer 中提交并登记 dirty，但未执行完整 VFSL ROOT 预校验的复制状态；它可能导致后续普通业务写因当前完整 ROOT 不合法而失败，不表示 transaction 可回滚或 raw update 享有 zero-write 保证。」_Avoid_: validated replication、apply 后校验失败自动 rollback
- `实例角色（instance role）`：「实例静态角色 hub/peer，经 Registry 构造 `options.role` 注入（可选、缺省 `'hub'`）；peer 实例的本地 replaceSchema/enableReplication/bumpReplicationEpoch 以稳定角色权限错误拒绝，session 的 localRole 必须等于实例角色。生产 composition root（phase-5 切片 9）必须显式传入。」_Avoid_: 运行期角色切换、peer 本地修改 SCHEMA 或复制身份

## 设计后复审追加（issue #172 SA1 设计引入的新决策点）

> SA8 设计后复审产出。只摘录 SA1 设计（`task_phase-5-websocket-replication-contracts_design.md`，R1）引入的决策点与其自陈锚点，不裁决；裁决见 `task_phase-5-websocket-replication-contracts_design_conflict_report.md`。

- **D1 G1 收敛面**（设计 §0/§1-D1）：「本票唯一的生产代码改动 = G1 公共字段收敛」——`controlReserveBytes`(64KiB) → `maxQueuedControlBytes`(8MiB) 字段名/缺省/构造期链式下界（`≥ maxBootstrapBytes + PROTOCOL_OVERHEAD_BYTES(128)`，TypeError，绝不运行时 clamp）/记账判据接线；记账机制保留。锚点自陈：protocol §17 + ADR-0010 issue #161 修订节。
- **D2 延后锚注册机制**（设计 §1-D2）：8 条延后锚（A2-1/A2-2/A3-1/A4-1/A4-2/A5-1/A5-2/A5-5）转 `it.fails`，断言体零改动。测试机制，无 ADR 条款锚点（基准外事项）。
- **D3 A5-5 归属裁决**（设计 §1-D3/§3.3）：「hub 停机 GOAWAY 属 ws-replication 包行为，修复票 #171，**不**是 #164 composition 边界」——依据自陈：protocol §21 停机第 1 步「replication 停止接纳连接/target 并发送 GOAWAY」主语是 replication（插件）；#164 只负责按 §21 顺序编排。
- **D4 fixture 校准**（设计 §1-D4/D4-bis）：新链式下界波及的既有小额度 fixture 以同 limits 显式追加 `maxBootstrapBytes: 1_024`（设计期实测 fixture 快照 345B）恢复合法性；缺省漂移（64KiB→8MiB）使 `ws-replication-sa7-r2-transport.test.ts` 迁移为显式额度采样（`maxBootstrapBytes: 1_024, maxQueuedControlBytes: 64_000`）。测试工程，无 ADR 条款冲突面。
- **D5 记账口径声明**（设计 §1-D5/§3.3）：「保留『暂停段出站 control 实编码字节累计』作为『socket 缓冲内未冲刷控制字节』的保守上界代理」——偏高估计 ⇒ 偏向提前 1011 = fail-safe；拟经 ADR-0010 issue #172 修订节（C2 第 1 条）登记。锚点自陈：protocol §17「额度按 socket 缓冲内未冲刷控制字节计」。
- **D6 去权威化判定标准**（设计 §1-D6/§3.4）：必改 = 把 wiki/raw 表述为「冻结契约/权威设计/契约来源」的引用（src 9 文件 + 测试头 11 处）；不动 = 其余 ~38 处历史证据引用。锚点自陈：docs/AGENTS.md Authority 节 + ADR-0010 L151 让渡条款。
- **D7 不动面**（设计 §1-D7）：`docs/protocols/instance-replication-v1.md` 与 `CONTEXT.md` 零改动；`packages/replication-protocol/**` 错误注册表不动——「`PONG_TIMEOUT` 是否入 §13.1 注册表、hub 侧 pong 超时是否发 ERROR 帧——属 #170 的设计决定，本票不预写」。
- **C2 ADR 追加**（设计 §3.3）：ADR-0010 末尾 append-only 追加「issue #172 修订」节，登记 G1 收敛决定、D5 代理口径、wiki/raw 非规范、交付边界陈述；自陈「wire 冻结值不变，正文与既有修订节效力不变」。

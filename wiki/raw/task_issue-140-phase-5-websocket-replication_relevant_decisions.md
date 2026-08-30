# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 任务：Issue #140 — Phase 5 收口（one-Hub/two-Peer 验收 + 公共契约/规范文档对齐）。
> 冲突基准全集：`docs/adr/0001`–`0010`（10 篇，全部读取）+ `CONTEXT.md`。

## 相关 ADR

### ADR 0010 Hub/Peer WebSocket Y.Doc 复制与最终一致（accepted；本任务核心权威）

- 与本任务的关联点：本任务即 Phase 5 收口——ADR 0010 的全部正文条款与四个修订节（#134 / #133 round-2 / #161 / #172）构成本任务验收的直接依据。
- 核心条款（原文摘录）：

**静态星型拓扑**
- 「每个部署实例静态配置为 `hub` 或 `peer`；每个集群恰好一个 hub。」
- 「peer 只主动连接一个 hub；hub 不反向拨号，peer 之间不连接。」
- 「hub 与 peer 都运行完整 Registry、Runtime 和独立 Persistence，也都可接受本地 ROOT 业务写。」
- 「Phase 5 不做选举、自动晋升、多 hub、hub 级联或 peer-to-peer。」
- 「hub 故障或链路分区期间，peer 保持本地读写；恢复连接后通过 Yjs state vector/diff 合并。」
- 「本地业务写成功仍只表示 live Y.Doc 已提交且本地 dirty notification 已登记；它不等待 hub、其他 peer 或本地物理 flush。复制提供最终一致，不提供线性一致、quorum durability 或远端确认承诺。」

**Namespace identity、owner 与复制范围**
- 「Registry entry key 修订为仅 `namespaceId`。普通 `Registry.create()` 不再接受调用方指定 namespaceId，而由注入的受控 128-bit CSPRNG 生成 `ns-` + 32 位小写 hex；撞到当前 Registry entry 或目标 Persistence duplicate 时最多重试 8 次，耗尽以 `committed:false` Registry fatal 失败。」
- 「`owner.userId` 继续是 create/open 的重要本地属性和 Persistence 分区键，但不再参与 Registry entry key或 wire identity。……owner不写入同步 META，也不上 wire。」
- 「`addTarget(target)` 幂等启动或恢复 namespace」「`removeTarget(namespaceId)` 停止同步并释放复制 lease，但保留本地持久副本」「插件不持久化 target 配置，重启后的目标集合由 Host 配置负责」
- 「Hub 不配置 targets；authorization Adapter按已认证 instance identity + namespaceId返回 denied，或返回 Hub local owner与 read/submit权限；Peer不得声明 Hub owner。」

**复制谱系与 epoch**
- 「`replicationId` 是 namespace 不可变的复制谱系身份；它不同于 namespaceId 和 SCHEMA 信封 `id`。」
- 「`replicationEpoch` 是 hub 显式提升的权威代际；达到 `Number.MAX_SAFE_INTEGER` 后拒绝继续提升，不回绕。」
- 「hub 对现有 namespace 通过显式 `enableReplication()` 原子写入复制身份并登记 dirty；连接不得静默补写旧文档。」
- 「hub 提供 `bumpReplicationEpoch()`，它不替换 Y.Doc 内容，但使旧 epoch 的 peer 必须显式 reset/bootstrap。」
- 「peer 不得普通 create 一个准备从 hub 复制的同 key namespace；首次 bootstrap 继承 hub 的完整 META 身份。」
- 「身份与 epoch 相同才允许双向 state-vector reconciliation；缺失或不同进入稳定 `conflicted` 状态，绝不自动覆盖或合并。」
- 「Hub 丢失只能从 hub 自身备份恢复，不自动选择 peer 回灌。Peer 冲突恢复使用带 `expectedLocalIdentity` 的 `resetReplica()`……Persistence 为此增加受身份前置条件保护的归档 seam；WS 层不得直接读写 snapshot 文件。」

**Bootstrap 与重连**
- 「1. hub 在该 namespace 的 write sequencer 中读取复制身份并编码一次完整 `Y.encodeStateAsUpdate` 基线；2. sequencer 不等待网络发送；之后的 transaction 进入正常增量队列；3. peer 在 detached Y.Doc 应用基线、严格核对 META 身份，再通过 Persistence 的受控复制导入能力排他创建；4. Registry 打开新 Runtime generation；5. channel 立即执行 state-vector reconciliation，补齐编码基线与安装之间的竞态窗口。」
- 「本地已存在且复制身份、epoch 相同时不做替换，直接双向交换 state vector/diff 并按 Yjs 语义合并。……不执行 generation replacement。」

**NamespaceLease 与 ReplicationSession**
- 「`lease.openReplicationSession(options): ReplicationSession`……所有 Lease 都可调用该入口，不设置不可伪造 capability；Host 搭建方负责只把 Lease 交给可信代码。API 文档必须明确 raw replication 会绕过 VFSL 业务校验，不得把它暴露为普通客户端写入口。」
- 「每个 Lease 首版最多一个 duplex ReplicationSession。Session 创建时冻结 `localRole`、`remoteInstanceId`、`replicationId` 和 `replicationEpoch`，提供窄能力而不暴露 Y.Doc」
- 「Lease release 同步停止 session 接纳；channel 关闭先关闭 session，再释放 Lease。网络状态保留在 ReplicationSession/复制插件，不塞入 Runtime 的业务 capability status。」

**Trusted raw update 与现有不变量**
- 「Raw update 不执行完整 VFSL 预校验；这是对 ADR 0007/0008 普通业务写 zero-write 保证的明确例外，而不是暗中复用业务 mutation 语义。」
- 远端 update 六步：「1. lifecycle、角色、身份和 epoch gate；2. 必要的受保护字段检查；3. 一次 `Y.applyUpdate`；4. Runtime observer 产出 owned update 与受控 origin；5. `await saveDoc(handle)` 登记 dirty；6. 释放 sequencer 槽。」
- 「Hub 接收 peer update 前，在 scratch clone 上确认 update 不改变 SCHEMA，也不改变 META 中的复制身份保留字段。Peer 接收 hub update时允许同步 ROOT、SCHEMA 和允许的 META 字段。」
- 「Raw merge 后 ROOT 可能不符合当前 SCHEMA；该 update 仍被接受并继续复制，复制状态标记 `replication-unvalidated`。……Yjs 没有通用 transaction rollback，因此不得采用“先 apply、失败再回滚”，也不得虚假声称 raw update 享有验证失败零写入。」
- 「observer 失败不得回滚 transaction 或使 Runtime fatal；队列溢出只把 channel 标记为 `needs-resync`，不得阻塞 write sequencer。」

**SCHEMA 与 META 权限**
- 「ROOT 在 hub 与 peer 上均可由普通受控业务写修改，并通过复制最终合并。」
- 「SCHEMA 只允许 hub 的本地 `replaceSchema()` 修改；peer 本地调用以稳定角色权限错误拒绝。」「Hub 的 SCHEMA update 正常向 peer 单向复制。」
- 「`META.replicationId` 与 `META.replicationEpoch` 只能由 hub 的显式复制管理操作修改。」「未来其他非保留 META 字段可另行决定双向语义；raw caller 不得逐次自定义受保护字段集合。」

**Persistence degraded 语义**
- Hub degraded：「拒绝 peer→hub raw update；保留读取、身份检查和 state-vector 交换；Persistence 恢复后通过 reconciliation 补齐。」
- Peer degraded：「拒绝本地业务 mutation；仍允许已认证 hub→peer session 将 update 应用到内存；仍调用 `saveDoc(handle)` 登记最新 generation，由 Persistence retry 保存完整 live doc；Runtime closing/fatal 或 handle 失效时不得绕过；崩溃重启可能从旧 snapshot 恢复，随后由 hub 的 state-vector diff 自动补齐。」
- 「该 bypass 只属于创建时已冻结为 `hub-to-peer` 的可信 session，不能由普通业务写或 peer→hub update 获得。状态必须区分“内存已追上”与“磁盘未追上”，不得声称 peer 副本已经 durable。」

**WebSocket 复制协议与状态机**
- 「Wire不使用 channelId：每个 namespace-scope frame直接携带 namespaceId；同一连接内同一 namespace只允许一个生命周期，关闭后重开必须重建连接。」
- 「固定 envelope为 20-byte大端头：`NMCR` magic、envelope version、message type、flags、direction-local sequence、payload length和reserved。首版flags/reserved必须为零……控制payload使用显式直接依赖的lib0 canonical encoding，内层复用锁定版本的`y-protocols/sync`语义。……HELLO显式协商完整protocol version与capabilities；不得按消息数值猜版本。」
- 「Bearer token在HTTP Upgrade前认证；Upgrade后Peer发送HELLO，Hub回复HELLO_ACK并绑定Peer/Hub instance identity。每方向sequence从1严格递增，不回绕；gap、repeat或错误ACK关联关闭连接。WS ping/pong负责活性，GOAWAY提供相对drain timeout。」
- 「每个sync round由Peer以uint32 roundId发起，双方Step2完成sequenced apply + dirty后以SYNC_APPLIED确认；两个方向均确认才进入live。UPDATE_ACK同样只表示sequenced live apply + dirty notification，不表示物理flush或其他副本确认。」
- 「连接与namespace状态、消息码、payload字段、错误码、timeout、close code、backpressure和完整时序以`docs/protocols/instance-replication-v1.md`为唯一wire contract。关键恢复纪律为：连接断开即close sessions/release Leases，不保留outbox；重连重新OPEN并reconcile。Per-namespace有界队列溢出时丢弃未发送增量并进入needs-resync；connection按namespace round-robin公平发送，control/ACK保留额度，网络背压不得进入Runtime sequencer。」

**认证、授权和传输安全**
- 「WebSocket upgrade 使用 bearer token 认证实例身份；token 映射到安全文法约束的 `instanceId` 与 namespace 权限。」
- 「`instanceId` 使用 `^[a-z][a-z0-9-]{0,62}$`，仅用于连接身份、受控日志和指标，不写入 namespace META。」
- 「Hub 检查 peer 对每个 namespace 的读取和提交权限；peer 验证配置的 hub 身份，并只接受已请求且批准的 channel。」
- 「权限撤销关闭对应 channel，不必关闭整条 WS；授权结果不跨连接生命周期缓存。」
- 「Token、Yjs update、SCHEMA/ROOT 内容以及未经控制的 owner/namespace 不得出现在默认日志或高基数指标标签中。」
- 「Nomicore 首版允许应用层使用明文 `ws://`，TLS 可由网关、反向代理或 service mesh 终止。……生产部署必须在基础设施层提供 TLS，否则 bearer token 与 Y.Doc 数据会明文暴露。」

**资源限制与 observability**
- 「以下上限均为插件配置并提供安全默认值：最大 WS frame、最大单 update/diff、每连接最大 channel 数、per-channel/连接待发送字节、bootstrap/idle timeout、心跳与失联判定。普通超限以稳定错误关闭单个 channel；framing、认证等连接级错误才关闭整条连接。」
- 「复制插件提供结构化 observer seam 给日志/metrics/trace Adapter，不提供业务公共 update events。最小观测面包括：连接状态与重连、channel 状态、bootstrap/reconcile 次数和字节、updates/bytes in/out、apply/ACK latency、backpressure resync、auth/authz failure、identity/epoch conflict、peer degraded bypass apply 和稳定错误计数。」

**包、应用与生命周期**
- 「1. `@nomicore/replication-protocol`……2. `@nomicore/ws-replication`……3. `apps/yjs-server`：最小 Cordis composition root，装配 Clock、Timer、Memory/File Persistence、Registry、WS replication、配置加载和优雅停机。」
- 「在出现第二种 transport 前，不提前提取 transport-independent replication package。第三方 Host 可直接基于公开 NamespaceLease/ReplicationSession 构造自己的可信 transport。」
- 停止顺序：「复制插件停止接纳连接/target，先发送 GOAWAY 并进入真实 drain 窗口；窗口内不接纳新的 namespace 工作，只允许现有 channel 自然 CLOSE，并等待已被 Runtime 接纳的 apply 槽。全部 channel 终态可提前关闭 transport，否则网络 deadline 到达即以 WS 1001 收口，不无限等待网络 ACK。网络关闭后 Runtime barrier 仍排空停机前已接纳 apply，再异常安全地 teardown channel、close session 并尽力释放 replication lease；随后 Registry shutdown、Persistence dispose，最后停止 Timer/Clock。网络 deadline 不取消 Runtime barrier，迟到 apply 结算不得恢复 wire 输出。」

**参考实现取舍（不得照搬清单）**
- 「WS handler 直接持有或写裸 Y.Doc；全局文档 Map 和手写 GC timer；REST rebuild/hard reset 作为常规恢复；记录完整 token；缺少 namespace 级授权；非结构化授权失败；不一致控制帧编码；通过数值范围猜测协议版本。」

**后果与非目标（约束验收口径）**
- 「多机部署可在网络分区期间保持本地写可用，并在恢复后依靠 Yjs CRDT 最终收敛。」「每台机器必须使用独立 Persistence/rootDir；共享文件目录多写仍不受支持。」
- 非目标：「hub 自动选举、故障切换或从 peer 自动恢复；hub 级联、多 hub、peer-to-peer 或一个 peer 连接多个 hub；awareness/presence；客户端 y-websocket 兼容端点；跨地域强一致、全局顺序或 quorum durability；自动覆盖 identity/epoch 冲突；raw update 的完整 VFSL 校验；namespace discovery/list 和通配 selector；durable outbox、增量 WAL 或跨重连 update ID 表；shared filesystem 多写。」

**修订节：issue #134（ReplicationSession 落地冻结词汇）**
- open 拒绝码闭集：「`NAMESPACE_LEASE_RELEASED` / `REPLICATION_SESSION_INPUT_INVALID` / `REPLICATION_ROLE_MISMATCH` / `REPLICATION_SESSION_EXISTS` / `REPLICATION_NOT_ENABLED` / `RUNTIME_WRITE_DISABLED` / `REPLICATION_SESSION_UNSUPPORTED`」
- apply 拒绝码闭集：「`NAMESPACE_LEASE_RELEASED` / `REPLICATION_SESSION_CLOSED` / `REPLICATION_EPOCH_CONFLICTED` / `REPLICATION_RAW_UPDATE_INVALID` / `REPLICATION_PROTECTED_FIELDS_CHANGED` / `RUNTIME_WRITE_DISABLED`」；internal fatal 「`NSRT-FATAL-REPLICATION-APPLY-INTERNAL`」
- session status 形状：「`state('open'|'closed'|'conflicted')` + 冻结四域（`localRole`/`remoteInstanceId`/`replicationId`/`replicationEpoch`……）+ `direction('hub-to-peer'|'peer-to-hub')`……+ `currentEpoch`……+ `rootValidation('none'|'replication-unvalidated')`……+ `durability`（`memoryCaughtUp` 初值冻结 false……`diskCaughtUp: false` 字面量类型——该查询面结构性永不声称 durable）+ `observerFailures`……」
- 生命周期词义：「`closed`……与 `conflicted`（epoch fence）皆终态并释放槽位；终态后同 Lease 可再 open（新 open 冻结新 epoch……）」「`close()`：幂等 same-promise……Promise 结算为 barrier 语义……永不 reject」
- 受保护字段判据：「判据 = (a) 内容投影相等」「「删后同值重写 = 内容未变 = 允许」」「受保护字段集合 = 冻结常量……hub 侧（接收 peer→hub）`SCHEMA 全容器 + META 全键`；peer 侧（接收 hub→peer）`META 全键`（SCHEMA/ROOT 放行）」
- round 2 修订：「fanout 投递异步化……每 session 有界异步队列（容量 16 冻结常量 `FANOUT_CHANNEL_QUEUE_CAPACITY`——不可配置）+ 自延伸微任务泵（每项投递前让步 20 次……合法区间 [16,24]）……队列溢出 → 丢弃新项（保序：已入队最旧项保留）+ 置 `status.needsResync`（第 11 字段，sticky……）」
- 「bump 槽边界主动 fence（R2-1）……bump 写零投递给旧 session……终态释放 Lease session 槽位——同 Lease 可再 open 新 epoch session……**enable 槽不 fence**」
- 「Runtime close 终止 sessions（R2-2）……`fanout.terminateAll('runtime-close')`……已接纳 apply 槽无条件排空」
- 「受保护字段判据细化——结构值规范化深比较（R2-4）……primitive 直比（SameValue……）；容器白名单＝ Y.Map / Y.Array……与 plain array / plain object……键序无关（plain object 键集排序后逐键）、数组有序递归、空值/primitive SameValue；契约外容器……保守判「已改变」」
- 「committed 精确二分（R2-6）……`txStarted === false`⟹ `committed:false`；`txStarted === true`⟹ 保守 `committed:true`」
- 「成功接纳即置位（R2-7）……no-op / 重复 / 空效果 update 的成功 apply……同样置 `rootValidation = 'replication-unvalidated'` 与 `memoryCaughtUp = true`」
- 「O-4 角色注入……缺省 `'hub'`……非法值 → 构造期同步 TypeError（`NAMESPACE_REGISTRY_ROLE_INVALID`……）。peer 的 `replaceSchema`/`enableReplication`/`bumpReplicationEpoch`……以稳定角色权限错误拒绝（`REPLICATION_ROLE_PERMISSION`……）。生产 composition root（切片 9）必须显式传 role。」
- 「**META 触碰的管理写（enable/bump）字节不得经 raw 回灌对端**……**epoch 传播走控制面（切片 6 `IDENTITY_CHANGED`）**」
- 「degraded 矩阵……该 bypass 只属于创建时已冻结为 hub-to-peer 的可信 session（O-1 五条件合取……）……notifyDirty 未绑定时任意方向（含 bypass）一律拒绝」

**修订节：issue #133 round-2（reset/import 身份前置条件）**
- 「`resetReplica(expectedLocalIdentity)` 严格前置核对……双源核对，二者都必须是合规 enabled 复制身份且与 expected 完全一致。任一不匹配/disabled → `NAMESPACE_RESET_IDENTITY_MISMATCH`，零破坏性动作……」
- 「成功路径的冻结次序：preflight 与 close admission 共享同一个 Runtime FIFO reset-fence 槽……fence 槽绝不创建或等待 close barrier。」
- 「Bootstrap 导入绑定 Hub 广告身份：`importReplica` 接收 Hub 广告的 expected `{replicationId, replicationEpoch}`……格式合规但 lineage 或 epoch 不同 → `NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH`，无自动覆盖/合并、零持久化写入、零 Registry entry 登记。」
- 「dirty 事实的诚实表达……任何「dirty live 即 persisted」的表述均与本条冲突。」
- 「归档重定位的 committed 诚实……身份不匹配是运营 `NAMESPACE_RESET_FAILED`，**永不**是零破坏的 preflight 结果。」

**修订节：issue #161 round 2（ws-replication 实现层八项）**
- 「wire 契约以 `docs/protocols/instance-replication-v1.md`（§2/§17/§18 本轮扩写）为唯一权威：公共身份投影只取受信 Upgrade 身份……transport 三可选面（bufferedAmount/ping/onPong）缺面 dormant 语义与生产装配期断言；liveness 缺省 30s/10s 与 pongTimeout < pingInterval 构造期校验；背压终态口径（pipeline = queued+buffered、shed 仅 queued 侧、严格接纳 + onDataShed 显影、控制独立保留额度 maxQueuedControlBytes 缺省 8MiB、有界整轮扫描、pending handoff 计入 per-ns 溢出双口径、checkpoint = max(1, floor(ackTimeoutMs/100))、1011 终止）；peer pong 超时 close(1001) + 代际安全脱离后重连；GOAWAY/blocked/连接收口同步静默订阅先于异步 drain。」

**修订节：issue #172（Phase 5 权威契约收敛）**
- 「control 保留额度公共字段……收敛为 `maxQueuedControlBytes`。字段缺省、构造期约束、记账及耗尽语义不在 ADR 重复定义，统一以 `docs/protocols/instance-replication-v1.md` §17 为权威。」
- 「**`wiki/raw` 非规范**：源码与规范中的公共行为表述必须指向 `CONTEXT.md`、ADR 或 `docs/protocols/`；`wiki/raw/` 仅为流水线历史证据（`docs/AGENTS.md` Authority 节）。」
- 「交付边界陈述：当前切片状态与后续依赖仅由 `docs/phases/phase-5-websocket-replication.md`「交付现状与边界」节维护，ADR 不复制交付清单。……composition root 只按 protocol §21 编排包级停机顺序。」

### ADR 0006 Cordis 持久化插件——DocPersistence 接口与 doc 三条目内容布局（accepted + 三次修订）

- 与本任务的关联点：AC4「degraded / retry persistence / stale-snapshot restart」与 AC6「process restart, archive/reset, crash recovery」的持久层依据。
- 核心条款（原文摘录）：
- 「持久层 = Y.Doc 的存储引擎（store + cache 一体）……看不见 schema 语义」
- 「`saveDoc` = 脏状态通知，不是同步落盘……saveDoc 返回仅表示脏状态已登记，不构成该次写入已落盘的承诺」
- 「持久层内部调度：不设外部 flush/cron 协调器。第一次 dirty 启动 max-dirty 计时器（默认 5s）；每次 saveDoc 重置 debounce 计时器（默认 500ms）……retry 同属持久层内部，以退避策略重试直到成功或插件停止」
- 全量快照原子覆盖：「持久层内部的 flush 在触发时以 `Y.encodeStateAsUpdate(doc)` 编码完整 Y.Doc 状态，写入 `{namespaceId}.snapshot.tmp` 后以原子 rename 覆盖 `{namespaceId}.snapshot`……启动发现遗留 `.tmp` 时一律忽略并删除」
- 「v1 限制：单进程（无文件锁）、load 全量入内存」
- doc 三条目布局：「SCHEMA 信封……META 元信息……ROOT 数据根」
- issue #79 修订（degraded 拒绝面归属）：「saveDoc 是 mutation 后的 dirty notification：只要租约有效……saveDoc 必须递增 dirtyGeneration 并 resolve——entry 处于 `persistence-degraded` 不构成拒绝理由」「拒绝面归属业务编排层：Runtime（ADR 0007 NamespaceRuntime 写前 gate）在业务 mutation 前读取 `handle.getStatus()`，已 degraded 则拒绝开始新写入」
- issue #133 round-2 修订（复制导入、归档与只读身份探针）：
  - 「`importDoc(owner, docId, doc)` 是排他创建能力：duplicate 绝不覆盖（claim 排他 + `DOC_DUPLICATE`）……复制身份与 Hub 广告的完全一致核对是调用方（Registry 受信 bootstrap 编排）在所有权转移之前的职责」
  - 「`archiveDoc(owner, docId, expected)` 只允许在无有效 handle（且在途 dirty 已排空）时执行……单一谓词：`replicationId`/`replicationEpoch` 与 expected 完全一致……统一 `DOC_ARCHIVE_IDENTITY_MISMATCH`」
  - 「归档布局……`{rootDir}/archive/users/{userId}/{docId}.snapshot`……归档写经 mkdir→writeFile tmp→rename 原子提交，同名重复归档为单槽 latest-wins 原子覆盖……提交边界 = 归档写（rename/write resolve）……重试是收敛性重试」
  - 「Persistence 内部只读 committed-identity probe（`readPersistedReplicationIdentity(owner, docId)`）……不签发 handle、不建 live cell、不调用 saveDoc……I/O 失败保持 loud/typed，绝不读取 live Y.Doc 冒充持久事实」

### ADR 0008 NamespaceRuntime 读写能力与单序列器（accepted + 三次修订/增补）

- 与本任务的关联点：AC1 并发写串行化、AC3 epoch fencing / guarded reset 的 Runtime 槽序、AC4 degraded 写前 gate。
- 核心条款（原文摘录）：
- 「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer；不同 namespace 可并行。」
- 「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务。」
- 「`persistence-degraded` 阻止 ROOT、SCHEMA 以及未来所有 Y.Doc 写；它不阻止 read 或不写 Y.Doc 的 P0。gate 是瞬时观察：检查后才发生的降级不撤销已提交事务，dirty notification 仍必须登记最新 live doc。」
- 「已排队的后续写仍按 FIFO 取得槽，且不访问输入、零写入返回 `RUNTIME_WRITE_DISABLED`。」
- issue #132 增补：「仅允许 Runtime 在构造、对外发布前同步读取 `META.replicationId` 和 `META.replicationEpoch` 两个保留字段……恰一键存在、键存在而值为显式 `undefined`、格式不合法……均为持久化损坏，Runtime 构造同步拒绝」「基础 v1 方法为两个（`mutateRoot` / `replaceSchema`）；经 ADR 0010 授权的复制管理例外另加 `enableReplication()` 和 `bumpReplicationEpoch()`。四者均进入同一严格 FIFO write sequencer，完整槽序……不变」「status 字段……补 `replication`；该域仅含持久 identity/epoch 的两态联合」
- issue #93 修订：「`RUNTIME_WRITE_DISABLED` 码域澄清：该码是写停接纳/写禁用的统一码族……」
- close barrier：「首次调用同步进入 `closing`，立即停止接纳公共 read 和 write，并在队尾加入 close barrier；此前已接纳任务无条件排空，不取消、不设内部 timeout。」

### ADR 0009 NamespaceRegistry、调用方租约与 Cordis Host 生命周期（accepted + 两次修订节）

- 与本任务的关联点：AC5 ordered shutdown 的 Registry 段、Lease released 通道、AC2 bootstrap 的 Registry 编排。
- 核心条款（原文摘录）：
- issue #131 修订：「namespace identity、owner、普通 create 的 ID 生成与碰撞处理均以 ADR 0010 为唯一权威来源」「复用既有 entry 前必须核对 owner，不匹配返回 `NAMESPACE_NOT_FOUND`」「Registry 的构造能力增加必需的 `randomBytes(length): Uint8Array` 注入」
- Shutdown：「首次 shutdown 在调用栈内同步进入 `shutting-down` 并停止接纳 open/create……shutdown 取消全部 idle timer，等待此前已接纳的 lifecycle 操作结算，然后主动 close 全部 active/idle Runtime，不等待外部 lease release。」
- issue #134 修订：「`NamespaceLease` 增加第十四成员 `openReplicationSession(options)`……released 通道表新增一行：released lease 的 `openReplicationSession` 经返回 Promise 结算 `{ok:false, code:'NAMESPACE_LEASE_RELEASED', ...}`（与四写同款——resolve 不 reject）。release 同步段调用既有活跃 session 的 `close()`……release 不追踪/取消已接纳 apply 槽」
- 「`@nomicore/namespace-runtime/internal` 值导出由一键扩为两键——`createNamespaceRuntimeForRegistry` + `openReplicationSessionCoreForRegistry(runtime, options)`……消费边界不变（仍仅 Registry 生产代码……）；主 entry 值导出仍恰 `RuntimeWriteFatalError` 一键」

### ADR 0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted；Runtime/open/read 条款由 ADR 0008 部分取代）

- 与本任务的关联点：普通业务写的 zero-write 管线（AC1 的 ROOT 写走该管线）；被取代条款不构成本任务约束。
- 核心条款（原文摘录）：
- 「`applyValidatedMutation(derived, doc, mutation)`：同步完成当前 ROOT 结构/逻辑检查、在普通 JSON 副本中模拟 mutation、完整 ROOT 逻辑校验、detached 子树构造和单次 Yjs transaction……」
- 「零写入承诺覆盖所有验证失败和 detached 构造失败。Yjs observer 不得向事务调用栈抛异常……」
- 「ADR 0008 取代范围：……本文关于 logical validation、detached materialization、validated mutation、零写入与 observer no-rollback 的底层决策继续有效。」
- 注意：raw 复制写对 zero-write 的例外由 ADR 0010 明文声明（见上）。

### ADR 0001 / 0003 / 0004 / 0005（外围相关）

- ADR 0001：「本仓库是纯引擎仓库：代码库不含 schema 文本（测试 fixture 除外）。」——Phase 5 测试 fixture 使用 VFSL 文本合法。
- ADR 0003：「每个模块必须恰好声明一个名为 `ROOT` 的别名……ROOT 固定物化为 Y.Map」「Yjs 映射为 `doc.getMap('ROOT')`」——AC1「Concurrent ROOT writes」的对象即此 ROOT。
- ADR 0004/0005：类型投影与 CI regen-diff（「CI `generate --check`：全量重新生成 → diff 为空」）——AC8「diff checks」依据；本任务不改动 schema/投影面则无新增义务。
- ADR 0002：authority 规则完全出范围——本任务不涉及。

## CONTEXT.md 相关术语与惯例

- **Hub（中心实例）**：「静态星型复制拓扑中接受 peer WebSocket 连接、转发 Yjs updates、管理 SCHEMA 与复制身份的完整 Nomicore 实例；Hub 也是可接受本地 ROOT 业务写的副本，不是 ROOT 唯一写者，也不表示自动选举的 leader。」_Avoid_: master、leader、只转发而不持有完整副本的中继
- **Peer（边缘实例）**：「静态连接唯一 Hub 的完整 Nomicore 实例；使用独立 Persistence，断线时保持本地 ROOT 读写，重连后按 state vector/diff 与 Hub 双向合并。Peer 之间不直连，且不能本地修改 SCHEMA 或复制身份。」_Avoid_: slave、follower
- **namespaceId**：「Registry entry 与实例复制 wire 的唯一 namespace 身份，普通 create 由受控 128-bit CSPRNG 生成 `ns-` + 32 位小写 hex……」_Avoid_: 用户可读名称、由调用方任意指定的 ID、`(owner.userId, namespaceId)` Registry key、存储层严格全局唯一承诺
- **复制谱系（replication lineage）**：「由 `META.replicationId` 标识的 namespace 复制身份；只有 namespaceId、replicationId 与 replication epoch 全部匹配的副本才允许直接执行 Yjs state-vector reconciliation。」
- **复制代际（replication epoch）**：「`META.replicationEpoch` 中从 1 开始、只由 Hub 显式提升的安全整数；相同复制谱系但 epoch 不同的副本进入冲突状态，必须显式 reset/bootstrap，不自动覆盖或合并。」_Avoid_: 连接次数、自动选主 term、可回绕版本号
- **ReplicationSession**：「由 NamespaceLease 打开的受信任 duplex raw Yjs 复制会话；冻结本地角色、远端实例、复制谱系与 epoch……每 Lease 至多一个活跃 session；`close` 或 epoch fence 后进入终态（closed/conflicted）并释放槽位……fanout 投递有界队列溢出将 session 标记 `needs-resync`（sticky）——transport 须 reset/bootstrap。」_Avoid_: 裸 Y.Doc WS handler、绕过本地 write sequencer 的 apply、把网络状态塞进 Runtime capability status
- **复制未校验（replication-unvalidated）**：「Trusted raw Yjs update 已在 sequencer 中提交并登记 dirty，但未执行完整 VFSL ROOT 预校验的复制状态……不表示 transaction 可回滚或 raw update 享有 zero-write 保证。」_Avoid_: validated replication、apply 后校验失败自动 rollback
- **实例角色（instance role）**：「实例静态角色 hub/peer，经 Registry 构造 `options.role` 注入（可选、缺省 `'hub'`）；peer 实例的本地 replaceSchema/enableReplication/bumpReplicationEpoch 以稳定角色权限错误拒绝，session 的 localRole 必须等于实例角色。生产 composition root（phase-5 切片 9）必须显式传入。」_Avoid_: 运行期角色切换、peer 本地修改 SCHEMA 或复制身份
- **零写入（zero-write）**：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」
- **写序列器（write sequencer）**：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。」
- **停接纳（stop-acceptance）**：close 首调同步进入 `closing` 后各公共面的拒绝通道与稳定码（`RUNTIME_READ_DISABLED` / `RUNTIME_WRITE_DISABLED` 码族）。
- **信封（envelope）**：「顶层具名 `SCHEMA` Y.Map 中 `lang/version/id/text` 四个字符串键投影出的严格普通对象……」
- **ROOT**：「命名空间根别名的保留名（大小写是契约）……ROOT 固定物化为 Y.Map，Yjs 映射为 doc 根 `getMap('ROOT')`。」

---

## 设计后复审追加（SA1 设计引入的新决策点，SA8 摘录登记；裁决见 `_design_conflict_report.md`）

> 被审设计：`wiki/raw/task_issue-140-phase-5-websocket-replication_design.md`（Round 1，基线 HEAD `469ca36`）。
> 以下只摘录设计新引入/显式裁决的决策点，供 SA2/SA3/SA4/SA7 复用；SA8 逐条裁决见配套设计后冲突报告 `wiki/raw/task_issue-140-phase-5-websocket-replication_design_conflict_report.md`。

1. **reset 编排归属（AD-1）**：「reset 编排归属 composition root（app 层薄组合），不进 `@nomicore/ws-replication` 公共 API」——「本设计**显式裁决该 gap 的闭合方式 = app 层组合**（registry `resetReplica` + peer `removeTarget`/`addTarget`），不新增 `PeerReplication.resetReplica()` 公共方法」；phase-5 文档「未交付边界」对应行改写为「编排已随 app 管理动词交付（归属 composition root），ws-replication 不引入 reset 编排 API」（登记口径修正，非契约变更）。
2. **reset 编排冻结次序（AD-2）**：「`resetReplica` 先行（前置核对），成功后才 `removeTarget` → `addTarget`」；mismatch 失败时「channel 全程不动，复制继续」；成功后「**必须由 app 显式 `removeTarget` 收口 controller**……再 `addTarget` 走 §14.1 整连接重建重引导。这不是可选清理，是编排的必要后半段」。
3. **稳定码策略（AD-3）**：hub 两动词「一切 runtime/lease 层失败……折叠既有码 `write-failed`」（与 `opVerifyWrite` 折叠先例一致）；`reset-replica`「**必须透传**」registry `ResetReplicaIssue` 全联合七码（含 `NAMESPACE_RESET_IDENTITY_MISMATCH`）；「branded fatal（`NamespaceRegistryFatalError` rejection）→ catch 折叠新码 `reset-replica-failed`」；`lifecycle.ts` 的 `STABLE_OP_ERROR_CODES` append 8 个码（7 透传 + `reset-replica-failed`）。
4. **三管理动词与守卫模式（§3.1–§3.4）**：`replace-schema`（hub 专属）/ `bump-epoch`（hub 专属，成功回执含 `replicationEpoch`）/ `reset-replica`（peer 专属，请求带显式 `ownerUserId` + `expectedReplicationId`（32hex）+ `expectedReplicationEpoch`（≥1 安全整数））；G1 角色守卫（错误角色或 registry 未就绪 → `unknown-op`）；G2 参数门禁 → `invalid-op-args`；G3 known-set 门禁仅 hub 动词（`namespace-unknown`），reset 无 known-set（「owner 判定权回归 registry（① 零存在性泄露核对 + persistence owner 分区）」）；G4/G5 编排步（lease 即取即释 / registry reset + removeTarget + addTarget）。
5. **回执诚实语义（§3.1/§3.2）**：replace-schema `ok:true`「仅表示本地 SCHEMA 写槽完成（live commit + dirty 登记），**不承诺**：传播已发生……dirty 已落盘」；bump-epoch `ok:true` = epoch 提交完成，「fencing 是异步传播（上界 `ackTimeoutMs`）」——与 ADR 0010「本地业务写成功仍只表示……」诚实口径对齐。
6. **事件面（§3.5）**：「新增 app 级事件恰一个：`{"event":"replica-reset","namespaceId":"ns-…"}`（可选 `restarted:boolean`）」；「不新增其他事件」——`identity-conflicted` 等经既有 observer 直通。
7. **幂等语义（§3.3）**：「reset 成功不可重放，第二次到达返回 NOT_FOUND 是正确行为，非缺陷」。
8. **无物化等待环（§4.4）**：「管理动词不引入 F1 物化等待环」——「操作失败即诚实报告」，与 `opVerifyWrite` 瞬态重试刻意差异。
9. **整连接重建副作用（§4.5）**：re-add 触发 `requestRebuild('re-add')` 整连接重建（同 peer 的**所有** namespace channel 一并重建）——「这是 ws-replication 冻结行为……不是本设计新引入的破坏面」；部署文档显式说明该抖动。
10. **修改半径与文档对齐（§6/§8）**：改 `apps/yjs-server/src/app.ts`（dispatch +3 case + 3 handler）、`apps/yjs-server/src/lifecycle.ts`（稳定码 append）、`docs/integration/hub-peer-deployment.md`（动词表/稳定码注册表/「管理动词」小节/事件列表补 `replica-reset`）、`docs/phases/phase-5-websocket-replication.md`（交付登记 + 未交付边界行改写）；「不动：`docs/protocols/instance-replication-v1.md`（wire 契约零变化——无新帧型，IDENTITY_CHANGED 既有）、`docs/adr/**`（无新架构决策）、`CONTEXT.md`（无新引擎概念）」；DENY LIST 含全部 `packages/**`（`packages/**` 零改动）。

# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 被审对象：`wiki/raw/task_phase5-ws-namespace-sync.md`（issue #136，Phase 5 切片 6：`@nomicore/ws-replication` namespace 状态机）。
> 摘录范围：ADR 全集（`docs/adr/0001`–`0010`）+ `CONTEXT.md` + 任务指定的 Phase 5 规格基准（`docs/phases/phase-5-websocket-replication.md`、`docs/protocols/instance-replication-v1.md`）。

## 相关 ADR

### ADR-0010 Hub/Peer WebSocket Y.Doc 复制与最终一致（accepted；含 issue #134 round-2、issue #133 round-2 修订节）

- 与本任务的关联点：本任务的权威设计 ADR——切片 6（namespace 状态机）即其「WebSocket 复制协议与状态机」节及其修订节的落地；任务简报全部验收条目以此为直接依据。

- 核心条款（原文摘录）：

  **拓扑与一致性承诺**
  - 「hub 与 peer 都运行完整 Registry、Runtime 和独立 Persistence，也都可接受本地 ROOT 业务写。」
  - 「Phase 5 不做选举、自动晋升、多 hub、hub 级联或 peer-to-peer。」
  - 「本地业务写成功仍只表示 live Y.Doc 已提交且本地 dirty notification 已登记；它不等待 hub、其他 peer 或本地物理 flush。复制提供最终一致，不提供线性一致、quorum durability 或远端确认承诺。」

  **Target 与授权（AC1 依据）**
  - 「Phase 5 首版 target 为精确 `{ namespaceId, localOwner }`：`addTarget(target)` 幂等启动或恢复 namespace；`removeTarget(namespaceId)` 停止同步并释放复制 lease，但保留本地持久副本；插件不持久化 target 配置，重启后的目标集合由 Host 配置负责；」
  - 「Hub 不配置 targets；authorization Adapter按已认证 instance identity + namespaceId返回 denied，或返回 Hub local owner与 read/submit权限；Peer不得声明 Hub owner。」
  - 「声明式通配 selector 与 namespace discovery/list 留待后续，避免提前扩张 Registry/Persistence 公共面。」

  **复制谱系与 epoch（AC2 依据）**
  - 「`replicationId` 是 namespace 不可变的复制谱系身份；它不同于 namespaceId 和 SCHEMA 信封 `id`。」
  - 「`replicationEpoch` 是 hub 显式提升的权威代际；达到 `Number.MAX_SAFE_INTEGER` 后拒绝继续提升，不回绕。」
  - 「身份与 epoch 相同才允许双向 state-vector reconciliation；缺失或不同进入稳定 `conflicted` 状态，绝不自动覆盖或合并。」
  - 「peer 不得普通 create 一个准备从 hub 复制的同 key namespace；首次 bootstrap 继承 hub 的完整 META 身份。」

  **Bootstrap（AC3 依据）**
  - 「1. hub 在该 namespace 的 write sequencer 中读取复制身份并编码一次完整 `Y.encodeStateAsUpdate` 基线；2. sequencer 不等待网络发送；之后的 transaction 进入正常增量队列；3. peer 在 detached Y.Doc 应用基线、严格核对 META 身份，再通过 Persistence 的受控复制导入能力排他创建；4. Registry 打开新 Runtime generation；5. channel 立即执行 state-vector reconciliation，补齐编码基线与安装之间的竞态窗口。」
  - 「本地已存在且复制身份、epoch 相同时不做替换，直接双向交换 state vector/diff 并按 Yjs 语义合并。」

  **ReplicationSession（AC5 依据）**
  - 「`lease.openReplicationSession(options): ReplicationSession` …… 所有 Lease 都可调用该入口，不设置不可伪造 capability；Host 搭建方负责只把 Lease 交给可信代码。API 文档必须明确 raw replication 会绕过 VFSL 业务校验，不得把它暴露为普通客户端写入口。」
  - 「每个 Lease 首版最多一个 duplex ReplicationSession。Session 创建时冻结 `localRole`、`remoteInstanceId`、`replicationId` 和 `replicationEpoch`，提供窄能力而不暴露 Y.Doc：编码 state vector；按远端 state vector 编码 diff；订阅 owned `Uint8Array` 本地 updates；在唯一 write sequencer 中应用远端 update；查询独立复制状态；幂等 close。」
  - 「Lease release 同步停止 session 接纳；channel 关闭先关闭 session，再释放 Lease。网络状态保留在 ReplicationSession/复制插件，不塞入 Runtime 的业务 capability status。」

  **Trusted raw update 六步（AC5 依据）**
  - 「远端 update 仍必须进入该 namespace 的唯一 write sequencer：1. lifecycle、角色、身份和 epoch gate；2. 必要的受保护字段检查；3. 一次 `Y.applyUpdate`；4. Runtime observer 产出 owned update 与受控 origin；5. `await saveDoc(handle)` 登记 dirty；6. 释放 sequencer 槽。」
  - 「Hub 接收 peer update 前，在 scratch clone 上确认 update 不改变 SCHEMA，也不改变 META 中的复制身份保留字段。Peer 接收 hub update时允许同步 ROOT、SCHEMA 和允许的 META 字段。该检查执行角色权限，不等同于 VFSL ROOT 校验。」
  - 「Raw merge 后 ROOT 可能不符合当前 SCHEMA；该 update 仍被接受并继续复制，复制状态标记 `replication-unvalidated`。……不得采用“先 apply、失败再回滚”，也不得虚假声称 raw update 享有验证失败零写入。」
  - 「只交付复制需要的 owned bytes 和受控 origin，不暴露 live Y.Doc；observer 失败不得回滚 transaction 或使 Runtime fatal；队列溢出只把 channel 标记为 `needs-resync`，不得阻塞 write sequencer。」

  **SCHEMA 与 META 权限**
  - 「SCHEMA 只允许 hub 的本地 `replaceSchema()` 修改；peer 本地调用以稳定角色权限错误拒绝。Hub 的 SCHEMA update 正常向 peer 单向复制。`META.replicationId` 与 `META.replicationEpoch` 只能由 hub 的显式复制管理操作修改。未来其他非保留 META 字段可另行决定双向语义；raw caller 不得逐次自定义受保护字段集合。」

  **Persistence degraded（AC7「degraded behavior」依据）**
  - Hub：「拒绝 peer→hub raw update；保留读取、身份检查和 state-vector 交换；Persistence 恢复后通过 reconciliation 补齐。」
  - Peer：「拒绝本地业务 mutation；仍允许已认证 hub→peer session 将 update 应用到内存；仍调用 `saveDoc(handle)` 登记最新 generation，由 Persistence retry 保存完整 live doc；Runtime closing/fatal 或 handle 失效时不得绕过；」
  - 「该 bypass 只属于创建时已冻结为 `hub-to-peer` 的可信 session，不能由普通业务写或 peer→hub update 获得。状态必须区分“内存已追上”与“磁盘未追上”，不得声称 peer 副本已经 durable。」

  **WebSocket 复制协议与状态机（AC2–AC6 依据）**
  - 「Wire不使用 channelId：每个 namespace-scope frame直接携带 namespaceId；同一连接内同一 namespace只允许一个生命周期，关闭后重开必须重建连接。」
  - 「Namespace依次执行OPEN与身份检查、可选单frame bootstrap、双向state-vector reconciliation、live UPDATE。每个sync round由Peer以uint32 roundId发起，双方Step2完成sequenced apply + dirty后以SYNC_APPLIED确认；两个方向均确认才进入live。UPDATE_ACK同样只表示sequenced live apply + dirty notification，不表示物理flush或其他副本确认。」
  - 「连接断开即close sessions/release Leases，不保留outbox；重连重新OPEN并reconcile。Per-namespace有界队列溢出时丢弃未发送增量并进入needs-resync；connection按namespace round-robin公平发送，control/ACK保留额度，网络背压不得进入Runtime sequencer。」

  **认证、授权与脱敏（AC1/AC2 依据）**
  - 「WebSocket upgrade 使用 bearer token 认证实例身份；token 映射到安全文法约束的 `instanceId` 与 namespace 权限。」
  - 「`instanceId` 使用 `^[a-z][a-z0-9-]{0,62}$`，仅用于连接身份、受控日志和指标，不写入 namespace META。」
  - 「Hub 检查 peer 对每个 namespace 的读取和提交权限；peer 验证配置的 hub 身份，并只接受已请求且批准的 channel。」
  - 「权限撤销关闭对应 channel，不必关闭整条 WS；授权结果不跨连接生命周期缓存。」
  - 「Token、Yjs update、SCHEMA/ROOT 内容以及未经控制的 owner/namespace 不得出现在默认日志或高基数指标标签中。」

  **资源限制与 observability**
  - 「以下上限均为插件配置并提供安全默认值：最大 WS frame、最大单 update/diff、每连接最大 channel 数、per-channel/连接待发送字节、bootstrap/idle timeout、心跳与失联判定。普通超限以稳定错误关闭单个 channel；framing、认证等连接级错误才关闭整条连接。」

  **包边界（本任务交付物定义）**
  - 「`@nomicore/ws-replication`：WebSocket client/server、multiplex、认证授权、bootstrap/reconcile/live 状态机、背压和 observer；」

  **非目标（AC6「without a durable outbox」依据）**
  - 非目标清单含：「durable outbox、增量 WAL 或跨重连 update ID 表」「namespace discovery/list 和通配 selector」「raw update 的完整 VFSL 校验」「自动覆盖 identity/epoch 冲突」。

  **issue #134 round-2 修订节（冻结词汇——AC5/AC6/AC7 直接依赖）**
  - open 拒绝码闭集：「`NAMESPACE_LEASE_RELEASED` / `REPLICATION_SESSION_INPUT_INVALID` / `REPLICATION_ROLE_MISMATCH` / `REPLICATION_SESSION_EXISTS` / `REPLICATION_NOT_ENABLED` / `RUNTIME_WRITE_DISABLED` / `REPLICATION_SESSION_UNSUPPORTED`」；open 输入两域 `{ localRole, remoteInstanceId }`（instanceId 安全文法）。
  - apply 拒绝码闭集：「`NAMESPACE_LEASE_RELEASED` / `REPLICATION_SESSION_CLOSED` / `REPLICATION_EPOCH_CONFLICTED` / `REPLICATION_RAW_UPDATE_INVALID` / `REPLICATION_PROTECTED_FIELDS_CHANGED` / `RUNTIME_WRITE_DISABLED`」；写管线 internal fatal 经 `RuntimeWriteFatalError`，fatal 码 `NSRT-FATAL-REPLICATION-APPLY-INTERNAL`。
  - Session status 冻结形状：`state('open'|'closed'|'conflicted')` + 冻结四域 + `direction` + `currentEpoch` + `rootValidation('none'|'replication-unvalidated')` + `durability{memoryCaughtUp, diskCaughtUp:false}` + `observerFailures` + 第 11 字段 `needsResync`（sticky）。
  - fanout 投递异步化：「observer……内只做回声抑制谓词 → 容量检查 → owned bytes 复制……→ 入队 → 调度泵；listener 调用全部移出 transaction 栈」；「每 session 有界异步队列（容量 16 冻结常量 `FANOUT_CHANNEL_QUEUE_CAPACITY`——不可配置）」；「队列溢出 → 丢弃新项（保序：已入队最旧项保留）+ 置 `status.needsResync`（sticky）」；WS 发送队列/连接级背压属切片 6。
  - epoch fence：「bump 槽 E5.5 …… 经 `fanout.fenceStale(replicationId, nextEpoch)` 主动 fence：凡 channel 冻结 `(replicationId, replicationEpoch)` 与传入不等……→ `finalize('conflicted')`」；「epoch 传播走控制面（切片 6 `IDENTITY_CHANGED`），不依赖 raw update 携带。」
  - Runtime close 终止 sessions：「Runtime `close()` 同步段 …… 经 `fanout.terminateAll('runtime-close')` 逐 channel `finalize('closed', 'runtime-close')`……已接纳 apply 槽无条件排空」；其后 apply 拒绝映射 `RUNTIME_WRITE_DISABLED`；`encodeStateVector`/`encodeDiff` 终态确定同步 throw `ReplicationSessionClosedError`。
  - 受保护字段判据：「受保护字段集合 = 冻结常量（raw caller 不得逐次自定义，L121）：hub 侧（接收 peer→hub）`SCHEMA 全容器 + META 全键`；peer 侧（接收 hub→peer）`META 全键`（SCHEMA/ROOT 放行——L105）；peer 允许的 META 白名单首版 = 空集」；判据 = 内容投影相等（规范化深比较；「删后同值重写 = 内容未变 = 允许」）。
  - 角色注入（O-4）：「实例静态角色经 Registry 构造 `options.role`……注入；可选、缺省 `'hub'`……；peer 的 `replaceSchema`/`enableReplication`/`bumpReplicationEpoch` 在 Lease 接纳段以稳定角色权限错误拒绝（`REPLICATION_ROLE_PERMISSION`……）；session open 校验 `options.localRole === 实例 role`。」

  **issue #133 round-2 修订节（bootstrap 导入身份绑定——AC3 依据）**
  - 「`importReplica` 接收 Hub 广告的 expected `{replicationId, replicationEpoch}`（第 4 参数；来源必须是认证 Hub 广告的可靠绑定，绝不可用文档自身值替代）。在 `importDoc` resolve/所有权转移之前校验：detached 文档 `META.docId`、复制事实合规性、与广告身份的完全一致。格式合规但 lineage 或 epoch 不同 → `NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH`，无自动覆盖/合并、零持久化写入、零 Registry entry 登记。」
  - 「dirty notification 不是 durable（ADR-0008）；live 已 bump、持久化仍为旧 epoch 的严格双源不一致是有意的拒绝条件（严格口径）……」

### ADR-0009 NamespaceRegistry、调用方租约与 Cordis Host 生命周期（accepted；含 #131、#134 修订节）

- 与本任务的关联点：ws-replication transport 只经 NamespaceLease/ReplicationSession 取得能力；owner 核对与 release/close 编排在此 ADR。
- 核心条款（原文摘录）：
  - 「成功 open/create 返回独立 `NamespaceLease`。Lease 是调用方唯一能力入口，代理 Runtime 除 `close()` 外的同步读取、投影、status、ROOT mutation 和 SCHEMA replacement；不公开裸 Runtime、DocHandle、Y.Doc 或 live Yjs 引用。」
  - 「首次 `release()` 在调用栈内同步将 lease 标记为 released，之后不再接纳新操作。重复 release 返回 exact same Promise。…… release 不追踪或等待此前已经由 Runtime 接纳的写；这些写仍由 Runtime sequencer 管理。」
  - #131 修订节：「复用既有 entry 前必须核对 owner，不匹配返回 `NAMESPACE_NOT_FOUND`。」（Registry entry key 已改为仅 namespaceId）
  - #134 修订节：「`NamespaceLease` 增加第十四成员 `openReplicationSession(options)`……released lease 的 `openReplicationSession` 经返回 Promise 结算 `{ok:false, code:'NAMESPACE_LEASE_RELEASED', message: NAMESPACE_LEASE_RELEASED_MESSAGE}`（与四写同款——resolve 不 reject）。release 同步段调用既有活跃 session 的 `close()`（停接纳 + 退订 + 释放 slot；零新增方法面）；release 不追踪/取消已接纳 apply 槽。」

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted；含 #93、#132 修订节）

- 与本任务的关联点：远端 apply 进入唯一 write sequencer 的槽序、复制管理写、停接纳与 fatal 通道均在此冻结。
- 核心条款（原文摘录）：
  - 「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer；不同 namespace 可并行。」
  - 「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务。」
  - 「`persistence-degraded` 阻止 ROOT、SCHEMA 以及未来所有 Y.Doc 写；它不阻止 read 或不写 Y.Doc 的 P0。」
  - close barrier：「首次调用同步进入 `closing`，立即停止接纳公共 read 和 write，并在队尾加入 close barrier；此前已接纳任务无条件排空，不取消、不设内部 timeout。」
  - #132 修订节：「基础 v1 方法为两个（`mutateRoot` / `replaceSchema`）；经 ADR 0010 授权的复制管理例外另加 `enableReplication()` 和 `bumpReplicationEpoch()`。四者均进入同一严格 FIFO write sequencer，完整槽序（lifecycle/fatal gate → `DocHandle.getStatus()` writable gate → 输入校验 → 领域事实读取 → 单 Yjs transaction → 同步投影 → `await notifyDirty()`）不变。」
  - #132 修订节 status：「该域仅含持久 identity/epoch 的两态联合（`{state:'disabled'}` 或 `{state:'enabled'; replicationId; replicationEpoch}`），不含 session、网络、队列或 sync 状态。」
  - #93 修订节：「`RUNTIME_WRITE_DISABLED` 码域澄清：该码是写停接纳/写禁用的统一码族，覆盖四类零写入、零输入访问的拒绝……」

### ADR-0006 Cordis 持久化插件（accepted；含 #64/#79/#131 对齐/#133 修订节）

- 与本任务的关联点：bootstrap 的排他导入与归档 seam（#133 交付，本任务经 Registry 复用）；dirty-not-durable 边界。
- 核心条款（原文摘录）：
  - 「`saveDoc` = 脏状态通知，不是同步落盘：……saveDoc 返回仅表示脏状态已登记，不构成该次写入已落盘的承诺。」
  - #133 修订节：「`importDoc(owner, docId, doc)` 是排他创建能力：duplicate 绝不覆盖（claim 排他 + `DOC_DUPLICATE`）；成功 = 主快照提交后才签发 handle/ownership；本层只校验 `META.docId === docId`（违约 → `DocImportIdentityError`）。复制身份与 Hub 广告的完全一致核对是调用方（Registry 受信 bootstrap 编排）在所有权转移之前的职责——Persistence 不是、也不得成为 Hub 广告授权/复制策略引擎。」
  - #133 修订节：「`archiveDoc(owner, docId, expected)` 只允许在无有效 handle（且在途 dirty 已排空）时执行……单一谓词：`replicationId`/`replicationEpoch` 与 expected 完全一致……」

### ADR-0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted；Runtime/open/read 条款由 ADR 0008 部分取代）

- 与本任务的关联点：业务写 zero-write 基线与 raw update 受控通道的原始预留；ADR 0010 已决定该通道为 ReplicationSession。
- 核心条款（原文摘录）：
  - 「NamespaceRuntime 将来按 namespace 串行化所有业务写入……业务调用方不得取得可写 Yjs 引用或绕过该入口；未来原始 Yjs update 必须另设受控验证通道。」
  - ADR 0010 对此的裁决（取代关系节）：「通道位于 NamespaceLease 的 ReplicationSession，并继续进入唯一 write sequencer；但 trusted raw update 明确不继承普通业务写的完整 VFSL zero-write 保证。」

### ADR-0001 ~ ADR-0005（均 accepted）

- 与本任务的关联点：无直接关联——本任务不触及 VFSL 真相源（0001）、authority 范围（0002）、求值器/ROOT 约定（0003）、类型投影（0004）、投影生成管线与 domains 布局（0005）。SCHEMA 信封只作为受保护字段被复制层整体保护/放行，不解释其内容。

## CONTEXT.md 相关术语与惯例

- **Hub（中心实例）**：「静态星型复制拓扑中接受 peer WebSocket 连接、转发 Yjs updates、管理 SCHEMA 与复制身份的完整 Nomicore 实例；Hub 也是可接受本地 ROOT 业务写的副本，不是 ROOT 唯一写者，也不表示自动选举的 leader。」_Avoid_: master、leader、只转发而不持有完整副本的中继
- **Peer（边缘实例）**：「静态连接唯一 Hub 的完整 Nomicore 实例；使用独立 Persistence，断线时保持本地 ROOT 读写，重连后按 state vector/diff 与 Hub 双向合并。Peer 之间不直连，且不能本地修改 SCHEMA 或复制身份。」_Avoid_: slave、follower
- **namespaceId**：「Registry entry 与实例复制 wire 的唯一 namespace 身份，普通 create 由受控 128-bit CSPRNG 生成 `ns-` + 32 位小写 hex；……owner 是 open/create 的本地重要属性但不上 wire，也不参与复制身份；不同实例可为同一 namespaceId 使用不同 owner。」_Avoid_: `(owner.userId, namespaceId)` Registry key
- **复制谱系（replication lineage）**：「由 `META.replicationId` 标识的 namespace 复制身份；只有 namespaceId、replicationId 与 replication epoch 全部匹配的副本才允许直接执行 Yjs state-vector reconciliation。replicationId 是 128-bit 随机值的固定小写 hex，不等同于 namespaceId 或 SCHEMA 信封 `id`。」_Avoid_: 仅凭 namespaceId 判断同源、把 owner 纳入 wire identity
- **复制代际（replication epoch）**：「`META.replicationEpoch` 中从 1 开始、只由 Hub 显式提升的安全整数；相同复制谱系但 epoch 不同的副本进入冲突状态，必须显式 reset/bootstrap，不自动覆盖或合并。」_Avoid_: 连接次数、自动选主 term、可回绕版本号
- **ReplicationSession**：「由 NamespaceLease 打开的受信任 duplex raw Yjs 复制会话；冻结本地角色、远端实例、复制谱系与 epoch，提供 state vector（`encodeStateVector`）、diff（`encodeDiff`）、owned update subscription（`subscribeOwnedUpdates`）和进入本地唯一 write sequencer 的 trusted apply（`applyRemoteUpdate`）、独立状态（`getStatus`）与幂等 close（`close`），但不暴露 live Y.Doc。每 Lease 至多一个活跃 session；……fanout 投递有界队列溢出将 session 标记 `needs-resync`（sticky）——transport 须 reset/bootstrap。」_Avoid_: 裸 Y.Doc WS handler、绕过本地 write sequencer 的 apply、把网络状态塞进 Runtime capability status
- **复制未校验（replication-unvalidated）**：「Trusted raw Yjs update 已在 sequencer 中提交并登记 dirty，但未执行完整 VFSL ROOT 预校验的复制状态；它可能导致后续普通业务写因当前完整 ROOT 不合法而失败，不表示 transaction 可回滚或 raw update 享有 zero-write 保证。」_Avoid_: validated replication、apply 后校验失败自动 rollback
- **实例角色（instance role）**：「实例静态角色 hub/peer，经 Registry 构造 `options.role` 注入（可选、缺省 `'hub'`）；peer 实例的本地 replaceSchema/enableReplication/bumpReplicationEpoch 以稳定角色权限错误拒绝，session 的 localRole 必须等于实例角色。生产 composition root（phase-5 切片 9）必须显式传入。」_Avoid_: 运行期角色切换、peer 本地修改 SCHEMA 或复制身份
- **写序列器（write sequencer）**：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。」
- **停接纳（stop-acceptance）**（Runtime close 域——socket loss/cleanup race 测试的相关背景）：「close 首次调用同步进入 `closing` 后，capability 槽立即停止接纳新调用……close 前已接纳任务仍无条件排空。」

## Phase 5 规格基准（任务指定的裁决/验收基准）

### docs/phases/phase-5-websocket-replication.md（切片 6 及验收基准）

- 切片 6 原文要求：
  - 「Peer target为精确`{ namespaceId, localOwner }`并支持幂等add/remove；wire不传owner。」
  - 「实现connection、namespace与sync-round状态机及blocked/backoff/full-jitter恢复。」
  - 「本地不存在时单frame完整snapshot bootstrap；同源时Peer发起双向state-vector round。」
  - 「identity/epoch mismatch稳定冲突且不自动覆盖；在线epoch bump发送IDENTITY_CHANGED fencing。」
  - 「Origin回声抑制、专用ACK、RESYNC_REQUIRED和Hub单observer多session fan-out。」
  - 「Per-namespace滑动窗口、有界队列、round-robin公平调度与connection control保留额度；溢出丢弃未发送增量并重新diff，不阻塞Runtime sequencer。」
- Namespace 状态机（验收锚）：「targeted → opening → bootstrapping | reconciling → live …… → closing → closed；identity/epoch mismatch → conflicted；terminal failure → failed」；「每轮reconciliation由Peer以syncRoundId发起，两个方向的Step2都收到SYNC_APPLIED才进入live。完整转移、timeout、ERROR终态与GOAWAY规则以protocol v1规范为准。」
- 必须通过的场景（本任务相关子集）：#3「本地不存在的新 peer 通过完整 update bootstrap，并补齐 bootstrap 竞态窗口」；#4「replicationId 或 epoch 不一致稳定拒绝且不覆盖本地副本」；#5「peer→hub SCHEMA 或复制身份 META 篡改在 live apply 前拒绝」；#7/#8 degraded；#10「慢消费者触发 `needs-resync`，不阻塞本地业务 write sequencer」；#11「重复、乱序和重连 update 依靠 Yjs 幂等/state vector 收敛」；#12 授权与脱敏；#13 上限隔离；#16「优雅停机完成已被 Runtime 接纳的 apply，不无限等待网络 ACK」。
- 测试 seam：「WS 层使用内存双端 transport/fake socket 覆盖连接与 channel 状态机，不用真实时间等待」；「故障注入覆盖丢帧、重复帧、乱序、连接中断、队列溢出、flush failure、认证撤销和 shutdown race」。
- 非目标（与 ADR 0010 同源）：durable outbox、identity/epoch conflict 自动覆盖、raw update VFSL 校验、namespace list/discovery 等。

### docs/protocols/instance-replication-v1.md（ADR 0010 指定的唯一 wire contract）

- 不变量（§1，摘录）：「3. 每个 namespace frame 直接携带 namespaceId，不使用 channelId、owner 或 session nonce。」「4. 同一连接内，同一 namespaceId 只允许一个生命周期；closed、conflicted 或 failed 后不得重新 open，重新 add 必须重建连接。」「7. 所有远端 apply 进入本地 namespace 的唯一 write sequencer，并在槽内完成 dirty notification。」「8. ACK 表示 sequenced live apply + dirty notification，不表示物理 flush、其他副本确认或 quorum durability。」「9. Origin 只用于回声抑制；重连、bootstrap 竞态和队列丢弃均由 state-vector reconciliation 修复。」「12. Peer→Hub update 在 live apply 前必须通过 SCHEMA 与复制身份 META 保护检查。」
- OPEN（§7）：「Hub 必须先 authorization，再从 authorization 结果取得 local owner并调用 Registry open，最后读取 Hub replication identity。未授权不得泄露 namespace 是否存在；只有已获访问权的 Peer才可收到 `NAMESPACE_NOT_FOUND` 或 `REPLICATION_NOT_ENABLED`。」；「同一连接内 opening/open 的重复 OPEN 合流底层操作，但每个请求都收到 OPEN_OK 或 ERROR；closed/conflicted/failed 后返回 `NAMESPACE_REOPEN_REQUIRES_RECONNECT`。」；OPEN_OK `mode: 0=bootstrap, 1=reconcile`「必须与 OPEN 声明和身份比较一致」。
- Bootstrap（§8）：单 frame 完整 `Y.encodeStateAsUpdate`「不分块」；「超过 `maxBootstrapBytes` 返回 `BOOTSTRAP_TOO_LARGE` 并终止 namespace；v1 不分块、不 fallback HTTP」；「Peer 在 detached Y.Doc apply snapshot、核对 namespace META identity、以 target 的 local owner执行排他复制导入，再打开 Lease/ReplicationSession。并发 duplicate 不覆盖、不自动改为 merge，返回 `BOOTSTRAP_FAILED`」；「ACK 只表示本地导入和 Runtime/Session 建立完成。Peer 随后以新的 syncRoundId 发起双向 reconciliation」。
- Reconciliation（§9）：「Peer 的首个 Step1 隐式开始 round；Hub 不自行开始 round。Hub 收到有效新 round 后发送自己的 Step1。每方向每 round 只允许一个 Step1。」；「两位都为 true，且未发生 overflow、identity变化或 resync request，才能进入 live。空 diff同样走完整 Step2/Applied。」；「重复、错序、错误 round、错误 related sequence 或错误 namespace均为 `SYNC_STATE_VIOLATION`。控制帧不靠 Yjs 幂等性静默吞掉。」；RESYNC_REQUIRED「任一端可声明当前增量连续性作废，但始终由 Peer用新 roundId 发起下一轮。发出后不再发送新 UPDATE；已接纳 update 正常 apply/ACK。」
- Live（§10）：「普通 UPDATE 只允许在 live 状态发送。Reconcile期间本地 updates进入有界未发送队列；round完成后发送。」；Hub 接收四步：「1. 在同一 sequencer槽完成 epoch/role gate、scratch保护检查、live apply和 dirty notification；2. 发 UPDATE_ACK 给 A；3. Runtime 单一 observer fan-out resulting update给其他 live Peer sessions；4. 不回送来源 session。」；「每 namespace每方向采用可配置滑动窗口，默认 32 个 in-flight UPDATE。窗口满只暂停该 namespace发送，不阻塞本地写或其他 namespace。」；「Unknown、类型不匹配或 namespace不匹配的 ackedSequence 属 connection fatal `ACK_STATE_VIOLATION`。」
- Identity fencing（§11）：「Hub epoch bump进入同一 write sequencer。……Hub发送 IDENTITY_CHANGED并关闭该 namespace session，Peer进入 conflicted，不把该 META update当普通 live UPDATE继续运行。」
- Close（§12）：「Receiver同步停止 session接纳，已被 sequencer接纳的 apply无条件完成，然后 close session、release Lease并发 CLOSE_OK。不得在 sequencer槽内 await cleanup。」；「正常 close不等待丢失的 UPDATE_ACK；下次连接通过 state vector修复。」
- Namespace 错误注册表（§13.2，终态映射）：`NAMESPACE_UNAUTHORIZED`/`NAMESPACE_NOT_FOUND`/`REPLICATION_NOT_ENABLED` → failed（config）；`REPLICATION_ID_MISMATCH`/`REPLICATION_EPOCH_MISMATCH` → conflicted（reset）；`SYNC_STATE_VIOLATION`/`PROTECTED_FIELD_MUTATION`/`ROLE_VIOLATION` → failed；`PERSISTENCE_DEGRADED` → failed（recovery）；`ACK_TIMEOUT` → needs-resync（resync）；「Wire永不携带 owner、token、SCHEMA、ROOT、update、stack、原始 cause或异常 message。」
- Namespace 状态机与 socket loss（§16）：「socket断开时，控制器投影为 disconnected，立即停止 session、排空已接纳 apply并release Lease；target保留」；「断线期间不维持 update outbox或subscription，重连后从当前 Y.Doc state vector恢复」；「Target controller用单一生命周期队列串行化 removeTarget、socket close、session close与Lease release。removeTarget同步把 intent标记为 removed；cleanup调用合流到同一个 Promise。」；「Cleanup只在 apply promises settle后执行，绝不在 sequencer槽内 await session/Lease/Registry shutdown。」
- 背压与上限（§17）：配置上限清单与启动期响亮校验（`maxQueuedUpdateBytes >= maxUpdateBytes` 等）；「未发送队列任一上限超出：丢弃全部未发送增量，标记 needs-resync，停止新 UPDATE。」；「Connection使用 per-namespace队列和 round-robin：control/error/ACK高优先级，data每轮每 namespace最多一个。」；「不得运行时 clamp。」
- Timeout（§18）：「Open/bootstrap/reconcile/close/ACK timeout只收口 namespace；ACK timeout不重发同一 UPDATE，而进入 needs-resync并由新 state-vector round修复。」
- Authorization（§19）：「authorizeNamespace(instanceIdentity, namespaceId) → denied | allowed { localOwner, permissions: { read, submit } }」；「Remote Peer不能声明或影响 Hub owner。」；「授权只在 OPEN时检查；Adapter可选提供结构化 revoke事件……Peer只接受已配置target且已发 OPEN的 namespace；未知 key返回 `TARGET_NOT_REQUESTED`，不自动创建。」
- Degraded（§20）：「Hub degraded：拒绝 peer update，返回 `PERSISTENCE_DEGRADED`，保留读取和状态交换，恢复后 reconciliation。」；Peer→Hub 保护检查五步（scratch clone → apply → 比较 → live apply → dirty）与三类错误（`PROTECTED_FIELD_MUTATION`/`APPLY_FAILED`/INTERNAL_ERROR，live 零写入）。
- 停机（§21）：六步停机顺序与「Drain不无限等待网络ACK。不得从notifier或sequencer槽内await Runtime close、Lease release或Registry shutdown。」

## 设计后复审追加：设计引入的新决策点（SA1 设计 `task_phase5-ws-namespace-sync_design.md`；SA8 只登记，不裁决）

> 以下为设计新引入、基准（ADR/CONTEXT/规格）未明文规定的决策点，供 SA2 评审 / SA3 实现 / SA4/SA7 审查复用。
> **R2 同步（2026-08-30）**：原第 1/2 条的 ⚠ evolution 冲突（CP-1/CP-2）已按总控裁决「维持 ADR 字面」在设计 R2 修订中消解，两条已改写为 ADR 字面定案形态；第 16 条扩编为 §18.11 对齐清单（7 项）。R2 复审 verdict `clear`，详见 `task_phase5-ws-namespace-sync_design_conflict_report.md` R2 复审节。

1. **入站序列纪律（R2 定案：ADR 字面）**（设计 §4.1/§18.8，R2 修订）：入站帧 sequence 严格等于期望值（last+1）；**gap、repeat/回退一律 `SEQUENCE_VIOLATION` connection fatal**——framing 可信时 best-effort connection ERROR 后 `close(1002)`（协议 §14）；peer → `blocked`（协议 §15.1「1002/1008：blocked」），hub → `closed`。依据 ADR 0010 L147「gap、repeat或错误ACK关联关闭连接」+ 协议 §1.2「对端严格按期望值接收」字面（R1 CP-1 经总控裁决消解）。「错误 ACK 关联」= never-sent ackedSequence → `ACK_STATE_VIOLATION`；曾发出的迟到 ACK（zombie）良性 no-op。注入丢帧后的收敛经「fatal close → 重连/re-add 重建 → 重新 OPEN/reconcile」。
2. **溢出恢复拓扑（R2 定案：同连接新 round）**（设计 §10.5/§4.3/§5.1/§10.6/§18.7，R2 修订）：队列溢出与 ACK-timeout **统一为同连接恢复**——丢弃全部未发送 + needs-resync + RESYNC_REQUIRED + 停发新 UPDATE；已发送窗口等 ACK 或连接断开（协议 §17 字面）；窗口收口后 Peer 在**同一连接**以 roundId+1 发起新 round；hub 收 RESYNC 仅作废单 channel（ADR 0010 L165 单 channel 粒度）。**整连接重建的唯一入口 = §14.1 重开矩阵**（协议 §16「重新 add 必须重建连接」）——溢出不再是重建触发器（R1 CP-2 经总控裁决消解）。
3. **roundId 计数器 per-target 跨连接持久**（设计 §14.2）：不随连接重置、不回绕（uint32 溢出 → 响亮 INTERNAL_ERROR）；hub 新连接按「严格大于 lastRound（初值 0）」接受任意首 round；进程重启丢弃（协议 §21 相容）。
4. **溢出判据含 in-flight**（设计 §10.2/§18.5）：`pending = inFlight.size + queued.length`，`pending ≥ maxQueuedUpdateCount` 或字节数超 `maxQueuedUpdateBytes` → 丢弃全部 queued + 置 needs-resync + 发 RESYNC_REQUIRED（保守早触发，未发送队列自身永不超上限；自愿 resync 为协议 §9.4「任一端可声明」所允许）。
5. **submit 门仅作用于 UPDATE**（设计 §11.1.2/§18.1）：`permissions.submit === false` → UPDATE 拒 `NAMESPACE_UNAUTHORIZED`（零写入零 ACK）；`SYNC_STEP2` 不设 submit 门（submit:false peer 可 bootstrap→reconcile→live）。基准未规定 submit 执行点——为解释性决策（重连 reconcile 的 Step2 可传播离线写的语义缺口已登记观察，建议 SA2/Jim 关注）。
6. **OPEN_OK 前 UPDATE → `NAMESPACE_STATE_VIOLATION`**（设计 §11.1.1/§18.2）：非 live 态一律状态门拒绝（opening/bootstrapping/reconciling 均非 live）。
7. **RESYNC_REQUIRED 触发面 = 发端本地未发送队列溢出**（设计 §10.2/§18.4）：peer 发端声明；hub 溢出同机制可声明（§10.6）；恢复 round 恒由 peer 以新 roundId 发起。
8. **fence-watchdog 双节奏检测**（设计 §12）：hub 侧以「微任务有界探测（每 8 让步一次、预算 4096 让步）+ 每 `ackTimeoutMs` timer 空闲节奏」轮询 `session.getStatus()`（`state!=='open'` 或 `currentEpoch!==replicationEpoch` 即命中）→ 发**单帧** IDENTITY_CHANGED（当前身份）→ hub 通道 conflicted + cleanup；peer 收到 → conflicted、零 apply、本地 epoch 不变。机制成因：session 层无 fence 回调面（E5.5′ fence 在投递前清队，bump 字节不达 listener——源码核实 replication-write.ts E5.5′/replication-session.ts finalize）。演进位 R-1：session 增 append-only 终态回调后 watchdog 退化事件驱动。
9. **timeout 本地收口零 wire 帧**（设计 §5.1）：open/bootstrap/reconcile/close timeout 只置终态+清 timer+cleanup，不发 ERROR 帧（对端靠自身 timer/连接关闭收口）；ACK timeout 例外——needs-resync + 同连接新 round（§10.4）。
10. **ACK 簿记**（设计 §10.3/§10.4）：ACK-timeout 弃置的 in-flight 序列转 `zombieSeqs`，迟到 ACK 良性 no-op；从未发出的序列 → `ACK_STATE_VIOLATION` connection fatal；接收端重复 UPDATE 照常 apply+ACK（Yjs 幂等）。
11. **peer 本地无复制身份（disabled 副本）→ 本地 failed，零 wire 帧**（设计 §5.2）：拒绝静默降级为 bootstrap 尝试（依据 ADR 0010「peer 不得普通 create……」；bootstrap 亦会在 importReplica 处 `NAMESPACE_ALREADY_EXISTS`）。
12. **bootstrap 基线编码 = `session.encodeDiff(空 sv)`**（设计 §8）：即 `Y.encodeStateAsUpdate(doc)` 全量（SA8 源码核实：replication-session.ts L413-418 同步直读 live doc、不入 sequencer——见设计冲突报告观察 O-1）；「编码后-安装前」竞态由 BOOTSTRAP_ACK 后强制 round 1 修复（ADR 0010 L67 既有机制）。
13. **degraded 判别表**（设计 §11.1）：`RUNTIME_WRITE_DISABLED` 拒绝后读自有 lease `getStatus().runtime` 旁证——`lifecycle==='ready' ∧ fatal===null` → `PERSISTENCE_DEGRADED`；否则 → `INTERNAL_ERROR`（不解析 message 文本）；peer 侧 hub-to-peer degraded bypass 由 session 层承载，本包零特殊分支。
14. **重复 OPEN 合流**（设计 §7.0a）：opening/open 态的重复 OPEN 挂到在途 open 操作的 Promise 链（authorize/Registry open 恰一次），每个请求都收到 OPEN_OK 或 ERROR（协议 §7.1 既有要求的实现形态）。
15. **连接级水位/排队字节以内部记账实现**（设计 §4.4/R-8）：DuplexTransport 无 `bufferedAmount` 面；真实 WS 背压接线登记为切片 7 演进位。
16. **冻结测试对齐清单（R2 扩编：设计 §18.11，7 项，移交 SA6；总控已裁决修订）**：#1 = 原 §18.10 算术冲突（AC1 幂等尾断言 wires>1 ∧ HELLO×2 联立无解 → 改 `peerFramesAll` 基面或当前 wire 计 1）；#2/#6/#7 = CP-1 回退后 3 处丢帧用例（hub ERROR 帧携 gap → peer 终态改 `disconnected`+`blocked`，或去 drop 保留 `failed`）；#4 = ACK-timeout 用例改跨连接收敛形态（fatal → blocked → re-add 重建 → live）；#5 = 正常 close 用例去丢帧化（saveGate 表达「不等丢失 ACK」）；#3 = CP-2 回退后溢出计数断言（同连接 SYNC_STEP1 = [r1, r2] 两帧）。SA7 动态验证口径：**清单内豁免、清单外全绿**。

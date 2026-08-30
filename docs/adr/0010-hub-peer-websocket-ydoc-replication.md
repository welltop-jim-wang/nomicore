# ADR 0010：Hub/Peer WebSocket Y.Doc 复制与最终一致

日期：2026-08-27
状态：已接受（Phase 5 多实例复制设计）

## 背景

ADR 0006—0009 已建立单进程内的 Persistence、唯一 NamespaceRuntime/write sequencer、NamespaceRegistry 和调用方租约。当前边界明确不含 raw Yjs sync、WS transport 或分布式协调；FilePersistence 也只允许单进程独占一个 rootDir。

下一阶段要求在不同机器部署多个完整 Nomicore 实例。实例间形成星型 WebSocket 拓扑：一个中心实例与多个边缘实例相连，边缘实例之间不直连；每台机器使用自己的 Persistence，并使所选 namespace 的完整 Y.Doc 最终收敛。

传统 master/slave 或 leader/follower 会暗示中心节点是唯一写者或存在选举。本设计允许每个实例接受 ROOT 业务写，因此采用 **hub/peer** 术语：hub 是通信中心，peer 是主动连接 hub 的完整副本实例。

## 决策

### 静态星型拓扑

- 每个部署实例静态配置为 `hub` 或 `peer`；每个集群恰好一个 hub。
- peer 只主动连接一个 hub；hub 不反向拨号，peer 之间不连接。
- hub 与 peer 都运行完整 Registry、Runtime 和独立 Persistence，也都可接受本地 ROOT 业务写。
- Phase 5 不做选举、自动晋升、多 hub、hub 级联或 peer-to-peer。
- hub 故障或链路分区期间，peer 保持本地读写；恢复连接后通过 Yjs state vector/diff 合并。

本地业务写成功仍只表示 live Y.Doc 已提交且本地 dirty notification 已登记；它不等待 hub、其他 peer 或本地物理 flush。复制提供最终一致，不提供线性一致、quorum durability 或远端确认承诺。

### Namespace identity、owner 与复制范围

Registry entry key 修订为仅 `namespaceId`。普通 `Registry.create()` 不再接受调用方指定 namespaceId，而由注入的受控 128-bit CSPRNG 生成 `ns-` + 32 位小写 hex；撞到当前 Registry entry 或目标 Persistence duplicate 时最多重试 8 次，耗尽以 `committed:false` Registry fatal 失败。复制 bootstrap 使用内部受信任导入保留 Hub namespaceId，不是普通 create。该身份是概率全局唯一；Persistence 不维护跨 owner 全局 catalog或原子唯一约束。

`owner.userId` 继续是 create/open 的重要本地属性和 Persistence 分区键，但不再参与 Registry entry key或 wire identity。普通 open仍显式接收 owner并在复用 active entry前核对；不匹配统一返回 `NAMESPACE_NOT_FOUND`。Hub 与 Peer可为同一 namespaceId使用不同 owner，owner不写入同步 META，也不上 wire。

同步目标是 peer复制插件的配置或运行时参数，不写死为全量复制。Phase 5 首版 target 为精确 `{ namespaceId, localOwner }`：

- `addTarget(target)` 幂等启动或恢复 namespace；
- `removeTarget(namespaceId)` 停止同步并释放复制 lease，但保留本地持久副本；
- 插件不持久化 target 配置，重启后的目标集合由 Host 配置负责；
- Hub 不配置 targets；authorization Adapter按已认证 instance identity + namespaceId返回 denied，或返回 Hub local owner与 read/submit权限；Peer不得声明 Hub owner。

声明式通配 selector 与 namespace discovery/list 留待后续，避免提前扩张 Registry/Persistence 公共面。

### 复制谱系与 epoch

`META` 增加两个复制层保留字段：

```text
replicationId     128-bit 随机值，编码为 32 个小写十六进制字符
replicationEpoch  从 1 开始的十进制安全整数
```

- `replicationId` 是 namespace 不可变的复制谱系身份；它不同于 namespaceId 和 SCHEMA 信封 `id`。
- `replicationEpoch` 是 hub 显式提升的权威代际；达到 `Number.MAX_SAFE_INTEGER` 后拒绝继续提升，不回绕。
- hub 对现有 namespace 通过显式 `enableReplication()` 原子写入复制身份并登记 dirty；连接不得静默补写旧文档。
- hub 提供 `bumpReplicationEpoch()`，它不替换 Y.Doc 内容，但使旧 epoch 的 peer 必须显式 reset/bootstrap。
- peer 不得普通 create 一个准备从 hub 复制的同 key namespace；首次 bootstrap 继承 hub 的完整 META 身份。
- 身份与 epoch 相同才允许双向 state-vector reconciliation；缺失或不同进入稳定 `conflicted` 状态，绝不自动覆盖或合并。

Hub 丢失只能从 hub 自身备份恢复，不自动选择 peer 回灌。Peer 冲突恢复使用带 `expectedLocalIdentity` 的 `resetReplica()`：Registry 先关闭本地 Runtime generation，再通过 Persistence 归档旧副本，最后允许重新 bootstrap。Persistence 为此增加受身份前置条件保护的归档 seam；WS 层不得直接读写 snapshot 文件。

### Bootstrap 与重连

本地 namespace 不存在时：

1. hub 在该 namespace 的 write sequencer 中读取复制身份并编码一次完整 `Y.encodeStateAsUpdate` 基线；
2. sequencer 不等待网络发送；之后的 transaction 进入正常增量队列；
3. peer 在 detached Y.Doc 应用基线、严格核对 META 身份，再通过 Persistence 的受控复制导入能力排他创建；
4. Registry 打开新 Runtime generation；
5. channel 立即执行 state-vector reconciliation，补齐编码基线与安装之间的竞态窗口。

本地已存在且复制身份、epoch 相同时不做替换，直接双向交换 state vector/diff 并按 Yjs 语义合并。Yjs update 不能删除另一份文档已经拥有的 CRDT 历史，因此本设计不把普通 `Y.applyUpdate` 误称为 hub 覆盖，也不执行 generation replacement。

### NamespaceLease 与 ReplicationSession

`NamespaceLease` 正式增加高级受信任集成入口：

```ts
lease.openReplicationSession(options): ReplicationSession
```

所有 Lease 都可调用该入口，不设置不可伪造 capability；Host 搭建方负责只把 Lease 交给可信代码。API 文档必须明确 raw replication 会绕过 VFSL 业务校验，不得把它暴露为普通客户端写入口。

每个 Lease 首版最多一个 duplex ReplicationSession。Session 创建时冻结 `localRole`、`remoteInstanceId`、`replicationId` 和 `replicationEpoch`，提供窄能力而不暴露 Y.Doc：

- 编码 state vector；
- 按远端 state vector 编码 diff；
- 订阅 owned `Uint8Array` 本地 updates；
- 在唯一 write sequencer 中应用远端 update；
- 查询独立复制状态；
- 幂等 close。

Lease release 同步停止 session 接纳；channel 关闭先关闭 session，再释放 Lease。网络状态保留在 ReplicationSession/复制插件，不塞入 Runtime 的业务 capability status。

### Trusted raw update 与现有不变量

实例链路是受信任复制链路。Raw update 不执行完整 VFSL 预校验；这是对 ADR 0007/0008 普通业务写 zero-write 保证的明确例外，而不是暗中复用业务 mutation 语义。

远端 update 仍必须进入该 namespace 的唯一 write sequencer：

1. lifecycle、角色、身份和 epoch gate；
2. 必要的受保护字段检查；
3. 一次 `Y.applyUpdate`；
4. Runtime observer 产出 owned update 与受控 origin；
5. `await saveDoc(handle)` 登记 dirty；
6. 释放 sequencer 槽。

Hub 接收 peer update 前，在 scratch clone 上确认 update 不改变 SCHEMA，也不改变 META 中的复制身份保留字段。Peer 接收 hub update时允许同步 ROOT、SCHEMA 和允许的 META 字段。该检查执行角色权限，不等同于 VFSL ROOT 校验。

Raw merge 后 ROOT 可能不符合当前 SCHEMA；该 update 仍被接受并继续复制，复制状态标记 `replication-unvalidated`。后续普通业务写仍按现有完整 ROOT 校验，可能被拒绝。Yjs 没有通用 transaction rollback，因此不得采用“先 apply、失败再回滚”，也不得虚假声称 raw update 享有验证失败零写入。

Runtime 的 update observer：

- 只交付复制需要的 owned bytes 和受控 origin，不暴露 live Y.Doc；
- observer 失败不得回滚 transaction 或使 Runtime fatal；
- 队列溢出只把 channel 标记为 `needs-resync`，不得阻塞 write sequencer。

### SCHEMA 与 META 权限

- ROOT 在 hub 与 peer 上均可由普通受控业务写修改，并通过复制最终合并。
- SCHEMA 只允许 hub 的本地 `replaceSchema()` 修改；peer 本地调用以稳定角色权限错误拒绝。
- Hub 的 SCHEMA update 正常向 peer 单向复制。
- `META.replicationId` 与 `META.replicationEpoch` 只能由 hub 的显式复制管理操作修改。
- 未来其他非保留 META 字段可另行决定双向语义；raw caller 不得逐次自定义受保护字段集合。

### Persistence degraded 语义

Hub namespace 处于 `persistence-degraded` 时：

- 拒绝 peer→hub raw update；
- 保留读取、身份检查和 state-vector 交换；
- Persistence 恢复后通过 reconciliation 补齐。

Peer namespace 处于 `persistence-degraded` 时：

- 拒绝本地业务 mutation；
- 仍允许已认证 hub→peer session 将 update 应用到内存；
- 仍调用 `saveDoc(handle)` 登记最新 generation，由 Persistence retry 保存完整 live doc；
- Runtime closing/fatal 或 handle 失效时不得绕过；
- 崩溃重启可能从旧 snapshot 恢复，随后由 hub 的 state-vector diff 自动补齐。

该 bypass 只属于创建时已冻结为 `hub-to-peer` 的可信 session，不能由普通业务写或 peer→hub update 获得。状态必须区分“内存已追上”与“磁盘未追上”，不得声称 peer 副本已经 durable。

### WebSocket 复制协议与状态机

每个 Peer→Hub维持一条长期 WebSocket并 multiplex多个 namespace。Wire不使用 channelId：每个 namespace-scope frame直接携带 namespaceId；同一连接内同一 namespace只允许一个生命周期，关闭后重开必须重建连接。

固定 envelope为 20-byte大端头：`NMCR` magic、envelope version、message type、flags、direction-local sequence、payload length和reserved。首版flags/reserved必须为零，一条WebSocket binary message恰好承载一个完整frame。控制payload使用显式直接依赖的lib0 canonical encoding，内层复用锁定版本的`y-protocols/sync`语义。Envelope version只决定头布局，HELLO显式协商完整protocol version与capabilities；不得按消息数值猜版本。

Bearer token在HTTP Upgrade前认证；Upgrade后Peer发送HELLO，Hub回复HELLO_ACK并绑定Peer/Hub instance identity。每方向sequence从1严格递增，不回绕；gap、repeat或错误ACK关联关闭连接。WS ping/pong负责活性，GOAWAY提供相对drain timeout。

Namespace依次执行OPEN与身份检查、可选单frame bootstrap、双向state-vector reconciliation、live UPDATE。每个sync round由Peer以uint32 roundId发起，双方Step2完成sequenced apply + dirty后以SYNC_APPLIED确认；两个方向均确认才进入live。UPDATE_ACK同样只表示sequenced live apply + dirty notification，不表示物理flush或其他副本确认。

连接与namespace状态、消息码、payload字段、错误码、timeout、close code、backpressure和完整时序以`docs/protocols/instance-replication-v1.md`为唯一wire contract。关键恢复纪律为：连接断开即close sessions/release Leases，不保留outbox；重连重新OPEN并reconcile。Per-namespace有界队列溢出时丢弃未发送增量并进入needs-resync；connection按namespace round-robin公平发送，control/ACK保留额度，网络背压不得进入Runtime sequencer。

### 认证、授权和传输安全

- WebSocket upgrade 使用 bearer token 认证实例身份；token 映射到安全文法约束的 `instanceId` 与 namespace 权限。
- `instanceId` 使用 `^[a-z][a-z0-9-]{0,62}$`，仅用于连接身份、受控日志和指标，不写入 namespace META。
- Hub 检查 peer 对每个 namespace 的读取和提交权限；peer 验证配置的 hub 身份，并只接受已请求且批准的 channel。
- 权限撤销关闭对应 channel，不必关闭整条 WS；授权结果不跨连接生命周期缓存。
- Token、Yjs update、SCHEMA/ROOT 内容以及未经控制的 owner/namespace 不得出现在默认日志或高基数指标标签中。

Nomicore 首版允许应用层使用明文 `ws://`，TLS 可由网关、反向代理或 service mesh 终止。Nomicore 因而不提供链路机密性保证；生产部署必须在基础设施层提供 TLS，否则 bearer token 与 Y.Doc 数据会明文暴露。

### 资源限制与 observability

以下上限均为插件配置并提供安全默认值：最大 WS frame、最大单 update/diff、每连接最大 channel 数、per-channel/连接待发送字节、bootstrap/idle timeout、心跳与失联判定。普通超限以稳定错误关闭单个 channel；framing、认证等连接级错误才关闭整条连接。

复制插件提供结构化 observer seam 给日志/metrics/trace Adapter，不提供业务公共 update events。最小观测面包括：连接状态与重连、channel 状态、bootstrap/reconcile 次数和字节、updates/bytes in/out、apply/ACK latency、backpressure resync、auth/authz failure、identity/epoch conflict、peer degraded bypass apply 和稳定错误计数。

### 包、应用与生命周期

Phase 5 首版建立：

1. `@nomicore/replication-protocol`：纯二进制 codec、显式版本协商、消息与稳定错误，不依赖 Cordis、WS 或 Registry；
2. `@nomicore/ws-replication`：WebSocket client/server、multiplex、认证授权、bootstrap/reconcile/live 状态机、背压和 observer；
3. `apps/yjs-server`：最小 Cordis composition root，装配 Clock、Timer、Memory/File Persistence、Registry、WS replication、配置加载和优雅停机。

在出现第二种 transport 前，不提前提取 transport-independent replication package。第三方 Host 可直接基于公开 NamespaceLease/ReplicationSession 构造自己的可信 transport。

停止顺序为：复制插件停止接纳连接/target，先发送 GOAWAY 并进入真实 drain 窗口；窗口内不接纳新的 namespace 工作，只允许现有 channel 自然 CLOSE，并等待已被 Runtime 接纳的 apply 槽。全部 channel 终态可提前关闭 transport，否则网络 deadline 到达即以 WS 1001 收口，不无限等待网络 ACK。网络关闭后 Runtime barrier 仍排空停机前已接纳 apply，再异常安全地 teardown channel、close session 并尽力释放 replication lease；随后 Registry shutdown、Persistence dispose，最后停止 Timer/Clock。网络 deadline 不取消 Runtime barrier，迟到 apply 结算不得恢复 wire 输出。

## 参考实现取舍

`film-studio-fe/apps/yjs-server` 可借鉴标准 Yjs sync/state-vector、multiplex、连接 origin 回声抑制、bootstrap gate 和 snapshot temp→rename。不得照搬：

- WS handler 直接持有或写裸 Y.Doc；
- 全局文档 Map 和手写 GC timer；
- REST rebuild/hard reset 作为常规恢复；
- 记录完整 token；
- 缺少 namespace 级授权；
- 非结构化授权失败；
- 不一致控制帧编码；
- 通过数值范围猜测协议版本。

## 后果

- 多机部署可在网络分区期间保持本地写可用，并在恢复后依靠 Yjs CRDT 最终收敛。
- Hub 是通信中心和复制身份管理点，但不是 ROOT 唯一写者；它仍是唯一可修改 SCHEMA/复制身份的角色。
- Raw trusted replication 有意弱于普通业务 mutation 的 VFSL 安全保证；错误或恶意可信 peer 可使 ROOT 进入 `replication-unvalidated`。
- 每台机器必须使用独立 Persistence/rootDir；共享文件目录多写仍不受支持。
- Bootstrap、归档、epoch 冲突和 degraded bypass 引入新的 Registry/Persistence/Runtime 合同与测试面。
- Hub 不自动从 peer 恢复，因此 hub 备份仍是权威灾难恢复手段。

## 非目标

- hub 自动选举、故障切换或从 peer 自动恢复；
- hub 级联、多 hub、peer-to-peer 或一个 peer 连接多个 hub；
- awareness/presence；
- 客户端 y-websocket 兼容端点；
- 跨地域强一致、全局顺序或 quorum durability；
- 自动覆盖 identity/epoch 冲突；
- raw update 的完整 VFSL 校验；
- namespace discovery/list 和通配 selector；
- durable outbox、增量 WAL 或跨重连 update ID 表；
- shared filesystem 多写。

## 取代与关联

本 ADR 扩展 ADR 0006 的异机冗余预留，但不改变`saveDoc`仅为dirty notification、全量snapshot、owner目录分区或单rootDir owner语义。它为Persistence增加复制导入与归档所需的受控能力；namespaceId的概率全局唯一由生成策略负责，Persistence不增加跨owner catalog或原子唯一约束。

本 ADR 对 ADR 0007/0008 的“未来 raw Yjs update 必须另设受控通道”作出决定：通道位于 NamespaceLease 的 ReplicationSession，并继续进入唯一 write sequencer；但 trusted raw update 明确不继承普通业务写的完整 VFSL zero-write 保证。

本 ADR 修订 ADR 0009 的 Registry identity：entry key由`(owner.userId, namespaceId)`改为仅namespaceId；owner仍是open/create的必需本地属性、Runtime/Lease投影和Persistence分区键，owner mismatch不泄露存在性。跨进程不建立全局 sequencer，而由各实例本地 sequencer和Yjs CRDT合并实现最终一致。Registry仍负责本地Runtime generation、Lease、reset/archive编排和Host生命周期。

Phase 4 中列为非目标的 WS room、raw Yjs sync 和分布式部署由 Phase 5 接续；leader election、文件锁和分布式 Registry 仍不进入本阶段。交付切片见 `docs/phases/phase-5-websocket-replication.md`。

---

## 修订节：issue #134（ReplicationSession 落地冻结词汇，依据 phase-5 切片 3/4）

日期：2026-08-28；状态：已接受（`fix/issue-134-on-docs-phase-5-websocket-replication`）

本节把「NamespaceLease 与 ReplicationSession」「Trusted raw update 与现有不变量」「SCHEMA 与 META 权限」「Persistence degraded 语义」四节的落地决策与冻结词汇登记到本文（实现细节以 `packages/namespace-runtime/src/replication-session.ts`、`packages/namespace-registry/src/lease.ts` 为权威；本 ADR 为公共契约语义来源）。

### ReplicationSession 打开与 apply 拒绝码注册（append-only）

- `lease.openReplicationSession(options)` 返回 `Promise<OpenReplicationSessionResult>`；一切拒绝（含 released lease）经返回 Promise 的 `ok:false` 结算。拒绝码闭集：`NAMESPACE_LEASE_RELEASED`（released 通道）/ `REPLICATION_SESSION_INPUT_INVALID`（输入恰含 localRole + remoteInstanceId（`^[a-z][a-z0-9-]{0,62}$`——L156 安全文法））/ `REPLICATION_ROLE_MISMATCH`（session localRole ≠ 实例静态角色）/ `REPLICATION_SESSION_EXISTS`（每 Lease 至多一个活跃 session）/ `REPLICATION_NOT_ENABLED`（复制身份未安装——复用 issue #132 已冻结词族）/ `RUNTIME_WRITE_DISABLED`（Runtime lifecycle≠ready 或 fatal 已置位）/ `REPLICATION_SESSION_UNSUPPORTED`（Runtime 无复制会话宿主——测试替身 Runtime 或包版本错配）。
- `session.applyRemoteUpdate(update)` 返回 `Promise<ReplicationSessionApplyResult>`；可预期拒绝（gate/scratch/fence/终态/lifecycle）全部经 `ok:false` 结算，码闭集：`NAMESPACE_LEASE_RELEASED`（lease 已 release——wrapper 前置检查唯一产出点）/ `REPLICATION_SESSION_CLOSED`（显式 close 终态）/ `REPLICATION_EPOCH_CONFLICTED`（冻结 epoch 过期，终态 conflicted）/ `REPLICATION_RAW_UPDATE_INVALID`（非 Uint8Array 或 Yjs 无法接纳）/ `REPLICATION_PROTECTED_FIELDS_CHANGED`（受保护内容变化）/ `RUNTIME_WRITE_DISABLED`（lifecycle/fatal/writable gate，含 hub degraded 拒绝）。写管线 internal fatal（getStatus adapter 违约 / apply 未知 throw / notify-dirty 失败）经 `RuntimeWriteFatalError` rejection（`committed` 诚实），slot 词 `replication-apply` → fatal 码 `NSRT-FATAL-REPLICATION-APPLY-INTERNAL`。

### Session 独立状态词汇（O-11 冻结）

`session.getStatus()` 每次返回全新深冻结对象，形状：`state('open'|'closed'|'conflicted')` + 冻结四域（`localRole`/`remoteInstanceId`/`replicationId`/`replicationEpoch`——open 时捕获为常量，永不随 Runtime 漂移）+ `direction('hub-to-peer'|'peer-to-hub')`（创建时派生：localRole==='peer' ⇔ hub-to-peer）+ `currentEpoch`（Runtime 投影链当前值——fence 可观测：与 `replicationEpoch` 不等即已过期）+ `rootValidation('none'|'replication-unvalidated')`（raw apply 成功后置位、生命周期内永不清除）+ `durability`（`memoryCaughtUp` **初值冻结 false**——open 时刻尚无经本 session 的 raw apply；首次 apply 成功置 true 后不回落；`diskCaughtUp: false` 字面量类型——该查询面结构性永不声称 durable）+ `observerFailures`（扇出 listener 自捕获计数；无界纯计数、不熔断不自动退订——熔断/背压属切片 6 队列属主）。Runtime status 的 `replication` 域仍只含两态持久事实（disabled | enabled），session 状态绝不入 Runtime status。

### 生命周期词义（O-9 冻结）

- 「每 Lease 至多一个 duplex session」= Lease 级至多一个**活跃**（`state==='open'`）session；计数在 Lease 层（同一 Runtime 被多 Lease 共享——fan-out 的结构前提）。`closed`（显式 close 或 Lease release 同步调用 `session.close()`）与 `conflicted`（epoch fence）皆终态并释放槽位；终态后同 Lease 可再 open（新 open 冻结新 epoch = 显式 reset/bootstrap 的本切片等价物）。
- `close()`：幂等 same-promise；首次调用同步段停接纳 + 摘除扇出 channel；Promise 结算为 **barrier 语义**（resolve 时点 = 先于本次 close() 接纳的任务排空之后），**永不 reject**（恒绿空槽体）。release 不追踪已接纳 apply 槽（ADR 0009 L42 同款——照常排空）。
- 两种终态（close 首调 / apply 槽 R2 conflicted 转换）共用同一 `fanout.detach` 摘除点：存量 listener 即刻停止投递（transport 不得据旧 session 字节继续错误同步）。

### 受保护字段判据（O-12 冻结）

- 判据 = **(a) 内容投影相等**：scratch clone（新 Y.Doc + `encodeStateAsUpdate` 全量装载 + 装载待审 update）上比对 SCHEMA/META 的全键值投影；原始值直比（string/number/boolean/null），非 primitive 形态（Yjs 容器/对象——契约外值域）保守判「已改变」→ 拒绝。字节级判据无良定义（encodeStateAsUpdate 非规范编码）、零操作判据需解析 update 结构且漏判「删后重写同值」——(a) 是 L105「确认 update 不改变 SCHEMA」的字面语义。
- **判据 (a) 边界点名**：**「删后同值重写 = 内容未变 = 允许」**（内容投影相等判据的字面推论）；副作用仅为同值重写的历史膨胀（Yjs CRDT 结构增长），属可信域威胁、危害有界——后续审查者不得重开此议题视为缺陷。
- 受保护字段集合 = **冻结常量**（raw caller 不得逐次自定义，L121）：hub 侧（接收 peer→hub）`SCHEMA 全容器 + META 全键`；peer 侧（接收 hub→peer）`META 全键`（SCHEMA/ROOT 放行——L105）；peer 允许的 META 白名单**首版 = 空集**（⟺ META 全键保护，两侧对称；L121「未决定即不可同步」保守读法，且与 L120「epoch 只经 hub 显式管理操作修改、peer 永不经 raw 获得」一致）。
- **hub 侧全 META 保护登记**：这是对 L105 最小检查集（SCHEMA + 复制身份保留字段）的**收紧而非放宽**——docId/createdAt 是 Registry 身份元数据、本切片无任何合法 raw 路径修改非保留 META；对称谓词可测性与防篡改性均更优。peer 侧对称收窄（META 全键保护但 SCHEMA 放行）。
- **已知成本登记**：scratch 预演 O(doc)/apply（每 apply 全量装载 + 投影比对）——本切片正确性优先；增量检查（仅比对 diff 触达容器）留作后续演进，非过早优化，不得在未评审情况下预写。

### 其他冻结

- **O-7**：复制身份未安装（`{state:'disabled'}`）的命名空间上 open → 稳定拒绝 `REPLICATION_NOT_ENABLED`（复用 #132 已冻结 message 族，零新词）——四域冻结（L81）前置要求 replicationId/epoch 存在，允许开将迫使 session 携带 undefined 谱系。
- **O-4 角色注入**：实例静态角色经 Registry 构造 `options.role`（生产 `CreateNamespaceRegistryOptions` 与 testing overrides 同形）注入；可选、缺省 `'hub'`（基线全权限等价面——零回归）；非法值 → 构造期同步 TypeError（`NAMESPACE_REGISTRY_ROLE_INVALID`，检查顺序在 randomBytes 之后）。peer 的 `replaceSchema`/`enableReplication`/`bumpReplicationEpoch` 在 Lease 接纳段以稳定角色权限错误拒绝（`REPLICATION_ROLE_PERMISSION`，结果联合零改形、重复调用 JSON 逐字节相同）；session open 校验 `options.localRole === 实例 role`（不等 → `REPLICATION_ROLE_MISMATCH`）。生产 composition root（切片 9）必须显式传 role。
- **internal seam 第二导出指针**：`@nomicore/namespace-runtime/internal` 值导出由一键扩为两键——`createNamespaceRuntimeForRegistry`（ADR 0009）+ `openReplicationSessionCoreForRegistry(runtime, options)`（本修订；消费边界不变：仅 Registry 生产代码，import 图审计谓词零改动）。Runtime 公共入口值导出仍恰一键、Runtime 十二键对象面不变、两包 `package.json` exports 键集不变。
- **踩坑注记（SA2 R1 #13）**：**META 触碰的管理写（enable/bump）字节不得经 raw 回灌对端**——META 受保护全键检查会在 hub 侧拒绝、peer keep live docs 的 META 变化也只经控制面传播；**epoch 传播走控制面（切片 6 `IDENTITY_CHANGED`）**，不依赖 raw update 携带。
- **degraded 矩阵**：peer `persistence-degraded` 期允许已冻结 hub→peer session 的 trusted apply（内存生效 + `saveDoc` 仍登记 + retry 落盘——L131–135），**该 bypass 只属于创建时已冻结为 hub-to-peer 的可信 session**（O-1 五条件合取：lifecycle ready ∧ fatal 未置位 ∧ direction 冻结 hub-to-peer ∧ `getStatus()==='persistence-degraded'` ∧ notifyDirty 已绑定）；hub degraded 拒 peer→hub raw apply 但保留读取/身份检查/state-vector 交换（L125–129）；notifyDirty 未绑定时任意方向（含 bypass）一律拒绝（无持久化绑定不得写——D6.4）。

### issue #134 round 2 修订（PR #146 评审 12 项闭环——append-only；依据 `task_namespace-lease-replication-session_round2_design.md` R2.2.1）

**fanout 投递异步化（R2-3；D-1——撤销 round-1「本切片无队列 ⇒ L113 不可达」读法）**：observer（`doc.on('update')`）内只做回声抑制谓词 → 容量检查 → **owned bytes 复制**（`update.slice()`——ADR 0010 六步之 4「产出」的同步面）→ 入队 → 调度泵；**listener 调用全部移出 transaction 栈**（慢 listener 零阻塞事务返回/sequencer 槽）。投递经**每 session 有界异步队列**（容量 **16** 冻结常量 `FANOUT_CHANNEL_QUEUE_CAPACITY`——不可配置）+ **自延伸微任务泵**（每项投递前让步 **20** 次——双向 load-bearing：公平性下界与 flushMicrotasks 预算上界，合法区间 [16,24]）。**队列溢出 → 丢弃新项（保序：已入队最旧项保留）+ 置 `status.needsResync`（第 11 字段，sticky——置位后 session 生命周期内永不清除；清零路径 = transport reset/bootstrap 后 open 新 session；标记后投递行为不变——标记是观测信号不是行为切换；transport 观测后自行决策 reset/bootstrap）**——L113「只把 channel 标记为 needs-resync，不得阻塞 write sequencer」自「结构性不可达」读法改为**字面实现**；L241「熔断/背压属切片 6 队列属主」**收窄**为「WS 发送队列/连接级背压（正文 L151 域）」——投递队列（runtime 内、session 域）属本切片。`observerFailures` 计数语义不变（无界纯计数、不熔断不自动退订）；**两级副本**（observer 入队复制 + 每 listener 每投递 `item.slice()`）为正确性优先的有意成本（性能注记：每 apply 每受保护 META 键 `toJSON()` 递归投影 ×2 + 键集 sort——O(META 体量)/次，scratch 全量 clone 为既有成本、深比较为新增）；**交付集语义冻结句（R2.1 / SA2 #1）**：「投递交付集 = **交付时刻** listener 快照（**at-least-once**）——晚订阅者可收到订阅前入队项；跨退订重订可重复交付；重复交付由 Yjs `Y.applyUpdate` 幂等吸收（CRDT 重复应用零效果）」。

**bump 槽边界主动 fence（R2-1；D-2a）**：bump 槽 **E5.5**（ADR 0008 #132 L134 槽序「同步投影」步——transaction 返回后、`await notifyDirty` 前）经 `fanout.fenceStale(replicationId, nextEpoch)` 主动 fence：凡 channel 冻结 `(replicationId, replicationEpoch)` 与传入不等（身份不等或 epoch 落后）→ `finalize('conflicted')`——**conflicted 终态 + `fanout.detach` 摘除点 + 未投递排队项取消**（bump 自身 META 写于 E5 已入队、被本步取消 ⇒ **bump 写零投递给旧 session**——F-3 词义）；与 apply 槽 R2 的被动 fence **共用同一 finalize（零新增终态语义）**；fence 后旧 session `getStatus().state === 'conflicted'`、`currentEpoch` 反映新值、冻结 `replicationEpoch` 不漂移；终态释放 Lease session 槽位——**同 Lease 可再 open 新 epoch session**（显式 reset/bootstrap 的等价物；L245 词义不污染）。**enable 槽不 fence**（显式裁决：enable 的 E5 发生时 fanout channel 集合必空——open 门序要求 facts enabled）。

**Runtime close 终止 sessions（R2-2；D-2b）**：Runtime `close()` 同步段（`lifecycle` 翻转后、barrier 入队前——同一同步段原子）经 `fanout.terminateAll('runtime-close')` 逐 channel `finalize('closed', 'runtime-close')`——**终态 `closed` + 排队项取消**；内部记账 `closedBy: 'runtime-close'`（**不进 status 形状**——A1 拒绝码映射专用）；conflicted 终态不降级。**已接纳 apply 槽无条件排空**（barrier 队尾——ADR 0008 L93/L179 锚；apply 槽体内不检查 session 终态，接纳层 A1 是唯一终态门）。其后 apply 拒绝映射：**`RUNTIME_WRITE_DISABLED`**（#93 修订节第 (4) 类「close 后 lifecycle≠ready 的接纳拒绝」域——session 级 closed 只是派生事实；显式 close 保持 `REPLICATION_SESSION_CLOSED`）。`encodeStateVector`/`encodeDiff` 终态**确定同步 throw `ReplicationSessionClosedError`**（round-1「best-effort 不承诺」措辞收窄——终态纪律统一）。Runtime close 后 session 再 `close()`：经既有幂等路径（terminal ≠ open ⇒ 跳过标记 + 惰性恒绿 barrier + same-promise 缓存，永不 reject——INV-S11 延续）。

**受保护字段判据细化——结构值规范化深比较（R2-4；D-3，SA8 路径 (a)）**：`protectedPrimitiveEqual` 对一切非 primitive 恒判「已改变」对 ADR 0008 L31 合法值域（JSON-compatible plain value，含 object/array）产生 false positive——修订为**规范化深比较**（判据名不变：内容投影相等）：primitive 直比（**SameValue**——NaN=NaN、-0≠0，round-1 语义延续）；容器白名单（**(B) 保守白名单**，R2.1 / SA2 #2）＝ **Y.Map / Y.Array**（**显式构造容器**——调用方以 `new Y.Map()` / `new Y.Array()` 显式构造的本地容器形态；经 `toJSON()` 递归投影参与比较）**与 plain array / plain object**（yjs 13.6.32 实测：`Y.Map.set` 对 plain 值经 lib0 writeAny 原样存储、round-trip 后仍为 plain——**L31 值域的实际本地存储形态**；原型必须为 Object.prototype/null，排除 Date/Map/Set 等非 plain 实例）——深比较规则冻结：**键序无关**（plain object 键集排序后逐键）、**数组有序**递归、空值/primitive SameValue；**契约外容器（Y.Text/Y.XmlText 等一切 `instanceof Y.AbstractType` 且非白名单）保守判「已改变」——虽同型等内容未变亦拒**（round-1 姿势连续；合法写路径结构性不可达，仅种子/直构面）；**跨形态分叉拒**（单侧白名单即拒——如 live Y.Text vs update plain 'abc'）；**白名单容器内嵌套契约外子值随投影参与比较**（`toJSON` 已摊平——投影相等即放行，表征归一化边界：与「删后同值重写」同族）；**META 值域零收窄**（深比较只在受保护字段投影比对域内执行——L31 整体值域不变）；「删后同值重写 = 内容未变 = 允许」在结构值下同样成立（不变）。

**committed 精确二分（R2-6；D-4）**：R5 以 `beforeTransaction` 探针精化 `RuntimeWriteFatalError.committed`——`txStarted === false`（探针未运行 ⇒ beforeTransaction emit 未完成 ⇒ 事务函数从未执行 ⇒ **零 mutation**）⟹ `committed:false`；`txStarted === true`（事务已开始、mutation 程度不可判）⟹ 保守 `committed:true`（ADR 0008 L84 过报方向强制）。探针槽内注册（晚于一切先注册 listener——Yjs 按注册次序同步派发）、finally 卸载（零泄漏）；fatal 码/词不变（`NSRT-FATAL-REPLICATION-APPLY-INTERNAL` + slot `'replication-apply'` + phase `'unknown-pipeline-throw'`——只精化 committed 布尔）。**例外注记（精确性条件）**：注入面 = yjs 事务钩子域；解码期异常（R4 已拦 `REPLICATION_RAW_UPDATE_INVALID`）、notifyDirty 失败（`committed:true` 既有锁定）不在判据内；复合敌意（beforeTransaction 内先变异后抛错的多个 listener）属 ADR 0007 L54 observer 契约破坏域——二分不为其承诺，**该除外情形失败方向为 under-report（`committed:false` 而可能已变异）**——比过报危险（调用方可能据此跳过 reconciliation），L84 只强制过报方向，本二分对钩子域内单点注入维持精确、对契约破坏域残余风险以方向性明文收口。

**成功接纳即置位（R2-7 明文规范）**：no-op / 重复 / 空效果 update 的成功 apply（`Y.applyUpdate` 正常返回 + R6 dirty 登记完成）同样置 `rootValidation = 'replication-unvalidated'` 与 `memoryCaughtUp = true`——无「且推进文档状态」限定（依据：L241「raw apply 成功后置位」「首次 apply 成功置 true」字面；L107「该 update 仍被**接受**……标记」；CONTEXT「复制未校验」词条「已**提交**并登记 dirty」；ADR 0006 #79 L192 互证）。

### issue #133 round-2 reset/import identity precondition 修订（2026-08-28，owner feedback 3 授权）

本节替换「复制谱系与 epoch」节中 resetReplica 的执行次序描述（“Registry 先关闭本地 Runtime generation，再通过 Persistence 归档旧副本”）与「Bootstrap 与重连」节第 3 步的一般性身份核对（“严格核对 META 身份”），并以本条为准；本节未明示的其余 ADR 文本维持效力。

**1. `resetReplica(expectedLocalIdentity)` 严格前置核对**：对 active generation，在任何 lease 强制释放、close、归档或 bootstrap 资格变更**之前**，Registry 在 Runtime 唯一 write sequencer 的 reset-fence 槽内执行「当前 live 投影 + 受信任 persisted committed-snapshot」双源核对，二者都必须是合规 enabled 复制身份且与 expected **完全一致**。任一不匹配/disabled → `NAMESPACE_RESET_IDENTITY_MISMATCH`，零破坏性动作，旧 generation/lease/runtime 保持可用；probe 损坏/abort 为 `committed:false` branded fatal；当前 epoch 内普通读失败为 `NAMESPACE_LOAD_FAILED`。已处于 closing 的 generation 由先前操作转变：本次 reset 等待其既有 closePromise 结算后**重新从 carrier 槽读取事实**，绝不把旧 Runtime 当作 live 证据；结果按「主键缺失 → `NAMESPACE_NOT_FOUND`；主键仍在 → `NAMESPACE_RESET_FAILED`；probe 错误按上述映射」分类，不调用归档。

**2. 成功路径的冻结次序**：preflight 与 close admission 共享同一个 Runtime FIFO reset-fence 槽（先核对双事实，再在槽返回前同步进入 closing）；fence 槽**绝不创建或等待 close barrier**。只有槽结算后，懒 close continuation 才创建唯一的 close barrier，其 predecessor tail 在 fence 结算**之后**捕获，因此 barrier 排空「fence 前已接纳」的写（已包含在核对样本中），且不可能包含/等待 fence 任务自身——无 fence/close 自等待。此后 Persistence 归档（expected 身份守卫保留为对外部/跨实例 store 变更的纵深防御——**不是**可接受的本地迟到 mismatch 通道）→ bootstrap 资格。普通 `close()` 观察 fence-armed 状态时返回同一懒创建的 close promise，公共入口不启动第二个 barrier。

**3. Bootstrap 导入绑定 Hub 广告身份**：`importReplica` 接收 Hub 广告的 expected `{replicationId, replicationEpoch}`（第 4 参数；来源必须是认证 Hub 广告的可靠绑定，绝不可用文档自身值替代）。在 `importDoc` resolve/所有权转移之前校验：detached 文档 `META.docId`、复制事实合规性、与广告身份的**完全一致**。格式合规但 lineage 或 epoch 不同 → `NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH`，无自动覆盖/合并、零持久化写入、零 Registry entry 登记。expected 输入本身必须在任何文档读取/carrier 入队之前被无副作用安全快照验证。

**4. dirty 事实的诚实表达**：dirty notification 不是 durable（ADR-0008）；live 已 bump、持久化仍为旧 epoch 的严格双源不一致是**有意**的拒绝条件（严格口径），本节不得被解读为「live dirty 身份已被持久化」。任何「dirty live 即 persisted」的表述均与本条冲突。

**5. 归档重定位的 committed 诚实**：归档写/rename resolve = 归档提交点；随后主键移除失败由 Persistence 以 `relocate-remove` 致命（`committed:true`）传播，Registry 保留该 committed 事实并原样传播为 `NamespaceRegistryFatalError`；禁止翻译为 reset 领域不匹配或普通运营失败、禁止宣称旧主键状态未变；重试为 latest-wins 归档收敛 + 主键移除重试。reset fence **armed 之后**的每个 archive typed 拒绝按 §3.5.2 冻结矩阵分类——特别地，身份不匹配是运营 `NAMESPACE_RESET_FAILED`，**永不**是零破坏的 preflight 结果。

### issue #161 round 2 修订（PR #165 review 八项——2026-08-30）

本节登记 ws-replication 实现层的八项 review 修订决策；wire 契约以
`docs/protocols/instance-replication-v1.md`（§2/§17/§18 本轮扩写）为唯一权威：
公共身份投影只取受信 Upgrade 身份（缺身份 accept = 响亮 TypeError）；transport
三可选面（bufferedAmount/ping/onPong）缺面 dormant 语义与生产装配期断言；liveness
缺省 30s/10s 与 pongTimeout < pingInterval 构造期校验；背压终态口径（pipeline =
queued+buffered、shed 仅 queued 侧、严格接纳 + onDataShed 显影、控制独立保留额度
maxQueuedControlBytes 缺省 8MiB、有界整轮扫描、pending handoff 计入 per-ns 溢出
双口径、checkpoint = max(1, floor(ackTimeoutMs/100))、1011 终止）；peer pong 超时
close(1001) + 代际安全脱离后重连；GOAWAY/blocked/连接收口同步静默订阅先于异步
drain。实现证据：`packages/ws-replication/src/*`（PR #165 round 2）。

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

停止顺序为：复制插件停止接纳连接/target，关闭 channels，等待已被 Runtime 接纳的 apply 槽完成但不无限等待网络 ACK，释放 replication leases，随后 Registry shutdown、Persistence dispose，最后停止 Timer/Clock。

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

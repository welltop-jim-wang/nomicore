# nomicore

全新 yjs-server 的重写仓库：以 VFSL（受限 TypeScript 子集 + JSDoc 语义标签）作为 namespace schema 的单一真相源，schema 作为数据存进 doc 的 `SCHEMA`，命名空间自包含、跨版本可解释。设计文档：[yjs-server Namespace Schema 自描述体系设计方案](https://welltop.feishu.cn/docx/MvtJdEr84ojlRTxbmsWcqHD8npg)。

## Language

**VFSL**:
受限 TypeScript 子集 + 标记类型构成的 schema 语言；同一段文本既是编译期类型源、又是运行期解释器输入。
_Avoid_: PathSchemaNode DSL、schema DSL

**方言（dialect）**:
`lang + version` 决定的 VFSL 语法子集与语义规格；一经发布冻结，引擎只增不改，未知方言 loud-fail 只读。

**信封（envelope）**:
顶层具名 `SCHEMA` Y.Map 中 `lang/version/id/text` 四个字符串键投影出的严格普通对象；兼容读取忽略额外键，规范写入以一次 transaction 清空并重写四键。信封可哈希、可 diff。

**原样封闭校验（provided-root as-is closed validation）**:
`replaceSchema` 提供 `root` 时，root 被视为完整最终 logical ROOT snapshot，**原样**送入封闭对象校验（validateLogicalSnapshot）与 detached 构造（buildTopEntries）——任何未声明键，无论顶层还是嵌套，一律响亮拒绝（`ok:false` + 指向该键的 issue，零写入）；不投影、不剥离、不合并。
_Avoid_: 顶层声明域投影（round 1 自创语义，已废止）、宽松合并（merge）、schema 演进迁移（migration 属上层语义，非本层职责）

**命名空间（namespace）**:
一个 Y.Doc 连同自带的 `SCHEMA` 信封与数据；schema 随数据走，不依赖代码模块。
_Avoid_: schema 注册表（`SCHEMA_REGISTRY` 是被替换的旧机制）

**空闲 Runtime（idle Runtime）**:
当前没有调用方租约、但仍由 NamespaceRegistry 暂时保留的 namespace Runtime；保留期内重新打开会复用同一 Runtime，保留期届满才关闭。fatal 或 persistence-degraded 只改变能力，不改变空闲保留语义。
_Avoid_: 已关闭 Runtime、无人引用即可立即销毁

**创建时间（createdAt）**:
namespace 创建提交时由生命周期层生成的 UTC ISO 8601 字符串，存于 `META.createdAt`；调用方不提供，Persistence 只保存而不解释或校验。
_Avoid_: Unix 时间戳、调用方自报创建时间

**ROOT**:
命名空间根别名的保留名（大小写是契约）：每个模块必须恰好声明一个 map 形的 `type ROOT = …`（裸对象 / `YMap` / `Record`），ROOT 固定物化为 Y.Map，Yjs 映射为 doc 根 `getMap('ROOT')`。其余无人引用的别名是惰性积木，不进数据面。
_Avoid_: 隐式根、汇点推导（被否决的根指定方案，ADR-0003）

**标记类型（marker types）**:
`YMap` / `YArray` / `YPlainArray` / `YLeaf` / `YXmlFragment` / `Pattern`；tsc 视角恒等别名，引擎视角是 Yjs 物化语义标记。
_Avoid_: `YLEaf`、`yleaf` 等变体拼写——大小写是契约的一部分

**结构树（structure tree）**:
Yjs 物化语义（kind / storage / opaque），供路径下钻守卫；与值语义正交。

**值 schema（value schema）**:
值类型语义：封闭对象、判别联合、字面量联合、pattern 约束。

**路径索引（path index）**:
路径 → 子 schema 的下钻索引，键匹配（exact / pattern）为标准能力。
_Avoid_: resolveChild 三级前缀匹配（被替换的旧机制）

**求值器（evaluator）**:
把解析后的模块（IR）求解为派生 schema 的步骤；可失败（结果联合）——方言合法性与 ROOT 完整性在解析层已收口，求值期失败为资源预算等模式预留。
_Avoid_: 编译器（compiler）——该词留给「文本 → IR → 派生 schema」的组合入口（Phase 1 contract 包）

**派生 schema（derived schema）**:
求值器的产出：结构树、值 schema、路径索引的打包；与 IR 同纪律——纯数据、可 JSON 序列化、可内容哈希；别名按名引用（`ref`）保留，不内联展开（ADR-0003 §4）。
_Avoid_: 编译产物、DerivedSchema（英文代号）

**逻辑快照校验（validateLogicalSnapshot）**:
对普通 JSON 逻辑 ROOT 快照运行完整值语义校验；不接收 Y.Doc / Y.Map / Y.Array，也不验证 Yjs 载体。创建前校验、写入前校验、迁移后体检、测试与管理端点共用该入口；普通 open/read 不重复校验已持久化 namespace。
_Avoid_: validateSnapshot（容易误解为可校验 live Yjs 文档）

**信封指纹（envelope fingerprint）**:
封闭四键 schema 信封 `{ lang, version, id, text }` 的身份；任一键变化都会改变，用于观察 namespace 当前信封是否变化。

**语义指纹（semantic fingerprint）**:
`lang + version +` 解析后规范 IR 的语义身份；忽略空白与普通注释，保留 JSDoc、声明顺序及其他 VFSL 语义，并排除仅作谱系标签的 `id`。用于共享编译语义产物。

**载体投影读取（readLogicalValueAtPath）**:
从 live Y.Doc 的固定 ROOT 按实际 Yjs/plain 载体和路径同步投影普通逻辑值；不依赖 VFSL/派生 schema，也不重复执行结构或逻辑校验。创建与受控写入负责建立并维持数据不变量；持久化文件被其他程序错误修改不在运行时读取契约范围内。
_Avoid_: validated read、schema-aware read（会误解为读取时重新解释或校验 VFSL）

**写序列器（write sequencer）**:
每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。
_Avoid_: mutation queue（范围过窄，容易让 SCHEMA/META 管理写建立旁路）

**P0（schema preparation）**:
Runtime 发布前已进入写序列器队首的 schema 准备任务；只投影并编译 SCHEMA、构造 active schema tools，不读取或验证 ROOT。Runtime 发布后读取立即可用，早期写排在 P0 后。

**active schema**:
NamespaceRuntime 当前安装、供 ROOT write 使用的已编译 schema tools 及身份；SCHEMA write 的 transaction 成功后同步切换，不等同于对 live SCHEMA 的即时读取。

**停接纳（stop-acceptance）**:
close 首次调用同步进入 `closing` 后，capability 槽立即停止接纳新调用：read 同步结果联合返回 `RUNTIME_READ_DISABLED` 分支（lifecycle 失败不是路径缺陷，不借用路径失败码）；三个数据投影 getter（getSchemaEnvelope / getMetadata / getActiveSchema）与 read 同属停接纳范围——同步 loud throw 稳定码 `RUNTIME_READ_DISABLED`（getter 返回类型非结果联合，拒绝通道为 throw；message 区分 getter 域与 lifecycle 值）；mutateRoot/replaceSchema 经 Promise settle 含 `RUNTIME_WRITE_DISABLED` 的零写入结果——该码与 fatal 后排队写、写前 writable gate（handle 非 ready：persistence-degraded / released / disposed）、notifyDirty 未绑定共用同一码族，message 文案区分域；close 前已接纳任务仍无条件排空。internal fatal 只永久禁写并保留读取，不触发 read/getter 停接纳。getStatus 全生命周期可用（生命周期观测面，非数据投影），不在停接纳范围。
_Avoid_: 把 lifecycle 失败伪装成路径失败码、把停接纳误解为取消已接纳任务、把停接纳误读为 getStatus 不可用

**重建校验（rebuild validation）**:
单字段 patch 也在最近结构边界合并当前值后按完整子 schema 校验——判别联合只有看到判别字段才知道按哪个变体验。

**语义层（semantic layer）**:
JSDoc 首行自由文本 + `@tag` 半结构化标签；全部为文档性质，未识别仅 warn（无机器标签）。

**零写入（zero-write）**:
校验失败 → 400 且文档不变；所有写入口走同一条管线。

**作用域绑定（DocScope）**:
每个命名空间绑定自己的方言解释器、规则集与编译缓存；多方言并存不需要进程级"当前版本"。

**判别联合（discriminated union）**:
字面量联合字段（如 `kind`）区分的变体；引擎自动识别判别字段并按变体验证。

**封闭对象（closed object）**:
子集内对象类型默认封闭：未声明字段拒绝。

**namespace 诊断变更日志（namespace diagnostic change log）**:
从 namespace 创建开始尽力记录所有变更尝试及其结构化结局的可选 observability 流；连续的 committed Yjs updates 可用于诊断性重放，但日志不参与业务提交、不承诺完整性或恢复能力。
_Avoid_: 审计账本、WAL、event sourcing、可靠恢复日志

**变更尝试（change attempt）**:
一次可能修改 namespace 的请求及其结局；结局区分 committed、rejected 与 fatal，并标明 acceptance、capability gate、input snapshot、validation 等阶段。被拒请求也属于变更尝试，即使它从未读取输入或进入 transaction。
_Avoid_: 仅成功事务、统一 failed 事件

**诊断日志 stream generation**:
一个 namespace 的一代独立诊断日志，包含不可变 manifest、VFSL 校验的分段 JSONL records 与可选 framed binary sidecar；冻结格式或策略改变、旧 stream 损坏或无法安全续写时建立新 generation，各 generation 不自动拼接重放。
_Avoid_: Runtime generation、replication epoch、跨 generation 隐式连续日志

**语义 emission（semantic emission）**:
producer → 诊断日志 emitter 提交的 detached 语义结局——operation/stage/observedAt/source/context/result（update 以 owned bytes 表达），不含 streamId/sequence/segment/frameOffset/Base64/CRC 等物理表示（storage projection 归 adapter）。emit 同步、不 throw、不阻塞；快照与 updateBytes 所有权移交后不得再变异。update-omitted 稳定 reason 受控词表（v1）：`payload-too-large` / `update-capture-disabled` / `empty-update`——新增 reason 属词表演进，须过设计评审。
_Avoid_: 物理载体细节、append 后引用、durability promise

**storage projection**:
日志 adapter 独占的物理表示决策——先决定 inline/sidecar 并构造最终 record（segment/frameOffset/payloadLength/CRC32C/Base64），再运行 VFSL 校验；emitter 只做语义投影，不构造物理字段。
_Avoid_: 业务侧构造物理载体、emission 面物理键、VFSL 双 schema

**genesis baseline record**:
新 stream 的 genesis 基线——当时完整 Y.Doc 的 update，不是变更尝试（无 attemptId/operation/stage/result/input；顶层 `recordKind: 'genesis-baseline'` 判别）；v1 冻结的 emission/sink 公共面无构造路径，由 #152 adapter 内部构造（设计 §10-J1 备案）。
_Avoid_: attempt-started、result `'unknown'`、跨 stream genesis

**实例身份（Instance identity）**:
参与 Nomicore 复制拓扑的稳定、不可变实例身份，由安全文法 `instanceId` 与静态 `role`（Hub/Peer）组成；同一部署实例跨进程重启保持不变，是 Registry 与 transport 共同消费的单一身份事实。它不是 namespaceId、owner、SCHEMA id、connectionId、PID 或 hostname。
_Avoid_: 每次启动随机生成、Registry 与 transport 各自配置一份 role/instanceId、运行期切换身份

**Hub（中心实例）**:
静态星型复制拓扑中接受 peer WebSocket 连接、转发 Yjs updates、管理 SCHEMA 与复制身份的完整 Nomicore 实例；Hub 也是可接受本地 ROOT 业务写的副本，不是 ROOT 唯一写者，也不表示自动选举的 leader。
_Avoid_: master、leader（会误示单写权威或选举语义）、只转发而不持有完整副本的中继

**Peer（边缘实例）**:
静态连接唯一 Hub 的完整 Nomicore 实例；使用独立 Persistence，断线时保持本地 ROOT 读写，重连后按 state vector/diff 与 Hub 双向合并。Peer 之间不直连，且不能本地修改 SCHEMA 或复制身份。
_Avoid_: slave、follower（会误示只读或被动复制）

**namespaceId**:
Registry entry 与实例复制 wire 的唯一 namespace 身份，普通 create 由受控 128-bit CSPRNG 生成 `ns-` + 32 位小写 hex；Registry 在当前进程内只以 namespaceId 排他索引。Persistence 仍用 owner.userId 分区，owner 是 open/create 的本地重要属性但不上 wire，也不参与复制身份；不同实例可为同一 namespaceId 使用不同 owner。
_Avoid_: 用户可读名称、由调用方任意指定的 ID、`(owner.userId, namespaceId)` Registry key、存储层严格全局唯一承诺

**复制谱系（replication lineage）**:
由 `META.replicationId` 标识的 namespace 复制身份；只有 namespaceId、replicationId 与 replication epoch 全部匹配的副本才允许直接执行 Yjs state-vector reconciliation。replicationId 是 128-bit 随机值的固定小写 hex，不等同于 namespaceId 或 SCHEMA 信封 `id`。
_Avoid_: 仅凭 namespaceId 判断同源、把 owner 纳入 wire identity、用 SCHEMA id 充当文档实例身份

**复制代际（replication epoch）**:
`META.replicationEpoch` 中从 1 开始、只由 Hub 显式提升的安全整数；相同复制谱系但 epoch 不同的副本进入冲突状态，必须显式 reset/bootstrap，不自动覆盖或合并。
_Avoid_: 连接次数、自动选主 term、可回绕版本号

**ReplicationSession**:
由 NamespaceLease 打开的受信任 duplex raw Yjs 复制会话；冻结本地角色、远端实例、复制谱系与 epoch，提供 state vector（`encodeStateVector`）、diff（`encodeDiff`）、owned update subscription（`subscribeOwnedUpdates`）和进入本地唯一 write sequencer 的 trusted apply（`applyRemoteUpdate`）、独立状态（`getStatus`）与幂等 close（`close`），但不暴露 live Y.Doc。每 Lease 至多一个活跃 session；`close` 或 epoch fence 后进入终态（closed/conflicted）并释放槽位；host 负责只把该高级能力交给可信 transport。fanout 投递有界队列溢出将 session 标记 `needs-resync`（sticky）——transport 须 reset/bootstrap。
_Avoid_: 裸 Y.Doc WS handler、绕过本地 write sequencer 的 apply、把网络状态塞进 Runtime capability status

**复制未校验（replication-unvalidated）**:
Trusted raw Yjs update 已在 sequencer 中提交并登记 dirty，但未执行完整 VFSL ROOT 预校验的复制状态；它可能导致后续普通业务写因当前完整 ROOT 不合法而失败，不表示 transaction 可回滚或 raw update 享有 zero-write 保证。
_Avoid_: validated replication、apply 后校验失败自动 rollback

**实例角色（instance role）**:
实例身份中不可变的 hub/peer 拓扑角色；生产 composition root 配置一次，由 Instance service 同时提供给 Registry 与 transport。peer 实例的本地 replaceSchema/enableReplication/bumpReplicationEpoch 以稳定角色权限错误拒绝，session 的 localRole 必须等于实例角色。
_Avoid_: 运行期角色切换、Registry 与 transport 分别配置角色、peer 本地修改 SCHEMA 或复制身份

**authority 规则**:
旧系统的 `__authority__` manifest（enum / range / conditional / state-machine 等不变式）。**本仓库范围外**（ADR-0002）。

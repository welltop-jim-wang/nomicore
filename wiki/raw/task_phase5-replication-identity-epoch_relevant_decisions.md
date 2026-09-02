# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 任务：Phase 5: enable replication identity and epoch management（issue #132，slug: `phase5-replication-identity-epoch`，功能开发）
> 冲突基准：`docs/adr/` 全集（10 份，无整体 superseded；0006/0007/0008/0009 各自的内部修订/取代关系在对应条目注明）+ 根 `CONTEXT.md`。

---

## 相关 ADR

### ADR 0010 Hub/Peer WebSocket Y.Doc 复制与最终一致（accepted，2026-08-27）——本任务核心权威

- 与本任务的关联点：本任务实现其「复制谱系与 epoch」节的落地切片（META 两个保留字段 + Hub 管理操作 `enableReplication()` / `bumpReplicationEpoch()`）；WS transport、ReplicationSession、bootstrap/reconcile、archive/resetReplica 属后续切片，本票不实现。
- 核心条款（原文摘录）：

  「复制谱系与 epoch」节：
  - 「`META` 增加两个复制层保留字段：
    ```text
    replicationId     128-bit 随机值，编码为 32 个小写十六进制字符
    replicationEpoch  从 1 开始的十进制安全整数
    ```」
  - 「`replicationId` 是 namespace 不可变的复制谱系身份；它不同于 namespaceId 和 SCHEMA 信封 `id`。」
  - 「`replicationEpoch` 是 hub 显式提升的权威代际；达到 `Number.MAX_SAFE_INTEGER` 后拒绝继续提升，不回绕。」
  - 「hub 对现有 namespace 通过显式 `enableReplication()` 原子写入复制身份并登记 dirty；连接不得静默补写旧文档。」
  - 「hub 提供 `bumpReplicationEpoch()`，它不替换 Y.Doc 内容，但使旧 epoch 的 peer 必须显式 reset/bootstrap。」
  - 「身份与 epoch 相同才允许双向 state-vector reconciliation；缺失或不同进入稳定 `conflicted` 状态，绝不自动覆盖或合并。」

  「SCHEMA 与 META 权限」节：
  - 「`META.replicationId` 与 `META.replicationEpoch` 只能由 hub 的显式复制管理操作修改。」
  - 「SCHEMA 只允许 hub 的本地 `replaceSchema()` 修改；peer 本地调用以稳定角色权限错误拒绝。」
  - 「未来其他非保留 META 字段可另行决定双向语义；raw caller 不得逐次自定义受保护字段集合。」

  「NamespaceLease 与 ReplicationSession」节（状态归属边界，见本任务冲突报告注记 4）：
  - 「网络状态保留在 ReplicationSession/复制插件，不塞入 Runtime 的业务 capability status。」
  - 「每个 Lease 首版最多一个 duplex ReplicationSession。Session 创建时冻结 `localRole`、`remoteInstanceId`、`replicationId` 和 `replicationEpoch`，提供窄能力而不暴露 Y.Doc」（ReplicationSession 本身属后续切片）。

  「Bootstrap 与重连」节（身份不可变性与继承的上下文，bootstrap 本身属后续切片）：
  - 「peer 在 detached Y.Doc 应用基线、严格核对 META 身份，再通过 Persistence 的受控复制导入能力排他创建」
  - 「本地已存在且复制身份、epoch 相同时不做替换，直接双向交换 state vector/diff 并按 Yjs 语义合并。」

  「Trusted raw update 与现有不变量」节（保留字段保护的最终消费方，属后续切片）：
  - 「Hub 接收 peer update 前，在 scratch clone 上确认 update 不改变 SCHEMA，也不改变 META 中的复制身份保留字段。」

  「Namespace identity、owner 与复制范围」节（owner 语义，约束本票边界）：
  - 「`owner.userId` 继续是 create/open 的重要本地属性和 Persistence 分区键，但不再参与 Registry entry key或 wire identity。」

  「取代与关联」节：
  - 「本 ADR 扩展 ADR 0006 的异机冗余预留，但不改变`saveDoc`仅为dirty notification、全量snapshot、owner目录分区或单 rootDir owner语义。它为Persistence增加复制导入与归档所需的受控能力；namespaceId的概率全局唯一由生成策略负责，Persistence不增加跨owner catalog或原子唯一约束。」
  - 「本 ADR 修订 ADR 0009 的 Registry identity：entry key由`(owner.userId, namespaceId)`改为仅namespaceId；owner仍是open/create的必需本地属性、Runtime/Lease投影和Persistence分区键，owner mismatch不泄露存在性。」

### ADR 0008 NamespaceRuntime 读写能力与单序列器（accepted；含 2026-08-24「稳定码注册修订」节）

- 与本任务的关联点：enableReplication / bumpReplicationEpoch 是新的受控 Y.Doc 写（写 META），必须进入唯一 write sequencer 并遵守写槽次序、degraded/fatal/停接纳纪律；AC-5 的只读投影受本 ADR 投影条款约束。
- 核心条款（原文摘录）：

  「单一 write sequencer」节：
  - 「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer；不同 namespace 可并行。v1 公开两个窄方法：
    ```ts
    runtime.mutateRoot(mutation)
    runtime.replaceSchema({ schema: proposedEnvelope, root?: completeLogicalRoot })
    ```」（注：本任务经 ADR 0010 明文授权增加复制管理专用窄操作，见冲突报告注记 1）
  - 「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务。`notifyDirty` 是由构造方绑定 `persistence.saveDoc(handle)` 的窄接缝；Runtime 不依赖整个 `DocPersistence`。成功只表示 live commit 与 dirty notification 已登记，不表示已经落盘。」
  - 「`persistence-degraded` 阻止 ROOT、SCHEMA 以及未来所有 Y.Doc 写；它不阻止 read 或不写 Y.Doc 的 P0。gate 是瞬时观察：检查后才发生的降级不撤销已提交事务，dirty notification 仍必须登记最新 live doc。」

  「读取能力」节（同步只读投影）：
  - 「`getMetadata()` 深拷贝顶层 `META` Y.Map 的全部键；META 是开放键空间，但值只允许 JSON-compatible plain value，不允许嵌套 Yjs shared type；v1 不提供 META 写；」（注：「不提供 META 写」指通用 META 写面；专用复制管理写由 ADR 0010 授权，见冲突报告注记 1）
  - 「`getSchemaEnvelope()` 从顶层 `SCHEMA` Y.Map 投影 `lang/version/id/text` 四个 primitive string，忽略额外键，不 coercion 或补默认值」
  - 「读取只观察调用瞬间已经提交的 live Y.Doc，不等待已接纳但尚未提交的写。调用方需要 read-your-write 时必须先等待对应写 Promise。」

  「Fatal 与失败通道」节：
  - 「任何 internal fatal——无论 committed 与否——都永久关闭该 Runtime 的全部写能力并保留读取」
  - 「post-commit fatal 以带 `committed:true` 的稳定 `RuntimeWriteFatalError` reject，上层不得自动重试非幂等写」
  - 「已排队的后续写仍按 FIFO 取得槽，且不访问输入、零写入返回 `RUNTIME_WRITE_DISABLED`。」

  「生命周期、状态与所有权」节：
  - 「`close()` 幂等。首次调用同步进入 `closing`，立即停止接纳公共 read 和 write，并在队尾加入 close barrier；此前已接纳任务无条件排空，不取消、不设内部 timeout。」
  - 「Runtime 提供结构化瞬时 capability status，而不是单一扁平枚举：lifecycle、read、ROOT write、SCHEMA write，以及稳定且不含原始 Error/stack/SCHEMA 全文/ROOT 数据的 schema、fatal、close issue 摘要。status 不暴露队列长度、任务类型或 sequence。」
  - 「Runtime 不公开 handle、Y.Doc、ROOT/SCHEMA/META live 引用或生产构造器。」
  - 「Runtime 公开冻结的 `owner.userId` 与 `namespaceId` 身份投影；它们是分区/文档身份，不代表授权。」

  「稳定码注册修订（2026-08-24，issue #93）」节：
  - 「read 停接纳稳定码 `RUNTIME_READ_DISABLED`」
  - 「`RUNTIME_WRITE_DISABLED` 码域澄清」：统一码族覆盖「fatal 已置位后的排队写、写前 writable gate 拒绝（handle 状态非 ready：persistence-degraded / released / disposed 三态同拒）、notifyDirty 未绑定的构造方义务 loud gate、close 后 lifecycle≠ready 的接纳拒绝」——「区分域靠 issue message 文案，不另设新码」。
  - 「close 拒绝稳定码 `NSRT-CLOSE-RELEASE-FAILED`」

### ADR 0009 NamespaceRegistry、调用方租约与 Cordis Host 生命周期（accepted；含 issue #131 修订节）

- 与本任务的关联点：唯一 Runtime/唯一 sequencer 是全系统安全不变量；AC-5 的 Open 语义与 Lease 能力代理边界；#131 已交付的 CSPRNG 注入纪律是 replicationId 随机生成的既有同款纪律。
- 核心条款（原文摘录）：

  「背景」节：
  - 「若 REST、WS 或管理任务分别从 Persistence 加载 handle 并构造 Runtime，同一个 live Y.Doc 会出现多个 sequencer，破坏"同一 namespace 的所有受控写严格 FIFO"这一安全不变量。」

  「唯一 Runtime 与同键生命周期串行」节：
  - 「Registry key 是 `(owner.userId, namespaceId)`。同一 Registry 进程内，每个 key 同时最多存在一个 Runtime；不同 key 可以并行。」（注：该 key 条款已被 ADR 0010 / 本 ADR 修订节 1 改为仅 namespaceId）

  「NamespaceLease」节：
  - 「成功 open/create 返回独立 `NamespaceLease`。Lease 是调用方唯一能力入口，代理 Runtime 除 `close()` 外的同步读取、投影、status、ROOT mutation 和 SCHEMA replacement；不公开裸 Runtime、DocHandle、Y.Doc 或 live Yjs 引用。」

  「Open」「空闲保留」节：
  - 「open 在 Persistence load 成功且 Runtime 构造完成后立即成功。它不等待 P0，不编译 schema，也不验证 ROOT；preparing、unavailable、fatal 和 persistence-degraded 由 Runtime status 表达，不代表 namespace 不存在。」
  - 「fatal 和 persistence-degraded 只改变 Runtime capability，不改变 open 或 idle retention 语义。」

  「修订节：issue #131（Phase 5 切片 1）」：
  - 「本节修订本文原有的复合 key 与 caller-selected namespaceId 条款；namespace identity、owner、普通 create 的 ID 生成与碰撞处理均以 ADR 0010……为唯一权威来源，不在本 ADR 重复定义。」
  - 「Registry 的构造能力增加必需的 `randomBytes(length): Uint8Array` 注入，生产 Host Adapter 使用 `node:crypto`，核心不得回退到全局随机源。」

### ADR 0006 Cordis 持久化插件——DocPersistence 接口与 doc 三条目内容布局（accepted；含 #64/#79 修订节与 #131 对齐说明）

- 与本任务的关联点：enable/bump 的 dirty notification 语义、persistence-degraded 拒绝面归属、META 布局与持久层校验边界（持久层只校验 META.docId）、owner 分区不变。
- 核心条款（原文摘录）：

  「决策」节：
  - 「**saveDoc = 脏状态通知，不是同步落盘**：持有有效 handle 的调用方在 Doc 每次发生变更后调用 saveDoc 通知持久层；saveDoc 返回仅表示脏状态已登记，不构成该次写入已落盘的承诺」
  - 「**save 失败按 doc 只读降级，保留内存事务**：……失败后 namespace 进入 `persistence-degraded`，保留读/查询与已同步状态，拒绝**后续** REST/WS 写入；……不关闭整个 server。」

  「v1 磁盘布局与持久化格式」节：
  - 「`META.docId` 必须等于请求的 namespaceId；不一致视为持久化损坏并响亮失败。`owner` 仍不写入 META（用户归属由目录分区承载）。」

  「doc 内容布局（三条目）」节：
  - 「Y.Doc ├── SCHEMA 信封（lang, version, id, text）…… ├── META 元信息（Y.Map：docId, createdAt）——我是谁 └── ROOT 数据根——内容本体」（注：META 复制保留字段由 ADR 0010 明文增加，见冲突报告注记 2）
  - 「META/SCHEMA 作为 ROOT 的兄弟条目，天然在 validateSnapshot/validatePatch 的校验面之外（校验只作用 ROOT 子树）。」
  - 「`META.createdAt` 由上层 namespace lifecycle 生成和维护；持久层不生成、不修改、不校验该字段（持久层只校验 META.docId）」

  「DocHandle entry status 与 saveDoc 职责修订（issue #79）」节：
  - 「saveDoc 是 **mutation 后的 dirty notification**：只要租约有效（未 released、非 foreign、身份匹配、Persistence 未 disposed），saveDoc 必须递增 dirtyGeneration 并 resolve——entry 处于 `persistence-degraded` **不构成拒绝理由**」
  - 「拒绝面归属**业务编排层**：Runtime（ADR 0007 NamespaceRuntime 写前 gate）在业务 mutation 前读取 `handle.getStatus()`，已 degraded 则拒绝开始新写入（零写入：文档不变、响亮拒绝）。」
  - 「gate 检查通过后才转为 degraded 的 mutation 不属「后续」写入：其内存事务保留、saveDoc 正常登记、由 retry 覆盖最新完整 live Y.Doc」
  - DocHandleStatus 枚举：「`'ready' | 'persistence-degraded' | 'released' | 'disposed'`」，优先级「`disposed` > `released` > entry 状态」

  「对齐说明：issue #131」节：
  - 「本说明只对齐 Registry 身份演进，**不修改本 ADR 任何 Persistence 契约条款**。……仍按 owner 分区，`createDoc(owner, docId, doc)` 仍以 `(owner.userId, docId)` 排他创建并通过 `DOC_DUPLICATE` 报告重复；不新增跨 owner catalog 或全局唯一约束。」

### ADR 0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted；Runtime/open/read 条款由 ADR 0008 部分取代）

- 与本任务的关联点：仍然有效的条款是「业务写串行化 + 写后标脏 + 调用方不得取得可写 Yjs 引用」；被 ADR 0008 取代的 open/read 编排与 schema-aware 读取**不构成约束**。
- 核心条款（原文摘录）：
  - 「NamespaceRuntime 将来按 namespace 串行化所有业务写入：轮到 mutation 时先检查 writable gate，同步调用 `applyValidatedMutation`，成功后立即调用 persistence `saveDoc` 标脏。业务调用方不得取得可写 Yjs 引用或绕过该入口；未来原始 Yjs update 必须另设受控验证通道。」
  - 「ADR 0008 取代本文 schema-aware `readLogicalValueAtPath(derived, doc, path)` 以及"普通 open 完成 schema 编译、META 检查、ROOT 提取和 logical validation 后才注册 Runtime"的 Runtime/open/read 条款。」

### ADR 0001 / 0002 / 0003 / 0004 / 0005（均为 accepted）

- 与本任务的关联点：仅间接（doc 顶层具名条目、schema/codegen 面背景）；本任务不触碰 VFSL 文本、方言、投影生成管线与 authority 边界。
- 对照结论：无冲突，无本任务可直接引用的约束条款；0001 的「SCHEMA 信封键名 `SCHEMA`、META/SCHEMA/ROOT 顶层具名条目」命名纪律与 0002 的「authority 完全出范围」作为背景保留。

---

## CONTEXT.md 相关术语与惯例

- **复制谱系（replication lineage）**（原文摘录）：「由 `META.replicationId` 标识的 namespace 复制身份；只有 namespaceId、replicationId 与 replication epoch 全部匹配的副本才允许直接执行 Yjs state-vector reconciliation。replicationId 是 128-bit 随机值的固定小写 hex，不等同于 namespaceId 或 SCHEMA 信封 `id`。」
  _Avoid_: 「仅凭 namespaceId 判断同源、把 owner 纳入 wire identity、用 SCHEMA id 充当文档实例身份」
- **复制代际（replication epoch）**（原文摘录）：「`META.replicationEpoch` 中从 1 开始、只由 Hub 显式提升的安全整数；相同复制谱系但 epoch 不同的副本进入冲突状态，必须显式 reset/bootstrap，不自动覆盖或合并。」
  _Avoid_: 「连接次数、自动选主 term、可回绕版本号」
- **Hub（中心实例）**（原文摘录）：「静态星型复制拓扑中接受 peer WebSocket 连接、转发 Yjs updates、管理 SCHEMA 与复制身份的完整 Nomicore 实例；Hub 也是可接受本地 ROOT 业务写的副本，不是 ROOT 唯一写者，也不表示自动选举的 leader。」
  _Avoid_: 「master、leader……只转发而不持有完整副本的中继」
- **Peer（边缘实例）**（原文摘录）：「静态连接唯一 Hub 的完整 Nomicore 实例；……Peer 之间不直连，且不能本地修改 SCHEMA 或复制身份。」
  _Avoid_: 「slave、follower……」
- **namespaceId**（原文摘录）：「Registry entry 与实例复制 wire 的唯一 namespace 身份，普通 create 由受控 128-bit CSPRNG 生成 `ns-` + 32 位小写 hex；Registry 在当前进程内只以 namespaceId 排他索引。Persistence 仍用 owner.userId 分区，owner 是 open/create 的本地重要属性但不上 wire，也不参与复制身份；不同实例可为同一 namespaceId 使用不同 owner。」
  _Avoid_: 「用户可读名称、由调用方任意指定的 ID、`(owner.userId, namespaceId)` Registry key、存储层严格全局唯一承诺」
- **写序列器（write sequencer）**（原文摘录）：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。」
  _Avoid_: 「mutation queue（范围过窄，容易让 SCHEMA/META 管理写建立旁路）」
- **停接纳（stop-acceptance）**（原文摘录）：「close 首次调用同步进入 `closing` 后，capability 槽立即停止接纳新调用：read 同步结果联合返回 `RUNTIME_READ_DISABLED` 分支……；三个数据投影 getter（getSchemaEnvelope / getMetadata / getActiveSchema）与 read 同属停接纳范围——同步 loud throw 稳定码 `RUNTIME_READ_DISABLED`……；mutateRoot/replaceSchema 经 Promise settle 含 `RUNTIME_WRITE_DISABLED` 的零写入结果……；close 前已接纳任务仍无条件排空。internal fatal 只永久禁写并保留读取，不触发 read/getter 停接纳。getStatus 全生命周期可用（生命周期观测面，非数据投影），不在停接纳范围。」
  _Avoid_: 「把 lifecycle 失败伪装成路径失败码、把停接纳误解为取消已接纳任务、把停接纳误读为 getStatus 不可用」
- **ReplicationSession / 复制未校验（replication-unvalidated）**：属后续切片（本票不实现），词义见 CONTEXT.md 原文 125–131 行；本票设计中不得提前实现其能力面。

---

## 全链 SA 使用提示（中性指针，非裁决）

1. enable/bump 属受控 Y.Doc 写：必须进入唯一 write sequencer 的完整槽序（lifecycle/fatal gate → writable gate → 输入快照 → 领域校验 → 单次 transaction → `await notifyDirty()`）。
2. 两个保留字段的格式与不可变性以 ADR 0010「复制谱系与 epoch」节为唯一权威；epoch 达 `Number.MAX_SAFE_INTEGER` 拒绝提升、不回绕。
3. degraded / fatal / 停接纳 / close 语义全部沿用 ADR 0006(#79)/0008 既有纪律（`RUNTIME_WRITE_DISABLED` 码族、committed 事实、getStatus 全生命周期可用）。
4. 投影面遵守 ADR 0008：getMetadata 深拷贝、值仅 JSON-compatible plain value；不暴露 live META 引用。
5. 网络状态不进 Runtime capability status（ADR 0010）；本票只暴露身份/epoch 的持久事实。
6. 随机生成纪律沿 #131 交付的受控 CSPRNG 注入模式（ADR 0009 修订节 3 同款纪律：核心不得回退到全局随机源）。

---

## 设计后复审追加（R1 设计引入的新决策点 → ADR 锚定）

> SA8 设计后复审（R1，2026-08-27）追加：登记 SA1 设计（`task_phase5-replication-identity-epoch_design.md`）引入、全链（SA2 评审 / SA3 实现 / SA4 复核）需沿用的决策点及其 ADR 锚定。仍只摘录与锚定，不裁决；裁决见 `task_phase5-replication-identity-epoch_design_conflict_report.md`。

1. **overflow 拒绝通道 = 结果面 `ok:false`**（设计 D-6；SA6 锚点 1）——ADR 0010 只冻结语义：「`replicationEpoch` 是 hub 显式提升的权威代际；达到 `Number.MAX_SAFE_INTEGER` 后拒绝继续提升，不回绕」；通道归属由 ADR 0008「Fatal 与失败通道」节裁决：「普通、可预期且零写入的读取或写入失败使用领域化结果联合」。overflow 是确定性域边界、判据先于任何 +1 运算的零写入失败 → 结果联合是 ADR 明文通道；internal fatal 通道不适用（ADR 0008：「任何 internal fatal——无论 committed 与否——都永久关闭该 Runtime 的全部写能力并保留读取」——把预期的域边界拒绝升格为永久禁写与该条款矛盾）。CONTEXT.md「复制代际」Avoid「可回绕版本号」→ 判据先于 +1、MAX+1 永不被计算/存储。
2. **status `replication` 域 = 第八键 append-only 扩展**（设计 D-4）——遵守 ADR 0008 全部负面约束：「status 不暴露队列长度、任务类型或 sequence」「稳定且不含原始 Error/stack/SCHEMA 全文/ROOT 数据」；getStatus 全生命周期可用（CONTEXT.md「停接纳」词条：生命周期观测面，不在停接纳范围）；ADR 0010「网络状态保留在 ReplicationSession/复制插件，不塞入 Runtime 的业务 capability status」——本域只含身份/epoch 持久事实（`{state:'disabled'} | {state:'enabled'; replicationId; replicationEpoch}`，无第三态），不含网络状态，不为后续切片预留 conflicted/bootstrap 键位。
3. **构造期 V2.5 复制事实纯读预投影**（设计 §4.4）——不触碰 ADR 0008「普通 open 不执行 schema、ROOT 载体或 logical validation」的排除面（META 身份读取是投影非校验）；P0 职责不变（ADR 0008「P0 只读取 SCHEMA 标准四键……不读取、提取或验证 ROOT」）；META 保留字段损坏 loud（部分存在/格式违约/载体异型 → 构造 throw 或槽内 internal fatal committed:false）属 ADR 0006「`META.docId` 必须等于请求的 namespaceId；不一致视为持久化损坏并响亮失败」同族；open 失败通道 = ADR 0009 初始 fatal phase `runtime-construction`。
4. **随机源归属 = Registry 已注入 `randomBytes` 值输入，Runtime 零随机依赖**（设计 D-1）——ADR 0009 修订节 3：「Registry 的构造能力增加必需的 `randomBytes(length): Uint8Array` 注入，生产 Host Adapter 使用 `node:crypto`，核心不得回退到全局随机源」；`/internal` 工厂 2 参签名不变；replicationId 复用同一 16 字节受控源，编码为 32 位小写 hex、无 `ns-` 前缀（ADR 0010 冻结格式；`ns-` 前缀仅属 namespaceId）；无重试环（replicationId 非 key、无碰撞检测面）。
5. **Hub-only 可锚定面 = 独占写面**（设计 §4.1(d)/§4.9-9）——ADR 0010「`META.replicationId` 与 `META.replicationEpoch` 只能由 hub 的显式复制管理操作修改」；本票暴露层级与 replaceSchema（ADR 0010「SCHEMA 只允许 hub 的本地 `replaceSchema()` 修改」）完全同构（生产中唯一构造/持有 Runtime 的是 Registry，调用方唯一可达面是 Lease）；peer 角色拒绝属后续切片（ReplicationSession / authorization Adapter / trusted apply 角色门）。
6. **幂等再 enable = 零写入、零 dirty 通知**（设计 D-5）——ADR 0006：「持有有效 handle 的调用方在 Doc **每次发生变更后**调用 saveDoc 通知持久层」——条件性义务，无变更即无通知；身份不变落实 ADR 0010「`replicationId` 是 namespace 不可变的复制谱系身份」；AC-3 二选一中取幂等路径（SA6 锚点明文兼容）。
7. **E5.5 复制事实同步整替时序**（设计 §4.2）——镜像 ADR 0008 SCHEMA 写槽第 5 步先例：「transaction 返回后立即安装新 active tools，再 `await notifyDirty()`」；notify-dirty 失败 → `RuntimeWriteFatalError('notify-dirty-failed', committed:true)` 且已提交事实不回滚（ADR 0008「不补偿、不 fallback、不声称 rollback」+「committed:true 或未知异常保守视为可能已提交」）。
8. **复制写槽 degraded 拒绝面与码域**（设计 D-2/E2/D-9）——ADR 0008：「`persistence-degraded` 阻止 ROOT、SCHEMA 以及未来所有 Y.Doc 写」（「未来所有」明文预留新写类）；停接纳/禁用四类复用 `RUNTIME_WRITE_DISABLED` 码族（ADR 0008 稳定码注册修订 #2，区分域靠 message）；域级拒绝另设 `REPLICATION_*` 稳定 message 常量 + `NSRT-FATAL-REPLICATION-WRITE-INTERNAL` code（errors.ts append-only 注册表纪律，修订 #5：ADR 记录决策词汇，不复制实现注册表）。
9. **复制写与 schema 状态正交**（设计 §4.2）——enable/bump 排队等待 P0 后执行（ADR 0008「早期写排在 P0 后」）；不依赖 active schema 可编译（ADR 0008 仅要求 ROOT write 依赖 active schema：「没有可用 schema 时零写入失败」是 ROOT write 条款；SCHEMA write 与 META 层写不在该依赖面内）。
10. **普通业务写 zero-touch 复制字段 = 结构性保证**（设计 D-10）——ADR 0006：「META/SCHEMA 作为 ROOT 的兄弟条目，天然在 validateSnapshot/validatePatch 的校验面之外（校验只作用 ROOT 子树）」；mutateRoot 读写面钉死 ROOT 子树全量重建，META 不可达。

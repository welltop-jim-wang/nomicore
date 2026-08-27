# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（任务：Phase 5 generate namespaceId and migrate Registry identity，issue #131）。
> 只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 冲突基准：ADR 0001–0010 全集 + `CONTEXT.md`（phase-5 交付文档为任务声明的补充设计基准，单独标注）。

## 相关 ADR

ADR 0001–0005（VFSL 真相源 / 重写定位 / 求值器 / 类型投影 / 生成管线）与本任务的
namespace 身份主题无关联条款，未收录。

### ADR 0006 Cordis 持久化插件——DocPersistence 接口与 owner 分区（accepted，含 issue #64 / #79 修订节）

- 与本任务的关联点：AC-2/AC-5 依赖 Persistence 的 owner 分区、排他创建与 duplicate 信号；生成的 namespaceId 必须满足其安全文法。
- 核心条款（原文摘录）：
  - 「**user 仅作分区键**：本层不鉴权；userId 与 namespaceId 均由 NomicoreServer 分配，作为受控安全路径段使用（不允许特殊字符/路径分隔符）。存储按用户分区，namespaceId 在用户目录内唯一。」
  - 「**v1 不提供 list**：per-user 枚举用到再补；」
  - 「`META.docId` 必须等于请求的 namespaceId；不一致视为持久化损坏并响亮失败。`owner` 仍不写入 META（用户归属由目录分区承载）。userId 与 namespaceId 共用安全文法 `^[a-z][a-z0-9-]{0,62}$`：同一标识可直接用于目录、REST path、WS room 与 META，无需额外编码/hash/转义。」
  - 磁盘布局（v1 全量快照原子覆盖节）：`users/{userId}/{namespaceId}.snapshot  # 用户目录内唯一的 namespace 快照`
  - issue #64 修订节：「`DocPersistence` 提供 `createDoc(owner, docId, doc): Promise<DocHandle>`，对 `(owner.userId, docId)` 排他创建：cache/store 已存在或并发创建 → 拒绝 `DocDuplicateError`（稳定错误码 `DOC_DUPLICATE`）；**在 duplicate 判定路径上绝不覆盖已提交内容**」
  - issue #64 修订节：「持久层仍仅校验 `META.docId === docId`，不校验 VFSL/ROOT/createdAt」
  - issue #64 修订节：「两 Adapter 必须通过同一组 createDoc shared contract tests。」（AC-6 测试面的既有纪律）

### ADR 0008 NamespaceRuntime 读写能力与单序列器（accepted，含 #93 稳定码注册修订）

- 与本任务的关联点：AC-3/AC-4 的「Runtime 复用按 namespaceId」「project owner」延续其身份投影条款。
- 核心条款（原文摘录）：
  - 「Runtime 公开冻结的 `owner.userId` 与 `namespaceId` 身份投影；它们是分区/文档身份，不代表授权。」
  - （背景参照）「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer；不同 namespace 可并行。」

### ADR 0009 NamespaceRegistry、调用方租约与 Cordis Host 生命周期（accepted；Registry identity 条款已被 ADR 0010 显式修订）

- 与本任务的关联点：本任务直接改写其 Registry key、create 输入与 duplicate 语义；lifecycle 串行、lease 投影、fatal 结构、shutdown 与测试 seam 均维持效力。
- 核心条款（原文摘录）：
  - 「Registry key 是 `(owner.userId, namespaceId)`。同一 Registry 进程内，每个 key 同时最多存在一个 Runtime；不同 key 可以并行。」← **已被 ADR 0010 修订为仅 namespaceId**（见 ADR 0010 摘录）
  - 「同 key 的 open、create 和 Runtime generation close 按同步接纳顺序串行。每个操作取得 lifecycle 槽后，根据当时的 Registry/Persistence 事实独立结算；前项的领域失败或 branded rejection 不成为后项结果，也不毒化 queue tail。」
  - 「成功 open 后，后续 open 直接复用 active Runtime；失败后，后续 open 独立重试 load。」
  - 「每个 lease 公开独立冻结的 owner 投影和 namespaceId。owner 是存储分区身份，不表示当前访问者，也不证明 authorization；authorization 必须在 Registry 之前完成。」
  - 空闲保留：「最后一个 lease 释放后，Runtime 进入 idle，而不是立即 close。Registry 使用 `ctx.timeout()` 启动完整的 `idleTimeoutMs`，默认 300,000 ms」（AC-2 的 active/idle/closing entry 状态面来源）
  - Open：「Registry 在读取 entry 或 Persistence 之前，用共享安全文法校验 owner.userId 和 namespaceId。invalid identity、not found、typed load operational failure 和 Registry not accepting 使用窄 `OpenNamespaceIssue`。公开 issue 不回显 identity 或原始异常。」
  - Create：「create 输入只包含 owner、namespaceId、schema 和完整 logical ROOT。调用方不提供 META 或 createdAt，也不能省略 ROOT 让 Registry猜测默认值。」← **其中 namespaceId 输入已被 ADR 0010 移除**
  - Create：「create 取得 lifecycle 槽后才读取并冻结输入；排队期间调用方可修改引用。输入缺陷仅使当前 create 失败，不毒化 key queue 或整个 Registry。完整 snapshot、compile、validate、detached construction、Persistence create 和 Runtime construction 均在同一个 lifecycle 槽中执行，不产生跨时间 prepared document。」
  - Create：「`META.docId` 等于 namespaceId。`META.createdAt` 由 `new Date(ctx.clock.now()).toISOString()` 生成固定 UTC ISO 字符串；非法 Clock 输出属于 `create-document-internal`、`committed:false` fatal。owner 只作为 Persistence 分区键，不写入 META。」
  - Create：「只有全部准备成功才调用排他的 `createDoc()`。active、idle、并发或 persisted duplicate 统一映射为 `NAMESPACE_ALREADY_EXISTS`；create 不退化为 open 或 upsert。」← **普通 create 的 duplicate 面已被 ADR 0010 的重试语义取代（见冲突报告对照点 3）**
  - Create：「如果 createDoc 已提交而 Runtime 构造失败，Registry 释放 handle、保留持久化文档、清理 entry，并以 `committed:true` Registry fatal reject。不得补偿删除、fallback 或声称 rollback；调用方不得自动重试 create，后续可 open 已创建 namespace。」
  - Fatal：「结果联合外 internal failure使用 `NamespaceRegistryFatalError`，至少携带 operation、stable phase、committed 和 cause。初始 phase 是：`runtime-construction`；`create-document-internal`；`lifecycle-slot-internal`。」（「初始」为开放清单——本任务需注册新的耗尽 phase，见文末事实性提示）
  - 脱敏：「公开 issue/error message不包含 owner/namespace原值、SCHEMA全文、ROOT/input数据、原始异常文本或stack。」
  - Shutdown：「首次 shutdown 在调用栈内同步进入 `shutting-down` 并停止接纳 open/create；两者统一返回 `REGISTRY_NOT_ACCEPTING` 且不访问输入。shutdown 取消全部 idle timer，等待此前已接纳的 lifecycle 操作结算，然后主动 close 全部 active/idle Runtime，不等待外部 lease release。」
  - 公共 Interface：「v1不公开list、entry status、lease count、queue、timer handle、explicit eviction、按key close或公共events。」
  - 依赖纪律：「缺失任何依赖均在 plugin 启动时响亮失败，不 fallback 到 `Date.now()` 或全局 timer。」（受控随机源 capability 沿用同款纪律，见 ADR 0010 + phase 文档切片 1）

### ADR 0010 Hub/Peer WebSocket Y.Doc 复制与最终一致（accepted）——本任务的操作性依据

- 与本任务的关联点：其「Namespace identity、owner 与复制范围」节逐句决定了本任务全部 AC；本任务即该节（与 phase-5 切片 1 身份部分）的实现票。
- 核心条款（原文摘录）：
  - 「Registry entry key 修订为仅 `namespaceId`。普通 `Registry.create()` 不再接受调用方指定 namespaceId，而由注入的受控 128-bit CSPRNG 生成 `ns-` + 32 位小写 hex；撞到当前 Registry entry 或目标 Persistence duplicate 时最多重试 8 次，耗尽以 `committed:false` Registry fatal 失败。复制 bootstrap 使用内部受信任导入保留 Hub namespaceId，不是普通 create。该身份是概率全局唯一；Persistence 不维护跨 owner 全局 catalog或原子唯一约束。」
  - 「`owner.userId` 继续是 create/open 的重要本地属性和 Persistence 分区键，但不再参与 Registry entry key或 wire identity。普通 open仍显式接收 owner并在复用 active entry前核对；不匹配统一返回 `NAMESPACE_NOT_FOUND`。Hub 与 Peer可为同一 namespaceId使用不同 owner，owner不写入同步 META，也不上 wire。」
  - 「声明式通配 selector 与 namespace discovery/list 留待后续，避免提前扩张 Registry/Persistence 公共面。」
  - Bootstrap 边界：「peer 不得普通 create 一个准备从 hub 复制的同 key namespace；首次 bootstrap 继承 hub 的完整 META 身份。」
  - 取代与关联：「本 ADR 扩展 ADR 0006 的异机冗余预留，但不改变`saveDoc`仅为dirty notification、全量snapshot、owner目录分区或单rootDir owner语义。它为Persistence增加复制导入与归档所需的受控能力；namespaceId的概率全局唯一由生成策略负责，Persistence不增加跨owner catalog或原子唯一约束。」
  - 取代与关联：「本 ADR 修订 ADR 0009 的 Registry identity：entry key由`(owner.userId, namespaceId)`改为仅namespaceId；owner仍是open/create的必需本地属性、Runtime/Lease投影和Persistence分区键，owner mismatch不泄露存在性。」

## CONTEXT.md 相关术语与惯例

- **namespaceId**（原文摘录）：
  「Registry entry 与实例复制 wire 的唯一 namespace 身份，普通 create 由受控 128-bit CSPRNG 生成 `ns-` + 32 位小写 hex；Registry 在当前进程内只以 namespaceId 排他索引。Persistence 仍用 owner.userId 分区，owner 是 open/create 的本地重要属性但不上 wire，也不参与复制身份；不同实例可为同一 namespaceId 使用不同 owner。
  _Avoid_: 用户可读名称、由调用方任意指定的 ID、`(owner.userId, namespaceId)` Registry key、存储层严格全局唯一承诺」
- **复制谱系（replication lineage）**（边界提示——勿与 namespaceId 混淆，原文摘录）：
  「由 `META.replicationId` 标识的 namespace 复制身份；只有 namespaceId、replicationId 与 replication epoch 全部匹配的副本才允许直接执行 Yjs state-vector reconciliation。replicationId 是 128-bit 随机值的固定小写 hex，不等同于 namespaceId 或 SCHEMA 信封 `id`。
  _Avoid_: 仅凭 namespaceId 判断同源、把 owner 纳入 wire identity、用 SCHEMA id 充当文档实例身份」

## 任务声明的补充设计基准（phase-5 交付文档，非 ADR、非冲突基准）

`docs/phases/phase-5-websocket-replication.md` §实施切片 1（原文摘录）：

- 「Registry entry key由`(owner.userId, namespaceId)`改为仅namespaceId；open/create仍接收并核对owner，owner mismatch统一not found。」
- 「普通create不接受调用方namespaceId；受控128-bit CSPRNG生成`ns-`+32位小写hex，碰撞最多重试8次。」
- 「Persistence继续按owner分区，不增加跨owner catalog；复制内部导入保留Hub namespaceId。」
- 「为Host增加可测试的随机字节/ID capability；核心不得直接调用不受控全局crypto。」
- 同切片还包含「`META.replicationId`与`META.replicationEpoch`投影、严格格式校验和保留字段定义」「Hub管理操作：`enableReplication()`与`bumpReplicationEpoch()`」——**不在本任务 AC-1..AC-7 验收范围内**（总控拆片决定；见冲突报告结论节的范围观察）。

## 事实性提示（供 SA1/SA3 注册，非裁决）

1. AC-2 的耗尽 fatal 需要一个新的稳定 `NamespaceRegistryFatalError` phase——ADR 0009 的 phase 清单是「初始」集合（开放清单），ADR 0010 已裁决该 fatal 存在；命名属 SA1 设计职权。
2. 普通 create 的 ID 碰撞改为内部重试后，`NAMESPACE_ALREADY_EXISTS` 对普通 create 不再可达；该码是否保留于公共错误注册表、还是仅由受信任导入路径可达，属 SA1 设计点（ADR 0010 未逐字规定）。
3. 受控随机源 capability 的注入与「缺失即响亮失败、不 fallback 全局 crypto」纪律，是 ADR 0009 依赖纪律与 phase 文档切片 1 的组合推论，SA1 需在设计中落位。
4. 生成的 `ns-`+32 小写 hex 共 35 字符，满足 ADR 0006 共享安全文法 `^[a-z][a-z0-9-]{0,62}$`，可直接用于 Persistence 目录、META.docId 与未来 REST path/WS room。

# ADR 0009：NamespaceRegistry、调用方租约与 Cordis Host 生命周期

日期：2026-08-25
状态：已接受（Phase 4 NamespaceRegistry 设计；Phase 3 PR #85 合入后实施）

## 背景

ADR 0008 冻结了单个 namespace 的 `NamespaceRuntime`：同步读取、P0、唯一 write sequencer、ROOT/SCHEMA 写、fatal/status/close。Host 仍缺少多调用方共享 Runtime 的生命周期编排。若 REST、WS 或管理任务分别从 Persistence 加载 handle 并构造 Runtime，同一个 live Y.Doc 会出现多个 sequencer，破坏“同一 namespace 的所有受控写严格 FIFO”这一安全不变量。

Registry 还必须解决排他创建、并发 open/create、调用方使用权、短 REST 请求间的 Runtime 复用、Host shutdown，以及 Persistence 创建失败的真实提交事实。这些责任不属于单 Runtime，也不属于只管理 Y.Doc 存储与 flush 的 Persistence。

## 决策

### 模块与 Cordis service

建立 `@nomicore/namespace-registry`。同一 package 包含 Host 无关的 Registry 核心、通用 Cordis plugin Adapter 和受控 testing subpath，并通过 `ctx.nomicoreRegistry` 向 DSH 与未来 NomicoreServer 提供同一个 `NamespaceRegistry`。

`NamespaceRuntime` 继续是普通模块，不成为 per-namespace plugin。Registry 通过 `@nomicore/namespace-runtime/internal` 唯一导出的 `createNamespaceRuntimeForRegistry` 构造生产 Runtime；主 entry 不公开生产 Runtime 构造器。模块边界测试限制该 internal subpath 只能由 Registry 生产代码消费。

Registry plugin 强依赖：

- Cordis Timer plugin 的 `ctx.timeout()`，负责 plugin-lifetime 的一次性延迟调度；
- `@nomicore/clock` 提供的通用 `ctx.clock`，其 `now()` 返回可跳变的 Unix epoch milliseconds；
- Nomicore Persistence 的 `ctx.nomicorePersistence`。

缺失任何依赖均在 plugin 启动时响亮失败，不 fallback 到 `Date.now()` 或全局 timer。`@nomicore/dsh-persistence` 包名保持不变；Persistence Cordis service 从 `docPersistence` 迁移为 `nomicorePersistence`。

### 唯一 Runtime 与同键生命周期串行

Registry key 是 `(owner.userId, namespaceId)`。同一 Registry 进程内，每个 key 同时最多存在一个 Runtime；不同 key 可以并行。

同 key 的 open、create 和 Runtime generation close 按同步接纳顺序串行。每个操作取得 lifecycle 槽后，根据当时的 Registry/Persistence 事实独立结算；前项的领域失败或 branded rejection 不成为后项结果，也不毒化 queue tail。旧异步操作只能按 entry identity/generation 清理自己，不得删除后来建立的新 entry。

成功 open 后，后续 open 直接复用 active Runtime；失败后，后续 open 独立重试 load。open/create 互相排序，但后项不继承前项失败：例如 load I/O 失败后的 create 仍独立调用 Persistence，由 Persistence 的原子 create/duplicate 语义裁决。

### NamespaceLease

成功 open/create 返回独立 `NamespaceLease`。Lease 是调用方唯一能力入口，代理 Runtime 除 `close()` 外的同步读取、投影、status、ROOT mutation 和 SCHEMA replacement；不公开裸 Runtime、DocHandle、Y.Doc 或 live Yjs 引用。

每个 lease 公开独立冻结的 owner 投影和 namespaceId。owner 是存储分区身份，不表示当前访问者，也不证明 authorization；authorization 必须在 Registry 之前完成。

首次 `release()` 在调用栈内同步将 lease 标记为 released，之后不再接纳新操作。重复 release 返回 exact same Promise。`[Symbol.asyncDispose]()` 委托同一个 release operation。release 不追踪或等待此前已经由 Runtime 接纳的写；这些写仍由 Runtime sequencer 管理。

release 后，除 `getStatus()` 外的操作通过其既有同步/异步结果通道返回稳定 `NAMESPACE_LEASE_RELEASED`。Lease status 分离 lease lifecycle 与 Runtime capability；released lease 返回 `lease: released` 和 `runtime: null`。

### 空闲保留

最后一个 lease 释放后，Runtime 进入 idle，而不是立即 close。Registry 使用 `ctx.timeout()` 启动完整的 `idleTimeoutMs`，默认 300,000 ms；每次 active 再次进入 idle 都重置完整时限。配置必须是 `0..2_147_483_647` 的有限整数；零仍异步调度，不在 release 调用栈同步 close。

idle 期间 open 同步取消 timer、转回 active 并签发 lease。若 timer callback 先同步将 entry 转为 closing，则该转换不可逆；后续 open 等待同一个 close Promise 结算，再 load 并建立新 generation。fatal 和 persistence-degraded 只改变 Runtime capability，不改变 open 或 idle retention 语义。v1 不设 idle 数量上限、LRU、显式 eviction 或 per-key admin close。

### Open

open 在 Persistence load 成功且 Runtime 构造完成后立即成功。它不等待 P0，不编译 schema，也不验证 ROOT；preparing、unavailable、fatal 和 persistence-degraded 由 Runtime status 表达，不代表 namespace 不存在。

Registry 在读取 entry 或 Persistence 之前，用共享安全文法校验 owner.userId 和 namespaceId。invalid identity、not found、typed load operational failure 和 Registry not accepting 使用窄 `OpenNamespaceIssue`。公开 issue 不回显 identity 或原始异常。unknown load exception 不得被降级为运营失败。

### Create

create 输入只包含 owner、namespaceId、schema 和完整 logical ROOT。调用方不提供 META 或 createdAt，也不能省略 ROOT 让 Registry猜测默认值。

create 取得 lifecycle 槽后才读取并冻结输入；排队期间调用方可修改引用。输入缺陷仅使当前 create 失败，不毒化 key queue 或整个 Registry。完整 snapshot、compile、validate、detached construction、Persistence create 和 Runtime construction 均在同一个 lifecycle 槽中执行，不产生跨时间 prepared document。

私有 create-document 模块接收 namespaceId、createdAt、schema 和 root。它编译 schema，按 proposed schema 原样封闭校验完整 ROOT，完成 detached 构造，并在一个初始 Y.Doc transaction 中安装 SCHEMA、META、ROOT。失败不返回 partial Y.Doc；成功后 ownership 转给 Registry，再转给 Persistence。

`META.docId` 等于 namespaceId。`META.createdAt` 由 `new Date(ctx.clock.now()).toISOString()` 生成固定 UTC ISO 字符串；非法 Clock 输出属于 `create-document-internal`、`committed:false` fatal。owner 只作为 Persistence 分区键，不写入 META。

只有全部准备成功才调用排他的 `createDoc()`。active、idle、并发或 persisted duplicate 统一映射为 `NAMESPACE_ALREADY_EXISTS`；create 不退化为 open 或 upsert。Persistence create 成功后，Runtime 仍走普通 P0 启动路径，v1 接受 create compile 与 P0 compile 重复，以换取单一 Runtime 构造路径。

如果 createDoc 已提交而 Runtime 构造失败，Registry 释放 handle、保留持久化文档、清理 entry，并以 `committed:true` Registry fatal reject。不得补偿删除、fallback 或声称 rollback；调用方不得自动重试 create，后续可 open 已创建 namespace。

### Persistence 错误演进

Persistence 在 Registry 实施前增加稳定分类：

- typed load operational error；
- typed create operational error，明确 `committed:false`；
- committed-aware create fatal，携带稳定 phase、committed 与原始 cause；
- duplicate 继续使用稳定 duplicate 类型。

稳定 message 不拼接 cause。Registry 只把 typed operational error 映射为公开 load/create issue；duplicate 映射 already exists；Persistence fatal 的 committed 事实原样传播；unknown exception 不能伪装为运营失败。

Persistence 和 Registry 都依赖外部 Clock 与 Cordis Timer，不各自实现或 fallback 到系统 timer。Clock 是 wall clock，不承诺单调；elapsed scheduling 由 Timer负责。确定性测试使用 manual Clock 状态与 fake timer协调推进。

### Fatal、错误与 observability

普通 identity、not-found、duplicate、input、schema、ROOT 和 typed Persistence operational failure使用各操作独立的窄结果联合。验证型 issue内嵌对应完整底层 issues，不合并为巨型 unknown 数组，也不公开 retryable猜测。

结果联合外 internal failure使用 `NamespaceRegistryFatalError`，至少携带 operation、stable phase、committed 和 cause。初始 phase 是：

- `runtime-construction`；
- `create-document-internal`；
- `lifecycle-slot-internal`。

公开 issue/error message不包含 owner/namespace原值、SCHEMA全文、ROOT/input数据、原始异常文本或stack。Registry核心通过内部结构化 observer seam上报生命周期与故障；event可携带受控 identity和exact cause，由日志/metrics/trace Adapter负责访问控制、脱敏与采样。v1不提供公共事件订阅。

### Shutdown

首次 shutdown 在调用栈内同步进入 `shutting-down` 并停止接纳 open/create；两者统一返回 `REGISTRY_NOT_ACCEPTING` 且不访问输入。shutdown 取消全部 idle timer，等待此前已接纳的 lifecycle 操作结算，然后主动 close 全部 active/idle Runtime，不等待外部 lease release。Runtime close 自己排空已接纳写。

已在途 idle close 与 shutdown共享同一个 close Promise。所有 Runtime 都尝试 close；release failure时 Runtime仍为closed。shutdown 最终以稳定 `NamespaceRegistryShutdownError` 聚合 close failures，不因第一项失败跳过其余 Runtime。open/create自身的结果只交付原调用者，不重复进入 shutdown aggregation。重复 shutdown 返回 exact same Promise。

Plugin用一个有序 async disposer等待 Registry shutdown后再撤销service，避免把多个 async effects当作清理顺序机制。Cordis依赖图保证 Registry先于Persistence停止。

## 公共 Interface

Registry v1公开：

- `open`；
- `create`；
- 同步 `getStatus`，只表达 `running | shutting-down | stopped`；
- `shutdown`。

v1不公开list、entry status、lease count、queue、timer handle、explicit eviction、按key close或公共events。测试 seam只位于受控 testing subpath，允许替换Runtime/document factory、Clock、timeout和observer，但不允许读取内部entry结构。

## 后果

- 同一namespace的所有受控写保持唯一Runtime和唯一sequencer；REST、WS和管理任务共享一个安全生命周期入口。
- 离散REST请求可在五分钟内复用Runtime/P0，代价是v1只靠时间释放idle资源，短时访问大量namespace可能形成较大的idle集合；容量上限留后续演进。
- Registry、Persistence和Host的提交/失败事实保持诚实；已提交create不能被误报为普通可重试失败。
- Clock与Timer成为不同能力：Clock负责当前wall time，Timer负责lifecycle-safe delay。
- Registry不承担authorization、REST/WS、raw Yjs sync、META后续写或分布式协调。

## 取代与关联

本ADR不取代ADR 0008的单Runtime语义，而是在其上增加多调用方、多namespace和Host生命周期。Registry open遵循ADR 0008对ADR 0007普通open条款的取代：load+Runtime构造后即可发布，不等待P0或重新验证ROOT。

Phase 4使用独立integration PR。实施顺序为Clock capability、Persistence service/timer/clock与typed error演进、Runtime internal Registry factory、Registry核心/lease/idle生命周期、Cordis plugin、Memory/File/Cordis全链验收与最终整体审查。

---

## 修订节：issue #131（Phase 5 切片 1：Registry identity 迁移，依据 ADR 0010）

日期：2026-08-27；状态：已接受（`fix/issue-131-on-docs-phase-5-websocket-replication`）

本节修订本文原有的复合 key 与 caller-selected namespaceId 条款；namespace identity、owner、普通 create 的 ID 生成与碰撞处理均以 [ADR 0010「Namespace identity、owner 与复制范围」](./0010-hub-peer-websocket-ydoc-replication.md#namespace-identityowner-与复制范围) 为唯一权威来源，不在本 ADR 重复定义。

1. **Registry identity 修订**：本文「唯一 Runtime 与同键生命周期串行」「Create」「Persistence 错误演进」与「Fatal、错误与 observability」各节中，以 `(owner.userId, namespaceId)` 为 Registry key、由调用方传入 namespaceId、以及普通 duplicate 映射为 `NAMESPACE_ALREADY_EXISTS` 的旧条款，均由 ADR 0010 的 namespaceId-only identity 与普通 create 规则取代。owner 仍是 create/open 的必需本地属性与 Persistence 分区键；复用既有 entry 前必须核对 owner，不匹配返回 `NAMESPACE_NOT_FOUND`。
2. **Fatal phase 修订**：`namespace-id-generation` 是 `NamespaceRegistryFatalPhase` 中属于 `create` 操作的稳定 phase，不属于 `open`；其触发条件和碰撞预算以 ADR 0010 为准。
3. **能力与生命周期边界**：Registry 的构造能力增加必需的 `randomBytes(length): Uint8Array` 注入，生产 Host Adapter 使用 `node:crypto`，核心不得回退到全局随机源。create 的跨候选重试仍受 lifecycle carrier 串行化与 shutdown 已接纳操作屏障约束。

---

## 修订节：issue #134（Phase 5 切片 3/4：ReplicationSession，依据 ADR 0010 L71–90）

日期：2026-08-28；状态：已接受（`fix/issue-134-on-docs-phase-5-websocket-replication`）

1. **internal subpath 值导出扩为两键（§模块 L18 注记）**：`@nomicore/namespace-runtime/internal` 值导出由一键扩为两键——`createNamespaceRuntimeForRegistry`（本文 §模块 冻结 factory，不变）+ `openReplicationSessionCoreForRegistry(runtime, options)`（issue #134：复制会话宿主打开面）。消费边界不变（仍仅 Registry 生产代码，import 图审计谓词 `packages/namespace-registry/src/` 前缀零改动）；主 entry 值导出仍恰 `RuntimeWriteFatalError` 一键（runtime-acceptance-exports-audit 零改动）。
2. **Lease 代理面与 released 通道表增补（§NamespaceLease L38 注记）**：`NamespaceLease` 增加第十四成员 `openReplicationSession(options)`（授权已在 ADR 0010「NamespaceLease 与 ReplicationSession」L73–79）。released 通道表新增一行：released lease 的 `openReplicationSession` 经返回 Promise 结算 `{ok:false, code:'NAMESPACE_LEASE_RELEASED', message: NAMESPACE_LEASE_RELEASED_MESSAGE}`（与四写同款——resolve 不 reject）。release 同步段调用既有活跃 session 的 `close()`（停接纳 + 退订 + 释放 slot；零新增方法面）；release 不追踪/取消已接纳 apply 槽（本文「release 不追踪」条款对 ReplicationSession 同样成立）。

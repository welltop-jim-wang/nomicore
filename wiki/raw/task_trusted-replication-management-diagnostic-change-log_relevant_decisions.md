# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（Phase 0，审任务简报 `wiki/raw/task_trusted-replication-management-diagnostic-change-log.md`，Issue #151 round=1（SA8 retry 1），feature；父 PR #142 `docs/namespace-diagnostic-change-log`）。
> 只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> ADR 全集 = `docs/adr/0001–0009、0011、0012`（共 11 个文件，逐个全读；无 0010 文件——ADR-0011/0012 正文引用的「ADR 0010 trusted replication」不在本仓库 ADR 目录中，**不构成本门禁基准**，见冲突报告盘点注记）。
> 本文按本票接线对象（trusted replication apply / replication enable / replication epoch bump → 诊断日志 emission）组织摘录；#148（v1 contract）/#156/#159/#166（File adapter 与 stream roll）/#167（ROOT/SCHEMA 接线）交付面属代码层，仅作背景，不构成 SA8 冲突基准。

## 相关 ADR

### ADR-0011 Best-effort namespace 诊断变更日志（accepted）——本票主规范之一：产品语义总纲

#### A. 产品契约与业务隔离（本票 AC4 的直接依据）

- 与本任务的关联点：本票把 trusted replication apply 与两条 replication management 写接入诊断日志，日志一切故障面对 replication 业务面（apply 结果、ACK、identity/epoch 状态、槽序、transport 健康）的隔离要求由此节规定。
- 核心条款（原文摘录）：
  - 「日志 emit、排队、持久化、背压、丢弃或关闭失败不得改变业务操作的返回值、rejection、提交事实、sequencer 顺序或 Runtime 状态；」
  - 「日志不得成为 `createDoc`、Yjs transaction、dirty notification 或 **replication ACK** 的成功前置条件；」
  - 「日志实现不得因失败将 namespace 标记为 fatal、persistence-degraded 或只读，也不得触发业务请求重试；」
  - 「日志 adapter 必须以 non-throwing、有界、非阻塞的 emitter seam 接收记录。**Runtime/Registry/复制实现仍防御 adapter 违约**；adapter 同步 throw 或异步失败均被隔离，并只进入独立的日志健康 metrics/observer；」
  - 「日志队列溢出可以丢弃记录。实现应尽力上报 dropped count、sink failure 和 queue health，但这些健康信号本身也不构成日志完整性证明。」

#### B. 变更尝试、结局与阶段词表（本票 AC2 的直接依据）

- 与本任务的关联点：replication 三条 operation 的每条既有结果路径必须映射到冻结的结局与阶段词表；本票简报列举的 identity / epoch / capability / validation / transaction / dirty-notification / committed-aware fatal 全部落在该词表内。
- 核心条款（原文摘录）：
  - 「一条逻辑变更尝试至少具有稳定 `attemptId`，并产生结构化的开始与结局事实；实现可以把它们保存为两条相关记录，或保存为一条已完成记录。分离开始与结局时，只有开始记录而没有结局表示“结果未知”，不得推断为 rejected 或 committed。」
  - 结局词表：「`committed`：操作已产生已提交的 Y.Doc 效果，或明确完成为 no-op；」「`rejected`：预期失败且该请求没有提交 Y.Doc 变更；」「`fatal`：结果联合之外的 internal failure，必须携带现有错误通道已知的 `committed` 事实；若事实未知，沿所属操作既有契约记录保守事实，不由日志层重新分类；」「`unknown`：仅用于缺少可判定结局的诊断记录，例如进程在开始与结局之间终止，不能由正常操作路径主动代替既有结果分类。」
  - 阶段词表（本票重点为 `identity`）：「`rejected` 不得折叠成统一 `failed`。至少保留下列阶段：……`capability-gate`：已接纳但被 fatal、handle 状态、schema unavailable 等能力 gate 拒绝；……`identity`：**复制谱系、epoch 或 namespace identity 不满足**；`transaction`：已进入事务/应用阶段并产生 committed 或 fatal 事实；`dirty-notification`：事务已提交，但既有 dirty notification 通道失败。」——简报 AC2 的「Identity, epoch」结局映射到 `identity` 阶段（阶段词表无独立 epoch 阶段）。
  - 「每条结局记录保留所属模块已有的稳定 code、phase、issues 顺序与 committed 事实；日志层不得发明 retryable、rollback 或成功语义。」

#### C. 覆盖范围与 transport 排除面（本票 AC1/AC5 的直接依据）

- 与本任务的关联点：本票三条 operation 是 ADR-0011 覆盖范围清单的最后两项；transport 事实的排除面是 AC5「isolation from transport observability」的原文出处。
- 核心条款（原文摘录）：
  - 「首版应记录所有可能修改 namespace Y.Doc 的路径：……**trusted replication raw update apply**；**写入复制身份或提升 epoch 等 replication management 操作**。」——`replication-apply` / `replication-enable` / `replication-epoch-bump` 三条 operation 即此两项的词表化。
  - 「针对具体 namespace 变更的角色、authorization、identity 和 epoch 拒绝属于该变更尝试。**连接建立、心跳、普通 frame、无 namespace 目标的认证失败等 transport 事实仍属于复制 transport observability，不混入 namespace 诊断变更日志；两者可通过受控 `correlationId` 关联。**」
  - （排除面）「普通 read/open 不尝试修改 Y.Doc，不属于变更尝试。……」——本票不得为 transport 事件、read/open 补造变更记录。

#### D. Committed update 与 owned bytes（本票 AC3 的直接依据）

- 与本任务的关联点：ADR-0011 明文把「replication transaction seam 提供 owned update bytes」列为已授权演进——本票就是该条款在 replication 侧的兑现票。
- 核心条款（原文摘录）：
  - 「对 committed transaction，日志可携带该 transaction 产生的 owned Yjs update bytes；它是诊断性重放的权威 effect，结构化 input 只表达请求意图。不得把 mutation input、逻辑 diff 或重新执行 VFSL materialization 当作等价的 CRDT 重放载荷。」
  - 「创建成功可记录完整初始 Y.Doc update 作为 `genesis`。后续 committed ROOT、SCHEMA、**replication 与 management** 记录可携带精确 transaction update；**无实际 update 的成功显式记为 `effect: noop`**。日志不能通过事务后编码整个文档来冒充“该次 transaction update”。底层 transaction 模块应在不暴露 live Y.Doc 的前提下返回或投递 owned bytes。」
  - （Consequences）「为记录精确 committed effect，**doc-runtime/replication transaction seam 未来需要提供 owned update bytes；该演进不得暴露 live Y.Doc**。」
  - 「每个 emitter 可分配本地单调 `emitterSequence`，仅表示该 emitter 的记录顺序，不表示集群全局事务顺序。多副本环境中，同一 CRDT effect 可能分别作为本地提交与远端 apply 出现在不同 stream；本 ADR 不定义跨 stream 去重或全局排序。」——replication apply 与本地提交可能在两侧各留一条记录，属预期，不去重。

#### E. 输入捕获与零额外读取

- 核心条款（原文摘录）：
  - 「在受控快照成功前，只能记录 operation、attemptId、受控 identity、时间、source、correlation 等不读取业务 payload 的 envelope；」
  - 「capability/acceptance gate 在输入访问前拒绝时，记录 `input.capture = not-accessed`，不得随后序列化、hash 或检查原始请求；」
  - 「快照成功后，日志只能消费该操作已经生成的同一份 detached frozen plain-data snapshot，不得再次遍历调用方原对象；」
  - 「快照失败时，记录稳定 issue 与 `input.capture = unavailable/unsafe-input`，不得为了“记录完整请求”重新读取 Proxy、accessor、循环引用或其他敌意输入；」
  - 「输入策略可配置为 `none`、`digest`、`redacted` 或 `full`。默认应为 `digest` 或更保守策略；无论策略为何，安全快照不可得时都不能强行捕获原输入。」
  - （数据保护）「默认不记录 token、凭证、原始 Authorization、完整 Error stack、任意 cause 文本或未经控制的 transport payload；」「`actor`、`correlationId`、identity 和 error projection 必须是显式结构化受控字段；」「`full` 输入与 committed Yjs update 必须由 Host 明确启用，并继承 namespace 数据相同或更严格的访问控制、保留期和加密策略；」「日志字段不得进入默认低基数 metrics label。」——replication 输入（raw update bytes / 远端身份材料）属敏感数据面。

#### F. Interface 与 seam（emitter 公共面）

- 核心条款（原文摘录）：
  ```ts
  interface NamespaceDiagnosticChangeEmitter {
    emit(record: NamespaceDiagnosticChangeRecord): void
  }
  ```
  - 「`emit` 的 interface 语义是立即接收一份由调用方持有权已转移或已复制的 detached record；不得阻塞、throw、返回 durability promise，亦不得保留调用方可变引用。」
  - 「完整查询、导出、重放、保留与健康检查属于日志存储/工具模块的 interface，**不扩张 `NamespaceRuntime`、`NamespaceLease`、`DocPersistence` 或 replication wire interface**。一个日志 adapter 不构成新的 Persistence 真相源；snapshot Persistence 与诊断日志独立演进。」——本票不得把日志关切扩张进 replication wire 面。

#### G. 时序与 sequencer（本票接线位置纪律）

- 核心条款（原文摘录）：
  - 「变更尝试的业务排序继续由现有 Registry lifecycle slot 或 namespace write sequencer 决定，日志不得引入第二个业务排序机构：」
  - 「- acceptance 前拒绝在对应公共入口记录；」「- 已接纳操作在取得既有槽后记录真实 gate、snapshot、validation 和 transaction 结局；」「- committed record 的 sequence 分配与 emitter 接收可发生在 transaction committed 事实可知之后，但 **emitter 不被 `await`**；」「- `notifyDirty` 仍按 ADR 0008/0010 的原有槽序执行。日志记录 dirty failure，但不替代或包裹 dirty notification；」「- adapter 慢、失败或队列满都不得延长 write slot 或阻塞 close/shutdown；Host shutdown 可 best-effort drain 日志，但 Registry/Persistence 的停止不得无限等待日志 sink。」
  - （关联节）「本 ADR 增加可选 observability，不修改 ADR 0006 的 snapshot Persistence 与 dirty notification 语义、ADR 0008 的单 sequencer/zero-write/fatal/close 契约、ADR 0009 的 Registry lifecycle 与 observer 隔离、**ADR 0010 的 trusted replication、ACK 和 transport observability 语义**。」——本票「without changing replication identity gates, ACK timing, transport observability, or business write ordering」与该关联节同向。

### ADR-0012 VFSL 校验的 JSONL 与 framed sidecar 诊断日志格式（accepted，含 2026-08-28 首切片 amendment）——本票主规范之二：词表与接线纪律

#### A. operation / result / stage / source-context 词表（本票 AC1/AC2/AC5 的词表依据）

- 核心条款（原文摘录）：
  - 「v1 operation 是封闭词表：`namespace-create` `root-mutation` `schema-replacement` **`replication-apply` `replication-enable` `replication-epoch-bump`**。新增 operation 需要新的 record schema 版本与 stream generation。」——本票三条 operation **全部已在词表内**，零新增。
  - 「result 使用严格判别联合：committed + `noop`；committed + `update`；committed + `update-omitted`；rejected；fatal + `committed:false`；fatal + `committed:true`，effect 为 `update | update-omitted | unknown`。**rejected 与 fatal committed:false 禁止携带 update**。payload 超限时保留 attempt metadata，记录 `update-omitted` 与稳定 reason，而不是丢掉整条记录。」
  - 「顶层诊断 `stage` 使用日志 schema 的封闭枚举；`code` 与 `sourcePhase` 使用安全 Pattern 字符串并标注 source module，不复制 Registry、Runtime、Persistence 与 replication 的全部错误枚举，也不发明 retryable、rollback 或提交事实。」
  - v1 source/context 形状：「source: `| { kind: 'local' } | { kind: 'replication'; direction: 'hub-to-peer' | 'peer-to-hub'; remoteInstanceId: string }`」「context: `{ correlationId?: string; runtimeGeneration?: string; replicationId?: string; replicationEpoch?: number }`」；「首版不定义 actor，等待授权主体模型稳定。」——简报「controlled direction and identity context」的原文出处；AC5「both replication directions」即 `hub-to-peer` / `peer-to-hub` 两字面量。
  - 「`observedAt` 由完成操作的 producer 使用注入 Clock 生成 UTC ISO 8601；`durationMs` 只在存在可靠 monotonic duration 来源时可选记录。」
  - 「首版默认每次变更尝试只写一条最终 `attempt` record，不写 `attempt-started`。」「`attemptId` 由最外层 producer 复用已有受控关联 ID，缺失时使用 128-bit CSPRNG 生成：`att- + 32 位小写 hex`」。——replication 侧已有受控关联 ID（如消息/请求 ID）时优先复用。

#### B. manifest 边界与旁路状态（identity context 的落点纪律）

- 核心条款（原文摘录）：
  - 「**owner、instanceId、replicationId 与 replication epoch 不冻结在 manifest；适用时由每条记录的受控 context 表达。**」——replication 身份上下文是**每条记录的 context**，不是 stream/manifest 级配置。
  - 「日志启用与配置是本地 Host/Registry 旁路状态，**不写入 namespace `SCHEMA`、`META` 或 `ROOT`，也不随 Hub/Peer 复制**。」——与 replication 业务写（写复制身份/提升 epoch，属于 Y.Doc 变更尝试）是两个不同的事实面，不得混同。
  - 「影响记录解释的配置在 stream 创建时冻结；包括 record/schema/frame 版本、committed update capture、input capture policy、inline threshold 与 line 上限。冻结项改变时新建 stream generation。」——committed update capture 是 stream 冻结策略，emission 侧只能在策略允许时携带 update。

#### C. 首切片 amendment 与 write-slot 接线纪律（**规范性，点名本票**）

- 与本任务的关联点：ADR-0012 amendment 明文「不满足该条件的接线为不合规，必须由 #149–**#151**/#155 或后续接线票修复后方可启用」——本票（#151）就是 replication/management 侧的接线责任票，emit 调用点位置是本票设计的硬约束。
- 核心条款（原文摘录）：
  - 「每个 `emit` 在调用栈内执行至多一条 final JSONL record 的有界同步 append；若其携带 sidecar，则额外执行至多一帧 BIN append，顺序为 BIN-first。该首切片不维护 writer queue、不做 batch flush、不提供 fsync 开关，也不保持常驻 file descriptor。」
  - 「**任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot 之外，或在该 slot 已释放之后；不得在 slot 内执行同步 File adapter `emit`。**不满足该条件的接线为不合规，必须由 #149–#151/#155 或后续接线票修复后方可启用。」
  - 「本首切片 `emit` 保持 `void`、non-throwing、不得返回 durability promise，并以 catch-and-health-report 处理 adapter 故障（ADR 0011 emitter seam 不变）。」
  - 验收门槛对照（本票 AC5 测试面）：「4. rejected、fatal、committed/noop/update/update-omitted各判别分支；」「6. VFSL失败、队列满、磁盘失败、stream初始化失败均不改变业务结果；」

#### D. 语义 emission 与 storage projection 分工（本票 producer 侧边界）

- 核心条款（原文摘录）：
  - 「业务 producer 只提交 semantic emission，不构造 segment/offset/Base64 等物理表示。日志 adapter 独占 storage projection：先决定 inline/sidecar并构造最终 record，再运行 VFSL。首版不为 semantic emission 建立第二份 VFSL，避免双 schema 漂移。」
  - 输入投影：「gate 前拒绝记录 `input.capture = not-accessed`；快照成功后只消费所属操作已经生成的 detached frozen snapshot；快照失败记录 `unavailable/unsafe-input`，不得重读 Proxy、accessor 或循环对象；默认 input capture 为 digest；digest 对安全 snapshot 的 RFC 8785 JCS bytes 计算 SHA-256；full/redacted 只消费安全 snapshot，超出 line 预算时降级为 digest，并记录 `projected-input-too-large`。」
  - issues 统一投影：「`type DiagnosticIssue = { code?: string; message: string; path: (string | number)[], }`」「`none | full | redacted` 描述该统一投影的捕获策略；full 不表示保留任意底层对象字段。」
  - （sidecar 上限，replication diff 可能触达）「单个 sidecar payload 默认硬上限 64 MiB，可配置但不得超过 uint32。……即便结构化批量操作、genesis 或 replication diff 产生大 update，超限也只记录 `update-omitted/payload-too-large`，不改变原业务提交。」

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted，含 2026-08-24 稳定码注册修订）——槽序与 fatal 事实的宿主条款

- 与本任务的关联点：简报 AC4 钉死「write-sequencer order」不变；ADR-0008 定义该序列器与槽组成。replication apply 属受控 Y.Doc 写路径时受同一序列器纪律约束；replication 侧自有结果通道的形状不在本基准内（ADR-0010 缺席）。
- 核心条款（原文摘录）：
  - 「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer；不同 namespace 可并行。」
  - 「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务。」「`notifyDirty` 是由构造方绑定 `persistence.saveDoc(handle)` 的窄接缝」
  - 「`@nomicore/doc-runtime` 必须提供 branded `DocRuntimeFatalError`，至少包含 `committed` 与稳定 `phase`。任何 internal fatal——无论 committed 与否——都永久关闭该 Runtime 的全部写能力并保留读取：」「- `committed:false` 不调用 dirty notifier；」「- `committed:true` 或未知异常保守视为可能已提交，在当前槽内 best-effort `notifyDirty()`，但始终 reject 原始 fatal；」——committed-aware fatal 结局（AC2）的 committed 事实来源。
  - 稳定码注册修订（2026-08-24）：「其余公共面可观测稳定码不逐码入本文，以包内各稳定码定义处的 append-only 注册表为准——错误/禁用码族在 `packages/namespace-runtime/src/errors.ts`……」——同理，replication 模块既有稳定码以其定义处注册表为准，日志层只透传不复制（ADR-0012 §A 同款纪律）。

### ADR-0007 逻辑验证与 Yjs Runtime Bridge（accepted；open/read 条款被 ADR-0008 取代）——零写入与 observer no-rollback

- 与本任务的关联点：AC2 要求 fatal 路径保留既有 committed 事实；ADR-0007 的零写入、observer no-rollback 与 fatal 不虚构回滚纪律是 replication apply 事务面共用的底层纪律。
- 核心条款（原文摘录）：
  - 「零写入承诺覆盖所有验证失败和 detached 构造失败。Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报。事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback。」——若 owned-bytes 捕获经 update 事件订阅窗口实现（#167 先例），handler 不得向事务调用栈抛异常。
  - 被取代范围：「ADR 0008 取代本文 schema-aware `readLogicalValueAtPath(derived, doc, path)` 以及“普通 open 完成 schema 编译……才注册 Runtime”的 Runtime/open/read 条款。本文关于 logical validation、detached materialization、validated mutation、零写入与 observer no-rollback 的底层决策继续有效。」——被取代范围不构成约束。

### ADR-0006 Cordis 持久化插件（accepted，含 createDoc/owner 与 entry status/saveDoc 修订）——间接

- 与本任务的关联点：`notifyDirty` → `persistence.saveDoc(handle)` 脏通知语义不得被日志包裹或替代（ADR-0011 §G 已明文）；dirty-notification 阶段记录的是该通道的既有失败事实。
- 核心条款（原文摘录）：
  - 「saveDoc 是 **mutation 后的 dirty notification**：只要租约有效（未 released、非 foreign、身份匹配、Persistence 未 disposed），saveDoc 必须递增 dirtyGeneration 并 resolve——entry 处于 `persistence-degraded` **不构成拒绝理由**」

### ADR-0009 NamespaceRegistry/租约/Host 生命周期（accepted）——间接

- 与本任务的关联点：lease/lifecycle 停接纳拒绝是 acceptance 阶段记录来源之一；shutdown 不无限等待日志 sink；Registry observer seam 与日志健康 observer 分立。
- 核心条款（原文摘录）：
  - 「release 后，除 `getStatus()` 外的操作通过其既有同步/异步结果通道返回稳定 `NAMESPACE_LEASE_RELEASED`。」
  - 「Registry核心通过内部结构化 observer seam上报生命周期与故障；event可携带受控 identity和exact cause，由日志/metrics/trace Adapter负责访问控制、脱敏与采样。」

### ADR-0001 / 0002 / 0003 / 0004 / 0005（accepted）——盘点结论

- 与本票接线对象无直接条款交集；仍受其既有边界约束（record schema 的 VFSL 冻结纪律经 ADR-0012 §VFSL record schema 间接约束：本票不改 record schema 版本/指纹、不新增 operation）。本票不触碰 VFSL 引擎、类型投影与生成管线。

## 设计后复审追加（2026-08-31，SA8 设计后复审产出）

> 以下为 SA1 设计（`_design.md`）引入的新决策点摘录——**非 ADR/CONTEXT 条款**，属本票设计裁决
> （设计后复审 verdict `clear`，依据见 `_design_conflict_report.md` 特别核验 A–D 与冲突点表）。
> SA2/SA3/SA4/SA7 按设计章节编号回查；上文 ADR/CONTEXT 摘录不变、仍为冲突基准。

### 范围裁决（§0）

- **R-1 不跨谱系依赖**：不 merge/cherry-pick 主线 `b66615c`（两谱系在 `b264aae` 分叉，文本冲突覆盖全部接线对象）；在本 worktree 以主线定义处的形状/槽序/稳定码为「既有」锚，物化验收契约消费面 + 诚实业务语义的最小闭包。
- **R-2 物化最小闭包**：物化 `replication-write.ts`（E1–E7）/`replication-session.ts`（最小核心）/`lease.openReplicationSession` 薄通道/runtime 十一、十二键/errors 稳定码族/WriteSlot 扩展；**不物化** outbound fanout 全套、lease 角色门与 `drawReplicationId`、每-Lease 会话计数、公共 `status().replication` 域、`beginResetFence`。
- **R-3 三处契约驱动仲裁（相对主线全部显式）**：
  - **R-3.1** noop apply（R5 捕获窗口零字节）跳过 R6 notifyDirty——判据「捕获窗口有字节 ⟺ 有集成 ⟺ 通知」；L6 登记与主线的行为分叉并建议合并仲裁票；
  - **R-3.2** apply fatal 码值取主线原值 `'NSRT-FATAL-REPLICATION-APPLY-INTERNAL'`（常量名 `FATAL_REPLICATION_APPLY_WRITE_INTERNAL_CODE` 含 WRITE、值不含——`b66615c:errors.ts:184` 实核）；SA6 按其注记 2 协议修订红灯两处断言字面量（`:729/:782`），断言语义不变；
  - **R-3.3** `lease.openReplicationSession` 方向无关薄通道（localRole ∈ {hub, peer} 均可开；仅 released 门 + 输入形状校验 + 委托）——角色编排归 Phase 5 host 装配票（L2）。

### 诊断层裁决（D 决策，§2/§7/§8）

- **D-5** `diagnostic.ts` 三点向后兼容扩展：`emitAttempt`/`SlotEmissionArgs` 增可选 `source`（缺省 `{kind:'local'}`）/`context`（缺省省略）/`sourceModule`（缺省 `'runtime'`）；既有 ROOT/SCHEMA 调用点与字节面零变化。
- **D-6** owned bytes 三处捕获窗口（enable/bump E5 `doc.transact`、apply R5 `Y.applyUpdate`）：单赋值 handler + try/finally 退订；§16 实证「空 doc 不物化」（防全文档编码冒充）与「空 diff 零事件」（⟺ noop）。
- **D-7** identity context 全走 per-record `context`；enable/bump 的 context 的 epoch 取「本次尝试所确立的事实」（首装 {id,1} / bump {id,next} / 幂等 {id,既有}）；E4 之前的结局点省略 context。
- **D-8** apply 槽内一切路径省略 input（raw bytes 非 plain-data 不得作 snapshot）；A2 → `unavailable`；gate 拒绝 → `not-accessed`；bump policy `none`。
- **D-9** `sourceModule` 按码的注册表来源：`RUNTIME_WRITE_DISABLED` → `'runtime'`；`REPLICATION_*`/`NSRT-FATAL-REPLICATION-*` → `'replication'`；与 code 恒成对（pipeline §10-J3 丢单侧）。

### 接线纪律（SA3 实施约束，§15）

- emit 挂点全部 `settled.then(emitSlot)`（槽后）或公共入口同步段（槽外）——ADR-0012 amendment C 合规形态；emit 不被 await。
- 禁止事项：open/getStatus/close 加任何 emission；enable 槽加 fence；E3 单读捕获改双读；R6 恢复无条件 notifyDirty（R-3.1 是契约）；raw bytes 进 input.snapshot。
- 存量测试键集更新恰三文件（`runtime-close-lifecycle.test.ts:159` 十→十二键；`runtime-registry-internal-seam.test.ts:270/:123`；`registry-open.test.ts:879` lease 键集）。
- SA6 owned：红灯测试文件由 SA6 自行修订两处 fatal 码字面量（R-3.2）；SA3 禁改断言逻辑。

### 局限登记（L1–L6，§12）

L1 会话无 outbound 能力；L2 lease 无实例角色编排；L3 无每-Lease 会话计数/release 不联动 session.close；L4 公共 status 无 `replication` 域（`state.replication` 为内部投影，不进 buildStatus）；L5 无 `beginResetFence`；L6 R-3.1 与主线 R6 的行为分叉。合并策略：`replication-write.ts`/`replication-session.ts` 以主线版本覆盖合并，诊断接线按 §9 映射表重放（映射表是接线知识单一真相源）。

## CONTEXT.md 相关术语与惯例

- **namespace 诊断变更日志**：「从 namespace 创建开始尽力记录所有变更尝试及其结构化结局的可选 observability 流；连续的 committed Yjs updates 可用于诊断性重放，但日志不参与业务提交、不承诺完整性或恢复能力。」_Avoid_: 审计账本、WAL、event sourcing、可靠恢复日志。
- **变更尝试**：「一次可能修改 namespace 的请求及其结局；结局区分 committed、rejected 与 fatal，并标明 acceptance、capability gate、input snapshot、validation 等阶段。被拒请求也属于变更尝试，即使它从未读取输入或进入 transaction。」_Avoid_: 仅成功事务、统一 failed 事件。
- **语义 emission**：「producer → 诊断日志 emitter 提交的 detached 语义结局——operation/stage/observedAt/source/context/result（update 以 owned bytes 表达），不含 streamId/sequence/segment/frameOffset/Base64/CRC 等物理表示（storage projection 归 adapter）。emit 同步、不 throw、不阻塞；快照与 updateBytes 所有权移交后不得再变异。**update-omitted 稳定 reason 受控词表（v1）：`payload-too-large` / `update-capture-disabled` / `empty-update`——新增 reason 属词表演进，须过设计评审**。」_Avoid_: 物理载体细节、append 后引用、durability promise。——本票 replication producer 产出全部是语义 emission；新增 update-omitted reason 须过设计评审。
- **storage projection**：「日志 adapter 独占的物理表示决策——先决定 inline/sidecar 并构造最终 record（segment/frameOffset/payloadLength/CRC32C/Base64），再运行 VFSL 校验；emitter 只做语义投影，不构造物理字段。」_Avoid_: 业务侧构造物理载体、emission 面物理键、VFSL 双 schema。
- **genesis baseline record**：「新 stream 的 genesis 基线——当时完整 Y.Doc 的 update，不是变更尝试（无 attemptId/operation/stage/result/input；顶层 `recordKind: 'genesis-baseline'` 判别）；v1 冻结的 emission/sink 公共面无构造路径，由 #152 adapter 内部构造（设计 §10-J1 备案）。」——本票不得在 emission 公共面新增 genesis 构造路径。
- **诊断日志 stream generation**：「一个 namespace 的一代独立诊断日志，包含不可变 manifest、VFSL 校验的分段 JSONL records 与可选 framed binary sidecar；冻结格式或策略改变、旧 stream 损坏或无法安全续写时建立新 generation，各 generation 不自动拼接重放。」_Avoid_: **Runtime generation、replication epoch**、跨 generation 隐式连续日志。——**replication epoch 与日志 stream generation 是两个概念，不得混同或互推**。
- **写序列器**：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。」_Avoid_: mutation queue（范围过窄，容易让 SCHEMA/META 管理写建立旁路）。
- **零写入**：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」
- **停接纳**（码族来源）：「……mutateRoot/replaceSchema 经 Promise settle 含 `RUNTIME_WRITE_DISABLED` 的零写入结果——该码与 fatal 后排队写、写前 writable gate（handle 非 ready：persistence-degraded / released / disposed）、notifyDirty 未绑定共用同一码族，message 文案区分域……」——acceptance/capability-gate 拒绝记录的码域来源（replication 侧同理取其模块既有码）。

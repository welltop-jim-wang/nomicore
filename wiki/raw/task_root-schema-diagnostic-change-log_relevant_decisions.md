# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（Phase 0，审任务简报 `wiki/raw/task_root-schema-diagnostic-change-log.md`，Issue #149 round=1，Bug 修复；父 PR #142 `docs/namespace-diagnostic-change-log`）。
> 只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> ADR 全集 = `docs/adr/0001–0009、0011、0012`（共 11 个文件；无 0010 文件——ADR-0011/0012 正文引用的「ADR 0010 trusted replication」不在本仓库 ADR 目录中，不构成本门禁基准）。
> 本文按本票接线对象（NamespaceRuntime `mutateRoot` / `replaceSchema` → 诊断日志 emission）组织摘录；#148（v1 contract）/#152（File adapter）/#153（stream roll repair）交付面属代码与 wiki 档案层，仅作背景，不构成 SA8 冲突基准。

## 相关 ADR

### ADR-0011 Best-effort namespace 诊断变更日志（accepted）——本票主规范之一：产品语义总纲

#### A. 产品契约与业务隔离（本票 Objective / AC4 的直接依据）

- 与本任务的关联点：本票把 ROOT mutation 与 SCHEMA replacement 接入诊断日志，日志一切故障面的业务隔离要求由此节规定。
- 核心条款（原文摘录）：
  - 「日志 emit、排队、持久化、背压、丢弃或关闭失败不得改变业务操作的返回值、rejection、提交事实、sequencer 顺序或 Runtime 状态；」
  - 「日志不得成为 `createDoc`、Yjs transaction、dirty notification 或 replication ACK 的成功前置条件；」
  - 「日志实现不得因失败将 namespace 标记为 fatal、persistence-degraded 或只读，也不得触发业务请求重试；」
  - 「日志 adapter 必须以 non-throwing、有界、非阻塞的 emitter seam 接收记录。Runtime/Registry/复制实现仍防御 adapter 违约；adapter 同步 throw 或异步失败均被隔离，并只进入独立的日志健康 metrics/observer；」
  - 「日志队列溢出可以丢弃记录。实现应尽力上报 dropped count、sink failure 和 queue health，但这些健康信号本身也不构成日志完整性证明。」

#### B. 变更尝试、结局与阶段词表（本票 AC1 的直接依据）

- 与本任务的关联点：ROOT mutation / SCHEMA replacement 每条既有结果路径必须映射到冻结的结局与阶段词表，日志层不得新造分类。
- 核心条款（原文摘录）：
  - 「一条逻辑变更尝试至少具有稳定 `attemptId`，并产生结构化的开始与结局事实；实现可以把它们保存为两条相关记录，或保存为一条已完成记录。分离开始与结局时，只有开始记录而没有结局表示“结果未知”，不得推断为 rejected 或 committed。」
  - 结局词表：「`committed`：操作已产生已提交的 Y.Doc 效果，或明确完成为 no-op；」「`rejected`：预期失败且该请求没有提交 Y.Doc 变更；」「`fatal`：结果联合之外的 internal failure，必须携带现有错误通道已知的 `committed` 事实；若事实未知，沿所属操作既有契约记录保守事实，不由日志层重新分类；」「`unknown`：仅用于缺少可判定结局的诊断记录，例如进程在开始与结局之间终止，不能由正常操作路径主动代替既有结果分类。」
  - 「`rejected` 不得折叠成统一 `failed`。至少保留下列阶段：`acceptance`：Registry/Lease/Runtime lifecycle、角色或授权在接纳前拒绝；`capability-gate`：已接纳但被 fatal、handle 状态、schema unavailable 等能力 gate 拒绝；`input-snapshot`：受控 plain-data 快照失败；`schema-compile`：proposed schema 编译失败；`validation`：ROOT、mutation 或载体兼容性校验失败；`identity`：复制谱系、epoch 或 namespace identity 不满足；`transaction`：已进入事务/应用阶段并产生 committed 或 fatal 事实；`dirty-notification`：事务已提交，但既有 dirty notification 通道失败。」
  - 「每条结局记录保留所属模块已有的稳定 code、phase、issues 顺序与 committed 事实；日志层不得发明 retryable、rollback 或成功语义。」
  - 覆盖范围（本票两项在其中）：「首版应记录所有可能修改 namespace Y.Doc 的路径：……`ROOT mutation`；`SCHEMA replacement`；trusted replication raw update apply；写入复制身份或提升 epoch 等 replication management 操作。」
  - （排除面）「普通 read/open 不尝试修改 Y.Doc，不属于变更尝试。open 导致的 P0 编译只建立 Runtime active schema tools，也不写 Y.Doc；其故障沿既有 Runtime/Registry observability 上报，不伪装为 namespace change。」——P0 编译失败**不是**变更尝试，本票不得为其发诊断变更记录。

#### C. 输入捕获与零额外读取（本票 AC3 / AC5 的直接依据）

- 核心条款（原文摘录）：
  - 「在受控快照成功前，只能记录 operation、attemptId、受控 identity、时间、source、correlation 等不读取业务 payload 的 envelope；」
  - 「capability/acceptance gate 在输入访问前拒绝时，记录 `input.capture = not-accessed`，不得随后序列化、hash 或检查原始请求；」
  - 「快照成功后，日志只能消费该操作已经生成的同一份 detached frozen plain-data snapshot，不得再次遍历调用方原对象；」
  - 「快照失败时，记录稳定 issue 与 `input.capture = unavailable/unsafe-input`，不得为了“记录完整请求”重新读取 Proxy、accessor、循环引用或其他敌意输入；」
  - 「对 create 等已有独立快照实现的路径，同样复用该路径的安全快照，不建立第二套序列化规则。」
  - 「输入策略可配置为 `none`、`digest`、`redacted` 或 `full`。默认应为 `digest` 或更保守策略；无论策略为何，安全快照不可得时都不能强行捕获原输入。」
  - （Consequences）「为避免额外读取敌意输入，Runtime/Registry 的受控 snapshot 需要成为日志捕获的唯一 payload 来源。」

#### D. Committed update 与 owned bytes（本票 AC2 的直接依据）

- 核心条款（原文摘录）：
  - 「对 committed transaction，日志可携带该 transaction 产生的 owned Yjs update bytes；它是诊断性重放的权威 effect，结构化 input 只表达请求意图。不得把 mutation input、逻辑 diff 或重新执行 VFSL materialization 当作等价的 CRDT 重放载荷。」
  - 「创建成功可记录完整初始 Y.Doc update 作为 `genesis`。后续 committed ROOT、SCHEMA、replication 与 management 记录可携带精确 transaction update；无实际 update 的成功显式记为 `effect: noop`。日志不能通过事务后编码整个文档来冒充“该次 transaction update”。底层 transaction 模块应在不暴露 live Y.Doc 的前提下返回或投递 owned bytes。」
  - 「每个 emitter 可分配本地单调 `emitterSequence`，仅表示该 emitter 的记录顺序，不表示集群全局事务顺序。」
  - （Consequences）「为记录精确 committed effect，doc-runtime/replication transaction seam 未来需要提供 owned update bytes；该演进不得暴露 live Y.Doc。」——owned bytes 的授权捕获点是 **transaction seam**，不是公共业务返回值（与 ADR-0007「成功只返回 `{ ok:true }`」各辖其面，见 ADR-0007 节）。

#### E. Interface 与 seam（emitter 公共面）

- 核心条款（原文摘录）：
  ```ts
  interface NamespaceDiagnosticChangeEmitter {
    emit(record: NamespaceDiagnosticChangeRecord): void
  }
  ```
  - 「`emit` 的 interface 语义是立即接收一份由调用方持有权已转移或已复制的 detached record；不得阻塞、throw、返回 durability promise，亦不得保留调用方可变引用。」
  - 「完整查询、导出、重放、保留与健康检查属于日志存储/工具模块的 interface，不扩张 `NamespaceRuntime`、`NamespaceLease`、`DocPersistence` 或 replication wire interface。一个日志 adapter 不构成新的 Persistence 真相源；snapshot Persistence 与诊断日志独立演进。」

#### F. 时序与 sequencer（本票接线位置纪律）

- 核心条款（原文摘录）：
  - 「变更尝试的业务排序继续由现有 Registry lifecycle slot 或 namespace write sequencer 决定，日志不得引入第二个业务排序机构：」
  - 「- acceptance 前拒绝在对应公共入口记录；」「- 已接纳操作在取得既有槽后记录真实 gate、snapshot、validation 和 transaction 结局；」「- committed record 的 sequence 分配与 emitter 接收可发生在 transaction committed 事实可知之后，但 emitter 不被 `await`；」「- `notifyDirty` 仍按 ADR 0008/0010 的原有槽序执行。日志记录 dirty failure，但不替代或包裹 dirty notification；」「- adapter 慢、失败或队列满都不得延长 write slot 或阻塞 close/shutdown；Host shutdown 可 best-effort drain 日志，但 Registry/Persistence 的停止不得无限等待日志 sink。」
  - （数据保护，本票记录字段须遵守）「默认不记录 token、凭证、原始 Authorization、完整 Error stack、任意 cause 文本或未经控制的 transport payload；」「`actor`、`correlationId`、identity 和 error projection 必须是显式结构化受控字段；」「日志字段不得进入默认低基数 metrics label。」
  - （关联节）「本 ADR 增加可选 observability，不修改 ADR 0006 的 snapshot Persistence 与 dirty notification 语义、ADR 0008 的单 sequencer/zero-write/fatal/close 契约、ADR 0009 的 Registry lifecycle 与 observer 隔离、ADR 0010 的 trusted replication、ACK 和 transport observability 语义。」

### ADR-0012 VFSL 校验的 JSONL 与 framed sidecar 诊断日志格式（accepted，含 2026-08-28 首切片 amendment）——本票主规范之二：词表与接线纪律

#### A. operation / result / stage 词表（本票 AC1/AC2 的词表依据）

- 核心条款（原文摘录）：
  - 「v1 operation 是封闭词表：`namespace-create` `root-mutation` `schema-replacement` `replication-apply` `replication-enable` `replication-epoch-bump`。新增 operation 需要新的 record schema 版本与 stream generation。」——本票两个 operation（`root-mutation` / `schema-replacement`）**已在词表内**。
  - 「result 使用严格判别联合：committed + `noop`；committed + `update`；committed + `update-omitted`；rejected；fatal + `committed:false`；fatal + `committed:true`，effect 为 `update | update-omitted | unknown`。rejected 与 fatal committed:false 禁止携带 update。payload 超限时保留 attempt metadata，记录 `update-omitted` 与稳定 reason，而不是丢掉整条记录。」
  - 「顶层诊断 `stage` 使用日志 schema 的封闭枚举；`code` 与 `sourcePhase` 使用安全 Pattern 字符串并标注 source module，不复制 Registry、Runtime、Persistence 与 replication 的全部错误枚举，也不发明 retryable、rollback 或提交事实。」
  - v1 source/context 形状：「source: `| { kind: 'local' } | { kind: 'replication'; direction: …; remoteInstanceId: string }`」「context: { correlationId?: string; runtimeGeneration?: string; replicationId?: string; replicationEpoch?: number }」；「首版不定义 actor，等待授权主体模型稳定。」
  - 「`observedAt` 由完成操作的 producer 使用注入 Clock 生成 UTC ISO 8601；`durationMs` 只在存在可靠 monotonic duration 来源时可选记录。」——Runtime 侧 emission 的 Clock 注入是 SA1 设计点。
  - 「首版默认每次变更尝试只写一条最终 `attempt` record，不写 `attempt-started`。」「`attemptId` 由最外层 producer 复用已有受控关联 ID，缺失时使用 128-bit CSPRNG 生成：`att- + 32 位小写 hex`」。

#### B. 语义 emission 与 storage projection 分工（本票 producer 侧边界）

- 核心条款（原文摘录）：
  - 「业务 producer 只提交 semantic emission，不构造 segment/offset/Base64 等物理表示。日志 adapter 独占 storage projection：先决定 inline/sidecar并构造最终 record，再运行 VFSL。首版不为 semantic emission 建立第二份 VFSL，避免双 schema 漂移。」
  - 输入投影：「gate 前拒绝记录 `input.capture = not-accessed`；快照成功后只消费所属操作已经生成的 detached frozen snapshot；快照失败记录 `unavailable/unsafe-input`，不得重读 Proxy、accessor 或循环对象；默认 input capture 为 digest；digest 对安全 snapshot 的 RFC 8785 JCS bytes 计算 SHA-256；full/redacted 只消费安全 snapshot，超出 line 预算时降级为 digest，并记录 `projected-input-too-large`。」
  - issues 统一投影：「`type DiagnosticIssue = { code?: string; message: string; path: (string | number)[], }`」「`none | full | redacted` 描述该统一投影的捕获策略；full 不表示保留任意底层对象字段。」
  - （adapter 侧故障隔离，producer 无关但 AC4 测试面对照）「append 前 VFSL validation failure 是日志 writer bug：丢弃 record、增加低基数 metric并向独立结构化 observer 上报，不改变业务结果。」

#### C. 首切片 amendment 与 write-slot 接线纪律（**规范性，点名本票**）

- 与本任务的关联点：ADR-0012 amendment 明文「不满足该条件的接线为不合规，必须由 **#149**–#151/#155 或后续接线票修复后方可启用」——本票（#149）就是 ROOT/SCHEMA 侧的接线票，emit 调用点位置是本票设计的硬约束。
- 核心条款（原文摘录）：
  - 「每个 `emit` 在调用栈内执行至多一条 final JSONL record 的有界同步 append；若其携带 sidecar，则额外执行至多一帧 BIN append，顺序为 BIN-first。该首切片不维护 writer queue、不做 batch flush、不提供 fsync 开关，也不保持常驻 file descriptor。」
  - 「**任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot 之外，或在该 slot 已释放之后；不得在 slot 内执行同步 File adapter `emit`。**不满足该条件的接线为不合规，必须由 #149–#151/#155 或后续接线票修复后方可启用。」
  - 「本首切片 `emit` 保持 `void`、non-throwing、不得返回 durability promise，并以 catch-and-health-report 处理 adapter 故障（ADR 0011 emitter seam 不变）。」
  - （首版通用条款，对 emitter seam 仍有效）「日志 adapter 提供有界、non-blocking emitter……多 Runtime generation 共享 namespace stream 的同一 writer queue，stream不绑定 Runtime generation。」——「同一 writer queue」句按 amendment 在首切片范围内被同步 append 取代；「stream 不绑定 Runtime generation」原则继续有效。
  - 验收门槛对照（本票 AC5 测试面）：「4. rejected、fatal、committed/noop/update/update-omitted各判别分支；」「5. gate拒绝保持input `not-accessed`，日志对Proxy/accessor零额外读取；」「6. VFSL失败、队列满、磁盘失败、stream初始化失败均不改变业务结果；」

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted，含 2026-08-24 稳定码注册修订）——本票接线宿主

#### A. 单一 write sequencer 与槽组成（本票不得改变的槽序）

- 核心条款（原文摘录）：
  - 「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer；不同 namespace 可并行。v1 公开两个窄方法：`runtime.mutateRoot(mutation)` / `runtime.replaceSchema({ schema: proposedEnvelope, root?: completeLogicalRoot })`」
  - 「写方法调用时同步决定接纳顺序。输入引用在排队期间可以变化；任务取得槽后立即用受控 snapshotter 复制并递归冻结 plain data，之后编译、校验、构造和提交只使用该内部快照。snapshotter 只接受 primitive、finite number、null、plain object/array，拒绝 accessor、class instance、特殊对象、symbol key、循环引用及其他非 plain data。」——日志可消费的「既有 detached 安全快照」即此快照。
  - 「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务。」

#### B. SCHEMA write 槽内步骤与 ROOT write 依赖（emission 结局的业务事实来源）

- 核心条款（原文摘录）：
  - 「ROOT write 依赖 active schema tools。没有可用 schema 时零写入失败；否则每笔写按 ADR 0007 的 validated mutation 管线检查当前 ROOT、模拟并校验完整 proposed ROOT、detached 构造并单事务提交。」
  - 「SCHEMA write 不依赖当前 schema 可编译。它在自己的完整 sequencer 槽内：1. 编译 proposed SCHEMA 并构造新 tools；2. 未提供 `root` 时，按 proposed derived 严格提取并验证当前 ROOT……；3. 提供 `root` 时，将其视为最终完整 logical ROOT snapshot，验证并 detached 构造完整新内容；4. 在一个 transaction 中原子替换 SCHEMA 与必要的 ROOT generation；5. transaction 返回后立即安装新 active tools，再 `await notifyDirty()`。」
  - 「新 SCHEMA 的编译、最终 ROOT 校验或 detached 构造失败均发生在 transaction 前，SCHEMA/ROOT 零写入，active tools 不变。」
  - 「`persistence-degraded` 阻止 ROOT、SCHEMA 以及未来所有 Y.Doc 写；它不阻止 read 或不写 Y.Doc 的 P0。gate 是瞬时观察：检查后才发生的降级不撤销已提交事务，dirty notification 仍必须登记最新 live doc。」

#### C. Fatal 与失败通道（committed-aware fatal 记录的事实来源）

- 核心条款（原文摘录）：
  - 「`@nomicore/doc-runtime` 必须提供 branded `DocRuntimeFatalError`，至少包含 `committed` 与稳定 `phase`。任何 internal fatal——无论 committed 与否——都永久关闭该 Runtime 的全部写能力并保留读取：」
  - 「- `committed:false` 不调用 dirty notifier；」「- `committed:true` 或未知异常保守视为可能已提交，在当前槽内 best-effort `notifyDirty()`，但始终 reject 原始 fatal；」「- 不补偿、不 fallback、不声称 rollback；」「- post-commit fatal 以带 `committed:true` 的稳定 `RuntimeWriteFatalError` reject，上层不得自动重试非幂等写；」「- 已排队的后续写仍按 FIFO 取得槽，且不访问输入、零写入返回 `RUNTIME_WRITE_DISABLED`。」
  - 「普通、可预期且零写入的读取或写入失败使用领域化结果联合；ROOT mutation 与 SCHEMA replacement 使用各自独立的窄 issue 类型，不形成巨型 write issue。」
  - 稳定码注册修订（2026-08-24）：「`RUNTIME_WRITE_DISABLED` 码域澄清：该码是写停接纳/写禁用的统一码族，覆盖四类零写入、零输入访问的拒绝——fatal 已置位后的排队写、写前 writable gate 拒绝（handle 状态非 ready：persistence-degraded / released / disposed 三态同拒）、notifyDirty 未绑定的构造方义务 loud gate、close 后 lifecycle≠ready 的接纳拒绝；区分域靠 issue message 文案，不另设新码。」；「read 停接纳稳定码 `RUNTIME_READ_DISABLED`……lifecycle 失败不是路径缺陷，不借用路径失败码。」——capability-gate / acceptance 拒绝记录的稳定码取自该既有码族。
  - （测试 seam，AC5 注入依据）「生产工厂保留包内，由未来 Registry 使用；测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault。」
  - （底层演进授权）「2. transaction helper 提供 committed-aware branded fatal contract；3. SCHEMA replacement 可复用 detached builder 与原子 ROOT-content replacement helper，不复制 materialization 逻辑。」

### ADR-0007 逻辑验证与 Yjs Runtime Bridge（accepted；open/read 条款被 ADR-0008 取代）——零写入与公共返回形状

- 与本任务的关联点：本票 AC2 要求 owned update bytes；ADR-0007 规定公共 mutation 成功只返回 `{ok:true}`。两条经 ADR-0011 §D 的 transaction-seam 授权相容——owned bytes 走内部诊断通道，公共业务返回形状不动。
- 核心条款（原文摘录）：
  - 「`applyValidatedMutation(derived, doc, mutation)`：同步完成当前 ROOT 结构/逻辑检查、在普通 JSON 副本中模拟 mutation、完整 ROOT 逻辑校验、detached 子树构造和单次 Yjs transaction；不公开可跨时间执行的 prepared mutation，避免 TOCTOU。」
  - 「- 成功只返回 `{ ok:true }`，不返回 snapshot、Yjs update 或内部类型。」
  - 「零写入承诺覆盖所有验证失败和 detached 构造失败。Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报。事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback。」
  - 「验证或构造失败时目标 doc 零写入；不覆盖、不合并、不 fallback。」（materializeRoot 条款，SCHEMA write 复用同纪律）
  - 被取代范围：「ADR 0008 取代本文 schema-aware `readLogicalValueAtPath(derived, doc, path)` 以及“普通 open 完成 schema 编译、META 检查、ROOT 提取和 logical validation 后才注册 Runtime”的 Runtime/open/read 条款。本文关于 logical validation、detached materialization、validated mutation、零写入与 observer no-rollback 的底层决策继续有效。」——被取代范围不构成约束。

### ADR-0006 Cordis 持久化插件（accepted，含 createDoc/owner 与 entry status/saveDoc 修订）——间接

- 与本任务的关联点：`notifyDirty` seam 绑定 `persistence.saveDoc(handle)` 的脏通知语义不得被日志包裹或替代（ADR-0011 §F 已明文）；persistence-degraded 写前 gate 拒绝是本票 capability-gate 记录的来源之一。
- 核心条款（原文摘录）：
  - 「saveDoc 是 **mutation 后的 dirty notification**：只要租约有效（未 released、非 foreign、身份匹配、Persistence 未 disposed），saveDoc 必须递增 dirtyGeneration 并 resolve——entry 处于 `persistence-degraded` **不构成拒绝理由**」
  - 「『失败后 namespace 进入 `persistence-degraded`……拒绝**后续** REST/WS 写入』的拒绝面归属**业务编排层**：Runtime（ADR 0007 NamespaceRuntime 写前 gate）在业务 mutation 前读取 `handle.getStatus()`，已 degraded 则拒绝开始新写入（零写入：文档不变、响亮拒绝）。」

### ADR-0009 NamespaceRegistry/租约/Host 生命周期（accepted）——间接

- 与本任务的关联点：生产环境 `mutateRoot` / `replaceSchema` 经 NamespaceLease 代理调用；lease 停接纳与 lifecycle 拒绝是 acceptance 阶段记录的来源之一；shutdown 不无限等待日志 sink。
- 核心条款（原文摘录）：
  - 「成功 open/create 返回独立 `NamespaceLease`。Lease 是调用方唯一能力入口，代理 Runtime 除 `close()` 外的同步读取、投影、status、ROOT mutation 和 SCHEMA replacement；不公开裸 Runtime、DocHandle、Y.Doc 或 live Yjs 引用。」
  - 「release 后，除 `getStatus()` 外的操作通过其既有同步/异步结果通道返回稳定 `NAMESPACE_LEASE_RELEASED`。」
  - 「Registry核心通过内部结构化 observer seam上报生命周期与故障；event可携带受控 identity和exact cause，由日志/metrics/trace Adapter负责访问控制、脱敏与采样。」

### ADR-0001 / 0002 / 0003 / 0004 / 0005（accepted）——盘点结论

- 与本票接线对象无直接条款交集；仍受其既有边界约束（record schema 的 VFSL 冻结纪律经 ADR-0012 §VFSL record schema 间接约束：本票不改 record schema 版本/指纹、不新增 operation）。
- ADR-0003 的 ROOT 约定（「ROOT 固定物化为 Y.Map」「Yjs 映射为 `doc.getMap('ROOT')`」）是 ROOT mutation 操作对象的存在前提，本票不触碰。

## CONTEXT.md 相关术语与惯例

- **namespace 诊断变更日志**：「从 namespace 创建开始尽力记录所有变更尝试及其结构化结局的可选 observability 流；连续的 committed Yjs updates 可用于诊断性重放，但日志不参与业务提交、不承诺完整性或恢复能力。」_Avoid_: 审计账本、WAL、event sourcing、可靠恢复日志。
- **变更尝试**：「一次可能修改 namespace 的请求及其结局；结局区分 committed、rejected 与 fatal，并标明 acceptance、capability gate、input snapshot、validation 等阶段。被拒请求也属于变更尝试，即使它从未读取输入或进入 transaction。」_Avoid_: 仅成功事务、统一 failed 事件。
- **语义 emission**：「producer → 诊断日志 emitter 提交的 detached 语义结局——operation/stage/observedAt/source/context/result（update 以 owned bytes 表达），不含 streamId/sequence/segment/frameOffset/Base64/CRC 等物理表示（storage projection 归 adapter）。emit 同步、不 throw、不阻塞；快照与 updateBytes 所有权移交后不得再变异。update-omitted 稳定 reason 受控词表（v1）：`payload-too-large` / `update-capture-disabled` / `empty-update`——新增 reason 属词表演进，须过设计评审。」_Avoid_: 物理载体细节、append 后引用、durability promise。——本票 Runtime 侧产出全部是语义 emission；新增 update-omitted reason 须过设计评审。
- **storage projection**：「日志 adapter 独占的物理表示决策——先决定 inline/sidecar 并构造最终 record（segment/frameOffset/payloadLength/CRC32C/Base64），再运行 VFSL 校验；emitter 只做语义投影，不构造物理字段。」_Avoid_: 业务侧构造物理载体、emission 面物理键、VFSL 双 schema。
- **genesis baseline record**：「新 stream 的 genesis 基线——当时完整 Y.Doc 的 update，不是变更尝试（无 attemptId/operation/stage/result/input；顶层 `recordKind: 'genesis-baseline'` 判别）；v1 冻结的 emission/sink 公共面无构造路径，由 #152 adapter 内部构造（设计 §10-J1 备案）。」——本票不得在 emission 公共面新增 genesis 构造路径。
- **写序列器**：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。」_Avoid_: mutation queue（范围过窄，容易让 SCHEMA/META 管理写建立旁路）。
- **P0（schema preparation）**：「Runtime 发布前已进入写序列器队首的 schema 准备任务；只投影并编译 SCHEMA、构造 active schema tools，不读取或验证 ROOT。」——P0 故障不属于变更尝试（ADR-0011 §B 排除面）。
- **active schema**：「NamespaceRuntime 当前安装、供 ROOT write 使用的已编译 schema tools 及身份；SCHEMA write 的 transaction 成功后同步切换，不等同于对 live SCHEMA 的即时读取。」
- **停接纳**：「close 首次调用同步进入 `closing` 后，capability 槽立即停止接纳新调用……mutateRoot/replaceSchema 经 Promise settle 含 `RUNTIME_WRITE_DISABLED` 的零写入结果——该码与 fatal 后排队写、写前 writable gate（handle 非 ready：persistence-degraded / released / disposed）、notifyDirty 未绑定共用同一码族，message 文案区分域……」——acceptance/capability-gate 拒绝记录的码域来源。
- **零写入**：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」
- **原样封闭校验**：「`replaceSchema` 提供 `root` 时，root 被视为完整最终 logical ROOT snapshot，**原样**送入封闭对象校验（validateLogicalSnapshot）与 detached 构造（buildTopEntries）——任何未声明键，无论顶层还是嵌套，一律响亮拒绝（`ok:false` + 指向该键的 issue，零写入）；不投影、不剥离、不合并。」——SCHEMA replacement validation 结局的业务语义。
- **ROOT**：「命名空间根别名的保留名（大小写是契约）：每个模块必须恰好声明一个 map 形的 `type ROOT = …`，ROOT 固定物化为 Y.Map，Yjs 映射为 doc 根 `getMap('ROOT')`。」

## 设计后复审追加（round 1）

> SA8 设计后复审（2026-08-29）追加。被审对象：`task_root-schema-diagnostic-change-log_design.md`（SA1，同日产出）。
> 只摘录设计新引入的决策点与其 ADR 锚，不裁决；裁决见 `task_root-schema-diagnostic-change-log_design_conflict_report.md`（verdict `clear`）。
> 摘录供 SA2（全维度攻击评审）/SA3（实现）/SA4/SA7 复用；引用设计节号（§n）可回查设计全文。

### D-A 发射点：settled promise 微任务（slot 之外）+ acceptance 公共入口同步 emit

- 设计原文（§2 D-A / §7.1）：「emit 挂在 `sequencer.enqueue(...)` 返回 promise 的 `.then` 链上——**write sequencer slot 已释放之后**的微任务内、且先于下一任务取得槽」；「acceptance 拒绝（零入队路径）在公共方法调用栈内同步 emit」。
- ADR 锚：ADR-0012 amendment C「任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot 之外，或在该 slot 已释放之后；不得在 slot 内执行同步 File adapter `emit`」；ADR-0011 §F「acceptance 前拒绝在对应公共入口记录」「committed record 的 sequence 分配与 emitter 接收可发生在 transaction committed 事实可知之后，但 emitter 不被 `await`」「adapter 慢、失败或队列满都不得延长 write slot 或阻塞 close/shutdown」。
- 连带事实（§7.1 推论③，SA2 复核点）：调用方 promise 的结算时点**包含**有界 emit（红灯契约 AC4「两次尝试恰好各 emit 一次」的同步断言依赖该顺序：`await mutateRoot()` 恢复时 emit 必已执行）。emit 顺序 ≡ 槽完成顺序 ≡ FIFO（`sequencer.ts` 内部 `tail.then(noop)` 先注册、外部 `.then(emit)` 后注册、下一任务 thunk 挂 tail 之后）。

### D-B owned bytes：yjs 事务 update 事件订阅窗口（doc-runtime 零改动）

- 设计原文（§2 D-B / §6）：「S5 外围用 `doc.on('update')` 订阅窗口捕获**该事务的增量 update**（yjs 事务 cleanup 原生投递面），零 doc-runtime 改动」；（§6.2）「payload 由 `writeUpdateMessageFromTransaction` 从**该 transaction** 写出——是事务增量，不是事务后整文档编码」「`hasContent === false`（事务零内容变更）时**不派发**——『窗口内零事件 ⇔ effect: noop』的机制依据」「`encoder.toUint8Array()` 新分配——owned bytes」；（§6.3）「本设计从不调用 `Y.encodeStateAsUpdate(doc)`」「doc 引用始终在 runtime 闭包内……对外只交出 `Uint8Array`」。
- ADR 锚：ADR-0011 §D「底层 transaction 模块应在不暴露 live Y.Doc 的前提下返回或投递 owned bytes」「日志不能通过事务后编码整个文档来冒充“该次 transaction update”」；（Consequences）「doc-runtime/replication transaction seam 未来需要提供 owned update bytes；该演进不得暴露 live Y.Doc」；ADR-0007「- 成功只返回 `{ ok:true }`，不返回 snapshot、Yjs update 或内部类型」（公共返回面不动——设计否决了给 `applyValidatedMutation`/`replaceSchemaAndRoot` 加 capture 参数的备选，§6.3）。
- 设计的 seam 读法（§6.3，SA2 复核点）：yjs 事务 cleanup 的 `update` 事件即「投递」的实现面；捕获点与事务执行同一调用栈；若未来 replication（#150/#151）需要同能力可原样提升至共享层——本票不做超前抽象。
- 捕获窗口纪律：handler 单赋值闭包无可抛点（ADR-0007「Yjs observer 不得向事务调用栈抛异常」）；try/finally 保证 throw 路径同样退订；首-赋值保守取首事件、不 merge（结构性不可达分支的防御）。

### D-C 槽函数可选 `diag` 第三参数 + 未装配零行为

- 设计原文（§2 D-C）：「槽函数新增**可选第三参数** `diag`（per-attempt 收集器）；`diag === undefined ⇔ 未装配 emitter`，此时槽体所有写入点退化为 `diag?.x()` 可选链——无日志基线行为逐字节不变（AC5 对照锚点）」。
- ADR 锚：ADR-0011（「可选 observability」定位——未装配路径零 emit 是产品契约的自然推论）；ADR-0008 测试 seam 条款（「测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault」——seam 是注入面）。
- 槽内事实收集与槽外 emission 的分工（§7.3）：`SlotDiag`（operation / input 捕获态 / 单点写入 outcome / S5 捕获 bytes）由槽体各结局点写入；`emitSlot` 在槽外按唯一裁决表组装 result——`outcome === undefined` 且业务 fulfilled ⇒ 缺省组装 `transaction` + committed +（bytes 有无 → update/noop）；rejected/fatal 必须显式写 outcome（拒绝原因不在返回值里，**禁止 message 前缀反推**）。

### Seam 扩展：`diagnosticEmitter?` / `clock?`（条件校验 + doc.on/off loud assert）

- 设计原文（§5.1/§5.2）：两可选字段均为加法扩展；`diagnosticEmitter` 提供时校验 `emit` 为 function，且**条件性**校验 `handle.doc` 具备 `on`/`off`——「装配诊断发射即要求 doc 具备事件订阅面（Y.Doc 契约标配）：缺 on/off 属上游契约破坏，构造期 loud 拒绝……绝不静默吞掉后把『应有 update 的记录』降级成 noop/omitted」；`clock` 缺省 `() => Date.now()`（生产缺省），结构兼容 `@nomicore/clock` `Clock.now` / `emission.ts` `observedAtFrom`。
- ADR 锚：ADR-0012 §A「`observedAt` 由完成操作的 producer 使用注入 Clock 生成 UTC ISO 8601」（注入接缝即本字段；红灯契约明文「`observedAt` 必须来自注入 Clock」）；ADR-0008「构造失败时所有权仍归调用方」（构造期 loud throw 与既有 INV-N4/N14 纪律同族）；ADR-0009「缺失任何依赖均在 plugin 启动时响亮失败，不 fallback 到 `Date.now()` 或全局 timer」「Persistence 和 Registry 都依赖外部 Clock……不各自实现或 fallback 到系统 timer」——**该 No-Date.now-fallback 纪律辖 Registry/Persistence，不辖 namespace-runtime**；未来 Registry 接线票须注入 `ctx.clock`。
- 边界注记（复审记录）：「装配 emitter 而不注入 clock」的组装形态下 observedAt 将来自 `Date.now()` 缺省——本票生产工厂不装配 emitter（`createNamespaceRuntime` 传参不变），该形态在本票生产面不可达；生产接线的 Clock 注入义务属后续 Registry 接线票（ADR-0009 Registry 纪律 + ADR-0012「注入 Clock」）。

### emitAttempt 吞没一切（producer 防御义务）

- 设计原文（§7.2）：try/catch 全吞 emitter 同步 throw（含 `observedAtFrom` 对违约 clock——NaN/超域 epoch——的 throw）；「记录缺失即最终表现；producer 侧健康通道沿 ADR-0011 §F observer seam 留待未来票，本票不扩张公共面」；code↔sourceModule 成对出现或成对省略；`durationMs`/`context`/`attemptId` 全部省略（attemptId 由 emitter 管线 CSPRNG 生成 `att-+32hex`）。
- ADR 锚：ADR-0011 §A「Runtime/Registry/复制实现仍防御 adapter 违约；adapter 同步 throw 或异步失败均被隔离，并只进入独立的日志健康 metrics/observer」「日志队列溢出可以丢弃记录。实现应尽力上报 dropped count、sink failure 和 queue health」（上报为 best-effort；adapter 侧 stats/health 已由 #156 冻结交付，producer 侧健康通道本票不建）。
- 复审记录：吞没（隔离）是硬义务、已满足；「只进入独立 observer」读为**去向限定**（故障不得漏入业务面），非本票必须建成 observer 的义务——缺口记为观察项，不构成冲突。

### 冻结映射表（§9，25 结局点）与词表保真

- 设计原文（§9/§10.1）：stage 全取 ADR-0011 八值词表中本票适用的七值（`identity` 为 replication 域，不用）；operation `root-mutation`/`schema-replacement` 已在 ADR-0012 v1 封闭词表内；code 全部复用 ADR-0008 稳定码注册修订第 5 条所列 `errors.ts` 既有常量（`RUNTIME_WRITE_DISABLED` / `MUTATION_INPUT_NOT_PLAIN_DATA` / `SCHEMA_UNAVAILABLE` / `NSRT-FATAL-WRITE-INTERNAL` / `NSRT-FATAL-SCHEMA-WRITE-INTERNAL`）与 `p0.ts` `toIssueSummary` 既有派生（`SCHEMA_TEXT_INVALID` / `SCHEMA_ENVELOPE_*` 透传族）——零新码、零改 message 文案；result 全取 ADR-0012 六分支判别联合。
- 关键映射裁决（SA2/SA4 复核锚）：
  - effect `unknown` **仅**用于「fatal + committed:true 且零 bytes」（R11 分支）——ADR-0012 result 判别联合的显式分支，**不是** ADR-0011 结局分类 `unknown`（正常路径禁用结局 `unknown`）；
  - ROOT/SCHEMA 领域校验失败（R9/S5′a）与 SCHEMA 信封形状检查失败（S3′b）落 `validation`、无顶层 code——模块既有通道（write issue `{message,path}`）无稳定 code，忠实保留；issues 顺序透传；
  - S2 getStatus 抛错与 S4 结构不可达守卫落 `capability-gate` + fatal `committed:false`——ADR-0011 §B capability-gate 定义明文含「被 fatal、handle 状态、schema unavailable 等能力 gate 拒绝」；
  - S4 schema unavailable 落 `capability-gate`（ADR-0011 §B 明文列举）+ 既有码 `SCHEMA_UNAVAILABLE`；
  - update-omitted 的 reason 词表（`payload-too-large`/`update-capture-disabled`/`empty-update`）由 adapter 既有守卫产生，producer 不发明（CONTEXT.md「语义 emission」条款）。

### 依赖层（L1）

- 设计原文（§4）：`packages/namespace-runtime/package.json` dependencies 增 `"@nomicore/namespace-diagnostic-log": "workspace:*"`；本包对它只做 type-only import + 运行期唯一值级调用 `emitter.emit(...)`；依赖无环（诊断包不依赖 runtime）。
- ADR 锚：ADR-0011 §E「业务模块依赖一个小的内部 emitter interface，而不依赖日志存储实现：`interface NamespaceDiagnosticChangeEmitter { emit(record): void }`」——依赖面 = 接口（type-only + emit 调用），非存储实现。
- 现状事实（2026-08-29 复核实证）：runtime 当前 dependencies 仅 doc-runtime/persistence/vfsl/yjs（L1 缺口成立）；`packages/namespace-diagnostic-log/src/` 已含 emission.ts/pipeline.ts/vocabulary.ts/projection//adapters/（#156/#159/#166 已合并，git log `7ceede1`/`8611e68`/`eaf0484`）。

### 否决面（DENY，SA3/SA4 守卫锚）

- `packages/namespace-runtime/src/errors.ts` 零新码（ADR-0008 稳定码注册修订 5：稳定码以定义处 append-only 注册表为准）；
- `p0.ts` / `close.ts` 零 emit（ADR-0011 §B 排除面：P0 编译与 close 不是变更尝试）；
- `index.ts` 公共导出面零变化（ADR-0008「Runtime 不公开 handle、Y.Doc、ROOT/SCHEMA/META live 引用」；十键公共面/导出审计测试锚定）；
- `packages/doc-runtime/**` 零改动（ADR-0007 `{ok:true}` 返回形状冻结）；`sequencer.ts` 零改动；`@nomicore/namespace-diagnostic-log/**` 零改动（本票纯消费方）；
- Registry/persistence/vfsl*/clock 包零改动（Registry 侧接线属后续票）。

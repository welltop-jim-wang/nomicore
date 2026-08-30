# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（issue #150：Record the namespace creation lifecycle and genesis；分支 `fix/issue-150-on-docs-namespace-diagnostic-change-log`）。
> 只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文（`docs/adr/`）。
> 冲突裁决见 `task_namespace-diagnostic-change-log_conflict_report.md`（verdict: clear）。

## 相关 ADR

### ADR-0011 Best-effort namespace 诊断变更日志（accepted，2026-08-28）——本任务核心契约源

- 与本任务的关联点：任务即本 ADR「覆盖范围」第一条（namespace create）的接线落地——从创建尝试开始记录结构化结局与 genesis。

- 核心条款（原文摘录）：

  产品契约：
  - 「Nomicore 提供可选的 **namespace 诊断变更日志**。启用与否在 namespace 创建时确定；启用后，系统从创建尝试开始，尽力记录该 namespace 的创建及每次可能修改 Y.Doc 的变更尝试，包括成功提交、预期拒绝与 internal fatal。」
  - 「日志 emit、排队、持久化、背压、丢弃或关闭失败不得改变业务操作的返回值、rejection、提交事实、sequencer 顺序或 Runtime 状态」
  - 「日志不得成为 `createDoc`、Yjs transaction、dirty notification 或 replication ACK 的成功前置条件」
  - 「日志实现不得因失败将 namespace 标记为 fatal、persistence-degraded 或只读，也不得触发业务请求重试」
  - 「日志 adapter 必须以 non-throwing、有界、非阻塞的 emitter seam 接收记录。Runtime/Registry/复制实现仍防御 adapter 违约；adapter 同步 throw 或异步失败均被隔离，并只进入独立的日志健康 metrics/observer」
  - 「日志队列溢出可以丢弃记录。实现应尽力上报 dropped count、sink failure 和 queue health，但这些健康信号本身也不构成日志完整性证明。」

  变更尝试与结局：
  - 结局词表固定为 `committed` / `rejected` / `fatal` / `unknown`；「`fatal`：结果联合之外的 internal failure，必须携带现有错误通道已知的 `committed` 事实；若事实未知，沿所属操作既有契约记录保守事实，不由日志层重新分类」；「`rejected` 不得折叠成统一 `failed`」。
  - 阶段词表（8 值，至少保留）：`acceptance` / `capability-gate` / `input-snapshot` / `schema-compile` / `validation` / `identity` / `transaction` / `dirty-notification`。
  - 「每条结局记录保留所属模块已有的稳定 code、phase、issues 顺序与 committed 事实；日志层不得发明 retryable、rollback 或成功语义。」

  覆盖范围：
  - 「namespace create，包括输入、schema、ROOT、duplicate、Persistence 与 post-commit Runtime construction 结局」← **AC1 的直接出处（含 duplicate）**
  - 「普通 read/open 不尝试修改 Y.Doc，不属于变更尝试。open 导致的 P0 编译只建立 Runtime active schema tools，也不写 Y.Doc；其故障沿既有 Runtime/Registry observability 上报，不伪装为 namespace change。」

  输入捕获与零额外读取（AC3 的直接出处）：
  - 「在受控快照成功前，只能记录 operation、attemptId、受控 identity、时间、source、correlation 等不读取业务 payload 的 envelope」
  - 「capability/acceptance gate 在输入访问前拒绝时，记录 `input.capture = not-accessed`，不得随后序列化、hash 或检查原始请求」
  - 「快照成功后，日志只能消费该操作已经生成的同一份 detached frozen plain-data snapshot，不得再次遍历调用方原对象」
  - 「快照失败时，记录稳定 issue 与 `input.capture = unavailable/unsafe-input`，不得为了“记录完整请求”重新读取 Proxy、accessor、循环引用或其他敌意输入」
  - 「对 create 等已有独立快照实现的路径，同样复用该路径的安全快照，不建立第二套序列化规则。」
  - 「输入策略可配置为 `none`、`digest`、`redacted` 或 `full`。默认应为 `digest` 或更保守策略；无论策略为何，安全快照不可得时都不能强行捕获原输入。」

  数据保护：
  - 「`full` 输入与 committed Yjs update 必须由 Host 明确启用，并继承 namespace 数据相同或更严格的访问控制、保留期和加密策略」（genesis update = committed Yjs update，同样受此条约束）
  - 「日志字段不得进入默认低基数 metrics label。」

  Committed update 与诊断性重放（AC2 genesis 的直接出处）：
  - 「创建成功可记录完整初始 Y.Doc update 作为 `genesis`。」
  - 「不得把 mutation input、逻辑 diff 或重新执行 VFSL materialization 当作等价的 CRDT 重放载荷。」
  - 「底层 transaction 模块应在不暴露 live Y.Doc 的前提下返回或投递 owned bytes。」（detached/owned genesis bytes 的纪律出处）
  - 诊断性重放成功的五条件：「有可用 genesis」居首；「即使满足这些条件，也只证明工具重放了所持有的日志」。

  Interface 与 seam：
  - 「业务模块依赖一个小的内部 emitter interface，而不依赖日志存储实现：`interface NamespaceDiagnosticChangeEmitter { emit(record: NamespaceDiagnosticChangeRecord): void }`」
  - 「`emit` 的 interface 语义是立即接收一份由调用方持有权已转移或已复制的 detached record；不得阻塞、throw、返回 durability promise，亦不得保留调用方可变引用。」
  - 「完整查询、导出、重放、保留与健康检查属于日志存储/工具模块的 interface，不扩张 `NamespaceRuntime`、`NamespaceLease`、`DocPersistence` 或 replication wire interface。一个日志 adapter 不构成新的 Persistence 真相源。」

  时序与 sequencer：
  - 「变更尝试的业务排序继续由现有 Registry lifecycle slot 或 namespace write sequencer 决定，日志不得引入第二个业务排序机构」
  - 「acceptance 前拒绝在对应公共入口记录；已接纳操作在取得既有槽后记录真实 gate、snapshot、validation 和 transaction 结局」
  - 「committed record 的 sequence 分配与 emitter 接收可发生在 transaction committed 事实可知之后，但 emitter 不被 `await`」
  - 「`notifyDirty` 仍按 ADR 0008/0010 的原有槽序执行。日志记录 dirty failure，但不替代或包裹 dirty notification」
  - 「adapter 慢、失败或队列满都不得延长 write slot 或阻塞 close/shutdown；Host shutdown 可 best-effort drain 日志，但 Registry/Persistence 的停止不得无限等待日志 sink。」

  关联声明：「本 ADR 增加可选 observability，不修改 ADR 0006 的 snapshot Persistence 与 dirty notification 语义、ADR 0008 的单 sequencer/zero-write/fatal/close 契约、ADR 0009 的 Registry lifecycle 与 observer 隔离……」

### ADR-0012 VFSL 校验的 JSONL 与 framed sidecar 诊断日志格式（accepted，2026-08-28；含 2026-08-28 issue #152 first-slice amendment）——本任务核心契约源

- 与本任务的关联点：genesis baseline 的落盘语义、stream 初始化失败的业务隔离、以及接线票（#149–#151/#155，本任务 #150 在列）必须满足的 write-slot 接线纪律。

- 核心条款（原文摘录）：

  Stream 与 generation：
  - 「每个新 stream 尽力先记录当前完整 Y.Doc 的 genesis baseline，使该 stream 可独立诊断性重放；genesis 未成功写入时 stream 仍可记录诊断事实，但不得声称完整重放。」
  - 「日志启用与配置是本地 Host/Registry 旁路状态，不写入 namespace `SCHEMA`、`META` 或 `ROOT`，也不随 Hub/Peer 复制。」
  - 「初始化失败不影响 namespace create；独立健康 observer 上报 `LOG_STREAM_INIT_FAILED`。」← **AC4「stream initialization failure」的直接出处**
  - 「后续重试成功时以当时 Y.Doc 建立新 stream，其 genesis 只代表从该时点开始，不能伪称从 namespace 创建时起连续。」← **AC5「delayed stream initialization with an honest current-state genesis」的直接出处**

  v1 operation 封闭词表：「`namespace-create` / `root-mutation` / `schema-replacement` / `replication-apply` / `replication-enable` / `replication-epoch-bump`」；「新增 operation 需要新的 record schema 版本与 stream generation」。result 严格判别联合：committed+`noop` / committed+`update` / committed+`update-omitted` / `rejected` / fatal+`committed:false` / fatal+`committed:true`（effect 为 `update | update-omitted | unknown`）；「rejected 与 fatal committed:false 禁止携带 update」。

  输入/issues 投影：「gate 前拒绝记录 `input.capture = not-accessed`；快照成功后只消费所属操作已经生成的 detached frozen snapshot」；issues 统一投影 `{ code?, message, path }` 与 4 KiB/256 segment/1000 条截断纪律。

  Inline/sidecar 与大 update：「即便结构化批量操作、genesis 或 replication diff 产生大 update，超限也只记录 `update-omitted/payload-too-large`，不改变原业务提交。」

  Amendment — File adapter first slice（2026-08-28，issue #152 round 2；**对本任务的接线纪律为规范性条款**）：
  - 「每个 `emit` 在调用栈内执行至多一条 final JSONL record 的有界同步 append；……本首切片不维护 writer queue、不做 batch flush、不提供 fsync 开关，也不保持常驻 file descriptor。」
  - 「**任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot 之外，或在该 slot 已释放之后；不得在 slot 内执行同步 File adapter `emit`。** 不满足该条件的接线为不合规，必须由 #149–#151/#155 或后续接线票修复后方可启用。」← 本任务（#150）即被点名的接线票之一；create 路径的 emission/adapter 构造必须落在 Runtime write sequencer slot 之外（create 期 Runtime 尚未构造，天然在 slot 外；设计须保持该性质，含 post-commit 段）
  - 「本首切片 `emit` 保持 `void`、non-throwing、不得返回 durability promise，并以 catch-and-health-report 处理 adapter 故障（ADR 0011 emitter seam 不变）。」

  打开与尾部恢复 / strict reader / replay：replay 「不暴露 live Y.Doc，只返回 owned snapshot bytes 与结构化报告」；「只有存在有效 genesis、records 连续……才能返回 complete」。

### ADR-0009 NamespaceRegistry、调用方租约与 Cordis Host 生命周期（accepted，2026-08-25）——create 路径行为契约源

- 与本任务的关联点：AC1 的 create 全路径结局事实（acceptance/duplicate/snapshot/compile/validate/Persistence/post-commit Runtime construction）全部来自本 ADR 的 Create 节。

- 核心条款（原文摘录）：

  - 「create 输入只包含 owner、namespaceId、schema 和完整 logical ROOT。调用方不提供 META 或 createdAt，也不能省略 ROOT 让 Registry猜测默认值。」
  - 「create 取得 lifecycle 槽后才读取并冻结输入；排队期间调用方可修改引用。输入缺陷仅使当前 create 失败，不毒化 key queue 或整个 Registry。完整 snapshot、compile、validate、detached construction、Persistence create 和 Runtime construction 均在同一个 lifecycle 槽中执行，不产生跨时间 prepared document。」
  - 「私有 create-document 模块接收 namespaceId、createdAt、schema 和 root。它编译 schema，按 proposed schema 原样封闭校验完整 ROOT，完成 detached 构造，并在一个初始 Y.Doc transaction 中安装 SCHEMA、META、ROOT。失败不返回 partial Y.Doc；成功后 ownership 转给 Registry，再转给 Persistence。」
  - 「`META.createdAt` 由 `new Date(ctx.clock.now()).toISOString()` 生成固定 UTC ISO 字符串；非法 Clock 输出属于 `create-document-internal`、`committed:false` fatal。」
  - 「只有全部准备成功才调用排他的 `createDoc()`。active、idle、并发或 persisted duplicate 统一映射为 `NAMESPACE_ALREADY_EXISTS`；create 不退化为 open 或 upsert。Persistence create 成功后，Runtime 仍走普通 P0 启动路径，v1 接受 create compile 与 P0 compile 重复，以换取单一 Runtime 构造路径。」
  - 「如果 createDoc 已提交而 Runtime 构造失败，Registry 释放 handle、保留持久化文档、清理 entry，并以 `committed:true` Registry fatal reject。不得补偿删除、fallback 或声称 rollback；调用方不得自动重试 create，后续可 open 已创建 namespace。」← **AC2「post-commit fatal outcomes preserve their committed fact」的既有通道**
  - Fatal：`NamespaceRegistryFatalError` 至少携带 operation、stable phase（`runtime-construction` / `create-document-internal` / `lifecycle-slot-internal`）、committed 和 cause。
  - 「Registry核心通过内部结构化 observer seam上报生命周期与故障；event可携带受控 identity和exact cause……v1不提供公共事件订阅。」
  - Shutdown：「首次 shutdown 在调用栈内同步进入 `shutting-down` 并停止接纳 open/create；两者统一返回 `REGISTRY_NOT_ACCEPTING` 且不访问输入。」← acceptance 阶段「pre-input failures」的既有事实来源
  - Persistence 错误演进：「typed create operational error，明确 `committed:false`；committed-aware create fatal，携带稳定 phase、committed 与原始 cause；duplicate 继续使用稳定 duplicate 类型。」

### ADR-0006 Cordis 持久化插件——DocPersistence 与 doc 三条目布局（accepted；含 issue #64 / #79 owner 裁决修订节）——Persistence commit 事实源

- 与本任务的关联点：transaction/Persistence 阶段结局事实（DOC_DUPLICATE、committed create、typed create error）与三条目布局、META.createdAt 归属。

- 核心条款（原文摘录）：

  - createDoc（#64 修订节）：「对 `(owner.userId, docId)` 排他创建：cache/store 已存在或并发创建 → 拒绝 `DocDuplicateError`（稳定错误码 `DOC_DUPLICATE`）」「**在 duplicate 判定路径上绝不覆盖已提交内容**」「创建成功前初始完整 snapshot 已提交（`Y.encodeStateAsUpdate(doc)` 直写；FilePersistence 以 temp→rename 完成为提交点……）」「失败时不返回 handle、不缓存、不销毁传入 doc，所有权仍归调用方；原始 I/O 错误原样上抛」
  - 「持久层仍仅校验 `META.docId === docId`，不校验 VFSL/ROOT/createdAt」
  - 三条目布局：「`SCHEMA` 信封 / `META` 元信息（docId, createdAt）/ `ROOT` 数据根」；「`META.createdAt` 由上层 namespace lifecycle 生成和维护；持久层不生成、不修改、不校验该字段」
  - saveDoc（#79 修订节）：「saveDoc 是 **mutation 后的 dirty notification**」「`getStatus()` 只表示**调用瞬间**状态」（entry 级瞬时观察；本任务 create 路径主要触 createDoc，不触 saveDoc 语义）

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted，2026-08-23；含 2026-08-24 issue #93 稳定码注册修订）——post-commit Runtime construction / P0 / 槽纪律

- 与本任务的关联点：post-commit Runtime 走「普通 P0 启动路径」；emit 接线不得延长 write slot（与 ADR-0012 amendment 共同构成接线约束）；fatal 通道与稳定码族。

- 核心条款（原文摘录）：

  - P0：「Runtime 发布前，P0 已作为 write sequencer 的真实队首节点入队……P0 只读取 SCHEMA 标准四键、调用 `compileSchemaEnvelope` 并构造 schema-dependent tools，不读取、提取或验证 ROOT」「P0 结算后出队，只保留：`preparing`；`ready` 与 active schema tools；或 `unavailable` 与稳定 schema issue 摘要。」
  - 槽序：「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务。」
  - Fatal 通道：「任何 internal fatal——无论 committed 与否——都永久关闭该 Runtime 的全部写能力并保留读取」「post-commit fatal 以带 `committed:true` 的稳定 `RuntimeWriteFatalError` reject，上层不得自动重试非幂等写」
  - 稳定码修订（#93）：`RUNTIME_READ_DISABLED` / `RUNTIME_WRITE_DISABLED`（写停接纳/写禁用统一码族，四类零写入拒绝共用，message 区分域）/ `NSRT-CLOSE-RELEASE-FAILED`；「其余公共面可观测稳定码不逐码入本文，以包内各稳定码定义处的 append-only 注册表为准」。

### ADR-0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted；Runtime/open/read 条款被 ADR-0008 部分取代，其余继续有效）——validation/schema-compile 阶段事实源

- 与本任务的关联点：create 路径的 schema compile 与 ROOT validation 走本文冻结的能力（`compileSchemaEnvelope` / `validateLogicalSnapshot` / detached materialization / 零写入）。

- 核心条款（原文摘录）：

  - 「`validateSnapshot` 直接更名为 `validateLogicalSnapshot`，不保留兼容 alias；它只接受普通 JSON logical ROOT snapshot，不接受 Y.Doc/Y.Map/Y.Array。」
  - 「新增纯函数 `compileSchemaEnvelope(input: unknown)`：输入必须是严格封闭且恰含 `lang/version/id/text` 的信封；按 envelope、dialect、parse、evaluate、internal 分阶段返回结果联合。」
  - 「`materializeRoot(derived, snapshot, doc)`：唯一公共物化入口；内部先执行 `validateLogicalSnapshot`，再构造未集成到任何 doc 的 detached Yjs 子树……验证或构造失败时目标 doc 零写入；不覆盖、不合并、不 fallback。」
  - 「零写入承诺覆盖所有验证失败和 detached 构造失败。Yjs observer 不得向事务调用栈抛异常……事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback。」
  - 「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型。」

### ADR-0003 求值器与派生 schema（accepted）——弱相关

- 与本任务的关联点：ROOT 固定物化 Y.Map / `doc.getMap('ROOT')` 与 detached 构造纪律构成 create 路径的背景不变量；日志层不触碰派生 schema 形状。
- 核心条款（原文摘录）：「ROOT 固定物化为 Y.Map，`YArray` / `YXmlFragment` 与标量形一律拒绝……Yjs 映射为 `doc.getMap('ROOT')`」；「派生 schema 的形状变更须走设计修订流程（公共契约）」。

### ADR-0001 VFSL 文本是 schema 的唯一真相源（accepted；含 2026-08-19 / 2026-08-21 修订）——弱相关

- 与本任务的关联点：create emission 记录 schema 事实（envelope/指纹）但不复制 SCHEMA 全文进日志默认面（数据保护归 ADR-0011）；本任务不改 schema 来源与方言冻结。
- 核心条款（原文摘录）：「schema 用 VFSL……以信封 `{ lang, version, id, text }` 作为数据存进 doc 的 `SCHEMA`」「信封在 doc 中的键名由 `__schema__` 改为 **`SCHEMA`**」。

### ADR-0002 nomicore 是全新重写，authority 完全出范围（accepted）——无关

- 对照结论：任务不含 authority 规则内容；create 记录不引入 `__authority__` 类不变式。

### ADR-0004 vfsl-protocol 类型协议包（accepted）——无关

- 对照结论：编译期类型投影轨道，与运行时 create/日志接线零交集。

### ADR-0005 投影生成管线（accepted）——无关

- 对照结论：codegen 管线（`@nomicore/vfsl-codegen`、domains 脚手架），与 create 生命周期记录零交集。

### ADR-0010（trusted replication）——文件不在本 worktree `docs/adr/`

- ADR-0011/0012 关联节提及「ADR 0010 的 trusted replication、ACK 和 transport observability 语义」，但 `docs/adr/` 无该文件，本任务基准不含其约束；#150 范围（create 生命周期）不触 replication 操作（`replication-*` operations 归后续接线票）。

## CONTEXT.md 相关术语与惯例

- `namespace 诊断变更日志（namespace diagnostic change log）`：「从 namespace 创建开始尽力记录所有变更尝试及其结构化结局的可选 observability 流；连续的 committed Yjs updates 可用于诊断性重放，但日志不参与业务提交、不承诺完整性或恢复能力。」_Avoid_: 审计账本、WAL、event sourcing、可靠恢复日志。
- `变更尝试（change attempt）`：「一次可能修改 namespace 的请求及其结局；结局区分 committed、rejected 与 fatal，并标明 acceptance、capability gate、input snapshot、validation 等阶段。被拒请求也属于变更尝试，即使它从未读取输入或进入 transaction。」_Avoid_: 仅成功事务、统一 failed 事件。
- `诊断日志 stream generation`：「一个 namespace 的一代独立诊断日志，包含不可变 manifest、VFSL 校验的分段 JSONL records 与可选 framed binary sidecar；冻结格式或策略改变、旧 stream 损坏或无法安全续写时建立新 generation，各 generation 不自动拼接重放。」
- `语义 emission（semantic emission）`：「producer → 诊断日志 emitter 提交的 detached 语义结局——operation/stage/observedAt/source/context/result（update 以 owned bytes 表达），不含 streamId/sequence/segment/frameOffset/Base64/CRC 等物理表示（storage projection 归 adapter）。emit 同步、不 throw、不阻塞；快照与 updateBytes 所有权移交后不得再变异。update-omitted 稳定 reason 受控词表（v1）：`payload-too-large` / `update-capture-disabled` / `empty-update`——新增 reason 属词表演进，须过设计评审。」_Avoid_: 物理载体细节、append 后引用、durability promise。
- `storage projection`：「日志 adapter 独占的物理表示决策……emitter 只做语义投影，不构造物理字段。」_Avoid_: 业务侧构造物理载体、emission 面物理键、VFSL 双 schema。
- `genesis baseline record`：「新 stream 的 genesis 基线——当时完整 Y.Doc 的 update，不是变更尝试（无 attemptId/operation/stage/result/input；顶层 `recordKind: 'genesis-baseline'` 判别）；**v1 冻结的 emission/sink 公共面无构造路径，由 #152 adapter 内部构造（设计 §10-J1 备案）**。」_Avoid_: attempt-started、result `'unknown'`、跨 stream genesis。← **SA1 关键约束：producer 只供 bytes（#152 adapter 的 `genesisUpdateBytes` 接缝即为此设），不得在 emission 公共面增设 genesis 构造路径。**
- `写序列器（write sequencer）`：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。」
- `P0（schema preparation）`：「Runtime 发布前已进入写序列器队首的 schema 准备任务；只投影并编译 SCHEMA、构造 active schema tools，不读取或验证 ROOT。」
- `停接纳（stop-acceptance）`：close 后 read/getter/mutate 的停接纳码族与 `getStatus` 全生命周期可用（acceptance 阶段记录须引用既有码，不发明新码）。
- `创建时间（createdAt）`：「namespace 创建提交时由生命周期层生成的 UTC ISO 8601 字符串，存于 `META.createdAt`；调用方不提供，Persistence 只保存而不解释或校验。」
- `零写入（zero-write）`：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」
- `逻辑快照校验（validateLogicalSnapshot）`：「创建前校验、写入前校验、迁移后体检、测试与管理端点共用该入口。」

## AC → 条款对照速览（中性索引，供 SA1/SA2/SA3 回查）

| 任务元素 | 对应条款 |
|---|---|
| Objective：从首次可观察尝试到 post-commit Runtime construction 的结构化结局 | ADR-0011 覆盖范围 create 条款（逐词列举同样七类结局）；ADR-0009 Create 节 |
| Objective/AC2：成功创建尝试 current Y.Doc genesis | ADR-0011「创建成功可记录完整初始 Y.Doc update 作为 `genesis`」+ owned bytes 条款；ADR-0012「每个新 stream 尽力先记录当前完整 Y.Doc 的 genesis baseline」；CONTEXT.md `genesis baseline record`（adapter 内部构造） |
| Objective/AC4/AC5：stream 初始化或日志失败不改 create 结果与可用性 | ADR-0011 best-effort 六条；ADR-0012「初始化失败不影响 namespace create；独立健康 observer 上报 `LOG_STREAM_INIT_FAILED`」 |
| AC1：acceptance / duplicate / input snapshot / schema compile / validation / transaction-Persistence / post-commit Runtime construction 结局，用既有稳定事实 | ADR-0011 覆盖范围 + 结局/阶段词表 + 「日志层不得发明」；事实源：ADR-0009（acceptance/duplicate/runtime-construction）、ADR-0006 #64（DOC_DUPLICATE/committed create）、ADR-0007（compile/validate）；阶段映射入 8 值封闭枚举（`packages/namespace-diagnostic-log/src/vocabulary.ts` 为 #148 冻结实现，ADR-0011 逐字） |
| AC2：post-commit fatal 保留 committed 事实 | ADR-0011 fatal 条款；ADR-0009「以 `committed:true` Registry fatal reject」；ADR-0008 fatal 通道 |
| AC3：pre-input 失败不触 payload；后续捕获复用 create 路径 detached 安全快照 | ADR-0011 输入捕获五条（含「对 create 等已有独立快照实现的路径，同样复用该路径的安全快照」）；ADR-0009「create 取得 lifecycle 槽后才读取并冻结输入」 |
| AC4：logging disabled / stream init failure / queue pressure / sink failure 不改 create 成功、拒绝、Persistence 状态、Registry 生命周期 | ADR-0011 业务隔离条款；ADR-0012 初始化失败条款 + amendment 接线纪律（emit 在 write slot 外） |
| AC5：六类测试场景（含 delayed stream init 的 honest current-state genesis） | ADR-0012「后续重试成功时以当时 Y.Doc 建立新 stream，其 genesis 只代表从该时点开始，不能伪称从 namespace 创建时起连续」；ADR-0012 验收门槛 5/6（gate 拒绝 input not-accessed；初始化失败不改业务） |
| Constraint：不等待 #148 合并、按当前 worktree 实施 | 流程约束；#148 冻结契约（emission/record/vocabulary/schema）已在 worktree `packages/namespace-diagnostic-log` 落地，为接线依赖而非 ADR 冲突点 |

## 设计后复审追加（2026-08-30，SA8 vs SA1 设计 R1）

> 只摘录 SA1 设计（`task_namespace-diagnostic-change-log_design.md`）引入的新决策点，不裁决；
> 冲突裁决见 `task_namespace-diagnostic-change-log_design_conflict_report.md`（verdict: clear）。

- **DC-1 genesis/update bytes 供给方式**（§2.3/§6.3.5）：在 Registry create 槽内对 `initial.doc` 做 `Y.encodeStateAsUpdate`（detached/owned、失败→undefined），不扩大 `create-document.ts` 契约——依据 ADR-0006 #64「创建成功前初始完整 snapshot 已提交（`Y.encodeStateAsUpdate(doc)` 直写）」可行先例；ADR-0011「底层 transaction 模块应在不暴露 live Y.Doc 的前提下返回或投递 owned bytes」读作 seam 未来演进方向而非现行接线禁令。
- **DC-2 initStream 次序**（§2.3/§6.3.5）：`createDoc` resolve（committed 事实确立）后、factory 调用前同步调用 initStream；factory 成败皆然；#16 防御 fatal 路径不建 stream（Host 可经 ADR-0012 延迟初始化补建）。
- **DC-3 observedAt/Clock 不变量**（§6.3.2）：每次 create 尝试恰一次 clock 读数用于时间戳——槽内复用 `createdAt` 字符串（零额外读数）；Clock 步之前终结的诊断侧单次读数；clock 故障 → 该条 emission 丢弃（不伪造时间戳）。
- **DC-4 issues producer 侧形状投影**（§6.3.4）：vfsl `SchemaParseIssue`/`ValidateIssue` → 诊断包 `DiagnosticIssue {code?, message, path}`，顺序逐条保留、message verbatim；envelope issue code 合成前缀 `VFSL-ENV-E{code}`；意外形状条目跳过（不 throw）。
- **DC-5 类型消费纪律**（§5.3）：诊断包纯 `import type`（零值级 import）；yjs 上移 dependencies（encode 单函数值级消费）。
- **DC-6 未测路径显式映射**（§6.2 总表 18 结局点）：identity 入口拒绝 → `identity`；closing fatal ×3 → `acceptance`（input not-accessed）；create-document 编排段（clock fatal/createDocument throw/不可达守卫）→ `schema-compile` 伞形 + `sourcePhase:'create-document-internal'`；createDoc 栈内 → `transaction`。stage 单源规则：尝试推进到的实际阶段在 8 值封闭词表内的投影，精确事实由 code/sourcePhase/committed 携带。
- **§8.1 amendment C 合规论证**：全部 emit/initStream 调用点位于 Registry lifecycle slot 或公共入口同步段，不进入 NamespaceRuntime write sequencer slot（create 期 Runtime 不存在；post-commit 段运行在 Registry slot 调用栈，P0 独立异步结算、只读 SCHEMA）。
- **§6.3.5 词表纪律**：成功路径 encode 失败 → emission 丢弃而非发明 update-omitted 新 reason（v1 词表三值冻结）；initStream 传 undefined → adapter 跳过 genesis 写但建 stream（ADR-0012「genesis 未成功写入时 stream 仍可记录诊断事实」）；`initStream` 恒在 emit 之前，二者均在 create Promise 结算前完成。
- **SA2 裁量提示 J1–J3**（见设计冲突报告）：J1 write-slot 论证精度（数据量有界 ≠ 延迟有界，合规性立于调用点位置规则）；J2 `VFSL-ENV-E` 前缀为表示层投影；J3 clock fatal 零诊断痕迹的 best-effort 许可。

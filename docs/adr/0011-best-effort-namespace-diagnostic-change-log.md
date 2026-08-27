# ADR 0011：Best-effort namespace 诊断变更日志

日期：2026-08-28
状态：已接受

## 背景

Nomicore 需要一个从 namespace 创建开始即可选择启用的诊断能力，用于回答“谁试图做什么、在哪个阶段被拒绝、哪些变更实际提交”等排错问题。现有 snapshot Persistence 只保存当前 Y.Doc，Runtime/Registry observer 也没有形成按 namespace 关联的变更尝试记录；仅记录成功事务又会丢失 schema 校验失败、能力 gate 拒绝和内部 fatal 等最有价值的诊断事实。

该能力不承担审计合规、WAL 或灾难恢复职责。若让日志 append 进入业务提交条件，日志故障会改变现有 create、ROOT/SCHEMA write、trusted replication apply 的结果和 Runtime capability，违背本能力的 observability 定位。

## 决策

### 产品契约

Nomicore 提供可选的 **namespace 诊断变更日志**。启用与否在 namespace 创建时确定；启用后，系统从创建尝试开始，尽力记录该 namespace 的创建及每次可能修改 Y.Doc 的变更尝试，包括成功提交、预期拒绝与 internal fatal。

日志是 best-effort observability：

- 日志 emit、排队、持久化、背压、丢弃或关闭失败不得改变业务操作的返回值、rejection、提交事实、sequencer 顺序或 Runtime 状态；
- 日志不得成为 `createDoc`、Yjs transaction、dirty notification 或 replication ACK 的成功前置条件；
- 日志实现不得因失败将 namespace 标记为 fatal、persistence-degraded 或只读，也不得触发业务请求重试；
- 日志允许缺失、乱失尾部或因进程崩溃只留下尝试开始而没有结局；系统不承诺 exactly-once、at-least-once、无 gap、跨副本全局顺序或物理持久性；
- 日志 adapter 必须以 non-throwing、有界、非阻塞的 emitter seam 接收记录。Runtime/Registry/复制实现仍防御 adapter 违约；adapter 同步 throw 或异步失败均被隔离，并只进入独立的日志健康 metrics/observer；
- 日志队列溢出可以丢弃记录。实现应尽力上报 dropped count、sink failure 和 queue health，但这些健康信号本身也不构成日志完整性证明。

因此，即使日志记录连续且包含 Yjs update，它也只是在满足条件时可用于诊断性重放，不能宣传为可靠恢复日志。

### 变更尝试与结局

一条逻辑变更尝试至少具有稳定 `attemptId`，并产生结构化的开始与结局事实；实现可以把它们保存为两条相关记录，或保存为一条已完成记录。分离开始与结局时，只有开始记录而没有结局表示“结果未知”，不得推断为 rejected 或 committed。

结局词表固定为：

- `committed`：操作已产生已提交的 Y.Doc 效果，或明确完成为 no-op；
- `rejected`：预期失败且该请求没有提交 Y.Doc 变更；
- `fatal`：结果联合之外的 internal failure，必须携带现有错误通道已知的 `committed` 事实；若事实未知，沿所属操作既有契约记录保守事实，不由日志层重新分类；
- `unknown`：仅用于缺少可判定结局的诊断记录，例如进程在开始与结局之间终止，不能由正常操作路径主动代替既有结果分类。

`rejected` 不得折叠成统一 `failed`。至少保留下列阶段：

- `acceptance`：Registry/Lease/Runtime lifecycle、角色或授权在接纳前拒绝；
- `capability-gate`：已接纳但被 fatal、handle 状态、schema unavailable 等能力 gate 拒绝；
- `input-snapshot`：受控 plain-data 快照失败；
- `schema-compile`：proposed schema 编译失败；
- `validation`：ROOT、mutation 或载体兼容性校验失败；
- `identity`：复制谱系、epoch 或 namespace identity 不满足；
- `transaction`：已进入事务/应用阶段并产生 committed 或 fatal 事实；
- `dirty-notification`：事务已提交，但既有 dirty notification 通道失败。

每条结局记录保留所属模块已有的稳定 code、phase、issues 顺序与 committed 事实；日志层不得发明 retryable、rollback 或成功语义。

### 覆盖范围

首版应记录所有可能修改 namespace Y.Doc 的路径：

- namespace create，包括输入、schema、ROOT、duplicate、Persistence 与 post-commit Runtime construction 结局；
- ROOT mutation；
- SCHEMA replacement；
- trusted replication raw update apply；
- 写入复制身份或提升 epoch 等 replication management 操作。

针对具体 namespace 变更的角色、authorization、identity 和 epoch 拒绝属于该变更尝试。连接建立、心跳、普通 frame、无 namespace 目标的认证失败等 transport 事实仍属于复制 transport observability，不混入 namespace 诊断变更日志；两者可通过受控 `correlationId` 关联。

普通 read/open 不尝试修改 Y.Doc，不属于变更尝试。open 导致的 P0 编译只建立 Runtime active schema tools，也不写 Y.Doc；其故障沿既有 Runtime/Registry observability 上报，不伪装为 namespace change。

### 输入捕获与零额外读取

日志不得为了排错破坏现有“gate 拒绝时输入零访问”和“槽起点只做一次受控快照”的契约：

- 在受控快照成功前，只能记录 operation、attemptId、受控 identity、时间、source、correlation 等不读取业务 payload 的 envelope；
- capability/acceptance gate 在输入访问前拒绝时，记录 `input.capture = not-accessed`，不得随后序列化、hash 或检查原始请求；
- 快照成功后，日志只能消费该操作已经生成的同一份 detached frozen plain-data snapshot，不得再次遍历调用方原对象；
- 快照失败时，记录稳定 issue 与 `input.capture = unavailable/unsafe-input`，不得为了“记录完整请求”重新读取 Proxy、accessor、循环引用或其他敌意输入；
- 对 create 等已有独立快照实现的路径，同样复用该路径的安全快照，不建立第二套序列化规则。

输入策略可配置为 `none`、`digest`、`redacted` 或 `full`。默认应为 `digest` 或更保守策略；无论策略为何，安全快照不可得时都不能强行捕获原输入。

### 数据保护

日志是敏感数据面。完整 ROOT/SCHEMA 输入、validation issues、Yjs update、actor、owner、remote instance 和 error cause 均可能包含业务数据或部署信息：

- 默认不记录 token、凭证、原始 Authorization、完整 Error stack、任意 cause 文本或未经控制的 transport payload；
- `actor`、`correlationId`、identity 和 error projection 必须是显式结构化受控字段；
- `full` 输入与 committed Yjs update 必须由 Host 明确启用，并继承 namespace 数据相同或更严格的访问控制、保留期和加密策略；
- issues 是否原样保留由策略决定；若脱敏，记录必须标明 projection/redaction，而不能让消费者误认为是原始 issue；
- 日志字段不得进入默认低基数 metrics label。

### Committed update 与诊断性重放

对 committed transaction，日志可携带该 transaction 产生的 owned Yjs update bytes；它是诊断性重放的权威 effect，结构化 input 只表达请求意图。不得把 mutation input、逻辑 diff 或重新执行 VFSL materialization 当作等价的 CRDT 重放载荷。

创建成功可记录完整初始 Y.Doc update 作为 `genesis`。后续 committed ROOT、SCHEMA、replication 与 management 记录可携带精确 transaction update；无实际 update 的成功显式记为 `effect: noop`。日志不能通过事务后编码整个文档来冒充“该次 transaction update”。底层 transaction 模块应在不暴露 live Y.Doc 的前提下返回或投递 owned bytes。

每个 emitter 可分配本地单调 `emitterSequence`，仅表示该 emitter 的记录顺序，不表示集群全局事务顺序。多副本环境中，同一 CRDT effect 可能分别作为本地提交与远端 apply 出现在不同 stream；本 ADR 不定义跨 stream 去重或全局排序。

只有同时满足以下条件时，工具才可声明一次 **诊断性重放成功**：

1. 有可用 genesis；
2. 所选 stream 的 committed records 按 emitter sequence 连续；
3. 每个非-noop committed record 都携带可解码的 Yjs update；
4. 未观察到已知 gap、截断、损坏或不兼容 record version；
5. 重放后的受控 identity 与请求目标一致。

即使满足这些条件，也只证明工具重放了所持有的日志；best-effort emitter 可能在无法留下 gap 记录时丢失数据，所以日志不能单独证明与生产 namespace 完全一致。

### Interface 与 seam

业务模块依赖一个小的内部 emitter interface，而不依赖日志存储实现：

```ts
interface NamespaceDiagnosticChangeEmitter {
  emit(record: NamespaceDiagnosticChangeRecord): void
}
```

`emit` 的 interface 语义是立即接收一份由调用方持有权已转移或已复制的 detached record；不得阻塞、throw、返回 durability promise，亦不得保留调用方可变引用。日志模块可在其实现内部使用有界队列、batch、sampling、文件或远端 sink。

完整查询、导出、重放、保留与健康检查属于日志存储/工具模块的 interface，不扩张 `NamespaceRuntime`、`NamespaceLease`、`DocPersistence` 或 replication wire interface。一个日志 adapter 不构成新的 Persistence 真相源；snapshot Persistence 与诊断日志独立演进。

### 时序与 sequencer

变更尝试的业务排序继续由现有 Registry lifecycle slot 或 namespace write sequencer 决定，日志不得引入第二个业务排序机构：

- acceptance 前拒绝在对应公共入口记录；
- 已接纳操作在取得既有槽后记录真实 gate、snapshot、validation 和 transaction 结局；
- committed record 的 sequence 分配与 emitter 接收可发生在 transaction committed 事实可知之后，但 emitter 不被 `await`；
- `notifyDirty` 仍按 ADR 0008/0010 的原有槽序执行。日志记录 dirty failure，但不替代或包裹 dirty notification；
- adapter 慢、失败或队列满都不得延长 write slot 或阻塞 close/shutdown；Host shutdown 可 best-effort drain 日志，但 Registry/Persistence 的停止不得无限等待日志 sink。

## 被否方案

- **只记录成功事务**：无法解释最常见的输入、schema、authorization、identity 与 capability gate 拒绝。
- **日志 append 成为操作成功条件**：把 observability 故障升级为业务故障，并在 Yjs 已提交后制造无法回滚的双写问题。
- **在方法入口序列化原始请求**：会额外执行 Proxy/accessor，破坏输入零访问与单快照纪律。
- **使用 mutation input 作为重放真相源**：无法忠实表达 Yjs CRDT effect、SCHEMA generation replacement 或 trusted raw replication。
- **把日志放进 `DocPersistence.saveDoc`**：Persistence 只看到 dirty notification，看不到 rejected attempts、阶段、稳定 issues 或精确 transaction 意图。
- **称为 event sourcing、WAL 或审计账本**：会虚假暗示日志完整性、提交耦合、合规留存或由领域事件重建 read model。

## 后果

- 排错可以关联“尝试—阶段—结局—稳定 issue/fatal—可选 committed update”，包括零写入拒绝。
- 日志故障与业务正确性隔离，但代价是日志天然可能不完整；任何 UI、CLI 和文档都必须展示 best-effort 与 replay 条件。
- 为避免额外读取敌意输入，Runtime/Registry 的受控 snapshot 需要成为日志捕获的唯一 payload 来源。
- 为记录精确 committed effect，doc-runtime/replication transaction seam 未来需要提供 owned update bytes；该演进不得暴露 live Y.Doc。
- 数据保护成为显式配置责任；开启 full input 或 update logging 会显著增加敏感数据、容量和保留成本。

## 关联

本 ADR 增加可选 observability，不修改 ADR 0006 的 snapshot Persistence 与 dirty notification 语义、ADR 0008 的单 sequencer/zero-write/fatal/close 契约、ADR 0009 的 Registry lifecycle 与 observer 隔离、ADR 0010 的 trusted replication、ACK 和 transport observability 语义。实现切片应另行定义 record schema 版本、默认策略、容量上限、adapter、查询与 replay 工具。

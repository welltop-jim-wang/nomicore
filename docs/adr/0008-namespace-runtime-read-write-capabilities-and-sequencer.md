# ADR 0008：NamespaceRuntime 读写能力与单序列器

日期：2026-08-23
状态：已接受（NamespaceRuntime 设计；在 `docs/doc-runtime-validation` 集成 ADR 0007 后生效）

## 背景

Namespace 的读取频率高于写入。创建和所有受控写入负责用 VFSL 建立并维持数据不变量，因此普通 open/read 不应再次编译或校验 VFSL；同时，同一 live Y.Doc 的所有写必须串行，避免验证、schema 切换、事务提交与 dirty notification 相互穿插。

本决策建立独立包 `@nomicore/namespace-runtime`。它组合 `@nomicore/doc-runtime`、`@nomicore/vfsl` 与 Persistence 的窄通知接缝；不承担 Registry、鉴权、REST/WS、Persistence 实现或原始 Yjs 同步协议。

## 公共概念面：Schema、Data、Metadata

Namespace 的普通调用方只需要三个概念：Schema 描述数据，Data 是受 Schema 约束的业务事实，Metadata 是 namespace 的系统与生命周期事实。公共方法使用 `getSchema()`、`readData()`、`mutateData()` 与 `getMetadata()`；`ROOT`、`SCHEMA`、`META` 仅作为 VFSL/Y.Doc 内部载体名出现在实现和底层契约中。该 seam 避免诱导调用方读取并替换完整 ROOT；普通业务写应生成最小、可合并且直接表达业务语义的 mutation。

## 读取能力

Runtime 获得并信任有效 `DocHandle` 后，在对外发布前把 P0 放入 write sequencer 队首，同时立即开放同步读取；读取不等待 P0 或任何写任务，也不进入 sequencer。普通 open 不执行 schema、ROOT 载体或 logical validation，持久化文件被其他程序错误修改不在本契约范围内。

`readLogicalValueAtPath(doc, path)` 去掉 `derived` 参数，从固定 ROOT 按实际载体投影普通逻辑值：

- `Y.Map` 使用 string segment，`Y.Array` 使用严格非负整数 segment；plain object/array 同理；
- map/object 缺键或数组越界均成功返回 `undefined`，中间缺失立即结束；
- plain object 仅读 own enumerable string data property，不走原型链、不执行 accessor；
- plain subtree 仅允许 JSON-compatible plain value，禁止嵌套 Yjs shared type；
- `Y.XmlFragment` 是不可下钻终态，返回语义字符串；未知 Yjs shared type响亮失败，不使用 `toJSON()` fallback；
- 空 path 深拷贝完整 ROOT；非空 path 只转换目标子树；返回值是可变普通深拷贝，不做运行时冻结；
- 预期路径、载体和 lifecycle 失败使用同步结果联合，只有 internal bug 才抛异常。

读取只观察调用瞬间已经提交的 live Y.Doc，不等待已接纳但尚未提交的写。调用方需要 read-your-write 时必须先等待对应写 Promise。

Runtime 另提供同步只读投影：

- `getSchema()` 从顶层 `SCHEMA` Y.Map 投影 `lang/version/id/text` 四个 primitive string，忽略额外键，不 coercion 或补默认值；
- `getMetadata()` 深拷贝顶层 `META` Y.Map 的全部键；META 是开放键空间，但值只允许 JSON-compatible plain value，不允许嵌套 Yjs shared type；v1 不提供 META 写；
- `getActiveSchema()` 返回当前已安装 schema tools 的 `lang/version/id` 与 envelope/semantic fingerprints，不暴露 module、derived 或 validator。

## 单一 write sequencer

同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer；不同 namespace 可并行。v1 公开两个窄方法：

```ts
runtime.mutateData(mutation)
runtime.replaceSchema({ schema: proposedEnvelope, root?: completeLogicalRoot })
```

`mutateData` 接受路径化领域 mutation，而不是“下一个完整 Data”快照。普通业务更新定位到最窄可独立写入节点：叶子用 `set`，Record 条目/optional 字段用 `set` 或 `delete`，Y.Array 用 `array-insert` / `array-delete`，只有 plain/leaf/XML 不透明终态才整体 `set`。底层按 ADR 0007 在目标 `Y.Map` 或 `Y.Array` 上提交对应的最小 carrier 修改，保留不相关 Yjs identity，让并发修改不同节点可合并，并使 owned update、verb 与 path 都直接表达实际变更。空路径整体替换仍作为受控管理/迁移能力；它是唯一清空并重装完整 ROOT 的 mutation，不作为普通消费模式。

写方法调用时同步决定接纳顺序。输入引用在排队期间可以变化；任务取得槽后立即用受控 snapshotter 复制并递归冻结 plain data，之后编译、校验、构造和提交只使用该内部快照。snapshotter 只接受 primitive、finite number、null、plain object/array，拒绝 accessor、class instance、特殊对象、symbol key、循环引用及其他非 plain data。

每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务。`notifyDirty` 是由构造方绑定 `persistence.saveDoc(handle)` 的窄接缝；Runtime 不依赖整个 `DocPersistence`。成功只表示 live commit 与 dirty notification 已登记，不表示已经落盘。

`persistence-degraded` 阻止 ROOT、SCHEMA 以及未来所有 Y.Doc 写；它不阻止 read 或不写 Y.Doc 的 P0。gate 是瞬时观察：检查后才发生的降级不撤销已提交事务，dirty notification 仍必须登记最新 live doc。

## P0 与 active schema

Runtime 发布前，P0 已作为 write sequencer 的真实队首节点入队；发布后 read 立即可用，早期写排在 P0 后。P0 只读取 SCHEMA 标准四键、调用 `compileSchemaEnvelope` 并构造 schema-dependent tools，不读取、提取或验证 ROOT，也不捕获跨时间 prepared mutation。

P0 结算后出队，只保留：

- `preparing`；
- `ready` 与 active schema tools；或
- `unavailable` 与稳定 schema issue 摘要。

正常 compile result failure 仅使 ROOT write unavailable；SCHEMA write仍可修复。P0 抛出结果联合之外的 internal exception 则永久关闭该 Runtime 的所有写。ROOT write 在自己的槽开始时使用当时 active schema；它不绑定调用时 schema generation。

## ROOT write 与 SCHEMA write

ROOT write 依赖 active schema tools。没有可用 schema 时零写入失败；否则每笔写按 ADR 0007 的 validated mutation 管线检查当前 ROOT、在普通 JSON 副本中模拟并校验完整 proposed ROOT、在事务前 detached 构造目标新值，再以一个 guarded Yjs transaction 直接修改目标 carrier；事务后验证 live ROOT 与 proposed ROOT 一致。非空路径 mutation 不重建完整 ROOT。

SCHEMA write 不依赖当前 schema 可编译。它在自己的完整 sequencer 槽内：

1. 编译 proposed SCHEMA 并构造新 tools；
2. 未提供 `root` 时，按 proposed derived 严格提取并验证当前 ROOT，证明逻辑值与实际载体均已兼容；
3. 提供 `root` 时，将其视为最终完整 logical ROOT snapshot，验证并 detached 构造完整新内容；
4. 在一个 transaction 中原子替换 SCHEMA 与必要的 ROOT generation；
5. transaction 返回后立即安装新 active tools，再 `await notifyDirty()`。

SCHEMA 是顶层具名 Y.Map。成功替换时在 transaction 内 `clear()` 后写入恰好 `lang/version/id/text` 四个字符串键。提供完整 ROOT 时保留顶层 `doc.getMap('ROOT')` identity，在同一 transaction 内清空并安装已 detached 构造的内容；其下旧 Yjs 子类型 identity 可失效。不提供 ROOT 时不修改 ROOT，也不破坏其 identity。

新 SCHEMA 的编译、最终 ROOT 校验或 detached 构造失败均发生在 transaction 前，SCHEMA/ROOT 零写入，active tools 不变。读取在准备期间继续观察旧 committed generation；transaction 后才观察新 SCHEMA/ROOT，且 active identity同步切换。

## Fatal 与失败通道

普通、可预期且零写入的读取或写入失败使用领域化结果联合；ROOT mutation 与 SCHEMA replacement 使用各自独立的窄 issue 类型，不形成巨型 write issue。

`@nomicore/doc-runtime` 必须提供 branded `DocRuntimeFatalError`，至少包含 `committed` 与稳定 `phase`。任何 internal fatal——无论 committed 与否——都永久关闭该 Runtime 的全部写能力并保留读取：

- `committed:false` 不调用 dirty notifier；
- `committed:true` 或未知异常保守视为可能已提交，在当前槽内 best-effort `notifyDirty()`，但始终 reject 原始 fatal；
- 不补偿、不 fallback、不声称 rollback；
- post-commit fatal 以带 `committed:true` 的稳定 `RuntimeWriteFatalError` reject，上层不得自动重试非幂等写；
- 已排队的后续写仍按 FIFO 取得槽，且不访问输入、零写入返回 `RUNTIME_WRITE_DISABLED`。

## 生命周期、状态与所有权

Runtime 成功构造后独占一个 `DocHandle`；构造失败时所有权仍归调用方。Runtime 不公开 handle、Y.Doc、ROOT/SCHEMA/META live 引用或生产构造器。生产工厂保留包内，由未来 Registry 使用；测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault。

`close()` 幂等。首次调用同步进入 `closing`，立即停止接纳公共 read 和 write，并在队尾加入 close barrier；此前已接纳任务无条件排空，不取消、不设内部 timeout。barrier 只调用一次 `handle.release()`；无论 release 成败，Runtime 都进入 `closed`，失败时 close Promise reject，后续 close 返回同一个已结算 Promise。

Runtime 提供结构化瞬时 capability status，而不是单一扁平枚举：lifecycle、read、ROOT write、SCHEMA write，以及稳定且不含原始 Error/stack/SCHEMA 全文/ROOT 数据的 schema、fatal、close issue 摘要。status 不暴露队列长度、任务类型或 sequence。v1 不提供公共事件订阅；队列进度和内部事件属于日志、metrics 与 trace。

Runtime 公开冻结的 `owner.userId` 与 `namespaceId` 身份投影；它们是分区/文档身份，不代表授权。

## 必要的底层演进与实施顺序

Runtime 实现前先完成以下 `@nomicore/doc-runtime` 契约演进：

1. `readLogicalValueAtPath(derived, doc, path)` 改为 schema-independent 的 `readLogicalValueAtPath(doc, path)`；
2. transaction helper 提供 committed-aware branded fatal contract；
3. SCHEMA replacement 可复用 detached builder 与原子 ROOT-content replacement helper，不复制 materialization 逻辑。

随后实现 `@nomicore/namespace-runtime` 的 P0、single sequencer、ROOT/SCHEMA 两类写、fatal/status/close，并以确定性状态机测试和真实 compiler/doc-runtime/Persistence 集成测试共同验收。Registry 另行设计。

## 取代关系

本 ADR 取代 ADR 0007 中“普通 open 必须完成 schema 编译、META 检查、ROOT 提取和 logical validation 后才注册 Runtime”以及 schema-aware `readLogicalValueAtPath(derived, doc, path)` 的 Runtime/open/read部分。ADR 0007 关于 logical validation、detached materialization、validated mutation、零写入和 observer no-rollback 的底层决策继续有效。

### 稳定码注册修订（2026-08-24，issue #93 全链集成验收收口）

本节为**词汇收口注册**：为正文已裁决的行为补记公共面可观测稳定码字面量，并澄清一个跨任务已裁定的码域统一语义。三个字面量的形状与语义已在 issue #90/#92 中经 SA8 裁决并让渡——issue #92 的 SA8 设计后复审报告明文「SA6 已把三个字面量……明文让渡给 SA1，属任务内授权」，逐条登记见两任务 SA8 前置决议的「设计后复审追加」节（#92 第 3–6 条、#90 第 1 条）。本节不引入新决策；除下列明示条款外，正文其余条款维持原文效力。

1. **read 停接纳稳定码 `RUNTIME_READ_DISABLED`**：`close()` 进入 `closing`/`closed` 后，公共 read 的 lifecycle 失败（正文「读取能力」节「预期路径、载体和 lifecycle 失败使用同步结果联合」）经同步结果联合返回该稳定码分支——lifecycle 失败不是路径缺陷，不借用路径失败码。

2. **`RUNTIME_WRITE_DISABLED` 码域澄清**：该码是写停接纳/写禁用的统一码族，覆盖四类零写入、零输入访问的拒绝——fatal 已置位后的排队写（正文「Fatal 与失败通道」节）、写前 writable gate 拒绝（handle 状态非 ready：persistence-degraded / released / disposed 三态同拒——正文「单一 write sequencer」节 persistence-degraded 条款为直接依据，released/disposed 同属租约失效下的非 ready 拒绝）、notifyDirty 未绑定的构造方义务 loud gate、close 后 lifecycle≠ready 的接纳拒绝（正文「生命周期、状态与所有权」节「立即停止接纳公共 read 和 write」）；区分域靠 issue message 文案，不另设新码。

3. **close 拒绝稳定码 `NSRT-CLOSE-RELEASE-FAILED`**：release 失败时 close Promise 的 rejection 携带该稳定码（包内 branded rejection 类，`cause` 保留原始异常；status 的 close issue 摘要同码）——正文「失败时 close Promise reject」未定 rejection 值形状，此为既定最小公共面注册。

4. **术语纪律注记**：本文行文「永久关闭（写能力）」在可观测 message/status 词汇中表述为「永久禁用……读取仍保留」——避免与 close 生命周期域词（closing/closed）碰撞；该纪律由 `runtime-write-fatal-message-rev1.test.ts` 锚定。

5. **注册表归属**：其余公共面可观测稳定码不逐码入本文，以包内**各稳定码定义处**的 append-only 注册表为准——错误/禁用码族在 `packages/namespace-runtime/src/errors.ts`（`MUTATION_INPUT_NOT_PLAIN_DATA`、`SCHEMA_UNAVAILABLE`、`NSRT-FATAL-P0-INTERNAL`、`NSRT-FATAL-WRITE-INTERNAL`、`NSRT-FATAL-SCHEMA-WRITE-INTERNAL`、`NSRT-SCHEMA-E1`、`NSRT-META-E1/E2`、`HANDLE_NOT_USABLE`），P0 schema issue 摘要派生码在 `packages/namespace-runtime/src/p0.ts` 的 `toIssueSummary`（`SCHEMA_TEXT_INVALID`——正文「P0 与 active schema」节「unavailable 与稳定 schema issue 摘要」的实现词汇，经 status 的 schema 摘要键可观测，亦经 replaceSchema 编译失败 issues 可观测）。`SCHEMA_ENVELOPE_<code>` 动态族是 vfsl `compileSchemaEnvelope` envelope 相位 issue code 的不透明段透传（本包不校验、不注册该码域），归属上游注册表。ADR 记录决策词汇，不复制实现注册表。

### issue #132 修订：复制保留事实投影与管理写（2026-08-27）

本增补依据 **issue #132 / PR #145 review feedback 1 / owner `welltop-jim-wang` / 2026-08-27** 的明确授权（该反馈给出生效路径之一：「若构造期校验是预期设计：显式修订/增补 ADR 0008，说明复制保留字段是普通 open 规则的例外，并记录损坏时拒绝构造的语义」；本增补选择该**构造期复制事实窄例外**路径），登记 Runtime 构造期对 META 复制保留事实的窄读取例外、损坏拒绝语义与两个 ADR 0010 授权的管理写方法。除下列明示条款外，正文其余条款维持原文效力。

1. **授权链、读取例外及闭合边界**：仅允许 Runtime 在构造、**对外发布前**同步读取 `META.replicationId` 和 `META.replicationEpoch` 两个保留字段，仅为生成 status 的复制持久事实（lineage identity/epoch）投影；不读取其他 META 键。
2. **两态与损坏通道**：唯一允许的判定是双键均真缺席 → `{state:'disabled'}`，或双键均存在且均合规 → `{state:'enabled'; replicationId; replicationEpoch}`；恰一键存在、键存在而值为显式 `undefined`、格式不合法（id 非 32 位小写 hex / epoch 非 >=1 的安全整数）、META 载体异型均为**持久化损坏**，Runtime 构造同步拒绝（经 Registry 收编为 `NamespaceRegistryFatalError('open', 'runtime-construction', committed:false)`）；禁止伪装 disabled、禁止自动补写新 lineage。
3. **原规则保持**：**除此之外，原第 14 行保持不变**：普通 open 不读取或验证 `SCHEMA`、`ROOT` 或任何 logical value，不编译 schema，不引入通用 META validation；外部持久化文件的其他错误修改仍不在本契约范围。
4. **公共窄写方法**：正文「v1 公开两个窄方法」作如下限定：“基础 v1 方法为两个（`mutateData` / `replaceSchema`）；经 ADR 0010 授权的复制管理例外另加 `enableReplication()` 和 `bumpReplicationEpoch()`”。四者均进入同一严格 FIFO write sequencer，完整槽序（lifecycle/fatal gate → `DocHandle.getStatus()` writable gate → 输入校验 → 领域事实读取 → 单 Yjs transaction → 同步投影 → `await notifyDirty()`）不变。
5. **status 字段**：在正文 status 列举（第 95 行）中补 `replication`；该域仅含持久 identity/epoch 的两态联合（`{state:'disabled'}` 或 `{state:'enabled'; replicationId; replicationEpoch}`），不含 session、网络、队列或 sync 状态。
6. **失败与持久化真相**：`enableReplication()` / `bumpReplicationEpoch()` 的成功仍只表示 live commit + dirty notification 已登记，**不等于已落盘**（ADR 0006 dirty-not-durable）；notify failure 的 committed facts 不回滚，fatal 之后读取与 status 保留最后已提交事实；fatal 恢复只表述为 committed-state recovery，不作 durable restart 承诺。
7. **关联权威**：复制字段格式、不可变性、epoch 上限与 hub-only 管理权以 ADR 0010 为权威；ADR 0008 仅规定 Runtime 的 sequencer 槽序、status 投影、构造期窄例外与失败通道。

### issue #237 修订：ROOT write 镜像句同步（2026-09-06）

本节是 ADR-0007 issue #237 修订节（路径级/边界级校验取代完整 ROOT 校验）在
ADR-0008 的镜像句同步（授权链同上：issue #237 + Owner `welltop-jim-wang`
2026-09-05T16:01Z 范围收敛评论 + ADR-0007 修订节为单一真相源）。除下列明示句
外，正文其余条款（槽序 S1–S7、公共 interface/结果联合、active schema at slot、
SCHEMA write 全量校验、fatal 通道、封装边界、status 观测面、「非空路径 mutation
不重建完整 ROOT」）维持原文效力，零变化。

1. **「ROOT write 与 SCHEMA write」节镜像句改写**（原文「每笔写按 ADR 0007 的
   validated mutation 管线检查当前 ROOT、在普通 JSON 副本中模拟并校验完整
   proposed ROOT、在事务前 detached 构造目标新值，再以一个 guarded Yjs
   transaction 直接修改目标 carrier；事务后验证 live ROOT 与 proposed ROOT 一致」
   → 修订为）：每笔写按 ADR 0007 的 validated mutation 管线沿 live carrier 与
   derived structure 导航并校验**最近必要语义边界**（phase-1 前置假设：槽开始时
   committed ROOT 已符合 active schema——logical values + carrier topology；无
   baseline 状态机），在事务前 detached 构造目标新值，再以一个 guarded Yjs
   transaction 直接修改目标 carrier（最小 edit）；事务后**只验证受影响边界与预期
   一致**（O(1) 安装事实核 + O(boundary) 重投影核），不再无条件重新提取并校验
   完整 ROOT。`set([])`（空路径整体替换）保持完整 ROOT 清空与重装形态，唯一
   全量例外。

### ADR 0016 修订：D8 封口与 readData 结果形状（2026-09-09）

1. **D8 封口改写**：正文「P0 与 active schema」节「不暴露 module、derived 或
   validator」及 active schema tools「内部保留，永不进任何公共面」修订为——
   `derived` 只经 `readData` 语义 schema 投影的受控只读深拷贝进入公共面
   （ADR 0016）；`module` 与 validator 仍永不进入公共面。
2. **readData 成功分支形状**：`{ ok: true, value }` 演进为
   `{ ok: true, value, schema: ReadDataSchemaProjection | null }`；载荷形态、
   缺席语义（`null` 三情形、缺席吸收照常返 schema、空路径返 ROOT 值 schema）
   与交付纪律（always-on、每次读深拷贝）以 ADR 0016 为权威。
3. **原规则保持**：读取保持 schema 无关、不进 sequencer、失败通道
   （`PATH_NOT_ALLOWED` / `RUNTIME_READ_DISABLED`）与读取保留不变量均不变。

### ADR 0017 修订：schema 生命周期元数据（META.schema.updatedAt，2026-09-10）

本节登记 issue #282 / ADR 0017 对本 ADR 的四处修订；规范细节（时钟权威、legacy
兼容、开放问题裁决）以 ADR 0017 为权威。除下列明示条款外，正文其余条款维持
原文效力。

1. **META 值域修订**：正文「`getMetadata()` 深拷贝顶层 `META` Y.Map 的全部键；
   META 是开放键空间，但值只允许 JSON-compatible plain value，不允许嵌套 Yjs
   shared type」修订为——嵌套 **Y.Map** 合法化（递归深拷贝为 plain object），
   首个合法实例是 `META.schema` 生命周期元数据载体；其余嵌套 Yjs shared type
   （Y.Array/Y.Text/Y.Xml* 等）维持禁止（投影 loud 拒绝）。
2. **`getActiveSchema()` 六键投影**：正文「`getActiveSchema()` 返回当前已安装
   schema tools 的 `lang/version/id` 与 envelope/semantic fingerprints」加性扩展
   第六键 `updatedAt: string | null`——当前 active schema generation 的安装时间
   （UTC ISO 8601）或 `null`（legacy/损坏，诚实缺席）。
3. **SCHEMA write 事务语义**：正文「在一个 transaction 中原子替换 SCHEMA 与必要
   的 ROOT generation」扩展为——同一 transaction 同时提交 `META.schema.updatedAt`
   （嵌套 Y.Map；既有载体原实例复用，缺席/异型修复性安装）。每次提交都推进
   `updatedAt`（含语义等价/仅格式差异的替换）；零写入结局不推进；提交后
   dirty notification 失败时时间戳随 committed generation 保留。genesis 的
   `updatedAt` 等于 `META.createdAt`（同一捕获时钟瞬间）。
4. **genesis META 形状**：初始文档 META 顶层由严格二键（docId/createdAt）演进为
   严格三键（docId/createdAt/schema）；「v1 不提供 META 写」句的例外清单在既有
   复制保留字段管理写（issue #132）之外追加——`META.schema.updatedAt` 仅由
   SCHEMA write 事务与 genesis 安装写入，无其他公共写入口。

### ADR 0018 修订：replication apply 槽的提交后 schema 同步段（2026-09-10）

1. **apply 槽序扩展**：peer 角色 hub→peer 复制 apply 槽在「单 Yjs transaction
   → 同步投影」之后、`await notifyDirty()` 之前插入 schema 同步段——比对
   SCHEMA 四键投影与槽开始快照，`text` 字节不等则编译新 SCHEMA、构造并原子
   安装新 active schema tools。不产生新槽类型、不引入优先级，strict FIFO
   不变量不变；正文「同一 live Y.Doc 的所有写必须串行」与「ROOT write 在槽
   开始时使用当时 active schema」条款据此覆盖 re-arm 切换点之后的全部后续槽。
2. **fatal 注册表追加**（`packages/namespace-runtime/src/errors.ts`，
   append-only）：`NSRT-FATAL-SCHEMA-REARM-INVALID`（编译结果失败，带稳定
   schema issue 摘要）、`NSRT-FATAL-SCHEMA-REARM-INTERNAL`（result union 之外
   的内部异常）——结算沿用正文 fatal 语义（写永久禁用、读保留、status 诚实
   透出）；apply 已提交事实不回滚（raw replication 零回滚不变量）。
3. **失败语义归属**：re-arm 失败发生在 apply 槽提交后段，不失败 apply 槽
   本身；规范细节、宿主通知与恢复路径以 ADR 0018 为权威。

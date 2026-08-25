# ADR 0008：NamespaceRuntime 读写能力与单序列器

日期：2026-08-23
状态：已接受（NamespaceRuntime 设计；在 `docs/doc-runtime-validation` 集成 ADR 0007 后生效）

## 背景

Namespace 的读取频率高于写入。创建和所有受控写入负责用 VFSL 建立并维持数据不变量，因此普通 open/read 不应再次编译或校验 VFSL；同时，同一 live Y.Doc 的所有写必须串行，避免验证、schema 切换、事务提交与 dirty notification 相互穿插。

本决策建立独立包 `@nomicore/namespace-runtime`。它组合 `@nomicore/doc-runtime`、`@nomicore/vfsl` 与 Persistence 的窄通知接缝；不承担 Registry、鉴权、REST/WS、Persistence 实现或原始 Yjs 同步协议。

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

- `getSchemaEnvelope()` 从顶层 `SCHEMA` Y.Map 投影 `lang/version/id/text` 四个 primitive string，忽略额外键，不 coercion 或补默认值；
- `getMetadata()` 深拷贝顶层 `META` Y.Map 的全部键；META 是开放键空间，但值只允许 JSON-compatible plain value，不允许嵌套 Yjs shared type；v1 不提供 META 写；
- `getActiveSchema()` 返回当前已安装 schema tools 的 `lang/version/id` 与 envelope/semantic fingerprints，不暴露 module、derived 或 validator。

## 单一 write sequencer

同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer；不同 namespace 可并行。v1 公开两个窄方法：

```ts
runtime.mutateRoot(mutation)
runtime.replaceSchema({ schema: proposedEnvelope, root?: completeLogicalRoot })
```

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

ROOT write 依赖 active schema tools。没有可用 schema 时零写入失败；否则每笔写按 ADR 0007 的 validated mutation 管线检查当前 ROOT、模拟并校验完整 proposed ROOT、detached 构造并单事务提交。

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

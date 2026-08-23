# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
>
> 被审对象：`wiki/raw/task_namespace-runtime-skeleton-p0.md`（issue #89，`@nomicore/namespace-runtime` Runtime 骨架 + 同步读取面 + 队首 P0）。
> 摘录范围：`docs/adr/0001`–`0008` 全集（8/8 全读）中与本任务相关者 + CONTEXT.md 相关术语。

## 相关 ADR

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted）

本任务的行为契约直接来源；简报声明实现其「Runtime 骨架 + 同步读取面 + 队首 P0」子集。

**包边界**

- 「本决策建立独立包 `@nomicore/namespace-runtime`。它组合 `@nomicore/doc-runtime`、`@nomicore/vfsl` 与 Persistence 的窄通知接缝；不承担 Registry、鉴权、REST/WS、Persistence 实现或原始 Yjs 同步协议。」

**读取能力（同步、不等 P0）**

- 「Runtime 获得并信任有效 `DocHandle` 后，在对外发布前把 P0 放入 write sequencer 队首，同时立即开放同步读取；读取不等待 P0 或任何写任务，也不进入 sequencer。普通 open 不执行 schema、ROOT 载体或 logical validation，持久化文件被其他程序错误修改不在本契约范围内。」
- `readLogicalValueAtPath(doc, path)`（schema-independent）逐条：
  - 「`Y.Map` 使用 string segment，`Y.Array` 使用严格非负整数 segment；plain object/array 同理；」
  - 「map/object 缺键或数组越界均成功返回 `undefined`，中间缺失立即结束；」
  - 「plain object 仅读 own enumerable string data property，不走原型链、不执行 accessor；」
  - 「plain subtree 仅允许 JSON-compatible plain value，禁止嵌套 Yjs shared type；」
  - 「`Y.XmlFragment` 是不可下钻终态，返回语义字符串；未知 Yjs shared type响亮失败，不使用 `toJSON()` fallback；」
  - 「空 path 深拷贝完整 ROOT；非空 path 只转换目标子树；返回值是可变普通深拷贝，不做运行时冻结；」
  - 「预期路径、载体和 lifecycle 失败使用同步结果联合，只有 internal bug 才抛异常。」
- 「读取只观察调用瞬间已经提交的 live Y.Doc，不等待已接纳但尚未提交的写。调用方需要 read-your-write 时必须先等待对应写 Promise。」
- 同步只读投影三件套：
  - 「`getSchemaEnvelope()` 从顶层 `SCHEMA` Y.Map 投影 `lang/version/id/text` 四个 primitive string，忽略额外键，不 coercion 或补默认值；」
  - 「`getMetadata()` 深拷贝顶层 `META` Y.Map 的全部键；META 是开放键空间，但值只允许 JSON-compatible plain value，不允许嵌套 Yjs shared type；v1 不提供 META 写；」
  - 「`getActiveSchema()` 返回当前已安装 schema tools 的 `lang/version/id` 与 envelope/semantic fingerprints，不暴露 module、derived 或 validator。」

**单一 write sequencer（本任务建骨架，P0 为真实队首节点）**

- 「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer；不同 namespace 可并行。v1 公开两个窄方法：`runtime.mutateRoot(mutation)`、`runtime.replaceSchema({ schema: proposedEnvelope, root?: completeLogicalRoot })`。」（两类真实写按简报属后续 issue）
- 「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务。`notifyDirty` 是由构造方绑定 `persistence.saveDoc(handle)` 的窄接缝；Runtime 不依赖整个 `DocPersistence`。成功只表示 live commit 与 dirty notification 已登记，不表示已经落盘。」
- 「`persistence-degraded` 阻止 ROOT、SCHEMA 以及未来所有 Y.Doc 写；它不阻止 read 或不写 Y.Doc 的 P0。gate 是瞬时观察：检查后才发生的降级不撤销已提交事务，dirty notification 仍必须登记最新 live doc。」

**P0 与 active schema（本任务核心）**

- 「Runtime 发布前，P0 已作为 write sequencer 的真实队首节点入队；发布后 read 立即可用，早期写排在 P0 后。P0 只读取 SCHEMA 标准四键、调用 `compileSchemaEnvelope` 并构造 schema-dependent tools，不读取、提取或验证 ROOT，也不捕获跨时间 prepared mutation。」
- 「P0 结算后出队，只保留：`preparing`；`ready` 与 active schema tools；或 `unavailable` 与稳定 schema issue 摘要。」
- 「正常 compile result failure 仅使 ROOT write unavailable；SCHEMA write仍可修复。P0 抛出结果联合之外的 internal exception 则永久关闭该 Runtime 的所有写。ROOT write 在自己的槽开始时使用当时 active schema；它不绑定调用时 schema generation。」

**Fatal 与失败通道**

- 「`@nomicore/doc-runtime` 必须提供 branded `DocRuntimeFatalError`，至少包含 `committed` 与稳定 `phase`。任何 internal fatal——无论 committed 与否——都永久关闭该 Runtime 的全部写能力并保留读取：」
  - 「`committed:false` 不调用 dirty notifier；」
  - 「`committed:true` 或未知异常保守视为可能已提交，在当前槽内 best-effort `notifyDirty()`，但始终 reject 原始 fatal；」
  - 「不补偿、不 fallback、不声称 rollback；」
  - 「post-commit fatal 以带 `committed:true` 的稳定 `RuntimeWriteFatalError` reject，上层不得自动重试非幂等写；」
  - 「已排队的后续写仍按 FIFO 取得槽，且不访问输入、零写入返回 `RUNTIME_WRITE_DISABLED`。」
- 「普通、可预期且零写入的读取或写入失败使用领域化结果联合；ROOT mutation 与 SCHEMA replacement 使用各自独立的窄 issue 类型，不形成巨型 write issue。」

**生命周期、状态与所有权（本任务 AC1/AC2/AC3 的直接依据）**

- 「Runtime 成功构造后独占一个 `DocHandle`；构造失败时所有权仍归调用方。Runtime 不公开 handle、Y.Doc、ROOT/SCHEMA/META live 引用或生产构造器。生产工厂保留包内，由未来 Registry 使用；测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault。」
- 「`close()` 幂等。首次调用同步进入 `closing`，立即停止接纳公共 read 和 write，并在队尾加入 close barrier；此前已接纳任务无条件排空，不取消、不设内部 timeout。barrier 只调用一次 `handle.release()`；无论 release 成败，Runtime 都进入 `closed`，失败时 close Promise reject，后续 close 返回同一个已结算 Promise。」（close barrier 按简报属后续 issue）
- 「Runtime 提供结构化瞬时 capability status，而不是单一扁平枚举：lifecycle、read、ROOT write、SCHEMA write，以及稳定且不含原始 Error/stack/SCHEMA 全文/ROOT 数据的 schema、fatal、close issue 摘要。status 不暴露队列长度、任务类型或 sequence。v1 不提供公共事件订阅；队列进度和内部事件属于日志、metrics 与 trace。」（完整 status 投影按简报属后续 issue；本任务 status 面不得固化与「结构化、非单一扁平枚举、不暴露队列内部」相悖的形状）
- 「Runtime 公开冻结的 `owner.userId` 与 `namespaceId` 身份投影；它们是分区/文档身份，不代表授权。」

**必要的底层演进（前置兑付情况）**

- 「Runtime 实现前先完成以下 `@nomicore/doc-runtime` 契约演进：1. `readLogicalValueAtPath(derived, doc, path)` 改为 schema-independent 的 `readLogicalValueAtPath(doc, path)`；2. transaction helper 提供 committed-aware branded fatal contract；3. SCHEMA replacement 可复用 detached builder 与原子 ROOT-content replacement helper，不复制 materialization 逻辑。」
  - 简报声明：1 已由 #86 交付、2 已由 #87 交付；3 服务 replaceSchema（后续 issue）。

**取代关系（决定 ADR-0007 哪些条款不再是约束）**

- 「本 ADR 取代 ADR 0007 中“普通 open 必须完成 schema 编译、META 检查、ROOT 提取和 logical validation 后才注册 Runtime”以及 schema-aware `readLogicalValueAtPath(derived, doc, path)` 的 Runtime/open/read部分。ADR 0007 关于 logical validation、detached materialization、validated mutation、零写入和 observer no-rollback 的底层决策继续有效。」

### ADR-0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted；Runtime/open/read 条款由 ADR-0008 部分取代）

P0 的编译入口与 fatal 契约来源；被取代条款不构成约束。

- 「新增纯函数 `compileSchemaEnvelope(input: unknown)`：输入必须是严格封闭且恰含 `lang/version/id/text` 的信封；按 envelope、dialect、parse、evaluate、internal 分阶段返回结果联合。」
- 「编译成功产物包含冻结的 envelope、IR module、DerivedSchema、`envelopeFingerprint` 与 `semanticFingerprint`。」
- 「module/derived 递归深冻结后才允许未来跨 namespace 共享；本阶段不实现编译缓存，缓存生命周期留给 NamespaceRuntime/Registry。」
- 「NamespaceRuntime 将来按 namespace 串行化所有业务写入：轮到 mutation 时先检查 writable gate，同步调用 `applyValidatedMutation`，成功后立即调用 persistence `saveDoc` 标脏。业务调用方不得取得可写 Yjs 引用或绕过该入口；未来原始 Yjs update 必须另设受控验证通道。」
- 「该 open/read 编排已由 ADR 0008 取代：Runtime 信任有效 DocHandle，发布前仅把 schema preparation P0 放入单一 write sequencer，发布后立即开放 schema-independent read，写入仍负责建立并维持完整不变量。」
- 失败边界（继续有效）：「Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报。事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback。」

### ADR-0006 Cordis 持久化插件——DocPersistence 接口与 doc 三条目内容布局（accepted；含 issue #64、#79 修订节）

Runtime 独占的 `DocHandle` 的形状与语义来源。

- 接口契约（issue #79 修订后现状）：

```ts
type DocHandleStatus = 'ready' | 'persistence-degraded' | 'released' | 'disposed'

interface DocHandle {
  readonly owner: User;   // 文档的存储所有者（分区键），非当前访问者
  readonly docId: string;
  readonly doc: Y.Doc;
  /** 同步返回本 handle 所属 (owner.userId, docId) entry 的持久层状态。 */
  getStatus(): DocHandleStatus;
  release(): Promise<void>;
}
```

- 「状态查询是 **entry 级**的：恒答该 handle 自己的 `(owner.userId, docId)` entry 的状态，不得以 Adapter 聚合状态代替」；「`getStatus()` 只表示**调用瞬间**状态，不承诺后续 flush 成功」。
- 「`owner` 仅作分区键，本层不鉴权」；「userId 与 namespaceId 均由 NomicoreServer 分配，作为受控安全路径段使用（不允许特殊字符/路径分隔符）。存储按用户分区，namespaceId 在用户目录内唯一。」
- doc 三条目内容布局：「`SCHEMA` 信封（lang, version, id, text）」「`META` 元信息（Y.Map：docId, createdAt）」「`ROOT` 数据根」；「META/SCHEMA 作为 ROOT 的兄弟条目，天然在 validateSnapshot/validatePatch 的校验面之外（校验只作用 ROOT 子树）」。
- 「同一 `(user, docId)` 的所有成功 load 共享同一 live Y.Doc 实例……但每次 load 返回独立 DocHandle/lease」；「release 幂等且仅释放本次使用权」。

### ADR-0003 求值器与派生 schema（accepted）

P0 内 `compileSchemaEnvelope` 所经 parse/evaluate 的契约背景。

- 「每个模块必须恰好声明一个名为 `ROOT` 的别名（大小写是契约……）且必须 **map 形**……ROOT 固定物化为 Y.Map……Yjs 映射为 `doc.getMap('ROOT')`。」
- 「新增公共导出 `evaluate(module: VfslModule) → { ok: true; derived } | { ok: false; issues }`。派生 schema 延续 IR 全部纪律：纯数据、可 JSON 序列化、可内容哈希、不携带行列位置。」

### ADR-0001 VFSL 文本是 schema 的唯一真相源（accepted；含 2026-08-19 修订、2026-08-21 命名修订）

信封键名与「仓库不含 schema 文本」纪律。

- 「本仓库是纯引擎仓库：代码库不含 schema 文本（测试 fixture 除外）。」
- 「解释行为由信封自述的方言版本决定，方言只增不改，未知方言 loud-fail 只读。」
- 「引擎必须在运行时解析任意合法方言文本，性能依赖按内容哈希的编译缓存。」
- 命名修订：「信封在 doc 中的键名由 `__schema__` 改为 **`SCHEMA`**——与 `ROOT` 保持统一命名（doc 顶层两个具名条目：`SCHEMA` 信封 + `ROOT` 数据）。信封内部结构 `{lang, version, id, text}` 不变。」

### ADR-0002 / ADR-0004 / ADR-0005（accepted；与本任务无直接条款交集）

- ADR-0002：authority 规则完全出范围、不保留接口——本任务不得引入任何 authority 式不变式机制。
- ADR-0004 / ADR-0005：vfsl-protocol 类型投影与 codegen 管线——本任务不触碰协议包/生成器/domains。

## CONTEXT.md 相关术语与惯例

- **信封（envelope）**：「顶层具名 `SCHEMA` Y.Map 中 `lang/version/id/text` 四个字符串键投影出的严格普通对象；兼容读取忽略额外键，规范写入以一次 transaction 清空并重写四键。信封可哈希、可 diff。」
- **命名空间（namespace）**：「一个 Y.Doc 连同自带的 `SCHEMA` 信封与数据；schema 随数据走，不依赖代码模块。」_Avoid_: schema 注册表。
- **ROOT**：「命名空间根别名的保留名（大小写是契约）：每个模块必须恰好声明一个 map 形的 `type ROOT = …`，ROOT 固定物化为 Y.Map，Yjs 映射为 doc 根 `getMap('ROOT')`。」
- **载体投影读取（readLogicalValueAtPath）**：「从 live Y.Doc 的固定 ROOT 按实际 Yjs/plain 载体和路径同步投影普通逻辑值；不依赖 VFSL/派生 schema，也不重复执行结构或逻辑校验。创建与受控写入负责建立并维持数据不变量；持久化文件被其他程序错误修改不在运行时读取契约范围内。」_Avoid_: validated read、schema-aware read。
- **写序列器（write sequencer）**：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。」_Avoid_: mutation queue（范围过窄，容易让 SCHEMA/META 管理写建立旁路）。
- **P0（schema preparation）**：「Runtime 发布前已进入写序列器队首的 schema 准备任务；只投影并编译 SCHEMA、构造 active schema tools，不读取或验证 ROOT。Runtime 发布后读取立即可用，早期写排在 P0 后。」
- **active schema**：「NamespaceRuntime 当前安装、供 ROOT write 使用的已编译 schema tools 及身份；SCHEMA write 的 transaction 成功后同步切换，不等同于对 live SCHEMA 的即时读取。」
- **信封指纹（envelope fingerprint）**：「封闭四键 schema 信封 `{ lang, version, id, text }` 的身份；任一键变化都会改变。」
- **语义指纹（semantic fingerprint）**：「`lang + version +` 解析后规范 IR 的语义身份；忽略空白与普通注释，保留 JSDoc、声明顺序及其他 VFSL 语义，并排除仅作谱系标签的 `id`。用于共享编译语义产物。」
- **零写入（zero-write）**：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」（约束后续真实写面；本任务 P0 不写 Y.Doc。）
- **逻辑快照校验（validateLogicalSnapshot）**：「对普通 JSON 逻辑 ROOT 快照运行完整值语义校验；不接收 Y.Doc / Y.Map / Y.Array……普通 open/read 不重复校验已持久化 namespace。」（active schema tools 内含 validator；Runtime 读取面不得调用它重校验。）

## 简报显式延后的条款（原文对照，供 SA1 保留扩展位）

简报原文：「本任务实现其中『Runtime 骨架 + 同步读取面 + 队首 P0』子集；mutateRoot/replaceSchema 两类真实写、close barrier、完整 status 投影属后续 issue。」

延后项仍受 ADR-0008 既有条款约束（不得提前固化相悖形状）：

- `mutateRoot` / `replaceSchema`：v1 公开两个窄方法、写槽七步顺序、`notifyDirty` 窄接缝、SCHEMA write 五步槽内流程、ROOT/SCHEMA identity 规则。
- close barrier：`close()` 幂等、`closing` 同步进入、队尾 barrier、仅一次 `handle.release()`、已接纳任务无条件排空。
- 完整 status 投影：结构化 capability status（lifecycle/read/ROOT write/SCHEMA write + schema/fatal/close issue 摘要）、不暴露队列长度/任务类型/sequence、v1 无公共事件订阅。
- 测试 seam：必须是**包内**确定性 seam（注入可控 P0、dirty notifier、handle 与 fault），不得以公共事件订阅或公共生产构造器替代。

---

## 设计引入的新决策点（设计后复审追加；来源 `task_namespace-runtime-skeleton-p0_design.md`）

> 以下为 SA1 设计在 **ADR 未明文规定处**做出的显式选择。SA8 逐条裁决均为 no-conflict
> （分析见 `task_namespace-runtime-skeleton-p0_design_conflict_report.md`）；摘录于此供
> SA2/SA3/SA4/SA7 对照——它们是设计契约的组成部分，但不是 ADR 条款本身。

- **Seam 出口形态（D8'）**：`createNamespaceRuntimeWithSeam` 从 `index.ts` 导出并标 `@internal`（沿 vfsl `getCompiledWith` 先例）；生产工厂 `createNamespaceRuntime` 保留包内、不从 index 导出（AC1 测试锁定 `entry.createNamespaceRuntime === undefined`）。SA6 冻结测试经 `../src/index.js` 导入，seam 必须自 index 可达。
- **构造状态门（D1 V2）**：接受 `ready` / `persistence-degraded`；拒绝 `released` / `disposed` 及任何未知值（`NamespaceRuntimeConstructionError`，code `HANDLE_NOT_USABLE`，loud 不降级）。消费 ADR-0006 冻结状态词表 + ADR-0008「persistence-degraded……不阻止 read 或不写 Y.Doc 的 P0」。
- **getSchemaEnvelope null 三分支与原始投影（D4）**：载体缺席（`doc.share.has('SCHEMA')===false`）/ 异型（`getMap` throw）→ `null`；Y.Map 存在 → 四标准键原始投影：值原样带出（含类型错）、键缺席即省略、额外键结构性不出现、不 coercion 不补默认。version 按 vfsl 契约为 number，原样投影。
- **getMetadata 值域违规 loud（D5）**：META 值含嵌套 Yjs shared type / NaN/±Inf / 非 plain 对象 / undefined 值键等 → 抛 `MetaProjectionError`（code `NSRT-META-E1`），绝不静默跳键或降级。ADR-0008 只规定值域不变量（写方责任），未规定违规时读取投影的行为；此为设计的显式选择。
- **P0 fatal 表示（D7 ⑦）**：P0 零 Y.Doc transaction，internal fault 不经 `DocRuntimeFatalError`（committed 维度不适用），走自有稳定摘要 `{ code: 'NSRT-FATAL-P0-INTERNAL', message }`（恒定文案，不含原始异常文本）；`schema.state` 停留 `preparing`（三态集合封闭）。行为协议（永久关写保读、不调 dirty notifier、不补偿不 fallback）与 ADR-0008 fatal 条款一致。
- **外部违约 release 边界（D1）**：调用方越过 runtime 直接 `handle.release()` 属租约违约；后果仅 D9 写位瞬时观察转 false，读取面继续观察 live doc 引用，lifecycle 不变（真正的生命周期迁移随 close() 后续 issue）。
- **status v1 形状（D9）**：六键结构化 `{ lifecycle, read, rootWrite, schemaWrite, schema, fatal }`；`lifecycle` 类型仅声明 `'ready'` 字面量；close issue 摘要随 close() 后续 issue 增补；无 queue/sequence/taskType 键、无数组值字段。
- **sequencer 链语义（D6）**：promise-chain FIFO——前项 settle（含 reject）后本项方执行、链尾恒绿（noop 吞 reject，队列不因单项失败断裂）；P0 入队后以微任务起步（ECMAScript PromiseJobs 规范级保证构造栈内零执行）。与 ADR-0008「已排队的后续写仍按 FIFO 取得槽」前向一致。
- **能力位语义（D9）**：`rootWrite.enabled = !fatal && schema.state!=='unavailable' && handle.getStatus()==='ready'`（preparing 期为 true——早期写可接纳、排队于 P0 后）；`schemaWrite.enabled = !fatal && handle.getStatus()==='ready'`（unavailable 后仍可修复）；`handle.getStatus()` throw 则原样传播（adapter bug，loud）。
- **写槽扩展位（§0/D6，仅文档不预写代码）**：七步顺序与 ADR-0008 逐字一致（lifecycle/fatal gate → `getStatus()` 写门 → 输入快照（受控 snapshotter）→ 领域校验/detached 构造 → 一次 transaction → `await notifyDirty()` → 槽释放）；close barrier = 队尾 `enqueue(release 槽)` 挂接点。
- **构建层决策（§7，非 ADR 约束面，登记备查）**：`packages/namespace-runtime/tsconfig.json` include 仅 `src/**`（偏离六包惯例；依据：SA6 冻结测试注入字面量与 vfsl `SchemaEnvelopeIssueCode` 闭集类型不符，include test/** 则 `tsc -p` 必红，而冻结测试不可改）；根 `package.json` typecheck 脚本追加 `tsc -p packages/namespace-runtime/tsconfig.json` 一段。ADR/CONTEXT 无对应条款——属 SA2/SA4 评审面，不构成门禁事项。

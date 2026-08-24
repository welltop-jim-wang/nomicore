# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（Phase 0，任务：namespace-runtime 单 write sequencer 与 validated ROOT write，issue #90）。
> 只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文（`docs/adr/`）。
> 摘录来源：ADR-0001 … ADR-0008 全集（8 份，全读）+ 根目录 CONTEXT.md。

## 相关 ADR

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted）

本任务唯一行为契约源（任务简报关键上下文 1）。本任务实现其中「单一 write sequencer」节、「ROOT write」子集与「Fatal 与失败通道」节的 ROOT mutation 部分；SCHEMA write（replaceSchema）、close() barrier、公共事件订阅不属本任务。

核心条款（原文摘录）：

**单一 write sequencer 节：**

- 「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer；不同 namespace 可并行。v1 公开两个窄方法：`runtime.mutateRoot(mutation)`、`runtime.replaceSchema({ schema: proposedEnvelope, root?: completeLogicalRoot })`」
- 「写方法调用时同步决定接纳顺序。输入引用在排队期间可以变化；任务取得槽后立即用受控 snapshotter 复制并递归冻结 plain data，之后编译、校验、构造和提交只使用该内部快照。snapshotter 只接受 primitive、finite number、null、plain object/array，拒绝 accessor、class instance、特殊对象、symbol key、循环引用及其他非 plain data。」
- 「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务。`notifyDirty` 是由构造方绑定 `persistence.saveDoc(handle)` 的窄接缝；Runtime 不依赖整个 `DocPersistence`。成功只表示 live commit 与 dirty notification 已登记，不表示已经落盘。」
- 「`persistence-degraded` 阻止 ROOT、SCHEMA 以及未来所有 Y.Doc 写；它不阻止 read 或不写 Y.Doc 的 P0。gate 是瞬时观察：检查后才发生的降级不撤销已提交事务，dirty notification 仍必须登记最新 live doc。」

**读取能力节（本任务 AC8 的读侧锚点）：**

- 「读取只观察调用瞬间已经提交的 live Y.Doc，不等待已接纳但尚未提交的写。调用方需要 read-your-write 时必须先等待对应写 Promise。」

**P0 与 active schema 节：**

- 「P0 结算后出队，只保留：`preparing`；`ready` 与 active schema tools；或 `unavailable` 与稳定 schema issue 摘要。」
- 「正常 compile result failure 仅使 ROOT write unavailable；SCHEMA write仍可修复。P0 抛出结果联合之外的 internal exception 则永久关闭该 Runtime 的所有写。ROOT write 在自己的槽开始时使用当时 active schema；它不绑定调用时 schema generation。」

**ROOT write 与 SCHEMA write 节（本任务只兑付 ROOT 侧）：**

- 「ROOT write 依赖 active schema tools。没有可用 schema 时零写入失败；否则每笔写按 ADR 0007 的 validated mutation 管线检查当前 ROOT、模拟并校验完整 proposed ROOT、detached 构造并单事务提交。」

**Fatal 与失败通道节（ROOT mutation 部分为本任务逐句验收锚）：**

- 「普通、可预期且零写入的读取或写入失败使用领域化结果联合；ROOT mutation 与 SCHEMA replacement 使用各自独立的窄 issue 类型，不形成巨型 write issue。」
- 「`@nomicore/doc-runtime` 必须提供 branded `DocRuntimeFatalError`，至少包含 `committed` 与稳定 `phase`。任何 internal fatal——无论 committed 与否——都永久关闭该 Runtime 的全部写能力并保留读取：」
  - 「`committed:false` 不调用 dirty notifier；」
  - 「`committed:true` 或未知异常保守视为可能已提交，在当前槽内 best-effort `notifyDirty()`，但始终 reject 原始 fatal；」
  - 「不补偿、不 fallback、不声称 rollback；」
  - 「post-commit fatal 以带 `committed:true` 的稳定 `RuntimeWriteFatalError` reject，上层不得自动重试非幂等写；」
  - 「已排队的后续写仍按 FIFO 取得槽，且不访问输入、零写入返回 `RUNTIME_WRITE_DISABLED`。」

**生命周期、状态与所有权节（seam 与公共面约束）：**

- 「Runtime 不公开 handle、Y.Doc、ROOT/SCHEMA/META live 引用或生产构造器。生产工厂保留包内，由未来 Registry 使用；测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault。」
- 「Runtime 提供结构化瞬时 capability status，而不是单一扁平枚举：lifecycle、read、ROOT write、SCHEMA write，以及稳定且不含原始 Error/stack/SCHEMA 全文/ROOT 数据的 schema、fatal、close issue 摘要。status 不暴露队列长度、任务类型或 sequence。v1 不提供公共事件订阅；队列进度和内部事件属于日志、metrics 与 trace。」

**必要的底层演进与实施顺序节：**

- 「Runtime 实现前先完成以下 `@nomicore/doc-runtime` 契约演进：1. `readLogicalValueAtPath(derived, doc, path)` 改为 schema-independent 的 `readLogicalValueAtPath(doc, path)`；2. transaction helper 提供 committed-aware branded fatal contract；3. SCHEMA replacement 可复用 detached builder 与原子 ROOT-content replacement helper，不复制 materialization 逻辑。」
- 「随后实现 `@nomicore/namespace-runtime` 的 P0、single sequencer、ROOT/SCHEMA 两类写、fatal/status/close，并以确定性状态机测试和真实 compiler/doc-runtime/Persistence 集成测试共同验收。Registry 另行设计。」

### ADR-0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted；Runtime/open/read 条款被 ADR-0008 部分取代）

本任务 ROOT write 的唯一写管线来源；`applyValidatedMutation` 为 doc-runtime 公共入口（本任务恢复其包导出即兑付本 ADR 公共面条款）。

核心条款（原文摘录）：

- 「`applyValidatedMutation(derived, doc, mutation)`：同步完成当前 ROOT 结构/逻辑检查、在普通 JSON 副本中模拟 mutation、完整 ROOT 逻辑校验、detached 子树构造和单次 Yjs transaction；不公开可跨时间执行的 prepared mutation，避免 TOCTOU。」
- 「首版 mutation 仅支持 `set`、`delete`、`array-insert`、`array-delete`」（注：当前仓库以 set-only 落地，为该上限集合的子集，见冲突报告「非冲突注记」N3）
- 「`set([])` 允许整体替换 ROOT；旧 Yjs 子类型引用失效，不做 identity-preserving diff。」「set 不自动创建中间容器；最终目标可为已有字段、缺失 optional 字段或新 Record 键。」「delete 禁止 ROOT、required 字段和数组下标；只允许 optional 字段与 Record 动态键。」「当前 ROOT 已损坏时普通 mutation 失败，不承担 recovery。」「成功只返回 `{ ok:true }`，不返回 snapshot、Yjs update 或内部类型。」
- 「NamespaceRuntime 将来按 namespace 串行化所有业务写入：轮到 mutation 时先检查 writable gate，同步调用 `applyValidatedMutation`，成功后立即调用 persistence `saveDoc` 标脏。业务调用方不得取得可写 Yjs 引用或绕过该入口；未来原始 Yjs update 必须另设受控验证通道。」
- 「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型；NamespaceRuntime/Registry 再映射成稳定的 create/open/mutation 上层错误。逻辑校验保留完整 issues，Yjs 结构与路径/操作错误 fail-fast。」
- 失败边界：「零写入承诺覆盖所有验证失败和 detached 构造失败。Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报。事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback。」
- 取代范围（本文尾部条款）：「ADR 0008 取代本文 schema-aware `readLogicalValueAtPath(derived, doc, path)` 以及"普通 open 完成 schema 编译、META 检查、ROOT 提取和 logical validation 后才注册 Runtime"的 Runtime/open/read 条款。本文关于 logical validation、detached materialization、validated mutation、零写入与 observer no-rollback 的底层决策继续有效。」

### ADR-0006 Cordis 持久化插件——DocPersistence 接口与 doc 三条目内容布局（accepted；含 #64 createDoc/owner 修订、#79 entry status 修订）

本任务 dirty notifier（saveDoc 绑定）与写前 writable gate（getStatus）的持久层契约来源。

核心条款（原文摘录，#79 修订节为主）：

- 「saveDoc 是 **mutation 后的 dirty notification**：只要租约有效（未 released、非 foreign、身份匹配、Persistence 未 disposed），saveDoc 必须递增 dirtyGeneration 并 resolve——entry 处于 `persistence-degraded` **不构成拒绝理由**；已提交进 live Y.Doc 的事务由持久层内部 retry 以完整 Y.Doc 状态最终持久化」
- 「『失败后 namespace 进入 `persistence-degraded`……拒绝**后续** REST/WS 写入』的拒绝面归属**业务编排层**：Runtime（ADR 0007 NamespaceRuntime 写前 gate）在业务 mutation 前读取 `handle.getStatus()`，已 degraded 则拒绝开始新写入（零写入：文档不变、响亮拒绝）。」
- 「gate 检查通过后才转为 degraded 的 mutation 不属『后续』写入：其内存事务保留、saveDoc 正常登记、由 retry 覆盖最新完整 live Y.Doc」
- getStatus 契约：「状态查询是 **entry 级**的：恒答该 handle 自己的 `(owner.userId, docId)` entry 状态，不得以 Adapter 聚合状态代替」「`getStatus()` 只表示**调用瞬间**状态，不承诺后续 flush 成功——写前状态检查不是持久化成功保证」
- DocHandle 接口（#79 修订后形状）：`owner` / `docId` / `doc` / `getStatus(): 'ready' | 'persistence-degraded' | 'released' | 'disposed'` / `release(): Promise<void>`
- 状态优先级：「`disposed`（签发方已 dispose）> `released`（本租约已释放）> entry 状态（`persistence-degraded`：该 entry 最近一次 flush 失败且尚未 retry 成功；`ready`：其余情形，含 flush 在途）」

### ADR-0003 求值器与派生 schema（accepted）

关联点：ROOT 约定决定 mutateRoot 的作用对象与 Yjs 挂载点。

核心条款（原文摘录）：

- 「每个模块必须恰好声明一个名为 `ROOT` 的别名（大小写是契约，`root` / `Root` 不算），且必须 **map 形**……ROOT 固定物化为 Y.Map……Yjs 映射为 `doc.getMap('ROOT')`。」
- 派生 schema 纪律：「派生 schema 延续 IR 全部纪律：纯数据、可 JSON 序列化、可内容哈希、不携带行列位置。」

### ADR-0001 VFSL 单一真相源（accepted，含 2026-08-19 修订与 2026-08-21 SCHEMA 键名修订）

关联点：低——本任务不触碰 schema 文本与信封写入（SCHEMA write 属后续任务）；仅背景约束。

- 「本仓库是纯引擎仓库：代码库不含 schema 文本（测试 fixture 除外）。」
- 命名修订：「信封在 doc 中的键名由 `__schema__` 改为 **`SCHEMA`**——与 `ROOT` 保持统一命名（doc 顶层两个具名条目：`SCHEMA` 信封 + `ROOT` 数据）。」

### ADR-0002 nomicore 是全新重写，authority 完全出范围（accepted）

关联点：低——写管线不得引入 authority 类不变式。

- 「旧系统既有的 authority 规则体系（`__authority__` manifest：enum / range / conditional / state-machine）**完全排除在范围外，不保留接口**——统一写入管线收敛为"结构 → 值 → 单事务提交"三步。」

### ADR-0004 vfsl-protocol 类型协议包（accepted）／ ADR-0005 投影生成管线（accepted）

关联点：无直接交集——二者为编译期类型投影/生成管线（Phase 1 轨道）；本任务是运行时写路径（Phase 2 轨道）。列入仅为全集盘点完整性；无适用于本任务的约束条款。

## CONTEXT.md 相关术语与惯例

- **写序列器（write sequencer）**：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。」_Avoid_: mutation queue（范围过窄，容易让 SCHEMA/META 管理写建立旁路）
- **P0（schema preparation）**：「Runtime 发布前已进入写序列器队首的 schema 准备任务；只投影并编译 SCHEMA、构造 active schema tools，不读取或验证 ROOT。Runtime 发布后读取立即可用，早期写排在 P0 后。」
- **active schema**：「NamespaceRuntime 当前安装、供 ROOT write 使用的已编译 schema tools 及身份；SCHEMA write 的 transaction 成功后同步切换，不等同于对 live SCHEMA 的即时读取。」
- **信封（envelope）**：「顶层具名 `SCHEMA` Y.Map 中 `lang/version/id/text` 四个字符串键投影出的严格普通对象；兼容读取忽略额外键，规范写入以一次 transaction 清空并重写四键。信封可哈希、可 diff。」
- **载体投影读取（readLogicalValueAtPath）**：「从 live Y.Doc 的固定 ROOT 按实际 Yjs/plain 载体和路径同步投影普通逻辑值；不依赖 VFSL/派生 schema，也不重复执行结构或逻辑校验。」_Avoid_: validated read、schema-aware read
- **逻辑快照校验（validateLogicalSnapshot）**：「对普通 JSON 逻辑 ROOT 快照运行完整值语义校验；不接收 Y.Doc / Y.Map / Y.Array，也不验证 Yjs 载体。」
- **零写入（zero-write）**：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」
- **重建校验（rebuild validation）**：「单字段 patch 也在最近结构边界合并当前值后按完整子 schema 校验——判别联合只有看到判别字段才知道按哪个变体验。」（ROOT write 模拟校验的语义依据）
- **派生 schema（derived schema）**：「求值器的产出：结构树、值 schema、路径索引的打包；与 IR 同纪律——纯数据、可 JSON 序列化、可内容哈希。」
- **信封指纹（envelope fingerprint）／语义指纹（semantic fingerprint）**：getActiveSchema() 对外暴露的身份投影依据（ADR-0008 读取能力节）。

## 设计后复审追加（R1 设计引入的新决策点）

> SA8 设计后复审（2026-08-24，Phase 2）从 SA1 设计 `task_namespace-runtime-write-sequencer_design.md`（R1）识别出的、属 **ADR 条款实施细化而非新架构决策** 的点。全链 SA（SA3 实现 / SA4 验证 / SA7 审计）按此对照；后续设计修订若改变下列任何一条的**语义方向**（从拒绝变接受、从 fatal 变普通失败、从增补 gate 变删除 gate），需回 SA8 复审。冲突裁决见同目录 `task_namespace-runtime-write-sequencer_design_conflict_report.md`。

1. **notifier 绑定检查 gate（设计 D6.4）**：ADR-0008 槽序（lifecycle/fatal gate → writable gate → 输入快照 → …）未列「notifyDirty 未绑定」检查；设计在 S2 gate 簇增补 loud gate——未绑定（seam 缺省）时一切 `mutateRoot` settle `ok:false` + `RUNTIME_WRITE_DISABLED`（零写入、零输入访问），而非缺省 no-op。正当性锚：ADR-0008「成功只表示 live commit 与 dirty notification 已登记」——未绑定时该成功语义不可能成立，拒绝写是该条款的必要执行器；生产工厂 `createNamespaceRuntime` 以必填参数显式绑定（D6.3，包内不导出延续）。
2. **fatal phase 扩充（设计 D5.1/D5.2）**：ADR-0008 点名 doc-runtime branded fatal 契约（committed/phase）与 post-commit 场景；设计注册 runtime 侧相位 `'unknown-pipeline-throw'`（保守 committed:true）/ `'notify-dirty-failed'`（S6 notifier rejection，committed:true，不重试）/ `'write-slot-internal'`（槽内不变量破坏与 getStatus() adapter 违约，committed:false），doc-runtime 三相位透传联合。
3. **notifier 调用预算恰一次（设计 D5.3）**：每 fatal 槽 notifier 调用总数 ≤ 1——ADR-0008「best-effort notifyDirty()」的定量化：committed:true fatal 路径内恰 1 次（自身失败吞没，原始 fatal 优先传播）；`notify-dirty-failed` 的 1 次已在 S6 消耗；committed:false 与 gate 段 fatal 为 0。ADR「不补偿、不 fallback」排除重试。
4. **snapshotter 拒绝细则（设计 D3）**：ADR-0008「只接受 primitive、finite number、null、plain object/array；拒绝 accessor、class instance、特殊对象、symbol key、循环引用及其他非 plain data」的保守展开——额外明确拒绝 undefined 值、bigint、function、稀疏数组空洞、数组元素 undefined、数组非索引 own 键、数组原型非 `Array.prototype`、对象原型非 `Object.prototype`/null、非枚举 own 键。均为「其他非 plain data」兜底授权内的拒绝侧细化，不触碰 ADR 正面接受清单（string/boolean/finite number/null/plain object/plain array 全部照收）；输入缺陷一律 `ok:false` 领域失败（类 B），不升格 internal fatal（防敌意输入 DoS 永久关写）。
5. **保守过报方向（设计 D5.2/§6.2 #17）**：`applyValidatedMutation` 逃逸的未知异常按 committed:true 处理并 best-effort 登记——ADR-0008「未知异常保守视为可能已提交」的强制方向；多登记一次 saveDoc 无害（ADR-0006 #79 dirtyGeneration 语义：登记的是当前最新 live doc）。
6. **preparing 不可达 loud fatal（设计 D4）**：结构性保证（P0 是队首真实节点 → 任何写槽必在 P0 settle 后启动，#89 INV-N1 延续）下，S4 观测到 preparing∧无 fatal 视为包缺陷 → loud internal fatal（`write-slot-internal`，committed:false），不静默降级不伪 ok——ADR-0008「internal exception 永久关闭全部写」框架内的防御性应用。
7. **`RuntimeWriteFatalError` rejection 值形状（设计 D5.1）**：ADR-0008「始终 reject 原始 fatal」与「post-commit fatal 以带 committed:true 的稳定 RuntimeWriteFatalError reject」两句的并读定约——rejection 值恒为稳定 branded 类（instanceof 判别 committed/phase），原始 fatal 经 ES2022 `cause` 零信息损失保留；两句以此同时成立。

## 附注：非 ADR/CONTEXT 基准的仓库纪律（简报引用，仅记录）

以下纪律出现在任务简报但**不源于 ADR 全集或 CONTEXT.md**，按门禁规则不构成冲突基准，全链 SA 自行遵守即可：

- pnpm workspace 七包；`pnpm test`（vitest run --typecheck）与 CI 同命令；`pnpm typecheck` 七包 tsc；Node 20/24 CI；改动包 bump patch 版本（简报称「硬门禁 9」）；namespace-runtime tsconfig include 仅 src/**（#89 设计 §7.1 决议）。

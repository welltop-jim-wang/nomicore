# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 任务：namespace-runtime Registry 专用受限生产构造 seam（issue #109，Phase 4 实施切片第 4 片）
> 基准快照：`docs/adr/` 全集 9 篇（2026-08-25 全部读取，无抽样）+ 根 `CONTEXT.md`

## 相关 ADR

### ADR 0009 NamespaceRegistry、调用方租约与 Cordis Host 生命周期（accepted，2026-08-25）

- 与本任务的关联点：**本任务的直接设计依据**。internal subpath、factory 名、主 entry 封闭、模块边界测试四项要求全部由本 ADR 冻结；本 ticket 即其实施顺序中的「Runtime internal Registry factory」切片。
- 核心条款（原文摘录，§模块与 Cordis service）：
  - 「Registry 通过 `@nomicore/namespace-runtime/internal` 唯一导出的 `createNamespaceRuntimeForRegistry` 构造生产 Runtime；主 entry 不公开生产 Runtime 构造器。模块边界测试限制该 internal subpath 只能由 Registry 生产代码消费。」
  - 「`NamespaceRuntime` 继续是普通模块，不成为 per-namespace plugin。」
  - 「建立 `@nomicore/namespace-registry`。同一 package 包含 Host 无关的 Registry 核心、通用 Cordis plugin Adapter 和受控 testing subpath，并通过 `ctx.nomicoreRegistry` 向 DSH 与未来 NomicoreServer 提供同一个 `NamespaceRegistry`。」
- 存在理由（原文摘录，§背景）：
  - 「若 REST、WS 或管理任务分别从 Persistence 加载 handle 并构造 Runtime，同一个 live Y.Doc 会出现多个 sequencer，破坏“同一 namespace 的所有受控写严格 FIFO”这一安全不变量。」
- 实施切片定位（原文摘录，§取代与关联）：
  - 「实施顺序为Clock capability、Persistence service/timer/clock与typed error演进、Runtime internal Registry factory、Registry核心/lease/idle生命周期、Cordis plugin、Memory/File/Cordis全链验收与最终整体审查。」
  - 「本ADR不取代ADR 0008的单Runtime语义，而是在其上增加多调用方、多namespace和Host生命周期。Registry open遵循ADR 0008对ADR 0007普通open条款的取代：load+Runtime构造后即可发布，不等待P0或重新验证ROOT。」
- 边界参照（原文摘录，§公共 Interface——针对**未来的 Registry 包**，非本 ticket 交付物）：
  - 「v1不公开list、entry status、lease count、queue、timer handle、explicit eviction、按key close或公共events。测试 seam只位于受控 testing subpath，允许替换Runtime/document factory、Clock、timeout和observer，但不允许读取内部entry结构。」

### ADR 0008 NamespaceRuntime 读写能力与单序列器（accepted，2026-08-23；含 2026-08-24 稳定码注册修订）

- 与本任务的关联点：**语义不变量的来源**。AC4 要求 factory 产出的 Runtime 逐条保持本 ADR 全部行为；AC2/AC3 的封装与最小输入面直接对应本 ADR 所有权条款。
- 核心条款（原文摘录）：
  - §生命周期、状态与所有权：「Runtime 成功构造后独占一个 `DocHandle`；构造失败时所有权仍归调用方。Runtime 不公开 handle、Y.Doc、ROOT/SCHEMA/META live 引用或生产构造器。生产工厂保留包内，由未来 Registry 使用；测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault。」
  - §读取能力（P0 队首）：「Runtime 获得并信任有效 `DocHandle` 后，在对外发布前把 P0 放入 write sequencer 队首，同时立即开放同步读取；读取不等待 P0 或任何写任务，也不进入 sequencer。普通 open 不执行 schema、ROOT 载体或 logical validation，持久化文件被其他程序错误修改不在本契约范围内。」
  - §单一 write sequencer：「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer；不同 namespace 可并行。」
  - §单一 write sequencer（写槽序列与 notifyDirty 接缝）：「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务。`notifyDirty` 是由构造方绑定 `persistence.saveDoc(handle)` 的窄接缝；Runtime 不依赖整个 `DocPersistence`。」
  - §单一 write sequencer（degraded gate 语义）：「`persistence-degraded` 阻止 ROOT、SCHEMA 以及未来所有 Y.Doc 写；它不阻止 read 或不写 Y.Doc 的 P0。gate 是瞬时观察：检查后才发生的降级不撤销已提交事务，dirty notification 仍必须登记最新 live doc。」
  - §P0 与 active schema：「Runtime 发布前，P0 已作为 write sequencer 的真实队首节点入队；发布后 read 立即可用，早期写排在 P0 后。P0 只读取 SCHEMA 标准四键、调用 `compileSchemaEnvelope` 并构造 schema-dependent tools，不读取、提取或验证 ROOT，也不捕获跨时间 prepared mutation。」
  - §Fatal 与失败通道：「`@nomicore/doc-runtime` 必须提供 branded `DocRuntimeFatalError`，至少包含 `committed` 与稳定 `phase`。任何 internal fatal——无论 committed 与否——都永久关闭该 Runtime 的全部写能力并保留读取」
  - §生命周期、状态与所有权（close 语义）：「`close()` 幂等。首次调用同步进入 `closing`，立即停止接纳公共 read 和 write，并在队尾加入 close barrier；此前已接纳任务无条件排空，不取消、不设内部 timeout。barrier 只调用一次 `handle.release()`；无论 release 成败，Runtime 都进入 `closed`，失败时 close Promise reject，后续 close 返回同一个已结算 Promise。」
  - §生命周期、状态与所有权（status 面）：「Runtime 提供结构化瞬时 capability status，而不是单一扁平枚举：lifecycle、read、ROOT write、SCHEMA write，以及稳定且不含原始 Error/stack/SCHEMA 全文/ROOT 数据的 schema、fatal、close issue 摘要。status 不暴露队列长度、任务类型或 sequence。」
- 稳定码注册修订（2026-08-24，issue #93；AC4「保持现有语义」覆盖的公共面字面量）：
  - 「**read 停接纳稳定码 `RUNTIME_READ_DISABLED`**：`close()` 进入 `closing`/`closed` 后，公共 read 的 lifecycle 失败……经同步结果联合返回该稳定码分支——lifecycle 失败不是路径缺陷，不借用路径失败码。」
  - 「**`RUNTIME_WRITE_DISABLED` 码域澄清**：该码是写停接纳/写禁用的统一码族，覆盖四类零写入、零输入访问的拒绝——fatal 已置位后的排队写……写前 writable gate 拒绝（handle 状态非 ready：persistence-degraded / released / disposed 三态同拒……）、notifyDirty 未绑定的构造方义务 loud gate、close 后 lifecycle≠ready 的接纳拒绝……区分域靠 issue message 文案，不另设新码。」
  - 「**close 拒绝稳定码 `NSRT-CLOSE-RELEASE-FAILED`**：release 失败时 close Promise 的 rejection 携带该稳定码（包内 branded rejection 类，`cause` 保留原始异常；status 的 close issue 摘要同码）」
  - 「**注册表归属**：其余公共面可观测稳定码不逐码入本文，以包内**各稳定码定义处**的 append-only 注册表为准」
- 取代关系（原文摘录）：「本 ADR 取代 ADR 0007 中“普通 open 必须完成 schema 编译、META 检查、ROOT 提取和 logical validation 后才注册 Runtime”以及 schema-aware `readLogicalValueAtPath(derived, doc, path)` 的 Runtime/open/read部分。ADR 0007 关于 logical validation、detached materialization、validated mutation、零写入和 observer no-rollback 的底层决策继续有效。」

### ADR 0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted；状态行自注：「Runtime/open/read 条款由 ADR 0008 部分取代」）

- 与本任务的关联点：仍有效的「Runtime 编排边界」条款是 AC3/AC5 防绕行目标的语义根基——正是本 seam 要保护的不变量。
- 核心条款（原文摘录，§Runtime 编排边界——未被取代部分）：
  - 「NamespaceRuntime 将来按 namespace 串行化所有业务写入：轮到 mutation 时先检查 writable gate，同步调用 `applyValidatedMutation`，成功后立即调用 persistence `saveDoc` 标脏。业务调用方不得取得可写 Yjs 引用或绕过该入口；未来原始 Yjs update 必须另设受控验证通道。」
- 注：其 schema-aware `readLogicalValueAtPath(derived, doc, path)` 与 open 时全量校验条款已由 ADR 0008 取代，不构成约束。

### ADR 0006 Cordis 持久化插件（accepted；含 2026-08-21 createDoc/owner 修订与 2026-08-22 getStatus 修订）

- 与本任务的关联点：factory 的第一个输入就是 `DocHandle`；AC4 保持的 writable-gate/status 语义消费本 ADR 的 `getStatus()` 契约；notifyDirty 的绑定目标 `persistence.saveDoc(handle)` 语义在此冻结。
- 核心条款（原文摘录）：
  - DocHandle 现行形状（2026-08-22 修订节接口代码块）：

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
  - handle 租约纪律：「每个 handle 对应一个不可伪造的 lease；release 幂等且仅释放本次使用权。跨 Adapter/HMR reload 的 foreign handle、已释放 handle 的 saveDoc 都响亮拒绝」
  - saveDoc 语义（2026-08-22 修订节）：「saveDoc 是 **mutation 后的 dirty notification**：只要租约有效（未 released、非 foreign、身份匹配、Persistence 未 disposed），saveDoc 必须递增 dirtyGeneration 并 resolve」
  - degraded 拒绝面归属（2026-08-22 修订节）：「『失败后 namespace 进入 `persistence-degraded`……拒绝**后续** REST/WS 写入』的拒绝面归属**业务编排层**：Runtime（ADR 0007 NamespaceRuntime 写前 gate）在业务 mutation 前读取 `handle.getStatus()`，已 degraded 则拒绝开始新写入（零写入：文档不变、响亮拒绝）。」

## CONTEXT.md 相关术语与惯例

- **写序列器（write sequencer）**：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。」 _Avoid_: mutation queue（范围过窄，容易让 SCHEMA/META 管理写建立旁路）
- **P0（schema preparation）**：「Runtime 发布前已进入写序列器队首的 schema 准备任务；只投影并编译 SCHEMA、构造 active schema tools，不读取或验证 ROOT。Runtime 发布后读取立即可用，早期写排在 P0 后。」
- **active schema**：「NamespaceRuntime 当前安装、供 ROOT write 使用的已编译 schema tools 及身份；SCHEMA write 的 transaction 成功后同步切换，不等同于对 live SCHEMA 的即时读取。」
- **停接纳（stop-acceptance）**：「close 首次调用同步进入 `closing` 后，capability 槽立即停止接纳新调用：read 同步结果联合返回 `RUNTIME_READ_DISABLED` 分支……三个数据投影 getter（getSchemaEnvelope / getMetadata / getActiveSchema）与 read 同属停接纳范围——同步 loud throw 稳定码 `RUNTIME_READ_DISABLED`……mutateRoot/replaceSchema 经 Promise settle 含 `RUNTIME_WRITE_DISABLED` 的零写入结果……getStatus 全生命周期可用（生命周期观测面，非数据投影），不在停接纳范围。」 _Avoid_: 把 lifecycle 失败伪装成路径失败码、把停接纳误解为取消已接纳任务
- **命名空间（namespace）**：「一个 Y.Doc 连同自带的 `SCHEMA` 信封与数据；schema 随数据走，不依赖代码模块。」 _Avoid_: schema 注册表（`SCHEMA_REGISTRY` 是被替换的旧机制）
- **载体投影读取（readLogicalValueAtPath）**：「从 live Y.Doc 的固定 ROOT 按实际 Yjs/plain 载体和路径同步投影普通逻辑值；不依赖 VFSL/派生 schema，也不重复执行结构或逻辑校验。」 _Avoid_: validated read、schema-aware read
- **空闲 Runtime（idle Runtime）**（下游 Registry 切片的语义背景）：「当前没有调用方租约、但仍由 NamespaceRegistry 暂时保留的 namespace Runtime；保留期内重新打开会复用同一 Runtime，保留期届满才关闭。fatal 或 persistence-degraded 只改变能力，不改变空闲保留语义。」

## 不相关 ADR 一览（已全读，无条款触及本任务）

| ADR | 主题 | 不相关原因 |
|---|---|---|
| 0001 | VFSL 唯一真相源 | 本任务不触及 schema 文本/方言/信封；仅新增 TS seam 与测试，不引入仓内 schema 文本 |
| 0002 | 重写定位、authority 出范围 | 本任务不涉及旧系统兼容或 authority 规则 |
| 0003 | 求值器/ROOT 约定/联合表示 | 本任务不触及解析、求值、结构树 |
| 0004 | vfsl-protocol 类型投影 | 本任务不触及类型投影协议包 |
| 0005 | 投影生成管线 | 本任务不触及 SchemaSource/codegen/domains |

---

## 设计后复审追加（SA8，R0）——设计引入的新决策点

> 来源：`wiki/raw/task_namespace-runtime-registry-seam_design.md`（SA1 R0 初版，2026-08-25）。
> 以下为设计在 ADR 约束之内自行冻结的实现级决策点，供 SA2/SA3/SA4 全链复用；
> 每条标注 ADR 锚点（依据或上界）。裁决见 `…_design_conflict_report.md`（verdict: clear）。

| # | 设计决策点 | 设计出处 | ADR 锚点（依据或上界） |
|---|---|---|---|
| N1 | internal entry 文件 = 新建 `src/internal.ts` leaf 模块；不 import `index.ts`、不被 `index.ts` import，无环；主 entry 依赖图字节不变 | §D-A | ADR 0009「主 entry 不公开生产 Runtime 构造器」的上界内实现 |
| N2 | internal 导出面 = 恰一个值导出 `createNamespaceRuntimeForRegistry`，**零类型导出**（ADR 0009「唯一导出」按最强解读执行：名字集合恰为 1）；返回类型 `NamespaceRuntime` 复用主 entry 同名 interface | §D-A | ADR 0009「唯一导出的 `createNamespaceRuntimeForRegistry`」 |
| N3 | factory 签名 = 两参形 `(handle: DocHandle, notifyDirty: () => Promise<void>)`；`notifyDirty` 必填、无缺省、工厂不代绑（未来 Registry 绑定 `() => persistence.saveDoc(handle)`） | §D-B | ADR 0008「`notifyDirty` 是由构造方绑定 `persistence.saveDoc(handle)` 的窄接缝；Runtime 不依赖整个 `DocPersistence`」 |
| N4 | internal.ts 纯委托既有 `createNamespaceRuntime(handle, notifyDirty)`，构造序单一实现（V1 形状守卫 / V2 状态门 / V3 所有权转移 + P0 队首入队不在 internal.ts 重写）；委托链第三跳对象上 `p0Gate`/`compile` 缺席 → P0 恒走真实 `compileSchemaEnvelope` | §D-C | ADR 0008 构造序、P0 条款、「生产工厂保留包内」 |
| N5 | `package.json` exports 键集恰 `['.', './internal']`（无任何测试子路径）；version 0.1.5 → 0.1.6；`private: true` 不变；零新增依赖 | §D-D | ADR 0009 subpath 决策；ADR 0008「测试通过包内确定性 seam 注入」 |
| N6 | 存量 exports-audit 第 4 it（T1.4）键集断言 `['.']` → `['.', './internal']`，为唯一被授权的既有测试改动；「testing seam 绝不进 package entry」不变量保持（该立法源于 issue #93，非 ADR 基准） | §D-E | ADR 0009 subpath 决策（演进依据） |
| N7 | AC5 边界实现侧三硬规则：① 生产源码零消费 internal subpath（白名单唯一前缀 `packages/namespace-registry/src/`，前瞻空集）；② internal.ts 只走相对导入 `./runtime.js`，禁止本包自引用 specifier；③ 测试目录豁免属审计设计，不得移动测试文件绕审计 | §D-F | ADR 0009「模块边界测试限制该 internal subpath 只能由 Registry 生产代码消费」 |
| N8 | 主 entry `src/index.ts`、`src/runtime.ts`、Runtime 语义层文件（errors/p0/projection/sequencer/status/close/write/schema-write/plain-data）零改动（DENY list）；`docs/adr/**` 与 `CONTEXT.md` 亦零改动 | §6 | AC3/AC4 = ADR 0008 公共面与语义不变量、ADR 0009 主 entry 封闭 |

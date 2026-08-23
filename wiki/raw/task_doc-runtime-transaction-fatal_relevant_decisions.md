# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 被审对象：`wiki/raw/task_doc-runtime-transaction-fatal.md`（issue #87：doc-runtime committed-aware transaction fatal 契约；功能开发——冻结新异常契约 + 回归测试）
> 冲突基准：`docs/adr/0001`–`0008` 全集（8 份，逐个全读，无抽样）+ `CONTEXT.md`。
> 基线说明：本 worktree 基于分支 `docs/namespace-runtime`（PR #85 head，commit 74b9cfd「docs: define namespace runtime orchestration」），该基线**新增 ADR-0008**——此前各任务门禁的基准为 0001–0007 共 7 份，本次起为 8 份；ADR-0008 是本任务的直接授权来源（见下）。worktree 无对 `docs/adr/` 与 `CONTEXT.md` 的本地改动（git status 仅未跟踪本任务两文件与 `.mabf/`）。
> ADR 状态一览：0001–0008 全部 accepted；无整份 superseded 条目。0001（2026-08-19 目标态/阶段态、2026-08-21 `SCHEMA` 命名）与 0006（2026-08-21 createDoc/owner、2026-08-22 entry status）内含 owner 裁决放行的带日期修订节，以修订后文本为准；0007 状态注明「Runtime/open/read 条款由 ADR 0008 部分取代」——被取代面（schema-aware `readLogicalValueAtPath` 与 open 编排）与本任务无交集，其 materialization / validated mutation / 零写入 / observer no-rollback 条款继续有效（0007 文内「ADR 0008 取代范围」节自述）。

## 相关 ADR

### ADR 0008 NamespaceRuntime 读写能力与单序列器（accepted）——本任务的直接授权来源

- 与本任务的关联点：本任务就是 ADR-0008「必要的底层演进与实施顺序」第 2 条的兑付——「transaction helper 提供 committed-aware branded fatal contract」；fatal 与失败通道一节逐句冻结了本任务的验收语义（branded 形状、committed 语义、保守处置、不补偿/不 fallback/不声称 rollback）。
- 核心条款（原文摘录）：
  - fatal 契约（AC1/AC4/AC5 的直接上游；lead 句 + 其后五条 bullet 逐条摘录）：「`@nomicore/doc-runtime` 必须提供 branded `DocRuntimeFatalError`，至少包含 `committed` 与稳定 `phase`。任何 internal fatal——无论 committed 与否——都永久关闭该 Runtime 的全部写能力并保留读取：」其后五条原文：
    - 「`committed:false` 不调用 dirty notifier；」
    - 「`committed:true` 或未知异常保守视为可能已提交，在当前槽内 best-effort `notifyDirty()`，但始终 reject 原始 fatal；」
    - 「不补偿、不 fallback、不声称 rollback；」
    - 「post-commit fatal 以带 `committed:true` 的稳定 `RuntimeWriteFatalError` reject，上层不得自动重试非幂等写；」
    - 「已排队的后续写仍按 FIFO 取得槽，且不访问输入、零写入返回 `RUNTIME_WRITE_DISABLED`。」
  - 授权条目（「必要的底层演进与实施顺序」，本任务 = 第 2 条）三条原文：
    - 「1. `readLogicalValueAtPath(derived, doc, path)` 改为 schema-independent 的 `readLogicalValueAtPath(doc, path)`；」
    - 「2. transaction helper 提供 committed-aware branded fatal contract；」
    - 「3. SCHEMA replacement 可复用 detached builder 与原子 ROOT-content replacement helper，不复制 materialization 逻辑。」
  - 双通道边界（AC3 的直接上游）：「普通、可预期且零写入的读取或写入失败使用领域化结果联合；ROOT mutation 与 SCHEMA replacement 使用各自独立的窄 issue 类型，不形成巨型 write issue。」
  - 写槽顺序（fatal gate 的位置与 notifyDirty 时序）：「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务。`notifyDirty` 是由构造方绑定 `persistence.saveDoc(handle)` 的窄接缝；Runtime 不依赖整个 `DocPersistence`。成功只表示 live commit 与 dirty notification 已登记，不表示已经落盘。」
  - internal exception 的另一处置面（phase 区分的先例）：「P0 抛出结果联合之外的 internal exception 则永久关闭该 Runtime 的所有写。ROOT write 在自己的槽开始时使用当时 active schema；它不绑定调用时 schema generation。」
  - ROOT write 管线（fatal 契约的两个消费现场之一）：「ROOT write 依赖 active schema tools。没有可用 schema 时零写入失败；否则每笔写按 ADR 0007 的 validated mutation 管线检查当前 ROOT、模拟并校验完整 proposed ROOT、detached 构造并单事务提交。」
  - SCHEMA write 零写入边界（消费现场之二）：「新 SCHEMA 的编译、最终 ROOT 校验或 detached 构造失败均发生在 transaction 前，SCHEMA/ROOT 零写入，active tools 不变。」
  - 取代关系（界定 0007 哪些条款仍约束本任务）：「本 ADR 取代 ADR 0007 中“普通 open 必须完成 schema 编译、META 检查、ROOT 提取和 logical validation 后才注册 Runtime”以及 schema-aware `readLogicalValueAtPath(derived, doc, path)` 的 Runtime/open/read部分。ADR 0007 关于 logical validation、detached materialization、validated mutation、零写入和 observer no-rollback 的底层决策继续有效。」

### ADR 0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted；Runtime/open/read 条款由 ADR 0008 部分取代）——写入口与失败边界的冻结层

- 与本任务的关联点：本任务契约的两个被测公共入口（`materializeRoot` 已实现 / `applyValidatedMutation` 规划中）均由本 ADR 冻结；「失败边界」节是 committed-aware fatal 的原始出处（observer 抛错 = internal/fatal、不虚假声称回滚、不尝试 fallback）；「领域结果联合」纪律是 AC3 的直接上游。
- 核心条款（原文摘录）：
  - materializeRoot 条款（AC6 被测入口之一）：「`materializeRoot(derived, snapshot, doc)`：唯一公共物化入口；内部先执行 `validateLogicalSnapshot`，再构造未集成到任何 doc 的 detached Yjs 子树，确认目标 ROOT 为空后以一次 `Y.transact` 安装。验证或构造失败时目标 doc 零写入；不覆盖、不合并、不 fallback。」
  - applyValidatedMutation 条款（AC6 被测入口之二；**仓内尚未实现**，见「现行通道形态」节）：「`applyValidatedMutation(derived, doc, mutation)`：同步完成当前 ROOT 结构/逻辑检查、在普通 JSON 副本中模拟 mutation、完整 ROOT 逻辑校验、detached 子树构造和单次 Yjs transaction；不公开可跨时间执行的 prepared mutation，避免 TOCTOU。」
  - 失败边界全文（本任务的总上游——committed-aware 契约即本节的精确化）：「零写入承诺覆盖所有验证失败和 detached 构造失败。Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报。事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback。」
  - 领域结果联合纪律（AC3 直接上游）：「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型；NamespaceRuntime/Registry 再映射成稳定的 create/open/mutation 上层错误。逻辑校验保留完整 issues，Yjs 结构与路径/操作错误 fail-fast。」
  - Runtime 编排边界（fatal 契约的消费层与 observer 纪律归属层）：「NamespaceRuntime 将来按 namespace 串行化所有业务写入：轮到 mutation 时先检查 writable gate，同步调用 `applyValidatedMutation`，成功后立即调用 persistence `saveDoc` 标脏。业务调用方不得取得可写 Yjs 引用或绕过该入口；未来原始 Yjs update 必须另设受控验证通道。」
  - mutation 语义边界（AC6 测试锚的相关面）：「当前 ROOT 已损坏时普通 mutation 失败，不承担 recovery。」「成功只返回 `{ ok:true }`，不返回 snapshot、Yjs update 或内部类型。」
  - 依赖面（分层红线 W4 上游）：「`@nomicore/vfsl` 继续保持无 Yjs 依赖；持久层继续不理解 VFSL。新包 `@nomicore/doc-runtime` 依赖 `@nomicore/vfsl + yjs`，提供：」
  - 取代范围自述：「ADR 0008 取代本文 schema-aware `readLogicalValueAtPath(derived, doc, path)` 以及“普通 open 完成 schema 编译、META 检查、ROOT 提取和 logical validation 后才注册 Runtime”的 Runtime/open/read 条款。本文关于 logical validation、detached materialization、validated mutation、零写入与 observer no-rollback 的底层决策继续有效。」

### ADR 0006 Cordis 持久化插件与 doc 三条目内容布局（accepted，含 2026-08-21 createDoc/owner、2026-08-22 entry status 修订节）

- 与本任务的关联点：committed fatal 的「不补偿、不 fallback、不声称 rollback」与持久层对已提交事务的「不通用回滚」处置是同向纪律的两层（内存事务层 vs 落盘层）；`persistence-degraded` 与写前 gate 归属界定防止本任务把持久化失败误并入 transaction fatal 通道；「单 update 单元」是 transaction helper 的原子性前提。
- 核心条款（原文摘录）：
  - 「事务原子性由 Y.transact（单 update 单元）保证，store 无需多写事务。」
  - 「**save 失败按 doc 只读降级，保留内存事务**：已校验并提交的事务立即进入 live Y.Doc 并正常同步；持久化是内部异步行为，失败不向触发该事务的客户端追溯报错、不通用回滚。失败后 namespace 进入 `persistence-degraded`，保留读/查询与已同步状态，拒绝**后续** REST/WS 写入；失败事务保留在同一 live Y.Doc 中，由持久层内部 retry 持久化，retry 成功后才恢复可写；不关闭整个 server。」
  - 修订节（#79）saveDoc 职责与 gate 归属：「saveDoc 是 **mutation 后的 dirty notification**：只要租约有效（未 released、非 foreign、身份匹配、Persistence 未 disposed），saveDoc 必须递增 dirtyGeneration 并 resolve——entry 处于 `persistence-degraded` **不构成拒绝理由**」「『失败后 namespace 进入 `persistence-degraded`……拒绝**后续** REST/WS 写入』的拒绝面归属**业务编排层**：Runtime（ADR 0007 NamespaceRuntime 写前 gate）在业务 mutation 前读取 `handle.getStatus()`，已 degraded 则拒绝开始新写入（零写入：文档不变、响亮拒绝）。」

### ADR 0002 nomicore 是全新 yjs-server 重写，authority 完全出范围（accepted）

- 与本任务的关联点：「结构 → 值 → 单事务提交」三步管线是（pre-commit 失败 ⟹ 文档不变）的上游依据；本任务的 phase 区分是管线阶段的事实披露，不得演化为 authority 式数据值不变式体系。
- 核心条款（原文摘录）：
  - 「统一写入管线收敛为"结构 → 值 → 单事务提交"三步。」
  - 「旧系统既有的 authority 规则体系（`__authority__` manifest：enum / range / conditional / state-machine）**完全排除在范围外，不保留接口**」

### ADR 0001 VFSL 文本是 schema 的唯一真相源（accepted，含 2026-08-19、2026-08-21 修订节）——低相关

- 与本任务的关联点：本任务纯运行时异常契约，不触碰 schema 文本/信封/codegen 轨道；唯一共享纪律是 loud-fail 文化基线。
- 核心条款（原文摘录）：
  - 「VFSL 文本只作为运行时数据存在于文档的 `SCHEMA` 中」

### ADR 0003 求值器与派生 schema（accepted）——低相关

- 与本任务的关联点：结果联合（`{ ok: true } | { ok: false; issues }`）可失败接缝的纪律先例——fatal 通道不得反向吞并既有结果联合面；ROOT=Y.Map 固定与联合表示本轮不触碰。
- 核心条款（原文摘录）：
  - 「新增公共导出 `evaluate(module: VfslModule) → { ok: true; derived } | { ok: false; issues }`。」

### ADR 0004 vfsl-protocol 类型协议包（accepted）——无直接关联

- 与本任务的关联点：编译期类型投影轨道，与运行时 transaction fatal 契约无交集；列出仅为 ADR 盘点完整。

### ADR 0005 投影生成管线（accepted）——无直接关联

- 与本任务的关联点：SchemaSource 接缝与生成器 CI 保鲜管线属编译期轨道，与本任务无交集；列出仅为 ADR 盘点完整。

## CONTEXT.md 相关术语与惯例

- `零写入（zero-write）`：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」——committed:false / 写前 fatal 的验收纪律锚（回归测试锚 0 update 与 state 字节不变）。
- `写序列器（write sequencer）`：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。」_Avoid_: mutation queue——fatal 契约的 Runtime 层消费语境。
- `P0（schema preparation）`：「Runtime 发布前已进入写序列器队首的 schema 准备任务；只投影并编译 SCHEMA、构造 active schema tools，不读取或验证 ROOT。Runtime 发布后读取立即可用，早期写排在 P0 后。」
- `active schema`：「NamespaceRuntime 当前安装、供 ROOT write 使用的已编译 schema tools 及身份；SCHEMA write 的 transaction 成功后同步切换，不等同于对 live SCHEMA 的即时读取。」
- `方言（dialect）`：「`lang + version` 决定的 VFSL 语法子集与语义规格；一经发布冻结，引擎只增不改，未知方言 loud-fail 只读。」——仓内 loud-fail 与「一经发布冻结」文化基线（phase 取值集稳定性的精神同源）。
- `逻辑快照校验（validateLogicalSnapshot）`：「对普通 JSON 逻辑 ROOT 快照运行完整值语义校验；不接收 Y.Doc / Y.Map / Y.Array，也不验证 Yjs 载体。创建前校验、写入前校验、迁移后体检、测试与管理端点共用该入口；普通 open/read 不重复校验已持久化 namespace。」——其失败永远在领域结果联合面内，不进 fatal 通道。

## ADR 派生红线（前序门禁锚定、本轮沿用；出处为 ADR 条款，非 wiki 自创）

> 以下 W1/W4 由 materialize-root rev1/rev2 前置门禁从 ADR 原文推出（`task_doc-runtime-materialize-root-rev1/rev2_conflict_report.md`），本轮任务直接落位其管辖面，全链 SA 必须继续遵守；W2'/W3 为本轮新增（编号独立于 rev2 报告）：

- **W1（写后偏离唯一相容形态 = throw/reject）**：事务提交后检测到偏离（现行 DOCRT-E201 家族 / 未来 branded fatal 的 committed:true 面），唯一相容形态是 throw（或 Runtime 层 reject）；「事务提交后返回 ok:false / 结构化失败」「补偿修复写入」「声称已回滚」三种形态分别落入 ADR-0007「零写入承诺」「不覆盖、不合并、不 fallback / 不尝试 fallback」「不虚假声称自动回滚」的违反面。branded fatal 契约不得为 E201 家族开 ok:false 后门。
- **W2'（branded 形状与命名按 ADR-0008 原文）**：公共 fatal 类型名与最小字段面按 ADR-0008 原文——`DocRuntimeFatalError` + `committed` + 稳定 `phase`；phase 取值集一经发布即稳定（ADR-0008「稳定 phase」要求），与 Runtime 层 `RuntimeWriteFatalError`（亦为 ADR-0008 原文命名）保持两层命名互不侵占。
- **W3（零写入锚 + 诚实 committed）**：写前/committed:false fatal 的回归测试必须锚 0 update 与 Y.Doc state 字节不变；committed:true 不得被降格为 false（ADR-0008「未知异常保守视为可能已提交」的诚实面）；未识别异常一律保守归 committed:true。
- **W4（分层红线）**：`@nomicore/doc-runtime` 仅依赖 `@nomicore/vfsl + yjs`（ADR-0007 依赖面），不得 import Runtime/持久层；`notifyDirty` 的 best-effort 调用与「永久关闭写能力」的处置是 Runtime 层槽内职责（ADR-0008），doc-runtime 的 fatal 只携带事实（committed/phase），不执行 Runtime 层动作。
- **W5（领域联合不吞并）**：现行领域结果联合面（E100/E200 家族等 ok:false + issues，及 AC3 列举的 logical/path/materialization/mutation 失败）不得被改道进 fatal 通道（ADR-0007「底层能力各自保留领域化结果联合」+ ADR-0008「普通、可预期且零写入的……使用领域化结果联合」）；「意外异常」属内部错误的归类调整是 ADR 未枚举空间，归 SA1 设计定夺并受 W1/W3 约束。

## 现行通道形态（代码实证导航；wiki 档案与代码不构成冲突基准，仅供落点检索）

- **既有错误码家族**（`packages/doc-runtime/src/materialize.ts` 等）：E100（extract 崩溃边界，结果联合）/ E200（materialize 写前意外异常 → ok:false 单 issue）/ E201（写后偏离家族，throw：变体 A=size / B=identity / C=语义偏离 / D=校验无法完成）/ E202（写前活动 transaction 语境拒绝，throw，三变体消息逐字定稿）——全部为**裸 `Error` + 消息前缀**，尚无 branded 类、无 `committed`/`phase` 字段（grep `DocRuntimeFatalError` 全仓 0 命中）。
- **`applyValidatedMutation` 尚未实现**：生产代码 grep 0 命中；仅存在于 ADR-0007/0008 与 PRD `wiki/prd/0060-doc-runtime-validation-prd.md` §6 的规划面。AC6 对它的测试覆盖方式是本轮范围治理点（见冲突报告观察项 O1）。
- **下游消费层尚不存在**：`@nomicore/namespace-runtime` 包未建（packages/ 下仅 doc-runtime / persistence / dsh-persistence / vfsl / vfsl-codegen / vfsl-protocol）——ADR-0008 的 RuntimeWriteFatalError / 写能力关闭 / notifyDirty 槽行为均属未来消费面，本轮只提供事实契约。

## 设计引入的新决策点（SA8 设计后复审 R1 追加；裁决见 `_design_conflict_report.md`，verdict=clear）

> 摘自 SA1 设计 R1（`task_doc-runtime-transaction-fatal_design.md`，D1–D11）。只登记与 ADR 条款/红线有落位关系的新决策点，供 SA2/SA3/SA4/SA6/SA7 复用；不裁决。

- **FD-1 phase 取值集 v1 冻结表（§3.2，ADR-0008 留白定稿）**：三值 `'observer-cleanup-throw'`（恒 committed:true，④ 事务调用栈逃逸，新码 DOCRT-E203）/ `'post-commit-verification'`（恒 true，⑤⑥，保留 DOCRT-E201 前缀消息逐字不变）/ `'pre-commit-internal'`（恒 false，写前派生物不变量破坏，新码 DOCRT-E204）；committed 恒定值随 phase 一并冻结；取值集**只增不改不删**，新 phase（mutation 侧已复用 `post-commit-verification`、SCHEMA replacement 面等）须显式立项追加。落位：ADR-0008「稳定 `phase`」+ 前置门禁重点裁决二。
- **FD-2 E200 拆分判据 = 信任边界（§4.1，前置门禁授权的归类定夺）**：类 A（引擎链路损坏：手造派生物 → `DerivedInvariantError` sentinel，仅 4 个诊断点全枚举 §4.3）→ E204 committed:false fatal；类 B（调用方数据敌对：Proxy/getter）与类 C（输入比例资源极限：极深树 RangeError，rev2 Minor-2 冻结形态）留守 E200 ok:false（消息逐字不变）。return→throw 形态变更仅类 A，无遗留测试锚。落位：ADR-0007 零写入承诺 + ADR-0008 双通道边界 + W5（收窄非吞并）。
- **FD-3 E202 不 fatal 化（§5，O2 落实）**：保持裸 Error throw、三变体消息逐字不变、materializeRoot 与 applyValidatedMutation 同规；Runtime 侧 fatal gate 判据登记为 `instanceof DocRuntimeFatalError`（不得按消息前缀判别）——未来 `@nomicore/namespace-runtime` 设计输入。落位：ADR-0008 fatal 家族治理面 = internal fatal（对 E202 沉默）；SA8 门禁 O2。
- **FD-4 ④ 逃逸包装 `transactGuarded`（§3.3，U13 契约演进）**：事务调用栈异常统一包装 branded E203（cause=原始 thrown 值、message 含原文、防御性 instanceof 透传防双重包装）；「原样传播（裸值）」演进为「原样事实携带」——rev1 wiki 契约（INV-5/F10/U13 注释）自身治理面演进，ADR-0007 失败边界强化而非修订；U13 测试文件字节零改动、四断言保持绿（toThrow 子串语义）。
- **FD-5 applyValidatedMutation set-only 最小落地（§7，O1 落实）**：ADR-0007 冻结管线骨架逐句直译（extract+validate → JSON 副本 placeSet → 完整校验 → detached 构造 → transactGuarded 单事务 → ⑤ verifyInstall 复用）+ 仅 set（含 set([]) 整体替换）；delete/array-insert/array-delete → 领域单 issue 响亮拒绝（E205 为 mutation 侧类 B/C 崩溃边界）；mutation 参数形状 `{ op:'set', path, value }` 冻结为 v1 事实（对齐 SA6 锚）。**移交清单五项**（三操作全语义 / union 仲裁与未声明键处置 / mutation 侧 ⑥ / 参数具名类型冻结 / E205-E200 对齐复审）归完整 validated-mutation 独立任务。落位：ADR-0007 applyValidatedMutation 条款逐句兑付 + ADR-0008 窄 issue 类型 + 前置门禁 O1（显式 fencing 非静默扩范围）。
- **FD-6 导出面（§3.5）**：新导出五项（`DocRuntimeFatalError` / `DocRuntimeFatalPhase` / `applyValidatedMutation` / `MutationIssue` / `ApplyValidatedMutationResult`）；不导出 `RuntimeWriteFatalError`（W2'）/ `DerivedInvariantError` / `transactGuarded`（包内接缝）。
- **状态注记（SA8 实证）**：§8 fixture 时序对齐已在当前 worktree 执行（apply 测试用例 2/3 = seed 先于 observer，注释注明「SA1 设计 §8 对齐」）——R-1 已解，AC 门禁按对齐后时序复核；设计 §5.2「ADR-0008 明文豁免」一句实为 SA8 门禁 O2 措辞（ADR-0008 对 E202 沉默），落文时按实际出处引用。

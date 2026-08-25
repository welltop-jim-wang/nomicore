# 相关决议 (Relevant Decisions) — 全链 SA 复用

> **SUPERSEDED（已取代）**：本 round 1 摘录后的 AC6 判读允许 testing seam 公共导出，该结论已废止。当前决议收口见 `task_namespace-runtime-integration-acceptance-rev1_relevant_decisions.md`。
>
> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 被审对象：`wiki/raw/task_namespace-runtime-integration-acceptance.md`（issue #93，NamespaceRuntime 全链集成验收与阶段收口）。
> ADR 全集 0001–0008 已逐一全文读取；CONTEXT.md 术语随附。

## 相关 ADR

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted）——本任务验收对象

- 与本任务的关联点：本任务即「证明 Runtime 全链符合 ADR 0008」，全部 8 条验收标准逐条映射本 ADR 条款。
- 核心条款（原文摘录）：
  - 包边界：「本决策建立独立包 `@nomicore/namespace-runtime`。它组合 `@nomicore/doc-runtime`、`@nomicore/vfsl` 与 Persistence 的窄通知接缝；不承担 Registry、鉴权、REST/WS、Persistence 实现或原始 Yjs 同步协议。」
  - 读取与 P0：「Runtime 获得并信任有效 `DocHandle` 后，在对外发布前把 P0 放入 write sequencer 队首，同时立即开放同步读取；读取不等待 P0 或任何写任务，也不进入 sequencer。普通 open 不执行 schema、ROOT 载体或 logical validation，持久化文件被其他程序错误修改不在本契约范围内。」
  - schema-independent read：「`readLogicalValueAtPath(doc, path)` 去掉 `derived` 参数，从固定 ROOT 按实际载体投影普通逻辑值」；「读取只观察调用瞬间已经提交的 live Y.Doc，不等待已接纳但尚未提交的写。调用方需要 read-your-write 时必须先等待对应写 Promise。」
  - 只读投影三件套：「`getSchemaEnvelope()` 从顶层 `SCHEMA` Y.Map 投影 `lang/version/id/text` 四个 primitive string，忽略额外键，不 coercion 或补默认值」；「`getMetadata()` 深拷贝顶层 `META` Y.Map 的全部键；META 是开放键空间，但值只允许 JSON-compatible plain value，不允许嵌套 Yjs shared type；v1 不提供 META 写」；「`getActiveSchema()` 返回当前已安装 schema tools 的 `lang/version/id` 与 envelope/semantic fingerprints，不暴露 module、derived 或 validator。」
  - 单序列器：「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer；不同 namespace 可并行。v1 公开两个窄方法：`runtime.mutateRoot(mutation)` / `runtime.replaceSchema({ schema: proposedEnvelope, root?: completeLogicalRoot })`」
  - 输入快照纪律：「写方法调用时同步决定接纳顺序。输入引用在排队期间可以变化；任务取得槽后立即用受控 snapshotter 复制并递归冻结 plain data，之后编译、校验、构造和提交只使用该内部快照。snapshotter 只接受 primitive、finite number、null、plain object/array，拒绝 accessor、class instance、特殊对象、symbol key、循环引用及其他非 plain data。」
  - 写槽次序：「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务。`notifyDirty` 是由构造方绑定 `persistence.saveDoc(handle)` 的窄接缝；Runtime 不依赖整个 `DocPersistence`。成功只表示 live commit 与 dirty notification 已登记，不表示已经落盘。」
  - persistence-degraded gate：「`persistence-degraded` 阻止 ROOT、SCHEMA 以及未来所有 Y.Doc 写；它不阻止 read 或不写 Y.Doc 的 P0。gate 是瞬时观察：检查后才发生的降级不撤销已提交事务，dirty notification 仍必须登记最新 live doc。」
  - P0 内容与结算：「Runtime 发布前，P0 已作为 write sequencer 的真实队首节点入队；发布后 read 立即可用，早期写排在 P0 后。P0 只读取 SCHEMA 标准四键、调用 `compileSchemaEnvelope` 并构造 schema-dependent tools，不读取、提取或验证 ROOT，也不捕获跨时间 prepared mutation。」P0 结算后只保留「`preparing` / `ready` 与 active schema tools / `unavailable` 与稳定 schema issue 摘要」；「正常 compile result failure 仅使 ROOT write unavailable；SCHEMA write仍可修复。P0 抛出结果联合之外的 internal exception 则永久关闭该 Runtime 的所有写。ROOT write 在自己的槽开始时使用当时 active schema；它不绑定调用时 schema generation。」
  - ROOT write：「ROOT write 依赖 active schema tools。没有可用 schema 时零写入失败；否则每笔写按 ADR 0007 的 validated mutation 管线检查当前 ROOT、模拟并校验完整 proposed ROOT、detached 构造并单事务提交。」
  - SCHEMA write 五步（编译 proposed → 未提供 root 时严格提取验证当前 ROOT → 提供 root 时验证并 detached 构造完整新内容 → 一个 transaction 内原子替换 SCHEMA 与必要的 ROOT generation → transaction 返回后立即安装新 active tools 再 `await notifyDirty()`）；「SCHEMA 是顶层具名 Y.Map。成功替换时在 transaction 内 `clear()` 后写入恰好 `lang/version/id/text` 四个字符串键。提供完整 ROOT 时保留顶层 `doc.getMap('ROOT')` identity，在同一 transaction 内清空并安装已 detached 构造的内容；其下旧 Yjs 子类型 identity 可失效。不提供 ROOT 时不修改 ROOT，也不破坏其 identity。」；「新 SCHEMA 的编译、最终 ROOT 校验或 detached 构造失败均发生在 transaction 前，SCHEMA/ROOT 零写入，active tools 不变。读取在准备期间继续观察旧 committed generation；transaction 后才观察新 SCHEMA/ROOT，且 active identity同步切换。」
  - 失败通道：「普通、可预期且零写入的读取或写入失败使用领域化结果联合；ROOT mutation 与 SCHEMA replacement 使用各自独立的窄 issue 类型，不形成巨型 write issue。」
  - fatal：「`@nomicore/doc-runtime` 必须提供 branded `DocRuntimeFatalError`，至少包含 `committed` 与稳定 `phase`。任何 internal fatal——无论 committed 与否——都永久关闭该 Runtime 的全部写能力并保留读取：`committed:false` 不调用 dirty notifier；`committed:true` 或未知异常保守视为可能已提交，在当前槽内 best-effort `notifyDirty()`，但始终 reject 原始 fatal；不补偿、不 fallback、不声称 rollback；post-commit fatal 以带 `committed:true` 的稳定 `RuntimeWriteFatalError` reject，上层不得自动重试非幂等写；已排队的后续写仍按 FIFO 取得槽，且不访问输入、零写入返回 `RUNTIME_WRITE_DISABLED`。」
  - 所有权与公共面：「Runtime 成功构造后独占一个 `DocHandle`；构造失败时所有权仍归调用方。Runtime 不公开 handle、Y.Doc、ROOT/SCHEMA/META live 引用或生产构造器。生产工厂保留包内，由未来 Registry 使用；测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault。」
  - close：「`close()` 幂等。首次调用同步进入 `closing`，立即停止接纳公共 read 和 write，并在队尾加入 close barrier；此前已接纳任务无条件排空，不取消、不设内部 timeout。barrier 只调用一次 `handle.release()`；无论 release 成败，Runtime 都进入 `closed`，失败时 close Promise reject，后续 close 返回同一个已结算 Promise。」
  - capability status：「Runtime 提供结构化瞬时 capability status，而不是单一扁平枚举：lifecycle、read、ROOT write、SCHEMA write，以及稳定且不含原始 Error/stack/SCHEMA 全文/ROOT 数据的 schema、fatal、close issue 摘要。status 不暴露队列长度、任务类型或 sequence。v1 不提供公共事件订阅；队列进度和内部事件属于日志、metrics 与 trace。」
  - 身份投影：「Runtime 公开冻结的 `owner.userId` 与 `namespaceId` 身份投影；它们是分区/文档身份，不代表授权。」
  - 验收方式（本任务直接依据）：「随后实现 `@nomicore/namespace-runtime` 的 P0、single sequencer、ROOT/SCHEMA 两类写、fatal/status/close，并以确定性状态机测试和真实 compiler/doc-runtime/Persistence 集成测试共同验收。Registry 另行设计。」
  - 取代关系：「本 ADR 取代 ADR 0007 中“普通 open 必须完成 schema 编译、META 检查、ROOT 提取和 logical validation 后才注册 Runtime”以及 schema-aware `readLogicalValueAtPath(derived, doc, path)` 的 Runtime/open/read部分。ADR 0007 关于 logical validation、detached materialization、validated mutation、零写入和 observer no-rollback 的底层决策继续有效。」

### ADR-0006 Cordis 持久化插件——DocPersistence 接口与 doc 三条目内容布局（accepted，含 issue #64、#79 两节修订）

- 与本任务的关联点：AC4「persistence degraded/recovery、检查后降级竞态与最新 live Y.Doc 最终持久化通过两 Adapter 验收」直接验收本 ADR #79 修订条款；Runtime 写前 gate 即本 ADR划归业务编排层（ADR 0008 Runtime）的职责。
- 核心条款（原文摘录）：
  - 定位：「持久层 = Y.Doc 的存储引擎（store + cache 一体），看得见 Y.Doc（结构、update 事件、state vector），看不见 schema 语义（VFSL/校验规则属引擎领地）。」
  - 两 Adapter：「`MemoryPersistence` 与 `FilePersistence` 是两个真实 Adapter（两个 Adapter 证明 seam 不是假想抽象）」
  - saveDoc 语义（#79 修订）：「saveDoc 是 **mutation 后的 dirty notification**：只要租约有效（未 released、非 foreign、身份匹配、Persistence 未 disposed），saveDoc 必须递增 dirtyGeneration 并 resolve——entry 处于 `persistence-degraded` **不构成拒绝理由**；已提交进 live Y.Doc 的事务由持久层内部 retry 以完整 Y.Doc 状态最终持久化」
  - degraded 拒绝面归属（#79 修订）：「『失败后 namespace 进入 `persistence-degraded`……拒绝**后续** REST/WS 写入』的拒绝面归属**业务编排层**：Runtime（ADR 0007 NamespaceRuntime 写前 gate）在业务 mutation 前读取 `handle.getStatus()`，已 degraded 则拒绝开始新写入（零写入：文档不变、响亮拒绝）。持久层自身仅在租约身份失效（foreign/released/身份失配）或 disposed 时响亮拒绝」
  - 检查后降级竞态（#79 修订）：「gate 检查通过后才转为 degraded 的 mutation 不属「后续」写入：其内存事务保留、saveDoc 正常登记、由 retry 覆盖最新完整 live Y.Doc」
  - entry 状态（#79 修订）：`DocHandleStatus = 'ready' | 'persistence-degraded' | 'released' | 'disposed'`；「状态查询是 **entry 级**的：恒答该 handle 自己的 `(owner.userId, docId)` entry 状态，不得以 Adapter 聚合状态代替」；「`getStatus()` 只表示**调用瞬间**状态，不承诺后续 flush 成功——写前状态检查不是持久化成功保证」
  - 平行验收（#79 修订，本任务两 Adapter 验收依据）：「MemoryPersistence 与 FilePersistence 以平行验收套件覆盖同一状态契约（`issue-79-entry-status.test.ts` / `issue-79-file-entry-status.test.ts`）」
  - flush 保序：「单飞 flush + generation 保序：每次 saveDoc 递增 dirtyGeneration；同一 doc 同时最多一个 flush。flush 启动时捕获 generation，成功后仅将该 generation 标记为已持久；若 flush 期间有新 saveDoc（dirtyGeneration 更大），doc 保持 dirty 并安排下一轮 flush——旧 snapshot 不得将新状态误标为已保存」
  - doc 三条目布局：`SCHEMA`（信封）/ `META`（docId, createdAt）/ `ROOT`（数据根）；「META/SCHEMA 作为 ROOT 的兄弟条目，天然在 validateSnapshot/validatePatch 的校验面之外（校验只作用 ROOT 子树）」

### ADR-0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted；Runtime/open/read 条款由 ADR 0008 部分取代）

- 与本任务的关联点：doc-runtime 侧底层契约（validated mutation、零写入、fatal、compileSchemaEnvelope）仍是本任务集成链路的组成；被取代的 open/read 条款不构成本任务对照义务。
- 核心条款（原文摘录，均为仍有效条款）：
  - 「`validateSnapshot` 直接更名为 `validateLogicalSnapshot`，不保留兼容 alias；它只接受普通 JSON logical ROOT snapshot，不接受 Y.Doc/Y.Map/Y.Array。」
  - 「新增纯函数 `compileSchemaEnvelope(input: unknown)`：输入必须是严格封闭且恰含 `lang/version/id/text` 的信封；按 envelope、dialect、parse、evaluate、internal 分阶段返回结果联合。」（P0 的编译入口）
  - 「`applyValidatedMutation(derived, doc, mutation)`：同步完成当前 ROOT 结构/逻辑检查、在普通 JSON 副本中模拟 mutation、完整 ROOT 逻辑校验、detached 子树构造和单次 Yjs transaction；不公开可跨时间执行的 prepared mutation，避免 TOCTOU。」
  - Runtime 编排边界：「NamespaceRuntime 将来按 namespace 串行化所有业务写入：轮到 mutation 时先检查 writable gate，同步调用 `applyValidatedMutation`，成功后立即调用 persistence `saveDoc` 标脏。业务调用方不得取得可写 Yjs 引用或绕过该入口；未来原始 Yjs update 必须另设受控验证通道。」
  - 失败边界：「零写入承诺覆盖所有验证失败和 detached 构造失败。Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报。事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback。」
  - 取代范围（自述）：「ADR 0008 取代本文 schema-aware `readLogicalValueAtPath(derived, doc, path)` 以及“普通 open 完成 schema 编译、META 检查、ROOT 提取和 logical validation 后才注册 Runtime”的 Runtime/open/read 条款。本文关于 logical validation、detached materialization、validated mutation、零写入与 observer no-rollback 的底层决策继续有效。」

### ADR-0001 VFSL 文本是 schema 的唯一真相源（accepted，含 2026-08-19/08-21 修订）

- 与本任务的关联点：集成验收用「真实 VFSL compiler」跑端到端场景，schema 文本只能以测试 fixture 形式存在于仓内。
- 核心条款（原文摘录）：
  - 「**本仓库是纯引擎仓库：代码库不含 schema 文本（测试 fixture 除外）。** VFSL 文本只作为运行时数据存在于文档的 `SCHEMA` 中」
  - 阶段态纪律（修订节）：「允许仓内放置 schema 文件作为**开发脚手架**完成阶段性开发（类型投影、演示、联调）」「一切脚手架消费方必须经 **SchemaSource 接缝**取文本（阶段实现 = 仓内文件源），不得直接读文件——终态切换为 DocSchemaSource（从 server/`SCHEMA` 拉取）时零消费方改动。脚手架不能长成承重墙」
  - 键名修订：「信封在 doc 中的键名由 `__schema__` 改为 **`SCHEMA`**——与 `ROOT` 保持统一命名（doc 顶层两个具名条目：`SCHEMA` 信封 + `ROOT` 数据）」

### ADR-0003 求值器与派生 schema（accepted）

- 与本任务的关联点：集成测试 fixture 必须满足 ROOT 约定，P0 编译失败场景的 fixture 构造亦受错误码约束。
- 核心条款（原文摘录）：
  - 「每个模块必须恰好声明一个名为 `ROOT` 的别名（大小写是契约，`root` / `Root` 不算），且必须 **map 形**……ROOT 固定物化为 Y.Map……检查位于 **parseVfsl 语义相位**——E310（缺 ROOT，锚模块起始）/ E311（ROOT 非 map 形，锚 ROOT 类型表达式起点）……Yjs 映射为 `doc.getMap('ROOT')`。」
  - 「evaluate 接缝：公共导出，`evaluate(module: VfslModule) → { ok: true; derived } | { ok: false; issues }`」

### ADR-0002 nomicore 是全新 yjs-server 重写，authority 完全出范围（accepted）

- 与本任务的关联点：低相关。验收不引入也不复活 authority 规则；统一写入管线沿用三步收敛。
- 核心条款（原文摘录）：
  - 「旧系统既有的 authority 规则体系（`__authority__` manifest：enum / range / conditional / state-machine）**完全排除在范围外，不保留接口**——统一写入管线收敛为“结构 → 值 → 单事务提交”三步。」

### ADR-0004 vfsl-protocol 类型协议包（accepted）／ADR-0005 投影生成管线（accepted）

- 与本任务的关联点：不直接相关。本任务不改动类型投影与生成管线；`vfsl-protocol`/`vfsl-codegen` 仅作为仓库既有包出现在现状盘点中，不构成本任务的约束来源。如后续设计触碰 `VfslPathMap`/生成物/CI 新鲜度，须回查 ADR 0004 D1–D5 与 ADR 0005 五决策。

## CONTEXT.md 相关术语与惯例

- `载体投影读取（readLogicalValueAtPath）`：「从 live Y.Doc 的固定 ROOT 按实际 Yjs/plain 载体和路径同步投影普通逻辑值；不依赖 VFSL/派生 schema，也不重复执行结构或逻辑校验。创建与受控写入负责建立并维持数据不变量；持久化文件被其他程序错误修改不在运行时读取契约范围内。」_Avoid_: validated read、schema-aware read
- `写序列器（write sequencer）`：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。」_Avoid_: mutation queue
- `P0（schema preparation）`：「Runtime 发布前已进入写序列器队首的 schema 准备任务；只投影并编译 SCHEMA、构造 active schema tools，不读取或验证 ROOT。Runtime 发布后读取立即可用，早期写排在 P0 后。」
- `active schema`：「NamespaceRuntime 当前安装、供 ROOT write 使用的已编译 schema tools 及身份；SCHEMA write 的 transaction 成功后同步切换，不等同于对 live SCHEMA 的即时读取。」
- `信封（envelope）`：「顶层具名 `SCHEMA` Y.Map 中 `lang/version/id/text` 四个字符串键投影出的严格普通对象；兼容读取忽略额外键，规范写入以一次 transaction 清空并重写四键。信封可哈希、可 diff。」
- `原样封闭校验（provided-root as-is closed validation）`：「`replaceSchema` 提供 `root` 时，root 被视为完整最终 logical ROOT snapshot，**原样**送入封闭对象校验（validateLogicalSnapshot）与 detached 构造（buildTopEntries）——任何未声明键，无论顶层还是嵌套，一律响亮拒绝（`ok:false` + 指向该键的 issue，零写入）；不投影、不剥离、不合并。」_Avoid_: 顶层声明域投影、宽松合并、schema 演进迁移
- `零写入（zero-write）`：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」
- `信封指纹（envelope fingerprint）` / `语义指纹（semantic fingerprint）`：四键身份 / `lang + version +` 规范 IR 语义身份（保留 JSDoc 与声明顺序、排除 `id`），供 getActiveSchema 与共享编译产物使用。
- `逻辑快照校验（validateLogicalSnapshot）`：「对普通 JSON 逻辑 ROOT 快照运行完整值语义校验；不接收 Y.Doc / Y.Map / Y.Array……普通 open/read 不重复校验已持久化 namespace。」_Avoid_: validateSnapshot
- `ROOT`：「命名空间根别名的保留名（大小写是契约）：每个模块必须恰好声明一个 map 形的 `type ROOT = …`……ROOT 固定物化为 Y.Map，Yjs 映射为 doc 根 `getMap('ROOT')`。」
- `命名空间（namespace）`：「一个 Y.Doc 连同自带的 `SCHEMA` 信封与数据；schema 随数据走，不依赖代码模块。」
- `求值器` / `派生 schema`：「把解析后的模块（IR）求解为派生 schema 的步骤；可失败（结果联合）」／「结构树、值 schema、路径索引的打包；与 IR 同纪律——纯数据、可 JSON 序列化、可内容哈希；别名按名引用（`ref`）保留，不内联展开（ADR-0003 §4）」。_Avoid_: 编译器（该词留给「文本 → IR → 派生 schema」的组合入口）

## 设计后复审追加（R1 设计引入的新决策点）

> SA8 设计后复审（2026-08-25）从 SA1 设计 `task_namespace-runtime-integration-acceptance_design.md`（R1）识别出的新增决策点，供全链 SA（SA3/SA4/SA7）对照；一致性裁决见同目录 `task_namespace-runtime-integration-acceptance_design_conflict_report.md`。

1. **ADR 0008 追加修订节（设计 D1/§4.1）——词汇收口注册**：文末「## 取代关系」节之后追加带日期、带议题号（2026-08-24，issue #93）的修订节，正文 L1–L111 零改动（§5 协议 `git diff … | grep -c '^-[^-]'` = 0 硬断言）。五条内容：①read 停接纳码 `RUNTIME_READ_DISABLED`（对应正文 L24 lifecycle 失败同步结果联合）；②`RUNTIME_WRITE_DISABLED` 码域澄清（fatal 排队写/persistence-degraded gate/notifier 未绑定/close 停接纳四域同码族、message 区分域、不另设新码）；③close 拒绝码 `NSRT-CLOSE-RELEASE-FAILED`（正文 L93 未定 rejection 形状内的最小公共面注册）；④「永久关闭」行文 vs「永久禁用……读取仍保留」可观测词汇的术语纪律注记；⑤注册表归属声明（issue-message 级码以 errors.ts append-only 注册表为准，不逐码入 ADR）。性质声明写入修订节首段：不引入新决策。
2. **CONTEXT.md 新增「停接纳（stop-acceptance）」词条（设计 D2/§4.2）**：置于 `active schema` 词条之后；承载 close 侧停接纳概念 + `RUNTIME_READ_DISABLED`/`RUNTIME_WRITE_DISABLED` 码族；排空/barrier 细节一句带过，语义权威单源于 ADR 0008。_Avoid_ 行防「lifecycle 失败借路径失败码」与「停接纳误解为取消已接纳任务」两类误读。
3. **ADR 0007 零改动判读（设计 §2 矩阵 #14）**：ADR 0007 L46「NamespaceRuntime/Registry 再映射成稳定的 create/open/mutation 上层错误」判读为该 ADR 时点的将来时投影，其 Runtime/open/read 辖域已由 ADR 0008 取代节接管；最终 API（create throw 稳定 `NamespaceRuntimeConstructionError`、mutation 稳定结果联合结算）与该句残余表述无矛盾——为零改动，不修 0007。
4. **AC6 判读固化（设计 D4）**：值导出面恰 `RuntimeWriteFatalError` + `createNamespaceRuntimeWithSeam` 两键（exports-audit 测试锁定）；`@internal` seam 构造器导出 = ADR 0008 L91「测试通过包内确定性 seam 注入」授权的测试注入口，「不公开生产构造器」禁令约束实例面与值导出面；forbidden 列表（createNamespaceRuntime/WriteSequencer/runP0/runRootWriteSlot/runSchemaWriteSlot/runCloseBarrier/buildStatus/PersistenceHandle/MemoryPersistence/FilePersistence 模块级缺席）是「不暴露包内 detached/testing seam」的可执行定义。不新建 namespace-runtime README（无消费方增量维护面）。
5. **不写 docs 文本断言测试（设计 D5）**：包测试不读仓库根 docs 路径（防破坏包自包含）；AC7 静态面防线 = §5 静态核对协议 + 后续任务 SA8 前置门禁 ADR 全文读取义务。
6. **diff base = `73811cd`（设计 §5）**：#93 轮起点（#92 合入点）；本分支对 main 为 stacked PR，前置轮辖域由各前置任务档案 ALLOW LIST 覆盖，本协议只针对 #93 轮增量。
7. **仓库卫生项（设计 D6）**：`.mabf-done` 删除固化 + `.gitignore` 追加 `.mabf-done`/`.mabf/`——简报明示义务，不源于 ADR/CONTEXT（非门禁基准）。

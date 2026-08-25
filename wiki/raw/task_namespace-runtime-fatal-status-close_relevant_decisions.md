# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（Phase 0，任务：namespace-runtime fatal、结构化 capability status 与 close 生命周期，issue #92）。
> 只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文（`docs/adr/`）。
> 摘录来源：ADR-0001 … ADR-0008 全集（8 份，全读）+ 根目录 CONTEXT.md。

## 相关 ADR

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted）

本任务唯一行为契约源（任务简报「权威依据」节明文指定）。本任务兑付其中「生命周期、状态与所有权」节的 close() 与 capability status 全部条款、getStatus 七键形状（含 close 摘要键），并收口「Fatal 与失败通道」节的验收——即该 ADR 在 #89（读取/P0）、#90（write sequencer + validated ROOT write + fatal 通道主体）、#91（原子 SCHEMA replacement）之后剩余未实施的条款。fatal 通道主体已由 #90 交付，本任务补齐验收锚与 fatal×close 交叉。

核心条款（原文摘录）：

**生命周期、状态与所有权节（本任务核心锚，AC5–AC8 逐句来源）：**

- 「Runtime 成功构造后独占一个 `DocHandle`；构造失败时所有权仍归调用方。Runtime 不公开 handle、Y.Doc、ROOT/SCHEMA/META live 引用或生产构造器。生产工厂保留包内，由未来 Registry 使用；测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault。」
- 「`close()` 幂等。首次调用同步进入 `closing`，立即停止接纳公共 read 和 write，并在队尾加入 close barrier；此前已接纳任务无条件排空，不取消、不设内部 timeout。barrier 只调用一次 `handle.release()`；无论 release 成败，Runtime 都进入 `closed`，失败时 close Promise reject，后续 close 返回同一个已结算 Promise。」
- 「Runtime 提供结构化瞬时 capability status，而不是单一扁平枚举：lifecycle、read、ROOT write、SCHEMA write，以及稳定且不含原始 Error/stack/SCHEMA 全文/ROOT 数据的 schema、fatal、close issue 摘要。status 不暴露队列长度、任务类型或 sequence。v1 不提供公共事件订阅；队列进度和内部事件属于日志、metrics 与 trace。」
- 「Runtime 公开冻结的 `owner.userId` 与 `namespaceId` 身份投影；它们是分区/文档身份，不代表授权。」

**Fatal 与失败通道节（AC1–AC4 逐句锚；#90 已交付主体，本任务补验收与 fatal×close 交叉）：**

- 「普通、可预期且零写入的读取或写入失败使用领域化结果联合；ROOT mutation 与 SCHEMA replacement 使用各自独立的窄 issue 类型，不形成巨型 write issue。」
- 「`@nomicore/doc-runtime` 必须提供 branded `DocRuntimeFatalError`，至少包含 `committed` 与稳定 `phase`。任何 internal fatal——无论 committed 与否——都永久关闭该 Runtime 的全部写能力并保留读取：」
  - 「`committed:false` 不调用 dirty notifier；」
  - 「`committed:true` 或未知异常保守视为可能已提交，在当前槽内 best-effort `notifyDirty()`，但始终 reject 原始 fatal；」
  - 「不补偿、不 fallback、不声称 rollback；」
  - 「post-commit fatal 以带 `committed:true` 的稳定 `RuntimeWriteFatalError` reject，上层不得自动重试非幂等写；」
  - 「已排队的后续写仍按 FIFO 取得槽，且不访问输入、零写入返回 `RUNTIME_WRITE_DISABLED`。」

**读取能力节（closing 期 read 停接纳的语义与拒绝形状约束源）：**

- 「Runtime 获得并信任有效 `DocHandle` 后，在对外发布前把 P0 放入 write sequencer 队首，同时立即开放同步读取；读取不等待 P0 或任何写任务，也不进入 sequencer。」
- 「预期路径、载体和 lifecycle 失败使用同步结果联合，只有 internal bug 才抛异常。」
- 「读取只观察调用瞬间已经提交的 live Y.Doc，不等待已接纳但尚未提交的写。调用方需要 read-your-write 时必须先等待对应写 Promise。」

**单一 write sequencer 节（close barrier 的宿主队列与槽序；排空期内已接纳写的执行依据）：**

- 「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer；不同 namespace 可并行。」
- 「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务。`notifyDirty` 是由构造方绑定 `persistence.saveDoc(handle)` 的窄接缝；Runtime 不依赖整个 `DocPersistence`。成功只表示 live commit 与 dirty notification 已登记，不表示已经落盘。」
- 「`persistence-degraded` 阻止 ROOT、SCHEMA 以及未来所有 Y.Doc 写；它不阻止 read 或不写 Y.Doc 的 P0。gate 是瞬时观察：检查后才发生的降级不撤销已提交事务，dirty notification 仍必须登记最新 live doc。」

**P0 与 active schema 节（schema 能力状态与 lifecycle 的分域边界）：**

- 「P0 结算后出队，只保留：`preparing`；`ready` 与 active schema tools；或 `unavailable` 与稳定 schema issue 摘要。」
- 「正常 compile result failure 仅使 ROOT write unavailable；SCHEMA write仍可修复。P0 抛出结果联合之外的 internal exception 则永久关闭该 Runtime 的所有写。ROOT write 在自己的槽开始时使用当时 active schema；它不绑定调用时 schema generation。」

**必要的底层演进与实施顺序节（AC9 验收方式锚）：**

- 「随后实现 `@nomicore/namespace-runtime` 的 P0、single sequencer、ROOT/SCHEMA 两类写、fatal/status/close，并以确定性状态机测试和真实 compiler/doc-runtime/Persistence 集成测试共同验收。Registry 另行设计。」

### ADR-0006 Cordis 持久化插件——DocPersistence 接口与 doc 三条目内容布局（accepted；含 #64 createDoc/owner 修订、#79 entry status 修订）

close barrier 的 `handle.release()` 契约与 fatal/close 路径 `notifyDirty()`（saveDoc 绑定）的持久层语义来源。

核心条款（原文摘录）：

- release lease 语义：「引用计数 + 身份校验：每个 handle 对应一个不可伪造的 lease；release 幂等且仅释放本次使用权。跨 Adapter/HMR reload 的 foreign handle、已释放 handle 的 saveDoc 都响亮拒绝；引用归零仅使缓存项成为可驱逐候选，不立即释放」
- 「release = 不再使用通知：调用方在短 scope 的 finally 中调用 handle.release()；持久层在引用归零后可触发/等待 dirty doc 的 flush，且仅在保存成功、缓存/空闲策略满足后才真正释放实例，调用方不直接控制释放时刻」
- #79 saveDoc 职责：「saveDoc 是 **mutation 后的 dirty notification**：只要租约有效（未 released、非 foreign、身份匹配、Persistence 未 disposed），saveDoc 必须递增 dirtyGeneration 并 resolve——entry 处于 `persistence-degraded` **不构成拒绝理由**；已提交进 live Y.Doc 的事务由持久层内部 retry 以完整 Y.Doc 状态最终持久化」
- #79 getStatus 契约：「状态查询是 **entry 级**的：恒答该 handle 自己的 `(owner.userId, docId)` entry 状态，不得以 Adapter 聚合状态代替」「`getStatus()` 只表示**调用瞬间**状态，不承诺后续 flush 成功——写前状态检查不是持久化成功保证」
- DocHandle 接口（#79 修订后形状）：`owner` / `docId` / `doc` / `getStatus(): 'ready' | 'persistence-degraded' | 'released' | 'disposed'` / `release(): Promise<void>`；状态优先级：「`disposed`（签发方已 dispose）> `released`（本租约已释放）> entry 状态（`persistence-degraded`：该 entry 最近一次 flush 失败且尚未 retry 成功；`ready`：其余情形，含 flush 在途）」

层间注意（供 SA1/SA3）：`DocHandleStatus`（entry 级，ADR-0006）与 Runtime capability status 的 `lifecycle`（Runtime 级，ADR-0008：ready/closing/closed）是两层状态。close barrier release 后 handle 层返回 `'released'`，不反灌 Runtime lifecycle；排空期内写槽的 writable gate 读的是 handle 层状态，全部已接纳任务在 barrier（即 release）之前执行完毕。

### ADR-0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted；Runtime/open/read 条款被 ADR-0008 部分取代，其余继续有效）

close 排空期内已接纳写槽仍走的 validated mutation 管线与失败边界来源。

核心条款（原文摘录）：

- 「`applyValidatedMutation(derived, doc, mutation)`：同步完成当前 ROOT 结构/逻辑检查、在普通 JSON 副本中模拟 mutation、完整 ROOT 逻辑校验、detached 子树构造和单次 Yjs transaction；不公开可跨时间执行的 prepared mutation，避免 TOCTOU。」
- 失败边界：「零写入承诺覆盖所有验证失败和 detached 构造失败。Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报。事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback。」
- 「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型；NamespaceRuntime/Registry 再映射成稳定的 create/open/mutation 上层错误。逻辑校验保留完整 issues，Yjs 结构与路径/操作错误 fail-fast。」
- 取代范围（本文尾节）：「ADR 0008 取代本文 schema-aware `readLogicalValueAtPath(derived, doc, path)` 以及“普通 open 完成 schema 编译、META 检查、ROOT 提取和 logical validation 后才注册 Runtime”的 Runtime/open/read 条款。本文关于 logical validation、detached materialization、validated mutation、零写入与 observer no-rollback 的底层决策继续有效。」

### ADR-0003 求值器与派生 schema（accepted）

关联点：低——本任务不动 ROOT 物化与求值链；status 的 schema 摘要键只反映 active schema 身份（ADR-0008「P0 与 active schema」节），不触碰派生 schema 纪律。

- 「每个模块必须恰好声明一个名为 `ROOT` 的别名（大小写是契约，`root` / `Root` 不算），且必须 **map 形**……ROOT 固定物化为 Y.Map……Yjs 映射为 `doc.getMap('ROOT')`。」
- 派生 schema 纪律：「派生 schema 延续 IR 全部纪律：纯数据、可 JSON 序列化、可内容哈希、不携带行列位置。」

### ADR-0001 VFSL 单一真相源（accepted，含 2026-08-19 修订与 2026-08-21 SCHEMA 键名修订）

关联点：低——本任务不触碰 schema 文本与信封写入；status「不暴露 SCHEMA 全文」是本 ADR「schema 是数据」纪律在运行时观测面的延续。

- 「本仓库是纯引擎仓库：代码库不含 schema 文本（测试 fixture 除外）。」
- 命名修订：「信封在 doc 中的键名由 `__schema__` 改为 **`SCHEMA`**——与 `ROOT` 保持统一命名。」

### ADR-0002 nomicore 是全新重写，authority 完全出范围（accepted）

关联点：低——close/status/fatal 均不得引入 authority 类不变式。

- 「旧系统既有的 authority 规则体系（`__authority__` manifest：enum / range / conditional / state-machine）**完全排除在范围外，不保留接口**——统一写入管线收敛为“结构 → 值 → 单事务提交”三步。」

### ADR-0004 vfsl-protocol 类型协议包（accepted）／ ADR-0005 投影生成管线（accepted）

关联点：无直接交集——二者为编译期类型投影/生成管线（Phase 1 轨道）；本任务是运行时生命周期（Phase 2 轨道）。列入仅为全集盘点完整性；无适用于本任务的约束条款。

## CONTEXT.md 相关术语与惯例

- **写序列器（write sequencer）**：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。」_Avoid_: mutation queue。——close barrier 按 ADR-0008 加入同一队列**队尾**；队列宿主非 Y.Doc 写节点已有先例（P0 本身「不写 Y.Doc」），close barrier 同理，不构成术语违例。
- **P0（schema preparation）**：「Runtime 发布前已进入写序列器队首的 schema 准备任务；只投影并编译 SCHEMA、构造 active schema tools，不读取或验证 ROOT。Runtime 发布后读取立即可用，早期写排在 P0 后。」——close 前若 P0 尚未结算，P0 属「此前已接纳任务」，按 ADR-0008 无条件排空于 barrier 之前。
- **零写入（zero-write）**：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」——closing 期新写拒绝必须零副作用（不入队、文档不变）。
- **载体投影读取（readLogicalValueAtPath）**：「从 live Y.Doc 的固定 ROOT 按实际 Yjs/plain 载体和路径同步投影普通逻辑值；不依赖 VFSL/派生 schema，也不重复执行结构或逻辑校验。」——closing/closed 期 read 停接纳属 lifecycle 失败，按 ADR-0008 读取能力节走**同步结果联合**（SA1 定形状时不得改为抛异常式公共 API）。
- **active schema**：「NamespaceRuntime 当前安装、供 ROOT write 使用的已编译 schema tools 及身份；SCHEMA write 的 transaction 成功后同步切换，不等同于对 live SCHEMA 的即时读取。」——status 的 schema 摘要键观察对象。
- **信封（envelope）**／**逻辑快照校验（validateLogicalSnapshot）**：本任务不触碰写入面，仅作语义背景。

## 设计后复审追加（R1 设计引入的新决策点）

> SA8 设计后复审（2026-08-25，Phase 2）从 SA1 设计 `task_namespace-runtime-fatal-status-close_design.md`（R1，§0–§13，D1–D11 + INV-C1..C12）识别出的决策点。其中第 1–2 条为 **ADR 条款的解释性裁决**（联合满足/未覆盖面收口），第 3–9 条为 **ADR 未定形状内的实施细化**。全链 SA（SA3 实现 / SA4 验证 / SA7 审计）按此对照；后续设计修订若改变下列任何一条的**语义方向**（从拒绝变接受、从 gate 变不 gate、公共面导出反转、从同一失败通道变静默降级），需回 SA8 复审。冲突裁决见同目录 `task_namespace-runtime-fatal-status-close_design_conflict_report.md`。

1. **lifecycle gate 位置裁决（设计 D5.2/INV-C7）**：ADR-0008 写槽槽序首步「lifecycle/fatal gate」的 lifecycle 半边兑现于**公共方法接纳层**（mutateRoot/replaceSchema 调用时点同步检查 `state.lifecycle !== 'ready'` → 拒绝、不入队），槽内只保留 fatal gate（S1 原样）。正当性：ADR「立即停止接纳公共 read 和 write」强制接纳时点拒绝（否则 close 后新写将入队于 barrier 之后，违反 barrier 终节点与零副作用）；槽内 lifecycle gate 唯一可能命中的对象恰是「close 前已接纳任务」，对其拒绝将直接违反「此前已接纳任务无条件排空」——两条款联合阅读下，接纳层兑现是唯一自洽实现；槽序首步的可观测语义完整保留（fatal 半边在槽内 S1，lifecycle 半边由接纳门结构性保证：任何槽任务必在 lifecycle==='ready' 期入队）。write.ts / schema-write.ts 扩展位注释更新为裁决标注（注释级）。
2. **gate 边界裁决（设计 D7）**：「立即停止接纳公共 read 和 write」的 read/write 边界 = capability 三槽（`read` / `mutateRoot` / `replaceSchema`）；`getSchemaEnvelope` / `getMetadata` / `getActiveSchema` / `getStatus` 四个观测/投影 getter **全生命周期可用**（post-close 继续纯内存投影 live Y.Doc）。正当性锚：ADR-0008 status 模型恰命名四个能力槽（lifecycle/read/ROOT write/SCHEMA write）——「read」即路径投影读取能力；「接纳」是排队概念，仅适用于能力操作；getStatus post-close 可用是 ADR close 语义的必要条件（'closed' 仅经 status 可观测）；getter 契约无失败通道（gate 它们只能发明 throw 或静默 null 虚假降级）；#89 R3 边界先例（外部 release 后投影面继续观察）。**此为 ADR 未覆盖面的解释性裁决（设计自标 O2）**：若后续判定应收紧 getter post-close 行为，属新决策，须升级总控，不得由 SA 擅断。
3. **read 停接纳结算形状（设计 D4）**：closing/closed 期 `read()` 同步返回**结果联合新分支** `RuntimeReadDisabledResult`（`{ok:false; code:'RUNTIME_READ_DISABLED'; path; message}`），`read` 返回类型宽化为 `NamespaceRuntimeReadResult = ReadLogicalValueResult | RuntimeReadDisabledResult`（公共类型导出）。这是 ADR-0008 读取能力节「预期路径、载体和 **lifecycle 失败**使用同步结果联合，只有 internal bug 才抛异常」的直接兑付（Phase 0 关键对照 7 的设计内遵守）；不借用 `PATH_NOT_ALLOWED`（生命周期失败 ≠ 路径缺陷，防调用方按 code 误分类）；非抛、非 Promise、不触碰 live Y.Doc；ready 期透传分支逐字节不变。
4. **write 停接纳结算形状（设计 D5.1/INV-C6）**：closing/closed 期 `mutateRoot`/`replaceSchema` **不入队**、不读输入引用、零 doc 副作用，经返回 Promise settle 领域化联合，**复用稳定码 `RUNTIME_WRITE_DISABLED`**（经 `disabled()` 共享构造，reason 文案区分 lifecycle 域；与 fatal 后排队写 S1 gate、writable gate、notifier 未绑定三处先例同码族）。即时结算（`Promise.resolve(disabled(...))`）是「立即停止接纳」的执行器：接纳拒绝不是排队任务，#90「不同步结算」纪律的辖域是**已接纳路径**的 FIFO 定序，不约束拒绝路径；两纪律并存不冲突。
5. **close barrier 槽体三细则（设计 D3/INV-C12）**：(a) barrier **不检查 handle 状态**——ADR「barrier 只调用一次 `handle.release()`」是无条件指令，persistence-degraded / 外部已 release（release 幂等 resolve，ADR-0006）都不阻止；(b) release 返回**非 thenable** = adapter 契约违背（DocHandle.release(): Promise<void>）→ 拒绝虚假降级：不静默当成功，收敛为同一失败通道（closed + NSRT-CLOSE-RELEASE-FAILED 摘要 + 稳定 reject）；(c) `closeIssue` 在 throw 之前同步注册——rejection 送达调用方时 `getStatus().close` 已可观测（沿 markWriteFatal 同步先行哲学）。release 永不 settle → close Promise 永挂起（ADR「不设内部 timeout」的契约行为，非缺陷）。
6. **close rejection 形状与公共面（设计 D9/§1.3）**：close Promise 的 rejection 值为包内 `NamespaceRuntimeCloseError`（恒定 message + `cause` 零信息损失保留原始异常；**不从 index.ts 导出**）。ADR-0008 只说「失败时 close Promise reject」未定 rejection 类型；分类消费走 ADR 明文提供的 `getStatus().close` 稳定摘要（`{code:'NSRT-CLOSE-RELEASE-FAILED', message}`）或 `reason.code` 字符串——沿「构造/投影错误类别不导出、按 code/message 消费」纪律；导出留待 Registry 有真实消费者再议。
7. **status 的 handle 观察短路（设计 D6）**：closing/closed 期写能力位由 lifecycle 域短路决定（恒 false），**不再观察** `handle.getStatus()`（release 后 handle='released'，观察无信息增益，且隔离 adapter bug 对 post-close 状态面的干扰）；ready 期观察与 loud 传播契约**逐字节不变**（#89/#90 既有锚零回归）。status 仍为「瞬时」语义——lifecycle 短路是瞬时真话的忠实表达。
8. **seam V1 release 形状守卫（设计 D10）**：`captureSeamInput` 增补 `typeof handle.release !== 'function' → TypeError`（构造栈同步 throw，零副作用）。#92 起 release 成为 barrier 的 load-bearing 依赖；契约违背前置到构造栈 loud 拒绝（INV-N4 家族扩展）；grep 实证既有 8 处 fakeHandle 全部提供 release 函数、真实 handle 由 persistence 实现——零回归。
9. **术语分域维持（设计 INV-C10，非 ADR 基准纪律的设计级兑现）**：fatal 域字符串（writeFatalMessage 模板 / FATAL_*_INTERNAL_MESSAGE / S1 gate disabled reason）**零字节改动**——不含 closing/closed 措辞（#90 R2 立法 + rev1 措辞锚继续绿）；close 域新字符串（read-disabled message / write 接纳拒绝 reason / CLOSE_RELEASE_FAILED_MESSAGE）使用 lifecycle 术语且不含原始异常文本/stack——两域字符串互不串味（Phase 0 注记 N3 的设计内维持）。

## 附注：非 ADR/CONTEXT 基准的仓库纪律（简报引用，仅记录）

以下纪律出现在任务简报但**不源于 ADR 全集或 CONTEXT.md**，按门禁规则不构成冲突基准，全链 SA 自行遵守即可：

- HG #9 版本 bump（`@nomicore/namespace-runtime` 0.1.4 → 0.1.5，连带触碰包同步 bump）；`pnpm test`（vitest run --typecheck）与 `pnpm typecheck` 七包 tsc 全量门禁；Node 20/24 CI；namespace-runtime tsconfig include 仅 src/**（#89 设计 §7.1 决议）。
- #90 R2 fatal 措辞纪律（`runtime-write-fatal-message-rev1.test.ts` 的 `expectNoClosingWording`：fatal 文案不含 closing/closed 措辞）——测试锚纪律，非 ADR 条款；简报自身已声明该约束在 #92 引入 closing/closed 后仍然有效，且 fatal message 与 lifecycle 状态值分域不冲突。
- `runtime-public-surface-ownership.test.ts` 当前锁定九键公共面 + status 六键 + `lifecycle:'ready'`——代码/测试事实，非冲突基准；演进为十键 + 七键 + 三态属本任务预期变更。
- `DocHandle.release()` 契约见 `packages/persistence/src/contract.ts:29`——代码事实，其 ADR 依据为 ADR-0006（release 幂等、lease 语义，见上）。

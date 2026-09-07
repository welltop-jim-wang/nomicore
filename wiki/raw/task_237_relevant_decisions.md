# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（issue #237：优化 Namespace mutation——用路径级校验替代完整 ROOT 复制与全量校验）。
> 只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。裁决见
> `wiki/raw/task_237_conflict_report.md`。
>
> 基准快照：worktree HEAD `9e3f0bf`，`docs/adr/` 共 11 份（无 0011），全部逐个全读；
> CONTEXT.md 为现行词汇表。ADR-0007/0008 已含 2026-09-05 commit `1c8b907`
> （docs(adr): document incremental mutation commits）修订后的最新文本。

## 相关 ADR

### ADR-0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted；Runtime/open/read 条款被 ADR-0008 部分取代）——核心相关

- 与本任务的关联点：本任务直接改写其 `applyValidatedMutation` 管线的校验范围（完整 ROOT → 路径级/最近语义边界）。
- 核心条款（原文摘录）：
  - 「`validateLogicalSnapshot`……只接受普通 JSON logical ROOT snapshot，不接受 Y.Doc/Y.Map/Y.Array。」（逻辑层留在 `@nomicore/vfsl`）
  - 「`@nomicore/vfsl` 继续保持无 Yjs 依赖；持久层继续不理解 VFSL。」（Yjs bridge 独立为 `@nomicore/doc-runtime` 的分层前提）
  - 「`extractYjsSnapshot(derived, doc)`：只读取固定 ROOT，严格验证实际 Yjs 载体并提取普通逻辑 ROOT；首个结构错误立即停止，不读取或验证 SCHEMA/META。」
  - 「`applyValidatedMutation(derived, doc, mutation)`：同步完成当前 ROOT 结构/逻辑检查、在普通 JSON 副本中模拟 mutation、完整 ROOT 逻辑校验、目标值的 detached 子树构造和单次 Yjs transaction；普通非空路径 mutation 在 live ROOT 上只修改目标 carrier（`Y.Map.set/delete` 或 `Y.Array.insert/delete`），不重建无关 carrier。只有 `set([])` 走完整 ROOT 清空与重装。不公开可跨时间执行的 prepared mutation，避免 TOCTOU。transaction 返回后重新提取 live ROOT，并与已校验的 proposed logical ROOT 做完整一致性校验；偏离属于已提交 fatal，不回滚、不补偿。」（含 `1c8b907` 修订文本；本任务演进对象）
  - 「当前 ROOT 已损坏时普通 mutation 失败，不承担 recovery。」
  - 「成功只返回 `{ ok:true }`，不返回 snapshot、Yjs update 或内部类型。」
  - 「不公开可跨时间执行的 prepared mutation，避免 TOCTOU。」
  - 失败边界：「零写入承诺覆盖所有验证失败和 detached 构造失败。Yjs observer 不得向事务调用栈抛异常……事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback。」
  - 后果（含 `1c8b907` 修订文本）：「普通读取成本与目标 path 子树规模相关。validated mutation 为正确性继续执行完整 ROOT 提取与逻辑校验，因此其校验 CPU/内存成本仍与 ROOT 规模相关；提交阶段只修改目标 carrier，使 owned Yjs update 与实际变更规模相关，而不再随完整 ROOT 放大。**继续优化完整校验成本时必须保留行为等价测试。**」（本任务即该句预告的后续优化；等价性测试是硬前置）

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted）——核心相关

- 与本任务的关联点：本任务保持 `mutateData` 公共 interface、slot 顺序与 fatal 契约不变，只改槽内「领域校验」的执行范围。
- 核心条款（原文摘录）：
  - 「`mutateData` 接受路径化领域 mutation，而不是"下一个完整 Data"快照。普通业务更新定位到最窄可独立写入节点……底层按 ADR 0007 在目标 `Y.Map` 或 `Y.Array` 上提交对应的最小 carrier 修改，保留不相关 Yjs identity，让并发修改不同节点可合并，并使 owned update、verb 与 path 都直接表达实际变更。空路径整体替换仍作为受控管理/迁移能力；它是唯一清空并重装完整 ROOT 的 mutation，不作为普通消费模式。」
  - slot 顺序：「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务。」
  - 「任务取得槽后立即用受控 snapshotter 复制并递归冻结 plain data，之后编译、校验、构造和提交只使用该内部快照。」
  - ROOT write（含 `1c8b907` 修订文本，本任务演进对象）：「每笔写按 ADR 0007 的 validated mutation 管线检查当前 ROOT、在普通 JSON 副本中模拟并校验完整 proposed ROOT、在事务前 detached 构造目标新值，再以一个 guarded Yjs transaction 直接修改目标 carrier；事务后验证 live ROOT 与 proposed ROOT 一致。非空路径 mutation 不重建完整 ROOT。」
  - 「ROOT write 在自己的槽开始时使用当时 active schema；它不绑定调用时 schema generation。」
  - SCHEMA write（本任务不改，仍是合法性重建点）：「未提供 `root` 时，按 proposed derived 严格提取并验证当前 ROOT，证明逻辑值与实际载体均已兼容；提供 `root` 时，将其视为最终完整 logical ROOT snapshot，验证并 detached 构造完整新内容。」
  - 「新 SCHEMA 的编译、最终 ROOT 校验或 detached 构造失败均发生在 transaction 前，SCHEMA/ROOT 零写入，active tools 不变。」
  - Fatal：「不补偿、不 fallback、不声称 rollback」；「post-commit fatal 以带 `committed:true` 的稳定 `RuntimeWriteFatalError` reject，上层不得自动重试非幂等写」。
  - 封装边界：「Runtime 不公开 handle、Y.Doc、ROOT/SCHEMA/META live 引用或生产构造器。」
  - status 观测面：「不暴露队列长度、任务类型或 sequence。v1 不提供公共事件订阅；队列进度和内部事件属于日志、metrics 与 trace。」（benchmark/instrumentation 不得借机扩公共面）

### ADR-0010 Hub/Peer WebSocket Y.Doc 复制（accepted）——核心相关（replication-unvalidated 后备语义）

- 与本任务的关联点：本任务第一阶段假设「mutation 前 committed ROOT 合法」，而 raw replication apply 可能破坏该假设；ADR-0010 现文把「后续普通业务写全量校验」登记为拒绝通道。
- 核心条款（原文摘录）：
  - 「实例链路是受信任复制链路。Raw update 不执行完整 VFSL 预校验；这是对 ADR 0007/0008 普通业务写 zero-write 保证的明确例外，而不是暗中复用业务 mutation 语义。」
  - 「Raw merge 后 ROOT 可能不符合当前 SCHEMA；该 update 仍被接受并继续复制，复制状态标记 `replication-unvalidated`。后续普通业务写仍按现有完整 ROOT 校验，可能被拒绝。Yjs 没有通用 transaction rollback，因此不得采用"先 apply、失败再回滚"，也不得虚假声称 raw update 享有验证失败零写入。」（后半句演进对象；前半句「不得先 apply 后回滚」与本任务 Owner 要求同向）
  - 「远端 update 仍必须进入该 namespace 的唯一 write sequencer」；apply 槽序「lifecycle、角色、身份和 epoch gate → 必要的受保护字段检查 → 一次 `Y.applyUpdate` → Runtime observer 产出 owned update 与受控 origin → `await saveDoc(handle)` 登记 dirty → 释放 sequencer 槽」。
  - 「本 ADR 对 ADR 0007/0008 的"未来 raw Yjs update 必须另设受控通道"作出决定：通道位于 NamespaceLease 的 ReplicationSession，并继续进入唯一 write sequencer；但 trusted raw update 明确不继承普通业务写的完整 VFSL zero-write 保证。」
  - wire 契约唯一权威：「连接与 namespace 状态、消息码……以 `docs/protocols/instance-replication-v1.md` 为唯一 wire contract。」（benchmark「保持 wire update count」的对照基准）

### ADR-0009 NamespaceRegistry、调用方租约与 Host 生命周期（accepted）——相关

- 与本任务的关联点：唯一 Runtime/sequencer 安全不变量；create 路径是「合法性建立」点之一（本任务不动）。
- 核心条款（原文摘录）：
  - 「同一 namespace 的所有受控写保持唯一 Runtime 和唯一 sequencer。」
  - create：「它编译 schema，按 proposed schema 原样封闭校验完整 ROOT，完成 detached 构造，并在一个初始 Y.Doc transaction 中安装 SCHEMA、META、ROOT。」
  - open：「它不等待 P0，不编译 schema，也不验证 ROOT。」

### ADR-0006 Cordis 持久化插件与 doc 三条目布局（accepted，含 #64/#79/#133 修订）——相关

- 与本任务的关联点：dirty notification 语义与单事务原子性是 benchmark「保持 dirty notification 与 wire update count」的契约基准。
- 核心条款（原文摘录）：
  - 「`saveDoc` = 脏状态通知，不是同步落盘……返回仅表示脏状态已登记，不构成该次写入已落盘的承诺。」
  - 「事务原子性由 Y.transact（单 update 单元）保证，store 无需多写事务。」
  - 「META/SCHEMA 作为 ROOT 的兄弟条目，天然在 validateSnapshot/validatePatch 的校验面之外（校验只作用 ROOT 子树）。」

### ADR-0003 求值器与派生 schema（accepted）——相关（载体与边界重建的地基）

- 与本任务的关联点：路径级校验/最近结构边界重建的语义依据；载体（YMap/YArray/plain）区分是 carrier check 的依据。
- 核心条款（原文摘录）：
  - ROOT 约定：「ROOT 固定物化为 Y.Map，`YArray` / `YXmlFragment` 与标量形一律拒绝……Yjs 映射为 `doc.getMap('ROOT')`。」
  - 联合表示：any-of 匹配语义、判别式缓存「缺失/存在不得改变任何可观测行为」。
  - 关联注记：「Feishu 设计文档 §7（统一写入管线——『最近的结构边界重建整值』依赖联合表示）」。
  - `docs/phases/phase-2-engine-gaps.md` H2（既有依据，非 ADR）：「`validatePatch`……结构守卫……+ 最近结构边界重建整值校验」——路径级校验属 Phase 2 既定引擎能力，非本任务新语义。

### ADR-0002 nomicore 是全新重写，authority 出范围（accepted）——弱相关

- 「统一写入管线收敛为『结构 → 值 → 单事务提交』三步。」——本任务的局部 carrier check + 局部 logical 校验仍落在同一三步形状内。

### ADR-0001 VFSL 单一真相源（accepted，含 2026-08-19/08-21 修订）——弱相关

- 本任务不改 schema 文本、信封、方言冻结与编译缓存；ROOT/SCHEMA 顶层具名条目命名不变。

### ADR-0004 vfsl-protocol 类型投影五决策（accepted）——弱相关

- D1 数组写入校验入口（`appendToArray` / `insertIntoArray` / `deleteFromArray`）与 D5「ROOT 是 doc 级固定挂载点」；本任务只消费运行时侧，不动编译期投影轨道。

### ADR-0005 投影生成管线（accepted）——无关-弱相关

- 编译期投影/生成器轨道与运行时 mutation 校验无交集。

### ADR-0012 实例身份与 WebSocket plugin 所有权（accepted）——无关

- Instance identity/plugin 组合边界；本任务不触及。

## CONTEXT.md 相关术语与惯例（原文摘录）

- **ROOT**：「每个模块必须恰好声明一个 map 形的 `type ROOT = …`……并物化为 doc 根 `getMap('ROOT')`。ROOT 属于 schema、生成器和运行时实现词汇，不进入普通 namespace 消费接口。」
- **标记类型**：「`YMap` / `YArray` / `YPlainArray` / `YLeaf` / `YXmlFragment` / `Pattern`；tsc 视角恒等别名，引擎视角是 Yjs 物化语义标记。」（carrier topology 的声明面）
- **结构树**：「Yjs 物化语义（kind / storage / opaque），供路径下钻守卫；与值语义正交。」
- **逻辑快照校验（validateLogicalSnapshot）**：「对普通 JSON 逻辑 ROOT 快照运行完整值语义校验；不接收 Y.Doc / Y.Map / Y.Array，也不验证 Yjs 载体。创建前校验、写入前校验、迁移后体检、测试与管理端点共用该入口；普通 open/read 不重复校验已持久化 namespace。」（本任务删热路径调用后，「写入前校验」用法清单需同步修订）
- **载体投影读取（readLogicalValueAtPath）**：「从 live Y.Doc 的固定 ROOT 按实际 Yjs/plain 载体和路径同步投影普通逻辑值；不依赖 VFSL/派生 schema，也不重复执行结构或逻辑校验。创建与受控写入负责建立并维持数据不变量。」
- **写序列器（write sequencer）**：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。」
- **P0（schema preparation）**：「只投影并编译 SCHEMA、构造 active schema tools，不读取或验证 ROOT。」（P0 不是合法性建立点——phase-1 假设不能挂在 P0 上）
- **active schema**：「NamespaceRuntime 当前安装、供 ROOT write 使用的已编译 schema tools 及身份；SCHEMA write 的 transaction 成功后同步切换。」
- **零写入（zero-write）**：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」
- **重建校验（rebuild validation）**：「单字段 patch 也在最近结构边界合并当前值后按完整子 schema 校验——判别联合只有看到判别字段才知道按哪个变体验。」（本任务局部 logical boundary 校验的直接词汇依据）
- **复制未校验（replication-unvalidated）**：「Trusted raw Yjs update 已在 sequencer 中提交并登记 dirty，但未执行完整 VFSL ROOT 预校验的复制状态；它可能导致后续普通业务写因当前完整 ROOT 不合法而失败，不表示 transaction 可回滚或 raw update 享有 zero-write 保证。」（后半句语义随本任务收窄，词汇需同步修订）
- **Data**：「公共消费面以 `readData(path)` / `mutateData(mutation)` 表达最小、可合并且有语义的变更。」

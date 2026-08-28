# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（issue #134，Phase 5 切片 3/4：NamespaceLease ReplicationSession）。
> 只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 行号锚定于本 worktree 基线 ebc5419。

## 相关 ADR

### ADR-0010 Hub/Peer WebSocket Y.Doc 复制与最终一致（已接受，2026-08-27）

本任务的第一权威。与本任务直接相关的四节条款原文摘录：

**§NamespaceLease 与 ReplicationSession（L71–90）**

- 「`NamespaceLease` 正式增加高级受信付认集成入口：`lease.openReplicationSession(options): ReplicationSession`」（L73–77）
- 「所有 Lease 都可调用该入口，不设置不可伪造 capability；Host 搭建方负责只把 Lease 交给可信代码。API 文档必须明确 raw replication 会绕过 VFSL 业务校验，不得把它暴露为普通客户端写入口。」（L79）
- 「每个 Lease 首版最多一个 duplex ReplicationSession。Session 创建时冻结 `localRole`、`remoteInstanceId`、`replicationId` 和 `replicationEpoch`，提供窄能力而不暴露 Y.Doc：编码 state vector；按远端 state vector 编码 diff；订阅 owned `Uint8Array` 本地 updates；在唯一 write sequencer 中应用远端 update；查询独立复制状态；幂等 close。」（L81–88）
- 「Lease release 同步停止 session 接纳；channel 关闭先关闭 session，再释放 Lease。网络状态保留在 ReplicationSession/复制插件，不塞入 Runtime 的业务 capability status。」（L90）

**§Trusted raw update 与现有不变量（L92–113）**

- 「实例链路是受信任复制链路。Raw update 不执行完整 VFSL 预校验；这是对 ADR 0007/0008 普通业务写 zero-write 保证的明确例外，而不是暗中复用业务 mutation 语义。」（L94）
- 「远端 update 仍必须进入该 namespace 的唯一 write sequencer：1. lifecycle、角色、身份和 epoch gate；2. 必要的受保护字段检查；3. 一次 `Y.applyUpdate`；4. Runtime observer 产出 owned update 与受控 origin；5. `await saveDoc(handle)` 登记 dirty；6. 释放 sequencer 槽。」（L96–103）
- 「Hub 接收 peer update 前，在 scratch clone 上确认 update 不改变 SCHEMA，也不改变 META 中的复制身份保留字段。Peer 接收 hub update 时允许同步 ROOT、SCHEMA 和允许的 META 字段。该检查执行角色权限，不等同于 VFSL ROOT 校验。」（L105）
- 「Raw merge 后 ROOT 可能不符合当前 SCHEMA；该 update 仍被接受并继续复制，复制状态标记 `replication-unvalidated`。后续普通业务写仍按现有完整 ROOT 校验，可能被拒绝。Yjs 没有通用 transaction rollback，因此不得采用『先 apply、失败再回滚』，也不得虚假声称 raw update 享有验证失败零写入。」（L107）
- Runtime observer 三条（L109–113）：「只交付复制需要的 owned bytes 和受控 origin，不暴露 live Y.Doc；observer 失败不得回滚 transaction 或使 Runtime fatal；队列溢出只把 channel 标记为 `needs-resync`，不得阻塞 write sequencer。」

**§SCHEMA 与 META 权限（L115–121）**

- 「SCHEMA 只允许 hub 的本地 `replaceSchema()` 修改；peer 本地调用以稳定角色权限错误拒绝。」（L118）
- 「Hub 的 SCHEMA update 正常向 peer 单向复制。」（L119）
- 「`META.replicationId` 与 `META.replicationEpoch` 只能由 hub 的显式复制管理操作修改。」（L120）
- 「未来其他非保留 META 字段可另行决定双向语义；raw caller 不得逐次自定义受保护字段集合。」（L121）

**§Persistence degraded 语义（L123–139）**

- Hub degraded（L125–129）：「拒绝 peer→hub raw update；保留读取、身份检查和 state-vector 交换；Persistence 恢复后通过 reconciliation 补齐。」
- Peer degraded（L131–137）：「拒绝本地业务 mutation；仍允许已认证 hub→peer session 将 update 应用到内存；仍调用 `saveDoc(handle)` 登记最新 generation，由 Persistence retry 保存完整 live doc；Runtime closing/fatal 或 handle 失效时不得绕过；崩溃重启可能从旧 snapshot 恢复，随后由 hub 的 state-vector diff 自动补齐。」
- 「该 bypass 只属于创建时已冻结为 `hub-to-peer` 的可信 session，不能由普通业务写或 peer→hub update 获得。状态必须区分『内存已追上』与『磁盘未追上』，不得声称 peer 副本已经 durable。」（L139）

**其他相关条款**

- §复制谱系与 epoch（L41–57）：「身份与 epoch 相同才允许双向 state-vector reconciliation；缺失或不同进入稳定 `conflicted` 状态，绝不自动覆盖或合并」（L55）；「hub 提供 `bumpReplicationEpoch()`，它不替换 Y.Doc 内容，但使旧 epoch 的 peer 必须显式 reset/bootstrap」（L53）。
- §包、应用与生命周期（L169–179）：「在出现第二种 transport 前，不提前提取 transport-independent replication package。第三方 Host 可直接基于公开 NamespaceLease/ReplicationSession 构造自己的可信 transport。」（L177）；停止顺序：「复制插件停止接纳连接/target，关闭 channels，等待已被 Runtime 接纳的 apply 槽完成但不无限等待网络 ACK，释放 replication leases，随后 Registry shutdown、Persistence dispose，最后停止 Timer/Clock。」（L179）
- §取代与关联（L216–224）：「本 ADR 对 ADR 0007/0008 的『未来 raw Yjs update 必须另设受控通道』作出决定：通道位于 NamespaceLease 的 ReplicationSession，并继续进入唯一 write sequencer；但 trusted raw update 明确不继承普通业务写的完整 VFSL zero-write 保证。」（L220）
- §非目标（L203–214）：「raw update 的完整 VFSL 校验」「自动覆盖 identity/epoch 冲突」「durable outbox、增量 WAL 或跨重连 update ID 表」「第二种 transport 及提前抽取 transport-independent replication seam」等。

### ADR-0008 NamespaceRuntime 读写能力与单序列器（已接受 2026-08-23；含 #93 稳定码注册修订与 issue #132 修订节）

- 单一 write sequencer：「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer；不同 namespace 可并行。」（L36）
- 槽序（业务写族）：「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务。」（L45）
- Degraded 条款：「`persistence-degraded` 阻止 ROOT、SCHEMA 以及未来所有 Y.Doc 写；它不阻止 read 或不写 Y.Doc 的 P0。gate 是瞬时观察：检查后才发生的降级不撤销已提交事务，dirty notification 仍必须登记最新 live doc。」（L47）
- 生命周期/close（L89–97）：「`close()` 幂等。首次调用同步进入 `closing`，立即停止接纳公共 read 和 write，并在队尾加入 close barrier；此前已接纳任务无条件排空」；「status 不暴露队列长度、任务类型或 sequence」；「Runtime 不公开 handle、Y.Doc、ROOT/SCHEMA/META live 引用或生产构造器。生产工厂保留包内，由未来 Registry 使用；测试通过包内确定性 seam 注入」（L91）。
- #93 稳定码注册修订（L113–125）：`RUNTIME_READ_DISABLED`；`RUNTIME_WRITE_DISABLED` 码族覆盖「fatal 已置位后的排队写、写前 writable gate 拒绝（persistence-degraded / released / disposed 三态同拒）、notifyDirty 未绑定 loud gate、close 后接纳拒绝」；`NSRT-CLOSE-RELEASE-FAILED`；「其余公共面可观测稳定码以包内各稳定码定义处的 append-only 注册表为准」。
- **issue #132 修订节（L127–137）**：
  1. 构造期窄例外：「仅允许 Runtime 在构造、对外发布前同步读取 `META.replicationId` 和 `META.replicationEpoch` 两个保留字段，仅为生成 status 的复制持久事实投影」（L131）。
  2. 两态与损坏：「双键均真缺席 → `{state:'disabled'}`，或双键均存在且均合规 → `{state:'enabled'; replicationId; replicationEpoch}`；恰一键存在、键存在而值为显式 `undefined`、格式不合法、META 载体异型均为持久化损坏，Runtime 构造同步拒绝……禁止伪装 disabled、禁止自动补写新 lineage」（L132）。
  3. 「除此之外，原第 14 行保持不变」（L133）。
  4. 公共窄写方法：「基础 v1 方法为两个（`mutateRoot` / `replaceSchema`）；经 ADR 0010 授权的复制管理例外另加 `enableReplication()` 和 `bumpReplicationEpoch()`。四者均进入同一严格 FIFO write sequencer，完整槽序……不变」（L134）。
  5. status：「补 `replication`；该域仅含持久 identity/epoch 的两态联合……不含 session、网络、队列或 sync 状态」（L135）。
  6. 「成功仍只表示 live commit + dirty notification 已登记，不等于已落盘……fatal 之后读取与 status 保留最后已提交事实」（L136）。
  7. 「复制字段格式、不可变性、epoch 上限与 hub-only 管理权以 ADR 0010 为权威；ADR 0008 仅规定 Runtime 的 sequencer 槽序、status 投影、构造期窄例外与失败通道」（L137）。

### ADR-0009 NamespaceRegistry、调用方租约与 Host 生命周期（已接受 2026-08-25；含 #131 修订节）

- Lease 代理边界（L38）：「Lease 是调用方唯一能力入口，代理 Runtime 除 `close()` 外的同步读取、投影、status、ROOT mutation 和 SCHEMA replacement；不公开裸 Runtime、DocHandle、Y.Doc 或 live Yjs 引用。」（openReplicationSession 由 ADR 0010 L73–79 正式增补该面。）
- release 纪律（L42–44）：「首次 `release()` 在调用栈内同步将 lease 标记为 released，之后不再接纳新操作。重复 release 返回 exact same Promise」「release 后，除 `getStatus()` 外的操作通过其既有同步/异步结果通道返回稳定 `NAMESPACE_LEASE_RELEASED`」。
- 空闲保留（L48–50）：最后 lease 释放后 Runtime 进入 idle 而非立即 close；idle 期间 open 复用同一 Runtime。
- Shutdown（L99–101）：「首次 shutdown 在调用栈内同步进入 `shutting-down` 并停止接纳 open/create……主动 close 全部 active/idle Runtime，不等待外部 lease release。Runtime close 自己排空已接纳写。」
- #131 修订节（L132–141）：Registry identity 以 ADR 0010 为唯一权威（namespaceId-only key、owner 本地属性、owner mismatch → `NAMESPACE_NOT_FOUND`）。
- 模块边界（L18）：「Registry 通过 `@nomicore/namespace-runtime/internal` 唯一导出的 `createNamespaceRuntimeForRegistry` 构造生产 Runtime；主入口不公开生产 Runtime 构造器。」（包内 seam 先例。）

### ADR-0007 逻辑验证与 Yjs Runtime Bridge（已接受 2026-08-22；Runtime/open/read 条款由 ADR 0008 部分取代）

- 受控通道预留（L42）：「业务调用方不得取得可写 Yjs 引用或绕过该入口；未来原始 Yjs update 必须另设受控验证通道。」——ADR 0010 L220 已对该预留作出决定（通道 = NamespaceLease ReplicationSession）。
- 失败边界（L54）：「零写入承诺覆盖所有验证失败和 detached 构造失败。Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报。事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback。」
- 取代范围（L50）：「本文关于 logical validation、detached materialization、validated mutation、零写入与 observer no-rollback 的底层决策继续有效。」

### ADR-0006 持久化插件（已接受；含 #64 / #79 修订节）

- 「saveDoc = 脏状态通知，不是同步落盘」（L33）。
- #79 修订节（L190–195）：「saveDoc 是 mutation 后的 dirty notification：只要租约有效（未 released、非 foreign、身份匹配、Persistence 未 disposed），saveDoc 必须递增 dirtyGeneration 并 resolve——entry 处于 `persistence-degraded` 不构成拒绝理由」；「持久层自身仅在租约身份失效……或 disposed 时响亮拒绝」；DocHandle 状态词优先级「`disposed` > `released` > entry 状态（`persistence-degraded` / `ready`）」（L187）。
- 对齐说明（L201–205）：Persistence 契约不因 #131 改变；仍以 `(owner.userId, docId)` 排他创建。

### ADR-0001~0005（已接受）

与本任务无直接条款交集（VFSL 真相源、重写范围、求值器、类型投影、生成管线）。仅 ADR-0001 的 SCHEMA 数据性（信封四键入 doc）构成 scratch-check 的背景。不构成约束来源，不逐条摘录。

## CONTEXT.md 相关术语与惯例

- **写序列器（write sequencer）**（L73–75）：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。」_Avoid_: mutation queue。
- **停接纳（stop-acceptance）**（L83–85）：close 进入 closing 后 capability 槽立即停接纳；read 返回 `RUNTIME_READ_DISABLED`、getter 同步 throw、写经 `RUNTIME_WRITE_DISABLED` 零写入结算；「getStatus 全生命周期可用……不在停接纳范围」「internal fatal 只永久禁写并保留读取，不触发 read/getter 停接纳」。
- **Hub（中心实例）**（L105–107）：「静态星型复制拓扑中接受 peer WebSocket 连接、转发 Yjs updates、管理 SCHEMA 与复制身份的完整 Nomicore 实例；Hub 也是可接受本地 ROOT 业务写的副本，不是 ROOT 唯一写者」。
- **Peer（边缘实例）**（L109–111）：「静态连接唯一 Hub 的完整 Nomicore 实例；使用独立 Persistence，断线时保持本地 ROOT 读写……Peer 之间不直连，且不能本地修改 SCHEMA 或复制身份。」
- **复制谱系（replication lineage）**（L117–119）：「由 `META.replicationId` 标识……只有 namespaceId、replicationId 与 replication epoch 全部匹配的副本才允许直接执行 Yjs state-vector reconciliation。」
- **复制代际（replication epoch）**（L121–123）：「从 1 开始、只由 Hub 显式提升的安全整数；相同复制谱系但 epoch 不同的副本进入冲突状态，必须显式 reset/bootstrap，不自动覆盖或合并。」
- **ReplicationSession**（L125–127）：「由 NamespaceLease 打开的受信任 duplex raw Yjs 复制会话；冻结本地角色、远端实例、复制谱系与 epoch，提供 state vector、diff、owned update subscription 和进入本地唯一 write sequencer 的 trusted apply，但不暴露 live Y.Doc。Host 搭建方负责只把该高级能力交给可信 transport。」_Avoid_: 裸 Y.Doc WS handler、绕过本地 write sequencer 的 apply、把网络状态塞进 Runtime capability status。
- **复制未校验（replication-unvalidated）**（L129–131）：「Trusted raw Yjs update 已在 sequencer 中提交并登记 dirty，但未执行完整 VFSL ROOT 预校验的复制状态；它可能导致后续普通业务写因当前完整 ROOT 不合法而失败，不表示 transaction 可回滚或 raw update 享有 zero-write 保证。」_Avoid_: validated replication、apply 后校验失败自动 rollback。
- **零写入（zero-write）**（L93–94）：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」（raw update 为 ADR 0010 明示例外。）

## Phase-5 文档切片依据（docs/phases/phase-5-websocket-replication.md）

- §交付模型（L37）：「每个 namespace channel 对应本地 Registry Lease 与 duplex ReplicationSession。Transport 不取得裸 Y.Doc；state vector、diff、update subscription 和 trusted apply 都通过 Lease 的正式高级 API 完成。」
- §实施切片 3（L67–73）：openReplicationSession 与每 Lease 最多一个 session 的生命周期；冻结 local role、remote instance、replication identity/epoch；窄能力六项；本地 transaction origin 与远端 connection/channel origin；observer failure 隔离和 `needs-resync` 通知；不暴露 Y.Doc、DocHandle 或 live shared type。
- §实施切片 4（L75–82）：所有远端 apply 进入唯一 write sequencer 并在槽内完成 dirty notification；Hub scratch clone 检查 SCHEMA 与复制身份 META 字段不得变化；Peer 接收 hub ROOT/SCHEMA/允许 META；Peer 本地 `replaceSchema()` 稳定角色权限错误；raw apply 不执行 VFSL 预校验、状态标 `replication-unvalidated`；Hub degraded 拒复制写；peer degraded 只允许 hub→peer 内存 apply 并继续 `saveDoc()`。
- §切片 1 基础合同（L52–58）：status replication 域「不含 session、网络、队列或 sync 状态（后者属 ReplicationSession，切片 3）」；「本 slice 不实现 ReplicationSession」。
- §测试 seam（L181）：「ReplicationSession 使用确定性 Runtime/Persistence seam 覆盖 sequencer、origin、observer failure、degraded bypass 和 close。」
- §非目标（L190–202）：raw update 完整 VFSL 校验或自动 rollback；identity/epoch conflict 自动覆盖；第二种 transport 及提前抽取 transport-independent replication seam 等。

## 现行代码公共面纪律（基线事实，非 ADR 约束，设计须延续或显式裁决演进）

- `packages/namespace-runtime/src/index.ts`：值导出恰一键 `RuntimeWriteFatalError`；测试 seam 与生产工厂保留包内（runtime.ts 模块级导出，不经公共入口）；「handler/Y.Doc/sequencer 永不从本入口出现」；#132 复制管理类型 type-only 追加。
- `packages/namespace-registry/src/types.ts`：主入口可达声明图内不得出现运行时对象/租约句柄命名类型标识符与内部 subpath 字面量；capability alias 以「结构性复制型」公开 alias 表达，与 Runtime 成员逐字段相等由 lease.ts 类型级 Equal 断言锁死；稳定 message 单一真相源 const。
- `packages/namespace-registry/src/index.ts`：公共入口精确导出面（工厂 + 三个错误类 + Cordis plugin 面 + DEFAULT_IDLE_TIMEOUT_MS + 公共类型白名单）；不导出运行时实例、租约句柄、entry/sequencer/observer/testing/internal 类型。
- `packages/namespace-registry/src/lease.ts`：released 逐方法通道表（read 同步 issue / getter throw / getStatus 恒成功 / 四写 resolve released issue）；「一切拒绝经返回的 Promise 结算」。
- `packages/namespace-runtime/AGENTS.md`：「Public APIs expose detached projections only. The owned handle, live Y.Doc, writable roots, sequencer, queue state, production assembly seam, and test seams remain internal.」

---

## 设计后复审追加（issue #134 SA1 设计引入的新决策点；供 SA2/SA3/SA4/SA7 复用）

> SA8 设计后复审 2026-08-28 追加（verdict clear，见 `task_namespace-lease-replication-session_design_conflict_report.md`）。
> 以下为设计冻结、且经复审确认与 ADR/CONTEXT 一致的**新约束**；实施与验证阶段按此执行。

- **Seam（O-2/D-2）**：`@nomicore/namespace-runtime/internal` 值导出由一键（`createNamespaceRuntimeForRegistry`）扩为两键（+`openReplicationSessionCoreForRegistry(runtime, options)` 全同步）；host 经模块级 `WeakMap<NamespaceRuntime, host>` 登记（Runtime 构造期 fanout+host 一次成型，公共对象面仍恰十二键）；消费边界仍仅 `packages/namespace-registry/src/`（审计白名单谓词零改动）；internal 键集锁测试沿该文件头注「精确键集断言由实现时同步演进」既定先例同步演进。
- **O-1 谓词（冻结）**：degraded bypass 唯一例外 = `lifecycle==='ready' ∧ fatal 未置位 ∧ direction==='hub-to-peer'（创建时冻结）∧ handle.getStatus()==='persistence-degraded' ∧ notifyDirty 已绑定`；其余（released/disposed/degraded+peer→hub/closing/closed/fatal/notifier 未绑定）一律 `RUNTIME_WRITE_DISABLED`（码族复用，message 分域——ADR 0008 #93 修订节第 2 条纪律）。
- **apply 槽序 R1–R7（D-3）**：接纳层 A0–A4（revoked→终态→bytes 形状+slice 捕获→lifecycle→enqueue）+ 槽内 R1 fatal→R2 facts 比对（不等→终态 conflicted）→R3 writable(+bypass)→R4 scratch 预演受保护字段→R5 单次 `Y.applyUpdate(doc, bytes, token)`→R5.5 session 标记（rootValidation 只置不清 + memoryCaughtUp）→R6 `await notifyDirty()`（bypass 同样调用；失败→`RuntimeWriteFatalError(committed:true)`）→R7 释放。同一 `WriteSequencer` 实例（INV-S1）。
- **O-4 角色注入（D-8/INV-S14）**：Registry 构造 `options.role`（`'hub'|'peer'`，缺省 `'hub'`，非法值构造期 TypeError `NAMESPACE_REGISTRY_ROLE_INVALID`）；peer 的 replaceSchema/enableReplication/bumpReplicationEpoch 在 Lease 接纳段稳定拒绝（`REPLICATION_ROLE_PERMISSION`，`{ok:false; issues}` 零改形）；session open 校验 `options.localRole === 实例 role`（不等→`REPLICATION_ROLE_MISMATCH`）；direction 派生冻结 `localRole==='peer' ⇔ 'hub-to-peer'`。
- **O-9 生命周期词义（D-7/INV-S10/S11）**：每 Lease 至多一个**活跃**（state==='open'）session，计数在 Lease 层；closed/conflicted 皆终态并释放槽位，终态后同 Lease 可再 open；release 同步段调用既有 `close()`（零新增方法面；幂等 same-promise；已接纳 apply 槽照常排空）；released 后 apply 经包装层前置映射 `NAMESPACE_LEASE_RELEASED`，SV/diff 终态 throw `ReplicationSessionClosedError`（session 域码，不导出 index）。
- **O-10 observer（D-4/D-13/INV-S2/S3/S4）**：每 Runtime 构造期恰一 `doc.on('update')`；同步扇出；回声抑制唯一谓词 `origin === channel.applyOrigin`（symbol token；null origin 本地写恒投全部）；每 listener 每投递独立 `Uint8Array` 副本；listener throw 自捕获计数 `observerFailures`（ADR 0007 L54「记录」面），永不抛入 transaction 栈；本切片无队列（needs-resync 属切片 6——文档同步需补对账注记，设计复审放行条件 C-1）。
- **O-11 status 词汇（D-10）**：`state('open'|'closed'|'conflicted')` + 冻结四域 + `direction` + `currentEpoch` + `rootValidation('none'|'replication-unvalidated')`（只置不清）+ `durability({memoryCaughtUp; diskCaughtUp:false}` 字面量——结构性永不声称 durable（ADR 0010 L139）+ `observerFailures`；getStatus 全生命周期可观测（沿 lease.getStatus 先例）。
- **O-12 受保护字段（D-9/INV-S8，冻结常量）**：判据 (a) 内容投影相等（scratch clone = `new Y.Doc()` + 全量装载 + 装载待审 update；非 primitive 值保守判「已改变」→拒）；hub 侧（peer→hub）SCHEMA 全容器 + **META 全键**（较 ADR 0010 L105 最小集收紧，ADR 增补节登记）；peer 侧（hub→peer）META 全键、SCHEMA/ROOT 放行；peer META 白名单首版空集；raw caller 不可定制（ADR 0010 L121）；畸形字节在 scratch 上同步 throw → `REPLICATION_RAW_UPDATE_INVALID` 零写入。
- **新稳定词汇（§6，append-only 定义点注册）**：runtime——`NSRT-FATAL-REPLICATION-APPLY-INTERNAL`（errors.ts）+ WriteSlot 追加 `'replication-apply'`（既有渲染逐字节不变）+ `REPLICATION_SESSION_CLOSED/EPOCH_CONFLICTED/RAW_UPDATE_INVALID/PROTECTED_FIELDS_CHANGED/SESSION_UNSUPPORTED` 文案；registry——`NAMESPACE_REGISTRY_ROLE_INVALID/REPLICATION_SESSION_INPUT_INVALID/ROLE_MISMATCH/SESSION_EXISTS/ROLE_PERMISSION` const（types.ts 单一真相源）；复用零改名：`NAMESPACE_LEASE_RELEASED`/`RUNTIME_WRITE_DISABLED`（码族+分域 message）/`REPLICATION_NOT_ENABLED`（#132 既有冻结词 errors.ts:174，registry 持结构复制副本）。
- **公共面零突破（D-12）**：runtime `index.ts` 与两侧 `package.json` exports 不动；runtime 值导出仍恰 `RuntimeWriteFatalError` 一键；registry 主入口仅 type-only 追加（InstanceRole/OpenReplicationSessionOptions/Result/IssueCode/ReplicationSession/ReplicationSessionStatus/ApplyResult/ApplyRefusalCode）；`ReplicationSession` 恰十键冻结对象；Equal 锁在 lease.ts（声明图外）对 core/status 双断言。
- **文档同步（D-14/§10）**：ADR 0010 增补节（词汇注册 + hub META 收紧 + O-9 词义 + role 注入 + seam 指针）、ADR 0009 两注记（internal 两键 + Lease 面/通道表）、phase-5 切片 3/4 锚定 + 切片 9 role 必传注记 + **needs-resync 推迟对账注记（复审放行条件 C-1）**、CONTEXT.md ReplicationSession/Hub/Peer 词条扩写；**不改** ADR 0006/0007/0008（T-1 和解按 lex posterior 在 ADR 0010 增补节陈述）。

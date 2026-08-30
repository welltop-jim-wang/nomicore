# 冲突门禁报告（R3 delta 轮）

## Verdict

`clear`

- 被审对象：`wiki/raw/task_phase5-bootstrap-archive-reset-r2_design.md`（SA1 设计 **R3 版**，515 行，当前 worktree `fix/issue-133-on-docs-phase-5-websocket-replication` 版本）。
- 本轮性质：设计后复审 **delta 轮**——仅裁决 R2→R3 增量。R2 版全量复审见前轮 `task_phase5-bootstrap-archive-reset-r2_design_conflict_report.md`（verdict `clear`，override-declared ×3），其裁决继续有效，本轮不重复全量盘点。
- 冲突基准：`docs/adr/` 全集 10 份（逐份完整读取，未抽样）+ `CONTEXT.md`。ADR-0007 中已由 ADR-0008 取代的 Runtime/open/read 条款不作约束；代码（`runtime.ts`/`close.ts`/`internal.ts`/`sequencer.ts`/`registry.ts` 等）仅作事实佐证，不构成裁决基准。
- R3 delta 范围（SA2 R1/R2 reject 驱动的五项增量，本轮唯一裁决对象）：
  1. namespace-runtime **纯内部**能力 `beginResetFence(expected, readPersisted)`（§2 R2-D4a、§3.4、§3.5）＋ §8 解除 `packages/namespace-runtime/src/{runtime.ts,close.ts,types.ts}` 原 DENY；
  2. closing generation 重评估闭环（§3.4 R1-B）；
  3. probe 完整错误分类学（§3.3.1）；
  4. armed 后 archive 失败映射矩阵（§3.5.2）；
  5. 敌意 expected 公共入口冻结（§4.2.1）。

## ADR 盘点

（聚焦 0006/0008/0009/0010；0001–0005、0007 与本轮增量无接触，沿前轮结论。）

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 单一真相源 | accepted | 否 | 沿前轮 no-conflict：delta 不涉及 VFSL、SCHEMA 权威源或投影。 |
| ADR-0002 | 重写定位、authority 出范围 | accepted | 否 | 沿前轮 no-conflict：不引入 authority 规则。 |
| ADR-0003 | 求值器与派生 schema | accepted | 否 | 沿前轮 no-conflict：不改变 evaluate/ROOT/派生 schema 契约。 |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | 沿前轮 no-conflict。 |
| ADR-0005 | 投影生成管线 | accepted | 否 | 沿前轮 no-conflict。 |
| ADR-0006 | Server Persistence docstore | accepted（含 #64/#79/#131 修订节） | 是 | no-conflict（delta 层面）：§3.3.1 probe 错误分类学与 §3.5.2 armed 矩阵延续该 ADR 的 typed 错误演进与 committed 诚实体例；§5.1 修订沿前轮 override-declared 授权框架。 |
| ADR-0007 | 逻辑校验与 Yjs runtime bridge | accepted；Runtime/open/read 部分由 ADR-0008 取代 | 间接 | no-conflict：delta 不触及其仍有效的 logical validation、detached materialization、业务写零写入与 observer no-rollback 条款；fence 槽零 Y.Doc 写、零 observer。 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 #93/#132 修订节） | 是（本轮核心） | **no-conflict**：内部 fence 能力不触其公共规范面——方法枚举、写槽序、close() 全部可观测保证、封装边界、status 面均逐项保持（冲突点 1–4）。 |
| ADR-0009 | NamespaceRegistry、Lease 与 Host 生命周期 | accepted（identity 旧条款由 ADR-0010 修订） | 是 | no-conflict：同 key carrier 串行、按当时事实独立结算、generation 自清理、owner 防泄露、输入校验先于 entry/Persistence 访问、internal subpath 消费边界全部保持（冲突点 3/5/8）。 |
| ADR-0010 | Hub/Peer WebSocket Y.Doc 复制 | accepted | 是（核心） | 前轮 override-declared ×3（reset 次序取代、import 广告核对前移、修订体例；owner feedback 3 授权）维持有效。R3 delta 将 fence 协议规范登记于授权修订 §5.2(2) 内，属同一授权主题（reset 次序/语义）的实现机制细化，未新增未授权推翻。 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | 无 | ADR-0008「单一 write sequencer」：「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer」「v1 公开两个窄方法：mutateRoot/replaceSchema」；#132 修订第 4 条：「基础 v1 方法为两个…另加 enableReplication() 和 bumpReplicationEpoch()。四者均进入同一严格 FIFO write sequencer，完整槽序（lifecycle/fatal gate → … → 单 Yjs transaction → 同步投影 → await notifyDirty()）不变」。 | R2-D4a/§3.4/§3.5：新增内部 `beginResetFence` sequencer 槽——槽内 await persisted probe、读 live 投影、成功则同步 arm closing；零 Y.Doc 写、零 transaction、零 notifyDirty；仅 Registry 经内部 factory 注入。 | no-conflict | (a) 方法枚举条款辖**公共面**（「v1 公开」「公共窄写方法」），ADR-0008 从未封闭内部方法集；(b) 完整槽序条款只适用于真正写任务，fence 槽不写 Y.Doc 故不在其辖域；(c) 非写任务驻留唯一 sequencer 有两个在案先例——P0（ADR-0008「P0 已作为 write sequencer 的真实队首节点入队」，P0 亦非写）与 ADR-0010 trusted raw update 槽（为复制编排定义新槽型/槽序而未修订 ADR-0008）；(d) 唯一 FIFO 未旁路、未新建第二序列器（CONTEXT.md 写序列器 _Avoid_「绕过本地 write sequencer 的 apply」未发生）。 |
| 2 | 无 | ADR-0008「生命周期、状态与所有权」：「close() 幂等。首次调用同步进入 closing，立即停止接纳公共 read 和 write，并在队尾加入 close barrier；此前已接纳任务无条件排空，不取消、不设内部 timeout。barrier 只调用一次 handle.release()；无论 release 成败，Runtime 都进入 closed…后续 close 返回同一个已结算 Promise」；CONTEXT.md「停接纳」。 | §3.4/§3.5(3)(4)：fence 槽核验成功后**同步 arm closing**（不创建/不 await barrier），槽结算后才由 post-settlement continuation 懒创建唯一 close barrier（predecessor tail 在 fence 结算后捕获）；普通 close() 观察 fence-armed closing 时返回同一懒创建 promise、不建第二 barrier。 | no-conflict | close() 全部可观测保证逐项保持：(i) 停接纳在 arm 瞬间同步生效（lifecycle≠ready → `RUNTIME_READ_DISABLED`/`RUNTIME_WRITE_DISABLED` 码族，与 CONTEXT.md 停接纳逐字相容）；(ii) **排空无条件**——fence 前接纳的任务按 FIFO 先于 fence 结算并参与核验样本；arm 之后的调用被接纳层同步拒绝零入队；arm 前接纳于 fence 之后的任务照常排空（代码佐证：runtime.ts 接纳门 D5.1 在 lifecycle ready 期放行、写槽内无 closing 复查）；(iii) barrier 经 sequencer.enqueue 挂队尾、单次 release、无论成败 closed、无 timeout 不变（close.ts：普通 close() 与 lazy continuation 共用 `enqueueCloseBarrier` 与 `closePromise` 幂等缓存）；(iv) 无自等待：依赖图无 `fenceTask → closePromise` 边。ADR 条文规制**公共 close() 行为**，未断言「closing 状态只能经 close() 进入」；内部 admission 路径已规范登记于 owner 授权的 ADR-0010 §5.2(2) 修订。 |
| 3 | 无 | ADR-0008：「Runtime 不公开 handle、Y.Doc、ROOT/SCHEMA/META live 引用或生产构造器。生产工厂保留包内，由未来 Registry 使用」；ADR-0009：「Registry 通过 @nomicore/namespace-runtime/internal 唯一导出的 createNamespaceRuntimeForRegistry 构造生产 Runtime；主 entry 不公开生产 Runtime 构造器。模块边界测试限制该 internal subpath 只能由 Registry 生产代码消费」。 | §3.5.1：`RuntimeForRegistry` 结构能力经既有 Registry-only runtime factory/testing seam 注入，禁止公共 barrel 暴露、禁止进 Registry 公共声明图；§8 解除三文件 DENY 但「不新增公共 META/API 面」。 | no-conflict | 注入走 ADR-0009 冻结的既有 internal factory 通道（代码佐证：internal.ts 唯一值导出 `createNamespaceRuntimeForRegistry`；registry.ts:46 为既有授权消费）；fence 结果联合与 continuation 不暴露 handle、Y.Doc 或任何 live 引用；capability 以 non-enumerable 键挂载、公共 barrel 键集审计锚不漂移；缺失 capability 的 loud branded fatal(false) gate 位于一切破坏性动作之前，无 fallback 无 TypeError。 |
| 4 | 无 | CONTEXT.md「写序列器」：「P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；**读取不进入该序列**」。 | fence 槽内在 sequencer 内读取 live 身份投影（state.replication，与 getStatus 同一真相源）并 await persisted probe。 | no-conflict | 「读取不进入该序列」规制的是**公共 read 通道**的即时性保证（读取不等待写任务、不排队）；fence 不是公共读取能力，而是生命周期编排任务的槽内取样，服务于线性化决策；P0 在槽内读取 SCHEMA 四键为同构先例；公共 read/getter 的零等待行为不受任何影响。 |
| 5 | 无 | ADR-0009：「同 key 的 open、create 和 Runtime generation close 按同步接纳顺序串行…每个操作取得 lifecycle 槽后，根据当时的 Registry/Persistence 事实独立结算；前项的领域失败或 branded rejection 不成为后项结果，也不毒化 queue tail。旧异步操作只能按 entry identity/generation 清理自己，不得删除后来建立的新 entry」；「Registry 在读取 entry 或 Persistence 之前，用共享安全文法校验」（owner mismatch → `NAMESPACE_NOT_FOUND`）。 | §3.4 R1-B closing 重评估：reset 见 closing → await 其**既有** closePromise → carrier 槽重读 entry → 单次非破坏 probe；missing → `NAMESPACE_NOT_FOUND`、primary 仍在 → `NAMESPACE_RESET_FAILED`、零 archive；不把旧 generation 当 live 证据。 | no-conflict | reset 槽在 carrier FIFO 内按接纳顺序串行、结算基于重读后的当时事实（前项 close 的结果不毒化本项）；先前 closing generation 自行清理，本 reset 不删除其后建立的新 entry；owner-first 检查在重读后二次保留，存在性不泄露；NOT_FOUND/RESET_FAILED 分类是 Registry 域结果语义，未被任何既有 ADR 条款冻结，且已在授权的 ADR-0010 §5.2(1) 修订文字登记（「A pre-existing closing generation is awaited/re-evaluated and never treated as a new preflight success」）。 |
| 6 | 无 | ADR-0006 修订体例与错误演进纪律：typed load/create operational error、committed-aware fatal、duplicate 稳定类型；「unknown load exception 不得被降级为运营失败」（ADR-0009 对 Persistence 演进的同构纪律）；「`.snapshot` 是提交态」；ADR-0009：「公开 issue/error message 不包含 owner/namespace 原值…原始异常文本或 stack」。 | §3.3.1 probe 完整错误分类学：`DocPersistedIdentityProbe{Operational,Corrupt,Fatal}Error` 三类全 `committed:false`、稳定 message 零 owner/identity/bytes 回显（cause 仅内部保留）；仅 current-epoch read reject → `NAMESPACE_LOAD_FAILED`；损坏/abort/dispose/adapter-violation → Registry fatal(false)。 | no-conflict | 分类学是 additive typed 演进，延续 ADR-0006 #64/#79 修订体例；corrupt/adapter-violation 走 fatal、不塌缩为 mismatch 或 LOAD_FAILED，精确呼应「unknown 不得降级为运营失败」；`committed:false` 强制与 seam 零写自洽（INV-12）；probe 只读 committed 主快照——其本体已在前轮冲突点 4 裁决 no-conflict，本 delta 仅补错误面，不触 Persistence 公共接口与规范条款。 |
| 7 | 无 | ADR-0006 committed 诚实纪律（#64/#79 体例：committed 事实原样传播、不补偿、不谎报 rollback）；ADR-0010：「身份与 epoch…缺失或不同进入稳定 conflicted 状态，绝不自动覆盖或合并」。 | §3.5.2 armed 后 archive 矩阵：identity/active-handle/duplicate/operational → `NAMESPACE_RESET_FAILED`；fatal 保留 `committedOf(cause)`（尤其 relocate-remove committed:true）；unknown → fatal false；armed 后任何路径禁返回 `NAMESPACE_RESET_IDENTITY_MISMATCH`。 | no-conflict | armed 后 guard 发现 mismatch 时 archive 拒绝 → 零覆盖零合并（conflicted 纪律保持），结果 RESET_FAILED 是诚实领域失败而非伪 preflight mismatch；committed:true 原样传播、不以领域失败伪装（§5.1(4)/§5.2(5) 授权修订登记）。既有 ADR 无任何条款要求 archive guard mismatch 必须映射为 reset identity mismatch——round-1 的代码级映射不是 ADR 条款，改映射不触规范。 |
| 8 | 无 | ADR-0009：「Registry 在读取 entry 或 Persistence 之前，用共享安全文法校验 owner.userId 和 namespaceId」；「输入缺陷仅使当前 create 失败，不毒化 key queue 或整个 Registry」；ADR-0006 层次边界（Persistence 仅校验 `META.docId`）；ADR-0010（identity/epoch 权威、不自动覆盖）。 | §4.2.1 敌意 expected 冻结：`snapshotReplicationIdentityRef` 在**任何** docRef 读取、carrier 创建、entry 查询、Persistence 调用之前执行；getter/Proxy throw 收编、继承属性拒绝；输入 issue 稳定零回显、仅失败当前调用；R2-D6 维持 `importDoc` 无 expected 参数。 | no-conflict | 把 ADR-0009 既有「entry/Persistence 访问前先做输入安全校验」纪律同构延伸到新第四参数；零 doc 访问、零 store 写、零 entry 变更、不毒化后续重试；Persistence 不成为 Hub 广告/授权策略引擎，层次边界保持。 |

## 结论

`clear`。R3 delta 与全部有效 ADR 及 CONTEXT.md 一致；无 hard-violation、无 evolution、无新增 override。

- **实质冲突点数（delta）：0**。
- 裁决分布：no-conflict × 8；override-declared × 0（新增；前轮 ×3 维持有效）；evolution × 0；hard-violation × 0。

### 核心问题逐条回答

1. **Runtime 新增纯内部 fence 能力是否构成 ADR-0008 hard-violation？——否，no-conflict，无需修订 ADR-0008。** 依据归纳：
   - (i) ADR-0008 的方法枚举（「v1 公开两个窄方法」＋ #132 四方法修订）、完整写槽序、close() 条款均规制**公共面与真正写任务**；内部能力不在其辖域，ADR-0008 从未封闭内部方法集（#93 修订第 5 条明示「ADR 记录决策词汇，不复制实现注册表」）。
   - (ii) 唯一 FIFO sequencer、单一 close barrier、单次 release、已接纳任务无条件排空、不取消不设 timeout、dirty-not-durable 语义全部逐项保持（冲突点 1–2）。
   - (iii) 非写 sequencer 槽有 P0 与 ADR-0010 trusted raw update 槽两个在案先例，后者同样未修订 ADR-0008——fence 完全同构。
   - (iv) fence 协议的规范登记位于本轮 owner 授权的 **ADR-0010 §5.2(2)** 修订文字内（reset 次序/语义主题），授权链闭合；§5/§8 未触碰 ADR-0008 文件，与「本轮授权仅覆盖 0006/0010」一致。
   - **可选注记（非合规必需，owner 自由裁量）**：若 owner 欲在词汇上封闭「closing 入口 = close()」，ADR-0008 最小修订面为「生命周期、状态与所有权」节追加一句注记（「closing 亦可经 Registry 受控内部 reset fence 于 sequencer 槽内同步 arm；公共 close() 契约与 barrier 语义不变」）——性质类似 #93 词汇收口注册，不做不构成违规。
2. **「同步 arm closing 先于 close barrier」与 ADR-0008 close() 条款的相容性——相容。** ADR 条文是对公共 close() 行为的规制；fence 路径下 close() 的每项可观测保证（幂等、同一已结算 Promise、停接纳即时、排空无条件、单次 release、无论成败 closed、无 timeout）均保持，arm 与 barrier 创建之间的窗口对外不可观测且无已接纳任务可逃逸排空（冲突点 2）。
3. **closing 重评估、probe 分类学、armed 矩阵、敌意输入冻结与 ADR-0009/0006/0010 的相容性——全部相容**（冲突点 5–8）：carrier 串行/generation 自清理/owner 防泄露保持；typed 错误演进与 committed 诚实体例延续；conflicted 不自动覆盖合并保持；输入校验先于 entry/Persistence 访问的纪律同构延伸。

### 非阻断观察（文档精度，SA2/SA3/SA4 领地，不影响 verdict）

- §3.5(5)「A close barrier drains only tasks admitted before the fence」对「fence 入队后、arm 前接纳」的写措辞不精确：该窗口接纳的写按 ADR-0008 排空条款**照常执行**（接纳层在 lifecycle ready 期放行、写槽内无 closing 复查），其身份变更由 close 后 archive guard ＋ §3.5.2 矩阵收敛为 `NAMESPACE_RESET_FAILED`——行为 ADR 相容且诚实，建议 SA3/SA4 实现与测试显式覆盖该窗口。
- §3.5.1「No Registry source imports a Runtime package internal subpath」与现状（registry.ts:46 经授权消费该 subpath）措辞过紧；ADR-0009 本就允许 Registry 生产代码消费，按「除既有受控 factory 接线外不新增 import」理解即可。

### 范围注记

按本轮指令，SA8 只读代码/ADR/wiki 并产出本报告一份文件；`task_phase5-bootstrap-archive-reset-r2_relevant_decisions.md` 的 delta 追加（如需）由总控另行安排。

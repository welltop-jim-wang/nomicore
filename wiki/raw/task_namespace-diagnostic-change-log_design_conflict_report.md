# 冲突门禁报告 — Issue #150 设计后复审（SA1 设计 vs ADR/CONTEXT）

- 被审对象：`wiki/raw/task_namespace-diagnostic-change-log_design.md`（SA1 设计 R1）
- 冲突基准：`docs/adr/` 全集 11 份（0001–0009、0011、0012，逐份全读；0010 不在本 worktree）+ `CONTEXT.md`（现行）
- 前置门禁：`task_namespace-diagnostic-change-log_conflict_report.md`（verdict: clear）——本复审不重复全量盘点，聚焦设计引入的决策点
- 配套决议清单：`task_namespace-diagnostic-change-log_relevant_decisions.md`（本次已追加「设计后复审追加」节）
- SA8 运行轮次：设计后复审（SA1 R1 之后、SA2 评审之前）

## Verdict

`clear`

## ADR 盘点（设计后复审聚焦：设计决策 vs 各 ADR）

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0011 | Best-effort namespace 诊断变更日志 | accepted | **核心** | no-conflict。设计的 emitter seam（§5.1 纯 `import type` 消费 ADR-0011 §Interface 冻结小接口）、输入三态投影（§6.3.3）、issues 统一投影（§6.3.4）、best-effort 防御表（§6.4）、业务零改动（§9.1）逐条款落地；两处高敏点（全量编码作 committed effect、initStream seam）见冲突点 #2/#3，均裁决 no-conflict |
| ADR-0012 | VFSL 校验的 JSONL 与 framed sidecar 格式（含 #152 first-slice amendment） | accepted | **核心** | no-conflict。operation `namespace-create`、result 判别联合（fatal committed:true 的 `update/unknown` effect）、update-omitted 三值词表不扩、observedAt 注入 Clock、每尝试恰一条 final record、stream 配置本地旁路（plugin.ts 零改动）全部合规；amendment C 接线纪律逐字满足（冲突点 #1） |
| ADR-0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted | **核心** | no-conflict。设计零改动 create 判断/结算/throw 语义（§9.1），结局事实全部摘自既有稳定面（§2.2 表：`REGISTRY_NOT_ACCEPTING`/`NAMESPACE_ALREADY_EXISTS` 四源同码/`NAMESPACE_*` 码族/`runtime-construction` committed:true fatal）；Clock 单读不变量（DC-3）与 createdAt 语义零触碰；observer 词表不加诊断事件 |
| ADR-0006 | 持久化插件与三条目布局（含 #64/#79 修订节） | accepted | 高 | no-conflict。#14 `DOC_DUPLICATE`→同码 rejected、#15 typed operational error→rejected、#16 fatal committed 原样传播，均为 #64 修订节条款的忠实记录；DC-1 槽内 `encodeStateAsUpdate` 以 #64「创建成功前初始完整 snapshot 已提交（Y.encodeStateAsUpdate(doc) 直写）」为可行先例；不触 saveDoc/getStatus 语义 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器（含 #93 稳定码修订） | accepted | 高 | no-conflict。§8.1 合规论证成立：全部 emit/initStream 调用点不进入 NamespaceRuntime write sequencer slot；P0 只读 SCHEMA（§8.2 引用本文 P0 条款）；不发明 Runtime 稳定码（committed 记录无 code，sourceModule 恒 'registry'） |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge 分层（open/read 条款被 0008 部分取代） | accepted | 弱 | no-conflict。#10/#11 结局是 `compileSchemaEnvelope`/`validateLogicalSnapshot`（本文冻结能力）既有结果的 verbatim issues 记录，业务侧零改写（DQ-4 保持）；与被取代部分无接触 |
| ADR-0003 | 求值器与派生 schema | accepted | 弱 | no-conflict。日志不触派生 schema 形状；ROOT 物化纪律仅为背景不变量 |
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted | 弱 | no-conflict。不改 schema 来源/方言冻结/SCHEMA 键名；emission 不复制 SCHEMA 全文（input 策略投影归 adapter，ADR-0011 数据保护面） |
| ADR-0002 | 全新重写，authority 出范围 | accepted | 无 | no-conflict。create 记录不含 authority 类不变式 |
| ADR-0004 | vfsl-protocol 类型协议包 | accepted | 无 | no-conflict。零交集 |
| ADR-0005 | 投影生成管线 | accepted | 无 | no-conflict。零交集 |
| （ADR-0010） | trusted replication | 不在本 worktree `docs/adr/` | 无 | 不构成约束。设计 §1.2 显式排除 `replication-*` operations（归 #155 及后续票），`source` 恒 `{kind:'local'}` |
| CONTEXT.md | 术语与硬性惯例 | 现行 | **核心** | no-conflict。`语义 emission`（producer 只做语义投影，不构造物理字段）、`storage projection`（归 adapter）、`genesis baseline record`（emission/sink 公共面无构造路径，#152 adapter 内部构造——initStream 只供 bytes）、`变更尝试`（被拒请求也记录）、`写序列器`/`P0`/`停接纳`/`createdAt`/`零写入`/`validateLogicalSnapshot` 逐词遵守；update-omitted reason 三值词表未扩 |

被 superseded 终态的 ADR：无（ADR-0007 仅 open/read 条款被 0008 取代且取代范围与设计无接触；全集 11 份对设计均为有效约束）。

## 冲突点

（对照明细；**0 条 hard-violation、0 条 evolution、0 条 override-declared**，全部裁决 no-conflict；J 系列为给 SA2 的裁量复核提示，非门禁事项）

| # | 严重度 | ADR/CONTEXT 条款 | 被审对象（设计）决策 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | 高敏 | ADR-0012 amendment C（规范性）：「任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，**必须位于 NamespaceRuntime write sequencer slot 之外，或在该 slot 已释放之后**；不得在 slot 内执行同步 File adapter `emit`。不满足该条件的接线为不合规，必须由 #149–#151/#155 或后续接线票修复后方可启用。」；ADR-0011：「adapter 慢、失败或队列满都不得延长 write slot 或阻塞 close/shutdown」 | §7/§6.3.5：全部 18 个 emit 插点位于 `create()` 公共入口同步段或 **Registry lifecycle create slot** 调用栈内；`initStream` 在 createDoc resolve 后、factory 前同步调用（DC-2）——即同步 File adapter emit/initStream 运行在 Registry 槽内而非 Runtime 写序列器槽释放后 | no-conflict | 条款主语精确限定「**NamespaceRuntime write sequencer slot**」：create 期（#1–#16）Runtime 尚未构造、其 sequencer 不存在，插点结构性在其外；post-commit 段（#17/#18）emit 运行在 Registry create slot 调用栈，从未进入也从不阻塞 P0/任何写任务的 sequencer slot（P0 结算独立异步、只读 SCHEMA）——「位于 slot 之外」的字面与意图均满足。Registry lifecycle slot 与 Runtime write sequencer 是 ADR-0011 明文并列的两个排序机构（「继续由现有 Registry lifecycle slot 或 namespace write sequencer 决定」），ADR-0011「不得延长 write slot」按 CONTEXT.md 词汇指写序列器槽；amendment 被否方案清单（「允许同步 File adapter emit 在 namespace **write slot** 内执行」）同指 Runtime sequencer。前置门禁 N2 的解释（「create 路径天然在 slot 外；设计须保持该性质，含 post-commit 段」）被设计逐字保持。→ J1 |
| 2 | 高敏 | ADR-0011：「创建成功可记录完整初始 Y.Doc update 作为 `genesis`」；「**后续** committed ROOT、SCHEMA、replication 与 management 记录可携带精确 transaction update……**日志不能通过事务后编码整个文档来冒充「该次 transaction update」**」；「不得把 mutation input、逻辑 diff 或重新执行 VFSL materialization 当作等价的 CRDT 重放载荷」；ADR-0012：「每个新 stream 尽力先记录当前完整 Y.Doc 的 genesis baseline」 | §3.2/§6.3.5：成功提交的 attempt 记录携带 `result: committed + effect:'update' + updateBytes` = `encodeDetachedState(initial.doc)` 全量 state bytes（SA6 冻结：「create 事务无 pre-state，对空 Y.Doc 应用即全量物化——精确 effect，无 #149 增量基态问题」）；同一 bytes 副本经 initStream 供 genesis | no-conflict | 「不得冒充」条款由上文「**后续** committed ROOT、SCHEMA/replication/management 记录」限定范围——针对后续变更中全量编码 ≠ 该次增量 update 的情形；create 的初始事务无 pre-state，全量 state 编码在数学上即该事务的精确 effect，不属「冒充」；genesis 面全量编码被「创建成功可记录完整初始 Y.Doc update 作为 genesis」+ ADR-0012 genesis baseline 条款显式授权。bytes 为 detached owned bytes（slice 独立副本、所有权移交），非 mutation input/逻辑 diff/materialization 重放 |
| 3 | 高敏 | ADR-0011 §Interface：「业务模块依赖一个小的内部 emitter interface，而不依赖日志存储实现」；「完整**查询、导出、重放、保留与健康检查**属于日志存储/工具模块的 interface，**不扩张 `NamespaceRuntime`、`NamespaceLease`、`DocPersistence` 或 replication wire interface**」；CONTEXT.md `genesis baseline record`：「v1 冻结的 emission/sink 公共面无构造路径，由 #152 adapter 内部构造」 | §3.1/§5.1：Registry 注入 seam 为 `NamespaceRegistryDiagnosticLog = { emitter; initStream?(namespaceId, genesisUpdateBytes?): void }`——emitter 之外新增一个 stream 建立缝函数类型 | no-conflict | initStream 是 genesis bytes 的 Host→adapter 供给缝（ADR-0012「每个新 stream 尽力先记录当前完整 Y.Doc 的 genesis baseline」要求存在建立路径），不属五项保留能力（查询/导出/重放/保留/健康检查）中任何一项；挂点为 `CreateNamespaceRegistryOptions`（构造 options），非四项被禁扩张接口（Runtime/Lease/DocPersistence/replication wire）中任何一项；genesis-baseline record 构造仍独占于 adapter 内部（设计 §6.3.5「Registry 不代发、不伪造」，CONTEXT.md 词条未触碰）；ADR-0012「日志启用与配置是本地 **Host/Registry** 旁路状态」明文容认 Registry 旁路。emitter 依赖本身是 ADR-0011 §Interface 的直接兑付（纯 `import type`，DC-5） |
| 4 | 中 | ADR-0011 阶段词表（8 值封闭，「至少保留」）：`identity`「复制谱系、epoch 或 namespace identity 不满足」、`acceptance`「Registry/Lease/Runtime lifecycle、角色或授权在接纳前拒绝」、`schema-compile`「proposed schema 编译失败」；「每条结局记录保留所属模块已有的稳定 code、phase、issues 顺序与 committed 事实；日志层不得发明 retryable、rollback 或成功语义」；ADR-0012：「顶层诊断 `stage` 使用日志 schema 的封闭枚举」 | §6.2 映射裁量：#2 入口 identity/形状拒绝 → `identity`；#4–#6 closing-entry fatal → `acceptance`；#9/#12/#13 create-document 编排段（含 Clock fatal、internal throw）→ `schema-compile` 伞形投影 + `sourcePhase:'create-document-internal'` 携带精确 phase；#16 createDoc 栈内 → `transaction` | no-conflict | 词表封闭性逐点保持（8 值内投影、零新值）；`identity` 条款原文含「**namespace identity 不满足**」，入口 descriptor-only 身份检查语义正合（零 getter 执行）；closing fatal 属「Registry lifecycle 在接纳前拒绝」的 `acceptance` 原文域；伞形投影的精确事实由 code/sourcePhase/committed 三通道携带，满足「保留已有 code、phase……事实」条款；阶段选择的最优性属 SA2 攻击面，非 ADR 冲突 |
| 5 | 中 | ADR-0011 best-effort：「日志允许缺失、乱失尾部……不承诺 exactly-once」；ADR-0012：「`observedAt` 由完成操作的 producer 使用注入 Clock 生成 UTC ISO 8601」（record schema 必填，`RE_ISO_MS` 校验）；CONTEXT.md `语义 emission`：「update-omitted 稳定 reason 受控词表（v1）：`payload-too-large` / `update-capture-disabled` / `empty-update`——新增 reason 属词表演进，须过设计评审」 | DC-3/§6.3.2：clock fatal（#9）→ emission 整体丢弃（不伪造时间戳）；早期路径 clock 故障 → 丢弃；§6.3.5：成功路径 encode 失败（不可达防御）→ emission 丢弃而非发明新 update-omitted reason；initStream 仍调用传 `undefined` | no-conflict | 三处「诚实缺席」均由 best-effort 缺失许可覆盖；observedAt 为必填字段且 clock 故障下无合法来源，丢弃是唯一不伪造选项（不可能发出无时间戳或假时间戳的合法 record）；拒绝扩 update-omitted 词表恰是对 CONTEXT.md 词表冻结纪律的遵守（ADR-0012「genesis 未成功写入时 stream 仍可记录诊断事实」覆盖 initStream 传 undefined）→ J3 |
| 6 | 中 | ADR-0009：「`META.createdAt` 由 `new Date(ctx.clock.now()).toISOString()` 生成」；「首次 shutdown……两者统一返回 `REGISTRY_NOT_ACCEPTING` 且**不访问输入**」；ADR-0011 envelope 条款：「在受控快照成功前，只能记录 operation、attemptId、受控 identity、**时间**、source、correlation 等不读取业务 payload 的 envelope」 | DC-3/§6.3.2：槽内结局复用 createdAt 字符串（零额外读数，`clock.calls === 1`）；Clock 步之前终结的尝试诊断侧单次读 clock；停接纳拒绝的 emission 记录 observedAt（读 clock，不触 payload） | no-conflict | clock ≠ 输入：「不访问输入」约束的是调用方 payload，observedAt 生成只读注入 Clock 且为 ADR-0011 envelope 条款明文许可项（「时间」在列）；createdAt 生成路径与语义零改动；早期路径的诊断侧读数不触任何 ADR 禁令 |
| 7 | 中 | ADR-0011 fatal 条款：「`fatal`：……必须携带现有错误通道已知的 `committed` 事实；若事实未知，沿所属操作既有契约记录保守事实，不由日志层重新分类」；ADR-0009：「Persistence fatal 的 committed 事实原样传播；unknown exception 不能伪装为运营失败」 | §6.2 #16：`DocCreateFatalError`/unknown throw → `committed` 原样传播（`cause.committed ?? false`）；#12：`committed = cause.committed`（DocRuntimeFatalError 判定）；#18：factory throw → `committed:true` + 同一初始文档 bytes（ADR-0009「以 committed:true Registry fatal reject」既有通道的忠实记录）；#16 committed:true 防御路径不建 stream（Host 可经延迟初始化补建） | no-conflict | committed 事实全部原样传播、零重分类（与 ADR-0009「已提交 create 不能被误报为普通可重试失败」同向）；#16 不 initStream 属 best-effort stream 建立的裁量（ADR-0012 延迟初始化条款显式放行），无条款要求每次 committed 结局必建 stream |
| 8 | 中 | ADR-0009：「公开 issue/error message 不包含 owner/namespace 原值、SCHEMA 全文、ROOT/input 数据、原始异常文本或 stack」 | §6.3.3/§6.3.4：emission 携带槽内 frozen snapshot `{schema, root}` 与 verbatim issues 投影；业务结果中的 issues verbatim 透传零改动（DQ-4） | no-conflict | ADR-0009 约束的是**公开 issue/error 面**（设计零改动）；诊断日志数据面是 ADR-0011（后立、显式「不修改 ADR 0009」）授权的独立通道，其敏感数据治理由 ADR-0011 数据保护条款 + ADR-0012 input policy（默认 digest、full 须 Host 明确启用）承载——producer 只供语义，策略投影归 adapter |
| 9 | 低 | ADR-0012：「日志启用与配置是本地 Host/Registry 旁路状态，不写入 namespace `SCHEMA`、`META` 或 `ROOT`，也不随 Hub/Peer 复制」 | §1.2/§5.2：经 `createNamespaceRegistry` 编程面 options 注入；`plugin.ts` 零改动（DENY LIST，config 键集 `{idleTimeoutMs?}` 冻结）；不写 SCHEMA/META/ROOT | no-conflict | 编程面注入即「本地 Host/Registry 旁路状态」的直接形态；插件路径 = 日志禁用，行为与既有逐位一致 |
| 10 | 低 | ADR-0011 时序：「emitter 不被 `await`」；「acceptance 前拒绝在对应公共入口记录；已接纳操作在取得既有槽后记录真实 gate、snapshot、validation 和 transaction 结局」；「日志不得引入第二个业务排序机构」；ADR-0012：「首版默认每次变更尝试只写一条最终 attempt record，不写 attempt-started」；「attemptId……缺失时使用 128-bit CSPRNG 生成」 | §4/§6.3.1/§6.3.5：每尝试恰一条 final emission（emit try/catch 吞没、恰一次不重试、恒同步 void）；插点 #1/#2 在公共入口、#3–#18 在槽内真实结算点旁；attemptId 省略由 emitter 管线 CSPRNG 生成；`initStream` 恒在 emit 之前、二者均在 create Promise 结算前完成（SA6 契约不锁定先后） | no-conflict | 逐句对应；initStream 先于 emit 的固定次序与「stream 先立、attempt 随后」语义不触任何 ADR 次序条款（ADR-0012 sequence 分配在 writer append 侧） |

### 给 SA2 的裁量复核提示（非门禁阻塞，不构成冲突）

- **J1（#1 的论证精度）**：设计 §8.1「slot 不因日志延长（emit 是有界同步操作）」把「数据量有界」说成「槽不延长」——ADR-0012 amendment 自己承认「有界」不含文件系统延迟上界。合规性**不依赖**该论证而依赖调用点位置规则（全部在 Runtime sequencer slot 外，成立）；但 Registry create 槽内同步 File I/O 在病态文件系统下的产品可接受性，属 SA2 全维攻击面。
- **J2（#4 的投影编码）**：DC-4 对 vfsl envelope issue code 合成前缀 `VFSL-ENV-E{code}` 是既有 code 的**表示层投影**（order 保留、message verbatim），非新语义码、非 retryable/rollback/成功语义；但命名纪律与诊断包 `RE_STABLE_CODE` 匹配的最终核验属 SA2/SA4。
- **J3（#5 的可观测缺口）**：#9 clock fatal 是真实 fatal（`create-document-internal`、committed:false）却零诊断痕迹——observedAt 必填 + clock 故障使丢弃成为唯一诚实选项，best-effort 许可成立；SA2 可探是否存在不伪造时间戳的替代记录形态（现 ADR-0012 record schema 下不存在）。

## 结论

**Verdict: `clear` —— 放行（设计后复审通过，可进入 SA2 评审）。**

- 冲突点 10 项对照（含 3 项高敏：write-slot 接线纪律、全量编码作 committed effect、initStream seam），**0 条 hard-violation、0 条 evolution、0 条 override-declared**。设计是 ADR-0011 覆盖范围 create 条款 + ADR-0012 genesis/stream 条款在 Registry create 路径的接线落地，全部结局事实复用 ADR-0006/0007/0008/0009 既有通道，未推翻、未实质修订任何既有决策。
- 三项高敏点的共同裁据：ADR-0012 amendment C 的规范性条款主语精确限定为「NamespaceRuntime write sequencer slot」且明文点名 #150 为须满足该纪律的接线票（隐含存在合规接线形态）——设计把全部调用点置于该槽之外（含 post-commit 段），字面与意图均满足，并与前置门禁 N2 钉子逐字一致；ADR-0011「不得冒充 transaction update」由「后续」限定词明确排除 create；initStream 不属 ADR-0011 §Interface 五项保留能力、不挂四项被禁接口、genesis 构造仍独占 adapter（CONTEXT.md 词条）。
- 词表封闭性全项保持：stage 8 值 / operation 6 值 / result 判别联合 / update-omitted reason 3 值 / 既有稳定码族——零新值、零新码（`sourceModule:'registry'` 为标注非新码）。
- 无需 Jim 裁决事项；无 override 需要登记；J1–J3 移交 SA2 作攻击面提示。

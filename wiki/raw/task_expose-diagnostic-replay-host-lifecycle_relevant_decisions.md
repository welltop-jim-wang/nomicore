# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（审任务简报 `wiki/raw/task_expose-diagnostic-replay-host-lifecycle.md`，Issue #155，feature）。
> 只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> **恢复复核对（2026-09-03，总控恢复运行触发）**：`docs/adr/` 13 文件 + `CONTEXT.md` 全量重读，`git diff` 证明基准与 HEAD 一致、worktree 零改动；本清单全部摘录逐条比对 ADR 原文无出入，约束集不变。简报追加的「SA6 红灯契约记录」附录经对照无新增冲突（对照明细见 `…_conflict_report.md`「简报附录对照」节）；本清单红线对 SA3 落地/SA4/SA7 复审阶段继续生效。
> ADR 全集 = `docs/adr/` 下 13 个文件（0001–0012），逐个全读。**编号撞号注记**：目录中存在两个 ADR-0012——`0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`（下称 **ADR-0012-LOG**，本任务主规范）与 `0012-instance-identity-and-websocket-plugin-ownership.md`（下称 **ADR-0012-INSTANCE**）。两者均为 accepted、均构成本门禁基准；引用时须以标题区分。
> 本任务被 ADR-0012-LOG 首切片 amendment 明文点名为接线修复票之一（「不满足该条件的接线为不合规，必须由 #149–#151/#155 或后续接线票修复后方可启用」）——本票是诊断日志能力从 adapter 走向 Host/Registry 暴露面的收口票。

## 相关 ADR

### ADR-0011 Best-effort namespace 诊断变更日志（accepted）——本任务主规范之一：产品语义总纲

#### A. 产品契约与业务隔离（本任务「Host/Registry observability 旁路」定位的依据）

- 与本任务的关联点：本任务把诊断日志暴露为 Host/Registry 可配置的本地 observability；日志一切故障面对业务面的隔离要求由此节规定。
- 核心条款（原文摘录）：
  - 「Nomicore 提供可选的 **namespace 诊断变更日志**。启用与否在 namespace 创建时确定；启用后，系统从创建尝试开始，尽力记录该 namespace 的创建及每次可能修改 Y.Doc 的变更尝试，包括成功提交、预期拒绝与 internal fatal。」
  - 「日志 emit、排队、持久化、背压、丢弃或关闭失败不得改变业务操作的返回值、rejection、提交事实、sequencer 顺序或 Runtime 状态；」
  - 「日志不得成为 `createDoc`、Yjs transaction、dirty notification 或 replication ACK 的成功前置条件；」
  - 「日志实现不得因失败将 namespace 标记为 fatal、persistence-degraded 或只读，也不得触发业务请求重试；」
  - 「日志 adapter 必须以 non-throwing、有界、非阻塞的 emitter seam 接收记录。Runtime/Registry/复制实现仍防御 adapter 违约；adapter 同步 throw 或异步失败均被隔离，并只进入独立的日志健康 metrics/observer；」
  - 「日志队列溢出可以丢弃记录。实现应尽力上报 dropped count、sink failure 和 queue health，但这些健康信号本身也不构成日志完整性证明。」——本任务 AC 的「inspect health」即此健康面。

#### B. Committed update 与诊断性重放五条件（本任务 AC4/AC5 的直接依据）

- 与本任务的关联点：本任务核心交付「strict diagnostic replay + complete/partial/failed 诚实报告」的成功判定条件由本节冻结。
- 核心条款（原文摘录）：
  - 「对 committed transaction，日志可携带该 transaction 产生的 owned Yjs update bytes；它是诊断性重放的权威 effect，结构化 input 只表达请求意图。不得把 mutation input、逻辑 diff 或重新执行 VFSL materialization 当作等价的 CRDT 重放载荷。」
  - 「创建成功可记录完整初始 Y.Doc update 作为 `genesis`。……日志不能通过事务后编码整个文档来冒充“该次 transaction update”。底层 transaction 模块应在不暴露 live Y.Doc 的前提下返回或投递 owned bytes。」
  - 「只有同时满足以下条件时，工具才可声明一次 **诊断性重放成功**：1. 有可用 genesis；2. 所选 stream 的 committed records 按 emitter sequence 连续；3. 每个非-noop committed record 都携带可解码的 Yjs update；4. 未观察到已知 gap、截断、损坏或不兼容 record version；5. 重放后的受控 identity 与请求目标一致。」
  - 「即使满足这些条件，也只证明工具重放了所持有的日志；best-effort emitter 可能在无法留下 gap 记录时丢失数据，所以日志不能单独证明与生产 namespace 完全一致。」——「best-effort disclaimer」的原文出处。

#### C. Interface 与 seam（暴露面不扩张业务 interface）

- 与本任务的关联点：本任务在 Host/Registry 暴露配置/健康/重放，但不得把它们塞进 Runtime/Lease/Persistence/replication wire interface。
- 核心条款（原文摘录）：
  - 「完整查询、导出、重放、保留与健康检查属于日志存储/工具模块的 interface，不扩张 `NamespaceRuntime`、`NamespaceLease`、`DocPersistence` 或 replication wire interface。一个日志 adapter 不构成新的 Persistence 真相源；snapshot Persistence 与诊断日志独立演进。」

#### D. 时序与 sequencer（本任务 AC3 bounded drain 与接线位置的依据）

- 与本任务的关联点：日志接线不得进入业务排序机构；shutdown drain 有界。
- 核心条款（原文摘录）：
  - 「变更尝试的业务排序继续由现有 Registry lifecycle slot 或 namespace write sequencer 决定，日志不得引入第二个业务排序机构；」
  - 「adapter 慢、失败或队列满都不得延长 write slot 或阻塞 close/shutdown；Host shutdown 可 best-effort drain 日志，但 Registry/Persistence 的停止不得无限等待日志 sink。」——本任务 AC3「cannot indefinitely delay Registry or Persistence shutdown」的原文出处。

#### E. 数据保护（Host 配置暴露面的敏感数据纪律）

- 核心条款（原文摘录）：
  - 「默认不记录 token、凭证、原始 Authorization、完整 Error stack、任意 cause 文本或未经控制的 transport payload；」
  - 「`full` 输入与 committed Yjs update 必须由 Host 明确启用，并继承 namespace 数据相同或更严格的访问控制、保留期和加密策略；」
  - 「日志字段不得进入默认低基数 metrics label。」

### ADR-0012-LOG VFSL 校验的 JSONL 与 framed sidecar 诊断日志格式（accepted）——本任务主规范之二：存储、generation、配置冻结与 replay 契约

#### A. Stream 与 generation（本任务 AC1/AC2 的直接依据）

- 与本任务的关联点：日志启用配置是本地旁路状态；冻结/可调二分决定哪些策略变化新建 generation。
- 核心条款（原文摘录）：
  - 「日志启用与配置是本地 Host/Registry 旁路状态，不写入 namespace `SCHEMA`、`META` 或 `ROOT`，也不随 Hub/Peer 复制。初始化失败不影响 namespace create；独立健康 observer 上报 `LOG_STREAM_INIT_FAILED`。后续重试成功时以当时 Y.Doc 建立新 stream，其 genesis 只代表从该时点开始，不能伪称从 namespace 创建时起连续。」——本任务 AC1 的原文出处（Hub/Peer 独立启用即各实例本地旁路配置的自然推论，ADR-0010 静态拓扑下 Hub/Peer 是不同实例）。
  - 「正常重启继续健康 stream；首次启用、旧 stream 无法安全续写、冻结配置改变、显式 rotate/reset 时建立新 stream。每个新 stream 尽力先记录当前完整 Y.Doc 的 genesis baseline，使该 stream 可独立诊断性重放；genesis 未成功写入时 stream 仍可记录诊断事实，但不得声称完整重放。**工具不自动串联多个 generation。**」
  - 「影响记录解释的配置在stream创建时冻结；包括record/schema/frame版本、committed update capture、input capture policy、inline threshold与line上限。冻结项改变时新建stream generation。retention、queue容量、batch/flush策略、fd cache与metrics sampling可动态调整。」——本任务 AC2「Stream-format policy changes create a new generation, while retention, queue, batching, flush, file-descriptor, and metrics tuning can change without altering record interpretation」的原文出处。

#### B. 首切片 Amendment——write-slot 外接线强制（本票被点名的合规条件）

- 与本任务的关联点：**ADR-0012-LOG 明文点名 #155 为接线修复票**；SA1 设计的 emit 调用点位置是本票硬约束。
- 核心条款（原文摘录）：
  - 「每个 `emit` 在调用栈内执行至多一条 final JSONL record 的有界同步 append；若其携带 sidecar，则额外执行至多一帧 BIN append，顺序为 BIN-first。该首切片不维护 writer queue、不做 batch flush、不提供 fsync 开关，也不保持常驻 file descriptor。」
  - 「此处「有界」仅指 adapter 主动处理的数据量与操作数量受配置 payload/line limits 和单-record/单-frame 范围限制；它**不**表示底层文件系统延迟有时间上界，亦不表示 `emit` 可在任意调用点不阻塞。**任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot 之外，或在该 slot 已释放之后；不得在 slot 内执行同步 File adapter `emit`。** 不满足该条件的接线为不合规，必须由 #149–#151/#155 或后续接线票修复后方可启用。」
  - 「queue/batch 是目标演进形态而非与首切片并列的当前要求：未来切片可在不改变 emitter 公共 seam、record schema、manifest policy 或上述 write-slot 隔离条件的前提下，以每 stream 至多一个逻辑 writer queue 替换同步 append，并采用有界队列、drop/health 语义和周期 batch flush；该切片须另行定义 close/shutdown、flush、队列满与 fsync 配置语义。**retention、queue 容量、batch/flush 策略、fd cache 与 metrics sampling 可动态调整**的既有条款对首切片继续成立（首切片未提供即可调整项，仅指未来切片）。」——若本任务实现引入 queue/batch（AC2/AC3 的措辞属目标态语义：这些项**不是**格式策略、改变不新建 generation），必须满足「不改变 emitter 公共 seam、record schema、manifest policy 或 write-slot 隔离条件」并另行定义 close/shutdown、flush、队列满语义。
  - （被否方案，接线红线）「**允许同步 File adapter `emit` 在 namespace write slot 内执行**：慢文件系统仍可无限延长业务写槽，直接违反 ADR 0011/0008 的业务隔离。」、「**现在直接实现异步 queue/batch 以回避文本修订**：会引入内存—磁盘状态、关闭/flush/队列满和 EISDIR 恢复语义，超出首切片纪律（本 ADR 修订仅记录取舍，演进留后续切片）。」

#### C. Writer 与 shutdown（本任务 AC3 的直接依据）

- 核心条款（原文摘录）：
  - 「File adapter沿用单进程独占根目录的部署约束，不实现跨进程锁；**多 Runtime generation 共享 namespace stream 的同一 writer queue，stream不绑定 Runtime generation**。文件句柄可由LRU管理。」——本任务 AC3「Multiple Runtime generations share one ordered namespace writer」的原文出处。
  - 「shutdown可best-effort drain，但不得无限等待日志 sink或阻塞Registry/Persistence停止。」
  - （验收门槛）「12. Runtime reopen/多generation仍经单writer有序append；」「13. Host shutdown不无限等待日志；」

#### D. Strict reader 与诊断性 replay（本任务 AC4/AC5 的直接依据）

- 核心条款（原文摘录）：
  - 「默认strict reader对每条record执行JSON parse、VFSL validation及storage/frame交叉校验。显式metadata-only或unsafe-fast模式可用于检查/导出，但不得声称可重放；**replay强制strict**。」
  - 「未知VFSL dialect、record format、frameVersion或payloadType使该stream为incompatible；reader可展示manifest和原始文件元数据，但不得近似解释、跳过未知记录后继续声称连续。不同stream互不连带。」——「incompatible formats → partial/failed」的原文出处。
  - 「replay不暴露live Y.Doc，只返回owned snapshot bytes与结构化报告：
    ```ts
    {
      status: 'complete' | 'partial' | 'failed'
      lastAppliedSequence: string | null
      issues: ReplayIssue[]
      snapshot?: Uint8Array
    }
    ```
    只有存在有效genesis、records连续、所有必要updates可解码且校验通过、无已知gap/截断/损坏/不兼容，并且重放后受控identity匹配时才能返回complete。retention裁剪、update omitted、缺genesis或generation断裂只能返回partial/failed。即便complete也只证明重放了该best-effort stream所持有的记录，不证明与生产namespace完全一致。」——本任务 AC5 的逐项出处（missing genesis / omitted updates / retention cuts / gaps / corruption / identity mismatch / incompatible formats → partial/failed；best-effort disclaimer）。

#### E. Retention 与日志生命周期独立性（AC1「不写入 Persistence snapshots」/ AC6「retention」场景的依据）

- 核心条款（原文摘录）：
  - 「File adapter内置可配置retention，默认：maxAge = 30 days；maxBytesPerNamespace = 1 GiB。两者先到者生效；显式`null`关闭某个限制，`0`不表示无限。retention只删除已关闭且没有reader lease的segment group，绝不删除当前open group。」
  - 「日志生命周期不与namespace snapshot Persistence自动绑定。」——日志文件独立于 ADR-0006 的 `{namespaceId}.snapshot`，不构成 Persistence 快照内容。
  - 「Host执行数据删除请求时必须同时调用日志删除能力。」

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted）——接线位置约束的权威

- 与本任务的关联点：emit 调用点与 write sequencer slot 的隔离（ADR-0012-LOG amendment 引用的正是 ADR-0011/0008 业务隔离）；Runtime close 的 barrier 语义约束 drain 时点。
- 核心条款（原文摘录）：
  - 「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer；不同 namespace 可并行。」
  - 「`close()` 幂等。首次调用同步进入 `closing`，立即停止接纳公共 read 和 write，并在队尾加入 close barrier；此前已接纳任务无条件排空，不取消、不设内部 timeout。」——日志 drain 不得挂进该 barrier、不得阻塞其排空。
  - （#132 修订）「四者均进入同一严格 FIFO write sequencer，完整槽序（lifecycle/fatal gate → `DocHandle.getStatus()` writable gate → 输入校验 → 领域事实读取 → 单 Yjs transaction → 同步投影 → `await notifyDirty()`）不变。」——同步 File adapter `emit` 不在此槽序任何一步之内。

### ADR-0009 NamespaceRegistry、调用方租约与 Cordis Host 生命周期（accepted）——Host shutdown 与 Runtime generation 语义

- 与本任务的关联点：本任务 AC3 的「Multiple Runtime generations」（close 后 reopen 建立新 generation）与「Registry shutdown 不得被日志无限延迟」由本文规定。
- 核心条款（原文摘录）：
  - 「idle 期间 open 同步取消 timer、转回 active 并签发 lease。若 timer callback 先同步将 entry 转为 closing，则该转换不可逆；后续 open 等待同一个 close Promise 结算，再 load 并建立新 generation。」——Runtime generation 语义来源。
  - 「首次 shutdown 在调用栈内同步进入 `shutting-down` 并停止接纳 open/create；……shutdown 取消全部 idle timer，等待此前已接纳的 lifecycle 操作结算，然后主动 close 全部 active/idle Runtime，不等待外部 lease release。Runtime close 自己排空已接纳写。」——日志 bounded drain 窗口必须与该流程兼容（best-effort、可放弃）。
  - 「Plugin用一个有序 async disposer等待 Registry shutdown后再撤销service。」
  - （v1 公共面）「v1不公开list、entry status、lease count、queue、timer handle、explicit eviction、按key close或公共events。」——日志暴露面不得经 Registry 公共面扩张。

### ADR-0010 Hub/Peer WebSocket Y.Doc 复制与最终一致（accepted）——Hub/Peer 独立启用与停止顺序

- 与本任务的关联点：AC1「不写入 replication wire state」与「Hub and Peer 独立启用」的拓扑依据；AC3 drain 窗口嵌在既定停止顺序内。
- 核心条款（原文摘录）：
  - 「每台机器使用自己的 Persistence」；「hub 与 peer 都运行完整 Registry、Runtime 和独立 Persistence」——Hub/Peer 是独立实例，各自本地启用日志（ADR-0012-LOG「不随 Hub/Peer 复制」）。
  - 「停止顺序为：复制插件停止接纳连接/target，先发送 GOAWAY 并进入真实 drain 窗口；……随后 Registry shutdown、Persistence dispose，最后停止 Timer/Clock。」——日志 drain 必须有界，不得阻塞该链中 Registry shutdown / Persistence dispose。
  - 「Token、Yjs update、SCHEMA/ROOT 内容以及未经控制的 owner/namespace 不得出现在默认日志或高基数指标标签中。」——日志健康/metrics 暴露面的数据保护与 ADR-0011 数据保护节叠加生效。

### ADR-0012-INSTANCE 实例身份单一真相与 WebSocket plugin 所有权（accepted，issue #204 已实现）——Host 生命周期所有权边界

- 与本任务的关联点：本任务暴露「Host lifecycle configuration」；日志配置是 Host/composition root 旁路，不得改变 Registry/Persistence/WS plugin 的所有权与 teardown 分工。
- 核心条款（原文摘录）：
  - 「Composition root 拥有 Instance、Clock、Timer、Persistence 与 Namespace Registry 的创建、配置和最终 teardown」——日志 adapter 的配置与 drain 属 composition root/Host 侧职责。
  - 「Fiber dispose 只 drain/close WebSocket plugin 自身资源并撤 service；上游 Registry/Persistence 生命周期由其拥有者处理。」——日志能力不属 WS plugin，其 dispose 不涉及日志；日志 drain 的有界窗口由其拥有者（Host）负责。
  - 「第一版静态网络、认证、授权、limits/timeouts/backoff 配置 restart-only；仅 targets 支持运行期 add/remove。」（类比参照，非直接条款）——本任务的「非格式策略可调」粒度以 ADR-0012-LOG 冻结/可调二分为准，与本条无交集。

### ADR-0006 Cordis 持久化插件 DocPersistence（accepted）——Persistence 独立性

- 与本任务的关联点：AC1「不写入 Persistence snapshots」；日志目录与 snapshot 布局互不侵入；Persistence dispose 不被日志 drain 阻塞。
- 核心条款（原文摘录）：
  - 「持久层内部的 flush 在触发时以 `Y.encodeStateAsUpdate(doc)` 编码**完整 Y.Doc 状态**，写入 `{namespaceId}.snapshot.tmp` 后以原子 rename 覆盖 `{namespaceId}.snapshot`。」——snapshot 内容仅 Y.Doc 三条目（SCHEMA/META/ROOT），日志配置/状态不进入。
  - ADR-0012-LOG 布局（`namespaces/{namespaceId}/current.json` 等）为日志 adapter 自有目录，与 `{rootDir}/users/{userId}/{namespaceId}.snapshot` 分离；「日志生命周期不与namespace snapshot Persistence自动绑定」。
  - 「dispose 时释放文件句柄、后台任务和 Y.Doc 缓存；宿主负责按依赖逆序停止插件。」

### 其余 ADR（不直接相关，仅登记）

- **ADR-0001**（VFSL 单一真相源）：无本任务直接条款；间接相关——ADR-0012-LOG 的 record schema 是内建冻结 VFSL schema（`nomicore.namespace-diagnostic-change-record@1`），本任务不得为日志另建仓内 schema 文本通道。
- **ADR-0002**（重写定位、authority 出范围）：无关联条款。
- **ADR-0003**（求值器与派生 schema）：无关联条款。
- **ADR-0004 / ADR-0005**（类型投影与生成管线）：无关联条款——本任务消费面为日志工具/Host 配置，不涉及 PathAt 投影写路径。
- **ADR-0007**（逻辑验证与 Yjs bridge）：间接相关——「Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报」与日志 emitter 隔离同族；replay 构造 detached Y.Doc 属离线工具行为，不触碰本 ADR 的 live 写管线。

## CONTEXT.md 相关术语与惯例

- **namespace 诊断变更日志**（原文）：「从 namespace 创建开始尽力记录所有变更尝试及其结构化结局的可选 observability 流；连续的 committed Yjs updates 可用于诊断性重放，但日志不参与业务提交、不承诺完整性或恢复能力。」_Avoid_: 审计账本、WAL、event sourcing、可靠恢复日志。
- **变更尝试**（原文）：「一次可能修改 namespace 的请求及其结局；结局区分 committed、rejected 与 fatal，并标明 acceptance、capability gate、input snapshot、validation 等阶段。被拒请求也属于变更尝试，即使它从未读取输入或进入 transaction。」
- **诊断日志 stream generation**（原文）：「一个 namespace 的一代独立诊断日志，包含不可变 manifest、VFSL 校验的分段 JSONL records 与可选 framed binary sidecar；冻结格式或策略改变、旧 stream 损坏或无法安全续写时建立新 generation，各 generation 不自动拼接重放。」_Avoid_: Runtime generation、replication epoch、跨 generation 隐式连续日志——**术语纪律：AC2 的 generation 是 stream generation，AC3 的 "Runtime generations" 是 ADR-0009 的 Runtime generation，二者不可混用**。
- **语义 emission**（原文）：「producer → 诊断日志 emitter 提交的 detached 语义结局……不含 streamId/sequence/segment/frameOffset/Base64/CRC 等物理表示（storage projection 归 adapter）。emit 同步、不 throw、不阻塞；快照与 updateBytes 所有权移交后不得再变异。update-omitted 稳定 reason 受控词表（v1）：`payload-too-large` / `update-capture-disabled` / `empty-update`——新增 reason 属词表演进，须过设计评审。」
- **storage projection**（原文）：「日志 adapter 独占的物理表示决策——先决定 inline/sidecar 并构造最终 record（segment/frameOffset/payloadLength/CRC32C/Base64），再运行 VFSL 校验；emitter 只做语义投影，不构造物理字段。」
- **genesis baseline record**（原文）：「新 stream 的 genesis 基线——当时完整 Y.Doc 的 update，不是变更尝试（无 attemptId/operation/stage/result/input；顶层 `recordKind: 'genesis-baseline'` 判别）；v1 冻结的 emission/sink 公共面无构造路径，由 #152 adapter 内部构造（设计 §10-J1 备案）。」——replay 消费 genesis，公共面不新增构造路径。
- **空闲 Runtime**（原文）：「当前没有调用方租约、但仍由 NamespaceRegistry 暂时保留的 namespace Runtime；保留期内重新打开会复用同一 Runtime，保留期届满才关闭。」——多 Runtime generation 共享 writer 的生命周期背景。
- **写序列器**（原文）：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序……读取不进入该序列。」——ADR-0012-LOG amendment「emit 不得在 slot 内执行」所指的 slot 即此。
- **namespaceId**（原文）：「Registry entry 与实例复制 wire 的唯一 namespace 身份……」——日志目录布局按 namespaceId；owner 不上 wire，日志配置亦不上 wire。
- **ReplicationSession / 复制谱系 / 复制代际**：本任务不触碰 session 与 wire 身份；AC5「identity mismatch」指 replay 后受控 identity 与请求目标比对（ADR-0011 五条件之 5），非 wire 身份管理。

## 供 SA1/SA2/SA3 复用的红线清单（摘录汇编，非裁决）

1. emit 调用点必须在 write sequencer slot 之外或 slot 释放之后（ADR-0012-LOG amendment，点名 #155）。
2. 日志配置是本地 Host/Registry 旁路：不进 SCHEMA/META/ROOT/snapshot/wire（ADR-0012-LOG §Stream）。
3. 冻结项（record/schema/frame 版本、update capture、input capture policy、inline threshold、line 上限）改变 → 新 stream generation；retention/queue/batch/flush/fd/metrics 可调不改变解释（ADR-0012-LOG §Segment rolling）。
4. replay 强制 strict；不暴露 live Y.Doc；只返回 owned bytes + 三态报告；不自动跨 generation 拼接（ADR-0012-LOG §Strict reader）。
5. complete 仅限五条件全满足（ADR-0011 §重放 + ADR-0012-LOG §Strict reader）；complete 也保留 best-effort disclaimer。
6. shutdown drain best-effort 且有界；不得阻塞 Registry shutdown / Persistence dispose（ADR-0011 §时序、ADR-0012-LOG §Writer、ADR-0009 §Shutdown、ADR-0010 停止顺序）。
7. 若引入 queue/batch：不得改 emitter seam / record schema / manifest policy / write-slot 隔离，并须另行定义 close/shutdown、flush、队列满语义（ADR-0012-LOG amendment）。
8. 健康面独立（`LOG_STREAM_INIT_FAILED`、dropped、sink failure、queue health）；初始化失败不影响 create（ADR-0012-LOG §Stream、ADR-0011 §产品契约）。
9. update-omitted reason 词表冻结 v1 三词；新增须过设计评审（CONTEXT 语义 emission）。
10. full input / committed update logging 须 Host 显式启用并继承同等或更严格访问控制；日志字段不进默认低基数 metrics label（ADR-0011 §数据保护）。

---

## 设计后复审追加——SA1 设计（R0）引入的决策点（2026-08-31；供 SA2/SA3/SA4 复用）

> 来源：`wiki/raw/task_expose-diagnostic-replay-host-lifecycle_design.md`（D1–D12）。裁决情况见
> `…_design_conflict_report.md`（verdict `clear`，冲突点 0）。以下为设计在 ADR 裁决权内做出的
> **新决策点**摘录（SA2 评审与 SA4 范围比对的锚）；ADR/CONTEXT 原条款见上文各节，不重复。

### D1 配置面形状（仲裁）

`AppConfig.diagnostics = { enabled; rootDir; retention?{maxAgeMs?|null, maxBytesPerNamespace?|null}; updateCapture?; inputPolicy?('none'|'digest'|'redacted'|'full') }`——逐字采纳 SA6 PROPOSAL；缺整个键 = 既有行为逐字节不变；`enabled:false` 是合法显式关闭（rootDir 仍必填）；hub/peer 通用；缺省值不在 config 层展开（`updateCapture ?? false`、`inputPolicy ?? 'digest'`、retention 缺省 → adapter 层 30d/1GiB）。

### D2 冻结/可调二分在配置面的落点（仲裁）

只暴露 updateCapture（冻结类）、inputPolicy（冻结类）、retention（可调类）；inline threshold / line 上限 / roll targets / payloadMax 不暴露。配置 restart-only；跨重启改冻结类 ⇒ #153 `analyzeStreamForResume` 健康证明失败 ⇒ rotate 新 generation（不自动拼接）；改 retention ⇒ 同 stream 续写零 generation 变化。

### D4 create 路径 dispatcher 同步窗（归属路由机制）

emission 无 namespaceId ⇒ Registry 共享单 emitter 经「initStream 同步窗绑定 + 微任务关窗」路由到正确 namespace adapter；窗失效方向 = 丢弃可观测、永不误归因（fail-safe）。**被拒 create 的无归属 emission 显式裁决为丢弃 + 计数事件**（acceptance/validation/persistence 拒绝先于 stream 建立；ADR-0011「日志允许缺失」+ per-namespace 存储模型；SA8 边界审视 1 判 no-conflict）。

### D7 有界 drain = O(1) 结构性收口

first-slice adapter 无队列/无常驻 fd ⇒ 停机无积压；`manager.close()` 仅置 closed 位 + 释放 Map（零 fs、零 await、幂等），**不执行停机 sweep**。挂点：`performStop` 在 `registry.shutdown()` 之后、persistence 排空窗之前（顺序：replication drain → registry shutdown → **diagnostics close** → persistence 排空窗 → persistence dispose → ctx dispose）。未来 queue 切片须另行定义 drain 预算（显式备案）。

### D9 replay 三态语义（仲裁，SA6 注记 2 让渡的裁决权）

**failed = 重放无基**（locator 缺失/不可解析、stream incompatible、无有效 genesis 含 retention 裁掉 genesis——applied = 0）；**partial = 有基不完整**（genesis 已应用、前缀已重放但完整性破坏——applied > 0 且 issues 非空）；**complete = 五条件全满足且 `issues === []`**（R1 钉死 ⇒ best-effort disclaimer 承载于 API 契约文档（JSDoc/设计 §5.6），非运行时字段——ADR-0011「任何 UI、CLI 和文档都必须展示」）。

### D10 逆向物化归日志包（storage projection 逆面收口）

`materializeStrictRecordUpdate`（reader.ts 增量导出）：strict record → `{kind:'update',bytes}|{kind:'omitted',reason}|{kind:'none'}|{kind:'invalid',code}`，实现只消费包内原语（decodeBase64Strict/decodeFrame/frameCrcOf/validateSidecarFrame/streamLayoutPaths），inline/sidecar 路径纵深复验，失败收敛 invalid 绝不抛。app 侧不得二次实现 Base64/frame/CRC 物化（双源必漂移）。locator（current.json）解析留 app 工具层（ADR-0012 冻结布局的离线工具用途；SA8 边界审视 5 判 no-conflict）。

### D11 seam 违约姿态 = lenient 隔离（非 loud）

Registry 对 `runtimeEmitterFor` 的读取/调用/形状检查全部非抛边界，违约 → 该 Runtime 无诊断（对齐 #150 `createCreateDiag` no-op 先例；ADR-0011 §A「adapter 同步 throw 或异步失败均被隔离」）。不选 boot 期 loud：响亮 = 让日志配置错误杀死 open/create，正是 ADR 明文禁止的后果。

### D12 ReplayIssue 码词表（Host 工具层；`{code: string}` 冻结形状内）

新码（本票 Host 层，语义逐条溯源 ADR 条款）：`locator-missing`/`locator-invalid`/`stream-incompatible`/`genesis-missing`/`genesis-misplaced`/`history-trimmed`/`update-omitted`/`update-undecodable`/`identity-mismatch`；物理类零新码（透传 strict reader 29 码族）。SA6 断言子串锚：'genesis'/'gap'/'omitted'/'identity'/'invalid-json'。update-omitted **reason** 词表 v1 三值不受影响（reason 仅透传，code 恒 `update-omitted`）。**SA8 注记**：`genesis-misplaced` 触发条件（genesisSeen ∨ applied>0）对「update 前置被跳过后 mid-genesis」流形存在边界（终态由 CRDT 幂等兜底）——已判 no-conflict，列为 SA2 攻击点（边界审视 6）。

### 其他设计冻结点（简记）

- 健康面：File adapter observer → NDJSON `{event:'diagnostic-log',…}`（namespaceId 受控入事件，先例 provisioned/target-added/replica-reset；无控制通道 op、无 metrics 导出）；管理器自有事件 `diagnostic-log-emission-dropped{reason: unattributed|manager-closed|stream-unavailable}`、`diagnostic-log-manager-failed`。
- 非目标备案（§8）：不实现 queue/batch/fsync；不暴露 inline threshold 等配置键；不新增控制通道/REST/metrics；不实现 Host 数据删除 → 日志删除联动（条件条款前件不成立，待相应票）；被拒 create 无归属 emission 不发明归属。
- 停机换装：SIGHUP 走 app.stop()（manager 关）→ 新 boot（新 manager，current.json 续写；冻结策略变化 → rotate）。
- 加法契约面（§12 审计）：`createNamespaceRuntimeForRegistry`/`createNamespaceRuntime` 可选第三参 `diagnostic?`、`RuntimeFactory` 增宽、`NamespaceRegistryDiagnosticLog += runtimeEmitterFor?`、`createNamespaceRegistryPlugin(config, host?)`（config 键集 `{idleTimeoutMs?}` 冻结不动）、`AppConfig += diagnostics?`、顶层白名单 += `'diagnostics'`；无 return→throw、无同步→异步、无 catch 语义改动。

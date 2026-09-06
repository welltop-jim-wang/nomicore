# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（issue #239：periodic reconciliation 语义 no-op 可观测性）。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR / 协议全文。
>
> - 被审对象：`wiki/raw/task_issue-239-periodic-noop-observability.md`（bug，labels: bug / in-progress，Issue 评论数 0）。
> - 冲突基准：`docs/adr/` 全部 **11 个 ADR**（0001–0010、0012；全读，无抽样）+ `CONTEXT.md`。
> - `docs/protocols/instance-replication-v1.md` 经 ADR-0010 L151「连接与namespace状态、消息码、payload字段、错误码、timeout、close code、backpressure和完整时序以`docs/protocols/instance-replication-v1.md`为唯一wire contract」**收录为约束**；其中 **§23 Observability seam** 自我登记为「local，非 wire 契约」的 append-only 事件注册表（§23 开头），issue #231 已确立「§23 append-only 演进直接改协议文档、无需 ADR 修订节」的先例（commit 4323118/#240，ADR-0010 无 #231 修订节）。本文件一并摘录 §9/§16/§18/§21/§23；除此之外的代码与 wiki 文档不构成约束（ADR-0010 issue #172 修订节第 2 条：`wiki/raw/` 非规范）。

## 相关 ADR

### ADR-0010 Hub/Peer WebSocket Y.Doc 复制与最终一致（accepted）

- 与本任务的关联点：任务整体即 ADR-0010「资源限制与 observability」节所登记 observer seam 的**事件语义扩展**（@nomicore/ws-replication 包内 observer/事件发射点），并保持 wire 与状态机零变化。
- 核心条款（原文摘录）：

  - sync round 与周期 reconciliation（§WebSocket 复制协议与状态机）：「每个sync round由Peer以uint32 roundId发起，双方Step2完成sequenced apply + dirty后以SYNC_APPLIED确认；两个方向均确认才进入live。Peer 还为每个 live namespace 持有 one-shot 周期 reconciliation timer，以修复回声抑制或传输异常导致但未触发显式 resync 的漂移；timer 所有权、间隔、状态门、碰撞与清理规则以 protocol v1 为准。」

  - 唯一 wire contract（同节）：「连接与namespace状态、消息码、payload字段、错误码、timeout、close code、backpressure和完整时序以`docs/protocols/instance-replication-v1.md`为唯一wire contract。关键恢复纪律为：连接断开即close sessions/release Leases，不保留outbox；重连重新OPEN并reconcile。」

  - observer 隔离与 fanout（§Trusted raw update 与现有不变量）：「observer 失败不得回滚 transaction 或使 Runtime fatal；队列溢出只把 channel 标记为 `needs-resync`，不得阻塞 write sequencer。」

  - 泄漏禁令（§认证、授权和传输安全）：「Token、Yjs update、SCHEMA/ROOT 内容以及未经控制的 owner/namespace 不得出现在默认日志或高基数指标标签中。」instanceId「仅用于连接身份、受控日志和指标，不写入 namespace META」（L156）。

  - 观测面（§资源限制与 observability）：「复制插件提供结构化 observer seam 给日志/metrics/trace Adapter，不提供业务公共 update events。最小观测面包括：连接状态与重连、channel 状态、bootstrap/reconcile 次数和字节、updates/bytes in/out、apply/ACK latency、backpressure resync、auth/authz failure、identity/epoch conflict、peer degraded bypass apply 和稳定错误计数。」——「最小观测面**包括**」是下限清单而非闭集；追加 sync round 语义效果字段与该条相容。

  - session 能力面（§NamespaceLease 与 ReplicationSession）：session 提供「编码 state vector」「按远端 state vector 编码 diff」「订阅 owned `Uint8Array` 本地 updates」「在唯一 write sequencer 中应用远端 update」等窄能力，「不暴露 live Y.Doc」。

  - 修订节 issue #134（与本任务直接相关两条）：
    - session 能力词汇：「提供 state vector（`encodeStateVector`）、diff（`encodeDiff`）……但不暴露 live Y.Doc」——round 前后 state vector 的捕获只能经 session/受控 seam，不得抓 live Y.Doc。
    - **R2-7 成功接纳即置位**：「no-op / 重复 / 空效果 update 的成功 apply（`Y.applyUpdate` 正常返回 + R6 dirty 登记完成）同样置 `rootValidation = 'replication-unvalidated'` 与 `memoryCaughtUp = true`——无『且推进文档状态』限定。」——**`applyEffect: noop` 与 session `rootValidation` 是正交两维**：语义 no-op round 的 Step2 仍被 sequenced apply + dirty + 置 unvalidated；observer 的 noop 判据只描述 state vector 是否推进，不得反推「apply 未发生/无需 dirty」。

### ADR-0010 收录的 wire/observer contract：`docs/protocols/instance-replication-v1.md`

- 与本任务的关联点：issue 全部验收口径（append-only 事件字段、safe-field、低基数、隔离、无 observer 热路径、conformance）的权威来源。

- **§23 Observability seam（local，非 wire 契约）——本任务的主演化面**（开头原文）：

  「本节登记 `@nomicore/ws-replication` 的**结构化 observer seam**（ADR 0010 L167、issue #177）。属于 local seam：**不改变任何 wire 字节**，不新增帧/字段/错误码；事件词汇只描述既有协议事实的观测投影。事件经构造函数注入的 `observer?: ReplicationObserver` 同步交付（附带可选 `clock?: ReplicationClock` 以观测 apply/ACK latency）。Seam 是**追加式（append-only）**：事件类型、reason/cause/via 词表、稳定码表只增不改；GA 后字段语义冻结。」

- §23.1 既有事件字段（与本任务直接相关的两型，原文）：

  | type | side | 字段 |
  |---|---|---|
  | `sync-step2-sent` | hub/peer | `connectionId?`、`namespaceId`、`bytes`（出向 Step2 diff 载荷长度） |
  | `sync-diff-applied` | hub/peer | `connectionId?`、`namespaceId`、`bytes`、`applyLatencyMs?` |

  另：`update-sent`/`update-applied`/`update-acked` 字段同为 `connectionId?`、`namespaceId`、`bytes`（+latency）；**apply 成功路径互斥规则**：「每笔成功 apply 恰一事件 = `update-applied`（UPDATE 且非 degraded）／`sync-diff-applied`（Step2 且非 degraded）／`degraded-bypass-applied`（degraded，任意来源）三选一」——新增字段不得破坏该互斥与恰一计数。issue #231 先例：`resync-required` **追加** reason/updateBytes/maxUpdateBytes/queued*/inFlightCount/channelState/connectionState/bufferedAmount? 字段并**新增第 20 型** `update-dropped`，全部 append-only、其余 cause 键集逐字节不变。

- §23.3 事件内容安全清单（Safe-field，原文关键句）：

  **允许**：「稳定字面量（type/side/direction/via/reason/cause/reasonCode/from/to/terminalState/channelState/connectionState——后两者为 §15/§16 状态机闭联合字面量，issue #231）、受控标识（`namespaceId` 恒为 `^ns-[0-9a-f]{32}$`；`connectionId` 为 §6.2 专用 observability id，握手完成前字段不存在）、稳定错误码（§23.2 闭联合）、有限数值（`bytes`/`updateBytes`/`maxUpdateBytes` 是**长度**不是内容；……`applyLatencyMs`/`ackLatencyMs` 是**差值**非绝对时间戳）。」

  **禁止**：「token（任何形态）；owner 值（NamespaceOwner/userId/localOwner）；Yjs bytes（事件树深扫不得出现 `Uint8Array`/`ArrayBuffer`/`DataView`）；SCHEMA/ROOT 内容；原始 cause（Error 对象/`.message`/`.stack`/异常字符串）；wire 原样自由文本（含 transport close `reason`——只允许 close code 与本地分类）；不受控高基数字段。」

  ——注：**state vector 摘要（digest/hash）目前不在允许清单内**；若落地 `stateVectorBeforeHash`/`stateVectorAfterHash`，必须按 append-only 把「documented safe digest」注册进 §23.3（算法/编码/截断长度固定），并保持「raw state vector 字节 = Yjs bytes → 禁止」。issue 自身已给出退路：「如果安全或兼容性不适合暴露 hash，至少提供 `stateVectorChanged` 和 round-local correlation」。

- §23.4 隔离语义与时钟（原文关键句）：

  - 「回调**同步**投递；throw 被隔离（静默，绝不改变协议状态、关闭分类或 Runtime 写入结果）；返回值（含 Promise）被忽略——异步 reject 属宿主域 unhandled。」
  - 「事件在**决策已落定之后**发射（状态已写入 / close 已判定 / 帧已入队或已收 / apply promise 已结算）；发射点均位于 ws-replication 层帧分发同步段或 apply 结算续体，**永不位于 Registry write sequencer 槽内**。」
  - 「`now()` 只作差，**绝对时间戳不入事件**。实现内禁止 `Date.now()`/`performance.now()` 回退（ADR 0009 纪律）。」
  - 「**无 observer = 零事件、零状态投影读取、零时钟调用**（行为与现状逐字节等价）。」

  ——推论（对新增字段）：round 前后 state vector 捕获/比较/摘要化是「状态投影读取」，**必须 observer 注入门控**（无 observer 时不得产生捕获成本）；before 捕获在帧分发同步段（admission 侧）、after 捕获在 apply 结算续体，均不进 sequencer 槽；计算/比较中的 throw 按 observer 隔离纪律静默（观测失败不是业务失败，参照 clock-throw 折叠策略）。

- §23.6 Adapter（日志/metrics/trace）指引（原文关键句）：

  「metrics（默认）｜允许：label ∈ {side, type, code, cause, reason}；counter/gauge/histogram 数值（bytes/latency 入 histogram）｜禁止：namespaceId/connectionId 作默认 label」；「`namespaceId`/`connectionId` 是事件 payload（供受控日志/trace 关联），**默认不绑 metric label**（§19 ADR L159）。」

  ——推论：`syncRoundId`（uint32 递增）与 state vector 摘要同属高基数 payload，**可入事件/trace 关联、默认不入 metric label**；`applyEffect: changed|noop`、`stateVectorChanged` 是低基数闭联合字面量，可作 label——正合 issue「低基数 metrics」与「avoid default metrics label」要求。

- §23.7 Conformance 补充（原文关键句）：须覆盖「全事件矩阵 key-set 冻结白名单断言；token/owner/Yjs bytes/SCHEMA/ROOT/cause 哨兵深扫（含 `JSON.stringify` 无标记物、深扫无 `Uint8Array`/`ArrayBuffer`/`Error`）；observer 每事件必 throw 时 wire 帧序列、终态、文档内容与 apply 结算与无 observer 基线全等；无 clock 时 latency 字段缺失、有 clock 时 ≥ 0」——新增字段须并入同一 conformance 面（键集冻结白名单 + 深扫 + throw 隔离基线全等 + 无 observer 热路径全等）。

- §9 双向 reconciliation（wire 事实——新增事件字段的数据来源，**零 wire 变化**）：

  - §9.1 SYNC_STEP1：`syncRoundId | varUint | Peer 创建，uint32，连接内不回绕`；「Peer 的首个 Step1 隐式开始 round；Hub 不自行开始 round。Hub 收到有效新 round 后发送自己的 Step1。每方向每 round 只允许一个 Step1。」
  - §9.2 SYNC_STEP2：`syncRoundId | varUint | 对应当前 Step1`；`update | varUint8Array | 按对端 state vector编码的 diff，允许空 diff`——「允许空 diff」+ Yjs 编码非规范零长 ⇒ **no-op round 仍有非零 Step2 字节**（issue 现象的协议层根因，非缺陷）。
  - §9.3 SYNC_APPLIED：`syncRoundId | varUint | 当前 round`；「两位都为 true，且未发生 overflow、identity变化或 resync request，才能进入 live。空 diff同样走完整 Step2/Applied。」
  - §9.4 周期 reconciliation（状态机权威，本任务**不得改变**）：「协议 v1 执行周期 reconciliation。Peer 为每个 live namespace 持有一个 one-shot timer；`reconcileIntervalMs` 为正整数配置，缺省 300000 ms。timer 只在完整 round 收口并进入 live 后武装；到期时 Peer 直接进入 reconciling 并以新 roundId 发起 round，不发送 RESYNC_REQUIRED。round 进行期间不武装下一次周期 timer，因此不会出现重叠 round；……连接断开、GOAWAY、remove/close、终态与 shutdown 必须清理 timer；重连后只有新连接代际重新 OPEN/reconcile 并进入 live 后才开始新的周期。」

- §16 Peer namespace 状态机：`live → reconciling → live` 转移与 `needs-resync` 汇规则（issue 明示「不把 Hub/Peer state transition 不对称视为缺陷」与该节相容——Hub 为响应方，无对称义务）。

- §18 Timeout：`reconcileIntervalMs`（缺省 `300_000`）为独立配置——测试以受控 Timer 推进（不得真等 5 分钟）。

- §21 Crash、重启与停机：「进程重启丢弃 connection sequence、syncRoundId、in-flight ACK、queues和协议中间状态。」——**syncRoundId 关联域 = 单连接代际内**，不得设计跨重启关联。

### ADR-0012 实例身份单一真相与 WebSocket plugin 所有权（accepted）

- 与本任务的关联点：泄漏禁令第二来源 + plugin 配置对 observer 的所有权 + 被否决方案（不得暴露 raw session/Y.Doc）。
- 核心条款（原文摘录）：
  - 「Hub 配置拥有 listen、authentication、authorization、limits、timeouts、observer 与 adapter overrides；Peer 配置拥有 Hub endpoint、`expectedHubInstanceId`、credential/dial adapter、initial targets、limits/timeouts、backoff、observer 与 adapter overrides。」
  - 「status、observer 与错误不得泄漏 token、Authorization、owner 完整值、Schema/Data、Yjs bytes 或 stack。」
  - 被否决方案：「WebSocket plugin 暴露 raw Registry、ReplicationSession 或 live Y.Doc：扩大可信能力面。」——静默漂移注入与 state vector 捕获都不得要求生产代码暴露 live Y.Doc。

### ADR-0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted；Runtime/open/read 条款由 ADR-0008 取代）

- 与本任务的关联点：observer no-rollback 底层纪律的 Runtime 域对应物。
- 核心条款（原文摘录，L54）：「Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报。事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback。」——本任务在 ws-replication 层的 observer throw 隔离（§23.4）是该纪律的传输层对应；不得把新增计算放进 Runtime 事务栈。

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted）

- 与本任务的关联点：**负向约束 ×2**。
- 核心条款（原文摘录）：
  - L40：「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer；不同 namespace 可并行。」——§23.4「永不位于 Registry write sequencer 槽内」所指即此队列；新增 before/after 捕获与事件发射不得进槽、不得阻塞槽。
  - L101：「Runtime 提供结构化瞬时 capability status……status 不暴露队列长度、任务类型或 sequence。v1 不提供公共事件订阅；队列进度和内部事件属于日志、metrics 与 trace。」——**作用域注记**：该条约束的是 Runtime capability status 形状，不是 ws-replication observer 事件；事件携带 wire 既有事实（syncRoundId/sequence）不受此条限制，但不得据此扩 Runtime status。

### ADR-0009 NamespaceRegistry、租约与 Host 生命周期（accepted）

- 与本任务的关联点：Registry observer seam 的同款 Adapter 纪律（脱敏/采样归 Adapter）。
- 核心条款（原文摘录，L95）：「公开 issue/error message不包含 owner/namespace原值、SCHEMA全文、ROOT/input数据、原始异常文本或stack。Registry核心通过内部结构化 observer seam上报生命周期与故障；event可携带受控 identity和exact cause，由日志/metrics/trace Adapter负责访问控制、脱敏与采样。」

### 无关联 ADR（已全读核对，无本任务约束条款）

ADR-0001（VFSL 单一真相源）、ADR-0002（重写定位/authority 出范围）、ADR-0003（求值器与派生 schema）、ADR-0004（类型投影）、ADR-0005（投影生成管线）、ADR-0006（Persistence；任务不动持久层）。

## CONTEXT.md 相关术语与惯例

- **ReplicationSession**：「由 NamespaceLease 打开的受信任 duplex raw Yjs 复制会话；……提供 state vector（`encodeStateVector`）、diff（`encodeDiff`）、owned update subscription（`subscribeOwnedUpdates`）和进入本地唯一 write sequencer 的 trusted apply（`applyRemoteUpdate`）……但不暴露 live Y.Doc。」_Avoid_: 裸 Y.Doc WS handler、绕过本地 write sequencer 的 apply。
- **写序列器（write sequencer）**：「每个 NamespaceRuntime 独有的严格 FIFO……前项完成 dirty notification 后下一项才执行；**读取不进入该序列**。」——state vector 读取属读取面，可在槽外捕获。
- **复制未校验（replication-unvalidated）**：「Trusted raw Yjs update 已在 sequencer 中提交并登记 dirty，但未执行完整 VFSL ROOT 预校验的复制状态」——no-op Step2 的 apply 同样落入该状态（#134 R2-7）；`applyEffect=noop` 只否定 state vector 推进，不否定提交/dirty/unvalidated。
- **Hub / Peer**、**复制谱系 / 复制代际**、**namespaceId**（`^ns-[0-9a-f]{32}$`，owner 不上 wire）——safe-field 判定的词汇基础。

## 实现锚点（非规范，仅供定位；wiki/raw 与源码位置非冲突基准）

- 事件类型联合：`packages/ws-replication/src/types.ts` L336–L350（`sync-step2-sent` / `sync-diff-applied` 现字段集）。
- 发射点：`packages/ws-replication/src/peer-namespace.ts` L159（step2-sent）/ L1076（diff-applied）；`packages/ws-replication/src/hub-namespace.ts` L146 / L891。
- seam 聚合：`packages/ws-replication/src/observer.ts`；round 状态机：`round-engine.ts`；测试驱动：`packages/ws-replication/test/driver.ts`（含 `makePeer` 构造 seam，L666 起）。
- 包边界（packages/ws-replication/AGENTS.md）：「Use injected transport, scheduler, randomness, and optional observer/clock seams. Observer or adapter failures must follow their documented isolation and close classifications.」「The transport layer never reaches into Runtime, Persistence, snapshots, or live Y.Doc internals.」——验证门要求覆盖 observer isolation 与 periodic reconciliation 全路径。

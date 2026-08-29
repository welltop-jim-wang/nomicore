# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 被审对象：`wiki/raw/task_phase5-ws-auth-lifecycle.md`（issue #138，Phase 5：authenticate instances and run connection lifecycle——实例认证与连接生命周期）。
> 摘录范围：ADR 全集（`docs/adr/0001`–`0010`，10 个全量读取）+ `CONTEXT.md` + 任务指定的 Phase 5 规格基准（`docs/phases/phase-5-websocket-replication.md` 切片 7、`docs/protocols/instance-replication-v1.md`——后者为 ADR 0010 L151 指定的唯一 wire contract，具 ADR 级约束力）。

## 相关 ADR

### ADR-0010 Hub/Peer WebSocket Y.Doc 复制与最终一致（accepted；含 issue #134 round-2、issue #133 round-2 修订节）

- 与本任务的关联点：**权威设计 ADR**。本任务（issue #138，phase-5 切片 7 的认证/授权/连接生命周期域）在其「认证、授权和传输安全」「WebSocket 复制协议与状态机」「资源限制与 observability」「包、应用与生命周期」各节上落地；依赖 #136（单 namespace 同步域，`6f2676f`）与 #137（multiplex/背压连接域，`08da15b`）已交付的连接骨架。

- 核心条款（原文摘录）：

  **认证时机与实例身份（AC-1 依据）**
  - 「Bearer token在HTTP Upgrade前认证；Upgrade后Peer发送HELLO，Hub回复HELLO_ACK并绑定Peer/Hub instance identity。」（L147）
  - 「WebSocket upgrade 使用 bearer token 认证实例身份；token 映射到安全文法约束的 `instanceId` 与 namespace 权限。」（L155）
  - 「`instanceId` 使用 `^[a-z][a-z0-9-]{0,62}$`，仅用于连接身份、受控日志和指标，不写入 namespace META。」（L156）

  **静态拓扑与连接方向（AC-5 Peer-only 状态机依据）**
  - 「peer 只主动连接一个 hub；hub 不反向拨号，peer 之间不连接。」（L19）

  **版本协商与序列纪律（AC-2/AC-3 依据）**
  - 「Envelope version只决定头布局，HELLO显式协商完整protocol version与capabilities；不得按消息数值猜版本。」（L145）
  - 「每方向sequence从1严格递增，不回绕；gap、repeat或错误ACK关联关闭连接。WS ping/pong负责活性，GOAWAY提供相对drain timeout。」（L147）

  **授权 Adapter（AC-4 依据）**
  - 「Hub 不配置 targets；authorization Adapter按已认证 instance identity + namespaceId返回 denied，或返回 Hub local owner与 read/submit权限；Peer不得声明 Hub owner。」（L37）
  - 「Hub 检查 peer 对每个 namespace 的读取和提交权限；peer 验证配置的 hub 身份，并只接受已请求且批准的 channel。」（L157）
  - 「权限撤销关闭对应 channel，不必关闭整条 WS；授权结果不跨连接生命周期缓存。」（L158）

  **wire contract 权威与恢复纪律（AC-3/AC-5 依据）**
  - 「连接与namespace状态、消息码、payload字段、错误码、timeout、close code、backpressure和完整时序以`docs/protocols/instance-replication-v1.md`为唯一wire contract。关键恢复纪律为：连接断开即close sessions/release Leases，不保留outbox；重连重新OPEN并reconcile。」（L151）

  **日志脱敏（AC-7 依据）**
  - 「Token、Yjs update、SCHEMA/ROOT 内容以及未经控制的 owner/namespace 不得出现在默认日志或高基数指标标签中。」（L159）

  **资源上限分级（AC-1/AC-3 错误分级依据）**
  - 「以下上限均为插件配置并提供安全默认值：最大 WS frame、最大单 update/diff、每连接最大 channel 数、per-channel/连接待发送字节、bootstrap/idle timeout、心跳与失联判定。普通超限以稳定错误关闭单个 channel；framing、认证等连接级错误才关闭整条连接。」（L165）

  **observer seam（AC-7 观测面依据）**
  - 「复制插件提供结构化 observer seam 给日志/metrics/trace Adapter，不提供业务公共 update events。最小观测面包括：连接状态与重连、channel 状态、bootstrap/reconcile 次数和字节、updates/bytes in/out、apply/ACK latency、backpressure resync、auth/authz failure、identity/epoch conflict、peer degraded bypass apply 和稳定错误计数。」（L167）

  **传输安全边界（背景：本任务不终止 TLS）**
  - 「Nomicore 首版允许应用层使用明文 `ws://`，TLS 可由网关、反向代理或 service mesh 终止。Nomicore 因而不提供链路机密性保证；生产部署必须在基础设施层提供 TLS，否则 bearer token 与 Y.Doc 数据会明文暴露。」（L161）

  **停机顺序（AC-6 依据）**
  - 「停止顺序为：复制插件停止接纳连接/target，关闭 channels，等待已被 Runtime 接纳的 apply 槽完成但不无限等待网络 ACK，释放 replication leases，随后 Registry shutdown、Persistence dispose，最后停止 Timer/Clock。」（L179）

  **交付物边界（本任务所属包）**
  - 「`@nomicore/ws-replication`：WebSocket client/server、multiplex、认证授权、bootstrap/reconcile/live 状态机、背压和 observer；」（L174）

### ADR-0009 NamespaceRegistry、调用方租约与 Cordis Host 生命周期（accepted；含 #131、#134 修订节）

- 与本任务的关联点：注入式 Clock/Timer 生态纪律（AC-5「injected scheduler/random seams」的惯例出处）；连接断开时 Lease/session 编排背景（AC-6 drain 的下游动作）；观测脱敏模型（AC-7）。
- 核心条款（原文摘录）：
  - 「Persistence 和 Registry 都依赖外部 Clock 与 Cordis Timer，不各自实现或 fallback 到系统 timer。Clock 是 wall clock，不承诺单调；elapsed scheduling 由 Timer负责。确定性测试使用 manual Clock 状态与 fake timer协调推进。」
  - 「Registry plugin 强依赖：Cordis Timer plugin 的 `ctx.timeout()`……缺失任何依赖均在 plugin 启动时响亮失败，不 fallback 到 `Date.now()` 或全局 timer。」
  - #131 修订节：「Registry 的构造能力增加必需的 `randomBytes(length): Uint8Array` 注入，生产 Host Adapter 使用 `node:crypto`，核心不得回退到全局随机源。」（注入式 random seam 的先例纪律）
  - 「Registry核心通过内部结构化 observer seam上报生命周期与故障；event可携带受控 identity和exact cause，由日志/metrics/trace Adapter负责访问控制、脱敏与采样。」
  - #134 修订节：「release 同步段调用既有活跃 session 的 `close()`……release 不追踪/取消已接纳 apply 槽。」（AC-6「drains accepted apply work」照常排空的下游背景）

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted；含 #93、#132 修订节）

- 与本任务的关联点：AC-6 drain 的 sequencer 语义（已接纳 apply 无条件排空、close barrier 不取消已接纳任务）；AC-5 连接状态机的归属边界（连接/网络状态不进 Runtime status）。
- 核心条款（原文摘录）：
  - 「`close()` 幂等。首次调用同步进入 `closing`，立即停止接纳公共 read 和 write，并在队尾加入 close barrier；此前已接纳任务无条件排空，不取消、不设内部 timeout。」
  - #132 修订节 status 边界：「该域仅含持久 identity/epoch 的两态联合（`{state:'disabled'}` 或 `{state:'enabled'; replicationId; replicationEpoch}`），不含 session、网络、队列或 sync 状态。」（连接状态机/重连/backoff 属 ws-replication 插件域，不得塞入 Runtime status）

### ADR-0006 Cordis 持久化插件（accepted；含 #64/#79 修订节、#131 对齐说明、#133 修订节）

- 与本任务的关联点：弱关联——本任务不改 Persistence 契约；`persistence-degraded` 分级（协议 §20 转述）仅作为错误分级背景。
- 核心条款（原文摘录，弱相关）：
  - 「`saveDoc` 的「脏通知 + 内部调度」语义不变」（dirty-notification 非 durable——连接层 ACK 语义的持久侧背景，ADR-0010 L149 已收口为「UPDATE_ACK同样只表示sequenced live apply + dirty notification，不表示物理flush或其他副本确认」）。

### ADR-0007 逻辑验证与 Yjs Runtime Bridge（accepted；Runtime/open/read 条款由 ADR 0008 部分取代）

- 与本任务的关联点：弱关联——raw update 受控通道已由 ADR 0010 裁决为 ReplicationSession；本任务认证/生命周期层不触及 apply 语义。被取代条款不构成约束。

### ADR-0001 ~ ADR-0005（均 accepted）

- 与本任务的关联点：无直接关联——本任务不触及 VFSL 真相源（0001）、authority 范围（0002）、求值器/ROOT 约定（0003）、类型投影（0004）、投影生成管线（0005）。SCHEMA/ROOT 仅作为日志脱敏对象（AC-7）与授权分级对象被整体引用，不解释其内容。

## CONTEXT.md 相关术语与惯例

- **Hub（中心实例）**：「静态星型复制拓扑中接受 peer WebSocket 连接、转发 Yjs updates、管理 SCHEMA 与复制身份的完整 Nomicore 实例；Hub 也是可接受本地 ROOT 业务写的副本，不是 ROOT 唯一写者，也不表示自动选举的 leader。」_Avoid_: master、leader、只转发而不持有完整副本的中继
- **Peer（边缘实例）**：「静态连接唯一 Hub 的完整 Nomicore 实例；使用独立 Persistence，断线时保持本地 ROOT 读写，重连后按 state vector/diff 与 Hub 双向合并。Peer 之间不直连，且不能本地修改 SCHEMA 或复制身份。」_Avoid_: slave、follower
- **namespaceId**：「Registry entry 与实例复制 wire 的唯一 namespace 身份，普通 create 由受控 128-bit CSPRNG 生成 `ns-` + 32 位小写 hex；……owner 是 open/create 的本地重要属性但不上 wire，也不参与复制身份；不同实例可为同一 namespaceId 使用不同 owner。」_Avoid_: 用户可读名称、由调用方任意指定的 ID、`(owner.userId, namespaceId)` Registry key
- **实例角色（instance role）**：「实例静态角色 hub/peer，经 Registry 构造 `options.role` 注入（可选、缺省 `'hub'`）；peer 实例的本地 replaceSchema/enableReplication/bumpReplicationEpoch 以稳定角色权限错误拒绝，session 的 localRole 必须等于实例角色。生产 composition root（phase-5 切片 9）必须显式传入。」
- **写序列器（write sequencer）**：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。」_Avoid_: mutation queue
- **ReplicationSession**（节选）：「……但不暴露 live Y.Doc。……host 负责只把该高级能力交给可信 transport。」_Avoid_: 裸 Y.Doc WS handler、绕过本地 write sequencer 的 apply、把网络状态塞进 Runtime capability status
- **复制谱系（replication lineage）/ 复制代际（replication epoch）**：身份/epoch 全部匹配才允许直接 reconciliation；不同 → 冲突状态、必须显式 reset/bootstrap，不自动覆盖或合并。（AC-2/AC-4 中身份绑定/授权分级引用的术语基准）

## Phase 5 规格基准（任务指定的裁决/验收基准）

### docs/phases/phase-5-websocket-replication.md（切片 7 及验收基准）

- 切片 7 原文要求（本任务主域，L112–119）：
  - 「一个 peer→hub 长连接 multiplex 多个 namespace。」（#137 已交付，本任务在其上叠加认证/生命周期）
  - 「Peer 指数退避并带抖动重连；hub 不反向拨号。」
  - 「Bearer token upgrade authentication、instanceId 验证和 hub/peer 双向身份约束。」
  - 「Hub namespace 级 read/submit authorization；撤销只关闭对应 channel。」
  - 「结构化认证/授权错误；日志与 metrics 不输出 token、update、SCHEMA/ROOT 内容。」
  - 「Nomicore 不终止 TLS；配置和部署文档必须声明生产环境由网关、代理或 service mesh 提供 TLS。」
- Connection 状态验收（L146–151）：「stopped → disconnected → connecting → handshaking → ready → draining / ↘ backoff / ↘ blocked」「临时网络错误进入full-jitter backoff；认证、版本、身份或policy永久错误进入blocked并等待配置变化。Hub入站连接只走`upgraded → handshaking → ready → draining → closed`。」
- 必须通过的场景（本任务相关）：#12「bearer token、namespace authorization、权限撤销和日志脱敏」；#16「优雅停机完成已被 Runtime 接纳的 apply，不无限等待网络 ACK」。
- 测试 seam（L189–195）：「WS 层使用内存双端 transport/fake socket 覆盖连接与 channel 状态机，不用真实时间等待」「故障注入覆盖丢帧、重复帧、乱序、连接中断、队列溢出、flush failure、认证撤销和 shutdown race」。
- 参考实现纪律（L199）：不得复制「token 日志泄漏、缺少资源级授权、非结构化错误……」等 film-studio-fe 旧行为。

### docs/protocols/instance-replication-v1.md（ADR 0010 L151 指定的唯一 wire contract，具 ADR 级约束力）

- **建连与认证（§2——AC-1/AC-2 依据）**：
  - 「Bearer token 在 HTTP Upgrade 前验证。失败返回 HTTP 401/403，不建立 WebSocket。成功认证至少产生可信 Peer instanceId 和其可用授权上下文。」
  - 「WebSocket 建立后，Peer 必须先发送 HELLO，Hub 必须回复 HELLO_ACK。Upgrade 身份、HELLO Peer instanceId 和配置的 Hub instanceId 必须一致。HELLO 完成前任何 namespace frame均为 `HELLO_REQUIRED` connection error。」
  - 「活性检测只使用 WebSocket ping/pong。协议不定义业务 PING/PONG frame。」
  - 不变量 5：「HELLO_ACK 前不得发送 namespace frame。」
- **HELLO/HELLO_ACK 字段（§6.1/§6.2——AC-2 依据）**：
  - HELLO：`peerInstanceId`（`^[a-z][a-z0-9-]{0,62}$`，「必须等于 Upgrade 身份」）、`expectedHubInstanceId`（同一安全文法）、`protocolVersions`（「明确枚举，降序、无重复、至少一个」）、`requiredCapabilities`（v1 为 0）、`optionalCapabilities`（v1 为 0）、`connectionNonce`（「固定 16 bytes，由 Peer 随机生成」）。「Hub 选择双方共同支持的最高 protocol version。任一 required capability 不支持则拒绝。optional capabilities 取交集。」
  - HELLO_ACK：`hubInstanceId`（「必须等于 Peer 配置期望值」）、`protocolVersion`、`selectedCapabilities`（「required 满足后的交集」）、`connectionNonce`（「原样返回 HELLO nonce」）、`connectionId`（「Hub 生成，仅用于受控 observability，不参与恢复」）。
- **GOAWAY（§6.3——AC-5/AC-6 依据）**：字段 `reasonCode`（稳定安全码）、`drainTimeoutMs`（「接收时开始计算本地 elapsed deadline」）、`retryAfterMs`（optional，「hint，不构成保证」）。「收到 GOAWAY 后停止 OPEN，不开始新 sync round；现有 namespace 到 deadline 前自然收口，之后发送方以 WS 1001 关闭。」
- **ERROR 与 scope（§13——AC-3 依据）**：payload 含 `scope`（`0=connection`, `1=namespace`）、`code`（append-only 稳定 ASCII）、`fatal`/`retryable`（「由 code registry固定」）、`relatedSequence`、`namespaceId`、`safeMessage`（「稳定、无身份/数据/cause文本」）。「Encoder从 code registry导出 scope/fatal/retryable/terminalState，调用方不能覆盖。ERROR永不被 ACK。」
  - Connection error registry（§13.1，认证/身份相关行）：`HELLO_REQUIRED | yes | no | 1002`；`HELLO_TIMEOUT | yes | yes | 1002`；`UNSUPPORTED_PROTOCOL_VERSION | yes | config | 1002`；`UNSUPPORTED_CAPABILITY | yes | config | 1002`；`INSTANCE_IDENTITY_MISMATCH | yes | config | 1008`；`CONNECTION_POLICY_VIOLATION | yes | config | 1008`；`SEQUENCE_VIOLATION | yes | no | 1002`；`ACK_STATE_VIOLATION | yes | no | 1002`。「`config` 表示只有配置/部署变化后才重试，不是当前连接自动重试。」
  - Namespace error registry（§13.2，授权相关行）：`TARGET_NOT_REQUESTED | yes | config | failed`；`NAMESPACE_UNAUTHORIZED | yes | config | failed`；`NAMESPACE_NOT_FOUND | yes | config | failed`；`REPLICATION_NOT_ENABLED | yes | config | failed`；`NAMESPACE_REOPEN_REQUIRES_RECONNECT | yes | reconnect | closed`。
- **wire 脱敏与内部保留（§13.2 L380——AC-7 依据）**：「Wire永不携带 owner、token、SCHEMA、ROOT、update、stack、原始 cause或异常 message。内部 observer/trace保留 committed与exact cause，但协议只输出安全稳定字段。」
- **WS close code（§14——AC-3 依据）**：「`1000`：正常连接结束；`1001`：GOAWAY、计划重启或服务停止；`1002`：bad framing、sequence、message、ACK等协议错误；`1008`：身份或连接 policy错误；`1009`：外层 frame超限；`1011`：不可恢复内部错误或 control backpressure。」「如果 framing仍可信，关闭前 best-effort发送 connection ERROR；否则直接 close。稳定机器语义由 ERROR code定义，WS close code只做粗分类。」
- **Peer 连接状态机与 backoff（§15.1——AC-5 依据）**：状态机 `stopped → disconnected → connecting → handshaking → ready → draining / backoff / blocked`（handshaking：`HELLO_ACK → ready`、`timeout/temporary-close → backoff`、`auth/version/identity failure → blocked`；ready：`local-stop/GOAWAY → draining`、`temporary-close → backoff`、`permanent protocol failure → blocked`）。
  - 「Backoff 使用 full jitter：`cap = min(maxBackoffMs, baseBackoffMs * 2^attempt)`；`delay = random(0, cap)`」
  - 「只有 ready 稳定超过 `backoffResetAfterMs` 才清零 attempt。Scheduler和random必须注入测试 seam。」
  - GOAWAY 原因分级：「`SERVER_RESTARTING`：关闭后按 retryAfterMs + jitter重连；`SERVER_SHUTTING_DOWN`：blocked，等待配置/人工 start；`REAUTH_REQUIRED`：blocked，等待 token/config变化；网络断开或无明确 GOAWAY的 1001：普通 backoff；1002/1008：blocked；1011：继续 backoff，连续失败后降为低频并告警，不永久 blocked。」
- **Hub 连接状态机（§15.2——AC-5 边界依据）**：「`upgraded → handshaking → ready → draining → closed`」「Hub 不包含 dial/backoff。Bearer token轮换只影响新 Upgrade；已建立连接只有在认证/授权 Adapter主动发 reauth/revoke事件时关闭。」
- **OPEN 授权次序（§7.1 L162——AC-4 依据）**：「Hub 必须先 authorization，再从 authorization 结果取得 local owner并调用 Registry open，最后读取 Hub replication identity。未授权不得泄露 namespace 是否存在；只有已获访问权的 Peer才可收到 `NAMESPACE_NOT_FOUND` 或 `REPLICATION_NOT_ENABLED`。」
- **Authorization Adapter（§19——AC-4 依据）**：「Hub authorization Adapter是深 Module：`authorizeNamespace(instanceIdentity, namespaceId) → denied | allowed { localOwner, permissions: { read, submit } }`」「Remote Peer不能声明或影响 Hub owner。Peer target保存 `{ namespaceId, localOwner }`……普通 Registry open仍校验 caller owner与active entry owner；不匹配统一返回 `NAMESPACE_NOT_FOUND`。」「授权只在 OPEN时检查；Adapter可选提供结构化 revoke事件，触发 namespace终止 ERROR和cleanup。没有事件则新授权在下一连接生效。Peer只接受已配置target且已发 OPEN的 namespace；未知 key返回 `TARGET_NOT_REQUESTED`，不自动创建。」
- **Timeout（§18——AC-3 依据）**：「`helloTimeoutMs`……WS ping interval/pong timeout」「HELLO/pong timeout关闭连接。Open/bootstrap/reconcile/close/ACK timeout只收口 namespace。」
- **停机（§21——AC-6 依据）**：六步停机顺序（1. replication停止接纳连接/target并发送GOAWAY → 2. namespace停止新frame，排空已接纳apply → 3. close sessions并release replication leases → 4. Registry shutdown → 5. Persistence dispose → 6. Timer/Clock停止）。「Drain不无限等待网络ACK。不得从notifier或sequencer槽内await Runtime close、Lease release或Registry shutdown。」
- **Namespace 关闭纪律（§16 L475——AC-6 依据）**：「已被 Runtime sequencer接纳的 apply必须结算；未接纳 frame视为 closing violation。Cleanup只在 apply promises settle后执行，绝不在 sequencer槽内 await session/Lease/Registry shutdown。」
- **Conformance（§22，本任务相关子集）**：「fake duplex transport上的connection、namespace、sync、resync、drain状态迁移」「secret-free logs和受控metrics标签」。

## 设计引入的新决策点（SA1 设计后复审摘录；非 ADR 既定——只摘录设计原文，裁决见 design_conflict_report）

> 来源：`wiki/raw/task_phase5-ws-auth-lifecycle_design.md`（SA1 设计档案 **R1 修订版**，2026-08-29）。以下条目为设计提出、ADR/协议文本中**不存在明文对应**的决策点，供 SA2/SA3/SA7 回查。**R1 修订（总控协议字面裁决，2026-08-29）已作废 R0 的 hint 键控 draining（原条目 1——R1 轮 CP-1 冲突源），`goawayReceived` 标志与键控伪代码整体删除**；SA8 R2 复核确认下列新决策点与协议 §15.1 L411/L435-437、§6.3 L147 字面一致（裁决见 `task_phase5-ws-auth-lifecycle_design_conflict_report.md` R2 版，verdict `clear`）。

1. **无条件 draining + hint 只管重连调度（§6.1/§6.2，R1——取代 R0 hint 键控，CP-1 消解面）**：设计原文「drain 类 GOAWAY（`SERVER_RESTARTING` 及一切非永久类 reasonCode）从 ready 收到即 `setState('draining')`——协议 §15.1 L411 字面 `ready ├─ local-stop/GOAWAY → draining`。`retryAfterMs` hint **只影响 deadline close 后的重连调度**（hint → `retryAfterMs + jitter`；无 hint → 普通 full-jitter backoff），不影响状态机转移本身」。
1a. **blocked 类作用域边界（§6.1 落实点 2，R1 显式声明）**：「`SERVER_SHUTTING_DOWN` / `REAUTH_REQUIRED` 两类永久失败 GOAWAY 保持 **blocked 直达**（不经 draining）」——依据协议 §15.1 GOAWAY 原因分级表 L436-437（「blocked，等待配置/人工 start」「blocked，等待 token/config 变化」）+ L413 `permanent protocol failure → blocked` + draining 态自身出口仅 `namespaces closed/deadline → stopped | backoff`（**无 draining→blocked 边**）；既有绿灯 G2/B1 与本设计 §6.2 共同锚定。总控裁决限定语「（与 retryAfterMs 无关）」针对 CP-1 的 hint 键控分歧面（retryAfterMs 仅 drain 类有意义）。
1b. **未知 reasonCode 归入 drain 类（§6.2）**：「drain 类（SERVER_RESTARTING 及未知非永久类）」——未知码无分级表条目，落回状态机通用边 GOAWAY→draining；零新错误码（§13 ERROR 注册表 append-only 不触）。
1c. **draining 进入点不 teardown sender（§6.2 注记，R1 新增实现约束）**：「此处【不】teardown sender——D5 的 scheduler.pending 计面锚（drain timer 恰 +1，poll timer 保持武装至 deadline fire 才清）依赖『draining 进入仅改状态』；teardown 统一在 deadline fire / blocked / 收口路径执行（§8.1 矩阵）」——SA3 实现约束（违反则 D5 锚 `pending === pausedPending + 1` 断言破）。
1d. **hint 路径重连公式与 attempt 处置（§6.3，R1）**：`delay = retryAfter + random()×cap`（cap 复用 §15.1 full-jitter 帽，`Math.min(maxMs, baseMs×2^attempt)`）；「attempt 不递增——hub 编排的重回不是失败事件，不放大退避」。协议 §15.1 L435 字面「关闭后按 retryAfterMs + jitter重连」；attempt 增量行为协议未规定（设计裁量）。
1e. **测试锚变更（§6.5/§11，R1）**：G1 L189 改锚 `'ready'`→`'draining'`（恰 2 行：断言值 + 注释，SA6 执行，总控裁决授权）；红灯契约新增 2 IT（A2-a 无 hint draining 面、A2-b drain 期停新 sync round——本地 ACK_TIMEOUT 触发链主锚 + 入站 RESYNC_REQUIRED 门辅锚）；`ws-replication-sa7-dynamic.test.ts` 由 DENY 移入 ALLOW（`[SA6 owned]`，SA3 不得动）。
2. **GOAWAY 后立即 1001（§7，注记 N1）**：设计原文「transport 在 GOAWAY 后立即 1001 关闭——『不无限等待网络 ACK』由『收口后无出站』结构性满足」；drainTimeoutMs 取 `timeouts.closeTimeoutMs`（默认 5000）「不为停机新造配置面」。协议 §6.3 L147 字面为「现有 namespace 到 deadline 前自然收口，之后发送方以 WS 1001 关闭」。
3. **draining 入站门（§6.2，注记 N2）**：设计原文「入站：onMessage 状态门（:234 只放行 handshaking/ready）在 draining 态忽略对端帧——deadline 内对端残留 UPDATE 的 ACK 缺失由对端 ack-timeout→needs-resync 有界处理，deadline close 后重连 reconcile round 修复收敛」。协议未规定 draining 态入站帧处理。
4. **revoke 命令式宿主 API（§2.2/§5）**：设计新增 `HubReplication.revoke(instanceIdentity, namespaceId): Promise<void>`（认证身份为权威键；未知 scope → resolve 零副作用；`terminateUnauthorized` = NAMESPACE_UNAUTHORIZED + finalize('failed')；cleanupTail 记账 + terminationSettled 吞清理异常）。协议 §19 的载体为「Adapter可选提供结构化 revoke事件」——命令式 API 与事件订阅形式的关系由设计裁量（注记 N8）。
5. **random 可选镜像（§6.3，注记 N3）**：设计伪代码 `const random = this.options.random ?? Math.random;`——镜像既有交付形态（types.ts:112 `readonly random?: () => number; // 缺省 () => Math.random()`）。协议 §15.1 L431「Scheduler和random必须注入测试 seam」。
6. **handshaking 连接停机跳过 GOAWAY（§7.2，注记 N6）**：设计原文「handshaking 连接不发 GOAWAY（HELLO 未完成——对端 handshaking 门对非 HELLO_ACK 帧判 CONNECTION_POLICY_VIOLATION……GOAWAY-before-ACK 反而是协议伤害）；直接 close(1001)」。
7. **早到帧缓冲（§3.1/§3.3，no-conflict）**：accept 在认证前挂早到帧监听、认证成功后构造尾按序重放（复用 onMessage handshaking 门 → 非 HELLO 早到帧判 HELLO_REQUIRED）——协议 §2/不变量 5 的结构性保持，无文本分歧。
8. **观测面零新增（§8.4，注记 N4）**：设计原文「本包零 console/零新增观测面（observer seam 属切片 9）」——ADR 0010 L167 最小观测面含 auth/authz failure，phase 文档将其列于切片 8；本切片零新增与切片划分一致，auth/authz 事件面须切片 8 回补。

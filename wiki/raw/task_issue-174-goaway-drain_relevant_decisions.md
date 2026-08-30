# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
>
> - 被审任务：issue #174 修复 PR #173——实现真实 GOAWAY drain 与关闭时序（`wiki/raw/task_issue-174-goaway-drain.md`）
> - 盘点范围：`docs/adr/` 全部 10 份 ADR（全读，无抽样）+ `CONTEXT.md`
> - 冲突裁决见姊妹档案：`wiki/raw/task_issue-174-goaway-drain_conflict_report.md`

## 相关 ADR

### ADR-0010 Hub/Peer WebSocket Y.Doc 复制与最终一致（accepted）

与本任务的关联点：本任务修的 `HubConnectionImpl.shutdownWithGoaway()` 就是本 ADR 复制插件停止时序的实现层 bug；GOAWAY/drain/WS 1001/ACK 语义均由本 ADR 直接或经授权的 wire 契约约束。

核心条款（原文摘录）：

- 「WS ping/pong负责活性，GOAWAY提供相对drain timeout。」（§认证、授权和传输安全，L147）
- 「Namespace依次执行OPEN与身份检查、可选单frame bootstrap、双向state-vector reconciliation、live UPDATE。每个sync round由Peer以uint32 roundId发起，双方Step2完成sequenced apply + dirty后以SYNC_APPLIED确认；两个方向均确认才进入live。UPDATE_ACK同样只表示sequenced live apply + dirty notification，不表示物理flush或其他副本确认。」（§WebSocket 复制协议与状态机，L149）
- 「连接与namespace状态、消息码、payload字段、错误码、timeout、close code、backpressure和完整时序以`docs/protocols/instance-replication-v1.md`为唯一wire contract。关键恢复纪律为：连接断开即close sessions/release Leases，不保留outbox；重连重新OPEN并reconcile。Per-namespace有界队列溢出时丢弃未发送增量并进入needs-resync；connection按namespace round-robin公平发送，control/ACK保留额度，网络背压不得进入Runtime sequencer。」（§WebSocket 复制协议与状态机，L151）
- 「每个 Peer→Hub维持一条长期 WebSocket并 multiplex多个 namespace。Wire不使用channelId：每个 namespace-scope frame直接携带namespaceId；同一连接内同一 namespace只允许一个生命周期，关闭后重开必须重建连接。」（§WebSocket 复制协议与状态机，L143）
- 「Lease release 同步停止 session 接纳；channel 关闭先关闭 session，再释放 Lease。网络状态保留在 ReplicationSession/复制插件，不塞入 Runtime 的业务 capability status。」（§NamespaceLease 与 ReplicationSession，L90）
- 「以下上限均为插件配置并提供安全默认值：最大 WS frame、最大单 update/diff、每连接最大 channel 数、per-channel/连接待发送字节、bootstrap/idle timeout、心跳与失联判定。普通超限以稳定错误关闭单个 channel；framing、认证等连接级错误才关闭整条连接。」（§资源限制与 observability，L165）
- 「停止顺序为：复制插件停止接纳连接/target，关闭 channels，等待已被 Runtime 接纳的 apply 槽完成但不无限等待网络 ACK，释放 replication leases，随后 Registry shutdown、Persistence dispose，最后停止 Timer/Clock。」（§包、应用与生命周期，L179）
- 修订节 issue #134（ReplicationSession 落地冻结词汇）生命周期词义（O-9 冻结）：「`close()`：幂等 same-promise；首次调用同步段停接纳 + 摘除扇出 channel；Promise 结算为 **barrier 语义**（resolve 时点 = 先于本次 close() 接纳的任务排空之后），**永不 reject**（恒绿空槽体）。release 不追踪已接纳 apply 槽（ADR 0009 L42 同款——照常排空）。」（L246）
- 修订节 issue #134 round 2（R2-2；D-2b）：「Runtime `close()` 同步段（`lifecycle` 翻转后、barrier 入队前——同一同步段原子）经 `fanout.terminateAll('runtime-close')` 逐 channel `finalize('closed', 'runtime-close')`——**终态 `closed` + 排队项取消**」（L271）
- 修订节 issue #134 round 2（R2-2）apply 槽排空锚：「**已接纳 apply 槽无条件排空**（barrier 队尾——ADR 0008 L93/L179 锚；apply 槽体内不检查 session 终态，接纳层 A1 是唯一终态门）。」（L271）
- 修订节 issue #161 round 2（ws-replication 实现层八项 review 修订）：「peer pong 超时 close(1001) + 代际安全脱离后重连；GOAWAY/blocked/连接收口同步静默订阅先于异步 drain。」（L303）

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted；其 Runtime/open/read 条款取代 ADR-0007 对应部分）

与本任务的关联点：drain 期间「已接纳 apply 排空、不取消、不设内部 timeout」的 Runtime close barrier 语义；与 ADR-0010 L179「不无限等待网络 ACK」共同界定本任务 AC3/AC4 的两个等待域。

核心条款（原文摘录）：

- 「`close()` 幂等。首次调用同步进入 `closing`，立即停止接纳公共 read 和 write，并在队尾加入 close barrier；此前已接纳任务无条件排空，不取消、不设内部 timeout。barrier 只调用一次 `handle.release()`；无论 release 成败，Runtime 都进入 `closed`，失败时 close Promise reject，后续 close 返回同一个已结算 Promise。」（§生命周期、状态与所有权，L93）
- 修订节 issue #132 第 4 条（复制管理写的完整槽序）：「四者均进入同一严格 FIFO write sequencer，完整槽序（lifecycle/fatal gate → `DocHandle.getStatus()` writable gate → 输入校验 → 领域事实读取 → 单 Yjs transaction → 同步投影 → `await notifyDirty()`）不变。」（L134）

### ADR-0009 NamespaceRegistry、调用方租约与 Cordis Host 生命周期（accepted）

与本任务的关联点：Host shutdown 的宏观次序（复制插件先停，Registry/Persistence 后停）与 release 不追踪 apply 槽的条款，是本任务 AC6 顺序要求的上游依据。

核心条款（原文摘录）：

- 「首次 shutdown 在调用栈内同步进入 `shutting-down` 并停止接纳 open/create；两者统一返回 `REGISTRY_NOT_ACCEPTING` 且不访问输入。shutdown 取消全部 idle timer，等待此前已接纳的 lifecycle 操作结算，然后主动 close 全部 active/idle Runtime，不等待外部 lease release。Runtime close 自己排空已接纳写。」（§Shutdown，L99）
- 修订节 issue #134 第 2 条：「release 同步段调用既有活跃 session 的 `close()`（停接纳 + 退订 + 释放 slot；零新增方法面）；release 不追踪/取消已接纳 apply 槽（本文「release 不追踪」条款对 ReplicationSession 同样成立——照常排空）。」（L150）

### 无关 ADR（盘点确认，不构成约束清单成员）

ADR-0001/0002/0003/0004/0005（VFSL/schema/投影域）、ADR-0006（Persistence 域；其 dispose 仅作为 ADR-0010 L179 停止链的一环，本任务不改 Persistence）、ADR-0007（其被 ADR-0008 取代的 Runtime/open/read 条款不构成约束）——与本任务无关联条款。

## CONTEXT.md 相关术语与惯例

- `ReplicationSession`：「由 NamespaceLease 打开的受信任 duplex raw Yjs 复制会话；冻结本地角色、远端实例、复制谱系与 epoch，提供 state vector（`encodeStateVector`）、diff（`encodeDiff`）、owned update subscription（`subscribeOwnedUpdates`）和进入本地唯一 write sequencer 的 trusted apply（`applyRemoteUpdate`）、独立状态（`getStatus`）与幂等 close（`close`），但不暴露 live Y.Doc。每 Lease 至多一个活跃 session；`close` 或 epoch fence 后进入终态（closed/conflicted）并释放槽位；host 负责只把该高级能力交给可信 transport。fanout 投递有界队列溢出将 session 标记 `needs-resync`（sticky）——transport 须 reset/bootstrap。」_Avoid_: 裸 Y.Doc WS handler、绕过本地 write sequencer 的 apply、把网络状态塞进 Runtime capability status
- `停接纳（stop-acceptance）`（Runtime 域词汇，词义惯例可迁移对照复制插件层）：「close 首次调用同步进入 `closing` 后，capability 槽立即停止接纳新调用……close 前已接纳任务仍无条件排空。」_Avoid_: 把 lifecycle 失败伪装成路径失败码、把停接纳误解为取消已接纳任务
- `Hub（中心实例）`：「静态星型复制拓扑中接受 peer WebSocket 连接、转发 Yjs updates、管理 SCHEMA 与复制身份的完整 Nomicore 实例；Hub 也是可接受本地 ROOT 业务写的副本，不是 ROOT 唯一写者，也不表示自动选举的 leader。」_Avoid_: master、leader、只转发而不持有完整副本的中继
- `Peer（边缘实例）`：「静态连接唯一 Hub 的完整 Nomicore 实例；使用独立 Persistence，断线时保持本地 ROOT 读写，重连后按 state vector/diff 与 Hub 双向合并。Peer 之间不直连，且不能本地修改 SCHEMA 或复制身份。」_Avoid_: slave、follower

---

## 设计后复审追加（SA1 设计引入的新决策点）

> SA8 设计后复审产出（被审对象 `wiki/raw/task_issue-174-goaway-drain_design.md` R1 初版 vs ADR 全集 + CONTEXT.md；verdict `clear`，见 `wiki/raw/task_issue-174-goaway-drain_design_conflict_report.md`）。只登记设计与既有约束的对应关系/新增锚点，供 SA2 评审 / SA3 实现复用；不裁决。

- **两等待域落地面（设计 §5）**：网络 ACK/transport 存续由 `drainDeadline` 硬顶（ADR-0010 L179「不无限等待网络 ACK」）；Runtime 已接纳 apply 槽经既有 `cleanupAll → onConnectionClosed → drainPendingApplies` 无 deadline、不取消排空（ADR-0008 L93）。推论锚：`hub.close()` Promise 可晚于 deadline 结算（等 apply 排空）——两域各自独立正确，不混同、不互相豁免。
- **#161「GOAWAY/blocked/连接收口同步静默订阅先于异步 drain」（ADR-0010 L303）在新时序下的保持点**：触发点从旧实现的「GOAWAY 即 close」移至「窗口终结 `finishDrain → close() → cleanupAll`」，顺序本身不变——cleanupAll 同步段摘 transport 监听先于 `onConnectionClosed → drainPendingApplies` 异步排空（设计 §3/§4.6）。
- **窗口内 OPEN_NAMESPACE 显式拒绝复用既有 wire 码 `NAMESPACE_REOPEN_REQUIRES_RECONNECT`**（retryable=reconnect、terminal=closed；与 ADR-0010 L143「关闭后重开必须重建连接」同构）+ `relatedSequence` 回指被拒帧序；零新 wire 码、零 wire 格式变化、零新配置 knob——非协议演进，`docs/protocols/instance-replication-v1.md` 与 `docs/adr/**` 在 DENY LIST。
- **窗口内 SYNC_STEP1 无响应丢弃**：hub 以「不调用 RoundEngine（round 零推进、channel 状态零变化）」履行「收到 GOAWAY 后不开始新 sync round」（§6.3，经 ADR-0010 L151 授权传导）；在途 round 的完成帧（STEP2/SYNC_APPLIED）不含 Step1，照常分发。
- **GOAWAY 直发保留既有背压豁免**（停机关键帧不被额度否决，既有注释理由保留）；OPEN 拒绝帧不豁免——走 `sendControlChecked` 保留既有额度判据单点，极端背压下仍按既有 `CONNECTION_BACKPRESSURE`（close 1011，#161 修订节登记语义）处置，不因 drain 悬置。
- **GOAWAY 发送失败 catch → 立即 `finishDrain()` 收口**：framing 不可信 = 连接级故障域，对齐 ADR-0010 L165「framing、认证等连接级错误才关闭整条连接」。
- **既有 handshaking 分支（不发 GOAWAY 直接 `close(1001)`）原样保留**（简报明令 + SA5 论证：peer 握手门对非 HELLO_ACK 帧判 CONNECTION_POLICY_VIOLATION，GOAWAY-before-ACK 是协议伤害）；该分支不武装 `drainTail`，settle 快速结算语义不变。
- **连接 FSM（§15.2，经 ADR-0010 L151 授权的 wire 契约）**：`draining` 首次成为真实驻留状态；`close()` 终态由历史不一致的 `'draining'` 对齐为 `'closed'`；公共 `close()` 在窗口期被宿主直接调用 = force-close 逃生舱（立即收口、清 drain 句柄）。
- **L90/L179 顺序锚的收口链**：自然收口 `CLOSE_NAMESPACE → closing → drainPendingApplies → session.close → lease.release → CLOSE_OK → closed`；终局收口 `close() 同步 quiesce 全 channel → cleanupAll（摘监听 → onConnectionClosed：drain applies → session close → lease release → dropConnection）`——「先关 session 再释放 Lease」与六步停止顺序逐环保持。
- **⚠ 设计前置申报（SA8 冲突基准外事项，非 ADR 冲突）**：既有 AC-6 测试锚与新契约 R1 RED@2 在冻结虚拟时间下数学上不可同时满足（测试基线时代差，代码/测试域）；设计已上报总控/SA6 裁决并给出 1 行最小适配方案（SA6 owned，ALLOW LIST 登记）。SA2/SA3 不得绕过该裁决自行改测试断言逻辑。

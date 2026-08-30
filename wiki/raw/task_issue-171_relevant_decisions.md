# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（issue #171：ws-replication 命名空间跨连接代际生命周期竞态修复）。
> 只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 冲突裁决见 `task_issue-171_conflict_report.md`（verdict: clear）。

## 相关 ADR

### ADR-0010 Hub/Peer WebSocket Y.Doc 复制与最终一致（accepted，2026-08-27；含 #134 / #133 / #161 修订节）

**与本任务的关联点**：本任务的全部 seven 项 Scope 都落在 ADR-0010 建立的 ws-replication
层（连接/namespace 生命周期、恢复纪律、ACK 关联、GOAWAY、LifecycleQueue）。

- 与本任务的关联点：Hub 连接静默后的迟到续体处置、`onConnectionLost()` 清理、bootstrap 中止
- 核心条款（原文摘录）：
  - 「`removeTarget(namespaceId)` 停止同步并释放复制 lease，但保留本地持久副本」（L35）
  - 「插件不持久化 target 配置，重启后的目标集合由 Host 配置负责」（L36）
  - 「Lease release 同步停止 session 接纳；channel 关闭先关闭 session，再释放 Lease。网络状态保留在 ReplicationSession/复制插件，不塞入 Runtime 的业务 capability status。」（L90）
  - 「每个 Peer→Hub维持一条长期 WebSocket并 multiplex多个 namespace。Wire不使用 channelId：每个 namespace-scope frame直接携带 namespaceId；同一连接内同一 namespace只允许一个生命周期，关闭后重开必须重建连接。」（L143）
  - 「每方向sequence从1严格递增，不回绕；gap、repeat或错误ACK关联关闭连接。WS ping/pong负责活性，GOAWAY提供相对drain timeout。」（L147）
  - 「连接与namespace状态、消息码、payload字段、错误码、timeout、close code、backpressure和完整时序以`docs/protocols/instance-replication-v1.md`为唯一wire contract。关键恢复纪律为：连接断开即close sessions/release Leases，不保留outbox；重连重新OPEN并reconcile。」（L151）
  - 「停止顺序为：复制插件停止接纳连接/target，关闭 channels，等待已被 Runtime 接纳的 apply 槽完成但不无限等待网络 ACK，释放 replication leases，随后 Registry shutdown、Persistence dispose，最后停止 Timer/Clock。」（L179）

- 与本任务的关联点：#134 修订节——session 终态语义与「已接纳槽照常排空」纪律（任务清理路径不得取消已接纳 apply 槽）
- 核心条款（原文摘录）：
  - 「`close()`：幂等 same-promise；首次调用同步段停接纳 + 摘除扇出 channel；Promise 结算为 **barrier 语义**（resolve 时点 = 先于本次 close() 接纳的任务排空之后），**永不 reject**（恒绿空槽体）。release 不追踪已接纳 apply 槽（ADR 0009 L42 同款——照常排空）。」（修订节 L246）
  - 「两种终态（close 首调 / apply 槽 R2 conflicted 转换）共用同一 `fanout.detach` 摘除点：存量 listener 即刻停止投递（transport 不得据旧 session 字节继续错误同步）。」（修订节 L247）
  - 「**已接纳 apply 槽无条件排空**（barrier 队尾——ADR 0008 L93/L179 锚；apply 槽体内不检查 session 终态，接纳层 A1 是唯一终态门）。」（修订节 L271）

- 与本任务的关联点：#161 修订节——PR #165 review 修订决策，是本任务（PR #165 follow-up）的直接前置决议
- 核心条款（原文摘录）：
  - 「wire 契约以 `docs/protocols/instance-replication-v1.md`（§2/§17/§18 本轮扩写）为唯一权威：……背压终态口径（pipeline = queued+buffered、shed 仅 queued 侧、严格接纳 + onDataShed 显影、控制独立保留额度 maxQueuedControlBytes 缺省 8MiB、有界整轮扫描、pending handoff 计入 per-ns 溢出双口径、checkpoint = max(1, floor(ackTimeoutMs/100))、1011 终止）；peer pong 超时 close(1001) + 代际安全脱离后重连；GOAWAY/blocked/连接收口同步静默订阅先于异步 drain。」（修订节 L296–304）
  - 注记：本修订节明文登记「**代际安全脱离**」「**同步静默订阅先于异步 drain**」两个 ws-replication 层决策词汇——本任务 Scope 第 2、3、6 项是它们的延续收口，不是新决策方向。

### ADR-0009 NamespaceRegistry、调用方租约与 Host 生命周期（accepted，2026-08-25；含 #131 / #134 修订节）

**与本任务的关联点**：任务里 Hub/Peer 持有的 lease/session 清理必须遵守 Registry 的
generation 纪律与 release 语义。

- 核心条款（原文摘录）：
  - 「旧异步操作只能按 entry identity/generation 清理自己，不得删除后来建立的新 entry。」（L32）
  - 「首次 `release()` 在调用栈内同步将 lease 标记为 released，之后不再接纳新操作。重复 release 返回 exact same Promise。……release 不追踪或等待此前已经由 Runtime 接纳的写；这些写仍由 Runtime sequencer 管理。」（L42）
  - 「release 后，除 `getStatus()` 外的操作通过其既有同步/异步结果通道返回稳定 `NAMESPACE_LEASE_RELEASED`。」（L44）
  - 「最后一个 lease 释放后，Runtime 进入 idle，而不是立即 close。」（L48）
  - 「idle 期间 open 同步取消 timer、转回 active 并签发 lease。」（L50）
  - 「open 在 Persistence load 成功且 Runtime 构造完成后立即成功。它不等待 P0，不编译 schema，也不验证 ROOT」（L54）
  - #134 修订节：「release 同步段调用既有活跃 session 的 `close()`（停接纳 + 退订 + 释放 slot；零新增方法面）；release 不追踪/取消已接纳 apply 槽（本文「release 不追踪」条款对 ReplicationSession 同样成立）。」（L150）

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted，2026-08-23；含 #93 / #132 修订节）

**与本任务的关联点**：连接丢失清理会触发 session/Runtime close——close barrier 的
「无条件排空」纪律与稳定码域是清理实现的硬约束。

- 核心条款（原文摘录）：
  - 「`close()` 幂等。首次调用同步进入 `closing`，立即停止接纳公共 read 和 write，并在队尾加入 close barrier；此前已接纳任务无条件排空，不取消、不设内部 timeout。」（L93）
  - #93 修订节：「`RUNTIME_WRITE_DISABLED` 码域澄清」：该码是写停接纳/写禁用的统一码族，覆盖四类零写入、零输入访问的拒绝——fatal 已置位后的排队写、写前 writable gate 拒绝、notifyDirty 未绑定的构造方义务 loud gate、close 后 lifecycle≠ready 的接纳拒绝；区分域靠 issue message 文案，不另设新码。（修订节第 2 条）
  - #132 修订节：「在正文 status 列举（第 95 行）中补 `replication`；该域仅含持久 identity/epoch 的两态联合（`{state:'disabled'}` 或 `{state:'enabled'; replicationId; replicationEpoch}`），不含 session、网络、队列或 sync 状态。」（修订节第 5 条）

### ADR-0006 Cordis 持久化插件——DocPersistence 与 doc 三条目布局（accepted；含 #64 / #79 / #133 修订节）

**与本任务的关联点**：弱相关（背景）。任务不修改持久层；仅 lease/handle 引用计数语义
作为清理路径的底层背景。

- 核心条款（原文摘录）：
  - 「引用计数 + 身份校验：每个 handle 对应一个不可伪造的 lease；release 幂等且仅释放本次使用权。跨 Adapter/HMR reload 的 foreign handle、已释放 handle 的 saveDoc 都响亮拒绝；引用归零仅使缓存项成为可驱逐候选，不立即释放」（L32）

### ADR-0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted；Runtime/open/read 条款已被 ADR-0008 取代）

**与本任务的关联点**：弱相关（边界）。被取代条款不构成约束；保留有效的 observer
no-rollback / 零写入条款不被本任务触碰。

- 核心条款（原文摘录，保留有效部分）：
  - 「本文关于 logical validation、detached materialization、validated mutation、零写入与 observer no-rollback 的底层决策继续有效。」（取代范围节）

### ADR-0001 / ADR-0002 / ADR-0003 / ADR-0004 / ADR-0005（均 accepted）

**与本任务的关联点**：不相关——VFSL 真相源、重写边界/authority 出范围、求值器/ROOT 约定、
类型投影协议包、投影生成管线；本任务（ws-replication 层 bugfix）与五个 ADR 的决策面零交集。

## CONTEXT.md 相关术语与惯例

- **Hub（中心实例）**：「静态星型复制拓扑中接受 peer WebSocket 连接、转发 Yjs updates、管理 SCHEMA 与复制身份的完整 Nomicore 实例；Hub 也是可接受本地 ROOT 业务写的副本，不是 ROOT 唯一写者」_Avoid: master、leader_
- **Peer（边缘实例）**：「静态连接唯一 Hub 的完整 Nomicore 实例；使用独立 Persistence，断线时保持本地 ROOT 读写，重连后按 state vector/diff 与 Hub 双向合并。」_Avoid: slave、follower_
- **namespaceId**：「Registry entry 与实例复制 wire 的唯一 namespace 身份……不同实例可为同一 namespaceId 使用不同 owner。」_Avoid: `(owner.userId, namespaceId)` Registry key_
- **复制谱系（replication lineage）**：「由 `META.replicationId` 标识的 namespace 复制身份；只有 namespaceId、replicationId 与 replication epoch 全部匹配的副本才允许直接执行 Yjs state-vector reconciliation。」
- **复制代际（replication epoch）**：「`META.replicationEpoch` 中从 1 开始、只由 Hub 显式提升的安全整数」_Avoid: 连接次数、自动选主 term、可回绕版本号_
- **ReplicationSession**：「由 NamespaceLease 打开的受信任 duplex raw Yjs 复制会话……每 Lease 至多一个活跃 session；`close` 或 epoch fence 后进入终态（closed/conflicted）并释放槽位……fanout 投递有界队列溢出将 session 标记 `needs-resync`（sticky）——transport 须 reset/bootstrap。」_Avoid: 裸 Y.Doc WS handler、绕过本地 write sequencer 的 apply、把网络状态塞进 Runtime capability status_
- **复制未校验（replication-unvalidated）**：「Trusted raw Yjs update 已在 sequencer 中提交并登记 dirty，但未执行完整 VFSL ROOT 预校验的复制状态」_Avoid: validated replication、apply 后校验失败自动 rollback_
- **停接纳（stop-acceptance）**：「close 首次调用同步进入 `closing` 后，capability 槽立即停止接纳新调用……close 前已接纳任务仍无条件排空。」_Avoid: 把停接纳误解为取消已接纳任务_
- **写序列器（write sequencer）**：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。」
- **空闲 Runtime（idle Runtime）**：「当前没有调用方租约、但仍由 NamespaceRegistry 暂时保留的 namespace Runtime；保留期内重新打开会复用同一 Runtime」

## 术语警示（SA 全链不得混用）

- 任务语境的 **connection generation（连接代际）** 是 ws-replication 层的清理所有权标识
  （同一物理重连周期内区分新旧连接生命周期），**不是** CONTEXT 的「复制代际
  （replication epoch）」——epoch 只由 Hub 显式提升、存于 `META.replicationEpoch`、
  上 wire 走控制面。两者不得互相借用词汇或语义。
- 任务的「释放恰一次（released exactly once）」落在 ADR-0009 L42 / ADR-0010 修订节 L246
  的**幂等 same-promise** 机制语义上（重复调用返回同一结算），不是新语义。

## 非 ADR 基准的权威指针（记录，不构成门禁约束）

- ADR-0010 L151 / #161 修订节把 wire 时序的唯一权威指定为
  `docs/protocols/instance-replication-v1.md`（本 worktree 存在，§7 Namespace open、
  §13 ERROR、§16 Peer namespace 状态机、§18 Timeout 与任务 References 对应）。
  该文档不是 ADR、不在冲突门禁基准内；任务 AC3/AC4/AC5 的时序细节以它为权威，
  由 SA2/SA7 按其自洽性评审。

---

## 设计后复审追加（2026-08-30，SA8 × SA1 设计 `task_issue-171_design.md`）

> 冲突裁决见 `task_issue-171_design_conflict_report.md`（verdict: clear）。
> 本节登记设计引入的新决策点与其 ADR 映射，供 SA2/SA3/SA4/SA7 复用；仍是中性登记，不裁决。

### 设计新决策点（ADR 映射）

1. **D-H1「中止判别保护资源账目，不保护调用点」**（设计 §11.2）：hub open 续体的
   中止检查位于每个**取得之后**的恢复点；authorize 成功后 `registry.open` 取得阶段
   完整执行，中止时对已取得未赋字的 lease/session 显式回收
   （`finishOpenSilently(pendingLease?, pendingSession?)`，先关 session 再释放 lease）。
   ——ADR 映射：不修订任何 ADR 条款（ADR 全集无条款规定续体中止时点）；回收走
   ADR-0009 L42 / #134 修订节 L246 幂等 same-promise；次序走 ADR-0010 L90；
   语义对称 peer 侧既有 B-2c（取得后判别）。
2. **释放次序与 claim 化处置载体**（设计 §4.1 `runDisposal`）：退捕获 unsubscribe
   句柄 → `session.close()` 屏障 → `lease.release()`；字段清空与 aux teardown 加
   epoch 守卫。——ADR 映射：ADR-0010 L90「先关闭 session，再释放 Lease」的设计层固化；
   跨代不触碰新代资源 = ADR-0009 L32 generation 纪律的 ws-replication 层落实。
3. **生命周期权威归一**（设计 §D9）：hub 通道 `closeQueue` 与 peer 控制器
   `cleanupTail`（经新原语 `enqueueLifecycle`）为两个显式单一权威；不重建共享
   LifecycleQueue；死抽象清除（hub `cleanupTail` 死字段、`isGoawayDraining` seam、
   lifecycle-queue.ts 模块头注释）。——ADR 映射：包内抽象归属，ADR-0010 L173–174
   只约束包职责面、无条款触碰；行为边界（L90 次序、ADR-0008 L93/#134 修订节排空）保持。
4. **错配 CLOSE_OK 处置 + hub 发起例外**（设计 §D4）：closing 且 `closeSequence≠undefined`
   错配、或活跃态未请求 → `host.connectionFatal('ACK_STATE_VIOLATION', 1002)`；
   hub 发起 CLOSE（`closeSequence===undefined`）时 hub 的 CLOSE_OK 为合法应答、
   幂等推进收口（不得 fatal）。——ADR 映射：ADR-0010 L147「gap、repeat或错误ACK关联
   关闭连接」；例外分支依据协议 §5 消息注册表应答语义（wire 权威在协议文档，非门禁基准）。
5. **入站帧静默域扩展 `disconnected`**（设计 §D7）：GOAWAY drain 窗口（连接存活、
   ns 已投影 `disconnected`）内迟到数据/同步帧静默忽略；`CLOSE_NAMESPACE` 照常履行
   （drain→dispose→CLOSE_OK）；已接纳 apply 的 `UPDATE_ACK` 照常发送。——ADR 映射：
   #161 修订节「GOAWAY/blocked/连接收口同步静默订阅先于异步 drain」的窗口不变量补全；
   UPDATE_ACK 义务依据协议 §9.4（非门禁基准）。
6. **新代 open 路径 aux 重置**（设计 §D5.2）：stuck-disposal 场景（gen1 处置悬挂、
   gen2 已建成）下 gen2 open 成功段重置 round/channel/watchdog/closeSequence；
   gen1 未发送队列丢弃。——ADR 映射：ADR-0010 L151「连接断开即close sessions/release
   Leases，不保留outbox；重连重新OPEN并reconcile」。
7. **既有测试 AC3b 断言翻转**（设计 §13.1）：
   `ws-replication-sa6-hardening-g1-g2-red.test.ts` AC3b 由「错配静默忽略 +
   closeTimeout 兜底」翻转为「`ACK_STATE_VIOLATION` 显式收口 + `closeSettled=true`」。
   ——被推翻的 #165 G4 旧行为从未登记进任何 ADR（#161 修订节八项不含此项）；
   新方向与 ADR-0010 L147 对齐（见冲突报告对照 #11）。

### 设计重申的既有约束（零新决策，供下游比对）

- 「恰一次释放」= 幂等 same-promise（ADR-0009 L42、ADR-0010 #134 修订节 L246）
  ——设计 §1/§4.1 逐字遵守，无新释放语义。
- 已接纳槽无条件排空（ADR-0008 L93、ADR-0010 #134 修订节 L271）——设计总则 6、
  §D2/§D3 的 `drainPendingApplies`、§14#15 均明文不取消已接纳槽。
- connection generation ≠ CONTEXT「复制代际（replication epoch）」——设计 §1 显式
  声明（peer 侧 `host.connectionEpoch()` 仅为清理所有权标识，不上 wire、不写 META）。
- 网络状态不入 Runtime capability status（ADR-0010 L90、CONTEXT「ReplicationSession」
  词条 _Avoid_）——设计的 closing/closed/disconnected 投影全部留在 ws-replication 层。

---

## 设计后复审 R1 追加（2026-08-30，SA8 × SA1 设计 R1）

> 前置链：SA2 攻击评审 `task_issue-171_sa2_review.md`（reject：2 CRITICAL + 2 MAJOR +
> 4 MINOR）→ SA1 R1 修订（设计文末「SA2 反馈逐条回应（R1）」，8/8 落实）。本节登记
> R1 引入/修订的决策点（与首轮追加条的替代关系逐条标注）；冲突裁决见
> `task_issue-171_design_conflict_report.md`（R1 版，verdict: clear）。

### R1 修订的决策点（ADR 映射）

1. **入站 CLOSE_OK 合法关联域收紧（R1 #2；替代首轮追加第 4 条的例外分支）**：协议
   §5 L104 Result 语义——CLOSE_OK 的发送方恒为 CLOSE_NAMESPACE 的**接收方**；peer
   全库唯一 CLOSE_NAMESPACE 发送点 = `removeTarget`（seq>0 ⇒ `closeSequence` 必有值；
   hub 侧发送点为零，hub-connection.ts:323-326 判方向异常）。故 closing 期除
   「closeSequence 有值且匹配」外一切入站 CLOSE_OK（错配，或 closeSequence===undefined
   即 hub 发起窗口——本端从未发出 CLOSE_NAMESPACE）→ `connectionFatal('ACK_STATE_VIOLATION',1002)`；
   该窗口收口结算由 §D2 续体承担（不依赖 CLOSE_OK）。——ADR 映射：ADR-0010 L147
   「错误ACK关联关闭连接」的全量落实。**初稿例外分支已删除**：其「§5 either 方向 ⇒
   hub 对自身 CLOSE 的 CLOSE_OK 合法」推导不成立（either 只说明发起方可双向，不改变
   Result 应答方向），SA2 证伪、R1 撤回。
2. **身份守卫（R1 #3；替代首轮第 2 条中的 epoch 守卫表述）**：`runDisposal` 的字段
   清空与 aux（watchdog/round/channel）teardown 判据从 `connectionEpoch()===claim.epoch`
   改为 `this.session === claim.session`（CleanupClaim 删 epoch 字段）——自捕获以来
   未建新 session ⇒ aux 仍归本代，**与连接代际无关**；同时覆盖 P3（session2 已建 →
   不等 → 跳过，新代零触碰）与「新代永不 open」泄漏面（intent='removed'/终态 →
   openActiveTargets 跳过 → `this.session` 保持捕获值 → 照常 teardown，watchdog
   idle 自重武装链（fence-watchdog.ts:56-66）终止）——AC2 明文兑付。——ADR 映射：
   ADR-0009 L32「旧异步操作只能按 **entry identity**/generation 清理自己」的字面落实
   （identity 判据）；判据健全性依据 #134 修订节 L245（session 终态释放槽位、再 open =
   新 session 对象，不复用 ⇒「先不等后复等」不可达）。epoch 判别仅保留于 §D2 收口
   续体的 wire 副作用门（独立局部变量）。
3. **排队前捕获纪律（R1 #1；修正初稿代码缺陷）**：`cleanupResources()` 于**排队前**
   在 caller 同步栈求值 claim——初稿把 `claimForDisposal()` 写进任务 lambda（= 执行期
   捕获），可经「T1 挂 drain 期间连接 fatal 补排 T2 → blocked 后 re-add 重建 gen2 →
   放行后 T2 执行时捕获 gen2 字段且 epoch 恒等」杀新代（SA2 #1 攻击路径）；§D2/§D3
   同步对齐（onCloseRequest 同步段 / ensureCloseMemo 创建时求值）。closing 分支
   Lost 不排队 / Fatal 保底排队的不对称 = 有意（不变量 I-C：进入 closing 的仅有入口
   均在同步段排队带 claim 处置）。——ADR 映射：ADR-0009 L32 generation 纪律的严格执行。
4. **GOAWAY 两层静默（R1 #4；细化首轮第 5 条）**：RESTARTING 收帧同步段 = 轻量层
   `onConnectionQuiesce`（摘订阅/清 timer/closing 承诺结算/投影 `disconnected`，
   **零处置排队**）；deadline 回调 = 全量层（`quiesceControllers` → `onConnectionFatal`
   = 轻量幂等 + 处置排队）+ transport close(1001)；处置时点与现状逐点一致（D5 计面
   逐值不变的根据，§13.2 重推四检查点）。SHUTTING_DOWN/REAUTH → `enterBlocked`
   收帧即全量（现状不变）。——ADR 映射：#161 修订节「GOAWAY/blocked/连接收口同步
   静默**订阅**先于异步 drain」的逐字对位——同步层 = 订阅静默（+timer/投影），
   异步层 = drain 处置与 transport；ADR-0010 L147「GOAWAY提供相对drain timeout」
   归属不变；处置留 deadline 与协议 §6.3「现有 namespace 到 deadline 前自然收口」一致。
5. **drain 窗口 SYNC_APPLIED 对称放行（R1 #8；替代首轮第 5 条中的 SYNC_APPLIED 抑制）**：
   peer 维持既有 epoch 门**零改动**（drain 窗口连接存活、epoch 未变 → 照发，完成在途
   round 收尾；B-1 守卫防 disconnected 复活）；hub 补 `isQuietState` 门（通道已静默的
   迟到续体零 wire）。初稿「消耗死连接出站序列」理由撤回（drain 窗口连接存活，
   G5-③ 断言 connState 恒 ready）。——ADR 映射：ADR-0010 L149「双方Step2完成
   sequenced apply + dirty后以SYNC_APPLIED确认」既有语义保持；与 UPDATE_ACK
   （协议 §9.4 已接纳工作 ACK 义务）统一口径。
6. **取得后失败出口中止判别（R1 #5）**：registry.open 之后**每一个失败出口**
   （!opened.ok / getStatus throw / replication disabled / REPLICATION_ID/EPOCH_MISMATCH /
   openReplicationSession 拒绝）先判 `isOpenAborted()`——中止 → `finishOpenSilently`
   （含已取得资源）静默回收，不向已静默连接补发 ERROR。——ADR 映射：ADR-0010 L151
   恢复纪律「迟到续体零 wire」家族的强化（无条款被触碰，收紧行为面）。
7. **openWaiters 中止处置裁决 (a)（R1 #6）**：startOpen 续体中止时 waiters 整体静默
   丢弃——总则 3 零 wire 优先；peer 由 openTimeout → failed → 重连后按协议 §7 L166
   收 `NAMESPACE_REOPEN_REQUIRES_RECONNECT` 闭环（应答义务在连接存活窗口成立）；
   与现状一致（非回归），登记 §13.3 不变式。——ADR 映射：无对应 ADR 条款（协议 §7
   应答义务的窗口界定，非门禁基准）。
8. **enqueueLifecycle 吞错纪律（R1 #7）**：任务体结构性零 throw（unsubscribe 包
   try/catch、session.close/lease.release 各自 `.catch(()=>undefined)`）+
   fire-and-forget 调用点一律显式 `.catch(()=>undefined)`；返回值 rejection 只传播给
   显式 await 方（ensureCloseMemo body）；链尾吞错保留。——ADR 映射：无（实现纪律），
   与 #134 修订节 L246「永不 reject」一致。

### R1 建议新增红灯锚（设计 §13.4，SA6 决策项）

P3b（排队前捕获+身份守卫的杀新代防护）、C4b（hub 发起 closing 窗口错配 CLOSE_OK →
`ACK_STATE_VIOLATION` fatal，**不得 silent completion**）、L1（intent='removed' 新代
永不 open 路径的 watchdog/channel 零泄漏）、W1（取得后失败中止零 wire）、W2（waiter
静默丢弃裁决 (a) 固化）、W3（drain 窗口 SYNC_APPLIED 对称放行固化）。

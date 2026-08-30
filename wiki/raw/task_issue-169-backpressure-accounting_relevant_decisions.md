# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（issue #169：连接级背压记账与控制保留额度修正）。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
>
> - 被审对象：`wiki/raw/task_issue-169-backpressure-accounting.md`（bug，Phase 5 follow-up，parent #130）。
> - 冲突基准：`docs/adr/` 全部 10 个 ADR（全读，无抽样）+ `CONTEXT.md`。
> - `docs/protocols/instance-replication-v1.md` 的 §13.1/§14/§17/§18 经 ADR-0010 明文指定为「唯一 wire contract」（见下 L151/L296 摘录）而被 ADR **收录为约束**，本文件一并摘录；除此之外的代码与 wiki 文档不构成约束。

## 相关 ADR

### ADR-0010 Hub/Peer WebSocket Y.Doc 复制与最终一致（accepted）

- 与本任务的关联点：任务整体即 ADR-0010 Phase 5 复制的**连接级背压**实现修正（`@nomicore/ws-replication` 包内 `backpressure.ts`）；其「issue #161 round 2 修订节」直接登记了本任务要落地的背压终态口径。
- 核心条款（原文摘录）：

  - 「连接与namespace状态、消息码、payload字段、错误码、timeout、close code、backpressure和完整时序以`docs/protocols/instance-replication-v1.md`为唯一wire contract。关键恢复纪律为：连接断开即close sessions/release Leases，不保留outbox；重连重新OPEN并reconcile。Per-namespace有界队列溢出时丢弃未发送增量并进入needs-resync；connection按namespace round-robin公平发送，control/ACK保留额度，网络背压不得进入Runtime sequencer。」（§WebSocket 复制协议与状态机）

  - 「队列溢出只把 channel 标记为 `needs-resync`，不得阻塞 write sequencer。」（§Trusted raw update 与现有不变量）

  - 「以下上限均为插件配置并提供安全默认值：最大 WS frame、最大单 update/diff、每连接最大 channel 数、per-channel/连接待发送字节、bootstrap/idle timeout、心跳与失联判定。普通超限以稳定错误关闭单个 channel；framing、认证等连接级错误才关闭整条连接。」（§资源限制与 observability）

  - 「复制插件提供结构化 observer seam 给日志/metrics/trace Adapter，不提供业务公共 update events。最小观测面包括：连接状态与重连、channel 状态、bootstrap/reconcile 次数和字节、updates/bytes in/out、apply/ACK latency、backpressure resync、auth/authz failure、identity/epoch conflict、peer degraded bypass apply 和稳定错误计数。」（同节）

  - 「`@nomicore/ws-replication`：WebSocket client/server、multiplex、认证授权、bootstrap/reconcile/live 状态机、背压和 observer」（§包、应用与生命周期——背压的实现归属）

  - 「交付切片见 `docs/phases/phase-5-websocket-replication.md`」（§取代与关联——任务简报指定的 baseline 分支出处）

  - issue #161 round 2 修订节（2026-08-30；与本任务逐点对应，原文摘录）：

    「本节登记 ws-replication 实现层的八项 review 修订决策；wire 契约以 `docs/protocols/instance-replication-v1.md`（§2/§17/§18 本轮扩写）为唯一权威：……背压终态口径（pipeline = queued+buffered、shed 仅 queued 侧、严格接纳 + onDataShed 显影、控制独立保留额度 maxQueuedControlBytes 缺省 8MiB、有界整轮扫描、pending handoff 计入 per-ns 溢出双口径、checkpoint = max(1, floor(ackTimeoutMs/100))、1011 终止）；……实现证据：`packages/ws-replication/src/*`（PR #165 round 2）。」

    （省略号处为 liveness/pong/GOAWAY 等与本任务无直接关联的句段；回查 ADR-0010 L293–L303。）

### ADR-0010 收录的 wire contract：`docs/protocols/instance-replication-v1.md`（§17 背压、公平调度与上限；§13.1/§14 错误与 close code；§18 timeout）

- 与本任务的关联点：任务简报全部验收口径的权威来源（经 ADR-0010 L151/L296 收录为约束）。

- §17 每 namespace 限制（原文）：

  「`maxQueuedUpdateBytes`；`maxQueuedUpdateCount`；`maxInFlightUpdates`，默认 32；`maxUpdateBytes`；`maxBootstrapBytes`；`maxSyncDiffBytes`。」

  「未发送队列任一上限超出：丢弃全部未发送增量，标记 needs-resync，停止新 UPDATE。已发送窗口等待 ACK或连接断开；窗口收口后由 Peer开始新 reconciliation。」

- §17 连接级调度与记账（原文整段）：

  「Connection使用 per-namespace队列和 round-robin：control/error/ACK高优先级，data每轮每 namespace最多一个。总队列记账 = 每 namespace 排队字节 + socket `bufferedAmount`（连接级 pipeline）。溢出触发时按最大排队 namespace 整队丢弃至 queued 侧 ≤ low-water——shed 只作用于排队侧（socket 缓冲不可撤回，由水位暂停与 1011 承接）；**严格接纳**：shed 后（或空队列时）接纳 incoming 仍会越限则拒纳该帧并同批丢弃该 namespace 幸存排队帧，以 needs-resync 声明显影（不静默吞、不静默纳）。Control frame 使用独立保留额度 `maxQueuedControlBytes`（缺省 8 MiB；必须 ≥ `maxBootstrapBytes` + 协议开销），额度按 socket 缓冲内未冲刷控制字节计，耗尽为 `CONNECTION_BACKPRESSURE`（close 1011）。水位检查点间隔 = `max(1, floor(ackTimeoutMs / 100))`。round-robin 派发扫描有界：单轮内队首 namespace 窗口满只跳过该 namespace，连续一整轮无可派发 namespace 才停止本轮。」

- §17 水位与 Adapter 能力面（原文整段）：

  「Adapter观察 WebSocket `bufferedAmount`：超过 high-water暂停 dequeue，降至 low-water恢复。无 drain event时使用 Cordis Timer调度检查，不使用原生 timer，也不进入 Runtime sequencer。传输 Adapter 暴露三个可选能力面：`bufferedAmount`（socket 未冲刷字节；缺面视为 0——背压水位退化为不可观察，数据总量仍受准入与 1011 收口）、`ping` / `onPong`（WS 级活性；缺面 = 无活性面，零 timer 的 dormant 降级）。生产 Adapter 必须暴露三面；组合根在装配期对缺面做响亮断言（应用层缺面 = 配置错误，非运行时降级——见 issue #164）。」

- §17 配置启动验证（原文整块）：

  ```text
  maxBootstrapBytes <= maxFrameBytes - protocol overhead
  maxSyncDiffBytes <= maxFrameBytes - protocol overhead
  maxUpdateBytes <= maxFrameBytes - protocol overhead
  maxQueuedUpdateBytes >= maxUpdateBytes
  maxInFlightUpdates >= 1
  maxQueuedControlBytes >= maxBootstrapBytes + protocol overhead
  maxQueuedBytesPerConnection >= highWater   # 既有链式不变量（validate.ts 已实现，文档补记）
  所有 timeout 是有限安全整数且 > 0
  low-water < high-water
  ```

  「不得运行时 clamp。」

- §13.1 Connection error registry 相关行（原文）：「| CONNECTION_BACKPRESSURE | yes | yes | 1011 |」

- §14 WS close code（原文）：「`1011`：不可恢复内部错误或 control backpressure。」「如果 framing仍可信，关闭前 best-effort发送 connection ERROR；否则直接 close。稳定机器语义由 ERROR code定义，WS close code只做粗分类。」

- §18 Timeout（原文，涉及 `ackTimeoutMs` 的行为域）：「HELLO/pong timeout关闭连接。Open/bootstrap/reconcile/close/ACK timeout只收口 namespace；ACK timeout不重发同一 UPDATE，而进入 needs-resync并由新 state-vector round修复。」（`ackTimeoutMs` 是独立配置项；§17 检查点公式以其为输入。）

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted）

- 与本任务的关联点：**负向约束**——ADR-0010「网络背压不得进入Runtime sequencer」所指的 sequencer 即本文定义的唯一 FIFO；本任务不得让其行为受网络背压影响。
- 核心条款（原文摘录）：
  - 「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer；不同 namespace 可并行。」
  - 「Runtime 提供结构化瞬时 capability status，而不是单一扁平枚举……status 不暴露队列长度、任务类型或 sequence。」

### ADR-0009 NamespaceRegistry、调用方租约与 Cordis Host 生命周期（accepted）

- 与本任务的关联点：弱相关——连接级背压触发 needs-resync 后的恢复走 transport reset/bootstrap，对应本文与 ADR-0010 的 Lease/session 生命周期；本任务不改 Registry/Lease 公共面。
- 核心条款（原文摘录，issue #134 修订节）：
  - 「release 同步段调用既有活跃 session 的 `close()`（停接纳 + 退订 + 释放 slot；零新增方法面）；release 不追踪/取消已接纳 apply 槽」

### 无关联 ADR（已全读核对，无本任务约束条款）

ADR-0001（VFSL 单一真相源）、ADR-0002（重写定位/authority 出范围）、ADR-0003（求值器与派生 schema）、ADR-0004（类型投影）、ADR-0005（投影生成管线）、ADR-0006（Persistence；任务不动持久层）、ADR-0007（逻辑验证与 bridge；其被 ADR-0008 取代的 Runtime/open/read 条款不构成约束）。

## CONTEXT.md 相关术语与惯例

- **Hub（中心实例）**：「静态星型复制拓扑中接受 peer WebSocket 连接、转发 Yjs updates、管理 SCHEMA 与复制身份的完整 Nomicore 实例；Hub 也是可接受本地 ROOT 业务写的副本，不是 ROOT 唯一写者，也不表示自动选举的 leader。」_Avoid_: master、leader、只转发而不持有完整副本的中继。
- **Peer（边缘实例）**：「静态连接唯一 Hub 的完整 Nomicore 实例；使用独立 Persistence，断线时保持本地 ROOT 读写，重连后按 state vector/diff 与 Hub 双向合并。Peer 之间不直连，且不能本地修改 SCHEMA 或复制身份。」_Avoid_: slave、follower。
- **ReplicationSession**（与本任务相关句）：「fanout 投递有界队列溢出将 session 标记 `needs-resync`（sticky）——transport 须 reset/bootstrap。」_Avoid_: 把网络状态塞进 Runtime capability status。
- **写序列器（write sequencer）**：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。」_Avoid_: mutation queue。

---

## 设计后复审追加（2026-08-30，SA8；被审对象：SA1 设计 `task_issue-169-backpressure-accounting_design.md`）

> 只摘录设计引入的新决策点供 SA2/SA3/SA4/SA6/SA7 复用，不裁决、不改写；引用设计章节号，需要时回查设计全文。设计自称「不修订、不推翻任何既有决策」（设计 §0）——本节各条均以 ADR-0010 #161-r2 / 协议 §13.1/§14/§17/§18 为依据，非独立新决策。

- **统一连接台账组成**（设计 §3.4）：「`return this.lastObservedBuffered + this.pendingDataHandoff + this.controlUnflushed + this.totalQueuedBytes();`」——P3 观察 + P2 未吸收 data + 未冲刷控制 + Σ P1 排队；协议 §17「排队字节 + socket bufferedAmount」的实现级无缝隙落实（前置门禁对照 #1/#2 已裁定为口径落实、非口径变更）。
- **释放方向性**（设计 §3.3，I-4「只允许高估压力」）：「`pendingDataHandoff`（P2 data）**仅 deltaUp**（吸收被观察证明）」「`controlUnflushed`（未冲刷控制）**仅 deltaDown**（冲刷被观察证明）；`enterPause`/`resume`/`teardown` 窗口重置」——「吸收只释放 data 侧，冲刷只释放 control 侧」。
- **触发/接纳边界**（设计 §2 I-3）：「溢出触发用 `> cap`（恰好 cap 不触发 shed——AC-5 既有边界语义）；admission 判 `projected ≤ cap`（G2a 恰值放行锚）」；单帧守卫「`if (frameBytes > cap) return 0;`」保持（G2c 锚）。
- **shed 恢复目标与 victim**（设计 §6）：「恢复目标 = queued 侧 ≤ lowWater……`while (this.totalQueuedBytes() > this.host.limits.lowWater)`」「victim = 最大 queued 优先；并列取 wheel 序先者（不变，确定性）」；新增硬守卫「discard 后 queuedBytes 仍 > 0 即 break（防活锁）」。
- **控制额度判据窗口 = 暂停窗口（设计 §4.4 读法 B，自标「供 SA2 攻击的判断点」）**：「窗口内未冲刷控制台账（窗口起点重置、窗口内冲刷即释放）；非暂停期控制不受额度检查」；依据：「非暂停 ⇔ 观察值 ≤ highWater（socket 在排水）；越界后下一次 `sendControl` 自带的 `observeWater` 立即入窗」「缺面模式：永不暂停 → 永不检查 → 控制照流（dormant 语义一致）」。残余暴露面见设计 §14.2（「≤ 一帧 + 观察滞后」）。
- **字段迁移（无兼容层）**（设计 §4.1/§14.5）：「`controlReserveBytes: number // 64 KiB` **删除**，替换为……`readonly maxQueuedControlBytes: number; // 8 MiB`」「不保留 `controlReserveBytes` 读取/别名（G7b 硬断言缺省物无旧键）」。
- **协议开销常量**（设计 §8）：「`PROTOCOL_OVERHEAD_BYTES = 128`（validate.ts:14 既有冻结值）」用于「`limits.maxQueuedControlBytes >= limits.maxBootstrapBytes + PROTOCOL_OVERHEAD_BYTES`」启动期 TypeError（G7c/G7d：恰值合法、缺省 8MiB ≥ 4MiB+128 合法）。
- **poll 公式接线**（设计 §7）：「`this.pollIntervalMs = Math.max(1, Math.floor(host.ackTimeoutMs / 100));`」；「`ConnectionSenderHost` 新增必填 `readonly ackTimeoutMs: number`」；「删除导出常量 `BACKPRESSURE_POLL_INTERVAL_MS`」；poll 经注入 `ReplicationTimer`（协议 §17「不使用原生 timer」）。
- **不引入第二 data 调度器（I-5）与 DENY LIST**（设计 §2/§15）：「`ConnectionSender`（wheel 轮转 + drain）与 `DataSenderFacet`（通道侧）结构不动；`OutboundQueue`、`UpdateChannel`、round-engine、namespace 层零改动」；DENY LIST 另含 `docs/protocols/instance-replication-v1.md` / `docs/adr/**`（「权威文本与 ADR 是对齐目标，不是对齐对象」）。
- **网络背压零接触 sequencer（I-6）**（设计 §2）：「`backpressure.ts` 继续零 import/零 await/零回调 Runtime/Lease/Registry——本次改动不新增任何外部依赖」。
- **1011 收口接线保持**（设计 §4.3/§10）：hub `connectionFatal('CONNECTION_BACKPRESSURE', 1011)` / peer `failConnectionBackpressure()` 接线零改动；数据侧超限零 1011（G1/G4/G5 walkthrough「零 1011」）——与前置门禁注记 1 的「后订且具体条款优先」读法一致。

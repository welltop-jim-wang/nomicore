# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 任务：issue #190 — ws-replication: bound early-frame admission in acceptTrusted（bugfix）。
> 冲突基准：`docs/adr/` 全集（10 篇，全读）+ `CONTEXT.md`；裁决结论见同目录 `task_ws-replication-bound-early-frame-admission-in-accepttrusted_conflict_report.md`。

## 相关 ADR

### ADR-0010 Hub/Peer WebSocket Y.Doc 复制与最终一致（accepted，含 #134 / #133 / #161 / #172 修订节）

本任务唯一强相关 ADR——被修对象 `packages/ws-replication/src/hub-connection.ts` 的 `accept()` / `acceptTrusted()` 早期帧接纳完全落在其领地。

- 与本任务的关联点：trusted 升级路径的早期帧有界接纳是本 ADR「资源限制」纪律的接收侧兑现；close code / 观察面语义的权威指向亦由本 ADR 决定。
- 核心条款（原文摘录）：

  **资源限制（§资源限制与 observability）**
  - 「以下上限均为插件配置并提供安全默认值：最大 WS frame、最大单 update/diff、每连接最大 channel 数、per-channel/连接待发送字节、bootstrap/idle timeout、心跳与失联判定。普通超限以稳定错误关闭单个 channel；framing、认证等连接级错误才关闭整条连接。」
  - 「复制插件提供结构化 observer seam 给日志/metrics/trace Adapter，不提供业务公共 update events。」

  **wire contract 权威指向（§WebSocket 复制协议与状态机）**
  - 「连接与namespace状态、消息码、payload字段、错误码、timeout、close code、backpressure和完整时序以`docs/protocols/instance-replication-v1.md`为唯一wire contract。」
  - 「Per-namespace有界队列溢出时丢弃未发送增量并进入needs-resync；connection按namespace round-robin公平发送，control/ACK保留额度，网络背压不得进入Runtime sequencer。」

  **认证与 upgrade（§认证、授权和传输安全）**
  - 「Bearer token在HTTP Upgrade前认证；Upgrade后Peer发送HELLO，Hub回复HELLO_ACK并绑定Peer/Hub instance identity。每方向sequence从1严格递增，不回绕；gap、repeat或错误ACK关联关闭连接。」

  **受信任 transport 的授予纪律（§NamespaceLease 与 ReplicationSession / §包、应用与生命周期）**
  - 「所有 Lease 都可调用该入口，不设置不可伪造 capability；Host 搭建方负责只把 Lease 交给可信代码。」
  - 「在出现第二种 transport 前，不提前提取 transport-independent replication package。第三方 Host 可直接基于公开 NamespaceLease/ReplicationSession 构造自己的可信 transport。」

  **参考实现取舍（§参考实现取舍——不得照搬清单）**
  - 「WS handler 直接持有或写裸 Y.Doc；」「全局文档 Map 和手写 GC timer；」「REST rebuild/hard reset 作为常规恢复；」「记录完整 token；」「缺少 namespace 级授权；」「非结构化授权失败；」「不一致控制帧编码；」「通过数值范围猜测协议版本。」

  **issue #161 修订节（ws-replication 实现层八项 review 修订）**
  - 「公共身份投影只取受信 Upgrade 身份（缺身份 accept = 响亮 TypeError）；transport 三可选面（bufferedAmount/ping/onPong）缺面 dormant 语义与生产装配期断言；liveness 缺省 30s/10s 与 pongTimeout < pingInterval 构造期校验；背压终态口径（pipeline = queued+buffered、shed 仅 queued 侧、严格接纳 + onDataShed 显影、控制独立保留额度 maxQueuedControlBytes 缺省 8MiB、有界整轮扫描、pending handoff 计入 per-ns 溢出双口径、checkpoint = max(1, floor(ackTimeoutMs/100))、1011 终止）；peer pong 超时 close(1001) + 代际安全脱离后重连；GOAWAY/blocked/连接收口同步静默订阅先于异步 drain。」
  - 「wire 契约以 `docs/protocols/instance-replication-v1.md`（§2/§17/§18 本轮扩写）为唯一权威」

  **issue #172 修订节（权威契约收敛）**
  - 「**`wiki/raw` 非规范**：源码与规范中的公共行为表述必须指向 `CONTEXT.md`、ADR 或 `docs/protocols/`；`wiki/raw/` 仅为流水线历史证据（`docs/AGENTS.md` Authority 节）。」
  - 「control 保留额度公共字段……字段缺省、构造期约束、记账及耗尽语义不在 ADR 重复定义，统一以 `docs/protocols/instance-replication-v1.md` §17 为权威。」

- 衍生约束（供 SA1/SA3 执行时遵守）：若本任务需要补充或变更「帧上限拒绝」的对外文档化语义（简报验收 1「documented frame-limit semantics」），落点是 `docs/protocols/instance-replication-v1.md`（唯一 wire contract），不是 `wiki/raw/`。

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted，含 #93 / #132 修订节）

- 与本任务的关联点：**邻近不触碰**——早期帧接纳发生在 `HubConnectionImpl` 构造之前的 transport 层，不进入 write sequencer、不触达 Runtime 能力面。列出以防全链 SA 越界改动。
- 核心条款（原文摘录）：
  - 「网络背压不得进入Runtime sequencer。」（该纪律在 ADR-0010 §WebSocket 复制协议重申）
  - 「其余公共面可观测稳定码不逐码入本文，以包内**各稳定码定义处**的 append-only 注册表为准」——稳定码注册纪律的同类先例；ws-replication 的错误/close code 权威在 docs/protocols（ADR-0010），不在本 ADR。

### 其余 ADR（ADR-0001 ~ 0007、0009）

- 与本任务的关联点：无——分别冻结 VFSL 真相源、重写边界、求值器、类型投影、生成管线、Persistence、Registry/Lease；本任务不触碰 schema、持久化、Runtime 写路径或 Registry 生命周期。全量盘点与逐条对照见冲突报告。

## CONTEXT.md 相关术语与惯例

- **Hub（中心实例）**：「静态星型复制拓扑中接受 peer WebSocket 连接、转发 Yjs updates、管理 SCHEMA 与复制身份的完整 Nomicore 实例；Hub 也是可接受本地 ROOT 业务写的副本，不是 ROOT 唯一写者，也不表示自动选举的 leader。」_Avoid_:「master、leader（会误示单写权威或选举语义）、只转发而不持有完整副本的中继」
- **Peer（边缘实例）**：「静态连接唯一 Hub 的完整 Nomicore 实例；使用独立 Persistence，断线时保持本地 ROOT 读写，重连后按 state vector/diff 与 Hub 双向合并。Peer 之间不直连，且不能本地修改 SCHEMA 或复制身份。」_Avoid_:「slave、follower」
- **namespaceId**：「Registry entry 与实例复制 wire 的唯一 namespace 身份……owner 是 open/create 的本地重要属性但不上 wire，也不参与复制身份」
- **ReplicationSession**：「由 NamespaceLease 打开的受信任 duplex raw Yjs 复制会话……fanout 投递有界队列溢出将 session 标记 `needs-resync`（sticky）——transport 须 reset/bootstrap。」_Avoid_:「裸 Y.Doc WS handler、绕过本地 write sequencer 的 apply、把网络状态塞进 Runtime capability status」——注意与「运行时 fanout 投递队列」相区分：本任务的早期帧接纳缓冲在 ws-replication transport 接纳层（HubConnectionImpl 构造之前），是另一层的另一个有界队列。
- **复制未校验（replication-unvalidated）**：「Trusted raw Yjs update 已在 sequencer 中提交并登记 dirty，但未执行完整 VFSL ROOT 预校验的复制状态」——本任务不改变该语义。
- **实例角色（instance role）**：「实例静态角色 hub/peer，经 Registry 构造 `options.role` 注入……session 的 localRole 必须等于实例角色。」
- **authority 规则**：「旧系统的 `__authority__` manifest……**本仓库范围外**（ADR-0002）。」

## 设计后复审追加（SA1 设计引入的新决策点）

> SA8 设计后复审产出（verdict `clear`，见 `task_ws-replication-bound-early-frame-admission-in-accepttrusted_design_conflict_report.md`）。
> 以下为 SA1 设计新增/冻结的决策点，供 SA2 评审、SA3 实现、SA4 静态复核、SA7 动态验证复用；均经对照裁为 no-conflict。

1. **共享 admission 单点为硬约束**：`installEarlyFrameAdmission(transport, limits, emitFrameLimitRejected)` 模块私有（不导出，零公共 API）；「两入口（accept 门 3 / acceptTrusted 门 2）同一机制」是简报 Required outcome 1 的硬性要求——双份内联（方案 A）已被 SA5 根因否决（独立实现 = 单侧立法漏覆盖的产生机制）。
2. **拒绝语义完全复用既有已文档化值，零新码、零文档变更**：单帧界 → `close(1009, 'upgrade-frame-limit')` + `frame-too-large`；条数界（第 17 帧）→ `close(1008, 'upgrade-frame-limit')` + `early-frame-limit`；均经 `auth-upgrade-rejected` observer 事件发射。SA8 已逐行核验 wire contract 文档化属实（`docs/protocols/instance-replication-v1.md` :341 FRAME_TOO_LARGE→1009、:389-390 粗分类、:636 reason 闭集含两值且 pre-connection 无 connectionId）——前置「若需变更落点在 protocol doc」的衍生约束**前提不触发**，该文档在 §11 DENY 清单零改动。
3. **拒绝路径三不变量**（I3/I4/I6）：零 `HubConnectionImpl` 分配（不消耗 connectionCounter、不入 connectionList）；恒 resolve `undefined`（acceptTrusted 唯一生产 caller `apps/yjs-server/src/app.ts:274` 为 fire-and-forget，reject = unhandledRejection）；拒绝标志使后续帧/回调不可复活。
4. **§3.4 close 守卫是设计新增强化，非行为变更**：共享机制内 `transport.close` 包 try/catch——契约内 transport 行为零变化；契约外形态（close 抛出）下把 promise reject 收窄为 resolve undefined。SA4 复核时不应视为越权行为变更；无 ADR 条款涉及（B1 裁决）。
5. **§5.1 收口检查序 = 拒绝原因优先级序**：`admission.isRejected()` 必须先于 `transport.closed`/`earlyClosed` 检查——否则帧限拒绝（自身已 close transport）会被误分类为 `peer-disconnected` 并补发错误事件，违反 I2「拒绝一次定型」。
6. **文件清单冻结**（设计 §11）：唯一生产文件 `packages/ws-replication/src/hub-connection.ts`；`types.ts`（`DuplexTransport` 五成员契约、`acceptTrusted?` 可选签名）、全部邻接模块、`apps/yjs-server/**`、`docs/protocols/instance-replication-v1.md` 均 DENY 零改动；两个测试文件为 SA6 owned（断言冻结，仅许可基础设施级修复）。
7. **#172 双标注执行义务（SA3 承接）**：源码注释引用「phase5 R2 A2 / R3 N1 立法」（`MAX_EARLY_FRAMES` 注释扩展、机制 doc comment）时，须按 ADR-0010 #172 修订节既有实践做「权威指向（`docs/protocols/instance-replication-v1.md`）+ 历史证据」双标注——wiki/raw 仅为流水线历史证据，不得作源码中的唯一契约来源（B2 裁决附带义务）。

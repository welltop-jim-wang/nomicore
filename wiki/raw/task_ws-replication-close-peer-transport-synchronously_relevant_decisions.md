# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（issue #168：ws-replication peer hello timeout 同步关闭旧 transport）。
> 只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。

## ⚠ 基准来源声明（先读）

本 worktree 检出基线（main @ `b264aae`）**不含** `docs/adr/0010-*.md`、不含 CONTEXT.md 复制术语块、
不含 `docs/protocols/instance-replication-v1.md`、也不含 `packages/ws-replication/` 本体。以下
ADR-0010、CONTEXT.md 复制术语与协议文档摘录读取自 phase-5 分支线最新版：

- git ref：`origin/docs/phase-5-websocket-replication`（head `ffca4f6` = PR #185；ADR-0010 最后
  修订于 `e653adf` = PR #180，与 `origin/fix/issue-164-…` 同版）
- worktree 内 `docs/adr/0001–0009` 与 `CONTEXT.md` 基线版已逐一全文核对，与本任务均无关联条款。

全链 SA（SA1/SA3）必须在含 `packages/ws-replication` 的 phase-5 分支基线上工作，否则
`peer-connection.ts`、`onPongTimeoutDetached`、SA7 D5 锚测试
（`packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts`）均不存在。

## 相关 ADR

### ADR-0010 Hub/Peer WebSocket Y.Doc 复制与最终一致（accepted；修订至 issue #172）

- 与本任务的关联点：唯一管辖 ws-replication 传输生命周期的 ADR。本任务改的正是 peer 侧
  transport 关闭时序（hello-timeout 入口）。
- 核心条款（原文摘录）：
  - 正文「WebSocket 复制协议与状态机」：
    - 「连接与namespace状态、消息码、payload字段、错误码、timeout、close code、backpressure和完整时序以`docs/protocols/instance-replication-v1.md`为唯一wire contract。关键恢复纪律为：连接断开即close sessions/release Leases，不保留outbox；重连重新OPEN并reconcile。」
    - 「Wire不使用 channelId：每个 namespace-scope frame直接携带 namespaceId；同一连接内同一 namespace只允许一个生命周期，关闭后重开必须重建连接。」
  - 正文「资源限制与 observability」：
    - 「以下上限均为插件配置并提供安全默认值：最大 WS frame、最大单 update/diff、每连接最大 channel 数、per-channel/连接待发送字节、bootstrap/idle timeout、心跳与失联判定。普通超限以稳定错误关闭单个 channel；framing、认证等连接级错误才关闭整条连接。」
  - 修订节「issue #161 round 2 修订（PR #165 review 八项——2026-08-30）」：
    - 「wire 契约以 `docs/protocols/instance-replication-v1.md`（§2/§17/§18 本轮扩写）为唯一权威：公共身份投影只取受信 Upgrade 身份（缺身份 accept = 响亮 TypeError）；transport 三可选面（bufferedAmount/ping/onPong）缺面 dormant 语义与生产装配期断言；liveness 缺省 30s/10s 与 pongTimeout < pingInterval 构造期校验；背压终态口径（pipeline = queued+buffered、shed 仅 queued 侧、严格接纳 + onDataShed 显影、控制独立保留额度 maxQueuedControlBytes 缺省 8MiB、有界整轮扫描、pending handoff 计入 per-ns 溢出双口径、checkpoint = max(1, floor(ackTimeoutMs/100))、1011 终止）；**peer pong 超时 close(1001) + 代际安全脱离后重连**；GOAWAY/blocked/连接收口同步静默订阅先于异步 drain。」
    - ↑ 加粗处即 R4 `onPongTimeoutDetached` detach-close 序列（①–⑦）的 ADR 侧登记——本任务建议复用的正是该序列。
  - 修订节「issue #172 修订（Phase 5 权威契约收敛——2026-08-30）」第 2 条：
    - 「**`wiki/raw` 非规范**：源码与规范中的公共行为表述必须指向 `CONTEXT.md`、ADR 或 `docs/protocols/`；`wiki/raw/` 仅为流水线历史证据（`docs/AGENTS.md` Authority 节）。」
    - ↑ 任务简报/TASK.md 中「frozen behavior（dial-throw / onClose 冻结）」的出处是 PR #165 round 2 任务域冻结（wiki/raw），对全链 SA 是**任务约束**，不是 ADR 级契约。
- ADR-0002（accepted）后果节，划定 ws-replication 不在早期 ADR 约束内：
  - 「设计文档未覆盖旧服务端的其余职责（同步协议细节、持久化、presence 等），PRD 必须显式划定新服务端的功能边界」

## wire contract（经 ADR-0010 正文「唯一wire contract」条款纳入基准）

### `docs/protocols/instance-replication-v1.md`（phase-5 分支最新版，736 行）

- **§18 Timeout——pong 超时 detach 序列与次序纪律（R4 的权威定义）**：
  - 「pong 超时按临时失败处理：先停止旧 liveness、退订旧 transport listener 并使 connection epoch 失效，再关闭传输（close code 1001）并经 backoff 重连；**epoch 必须在调用可能同步重入的 transport `close()` 前失效**。」
  - ↑ 复用/折叠 detach helper 时必须保持的次序：stopLiveness → unsubscribe → **epoch 失效** → close(1001)。
- **§18——hello 超时同样关闭连接（本修复对齐的条款）**：
  - 「HELLO/pong timeout关闭连接。Open/bootstrap/reconcile/close/ACK timeout只收口 namespace；ACK timeout不重发同一 UPDATE，而进入 needs-resync并由新 state-vector round修复。」
- **§15.1 Peer connection 状态机（修复不得改变的迁移）**：
  - 「handshaking ├─ HELLO_ACK → ready ├─ timeout/temporary-close → backoff └─ auth/version/identity failure → blocked」
  - 「- 网络断开或无明确 GOAWAY的 1001：普通 backoff；\n- 1002/1008：blocked；\n- 1011：继续 backoff，连续失败后降为低频并告警，不永久 blocked。」
- **§13.1 connection error registry（wire ERROR 码域，区别于 peer 本地超时路径）**：
  - 「| HELLO_TIMEOUT | yes | yes | 1002 |」——该行是连接级 wire ERROR（hub 侧回挡/close 用）的注册表；peer 本地 hello 超时是无 wire 帧的内部路径（同 §25 `PONG_TIMEOUT`「hub 活性失联；无 wire 帧——本地内部路径」的注册姿势）。
- **§14 WS close code 粗分类**：
  - 「- `1001`：GOAWAY、计划重启或服务停止；\n- `1002`：bad framing、sequence、message、ACK等协议错误；」＋「如果 framing仍可信，关闭前 best-effort发送 connection ERROR；否则直接 close。稳定机器语义由 ERROR code定义，WS close code只做粗分类。」
- **观测面（backoff reason 词表已含 hello-timeout，修复沿用零新词）**：
  - 「| `connection-backoff-scheduled` | peer | `attempt`、`delayMs`、`reason` ∈ {dial-failed, socket-closed, hello-timeout, pong-timeout, connection-backpressure, goaway-closed, goaway-retry-hint} |」

## CONTEXT.md 相关术语与惯例（phase-5 分支最新版新增块）

- **Hub（中心实例）**：「静态星型复制拓扑中接受 peer WebSocket 连接、转发 Yjs updates、管理 SCHEMA 与复制身份的完整 Nomicore 实例；Hub 也是可接受本地 ROOT 业务写的副本，不是 ROOT 唯一写者，也不表示自动选举的 leader。」_Avoid_: master、leader
- **Peer（边缘实例）**：「静态连接唯一 Hub 的完整 Nomicore 实例；使用独立 Persistence，断线时保持本地 ROOT 读写，重连后按 state vector/diff 与 Hub 双向合并。Peer 之间不直连，且不能本地修改 SCHEMA 或复制身份。」_Avoid_: slave、follower
- 文档层级（`docs/AGENTS.md` Authority 节，经 ADR-0010 #172 修订引用）：CONTEXT.md 词汇 → docs/adr/ 架构决策 → docs/protocols/ wire 契约与状态机（规范）→ docs/phases/ 交付切片 → wiki/raw/ 仅证据。

## 与本任务无关联的 ADR（已逐份全文核对，SA 可跳过）

ADR-0001（VFSL 真相源）、0003（求值器）、0004（类型投影）、0005（生成管线）、0006（持久化；
DocHandle/flush 域）、0007（逻辑校验/runtime bridge；Runtime/open/read 条款已被 0008 取代）、
0008（NamespaceRuntime/序列器；其 close()/停接纳/RUNTIME_* 码域属 Runtime 生命周期，非 WS
transport）、0009（Registry/租约/Host；entry key 条款已被 0010 修订为仅 namespaceId）——
均不约束 peer transport 关闭时序。

---

## 设计后复审追加（SA8，2026-08-30）

> 设计后复审对照对象：`task_ws-replication-close-peer-transport-synchronously_design.md`（SA1 R0）。
> 裁决：clear（no-conflict × 12 / override × 0 / evolution × 0 / hard-violation × 0），
> 详见 `task_ws-replication-close-peer-transport-synchronously_design_conflict_report.md`。
> 以下登记 SA1 设计引入的任务内决策点，供 SA2/SA3/SA4 复用对照。

### 基线状态更新（取代上方「⚠ 基准来源声明」中的错位描述）

worktree 已重定基于 `ffca4f6`（= PR #185，phase-5 分支线 head）。ADR-0010、CONTEXT.md
复制术语块、`docs/protocols/instance-replication-v1.md` 与 `packages/ws-replication/`
本体现均在 worktree 内，全链 SA 直接读取 worktree 版本即可，无需分支线读取。

### 设计引入的任务内决策点（均判定为对齐既有决策，非 ADR 演进）

1. **close 签名裁决**：`{ code: 1001, reason: 'hello-timeout' }`——依据 §14 1001 粗类
   （GOAWAY/计划重启/服务停止）+ §15.1「网络断开或无明确 GOAWAY的 1001：普通 backoff」
   + ADR-0010 #161 round 2 修订「peer pong 超时 close(1001)」先例。reason 复用观测词表
   既有词（`PeerBackoffReason` 已含 `hello-timeout`），零新词、零新码、零 wire 帧
   （peer 本地超时 = 内部路径，同 `PONG_TIMEOUT` 注册姿势——注意实际位于协议 §23.2，
   见下方勘误）。
2. **方案 B（共享 guarded helper）**：提取私有 `detachCloseTimedOutTransport(transport,
   reason: 'pong-timeout' | 'hello-timeout')` 承载 §18 R4 次序纪律——`stopLivenessNow →
   unsubscribeTransport → epoch 失效 → close(1001)`；pong/hello 两调用点同构，守卫
   （stopping/状态/传输身份+代际双凭据）留调用点分层。pong 路径为行为字节等价的机械提取。
3. **次序**：detach-close 在 `onTemporaryFailure(reason, true)`（epochAlreadyInvalidated）
   之前执行——满足「peer 侧 close 在状态转 backoff 的同一同步栈内完成」（T1 时序锚）与
   §18「epoch 必须在调用可能同步重入的 transport `close()` 前失效」。
4. **hub 侧零改动**：hub HELLO_TIMEOUT 兜底（`connectionFatal('HELLO_TIMEOUT', 1002)`）
   保留为对硬崩溃 peer 的纵深防御；迟到 fire 撞 state 守卫为幂等 no-op。
5. **`onTemporaryFailure` 契约不变**：继续只做代际收口；传输关闭责任在调用方路径矩阵
   （hello 路径由本设计补入；dial-throw/onClose/goaway/背压四路径既有归属不变）。
6. **冻结面锁定**：dial-throw（`backoff(dial-failed)`）与 onClose（`backoff(socket-closed)`）
   两入口行为字节不变（T2/T3）；文件清单 ALLOW LIST 单文件
   `packages/ws-replication/src/peer-connection.ts`（另两个测试文件为 SA6 owned）。

### 引用勘误（前置门禁文档同源笔误）

- 本文档与 SA1 设计引用的「§25 `PONG_TIMEOUT`『无 wire 帧——本地内部路径』」——协议文档
  无 §24/§25；该文实际位于 **§23.2 稳定码闭联合**（`instance-replication-v1.md:656`）。
  摘引文字属实，仅章节号失准；按 §23.2 回查。

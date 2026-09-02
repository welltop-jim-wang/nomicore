# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。

## 任务标识

- 任务：Issue #175 — 主动 reauthentication 生命周期（Bug 修复）
- 简报：`wiki/raw/task_active-reauthentication-lifecycle.md`
- Worktree：`/home/wangjian/nomicore-fix-issue-175`
- 冲突基准：`docs/adr/0001`–`0010` 全集（10 个，已全读）+ 根目录 `CONTEXT.md`
- 说明：`docs/protocols/instance-replication-v1.md` 本身不构成独立冲突基准，但被 ADR 0010 正文明文收录为唯一 wire contract（见下 ADR-0010 条目 6），其 reauth/GOAWAY/blocked 语义经该收录成为约束载体。

## 相关 ADR

### ADR-0010 Hub/Peer WebSocket Y.Doc 复制与最终一致（accepted；含 issue #134 / #133 / #161 修订节）

`docs/adr/0010-hub-peer-websocket-ydoc-replication.md`

- 与本任务的关联点：本任务的全部 AC 都落在该 ADR 冻结的 WS 复制协议、认证授权与连接生命周期领地。
- 核心条款（原文摘录）：
  1. 「Bearer token在HTTP Upgrade前认证；Upgrade后Peer发送HELLO，Hub回复HELLO_ACK并绑定Peer/Hub instance identity。……WS ping/pong负责活性，GOAWAY提供相对drain timeout。」（认证与 GOAWAY 语义）
  2. 「连接与namespace状态、消息码、payload字段、错误码、timeout、close code、backpressure和完整时序以`docs/protocols/instance-replication-v1.md`为唯一wire contract。关键恢复纪律为：连接断开即close sessions/release Leases，不保留outbox；重连重新OPEN并reconcile。」（wire 契约收录 + 连接收口纪律；AC4/AC6/AC8 的约束来源）
  3. 「权限撤销关闭对应 channel，不必关闭整条 WS；授权结果不跨连接生命周期缓存。」（namespace 级 authz 撤销 = channel 级最小影响；AC3「不误关其他 namespace 连接」的依据）
  4. 「普通超限以稳定错误关闭单个 channel；framing、认证等连接级错误才关闭整条连接。」（认证失效属连接级 → GOAWAY 整条连接收口；AC2/AC4 的依据）
  5. 「网络状态保留在 ReplicationSession/复制插件，不塞入 Runtime 的业务 capability status。」（AC5 Peer blocked 状态必须放在复制插件/transport 层，不得进入 Runtime status）
  6. 「Token、Yjs update、SCHEMA/ROOT 内容以及未经控制的 owner/namespace 不得出现在默认日志或高基数指标标签中。」（AC7 的直接约束来源）
  7. 「停止顺序为：复制插件停止接纳连接/target，关闭 channels，等待已被 Runtime 接纳的 apply 槽完成但不无限等待网络 ACK，释放 replication leases，随后 Registry shutdown……」（AC6 与 hub.close 竞态的收口次序）
  8. issue #161 round 2 修订节：「peer pong 超时 close(1001) + 代际安全脱离后重连；GOAWAY/blocked/连接收口同步静默订阅先于异步 drain。」（1001 收口与 blocked/GOAWAY 既有实现的锚点；本任务是在其上补 Hub 主动侧）
  9. 「`instanceId` 使用 `^[a-z][a-z0-9-]{0,62}$`，仅用于连接身份、受控日志和指标」（AC1 seam 设计中定位连接/实例的既有身份词汇）
- 对本任务影响：任务是在 ADR-0010 框架内补全 Hub 侧 reauth seam（wire 契约已明文要求「已建立连接只有在认证/授权 Adapter主动发 reauth/revoke事件时关闭」——`instance-replication-v1.md` L450），实现不得引入 ADR-0010 非目标清单中的能力（如 durable outbox），也不得改变上述收口纪律。

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted；含 #93 / #132 / #134 修订节）

`docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md`

- 与本任务的关联点：约束 reauth/blocked 相关状态的归属边界与既有复制管理写词汇。
- 核心条款（原文摘录）：
  1. issue #132 修订节 5：「在正文 status 列举中补 `replication`；该域仅含持久 identity/epoch 的两态联合……不含 session、网络、队列或 sync 状态。」（blocked/dialing 等连接态不得进入 Runtime status）
  2. 正文「Runtime 提供结构化瞬时 capability status……v1 不提供公共事件订阅；队列进度和内部事件属于日志、metrics 与 trace。」（AC8 动态测试观测面应走既有 observer seam，不新增 Runtime 公共事件）
- 对本任务影响：reauth 生命周期状态（blocked、恢复拨号）属复制插件/WS 层；Runtime/Registry 公共面不需要也不应为此扩形。

### ADR-0009 NamespaceRegistry、调用方租约与 Host 生命周期（accepted；含 #131 / #134 修订节）

`docs/adr/0009-namespace-registry-leases-and-host-lifecycle.md`

- 与本任务的关联点：连接/Lease 释放次序与 shutdown 语义，是 AC6 竞态收口的既有纪律。
- 核心条款（原文摘录）：
  1. issue #134 修订节 2：「release 同步段调用既有活跃 session 的 `close()`（停接纳 + 退订 + 释放 slot；零新增方法面）；release 不追踪/取消已接纳 apply 槽。」
  2. 「首次 shutdown 在调用栈内同步进入 `shutting-down` 并停止接纳 open/create……」（hub.close/插件停止与迟到 reauth 事件竞态时，既有「停止接纳」模式可循）
- 对本任务影响：reauth 触发的连接收口应复用「先关 session、再释放 Lease」的既有次序；幂等要求（AC6）与 Lease/Registry 既有的幂等 close/release 语义同构。

### 其余 ADR（与本任务无关联，仅盘点登记）

ADR-0001（VFSL 单一真相源）、ADR-0002（重写定位/authority 出范围）、ADR-0003（求值器/ROOT/联合）、ADR-0004（类型投影）、ADR-0005（投影生成管线）、ADR-0006（持久化）、ADR-0007（逻辑校验与 bridge，open/read 条款已被 ADR-0008 取代）——均不触及 WS 认证/连接生命周期，无对本任务的约束。

## CONTEXT.md 相关术语与惯例

- **Hub（中心实例）**：「静态星型复制拓扑中接受 peer WebSocket 连接……也不是……自动选举的 leader。」_Avoid_: master、leader。→ AC2 中「Hub 可针对认证实例/连接发送 GOAWAY」与 Hub 作为通信/管理点的定位一致。
- **Peer（边缘实例）**：「静态连接唯一 Hub 的完整 Nomicore 实例……断线时保持本地 ROOT 读写，重连后……双向合并。」_Avoid_: slave、follower。→ AC5 blocked 期间 Peer 本地读写语义不变，仅拨号被抑制。
- **ReplicationSession**：「……提供 state vector……与幂等 close（`close`）……」；_Avoid_：「把网络状态塞进 Runtime capability status」。→ 与 ADR-0010 L90 同款边界，AC5 状态归属约束。
- **实例角色（instance role）**：「实例静态角色 hub/peer……生产 composition root（phase-5 切片 9）必须显式传入。」_Avoid_: 运行期角色切换。→ reauth 流程不得引入角色变化；Hub 侧 reauth 入口属 hub 角色能力。
- **namespaceId / 复制谱系 / 复制代际**：身份与 epoch 语义不受本任务影响（reauth 是连接级认证事件，不触碰 META 复制保留字段——后者按 ADR-0010「只能由 hub 的显式复制管理操作修改」）。

## wire 契约既有语义（经 ADR-0010 收录，供 SA1 直接引用）

`docs/protocols/instance-replication-v1.md`：
- L96/L141/L149：GOAWAY `0x03` 为 connection 级控制帧；「收到 GOAWAY 后停止 OPEN，不开始新 sync round；现有 namespace 到 deadline 前自然收口，之后发送方以 WS 1001 关闭。」
- L435–442：GOAWAY 原因映射——`REAUTH_REQUIRED`：blocked，等待 token/config 变化；1002/1008：blocked；无明确 GOAWAY 的 1001：普通 backoff。
- L447（§15.2）：Hub connection FSM `upgraded → handshaking → ready → draining → closed`；Hub 不包含 dial/backoff。
- L450：「Hub 不包含 dial/backoff。Bearer token轮换只影响新 Upgrade；已建立连接只有在认证/授权 Adapter主动发 reauth/revoke事件时关闭。」（本任务 AC1/AC2 所要补的 seam 即此句的 Hub 侧实现缺口）
- L524：pong 超时「关闭传输（close code 1001）并经 backoff 重连」。
- L91：「消息码是 append-only。未知 type 为 connection fatal `UNSUPPORTED_MESSAGE_TYPE`。」（REAUTH_REQUIRED 为既有 reasonCode，GOAWAY 0x03 为既有帧型——零新帧型/码的约束来源）

## 设计后复审追加（SA1 设计引入的新决策点，SA8 摘录登记；裁决见 `_design_conflict_report.md`）

> 依据 `task_active-reauthentication-lifecycle_design.md`（§2–§13），以下为设计新引入、超出任务简报字面的决策点及其 ADR/CONTEXT 锚。只摘录，不裁决。

1. **seam 形态：`HubReplication.requestReauth(instanceIdentity)` / `PeerReplication.notifyAuthChanged()`（设计 §3）**
   - 在 ws-replication 插件公共接口上**纯新增**两个成员（既有成员零变化、零签名变更）。插件接口成员清单未被任何 ADR 冻结；`src/types.ts` 头部「SA6 冻结」注释属代码层注记，且本任务 SA6 冻结契约（简报 §SA6 + `test/driver.ts` 镜像）明文要求这两项扩展。
   - 锚：ADR-0010 L174（`@nomicore/ws-replication` 职责含「认证授权」）；协议 L450（reauth 事件触发已建立连接关闭的 Hub 侧缺口）。
2. **定位键 = `authenticatedInstanceId`，绝不用 token 值（设计 §4.1）**
   - accept 分配期由 verifyToken 绑定的可信身份为唯一匹配键；未知/畸形身份 → 匹配零连接 → 无副作用 resolve。
   - 锚：ADR-0010 L155（token 映射到 instanceId）、L156（instanceId 文法与用途）、L159（token 不入日志/指标）。
3. **drain 预算 = 既有 `timeouts.closeTimeoutMs`，零新配置 knob（设计 §4.3）**
   - 「连接收口预算」复用既有载体；>0 由 `validateTimeouts` 构造期保证。锚：ADR-0010 L165（上限均为插件配置并提供安全默认值——不强制新增）；ADR-0009 L83 同款「不 fallback 系统 timer」的注入纪律仅类比，非直接条款。
4. **Hub 侧 deadline 与直发豁免（设计 §4.2/§4.5）**
   - 发送方义务：GOAWAY 发出后真正等待 drain 窗再 `close(1001, 'hub-reauth')`（区别于 `hub.close()` 的零窗停机）；生命周期控制帧不被 data 背压否决（与既有 `shutdownWithGoaway` 同族），仍走序列分配与记账。
   - 锚：协议 L148–149（「之后发送方以 WS 1001 关闭」）；ADR-0010 L151（control/ACK 保留额度）、L165（认证级错误关闭整条连接）。
5. **handshaking 连接 reauth：直接 `close(1001)`、不发 GOAWAY（设计 §4.2）**
   - 规避 GOAWAY-before-ACK 协议伤害（镜像既有 `shutdownWithGoaway` handshaking 分支）。协议未强制 hub 主动关闭前必发 GOAWAY。
6. **receiver 侧本地 elapsed deadline（设计 §6）**
   - blocked 类 GOAWAY（drainTimeoutMs>0）接收时武装，满期本端 `close(1001, 'blocked-deadline')`；`drainTimeoutMs === 0` 不武装（保持既有冻结绿测试 D5-B1 的 wire 冻结语义）；两个 blocked reasonCode（`SERVER_SHUTTING_DOWN`/`REAUTH_REQUIRED`）均武装（协议 deadline 规则不区分 reason，§15.1 只区分 deadline 后重连调度）。
   - 锚：协议 L141（「接收时开始计算本地 elapsed deadline」）、L148–149；#161 修订（「GOAWAY/blocked/连接收口同步静默订阅先于异步 drain」——deadline 武装在 `enterBlocked` 同步收口之后，次序一致）。
7. **恢复编排复用 `requestRebuild`（设计 §5/§6.4）**
   - `notifyAuthChanged` 仅 blocked 态触发既有重建编排（关旧 wire → 新代际拨号读 tokenSource 当前值）；非 blocked 态 no-op；`requestRebuild` 追加清 `drainCloseHandle`。
   - 锚：协议 L439（`REAUTH_REQUIRED`：blocked，等待 token/config 变化）、L450（token 轮换只影响新 Upgrade）；ADR-0010 L143（关闭后重开必须重建连接——rebuild 即新 wire）。
8. **零 Runtime/Registry 面改动（设计 §2/§13 DENY LIST）**
   - blocked/dialing 留在 `PeerConnectionState`（复制插件层）；`hub-namespace.ts`/`peer-namespace.ts` 及其余 src 零改动；不引入 durable outbox、Runtime 公共事件订阅、协议文本修改、角色切换。
   - 锚：ADR-0010 L90、ADR-0008 #132 修订 5（网络状态不入 Runtime status）、ADR-0010 非目标（durable outbox）、CONTEXT.md 实例角色。
9. **红灯套件两处锚点缺陷申报（设计 §10）**
   - 设计主张 IT4 L358 / IT6 L438 在任何满足 IT1/IT3/AC4 的设计下不可满足，建议 SA6 修正（IT4 L341 drain 值 / IT6 L438 删除）；SA1/SA3 不触碰测试文件，显式上报总控裁决，不静默绕过。属任务内测试资产流转，不构成 ADR/CONTEXT 冲突。

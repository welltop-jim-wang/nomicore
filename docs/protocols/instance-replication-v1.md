# Nomicore 实例复制协议 v1

状态：已接受（ADR 0010 的规范 wire contract）

本文定义 Hub 与 Peer 之间的 Nomicore 私有 WebSocket 实例复制协议 v1。它是 `@nomicore/replication-protocol` 与 `@nomicore/ws-replication` 的一致性依据，不是普通客户端协议，也不承诺兼容 `y-websocket`。

## 1. 术语与不变量

- **Hub**：接受 Peer 连接、转发 updates、管理 SCHEMA 与复制身份的完整 Nomicore 实例。Hub 不是 ROOT 唯一写者。
- **Peer**：主动连接一个 Hub、持有独立 Persistence 和完整副本的 Nomicore 实例。
- **namespaceId**：网络寻址和 Registry entry key，格式固定为 `^ns-[0-9a-f]{32}$`。普通 create 使用 128-bit CSPRNG 生成，最多碰撞重试 8 次。
- **owner**：本地存储分区与访问上下文，不上 wire。Peer target 保存自己的 local owner；Hub authorization Adapter 返回 Hub local owner。两端 owner 可以不同。
- **复制谱系**：`META.replicationId`，32 个小写 hex。
- **复制代际**：`META.replicationEpoch`，从 1 开始的安全整数。
- **ReplicationSession**：由 NamespaceLease 打开的可信 duplex raw Yjs 复制会话，不暴露 live Y.Doc。
- **连接序号**：单条 WS 连接上每个发送方向独立的 uint32 sequence，只用于在线顺序、关联与断言，不跨重连持久化。
- **同步轮次**：Peer 发起的一轮双向 state-vector reconciliation，以 uint32 `syncRoundId` 标识，不回绕。
- **实现代际（implementation generation）**：端点的实现代际，与协议版本正交，**非 protocol 版本**语义——`envelopeVersion` 恒 1、HELLO `protocolVersions` 不因代际变化（§3 两层版本独立）；代际差异仅在 HELLO capability 协商的 wire 位上可见。v1 代际 = 不含 `CAP_CHUNKED_UPDATE` 的旧实现（HELLO 恒发 `optionalCapabilities=0`，收到 `0x42` 帧按未知消息码 `UNSUPPORTED_MESSAGE_TYPE` connection fatal 拒绝）；v2 代际 = 支持 `CAP_CHUNKED_UPDATE`（§6.1）的现实现。§22 互通矩阵按代际组合刻画回落行为；不得用代际推断 `envelopeVersion` 或 `protocolVersions` 变化。

协议保持以下不变量：

1. 一条 WebSocket binary message 恰好承载一个完整 Nomicore frame；不粘连多个 frame，也不跨 message 分片。
2. 每条正常 frame 都消费本发送方向的 sequence；对端严格按期望值接收。
3. 每个 namespace frame 直接携带 namespaceId，不使用 channelId、owner 或 session nonce。
4. 同一连接内，同一 namespaceId 只允许一个生命周期；closed、conflicted 或 failed 后不得重新 open，重新 add 必须重建连接。
5. HELLO_ACK 前不得发送 namespace frame。
6. UPDATE、SYNC_STEP2 和 BOOTSTRAP_SNAPSHOT 的 bytes 在 live apply 前受大小限制（单帧上限；分块传输时另受聚合上限约束，完整重组后执行一次 apply——分块不改变本不变量）。
7. 所有远端 apply 进入本地 namespace 的唯一 write sequencer，并在槽内完成 dirty notification。
8. ACK 表示 sequenced live apply + dirty notification，不表示物理 flush、其他副本确认或 quorum durability。
9. Origin 只用于回声抑制；重连、bootstrap 竞态和队列丢弃均由 state-vector reconciliation 修复。
10. identity 或 epoch 不同的副本不自动覆盖或合并。
11. Raw replication 不执行完整 VFSL ROOT 预校验，可能进入 `replication-unvalidated`。
12. Peer→Hub update 在 live apply 前必须通过 SCHEMA 与复制身份 META 保护检查。

## 2. WebSocket 建连与认证

Bearer token 在 HTTP Upgrade 前验证。失败返回 HTTP 401/403，不建立 WebSocket。成功认证至少产生可信 Peer instanceId 和其可用授权上下文。

WebSocket 建立后，Peer 必须先发送 HELLO，Hub 必须回复 HELLO_ACK。Upgrade 身份、HELLO Peer instanceId 和配置的 Hub instanceId 必须一致。HELLO 完成前任何 namespace frame均为 `HELLO_REQUIRED` connection error。

Hub 的公共身份投影（`HubConnection.peerInstanceId`）只消费 Upgrade 认证产生的受信身份，绝不采信 HELLO 自述身份；宿主 `accept` 未提供受信身份即接线缺陷——实现必须响亮拒绝（同步 TypeError），不得降级为匿名或 wire 自述会话。

活性检测只使用 WebSocket ping/pong。协议不定义业务 PING/PONG frame。

生产部署必须由网关、反向代理或 service mesh 提供 TLS。Nomicore 允许 `ws://`，但不对 bearer token 与 Y.Doc 数据提供链路机密性保证。

## 3. 固定 envelope

所有整数使用 network byte order（big-endian）。固定头恰为 20 bytes：

| Offset | Size | Field | v1 规则 |
|---:|---:|---|---|
| 0 | 4 | magic | ASCII `NMCR`，字节 `4e 4d 43 52` |
| 4 | 1 | envelopeVersion | `1` |
| 5 | 1 | messageType | 见消息注册表 |
| 6 | 2 | flags | 必须为 `0` |
| 8 | 4 | sequence | uint32，正常 frame 从 `1` 严格递增 |
| 12 | 4 | payloadLength | payload 字节数 |
| 16 | 4 | reserved | 必须为 `0` |

WebSocket message 的实际 byteLength 必须严格等于 `20 + payloadLength`。Decoder 在复制或分配 payload 前检查 `maxFrameBytes`、magic、版本、flags、reserved、sequence 与长度。截断、尾随、长度不符、未知 mandatory type、未知 flags 或非零 reserved 均不得被忽略。

`envelopeVersion` 只定义固定头布局。HELLO 的 `protocolVersions` 定义消息语义版本；两者是独立版本层。

## 4. Payload 编码

控制 payload 使用 `lib0` canonical encoding，并将 `lib0` 声明为协议包直接依赖：

- 字符串：`varString`；
- bytes：`varUint8Array`；
- 非负整数：`varUint`；
- bool：`u8 0|1`；
- optional：`u8 0|1` 后跟值；
- list：`varUint count` 后逐项编码；
- capability bitset：固定 uint32 big-endian。

Decoder 必须完全消费 payload，拒绝截断、溢出、非 canonical 数值编码、非法 UTF-8、错误 optional marker、超出配置的 list/count/bytes，以及任何未声明尾随字节。

每个 namespace-scope payload 首字段都是：

```text
varString namespaceId
```

解码后必须严格匹配 `^ns-[0-9a-f]{32}$`。固定格式不等于省略字符串边界；保留 `varString` 使 payload 规则统一。

Yjs sync bytes 使用与锁定版本组合兼容的 `y-protocols/sync` 语义。Nomicore 外层和 payload 字段顺序才是 wire v1 contract；依赖升级必须跑旧/新实现互通矩阵。

## 5. 消息注册表

消息码是 append-only。未知 type 为 connection fatal `UNSUPPORTED_MESSAGE_TYPE`。

| Code | Message | Scope | Direction | Result/ack |
|---:|---|---|---|---|
| `0x01` | HELLO | connection | Peer→Hub | HELLO_ACK / ERROR |
| `0x02` | HELLO_ACK | connection | Hub→Peer | none |
| `0x03` | GOAWAY | connection | either | none |
| `0x04` | ERROR | either | either | never ACK |
| `0x10` | OPEN_NAMESPACE | namespace | Peer→Hub | OPEN_OK / ERROR |
| `0x11` | OPEN_OK | namespace | Hub→Peer | none |
| `0x12` | CLOSE_NAMESPACE | namespace | either | CLOSE_OK |
| `0x13` | CLOSE_OK | namespace | either | none |
| `0x20` | BOOTSTRAP_SNAPSHOT | namespace | Hub→Peer | BOOTSTRAP_ACK / ERROR |
| `0x21` | BOOTSTRAP_ACK | namespace | Peer→Hub | none |
| `0x22` | IDENTITY_CHANGED | namespace | Hub→Peer | terminal conflict |
| `0x30` | SYNC_STEP1 | namespace | either | SYNC_STEP2 |
| `0x31` | SYNC_STEP2 | namespace | either | SYNC_APPLIED |
| `0x32` | SYNC_APPLIED | namespace | either | none |
| `0x33` | RESYNC_REQUIRED | namespace | either | Peer starts new round |
| `0x40` | UPDATE | namespace | either | UPDATE_ACK |
| `0x41` | UPDATE_ACK | namespace | either | none |
| `0x42` | UPDATE_CHUNK | namespace | either | UPDATE_ACK |

`UPDATE_CHUNK`（issue #242，ADR 0013）只有经 HELLO 协商 `CAP_CHUNKED_UPDATE` 后才能使用；未协商端必须按未知/未支持消息码规则以 connection fatal `UNSUPPORTED_MESSAGE_TYPE` 拒绝。v1 代际的 HELLO 仍发 `optionalCapabilities=0`，因此 v1 代际端永不分块、也拒绝任何 0x42 帧——新旧实现互不破译（实现代际定义见 §1）。首版 `flags=0`，也没有必需的 optional capability。未来扩展只能在 HELLO 明确协商后使用，不得靠数值范围猜测。

`UPDATE_CHUNK` 的 payload 自 issue #295 起恒为 kind 首字段单形态（无新消息码、无形态协商；本协议分支尚未发布、无部署存量，issue #242 的六字段形态随之作废、其 golden vectors 由实现 ticket 改写）：`kind varUint` 为首字段，`kind ∈ {0=live-update, 1=snapshot, 2=sync-diff}`，其后为既有字段序（namespaceId/transferId/chunkIndex/chunkCount/totalBytes/bytes）；`kind=1` 时 `chunkIndex=0` 的帧在 `totalBytes` 之后、`bytes` 之前携带绑定块 `replicationId varString + replicationEpoch varUint`，`kind=2` 时 `chunkIndex=0` 的帧同位携带 `syncRoundId varUint`；`chunkIndex>0` 的帧无绑定块，凭 (连接, 方向, namespaceId, transferId) 归属既有 assembly。`transferId` 在 (连接, 方向, namespace) 作用域内从 1 严格递增、不回绕的语义不变，三种 kind 共用同一计数器。v1 代际端收到 `0x42` 照旧 `UNSUPPORTED_MESSAGE_TYPE` connection fatal。

## 6. Connection payloads

### 6.1 HELLO `0x01`

字段顺序：

| Field | Encoding | Rule |
|---|---|---|
| peerInstanceId | varString | `^[a-z][a-z0-9-]{0,62}$`，必须等于 Upgrade 身份 |
| expectedHubInstanceId | varString | 同一安全文法 |
| protocolVersions | list(varUint) | 明确枚举，降序、无重复、至少一个 |
| requiredCapabilities | uint32 BE | v1 为 0 |
| optionalCapabilities | uint32 BE | v1 为 0 |
| connectionNonce | varUint8Array | 固定 16 bytes，由 Peer 随机生成 |

capability bitset 词表（uint32 BE，append-only）：

| Bit | Name | Meaning |
|--:|---|---|
| `0x00000001` | `CAP_CHUNKED_UPDATE` | 支持分块传输：单条 UPDATE 超过 `maxUpdateBytes` 时可拆为多个自描述 `UPDATE_CHUNK` 帧（issue #242，ADR 0013）；协商位由 `selectedCapabilities` 交集返回。未协商端收到 0x42 帧必须按未知消息码规则 connection fatal |

Hub 选择双方共同支持的最高 protocol version。任一 required capability 不支持则拒绝。optional capabilities 取交集。

### 6.2 HELLO_ACK `0x02`

| Field | Encoding | Rule |
|---|---|---|
| hubInstanceId | varString | 必须等于 Peer 配置期望值 |
| protocolVersion | varUint | 选择的完整协议版本 |
| selectedCapabilities | uint32 BE | required 满足后的交集 |
| connectionNonce | varUint8Array | 原样返回 HELLO nonce |
| connectionId | varString | Hub 生成，仅用于受控 observability，不参与恢复 |

### 6.3 GOAWAY `0x03`

| Field | Encoding | Rule |
|---|---|---|
| reasonCode | varString | 稳定安全码 |
| drainTimeoutMs | varUint | 接收时开始计算本地 elapsed deadline |
| retryAfterMs | optional varUint | hint，不构成保证 |

收到 GOAWAY 后停止 OPEN，不开始新 sync round，也不接纳新的 bootstrap/sync/resync/update 工作；现有 namespace 到 deadline 前只处理自然 `CLOSE_NAMESPACE` 握手，以及结算 GOAWAY 前已发送工作的 ACK/ERROR。`SERVER_SHUTTING_DOWN` drain 窗口内，Hub 对 `OPEN_NAMESPACE` 返回 namespace `ERROR(NAMESPACE_REOPEN_REQUIRES_RECONNECT)`；`REAUTH_REQUIRED` drain 窗口内则静默丢弃 `OPEN_NAMESPACE`，避免认证失效后产生新的 namespace 观测。其余会启动新工作的迟到 namespace frame 静默丢弃。全部 channel 终态时发送方可提前完成 drain；否则 deadline 到达后以 WS 1001 关闭。

## 7. Namespace open 与身份

### 7.1 OPEN_NAMESPACE `0x10`

| Field | Encoding | Rule |
|---|---|---|
| namespaceId | varString | 固定格式 |
| hasLocalReplica | bool | 决定后续 identity 字段 |
| replicationId | optional varString | hasLocalReplica=true 时必有，32 lowercase hex |
| replicationEpoch | optional varUint | hasLocalReplica=true 时必有，安全整数 >=1 |

两个 identity 字段必须同时出现或同时省略。省略表示 Peer 本地不存在，要求 bootstrap；出现表示请求 reconcile。

Hub 必须先 authorization，再从 authorization 结果取得 local owner并调用 Registry open，最后读取 Hub replication identity。未授权不得泄露 namespace 是否存在；只有已获访问权的 Peer才可收到 `NAMESPACE_NOT_FOUND` 或 `REPLICATION_NOT_ENABLED`。

同一连接内 opening/open 的重复 OPEN 合流底层操作，但每个请求都收到 OPEN_OK 或 ERROR；closed/conflicted/failed 后返回 `NAMESPACE_REOPEN_REQUIRES_RECONNECT`。

### 7.2 OPEN_OK `0x11`

| Field | Encoding | Rule |
|---|---|---|
| namespaceId | varString | 请求 key |
| mode | u8 | `0=bootstrap`, `1=reconcile` |
| replicationId | varString | Hub identity |
| replicationEpoch | varUint | Hub epoch |

Mode 必须与 OPEN 声明和身份比较一致。OPEN_OK 之前不得收发该 namespace 的 bootstrap/sync/update。

## 8. Bootstrap

### 8.1 BOOTSTRAP_SNAPSHOT `0x20`

| Field | Encoding | Rule |
|---|---|---|
| namespaceId | varString | key |
| replicationId | varString | 与 OPEN_OK 一致 |
| replicationEpoch | varUint | 与 OPEN_OK 一致 |
| snapshot | varUint8Array | 完整 `Y.encodeStateAsUpdate`；单帧路径受 `maxBootstrapBytes` 上限，超上限的载荷改经 §10.3 `kind=1` chunk 序列传输（issue #295） |

Hub 在 namespace write sequencer 中编码一致基线，不等待网络发送。未超 `maxBootstrapBytes` 的 snapshot 走本单帧路径；超过 `maxBootstrapBytes` 即改经下述分块路径——这是分块的触发条件而非兼容回落（issue #295）。不 fallback HTTP。

超过 `maxBootstrapBytes` 的 snapshot（issue #295）不再直接 terminal：Hub 以 `kind=1` 的 UPDATE_CHUNK 序列经 data 路径传输——切片在出队发送时刻惰性进行（队列持完整 snapshot），每帧独立消费本发送方向 sequence、独立受 dataGateOpen 与 round-robin 每轮每 namespace 一帧调度，整笔 transfer 占 1 个 in-flight 窗口槽直至 BOOTSTRAP_ACK（发送端规则与 §10.3 逐字同构）；control 保留额度不承载任何 chunk。接收端 assembly 纯易失、作用域 = (连接, 方向, namespaceId, transferId)，此阶段尚无 Lease/ReplicationSession，记账挂在 namespaceId（OPEN_NAMESPACE 起已知）与连接级并发上限上。首 chunk 分配前校验 `totalBytes` ≤ `maxChunkedBootstrapBytes` ∧ `chunkCount` ≤ `maxChunksPerUpdate`（超限 → namespace ERROR `SNAPSHOT_TRANSFER_TOO_LARGE`，fatal、retryable config、terminal failed）；几何不一致或跨帧元数据违例 → `SNAPSHOT_TRANSFER_VIOLATION`（fatal、retryable no、terminal failed）；绑定块 `replicationId`/`replicationEpoch` 与 OPEN_OK 不一致 → 既有 `REPLICATION_ID_MISMATCH`/`REPLICATION_EPOCH_MISMATCH`。收齐并长度精确核对后执行**一次**排他复制导入（与单帧路径同一导入语义），随后以 BOOTSTRAP_ACK 结算。assembly 停滞超 `assemblyTimeoutMs` → 弃 partial，namespace 收口对齐 `BOOTSTRAP_FAILED` 语义族终局（terminal failed；此时尚无可 reconcile 的 session，恢复路径沿用 §16/§18 既有规则）。`BOOTSTRAP_TOO_LARGE` 保留于错误码注册表（append-only）；随着超限载荷改道分块，单帧路径不再触发本码。

Peer 在 detached Y.Doc apply snapshot、核对 namespace META identity、以 target 的 local owner执行排他复制导入，再打开 Lease/ReplicationSession。并发 duplicate 不覆盖、不自动改为 merge，返回 `BOOTSTRAP_FAILED`。

### 8.2 BOOTSTRAP_ACK `0x21`

| Field | Encoding | Rule |
|---|---|---|
| namespaceId | varString | key |
| ackedSequence | varUint | BOOTSTRAP_SNAPSHOT sequence（分块 snapshot 时为末 chunk 帧序） |

ACK 只表示本地导入和 Runtime/Session 建立完成——分块路径下同：重组导入完成后才发出，durability 含义不变。Peer 随后以新的 syncRoundId 发起双向 reconciliation，修复 snapshot 编码与安装之间的竞态。分块 snapshot（`kind=1` chunk 序列）安装后的竞态修复不变，同一机制覆盖；epoch fence 于 chunk 传输期间发生则 partial assembly 整体丢弃（纯易失、零 durable 残留），不起用旧 epoch 基线。

## 9. 双向 reconciliation

### 9.1 SYNC_STEP1 `0x30`

| Field | Encoding | Rule |
|---|---|---|
| namespaceId | varString | key |
| syncRoundId | varUint | Peer 创建，uint32，连接内不回绕 |
| stateVector | varUint8Array | Yjs state vector |

Peer 的首个 Step1 隐式开始 round；Hub 不自行开始 round。Hub 收到有效新 round 后发送自己的 Step1。每方向每 round 只允许一个 Step1。

### 9.2 SYNC_STEP2 `0x31`

| Field | Encoding | Rule |
|---|---|---|
| namespaceId | varString | key |
| syncRoundId | varUint | 对应当前 Step1 |
| relatedStep1Sequence | varUint | 被响应 Step1 的 sequence |
| update | varUint8Array | 按对端 state vector编码的 diff，允许空 diff |

单帧路径：diff 受 `maxSyncDiffBytes` 上限；收到后在 sequencer中 apply + dirty，随后发 SYNC_APPLIED。超过 `maxSyncDiffBytes` 的 diff 不再返回 `SYNC_DIFF_TOO_LARGE`，改经下述分块路径传输（issue #295）；不 fallback bootstrap、不做无界拆分。`SYNC_DIFF_TOO_LARGE` 保留于错误码注册表（append-only）；随着超限 diff 改道分块，单帧路径不再触发本码。

超过 `maxSyncDiffBytes` 的 diff（issue #295）以 `kind=2` 的 UPDATE_CHUNK 序列经 data 路径传输（发送端规则与 §10.3 逐字同构：惰性切片、逐帧独立 sequence 与调度、整笔占 1 个 in-flight 窗口槽直至 SYNC_APPLIED）。首 chunk 绑定块 `syncRoundId` 必须与该 round 一致，不符 → `SYNC_STATE_VIOLATION`（既有码）；后续 chunk 凭 (连接, 方向, namespaceId, transferId) 归属。接收端首 chunk 分配前校验 `totalBytes` ≤ `maxChunkedSyncDiffBytes` ∧ `chunkCount` ≤ `maxChunksPerUpdate`（超限 → namespace ERROR `SYNC_TRANSFER_TOO_LARGE`，fatal、retryable config、terminal failed）；几何不一致或跨帧元数据违例 → `SYNC_TRANSFER_VIOLATION`（fatal、retryable no、terminal failed）。收齐核对后在 sequencer 中执行**一次** apply + dirty，随后发 SYNC_APPLIED——apply 完成后才结算的时序锚与 durability 含义不变。assembly 停滞超 `assemblyTimeoutMs` → 弃 partial + `RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED}`（非终态，§9.4）。

### 9.3 SYNC_APPLIED `0x32`

| Field | Encoding | Rule |
|---|---|---|
| namespaceId | varString | key |
| syncRoundId | varUint | 当前 round |
| ackedSequence | varUint | SYNC_STEP2 sequence（分块 diff 时为末 chunk 帧序——单 ACK 结算，对齐 §10.3） |

每端维护：

- `localDiffAppliedByRemote`：本端 Step2 已收到 SYNC_APPLIED；
- `remoteDiffAppliedLocally`：本端已成功 apply 对端 Step2 并发出 SYNC_APPLIED。

两位都为 true，且未发生 overflow、identity变化或 resync request，才能进入 live。空 diff同样走完整 Step2/Applied。

重复、错序、错误 round、错误 related sequence 或错误 namespace均为 `SYNC_STATE_VIOLATION`。控制帧不靠 Yjs 幂等性静默吞掉。

### 9.4 RESYNC_REQUIRED `0x33`

| Field | Encoding | Rule |
|---|---|---|
| namespaceId | varString | key |
| reasonCode | varString | 稳定安全原因 |

`reasonCode` 词表（本节首次定义枚举；append-only——新增 reason 必须先登记后发射，未知码按通用收口处理不构成新语义）：

| reasonCode | Meaning | 现状登记 |
|---|---|---|
| `send-queue-overflow` | 本端未发送/分发出站队列溢出，需 state-vector 修复（既有发射点：hub-namespace / peer-namespace 溢出声明） | 既有既定 reason，首次成文登记 |
| `UPDATE_TRANSFER_EXPIRED` | **issue #242 / ADR 0013**：分块 transfer assembly 超时（非终态；每收一 chunk 重置的进度滑动 deadline 到期 → 接收方弃 partial 后声明）。**issue #244 发射点已落地**：接收端 assembly timeout（busy assembly 持有方，hub/peer 对称；词表登记 + wire roundtrip 自切片 1 冻结） | 本规范追加登记 |
| `SYNC_TRANSFER_EXPIRED` | **issue #295**：sync 段分块 diff（`kind=2`）assembly 超时（非终态；进度滑动 deadline 到期 → 接收方弃 partial 后声明，对齐 `UPDATE_TRANSFER_EXPIRED` 先例；对端按本节收口并开恢复 round） | 本规范追加登记 |

任一端可声明当前增量连续性作废，但始终由 Peer用新 roundId 发起下一轮。发出后不再发送新 UPDATE；已接纳 update 正常 apply/ACK。Peer等待 in-flight 窗口收口后开始新 round；断线则重连后重新 OPEN/reconcile。

协议 v1 执行周期 reconciliation。Peer 为每个 live namespace 持有一个 one-shot timer；`reconcileIntervalMs` 为正整数配置，缺省 300000 ms。timer 只在完整 round 收口并进入 live 后武装；到期时 Peer 直接进入 reconciling 并以新 roundId 发起 round，不发送 RESYNC_REQUIRED。round 进行期间不武装下一次周期 timer，因此不会出现重叠 round；期间发生的 queue overflow、ACK timeout 或显式 RESYNC_REQUIRED 仍按既有 pending-resync 规则合并为至多一个紧随其后的 round。连接断开、GOAWAY、remove/close、终态与 shutdown 必须清理 timer；重连后只有新连接代际重新 OPEN/reconcile 并进入 live 后才开始新的周期。

## 10. Live UPDATE

### 10.1 UPDATE `0x40`

| Field | Encoding | Rule |
|---|---|---|
| namespaceId | varString | key |
| update | varUint8Array | Yjs update，最大 `maxUpdateBytes` |

普通 UPDATE 只允许在 live 状态发送。Reconcile期间本地 updates进入有界未发送队列；round完成后发送。尚未分配 sequence、尚未发送的 updates允许 `Y.mergeUpdates()` 合并；发出后不得改写。

Hub 接收 Peer A update：

1. 在同一 sequencer槽完成 epoch/role gate、scratch保护检查、live apply和 dirty notification；
2. 发 UPDATE_ACK 给 A；
3. Runtime 单一 observer fan-out resulting update给其他 live Peer sessions；
4. 不回送来源 session。

同一 Hub Runtime可有多个 Leases/sessions，但只安装一个内部 Y.Doc update observer。内部可将 update包装为不可变 owned bytes并在 sessions间共享；公共 transport callback前必须保持不可变所有权纪律，不暴露可变 live引用。

### 10.2 UPDATE_ACK `0x41`

| Field | Encoding | Rule |
|---|---|---|
| namespaceId | varString | key |
| ackedSequence | varUint | UPDATE sequence |

重复或已包含的 Yjs update仍正常 ACK。每 namespace每方向采用可配置滑动窗口，默认 32 个 in-flight UPDATE。窗口满只暂停该 namespace发送，不阻塞本地写或其他 namespace。

Unknown、类型不匹配或 namespace不匹配的 ackedSequence 属 connection fatal `ACK_STATE_VIOLATION`。

### 10.3 UPDATE_CHUNK `0x42`

分块传输（issue #242–#246 / ADR 0013；跨帧规则与 assembly 状态机由 issue #243–#245 落地，issue #246 收口为本节完整 wire 契约）：单条 UPDATE 超过 `maxUpdateBytes` 且双方已协商 `CAP_CHUNKED_UPDATE` 时，发送端把完整 update 拆为多个自描述 chunk。单帧 payload 字段顺序：

| Field | Encoding | Rule |
|---|---|---|
| kind | varUint | 0=live-update / 1=snapshot / 2=sync-diff（issue #295 起恒为首字段） |
| namespaceId | varString | key（固定格式） |
| transferId | varUint | uint32，(连接, 方向, namespace) 域内从 1 严格递增，不回绕；0 非法 |
| chunkIndex | varUint | uint32，0-based，< chunkCount |
| chunkCount | varUint | uint32，≥ 1 |
| totalBytes | varUint | uint32，完整 update 字节数，≥ bytes.byteLength |
| bytes | varUint8Array | 本分片，非空；大小复用 `maxUpdateBytes`（零新 frame 级上限） |

codec 级单帧规则（encode/decode 同一套，违者 `MALFORMED_FRAME`）：namespaceId 格式、transferId ≥ 1、chunkIndex < chunkCount、chunkCount ≥ 1、bytes 非空且 ≤ totalBytes、bytes ≤ `maxUpdateBytes`（超限 `UPDATE_TOO_LARGE`）。

**单形态（issue #295）**：payload 恒以 `kind varUint` 为首字段（`0=live-update` / `1=snapshot` / `2=sync-diff`），其后字段序不变；`kind=1` 的首 chunk（`chunkIndex=0`）在 `totalBytes` 之后、`bytes` 之前携带绑定块 `replicationId varString + replicationEpoch varUint`，`kind=2` 的首 chunk 同位携带 `syncRoundId varUint`；`chunkIndex>0` 的帧无绑定块。codec 级单帧规则追加：`kind ∈ {0,1,2}`、绑定块当且仅当 `kind≠0 ∧ chunkIndex=0` 时存在（违者 `MALFORMED_FRAME`）。三种 kind 共用同一 `transferId` 计数器，作用域语义不变。v1 代际端收到 `0x42` 照旧 `UNSUPPORTED_MESSAGE_TYPE` connection fatal。kind≠0 的 transfer 规则（发送端惰性切片、data 路径逐帧调度、接收端二维校验 + 一次性分配 + 纯易失 assembly）与本节逐字同构；kind 相关的聚合上限、绑定块核对与终局语义分别由 §8.1（snapshot）与 §9.2（sync-diff）定义。

**transfer 身份**：`transferId` 为 uint32，作用域 = (连接, 方向, namespaceId)，在同一作用域内从 1 严格递增、不回绕；0 非法（单帧规则已载，跨帧节重申域语义）。同一 transfer 内 `chunkIndex`/`chunkCount`/`totalBytes` 的声明逐字节一致。

**发送端规则**：

- 仅当 `bytes.byteLength > maxUpdateBytes` ∧ 已协商 `CAP_CHUNKED_UPDATE` ∧ channel live 时进入分块；切片在出队发送时刻惰性进行（队列持完整 update，`maxQueuedUpdateBytes`/`maxQueuedUpdateCount` 记账口径不变）。
- 每帧独立消费本发送方向 sequence，独立受 dataGateOpen 与 round-robin 每轮每 namespace 一帧调度（窗口空位允许时小 UPDATE 可穿插）。
- 整笔 transfer 占 1 个 in-flight 窗口槽直至末 chunk 的 ACK；ACK 计时锚 = 末 chunk 出站时刻（`ackTimeoutMs` 语义不变）。
- 中止复用既有机制（连接 shed / 队列溢出 / ACK timeout / RESYNC_REQUIRED / 终态）：未完成 transfer 的余下 chunk 不再出站，已出站前缀由接收端按丢弃路径清理。

**接收端规则**：

- assembly 纯易失，作用域 = (连接, 方向, namespaceId, transferId)；连接断开、namespace close/终态、GOAWAY drain、epoch fence、RESYNC_REQUIRED ⇒ 全部丢弃（partial 绝不进入 live 路径）。
- 首 chunk 在分配前完成二维声明上界校验（`totalBytes` ≤ `maxChunkedUpdateBytes` ∧ `chunkCount` ≤ `maxChunksPerUpdate`）与几何一致校验（`totalBytes` ≤ `chunkCount` × `maxUpdateBytes` ∧ `chunkCount` ≥ 1），通过后按已验证上界一次性分配 detached buffer。
- 后续 chunk 要求 `transferId`/`totalBytes`/`chunkCount` 与首 chunk 逐字节一致 ∧ `chunkIndex === 已收数量` ∧ `bytes.byteLength` ≤ `maxUpdateBytes` ∧ Σbytes ≤ `totalBytes`。
- 收齐 ⇒ 长度精确核对（Σbytes === `totalBytes`）⇒ **一次** sequenced `applyRemoteUpdate()` + dirty notification ⇒ `UPDATE_ACK`（ackedSequence = 末 chunk 帧序）；重组失败一律发生在 apply 之前，live Y.Doc 零写入。
- 错误码三分类映射（与 §13.2 注册表逐字同向，不得合并叙述；`kind=1`/`kind=2` 时本映射的 `UPDATE_*` 码按 §8.1/§9.2 替换为 `SNAPSHOT_*`/`SYNC_*` 对应码，`totalBytes` 聚合上限按 kind 分别取 `maxChunkedBootstrapBytes`/`maxChunkedSyncDiffBytes`，分类结构不变）：
  - 首 chunk 声明超限（`totalBytes` > `maxChunkedUpdateBytes` ∨ `chunkCount` > `maxChunksPerUpdate`）⇒ namespace ERROR `UPDATE_TRANSFER_TOO_LARGE`（fatal、retryable config、terminal failed）；
  - 几何不一致 / 后续帧跨帧违例（transferId/totalBytes/chunkCount 不一致、`chunkIndex` ≠ 已收数量、bytes 超 `maxUpdateBytes`、Σbytes 超 `totalBytes`、收齐核对失败）/ 连接级并发 assembly 超 `maxConcurrentAssembliesPerConnection` ⇒ namespace ERROR `UPDATE_TRANSFER_VIOLATION`（fatal、retryable no、terminal failed；并发超额为 ns 级、连接保持 ready）；
  - assembly 停滞超 `assemblyTimeoutMs`（每收一 chunk 重置的进度滑动 deadline 到期）⇒ 丢弃 partial + `RESYNC_REQUIRED{reasonCode: UPDATE_TRANSFER_EXPIRED}`（非终态）。

解码侧未协商（`selectedCapabilities` 无 bit 0）必须在 payload 解析前以 `UNSUPPORTED_MESSAGE_TYPE` connection fatal 拒绝（分类与 §5 未知消息码规则一致，close code 1002）。

## 11. Identity fencing

### IDENTITY_CHANGED `0x22`

| Field | Encoding | Rule |
|---|---|---|
| namespaceId | varString | key |
| replicationId | varString | 新 identity |
| replicationEpoch | varUint | 新 epoch |

Hub epoch bump进入同一 write sequencer。Bump 前已接纳 update完成；bump transaction后 observer先触发 fencing；bump后旧 epoch session在槽开始 gate拒绝。Hub发送 IDENTITY_CHANGED并关闭该 namespace session，Peer进入 conflicted，不把该 META update当普通 live UPDATE继续运行。

## 12. Namespace close

### CLOSE_NAMESPACE `0x12`

| Field | Encoding | Rule |
|---|---|---|
| namespaceId | varString | key |
| reasonCode | varString | 正常 remove/drain原因 |

Receiver同步停止 session接纳，已被 sequencer接纳的 apply无条件完成，然后 close session、release Lease并发 CLOSE_OK。不得在 sequencer槽内 await cleanup。

### CLOSE_OK `0x13`

| Field | Encoding | Rule |
|---|---|---|
| namespaceId | varString | key |
| ackedSequence | varUint | CLOSE_NAMESPACE sequence |

正常 close不等待丢失的 UPDATE_ACK；下次连接通过 state vector修复。终止性 namespace ERROR 已经完成收口，不再追加 CLOSE握手。

## 13. ERROR

ERROR `0x04` payload：

| Field | Encoding | Rule |
|---|---|---|
| scope | u8 | `0=connection`, `1=namespace` |
| code | varString | append-only稳定 ASCII code |
| fatal | bool | 由 code registry固定 |
| retryable | bool | 由 code registry固定 |
| relatedSequence | optional varUint | 若与特定 frame相关 |
| namespaceId | optional varString | namespace scope必有 |
| safeMessage | varString | 稳定、无身份/数据/cause文本 |

Encoder从 code registry导出 scope/fatal/retryable/terminalState，调用方不能覆盖。ERROR永不被 ACK。

### 13.1 Connection error registry

| Code | Fatal | Retryable | WS close |
|---|---:|---:|---:|
| BAD_MAGIC | yes | no | 1002 |
| UNSUPPORTED_ENVELOPE_VERSION | yes | no | 1002 |
| MALFORMED_FRAME | yes | no | 1002 |
| FRAME_LENGTH_MISMATCH | yes | no | 1002 |
| FRAME_TOO_LARGE | yes | config | 1009 |
| UNSUPPORTED_FLAGS | yes | no | 1002 |
| UNSUPPORTED_MESSAGE_TYPE | yes | no | 1002 |
| SEQUENCE_VIOLATION | yes | no | 1002 |
| HELLO_REQUIRED | yes | no | 1002 |
| HELLO_TIMEOUT | yes | yes | 1002 |
| UNSUPPORTED_PROTOCOL_VERSION | yes | config | 1002 |
| UNSUPPORTED_CAPABILITY | yes | config | 1002 |
| INSTANCE_IDENTITY_MISMATCH | yes | config | 1008 |
| CONNECTION_POLICY_VIOLATION | yes | config | 1008 |
| ACK_STATE_VIOLATION | yes | no | 1002 |
| CONNECTION_BACKPRESSURE | yes | yes | 1011 |
| INTERNAL_ERROR | yes | yes | 1011 |

`config` 表示只有配置/部署变化后才重试，不是当前连接自动重试。

### 13.2 Namespace error registry

| Code | Fatal for namespace | Retryable | Terminal state |
|---|---:|---:|---|
| TARGET_NOT_REQUESTED | yes | config | failed |
| NAMESPACE_REOPEN_REQUIRES_RECONNECT | yes | reconnect | closed |
| NAMESPACE_UNAUTHORIZED | yes | config | failed |
| NAMESPACE_NOT_FOUND | yes | config | failed |
| REPLICATION_NOT_ENABLED | yes | config | failed |
| REPLICATION_ID_MISMATCH | yes | reset | conflicted |
| REPLICATION_EPOCH_MISMATCH | yes | reset | conflicted |
| NAMESPACE_STATE_VIOLATION | yes | no | failed |
| SYNC_STATE_VIOLATION | yes | no | failed |
| BOOTSTRAP_TOO_LARGE | yes | config | failed |
| BOOTSTRAP_FAILED | yes | reconnect | failed |
| SYNC_DIFF_TOO_LARGE | yes | config | failed |
| UPDATE_TOO_LARGE | yes | config | failed |
| PROTECTED_FIELD_MUTATION | yes | no | failed |
| ROLE_VIOLATION | yes | no | failed |
| PERSISTENCE_DEGRADED | yes | recovery | failed |
| APPLY_FAILED | yes | reconnect | failed |
| ACK_TIMEOUT | no | resync | needs-resync |
| NAMESPACE_TIMEOUT | yes | reconnect | failed |
| INTERNAL_ERROR | yes | reconnect | failed |
| UPDATE_TRANSFER_VIOLATION | yes | no | failed |
| UPDATE_TRANSFER_TOO_LARGE | yes | config | failed |
| SNAPSHOT_TRANSFER_VIOLATION | yes | no | failed |
| SNAPSHOT_TRANSFER_TOO_LARGE | yes | config | failed |
| SYNC_TRANSFER_VIOLATION | yes | no | failed |
| SYNC_TRANSFER_TOO_LARGE | yes | config | failed |

`UPDATE_TRANSFER_VIOLATION`（跨 chunk violation，对齐 `SYNC_STATE_VIOLATION` 先例）与 `UPDATE_TRANSFER_TOO_LARGE`（分块资源上限超限，对齐 `SYNC_DIFF_TOO_LARGE` 语义族）为 issue #242 / ADR 0013 追加。**issue #244 发射点已落地**：接收端首 chunk 声明超资源上限（`totalBytes` 超 `maxChunkedUpdateBytes` / `chunkCount` 超 `maxChunksPerUpdate`）→ `UPDATE_TRANSFER_TOO_LARGE`；跨帧元数据违例与连接级并发 assembly 超额（第 `maxConcurrentAssembliesPerConnection`+1 个并发首 chunk，简报显式裁决）→ `UPDATE_TRANSFER_VIOLATION`。两码均 fatal、terminal failed（VIOLATION retryable no / TOO_LARGE retryable config）。

issue #295 追加四码（sync 段分块传输）：`SNAPSHOT_TRANSFER_VIOLATION`/`SYNC_TRANSFER_VIOLATION` 对齐 `SYNC_STATE_VIOLATION` 先例（跨 chunk 元数据违例、几何不一致、连接级并发 assembly 超额），`SNAPSHOT_TRANSFER_TOO_LARGE`/`SYNC_TRANSFER_TOO_LARGE` 对齐 `SYNC_DIFF_TOO_LARGE` 语义族（首 chunk 声明超聚合上限 `maxChunkedBootstrapBytes`/`maxChunkedSyncDiffBytes`）。连接级 §13.1 零新增。

Wire永不携带 owner、token、SCHEMA、ROOT、update、stack、原始 cause或异常 message。内部 observer/trace保留 committed与exact cause，但协议只输出安全稳定字段。

## 14. WS close code

- `1000`：正常连接结束；
- `1001`：GOAWAY、计划重启或服务停止；
- `1002`：bad framing、sequence、message、ACK等协议错误；
- `1008`：身份或连接 policy错误；
- `1009`：外层 frame超限；
- `1011`：不可恢复内部错误或 control backpressure。

如果 framing仍可信，关闭前 best-effort发送 connection ERROR；否则直接 close。稳定机器语义由 ERROR code定义，WS close code只做粗分类。

## 15. Connection 状态机

### 15.1 Peer

```text
stopped
  └─ start → disconnected
disconnected
  └─ dial → connecting
connecting
  ├─ socket-open → handshaking
  ├─ temporary-failure → backoff
  └─ permanent-config-failure → blocked
handshaking
  ├─ HELLO_ACK → ready
  ├─ timeout/temporary-close → backoff
  └─ auth/version/identity failure → blocked
ready
  ├─ local-stop/GOAWAY → draining
  ├─ temporary-close → backoff
  └─ permanent protocol failure → blocked
draining
  └─ namespaces closed/deadline → stopped | backoff
backoff
  ├─ timer → connecting
  └─ stop/config-change → stopped | disconnected
blocked
  ├─ config-change → disconnected
  └─ stop → stopped
```

Backoff 使用 full jitter：

```text
cap = min(maxBackoffMs, baseBackoffMs * 2^attempt)
delay = random(0, cap)
```

只有 ready 稳定超过 `backoffResetAfterMs` 才清零 attempt。Scheduler和random必须注入测试 seam。

GOAWAY原因：

- `SERVER_RESTARTING`：关闭后按 retryAfterMs + jitter重连；
- `SERVER_SHUTTING_DOWN`：blocked，等待配置/人工 start；
- `REAUTH_REQUIRED`：blocked，等待 token/config变化；
- 网络断开或无明确 GOAWAY的 1001：普通 backoff；
- 1002/1008：blocked；
- 1011：继续 backoff，连续失败后降为低频并告警，不永久 blocked。

issue #254 注记：`ready ├─ temporary-close → backoff` 的本端触发实例
`namespace-recovery`——open/bootstrap/reconcile timer 超时使 target namespace 收口
`failed` 且 target 仍活跃（§16）时，Peer 控制器经 §18 detach-close 序列（epoch 先
失效 → close code 1001）触发，reason 串 'namespace-recovery' 属本地诊断（观测词表
见 §23.1）；不新增状态机边。

### 15.2 Hub connection

```text
upgraded → handshaking → ready → draining → closed
```

Hub 不包含 dial/backoff。Bearer token轮换只影响新 Upgrade；已建立连接只有在认证/授权 Adapter主动发 reauth/revoke事件时关闭。

## 16. Peer namespace 状态机

```text
targeted
→ opening
→ bootstrapping | reconciling
→ live
→ needs-resync
→ reconciling
→ closing
→ closed

identity/epoch mismatch → conflicted
terminal protocol/policy/internal failure → failed
```

- `closed`：正常 remove或connection drain；
- `conflicted`：只能 reset或配置变化；
- `failed`：等待连接重建或配置变化。当 failed 源于 open/bootstrap/reconcile timer
  超时（§13.2 `NAMESPACE_TIMEOUT`，本地映射）且 target 仍被需要而连接仍存活时，由
  Peer 控制器触发整连接重建：先使 connection epoch 失效再关闭传输（close code
  1001，§18 纪律），经 §15.1 backoff 重连后重新 OPEN/reconcile（issue #254）。
  wire ERROR 帧驱动的其他 `retryable=reconnect` failed（BOOTSTRAP_FAILED/
  APPLY_FAILED/INTERNAL_ERROR 收帧）与 `retryable=config/no` 族不在该自动重建触发面
  内——前者为显式未实现 follow-up（issue #254 设计 §13-1），后者保持本行等待语义；
- socket断开时，控制器投影为 disconnected，立即停止 session、排空已接纳 apply并release Lease；target保留；
- `bootstrapping`/`reconciling` 可承载分块 snapshot/diff 传输（§8.1/§9.2）；分块不新增状态，assembly 进度对状态机不可见；
- 断线期间不维持 update outbox或subscription，重连后从当前 Y.Doc state vector恢复；
- Hub 对断开 Peer执行同样 session/Lease cleanup，不影响其他 Peer。

Target controller用单一生命周期队列串行化 removeTarget、socket close、session close与Lease release。removeTarget同步把 intent标记为 removed；cleanup调用合流到同一个 Promise。随后 addTarget因本连接禁止重开而触发整连接重建。

收到 CLOSE或终止 ERROR时同步停止接纳。已被 Runtime sequencer接纳的 apply必须结算；未接纳 frame视为 closing violation。Cleanup只在 apply promises settle后执行，绝不在 sequencer槽内 await session/Lease/Registry shutdown。

## 17. 背压、公平调度与上限

每 namespace限制：

- `maxQueuedUpdateBytes`；
- `maxQueuedUpdateCount`；
- `maxInFlightUpdates`，默认 32；
- `maxUpdateBytes`；
- `maxBootstrapBytes`；
- `maxSyncDiffBytes`。

分块传输配置（issue #242 / ADR 0013 配置表为权威；安全缺省、启动期响亮验证、绝不运行时 clamp）：

- `maxChunkedUpdateBytes`（缺省 4 MiB）：单笔 chunked live-update transfer 的 `totalBytes` 申报上界（首 chunk 分配前校验）；
- `maxChunkedBootstrapBytes`（缺省 4 MiB；issue #295）：单笔 chunked snapshot transfer 的 `totalBytes` 申报上界（超限 → `SNAPSHOT_TRANSFER_TOO_LARGE`）；
- `maxChunkedSyncDiffBytes`（缺省 4 MiB；issue #295）：单笔 chunked sync-diff transfer 的 `totalBytes` 申报上界（超限 → `SYNC_TRANSFER_TOO_LARGE`）；
- `maxChunksPerUpdate`（缺省 64，约束 ≥ 1）：单笔 chunked transfer 的 `chunkCount` 申报上界（首 chunk 分配前拒绝）；issue #295 起语义推广为 kind 无关（live-update/snapshot/sync-diff 共用本键），键名不变、存量配置兼容；
- `maxConcurrentAssembliesPerConnection`（缺省 4，约束 ≥ 1）：连接级每入站方向并发 assembly 上界，kind 无关聚合（多 ns 聚合内存上界 = 本值 × max(`maxChunkedUpdateBytes`, `maxChunkedBootstrapBytes`, `maxChunkedSyncDiffBytes`)；超额 → `UPDATE_TRANSFER_VIOLATION`/`SNAPSHOT_TRANSFER_VIOLATION`/`SYNC_TRANSFER_VIOLATION`（按 kind），ns 级、连接不拆）；
- `assemblyTimeoutMs`（缺省 30_000，约束 = 有限正整数；容器 = timeouts）：接收端 assembly 进度滑动 deadline（每收一 chunk 重置），kind 无关；停滞超时按 kind 收口：live-update → 弃 partial + `RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED}`（非终态）；sync-diff → 弃 partial + `RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED}`（非终态）；snapshot → 弃 partial + `BOOTSTRAP_FAILED` 语义族终局（terminal failed，§18）。

未发送队列任一上限超出：丢弃全部未发送增量，标记 needs-resync，停止新 UPDATE。已发送窗口等待 ACK或连接断开；窗口收口后由 Peer开始新 reconciliation。

Connection使用 per-namespace队列和 round-robin：control/error/ACK高优先级，data每轮每 namespace最多一个。总队列记账 = 每 namespace 排队字节 + socket `bufferedAmount`（连接级 pipeline）。溢出触发时按最大排队 namespace 整队丢弃至 queued 侧 ≤ low-water——shed 只作用于排队侧（socket 缓冲不可撤回，由水位暂停与 1011 承接）；**严格接纳**：shed 后（或空队列时）接纳 incoming 仍会越限则拒纳该帧并同批丢弃该 namespace 幸存排队帧，以 needs-resync 声明显影（不静默吞、不静默纳）。Control frame 使用独立保留额度 `maxQueuedControlBytes`（缺省 8 MiB；必须 ≥ `maxBootstrapBytes` + 协议开销），额度按 socket 缓冲内未冲刷控制字节计，耗尽为 `CONNECTION_BACKPRESSURE`（close 1011）。水位检查点间隔 = `max(1, floor(ackTimeoutMs / 100))`。round-robin 派发扫描有界：单轮内队首 namespace 窗口满只跳过该 namespace，连续一整轮无可派发 namespace 才停止本轮。

Adapter观察 WebSocket `bufferedAmount`：超过 high-water暂停 dequeue，降至 low-water恢复。无 drain event时使用 Cordis Timer调度检查，不使用原生 timer，也不进入 Runtime sequencer。传输 Adapter 暴露三个可选能力面：`bufferedAmount`（socket 未冲刷字节；缺面视为 0——背压水位退化为不可观察，数据总量仍受准入与 1011 收口）、`ping` / `onPong`（WS 级活性；缺面 = 无活性面，零 timer 的 dormant 降级）。生产 Adapter 必须暴露三面；组合根在装配期对缺面做响亮断言（应用层缺面 = 配置错误，非运行时降级——见 issue #164）。`ping` 每次发送 8-byte network-byte-order 的无符号 64-bit 关联凭据；RFC 6455 pong 必须回显该载荷，Adapter 的 `onPong` 必须把回显 payload 逐字节忠实交给复制层。只有 payload 与当前 outstanding ping 凭据完全相等的 pong 才能清除其 timeout；空载荷、迟到、重复或未请求 pong 一律忽略。

配置启动时响亮验证：

```text
maxBootstrapBytes <= maxFrameBytes - protocol overhead
maxSyncDiffBytes <= maxFrameBytes - protocol overhead
maxUpdateBytes <= maxFrameBytes - protocol overhead
maxQueuedUpdateBytes >= maxUpdateBytes
maxInFlightUpdates >= 1
maxQueuedControlBytes >= maxBootstrapBytes + protocol overhead
maxQueuedBytesPerConnection >= highWater   # 既有链式不变量（validate.ts 已实现，文档补记）
maxChunkedUpdateBytes <= maxQueuedUpdateBytes          # issue #244 跨字段链①
maxChunkedUpdateBytes <= maxChunksPerUpdate * maxUpdateBytes   # issue #244 跨字段链②
maxChunkedBootstrapBytes <= maxChunksPerUpdate * maxUpdateBytes  # issue #295 链②同形态
maxChunkedSyncDiffBytes <= maxChunksPerUpdate * maxUpdateBytes   # issue #295 链②同形态
maxChunksPerUpdate >= 1                            # issue #244
maxConcurrentAssembliesPerConnection >= 1          # issue #244
assemblyTimeoutMs 是有限安全整数且 > 0             # issue #244
所有 timeout 是有限安全整数且 > 0
low-water < high-water
```

不得运行时 clamp。

issue #244 跨字段链①/② 在合并配置上校验；调用方**显式配置** `maxChunkedUpdateBytes` **或** `maxChunksPerUpdate`（两链不等式的分块族操作数键）时响亮生效；缺省值自洽由配置表缺省构造成立（4 MiB ≤ 4 MiB ∧ 4 MiB ≤ 64 × 512 KiB）；仅下调既有键、未表达分块族键的存量配置不把缺省误判为用户配置错误（非追溯性）。

issue #295 追加键同纪律：调用方显式配置 `maxChunkedBootstrapBytes`/`maxChunkedSyncDiffBytes` 时对应链式校验响亮生效，缺省自洽（4 MiB ≤ 64 × 512 KiB）；未表达新键的存量配置不误判。分块路径的 chunk 经 data 路径传输、不占用 control 保留额度，但 `maxQueuedControlBytes >= maxBootstrapBytes + 协议开销` 的启动校验**原样保留**——未超单帧上限的 snapshot 仍由单帧 BOOTSTRAP_SNAPSHOT 控制帧承载，该不变量仍是其正确性前提，且配置校验为静态纪律、不因运行期行为路径而条件化。

## 18. Timeout

独立配置：

- `helloTimeoutMs`；
- `openTimeoutMs`；
- `bootstrapTimeoutMs`；
- `reconcileTimeoutMs`；
- `reconcileIntervalMs`（缺省 `300_000`）；
- `closeTimeoutMs`；
- `ackTimeoutMs`；
- `assemblyTimeoutMs`（issue #244，缺省 `30_000`）：分块 transfer assembly 的进度滑动 deadline——每收一 chunk 重置；issue #295 起适用对象扩展到 sync 段 assembly（kind 无关同一键）。停滞超时按 kind 收口：live-update → 接收方弃 partial（纯易失）+ 出向 `RESYNC_REQUIRED{reasonCode: UPDATE_TRANSFER_EXPIRED}`（非终态；对端按 §9.4 收口并开恢复 round 收敛，零 failed 终局）；sync-diff → 弃 partial + 出向 `RESYNC_REQUIRED{reasonCode: SYNC_TRANSFER_EXPIRED}`（非终态，同上）；snapshot → 弃 partial + namespace 收口对齐 `BOOTSTRAP_FAILED` 语义族（terminal failed；此时尚无 Lease/ReplicationSession 可 reconcile，恢复路径沿用 §16/§18 既有规则）；
- WS ping interval/pong timeout。

工程缺省：`pingIntervalMs = 30_000`、`pongTimeoutMs = 10_000`；约束 `pongTimeoutMs < pingIntervalMs` 在配置解析期响亮验证（TypeError），绝不运行时 clamp。pong 超时按临时失败处理：先停止旧 liveness、退订旧 transport listener 并使 connection epoch 失效，再关闭传输（close code 1001）并经 backoff 重连；epoch 必须在调用可能同步重入的 transport `close()` 前失效。

HELLO/pong timeout关闭连接。Open/bootstrap/reconcile/close/ACK timeout只收口 namespace；ACK timeout不重发同一 UPDATE，而进入 needs-resync并由新 state-vector round修复。

Open/bootstrap/reconcile timeout 收口 namespace 为 `failed` 后，若 target 仍活跃且连接仍存活，Peer 必须触发连接重建——超时的直接收口对象是 namespace，重建是 `failed` 终态的既定恢复路径（§16；issue #254）。

## 19. Authorization

Hub authorization Adapter是深 Module：

```text
authorizeNamespace(instanceIdentity, namespaceId)
→ denied
| allowed {
    localOwner,
    permissions: { read, submit }
  }
```

Remote Peer不能声明或影响 Hub owner。Peer target保存 `{ namespaceId, localOwner }`，bootstrap和后续 open使用这个本地 owner。普通 Registry open仍校验 caller owner与active entry owner；不匹配统一返回 `NAMESPACE_NOT_FOUND`。

授权只在 OPEN时检查；Adapter可选提供结构化 revoke事件，触发 namespace终止 ERROR和cleanup。没有事件则新授权在下一连接生效。Peer只接受已配置target且已发 OPEN的 namespace；未知 key返回 `TARGET_NOT_REQUESTED`，不自动创建。

## 20. Persistence degraded 与 protected apply

Hub degraded：拒绝 peer update，返回 `PERSISTENCE_DEGRADED`，保留读取和状态交换，恢复后 reconciliation。

Peer degraded：拒绝本地业务写，但认证 Hub→Peer session仍可 apply到内存并调用 `saveDoc()`；Runtime closing/fatal或handle失效不得绕过。崩溃后可从旧snapshot恢复，再由Hub diff补齐。

Peer→Hub update保护检查必须在同一 sequencer槽中：

1. 基于槽开始时的 live state创建 scratch clone；
2. apply update；
3. 比较 SCHEMA和复制身份 META；
4. 通过后紧接 live apply；
5. dirty notification。

受保护字段变化为 `PROTECTED_FIELD_MUTATION`且live零写入；scratch malformed为 `APPLY_FAILED`且live零写入；scratch内部异常为 namespace INTERNAL_ERROR且live零写入。Live commit后的 observer/dirty fatal保留内部 committed事实，wire安全关闭namespace，不自动重试非幂等 update；重连reconcile修复。

## 21. Crash、重启与停机

进程重启丢弃 connection sequence、syncRoundId、in-flight ACK、queues和协议中间状态。Persistence恢复 replicationId/epoch与Y.Doc；Host配置恢复targets；每个 namespace重新 OPEN并完整 reconcile。

停机顺序：

1. replication停止接纳连接/target，并直接以 WS 1001 关闭 Hub transport（issue #229 临时措施：不发送停机 GOAWAY）；
2. namespace停止新frame，排空已接纳apply；
3. close sessions并release replication leases；
4. Registry shutdown；
5. Persistence dispose；
6. Timer/Clock停止。

`GOAWAY` 的 `drainTimeoutMs` 在使用 GOAWAY 的连接收口路径（当前包括定向 reauthentication）中仍是网络域硬 deadline：发送方先武装 drain、发送可观测 GOAWAY，并在全部 channel 终态时提前完成；否则 deadline 到达即以 WS 1001 关闭 transport，不等待网络 ACK。

**issue #229 临时偏离：**Hub replication service close 不走上述 GOAWAY drain，而是先停止接纳、同步使连接代际与 wire 输出失效，再直接以 WS 1001 关闭 transport。只要本地 target 仍存在，Peer 必须将该无 GOAWAY 的 1001 视为普通临时断线，进入 backoff 并在同一 endpoint 恢复后重新 OPEN/reconcile。网络域的有界 deadline 在该路径退化为同步 transport close；Runtime 域不设置取消 deadline，Hub replication close Promise 必须等待停机前已接纳 apply 无条件排空、session close 与 replication lease release。宿主负责以进程级总停机 watchdog 提供整体有界退出。清理必须异常安全：即使 session close 或退订失败，也要 teardown channel 并尽力 release lease，且迟到 apply resolve/reject 不得再产生 wire 输出或 unhandled rejection。不得从 notifier 或 sequencer 槽内 await Runtime close、Lease release 或 Registry shutdown。

## 22. Conformance tests

协议实现必须提供：

- 固定 envelope和每种payload的byte-level golden vectors；
- encode/decode canonical roundtrip；
- 每个byte offset截断；
- header/payload长度少一、多一、溢出和巨大声明短body；
- 非零flags/reserved、未知版本/type/capability、非法sequence/ACK；
- trailing bytes、非法UTF-8、非法namespaceId、错误optional/list count；
- fuzz/property tests，decoder不得越界分配或抛出未分类异常；
- 版本协商全矩阵和锁定Yjs/y-protocols/lib0组合的旧/新互通矩阵；
- 分块传输（issue #242）：UPDATE_CHUNK 全字段 golden vectors、单帧语义自洽拒绝、未协商（无 `CAP_CHUNKED_UPDATE`）端对 0x42 帧按未知消息码 connection fatal 拒绝、`selectedCapabilities` 选项急切校验与 v1 代际回落（新旧互不破译；实现代际定义见 §1）；资产锚 = `0x42` 锁定值与 UPDATE_CHUNK 全字段 golden vectors `packages/replication-protocol/test/codec-messages-golden.test.ts`、未协商 0x42 拒绝与 `CAP_CHUNKED_UPDATE=0x00000001` 锁定值 `packages/replication-protocol/test/codec-issue242-ac-red.test.ts`；
- 实现代际互通矩阵（issue #246；ADR 0013 已接受，代际定义见 §1）：传输层全组合——v1 peer ↔ v2 hub、v2 peer ↔ v1 hub（未协商 ⇒ 超限丢弃 + reconciliation 的 v1 行为逐字节保持；等同性以三层确定性断言承载：`kind#sequence` 序列全等、确定性字段帧逐字段相等、Yjs 承载帧按 kind+计数——跨会话字节/长度全等因 Yjs 随机 doc client id 不适用）、v2 ↔ v2（协商分块）；v1 基线 = issue #233 刻画测试 `packages/ws-replication/test/ws-replication-issue233-repro.test.ts`；codec 层锚 = 版本协商全矩阵 + 锁定组合 golden 旧字节互通 `packages/replication-protocol/test/codec-version-interop.test.ts`；传输层锚 = `packages/ws-replication/test/ws-replication-issue246-interop-matrix.test.ts`；
- 分块 sync 传输（issue #295）：hub 与 peer 按同版本部署假设运行——`0x42` 为 kind 首字段单形态，不承诺与历史六字段形态互通；跨版本混跑的非互破译仍由既有消息码/版本握手机制响亮拒绝承载（v1 代际端对 `0x42` 帧照旧 `UNSUPPORTED_MESSAGE_TYPE` connection fatal，§5）。snapshot（`kind=1`）与 sync-diff（`kind=2`）chunk 序列经 data 路径传输、受 window/backpressure 记账；kind 首字段 + 首 chunk 绑定块的 golden vectors 已由实现 ticket 交付（冻结向量与逐字节往返断言 = `packages/replication-protocol/test/codec-issue299-ac-red.test.ts`；改写后的三条 golden = `packages/replication-protocol/test/codec-messages-golden.test.ts` 及其 `test/fixtures.ts` 字面量）；传输层 kind=1/2 端到端资产已由 issue #300 交付：验收契约 `packages/ws-replication/test/ws-replication-issue300-chunked-sync-ac-red.test.ts`（R1 分块 snapshot 收敛 / R2·R2b 双向分块 diff 收敛 / R3 data 路径闸门 / R4·R5 首 chunk 校验与绑定块 / R6 跨帧违例 / R7 发送端聚合超限 + 四条负控），机制探针 `packages/ws-replication/test/ws-replication-issue300-bulk-edge-ac.test.ts`（resync-declared 边沿弃置 / 窗口空位唤醒 / 出站被拒收口），hub 超聚合上限改写锚 = `packages/ws-replication/test/ws-replication-issue256-namespace-failed.test.ts` 场景 14；
- 分块同步完备性与 observer 8 型（issue #301；ADR 0019 L78–81 + 本节 §23.1 第 29–36 型）：`chunked-snapshot-{sent,applied,acked,aborted}` 与 `chunked-sync-{sent,applied,acked,aborted}` 的发射点、R21 改道归零、成功型互斥、键集冻结与 safe-field/throw 隔离/clock 缺省整键缺失纪律；资产锚 = 验收契约 `packages/ws-replication/test/ws-replication-issue301-chunked-completeness-ac-red.test.ts`（R1/R2 成功族 + R3/R4/R5/R8 aborted 族 + R6 safe-field 全 8 型 + R7 两态 latency + N1–N9 生命周期/调度负控）、类型镜像 `packages/ws-replication/test/ws-replication-api.test-d.ts`（36 型全联合精确断言）；
- fake duplex transport上的connection、namespace、sync、resync、drain状态迁移；
- 真实WebSocket + MemoryPersistence的1 Hub + 2 Peers收敛；
- FilePersistence独立rootDir、bootstrap、archive/reset、进程重启、degraded旧snapshot恢复；
- secret-free logs和受控metrics标签。

首批 golden vectors 的具体十六进制输出由实现票在锁定 `lib0`/`y-protocols` 版本后生成并提交；实现不得改变本文字段顺序和消息语义来适配库的偶然编码。

## 23. Observability seam（local，非 wire 契约）

本节登记 `@nomicore/ws-replication` 的**结构化 observer seam**（ADR 0010 L167、issue #177）。
属于 local seam：**不改变任何 wire 字节**，不新增帧/字段/错误码；事件词汇只描述既有协议
事实的观测投影。事件经构造函数注入的 `observer?: ReplicationObserver` 同步交付
（附带可选 `clock?: ReplicationClock` 以观测 apply/ACK latency）。Seam 是**追加式
（append-only）**：事件类型、reason/cause/via 词表、稳定码表只增不改；GA 后字段语义冻结。

### 23.1 事件词汇（36 型，分类列示——issue #238 追加第 21 型 `event-loop-delay-sampled` 及四事件面 sequence/四段差值字段；issue #256 追加第 22 型 `namespace-failed`；ADR 0018 追加第 23/24 型 `schema-rearm-applied` / `schema-rearm-failed`；issue #244 追加第 25 型 `chunked-update-aborted` 及 `ChunkedUpdateAbortReason` 词表；issue #245 追加第 26–28 型 `chunked-update-sent`/`chunked-update-applied`/`chunked-update-acked`——ADR 0013 L89–91 域键集 + §23 信封，分块 transfer 成功结算从普通族改道而来；issue #295 追加第 29–36 型 `chunked-snapshot-sent`/`-applied`/`-acked`/`-aborted` 与 `chunked-sync-sent`/`-applied`/`-acked`/`-aborted`——sync 段分块传输观测，字段集对齐既有 chunked-update-* 四型）

连接域：

| type | side | 字段 |
|---|---|---|
| `connection-state-changed` | hub/peer | `connectionId?`、`from`、`to`（连接态；hub 仅 `handshaking/ready/draining/closed`，peer 为 §15 全 8 态） |
| `connection-backoff-scheduled` | peer | `attempt`、`delayMs`、`reason` ∈ {dial-failed, socket-closed, hello-timeout, pong-timeout, connection-backpressure, goaway-closed, goaway-retry-hint, **namespace-recovery**}（issue #254 追加 `namespace-recovery`：timer 族 namespace 超时收口后的恢复性重建触发；reason 词表 7→8，append-only，事件类型 21 型不变） |
| `goaway-received` | peer | `connectionId?`、`reasonCode` ∈ {SERVER_RESTARTING, SERVER_SHUTTING_DOWN, REAUTH_REQUIRED, **other**}（未知码一律折叠 `other`——对抗高基数注入）、`drainTimeoutMs`、`retryAfterMs?` |
| `event-loop-delay-sampled` | hub/peer | **issue #238 追加（append-only 第 21 型；连接域低频采样）**：`connectionId?`、`delayMs`（= liveness ping timer 实际 fire 时刻 − 计划 fire 时刻，同一注入单调时钟域差值——event-loop 被同步长任务阻塞时到期 timer 统一后延，本值为停摆**下界信号**非精确测量；cadence = liveness `pingIntervalMs`，无新常驻 timer；gating = observer + clock + transport ping/onPong 三者齐备才武装，任一缺席 → 零状态零调度） |

channel 域：

| type | side | 字段 |
|---|---|---|
| `channel-state-changed` | hub/peer | `connectionId?`、`namespaceId`、`from`、`to`（hub 9 态 / peer 11 态） |

bootstrap / reconcile / updates 字节与 latency（每帧粒度；次数 = 事件计数）：

| type | side | 字段 |
|---|---|---|
| `bootstrap-snapshot-sent` | hub | `connectionId?`、`namespaceId`、`bytes`（BOOTSTRAP_SNAPSHOT 帧快照长度） |
| `bootstrap-imported` | peer | `connectionId?`、`namespaceId`、`bytes`（本地导入快照长度） |
| `sync-step2-sent` | hub/peer | `connectionId?`、`namespaceId`、`bytes`（出向 Step2 diff 载荷长度）、`syncRoundId`（issue #239：本 Step2 帧的 wire roundId 投影，§9.1–9.3；uint32、单连接代际内单调；sent/applied 关联键）、`encodedUpdateBytes`（issue #239：恒 === `bytes`——encoded update 长度澄清字段；`bytes` 冻结不 rename） |
| `sync-diff-applied` | hub/peer | `connectionId?`、`namespaceId`、`bytes`、`applyLatencyMs?`、`syncRoundId`（被 apply 的 Step2 帧的 roundId 投影）、`encodedUpdateBytes`（=== `bytes`）、效果字段组（issue #239，单命运——两次 SV 捕获均成功才存在，捕获异常整组折叠缺失）：`stateVectorChanged`（boolean：本侧「Step2 接纳 → apply 结算」窗口内 state vector 是否推进——观测投影，非因果归因，窗口内其他写如实计入）、`applyEffect` ∈ {changed, noop}（'changed' ⟺ stateVectorChanged）、`stateVectorBeforeHash`/`stateVectorAfterHash`（§23.3 documented safe digest）；**issue #238 追加（append-only）**：`sequence`（触发帧 = SYNC_STEP2 帧 envelope sequence，恒在场）、`queueWaitMs?`/`protectedCheckMs?`/`liveApplyMs?`/`dirtyNotifyMs?`（四段差值，registry stageClock 注入时在场——全 present 或全缺席；语义见 §23.4 issue #238 段） |
| `update-sent` | hub/peer | `connectionId?`、`namespaceId`、`bytes`（出站 UPDATE 帧 payload 长度；合并帧报合并后长度）；**issue #238 追加（append-only）**：`sequence`（出站帧 envelope sequence，恒在场——合并帧 = 该合并帧的 sequence；关联粒度 = wire 帧非业务写）、`sendQueueMs?`（帧实际出队 − 帧内最旧业务项入队；发送方进程内精确——区分 sender dispatch 与线上传输；clock 注入时在场） |
| `update-applied` | hub/peer | `connectionId?`、`namespaceId`、`bytes`、`applyLatencyMs?`；**issue #238 追加（append-only）**：`sequence`（触发帧 = UPDATE 帧 envelope sequence，恒在场）、`queueWaitMs?`/`protectedCheckMs?`/`liveApplyMs?`/`dirtyNotifyMs?`（四段差值，同上在场纪律） |
| `update-acked` | hub/peer | `connectionId?`、`namespaceId`、`bytes`、`ackLatencyMs?`；**issue #238 追加（append-only）**：`sequence`（= wire `UPDATE_ACK.ackedSequence`，恒在场——回指被 ACK 帧；与 `update-sent{sequence}`/对端 `update-applied{sequence}` 构成三事件面闭环） |
| `degraded-bypass-applied` | peer（专属） | `connectionId?`、`namespaceId`、`bytes`（§20 peer degraded 内存 apply）；**issue #238 追加（append-only）**：`sequence`（触发帧 envelope sequence，恒在场——按 §23.5 既有纪律不携时延字段） |
| `chunked-update-sent` | hub/peer | **issue #245 追加（append-only 第 26 型；ADR 0013 L89 域键集逐字 + §23 信封）**：`connectionId?`（握手后在场——分块结构性仅在握手后）、`namespaceId`、`transferId`、`chunkCount`、`totalBytes`（wire `UPDATE_CHUNK` 申报投影：受控 transferId + 计数/长度 safe-field，非内容）。**语义**：分块 transfer **完成出站时恰一**（末 chunk 帧已交宿主发送且注册在途——发射点 = 末 chunk 结算记账点），**非逐 chunk**、非 transfer 起始发射（中间 chunk 零事件）。**改道（R21）**：分块 transfer 窗口内对应普通族 `update-sent` 归零——本事件取代之。**恒无任何 latency/差值键**（clock 在场也不加——DD1 裁决；键集冻结 = 无 `sequence`/`sendQueueMs`）。**计数不变量**：每笔完成的出站 transfer 恰一事件（末 chunk 结算结构性单点——activeTransfer 生命周期）；中止 transfer 到不了本结算点 → 与 `chunked-update-aborted` 互斥 |
| `chunked-update-applied` | hub/peer | **issue #245 追加（append-only 第 27 型；ADR 0013 L90 域键集逐字 + §23 信封）**：`connectionId?`、`namespaceId`、`bytes`（= wire 声明 `totalBytes`——assembler Σbytes 精确核对不变量，长度非内容）、`chunkCount`（wire 申报）、`applyLatencyMs?`（t0/t1 既有采样点——clock 缺省/无 observer 时**整键缺失**，非 undefined 值）。**语义**：UPDATE_CHUNK 组装收齐的 apply 成功结算——apply 成功路径互斥规则第四形态（见下）；**改道（R21）**：该结算点不再发普通族 `update-applied`（窗口内归零）。**键集冻结**：无 `transferId`/`sequence`/四段差值/效果组键（DD1） |
| `chunked-update-acked` | hub/peer | **issue #245 追加（append-only 第 28 型；ADR 0013 L91 域键集逐字 + §23 信封）**：`connectionId?`、`namespaceId`、`bytes`（= wire `totalBytes`——末 chunk inFlight 记账总长）、`ackLatencyMs?`（ACK 处理时刻 − 末 chunk 出站时刻——clock 缺省/无 observer 时**整键缺失**）。**语义**：末 chunk 帧序的单 ACK 收妥结算（发送侧）；**改道（R21）**：该结算点不再发普通族 `update-acked`（窗口内归零）。**计数不变量**：每笔完成的出站 transfer 恰一事件；ACK timeout 弃置后 zombie 迟到 ACK 零事件（弃置 transfer 零成功型事件——与 aborted 互斥不变量一致）。**键集冻结**：无 `sequence` 键（帧级关联键为普通族专属——DD1） |
| `chunked-snapshot-sent` | hub | **issue #295 追加（append-only 第 29 型；字段集对齐 `chunked-update-sent`）**：`connectionId?`、`namespaceId`、`transferId`、`chunkCount`、`totalBytes`（wire 申报投影：受控标识 + 计数/长度 safe-field，非内容）。**语义**：分块 snapshot transfer（`kind=1`）完成出站时恰一（末 chunk 结算记账点），非逐 chunk。**改道（R21 平移）**：该结算点不再发普通族 `bootstrap-snapshot-sent`（窗口内归零）。**恒无任何 latency 键**；与 `chunked-snapshot-aborted` 互斥 |
| `chunked-snapshot-applied` | peer | **issue #295 追加（append-only 第 30 型；字段集对齐 `chunked-update-applied`）**：`connectionId?`、`namespaceId`、`bytes`（= wire 声明 `totalBytes`——assembler Σbytes 精确核对不变量）、`chunkCount`、`applyLatencyMs?`（clock 缺省/无 observer 时整键缺失）。**语义**：`kind=1` 组装收齐的排他复制导入成功结算；**改道**：该结算点不再发普通族 `bootstrap-imported`（窗口内归零）。**键集冻结**：无 `transferId`/`sequence`/四段差值/效果组键 |
| `chunked-snapshot-acked` | hub | **issue #295 追加（append-only 第 31 型；字段集对齐 `chunked-update-acked`）**：`connectionId?`、`namespaceId`、`bytes`（= wire `totalBytes`）、`ackLatencyMs?`（clock 缺省/无 observer 时整键缺失）。**语义**：末 chunk 帧序的单 BOOTSTRAP_ACK 收妥结算（发送侧 hub）；普通族无对应事件——本型为分块路径独有观测点，无改道。**计数不变量**：每笔完成的出站 transfer 恰一事件；与 aborted 互斥。**键集冻结**：无 `sequence` 键 |
| `chunked-sync-sent` | hub/peer | **issue #295 追加（append-only 第 32 型；字段集对齐 `chunked-update-sent`）**：`connectionId?`、`namespaceId`、`transferId`、`chunkCount`、`totalBytes`，另携 `syncRoundId`（本 transfer 所属 round 的 wire 投影，§9.1–9.3；uint32、单连接代际内单调——issue #239 safe-field 先例）。**语义**：分块 sync-diff transfer（`kind=2`）完成出站时恰一。**改道**：该结算点不再发普通族 `sync-step2-sent`（窗口内归零）。**恒无任何 latency 键**；与 `chunked-sync-aborted` 互斥 |
| `chunked-sync-applied` | hub/peer | **issue #295 追加（append-only 第 33 型；字段集对齐 `chunked-update-applied`）**：`connectionId?`、`namespaceId`、`bytes`（= wire `totalBytes`）、`chunkCount`、`syncRoundId`（被 apply transfer 的 roundId 投影）、`applyLatencyMs?`（同在场纪律）。**语义**：`kind=2` 组装收齐的 Step2 diff apply 成功结算；**改道**：该结算点不再发普通族 `sync-diff-applied`（窗口内归零）。**键集冻结**：无 `transferId`/`sequence`/四段差值/效果组键 |
| `chunked-sync-acked` | hub/peer | **issue #295 追加（append-only 第 34 型；字段集对齐 `chunked-update-acked`）**：`connectionId?`、`namespaceId`、`bytes`（= wire `totalBytes`）、`ackLatencyMs?`（同在场纪律）。**语义**：末 chunk 帧序的单 SYNC_APPLIED 收妥结算（发送侧）；普通族无对应事件——本型为分块路径独有观测点，无改道。**计数不变量**：每笔完成的出站 transfer 恰一事件；与 aborted 互斥。**键集冻结**：无 `sequence`/`syncRoundId` 键 |

**issue #239 语义注记**：发送不推进发送方 state vector，`sync-step2-sent` 不携带效果
字段组。Yjs 空 diff 编码结构性非零（§9.2 允许空 diff），`bytes > 0 ∧ applyEffect='noop'
并存即「健康 periodic no-op round」的可观测形态。全部 `bytes` 字段 = 编码后帧载荷长度
（长度非内容，亦非 logical change 计数）。`syncRoundId` 关联域 = 单连接代际（§21：
进程重启即丢弃；跨重启关联不存在）。窗口语义为**观测投影，非因果归因**：delete-set-only
修复（仅携带 tombstone 的 Step2）不推进 state vector → `applyEffect='noop'` 而 logical
state 实际变化——效果字段只回答「SV 是否推进」，issue #239 定义（derived from
before/after vector, not byteLength）与冻结契约的固有语义。

auth / 背压 / resync：

| type | side | 字段 |
|---|---|---|
| `auth-upgrade-rejected` | hub | `reason` ∈ {hub-shutdown, missing-token, verifier-missing, frame-too-large, early-frame-limit, auth-timeout, invalid-credentials, invalid-instance-id, peer-disconnected}（pre-connection：无 connectionId 字段——设计 §四攻击点 #8） |
| `resync-required` | hub/peer | `connectionId?`、`namespaceId`、`cause` ∈ {queue-overflow, send-failed, connection-shed, ack-timeout, session-fanout-overflow, remote-declared}；**issue #231 追加（append-only，仅 `cause=send-failed` 时存在）**：`reason` ∈ {update-too-large, send-frame-rejected}（区分「单笔 UPDATE 确定性超 `maxUpdateBytes`」与「未超限但发送路径返回非正 sequence」）、`updateBytes`、`maxUpdateBytes`、`queuedUpdateCount`、`queuedUpdateBytes`、`inFlightCount`（失败时刻采样，丢弃前口径）、`channelState`、`connectionState`（发射时刻投影——§23.4 决策落定后发射，`channelState` 在此事件恒为 `needs-resync`）、`bufferedAmount?`（仅 adapter 暴露 `transport.bufferedAmount` 时存在——缺面/非法 = 字段缺失，非 0）。其余 cause 零新字段 |
| `update-dropped` | hub/peer | **issue #231 追加（append-only 第 20 型）**：`connectionId?`、`namespaceId`、`reason` ∈ {update-too-large}（当前唯一形态：单笔 UPDATE 超 `maxUpdateBytes` 且**队列非空**时的 F4 静默丢弃——不声明 resync、无状态迁移，§10.2 R2-1/D4 活性保持；本事件是该路径的唯一观测信号）、`updateBytes`、`maxUpdateBytes`、`queuedUpdateCount`、`queuedUpdateBytes`、`inFlightCount`（丢弃时刻采样——被丢弃项已出队，`queued*` 为残余队列口径）、`channelState`（恒为 `live`——本路径无状态迁移）、`connectionState`（均为发射时刻投影）、`bufferedAmount?`（口径同上）。**计数不变量**：每笔超限丢弃恰一事件——队列已空 → `resync-required{cause:send-failed, reason:update-too-large}`（伴随 resync 声明）；队列非空 → `update-dropped{update-too-large}`（不声明）。丢弃项与受 Yjs 时钟缺口挂起的后续同向写由下一次 reconciliation 的 state-vector diff 修复（§9 round；diff 走控制帧路径，不受 `maxUpdateBytes` 单帧门约束） |
| `send-paused` / `send-resumed` | hub/peer | `connectionId?`、`bufferedAmount` |

稳定错误计数：

| type | side | 字段 |
|---|---|---|
| `connection-failed` | hub/peer | `connectionId?`、`code`（§23.2 闭联合）、`wsCloseCode` |
| `namespace-error` | hub/peer | `connectionId?`、`namespaceId`、`code`（§23.2 闭联合）、`direction` ∈ {sent, received}、`terminalState?` ∈ {failed, conflicted, closed} |
| `namespace-failed` | hub/peer | **issue #256 追加（append-only 第 22 型）**：`connectionId?`、`namespaceId`、`cause` ∈ {open-timeout, bootstrap-timeout, reconcile-timeout, open-failed, session-open-failed, replication-disabled, session-missing, protocol-violation, apply-refused, apply-rejected, remote-error, send-failed, internal-error}（`ReplicationNamespaceFailedCause` 闭联合，append-only；timer 族三值 = §13.2 `NAMESPACE_TIMEOUT` 的本地映射——open/bootstrap/reconcile 超时可仅凭单侧日志区分）、`timeoutMs?`（仅 timer 族 cause 在场：到期的配置上限 openTimeoutMs/bootstrapTimeoutMs/reconcileTimeoutMs——有限数值非时间戳）。**计数不变量**：每次 `failed` 终态边沿恰一事件（终态幂等早退保证——closing 期/终态后迟到的收口调用零事件）；事件在失败决策落定后发射（setState 之后，§23.4）。**与 `namespace-error` 互补不重复**：本事件计**终态边沿**，`namespace-error` 计 **wire ERROR 帧**——wire 错误驱动路径两者各一（失败聚合/告警路由以本事件 `cause` 为准）；本地零 wire 失败路径（timer 超时、本地 open/lease/session 失败、local 终局）仅本事件；`remote-error` 标记对端 ERROR 驱动的终局，防止被误计为本地故障。observer 缺省 = 零事件构造、零 live 状态读取、零时钟调用（cause/timeoutMs 实参仅为稳定字面量与 resolved 配置字段）。cause × `failed` 入口覆盖矩阵见本节附表 |
| `identity-conflicted` | hub/peer | `connectionId?`、`namespaceId`、`via` ∈ {open-mismatch, fence, identity-changed-frame} |
| `chunked-update-aborted` | hub/peer | **issue #244 追加（append-only 第 25 型；ADR 0013 observer seam reason 词表六值与中止矩阵一一平行）**：`namespaceId`、`transferId`、`reason` ∈ {timeout, shed, resync-declared, channel-teardown, connection-teardown, epoch-fence}（`ChunkedUpdateAbortReason` 闭联合，append-only）、`receivedChunks`、`receivedBytes`（已收进度：长度/计数 safe-field，非内容）。**发射端 = 丢弃 partial assembly 的一端**（接收方语义：timeout 停滞方弃置、shed/RESYNC 声明/CLOSE 收口/断线/epoch fence 的实际处置方——GOAWAY 无独立 reason，其 drain 收口归 `connection-teardown` 行；收口入口置位 + 收口链消费 = last-writer-wins）。**计数不变量**：每笔 busy→aborted 边沿恰一事件（busy 守卫——重复 clear/多清理挂点汇合至多一事件；stale fire 零副作用）；事件在决策落定后发射（§23.4）。**终局失败族不发本事件**（违例/远端 ERROR/revoke → failed 的可观测信号 = `namespace-error`/`namespace-failed`，互补不重复）；`conflicted` 族 fence 终局经本事件登记。成功路径三型（sent/applied/acked）已由 issue #245 落地（第 26–28 型，本表上列）——中止与成功路径互斥（中止 transfer 结构性不可达任一成功结算点，反之亦然）。observer 缺省 = 零事件构造、零快照读取。接线行：timeout / channel-teardown（CLOSE_NAMESPACE 收口）/ connection-teardown（断线/GOAWAY drain/stop）/ resync-declared（收对端 RESYNC、本端 wire 声明边、恢复 round 结算残渣）/ shed（live 通道连接级背压弃置）/ epoch-fence（hub one-shot 终结器、peer identity-changed/apply 期围栏）；**动态断言**（shed/epoch-fence/GOAWAY/queue-overflow/resync-declared 行 + `side` 双侧覆盖）归 SA7 动态验证面 |
| `chunked-snapshot-aborted` | hub/peer | **issue #295 追加（append-only 第 35 型；字段集对齐 `chunked-update-aborted`）**：`namespaceId`、`transferId`、`reason` ∈ 既有 `ChunkedUpdateAbortReason` 闭联合（零新词）、`receivedChunks`、`receivedBytes`。发射端 = 丢弃 partial assembly 的一端；busy→aborted 边沿恰一、决策落定后发射、终局失败族不发本事件（`SNAPSHOT_TRANSFER_*`/`BOOTSTRAP_FAILED` 族的可观测信号 = `namespace-error`/`namespace-failed`）——纪律与 `chunked-update-aborted` 逐字同构 |
| `chunked-sync-aborted` | hub/peer | **issue #295 追加（append-only 第 36 型；字段集对齐 `chunked-update-aborted`）**：`namespaceId`、`transferId`、`reason` ∈ 既有 `ChunkedUpdateAbortReason` 闭联合（零新词）、`receivedChunks`、`receivedBytes`。纪律同上；终局失败族（`SYNC_TRANSFER_*`）不发本事件 |


**apply 成功路径互斥规则**（避免计数重复）：每笔成功 apply 恰一事件 = `update-applied`
（UPDATE 帧且非 degraded）／`sync-diff-applied`（Step2 单帧且非 degraded）／
`chunked-update-applied`（kind=0 UPDATE_CHUNK 组装收齐 ∧ 非 degraded——issue #245
第四形态）／`chunked-sync-applied`（kind=2 组装收齐的 Step2 diff apply 且非
degraded——issue #295 第五形态，R21 改道平移：该结算点不再发 `sync-diff-applied`）／
`chunked-snapshot-applied`（kind=1 组装收齐的排他复制导入——issue #295 第六形态，
改道：不再发 `bootstrap-imported`）／`degraded-bypass-applied`（degraded，任意来源
——含分块 apply：degraded 判别先于 chunked 判别胜出，R23）六选一。issue #295 前
「`isStep2 ∧ chunked` 结构性不可达」的表述已失效：Step2 diff 超单帧上限时经 kind=2
chunk 序列到达，此时 chunked 判别先于单帧 Step2 判别胜出（互斥规则同上）。

**`namespace-failed` cause × `failed` 入口覆盖矩阵**（issue #256 验收交付物；
回归锚 = `ws-replication-issue256-namespace-failed.test.ts` 场景号）：

| cause | peer 入口 | hub 入口 | 伴随 wire ERROR | 回归锚 |
|---|---|---|---|---|
| `open-timeout` | `onTimerFired('open')` | —（hub 无 open timer） | 零 wire | 场景 1 |
| `bootstrap-timeout` | `onTimerFired('bootstrap')` | bootstrap timer 到期 | 零 wire | 场景 2、15 |
| `reconcile-timeout` | `onTimerFired('reconcile')` | —（hub 无 reconcile timer；hub 侧活性失败走 §17 `ack-timeout` → needs-resync） | 零 wire | 场景 3 |
| `open-failed` | `startOpen`：`registry.open` throw/拒绝、open 期 lease 状态读取异常 | open 期：authorize 拒绝、身份/epoch 不匹配、lease 状态读取异常 | hub：`NAMESPACE_UNAUTHORIZED`/`REPLICATION_ID_MISMATCH`/`REPLICATION_EPOCH_MISMATCH`/`INTERNAL_ERROR`/`NAMESPACE_NOT_FOUND`（sent）；peer 本地零 wire | 场景 11 |
| `session-open-failed` | `tryOpenReplicationSession` throw/`ok:false` | `openReplicationSession` throw | hub：`INTERNAL_ERROR`（sent）；peer 零 wire | 场景 13 |
| `replication-disabled` | OPEN 前置本地检出（零 wire） | open 期（`REPLICATION_NOT_ENABLED`）+ bootstrap 期身份重读（`INTERNAL_ERROR`） | hub：见左（sent）；peer 零 wire | 场景 12 |
| `session-missing` | `applyRemoteUpdate` 入口防御 | `startBootstrap` 入口防御 | 零 wire | 竞态防御分支（恰一性由 finalize 终态幂等早退结构性保证） |
| `protocol-violation` | 入站帧状态/身份/序列违例族（opening 期 UPDATE、OPEN_OK 身份不符等） | 入站帧状态/ACK 违例族 | `NAMESPACE_STATE_VIOLATION` 等（sent） | 场景 4 |
| `apply-refused` | 结构化拒绝映射族（SCHEMA/META 保护、权限） | 同左 | `PROTECTED_FIELD_MUTATION` 等（sent） | 场景 5 |
| `apply-rejected` | apply/encode/import 内部异常映射族 | 同左 | `BOOTSTRAP_FAILED` 等（sent） | 场景 6 |
| `remote-error` | 对端 terminal namespace ERROR 驱动 | 同左 | received（本端零回发） | 场景 7、12、14 |
| `send-failed` | 出站编码面超限/发送异常（UPDATE/SYNC 帧） | 控制帧编码面失败 + **快照超聚合上限 `maxChunkedBootstrapBytes`（本端资源超限，非对端违例；issue #295 起超 `maxBootstrapBytes` 已改道分块、不再是终局触发面，§8.1）** | hub：`SNAPSHOT_TRANSFER_TOO_LARGE`（sent；原 `BOOTSTRAP_TOO_LARGE` 触发面随 §8.1 改道失效，回归锚场景 14 由实现 ticket 改写） | 场景 14 |
| `internal-error` | —（无专门入口） | `startBootstrap` catch-all + bootstrap 期 lease 重读异常 | `INTERNAL_ERROR`（sent） | 防御兜底（理论不可达/未分类分支） |

矩阵读法：wire 驱动行（`protocol-violation`/`apply-*`/`remote-error`/`send-failed` 的
帧伴随路径）与 `namespace-error` 各计一次（帧 vs 终态边沿，聚合以本表 cause 为准）；
本地零 wire 行仅 `namespace-failed` 一事件；`failed` 入口到 cause 的映射为编译期
强制（`finalize('failed', cause)` 重载签名），新增入口必须登记本表。

schema re-arm 域（ADR 0018；peer 专属——hub 的 apply 槽结构性不可能观测到 SCHEMA
投影变化）：

| type | side | 字段 |
|---|---|---|
| `schema-rearm-applied` | peer | `connectionId?`、`namespaceId`、`semanticFingerprint`（新安装 active schema 的语义指纹——§23.3 documented safe digest）、`updatedAt`（投影自复制来的 `META.schema`，诚实缺席为 `null`——peer 永不读本地时钟生成）。**计数不变量**：每次 re-arm 成功安装恰一事件（含纯格式差异的 fingerprint 不变安装——与 ADR 0017「每次提交都推进 updatedAt」对齐）；事件在 ws-replication 层 apply **结算续体**发射（槽已结算、`notifyDirty` 已完成——**晚于**槽内 R6；槽内 R5.6 安装段早于 R6 是 ADR 0018 §1 的**安装**位置，不是发射位置，勿混） |
| `schema-rearm-failed` | peer | `connectionId?`、`namespaceId`、`code` ∈ {`NSRT-FATAL-SCHEMA-REARM-INVALID`, `NSRT-FATAL-SCHEMA-REARM-INTERNAL`}（ADR 0018 双码——前者带稳定 schema issue 摘要键，后者为内部异常折叠；均不含 schema 文本/ROOT/堆栈）。**计数不变量**：每次 re-arm fatal 置位恰一事件（收口闩锁为判据本身——通道关闭后迟到的 failed outcome 零新事件；不依赖「通道已关闭」这一外部性质）；伴随行为 = 该 namespace channel 主动 CLOSE_NAMESPACE（`closed` 终态），schema 类根因告警路由以本事件为准（`namespace-failed{cause: session-open-failed}` 在 fatal 后的重开路径（显式 re-add、或其后新连接对 `failed` 终态的每连接恰一次重试）可出现——Runtime fatal 门拒绝 `openReplicationSession`，每次连接恰一事件、`failed` 安静终局；语义不含「schema 编译失败」） |

### 23.2 稳定码闭联合（append-only）

- **连接域** `ReplicationObserverConnectionCode` = 协议 §13.1 全 17 码（codec
  `ConnectionErrorCode` 同源）＋ **本 seam 登记的内部码**：
  - `PONG_TIMEOUT`（hub 活性失联；无 wire 帧——本地内部路径）；
  - `OUTBOUND_SEQUENCE_EXHAUSTED`（双端出站 uint32 耗尽；无 wire 帧）。
- **namespace 域** `ReplicationObserverNamespaceCode` = 协议 §13.2 全部 namespace 错误码（codec
  `NamespaceErrorCode` 同源）＋ **内部码**：
  - `IDENTITY_CHANGED`（§11 fence 帧方向标注；消息名作稳定字符串）。
- **未知码折叠规则**：异常携带任意 string 时经白名单匹配（注册表键 + 上述内部码），
  不匹配一律折叠 `INTERNAL_ERROR`（注册表既有成员）。折叠只影响事件字段取值，
  协议行为零变化。
- `namespace-error.terminalState` 沿用 §13 注册表导出（needs-resync 钳制为 failed）。

### 23.3 事件内容安全清单（Safe-field）

**允许**：稳定字面量（type/side/direction/via/reason/cause/reasonCode/from/to/
terminalState/channelState/connectionState——后两者为 §15/§16 状态机闭联合字面量，
issue #231）、受控标识（`namespaceId` 恒为 `^ns-[0-9a-f]{32}$`；`connectionId` 为
§6.2 专用 observability id，握手完成前字段不存在）、稳定错误码（§23.2 闭联合）、
有限数值（`bytes`/`updateBytes`/`maxUpdateBytes` 是**长度**不是内容；
`queuedUpdateCount`/`queuedUpdateBytes`/`inFlightCount` 是计数；`bufferedAmount` 是
adapter 水位读数；`applyLatencyMs`/`ackLatencyMs`/`sendQueueMs`/`queueWaitMs`/
`protectedCheckMs`/`liveApplyMs`/`dirtyNotifyMs`/`delayMs` 是**差值**非绝对时间戳；
`timeoutMs` 是 resolved 配置上限读数（issue #256，timer 族 cause 专属——有限取值
集合的配置值，非时间戳非测量值）；
`sequence` 是帧级有限数值（uint32，连接局部、不跨连接、不持久化——§10 非目标保持）——
issue #238 追加字段全部落入上述两类）。

**issue #239 追加（append-only）**：
- 低基数闭联合字面量 `applyEffect` ∈ {changed, noop} 与 boolean `stateVectorChanged`
  （同族先例 channelState/connectionState——状态机/判别闭联合字面量）；
- 有限数值 `syncRoundId`（uint32，wire §9.1–9.3 既有事实的观测投影，连接代际内）与
  `encodedUpdateBytes`（长度）；
- **documented safe digest（issue #239 注册，注册即冻结）**：`stateVectorBeforeHash`/
  `stateVectorAfterHash`，算法固定 = 双泳道 FNV-1a-32（泳道 A 正序、泳道 B 逆序扫描
  raw 编码 state vector 字节；offset basis 2166136261、prime 16777619、模 2³²），
  输出恒 16 位小写 hex；用途 = 关联/相等判别（trace/事件 payload，§23.6 默认不入
  metric label）。raw state vector 字节仍属 Yjs bytes 禁止项——digest 是派生定长
  字符串，非字节载荷。若未来需要更强 digest，append-only 另增字段，不修改本字段。

**issue #287 追加（append-only；ADR 0018 §4 schema re-arm 域）**：
- **documented safe digest**：`semanticFingerprint`，算法固定 = 带版本的 domain
  separation `sha256:v1:<64 位小写 hex>`（ADR 0007；与上条 `stateVector*Hash` 的 16 位
  双泳道 FNV-1a-32 **文法不同**，按字段名区分，注册即冻结）。语义 = active schema 的
  语义指纹（不含注释/格式差异），用途 = 收敛/相等判别（多 Peer 滚动升级「全部 Peer 已
  applied」判据）；非 schema 文本、非字节载荷；
- **受控投影元数据字符串（本域登记）**：`updatedAt`，源 = 复制到达的
  `META.schema.updatedAt` 原文（Hub 起源时间戳，字符串形态见 ADR 0017），**peer 永不读
  本地时钟生成它**；缺席（legacy/损坏载体）恒 `null`（诚实缺席，非伪造读数）。登记
  说明：本字段既非稳定字面量、亦非有限数值/闭联合，**不落入上述任何既有类别**，故在此
  显式登记为「受控投影元数据」——取值由对端提交事实唯一决定（同一提交在全副本逐字节
  相同），不属 §23.4「绝对时间戳不入事件」（该条约束的是**本地时钟读数**，本字段不读
  任何本地时钟），也不属「不受控高基数字段」（源受控、跨副本一致）；
- `code` = ADR 0018 §3 稳定双码，属本域**独立**闭联合（`ReplicationObserverSchemaRearmCode`），
  **不并入 §23.2 的 namespace 域白名单**（§13.2 全部 namespace 错误码 ∪ 1 内部码）：本域词表无「未知码
  折叠 `INTERNAL_ERROR`」语义（Runtime 侧产出面即双码），把双码塞进 namespace 域只会让
  该闭联合的运行期判据宽于本节文档与导出类型（issue #287 复审修正）。词表**唯一真值源**
  = `SCHEMA_REARM_CODES` 数组（事件类型与运行期白名单均由其派生，双向漂移均编译期红；
  本域亦不导出到 `index.ts`——runtime 产出的稳定码，非宿主可构造值）。

**禁止**：token（任何形态）；owner 值（NamespaceOwner/userId/localOwner）；Yjs bytes
（事件树深扫不得出现 `Uint8Array`/`ArrayBuffer`/`DataView`）；SCHEMA/ROOT 内容；
原始 cause（Error 对象/`.message`/`.stack`/异常字符串）；wire 原样自由文本
（含 transport close `reason`——只允许 close code 与本地分类）；不受控高基数字段。

### 23.4 隔离语义与时钟

- 回调**同步**投递；throw 被隔离（静默，绝不改变协议状态、关闭分类或 Runtime 写入
  结果）；返回值（含 Promise）被忽略——异步 reject 属宿主域 unhandled。
- 事件在**决策已落定之后**发射（状态已写入 / close 已判定 / 帧已入队或已收 /
  apply promise 已结算）；发射点均位于 ws-replication 层帧分发同步段或 apply 结算
  续体，永不位于 Registry write sequencer 槽内。
- **schema re-arm 域的发射点与「行为/观测」分层（issue #287 登记）**：第 23/24 型在
  peer apply 结算续体发射（`getActiveSchema()` 已在槽内切换之后），与其余事件同点纪律。
  该域额外区分两类后果——**事件构造**依赖 observer 在场（缺省 = 零事件构造、零字段
  读取、零时钟调用，与全 seam 同纪律）；而 `schema-rearm-failed` 的**伴随行为**（该
  namespace 主动 CLOSE_NAMESPACE → `closed` 终态、重连不自动重开）是行为契约，
  **无条件执行**。若把它挂在 observer 分支，无 observer 的部署会让通道停留在旧 tools
  继续收敛未校验写——正是 ADR 0018 §3 明文拒绝的状态。故「无 observer = 逐字节等价」
  在本域的范围是**事件与读取面**，不含该关闭动作。
  **时钟面（复审修正）**：本域两型**零时钟调用**，且该纪律的实现判据不是「无 observer」
  本身——本 seam 的 `host.now()` 在两包实现中均以 observer 在场为门
  （`peer-connection.ts`/`hub-connection.ts` 的 `now: () => observer() !== undefined ? … :
  undefined`），故「无 observer ⇒ 零时钟调用」由该门结构性成立、对实现无可判伪力。本域
  真实可判伪的纪律是：**发射与结算路径不接受也不读取任何时源**（`schema-rearm-*` 事件
  无 latency/时间戳字段；`updatedAt` 来自复制事实而非时钟）——回归锚 = 注入计数时钟 spy
  且断言事件键集不含任何时延字段（`ws-replication-issue287-schema-rearm.test.ts`）。
- `clock?: ReplicationClock`（`{ now(): number }`，单调时源）：`applyLatencyMs` =
  apply 成功续体时刻 − 进入 apply 时刻（**含 write sequencer 排队等待**）；
  `ackLatencyMs` = 收到 UPDATE_ACK 时刻 − 帧实际出队发送时刻（含对端 sequencer +
  网络）。缺省 clock = 全部 latency 字段不存在（field 缺失，非 undefined 值）。
  **clock-throw 折叠策略（SA4 B1 登记）**：宿主注入的 `clock.now()` 属观测面能力——
  其 throw 一律视为「时源缺面」（dormant）——采样点经安全折叠返回缺面，对应 latency
  字段不存在；**绝不**外溢为协议状态/wire 帧/Runtime 写入变化，也**不产生**
  unhandledRejection/uncaughtException（观测失败不是业务失败，与 §23.4 observer throw
  隔离同纪律）。
  `now()` 只作差，**绝对时间戳不入事件**。实现内禁止 `Date.now()`/
  `performance.now()` 回退（ADR 0009 纪律）。
- **issue #238 槽内四段捕获纪律（registry 侧）**：`update-applied`/`sync-diff-applied`
  的四段差值在 namespace write sequencer 的 apply 槽内**同步捕获**（纯时钟读、零新增
  await/调度点——槽序/FIFO 冻结不动），经 apply 结果联合 ok 分支的加性可选 `stages`
  结构化导出（ADR-0010 issue #238 修订节登记），发射仍在 ws-replication apply 结算
  续体（本节约束保持）。段定义（同一注入单调时钟域差值）：
  `queueWaitMs` = slotStart − admission（sequencer 排队等待）；`protectedCheckMs` =
  applyStart − slotStart（R1–R3 同步门 + R4 scratch 预演）；`liveApplyMs` = dirtyStart −
  applyStart（R5 实时写入）；`dirtyNotifyMs` = dirtyDone − dirtyStart（R6 saveDoc 登记）。
  守恒恒等式：四段之和 ≤ `applyLatencyMs`（手动时钟测试域逐笔精确相等；生产域残差 =
  t0→admission 同步段 + 槽释放→结算续体微任务跳，亚毫秒量级）。注入路径 = registry
  构造选项 `replicationObservability.stageClock`（单调时源；**应与本 seam `clock` 为
  同一实例**——组装纪律；实例不同最坏后果 = 段值不可比，不影响协议行为）；无注入 =
  零槽内时钟读、`stages` 缺席、槽级记账关闭（与「无 observer = 逐字节等价」同纪律）。
  clock-throw 折叠策略同上一段（stageClock 读数 throw → 整组 `stages` 缺席，绝无协议
  外溢）。槽级记账（slotKind/waitMs/runMs/queueDepthAtStart）另经 registry
  `replicationObservability.slotMetrics` 注入 sink（namespaceId 由装配层闭包盖戳）——
  ADR 0008「队列进度和内部事件属于日志、metrics 与 trace」指定落点，不进任何 getStatus
  形状；sink 槽释放后续体调用、throw 自捕获。
- 跨侧减法边界（issue #238 登记）：hub 与 peer 是不同进程、单调时钟无共同零点——
  `ackLatencyMs − applyLatencyMs` 之类**跨侧差值只作 triage 近似**，不得表述为精确段值；
  精确分段只在进程内成立（发送方：`sendQueueMs`/`ackLatencyMs`；接收方：四段 +
  `applyLatencyMs`）；跨侧由 `sequence` 做帧级逻辑连接。
- 无 observer = 零事件、零状态投影读取、零时钟调用（行为与现状逐字节等价）。
- **issue #239 效果字段组捕获纪律**：before 捕获位于 Step2 帧接纳的帧分发同步段
  （sequenced apply 入队前），after 捕获位于 apply 结算续体（事件发射同点）；两处均经
  session 受控能力 `encodeStateVector`（读取面，不进 Registry write sequencer 槽），
  且仅在 observer 注入时执行（无 observer = 零捕获，热路径与现状逐字节等价）。捕获
  throw（含 session 终态同步 throw）按 clock-throw 同款折叠策略处理：效果字段组整组
  缺失（事件本体与其余字段照常发射），绝不伪造 `noop`。
- 事件对象不可变（类型层 readonly）；observer 内调用公共 API（stop/removeTarget/
  addTarget/close/revoke）由既有幂等/状态门承接；递归事件环属宿主缺陷（同
  Registry seam 取舍）。

### 23.5 peer degraded bypass 判别语义

`degraded-bypass-applied` 判据（仅 apply 成功 ∧ observer 已注入时求值）：

```text
lease.getStatus() = { lease: 'active', runtime: R } 且
R.lifecycle === 'ready' ∧ R.fatal === null ∧ R.rootWrite.enabled === false
⟹ degraded-bypass-applied
```

判别在 apply 完成后**读投影**（§20 语义：认证 Hub→Peer session 在 persistencedegraded 期仍可 memory apply）；投影读取的翻转窗口会产生单笔误归因（恢复期漏报 /
新降级期多报方向）。观测信号不是行为开关，runtime 槽内决策仍是权威事实。hub 侧
`rootWrite` 关闭表现为 §20 hub degraded 拒绝（`PERSISTENCE_DEGRADED` wire 拒绝，
已由 `namespace-error` 覆盖）——hub 结构性不可能 bypass，故事件 `side:'peer'` 专属。

### 23.6 Adapter（日志/metrics/trace）指引

| Adapter | 允许 | 禁止 |
|---|---|---|
| 日志 | side/type/code/cause/reason/namespaceId/connectionId/数值（访问控制下）；每帧事件建议采样 | token、owner、bytes 内容、SCHEMA/ROOT、cause 原文、绝对时间戳 |
| metrics（默认） | label ∈ {side, type, code, cause, reason, applyEffect（issue #239：低基数效果判别，与 code/cause/reason 同族）}；counter/gauge/histogram 数值（bytes/latency 入 histogram） | namespaceId/connectionId 作默认 label；`syncRoundId`/`stateVectorBeforeHash`/`stateVectorAfterHash`（issue #239：round 关联键与 digest 属事件 payload，高基数不入默认 label） |
| trace | 同日志 + 采样 | 全量 update 级 span 未采样直发 |

`namespaceId`/`connectionId` 是事件 payload（供受控日志/trace 关联），**默认不绑
metric label**（§19 ADR L159）。每帧事件（update-sent/applied/acked、sync-*）体量
注记：adapter 应聚合计数/直方图而非逐事件打日志。

### 23.7 Conformance 补充

Conformance 测试（§22 增补）须覆盖：全事件矩阵 key-set 冻结白名单断言；token/owner/
Yjs bytes/SCHEMA/ROOT/cause 哨兵深扫（含 `JSON.stringify` 无标记物、深扫无
`Uint8Array`/`ArrayBuffer`/`Error`）；observer 每事件必 throw 时 wire 帧序列、终态、
文档内容与 apply 结算与无 observer 基线全等；无 clock 时 latency 字段缺失、有 clock
时 ≥ 0；degraded 期 hub→peer apply 产生 `degraded-bypass-applied` 且互斥于
`update-applied`；`resync-required{cause:send-failed}` 子因矩阵（issue #231：
`update-too-large` 与 `send-frame-rejected` × hub/peer 四象限，断言 `reason`/
`updateBytes`/`maxUpdateBytes` 与失败时刻上下文，其余 cause 事件键集逐字节不变；
`bufferedAmount` 在 adapter 缺面时字段缺失、可观测时为真实读数）；
`update-dropped{reason:update-too-large}` × hub/peer（队列非空超限丢弃路径：
恰一事件、零 `resync-required`、连接/channel 不迁移、同一 drain 后续合法项照发
并被 ACK、丢弃项由下一次 reconciliation diff 修复收敛）。
- issue #239：两 sync 事件键集白名单追加新字段；断言 `encodedUpdateBytes === bytes`、
  `syncRoundId` ∈ wire Step1 roundId 集合（每轮有事件、无孤儿事件）、效果字段组单命运
  （同现同缺）与组内一致性（`stateVectorChanged === (beforeHash !== afterHash)`、
  `applyEffect ↔ stateVectorChanged`）、hash 16 位小写 hex 文法；捕获折叠与 digest
  确定性经 testing surface（`@nomicore/ws-replication/testing`）单元面覆盖（throwing
  reader → 整组缺失；digest 纯函数确定）；periodic no-op round 全 noop / 静默漂移修复
  round 至少一侧 changed 的场景级验收由 `ws-replication-issue239-ac-red.test.ts` 承担。

**issue #238 追加**：四段分解与守恒断言（saveGate 门闩构型：u1 `dirtyNotifyMs` =
挂起时长、后续排队项 `queueWaitMs` = 剩余占槽时间、逐笔四段之和 = `applyLatencyMs`）；
三事件面 `sequence` 关联断言（`update-sent{sequence}` ↔ 对端 `update-applied{sequence}`
↔ `update-acked{sequence = ackedSequence}` 逐位相等；合并帧构型断言一 sequence 覆盖
合并帧、三事件计数一致）；dormant 等价（无 stageClock → 事件零四段字段）；
clock-throw 折叠（throw 时源 → 四段缺席、协议路径正常、零 unhandledRejection）；
`event-loop-delay-sampled.delayMs` 正向控制（已知漂移注入 → 精确复现；无时源读数 →
零采样）；槽级记账样本（长 `S` 槽 `runMs`、后续 `R` 槽 `waitMs` 抬升、
`queueDepthAtStart`、namespaceId 盖戳）；observer+clock+stageClock 在场/缺席两构型
wire 帧协议语义序列全等（Yjs 载荷含随机 doc client id——按本仓库 conformance 惯例以
kind#seq 语义摘要判定，观测零 wire 扰动）。

**issue #287 追加（schema re-arm 域）**：注入 transport 全链路（hub `replaceSchema` →
peer 收 UPDATE → 恰一 `schema-rearm-applied`，字段 `semanticFingerprint` 与 Hub
`getActiveSchema()` 逐值一致、`updatedAt` = Hub 起源时间戳；键集冻结白名单）；纯格式差异
提交也照常发射（fingerprint 不变、`updatedAt` 推进）；`META.schema` 载体被抹除 → 事件
`updatedAt === null`（诚实缺席，peer 永不读本地时钟）；fatal 路径恰一
`schema-rearm-failed` + 该 namespace 恰一 CLOSE_NAMESPACE 帧 + `closed` 终态 + 零
`namespace-failed`（本事实不是「本笔 apply 失败」——apply 已成功提交）；重连后通道仍
`closed`、零新 OPEN_NAMESPACE、零新 re-arm 事件（不产生重试循环），显式 re-add 是恢复
入口；断连追赶（离线窗口丢失的 schema 变更由重连 reconcile 的 Step2 apply 激活 re-arm，
无新增通知帧类型）；**hub 侧反向断言**（全生命周期零 re-arm 事件——peer→hub 方向
protected-field 检查拒绝一切 SCHEMA 变化，hub apply 槽结构性不可能观测该变化）；无
observer 下成功与 fatal 两路径的通道行为全等（通道行为不依赖观测面）且事件键集不含任何
时延字段；**迟到重复 failed outcome 的「恰一」闩锁断言**（fatal 收口后在 `closed` 通道上
再注入一笔 re-arm 失败的 UPDATE → 零新事件、零新 CLOSE_NAMESPACE 帧）；**schema 文本
零外溢断言**（fatal 事件序列化后不含被注入的腐坏 SCHEMA 文本）；**本域码不并入
namespace 域白名单**（`stableNamespaceCode('NSRT-FATAL-SCHEMA-REARM-INVALID') ===
'INTERNAL_ERROR'`，域判别单点）。回归锚 =
`packages/ws-replication/test/ws-replication-issue287-schema-rearm.test.ts`。
**issue #245 追加（AC6 两具名子项，必交付）**：
- **事件矩阵 key-set 冻结子项**：全事件矩阵加一条协商分块写腿（peer `chunkedUpdate:
  true` opt-in + 8KiB `maxUpdateBytes` 低限——大写 ≈20KB → 3 chunk，限内小写仍走普通族，
  双族并存）；白名单（`ws-replication-observer-red.test.ts` T9 `ALLOWED_KEYS`）追加
  chunked 三型行（键集 = §23.1 上列逐字），数值键清单追加 `transferId`/`chunkCount`/
  `totalBytes`（有限非负）；矩阵 `expectedTypes` 追加三新型——**白名单行不得为死行**
  （矩阵腿必须真实激发三型）。纪律（R26）：矩阵 chunked 腿在收口相位（GOAWAY 注入 /
  wire close / `stop()`）**之前**完整收敛——收口后在途中止会观测
  `chunked-update-aborted`，而矩阵白名单不含该型（`assertSafe` 对无白名单类型响亮红）；
  若未来矩阵确需覆盖收口后在途中止，须同步补 aborted 白名单行 +
  `receivedChunks`/`receivedBytes` 数值键（「观测集 ⊆ 白名单覆盖」与「白名单行不得为
  死行」对称）。key-set 冻结的 exact-keyset 断言以契约文件
  `ws-replication-issue245-ac-red.test.ts` R1–R5 为行为面双保险。
- **时钟折叠策略子项（§23.4 两态纪律在 chunked 族的正典可执行验收——T12 两用例分块腿，
  必交付，不得降级为 follow-up 或以契约文件替代 AC 指名位置）**：
  (d-i) T12「注入 clock」用例分块腿：saveGate 门闩确定性——`chunked-update-applied.
  applyLatencyMs` 与 `chunked-update-acked.ackLatencyMs` **在场**（`in === true`）、
  `Number.isFinite`、**≥ 0**（门闩确定性下可断言精确值）；`chunked-update-sent` 键集
  **恒无任何 latency 键**（clock 在场也不加——DD1）；
  (d-ii) T12「无 clock」用例分块腿：手工无 clock 构型下三 chunked 成功型事件**仍发**
  （时钟缺面不抑制事件，仅抑制键），`applyLatencyMs`/`ackLatencyMs` **整键缺失**
  （`in === false`——field 缺失非 undefined 值，§23.4 L811 纪律）。
  两腿与矩阵腿（缺省 ManualClock = 在场态通用数值检查）合并 = chunked 族「无 clock 时
  latency 字段缺失、有 clock 时 ≥ 0」的完整两态覆盖。
- **degraded × chunked 互斥断言**：degraded 窗口 hub→peer 分块 apply——每笔成功 apply
  恰一互斥事件增量 = `degraded-bypass-applied`（degraded 判别先于 chunked 判别胜出，
  R23），零 `update-applied`/零 `chunked-update-applied` 双发、零 aborted（transfer
  完整收敛）；发送侧 hub 的 `chunked-update-sent`/`chunked-update-acked` 恰一不受接收侧
  degraded 影响（R21 改道无 degraded 例外）。


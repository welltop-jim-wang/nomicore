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

协议保持以下不变量：

1. 一条 WebSocket binary message 恰好承载一个完整 Nomicore frame；不粘连多个 frame，也不跨 message 分片。
2. 每条正常 frame 都消费本发送方向的 sequence；对端严格按期望值接收。
3. 每个 namespace frame 直接携带 namespaceId，不使用 channelId、owner 或 session nonce。
4. 同一连接内，同一 namespaceId 只允许一个生命周期；closed、conflicted 或 failed 后不得重新 open，重新 add 必须重建连接。
5. HELLO_ACK 前不得发送 namespace frame。
6. UPDATE、SYNC_STEP2 和 BOOTSTRAP_SNAPSHOT 的 bytes 在 live apply 前受大小限制。
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

`UPDATE_CHUNK`（issue #242，ADR 0013）只有经 HELLO 协商 `CAP_CHUNKED_UPDATE` 后才能使用；未协商端必须按未知/未支持消息码规则以 connection fatal `UNSUPPORTED_MESSAGE_TYPE` 拒绝。v1 的 HELLO 仍发 `optionalCapabilities=0`，因此 v1 端永不分块、也拒绝任何 0x42 帧——新旧实现互不破译。首版 `flags=0`，也没有必需的 optional capability。未来扩展只能在 HELLO 明确协商后使用，不得靠数值范围猜测。

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
| snapshot | varUint8Array | 完整 `Y.encodeStateAsUpdate`，不分块 |

Hub 在 namespace write sequencer 中编码一致基线，不等待网络发送。超过 `maxBootstrapBytes` 返回 `BOOTSTRAP_TOO_LARGE` 并终止 namespace；v1 不分块、不 fallback HTTP。

Peer 在 detached Y.Doc apply snapshot、核对 namespace META identity、以 target 的 local owner执行排他复制导入，再打开 Lease/ReplicationSession。并发 duplicate 不覆盖、不自动改为 merge，返回 `BOOTSTRAP_FAILED`。

### 8.2 BOOTSTRAP_ACK `0x21`

| Field | Encoding | Rule |
|---|---|---|
| namespaceId | varString | key |
| ackedSequence | varUint | BOOTSTRAP_SNAPSHOT sequence |

ACK 只表示本地导入和 Runtime/Session 建立完成。Peer 随后以新的 syncRoundId 发起双向 reconciliation，修复 snapshot 编码与安装之间的竞态。

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

超过 `maxSyncDiffBytes` 返回 `SYNC_DIFF_TOO_LARGE`；不 fallback bootstrap、不自动拆分。收到后在 sequencer中 apply + dirty，随后发 SYNC_APPLIED。

### 9.3 SYNC_APPLIED `0x32`

| Field | Encoding | Rule |
|---|---|---|
| namespaceId | varString | key |
| syncRoundId | varUint | 当前 round |
| ackedSequence | varUint | SYNC_STEP2 sequence |

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
| `UPDATE_TRANSFER_EXPIRED` | **issue #242 / ADR 0013**：分块 transfer assembly 超时（非终态；发射点 = 后续切片的 assembly timeout，本切片只冻结词表登记与 wire roundtrip） | 本规范追加登记 |

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

分块传输（issue #242 / ADR 0013，切片 1 只冻结 wire 面）：单条 UPDATE 超过 `maxUpdateBytes` 且双方已协商 `CAP_CHUNKED_UPDATE` 时，发送端把完整 update 拆为多个自描述 chunk。单帧 payload 字段顺序：

| Field | Encoding | Rule |
|---|---|---|
| namespaceId | varString | key（固定格式） |
| transferId | varUint | uint32，(连接, 方向, namespace) 域内从 1 严格递增，不回绕；0 非法 |
| chunkIndex | varUint | uint32，0-based，< chunkCount |
| chunkCount | varUint | uint32，≥ 1 |
| totalBytes | varUint | uint32，完整 update 字节数，≥ bytes.byteLength |
| bytes | varUint8Array | 本分片，非空；大小复用 `maxUpdateBytes`（零新 frame 级上限） |

codec 级单帧规则（encode/decode 同一套，违者 `MALFORMED_FRAME`）：namespaceId 格式、transferId ≥ 1、chunkIndex < chunkCount、chunkCount ≥ 1、bytes 非空且 ≤ totalBytes、bytes ≤ `maxUpdateBytes`（超限 `UPDATE_TOO_LARGE`）。跨帧规则（transferId 一致性/单调、chunkIndex === 已收数量、`totalBytes` 资源上限、实收 == totalBytes）与 assembly 状态机、ACK 复用（`UPDATE_ACK`，ackedSequence = 末 chunk 帧序）属后续切片；解码侧未协商（`selectedCapabilities` 无 bit 0）必须在 payload 解析前以 `UNSUPPORTED_MESSAGE_TYPE` connection fatal 拒绝（分类与 §5 未知消息码规则一致，close code 1002）。

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

`UPDATE_TRANSFER_VIOLATION`（跨 chunk violation，对齐 `SYNC_STATE_VIOLATION` 先例）与 `UPDATE_TRANSFER_TOO_LARGE`（分块资源上限超限，对齐 `SYNC_DIFF_TOO_LARGE` 语义族）为 issue #242 / ADR 0013 追加：发射点属后续接收端 assembly 切片，本规范只登记稳定码与 wire 语义（fatal、terminal failed）。

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
所有 timeout 是有限安全整数且 > 0
low-water < high-water
```

不得运行时 clamp。

## 18. Timeout

独立配置：

- `helloTimeoutMs`；
- `openTimeoutMs`；
- `bootstrapTimeoutMs`；
- `reconcileTimeoutMs`；
- `reconcileIntervalMs`（缺省 `300_000`）；
- `closeTimeoutMs`；
- `ackTimeoutMs`；
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
- 分块传输（issue #242）：UPDATE_CHUNK 全字段 golden vectors、单帧语义自洽拒绝、未协商（无 `CAP_CHUNKED_UPDATE`）端对 0x42 帧按未知消息码 connection fatal 拒绝、`selectedCapabilities` 选项急切校验与 v1 回落（新旧互不破译）；
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

### 23.1 事件词汇（22 型，分类列示——issue #238 追加第 21 型 `event-loop-delay-sampled` 及四事件面 sequence/四段差值字段；issue #256 追加第 22 型 `namespace-failed`）

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

**apply 成功路径互斥规则**（避免计数重复）：每笔成功 apply 恰一事件 = `update-applied`
（UPDATE 且非 degraded）／`sync-diff-applied`（Step2 且非 degraded）／
`degraded-bypass-applied`（degraded，任意来源）三选一。

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
| `send-failed` | 出站编码面超限/发送异常（UPDATE/SYNC 帧） | 控制帧编码面失败 + **快照超 `maxBootstrapBytes`（本端资源超限，非对端违例）** | hub：`BOOTSTRAP_TOO_LARGE`（sent） | 场景 14 |
| `internal-error` | —（无专门入口） | `startBootstrap` catch-all + bootstrap 期 lease 重读异常 | `INTERNAL_ERROR`（sent） | 防御兜底（理论不可达/未分类分支） |

矩阵读法：wire 驱动行（`protocol-violation`/`apply-*`/`remote-error`/`send-failed` 的
帧伴随路径）与 `namespace-error` 各计一次（帧 vs 终态边沿，聚合以本表 cause 为准）；
本地零 wire 行仅 `namespace-failed` 一事件；`failed` 入口到 cause 的映射为编译期
强制（`finalize('failed', cause)` 重载签名），新增入口必须登记本表。

### 23.2 稳定码闭联合（append-only）

- **连接域** `ReplicationObserverConnectionCode` = 协议 §13.1 全 17 码（codec
  `ConnectionErrorCode` 同源）＋ **本 seam 登记的内部码**：
  - `PONG_TIMEOUT`（hub 活性失联；无 wire 帧——本地内部路径）；
  - `OUTBOUND_SEQUENCE_EXHAUSTED`（双端出站 uint32 耗尽；无 wire 帧）。
- **namespace 域** `ReplicationObserverNamespaceCode` = 协议 §13.2 全 20 码（codec
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

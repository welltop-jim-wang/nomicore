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

首版 `flags=0`，也没有必需的 optional capability。未来扩展只能在 HELLO 明确协商后使用，不得靠数值范围猜测。

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

收到 GOAWAY 后停止 OPEN，不开始新 sync round；现有 namespace 到 deadline 前自然收口，之后发送方以 WS 1001 关闭。

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

任一端可声明当前增量连续性作废，但始终由 Peer用新 roundId 发起下一轮。发出后不再发送新 UPDATE；已接纳 update 正常 apply/ACK。Peer等待 in-flight 窗口收口后开始新 round；断线则重连后重新 OPEN/reconcile。

首版不做周期 reconciliation，仅在 bootstrap、reconnect、queue overflow、ACK timeout或显式 RESYNC_REQUIRED 时运行。

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
- `failed`：等待连接重建或配置变化；
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

Connection使用 per-namespace队列和 round-robin：control/error/ACK高优先级，data每轮每 namespace最多一个。总队列超限时，按最大 queued namespace依次丢弃未发送增量并标记 needs-resync，直到回到低水位。Control frame有独立保留额度，耗尽为 `CONNECTION_BACKPRESSURE`。

Adapter观察 WebSocket `bufferedAmount`：超过 high-water暂停 dequeue，降至 low-water恢复。无 drain event时使用 Cordis Timer调度检查，不使用原生 timer，也不进入 Runtime sequencer。

配置启动时响亮验证：

```text
maxBootstrapBytes <= maxFrameBytes - protocol overhead
maxSyncDiffBytes <= maxFrameBytes - protocol overhead
maxUpdateBytes <= maxFrameBytes - protocol overhead
maxQueuedUpdateBytes >= maxUpdateBytes
maxInFlightUpdates >= 1
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
- `closeTimeoutMs`；
- `ackTimeoutMs`；
- WS ping interval/pong timeout。

HELLO/pong timeout关闭连接。Open/bootstrap/reconcile/close/ACK timeout只收口 namespace；ACK timeout不重发同一 UPDATE，而进入 needs-resync并由新 state-vector round修复。

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

1. replication停止接纳连接/target并发送GOAWAY；
2. namespace停止新frame，排空已接纳apply；
3. close sessions并release replication leases；
4. Registry shutdown；
5. Persistence dispose；
6. Timer/Clock停止。

Drain不无限等待网络ACK。不得从notifier或sequencer槽内await Runtime close、Lease release或Registry shutdown。

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
- fake duplex transport上的connection、namespace、sync、resync、drain状态迁移；
- 真实WebSocket + MemoryPersistence的1 Hub + 2 Peers收敛；
- FilePersistence独立rootDir、bootstrap、archive/reset、进程重启、degraded旧snapshot恢复；
- secret-free logs和受控metrics标签。

首批 golden vectors 的具体十六进制输出由实现票在锁定 `lib0`/`y-protocols` 版本后生成并提交；实现不得改变本文字段顺序和消息语义来适配库的偶然编码。

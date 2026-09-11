# ADR 0013：大型 live UPDATE 的有界分块复制传输

日期：2026-09-02
状态：已接受（issue #233 切片 1–5 落地：#242/#243/#244/#245/#246，接受日期 2026-09-10；wire 冻结值——消息码 `0x42`、UPDATE_CHUNK payload 字段序、capability/错误码/reason 词表锁定值——以 `docs/protocols/instance-replication-v1.md` 为唯一权威；配置表与设计理据权威保留于本文「资源上限与配置链」。observer 事件词表为 local seam 词表（协议 §23，非 wire 契约），随协议文档登记维护。）

## 背景

实例复制协议 v1 不变量 1 要求一条 WebSocket binary message 恰好承载一个完整 frame，UPDATE 载荷受 `maxUpdateBytes`（缺省 512 KiB）限制。单笔超限 update 当前不可发送：发送端丢弃该增量并声明 needs-resync（`packages/ws-replication/src/update-channel.ts`），修复依赖下一轮双向 state-vector reconciliation。

issue #230（增量 mutation）修复后，大 update 的来源收敛为**真实大内容**（合法大型 transaction），#231 已使超限丢弃在 observer 上可区分。现状代价经 `packages/ws-replication/test/ws-replication-issue233-repro.test.ts` 实测刻画：

- **R1**（单笔 20KB 合法写，`maxUpdateBytes=8 KiB`）：0 个 UPDATE 帧承载该写；1 次 namespace 状态切换 + 完整 sync round；同一载荷最终以单个 20,029 字节的 SYNC_STEP2 **控制帧**整体传输，绕开 data 路径的 window/backpressure 记账并占用 control 保留额度。
- **R2**（连续两笔 20KB 写）：2 轮 resync，peer→hub SYNC_STEP2 累计 40,249 bytes——持续大写重复以完整 round 计价。
- **R3**（100KB 写，`maxSyncDiffBytes=32 KiB`）：恢复 round 的 diff 在编码面触发 `SYNC_DIFF_TOO_LARGE` → namespace 终局 `failed` 而连接保持 ready。**大于 sync diff 上限的合法写使 namespace 永久失同步，直到人工改配置**——reconciliation 自身受单帧上限约束，超限即终局，这是比「成本高」更尖锐的结构性缺陷。

## 决策

为大型 live Yjs update 提供**有界、可协商、可恢复的分块传输**，作为协议 append-only 演进，v1 未协商端行为逐字节不变。

### 协商：capability bit

- HELLO `optionalCapabilities` 追加 bit `0x00000001 = CAP_CHUNKED_UPDATE`；`selectedCapabilities` 取交集（既有机制，零新字段）。
- 未协商 ⇒ 发送方不得分块，超限行为保持 v1（丢弃 + needs-resync，#231 观测不变）。新消息码对未协商端是 `UNSUPPORTED_MESSAGE_TYPE` connection fatal，天然强制 gating。
- envelope version 恒 1，flags 恒 0：分块只新增消息码，不改固定头。
- 互通矩阵：v2↔v2 分块；任意 v1 组合回落 v1 超限行为。

### 消息形态：单一自描述 UPDATE_CHUNK（拒绝 BEGIN/CHUNK/COMMIT）

```text
0x42 UPDATE_CHUNK (namespace)
  namespaceId  varString        // 固定格式
  transferId   varUint          // uint32，(连接, 方向, namespace) 域内从 1 严格递增，不回绕
  chunkIndex   varUint          // 0-based
  chunkCount   varUint          // ≥ 1
  totalBytes   varUint          // 完整 update 字节数
  bytes        varUint8Array    // ≤ maxUpdateBytes（复用为 maxChunkBytes）
```

理由（状态机简单性与拒绝路径明确性优先）：

1. 首 chunk（index 0）已携带 `totalBytes/chunkCount`——恶意声明在第一个字节流入前即可拒绝，BEGIN 的提前拒绝价值不丢失；
2. `chunkCount` 精确已知 ⇒ 收齐 index 集合即确定性完成信号，COMMIT 完成围栏冗余；
3. WS 可靠有序 ⇒ chunk 错序/丢失结构不可达；接收端要求 `chunkIndex === 已收数量` 严格递增，缓存模型简化为单增长 buffer，错序/重复一旦出现即对端 bug ⇒ 响亮 violation；
4. assembly 状态机仅「无 / 有」两态，超时与清理规则统一。

ACK 复用既有 `UPDATE_ACK`：`ackedSequence = 末 chunk 帧序`。不新增 ACK 消息、不改 UPDATE_ACK payload；整笔 transfer 一次 ACK，其 durability 含义（sequenced live apply + dirty notification）不变。

### 发送端规则

- 仅当 `bytes.byteLength > maxUpdateBytes` ∧ 已协商 `CAP_CHUNKED_UPDATE` ∧ channel live 时进入分块；其余路径（普通 UPDATE、有界队列、`Y.mergeUpdates` 合并）不变——合并帧因贪心上界 ≤ maxUpdateBytes，结构性不可能分块。
- 切片在出队发送时刻惰性进行：队列持完整 update，`maxQueuedUpdateBytes/Count` 记账口径不变；首 chunk 出队即 transfer 开始，整笔占 1 个 in-flight 窗口槽直至 ACK。
- chunk 逐帧经既有 data 路径出站：每帧独立 sequence，独立受 `dataGateOpen` 与 round-robin「每轮每 namespace 一帧」调度——8 MiB transfer = 16 帧 = 16 个 RR 轮次，其余 namespace 帧照常穿插，公平性零新增机制；window 空位允许时本 namespace 小 update 可在 chunk 间穿插（Yjs CRDT 无序安全）。
- ACK 计时锚为末 chunk 出站时刻；`ackTimeoutMs` 语义不变。
- 中止复用既有机制：连接 shed / 队列溢出 / ACK timeout / RESYNC_REQUIRED / 终态 ⇒ 停发后续 chunk、末 chunk 序入 zombie 簿记、needs-resync 同构处置。

### 接收端规则

- assembly 为纯易失状态，作用域 = (连接, 方向, namespaceId, transferId)；连接断开、namespace close/终态、GOAWAY drain 收口、epoch fence、收到 RESYNC_REQUIRED ⇒ 全部丢弃，零 durable 残留——全部走既有清理财路，无新增持久化。
- 首 chunk 校验：`totalBytes ≤ maxChunkedUpdateBytes`、`chunkCount ≤ maxChunksPerUpdate`、`totalBytes ≤ chunkCount × maxUpdateBytes`、`chunkCount ≥ 1`；通过后按已验证上界一次性分配 detached buffer——恶意声明不可能导致无界分配。
- 后续 chunk：`transferId` 一致、`totalBytes/chunkCount` 逐字节一致、`chunkIndex === 已收数量`、`bytes ≤ maxUpdateBytes`；任一不符 ⇒ namespace ERROR `UPDATE_TRANSFER_VIOLATION`（fatal，terminal failed——对齐 `SYNC_STATE_VIOLATION` 先例）。
- 收齐 ⇒ 长度校验（实收 == totalBytes）⇒ **一次** sequenced `applyRemoteUpdate()` + dirty notification（peer→hub 方向 scratch 保护检查不变，成本不因分块放大）⇒ `UPDATE_ACK(末 chunk 帧序)`。重组失败一律发生在 apply 之前：**live Y.Doc 零写入**。
- 并发上限：每 (namespace, 方向) 至多 1 个进行中 assembly（发送端 FIFO 使并发 >1 无价值）；连接级 `maxConcurrentAssembliesPerConnection`（缺省 4）防多 namespace 聚合内存。
- assembly timeout：`assemblyTimeoutMs`（缺省 30_000），每收一 chunk 重置（进度滑动 deadline）；超时 ⇒ 丢弃 assembly + `RESYNC_REQUIRED{reasonCode: UPDATE_TRANSFER_EXPIRED}`，对端按既有 §9.4 收口。缺失 chunk 在有序传输上的唯一探测器即该超时。

### 资源上限与配置链

新增配置均有安全缺省、启动期响亮验证、绝不运行时 clamp：

| 配置 | 缺省 | 约束 |
|---|---|---|
| `maxChunkedUpdateBytes` | 4 MiB | ≤ `maxQueuedUpdateBytes`；≤ `maxChunksPerUpdate × maxUpdateBytes` |
| `maxChunksPerUpdate` | 64 | ≥ 1 |
| `maxConcurrentAssembliesPerConnection` | 4 | ≥ 1 |
| `assemblyTimeoutMs` | 30_000 | 有限正整数 |

chunk 大小复用 `maxUpdateBytes`（零新 frame 级上限，`maxFrameBytes` 链式不变量自动覆盖）。内存上界 = `maxConcurrentAssembliesPerConnection × maxChunkedUpdateBytes`，全部配置可见。

### 错误码与词表（append-only）

- namespace error registry 追加：`UPDATE_TRANSFER_VIOLATION`（fatal、retryable no、terminal failed）与 `UPDATE_TRANSFER_TOO_LARGE`（fatal、retryable config、terminal failed——对齐 `SYNC_DIFF_TOO_LARGE` 语义族）。连接级 registry 零新增。
- `RESYNC_REQUIRED.reasonCode` 词表追加 `UPDATE_TRANSFER_EXPIRED`（非终态）。

### Observer seam（append-only，对齐 §23 纪律）

新增事件（键集冻结；safe-field 同 §23.3——只报长度/计数/有界标识，零 Yjs bytes 与内容）：

| type | 字段 |
|---|---|
| `chunked-update-sent` | `connectionId?`、`namespaceId`、`transferId`、`chunkCount`、`totalBytes`（transfer 完成出站时一次，非逐 chunk） |
| `chunked-update-applied` | `connectionId?`、`namespaceId`、`bytes`、`chunkCount`、`applyLatencyMs?`（apply 成功路径互斥规则第四形态） |
| `chunked-update-acked` | `connectionId?`、`namespaceId`、`bytes`、`ackLatencyMs?` |
| `chunked-update-aborted` | `namespaceId`、`transferId`、`reason` ∈ {timeout, shed, resync-declared, channel-teardown, connection-teardown, epoch-fence}、`receivedChunks`、`receivedBytes` |

throw 隔离、决策落定后发射、无 observer 逐字节等价——全部沿用 §23.4。

### 明确拒绝的备选方案

1. **提高 `maxUpdateBytes`**：issue 非目标；单帧上限失去意义，接收端 decode 前分配与排队记账同步放大，`maxSyncDiffBytes` 尾部不动。
2. **BEGIN/CHUNK/COMMIT 三帧**：首 chunk 自描述已提供提前拒绝与完成围栏，三帧只增加状态机复杂度。
3. **Yjs struct 级拆分（update v2 语义切分）**：拆分-重组需解析/重编码 struct 序列，引入语义漂移面；wire 层字节切片 + 精确重组保持 update 字节逐字节不变，Yjs 语义零触碰。
4. **逐 chunk ACK**：对话流量翻倍且迫使 ACK durability 含义细化；单 ACK + 末 chunk 序簿记已足够。
5. **带外通道（HTTP/旁路大对象）**：破坏 session 信任模型、sequencer 顺序与 ACK 语义。

## 后果

- 大于 `maxUpdateBytes`、不超过 `maxChunkedUpdateBytes` 的合法 update 在 live 状态直接传输并单 ACK，零 reconciliation；R3 的终局失败路径在上限内消除。
- 每 wire frame 均不超过既有 frame 与 per-chunk 上限；backpressure、round-robin 公平调度与 control reserve 零机制新增、零回归面。
- 协议面 append-only：1 个 capability bit、1 个消息码、2 个 namespace 错误码、1 个 RESYNC reason、4 个 observer 事件类型；v1 peer 全部不可达。
- 落地时须修订 `docs/protocols/instance-replication-v1.md`（消息注册表、§13.2、§17、§23）并补 golden vectors 与旧/新互通矩阵；CONTEXT.md 增补「分块复制传输」词汇。
- 复现刻画测试（R1/R2/R3）保留为现状基线；实现落地后以协商分块构型新增收敛绿灯测试，不改刻画文件。

## 非目标

- 以提高 `maxUpdateBytes` 代替协议设计；
- 跨进程重启持久化 partial chunks 或 durable outbox；
- 逐片 apply 到 live Y.Doc；
- ~~SYNC_STEP2 diff 与 BOOTSTRAP_SNAPSHOT 分块（R3 揭示的另一半尾部）——同一 transfer 机制可平移，列为后续独立 capability（如 `CAP_CHUNKED_SYNC`），不在本 ADR 冻结~~ 【已由 ADR 0019 接替：0x42 kind 单形态恒用分块、同版本部署假设下无 capability 协商，issue #295】；
- awareness/presence、多 hub、客户端 y-websocket 兼容（沿用 ADR 0010 非目标）。

## 取代与关联

本 ADR 扩展 ADR 0010 的 live UPDATE 路径，不改变其 ACK durability 语义、identity fencing、backpressure 分层或停机顺序；与 `docs/protocols/instance-replication-v1.md` 的关系为已生效的两层权威边界：wire 冻结值（消息码、UPDATE_CHUNK payload 字段序、capability/错误码/reason 词表锁定值）以该协议文档为唯一权威；配置语义、设计理据与拒绝备选方案权威保留于本文（配置表见「资源上限与配置链」）。observer 事件词表按协议 §23 定位为 local seam 词表（非 wire 契约），随协议文档登记维护。ADR 0010 关系为扩展而非修订。关联 issue：#233（本设计来源与验收标准）、#230（大 update 来源收敛，已修复）、#231（超限观测，已修复）、#232（reconciliation 回声调查，独立进行）。现状实测证据：`packages/ws-replication/test/ws-replication-issue233-repro.test.ts`。

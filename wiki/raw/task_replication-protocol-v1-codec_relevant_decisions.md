# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 任务：`task_replication-protocol-v1-codec`（issue #135，Phase 5 切片：`@nomicore/replication-protocol` 纯二进制 codec）。
> ADR 全集位置：`docs/adr/`（0001–0010），与任务简报「规范依据」引用一致（简报早期 `docs/decisions/` 笔误已于 2026-08-27 更正；本清单基准自始取自 `docs/adr/`）。

## 相关 ADR

### ADR-0010 Hub/Peer WebSocket Y.Doc 复制与最终一致（accepted，Phase 5 设计——本任务直接依据）

- 与本任务的关联点：本任务实现其「包、应用与生命周期」第 1 项 `@nomicore/replication-protocol` 纯二进制 codec。
- 核心条款（原文摘录）：

**包形态与依赖边界（本票范围界定）**

- 「Phase 5 首版建立：1. `@nomicore/replication-protocol`：纯二进制 codec、显式版本协商、消息与稳定错误，不依赖 Cordis、WS 或 Registry；」
- 「2. `@nomicore/ws-replication`：WebSocket client/server、multiplex、认证授权、bootstrap/reconcile/live 状态机、背压和 observer；」
- 「在出现第二种 transport 前，不提前提取 transport-independent replication package。」

**wire envelope 与 framing**

- 「Wire不使用channelId：每个 namespace-scope frame直接携带namespaceId；同一连接内同一 namespace只允许一个生命周期，关闭后重开必须重建连接。」
- 「固定 envelope为 20-byte大端头：`NMCR` magic、envelope version、message type、flags、direction-local sequence、payload length和reserved。首版flags/reserved必须为零，一条WebSocket binary message恰好承载一个完整frame。控制payload使用显式直接依赖的lib0 canonical encoding，内层复用锁定版本的`y-protocols/sync`语义。Envelope version只决定头布局，HELLO显式协商完整protocol version与capabilities；不得按消息数值猜版本。」

**sequence 纪律**

- 「每方向sequence从1严格递增，不回绕；gap、repeat或错误ACK关联关闭连接。WS ping/pong负责活性，GOAWAY提供相对drain timeout。」

**消息/错误码的唯一权威归属**

- 「连接与namespace状态、消息码、payload字段、错误码、timeout、close code、backpressure和完整时序以`docs/protocols/instance-replication-v1.md`为唯一wire contract。关键恢复纪律为：连接断开即close sessions/release Leases，不保留outbox；重连重新OPEN并reconcile。」

**ACK 语义边界（codec 不得超卖）**

- 「每个sync round由Peer以uint32 roundId发起，双方Step2完成sequenced apply + dirty后以SYNC_APPLIED确认；两个方向均确认才进入live。UPDATE_ACK同样只表示sequenced live apply + dirty notification，不表示物理flush或其他副本确认。」
- 「本地业务写成功仍只表示 live Y.Doc 已提交且本地 dirty notification 已登记；它不等待 hub、其他 peer 或本地物理 flush。复制提供最终一致，不提供线性一致、quorum durability 或远端确认承诺。」

**资源上限**

- 「以下上限均为插件配置并提供安全默认值：最大 WS frame、最大单 update/diff、每连接最大 channel 数、per-channel/连接待发送字节、bootstrap/idle timeout、心跳与失联判定。普通超限以稳定错误关闭单个 channel；framing、认证等连接级错误才关闭整条连接。」

**参考实现取舍（codec 相关的「不得照搬」项）**

- 「不得照搬：……不一致控制帧编码；……通过数值范围猜测协议版本。」

**非目标（本票同样不做）**

- 「hub 自动选举、故障切换或从 peer 自动恢复；hub 级联、多 hub、peer-to-peer 或一个 peer 连多个 hub；awareness/presence；客户端 y-websocket 兼容端点；跨地域强一致、全局顺序或 quorum durability；自动覆盖 identity/epoch 冲突；raw update 的完整 VFSL 校验；namespace discovery/list 和通配 selector；durable outbox、增量 WAL 或跨重连 update ID 表；shared filesystem 多写。」

### ADR-0009 NamespaceRegistry、调用方租约与 Cordis Host 生命周期（accepted；Registry identity 由 ADR-0010 修订）

- 与本任务的关联点：本任务不触 Registry；仅作为 namespaceId 身份语义的背景链。codec 严格校验的 namespaceId 格式，其生成规则定义于被 0010 修订后的身份条款。
- 核心条款（原文摘录，ADR-0010 修订节）：
  - 「Registry entry key 修订为仅 `namespaceId`。普通 `Registry.create()` 不再接受调用方指定 namespaceId，而由注入的受控 128-bit CSPRNG 生成 `ns-` + 32 位小写 hex」
  - 「`owner.userId` 继续是 create/open 的重要本地属性和 Persistence 分区键，但不再参与 Registry entry key或 wire identity。……owner不写入同步 META，也不上 wire。」

### ADR-0007 / ADR-0008（accepted；0007 的 open/read 条款由 0008 部分取代）

- 与本任务的关联点：本任务不做 apply、不触 write sequencer；但 raw update「不继承 zero-write 保证」是 0010 对 0007/0008 的显式例外，全链 SA 在设计 ACK/ERROR 语义时不得把 wire ACK 误述为验证或落盘承诺。
- 核心条款（原文摘录，ADR-0010「取代与关联」节）：
  - 「本 ADR 对 ADR 0007/0008 的“未来 raw Yjs update 必须另设受控通道”作出决定：通道位于 NamespaceLease 的 ReplicationSession，并继续进入唯一 write sequencer；但 trusted raw update 明确不继承普通业务写的完整 VFSL zero-write 保证。」

### ADR-0001–0006（accepted；与本任务无直接碰撞）

- 0001（VFSL 单一真相源）/0002（重写定位、authority 出范围）/0003（求值器）/0004（类型投影）/0005（投影生成管线，含「`packages/` = 可复用库」的包位置惯例）/0006（持久化）：本任务为纯 wire codec 包，不含 schema 文本、不触持久化与校验管线；无直接条款约束。包落在 `packages/` 与 0005 §5 的「`packages/` = 可复用库」定位一致。

## CONTEXT.md 相关术语与惯例

- `namespaceId`：「Registry entry 与实例复制 wire 的唯一 namespace 身份，普通 create 由受控 128-bit CSPRNG 生成 `ns-` + 32 位小写 hex；Registry 在当前进程内只以 namespaceId 排他索引。Persistence 仍用 owner.userId 分区，owner 是 open/create 的本地重要属性但不上 wire，也不参与复制身份」。_Avoid_:「用户可读名称、由调用方任意指定的 ID、`(owner.userId, namespaceId)` Registry key、存储层严格全局唯一承诺」。
- `复制谱系（replication lineage）`：「由 `META.replicationId` 标识的 namespace 复制身份；只有 namespaceId、replicationId 与 replication epoch 全部匹配的副本才允许直接执行 Yjs state-vector reconciliation。replicationId 是 128-bit 随机值的固定小写 hex，不等同于 namespaceId 或 SCHEMA 信封 `id`。」——bootstrap/sync/identity payload 携带的身份字段语义。
- `复制代际（replication epoch）`：「`META.replicationEpoch` 中从 1 开始、只由 Hub 显式提升的安全整数；相同复制谱系但 epoch 不同的副本进入冲突状态，必须显式 reset/bootstrap，不自动覆盖或合并。」_Avoid_:「连接次数、自动选主 term、可回绕版本号」。
- `Hub（中心实例）` / `Peer（边缘实例）`：术语纪律——_Avoid_ master/leader/slave/follower（会误示单写权威、选举或只读语义）。
- `ReplicationSession`：「由 NamespaceLease 打开的受信任 duplex raw Yjs 复制会话；……不暴露 live Y.Doc。」——属后续切片，本票 codec 不实现。
- `复制未校验（replication-unvalidated）`：raw update 不做完整 VFSL 预校验的复制状态——本票不实现，但 codec 文档/错误码不得宣称 validation 语义。
- ⚠️ 术语区分：「信封（envelope）」在 CONTEXT.md 指 **SCHEMA 四键信封** `{lang, version, id, text}`；本任务的「NMCR envelope / wire envelope」是**复制 wire 头**，二者同名不同域。ADR-0010 自身即以「envelope」称呼 wire 头（「固定 envelope为 20-byte大端头」「Envelope version」），全链 SA 行文与命名需按域区分，避免混淆。

## 任务简报中超出 ADR 的收严项（非冲突，实现须照简报执行）

- 「不依赖 Node `Buffer`」「不依赖 Node server」：ADR-0010 仅排除 Cordis/WS/Registry，Buffer 与 Node server 限制为 issue AC 明文的额外收严。
- 「显式直接依赖并锁定兼容的 yjs / y-protocols / lib0 组合」：ADR-0010 明文「显式直接依赖的lib0」+「锁定版本的`y-protocols/sync`语义」；yjs 直接依赖为简报/issue AC 的具体化。

## 设计引入的新决策点（2026-08-27 设计后复审追加，源自 design R0）

> 以下为 SA1 设计在本票内冻结的任务级决策（非 ADR 条款，但全链 SA2/SA3/SA4/SA7 复审与验收须以此为基准；出处 = design R0 章节）。

- **D-1 读/写路径不对称**（design §5.1）：读路径完全自研 `CanonicalReader`（有界、canonical、严格 UTF-8，任何失败→`ProtocolError`）；写路径用 `lib0/encoding`（wire 格式生产侧权威、golden 按锁定版本核对）。依据：规范 §4（instance-replication-v1.md line 74）要求 decoder 拒绝截断/溢出/非 canonical/非法 UTF-8，而 lib0@0.2.117 解码侧存在非最短 LEB128 接受、`readVarUint8Array` 越界 RangeError、`readUint32BigEndian` NaN→0 静默、Safari TextDecoder polyfill 非 fatal 四项实证缺陷（design F4–F6）。
- **D-2 严格 UTF-8 = fatal TextDecoder + ignoreBOM**（design §5.2）：BOM 不剥离（EF BB BF 解码为 U+FEFF 内容）——canonical roundtrip「成功即逐字节还原」的必要条件。
- **D-3 ERROR encode 的 scope 解析**（design §6.3）：`namespaceId` 提供且非 undefined → namespace scope；否则 connection scope；code 不在对应注册表 → `MALFORMED_FRAME`（消解 INTERNAL_ERROR 双注册表歧义）。
- **D-4 `MESSAGE_NAMES` 键类型 `Record<string, MessageName>`**（design §6.1）：红灯测试以 `Object.entries` 产出的 string 键索引。
- **decodeFrame 9 步固定检查顺序**（design §4.2）：magic → 长度下限 → 版本 → flags → reserved → type → maxFrameBytes → 长度恰等 → expectedSequence；顺序即分类确定性，SA3/SA4 不得重排。
- **sequence 只做 seam 不做状态**（design §1.3）：codec 仅提供 `expectedSequence` 严格相等检查（`SEQUENCE_VIOLATION`）；「从 1 严格递增、不回绕」归状态层（ws-replication），codec 须可承载 0xffffffff。
- **limits 策略**（design §10）：启动响亮验证（`validateCodecLimits`）、无运行时 clamp；`maxFrameBytes` 缺省 16 MiB；三个字段级限额缺省不设限（仍受帧级约束）。
- **manifest 组合锁**（design §11.1）：`lib0 ^0.2.117` + `y-protocols ^1.0.7` + `yjs ^13.6.30` 显式直接依赖；yjs/y-protocols 声明而 src 不 import（组合锁 + 互通矩阵运行载体），src 运行时唯一外部 import 是 `lib0/encoding`。
- **唯一异常类型 `ProtocolError`**（design §9）：codec 一切失败路径只抛 ProtocolError；`message`/`stack` 为本地诊断，永不上 wire（safeMessage 由调用方显式给定）。
- **红灯测试基线**（design §12/§18）：SA6 owned 的 9 测试文件 + fixtures（18 golden），SA3 不得改断言/golden；含 §15 报告的 `codec-api.test-d.ts:85` 一行 type-only 断言修正需求（须 SA6/总控授权执行）。

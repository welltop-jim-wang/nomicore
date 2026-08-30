# 冲突门禁报告（设计后复审，SA8 Phase 2）

- **被审对象**：`wiki/raw/task_replication-protocol-v1-codec_design.md`（SA1 设计 R0，687 行，全量读取）
- **冲突基准**：ADR 全集 `docs/adr/0001–0010` + `CONTEXT.md`（前置门禁已全量盘点，本复审不重复；重点 = ADR-0010 全条款 + 范围/依赖/纯包边界）
- **门禁类型**：设计后复审（SA2 全维度破壁评审之前/并行的一致性裁决）
- **日期**：2026-08-27（run_id: issue-135-1787792421-862383）
- **佐证核实**：`docs/protocols/instance-replication-v1.md` line 58/64/74/587（ADR-0010 委托的唯一 wire contract，用于消解关键争点）

## Verdict

`clear`

设计 R0 与 ADR 全集 + CONTEXT.md 无冲突。裁决分布：no-conflict（逐条款见下表，14 项核对 + 范围/依赖两组专项）；override-declared × 0；evolution × 0；hard-violation × 0；冲突点 0。

## ADR-0010 逐条款核对（设计后复审重点）

| # | ADR-0010 条款（原文） | 设计落点 | 对照结论 |
|---|---|---|---|
| 1 | 「固定 envelope为 20-byte大端头：`NMCR` magic、envelope version、message type、flags、direction-local sequence、payload length和reserved」 | design §4.1：4+1+1+2+4+4+4 = 20 字节全 BE，字段名与顺序逐一对应 | no-conflict |
| 2 | 「首版flags/reserved必须为零」 | §4.1/§4.3：encode 恒写 0；decode flags≠0→`UNSUPPORTED_FLAGS`、reserved≠0→`MALFORMED_FRAME` | no-conflict |
| 3 | 「一条WebSocket binary message恰好承载一个完整frame」 | §4.2 步骤 8：`byteLength ≠ 20+payloadLength` 拒绝（含尾随）；§4.3 输出恒 20+payload | no-conflict |
| 4 | 「Wire不使用channelId：每个 namespace-scope frame直接携带namespaceId」 | §7.0 R2：namespace-scope 消息首字段 `varString namespaceId`（`^ns-[0-9a-f]{32}$`）；全设计无 channelId | no-conflict |
| 5 | 「控制payload使用显式直接依赖的lib0 canonical encoding，内层复用锁定版本的`y-protocols/sync`语义」 | §5（D-1）+ §11.1：lib0 为显式直接依赖；写路径 = lib0/encoding（格式生产侧权威，golden 逐字节核对）；读路径自研严格 CanonicalReader。**关键争点，专项裁决见下节** | no-conflict（附解释记录） |
| 6 | 「Envelope version只决定头布局，HELLO显式协商完整protocol version与capabilities；不得按消息数值猜版本」 | §8：两层显式分离（envelopeVersion=1 仅头布局 / HELLO protocolVersions 完整语义版本）+ `selectProtocolVersion`/`selectCapabilities` 纯函数；无任何按消息数值猜版本的路径 | no-conflict |
| 7 | 「每方向sequence从1严格递增，不回绕；gap、repeat或错误ACK关联关闭连接」 | §1.3/§4.1：codec 只提供 `expectedSequence` 严格相等 seam（`SEQUENCE_VIOLATION`），可承载 0xffffffff；递增/回绕/关连接纪律归状态层——与 ADR-0010 包切分（连接状态机属 `@nomicore/ws-replication`）一致 | no-conflict |
| 8 | 「Upgrade后Peer发送HELLO，Hub回复HELLO_ACK并绑定Peer/Hub instance identity」「GOAWAY提供相对drain timeout」 | §7.1：HELLO（peer-to-hub）携带 peerInstanceId/expectedHubInstanceId；HELLO_ACK（hub-to-peer）携带 hubInstanceId；GOAWAY 携带 drainTimeoutMs | no-conflict |
| 9 | 「每个sync round由Peer以uint32 roundId发起……以SYNC_APPLIED确认」「UPDATE_ACK同样只表示sequenced live apply + dirty notification」 | §7.1：SYNC_STEP1/2/APPLIED 均携带 syncRoundId(varUint32)；codec 只暴露 ack 元数据不强制语义，不超卖 flush/副本确认 | no-conflict |
| 10 | 「连接与namespace状态、消息码、payload字段、错误码、timeout、close code、backpressure和完整时序以`docs/protocols/instance-replication-v1.md`为唯一wire contract」 | 设计 §0/§12 全程以规范 v1 为唯一权威（17 消息 + 17+20 错误注册表逐格移植，golden 禁改），未另立 wire 语义 | no-conflict |
| 11 | 「`@nomicore/replication-protocol`：纯二进制 codec、显式版本协商、消息与稳定错误，不依赖 Cordis、WS 或 Registry」 | §11：manifest deps 仅 lib0/y-protocols/yjs；src 唯一运行时 import `lib0/encoding`；无状态纯函数；包名/形态逐字对应 | no-conflict |
| 12 | 「以下上限均为插件配置并提供安全默认值：最大 WS frame、最大单 update/diff……」 | §10：maxFrameBytes 缺省 16 MiB、字段级限额可配置缺省不设限、启动响亮验证无 clamp；配置所有权归插件（ws-replication），codec 只提供机制 | no-conflict |
| 13 | 「`instanceId` 使用 `^[a-z][a-z0-9-]{0,62}$`」 | §7.0 R5：同款正则逐字符一致 | no-conflict |
| 14 | 参考实现取舍「不得照搬：……不一致控制帧编码；……通过数值范围猜测协议版本」 | 全部消息统一同一 canonical 编解码管线（无控制帧特例）；版本协商仅显式 HELLO 路径 | no-conflict |

### 专项裁决：D-1（自研读路径）vs「lib0 canonical encoding」条款

- **争点**：design §5.1 决策读路径完全自研 `CanonicalReader`，是否违反 ADR-0010「控制payload使用显式直接依赖的lib0 canonical encoding」。
- **裁决：no-conflict**。依据三链：
  1. 该条款约束的是 **wire 格式与依赖声明**（payload 采用 lib0 canonical 编码格式；lib0 为显式直接依赖）——设计两者均满足：lib0 在 manifest 直接依赖（§11.1），写路径用 lib0/encoding 产出，golden 十六进制与锁定版本 lib0 行为逐字节核对（规范 line 587 同款纪律）。
  2. ADR-0010 明文把「payload字段、错误码……完整时序」委托给规范 v1 为唯一 wire contract；规范 line 74 要求「Decoder 必须完全消费 payload，拒绝截断、溢出、非 canonical 数值编码、非法 UTF-8、错误 optional marker……」——设计 F4–F6 实证 lib0@0.2.117 解码侧无法满足（非最短 LEB128 接受 / 越界 RangeError / NaN→0 静默 / Safari polyfill 非 fatal）。**直接使用 lib0 decoding 反而违反该委托条款**；D-1 是同时满足两者的实现策略。
  3. 设计未声明推翻任何 ADR 条款、未修订决策本身（格式仍是 lib0 canonical）——非 override、非 evolution。
- 此解释已记录于相关决议文档「设计引入的新决策点 D-1」，供 SA2/SA4 复审沿用。

## 范围边界核对（防越界）

| 边界 | ADR-0010 依据 | 设计落点 | 结论 |
|---|---|---|---|
| WS 连接/namespace/sync 状态机 | 属包 2 `@nomicore/ws-replication` | §1.3 非目标 + §18 DENY LIST `packages/ws-replication/**` | 未越界 |
| 认证授权（bearer token、authorization） | 属包 2 | §1.3 非目标；设计无任何 token/权限面 | 未越界 |
| 背压调度 | 「backpressure……以规范为 wire contract」「网络背压不得进入Runtime sequencer」 | §1.3 非目标；§10 limits 是本地配置校验（拒绝超限帧），非发送调度 | 未越界 |
| Yjs 字节解释/apply/合并 | ReplicationSession/sequencer 属后续切片 | §1.3：stateVector/update/snapshot 按不透明 `varUint8Array` 载荷搬运 | 未越界 |
| Runtime/Registry/Persistence 集成 | ADR-0006/0008/0009 各自领地 | §17 契约改动连锁审计：greenfield 零 caller；§18 DENY LIST 全部既有包 | 未越界 |
| 文档/决议反向修改 | — | §18 DENY LIST：`docs/protocols/**`、`docs/adr/**`、`CONTEXT.md` 不改 | 未越界 |

唯一跨文件改动：根 `package.json` typecheck 链追加一段 + `pnpm-lock.yaml`（install 产物）——工程接线，非契约改动。

## 依赖锁定与纯包边界核对

- **依赖锁定**（AC5）：manifest `lib0 ^0.2.117` + `y-protocols ^1.0.7` + `yjs ^13.6.30`，与 lockfile 现状（yjs 13.6.32 单解、lib0 0.2.117）和 y-protocols@1.0.7 peer 兼容性（F8 实测）一致；ADR-0010「锁定版本」语义满足。yjs/y-protocols 声明而 src 不 import = manifest 级组合锁（保证 ws-replication 与本包解析同一兼容组合 + 互通矩阵载体）——无任何 ADR 条款禁止，其优劣属 SA2 评审领地。
- **纯包边界**：无 Cordis/WebSocket/Registry/Node server/Node Buffer（§11.2，含 Buffer 遮蔽红灯锚点）；全局仅 `Uint8Array`/`TextEncoder`/`TextDecoder`/`Number`/`Math`，跨平台。比 ADR-0010 排除面更严（issue AC 收严项），方向一致。

## CONTEXT.md 术语与身份文法核对

- `namespaceId` `^ns-[0-9a-f]{32}$`（R2）、`replicationId` `^[0-9a-f]{32}$`（R3）、`replicationEpoch` ≥1 且 ≤MAX_SAFE_INTEGER（R4）——与 CONTEXT.md「ns- + 32 位小写 hex」「128-bit 随机值固定小写 hex」「从 1 开始的安全整数、达到 MAX_SAFE_INTEGER 拒绝」逐条一致。
- terminalState 词表含 `conflicted`/`needs-resync`——与 ADR-0010「稳定 `conflicted` 状态」「标记为 `needs-resync`」同词。
- 「envelope」双域区分：design §1.2 明示 NMCR wire 头用法与 SCHEMA 信封区分——与前置门禁观察项 2 一致。
- owner 不上 wire：设计所有 payload 无 owner 字段 ✓。

## 冲突点

无。

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

## 结论

**Verdict: clear —— 设计 R0 与 ADR 全集一致，SA2 全维度破壁评审可进行，无需 override，无需 Jim 裁决的演进条目。**

### 非阻塞观察项（上报总控，不构成门禁拦截）

1. **D-1 解释已登记**（本报告专项裁决节 + 相关决议文档）：「lib0 canonical encoding」条款按「格式 + 直接依赖」解释，严格解码由 ADR-0010 委托的规范 v1 line 74 强制；SA2/SA4 复审请沿用该解释，勿重复争点。
2. **设计 §15 阻塞报告转呈**：`packages/replication-protocol/test/codec-api.test-d.ts:85` 存在一处无法由任何实现满足的 type-only 值用位断言（TS1361，SA1 已实测复现并给出唯一可行一行修正 `expectTypeOf<ProtocolError>()`）。该文件为 SA6 owned——须总控授权 SA6 修正，否则 Phase 4 静态评审会出现与 SA3 实现质量无关的 1 个 TypeCheckError。**此为流程项，非 ADR 冲突。**
3. **manifest 组合锁（yjs/y-protocols 声明不 import）**：无 ADR 条款冲突；是否保留该形态属 SA2 设计评审领地，设计已备好答复（§11.1）。

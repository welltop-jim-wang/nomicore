# 冲突门禁报告 — 设计后复审（Phase 2）

> SA8 产出。被审对象：`wiki/raw/task_ws-replication-hardening_design.md`（SA1 R1 初稿，2026-08-28）。
> 冲突基准：`docs/adr/` 全集（10 个，逐个全文读取，无抽样）+ `CONTEXT.md`；
> `docs/protocols/instance-replication-v1.md` 经 ADR-0010 L151 钦点为唯一 wire contract，按「被 ADR 收录的约束」纳入对照。
> 本报告只裁决冲突，不判断设计优劣（SA2 域）、不判断可实现性（SA3/SA4 域）。

## Verdict

`clear`

（6 个审查点全部 no-conflict；0 override-declared / 0 evolution / 0 hard-violation。其中 #1 为重点解读记录，已在结论中显式上报供 Jim 知悉，但不构成停运行条件。）

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致（含 #134 / #133 修订节） | accepted | 是（全部 21 条要求的活动域） | 逐条对照**通过**。L143（同连接单生命周期/重开须重建连接 ↔ §4.5 NAMESPACE_REOPEN_REQUIRES_RECONNECT、§1.2 整连接重建）、L145（版本协商不猜数值 ↔ 零改动）、L147（bearer/HELLO 绑定/序号纪律/ping-pong/GOAWAY ↔ §1/§2/§5.1）、L149/L151（round 纪律、恢复恒由 peer 发起、per-ns 溢出丢弃+needs-resync、round-robin、control/ACK 保留额度、背压不入 Runtime sequencer ↔ §2.3/§3 全组）、L155–158（授权身份源 ↔ §1.1 只消费受信身份）、L165（资源限制与单 channel/整连接二分 ↔ §3.2/§3.3，见冲突点 #2）、L173–175（包边界 ↔ DENY LIST 精确吻合）、L179（停止顺序 ↔ §4 收口次序）均一致。两处保留：L147 对 CLOSE_OK 的字面张力（冲突点 #1，裁定 no-conflict）；L167 observer 义务本任务延后开票（冲突点 #4）。 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器（含 #93 / #132 修订节） | accepted | 是（纪律援引：L93 无条件排空；L135 status replication 域两态） | **通过**。设计援引 L93「无条件排空」于 §4.1（收到 CLOSE 不设内部 timeout）语义准确；Runtime 域零改动（DENY LIST 含 namespace-runtime/**）；needs-resync 等网络状态未入 Runtime status（L135 不触碰）。 |
| ADR-0009 | NamespaceRegistry、调用方租约与 Cordis Host 生命周期（含 #131 / #134 修订节） | accepted | 是（L42 release 不追踪 apply；L83 外部 Clock/Timer 注入；L150 release 同步段） | **通过**。全部延迟经注入 timer/`ReplicationTimer`/`deferTask` seam（§3.4/§5.1/§5.2），无原生 timer fallback；channel 侧「apply settle 后才 release Lease」是 §16 L475 的通道层编排，与 L42「release 不追踪/取消已接纳 apply」不矛盾（release 动作本身仍不取消）；包零改动。 |
| ADR-0006 | Cordis 持久化插件（含 #133 修订节） | accepted | 弱相关（L211 边界参照） | **通过**。Persistence 零改动；§6 对 resetReplica 归属的记录（Registry 受信编排、ADR-0010 L57 + #133 修订、ADR-0006 L211 调用方职责）与 ADR 文本一致。 |
| ADR-0001 | VFSL 单一真相源 | accepted | 否 | 无触及（schema 文本/信封/方言零改动）。 |
| ADR-0002 | 重写定位、authority 出范围 | accepted | 否 | 无触及。 |
| ADR-0003 | 求值器与派生 schema | accepted | 否 | 无触及。 |
| ADR-0004 | vfsl-protocol 类型协议包 | accepted | 否 | 无触及。 |
| ADR-0005 | 投影生成管线 | accepted | 否 | 无触及。 |
| ADR-0007 | 逻辑验证与 Yjs bridge（Runtime/open/read 条款被 ADR-0008 取代） | accepted（部分被取代） | 否（被取代部分不构成约束） | 无触及；设计未扩大 trusted raw update 的 zero-write 例外（CONTEXT「复制未校验」词条遵守）。 |
| CONTEXT.md | 术语与硬性惯例 | — | 是 | **通过**。Hub/Peer、namespaceId、复制谱系用法正确；「停接纳」按词条明示的「channel/session 层同构方向」落实（§4.1 同步 closing）；ReplicationSession avoid-list 三项（裸 Y.Doc handler / 绕过 sequencer 的 apply / 网络状态入 Runtime status）均未触碰；「复制未校验」未加 VFSL 校验或回滚。术语注记：设计内「连接代际（connection epoch）」为传输层 socket 世代概念，与冻结词「复制代际（replication epoch，META.replicationEpoch）」是**不同概念**，不上 wire、不入 META——建议保持命名区分（见结论注 4）。 |
| instance-replication-v1.md | wire contract（ADR-0010 L151 钦点权威） | accepted | 是 | 设计行为与 §§1–21 逐节核对**一致**：§2 L36–40（Upgrade 认证产物受信 / 活性仅 WS ping-pong）、§6.1 L120（HELLO 身份必须等于 Upgrade 身份）、§8.2 L197（BOOTSTRAP_ACK 关联）、§9.4 L248/L250（RESYNC 声明与 peer 发起、ACK timeout 属 resync 触发面）、§10.1 L261（未发送未占序列可合并 ↔ 入队不占序列）、§10.2 L279–281（窗口/ACK_STATE_VIOLATION）、§12 L304/L311/L313（CLOSE 同步停接纳、CLOSE_OK 关联、close 丢包容）、§13.1/§13.2 注册表（错误码/close code/终态全部按注册消费，零新码）、§14 L385–391（1011=control backpressure、best-effort ERROR 后 close）、§15.1（GOAWAY 原因分类/1011 继续退避）、§16 L469–475（断线同步 cleanup、CLOSE 同步停接纳、迟到结算不复活、重开须重建连接）、§17 L479–506（两级上限/shedding 至低水位/round-robin/控制保留额度/bufferedAmount 水位经注入 timer/启动响亮校验不运行时 clamp）、§18 L518–520（ping interval/pong timeout 可配、pong timeout 关连接、ACK timeout 进 needs-resync）。设计 DENY LIST 明示不修改协议文本。 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | 中（解读张力，非违反） | ADR-0010 L147「每方向sequence从1严格递增，不回绕；gap、repeat或错误ACK关联关闭连接」 | 设计 §2.2：CLOSE_OK `ackedSequence` 错配 → **静默忽略、保持 closing、closeTimeout 收口该 namespace**，不关连接、非 connection fatal | no-conflict | (a) 同一 ADR L151 把「错误码、timeout、close code、backpressure和完整时序」的权威**让渡**给协议文本，协议对该文本是裁定权威；(b) 协议自身对 ACK 关联违例采**分级**策略而非一律关连接——§10.2 L281 UPDATE_ACK 错配→`ACK_STATE_VIOLATION` 连接 fatal，§9.3 L239 SYNC 族（同样携带 ackedSequence/relatedSequence）→`SYNC_STATE_VIOLATION` 仅 **namespace** fatal；CLOSE_OK（§12 L311）未置连接 fatal 条款，且 §12 L313 明示 close 路径丢包容（「正常 close 不等待丢失的 UPDATE_ACK；下次连接通过 state vector 修复」）；(c) ADR-0010 L165「普通超限以稳定错误关闭单个 channel；framing、认证**等**连接级错误才关闭整条连接」的爆炸半径纪律支持 namespace 级收口（多 ns 复用一条连接）；(d) 任务简报 G2.2 措辞刻意弱于 G2.1（"invalid ACK correlation must not complete close" vs G2.1 "must follow the protocol violation/error policy"），为发行方意图证据；(e) SA6 红灯契约明示「保持 closing 或停连接」两锚等价。伪造/陈旧 CLOSE_OK 无法推进状态（安全目标达成）。**记录在案**：若 Jim 对 L147 取严格字面读法（一切 ACK 关联错配一律关连接），本条需改判并要求 SA1 调整 §2.2 或走正式 ADR 修订。 |
| 2 | 低 | ADR-0010 L165「普通超限以稳定错误关闭单个 channel；framing、认证等连接级错误才关闭整条连接」 | 设计 §3.3：控制保留额度耗尽 → `connectionFatal('CONNECTION_BACKPRESSURE', 1011)` 关闭**整条连接** | no-conflict | (a) L165「等」为非穷尽列举；(b) 协议（L151 让渡权威）§13.1 将 `CONNECTION_BACKPRESSURE` 注册为 **connection-scope** fatal/retryable=yes/1011，§14 L389 明示 1011＝「不可恢复内部错误或 **control backpressure**」——连接级定性由 wire contract 直接给出；(c) 任务简报 G3.4 明令 "terminate with `CONNECTION_BACKPRESSURE` when exhausted"；(d) 普通超限路径（数据入队超限 → shed 最大 ns → 单 channel needs-resync，设计 §3.2）仍严格按 L165 单 channel 纪律实现，1011 仅在「数据已无可 shed、socket 缓冲仍超连接总预算」的结构性耗尽点触发。 |
| 3 | 低 | 无 ADR 条款冻结 `accept()` 签名（关联：ADR-0010 L155；协议 §2 L36） | 设计 §1.1：`accept(transport, identity?)`，identity 缺失 → 同步 `TypeError`（响亮拒绝，绝不采信 HELLO 自述身份） | no-conflict | (a) ADR-0010 L155/协议 §2 L36 要求 Upgrade 认证产物为受信身份源，设计是其直接落实；(b) 响亮的构造/入参期 TypeError 与仓库既有纪律同族（ADR-0009 #134 修订 O-4 角色 TypeError、`validateTimeouts` 族），无条款禁止；(c) 公共类型面仅做**加性可选**扩展（可选参数/可选成员），SA6 红灯契约已预认可该形状。 |
| 4 | 低 | ADR-0010 L167「复制插件提供结构化 observer seam……最小观测面包括：……」 | 设计 §6：结构化 observability 判**未交付**，建议总控开独立实现票；本设计预留 `onDataShed`/`onControlExhausted` 回调面供挂接 | no-conflict（延后，非违反） | (a) 任务简报 G6 明确授权 "Clarify whether … structured observability … are delivered by later slices; create/link separate tickets if they are outside this fix"——澄清+开票即为本项要求的完成形态；(b) 设计不与条款矛盾（未声称已交付、未缩减义务），属阶段化安排。**提醒**：L167 义务不因本任务消失，总控须确保独立票据实际建立（同批：apps/yjs-server 组合根，ADR-0010 L175 切片 9）。 |
| 5 | 低 | ADR-0008 L93「此前已接纳任务无条件排空，不取消、不设内部 timeout」 | 设计 §4.1：**收到对端 CLOSE** 的 drain 不 arm closeTimeout（本地无条件排空）；本地 removeTarget 路径 closeTimeout 保持 | no-conflict | 与 L93 字面一致（该词为 Runtime 域纪律，CONTEXT「停接纳」词条明示 channel/session 层为同构方向）；协议 §12 L304「已被 sequencer接纳的 apply无条件完成」同向；§18 `closeTimeoutMs` 在设计中仍辖本地发起的 close（removeTarget），两路径分工与 wire contract 一致。 |
| 6 | 低 | 协议 §5 不变量 2（每条正常 frame 消费方向 sequence）+ §10.1 L261（经 ADR-0010 L151 收录） | 设计 §3.1：数据帧入队**不携带、不预占**序列，序列在 `emitOne` 实际出队发送时单点分配 | no-conflict | 协议 §10.1 L261 明示「**尚未分配 sequence**、尚未发送的 updates 允许 `Y.mergeUpdates()` 合并」——入队未发送不占序列是协议明文语义；不变量 2 在单点分配下保持（发出即消费序列、严格递增）；`frame-io.ts` 头注冻结纪律（R3/#7）为同一约束，设计显式保持。 |

## 结论

**Verdict: clear — 放行（进入 SA2 全维度攻击评审）。**

- 审查点 6 项，裁决分布：**no-conflict 6 / override-declared 0 / evolution 0 / hard-violation 0**。设计 §0「唯一 wire contract + ADR-0010 条款为行为基准、不修改协议文本」的总纲与 DENY LIST（`docs/protocols/**`、`docs/adr/**`、其余四包、apps/**）在基准层面完全成立。
- **上报 Jim 知悉（不阻塞）**：冲突点 #1（CLOSE_OK 错配不关连接）是全部对照中唯一存在 ADR 字面张力的解读。SA8 裁定 no-conflict 的理由链是「L151 权威让渡 + 协议分级违例模式 + L165 爆炸半径纪律 + 任务简报措辞差异」；若 owner 对 ADR-0010 L147 取严格字面读法（一切错误 ACK 关联一律关连接），应指示 SA1 修订 §2.2 违例策略或发起正式 ADR 增补——在此之前本设计该节与基准不构成冲突。
- **义务提醒（不阻塞）**：ADR-0010 L167（结构化 observer 最小观测面）与 L175（apps/yjs-server 组合根）在本任务后仍为**开放义务**；设计已按任务简报 G6 给出开票建议并预留回调面，总控须落实票据链接，防止义务漂移丢失。
- **编辑性瑕疵（转 SA1/SA2，不影响本裁决）**：设计文档存在 4 处悬空/松散协议引用——「§13.4」×3（协议无此节；迟到帧/不复活/零 wire 语义的实际锚点为 §16 L469–475 与 §1 不变量）、「§14.1 整连接重建」（实际锚点 §16 L473）、§3.1 对「§10.1『声明后丢弃，round 修复』」为转述而非原文（§10.1 L261 原文为 reconcile 期排队语义；丢弃修复的实际锚点是 §9.4 L248 + §17 L488 + §1 不变量 9）。建议 SA1 在 R2 修订引用；语义本身与 wire contract 一致。
- **术语注记**：设计内「连接代际（connectionEpoch）」是传输层 socket 世代闸门概念，与 CONTEXT 冻结词「复制代际（replication epoch = META.replicationEpoch，仅 Hub 显式提升）」**无语义交叠**（不上 wire、不入 META、不参与复制谱系判定）。建议实现期保持 `connectionEpoch` 命名，避免与 `replicationEpoch` 混用。
- 设计引入的新决策点已按技能规程追加至 `_relevant_decisions.md`「设计后复审追加」节，供 SA2/SA3 复用。

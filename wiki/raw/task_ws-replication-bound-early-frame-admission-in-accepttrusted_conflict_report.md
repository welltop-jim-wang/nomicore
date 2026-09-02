# 冲突门禁报告

- 被审对象：任务简报 `wiki/raw/task_ws-replication-bound-early-frame-admission-in-accepttrusted.md`（issue #190，bugfix，阶段：前置门禁）
- 冲突基准：`docs/adr/` 全集（10 篇，逐篇全读）+ `CONTEXT.md`（138 行全读）。代码与 wiki 其他文档仅作落点定位，不构成裁决依据。

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19 目标态/阶段态修订、08-21 命名修订） | 否 | 无冲突——任务不触碰 schema 文本、信封、方言或 codegen |
| ADR-0002 | nomicore 是全新重写，authority 出范围 | accepted | 否 | 无冲突——不涉及 authority 规则体系 |
| ADR-0003 | 求值器与派生 schema | accepted | 否 | 无冲突——不涉及 evaluate/ROOT/联合表示 |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | 无冲突——不涉及类型协议包 |
| ADR-0005 | 投影生成管线 | accepted | 否 | 无冲突——不涉及 SchemaSource/生成器 |
| ADR-0006 | Cordis 持久化插件 DocPersistence | accepted（含 #64/#79/#131/#133 修订节） | 否 | 无冲突——不触碰 Persistence/saveDoc/flush/归档 |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（Runtime/open/read 条款被 ADR-0008 部分取代） | 否 | 无冲突——不涉及校验/物化/mutation 管线；被取代条款亦不涉及 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 #93/#132 修订节） | 邻近 | 无冲突——早期帧接纳位于 transport 层（HubConnectionImpl 构造之前），不触碰 write sequencer、P0、稳定码注册表；且方向上强化「网络背压不得进入 Runtime sequencer」 |
| ADR-0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（含 #131/#134 修订节） | 否 | 无冲突——不触碰 Registry/Lease/idle/shutdown |
| ADR-0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（含 #134 两轮 / #133 / #161 / #172 修订节） | **是** | 无冲突——简报是对本 ADR「资源限制」纪律的**对齐型 bugfix**：把 accept() 已有的有界早期帧接纳补齐到 acceptTrusted()，收窄而非改变既有决策 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | 无冲突点 |

**裁决分布**：no-conflict 10/10 条 ADR；override-declared 0；evolution 0；hard-violation 0。

## 逐条对照明细（无冲突佐证）

| 简报要求 | 对照 ADR 条款 | 结论 |
|---|---|---|
| 「accept() 与 acceptTrusted() 共用一套有界早期帧接纳机制」 | ADR-0010 §资源限制：「以下上限均为插件配置并提供安全默认值：最大 WS frame……」 | 一致——补齐实现缺口，落实既有上限决策，不新增/删除上限 |
| 「retain 字节前强制 maxFrameBytes 与 MAX_EARLY_FRAMES」 | ADR-0010 §资源限制（最大 WS frame 上限）+ §协议状态机「Per-namespace有界队列溢出时……」的有界队列纪律 | 一致——接收侧接纳界是同族纪律的补齐；MAX_EARLY_FRAMES 为实现层常量，ADR 未冻结其数值，无条款可违 |
| 「保留既有 close codes/reason 与 observer 事件」 | ADR-0010 §协议状态机：「close code、backpressure和完整时序以 docs/protocols/instance-replication-v1.md 为唯一 wire contract」；§资源限制「复制插件提供结构化 observer seam」 | 一致——明确**不改** wire 语义与观察面；无 ADR 条款被触碰 |
| 「listener 句柄未分配时保留同步 replay 安全」 | ADR-0010 #161 修订节：「transport 三可选面……缺面 dormant 语义」「连接收口同步静默订阅先于异步 drain」 | 一致——维持 transport 注入面的同步语义纪律 |
| 「被拒 transport 零 HubConnectionImpl 分配、不可被后续回调复活」 | ADR-0010 §参考实现取舍「不得照搬：WS handler 直接持有或写裸 Y.Doc……」+ §资源限制 | 一致——资源安全收紧方向，无 ADR 条款反向约束 |
| 验收 4「普通 token 验证行为不变」 | ADR-0010 §认证：「Bearer token在HTTP Upgrade前认证」；#161 修订节：「公共身份投影只取受信 Upgrade 身份（缺身份 accept = 响亮 TypeError）」 | 一致——简报明文冻结该路径零改动 |

## 结论

**Verdict: clear — 放行，可进入 SA 派发。**

- 无 hard-violation：简报没有任何条款与 accepted ADR 或 CONTEXT.md 直接冲突。
- 无 override-declared：简报未声明推翻任何 ADR。
- 无 evolution：简报不意图修订任何既有决策——它是把 ADR-0010 资源限制纪律在 trusted 升级路径上**对齐兑现**的 bugfix（收窄无界缓冲，方向与全部相关条款一致）。
- 非阻塞提醒（供 SA1/SA3 执行，不构成门禁条件）：
  1. 验收 1「documented frame-limit semantics」若需补/改对外文档语义，落点是 `docs/protocols/instance-replication-v1.md`（ADR-0010 钦定唯一 wire contract；#172 修订节明令 `wiki/raw` 非规范）。
  2. 术语纪律：沿用 CONTEXT.md 的 Hub/Peer 措辞，避免 master/leader/slave/follower（见相关决议文档）。

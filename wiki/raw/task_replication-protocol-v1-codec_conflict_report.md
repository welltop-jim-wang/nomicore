# 冲突门禁报告

- **被审对象**：`wiki/raw/task_replication-protocol-v1-codec.md`（任务简报，Phase 0 前置门禁）
- **冲突基准**：ADR 全集 `docs/adr/0001–0010`（10 个，全量逐个读取）+ `CONTEXT.md`
- **门禁类型**：前置冲突门禁（SA 派发之前）
- **日期**：2026-08-27（run_id: issue-135-1787792421-862383）；同日路径更正复核：简报 ADR 引用已修正为 `docs/adr/`，ADR 全集（0001–0010）无增删，verdict 不变

## Verdict

`clear`

无冲突点：任务简报的全部要求与 ADR 全集 + CONTEXT.md 既有决策一致；多数条款是 ADR-0010 wire 协议条款的直接落实。裁决分布：no-conflict × 10（ADR 全集逐个对照），override-declared × 0，evolution × 0，hard-violation × 0。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 单一真相源 | accepted（含 2026-08-19 修订节） | 否 | 本任务为纯 wire codec，不含 schema 文本，不触 0001 任何条款——no-conflict |
| 0002 | 重写定位、authority 出范围 | accepted | 否 | codec 无 authority/旧系统接口——no-conflict |
| 0003 | 求值器与派生 schema | accepted | 否 | 求值/派生域与本票无交集——no-conflict |
| 0004 | vfsl-protocol 类型投影 | accepted | 否 | 类型投影域与本票无交集——no-conflict |
| 0005 | 投影生成管线 | accepted | 弱 | 「`packages/` = 可复用库」——新包落 `packages/replication-protocol` 与之一致——no-conflict |
| 0006 | 持久化插件 | accepted（含 createDoc/owner/entry-status 修订节） | 否 | 本票非目标明确不含 Persistence——no-conflict |
| 0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（open/read 条款由 0008 部分取代） | 弱 | 被取代条款不构成约束；本票不做校验/apply——no-conflict |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含稳定码注册修订） | 弱 | 本票非目标明确不含 Runtime/sequencer；0010 已为 raw update 设显式例外——no-conflict |
| 0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（Registry identity 由 0010 修订为仅 namespaceId） | 弱 | 本票不触 Registry；简报 wire 身份=namespaceId 与 0010 修订后条款一致——no-conflict |
| 0010 | Hub/Peer WebSocket Y.Doc 复制 | accepted（Phase 5 设计） | **是（直接依据）** | 逐条款对照见下——全部一致——no-conflict |

## 与 ADR-0010 的逐条款对照（相关条款明细）

| # | 简报要求 | ADR-0010 条款（原文） | 裁决 |
|---|---|---|---|
| 1 | AC1「one WS binary message encodes exactly one 20-byte big-endian NMCR envelope plus its declared payload」 | 「一条WebSocket binary message恰好承载一个完整frame」「固定 envelope为 20-byte大端头：`NMCR` magic、envelope version、message type、flags、direction-local sequence、payload length和reserved」 | no-conflict（直接落实） |
| 2 | AC2 严格 framing（magic/version/flags/reserved/sequence/length/namespaceId/limits） | 「首版flags/reserved必须为零」「每方向sequence从1严格递增，不回绕」 | no-conflict（直接落实） |
| 3 | 「namespaceId 直接寻址」 | 「Wire不使用channelId：每个 namespace-scope frame直接携带namespaceId」 | no-conflict |
| 4 | 「lib0 canonical payload」+ AC5 锁定 yjs/y-protocols/lib0 | 「控制payload使用显式直接依赖的lib0 canonical encoding，内层复用锁定版本的`y-protocols/sync`语义」 | no-conflict（yjs 直接依赖为简报具体化，不违背） |
| 5 | 「显式 envelope/protocol 版本与 capability 协商，不靠消息数值猜测」 | 「Envelope version只决定头布局，HELLO显式协商完整protocol version与capabilities；不得按消息数值猜版本」+ 不得照搬「通过数值范围猜测协议版本」 | no-conflict（直接落实） |
| 6 | 「append-only 消息/错误注册表、专用 ACK、统一 ERROR」 | 「消息与稳定错误……消息码、payload字段、错误码……以`docs/protocols/instance-replication-v1.md`为唯一wire contract」「UPDATE_ACK同样只表示sequenced live apply + dirty notification，不表示物理flush或其他副本确认」 | no-conflict（注册表细则由 ADR 委托的 wire contract 承载） |
| 7 | 「纯包：不依赖 Cordis、WebSocket、Registry 或 Node server；不依赖 Node `Buffer`」 | 「`@nomicore/replication-protocol`：纯二进制 codec、显式版本协商、消息与稳定错误，不依赖 Cordis、WS 或 Registry」 | no-conflict（Buffer/Node-server 为简报在 ADR 之上的收严，方向一致） |
| 8 | 非目标：WS 连接/状态机、认证授权、背压、Runtime/Registry 集成 | 「2. `@nomicore/ws-replication`：WebSocket client/server、multiplex、认证授权、bootstrap/reconcile/live 状态机、背压和 observer」 | no-conflict（切分边界与 ADR 完全重合） |
| 9 | 新包 `packages/replication-protocol`（`@nomicore/replication-protocol`） | 「1. `@nomicore/replication-protocol`：纯二进制 codec……」+ 0005「`packages/` = 可复用库」 | no-conflict |
| 10 | namespaceId 格式严格校验（AC2） | 0010 修订节「由注入的受控 128-bit CSPRNG 生成 `ns-` + 32 位小写 hex」+ CONTEXT.md `namespaceId` 条目 | no-conflict |
| 11 | byte-level golden vectors「不得改字段顺序适配库偶然编码」 | 「消息码、payload字段、错误码……以`docs/protocols/instance-replication-v1.md`为唯一wire contract」 | no-conflict |
| 12 | owner 不出现在 wire 设计中 | 「owner……不上 wire，也不参与复制身份」 | no-conflict |

## 冲突点

无。

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

## 结论

**Verdict: clear —— 放行，SA1 设计可派发。**

无需 override、无需 Jim 裁决的演进条目、无停止原因。

### 非阻塞观察项（记录，不构成门禁拦截）

1. **简报路径引用（已解决，2026-08-27 复核关闭）**：初审时简报「规范依据」曾引用 `docs/decisions/0010-hub-peer-websocket-ydoc-replication.md`；路径更正后简报已改为 `docs/adr/0010-hub-peer-websocket-ydoc-replication.md`（已复核简报第 30 行，含「ADR 全集位于 `docs/adr/`」标注）。本报告冲突基准自始取自 `docs/adr/` 全集，ADR 内容与对照结论不变；后续链路（SA1 设计/SA2 评审）直接引用 `docs/adr/`。
2. **「envelope」同名双域**：CONTEXT.md「信封（envelope）」= SCHEMA 四键信封；本任务的 NMCR envelope = 复制 wire 头。ADR-0010 自身即如此双用，全链 SA 行文需按域区分（已在相关决议文档标注）。
3. **简报收严项**：「不依赖 Node `Buffer`」「不依赖 Node server」「yjs 直接依赖并锁定」为 issue AC 在 ADR-0010 之上的收严/具体化，实现（SA3/SA4/SA7）须按简报执行，不得以「ADR 未禁止」为由放宽。
4. **规范文档存在性已核实**：`docs/protocols/instance-replication-v1.md` 存在于 worktree，作为 ADR-0010 委托的唯一 wire contract 供 SA1 使用。

# 冲突门禁报告

- **被审对象**：任务简报 `wiki/raw/task_phase-5-websocket-replication-contracts.md`（Issue #172，前置门禁；Run ID `issue-172-1788016848-4073122`，Round 1）
- **冲突基准**：`docs/adr/` 全部 10 份 ADR（逐个全读，无抽样）+ 根 `CONTEXT.md`。代码、`docs/protocols/`、`docs/phases/`、wiki 其他文档与任务简报中引用的 issue/PR 编号不构成自动阻塞依据。
- **配套产出**：`wiki/raw/task_phase-5-websocket-replication-contracts_relevant_decisions.md`（全链 SA 复用的约束清单）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（2026-08-19 修订节） | 无关（schema 真相源域） | no-conflict |
| 0002 | nomicore 是全新 yjs-server 重写，authority 出范围 | accepted | 无关（仓库定位域） | no-conflict |
| 0003 | 求值器与派生 schema | accepted | 无关（Phase 0b 域） | no-conflict |
| 0004 | vfsl-protocol 类型协议包 | accepted | 无关（Phase 1 投影域） | no-conflict |
| 0005 | 投影生成管线 | accepted | 无关（Phase 1 生成域） | no-conflict |
| 0006 | Cordis 持久化插件 | accepted（含 #64/#79/#131/#133 修订节） | 相关（resetReplica 边界陈述涉及的 importDoc/archiveDoc/probe 条款） | no-conflict：任务只要求**陈述交付状态**，不修改任何 Persistence 契约 |
| 0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（open/read 条款由 ADR-0008 部分取代） | 无关（被取代条款不在触碰面内） | no-conflict |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 #93/#132/#134 修订节） | 边缘相关（复制管理写/会话冻结词汇） | no-conflict：任务简报未要求修改这些面 |
| 0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（含 #131/#134 修订节） | 边缘相关（openReplicationSession lease 面） | no-conflict：任务简报未要求修改这些面 |
| 0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（含 #134/#133/#161 修订节） | 高度相关（五项要求全部落在其管辖域） | no-conflict：任务是在**执行**而非违反 ADR-0010 的权威归属条款（详见下） |

无任何 ADR 处于整体 superseded 状态；ADR-0007 仅有 open/read 条款被 ADR-0008 取代，且与本任务无关。

## 冲突点

**0 条。** 裁决分布：no-conflict 10 / override-declared 0 / evolution 0 / hard-violation 0。

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | （无冲突点） |

### 逐项正面依据（任务要求 ⇄ ADR/CONTEXT 条款对照）

1. **要求 1（去权威化 `wiki/raw`）⇄ ADR-0010 L151 / #161 修订节**：「连接与namespace状态、消息码、payload字段、错误码、timeout、close code、backpressure和完整时序以`docs/protocols/instance-replication-v1.md`为唯一wire contract」「wire 契约以 …instance-replication-v1.md…为唯一权威」。任务把 source 中公共行为权威指向 `CONTEXT.md` / ADR / `docs/protocols/` 正是执行该让渡条款；**无任何 ADR 授予 `wiki/raw` 权威地位**，故移除相关表述无条款可违。同向，no-conflict。
2. **要求 2（五组契约收敛）⇄ ADR-0010 L145–L151 + #161 修订节**：control/ACK 保留额度（含 `maxQueuedControlBytes` 缺省 8MiB）、背压 checkpoint（`max(1, floor(ackTimeoutMs/100))`）、liveness 缺省 30s/10s 与 `pongTimeout < pingInterval`、peer pong 超时 `close(1001)`、背压 `1011` 终止、sequence `gap/repeat/错误ACK关联关闭连接`（CLOSE_OK 关联违规的 ADR 侧锚点）、GOAWAY 相对 drain timeout 与静默订阅先于异步 drain——收敛目标值均有 ADR-0010 锚点；任务未提出任何与之相悖的新值或新语义。同向，no-conflict。
3. **要求 3（未交付边界：`resetReplica` / #163 结构化观测 / #164 apps/yjs-server+真实 WS adapter）⇄ ADR-0010 L167、L171–175、L57+#133 修订节、ADR-0006 #133 修订节**：ADR-0010 把结构化 observer seam、`apps/yjs-server` composition root、resetReplica 定义为**目标交付物/已定设计**；任务陈述其**当前未交付**是交付状态报告（current contract vs known gap 的区分），不构成对目标契约的修订或推翻。同向，no-conflict。
4. **要求 4（修正红阶段测试叙事与空断言）**：无任何 ADR 条款管辖测试叙事内容；ADR-0010 #161 修订节的「实现证据」仅指认 `packages/ws-replication/src/*`。基准外事项，no-conflict。
5. **要求 5（不得发明未实现行为；区分 current contract / known gap / planned #169–#171）⇄ ADR-0010 非目标节及各 ADR 诚实纪律**（如 dirty-not-durable、`diskCaughtUp:false` 结构性永不声称 durable）：完全同向，no-conflict。

## 结论

**Verdict = clear，0 冲突点，放行。** 任务简报不需要任何 override，也没有需要 Jim 裁决的演进条目。

### 门禁提示（非裁决，供 SA1/总控在执行与设计后复审时参考）

1. **收敛的权威归属**：wire 细节（消息码/payload/timeout/close code/backpressure/时序）以 `docs/protocols/instance-replication-v1.md` 为唯一权威（ADR-0010 明文让渡）；ADR-0010 是决策记录；CONTEXT.md 管术语。若收敛中发现 code/文档与 ADR-0010 #161 修订节冻结值（30s/10s、`pongTimeout<pingInterval`、8MiB、checkpoint 公式、`close(1001)`、1011）不一致，方向应是向权威文档+冻结值对齐，**不得**以代码现状改写冻结值；改冻结值本身即构成 ADR 演进（evolution），须回 SA8 复审并上报 Jim。
2. **「一份权威文档」不得回到 `wiki/raw`**：任何把权威指回 `wiki/raw` 的收敛结果与任务 AC1 及 ADR-0010 L151 相悖，将自动落入 hard-violation。
3. **resetReplica 边界陈述的依据文本**：以 ADR-0010 issue #133 round-2 修订节为准（其替换了正文 L57 的执行次序描述），并同步对照 ADR-0006 #133 修订节的 importDoc/archiveDoc/probe 条款；正文 L57 的旧次序描述不得作为现状依据引用。
4. **词汇纪律**：文档措辞须遵循 CONTEXT.md 词条及 _Avoid_ 列表（Hub/Peer、namespaceId、复制谱系/代际、ReplicationSession、replication-unvalidated、实例角色——尤其避免 master/slave/leader 等词与「durable 已达成」的表述）。

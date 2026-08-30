# 冲突门禁报告（Revision Round 2）

- 被审对象：`wiki/raw/task_phase5-ws-multiplex-backpressure-r2.md`（issue #137 round 2，任务类型：Bug 修复——质量复审修订轮；5 个协议一致性缺陷修复 R2-1~R2-4 + 测试覆盖缺口 R2-5）
- 冲突基准：ADR 全集 `docs/adr/0001`–`0010`（10 个，本轮重读 10/10，禁止抽样）+ `CONTEXT.md` + ADR 0010 L151 指定的唯一 wire contract `docs/protocols/instance-replication-v1.md`（具 ADR 级约束力）+ `docs/phases/phase-5-websocket-replication.md`（任务指定规格基准）
- 审查方式：**delta 裁决**——round 1 前置门禁（verdict `clear`，见 `task_phase5-ws-multiplex-backpressure_conflict_report.md`）已对同任务全量 AC/范围做逐条对照；本轮重读 ADR 全集与 CONTEXT.md 后，只对 r2 简报新增的 R2-1~R2-5 修复要求与验收标准做增量对照。round 1 结论未被任何新事实推翻。
- 审查轮次：run_id issue-137-1787922674-8367, round 2

## Verdict

`clear`

## ADR 盘点（delta）

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19/08-21 修订节） | 否 | r2 不新建 schema/投影/脚手架；与 round 1 结论一致。无冲突 |
| 0002 | nomicore 是全新重写，authority 出范围 | accepted | 否 | 未触及。无冲突 |
| 0003 | 求值器与派生 schema | accepted | 否 | 未触及。无冲突 |
| 0004 | vfsl-protocol 类型投影 | accepted | 否 | 未触及。无冲突 |
| 0005 | 投影生成管线 | accepted | 否 | 未触及。无冲突 |
| 0006 | Cordis 持久化插件 | accepted（含 #64/#79/#133 修订节、#131 对齐说明） | 否（弱） | r2 不改 Persistence；修复域在 ws-replication 包。无冲突 |
| 0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（Runtime/open/read 条款由 0008 部分取代） | 否（弱） | 与 round 1 同：背压丢弃只影响未发送 wire 增量；被取代条款不构成约束。无冲突 |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 #93、#132 修订节） | 否（弱） | R2 修复不进入 Runtime sequencer、不触碰 Runtime status（#132 边界维持）；「网络背压不得进入 Runtime sequencer」（L151 同款纪律）在 R2-3/R2-5 的队列记账与对抗测试中继续保持。无冲突 |
| 0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（含 #131、#134 修订节） | 否（弱） | R2-5「fake scheduler」与 L83「确定性测试使用 manual Clock 状态与 fake timer协调推进」生态纪律一致。无冲突 |
| 0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（含 #134 round-2、#133 round-2 修订节） | 是（权威 ADR） | R2-1~R2-5 逐条溯源见下；全部是把 round 1 实现拉回协议一致性的修复，不是新决策；#134 round-2 两级队列属主边界未被触碰；L177 transport 抽象纪律未被触碰。无冲突 |

规格基准对照（delta）：

| 文档 | 对照结论 |
|---|---|
| docs/protocols/instance-replication-v1.md | R2-1 = §10.1 L259/261 + §17 L488 + §13.2 `UPDATE_TOO_LARGE`；R2-2 = §1 不变量 2 + §3 L54 + §14 L391；R2-3 = §17 L479–488 分列限制 + §10.2 L279；R2-4 = §17 L490/L492 + §13.1 `CONNECTION_BACKPRESSURE`；R2-5 = §15.1 L431 测试 seam + §17 L492。逐条吻合：r2 简报的全部修复方向均为协议既有条款的**执行面收口**，无任何条款被要求突破。无冲突 |
| docs/phases/phase-5-websocket-replication.md | R2-4 对照 L110（control 保留额度）；R2-5 对照 L180/L193/L195/L221（测试 seam、故障注入、上限确定性失败测试）。无冲突 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| （无） | — | — | — | — | 未发现任何直接违反 ADR/CONTEXT/规格基准的要求；无未声明推翻（无 override 需求）、无未走正式 supersede 的实质演进 |

### R2 逐条溯源（佐证上表「无冲突」结论）

| 被审对象条目 | 基准条款（溯源） | 裁决 |
|---|---|---|
| R2-1 超大 UPDATE 不得静默丢失：出队前校验合并结果 / 发送失败进 resync / 单笔超限按 `UPDATE_TOO_LARGE` 收口 | §10.1 L259「update……最大 `maxUpdateBytes`」+ L261「尚未分配 sequence、尚未发送的 updates允许 `Y.mergeUpdates()` 合并」+ §17 L488「未发送队列任一上限超出：丢弃全部未发送增量，标记 needs-resync」+ §13.2 L371 `UPDATE_TOO_LARGE \| yes \| config \| failed`（既有注册码）+ §1 不变量 9 L29（丢弃由 state-vector reconciliation 修复） | no-conflict：三条建议路径全部是协议既有条款的实施；`UPDATE_TOO_LARGE` 非新造码 |
| R2-2 sequence 耗尽不得发重复序列号 ERROR，按 §14 直接关闭连接 | §1 不变量 2 L22 + §3 L54「正常 frame 从 `1` 严格递增」+ §14 L391「如果 framing仍可信，关闭前 best-effort发送 connection ERROR；否则直接 close」+ ADR 0010 L147「每方向sequence从1严格递增，不回绕；gap、repeat或错误ACK关联关闭连接」 | no-conflict：sequence 耗尽 ⇒ framing 不可信 ⇒ 「否则直接 close」字面路径 |
| R2-3 queued count/bytes 与 in-flight window 记账分离 | §17 L479–486 分列 `maxQueuedUpdateBytes`/`maxQueuedUpdateCount` 与 `maxInFlightUpdates` + L488 溢出判据只挂「未发送队列」+ §10.2 L279「窗口满只暂停该 namespace发送」 | no-conflict：分离记账是协议分列限制的直接推论 |
| R2-4 control reserve 独立配置，不再复用 lowWater | §17 L490「Control frame有独立保留额度，耗尽为 `CONNECTION_BACKPRESSURE`」+ L492「降至 low-water恢复」（low-water 语义仅此）+ ADR 0010 L165「以下上限均为插件配置并提供安全默认值」+ phase-5 L110 | no-conflict：独立额度本就是协议要求；round 1 设计 D3 以 lowWater 充当额度才是偏离，本轮修复是回归一致 |
| R2-5 对抗流量 no-starvation / bounded-memory 测试（fake scheduler） | phase-5 L193/L195/L221 + 协议 §15.1 L431「Scheduler和random必须注入测试 seam」+ §17 L492 + ADR 0009 L83 fake timer 纪律 | no-conflict：测试形态与任务指定测试 seam 一致 |
| 验收标准：红灯先行测试、AC1–AC7 零回归、测试/tsc/diff--check 全绿、最小修复、patch bump、禁 push/PR/label | 过程性要求，非 ADR 约束域；「修复保持最小且与 instance-replication-v1.md 一致」与 L151 唯一 wire contract 条款同向 | no-conflict |

## 结论

**Verdict: `clear` —— 放行。**

- 冲突点数：0；裁决分布：no-conflict 10/10（ADR 层面），override-declared 0，evolution 0，hard-violation 0。无需 override、无需 Jim 裁决条目、无需停止运行。
- r2 简报不是新决策提案：R2-1~R2-5 是质量复审对 round 1 实现提出的**协议一致性缺陷清单**，每条的修复方向都能溯源到协议 v1 / phase-5 / ADR 0010 的既有条款（溯源表见上）；本轮不存在对任何已接受决策的推翻或演进意图。
- 三条非冲突注记（供总控/SA1/SA2 参考，不构成门禁约束）：
  1. **R2-4 的 ALLOW 变更登记义务**：round 1 设计 DENY LIST 曾声明 `types.ts`/`defaults.ts` 零改动（D10），R2-4 明确要求改配置面。设计文档不是冲突基准，故不构成冲突；但简报已明文要求设计修订登记此 ALLOW 变更——SA1 修订设计时必须显式推翻 D3（control 额度 = lowWater）并放开 D10 的对应子项，新配置须遵守 §17 L494–506 纪律（安全默认值、启动响亮验证、不得运行时 clamp）。
  2. **R2-1 收口路径选择留有协议内自由度**：三条建议（出队前校验 / 发送失败进 resync / UPDATE_TOO_LARGE）均协议合法，选择属 SA1 设计域；唯需注意若选 `UPDATE_TOO_LARGE`，其注册行终态为 `failed`，依 §1 不变量 4 与 §16，failed 后同连接不得重开该 namespace——设计须如实收口，不得既发 UPDATE_TOO_LARGE 又在同连接静默重开。
  3. **两级队列属主红线在本轮依旧最高承重**：R2-1/R2-3 的队列记账与溢出修复全部位于 WS 发送队列/连接级背压域（ADR 0010 L151 域），不得反向触碰 #134 已交付的 fanout 投递队列（session 域、容量 16 冻结、溢出弃新保旧、sticky needsResync）；两套溢出语义不得互相代管。
- 相关决议清单（全链复用）：`wiki/raw/task_phase5-ws-multiplex-backpressure-r2_relevant_decisions.md`（delta）+ `wiki/raw/task_phase5-ws-multiplex-backpressure_relevant_decisions.md`（round 1 全量基准）

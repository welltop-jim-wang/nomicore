# 冲突门禁报告（设计后复审）

- 被审对象：`wiki/raw/task_issue-174-goaway-drain_design.md`（SA1 防弹架构设计 R1 初版）
- 冲突基准：`docs/adr/` 全部 10 份 ADR（逐个全读，无抽样）+ `CONTEXT.md`
- 门禁时机：设计后复审（SA1 设计产出后；全维度攻击评审属 SA2，本报告只裁「设计 vs ADR/CONTEXT」冲突，不判设计优劣）
- 姊妹档案：`wiki/raw/task_issue-174-goaway-drain_relevant_decisions.md`（本次已追加「设计后复审追加」节，登记设计引入的新决策点）
- 前置门禁：`wiki/raw/task_issue-174-goaway-drain_conflict_report.md`（verdict `clear`，本复审不重复其全量盘点）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论（设计后复审口径） |
|---|---|---|---|---|
| 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19/08-21 修订节） | 否 | 设计不触及 schema/VFSL/信封域；无冲突 |
| 0002 | nomicore 是全新重写，authority 出范围 | accepted | 否 | 设计不触及 authority/旧系统域；无冲突 |
| 0003 | 求值器与派生 schema | accepted | 否 | 设计不触及求值器/ROOT/联合表示域；无冲突 |
| 0004 | vfsl-protocol 类型投影 | accepted | 否 | 设计不触及类型投影域；无冲突 |
| 0005 | 投影生成管线 | accepted | 否 | 设计不触及 SchemaSource/codegen 域；无冲突 |
| 0006 | Cordis 持久化插件 DocPersistence | accepted（含 #64/#79/#131/#133 修订节） | 否 | 设计零改 Persistence（DENY LIST 明示）；其 dispose 仅是 ADR-0010 L179 停止链一环；无冲突 |
| 0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（Runtime/open/read 条款由 0008 取代；被取代部分不构成约束） | 否 | 设计不触及校验/物化域；无冲突 |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 #93/#132 修订节） | 是 | 设计 §5 两等待域边界逐字对齐 L93「此前已接纳任务无条件排空，不取消、不设内部 timeout」：apply 槽排空走既有 `cleanupAll → onConnectionClosed → drainPendingApplies`（无 deadline、不取消，既有代码零改动）；`drainDeadline` 只罩网络侧（与 L93 无交叠）；无冲突 |
| 0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（含 #131/#134 修订节） | 是 | 设计零改 Registry/Lease（DENY LIST 明示）；#134「release 不追踪/取消已接纳 apply 槽（照常排空）」经既有 closeSessionAndRelease 链保持；Host 停机门闩（`hub.close()` Promise）结算时点后移正是 L99/L179 停止顺序的正确实施；无冲突 |
| 0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（含 #134/#133/#161 修订节） | 是（核心） | 逐条对齐：L147「GOAWAY提供相对drain timeout」→ 真实 drain 窗口（本地消费 drainMs）；L143「关闭后重开必须重建连接」→ 窗口内 OPEN 显式拒绝复用 `NAMESPACE_REOPEN_REQUIRES_RECONNECT`（零新 wire 码）；L147/L149 序列与 ACK 语义 → D5/D9 违例处置不悬置；L151 wire 契约授权 → 零 wire 格式变化、零新错误码、恢复纪律（断开即 close sessions/release leases、不保留 outbox）经 cleanupAll 保持；L165「framing 等连接级错误才关闭整条连接」→ GOAWAY 发送失败 catch 即 finishDrain 收口、背压终态 1011 语义不因 drain 悬置；L90「channel 关闭先关闭 session，再释放 Lease」→ §3 收口链原序保持；L179 停止顺序 → 停接纳（accept 门 + GOAWAY + OPEN 拒绝 + 不开新 round）→ channels 自然收口/终局强制 quiesce → apply 槽照常排空（不设网络侧之外的 timeout）→ lease 释放，顺序逐环对齐；#161 L303「GOAWAY/blocked/连接收口同步静默订阅先于异步 drain」→ 触发点从「GOAWAY 即 close」移至窗口终结 `finishDrain → close() → cleanupAll`，但「同步摘监听先于异步 apply 排空」的顺序本身不变；无冲突 |

## 冲突点

无。逐条裁决分布：no-conflict × 10（ADR-0001..0010 全部）；override-declared × 0；evolution × 0；hard-violation × 0。

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | 无冲突点登记 |

## 结论

**clear：放行，SA2 攻击评审可继续。**

要点登记：

1. **设计是对 ADR-0010 冻结条文的实施收敛，不是偏离**：全部新决策（真实 drain 窗口、deadline 收口、提前完成观测、OPEN 显式拒绝、Step1 丢弃、settle 结算闸）都落在 L147/L143/L90/L179 及 #161 修订节已裁决语义的实施域内；修复方向与前置门禁结论一致。
2. **两等待域边界正确兑现**（前置报告要点 2 的落地）：网络 ACK/transport 存续由 `drainDeadline` 硬顶（ADR-0010 L179「不无限等待网络 ACK」）；Runtime 已接纳 apply 槽无 deadline、不取消（ADR-0008 L93；设计 §5 明示两域「不混同、不互相豁免」）。CONTEXT「停接纳」词条 _Avoid_「把停接纳误解为取消已接纳任务」未被触犯——设计在连接层停接纳的同时保留已接纳面照常排空。
3. **零协议演进、零 override**：零新 wire 码（OPEN 拒绝复用既有 `NAMESPACE_REOPEN_REQUIRES_RECONNECT`，语义同构 L143）、零 wire 格式变化、零新配置 knob（drainMs 复用 closeTimeoutMs 既有同源）、公共 API 签名零变化、DENY LIST 排除 `docs/protocols/instance-replication-v1.md` 与 `docs/adr/**`——不触发 evolution/override 裁决路径。
4. **顺序约束全部保持**：ADR-0010 L90「先关 session 再释放 Lease」、L179 六步停止顺序、L151 恢复纪律（断开即 close sessions/release leases、不留 outbox）、#161 L303「同步静默订阅先于异步 drain」——设计 §3/§4.6 的收口链逐条对齐（#161 的触发点后移到窗口终结，顺序本身不变，已录入相关决议档案追加节）。
5. **设计自申报的 AC-6 × R1 冲突（§6.2）不构成 SA8 冲突基准内事项**：该冲突是既有测试锚与新测试契约之间的基线时代差，属代码/测试域——按 SA8 技能规则，代码与 wiki 其他文档不构成自动阻塞依据，ADR/CONTEXT 中无任何条款冻结 `hub.close()` Promise 的测试观测时序（L179 反而要求停止阶段涵盖 drain 等待）。设计已按其流程上报总控/SA6 裁决（含五步证明与 1 行最小适配方案），SA8 登记在此、不越权裁决。
6. **无需 override、无 evolution 条目需 Jim 裁决。**

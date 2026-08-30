# 冲突门禁报告

- 被审对象：`wiki/raw/task_issue-174-goaway-drain.md`（任务简报，前置门禁）
- 冲突基准：`docs/adr/` 全部 10 份 ADR（逐个全读，无抽样）+ `CONTEXT.md`
- 门禁时机：前置门禁（任何 SA 派发之前）
- 姊妹档案：`wiki/raw/task_issue-174-goaway-drain_relevant_decisions.md`（约束清单，全链 SA 复用）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19/08-21 修订节） | 否 | 任务不触及 schema/VFSL/信封域；无冲突 |
| 0002 | nomicore 是全新 yjs-server 重写，authority 出范围 | accepted | 否 | 任务不触及 authority/旧系统域；无冲突 |
| 0003 | 求值器与派生 schema | accepted | 否 | 任务不触及求值器/ROOT/联合表示域；无冲突 |
| 0004 | vfsl-protocol 类型投影 | accepted | 否 | 任务不触及类型投影域；无冲突 |
| 0005 | 投影生成管线 | accepted | 否 | 任务不触及 SchemaSource/codegen 域；无冲突 |
| 0006 | Cordis 持久化插件 DocPersistence | accepted（含 #64/#79/#131/#133 修订节） | 否 | 任务不改 Persistence；其 dispose 仅是 ADR-0010 L179 停止链一环，无冲突 |
| 0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（Runtime/open/read 条款由 0008 部分取代；被取代部分不构成约束） | 否 | 任务不触及校验/物化域；无冲突 |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 #93/#132 修订节） | 是 | AC3「已接纳 apply 排空」对齐 L93「此前已接纳任务无条件排空，不取消、不设内部 timeout」；AC4 的等待域是网络 ACK（由 ADR-0010 L179 界定），非 Runtime apply 槽；无冲突 |
| 0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（含 #131/#134 修订节） | 是 | AC6 顺序要求对齐 L99 shutdown 次序与 #134「release 不追踪/取消已接纳 apply 槽」；无冲突 |
| 0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（含 #134/#133/#161 修订节） | 是（核心） | 任务即本 ADR 停止时序条文的实施 bug 修复：GOAWAY 相对 drain timeout（L147）、ACK 语义（L149）、wire 契约授权（L151）、停止顺序（L179）、session/lease/channel 顺序（L90）、#161「同步静默订阅先于异步 drain」逐条对齐；无冲突 |

## 冲突点

无。逐条裁决分布：no-conflict × 10（ADR-0001..0010 全部）；override-declared × 0；evolution × 0；hard-violation × 0。

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | 无冲突点登记 |

## 结论

**clear：放行，SA 派发可继续。**

要点登记：

1. 任务 8 条验收标准全部落在 ADR-0010 已冻结决策的实施域内：AC1/AC5/AC6 ← ADR-0010 L179 停止顺序与 L90「channel 关闭先关闭 session，再释放 Lease」；AC2 ← L147「GOAWAY提供相对drain timeout」；AC3 ← ADR-0008 L93「已接纳任务无条件排空」+ ADR-0010 L179「等待已被 Runtime 接纳的 apply 槽完成」；AC4 ← L179「但不无限等待网络 ACK」+ L149 UPDATE_ACK 仅表 sequenced apply + dirty；AC7/AC8 为测试与 CI 要求，无 ADR 面涉及。修复方向（把「立即 close(1001)」改为真实 drain 窗口）是向 ADR 收敛，不是偏离。
2. 两个等待域不得混同（供 SA1/SA3 注意，非冲突）：Runtime close barrier 对已接纳 apply 槽「不取消、不设内部 timeout」（ADR-0008 L93）；「不无限等待」约束的是网络 ACK 侧（ADR-0010 L179）。drain deadline 只能罩网络侧等待，不能给 Runtime apply 槽排空加取消/超时。
3. wire 契约 `docs/protocols/instance-replication-v1.md` 经 ADR-0010 L151 授权为唯一 wire contract；按 SA8 技能基准规则，该文档本身不构成独立冲突基准，但任务对其一致性要求经 ADR-0010 的授权条款传导为 ADR 约束。事实核对（非裁决依据）：该文档 §6.3 L146–149（GOAWAY/drainTimeoutMs/停止 OPEN 与新 sync round/WS 1001）、L387（close code 1001）、L567（replication 停止接纳并发送 GOAWAY）与任务简报转述一致，简报无失实。
4. #161 round-2 修订「GOAWAY/blocked/连接收口同步静默订阅先于异步 drain」（ADR-0010 L303）是本任务实现真实异步 drain 时必须保持的既有顺序约束，已录入相关决议档案。
5. 无需 override、无 evolution 条目需 Jim 裁决。

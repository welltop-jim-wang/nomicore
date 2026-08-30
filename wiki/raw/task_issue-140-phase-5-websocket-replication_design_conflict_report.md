# 冲突门禁报告（设计后复审）— Issue #140 Phase 5 收口

## 任务标识

- 任务：Issue #140 — Phase 5: verify three-instance convergence and close integration（功能开发，切片 10 收口）
- 被审对象：SA1 设计 `wiki/raw/task_issue-140-phase-5-websocket-replication_design.md`（§0–§10 全文 426 行，Round 1，基线 HEAD `469ca36`）
- 简报：`wiki/raw/task_issue-140-phase-5-websocket-replication.md`（八条 AC + Phase 1 SA6 红灯记录）
- Worktree：`/home/wangjian/nomicore-fix-issue-140`（branch `fix/issue-140-on-docs-phase-5-websocket-replication`）
- 阶段：设计后 ADR/CONTEXT 一致性复审（SA2 全维度攻击评审前的前置一致性门禁）
- 裁决人：SA8 Conflict Gatekeeper
- 前置基线：前置门禁报告 `wiki/raw/task_issue-140-phase-5-websocket-replication_conflict_report.md`（Verdict: clear）——本次不重复全量盘点，聚焦设计新引入决策点
- 配套产出：相关决议文档已追加「设计后复审追加」节（`wiki/raw/task_issue-140-phase-5-websocket-replication_relevant_decisions.md`）

## 检查范围

- 冲突基准：`docs/adr/` 全集 **10 个 ADR（0001–0010），逐篇全读，无抽样** + 根目录 `CONTEXT.md` 全读（本工作树本轮全量复核）。
- 辅助核验（不构成独立基准）：`docs/phases/phase-5-websocket-replication.md`「交付现状与边界 / 未交付边界」节——已实读，确认 AD-1 声称改写的「peer 侧 resetReplica 编排……ws-replication 层未暴露 peer reset 面」行真实存在（该文档按 ADR 0010 #172 修订节第 3 条是交付边界的唯一维护处，本身非冲突基准）。
- 被 superseded 的条款不计入约束（ADR 0007 open/read 编排与 schema-aware read，被 ADR 0008 取代；ADR 0010 正文 resetReplica 旧次序描述，被 #133 round-2 修订节明文替换）。
- 代码与 wiki 其他文档不作为阻塞依据——按技能边界，只有 ADR/CONTEXT 收录的才是约束。设计引用的源码行号（`registry.ts` / `peer-connection.ts` 等）属实实现证据，其准确性归 SA2/SA4 复核，不属本门禁裁决域。

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（2026-08-19/21 修订节） | 低 | 无冲突。`replace-schema` 动词以信封 `{lang,version,id,text}` 四键传递（CONTEXT「信封」词条、ADR 0001 命名修订），编译语义单源归 runtime SCHEMA 写槽——「schema 的创建与升级只能通过运行时管理操作完成」条款的兑现；app 层只做形状门禁不做语义校验；无 schema 文本入仓 |
| ADR 0002 | nomicore 全新重写，authority 出范围 | accepted | 低 | 无冲突。设计零涉及 authority 规则 |
| ADR 0003 | 求值器与派生 schema | accepted | 低 | 无冲突。设计不触及求值/ROOT 约定/联合表示；G2 形状门禁的 `version` 安全整数检查与信封四键纪律同向 |
| ADR 0004 | vfsl-protocol 类型投影 | accepted | 低 | 无冲突。设计不触及投影面；AC8 验收义务不变 |
| ADR 0005 | 投影生成管线 | accepted | 低 | 无冲突。File Scope 不含 domains/生成物；regen-diff 义务不受影响 |
| ADR 0006 | 持久化 DocPersistence 与 docstore | accepted（+#64/#79/#131/#133 round-2） | 中 | 无冲突。归档/导入/只读 probe 全部经 registry→persistence 既有 seam（§5 明示「WS 层不直接读写 snapshot 文件的纪律保持：app 层零 persistence 触达」）；`packages/persistence/**` 在 DENY LIST；replace-schema 回执不承诺 flush 与「saveDoc 返回仅表示脏状态已登记」口径一致 |
| ADR 0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（open/read 条款被 ADR 0008 取代） | 低 | 无冲突。被取代条款不构成约束；残余有效条款（validated mutation/零写入）不被触碰——replace-schema 走 `replaceSchema` 写槽的完整校验管线，非 raw 通道 |
| ADR 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（+#93/#132/#134 增补） | 中 | 无冲突。`replaceSchema`/`bumpReplicationEpoch` 是 #132 修订第 4 条登记的四 sequencer 方法之二，app 只是新 caller（§10 caller 审计：零被改动方）；「四者均进入同一严格 FIFO write sequencer」不被绕过；degraded/fatal 折叠 `write-failed` 是 app 回执层映射，Runtime 结果联合不改形 |
| ADR 0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（+#131/#134 修订节） | 中 | 无冲突。hub 动词 lease 即取即释（open → op → release）；`registry.resetReplica` 是 ADR 0010 L222「Registry 仍负责……reset/archive 编排」的既有公开 API 的新 caller；停机竞态行依赖的 `REGISTRY_NOT_ACCEPTING`/幂等 shutdown 均为既有条款；released/shutdown 通道零改形 |
| ADR 0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（+#134/#133 round-2/#161/#172 修订节）——核心权威 | 极高 | 无冲突。三个动词全部是本 ADR 既有条款的黑盒到达面（逐条见下节）；wire 零新帧型（IDENTITY_CHANGED 既有）、epoch 传播走控制面不动 raw 回灌（#134 踩坑注记）、`packages/ws-replication/**` 在 DENY LIST、非目标清单零触碰（设计 §7「不做」显式排除级联/多 hub/自动晋升） |
| CONTEXT.md | 术语与硬性惯例 | 现行 | 高 | 无冲突。Hub/Peer/复制谱系/复制代际/实例角色词条逐条吻合（peer 不能本地修改 SCHEMA/复制身份 ⇔ G1 角色守卫；replicationId 32hex、epoch ≥1 安全整数 ⇔ G2 文法）；未使用任何 _Avoid_ 词汇（无 master/slave/leader/follower、无自动回滚表述）；「管理动词是 app 部署面词汇，非内核术语」与「实例角色」词条的 composition-root 语境一致 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | 无冲突项（hard-violation 0 / override-declared 0 / evolution 0） |

**裁决分布：no-conflict × 全部对照项（override-declared 0 / evolution 0 / hard-violation 0）。**

## 设计决策点逐条对照（佐证 verdict）

1. **AD-1 reset 编排归属 composition root，不进 `@nomicore/ws-replication` 公共 API** vs ADR 0010 L57/L175/L177 + L222：`resetReplica()` 是 Registry API（「Peer 冲突恢复使用带 `expectedLocalIdentity` 的 `resetReplica()`」；「Registry 仍负责本地 Runtime generation、Lease、reset/archive 编排和 Host 生命周期」）；apps/yjs-server 定位为「最小 Cordis composition root，装配……」（L175）；「在出现第二种 transport 前，不提前提取 transport-independent replication package。第三方 Host 可直接基于公开 NamespaceLease/ReplicationSession 构造自己的可信 transport」（L177）。ADR 从未要求 transport 层持有编排权；app 层组合 registry/peer 公开能力是条款预留的宿主姿势。phase-5 文档「未交付边界」行属 #172 修订第 3 条指定的交付登记处（已核实该行存在），改写为登记口径修正，非 ADR 契约变更。裁决 **no-conflict**。
2. **AD-2 冻结次序 reset 先行、mismatch 零通道动作** vs ADR 0010 #133 round-2 第 1 条：「任一不匹配/disabled → `NAMESPACE_RESET_IDENTITY_MISMATCH`，零破坏性动作，旧 generation/lease/runtime 保持可用」——设计「channel 全程不动，复制继续」为该条字面兑现；成功路径次序（fence 槽 → close admission → forceRelease → 归档）全部发生在 registry 既有编排内，app 只做后置 removeTarget/addTarget 收口，不重排任何 ADR 冻结次序。注意正文 L57 旧次序描述（「Registry 先关闭本地 Runtime generation，再通过 Persistence 归档旧副本」）已被 #133 round-2 明文替换，不构成约束。`removeTarget`「保留本地持久副本」（L35）不被违反——主键移除由 resetReplica 的归档完成，removeTarget 本身零删除。裁决 **no-conflict**。
3. **AD-3 稳定码策略（折叠 `write-failed` / 七码透传 / 新码 `reset-replica-failed` / append 8 码）** vs 无 ADR 冻结 app 控制面码表：`STABLE_OP_ERROR_CODES` 是 app 层注册表，非 ADR/CONTEXT 收录面；透传的七码（`NAMESPACE_RESET_IDENTITY_MISMATCH` 等）为 ADR 0010 #133 round-2 / ADR 0009 冻结词族的**原样使用**；app 只透传 `code` 不透传 `message` 与 ADR 0009「公开 issue/error message 不包含 owner/namespace 原值」纪律同向。裁决 **no-conflict**（附 note N2，见结论节）。
4. **D1 `replace-schema`（hub 专属）** vs ADR 0010 L118「SCHEMA 只允许 hub 的本地 `replaceSchema()` 修改；peer 本地调用以稳定角色权限错误拒绝」+ L119「Hub 的 SCHEMA update 正常向 peer 单向复制」：设计使 hub 的既有写槽黑盒可达，peer 侧 G1 直接 `unknown-op`（比 lease 层 `REPLICATION_ROLE_PERMISSION` 更早拒绝，收紧而非放宽）；传播链零新代码；`root?` 参数与 ADR 0008「`runtime.replaceSchema({ schema: proposedEnvelope, root?: completeLogicalRoot })`」签名一致，provided-root 原样封闭校验单源在 runtime（CONTEXT「原样封闭校验」词条）。裁决 **no-conflict**。
5. **D2 `bump-epoch`（hub 专属）** vs ADR 0010 L53「hub 提供 `bumpReplicationEpoch()`，它不替换 Y.Doc 内容，但使旧 epoch 的 peer 必须显式 reset/bootstrap」+ #134 round-2 R2-1（bump 槽 E5.5 主动 fence、bump 写零投递旧 session）+ #134 踩坑注记「META 触碰的管理写（enable/bump）字节不得经 raw 回灌对端……epoch 传播走控制面（切片 6 `IDENTITY_CHANGED`）」：设计只触发既有 fence 链，wire 效果仅控制帧，不触碰 raw 路径（§5 明示）；「身份与 epoch 相同才允许双向 reconciliation……绝不自动覆盖或合并」（L55）在 S2 场景闭环（conflicted → 显式 reset → bootstrap 继承新身份）。裁决 **no-conflict**。
6. **D3 `reset-replica`（peer 专属）与重引导** vs ADR 0010 L57 + #133 round-2 第 3 条（`importReplica` 绑定 Hub 广告身份）+ L34「`addTarget(target)` 幂等启动或恢复 namespace」+ L54「首次 bootstrap 继承 hub 的完整 META 身份」+ L143「同一连接内同一 namespace 只允许一个生命周期，关闭后重开必须重建连接」：重引导走既有 addTarget → §14.1 重建 → bootstrap → importReplica（detached apply + 广告身份核对 + 排他创建），全部为已收录条款的兑现；§4.5 整连接重建副作用是 L143 冻结行为的级联结果，设计显式登记并文档化而非新引入。裁决 **no-conflict**。
7. **G3 reset 无 known-set 门禁（显式 `ownerUserId`）** vs ADR 0010 L30「普通 open 仍显式接收 owner 并在复用 active entry 前核对；不匹配统一返回 `NAMESPACE_NOT_FOUND`」（owner mismatch 不泄露存在性）：owner 判定权回归 registry 零存在性泄露核对，与条款同构；known-set 门禁是 app 层 read/verify-write 的 owner 来源机制，非 ADR 义务。裁决 **no-conflict**。
8. **G1 角色守卫（错误角色 → `unknown-op`）与 CONTEXT「实例角色」词条**：「peer 实例的本地 replaceSchema/enableReplication/bumpReplicationEpoch 以稳定角色权限错误拒绝」——peer 上根本不挂 hub 动词（app 层更早拒绝），hub 上不挂 reset 动词；无运行期角色切换。词条满足且无 _Avoid_ 项。裁决 **no-conflict**。
9. **§3.5 新增 app 级事件 `replica-reset`** vs ADR 0010 L167「复制插件提供结构化 observer seam 给日志/metrics/trace Adapter，**不提供业务公共 update events**」：该条款约束复制插件（`packages/ws-replication`，DENY LIST 零改动）；`replica-reset` 是 composition root 自身编排的 app 级 NDJSON 输出（与既有 `target-added` 同族），包 observer 面零扩形，设计明示「不新增其他事件」。裁决 **no-conflict**（附 note N3）。
10. **§4.2 secret-free 纪律** vs ADR 0010 L159「Token、Yjs update、SCHEMA/ROOT 内容以及未经控制的 owner/namespace 不得出现在默认日志或高基数指标标签中」：事件/回执字段集 = namespaceId（受控标识）+ restarted（布尔）+ ok/code；`expectedReplicationId` 是 32hex 谱系标识（ADR 0010 允许受控日志的复制身份域）；不透传 registry message。控制通道 NDJSON 非默认日志/高基数指标标签域，且 namespaceId 上 wire/受控输出本就是 L143/L156 的既定用途。裁决 **no-conflict**。
11. **§6/§8 文档对齐与修改半径** vs ADR 0010 #172 修订节：第 2 条「`wiki/raw` 非规范：源码与规范中的公共行为表述必须指向 CONTEXT.md、ADR 或 docs/protocols/」——动词表/稳定码的规范落点在 `docs/integration/hub-peer-deployment.md`（docs/ 内规范文档，AC7 指定对齐对象），SA6 红灯报告仅作历史证据；第 3 条「当前切片状态与后续依赖仅由 `docs/phases/...`『交付现状与边界』节维护，ADR 不复制交付清单」——设计的 phase-5 文档改写正是该唯一维护处的登记更新，`docs/adr/**` 零改动。wire 契约（protocol v1）零变化，#172 第 1 条「wire 冻结值不变」满足。`packages/**` 全量 DENY、`main.ts`/`config.ts`/`index.ts` 零改动——公共导出面与配置面零变化。裁决 **no-conflict**。
12. **设计引用「不得照搬清单」自检** vs ADR 0010 L187「REST rebuild/hard reset 作为常规恢复」不得照搬：该条谴责的是**无身份守卫**的 REST 硬重置；设计的 `reset-replica` 是 L57/#133 round-2 明文规定的 guarded reset（expected 身份双源严格前置核对 + mismatch 零破坏 + 归档 seam），由运维显式驱动、mismatch 拒绝——正是该 ADR 条款所**要求**的恢复形态，非其禁止形态。裁决 **no-conflict**。

## 结论

- **Verdict = clear**：SA1 设计与 ADR 0001–0010 全集及 CONTEXT.md 无任何直接违反；冲突点 0；裁决分布 no-conflict × 12 项逐条对照（override-declared 0 / evolution 0 / hard-violation 0）。设计后复审放行，SA2 全维度攻击评审可继续。
- 设计性质与前置门禁判定一致：三个红灯共享的缺口是**已交付嵌入宿主能力的黑盒到达面缺失**；设计 = app 控制面薄接线 + 编排 + 文档对齐，不引入新引擎语义、不修订任何 ADR 冻结条款（设计 §5「无推翻」的自评经全量对照核实成立）。
- 信息充分性：ADR 全集与 CONTEXT.md 已全量重读；设计引用的 ADR 条款内容经原文比对准确（个别行号标注与现行文件有 ± 数行漂移，如「ADR 0010 L84 第三方 Host」实际为 L177、「L57 resetReplica」准确——内容均属实，不构成冲突；行号精确性留给 SA2/SA4 复核源码引用时一并校正）。

### 非阻塞注意事项（供 SA2/SA4/SA6/总控参考，不构成门禁拦截）

1. **N1（SA6 契约起点 vs wiki/raw 非规范）**：AD-3 以 SA6 红灯断言为「契约起点」采信动词命名与 `NAMESPACE_RESET_IDENTITY_MISMATCH` 透传——该七码本身是 ADR 冻结词族（合规）；app 自有码（`unknown-op`/`invalid-op-args`/`write-failed`/`reset-replica-failed`/`namespace-unknown`）的规范落点必须在 `docs/integration/hub-peer-deployment.md`（设计 §6.1 已列），SA4 验收时确认源码/规范中无以 `wiki/raw` 为权威的表述（#172 修订第 2 条）。
2. **N2（`reset-replica-failed` 的 committed 诚实边界）**：branded fatal（含 #133 round-2 第 5 条 `relocate-remove` committed:true 归档致命）被折叠为 app 码 `reset-replica-failed`——Registry 层按 ADR「以 `committed:true` 原样传播为 `NamespaceRegistryFatalError`」零改动（packages DENY），app 回执不冒充零破坏码、committed 事实经 registry observer 可观测，设计 §3.3 已注记。建议 SA2 复核部署文档对 `reset-replica-failed` 的措辞**不得**暗示「零破坏/可无脑重试」（重试语义 = 设计 §7 的 `add-target` 重引导路径，非 reset 重放）。
3. **N3（`replica-reset` 事件字段）**：NDJSON 控制通道输出 namespaceId 属受控标识、与既有事件同族；ADR 0010 L159 管辖的是默认日志与高基数指标标签——部署文档若将该事件转发进日志/指标管道，运维侧须维持受控处理（设计 §4.2 已按 safe-field 纪律登记，SA4 验收文档措辞时保持同口径）。
4. **N4（phase-5 文档交付行时效）**：`docs/phases/phase-5-websocket-replication.md` 切片 9 行仍标「未交付 | #164」，而基线 HEAD `469ca36` 注记为「deliver deployable Hub and Peer yjs-server app (#186)」——设计 §6.2 只登记切片 8/10 行；该行时效属交付登记完整性问题（#172 第 3 条的维护处自身滞后），非 ADR 冲突，SA3 执行文档对齐时建议一并核对是否需要补记。

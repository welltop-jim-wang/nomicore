# 冲突门禁报告

- 被审对象：`wiki/raw/task_phase5-ws-namespace-sync.md`（issue #136，任务类型：功能开发；Phase 5 切片 6：`@nomicore/ws-replication` namespace 状态机）
- 冲突基准：ADR 全集 `docs/adr/0001`–`0010`（10 个，全量逐个读取）+ `CONTEXT.md` + 任务指定的 Phase 5 规格基准（`docs/phases/phase-5-websocket-replication.md`、`docs/protocols/instance-replication-v1.md`——后者为 ADR 0010 指定的唯一 wire contract，具 ADR 级约束力）
- 审查日期：2026-08-30（run_id: issue-136-1787888033-8367, round 1）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19/08-21 修订节） | 否 | 任务不新建 schema/投影/脚手架；SCHEMA 只作为复制受保护字段被整体保护或放行，不解释其内容。无冲突 |
| 0002 | nomicore 是全新 yjs-server 重写，authority 出范围 | accepted | 否 | 任务不引入任何 authority 规则体系。无冲突 |
| 0003 | 求值器与派生 schema | accepted | 否 | 求值器/ROOT 别名约定不触及。无冲突 |
| 0004 | vfsl-protocol 类型投影 | accepted | 否 | 类型投影/编译期护栏不触及。无冲突 |
| 0005 | 投影生成管线 | accepted | 否 | 无 SchemaSource 消费、无生成物、无新 domain 包。无冲突 |
| 0006 | Cordis 持久化插件 | accepted（含 #64/#79 修订节、#131 对齐说明、#133 修订节） | 是 | AC3「imports it exclusively」= #133 修订节 `importDoc` 排他创建（duplicate 绝不覆盖）；bootstrap 导入身份核对责任在 Registry 编排、非 Persistence——任务经既有 Registry/Persistence 交付物复用，未越权让 WS 层触碰 snapshot 文件（ADR 0010 L57 明令）。无冲突 |
| 0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（Runtime/open/read 条款由 0008 部分取代） | 是 | 「raw Yjs update 必须另设受控验证通道」的预留已由 ADR 0010 裁决为 ReplicationSession；任务 AC5 恰要求「every remote update uses ReplicationSession sequencing and dirty notification」，与该通道一致；raw apply 不继承 zero-write 由 `replication-unvalidated` 词汇承接。被取代条款不构成约束。无冲突 |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 #93 稳定码注册、#132 复制事实投影修订节） | 是 | 远端 apply/管理写共享唯一 FIFO sequencer（含完整槽序与 notifyDirty）；AC5 措辞与之逐字对应；身份/epoch gate、`REPLICATION_ROLE_PERMISSION`、epoch fence（E5.5）均已冻结。无冲突 |
| 0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（含 #131 identity 迁移、#134 修订节） | 是 | transport 只经 Lease/ReplicationSession 取能力、不取裸 Y.Doc；release 同步停 session、已接纳 apply 槽照常排空；owner mismatch → `NAMESPACE_NOT_FOUND` 不泄露存在性。AC1/AC2/AC6 与之一致。无冲突 |
| 0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（含 #134 round-2、#133 round-2 修订节） | 是（权威 ADR） | 任务的全部验收条目逐条溯源见下。无冲突 |

Phase 5 规格基准对照：

| 文档 | 对照结论 |
|---|---|
| docs/phases/phase-5-websocket-replication.md | 任务自认切片 6；AC 逐条对应切片 6 条目、「协议与状态机验收」Namespace 状态图、「必须通过的场景」相关子集与「测试 seam」fake-duplex 要求。无冲突 |
| docs/protocols/instance-replication-v1.md | AC2（OPEN 拒绝矩阵 + 不泄露 owner）= §7.1/§13.2/§19；AC3（单 frame 有界快照 + 排他导入 + BOOTSTRAP_ACK + 强制双向 reconcile）= §8；AC4（双方向 Step2 + SYNC_APPLIED 才 live）= §9.3；AC5（UPDATE/UPDATE_ACK 语义 + sequencer/dirty）= §10 + 不变量 7/8；AC6（各事件到达规定状态、无 durable outbox）= §16 + §18 + ADR 0010 非目标；AC7 = §22/测试 seam。无冲突 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| （无） | — | — | — | — | 未发现任何直接违反 ADR/CONTEXT/规格基准的要求；亦无未声明推翻（无 override 需求）与未走正式 supersede 的实质演进 |

### 逐条溯源（佐证上表「无冲突」结论）

| 被审对象条目 | 基准条款（溯源） |
|---|---|
| What to build：authorization → open → bootstrap/reconcile → live → ack → resync → close 端到端 | ADR 0010「WebSocket 复制协议与状态机」节 L149「Namespace依次执行OPEN与身份检查、可选单frame bootstrap、双向state-vector reconciliation、live UPDATE」；协议 §7–§12 |
| AC1 target `{ namespaceId, localOwner }`、Hub 授权结果独立 owner + read/submit | ADR 0010 L32–37「Phase 5 首版 target 为精确 `{ namespaceId, localOwner }`」「authorization Adapter……返回 Hub local owner与 read/submit权限；Peer不得声明 Hub owner」；协议 §19 同形 |
| AC2 OPEN 选择 bootstrap/reconcile、五类拒绝、不泄露 owner | 协议 §7.1「Hub 必须先 authorization……未授权不得泄露 namespace 是否存在」+ §7.2 mode 规则 + §13.2 注册表（UNAUTHORIZED/NOT_FOUND/NOT_ENABLED → failed；ID/EPOCH_MISMATCH → conflicted）+ L380「Wire永不携带 owner」 |
| AC3 有界单快照、排他导入、确认安装、随后强制双向 reconcile | 协议 §8.1「完整 `Y.encodeStateAsUpdate`，不分块」+ maxBootstrapBytes/BOOTSTRAP_TOO_LARGE + §8.2「ACK 只表示本地导入和 Runtime/Session 建立完成。Peer 随后……发起双向 reconciliation」；ADR 0010 L61–67 五步；ADR 0006 #133 importDoc 排他创建 |
| AC4 双方向 Step2 apply + SYNC_APPLIED 才 live | 协议 §9.3「两位都为 true……才能进入 live」；ADR 0010 L149；Phase 总纲「两个方向的Step2都收到SYNC_APPLIED才进入live」 |
| AC5 UPDATE/UPDATE_ACK 语义 + 每个远端 update 走 ReplicationSession 序列与 dirty | 协议 §10 + 不变量 7/8；ADR 0010 L96–103 六步 + L149「UPDATE_ACK同样只表示sequenced live apply + dirty notification」 |
| AC6 RESYNC/ACK timeout/close/ERROR/identity change/socket loss/reconnect 各达规定状态、无 durable outbox | 协议 §16 状态机与 socket-loss 清理、§18「ACK timeout不重发同一 UPDATE，而进入 needs-resync」、§11 IDENTITY_CHANGED→conflicted、§13.2 终态列；ADR 0010 L151「连接断开即close sessions/release Leases，不保留outbox」+ 非目标「durable outbox」 |
| AC7 fake-duplex 确定性测试全覆盖 | Phase 总纲「测试 seam」：内存双端 transport/fake socket、不用真实时间等待、故障注入清单；协议 §22 conformance |
| Blocked by #133/#134/#135 全部 CLOSED 且实现已入本分支 | 与 ADR 0006 #133 修订节、ADR 0009 #134 修订节、ADR 0010 #134/#133 修订节登记的已接受状态一致 |

## 结论

**Verdict: `clear` —— 放行。**

- 冲突点数：0；裁决分布：no-conflict 10/10（ADR 层面），override-declared 0，evolution 0，hard-violation 0。无需 override、无需 Jim 裁决条目、无需停止运行。
- 任务简报不是新决策提案，而是 ADR 0010（含修订节）+ 协议 v1 + Phase 5 切片 6 的忠实实施切片；全部 AC 可逐条溯源到已接受条款（溯源表见上）。
- 两条非冲突范围注记（供总控/SA1 参考，不构成门禁约束）：
  1. **授权 Adapter 的消费与实现的边界**：OPEN 前置授权（协议 §7.1/§19）属切片 6 的 namespace 流程，但生产 bearer 认证与 Adapter 装配属切片 7/9；切片 6 应以注入 seam 消费 `authorizeNamespace`，不实现生产 Adapter——简报措辞（「the Hub authorization result supplies…」）与此一致，未越切片边界。
  2. **connection 状态机归属**：Phase 总纲切片 6 明列「实现connection、namespace与sync-round状态机及blocked/backoff/full-jitter恢复」，真实 WebSocket/认证接线（切片 7 的「Bearer token upgrade authentication」传输层）不在本任务验收面内；AC7 的 fake-duplex 测试基准与此一致。
- 相关决议清单（全链复用）：`wiki/raw/task_phase5-ws-namespace-sync_relevant_decisions.md`

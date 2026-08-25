# 冲突门禁报告

- 被审对象：`wiki/raw/task_namespace-runtime-integration-acceptance.md`（issue #93 任务简报，功能开发——集成验收与阶段收口）
- 冲突基准：`docs/adr/0001`–`0008` 全集（8/8 已逐个全文读取，无抽样）+ `CONTEXT.md`
- 门禁类型：前置门禁（任何 SA 派发之前）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 单一真相源（含 08-19 目标态/阶段态、08-21 `SCHEMA` 键名修订） | accepted | 中 | 集成测试以 fixture 提供真实 VFSL compiler 输入，属「测试 fixture 除外」明确许可；简报未引入仓内 schema 承重文本。no-conflict |
| 0002 | nomicore 重写定位、authority 出范围 | accepted | 低 | 简报不触碰 authority、不保留旧接口；写管线仍走「结构 → 值 → 单事务提交」。no-conflict |
| 0003 | 求值器与派生 schema（ROOT 约定 E310/E311） | accepted | 中 | 验收场景的 fixture 与 P0 编译失败用例受 ROOT map 形约定约束，简报无违反迹象。no-conflict |
| 0004 | vfsl-protocol 类型协议包（D1–D5） | accepted | 低 | 本任务不改类型投影面；仅现状盘点提及该包。no-conflict |
| 0005 | 投影生成管线（SchemaSource/生成器/CI 新鲜度） | accepted | 低 | 本任务不改生成管线与脚手架纪律。no-conflict |
| 0006 | Cordis 持久化插件（含 issue #64 createDoc/owner、#79 entry status/saveDoc 修订） | accepted | 高 | AC4 正是 #79 修订条款（degraded 不拒 saveDoc、拒绝面归 Runtime 写前 gate、检查后降级竞态、retry 覆盖最新完整 live Y.Doc、两 Adapter 平行验收）的落地验收。no-conflict |
| 0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted（Runtime/open/read 条款由 0008 部分取代） | 高 | 简报遵循 0008 模型（schema-independent read + P0），与已被取代的 open 前全量校验条款无对照义务；仍有效条款（compileSchemaEnvelope、validated mutation、零写入、observer no-rollback）与 AC5/AC6 一致。no-conflict |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted | 核心 | 简报全部 8 条 AC 逐条映射 0008 条款（见下「AC ↔ ADR 对照」），且验收方式条款（「以确定性状态机测试和真实 compiler/doc-runtime/Persistence 集成测试共同验收」）与本任务定义吻合。no-conflict |

## 冲突点

无。

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | 未发现直接违反；简报亦无任何「取代 ADR-NNNN」式 override 声明，无未走 supersede 的演进意图 |

裁决分布：no-conflict × 8；override-declared × 0；evolution × 0；hard-violation × 0。

## 结论

verdict = **clear**。任务简报与 ADR 0001–0008 + CONTEXT.md 无冲突：前置门禁放行，SA1 设计可派发。无需要 override 的条款、无需上报 Jim 裁决的演进条目。

附注两点（非冲突，供 SA1/SA2 注意）：

1. 简报「已知仓库卫生问题：`.mabf-done` 曾被误提交（commit bfcb999），本轮收尾 commit 需固化其删除」——纯仓库卫生事项，无 ADR/CONTEXT 条款涉及，不构成约束冲突。
2. AC7 要求 ADR 0007/0008、CONTEXT、package docs 与最终 API/错误词汇一致——这是文档对齐义务，若执行中发现 ADR 文本需要随终态 API 修订，属「ADR 演进」，须走正式 supersede/修订流程并另行裁决，不得在本任务内静默改写 ADR。

### AC ↔ ADR 对照（clear 佐证）

| 简报验收标准 | 对照 ADR 条款 | 结论 |
|---|---|---|
| AC1 真实 VFSL compiler + doc-runtime + Memory/File Persistence 端到端覆盖全能力 | ADR-0008「以确定性状态机测试和真实 compiler/doc-runtime/Persistence 集成测试共同验收」；ADR-0006 两真实 Adapter | 一致 |
| AC2 冷启动 P0 pending 时读取立即成功、早期写严格排在 P0 后 | ADR-0008「在对外发布前把 P0 放入 write sequencer 队首，同时立即开放同步读取；读取不等待 P0 或任何写任务，也不进入 sequencer」「发布后 read 立即可用，早期写排在 P0 后」 | 一致 |
| AC3 ROOT write、SCHEMA replacement、active schema 切换、dirty notification 顺序符合单 sequencer 契约 | ADR-0008 写槽次序（gate→快照→校验→transaction→`await notifyDirty()`）、SCHEMA write 五步、「transaction 返回后立即安装新 active tools，再 `await notifyDirty()`」 | 一致 |
| AC4 degraded/recovery、检查后降级竞态、最新 live Y.Doc 最终持久化、两 Adapter 验收 | ADR-0006 #79 修订（saveDoc 职责、gate 归属 Runtime、retry 覆盖最新完整 live Y.Doc、两 Adapter 平行验收套件）；ADR-0008「gate 是瞬时观察：检查后才发生的降级不撤销已提交事务」 | 一致 |
| AC5 committed/pre-commit fatal、best-effort dirty notification、fatal 后只读、close 全链 | ADR-0008 fatal 条款（`committed:false` 不调 dirty notifier；`committed:true` best-effort `notifyDirty()`；永久关闭全部写、保留读取；`RUNTIME_WRITE_DISABLED`；close 幂等 + 队尾 barrier + 单次 `handle.release()`） | 一致 |
| AC6 公共 exports 不暴露生产构造器、DocHandle/Y.Doc/writable Yjs reference、包内 detached/testing seam | ADR-0008「Runtime 不公开 handle、Y.Doc、ROOT/SCHEMA/META live 引用或生产构造器。生产工厂保留包内……测试通过包内确定性 seam 注入」；ADR-0007「业务调用方不得取得可写 Yjs 引用或绕过该入口」 | 一致 |
| AC7 ADR 0007/0008、CONTEXT、package docs 与最终 API/错误词汇一致 | 文档对齐义务；无条款冲突（见附注 2） | 一致 |
| AC8 全仓 typecheck/test、Node 20/24 CI 全绿 | 流程性要求，无 ADR 基准条款 | 不适用（无冲突） |

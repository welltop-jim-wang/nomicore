# 冲突门禁报告 — task_issue-79（Phase 0 前置门禁，设计前）

- 被审对象：`wiki/raw/task_issue-79.md`（issue #79，feature）
- 冲突基准：`docs/adr/` 全集 7 份（0001–0007，逐一全读，无抽样）+ 根目录 `CONTEXT.md`
- 裁决人：SA8 Conflict Gatekeeper

## Verdict

`conflict`

- 裁决分布：**hard-violation = 0，override = 0，evolution = 1（非阻塞，上报 Jim 裁决）**。
- 依四级裁决表，evolution「不自动停」——本 verdict **不触发停止协议**：总控放行进入 SA1 设计，同时将冲突点 #1 提请 Jim 裁决放行（处置先例见结论）。
- 判 `conflict` 而非 `clear` 的原因：冲突点表非空且含需 Jim 裁决的演进条目（报告格式约定「conflict 时……列出……哪些条目需 Jim 裁决」）；并与本仓先例一致——`task_persistence-create-doc` 门禁 verdict=conflict、0 hard-violation、2 条 evolution，总控未停机、由 owner 指令放行。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 文本是 schema 的唯一真相源，只存在于文档与测试中 | accepted（含 2026-08-19 修订节；无 superseded 标记） | 否 | 任务不触及 schema 文本、信封内容、方言与投影范围；无冲突 |
| 0002 | nomicore 是全新 yjs-server 重写，authority 完全出范围 | accepted（无显式状态字段、无 superseded 标记） | 否 | 任务不引入任何 authority/不变式规则；无冲突 |
| 0003 | 求值器与派生 schema | accepted | 否 | 任务不触及 evaluate / ROOT 约定 / 联合表示；无冲突 |
| 0004 | vfsl-protocol 类型投影 | accepted | 否 | 任务不触及类型协议与投影机制；无冲突 |
| 0005 | 投影生成管线 | accepted | 否 | 任务不触及 SchemaSource / 生成器 / CI 新鲜度；无冲突 |
| 0006 | Cordis 持久化插件——DocPersistence 接口与 doc 三条目内容布局 | accepted（含 createDoc/owner 修订节；无 superseded） | **是** | 实质条款全部一致（逐条对照见下表）；唯一演进项为 DocHandle 接口扩展 `getStatus()` 并补充本 ADR 职责条款（冲突点 #1，evolution） |
| 0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted | **是** | 「轮到 mutation 时先检查 writable gate……成功后立即调用 saveDoc 标脏」与本任务互为具体化，一致；「Persistence 仍只管理 Y.Doc 存储、cache、flush 与 retry」经边界判读一致（`getStatus()` 是 flush/retry 管理状态的只读暴露，不引入 schema 语义、不外置 flush 协调）；无冲突 |

无任何 ADR 处于 superseded-by-NNNN 状态，不存在需按「旧决策已作废」豁免的对照项。ADR 0006 内部两处早期条款（「创建 = 首个 saveDoc」、决策节旧接口代码块）已被其自身修订节明文取代，不构成约束；任务未依赖任何被取代条款（`owner` 术语、`createDoc` 均为现行契约面）。

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | 中（非阻塞） | ADR 0006 接口契约修订节：`interface DocHandle { readonly owner: User; readonly docId: string; readonly doc: Y.Doc; release(): Promise<void> }`（该修订节明示「取代本文上方接口代码块的 `DocHandle.user` 与二方法签名」，为当前冻结契约） | 「`DocHandle` 提供同步、entry 级 `getStatus()`；至少可区分 `ready`、`persistence-degraded`、`released`、`disposed`」＋「ADR 0006 补充职责：Runtime 负责 mutation 前 gate；`saveDoc` 是 mutation 后 dirty notification；写前状态检查不是持久化成功保证」 | **evolution**（不自动停，上报 Jim 裁决） | 新增成员改变 ADR 冻结的接口形状，且验收第 8 条要求修订 ADR 0006 决策记录本身（补充职责条款）；任务用「补充」而非「取代 ADR-0006」的 supersede 措辞，未走正式 supersede 声明——不满足 override-declared，又属有意扩展决策而非无意识违反，落 evolution。严重度取中：扩展为纯增量（不删不改既有成员，低于 issue #64 C2 全链改名的影响面），但触及冻结公共契约 + 决策记录双面。仓库先例：ADR 0006 的 createDoc 修订节明确标注「演进经 owner 裁决放行」——同类接口/契约演进应由 Jim 确认放行。任务验收第 8 条已包含该 ADR 修订项，演进将随任务以修订节体例落地 |

### 逐条一致性对照（no-conflict 依据，供复核）

| 被审对象要求 | ADR 条款（原文） | 结论 |
|---|---|---|
| `saveDoc(handle)` 不再因 entry 已 degraded 而拒绝，只登记 dirty | ADR 0006：「**saveDoc = 脏状态通知，不是同步落盘**……saveDoc 返回仅表示脏状态已登记」「失败事务保留在同一 live Y.Doc 中，由持久层内部 retry 持久化」 | 一致（ADR 文本从未规定 saveDoc 因 degraded 拒绝——降级拒绝面在「后续 REST/WS 写入」业务层；任务是对 ADR 原义的收窄回归，拒绝语义仅限 foreign/released 等身份失效） |
| Runtime 在 mutation 前读取状态，已 degraded 则拒绝开始新写入 | ADR 0006：「失败后 namespace 进入 `persistence-degraded`……拒绝**后续** REST/WS 写入」；ADR 0007：「轮到 mutation 时先检查 writable gate，同步调用 `applyValidatedMutation`，成功后立即调用 persistence `saveDoc` 标脏」 | 一致（两 ADR 条款的具体化；gate 检查后才转 degraded 的 mutation 不属「后续」写入，归保留事务 + retry 路径） |
| 状态查询对应具体 `(owner, docId)` entry，不以 Adapter 聚合状态代替 | ADR 0006：「**save 失败按 doc 只读降级**」；CONTEXT.md：「命名空间（namespace）：一个 Y.Doc 连同自带的 `SCHEMA` 信封与数据」 | 一致（降级粒度本就是 per-doc/entry，非 Adapter 级） |
| entry flush 失败后仅相关 handle 返回 `persistence-degraded`，无关 namespace handle 仍 `ready` | ADR 0006：「save 失败按 doc 只读降级」（按 doc，非全局/Adapter 级；「不关闭整个 server」） | 一致 |
| 该 entry 自身 retry 成功后恢复 `ready` | ADR 0006：「由持久层内部 retry 持久化，retry 成功后才恢复可写」 | 一致 |
| `saveDoc` 必须递增 dirty generation，retry 覆盖最新完整 live Y.Doc | ADR 0006：「**单飞 flush + generation 保序**：每次 saveDoc 递增 dirtyGeneration……」「以 `Y.encodeStateAsUpdate(doc)` 编码**完整 Y.Doc 状态**」 | 一致 |
| 确定性竞态测试（gen1 flush 开始 → 观察 ready → mutation 2 入 live Y.Doc → gen1 flush 失败 → degraded 下 saveDoc 成功登记 → retry 成功 → 新实例 load 可见 mutation 2） | ADR 0006：「flush 启动时捕获 generation，成功后仅将该 generation 标记为已持久；若 flush 期间有新 saveDoc（dirtyGeneration 更大），doc 保持 dirty 并安排下一轮 flush——旧 snapshot 不得将新状态误标为已保存」「retry 同属持久层内部，以退避策略重试直到成功或插件停止」 | 一致（该竞态序列恰是 generation 保序 + 内部 retry 条款的确定性重放） |
| foreign、released、entry 身份失配和 Persistence disposed 等非 degraded 错误继续响亮拒绝 | ADR 0006：「跨 Adapter/HMR reload 的 foreign handle、已释放 handle 的 saveDoc 都响亮拒绝」「dispose 时释放文件句柄、后台任务和 Y.Doc 缓存」 | 一致（明确维持既有拒绝面） |
| `getStatus()` 只表示调用瞬间状态，不承诺后续 flush 成功 | ADR 0006：「saveDoc……不构成该次写入已落盘的承诺」「**rename 成功即完成一次 flush**：v1 不对每次 flush 做 file/directory fsync，`saveDoc` 本身也不承诺掉电级持久性」 | 一致（同一「无落盘承诺」纪律向读侧状态查询延伸） |
| MemoryPersistence 与 FilePersistence contract tests、全量 test/typecheck、CI 通过 | ADR 0006：「create/load 同键协调与 flush 调度收敛为 adapter 共享的 persistence lifecycle core（MemoryPersistence 与 FilePersistence 共用，不得复制状态机）；两 Adapter 必须通过同一组 createDoc shared contract tests」 | 一致（约束：接口扩展不得破坏既有 shared contract tests，新状态契约须两 Adapter 同组覆盖） |
| Runtime gate 拒绝路径不触碰已提交内容 | CONTEXT.md：「零写入（zero-write）：校验失败 → 400 且文档不变；所有写入口走同一条管线」 | 一致（gate 拒绝发生在任何 Y.Doc 写入之前） |

## 结论

**Verdict: `conflict`——非阻塞，放行进入 SA1 设计。** 分布：hard-violation = 0（无停止原因）、override 需求 = 0、evolution = 1（上报 Jim 裁决）：

- 7 份 ADR 中 5 份（0001–0005）与本任务范围无关；ADR 0006 / ADR 0007 的全部实质条款——脏通知语义、按 doc 降级、内部 retry、generation 保序、lease 身份校验、Runtime writable gate 编排——与本任务要求一致或互为具体化。任务的「saveDoc 不得因 degraded 拒绝」反而是向 ADR 0006 原义（脏通知 + 失败事务由内部 retry 覆盖最新完整 Y.Doc）的收窄回归；当前实现若存在 Adapter 聚合状态拒绝行为属代码偏离，不构成 ADR 冲突基准（本门禁只裁 ADR/CONTEXT）。
- **上报 Jim 裁决（冲突点 #1，evolution）**：DocHandle 接口扩展 `getStatus()` 并补充 ADR 0006 职责条款。依四级裁决不自动停止运行；建议总控在派发 SA1 的同时并行提请 Jim 确认演进放行，落地面参照 ADR 0006 既有修订节体例（修订节 + owner 裁决标注，同 issue #64 先例「演进经 owner 裁决放行」）。任务验收第 8 条已包含该 ADR 修订项——若 Jim 放行，SA3 须以修订节体例将其落回 `docs/adr/0006-server-persistence-docstore.md`。
- 转交 SA1/SA2 的边界提醒（非裁决）：`ready` / `persistence-degraded` / `released` / `disposed` 状态词与 `getStatus()` 返回形状是新增契约面，应随 ADR 0006 修订节一并冻结措辞；设计中建议显式陈述「状态查询 = 持久层 flush/retry 管理状态的只读暴露」以钉住与 ADR 0007「Persistence 仍只管理 Y.Doc 存储、cache、flush 与 retry」的边界判读，且不引入任何外部 flush 协调器（ADR 0006「不设外部 flush/cron 协调器」）。

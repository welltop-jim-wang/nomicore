# SA8 冲突门禁报告 — issue #108 persistence：typed load/create 错误与 committed-aware create fatal

- 被审对象：`wiki/raw/task_persistence-typed-errors.md`（issue #108 任务简报，AC1–AC8）
- 冲突基准：`docs/adr/` 全集 0001–0009（全量逐份读取）+ `CONTEXT.md`
- 门禁类型：Phase 0 前置门禁（SA 派发前）
- 审查日期：2026-08-25 基线（branch `fix/issue-108-on-docs-namespace-registry`，HEAD = 279d3ba）

## Verdict

**`clear`** —— 无冲突，可进入 SA6 验收锚定。

一句话理由：AC1–AC8 是 ADR-0009 §Persistence 错误演进（L74–L81）的逐条落实，duplicate 条款与 ADR-0006 createDoc 修订节完全一致；唯一字面张力（ADR-0006「原始 I/O 错误原样上抛」）属于 ADR-0009 已明文授权的契约演进，issue #108 即该演进的实施任务，非真矛盾。

> 产出说明：SA8 技能默认产出「相关决议 + 冲突报告」两份文件；本次按总控指令收敛为单文件，相关决议摘录并入本文「附录 A」。

## ADR 盘点（全量 9 份 + CONTEXT.md）

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 单一真相源 | accepted（含 2026-08-19/08-21 修订） | 无 | schema 语言与投影域，不触及 Persistence 错误通道 |
| 0002 | 重写定位、authority 出范围 | accepted | 无 | 范围界定，无涉 |
| 0003 | 求值器与派生 schema | accepted | 无 | 无涉 |
| 0004 | vfsl-protocol 类型投影 | accepted | 无 | 无涉 |
| 0005 | 投影生成管线 | accepted | 无 | 无涉 |
| 0006 | Cordis 持久化插件 DocPersistence | accepted（issue #64 / #79 两节修订） | **高** | createDoc/duplicate/提交点条款 = AC4/AC5 直接依据；「原样上抛」字面张力见冲突点 #1 |
| 0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（Runtime/open/read 条款被 0008 部分取代） | 低 | 被取代部分不构成约束；observer no-rollback 底层纪律与 AC5「不虚假声称 rollback」同向 |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 2026-08-24 稳定码注册修订） | **中** | §Fatal 的 committed-aware branded fatal 是 AC3 的同款纪律先例；notifyDirty/saveDoc 接缝不在本 issue 范围 |
| 0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted | **核心** | §Persistence 错误演进 L74–L81 = 本任务的直接授权与规格来源 |
| CONTEXT.md | 术语与惯例 | — | 低 | 无 Persistence 错误术语被冻结；「创建时间」「空闲 Runtime」属 Registry 层，未被触碰 |

## AC 对照表

| AC | 任务要求 | ADR 冻结条款（出处） | 裁决 |
|---|---|---|---|
| AC1 | 稳定 typed load operational error，保留原始 cause 且稳定 message 不拼接 cause | ADR-0009 L76「typed load operational error」+ L81「稳定 message 不拼接 cause」；「保留原始 cause」与 L78 fatal「原始 cause」及诚实纪律（不吞、不伪装）同构 | no-conflict |
| AC2 | 稳定 typed create operational error，明确 `committed:false` | ADR-0009 L77「typed create operational error，明确 `committed:false`」逐字对应 | no-conflict（演进授权，见冲突点 #1） |
| AC3 | committed-aware create fatal，至少携带稳定 phase、`committed` 与原始 cause | ADR-0009 L78「committed-aware create fatal，携带稳定 phase、committed 与原始 cause」逐字对应；ADR-0008 §Fatal（DocRuntimeFatalError ≥ committed + 稳定 phase）为同款分层先例 | no-conflict |
| AC4 | duplicate 保持独立稳定类型，不与 operational/fatal 混合 | ADR-0009 L79「duplicate 继续使用稳定 duplicate 类型」+ ADR-0006 #64 修订「拒绝 `DocDuplicateError`（稳定错误码 `DOC_DUPLICATE`）」 | no-conflict（完全一致） |
| AC5 | FilePersistence create 提交点与 post-commit failure 分类准确，不虚假声称 rollback | ADR-0006 #64 修订「FilePersistence 以 temp→rename 完成为提交点；不新增 fsync 保证」；ADR-0009 L70（Registry 侧同款「不得补偿删除、fallback 或声称 rollback」）+ L120「已提交 create 不能被误报」 | no-conflict（AC5 是该条款的落实而非修订） |
| AC6 | unknown Adapter/internal exception 不被降级为 operational error | ADR-0009 L81「unknown exception 不能伪装为运营失败」+ L56「unknown load exception 不得被降级为运营失败」 | no-conflict |
| AC7 | Memory/File 通过同一组 load/create 错误契约、exact cause 与敏感文本负锁测试 | ADR-0006 #64 修订 3「两 Adapter 必须通过同一组 createDoc shared contract tests」+ #79 修订 3 平行套件纪律；ADR-0009 L81（message 不拼接 cause）与 L95（公开 message 脱敏）为负锁测试依据 | no-conflict（既有纪律向 load/create 错误域的扩展） |
| AC8 | 全量 typecheck/test 与 Node 20/24 CI | 无 ADR 条款涉及流程门槛 | no-conflict（流程性） |

## ADR 条款对照（任务指定重点）

### 1. ADR-0009 §Persistence 错误演进（L72–L83）——三类 typed error + duplicate 独立类型

原文四项分类（L76–L79）：typed load operational error / typed create operational error（`committed:false`）/ committed-aware create fatal（稳定 phase + committed + 原始 cause）/ duplicate 继续稳定类型；L81 追加「稳定 message 不拼接 cause；Registry 只把 typed operational error 映射为公开 load/create issue；duplicate 映射 already exists；Persistence fatal 的 committed 事实原样传播；unknown exception 不能伪装为运营失败」。

**结论：AC1–AC4 与该节一一对应、语义等价，无缺失（四类全覆盖）、无加码、无降级。** AC5/AC6/AC7 分别落实 L81 的三条传播纪律。L83（Clock/Timer 外部依赖）不是本任务新义务——基线已实现（见前置条件核验）。

### 2. ADR-0006「createDoc 与 owner 语义修订」节（issue #64）——createDoc/duplicate 条款

- **duplicate 三判定条款**（cache 命中即拒 / store 存在性读见快照即拒 / 并发 claim 即拒，全部在写路径之前，绝不覆盖已提交内容）：issue #108 不触碰判定逻辑，AC4 仅要求 duplicate 保持 `DocDuplicateError`/`DOC_DUPLICATE` 独立类型。**无冲突。**
- **「temp→rename 完成为提交点；不新增 fsync 保证」**：AC5 要求分类准确而非改变提交点语义；简报摸底发现的 Memory `write` 早退 resolve / File rename-commit 不对称属**代码现状歧义**，是 ADR-0009 诚实纪律（committed 事实原样传播）要求 SA1 裁决的问题，不是 ADR 冲突。
- **「失败时不返回 handle、不缓存、不销毁传入 doc，所有权仍归调用方；原始 I/O 错误原样上抛」**：唯一字面张力，见冲突点 #1。

### 3. ADR-0006 #79 修订节（saveDoc/getStatus）

本 issue 范围严格限定 load/create 错误通道，AC 无一条触碰 saveDoc dirty-notification 语义、degraded 拒绝面归属或 `DocHandleStatus` 状态集。**无冲突。**（提醒 SA1/SA3 保持该边界。）

### 4. ADR-0008 交叉

- §Fatal「committed:true 或未知异常保守视为可能已提交……始终 reject 原始 fatal；不补偿、不 fallback、不声称 rollback」：AC3/AC5 在 Persistence 层镜像同一纪律，分层一致，**无冲突**。
- L45 `notifyDirty` 窄接缝、#93 稳定码注册修订（namespace-runtime 错误码族）：不在本任务范围。**无冲突。** 注意 AC3 的 Persistence fatal phase 词汇属 Persistence 域，不得与 ADR-0009 L89–L93 的 Registry fatal phase 三值（`runtime-construction`/`create-document-internal`/`lifecycle-slot-internal`）混淆——属 SA1 设计细节，非冲突。

### 5. CONTEXT.md

无 Persistence 错误相关术语被冻结。「创建时间（createdAt）」明确「Persistence 只保存而不解释或校验」——与 ADR-0006「持久层不生成、不修改、不校验该字段」一致，本任务不触碰。**无冲突。**

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | 低（字面张力，非实质冲突） | ADR-0006 #64 修订「原始 I/O 错误原样上抛」 | AC1/AC2/AC6：load/create 失败包装为 typed error，原始异常经 `error.cause` exact 保留、message 不拼接 cause | **no-conflict（ADR-0009 已授权的演进）** | ① 演进权威在案：ADR-0009（2026-08-25，accepted，晚于 0006 各修订节）L74 明文「Persistence 在 Registry 实施前增加稳定分类」并逐项列出四类——这是 ADR 语料库自身的修订模式（ADR-0006 两度以修订节演进早期条款、ADR-0008 取代 ADR-0007 部分条款，均为后来者治理）；冲突基准是 ADR 全集，全集中的现行有效条款集 = 0006 减去被 0009 演进的错误通道字样。② 条款意图保全：「原样上抛」的意图是调用方可 exact 观察原始失败、不吞不伪装；新契约以 `error.cause` exact identity 保留（AC7 锁定），意图不损。③ issue #108 本身即该演进的实施授权。**残留卫生问题**：ADR-0006 尚无指向 ADR-0009 §Persistence 错误演进的交叉引用修订节——建议后续以 0006 自身修订节先例补一节注记，属 ADR 语料卫生，不构成阻塞 |
| 2 | 无（记录为演进后果） | 无 ADR 条款（共享契约测试属代码） | AC7 新契约下，现有 `testing.ts` L455–L457 断言 `err.message` 含 `'io down'`（裸异常透传）须同步修订 | **no-conflict** | 测试代码不构成自动阻塞依据（SA8 边界）；该断言锚定的是演进前的旧通道，随契约演进修订属必然后果，简报已明文计划 |

无 hard-violation、无 override-declared、无待 Jim 裁决的未授权演进项。

## 前置条件核验（实证）

| 前置 | 要求来源 | 证据 | 结论 |
|---|---|---|---|
| #107 已完成并入基线 | 简报 L9；ADR-0009 L128 实施顺序（Clock capability → Persistence service/timer/clock → typed error 演进） | `git log --oneline -1` → `279d3ba persistence：迁移 nomicorePersistence 与外部 Clock/Timer (#117)`；全历史另见 `c6d4082 …(issue #107)` | ✓ #117 即本分支 HEAD，#107 工作已入基线 |
| 基线含 `nomicorePersistence` service | ADR-0009 L26（service 从 `docPersistence` 迁移） | `packages/persistence/src/contract.ts` L35/L53/L95/L106：`NOMICORE_PERSISTENCE_SERVICE = 'nomicorePersistence'` | ✓ |
| 基线含外部 Clock/Timer 依赖 | ADR-0009 L83 | `service.ts` L3 `import { requireClock } from '@nomicore/clock'`、L51 `ctx.timeout` 桥接；memory.ts/file.ts/testing.ts 均经 scheduler 消费 | ✓ |
| duplicate 消费方不受 additive 导出影响 | 简报 L45 | `packages/dsh-persistence/src/probe.ts` L376：`error instanceof DocDuplicateError` + `error.code`，非 duplicate 的 else 分支原样 rethrow——AC4 保证 duplicate 类型不变即探测确定性不变 | ✓ |

## 结论

**`clear`。** AC1–AC8 与 ADR-0009 §Persistence 错误演进逐字对齐、与 ADR-0006 createDoc/duplicate/提交点条款及 #79 修订节无一处实质冲突；唯一字面张力（#1）是 ADR-0009 已授权的契约演进，issue #108 即其实施任务，且「原样上抛」的诚实意图经 `error.cause` exact 保留而保全。前置依赖（#107/#117、nomicorePersistence、Clock/Timer）已实证在基线。放行进入 SA6 验收锚定；留给 SA1 的两个已知裁决点（非冲突）：Memory/File commit-fact 诚实来源、Persistence fatal phase 词汇与 Registry phase 三值的分层。

## 附录 A：相关决议摘录（全链 SA 复用，只摘不裁）

> 引用行号为 `docs/adr/0009-…md` / `docs/adr/0006-…md` 当前基线行号，需要时回查全文。

**ADR-0009 §Persistence 错误演进（L72–L83）**
- 「Persistence 在 Registry 实施前增加稳定分类：typed load operational error；typed create operational error，明确 `committed:false`；committed-aware create fatal，携带稳定 phase、committed 与原始 cause；duplicate 继续使用稳定 duplicate 类型。」
- 「稳定 message 不拼接 cause。Registry 只把 typed operational error 映射为公开 load/create issue；duplicate 映射 already exists；Persistence fatal 的 committed 事实原样传播；unknown exception 不能伪装为运营失败。」
- 「Persistence 和 Registry 都依赖外部 Clock 与 Cordis Timer，不各自实现或 fallback 到系统 timer。」

**ADR-0009 §Create（L60–L70， committed 诚实纪律）**
- 「非法 Clock 输出属于 `create-document-internal`、`committed:false` fatal。」
- 「active、idle、并发或 persisted duplicate 统一映射为 `NAMESPACE_ALREADY_EXISTS`；create 不退化为 open 或 upsert。」
- 「如果 createDoc 已提交而 Runtime 构造失败，Registry 释放 handle、保留持久化文档、清理 entry，并以 `committed:true` Registry fatal reject。不得补偿删除、fallback 或声称 rollback。」

**ADR-0009 §Open（L56）**：「invalid identity、not found、typed load operational failure 和 Registry not accepting 使用窄 `OpenNamespaceIssue`。公开 issue 不回显 identity 或原始异常。unknown load exception 不得被降级为运营失败。」

**ADR-0009 §Fatal/observability（L87–L95）**：结果联合外 internal failure 用 `NamespaceRegistryFatalError`（≥ operation、stable phase、committed、cause；初始 phase = `runtime-construction`/`create-document-internal`/`lifecycle-slot-internal`）；「公开 issue/error message 不包含 owner/namespace 原值、SCHEMA 全文、ROOT/input 数据、原始异常文本或 stack」；「不公开 retryable 猜测」。

**ADR-0006 #64 修订节（createDoc，现行有效条款）**
- 「cache/store 已存在或并发创建 → 拒绝 `DocDuplicateError`（稳定错误码 `DOC_DUPLICATE`）；在 duplicate 判定路径上绝不覆盖已提交内容——cache 命中即拒、store 存在性读见快照即拒、并发 claim 即拒，三条判定都在进入写路径之前。」
- 「创建成功前初始完整 snapshot 已提交……FilePersistence 以 temp→rename 完成为提交点；不新增 fsync 保证。」
- 「失败时不返回 handle、不缓存、不销毁传入 doc，所有权仍归调用方；原始 I/O 错误原样上抛。」（错误通道字样由 ADR-0009 §Persistence 错误演进治理，见报告冲突点 #1）
- 「持久层仍仅校验 `META.docId === docId`，不校验 VFSL/ROOT/createdAt。」
- 实施注记：「MemoryPersistence 与 FilePersistence 共用 lifecycle core，不得复制状态机；两 Adapter 必须通过同一组 createDoc shared contract tests。」

**ADR-0006 #79 修订节（本任务不得触碰的边界）**：saveDoc = mutation 后 dirty notification（degraded 不构成拒绝理由）；degraded 拒绝面归属业务编排层；`DocHandleStatus` 四态与优先级冻结。

**ADR-0008 §Fatal（分层先例）**：「committed:false 不调用 dirty notifier；committed:true 或未知异常保守视为可能已提交……始终 reject 原始 fatal；不补偿、不 fallback、不声称 rollback。」

**CONTEXT.md 相关**：「创建时间（createdAt）」——Persistence 只保存而不解释或校验；「命名空间（namespace）」「空闲 Runtime（idle Runtime）」属 Registry 层术语，本任务不触碰。

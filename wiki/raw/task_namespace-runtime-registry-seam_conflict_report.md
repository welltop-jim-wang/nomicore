# 冲突门禁报告

- 被审对象：`wiki/raw/task_namespace-runtime-registry-seam.md`（issue #109 任务简报，Phase 0 前置门禁）
- 冲突基准：`docs/adr/` 全集 9 篇（全部读取，无抽样；无 superseded 项）+ 根 `CONTEXT.md`
- 裁决时间：2026-08-25（worktree /home/wangjian/nomicore-fix-issue-109）
- 配套产出：`wiki/raw/task_namespace-runtime-registry-seam_relevant_decisions.md`（全链 SA 复用的约束清单）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19 修订） | 否 | 任务不触及 schema 文本/方言/信封/codegen；无对照条款 |
| 0002 | nomicore 是全新重写，authority 出范围 | accepted | 否 | 任务不涉及旧系统与 authority；无对照条款 |
| 0003 | 求值器与派生 schema | accepted | 否 | 任务不触及解析/求值/结构树；无对照条款 |
| 0004 | vfsl-protocol 类型投影 | accepted | 否 | 任务不触及类型投影协议；无对照条款 |
| 0005 | 投影生成管线 | accepted | 否 | 任务不触及 SchemaSource/生成器/domains；无对照条款 |
| 0006 | Cordis 持久化插件（DocPersistence/DocHandle） | accepted（含 createDoc/owner、getStatus 两轮修订） | 是 | factory 输入的 `DocHandle` 形状（含 `getStatus()`）、`saveDoc` dirty-notification 语义、degraded 拒绝面归属与简报「handle + dirty notifier 绑定」「AC4 保持 fatal/status 语义」逐条一致；no-conflict |
| 0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted（Runtime/open/read 条款由 0008 部分取代） | 是 | 仍有效的「业务调用方不得取得可写 Yjs 引用或绕过该入口」正是本 seam 的防护目标，简报要求一致；被取代条款本任务未触及；no-conflict |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 2026-08-24 稳定码注册修订） | 是（直接相关） | 「生产工厂保留包内，由未来 Registry 使用」「Runtime 不公开 handle、Y.Doc……或生产构造器」「测试通过包内确定性 seam 注入」与 AC2/AC3/AC6 一致；P0 队首/单 sequencer/fatal/status/close 语义与 AC4 一致；no-conflict（见结论注 1 对「包内」的裁定） |
| 0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（2026-08-25） | 是（直接相关） | §模块与 Cordis service「`@nomicore/namespace-runtime/internal` 唯一导出的 `createNamespaceRuntimeForRegistry`……主 entry 不公开生产 Runtime 构造器。模块边界测试限制该 internal subpath 只能由 Registry 生产代码消费」与 AC1/AC3/AC5 逐字对应；本 ticket 即实施顺序中「Runtime internal Registry factory」切片；no-conflict |
| CONTEXT.md | 术语与硬性惯例 | 现行 | 是 | 写序列器、P0、active schema、停接纳、命名空间等术语使用与简报表述一致，无 `_Avoid_` 词违规；no-conflict |

## 冲突点

无。全部对照结论为 no-conflict；无 override-declared、无 evolution、无 hard-violation。

已显式裁定过的候选张力（均为 no-conflict，记录备查）：

| # | 候选张力 | 裁决 | 依据 |
|---|---|---|---|
| 1 | 经 `internal` subpath 导出生产 factory 是否违反 ADR 0008「生产工厂保留包内，由未来 Registry 使用」 | no-conflict | subpath 仍在 `@nomicore/namespace-runtime` 包内、主 entry 保持封闭；ADR 0009（更晚，2026-08-25）明文以该 subpath 为唯一生产构造通道，并明示「本ADR不取代ADR 0008的单Runtime语义」——两 ADR 协同而非冲突 |
| 2 | AC5 边界测试「前瞻性允许未来 `@nomicore/namespace-registry` 包路径（当前空集）」是否违反 0009「只能由 Registry 生产代码消费」 | no-conflict | 白名单语义 = 恰好只允许 Registry 生产代码消费；包名与 ADR 0009「建立 `@nomicore/namespace-registry`」一致，属该条款的直接实现而非放宽 |
| 3 | AC6「testing seam 继续位于受控测试入口」与 ADR 0008「测试通过包内确定性 seam 注入……」 | no-conflict | 现行包内相对模块通道即「包内 seam」；简报同时禁止 p0Gate/compile/fault 注入面进入生产 internal subpath，与 0008 生产路径（P0 恒走真实 `compileSchemaEnvelope`）一致 |
| 4 | AC2 最小输入面（仅 handle + dirty notifier） | no-conflict | 对应 ADR 0008「`notifyDirty` 是由构造方绑定 `persistence.saveDoc(handle)` 的窄接缝；Runtime 不依赖整个 `DocPersistence`」与「Runtime 成功构造后独占一个 `DocHandle`」；0009 未规定 factory 签名细节，无更严条款被违反 |

## 结论

**Verdict: clear，放行。** 简报七条 AC 与边界纪律是 ADR 0009 §模块与 Cordis service 决策的忠实落地，同时完整保持 ADR 0008 的全部 Runtime 语义不变量；无需任何 override，无需 Jim 裁决的演进项。

非阻塞注记（不构成冲突，供 SA1/SA3 注意）：

1. **简报引用瑕疵**：简报「边界与纪律」节称构造序「（ADR 0008 D1）」——ADR 0008 无 D 编号条款（D1–D5 编号属 ADR 0004）。该括注按 ADR 0008《生命周期、状态与所有权》《单一 write sequencer》各节的构造序纪律理解即可；相关原文已摘录于 relevant_decisions 文档，全链 SA 引用时以 ADR 原文为准，不要引用「D1」编号。
2. **非 ADR 基准的纪律**：版本 bump「硬门禁 #9」、Node 20/24 CI 矩阵、`wiki/raw/` 入仓纪律均非 ADR/CONTEXT 收录条款，不属 SA8 裁决域，按简报自述纪律执行即可。
3. **命名已冻结**：factory 名 `createNamespaceRuntimeForRegistry`、subpath 名 `@nomicore/namespace-runtime/internal`、「仅一个导出」的约束均由 ADR 0009 原文固定，SA1 设计不得改写名称或增删导出面。

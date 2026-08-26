# 冲突门禁报告（Round 2 修订轮）

- 被审对象：`wiki/raw/task_namespace-runtime-registry-seam-rev1.md`（issue #109 Round 2 修订简报——边界审计强化 + 白名单收窄，Phase 0 前置门禁）
- 冲突基准：`docs/adr/` 全集 9 篇（全部重新逐篇读取，无抽样；无 superseded 项）+ 根 `CONTEXT.md`
- 裁决时间：2026-08-25（worktree /home/wangjian/nomicore-fix-issue-109，HEAD=0a4d460）
- 语料稳定性核验：`git log -- docs/adr/ CONTEXT.md` 显示 ADR 语料自 Round 1 快照（2026-08-25，同 HEAD 基线）以来零变更、工作树干净；ADR 0009 第 18 行经 `sed -n '18p'` 逐字核对，与简报引用一致。Round 1 决议清单继续有效，本轮复用不重写。
- 配套产出：沿用 `wiki/raw/task_namespace-runtime-registry-seam_relevant_decisions.md`（Round 1 全链 SA 复用约束清单 + R0 设计后复审追加 N1–N8；其摘录与本轮全量重读的 ADR 原文一致）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19 修订） | 否 | 本轮仅改测试与审计 helper；新增 fixture 为代码 fixture（import/require 语句载体），非 schema 文本，「代码库不含 schema 文本（测试 fixture 除外）」条款不受触碰；no-conflict |
| 0002 | nomicore 是全新重写，authority 出范围 | accepted | 否 | 不涉及旧系统与 authority；no-conflict |
| 0003 | 求值器与派生 schema | accepted | 否 | 不触及解析/求值/结构树；no-conflict |
| 0004 | vfsl-protocol 类型投影 | accepted | 否 | 不触及类型投影协议；no-conflict |
| 0005 | 投影生成管线 | accepted | 否 | 不触及 SchemaSource/生成器/domains；no-conflict |
| 0006 | Cordis 持久化插件（DocPersistence/DocHandle） | accepted（含 createDoc/owner、getStatus 两轮修订） | 否（间接） | 本轮零 src 改动、零 persistence 代码改动；RAC3 仅运行既有测试；no-conflict |
| 0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted（Runtime/open/read 条款由 0008 部分取代） | 否（背景） | 仍有效的「业务调用方不得取得可写 Yjs 引用或绕过该入口」不受本轮触碰；被取代条款未触及；no-conflict |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 2026-08-24 稳定码注册修订） | 是 | 约束 5「src/ 零改动预期」+ 约束 7「AC1–AC4/AC6 既有锚点零破坏」= ADR 0008 全部 Runtime 语义不变量（P0 队首、单 sequencer、fatal/status/close、公共面、稳定码）原样保持；package.json patch bump 不触及冻结的导出面与行为语义；no-conflict（Round 1 张力 #1「subpath 导出 vs 生产工厂保留包内」裁定继续有效，本轮未变更该决策） |
| 0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（2026-08-25） | 是（裁决核心） | 第 18 行「模块边界测试限制该 internal subpath 只能由 Registry 生产代码消费」是 RAC1/RAC2 的直接依据，本轮修订**强化而非变更**该条款的执行——见冲突点表张力 1/2 的逐条裁定；no-conflict |
| CONTEXT.md | 术语与硬性惯例 | 现行 | 是 | 修订简报用语（internal subpath、生产代码、白名单、模块边界）与 ADR 0009/CONTEXT 术语一致，无 `_Avoid_` 词违规；CONTEXT 各术语（写序列器/P0/active schema/停接纳/idle Runtime）定义域本轮均未触碰；no-conflict |

## 冲突点

无。全部对照结论为 no-conflict；无 override-declared、无 evolution、无 hard-violation。

本轮修订引入的候选张力（均已显式裁定为 no-conflict，记录备查）：

| # | 候选张力 | 裁决 | 依据 |
|---|---|---|---|
| 1 | RAC1 审计强化（AST 全形态覆盖：副作用导入/再导出/require()/import=require()/dynamic import()/.js-.jsx-.mjs-.cjs 载体 + 逐形态违规探针）是否与 ADR 0009 边界条款冲突 | no-conflict | ADR 0009 第 18 行原文「模块边界测试限制该 internal subpath 只能由 Registry 生产代码消费」——现存测试的绕过路径（简报反馈 1）意味着该条款**未被执行到位**；RAC1 是把测试修到真正履行「限制」，属条款的直接实现。审计手段（正则 vs AST vs 依赖图）不在任何 ADR 裁决域内；TS compiler API 经既有 devDependency（typescript@^5.9.3）使用，零新增依赖，不触碰 ADR 0008 的包组合条款 |
| 2 | RAC2 白名单收窄（`packages/namespace-registry/src/` 前缀下排除 testing/test/__tests__/fixtures 等非生产目录及 `*.test.*`/`*.spec.*` 文件）是否与 ADR 0009「Registry 生产代码」语义冲突 | no-conflict | ADR 0009 未枚举「生产代码」的路径清单，收窄是**更严格**的忠实解读而非放宽：§公共 Interface 明文「测试 seam只位于受控 testing subpath，允许替换Runtime/document factory……」——testing subpath 属注入替代工厂的非生产代码，本身不消费 internal subpath（简报约束 4 同一推理）；将其排除在白名单外与 ADR 自身的生产/测试二分一致。下界保护：简报明定排除清单「须覆盖反馈点名的 testing/test/__tests__/fixtures」，SA1 只能在生产语义内定稿，不得反向放宽（见结论注 1） |
| 3 | 违规 fixture 置于 `test/` 目录（真实扫描跳过域）是否构成对边界条款的绕过 | no-conflict | fixture 是证明「审计能识别违规形态」的探针载体，非生产代码；ADR 0009 第 18 行约束的是生产代码消费，fixture 隔离恰好保证真实门禁不误报。Round 1 设计决策 N7③「测试目录豁免属审计设计，不得移动测试文件绕审计」继续有效 |
| 4 | 前瞻性覆盖 `.js/.jsx/.mjs/.cjs`（仓内当前无此类生产文件）是否无据扩张 | no-conflict | ADR 不裁决文件扩展名；前瞻门禁以探针 fixture 兑现价值（简报 RAC1 明文要求），属实现层选择，无 ADR 条款被违反 |
| 5 | Round 1 已裁张力 #1–#4（subpath 导出 vs「生产工厂保留包内」、前瞻空集白名单、testing seam 位置、factory 最小输入面） | no-conflict（沿用） | 本轮不变更上述任何已裁决策，只强化其测试执行；Round 1 裁定原文见 `…_conflict_report.md` 冲突点表 |

## 结论

**Verdict: clear，放行。** 修订简报是「测试加固」轮：RAC1/RAC2 把 ADR 0009 第 18 行「模块边界测试限制该 internal subpath 只能由 Registry 生产代码消费」从存在绕过路径的弱执行修到全形态覆盖的强执行，同时以约束 5/7 完整保持 ADR 0008 全部 Runtime 语义与公共面零变更。无需任何 override，无需 Jim 裁决的演进项；语料自 Round 1 零漂移，Round 1 决议清单与 R0 设计后复审追加（N1–N8）继续有效。

非阻塞注记（不构成冲突，供 SA1/SA2/SA3/SA6 注意）：

1. **白名单收窄的单向边界**：SA1 定稿排除目录清单时可扩充（如 mock、fixture 变体），但不得少于反馈点名的 testing/test/__tests__/fixtures，也不得以任何形式放宽「仅 Registry 生产代码」——例如把 `src/testing/`、脚本目录或非 `packages/namespace-registry/src/` 路径重新放入白名单，即越出 ADR 0009 第 18 行，将构成本轮裁定的反面（设计后复审会按此复查）。
2. **非 ADR 基准的纪律**：版本 bump（0.1.6 → 0.1.7，「硬门禁 #9」）、Node 20/24 CI 矩阵、「发布归 Host」、`wiki/raw/task_namespace-runtime-registry-seam-rev1_*.md` 命名与入仓纪律均非 ADR/CONTEXT 收录条款，不属 SA8 裁决域，按简报自述纪律执行。
3. **名称与导出面已冻结**：subpath 名 `@nomicore/namespace-runtime/internal`、factory 名 `createNamespaceRuntimeForRegistry`、「唯一导出」约束由 ADR 0009 原文固定；本轮约束 5（src 零改动）与之叠加——SA3 即使发现「必须动 src」的所谓必要，也只能停止回禀，不得自行改写。
4. **存量断言零破坏是 ADR 一致性的一部分**：约束 7 点名的 AC1–AC4/AC6 既有锚点（导出面、注入面零效果、P0/FIFO/close 全链、type-guard）与 `runtime-acceptance-exports-audit.test.ts` 承载着 ADR 0008/0009 的可观测承诺，本轮改动不得使其语义漂移。

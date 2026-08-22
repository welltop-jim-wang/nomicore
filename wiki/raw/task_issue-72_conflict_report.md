# 冲突门禁报告

- 被审对象：`wiki/raw/task_issue-72.md`（MABF Task: 严格编译 SchemaEnvelope——双指纹与冻结产物，Issue #72，feature，Phase 0 前置门禁）
- 冲突基准：`docs/adr/0001–0007` 全集（共 7 份，逐份全文读取，均 accepted，无 superseded-by 状态）+ `CONTEXT.md`
- 审查日期：2026-08-22（run_id: issue-72-1787369238-3088589）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19 修订、2026-08-21 命名修订） | 是 | no-conflict。信封四键结构 `{lang, version, id, text}` 与任务要求的恰含四键一致；「未知方言 loud-fail 只读」与任务 dialect 阶段 fail-fast 一致。「性能依赖按内容哈希的编译缓存」为目标态表述，本票不做缓存由更晚、更具体的 ADR-0007 明文阶段化（见下方说明 N1），不构成违反。 |
| ADR-0002 | nomicore 是全新重写，authority 完全出范围 | accepted | 否（边界确认） | no-conflict。任务为纯函数编译入口，不涉及 authority 规则，未引入任何 `__authority__` 残留接口。 |
| ADR-0003 | 求值器与派生 schema | accepted | 是 | no-conflict。任务管线 parse→evaluate 段复用该 ADR 冻结的 `evaluate` 结果联合与派生 schema 纪律（纯数据、可 JSON 序列化、可内容哈希、无行列）；「parse/evaluate 保留原生 issues 数组」直接对应其 issues 复用 `VfslIssue` 的条款；「共享引用关系不被复制破坏」与「引用不内联展开（ref 按名引用）」同构。文中 `validateSnapshot` 字样已被 ADR-0007 更名条款覆盖，不构成约束冲突。 |
| ADR-0004 | vfsl-protocol 类型协议包 | accepted | 否（边界确认） | no-conflict。编译期类型投影属协议包/生成器轨道（D3「不进引擎包」），与运行时编译入口生命周期分离；任务未越界触碰。 |
| ADR-0005 | 投影生成管线 | accepted | 是 | no-conflict。「id 是标签不是键」支撑 semantic fingerprint 排除 `id` 的验收；「`lang`/`version` 是方言身份」与「消费方首动作 = 方言断言」支撑 envelope 校验后先做 dialect 路由的阶段顺序。 |
| ADR-0006 | Cordis 持久化插件 | accepted（含修订节） | 弱相关 | no-conflict。任务不触及持久层；「DocScope（schema 编译产物缓存，H3）正交汇合」条款与本票「返回可供后续 DocScope 使用、本票不缓存」的定位一致。 |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted | 是（直接治理） | no-conflict。任务六条验收与该 ADR「逻辑层留在 `@nomicore/vfsl`」一节逐句对应：函数签名与输入约束、五阶段结果联合（envelope/dialect/parse/evaluate/internal）、成功产物五件套（冻结 envelope、IR module、DerivedSchema、双指纹）、指纹规格（SHA-256/UTF-8/canonical JSON/`sha256:v1:<hex>`、覆盖范围与排除项）、深冻结与不做缓存，均为该 ADR 条款的直接落地，无一处偏离。 |

## 冲突点

无。裁决分布：7 份 ADR 全部 no-conflict（4 份相关/弱相关对照通过，3 份边界确认通过）；override-declared 0、evolution 0、hard-violation 0。任务简报未声明推翻任何 ADR，也未呈现修订既有决策的意图——它是 ADR-0007 已冻结条款的实现票。

### 说明性备注（非冲突，供 SA1/SA2/SA3 注意，均不阻塞）

| # | 事项 | 定性 |
|---|---|---|
| N1 | 「本票不实现缓存」vs ADR-0001「性能依赖按内容哈希的编译缓存」 | 非冲突。ADR-0007（更晚、更具体）明文「本阶段不实现编译缓存，缓存生命周期留给 NamespaceRuntime/Registry」，阶段化条款优先；ADR-0001 表述为目标态。实现时不得引入模块级可变状态（任务验收第 6 条即此意）。 |
| N2 | 任务验收「两种指纹均使用 …… `sha256:v1:<hex>` 格式」是 ADR-0007「带版本的 domain separation（`sha256:v1:<hex>`）」的简化转述 | 非冲突，但为**收紧点**：设计须落实 domain separation（envelope 与 semantic 两域不得混用同一哈希域），不能只按简报字面实现。已写入相关决议文档。 |
| N3 | 简报用词「DerivedSchema」「冻结编译产物」 | 非冲突。ADR-0007 原文即使用「DerivedSchema」；CONTEXT.md 的 _Avoid_（编译产物、DerivedSchema 英文代号）约束散文行文——后续设计与实现文档行文请用「派生 schema」，代码类型名沿 ADR-0007。 |

## 结论

**Verdict: clear，放行。** 任务简报与 ADR 全集 + CONTEXT.md 无任何冲突：它是对 ADR-0007 已接受条款的忠实实现（含前置 #71 更名已合入），信封结构、方言冻结、指纹规格、深冻结与缓存延后均有明文 ADR 依据。无需 override，无需 Jim 裁决条目。

后续链路（SA1 设计 / SA2 评审 / SA3 实现）请以 `wiki/raw/task_issue-72_relevant_decisions.md` 为约束清单，特别关注 N2（指纹 domain separation 需在设计中显式化）与 ADR-0003 的 ref 按名引用纪律（深冻结不得复制破坏共享引用）。

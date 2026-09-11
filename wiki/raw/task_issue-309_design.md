# SA1 架构与实施设计 — issue #309（v1-spec §5 与编写指南落地 M4 挂载锚位）

- Dispatch：`sa-c40892e4-3ae4-4ad2-b46a-c2a83b7017fc`（mabf-sa1 / design / iteration 2，原位修订——落实 SA2 设计攻击评审 SA2-1）；iteration 1 dispatch `sa-29329932-65c7-4720-82cb-cbf35ff0f366`（落实 SA8 设计后复审）；初版 dispatch `sa-78fcfd52-4025-4193-b9c9-31b04fa790b9`（iteration 0）
- 证据基线：worktree `/home/wangjian/nomicore-fix-issue-309`，分支 `mabf/issue-309`，HEAD `bbb93fbda3100b2da2a007a228af777cdc56d282`（#306/#307/#308 已合入；SA6/SA8 同基线独立复核一致）
- 本设计为 #309 的唯一设计产物；SA1 未修改任何生产代码、测试、规范文档或 ADR，未运行测试。

## 0. 输入与产物状态

| 固定输入 | 状态 | 说明 |
|---|---|---|
| `wiki/raw/task_issue-309.md` | 存在（Host 刷新） | Issue 正文 + 4 条 AC；**Comments: []（无 Owner 评论，无 owner-comment 约束）** |
| `wiki/raw/task_issue-309_sa6_contract.md` | 存在（已接受） | 诊断 + 可执行验收契约（§12 可直接转写），事实基线经 SA8 独立复核无失真 |
| `wiki/raw/task_issue-309_relevant_decisions.md` | 存在 | SA8 决策摘录（17 份 ADR 全 accepted，无 superseded） |
| `wiki/raw/task_issue-309_conflict_report.md` | 存在 | **SA8 前置门禁 verdict = clear；requiresConflictRecheck = true**；无 evolution-required、无 hard-conflict、无 override |
| `wiki/raw/task_issue-309_design_conflict_report.md` | 存在（iteration 1 修订输入；iteration 2 recheck 原位更新） | iteration 1 复审 verdict = **reject**（唯一事由 #13：D7(a) 冻结目标文本「单成员联合按 §7.3 坍缩」悬空引用；另 2 项 advisory）→ iteration 1 修订后 **iteration 2 recheck verdict = clear**（16 项对照：no-conflict 11 / implements-existing-decision 5；reject 事由确认解决，4 项 Required actions 全部为实现期义务）；requiresConflictRecheck = true。落实映射见 §6 与 §14 |
| `wiki/raw/task_issue-309_sa2_review.md` | 存在（iteration 2 修订输入） | **SA2 设计攻击评审 verdict = reject**：1 项 MAJOR——SA2-1（指南 §7 既有裸 Asset 示例块 L158-162 的处置未落字：按字面追加落地则旧块 doc-`\|` 配对 = 0 < 2 使 Suite D D3 红，且 AC2「枚举/联合示例使用逐成员 doc」口径两可，并留下「弱化 D3 为按节聚合」的测试弱化路径）；无 BLOCKER；另 6 项非阻断观察 N1-N6。其独立复核确认：设计的证据基线、事实锚点、needle 映射、冻结面与验收映射全部成立，SA2-1 不涉任何 ADR 冲突面。逐条落实见 §14 |
| `wiki/raw/task_issue-309_design.md` | 本文件（iteration 2 原位修订） | iteration 1 落实 SA8 复审（已经 iteration 2 recheck 确认 clear）+ 本轮落实 SA2-1 与非阻断观察 N1/N2/N3/N4/N6 的吸收（§14）；全文仅描述当前一致设计 |

---

## 1. 任务类型、目标与非目标

**任务类型**：Feature 口径的**文档面能力缺口**（SA6 §1 同判）：M4（联合成员文档注释）的解析/IR/派生/投影/codegen 行为已由 #306/#307/#308 落地且 68 tests 绿；缺口在**规范文本面**（v1-spec §5 三类锚位）、**指南面**（schema-authoring-guide L204/§7/§8/检查表）、**检查器机器契约面**（`tests/acceptance/vfsl_spec_acceptance.py` docstring/G10/G16 + exemplar）与**注释措辞面**（9 文件 14 处「三锚位」残留）。不是 bug 修复：文档落后是实现票/文档票拆分下**已登记的计划性中间态**（#306 设计冲突报告 C-1/C-5/O-3/O-5；ADR 0019 Consequences 显式排期）。

**目标（可观察行为）**：

1. **G1（AC1）** v1-spec §5 挂载规则修订为**四类锚位**，含 M4 五条子规则（前导 `|` 锚位、首成员起点锚位、连续 doc 同挂、坍缩维持 E305、`|` 夹缝与 M3 优先的不对称注明）与 E305 既有场景不变的明确表述，挂载示例补联合成员样本（新增 §5 `vfsl` 围栏块）；
2. **G2（AC2）** schema-authoring-guide §7/§8 补逐成员 doc 写法与示例——**§7 为替换既有裸 Asset 块（L158-162）而非增补，修订后 §7 恰含一个 `vfsl` 围栏块**（示例可在现行实现下解析求值通过、memberDocs 逐字在场）、L204 挂载目标句补「联合成员」、提交前检查表补 M4 条目；
3. **G3（O-3，AC1/AC2 的机器契约化）** 规格检查器同支扩展：docstring L34、G10 need 12→13 项、新增 G17（§5 M4 子规则 9 项）、G16 陈旧期望 `AssetsDoc→ROOT` 同票修复；exemplar 同步保持 `--spec` 绿路径 22/22；
4. **G4（AC3）** 全仓「三锚位」措辞清零，作用域 = tracked 文件 − `wiki/**` − `dist/**`（§7-D1 裁定）；
5. **G5（AC4）** `git diff --check` 干净；
6. **G6** 新增 CI-wired 文档契约测试 `packages/vfsl/test/spec-docs-anchor-m4-contract.test.ts`（Suite D，D1–D5），使文档面缺口在 `pnpm test` 内可判红绿。

**非目标（明确不做）**：

- 不改任何生产运行时语义：`packages/*/src` 仅允许注释/措辞改动（SA8 B5 / SA6 §12.8 B5）；E305 消息正文已是四类枚举（`packages/vfsl/src/semantic.ts:76`，#306 落地），本票零消息改动；
- 不改金样本常量（`parse-vfsl-union-member-docs.test.ts` 的 IR sha256 / semantic 指纹，SA8 冻结面）；
- 不改 `wiki/**` 历史证据（SA8 冻结面 / docs/AGENTS.md Authority L5）；
- 不改 `domains/*/generated.ts`（N6）；
- 不修订 ADR 0003/0016 等（SA8 §6：无 evolution-required；ADR 0019 正文已显式修订过它们）；
- 不把规格检查器接入 CI/package scripts（B4 follow-up，§13 登记）；
- 不新增错误码、不新增 VFSL 语法、不给成员 doc 引入机器语义（ADR 0019 决策 8/9、ADR 0001）。

## 2. 当前行为与证据锚点（HEAD `bbb93fb` 实读）

### 2.1 实现面（已四锚位，负控基线，全部保持）

| 事实 | 锚点 |
|---|---|
| M4 延迟回收：附着点 A（前导 `\|` 记号锚）/ B（成员起始记号锚），不触碰 `claimDocs` 与既有 M1/M2/M3 回收 | `packages/vfsl/src/parser.ts:174-188`（`recordPipeAnchor`/`recordStartAnchor`） |
| IR union 条件键 `memberDocs?: string[][]`（全体成员无 doc 整键缺席；键序 kind→members→memberDocs；指纹纪律注释） | `packages/vfsl/src/ir.ts:44-53` |
| E305 消息正文已枚举四类「类型别名 / 属性 / 标记类型 / 联合成员」，前缀 `VFSL-E305: ` 冻结 | `packages/vfsl/src/semantic.ts:76`；v1-spec §4 L277-280（前缀冻结项） |
| derived 条件稀疏 `memberDocs` 表（`<member N>` 键形）、投影 docs 切片第三来源（marker 在前 member 在后）、codegen 四发射位 | ADR 0019 决策 5/6/7；#306/#307/#308 已合入（git log `bbb93fb`/`31da1f0`/`4d4208b`） |
| 实现回归基线：4 文件 / 68 tests 绿、Type Errors 无 | SA6 §4（同 HEAD 实测） |

### 2.2 文档/检查器面（缺口对象，逐字核实）

| 对象 | 现行内容 | 锚点 |
|---|---|---|
| v1-spec §5 挂载规则 | 「挂载到紧随其后…的**声明性节点**，**三类**：类型别名、属性、标记类型。连续多个文档注释…挂载到同一后续节点。若直到模块末尾都没有可挂载节点 → VFSL-E305」——无「联合成员/M4/坍缩/夹缝/M3 优先」 | `docs/vfsl/v1-spec.md:405-409` |
| v1-spec §5 挂载示例 | 表格 = 附录 fixture 7 条 doc；§5 内 `vfsl` 围栏块 **0 个**（唯一在 §10 附录） | `docs/vfsl/v1-spec.md:414-424` |
| 指南挂载目标句 | 「JSDoc 必须紧邻类型别名、对象字段或标记类型才能挂载。」 | `docs/vfsl/schema-authoring-guide.md:204` |
| 指南 §7/§8 示例 | §7 唯一 `vfsl` 围栏块 = 裸 `type Asset = \| {…} \| {…};`（**零成员 doc**——SA2-1 处置对象）；§8 块内 Status 声明同样无成员 doc（同块 ROOT 声明已有字段 doc，非成员 doc） | 指南 L158-162（§7 块：围栏 L158 + 裸声明 L159-161 + 围栏 L162）、L182-202（§8 块：Status L183-186 + ROOT L188-201 同一块） |
| 指南检查表 | 无 M4/逐成员 doc 条目 | 指南 L273-287（`## 提交前检查表`） |
| 检查器机器契约 | docstring「挂载目标: 类型别名 / 属性 / 标记类型」；G10 need 12 项；G16 期望 `AssetsDoc`（§10 fixture 已是 `type ROOT = YMap<…>` → 预存在红） | `tests/acceptance/vfsl_spec_acceptance.py:34`、L477-478、L321、L555 |
| exemplar | §4 挂载目标三处（类型别名处/属性处/标记类型处）；附录 fixture 仍是 **ROOT 约定改名前的 `type AssetsDoc = YXmlFragment<…>`** | `tests/acceptance/exemplar/spec-exemplar-v1.md:99-101`、L144-160 |
| 「三锚位」残留 | **14 处 / 9 个 tracked 文件**（排除 wiki/dist），逐行号见 §7-D10 表 | 本设计 grep 实测 = SA6 §5.4 = SA8 §2 三方一致 |
| CONTEXT.md | 无「锚位/挂载/联合成员」条目（「锚位」已是 ADR 0019 与源码注释既有词汇） | `CONTEXT.md`（L49 标记类型、L115 判别联合为语言级术语先例） |

### 2.3 规范级约束（修订必须遵守）

- v1-spec §8（L461-471）：只增不改；本规格自身修订同样只增不改；首次发布前评审修订轮次不受此约束（错误码编号随首次发布冻结）；
- v1-spec §4（L277-280）：错误 message 前缀 `VFSL-E` + 三位编号 + 冒号 + 单空格为规格冻结项，正文措辞不冻结，测试以前缀为断言锚；
- docs/AGENTS.md：行为变更须同步所有契约已改的规范文档；**文档措辞变更不得虚构实现行为**；引入/变更领域术语须更新 CONTEXT.md；显式修订而非静默矛盾；`git diff --check`；
- packages/vfsl/AGENTS.md：错误码/issue 序/路径报告/信封严格性/指纹输入为兼容行为；测试内直接 `readFileSync` 读仓文件有既有先例（`packages/vfsl/test/compile-schema-envelope.test.ts` L45/L558，直接读 `../package.json`）；`schemasource-seam.test.ts` 则是经生产接缝 `FileSchemaSource` 读文件的接缝测试本体（iteration 1 按 SA8 advisory 精确化——原引该文件为直接读先例不精确）。

## 3. 根因 / 能力缺口（承接 SA6 §8，不重立论）

**能力缺口一句话（SA6 §8）**：ADR 0019 授权的 M4 四锚位只在实现面落地；规范/指南/检查器的规范文本面与注释措辞面停留在三锚位，形成「实现已四锚位、规格仍三锚位」的中间态。

| 根因链（SA6 §8 步骤） | 设计响应 |
|---|---|
| 症状：§5 三类 + 指南三锚位句 + 检查器三锚位机器契约 + 14 处注释残留 | §7-D7/D8/D9/D10 四面同步修订 |
| 直接故障点：文档三面未随实现修订 | 本票即修复本体（文档票） |
| 触发条件：按现行 §5 解释 M4 文本会误判 E305；检查器对实现漂移无感 | §5 修订 + G17 结构化契约 + Suite D 把文档面纳入 `pnpm test` |
| 最深根因：特性拆分为实现票（#306-#308）+ 文档票（#309）同支累积，中间态被 #306 设计冲突报告 C-1/C-5/O-3/O-5 显式预登记 | 时序义务：**#309 须在 PR #305 收官合并前落地**（SA8 Required action 5） |
| 放大因素：检查器未接 CI（全仓唯一引用在 exemplar 头注）；wiki 历史证据使 AC3 需精确边界 | B4 follow-up 登记（§13）；AC3 作用域裁定（§7-D1） |

## 4. Owner 要求落实

Issue #309 REST 实测（Host brief + SA6 §2 + SA8 §2 三方一致）：**`comments: []`、`state: OPEN`、`labels: [in-progress]`**——无 Owner 评论，无 owner-comment 硬性约束，亦无可用 override 来源。需求全集 = Issue 正文（What to build + AC1-AC4）+ ADR 0019 Consequences。

| 来源 | Updated at | Requirement | Design section |
|---|---|---|---|
| Issue 正文（2026-09-11T10:15:37Z） | — | v1-spec §5 四类锚位 + M4 子规则 + 联合成员示例 | §7-D7 |
| Issue 正文 | — | 指南 §7/§8 逐成员 doc 写法与示例、检查表同步 | §7-D8 |
| Issue 正文 | — | 源码与测试注释「三锚位」清扫为四锚位 | §7-D10 |
| Issue 正文 | — | 规格随实现同支累积（避免中间态） | §3、§13（时序） |
| AC1 | — | §5 挂载规则/边界与实现逐条一致（含 E305 既有场景不变表述） | §7-D7、§12 |
| AC2 | — | 指南示例逐成员 doc、检查表覆盖 M4 | §7-D8、§12 |
| AC3 | — | 全仓「三锚位」无残留（dist 除外） | §7-D1、§7-D10、§12 |
| AC4 | — | `git diff --check` 干净 | §7-D10、§12 |
| ADR 0019 Consequences（L193-195） | — | 文档面随实现 PR 落地；指南 §7/§8 与检查表同步 | 全文 |
| #306 O-3（预登记义务） | — | 修订 §5 时必须同支更新检查器与指南 | §7-D9 |

## 5. 复现和根因承接

| 上游事实（SA6） | 证据位置 | 设计响应 |
|---|---|---|
| §5.2 六条「文档声明 ↔ 实现实测」矛盾（成员 doc ok:true 而文档称 E305 等） | sa6_contract §5.2（A1-A4 探针） | §7-D7 目标文本逐条对齐 A1-A4/B1-B4/C1/C3/C5 冻结观察 |
| §5.3 交付物红灯矩阵：D1-D5、G10/G17 全红、G16 预存在红 | sa6_contract §5.3 | §7 修订后全部转绿；G16 同票修复（§7-D3） |
| §5.4 残留清单 14 处 / 9 文件 | sa6_contract §5.4 = 本设计 grep = SA8 §2 | §7-D10 逐处替换表 |
| §9 X1-X7 控制变量矩阵：目标 §5 文本 + 扩展检查器 + G16 修复 → 21/21 绿；目标指南示例现行实现下 `ok:true` 且 memberDocs 逐字在场 | sa6_contract §9 | §7-D7/D8 的目标文本以 X2/X3/X6 已验证形态为蓝本，不虚构行为 |
| §12.1 冻结运行时观察 A1-E2/I1 | sa6_contract §12.1 | 目标文档所有行为性陈述逐条锚定这些观察（docs/AGENTS「不得虚构实现行为」） |
| §12.2-12.5 可执行契约（Suite D/C、检查器同步、运行入口） | sa6_contract §12 | §7-D4、§12 直接承接为实现票输入 |
| §15 开放点 U1-U5 | sa6_contract §15 | U1→§7-D2、U2→§7-D3、U3→§7-D4、U4→§7-D5、U5→SA8 门禁已补齐（本设计 §6） |

**上游事实与源码矛盾检查**：未发现。SA6 引用的行号、文本与残留清单经本设计在 HEAD 逐项实读全部吻合；唯一补充事实：**exemplar 附录 fixture 仍是 `AssetsDoc`（YXmlFragment 形）**，SA6 未显式列出（其 §12.4 exemplar 行只提 §4 补「联合成员」），该事实使 G16 修复后 exemplar 绿路径必须同步 fixture——见 §7-D6，属 SA6 契约目标的实现性补全，不构成冲突。

## 6. SA8 约束落实

**SA8 前置门禁**（`_conflict_report.md`，已通过，verdict = clear）：18 项决策对照全部为 no-conflict（11）/ implements-existing-decision（7）；无 evolution-required、无 hard-conflict、无 override；**requiresConflictRecheck = true**（规范正文修订、检查器机器契约扩展、9 文件措辞改动尚待实现，须实现后核对）。

**SA8 设计后复审**（`_design_conflict_report.md`，原位更新两轮）：iteration 1 verdict = **reject**——唯一事由 #13 **可修正不一致**：D7(a) 冻结目标文本第 4 条子规则「单成员联合按 §7.3 坍缩」为悬空引用（v1-spec §7 为「信封形状」且无任何小节，全篇「坍缩」0 命中；原指涉对象为非规范 wiki 设计产物），按目标文本冻结原样落地将违反 docs/AGENTS.md「Link to the authoritative source」/「Check links and referenced filenames」；另 2 项 advisory（D7(b) 发射位界线限定、先例引用精确化）。iteration 1 修订（见 §14）后，**iteration 2 recheck verdict = clear**：16 项决策对照 no-conflict（11）/ implements-existing-decision（5），reject 事由确认解决、两项 advisory 确认落实、事实基线独立复核无失真；其 4 项 Required actions（落地文本悬空引用核对 / 残余引用纪律 / 实现后冲突复查 / 时序闭合）全部为实现期义务。本设计按下表逐条落实前置门禁与复审的 Required actions；修订映射见 §14。

| 决议或义务（SA8） | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|
| Required action 1（§3 #12 / B1）：AC3 作用域须显式落字；字面全域读法需 Owner 评论授权（无） | §7-D1 | 采纳「tracked − `wiki/**` − `dist/**`」作用域；25 个 wiki 历史证据文件不改写，由 N8 零 diff 控制锚定 | 实现后核对（wiki 零 diff） |
| Required action 2（§3 #15 / B2）：`docs/adr/0019:60` 二选一显式记录 | §7-D2 | 最小措辞修订「三锚位」→「既有 M1/M2/M3 锚位」，按 docs/AGENTS「explicitly amend」登记为非语义比较性表述修订；不改决策内容 | 实现后核对（ADR 除该行外零改动） |
| Required action 3（§3 #16 / B3）：G16 处置记录 | §7-D3 | 同票修复（一行期望 `AssetsDoc→ROOT` + 消息同步），对齐 ADR 0003 ROOT 约定与现行 §10 fixture；验收判 22/22 | 实现后核对（检查器改动不越界） |
| Required action 4（§3 #14 / U4）：CONTEXT.md 术语裁定 | §7-D5 | 补「挂载锚位（mount anchor）」条目（四类），履行 docs/AGENTS.md L9 词汇规则 | 实现后核对（CONTEXT 仅此一条新增） |
| Required action 5（§3 #10）：时序闭合，PR #305 收官前落地 | §3、§13 | 设计声明时序义务；分支即 `mabf/issue-309`（Parent PR #305 收官门槛） | 收官核对 |
| Required action 6 / §10：实现后冲突复查 | §15 | requiresConflictRecheck = true；复查清单固化于 §15 | **是** |
| 冻结面：E305 既有触发与前缀、IR 条件键语义、指纹与金样本常量、derived 稀疏表、投影切片、codegen 输出、错误码集合 | §1 非目标、§11 DENY、§12（N1/N2/N3/N6） | 零触碰；由 Suite C 回归承压 | 实现后核对 |
| 冻结面：`wiki/**` 零 diff、生产代码零语义改动 | §7-D10（注释-only 纪律）、§12（N8/B5 核对） | 措辞替换不越注释/describe 标题范围 | 实现后核对 |
| packages/vfsl/AGENTS：测试读仓文件不违接缝条款（直接读先例 `compile-schema-envelope.test.ts` L45/L558；`schemasource-seam.test.ts` 为经生产接缝读文件的接缝测试） | §7-D4 | Suite D 以 fs 读 `docs/**`，与直接读先例同族 | 否 |
| 设计复审 #13 / 行动 1（**iteration 1 阻塞，reject 事由**）：D7(a) 删除悬空「§7.3」引用，改行内自含陈述或指向规范内真实位置 | §7-D7(a) 子规则第 4 条 | 已改行内自含规范陈述（「单成员联合坍缩为成员类型本身…不产生联合节点」），不引用任何章节号或 wiki 产物；D1 20 needle 与 G17 9 元组均不含「7.3」，命中映射不受影响（G17-6/G17-9 仍由该条命中） | 已核（SA8 iteration 2 recheck = clear，2026-09-11） |
| 设计复审行动 2（advisory）：D7(b) 尾段补发射位与界线限定，避免概括盖过决策 6 显式例外 | §7-D7(b) 尾段 | 已补「（发射位与界线见 ADR-0019 决策 6——…四个发射位；`YPlainArray` 纯值子树与 `YXmlFragment` 不透明实参内成员 doc 无发射位，派生表照常收集）」（iteration 2 按 SA2 N3 将该冻结文本内 ADR 引用对齐 v1-spec §5 既有连字符风格，needle 零影响，见 §14） | 实现后核对（目标文本随 §5 落地） |
| 设计复审行动 3（advisory）：修正测试内直接读文件的先例引用 | §2.3、本表上行 | 先例改为 `compile-schema-envelope.test.ts`（L45/L558）；结论不变 | 否 |

## 7. 设计决策与主要备选方案

### D1（B1/U-裁定 1）AC3「全仓」作用域 = tracked − `wiki/**` − `dist/**`

- **裁定**：措辞清扫与断言作用域 = `git ls-files` 枚举的追踪文件，排除路径以 `wiki/` 开头者与含 `/dist/`（或以 `dist/` 开头）者。Issue AC3 括注「dist 产物除外」自然包含于本作用域。
- **依据**：docs/AGENTS.md Authority L5「Historical `wiki/raw/` artifacts are evidence, not normative contracts」；wiki 内 25 个追踪历史产物（含 #306/#307/#308 全套报告与 ADR 论证记录）是该词的合法历史证据，且 #309 自身的 SA6/SA7/SA8 产物必然引用该词；改写历史证据 = 伪造审计轨迹。
- **备选（否决）**：字面全域读法——需改写 25 个 wiki 追踪文件，唯一合法授权来源是 Owner 评论（REST `comments: []`，不存在）；授权落定前不得执行。两种读法在 D1-D4、G10/G17、AC1/AC2/AC4 上无差异，仅差 25 个 wiki 文件。
- **断言实现**：Suite D 之 D5 按 `git ls-files -z` 枚举并排除后计数 needle（新测试文件自身用 `['三','锚位'].join('')` 构造 needle 防自命中）。

### D2（B2/U1）`docs/adr/0019:60` 最小措辞修订

- **裁定**：该行「与三锚位『紧随其后』语义一致）」→「与既有 M1/M2/M3 锚位的『紧随其后』语义一致）」。
- **依据**：SA6 B2 与 SA8 Required action 2 双推荐；该行是 ADR 0019 决策 1 内的比较性表述（把 M4 前导 `|` 锚位的「doc 紧邻 `|` 之前挂后继成员」与既有锚位的「紧随其后」语义对照），修订不改变决策内容；按 docs/AGENTS.md L10「explicitly amend」以本设计条目为显式登记（非静默改写、非静默放过）。
- **备选（否决）**：豁免白名单——需在 D5 中为该行开白名单，弱化「无残留」断言且留下唯一规范文档命中；同等成本下最小修订更干净。

### D3（B3/U2）G16 陈旧期望同票修复

- **裁定**：`tests/acceptance/vfsl_spec_acceptance.py` L321 期望标识 `AssetsDoc` → `ROOT`；L555 详情消息同步（`…AssetEntity/AssetsDoc/…` → `…AssetEntity/ROOT/…`）。
- **依据**：§10 fixture 已由 ROOT 约定票改为 `type ROOT = YMap<{…}>`（ADR 0003 决策 2；本设计实读 v1-spec L518 确认），检查器期望滞后产生预存在红（基线 20/21）；SA6 §11.5、SA8 Required action 3 均推荐同票修；修复后验收可直接判 22/22，无需为 G16 设特殊红绿口径。
- **备选（否决）**：登记为预存在缺陷不在本票修——则 #309 验收必须以「G10/G17 + Suite D」为主判并显式豁免 G16，检查器两入口长期一红一绿；操作性差且 SA8 已给出推荐路径。

### D4（B6/U3）Suite D 落点与形态

- **裁定**：新增 `packages/vfsl/test/spec-docs-anchor-m4-contract.test.ts`（vitest）。断言 = SA6 §12.2 逐字承接：D1（§5 四类锚位 + 20 needle 子规则事实链）、D2（§5 `vfsl` 块 ≥1、每块经 wrapper 规则 `parseVfsl`+`evaluate` 双 ok、≥1 块 memberDocs 非空、多行前导 `\|` 布局自跟随核对）、D3（指南 §7/§8 各自 `vfsl` 块执行 + **逐块** doc-`\|` 配对 ≥2 + 自跟随 memberDocs 核对——SA6 §12.2 冻结谓词原样承接，**不得弱化为按节聚合**；与 D8(b) 的 §7 旧块替换处置互为锁定，见该条「与 D3 逐块谓词的耦合」）、D3b（**钉住挂载目标句本身**：定位指南正文中含「必须紧邻」的句子（即 L204 挂载目标句），断言其含「联合成员」且四类齐全——不得退化为全文 needle 搜索，防 L154「联合成员必须全部是标量形…」既有字样造成伪绿；SA2 N4 吸收）、D4（检查表 M4 条目）、D5（措辞清零 + `git diff --check`）。
- **通用工具**：`repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')`；`readSection(file, startHeading, endHeading)`；`execBlock(block)` = 块内无 `type ROOT` 声明时前置 `type ROOT = {};\n`（显式 wrapper 规则——指南 §7 示例是片段，整块解析会 E310，SA6 §11.7 已排除该陷阱），随后 `parseVfsl` → `evaluate`，两者都必须 `ok`。
- **配对谓词的精确化（D2/D3 自跟随核对共用，防止实现走样）**：「`/** … */` 行」= trimStart 后以 `/**` 开头且以 `*/` 结尾的单行 doc；「下一非空行以 `\|` 开头」= 下一非空行 **trimStart 后**首字符为 `|`（规范/指南的推荐多行布局均缩进两格，严格 startswith 会使契约永不命中——谓词以 trim 后判定）；「doc 原文」= 该行去掉前缀 `/**` 与后缀 `*/` 后的逐字内容（与 parser 捕获的 memberDocs 值逐字相等，A1 观察：前后各留一个空格）。
- **入口事实**：`vitest.config.ts` `test.include = ['packages/*/test/**/*.test.ts', …]`；`scripts/ci-test-shard.mjs` 从磁盘枚举 `*.test.ts`（L25-50）——新文件自动入 CI 分片，无需登记（本设计实读两文件确认）。
- **备选（否决）**：把文档断言全部写进 Python 检查器——检查器未接 CI（B4），会把主判据放在无人运行的入口上；vitest 是真实 CI 入口。

### D5（U4 / SA8 Required action 4）CONTEXT.md 补「挂载锚位」术语

- **裁定**：在 `CONTEXT.md` Language 节「标记类型（marker types）」条目之后新增：

  > **挂载锚位（mount anchor）**:
  > 文档注释（`/** */`）挂靠的声明性节点位置，共四类：类型别名（M1，声明处）、属性（M2，对象字段处）、标记类型（M3，记号处）、联合成员（M4，前导 `|` 记号或首成员起始记号；ADR 0019）。挂载是纯文档性质：doc 进 IR/派生表/生成物/投影切片（发射位与界线见 ADR 0019 决策 6——`YPlainArray` 纯值子树与 `YXmlFragment` 不透明实参内无发射位），但不进校验与物化语义（ADR 0001）。
  > _Avoid_: 把 M4 成员 doc 当校验或物化规则的输入（无机器标签）；把「锚位」误解为 tokenizer 实现细节（它是 v1-spec §5 的规范概念）

- **依据**：docs/AGENTS.md L9「update `CONTEXT.md` when introducing or changing a domain term」——#309 使「四类锚位」首次进入规范正文（v1-spec §5），属术语口径变更；CONTEXT.md 已有语言级术语先例（标记类型 L49、判别联合 L115）。
- **备选（否决）**：不补条目——「锚位」一词此前仅在 ADR 正文/源码注释出现，#309 后成为规范正文的规范概念，不登记将使共享词汇表落后于规范文本，恰是本票要消除的那类漂移。
- **注意**：条目文本不得含「三锚位」字样（CONTEXT.md 在 D5 扫描作用域内）——上述文本已核。

### D6（设计补充，SA6 契约目标下的实现性缺口）exemplar 同步的完整范围

SA6 §12.4 exemplar 行只写「§4 挂载目标补『联合成员』」，但检查器修订后 exemplar 绿路径（`--spec` 入口 22/22）要求三件事，缺一即红：

1. **§4 补「联合成员」**（G10 need 13 项）；
2. **§4 同时覆盖 G17 的 9 个 needle 元组**（G17 无 spec/exemplar 之分，`run_checks` 无条件执行；仅补「联合成员」会让 exemplar 的 G17 9/9 红，SA6 §12.4「22/22 GREEN」的判定行无法达成——SA6 X5 只对 spec 验证过 G17，未对 exemplar 验证，本设计补全该推导）；
3. **附录 fixture 同步为现行 §10 fixture 文本**（G16 期望改为 `ROOT` 后，exemplar 现存 `type AssetsDoc = YXmlFragment<…>`（L144-160）无 `ROOT` 标识 → 红；且该形态在 ROOT 约定下本是 E311 拒绝形，作为「绿路径 fixture」不应继续示范）。

- **裁定**：exemplar §4 与附录 fixture 两处同步（目标文本见 D9 附）；fixture 直接采用现行 §10 fixture 逐字副本（X3 已证明该文本在 G1-G16 全绿，含六标记/ROOT/联合/可选/数组/Pattern/Record/JSDoc 构造覆盖）。
- **备选（否决）**：仅按 SA6 字面改 §4 一处——exemplar 两入口转红，违反「保持 `--spec` 绿路径」的契约目标本身。

### D7 v1-spec §5 修订（AC1 主体；目标文本冻结）

修订范围：`docs/vfsl/v1-spec.md` §5（L405-424 区域），三态表、忽略/捕获边界与 `@tag` 段不动。

**(a) 挂载规则段（替换 L405-409）**：

> **挂载规则（捕获的目标节点）**：文档注释是前导注释——挂载到紧随其后（中间仅
> 允许空白与忽略型注释）的**声明性节点**，四类锚位：**类型别名**（声明处）、**属性**
> （对象字段处）、**标记类型**（Marker 记号处）、**联合成员**（union 成员处，ADR-0019）。
> 连续多个文档注释按出现顺序全部挂载到同一后续节点。若直到模块末尾都没有可挂载
> 节点 → VFSL-E305（拒绝静默丢弃作者语义——单一真相源不容丢失）。
>
> **联合成员锚位（M4）子规则**：
>
> - 成员有前导 `|` 时（含首成员的前导 `|`），锚位是该 `|` 记号——doc 紧邻 `|`
>   之前，挂载到 `|` 之后的成员；
> - 首成员无前导 `|` 时，锚位是首成员起始记号——doc 紧邻成员起点之前，挂载到该
>   成员；
> - 连续多条 doc 按出现顺序全部挂载到同一成员（与上述既有规则同构）；
> - 单成员联合**坍缩为成员类型本身**（仅一个成员的联合在类型结构上等价于该成员
>   类型，不产生联合节点），成员 doc 因此无挂载目标：坍缩形态
>   （`type T = /** d */ "a";` 与 `type T = /** d */ | "a";`）维持 E305，与既有行为
>   逐字节一致（既有场景不变，不升格挂别名节点）；
> - `|` 与成员起始记号之间的 doc（「夹缝」doc，如 `"a" | /** d */ "b"`）不属联合
>   成员锚位：非标记成员 → 维持 E305（既有触发场景不变）；成员起始记号为标记名时
>   按标记类型锚位挂标记节点（既有行为）；
> - 标记锚位优先于联合成员锚位，同一 doc 不双挂：成员起始记号为标记名时（如
>   `type T = /** d */ YLeaf<"a"> | YLeaf<"b">;`）doc 挂标记节点，联合成员锚位不再
>   回收——这是既有合法文本的冻结语义；推论：「夹缝叠写」（一条 doc 按成员口径、
>   一条 doc 按载体口径）在标记成员上合法（两条 doc 各归各的锚位），在非标记成员
>   上第二条维持 E305——该不对称是「语义不改」的既定代价，在此显式注明。
>
> 单行与混合布局同样合法：`type T = /** 甲 */ "a" | "b";`（首成员锚位 = 成员起始
> 记号）、`type T = "a" /** 乙 */ | "b";`（doc 紧邻 `|` 之前 → 挂 `"b"`）。

**(b) 挂载示例（保留既有 7 条 fixture 表，表格之后追加）**：

> **联合成员挂载示例**（多行前导 `|` 布局，推荐写法）：
>
> ```vfsl
> /** 订单生命周期状态 */
> type Status =
>   /** 草稿：可继续编辑，未进入处理流 */
>   | "draft"
>   /** 已提交：进入处理流，只可追加备注 */
>   | "submitted"
>   /** 已归档：终态，只读 */
>   | "archived";
> ```
>
> 逐成员 doc 经 IR `memberDocs`、派生 schema 的 `memberDocs` 表（`<member N>` 键形）
> 与生成物 TSDoc 到达消费方（发射位与界线见 ADR-0019 决策 6——别名联合 / 别名
> 枚举 / 内联联合 / 内联枚举四个发射位；`YPlainArray` 纯值子树与 `YXmlFragment`
> 不透明实参内成员 doc 无发射位，派生表照常收集）；与别名/属性/标记锚位一致，
> 成员 doc 是纯文档性质（§5 `@tag` 条款；ADR-0001）。

**逐 needle 核对（D1 20 needle + G17 9 元组 + G10 13 项）**：

| 断言 | 命中点 |
|---|---|
| `四类` / `锚位`（G17-1） | 「四类锚位」 |
| `类型别名` `属性` `标记类型` `联合成员`（G10/D1） | 四类枚举句 |
| `前导`+`\|`+`锚位`（G17-3） | 子规则第 1 条 |
| `首成员`+`起始记号`（G17-4） | 子规则第 2 条 |
| `连续`+`同一成员`（G17-5） | 子规则第 3 条 |
| `坍缩`+`E305`（G17-6） | 子规则第 4 条 |
| `夹缝`+`E305`（G17-7） | 子规则第 5 条 |
| `标记`+`优先`+`不双挂`（G17-8） | 子规则第 6 条 |
| `既有`+`不变`（G17-9） | 第 4/5 条「既有场景不变 / 既有触发场景不变」 |
| G10 其余 9 项（`//` `/* */` `/** */` 忽略 原文 捕获 挂载 @tag 机器——13 项 − 四类枚举句已覆盖的类型别名/属性/标记/联合成员 4 项；iteration 2 按 SA2 N2 改正原「12 项」计数笔误，D9-2 冻结的 13 项 need 列表本身不变） | §5 既有文本保留（三态表/边界段/`@tag` 段不动） |

**行为一致性**：上述每条陈述逐条锚定 SA6 §12.1 冻结观察——A1（前导 `\|` 多行）、A2（首成员起点）、A3（`\|` 前夹缝挂后继）、A4（连续同挂）、B1/B2（坍缩 E305@(2,10) 两形态）、B3/B4（非标记夹缝 E305@(2,16)/(4,5)）、C1/C3/C5（M3 优先不双挂、无 memberDocs 键）、N5（无 M4 输入惰性）。无一句超出已实测行为（docs/AGENTS「文档不得虚构实现行为」）。

**只增不改合规（§8）**：修订为纯增（第四类锚位 + 子规则 + 示例），未收窄任何既有推导；E305 既有场景显式声明不变；无错误码变化。§5 示例块为 §5 首个 `vfsl` 块，G15（fixture 块在附录内）不受影响（附录块保留，X3 已证）。

### D8 schema-authoring-guide 修订（AC2 主体；目标文本冻结）

**(a) L204 挂载目标句**：

> JSDoc 必须紧邻类型别名、对象字段、标记类型或联合成员才能挂载：前三类挂声明处 / 字段处 / 记号处，联合成员 doc 紧邻前导 `|` 之前（挂其后成员）或首成员起点之前；`\|` 与成员之间的夹缝 doc 不挂非标记成员（E305），单成员联合坍缩同样 E305——这两处改用别名级 doc 表达。

**(b) §7 示例与写法（既有裸块替换，非增补——SA2-1 落实）**：既有 §7 Asset 示例块——指南 L158-162 的 `vfsl` 围栏块（围栏开行 L158 + 裸 `type Asset = | {…} | {…};` 声明 L159-161 + 围栏闭行 L162，零成员 doc）——由下述目标块**整体替换**，**不是**在其后增补第二个示例；前导说明句「在同步物化上下文中…」（L154）与「判别联合使用共同的字符串字面量字段…」（L156）保留不动，其后「联合对象的键空间…」（L164）句保留不动。**块数不变式：§7 修订前后 `vfsl` 围栏块数均为 1（1 → 1 替换）**。修订后 §7 在 L156 句与目标块之间新增一句写法说明，冻结替换内容：

> 每个变体的领域语义用逐成员 doc 表达——doc 写在前导 `|` 之前，挂载到 `|` 之后的成员：
>
> ```vfsl
> type Asset =
>   /** 位图资产：由 URL 定位，宽高为渲染基准 */
>   | { kind: "image"; url: string; width: number; height: number }
>   /** 富文本资产：正文为良构 XML 片段 */
>   | { kind: "text"; body: YXmlFragment<{ format: "rich-text" }> };
> ```

**与 D3 逐块谓词的耦合（验收契约保持）**：SA6 §12.2 D3 为**逐块**判定——「取 `### 7.` 与 `### 8.` 各自 `vfsl` 块，`execBlock` 成功；**每块内**『`/** … */` 行 + 下一非空行以 `\|` 开头』对 **≥2 个**，doc 原文（去 `/**`/`*/` 边界后逐字）出现在 `derived.memberDocs` 值中」。本设计**保持该谓词原样，显式否决「按节聚合」的弱化路径**：若把 (b) 误读为纯追加（旧块保留 + 新块追加，1 → 2），旧裸块 `execBlock` 可通过但 doc-`\|` 配对 = 0 < 2 → D3 红——正确修复是按本条替换旧块，而非弱化断言。替换落地后 §7 恰含一个带逐成员 doc 的 Asset 示例块（配对恰 2 个 ≥ 2），D3 绿、AC2「编写指南的枚举/联合示例使用逐成员 doc」口径无歧义。

**(c) §8 示例与写法**（替换 §8 块内的 Status 声明，其余字段示例不动；「L182-186」区间中的 L182 是围栏开行、其后闭围栏在 L187，替换对象实为块内 Status 声明 L183-186，围栏开闭行保留勿重复——SA2 N6 澄清）：

> 枚举字面量同理——逐字面量 doc 紧邻前导 `|` 之前：
>
> ```vfsl
> /** 订单生命周期状态 */
> type Status =
>   /** 草稿：可继续编辑，未进入处理流 */
>   | "draft"
>   /** 已提交：进入处理流，只可追加备注 */
>   | "submitted";
> ```

（§8 的 ROOT 示例块含 `type ROOT` 声明，D3 断言不加 wrapper 原样执行。）

**(d) 检查表新增条目**（插入 JSDoc 相关条目之后）：

> - [ ] 联合与枚举变体按需使用逐成员文档注释：doc 紧邻前导 `|` 之前（或首成员起点之前），连续多条同挂同一成员；`\|` 与成员之间的夹缝 doc 不挂非标记成员（E305）；单成员联合坍缩同样 E305，改用别名级 doc；

**可执行性**：§7 目标块（无 ROOT → wrapper 前置；为替换后 §7 的**唯一** `vfsl` 块）与 §8 目标块（自带 ROOT，Status 与 ROOT 同块）均经 X6 在现行实现下实测 `ok:true` 且 `memberDocs` 逐字在场（`Asset.<member 0/1>`、`Status.<member 0/1>`）；D3 为自跟随断言（期望值取自文档自身），doc 文案可在保持单行形态下微调而不破契约。D4 条目命中（`联合`✓`成员`✓`文档注释`✓）。

### D9 规格检查器与 exemplar 修订（O-3 义务；目标形态冻结）

`tests/acceptance/vfsl_spec_acceptance.py`：

1. **docstring L34**：「挂载目标: 类型别名 / 属性 / 标记类型」→「挂载目标: 类型别名 / 属性 / 标记类型 / 联合成员」；并在机器契约「注释规则」行后补一句：「§5 M4 子规则：四类锚位 / 前导 `|` 锚位 / 首成员起始记号 / 连续同一成员 / 坍缩 E305 / 夹缝 E305 / 标记优先不双挂 / 既有不变」（G17 的文档化）。
2. **G10 need 列表**（L477-478）：`need = ["//", "/* */", "/** */", "忽略", "原文", "捕获", "挂载", "类型别名", "属性", "标记", "联合成员", "@tag", "机器"]`（12→13 项）。
3. **新增 G17**（置于 G16 之后；结构与既有检查同族）：

   ```python
   # G17 §5 M4 挂载子规则（四类锚位 + 联合成员；issue #309）
   s5 = find_sec(lambda t: "注释" in t)
   G17_NEED = [
       ("四类", "锚位"), ("联合成员",), ("前导", "|", "锚位"),
       ("首成员", "起始记号"), ("连续", "同一成员"), ("坍缩", "E305"),
       ("夹缝", "E305"), ("标记", "优先", "不双挂"), ("既有", "不变"),
   ]
   if s5 is None:
       results.append(("G17", "§5 M4 挂载子规则", False, "缺少含「注释」的章节"))
   else:
       txt5 = join_sec(s5)
       miss = ["+".join(t) for t in G17_NEED if not all(k in txt5 for k in t)]
       results.append(("G17", "§5 M4 挂载子规则", not miss,
                       "缺失要素: " + ", ".join(miss) if miss else "四类锚位 + M4 子规则 9 项齐备"))
   ```

   判定总数 21 → 22（G1-G6 六项 + G7 六标记 + G8-G16 九项 + G17）。
4. **G16 期望修复**：L321 `["AssetId", "Audit", "AssetEntity", "AssetsDoc"]` → `["AssetId", "Audit", "AssetEntity", "ROOT"]`；L555 详情消息同步 `AssetsDoc`→`ROOT`。

`tests/acceptance/exemplar/spec-exemplar-v1.md`（D6 三处）：

1. §4 第二条 bullet 扩为：「`/** */` 原文捕获：注释内容逐字保留，挂载到相邻 IR 节点——四类锚位：类型别名处、属性处、标记类型处、联合成员处；不受标记语法干扰。」
2. §4 追加一条 bullet：「联合成员锚位：前导 `|` 锚位（doc 紧邻 `|` 之前挂其后成员）或首成员起始记号锚位；连续多条 doc 同挂同一成员；单成员坍缩维持 E305（既有不变）；`|` 夹缝 doc 不属联合成员锚位（非标记成员 E305，既有不变）；标记锚位优先、不双挂。」（命中 G17 全部 9 元组）
3. §8 附录 fixture 的 `vfsl` 块整体替换为现行 v1-spec §10 fixture 逐字文本（`type ROOT = YMap<{…}>` 形），其 doc 行「AssetsDoc：命名空间根文档…」随之为「ROOT：命名空间根文档，assets 键集受 AssetId 的 Pattern 约束」。

**修订后判定**：`python3 tests/acceptance/vfsl_spec_acceptance.py` → **22/22 GREEN**；`--spec tests/acceptance/exemplar/spec-exemplar-v1.md` → **22/22 GREEN**（G10/G17/G16 三者在 exemplar 上同时成立，依据 D6 推导 + X3 的 §10-fixture 构造覆盖证明）。

### D10 措辞清扫（AC3；14 处逐处替换，零行为语义）

替换纪律（两个模板）：(i) 描述**规范挂载规则集合**的注释 → 四类表述；(ii) 特指**既有 M1/M2/M3 三类**（claimDocs 调用点、ADR 0005 docs 三槽、合成模块覆盖面）→「M1/M2/M3 锚位」。两模板均消除连续字符串「三锚位」。

| # | 文件:行 | 现文（片段） | 替换为 |
|---|---|---|---|
| 1 | `docs/adr/0019-vfsl-union-member-docs.md:60` | 「与三锚位『紧随其后』语义一致）」 | 「与既有 M1/M2/M3 锚位的『紧随其后』语义一致）」（D2） |
| 2 | `packages/vfsl/src/parser.ts:174` | 「不触碰 claimDocs 与三锚位」 | 「不触碰 claimDocs 与既有 M1/M2/M3 锚位」 |
| 3 | `packages/vfsl/src/parser.ts:519` | 「docs 挂标记记号处，三锚位之一」 | 「docs 挂标记记号处，M1/M2/M3 锚位之一」 |
| 4 | `packages/vfsl/src/semantic.ts:5` | 「非声明性起点（M1/M2/M3 三锚位之外）」 | 「非声明性起点（M1/M2/M3 锚位与 M4 联合成员锚位之外）」（该注释同时修正对现行 E305 条件的过时描述——E305 已因 M4 缩小，语义注释层面与 `semantic.ts:76` 消息一致） |
| 5 | `packages/vfsl/src/ir.ts:59` | 「（#7 JSDoc 三锚位之一；无 doc 为空数组，」 | 「（#7 JSDoc M1/M2/M3 锚位之一；无 doc 为空数组，」 |
| 6 | `packages/vfsl/test/parse-vfsl-union-member-docs.test.ts:5` | 「v1-spec §5 现行『三锚位 + E305』文本由 ADR 0019 显式授权修订（#309 与实现同支落地）——本文件断言的是 ADR 决策面的目标行为，不是现文行为。」 | 「v1-spec §5 修订前的旧挂载文本（M4 之前仅 M1/M2/M3）由 ADR 0019 显式授权修订（#309 已随实现同支落地，§5 现为四类锚位正文）——本文件断言的是 ADR 决策面的行为。」 |
| 7 | `packages/vfsl/test/evaluate-derived-docs-audit.test.ts:59` | 「合成模块：三锚位全覆盖」 | 「合成模块：M1/M2/M3 锚位全覆盖」 |
| 8 | `packages/vfsl/test/parse-vfsl-cycle-detection.test.ts:11` | 「声明性节点（类型别名 / 属性 / 标记类型三锚位）」 | 「声明性节点（类型别名 / 属性 / 标记类型 / 联合成员四类锚位）」（该处转述 §5 规范规则，随 §5 四类化） |
| 9 | `packages/vfsl/test/evaluate-derived-docs-typecls.test.ts:70` | 「合成模块：三锚位全覆盖」 | 「合成模块：M1/M2/M3 锚位全覆盖」 |
| 10 | `packages/vfsl/test/evaluate-derived-docs-typecls.test.ts:119` | `describe('evaluate — 派生 schema 携带 docs（ADR 0005 §3 三锚位）', …)` | `describe('evaluate — 派生 schema 携带 docs（ADR 0005 §3 M1/M2/M3 锚位）', …)` |
| 11 | `domains/vfs3-assets/test/vfs3-assets-tsdoc.test.ts:3` | 「AC5 docs 三锚位 TSDoc 断言。」 | 「AC5 docs 锚位（别名/字段/标记位）TSDoc 断言。」 |
| 12 | 同文件:9 | 「别名/字段/标记位三锚位的 fixture JSDoc 全部出现在 TSDoc 注释上」 | 「别名/字段/标记位锚位的 fixture JSDoc 全部出现在 TSDoc 注释上」 |
| 13 | 同文件:70 | 「// AC5 — docs 三锚位」 | 「// AC5 — docs 锚位（别名/字段/标记位）」 |
| 14 | 同文件:126 | `describe('AC5 — docs 三锚位：fixture JSDoc 全部以 TSDoc 挂载到生成物对应声明', …)` | `describe('AC5 — docs 锚位（别名/字段/标记位）：fixture JSDoc 全部以 TSDoc 挂载到生成物对应声明', …)` |

**纪律保证**：#2-#5 为 `packages/vfsl/src` 仅注释改动（B5：token 级零语义差，建议实现票对改动文件做去注释 token 等价比对）；#6-#14 为测试注释与 describe 标题（vitest 报告文案，无断言/快照依赖标题——全仓无标题快照命中）；金样本常量（#6 文件 L33-36）**不在改动内**。新测试文件 `spec-docs-anchor-m4-contract.test.ts` 自身以 join 构造 needle 防自命中；v1-spec/指南/exemplar/CONTEXT/检查器的目标文本均不含「三锚位」字样（本设计已逐段核对）。

### 备选方案总览（未选择及原因）

| 方案 | 否决原因 |
|---|---|
| AC3 字面全域（改写 25 个 wiki 历史文件） | 需 Owner 评论授权（不存在）；伪造审计轨迹（D1） |
| ADR 0019:60 豁免白名单 | 唯一规范文档命中长期存在；D5 断言弱化（D2） |
| G16 预存在缺陷登记不修 | 检查器入口长期一红；验收口径复杂化（D3） |
| 文档断言全部入 Python 检查器 | 检查器未接 CI，主判据无真实执行入口（D4；B4 follow-up） |
| 不补 CONTEXT.md 术语 | 词汇表落后于规范正文，重演本票要消除的漂移（D5） |
| §5 修订采用与 needle 无关的自由行文 | D1/G17 是结构化机器契约，行文必须冻结到 needle 可命中形态；本设计已给出逐 needle 核对表（D7） |
| 指南示例引入非规范记号或新语法 | 违反只增不改与「文档不虚构行为」；X6 证明目标示例在现行实现下已合法 |

## 8. 接口、状态机与数据流

**接口变化（均为文档/检查器契约面，无生产 API/wire/持久化/状态机变化）**：

| 接口 | 变化 | 消费方 |
|---|---|---|
| v1-spec §5 规范文本 | 三类 → 四类锚位 + M4 子规则 + 示例块 | schema 作者、指南（链接权威）、检查器 G10/G17、Suite D D1/D2 |
| 指南 L204/§7/§8/检查表 | 挂载目标四类 + 逐成员示例 + M4 条目 | schema 作者（agent）、Suite D D3/D3b/D4 |
| 检查器机器契约 | G10 need 12→13；G17 新增（9 元组）；G16 期望 `ROOT`；判定 21→22 | 人工运行、exemplar 绿路径、（follow-up）CI |
| exemplar | §4 四类 + M4 摘要；附录 fixture 同步 §10 文本 | `--spec` 绿路径验证 |
| CONTEXT.md | 新增「挂载锚位」术语条目 | 全仓 agent 共享词汇 |
| 注释/标题措辞 | 14 处替换（3 处 src 注释 + 11 处测试注释/标题） | 源码读者；vitest 报告文案 |

**运行时数据流：零变化**。依据：`packages/*/src` 仅注释改动（B5 token 级零语义差）；E305 消息、IR、派生、投影、生成物、指纹全部冻结面由 Suite C（N1/N2/N6）回归承压。

**验证期数据流路线（新增，全部为只读验证路径）**：

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
|---|---|---|---|---|---|---|---|---|
| V1 spec 文本 → 检查器 | `python3 tests/acceptance/vfsl_spec_acceptance.py`（人工） | 无写入（纯读） | markdown 结构化解析（headings/sections/fenced_blocks/表格） | 内存 | G1-G17 判定 | 22 行 PASS/FAIL，exit 0/1 | exit 1 + 具名缺失要素；无副作用 | SA6 §12.4/§12.5 |
| V2 指南/规范 `vfsl` 块 → vitest | `pnpm test`（CI 分片自动发现新文件） | 无仓库写入 | fs 读 `docs/**` → wrapper 规则补 `type ROOT` → `parseVfsl` → `evaluate`（同步纯函数） | 内存 | derived.memberDocs / 文档正文 needle | D1-D5 用例红绿 | 断言失败即红，具名缺失；无 skip/fallback | SA6 §12.2 |
| V3 措辞扫描 | D5 用例 | 无写入 | `git ls-files -z` → 排除 wiki/dist → UTF-8 读 → needle 计数 | 进程内 | 计数 = 0 | 绿/红 | 非 UTF-8/二进制跳过（显式规则） | SA6 §12.2 D5① |
| V4 diff 卫生 | D5 用例内 `spawnSync('git', ['diff','--check'])` | 无 | git 子进程 | 进程间 | exit 0 且 stdout 空 | 绿/红 | 非零即红 | SA6 §12.2 D5② |

四条路线均为只读验证，失败 loud（具名缺失/断言红），无清理责任。

## 9. 错误、恢复、并发与幂等

- **失败语义（验证面）**：检查器 exit 1 + 每项具名「缺失要素: …」；Suite D 断言失败给出缺失 needle/块数/计数——红因单一可归因（X4 已证：仅补「联合成员」类文本差即可精确转绿/转红）。
- **文档错误面不变**：E305 触发条件、消息前缀、行列锚全部冻结；§5 新文本是对既有实现行为的描述，不新增错误路径。示例块均为现行实现 `ok:true` 文本（A1/X6）。
- **恢复/重试**：不适用（无运行时服务）；文档修订可整体 `git revert` 回三锚位文本，检查器/测试随同回滚（红灯即缺口信号，无数据迁移、无持久化兼容负担）。
- **并发/幂等**：解析与求值为同步纯函数（SA6 §7：探针两次输出 sha256 相等）；文档编辑幂等；检查器与测试无并发面。
- **正常路径不变量缺失时 fail loud**：D2/D3 的 execBlock 要求 `parseVfsl` 与 `evaluate` 双 `ok`，任一失败即测试红（无吞错、无 skip/only/env override）；D5 计数必须恰为 0。

## 10. 调用方影响矩阵

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| `tests/acceptance/vfsl_spec_acceptance.py` 的两入口（默认 spec / `--spec` exemplar） | 21 项判定；默认入口 G16 预存在红（20/21）；exemplar 21/21 绿 | 22 项判定；两入口均须 22/22 绿 | 检查器四处修订（D9）+ exemplar 两处同步（D6） | 检查器 L560-576（main/--spec 路由）；SA6 §4 基线 |
| exemplar（绿路径 fixture） | §4 三处挂载目标；附录 fixture `AssetsDoc`（YXmlFragment 形） | §4 四类 + M4 摘要 bullet；附录 fixture = §10 逐字副本 | 同上 | exemplar L99-101/L144-160 实读 |
| `pnpm test` / CI 分片器 | 枚举 `packages/*/test/**/*.test.ts` | 自动发现新增 `spec-docs-anchor-m4-contract.test.ts`，无需登记 | 无（新文件放置路径即接入） | `vitest.config.ts` include；`scripts/ci-test-shard.mjs` L25-50 磁盘枚举 |
| schema 作者（agent）读指南 | L204 三锚位句；§7 唯一块为裸 Asset（L158-162）、§8 Status 无成员 doc；检查表无 M4 | 四类挂载目标 + 逐成员写法与示例（**§7 裸块替换为目标块，块数 1→1，非增补**）+ 检查表条目 | 指南四处修订（D8） | 指南 L154-164/L182-202/L204/L273-287 |
| v1-spec §5 读者（含 ADR 0019 交叉引用、检查器 G10/G17、Suite D） | 三类规则，与实现矛盾 | 四类 + 子规则 + 示例，逐条与实现一致 | §5 修订（D7） | v1-spec L405-424 |
| 全仓 agent 共享词汇（CONTEXT.md） | 无锚位条目 | 「挂载锚位」四类条目 | CONTEXT.md 一条新增（D5） | CONTEXT.md L49/L115 先例 |
| 9 个注释残留文件的读者/运行器 | 「三锚位」措辞（其中 `semantic.ts:5` 注释对 E305 条件的描述已过时） | M1/M2/M3 或四类表述；`semantic.ts:5` 注释与 `:76` 消息口径一致 | 14 处替换（D10），断言/常量零改动 | D10 表；Suite C 回归 |
| E305 消息的消费方（测试断言） | 以前缀为锚（N3）；正文四类枚举为现行行为观察 | 不变（本票零消息改动） | 无 | `semantic.ts:76`；SA6 §6 N3 |
| 检查器潜在 CI 接入（未来） | 无引用（全仓唯一引用在 exemplar 头注） | 不在本票接入；follow-up 登记 | 无 | package.json/`.github` grep 无命中（实读） |

## 11. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
|---|---|---|
| `docs/vfsl/v1-spec.md` | §5 挂载规则段四类化 + M4 子规则 + 单行/混合布局句 + 联合成员示例块（L405-424 区域；三态表/边界/`@tag` 段不动） | AC1；D7；G10/G17/D1/D2 对象 |
| `docs/vfsl/schema-authoring-guide.md` | L204 挂载目标句；**§7 既有示例块替换（L158-162 裸 Asset 块 → 带逐成员 doc 目标块，`vfsl` 块数 1→1，非增补）**；§8 块内 Status 声明替换（L183-186）+ 逐成员 doc 写法；检查表 M4 条目 | AC2；D8；D3/D3b/D4 对象 |
| `tests/acceptance/vfsl_spec_acceptance.py` | docstring L34（+G17 契约句）；G10 need +「联合成员」；新增 G17；G16 L321/L555 `AssetsDoc→ROOT` | O-3 义务；D9；判定 22/22 |
| `tests/acceptance/exemplar/spec-exemplar-v1.md` | §4 四类 + M4 摘要 bullet；附录 fixture 替换为现行 §10 fixture 文本 | 保持 `--spec` 绿路径（D6） |
| `packages/vfsl/test/spec-docs-anchor-m4-contract.test.ts` | **新增**（Suite D：D1/D2/D3/D3b/D4/D5 + 通用工具） | CI-wired 主判据（D4；SA6 §12.2） |
| `docs/adr/0019-vfsl-union-member-docs.md` | L60 一处比较性措辞（「三锚位」→「既有 M1/M2/M3 锚位」） | B2 显式修订路径（D2） |
| `packages/vfsl/src/parser.ts` | 仅注释：L174、L519 | AC3；B5（D10 #2/#3） |
| `packages/vfsl/src/semantic.ts` | 仅注释：L5（E305 条件描述同步四类） | AC3；B5（D10 #4） |
| `packages/vfsl/src/ir.ts` | 仅注释：L59 | AC3；B5（D10 #5） |
| `packages/vfsl/test/parse-vfsl-union-member-docs.test.ts` | 仅文件头注释 L5-7 区域措辞（金样本常量 L33-36 禁改） | AC3（D10 #6） |
| `packages/vfsl/test/evaluate-derived-docs-audit.test.ts` | 仅注释 L59 | AC3（D10 #7） |
| `packages/vfsl/test/parse-vfsl-cycle-detection.test.ts` | 仅注释 L11（四类化，随 §5） | AC3（D10 #8） |
| `packages/vfsl/test/evaluate-derived-docs-typecls.test.ts` | 注释 L70 + describe 标题 L119 | AC3（D10 #9/#10） |
| `domains/vfs3-assets/test/vfs3-assets-tsdoc.test.ts` | 注释 L3/L9/L70 + describe 标题 L126 | AC3（D10 #11-#14） |
| `CONTEXT.md` | 「标记类型」条目后新增「挂载锚位（mount anchor）」术语条目 | docs/AGENTS L9 术语规则（D5；SA8 action 4） |

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `wiki/**`（含 25 个含该词的历史产物与本票 SA6/SA7/SA8 产物） | AC3 字面读法的对象 | 历史证据非规范（docs/AGENTS Authority）；N8 零 diff 控制；字面读法无 Owner 授权（D1） |
| `packages/vfsl/src/**` 中 parser/semantic/ir 三文件之外的任何文件；三文件内的非注释行 | 生产实现 | B5 零运行时语义；冻结面（指纹/错误面/IR） |
| `packages/vfsl-codegen/**` | #307 已交付面 | 越界即破坏四发射位冻结决策（SA8 #6） |
| `packages/vfsl/test/parse-vfsl-union-member-docs.test.ts` 的金样本常量（IR sha256/指纹） | 回归锚 | 改常量即伪绿（SA8 冻结面；N2） |
| `domains/*/generated.ts`、`domains/*/schema.vfsl` | 生成物与领域源 | N6 零 diff；非本票对象 |
| `docs/adr/0001/0003/0005/0016/0017` 等其余 ADR | 被 0019 显式修订过的决策文本 | SA8 §6：无 evolution-required；ADR 0019 正文已承载修订 |
| `docs/vfsl/` 之外的其他 docs（integration/phases/protocols 等） | 无三锚位命中、无契约变更 | docs/AGENTS「行为变更才同步」——本票行为零变更 |
| `tests/acceptance/` 两个文件之外的验收资产 | — | 范围外 |
| `.github/workflows/**`、`package.json`（scripts） | 检查器 CI 接入 | B4 follow-up，AC 未要求（避免范围膨胀） |
| `README.md` / `README_zh.md` / `REPORT.md` | grep 无三锚位/三类挂载表述命中 | 无需改动（本设计实读 grep 确认） |

## 12. 验收与验证映射

SA1 不编写/运行测试；下表为后续所需证据（SA6 §12 可直接转写；运行入口 SA6 §12.5）。

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
|---|---|---|---|
| AC1 §5 与实现逐条一致 | SA6 §5.2 六矛盾 + §12.1 冻结观察；现行全红 | Suite D D1（20 needle）+ D2（示例块执行）；检查器 G17（9 元组）+ G10（13 项） | D1/D2、G10/G17 全绿；示例块 `parseVfsl`+`evaluate` 双 ok 且 memberDocs 非空 |
| AC1 E305 既有场景不变表述 | SA6 N3/B1-B4/C4 全绿 | Suite C 既有四套件不改动重跑（68 tests） | 同数同绿；E305@(2,10)/(2,16)/(4,5)/(2,12) 维持；前缀冻结 |
| AC2 指南逐成员示例与检查表 | SA6 §5.1/§5.3 D3/D3b/D4 红 | Suite D D3（§7/§8 块执行 + 自跟随 memberDocs——**逐块谓词保持，不弱化为按节聚合**）、D3b、D4 | 全绿；**§7 恰含一个带逐成员 doc 的 Asset 块（旧裸块已替换，1→1）**；`Asset.<member 0/1>`、`Status.<member 0/1>` 逐字在场（X6 已预证） |
| AC3 措辞清零 | 14 处 / 9 文件（三方一致清单） | Suite D D5①（tracked − wiki − dist 计数） | 计数 = 0 |
| AC4 diff 卫生 | 基线 `git diff --check` exit 0 | Suite D D5②（spawnSync） | exit 0 且 stdout 空 |
| O-3 检查器同支同步 | docstring/G10/G16 现行三锚位机器契约 | `python3 tests/acceptance/vfsl_spec_acceptance.py` 与 `--spec …spec-exemplar-v1.md` | 双入口 22/22 GREEN（含 G16 修复后 exemplar 绿，D6） |
| N1 实现回归 | 68 tests 绿 | 同命令重跑 | 4 files / 68 tests 绿、Type Errors 无 |
| N2/N6 金样本与生成物 | 常量在场、`generate --check` exit 0 | `pnpm generate --check` + `git diff --name-only` | exit 0；`domains/*/generated.ts` 零条目 |
| N7 检查器其余项不受影响 | X1-X4 | 检查器全量运行 | G1-G16 除 G10（转绿）/G16（修复）外判定不变 |
| N8 wiki 零 diff | 基线干净 | `git diff --name-only` 过滤 `wiki/` | 零条目 |
| B5 注释-only | — | （建议）对 3 个 src 改动文件做去注释 token 等价比对 + `pnpm typecheck` | token 序列等价；typecheck exit 0 |
| 运行入口 | SA6 §14 | `NODE_OPTIONS=--conditions=nomicore-source pnpm vitest run packages/vfsl/test/spec-docs-anchor-m4-contract.test.ts`；`pnpm test`；`pnpm typecheck && pnpm generate --check && git diff --check`；两个 python 入口 | 全绿/exit 0 |

**敏感度（走偏先红在哪条，SA6 §12.6 承接）**：§5 漏子规则 → D1+G10+G17；§5 无示例块 → D2；指南示例未加成员 doc，**或 §7 旧裸块被保留而新块追加（1→2，旧块 0 配对）** → D3（逐块谓词）；检查表漏 M4 → D4；任何「三锚位」残留/whitespace → D5；为落地而改生产行为 → Suite C（N1/N2/N6）；改写 wiki → N8。

## 13. 风险、回滚与残余问题

| 风险 | 等级 | 缓解 |
|---|---|---|
| G17/D1 needle 与行文强耦合（措辞微调即红） | 中 | D7/D9 冻结目标文本 + 逐 needle 核对表；检查器与 Suite D 双通道同源 needle，修文档时两处同红即定位 |
| exemplar 同步不完整（只改 §4 漏 fixture 或漏 G17 元组）→ `--spec` 红 | 中 | D6 三处清单固化于 ALLOW；验收判 22/22 双入口 |
| 注释编辑误触代码 token（B5 违例） | 低 | 注释-only 纪律 + Suite C 回归 + （建议）token 等价比对 |
| 新测试文件自命中 needle | 低 | join 构造 needle（SA6 §12.2 D5 已载）；目标文档文本均不含该词 |
| 文档虚构未实现行为 | 低 | 所有行为性陈述逐条锚定 §12.1 冻结观察与 X6；ADR 0019 决策为上限 |
| 指南 §7 示例为片段（无 ROOT）整块解析 E310 | 低 | execBlock 显式 wrapper 规则（SA6 §11.7 排除项） |
| 实现者把 D8(b) 读作纯追加（§7 旧裸块保留 + 新块追加，1→2）→ D3 红 + AC2 口径歧义，并诱发「弱化 D3 为按节聚合」的测试弱化路径（SA2-1 事由） | 低（iteration 2 修订后） | D8(b) 显式「替换而非增补」处置 + 块数不变式（1→1）+ D3 逐块谓词保持冻结（D4/D8(b)/§12 三处锁死弱化路径）+ §15 复查清单第 6 项落地核对 |
| 时序：#309 未在 PR #305 收官合并前落地 | 中 | SA8 Required action 5；分支 `mabf/issue-309` 即 Parent 收官门槛的一部分；总控路由注意 |

**回滚**：单分支文档+注释+测试改动，`git revert` 即回三锚位文本；Suite D/G10/G17 随回滚转红（红灯即缺口信号，正是契约设计的可观察行为）；无数据、无持久化、无兼容负担。

**残余问题 / follow-up（均非本票必要条件）**：

1. **B4**：把 `python3 tests/acceptance/vfsl_spec_acceptance.py` 接入 CI/package scripts（当前全仓唯一引用在 exemplar 头注；AC 未要求，防范围膨胀，登记 follow-up）。
2. 检查器权重表 `.github/ci/test-durations.json` 不含新测试文件——分片器按全表平均权重装箱（脚本注释明示），建议下次 main 上刷新权重。
3. 「`|` 夹缝与 M3 优先的不对称」在 v1 内是既定代价（ADR 0019 决策 3）；若未来方言版本寻求对称化，属 §8 演进新决策，另立 ADR。
4. **残余悬空「§7.3」引用（iteration 1 登记，本票范围外——防静默放过）**：`docs/adr/0019:64`（「单成员联合按 §7.3 坍缩」）与 `packages/vfsl/src/parser.ts:347`（注释「单成员联合坍缩（§7.3）」）仍携带该历史引用，其指涉对象为特性伴随设计文档（非规范 wiki 产物；SA8 设计复审 #13 已核实为悬空）。不纳入本票的理由：(a) ADR 0019 的登记修订路径冻结为仅 L60（D2 / SA8 行动 4 与冻结面「ADR/CONTEXT 仅限登记路径」），扩至 L64 须另走显式修订决策；(b) `parser.ts:347` 不在「三锚位」14 处清单内（AC3 作用域），且 vfsl 包内「§7.3」式历史引用是多任务惯例（另见 `parser.ts:417`、`ir.ts:7`，各指涉不同设计文档），单点修补无系统收益、反扩 ALLOW LIST。#309 落地后，坍缩规则的规范表述以 v1-spec §5 自含陈述为权威（本轮 D7(a) 修订）；历史引用清扫如需进行，另立文档卫生票由 Owner 裁决。

## 14. 评审修订映射

本设计历经两轮评审修订，均为原位更新，全文只描述当前一致设计：

- **iteration 1 输入** = `wiki/raw/task_issue-309_design_conflict_report.md`（SA8 设计后复审 iteration 1，verdict = **reject**）——修订结果已经该报告 iteration 2 recheck 确认（verdict = **clear**，2026-09-11）。
- **iteration 2 输入** = `wiki/raw/task_issue-309_sa2_review.md`（SA2 设计攻击评审，verdict = **reject**）——本轮落实其唯一 MAJOR（SA2-1）并吸收非阻断观察 N1/N2/N3/N4/N6；N5 维持既有登记。本轮文件范围（ALLOW/DENY 路径集合）与冻结面**零变化**——仅指南行的预期改动描述被落字显式化。

### iteration 2（SA2 设计攻击评审）

| Finding | 修订位置 | 处理结果 |
|---|---|---|
| **SA2-1（MAJOR，reject 事由）**：指南 §7 既有示例块（L158-162，裸 `type Asset = \| {…} \| {…};`，零 doc）的处置未落字——D8(b) 仅写「在判别联合说明后」，对照 D7(b)「保留既有 7 条 fixture 表」与 D8(c)「替换 L182-186」均显式声明保留/替换，唯独 §7 缺失；按字面追加落地则旧块 doc-`\|` 配对 = 0 < 2 使 Suite D D3 红、AC2「枚举/联合示例使用逐成员 doc」口径两可，并留下「弱化 D3 为按节聚合」的测试弱化路径 | §7-D8(b)（处置句 + 块数不变式 +「与 D3 逐块谓词的耦合」段）、§1-G2、§2.2 指南行、§7-D4（D3 逐块承接）、§10 指南读者行、§11 ALLOW 指南行、§12 AC2 行与敏感度行、§13 新增风险行、§15 复查清单第 6 项 | **已修订——采用 SA2 二选一中的显式替换路径**：D8(b) 显式声明既有 §7 Asset 示例块（L158-162，含围栏开闭行）由带逐成员 doc 的目标块**整体替换而非增补**，§7 修订后恰含该一个 `vfsl` 围栏块（块数 1→1）；「判别联合使用共同的字符串字面量字段…」说明句（L156）保留不动，L154/L164 前后句不动。**验收契约逐块文档要求原样保持**：SA6 §12.2 D3 冻结谓词（每块内 doc-`\|` 配对 ≥2 + 自跟随 memberDocs）未弱化为按节聚合，弱化路径在 D4/D8(b)/§12 三处显式否决。§11 ALLOW 指南行预期改动同步落字「§7 既有示例块替换（L158-162）」。达成 SA2 验收判词：修订后 D8(b) 对「L158-162 旧块去向」唯一可读；落地后指南 §7 恰含一个带逐成员 doc 的 Asset 示例块，Suite D D3 绿、AC2 无歧义 |
| N1（非阻断）：D5 CONTEXT 新条目「doc 进 IR/派生表/生成物/投影切片」为无例外概括，盖过 ADR 0019 决策 6 显式例外（`YPlainArray` 纯值子树与 `YXmlFragment` 不透明实参内成员 doc 无发射位） | §7-D5 冻结条目文本 | **已吸收**：补半句「（发射位与界线见 ADR 0019 决策 6——`YPlainArray` 纯值子树与 `YXmlFragment` 不透明实参内无发射位）」，与 D7(b) 已有的同口径限定一致；条目其余文本不动（CONTEXT 侧 ADR 引用维持既有空格式——SA2 N3 明示仅 v1-spec 节内一致性问题，且 CONTEXT.md 现存两种风格混用，不新增改写面） |
| N2（非阻断）：D7 逐 needle 核对表末行「G10 其余 12 项」算术笔误（实列 9 项 = 13 − 4） | §7-D7 逐 needle 核对表末行 | **已改正**：12 → 9；D9-2 冻结的 13 项 need 列表本身不变，无契约影响 |
| N3（非阻断）：v1-spec §5 既有「ADR-0001」连字符风格（L22/L411）与冻结新文本「ADR 0019 / ADR 0001」空格式将在同一节内混排 | §7-D7(a)/(b) 冻结目标文本 | **已吸收**：冻结 §5 新文本内 ADR 引用改为「ADR-0019」「ADR-0001」（对齐 §5 既有 L411 的节内风格）；D1 20 needle 与 G17 9 元组均不含 ADR 引用串，needle 命中零影响；指南与 CONTEXT 冻结文本引用风格不动 |
| N4（非阻断）：D3b 前半「指南正文含『联合成员』」今日已真（L154 载体约束句），判据载荷全在后半，防弱断言伪绿 | §7-D4 D3b 断言描述 | **已吸收**：D3b 钉住指南正文中含「必须紧邻」的挂载目标句本身（即 L204 句），断言其含「联合成员」且四类齐全，不做全文 needle 搜索 |
| N5（非阻断）：Python 检查器与 Suite D 双通道 needle 同源维护 | §13 风险 1 | **维持登记**：双通道判据同源（D1 20 needle ⊇ G17 9 元组），任一端调整须两端同步；B4 follow-up 负责未来 CI 连接，本轮无新增改动 |
| N6（非阻断）：D8(c)「替换 L182-186」中 L182 为围栏开行，替换对象实为块内 L183-186，防落地误删围栏 | §7-D8(c) 标题括注 | **已吸收**：显式澄清替换对象为 §8 块内 Status 声明 L183-186，围栏开闭行（L182/L187）保留勿重复 |

### iteration 1（SA8 设计后复审；已经 iteration 2 recheck 确认 clear）

| Finding | 修订位置 | 处理结果 |
|---|---|---|
| §3 #13 / §8 行动 1（**阻塞，reject 事由**）：D7(a) 冻结目标文本「单成员联合按 §7.3 坍缩」为悬空引用——v1-spec §7 是「信封形状」且无任何小节、全篇「坍缩」0 命中；原指涉对象为非规范 wiki 设计产物；按目标文本冻结原样落地将违反 docs/AGENTS.md「Link to the authoritative source」/「Check links and referenced filenames」 | §7-D7(a) 子规则第 4 条 | **已修订**：删除裸「§7.3」引用，改为行内自含规范陈述（「单成员联合**坍缩为成员类型本身**…不产生联合节点」），不引用任何章节号或 wiki 产物；语义与 ADR 0019 决策 2 及 SA6 §12.1 B1/B2 冻结观察逐条一致。recheck 确认：全部冻结目标文本「7.3」0 命中，G17-6/G17-9 命中不受影响 |
| §8 行动 2（advisory）：D7(b) 尾段概括盖过 ADR 0019 决策 6 的显式例外 | §7-D7(b) 尾段 | **已修订**：补发射位与界线限定（四个发射位 + 两处无发射位例外；iteration 2 按 N3 将该句 ADR 引用对齐为「ADR-0019 决策 6」）。recheck 确认与 ADR 0019 L106-130 逐字对齐 |
| §8 行动 3（advisory）：测试内直接 `readFileSync` 的先例引用不精确 | §2.3、§6 表 | **已修订**：直接读先例改为 `packages/vfsl/test/compile-schema-envelope.test.ts`（L45/L558，recheck 实读在场）；`schemasource-seam.test.ts` 如实标注为接缝测试 |
| §8 行动 4（登记路径确认，非修订项）/ 行动 5（复查清单增项） | §7-D2/D3/D5、§15 | 维持前置门禁推荐路径零改动；复查清单第 5 项（悬空引用核对）已入 §15 |
| （设计补充登记）残余悬空「§7.3」引用存在于 ADR 0019 L64 与 `parser.ts:347` | §13 follow-up 4 | 不纳入本票（ADR 登记路径冻结为仅 L60；`parser.ts:347` 不在 AC3 清单）——显式登记防静默，留待 Owner 另立文档卫生票；recheck 确认该处置与仓库事实一致 |

修订后预期：SA2 对修订后 D8(b) 复审由 reject 转 clear（其 §13 验收判词——旧块去向唯一可读、§7 恰一块、D3 绿、AC2 无歧义）；本轮修订不触任何 ADR、冻结面、文件范围边界或验收入口（SA2 §15 同判——指南 §7 块替换落在既有 ALLOW 指南行与 SA8 已裁决的 AC2/O-3 义务范围内）。

## 15. 是否需要设计后 ADR 冲突复查

**需要（`requiresConflictRecheck = true`）**。理由（承接两份 SA8 产物 §10——设计后复审明示「修订后需复审」+ 实现后逐项核对——并按其 Required actions 固化复查清单）：

1. 被审对象中**规范正文修订（v1-spec §5 / 指南 / exemplar）、检查器机器契约扩展（G10/G17/G16）与 9 个源/测文件的措辞改动在设计时尚未实现**——复查必须核对实际 diff 与本设计及 SA8 门禁一致；
2. 触碰 ADR 0019 正文（L60 显式登记的非语义修订路径）与 CONTEXT.md（术语新增）——须核对改动不越登记路径（ADR 除 L60 外零改动、CONTEXT 仅一条新增）；
3. 冻结面核对：`wiki/**` 零 diff；`packages/*/src` 仅注释改动（建议去注释 token 等价比对）；金样本常量未动；E305 面/IR/派生/生成物逐字节不变（Suite C 全绿）；检查器改动限于 docstring/G10 need/G17 新增/G16 期望，不弱化 G1-G16 其余项；
4. exemplar 同步保持 `--spec` 绿路径 22/22。
5. **修订文本悬空引用核对（iteration 1 新增）**：落地的 v1-spec §5 / 指南 / exemplar / CONTEXT 目标文本不得携带悬空章节引用——不含「§7.3」及任何指向不存在小节或非规范 wiki 产物的引用（docs/AGENTS.md「Link to the authoritative source」/「Check links and referenced filenames」）；§5 内的 ADR 引用（联合成员锚位、发射位与界线）指向 `docs/adr/0019` 真实决策条目（决策 1/2/6）。
6. **指南 §7 块替换落地核对（iteration 2 新增，SA2-1 配套）**：指南 diff 呈现 §7 `vfsl` 围栏块 **1→1**（L158-162 旧裸块删除、带逐成员 doc 的目标块在场），不得 1→2；Suite D D3 保持 SA6 §12.2 冻结的逐块谓词形态，不得被弱化为按节聚合（SA2 §7-S3/E1 的实现纪律同判：红即修复文档，不软化断言）。

本票无公共 API、wire、schema、持久化或状态机变更（B5 零运行时语义），复查范围为规范文本面、检查器机器契约面与上述冻结面。iteration 1 修订已经 SA8 iteration 2 recheck 确认（reject → clear）；本轮 iteration 2 修订（SA2-1 落实与非阻断观察 N1/N2/N3/N4/N6 吸收）按 SA2 §15 判词不触任何 ADR、冻结面、文件范围边界或验收入口，**不新增 ADR 冲突面**——指南 §7 块替换落在既有 ALLOW 指南行与 SA8 已裁决的 AC2/O-3 义务内；`requiresConflictRecheck = true` 维持系承接两份 SA8 产物的实现后复查义务（规范正文与机器契约在设计时尚未实现），非本轮修订触发。

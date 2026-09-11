# SA8 冲突门禁报告 — issue #309（v1-spec §5 与编写指南落地 M4 挂载锚位）

- Dispatch：`sa-f1408f90-e984-4905-8472-ed0955cce331`（mabf-sa8 / conflict-gate / iteration 0）
- 证据基线：worktree `/home/wangjian/nomicore-fix-issue-309`，分支 `mabf/issue-309`，HEAD `bbb93fbda3100b2da2a007a228af777cdc56d282`（#306/#307/#308 已合入，实测核实）
- 本报告为 SA8 固定产物；SA8 未修改任何被审对象、决策文档、规范文档或代码，未运行测试。

## 1. Reviewed subject

**task（前置门禁）**——被审对象为 task brief `wiki/raw/task_issue-309.md`（What to build + 4 条 AC）与**已接受的 SA6 验收契约** `wiki/raw/task_issue-309_sa6_contract.md`（作为 #309 的规格/验收承接文本，含其 §12 可执行契约、§12.8 边界裁定 B1–B6 与开放点 U1–U5）。design / implementation 产物尚不存在（SA6 契约 §1 已如实登记缺失）。

## 2. Inputs and decision set

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-309.md` | Host 固定 brief（未跟踪）；需求全集 = What to build + AC1–AC4 |
| `wiki/raw/task_issue-309_sa6_contract.md` | 已接受的 SA6 验收契约（本门禁主审对象） |
| `docs/adr/0001–0019`（17 份，无 0013/0015） | 全部 accepted；无整体 superseded；0003/0016 的相关条款由 0019 显式修订（决策文本自述，见各 Consequences/修订节） |
| `CONTEXT.md` | 共享词汇表；无锚位/挂载/联合成员条目（详见 relevant_decisions §5） |
| `docs/vfsl/v1-spec.md`、`docs/vfsl/schema-authoring-guide.md` | 语言规范（#309 修订对象）；§4 前缀冻结、§8 只增不改为规范级约束 |
| `docs/AGENTS.md`、`packages/vfsl/AGENTS.md` | 模块决策收录（docs 面与 vfsl 包契约边界） |
| `tests/acceptance/vfsl_spec_acceptance.py` + `tests/acceptance/exemplar/spec-exemplar-v1.md` | 规格检查器（issue #4 机制）与其绿路径 fixture——被审契约要求同支更新 |
| `wiki/raw/task_issue-306_design_conflict_report.md` O-3/O-5、C-1/C-5 | 前置门禁已登记约束（wiki 证据；权威根 = ADR 0019 Consequences + v1-spec 规范性，非 wiki 自身） |
| Issue #309 REST | `comments: []`、`state: OPEN`——**无 Owner 评论，无 owner-comment 约束，亦无可用 override 来源** |

**SA8 独立复核（不改写 SA6 结论，仅验证其事实基线）**：全仓「三锚位」= 14 处 / 9 个 tracked 文件（排除 `wiki/**`、`dist/`），逐行号与 SA6 §5.4 一致（含 `docs/adr/0019:60`）；wiki 内另有 25 个 tracked 历史产物命中；v1-spec `AssetsDoc` 0 命中、§10 fixture 为 `type ROOT = YMap<…>`；检查器 docstring/G10 need（12 项）/G16 L321 `AssetsDoc` 期望与 SA6 引用逐字一致；指南 L204/§7(L152)/§8(L166)/检查表(L273) 现状与 SA6 §5.1 一致；v1-spec §4 L277–280 确认错误前缀为规格冻结项；`scripts/ci-test-shard.mjs` 确认从磁盘枚举测试文件。SA6 契约的事实陈述未发现失真。

## 3. Decision analysis

| # | Decision | Clause | Subject behavior（SA6 契约中的对应行为） | Classification | Evidence | Required action |
|---|---|---|---|---|---|---|
| 1 | ADR 0019 决策 1 | `docs/adr/0019-vfsl-union-member-docs.md` L33–60（M4 锚位规则：前导 `\|` 锚位、首成员起点锚位、连续 doc 同挂、`\|` 夹缝不属 M4） | D1（§5 四类锚位 + 子规则事实链 needle）+ G17 9 项 + A1–A4 冻结观察逐条承接四条子规则 | **implements-existing-decision** | ADR 0019 L33–60；sa6_contract §12.1/§12.2 D1/§12.4 G17；v1-spec L405–409（现行三类文本） | 落地时按 D1/G17 逐项核对（实现票） |
| 2 | ADR 0019 决策 2 | L62–67（单成员坍缩维持 E305，「与现行行为逐字节一致」，不升格挂别名） | B1/B2 冻结观察（E305@(2,10) 两形态）+ D1 子规则链「坍缩+E305」+ G17 第 6 项 | **implements-existing-decision** | ADR 0019 L62–67；sa6_contract §12.1 B1/B2、§5.3 | 落地核对（AC1 明确要求「E305 既有场景不变」表述在场） |
| 3 | ADR 0019 决策 3 | L69–76（M3 优先不双挂是冻结约束；夹缝不对称「spec 修订中显式注明」） | C1/C3/C5 冻结观察 + D1 子规则链「夹缝+E305」「优先+不双挂」+ G17 第 7/8 项 + I1 | **implements-existing-decision** | ADR 0019 L69–76；sa6_contract §12.1 C 组、§6 N4 | §5 修订文本必须含不对称注明（决策原文显式要求，AC1 边界行为承接） |
| 4 | ADR 0019 决策 4 | L78–92（IR `memberDocs` 条件键：全体成员无 doc 整键不存在；指纹输入纪律） | N2（金样本 IR sha256/指纹常量不得修改）+ N5（无 M4 输入惰性）+ B5（生产代码零语义改动） | **no-conflict** | ADR 0019 L78–92；sa6_contract §6 N2/N5、§12.3 | 无（守住冻结面） |
| 5 | ADR 0019 决策 5 | L94–104（derived 条件稀疏 `memberDocs` 表、`<member N>` 键形；修订 ADR 0003 docs 表条款） | E1 冻结观察（`Status.<member 0>`/`Mixed.<member 0>` 逐字） | **no-conflict** | ADR 0019 L94–104；sa6_contract §12.1 E1 | 无 |
| 6 | ADR 0019 决策 6 | L106–130（codegen 四发射位；无 doc 存量布局逐字节不变） | N1（68 tests 回归）+ N6（`pnpm generate --check` + `domains/*/generated.ts` 零改动） | **no-conflict** | ADR 0019 L106–130；sa6_contract §6 N1/N6 | 无 |
| 7 | ADR 0019 决策 7 | L132–141（投影 docs 切片第三来源；合并序 marker 在前 member 在后；四件套形状不变；修订 ADR 0016） | E2 冻结观察（`[" 载体甲 "," 成员甲 "]`） | **no-conflict** | ADR 0019 L132–141；sa6_contract §12.1 E2 | 无 |
| 8 | ADR 0019 决策 8 / ADR 0001 | L143–147（成员 doc 纯文档性质，不进校验/物化/机器语义） | §12.3（不新增实现行为，只描述已实测行为）+ B5 | **no-conflict** | ADR 0019 L143–147；sa6_contract §12.3 | 无 |
| 9 | ADR 0019 决策 9.3 + v1-spec §4 | ADR 0019 L156–158（错误码稳定；E305 条件缩小、既有触发不变；消息正文枚举补「联合成员」，正文措辞不冻结）；v1-spec L277–280（前缀 `VFSL-E` + 编号 + 冒号 + 单空格为规格冻结项，测试应以前缀为锚） | I1/N3 只以前缀为断言锚；正文四类枚举作为**现行行为观察**断言（非新增冻结） | **no-conflict** | docs/vfsl/v1-spec.md L277–280；ADR 0019 L156–158；sa6_contract §6 N3、§12.1 I1 | 无 |
| 10 | ADR 0019 Consequences | L193–195（「v1-spec §5 挂载规则修订（四类锚位 + M4 子规则 + 挂载示例）**随实现 PR 落地**（避免『规格已改、实现未跟』的中间态）；schema-authoring-guide 第 7/8 节与检查表同步」） | D1–D4 兑现文档义务；时序上 #306/#307/#308 已先合入、#309 后补文档面 | **implements-existing-decision** | ADR 0019 L193–195；#306 design_conflict_report O-5/C-5（中间态豁免预登记，PR #305 收官门槛含 #309）；sa6_contract §8 触发条件行 | #309 须在 PR #305 收官合并前落地，闭合已登记的「实现已四锚位、规格仍三锚位」中间态（见 Required action 5） |
| 11 | v1-spec §8 | L461–471（只增不改；「本规格自身的修订同样只增不改」；首发布前评审修订不受约束；错误码编号随首次发布冻结） | §5 修订为纯增（第四类锚位 + 子规则 + 示例），无既有推导收窄；E305 既有场景明确不变（AC1/D1 链「既有+不变」/G17 第 9 项） | **no-conflict** | docs/vfsl/v1-spec.md L461–471；ADR 0019 决策 9（§8 逐条合规论证） | 无 |
| 12 | docs/AGENTS.md Authority | L5（「Historical `wiki/raw/` artifacts are evidence, not normative contracts」） | D5/B1 将措辞清扫作用域定为 tracked − `wiki/**` − `dist/**`；N8 锚定 wiki 零 diff | **implements-existing-decision** | docs/AGENTS.md L5；sa6_contract §12.8 B1、§6 N8；实测 wiki 25 个 tracked 命中文件 | AC3 字面全域读法若被采纳 = 需 Owner 评论授权改写 25 个历史证据文件（合法 override 唯一来源）；授权落定前以作用域读法为准（Required action 1） |
| 13 | docs/AGENTS.md Editing | L13（行为变更须同步所有契约已改的规范文档；文档措辞变更不得虚构实现行为） | §12.1 冻结观察全部生成自 HEAD 实测；X6 证明目标示例在现行实现下 `ok:true`（文档不虚构行为） | **no-conflict** | docs/AGENTS.md L13；sa6_contract §9 X6、§11 排除项 3 | 无 |
| 14 | docs/AGENTS.md Editing | L9（「update `CONTEXT.md` when introducing or changing a domain term」） | SA6 影响面（§10）未含 CONTEXT.md；「锚位」系仓库既有词汇（ADR 0019/源码注释），CONTEXT.md 无既有锚位条目被更改，但「四类锚位/联合成员」将首次进入规范正文 | **no-conflict** | docs/AGENTS.md L9；CONTEXT.md 无锚位条目（relevant_decisions §5）；sa6_contract §10 | 设计显式记录是否为四类锚位术语补 CONTEXT.md 条目（Required action 4） |
| 15 | docs/AGENTS.md Editing | L10（「Amend or supersede prior decisions explicitly instead of silently contradicting them」）；`docs/adr/0019:60` 为「三锚位」唯一规范文档命中 | B2：最小措辞修订（「三锚位」→「既有 M1/M2/M3」，不改决策语义）**或**显式登记豁免/白名单，「不得静默放过」 | **no-conflict**（条件：处置路径显式记录） | docs/AGENTS.md L10；docs/adr/0019 L60 实测命中；sa6_contract §12.8 B2、§15 U1 | 设计二选一并记录（Required action 2） |
| 16 | ADR 0003 决策 2 + v1-spec §10 | ADR 0003 L16–18（ROOT 根别名约定）；v1-spec §10 fixture 现为 `type ROOT = YMap<…>`、`AssetsDoc` 0 命中 | B3/§12.4：G16 L321/L555 期望 `AssetsDoc→ROOT`（检查器滞后于已定决策的陈旧期望修复） | **implements-existing-decision** | docs/adr/0003 L16–18；docs/vfsl/v1-spec.md §10；sa6_contract §12.4 G16 行、§11.5 | 处置方式（同票修 vs 登记预存在缺陷）须记录（Required action 3） |
| 17 | packages/vfsl/AGENTS.md | Boundaries：错误码/issue 序/路径报告/信封严格性/指纹输入为兼容行为；`schemasource.ts` 为唯一文件系统接缝；公开 API 仅经 `src/index.ts` | B5（`packages/vfsl/src` 仅注释改动，C 组金样本/类型/生成物承压）；新增 `packages/vfsl/test/spec-docs-anchor-m4-contract.test.ts` 运行时读 `docs/**` 文件 | **no-conflict** | packages/vfsl/AGENTS.md；sa6_contract §12.2/§12.8 B5；测试用 fs 的既有先例（`packages/vfsl/test/schemasource-seam.test.ts`）——接缝条款约束包运行时面，不禁止测试读仓文件 | 无（运行时行为零改动由 C 组核对） |
| 18 | #306 设计冲突报告 O-3（wiki 登记） | O-3：「#309 修订 v1-spec §5 时必须同支更新该检查器与 schema-authoring-guide，否则 C-1 违反」 | §12.4（docstring/G10/G17/G16 + exemplar 同步，22/22 判定） | **implements-existing-decision**（权威根 = ADR 0019 Consequences + v1-spec 规范性；即使剔除该 wiki 登记，同支同步义务仍由决策集独立成立） | wiki/raw/task_issue-306_design_conflict_report.md L34/L49；sa6_contract §3、§12.4 | 无 |

裁决分布：**no-conflict 11 项；implements-existing-decision 7 项；evolution-required 0 项；hard-conflict 0 项**。

## 4. Overrides

| Old decision | Override authority | Scope | New obligation |
|---|---|---|---|
| —（无） | — | — | — |

无需任何 override：Issue #309 REST `comments: []`（无 Owner 评论可用作覆盖授权，亦无 owner-comment 要求）；无新 ADR 修订/废弃旧 ADR；无协议版本升级。SA6 契约未引入任何与现行决策不兼容的行为，故不存在待合法化的冲突面。唯一潜在需要 Owner 授权的分支是 AC3 字面全域读法（改写 wiki 历史证据，见 §3 #12）——SA6 契约已正确地未默认采纳。

## 5. Frozen surfaces

| Surface | Must remain unchanged | Evidence | Actual result（基线实测） |
|---|---|---|---|
| E305 既有触发场景与条件 | 坍缩两形态、夹缝非标记（单/多行）、前导 `\|` 夹缝 marker 判定全部保持；E305 条件仅为「减去 M4 新锚位」的缩小 | ADR 0019 决策 2/3/9.3；v1-spec §8-3 | SA6 N3/B1–B4/C4 全绿（冻结观察在案：@(2,10)/(2,16)/(4,5)/(2,12)） |
| E305 消息前缀格式 | `VFSL-E305: `（`VFSL-E` + 三位编号 + 冒号 + 单空格）逐字 | v1-spec §4 L277–280（规格冻结项） | SA6 I1/N3 以前缀为唯一断言锚；正文措辞不冻结（ADR 0019 L158） |
| IR `memberDocs` 条件键语义 | 全体成员无 doc 时整键缺席；`members` 等长对齐 | ADR 0019 决策 4 | SA6 N5/D1 观察一致（键 absent） |
| 指纹输入与金样本常量 | 存量文本 IR/指纹逐字节；`parse-vfsl-union-member-docs.test.ts` 的 IR sha256/semantic 指纹常量不得修改 | ADR 0019 决策 4；ADR 0017；packages/vfsl/AGENTS.md（指纹输入 = 兼容行为） | SA6 N2 绿；§12.3 明令禁改常量（改了即伪绿） |
| derived `memberDocs` 条件稀疏表 | 仅非空条目、`<member N>` 键形、存量派生物逐字节 | ADR 0019 决策 5（修订 ADR 0003） | SA6 E1 一致 |
| 投影 docs 切片 | 合并序 marker 在前 member 在后；四件套形状；空条目过滤 | ADR 0019 决策 7（修订 ADR 0016） | SA6 E2 一致 |
| codegen 输出 | 四发射位已冻结为决策；无 doc 存量布局逐字节不变 | ADR 0019 决策 6 | SA6 N1/N6 绿（`generate --check` + 生成物零 diff） |
| 错误码集合 | 不新增错误码；E305 编号不复用 | ADR 0019 决策 9.3；v1-spec §8-3 | SA6 契约未引入新码 |
| `wiki/**` 历史证据 | 不进入 #309 diff（不为措辞清零改写审计轨迹） | docs/AGENTS.md Authority L5 | SA6 N8 基线零改动；D5 作用域排除 |
| 生产代码运行时语义 | `packages/*/src` 仅允许注释/措辞改动；token 级零语义差 | ADR 0019（实现已完成）；sa6_contract B5 | 待实现后逐项核对（见 §8） |

## 6. Evolution requirements

**无 evolution-required 项。** v1-spec §5 / 指南 / 检查器的修订均由已接受的 ADR 0019（其正文已显式修订 ADR 0003/0016 的相关条款）授权，不存在需要同变更集修订 ADR、CONTEXT 或协议文档的契约变更。开放点（AC3 作用域、ADR 0019:60 措辞、G16 处置、CONTEXT.md 术语登记）均为**裁定记录义务**而非契约演进，且 SA6 契约已为每项给出默认值与强制登记路径。

## 7. Hard conflicts

**无。** 未发现任务要求或 SA6 契约与决策集不兼容且无合法 override 的条目。

## 8. Required actions

1. **AC3 作用域裁定（B1）须在设计/实现记录中显式落字**：采纳「tracked − `wiki/**` − `dist/**`」作用域读法（与 docs/AGENTS.md Authority 一致）；若设计/Owner 改采字面全域读法，必须先取得 Owner 评论授权（唯一合法 override 来源）并预登记 25 个 wiki 证据文件的改写清单——授权落定前字面读法不得执行。
2. **B2 处置二选一并显式记录**：`docs/adr/0019:60` 最小措辞修订（按 docs/AGENTS.md「explicitly amend」记录为非语义修订）或白名单豁免登记；禁止静默放过或静默改写。
3. **B3/G16 处置记录**：推荐同票修复（一行期望 `AssetsDoc→ROOT`，对齐 ADR 0003 ROOT 约定与现行 §10 fixture）；若不在本票修，须登记为预存在缺陷，#309 判红绿只用 G10/G17 + Suite D，不得把 G16 红计为 #309 缺陷、不得伪绿。
4. **CONTEXT.md 术语裁定记录**：设计须显式决定是否为「四类锚位/联合成员」补 CONTEXT.md 条目（docs/AGENTS.md L9 词汇规则；CONTEXT.md 已有语言级术语先例）。
5. **时序闭合**：#309 须在 PR #305 收官合并前落地，兑现 ADR 0019 Consequences 的文档义务并闭合 #306 O-5 预登记的分支中间态。
6. **实现后冲突复查**（对应 requiresConflictRecheck=true）：逐项核对实际 diff——ADR/CONTEXT 除第 2 条登记路径外零改动；`wiki/**` 零 diff；`packages/*/src` 仅注释改动（建议 B5 的去注释 token 等价比对）；检查器改动限于 docstring/G10 need/G17 新增/G16 期望；exemplar 同步保持 `--spec` 绿路径；金样本常量未动。

## 9. Verdict

**clear** —— 18 项对照全部为 no-conflict 或 implements-existing-decision；无 evolution-required、无 hard-conflict；SA6 契约的事实基线经 SA8 独立复核无失真，其开放点（U1–U5）均有登记路径与默认值，不构成 reject 事由（输入与证据充分、无不一致）。`approve` 不是 SA8 verdict，此处不适用。

## 10. requiresConflictRecheck

**true** —— 理由：被审的规范正文修订（v1-spec §5 / 指南 / exemplar）、检查器机器契约扩展（G10/G17/G16）与 9 个源/测文件的措辞改动**尚待实现**，须在实现后核对：B2 处置是否按登记路径执行（ADR 是否被静默触碰）、冻结面（wiki 零 diff、注释-only、金样本常量、E305 面）是否守住、检查器改动是否未越界（不弱化 G1–G16 其余项）。#309 无公共 API / wire / 持久化 / 状态机变更（B5 零运行时语义），复查范围为规范文本面与上述冻结面。

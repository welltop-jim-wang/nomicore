# SA8 设计后冲突复审报告 — issue #309（v1-spec §5 与编写指南落地 M4 挂载锚位）

- Dispatch：`sa-83938e1e-33eb-4d8e-a46e-6e76c30b186b`（mabf-sa8 / conflict-gate / iteration 2，recheck）
- 被审对象：SA1 设计 `wiki/raw/task_issue-309_design.md` **iteration 1 原位修订版**（dispatch `sa-29329932-65c7-4720-82cb-cbf35ff0f366`；初版 dispatch `sa-78fcfd52-4025-4193-b9c9-31b04fa790b9`）
- 证据基线：worktree `/home/wangjian/nomicore-fix-issue-309`，分支 `mabf/issue-309`，HEAD `bbb93fbda3100b2da2a007a228af777cdc56d282`（与设计/SA6/前置门禁/iteration 1 复审同基线，本轮实测复核；`git status` 仅 6 个未跟踪 wiki 产物，tracked 零改动，`git diff --check` 干净）
- 本报告为 SA8 固定产物，**原位更新** iteration 1 版本；结论只反映当前被审对象（iteration 1 修订版设计），不堆叠历史结论。SA8 未修改任何被审对象、决策文档、规范文档或代码，未运行测试、未派发其他 SA。

## 1. Reviewed subject

**design（设计后复审 · iteration 2 recheck）**——被审对象为 SA1 设计 iteration 1 修订版全文（§0–§15：目标/非目标、证据锚点、D1–D10 设计决策与冻结目标文本、文件范围 ALLOW/DENY、验收映射、风险与 follow-up、§14 评审修订映射）。本轮复审任务：(a) 核验 iteration 1 reject 事由（§3 #13：D7(a) 冻结目标文本「单成员联合按 §7.3 坍缩」悬空引用）是否已解决；(b) 对修订版全文重做 ADR / 规范文本 / 架构冲突裁决。`wiki/raw/task_issue-309_sa2_review.md` 仍不存在（本轮 ls 复核确认；设计 §0 如实登记 iteration 0/1 均无 SA2 评审输入），故无 SA2 评审输入可读。上游输入：Host brief（REST `comments: []`，无 Owner 评论、无 owner-comment 约束、无 override 来源）、已接受的 SA6 验收契约、SA8 前置门禁两件产物（verdict = clear）、SA8 设计后复审 iteration 1 报告（verdict = reject，本报告前一版本）。

## 2. Inputs and decision set

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-309_design.md` | 被审对象（530 行，SA1 iteration 1 原位修订；§14 修订映射声明文件范围与冻结面零变化，本轮逐节比对确认） |
| `wiki/raw/task_issue-309.md`（brief）+ `task_issue-309_sa6_contract.md` | 存在；REST `comments: []`（无 Owner 评论，无 owner-comment 约束，亦无 override 来源） |
| `docs/adr/0001–0019`（17 份，无 0013/0015） | 全部 accepted，无整体 superseded；0003（决策 5 面）/0016（docs 切片面）相关条款由 0019 显式修订（决策文本自述） |
| `CONTEXT.md` | 无「锚位/挂载/联合成员」条目（本轮 grep 0 命中；L49 标记类型、L115 判别联合为语言级术语先例）——设计 D5 拟新增「挂载锚位」条目 |
| `docs/vfsl/v1-spec.md` | §4 L277-280（错误前缀冻结项，本轮实读）；§5 L390-424（现行三类锚位文本，挂载规则段 L405-409，三态表/边界段/`@tag` 段/7 条 fixture 表在场，§5 内 `vfsl` 围栏块 0 个）；§7 L439 = 「信封形状」，其区间**无任何 `###` 小节**（全篇小节仅存在于 §3/§4 区间），全篇「坍缩」「7.3」均 0 命中（本轮实测）；§8 L461-471（只增不改 + 首发布前评审豁免）；§10 L518 fixture `type ROOT = YMap<{…>`、`AssetsDoc` 0 命中 |
| `docs/vfsl/schema-authoring-guide.md` | L204 三锚位挂载句、§7 L152-164（Asset 示例无成员 doc）、§8 L182-202（Status 示例无成员 doc；示例块自带 `type ROOT` 声明）、检查表 L273-287（无 M4 条目）——本轮逐段实读与设计 §2.2 一致 |
| `docs/AGENTS.md` | Authority L5（wiki/raw 是证据非规范）；Editing L9（术语→CONTEXT）、L10（显式修订而非静默矛盾）、L13（行为变更同步规范文档；措辞不得虚构实现行为）、「Link to the authoritative source」；Verification（检查链接与引用文件名、陈旧术语、`git diff --check`） |
| `packages/vfsl/AGENTS.md` | 错误码/issue 序/路径报告/信封严格性/指纹输入 = 兼容行为；`schemasource.ts` 为唯一（生产）文件系统接缝；公开 API 仅经 `src/index.ts` |
| `tests/acceptance/vfsl_spec_acceptance.py` + `tests/acceptance/exemplar/spec-exemplar-v1.md` | docstring L34 三类、G10 need L477-478（12 项）、G16 L321 `AssetsDoc` 期望 + L555 详情消息（本轮实读）；`find_sec`/`join_sec` 为 `run_checks` 内 lambda（L368-369，设计 D9 G17 代码可用）；判定总数 21 = G1-G6 六 + G7×六标记 + G8-G16 九（本轮逐项清点）；G15 为 `any()` 语义（L539-550：附录块保留即绿——§5 追加示例块不破 G15）；exemplar §4 L99-101 三处挂载目标、附录 fixture L155-156 起 `type AssetsDoc = YXmlFragment<…>` 形（无 ROOT 标识） |
| 源码锚点 | `parser.ts:174-188`（recordPipeAnchor/recordStartAnchor + 「不触碰 claimDocs 与三锚位」注释）、`parser.ts:519`、`semantic.ts:5`（注释）/`:76`（E305 正文已四类枚举）、`ir.ts:44-53`（union 条件键 + 指纹纪律注）/`:59`——本轮实读全部吻合；直接读先例 `compile-schema-envelope.test.ts` L45（`import { readFileSync } from 'node:fs'`）/ L558（直接读 `../package.json`）**在场**（iteration 1 修正后的引用准确） |
| 残余「§7.3」引用（iteration 1 登记，本轮逐处核实） | `docs/adr/0019:64`（「单成员联合按 §7.3 坍缩、不产联合节点」）在场；`packages/vfsl/src/parser.ts:347`（注释「单成员联合坍缩（§7.3）；M4 不结算（决策 2）」）在场；`parser.ts:417`（E100 数值域注释「（§7.3）」，指涉另一设计文档）与 `ir.ts:7`（「设计要点（§7.3）」）亦在场——设计 §13 follow-up 4 的登记与仓库事实一致 |
| 运行入口 | `vitest.config.ts` include 含 `packages/*/test/**/*.test.ts`；`scripts/ci-test-shard.mjs` 从磁盘 `readdirSync` 枚举 `*.test.ts`（本轮实读，新测试文件自动入分片成立） |

**SA8 独立复核结论（iteration 2）**：

1. **reject 事由已消除**：修订版 D7(a) 子规则第 4 条现为行内自含规范陈述——「单成员联合**坍缩为成员类型本身**（仅一个成员的联合在类型结构上等价于该成员类型，不产生联合节点），成员 doc 因此无挂载目标：坍缩形态（`type T = /** d */ "a";` 与 `type T = /** d */ | "a";`）维持 E305，与既有行为逐字节一致（既有场景不变，不升格挂别名节点）」——**不含任何章节号或 wiki 产物引用**。设计全文「7.3」共 7 处命中，逐行核对全部位于 §0 输入表 / §6 义务落实表 / §13 follow-up 4 / §14 修订映射 / §15 复查清单的元讨论与残余登记，**冻结目标文本（D5/D7(a)/D7(b)/D8/D9）内 0 命中**。语义与 ADR 0019 决策 2（两形态维持 E305、逐字节一致、不升格挂别名）及 SA6 §12.1 B1/B2 冻结观察（E305@(2,10) 两形态）逐条一致。
2. **needle 映射不受影响**：SA6 §12.2 D1 的 20 needle 与 §12.4 G17 的 9 元组（本轮逐项比对设计 D9 代码）均不含「7.3」；修订文本仍命中 G17-6（`坍缩`+`E305`）与 G17-9（`既有`+`不变`，与子规则 5 合供），其余 needle 命中点逐条复核实测在场（设计 D7 逐 needle 核对表与文本吻合）。
3. **两项 advisory 均已落实**：D7(b) 尾段补「（发射位与界线见 ADR 0019 决策 6——…四个发射位；`YPlainArray` 纯值子树与 `YXmlFragment` 不透明实参内成员 doc 无发射位，派生表照常收集）」——与 ADR 0019 L106-130 逐字对齐（「别名联合」为「别名判别联合」的无歧义压缩，且显式以 ADR 为权威）；先例引用改为 `compile-schema-envelope.test.ts`（L45/L558 本轮实读在场），`schemasource-seam.test.ts` 如实标注为接缝测试。
4. 其余事实基线（三锚位 14 处/9 文件、wiki 25 文件、检查器/指南/exemplar/CONTEXT/源码锚点）逐项复核与设计 §2、SA6、前置门禁三方一致，无新失真。

## 3. Decision analysis

| # | Decision | Clause | Subject behavior（修订版设计中的对应行为） | Classification | Evidence | Required action |
|---|---|---|---|---|---|---|
| 1 | ADR 0019 决策 1 | L33-60（前导 `\|` 锚位 / 首成员起点锚位 / 连续同挂 / `\|` 夹缝不属 M4） | D7(a) 四类锚位 + 五条子规则逐条承接（含单行/混合布局句）；D8(a) 指南挂载目标句四类化；G17 9 元组；Suite D D1 20 needle——iteration 1 未改动此等内容 | **implements-existing-decision** | ADR 0019 L33-60；设计 §7-D7/D8/D9；v1-spec L405-409（现行三类文本，本轮实读） | 落地时按 D1/G17 逐项核对（实现票） |
| 2 | ADR 0019 决策 2 | L62-67（单成员坍缩维持 E305、逐字节一致、不升格挂别名） | D7(a) 子规则第 4 条**修订后**为行内自含陈述：坍缩语义、两形态、逐字节一致、不升格四要素齐备，无悬空引用；行为陈述锚定 SA6 B1/B2 冻结观察——iteration 1 reject 事由在本条内消除 | **implements-existing-decision**（引用缺陷已修正，语义兑现完整） | ADR 0019 L62-67；设计 §7-D7(a) 子规则 4（修订版）；sa6_contract §12.1 B1/B2 | 无（落地核对见 §8 行动 1） |
| 3 | ADR 0019 决策 3 | L69-76（M3 优先不双挂为冻结约束；夹缝不对称「spec 修订中显式注明」） | D7(a) 子规则第 5/6 条（iteration 1 未改动）：夹缝非标记 E305、标记名挂 M3、标记优先不双挂、「该不对称是『语义不改』的既定代价，在此显式注明」——决策原文的显式注明义务已兑现 | **implements-existing-decision** | ADR 0019 L69-76；设计 §7-D7(a) 第 5/6 条；sa6_contract C1/C3/C5 | 无 |
| 4 | ADR 0019 决策 4/5/6/7/8 | L78-147（IR 条件键与指纹纪律、derived 条件稀疏表、codegen 四发射位、投影第三来源、纯文档性质） | 设计非目标 + DENY LIST 全部冻结（iteration 1 零变化）；新增面仅为 D7(b) 对决策 6 的**描述性**限定（四发射位 + 两处无发射位例外 + 派生表照常收集），逐字对齐 ADR L106-130，未触碰任何实现冻结面 | **no-conflict** | ADR 0019 L78-147；设计 §1 非目标、§11 DENY、§7-D7(b) 尾段 | 无（实现后核对冻结面，§8 行动 3） |
| 5 | ADR 0019 决策 9 + v1-spec §8 | ADR L149-158；v1-spec L461-471（只增不改；规格自身修订同样只增不改；首发布前评审修订轮次豁免） | D7 为纯增修订（第四类锚位 + 子规则 + 示例块；D7(b) 尾段亦为纯增描述），三态表/边界段/`@tag` 段不动；E305 既有场景显式声明不变；无错误码变化；§5 新增 `vfsl` 块不破 G15（`any()` 语义本轮源码复核 L539-550） | **no-conflict** | docs/vfsl/v1-spec.md L461-471、L390-424；设计 §7-D7；检查器 G15 实现 | 无 |
| 6 | ADR 0019 决策 9.3 + v1-spec §4 | ADR L156-158；v1-spec L277-280（前缀为规格冻结项，正文不冻结，测试以前缀为锚） | 设计零 E305 消息改动（`semantic.ts:76` 正文已四类，本轮实读核实；E305 触发面零变化）；N3 以前缀为断言锚 | **no-conflict** | v1-spec L277-280（本轮实读）；`packages/vfsl/src/semantic.ts:76`；设计 §1 非目标、§10 | 无 |
| 7 | ADR 0019 Consequences | L193-195（v1-spec §5 修订 + 指南 §7/§8 与检查表同步随实现 PR 落地） | D7/D8/D9 全部文档义务兑现路径 + §13 时序义务（#309 须在 PR #305 收官合并前落地）——iteration 1 未变化 | **implements-existing-decision** | ADR 0019 L193-195；设计 §3/§13；#306 O-5 预登记 | 收官核对（PR #305 合并门槛，§8 行动 4） |
| 8 | #306 O-3（wiki 登记） | 「#309 修订 v1-spec §5 时必须同支更新该检查器与 schema-authoring-guide」 | D9：docstring L34、G10 need 12→13、G17 新增（`find_sec`/`join_sec` lambda 在场，代码结构可行）、G16 同票修；D6 exemplar 三处同步；判定 21→22（本轮清点 6+6+9+1=22，算术吻合） | **implements-existing-decision** | wiki/raw/task_issue-306_design_conflict_report.md O-3；设计 §7-D9；检查器源码 | 无 |
| 9 | docs/AGENTS.md Authority | L5（wiki/raw 是证据非规范） | D1：AC3 作用域 = tracked − `wiki/**` − `dist/**`；wiki 25 个 tracked 命中文件（本轮实测）不改写，N8 零 diff 控制；字面全域读法显式否决（无 Owner 授权，REST `comments: []`）——iteration 1 未变化 | **implements-existing-decision** | docs/AGENTS.md L5；设计 §7-D1；git status 实测 tracked wiki 零改动 | 无 |
| 10 | docs/AGENTS.md Editing | L10（显式修订而非静默矛盾） | D2：`docs/adr/0019:60`「三锚位」→「既有 M1/M2/M3 锚位」（L60 命中本轮实读），最小比较性措辞修订，显式登记；**登记修订路径保持仅 L60**——iteration 1 明确不扩至 L64（§13 follow-up 4），与前置门禁行动 2、iteration 1 复审行动 4 确认的路径一致 | **no-conflict** | docs/AGENTS.md L10；docs/adr/0019 L60 实测命中；设计 §7-D2、§11 ALLOW、§13-4 | 实现后核对（ADR 除 L60 外零改动，含 L64 不被静默触碰，§8 行动 2） |
| 11 | docs/AGENTS.md Editing | L9（引入/变更领域术语须更新 CONTEXT.md） | D5：新增「挂载锚位（mount anchor）」四类条目（本轮核对：与 ADR 0019 决策 1/8、ADR 0001 无机器标签口径一致；**条目文本不含「三锚位」字样**——设计 L180 的命中为条目外的注意事项元文本）；插于「标记类型」条目后（L49/L51 先例实测在场） | **implements-existing-decision** | docs/AGENTS.md L9；CONTEXT.md L49-51/L115（本轮实读）；设计 §7-D5 | 实现后核对（CONTEXT 仅此一条新增） |
| 12 | docs/AGENTS.md Editing | L13（行为变更须同步所有契约已改的规范文档；文档措辞变更不得虚构实现行为） | D7/D8 全部行为性陈述逐条锚定 SA6 §12.1 冻结观察（A1-A4/B1-B4/C1/C3/C5）与 X6 预证示例；修订后子规则 4 的坍缩陈述未超出 B1/B2 已实测行为；D6 exemplar fixture 替换采用现行 §10 fixture 逐字副本（X3 已证全绿） | **no-conflict** | docs/AGENTS.md L13；设计 §7-D6/D7「行为一致性」段；sa6_contract §12.1/§9 | 无 |
| 13 | docs/AGENTS.md Editing（「Link to the authoritative source」）+ Verification（「Check links and referenced filenames」） | Editing/Verification 节（docs 模块收录决策） | **iteration 1 reject 事由（本轮核验）已解决**：D7(a) 修订文本删除裸「§7.3」，改行内自含陈述，全部冻结目标文本（D5/D7/D8/D9）经本轮 grep 0 命中「7.3」；§5 新文本内的引用（「ADR 0019」「ADR 0019 决策 6」「§5 `@tag` 条款；ADR 0001」）均指向真实权威源。**残余登记评估**：`docs/adr/0019:64` 与 `parser.ts:347` 的历史「§7.3」引用在场（本轮逐处核实，另 `parser.ts:417`/`ir.ts:7` 为指涉不同设计文档的同类惯例），设计 §13 follow-up 4 显式登记不纳入本票——该两处系 HEAD 既有缺陷（ADR 0019 自身写作时遗留），非 #309 创建、依赖或与之矛盾；登记修订路径冻结为仅 L60（两份前置 SA8 产物确认），扩至 L64 属越登记路径的范围扩张，须 Owner 另立决策；#309 落地后坍缩规则的规范表述以 v1-spec §5 自含陈述为权威，决策链无缺损 | **no-conflict**（iteration 1 的可修正不一致已修正；残余为显式登记的既有缺陷，非本设计引入的不一致） | v1-spec §7 L439（信封形状，无小节）+ 全篇「坍缩」/「7.3」grep 0 命中（本轮实测）；docs/adr/0019 L64、parser.ts:347/417、ir.ts:7（本轮实读）；设计 §7-D7(a) 子规则 4、§13-4、§15-5 | 落地文本悬空引用核对（§8 行动 1）；残余引用不得在本票 diff 内被静默触碰（行动 2）；follow-up 4 保持登记留 Owner 裁决 |
| 14 | ADR 0003 决策 2 + v1-spec §10 | ADR 0003 L16-18（ROOT 根别名约定，map 形）；v1-spec §10 fixture `type ROOT = YMap<…>`（L518 本轮实读） | D3：G16 期望 `AssetsDoc→ROOT` 同票修（L321 标识循环 + L555 详情消息，两处本轮源码定位吻合）；D6-3：exemplar 附录 fixture 同步为 §10 逐字副本（exemplar 现存 `type AssetsDoc = YXmlFragment<…>` 本轮实读确认）——iteration 1 未变化 | **implements-existing-decision** | docs/adr/0003 L16-18；docs/vfsl/v1-spec.md L518；设计 §7-D3/D6；检查器源码 | 实现后核对（检查器改动不越界） |
| 15 | packages/vfsl/AGENTS.md | Boundaries（兼容行为清单；`schemasource.ts` 唯一生产文件系统接缝；公开 API 仅经 `src/index.ts`） | D4：Suite D 新测试以 fs 读 `docs/**`（测试面非生产 API，接缝条款约束包运行时面）；B5：`packages/vfsl/src` 三文件仅注释改动（parser.ts:174/519、semantic.ts:5、ir.ts:59 本轮实读确认全部为注释行）；**先例引用已修正**：直接读先例 = `compile-schema-envelope.test.ts` L45/L558（本轮实读在场），`schemasource-seam.test.ts` 如实标注为经生产接缝读文件——iteration 1 advisory 3 已落实 | **no-conflict** | packages/vfsl/AGENTS.md；设计 §2.3/§7-D4/§11；`packages/vfsl/test/compile-schema-envelope.test.ts` L45/L558（本轮实读） | 无 |
| 16 | SA6 契约 C 组冻结面（N1/N2/N3/N5/N6/N8） | sa6_contract §6/§12.3 | 设计 §11 DENY LIST（wiki/**、codegen 包、金样本常量、generated.ts、其余 ADR、workflow/scripts）+ §12 验收映射逐项承接；`git diff --check` 纳入 D5②——iteration 1 对 ALLOW/DENY 与冻结面零变化（§14 声明 + 本轮逐节比对确认） | **no-conflict** | sa6_contract §6；设计 §11/§12 | 实现后逐项核对（§8 行动 3） |

裁决分布：**no-conflict 11 项；implements-existing-decision 5 项；可修正不一致 0 项（iteration 1 #13 已修正）；evolution-required 0 项；hard-conflict 0 项**。

## 4. Overrides

| Old decision | Override authority | Scope | New obligation |
|---|---|---|---|
| —（无） | — | — | — |

无需任何 override：Issue #309 REST `comments: []`（无 Owner 评论可作覆盖授权）；无新 ADR 修订/废弃；无协议版本升级。修订版设计未引入与现行决策不兼容的行为——D1 的 AC3 作用域读法站立在 docs/AGENTS.md Authority L5 之上；D2 的 ADR 0019:60 修订走 docs/AGENTS.md L10 显式修订路径；D3 的 G16 修复使检查器对齐 ADR 0003 既有决策；D7(a) 修订为行内陈述不触碰任何决策文档。iteration 1 修订亦未产生新的 override 需求。

## 5. Frozen surfaces

| Surface | Must remain unchanged | Evidence | Actual result（修订版设计承诺，本轮核对） |
|---|---|---|---|
| E305 既有触发场景与条件 | 坍缩两形态、夹缝非标记（单/多行）、前导 `\|` 夹缝 marker 判定全部保持；条件仅为「减去 M4 新锚位」的缩小 | ADR 0019 决策 2/3/9.3；v1-spec §8 | 设计零运行时改动；§5 修订后子规则 4/5 显式声明「既有场景不变」；Suite C 回归承压（§12） |
| E305 消息前缀 | `VFSL-E305: ` 逐字（规格冻结项） | v1-spec §4 L277-280 | 零消息改动（`semantic.ts:76` 本轮实读：正文已四类枚举） |
| IR `memberDocs` 条件键语义 / 指纹输入与金样本常量 | 键缺席语义、等长对齐、键序；`parse-vfsl-union-member-docs.test.ts` L33-36 常量 | ADR 0019 决策 4；ADR 0017；packages/vfsl/AGENTS.md | DENY 明令禁改；D10 #6 仅改文件头注释（iteration 1 未变） |
| derived 稀疏表 / 投影切片 / codegen 输出 | `<member N>` 键形、marker 前 member 后合并序、四发射位、无 doc 存量布局逐字节 | ADR 0019 决策 5/6/7 | `packages/vfsl-codegen/**`、生成物全部 DENY；D7(b) 仅描述性引证决策 6，不改实现面 |
| 错误码集合 | 不新增错误码、E305 编号不复用 | ADR 0019 决策 9.3；v1-spec §8-3 | 修订版设计未引入新码 |
| `wiki/**` 历史证据 | 不进入 #309 diff | docs/AGENTS.md Authority L5 | D1 作用域排除 + N8 零 diff 控制；git status 实测 tracked wiki 零改动 |
| 生产代码运行时语义 | `packages/*/src` 仅注释/措辞改动（token 级零语义差） | sa6_contract B5 | D10 #2-#5 四处本轮实读确认全为注释行；建议的去注释 token 等价比对保留 |
| ADR 0019 登记修订路径 | 仅 L60 一行（D2 显式登记）；L64 等其余行零改动 | docs/AGENTS.md L10；前置门禁行动 2 / iteration 1 复审行动 4 | iteration 1 明确不扩至 L64（§13-4 登记）；ALLOW LIST 未变 |
| 检查器其余判定 | G1-G15 语义不弱化；G16 仅修陈旧期望 | #306 O-3；X1-X4 | D9 改动限于 docstring/G10 need/G17 新增/G16 期望四类；判定 21→22 与源码结构吻合；G15 `any()` 语义不受 §5 新增块影响（本轮源码复核） |
| AC3 断言作用域 | 不为措辞清零改写历史证据 | docs/AGENTS.md Authority L5 | D5① 作用域 = tracked − wiki − dist；needle join 构造防自命中；14 处/9 文件基线三方一致（本轮复测） |

## 6. Evolution requirements

**无 evolution-required 项。** 修订版设计的全部修订（v1-spec §5、指南、exemplar、检查器 G10/G17/G16、CONTEXT.md 术语、ADR 0019:60 措辞）均由已接受的 ADR 0019（其正文已显式修订 ADR 0003/0016 相关条款）与 docs/AGENTS.md 收录条款授权；iteration 1 的修订（悬空引用消除、发射位限定、先例引用修正、复查清单增项、残余登记）均不改变任何契约面，不需要同变更集修订任何 ADR、CONTEXT 义务或协议文档。D5 的 CONTEXT.md 新增是**履行** L9 既有规则，非契约演进。

## 7. Hard conflicts

**无。** 未发现修订版设计与决策集不兼容且无合法 override 的条目。iteration 1 的 reject 事由（#13 可修正不一致）已经设计自身修订消除，不触碰任何决策文档。

## 8. Required actions

1. **落地文本悬空引用核对（iteration 1 行动 1 的实现期承接 + 设计 §15-5）**：落地的 v1-spec §5 / 指南 / exemplar / CONTEXT.md 目标文本不得携带「§7.3」或任何指向不存在小节、非规范 wiki 产物的引用；§5 内 ADR 引用须指向 `docs/adr/0019` 真实决策条目（决策 1/2/6）。本轮已核设计冻结文本合规，实现须逐字落地不得回改出悬空引用。
2. **残余引用纪律**：`docs/adr/0019:64` 与 `parser.ts:347` 的既有「§7.3」引用**不得在本票 diff 内被静默触碰**（登记修订路径 = ADR 0019 仅 L60、`parser.ts` 仅 L174/L519 两处注释）；follow-up 4 保持登记，历史引用清扫由 Owner 另立文档卫生票裁决。
3. **实现后冲突复查**（对应 requiresConflictRecheck=true，承接前置门禁行动 6 / iteration 1 行动 5 / 设计 §15）：逐项核对实际 diff——ADR 除 L60 外零改动、CONTEXT 仅一条新增；`wiki/**` 零 diff；`packages/*/src` 仅注释（建议去注释 token 等价比对）；金样本常量未动；E305 面/IR/派生/生成物逐字节不变（Suite C 同数同绿）；检查器改动限于 docstring/G10 need/G17 新增/G16 期望、不弱化 G1-G16 其余项；exemplar 双入口 22/22。
4. **时序闭合**：#309 须在 PR #305 收官合并前落地（ADR 0019 Consequences 文档义务；#306 O-5 预登记的中间态闭合）。

## 9. Verdict

**clear** —— iteration 1 reject 事由（D7(a) 冻结目标文本「单成员联合按 §7.3 坍缩」悬空引用）**已解决**：修订文本为行内自含规范陈述，全部冻结目标文本经本轮 grep 与逐行核对 0 命中「7.3」，语义与 ADR 0019 决策 2 及 SA6 B1/B2 冻结观察逐条一致，needle 映射（D1 20 needle / G17 9 元组）不受影响；两项 advisory（D7(b) 发射位界线限定、先例引用精确化）均已落实且本轮实证吻合。16 项决策对照全部为 no-conflict（11）/ implements-existing-decision（5），无 evolution-required、无 hard-conflict、无 override 需求；修订版设计对前置门禁 6 项与 iteration 1 复审 5 项 Required actions 均已显式落实，事实基线经本轮独立复核无失真（含 §13 follow-up 4 残余登记与仓库事实逐处一致）。`approve` 不是 SA8 verdict，此处不适用。

## 10. requiresConflictRecheck

**true** —— 理由：被审对象中规范正文修订（v1-spec §5 / 指南 / exemplar）、检查器机器契约扩展（G10/G17/G16）、CONTEXT.md 术语新增、ADR 0019:60 登记路径修订与 9 个源/测文件的措辞改动**在设计时尚未实现**，须实现后按 §8 行动 3 逐项核对实际 diff 与冻结面；落地文本的悬空引用核对（§8 行动 1）与残余引用纪律（§8 行动 2）亦待实现期验证。#309 无公共 API / wire / 持久化 / 状态机 / 生命周期 / 失败语义变更（B5 零运行时语义），复查范围为规范文本面、检查器机器契约面、术语登记面与冻结面。

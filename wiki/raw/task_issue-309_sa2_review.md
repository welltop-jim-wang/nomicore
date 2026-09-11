# SA2 设计攻击评审 — issue #309（v1-spec §5 与编写指南落地 M4 挂载锚位）

- Dispatch：`sa-385c5c9d-3251-41eb-bdbf-a502630c3775`（mabf-sa2 / design-review / iteration 1，原位更新 iteration 0 评审 `sa-0a3f89ac-0f3a-4d3c-a81a-f295ad13c80e`，该轮 verdict = reject / SA2-1）
- 被审对象：SA1 设计 `wiki/raw/task_issue-309_design.md` **iteration 2 原位修订版**（550 行；dispatch `sa-c40892e4-3ae4-4ad2-b46a-c2a83b7017fc`——落实 SA2-1 并吸收非阻断观察 N1/N2/N3/N4/N6）
- 证据基线：worktree `/home/wangjian/nomicore-fix-issue-309`，分支 `mabf/issue-309`，HEAD `bbb93fbda3100b2da2a007a228af777cdc56d282`（本轮 `git log`/`git status` 实测：tracked 零改动，仅 7 个未跟踪 wiki 产物（含本文件），`git diff --check` 干净——与 SA6/SA8/前轮 SA2 同基线，本轮设计修订不触任何仓库文件）
- 本报告为 SA2 固定产物；SA2 未修改设计、生产代码、测试或规范文档，未运行测试、未启动服务、未派发其他 SA。全部结论基于源码/规范/检查器/指南/ADR/CONTEXT 的本轮独立实读与 grep 复测。

## 1. Reviewed inputs

| 输入 | 状态 | 本轮处置 |
|---|---|---|
| `wiki/raw/task_issue-309.md`（Host brief） | 存在 | 全文实读；Issue 正文 What-to-build + AC1-AC4 与 brief 逐字一致；**Comments: []（dispatch 确认成功空响应；无 owner-comment 约束）** |
| `wiki/raw/task_issue-309_sa6_contract.md` | 存在（已接受） | 全文实读（368 行）；本轮重点复核对 §12.2 D3/D3b 冻结谓词原文与 §9 X6 形态 |
| `wiki/raw/task_issue-309_relevant_decisions.md` | 存在 | 全文实读 |
| `wiki/raw/task_issue-309_conflict_report.md` | 存在（前置门禁 clear；requiresConflictRecheck = true） | 全文实读（18 项对照；6 项 Required actions） |
| `wiki/raw/task_issue-309_design_conflict_report.md` | 存在（设计后复审 iteration 2 recheck = clear，原位更新） | 全文实读（16 项对照：no-conflict 11 / implements-existing-decision 5；4 项 Required actions 全为实现期义务）。注意时序：该 recheck 审的是设计 iteration 1 修订版；本轮设计 iteration 2（SA2-1 落实）晚于它，新增面的冲突裁定见 §5 末行（SA2 独立裁定：无新冲突面） |
| `wiki/raw/task_issue-309_sa2_review.md`（iteration 0） | 本文件前身 | 唯一 MAJOR = SA2-1 + 非阻断 N1-N6；本轮逐条复核落实情况（§6/§13/§14） |
| `wiki/raw/task_issue-309_design.md` | 被审对象（iteration 2） | 全文实读（550 行） |
| 独立核验源 | — | `docs/vfsl/schema-authoring-guide.md`（287 行全读 + `必须紧邻`/vfsl 围栏/标题 grep）、`docs/vfsl/v1-spec.md`（§4 L275-282 / §5 L390-425 / §7 / §8 / §10 fixture L490-530 + 标题 grep）、`tests/acceptance/vfsl_spec_acceptance.py`（docstring 注释规则行 / G10 need 列表 / G16 标识循环与 L555 详情消息 / find_sec·join_sec 闭包 / main·--spec 路由）、`tests/acceptance/exemplar/spec-exemplar-v1.md`（标题结构/围栏清单/§4/附录 fixture + ROOT grep = 0 命中）、`CONTEXT.md`（L45-55/L112-118 + ADR 引用风格 grep 混用属实 + 锚位/挂载 grep = 0 命中）、`packages/vfsl/src/parser.ts` L170-190（recordPipeAnchor/recordStartAnchor）、`semantic.ts` L70-80（E305 正文已四类枚举）、`ir.ts` L40-60（memberDocs 条件键）、`parse-vfsl-union-member-docs.test.ts` L30-40（金样本常量 L33-36）、`compile-schema-envelope.test.ts` L43-47/L554-560（直接读先例）、`vitest.config.ts` include、`scripts/ci-test-shard.mjs` 磁盘枚举；全仓 `git ls-files` 残留 grep 复测 = **14 处 / 9 文件，行号与 D10 表逐行吻合** |

**Issue REST**：`comments: []`（本轮 dispatch 确认成功空响应）；`state: OPEN`、`labels: [in-progress]`（与 brief/SA6/SA8 一致）。

## 2. Verdict

**approve** —— iteration 0 的唯一 MAJOR（**SA2-1**：指南 §7 既有裸 Asset 示例块处置未落字）**已落实并经本轮源码级复核成立**：D8(b) 显式声明既有 L158-162 裸块由带逐成员 doc 的目标块**整体替换而非增补**（块数不变式 1→1），并在 §1-G2/§2.2/§10/§11-ALLOW/§12/§13/§15 六处联动落字；SA6 §12.2 D3 的**逐块冻结谓词原样承接**（每块 doc-`\|` 配对 ≥2 + 自跟随 memberDocs），「弱化为按节聚合」的测试弱化路径在 D4/D8(b)/§12 三处显式否决并由 §15 复查清单第 6 项锚定——验收契约保持可执行且对「误读为追加」的走偏仍然鲜红。本轮全维度再攻击未发现新的 BLOCKER/MAJOR；新增 2 项非阻断观察（N7：D8(c) 一处行号笔误与 §2.2 自相矛盾；N8：AC2 字面口径与指南 §6 内联联合示例的关系登记）。`approve` 仅表示设计通过审查，不替代 SA4/SA7 对实现与活链路的验证；SA8 `requiresConflictRecheck = true` 的实现后复查义务（设计 §15 清单）不变。

## 3. 需求覆盖

| Requirement | Design section | Assessment |
|---|---|---|
| What-to-build：v1-spec §5 四类锚位 + M4 子规则（前导 `\|` 锚位 / 首成员起点锚位 / 连续 doc 同挂 / 坍缩维持 E305 / `\|` 夹缝与 M3 优先的不对称注明） | §7-D7(a)（六条子规则 + 单行/混合布局句） | 覆盖。子规则逐条锚定 SA6 §12.1 冻结观察（A1-A4/B1-B4/C1/C3/C5）；本轮对照 ADR 0019 决策 1/2/3 逐条吻合 |
| What-to-build：挂载示例补联合成员样本 | §7-D7(b)（§5 首个 `vfsl` 围栏块，多行前导 `\|` 布局） | 覆盖。本轮实读现行 §5 L414-424 为纯表格、围栏 0 个；A1 观察证明该块形态 `ok:true` 且 memberDocs 在场 |
| What-to-build：指南第 7/8 节补逐成员 doc 写法与示例 | §7-D8(b)/(c) | **覆盖（iteration 2 修复）**：§7 显式「整体替换而非增补」+ 块数不变式 1→1（本轮实读 §7 现恰 1 个围栏块于 L158-162，与处置对象逐行吻合）；§8 显式替换块内 Status 声明 L183-186（→ N7 行号笔误登记，非阻断） |
| What-to-build：检查表同步 | §7-D8(d) | 覆盖。冻结条目本轮核对命中 D4 谓词全部要素（联合✓枚举✓成员✓文档注释✓）；现行检查表 L275-287 无任何条目同时命中该谓词（今日确红） |
| What-to-build：源码与测试注释「三锚位」清扫为四锚位 | §7-D10（14 处逐处替换表） | 覆盖。本轮 `git ls-files` 独立 grep = 14 处 / 9 文件，全部行号与 D10 表逐行吻合（含 `docs/adr/0019:60` 唯一规范文档命中） |
| What-to-build：规格随实现同支累积（避免中间态） | §3 时序义务 + §13（#309 须在 PR #305 收官前落地） | 覆盖（SA8 Required action 5 承接） |
| AC1：§5 挂载规则/边界与实现逐条一致（含 E305 既有场景不变表述） | §7-D7（「既有场景不变 / 既有触发场景不变」显式在场）+ §12 | 覆盖。D7 冻结文本 20 needle 本轮逐项复核全命中（ADR 引用改连字符风格后 needle 零影响） |
| AC2：指南枚举/联合示例使用逐成员 doc、检查表覆盖 M4 | §7-D8 + §12（D3/D3b/D4） | **覆盖（iteration 2 修复）**：§7 旧裸块去向唯一可读（替换），落地后 §7 恰含一个带逐成员 doc 的 Asset 示例块，AC2 口径无歧义（§6 内联语法示例的关系登记为 N8，非阻断） |
| AC3：全仓「三锚位」无残留（dist 除外） | §7-D1（作用域裁定）+ §7-D10 + §12（D5①） | 覆盖。作用域 = tracked − `wiki/**` − `dist/**`；wiki 内 25 个 tracked 命中文件不改写，与 docs/AGENTS.md Authority L5 一致 |
| AC4：`git diff --check` 干净 | §7-D10 纪律 + §12（D5② spawnSync） | 覆盖。基线本轮实测干净 |
| ADR 0019 Consequences（文档面随实现落地；指南 §7/§8 与检查表同步） | 全文（§3/§4 表） | 覆盖 |
| #306 O-3（修订 §5 必须同支更新检查器与指南） | §7-D9 + §7-D8 | 覆盖 |

## 4. Owner评论覆盖

Issue #309 REST（本轮 dispatch 确认 + SA6 §2 + SA8 §2 三方一致）：**`comments: []`**——无 Owner 评论，无 owner-comment 硬性约束，亦无可用 override 来源。需求全集 = Issue 正文（What-to-build + AC1-AC4）+ ADR 0019 Consequences，设计 §4 的来源表与之逐条对得上，无遗漏、无静默扩大（§1 非目标显列出界项）。

## 5. 上游事实与SA8约束

| Fact or constraint | Design response | Assessment |
|---|---|---|
| SA6 §5.2 六条文档↔实现矛盾 | §7-D7 目标文本逐条对齐 A1-A4/B1-B4/C1/C3/C5 | 成立。本轮实读现行 §5 L405-409（三类文本）、指南 L204（三锚位句）与 SA6 引用逐字一致 |
| SA6 §5.3 红灯矩阵（D1-D5、G10/G17 红、G16 预存在红） | §7 修订后全转绿；G16 同票修（D3） | 成立。本轮复测当前态：§5 无 vfsl 块/无「四类」；指南 §7/§8 各 0 个成员 doc 对（§7/§8 各恰 1 围栏块，内容零 doc）；检查表无 M4（谓词逐条目核对无命中）；14 处残留；检查器 G16 标识循环含 `AssetsDoc`、L555 详情消息在场 |
| SA6 §5.4 残留清单 14 处/9 文件 | §7-D10 逐处替换表 | 成立（本轮独立 grep 三方一致，行号逐行吻合） |
| SA6 §9 X1-X7 控制变量 | §7-D7/D8 目标文本以 X2/X3/X6 已验证形态为蓝本 | 成立。X6 验证的是目标**形态**（wrapper + `YXmlFragment` 成员 + 多行前导 `\|`），冻结目标块的 doc 文案与 X6 探针文案不同——D3 自跟随断言使文案差异安全（设计 §8 可执行性已声明） |
| SA6 §12.1 冻结观察 A1-E2/I1 | 全部行为性陈述锚定 | 成立。本轮抽样复核：子规则 4 = B1/B2、子规则 5 = B3/B4+C5、子规则 6 = C1/C3、「夹缝叠写」推论 = C1+B4 组合，与 `semantic.ts:76` 现行四类枚举消息一致 |
| SA6 §12.2-12.5 可执行契约 | §7-D4 + §12 直接承接 | 成立。D3 逐块谓词逐字承接（见 §6/§12） |
| SA6 §15 U1-U5 开放点 | U1→D2、U2→D3、U3→D4、U4→D5、U5→SA8 已补齐 | 成立 |
| SA8 前置门禁 6 项 Required actions | §6 表逐条（D1/D2/D3/D5/时序/复查清单） | 成立 |
| SA8 设计后复审（iter 1 reject → iter 2 recheck clear） | §14 修订映射：悬空「§7.3」引用已删除、advisory 2/3 已落实 | 成立。本轮独立复测：v1-spec §7 为「信封形状」且全篇「坍缩」「7.3」0 命中；设计冻结目标文本（D5/D7/D8/D9）内「7.3」0 命中；D7(b) 发射位括号与 ADR 0019 L106-130 口径一致；先例 `compile-schema-envelope.test.ts` L45（`import { readFileSync }`）/L558（直接读 `../package.json`）本轮实读在场 |
| SA8 残余登记（`docs/adr/0019:64`、`parser.ts:347` 的 §7.3） | §13 follow-up 4（不纳入本票，理由 a/b） | 成立。登记路径冻结为 ADR 仅 L60，与两份 SA8 产物一致 |
| 冻结面（E305 面/IR/指纹金样本/derived/投影/codegen/wiki 零 diff/注释-only） | §1 非目标 + §11 DENY + §12 N1-N8 | 成立。金样本常量实测位于 L33-36；`semantic.ts:76` 正文已四类枚举、前缀冻结 |
| **iteration 2 新增面 vs SA8（SA2 独立裁定）**：指南 §7 块替换晚于 SA8 iteration 2 recheck（其被审对象为 iteration 1） | 设计 §15 声明「不新增 ADR 冲突面」 | **成立**。指南 §7 示例替换落在 ADR 0019 Consequences 点名的「schema-authoring-guide 第 7/8 节与检查表同步」义务范围内、既有 ALLOW 指南行内（该行自初版即覆盖指南全部四处修订，本轮仅预期改动描述被落字显式化），不触任何决策文本/冻结面/文件范围边界——与 iteration 0 SA2 §15 预裁定一致，无新冲突面，无需重开 ADR 冲突检查 |

**上游事实与源码矛盾检查（SA2 独立）**：未发现失真。SA1 的补充事实（exemplar 附录 fixture 仍为 `type AssetsDoc = YXmlFragment<…>`，本轮实读在场且 exemplar 全文 `ROOT` 0 命中）属实，D6 三件套同步推导经本轮源码核验成立（`run_checks` 无条件执行 G10/G17——本轮实读 main/--spec 路由无 spec/exemplar 分支；G16 期望改 `ROOT` 后现存 fixture 无 ROOT 标识必红，fixture 必须同步）。

## 6. 设计内部一致性

- **SA2-1 落实的内部一致性（本轮复核主体）**：D8(b) 现显式声明既有 §7 Asset 示例块（L158-162：围栏开行 + 裸声明 L159-161 + 围栏闭行，零成员 doc）由目标块**整体替换而非增补**，块数不变式「修订前后 `vfsl` 围栏块数均为 1（1→1）」，L154/L156 前导句与 L164 后继句保留不动，新增写法说明句置于 L156 句与目标块之间——「旧块去向」唯一可读。本轮实读指南证实处置对象精确：§7 现恰 1 个 vfsl 围栏块（L158 开/L162 闭），L154「在同步物化上下文中…」/L156「判别联合使用共同的字符串字面量字段…」/L164「联合对象的键空间…」三句逐字在场。该处置在 §1-G2、§2.2、§7-D8(b)、§10 指南读者行、§11 ALLOW 指南行、§12 AC2 行与敏感度行、§13 新增风险行、§15 复查清单第 6 项**八处联动一致**，无残留旧口径。
- **验收契约保持可执行（SA2-1 验收判词逐项核对）**：① D4 承接 SA6 §12.2 D3 冻结谓词**原样**——「取 `### 7.` 与 `### 8.` 各自 `vfsl` 块，`execBlock` 成功；每块内『`/** … */` 行 + 下一非空行以 `\|` 开头』对 ≥2 个，doc 原文逐字出现在 `derived.memberDocs` 值中」——本轮逐字比对无弱化，「按节聚合」弱化路径在 D4/D8(b)/§12 三处显式否决；② 目标块配对数本轮实测推演：§7 目标块恰 2 对（两条单行 doc + trimStart 后 `\|` 起行的成员行；谓词的 trimStart 精确化与指南两格缩进布局匹配）、§8 修订后块恰 2 对（ROOT 字段 doc 的下一行均非 `\|` 行，不计入）——均 ≥2，D3 绿可达成；③ execBlock wrapper 规则与块内容匹配（§7/§5 块无 `type ROOT` → 前置 wrapper，X6 已证；§8 块自带 `type ROOT` → 原样执行）；④ 耦合段推演正确：若误读为追加（1→2），§7 旧裸块配对 = 0 < 2 → D3 红，且新增风险行与 §15-6 把「红即修文档、不得软化断言」钉为实现纪律——测试弱化路径被锁死；⑤ D3b 已按 N4 钉住含「必须紧邻」的挂载目标句本身（本轮 grep 证实「必须紧邻」全指南唯一命中 L204，谓词无歧义、今日确红——L204 现文无「联合成员」）。
- **N1/N2/N3/N4/N6 吸收核对（iteration 2 声明 vs 正文）**：N1 → D5 冻结条目已补发射位/界线限定（与 D7(b) 同口径，锚 ADR 0019 决策 6 两处例外）；N2 → D7 needle 表末行已改「其余 9 项」（13−4=9，算术正确，D9-2 冻结 13 项列表不变）；N3 → D7(a)/(b) 冻结文本 ADR 引用已改「ADR-0019」「ADR-0001」连字符风格（本轮实读 §5 既有 L411 即「ADR-0001」，节内风格统一属实；D1 20 needle 与 G17 9 元组均不含 ADR 引用串，命中零影响）；N4 → D3b 钉句（见上）；N6 → D8(c) 括注澄清替换对象为 L183-186、围栏开闭行保留勿重复（**但该括注引入一处新行号笔误，见 N7**）。五项吸收全部兑现，§14 映射表与正文一致。
- **正文 ↔ 冻结文本 ↔ needle 契约**：D7(a) 冻结文本（iteration 2 版）20 needle + G17 9 元组本轮逐项复核全命中；G10 13 项由「三态表/边界段/`@tag` 段不动 + 四类枚举句」覆盖（其余 9 项逐字在场：`//`、`/* */`、`/** */`、忽略、原文、捕获、挂载、@tag、机器）。
- **G17 落点可行性**：`find_sec(lambda t: "注释" in t)` 在 v1-spec 唯一命中 §5「注释规则」（本轮标题全枚举证实）、在 exemplar 唯一命中 §4（同法证实）；find_sec/join_sec 为 `run_checks` 内闭包，G17 置于 G16 后可直用；判定总数 21→22 与源码结构清点吻合（G1-G6 六 + G7×六标记 + G8-G16 九 + G17）。
- **exemplar 闭环**：D6/D9 的 exemplar 三件套（§4 bullet 扩四类 + G17 全 9 元组 bullet + 附录 fixture 换 §10 逐字副本）使双入口 22/22 的推导成立——本轮核验 exemplar 唯一 vfsl 围栏在附录（L134），全文无 `ROOT` 标识（G16 修复后现存 fixture 必红，同步不可省）；D9 exemplar-3 的 fixture doc 行文本与 v1-spec §10 L516-518 逐字对应。
- **D10 措辞表**：14 处现文本轮逐行核对吻合（含 `semantic.ts:5` 过时注释的同步修正说明、`parse-vfsl-union-member-docs.test.ts:5` 现文逐字）；金样本常量 L33-36 不在改动内。
- **前后一致的分叉点（新发现，唯一）**：D8(c) 括注「其后闭围栏在 L187」与事实不符——指南 L187 为空行，§8 块闭围栏在 **L202**，且与设计自身 §2.2「L182-202（§8 块：Status L183-186 + ROOT L188-201 同一块）」的正确表述自相矛盾（→ N7，非阻断：替换对象 L183-186 正确、「其余字段示例不动」与「围栏开闭行保留勿重复」的操作性指令无歧义、D3 逐块谓词对围栏破坏性改动鲜红——见 §12）。

## 7. 状态机与并发攻击

本任务无运行时状态机（B5 零运行时语义）；攻击面为文档态、检查器判定态与验证路径。

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
|---|---|---|---|---|---|
| S1 | 三锚位基线（三面文档 + 14 处残留） | 部分落地（如只改 §5 漏指南 / 14 处清 13 / exemplar 三件缺一） | 对应 D1/D3/D4/D5①/G10/G17/G16 具名红，红因单一可归因（X4 已证单红） | 无（fail-loud 链完整，本轮复核各断言当前态确红） | 无 |
| S1b（iteration 2 强化） | 指南 §7 旧裸块在场 | 实现者把 D8(b) 误读为纯追加（旧块保留 + 新块追加，1→2） | §7 出现两个 Asset 块：旧块 execBlock 可过但 doc-`\|` 配对 = 0 < 2 → **D3 逐块谓词红**；正确修复 = 按替换落地，而非弱化断言 | 无（D8(b) 处置句 + 块数不变式 + D4/D8(b)/§12 三处否决弱化 + §13 风险行 + §15-6 复查项五重锁定；本轮推演配对数确认红因单一） | 无 |
| S2 | 修订完成态 | `git revert` 回滚文档 | Suite D/G10/G17 随同转红（红灯=缺口信号，回滚语义显式） | 无（§13 已声明） | 无 |
| S3 | 本地脏工作树 / CI 清洁检出 | D5② `spawnSync('git', ['diff','--check'])` | CI 绿；本地脏树红（与 AC4 工作树卫生语义一致） | 无 | 实现须将 spawnSync 的 error/非零 status 一律按红处理，不得吞（冻结谓词「exit 0 且 stdout 空」天然 fail-closed，落地时勿加 try/catch 软化） |
| S4 | CI 分片并行 / vitest maxWorkers 1 | 新测试与既有套件并发 | 全部断言只读（fs 读 + git 只读子进程 + 同步纯函数），无共享可变状态 | 无 | 无 |
| S5 | 重复事件/幂等 | 重跑检查器/测试；文档重复编辑 | 输出确定性（SA6 §7 两次 sha256 相等）；needle 计数幂等 | 无 | 无 |
| S6 | 合并后迟到变更（后续 PR 再引入「三锚位」措辞） | 任意后续提交 | D5① 在 CI 转红 → 缺口信号（契约设计的预期行为） | 无 | 无 |
| S7 | 多通道事实分叉 | 检查器 need/G17 与 Suite D needle 各自漂移 | 双通道同源 needle，改一处两处同红可定位（§13 风险 1 已登记） | 弱漂移风险（通道间无机械同步） | 无阻断（→ N5 观察项维持） |
| S8 | D5① 扫描遇非 UTF-8 tracked 文件 | 解码失败 | 显式跳过规则（SA6 §12.2 D5① 冻结） | 跳过规则若被泛化可能漏扫——本轮实测 tracked 命中全集为 9 个纯文本文件，现仓无此风险 | 无；实现宜将「跳过」限于解码失败项并保留计数报告 |

## 8. 错误与恢复攻击

| ID | Failure | Current design behavior | Risk | Required revision |
|---|---|---|---|---|
| E1 | 落地文本丢 needle（措辞微调即红） | 检查器 exit 1 + 具名「缺失要素」；Suite D 断言红并给出缺失 needle/块数/计数 | 无静默失败；红因单一（X4） | 无 |
| E2 | 示例块在现行实现下不合法（编辑笔误引入非规范记号） | execBlock 要求 `parseVfsl`+`evaluate` 双 ok，任一失败即红；无 skip/only/env override/fallback/吞错（§9 显式） | 无伪绿 | 无 |
| E3 | 注释编辑误触代码 token（B5 违例） | Suite C 68 tests + `pnpm typecheck` + `generate --check` 红；建议去注释 token 等价比对 | 已登记（§13 低风险） | 无 |
| E4 | git 子进程不可用/异常 | D5② 冻结谓词「exit 0 且 stdout 空」→ 非零即红 | 无伪绿 | 同 S3：error 路径按红处理，不吞 |
| E5 | exemplar 同步不完整（G16 修复后只改 §4 漏 G17 元组或漏 fixture） | `--spec` 入口红（D6 三件套缺一即红；本轮核验 exemplar 无 ROOT，fixture 同步不可省） | 已显式枚举三处并固化 ALLOW + 验收 22/22 | 无 |
| E6 | 文档虚构未实现行为 | 全部行为性陈述锚定 §12.1 冻结观察与 X6（docs/AGENTS L13 纪律） | 低 | 无（N1 吸收后 CONTEXT 条目已带发射位/界线限定） |
| E7 | 检查器改动越界（弱化 G1-G16 其余项） | §15 复查清单第 3 项显式核对「不弱化 G1-G16 其余项」；D9 改动面冻结为四类 | 低 | 无 |
| E8（iteration 2 新增核对） | §8 落地时围栏被误删/误分裂（如把 Status 拆成独立围栏块） | D3 逐块谓词：ROOT-only 块 doc-`\|` 配对 = 0 < 2 → 红；围栏缺失则 §8 块提取失败 → 红 | 已被契约覆盖 | 无（N7 行号笔误的缓释面同此——契约先红，红即修文档） |

## 9. 契约影响审查

| API or contract | Missing or weak caller handling | Evidence | Required revision |
|---|---|---|---|
| v1-spec §5 规范文本（读者：schema 作者、指南、检查器 G10/G17、Suite D D1/D2） | 无缺失。D7 冻结文本 20 needle 全命中（本轮独立复核，含 ADR 引用风格调整后的版本）；§4 错误码总表 L372 的 E305 行为通用措辞，§5 四类化后不产生新失真，零改动处置正确 | v1-spec L277-282/L372/L405-424 实读 | 无 |
| 检查器双入口（默认 spec / `--spec` exemplar） | 无缺失。D6 推导 exemplar 须同步三处；`run_checks` 无条件执行 G17（本轮实读 main/--spec 路由证实无分支） | checker L560-576 路由实读 | 无 |
| 指南读者（schema 作者 agent，AGENTS「Schema authoring」的落点） | **iteration 2 已闭合**：§7 旧裸块处置显式落字（替换、1→1），AC2「枚举/联合示例使用逐成员 doc」口径唯一可读；落地后 §7 不再残留无成员 doc 的联合示例 | guide L152-164 实读；D8(b) 处置句 + 块数不变式 | 无（§6 内联语法示例与 AC2 字面口径的关系登记为 N8，非阻断） |
| CONTEXT.md 词汇表消费者（全仓 agent） | 无缺失。N1 吸收后新条目带发射位/界线限定（`YPlainArray` 纯值子树与 `YXmlFragment` 不透明实参内无发射位），与 D7(b) 同口径；CONTEXT 现存 ADR 引用两种风格混用（本轮 grep 证实 L34/L47 连字符、L96 空格式），条目维持空格式不新增改写面 | D5 冻结文本 vs ADR 0019 决策 6；CONTEXT.md 风格 grep | 无 |
| E305 消息消费者（测试断言以前缀为锚） | 零改动；前缀冻结保持 | `semantic.ts:76` 实读（正文已四类枚举） | 无 |
| `pnpm test` / CI 分片器 | 新文件自动入 `vitest.config.ts` include 与 `scripts/ci-test-shard.mjs` 磁盘枚举（本轮实读两文件证实） | 配置实读 | 无 |
| 检查器潜在 CI 接入（未来） | 明确不在本票接入（B4 follow-up，AC 未要求）；全仓唯一引用在 exemplar 头注 | grep 实测 | 无 |
| README/REPORT 等 | grep 无三锚位/三类挂载命中（本轮 tracked 全集 grep 证实命中仅 9 文件） | grep 实测 | 无 |

## 10. 架构一致性与惯例审查

### 责任归属

| Behavior | Expected owner | Design location | Assessment |
|---|---|---|---|
| v1-spec §5 规范文本修订 | `docs/vfsl/`（语言规范权威） | D7 | ✓ |
| 指南与检查表修订（含 §7 旧示例替换） | `docs/vfsl/schema-authoring-guide.md` | D8 | ✓（iteration 2 后 §7 处置与 §5/§8 同为显式声明；替换而非并存符合 docs/AGENTS「explicitly amend」——文档面不留两个口径相异的同类示例） |
| 规格机器契约扩展 | `tests/acceptance/vfsl_spec_acceptance.py` 原位扩展（issue #4 机制本体） | D9 | ✓ 原位扩展，非平行新建 |
| CI-wired 文档契约测试 | `packages/vfsl/test/`（vitest include 的真实 CI 入口） | D4 | ✓ |
| 术语登记 | 根 `CONTEXT.md` | D5 | ✓（docs/AGENTS L9 义务；插于「标记类型」条目后，L49-51 先例实测在场；CONTEXT 现无锚位/挂载条目——本轮 grep 0 命中，新增不自冲突） |
| 挂载实现行为 | 不改（#306-#308 已落地；冻结面由 Suite C 承压） | §1 非目标 / §11 DENY | ✓ |

### 相似能力对照

| Similar capability | Existing implementation | Proposed design | Consistent or divergent | Reason |
|---|---|---|---|---|
| 规格文本结构化机器契约 | `vfsl_spec_acceptance.py`（结构性解析而非源码 grep，其 docstring 明示设计哲学） | G10 need 扩展 + G17 新增（同族结构：find_sec/join_sec + needle 合取） | 一致 | O-3 义务；判定 21→22 算术与源码结构吻合（本轮清点） |
| 测试内读仓文件 | `compile-schema-envelope.test.ts` L45/L558（直接 `readFileSync('../package.json')`） | Suite D 以 fs 读 `docs/**` | 一致 | packages/vfsl/AGENTS 接缝条款约束包运行时面，不禁止测试读仓文件；先例本轮实读在场 |
| 文档即产品的验收锚 | 检查器对交付物（文档）做结构断言的先例 | D1/D3b/D4 对文档文本断言 + D2/D3 自跟随执行 | 一致 | 同「交付物是文档、内容即产品」哲学；期望值取自文档自身，非源码 grep |
| 文档示例的显式修订（替换 vs 并存） | docs/AGENTS L10「Amend or supersede prior decisions explicitly instead of silently contradicting them」；指南历史修订（ROOT 约定票对 §1-§8 示例的原位替换） | D8(b)/(c) 替换既有示例块，非增补并存 | 一致 | 保留旧裸块 + 追加新块会在同一指南内留下口径相异的两个联合示例，正是「静默矛盾」形态；替换是惯例路径 |
| 金样本/指纹回归 | `parse-vfsl-union-member-docs.test.ts` L33-36 常量 | 零改动（DENY 明令） | 一致 | 冻结面 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| M4 挂载行为 | 实现（parser/semantic/ir）+ ADR 0019 | §5/指南/exemplar/CONTEXT 文本；检查器 G10/G17 与 Suite D 为文本的派生断言 | 低：全部行为性陈述锚定冻结观察；双通道 needle 同源（维护期见 N5） |
| E305 触发面与前缀 | 实现 + v1-spec §4 冻结项 | §5 文本表述 | 低：零消息改动，既有场景显式不变 |
| 指南 §7 联合示例的规范写法 | 替换后的目标块（唯一） | D3 逐块谓词派生断言 | 低：块数不变式 1→1 + 逐块谓词使「旧块复活」与「断言弱化」双双可检出 |

### 生命周期对称性

无运行时注册/释放面（B5 零运行时语义）。验证路径 V1-V4 均只读、失败 loud、无清理责任——对称成立。回滚 = `git revert` 单分支文档改动，无数据/持久化/兼容负担（§13 显式）。

### 平行机制检查

| Candidate duplicate | Existing path | Proposed path | Disposition |
|---|---|---|---|
| Python 检查器 vs Suite D vitest | 检查器（人工入口，未接 CI——本轮 grep 证实全仓唯一引用在 exemplar 头注） | Suite D（CI-wired 主判据） | **非平行重复**：入口不同（B4 follow-up 负责未来连接）、判据同源（D1 ⊇ G17）、SA6 契约明定双通道且给出否决备选的论证；SA8 已裁决。保持登记即可（N5） |
| 第二套措辞扫描/清理 worker | 无既有 | D5① 单一扫描断言 | 唯一（AC3 对象本体） |
| 第二评论读取路径 / API wrapper | 无 | 无新增 | — |

未发现行为落在错误 Owner、绕过既有能力、双事实源或生命周期不对称问题。

## 11. 文件范围审查

| Path or scope issue | Evidence | Required revision |
|---|---|---|
| ALLOW 15+1 项逐条与正文对应：v1-spec（D7）/指南（D8——**iteration 2 后指南行显式落字「§7 既有示例块替换（L158-162 裸 Asset 块 → 带逐成员 doc 目标块，vfsl 块数 1→1，非增补）」，SA2-1 的 ALLOW 同步要求已兑现**）/检查器（D9）/exemplar（D6）/新测试（D4）/ADR 0019 仅 L60（D2）/3 个 src 文件仅注释（D10 #2-#4，本轮实读确认三处均为注释行）/6 个测试文件仅注释与 describe 标题（D10 #5-#14 逐行核对现文吻合；金样本常量 L33-36 不在改动内）/CONTEXT.md 一条新增（D5） | §11 ALLOW vs §7 决策逐行对照 | 无 |
| ALLOW 路径集合与冻结面 iteration 2 零变化（§14 声明）——本轮逐行比对属实：仅指南行的预期改动描述被显式化，无新增/删除路径 | §11 vs iteration 1 版（§14） | 无 |
| DENY 与正文无冲突：`wiki/**`（D1 作用域 + N8）、`packages/vfsl-codegen/**`、金样本常量、`domains/*/generated.ts`、其余 ADR（登记路径冻结仅 L60）、其余 docs（本轮 grep 证实无命中/无契约变更）、`tests/acceptance/` 两文件之外（目录实测仅此两件）、workflows/package.json（B4）、README/REPORT（grep 无命中） | §11 DENY vs 本轮独立 grep | 无 |
| ALLOW 无无理由扩张；follow-up（B4 CI 接入、test-durations 刷新、不对称未来演进、§7.3 历史引用清扫）均不掩盖本任务必要项——B4 为 AC 外且 Suite D 已是 CI-wired 主判据；durations 文件不影响正确性（脚本注释明示，本轮实读） | §13 | 无 |

## 12. 验收设计审查

| Requirement or risk | Proposed evidence | Gap | Required revision |
|---|---|---|---|
| AC1 §5 与实现一致 | Suite D D1（20 needle）+ D2（示例块执行 + 自跟随 memberDocs）+ G10（13 项）+ G17（9 元组） | 无。本轮独立复核冻结文本 needle 全命中；现行态各断言确红 | 无 |
| AC1 E305 既有场景不变 | Suite C 既有四套件 68 tests 零改动重跑 + N3 前缀锚 | 无 | 无 |
| AC2 指南逐成员示例与检查表 | Suite D D3（**逐块谓词保持冻结**：每块配对 ≥2 + 自跟随）/D3b（钉「必须紧邻」句，本轮 grep 证实全指南唯一）/D4 | 无（iteration 2 修复后）。落地目标态配对数本轮推演：§7 恰 2、§8 恰 2，均 ≥2；§7 块数不变式 1→1 使「旧块复活」走偏可检出（旧块 0 配对 → 红） | 无 |
| AC3 措辞清零 | D5①（tracked − wiki − dist，needle join 防自命中）+ D10 逐处表 | 无。14 处基线本轮三方复核一致；目标文本（D5/D7/D8/D9/exemplar）均不含该词 | 无 |
| AC4 diff 卫生 | D5② spawnSync exit 0 且 stdout 空 | 无（S3/E4 按 fail-closed 落地即可） | 无 |
| O-3 检查器同支同步 | 双入口 22/22（D9 + D6 三件套） | 无。G17 无条件执行、exemplar 必须同步的推导经本轮源码核验成立（exemplar 无 ROOT，fixture 不同步必红） | 无 |
| 测试观察行为而非源码文本 | D2/D3 经真实 `parseVfsl`/`evaluate` 执行 + 自跟随；D1/D3b/D4 为交付物本体断言（文档即产品，检查器同哲学先例） | 无 | 无 |
| 旧实现真实为红 | §5.3 红灯矩阵——本轮独立复测现行态各断言全红（§5 无块/无四类；指南 §7/§8 各 0 对（各恰 1 块、零 doc）；检查表无 M4（逐条目谓词核对无命中）；14 处；G16 预存在红） | 无 | 无 |
| 错误路径伪绿风险 | 无 skip/only/env override/fallback；execBlock 双 ok；X6 证明目标示例形态在现行实现下合法（doc 文案与冻结文本不同——自跟随断言使文案差异安全，设计已声明）；S1b/E8 走偏形态（追加误读/围栏破坏）均落入 D3 红区 | 无 | 无 |
| 测试入口真实 | `packages/vfsl/test/` 命中 vitest include 与 CI 分片磁盘枚举（本轮实读两处配置/脚本） | 无 | 无 |

## 13. Required revisions

**无未决 BLOCKER / MAJOR。** iteration 0 的唯一 MAJOR 已由设计 iteration 2 落实并经本轮源码级复核确认解决，处置映射如下（保留稳定 Finding ID 供修订追溯，不再列为阻断项）：

| Finding ID | Severity | Evidence | Problem（iteration 0） | Resolution（iteration 2，本轮核验） | Acceptance 判定 |
|---|---|---|---|---|---|
| SA2-1 | ~~MAJOR~~（已解决） | 指南 L158-162（现行 §7 唯一 `vfsl` 块，裸 Asset 声明，零 doc）；iteration 1 设计 D8(b) 仅写「在判别联合说明后」，未声明既有块处置；SA6 §12.2 D3 为逐块谓词（每块配对 ≥2） | 按字面追加落地则旧块配对 = 0 < 2 使 D3 红、AC2 口径两可，并留下「弱化 D3 为按节聚合」的测试弱化路径 | **采用 SA2 二选一中的显式替换路径**：D8(b) 显式「整体替换而非增补」+ 块数不变式 1→1 + L154/L156/L164 句保留不动；§11 ALLOW 指南行同步落字；D4 承接 D3 冻结逐块谓词原样、三处显式否决弱化；§13 风险行 + §15 复查清单第 6 项锚定落地核对 | **达成**：修订后 D8(b) 对「L158-162 旧块去向」唯一可读（本轮实读指南证实处置对象与块数不变式基线精确）；落地后 §7 恰含一个带逐成员 doc 的 Asset 示例块（配对恰 2 ≥ 2），D3 绿、AC2 无歧义；验收契约（D3 逐块 + D3b 钉句 + D4）保持可执行且对追加误读/断言弱化双向敏感 |

**Blocking 判定**：0 BLOCKER / 0 MAJOR → verdict = approve。N1-N6 非阻断观察已全部吸收或维持登记（见 §14）；本轮新增 N7/N8 两项非阻断观察。

## 14. Non-blocking observations

1. **N1（CONTEXT 新条目概括偏宽）——已吸收**：D5 冻结条目已补「（发射位与界线见 ADR 0019 决策 6——`YPlainArray` 纯值子树与 `YXmlFragment` 不透明实参内无发射位）」，与 D7(b) 同口径；条目文本不含「三锚位」字样（D5 扫描作用域安全），本轮核对。
2. **N2（needle 核对表算术笔误）——已改正**：末行现为「G10 其余 9 项」（13 − 4 = 9）；D9-2 冻结的 13 项 need 列表不变。
3. **N3（ADR 引用风格混排）——已吸收**：D7(a)/(b) 冻结文本内改为「ADR-0019」「ADR-0001」连字符风格，与 §5 既有 L411 节内风格统一；needle 零影响（needle 集不含 ADR 引用串）。指南/CONTEXT 冻结文本维持空格式（CONTEXT 现存两种风格混用，本轮 grep 证实），不新增改写面——可接受。
4. **N4（D3b 谓词载荷）——已吸收**：D3b 钉住含「必须紧邻」的挂载目标句本身并断言「联合成员」+ 四类齐全；本轮 grep 证实「必须紧邻」全指南唯一命中 L204，谓词无歧义且今日确红。
5. **N5（双通道 needle 同源维护）——维持登记**：Python 检查器与 Suite D 双通道判据同源（D1 20 needle ⊇ G17 9 元组），任一端调整须两端同步；§13 风险 1 登记 + B4 follow-up 负责未来 CI 连接，保持即可。
6. **N6（D8(c) 行号含围栏线）——已吸收（但吸收文本引入 N7 笔误）**：替换对象已澄清为 §8 块内 Status 声明 L183-186、围栏开闭行保留勿重复。
7. **N7（新发现：D8(c) 括注闭围栏行号笔误，iteration 2 引入）**：D8(c) 写「其后闭围栏在 L187」——本轮实读指南 L187 为空行，§8 块闭围栏在 **L202**，且与设计 §2.2 自身的正确表述「L182-202（Status L183-186 + ROOT L188-201 同一块）」矛盾。不阻断的理由：①替换对象（L183-186）与操作性指令（「其余字段示例不动」「围栏开闭行保留勿重复」「§8 的 ROOT 示例块含 `type ROOT`，D3 不加 wrapper 原样执行」）本身无歧义且与 §2.2 一致；②任何围栏误删/误分裂落入 D3 红区（ROOT-only 块 0 配对 → 红），契约先于伤害生效。建议实现票落地时以 §2.2 的 L182-202 为准（或顺手把 D8(c) 括注改为 L202）。
8. **N8（新登记：AC2 字面口径与指南 §6 内联语法示例的关系）**：指南 §6（L135-141 围栏块）含 `type Status = "draft" | "published";`、`type Port = 80 | 443;` 等内联联合/枚举字面量示例，本票不改、不加成员 doc。AC2 的权威范围由 Issue What-to-build 显式钉在「第 7/8 节 + 检查表」，SA6 冻结的 D3 亦只覆盖 §7/§8，§6 为值约束语法示意（一行一构造，逐成员 doc 反而破坏其教学形态）——不构成缺口，登记以免后续把 AC2 字面读法扩大到 §6。

## 15. 复审后处置说明

- **verdict = approve**：SA2-1 已按 iteration 0 给出的二选一中的「显式替换」路径落实（整体替换 + 块数不变式 1→1 + ALLOW 落字），验收契约（SA6 §12.2 D3 逐块冻结谓词 + D3b 钉句 + D4）原样保持且可执行；N1-N6 全部吸收或维持登记；本轮全维度再攻击（需求/上游事实/内部一致性/状态机/错误恢复/契约/架构/文件范围/验收设计）未发现新的 BLOCKER/MAJOR。
- `requiresConflictRecheck = false`（本轮无新 ADR 冲突面）：iteration 2 修订（指南 §7 块替换 + 非阻断观察吸收）不触任何 ADR、冻结面、文件范围边界或验收入口——指南 §7 示例替换落在 ADR 0019 Consequences 点名的「第 7/8 节同步」义务与既有 ALLOW 指南行内，与 iteration 0 §15 预裁定一致（§5 末行）。SA8 既有 `requiresConflictRecheck = true` 的**实现后**复查义务（设计 §15 六项清单，含第 6 项 §7 块替换落地核对）不因本裁决失效，由总控按流程路由。
- 本轮新增的 N7（D8(c) 行号笔误）与 N8（AC2 §6 口径登记）均不阻断实施；N7 建议实现票落地时以 §2.2 的正确区间（L182-202）为准。
- 设计已具备实施就绪性：证据基线零失真、目标文本冻结到 needle 可命中形态、冻结面与 DENY 边界清晰、验收映射逐条可执行。后续由 SA4 审查实现、SA7 做活链路最终验证。

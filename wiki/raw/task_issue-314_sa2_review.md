# SA2 设计攻击评审 — issue #314：VFSL 数字字面量拓宽（负号与小数）

- 被审对象：`wiki/raw/task_issue-314_design.md`（SA1 design **iteration 3**，dispatch 述为对
  iteration 2 的原位修订，唯一目的 = 落实本评审 iteration 0 的 MAJOR F1 + 吸收 7 项非阻塞观察）
- 评审基线 HEAD：`29ff10f843a4d877866e963cedc8766d60194d33`（分支 `mabf/issue-314`，与设计/契约/
  SA8 复查基线同一提交；本轮 `git status` 复核：仅 5 个未跟踪 wiki 流水线产物，源码零改动）
- 评审模式：独立攻击审查；只读源码/ADR/规范/测试与固定流水线产物，不运行测试、不启动服务、
  不修改设计与业务代码
- 评审产物：本文件（唯一可写产物；iteration 1，原位更新 iteration 0 版）
- 上轮评审：iteration 0（dispatch `sa-cfd4f7f8…`，verdict **reject**：1 × MAJOR F1、0 × BLOCKER、
  7 项非阻塞观察）——技术核心逐条核验成立、未被要求变更

---

## 1. Reviewed inputs

| 输入 | 状态 | 取用方式 |
| --- | --- | --- |
| `wiki/raw/task_issue-314.md`（Host 简报） | 存在（33 行；comments REST `[]`，正文 `## Comments` 为空） | 全文 |
| `wiki/raw/task_issue-314_design.md`（SA1 设计） | 存在（570 行，**iteration 3**） | 全文逐节；重点独立复核 F1 修订面（§5-D7-6、§5-D7-审计、§9 ALLOW、§14 映射）与「技术核心原样保留」声明 |
| `wiki/raw/task_issue-314_sa6_contract.md`（SA6 验收契约，accepted） | 存在（577 行） | 全文；§5 目标表 (1,25) 锚位仍按设计「B-补 2」勘误 (1,26) 处理（iteration 0 已独立复核，SA8 双重复核一致） |
| `wiki/raw/task_issue-314_design_conflict_report.md`（SA8 设计后冲突复查） | 存在（181 行，**iteration 1**，原位取代 iteration 0；verdict `clear`、`requiresConflictRecheck: true`） | 全文；其 §3 行 11/§6.1 以扩充模式组独立重跑确认矛盾陈述恰六处，与本评审复核三方一致 |
| `task_issue-314_relevant_decisions.md` / `task_issue-314_conflict_report.md`（任务前置 SA8 产物） | 不存在（设计 §1、SA6 §1、SA8 复查 §1 三方一致确认） | 以 ADR 全集 + v1-spec + 模块 AGENTS 为约束基准替代 |
| 源码/文档事实锚点 | 全部存在 | **F1 相关面逐条独立重验**（见下） |

**F1 修订面独立核验记录（本轮新增，全部在 HEAD 29ff10f 上直接读取/grep，非转述设计）：**

1. **第六处陈述实存**：`docs/vfsl/schema-authoring-guide.md:216` 原文「只使用以下构造：类型别名、
   封闭对象、可选字段、原始类型、**字符串或整数文字**、联合、数组、`Record`、六个标准标记和注释。」
   ✓（设计 B14/D7-6 引述逐字一致；`:145`「数字字面量仅支持无符号十进制整数；」同文件核验 ✓）
2. **六处矛盾陈述清单独立复核**：本评审以设计 D7-审计 的模式组
   `无符号|整数文字|数字字面量|负数|小数|负号|十进制|字面量|NumberLiteral|digit` 对
   `docs/**/*.md`（排除 `docs/adr/`）重跑，再逐一剔除已列六处后检视全部残余命中；另加
   `整数|integer|[0-9]` 交叉复核、英文探针（`unsigned|integer literal|decimal literal|negative
   number|non-negative|integer`）、`CONTEXT.md`/根 README/README_zh、`packages|domains|apps` 各
   README、以及 `-0` 字样扫描。**结论：矛盾陈述穷尽恰六处**（v1-spec `:63`/`:83-84`/`:118`/`:358`
   ＋ guide `:145`/`:216`），无第七处——与设计 §5-D7-审计、SA8 复查 §6.1 独立重跑三方一致。
   残余命中逐类核验为一致面或无关：v1-spec `:31/:33`（§2 允许语法种类级列举，「字面量联合」
   不约束 number 形态；NumberLiteral 的规范约束在 `:63`，即编辑点 1）、`:37/:64/:386`（词法元
   符号）、`:55`（LiteralType 两类成员——负数/小数仍是 number）、`:80/:85-89/:119`（字符串字面量/
   注记 8 种类/布尔）、`:125/:134/:140/:183/:365/:495/:572`（形状规则/Ident/信封 version/附录示例）；
   guide `:70`（source id）、`:118/:156/:178/:186/:212`（Record 键/字符串字面量/JSDoc）；
   `instance-replication-v1.md:506`（WS ping「无符号 64-bit」wire 凭据）及 `:674/:729-744/:763`
   （wire 稳定字面量类别）；`hub-peer-deployment.md:136`（retention 配置）；
   `external-project-vfsl-codegen.md:404/:415`（TS 路径字面量）；`why-nomicore.md:71/:79/:81`
   （动机叙事）；guide `:184/:207`（JSDoc「非负整数」字段语义示范）；CONTEXT.md `:61/:120`
   （字面量联合术语，种类级）。英文探针与各 README 零命中。
3. **第六处编辑的锚面安全性独立核验**：`spec-docs-anchor-m4-contract.test.ts` 全文读取——
   `'## v1 语法护栏'` 仅在 `:164` 作 §8 的 `readSection` **结束边界**（标题不动即边界不动）；
   D3 逐块断言只作用于 §7/§8 各自的 ```vfsl 块（设计 D7-5 的可选示例增补在 §6，不入 D3 面）；
   D3b 以整文件 `indexOf('必须紧邻')` 取首现段落并要求含「类型别名/对象字段/标记类型/联合成员」
   四针——现首现在 `:212` JSDoc 挂载段（四针齐备）；设计的 `:145`/`:216` 目标文本用「负号**须**
   紧邻（数字）」，不含「必须紧邻」串，不夺首现 → Suite D 不受六处编辑影响（见观察 2 的措辞
   约束）。`tests/acceptance/` 无指南引用（grep 零命中）。
4. **B15 复核**（iteration 0 已全仓独立 grep 恰 4 处断言/2 文件，HEAD 未动，顺延成立）；
   **B-补 2 (1,26) 锚**（iteration 0 已核 `parser.ts:388-393` 锚 `&` 记号机制，顺延成立）。

---

## 2. Verdict

**`approve`** —— 无 BLOCKER、无 MAJOR。

iteration 0 的唯一阻断项 **F1（MAJOR：规范文档同步面遗漏第六处陈述）已在 iteration 3 完整落实并经
本评审独立复核消除**：(1) §5-D7-6 给出 `:216` 整句目标文本（「字符串或数字文字（可选负号与十进制
小数；负号须紧邻数字）」）；(2) 新增 §5-D7-审计 修正方法论（单一「无符号」模式 → 十词模式组 +
`整数`/`integer`/`[0-9]` 交叉），穷尽清单恰六处、排除项逐类登记；(3) §9 ALLOW guide 行增列
`:216`；(4) B14/§6 行 4/§12-C6/§13-R6/头注五处口径同步。本评审以同模式组独立重跑证实「恰六处、
无第七处」（含 docs/ 外 CONTEXT/README 与英文探针），第六处编辑不触 M4 Suite D 与 acceptance
机检锚面。7 项非阻塞观察全部按承诺吸收（§14 映射逐行核对属实）。技术核心（D1–D6、锚位矩阵、
T1/T2、C1–C7、B15、(1,26) 勘误）声明原样保留且 HEAD 未动，iteration 0 的逐条攻击核验顺延成立。
设计对 SA6 契约无未承接验收项（C6 反而超出契约补强第六处＋grep 机检）；与 SA8 iteration 1 复查
（clear）结论互恰。残余 3 项新观察均为非阻塞（见 §14）。

`pass` 语义以本设计评审辖域为限：实现与活链路仍须 SA4/SA7 按 C1–C7 与 SA8 三项实现期复查核对
（六处文档同 PR 落地、D2 触发器零漂移、锚位变化清单穷尽）。

---

## 3. 需求覆盖

| Requirement（Issue 正文/AC） | Design section | Assessment |
| --- | --- | --- |
| 文法 `-? [0-9]+ ('.' [0-9]+)?` 全局生效 | §5-D1/D2、§7 扫描算法、§8 边界表 | 覆盖（iteration 3 未触动，iteration 0 核验顺延） |
| 负号紧邻数字、作为 number 记号一部分扫描 | §5-D1（单 token + 原始文本码元前看） | 覆盖 |
| 裸 `-` 维持未知字符 E100 路径 | §5-D1 入口条件 + §8 表 + C2 | 覆盖 |
| `.5` / `1.` / `1e3` 维持 E100 | §5-D2 + C2 | 覆盖 |
| 超双精度（含负值）沿既有域闸门 E100 | §5-D5 | 覆盖 |
| `-0`（含下溢形态）解析期 E100、消息引导写 `0` | §5-D4（`Object.is` 值判定） | 覆盖（iteration 3 增观察 2 落地建议：消息改引仓内权威） |
| AC1–AC5（联合成员 validate f64 严格相等 / 负例锚位 / 超域 / 指纹零漂移 + 合法 TS / 门禁全绿） | §12 C1–C7 | 覆盖 |
| 文档与实现同 PR（ADR 0020 决策 10 隐含义务） | §5-D7（**六处**编辑）+ §5-D7-审计 + §9 ALLOW + §12 C6 + §13-R6 | **覆盖（F1 已解决）**：六处目标文本齐备、ALLOW 全列、C6 人工评审项 + 扩充 grep 机检证据双确认 |

目标/非目标无静默扩大：Int/Range、指数记号、运行时 number 基线（#312/ADR 0021）、方言 v2/
指纹升版、十六进制、生成文本回读——均以决策原文为据显式排除（§1 非目标表逐行复核无变化）。

## 4. Owner评论覆盖

Issue #314 comments REST 读取返回 `[]`，简报 `## Comments` 为空——无 owner 追加要求，无 Comment ID
可映射。设计 §4、SA6 §2、SA8 复查 §2 三方一致。**无缺口。**

## 5. 上游事实与SA8约束

| Fact or constraint（来源） | Design response | Assessment |
| --- | --- | --- |
| SA6 §5 正例矩阵全红 / §6 负例对照保持 / `-1e3` 锚位唯一登记变化 | §5-D1/D2/D4/D5 + §8 + C2 | 成立（iteration 0 核验顺延；`-1e3`@(1,25) 与 `-1 & string`@(1,26) 口径全文统一） |
| SA6 §6/§9 `-0` 家族值判定 + 消息引导 `0`；§8 JSON.stringify(-0) 坍缩放大因素 | §5-D4 + §3 | 成立 |
| SA6 §10 影响面清单仅列 errors.test:58 | B15 补充 r3-regression 3 处 + §9-T2 | 成立（iteration 0 独立 grep 复核恰 4 处） |
| SA6 §5/§12.2 `-1 & string` 目标锚 (1,25) | 「B-补 2」勘误 **(1,26)** | 勘误成立（iteration 0 核验 `parser.ts:388-393`；SA8 双重复核；C1 明示勿按契约原文落地） |
| SA6 §12.0 测试总则（公共接缝、完整 ROOT 模块、禁软化、码+锚双钉） | §12 各 C 项 | 遵守（T1 重组偏离维持已登记口径，观察 7→§14 行 7） |
| `packages/vfsl/AGENTS.md` 兼容性行为（错误码/issue 顺序/行列/指纹输入） | §6 约束表 + §10 | 落实（零新增错误码；`-0` 复用 E100 有 ADR 0020 决策 3 修订句 + v1-spec §8 首次发布前豁免授权） |
| `packages/vfsl-codegen/AGENTS.md` + ADR 0005 字节稳定 | §5-D6、DENY | 落实 |
| ADR 0020 决策 1/3/5/7/10、决策 9 supersede | 全文 | 落实（SA8 iteration 1 §3 十五行对照复核，本评审抽读无矛盾） |
| D2 指纹升级触发器（`fingerprint.ts:7-13`「**v2 方言」限定词） | §6 裁定不触发 + §15 提交复查 | 裁定可辩护；SA8 iteration 1 行 10 复核 `no-conflict`；owner 翻案须另立 ADR（R3） |
| **docs/AGENTS.md「更新所有陈述该契约的规范文档」+ ADR 0020 决策 10 同 PR** | §5-D7 六处 + §5-D7-审计 | **成立（F1 已解决）**：本评审独立重跑扩充审计证实穷尽恰六处；ADR 0020 `:10-11` 史料句排除正确（`docs/adr/**` append-only，DENY LIST）；instance-replication「无符号 64-bit」wire 凭据排除正确 |
| SA8 iteration 1 复查（clear，15 项对照：no-conflict ×5 / implements ×10 / hard ×0） | 设计 §15 三点自报待复核 | 一致；其 `requiresConflictRecheck: true` 的三项实现期核对义务（六处文档落地、D2 零漂移、锚位清单穷尽）已并入 C5/C6/C7 验收面 |

## 6. 设计内部一致性

| 检查点 | 结论 |
| --- | --- |
| 六处口径全文统一 | ✓：头注、B13/B14、§5-D7（含 -6 与 -审计）、§6 行 4、§9 ALLOW、§11 文档读者行、§12-C6、§13-R6、§14 映射、§15 均为「六处」；残留「五处」字样仅出现在**历史引述**语境（描述 iteration 2 遗漏与 SA8 iteration 0 作废声明），无现行口径冲突 |
| iteration 3 修订范围声明 vs 实际 diff | ✓：逐节比对，改动恰为 F1 四点 + 观察 1/2/4/5 修正 + 观察 3/6/7 登记；D1–D6 伪代码/闸门/边界表/T1/T2/C1–C5/C7 文本与 iteration 2 语义一致（「原样保留」声明属实） |
| 死引用/旧 API | 无（iteration 0 观察 1 的路径笔误已在 §11 行 3 勘误为 `packages/vfsl/src/schema-check-cli.ts`） |
| 前后相反描述 | 无（iteration 0 观察 5 的 D7-3「行数结构不变」自矛盾已改写为「一删一增、无机检依赖」并明文废弃旧措辞） |
| §7 措辞口径 | 已收窄为「码+锚不变」并登记 `1 -1` 族消息正文变化、`Record<-0,string>` 相位前移为自然 fallout（iteration 0 观察 4 落实） |
| 与 SA8 报告的引用时序 | 设计头注/§15 将 SA8 复查引为「iteration 0、14 项对照」；盘上报告已是 **iteration 1**（15 项，审的正是本设计 iteration 3，原位取代 iteration 0）。实质结论互恰（六处、clear、D2、(1,26)），属产物交叉时序的过时引用，见观察 1（非阻塞） |

## 7. 状态机与并发攻击

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
| --- | --- | --- | --- | --- | --- |
| S1–S4 | （沿用 iteration 0 四项攻击：文本序首错胜出 / `-0` 先于后续词法错 / 重复·并发恒同 / 403+ 字符 O(n) 单遍） | — | — | 无（全链同步纯函数、单错误即失败、无共享状态；iteration 3 未触动该面，核验顺延成立） | 无 |

## 8. 错误与恢复攻击

| ID | Failure | Current design behavior | Risk | Required revision |
| --- | --- | --- | --- | --- |
| E1–E7 | （沿用 iteration 0 七项攻击：文本判定漏下溢 / `===0`·`isNaN` 误写 / 负值跳过有限闸门 / -0 漏拒进 IR 坍缩 / 静默宽松 / `-1e3` 特判拉回 / 伪成功） | C1/C2 判别对 + D1/D2/D4 分支条件构造性排除 + H4/H5 排除 | 已封死（iteration 3 未触动；SA6 §12.9 突变矩阵逐弱实现映射到具体断言） | 无 |

失败即诚实：非法形态解析期 loud 拒绝携行列；`-0` 消息引导写 `0`；无静默降级。回滚 = 单 PR revert。

## 9. 契约影响审查

| API or contract | Missing or weak caller handling | Evidence | Required revision |
| --- | --- | --- | --- |
| `parseVfsl` 等公共管线 / `tokenize`·`Token` 内部结构 / 下游消费方 / 生成物 TS 消费方 | 无——签名/返回/错误联合零变化；可解析文本集合纯扩大；纯加法 | B10/B11、§7、§11 矩阵（iteration 0 核验顺延） | 无 |
| 断言旧行为的测试（B15 4 处/2 文件） | 无——T1/T2 载体替换保码保锚 | §9-T1/T2 | 无 |
| `packages/vfsl/src/schema-check-cli.ts` | 无（iteration 0 观察 1 路径笔误已勘误） | §11 行 3 | 无 |
| **文档读者（spec/指南契约面）** | 无——六处编辑目标文本齐备（含第六处护栏句整句文本） | §5-D7 1–6、§11 末行 | 无 |

## 10. 架构一致性与惯例审查

### 责任归属

| Behavior | Expected owner | Design location | Assessment |
| --- | --- | --- | --- |
| `-`/`.` 记号扫描 | tokenizer | §5-D1/D2 | 正确 |
| `-0`/有限性值域闸门 | parser 字面量分支（既有闸门同位） | §5-D4/D5 | 正确 |
| enum 折叠/严格相等/投影 | evaluate/validate/codegen（零改动 + DENY） | §5-D6 | 正确 |
| **规范陈述面审计方法** | SA1 设计（docs/AGENTS 义务的执行者） | §5-D7-审计（模式组 + 穷尽清单 + 排除项登记） | 正确且可复现——本评审同模式组重跑得到同一穷尽结论 |

### 相似能力对照

| Similar capability | Existing implementation | Proposed design | Consistent or divergent | Reason |
| --- | --- | --- | --- | --- |
| 词法拓宽先例 / 值域闸门先例 / 哨兵测试先例 / `.test-d.ts` 先例 | （iteration 0 四行对照） | 不变 | 一致 | iteration 3 未触动 |
| **文档同步面审计先例** | docs/AGENTS「update every normative document whose stated contract changed」 | 六处编辑 + 模式组审计 + C6 机检证据 | 一致 | 审计方法可复现、结论三方一致（SA1/SA8/SA2）；「文字」→「数字文字」措辞沿用 `:216` 原句风格，D7-6 已显式论证 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
| --- | --- | --- | --- |
| 字面量文法 | v1-spec §2 EBNF + 注记 7 | tokenizer 实现 + 指南两处口径 | 低（六处同步 + C6 双确认闭环；**上轮 F1 所在的护栏句漂移点已闭合**） |
| 数值域/-0 规则 | ADR 0020 决策 3 修订句 | D4 实现 + spec 注记 7 改写 | 低 |
| 指纹 | `fingerprint.ts` 单一生产者 | C5/既有 pin 测试 | 无新增 |

### 生命周期对称性

纯函数管线：无 register/dispose、start/stop 面；单 PR revert 完全回退。**无不对称风险。**

### 平行机制检查

| Candidate duplicate | Existing path | Proposed path | Disposition |
| --- | --- | --- | --- |
| 指纹哨兵（C5 vs 既有 pin） | `parse-vfsl-union-member-docs.test.ts:34` | C5 任务域独立哨兵 | 保留（观察 3 登记口径维持） |
| 第二套文档陈述审计 | docs/AGENTS 义务 | §5-D7-审计 | **方法论缺陷已修复**：单一「无符号」模式扩为十词模式组 + 交叉模式，本评审重跑验证穷尽 |

## 11. 文件范围审查

| Path or scope issue | Evidence | Required revision |
| --- | --- | --- |
| ALLOW 两条源码 ↔ B1–B4 缺口 | §9 ↔ §5 | 无 |
| ALLOW 测试面（5 新建 + 2 既有）落在 vitest include/CI 分片发现面 | `vitest.config.ts:15-21`；B17 | 无 |
| **ALLOW guide 行列 `:145` + `:216` 两句** | §9 ↔ D7-5/D7-6 ↔ D7-审计穷尽清单 | 无（**上轮 F1 缺口已闭合**） |
| ALLOW spec 行恰四处（`:63`/`:83-84`/`:118`/`:358`），DENY 明列 §3/§5/§7/§8/§10 与未列行 | §9 ↔ D7 1–4 ↔ R5（机检面核验顺延；第六处编辑不在 spec，不新增机检接触面） | 无 |
| DENY 与正文无冲突（下游链/指纹/codegen 源/fixture/ADR/机检脚本/配置） | §9 ↔ §5-D6/§6 | 无 |
| follow-up 不掩盖本任务必要项；T1/T2 为任务内交付 | §13 | 无 |

## 12. 验收设计审查

| Requirement or risk | Proposed evidence | Gap | Required revision |
| --- | --- | --- | --- |
| AC1–AC5（C1/C2/C3/C4/C5/C7） | （iteration 0 逐项核验顺延：值断言 f64 归一、码+行列双钉、下溢判别对、(1,26) 勘误值落地、tsc 0 诊断、指纹全值钉死、红→绿序列） | 无 | 无 |
| **AC5 文档（C6）** | acceptance 脚本 exit 0 + 人工评审项**六处**（注记 7/微示例/E100 码表行/指南 `:145`/**指南 `:216` 护栏句**）逐句对照目标文本 + **扩充模式组 grep 机检**（排除 docs/adr/ 后无矛盾陈述残留） | 无（上轮 F1 所指「C6 判据失败」已修复：评审清单与机检证据均含第六处） | 无 |
| 回归翻转面 | T1/T2 焦点运行 + R-1 三锚位数值不变 | 无 | 无 |
| **Suite D / 机检锚面（iteration 3 新核验）** | `'## v1 语法护栏'` 仅作 §8 结束边界（标题不动）；D3 只断言 §7/§8 的 vfsl 块；D3b 首现「必须紧邻」仍在 `:212` 段（目标文本用「须紧邻」不夺首现）；`tests/acceptance/` 无指南引用 | 无（前提：目标文本逐字落地——见观察 2 措辞约束） | 无 |

## 13. Required revisions

| Finding ID | Severity | Status | Evidence | Resolution & verification |
| --- | --- | --- | --- | --- |
| F1 | MAJOR（iteration 0） | **已解决（本轮复核通过）** | guide `:216`「字符串或整数文字」原句实存（本评审 HEAD 直读逐字核验）；iteration 2 仅五处 + 单一「无符号」grep | 设计 iteration 3 四点落实（D7-6 目标文本 / D7-审计 模式组与穷尽清单 / ALLOW 增列 / 五处口径同步），本评审独立重跑扩充审计证实**恰六处、无第七处**（含 CONTEXT/README/英文探针），第六处编辑锚面安全。验收条件（六处清单 + `:216` 目标文本 + C6 评审项含护栏句 + 扩模 grep 证据）全部满足 |

**当前无 BLOCKER 或 MAJOR。无新增阻断项。**

## 14. Non-blocking observations

1. **SA8 报告引用时序过时（纯文档准确性）**：设计头注与 §15 将设计后 SA8 复查引为「iteration 0、
   14 项对照」，而盘上 `task_issue-314_design_conflict_report.md` 已是 **iteration 1**（15 项对照，
   审的正是设计 iteration 3，且声明原位取代 iteration 0）。系产物交叉时序所致：设计 §15 预告
   「下一轮复查应把六处清单纳入核对范围」，SA8 iteration 1 已照此执行并确认。实质结论（六处、
   clear、D2 不触发、(1,26)）三方互恰，无实施风险；SA3/SA4 以盘上 iteration 1 报告为准即可。
2. **指南目标文本的「须紧邻」措辞是 Suite D 安全的隐性前提**：`spec-docs-anchor-m4-contract.test.ts`
   D3b 以**整文件** `indexOf('必须紧邻')` 取首现段落并要求四针（类型别名/对象字段/标记类型/联合
   成员）。设计的 `:145`/`:216` 目标文本用「负号（**须**）紧邻（数字）」，不含「必须紧邻」串，
   故首现仍在 `:212` JSDoc 挂载段，Suite D 保持绿。若 SA3 落地时改写为「负号**必须**紧邻数字」，
   D3b 将假红（首现段落落入注意列表/护栏句，缺四针）。建议 SA3 逐字落地 D7-5/D7-6 目标文本；
   SA4 复核时把「指南两处不含『必须紧邻』串」纳入检查点。C6「逐句对照 §5-D7 目标文本」判据
   已隐式覆盖，无需设计修订。
3. **D7-审计一致面登记的粒度**：审计表「同文件一致面，不改」按类别列举代表行（v1-spec `:55`/
   注记 8/`:37`/`:386`/`:495`），未逐行列出全部残余命中（如 v1-spec `:31/:33/:64/:80/:119`/
   `:125/:134/:140/:183/:365/:572`、guide `:118/:156/:178/:186/:212`）；SA8 §6.1 的逐行 itemization
   更全。本评审已逐条检视全部残余命中，无一构成矛盾陈述，穷尽结论不受影响。纯登记粒度差异，
   供 SA4 实现期按 SA8 逐行清单核对即可。
4. （沿用 iteration 0 观察 2，设计已增落地建议）D4 示例消息引用仓外 ADR 0021：设计已建议改引
   仓内权威（修订后注记 7 / ADR 0020 决策 3 修订句）或去 ADR 引用；SA3 酌情，码锚不动。
5. （沿用 iteration 0 观察 3）C5 与既有指纹 pin 轻微重叠：维持登记，若 fixture 合法演进两处同步。
6. （沿用 iteration 0 观察 6）C1 全局位置表混列 E306/E100 期望：SA3 落地按期望分组断言。
7. （沿用 iteration 0 观察 7）T1 与 SA6 §10 建议的重组偏离：维持已登记合理重组（`-0` 一锚留守 +
   C2 双钉矩阵更全），供 SA4 知悉。

---

— SA2 Reviewer（Wallfacer）· dispatch `sa-89546928-4e89-44cd-a64f-d1c1eb1fcd92` · iteration 1
（原位更新 iteration 0；上轮 verdict reject → 本轮 **approve**）

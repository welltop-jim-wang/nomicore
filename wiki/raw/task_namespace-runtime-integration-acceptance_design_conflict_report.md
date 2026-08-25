# 冲突门禁报告（设计后复审）

- 被审对象：SA1 设计 `wiki/raw/task_namespace-runtime-integration-acceptance_design.md`（R1，251 行，全读：§0–§9、D1–D6、§4 修订草案、§5 协议、§7 文件清单）
- 冲突基准：`docs/adr/` 全集 8 份（8/8 逐个全文读取，无抽样；0001–0008 均 accepted、无 superseded-by 终态）+ 根目录 `CONTEXT.md` 全文
- 门禁类型：设计后复审（审设计与 ADR 决策集一致性；设计优劣属 SA2，实现质量属 SA4/SA7，不在本门禁范围）
- 交叉证据（仅为校准裁决链，非实现评审）：#92 前置门禁报告与其设计后复审报告、#90/#92/#91 relevant_decisions 追加节、`packages/namespace-runtime/src/{errors,runtime,write,schema-write,index}.ts` 只读抽查、`git status`/`git diff 73811cd` 卫生基线核对——设计 §1/§2/§4 引用的事实全部属实

## Verdict

`clear`

## 专项裁决（总控指定两问）

### 专裁一：ADR 0008 追加修订节（D1/§4.1）——属「词汇收口注册」正当演进，非静默改写已接受条款

**裁决：no-conflict（正当收口注册）。** 四要件逐一核验成立：

1. **正文零改写（非「静默」）**。修订节置于文末「## 取代关系」之后，D1 明文冻结正文 L1–L111；§5 协议以 `git diff $BASE..HEAD -- docs/adr/0008… | grep -c '^-[^-]'` = 0 作硬断言。当前基线核对：`git diff 73811cd --name-only -- docs/adr/ CONTEXT.md` 为空（设计期 ADR/CONTEXT 尚未被触碰，改动全部后置于 SA3）。没有任何已接受条款被改写、删除或废止——修订节首段自我声明「除下列明示条款外，正文其余条款维持原文效力」，与 ADR 0006 #79 修订节「未提及的条款维持原文效力」同款公式。
2. **形式走仓内正式修订流程（回应前置门禁附注 2）**。前置门禁报告（task_namespace-runtime-integration-acceptance_conflict_report.md 附注 2）要求「ADR 文本需随终态 API 修订时……须走正式 supersede/修订流程并另行裁决，不得静默改写」。仓内正式修订流程的既有形态即「带日期、带议题号的追加式修订节、正文零改动」——先例：ADR 0006「createDoc 与 owner 语义修订（2026-08-21，issue #64）」「DocHandle entry status 与 saveDoc 职责修订（2026-08-22，issue #79）」、ADR 0001「命名修订（2026-08-21）」。本设计 §4.1 同款，非静默改写。
3. **内容为已裁决词汇的注册，非新决策**。逐条映射（登记对象 ← 已接受/已裁决来源，均经本门禁原文核验）：
   - 修订节第 1 条 `RUNTIME_READ_DISABLED` ← ADR 0008 L24「预期路径、载体和 lifecycle 失败使用同步结果联合」（行为已接受）；字面量形状经 #92 设计后复审裁定并登记（#92 relevant_decisions 追加节第 3 条）。
   - 修订节第 2 条 `RUNTIME_WRITE_DISABLED` 码域澄清：fatal 排队写域 ← ADR 0008 L87 直接点名该码；persistence-degraded 写前 gate 域 ← ADR 0008 L45 槽序 + L47、ADR 0006 #79 拒绝面归属条款（码使用见 #90 SA1 设计码表 L505，#92 复审归为「ADR 槽序的可观测化，非新增义务」）；notifyDirty 未绑定域 ← #90 relevant_decisions 追加节第 1 条（SA8 裁定 no-conflict 实施细化）；close 停接纳域 ← #92 追加节第 4 条。实现事实抽查属实：`disabled()` 恰四域调用（write.ts:79/97/102、schema-write.ts:105/117/122、runtime.ts:203/212），errors.ts:38/41/49 三字面量俱在。「区分域靠 message、不另设新码」是对已冻结实现词汇的陈述，不新增行为、不废止义务。
   - 修订节第 3 条 `NSRT-CLOSE-RELEASE-FAILED` ← ADR 0008 L93「失败时 close Promise reject」本就未定 rejection 值形状；形状经 #92 设计后复审专裁：「no-conflict（ADR 未定形状内的最小公共面选择）」并明文「SA6 已把三个字面量……明文让渡给 SA1，属任务内授权」（task_namespace-runtime-fatal-status-close_design_conflict_report.md L39；#92 relevant_decisions 追加节第 5/6 条）。填未定形状 ≠ 改已定条款。
   - 修订节第 4 条术语纪律注记：行文「永久关闭」（L81）与可观测 message「永久禁用……读取仍保留」（write.ts:79 实测一致）的映射注记，纯编辑性，无条款变更。
   - 修订节第 5 条注册表归属：治理声明，与 ADR 0008 L79「稳定」「窄 issue 类型」无抵触。
4. **任务内授权闭合**。AC7 明文要求「ADR 0007/0008、CONTEXT、package docs 与最终 API/错误词汇一致」——文档对齐是本任务义务；三字面量形状/语义的裁决链在 #90/#92 门禁中闭合（见上），本修订节是回写注册。

**与 evolution 级的界分**：evolution 的定义是「意图修订该决策但未走正式 supersede 声明」。本修订节（a）不修订任何既有决策内容——五条全部从属于已接受条款或已让渡的未定形状；（b）走了正式修订声明（追加节 + 维持原文效力声明）。两条件均不满足 evolution，判 no-conflict。

### 专裁二：ADR 0007 零改动裁决——成立

**裁决：no-conflict，零改动判读正确。** 依据：

1. ADR 0007 仍有效条款（`validateLogicalSnapshot` 更名、`compileSchemaEnvelope`、`applyValidatedMutation` TOCTOU 纪律、Runtime 编排边界「先检查 writable gate、同步调用、成功后立即 saveDoc 标脏」、零写入覆盖、observer no-rollback、路径纪律、mutation 操作集）——设计全部零接触：生产代码冻结（§7 DENY LIST：`packages/*/src/**`、`docs/adr/0001-0007` 明列不改）。
2. §2 矩阵 #14 的判读成立：ADR 0007 L46「NamespaceRuntime/Registry 再映射成稳定的 create/open/mutation 上层错误」是 0007 时点的将来时投影，其 Runtime/open/read 辖域已由 0007 自述取代节（L44、L48–L50）+ ADR 0008「取代关系」节明文接管；错误通道由 ADR 0008 L79 更晚更具体的决策（领域化结果联合 + 窄 issue 类型）统辖。最终 API 与残余表述无矛盾：create 确实 throw 稳定的 `NamespaceRuntimeConstructionError`（稳定 create 上层错误词汇成立）、mutation 确实以稳定结果联合结算。无被违反的活条款 → 零改动是正确且符合最小修订纪律的裁决。
3. 矩阵 #9/#10/#13 的 doc-runtime API 名（`compileSchemaEnvelope`/`applyValidatedMutation`/`readLogicalValueAtPath(doc, path)` 等）与 0007 L14–L29 及取代注记一致；旧签名已不在任何 src，0007 L26 已自带「已由 ADR 0008 取代」标注——无陈旧引用冲突。

## ADR 盘点

| 编号 | 状态 | 设计触达面 | 对照结论 |
|---|---|---|---|
| 0001 | accepted（含 08-19/08-21 修订节） | 无 schema 文本触碰；修订节/词条不含 VFSL 文本 | no-conflict |
| 0002 | accepted | 无 authority 复活；零生产改动 | no-conflict |
| 0003 | accepted | 无 ROOT/求值链触碰（DENY：doc-runtime/vfsl） | no-conflict |
| 0004 | accepted | 无类型投影触碰 | no-conflict |
| 0005 | accepted | 无生成管线触碰 | no-conflict |
| 0006 | accepted（含 #64/#79 修订节） | 修订节第 2 条 degraded 域注册与 #79「拒绝面归 Runtime 写前 gate」一致；层分离（DocHandleStatus ≠ Runtime lifecycle）在 CONTEXT 新词条中维持 | no-conflict |
| 0007 | accepted（Runtime/open/read 条款由 0008 部分取代） | 零改动裁决（专裁二） | no-conflict |
| 0008 | accepted | 追加修订节（专裁一）+ §2 矩阵全量核对：L16/L24/L28-32/L36-45/L47/L51-59/L63-75/L79-87/L91/L93/L95/L97/L103-107 均逐句映射，无改写 | no-conflict |

CONTEXT.md：新增「停接纳」词条与既有「写序列器/P0/active schema/零写入/载体投影读取」无术语冲突、无双源漂移（语义单源于 ADR 0008，排空细节一句带过）；_Avoid_ 行防的两类误读均不与既有词条相抵。no-conflict。

## 冲突点

无。

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | 未发现 hard-violation / override-declared / evolution 级冲突（专裁一、二为最接近边界的两处，均裁 no-conflict） |

裁决分布：no-conflict × 8（ADR 层面）+ 0 override-declared + 0 evolution + 0 hard-violation。

## 非冲突附注（不阻塞放行；N1 为 SA3 落盘前必须修正项）

1. **N1（引用精度缺陷，必须修正后再交 SA3）**：设计 §1.2/§4.1/§6 的裁决链引用存在两处出处错误—— 本门禁全文检索证实：「SA6 已把三个字面量……明文让渡给 SA1，属任务内授权」一句实际出自 **`task_namespace-runtime-fatal-status-close_design_conflict_report.md`（设计后复审报告）L39**，而非 §1.2/§4.1 所引的 `task_namespace-runtime-fatal-status-close_conflict_report.md`（前置门禁报告，无此句）。§4.1 草案注明「SA3 原样落盘」——若不修正，错误出处将随修订节永久写入已接受 ADR。 §1.2「`RUNTIME_WRITE_DISABLED` 的 degraded 域与 notifier-未绑定域分别在 #90 追加节第 1 条、#92 追加节第 4 条登记」映射错位：#90 追加节第 1 条实为 **notifier-未绑定域**；#92 追加节第 4 条实为 **close 停接纳域**（含码族交叉引用）；**degraded 域**的码使用锚在 #90 SA1 设计码表（L505「handle 非 ready（degraded、released、disposed）」）且其行为直接源于 ADR 0008 L45/L47 + ADR 0006 #79（#92 复审归为「可观测化，非新增义务」），不在任何 relevant_decisions 追加节。**裁决链本身经本门禁逐条核实为真实存在**——故缺陷不推翻专裁一，仅属证据引文精度问题；SA1 须在 SA3 执行前修正 §1.2 与 §4.1 草案中的两处出处（改为「#92 设计后复审报告（design_conflict_report）」并更正域→条目映射）。
2. **N2（先例标记差异，供总控知会 Jim，非阻塞）**：ADR 0006 两修订节均带 owner 裁决标记（「演进经 owner 裁决放行」）；本修订节以任务链授权（#92 SA8 设计后复审让渡 + AC7 义务）替代。因修订节不引入任何新行为决策（专裁一第 3 条逐条核实），不需要新的 owner 裁决即满足前置门禁附注 2 的「另行裁决」要求；若 Jim 希望与 0006 先例对称（修订节统一带 owner 放行标记），属治理风格选择，可在 Host 流程补注，不构成本门禁冲突。
3. **N3（非基准事项）**：`.mabf-done` 删除固化、`.gitignore` 追加、diff base=73811cd 辖域裁决、不新建 README、不写 docs 文本断言测试——均无 ADR/CONTEXT 条款涉及（仓库卫生/工程纪律），不构成冲突基准。当前 `git status` 核实：`.mabf-done` 为已删未暂存（`git ls-files` 仍计 1），与 D6「收尾 commit 必须 staged 该删除」的必要性陈述一致。

## 结论

**Verdict: `clear`，冲突点 0，裁决分布：no-conflict × 8 + 0 evolution + 0 override-declared + 0 hard-violation；CONTEXT.md 无术语漂移。**

两项专项裁决：① ADR 0008 追加修订节属**词汇收口注册**（正文零改写 + 仓内正式修订形式 + 内容全部从属于已接受条款或已让渡的未定形状 + AC7 义务闭合），非静默改写已接受条款；② ADR 0007 零改动裁决**成立**（无活条款被触碰或被最终 API 违反，矩阵 #14 将来时判读正确）。

设计放行，交 SA2 全维度攻击评审。前置条件一项：**SA1 先按 N1 修正 §1.2/§4.1 的两处引用出处**（防错误出处随「SA3 原样落盘」进入已接受 ADR），其余无 override、无需 Jim 裁决条目。设计引入的新决策点 7 条已追加至 `task_namespace-runtime-integration-acceptance_relevant_decisions.md`「设计后复审追加」节，供 SA3/SA4/SA7 对照。

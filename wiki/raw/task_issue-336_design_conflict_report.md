# 冲突报告（Design Conflict Report）— Issue #336 设计后复审

> SA8 产出（iteration 2，设计复查——SA1 iteration 1 修订版）。只裁决冲突，不评设计优劣、不判实现
> 质量、不做设计、不运行测试。基准 = ADR 全集 + CONTEXT.md + 模块 AGENTS 明文收录的决策 + 本票
> 前置门禁冻结面；源码与 wiki 谱系文档仅作现状/许可证据，不构成自动阻塞依据（docs/AGENTS.md
> 「Historical wiki/raw/ artifacts are evidence, not normative contracts」同款纪律）。

## 1. Reviewed subject

**design** —— `wiki/raw/task_issue-336_design.md`（SA1 iteration 1，1070 行——按 SA2 iteration 0
reject 的 F1 BLOCKER + N1–N4 MINOR 修订后的版本）vs 决策集。本迭代复审焦点（总控指令）：修订后的
**descriptor 读纪律净化（descriptor-based canonicalization，§7.1-A-2）**、**敌意对象失败路由
（hostile-object failure routing，§7.1-A-2b 双出口 + A-2c 接缝终态成员）**、以及**两通道对齐承诺的
维持方式（ADR-0024 L81，§7.1-A-4 + §12-T1-D/F-x）**；同时核对 iteration 0 已裁决、本迭代未改动的
面未发生漂移。Issue #336 REST comments 为空（本迭代指令重读确认）——无 Owner override 面。

## 2. Inputs and decision set

- 被审对象：`wiki/raw/task_issue-336_design.md` 全读（1070 行，iteration 1）。
- 任务输入：`wiki/raw/task_issue-336.md`（简报，与 Issue 正文同源）；本票前置门禁两产物
  （`task_issue-336_conflict_report.md`，verdict clear / 16 行 / requiresConflictRecheck=true；
  `task_issue-336_relevant_decisions.md`）；SA2 攻击评审 `task_issue-336_sa2_review.md`
  （iteration 0，verdict reject——F1 BLOCKER + N1–N4 MINOR + §14 五项观测）。
- 决策集（前置门禁已清点：`docs/adr/` 20 文件全部 accepted、无 superseded）：本轮细读
  `docs/adr/0024-readdata-shape-budget.md` 全文（决策 1 L22–31 / 决策 2 L33–40 / 决策 3 L43–56 /
  决策 4 L58–69 / 决策 5 L71–83 / 决策 6 L85–87 / 决策 7 L89–95 / 修订节 L97–105 / 否决节
  L109–118 / 验收 L120–130 / 开放问题 L132–137）、ADR-0016（L19/L22–25/L69–70/L75–77）、
  ADR-0008（读取能力节、L123）、ADR-0009（L38）、ADR-0003（L46）；根 `CONTEXT.md`
  （L37–55 预算词汇族、L115–117 停接纳）；模块 AGENTS：namespace-runtime / namespace-registry /
  doc-runtime / vfsl 四份（本轮注入逐一核对）。`docs/protocols/`、`docs/vfsl/` grep 无 readData
  条款面（前置门禁结论复核成立——readData 不上 wire、不进语言 spec）。
- 现状确认（源码事实，非冲突基准；对修订版设计 §2 锚点与 F1 修订面逐条亲自复核）：
  - T1 读纪律权威：doc-runtime `read.ts` L326–361 `validateReadOptions`——键空间 = `Object.keys`
    own enumerable（非 enumerable/继承键忽略 R8）、轴值 = `getOwnPropertyDescriptor().value`
    （accessor 拒绝且零执行）、ownKeys 谎报键 ≡ 非 own、present-undefined ≡ 缺席（R1）、≥0 有限
    整数、-0 归一（H10）、整体 try 收编 trap 异常（策略 A 零外抛）；L370–377 `optionsInvalid`
    path 新鲜回显、message 恒非空；L316–324 规则注记与设计 §7.1-A-2 引文逐字一致。**修订版净化器
    （§7.1-A-2 代码）与该纪律逐项对齐：同键空间 (a)、同取值通道零 `[[Get]]` (b)、try 收编 (c)、
    仅在场且合法才写入 (d)——iteration 0 的裸 `[[Get]]` 读法已删除。**
  - T1 定序与零外抛：read.ts L112–155——G0 path 形态守卫 → OPT options 校验（**V2：非法 options
    于 N0 前短路、零 doc 触碰**；V1：G0 优先）→ N0 probeRoot；全程顶层 try（E100 崩溃边界，
    JSDoc「同步、不抛错（INV-R1）」）——设计 A-2b 出口①「重派发不可能外抛、状态化 trap 由 T1
    单源收编、零 doc 触碰先短路」三个断言的源码依据全部在场。
  - T2 规则分叉：vfsl `resolve-schema-at-path.ts` L333–375——无宿主原型检查、`ownOptionValue`
    经 `[[Get]]` 执行 getter（L342–344）、present-undefined 非法（L350 注记）——设计 §3-6 三处分叉
    登记属实；公共类型 `SchemaTruncationMarker`/`BudgetedValueSchema`/`ResolveSchemaBudgetOptions`/
    `BudgetedReadDataSchemaProjection`/`SchemaTruncationClue`（L72–114）全部在场，设计只消费。
  - runtime 现状：`runtime.ts` L474–487（单参、lifecycle gate 先行、失败短路、恰三键、无顶层
    catch——设计「净化失败绝不外抛依赖净化器内层 try + T1 E100 双保险」与现状一致）；L110–115
    `RuntimeReadDisabledResult` 四键；L668–687 `readDisabled`（Array.isArray 守卫 + try/catch
    spread + 敌意坍缩 `[]` 的 path 回显纪律——A-2c `echoReadPath` 提取的先例）；L117–119
    `ReadLogicalValueFailure = Extract<…>`（D1 单源纪律的源码注释载体）。
  - 投影收敛点：`read-schema-projection.ts` L42–59——D3a 状态守卫 → D3b 敌意 path → resolver →
    **L57 `if (!resolved.ok) return null`（SA2 ER-1 所指 `SCHEMA_OPTIONS_INVALID` 静默化落点）**；
    L121–181 深拷贝器 9-case 显式分派、无 default。
  - lease 面：`lease.ts` L78–82 `RELEASED_ISSUE` 冻结单例、L276–279 现无透传、L383–391
    `_readAlias` Equal 锚——设计 §2.5 锚点属实。
  - 谱系证据：worktree HEAD `cdfdff6`（T0 `80d59f8` / T1 `b8e2947` / T2 `cdfdff6` 在支）；T2 设计
    §6.10「接缝净化」许可原文在场（wiki 证据，非规范基准）。

## 3. Decision analysis

| # | Decision | Clause | Subject behavior（修订版设计位置） | Classification | Evidence | Required action |
|---|---|---|---|---|---|---|
| 1 | ADR-0024 决策 1 | L30（非法 options 响亮拒绝；`READ_OPTIONS_INVALID` 同步、不抛；不借路径/生命周期码） | **敌意对象失败路由（A-2b/A-2c）**：净化失败三来源——T1 首校验拒绝原样透传 / 出口① T1 重派发单源成员 / 出口② 接缝终态成员——全部同步、零 throw（净化器内层 try + T1 E100 顶层 try 双保险）、码位恒 `READ_OPTIONS_INVALID`、不借 `PATH_NOT_ALLOWED`/`RUNTIME_READ_DISABLED`；绝不经 L57 收敛 `schema:null` 静默化（净化失败在投影调用之前短路——B-5 分界注记） | **implements-existing-decision** | 0024 L30；read.ts L132/L230–234（E100）+ L326–361（try 收编）；read-schema-projection.ts L57（静默化落点——设计明文绕开）；设计 §7.1-A-2b/B-2/B-5、§8.2 S2b、§9 | 实现复查：F-x5/F-x6 恰四键断言 + 零 throw；失败成员键集无 truncated/truncations |
| 2 | ADR-0024 决策 1 + 决策 6 | L29–30 + L85–87 | **descriptor 读纪律净化（A-2 修订版）**：值通道成功后以 T1 同款读纪律（own-enumerable 键空间 + descriptor data-property 取值 + try 收编 + present-undefined 剥离）构造 canonical 全新 plain 字面量；键集 ⊆ 两轴 ∧ 值全 ≥0 有限整数 ⟹ canonical 恒在 T2 验收集内、`SCHEMA_OPTIONS_INVALID` 对 canonical 结构性不可达；投影通道只吃 canonical——两通道在 T1 读纪律视图下恒同预算。迭代 0 的裸 `[[Get]]` 读法及两条失实不变量论断已删除并替换（SA2 F1 required change (e)） | **implements-existing-decision** | 0024 L29–31/L85–87；read.ts L326–361（权威纪律）；resolve-schema-at-path.ts L333–375（T2 验收集）；设计 §7.1-A-2（(a)–(d) 逐项对齐注记 + 修订版不变量表述） | 实现复查：canonical helper 包内不导出、仅 T1 成功后执行（前置条件注释）；F-x3/F-x4 get trap 零调用计数锚；差分矩阵（runtime 接受集 ≡ T1 接受集）+ `{depth:undefined}` 用例 |
| 3 | ADR-0024 决策 6 | L85–87（runtime 组合同预算；**不新增第二条读路径**）+ L116（否决 runtime 事后裁剪） | canonical 净化 + A-2b 出口① 重派发（`readLogicalValueAtPath(doc, path, raw)` 第二次内部调用）：(i) 不是新公共读路径——零新公共 API/方法（`readDataBudgeted` 等列 §7.7 否决）；(ii) 不是事后投影裁剪——裁剪全部在 T1/T2 递归内，重派发是敌意-only 失败路径上的再校验派发，其 options 失败于 N0 前短路（零 doc 触碰）；(iii) 出口② 丢弃的完整值读仅发生在敌意非确定性输入上（读路径零副作用使丢弃安全），不触及「未展开分支零物化」的合法读成本语义（L28 约束的是预算递归本身） | **implements-existing-decision** | 0024 L28/L87/L116；read.ts L140–150（V2 短路）；设计 §7.1-A-2b、§7.7 否决表、§8.2、§9 | 实现复查：重派发仅出现在净化失败分支；成功路径恰一次值读 + 一次投影调用 |
| 4 | ADR-0024 决策 5 | L81（两通道截断位置一一对应，**契约级承诺、错位即违约**） | 修订版维持方式：确定性输入（一切诚实对象 + 确定性行为敌意体，含 descriptor/get 分叉 Proxy、非 enumerable 键、继承键、恒抛 get trap）上 canonical ≡ T1 已消费预算 ⟹ 位置恒对齐——SA2 F1 三触发路径全部消除；对齐断言（T1-D）延拓至 F-x1/F-x2/F-x3 敌意夹具（「位置集相等 ∨ 整调用响亮失败」二择一钉死）。**残余（诚实登记，§13）**：非确定性 descriptor 在两个合法轴值间交替（如 depth 5↔1）接缝不可检测——检测需 doc-runtime 暴露 `ValidatedBudget`（内部非导出状态，read.ts L303 亲核），属新公共 API、违本票只消费非目标；设计不伪装解决，列为 follow-up 候选 | **implements-existing-decision**（确定性全域兑现；残余输入类在 ADR 条款覆盖面之外——L30 非法清单枚举的是静态非法性，「逐次视图各自合法的读间变异体」不在任何条款的承诺或禁止面内；无决策文本被违反） | 0024 L81；read.ts L303（ValidatedBudget 非导出）；设计 §7.1 确定性与残余缺口段、§12-T1-D/F-x、§13 残余行 | follow-up 若立项（doc-runtime 暴露已校验预算），属公共契约变更，**必须走 ADR-0003 L46 同款设计修订流程**，不得作为实现细节滑入；本票以 F-x5/F-x6 覆盖可检测子集为验收面 |
| 5 | ADR-0024 决策 1 | L30（options 封闭形状；非法清单 = 负数/非整数/非有限数/非对象/**含未知多余键**） | F-x1/F-x2 语义钉死：非 enumerable own `depth` / `Object.prototype` 继承 `depth` → 两通道对 T1 own-enumerable 键空间同为盲 ⟹ 无预算成功（五键、零截断、投影与无 options 读逐字节相等）。裁决：ADR 非法清单枚举静态非法性，未钉 options 对象的键空间枚举语义；`depth` 为已知轴、值合法，不在「未知键」禁止面内；钉死方式 = 逐字采纳 T1（单一校验权威）的键空间语义——无文本被违反，且是「规则集不分叉」的唯一一致读法 | **no-conflict**（ADR 未钉死面的设计钉死，钉法忠于单权威原则） | 0024 L30；read.ts L319（R8 注记）/L339；设计 §7.1-A-2 (a) 注记、§12-T1-F F-x1/F-x2 | 实现复查：F-x1/F-x2 断言按钉死语义（对齐成功而非拒绝）落地 |
| 6 | ADR-0016 + ADR-0024 决策 4 | 0016 L23；0024 L67（失败分支形状不动、不带新键） | B-3：`PATH_NOT_ALLOWED`/`RUNTIME_READ_DISABLED`/`NAMESPACE_LEASE_RELEASED` 三既有分支零变化；`READ_OPTIONS_INVALID` 三来源同一成员形状恰四键 `{ok,code,path,message}`（path 新鲜回显、message 恒非空）；无 options 调用结构上不可达该码 | **implements-existing-decision** | 0016 L23；0024 L67；read.ts L370–377；runtime.ts L110–115；lease.ts L78–82；设计 §7.2-B-3 | 实现复查：三既有分支键集断言 + 新分支恰四键断言（§12-T1-A/T2） |
| 7 | （D1 单源纪律——源码注释谱系，#273 期；非 ADR/CONTEXT/模块 AGENTS 条款） | runtime.ts L117–119 注释「失败形状以 doc-runtime 为准，不复制第二份（D1）」 | A-2c 接缝终态成员是 D1 的**登记豁免**：唯一触发点 = 净化视图不稳定 ∧ T1 重派发又接受（T1 单次校验在结构上无法观察「读间不稳定」）；豁免以三层锁定——返回类型注解 `ReadLogicalValueBudgetFailure = Extract<T1 预算联合,{ok:false}>`（类型仍单源，T1 加必填键即编译红）、`echoReadPath` 复用 readDisabled 包内回显纪律（非新形状）、message 恒非空。裁决：D1 载体是源码注释与 wiki 谱系，非决策文本——不构成冲突基准；包内构造成员先例 = `readDisabled`（L668–687，runtime 自构 `RUNTIME_READ_DISABLED` 四键）；豁免已显式登记且形状锁回单源类型，无规范文本被违反 | **no-conflict**（登记豁免合规——冲突基准内无被违反条款；豁免处置方式反而强化形状单源） | runtime.ts L117–119/L668–687；设计 §7.1-A-2c、§13 豁免行 | 实现复查：`seamReadOptionsInvalid` 返回类型注解在位（Extract 派生）；全包无第二份手写失败联合 |
| 8 | ADR-0016 L19（被 0024 修订） | 0024 L58–69/L101（恒五键、两模式同形、空清单空数组、0.x minor bump 论据） | §7.2-B-2：预算与无 options 成功分支均五键；无 options 分支 `truncated:false` + 每调用新鲜 `[]`（禁共享常量）；本迭代修订未触该面 | **implements-existing-decision**（iteration 0 裁决维持） | 0024 L58–69/L101；0016 L70；设计 §7.2/§7.6/§7.7 | 实现复查：五键集断言 + 无 options 新鲜 `[]` |
| 9 | ADR-0016 L75 + #273 期组合序 | 0016 L75（组合公式）；runtime.ts L474–487 现序 | B-1/B-2：lifecycle gate 先行（零 options 读取、零 doc 触碰）→ 值读先行 → 失败短路零 schema 工作 → 组装；净化与重派发仅插在「值通道成功之后、投影调用之前/失败出口」，#273 冻结的顺序原样保持 | **implements-existing-decision** | 0016 L75；runtime.ts L474–487；设计 §7.2-B-1/B-2、§8.2 | 实现复查：S2a 无 options 分支走两参逐字节；失败短路不带 schema/truncated/truncations |
| 10 | ADR-0008 + CONTEXT | 0008 L123；CONTEXT L115–117（停接纳 key 仅 lifecycle；getStatus 不受影响） | B-1：closing/closed + 任何 options（含敌意——gate 先于一切 options 触达，敌意 trap 停接纳期零执行）→ `RUNTIME_READ_DISABLED`；§9 getStatus 零影响 | **no-conflict** | 0008 L123；CONTEXT L115–117；runtime.ts L480–483；设计 §7.2-B-1、§9 | 实现复查：B-1 锚（closing/closed + 非法 options → RUNTIME_READ_DISABLED）入契约测试 |
| 11 | ADR-0003 + ADR-0024 | 0003 L46；0024 L77/L115（标记 = 投影包装联合、不入 ValueSchema 九 kind；无预算读恒纯） | D-3：`case 'truncated'` 显式分派（clue 全新普通副本、memo 统一）、10-case 穷尽仍无 default；D-2/D-4 双重载保 legacy 静态纯度；标记永不下沉 ValueSchema；本迭代修订未触该面 | **implements-existing-decision** | 0003 L46；0024 L77/L115；read-schema-projection.ts L121–181；设计 §7.4-D-2～D-4 | 实现复查：switch 无 default；type-d 纯度锚 |
| 12 | ADR-0024 决策 5 | L74 + 验收 L125（width 对投影无操作；width-only 逐字节相等） | A-3：canonical 保留 `maxChildrenPerNode`（resolver 校验后忽略），组合层不按轴名过滤；T1-E 逐字节断言 | **implements-existing-decision** | 0024 L74/L125；resolve-schema-at-path.ts L353；设计 §7.1-A-3 | 实现复查：AC3 锚落地 |
| 13 | ADR-0016 + ADR-0024 | 0016 L22/L69；0024 L75（`schema:null` 单义三情形、always-on、预算非 schema 开关） | B-5：D3a 先行结构零变化；预算下 `schema:null`+`truncated:true` 合法共存；**净化失败绝不走 L57 null 收敛**（与 B-5 的分界注记在位）——修订把决策 1 的合规性从「论断」变为「结构保证」 | **implements-existing-decision**（修订强化） | 0016 L22/L69；0024 L75；read-schema-projection.ts L46–50/L57；设计 §7.2-B-5 | 实现复查：D3a 位置不动；L57 收敛点零代码改动（DENY 语义面） |
| 14 | ADR-0024 决策 3 | L43–56（条目三字段、path 同基、尾段键名、width 父路径单条、omitted=直接子项数） | B-4：`truncations` = T1 结果逐引用透传（每调用新鲜累加器）；`truncated` = T1 值（B14）；零合成/零合并/零投影侧清单；本迭代修订未触该面 | **implements-existing-decision** | 0024 L43–56；read.ts L88–92/L100–108/L310–313；设计 §7.2-B-4 | 实现复查：B14 断言在场；runtime 零清单变换 |
| 15 | ADR-0016 修订节第 2 条 + doc-runtime AGENTS | 0024 L102（`readLogicalValueAtPath` 三参已落、无 options 逐字不变）；AGENTS「公共 API 只经 src/index.ts、guard tests 全计」 | 设计只消费 T1 公共三参重载（含 A-2b 出口①重派发——用既有公共面，非新增）；DENY LIST `packages/doc-runtime/**` 零触碰——F1 修复路线是「净化器对齐 T1」而非「改 T1」，与冻结面一致 | **no-conflict** | 0024 L102；read.ts L118–131；doc-runtime AGENTS；设计 §11 DENY | 实现复查：git diff 零触碰 doc-runtime |
| 16 | ADR-0016 修订节第 3 条 + vfsl AGENTS | 0024 L103（`resolveSchemaAtPath` 三参已落）；vfsl AGENTS（判别结果不抛 + `InternalError` 专属可信域例外 + 稳定码兼容行为） | 设计只消费 T2 公共面；canonical 结构性不可达 `SCHEMA_OPTIONS_INVALID`（防御纵深第二道门对直接调用方原样保留——非修改该门）；`InternalError` 仍是唯一逃逸 throw（D-1 结构不动；净化器内层 try 不新增逃逸通道）；无 options 投影逐字节（D-4 + T1-E） | **no-conflict** | 0024 L103；vfsl AGENTS；resolve-schema-at-path.ts L194–228；设计 §7.4-D-1/D-4 | 实现复查：resolver 调用零 catch 添加；canonical 前置条件注释在位 |
| 17 | ADR-0009 + ADR-0016 L76（经 0024 L87 override） | 0009 L38（lease 代理 Runtime 同步读取、不公开裸 Runtime）；0016 L76 + 0024 L87（原样透传） | E-1/E-2：released 短路先于一切透传（冻结单例原样）；active 期 **raw 引用原样直传**——净化是 runtime 接缝职责，lease 层零预算解释/零校验/零敌意触达；别名跟随 + `_readAlias` 原文保持 + 两新锁；本迭代修订未触该面 | **implements-existing-decision** | 0009 L38；0016 L76；0024 L87；lease.ts L78–82/L276–279/L383–391；设计 §7.5 | 实现复查：T5 同一引用捕获断言 + released+options 同途 + 三 Equal 锁编译绿 |
| 18 | 模块 AGENTS（runtime/registry）+ ADR-0011/0014/0016 L77 + 残余归票 | runtime AGENTS（reads 不进 sequencer、公共面 detached）；registry AGENTS（公共 API 只经 src/index.ts）；0016 L77（零 wire/诊断/复制）；0024 L91–95/L105（T4/T5 归票） | 全同步零 sequencer 槽位；返回面 detached（含标记全量深拷贝、不冻结）；两包新类型 type-only 经各自 `src/index.ts`（runtime 值导出面不变、registry value-key 审计不受影响）；零 wire/诊断/复制文件；T4/T5/L2 接线/残余闭合全部归票不悬空 | **no-conflict** | 四份模块 AGENTS；0016 L77；0024 L91–95/L105/L137；设计 §9/§11/§13 | 实现复查：DENY LIST 零触碰；runtime/registry 包门禁 + root `pnpm typecheck`（14 包）/`pnpm test` |

裁决分布：**no-conflict 7 项（#5、#7、#10、#13 内含强化注记、#15、#16、#18）；implements-existing-decision
11 项（#1、#2、#3、#4、#6、#8、#9、#11、#12、#14、#17）；evolution-required 0 项；hard-conflict 0 项**（按行计
17 行：no-conflict 6 行 + implements 11 行）。

## 4. Overrides

修订版设计未新增 override、未扩大既有 override 范围；SA2 F1 修复路线（SA2 §14.5 同证）完全落在
ADR-0024 既有授权内（L30 响亮拒绝 / L81 对齐承诺 / L85–87 同预算组合），无新决策需求。前置门禁 §4
三项正式 override 维持原范围，设计在其内落地：

| Old decision | Override authority | Scope | New obligation | 修订版落地核对 |
|---|---|---|---|---|
| ADR-0016 L19 恰三键 | ADR-0024 决策 4 + 修订节第 1 条（L60–69/L101） | 成功分支恒五键；失败分支不带新键 | 五键恒形经 T0 helper 单点修订；0.x minor bump | §7.2/§7.6——范围一致，未扩大 |
| ADR-0016 L76 狭义读法（lease 行为零变化） | ADR-0024 决策 6（L87） | lease `readData(path, options?)` 加法透传 | 代理语义加法扩展、released 先行、别名跟随、Equal 锚保持 | §7.5——raw 引用直传恰为最小扩展 |
| ADR-0008 完整深拷贝读语义 | ADR-0024 修订节（L99） | 预算内投影 + 截断清单；不传预算 = 完整投影默认保留 | 投影递归成本界 = 实际返回部分 | §7.1/§7.4——裁剪全在 T1/T2 递归内，runtime 零事后裁剪 |

**两项非 override 的澄清登记（复审确认维持）**：

1. 「同一 options 对象 → 同一预算」（前置门禁 RA-1 操作化措辞 vs 设计 A-2）：规范文本 L85–87 约束
   的是**预算**同一性；修订版以「净化器与 T1 同一读纪律重读」把该读法从推论升级为结构保证
   （canonical 仅在确认视图与 T1 接受判据一致后构造）；SA8 报告措辞不是 override 权威。
2. **A-2c 对 D1 的登记豁免（本迭代新增面）**：D1（失败形状单源 doc-runtime）的载体是 runtime.ts
   L117–119 源码注释与 #273 谱系（wiki），不在 ADR/CONTEXT/模块 AGENTS 决策文本内——不构成冲突
   基准；豁免唯一触发点、Extract 单源类型锁、`echoReadPath` 复用先例纪律三层锁定使豁免不产生
   第二份形状事实源。非 override、非冲突；列为实现复查重点核对项（§8-3）。

## 5. Frozen surfaces

| Surface | Must remain unchanged | Evidence | Actual result（修订版设计） |
|---|---|---|---|
| ValueSchema 9-kind 语义联合 | 标记不下沉为 ValueSchema 成员；无预算读恒纯 ValueSchema | 0003 L46；0024 L77/L115 | 一致——D-3 包装联合分派 + D-4 纯重载链 |
| `ReadDataSchemaProjection` 四键与键规约 | 键集/合并序不变；仅预算读类型加宽 | 0016 L30–42；0019 §7；0024 L77 | 一致——只加宽类型 |
| 既有失败分支形状 | `PATH_NOT_ALLOWED`（doc-runtime 单源）/ `RUNTIME_READ_DISABLED` 四键 / released 冻结单例；不带截断键 | 0016 L23；0024 L67；lease.ts L78–82 | 一致——B-3 逐字冻结 |
| 无 options 逐字节现行为 | 值与投影内容逐字节不变（信封加键） | 0024 L29/L67 | 一致——S2a 两参通道 + T2 独立预言机锚 |
| E1 输出端吸收纪律 | 无第三态；`depth:0` 唯一例外 | 0024 L40；CONTEXT L49–51 | 一致——值内形态单源 T1 |
| `schema:null` 单义与 always-on | null 三情形不区分；ok 恒真；预算非 schema 开关 | 0016 L22/L69；0024 L75 | 一致——D3a 先行不动；净化失败不经 null 通道（新增分界注记强化） |
| **L57 resolver 失败收敛点** | `projectReadDataSchema` 对 resolver 两码的 `null` 收敛行为与三个合法 null 情形不变；预算缺陷不得经此静默化 | read-schema-projection.ts L46–58；设计 §7.1-β | 一致——零改动；canonical 使该收敛点对预算缺陷结构性不可达（绕开而非修改） |
| **`READ_OPTIONS_INVALID` 成员形状** | 恰四键 `{ok,code,path,message}`、path 新鲜回显、message 恒非空、同步不抛、不借码 | 0024 L30；read.ts L370–377 | 一致——三来源同一形状；接缝成员以 Extract 派生类型锁死（A-2c） |
| T1 公共面（doc-runtime） | 双联合/重载/G0→options→N0/校验器非导出/读纪律 | read.ts L94–155/L326–377；0024 L102 | 一致——只消费（含重派发）；DENY 零触碰 |
| T2 公共面（vfsl） | 三参重载/标记包装联合/`SCHEMA_OPTIONS_INVALID` 严格规则（对直接调用方）/计层规则 | resolve-schema-at-path.ts L72–228/L333–375；0024 L103 | 一致——只消费；防御纵深原样 |
| 读不进 sequencer / lifecycle 停接纳 | 零 sequencer 槽位；closing/closed 同步联合拒绝；getStatus 全周期 | 0008 读取能力节/L123；CONTEXT L115–117；runtime AGENTS | 一致——全同步零槽位；gate 先行 |
| Wire / 诊断日志 / 复制 raw 读面 | 零改动 | 0016 L77；grep protocols/vfsl 零命中 | 一致——DENY LIST 明列 |
| lease released 通道 | released 短路先于透传；冻结单例原样 | 0009 L38；lease.ts L78–82 | 一致——E-2 恒先行 |
| #273 期组合序与三键锚 | gate→值读→短路→组装顺序保持；三键锚经 0024 合法修订链解除 | runtime.ts L474–487；0024 L101 | 一致——序保持；净化/重派发只插在值成功之后 |

## 6. Evolution requirements

**无新增 evolution-required 项。** 复核：

- 修订面（descriptor 读纪律净化、双出口失败路由、接缝终态成员）全部落在 ADR-0024 已 accept 的
  授权内（决策 1 响亮拒绝、决策 5 L81 对齐承诺、决策 6 同预算组合），不改任何契约文本；
- 设计不修改 ADR/CONTEXT/协议文档（DENY LIST）——与前置门禁 §6 一致：0024 基线三提交已把所需
  演进在同一变更集完成；残余义务归票 T4 #337 / T5 #338 / L2 接线，无悬空；
- **条件性登记（非本票义务）**：§13 残余「合法值交替」的完全闭合若立项，需 doc-runtime 暴露已
  校验预算——属公共契约变更，届时必须走 ADR-0003 L46 同款设计修订流程（新 ADR/修订节 + 兼容
  迁移 + 验证），不得作为实现细节滑入任何后续票。

## 7. Hard conflicts

**无。** 17 行对照零 hard-conflict。修订版明确拒绝或结构性消除了会构成冲突的形态：预算缺陷静默化
（绕开 L57 收敛）、敌意 trap 裸逃逸（净化器 try + T1 E100 双保险）、净化器读纪律越权（逐字对齐
T1）、非法输入洗白（备选 (δ) 否决——canonical 不回喂 T1）、runtime 层事后裁剪 / 第二读路径 /
形状按参数分叉 / 清单合成（§7.7 否决表与 ADR 否决节逐条对齐）。

## 8. Required actions

设计后复审（iteration 2）通过；以下为实现复查核对项（重点 = 本迭代修订面）：

1. **canonical 净化（A-2）**：`canonicalReadOptions` 包内不导出、仅在 `readLogicalValueAtPath`
   三参调用成功后执行（前置条件注释在位）；读纪律与 T1 `validateReadOptions` 逐字对应（键空间/
   descriptor 取值/try 收编/present-undefined 剥离/-0 归一）；零 `[[Get]]`（F-x3/F-x4 get trap
   调用计数锚）。
2. **敌意失败路由（A-2b）**：出口①重派发仅在净化失败分支、T1 成员原样透传（零形状复制）、零
   doc 触碰先短路；出口②仅当重派发又成功时构造接缝成员；两出口绝不 throw、绝不 `schema:null`、
   绝不带截断键；F-x5/F-x6 恰四键断言落地。
3. **接缝终态成员（A-2c）**：返回类型注解 = `ReadLogicalValueBudgetFailure`（Extract 派生，无
   第二份手写失败联合）；`echoReadPath` 与 `readDisabled` 同款回显纪律（同文件共用 helper）；
   message 恒非空；触发点唯一。
4. **两通道对齐契约**：T1-D 位置集断言按 T2 §6.10 归一 recipe 进主缝契约测试，含 F-x1/F-x2/F-x3
   敌意夹具延拓（相等 ∨ 响亮失败）；差分矩阵（runtime 接受集 ≡ T1 接受集）+ `{depth:undefined}`
   净化用例；width-only 逐字节相等（T1-E）。
5. **五键信封与失败面**：两联合成功成员恰五键；无 options 分支新鲜 `[]`；三既有失败分支键集零
   变化；lifecycle×options 定序锚（closing/closed + 非法 options → `RUNTIME_READ_DISABLED`）。
6. **T0 修订面**：helper 五键化（schema 保持纯面——N3 纪律）+ gate 正负样本随动 + family A/B
   归零保持 + **10** 个消费文件零手改全绿（N2 修正计数）。
7. **lease 透传**：released 恒先行；active 期 raw **同一引用**直传（stub 捕获 + 敌意构造器直传零
   lease 层触达）；`_readAlias` 原文 + `_readBudgetAlias`/`_readOverloadOrder` 编译绿；
   `NamespaceLeaseReadDataBudgetResult` 经 registry `src/index.ts` type-only 导出。
8. **范围与门禁**：DENY LIST 零触碰（git diff 核对——含 doc-runtime/vfsl、ADR/CONTEXT、
   apps/yjs-server、既有 projection fixture）；runtime/registry 包门禁 + root `pnpm typecheck`
   （14 包）+ `pnpm test`（`vitest run --typecheck`）；版本 bump（runtime 0.1.12→0.1.13、registry
   0.1.10→0.1.11）归发布流随动，非代码面核对项。

## 9. Verdict

**clear** —— 17 行对照全部为 no-conflict（6）或 implements-existing-decision（11）；零
evolution-required、零 hard-conflict。SA2 F1 BLOCKER 的修订路线（descriptor 读纪律净化 + 响亮失败
路由）完全落在 ADR-0024 既有授权内，不新增决策面：三处敌意触发路径的消除方式强化而非偏离决策 1
（响亮拒绝）与决策 5 L81（对齐承诺）；A-2c 对 D1 的豁免经裁决不构成冲突（D1 非决策文本），且以
Extract 单源类型锁把豁免约束在无形状漂移的形态内；「合法值交替」残余经诚实登记并给出合规的
follow-up 路径（公共契约变更须走设计修订流程），不在本票伪装解决。N1–N4 的修订（opRead 补列、
计数 10、helper 纯面钉死、fixture 零编辑措辞）均不触决策面。iteration 0 已裁决、本迭代未改动的
面（五键信封、类型联合、lease 透传、T0 单点、拷贝器标记处置）经复核无漂移。总控可继续派发实现。

## 10. requiresConflictRecheck

**true** —— 理由：

1. 公共 API 面尚待实现核对：runtime `readData` 双重载 + 两结果联合恒五键 + 新公共失败码
   `READ_OPTIONS_INVALID` + 3 项 type-only 新导出；registry lease 双重载 + 新别名 + 1 项导出；
2. **失败语义为本迭代新增核对面**：`READ_OPTIONS_INVALID` 三来源（T1 首拒透传 / 重派发单源成员 /
   接缝终态成员）的实现 diff 逐项核对——A-2b 双出口结构与 A-2c 豁免触发点唯一性是重点；
3. 前置门禁 §4 三项 override 的落地逐项核对（§8-5/6/7）；
4. ADR L81 两通道截断位置一一对应为跨 T1/T2/T3 契约级承诺，组合层落地须实测核对（§8-4，含
   F-x 敌意夹具延拓）；canonical 读纪律与 T1 的逐字对应（注释互指锚定）为实现 diff 复查点。

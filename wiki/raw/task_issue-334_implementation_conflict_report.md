# 冲突报告 — task_issue-334（实现后复查）

- **Reviewed subject**: implementation（issue #334 T1 载体投影读取三参化与截断省略——SA3 迭代 0+1 交付态工作区 diff + SA3 证据）
- **Reviewer**: SA8（mabf-sa8，dispatch `sa-010cab89-964f-44c8-87e7-3a710f1c6bd0`，phase conflict-gate，iteration 1）
- **日期**: 2026-09-12
- **触发依据**: 前置门禁报告 §8 D-3 + 设计 §6/§14 + SA6 §15（requiresConflictRecheck=true：公共 API 加性扩展 + 新失败语义面）；实际 diff 触碰 doc-runtime 公共读取冻结面。本轮为 D-3 的落实——按 §4 冻结面逐项核对实际 diff。
- **审查焦点**（dispatch 指定）：公共三参 API/结果联合、`READ_OPTIONS_INVALID` 失败语义、截断事实、detached 容器 B16 行为。

## 1. Inputs and decision set

| 输入 | 路径 | 状态 |
|---|---|---|
| 任务简报 | `wiki/raw/task_issue-334.md`（AC1–AC5） | 已读 |
| SA1 设计 | `wiki/raw/task_issue-334_design.md`（§7 决议 A–D、§11 ALLOW/DENY） | 已读 |
| SA2 设计评审 | `wiki/raw/task_issue-334_sa2_review.md`（approve；O-1/O-2） | 已读（O-1/O-2 落实核对见 §3 行 16） |
| **SA6 验收契约（迭代 1，已批准修订）** | `wiki/raw/task_issue-334_sa6_contract.md`（§0.1 B16/R9 裁决、§12.1–§12.12、§15 A-1/A-2） | 已读——本轮直接对照面 |
| SA3 实现报告 | `wiki/raw/task_issue-334_sa3_impl.md`（verdict clear；§3 变更面、§6 验证证据） | 已读并逐项抽查 |
| SA4/SA9 输入 | 不存在（本 worktree 无 SA4/SA9 报告；动态验证归 SA4/SA7/Controller，非冲突门禁输入） | 不适用 |
| 当前 diff | `git status`/`git diff`：`M src/index.ts`(+7)、`M src/read.ts`(+423/−34)、`M test/public-surface-type-guard.test-d.ts`(+15) + 3 个新 `shape-budget*` 测试文件 | SA8 亲读全部 diff 与 read.ts 全文（809 行） |
| 决策集 | `docs/adr/` 20 份全部 accepted（0001–0014、0016–0019、0022、0024）；ADR-0024（accepted）为直接治理；0007 read 条款被 0008 取代、0016/0008 相关条款被 0024 修订节显式修订 | 状态与前置门禁一致，无新增/状态变化 |
| 术语基准 | `CONTEXT.md` 形状预算/截断省略/截断清单/语义 schema 投影/载体投影读取词条 | 已读 |
| 模块纪律 | `packages/doc-runtime/AGENTS.md`（schema 无关读取、index.ts 唯一公共出口、surface guard 全覆盖、root typecheck/test 义务） | 已读 |
| Issue 评论快照 | REST 读评论成功、**零评论**（comment IDs: none） | 无 Owner override 需要应用 |

**流程注记（非冲突）**：设计阶段的独立 design 复查 artifact 未单独产出（控制流从 SA2 approve 直接进入实现）。本轮实现后复查直接以**最终 diff** 为被审对象核对全部冻结面——比设计级复查更强的核对，D-3 义务由本报告闭合；设计本身经 SA2 逐条核验零偏移采纳 SA6 钉死口径，无遗留未审设计决策面。

## 2. Decision analysis

| Decision | Clause | Subject behavior（实现/diff 实况） | Classification | Evidence | Required action |
|---|---|---|---|---|---|
| ADR-0024 决策 1（三参 API 与参数语义） | `readLogicalValueAtPath(doc, path, options?)`；depth/maxChildrenPerNode ≥0 整数、递归内生效、未展开分支零物化、`depth:0` 骨架（同形空容器+单条截断项）、终态 no-op、不传 options 逐字节现行为 | 双重载 + 实现签名落形（`read.ts:118-131`）：2 参 → `ReadLogicalValueResult`、3 参必选 options → `ReadLogicalValueAtPathBudgetResult`；预算经 `ProjectionCtx` 贯通既有 `projectValue`/`projectYMap`/`projectYArray`/`copyPlainStrict`（折叠 `read.ts:538-547`/`716-724`，槽位前缀保留+超界零读 `:634-650`/`:670-683`/`:740-754`/`:774-789`）；legacy 全部经 `ctx.budget === null` 门控关闭（成功恰两键 `:223`、`okUndefined` 两键 `:287-288`） | **implements-existing-decision** | `docs/adr/0024` L20-31 vs `read.ts:118-131,216-229,536-597,632-694,714-800`；测试 S1–S8/S23（`…shape-budget.test.ts:155-230,590-599`） | 无 |
| ADR-0024 决策 1（非法 options → `READ_OPTIONS_INVALID`） | 负数/非整数/非有限数/非对象/未知多余键响亮拒绝；新稳定失败码；同步不抛；不借路径/生命周期码 | `validateReadOptions`（`read.ts:326-361`）：非对象/数组/非 plain 宿主拒、未知键拒（含值 undefined 的未知键）、accessor 拒且零执行、值域 `number∧isInteger∧isFinite∧≥0`（`-0`≡0）；整体内层 try 收编 Proxy trap（V3）；定序 G0（`:136-138`）→ OPT（`:143-150`）→ N0（`:152-156`），非法 options 零 doc 触碰（V2）；失败分支 `optionsInvalid`（`:375-377`）= `{ok:false,code:'READ_OPTIONS_INVALID',path:新鲜回显,message:非空}`，不携带 value/truncated/truncations（V5）；码只进 budget 联合（`:100-108`），不借 `PATH_NOT_ALLOWED`/`RUNTIME_READ_DISABLED`（V6） | **implements-existing-decision** | `docs/adr/0024` L30 vs `read.ts:326-377`；guards 88 tests（§12.2 全矩阵 + V1/V2/V3/V5 + NC-4/NC-5，`…shape-budget-guards.test.ts:112-435`）；类型面 TD3/TD4/TD5 | 无 |
| ADR-0024 决策 2（截断省略为值内唯一截断形态） | 键省略；无「键在值 undefined」第三态、无魔法哨兵、无同形空占位；`depth:0` 目标自身同形空容器为唯一例外 | 折叠仅在 d===0 对**节点自身**返回 `{}`/`[]`（`budgetFold` `:583-597`）；被裁/被折子项一律键缺席（不构造占位/哨兵）；E1 吸收纪律不变（保留槽位 undefined 值键仍省略且占额度，`:645`/`:784`）；S26 断言 `Object.hasOwn(value,cutKey)===false`、值内无 undefined 在场键 | **implements-existing-decision** | `docs/adr/0024` L33-40 vs `read.ts:538-597`；S26 测试（`:650-669`） | 无 |
| ADR-0024 决策 3（截断清单） | 条目 `path`/`kind`/`omitted`；depth 条目 path 尾段=被裁键名；width 只在父路径记单条；**omitted=直接子项数（O(1)，非后代总数）**；不携带子键列表；恒在场（空清单为空数组） | 条目三字段（`ReadLogicalValueTruncationEntry` `:88-92`）；depth 条目 path=被折容器绝对路径（`:542`/`:720`，尾段即键名）；width 父路径单条（`:638`/`:674`/`:744`/`:779`）；omitted 取 raw 子槽数（`Y.Map.size` 含 undefined 值键 `:635`、`Y.Array.length` `:671`、plain array `length` `:741`、plain object own enumerable data 键数 `plainDataSlotCount` `:616-625`）——无后代遍历；预算成功面恒四键、`truncations` 恒在场（`:224-229`），`truncated === length>0`（B14）；条目 path 逐层新鲜（`[...p, k]` `:646/679/750/785`，S27 身份互异断言） | **implements-existing-decision** | `docs/adr/0024` L42-56 vs `read.ts:88-108,224-229,632-694,714-800`；S2–S15/S24（直接≠后代显式反证 `:600-629`）/S27 | 无 |
| ADR-0024 决策 6（公共面归属与单读路径） | 载体投影读取公共面三参化；Yjs 容器递归与 plain 域拷贝两条路径携带预算；不新增第二条读路径 | 预算贯通既有四函数（签名加 ctx/d/p 尾参，`read.ts:536/632/668/714`）；无平行投影族、无第二读入口；`index.ts` 仅加类型导出 ×3（`+7` 行），零新值导出 | **implements-existing-decision** | `docs/adr/0024` L85-87 vs `src/index.ts:14-20`、`read.ts` 头注 D6/F10；`public-surface-guard.test.ts` 未改动且绿（SA3 §6.2）；type-guard 加法锚（`public-surface-type-guard.test-d.ts` +15） | 无 |
| ADR-0024 修订条款 2（ADR-0016 L74 修订后语义） | 签名加法扩展为三参；**无 options 时签名与语义逐字不变** | `ReadLogicalValueResult` 成员逐字未动（`read.ts:62-64` 与 HEAD 一致）；2 参重载返回型恰为该联合；legacy 路径控制流与 HEAD 逐语句等价（diff 仅线程化形参，全部门控关闭）；4 个冻结锚文件零改动（git status 不含）且 SA3 报告全绿 | **implements-existing-decision** | `docs/adr/0024` L102 vs `git diff packages/doc-runtime/src/read.ts`（SA8 逐 hunk 核对）；锚文件 `read-logical-value-at-path-{schema-independent.test.ts,schema-independent.test-d.ts,guards.test.ts}`/`public-surface-guard.test.ts` 零 diff；SA3 §6.2 | 无 |
| ADR-0024 修订节（ADR-0008 L99 读语义修订） | 「目标子树完整深拷贝」→「预算内投影 + 截断清单」；不传预算=完整投影默认保留；成本界改「实际返回部分」 | 预算读返回投影+清单；无 options 完整投影保留；零物化哨兵（S19①③ poison/稀疏在 d=0 折叠 → ok:true；S20①② width 超界零读）证明成本收敛在递归内实现而非事后裁剪 | **implements-existing-decision** | `docs/adr/0024` L99、验收节 L124 vs `read.ts:538-547,716-724`（折叠先于一切值读）；S19/S20/S21 测试 | 无 |
| ADR-0008 继续有效读条款（缺席吸收/段纪律/XmlFragment 终态/D5 键空间/零 throw/同步联合） | 缺键/越界 ≡ ok:true undefined；段纪律；XmlFragment 语义字符串终态；own enumerable string data property；预期失败同步返回仅 internal bug 抛 | 导航循环预算盲（B13：段纪律/载体分类/失败分类/吸收不因 options 改变，`:158-210`）；`okUndefined` 模式感知（legacy 两键、budget 四键，`:287-295`）；XmlFragment/scalar 分支原样（`:558-559`）；E100 顶层 try 原样（`:230-238`）且预算读下仍回 `PATH_NOT_ALLOWED` 成员（V4）；`readableOwnDataValue`/`readableArrayElement`/`isPlainRecord` 零改动 | **no-conflict** | `docs/adr/0008` L18-30 vs diff（上述函数体零改动，仅线程化参数）；S16/S17/S18 + 既有 guards 39 tests 未改全绿 | 无 |
| ADR-0008 L27「读取只观察调用瞬间已经提交的 live Y.Doc」 × **B16 detached 容器折叠**（SA6 迭代 1 裁决） | 读只观察已提交文档状态；预算内投影语义（0024 修订后） | `budgetFold` 对 `doc === null` 的 `Y.Map`/`Y.Array`：折叠照常（B15 容器判据，`read.ts:584-590`）→ 同形空容器；`rawTotal := 0`、不记条目、`truncated:false`（B16③）——prelim 内容（`_prelimContent`）非已提交文档状态，不计入；**零公共 count 读**（不执行 `size`/`length`/`keys()`/`get`/`toJSON`，B16④，`:585`/`:589` 短路先于 `v.size`/`v.length`）；`d ≥ 1` 展开/保留物化走现行响亮守卫（`projectValue` detached 守卫 `:548-552` 与 plain 域嵌套 Yjs 响亮失败 `:735-737` 原样，B16⑤）；detached 非容器走终态 no-op + 现行守卫（B16⑥）。**裁决心证**：ADR 对该角落沉默（0024 未定义未集成容器计数），B16 以「文档可观测子项=0」解释性钉死，与 0008 已提交语义、0024 决策 1 骨架语义、决策 3 直接子项数口径三方相容；被否决的对立读法（折叠前置 detached 守卫=选项 b）会使骨架读内容敏感，与「未展开分支零物化」相悖——未实施 | **no-conflict**（契约解释在 ADR 边界内，无需修订） | `docs/adr/0008` L27 + `docs/adr/0024` L26/L54 vs `read.ts:583-597`；S19④/O-1/S21 扩展测试（`…shape-budget.test.ts:485-515,550-562`，含 own accessor 计数器=0 断言）；SA6 §5.4 yjs 13.6.32 公共读数实证 | 无 |
| ADR-0024 决策 4（runtime `readData` 恒五键，破坏性修订） | T2 范围 | 未实现；`packages/namespace-runtime/**` 零 diff；`runtime.ts:119` `Extract<ReadLogicalValueResult,…>` 输入类型未变 → `NamespaceRuntimeReadDataResult` 零泄漏 | **no-conflict**（范围纪律） | `git diff --name-only` 对 namespace-runtime/namespace-registry/vfsl/vfsl-protocol/docs/CONTEXT.md = 0 命中 | 无——T2 后续票 |
| ADR-0024 决策 5/7（`resolveSchemaAtPath` 三参化、`DeepOptional` 类型面） | T3/T4 范围（vfsl/vfsl-protocol） | 未实现；两包零 diff | **no-conflict**（范围纪律） | 同上 git diff 0 命中；全仓 `DeepOptional` 仍零命中 | 无——T3/T4 后续票 |
| ADR-0024 文档负控 + docs/integration 形状注记 | T5 范围（registry 正则、「恰三键」注记） | 未实现；registry/docs 零 diff | **no-conflict**（范围纪律） | 同上；`docs/integration/cordis-plugin-hosting.md` 零 diff | 无——T5 后续票 |
| ADR-0003（ValueSchema 9-kind 冻结联合） | 冻结语义联合不得扩展 | 零接触（T1 纯值通道；截断标记属投影包装=T5 后续） | **no-conflict** | `docs/adr/0024` L77；diff 无 ValueSchema/schema 派生面文件 | 无 |
| CONTEXT.md 词条（形状预算/截断省略/截断清单） | 恒在场、无「条件在场」、条目三字段、omitted 直接子项数、_Avoid_ 各项 | 实现与词条逐项同源：预算成功面恒四键（S7 空清单在场锚）；无条件在场；条目不携带子键列表；直接子项数（S24 反证）；预算护栏未当分页（条目序不承诺，S12 现场序派生断言） | **no-conflict** | `CONTEXT.md` L45-55 vs `read.ts:100-108` 与 shape-budget 测试断言纪律（多重集断言 `:104-117`） | 无 |
| `packages/doc-runtime/AGENTS.md`（模块纪律） | 读取 schema 无关；公共 API 仅经 `src/index.ts`；surface guard 覆盖每个导出；公共类型/读契约变更跑 root typecheck/test | 读取保持 schema 无关（预算为 schema 无关投影概念）；新类型仅经 index.ts 导出且 type-guard 加法锚覆盖（TS2305 机制）；root `pnpm typecheck`/`pnpm test` 由 SA3 报告 exit 0（§6.4，341 文件/3717 tests ×2 次复跑） | **implements-existing-decision**（义务兑现） | `packages/doc-runtime/AGENTS.md` vs `src/index.ts:14-20`、`public-surface-type-guard.test-d.ts` diff（+15 仅加法）、SA3 §6.4 | 无 |
| SA2 O-1/O-2（评审观察落实） | O-1：目标入口折叠先于 detached 守卫钉死 + 锚；O-2：`?? ∞` 冗余消除 | O-1 落实：折叠前置（`projectValue:538` 先于 detached 守卫 `:548`）+ `['holder','ys'],{depth:0}` 锚（测试 `:508-515`）；O-2 落实：P1 入口 `ctx.budget === null ? 0 : ctx.budget.depth`（`:219`），无冗余 `?? ∞` | **implements-existing-decision** | SA2 §14 vs `read.ts:216-221`、测试 `:508-515` | 无 |

**裁决分布**：implements-existing-decision ×8；no-conflict ×8；evolution-required ×0；hard-conflict ×0。

## 3. Overrides

| Old decision | Override authority | Scope | New obligation |
|---|---|---|---|
| —（无需 override） | — | — | — |

零 Owner 评论（快照 comment IDs: none）。实现未对任何既有决策施加例外：三参化依据 ADR-0024 修订节（合法演进已入库）；B16 为 ADR 沉默角落的契约解释（SA6 迭代 1 已批准），非对任何条款的偏离。

## 4. Frozen surfaces

（前置门禁 §4 冻结面 × 实际 diff 逐项核对）

| Surface | Must remain unchanged | Evidence | Actual result |
|---|---|---|---|
| 无 options 行为 | 逐字节现行为：成功恰两键、失败 `PATH_NOT_ALLOWED` 单码、投影输出深等 | ADR-0024 L29/L102；AC5 | **保持**：legacy 全门控（`ctx.budget===null`）；4 个冻结锚文件零改动（git status 不含）且 SA3 §6.2 报全绿；S1/S23 两键锚 |
| 缺席吸收语义 | 缺键/越界/键空间外 ≡ ok:true value:undefined；中间缺失立即结束；E1 键省略 | ADR-0008 L23；ADR-0024 L40 | **保持**：`okUndefined` legacy 两键（`:287-288`）；吸收早退与键省略原样（`:168/174/183/190/645/784`）；S16 |
| 零 throw 纪律 | 预期失败（含非法 options）同步联合返回；仅 internal bug 抛（E100 兜底） | ADR-0008 L28；ADR-0024 L30 | **保持**：E100 顶层 catch 原样（`:230-238`）；校验内层 try 收编（`:329-360`）；guards「零外抛」断言全类 |
| `PATH_NOT_ALLOWED` 码域 | 路径/载体缺陷专用；预算缺陷不借用；不借 `RUNTIME_READ_DISABLED` | ADR-0024 L30 | **保持**：新码仅进 `ReadLogicalValueAtPathBudgetResult`（`:108`）；G0/N0/N1/P1 失败构造 `notAllowed` 原样；NC-4（S18）+ guards 单码断言 |
| 终态语义 | `Y.XmlFragment` 语义字符串、标量原样；终态预算 no-op | ADR-0008 L26；ADR-0024 L31 | **保持**：`budgetFold` 对终态返回 null → 落现行分支（`:546`/`:583-597`）；S15 |
| 值域纪律 | 无第三态、无哨兵、无同形空占位（`depth:0` 目标唯一例外） | ADR-0024 L40 | **保持**：空容器仅出现在被折节点自身；被裁键缺席；S26 `hasOwn===false` 断言 |
| ValueSchema 9-kind | 不扩展、不混入传输形态 | ADR-0003；ADR-0024 L77 | **保持**：零接触（diff 无相关文件） |
| doc-runtime 公共面纪律 | 导出仅经 `src/index.ts`；surface guard 覆盖每个导出 | 模块 AGENTS | **保持（加法）**：index.ts 仅 `export type` ×3（+7 行）；零新值导出；type-guard 加法锚 |
| runtime readData 三键形状与失败联合 | `runtime.ts:119` Extract 输入不变 → `NamespaceRuntimeReadDataResult` 零泄漏；`:484` 2 参调用不变 | SA8 前置 §4；SA6 §10 耦合点 | **保持**：`packages/namespace-runtime/**` 零 diff（SA8 亲核 `git diff --name-only` 0 命中；`runtime.ts:119` 原文在库） |
| 写路径/sequencer/persistence/wire/协议 | T1 零接触 | ADR-0024 决策面归属 | **保持**：diff 仅 doc-runtime 3 文件 + 3 新测试；`docs/protocols/**`/wire 零 diff |

## 5. Evolution requirements

**无未决 evolution。** ADR-0024（accepted，commits `50d52a1`→`7679c57`→`ba11f32`）已完成的修订（0008 读语义、0016 四处）覆盖本切片全部所需演进；实现按修订后决策集落地，未产生新决策面需要成文修订：

- B16/R9（detached 容器 `d===0`：rawTotal:=0、零公共 count 读、d≥1 现行守卫）：ADR-0024/0008 均未定义未集成容器的计数语义；SA6 迭代 1 以「文档可观测子项」口径解释性钉死，与两 ADR 条款相容（§2 行 9 裁心论证），不构成契约变更，无需 ADR 修订。
- 实现零静默偏移：`read.ts` 模块头注与 `budgetFold` 头注成文 B16/R9 口径（E10 义务满足）。

**非阻塞 docs 同步债（维持登记，非本切片义务）**：N-1（ADR-0008/0016 镜像修订节）、N-2（CONTEXT「载体投影读取」词条三参句）——`docs/**` 与 `CONTEXT.md` 零 diff，符合 T1 DENY LIST；归属后续 docs 收口票/T 系列末切片。

## 6. Hard conflicts

**无。** 四个审查焦点逐项结论：

1. **公共三参 API/结果联合**：双重载落形与 ADR-0024 决策 1/6 及 SA6 §12.4（双结果类型）逐字一致；旧联合逐字不动 → 跨包 Extract 派生零泄漏（结构性排除，且有零 diff 佐证）。
2. **`READ_OPTIONS_INVALID` 失败语义**：定序（G0→OPT→N0）、零 doc 触碰、零 throw/零 accessor 执行/零变异、失败字段构成（path 新鲜回显 + 非空 message、禁带预算键）、码域隔离——全部按契约落地，ADR-0024 决策 1 的响亮拒绝条款兑现。
3. **截断事实**：恒在场四键成功面、条目三字段、omitted=直接子项数（O(1) 载体计数，非后代）、depth 尾段键名/width 父路径单条、(path,kind) 唯一、逐层新鲜——与 ADR-0024 决策 3 及 CONTEXT 词条逐项同源。
4. **detached 容器 B16**：折叠照常 + rawTotal:=0 + 零公共 count 读 + d≥1 现行响亮守卫 + 折叠/展开对称锚（S19④/O-1 vs S21/NC-8）——按 SA6 迭代 1 已批准修订落地，与 ADR-0008「已提交文档」语义相容；SA3 唯一实现 delta（`budgetFold` 短路 `:585/:589`）即 §15 A-1，无扩大。

## 7. Required actions

| # | 类型 | 内容 | 归属 |
|---|---|---|---|
| — | 阻塞项 | **无** | — |
| N-1 | 非阻塞 docs 跟进（维持前置门禁登记） | ADR-0008/0016 正文补 ADR-0024 镜像修订节 | 后续 docs 收口票/T 系列末切片 |
| N-2 | 非阻塞 docs 可选（维持登记） | CONTEXT「载体投影读取」词条补三参形态句 | 同上 |
| 注 | 流程注记（非冲突） | SA4/SA7 动态验收与 E5 m3–m6 变异证据按分工归后续角色/Controller；SA3 已备 m1/m2/m7/m8 证据。若后续角色发现新决策面，可再触发冲突复查 | SA4/SA7/Controller |

## 8. Verdict

**clear** —— 放行。

实现后复查闭合前置门禁 D-3：全部对照项为 no-conflict 或 implements-existing-decision，无 hard-conflict，无未决 evolution-required，无 override 需要；§4 冻结面十项逐项核对全部保持（其中公共面为契约授权的纯加法）；diff 范围与 SA6 §10/SA1 §11 ALLOW LIST 逐行一致，DENY 面零触碰；零临时物残留（`.scratch*` 零命中、src 下零 `.js`）。

## 9. requiresConflictRecheck

**false**。理由：

- 本报告即 D-3 要求的实现后冻结面复查，已按实际 diff 逐项闭合；公共 API 与新失败语义面（前置门禁 §10 置 true 的两项依据）均已对照最终产物核对完毕；
- 无正式 override、无未决 evolution、无 SA4/SA9 新决策面输入；
- 后续 T2–T5 切片（readData 五键、resolveSchemaAtPath 三参化、DeepOptional、文档负控）各自携带新的公共面/失败语义/协议类型面变化，届时由各切片的门禁流程重新触发冲突复查——属未来任务义务，非本切片待核对项。

—— 报告结束 ——

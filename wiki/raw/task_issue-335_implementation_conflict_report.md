# 冲突报告（Conflict Report）— Issue #335 实现后复审（implementation recheck）

> SA8 产出。只裁决冲突，不评设计优劣、不判实现/测试质量、不做设计、不运行测试。基准 = ADR 全集 + CONTEXT.md（+ 模块 AGENTS 明文收录的决策）；源码与 SA3 证据用于确认当前事实。历史报告（前置门禁 `task_issue-335_conflict_report.md`）的结论不自动延续——本文只反映**当前被审对象（最终 diff）**。
>
> **Iteration 2（重试）**：前一轮 SA8 执行的观察者失败、未产出业务 verdict——本轮对**同一最终 diff**（自 SA3 证据产出以来未变：src mtime 18:43 < SA3 报告 18:44；`git status` 仅 2 改动 src + 4 新测试 + 任务件）全量独立复核：决策集重读（ADR 0024/0016/0003/0019/0008 + CONTEXT 词汇 + 模块契约）、两 src 文件全文与完整 diff 逐行判读、冻结面 grep 实测（`'truncated'` 于 derived.ts/evaluate.ts/validate-patch.ts/resolve.ts 零命中；九 kind 联合原样）、负控实测（新测试 `readData(` 零命中）、断言面与 SA3 证据交叉核对。结论与裁决分布不变；本版仅修正相对最终修订漂移的行号引用并补本溯源注。无历史 iteration 堆叠。

## 1. Reviewed subject

**implementation**（实现后复审）。被审对象 = Issue #335 的最终交付 diff：

- `git diff --name-only`（tracked）：`packages/vfsl/src/resolve-schema-at-path.ts`、`packages/vfsl/src/index.ts`；
- 新增 untracked：`packages/vfsl/test/resolve-schema-at-path-budget{,-fixture,-control}.test.ts`、`resolve-schema-at-path-budget.test-d.ts`（4 文件，均落设计 §10 ALLOW LIST）；
- DENY 全域（`derived.ts`/`evaluate.ts` 等 vfsl 其余 src、doc-runtime、namespace-runtime、namespace-registry、vfsl-protocol、`docs/**`、`CONTEXT.md`、`packages/vfsl/AGENTS.md`、既有 8 测试/夹具、工程配置）**零改动**（`git diff --stat` / `git status --porcelain` 实测）。

出场依据（技能三条触发线全中）：设计 §14 自申报 `requiresConflictRecheck=true`（五项）；前置门禁 §10(a)(b)(c) 三项后置核对；实际 diff 触碰公共 API/类型面（`resolveSchemaAtPath` 签名 + 公共类型出口 + 结果联合失败分支——冻结相邻面）。无 Issue comments（REST 读取 `[]`，派发确认），无 Owner 评论 override 可应用。

## 2. Inputs and decision set

| 输入 | 状态 |
|---|---|
| 设计 `wiki/raw/task_issue-335_design.md`（iteration 1，770 行，SA2 `approve` 后版本） | 已读全文 |
| SA2 评审 `wiki/raw/task_issue-335_sa2_review.md`（approve；F1–F5 已解决 + N1/N2 观察） | 已读全文 |
| SA3 实现报告 `wiki/raw/task_issue-335_sa3_impl.md`（iteration 0；四命令门禁 + 变异抽查证据） | 已读全文 |
| SA6 契约 `wiki/raw/task_issue-335_sa6_contract.md`（G0–G10/§12.4 矩阵/§15 Q1–Q9） | 已读全文 |
| 前置门禁报告 `wiki/raw/task_issue-335_conflict_report.md`（clear + §10 三项 recheck）与决议摘录 `_relevant_decisions.md` | 已读全文 |
| 最终 diff（两 src 文件全文 diff + 4 新测试文件结构与断言面抽查） | 已逐行/抽读 |
| 决策集：`docs/adr/` 0001–0024 全集（24 文件，全部 accepted，无 superseded；条款级修订关系见 §4）；根 `CONTEXT.md`（L41–55 预算词汇，全读）；`packages/vfsl/AGENTS.md` 模块契约；`docs/vfsl/v1-spec.md`（无 resolver 条款面，前置门禁已核） | 已读/摘录核对 |
| tracking issue #331 正文 Implementation Decisions（「语义 schema 投影同 depth 裁剪」条原文，经 `gh` 只读核对） | 已核 |
| SA4/SA9 报告 | **不存在**（本票未产出）。非阻塞：本次 recheck 由设计 §14 + 前置门禁 §10 武装，证据 = SA3 报告 + diff 直接判读；SA4/SA9 若后续发现新决策面，按技能规则再触发 |

## 3. Decision analysis

| # | Decision | Clause | Delivered behavior（diff 事实） | Classification | Evidence | Required action |
|---|---|---|---|---|---|---|
| 1 | ADR-0024 | 决策 5「投影通道公共面（钉死）」L79 + 修订节第 3 条（L103）；备选否决 L116 | `resolveSchemaAtPath` 重载三参化（两参重载在前，`resolve-schema-at-path.ts` L194–207）；预算在 `BudgetWalk` 单遍历内同步收缩三件事（先裁后收集：`budget===0` 判定先于子位触达，标记位零 emit）；无 namespace-runtime 事后裁剪（该包零 diff） | **implements-existing-decision** | 0024 L79/L103/L116；`resolve-schema-at-path.ts` L194–207、L312–328、L410+ | 无（选型按钉死落地） |
| 2 | ADR-0024 | 决策 5「截断节点选型（钉死）」L77；备选否决 L115；CONTEXT.md L42 | `SchemaTruncationMarker`（`kind:'truncated'` + 嵌套线索联合 `SchemaTruncationClue`：`{via:'ref',name}` / `{via:'container',containerKind}`，L72–87）；标记只在投影通道构造，`derived.ts` 零改动、九 kind 联合无 `'truncated'`（grep 实测 0 命中）；公共守卫 `isSchemaTruncationMarker` 经 index 出口 | **implements-existing-decision** | 0024 L77/L115；CONTEXT.md L42；`resolve-schema-at-path.ts` L72–87、L140–153；`index.ts` L138–148 | 无 |
| 3 | ADR-0024 | L81「两通道截断位置对齐（契约级承诺）」：union 透明、ref 终态边界、同构计层 | walk 规则逐条对齐：object/array 各耗一层（`budget-1`，L460/L476）；union 同 `budget` 透传且自身永不成标记位（L481–499）；optional 同 `budget` 同路径、包装保留（L500–505）；enum/pattern/scalar/xml 终态 no-op（L523–533）；ref `budget===0` → ref 位标记携带 ref 名、不查 `values` 不登记闭包（L506–521）；计层原点 = 路径终点（游走段不进预算，`V.map(c => walk(c.node, depth, c.path))` L315） | **implements-existing-decision** | 0024 L81；`resolve-schema-at-path.ts` L451–533、L312–316 | T2 交付对齐前提；值↔标记一一对应的组合差分验收属 T3（#336，见 §8.1） |
| 4 | ADR-0024 | L73（+ #331「语义 schema 投影同 depth 裁剪」延伸决定）：闭包随展开层收缩、被裁路径 docs/aliasDocs 省略 | 闭包按发现序只登记展开层触达的 ref（`closureNames` 先登记后访体，L510–521）；`{depth:0}` 恒不触达别名体（ref 位即标记，SA3 毒化三态差分为行为锚）；docs 选键 `want = spine ∪ emitted` **精确匹配**（L322–326），标记位及其后代不入 `emitted`（先裁后 emit + `isTruncated` 剥离 optional 透明包装判定，L398–402） | **implements-existing-decision** | 0024 L73；#331 Implementation Decisions；`resolve-schema-at-path.ts` L398–402、L510–521、L322–326 | 脊柱键保留 pin 见 #9 |
| 5 | ADR-0024 | L74「width 对投影无操作」+ 验收 L125 | `maxChildrenPerNode` 校验通过后即弃用——`validateBudgetOptions` 只返回 `depth`（L355–379），walk 不接收、不比较、不计数；width-only 读走 `depth=∞` 全身份短路 | **implements-existing-decision** | 0024 L74/L125；`resolve-schema-at-path.ts` L355–379 | 无 |
| 6 | ADR-0024 | 决策 1 L29「不传 options = 完整投影：逐字节现行为」+ 修订节第 3 条 | `budgeted = options !== undefined` 分支隔离（L220）：无 options（含显式 `undefined`）走既有三步（合成 → `collectAliasClosure` → `sliceDocs`）逐字运行——`sliceDocs` 仅参数化为 `want` 谓词（原谓词逐字抽出为 `noBudgetWant`，L542–559），扫描序/合并序/稀疏兼容未动；SA3 证据：#272 14 路径冻结哈希 + M4 23 键基线 + `{}`/width-only/充足 depth 逐字节差分全绿（root 341 files/3649 tests） | **implements-existing-decision** | 0024 L29/L103；`resolve-schema-at-path.ts` L218–228、L297–310、L542–559；SA3 §Verification | 逐字节锚即起为兼容行为（§8.3） |
| 7 | ADR-0024 + `packages/vfsl/AGENTS.md` | L30（`READ_OPTIONS_INVALID` 注册于 readData 主接缝；「预算缺陷不是路径缺陷」）；模块契约「malformed 公共入参走判别联合而非 throw」「稳定码为兼容行为」；前置门禁 §8.3 明示 resolver 层码位未钉死、留 SA1 收口 | options 敌意通道 → 判别联合失败 `SCHEMA_OPTIONS_INVALID`（新稳定码，只进**加宽面** `BudgetedResolveSchemaAtPathResult` 三码联合；既有两码联合 `ResolveSchemaAtPathResult` 一字未动）；封闭形状（own 键集 ⊆ {depth, maxChildrenPerNode}）、present-undefined 拒收、抛错 getter/Proxy 整体 try/catch 收敛不泄漏；校验次序 path → options → derived → 游走（L208/218/230） | **implements-existing-decision**（模块契约判别联合义务 + L30「不借用路径失败码」原则在 resolver 接缝的结构镜像；码位为前置门禁预留的设计收口点，非 ADR 修订面） | 0024 L30；`packages/vfsl/AGENTS.md` Boundaries；`resolve-schema-at-path.ts` L218–229、L331–379、L126–134 | 码位即起为兼容行为；T3 组合面义务见 §8.1 |
| 8 | ADR-0024（对 0016 投影体的 override 范围裁定） | L77 只点名 `valueSchema` 字段加宽；L81 一一对应承诺；#331「投影的值语义子树与值同预算截断，截断处放显式截断节点」；CONTEXT L42「别名闭包与注释切片随展开层同步收缩」 | `aliases` 字段类型在预算读下同步加宽：`ReadDataSchemaProjection<V extends BudgetedValueSchema = ValueSchema>` 泛型化（L99–112），`BudgetedReadDataSchemaProjection.aliases: Record<string, BudgetedValueSchema>`；无预算读（缺省实例化 + 两参重载）恒 `Record<string, ValueSchema>`（test-d L100–101 锚定）；运行时体内标记按首发现预算渲染闭包条目 | **implements-existing-decision**（裁定见 §4 第三行：L81 契约级承诺 + #331「值语义子树同预算截断」在 ref 按名引用/闭包自包含结构下的必然结论，非新 override） | 0024 L77/L81；#331；CONTEXT.md L42；`resolve-schema-at-path.ts` L99–114；`resolve-schema-at-path-budget.test-d.ts` L100–101/L121–124 | 边界注记入既有排期的 ADR 0016 回填批注（§8.2，非阻塞） |
| 9 | ADR-0024 | L73 延伸决定「`docs`/`aliasDocs` 注释切片对被裁路径省略」的边界：脊柱键（调用方显式寻址、真实解析过的路径位，如 `['audit']` d=0 的 `ROOT.audit`）保留 | 交付 pin：`want = spine.has(k) ∪ emitted.has(k)`——脊柱位恒在场（游走段真实解析），被裁子树内部注释位（emitted 缺席）与被裁别名 aliasDocs 省略 | **no-conflict**（延伸决定文本对「路径位自身 vs 子树内部」未区分——授权域内边界 pin；两读法均满足「被裁路径省略」的子集断言；方向为多保留调用方寻址位，信息保真侧） | 0024 L73；设计 §6.6；`resolve-schema-at-path.ts` L322–326 | 随 §8.2 文档同步一句 pin 定格 |
| 10 | ADR-0016 | 未列修订清单条款继续有效：解析语义 L60–64（union any-member、值无关、keyPattern fail-closed、optional 透明、ref 缺失 InternalError）；交付纪律 L65（纯函数/同步/零 memo）；L69 always-on；结果联合两码 + path 回显 | 路径游走段逐字未动（diff hunk 边界实证：改动只在 options 插入、终点分叉、尾部新增件）；`BudgetWalk` 状态全部调用内局部（`inProgress`/`memo`/`closureNames` 为实例字段、实例每调用新建）；预算读不设 schema 开关；既有两码联合与 path 新鲜副本回显原样 | **no-conflict** | 0016 L60–65/L69；`resolve-schema-at-path.ts` L208–294（游走段零 diff）、L410–448 | 无 |
| 11 | ADR-0003 | 决策 4 L26–27（ref 按名引用不内联）；L46（派生 schema 形状变更须走设计修订流程）；0024 L115 | `derived.ts` 零 diff；ref 节点原样保留返回（共享节点）或 ref 位标记，从不内联展开；标记为投影通道自构造派生形态，不进 ValueSchema/DerivedSchema | **no-conflict** | 0003 L26–27/L46；git diff --stat（derived.ts 无条目）；`resolve-schema-at-path.ts` L506–522 | 无 |
| 12 | ADR-0019 | 决策 7 L132–137（三源合并 field→marker→member 末位、选键规则、键文法）；0016 修订节 memberDocs 条件稀疏 | `sliceDocs` 仅换 `want` 谓词与 `aliasNames` 形参——合并序、空过滤、memberDocs 缺席跳过/在场畸形 InternalError 全部原样（L827–849 逐字保留）；预算分支补 enum 字面量成员位 emit（`${path}.<member N>`，L523–527）使零标记读的 emitted ⊇ 锚定位全集（键文法内合法段全类覆盖） | **no-conflict**（选键集合收缩由 0024 L73 授权；合并纪律/键文法/稀疏兼容未动） | 0019 L132–137；`resolve-schema-at-path.ts` L523–527、L809–856 | 无 |
| 13 | `packages/vfsl/AGENTS.md` | 「Add public API only through `src/index.ts`」；「Stable error codes…compatibility behavior」 | 全部新名目（6 类型 + 1 守卫）经 `src/index.ts` L138–148 出口，无第二出口；`fn.length` 2→3 为加法第三参的固有结果——ADR「无 options 签名逐字不变」指调用形态与行为（一切既有两参调用合法且类型/行为不变，root typecheck 14 project 实证），无条款冻结函数元数据 | **no-conflict** | `packages/vfsl/AGENTS.md`；`index.ts` L138–148；设计 §6.8 尾注；SA3 deviations 1 | 无 |
| 14 | 票谱系分工（T1 #334 / T3 #336 / T4 #337 / T5 #338；前置门禁 §8.5 越界禁令） | doc-runtime / namespace-runtime / vfsl-protocol / namespace-registry（含 readData 文档负控）/ docs / CONTEXT 零改动 | 三包公共面零 diff；registry 负控 `readDataOptionUsages` 只扫三份作用域文档（fixture L30/L110 实读复核）且新测试文件 `readData(` 零命中（grep 实测）；T3 前提（归一化 recipe、options 规则集对齐、计层 oracle）已写入 SA3 实现说明 | **no-conflict** | git status --porcelain；`readdata-docs-adr0016-contract-fixture.ts`；SA3 §「T3 前提交付」 | 见 §8.1 |

裁决分布：**no-conflict 6 项（#9、#10、#11、#12、#13、#14）；implements-existing-decision 8 项（#1–#8）；evolution-required 0 项；hard-conflict 0 项。**

## 4. Overrides

前置门禁登记的两项正式 override 的落地核对，加一项范围裁定的显式结论：

| Old decision | Override authority | Scope | 落地核对（实现后） |
|---|---|---|---|
| ADR-0016「解析语义」两参签名条款（L50–58） | ADR-0024 修订节第 3 条 + 决策 5（corpus 内 accepted） | 加法第三参 `options?`；无 options 行为逐字节不变 | **按范围落地**：两参重载在前、结果类型恒 `ResolveSchemaAtPathResult`（纯 `ValueSchema`）；无 options 分支隔离（#6）；未越权改两码联合 |
| ADR-0016「投影体」`valueSchema: ValueSchema`（L32） | ADR-0024 决策 5「截断节点选型」（L77 钉死） | 预算读下 `valueSchema` 字段类型为投影包装联合；无预算读恒纯 `ValueSchema` | **按范围落地**：`BudgetedValueSchema` 仅出现在加宽面；缺省实例化逐字段同型（test-d L73/L100 锚定）；九 kind 冻结面零触碰（#2/#11） |
| （范围裁定）`aliases` 字段同步加宽——超出 L77 字面点名 | **不构成新 override**。裁定：L81「同一预算下值截断位置与投影截断标记一一对应——错位即契约违约」是契约级承诺；#331「投影的**值语义子树**与值同预算截断，截断处放显式截断节点」中的值语义子树在投影结构 = valueSchema + 闭包体（ADR 0016 投影体自包含 + ADR 0003 ref 按名引用的结构事实）。部分展开必然进入别名体、必在体内成员值位产生标记——加宽是既有决策条款的必然结论，且：① 无任何条款禁止预算读下 aliases 含标记（0024 对 0016 的四处修订均未固化 aliases 纯度）；② 无预算读纯度承诺原样成立（既有消费者类型零变化）；③ 全有全无备选与 L81 直接冲突（值通道逐容器裁、无整 ref 折叠概念——错位即违约）。设计已按流程诚实申报并送本复核（设计 §6.1/§14.2、SA6 §15 Q1） | 预算读下 `aliases: Record<string, BudgetedValueSchema>`；无预算读恒纯 | **确认在授权域内**，分类 implements-existing-decision（#8）。不据此要求 ADR 修订；建议随既有排期的 ADR 0016 回填批注显式登记（§8.2） |

Owner 评论 override：无（comments `[]`）。SA8 未替 Owner 或 SA1 创建任何新 override。

## 5. Frozen surfaces

| Surface | Must remain unchanged | Evidence | Actual result（diff 实测） |
|---|---|---|---|
| ValueSchema 9-kind 语义联合 / DerivedSchema / evaluate 接缝 | 无新 kind、派生 schema 形状零改动 | ADR-0003 L46；0024 L115 | **一致**：`derived.ts`/`evaluate.ts` 零 diff；`'truncated'` 在 derived.ts grep 0 命中；test-d 九 kind 恒等锚（L108–116） |
| `SCHEMA_PATH_NOT_FOUND` / `SCHEMA_PATH_INVALID` 语义与 path 新鲜副本回显；可信域 `InternalError` throw 清单 | 码位/语义/回显/通道划分不变 | ADR-0016 L56–58/L64；vfsl AGENTS | **一致**：两码联合一字未动（L117–124）；预算分支 throw 仅 `InternalError`（ref 缺失守卫与既有同文同码 L512 ↔ L781）；环经两相防御零新增 throw |
| `ReadDataSchemaProjection` 四键与三源合并序 | 键集不变；合并序 field→marker→member；memberDocs 稀疏兼容 | ADR-0016 L30–42；ADR-0019 L132–137 | **一致**：泛型化缺省实例化逐字段同型；ok 分支恰 `{ok, valueSchema, aliases, docs, aliasDocs}`、无 options 回显；`sliceDocs` 合并纪律逐字保留 |
| 无 options 输出逐字节恒等 | options 缺席/显式 `undefined` 时投影输出与现行为逐字节相同 | 0024 L29/L79/L103 | **一致**（结构性 + 证据）：分支隔离 + `noBudgetWant` 逐字等价；SA3 冻结哈希/M4 基线/root 全量回归绿（#6） |
| schema 通道 always-on | 预算参数非 schema 开关 | ADR-0016 L69；0024 修订节第 1 条 | **一致**：无任何 schema 有无分支 |
| 解析器纯函数/同步/零跨调用 memo | 无跨调用状态、无异步 | ADR-0016 L65；vfsl AGENTS | **一致**：`BudgetWalk` 每调用新建、状态全局部（#10） |
| readData 文档负控 | 不触 `readDataOptionUsages` 及其三份作用域文档 | registry fixture L30/L110 | **一致**：负控只扫 skill + docs/integration；新测试 `readData(` 零命中 |
| doc-runtime / namespace-runtime / registry / vfsl-protocol 公共面 | 本票零改动 | ADR-0016 L74–76；票谱系 | **一致**：四包零 diff；两参消费面与逐 kind 穷举拷贝零改动编译通过（root typecheck，SA3 G9.2） |
| docs / CONTEXT.md / ADR corpus | 本票零改动（ADR 0024 与词汇基线已在母提交 `50d52a1`/`7679c57`/`ba11f32` 落定） | 设计 §1 非目标；前置门禁 §6 | **一致**：`git status` 无 docs/CONTEXT 条目 |

## 6. Evolution requirements

**无新增 evolution-required 项。** 本 diff 所需的决策演进（ADR 0024 全文、ADR-0016 四处修订登记、CONTEXT L41–55 词汇）已由 PR #332 支上的基线提交在进入本票前完成，修订链在 corpus 内完整；本 diff 未触碰任何规范文档，也未产生与规范文档字面矛盾的新语义（§3 #7/#8/#9 三处边界 pin 均落在 ADR 未钉死或延伸决定的授权域内，见 §4 裁定）。

既有排期的文档同步（非本票义务，不因本 diff 扩大）：ADR 0016 回填「ADR 0024 修订」批注节 + T5（#338）负控正则/形状注记。建议回填时一并显式登记三处边界 pin（见 §8.2）——属语料导航性，非冲突消解。

## 7. Hard conflicts

无。

## 8. Required actions

1. **T3（#336）组合面义务（本 diff 交付的前提，跨票对齐）**：
   - 值截断条目 ↔ 投影标记路径差分前，投影侧按 SA3「T3 前提交付」两步归一（剥离 `<member N>` 段；ref 位对齐：保留 ref ⟺ 值侧已展开一层、ref 位标记 ⟺ 值侧折叠）；闭包体标记按弱断言或夹具规避多引用跨预算构造——错位即 ADR 0024 L81 契约违约。
   - readData 接缝先以 `READ_OPTIONS_INVALID`（ADR 0024 L30 注册位）结算自身 options 校验，resolver 的 `SCHEMA_OPTIONS_INVALID` 为防御性第二道门经 T3 吸收（如 `schema:null` 先例）——两码各守各接缝，不得互借。
   - T1/T3 须采纳与 resolver 相同的 options 规则集（含 present-undefined 拒收），或在接缝净化后透传——否则合法透传会被本层误拒。
   - T3 的标记 detach 深拷贝须用 `isSchemaTruncationMarker` 判别（公共守卫已交付）。
2. **文档同步（非阻塞，随既有排期）**：ADR 0016 回填批注（PR #332 / T5）时显式登记：① 预算读下 `aliases` 字段类型随 `valueSchema` 同步加宽（§4 裁定）；② resolver 层 options 失败码 `SCHEMA_OPTIONS_INVALID`（与 readData 层 `READ_OPTIONS_INVALID` 的接缝分工）；③ docs 脊柱键保留 pin（§3 #9）。
3. **兼容行为冻结宣言**：自本 diff 起，三参签名/六类型一守卫出口、`SCHEMA_OPTIONS_INVALID`、无 options 逐字节锚、无预算读纯 `ValueSchema` 类型、计层规则（容器一层/union·optional·enum 透明/ref 终态/原点 = 终点）均为已发布兼容行为——后续任何修订须走显式决策演进，不得静默变更。
4. **冻结面持续守卫**：ValueSchema/DerivedSchema/evaluate 与其余三包公共面维持零触碰（后续票同理）；标记永不进 `derived`。

## 9. Verdict

**clear** —— 14 项对照全部为 no-conflict（6）或 implements-existing-decision（8）；无 evolution-required、无 hard-conflict；前置门禁 §10(a)(b)(c) 三项与设计 §14 五项自申报复核项全部闭合：

- **(a) 公共 API/类型面**：三参加法重载、6 类型 + 1 守卫唯一出口 `src/index.ts`、既有两码联合与缺省实例化逐字段同型、`namespace-runtime` 两参消费零改动编译通过——与 ADR 0024 L77/L79/L103 及模块契约一致。
- **(b) 两项 override 落地**：无 options 逐字节恒等（分支隔离 + 冻结哈希证据）、无预算读恒纯 `ValueSchema`（重载 + test-d 锚）；`aliases` 加宽经裁定为 L81/#331 必然结论、在授权域内、无预算纯度不受染（§4 第三行）。
- **(c) 跨票计层**：计层规则逐条对齐 ADR 0024 L81，未漂移；归一化 recipe / options 规则集 / oracle 前提已随 SA3 实现说明交付 T3；一一对应的组合验收按谱系归 #336 自有门禁。

## 10. requiresConflictRecheck

**false** —— 理由：本报告即实现后复查，前置门禁与设计自申报的全部待核对项（公共 API/类型面、截断标记语义、预算计层、两项 override 及 aliases 范围裁定、失败码收口、冻结面逐项）已对最终 diff 闭合；剩余工作（T3 #336 组合差分、T4 #337 类型面、T5 #338 文档负控与回填批注）属票谱系各自的后继票，按流程自带前置门禁与设计复审，不是本变更集的未核对遗留。

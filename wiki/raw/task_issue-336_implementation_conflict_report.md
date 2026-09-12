# 冲突报告（Implementation Conflict Report）— Issue #336 实现后复查

> SA8 产出（iteration 3，implementation 复查）。只裁决冲突，不评设计优劣、不判实现
> 质量与测试充分性、不做设计、不运行测试。基准 = ADR 全集 + CONTEXT.md + 模块 AGENTS
> 明文收录的决策 + 本票前置门禁/设计后复审冻结面；源码仅作被审对象与现状证据。
> Issue #336 REST comments 为空（本迭代指令重读确认）——无 Owner override 面。

## 1. Reviewed subject

**implementation** —— Issue #336「[shape-budget] T3: readData 五键组合——两通道同预算与
截断清单」的已实现 diff（worktree `/home/wangjian/nomicore-fix-issue-336`，基线 HEAD
`cdfdff6`，未提交：9 文件修改 + 6 新测试文件），对照决策集逐项核对。本迭代指令指定的
复核焦点：**两通道预算对齐、五键成功/失败形状、敌意 options 行为、lease 透传**，以及
ADR / 规范协议 / 架构 / 冻结面冲突与批准设计要求边界的保持。

## 2. Inputs and decision set

- 被审对象：`git diff` + `git status`（改动面 = `packages/namespace-runtime/src/{runtime,
  read-schema-projection,index}.ts`、`packages/namespace-registry/src/{types,lease,index}.ts`、
  T0 三件（`readdata-ok-shape.ts` / `readdata-shape-assertion-scan.ts` /
  `readdata-shape-assertion-consolidation-gate.test.ts`）+ 6 新测试文件（red / control /
  fixture / runtime type-d / registry passthrough / registry type-d））。
- 谱系输入：`wiki/raw/task_issue-336.md`（简报）；`task_issue-336_relevant_decisions.md`；
  前置门禁 `task_issue-336_conflict_report.md`（clear / 16 行 / requiresConflictRecheck=true）；
  设计后复审 `task_issue-336_design_conflict_report.md`（iteration 2，clear / 17 行 /
  §8 八项实现复查项）；SA1 设计 `task_issue-336_design.md`（iteration 1，1070 行）；
  SA2 评审 `task_issue-336_sa2_review.md`（iteration 1，**approve**）；SA3 报告
  `task_issue-336_sa3_impl.md`（iteration 0）。`task_issue-336_sa6_contract.md` 不存在
  （验收权威 = Issue AC + ADR 0024 验收节 L120–130——前置门禁已裁决，维持）。
- 决策集（前置门禁已清点：`docs/adr/` 20 文件全部 accepted、无 superseded）：本轮细读
  ADR-0024（决策 1 L22–31 / 决策 2 L33–40 / 决策 3 L43–56 / 决策 4 L58–69 / 决策 5
  L71–83 含 L81 / 决策 6 L85–87 / 决策 7 L89–95 / 修订节 L97–105 / 否决节 L109–118 /
  验收 L120–130）、ADR-0016（L19/L22–25/L69–70/L75–77）、ADR-0008（读取能力节、L123）、
  ADR-0009（L38）、ADR-0003（L46）；根 `CONTEXT.md`（L37–55 预算词汇族、L115–117 停接纳）；
  模块 AGENTS：namespace-runtime / namespace-registry / doc-runtime（本轮系统注入，逐一
  核对边界）。readData 不上 wire、不进语言 spec（前置门禁 grep 结论，无 diff 触碰面）。
- 源码事实亲核（被审对象与上游单源）：T1 权威 `doc-runtime/src/read.ts` L326–361
  `validateReadOptions`（键空间/取值通道/收编面——净化器对齐基准）与 L370–377
  `optionsInvalid`；vfsl `resolve-schema-at-path.ts` L72–114（标记/包装联合/
  `ResolveSchemaBudgetOptions`——冻结面证据）与 `derived.ts` L44–53（ValueSchema 恰
  9 kind，无 `'truncated'`）；runtime.ts / read-schema-projection.ts / lease.ts /
  types.ts / index.ts 全部 diff hunk 逐一亲读；T0 三件 diff 亲读；6 新测试文件全文亲读
  （断言与设计 §12 规格逐组对照）；`grep readdata-ok-shape` 消费面亲测（既有消费 10
  文件零改动；gate 文件仅注释提及、实消费 scanner）。

## 3. Decision analysis

| # | Decision | Clause | Subject behavior（实际 diff） | Classification | Evidence | Required action |
|---|---|---|---|---|---|---|
| 1 | ADR-0024 决策 4 | L58–69（恒五键、恰三键→五键破坏性修订、两模式同形、失败分支不带新键、空清单恒空数组） | 两成功联合成员均恰五键 `{ok,value,schema,truncated,truncations}`；无 options 分支 `truncated:false` + 每调用新鲜 `[]` 字面量（无共享常量）；预算分支 `truncated`/`truncations` 逐字段透传（B14）；`truncations` 用 `readonly ReadLogicalValueTruncationEntry[]`（无字面量收紧——§7.7 否决项未复活）；恰三键→五键在 T0 helper 单点完成（10 消费文件 git status 零改动） | **implements-existing-decision** | runtime.ts 类型块 + readData S2a/S2b（L568–605）；readdata-ok-shape.ts（READDATA_OK_KEYS 五键/readDataOk 缺省参/expectReadDataOk 独立内联）；runtime type-d `keyof` 精确集锁 ×2；red 测试 A1–A3；control JSON 逐字节预言机 | 无（形状唯一、无「缺席=无截断」隐式约定已兑现） |
| 2 | ADR-0024 决策 1 | L29–31（`READ_OPTIONS_INVALID` 进公共失败面：同步、不抛、不借路径/生命周期码；无 options=完整投影） | 该码只在预算联合（`ReadLogicalValueBudgetFailure = Extract<T1 预算联合,{ok:false}>` 单源派生；legacy 联合失败源仍为两参联合 Extract——零泄漏）；无 options 分支结构上不触 options 语义（`options === undefined` 早分流）；三来源（T1 首拒原样透传 / 出口① 重派发 T1 单源成员 / 出口② 接缝终态成员）同形状恰四键 `{ok,code,path,message}`；全部同步零 throw；F1 基础矩阵 14 例 + F2 结构不可达 + type-d 双向锁 | **implements-existing-decision** | runtime.ts L129–135/L581–582/L586–598；read.ts L370–377（成员单源）；runtime type-d L44–55；red F1/F2 | 无 |
| 3 | ADR-0024 决策 6 | L85–87（runtime 组合两通道同预算；registry lease 原样透传；不新增第二条读路径）+ L116（否决 runtime 事后裁剪） | 一次 readData 内：raw options 原样入 T1 三参（值通道）；投影通道只吃 canonical（净化后全新 plain 字面量）；重派发（出口①）为包内敌意-only 失败路径上的再校验派发——零新公共方法、非公共读路径；裁剪全部发生在 T1/T2 递归内，runtime 零事后裁剪 | **implements-existing-decision** | runtime.ts L581–604（组合体）；grep 全 diff 无 `readDataBudgeted` 类新方法；read-schema-projection.ts 只做重载分流 + 透传 options 给 resolver 三参 | 无 |
| 4 | ADR-0024 决策 5 | L81（两通道截断位置一一对应，契约级承诺；错位即违约） | `canonicalReadOptions`（runtime.ts 包内、不导出）读纪律与 T1 `validateReadOptions` **逐字对齐**（SA8 本轮对 read.ts L326–361 逐行亲核）：(a) `Object.keys` own-enumerable 键空间；(b) `getOwnPropertyDescriptor` data-property `value` 取值（零 `[[Get]]`）；(c) 整体 try 收编；(d) present-undefined 剥离、ownKeys 谎报键不写、≥0 有限整数、-0 归一（镜像 H10）；唯一刻意差异 = 不重查宿主原型（设计 §7.1-A-2 注记论证 + SA2 §5 独立推演认可——继承键在两通道键空间之外）。视图不稳定（键集漂移至拒绝视图/accessor 显形/值非法/trap 抛）→ 不构造 canonical、A-2b 响亮失败。对齐断言进主缝：D1–D6 位置集相等（标记位 recipe 归一）+ F-x1/F-x2/F-x3 敌意夹具延拓（「相等 ∨ 响亮失败」）+ F3 差分矩阵（runtime 接受集 ≡ T1 接受集，仅确定性夹具）+ F4 `{depth:undefined}` 净化证明 + D5/D6 `getCalls()===0` 零 `[[Get]]` 计数锚 | **implements-existing-decision** | runtime.ts `canonicalReadOptions`（L856–884 区域）+ read.ts L326–361 亲核比对；red D1–D6/E1/F3/F4；设计 §7.1-A-2/A-4 | 无（「两个 T1 可接受视图间交替」的不可检测残余与设计 §13 登记一致——检测需 doc-runtime 暴露 `ValidatedBudget`（新公共 API），实现未伪装闭合；该输入类不在任何决策条款的承诺/禁止面内，前置/设计复审同裁，维持） |
| 5 | ADR-0024 决策 3 | L43–56（清单条目三字段、path 与实参同基、depth 尾段即被裁键名、width 父路径单条、omitted=直接子项数、条目不带内部子键列表） | `truncations` = T1 结果逐引用透传（T1 每调用新鲜累加器），runtime 零合成/零合并/零投影侧清单；B1/B2/B3（尾段键名、depth:0 骨架 + 单条目）；C1 直接子项数 2 ≠ 后代总数 6 显式断言；C2 width 父路径单条、被裁子键零罗列 | **implements-existing-decision** | runtime.ts L604；red B1–B3/C1/C2 | 无 |
| 6 | ADR-0024 决策 5 | L74 + 验收 L125（width 对投影无操作；width-only 预算读投影与无预算读逐字节相等） | canonical 保留 `maxChildrenPerNode`（组合层不按轴名过滤）；E1：width 触发读的 schema 与同路径无 options 读 `toStrictEqual` 且 `JSON.stringify` 逐字节相等 | **implements-existing-decision** | runtime.ts canonical（两轴同写）；red E1 | 无 |
| 7 | ADR-0024 决策 2 | L33–40（截断省略值内唯一形态、E1 吸收纪律、depth:0 唯一例外） | 组合层只在信封加键，值/投影内容零改写；G1 零物化哨兵（被截子树含 non-finite → 预算 ok、无预算读响亮失败）；无第三态/哨兵/同形占位引入 | **no-conflict**（值内形态单源 T1，组合面未触） | runtime.ts 组装体；red B2/B3/G1 | 无 |
| 8 | ADR-0016 | L19（恰三键——被 0024 决策 4 + 修订节第 1 条显式修订，corpus 内授权链） | 五键恒形经 T0 单点修订落地：helper `READDATA_OK_KEYS`/`ReadDataOkShape`/`readDataOk`/`expectReadDataOk`/`expectReadDataOkKeys` 全线五键（schema 保持纯面——SA2 N3 钉死，未加宽）；scanner `SUCCESS_SHAPE_KEYS` 五键（family B 常量驱动自动随动，family A 超集判定零改动）；gate 正负样本五键化 + 三键 family B 移入负样本；10 个既有消费文件零手改（git status 亲核 + grep 消费面 10 文件逐一对照） | **implements-existing-decision**（override 落地，范围未扩大） | 0024 L60–69/L101；readdata-ok-shape.ts / scanner / gate diff；§2 消费面 grep 记录 | 无 |
| 9 | ADR-0016 | L23（既有失败分支各走原有通道）+ 0024 L67 | 三既有分支形状零变化：`PATH_NOT_ALLOWED` 原样透传（doc-runtime 单源，D1）；`RUNTIME_READ_DISABLED` 四键（`readDisabled` 重构仅提取 `echoReadPath` 共用，回显纪律逐字保持）；`NAMESPACE_LEASE_RELEASED` 冻结单例（lease.ts L78–82 原文未动）；均不带 truncated/truncations（F1/F7/control/lease released 键集断言）；`READ_OPTIONS_INVALID` 为新增第四分支、恰四键 | **implements-existing-decision** | runtime.ts L564–570/L793–820；lease.ts RELEASED_ISSUE（diff 上下文未触）；red F1/F6/F7、control 失败键集、registry released 测试 | 无 |
| 10 | ADR-0016 + ADR-0024 | 0016 L22/L69；0024 L75（`schema:null` 单义三情形、always-on、预算非 schema 开关） | `projectReadDataSchema` 的 D3a 状态守卫位置与逻辑零变化；预算下 `schema:null` + `truncated:true` 合法共存（H1 preparing / H2 raw 路径）；净化失败**在投影调用之前**短路为响亮失败成员——绝不经 L57 `!resolved.ok → null` 收敛静默化（该收敛点代码原样保留，对 canonical 结构性不可达、防御纵深留给直接 resolver 调用方） | **no-conflict**（既有条款组合面未触；净化绕开而非修改收敛点） | read-schema-projection.ts L46–58（收敛点零改动）+ resolver 显式两分支；red H1/H2/D5 负断言（无 `ok∧schema:null∧truncated` 组合） | 无 |
| 11 | ADR-0009 + ADR-0016 | 0009 L38（lease 代理 Runtime 同步读取、不公开裸 Runtime）；0016 L76 + 0024 L87（原样透传） | `leaseReadData` 双重载：released 短路**先行**（冻结 issue 单例原样、带 options 调用同途）；active 期 raw options **同一引用**直传（registry 测试 stub 捕获 `options === opts` 引用同一性锚 + 敌意 Proxy get trap 调用计数 0——lease 层零预算解释/零校验/零敌意触达）；别名 `NamespaceLeaseReadDataBudgetResult = runtime 预算联合 \| released issue`；`_readAlias` 原文保持 + `_readBudgetAlias`/`_readOverloadOrder` 两新 Equal 锁；registry `src/index.ts` +1 type-only 导出 | **implements-existing-decision** | lease.ts / types.ts / index.ts diff；registry passthrough 测试四例 + type-d 锁 | 无（透传 = 代理语义最小加法扩展，未扩大 override） |
| 12 | ADR-0008 + CONTEXT | 0008 读取能力节（reads 不进 sequencer）/L123（`RUNTIME_READ_DISABLED` 稳定码）；CONTEXT L115–117（key 仅 lifecycle、getStatus 不受影响） | readData 全同步、零 sequencer 槽位（组合体为工厂闭包内纯函数，无 `sequencer` 触达）；lifecycle gate 先于一切 options 读取与 doc 触碰（F7：closing/closed + 非法 options → `RUNTIME_READ_DISABLED`）；getStatus 全生命周期可用（零 diff 触碰 status 面）；返回面 detached（投影 detach 深拷贝含标记全新副本——control detach 用例：引用互异/mutation 不污染/不冻结） | **no-conflict** | runtime.ts L551–606（无 sequencer 引用）；red F7；control detach 纪律用例 | 无 |
| 13 | ADR-0003 + ADR-0024 | 0003 L46（派生 schema 形状变更须走设计修订流程）；0024 L77/L115（标记 = 投影包装联合、不入 ValueSchema；无预算读恒纯） | `packages/vfsl/**` 零触碰（git status）；`BudgetedValueSchema = ValueSchema \| SchemaTruncationMarker`（resolve-schema-at-path.ts L82–88 既有）；`cloneValueSchema` 加宽为**纯/预算双重载**，新增显式 `case 'truncated'`（clue 全新普通副本、memo 统一、叶节点），10-case 穷尽、**仍无 default**；legacy 侧静态纯度经纯重载保住（`ValueSchema` 恰 9 kind 亲核，无 `'truncated'`）；标记永不下沉 ValueSchema 成员 | **no-conflict**（冻结面未触；标记处置按设计 D-3 钉死落地） | derived.ts L44–53；read-schema-projection.ts `case 'truncated'` + 双重载；type-d `legacySchema` 纯度锁 | 无 |
| 14 | ADR-0011/0014 + ADR-0016 L77 + docs/protocols | 诊断变更日志不涉及读面；ReplicationSession raw 读面不变；readData 不上 wire | `packages/replication-protocol/**`、`packages/ws-replication/**`、`packages/namespace-diagnostic-log/**`、`docs/protocols/**` 零触碰（git status 计数 0）；读路径零诊断发射点、零 wire 面 | **no-conflict**（范围核对） | git status 亲核 | 无 |
| 15 | 模块 AGENTS（runtime / registry / doc-runtime） | runtime：公共面 detached、reads 不进 sequencer、registry 经 internal seam；registry：公共 API 只经 `src/index.ts`；doc-runtime：读取 schema 无关（DENY） | 公共类型面变更全部经两包 `src/index.ts`（runtime +3 type-only、registry +1 type-only；值导出面仍恰 `RuntimeWriteFatalError`）；`packages/doc-runtime/**` 零触碰（只消费）；文件范围 = ALLOW 15 项一一对应、DENY 全零触碰（含 `readdata-schema-projection-fixture.ts` 零编辑——新 fixture 复制构造形态、apps/yjs-server 单参调用点 L609 原样） | **no-conflict** | 三份 AGENTS；git status 逐路径；§2 消费面 grep | 无（门禁运行为 SA3/SA4 面——SA3 报告 root `pnpm typecheck`/`pnpm test` 全绿；SA8 不运行测试） |
| 16 | ADR-0024 决策 1（敌意收编面——dispatch 指定复核项） | L30（响亮拒绝；同步不抛）+ 设计 §7.1-A-2b/A-2c（SA2 approve 锁定的修订面） | **敌意 options 行为三特性全部兑现**：(i) 零静默——净化失败绝不 `schema:null`、绝不带截断键（F-x5/F-x6 恰四键断言 + D5 负断言）；(ii) 零外抛——净化器整体 try 收编 + T1 E100 顶层 try 双保险（F-x4 抛错 get trap → 五键 ok、get trap 零执行）；(iii) 零洗白——canonical 不回喂 T1（重派发仍传 raw，备选 (δ) 未复活）；出口① 重派发仅在净化失败分支、T1 失败成员原样返回（零形状复制）；出口② `seamReadOptionsInvalid` 唯一触发点（净化失败 ∧ 重派发成功），返回类型注解 = `ReadLogicalValueBudgetFailure`（Extract 单源锁）、path 回显复用 `echoReadPath`（与 readDisabled 同纪律）、message 恒非空；`InternalError` 仍是唯一逃逸 throw（resolver 调用零 catch 添加） | **implements-existing-decision** | runtime.ts L586–598 + `seamReadOptionsInvalid`/`echoReadPath`；red F-x1–F-x6（descriptor 调用计数 4/5 与出口轨迹一致）；registry 敌意直传用例 | 无（A-2c 对 D1 的登记豁免按设计后复审 §4-2 三层锁定落地，未产生第二份形状事实源） |

裁决分布：**no-conflict 6 项（#7、#10、#12、#13、#14、#15）；implements-existing-decision
10 项（#1–#6、#8、#9、#11、#16）；evolution-required 0 项；hard-conflict 0 项**。

## 4. Overrides

本 diff 未新增 override、未扩大前置门禁 §4 三项正式 override 的范围，逐项落地核对：

| Old decision | Override authority | Scope | 落地核对（实际 diff） |
|---|---|---|---|
| ADR-0016 L19 恰三键 | ADR-0024 决策 4 + 修订节第 1 条（L60–69/L101） | 成功分支恒五键；失败分支不带新键 | ✅ 两联合五键；失败分支键集断言零新键；恰三键→五键恰在 T0 单点完成；版本 bump 归发布流（设计 §13 钉死为非代码面——维持） |
| ADR-0016 L76 狭义读法（lease 行为零变化） | ADR-0024 决策 6（L87） | lease `readData(path, options?)` 加法透传 | ✅ released 先行 + raw 同一引用直传 + 别名跟随 + `_readAlias` 原文保持；lease 层零预算解释（敌意 trap 计数 0 锚） |
| ADR-0008 完整深拷贝读语义（L27） | ADR-0024 修订节（L99） | 预算内投影 + 截断清单；不传预算 = 完整投影默认保留 | ✅ 裁剪全在 T1/T2 递归内（canonical 只进投影通道，无 runtime 事后裁剪）；无 options 分支两参逐字节（control JSON 预言机） |

Owner 评论 override：无需（comments 空；无既有决策被违反）。

## 5. Frozen surfaces

逐项核对实际 diff（基准 = 设计后复审 §5 冻结面表）：

| Surface | Must remain unchanged | Evidence | Actual result |
|---|---|---|---|
| ValueSchema 9-kind 语义联合 | 标记不得成为 ValueSchema 成员；无预算读投影恒纯 | 0003 L46；0024 L77/L115；derived.ts L44–53 | **一致**——vfsl 零触碰；`case 'truncated'` 克隆为 `SchemaTruncationMarker`（包装联合成员）；10-case 穷尽无 default；纯/预算双重载保 legacy 静态纯度 |
| `ReadDataSchemaProjection` 四键与键规约 | 键集/合并序不变；仅预算读类型加宽 | 0016 L30–42；0019 §7 | **一致**——投影体四键零变化（diff 只加重载与 marker case）；docs/aliasDocs 面未触 |
| 既有失败分支形状 | `PATH_NOT_ALLOWED`（doc-runtime 单源）/ `RUNTIME_READ_DISABLED` 四键 / released 冻结三键；不带截断键 | 0016 L23；0024 L67；lease.ts L78–82 | **一致**——三分支键集断言（F1/F7/control/registry released）；`readDisabled` 仅提取共用 helper、行为逐字保持 |
| 无 options 逐字节现行为 | 值与投影内容逐字节不变（信封加键） | 0024 L29/L67 | **一致**——S2a 两参通道 + control 独立预言机（doc-runtime 值 + vfsl resolver 投影）`toStrictEqual` + `JSON.stringify` 逐字节 |
| E1 输出端吸收纪律 | 无第三态；`depth:0` 唯一例外 | 0024 L40；CONTEXT L49–51 | **一致**——值内形态单源 T1；B2/B3 骨架读；G1 哨兵零物化 |
| `schema:null` 单义与 always-on | null 三情形不区分；ok 恒真；预算非 schema 开关 | 0016 L22/L69；0024 L75 | **一致**——D3a 位置不动；H1/H2 共存断言 |
| L57 resolver 失败收敛点 | 预算缺陷不得经此静默化；收敛行为与三个合法 null 情形不变 | read-schema-projection.ts L46–58 | **一致**——零语义改动；canonical 使其对预算缺陷结构性不可达（绕开而非修改）；净化失败在投影调用前短路 |
| `READ_OPTIONS_INVALID` 成员形状 | 恰四键、path 新鲜回显、message 恒非空、同步不抛、不借码 | 0024 L30；read.ts L370–377 | **一致**——三来源同一形状；接缝成员 Extract 单源类型锁 + `echoReadPath` 同款回显 |
| T1 公共面（doc-runtime） | 双联合/重载/G0→options→N0/校验器非导出/读纪律 | read.ts L94–155/L326–377；0024 L102 | **一致**——`packages/doc-runtime/**` 零触碰；净化器逐字对齐其读纪律（本轮亲核比对） |
| T2 公共面（vfsl） | 三参重载/标记包装联合/`SCHEMA_OPTIONS_INVALID` 严格规则/计层规则 | resolve-schema-at-path.ts L72–228/L333–375；0024 L103 | **一致**——`packages/vfsl/**` 零触碰；只消费 |
| 读不进 sequencer / lifecycle 停接纳 | 零 sequencer 槽位；closing/closed 同步联合拒绝；getStatus 全周期 | 0008 读取能力节/L123；CONTEXT L115–117；runtime AGENTS | **一致**——全同步纯函数；gate 先于 options（F7）；status 面零触碰 |
| Wire / 诊断日志 / 复制 raw 读面 | 零改动 | 0016 L77 | **一致**——相关包与 `docs/protocols/**` 零触碰 |
| lease released 通道 | released 短路先于透传；冻结单例原样 | 0009 L38；lease.ts L78–82 | **一致**——released 分支位置与 issue 对象零改动（带 options 调用同途，runtime 零触达断言） |
| #273 期组合序与形状断言集中面 | gate→值读→短路→组装顺序保持；断言集中化穿越形状修订持续有效 | runtime.ts 组合体；T0 scanner/gate | **一致**——序保持（净化/重派发只插在值成功后）；family A/B 归零断言语义不变、正负样本随动五键 |

## 6. Evolution requirements

**无新增 evolution-required 项。** 复核：

- 本 diff 全部行为落在 ADR-0024 已 accept 的授权内（决策 1/3/4/5/6 的 T3 组合切片），
  不改任何 ADR/CONTEXT/协议文本（三者零触碰）；
- 谱系残余义务归票不悬空：T4 #337（`DeepOptional` 类型面）、T5 #338（文档负控正则
  修订、docs/integration 形状注记、typed-access 预算纪律、ADR 0016/0008 回填批注）
  ——均为已开票的独立票，非本 diff 义务（前置门禁 §6 裁决维持）；
- 版本 bump（runtime 0.1.12→0.1.13、registry 0.1.10→0.1.11）按设计 §13 属发布流随动，
  SA3 未改 package.json——与前置/设计复审「非代码面核对项」钉死一致；
- 条件性登记（维持设计后复审 §6）：「合法值/键在场性交替」的完全闭合若立项（doc-runtime
  暴露已校验预算），属公共契约变更，届时必须走 ADR-0003 L46 同款设计修订流程——本 diff
  未以实现细节滑入（未触 doc-runtime）。

## 7. Hard conflicts

**无。** 16 行对照零 hard-conflict。会构成冲突的形态在实际 diff 中均未出现：预算缺陷
静默化（净化失败先于投影调用短路、L57 收敛点对 canonical 结构性不可达）、敌意 trap 裸
逃逸（净化器 try + T1 E100 双保险 + F-x4/x5/x6 零 throw 断言）、敌意输入洗白（canonical
不回喂 T1）、runtime 事后投影裁剪 / 第二公共读路径 / 形状按参数分叉（无 options 分支
同样五键）/ 清单合成（逐引用透传）/ 标记下沉 ValueSchema（显式包装联合 case）/
失败分支带新键（键集断言逐分支在场）。

## 8. Required actions

无阻塞项。非阻塞登记（均不触决策面）：

1. **M1 措辞遗留**（SA2 iteration 1 MINOR）：设计文本「键集漂移已全部响亮拒绝」的措辞
   收敛仍属 SA1/Controller 面——实现行为与修订语义一致（F-x5/F-x6 仅断言可检测面），
   建议随 PR 描述或 T5 文档票一并落字；
2. **follow-up 纪律**：`ValidatedBudget` 暴露（合法值交替闭合）与 L2 `depthPerPath` 接线
   若立项，须走公共契约变更流程（§6 条件性登记），不得作为实现细节滑入后续票；
3. 发布流：两包版本 bump 随本票合并执行（ADR L69 破坏面论据的兑现动作，非本报告核对面）。

## 9. Verdict

**clear** —— 16 行对照全部为 no-conflict（6）或 implements-existing-decision（10）；零
evolution-required、零 hard-conflict；前置门禁 §4 三项正式 override 逐项落地且范围未
扩大；SA8 前置门禁 §8-4 四个 SA1 收口点（lifecycle×options 定序 / 拷贝器标记处置 /
truncations 源与合成 / 类型面派生方式）与设计后复审 §8 八项实现复查项在实际 diff 中
逐项兑现（§3 行 1–16 证据列）。dispatch 指定的四个边界复核结论：**两通道预算对齐**
（canonical 与 T1 同一读纪律、对齐断言 + 敌意夹具延拓进主缝）、**五键成功/失败形状**
（两联合恰五键、三既有失败分支 + 新四键分支零漂移）、**敌意 options 行为**（零静默/
零外抛/零洗白、F-x1–F-x6 钉死）、**lease 透传**（released 先行、raw 同一引用直传、
Equal 锚保持）——全部与 ADR-0024 / ADR-0016（经 0024 修订）/ ADR-0009 一致。文件范围
= ALLOW 15 项一一对应、DENY 全零触碰。

## 10. requiresConflictRecheck

**false** —— 前置门禁与设计后复审标记的待核对 面（公共 API 双重载 + 两结果联合五键 +
新公共失败码 + type-only 导出；三项 override 落地；A-2b 双出口与 A-2c 豁免触发点唯一性；
两通道截断位置一一对应的组合层实测）已由本实现后复查对实际 diff 逐项核对闭合。残余
事项（T4 #337 / T5 #338 / 版本 bump / 回填批注）均为独立票或发布流义务，不是本 diff
尚待核对的实现面。

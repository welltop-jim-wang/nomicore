# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文行号，需要时按编号回查 ADR 全文。

## 任务标识

- 任务：Issue #336 — `[shape-budget] T3: readData 五键组合——两通道同预算与截断清单`（State: open；issue 更新于 2026-09-12T13:26:56Z）
- 简报：Issue #336 正文（REST comments 为空——无 Owner 评论要求）与 `wiki/raw/task_issue-336.md`（同源摘要）
- Worktree：`/home/wangjian/nomicore-fix-issue-336`（branch `mabf/issue-336`，HEAD `cdfdff6`；已含 PR #332 集成支上的 ADR 0024 三次提交 `50d52a1`/`7679c57`/`ba11f32`，且 T0/T1/T2 已合入：`80d59f8` #333/PR #343、`b8e2947` #334/PR #341、`cdfdff6` #335/PR #342——本票 Blocked-by #333/#334/#335 已全部解除）
- 冲突基准：`docs/adr/` 全集 **20 个文件（0001–0024，无 0015/0020/0021/0023 号文）逐个清点状态、相关者全文细读** + 根 `CONTEXT.md` 全读 + `packages/namespace-runtime/AGENTS.md` / `packages/namespace-registry/AGENTS.md` / `packages/doc-runtime/AGENTS.md` 模块契约 + `docs/protocols/`、`docs/phases/`、`docs/vfsl/` grep 核对（无 readData 条款面——readData 不上 wire、不进语言 spec）
- Ticket 谱系（tracking issue #331 / ADR 0024 / PR #332 `adr-0024-readdata-shape-budget`）：
  T0 #333（形状断言 helper 化 prefactor，已合入）→ T1 #334（值通道三参化与截断省略，doc-runtime 面，已合入）→ T2 #335（投影通道三参化与截断标记，vfsl 面，已合入）→ **T3 #336（本票：readData 五键组合 + READ_OPTIONS_INVALID 公共失败 + registry lease 透传，namespace-runtime / namespace-registry 面）** → T4 #337（DeepOptional 类型面，vfsl-protocol 面）→ T5 #338（文档负控与形状注记同步）

## 现状确认（源码事实，仅供对照，不构成冲突基准）

- `packages/namespace-runtime/src/runtime.ts` L121–129：`NamespaceRuntimeReadDataResult` 成功分支现为**恰三键** `{ ok:true, value, schema }`；L152 `readData` 单参签名；L474–487 实现体 = D4 lifecycle gate **先行**（closing/closed → `RUNTIME_READ_DISABLED`，零 doc 触碰）→ `readLogicalValueAtPath(doc, path)` 两参调用 → 失败短路（`PATH_NOT_ALLOWED` 原样、不带 schema 键）→ 成功三键组装。
- `packages/namespace-runtime/src/read-schema-projection.ts` L42–58：`projectReadDataSchema(state, path)` 现两参（resolver 调用未带 options）；L121–181 深拷贝器 `cloneValueSchema` 按 `kind` **显式 9-case 分派、无 default**（object/array/union/optional/enum/ref/pattern/scalar/xml）——T2 的 `SchemaTruncationMarker`（`kind:'truncated'`，投影包装联合成员）在预算读下会进入该分派面。
- T1 落地面（`packages/doc-runtime/src/read.ts`）：L100–108 `ReadLogicalValueAtPathBudgetResult` = 恒四键成功面 `{ok,value,truncated,truncations}` ∪ `PATH_NOT_ALLOWED` ∪ `READ_OPTIONS_INVALID`（path 回显 + 非空 message）；L96–97 双结果类型 + 重载——`READ_OPTIONS_INVALID` **只属于预算联合**，不污染无 options 既有联合；L115–116 两参/三参重载；L112/L135 载体层定序 **G0（path 形态守卫）→ options 校验 → N0**（path 与 options 双非法 → `PATH_NOT_ALLOWED`）。
- T2 落地面（`packages/vfsl/src/resolve-schema-at-path.ts`）：L82–88 `SchemaTruncationMarker` + `BudgetedValueSchema = ValueSchema | SchemaTruncationMarker`（投影包装联合，**非** ValueSchema 成员）；L117–133 `BudgetedResolveSchemaAtPathResult` = 预算投影四件套（标记**带内**，无独立截断清单字段）∪ 三码（`SCHEMA_PATH_NOT_FOUND` / `SCHEMA_PATH_INVALID` / **`SCHEMA_OPTIONS_INVALID`**——resolver 层 options 校验码）；`ReadDataSchemaProjection<V extends BudgetedValueSchema = ValueSchema>` 泛型化（无预算默认恒纯 ValueSchema）。
- `packages/namespace-registry/src/lease.ts` L276–279：lease `readData(path)` 现**无 options 透传**；L78–82 `RELEASED_ISSUE` 冻结形状 `{ok:false, code:'NAMESPACE_LEASE_RELEASED', message}`；L390 类型级 `Equal<NamespaceLeaseReadDataResult, ReturnType<NamespaceRuntime['readData']> | NamespaceLeaseReleasedIssue>` 锚。
- T0 落地面：`packages/namespace-runtime/test/readdata-shape-assertion-consolidation-gate.test.ts`（「恰三键」形状断言集中化验收门——本票 AC 指定的恰三键 → 五键修订点）。
- 未落地面（谱系归票）：`DeepOptional` 类型（grep 全仓无——T4 #337）；文档负控正则 `readDataOptionUsages` 仍「禁一切带参用法」（`packages/namespace-registry/test/readdata-docs-adr0016-contract-fixture.ts` L109–116）与 `docs/integration/cordis-plugin-hosting.md` L340「readData 成功分支恰三键」形状注记、typed-access 预算纪律条款（T5 #338）；ADR 0016/0008 文本回填「ADR 0024 修订」批注节（PR #332 / T5 面，T2 门禁 §6 已注记为非阻塞）。

## 相关 ADR

### ADR-0024 readData 形状预算——depth/width 截断省略与截断清单（accepted，2026-09-12；本票直接母法）

`docs/adr/0024-readdata-shape-budget.md`（tracking issue #331；CONTEXT.md 已同步「形状预算 / 截断省略 / 截断清单」词条与「语义 schema 投影」词条预算段）

- 与本任务的关联点：本票全部需求是 ADR 0024 **决策 3/4/5（组合验收）/6** 的 T3 切片兑现——五键恒形、截断清单组合、两通道同预算、`READ_OPTIONS_INVALID` 进 readData 公共结果联合、registry lease 原样透传。
- 核心条款（原文摘录，编号=文件行号）：
  1. L58–69（决策 4，结果形状·破坏性修订）：成功分支恒定键集**恰三键 → 恒五键** `{ ok:true; value; schema: ReadDataSchemaProjection | null; truncated: boolean; truncations: TruncationsEntry[] }`；L67：「`truncated` 与 `truncations` 恒在场（空清单也是空数组）——形状唯一、无『缺席 = 无截断』隐式约定。失败分支（路径失败 / 生命周期停接纳）形状不动、不带这些键（读在到达投影前失败，无值可截）」；L69 破坏面论据：影响包已发布但均处 **0.x**，破坏性修订随 minor bump 发布、已知消费方可枚举。
  2. L85–87（决策 6，公共面归属——本票核心授权）：「预算是 schema 无关的投影概念，属 ADR-0008 读域……runtime `readData` 组合值与投影两通道的同预算截断；**registry lease 原样透传**。**不新增第二条读路径**」。
  3. L22–31（决策 1，API 与参数语义）：`readData(path, options?: { depth?; maxChildrenPerNode? })`；L26 `depth:0` 骨架读（目标容器同形空容器 + 单条 depth 截断项，value 键恒在场）；L29「**不传 options = 完整投影**：逐字节现行为，零截断」；L30「非法 options（负数、非整数、非有限数、非对象、**含未知多余键**——options 是封闭形状）响亮拒绝，新稳定失败码 **`READ_OPTIONS_INVALID`**（同步、不抛；不借用路径失败码或生命周期失败码——预算缺陷不是路径缺陷）」；L31 终态目标预算 no-op。
  4. L43–56（决策 3，截断清单）：预算读成功结果中**恒在场**（无截断时空清单）；L48–50 条目三字段 `path`（与 readData 实参**同基**，自 ROOT 起算）/ `kind`（`'depth'`/`'width'`）/ `omitted`（省略计数）；L52「**depth 条目的 path 尾段即被裁键名**——键名的唯一在场位置（值内已省略），枚举不丢键名」；L53 width 条目只在父路径记一条、不逐键罗列；L54「**omitted 语义（钉死）**：depth 条目 = 被截容器的**直接子项数**……width 条目 = 超出保留数的子项数。**不是后代总数**」；L55 条目不携带被截容器内部子键列表；L56 清单规模由预算间接约束。
  5. L33–40（决策 2，截断省略值内唯一形态）：被裁子项键不出现在返回值；L37–38 消歧规则（键缺席且不在清单 = 真缺席；在清单 = 被裁）；L40 值域纪律不动摇——输出端 undefined 吸收纪律（ADR-0008 缺席语义；实现词汇 E1）保持，不引入「键在、值 undefined」第三态 / 魔法哨兵 / 同形空占位；**唯一例外** `depth:0` 目标节点同形空容器。
  6. L81（决策 5，两通道截断位置对齐·契约级承诺；commit `ba11f32` 补入）：「同一预算下，值截断位置与投影截断标记一一对应——**消费方依赖两通道一致，错位即契约违约**」；计层规则：值通道数载体层，类型树同构计层（union 透明、ref 终态边界）。
  7. L73–75（决策 5 首组）：valueSchema 与值同 depth 截断、别名闭包随展开层收缩、docs/aliasDocs 切片省略；L74「**width 对投影无操作**」；L75「`schema: null` 的单义……与 always-on 精神不变」。
  8. L77（截断节点选型，钉死）：投影包装联合、不扩展 ValueSchema 语义联合；标记携带成员级类型线索（ref 名优先，无 ref 名时容器 kind）；**无预算读恒为纯 `ValueSchema`，形状零变化**。
  9. L116（备选否决，实现位置禁区）：「**namespace-runtime 层事后裁剪投影**……采用解析入口三参化替代（决策 5）」——runtime 组合层禁事后裁剪路径；L118 schema opt-in 不复活。
  10. L120–130（验收）：L122 主接缝（runtime `readData`）验收清单——五键恒形、截断省略、清单条目（path 尾段键名 / omitted 计数 / 恒在场空数组）、`depth:0` 骨架、`READ_OPTIONS_INVALID`（含未知键）、**无 options 逐字节现行为回归锚**、schema 同 depth 裁剪 + 截断标记 + 别名闭包收缩、`schema:null` 语义不变——红绿契约 + 负控（同 issue #273 打法）；L123 omitted 计数显式断言（fixture 直接子项数 ≠ 后代总数）；L125「仅触发 width 的预算读，其 schema 投影与同路径无预算读的投影**逐字节相等**」；L129「registry lease 透传断言（既有 registry 测试延伸）」；L130 影响包全套门禁 + root typecheck/test。
  11. L97–105（对既有 ADR 的修订）：L99 ADR-0008 读语义修订（「目标子树完整深拷贝」→「预算内投影 + 截断清单」，不传预算 = 完整投影，既有语义作为默认保留）；L100–104 ADR-0016 四处显式登记（(1) 预算参数 ≠ schema opt-in、新形状字段恒在场自描述；(2) `readLogicalValueAtPath` 三参化——T1 面；(3) `resolveSchemaAtPath` 三参化——T2 面；(4) Consequences 成本句修订）；L105 文档负控正则修订（**T5 #338 面，非本票**）。
  12. L89–95（决策 7，类型面）：`DeepOptional<PathAt<…>>` 进协议类型面——**T4 #337 面，非本票**；L95「预算读不是写前完整快照」。
- 对本任务影响：本票需求与决策 3/4/6 及验收 L122/L125/L129 逐点对应；禁区 = 第二条读路径、runtime 层事后投影裁剪、失败分支带新键、值域第三态。

### ADR-0016 readData 语义 schema 投影（accepted，2026-09-09；被 ADR 0019 §7 与 ADR 0024 修订节条款级修订）

`docs/adr/0016-readdata-semantic-schema-projection.md`

- 与本任务的关联点：readData 结果形状与组合分层的母法；其三键形状条款被 ADR 0024 决策 4 显式修订为恒五键（修订注册于 ADR 0024 修订节第 1 条，corpus 内合法链）。
- 核心条款（原文摘录，编号=文件行号）：
  1. L19（结果形状，**被 0024 决策 4 修订**）：原 `{ ok: true; value: unknown; schema: ReadDataSchemaProjection | null }` 恰三键。
  2. L22（继续有效）：`schema:null` 单义三情形（无 active schema / 路径偏离 / 静态解析失败）不区分、`null` 不是读的失败、`ok` 恒真。
  3. L23（失败分支，继续有效）：「失败分支不变：`PATH_NOT_ALLOWED`（路径/载体缺陷）、`RUNTIME_READ_DISABLED`（lifecycle≠ready）、lease released issue 各自走原有通道」——0024 L67 增补 `READ_OPTIONS_INVALID` 为新失败分支（不修改既有三分支形状）。
  4. L24–25（继续有效）：路径合法但值缺席时 schema 照常返回（路径键控）；空路径 `[]` 返回 ROOT 投影。
  5. L69–70（交付纪律，继续有效）：**always-on**（无 opt-in、结果形状不随参数分叉——0024 修订节第 1 条重申五键恒形满足之）；每次读深拷贝投影（detached、可变普通副本、不冻结、零缓存）。
  6. L75（分层与兼容面——本票组合授权）：「`@nomicore/namespace-runtime` 组合两者：成功读 = `readLogicalValueAtPath` 的值 + `resolveSchemaAtPath` 的投影深拷贝；`schemaState ≠ 'ready'` 或无 activeTools 时 `schema: null`」。
  7. L76（分层与兼容面——本票 registry 授权）：「`@nomicore/namespace-registry` 仅类型别名跟随（`NamespaceLeaseReadDataResult`），lease 行为零变化」——0024 决策 6 在此之上加法授权 options 原样透传（透传 = 代理语义的加法扩展，非行为分叉）。
  8. L77（继续有效）：诊断变更日志不涉及读面；ReplicationSession raw 读面（可信域）不变；typed-access 投影与 codegen 加法兼容。
  9. L100–118（ADR 0019 修订节，继续有效）：docs 切片三来源合并序 field → marker → member 末位、键规约四表同构——预算下仅选键集合收缩（T2 已落），合并纪律不变。
- 对本任务影响：五键恒形有 0024 显式修订授权；always-on、null 单义、失败三分支、detached 深拷贝、组合分层全部原样有效。

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted；读语义被 ADR 0024 修订节修订）

`docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md`

- 与本任务的关联点：读域母法——读取保留不变量、失败通道纪律、reads 不进 sequencer；其「完整深拷贝」读语义被 0024 L99 修订为「预算内投影 + 截断清单」（不传预算 = 完整投影默认保留）。
- 核心条款（原文摘录，编号=文件行号）：
  1. L16–27（读取能力，**被 0024 L99 修订**）：L27「空 path 深拷贝完整 ROOT；非空 path 只转换目标子树；返回值是可变普通深拷贝，不做运行时冻结」；读取 schema 无关、同步结果联合（预期路径 / 载体 / lifecycle 失败）。
  2. L123（#92 稳定码纪律，继续有效）：「read 停接纳稳定码 `RUNTIME_READ_DISABLED`……lifecycle 失败不是路径缺陷，不借用路径失败码」——0024 L30 以同款纪律新增 `READ_OPTIONS_INVALID`（预算缺陷不是路径缺陷，亦不借用生命周期失败码）。
  3. 读取不进 write sequencer（正文「读取能力」节 + `packages/namespace-runtime/AGENTS.md`「Reads stay outside that sequencer」）——预算组合不得改变。
  4. L167–178（修订节先例）：ADR 0016 / ADR 0017 修订均以**回填批注节**登记于本 ADR；ADR 0024 对本 ADR 的修订目前只登记于 0024 自身修订节（回填批注属 PR #332 / T5 面——T2 门禁 §6 已注记：修订权威链在 corpus 内完整，非阻塞）。
- 对本任务影响：T3 组合不得使读进 sequencer、不得改读取保留不变量与既有失败通道；`READ_OPTIONS_INVALID` 为 0024 授权的新增分支。

### ADR-0009 NamespaceRegistry、调用方租约与 Cordis Host 生命周期（accepted）

`docs/adr/0009-namespace-registry-leases-and-host-lifecycle.md`

- 与本任务的关联点：lease 代理语义母法。
- 核心条款：L38「Lease 是调用方唯一能力入口，**代理 Runtime 除 `close()` 外的同步读取**、投影、status、ROOT mutation 和 SCHEMA replacement；不公开裸 Runtime、DocHandle、Y.Doc 或 live Yjs 引用」——options 原样透传（0024 决策 6）是代理语义的加法扩展；released lease 的 `NAMESPACE_LEASE_RELEASED` 通道原样。
- 对本任务影响：lease 面只做透传与类型别名跟随；不得在 lease 层新增预算解释/校验/第二行为。

### ADR-0003 求值器与派生 schema（accepted；冻结面守卫）

`docs/adr/0003-evaluator-derived-schema.md`

- L26–27（决策 4）：别名按名引用（ref），不内联展开——0024 L81「ref 为终态边界」同构。
- L46（后果）：「派生 schema 的形状变更须走设计修订流程（公共契约）」——ValueSchema 9-kind 冻结面；0024 L115 明文否决 `kind:'truncated'` 进该联合，采用投影包装联合（T2 已落 `BudgetedValueSchema`）。
- 对本任务影响：runtime 组合面（含深拷贝器对标记的处理）不得把截断标记下沉为 ValueSchema 成员、不得改派生 schema 形状。

### 其他 ADR 清点（相关性核对）

0001（语言层）、0002（重写范围外）、0004/0005（codegen 类型投影与生成管线——DeepOptional 属 T4 #337，非本票）、0006（持久化）、0007（逻辑校验与运行时桥——读面沿其可信域先例，无修订需求）、0010/0012/0013/0018/0022（复制与分块传输——readData 不上 wire，grep `docs/protocols/` 无 readData 条款）、0011/0014（诊断日志——ADR-0016 L77「诊断变更日志不涉及读面」）、0017（schema 生命周期元数据——`getActiveSchema` 面，本票不触）、0019（联合成员文档——投影 docs 切片第三来源，T2 面已落）。被 superseded 者：无（全部 accepted；条款级修订关系见上）。

## CONTEXT.md 词汇（已同步 ADR 0024 基线）

- L37–39「Data」：`readData` 成功时同步返回值与其语义 schema 投影（ADR-0016）。
- L41–43「语义 schema 投影」：预算读下投影与值同 depth 裁剪、截断标记（投影包装联合，非 ValueSchema 新 kind、非值域哨兵）、别名闭包与注释切片随展开层收缩、width 对投影无操作。
- L45–47「形状预算」：`readData(path, options?)` 可选携带；depth/maxChildrenPerNode 语义；未展开分支零物化；不传预算 = 完整投影；预算不是 schema 通道开关；预算读静态类型 `DeepOptional<PathAt<…>>`（T4 面）。
- L49–51「截断省略」：键省略 + 清单消歧；E1 吸收纪律不变；`depth:0` 唯一例外。
- L53–55「截断清单」：恒在场（无截断空清单）；条目 path 同基 / kind / omitted（直接子项数，非后代总数）；depth 尾段即被裁键名；width 只记父路径一条。
- L115–117「停接纳」：readData 同步结果联合 `RUNTIME_READ_DISABLED` 分支；key 仅 lifecycle；getStatus 不受影响。

## 模块 AGENTS 明文契约

- `packages/namespace-runtime/AGENTS.md`：reads 不进 sequencer；公共 API 只暴露 detached 投影；registry 经 restricted `@nomicore/namespace-runtime/internal` seam；验证门 = 公共面测试 + root `pnpm typecheck` / `pnpm test`。
- `packages/namespace-registry/AGENTS.md`：lease 为独立调用方能力；公共 API 只经 `src/index.ts`；验证门 = registry 套件 + 包 typecheck + root 门禁（生命周期/契约变更时）。
- `packages/doc-runtime/AGENTS.md`：读取保持 schema 无关（T1 面已落，本票只消费不修改）。

# Issue #336 设计 — [shape-budget] T3：readData 五键组合——两通道同预算与截断清单

> SA1（架构设计，iteration 1——按 SA2 攻击评审修订）。产物：本文件。输入：
> `wiki/raw/task_issue-336.md`（Host 刷新的任务简报；Issue #336 正文同源，**REST comments
> 为空——无 Owner 评论要求适用**）、`wiki/raw/task_issue-336_conflict_report.md`（SA8 前置
> 门禁，verdict clear）、`wiki/raw/task_issue-336_relevant_decisions.md`（SA8 决议摘录）、
> `wiki/raw/task_issue-336_design_conflict_report.md`（SA8 设计后复审，verdict clear）、
> **`wiki/raw/task_issue-336_sa2_review.md`（SA2 攻击评审，verdict reject——F1 BLOCKER +
> N1–N4 MINOR；本迭代逐条落实，见 §14）**、源码与既有测试亲自核对、T1/T2 设计
> （`wiki/raw/task_issue-334_design.md` §7.2、`wiki/raw/task_issue-335_design.md` §6.5/§6.10）
> 作为上游落地面引用。本任务无 `task_issue-336_sa6_contract.md`（SA6 契约产物不存在）——
> 验收面以 Issue AC + ADR 0024 验收节 L120–130 为权威，缺口在第 5 节登记。

---

## 1. 任务类型、目标和非目标

**任务类型**：Feature（公共 API 组合切片）。ADR-0024（readData 形状预算）谱系 T3：
T0 #333（形状断言 helper 化，`80d59f8`）→ T1 #334（值通道三参化，`b8e2947`）→
T2 #335（投影通道三参化，`cdfdff6`）→ **本票 T3 #336（runtime 组合 + registry 透传）** →
T4 #337（DeepOptional 类型面）→ T5 #338（文档负控与形状注记同步）。

**目标**（全部为实现 ADR-0024 已 accept 的决策，无新决策需求）：

1. runtime `readData(path, options?)`：一次读内以**同一预算**贯通值通道（T1 三参）与投影
   通道（T2 三参）（决策 6，ADR L85–87）；
2. 成功分支恒五键 `{ ok, value, schema, truncated, truncations }`（恰三键 → 五键破坏性修订，
   决策 4，L58–69）——预算读与无预算读（空清单）都携带；失败分支形状不动、不带新键；
3. `READ_OPTIONS_INVALID` 进 readData 公共结果联合（含未知键；同步、不抛、不借路径/生命
   周期码，决策 1，L29–31）；
4. registry lease `readData(path, options?)` active 期原样透传（决策 6，L87；ADR-0009 L38
   代理语义加法扩展）；
5. T0 集中形状断言 helper 完成恰三键 → 五键修订（收敛门随动更新）。

**非目标**（越界禁令，SA8 §8-7 逐条承接）：

- 不动 doc-runtime / vfsl 公共面（T1/T2 已落，本票只消费）；
- 不做 `DeepOptional` 类型面（T4 #337）；
- 不动文档负控正则（`readdata-docs-adr0016-contract-fixture.ts` L109–116
   `readDataOptionUsages`）与 docs/integration 形状注记（T5 #338 面）；
- 不触 wire / 诊断日志 / 复制面（readData 不上 wire；ADR-0016 L77）；
- 不新增第二条读路径、不做 runtime 层事后投影裁剪（ADR L116 否决项）；
- 不修改 ADR 文本与 CONTEXT.md（0024 基线已含全部修订注册；回填批注属 PR #332 / T5 面）。

---

## 2. 当前行为与证据锚点（SA1 亲自核对；iteration 1 复核未变）

### 2.1 runtime 组合面（本票主改动点）

| 事实 | 锚点 |
|---|---|
| 成功分支现为**恰三键** `{ ok:true, value, schema }`；失败 = doc-runtime `PATH_NOT_ALLOWED` 原样 + `RuntimeReadDisabledResult` | `packages/namespace-runtime/src/runtime.ts` L121–129（`NamespaceRuntimeReadDataResult`）、L117–119（`ReadLogicalValueFailure = Extract<ReadLogicalValueResult, {ok:false}>`——doc-runtime 单源派生纪律 D1） |
| `readData` 单参签名 + JSDoc（always-on、`schema:null` 单义三情形、敌意 path → null 收敛、`InternalError` 唯一逃逸 throw） | runtime.ts L152、L137–151 |
| 实现体：D4 lifecycle gate 先行（closing/closed → `readDisabled()`，零 doc 触碰）→ `readLogicalValueAtPath(doc, path)` 两参 → 失败短路（不带 schema 键）→ 成功三键组装（`projectReadDataSchema(state, path)`） | runtime.ts L474–487 |
| `RUNTIME_READ_DISABLED` 失败分支形状 `{ok,code,path,message}`（path 新鲜副本：`Array.isArray` 守卫 + try/catch spread + 敌意 Proxy 坍缩 `[]`）——接缝自构失败成员时的包内回显纪律先例 | runtime.ts L110–115、L668–687（`readDisabled` helper，含 `echo` 构造 L671–679） |
| 公共入口 type-only 导出面；值导出恰 `RuntimeWriteFatalError` 一键 | `packages/namespace-runtime/src/index.ts` L29–48 |

### 2.2 投影组合面（本票第二改动点）

| 事实 | 锚点 |
|---|---|
| `projectReadDataSchema(state, path)` 两参；D3a 状态守卫（无 active schema → null）先于 D3b 敌意 path 规范化；resolver 调用无 catch（`InternalError` 直通逃逸）；resolver 两码（含 `SCHEMA_OPTIONS_INVALID`）收敛 `schema:null`——**该收敛点即 SA2 ER-1 所指「预算缺陷静默化」落点，本设计必须保证 canonical 永不触发它** | `packages/namespace-runtime/src/read-schema-projection.ts` L42–59（L57 `if (!resolved.ok) return null`） |
| 敌意 path 规范化：普通数组 + 迭代纯度 + string\|number 段，异常 → null | 同文件 L79–97（`normalizeReadPath`） |
| D5 detach：resolver ok 四件套整体 identity-memo 深拷贝（detached、可变普通副本、不冻结、零缓存） | 同文件 L99–114（`detachReadSchemaProjection`） |
| 深拷贝器 `cloneValueSchema` 按 `kind` **显式 9-case 分派、无 default**（object/array/union/optional/enum/ref/pattern/scalar/xml）——T2 标记进入该分派面时必须显式覆盖 | 同文件 L121–181 |
| 别名表克隆 `cloneValueSchemaRecord`（同 memo 传递，CreateDataPropertyOrThrow 语义） | 同文件 L196–207 |

### 2.3 T1 落地面（值通道，只消费）——**options 读纪律权威**

| 事实 | 锚点 |
|---|---|
| 双结果类型 + 重载：`READ_OPTIONS_INVALID` **只属于预算联合**；注记明示「runtime 的 Extract 派生因此零泄漏」 | `packages/doc-runtime/src/read.ts` L94–108（类型）、L96–97（零泄漏注记）、L118–131（重载） |
| 载体层定序 **G0（path 形态守卫）→ options 校验 → N0 probeRoot**；path 与 options 双非法 → `PATH_NOT_ALLOWED`；非法 options 于 N0 前短路（零 doc 触碰） | read.ts L112–113（编排注释）、L133–150（实现，L140–150 OPT 块） |
| **T1 options 读纪律（本设计 §7.1-A-2 净化器逐字对齐的权威）**：键空间 = `Object.keys(raw)` own enumerable string 键（symbol/非 enumerable/继承键天然忽略——R8）；轴值 = `Object.getOwnPropertyDescriptor(raw, key)` 的 data-property `value`（L343–348，accessor 拒绝且**零执行**，descriptor 读本身零副作用）；ownKeys 谎报键（无 descriptor）≡ 非 own 忽略；已知键值 undefined ≡ 缺席（R1）；轴值 ≥0 有限整数、-0 归一（H10）；整体内层 try 收编 `Object.keys`/`getOwnPropertyDescriptor`/`getPrototypeOf` 的 trap 异常为非法（策略 A，绝不外抛） | read.ts L326–361（`validateReadOptions`；L316–325 规则注记、L339 键空间、L343–348 descriptor 读、L358–360 catch） |
| 预算成功面恒四键 `{ok,value,truncated,truncations}`；`truncated === truncations.length>0`（B14）；失败 `READ_OPTIONS_INVALID` = `{ok,code,path,message}`，path 新鲜回显（`safeSpreadPath` 敌意收编）、message 恒非空 | read.ts L100–108、L224–229、L370–377（`optionsInvalid`） |
| 截断条目语义：depth 条目 path 尾段即被折键名、omitted=raw 直接子项数；width 父路径单条、omitted=超出保留数 | read.ts 模块头 L30–46、L536–597（`projectValue`/`budgetFold`）、L632–694（Yjs 容器）、L714–800（plain 域） |
| 全程顶层 try（E100 崩溃边界）：任何残余异常收敛为失败成员、绝不二次抛（INV-R1）——**重派发路线「零外抛」的依据** | read.ts L132（`try {`）、L230–234（catch + safeDetail 内层收编） |

### 2.4 T2 落地面（投影通道，只消费）

| 事实 | 锚点 |
|---|---|
| `SchemaTruncationMarker`（`kind:'truncated'` + clue）+ `BudgetedValueSchema` 投影包装联合（**非** ValueSchema 成员）；公共守卫 `isSchemaTruncationMarker` | `packages/vfsl/src/resolve-schema-at-path.ts` L72–88、L140–153 |
| resolver 三参重载：`options` 敌意通道校验（path 守卫 → options → derived 守卫 → 游走）；无 options（含显式 undefined）走既有代码路径逐字节不变 | 同文件 L194–229（入口）、L207（实现签名） |
| T2 options 校验规则：非对象/null/数组/未知键/已知键**非 ≥0 整数（含 present-undefined）**→ `SCHEMA_OPTIONS_INVALID`；校验块 try/catch 收编；**无宿主原型检查**；`ownOptionValue` 经 `[[Get]]` 取值（**会执行 getter/get trap**——T1 接受的 accessor 伪装或 descriptor/get 分叉输入在此分叉，§3-6/§7.1 的规则分叉根源） | 同文件 L333–375（`validateBudgetOptions`、`isBudgetCount`、`ownOptionValue` L342–344） |
| 计层规则：容器（object/array）各一层；optional/union/enum/pattern/scalar/xml 透明或终态；ref 终态边界；计层原点 = 路径终点；width 对投影零操作 | 同文件 L174–192（JSDoc）、L462–546（`BudgetWalk.render`） |
| 身份短路：零标记子树 ⟹ 返回原节点引用（充足 depth ≡ 无预算字节恒等基础——width-only 逐字节相等 AC 的实现前提） | 同文件 L476–477、L489 |
| T2 §6.10 跨票前提：union 静态全成员展开保持；T3 对齐断言需两步归一（剥 `<member N>`、ref 名对齐）；**options 校验规则集对齐前提**——「两票设计须采纳同一规则集，或在接缝处显式净化（如 readData 透传前剥离 present-undefined 键）后再进入本 resolver 的第二道门」 | `wiki/raw/task_issue-335_design.md` §6.10 |

### 2.5 registry lease 面（本票第三改动点）

| 事实 | 锚点 |
|---|---|
| lease `readData(path)` 无 options 透传：released 短路 → `entry.runtime.readData(path)` | `packages/namespace-registry/src/lease.ts` L276–279 |
| `RELEASED_ISSUE` 冻结形状 `{ok:false, code:'NAMESPACE_LEASE_RELEASED', message}` | lease.ts L78–82 |
| 类型级锁：`Equal<NamespaceLeaseReadDataResult, ReturnType<NamespaceRuntime['readData']> | NamespaceLeaseReleasedIssue>` | lease.ts L383–391 |
| `NamespaceLeaseReadDataResult = NamespaceRuntimeReadDataResult | NamespaceLeaseReleasedIssue`（registry index 已导出该别名） | `packages/namespace-registry/src/types.ts` L446–450；`src/index.ts` L45 |
| `NamespaceLease.readData` 方法单签名 | types.ts L663 |

### 2.6 T0 集中面（本票第四改动点）

| 事实 | 锚点 |
|---|---|
| `READDATA_OK_KEYS = ['ok','schema','value']`；`ReadDataOkShape` 恰三键（`schema: ReadDataSchemaProjection | null`——N3 钉死：保持纯面，见 §7.6-F-1）；`readDataOk(value, schema)` 生产者；`expectReadDataOk` 断言侧（期望独立内联构造——反伪绿不变量）；`expectReadDataOkKeys` 键集侧 | `packages/namespace-runtime/test/helpers/readdata-ok-shape.ts` L16–45（L21–25 形状、L28–31 生产者、L35–41 断言、L44–45 键集） |
| 扫描器 family A = 深等家族实参对象字面量含 `ok:true` + `schema` 键（**超集匹配**——五键字面量同样命中）；family B = `Object.keys(...)` 深等 `SUCCESS_SHAPE_KEYS`（现 = 恰三键）整键集断言；作用域 = runtime + registry 两测试树 | `packages/namespace-runtime/test/helpers/readdata-shape-assertion-scan.ts` L60–75（作用域/常量）、L127–159（`readObjectShape`）、L240–266（family A 判定）、L186–199（family B 判定——按常量长度 + 集合比对，五键化常量即自动随动） |
| 收敛门测试（family A/B 归零 + 仪器敏感性正负样本自控）；**gate 测试消费的是 scanner 仪器，不是 shape helper** | `packages/namespace-runtime/test/readdata-shape-assertion-consolidation-gate.test.ts` |
| helper 消费面：**10 个测试文件**（runtime 2：`runtime-readdata-hostile-path-guard`、`runtime-readdata-schema-projection-red`；registry 8：`registry-open` / `registry-idle` / `registry-create` / `registry-shutdown` / `registry-sa7-hostile` / `registry-sa7-concurrency` / `registry-sa7-rev1` / `readdata-docs-adr0016-sync-control`），含跨包相对导入 `../../namespace-runtime/test/helpers/readdata-ok-shape.js` | grep `readdata-ok-shape` 亲测恰 10 文件（SA2 N2 修正 iteration 0 的「11」计数——gate 文件不在内） |

### 2.7 门禁与文档负控边界

| 事实 | 锚点 |
|---|---|
| root 门禁：`pnpm test` = `vitest run --typecheck`（`*.test-d.ts` 经 typecheck 收集）；`pnpm typecheck` = 14 包逐包 tsc（含 `apps/yjs-server`） | `package.json` L11–13、`vitest.config.ts` |
| 文档负控 `readDataOptionUsages` 只扫三份 SCOPE_DOCS（typed-access.md / cordis-plugin-hosting.md / external-project-vfsl-codegen.md）——**runtime/registry 源码与测试不在扫描面**，T3 的 JSDoc `readData(path, options?)` 不触该门 | `packages/namespace-registry/test/readdata-docs-adr0016-contract-fixture.ts` L40–44、L109–116；`readdata-docs-adr0016-sync-control.test.ts` L45（该文件已用 `expectReadDataOkKeys` 集中面——T3 helper 修订自动随动） |
| 影响包版本：runtime 0.1.12、registry 0.1.10（ADR L69 破坏面论据所列即当前版本；doc-runtime 0.1.13 / vfsl 0.2.4 已在 T1/T2 后维持） | 各 `package.json` |

### 2.8 仓内生产消费方（SA2 N1 补列）

| 事实 | 锚点 |
|---|---|
| `apps/yjs-server` opRead：单参调用 `lease.readData(path)`；只消费 `result.ok` / `result.value`；响应自构 `{ok:true, value}`（结果信封的其余键被忽略）；root `pnpm typecheck`（14 包含该 app）与 `pnpm test` 覆盖 | `apps/yjs-server/src/app.ts` L594–615（L609 单参调用、L610–611 只读 ok/value 与自构响应）；`package.json` root 脚本 |

---

## 3. 能力缺口（根因承接）

ADR-0024 已在 corpus 内完成决策演进（SA8 §6：无 evolution-required 残余）。当前缺口是**纯
组合层未兑现**：

1. runtime `readData` 仍是单参、成功恰三键（§2.1）——决策 4 五键恒形与决策 6 两通道同预算
   在主接缝未落地；调用方对大子树仍只能整读（ADR 背景节的过度获取问题在主接缝无解）。
2. `READ_OPTIONS_INVALID` 只存在于 doc-runtime 预算联合（§2.3），未进 readData 公共结果
   联合——主接缝调用方无法区分预算缺陷。
3. lease 无透传（§2.5）——Registry 调用方（Cordis host / L2 工具）拿不到预算面。
4. T0 集中 helper 仍锚恰三键（§2.6）——五键修订的「只改一处」前提已就位但未执行。
5. 深拷贝器 9-case 分派未覆盖 `SchemaTruncationMarker`（§2.2）——类型加宽后编译期即红
   （无 default 的显式分派），必须显式钉死标记处置（SA8 §8-4(b) 收口点）。
6. **两通道 options 校验规则集存在已落地的分叉**（T1 R1「present-undefined ≡ 缺席」 vs
   T2「present-undefined → 非法」；T1 严格宿主判定 vs T2 无宿主原型检查；T1 accessor 拒绝
   vs T2 `ownOptionValue` 经 `[[Get]]` 执行 getter）——直接把同一 raw 对象透传两通道会让 T1 接受的
   合法调用被 T2 误拒（`SCHEMA_OPTIONS_INVALID`），违反 SA8 §3 行 6「两通道 options 校验
   规则集不分叉」。这是本设计必须显式收口的核心技术点（§7.1）；且收口实现本身必须复用
   T1 的**读纪律**（own-enumerable 键空间 + descriptor 取值 + try 收编），否则净化器会比
   权威「看得更多」而产生新的敌意面（SA2 F1，§7.1-A-2）。

---

## 4. Owner要求落实

Issue #336 REST comments 为空（任务简报 §Comments；SA8 冲突报告 §2、SA2 评审 §4 三证）。
**无 Owner 评论要求适用**——需求权威 = Issue 正文（= 任务简报）+ ADR 0024 验收节。

| 来源 | 要求 | 设计响应 |
|---|---|---|
| Issue 正文 What to build | 五键组合 / 两通道同预算 / READ_OPTIONS_INVALID 公共联合 / lease 原样透传 | §7 全部决策 |
| Issue AC1 | 五键恒形（预算 + 无预算空清单）；失败分支不动；主缝契约测试红绿 + 负控 | §7.2/§7.3；§12-T1/T2/T3 |
| Issue AC2 | 两通道截断位置对齐（主缝断言） | §7.1 决议 A-4；§12-T1 用例组 D |
| Issue AC3 | width 触发时 schema 投影与同路径无预算读逐字节相等 | §12-T1 用例组 E |
| Issue AC4 | depth 条目 path 尾段枚举语义；omitted 计数语义（直接子项数 ≠ 后代总数 fixture） | §12-T1 用例组 B/C |
| Issue AC5 | READ_OPTIONS_INVALID（含未知键）公共失败分支；无 options 逐字节回归锚 | §7.2；§12-T1 用例组 F/G |
| Issue AC6 | T0 helper 恰三键 → 五键修订；lease 透传断言（既有 registry 测试延伸） | §7.6/§7.5；§12-T4/T5 |
| Issue AC7 | 全套包门禁 + root typecheck/test | §12 门禁 |

---

## 5. 复现和根因承接

**SA6 诊断/契约产物不存在**（`task_issue-336_sa6_contract.md` 缺席）。本任务为谱系 T3 组合
切片，无 bug 复现面；根因承接以 SA8 现状确认 + SA1 源码亲自核对（§2）替代，未建立的验收
事实 = 无 SA6 冻结契约文本——以 Issue AC + ADR 0024 验收节 L120–130 为验收权威（两者同源
且 SA8 已逐条对照），设计不因此阻塞。

| 上游事实 | 证据位置 | 设计响应 |
|---|---|---|
| T0 已合入：形状断言集中化收敛门绿（family A/B 归零），helper 是五键修订单点 | `80d59f8`；§2.6 | §7.6 在 helper 处完成恰三键 → 五键，10 个消费文件自动随动 |
| T1 已合入：值通道三参 + 双联合 + G0→options→N0 定序 + READ_OPTIONS_INVALID（只在预算联合）+ **own-enumerable/descriptor 读纪律 + try 收编** | `b8e2947`；§2.3（L326–361） | §7.1 决议 A：T1 为 options 单一校验权威，净化器逐字复用其读纪律；§7.3 失败成员 Extract 派生零泄漏 |
| T2 已合入：投影通道三参 + 截断标记 + SCHEMA_OPTIONS_INVALID + 计层规则 + §6.10 跨票前提 | `cdfdff6`；§2.4 | §7.1 决议 A：canonical 净化进 resolver 第二道门；§7.4 拷贝器标记处置；§12 对齐断言按 §6.10 recipe |
| Blocked-by #333/#334/#335 已解除（worktree HEAD `cdfdff6` 含三提交） | `git log` 实测 | 无等待项 |
| 深拷贝器 9-case 无 default——标记进入分派面必须显式覆盖（SA8 §8-4(b)） | §2.2 | §7.4 决议 D-3：显式 `case 'truncated'`，10-case 穷尽、无 default |
| 两通道校验规则集已分叉（T1 R1 vs T2 present-undefined 拒绝等三处） | §2.3/§2.4 逐条对照；T2 设计 §6.10 预警 | §7.1 决议 A（单一权威 + 接缝净化——T2 §6.10 明文许可路线） |
| **SA2 攻击评审（iteration 0，verdict reject）**：F1 BLOCKER——iteration 0 净化器以裸 `[[Get]]` 重读 raw options，三触发路径（非 enumerable/继承键错位、descriptor/get 分叉 Proxy 静默化、get trap 抛异常裸逃逸）；N1–N4 MINOR | `wiki/raw/task_issue-336_sa2_review.md` §13（F1/SM-3～SM-5/ER-1～ER-3 证据链） | §7.1-A-2 读纪律修订 + A-2b/A-2c 响亮失败出路；§2.8/§10 补列 opRead（N1）；§2.6/§7.6/§12-T4 计数修正 10（N2）；§7.6-F-1 断言纪律钉死（N3）；§11/§12 fixture 措辞钉死（N4）；§14 逐条映射 |

发现的上游事实与源码矛盾：**无**（SA2 §5 复核确认 iteration 0 引用的源码锚点全部准确；
缺陷不在事实层而在净化实现的读纪律——本迭代修订后者）。

---

## 6. SA8约束落实

SA8 冲突报告 16 行裁决全部为 no-conflict（7）/ implements-existing-decision（9）；verdict
clear；requiresConflictRecheck = true。逐行映射（行号 = SA8 §3 表行）：

| SA8 行 | 决议/义务 | 设计位置 | 处理方式 | 需设计后冲突复查 |
|---|---|---|---|---|
| 1 | 决策 4 五键恒形、空截断恒空数组、失败分支不带新键、经 T0 helper 修订 | §7.2 决议 B、§7.6 | 形状唯一；无「缺席=无截断」隐式约定；每次调用新鲜 `[]`（禁共享常量，§7.2-B 注） | 是（公共结果形状变更） |
| 2 | 决策 6 同一预算贯通两通道、无第二条读路径、禁事后裁剪 | §7.1 决议 A、§7.2 | 一次 readData 内一预算两通道；零新增读路径；裁剪全部在 T1/T2 递归内 | 是 |
| 3 | 决策 1 READ_OPTIONS_INVALID 同步不抛、不借码、无 options 不产生该码、载体定序 G0→options→N0 沿用 | §7.2 决议 B-2/B-3 | T1 权威校验自带定序；runtime 透传失败成员；契约测试锁定 | 是（新公共失败码） |
| 4 | 清单源 = 值通道载体计数；不逐键罗列 width；条目不带内部子键列表 | §7.2 决议 B-4 | truncations = T1 结果逐字段透传（零合成） | 否 |
| 5 | 决策 2 组合面不引入新值内形态 | §7.2/§7.4 | 组装只在信封层加键；值/投影内容零改写 | 否 |
| 6 | 决策 5 L81 两通道截断位置一一对应（错位即违约）；两通道校验规则集不分叉 | §7.1 决议 A、§12 用例组 D | canonical 净化消除规则分叉——**净化器以 T1 同一读纪律构造（F1 修订），敌意/异态视图一律响亮失败而非静默分叉**；对齐断言按 T2 §6.10 归一 recipe 进主缝契约测试（含敌意/异态键夹具） | 是（跨 T1/T2/T3 契约级承诺） |
| 7 | width 对投影无操作；组合层不让 width 影响投影 | §7.1 决议 A-3、§12 用例组 E | canonical 保留 maxChildrenPerNode（resolver 校验后忽略）；width-only 逐字节相等断言 | 否 |
| 8 | `schema:null` 单义与 always-on 不降级 | §7.2 决议 B-5 | D3a 状态守卫先行不变；预算参数非 schema 开关 | 否 |
| 9 | 0016 三键条款经 0024 合法修订；不复活 schema opt-in / 参数化形状分叉 | §7.3 | 五键恒形两模式同形；无「形状随参数分叉」 | 是（修订落地核对） |
| 10 | 既有失败分支形状不动；PATH_NOT_ALLOWED 以 doc-runtime 为单源 | §7.2 决议 B-3 | 三个既有失败成员原样透传；READ_OPTIONS_INVALID 为新增分支 | 是 |
| 11 | lease 透传 = 代理语义加法扩展；released 短路先于透传；类型别名跟随；Equal 锚保持 | §7.5 | released 恒先行；零预算解释；既有 `_readAlias` 锚原文保持 + 新增预算别名锁 | 是（lease 签名变更） |
| 12 | 读不进 sequencer、返回面 detached | §7.2/§7.4 | readData 全同步零 sequencer 槽位；detach 含标记全量深拷贝 | 否 |
| 13 | lifecycle 停接纳原样；READ_OPTIONS_INVALID 不借生命周期码 | §7.2 决议 B-1 | lifecycle gate 先行钉死（SA8 §8-4(a) 收口点），契约测试锁定 | 否 |
| 14 | 标记处置留投影包装层；无预算读恒纯 ValueSchema；拷贝器标记处置由 SA1 钉死 | §7.4 决议 D-3 | 显式 `case 'truncated'` 克隆；标记永不入 ValueSchema 联合 | 否 |
| 15 | 零 wire / 零诊断日志 / 零复制面 | §11 DENY LIST | 文件范围排除 | 否 |
| 16 | 模块 AGENTS：类型/签名经 `src/index.ts`；全套门禁 | §7.3/§7.5、§11、§12 | type-only 导出经两包 index；门禁清单 §12 | 否 |

SA8 §8 Required actions 1–8 逐条落实位置：

| # | Required action | 设计位置 |
|---|---|---|
| 1 | 同一 options 贯通两通道；无第二读路径；禁事后裁剪 | §7.1 决议 A（含「同一对象」的语义澄清：同一**预算**——canonical 与 raw 在 T1 读纪律视图下同预算；A-2/A-2b 论证） |
| 2 | 五键恒形 + 失败分支不动 + T0 helper/gate 随动 | §7.2 决议 B、§7.6 |
| 3 | READ_OPTIONS_INVALID 公共分支；定序沿用 T1 G0→options→N0 | §7.2 决议 B-2/B-3 |
| 4 | SA1 收口点 (a) lifecycle×options 定序 (b) 拷贝器标记处置 (c) truncations 源与合成 (d) 类型面派生方式 | §7.2 B-1、§7.4 D-3、§7.2 B-4、§7.3 C-1 |
| 5 | 两通道一致性契约（对齐断言 + 规则集不分叉 + width-only 逐字节相等） | §7.1 A-3/A-4、§12 用例组 D/E |
| 6 | lease 透传（加法可选参、released 先行、别名跟随、Equal 锚保持、经 src/index.ts） | §7.5 |
| 7 | 越界禁令 | §1 非目标、§11 DENY LIST |
| 8 | 门禁 | §12 |

---

## 7. 设计决策与主要备选方案

### 7.1 决议 A：options 单一校验权威（T1）+ 接缝净化（canonicalization）

**问题**：T1 与 T2 的 options 校验规则集存在三处已落地分叉（§3-6）：(i) present-undefined
已知键——T1 合法（≡ 缺席，R1）vs T2 非法；(ii) 宿主原型——T1 严格（proto ∈
{Object.prototype, null}）vs T2 不查原型；(iii) accessor 键——T1 拒绝（零执行）vs T2
`ownOptionValue` 经 `[[Get]]` 取值（非抛错 getter 返回数字时 T2 放行）。直接把调用方 raw
options 透传两通道：T1 拒绝的（非法）调用两通道一致拒绝，但 **T1 接受、T2 拒绝的输入
（如 `{depth: undefined}`）会产生值通道成功 + 投影通道 `SCHEMA_OPTIONS_INVALID` 的分叉**。
resolver 两码（NOT_FOUND/INVALID）在 runtime 组合层收敛 `schema:null` 是既有先例，但
`SCHEMA_OPTIONS_INVALID` 不是路径失败——把它收敛为 null 会让「预算缺陷」静默变成「无
schema」，违反决策 1「响亮拒绝」。

**裁决**：

**A-1 值通道（T1）为 readData 接缝的 options 单一校验权威。** runtime 把调用方 raw
options **原样**传入 `readLogicalValueAtPath(doc, path, options)`（三参重载）；T1 内部
G0（path 形态守卫）→ options 校验 → N0 的钉死定序原样生效；`READ_OPTIONS_INVALID` 失败
成员**原样透传**为 readData 公共失败分支（延续 #273「失败形状以 doc-runtime 为准，不复制
第二份」的 D1 单源纪律——runtime.ts L117–129 既有 Extract 派生即此模式）。

**A-2 值通道成功后做接缝净化，投影通道只吃 canonical——净化读纪律与 T1 权威逐字对齐
（SA2 F1 修订核心）。**

T2 设计 §6.10 明文许可接缝净化（「或在接缝处显式净化……后再进入本 resolver 的第二道
门」）。但**许可净化不等于许可任意读纪律：净化器不得比权威看得更多**。T1 证明的接受判据
建立在其自身读纪律上（§2.3）：键空间 = `Object.keys` 的 own enumerable string 键（R8：
非 enumerable/继承键「天然忽略」）、轴值 = `getOwnPropertyDescriptor` 的 data-property
`value`（L343–348；accessor 拒绝且零执行）、探测期 trap 异常内层 try 收编（L358–360）。
iteration 0 的净化器以 `typeof options.depth === 'number'` 裸 `[[Get]]` 重读 raw——T1 从未
证明 `[[Get]]` 视图纯净。三处已核实触发路径（SA2 F1 / SM-3～SM-5 / ER-1～ER-3）：

- **(i) 键空间越界**：普通对象非 enumerable own `depth` 或被污染 `Object.prototype` 的继承
  `depth`——T1 忽略（R8）、`[[Get]]` 看见 → 值通道无预算而投影按该轴裁剪 → 截断位置静默
  错位（违反 ADR L81「错位即契约违约」；清单消歧规则 L37–38 失真）；
- **(ii) descriptor/get 分叉**：伪装数据属性的 Proxy（descriptor 值 ≠ get 值）——canonical
  轴值与 T1 实际预算不同（错位），或 canonical 值非法（如 1.5）被 T2 二道门拒 →
  `SCHEMA_OPTIONS_INVALID` → `schema:null` 静默吞掉预算缺陷（read-schema-projection.ts L57
  即该收敛落点；§7.1-β 明文拒绝的形态）；
- **(iii) trap 异常裸逃逸**：get trap 抛异常 → 裸 throw 逃逸 `readData`，打破「零 throw、
  `InternalError` 唯一逃逸」不变量（runtime.readData 无顶层 catch——现状亲核 L474–487）。

修订后的净化器（runtime.ts 包内，不导出；判别结果返回，异常不作跨函数控制流）：

```ts
/** T3 接缝净化（包内，不导出）：仅在 readLogicalValueAtPath 三参调用**成功后**执行。
 *  读纪律与 T1 权威（validateReadOptions，read.ts L326–361）逐字对齐：
 *  (a) 键空间 = Object.keys(raw)（own enumerable string 键——与非 enumerable/继承键双盲）；
 *  (b) 轴值 = Object.getOwnPropertyDescriptor(raw, key) 的 data-property value——全程零 [[Get]]
 *      （零 get trap 执行、零继承链查找），accessor 显形即视图已变；
 *  (c) 整体 try 收编探测期 trap 异常（与 T1 L323–324 同一收编面减 getPrototypeOf——见下注）；
 *  (d) 仅「键在场（descriptor 存在且非 accessor）∧ 值为 ≥0 有限整数」才写入 canonical
 *      （present-undefined/ownKeys 谎报键/非 enumerable 一律不写）。
 *  T1 已成功 ⟹ 其第一次读到的视图满足接受判据。本函数以同一纪律重读：凡与该判据不一致
 *  （键集漂移 / accessor 显形 / 值非法化 / trap 抛异常）⟹ 对象在两次读之间不稳定
 *  （非确定性敌意体）→ 返回 ok:false 交组合层响亮失败（A-2b），绝不静默、绝不外抛。
 *  注：不重查宿主原型——canonical 的轴只依赖 own-enumerable 键视图，原型视图漂移不可能
 *  改变任何轴值（继承键在两通道键空间之外）；省去 getPrototypeOf 即少一次 trap 触达。 */
type CanonicalReadOptions =
  | { ok: true; options: ResolveSchemaBudgetOptions }
  | { ok: false };

function canonicalReadOptions(raw: ReadLogicalValueAtPathOptions): CanonicalReadOptions {
  try {
    const out: { depth?: number; maxChildrenPerNode?: number } = {};
    for (const key of Object.keys(raw)) {                            // (a) 与 T1 同一键空间
      if (key !== 'depth' && key !== 'maxChildrenPerNode') {
        return { ok: false };                                        // 键集漂移：T1 视角本应拒绝 → 视图不稳定
      }
      const desc = Object.getOwnPropertyDescriptor(raw, key);        // (b) 与 T1 同一取值通道（零 [[Get]]）
      if (desc === undefined) continue;                              // ownKeys 谎报键：与 T1 同处置（≡ 非 own，不写）
      if (desc.get !== undefined || desc.set !== undefined) {
        return { ok: false };                                        // accessor 显形（T1 已拒、如今在场）→ 视图不稳定
      }
      const value = desc.value;
      if (value === undefined) continue;                             // (d) present-undefined ≡ 缺席（R1）——剥离
      if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isFinite(value) || value < 0) {
        return { ok: false };                                        // 值非法/已变异：绝不把非法值喂给 T2 二道门（ER-1 收口）
      }
      if (key === 'depth') out.depth = value === 0 ? 0 : value;      // H10：-0 归一（镜像 T1 L353）
      else out.maxChildrenPerNode = value === 0 ? 0 : value;
    }
    return { ok: true, options: out };                               // 全新 plain 字面量；键集 ⊆ 两轴、值全合法
  } catch {
    return { ok: false };                                            // (c) 探测期 trap 异常——收编，绝不外抛
  }
}
```

**A-2b 净化失败的响亮出路（零形状复制的优先路线 + 登记豁免的终态）。** 净化返回
`{ok:false}` 时组合层**响亮失败**为 `READ_OPTIONS_INVALID`（SA2 F1 required change (c)），
两个出口按序：

```ts
const canonical = canonicalReadOptions(options);                    // A-2 接缝净化（值通道成功后）
if (!canonical.ok) {
  // 视图不稳定（敌意 descriptor/Proxy 在两次读间漂移或抛异常）→ 响亮失败：
  const reDispatch = readLogicalValueAtPath(doc, path, options);    // 出口① 重派发：T1 权威再校验
  if (!reDispatch.ok) return reDispatch;                             //   状态化 trap 复掷 → T1 内层 try 收编为单源成员（零形状复制）
  return seamReadOptionsInvalid(path);                               // 出口② 交替视图终态：T1 竟又接受 → 接缝构造成员（A-2c 豁免）
}
```

- **出口①（重派发，SA2 建议的零形状复制路线）**：净化器与 T1 校验触达同一 trap 面
  （`Object.keys` / `getOwnPropertyDescriptor`；T1 另触 `getPrototypeOf`，为严格超集）——凡
  净化器能捕到的异常，T1 校验同样能捕。**状态化 trap**（throw-once-then-throw、
  throw-after-N：第一次校验通过、净化期复掷）在重派发中再次复掷，T1 的 V3 内层 try 收编为
  `READ_OPTIONS_INVALID`——成员形状、message、path 回显全部单源于 doc-runtime。重派发的
  options 校验失败于 N0 之前短路（read.ts L140–150，V2），零 doc 触碰、零投影工作；重派发
  本身不可能外抛（`readLogicalValueAtPath` 全程顶层 try、E100 崩溃边界 INV-R1 绝不二次抛
  ——read.ts L132/L230–234 亲核）。
- **出口②（交替视图终态，登记豁免）**：重派发竟又成功（trap 在抛与不抛间交替）时，值通道
  第一次消费的预算与任何后续读到的视图都无法证明一致——两通道同预算（ADR L81）在该输入
  上不可判定，唯一诚实出路是响亮失败。此时由 runtime 构造成员（A-2c）。该出口伴随一次被
  丢弃的完整值读（敌意-only 路径，可接受）。

**A-2c 接缝终态成员的构造（D1 单源纪律的登记豁免）。**

```ts
/** 接缝终态成员（包内，不导出）：唯一构造触发 = 净化视图不稳定 ∧ T1 重派发又接受。
 *  豁免登记（对 D1「失败形状以 doc-runtime 为准，不复制第二份」）：本构造点的触发条件是
 *  接缝级的「读间视图不稳定」，T1 自身的一次校验在结构上无法观察到该条件（它只做一次
 *  读）。形状漂移风险以返回类型注解锁死——类型 ReadLogicalValueBudgetFailure 即
 *  Extract<T1 预算联合, {ok:false}>（§7.3-C-1，类型仍单源）：T1 未来为该成员加必填键时，
 *  本对象字面量在此编译红（fail loud，不静默漂移）。path 回显复用 readDisabled 的包内
 *  纪律（runtime.ts L671–679：Array.isArray 守卫 + try/catch spread + 敌意坍缩 []——提取
 *  为共用包内 helper echoReadPath，同文件同纪律，非新形状）。message 恒非空。 */
function seamReadOptionsInvalid(path: readonly (string | number)[]): ReadLogicalValueBudgetFailure {
  return {
    ok: false,
    code: 'READ_OPTIONS_INVALID',
    path: echoReadPath(path),
    message: 'READ_OPTIONS_INVALID: options 视图在读取期间不稳定（敌意 descriptor/Proxy）——接缝拒绝组合同预算读',
  };
}
```

**修订后的不变量表述（替换 iteration 0 的两条失实论断——SA2 F1 required change (e)）**：

- ~~「净化后对象恒在 T2 验收集内 → 恒通过、零误拒」~~ → **「canonical 仅在净化器以 T1 同一
  读纪律确认（键集 ⊆ 两轴 ∧ 零 accessor ∧ 轴值 ≥0 有限整数）后构造；凡构造出的 canonical
  （全新 plain 字面量）恒在 T2 验收集内——防御纵深第二道门对 canonical 恒通过。视图不稳定
  时根本不构造 canonical，直接响亮失败」**。T2 二道门的 `SCHEMA_OPTIONS_INVALID` 对
  canonical 因而在结构上不可达（对确定性与非确定性输入都成立；iteration 0 的论断只对
  确定性输入为真，对伪装 Proxy 为假——已删）。
- ~~「属性读安全：T1 已证无 accessor、无原型链 depth」~~ → **「T1 证明的是 descriptor 视图
  （own enumerable 键空间 + data-property 值）纯净；净化器复用同一视图、零 `[[Get]]`——
  get trap 从不被执行，descriptor trap 与 get trap 的任何分叉对两通道同等不可见」**。
  该性质以 get trap 调用计数器锚定进契约测试（§12-T1-F F-x3/F-x4）。

**确定性与残余缺口（诚实登记）**：对**确定性输入**（一切诚实对象与一切确定性行为的敌意
体——含 descriptor/get 分叉型伪装 Proxy、非 enumerable own 键、原型继承键、恒抛 get trap），
净化器与 T1 读到同一视图，canonical 恒等于 T1 已消费的预算——SA2 F1 三触发路径全部消除。
对**非确定性 descriptor**（同一 trap 两次读返回不同结果），接缝可检测并响亮拒绝的漂移 =
键集漂移、accessor 显形、值非法化、trap 抛异常；「两个**合法**值之间的交替」（如 depth
在 5 与 1 间交替且两值皆合法）在接缝处不可检测——检测它需要拿到 T1 第一次校验得到的预算
数值，而 `ValidatedBudget` 是 doc-runtime 内部非导出状态（read.ts L303）。闭合该缺口需要
doc-runtime 暴露已校验预算（新公共 API），违反本票「只消费」非目标（§1、SA8 §8-7）——
登记为残余风险（§13）与 follow-up 候选，不在本票伪装解决。

**「同一 options 对象贯通两通道」（SA8 §8-1）的语义澄清**：该义务的规范来源是 ADR 决策 6
「runtime `readData` **组合值与投影两通道的同预算截断**」——约束对象是**预算**（一次读内
值与投影看到同一 depth/width 语义），不是对象引用同一性。raw 与 canonical 在 T1 读纪律视图
下恒表示同一预算（canonical 仅剥离 T1 视为缺席的 present-undefined 键；视图不稳定时根本
不进入双通道组合而直接响亮失败）；两通道各自内部的截断判定因此恒一致。设计以契约测试钉死
预算同一性（§12 用例组 D/F），不以引用同一性为验收面。

**A-3 width 轴净化后原样保留。** canonical 保留 `maxChildrenPerNode`（值通道消费；resolver
按 T2 §6.9 校验后忽略）——投影通道对 width 零操作的既有语义（L74）不变，且组合层不依据
轴名做任何过滤决策（过滤 = 组合层解释预算，越权）。

**A-4 对齐可测性前提。** 两通道规则集不分叉的可观察证明 = 「runtime 接受的 options 在两
通道都不产生 options 类失败」+「runtime 拒绝的 options 两通道一致拒绝（由 T1 权威单点拒
绝，投影通道根本不被触达）」+「敌意/异态键夹具上两通道位置集仍一一对应（或整调用响亮失
败）」——§12 用例组 F 的差分矩阵与 F-x 敌意净化面、用例组 D 的敌意夹具延拓。

**备选否决**：

- **(α) runtime 自建完整校验器（复制 T1 规则）再构造 canonical 双发**：需复制 ~40 行
  敌意安全逻辑（Proxy trap 收编、descriptor 读、原型判定）——规则分叉风险从「T1/T2 之间」
  转移到「runtime/T1 之间」，正是 SA8 行 6 要消灭的病；且 doc-runtime 校验器非导出（T1
  设计 §7.2 明示非导出），无法委托。否决。
- **(β) raw 双发 + `SCHEMA_OPTIONS_INVALID` 收敛 `schema:null` 或映射 READ_OPTIONS_INVALID**：
  前者把响亮的预算缺陷静默化为无 schema（违反决策 1；read-schema-projection.ts L57 即该
  落点）；后者在值通道已成功、部分截断已发生后改判失败，失败语义不诚实。否决。
- **(γ) 先净化后双发（purify-then-forward）**：净化器必须自带敌意安全（在 T1 校验前读
  raw），仍需复制宿主/accessor/未知键判定才能保证「净化的拒绝语义 == T1 拒绝语义」——
  同 (α) 的分叉病。否决；采用「权威先行、成功后净化」的 A-1/A-2 顺序。
- **(δ) 把 canonical（而非 raw）传给 T1 值通道（F1 修订时新增评估）**：净化器对 accessor
  键、非 plain 宿主静默跳过或收窄，等于把 T1 会拒绝的输入洗白成合法形状（如
  `{get depth(){return 5}}` 经净化变 `{depth:5}` 被接受）——比读纪律分叉更严重，直接违反
  A-1（T1 是调用方原始输入的唯一拒绝权威）。否决。
- **(ε) canonicalize-then-forward 变体（净化先行、T1 后行）**：(γ) 的镜像问题——「净化时
  视图」与「T1 校验时视图」仍是两次读，非确定性原样存在而拒绝语义更模糊。否决。

### 7.2 决议 B：组合定序、五键信封与失败面

**B-1 lifecycle gate 先行（SA8 §8-4(a) 收口点，钉死）。** 现结构 lifecycle gate 在组合
之前（runtime.ts L480–483）；T3 保持：`state.lifecycle !== 'ready'` → `readDisabled()`
返回 `RUNTIME_READ_DISABLED`，**先于一切 options 读取与 doc 触碰**。推论（入契约测试）：
closing/closed 期 + 非法 options → `RUNTIME_READ_DISABLED`（与 #92「停接纳即拒绝」精神
一致——停接纳期输入不验收、不分类）。ready 期内的失败优先级（由 T1 定序 + 组合顺序自然
涌现，入契约测试）：lifecycle > path 形态（G0）> options > path 内容（游走/投影失败）>
成功。

**B-2 组合实现（runtime.ts，工厂内局部函数声明 + 对象字面量引用；重载形态依据见 §7.3）**：

```ts
function readData(path: readonly (string | number)[]): NamespaceRuntimeReadDataResult;
function readData(
  path: readonly (string | number)[],
  options: NamespaceRuntimeReadDataOptions,
): NamespaceRuntimeReadDataBudgetResult;
function readData(
  path: readonly (string | number)[],
  options?: NamespaceRuntimeReadDataOptions,
): NamespaceRuntimeReadDataResult | NamespaceRuntimeReadDataBudgetResult {
  const lifecycle = state.lifecycle;
  if (lifecycle !== 'ready') return readDisabled(lifecycle, path);        // B-1：零 options 读取、零 doc 触碰
  if (options === undefined) {
    const result = readLogicalValueAtPath(doc, path);                     // 两参重载：逐字节现行为
    if (!result.ok) return result;                                        // PATH_NOT_ALLOWED 原样（不带新键）
    return {
      ok: true,
      value: result.value,
      schema: projectReadDataSchema(state, path),                         // 两参投影：逐字节现行为
      truncated: false,
      truncations: [],                                                    // 每次调用新鲜空数组（禁共享常量：调用方可变副本纪律）
    };
  }
  const result = readLogicalValueAtPath(doc, path, options);              // 三参：T1 权威校验（G0→options→N0→N1→P1）
  if (!result.ok) return result;                                          // PATH_NOT_ALLOWED | READ_OPTIONS_INVALID 原样透传
  const canonical = canonicalReadOptions(options);                        // A-2 接缝净化（T1 同款读纪律；判别结果）
  if (!canonical.ok) {                                                    // A-2b：视图不稳定 → 响亮失败（绝不静默 schema:null、绝不外抛）
    const reDispatch = readLogicalValueAtPath(doc, path, options);        //   出口①：T1 单源收编状态化 trap（零 doc 触碰先短路）
    if (!reDispatch.ok) return reDispatch;
    return seamReadOptionsInvalid(path);                                  //   出口②：交替视图终态（A-2c 登记豁免）
  }
  return {
    ok: true,
    value: result.value,                                                  // 值透传（undefined 显式在场的既有语义）
    schema: projectReadDataSchema(state, path, canonical.options),        // 投影通道只吃 canonical
    truncated: result.truncated,                                          // B14 透传：=== truncations.length > 0
    truncations: result.truncations,                                      // B-4：清单源 = 值通道载体计数
  };
}
```

（`readData` 以函数声明形式定义在 `createNamespaceRuntimeWithSeam` 闭包内，十二键字面量以
`readData,` 引用——理由与探针证据见 §7.3-C-4。）

**B-3 失败面（冻结）**：`PATH_NOT_ALLOWED`、`RUNTIME_READ_DISABLED`、
`NAMESPACE_LEASE_RELEASED`（lease 层）三个既有失败分支形状零变化、不带 `truncated`/
`truncations`（ADR L67「读在到达投影前失败，无值可截」）；`READ_OPTIONS_INVALID` 为**新增**
第四失败分支，全部三个来源（T1 首校验拒绝原样透传 / A-2b 出口① T1 重派发单源成员 / 出口②
接缝终态成员）产出同一成员形状 `{ok:false, code, path, message}`（path 新鲜回显、message
恒非空）。无 options 调用**不可**产生该码（类型面由零泄漏派生保证，行为面由无 options 分
支结构保证——该分支根本不触 options 语义）。

**B-4 truncations 源与合成（SA8 §8-4(c) 收口点）**：清单 = T1 结果的 `truncations` 数组
**逐引用透传**（T1 每调用新鲜累加器，read.ts L310–313——单所有者移交，无跨调用共享）；
`truncated` = T1 的 `truncated`（B14 不变式在 T1 内已成立）。runtime **零合成、零合并、零
投影侧清单**（resolver 无清单字段，标记带内——T2 §6.4 选型）；条目三字段
`{path, kind, omitted}` 语义全部单源于 T1（§2.3）：path 与实参同基、depth 尾段即被裁键名、
omitted = 直接子项数（非后代总数）、width 父路径单条。

**B-5 `schema:null` 与 always-on 不变**：`projectReadDataSchema` 的 D3a 状态守卫
（`schemaState !== 'ready' || activeTools === undefined` → null）先于 path 规范化与 resolver
调用——预算模式下值通道可截断而投影为 null（五键：`schema:null` + `truncated:true` 合法
共存）；预算参数不是 schema 开关（SA8 冻结面行 8）。注意与 A-2b 的分界：净化失败**绝不**
经由该 `schema:null` 通道静默化（那正是 ER-1 形态）——净化失败在投影调用之前短路为响亮
失败成员。

### 7.3 决议 C：类型面——双结果联合 + 重载（零泄漏）

**C-1 结果联合（runtime.ts）**：

```ts
import type {
  ReadLogicalValueAtPathBudgetResult,
  ReadLogicalValueAtPathOptions,
  ReadLogicalValueTruncationEntry,
} from '@nomicore/doc-runtime';
import type { BudgetedReadDataSchemaProjection } from '@nomicore/vfsl';

/** T1 预算联合的失败成员（PATH_NOT_ALLOWED | READ_OPTIONS_INVALID）——零泄漏派生的预算侧源；
 *  亦是接缝终态成员（A-2c seamReadOptionsInvalid）的返回类型注解（形状漂移编译锁）。 */
type ReadLogicalValueBudgetFailure = Extract<ReadLogicalValueAtPathBudgetResult, { ok: false }>;

/** readData options（ADR-0024 决策 1）：doc-runtime 单源类型别名（零复制）。 */
export type NamespaceRuntimeReadDataOptions = ReadLogicalValueAtPathOptions;

/** 无 options 调用结果（ADR-0024 决策 4 恒五键成功面；失败 = PATH_NOT_ALLOWED | RUNTIME_READ_DISABLED）。 */
export type NamespaceRuntimeReadDataResult =
  | {
      ok: true;
      value: unknown;
      schema: ReadDataSchemaProjection | null;
      truncated: boolean;
      truncations: readonly ReadLogicalValueTruncationEntry[];
    }
  | ReadLogicalValueFailure            // Extract<ReadLogicalValueResult, {ok:false}>——PATH_NOT_ALLOWED 单源（既有，不改）
  | RuntimeReadDisabledResult;

/** 预算调用结果：成功面 schema 加宽为 BudgetedReadDataSchemaProjection | null；追加 READ_OPTIONS_INVALID。 */
export type NamespaceRuntimeReadDataBudgetResult =
  | {
      ok: true;
      value: unknown;
      schema: BudgetedReadDataSchemaProjection | null;
      truncated: boolean;
      truncations: readonly ReadLogicalValueTruncationEntry[];
    }
  | ReadLogicalValueBudgetFailure      // PATH_NOT_ALLOWED | READ_OPTIONS_INVALID（read.ts L96–97 注记预期的零泄漏点）
  | RuntimeReadDisabledResult;
```

READ_OPTIONS_INVALID 只出现在预算联合（SA8 §8-4(d)；T1 L96–97 注记的「runtime Extract 派生
零泄漏」由此兑现：无 options 联合的失败源仍是**两参**联合的 Extract）。

**C-2 接口签名（重载序钉死：预算重载在前、legacy 在后）**：

```ts
export interface NamespaceRuntime {
  // …（其余十一键零变化）…
  readonly readData: {
    (path: readonly (string | number)[], options: NamespaceRuntimeReadDataOptions): NamespaceRuntimeReadDataBudgetResult;
    (path: readonly (string | number)[]): NamespaceRuntimeReadDataResult;
  };
}
```

重载序依据（探针证据 §7.3-C-5-E1/E5）：TS `ReturnType<T>` 对重载函数取**最后一个**签名；
legacy 排最后使 registry 既有 `_readAlias` 锚（`Equal<NamespaceLeaseReadDataResult,
ReturnType<NamespaceRuntime['readData']> | NamespaceLeaseReleasedIssue>`，lease.ts L389–391）
**原文零改动继续成立**（SA8 §8-6「Equal 锚保持」的最强形式）。调用解析两序皆正确：单参调
用跳过双参重载命中 legacy；双参调用命中预算重载。显式 `readData(path, undefined)` 为编译错
误（双参重载 `options` 非 `| undefined`）——与 T1 公共面（read.ts L118–126 重载同形）完全
对齐：运行时「显式 undefined ≡ 无 options」仅是 JS 调用方的防御语义，TS 面在
exactOptionalPropertyTypes 纪律下不接受显式 undefined（T1 既定取舍，本票不引入分叉）。

**C-3 公共导出（runtime/src/index.ts，type-only——值导出面仍恰 `RuntimeWriteFatalError`
一键，模块级运行时探测审计不受影响）**：新增 `NamespaceRuntimeReadDataBudgetResult`、
`NamespaceRuntimeReadDataOptions`（随既有 runtime.ts 类型导出块）；新增
`export type { ReadLogicalValueTruncationEntry } from '@nomicore/doc-runtime';`（消费方命名
面；doc-runtime 为 runtime 既有 dependency，d.ts 引用可解析）。

**C-4 实现载体**：`readData` 以**函数声明 + 双重载 + 实现签名**写在工厂闭包内、对象字面量
按名引用（§7.2-B-2）。探针证据 §7.3-C-5-E2：返回联合的实现闭包**不可**赋给重载属性类型
（联合非其成员的子类型）；带重载声明的函数其类型即重载签名集，恒可赋值。这是无 cast 落地
重载属性的唯一常规形态。

**C-5 设计假设探针证据**（SA1 窄域只读探测：`/tmp/sa1-probe/overload-probe.ts`，仓外
typescript 5.9 `tsc --noEmit --strict --exactOptionalPropertyTypes`，非仓内验证运行）：

| # | 假设 | 结果 |
|---|---|---|
| E1 | `ReturnType<重载属性>` 取最后签名 | ✅（= legacy 联合） |
| E2 | 联合返回闭包不可赋给重载属性；重载函数声明可赋 | ✅/✅ |
| E3 | `Extract<联合, {ok:false}>` 双源派生（PATH only / PATH+OPTIONS） | ✅ |
| E4 | `ReadDataSchemaProjection`（纯）结构子类型 of `BudgetedReadDataSchemaProjection`；反向不成立（标记非 ValueSchema） | ✅/✅ |
| E5 | 单参调用 → legacy 类型、双参 → 预算类型；显式 undefined 双参 → 编译错误（镜像 T1） | ✅/✅/✅ |
| E6 | 条件型按参数形状选择**首个**重载 | ❌（仍取最后——预算重载返回面无法用条件型探针锁定 → §7.5 用具名类型 Equal 锁） |

### 7.4 决议 D：投影接缝——`projectReadDataSchema` 重载与标记感知 detach

**D-1 入口重载（read-schema-projection.ts）**：

```ts
export function projectReadDataSchema(
  state: RuntimeState,
  path: readonly (string | number)[],
): ReadDataSchemaProjection | null;                                              // 既有：逐字节不变
export function projectReadDataSchema(
  state: RuntimeState,
  path: readonly (string | number)[],
  options: ResolveSchemaBudgetOptions,
): BudgetedReadDataSchemaProjection | null;                                      // 新增：预算读
export function projectReadDataSchema(
  state: RuntimeState,
  path: readonly (string | number)[],
  options?: ResolveSchemaBudgetOptions,
): ReadDataSchemaProjection | BudgetedReadDataSchemaProjection | null {
  // D3a 状态守卫 → D3b normalizeReadPath → resolver 分支调用 → detach（全部既有结构不动）
}
```

内部 resolver 调用**显式分支**（无 cast 过重载）：`options === undefined
? resolveSchemaAtPath(tools.derived, normalized) : resolveSchemaAtPath(tools.derived,
normalized, options)`——无 options 走 T2 两参重载（逐指令 legacy 路径）；预算走三参（输入恒
为 canonical，§7.1）。D3a/D3b/双域处置（敌意 path → null；`InternalError` 直通逃逸）结构
与位置零变化。

**D-2 detach 重载**：`detachReadSchemaProjection` 增加纯/预算双重载（参数
`ReadDataSchemaProjection` → 返回纯；`BudgetedReadDataSchemaProjection` → 返回预算——重载
按实参静态类型选择，E4 保证预算实参不命中纯重载）。

**D-3 深拷贝器标记处置（SA8 §8-4(b) 收口点，钉死）**：`cloneValueSchema` 参数/返回加宽为
`BudgetedValueSchema`（纯/预算双**重载**保住两个调用侧的静态纯度——legacy 侧实参静态
`ValueSchema` 命中纯重载、返回 `ValueSchema`），switch 新增**显式** `case 'truncated'`：

```ts
case 'truncated': {
  const clue: SchemaTruncationClue = node.clue.via === 'ref'
    ? { via: 'ref', name: node.clue.name }
    : { via: 'container', containerKind: node.clue.containerKind };       // clue 全新普通副本
  const out: SchemaTruncationMarker = { kind: 'truncated', clue };
  memo.set(node, out);                                                     // memo 纪律统一（标记为叶节点）
  return out;
}
```

处置规则：(i) 标记是**投影包装联合成员**，克隆产物是全新普通可变对象（不冻结——与四件套
detached 纪律一致），**永不**下沉为 ValueSchema 成员（ADR-0003 冻结面；T2 §6.4 公共面
pin）；(ii) 10-case 显式分派、仍**无 default**——穷尽性检查保持：ValueSchema 未来若加 kind，
switch 缺分支即编译红（fail loud 不降级）；(iii) memo 按对象身份统一登记（防同标记多次出
现时重复克隆——保共享同构）；(iv) 预算容器节点成员值位的「静态 ValueSchema / 运行时可为
标记」错位是 T2 `budgetShell` §6.8 已 pin 的公共面形态（浅层包装联合、不公开平行类型族），
本模块沿同一形态消费，错位不外泄（外层返回类型由调用侧选择的重载决定）。`cloneValueSchemaRecord`
（aliases 表）同款双重载加宽——预算模式闭包体成员值位可含标记。

**D-4 无预算读类型纯度**：legacy 路径全程只触 `ValueSchema` 静态面（纯重载链），无预算读
投影**恒纯 ValueSchema、形状零变化**（SA8 冻结面行 1/行 2）。

### 7.5 决议 E：registry lease 原样透传

**E-1 类型（types.ts）**：

```ts
import type { NamespaceRuntimeReadDataBudgetResult, NamespaceRuntimeReadDataOptions } from '@nomicore/namespace-runtime';

/** lease.read 预算结果 = runtime 预算联合 | released issue（沿 NamespaceLeaseReadDataResult 先例）。 */
export type NamespaceLeaseReadDataBudgetResult =
  | NamespaceRuntimeReadDataBudgetResult
  | NamespaceLeaseReleasedIssue;

export interface NamespaceLease {
  // …（其余成员零变化）…
  readData(path: readonly (string | number)[], options: NamespaceRuntimeReadDataOptions): NamespaceLeaseReadDataBudgetResult;
  readData(path: readonly (string | number)[]): NamespaceLeaseReadDataResult;   // 重载序镜像 runtime（§7.3-C-2）
}
```

registry `src/index.ts` 导出 `NamespaceLeaseReadDataBudgetResult`（沿 L45
`NamespaceLeaseReadDataResult` 先例；type-only——主入口运行时 value-key 审计（恰九键）不受
影响）。lease 层**不**再定义 options 类型（单源 `@nomicore/namespace-runtime`；registry
types.ts 直接 import 该命名类型——与既有 `NamespaceRuntimeReadDataResult` 组合先例同款）。

**E-2 实现（lease.ts，工厂内局部函数声明 + 字面量引用）**：

```ts
function leaseReadData(path: readonly (string | number)[]): NamespaceLeaseReadDataResult;
function leaseReadData(
  path: readonly (string | number)[],
  options: NamespaceRuntimeReadDataOptions,
): NamespaceLeaseReadDataBudgetResult;
function leaseReadData(
  path: readonly (string | number)[],
  options?: NamespaceRuntimeReadDataOptions,
): NamespaceLeaseReadDataResult | NamespaceLeaseReadDataBudgetResult {
  if (released) return RELEASED_ISSUE;                          // released 短路先于一切透传（冻结 issue 原样）
  return options === undefined
    ? entry.runtime.readData(path)
    : entry.runtime.readData(path, options);                    // active 期原样透传：raw 引用直传（透传断言锚）
}
```

lease 层零预算解释、零校验、零第二行为（SA8 行 11）；透传 = **raw options 引用原样**交给
runtime（canonical 净化是 runtime 接缝职责——差一层就不是「原样透传」；敌意 options 的
收编因此也全部发生在 runtime 接缝内，lease 层对抛错 Proxy 零额外触达）。

**E-3 类型锁（lease.ts）**：既有 `_readAlias` **原文保持**（成立前提 = legacy 重载排最后，
探针 E1）；新增两锁：

```ts
type _readBudgetAlias = AssertTrue<
  Equal<NamespaceLeaseReadDataBudgetResult, NamespaceRuntimeReadDataBudgetResult | NamespaceLeaseReleasedIssue>
>;                                                              // 预算别名跟随（具名组合锁——条件型无法探首个重载，探针 E6）
type _readOverloadOrder = AssertTrue<
  Equal<ReturnType<NamespaceLease['readData']>, NamespaceLeaseReadDataResult>
>;                                                              // 重载序稳定锁：legacy 恒为最后（_readAlias 的前提自锁）
```

### 7.6 决议 F：T0 集中 helper 恰三键 → 五键修订

**F-1 `readdata-ok-shape.ts`**：`READDATA_OK_KEYS` → `['ok','schema','truncated','truncations',
'value']`（字母序）；`ReadDataOkShape` 增 `truncated: boolean; truncations: readonly
ReadLogicalValueTruncationEntry[]`（typed stub 的 TS2322 形状锁随公共联合加键自动武装）；
`readDataOk(value, schema, truncated = false, truncations = [])`（缺省参数——既有 10 文件的
双参调用点零改动编译通过）；`expectReadDataOk(actual, { value, schema, truncated?,
truncations? })`（期望侧独立内联构造五键——反伪绿不变量保持：生产侧突变只改 actual）；
`expectReadDataOkKeys` 随常量自动五键。

**schema 类型钉死（SA2 N3——二选一取使用纪律路线）**：`ReadDataOkShape.schema` **保持**
`ReadDataSchemaProjection | null`（纯面，不加宽为含 `BudgetedReadDataSchemaProjection`）。
理由：(i) 10 个消费文件的 typed stub（`() => readDataOk(...)` 赋给 runtime 替身的
`readData`）依赖「ReadDataOkShape ⊆ 两联合成功成员」的可赋值性——E4 已证纯 ⊆ Budgeted 单向
成立；把 helper schema 加宽为含 Budgeted 会使 stub 对 **legacy 重载**不可赋值（Budgeted
⊄ 纯），10 文件全红；(ii) 泛型参数化（`ReadDataOkShape<S = 纯面>`）机械上可行但对存量零
收益。**预算断言纪律（入 §12-T1/T2 规格）**：预算读结果只用 `expectReadDataOkKeys`（五键
键集）+ 定点断言（`r.value` / `r.truncated` / `r.truncations` / `r.schema` 逐字段：标记位
收集按 T1-D recipe、逐字节相等按 T1-E 锚）——**不**对含标记投影做 `expectReadDataOk` 整形
状断言（该用法在纯面 helper 下本就是编译错误，属预期fail-loud）。

**F-2 扫描器与收敛门**：`SUCCESS_SHAPE_KEYS` → 五键（family B 整键集断言面随动）；family A
判定（`ok:true` + `schema` 超集匹配，扫描器 L240–266）**无需改动**——修订后新的五键内联字面量
同样命中，集中化纪律穿越形状修订持续有效；门测试正负样本更新：family B 正样本改五元素数组、
增补五键 family A 正样本、三键 family B 样本移除（常量更新后不再可命中）；负样本族不变
（`toMatchObject` 加法兼容、doc-runtime 两键、失败分支、已集中化形态）。门断言（family A/B
归零 + 作用域覆盖 + 仪器敏感性）语义不变。

**F-3 存量测试随动面（零编辑）**：**10 个** helper 消费文件（§2.6——runtime 2 + registry 8；
SA2 N2 修正 iteration 0 的「11」计数）的恰三键断言经 helper 自动五键化——这正是 T0 的交付
目的；其中 `readdata-docs-adr0016-sync-control.test.ts`（真实 Registry 装配的 readData 行为
锚）在 T3 实现后自动绿（运行时返回五键、helper 期望五键）。

### 7.7 备选方案否决记录（设计层汇总）

| 备选 | 否决理由 |
|---|---|
| runtime 层对完整投影事后裁剪（读全量再裁） | ADR L116 明文否决；破坏「未展开分支零物化」与闭包/切片先裁后收集顺序 |
| 第二条读路径（如 `readDataBudgeted` 新方法） | ADR 决策 6 明文禁止；接口分叉正是 ADR-0016 拒绝过的形态 |
| 成功形状按参数分叉（无 options 三键 / 有 options 五键） | ADR L60–67 钉死恒五键「形状唯一、无缺席=无截断隐式约定」 |
| 无 options 成员 `truncated: false` / `truncations: readonly []` 字面量类型收紧 | 与预算成员类型分叉（同形异型），无消费方需求；ADR L63 形状即 `boolean`/数组 |
| truncations 合成（值 + 投影标记合并清单） | 决策 3 清单源 = 值通道载体计数（SA8 行 4）；标记带内（T2 §6.4）；合成即双源歧义 |
| 单一联合签名（`readData(path, options?): Legacy | Budget`） | READ_OPTIONS_INVALID 泄漏进无 options 调用方类型面（违反 T1 L96–97 零泄漏注记与 SA8 §8-4(d)） |
| runtime 复制 T1 校验器 / purify-then-forward / canonical 传 T1 | §7.1 备选 (α)/(γ)/(δ)/(ε)：规则分叉病转移或敌意输入洗白，未消灭 |
| 净化失败收敛 `schema:null`（`SCHEMA_OPTIONS_INVALID` 落点）或静默跳过漂移键 | 决策 1「响亮拒绝」+ ADR L81 错位即违约 + §7.1-β；SA2 ER-1/SM-5 所指静默化形态 |
| 净化失败时 runtime 手写整个失败联合/第二套失败形状 | D1 单源纪律；仅 A-2c 一个触发点登记豁免且以 `ReadLogicalValueBudgetFailure` 类型注解锁死形状漂移（§7.1-A-2c） |
| lease 层构造 canonical | 透传义务（SA8 §8-6「原样」）与代理语义最小性；净化是 runtime 接缝职责 |
| 共享冻结空数组常量作无 options `truncations` | 调用方可变副本纪律（ADR-0016 L70 不冻结、可变普通副本）；共享常量会跨调用泄漏调用方 mutation |
| 拷贝器加 default 分支兜底标记 | 破坏无 default 的穷尽性 fail-loud；标记必须显式 case（SA8 §8-4(b)） |
| helper schema 加宽含 Budgeted / 泛型参数化 | §7.6-F-1 N3 钉死：加宽破坏 10 消费文件 stub 对 legacy 重载可赋值性（E4 单向）；泛型对存量零收益 |

---

## 8. 接口、状态机与数据流

### 8.1 公共接口变化总表

| 面 | 变化 | 性质 |
|---|---|---|
| `NamespaceRuntime.readData` | 单参 → 双重载（预算在前/legacy 在后）；成功面两联合均恒五键 | 破坏性修订（ADR L69：0.x minor bump 论据；runtime 0.1.12 → 0.1.13 属发布流随动，非代码面） |
| `NamespaceRuntimeReadDataResult` | 成功成员 + `truncated`/`truncations` 两键；失败成员零变化 | 同上 |
| `NamespaceRuntimeReadDataBudgetResult` | 新类型（预算联合：READ_OPTIONS_INVALID + Budgeted 投影面） | 新增 |
| `NamespaceRuntimeReadDataOptions` | 新类型别名（= doc-runtime `ReadLogicalValueAtPathOptions`，单源） | 新增 |
| runtime index | +3 type-only 导出（上两新类型 + `ReadLogicalValueTruncationEntry` 转出） | 加法 |
| `NamespaceLease.readData` | 方法双重载（镜像序）；active 期透传 options | 加法（代理语义扩展，SA8 行 11） |
| `NamespaceLeaseReadDataBudgetResult` | 新类型别名；registry index +1 type-only 导出 | 加法 |
| doc-runtime / vfsl 公共面 | **零变化**（只消费） | — |

### 8.2 编排状态机（单次调用阶段序；无持久状态、零 sequencer 槽位）

```
readData(path[, options])                                  [全同步]
 ├─ S1 lifecycle gate     lifecycle ≠ ready → RUNTIME_READ_DISABLED（零 options 读取、零 doc 触碰）〔钉死：SA8 §8-4(a)〕
 ├─ S2 分支
 │   ├─ S2a options === undefined（无 options 模式）
 │   │   ├─ V 值通道两参 readLogicalValueAtPath(doc, path)      〔逐字节现行为〕
 │   │   │   └─ G0 path 形态守卫 → N0 probeRoot → N1 导航 → P1 legacy 投影
 │   │   ├─ V 失败 → PATH_NOT_ALLOWED 原样返回（三键失败形状，不带新键）
 │   │   └─ P 投影两参 projectReadDataSchema(state, path)       〔逐字节现行为〕
 │   │       └─ D3a 状态守卫（null 短路）→ D3b 敌意 path 规范化（null 短路）
 │   │         → resolveSchemaAtPath 两参 → InternalError 直通逃逸（唯一 throw 通道）
 │   │         → D5 detach 深拷贝（纯 ValueSchema 面）
 │   │   → 成功五键 { ok, value, schema, truncated:false, truncations:[]（新鲜）}
 │   └─ S2b options 在场（预算模式）
 │       ├─ V 值通道三参 readLogicalValueAtPath(doc, path, raw)  〔T1 权威校验：G0 → options → N0 → …〕
 │       │   ├─ G0 拒绝 → PATH_NOT_ALLOWED（优先于 options——T1 V1 钉死）
 │       │   ├─ options 非法 → READ_OPTIONS_INVALID（零 doc 触碰；原样透传，公共新失败分支）
 │       │   └─ N0/N1/P1 预算贯通投影（截断省略 + truncations 载体计数 + B14）
 │       ├─ C 接缝净化 canonicalReadOptions(raw)                 〔仅在值通道成功后；A-2：T1 同款读纪律，零 [[Get]]〕
 │       │   ├─ ok:true → P 投影三参 projectReadDataSchema(state, path, canonical)
 │       │   │   └─ D3a（null 短路）→ D3b（null 短路）→ resolveSchemaAtPath 三参（canonical 恒过第二道门）
 │       │   │         → InternalError 直通逃逸 → D5 detach（10-case 含标记克隆）
 │       │   │   → 成功五键 { ok, value, schema, truncated: V.truncated, truncations: V.truncations }
 │       │   └─ ok:false（视图不稳定：键集漂移 / accessor 显形 / 值非法 / trap 抛异常）
 │       │       ├─ R 重派发 readLogicalValueAtPath(doc, path, raw)   〔A-2b 出口①：T1 再校验；options 失败先于 N0 短路〕
 │       │       │   ├─ 失败 → 该成员原样返回（状态化 trap 复掷 → T1 单源 READ_OPTIONS_INVALID，零形状复制）
 │       │       │   └─ 成功 → seamReadOptionsInvalid(path)（出口②：交替视图终态；A-2c 登记豁免；
 │       │       │        恰四键、path 新鲜回显、message 非空；值读结果丢弃）
 │       │       └─〔两出口都绝不 throw、绝不 schema:null 静默化、绝不带 truncated/truncations〕
 └─ lease.readData 前置：released → NAMESPACE_LEASE_RELEASED（冻结 issue，先于一切透传）
```

### 8.3 数据流路线

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
|---|---|---|---|---|---|---|---|---|
| R1 无 options 读 | 调用方 `readData(path)` / `lease.readData(path)` | 无写入（读路径零 sequencer、零 doc 写） | lease（active）→ runtime → doc-runtime 两参 + vfsl resolver 两参；跨包边界各一跳；返回前 detach 深拷贝 | 无持久化/无 wire（readData 不上 wire） | ROOT 载体（Y.Doc live 读）+ derived（不可变共享读） | 五键信封；value/schema **内容**与 T3 前逐字节一致 | PATH_NOT_ALLOWED / RUNTIME_READ_DISABLED / released 各走原通道；InternalError 唯一逃逸 throw | §12-T2（回归锚）、§12-T3（类型面） |
| R2 预算读（值通道） | 调用方 `readData(path, options)` | 无写入；truncations 为 T1 调用级新鲜累加器 | raw options **原样**入 T1 三参（权威校验：敌意通道全探测零执行 accessor） | 无 | ROOT 载体；折叠/裁减位零 get/descriptor.value 读（B8 零物化） | 值截断省略 + truncations 条目（path 同基/kind/omitted） | READ_OPTIONS_INVALID（零 doc 触碰）/ PATH_NOT_ALLOWED 透传 | §12-T1 组 A/B/C/F |
| R3 预算读（投影通道） | runtime 组合层（canonical） | resolver 每调用新鲜 walk 状态 + 新鲜标记节点 | **canonical 净化**（T1 同款读纪律：own-enumerable 键空间 + descriptor 取值 + try 收编；present-undefined 剥离、全新 plain 字面量、零 `[[Get]]`）→ resolver 三参；身份短路保充足 depth 字节恒等；视图不稳定 → 不构造 canonical、走 A-2b 响亮失败 | 无 | derived 共享节点只读 + 闭包/切片按 emitted 收缩 | Budgeted 投影（标记带内）→ detach 10-case 深拷贝（标记全新副本） | SCHEMA_OPTIONS_INVALID 对 canonical 结构性不可达（防御纵深保留给直接 resolver 调用方）；净化失败 = READ_OPTIONS_INVALID（重派发单源成员或接缝终态成员），**不经** resolver 两码收敛 `schema:null` 通道 | §12-T1 组 D/E/F、§12-T2 detach |
| R4 净化失败（敌意 options 视图不稳定） | runtime 组合层（A-2b） | 无（出口② 丢弃一次被敌意 trap 诱发的不稳定值读） | 重派发走 T1 校验（状态化 trap 在此复掷收编） | 无 | — | 恰四键 `READ_OPTIONS_INVALID`（path 新鲜回显、message 非空） | 绝不 throw（净化器内层 try + T1 E100 边界双保险）；绝不 `schema:null` 静默化 | §12-T1-F（F-x5/F-x6） |
| R5 lease 透传 | Cordis host / L2 调用方 | 无 | released 检查 → raw 引用直传 runtime | 无 | — | runtime 结果逐字段一致 | released 冻结 issue 先行 | §12-T5 |

跨模块/跨包/跨持久化边界逐跳说明：R1/R2 各含 lease→runtime（同进程对象边界）、
runtime→doc-runtime / runtime→vfsl（npm 包边界）两跳；R4 复用 runtime→doc-runtime 一跳；
无进程/网络/持久化跳（零 wire、零诊断日志发射点——读面不触 diagnostic emitter）。

---

## 9. 错误、恢复、并发和幂等

- **错误面**：四失败分支（§7.2-B-3）互斥、全同步、零 throw。敌意输入收编全景：(i) 敌意
  path → `PATH_NOT_ALLOWED`（G0）/ `schema:null` 收敛（D3b，ok 恒真）；(ii) 敌意 options
  （T1 首校验拒绝）→ `READ_OPTIONS_INVALID` 原样透传；(iii) **敌意 options 视图不稳定
  （descriptor/proxy 在读间漂移或抛异常）→ `READ_OPTIONS_INVALID`（A-2b 重派发单源成员或
  接缝终态成员）——绝不静默 `schema:null`、绝不带截断键、绝不外抛**（SA2 F1 required
  change (e) 的不变量重述）；(iv) `InternalError`（可信域畸形 derived）仍是唯一逃逸 throw
  通道（预算游走零新增 throw，T2 §环语义已收口；净化器内层 try 收编一切探测期异常）——
  internal-bug-only、生产不可达，不变。
- **恢复/重试**：读为纯函数式无副作用调用（零 doc 写、零 sequencer、零缓存），失败后调用方
  修正 options/path 重调即恢复；无部分状态残留（truncations 累加器为调用局部；R4 出口②
  丢弃的值读不留痕——读路径零副作用使丢弃安全）。
- **并发**：reads 在 write sequencer 外（ADR-0008；模块 AGENTS）——单线程 JS 语义下
  readData 全同步执行，与写槽无交错点；`truncations`/canonical/detach 产物均为调用局部，
  无跨调用共享可变状态（无 options 分支的 `[]` 每调用新鲜——§7.7 否决共享常量）。
- **幂等**：同参数重复调用逐字节确定（T1/T2 确定性 + detach 确定性；**敌意非确定性
  options 除外**——其本身即被 A-2b 响亮拒绝的对象，不构成幂等承诺的例外输入类）；
  `Equal`/对齐断言可重复执行。
- **生命周期**：lifecycle gate 先行（B-1）；closing/closed 期一切 readData（含合法与敌意
  options——gate 先于一切 options 触达，敌意 trap 在停接纳期零执行）同步
  `RUNTIME_READ_DISABLED`；lease released 先行 `NAMESPACE_LEASE_RELEASED`；getStatus
  全生命周期可用（不受本票影响）。

---

## 10. 调用方影响矩阵

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| `NamespaceLease.readData`（registry lease） | 单参代理 | 双重载透传；released 先行 | lease.ts/types.ts/index.ts（§7.5） | lease.ts L276–279 |
| registry 测试替身（`makeRuntime({ readData })`，10 文件） | `readDataOk(value, schema)` 三键 | helper 五键化后自动一致；typed stub 形状锁随公共联合武装（实现漏键 → TS2322 红） | 零源码改动（helper 单点） | registry-open.test.ts L176–186 等；readdata-ok-shape.ts L19–20 注记；消费面 §2.6（10 文件 grep 实测） |
| runtime 既有 readData 契约/负控套件（#273 系） | 恰三键断言（已集中化） | helper 随动五键；value/schema 内容断言零变化继续绿 | 零源码改动 | §2.6；runtime-readdata-schema-projection-red/control |
| `readdata-docs-adr0016-sync-control.test.ts` 行为锚 | 真实装配三键断言（集中化） | 自动五键；文档负控正则不触（SCOPE_DOCS 三文件不在 T3 半径） | 零改动 | §2.7 |
| **`apps/yjs-server` opRead（仓内生产消费方——SA2 N1 补列）** | 单参 `lease.readData(path)`；只读 `ok`/`value`；响应自构 `{ok:true, value}` | 单参 → legacy 重载；成功面加法键（truncated/truncations）被其只读消费面忽略；失败分支零变化 | **无**（root typecheck 14 包含该 app + root test 已覆盖） | apps/yjs-server/src/app.ts L594–615（L609 单参、L610–611 消费面） |
| 直接 `readLogicalValueAtPath` / `resolveSchemaAtPath` 调用方（含 T1/T2 套件） | T1/T2 公共面 | **零变化**（只消费） | 无 | §1 非目标 |
| ReplicationSession raw 读面 / 诊断日志 / wire | 不经 readData | 零改动 | 无 | ADR-0016 L77；SA8 行 15 |
| DSH 部署链（L2 mabf-nomicore-read `depthPerPath`） | 无预算面 | 透传能力就位；接线属范围外跟进 | 无（follow-up 登记 §13） | ADR L137 开放问题 |
| `runtime-acceptance-exports-audit` / `registry-surface` | 值导出键审计 | type-only 加导出不影响运行时 value-key 审计；registry d.ts containment 检查为非穷尽 | 无（预期保持绿） | §2.7 |

---

## 11. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
|---|---|---|
| `packages/namespace-runtime/src/runtime.ts` | readData 双重载实现（§7.2-B-2，含 A-2b 净化失败双出口）、双结果联合与 options 别名（§7.3-C-1）、`canonicalReadOptions`/`seamReadOptionsInvalid`/`echoReadPath` 包内 helper（§7.1-A-2/A-2b/A-2c）、readData JSDoc 五键/预算语义重写、import 增补 | 主接缝组合（决策 4/6）+ F1 修订落点 |
| `packages/namespace-runtime/src/read-schema-projection.ts` | `projectReadDataSchema`/`detachReadSchemaProjection`/`cloneValueSchema`/`cloneValueSchemaRecord` 双重载加宽 + `case 'truncated'`（§7.4）、模块头注预算段 | 投影通道接缝 + 标记处置（SA8 §8-4(b)） |
| `packages/namespace-runtime/src/index.ts` | +3 type-only 导出（§7.3-C-3）；头注形状演进注记 | 公共类型面经 index（模块 AGENTS） |
| `packages/namespace-registry/src/types.ts` | `NamespaceLeaseReadDataBudgetResult`、`NamespaceLease.readData` 双重载、import 增补（§7.5-E-1） | lease 类型别名跟随 |
| `packages/namespace-registry/src/lease.ts` | `leaseReadData` 双重载透传 + 字面量引用 + 2 个新 Equal 锁（§7.5-E-2/E-3） | lease 透传（决策 6） |
| `packages/namespace-registry/src/index.ts` | +1 type-only 导出 | registry index 先例 |
| `packages/namespace-runtime/test/helpers/readdata-ok-shape.ts` | 恰三键 → 五键修订（§7.6-F-1，schema 保持纯面——N3 钉死） | T0 集中单点（AC6） |
| `packages/namespace-runtime/test/helpers/readdata-shape-assertion-scan.ts` | `SUCCESS_SHAPE_KEYS` 五键化 + 头注（§7.6-F-2） | family B 仪器面 |
| `packages/namespace-runtime/test/readdata-shape-assertion-consolidation-gate.test.ts` | 正负样本五键化（§7.6-F-2） | gate 随动（SA8 §8-2） |
| `packages/namespace-runtime/test/runtime-readdata-shape-budget-red.test.ts`（新） | 主缝预算契约红灯（§12-T1，含 F-x 敌意净化面） | AC1–AC5 红绿 + F1 验收 |
| `packages/namespace-runtime/test/runtime-readdata-shape-budget-control.test.ts`（新） | 负控：无 options 逐字节回归锚 + 失败分支形状 + detach 纪律（§12-T2） | AC5 回归锚 |
| `packages/namespace-runtime/test/runtime-readdata-shape-budget-fixture.ts`（新，如需） | 预算 fixture（对齐断言专用数据 + 敌意 options 构造器；避免多引用跨预算构造——T2 §6.10 前提）。**N4 钉死：本新文件复制 `readdata-schema-projection-fixture.ts` 的构造形态（MemoryPersistence + seam），零编辑该既有文件**（该文件由既有 projection-red/control 套件共享，点名入 DENY） | 用例组 D/F-x 前提 |
| `packages/namespace-runtime/test/runtime-readdata-shape-budget.test-d.ts`（新） | 类型面锚（§12-T3） | 零泄漏/五键/重载面 |
| `packages/namespace-registry/test/registry-readdata-budget-passthrough.test.ts`（新） | lease 透传断言（§12-T5） | AC6（既有 registry 测试延伸——新聚焦文件） |
| `packages/namespace-registry/test/registry-readdata-budget-passthrough.test-d.ts`（新） | lease 预算别名/重载类型锚（§12-T6） | Equal 锁面 |

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/doc-runtime/**` | T1 已落（值通道三参/双联合/校验器/**读纪律权威**） | SA8 §8-7：只消费；公共面冻结；F1 修复正是「净化器对齐 T1」而非「改 T1」 |
| `packages/vfsl/**`、`packages/vfsl-protocol/**` | T2 已落 / T4 #337 DeepOptional 面 | 同上；谱系归票 |
| `packages/namespace-runtime/test/readdata-schema-projection-fixture.ts`（**N4 点名**） | 既有 projection-red/control 套件共享的 fixture | 新预算 fixture 只复制其形态、零编辑原文件（§11 ALLOW 括注钉死）；手改会波及既有套件基线 |
| `packages/namespace-registry/test/readdata-docs-adr0016-contract-fixture.ts`、`readdata-docs-adr0016-sync-control.test.ts`、`readdata-docs-adr0016-sync-red.test.ts` | 文档负控（`readDataOptionUsages` 正则） | T5 #338 面（SA8 §8-7）；T3 不触 SCOPE_DOCS 即保持绿 |
| `docs/integration/cordis-plugin-hosting.md`、`.agents/skills/nomicore/typed-access.md`、`docs/integration/external-project-vfsl-codegen.md` | 形状注记/预算纪律文档 | T5 #338 面 |
| `docs/adr/**`、`CONTEXT.md` | 0024 基线与词汇族已同步 | 无新决策；回填批注属 PR #332/T5（SA8 §6 注记） |
| `packages/replication-protocol/**`、`packages/ws-replication/**`、`packages/namespace-diagnostic-log/**`、`docs/protocols/**` | wire/复制/诊断面 | readData 不上 wire、诊断日志不涉及读面（SA8 行 15） |
| `apps/yjs-server/**` | 仓内生产消费方（§2.8/§10——N1） | 单参 legacy 调用 + 只读 ok/value：加法键零影响；本票改动会无必要地扩大破坏面 |
| 既有 readData 行为套件（`runtime-readdata-hostile-path-guard` / `runtime-readdata-schema-projection-red\|control` / `runtime-sync-read-face` / registry 各套件） | 回归网 | 集中化断言自动随动；手改会掩埋回归证据 |
| `packages/namespace-runtime/src/p0.ts`、`sequencer.ts`、`write.ts`、`schema-write.ts`、`replication-*.ts`、`close.ts`、`status.ts` | runtime 其余公共面 | 读面组合不触写/生命周期/复制实现 |

---

## 12. 验收与验证映射（可执行验收计划）

SA1 不编写/运行测试；以下为后续角色可执行的契约与断言规格（红绿 + 负控，#273 打法）。
红灯机理：行为面——当前 readData 忽略第二参、返回三键，五键/预算断言全红；类型面——
`*.test-d.ts` 经 `vitest --typecheck` 红（重载/预算联合不存在）。

### T1 `runtime-readdata-shape-budget-red.test.ts`（主缝预算契约，红）

| 组 | 用例（断言规格） | AC |
|---|---|---|
| A 五键恒形 | 预算读（触发/不触发截断）与无 options 读：`expectReadDataOkKeys(r)`（五键集）；`truncated === (truncations.length > 0)`（B14）；`truncations` 恒 `Array.isArray`；无截断时 `toEqual([])` 且 `truncated === false`（N3 纪律：键集 + 定点断言，不对含标记投影做 `expectReadDataOk` 整形状断言） | AC1 |
| B depth 截断与清单 | 嵌套容器 fixture（Y.Map 嵌 plain/Yjs 混合）：`depth:1` 读 → 被裁键不在 `value` 中（键省略）；truncations 条目 `{path: [...同基, 被裁键], kind:'depth', omitted}`；**尾段即被裁键名**（枚举语义——键名仅清单在场）；`depth:0` → 目标容器同形空容器（`{}`/`[]`）+ 单条 depth 条目 + `value` 键恒在场 | AC1/AC4 |
| C omitted 计数语义 | fixture：被折容器直接子项数 ≠ 后代总数（如 2 子项、每子项 3 后代）→ `omitted === 2`（显式断言非 6）；width：rawTotal 5 保留 3 → 父路径单条 `{kind:'width', omitted:2}`、被裁子键零罗列 | AC4 |
| D 两通道对齐（主缝断言） | 按 T2 §6.10 recipe：走 `schema.valueSchema` 收集标记位（数据路径累进：object 字段名 / array 元素记 `<item>` / union `<member N>` 剥离 / optional 透明 / ref 位即数据位）vs 值通道 `truncations` 中 `kind:'depth'` 条目 path（数字段归一 `<item>`）——**终点子树标记集 ≡ 值 depth 条目位置集**（集合相等，fixture 刻意避免多引用跨预算构造）；闭包体（aliases 值位）标记走弱断言（存在性 ⊆ 引用位裁剪并集）；**敌意/异态键夹具延拓（F1）**：对齐断言在 F-x1/F-x2/F-x3 夹具上同样执行——两通道位置集相等（或整调用响亮 READ_OPTIONS_INVALID，二者必居其一，不得出现「一通道截断、另一通道无标记」的静默分叉） | AC2 |
| E width 对投影无操作 | 仅 `maxChildrenPerNode` 触发的读：`schema` 与同路径无 options 读的 schema `toStrictEqual` **且** `JSON.stringify` 逐字节相等（含 key 序） | AC3 |
| F READ_OPTIONS_INVALID（矩阵 + 差分 + **敌意净化面**） | **基础矩阵**：未知键 / 负数 / 非整数 / `NaN` / `±Infinity` / 非对象（string/number/null）/ 数组 / 类实例（`new Date()`）/ 自定义原型对象 / accessor 键 / 抛错 Proxy（ownKeys/getOwnPropertyDescriptor trap 掷）→ 恰 `{ok:false, code:'READ_OPTIONS_INVALID', path:新鲜回显, message:非空}` 四键（键集断言无 truncated/truncations）；**无 options 调用恒不产生该码**；差分矩阵：runtime 接受集 ≡ `readLogicalValueAtPath(doc,path,opts)` 接受集（单权威证明）；`{depth: undefined}` → ok 五键、零截断、投影与无 options 读 JSON 相等（净化证明——A-2）；`{}` → ok 零截断；**优先级**：非法 path + 非法 options → `PATH_NOT_ALLOWED`；closing/closed + 非法 options → `RUNTIME_READ_DISABLED`（B-1 锚）。**敌意/异态键净化面（SA2 F1 验收——修订后语义钉死）**：<br>**F-x1** 非 enumerable own 键：`Object.defineProperty(o,'depth',{value:7,enumerable:false})` → 五键 ok、`truncations` 空、`truncated === false`、schema 与同路径无 options 读 `JSON.stringify` 逐字节相等（两通道对 T1 键空间同为盲——**钉死语义：对齐成功而非拒绝**；确定性输入零误拒证明）；<br>**F-x2** 继承键污染：临时 `Object.prototype.depth = 7` 调用后还原 → 同 F-x1 断言（own-enumerable 键空间对继承键双盲）；<br>**F-x3** 伪装数据属性 Proxy（`getOwnPropertyDescriptor` 报 data 值 5 / `get` trap 回 1.5）→ 五键 ok、两通道按 **5** 对齐（T1-D 位置集相等）；**负断言**：不出现 `ok:true ∧ schema===null ∧ truncated:true` 组合（ER-1 静默形态）；**零执行锚**：get trap 以调用计数器 Proxy 钉死零调用（零 `[[Get]]` 证明）；<br>**F-x4** 抛错 get trap + 诚实 ownKeys/getOwnPropertyDescriptor trap 的 Proxy → 五键 ok（get trap 从不被执行——与 F-x3 同款零执行锚）、绝不 throw；<br>**F-x5** 状态化 descriptor trap（计数器：首次校验通过、其后 `getOwnPropertyDescriptor` 抛错）→ 恰四键 `READ_OPTIONS_INVALID`（**出口①**：重派发 → T1 单源收编；message 非空、path 新鲜回显）、绝不 throw；<br>**F-x6** 交替 descriptor trap（抛与不抛交替，使净化失败而重派发又成功）→ 恰四键 `READ_OPTIONS_INVALID`（**出口②**：接缝终态成员）、绝不 throw；<br>F-x1/F-x2/F-x3 上 T1-D 对齐断言保持「位置集相等 ∨ 响亮失败」 | AC5 + F1 验收 |
| G 零物化哨兵 | 被截子树内埋 non-finite number / 稀疏数组空洞 → 预算读 `ok:true`（递归未触及；「先全量再裁」退化实现红） | ADR L124 |
| H schema:null 与 always-on | preparing/P0 前读：预算读 `schema:null` + 值通道照常（五键共存）；路径偏离 schema（raw 键）→ `schema:null` | 冻结面 |

（fixture：新预算 fixture 文件 `runtime-readdata-shape-budget-fixture.ts` **复制**
`readdata-schema-projection-fixture.ts` 的构造形态（MemoryPersistence + seam）、**零编辑**
该既有文件——N4 钉死，无双向解读空间；组 D 数据约束 = 无多引用跨预算；F-x 系敌意 options
构造器（计数器/交替 trap/伪装 descriptor）随新 fixture 提供。）

### T2 `runtime-readdata-shape-budget-control.test.ts`（负控，恒绿）

- 无 options 逐字节回归锚：`readData(path)` 的 `value`/`schema` 与独立预言机
  （`readLogicalValueAtPath(doc,path)` 值 + `resolveSchemaAtPath(derived,path)` 投影，#273
  oracle 形态）`toStrictEqual` 且 `JSON.stringify` 相等——信封差异恰为新增两键；
- 失败分支键集：`PATH_NOT_ALLOWED` / `RUNTIME_READ_DISABLED` 恰四键（无 truncated/
  truncations）；敌意 path（Proxy/迭代器重定义/野段）→ `schema:null` 收敛、ok 恒真、零 throw
  （既有 hostile 套件语义在预算模式的对偶采样）；
- detach 纪律（预算）：连续两次同参预算读 → 两结果深度相等但引用互异（含标记 clue 对象）；
  mutation 返回投影（含改写 marker.clue）后重读不受污染；`Object.isFrozen(schema) === false`。

### T3 `runtime-readdata-shape-budget.test-d.ts`（类型面，红）

- 五键探针：`Extract<NamespaceRuntimeReadDataResult, {ok:true}>` 与预算联合同款探针均含
  `truncated: boolean; truncations: readonly ReadLogicalValueTruncationEntry[]`；
- 零泄漏：`Extract<NamespaceRuntimeReadDataResult, {code:'READ_OPTIONS_INVALID'}> extends
  never` 为 true；预算联合同式非 never；
- 失败面无新键：`Extract<预算联合, {ok:false; truncated: unknown}> extends never`；
- 重载面：`rt.readData([])` 类型 = legacy 联合、`rt.readData([], {depth:1})` = 预算联合
  （Equal 探针）；预算成功面 `schema: BudgetedReadDataSchemaProjection | null`；
- 既有 `runtime-readdata-schema-red.test-d.ts`（#273 锚）保持绿（成功成员仍含
  `schema: ReadDataSchemaProjection | null`——五键化后 Extract 探针仍命中）。

### T4 T0 修订面（helper + gate）

- `readdata-ok-shape.ts` 五键化后：`READDATA_OK_KEYS` = 五键字母序；`readDataOk` 产物
  `expectReadDataOkKeys` 自洽（自锚用例）；`ReadDataOkShape.schema` 保持纯面（N3）；
- gate：family A/B 归零保持；正样本含五键字面量（命中）与五元素键集数组（命中）；
  `toMatchObject` / doc-runtime 两键 / 失败分支负样本不命中；**10 个存量消费文件零手改全绿**
  （N2 修正计数；清单 = §2.6：runtime 2 + registry 8）。

### T5 `registry-readdata-budget-passthrough.test.ts`（lease 透传，红→绿）

- stub runtime 捕获 options 实参（引用同一性）：`lease.readData(path, opts)` active 期 →
  runtime 收到 **同一引用**（原样透传锚——raw 直传，无复制/净化泄漏到 lease 层；敌意
  options 构造器直传亦然——lease 层零触达敌意 trap）；
- released → `NAMESPACE_LEASE_RELEASED` 冻结 issue（含 options 调用同途——released 先于
  透传）；
- 真实装配（沿 `readdata-docs-adr0016-sync-control` Cordis 形态或 `makeRuntime` 直构）：
  `lease.readData(path, {depth:1})` 五键 + 截断事实与 runtime 直调逐字段相等；
- 单参 `lease.readData(path)` 仍走 legacy 通道（捕获 stub 断言第二参未传）。

### T6 `registry-readdata-budget-passthrough.test-d.ts`（lease 类型面，红）

- `lease.readData([])` = `NamespaceLeaseReadDataResult`、双参 = `NamespaceLeaseReadDataBudgetResult`
  （Equal 探针）；预算联合含 `NamespaceLeaseReleasedIssue` 成员；零泄漏同 T3。

### 门禁（AC7 / SA8 §8-8）

| 门 | 命令 | 覆盖 |
|---|---|---|
| runtime 包 | `pnpm --filter @nomicore/namespace-runtime test`（或 vitest 定向）+ `tsc -p packages/namespace-runtime/tsconfig.json` | 主缝契约/负控/类型锚/既有套件回归 |
| registry 包 | 同上（namespace-registry） | 透传/别名/公共面审计 |
| root | `pnpm typecheck`（14 包，含 apps/yjs-server）+ `pnpm test`（`vitest run --typecheck`，含全部 `*.test-d.ts`） | 全套包门禁 |

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
|---|---|---|---|
| 五键恒形 | T0 收敛门绿（集中面就位） | T1-A | 两模式恒五键；失败四键 |
| 两通道对齐 | T2 计层规约 + §6.10 recipe | T1-D（含 F-x1/F-x2/F-x3 敌意夹具延拓） | 位置集相等（归一后）或响亮失败 |
| width 投影零操作 | T2 身份短路（resolve L476） | T1-E | 逐字节相等 |
| omitted 语义 | T1 载体计数实现 | T1-C | 直接子项数 |
| READ_OPTIONS_INVALID | T1 校验器 + 双联合 | T1-F 基础矩阵 | 四键失败；无 options 不产生 |
| **敌意/异态 options 净化（F1）** | T1 读纪律（read.ts L326–361）+ 本设计 A-2/A-2b/A-2c | T1-F F-x1～F-x6 + 零执行锚 | 对齐成功（F-x1/x2/x3/x4）或恰四键响亮失败（F-x5/x6）；零 throw；零 `schema:null` 静默组合 |
| 单权威 + 净化 | 本设计 §7.1 | T1-F 差分 + `{depth:undefined}` 用例 | 接受集一致；净化后零投影误拒 |
| lease 透传 | lease.ts 现结构 | T5 | raw 引用直传；released 先行 |
| 无 options 回归 | #273 套件（集中断言） | T2 + 存量套件 | 内容逐字节不变 |
| detach（含标记） | D5 既有实现 | T2 detach 用例 | 全新副本、零冻结 |
| 类型面零泄漏 | read.ts L96–97 注记 | T3/T6 | 条件探针翻转 |

---

## 13. 风险、回滚和残余问题

| 风险 | 等级 | 缓解 |
|---|---|---|
| 重载序敏感（`ReturnType` 锁依赖 legacy 排最后） | 中 | `_readOverloadOrder` 锁 + 探针证据记录（§7.3-C-5-E1/E6）；误排序 → Equal 锁编译红 |
| 预算容器成员值位「静态 ValueSchema / 运行时标记」错位（拷贝器内部） | 低 | T2 `budgetShell` §6.8 公共面 pin 的既有形态；外层重载锁返回面；不外泄 |
| truncations 数组引用透传 | 低 | T1 每调用新鲜累加器（单所有者移交）；无 options 分支新鲜 `[]`（禁共享常量） |
| 对齐断言实现复杂度（归一 recipe） | 中 | fixture 避免多引用跨预算（T2 §6.10 许可）；终点子树精确 + 闭包弱断言分层 |
| **非确定性 descriptor 在两个合法轴值间交替（如 depth 5↔1）**——接缝不可检测（需 T1 暴露 `ValidatedBudget` 内部状态；doc-runtime 新公共 API 违反只消费非目标） | 低（敌意-only：诚实对象与确定性敌意体不可达；可检测漂移面——键集/accessor/值非法/trap 抛——已全部响亮拒绝） | 登记 follow-up 候选（doc-runtime 暴露已校验预算或接受 read-through 回调）；ADR L81 对该输入的完全闭合不在本票伪装解决；F1 验收面（F-x5/F-x6）覆盖可检测子集 |
| A-2c 接缝终态成员是 D1 单源纪律的登记豁免 | 低 | 唯一触发点；返回类型注解 `ReadLogicalValueBudgetFailure`（Extract 单源类型）锁死形状漂移——T1 加必填键即编译红；`echoReadPath` 复用 readDisabled 同款回显纪律；实现复查项（§15） |
| T1/T2 校验规则未来漂移（canonical 假设失效） | 低 | 差分矩阵测试（T1-F）持续锁定「runtime 接受集 ≡ T1 接受集」；canonical 前置条件注释钉死；**净化器读纪律与 T1 `validateReadOptions` 的逐字对应（键空间/descriptor 取值/try 收编三项）以注释互指锚定，T1 演进时本 helper 是唯一需同步复查点** |
| 五键破坏性修订影响未知消费方 | 低 | ADR L69：0.x minor bump + 已知消费方可枚举（仓内测试 10 文件 + apps/yjs-server opRead（§2.8/§10，N1 补列）+ DSH 链）；发布流随动 bump（runtime 0.1.12→0.1.13、registry 0.1.10→0.1.11，非本设计代码面） |

**回滚**：单票 revert 即可（无数据/schema 迁移、无持久化格式变化、无 wire 变化）；T0 helper
五键化与实现同票回滚（集中化的单点优势）。

**残余问题（明确 follow-up，非本票必要条件）**：

- T4 #337：`DeepOptional` 协议类型面（预算读静态值类型——本票 value 保持 `unknown`，
  ADR 决策 7 归 T4）；
- T5 #338：文档负控正则修订、docs/integration 形状注记（恰三键 → 恒五键）、typed-access
  预算纪律条款、ADR 0016/0008 回填批注；
- ADR L137：L2 工具 `depthPerPath` 透传接线（实现落地后的范围外跟进）；
- **非确定性合法值交替的完全闭合**（§13 风险表）：需 doc-runtime 暴露已校验预算（新公共
  API，设计修订流程走 ADR-0003 L46 同款公共契约变更）——独立开票，不阻塞本票。

## 14. 评审修订映射

评审输入：`wiki/raw/task_issue-336_sa2_review.md`（SA2 iteration 0，verdict reject——
1 BLOCKER + 3 MINOR + 1 措辞项）。逐条：

| Finding | 修订位置 | 处理结果 |
|---|---|---|
| **F1（BLOCKER）**：净化器以裸 `[[Get]]` 重读 raw options——(i) 非 enumerable/继承键两通道预算静默错位；(ii) descriptor/get 分叉 Proxy 致错位或 `SCHEMA_OPTIONS_INVALID`→`schema:null` 静默化；(iii) get trap 抛异常裸逃逸；A-2「恒在验收集」「属性读安全」论断失实 | §7.1-A-2（读纪律逐字对齐 T1：`Object.keys` 键空间 (a) + `getOwnPropertyDescriptor` 取值 (b) + try 收编 (c) + 仅在场且合法数才写入 (d)；三触发路径消除论证；两条失实论断原文删除并以修订版不变量替换 (e)）；§7.1-A-2b（响亮出路：出口① 重派发 `readLogicalValueAtPath(doc, path, raw)` → T1 单源收编状态化 trap，零形状复制；出口② `seamReadOptionsInvalid` 接缝终态成员）；§7.1-A-2c（D1 豁免登记 + `ReadLogicalValueBudgetFailure` 类型注解形状漂移锁 + `echoReadPath` 复用 readDisabled 纪律）；§7.2-B-2/B-3（组合体与失败面三来源同形状）；§7.1 备选 (δ)/(ε) 新增否决；§7.7 两行新增否决；§8.2（S2b 净化失败双出口）、§8.3（R3 改写 + R4 新增）；§9（敌意 options 收编全景重述 + 幂等的敌意例外说明）；§12-T1-F **F-x1～F-x6** 敌意净化面（SA2 验收三项全部落地并按修订语义钉死：F-x1 对齐成功〔SA2 所列二选一之第一项〕；F-x3 无静默组合 + 零 `[[Get]]` 执行锚；F-x5/F-x6 恰四键响亮失败绝不逃逸）+ T1-D 敌意夹具延拓 + §12 映射表新行；§13（残余「合法值交替」行 + A-2c 豁免行 + 读纪律互指锚定） | **已落实**。可检测漂移面（键集/accessor 显形/值非法/trap 抛）全部响亮失败为 `READ_OPTIONS_INVALID`，绝不 throw、绝不静默；「合法值交替」的不可检测残余诚实登记（闭合需 doc-runtime 新 API，超本票非目标）并列为 follow-up——非未落实的任务内必要条件，SA2 F1 验收三项（其验收文本明示「按修订钉死的语义二选一」）均以钉死语义覆盖 |
| **N1（MINOR）**：调用方矩阵漏列 `apps/yjs-server` opRead（ADR L69「已知消费方可枚举」不完整） | §2.8（新小节：opRead 锚点 L594–615）；§10（矩阵补行：单参 legacy、只读 ok/value、加法键忽略、所需改动 = 无）；§11 DENY（`apps/yjs-server/**` 点名禁改） | 已补列；无代码改动 |
| **N2（MINOR）**：readdata-ok-shape 消费计数 11 实为 10（gate 消费 scanner 非 shape helper）——T4 验收「N 文件零手改」无法对账 | §2.6（10 文件逐名清单 + grep 实测注记）；§7.6-F-3；§12-T4；§10（替身行同步） | 已修正为 10（runtime 2 + registry 8，SA2 计数经本迭代 grep 复核实一致） |
| **N3（MINOR）**：F-1 未规定 helper `schema` 类型与预算投影的关系（预算整形状断言会编译红） | §7.6-F-1（N3 钉死段：保持纯面 + 否决加宽〔破坏 10 文件 stub 对 legacy 重载可赋值性，E4 单向〕与泛型参数化〔存量零收益〕+ 预算断言纪律：键集 + 定点）；§12-T1-A（纪律入规格）；§7.7（否决表新行） | 已钉死（SA2 所列二选一之第二项：使用纪律）；预算测试编译通过且无 `as any` 逃逸由 §12-T1-A 纪律保证 |
| **N4（MINOR）**：§12-T1「沿用/扩展 fixture 形态」措辞可被读成编辑既有 fixture（越出声明范围） | §11 ALLOW（`runtime-readdata-shape-budget-fixture.ts` 行：复制形态、零编辑原文件）；§11 DENY（`readdata-schema-projection-fixture.ts` 点名）；§12-T1 括注（同款钉死措辞） | 已钉死，无双向解读空间 |

SA2 §14 Non-blocking observations 无需修订项（观测 3/4/5 为认可性注记；观测 1/2 与 F1/N2
一并吸收）。

## 15. 设计后 ADR 冲突复查

**需要（`requiresConflictRecheck: true`）**。理由（与 SA8 §10、SA8 设计后复审 §10 一致；
本迭代修订未缩小该面）：

1. 公共 API 面变更待实现核对：runtime `readData` 双重载签名 + 两结果联合恒五键 + 新公共
   失败码 `READ_OPTIONS_INVALID` + registry lease 双重载签名；
2. SA8 §4 三项正式 override 的落地须逐项复审：失败分支不带新键（B-3）、无 options 逐字节
   回归（T2 锚）、lease 透传不扩大代理语义（E-2 raw 直传 + released 先行）；
3. 两通道截断位置一一对应是跨 T1/T2/T3 的契约级承诺（ADR L81）——组合层（本票）落地时须
   实测核对未漂移（T1-D 对齐断言，含 F1 新增的敌意/异态夹具延拓）；
4. 本设计的钉死项（lifecycle×options 定序 B-1；canonical 净化的「同一预算」语义澄清与
   **T1 读纪律逐字对齐 + A-2b 双出口 + A-2c D1 登记豁免**）虽在 ADR/corpus 授权范围内
   （ADR L30 码位独立与响亮拒绝、L81 对齐承诺、T2 §6.10 明文许可净化——SA2 §14.5 同证
   F1 修复路线「完全落在 ADR-0024 既有授权之内，无新决策需求」），属 SA8 标注「ADR 未钉死、
   需设计钉死」的收口点，应在设计后复查中确认钉死方式无越权——**A-2c 豁免（runtime 构造
   READ_OPTIONS_INVALID 成员的一个触发点）与出口①重派发为实现 diff 的重点核对项**。

无阻塞：全部上游输入在场（简报 + SA8 两产物 + SA2 评审 + T0/T1/T2 落地源码与设计），SA6
契约缺席已按技能规则以 Issue AC + ADR 验收节替代并登记（§5）；F1 修订面收敛在
`canonicalReadOptions`/`seamReadOptionsInvalid` 两个包内 helper 与组合分支上，架构主干
（T1 单一权威 + 接缝净化、双重载零泄漏、lease 原样透传、T0 单点修订）经 SA2 攻击验证成立、
本迭代保持不变。

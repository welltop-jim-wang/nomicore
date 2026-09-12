# SA9 Standards 审查报告 — Issue #335（[shape-budget] T2：投影通道形状预算——解析入口三参化与截断标记）

> SA9（独立 Standards 审查者）standards-review 轮产物。dispatch
> `sa-dc814017-70fb-4873-9d01-dbf97afebb5b`，phase standards-review，iteration 0。
> **Worktree**：`/home/wangjian/nomicore-fix-issue-335`（branch `mabf/issue-335`）。
> **被审对象**：已提交 HEAD `c903ac54b5ff9e18846a0dbb8a08e7e9c73dbd11`
> （`feat(vfsl): add schema projection shape budget`）的 Issue #335 交付 diff——
> 父提交 `ba11f328ae845bf882d131a2098a7afc8dfcc17c`（ADR 0024 基线尾提交，PR #332 支），
> `git diff ba11f32..c903ac5` 本轮亲证：交付面 6 文件 +2422/−38
> （`packages/vfsl/src/resolve-schema-at-path.ts` +443/−38、`src/index.ts` +26/−4 出口块、
> 4 个新测试/夹具文件 1991 行）+ 9 个 wiki/raw 流水线产物。
> 支上早于父提交的 #233/#304/#331 提交属既有阶段集成基线（SA6 §1 同口径），非本票 diff。
> **Issue 评论输入**：dispatch 明示 REST comments 读 = `[]`；简报 §Comments 空、
> SA2 §4 / SA6 §2 同口径——无 Owner 追加要求需并入。
> **输入产物（全部亲读）**：`task_issue-335.md`（简报，What to build + AC1–AC5）、
> `task_issue-335_design.md`（SA1 iteration 1，770 行，Q1–Q9 收口 + §10 ALLOW/DENY +
> §14 复查项）、`task_issue-335_sa2_review.md`（approve；F1–F5 已解决 + N1/N2 观察）、
> `task_issue-335_sa3_impl.md`（iteration 1：SA4 R1 返工 + 四命令门禁证据）、
> `task_issue-335_sa4_review.md`（approve，0 BLOCKER/MAJOR/MINOR 阻断项）、
> `task_issue-335_sa6_contract.md`（approve，G0–G10 + §12.4 矩阵 + §13 红证据）、
> SA8 门禁两份（前置 `task_issue-335_conflict_report.md` clear + recheck=true；
> 实现后 `task_issue-335_implementation_conflict_report.md` iteration 2 clear + recheck=false）、
> `task_issue-335_relevant_decisions.md`、规范基线 ADR 0024 全文、ADR 0016/0003/0019 相关节、
> 根 `AGENTS.md`、`packages/vfsl/AGENTS.md`、`CONTEXT.md` L41–46。
> **审查方式**：独立取证，非结论复用——交付 diff 全量亲读（两 src 文件现行全文 867+422 行
> 逐行 + `git diff` 全文 530 行 + 4 测试文件逐段）；计层矩阵对 #272 夹具独立重放
> （`['assets','img1']` d1/d2、`[]` d1、`['u']` d1/d2 四组推演与实现/测试断言逐格一致）；
> DENY 清单用 `git diff ba11f32..HEAD --stat -- <路径>` 反向亲证（零输出）；
> `.only/.skip/.todo` 精确扫描（4 新文件零命中）；`as any`/`process.env` 扫描（零命中）；
> `readData(` 负控扫描（新文件零命中）；`'truncated'` 于 `derived.ts`/`evaluate.ts`
> 扫描（零命中）；`git diff ba11f32..HEAD --check`（干净）；公共导出面与模块契约逐条对照。
> 未运行测试、未启动服务（SA9 纪律）；零代码/设计/测试改动；零 commit/push/PR；
> 唯一写入 = 本文件。
> **职责面**：只判断实现是否符合仓库 AGENTS、ADR、模块责任、既有架构惯例、单一事实源、
> 生命周期对称性、文件范围与测试质量标准；Issue 需求完整实现归属 SA10。

---

## Verdict

**approve**（`requiresConflictRecheck: false`）

- **0 BLOCKER / 0 MAJOR / 0 MINOR**。交付在 AGENTS 链、ADR 保真、模块责任、架构惯例、
  单一事实源、生命周期对称性、文件范围、测试质量、公共 API 惯例与兼容性九个 standards
  面全部合规（§1–§9）。残留 4 条非阻断观察见 §10。
- 交付 diff 与设计 §10 ALLOW 台账**逐条一致**（§6 亲证）：2 src + 4 新测试路径全部落
  ALLOW；DENY 全清单零触碰（`derived.ts`/`evaluate.ts` 等 vfsl 其余 src、doc-runtime、
  namespace-runtime、namespace-registry、vfsl-protocol、`docs/**`、`CONTEXT.md`、
  既有 8 测试/夹具、`.github`/`vitest.config.ts`/`tsconfig*`/`package.json`）。
- 流程链完整：SA6 契约 approve → SA8 前置门禁 clear → SA1 设计（iteration 1 修订
  F1–F5）→ SA2 approve → SA3 实现（iteration 1 修复 SA4 R1）→ SA8 实现后复审 clear
  （14 项对照 no-conflict 6 + implements-existing-decision 8）→ SA4 approve——无跳级、
  无未决阻断项；SA8 实现后复审已将全部自申报复核项闭合（recheck=false），本轮未发现
  新决策面。

---

## 1. AGENTS.md 链合规

| 规约 | 本轮亲证 | 判定 |
|---|---|---|
| 根 AGENTS「Module guidance：改 `packages/` 前读最近嵌套 AGENTS」 | `packages/vfsl/AGENTS.md` 亲读并逐条对照（下行各表）；docs/AGENTS 不触发（本票 `docs/**` 零 diff） | ✅ |
| vfsl AGENTS「Add public API only through `src/index.ts`」 | 全部新名目（6 类型 `SchemaTruncationClue`/`SchemaTruncationMarker`/`BudgetedValueSchema`/`ResolveSchemaBudgetOptions`/`BudgetedReadDataSchemaProjection`/`BudgetedResolveSchemaAtPathResult` + 1 守卫 `isSchemaTruncationMarker`）经 `src/index.ts` L138–148 唯一出口（diff 亲证）；`BudgetWalk`/`validateBudgetOptions`/`noBudgetWant`/`budgetShell`/`isTruncated` 均模块私有 | ✅ |
| vfsl AGENTS「Public malformed-input paths return discriminated results rather than throwing」 | options 敌意通道 → 判别联合 `SCHEMA_OPTIONS_INVALID`（同步、不抛、path 新鲜副本）；`validateBudgetOptions` 整体 try/catch 收敛抛错 getter/Proxy，不泄漏任何裸异常、不用 InternalError（L355–375）；校验次序 path → options → derived → 游走（L208–250），敌意通道全部先于可信域访问结算 | ✅ |
| vfsl AGENTS「resolveSchemaAtPath 可信域例外：malformed derived → InternalError」 | derived 形状守卫逐字未动（L233–250）；预算分支 ref 缺失经 `Object.hasOwn` 守卫 throw 同文同码 `值树未声明别名: …`（L522–523 ↔ `collectAliasClosure` L792）；预算游走零新增 throw——对象图环经两相防御透传原引用，不发散、不抛（L450–459） | ✅ |
| vfsl AGENTS「synchronous and deterministic」「Stable error codes…compatibility behavior」 | 同步纯函数、零异步；`SCHEMA_PATH_NOT_FOUND`/`SCHEMA_PATH_INVALID` 两码联合与 path 回显一字未动（L117–124）；新码只进**加宽面** `BudgetedResolveSchemaAtPathResult` 三码联合，既有面不可达 | ✅ |
| vfsl AGENTS「Keep IR and derived-schema outputs environment-neutral, JSON-serializable」 | 标记/壳均为普通 JSON 数据；G4.3 断言合法递归别名闭包 JSON 可序列化；环状手造输入的不可序列化性属输入固有（无预算读同构），测试口径如实以引用相等断言 | ✅ |

## 2. ADR 保真

| ADR 决策 | 交付落点 | 判定 |
|---|---|---|
| ADR 0024 L79/L103「解析入口加法三参化；无 options 行为逐字节不变」 | 重载三参化（两参重载在前 L194–202）；`budgeted = options !== undefined` 分支隔离（L220）——无 options（含显式 `undefined`）走既有三步（合成 → `collectAliasClosure` → `sliceDocs`）逐指令运行；#272 14 路径冻结哈希 + M4 23 键基线在负控文件锚定 | ✅ |
| ADR 0024 L77/L115「投影层包装，不扩展 ValueSchema 语义联合；标记携带成员级线索（ref 名优先、无 ref 名时容器 kind）」 | `SchemaTruncationMarker{kind:'truncated', clue}` + 嵌套判别 `SchemaTruncationClue`（`via:'ref'`/`via:'container'`——避免别名恰好命名 `object`/`array` 的二义）；`derived.ts`/`evaluate.ts` 零 diff、`'truncated'` 零命中（grep 亲证）；test-d G1.4 锚 `ValueSchema['kind']` 恰九 kind 且标记不可赋值 | ✅ |
| ADR 0024 L73「闭包随展开层收缩；被裁路径 docs/aliasDocs 省略」 | `BudgetWalk` 单遍历同步收缩：`closureNames` 先登记后访体（递归别名终止镜像既有收集器）、`{depth:0}` 恒不触达别名体（ref 位即标记，不查 `values`）；docs 选键 `want = spine ∪ emitted` 精确匹配（L322–326），标记位及其后代不入 emitted（先裁后 emit + `isTruncated` 剥离 optional 透明包装，L404–413）；毒化三态差分（d0 ok / 浅位 ok / 触达位 InternalError）锚定零越界遍历 | ✅ |
| ADR 0024 L74/L125「width 对投影无操作」 | `maxChildrenPerNode` 校验通过后即弃——`validateBudgetOptions` 只返回 `depth`（L361–371），walk 不接收、不比较、不计数；G6.1/G6.2 逐字节 ≡ 锚定 | ✅ |
| ADR 0024 L81「计层规则：union 透明、ref 终态边界、两通道截断位置一一对应」 | render 全表：object/array 各耗 1 层（`budget-1`）、union 同预算透传且自身永不成标记位、optional 同预算同路径包装保留、enum/pattern/scalar/xml 终态 no-op、ref `budget===0` → ref 位标记携带 ref 名；计层原点 = 路径终点（游走段不进预算，L312–315）。本轮对 #272 夹具独立重放四组（`['assets','img1']` d1 体内双标记/d2 全净、`[]` d1 六标记+`ROOT.notes` 原样、`['u']` d1 `<member 1>.x` 标记/d2 全净 ≡ 无预算）与实现及断言逐格一致 | ✅ |
| ADR 0024 L116「否决 namespace-runtime 层事后裁剪」 | `packages/namespace-runtime/**` 零 diff（反向亲证）；预算全部落 resolver 单遍历 | ✅ |
| ADR 0016 L50–64「解析语义（未列修订条款继续有效）」 | 路径游走段（drillStep 复用 + matchValueCandidate/matchValueNode + keyPattern 四类 fail-closed + InternalError 清单）diff 上下文亲证逐字未动；终点合成形状两分支同构（单候选原样/多候选恰两键合成 union） | ✅ |
| ADR 0016 L65/L69「纯函数同步零 memo；schema 通道 always-on」 | `BudgetWalk` 每调用新建、`inProgress`/`memo`/`closureNames` 全为实例字段调用内局部；无 schema 有无开关 | ✅ |
| ADR 0003 L26–27/L46「ref 按名引用不内联；派生 schema 形状冻结」 | ref 节点原样保留返回（共享节点）或 ref 位标记，从不内联展开；`derived.ts` 零 diff | ✅ |
| ADR 0019 L132–137「三源合并序 field→marker→member 末位；memberDocs 条件稀疏」 | `sliceDocs` 合并序/扫描序/空过滤/稀疏兼容逐字保留（L820–866 现行全文亲读）——仅参数化 `want` 谓词与 `aliasNames` 形参；原谓词逐字抽出为 `noBudgetWant`（L553–570 与基线内联版本逐句比对一致） | ✅ |

## 3. 模块责任与既有架构惯例

| 检查项 | 本轮亲证 | 判定 |
|---|---|---|
| 预算机制归属 vfsl resolver（ADR 0024 决策 5 钉死位） | 全部预算代码落 `resolve-schema-at-path.ts` 单文件 + `index.ts` 出口；无第二改造面 | ✅ |
| 环防御先例一致性 | `BudgetWalk` 两相防御（进入即登记 in-progress、重入透传原引用、完成写表）镜像 `matchValueNode` visited（L638–639）/`collectAliasClosure` visitedNodes（L773–774）「先加后递归、静默终止」纪律；ref 名环仍由不变的路径游走段 inFlight 处置（路径依赖语义零漂移） | ✅ |
| 截断谓词环安全（SA4 R1 修复面） | `isTruncated` 剥离链按节点对象身份去重（L404–413）：重访即「未截断」并终止——与 §6.3.5 透传语义唯一一致推论；无环线性链 visited 恒 miss ⟹ 对既有输出零影响；修复体仅 Set 操作、不可抛、零跨调用状态 | ✅ |
| cast/`any` 纪律 | 交付面 `as any` 零命中；唯一 cast = `budgetShell` 单点桥接（`shell as BudgetedValueSchema`，L383–385）——浅层包装联合的类型面单点，SA4 §4 已核、设计 §6.8 pin 的忠实落地 | ✅ |
| 相似能力对照 | options 校验（封闭形状、own-property、≥0 整数、present-undefined 拒收）与 ADR 0024 L30 readData 主接缝规则集同精神；新码 `SCHEMA_OPTIONS_INVALID` 走 vfsl `SCHEMA_*` 码族先例、不借用 readData 层 `READ_OPTIONS_INVALID`（SA8 §3#7 已裁定接缝分工） | ✅ |

## 4. 单一事实源

| 事实 | 权威源 | 派生面 | 漂移风险 |
|---|---|---|---|
| 类型树/别名表/文档三表 | `derived`（只读） | walk 渲染产物每调用新鲜、零缓存；G3.4/G8.1 锚定 derived 深比较零变异 | 无 |
| docs 切片扫描/合并纪律 | `sliceDocs` 单实现 | 两分支共用同一函数，仅 `want` 谓词分叉——无第二套 docs 后处理 | 无 |
| 无预算闭包收集 | `collectAliasClosure`（既有） | 无预算分支原样调用；预算分支单遍历产出（ADR 钉死选型，非平行重复） | 无 |
| 路径游走语义 | `drillStep` 本体复用 | 零改动 | 无 |

## 5. 生命周期对称性

纯函数，无 acquire/release 面：未新增后台任务/缓存/监听/跨调用状态；`BudgetWalk` 与
`regexCache`（既有局部先例）同为调用内局部，调用结束即弃。回滚面干净（分支隔离——
移除预算分支与出口即回滚，无 options 路径未被触碰）。不适用维度无缺口。

## 6. 文件范围

| 路径 | 设计 §10 台账 | 本轮亲证 |
|---|---|---|
| `packages/vfsl/src/resolve-schema-at-path.ts`（M，496→867 行） | ALLOW 行 1 | ✅ 唯一改造面 |
| `packages/vfsl/src/index.ts`（M，出口块 + 注释） | ALLOW 行 2 | ✅ |
| `test/resolve-schema-at-path-budget-fixture.ts`（新，605 行） | ALLOW 行 3 | ✅ 夹具/oracle/毒化/环构造器 |
| `test/resolve-schema-at-path-budget.test.ts`（新，1011 行/47 用例） | ALLOW 行 4 | ✅ G2–G8 + F1/F2 锚 |
| `test/resolve-schema-at-path-budget.test-d.ts`（新，136 行/8 用例） | ALLOW 行 5 | ✅ G1 类型面 |
| `test/resolve-schema-at-path-budget-control.test.ts`（新，239 行/8 用例） | ALLOW 行 6 | ✅ G0/G8.1 负控 |
| DENY 全域（vfsl 其余 src、doc-runtime、namespace-runtime、registry、vfsl-protocol、`docs/**`、`CONTEXT.md`、既有 8 测试/夹具——逐路径 `git diff --stat` 反向亲证零输出、`.github`/`vitest.config.ts`/`tsconfig*`/`package.json`/`pnpm-lock.yaml`） | DENY | ✅ 零触碰 |
| `wiki/raw/task_issue-335*.md` ×9 | 任务产物面 | ✅ 随交付提交（仓内 mabf 惯例） |

`git diff ba11f32..HEAD --check` 干净；`.scratch/` 仅存无关既有 `vfsl-v1-parser` 目录
（SA3 临时探针已删，亲证）；新测试路径命中 `vitest.config.ts` include 与
typecheck.include 两 glob、包 tsconfig `test/**/*.ts` 覆盖（收集入口亲读）。

## 7. 测试质量

| 检查项 | 本轮亲证 | 判定 |
|---|---|---|
| 断言组覆盖（SA6 G0–G10 → 文件映射） | 63 新用例（47 运行时 + 8 负控 + 8 类型面）：计层矩阵逐格字面量（`BUDGET_MARKER_MATRIX`/`BUDGET_DOCS_MATRIX` 独立 oracle）、闭包精确键集、docs 精确键集 + ⊆ 无预算 + 共享键逐字、width 全值域逐字节、options 非法矩阵 + 敌意 getter/Proxy + 次序三锚、逐字节回归（14 路径冻结摘要 + M4 23 键基线 + `{}`/显式 `undefined`/充足 depth/width-only）、环语义（union 自环/容器 2-环/optional 自环/optional 2-环/合法递归别名/多引用跨预算）、§6.3.4 修正格 | ✅ |
| 红线纪律 | 无 skip/only/todo（精确扫描零命中）；无 env override/fallback（`process.env` 零命中）；无源码字符串/正则断言（全部经 `parseVfsl`→`evaluate`→`resolveSchemaAtPath` 运行时返回结构）；动态接缝（`BudgetSeam`/`vfsl as unknown as …`）保住包 tsc 对红文件零报错——SA6 §12.3 钦定纪律 | ✅ |
| 环用例口径（SA4 §11 观察 5） | 环状输出零 `JSON.stringify`/递归 digest——全部 `toBe` 引用相等 + 定点字段断言；`expectOptionalRingProtocol` 含结算检查（`result === undefined` 即红，强于单纯 not.toThrow） | ✅ |
| 负控真实性 | control 文件不 import 任何预算名目；冻结摘要为 HEAD 录制字面量；G0.2 层结构对账独立推导（不读生产源码）；G4.3 的 parse 对比已与无预算读对账（SA4 观察 2 处置，非恒真） | ✅ |
| 既有回归 | 既有 8 测试/夹具文件零 diff；既有 test-d 的 `parameter(0/1)` 与两参纯度断言在重载下保持绿（两参调用解析第一重载） | ✅ |
| 测试计数自洽 | 651（基线）+ 63 = 714、3588 + 63 = 3651——与 SA3 报告门禁数字算术一致 | ✅ |

## 8. 公共 API 惯例与兼容性

| 检查项 | 本轮亲证 | 判定 |
|---|---|---|
| 加法扩展、无破坏 | 重载两参在前 → 一切既有两参调用合法且类型/行为不变；`ReadDataSchemaProjection` 泛型化缺省实例化 `= ValueSchema` 逐字段同型（test-d G1.2 锚）；既有两码联合 `ResolveSchemaAtPathResult` 一字未动 | ✅ |
| 无预算类型纯度 | 两参结果 `valueSchema: ValueSchema`、`aliases: Record<string, ValueSchema>`（test-d G1.3 含 `@ts-expect-error` 反向锚）；`namespace-runtime` 两参消费 + `cloneValueSchema` 逐 kind 无 default 穷举（`read-schema-projection.ts` L56/L121–181）零改动可编译——该包零 diff | ✅ |
| 显式 `undefined` 语义 | 运行时 ≡ 缺省（G8.2 逐字节锚）；静态取加宽面（第二重载）——设计 §6.8 pin 与 test-d 锚一致 | ✅ |
| 稳定码纪律 | `SCHEMA_OPTIONS_INVALID` 只进加宽面失败联合；既有两码语义/回显/通道不变；码族归属 vfsl `SCHEMA_*`（SA8 裁定的接缝分工） | ✅ |
| 发布依据 | 公共类型面加宽属 ADR 0024 L69 的 0.x minor bump 授权面；`fn.length` 2→3 为加法第三参固有结果（设计 §6.8 尾注如实记录；ADR「签名逐字不变」指调用形态与行为） | ✅ |
| index 出口注释 | L117–147 注释块与实现行为逐句一致（三参语义、计层、标记、校验次序、逐字节承诺、环防御）——无文档发明行为 | ✅ |

## 9. 制品与提交面

- 交付 commit 单一（`c903ac5`）、conventional message（`feat(vfsl): …` 与仓内先例一致）；
  diff 面 = 6 交付文件 + 9 wiki 任务件，无混入无关改动。
- 流水线制品齐备：简报、SA8 前置门禁 + 决议摘录、SA1 设计（iteration 1）、SA2 评审
  （approve）、SA6 契约、SA3 实现报告（iteration 1，含红/绿证据与四命令门禁）、SA8 实现
  后复审（clear，iteration 2）、SA4 审查（approve）——全部随交付提交于 `wiki/raw/`。
- SA3 报告的验证证据（包 tsc、vfsl 40 files/714 tests 0 type errors、root typecheck
  14 project、root 341 files/3651 tests 0 type errors、R1 修复前 exit 124 红证据）以
  命令 + 结果形式内联在案；本角色按纪律不复跑，静态面（diff 算术、行号 anchor、用例
  计数、import 清单）与 SA4 的独立对账一致。

## 10. 非阻断观察（不阻断 approve）

1. **支叠基线**：`mabf/issue-335` 支含 #233/#304/#331 阶段集成提交（父提交 `ba11f32`
   即 ADR 0024 基线尾）——仓内 mabf 阶段集成惯例；本票交付 = HEAD 单 commit，与 SA8
   实现后复审的被审对象一致。
2. **own-枚举键语义**：无 own 可枚举键的对象（如 `new Date()`）作 options 视同 `{}`
   放行——设计 pin 与 readData 先例一致（SA2 观察 4 / SA4 观察 3 均已登记为与先例
   一致项）；Symbol 键/非枚举键同口径不可见。
3. **守卫判别宽松度**：`isSchemaTruncationMarker` 用 `in` 判别、不拒多余键——结构
   判别 pin（SA4 观察 2 登记）；T3 detach 拷贝经此守卫的运行时判别义务已随 SA8
   required action 1 武装。
4. **跨票前提（T3 #336 验收面，非本票缺口）**：归一化 recipe（剥 `<member N>` 段 +
   ref 位对齐）、options 校验规则集对齐（含 present-undefined 拒收）、计层 oracle、
   环语义 oracle 四件已随 SA3 报告「T3 前提交付」交付；闭包体标记按存在性弱断言或
   夹具规避多引用跨预算构造——错位即 ADR 0024 L81 契约违约，归 #336 自有门禁核对。

---

**结论**：交付 diff 在仓库 AGENTS 链、ADR 0024/0016/0003/0019 保真、模块责任、既有
架构惯例（环防御/码族/动态接缝/负控）、单一事实源、生命周期对称性、文件范围
（ALLOW 全落、DENY 零触）、测试质量（63 新用例 + 冻结基线 + 环回归）、公共 API 惯例
与兼容性（重载纯度、码纪律、出口单点）九个 standards 面全部合规；无 BLOCKER/MAJOR/
MINOR。裁决：**approve**。

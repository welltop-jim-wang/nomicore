# SA4 实现静态审查 — task_issue-334（形状预算 T1：载体投影读取三参化与截断省略）

- **Reviewer**：SA4（mabf-sa4，dispatch `sa-48028547-4428-4740-bc06-944ae556cb48`，phase implementation-review，iteration 0）
- **Reviewed subject**：SA3 迭代 0+1 交付态工作区（branch `mabf/issue-334`，HEAD `ba11f32`；`M src/index.ts`(+7)、`M src/read.ts`(+423/−34)、`M test/public-surface-type-guard.test-d.ts`(+15) + 3 个新 `shape-budget*` 测试文件）+ SA3 报告证据
- **审查方式**：纯静态（SA4 纪律：不运行测试/不启动服务/不创建进程）；逐 hunk 亲读 `git diff` 与 `read.ts` 全文 809 行、3 个新测试文件全文、修改的 test-d diff、runner/tsconfig 配置、上游全部固定产物与 ADR-0024 原文
- **Verdict**：**approve**（无 BLOCKER / 无 MAJOR；4 条非阻塞观察见 §12）

---

## 1. Reviewed inputs

| 输入 | 路径 | 状态 |
|---|---|---|
| 任务简报 | `wiki/raw/task_issue-334.md`（AC1–AC5；零评论，comment IDs: none——无 Owner override） | 已读 |
| SA1 设计 | `wiki/raw/task_issue-334_design.md`（§7 决议 A–D、§8 编排、§11 ALLOW/DENY） | 已逐节对照 |
| SA2 设计评审 | `wiki/raw/task_issue-334_sa2_review.md`（approve；O-1/O-2） | 已读并核对落实 |
| SA6 验收契约（迭代 1） | `wiki/raw/task_issue-334_sa6_contract.md`（§12.1–§12.12、B16/R9、§15 A-1/A-2） | 已逐条对照（直接对照面） |
| SA3 实现报告 | `wiki/raw/task_issue-334_sa3_impl.md`（verdict clear；§3 变更面、§6 验证） | 已读并抽查证据 |
| SA8 前置冲突报告 | `wiki/raw/task_issue-334_conflict_report.md`（clear；D-1/D-2/D-3） | 已读 |
| SA8 实现后复查 | `wiki/raw/task_issue-334_implementation_conflict_report.md`（clear；D-3 闭合） | 已读 |
| SA8 决策摘录 | `wiki/raw/task_issue-334_relevant_decisions.md` | 已读 |
| 直接治理 ADR | `docs/adr/0024-readdata-shape-budget.md`（决策 1/2/3/6 + 修订节 + 验收节） | 已亲读关键节 |
| 源码/测试 | `packages/doc-runtime/src/read.ts`（809 行全文）、`src/index.ts`、3 个新测试文件、`public-surface-type-guard.test-d.ts` diff、`vitest.config.ts`、`tsconfig.base.json`/`tsconfig.typecheck.json`/包 tsconfig | 已亲读 |
| 冻结锚完整性 | 4 个冻结读锚文件 `git diff HEAD` 零改动；`packages/namespace-runtime/**` 零 diff | 已核 |

## 2. Verdict

**approve**。核心理由：

1. **无 options 路径逐字节不变（结构性成立）**：SA4 逐 hunk 亲读 `read.ts` diff——`projectYMap`/`projectYArray`/`copyPlainStrict` 的 legacy 分支循环体与 HEAD 逐语句一致（仅线程化 `ctx/d/p` 形参，全部不被读取）；新增逻辑 100% 以 `ctx.budget !== null` 门控；成功构造按模式二/四键分叉（`okUndefined` L287-295、P1 终点 L223-229）；`ReadLogicalValueResult` 成员逐字未动 → `runtime.ts:121` 的 `Extract` 输入不变（namespace-runtime 零 diff 佐证）。
2. **预算语义 B1–B16 逐条落位**（§4 表）；`budgetFold` 对 detached 容器（`doc === null`）`rawTotal := 0` 且零公共 count 读（B16④，短路先于 `v.size`/`v.length`），d ≥ 1 展开/保留仍走现行响亮守卫——与 SA6 迭代 1 裁决零偏移。
3. **options 校验 V1–V6 完整**：G0→OPT→N0 定序（非法 options 在 N0 前短路，零 doc 触碰）、内层 try 收编 Proxy trap、descriptor 读零 [[Get]]/零 accessor 执行/零变异、失败分支恰 `{ok:false,code,path:新鲜回显,message}` 不带预算键、新码只进 budget 联合。
4. **测试面真实且不弱化**：3 个新文件 33+88+7 tests 全部锚定公共接缝 `src/index.js` 可观测行为；无 skip/only/todo；条目多重集断言（R6 纪律）；B16④ 计数器为载体公共面行为观测（§12.9 明示允许的例外）；4 个冻结锚未修改；runner include/typecheck include 静态核实覆盖新路径（SA6 §14 + SA3/SA6 两次实跑佐证发现）。
5. **范围零越界**：diff 恰为 ALLOW LIST 6 项；DENY 面（runtime/registry/vfsl/ADR/CONTEXT/wire/根配置）零触碰。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| AC1 预算递归截断省略正确（depth/width、depth:0 骨架、终态 no-op） | `read.ts` budget 分支（`projectYMap:632-661`/`projectYArray:668-694`/`copyPlainStrict:714-800`）+ `budgetFold:583-597`；测试 S1–S15/S24/S25 | 落实（SA4 逐场景手推 S2–S15/S24/S25 与实现输出一致） |
| AC2 截断事实随结果返回可供 runtime 组合 | 预算成功面恒四键（L224-229、`okUndefined`）；条目三字段 `ReadLogicalValueTruncationEntry`；`truncated === truncations.length>0` | 落实 |
| AC3 零物化哨兵 | 折叠/裁减在槽位枚举层（`break` 先于 `get`；`plainDataSlotKeys` 先裁后读）；S19①–④/S20①–④/S21/NC-1/2/7/8 | 落实（退化实现必红：poison/sparse 在预算边界零接触） |
| AC4 缺席吸收 + 敌意 path 纪律 + 非法 options 新分支 | 导航循环预算盲（仅 `okUndefined(ctx)` 模式化）；`validateReadOptions:326-361` + guards 88 tests 矩阵 | 落实 |
| AC5 无 options 逐字节回归 + 全套门禁 | §2.1 门控三重手段 + 4 冻结锚零改动；S1/S23 两键锚；SA3 报告 root typecheck/test exit 0（341 文件/3717 tests ×2） | 落实（动态复跑归 §11 验证项） |
| SA6 §15 A-1（`budgetFold` detached 短路） | `read.ts:585/589`：`(v as {doc:unknown}).doc === null → {rawTotal:0, empty}` 不读 `size`/`length`；+头注 B16/R9 成文（E10） | 落实，唯一实现 delta 与契约一致（A-2「其余零改动」经 diff 亲核成立） |
| SA2 O-1（目标入口折叠先于 detached 守卫 + 锚） | 折叠前置（`projectValue:538` 先于 detached 守卫 `:548`）；锚 `['holder','ys'],{depth:0}` → `{}` + 空清单 + 计数器 0 | 落实 |
| SA2 O-2（去 `?? ∞` 冗余） | P1 入口 `ctx.budget === null ? 0 : ctx.budget.depth`（L219），legacy 不读 d/p | 落实 |
| Owner 评论 | 简报 §Comments：零评论（comment IDs: none） | 无需落实（正确留空） |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| 决议 A：双结果类型 + 重载（§7.1） | `read.ts:100-131`：`ReadLogicalValueAtPathOptions`/`ReadLogicalValueTruncationEntry`/`ReadLogicalValueAtPathBudgetResult` + 两条重载声明 + 实现签名 `options?` | 形状逐字一致 SA6 §12.1；2 参静态型恰为旧联合（TD1 锚）、3 参恰为 budget 联合（TD2 锚） | — |
| 决议 B：G0→OPT→N0 定序 + `READ_OPTIONS_INVALID`（§7.2） | G0 L136-138（原样）→ OPT L143-150 → N0 L152-156；`validateReadOptions` 判定序（宿主→键→accessor→值域→-0 归一）与设计 §7.2 逐条一致；`optionsInvalid:375-377` | V1–V6 全部落位；`Infinity` 归一化只作内部哨兵不外泄 | — |
| 决议 C：单源贯通式预算递归（§7.3） | 四函数签名加 `ctx/d/p` 尾参（`read.ts:536/632/668/714`）；无平行投影族；`containerBudget` 语义由 `budgetFold`+各载体 budget 分支落成；raw 槽位表逐载体一致（`m.size`/`a.length`/`arr.length`/`plainDataSlotCount`） | F10 满足；B1–B15 逐条核对（B5 含 undefined 值键、B7 前缀先取再吸收、B8 超界零读、B9 ROOT 基路径、B10 尾段键名、B11 父路径单条、B14 不变量） | — |
| 决议 C 附：detached 例外 B16/R9（SA6 迭代 1） | `budgetFold:584-590`；`d≥1` 守卫 `projectValue:548-552` 与 plain 域 `:735-737` 原样 | B16①–⑥ 逐条落位（⑥非容器走终态+现行守卫：`budgetFold` 对 Y.Text/XmlFragment 返 null → 落现行分支） | — |
| 决议 D：兼容策略（§7.4） | 门控/构造模式化/静态零变化三重手段（§2.1 已核）；P1 入口 d/p 按 legacy 折叠传常量/原引用（不读） | 落实 | — |
| 编排状态机 §8.2 | L132-238 与设计伪代码逐阶段对应；E100 兜底原样且预算读下返回 `PATH_NOT_ALLOWED` 成员（V4） | 落实 | — |
| 公共导出面 §8.1 | `index.ts` 仅加法 `export type` ×3；零新值导出（`public-surface-guard.test.ts` 零改动且不触值面） | 落实（F9/T1-6/T1-7） | — |

**设计明确但实现缺失**：未发现。**必要偏离**：未发现。

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| 预算递归 + 截断事实 | doc-runtime 载体投影（ADR-0024 决策 6） | `read.ts` 贯通现有双递归 | 正确 |
| options 校验 | 读域内部（不新增公共校验器） | `validateReadOptions` 非导出 | 正确 |
| runtime 五键组合 | namespace-runtime（T2） | 未触碰（零 diff） | 未越位 |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| 槽位读取纪律 | `readableOwnDataValue`/`readableArrayElement`（descriptor 读零 accessor） | 预算模式保留前缀复用同一助手（`copyPlainStrict:747/783`） | 一致 | 键空间纪律单源 |
| options 宿主判据 | 数据侧 `isPlainRecord`（容忍 plain 中继原型链） | 仅 `Object.prototype`/null 原型 | 有据分野 | 设计 §7.2/SA6 R7 成文（控制面输入封更紧） |
| 失败构造 | `notAllowed`/`safeSpreadPath` | `optionsInvalid` 复用同款 path 回显 | 一致 | R5 仓内先例 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| 截断事实 | 投影递归内单次遍历（`ctx.truncations` 调用级累加） | `truncated = length>0` 构造点派生 | 无（零模块态、零 memo；`grep -E '^(let|var)'` 零命中；S27 身份互异锚） |
| 预算值 | 调用方 options（校验后归一化一次） | `ValidatedBudget` 调用局部 | 无 |

### 生命周期对称性

纯同步读、无 register/dispose/订阅/后台任务；`truncations`/`p`/条目全部调用局部，无清理责任。无不对称面。

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
|---|---|---|---|
| 第二投影递归族 | `projectValue`/`projectYMap`/`projectYArray`/`copyPlainStrict` | ctx/d/p 贯通同族 | 无平行（F10） |
| 第二读入口 / 第二校验管线 / 第二失败通道 | 唯一函数；无既有 options 校验；`PATH_NOT_ALLOWED` 单码 | 重载不加值导出；`validateReadOptions` 内部；新码只进新联合 | 无平行 |

## 6. 文件范围审查

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `packages/doc-runtime/src/read.ts`（M，+423/−34） | 设计 §11 行 1 / SA6 §10 行 1 | 全部生产落点 | 一致 |
| `packages/doc-runtime/src/index.ts`（M，+7） | 行 2 | 加法类型导出 ×3 | 一致（仅 `export type`） |
| `…/test/read-logical-value-at-path-shape-budget.test.ts`（新） | 行 3 | S1–S27 行为验收 | 一致 |
| `…/test/read-logical-value-at-path-shape-budget.test-d.ts`（新） | 行 4 | TD1–TD6 | 一致 |
| `…/test/read-logical-value-at-path-shape-budget-guards.test.ts`（新） | 行 5 | §12.2 矩阵 + V1/V2/V3/V5 | 一致 |
| `…/test/public-surface-type-guard.test-d.ts`（M，+15） | 行 6（仅加法） | 3 新名目导入锚 | 一致（无既有断言改动） |
| `wiki/raw/task_issue-334*.md`（untracked） | 任务固定输入产物 | 流程输入 | 预期在位 |

- `git diff --name-only` 对 namespace-runtime/namespace-registry/vfsl*/docs/CONTEXT.md/vitest.config/tsconfig/package.json：**零命中**（SA4 亲核）。
- 4 个冻结锚（`schema-independent.test.ts`/`.test-d.ts`、`guards.test.ts`、`public-surface-guard.test.ts`）`git diff HEAD` 零改动。
- 零临时物：`packages/doc-runtime` 下无 `.scratch*`、src 下零 `.js`（SA3 §6.5 + SA6 §16 复核；根 `.scratch/` 为仓内既有 tracked 内容，非本任务残留）。

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| 2 参重载返回型 | `runtime.ts:484`（唯一生产消费方） | 重载 1 精确承接；`Extract<ReadLogicalValueResult,{ok:false}>`（runtime.ts:121）输入类型逐字不变 → `NamespaceRuntimeReadDataResult` 零泄漏 | 无 | — |
| 旧三参 `@ts-expect-error` 锚（schema-independent.test-d.ts:44） | 冻结类型锚 | `(derived, doc, [])` 对重载 2 首参不匹配、对重载 1 多参 → 仍编译错误，directive 保持消费 | 无 | — |
| 结果联合结构性别名（schema-independent:81-83、guards:29-31、runtime red test） | 冻结行为锚 | 旧联合不动 → 别名不动；锚零改动且 SA3 报告全绿 | 无 | — |
| `public-surface-guard.test.ts` 值面 | surface guard | 零新值导出；文件未改 | 无 | — |
| registry lease / wire / persistence | 间接 | 零 diff | 无 | — |
| T2 runtime 组合面（未来） | — | 四键成功面 + `READ_OPTIONS_INVALID` 隔离在新联合，机械加法可行 | 无 | — |

未覆盖调用方：**无**（全仓 grep 亲核：生产 2 参唯一 `runtime.ts:484`；`vfsl/src/index.ts:86` 注释；其余为测试）。

## 8. 错误、恢复与并发

| 检查项 | 结论 |
|---|---|
| 静默失败/伪装成功 | 无：options 域缺陷响亮进新码（88 矩阵 tests）；路径缺陷不被 options 掩盖（NC-4/S18）；保留物化的不可表示值仍响亮失败（S21/NC-2/NC-8） |
| 零 throw | 校验总函数整体内层 try（Proxy `ownKeys`/`getOwnPropertyDescriptor`/`getPrototypeOf`/`get` trap 全收编，guards V3 四例 + get trap 计数 0 证明零 [[Get]]）；E100 顶层兜底原样；`safeSpreadPath` 敌意 path 收编（S18） |
| 零副作用 | options 前后深等 + own 键集不变（guards V3）；零 doc 触碰（V2 三例 + 对照自证有判别力）；INV-R9 零写零事件 |
| 并发/幂等 | 无共享可变态；同输入深等、身份互异（S27）；突变返回值/条目/调用方实参不影响后续读（S27） |
| fail-fast 单错 | 投影中途失败透传单 `PATH_NOT_ALLOWED`，失败面不带截断键（`expectNotAllowed` 断言） |
| 循环引用 plain + 有限 depth | 折叠先于无限递归 → 成功（设计 §7.3 已成文，legacy 路径仍 E100 不变）；无回归面 |
| 静默无法确认项 | 深层链式（数万层）栈行为——环境敏感观察项，不进门禁（SA6 §7 同款），入 §11 |

## 9. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| `shape-budget.test.ts`（33 tests：S1–S27 + NC-1 + S19④ + O-1） | 值形状/proto/own 键集恰四键；条目 (path,kind,omitted) 多重集；B14 不变量；恒在场；零物化哨兵（poison/sparse/detached + B16④ own accessor 计数器=0）；S24 显式 `!== 后代总数`；S26 `hasOwn===false`；S27 身份互异/突变隔离 | 根 `vitest.config.ts` include `packages/*/test/**/*.test.ts`（SA4 静态核实；SA6 §14 探针 + SA3/SA6 实跑佐证） | 无 skip/only/todo；条目序按多重集（R6）；Y.Map 前缀现场派生（S12）；断言全走 `src/index.js` 公共接缝；B16④ 计数器为载体公共面行为观测（§12.9 允许例外） | — |
| `shape-budget-guards.test.ts`（88 tests） | §12.2 全矩阵（30 非法 ×2 + accessor ×3 + 键空间 + 9 合法 + 宿主 + -0 + 敌意 Proxy ×4）+ V1 定序（G0 优先/合法 path+非法 options）+ V2 零触碰（fresh/既有/对照自证）+ V3 零变异 + V5 path 新鲜回显 + NC-4/NC-5 | 同上 | 无弱化；负例 `@ts-expect-error` 不适用处用运行时 cast（编译期负例由 TD4 承接，分工正确） | — |
| `shape-budget.test-d.ts`（7 tests：TD1–TD6） | 重载解析恰型、封闭形状 7 负例自反转、参数个数（1/4 参/显式 undefined）、新名目导入投影 | typecheck include `packages/*/test/**/*.test-d.ts` + `tsconfig.typecheck.json` include `packages/*/test/**/*.ts`（含 `.test-d.ts`；`exactOptionalPropertyTypes` 在 `tsconfig.base.json` 亲核在位——TD4 `{depth:undefined}` 负例前提成立） | 无弱化 | — |
| `public-surface-type-guard.test-d.ts`（+15，加法） | 3 新名目可导入（TS2305 机制）+ 基本投影 | 既有 typecheck 入口 | 仅加法，无既有断言改动 | — |
| 4 个冻结锚 | 无 options 逐字节回归（75 tests + runtime 负控两键锚） | 既有入口 | 未修改、未弱化（git 零 diff 亲核） | — |
| E5 变异 m3–m6 | 静态可杀性：m3（omitted=后代数）→ S24 `omitted!==4` 红；m4（条件在场）→ S7 hasOwn 锚红；m5（truncated 恒 false）→ S2 红；m6（借路径码）→ guards NC-5 红 | —（SA4 不运行） | 动态「施加→红→还原→绿」仪式仍待 SA7/Controller（SA3 已备 m1/m2/m7/m8；SA8 §7 已注明归属） | — |

SA6 红灯断言保持：S19④ 计数器/条目断言与 O-1 由 SA6 迭代 1 落成后未被改动（本轮 SA3 仅改头注，diff 亲核）。

## 10. Required revisions

无 BLOCKER、无 MAJOR finding。

| Finding ID | Severity | Evidence | Problem | Required change | Acceptance | Suggested routing |
|---|---|---|---|---|---|---|
| —（空） | — | — | — | — | — | — |

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| 全量门禁最终态复跑（root `pnpm typecheck` / `pnpm test`） | SA7/Controller（CI） | typecheck exit 0；`vitest run --typecheck` 全绿（SA3 报告 341 文件/3717 tests ×2 为基线） | 任何红或 type error |
| E5 m3–m6 变异仪式（施加→红→还原→绿，逐条记录） | SA7/Controller | m3→S24 红；m4→S7/S15 红；m5→S2 红；m6→guards NC-5 红；还原后全绿（静态可杀性已核，见 §9） | 任一变异不被击杀 |
| yjs 升级下 detached 语义稳定性（S19④ 依赖 13.6.32 的 prelim 行为） | CI（依赖升级时） | 夹具前置断言 `detachedMap.doc === null` 先行失败（响亮），非静默漂移 | 升级后夹具前置红而实现断言假绿 |
| 深层链式（数万层容器嵌套 + 大有限 depth）栈行为 | 环境敏感观察（非门禁） | RangeError → E100 收编为 `PATH_NOT_ALLOWED`（与 legacy 同款），不外抛 | 外抛或挂起 |

## 12. Non-blocking observations

| ID | 观察 | 建议 | 不阻断理由 |
|---|---|---|---|
| SA4-O1 | B7「被保留的 undefined 值键仍被吸收但占保留额度」的组合场景（undefined 值键落在 width 前缀内）无专属测试：S16 只测导航吸收（无 width），S12/S13 只测 width（无 undefined 值键）。实现侧正确（`plainDataSlotKeys` 含 undefined 值 data 键 + Y.Map 分支 `i++` 先于吸收 `continue`） | T2 消费面落地时可在组合测试中补一条（Y.Map 含 undefined 值键 + `maxChildrenPerNode` 恰含该键的前缀） | SA6 S 清单同样未钉死该组合；实现语义经代码亲核正确；S26 的「值内无 undefined 在场键」不变量已从输出侧覆盖 |
| SA4-O2 | `plainDataSlotKeys` 与 `plainDataSlotCount` 是同一过滤规则的两份实现（count ≡ keys().length），存在轻微规则漂移面 | 可让 count 复用 keys（或内联单函数）；纯内部助手 | 两者同 diff 引入且逐行一致；无行为差异 |
| SA4-O3 | `read.ts` 头注已扩至 50 行（预算段 18 行）；条目/预算语义同时存在于头注、类型 JSDoc 与 `budgetFold` 注释三处 | 后续 T2/T5 docs 收口票时同步 N-2 词条即可，头注保持现状 | E10 要求口径成文已满足；文档债 N-1/N-2 已登记为非 T1 义务 |
| SA4-O4 | `validateReadOptions` 中「未知键检查先于该键 descriptor 读」使未知 accessor 键连 descriptor 都不读（比契约「accessor 键非法且不执行」更紧一层，零可观测差异） | 无需动作（记录为实现自由度） | 两条路径均满足响亮拒绝 + 零执行；guards 断言两族均绿 |

## 13. requiresConflictRecheck

**不提交（false）**。本轮未发现新的 ADR 冲突风险：实现零偏移采纳 SA6 §12 全部钉死口径（含迭代 1 B16/R9 裁决）；SA8 实现后复查已按 D-3 逐项闭合（clear）；SA4 静态审查未打开任何新决策面。

—— 审查结束 ——

# SA3 Implementation Report — Issue #335 `[shape-budget] T2: 投影通道形状预算——解析入口三参化与截断标记`

- 派发：`sa-6e21aaf6-e607-4367-b2e4-eba21ef21647`（role `mabf-sa3`，phase `implementation`，iteration 1）
- Worktree：`/home/wangjian/nomicore-fix-issue-335`（branch `mabf/issue-335`，基线 HEAD `ba11f328ae845bf882d131a2098a7afc8dfcc17c`）
- 本轮任务：修复 SA4 R1（MAJOR，`wiki/raw/task_issue-335_sa4_review.md` §9）——`isTruncated` 的 optional 剥离循环对手造
  optional 自引用环/2-环不终止；并按 SA4 R1 Acceptance 补 optional 环夹具与回归断言。**无 Issue 评论可吸收**（Host 明示 REST
  comments 为 `[]`）。上游（iteration 0）实现与测试均已落盘，按技能「已有未提交实现 = 当前待修订状态」原位修订。
- 上游：任务简报 `wiki/raw/task_issue-335.md`；批准设计 `wiki/raw/task_issue-335_design.md`（iteration 1）；
  SA2 评审 `wiki/raw/task_issue-335_sa2_review.md`（approve）；SA6 契约 `wiki/raw/task_issue-335_sa6_contract.md`；
  SA8 前置门禁 `task_issue-335_conflict_report.md`（clear）与实现后复审 `task_issue-335_implementation_conflict_report.md`
  （clear；R1 为**实现层缺陷**、非新 ADR 冲突面，SA4 明示 `requiresConflictRecheck=false`）；
  SA4 实现静态审查 `task_issue-335_sa4_review.md`（reject → implementation）。
- 裁决：**本轮 R1 已修复且新回归绿；不提交 `reject`。**

## Inputs consumed

| 输入 | 用途 |
|---|---|
| `wiki/raw/task_issue-335.md` | Issue 正文「What to build」+ AC1–AC5 |
| `wiki/raw/task_issue-335_design.md` | 唯一实现蓝本；本轮重点 §6.3.5（环语义规约：终止性硬约束/透传语义/测试断言口径）、§7.4.3（`{}` 恒等域覆盖手造环状输入）、§10（ALLOW/DENY）、§11（环防御验收行） |
| `wiki/raw/task_issue-335_sa2_review.md` | F1–F5 落实核对 + N1（emit 谓词对 optional 包装精度）/N2 处置 |
| `wiki/raw/task_issue-335_sa6_contract.md` | §12.2 G0–G10、§12.3 四文件清单（**仅此四路径属 ALLOW 测试面**）、§12.6 四命令门禁、§13 红证据 |
| `wiki/raw/task_issue-335_sa4_review.md` | **本轮返工依据**：§9 R1（MAJOR）Evidence/Required change/Acceptance 逐条；§11 非阻断观察 2/5/6（本轮顺手处置 2/6，5 为新增用例纪律） |
| `task_issue-335_conflict_report.md` / `_relevant_decisions.md` / `_implementation_conflict_report.md` | 冻结面与越界禁令；实现后复审 clear（R1 不触发新冲突面） |
| 母法 | `docs/adr/0024-readdata-shape-budget.md` L26–31/L69–83/L97–105/L114–118/L120–131；ADR 0016/0003/0019 |
| 模块契约 | `packages/vfsl/AGENTS.md`（公共 API 只经 `src/index.ts`；可信域 throw 例外；同步确定性；格式/契约稳定） |
| 既有源码/测试 | `packages/vfsl/src/resolve-schema-at-path.ts`；`test/resolve-schema-at-path-budget{,-fixture,-control}.test.ts`、`-budget.test-d.ts`；既有 8 回归文件（只读） |

## Existing worktree reconciliation

- 进入时 `git status --porcelain`：iteration 0 的未提交实现（2 src 改动 + 4 新测试/夹具）与 9 枚任务件在树；无第二轮实现报告。
- 对账结论：iteration 0 交付与批准设计/SA6 契约主体一致（SA4 §3–§7 逐项确认），**唯一待修 = R1**。本轮：
  1. 原位修复 `isTruncated` 环安全（不重写其余预算逻辑，不触公共面/类型面）；
  2. 按设计 §6.3.5 测试口径补 optional 自环/2-环夹具与四态回归断言；
  3. 处置 SA4 §11 观察 2（G4.3 恒真断言）与观察 6（G2.2/G2.3 digest 基锚字面）两处 MINOR；
  4. 临时探针 `.scratch/probe-335-r1.ts` 用完删除（见 §16 类清理）。
- 未发现与设计冲突的残留实现，无需回退 iteration 0 的其它改动。

## SA4 R1 返工落实（本轮核心）

| Finding | Severity | Required change（SA4 §9 原文要点） | Implementation | Result |
|---|---|---|---|---|
| **R1** `isTruncated` 对手造 optional 自引用环不终止（`while (current.kind === 'optional') current = current.value;` 无环防御；object 字段位/array `<item>`/union 成员位三调用点均可达） | MAJOR | 使截断判定对环状输入安全（剥离循环按节点身份加 visited 集、重访即视为未截断并终止——或等价的事前标志方案）；**不得**拒收输入或新增 throw；同步补设计 §10 钦定的 optional 环夹具（纯自环 + optional 2-环）与断言：`{depth:0}`/`{depth:N}`/`{}`/width-only 四态终止且 ok、无裸异常、`{}` 与无预算读**引用级**同构、重复调用逐引用确定；既有断言不得回退 | `packages/vfsl/src/resolve-schema-at-path.ts` L392–413：剥离循环改「按节点对象身份去重」——`stripped` 集重访即 `return false`（未截断）+ 终止；函数 JSDoc 记录环安全论证与「不拒收/不新增 throw」。无环输入剥离链每节点至多出现一次 ⟹ 对既有输出零影响（`array`/`object`/`union` 三调用点语义不变）。夹具新增 `optionalRingDerived()`（纯自环）与 `optionalTwoCycleDerived()`（`a→b→a` 2-环），两者同一骨架 `optionalRingSkeleton`：环位同时落 object 字段值位 `x` / array `<item>`（`arr`）/ union 成员位（`u`），并经 `ref:'RingAlias'` 进入闭包体（体内含同环）——**三个调用点 + 闭包体内环位全覆盖**。测试新增 `expectOptionalRingProtocol()` 与两条 SA4 R1 用例（F1 锚） | **已修复**：`{}`/`{depth:N≥2}`/width-only/显式 `undefined` 与无预算读 `valueSchema` 引用相等、闭包条目引用相等；`{depth:0}` ROOT 单标记；`{depth:1}` 有界壳中环位透传原引用、array/ref 位标记；四态均结算 ok、无裸异常；重复调用逐引用确定。计划语义范围内未改任何无环 optional 输入输出（714 用例 + root 门禁绿） |

### R1 修复前后（代码层）

```ts
// 修复前（iteration 0）：环上无限循环
function isTruncated(node: BudgetedValueSchema): boolean {
  let current: BudgetedValueSchema = node;
  while (current.kind === 'optional') current = current.value;
  return current.kind === 'truncated';
}

// 修复后（iteration 1）：按节点身份去重；重访 = 未截断（环位透传原引用、环上无标记）
function isTruncated(node: BudgetedValueSchema): boolean {
  let current: BudgetedValueSchema = node;
  const stripped = new Set<BudgetedValueSchema>();
  while (current.kind === 'optional') {
    if (stripped.has(current)) return false; // 透明环重入：透传原引用、环上无标记
    stripped.add(current);
    current = current.value;
  }
  return current.kind === 'truncated';
}
```

语义论证（与设计 §6.3.5 一致）：透明环（optional 自引用）任意预算下首次重入即透传原引用，环上**不可能**存在标记；
剥离链进入环即证明该位未被裁 ⟹ `false` 是唯一正确且可终止的判定。无环剥离链是线性链，节点至多重访一次，visited 集
不改变任何既有判定。修复不改变输入域（不拒收）、不新增 throw（对象图环不在可信域 `InternalError` 清单内）、不引入
跨调用状态。

### SA4 §11 非阻断观察处置

| 观察 | 处置 |
|---|---|
| 2（G4.3 一处恒真断言 `toEqual(JSON.parse(JSON.stringify(result)))` 自比） | **已处置**：改为与无预算读的 parse 对比（`resolveSchemaAtPath(derived, [])`），非恒真；紧邻 stringify 等价断言保留 |
| 5（`collectMarkers`/`collectKinds` 无环防御；环用例禁用 stringify/递归 digest） | **已遵守**：新增环用例全部引用相等/定点字段断言，零 `markerDigest`/`collectKinds`/`JSON.stringify` 作用于环状输出 |
| 6（G2.2/G2.3 两处 `markerDigest(d1, 'ROOT')` 基锚字面不精确） | **已处置**：改为 `ROOT.${String(path[0])}`（期望仍为空集，纯字面精度） |
| 1/3/4（浅层包装静态可见性 / `in` 判别 / Date 型 options） | **记录不处置**：均为设计 pin 或既有语义一致项，非实现偏差，无代码动作 |

## Changed paths（本轮 delta；iteration 0 主体见下节）

| Path | Design section | Change |
|---|---|---|
| `packages/vfsl/src/resolve-schema-at-path.ts` | §6.3.5（终止性硬约束）、§7.3（`isTruncated` 谓词） | `isTruncated` 剥离循环加按节点身份的 visited 集（重访 → 未截断 + 终止）+ JSDoc 环安全论证；净 +11 行（JSDoc +6、函数体 +5；其余预算逻辑零改动，文件 856 → 867 行） |
| `packages/vfsl/test/resolve-schema-at-path-budget-fixture.ts` | §10 ALLOW 行 3、§11 环防御行 | 新增 `optionalRingDerived()`（纯 optional 自环）、`optionalTwoCycleDerived()`（optional 2-环）、骨架 `optionalRingSkeleton`（环位覆盖 object 字段/array `<item>`/union 成员 + 闭包体内环）与 `OPTIONAL_RING_FIELDS`；文件头注补 optional 环夹具面（+55 行） |
| `packages/vfsl/test/resolve-schema-at-path-budget.test.ts` | §10 ALLOW 行 4、§11 环防御行 | 新增 `fieldValue`/`ringField` 取位辅助、`OPTIONAL_RING_PROBE_OPTIONS` 四态探针、`expectOptionalRingProtocol` 回归协议与两条 SA4 R1 用例（自环/2-环）；处置观察 2/6；文件头注补 R1 回归说明（+129 行，47 用例） |
| `.scratch/probe-335-r1.ts`（临时） | 非交付物 | R1 红/绿诊断探针；**已删除**（`git status` 无残留） |

iteration 0 主体改动（仍在树、未变）：`packages/vfsl/src/index.ts`（公共出口 6 类型 + 1 守卫 + 注释块）与
`resolve-schema-at-path.ts` 的预算 walk/标记/闭包/切片/options/重载；`resolve-schema-at-path-budget{,-fixture,-control}.test.ts`
与 `-budget.test-d.ts` 四新文件。既有 8 回归文件一行未改。

## SA2 Finding落实（iteration 0 起持续成立）

| Finding ID | Implementation | Result |
|---|---|---|
| **F1（MAJOR）** 环防御须终止且不发散 | `BudgetWalk.walk` 两相防御（memo → inProgress 透传原引用 → 渲染 → 移出 → 写表）；**R1 修复后**配套的 `isTruncated` 亦环安全（本轮新增可选环断言） | 已落实；union 环/容器环/递归别名既有断言 + optional 自环/2-环新断言全绿；无 `RangeError`/`TypeError` 裸异常 |
| **F2（MAJOR）** enum 成员注释键等价 | `render` enum 行补 emit `${path}.<member i>`；docs 选键保持精确匹配；M4 逐字节差分锚 | 已落实（选项 b） |
| **F3（MINOR）** 伪代码顺序 + ref 守卫 | 容器/数组 `budget === 0 → MARKER` 先行；ref 分支 `Object.hasOwn` + 同文 `InternalError` | 已落实 |
| **F4（MINOR）** ALLOW∩DENY 空 | 本轮改动仍只落 ALLOW 四测试面 + 2 src；DENY 零触碰 | 已落实 |
| **F5（MINOR）** 跨票 options 规则集前提 | 记录于本文「T3 前提交付」 | 已落实 |
| **N1（MINOR）** emit 谓词精度 | `isTruncated` 剥离 optional 包装判被裁；**其环安全性即 SA4 R1，本轮修复** | 已落实 |
| **N2（MINOR）** 完成表串染表述 | 无代码动作（设计已明文免责） | 记录 |

## File scope check

`git status --porcelain`（tracked + untracked 交付面）：

| Changed path | ALLOW entry | Purpose |
|---|---|---|
| `packages/vfsl/src/resolve-schema-at-path.ts`（M） | ALLOW 行 1 | 唯一改造面（含本轮 R1 环安全修复） |
| `packages/vfsl/src/index.ts`（M） | ALLOW 行 2 | 公共面出口（iteration 0；本轮零改动） |
| `packages/vfsl/test/resolve-schema-at-path-budget-fixture.ts`（新） | ALLOW 行 3 | 夹具/oracle/毒化与环构造器（含本轮 optional 自环/2-环） |
| `packages/vfsl/test/resolve-schema-at-path-budget.test.ts`（新） | ALLOW 行 4 | G2–G8 + F1/F2 锚（含本轮 SA4 R1 四态回归） |
| `packages/vfsl/test/resolve-schema-at-path-budget.test-d.ts`（新） | ALLOW 行 5 | G1 类型面（本轮零改动） |
| `packages/vfsl/test/resolve-schema-at-path-budget-control.test.ts`（新） | ALLOW 行 6 | G0 + G8.1 负控（本轮零改动） |

DENY 核对：`derived.ts`/`evaluate.ts`/`validate-patch.ts`/`resolve.ts`/`pattern.ts` 及其余 vfsl src、`packages/doc-runtime/**`、
`packages/namespace-runtime/**`、`packages/namespace-registry/**`、`packages/vfsl-protocol/**`、`docs/**`、`CONTEXT.md`、
`packages/vfsl/AGENTS.md`、既有 8 测试/夹具、`.github/**`、`vitest.config.ts`、`tsconfig*.json`、`package.json` **零改动**。
`git diff --check` 通过；`.scratch/` 临时探针已删除（`git status` 无 `.scratch/probe-335-r1.ts`）。

## Verification

| Command | Result | Evidence |
|---|---|---|
| **红·R1 复现（修复前，可选自环用例）** `timeout -k 5 60 env NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/vfsl/test/resolve-schema-at-path-budget.test.ts -t "optional 自环" --typecheck.enabled=false` | **exit 124**（外部 timeout 强杀：用例不结算 = 挂起） | 修复前 `isTruncated` 在环上无限循环；vitest 自身 timeout 无法中断同步死循环，故以外部 `timeout` 呈现红（SA4 R1 Acceptance 明示「挂起以测试超时呈现亦可接受为红」） |
| **红·R1 复现（修复前，2-环用例）** 同上 `-t "optional 2-环"` | **exit 124** | 同上（`a → b → a` 剥离链亦不终止） |
| **红·R1 最小探针（修复前）** `timeout -k 5 15 env NODE_OPTIONS=--conditions=nomicore-source pnpm exec tsx .scratch/probe-335-r1.ts` | **exit 124**；stdout：`[self-cycle] no-budget ok=true` → `calling {depth:1} ...` 后无输出 | 精确对照：同一派生物无预算读 ok（既有路径），预算读 `{depth:1}` 不返回——缺陷定位在预算通道截断判定，非夹具/环境 |
| **绿·最小探针（修复后）** 同一命令 `timeout -k 5 30` | **exit 0**；`[self-cycle] budgeted ok=true`；`[two-cycle] budgeted ok=true` | 两型环预算读结算且 ok |
| **绿·SA4 R1 回归用例** `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/vfsl/test/resolve-schema-at-path-budget.test.ts --typecheck.enabled=false` | **exit 0；47/47 passed**（iteration 0 为 45；+2 新用例） | 四态终止/ok、无裸异常、`{}`/充足 depth/width-only/`undefined` 引用级同构（valueSchema 与闭包条目 `toBe`）、`{depth:0}`/`{depth:1}` 形态与标记、重复调用逐引用确定 |
| **包 typecheck** `pnpm exec tsc -p packages/vfsl/tsconfig.json` | exit 0（覆盖 `src/**` + `test/**`，含新夹具/用例） | 无输出（0 error） |
| **包门禁（设计 §12.6 第 2 条）** `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/vfsl/test --typecheck --passWithNoTests=false` | **exit 0；40 files / 714 tests passed；Type Errors: no errors**（61.94s） | iteration 0 基线 40/712 → +2 新用例；既有 #272/#308/pattern 契约与负控全绿（既有文件一行未改）；test-d 类型面零错误 |
| **目标文件 + 负控复核** `... vitest run packages/vfsl/test/resolve-schema-at-path-budget.test.ts packages/vfsl/test/resolve-schema-at-path-budget-control.test.ts --typecheck` | exit 0；**55 passed（47 + 8）**；Type Errors: no errors | 负控 G0/G8.1 摘要未漂移（无预算行为零变化） |
| **root typecheck（设计 §12.6 第 3 条，G9.2）** `pnpm typecheck` | **exit 0**（14 project） | `namespace-runtime` 两参消费 + `cloneValueSchema` 逐 kind 穷举编译通过 = 无预算类型纯度未破 |
| **root test（设计 §12.6 第 4 条，G9.3）** `pnpm test` | **exit 0；341 files / 3651 tests passed；Type Errors: no errors** | iteration 0 基线 341/3649 → +2 新用例；全仓回归绿、新文件被收集、无 skip/only |
| **改动面门禁（G9.1）** `git status --porcelain` + `git diff --check` | 仅 ALLOW 2 src（本轮只动 1）+ 4 新测试面；无 docs/其他包/配置改动；无空白错误 | 见上「File scope check」 |

### 回归保持核对（R1 修复不得改变 optional 无环输入既有输出）

- G2.2 optional 透明孪生（`['opt']`/`['req']` d0 被裁、d1 全净 + docs 键）绿；
- 预算夹具 docs 精确键集矩阵（`[]` d1 的 `ROOT.config` 不入选、脊柱键保留 pin）绿；
- #272 14 路径冻结摘要 + M4 23 键基线（负控）绿；
- 全量 714 用例（含 #272/#308 契约、pattern 错误、类型面）绿。

## T3 前提交付（设计 §6.10 Q9/G10，写入 T2 实现说明）

1. **归一化 recipe（G10.2，T3 #336 差分验收用）**：同一预算下比对「值通道 `truncations[].path` 集合 ↔ 投影标记路径集合」前，
   投影侧两步归一——(i) 剥离 `<member N>` 段（union 透明，成员位多重标记收敛到宿主数据位）；(ii) ref 位对齐（保留 ref ⟹ 值侧
   已展开一层；ref 位标记 ⟹ 值侧该容器折叠）。闭包体内标记锚定别名名，按首发现预算渲染一次（S4 pin），T3 差分应锚定终点子树
   标记的逐位对应，闭包体标记按存在性弱断言或夹具规避多引用跨预算构造。
2. **跨票 options 校验规则集对齐前提（F5）**：resolver 合法性规则集 = `{depth?, maxChildrenPerNode?}` 封闭形状、own-property
   语义、在场键须 ≥0 整数、已知键 present-undefined → 非法；T1/T3 须采纳同一规则集或在接缝显式净化后再进入本层第二道门。
3. **计层 oracle 可复用**：预算夹具（`BUDGET_MARKER_MATRIX`/`BUDGET_DOCS_MATRIX`）+ 控制件 G0.2 层结构字面量对账；
   §6.3.4 `['u']` d2 修正格由「§6.3.4 矩阵修正锚」独立锚定。
4. **环语义 oracle（本轮补强）**：`optionalRingDerived`/`optionalTwoCycleDerived` + `expectOptionalRingProtocol` 给出「透明环
   任意预算终止、环位透传原引用、`{}` 引用级同构」的可复用回归口径——T3 组合面若对环状输入有差分需求，可直接复用。

## Deferred verification

- **SA8 后置复核（设计 §14，`requiresConflictRecheck=true`）**：① 公共 API/类型面（重载三参、投影体泛型化、6 类型 + 1 守卫、三码
  失败分支）；② 两项 override 落地 + `aliases` 加宽；③ `SCHEMA_OPTIONS_INVALID` 定型；④ docs 脊柱键 pin；⑤ 跨票计层前提。
  本修复**不触碰**上述任一面（仅函数内部 visited 集），SA4 明示 `requiresConflictRecheck=false`。
- **T3 #336 组合验收**：值截断条目 ↔ 投影标记路径一一对应、detach 深拷贝、三码吸收。
- **T4 #337 / T5 #338**：`DeepOptional` 类型面、registry 文档负控与形状注记（本票不触碰）。
- **变异敏感性（G9.5）终态复核**：iteration 0 已抽查 D1/D2/D5；R1 的「恢复无环防御剥离」变异本轮以修复前实跑红（见上表红行）呈现，
  无需再改冻结件；D3/D4/D6–D9 留给 SA4/复核方按 SA6 §12.5 临时执行并复原。
- 其它回归/CI：非 SA3 范围；本文已给设计 §12.6 四命令与 root 全套结果供下游复核。

## Deviations or blockers

- **无阻塞、无范围越界、无验收语义修改**；红灯断言一字未弱化，新增用例不 skip/only/todo、无 env override/fallback/吞错、无源码
  字符串断言。
- **R1 修复路线 = SA4 建议的 visited-set 剥离（首选方案）**，未采用「在 walk 结果上预计算被裁标志」的等价方案——后者改动面更大
  （需扩 walk 内部结果形状），visited 集方案改动最小且对既有输出零影响；不拒收输入、不新增 throw、零跨调用状态。
- **实现说明级偏差（iteration 0 遗留，均在设计授权域内，SA4 §3/§11 已确认属实）**：① `fn.length` 2→3（设计 §6.8 尾注预告）；
  ② 公共包装联合为浅层联合 + `budgetShell()` 单点桥接；③ 容器壳位/union 宿主位 emit 按 §6.3 emitted 清单补齐；
  ④ 夹具新增可观察位 `inlPair`（N1 pin）。
- **MINOR 记录不处置项**：SA4 §11 观察 1/3/4（浅层包装静态可见性、`in` 判别、Date 型 options）——设计 pin 或与 readData 先例一致，
  无实现动作。
- 未发现设计不可行、红灯契约自相矛盾或 ALLOW 范围不足的证据。

## Suggested commit message

```
fix(vfsl): 截断判定对手造 optional 环安全 + SA4 R1 环回归 (#335)

SA4 R1（MAJOR）：isTruncated 的 optional 剥离循环无环防御——手造 optional 自引用环/
2-环在 object 字段位、array <item>、union 成员位三调用点无限循环（不抛、不返回），
违反设计 §6.3.5 终止性硬约束与「{} 与无预算读同构」的输入域承诺。修复：剥离链按节点
对象身份去重，重访即视为未截断并终止（环位经进行中集透传原引用、环上无标记）；
不拒收输入、不新增 throw、零跨调用状态；无环 optional 输入输出零变化。

测试：夹具补 optional 自环/2-环构造器（环位覆盖三调用点 + 闭包体内环），F1 锚补
SA4 R1 回归——{depth:0}/{depth:N}/{} /width-only 四态终止且 ok、无裸异常、{} 与无预算读
引用级同构、重复调用逐引用确定；另处置 SA4 §11 观察 2（G4.3 恒真断言）与观察 6
（digest 基锚字面）。修复前新用例以外部 timeout 呈现挂起（红），修复后绿。

门禁：包 tsc、vfsl 40 files/714 tests（0 type errors）、root typecheck（14 project）、
root pnpm test 341 files/3651 tests（0 type errors）全绿；既有 8 回归文件一行未改。
```

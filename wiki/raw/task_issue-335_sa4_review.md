# SA4 实现静态审查 — Issue #335 `[shape-budget] T2: 投影通道形状预算——解析入口三参化与截断标记`

- 派发：`sa-446777a5-455e-40aa-9f11-8efffb48bcb9`（role `mabf-sa4`，phase `implementation-review`，iteration 1）
- Worktree：`/home/wangjian/nomicore-fix-issue-335`（branch `mabf/issue-335`，基线 HEAD `ba11f328ae845bf882d131a2098a7afc8dfcc17c`）
- 审查对象：SA3 iteration 1 修复（SA4 R1 返工）后的最终 diff——tracked 改动 `packages/vfsl/src/{resolve-schema-at-path.ts,index.ts}`（合计 +431/−38）+ 4 新测试/夹具文件（untracked，均落设计 §10 ALLOW）；Issue comments REST `[]`（无 Owner 评论义务）
- 方法：静态审查（本角色不运行测试/服务/进程）——iteration 0 全量结论（下文「R0 已核」各节）经 anchor 复位复核仍然成立；本轮**聚焦 R1 修复面**：`isTruncated` 新实现逐行判读 + 剥离链终止性独立重放（纯自环 / 2-环 / ρ 形链 / 无环线性链 / 预算壳包装链五类输入）；walk 两相环防御对 optional 环的终止性重放（`{}`/width-only/`{depth:0,1,2,100}` 逐态推演至引用级结果形状）；iteration-1 delta 隔离核对（diff 算术 + 行号 anchor 位移 + 行数三方对账）；R1 Acceptance 断言清单逐项对照新增 `expectOptionalRingProtocol` 协议与两条用例；SA4 §11 观察 2/5/6 处置核对；既有 45 用例保持性核对（G2.2/G2.3/G5.2/F1 既有环/§6.3.4 锚逐一确认在场且未弱化）

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-335.md`（Issue 正文 + AC1–AC5，comments `[]`） | 已读 |
| `wiki/raw/task_issue-335_design.md`（iteration 1，770 行，SA2 approve 版；本轮重点 §6.3.5 环语义规约全文、§7.4.3、§11 环防御验收行） | 已读全文 |
| `wiki/raw/task_issue-335_sa2_review.md`（approve；F1–F5 + N1/N2） | 已读全文 |
| `wiki/raw/task_issue-335_sa6_contract.md`（G0–G10/§12.3/§12.4/§12.6/§13） | 已读全文 |
| `wiki/raw/task_issue-335_sa3_impl.md`（iteration 1 实现报告——R1 返工记录、红/绿证据、偏差申报） | 已读全文 |
| `wiki/raw/task_issue-335_conflict_report.md` + `_relevant_decisions.md` + `_implementation_conflict_report.md`（SA8 前置/实现后复审均 clear） | 已读全文 |
| 本轮 diff：`resolve-schema-at-path.ts`（867 行，含 R1 修复 +11）、4 新测试文件（budget.test.ts 1011 行/47 用例、budget.test-d.ts 136 行、budget-control.test.ts 239 行、budget-fixture.ts 605 行）、`src/index.ts`（422 行） | 已读关键段全文 |
| 交叉源码：`derived.ts`（ValueSchema 九 kind）、`evaluate.ts`（valueOf 逐位新建）、`namespace-runtime/src/read-schema-projection.ts`（两参消费）、既有 #272/M4 夹具 | 已读关键段 |
| 工程面：`vitest.config.ts` include/typecheck.include、包 tsconfig、`git status --porcelain`/`git diff --stat`/`git diff --check`、`.scratch/`（probe 已删，仅存无关既有目录） | 已核 |

## 2. Verdict

**approve** —— SA4 R1（MAJOR：`isTruncated` 的 optional 剥离循环对手造 optional 自引用环不终止）**已修复且修复忠实**：剥离链按节点对象身份加 visited 集，重访即返回「未截断」并终止——该判定是 §6.3.5 透传语义的唯一正确推论（环位透传原引用、环上不可能存在标记）；无环线性链每节点至多出现一次 ⟹ **对既有输出零影响**；不拒收输入、不新增 throw。钦定的 optional 环回归（纯自环 + 2-环）已按 SA4 R1 Acceptance 与设计 §6.3.5 测试口径**足额交付**，环位覆盖截断谓词全部三个调用点 + 闭包体内环。iteration 0 的其余结论（计层规约、标记形态、闭包/切片收缩、options 校验、公共面、无预算分支逐字节隔离、文件范围、负控纪律）经 anchor 复位复核全部保持，未发现新 BLOCKER/MAJOR。

R1 属实现层缺陷的修复（函数内 visited 集），未触碰公共 API/类型面/错误码/docs 语义——**无新 ADR 冲突面**，`requiresConflictRecheck=false`。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| Issue「解析入口三参化 + depth 截断 + 截断标记 + 闭包/切片同遍历收缩」 | `resolveSchemaAtPath` 重载（两参在前）+ options 校验分叉 + `BudgetWalk.render` 全计层表 | 落实（R0 已核，保持） |
| Issue「width 对投影无操作」 | `validateBudgetOptions` 校验后即弃 | 落实（保持） |
| Issue「无 options 逐字节不变」（AC4/ADR 0024 L29） | `budgeted` 分支隔离 + `noBudgetWant` 逐字抽出 + 负控摘要锚 | 落实（保持；动态复核见 §11） |
| SA2 F1（环防御终止，含 optional 环） | walk 两相防御（入口协议 L450–459）+ **本轮 `isTruncated` 环安全修复（L404–413）**；union 环/容器环/递归别名既有断言 + optional 自环/2-环新断言 | **落实（R1 关闭）** |
| SA2 F2/F3/F5、N2 | enum 成员位 emit；`b==0` 先行 + ref `Object.hasOwn` 守卫同文 InternalError；T3 前提三件；完成表串染免责 | 落实（保持） |
| SA2 N1（emit 谓词精度 + 环安全） | `isTruncated` 剥离 optional 包装判被裁（谓词语义不变）+ **剥离环安全（本轮）** | **落实（R1 关闭）** |
| SA4 R1 Required change：visited 集剥离（重访 = 未截断 + 终止）；**不得**拒收输入或新增 throw | `resolve-schema-at-path.ts` L404–413：`stripped` 集按节点身份，`stripped.has(current) → return false`；修复体仅 Set add/has——不可抛、无拒收、零跨调用状态；JSDoc L392–403 记录环安全论证 | **落实** |
| SA4 R1 Acceptance：optional 环夹具（纯自环 + 2-环）+ 四态断言 | `optionalRingDerived`/`optionalTwoCycleDerived`（同一骨架 `optionalRingSkeleton`）+ `expectOptionalRingProtocol` + 2 用例（budget.test.ts L789–907） | **足额交付**（逐项见 §8） |
| SA4 R1 Acceptance：既有断言不回退、optional 无环输出零变化 | 既有 45 用例逐一在场（G2.2/G2.3/G5.2 `ROOT.config`/F1 既有环/§6.3.4 锚实测）；无环剥离链 visited 恒 miss ⟹ 判定逐位相同；SA3 全量 714 用例 + root 3651 绿（报告证据） | **落实** |
| SA4 §11 观察 2（G4.3 恒真断言） | L427–430 改为与 `resolveSchemaAtPath(derived, [])` 的 parse 对比（非恒真；stringify 等价断言保留） | 已处置（强化，非弱化） |
| SA4 §11 观察 6（digest 基锚字面） | L223/L241 改 `ROOT.${String(path[0])}`（期望仍空集） | 已处置 |
| SA4 §11 观察 5（环用例禁 stringify/递归 digest） | 新增环用例全部引用相等/定点字段断言（`expectOptionalRingProtocol` 内零 `markerDigest`/`collectKinds`/`JSON.stringify` 作用于环状输出） | 已遵守 |
| SA8 实现后复审 required actions 1–4 | 冻结面零触碰（git 实测）；归一化 recipe/规则集/oracle/环语义 oracle 交付（SA3 §「T3 前提交付」四件） | 落实 |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| §6.3.5(a) 终止性硬约束（透明环任意 b 不发散） | walk 两相防御 + **`isTruncated` visited 集（L404–413）**；独立重放：自环 `cycle.value=cycle` 剥离两步重访即 false；2-环 `a→b→a` 三步重访即 false；ρ 形链（尾入环）重访即 false——剥离链是单指针路径，重访 ⇔ 成环 ⇔ 链上无标记 ⟹ `false` 为唯一正确且可终止判定 | **落实（R1 关闭）** | — |
| §6.3.5(3) 环透传语义（环位原引用、环上无标记、不 emit 重入位） | walk 入口协议 L453（重入返回原节点）+ optional 渲染身份短路 L513–514 + `isTruncated` 重访 false ⟹ 环位照常 emit（其 emit 归属首入父级） | 落实 | — |
| §6.3.5(b)(d) `{}` 与无预算读同构、对象图环零新增 throw | 修复体仅 Set 操作（不可抛）；四态引用级同构断言（valueSchema/闭包条目 `toBe` 原节点）；`InternalError` 清单未扩（ref 缺失守卫 L522–523 原文未动） | 落实 | — |
| §6.3.5 测试口径（引用相等、不可 stringify、docs 不带环下键） | 协议全用 `toBe`/定点字段；环夹具 `handMade` 三 docs 表为空（无环下文档键） | 落实 | — |
| §6.1–§6.4/§6.6–§6.11 其余决策（计层/标记/闭包/切片/校验/公共面/width/T3 前提） | R0 §4 逐行核对通过；本轮 anchor 复位（+11 位移后 L473/L488/L501/L522–523/L553–570 等）内容与 R0 所核逐字一致 | 落实（保持） | — |
| §7.4 逐字节恒等四合置 | 分支隔离/身份短路/环中性/enum emit 未动；负控摘要锚在场 | 落实（动态复核见 §11） | — |

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| 截断谓词环安全 | vfsl resolver（ADR 0024 决策 5） | `isTruncated` 函数内（修复面最小：不扩 walk 结果形状、不动公共面） | 正确 |
| 公共名目出口 | `src/index.ts` 唯一出口 | 本轮零改动（422 行，与 R0 所核一致） | 正确 |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| 环防御身份集先例 | `matchValueNode` visited / `collectAliasClosure` visitedNodes / `MatchCtx.visited`（先加后递归、静默终止） | `isTruncated` `stripped` 集（重访即判、返回 false） | 一致 | 同一「按对象身份去重 + 无 throw 终止」纪律；谓词场景无递归故为迭代重访判定 |
| R1 备选方案（walk 结果预计算被裁标志） | — | 未采纳（SA3 偏差申报：改动面更大需扩 walk 内部形状） | 一致 | SA4 R1 建议的首选方案即 visited 集；等价性成立 |

### 单一事实源 / 生命周期对称性 / 平行机制检查

- `stripped` 集为 `isTruncated` 调用内局部变量，零跨调用状态；`BudgetWalk` 仍每调用新建（R0 结论保持）。
- 纯函数面无生命周期/teardown 义务；未新增第二套闭包收集器/docs 后处理/类型族（R0 结论保持，本轮未触碰）。

## 5. 文件范围审查

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `packages/vfsl/src/resolve-schema-at-path.ts`（M，867 行） | ALLOW 行 1 | 唯一改造面（iteration 1 delta = `isTruncated` 修复 +11 行：JSDoc +6 / 函数体 +5；diff 算术复核：合计 insertions 420→431、deletions 38 不变，与申报逐字一致） | 合规 |
| `packages/vfsl/src/index.ts`（M，422 行） | ALLOW 行 2 | 公共出口（iteration 0；本轮零改动） | 合规 |
| `packages/vfsl/test/resolve-schema-at-path-budget-fixture.ts`（新，605 行） | ALLOW 行 3 | 夹具/oracle/毒化/环构造器（本轮 +55：`optionalRingSkeleton`/`optionalRingDerived`/`optionalTwoCycleDerived`/`OPTIONAL_RING_FIELDS` + 头注） | 合规 |
| `packages/vfsl/test/resolve-schema-at-path-budget.test.ts`（新，1011 行/47 用例） | ALLOW 行 4 | G2–G8 + F1/F2 锚（本轮 +129：`fieldValue`/`ringField`/`OPTIONAL_RING_PROBE_OPTIONS`/`expectOptionalRingProtocol`/2 用例 + 观察 2/6 处置） | 合规 |
| `packages/vfsl/test/resolve-schema-at-path-budget.test-d.ts`（新，136 行） | ALLOW 行 5 | G1 类型面（本轮零改动——行数与 R0 所核一致） | 合规 |
| `packages/vfsl/test/resolve-schema-at-path-budget-control.test.ts`（新，239 行） | ALLOW 行 6 | G0/G8.1 负控（本轮零改动；不 import 新环夹具——实测 import 清单未变） | 合规 |
| DENY 全域（derived/evaluate/validate-patch/resolve/pattern、doc-runtime、namespace-runtime、registry、vfsl-protocol、docs/CONTEXT/AGENTS、既有 8 测试/夹具、`.github`/`vitest.config.ts`/`tsconfig*`/`package.json`） | — | `git status --porcelain` 实测零改动；`git diff --check` 通过 | 合规 |
| `wiki/raw/task_issue-335*.md`（untracked 任务件）、`.scratch/`（gitignored；`probe-335-r1.ts` 已删，仅存无关既有目录 `vfsl-v1-parser`） | 任务产物面 | 非 ALLOW/DENY 判读对象 | 说明项 |

## 6. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| 两参 `resolveSchemaAtPath`（类型纯度） | `namespace-runtime/read-schema-projection.ts`（唯一生产消费） | 第一重载保纯；该包零 diff（保持） | 无 | — |
| 三参预算面 | 现无生产消费方（T3 面）；测试经动态接缝 | `SCHEMA_OPTIONS_INVALID` 面未动；R1 修复在预算分支内部，两参面不可达 | 无 | — |
| `isTruncated` 判定语义（内部谓词） | 三调用点 L473（object 字段）/L488（array `<item>`）/L501（union `<member N>`） | 修复在谓词内 ⟹ 三点统一环安全；无环输入判定逐位不变（线性链 visited 恒 miss）；环位 false ⟹ emitted 集照常收录环位（归属首入父级，与 §6.3.5(3) 一致） | 无 | — |
| `fn.length`/`ReadDataSchemaProjection` 泛型化/嵌套标记静态可见性 | R0 §6 已核 | 本轮零触碰 | 无（观察 1 继续 carried） | — |

## 7. 错误、恢复与并发

- **R1 修复 throw 纪律**：修复体仅 `new Set` + `has`/`add`（键为对象引用）——不存在可抛路径；无拒收输入分支；`InternalError` 通道（ref 缺失 L522–523）与 options 三码未动。「环输入不抛不挂」由四态结算 + `not.toThrow` 断言锚定（§8）。
- **无环输出零变化论证**：剥离链 `current = current.value` 是单指针路径——无环输入下每节点至多被赋值一次 ⟹ `stripped.has` 恒 false ⟹ 返回值与旧实现逐位相同；G2.2 d0 精确形态断言（`optional(marker)` → true，字段不 emit）在场且绿（SA3 证据）。
- **错误四分与次序/失败无部分状态/幂等**：R0 结论保持（本轮未触碰校验与合成段）。
- **静态无法确认项**：四命令门禁动态复跑、全变异敏感性终态（见 §11）。

## 8. 测试质量审查（R1 回归聚焦）

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| `expectOptionalRingProtocol`（budget.test.ts L821–887，被自环/2-环两用例调用） | ① 前置：无预算读 ok、`valueSchema` `toBe` 原 ROOT、闭包条目 `toBe` 原 RingAlias、环形状身份断言（`cycle.value===cycle` / `b.value===a`）；② **四态探针**（`{depth:0,1,2,100}`/`{}`/`{maxChildrenPerNode:1}`）：`not.toThrow` + 结算检查（`result===undefined` 即红）+ `ok===true`；③ `{depth:0}`：ROOT 单标记（container:object 线索）+ 空闭包 + 重复调用深比较确定；④ `{depth:1}`：有界壳——`x` 位 `toBe` 环节点（L473 调用点）、`arr` 位标记（container:array）、`u` 位原 union 且 `members[0]` `toBe` 环节点（L501 调用点）、`ringRef` 位标记（ref:RingAlias）+ 空闭包；⑤ `{}`/`{depth:2}`/`{depth:100}`/width-only/显式 `undefined`：与无预算读**引用级**同构（valueSchema + 闭包条目 `toBe` 原节点——`{depth:2}` 起环经 `arr.<item>`（L488 调用点）与 `RingAlias.self`（闭包体内 L473）触达）；⑥ 重复调用逐引用确定（`{}` again `toBe`；`{depth:1}` again 字段级 `toBe`/`toEqual`） | `vitest.config.ts` include `packages/*/test/**/*.test.ts`（同文件既有命中） | 无 skip/only/todo；环状输出零 stringify/digest（观察 5 纪律遵守）；断言全经运行时返回结构 | — |
| 用例「SA4 R1 透明环（optional 自环）」L890–896 | 调用上述协议；夹具前置身份断言 | 同上 | — | — |
| 用例「SA4 R1 透明环（optional 2-环）」L898–907 | 同上（2-环） | 同上 | — | — |
| 红/绿证据（SA3 报告，本角色不重跑） | 修复前两用例外部 `timeout` 强杀 exit 124（挂起=红，SA4 R1 Acceptance 明示可接受）+ 最小探针定位（无预算 ok / 预算 `{depth:1}` 不返回）；修复后 47/47、包门禁 40 files/714 tests 0 type errors、root 341/3651 全绿 | — | 挂起型红在 CI 无外部 timeout 时表现为作业级超时（缺陷类固有，非弱化） | — |
| 既有 45 用例 + test-d 8 + control 8 | G2/G3 矩阵、G4 闭包、G5 精确键集（含 `[]` d1 `ROOT.config` 不入选）、G6 width、G7 校验、G8 逐字节、F1 union/容器环/递归别名、F2 M4 差分、§6.3.4 修正锚 | 同上（三入口） | 观察 2/6 处置为强化/字面精度（期望值未变）；无一弱化 | — |

调用点覆盖对账：L473（object 字段）——d1 `x` 位与 `{depth:2}` 闭包体 `RingAlias.self`；L488（array `<item>`）——`{depth:2}`/`{depth:100}` 等价环（arr 于 b≥1 展开、元素即环节点）；L501（union 成员）——d1 `u.members[0]`。三个调用点在环输入上全部实际执行且结算（任一不终止 ⟹ 对应探针挂起 ⟹ 红）。

## 9. Required revisions

无（R1 已于 iteration 1 关闭；无新 BLOCKER/MAJOR/MINOR 阻断项）。

## 10. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| R1 修复后全量回归 | Controller 安排的动态验证（SA6 §12.6 四命令：包 tsc、vfsl vitest --typecheck、root typecheck、root test） | 全绿（40 files / 714 tests、root 341 files / 3651 tests 量级、0 type errors）；新 optional 环用例绿 | 任一既有断言回退或新用例红/挂起 |
| 变异敏感性终态复核（SA6 §12.5 D1–D9） | 实现方/复核方临时执行并复原 | 各变异使指定断言组红；「恢复无环防御剥离」变异 ≡ 修复前状态（已由 SA3 修复前实跑 exit 124 证红）；复原后与门禁修订逐字节相同 | 变异不红（空洞绿）或复原残留 |
| 无 options 逐字节恒等跨环境复核 | 任意环境重跑负控摘要 | #272 14 前缀 + 预算夹具摘要 + M4 23 键逐字相符 | 任一摘要漂移 |
| 敌意 options 全域穷举（Symbol 键/非枚举 own 键等） | 动态 probe（可选） | 与设计 own-枚举键语义一致 | 抛错或不确定 |

## 11. Non-blocking observations

1. **浅层包装联合的静态可见性**（设计 §6.8 pin，跨轮 carried）：T3 detach 拷贝须在每层经 `isSchemaTruncationMarker` 运行时判别（SA8 §8.1.4 已武装；SA3 已在 T3 前提交付重申）。
2. `isSchemaTruncationMarker` 用 `in` 判别、无 own 键对象 options 等同 `{}` 放行——设计 pin/readData 先例一致（跨轮 carried，非缺口）。
3. 挂起型回归的 CI 呈现：若未来变异重新引入不终止，vitest worker 将挂起至作业级超时而非快速红——缺陷类固有；如需快速反馈可在 CI 层为该文件配外部 timeout（非验收要求）。
4. `expectOptionalRingProtocol` 的结算检查（`result === undefined`）在实现「静默返回 undefined」时也红——比单纯 not.toThrow 略强，无副作用。
5. SA3 iteration 1 报告的申报（修复路线=visited 集首选方案、delta 行数、门禁数字、偏差清单）经本轮静态对账（diff 算术/anchor 位移/行数/用例计数/import 清单）逐项属实。

---

**结论**：SA4 R1（MAJOR）已按 Required change 首选方案修复——`isTruncated` 剥离链按节点身份 visited 集去重、重访即「未截断」并终止，判定与设计 §6.3.5 透传语义严格一致；对无环 optional 输出零影响（线性链论证 + G2.2 精确形态断言保持）；不拒收、不新增 throw；钦定 optional 自环/2-环夹具与四态回归足额交付且覆盖谓词全部三个调用点与闭包体内环；既有 45 用例与负控零回退，观察 2/6 顺手强化处置。iteration 0 其余各项结论经复核保持。裁决：**approve**（路由完成——无待办实现修订；动态四命令复跑与变异终态复核归 Controller 后续安排）。

# SA9 Standards 审查 — task_issue-334（形状预算 T1：载体投影读取三参化与截断省略）

- **Reviewer**：SA9（mabf-sa9），dispatch `sa-b79462c6-249a-46ab-be86-459911f299ca`，phase standards-review，iteration 0
- **Reviewed subject**：issue #334 最终**已提交** diff `ba11f328…→08afd1ff`（branch `mabf/issue-334`，单 commit `08afd1f feat(doc-runtime): add shape budget to logical reads`）——父基 PR #332 = `ba11f328ae845bf882d131a2098a7afc8dfcc17c`（dispatch 前已刷新，与本 worktree HEAD~1 一致）
- **审查方式**：纯静态（SA9 纪律：不运行测试/不启动服务/不改代码）；亲读全部 committed diff（`read.ts` 583 行 diff + 809 行终态全文、`index.ts`、4 个测试文件全文）、根/包 AGENTS.md、ADR-0024 全文、CONTEXT.md 相关词条、上游全部固定产物（SA1/SA2/SA3/SA4/SA6/SA7/SA8×2）
- **Issue 评论快照**：REST 读评论成功、**零评论**（comment IDs: none）——无 Owner override 需要应用
- **Verdict**：**approve**（无 BLOCKER / 无 MAJOR；4 条非阻塞 MINOR 观察见 §10）

---

## 1. Reviewed inputs

| 输入 | 路径 | 状态 |
|---|---|---|
| 任务简报 | `wiki/raw/task_issue-334.md`（AC1–AC5；零评论） | 已读 |
| SA1 设计 | `wiki/raw/task_issue-334_design.md`（决议 A–D、§11 ALLOW/DENY） | 已逐节对照 |
| SA2 设计评审 | `wiki/raw/task_issue-334_sa2_review.md`（approve；O-1/O-2） | 已读并核对落实 |
| SA3 实现报告 | `wiki/raw/task_issue-334_sa3_impl.md`（clear；A-1 落地 + m1/m2/m7/m8） | 已读并抽查证据 |
| SA4 静态审查 | `wiki/raw/task_issue-334_sa4_review.md`（approve；§11 动态项、§12 观察） | 已读（证据采信并独立复核关键点） |
| SA6 验收契约（迭代 1） | `wiki/raw/task_issue-334_sa6_contract.md`（B1–B16/V1–V6/S1–S27/NC-1…8/F1–F14/R1–R9/E1–E10、§15 A-1/A-2） | 已逐条对照（直接对照面） |
| SA7 动态验证 | `wiki/raw/task_issue-334_sa7_report.md`（approve；HEAD A/B 逐字节、m3–m6 变异、root 门禁复跑） | 已读（动态证据采信） |
| SA8 冲突门禁 ×2 | `wiki/raw/task_issue-334_conflict_report.md`（clear）、`…_implementation_conflict_report.md`（clear，D-3 闭合） | 已读 |
| 直接治理 ADR | `docs/adr/0024-readdata-shape-budget.md`（决策 1/2/3/6 + 修订节 + 验收节） | SA9 亲读全文逐句比对 |
| 模块纪律 | `AGENTS.md`（根）、`packages/doc-runtime/AGENTS.md` | 已读 |
| 术语基准 | `CONTEXT.md` 形状预算/截断省略/截断清单词条（L45–55，父 PR #332 已在位） | 已读 |
| committed diff | `git diff ba11f32..08afd1f`：6 个包内文件（+1709/−34）+ 9 个 wiki 产物 | 已逐 hunk 亲读 |

## 2. Verdict

**approve**。核心理由：

1. **文件范围零越界**：committed diff 的包内改动恰为 SA1 §11 / SA6 §10 ALLOW LIST 6 项（`read.ts` +423/−34、`index.ts` +7、3 个新测试文件、`public-surface-type-guard.test-d.ts` +15 仅加法）；4 个冻结回归锚 **0 行 diff**；DENY 面（namespace-runtime/namespace-registry/vfsl*/docs/CONTEXT.md/wire/根 runner/tsconfig/package.json）**零命中**（SA9 亲核 `git diff --name-only`）。
2. **ADR-0024 逐项合规**：决策 1（三参化、递归内生效、depth:0 骨架、终态 no-op、封闭 options 响亮拒绝 `READ_OPTIONS_INVALID`）、决策 2（键省略为值内唯一截断形态、目标自身同形空容器唯一例外）、决策 3（清单恒在场、条目三字段、omitted = 直接子项数非后代总数）、决策 6（预算贯通既有双递归、不新增第二条读路径）全部落位；决策 4/5/7（T2/T3/T4）正确划出且对应包零 diff。
3. **无 options 逐字节不变结构性成立**：SA9 逐 hunk 亲读——legacy 分支循环体与 HEAD 逐语句一致（仅线程化 `ctx/d/p` 形参且不被读取）；全部新逻辑以 `ctx.budget !== null` 门控；`ReadLogicalValueResult` 成员逐字未动 → `runtime.ts:119` Extract 输入不变（namespace-runtime 零 diff 佐证）；SA7 probe4 的 HEAD 源 A/B 34 组 canon 序列化全等（含 message 逐字节）提供独立动态佐证。
4. **模块纪律与惯例全命中**：公共 API 仅经 `src/index.ts` 且零新值导出（T1-7）；读取保持 schema 无关；失败构造复用 `notAllowed`/`safeSpreadPath` path 回显纪律（E100 先例）；键空间纪律单源复用 `readableOwnDataValue`/`readableArrayElement`/`isPlainRecord`；INV-R9/R10 模块级零可变态（SA9 grep `^(let|var)` 零命中）。
5. **测试质量达标**：33+88+7 tests 全锚公共接缝 `../src/index.js` 可观测行为；零 skip/only/todo（SA9 grep 零命中）；条目多重集断言（R6）；Y.Map 前缀现场 `keys()` 派生（S12）；S22 纯形状断言零计时；NC-1…NC-8 负控在位；`@ts-expect-error` 自反转类型锚；唯一 instrumentation（detached 夹具 own accessor 计数器）为 SA6 §12.9 明示允许的载体公共面行为观测，非源码文本断言（SA9 grep 新测试零 `readFileSync`/源码串断言）。

## 3. AGENTS / 模块责任审查

| 义务（根 + doc-runtime AGENTS） | 实现证据 | 结论 |
|---|---|---|
| 读取 schema 无关（不重编译/重校验） | 预算为 schema 无关投影概念（ADR-0024 决策 6）；`read.ts` 零 VFSL/derived 依赖 | ✅ |
| 公共 API 仅经 `src/index.ts`；surface guard 覆盖每个导出 | `index.ts` 仅加法 `export type` ×3（+注释说明零新值导出）；`public-surface-type-guard.test-d.ts` 加法锚 3 名目（TS2305 机制）；值面 guard 未改动且不受新类型导出影响 | ✅ |
| 载体机制留在 doc-runtime；persistence/lifecycle 归 namespace-runtime | `packages/namespace-runtime/**` 零 diff；`runtime.ts:484` 仍 2 参调用、`:119` Extract 输入类型未变 → `NamespaceRuntimeReadDataResult` 零泄漏 | ✅ |
| 不暴露 live writable ROOT/内部状态 | 返回值仍为隔离深拷贝（putKey 四真、不 freeze）；截断条目逐层新鲜数组（S27 身份互异锚） | ✅ |
| 公共类型/读契约变更时跑 root `pnpm typecheck`/`pnpm test` | SA3 §6.4（typecheck exit 0；341 文件/3717 tests ×2）+ SA7 §8/§10（最终态复跑同结果）——证据链完整，SA9 不重跑 | ✅ |
| 预算递归归属 doc-runtime；runtime 五键组合归 T2 | 未越位（T2 面零 diff）；options 校验 `validateReadOptions` 非导出（不新增公共校验器） | ✅ |

## 4. ADR 合规审查

| ADR 条款 | 实现落点 | 结论 |
|---|---|---|
| 0024 决策 1：三参形态、预算递归内生效、未展开分支零物化、depth:0 骨架、终态 no-op | 双重载 + 实现签名（`read.ts:118-131`）；折叠 `projectValue:538-547`/`copyPlainStrict:716-724`；槽位前缀保留 + 超界零 get/零递归（`:634-650`/`:670-683`/`:740-754`/`:774-789`）；终态 `budgetFold` 返 null 落现行分支 | ✅ |
| 0024 决策 1：非法 options 响亮拒绝 `READ_OPTIONS_INVALID`（封闭形状、不借路径/生命周期码、同步不抛） | `validateReadOptions:326-361`（非对象/非 plain 宿主/未知键/accessor 零执行/值域 `number∧isInteger∧isFinite∧≥0`、-0≡0、内层 try 收编 Proxy trap）；定序 G0→OPT→N0（V1/V2 零 doc 触碰）；`optionsInvalid:375-377` 恰四字段、path 新鲜回显、禁带预算键；新码只进 budget 联合 | ✅ |
| 0024 决策 2：键省略唯一形态、无第三态/哨兵/同形占位（目标自身例外） | 折叠仅对 d===0 节点自身返 `{}`/`[]`；被裁子项键缺席；E1 吸收不变（保留槽位 undefined 值键仍省略占额度 B7）；S26 `hasOwn===false` 锚 | ✅ |
| 0024 决策 3：清单恒在场、条目三字段、omitted 直接子项数（O(1)）非后代总数 | 预算成功面恒四键（`:224-229`）、`truncated === length>0`（B14）；raw 计数逐载体钉死（`Y.Map.size` 含 undefined 值键 / `Y.Array.length` / plain `length` / own enumerable data 键数）；S24 显式 `!== 后代总数` 反证 | ✅ |
| 0024 决策 6：贯通既有双递归、不新增第二条读路径 | 四函数签名加 ctx/d/p 尾参贯通同族（F10）；无平行投影族、无第二读入口；`index.ts` 零新值导出 | ✅ |
| 0024 修订节（0008/0016 显式修订） | `ReadLogicalValueResult` 逐字未动；无 options 签名与语义逐字不变（SA7 A/B 逐字节佐证）；B16 detached 口径与 0008 L27「只观察已提交 live doc」相容（prelim 非文档状态，SA8 实现后复查裁决 no-conflict） | ✅ |
| 决策 4/5/7（T2/T3/T4 范围） | runtime/vfsl/vfsl-protocol/registry 零 diff；全仓 `DeepOptional` 仍零命中 | ✅ 未抢先 |
| ADR-0003 ValueSchema 9-kind 冻结 | 零接触 | ✅ |

## 5. 既有架构惯例与单一事实源

| 检查项 | 结论 |
|---|---|
| 失败通道惯例（单码 `PATH_NOT_ALLOWED` + path 新鲜回显 + 非空 message） | `optionsInvalid` 复用 `safeSpreadPath` 回显纪律，与 `notAllowed`/E100 先例一致；新码隔离在新联合不混码域（V5/V6） | ✅ |
| 键空间/段纪律单源 | 预算分支保留槽位读取复用 `readableOwnDataValue`/`readableArrayElement`；plain 判据复用 `isPlainRecord`；options 宿主判据刻意更严（仅 Object.prototype/null 原型）为 SA6 R7 成文分野（控制面输入 vs 数据载体面），非静默分叉 | ✅ |
| 截断事实单一事实源 | `ctx.truncations` 调用级新鲜累加器为唯一清单；`truncated` 在构造点派生；零模块态/零 memo/零缓存 | ✅ |
| 预算值单一来源 | options 校验后归一化一次（缺席轴 +Infinity 内部哨兵，校验拒非有限输入故永不外泄）；`ValidatedBudget` 调用局部 | ✅ |
| 生命周期对称性 | 纯同步读、无 register/dispose/订阅/后台任务；全部创建物调用局部、随调用可回收；无不对称面 | ✅ |
| 平行机制 | 无第二投影族/第二读入口/第二校验管线/第二失败通道 | ✅ |

## 6. 文件范围审查（committed diff 实测）

```
$ git diff ba11f32..08afd1f --name-only -- packages/
packages/doc-runtime/src/index.ts                                   (+7)
packages/doc-runtime/src/read.ts                                    (+423/−34)
packages/doc-runtime/test/public-surface-type-guard.test-d.ts       (+15)
packages/doc-runtime/test/read-logical-value-at-path-shape-budget-guards.test.ts  (新, 435 行)
packages/doc-runtime/test/read-logical-value-at-path-shape-budget.test-d.ts       (新, 114 行)
packages/doc-runtime/test/read-logical-value-at-path-shape-budget.test.ts         (新, 700 行)
```

- 冻结锚 4 文件（`schema-independent.test.ts`/`.test-d.ts`、`guards.test.ts`、`public-surface-guard.test.ts`）：**0 行 diff**（SA9 亲核）。
- DENY 面 grep（namespace-runtime|namespace-registry|vfsl|domains|apps|docs|CONTEXT.md|vitest.config|tsconfig|package.json）：**零命中**。
- 临时物：包内零 `.scratch*`、src 下零 `.js`；根 `.scratch/` 为仓内既有 tracked 内容（`git ls-files` 确认），非本任务残留。
- wiki 产物 9 份随 commit 入库（设计/SA2/SA3/SA4/SA6/SA7/SA8×2/决策摘录），与仓内 task_191/task_228 等先例一致；任务简报 `wiki/raw/task_issue-334.md` 仍 untracked（见 §10 M-3）。

## 7. 测试质量标准审查

| 标准 | 实测 | 结论 |
|---|---|---|
| 锚定公共接缝可观测行为 | 三新文件全部经 `../src/index.js` 导入并断言结果面/值形状/键集/条目多重集 | ✅ |
| 零 skip/only/todo | SA9 grep 三文件零命中 | ✅ |
| 无脆弱序假设 | 条目按 `(path,kind,omitted)` 多重集（R6）；Y.Map 前缀现场 `keys()` 派生（S12）；精确序断言仅用于 Y.Array/plain array（下标序稳定） | ✅ |
| 零计时断言 | S22 为 10k 规模形状断言（length/omitted），无 ms 门槛 | ✅ |
| 负控真实 | NC-1（F-POISON 无 options 必红）/NC-2/NC-7/NC-8（S21 反证族）/NC-3/NC-6（两键锚）/NC-4（路径缺陷不被掩盖）/NC-5（guards 30 非法 ×2 矩阵）全在位 | ✅ |
| 类型锚自反转 | TD1–TD6 全部 `@ts-expect-error` 负例（未知键/类型不符/数组/裸非对象/显式 undefined/参数个数），实现误放行即 unused directive 红 | ✅ |
| 变异敏感 | m1/m2（SA3 迭代 0）、m7/m8（SA3 迭代 1）、m3–m6（SA7 §7）全部「施加→红→还原→绿」闭环，还原 sha256 回冻结值 | ✅（SA3/SA7 证据） |
| 例外 instrumentation 合法性 | detached 夹具 own accessor `size`/`length` 计数器 = SA6 §12.9 明示允许的载体公共面行为观测（B16④ 判据本身要求证明「零公共 count 读」），非源码文本断言、非生产代码改动 | ✅ |

## 8. SA4/SA7 证据采信核对

| 上游结论 | SA9 独立复核 | 结论 |
|---|---|---|
| SA4 approve（无 BLOCKER/MAJOR；4 条非阻塞观察） | 关键点逐项亲核成立：legacy 逐 hunk 门控、B16④ 短路先于 `size`/`length` 读、V1–V6 定序、范围零越界 | 采信 |
| SA7 approve（103 项探针全绿、m3–m6 击杀、root 门禁复跑 341/3717 ×1 + SA3 ×2） | 证据链自洽（冻结 sha256、还原仪式、临时物清理后复跑 503/503）；SA9 不重跑 | 采信 |
| SA8 实现后复查 clear（D-3 闭合，implements ×8 / no-conflict ×8） | ADR-0024 决策 1/2/3/6 与修订节经 SA9 逐句比对一致；B16 为 ADR 沉默角落的契约解释（SA6 迭代 1 批准），非条款偏离 | 采信 |

## 9. Required revisions

无 BLOCKER、无 MAJOR finding。

| Finding ID | Severity | Evidence | Problem | Required change | Acceptance | Suggested routing |
|---|---|---|---|---|---|---|
| —（空） | — | — | — | — | — | — |

## 10. Non-blocking observations（MINOR，不阻断 approve）

| ID | 观察 | 建议 | 不阻断理由 |
|---|---|---|---|
| M-1 | `plainDataSlotCount`（`read.ts:616-625`）与 `plainDataSlotKeys`（`:604-613`）是同一过滤规则的两份实现（count ≡ keys().length），存在轻微规则漂移面 | 后续切片可让 count 复用 keys 或内联单函数；纯内部助手 | 与 SA4-O2 同款；两者同 diff 引入且逐行一致，无行为差异 |
| M-2 | B7 组合场景（undefined 值键落在 width 保留前缀内：占额度、被吸收）无专属 committed 单元锚；S16 只测导航吸收、S12/S13 只测 width | T2 组合面落地时补一条组合锚（Y.Map 含 undefined 值键 + K 恰含该键前缀） | 与 SA4-O1 同款；SA7 probe3 B7 组已动态确认实现语义正确；S26 输出侧不变量已覆盖；SA6 S 清单未钉死该组合 |
| M-3 | 任务简报 `wiki/raw/task_issue-334.md` 仍 untracked，未随 `08afd1f` 入库（其余 9 份任务产物均已入库） | Controller finalize 时一并 add，保持任务产物完整可追溯 | 流程卫生项；不影响代码/测试标准；仓内先例（task_191_dispatch.md 等）为 tracked |
| M-4 | `read.ts` 头注首段（历史设计记录区）保留「成本 O(path + 目标子树)（INV-R12）」旧注；ADR-0024 修订节已将预算读成本界改为「实际返回部分」 | 可在 T 系列 docs 收口票顺手补半句交叉指引（预算段已有「未展开分支零物化」描述） | 该段显式标注「设计记录（历史证据，非规范）」且对无 options 路径仍为真；预算段语义自足，非矛盾 |

## 11. requiresConflictRecheck

**false**。本轮未发现新的 ADR 冲突风险：实现零偏移采纳 SA6 §12 全部钉死口径（含迭代 1 B16/R9 裁决）；SA8 实现后复查已按 D-3 逐项闭合（clear）；SA9 静态审查未打开任何新决策面。

—— 审查结束 ——

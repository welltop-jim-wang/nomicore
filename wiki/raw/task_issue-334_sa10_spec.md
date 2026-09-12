# SA10 Spec 审查 — task_issue-334（形状预算 T1：载体投影读取三参化与截断省略）

- **Reviewer**：SA10（mabf-sa10，dispatch `sa-33898c53-553d-4f85-9d09-65730eaf5163`，phase spec-review，iteration 0）
- **Reviewed subject**：最终提交 diff `ba11f328ae845bf882d131a2098a7afc8dfcc17c..08afd1ff079ea40b82fc277941363787417b67d2`（branch `mabf/issue-334`，单 commit `08afd1f`「feat(doc-runtime): add shape budget to logical reads」）
- **Issue 评论快照**：REST 读评论成功、**零评论**（comment IDs: none）——无 Owner override 需要应用
- **审查方式**：纯静态。亲读 issue 正文（简报）、SA6 验收契约（迭代 1，含 B16/R9）、SA1 设计、SA2 评审、SA3 实现报告、SA4 静态审查、SA7 动态验证、SA8 前置/实现后冲突报告、ADR-0024 原文、`read.ts` 全文（809 行）与全部 diff hunks、3 个新测试文件全文、`index.ts`、`public-surface-type-guard.test-d.ts` diff；亲核 `git diff --stat`、冻结锚零 diff、文件 sha256 与 SA7 冻结值一致。SA10 纪律：不运行测试、不启动服务、不改代码。
- **Verdict**：**approve**（无未达成/部分实现/错误实现/scope creep；PR 披露项见 §7，全部为非阻塞）

---

## 1. 提交面与基线一致性

| 项 | 实况 | 判据 |
|---|---|---|
| HEAD | `08afd1ff079ea40b82fc277941363787417b67d2` | 与 dispatch 给定交付头一致 |
| 基线 | `ba11f328…`（parent PR #332 已刷新） | diff 范围核定基准 |
| `git diff --stat` | `src/index.ts` +7；`src/read.ts` +423/−34；`test/public-surface-type-guard.test-d.ts` +15；3 个新测试文件（`…shape-budget.test.ts` 700 行 / `…guards.test.ts` 435 行 / `…shape-budget.test-d.ts` 114 行）；+ wiki/raw 流程产物 | 与 SA6 §10 / SA1 §11 ALLOW LIST 六项逐行一致 |
| DENY 面零 diff | `packages/namespace-runtime/**`（含 `runtime.ts:119` Extract、`:484` 调用）、`namespace-registry`、`vfsl*`、`docs/**`（含 ADR-0024）、`CONTEXT.md`、`vitest.config.ts`、`tsconfig*`、`package.json` | SA10 亲跑 `git diff --stat` 对上述路径 = 空（exit 0 无输出） |
| 冻结锚 | `read-logical-value-at-path-{schema-independent.test.ts,schema-independent.test-d.ts,guards.test.ts}`、`public-surface-guard.test.ts` | 对基线**零 diff**（F13/E4） |
| 冻结态哈希 | `read.ts` sha256 `3bf6b8b016e4…b312`、`shape-budget.test.ts` `a8e8c803b040…d126` | 与 SA3 §6.4 / SA7 §9 冻结值逐字一致——**已提交态 = 已验证态** |
| 工作区 | `git status` 仅 `?? wiki/raw/task_issue-334.md`（任务简报，host 侧未跟踪）；零 `.scratch*`、src 下零 `.js` | 无残留、无未提交实现改动 |

## 2. Issue 正文 What-to-build 逐点核对

| 简报要求（L17） | 实现落点 | 判定 |
|---|---|---|
| 三参形态 `readLogicalValueAtPath(doc, path, options?)`（ADR-0024 决策 1/2/3） | 双重载声明 + 实现签名 `options?`（`read.ts:118-131`）；3 参静态型恰为 `ReadLogicalValueAtPathBudgetResult`（TD2） | 达成 |
| depth 与 maxChildrenPerNode 预算**在投影递归内生效** | 预算经 `ProjectionCtx + d/p` 贯通既有 `projectValue/projectYMap/projectYArray/copyPlainStrict`（`read.ts:536/632/668/714`）；无平行投影族（F10） | 达成 |
| 未展开分支零物化 | 折叠/裁减在槽位枚举层：Y.Map `break` 先于 `get`（`:642`）、Y.Array/plain array 只读前 K 下标、plain object 先 `plainDataSlotKeys` 裁后读；哨兵 S19/S20 埋 non-finite number、稀疏空洞、Y.Text、detached 载体均 `ok:true` | 达成 |
| 截断省略为值内唯一截断形态（depth/width 同形态，键省略） | 被裁键一律缺席；S26 断言 `Object.hasOwn(value, cutKey) === false`、值内无 undefined 在场键；无第三态/无哨兵/无子项位空占位 | 达成 |
| `depth:0` 骨架读（目标折叠为空容器 + 单条截断项） | `budgetFold` 同形空容器 `{}`/`[]`（proto = Object.prototype）+ 至多一条 depth 条目（`read.ts:538-547/583-597,716-724`）；S2/S3/S4 | 达成 |
| 终态目标预算 no-op | `budgetFold` 对标量/`Y.XmlFragment`/值域违规返回 null → 落现行分支（B2）；S15（标量/null/xmlEl 原样、`truncated:false`） | 达成 |
| options 封闭形状，非法值（负数/非整数/非有限数/非对象/未知键）响亮拒绝进新失败分支 | `validateReadOptions`（`:326-361`）+ `optionsInvalid` → `READ_OPTIONS_INVALID`（`:375-377`）；guards 88 tests 覆盖 §12.2 全矩阵 + accessor 零执行 + 敌意 Proxy 收编 + V1/V2/V3/V5 | 达成 |
| omitted = 直接子项数（O(1)，非后代总数） | raw 子槽口径：`Y.Map.size`（含 undefined 值键）/`Y.Array.length`/plain array `length`/`plainDataSlotCount`；S24 显式断言 `omitted 2 !== 4`（后代键总数） | 达成 |
| 无 options 时行为逐字节不变 | `ctx.budget === null` 门控：legacy 分支循环体与基线逐语句一致（diff 仅线程化 `ctx/d/p` 形参，不被读取）；成功构造按模式二/四键分叉；`ReadLogicalValueResult` 逐字未动；4 冻结锚零 diff；S1/S23 恰两键 | 达成 |

## 3. 验收标准（AC1–AC5）映射

| AC | 证据 | 判定 |
|---|---|---|
| AC1 预算递归截断省略正确（depth/width 各形态、depth:0 骨架、终态 no-op，doc-runtime 单元面） | 测试 `…shape-budget.test.ts` S1–S15、S24、S25（值形状 + 条目 `(path,kind,omitted)` 多重集断言）；SA7 probe1 37/37 动态复核 | 达成 |
| AC2 截断事实（位置/裁因/直接子项数）随结果返回，可供 runtime 组合消费 | 预算成功面恒四键 `{ok,value,truncated,truncations}`（`read.ts:224-229`、`okUndefined:287-295`）；条目三字段 ROOT 基；`truncated === truncations.length>0`（B14 不变量在断言助手中恒检）；`READ_OPTIONS_INVALID` 隔离在新联合 → T2 组合为机械加法 | 达成 |
| AC3 零物化行为哨兵 | S19①②③④（poison/sparse/detached 在 D=0 折叠 `ok:true`）+ S20①–④（width 边界外空洞/Y.Text 未读）+ S21/NC-1/NC-2/NC-7/NC-8 反证（同夹具展开必 `PATH_NOT_ALLOWED`——套件非宽松）；SA7 hop 级 `get` 记账（K=2 恰 2 次 get；折叠 0 次） | 达成 |
| AC4 缺席吸收与敌意 path 纪律不破（零 throw）；非法 options 走新失败分支 | S16（吸收 + 预算 4 键 value undefined）/S17（accessor 零执行、原型链/non-enumerable 键空间外）/S18（合法 options 下路径缺陷仍 `PATH_NOT_ALLOWED` + 回显、Proxy path 零外抛）；guards 矩阵 30 非法 ×2 + accessor ×3 + 键空间 + 9 合法 + 宿主 + `-0` + 敌意 Proxy ×4 | 达成 |
| AC5 无 options 逐字节回归锚全绿；全套包门禁 + root typecheck/test | 4 冻结锚零 diff 且 SA3/SA7 报全绿；SA7 终态复跑：`pnpm typecheck` exit 0（14 tsconfig）、`pnpm test` 341 文件/3717 tests 全绿、Type Errors no errors；doc-runtime 27 文件/503 tests 全绿 | 达成（证据链完备；SA10 依纪律不复跑） |

## 4. SA6 验收契约（迭代 1，含 B16/R9）核对

### 4.1 B16/R9（本轮唯一裁决点，dispatch 点名）

| 裁决项 | 实现/测试实况 | 判定 |
|---|---|---|
| 折叠照常发生（B15 优先，不走 detached 守卫） | `budgetFold` 对 `Y.Map`/`Y.Array` 先判容器（`read.ts:584/588`），折叠前置先于 `projectValue:548` 的 detached 守卫；S19④ `{ys:{}}`/`{ys:[]}` 绿 | 达成 |
| `rawTotal := 0`（契约定义，不以 `_prelimContent` 计数） | `read.ts:585/589`：`doc === null` → `{rawTotal: 0, empty}`；全 diff 零 `_prelimContent` 引用 | 达成 |
| 零公共 count 读（不执行 `size`/`length`/`keys()`/`get`/`toJSON`） | 短路先于 `v.size`/`v.length`（`:585` 先于 `:586`、`:589` 先于 `:590`）；S19④/O-1 以 own accessor 计数器断言 `count === 0`（§12.9 明示允许的行为观测例外） | 达成 |
| 断言形态 `{ys:{}}`/`{ys:[]}`、`truncated:false`、`truncations:[]`（无 depth 条目）；目标入口 `['holder','ys'],{depth:0}` 同款 | 测试 `:485-506`（S19④）与 `:508-515`（O-1）逐字锚定 | 达成 |
| `d ≥ 1`（含 width 保留槽位物化）→ 现行响亮失败面原样 | S21 扩展（`:550-562`）：`['holder'],{depth:2}` 与 `['holderArr'],{depth:2}` 均 `PATH_NOT_ALLOWED`；折叠/展开对称性钉死（NC-8） | 达成 |
| 判据边界沿用 R2 #2（`instanceof Y.AbstractType && doc === null`）；跨 doc 集成容器不属 detached；detached 非容器走 B2 终态 no-op + 现行守卫 | `(v as {doc:unknown}).doc === null` 同款判据；`budgetFold` 对 Y.Text/XmlFragment 返回 null → 落现行响亮分支 | 达成 |
| SA6 §15 A-2「其余实现零改动」 | 迭代 1 delta = `budgetFold` +6 行短路 + 注释；SA4 逐 hunk 亲核、SA10 复核 diff 一致 | 达成 |

### 4.2 契约其余钉死面（抽样亲核，非仅依赖上游报告）

| 契约项 | 实现落点 | 判定 |
|---|---|---|
| §12.1 T1-1…T1-8（双结果类型 + 重载；封闭形状；显式 undefined 类型层拒绝/运行时 ≡ 缺席；仅加法类型导出；零新值导出） | `read.ts:62-131`；`index.ts:14-20`（仅 `export type` ×3）；TD1–TD6 + public-surface-type-guard 加法锚；`public-surface-guard.test.ts` 零改动 | 达成 |
| §12.4 D-1（新码只进 budget 联合；`ReadLogicalValueResult` 逐字不动 → `runtime.ts:119` Extract 零泄漏） | 类型逐字一致；namespace-runtime 零 diff 佐证 | 达成 |
| §12.5 V1–V6（G0→OPT→N0 定序；零 doc 触碰；零 throw/零 accessor 执行/零变异；失败分支恰 `{ok,code,path 新鲜回显,message}` 禁带预算键；码字面量稳定不借路径/生命周期码；E100 仍只表示内部 bug） | `read.ts:136-156` 定序；`:329-360` 内层 try；`:375-377` 字段构成；guards V1/V2/V3/V5/NC-4/NC-5 全锚 | 达成 |
| §12.3 B1–B15（计层/终态 no-op/折叠优先/空容器不记条目/raw 计数/width 计数/前缀口径/零物化边界/路径基/尾段键名/父路径单条/值域纪律/导航盲/B14 不变量/载体分类 vs 折叠） | 逐条见 §2 表；SA2 手推 + SA4 手推 + SA10 复核 `read.ts:536-800` 一致 | 达成 |
| §12.6 F1–F14 冻结面 | §1 DENY 零 diff + 冻结锚零 diff + 门控结构 + 零模块态（`truncations` 调用局部，S27 身份互异） | 达成 |
| §12.7 S1–S27 / TD1–TD6 | 3 个新测试文件逐场景在位；多重集断言（R6）；Y.Map 前缀现场 `keys()` 派生（S12）；无 skip/only/todo（SA10 grep 零命中） | 达成 |
| §12.8 NC-1…NC-8 | 全部在位（NC-5 = guards 矩阵 88 tests；NC-8 = S21 扩展双载体） | 达成 |
| §12.10 E1–E10 证据链 | E1（SA6 缺口红）→ E2（SA3 转绿 503/503）→ E3（NC 全绿）→ E4（锚零 diff）→ E5（变异 m1/m2/m7/m8 由 SA3、m3–m6 由 SA7，全部「施加→红→还原→绿」，还原 sha256 回冻结值）→ E6/E7（§1）→ E8（SA7 root 门禁）→ E9（S22 10k 形状，不计时）→ E10（`read.ts` 模块头注 + `budgetFold` 头注 B16/R9 成文） | 达成 |

## 5. ADR/规范一致性

| 决策面 | 实况 | 判定 |
|---|---|---|
| ADR-0024 决策 1（API 与参数语义） | §2 逐点对应（三参、递归内生效、零物化、骨架、终态 no-op、封闭 options 响亮拒绝新码不借路径/生命周期码、不传 options 逐字节现行为） | implements-existing-decision |
| ADR-0024 决策 2（键省略唯一形态；`depth:0` 目标自身同形空容器唯一例外） | S26 + `budgetFold` 仅节点自身折叠 | implements-existing-decision |
| ADR-0024 决策 3（清单恒在场；条目三字段；depth 尾段键名/width 父路径单条；omitted 直接子项数 O(1)；不携带子键列表） | `ReadLogicalValueTruncationEntry` + 构造点逐条对应；S24 反证 | implements-existing-decision |
| ADR-0024 决策 6（公共面归属；不新增第二条读路径） | 预算贯通既有双递归；`index.ts` 仅加法类型导出 | implements-existing-decision |
| ADR-0024 决策 4/5/7 + 文档负控（T2–T5 范围） | 未抢先实现；namespace-runtime/vfsl/registry/docs 零 diff | 范围纪律正确 |
| ADR-0008 继续有效面（缺席吸收/段纪律/XmlFragment 终态/D5 键空间/零 throw/已提交语义） | 导航循环预算盲；`readableOwnDataValue`/`readableArrayElement`/`isPlainRecord` 零改动；B16 以「文档可观测子项 = 0」解释 detached 计数，与已提交语义相容（SA8 实现后 §2 行 9 裁心） | no-conflict |
| ADR-0003（ValueSchema 9-kind 冻结） | 零接触 | no-conflict |
| `packages/doc-runtime/AGENTS.md`（schema 无关读取；公共 API 仅经 index.ts；surface guard 全覆盖；root typecheck/test 义务） | 全部兑现（SA7 终态证据） | 达成 |

## 6. 上游证据采纳

| 角色 | Verdict | SA10 采纳方式 |
|---|---|---|
| SA8 前置门禁 | clear（requiresConflictRecheck=true） | 冻结面承接核对（§1/§5） |
| SA2 设计评审 | approve（O-1/O-2） | O-1/O-2 落实复核（`projectValue:538` 折叠前置；`:219` 无 `?? ∞` 冗余） |
| SA3 实现报告 | clear | diff 逐 hunk 复核一致；m1/m2/m7/m8 变异证据在卷 |
| SA4 静态审查 | approve（4 条非阻塞观察） | 复核成立；观察项转 §7 披露 |
| SA7 动态验证 | approve（103 项探针全绿；m3–m6 击杀；root 门禁 ×2） | 已提交态 = 已验证态（sha256 逐字一致），证据链闭合 |
| SA8 实现后复查 | clear（D-3 闭合；requiresConflictRecheck=false） | 采纳，无遗留冲突面 |

## 7. PR 必须披露的未达成/遗留项（全部非阻塞，不阻断 approve）

| # | 项 | 性质 | 归属 |
|---|---|---|---|
| D-1 | T2–T5（runtime `readData` 五键组合、`resolveSchemaAtPath` 三参化、`DeepOptional`、registry 负控正则 + docs/integration 注记）**未实现** | 范围声明：issue #334 仅为 T1 切片（ADR-0024 决策 4/5/7 明确归后续票）；PR 文案不得暗示 runtime 五键已可用 | 后续 T 系列票 |
| D-2 | N-1/N-2 docs 债（ADR-0008/0016 镜像修订节、CONTEXT「载体投影读取」词条补三参句）未落地 | SA8 两版均登记为非阻塞 docs 债、非 T1 义务 | docs 收口票/T 系列末切片 |
| D-3 | SA4-O2：`plainDataSlotKeys` 与 `plainDataSlotCount` 为同一过滤规则两份实现（count ≡ keys.length），轻微漂移面 | 纯内部助手、无行为差异；SA4 判非阻塞 | 后续可选收口 |
| D-4 | SA4-O1：undefined 值键落在 width 前缀内的组合场景无专属单测 | SA6 S 清单同样未钉死该组合；SA7 probe3 B7 组已动态确认实现语义正确（占额度、被吸收、omitted raw 口径） | T2 组合测试时可补锚 |
| D-5 | SA4-O3/O4：`read.ts` 头注扩至 50 行（三处口径成文）；未知 accessor 键连 descriptor 都不读（比契约更紧一层，零可观测差异） | E10 已满足；实现自由度记录 | 无动作 |
| D-6 | 深层链式（数万层容器嵌套 + 大有限 depth）栈行为未进门禁 | SA6 §7/S22 注明为环境敏感观察项；RangeError 走既有 E100 → `PATH_NOT_ALLOWED`（与 legacy 同款） | 非门禁观察项 |
| D-7 | `wiki/raw/task_issue-334.md`（任务简报）在交付头中仍为 untracked | host 侧产物管理；其余 9 份流程产物已随 `08afd1f` 入库；不影响实现与验收面 | Controller/host |

**未发现**：关键 AC 的 partial/unmet/unachievable；错误实现；scope creep；冻结面破坏；新失败码跨包泄漏；条件在场截断通道；事后裁剪式预算；以 `_prelimContent` 计数；任何对 SA6 契约（含 B16/R9）的静默偏移。

## 8. Verdict

**approve**。最终提交 diff 忠实满足 issue #334 正文（What-to-build 五要素 + AC1–AC5）、SA6 验收契约迭代 1 全部钉死口径（含 B16/R9 detached 容器 `d===0` 折叠裁决：`budgetFold` 短路、`rawTotal := 0`、零公共 count 读、`d ≥ 1` 现行守卫原样）与 ADR-0024/ADR-0008 适用条款；范围零越界（ALLOW 六项 + 流程产物），冻结面逐项保持；证据链（SA3→SA4→SA7→SA8 复查）完整且已提交态与已验证态逐字节一致。§7 披露项均为已登记的非阻塞 follow-up/观察项。

## 9. requiresConflictRecheck

**false**。SA8 实现后复查已按 D-3 逐项闭合并置 false；本轮 spec 审查未发现新的 ADR 冲突面、未打开任何新决策面。

—— 审查结束 ——

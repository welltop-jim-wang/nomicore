# 冲突门禁报告 — issue #315（实现后复审 R2：F-SA4-1 诊断修复 vs ADR 全集 + 规范文档）

- SA8 dispatch：`sa-e728b206-7aa9-43a8-a51d-fb40e248e954`（mabf-sa8 / conflict-gate / iteration 2）
- 复审触发：iteration 1 报告 §10 边界条款（「若后续对 F-1 的处置改变了文本可达形态的判定级联/消息/锚位……须重开 SA8 冲突复查」）+ SA4 审查 `requiresConflictRecheck: true`（`task_issue-315_sa4_review.md` §12 N-2）+ SA3 rework 报告自报 `requiresConflictRecheck: true`。被审对象 = **F-SA4-1 诊断修复**（裸 `number & Int` 非整数失配消息回归设计 §8.4 模板）及其用户可见校验消息行为。
- 本报告**原位更新** iteration 1 同名报告：只裁当前被审对象（F-SA4-1 修复），不堆叠历史结论；iteration 1 对 iteration 0 全量 diff 的 14 项裁决与冻结面核对结论在其被审范围内仍然有效，本报告仅在修复触及面上重开核对。

## 1. Reviewed subject

**implementation**（实现后复审 R2，焦点 = F-SA4-1 修复）。被审对象：

- `packages/vfsl/src/validate.ts` 的 `intRangeRejectMessage` 分支重排（'type' → 'four-value' → 'integer'（设计 §8.4 模板）→ 'range'（双键同在场才可达））+ `intRangeReject`/`intRangeRejectMessage` 两处 JSDoc 更正；
- `packages/vfsl/test/validate-int-range.test.ts` C4d/C4g 新增 2 条 F-SA4-1 回归断言（裸 Int 消息含「整数」且不含 `undefined`；联合候选下钻同款）；
- 修复的**用户可见校验消息行为**（裸 `number & Int` + 有限非整数 → `期望整数，实际 1.5`；修复前为 `期望整数区间 [undefined, undefined]，实际 1.5`）。

只裁「修复是否遵守现有决策、兑现已有义务、是否需要决策演进、是否存在无合法 override 的硬冲突」；不判修复优劣、测试充分性、Issue 验收完成度（SA4/SA7 职责）。未修改任何被审对象或决策文档，未运行测试。

## 2. Inputs and decision set

| 输入 | 状态 |
| --- | --- |
| `docs/adr/` 全集 22 文件（0001–0014、0016–0023；0015 空缺无引用），本次焦点：**ADR 0020**（决策 5/6；决策 9 与决策 3 的 -0 句已 supersede，不计入约束）、**ADR 0021**（决策 1/3/6/7）、ADR 0003（§3 联合成员标注）、ADR 0007 | 全读（焦点 ADR 逐条重读） |
| 根 `CONTEXT.md` + `docs/vfsl/v1-spec.md`（§3「Int / Range」节「判定相位」/「number 值域」节「消息不冻结」、§4 错误模型 L345-347）+ `docs/vfsl/schema-authoring-guide.md` | 全读；修复未触碰三者（mtime 23:22 = iteration 0 窗口，见 §5 爆炸半径） |
| 模块 AGENTS：`packages/vfsl/AGENTS.md`（兼容行为面清单）、根 `AGENTS.md`、`docs/AGENTS.md` | 全读 |
| 链上产物：`task_issue-315.md`（REST comments 快照空，无 Owner 追加要求——本 dispatch 明示）、`_sa4_review.md`（reject：F-SA4-1 MAJOR + §10 修复指令）、`_sa3_impl.md`（iteration 1 rework 报告）、`_design.md`（§7.2 B1–B6、§8.4 消息模板与 R1–R3）、`_sa6_contract.md`（§12.0 断言纪律、§12.5 C4d R1/R2/R3）、`_conflict_report.md` + `_relevant_decisions.md` + iteration 1 本报告 | 全读 |
| 当前工作树：`git status --short` 全集（18 修改 + 5 新测试 + wiki 产物，与 iteration 1 集合一致，无新增文件）；`git diff packages/vfsl/src/validate.ts` 恰 3 hunk（数值约束工具块 / `contradictsInner` / `validateValue`）；`validate.ts`/`validate-int-range.test.ts` 当前源码逐行读；`parser.ts` `parseIntType`/`parseRangeType`/`parseConstraintArgs` 读源核对文本可达性 | 已核 |

无缺失输入。源码/测试仅作现状事实确认；`wiki/raw/` 历史工件按 `docs/AGENTS.md` 属证据非规范（设计 §8.4 模板作为**链上批准面**参与保真度核对，冲突基准仍为 ADR + CONTEXT + 规范文档 + 模块 AGENTS 收录决策）。

## 3. Decision analysis

四级口径：no-conflict / implements-existing-decision / evolution-required / hard-conflict。被审行为以**实际源码**为准（非 SA3 报告自述）。

| # | Decision | Clause | Subject behavior（F-SA4-1 修复实际行为） | Classification | Evidence | Required action |
|---|---|---|---|---|---|---|
| 1 | ADR 0020 决策 6 | 「失配报错（**消息含期望区间/整数性描述与实际值**），纳入全收集语义与工作预算计费；判定为 O(1) 比较」 | 判定级联逐字节未变（`intRangeReject` `:227-233` 四步：typeof → 四值 → 整数性 → 闭区间；第 ④ 步双键谓词保持）；消息走 `ctx.emit` thunk（计数态/截断态不构造，`:595-597`）+ 进入即 `charge(ctx,1)`（`:557`）继承。修复后各维消息：裸 Int 非整数 → ``期望整数，实际 1.5``（整数性描述 + 实际值 ✓）；`Int<1,100>` 非整数 → ``期望整数（1 ≤ v ≤ 100），实际 1.5``；越界 → ``期望整数区间 [1, 100]，实际 101``；Range → ``期望区间 [0.5, 1.5]，实际 2``。修复前裸形消息宣称一个不存在的区间并渲染 `[undefined, undefined]` 端点——对该路径的 ADR 内容义务为退化履行；修复恢复逐维准确履行 | **implements-existing-decision** | `validate.ts:227-233,556-598`；ADR 0020 L136-146 | 无 |
| 2 | ADR 0021 决策 3 | typeof 非 number 失配「维持现有『类型不匹配：期望 number，实际 X』」；四值新消息「期望 number（有限数且非 -0），实际 …」且 -0 经 `Object.is` 识别；validate 与 validate-patch 两写路径同口径；「消息文案不进冻结面」 | 'type' 分支逐字节维持 ``类型不匹配：期望 number，实际 ${jsonTypeOf(value)}``（`:242-244`）；'four-value' 分支逐字节 ``期望 number（有限数且非 -0），实际 ${renderNumberValue(value)}``（`:245-247`，域短语与 ADR 文本逐字同）——两分支**零改动**；-0 在第 ② 步先于整数性/区间步拦截（`:229`），`renderNumberValue` 经 `Object.is` 渲染 `'-0'`（`:182`），integer/range 分支不可能收到 -0，无 `String(-0)==="0"` 误导面；validate-patch 共享 `validateSubtree` 解释器（`validate-patch.ts` 零改动）→ 两写路径消息同口径自动保持；本次措辞变更（integer/range 两维）落在 ADR 明文的非冻结面 | **no-conflict** | `validate.ts:229,242-247,180-186`；ADR 0021 L65-73；`git status`（validate-patch.ts 不在改动集） | 无 |
| 3 | v1-spec §3「Int / Range」节「判定相位」条 + §3「number 值域」节「消息不冻结」条 | 「逐值判定属语义层（`validateLogicalSnapshot` 与 validate-patch 同口径），**失配消息不属本规格冻结面**」；「四值拒绝的消息文案不属本规格冻结面（与 §4『消息正文措辞不冻结』同姿势）」 | F-SA4-1 修复改变的用户可见消息文本恰落在这两条明文的规范自由面上；规范文本本身未被修复触碰（spec 修订为 iteration 0 范围、ADR 0020 决策 10 授权，iteration 1 已裁 clear，本轮未重开） | **no-conflict** | `docs/vfsl/v1-spec.md` L287-289、L307-308；spec mtime 2026-09-12T23:22（iteration 0 窗口） | 无 |
| 4 | v1-spec §4 错误模型（L345-347） | 前缀 ``VFSL-E<编号>: `` 冻结、消息正文措辞不冻结、测试以前缀为断言锚——**parse 侧**错误模型 | 修复零触碰 parse 侧消息（`parser.ts` 不在 rework 改动集，mtime 23:25 = iteration 0 窗口；SA4 N-3 陈旧注释 `:643` 原样在位即旁证）；validate 侧 issue 无错误码前缀（R1 不变量，`{message,path}` 形状），与本条无交集 | **no-conflict** | `parser.ts:643`（原样）；`validate.ts:596`（ctx.emit 通道）；v1-spec L345-347 | 无 |
| 5 | 设计 §8.4 冻结消息模板 + R1/R2/R3 内容不变量（链上批准面：SA2 approve + SA6 §12.5 C4d 同文收录） | 四分支模板：'integer' → ``期望整数${t.kind === 'int' && t.min !== undefined ? `（${t.min} ≤ v ≤ ${t.max}）` : ''}，实际 ${renderNumberValue(value)}``；'range' → ``期望${t.kind === 'int' ? '整数' : ''}区间 [${t.min}, ${t.max}]，实际 …``；消息惰性构造（thunk 门控） | 修复后 `intRangeRejectMessage`（`:240-254`）四分支与设计模板**逐字符对齐**（含条件后缀的 `kind === 'int' && min !== undefined` 双条件与设计伪码同文）；'range' 维经第 ④ 步双键谓词构造性保证双端点在场（`:231`）→ 渲染真实端点、无 undefined 槽；消息留在 emit thunk 内（`:596`）维持 R4 门控；R1（普通 issue、非 E100 前缀、非预算终态）经 `ctx.emit` 通道天然满足；R2（实际值经 `renderNumberValue`，-0 与 0 消息可分：`Int<1,100>` 下 0 → ``期望整数区间 [1, 100]，实际 0``（range 维）、-0 → ``期望 number（有限数且非 -0），实际 -0``（four-value 维））；R3（`b=101` 含 `100`；`b=1.5` 与 `b=101` 互异）。残余 `undefined` 渲染仅存于**单键手造 int 叶**（`{kind:'int',min:1}` 非整数 → ``期望整数（1 ≤ v ≤ undefined），实际 …``）——该形态文本层构造性不可达（`parseRangeType` 零参即 E100、`parseIntType` 零参/两参二值，`parser.ts:617-633`；单键无生产点），且设计模板本身对该手造形同样渲染 `undefined`——SA4 §10 修复指令明文允许「`undefined` 端点渲染仅保留给真正的单键手造形态」 | **implements-existing-decision**（iteration 1 §3 #5 登记的消息模板偏离经修复消除；SA2 O-2 风险闭合） | `validate.ts:240-254,595-597` 对照设计 `:338-348/:350`；`parser.ts:617-633`；`task_issue-315_sa4_review.md` §10 | 无 |
| 6 | SA8 iteration 1 §8 F-1 处置授权 + SA4 N-2 | 两种可接受处置：(a) 对齐设计 fail-closed / (b) 保持实现 + 注释准确；处置边界「不得改变文本可达形态的判定/消息/锚位」（消息面变更本身即重开本复查的触发条件） | 处置 **(b)** 落实：第 ④ 步谓词 `min !== undefined && max !== undefined && !(min <= value && value <= max)` 保持（`:231`）；JSDoc 更正为准确描述（`:220-222`「单键手造叶……区间步跳过，有限整数放行；与设计 §8.4 伪码 fail-closed 分叉已登记（SA8 F-1，处置 (b)）」；`:237-239` 分支次序说明 + undefined 端点可达域）。文本可达形态的**判定级联零变化**（四步与谓词逐字节同 iteration 0）、**锚位零变化**（parse 侧零触碰）、**消息变化恰为 F-SA4-1 修复指令的目标本身**（回归设计 §8.4 模板，落在规范明文非冻结面）——边界条款的立法目的（防未授权语义漂移）未破例，本复查即该条款的执行 | **no-conflict**（处置合规，F-1 就此闭合） | `validate.ts:220-222,231,235-239`；iteration 1 报告 §8 F-1；SA4 §12 N-2 | 无 |
| 7 | `packages/vfsl/AGENTS.md` | 兼容行为 = 错误码 / issue 顺序 / 路径报告 / 信封严格性 / 指纹输入；公共 API 只经 `src/index.ts`；公共畸形输入路径返回判别结果不抛 | 修复 confined 于内部助手函数 + 既有 case 接线（`validateValue` int/range case 形状不变，仅消息构造换助手调用）；`index.ts` 零改动（无新公共入口）；`intRangeRejectMessage` 纯函数不抛；issue 形状 `{message,path}` 与顺序（源序全收集）不变——兼容行为面五项零触碰（消息措辞不在清单内） | **no-conflict** | `validate.ts:591-598`；`git status`（index.ts 不在改动集）；AGENTS 兼容清单 | 无 |
| 8 | ADR 0003 §3 | no-match 诊断报失败距离最小成员，「消息标注『联合成员 i/N』相对定位」 | 联合候选下钻标注机制零改动（`:524-531` label 前缀 + annotated emit 包装原样）；修复仅改善 label 之下的内层消息（裸 Int 成员非整数 → ``联合成员 1/2：期望整数，实际 1.5``），标注格式与「前缀不改变 issue 计数」性质保持；C4g 新增断言钉下钻消息不含 `undefined` | **no-conflict** | `validate.ts:524-536`；ADR 0003 L24；`validate-int-range.test.ts:380-388` | 无 |
| 9 | ADR 0020 决策 5 + ADR 0021 决策 6 + ADR 0007 L17（指纹纪律）+ 设计 §11 DENY 面 | 既有语义指纹（`sha256:v1:`）全部不变；tokenizer/fingerprint/DENY 面零触碰 | rework 爆炸半径恰两文件：`validate.ts` + `validate-int-range.test.ts`（mtime 2026-09-13T00:00，其余生产文件均 ≤ 2026-09-12T23:25；`git status` 文件集合与 iteration 1 逐条一致、无新增文件）；`fingerprint.ts`/`tokenizer.ts`/`validate-patch.ts`/`pattern.ts`/`index.ts`/`vfsl-protocol/**`/`domains/**`/CI 配置全部不在改动集；`validate.ts` 不在指纹输入链（指纹源 = IR/derived，`ir.ts` mtime 23:19 未再触碰） | **no-conflict** | `git status --short`；mtime 证据（`ls --time-style`）；DENY 清单逐条核对 | 无 |
| 10 | SA6 §12.0 断言纪律 + §12.5 C4d | 消息文案不进冻结面——只断码前缀/path/计数，C4d 明列内容不变量（R1/R2/R3）除外 | 新增 2 条断言为**内容不变量级**（含「整数」、不含 `undefined`）而非全文钉死——与 R3「`b=101` 含 `100`」同款纪律，未把措辞升格为冻结面；断言只观察公共接缝（`validateLogicalSnapshot`）运行时输出，不 grep 源码、无 skip/only | **no-conflict** | `validate-int-range.test.ts:292-298,380-388` 对照 `:10-12`（断言纪律声明） | 无 |

**统计**：10 项对照——no-conflict 8 项、implements-existing-decision 2 项、evolution-required 0 项、hard-conflict 0 项。

## 4. Overrides

| Old decision | Override authority | Scope | New obligation | 实现核对 |
|---|---|---|---|---|
| （无新增）iteration 1 登记的唯一 override（v1-spec §8 保留名增补例外，首例 ADR 0020 决策 1）本轮未被触碰——修复不涉保留名、例外条款与收窄面 | — | — | — | spec §8 零触碰（mtime 旁证 + iteration 1 机械核证结论未重开） |

无任何非正式 override。Issue 评论快照为空（本 dispatch 明示 REST comments snapshot 空），无 Owner 评论级 override——亦无需：消息面变更有规范明文自由面授权。

## 5. Frozen surfaces

| Surface | Must remain unchanged | Evidence | Actual result（修复后核对） |
|---|---|---|---|
| `intRangeReject` 判定级联 | 四步次序与第 ④ 步双键谓词（iteration 0 形态） | 设计 §8.4 伪码（分叉已按 F-1 处置 (b) 登记）；SA4 §10 验收「判定级联零变化」 | 一致（`:227-233` 逐字节同 iteration 0；SA3 声明与源码相符） |
| B6 类型级硬矛盾 | `contradictsInner` int/range → `typeof value !== 'number'` | 设计 §7.2 B6、§8.4 | 一致（`:427-431`，未触碰） |
| 错误码集合 / parse 侧消息前缀 | 21 码不新增；`VFSL-E<编号>: ` 前缀冻结 | v1-spec §4；ADR 0020 决策 4 | 一致（修复零触碰 parse 侧与错误码枚举） |
| issues 形状 / 单错误模型 / issue 顺序 | `{message,path}`；全收集源序 | v1-spec §4；`packages/vfsl/AGENTS.md` | 一致（emit 通道与形状原样） |
| 既有锚位规则 | E303/E100/E301 锚位（含本票新增细则） | v1-spec §4；ADR 0020 决策 4 | 一致（parser 零触碰） |
| 指纹域 | `sha256:v1:` 前缀；既有 fixture 双指纹 + `generated.ts` 逐字节 | ADR 0020 决策 5、ADR 0021 决策 6 | 一致（fingerprint/tokenizer/domains 零触碰；validate.ts 不在指纹输入链） |
| 四值基线（裸 number） | `scalarAccepts`/`isJsonFaithfulNumber` 不回归 | ADR 0021 决策 1；v1-spec §3 | 一致（`:190-195` 未触碰） |
| ADR 0021 决策 3 两分支消息 | typeof 失配维持现有文案；四值消息域短语 + `-0` 经 `Object.is` | ADR 0021 L67-71 | 一致（`:242-247` 逐字节维持） |
| 联合成员标注 | 「联合成员 i/N」前缀机制 | ADR 0003 §3 | 一致（`:524-531` 未触碰） |
| 公共 API 面 / 信封形状 | `index.ts` 唯一入口；四键信封 | 两模块 AGENTS；ADR 0007/0017 | 一致（零触碰） |
| v1-spec §8 例外条款 | 两类例外并列、逐字节 | v1-spec §8 | 一致（spec 未被修复触碰） |
| validate 失配消息措辞 | **规范明文非冻结面**（v1-spec §3 两处 + ADR 0021 决策 3 + SA6 §12.0）——约束仅为内容义务（ADR 0020 决策 6 + R1/R2/R3） | 见 §3 #1/#2/#3/#5 | 修复后各维消息履行全部内容义务；`undefined` 渲染从文本可达面消除（残余仅单键手造叶，与设计模板同行为） |

## 6. Evolution requirements

无 `evolution-required` 裁决项。说明：F-SA4-1 修复是**向既有决策与链上批准模板的回归**（消除偏离），不改变任何 ADR/CONTEXT/规范/协议契约，无需决策演进或文档修订（消息措辞属规范明文自由面，spec 无需为措辞变更而改——spec 对消息的唯一规范性陈述是「不冻结」本身）。

## 7. Hard conflicts

**无。** 逐项排除：

1. **用户可见消息文本变更 vs 冻结面**——v1-spec §3「判定相位」/「消息不冻结」与 ADR 0021 决策 3 三处明文将 validate 失配消息措辞排除在冻结面外；变更内容履行 ADR 0020 决策 6 内容义务。
2. **消息分支重排 vs 判定语义**——重排仅存在于消息构造函数内部（先取 verdict 再分派），判定级联 `intRangeReject` 逐字节未变；无伪 ok / 伪拒变化。
3. **残余 `undefined` 渲染 vs 设计模板**——仅单键手造 int 叶（文本层构造性不可达：`parseRangeType` 强制两参、`parseIntType` 零参/两参二值），且与设计 §8.4 模板对该手造形的自身行为一致；SA4 §10 修复指令明文允许。
4. **F-1 处置 (b) vs 设计 fail-closed 伪码**——iteration 1 已裁两种处置等价可接受；(b) 的注释更正义务已兑现（`:220-222`/`:235-239`），分叉域仍限文本不可达手造叶；无 ADR/CONTEXT/规范条款约束该形态。
5. **新增消息内容断言 vs 措辞自由**——断言为内容不变量级（含「整数」/不含 `undefined`），与既有 R2/R3 纪律同款，未升格为冻结面。

## 8. Required actions（非阻塞登记；verdict 不依赖）

1. ~~F-1（级联第 ④ 步谓词与注释）~~ **已闭合**：按处置 (b) 落实——谓词保持、注释更正为准确描述（`validate.ts:220-222,235-239`）。SA2 O-1 注记与 SA3 报告声明随之成立。
2. **F-2（承接 SA4 N-3，注释陈旧——维持登记）**：`parser.ts:643`「EOF 锚经 err() 既有回退 (1,1)」与实际（tokenizer 恒产出 eof 记号、锚其真实坐标）不符——本轮核对原样在位（旁证 parser 未被 rework 触碰）。行为合规，注释措辞待顺手修正（SA3 已声明超出 F-SA4-1 范围）。
3. **F-3（非规范面旧措辞残留——维持登记）**：`tests/acceptance/exemplar/spec-exemplar-v1.md` 与 `.scratch/` 的「唯一允许的交叉类型」旧句——非规范面，备查。
4. **F-4（文案引用精度——维持登记）**：`-0` 端点 E100 消息引「ADR 0020 决策 3」（`parser.ts:685` 原样；` :441` 为 #314 既有字面量闸门同款文案），精确归属为经 ADR 0021 决策 2 修订；消息正文不进冻结面，留作文案清理。
5. （观察）C4d/C4g 新断言把「不含 `undefined`」钉为回归不变量——属内容不变量纪律的合理延伸；若未来消息模板再演进（如多语文化），该断言随不变量而非措辞走，无需预置动作。

## 9. Verdict

**clear**

- 10 项对照全部为 no-conflict（8）或 implements-existing-decision（2）；无 evolution-required、无 hard-conflict。
- SA4 §10 F-SA4-1 修复指令的冲突面逐条兑现核对：① 分支重排（'integer' 维先行、按设计模板条件渲染区间后缀）✓（`:248-251` 与设计 §8.4 逐字符对齐）；② `undefined` 端点渲染仅保留给单键手造形态 ✓（'range' 维构造性双键在场；裸形走 'integer' 维无后缀）；③ 注释更正 ✓（两处 JSDoc 准确描述分叉域与分支次序依据）；④ C4d 内容断言 ✓（`:294-298` 含「整数」且不含 `undefined`；C4g 联合下钻同款 `:380-388`）。
- 验收面（判定/指纹/锚位零变化、b 字段 R2/R3 消息零变化）静态核对成立：判定级联逐字节同 iteration 0、指纹链文件零触碰、parse 侧零触碰、`Int<1,100>` 各维消息模板与设计一致（R3 的 `b=101` 含 `100`、两维互异保持）。SA3 报告声明的实测证据（焦点 273 passed / 全仓 3863 / 突变对照红灯复现旧消息）与静态推演一致——SA8 未复跑（纪律）。
- iteration 1 §10 边界条款的执行闭环：触发条件（文本可达形态消息变更）已经本复查裁决——该消息面为规范明文非冻结面且修复方向即回归链上批准模板，无决策冲突；重开环关闭。
- 信息充分性：焦点 ADR/spec/AGENTS 条款、修复前后消息行为、文本可达性（parser 构造性证明）、爆炸半径（mtime + git status + hunk 清单）全部静态核实，无信息不足。

## 10. requiresConflictRecheck

**false**

理由：F-SA4-1 修复触发的重开条件（文本可达形态消息变更）已由本复查闭合——用户可见校验消息措辞经三处规范明文（v1-spec §3 两条 + ADR 0021 决策 3）裁定为非冻结面，修复履行 ADR 0020 决策 6 内容义务并逐字符回归设计 §8.4 模板；判定级联/锚位/指纹/公共 API/正式 override 均无待实现核对项。F-2–F-4 为注释与非规范面登记项，其处置不产生新决策面。**后续重开条件（重述）**：任何改动触碰 §5 冻结面（错误码/锚位/指纹/例外条款/tokenizer/公共 API/判定级联/ADR 0021 决策 3 两分支消息），或引入新的文本可达判定/消息/锚位语义变化时，须重开 SA8 冲突复查；纯消息措辞变化（非冻结面、不破坏内容义务）不再触发。

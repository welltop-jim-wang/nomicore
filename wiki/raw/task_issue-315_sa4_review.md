# SA4 实现静态审查 — issue #315：VFSL 三约束形态核心链（number & Int / Int<min,max> / Range<min,max>，ADR 0020）

- Reviewer：SA4（mabf-sa4 / implementation-review / **iteration 1：F-SA4-1 修复复审**）
- 审查对象：当前工作树未提交实现 + 测试（基线 HEAD `7b92af0`；`git status` = 18 modified + 5 新测试文件 + wiki 产物）与 SA3 iteration 1 rework 报告
- 本轮范围：**F-SA4-1（iteration 0 唯一 MAJOR）修复验证 + 全链回归面复核**；iteration 0 已全量审查且未被 rework 触碰的部分（mtime 证据，见 §2）按原结论承继，不重复展开
- 审查方式：静态源码走查 + 设计模板逐字符对照 + 独立消息矩阵推演；未修改任何实现/设计/测试，未运行测试或服务（SA4 纪律；`git diff --check` 只读复跑 exit 0）
- 产物：本文件（**原位更新** iteration 0 报告——F-SA4-1 已修复并验证，从当前阻断项移除，保留 Finding ID 供返工映射）

---

## 1. Reviewed inputs

| 输入 | 状态 |
| --- | --- |
| `wiki/raw/task_issue-315.md`（Issue body 5 AC；Comments 空——REST snapshot 空，无 Owner 追加要求） | 已读 |
| `wiki/raw/task_issue-315_design.md`（§7.2 B1-B6 冻结、§8.4 消息模板、§11 ALLOW/DENY、§12 映射） | 已读（§8.4 模板逐字符重对照） |
| `wiki/raw/task_issue-315_sa6_contract.md`（§12 C1-C8 细则权威、§12.0 断言纪律、§12.5 C4d R1/R2/R3） | 已读 |
| `wiki/raw/task_issue-315_sa2_review.md`（approve；N-1/N-2 + O-1..O-4） | 已读 |
| `wiki/raw/task_issue-315_sa3_impl.md`（**iteration 1**：F-SA4-1 修复指令逐条兑现 + 突变对照 + 门禁重跑） | 已读 |
| `wiki/raw/task_issue-315_conflict_report.md` + `_relevant_decisions.md` + `_implementation_conflict_report.md`（**R2 原位更新**：F-SA4-1 修复冲突面复审，verdict clear，iteration 0 `requiresConflictRecheck` 环闭合） | 已读 |
| 当前 diff 全集（`git diff` 18 文件；`validate.ts` 恰 3 hunk）+ 5 新测试文件全文（重读 `validate-int-range.test.ts` 全 399 行）+ git status | 已读 |
| 焦点源码逐行重核：`validate.ts`（intRangeReject / intRangeRejectMessage / contradictsInner / validateValue / validateUnion label / renderNumberValue / isJsonFaithfulNumber / scalarRejectMessage）、`validate-int-range.test.ts`（FIXTURE/MISMATCHES/C4d/C4g） | 已读 |
| mtime 证据（`ls --time-style` 全 src/test 面）：rework 爆炸半径 = 恰两文件（`validate.ts` 2026-09-13T00:00:48、`validate-int-range.test.ts` 00:00:24；其余生产文件全部 ≤ 2026-09-12T23:25:05，即 iteration 0 报告落笔 23:58:42 之前） | 已核 |

无缺失输入。

## 2. Verdict

**approve**（iteration 0 唯一 MAJOR **F-SA4-1 已修复并经静态验证闭合**；余 N-1/N-3/N-4/N-5/N-6 为 MINOR/观察不阻断）。

F-SA4-1 修复核验成立：`intRangeRejectMessage` 分支次序重排为判定级联次序（`'type'` → `'four-value'` → `'integer'` → `'range'`），`'integer'` 维先行并按设计 §8.4 冻结模板条件渲染区间后缀——与设计伪码（design `:344`）**逐字符对齐**（含 `kind === 'int' && min !== undefined` 双条件与 `${min} ≤ v ≤ ${max}` 后缀格式）。裸 `number & Int` + 有限非整数（如 1.5）恒得 `期望整数，实际 1.5`；末行区间模板仅 `'range'` 维可达，而该维经判定级联第 ④ 步双键谓词构造性保证双端点在场，且调用点 `!== 'ok'` 门控使 `'ok'` 永不渲染——**文本可达全路径零 `undefined` 槽**。回归覆盖在位且具判别力：C4d `a=1.5` 断言 + C4g 联合候选下钻同款（判别断言 = `not.toContain('undefined')`——旧缺陷串 `期望整数区间 [undefined, undefined]，实际 1.5` 含「整数」故第一断言不判别，第二断言杀死回归；SA3 突变对照实测恢复旧次序时 2 断言均红、实得串与本审查 iteration 0 静态推演逐字一致）。N-2/SA8 F-1 按处置 (b) 闭合（谓词不动 + 注释更正为准确描述）。判定级联、锚位、指纹、E 码面、issue 计数、公共 API 逐字节零变化；SA8 R2 复审已裁 clear。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
| --- | --- | --- |
| AC1-AC5 + SA2 N-1/N-2 + SA8 Required actions 1-5 | iteration 0 §3 已逐条核验；本轮 mtime 证据确认对应文件（parser/ir/semantic/shapes/resolve/derived/evaluate/codegen/投影/文档/翻转测试）**均未被 rework 触碰**（≤ 23:25:05 < 复审线 23:58:42），原结论承继 | 落实（承继） |
| **SA2 O-2（合并 case 消息模板 undefined 风险）**——iteration 0 裁「未落实」（F-SA4-1） | `validate.ts:248-251`：`'integer'` 维先行 + `kind === 'int' && min !== undefined` 条件后缀（设计模板逐字符对齐）；`:252-253` 末行仅 `'range'` 维可达（双键构造性在场）；`:595` `!== 'ok'` 门控 | **落实**（iteration 1 修复；SA3 报告 O-2 行同步改判「落实」且附实测消息——声明与实现现已一致） |
| **SA4 F-SA4-1（iteration 0 §10 修复指令 4 要素）** | ① 分支重排 ✓（`:240-254`）；② `undefined` 端点仅存单键手造 int 叶（文本不可达，SA8 R2 #5 裁设计模板对该形同样如此渲染、属明文允许保留域）✓；③ 注释更正 ✓（`:220-222` F-1 处置 (b) 准确描述、`:237-239` 分支次序依据 + undefined 可达域、`:249`/`:252` 行内注释）；④ C4d 内容断言 ✓（`:294-298`）+ 联合形态同款（`:380-388`，超出指令的可选加强） | **全部兑现** |
| SA6 §12.0 断言纪律（新增断言合规） | 新 2 例仅观察公共接缝运行时输出（`parseVfsl`→`evaluate`→`validateLogicalSnapshot`），消息断言属 C4d 明列内容不变量扩展（含「整数」/不含 `undefined`——语义承载维，非冻结文案钉死）；无 skip/only/todo（全 5 新测试文件 grep 复核） | 落实 |
| SA8 R2 复审（iteration 0 `requiresConflictRecheck` 的执行） | `_implementation_conflict_report.md` 原位更新（mtime 00:19:20 > rework 00:00:48）：消息面裁定为规范明文非冻结面（v1-spec §3 两处 + ADR 0021 决策 3），修复方向 = 回归链上批准模板，verdict **clear**，「重开环关闭」 | 闭合 |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
| --- | --- | --- | --- |
| D1/D2/D4/D5/D6 + B1-B6 冻结值 | iteration 0 §4 逐项核验；对应文件未被 rework 触碰（mtime） | 一致（承继） | — |
| **D3 validate 级联**（typeof→四值→整数性→区间；每叶至多 1 条） | `intRangeReject`（`:227-233`）**与 iteration 0 逐字节相同**（四步与谓词零变化，含第 ④ 步 `min !== undefined && max !== undefined`——SA8 F-1 处置 (b) 授权保持） | 一致 | — |
| **D3（消息模板 §8.4）**四分支：`'type'`/`'four-value'`/`'integer'`（条件后缀）/`'range'`（真实端点）；thunk 门控 | `intRangeRejectMessage`（`:240-254`）+ 调用点（`:595-597`）。逐字符对照：`'integer'` 行 = 设计 `:344` 同文（`t.kind/t.min/t.max` → 参数名 `kind/min/max`，条件与格式逐字符同）；`'range'` 行 = 设计 `:345` 同文；`'type'`/`'four-value'` 行与设计及既有 `scalarRejectMessage` 域短语逐字同；消息构造留在 `ctx.emit` thunk 内维持计数/截断态门控（R4） | **一致**（iteration 0 偏离已消除） | — |
| 设计 §8.4 级联第 ④ 步 `（min !== undefined）` vs 实现双键谓词 | 仅单键手造叶分叉（min-only 有限整数放行）；文本不可达（parser 构造性排除 + `evaluate.valueOf` 归一）；SA8 R2 #6 裁处置 (b) 合规、F-1 就此闭合；注释已准确 | 一致（授权偏离，已登记闭合） | — |

## 5. 架构一致性与惯例

iteration 0 §5 全项（责任归属/相似能力对照/单一事实源/生命周期/平行机制）核验的代码面本轮零触碰（mtime），结论承继。本轮增量核对：

- **单一事实源（消息）**：`intRangeRejectMessage` 仍为唯一消息构造点；全仓 grep `期望整数|整数区间|期望区间`（packages/apps/domains 全 ts 面）仅命中 `validate.ts` 源与 `validate-int-range.test.ts` 断言——无第二处钉死或复述该文案，消息变更零外溢（SA3 受影响 package 回归 988 tests 绿互证）。
- **判定/消息分工保持**：重排仅存在于消息构造函数内部（先取 verdict 再分派）；`intRangeReject` 谓词零变化——无伪 ok / 伪拒 / 维度误报迁移。`'integer'` 分支的 `kind === 'int'` 冗余检查（该维 kind 恒为 'int'）为无害防御，与设计伪码同文。

## 6. 文件范围审查

| Changed path | ALLOW entry | Purpose | Assessment |
| --- | --- | --- | --- |
| 12 个生产 src + 3 文档 + 4 测试修改 | ✅ 逐条有 ALLOW 条目（iteration 0 §6 已核） | §8.1-§8.7 | 在范围（承继；rework 未新增路径） |
| `packages/vfsl/src/validate.ts`（rework 触碰） | ✅ §8.4（判定 + 消息构造 + 类型级矛盾） | F-SA4-1 修复 | 在范围；diff 恰 3 hunk（工具块 / contradictsInner / validateValue），与 iteration 0 集相同，变化仅限工具块内分支次序与注释 |
| `packages/vfsl/test/validate-int-range.test.ts`（rework 触碰，新文件） | ✅ §10.2 C3/C4 | F-SA4-1 回归断言 +2（51→53） | 在范围；既有 51 例断言逐条未动（R2/R3/C4b 矩阵/C4f/C4g 原例原文在位），纯 additive |
| `packages/vfsl/test/evaluate-derived-schema.test.ts` | ⚠️ ALLOW 外（SA3 Deviation #1，iteration 0 N-1） | typecheck 机械强制的镜像类型同步 | 维持 MINOR（N-1）：纯类型 +5 行、零断言变化；SA8 两轮复审均已核证非决策面。**建议总控追认为 ALLOW 修订**，非本轮阻断项 |

**DENY LIST 零触碰**（rework 后复核）：`tokenizer.ts`/`fingerprint.ts`/`pattern.ts`/`validate-patch.ts`/`index.ts`/`vfsl-protocol/**`/`domains/vfs3-assets/**`/ADR/spec §5/§8/机检 py/CI 配置均不在改动集；无探针/临时文件残留（SA3 声明探针已删，`git status --porcelain` 非 wiki 未跟踪项恰为 5 个新测试文件——复核成立）；`git diff --check` exit 0。指纹输入链不含 `validate.ts`（指纹源 = IR/derived，`ir.ts` mtime 23:19:40 未再触碰）——消息面与指纹面构造性隔离。

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
| --- | --- | --- | --- | --- |
| 失配消息文本（validate 公共输出） | 终端用户 / 联合候选诊断嵌入（`validateUnion` label 前缀 `联合成员 i/N：`，`:529-531`） | 裸 int 非整数 → `期望整数，实际 1.5`；联合下钻 → `联合成员 1/2：期望整数，实际 1.5`（label 自身无 undefined；C4g F-SA4-1 例对全部 issues 断言不含 undefined） | 无（诊断质量修复方向） | — |
| 判定结果 / issue 计数 / path / E 码 | doc-runtime mutation-local、namespace-runtime 写路径、既有全部测试 | 判定级联逐字节零变化；`contradictsInner`/`validateValue` case 零变化；每叶至多 1 条保持 | 无 | — |
| 既有测试断言（全仓） | 54 文件/988 tests（受影响 package）+ 全仓 353 files/3863 tests（SA3 复跑 exit 0） | 旧缺陷消息无任何测试钉死（grep 复核）；R2/R3 断言原文未动且绿 | 无 | — |
| 其余契约面（parseVfsl/evaluate/projection/VfslKind/PathSchema） | iteration 0 §7 已核 | 对应文件零触碰（mtime） | 无（承继） | — |

## 8. 错误、恢复与并发

- iteration 0 §8 全项承继（同步纯函数链、单错误模型、无并发面、revert 即恢复）。
- 本轮增量：F-SA4-1 修复后**无静默失败形态残留**——消息函数全分支（4 verdict × 3 键形）推演：文本可达形态（裸形/双键形 × 5 verdict）全部渲染真实值，无 undefined 槽；`renderNumberValue` 对 -0/NaN/±Infinity 的渲染（`-0`/`NaN`/`Infinity`/`-Infinity`）在四值维与既有 `scalarRejectMessage` 逐字同源。
- `'ok'` verdict 不构造消息（调用点门控 + thunk 惰性）——计数态/截断态零消息开销保持。

## 9. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
| --- | --- | --- | --- | --- |
| `validate-int-range.test.ts`（53 例，rework 后） | C3/C4a-g 全量（iteration 0 已核 51 例）+ **F-SA4-1 回归 2 例**：C4d `a=1.5` message 含「整数」且不含 `undefined`（`:294-298`）；C4g `number & Int \| string` + `{v:1.5}` 首 issue 含「整数」且全部 issues 不含 `undefined`（`:380-388`） | vitest include 面零配置发现；焦点 10 文件 runner 实跑（SA3：273 passed 含此 2 例） | 无 skip/only/todo；断言只观察公共接缝输出；判别力经突变对照证明（恢复旧次序 → 2 例红、实得旧缺陷串逐字复现）；fixture/helper 复用主夹具无隔离问题 | — |
| 其余 4 新测试 + 2 修改测试 | iteration 0 §9 已核 | 同上；全仓 runner 353 files/3863 exit 0 | 零弱化（rework 未触碰） | — |
| 突变敏感性（F-SA4-1 面） | SA3 突变对照：临时恢复旧分支次序仅跑 `-t "F-SA4-1"` → 2 failed \| 1 passed（probe 收尾删除，git status 复核无残留） | 临时 probe（已删） | 与本审查 iteration 0 静态推演串逐字一致——测试敏感性实证 | — |

## 10. Required revisions

| Finding ID | Severity | Evidence | Problem | Required change | Acceptance | Suggested routing |
| --- | --- | --- | --- | --- | --- | --- |
| ~~F-SA4-1~~（**已解决，保留 ID 供映射**） | ~~MAJOR~~ → 已闭合 | 修复证据：`validate.ts:248-253`（分支重排 + 条件后缀，设计 `:344` 逐字符对齐）+ `:220-222`/`:237-239` 注释更正 + `validate-int-range.test.ts:294-298`/`:380-388` 回归断言；SA3 突变对照（旧次序 → 2 断言红）+ 焦点/受影响包/全仓/typecheck/generate --check/spec 机检全绿；SA8 R2 复审 clear | 无（iteration 0 问题：裸 `number & Int` 非整数失配渲染 `[undefined, undefined]` 端点、偏离设计 §8.4 模板、回归不可检出——均已消除） | 无 | `a=1.5` 消息 = `期望整数，实际 1.5`（无 undefined）；b 字段 R2/R3 断言零变化且绿；判定/锚位/指纹零变化 | — |

**当前无 BLOCKER / MAJOR / 待返工项。**

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
| --- | --- | --- | --- |
| CI 面（本 worktree 未执行） | CI（6 分片 + codegen-freshness + typecheck 作业） | 5 新测试文件落入分片且全绿（含 F-SA4-1 回归 2 例）；`generate --check` 作业绿 | 分片漏跑、codegen-freshness 红、或任一分片测试失败 |
| 消息面长期稳定性（文案不冻结的边界守护） | 后续任何触碰 `intRangeRejectMessage` 的变更 | C4d/C4g 的 2 条 F-SA4-1 断言保持绿；undefined-free 不变量不回退 | 断言被删/软化，或裸 int 非整数消息再现 undefined |
| 可选类型级 fixture（设计 §10.2 可选项，未新增） | 后续裁量 | 若补 `.test-d.ts`：`PathValue`/`PathSchema` 对 Int/Range 字段投影 `number` | — |

## 12. Non-blocking observations

1. **N-1（MINOR，范围，维持）**：`packages/vfsl/test/evaluate-derived-schema.test.ts` 为 ALLOW 外改动（+5 行纯类型镜像同步，typecheck 机械强制、零断言变化）。建议总控追认为 ALLOW 修订，消除「测试通过但形式越界」的悬置。
2. **N-2（已闭合）**：iteration 0 承接 SA8 F-1 的观察——级联第 ④ 步双键谓词使 min-only 手造 int 叶放行有限整数。本轮确认按 SA8 处置 **(b)** 落实（谓词保持 + `validate.ts:220-222` 注释更正为准确描述），SA8 R2 #6 裁 F-1 就此闭合。不再列为观察项。
3. **N-3（MINOR，维持，= SA8 R2 F-2）**：`parser.ts:643`「EOF 锚经 err() 既有回退 (1,1)」注释与实际（锚 eof 记号真实坐标）不符——行为正确、测试按实际断言并注明来源；SA3 已声明超出 F-SA4-1 范围，留待顺手修正。
4. **N-4（观察，维持）**：`parser.ts` `-0` 端点 E100 消息引「ADR 0020 决策 3」（既有文案沿用），精确归属为经 ADR 0021 决策 2 修订；文案不进冻结面，留作文案清理。
5. **N-5（观察，维持）**：`tests/acceptance/exemplar/spec-exemplar-v1.md` 与 `.scratch/` 仍存「唯一允许的交叉类型」旧措辞——非规范面（exemplar 自述非交付物、机检不含该句）。
6. **N-6（观察，维持）**：设计 §10.2 可选 `.test-d.ts` 类型级 fixture 未新增（SA3 Deferred 登记）；codegen C6a 已用真实 tsc 证明 `number` 投影可编译，非缺口。

---

## 附：本轮复审方法记录

- mtime 取证定位 rework 爆炸半径：`ls --time-style=full-iso` 全 `packages/vfsl/src/*.ts` + 关键测试——仅 `validate.ts`（00:00:48）与 `validate-int-range.test.ts`（00:00:24）晚于 iteration 0 报告落笔（23:58:42），其余全部 ≤ 23:25:05 → iteration 0 对未触碰面的全量结论可承继；
- `git diff packages/vfsl/src/validate.ts` 恰 3 hunk 逐行读；与 iteration 0 记录的旧实现（`min === undefined || max === undefined` 守位先于 `'integer'` 分支）比对，确认变化仅限消息函数分支次序 + 三处注释，`intRangeReject`/`contradictsInner`/`validateValue` 逐字节未动；
- 消息矩阵独立推演：4 verdict × 3 键形（双在/双缺/单键）× 代表值（1.5/5/101/0/-0/NaN/±Inf/"3"/null/true）全组合——文本可达形态零 undefined 槽；`'ok'` 经调用点 `:595` 门控不渲染；联合下钻 label 前缀（`:529-531`）不含 undefined 且被 C4g 新例全量断言覆盖；
- 设计 §8.4 模板（design `:338-348`）与实现 `:240-254` 逐字符对照（条件、后缀格式、区间模板、四值域短语、renderNumberValue 调用位）；
- 测试判别力分析：确认 `not.toContain('undefined')` 为杀死旧缺陷的判别断言（旧串含「整数」），并与 SA3 突变对照实测串互证；
- 全仓消息文案钉死面 grep（packages/apps/domains + docs）复核零外溢；skip/only/todo 全新测试文件 grep 零命中（`expect.fail` 命中仅限既有 spec-docs-anchor 测试，非本次面）；
- `git diff --check` 只读复跑 exit 0；`git status` 文件集合与 iteration 0 逐条一致，无探针/临时残留；
- SA8 R2 复审报告（原位更新，mtime 00:19:20）通读：iteration 0 `requiresConflictRecheck: true` 的重开环已按其 §10 边界条款执行并裁 clear——本轮无新冲突面，不再触发重开；
- 未修改任何文件（除本报告）、未运行测试/服务、未创建临时进程。

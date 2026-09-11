# SA4 实现静态审查 — issue #309（v1-spec §5 与编写指南落地 M4 挂载锚位）

- Dispatch：`sa-a6bbe21b-8554-4584-b17c-aae2c831b651`（mabf-sa4 / implementation-review / iteration 0）
- 被审对象：SA3 实现产出——worktree `/home/wangjian/nomicore-fix-issue-309`，分支 `mabf/issue-309`，HEAD `bbb93fb` 之上的未提交 diff（14 个 tracked 修改 + 1 个新增 `packages/vfsl/test/spec-docs-anchor-m4-contract.test.ts`）；实现报告 `wiki/raw/task_issue-309_sa3_impl.md`。
- 审查口径：纯静态。SA4 未修改任何实现/设计/测试，未运行测试、检查器或服务；全部结论基于本轮独立实读 diff、源码、规范文本与只读 git/grep 复测（含一次内存内 fixture 逐字节比对与一次独立残留扫描，均只读、零临时文件）。

## 1. Reviewed inputs

| 输入 | 状态 | 本轮用途 |
|---|---|---|
| `wiki/raw/task_issue-309.md`（Host brief） | 存在 | What-to-build + AC1-AC4；**Comments: []——无 Owner 评论、无 owner-comment 约束**（与派发前提一致） |
| `wiki/raw/task_issue-309_design.md`（iteration 2） | 存在 | 冻结目标文本 D2/D5/D6/D7/D8/D9/D10、§11 ALLOW/DENY、§12 验收映射、§15 复查清单 |
| `wiki/raw/task_issue-309_sa2_review.md`（approve） | 存在 | SA2-1 验收判词（§7 块 1→1、D3 逐块谓词不弱化）与 N1-N8 处置核对 |
| `wiki/raw/task_issue-309_sa6_contract.md` | 存在 | §12.1 冻结运行时观察、§12.2 Suite D 冻结谓词、§12.4 检查器同步、§12.5 运行入口 |
| `wiki/raw/task_issue-309_sa3_impl.md` | 存在 | 被审实现报告（测试/检查器证据按 SA3 报告值对待，静态面由本轮独立复核） |
| `wiki/raw/task_issue-309_implementation_conflict_report.md`（SA8，iteration 3，clear） | 存在 | 实现后冲突复查结论与冻结面核对（本轮交叉印证） |
| `wiki/raw/task_issue-309_conflict_report.md` / `_design_conflict_report.md` / `_relevant_decisions.md` | 存在 | 前置门禁/设计复审 Required actions 与 ADR 0019 决策边界 |
| 独立核验源 | — | `git diff`（14 文件逐 hunk 实读）、`docs/vfsl/v1-spec.md` §5 全读（L390-467）、`docs/vfsl/schema-authoring-guide.md`（标题全枚举 + §7/§8/检查表全读 + 「必须紧邻」唯一性）、`tests/acceptance/vfsl_spec_acceptance.py`（G15-G17/main 全读 + `fixture_problems` 逐条件核对）、`tests/acceptance/exemplar/spec-exemplar-v1.md`（标题 + §4 + 附录 fixture 全读）、`CONTEXT.md`、`packages/vfsl/src/{parser,ir,semantic}.ts` 注释 hunk、`vitest.config.ts` include、`scripts/ci-test-shard.mjs` L20-55、`packages/vfsl/src/index.ts` 导出面、金样本常量 L33-36、E305 消息行 L76 |
| 独立复测（只读） | — | ① exemplar 附录 fixture 与 v1-spec §10 fixture 内存逐字节比对 = **True**；② `git ls-files`（731 个 tracked 文件，排除 `wiki/`、`dist/`）旧措辞 needle 扫描 = **0 命中**；③ 「必须紧邻」全指南唯一命中（L212）；④ v1-spec/exemplar 含「注释」标题各恰一个（G17 `find_sec` 无歧义）；⑤ `git diff --check` exit 0；⑥ `git diff --name-only -- wiki/` = 0 条；⑦ 落地五文件「7.3」0 命中 |

缺失输入：无。review 产物 `task_issue-309_sa4_review.md` 此前不存在（本文件为首版）。

## 2. Verdict

**approve** —— 未发现 BLOCKER 或 MAJOR。实现与设计冻结目标文本逐字一致（含 §7 旧裸块 1→1 整体替换、D10 十四处措辞逐处吻合、G17 代码与设计 D9-3 逐字同构）；全部冻结面（金样本常量、E305 消息、codegen/生成物、wiki 零 diff、src 注释-only）经本轮静态逐 hunk 核对守住；SA6 §12.2 冻结谓词在落地测试中原样承接且有两处加强、零弱化；文件改动恰为 ALLOW 15 项、无越界。发现 5 项 MINOR 非阻断观察（§12）与 4 项静态无法闭口的动态验证项（§11）。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| Issue What-to-build：v1-spec §5 四类锚位 + M4 五条子规则 + 联合成员示例 | v1-spec L405-432（四类枚举句 + 六条子规则 + 单行/混合布局句）、L449-460（§5 首个 `vfsl` 联合成员示例块） | 落实。子规则 1-6 逐条锚定 SA6 §12.1 A1-A4/B1-B4/C1/C3/C5 冻结观察，无虚构行为 |
| Issue What-to-build：E305 既有场景不变的明确表述 | L420-421「维持 E305，与既有行为逐字节一致（既有场景不变，不升格挂别名节点）」、L423「既有触发场景不变」、L429 不对称显式注明 | 落实（AC1 后半） |
| Issue What-to-build：指南 §7/§8 逐成员 doc 写法与示例 | 指南 L158 新写法句 + L160-166 §7 目标块（**旧裸块原位整体替换，§7 恰 1 个 `vfsl` 块**）；L186 新句 + L188-210 §8 块内 Status 逐字面量 doc（围栏与 ROOT 声明原样） | 落实。SA2-1 的「替换非增补」判词兑现（本轮独立清点 §7 块数 = 1） |
| Issue What-to-build：检查表同步 | 指南 L290 新条目（联合/枚举 × 成员 × 文档注释 + 夹缝/坍缩 E305 提示） | 落实（AC2） |
| Issue What-to-build：源码与测试注释「三锚位」清扫 | D10 表 14 处逐处落地（本轮逐 hunk 比对全部吻合，含 `semantic.ts:5` 过时 E305 条件描述同步四类口径）；独立扫描 731 tracked 文件 = 0 残留 | 落实（AC3）。剩余「三类」命中（why-nomicore/validate/pattern/fullchain 等）均与挂载锚位无关 |
| Issue What-to-build：规格随实现同支累积 | 分支 `mabf/issue-309`，HEAD 已含 #306/#307/#308，本 diff 与实现同支 | 落实；收官时序（PR #305 合并前落地 commit）属总控，SA8 行动 1 登记 |
| AC4 `git diff --check` 干净 | 本轮实测 exit 0、无输出；Suite D D5② 机器化（exit 0 且 stdout 空，error 路径 fail-closed） | 落实 |
| ADR 0019 Consequences（文档面随实现落地） | §5/指南/检查表/exemplar/CONTEXT 全部落地 | 落实 |
| #306 O-3（修订 §5 必须同支更新检查器与指南） | 检查器 4 处修订（docstring/G10 need 12→13/G17 新增/G16 `AssetsDoc→ROOT`）与指南同支落地 | 落实 |
| SA2-1 / N1-N8 | §7 1→1 替换 + `blocks.length === 1` 机器化；N1 发射位限定入 CONTEXT 条目；N3 ADR 连字符风格；N4 D3b 钉句；N6 §8 仅替换 Status 声明 | 全部兑现（逐条核对见 §9/§12） |
| SA8 Required actions 1-6（实现期义务） | wiki 零 diff（实测 0 条）；ADR 0019 仅 L60 一行（diff 单 hunk）；G16 同票修复（L321/L555）；CONTEXT 恰一条新增（+4 行）；时序登记；SA8 iteration 3 复查 clear | 全部闭合（与 SA8 实现后报告交叉印证一致） |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| D7(a) §5 挂载规则四类化 + M4 六条子规则 + 单行/混合布局句（冻结文本） | v1-spec L405-432 | 逐字一致（含「坍缩为成员类型本身」行内自含陈述、两坍缩形态、夹缝/M3 优先/不双挂/夹缝叠写推论）；「§7.3」悬空引用 0 命中 | 无 |
| D7(b) §5 首个 `vfsl` 联合成员示例块 + 发射位界线段（冻结文本） | v1-spec L449-466 | 逐字一致；ADR-0019/ADR-0001 连字符风格（N3）；既有 7 条 fixture 表与三态表/边界段/`@tag` 段零改动（diff 仅 2 个 hunk，均在 §5 内） | 无 |
| D8(a) L204→L212 挂载目标句四类化（冻结文本） | 指南 L212 | 逐字一致；「必须紧邻」全指南唯一命中，D3b 钉句无歧义 | 无 |
| D8(b) §7 旧裸块**整体替换**（1→1，非增补）+ 新写法句；L154/L156/L168 三句保留 | 指南 L158 新句 + L160-166 目标块；L154/L156/L168 逐字未动 | 落实：§7 现恰 1 个 `vfsl` 围栏块，旧裸 Asset 形态不在场（diff 为原位内容替换）；目标块与设计冻结文本逐字一致 | 无 |
| D8(c) §8 块内 Status 声明替换（围栏开闭行保留）+ 写法句 | 指南 L186-194；ROOT 声明与字段 doc（L196-209）原样 | 落实（N6/N7 的行号笔误按 §2.2 正确区间操作，落地无歧义） | 无 |
| D8(d) 检查表 M4 条目（冻结文本） | 指南 L290 | 逐字一致；命中 D4 谓词全部要素 | 无 |
| D6/D9 exemplar 三件套：§4 四类 + G17 九元组 bullet + 附录 fixture = §10 逐字副本 | exemplar L99-103（两条 bullet）；L137-166 fixture | 落实：**本轮独立内存逐字节比对 fixture = True**；§4 bullet 命中 G10 13 项与 G17 全部 9 元组（逐串核对） | 无 |
| D9 检查器四处（docstring/G10 13 项/G17/G16 ROOT） | checker L34-37 / L481 / L558-573 / L324+L558 | 与设计 D9-3 冻结代码逐字同构；G17 置于 G16 后、`return results` 前，判定 21→22；`find_sec("注释")` 在两文档各唯一命中（本轮标题全枚举证实） | 无 |
| D10 十四处措辞替换（两模板） | 全部 14 处逐 hunk 比对吻合（src 3 处注释、测试注释/describe 标题 11 处）；金样本常量 L33-36 逐字未动 | 落实；#4 `semantic.ts:5` 同时修正过时 E305 条件描述（与 `:76` 消息口径一致） | 无 |
| D1 AC3 作用域 = tracked − `wiki/**` − `dist/**` | 测试 D5① 实现与独立扫描一致（731 文件 0 命中） | 落实 | 无 |
| D2 ADR 0019:60 最小措辞修订 | diff 单 hunk单行：「与既有 M1/M2/M3 锚位的『紧随其后』语义一致）」；L64 原样保留（登记路径） | 落实 | 无 |
| D5 CONTEXT「挂载锚位」术语条目（冻结文本） | CONTEXT.md L53-55（标记类型条目后，+4 行恰一条目） | 逐字一致；含发射位/界线限定（N1）与 _Avoid_ 行；不含旧措辞字样 | 无 |

**设计明确但实现缺失**：未发现。**实现必要偏离设计**：未发现（两处加强见 §9，均在设计已显式冻结形态内）。

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| 规范文本修订 | `docs/vfsl/v1-spec.md`（语言规范权威） | §5 原位修订 | ✓ |
| 指南与检查表 | `docs/vfsl/schema-authoring-guide.md` | L158/L186/L212/L290 | ✓ |
| 规格机器契约 | `tests/acceptance/vfsl_spec_acceptance.py` 原位扩展 | docstring/G10/G17/G16 | ✓ 原位扩展，非平行新建 |
| CI-wired 文档契约 | `packages/vfsl/test/`（vitest include 真实入口） | 新增 `spec-docs-anchor-m4-contract.test.ts` | ✓ 经公共入口 `../src/index.js` 导入 |
| 术语登记 | 根 `CONTEXT.md` | 恰一条新增 | ✓ docs/AGENTS L9 义务 |
| 挂载实现行为 | 不改（#306-#308 冻结面） | src 仅 3 处注释行 | ✓ 零运行时语义 |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| 测试内 fs 读仓文件 | `compile-schema-envelope.test.ts` L45/L558（直接读先例） | Suite D `readFileSync(join(repoRoot, …))` 读 `docs/**` | 一致 | packages/vfsl/AGENTS 接缝条款约束包运行时面，不禁止测试读仓文件 |
| 结构化文档机器契约 | 检查器 `find_sec`/`join_sec` + needle 合取 | G17 与 Suite D D1 同族结构 | 一致 | 双通道同源判据（N5 维持登记） |
| 文档示例显式修订（替换 vs 并存） | docs/AGENTS L10「explicitly amend」；ROOT 约定票原位替换先例 | §7/§8 原位替换 | 一致 | 不留双口径同类示例 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| M4 挂载行为 | 实现（parser/semantic/ir）+ ADR 0019 | §5/指南/exemplar/CONTEXT 文本；G10/G17 与 Suite D 为文本派生断言 | 低：全部行为性陈述逐条锚定 §12.1 冻结观察；双通道 needle 同源 |
| E305 触发面与前缀 | 实现 + v1-spec §4 冻结项 | §5 文本表述 | 低：消息行零改动（本轮实读 `semantic.ts:76` 四类枚举原文在场） |
| 指南 §7 联合示例规范写法 | 替换后目标块（唯一） | D3 逐块谓词派生断言 | 低：块数钉死 1 + 逐块配对 ≥2 双检出 |

### 生命周期对称性

无运行时注册/释放面（B5 零运行时语义）。验证路径只读、失败 loud、无清理责任；回滚 = `git revert`（Suite D/G10/G17 随回滚转红 = 缺口信号）。对称成立。

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
|---|---|---|---|
| Python 检查器 vs Suite D vitest | 检查器（人工入口，未接 CI） | Suite D（CI-wired 主判据） | 非平行重复：入口不同、判据同源（SA8 #19 已裁决；B4 follow-up 维持） |
| 第二套措辞扫描 | 无 | D5① 单一扫描断言 | 唯一（AC3 对象本体） |
| 第二评论读取/API wrapper/cleanup worker | 无 | 无新增 | — |

## 6. 文件范围审查

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `docs/vfsl/v1-spec.md` | ALLOW #1 | AC1；D7 | ✓ 仅 2 个 hunk，均落 §5 内；三态表/边界/`@tag`/fixture 表/§4 错误表/§8 零改动 |
| `docs/vfsl/schema-authoring-guide.md` | ALLOW #2 | AC2；D8 | ✓ 3 个 hunk（§7/§8/检查表+L212 句）；§6 与目录零改动 |
| `tests/acceptance/vfsl_spec_acceptance.py` | ALLOW #3 | O-3；D9 | ✓ 恰 4 个 hunk（docstring/G16 标识/G10 need/G16 消息+G17）；G1-G15 逻辑零改动 |
| `tests/acceptance/exemplar/spec-exemplar-v1.md` | ALLOW #4 | D6 | ✓ §4 两 bullet + 附录 fixture；其余零改动 |
| `packages/vfsl/test/spec-docs-anchor-m4-contract.test.ts` | ALLOW #5（新增） | Suite D 主判据 | ✓ 新文件；路径命中 vitest include 与 CI 分片磁盘枚举（本轮实读两处证实） |
| `docs/adr/0019-vfsl-union-member-docs.md` | ALLOW #6（仅 L60） | D2 | ✓ diff 单 hunk 单行；L64 原样 |
| `packages/vfsl/src/parser.ts` / `semantic.ts` / `ir.ts` | ALLOW #7-#9（仅注释） | AC3；B5 | ✓ 全部 hunk 落在注释行内（逐 hunk 实读：`//` 行与 ` *` 续行），无 token/语句变化；E305 消息行（semantic.ts:76）不在 diff 内 |
| `packages/vfsl/test/parse-vfsl-union-member-docs.test.ts` | ALLOW #10（金样本常量禁改） | AC3 | ✓ diff 仅 L5-7 文件头注释；L33-36 四个常量逐字未动（本轮实读在场） |
| `packages/vfsl/test/evaluate-derived-docs-audit.test.ts` / `parse-vfsl-cycle-detection.test.ts` / `evaluate-derived-docs-typecls.test.ts` | ALLOW #11-#13 | AC3 | ✓ 仅注释/describe 标题 |
| `domains/vfs3-assets/test/vfs3-assets-tsdoc.test.ts` | ALLOW #14 | AC3 | ✓ 注释 3 处 + describe 标题 1 处（断言体零改动） |
| `CONTEXT.md` | ALLOW #15 | D5；SA8 action 4 | ✓ 单 hunk +4 行恰一条目 |
| `wiki/raw/task_issue-309_sa3_impl.md`（untracked） | SA 固定产物 | 实现报告 | 不属实现 diff；`git diff --name-only -- wiki/` = 0 |

DENY 面（`wiki/**` tracked、`packages/vfsl-codegen/**`、`domains/*/generated.ts`、金样本常量、其余 ADR/docs、`.github/**`、package.json scripts、README/REPORT）逐项零触碰（status/diff 实测）。**实际改动未超出 ALLOW、未触碰 DENY。** ALLOW 未修改路径：无（15 项全部落地）。

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| v1-spec §5 文本（三类→四类） | 检查器 G10/G17 | 同支扩展（G10 need +「联合成员」、G17 新增）；G1-G15/G14/G13 等其余判定所需关键词零影响（本轮逐串核对 §5 保留段） | 无 | 无 |
| v1-spec §5 文本 | Suite D D1/D2 | 新文件承接 20 needle + 示例块执行 | 无 | 无 |
| v1-spec §5 文本 | 指南（链接权威）、ADR 0019 交叉引用 | 指南 L212 四类化；§5 引用 ADR-0019/ADR-0001 均指向真实文件 | 无 | 无 |
| 指南 §7/§8/检查表/L212 | Suite D D3/D3b/D4 | 逐块谓词 + 钉句 + 检查表谓词承接 | 无 | 无 |
| G16 期望 `ROOT` | exemplar 绿路径（`--spec`） | 附录 fixture 同步为 §10 逐字节副本（本轮独立比对 True）；G16 其余条件（六标记/AssetId/Audit/AssetEntity/vfs3/assets/`?:`/`\|`/`[]`/`&`/`Pattern<`/`Record<`/JSDoc）在两 fixture 中逐项在场（本轮静态核对 `fixture_problems` 全部条件） | 无 | 无 |
| G10 扩展（13 项） | exemplar §4 | 两条 bullet 覆盖全部 13 needle（逐串核对，含「机器」「@tag」既有 bullet） | 无 | 无 |
| G17 新增（9 元组） | v1-spec §5 / exemplar §4 | 两处文本均命中全部 9 元组（本轮逐串核对）；`find_sec("注释")` 两文档各唯一命中 | 无 | 无 |
| src 注释改动 | 编译器/测试运行器 | 注释-only，零语义；SA3 报告 typecheck/682 tests 绿（静态面由本轮逐 hunk 核对印证） | 无 | 无 |
| describe 标题改动 | vitest 报告 | 无快照/断言依赖标题（旧措辞全仓 0 残留） | 无 | 无 |
| 检查器 CI 接入（未来） | 无现存 caller | 未接入（B4 follow-up 维持，AC 未要求） | 无 | 无 |

**遗漏 caller**：未发现。§5 四类化的全部已知文本消费方（检查器/指南/exemplar/Suite D/CONTEXT）同支同步。

## 8. 错误、恢复与并发

- **无吞错/伪成功**：Suite D 全部失败路径 loud——`readSection` 缺标题 throw、`fencedBlocks` 未闭合 throw、`execBlock` 对 `parseVfsl`/`evaluate` 非 ok 走 `expect.fail`（附 issues JSON）、D5② 断言 `result.error` undefined + status 0 + stdout 空（git 子进程异常按红处理，SA2 S3/E4 的 fail-closed 要求兑现）、D5① 计数必须恰 0。无 skip/only/todo/env override/fallback（本轮 grep 证实）。
- **检查器错误面**：G17 失败输出具名「缺失要素: …」；章节缺失显式红。G16 修复后两入口期望 22/22（SA3 报告值；本轮静态 needle/fixture 核对佐证，运行值待 SA7）。
- **恢复/重试/并发**：不适用（无运行时服务；解析/求值同步纯函数；测试与检查器无并发面、无共享可变状态；文档编辑幂等）。回滚语义显式（revert 后红灯即缺口信号）。
- **静态无法闭口项**：见 §11（整仓 test/CI、检查器双入口运行值）。

## 9. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| D1（§5 20 needle 事实链） | 5 锚位词 + 7 条子规则链合取（每链内各 needle 均须在 §5 span 内） | `vitest run packages/vfsl/test/spec-docs-anchor-m4-contract.test.ts`；`pnpm test`/CI 分片自动发现（include + 磁盘枚举，本轮实读证实） | 无弱化：与 SA6 §12.2 冻结谓词同构（presence 合取，与检查器 G17 语义一致） | 无 |
| D2（§5 示例块执行） | 块 ≥1；**每块** wrapper 后双 ok；≥1 块 memberDocs 非空；逐块自跟随（doc-`\|` 对的 doc 原文 ∈ memberDocs 值）；另加 pairCount ≥1（多行前导 `\|` 布局下限） | 同上 | 无弱化；pairCount 为加强（设计允许范围内的机器化） | 无 |
| D3（指南 §7/§8 逐块） | 各 section 恰 1 块（`blocks.length === 1`）；双 ok；**逐块** doc-`\|` 配对 ≥2；自跟随 memberDocs | 同上 | 无弱化——未按节聚合；块数钉死为 SA2-1 不变式的机器化（加强）；配对谓词 trimStart 精确化与设计 D4 精确化条款逐字对应 | 无 |
| D3b（挂载目标句钉句） | 定位含「必须紧邻」的段落本体，断言四类齐全（类型别名/对象字段/标记类型/联合成员） | 同上 | 无弱化（N4 吸收：非全文 needle 搜索；「必须紧邻」本轮实测唯一命中） | 无 |
| D4（检查表 M4） | 检查表至 EOF 内 ≥1 条 `- [ ]` 同时含（联合∨枚举）+成员+（JSDoc∨文档注释） | 同上 | 无 | 无 |
| D5①（措辞清零） | tracked − `wiki/` − `dist/` 内 needle（join 构造防自命中）计数 = 0；二进制/非 UTF-8 显式跳过 | 同上 | 无弱化；本轮独立扫描 731 文件 0 命中交叉印证 | 无 |
| D5②（diff 卫生） | `git diff --check` exit 0 且 stdout 空，error 断言 undefined | 同上 | fail-closed 落地 | 无 |
| 红基线（SA3 报告：6 failed/1 passed） | 结构性推演与谓词逐项吻合：基线下 D1 缺 9 链、D2 块 0、D3 配对 0、D3b 缺「联合成员」、D4 命中 0、D5① 14 处、D5② 基线干净绿 | — | 无；SA6 红灯断言保持（红灯先于实现实测，报告值） | 无 |
| Suite C（68 tests）/682 tests/typecheck/generate --check/22/22×2 | SA3 报告值 | — | 静态面（冻结常量/E305 行/注释-only/fixture 副本）由本轮独立复核全部吻合；运行值待 SA7（§11） | 无 |

**SA6 红灯断言保持**：是（冻结谓词逐字承接 + 两处加强 + 零 skip/only）。**runner 触发性**：真实（vitest include 与 CI 分片磁盘枚举双证实，无需登记）。**mutation 敏感性**：文档面走偏（漏子规则/无示例块/旧块复活/检查表漏项/措辞残留/围栏破坏）分别落入 D1/D2/D3/D4/D5 红区（走偏→先红映射与设计 §12 敏感度行一致）。

## 10. Required revisions

无 BLOCKER / MAJOR。无需回流。

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| 整仓 `pnpm test` 全分片（SA3 仅跑 packages/vfsl + vfs3-assets 全量 682 绿） | SA7 / Controller（CI） | 全部测试文件绿，新文件被分片收集执行 | 任一分片红或新文件未被执行 |
| 检查器双入口运行值（22/22 为 SA3 报告值） | SA7 / Controller | `python3 tests/acceptance/vfsl_spec_acceptance.py` 与 `--spec …spec-exemplar-v1.md` 均 22/22 GREEN、exit 0 | 任一入口 < 22 或具名缺失要素 |
| `pnpm typecheck` / `pnpm generate --check`（SA3 报告值；静态注释-only 分析佐证） | SA7 / Controller | typecheck exit 0；generate --check exit 0 且 `domains/*/generated.ts` 零 diff | 任一非零或生成物漂移 |
| 收官时序：#309 须在 PR #305 收官合并前 commit/merge | Controller / Owner | 分支含本 diff 的 commit 进入 Parent PR 收官 | PR #305 先行合并（SA8 行动 1） |

## 12. Non-blocking observations

1. **（MINOR）新测试注释内不可见字符**：`spec-docs-anchor-m4-contract.test.ts` L81/L86 各含一个 U+200B（用于在 JSDoc 注释内嵌 `*/` 字样而不提前终止注释）。功能无害（typecheck/运行不受影响），但源码含不可见字符，未来编辑者 grep/复制时可能意外携带。建议未来同类场景改用文字描述（如「星斜杠边界」）或置于行注释。
2. **（MINOR）指南 §7 双冒号引导句**：L156「…让每个成员保持对象形：」逐字保留后紧跟 L158 新句「…挂载到 `|` 之后的成员：」，两句均以冒号收尾再接代码块，阅读节奏略异。这是设计 D8(b)「L156 冻结句保留 + 其间新增写法句」的直接结果，非实现偏离；如需优化属后续文档卫生。
3. **（MINOR）D3b 首现索引假设**：谓词取 `indexOf('必须紧邻')` 首个命中。当前全指南唯一（L212）；若未来他处更早引入该短语，测试将钉错段落而转红——失败形态仍为 loud 红（非静默通过），仅鲁棒性提示。
4. **（MINOR）D1/G17 needle 为 presence 合取**：子规则链按「各 needle 均在 §5 span 内」判定，不要求同句共现——与 SA6 §12.2 冻结谓词及检查器既有 G10 形态一致（文档即产品的结构性契约），非弱化；双通道同源维护义务维持 N5 登记。
5. **（MINOR，登记沿袭）**：`.github/ci/test-durations.json` 未含新测试文件权重（分片器按全表平均装箱）；B4（检查器接入 CI/package scripts）维持 follow-up。均已在设计 §13 登记，非本票缺口。

---

## 收尾声明

SA4 本轮未修改任何实现、设计、测试或规范文档；未运行测试/检查器/服务；未创建临时文件或后台进程；未派发或等待其他 SA。唯一可写产物为本文件。verdict = **approve**，无 Required revisions，`requiresConflictRecheck` 不适用（未发现新的 ADR 冲突风险；SA8 实现后复查已 clear）。

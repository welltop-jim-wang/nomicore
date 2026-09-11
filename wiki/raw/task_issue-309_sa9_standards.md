# SA9 Standards Review — issue #309（v1-spec §5 与编写指南落地 M4 挂载锚位）

- Dispatch：`sa-2e5eb810-cd6e-4f96-b8ba-044177d7eba3`（mabf-sa9 / standards-review / iteration 0）
- 被审对象：**已提交交付** —— worktree `/home/wangjian/nomicore-fix-issue-309`，分支 `mabf/issue-309`，交付 commit `21c6aaaec672864aaa8630bdf3ea1f92a0d47521`（`docs(vfsl): document four mount anchors`），Parent PR #305 head `bbb93fbda3100b2da2a007a228af777cdc56d282`（与派发给定值逐项一致，本轮实读 git 确认）。
- 审查口径：仅标准符合性——仓库 AGENTS、ADR、模块责任、既有架构惯例、单一事实源、生命周期对称性、文件范围与测试质量。不审 Issue 需求完备性（SA10 范畴）；本轮未修改任何代码/设计/测试，未运行测试、检查器或服务，未派发或等待其他 SA；全部结论基于对交付 diff（`bbb93fb..21c6aaa`）的逐 hunk 实读与只读 git/grep/python 复测。
- Owner 评论：REST Issue comments = none（successful empty response）——无 owner-comment 要求需对账。

## 1. Reviewed inputs

| 输入 | 状态 | 本轮用途 |
|---|---|---|
| `wiki/raw/task_issue-309.md`（Host brief） | 存在 | What-to-build + AC1-AC4；Comments 空 |
| `wiki/raw/task_issue-309_design.md`（iteration 2 终版） | 存在 | D1-D10 冻结目标文本、§11 ALLOW/DENY、§15 复查清单 |
| `wiki/raw/task_issue-309_sa2_review.md` | 存在（verdict = approve） | SA2-1 判词与 N1-N8 处置终点 |
| `wiki/raw/task_issue-309_sa3_impl.md` | 存在 | 实现报告与变更面声明 |
| `wiki/raw/task_issue-309_sa4_review.md` | 存在（verdict = approve） | 静态审查结论、5 项 MINOR 登记、§11 动态验证项 |
| `wiki/raw/task_issue-309_sa7_report.md` | 存在 | 动态验证：整仓 `pnpm test` 319 files / 3383 tests 绿（新文件在 shard 1/6）、typecheck/generate --check exit 0、检查器双入口 22/22、diff --check 干净 |
| `wiki/raw/task_issue-309_implementation_conflict_report.md` | 存在（SA8 iteration 3，clear） | 实现后冲突复查与冻结面核对 |
| `wiki/raw/task_issue-309_conflict_report.md` / `_design_conflict_report.md` / `_relevant_decisions.md` / `_sa6_contract.md` | 存在 | 前置门禁（clear）、设计复审（recheck clear）、17 份 ADR 全 accepted、SA6 冻结观察/谓词 |
| 仓库标准源 | — | 根 `AGENTS.md`、`docs/AGENTS.md`、`packages/vfsl/AGENTS.md`、`CONTEXT.md`、`docs/adr/0001/0003/0019`、v1-spec §4/§8 规范级约束 |
| 独立只读复测 | — | ①交付 diff 全 26 文件 name-status + 逐 hunk 实读；②旧措辞独立扫描：`git ls-files` 732 tracked 文件（排除 `wiki/`、`dist/`）「三锚位」= **0 命中**；③`git diff --check bbb93fb..21c6aaa` = exit 0 无输出；④exemplar 附录 fixture 与 v1-spec §10 fixture 内存逐字节比对 = **True**；⑤指南 §7/§8 各恰 1 个 `vfsl` 块、v1-spec §5 恰 1 个；⑥「必须紧邻」全指南唯一命中（L212，四类齐全）；⑦落地五文件「§7.3」0 命中；⑧新测试经 `../src/index.js` 公共入口导入（`evaluate`/`parseVfsl`/`DerivedSchema` 导出具名核实）；⑨vitest include（`packages/*/test/**/*.test.ts`）与 `scripts/ci-test-shard.mjs` 磁盘枚举双通道证实新文件自动入 CI；⑩ADR-0019 决策 6（`### 6. codegen：四个发射位`）与 ADR 0001 引用目标真实存在；⑪金样本常量（`parse-vfsl-union-member-docs.test.ts` L33-36 四常量）在交付 commit 中逐字在场未动 |

缺失输入：无。`wiki/raw/task_issue-309_sa9_standards.md` 此前不存在（本文件为首版）。

## 2. Verdict

**approve** —— 未发现 BLOCKER / MAJOR。交付 diff 与设计冻结目标文本逐字一致；根/docs/包三级 AGENTS 与相关 ADR 全部遵守；文件范围恰为 ALLOW 15 项 + 1 个新增测试 + 按管道惯例新增的 wiki 证据文件，DENY 面零触碰；测试质量（红灯先行、fail-loud、无弱化、真实 runner 接入）达标。登记 4 项 MINOR 非阻断观察（§8），均不阻断 approve。

## 3. AGENTS 与仓库级标准符合性

| 标准 | 条款 | 交付证据 | 判定 |
|---|---|---|---|
| 根 AGENTS.md | Domain docs 布局（根 CONTEXT.md + docs/adr/） | 新术语「挂载锚位（mount anchor）」登记于 CONTEXT.md（+4 行恰一条目，位于「标记类型」条目后）；决策记录仍由 ADR 0019 承载 | ✓ |
| 根 AGENTS.md | Module guidance（改动前读最近嵌套 AGENTS） | 改动落点 `docs/**`、`packages/vfsl/**`、`domains/vfs3-assets/test/**` 均受相应嵌套 AGENTS 约束，本轮逐条对照（下行） | ✓ |
| docs/AGENTS.md L9 | 引入/变更领域术语须更新 CONTEXT.md | 「四类锚位」首次进入规范正文，CONTEXT.md 同步登记（含发射位/界线限定与 _Avoid_ 行；条目文本不含旧措辞，本轮核实） | ✓ |
| docs/AGENTS.md L10 | 显式修订而非静默矛盾 | ADR 0019 仅 L60 一行比较性措辞修订（「三锚位」→「既有 M1/M2/M3 锚位」），diff 单 hunk 单行，决策内容零改动；该修订经设计 D2 + SA8 Required action 2 显式登记；L64 历史引用按设计 §13 follow-up 4 显式登记不纳入（非静默放过） | ✓ |
| docs/AGENTS.md L13 | 文档措辞变更不得虚构实现行为 | §5/指南/exemplar/CONTEXT 的全部行为性陈述逐条锚定 SA6 §12.1 冻结运行时观察（A1-A4/B1-B4/C1/C3/C5），经 SA7 动态复测逐条对齐；E305「既有场景不变」表述与 `semantic.ts:76` 四类枚举消息（本轮实读在场、零改动）一致 | ✓ |
| docs/AGENTS.md Verification | 检查链接与引用文件名、陈旧术语、`git diff --check` | ADR-0019/ADR-0001 引用目标真实存在且指向真实决策条目；「§7.3」悬空引用在落地五文件 0 命中；旧措辞扫描 0 命中；diff --check exit 0 | ✓ |
| packages/vfsl/AGENTS.md | 公共 API 仅经 `src/index.ts`；兼容行为（错误码/issue 序/指纹输入）冻结 | 新测试经 `../src/index.js` 导入（非内部结构）；E305 消息/码、IR、指纹零改动；`packages/vfsl/src` 三文件全部 diff hunk 落在注释行内（逐 hunk 实读：token/语句零变化） | ✓ |
| packages/vfsl/AGENTS.md | 解析/求值同步确定、环境中立 | 本票零运行时语义改动；Suite D 仅消费同步纯函数公共入口 | ✓ |

## 4. ADR 与规范级约束符合性

| 约束 | 交付证据 | 判定 |
|---|---|---|
| ADR 0019 决策 1/2/3/5/6/9 边界 | §5 子规则六条与决策面逐条同构；坍缩/夹缝/M3 优先不对称均表述为「既有行为/既定代价显式注明」，未升格新语义；决策 6 四发射位与两处无发射位例外在 §5(b) 与 CONTEXT 条目同口径限定 | ✓ |
| ADR 0001（无机器标签，文档性质） | §5(b) 尾段与 CONTEXT 条目均声明成员 doc 纯文档性质、不进校验与物化语义 | ✓ |
| v1-spec §8（只增不改） | §5 修订为纯增（第四类锚位 + 子规则 + 示例块），三态表/边界段/`@tag` 段/fixture 表/§4 错误表零改动（diff 仅 2 个 hunk 均在 §5 内）；E305 既有场景显式声明不变；无错误码变化 | ✓ |
| v1-spec §4（E 码前缀冻结） | 本票零消息改动；`semantic.ts:5` 注释同步为「M1/M2/M3 锚位与 M4 联合成员锚位之外」，与 `:76` 现行消息口径一致（修正了过时描述，注释-only） | ✓ |
| SA8 三份产物 Required actions（实现期义务） | AC3 作用域裁定执行（0 残留）；ADR 仅 L60；G16 同票修复（L321 标识 + L555 消息同步 ROOT）；CONTEXT 恰一条新增；时序义务（PR #305 收官前落地）已由本交付 commit 兑现；实现后复查 SA8 iteration 3 = clear | ✓ |

## 5. 模块责任与架构惯例

| Behavior | Expected owner | Actual location | 判定 |
|---|---|---|---|
| 语言规范修订 | `docs/vfsl/v1-spec.md`（权威） | §5 原位修订 | ✓ |
| 编写指南与检查表 | `docs/vfsl/schema-authoring-guide.md` | L158 写法句 + §7 块原位替换（1→1）、L186 写法句 + §8 块内 Status 声明替换（围栏保留）、L212 挂载目标句、L290 检查表条目 | ✓ |
| 规格机器契约 | `tests/acceptance/vfsl_spec_acceptance.py` 原位扩展 | docstring/G10 need 12→13/新增 G17（置于 G16 后、`return results` 前，判定 21→22）/G16 期望修复——G1-G15 逻辑零改动 | ✓ |
| CI-wired 文档契约 | `packages/vfsl/test/`（vitest 真实入口） | 新增 `spec-docs-anchor-m4-contract.test.ts`，include 与 CI 分片磁盘枚举双证实自动接入，无需登记 | ✓ |
| 术语登记 | 根 `CONTEXT.md` | 恰一条新增 | ✓ |
| 挂载实现行为 | 不改（#306-#308 冻结面） | src 仅 3 处注释行 | ✓ |

**既有惯例一致性**：测试内 fs 读仓文件与 `compile-schema-envelope.test.ts`（L45/L558）直接读先例同族；示例修订采用「原位替换」而非并存双口径（与 ROOT 约定票先例一致）；wiki 证据文件随交付 commit 入追踪与 #308 交付 commit（`bbb93fb`，含 `task_issue-308_sa9_standards.md` 等）惯例一致——全部为新增（A），零个既有 wiki 文件被修改。

## 6. 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| M4 挂载行为 | 实现（parser/semantic/ir）+ ADR 0019 | §5/指南/exemplar/CONTEXT 文本；G10/G17 与 Suite D D1 为文本派生断言 | 低：行为陈述全部锚定冻结观察并经 SA7 动态对齐；双通道 needle 同源（N5 维护义务已在设计 §13 登记） |
| E305 触发面与前缀 | 实现 + v1-spec §4 冻结项 | §5 文本 | 低：消息行零改动（本轮实读四类枚举原文在场） |
| 指南 §7 联合示例规范写法 | 替换后目标块（§7 唯一 `vfsl` 块） | D3 逐块谓词（`blocks.length === 1` + 配对 ≥2 + 自跟随 memberDocs） | 低：块数钉死 + 逐块配对双检出，旧裸块复活即红 |
| exemplar 附录 fixture | v1-spec §10 fixture（规范权威） | exemplar 为 `--spec` 绿路径测试载体，fixture 现为 §10 逐字节副本（本轮独立比对 True） | 低：设计 D6-3 显式冻结的同步关系；G16 其余构造条件在两 fixture 逐项在场 |

## 7. 生命周期对称性

无运行时注册/释放面（B5 零运行时语义）；四条验证路线（检查器 ×2、vitest、措辞扫描/diff 卫生）全部只读、失败 loud（具名缺失要素/断言红）、无清理责任；回滚 = 单 commit `git revert`，Suite D/G10/G17 随回滚转红即缺口信号——对称成立，无不对称发现。

## 8. 文件范围与测试质量

**文件范围**：交付 diff = ALLOW 15 项全部落地 + 新增 Suite D 文件 + 11 个新增 wiki 证据文件（管道惯例）；DENY 面逐项零触碰——既有 `wiki/**` tracked 文件零修改、`packages/vfsl-codegen/**` 零 diff、`domains/*/generated.ts` 零 diff、金样本常量逐字未动、其余 ADR/docs/CI scripts/README/REPORT 零触碰。无越界。

**测试质量**：

| 维度 | 证据 | 判定 |
|---|---|---|
| 红灯先行（TDD） | SA3 实现前实测 6 failed / 1 passed，实现后 7/7 绿；红基线与谓词结构性吻合 | ✓ |
| 无弱化 | 无 skip/only/todo/env override/fallback（本轮 grep 证实）；SA6 §12.2 冻结谓词原样承接且两处加强（D2 pairCount ≥1、D3 `blocks.length === 1`），均为设计已冻结不变式的机器化，非口径变更 | ✓ |
| fail-loud | `readSection` 缺标题 throw、围栏未闭合 throw、`execBlock` 双 ok 否则 `expect.fail`（附 issues JSON）、D5② error 断言 undefined + status 0 + stdout 空（git 子进程异常 fail-closed）、D5① 计数必须恰 0 | ✓ |
| 自跟随 | D2/D3 期望值取自文档自身（doc 原文 ∈ memberDocs 值），文档文案可在单行形态内微调不破契约 | ✓ |
| runner 真实性 | vitest include + CI 分片磁盘枚举双证实；SA7 实测整仓 3383 tests 绿且新文件在 shard 1/6 被执行 | ✓ |
| mutation 敏感性 | 文档面走偏（漏子规则/无示例块/旧块复活/检查表漏项/措辞残留/围栏破坏）分别落入 D1/D2/D3/D4/D5 红区 | ✓ |
| 金样本与回归锚 | 常量 L33-36 未动；Suite C 68 tests 与受影响包 682 tests 绿（SA3/SA7 报告值交叉一致） | ✓ |

## 9. Findings（全部 MINOR，非阻断）

1. **（MINOR）新测试注释内不可见字符**：`spec-docs-anchor-m4-contract.test.ts` L81/L86 各含一个 U+200B 零宽空格（用于在 JSDoc 内嵌 `*/` 字样而不提前终止注释；交付 commit 中本轮实读确认 2 处）。功能无害（typecheck/运行不受影响），但源码含不可见字符，未来编辑者 grep/复制时可能意外携带；建议未来同类场景改用文字描述或行注释。沿袭 SA4 §12-1 登记。
2. **（MINOR）交付 commit message 未引用 issue 号**：`docs(vfsl): document four mount anchors` 未携带 `(#309)`，与本特性链兄弟 commit（`fix(#306)`/`fix(#307)`/`fix(#308)`、`docs(#304)`）及 SA3 建议消息的追溯惯例不一致；仓库无文档化的 commit message 标准（根 AGENTS/docs 均无条款），故仅作可追溯性提示，不构成违例。
3. **（MINOR）一处测试头注释与 D10 冻结替换文本的轻微措辞差**：`parse-vfsl-union-member-docs.test.ts` 头注释落地为「…**已**由 ADR 0019 显式授权修订…，不是**修订前**现文行为」，较设计 D10 #6「替换为」文本多「已」与尾句半句。方向更准确（#309 已落地、旧文本确为「修订前」现文），comment-only、不触模板纪律（「三锚位」已消除、M1/M2/M3 表述正确）、金样本常量未动；不影响任何标准条款，仅如实登记。
4. **（MINOR，登记沿袭）**：D3b 首现索引假设（「必须紧邻」当前全指南唯一，未来他处更早引入将钉错段落——失败形态仍为 loud 红）；D1/G17 needle 为 presence 合取（与 SA6 §12.2 冻结谓词及检查器 G10 既有形态一致，双通道同源维护义务随 N5 登记）；`.github/ci/test-durations.json` 未含新文件权重与 B4（检查器接 CI）为设计 §13 已登记 follow-up。均非本票缺口。

## 10. Required revisions

无 BLOCKER / MAJOR，无需回流。

## 收尾声明

SA9 本轮未修改任何代码、设计、测试或规范文档；未运行测试/检查器/服务；未创建临时文件或后台进程；未 commit/push/创建 PR/finalize；未派发或等待其他 SA。唯一可写产物为本文件。verdict = **approve**，`requiresConflictRecheck` 不适用（SA9 不做 ADR 冲突裁决；SA8 实现后复查已 clear）。

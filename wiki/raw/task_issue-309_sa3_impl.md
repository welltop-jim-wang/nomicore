# SA3 Implementation Report — issue #309（v1-spec §5 与编写指南落地 M4 挂载锚位）

- Dispatch：`sa-9163c933-07de-46d0-8aa9-48999b3fc366`（mabf-sa3 / implementation / iteration 0）
- 证据基线：worktree `/home/wangjian/nomicore-fix-issue-309`，分支 `mabf/issue-309`，HEAD `bbb93fbda3100b2da2a007a228af777cdc56d282`
- 实现口径：TDD。先落 CI-wired 红灯契约 Suite D 并实测红（6 failed / 1 passed），再做文档/规范/检查器/注释四面修订，使红灯全绿；未改任何生产运行时语义。

## Inputs consumed

| 固定输入 | 状态 | 本轮用途 |
|---|---|---|
| `wiki/raw/task_issue-309.md` | 存在 | What-to-build + AC1-AC4；Comments 为空，无 owner-comment 约束 |
| `wiki/raw/task_issue-309_design.md` | 存在（iteration 2 原位修订） | 唯一实施蓝本：§7-D1…D10 目标文本、§11 ALLOW/DENY、§12 验收映射、§15 复查清单 |
| `wiki/raw/task_issue-309_sa2_review.md` | 存在（verdict = approve） | SA2-1 落实核对（§7 示例块替换 1→1）、N1-N8 处置 |
| `wiki/raw/task_issue-309_sa6_contract.md` | 存在（已接受） | §12.2 Suite D 逐字转写、§12.4 检查器同步、§12.1 冻结观察、§12.5 运行入口 |
| `wiki/raw/task_issue-309_conflict_report.md` / `_design_conflict_report.md` | 存在 | SA8 Required actions 1-6 与冻结面（wiki 零 diff、注释-only、金样本常量） |
| `wiki/raw/task_issue-309_relevant_decisions.md` | 存在 | ADR 0019 决策 1/2/3/5/6/9 边界 |
| 上游实现 | HEAD 已含 #306/#307/#308 | M4 解析/IR/派生/投影/codegen 四发射位在场，本票零触碰 |

缺失输入：无。既有实现报告 `task_issue-309_sa3_impl.md` 不存在（本文件为首次创建）。

## Existing worktree reconciliation

- 开工时 `git status --porcelain` 仅 7 个未跟踪 wiki 产物（Host brief + SA6/SA8/SA2/设计报告），tracked 零改动，`git diff --check` 干净——无待修订的既有实现，无过时改动需删除。
- 三条上游实现负控（68 tests、`pnpm typecheck`、`pnpm generate --check`）在基线即绿，本轮不得回退（§12 N1/N2/N6）。
- 本票无生产行为改动：`packages/*/src` 仅 3 个文件各 1-2 行注释（B5 纪律，见 Verification）。

## Changed paths

| Path | Design section | Change |
|---|---|---|
| `packages/vfsl/test/spec-docs-anchor-m4-contract.test.ts` | §7-D4；SA6 §12.2 | **新增** Suite D：D1（§5 四类锚位 + M4 子规则 20 needle 事实链）、D2（§5 `vfsl` 示例块 ≥1 + wrapper 规则双 ok + memberDocs 非空 + 自跟随核对）、D3（指南 §7/§8 逐块恰一块 + 双 ok + 逐块 doc-`\|` 配对 ≥2 + 自跟随 memberDocs）、D3b（钉「必须紧邻」挂载目标句）、D4（检查表 M4 条目）、D5①（tracked − `wiki/` − `dist/` 旧措辞计数 = 0）、D5②（`git diff --check` exit 0 且 stdout 空） |
| `docs/vfsl/v1-spec.md` | §7-D7(a)(b) | §5 挂载规则三类 → 四类锚位；新增「联合成员锚位（M4）子规则」六条（前导 `\|` 锚位 / 首成员起始记号 / 连续同挂 / 坍缩维持 E305 / 夹缝 + M3 优先不对称 / 既有不变）；新增单行与混合布局句；挂载示例表后新增 §5 首个 `vfsl` 联合成员示例块与 `memberDocs` 发射位界线段（ADR-0019 决策 6）。三态表 / 边界段 / `@tag` 段 / fixture 表未动 |
| `docs/vfsl/schema-authoring-guide.md` | §7-D8(a)(b)(c)(d) | L204 挂载目标句四类化（含夹缝/坍缩 E305 与别名级 doc 提示）；**§7 既有裸 Asset 示例块整体替换为带逐成员 doc 的目标块（块数 1→1，非增补）**，L154/L156/L168 三句保留不动；§8 块内 Status 声明替换为逐字面量 doc 形态（围栏行保留，其余字段示例不动）并新增写法说明句；提交前检查表新增逐成员文档注释条目 |
| `tests/acceptance/vfsl_spec_acceptance.py` | §7-D9；SA6 §12.4 | docstring 挂载目标补「联合成员」+ 新增 M4 子规则契约句；G10 need 12→13；新增 G17（§5 M4 九元组）；G16 陈旧期望 `AssetsDoc`→`ROOT`（标识表 + 详情消息） |
| `tests/acceptance/exemplar/spec-exemplar-v1.md` | §7-D6 / D9 | §4 原文捕获 bullet 四类化 + 新增联合成员锚位 bullet（G17 九元组齐备）；附录 fixture 整体替换为现行 v1-spec §10 fixture 逐字副本（ROOT 形） |
| `docs/adr/0019-vfsl-union-member-docs.md` | §7-D2（SA8 action 2） | L60 一处比较性措辞 →「与既有 M1/M2/M3 锚位的『紧随其后』语义一致」；决策内容零改动，除该行外 ADR 零 diff |
| `CONTEXT.md` | §7-D5（SA8 action 4） | 「标记类型」条目后新增「挂载锚位（mount anchor）」术语条目（四类 + 发射位/界线限定 + 纯文档性质） |
| `packages/vfsl/src/parser.ts` | §7-D10 #2/#3 | 仅注释两处（L174 / L519） |
| `packages/vfsl/src/semantic.ts` | §7-D10 #4 | 仅注释一处（L5，E305 条件描述同步 M4 后口径） |
| `packages/vfsl/src/ir.ts` | §7-D10 #5 | 仅注释一处（L59） |
| `packages/vfsl/test/parse-vfsl-union-member-docs.test.ts` | §7-D10 #6 | 仅文件头注释（金样本常量 L33-36 零触碰） |
| `packages/vfsl/test/evaluate-derived-docs-audit.test.ts` | §7-D10 #7 | 仅注释一处 |
| `packages/vfsl/test/parse-vfsl-cycle-detection.test.ts` | §7-D10 #8 | 仅注释一处（四类化，随 §5） |
| `packages/vfsl/test/evaluate-derived-docs-typecls.test.ts` | §7-D10 #9/#10 | 注释一处 + describe 标题一处 |
| `domains/vfs3-assets/test/vfs3-assets-tsdoc.test.ts` | §7-D10 #11-#14 | 注释三处 + describe 标题一处 |

未改动路径：`wiki/**`（零 diff）、`domains/*/generated.ts`（零 diff）、`packages/vfsl-codegen/**`、其余 ADR、`README*`/`REPORT.md`、CI/package scripts。

## SA2 Finding落实

| Finding ID | Implementation | Result |
|---|---|---|
| **SA2-1（MAJOR，已解决）**：§7 既有裸 Asset 示例块处置须落字为替换而非增补 | 指南 §7 旧块（原 L158-162）由带逐成员 doc 的目标块**整体替换**，§7 修订后仍恰含 1 个 `vfsl` 围栏块；Suite D D3 断言 `blocks.length === 1` 把「1→1」不变式机器化 | **达成**：D3 绿；旧块 0 配对形态若复活（1→2）将在 D3 `blocks.length === 1` 与逐块配对 ≥2 处双红 |
| N1（CONTEXT 条目概括偏宽） | 条目含发射位/界线限定（ADR 0019 决策 6 的两处无发射位例外） | 已吸收 |
| N2（needle 表算术） | 仅设计文档笔误，实现按 13 项 need 落地 | 无实现面影响 |
| N3（ADR 引用风格） | v1-spec §5 新文本用「ADR-0019」「ADR-0001」连字符风格；指南/CONTEXT 维持空格式 | 已吸收，needle 零影响 |
| N4（D3b 谓词载荷） | D3b 取含「必须紧邻」的段落本体断言四类齐全，非全文 needle 搜索 | 已吸收 |
| N6（§8 替换对象） | 只替换 §8 块内 Status 声明，围栏开闭行保留 | 已吸收 |
| N7（设计 §8(c) 括注行号笔误） | 按设计 §2.2 正确区间操作（§8 块整体保持一块） | 落地无歧义 |
| N8（AC2 与 §6 内联示例的关系） | 指南 §6 未改动，D3 只覆盖 §7/§8 | 维持登记 |

## File scope check

| Changed path | ALLOW entry | Purpose |
|---|---|---|
| `docs/vfsl/v1-spec.md` | ALLOW #1 | AC1；D7 |
| `docs/vfsl/schema-authoring-guide.md` | ALLOW #2 | AC2；D8 |
| `tests/acceptance/vfsl_spec_acceptance.py` | ALLOW #3 | O-3；D9 |
| `tests/acceptance/exemplar/spec-exemplar-v1.md` | ALLOW #4 | D6 |
| `packages/vfsl/test/spec-docs-anchor-m4-contract.test.ts` | ALLOW #5（新增） | Suite D 主判据 |
| `docs/adr/0019-vfsl-union-member-docs.md` | ALLOW #6 | D2（仅 L60） |
| `packages/vfsl/src/parser.ts` | ALLOW #7 | AC3；注释-only |
| `packages/vfsl/src/semantic.ts` | ALLOW #8 | AC3；注释-only |
| `packages/vfsl/src/ir.ts` | ALLOW #9 | AC3；注释-only |
| `packages/vfsl/test/parse-vfsl-union-member-docs.test.ts` | ALLOW #10 | AC3；金样本常量未动 |
| `packages/vfsl/test/evaluate-derived-docs-audit.test.ts` | ALLOW #11 | AC3 |
| `packages/vfsl/test/parse-vfsl-cycle-detection.test.ts` | ALLOW #12 | AC3 |
| `packages/vfsl/test/evaluate-derived-docs-typecls.test.ts` | ALLOW #13 | AC3 |
| `domains/vfs3-assets/test/vfs3-assets-tsdoc.test.ts` | ALLOW #14 | AC3 |
| `CONTEXT.md` | ALLOW #15 | D5；SA8 action 4 |
| `wiki/raw/task_issue-309_sa3_impl.md` | SA3 固定产物（技能规定，非 ALLOW 实现路径；untracked、不进实现 diff） | 本报告 |

ALLOW 15 项全部落地、无越界；DENY 面（`wiki/**` tracked、codegen、生成物、金样本常量、其余 ADR/docs、CI/scripts）零触碰。

## Verification

| Command | Result | Evidence |
|---|---|---|
| `NODE_OPTIONS=--conditions=nomicore-source npx vitest run packages/vfsl/test/spec-docs-anchor-m4-contract.test.ts`（**实现前**） | **6 failed / 1 passed**（红基线） | D1 缺 9 项事实链（`四类`/`联合成员`/`前导+\|+锚位`/`首成员+起始记号`/`连续+同一成员`/`坍缩+E305`/`夹缝+E305`/`优先+不双挂`/`既有+不变`）；D2「§5 至少一个 ```vfsl 示例块: expected 0 to be greater than or equal to 1」；D3「§7 配对 expected 0 to be ≥ 2」；D3b 挂载句缺「联合成员」；D4 检查表命中 0；D5① 9 文件 14 处残留；D5②（基线干净）绿 |
| 同上（**实现后**） | **7 passed / 7；Type Errors: no errors**（红灯全转绿） | D1-D5 全绿 |
| Suite C：`pnpm vitest run` 4 个 M4 套件（parse/evaluate/resolve/codegen） | **4 files / 68 tests passed；Type Errors: no errors** | 与 SA6 §4 基线同数同绿，N1/N2 冻结面保持 |
| 受影响包全量：`pnpm vitest run packages/vfsl/test domains/vfs3-assets/test` | **40 files / 682 tests passed；Type Errors: no errors** | 含新 Suite D 与全部注释改动文件（含 6 个未在 Suite C 内的被改测试文件） |
| `pnpm typecheck`（14 个 tsconfig） | **exit 0** | B5 类型面 |
| `pnpm generate --check` | **exit 0**；`git diff --name-only -- 'domains/*/generated.ts'` = 0 条 | N2/N6：生成物零 diff |
| `python3 tests/acceptance/vfsl_spec_acceptance.py` | **22/22 GREEN（exit 0）** | G10/G17 转绿；G16 `ROOT` 修复后绿 |
| `python3 tests/acceptance/vfsl_spec_acceptance.py --spec tests/acceptance/exemplar/spec-exemplar-v1.md` | **22/22 GREEN（exit 0）** | D6 三件套（§4 四类 + M4 bullet + 附录 fixture = §10 逐字副本）齐备 |
| `git diff --check` | **exit 0（无输出）** | AC4 |
| 旧措辞独立扫描（`git ls-files` − `wiki/` − `dist/`，逐文件 grep） | **0 命中** | AC3；与 Suite D D5① 同判（不改用测试自证） |
| `git diff --name-only -- wiki/` | **0 条** | N8 历史证据零 diff |
| 金样本常量核对 | `parse-vfsl-union-member-docs.test.ts` diff 仅文件头注释，L33-36 常量未动 | SA8 冻结面 |
| B5 注释-only 核对（人工逐 hunk） | 3 个 src 文件全部 diff hunk 落在 `//` 注释行，无任何 token/语句变化；`pnpm typecheck` + Suite C 承压 | B5 零运行时语义 |
| exemplar / spec 围栏块副本核对 | 脚本比对：exemplar 附录 fixture 与 v1-spec §10 fixture **逐字节相等**（`True`） | D6-3 |
| `git status --porcelain` | 14 个 tracked 修改 + 1 个新增测试文件（+ Host/上游 untracked wiki 产物） | 变更面与 ALLOW 逐条对齐 |

## Deferred verification

1. 全仓 `pnpm test`（含所有 package/app 分片）与 CI 裁决：SA3 按技能范围只跑指定红灯契约 + 受影响包；本次已额外跑 `packages/vfsl/test` + `domains/vfs3-assets/test` 全量（682 tests 绿）。整仓门禁与 CI 分片由 SA7/Controller 执行。
2. SA4 实现审查与 SA7 活链路最终验证。
3. SA8 实现后冲突复查（`requiresConflictRecheck = true`）：按设计 §15 六项清单核对实际 diff（wiki 零 diff、注释-only、金样本常量、E305/IR/派生/生成物逐字节不变、ADR 除 L60 零改动、CONTEXT 仅一条新增、指南 §7 块 1→1、落地文本无悬空章节引用）。本报告已提供对应证据行，最终裁决属 SA8。
4. B4 follow-up：把规格检查器接入 CI/package scripts（AC 外，设计 §13 登记）。
5. `.github/ci/test-durations.json` 未含新测试文件权重（分片器按全表平均权重装箱，设计 §13 follow-up 2）。

## Deviations or blockers

- 无阻塞、无越界、无验收语义改动；红灯断言未被弱化（测试内无 skip/only/todo/env override/fallback，期望值取自文档自身）。
- 实现说明 1（加强而非弱化）：Suite D D2 在 SA6 冻结谓词之外补 `pairCount ≥ 1`（§5 示例块须至少出现一个 doc-`|` 对），D3 以 `blocks.length === 1` 钉住设计 §7-D8(b) 的「块数 1→1」不变式——两处均为设计已显式冻结形态的机器化，不改变 SA6 判定口径。
- 实现说明 2：§7 在 L156 句与目标块之间新增写法说明句（设计 §7-D8(b) 要求），L156 句逐字保留（其行尾冒号保留，故该句与新句之间以空行分段，避免改写冻结句）。
- 实现说明 3：`docs/adr/0019:64` 与 `packages/vfsl/src/parser.ts:347` 的残余历史小节引用按设计 §13 follow-up 4 不纳入本票，未触碰。

## Suggested commit message

```
docs(#309): v1-spec §5 与编写指南落地 M4 联合成员挂载锚位

- v1-spec §5：挂载规则四类锚位 + M4 子规则（前导 | / 首成员起点 / 连续同挂 /
  坍缩与夹缝维持 E305 / 标记优先不双挂）+ 联合成员示例块与发射位界线
- schema-authoring-guide：挂载目标句四类化、§7 示例块整体替换为逐成员 doc 形态
  （块数 1→1）、§8 枚举逐字面量 doc、检查表补 M4 条目
- 规格检查器：docstring/G10 need 13 项/新增 G17（9 元组）/G16 陈旧期望 ROOT；
  exemplar §4 与附录 fixture 同步，双入口 22/22
- 措辞清扫：9 文件 14 处旧措辞归零（含 ADR 0019 一处显式登记修订）
- 新增 CI-wired 文档契约测试 spec-docs-anchor-m4-contract.test.ts（Suite D D1-D5）
- CONTEXT.md 新增「挂载锚位」术语；生产代码仅注释改动，运行时语义零变化
```

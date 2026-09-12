# SA3 Implementation Report — issue #314：VFSL 数字字面量拓宽（负号与小数，ADR 0020 决策 3）

- Dispatch：`sa-53ddebc2-8256-4293-9b67-bdd2d770dede`（role `mabf-sa3`，phase implementation，iteration 0）
- 实现基线 HEAD：`29ff10f843a4d877866e963cedc8766d60194d33`（分支 `mabf/issue-314`）
- 结论：**实现完成，规定验证全绿**——SA6 红灯契约转绿（focus 58/58）、影响包与全仓 typecheck exit 0、
  `pnpm generate --check` / `git diff --check` / 规格机检 exit 0、六处规范文档同变更集落地、零漂移哨兵保持绿。

## Inputs consumed

| 输入 | 路径 | 取用 |
| --- | --- | --- |
| Host 简报（comments REST `[]`，无 owner 追加要求） | `wiki/raw/task_issue-314.md` | 全文 |
| SA1 设计 **iteration 3**（唯一一致设计，含 SA2 F1 落实与扩充文档审计） | `wiki/raw/task_issue-314_design.md` | 全文；D1–D7、§8 边界表、§9 ALLOW/DENY、§12 C1–C7 逐条落实 |
| SA6 验收契约（accepted） | `wiki/raw/task_issue-314_sa6_contract.md` | 全文；§12.0 断言纪律、§12.1–12.9、§14 发现面 |
| SA2 设计评审（iteration 1，**approve**，F1 已解决 + 7 观察） | `wiki/raw/task_issue-314_sa2_review.md` | §13/§14 逐条 |
| SA8 设计后冲突复查（iteration 1，**clear**，`requiresConflictRecheck: true`） | `wiki/raw/task_issue-314_design_conflict_report.md` | §8 Required actions 1–5 逐条 |
| 模块规约 | `packages/vfsl/AGENTS.md`、`packages/vfsl-codegen/AGENTS.md`、`docs/AGENTS.md` | 兼容性行为 / 字节稳定 / 文档同 PR 义务 |

## Existing worktree reconciliation

- 进入时 `git status --short` 仅 5 个未跟踪 Host/流水线产物（简报、设计、SA8 设计冲突报告、SA2 评审、
  SA6 契约），**无任何未提交实现、无既有 `task_issue-314_sa3_impl.md`**——本次为首次实现，无需修订旧改动。
- HEAD 上复现确认（`.sa3-tmp/probe-baseline.ts`）：SA6 §5 正例矩阵全红、§6 负例全绿、§4 基线指纹与
  `generated.ts` 哈希逐字节相符——能力缺口定位与设计 §3 一致。

## Changed paths

| Path | Design section | Change |
| --- | --- | --- |
| `packages/vfsl/src/tokenizer.ts` | §5-D1/D2、§7 目标算法 | 数字分支入口扩为「digit 或 `-` 且单码元前看为 digit」；先消费可选 `-`、再 `[0-9]+`、再「`.` 且后随 digit」时的 `.` + `[0-9]+`；`value` 保留原文、`num = Number(raw)`；新增 `isDigitCodeUnit` 助手（`charCodeAt` 越界 NaN → false）；`:200` 分支注释与未知字符注释同步改写 |
| `packages/vfsl/src/parser.ts` | §5-D4 | 字面量分支既有有限性闸门旁**并列**新增 `Object.is(tok.num, -0)` 值闸门 → E100（锚该 number 记号）；注释补记依据与「值判定 vs 文本判定」 |
| `docs/vfsl/v1-spec.md` | §5-D7-1..4 | ① `:63` EBNF `NumberLiteral` 拓宽；② 注记 7 重写（紧邻、负例、指数不做、f64 归一、严格相等、超域、`-0` E100）；③ 微示例 C 行移出非法块 + 合法块增补 `type Level = -1 \| 0.5 \| 2;`；④ E100 码表行越界示例换血 |
| `docs/vfsl/schema-authoring-guide.md` | §5-D7-5/6 | ⑤ §6 注意列表 `:145` 同口径改写（+ 可选的 §6 示例增补 `type Level = -1 \| 0.5 \| 2;`）；⑥ 「v1 语法护栏」白名单句 `:216`「字符串或整数文字」→「字符串或数字文字（可选负号与十进制小数；负号须紧邻数字）」 |
| `packages/vfsl/test/parse-vfsl-errors.test.ts` | §9-T1 | `:58-63` 载体 `-1` → `-0`（同锚 E100@(1,10)，用例名/注释同步） |
| `packages/vfsl/test/parse-vfsl-r3-regression.test.ts` | §9-T2 | 三处载体 `type A = -1;` → `type A = - 1;`（`-` 列不变，R-1 三锚位 (1,16)/(1,17)/(1,16) 数值零改动；标题同步） |
| `packages/vfsl/test/parse-vfsl-number-literals.test.ts`（新建） | §12 C1+C2 | C1 正例（11 单字面量 + 3 联合 + 5 全局位置 + 3 形状规则）与 C2 `describe('invalid number forms')` 负例矩阵（码 + 行列双钉、下溢值判定、`-0` 消息、超域负值） |
| `packages/vfsl/test/validate-number-literals.test.ts`（新建） | §12 C3 | 文本 fixture → derived 声明序 enum 断言 + 命中/失配矩阵（f64 严格相等、path 断言、`0.1+0.2` 失配） |
| `packages/vfsl/test/number-literals-fixture-drift.test.ts`（新建） | §12 C5 | `list()` + envelope/semantic 指纹全值钉死 + `sha256:v1:` 前缀 + `generated.ts` sha256 字节钉死 |
| `packages/vfsl-codegen/test/generate-number-literals.test.ts`（新建） | §12 C4 | 发射文本断言（`-1 \| 0.5 \| 2` / `-1.5 \| -0.25` / `1e-7`）+ 成员值 `Number(段) === IR` + 真实 TS 编译器 0 诊断 |
| `packages/vfsl-codegen/test/generate-number-literals.test-d.ts`（新建，可选加固） | §12 C4 / SA6 §12.5 建议 | 发射形态的编译级投影：读精确、写成员值可写、非成员值 `@ts-expect-error` fail-closed |

## SA2 Finding 落实

| Finding ID | Implementation | Result |
| --- | --- | --- |
| **F1（MAJOR，iteration 0）**：文档同步面遗漏第六处 `schema-authoring-guide.md:216` | 已按 §5-D7-6 目标文本逐字修订护栏句；同文件 `:145` 一并改写；`docs/` 扩充模式组审计重跑 | **已落实**。护栏句现为「字符串或数字文字（可选负号与十进制小数；负号须紧邻数字）」；M4 Suite D（`spec-docs-anchor-m4-contract.test.ts`）与 acceptance 机检保持绿——目标文本用「须紧邻」不夺 `:212` 段「必须紧邻」首现 |
| 观察 1（§11 路径笔误） | 设计侧勘误，实现无动作 | 不适用 |
| 观察 2（`-0` 消息引用仓外 ADR 0021） | 消息改引仓内权威：`数字字面量 -0 不在可写值域（负零解析期拒绝，ADR 0020 决策 3）；请改写为 0`；规范注记 7 同引 ADR 0020 决策 3 修订句 | 已落实（码 + 锚不动；消息含 `-0` 且引导写 `0`） |
| 观察 3（C5 与既有指纹 pin 重叠） | 维持任务域独立哨兵；未改既有 `parse-vfsl-union-member-docs` pin | 登记知悉 |
| 观察 4（自然 fallout 未登记） | 设计已登记；实测 `1 -1`/`1-1` 码 + 锚不变、正文变；`Record<-0,string>` 先命中 D4 E100@(1,30) | 与设计 §7/§8 表后注一致 |
| 观察 5（微示例行数措辞） | 非法块删 C 行、合法块增 Level 行；无机检依赖行数 | 验收脚本 22/22 绿 |
| 观察 6（C1 表头混列期望） | C1 按期望结果拆两组 describe（正例 ok / 形状规则 E306/E100/E311） | 已落实 |
| 观察 7（T1 重组偏离） | 维持设计 T1：`-0` 一锚留守 `parse-vfsl-errors`，完整矩阵入 C2 | 已落实 |

## File scope check

| Changed path | ALLOW entry | Purpose |
| --- | --- | --- |
| `packages/vfsl/src/tokenizer.ts` | ✅ ALLOW 行 1 | 记号扫描（核心缺口） |
| `packages/vfsl/src/parser.ts` | ✅ ALLOW 行 2 | `-0` 值闸门 |
| `docs/vfsl/v1-spec.md` | ✅ ALLOW 行 3（仅四处编辑点） | EBNF / 注记 7 / 微示例 / E100 码表行 |
| `docs/vfsl/schema-authoring-guide.md` | ✅ ALLOW 行 4（`:145` + `:216` + §6 可选示例） | 规范陈述同步 |
| `packages/vfsl/test/parse-vfsl-errors.test.ts` | ✅ ALLOW 行 5 | T1 载体替换 |
| `packages/vfsl/test/parse-vfsl-r3-regression.test.ts` | ✅ ALLOW 行 6 | T2 载体替换 |
| `packages/vfsl/test/parse-vfsl-number-literals.test.ts` | ✅ ALLOW 行 7 | C1/C2 |
| `packages/vfsl/test/validate-number-literals.test.ts` | ✅ ALLOW 行 8 | C3 |
| `packages/vfsl/test/number-literals-fixture-drift.test.ts` | ✅ ALLOW 行 9 | C5 |
| `packages/vfsl-codegen/test/generate-number-literals.test.ts` | ✅ ALLOW 行 10 | C4 |
| `packages/vfsl-codegen/test/generate-number-literals.test-d.ts` | ✅ ALLOW 行 11（可选） | C4 类型级加固 |
| `wiki/raw/task_issue-314_sa3_impl.md`（本报告） | 本角色产物 | 实现报告 |

**零 DENY 触碰**：`ir.ts`/`evaluate.ts`/`validate.ts`/`fingerprint.ts`/`packages/vfsl-codegen/src/**`/
`domains/vfs3-assets/**`/`docs/adr/**`/`tests/acceptance/**`/`vitest.config.ts`/CI 均未改动
（`git status --short` 与 `git diff --stat` 见 §Verification）。

## Verification

| Command | Result | Evidence |
| --- | --- | --- |
| **红灯（实现 stash 后）**：`vitest run <C1/C3/C4/C5 四文件> --typecheck.enabled=false` | exit 1（预期红） | `Test Files 3 failed \| 1 passed (4)`、`Tests 22 failed \| 21 passed (43)`：C1 19 红（3 例无符号正例 `00`/`9007199254740993`/`'9'×308` 本就绿）+ C2 三处目标行为红（`-1e3` 锚 (1,25)、`-0` 家族消息、负超域消息）；C3/C4 文件在模块级 `derive()` 崩（parse 红，即契约预测的「断言链首步失败」）；C5 绿 |
| **绿灯**：SA6 §12.8 focus 命令（4 文件，默认 typecheck 开） | **exit 0** | `Test Files 4 passed (4)`、`Tests 58 passed (58)`、`Type Errors no errors` |
| 影响包全套件：`vitest run packages/vfsl/test packages/vfsl-codegen/test --typecheck.enabled=false` | exit 0 | `Test Files 48 passed`、`Tests 795 passed` |
| 文档编辑后回归：`spec-docs-anchor-m4-contract` + `domains-scaffold` | exit 0 | `2 files / 9 tests passed`（Suite D 与脚手架门禁不受六处编辑影响） |
| `pnpm typecheck` | **exit 0** | 14 个 tsc 工程全绿（含新 `.test-d.ts`） |
| `pnpm generate --check` | **exit 0** | 无输出（`generated.ts` 字节新鲜、零漂移） |
| `git diff --check` | **exit 0** | 无输出 |
| `python3 tests/acceptance/vfsl_spec_acceptance.py` | **exit 0** | `GREEN（验收通过）: 22/22`（G4 候选 EBNF 结构合法、G5/G6 要素齐备） |
| 扩充模式组 grep（`无符号\|整数文字\|数字字面量\|负数\|小数\|负号\|十进制\|NumberLiteral`，`docs/` 排除 `docs/adr/`） | 无矛盾陈述 | 残余命中：v1-spec `:55`（种类）/`:63`（新 EBNF）/`:83-89`（新注记 7）/`:91`（注记 8 种类）与 guide `:146`/`:217`（新口径）——均为拓宽后一致面；`why-nomicore.md` 动机叙事与 `instance-replication-v1.md:506` wire 凭据按设计审计排除 |
| 边界探针（设计 §8 表重放，临时探针目录 `.sa3-tmp/` 收尾已删除） | 全行一致 | `-1e3`@(1,25)；`-1 & string` E100@(1,26)；`Record<-1,string>` E306@(1,30)；`type ROOT = -1 \| 0.5;` E311@(1,13)；`type A = -1;` E310@(1,1)；`-0` 家族 E100@(1,23) 消息含 `-0` + `请改写为 0`；`±'9'×309` 同超域消息@(1,23)；`-1.`@(1,25)、`1.5.5`@(1,26)、`1.5e3`@(1,26)；`1 -1`/`1-1` 码 + 锚不变仅正文变；`Record<-0,string>` 先命中 D4 E100@(1,30) |
| 回归翻转面（B15）：`parse-vfsl-errors` + `parse-vfsl-r3-regression` 焦点 | exit 0 | 两文件全绿；R-1 三锚位 (1,16)/(1,17)/(1,16) 数值零改动（仅载体 `-1`→`- 1`） |
| 全仓 `pnpm test`（额外证据，超出 SA3 最小职责） | **exit 0** | `Test Files 324 passed (324)`、`Tests 3445 passed (3445)`、`Type Errors no errors`（HEAD 基线 319/3383 → +5 文件 / +62 测试 = 5 个新测试文件 58 运行时用例 + `.test-d.ts` 4 类型级用例，无既有用例翻转遗漏） |

### 红灯 → 绿灯序列证据

- 红灯命令：`NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/vfsl/test/parse-vfsl-number-literals.test.ts packages/vfsl/test/validate-number-literals.test.ts packages/vfsl/test/number-literals-fixture-drift.test.ts packages/vfsl-codegen/test/generate-number-literals.test.ts --typecheck.enabled=false --passWithNoTests=false`
  （实现经 `git stash push -- packages/vfsl/src/tokenizer.ts packages/vfsl/src/parser.ts` 临时移除；红后 `git stash pop`，
  `git diff` 哈希前后一致 `b1f00541…c660b`，实现无遗失）。
- 绿灯命令：SA6 §12.8 同款（默认 typecheck 开）→ 58/58、`Type Errors no errors`。
- 负控（C2/C5）实现前 18/18 + 3/3 绿、实现后保持绿；突变敏感性由 C2 下溢判别对（`'0'×322` 正例 vs `'0'×323` 负例）、
  `- 1`/`-/*c*/1` trivia 负例与 `-1e3` (1,25) 锚钉覆盖（SA6 §12.9 弱实现矩阵逐条对应）。

## Deferred verification

- 全仓 `pnpm test` 已作为额外证据执行完毕（见 §Verification 末行，exit 0）；此处不再有本角色待跑的回归项。
- SA4 复核 / SA7 最终动态验证 / CI 6 分片、`codegen-freshness`、`domain-scaffold` 门禁。
- SA8 实现后复查三项（设计 §15）：六处文档落地（本报告已给逐处 diff 与 grep 证据）、
  D2 指纹触发器零漂移（C5 哨兵 + `generate --check`）、锚位变化清单穷尽（`-1e3` 唯一登记变化 + 边界探针全表）。
- 运行期 number 基线（NaN/±Infinity/-0 的运行期拒绝）明确非本任务（ADR 0021 / issue #312）。

## Deviations or blockers

1. **`-0` 消息与注记 7 的权威引用**：设计 §5-D4 示例引「ADR 0021 决策 2」（该 ADR 正文不在本仓），
   按设计落地建议 / SA2 观察 2 / SA8 §8.5 改为引**仓内**权威「ADR 0020 决策 3」（修订句）。
   码（E100）与锚（记号起点）不变，消息语义（含 `-0` + 引导写 `0`）不变。
2. **指南 §6 示例增补**（设计标注「可选，非必须」）：已增补 `type Level = -1 | 0.5 | 2;` 一行，
   与 `:145`、`:216` 同口径示范。
3. **`.test-d.ts` 类型级文件**（设计标注「可选，建议」）：已落地并按现有
   `generate-discriminated-narrow.test-d.ts` 风格用 module augmentation + `@ts-expect-error`。
4. 未执行 `git add`/`commit`/`push`/PR/finalize（SA3 边界）；`.sa3-tmp/` 临时探针目录收尾前删除。
5. **无阻塞项**：设计可实施、ALLOW/DENY 明确、SA2 BLOCKER/MAJOR 已落实、SA8 约束在范围内实现、
   红灯契约与设计一致。

## Suggested commit message

```
feat(#314): VFSL 数字字面量拓宽为 -? [0-9]+ ('.' [0-9]+)?（ADR 0020 决策 3）

- tokenizer：数字记号入口接受紧邻 digit 的负号；小数点两侧 digits 必填、每记号至多一个 `.`；
  裸 `-` / `- 1` / `-/*c*/1` / `.5` / `1.` / 指数记号维持 E100 与既有锚位（唯一登记变化 `-1e3` → (1,25)）
- parser：新增 `-0` 值判定闸门（Object.is，覆盖小数下溢形态），复用 E100、锚记号起点、消息引导写 0
- tests：新增 C1/C2 解析矩阵、C3 validate f64 严格相等、C4 codegen + 真实 tsc 诊断、C5 指纹/生成物零漂移哨兵；
  T1/T2 语义翻转载体替换（`-0` 一锚留守、`- 1` 保 R-1 锚位）
- docs：同变更集落地六处规范陈述（v1-spec EBNF/注记 7/微示例/E100 码表行 + 指南 §6 注意列表与「v1 语法护栏」白名单句）

Refs: #314, ADR 0020 决策 3/5/7/10
```

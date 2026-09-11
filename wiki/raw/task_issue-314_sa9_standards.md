# SA9 标准审查 — issue #314：VFSL 数字字面量拓宽（负号与小数，ADR 0020 决策 3）

- 审查对象：**已提交交付** commit `724e58bd68006e20a72bc6adcbe6053e63845a80`
  （`feat(vfsl): support signed decimal literals`，分支 `mabf/issue-314`）
- 权威 Parent PR base：`docs/issue-310-vfsl-number-constraints` @
  `29ff10f843a4d877866e963cedc8766d60194d33`（= HEAD~1；diff 恰为本次交付）
- 审查模式：独立标准审查——只判断实现是否符合仓库 AGENTS、ADR、模块责任、既有架构惯例、
  单一事实源、生命周期对称性、文件范围与测试质量标准；**不审查 Issue 需求完整性（SA10 辖域）**；
  不修改代码/设计/测试，不运行测试，不启动服务
- Issue #314 comments REST `[]`；owner requirements：none（dispatch 复述与简报一致）
- 工作树复核：`git status --short` 仅 1 个未跟踪 Host 简报（`wiki/raw/task_issue-314.md`），
  被审提交与工作树一致，无夹带

---

## 1. Reviewed inputs

| 输入 | 状态 | 取用方式 |
| --- | --- | --- |
| `wiki/raw/task_issue-314.md`（Host 简报） | 存在（未跟踪，33 行；comments REST `[]`） | 全文 |
| `wiki/raw/task_issue-314_design.md`（SA1 设计 iteration 3） | 存在（570 行，已入提交） | §5-D1–D7、§8 边界表、§9 ALLOW/DENY、§12 C1–C7 |
| `wiki/raw/task_issue-314_sa2_review.md`（SA2 iteration 1，approve） | 存在（245 行，已入提交） | §13/§14 |
| `wiki/raw/task_issue-314_sa3_impl.md`（SA3 实现报告 iteration 0） | 存在（136 行，已入提交） | Changed paths / Deviations / Verification |
| `wiki/raw/task_issue-314_sa4_review.md`（SA4 iteration 0，approve） | 存在（234 行，已入提交） | 全文；其静态结论本审查独立抽核 |
| `wiki/raw/task_issue-314_sa6_contract.md`（SA6 验收契约，accepted） | 存在（577 行，已入提交） | §12.0 断言纪律、§4 基线指纹 |
| `wiki/raw/task_issue-314_design_conflict_report.md`（SA8 iteration 1，clear） | 存在（181 行，已入提交） | §8 Required actions |
| `wiki/raw/task_issue-314_implementation_conflict_report.md`（SA8 iteration 2，clear） | 存在（161 行，已入提交） | §3 十六项对照、§8、§10 |
| 模块规约 | 根 `AGENTS.md`、`packages/vfsl/AGENTS.md`、`packages/vfsl-codegen/AGENTS.md`、`docs/AGENTS.md` | 全文逐条对照 |
| 决策集 | ADR 0020（决策 1/3/5/7/10、决策 9 supersede 标注）、ADR 0005/0007/0017/0019 | 全文/相关节 |
| 实际交付 diff | `git diff 29ff10f..HEAD`（18 文件，2793+/23-） | **全部结论取自 diff 原文与现行文件文本，非转述上游报告** |

## 2. Verdict

**`approve`** —— 无 BLOCKER、无 MAJOR；3 项 MINOR 非阻塞观察（§12）。

核心结论（证据见 §3–§10）：

1. **模块规约逐条合规**：vfsl 兼容性行为面（错误码/issue 顺序/行列/指纹输入）零未授权变更；
   vfsl-codegen 字节稳定与「不重推导语义」红线零触碰；docs「更新所有陈述该契约的规范文档」
   义务以六处编辑同提交闭合（本审查独立扩充 grep 复核零矛盾残余）。
2. **ADR 0020 决策 1/3/5/7/10 逐项如裁决落地**；`-0` 复用 E100 有决策 3 修订句 + 决策 4
   「零新增错误码」+ v1-spec §8 首次发布前豁免的显式授权链。
3. **文件范围精确**：11 个代码/文档/测试文件与设计 §9 ALLOW 逐行吻合，DENY LIST 零触碰
   （本审查以 `git diff --name-only` 独立核对）。
4. **测试质量达仓内高标准**：无 skip/only/todo（本审查 grep 复核）；码+行列双钉；突变敏感
   用例齐备；「合法 TS」由真实编译器诊断证明；指纹/生成物字节级哨兵；红→绿证据链
   （SA3 动态 + SA4 静态复算 43/58 精确吻合）自洽可信。

## 3. 仓库 AGENTS 合规

| 规约条款（来源） | 交付行为 | 本审查独立证据 | 裁决 |
| --- | --- | --- | --- |
| 公共畸形输入路径返回判别结果不抛出；同步确定（vfsl AGENTS Boundaries） | 新增 `-0` 闸门走既有 `this.err`（`VfslSyntaxError`），由 `parseVfsl` 顶层 try/catch 转 `{ok:false, issues:[单条]}` | `parser.ts:425-427`；`index.ts:155-176`（接缝零改动，不在 diff） | ✅ |
| IR/derived 环境无关、可 JSON 序列化（同上） | `-0`/±Infinity 解析期拒绝 ⇒ 可达 IR number 值域 JSON 忠实；`NaN` 不可能由合法记号 `Number(raw)` 产出 | `parser.ts:418-427`；设计 §3 放大因素分析 | ✅ |
| 公共 API 仅经 `src/index.ts`（同上） | `index.ts` 不在 diff；`isDigitCodeUnit` 为模块私有函数；`tokenize`/`Token` 维持内部 | `tokenizer.ts:61-64`；diff 文件清单 | ✅ |
| 错误码、issue 顺序、行列定位、指纹输入是兼容性行为（同上） | 零新增错误码（E 码表本审查计数仍 21 行）；唯一登记锚位变化 `-1e3` → (1,25) 由 ADR 0020「全局规则不特判」直接授权并 C2 钉死；指纹输入零变化（C5 三值钉死） | `docs/vfsl/v1-spec.md` 码表 grep；`parse-vfsl-number-literals.test.ts:198`；`number-literals-fixture-drift.test.ts:23-25` | ✅ |
| 消费 evaluator 输出；不在生成器重推导 VFSL 语义（vfsl-codegen AGENTS） | `packages/vfsl-codegen/src/**` 零触碰——无记法归一化层、无特判 | diff 文件清单（本审查核对） | ✅ |
| 输出确定、字节稳定；`generate --check` 检出陈旧（同上 + ADR 0005） | `domains/vfs3-assets/generated.ts` sha256 钉死于 SA6 §4 基线（SA4 独立复算一致）；SA3 报 `generate --check` exit 0 | `number-literals-fixture-drift.test.ts:46-49` | ✅ |
| 代码行为变化时更新**所有**陈述该契约的规范文档；文档不得发明实现行为（docs/AGENTS Editing） | 六处编辑（spec `:63`/`:83-90`/微示例一删一增/`:364` + 指南 `:146`/`:217`）与源码**同提交**落地；全部文本转述 ADR 0020 决策 3 现行口径，未发明指数/十六进制/-0 合法化等任何决策外语法 | diff 原文逐 hunk；本审查 §4 grep 复核 | ✅ |
| ADR append-only；supersede 显式标注（docs/AGENTS） | `docs/adr/**` 零触碰；ADR 0020 决策 3 修订句与决策 9 supersede 标注由前置提交（29ff10f）承载，本交付无新决策产生 | diff 文件清单 | ✅ |
| 变更 `packages/`、`docs/` 前读最近嵌套 AGENTS（根 AGENTS） | 流水线证据（设计 §6 约束表、SA3 Inputs、SA4 §1）显示模块规约被读取并逐条落实 | 各产物 §1 | ✅ |

## 4. ADR 合规（决策级逐条）

| 决策 | 交付落实 | 本审查证据 | 裁决 |
| --- | --- | --- | --- |
| ADR 0020 决策 3：文法 `-? [0-9]+ ('.' [0-9]+)?` 全局生效 | tokenizer 数字分支入口「digit 或 `-` 且单码元前看 digit」；可选 `-` + `[0-9]+` + 「`.` 两侧皆 digit」消费；无上下文特判 | `tokenizer.ts:209-237`；C1 全局位置矩阵（别名 RHS/数组/YLeaf/YArray/Record 值位）`:120-166` | ✅ |
| 决策 3：负号紧邻、作为 number 记号一部分扫描、不吞 trivia | 前看发生在原始文本码元（`charCodeAt(i+1)`，越界 NaN → false）；`- 1`/`-/*c*/1`/裸 `-`（含 EOF 前一位）落既有未知字符路径 | `tokenizer.ts:61-64,209`；C2 `:200-202` 三负例钉 (1,23) | ✅ |
| 决策 3 修订句：`-0` 解析期 E100、锚该记号、消息引导写 `0` | `Object.is(tok.num, -0)` **值判定**（覆盖 `-0`/`-0.0`/`-00` 与下溢形态），锚记号起点，消息「…-0 不在可写值域…请改写为 0」 | `parser.ts:421-427`；C2 `:205-209,236-245` 全族钉 (1,23) + 消息双要素 | ✅ |
| 决策 3：`.5`/`1.`/指数记号维持 E100；超双精度（含负值）沿既有路径 | `.5`/`1.`/`1..5` 锚位家族与 HEAD 一致；`-1e3` 锚迁 (1,25) 已登记；有限性闸门原文零改动、负值同消息 | C2 `:194-199,247-255`；`parser.ts:418-420`（diff 上下文零改动） | ✅ |
| 决策 3：f64 严格相等、字面量按 f64 解释（Considered Options 5 拒 epsilon） | validate/codegen 零改动（`enumContains` `===`、`String(number)` 现状）；C3 失配矩阵钉零 epsilon（`2.0000000000000004`/`0.1+0.2`）；spec 注记 7 同口径 | diff 无 `validate.ts`/`valuetype.ts`；`validate-number-literals.test.ts:96-111`；`v1-spec.md:86-89` | ✅ |
| 决策 5：既有语义指纹全部不变 | `ir.ts`/`fingerprint.ts` 零触碰；C5 双指纹 + `sha256:v1:` 前缀 + 生成物哈希逐字节钉死 | diff 文件清单；`number-literals-fixture-drift.test.ts:39-48` | ✅ |
| 决策 7：codegen 生成 `number` 原样、`generate --check` 基线不变 | 生成器源码零改动；C4 断言 `String(number)` 现状发射 + 真实 tsc 0 诊断 | diff 文件清单；`generate-number-literals.test.ts:125-133` | ✅ |
| 决策 10：spec 修订与实现同 PR；指数记号不做 | 六处文档编辑与源码同提交；指数记号仍 E100（C2 两例） | 提交 `724e58b` 文件清单；C2 `:197-198` | ✅ |
| 决策 1：不引入方言 v2 | 无方言路由/模式开关；信封 `version` 不动；EBNF 为现行文法纯超集 | diff 无路由面；`v1-spec.md:63` | ✅ |
| ADR 0007/0017 + `fingerprint.ts:7-13` D2 触发器 | 「**v2 方言**放开数值字面量语法 ⇒ 升 v2」条件不成立（决策 1）；前缀/域文档形态/基线指纹三面钉死，解释未被静默扩大 | `fingerprint.ts` 不在 diff；C5 `:41-43`；SA8 两轮复查同裁 | ✅ |
| ADR 0019（M4 Suite D 文档锚面） | spec §5 零触碰；指南 §7–§8 零触碰；`:146`/`:217` 用「负号**须**紧邻」不含「必须紧邻」串 ⇒ D3b 首现段落仍在 `:213` JSDoc 挂载句（本审查 grep 实证） | `grep -n '必须紧邻\|须紧邻' docs/vfsl/schema-authoring-guide.md` → `:213` 唯一 | ✅ |
| v1-spec §8 冻结规则（错误码稳定 + 首次发布前豁免 `:517-519`） | `-0` 复用 E100 处于 ADR 0020 决策 4「零新增错误码」明示裁决 + 发布前修订轮次豁免的授权链内；既有码条件含义无改写（纯拓宽只放行原 E100 文本） | `v1-spec.md:511-519`；ADR 0020 `:122-123` | ✅ |

## 5. 模块责任与架构惯例

### 责任归属

| Behavior | Expected owner | Actual location | 裁决 |
| --- | --- | --- | --- |
| `-`/`.` 记号扫描 | tokenizer 数字分支 | `tokenizer.ts:205-237` | ✅ 正确 |
| `-0`/有限性值域闸门 | parser 字面量分支（与既有闸门同位并列） | `parser.ts:416-428` | ✅ 正确 |
| enum 折叠 / 严格相等 / 投影 / 判别键 | evaluate / validate / codegen（零改动） | 全部不在 diff | ✅ 正确（设计 D6 + DENY 兑现） |

### 既有惯例一致性（本审查独立对照）

| 惯例 | 既有先例 | 本交付 | 裁决 |
| --- | --- | --- | --- |
| 手写码点循环、无正则引擎 | tokenizer 全文（HEAD） | 同一循环内扩展，每字符至多一次前看，O(n) 单遍无回溯 | ✅ |
| 码元级单字符前看 | 字符串转义 `charCodeAt(i+1)`（`tokenizer.ts:259`） | `isDigitCodeUnit(text.charCodeAt(i+1))` 同款 | ✅ |
| 词法延迟错误记号（error 记号 + `break scan`，文本序首错胜出） | `tokenizer.ts:299-302` | 未入数字分支的 `-`/`.` 仍走该路径，注释同步改写 `:299-300` | ✅ |
| 列记账按码点（星面字符 R-1 回归面） | `parse-vfsl-r3-regression.test.ts` | 数字字符皆 ASCII 单码元，每字符 1 列；T2 三锚位 (1,16)/(1,17)/(1,16) 数值零改动 | ✅ |
| 临时目录编译测试辅助 | `generate-protocol-import.test.ts:70-82` 本地 `compileInTempDir` + finally 清理 | 新 C4 同款本地辅助（包内逐文件本地辅助即先例形态），共享 `tsc-helper.preEmitDiagnostics` 无第二套编译装置 | ✅ |
| `.test-d.ts` 类型级增广参照系 | `generate-discriminated-narrow.test-d.ts` | 同款 module augmentation + `@ts-expect-error` 自反转；增广键 `numberLiterals*` 全仓唯一 | ✅ |
| 任务域指纹/生成物哨兵 | `parse-vfsl-union-member-docs.test.ts:34` pin | C5 独立哨兵（重叠已登记，SA2 观察 3 裁「保留」） | ✅ |

## 6. 单一事实源

| Fact | Authoritative source | Derived state | Drift risk 评估 |
| --- | --- | --- | --- |
| 字面量文法 | v1-spec §2 EBNF（`:63`）+ 注记 7（`:83-90`） | tokenizer 实现（注释引 spec/ADR 锚）+ 指南两处（`:146`/`:217`，ADR 0020 决策 10 明示要求同步） | **低**：六处同提交闭合；本审查以扩充模式组（`无符号\|整数文字\|数字字面量\|负号\|NumberLiteral`）对 `docs/`（排除 `docs/adr/`）独立重跑，残余唯一命中为 `instance-replication-v1.md:506`「无符号 64-bit」wire 凭据（非 VFSL 文法陈述，正确排除）；CONTEXT.md `:61`/`:120`「字面量联合」为种类级术语，不约束 number 形态 |
| `-0`/数值域规则 | ADR 0020 决策 3 修订句 | parser 闸门 + 注记 7（引仓内权威「ADR 0020 决策 3 修订句」，未引仓外 ADR 0021） | 低：消息/注记/实现三处同引 |
| 指纹 | `fingerprint.ts` 单一生产者（D2-CONTRACT-MARKER） | C5 与既有 pin 双哨兵（不同任务域，登记重叠） | 无新增 |

## 7. 生命周期对称性

纯函数管线：无 register/dispose、start/stop、缓存键与后台任务面。测试侧 C4
`mkdtempSync`/`rmSync` 在 `finally` 对称清理（与 `generate-protocol-import` 先例同款）。
回滚 = 单提交 revert 即完全回退（无持久化/wire/生成物差异——生成物哈希钉死不变）。
**无不对称风险。**

## 8. 文件范围审查

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 交付文件 vs 设计 §9 ALLOW | **11/11 逐行吻合**：tokenizer、parser、v1-spec（恰 4 编辑点）、guide（`:146`+`:217`+§6 可选示例行）、T1、T2、C1/C2、C3、C5、C4、C4 `.test-d.ts`（可选授权项） | `git diff 29ff10f..HEAD --name-only`（本审查独立执行） |
| DENY LIST 触碰 | **零**：`ir.ts`/`evaluate.ts`/`derived.ts`/`validate.ts`/`shapes.ts`/`resolve*.ts`/`semantic.ts`/`envelope.ts`/`schemasource.ts`/`index.ts`/`errors.ts`/`pattern.ts`/`fingerprint.ts`、`packages/vfsl-codegen/src/**`、`domains/vfs3-assets/**`、`docs/adr/**`、`tests/acceptance/**`、`vitest.config.ts`、CI、scripts 均不在 diff | 同上 |
| spec 编辑面约束 | 恰 5 hunk 全落 §2 四编辑点 + §4 一行；§3/§5/§7/§8/§10 与未列行零触碰；E 码表仍 21 行；表格单元格无未转义 `\|`（本审查 grep 计数 + 逐 hunk） | diff hunk 清单 |
| 机检面相容（静态） | 新 EBNF 仅用 `[ … ]` 可选组与 quoted 终元——acceptance 脚本 EbnfValidator 记号集（`tests/acceptance/vfsl_spec_acceptance.py:153`）支持；FORBIDDEN_KEYS/REQUIRED_LHS/REQUIRED_TERMINALS 面不受六处编辑影响；SA3 报机检 22/22 绿 | 脚本静态核验 |
| wiki 流水线产物入提交 | 设计/SA2/SA3/SA4/SA6/SA8×2 共 7 产物随提交入库——与 b158f98（42 个 wiki 文件入提交）先例一致；`.gitignore` 的 MABF 禁入清单（TASK.md/.mabf*）不含 wiki/raw | `git ls-files wiki/raw` 历史核对 |

## 9. 测试质量标准审查

| 标准（仓内惯例/SA6 §12.0） | 交付表现 | 本审查证据 |
| --- | --- | --- |
| 无 skip/only/todo、无软化 | 五新文件 + T1/T2 全部无 `.skip/.only/.todo/xit/xdescribe` | 本审查 grep（`packages/**/test*number-literals*` + `.test-d.ts`）零命中 |
| 只观察公共接缝 | C1/C2 仅 `parseVfsl`；C3 仅 `parseVfsl`/`evaluate`/`validateLogicalSnapshot`；C4 仅 `generateProjection` + tsc API；C5 仅 `FileSchemaSource`/`compileSchemaEnvelope` + 文件字节 | 各文件 import 面 |
| 负例码 + 行列双钉（只断 ok:false 不足） | C2 15 形态 `^VFSL-E100: ` 前缀 + line + column 全钉；消息类别/-0 双要素/超域前缀分组断言 | `parse-vfsl-number-literals.test.ts:212-255` |
| 正例用完整 ROOT 模块、值断言精确 | C1 MODULE(FORM) 恒 (1,23) 起点；`toBe`（Object.is 语义）钉 f64 归一值（`-0` 与 `0` 可区分） | `:82-118` |
| 突变敏感性（杀死弱实现） | 下溢判别对（322 正 vs 323/400 负）杀文本判定；`- 1`/`-/*c*/1` 杀吞 trivia；`-1e3`@(1,25) 杀特判拉回；负超域杀跳过有限闸门；`-1e-323` 正例防 `===0` 误拒 | `:92,198,200-209,247-255` |
| 「合法 TS」由编译器证明而非正则冒充 | C4 `preEmitDiagnostics` 孤立 program 0 诊断 + `Number(段) === IR` 值等价；`.test-d.ts` 写路径 `@ts-expect-error` fail-closed | `generate-number-literals.test.ts:108-133`；`.test-d.ts:62-71` |
| 零漂移红线可机检 | C5 envelope/semantic 指纹全值 + `sha256:v1:` 前缀 + `generated.ts` sha256 字节钉死（与 SA6 §4 基线三方一致） | `number-literals-fixture-drift.test.ts:23-49` |
| 发现面自动入片 | 新 `.test.ts` 命中 `packages/*/test/**/*.test.ts`；`.test-d.ts` 命中 vitest typecheck include 与 `tsconfig.typecheck.json`（`packages/*/test/**/*.ts`） | `vitest.config.ts:15-21`、`tsconfig.typecheck.json` |
| 红→绿契约证据 | SA3 报 stash 红灯 43 / 绿灯 58 + 全仓 3445 绿；SA4 静态复算（C1 22 + C2 18 + C5 3 = 43；+C3 8 +C4 7 = 58）精确吻合，自洽可信；动态终验归 SA7/CI | SA3 §Verification、SA4 §9 |
| 非目标边界禁断言 | C3 文件头显式登记运行期 -0/NaN 语义禁断言（ADR 0021/#312 辖域） | `validate-number-literals.test.ts:8-9` |
| 回归翻转面处置保锚 | T1 `-1`→`-0` 同锚 (1,10)；T2 `-1`→`- 1` 三锚数值零改动、R-1 意图完整；本审查独立 grep 全仓测试树确认此外无其他 VFSL `-` 字面量载体（B15 穷尽性复核成立） | T1/T2 diff；本审查 grep（`= -[0-9]` 等模式，残余命中均为非 VFSL 运行时值） |

## 10. 审查边界声明

按角色辖域，本审查**不**评价 Issue #314 需求是否完整实现（SA10 辖域）、不重新运行动态
验证（SA7/CI 辖域）；SA3 自报的动态证据（focus 58/58、全仓 3445 绿、typecheck/
generate --check/机检 exit 0）未经本审查复跑，其静态可核面（测试文件组织、锚位数值、
钉死值与基线一致性、机检面相容性）已由本审查与 SA4 独立核验。

## 11. Required revisions

| Finding ID | Severity | Evidence | Problem | Required change |
| --- | --- | --- | --- | --- |
| ——（无） | —— | —— | 无 BLOCKER / MAJOR | —— |

## 12. Non-blocking observations（MINOR，不阻断 approve）

1. **提交消息缺 issue/ADR 引用**：`feat(vfsl): support signed decimal literals` 未带
   `(#314)` 与 ADR 0020 引用，也丢失了 SA3 建议消息体中「唯一登记锚位变化 `-1e3` →
   (1,25)」的说明。仓内无书面提交消息标准，且历史存在无引用先例（如
   `fix: make published CLI bins executable…`），但近 30 提交的主导惯例是带 `(#NNN)`。
   建议在集成 PR 标题/squash 消息中补齐 `#314` 引用与锚位变化登记。
2. **E100 码表行例示归类精度**（SA8 实现后复查 §8.1、SA4 观察 1 已登记，本审查复核
   确认）：`v1-spec.md:364` 把「`-0` 字面量」列于「不可从 §2 文法推导的任何构造」示例
   清单，而拓宽后 `-0` 文法可推导、拒绝依据是值域闸门（注记 7 `:89-90` 承载精确口径，
   两处对码的指派一致）。系设计 D7-4 目标文本原样落地，无决策违反、无行为发明——
   纯文档措辞项，后续可微调为「文法/值域外的构造」类表述。
3. **Host 简报未入提交**：`wiki/raw/task_issue-314.md` 仍为未跟踪文件，而其余 7 个
   流水线产物已随提交入库（b158f98 先例中 dispatch 类产物同样入库）。简报可由 issue
   #314 复原且 wiki/raw 属证据层非规范契约——程序性提示：finalize 时可一并入库保持
   证据链完整。

## 13. requiresConflictRecheck

**`false`**。本审查未发现超出 SA8 两轮复查（design iteration 1 / implementation
iteration 2，均 `clear`）已裁决面之外的新决策面：交付未新触 ADR/协议/wire/持久化/
状态机面；D2 指纹触发器解释未被扩大；六处文档编辑与锚位变化清单均已闭合。SA8
implementation 复查的 `requiresConflictRecheck: false` 结论维持。

---

— SA9 Standards Reviewer · dispatch `sa-b447c6f7-ca30-487f-8ad4-f8b31c561303` · iteration 0

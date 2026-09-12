# SA4 实现静态审查 — issue #314：VFSL 数字字面量拓宽（负号与小数，ADR 0020 决策 3）

- 审查对象：SA3 实现（`wiki/raw/task_issue-314_sa3_impl.md` iteration 0）＋当前工作树实际 diff
  （基线 HEAD `29ff10f843a4d877866e963cedc8766d60194d33`，分支 `mabf/issue-314`）
- 审查模式：独立静态攻击审查——只读源码 / 设计 / 契约 / ADR / 测试 / 只读 Git 与哈希命令；
  不修改实现、设计与测试，不运行测试 / 服务 / 机检脚本，不创建临时进程
- 审查基线与本轮 `git status` 复核：6 个已改文件（61+/23-）＋ 5 个新增测试文件＋ wiki 流水线产物，
  与 SA3 报告 §Changed paths 逐项一致，无未申报文件；`.sa3-tmp/` 已清理（untracked 列表无残留）
- 本报告为该任务首个 SA4 产物（iteration 0，新建）

---

## 1. Reviewed inputs

| 输入 | 状态 | 取用方式 |
| --- | --- | --- |
| `wiki/raw/task_issue-314.md`（Host 简报） | 存在（33 行；comments REST `[]`，正文 `## Comments` 空） | 全文；5 条 AC 为验收基线 |
| `wiki/raw/task_issue-314_design.md`（SA1 设计 iteration 3，唯一一致设计） | 存在（570 行） | 全文；D1–D7、§8 边界表、§9 ALLOW/DENY、§12 C1–C7 逐条对照实际 diff |
| `wiki/raw/task_issue-314_sa6_contract.md`（SA6 验收契约，accepted） | 存在（577 行） | 全文；§12.0–§12.9 断言矩阵、§4 基线指纹、§14 发现面 |
| `wiki/raw/task_issue-314_sa2_review.md`（SA2 iteration 1，approve） | 存在（245 行） | §13/§14；观察 2（-0 消息仓内权威）、观察 6（C1 分组）、观察 7（T1 重组）落实面 |
| `wiki/raw/task_issue-314_design_conflict_report.md`（SA8 设计后复查 iteration 1，clear） | 存在（181 行） | §8 Required actions 1–5 |
| `wiki/raw/task_issue-314_implementation_conflict_report.md`（SA8 实现后复查 iteration 2，clear） | 存在（161 行） | §8 Required actions；其非阻塞措辞观察（E100 码表行 `-0` 例示归类）本报告复核确认 |
| `wiki/raw/task_issue-314_sa3_impl.md`（SA3 实现报告 iteration 0） | 存在（136 行） | 全文；Changed paths / Deviations / Verification 自报数字与本审查独立静态计数交叉核对 |
| 模块规约 | `packages/vfsl/AGENTS.md`、`packages/vfsl-codegen/AGENTS.md`、`docs/AGENTS.md`、根 `AGENTS.md` | 兼容性行为 / 字节稳定 / 同 PR 文档义务 |
| 实际 diff 与源码 | `git diff`（tokenizer/parser/docs/两测试）＋ 5 个新测试文件全文精读 | 全部结论取自 diff 原文与现行文件文本，非转述 SA3 报告 |

`task_issue-314_relevant_decisions.md` / `task_issue-314_conflict_report.md`（任务前置 SA8 产物）不存在——
SA6 §1、SA2 §1、SA8 两轮复查 §1/§2 四方一致确认；SA8 已独立覆盖决策集枚举，该缺口不阻断本审查。

## 2. Verdict

**`approve`** —— 无 BLOCKER、无 MAJOR。

核心结论（证据见 §3–§9）：

1. **tokenizer 扫描算法与设计 D1/D2 逐条一致**：入口「digit 或 `-` 且单码元前看 digit」、
   可选 `-` 消费、`[0-9]+`、`.` 仅两侧皆 digit 时消费且每记号至多一个、`value` 保留原文、
   `num = Number(raw)`；`charCodeAt` 越界 NaN → false 使末位 `-` / 末尾 `.` 落既有未知字符路径；
   前看发生在原始文本码元上（`- 1` / `-/*c*/1` 不吞 trivia 构造性成立）。
2. **parser `-0` 值闸门与 D4 一致**：有限性闸门原文零改动，旁列 `Object.is(tok.num, -0)` 值判定，
   锚 number 记号起点；消息含 `-0` 且引导写 `0`，改引仓内权威「ADR 0020 决策 3」——属设计
   §5-D4 落地建议 + SA2 观察 2 + SA8 §8.5 授权链内的已申报偏离（SA3 Deviations 1）。
3. **六处规范文档编辑全部落地且目标文本与设计 §5-D7 1–6 逐句一致**；本审查以扩充模式组独立
   重跑 grep：docs/（排除 adr/）矛盾陈述残余为零，仅剩 `why-nomicore.md` 动机叙事与
   `instance-replication-v1.md:506` wire 凭据两类已登记排除项。
4. **零漂移有构造性证据**：fixture `schema.vfsl` 中唯一 `-` 位于 Pattern 字符串字面量内
   （`\\-`，非记号级 digit 邻接）⇒ 记号化不变 ⇒ 指纹必然不变；且本审查重新计算
   `domains/vfs3-assets/generated.ts` sha256 = `342d8c1f…6707`，与 C5 钉死值及 SA6 §4 基线
   三方逐字符一致。
5. **测试矩阵完备、纪律合格、真实可触发**：C1/C2/C3/C4/C5 对 SA6 §12 契约逐项落齐（含
   (1,26) 勘误锚、下溢判别对、负超域消息）；无 skip/only/todo；负例码 + 行列双钉；SA3 自报
   红灯 43 / 绿灯 58 与本审查对测试用例的独立静态计数（22 C1 + 18 C2 + 3 C5 = 43；
   +8 C3 +7 C4 = 58）精确吻合——自报证据内部自洽，可信度高。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
| --- | --- | --- |
| Issue 正文：文法 `-? [0-9]+ ('.' [0-9]+)?` 全局生效 | `tokenizer.ts:209-237`（数字分支重写）；C1 全局位置矩阵（别名 RHS/数组/YLeaf/YArray/Record 值位） | ✅ 落实 |
| Issue 正文：负号紧邻数字、作为 number 记号一部分扫描 | `tokenizer.ts:209` 入口条件 + `:206-208` 注释；`- 1`/`-/*c*/1`/裸 `-` C2 钉 E100@23 | ✅ 落实 |
| Issue 正文：裸 `-` 维持未知字符 E100 路径 | `isDigitCodeUnit`（`:61-64`）对 NaN → false；`:299-302` 未知字符分支注释同步改写 | ✅ 落实 |
| Issue 正文：`.5` / `1.` / `1e3` 维持 E100 | C2 `:194-199`（`.5`@23 / `1.`@24 / `1e3`@24）＋消息类别断言 `:219-234` | ✅ 落实 |
| Issue 正文：超双精度（含负值）沿 §7.3 判 E100 | `parser.ts:418-421` 既有闸门零改动；C2 `:247-255` 两形（±`'9'×309`）钉消息前缀 + (1,23) | ✅ 落实 |
| Issue 正文：`-0`（含下溢形态）解析期 E100、引导写 `0` | `parser.ts:425-427` 值判定闸门；C2 `-0`/`-0.0`/`-00`/两下溢形态全族 @ (1,23) + 消息含 `-0` 且 `请…0` | ✅ 落实 |
| AC1（联合成员 + validate f64 严格相等） | C1（`parse-vfsl-number-literals.test.ts`）＋ C3（`validate-number-literals.test.ts` 8 用例含 `2.0000000000000004`/`0.5000000000000001`/`0.1+0.2` 失配） | ✅ 落实 |
| AC2（四类负例 E100 + 锚位） | C2 15 形态码 + 行列双钉（含登记锚位变化 `-1e3`@25） | ✅ 落实 |
| AC3（超双精度含负值 E100） | C2 超域两形态 | ✅ 落实 |
| AC4（指纹零漂移 + 合法 TS） | C5 三值钉死（本审查哈希复算一致）＋ C4 发射文本 + `Number(段)` 值等价 + 真实 tsc 0 诊断 | ✅ 落实 |
| AC5（门禁全绿） | SA3 自报 focus 58/58、typecheck/generate --check/git diff --check/机检 exit 0；`git diff --check` 本审查复跑 CLEAN；其余归 SA7/CI 动态确认（§11） | ✅（静态面核实，动态面移交） |
| SA2 F1（第六处 `:216` 护栏句） | diff：`字符串或整数文字` → `字符串或数字文字（可选负号与十进制小数；负号须紧邻数字）`，与 D7-6 目标文本逐字一致 | ✅ 已落实 |
| SA2 观察 2/6/7、SA8 §8.5 | 消息改引仓内权威（Deviation 1）；C1 按期望分组 describe；T1 维持 `-0` 一锚留守 | ✅ 全部吸收 |
| Owner 评论 | comments REST `[]`、简报 `## Comments` 空——无追加要求，无 Comment ID 可映射 | 无缺口 |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
| --- | --- | --- | --- |
| D1 负号进 number 记号（单码元前看） | `tokenizer.ts:209`（入口）、`:213-217`（消费 `-`）、`:206-208`（注释） | 一致：入口条件、NaN 边界、trivia 不吞全部构造性成立；拒绝的 parser 拼接备选未被采纳 | 无 |
| D2 小数点单字符前看最大咀嚼 | `tokenizer.ts:225-234`（`.` 两侧 digit 才消费、至多一个） | 一致：`.5`/`1.`/`1..5`/`1.5.5`/`-1.` 全部落未知字符或既有语法路径（锚位家族保持） | 无 |
| D3 值语义 `num = Number(raw)` f64 归一 | `tokenizer.ts:236`；C1 值断言（`9007199254740993`→`…992`、`0.999…9`→`1`、`-0.`+322+`1`→`-1e-323`） | 一致 | 无 |
| D4 `-0` 值判定闸门（Object.is） | `parser.ts:421-427`（旁列闸门 + 注释）；C2 下溢判别对（322 正例 vs 323/400 负例） | 一致：值判定非文本判定；两闸门值域不相交、先后无影响；锚 = 记号起点；消息措辞按授权链换仓内权威（码 + 锚不动） | 无（偏离已申报且授权） |
| D5 超域既有闸门零新增 | `parser.ts:418-421`（diff 上下文零改动） | 一致：负超域经同一 `Number.isFinite`，消息与无符号版逐字相同 | 无 |
| D6 下游链零语义改动 | `git diff --name-only`：`ir.ts`/`evaluate.ts`/`validate.ts`/`fingerprint.ts`/codegen src 全不在 diff | 一致 | 无 |
| D7 六处文档编辑 | v1-spec 4 hunk（`:63`/`:83-90`/微示例一删一增/`:364`）＋ guide（`:146` + `:217` + §6 可选示例行） | 一致：目标文本逐句比对成立；E 码表仍 21 行（本审查 grep 计数）；EBNF 与 D7-1 候选逐字符一致 | 无 |
| §8 边界表锚位 | C1/C2 全表断言 + T1/T2 保锚 | 一致：`-1e3`@25、`-1 & string`@**26**（勘误值，未按 SA6 原文 25 落地——SA8 Required action 2 兑现）、E306@30、E311@13、T1 (1,10)、T2 三锚 (1,16)/(1,17)/(1,16) | 无 |
| §9 T1/T2 载体替换 | `parse-vfsl-errors.test.ts:58-60`（`-1`→`-0`）；`parse-vfsl-r3-regression.test.ts` 三例（`-1`→`- 1`） | 一致：断言数值零改动，仅载体与标题同步；R-1 回归意图完整 | 无 |

设计明确但实现缺失：**无**。实现必要偏离设计：仅 SA3 Deviations 1–3，全部落在设计明文
「可调措辞 / 可选 / 建议加固」授权范围内，无未申报偏离。

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
| --- | --- | --- | --- |
| `-`/`.` 记号扫描 | tokenizer | `tokenizer.ts` 数字分支 | 正确 |
| `-0`/有限性值域闸门 | parser 字面量分支（与既有闸门同位） | `parser.ts:416-428` | 正确（并列不合并，与 D4 建议形态一致） |
| enum 折叠 / 严格相等 / 投影 | evaluate / validate / codegen（零改动） | 全不在 diff | 正确（D6 + DENY） |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
| --- | --- | --- | --- | --- |
| 词法分支前看先例（字符串转义 `charCodeAt(i+1)`） | `tokenizer.ts:259` | `isDigitCodeUnit(charCodeAt(i+1))` 同款码元级前看 | 一致 | 惯例复用，非新状态机 |
| `.test-d.ts` 增广参照系 | `generate-discriminated-narrow.test-d.ts` | 同款 module augmentation + `@ts-expect-error` 自反转 | 一致 | 增广键 `numberLiterals*` 全仓唯一（grep 证） |
| tsc 真编译辅助 | `tsc-helper.ts`（`preEmitDiagnostics` + paths 孤立 program） | C4 `compileInTempDir` 复用同 helper，`finally` 清理 | 一致 | 无第二套编译装置 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
| --- | --- | --- | --- |
| 字面量文法 | v1-spec EBNF + 注记 7 | tokenizer 实现 + 指南两处 | 低：六处同变更集落地 + 本审查 grep 复核零矛盾残余 |
| 指纹 | `fingerprint.ts` 单一生产者 | C5 与既有 pin 哨兵（两个任务域，已登记重叠） | 无新增；fixture 合法演进时两处同步（既有登记口径） |

### 生命周期对称性

纯函数管线，无 register/dispose、start/stop、缓存与后台任务面；C4 临时目录 `mkdtemp`/`rmSync`
在 `finally` 中对称清理。单 PR revert 即完全回退。**无不对称风险。**

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
| --- | --- | --- | --- |
| C5 指纹哨兵 vs 既有 `parse-vfsl-union-member-docs` pin | 既有 pin | C5 任务域哨兵 | 保留（SA2 观察 3 / SA3 登记；任务域独立哨兵是仓内惯例） |
| 第二套文档审计 | docs/AGENTS 义务 | 本审查独立重跑扩充 grep | 无平行机制——三方（SA1/SA8/SA2）+ SA4 结论一致：恰六处 |

## 6. 文件范围审查

| Changed path | ALLOW entry | Purpose | Assessment |
| --- | --- | --- | --- |
| `packages/vfsl/src/tokenizer.ts` | ALLOW 行 1 | 记号扫描核心缺口 | ✅ 仅数字分支 + 两处注释，diff 40+/8- 全在辖域 |
| `packages/vfsl/src/parser.ts` | ALLOW 行 2 | `-0` 值闸门 | ✅ 恰 7 行新增（闸门 + 注释），有限性闸门原文零改动 |
| `docs/vfsl/v1-spec.md` | ALLOW 行 3（恰四处） | 规范同步 | ✅ 4 编辑点：`:63`/注记 7/微示例/`:364`；§3/§5/§7/§8/§10 零触碰（diff hunk 上下文核验） |
| `docs/vfsl/schema-authoring-guide.md` | ALLOW 行 4（`:145` + `:216` + 可选示例） | 规范同步 | ✅ 三处（§6 注意 `:146`、护栏句 `:217`、§6 可选示例行）；§7–§8（Suite D 锚面）零触碰 |
| `packages/vfsl/test/parse-vfsl-errors.test.ts` | ALLOW 行 5 | T1 | ✅ 恰一行载体 + 标题/注释 |
| `packages/vfsl/test/parse-vfsl-r3-regression.test.ts` | ALLOW 行 6 | T2 | ✅ 恰三例载体 + 标题 |
| `packages/vfsl/test/parse-vfsl-number-literals.test.ts`（新） | ALLOW 行 7 | C1/C2 | ✅ |
| `packages/vfsl/test/validate-number-literals.test.ts`（新） | ALLOW 行 8 | C3 | ✅ |
| `packages/vfsl/test/number-literals-fixture-drift.test.ts`（新） | ALLOW 行 9 | C5 | ✅ |
| `packages/vfsl-codegen/test/generate-number-literals.test.ts`（新） | ALLOW 行 10 | C4 | ✅ |
| `packages/vfsl-codegen/test/generate-number-literals.test-d.ts`（新） | ALLOW 行 11（可选） | C4 类型级 | ✅ |
| `wiki/raw/task_issue-314_sa3_impl.md` | SA3 角色产物 | 实现报告 | ✅ |

**DENY LIST 零触碰**：`ir.ts`/`evaluate.ts`/`derived.ts`/`validate.ts`/`resolve-schema-at-path.ts`/
`semantic.ts`/`shapes.ts`/`resolve.ts`/`envelope.ts`/`schemasource.ts`/`index.ts`/`errors.ts`/
`pattern.ts`/`fingerprint.ts`、`packages/vfsl-codegen/src/**`、`domains/vfs3-assets/**`、
`docs/adr/**`、`tests/acceptance/**`、`vitest.config.ts`、CI——均不在 `git diff --name-only` 与
untracked 列表（逐项核对）。`packages/vfsl/src/index.ts` 复核 UNCHANGED。

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
| --- | --- | --- | --- | --- |
| number 记号 `value` 现含 `-`/`.`、`num` 语义不变 | 仅 `parser.ts`（tokenDesc `:247-248` 与字面量分支 `:416`）；`tokenize`/`Token` 无包外消费者（grep：import 仅 parser.ts/index.ts 内部） | tokenDesc 消息体 `数字字面量 '-1'` 属不冻结正文；既有正数形消息逐字不变 | 无 | 无 |
| 可解析文本集合纯扩大 | `parseSchemaEnvelope`/`getCompiled`/`compileSchemaEnvelope`/`FileSchemaSource`/CLI/下游消费方 | 纯加法：原 E100 文本变 ok:true，签名/错误联合零变化；fixture 文本无新形态邻接（见 §2.4） | 无 | 无 |
| 自然 fallout（`1 -1`/`1-1` 消息正文变、`Record<-0,string>` 相位前移） | 无既有测试断言（本审查全仓 grep：`= -[0-9]`/`: -[0-9]` 载体仅 T1/C1/B15 处置面；`未知记号` 消息断言仅新 C2 文件） | 设计 §7 已登记为非验收义务 | 无 | 无 |
| 生成物 TS 消费方 | `PathSchema<-1 \| 0.5 \| 2, 'leaf'>` 等 | 合法 TS（C4 真实 tsc 0 诊断 + `.test-d.ts` 编译级正/负例）；`1e-7` 记法值等价、回读明确非要求 | 无 | 无 |
| 断言旧行为的测试（B15 4 处 / 2 文件） | T1/T2 载体替换 | 保码保锚（列计数本审查逐一复算：`type A = -0;` `-` 在第 10 列；`/*😀*/ type A = - 1;` `-` 在 16/17/16 列） | 无 | 无 |
| 指纹前缀 / 域文档形态 | C5 双指纹 + 前缀断言 + generated.ts 哈希（本审查 sha256 复算一致） | `sha256:v1:` 保持；D2 触发器解释性适用未被扩大（SA8 实现后复查同裁） | 无 | 无 |

## 8. 错误、恢复与并发

- **错误语义**：零新增错误码（E 码表 21 行计数复核）；`-0` 复用 E100 有 ADR 0020 决策 3 修订句
  + v1-spec §8 首次发布前豁免授权（SA8 两轮裁决）；三类 E100（未知记号 / 超域 / -0）消息前缀
  格式一致、issues 恰 1 条（`parseIssue` helper 断言）。
- **失败即诚实**：分支条件穷尽（完整 `-?digits(.digits)?` 记号或既有未知字符/语法错路径），无
  静默 fallback；下溢形态由**值判定**覆盖（文本判定会被 C2 下溢对杀死）；非零次正规 `-1e-323`
  由 C1 正例防误拒。
- **恢复 / 回滚**：纯函数无状态；单 PR revert 完全回退（无持久化 / wire / 生成物差异——
  generated.ts 哈希复算不变）。
- **并发 / 幂等 / 资源**：全链同步确定、无共享状态；扫描 O(n) 单遍、每字符至多一次前看、无回溯
  无正则引擎；403+ 字符长字面量由 C2 下溢用例覆盖路径。C4 临时目录 finally 清理对称。
- **静态无法确认项**：见 §11（全量套件 / 机检 / CI 分片实跑——SA4 边界内不执行）。

## 9. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
| --- | --- | --- | --- | --- |
| `parse-vfsl-number-literals.test.ts`（C1：11 单字面量 + 3 联合 + 5 全局位置 + 3 形状规则；C2：15 形态锚钉 + 消息类别 + `-0` 家族 + 超域） | ok:true + IR 值（f64 归一、`toBe` Object.is 语义）；E 码前缀 + line + column 双钉；E306@30/E100@26/E311@13 | vitest include `packages/*/test/**/*.test.ts`（自动入片；CI 6 分片按磁盘枚举） | 无 skip/only/todo；SA6 §12.2/§12.3 矩阵逐行核对**全覆盖**（含勘误锚 (1,26)）；突变敏感性：宽松正则 / 吞 trivia / 文本判定 -0 / `===0` 代 Object.is / 负值跳过有限闸门逐一有对应杀手用例 | 无 |
| `validate-number-literals.test.ts`（C3：8 用例） | derived 声明序 enum + 命中/失配矩阵 + path + 消息 | 同上 | 文件头显式登记运行期 -0 非目标（SA6 §12.4 禁断言面）；`0.1+0.2` 失配钉零 epsilon | 无 |
| `number-literals-fixture-drift.test.ts`（C5：3 用例） | `list()` + 双指纹全值 + 前缀 + generated.ts sha256 | 同上 | 钉死值与 SA6 §4 及实际文件哈希三方一致（本审查复算）；`generate --check` 留 CI 门禁（契约明示「或留给 CI」） | 无 |
| `generate-number-literals.test.ts`（C4：7 用例） | 发射文本三段 + `Number(段)` 与 derived 逐位相等 + 真实 tsc 0 诊断 | 同上 | 「合法 TS」由编译器诊断证明非正则冒充；文本断言限产品输出（SA6 §12.0 允许）；临时目录 finally 清理 | 无 |
| `generate-number-literals.test-d.ts`（4 类型级用例） | 读投影精确 / 写投影不坍缩 / 非成员值 `@ts-expect-error` fail-closed | vitest typecheck include `packages/*/test/**/*.test-d.ts`；CI typecheck 作业 `--typecheck.only`；`tsconfig.typecheck.json` include 覆盖 | 增广键全仓唯一（无冲突）；参照系与运行时 C4 配对锚定（文件头声明角色分工，沿既有先例） | 无 |
| T1（`parse-vfsl-errors.test.ts`） | `type A = -0;` → E100@(1,10) | 既有文件，原有入口 | 同位同锚载体替换，无弱化 | 无 |
| T2（`parse-vfsl-r3-regression.test.ts`） | 三例 `- 1` → E100@(1,16)/(1,17)/(1,16) | 既有文件 | 断言数值零改动，R-1 星面列计数回归意图完整保留 | 无 |

**红灯契约保持性核验（静态推演）**：实现移除后（HEAD 行为）——C1 22 例中恰 3 例无符号正例
（`00`/`9007199254740993`/`'9'×308`）绿、其余 19 红；C2 恰 3 处目标行为红（`-1e3` 锚 25 vs
HEAD 23、`-0` 家族消息、负超域消息）；C3/C4 模块级 `derive()` 崩（契约预测的断言链首步失败）；
C5 绿——合计 43 例，与 SA3 红灯自报 `22 failed \| 21 passed (43)` 精确一致；绿灯 43 + C3 8 +
C4 7 = 58 与自报 58/58 一致。红灯断言未被弱化或移除。

## 10. Required revisions

| Finding ID | Severity | Evidence | Problem | Required change | Acceptance | Suggested routing |
| --- | --- | --- | --- | --- | --- | --- |
| ——（无） | —— | —— | 无 BLOCKER / MAJOR | —— | —— | —— |

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
| --- | --- | --- | --- |
| 全量套件实跑（含 6 CI 分片首次纳入 5 个新文件） | SA7 / CI | `pnpm test` 324 files / 3445 tests 全绿、`Type Errors no errors`（SA3 自报数） | 任一分片红 / 用例数对不上静态计数 59（40+8+3+7 运行时 + 4 类型级中 vitest 计口径差异需解释） |
| `pnpm generate --check` 实跑 | SA7 / CI `codegen-freshness` | exit 0 无输出 | 非 0（生成物陈旧检测触发） |
| `python3 tests/acceptance/vfsl_spec_acceptance.py` 实跑 | SA7 | GREEN 22/22（本审查静态核验：新 EBNF 仅用 `[ … ]` 组与 quoted 终元，EbnfValidator 词法/文法均支持；§2 微示例为 ```ts 块不入 G15/G16 面） | 任一 G 项 FAIL |
| `pnpm typecheck` + `--typecheck.only` 实跑 | SA7 / CI typecheck 作业 | exit 0（含新 `.test-d.ts`；`@ts-expect-error` 四处均须真实命中） | 类型错误或「Unused '@ts-expect-error'」 |
| `-0` 消息在真实错误输出中的可读性（中文措辞面向 schema 作者） | SA7 抽查 | 消息含 `-0`、引导写 `0`、引仓内 ADR 0020 | 措辞回归（非门禁） |

## 12. Non-blocking observations

1. **E100 码表行例示归类精度**（SA8 实现后复查 §8.1 已登记，本审查复核确认）：v1-spec `:364`
   把「`-0` 字面量」列于「不可从 §2 文法推导的任何构造」示例清单，而 `-0` 文法可推导、拒绝依据
   是值域闸门（注记 7 `:89-90` 承载精确口径，两处对码的指派一致）。该措辞系设计 D7-4 目标文本
   原样落地，无决策违反、无行为发明——纯文档精度项，留 owner 后续措辞微调（如「文法/值域外的
   构造」），不阻断。
2. **C2 未钉 `1.5e3` / `-1.` / `1.5.5` / `1 -1` 等 fallout 形态**：SA6 §12.3 契约矩阵本就不含
   它们，设计 §8 列为同族自然 fallout 且无既有断言——非弱化；如后续加固可在 C2 追加
   （`1.5e3` 锚 `e3`@26、`1.5.5` 第二 `.`@26、`1 -1` 码 + 锚不变正文变），纯可选。
3. **指南 `:146` 措辞较 D7-5 草案略扩**（增「均 → VFSL-E100」「IEEE-754 双精度解释」）：
   同口径、无语义漂移；关键约束「负号**须**紧邻数字」不含「必须紧邻」串，Suite D D3b 首现
   段落（本审查复核 `:213` JSDoc 挂载段，四针齐备）不受影响。
4. **`.test-d.ts` 为手写参照系而非生成器输出的编译期导入**：类型级测试无法 import 运行时输出，
   仓内既有先例（`generate-discriminated-narrow.test-d.ts`）同构；运行时 C4 已钉实际发射文本，
   两者配对闭合 AC4。设计本就标注「可选，建议」。
5. **SA3 Deviation 1（`-0` 消息与注记 7 引「ADR 0020 决策 3」替换「ADR 0021 决策 2」）**：
   落在设计 §5-D4 落地建议 + SA2 观察 2 + SA8 §8.5 的授权链内；ADR 0021 正文不在仓，改引仓内
   权威提升用户可见消息的可追溯性。码 + 锚不变，已正确申报。
6. **vitest `passWithNoTests: true` 仓级默认**：SA3 焦点命令带 `--passWithNoTests=false`（与 CI
   同款防假绿意识），新文件真实入片已由 include 模式静态确认——仅提示后续维护者保持该参数习惯。

---

— SA4 Red Team（Implementation Review）· dispatch `sa-96ff0d06-b5e2-4cef-8ac0-f1e9c9c1f7f7` · iteration 0

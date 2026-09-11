# SA8 设计后冲突复查报告 — issue #314：VFSL 数字字面量拓宽（负号与小数）

- 复查对象：`wiki/raw/task_issue-314_design.md`（SA1 设计，**design iteration 3**——为落实 SA2
  MAJOR F1 对 iteration 2 的原位修订：第六处规范陈述编辑 + 扩充文档陈述面审计）
- 复查基线 HEAD：`29ff10f843a4d877866e963cedc8766d60194d33`（分支 `mabf/issue-314`；本复查全部
  源码/文档事实在该提交核验，`git status` 仅 5 个未跟踪流水线产物，无源码改动）
- 复查角色：SA8 冲突门禁（design 复审）；不评价设计优劣（SA2 辖域）、不判断实现（SA4/SA7 辖域）
- 本报告**原位取代**iteration 0 版本：该版 §3 行 11 与 §6.1 的「规范陈述面恰为此五处」完备性
  声明已被 SA2 F1 证伪并废弃；本版结论仅反映 iteration 3 设计这一被审对象

## 1. Reviewed subject: design

被审对象为 SA1 设计 iteration 3 全文（§1–§15），对照仓库既有决策集（ADR 全集 + CONTEXT.md +
规范文档 + 模块 AGENTS 明确收录的决策）逐条裁决冲突等级。本轮修订相对 iteration 2 的全部变化
（§5-D7-6 第六处编辑、§5-D7-审计 扩充模式组、§9 ALLOW guide 行增列 `:216`、§2-B14/§6/§12-C6/
§13-R6/头注同步、§14 修订映射、七项非阻塞观察吸收）逐项纳入核对；D1–D6 技术决策、锚位矩阵、
T1/T2、C1–C7 未变，其裁决随决策集复核顺延成立。

任务前置门禁产物（`task_issue-314_relevant_decisions.md` / `task_issue-314_conflict_report.md`）
本任务实例从未生成（设计 §1、SA6 契约 §1、SA2 评审 §1 三方一致确认）；本复查独立枚举并核对了
完整决策集，该输入缺口对裁决无残余影响。SA2 评审（`task_issue-314_sa2_review.md`，iteration 0，
verdict **reject**，1 × MAJOR F1）本轮存在且已作为设计修订输入——SA8 不复核 SA2 的优劣判断，
只核对修订后的设计是否与决策集相容、F1 指控的决策义务违反是否已消除。

## 2. Inputs and decision set

| 输入 | 路径 | 状态与取用方式 |
| --- | --- | --- |
| Host 简报 | `wiki/raw/task_issue-314.md` | Issue #314 正文；comments REST 读取为 `[]`，正文 `## Comments` 为空——**无 owner 追加要求，无潜在 override 来源** |
| 被审设计 | `wiki/raw/task_issue-314_design.md` | iteration 3（570 行），全文逐节审 |
| SA2 评审 | `wiki/raw/task_issue-314_sa2_review.md` | iteration 0，reject（F1 MAJOR + 7 非阻塞观察）；作为设计修订输入核对落实面（§14 映射表） |
| SA6 契约 | `wiki/raw/task_issue-314_sa6_contract.md` | 设计输入（evidence 层，非决策基准；其 §5 目标表 (1,25) 锚位被设计「B-补 2」勘误，SA2 与本复查均独立复核成立） |
| ADR 全集 | `docs/adr/`（19 篇，全部 `状态：已接受`） | 全读状态标识；**ADR 0021 不在仓内**（`docs/adr/` 无 0021 文件；仅 ADR 0020 决策 3 修订句与决策 9 supersede 标注转述其存在）——`-0` 拒绝的**仓内**决策权威是 ADR 0020 决策 3 的现行修订句本身。grep 全 ADR「数字字面量/小数/负号/NumberLiteral」仅命中 ADR 0020；唯一 supersede 标注为 ADR 0020 决策 9（→ADR 0021，不构成约束） |
| 核心决策 | `docs/adr/0020-vfsl-number-constraints.md` | 决策 1/3/5/7/10 现行有效；决策 3 含 ADR 0021 决策 2 修订句（`-0` 解析期 E100） |
| 指纹决策 | `docs/adr/0007`（`sha256:v1:` 带版本域分离）、`docs/adr/0017`（指纹串前缀、不透明消费）、`docs/adr/0005`（生成管线字节稳定） | 现行有效 |
| 语言规范 | `docs/vfsl/v1-spec.md` | §2（EBNF `:63`、注记 7 `:83-84`、微示例 `:118`）、§4（`:277-290` 冻结前缀格式/正文不冻结/单错误；E100 码表行 `:358`）、§8（`:503-513` 只增不改 + 首次发布前评审修订豁免）、§9（未冻结项）——均本复查在 HEAD 原文核验 |
| 授权指南 | `docs/vfsl/schema-authoring-guide.md` | `:145`（「数字字面量仅支持无符号十进制整数」）＋ **`:216`（「v1 语法护栏」白名单句「字符串或整数文字」——SA2 F1 增补的第六处，本复查 grep 原文确认存在）** |
| 模块规约 | `packages/vfsl/AGENTS.md`（兼容性行为条款）、`packages/vfsl-codegen/AGENTS.md`（字节稳定/不重推导）、`docs/AGENTS.md`（同 PR 全文档义务、不得发明实现行为）、根 `AGENTS.md` | 明确收录的契约条款 |
| CONTEXT.md | 术语：方言（`CONTEXT.md:11-12`，一经发布冻结、只增不改）、语义指纹（`:82`）、ROOT、挂载锚位 | 术语一致性核对 |
| 证据层（非决策基准） | `packages/vfsl/src/fingerprint.ts:7-13`（D2-CONTRACT-MARKER，原文含「**v2 方言**放开数值字面量语法」限定词）、`wiki/raw/task_issue-72_design.md` §6.3 | 源码注释与 wiki 产物按 skill 与 `docs/AGENTS.md`（wiki/raw 是证据不是规范）仅作当前事实确认，不构成自动阻塞依据 |

## 3. Decision analysis

| # | Decision（路径 · 条款） | Subject behavior（iteration 3 设计行为） | Classification | Evidence | Required action |
| --- | --- | --- | --- | --- | --- |
| 1 | ADR 0020 决策 3：文法拓宽为 `"-"? [0-9]+ ("." [0-9]+)?`，全局生效，负号「作为 number 记号的一部分由 tokenizer 扫描」 | §5-D1/D2：tokenizer 数字分支入口扩为「digit 或 `-` 且单码元前看为 digit」；小数点两侧 digits 必填、每 token 至多一个 `.`；§7 伪代码；全局无上下文特判（§8 边界表覆盖全部类型位置）——iteration 3 未改动此决策面 | `implements-existing-decision` | `docs/adr/0020:88-108`；设计 §5-D1（单 token + 原始文本码元前看不吞 trivia；拒绝 parser 拼接备选恰以决策 3 为否决依据） | 无（实现期由 SA4 核对落地与 §8 边界表一致） |
| 2 | ADR 0020 决策 3 修订句：「`-0` 字面量解析期 E100 拒绝（锚该记号，消息引导写 `0`）」——初稿「-0 合法 ≡ 0」已被 ADR 0021 决策 2 翻转 | §5-D4：parser 字面量分支并列新增 `Object.is(tok.num, -0)` **值判定**闸门（命中 `-0`/`-0.0`/`-00`/小数下溢形态），E100 锚 number 记号起点，消息含 `-0` 且引导写 `0`；iteration 3 增落地建议（消息改引仓内权威或去 ADR 引用，码锚不动） | `implements-existing-decision` | `docs/adr/0020:96-100`（修订句原文）；设计 §5-D4；ADR 0021 正文不在仓内，仓内权威即该修订句 | 无（见 §8.5 措辞建议，非阻塞） |
| 3 | ADR 0020 决策 3：裸 `-` 维持未知字符 E100 路径；`.5`/`1.` 维持 E100；指数记号不做；决策 10「明确不做」指数 | §5-D1/D2 边界条件构造性排除：`- 1`/`-/*c*/1`/`--1`/`-.5` 走既有未知字符路径；`1e3` 停于非 digit 自然 fallout；非目标表排除指数记号 | `implements-existing-decision` | `docs/adr/0020:96-102`、`:186-187`；设计 §8 边界表 + §12 C2 双钉 | 无 |
| 4 | ADR 0020 决策 3：浮点成员相等语义 f64 严格相等；「字面量按 f64 语义解释」须 spec 注明；Considered Options 5 拒绝 epsilon/十进制特制口径 | §5-D3：`num = Number(raw)` f64 归一是语义而非拒绝；判别式键 `String(字面量)`；§5-D7-2 注记 7 改写含 f64 归一举例与严格相等声明 | `implements-existing-decision` | `docs/adr/0020:103-105`、`:205-207`；`packages/vfsl/src/validate.ts:162-165`（`===` 现状，HEAD 核验）；设计 §5-D3/D7 | 无 |
| 5 | ADR 0020 决策 3：超双精度字面量（含负值）沿既有路径判 E100 | §5-D5：既有 `!Number.isFinite` 闸门零新增覆盖负值，消息与无符号版逐字相同 | `implements-existing-decision` | `docs/adr/0020:106`；`packages/vfsl/src/parser.ts:416-421`（HEAD 事实核验） | 无 |
| 6 | ADR 0020 决策 1 + v1-spec §8 规则 1：不引入方言 v2，文法演进「只增不改」 | §5-D7-1 候选 EBNF `[ "-" ], digit, { digit }, [ ".", digit, { digit } ]` 是现行文法纯超集（`v1-spec.md:63` 现行 `NumberLiteral = digit, { digit }` 本复查原文核验）；`Int`/`Range` 收窄明确排除在非目标 | `implements-existing-decision` | `docs/adr/0020:45-61`；`docs/vfsl/v1-spec.md:503-513`（本复查核验豁免条款原文）；SA6 E4（候选 EBNF 过 EbnfValidator） | 无 |
| 7 | v1-spec §4：message 前缀格式冻结、正文措辞**不**冻结、issues 恰 1 条；§8 规则 3「已发布错误码的条件与含义不变（新条件用新码）」+ 首次发布前评审修订轮次豁免 | §10：零新增错误码；`-0` 复用 E100——ADR 0020 决策 3 修订句显式裁决该条件，且 §8 豁免句（「首次发布前的规格评审修订轮次不受本条约束」）在仓未发布（`package.json` version `0.1.0`）背景下适用；错误身份（码+锚）前后不变，仅消息正文变化（§4 明文不冻结） | `no-conflict` | `docs/vfsl/v1-spec.md:277-282`、`:284-290`、`:503-513`（均 HEAD 原文核验）；`docs/adr/0020:96-100` | 无（实现期核对 C2 两类消息前缀断言） |
| 8 | `packages/vfsl/AGENTS.md`（Boundaries 末条）：错误码、issue 顺序、行列定位、指纹输入是兼容性行为不得变更；公共畸形输入返回判别结果；公共 API 仅经 `index.ts` | §7：公共 API 零变化（`tokenize`/`Token` 内部结构）；§8 全表锚位与 HEAD 一致，**唯一登记锚位变化** `-1e3` `-`@(1,23)→`e3`@(1,25)——决策 3 全局拓宽的必然后果（与 `1e3` 同构），设计钉死新锚并禁止特判拉回；勘误 SA6 契约 `-1 & string` 目标锚为 **(1,26)**（`parser.ts:388-393` 锚 `&` 记号机制，`-1` 占 23-24 列、`&` 在 26 列；SA2 独立复核同值） | `implements-existing-decision`（ADR 授权范围内已登记的锚位后果；契约勘误非决策冲突） | `packages/vfsl/AGENTS.md`（Boundaries）；`docs/adr/0020:103-104`；`packages/vfsl/src/parser.ts:388-393`（HEAD 核验锚 `&` tok） | 实现期用 (1,26) 落 C1 断言（按契约原文 (1,25) 落地将假红） |
| 9 | ADR 0020 决策 5：IR 零新增种类 ⇒ 既有语义指纹（sha256:v1:）全部不变；决策 7：codegen 生成 `number` 原样、`generate --check` 基线不变 | §5-D6：IR 类型族零新增（`ir.ts:42` literal `value: string \| number` 既有）；evaluate/validate/codegen/投影零语义改动；DENY LIST 封 `fingerprint.ts`、`packages/vfsl-codegen/src/**`、`domains/vfs3-assets/**`；C5 钉死基线指纹全值 | `implements-existing-decision` | `docs/adr/0020:125-134`、`:148-153`；`packages/vfsl/src/ir.ts:42`（HEAD 核验）；SA6 §4 基线值 | 无（实现期 C5 复核） |
| 10 | ADR 0007（`sha256:v1:` 带版本域分离）+ ADR 0017（前缀、不透明消费）+ 证据层登记：「**v2 方言**放开数值字面量语法 ⇒ semantic 域文档必须重审并升 v2 前缀」 | §6「D2 指纹升级触发器」裁定**不触发**：触发条件限定词是「v2 方言」（`fingerprint.ts:7-13` 原文本复查核验含该限定词），ADR 0020 决策 1 明确不引入 v2；域文档形态零变化、IR 类型族零新增；保持 `sha256:v1:` 且既有指纹零漂移；设计自判触碰已登记触发器、提交冲突复查 | `no-conflict`（ADR 基准下裁决成立；登记解释性适用，留实现期复核） | `docs/adr/0007:17`、`docs/adr/0017:124`；`docs/adr/0020:51`、`:134`；`packages/vfsl/src/fingerprint.ts:7-13`（原文核验）；skill/docs AGENTS：源码注释与 wiki 产物不构成自动阻塞依据 | 无本次动作；若 owner 按字面读法翻案，须**另立 ADR** 后再动前缀（设计 R3） |
| 11 | ADR 0020 决策 10 + `docs/AGENTS.md`（Editing 节）：v1-spec/指南修订与实现**同 PR**；「当代码行为变化时，更新每一份陈述该契约的规范文档」；不得发明实现行为 | §5-D7：**六处**编辑——spec `:63` EBNF、`:83-84` 注记 7、`:118` 微示例、`:358` E100 码表行 + 指南 `:145`、**`:216` 护栏白名单句（iteration 3 按 SA2 F1 增补）**；不预写 Int/Range 的 §3/§8 条款。**本复查以扩充模式组（`无符号\|整数文字\|数字字面量\|负数\|小数\|负号\|十进制\|字面量\|NumberLiteral\|digit`）+ 交叉模式（`整数\|integer\|[0-9]`）+ 英文措辞探针（`unsigned\|integer literal\|decimal literal\|negative`）+ docs/ 外全仓扫描（README/CONTEXT/AGENTS/package README/acceptance 脚本/exemplar）独立重跑**：矛盾陈述穷尽清单**恰六处**，与设计 §5-D7-审计、SA2 独立复核三方一致；其余命中逐类核验为一致面或无关（见 §6.1） | `implements-existing-decision`（未兑现义务进入本变更集：修订计划完整，见 §6.1） | `docs/adr/0020:179-187`；`docs/AGENTS.md`（Authority/Editing 节原文核验）；本报告 §6.1 复核证据；六处目标文本逐句给出（设计 §5-D7 1–6） | 实现期同变更集落齐六处编辑 + 扩充 grep 机检证据并入 C6（现义务未兑现，C6 红） |
| 12 | `packages/vfsl-codegen/AGENTS.md` + ADR 0005：输出确定、逐字节稳定；`generate --check` 检出陈旧生成物；不得在生成器里重推导 VFSL 语义 | §5-D6：codegen 零改动；`String(number)` 现状发射 `-1 \| 0.5`、`1e-7`（合法 TS、值等价）；「生成文本可被 VFSL 回读」按 SA6 §12.5 明确非要求；拒绝记法归一化层/特判 | `no-conflict` | `packages/vfsl-codegen/AGENTS.md`（Boundaries，原文核验）；`packages/vfsl-codegen/src/valuetype.ts:65-77`（HEAD 事实）；SA6 E5 | 无 |
| 13 | CONTEXT.md 术语：方言（一经发布冻结、引擎只增不改）、语义指纹（解析后规范 IR 的语义身份）、ROOT、挂载锚位 | 设计不改任何术语；新字面量产生新 IR 值 ⇒ 新文本得新指纹——与语义指纹定义自洽；既有文本 IR 不变 ⇒ 指纹不变；本复查 grep 确认 CONTEXT.md 无数字字面量文法陈述（无第七处规范陈述风险） | `no-conflict` | `CONTEXT.md:11-12`（本复查核验）、`:82`；设计 §5-D6 | 无 |
| 14 | ADR 0020 决策 9（已被 ADR 0021 supersede）——按 skill「被 superseded 的 ADR 不构成约束」；运行时 number 基线收窄归 issue #312 | 设计非目标表明确排除运行期 NaN/±Infinity/-0 拒绝；C3 明确禁止断言运行期 -0 语义；`docs/adr/0020:161-177` supersede 标注本复查核验 | `no-conflict` | `docs/adr/0020:161-177`；设计非目标表、§12 C3 | 无 |
| 15 | `docs/AGENTS.md`（Editing）：「documentation-only wording changes must not invent implementation behavior」＋ 指南护栏句的机检/锚面 | §5-D7-6 目标文本「字符串或数字文字（可选负号与十进制小数；负号须紧邻数字）」逐字重述 ADR 0020 决策 3 文法（负号紧邻、十进制小数），无任何超出决策的语法发明（未引入指数/十六进制/`-0` 合法化）；本复查核验该句位于指南独立章节「## v1 语法护栏」（`:214` 起，**不在** M4 Suite D 锚定的指南 §7–§8 内），且全仓测试与 acceptance 脚本（`tests/acceptance/` 仅 `vfsl_spec_acceptance.py`，无指南引用）均不锚定该句文本——编辑不触任何冻结锚面 | `implements-existing-decision` | `docs/AGENTS.md`（Editing 节）；`docs/vfsl/schema-authoring-guide.md:214-216`（章节边界与句子原文核验）；本报告 §5「指南锚面」行 | 无 |

裁决分布：`no-conflict` × 5（第 7/10/12/13/14 行）、`implements-existing-decision` × 10（第 1–6/8/9/11/15 行）；
`evolution-required` × 0（第 11/15 行的规范修订属「兑现 ADR 0020 决策 10 已有义务」，修订计划完整，见 §6.1）；
`hard-conflict` × 0。

## 4. Overrides

| Old decision | Override authority | Scope | New obligation |
| --- | --- | --- | --- |
| ——（无） | —— | —— | —— |

无需任何 override：设计全部行为落在 ADR 0020 现行决策文本的直接授权内。具体核对：
Issue #314 comments REST 读取为 `[]`、简报 `## Comments` 为空——不存在 Owner 评论覆盖（skill 四类合法
override 来源之首即不成立）；无新 ADR 修订/废弃旧 ADR（`docs/adr/**` 在设计 DENY LIST，正确——ADR 为
append-only 决策记录，ADR 0020 `:10-11` 背景句「只有无符号十进制整数字面量」系决策制定前的现状引述，
不随实现改写，设计审计将其排除于修订面是正确处置）；无正式协议版本升级（方言恒 v1，信封 `version: 1`
与 `FINGERPRINT_PREFIX` 均不动）；`-0` 复用 E100 **不是 override**——它是 ADR 0020 决策 3 修订句的
明文要求，且 v1-spec §8 自带「首次发布前评审修订轮次不受本条约束」演进条款（决策文本自身允许的演进）。

## 5. Frozen surfaces

| Surface | Must remain unchanged | Evidence | Actual result（设计承诺） |
| --- | --- | --- | --- |
| 错误码清单 | 21 码零新增；E100 条件族不重写为专属码 | v1-spec §4「错误码共 21 个」；ADR 0020 决策 4「零新增错误码」 | §10 零新增；`-0`/超域/未知记号三类 E100 同码 ✓ |
| message 冻结前缀格式 | `VFSL-E<编号>: ` 前缀；正文措辞不冻结 | `v1-spec.md:277-282`（原文核验） | 前缀格式不变；`-0` 新消息正文属自由措辞 ✓ |
| 行列定位（兼容性行为） | 既有负例族锚位零漂移；例外仅已登记的 `-1e3` (1,23)→e3(1,25) | `packages/vfsl/AGENTS.md`（Boundaries 末条）；ADR 0020 决策 3 全局不特判 | §8 边界表逐行钉锚 + C2 双钉；T2 载体替换保持 R-1 三锚位数值不变 ✓ |
| `FINGERPRINT_PREFIX` 与 semantic 域文档形态 | `'sha256:v1:'`；`{domain,lang,version,module}` canonical JSON 结构 | `fingerprint.ts`（HEAD）；ADR 0007/0017 | DENY LIST 封 `fingerprint.ts`；§6 裁定不触发升版 ✓ |
| fixture 指纹与生成物 | envelope/semantic 指纹与 `domains/vfs3-assets/generated.ts` 逐字节不变 | SA6 §4 基线全值；ADR 0020 决策 5/7 | C5 钉死基线值 + `generate --check` exit 0 ✓ |
| v1-spec 未列编辑面 | §3/§5/§7/§8/§10 及 §2/§4 未列出各行不动；§5 M4 文档锚（Suite D）不受影响 | v1-spec 章界；设计 §13-R5 | §5-D7 恰四处 + §9 DENY 明列；候选 EBNF 已过 EbnfValidator ✓ |
| **指南锚面（iteration 3 新核验）** | 指南 §7–§8（M4 Suite D 锚面）不动；「v1 语法护栏」章节句无测试/机检锚定 | 指南章节结构（`## v1 语法护栏` `:214` 起，独立于 §7 `:152`/§8 `:170`）；全仓 grep 测试树与 `tests/acceptance/` 无护栏句锚定（本复查核验） | 两处编辑（`:145` 在 §6、`:216` 在护栏节）均不触 §7–§8；`:145` 属 §6「表达值约束」注意列表（M4 不锚定） ✓ |
| 公共 API | `parseVfsl` 等签名、返回类型、错误联合零变化；`tokenize`/`Token` 维持内部 | `packages/vfsl/AGENTS.md`；设计 B10 | §7「公共 API 零变化」✓ |
| IR 类型族 | `literal.value: string \| number` 既有，零新 kind/键序 | `ir.ts:42`；ADR 0020 决策 5 | §5-D6 ✓ |
| `domains/vfs3-assets/**` | schema.vfsl 与生成物零字节改动 | AC4/C5、`domains-scaffold` 门禁 | DENY LIST ✓ |
| CONTEXT.md 词汇 | 方言/语义指纹/ROOT/挂载锚位等术语不改写 | `docs/AGENTS.md`（用词义务） | 设计不改术语；CONTEXT.md 无字面量文法陈述（本复查 grep） ✓ |

## 6. Evolution requirements

1. **规范文档六处编辑**（§5-D7，iteration 3 从五处扩为六处）——按 skill 七要素核对修订计划完整性：
   - 修订文件：`docs/vfsl/v1-spec.md:63/:83-84/:118/:358` + `docs/vfsl/schema-authoring-guide.md:145/:216`
     ——**本复查独立重跑扩充审计**（模式组 `无符号|整数文字|数字字面量|负数|小数|负号|十进制|字面量|
     NumberLiteral|digit` + 交叉 `整数|integer|[0-9]` + 英文探针 + docs/ 外全仓扫描），矛盾陈述穷尽
     **恰六处**，无第七处。逐类排除核验：v1-spec `:31/:33/:37/:55/:64/:80/:85-89/:119/:125/:134/:140/
     :183/:365/:386/:495`（字面量联合种类/词法元符号/信封 version 等——注记 8 冻结的是字符串/数字
     **两类种类**，负数/小数仍是数字字面量，种类面不受影响）；指南 `:70/:118/:156/:178/:184/:186/:207/:212`
     （source id digits、Record 键、字符串字面量与 JSDoc 示例「非负整数」——字段语义示范非文法约束）；
     `docs/protocols/instance-replication-v1.md:506/:674/:729-730/:743-744/:763`（WS ping 凭据「无符号
     64-bit」与 wire/日志字面量类别）；`docs/integration/hub-peer-deployment.md:136`（retention 配置
     整数）；`docs/integration/external-project-vfsl-codegen.md:404/:415`（TS 路径字面量语义）；
     `docs/why-nomicore.md:71/:79`（动机叙事）；`packages/namespace-diagnostic-log/README.md:196`
     （retention 配置值域，docs/ 外唯一命中）；ADR 0020 `:10-11`（史料句，DENY LIST）。均非 VFSL
     字面量文法契约陈述，排除成立；
   - 新旧语义：EBNF 超集、注记 7 改写口径、微示例一删一增、E100 码表越界示例换血、指南 `:145` 同口径
     一句、`:216` 白名单项措辞——**六处均给出目标文本**（设计 §5-D7 1–6）；
   - 兼容与迁移：纯拓宽，无既有合法文本改义，无迁移；`-0` 族错误身份（码+锚）前后不变；
   - 失败语义：非法形态仍解析期单条 E100 带行列，无静默路径（§10）；
   - 版本：方言恒 v1（无 v2、无 `FINGERPRINT_PREFIX` 升版、信封 version 不动）；
   - 验证：`tests/acceptance/vfsl_spec_acceptance.py` 全绿（本复查 grep 确认脚本不硬编码 NumberLiteral
     旧 RHS/无符号字样；候选 EBNF 已预验证）+ C2/C5/C7 断言矩阵 + 扩充 grep 机检证据并入 C6 +
     Suite D 文档锚不受影响分析（§5 指南锚面行本复查核验）；
   - 保持不变的冻结面：§3/§5/§7/§8/§10、错误码清单、指纹、公共 API、fixture 字节、指南 §7–§8。
   → **计划完整**；按 skill「计划完整时可以 clear，但必须 `requiresConflictRecheck: true`」处理。
   iteration 0 报告对同一义务的「五处」完备性声明作废，以本节六处口径为准。
2. **D2 指纹触发器的解释性适用**（§6 裁定 + §13-R3）：不修改任何决策文本，属对已登记触发器条件的
   解释（「v2 方言」限定词 ⇒ ADR 0020 决策 1 下条件不成立）。ADR 基准（决策 1/5）支持该解释；触发器
   登记本体位于源码注释 + wiki 产物（证据层）。裁定不改变冻结面本身（前缀与域文档形态不动），但属
   「触碰已登记契约触发器」类目——设计已按规则提交复查，本报告确认其与 ADR 基准一致；owner 若采
   字面读法翻案，须先另立 ADR（不在本变更集内）。

## 7. Hard conflicts

无。未发现任何与 ADR 全集、CONTEXT.md、规范文档或模块 AGENTS 收录决策不兼容且无合法授权的设计
行为。特别核对 iteration 3 新增面：第六处编辑（guide `:216`）由 ADR 0020 决策 10 + docs/AGENTS.md
义务直接授权，目标文本不发明实现行为，不触冻结锚面（§3 行 15、§5 指南锚面行）；扩充审计的方法论
修正不引入任何决策语义变化。

## 8. Required actions

1. **（实现门）同变更集落齐六处文档**：tokenizer/parser 改动与 v1-spec 四处 + 指南 `:145`/`:216`
   两处编辑必须同一 PR（ADR 0020 决策 10；docs/AGENTS.md「更新每一份陈述该契约的规范文档」）；
   C6 验收须含护栏句人工评审项 + 扩充模式组 grep 机检证据（修订后 docs/ 除 ADR 外不再存在与拓宽
   矛盾的字面量限制陈述）。现状 C6 红——规范仍陈述「负数、小数不在子集」「字符串或整数文字」。
2. **（实现门）锚位断言取值**：`-1e3` 钉 (1,25)；`-1 & string` 钉 **(1,26)**（设计「B-补 2」勘误经
   本复查与 SA2 双重独立复核成立——**勿按 SA6 契约原文 (1,25) 落地**，否则对正确实现产生假红）。
3. **（实现门）零漂移复核**：C5 基线指纹两串、`generated.ts` 哈希、`FINGERPRINT_PREFIX` 前缀断言、
   `generate --check`——任一漂移即实现偏离设计/ADR 0020 决策 5。
4. **（程序性）D2 触发器翻案路径**：若 owner 对 §6 裁定异议，须另立 ADR 并重估全仓指纹后方可动前缀；
   实现者不得静默升版（设计 R3；SA6 U2）。
5. **（非阻塞，措辞建议）**：§5-D4 示例消息引用「ADR 0021 决策 2」——该 ADR 正文不在本仓。消息正文
   按 v1-spec §4 不冻结，SA3 可保留或改引仓内权威（修订后 v1-spec 注记 7 / ADR 0020 决策 3 修订句）
   或去 ADR 引用；码与锚不可动。
6. **（记录）**：本任务前置门禁产物缺席；本设计复查已独立覆盖决策集枚举与裁决，无残余输入缺口。
   iteration 0 报告的「恰五处」声明作废（本报告原位取代）；iteration 3 修订未改变其余 13 项对照的
   裁决基础。

## 9. Verdict

**`clear`**

- 全部 15 项对照中：`no-conflict` × 5、`implements-existing-decision` × 10、`evolution-required` × 0、
  `hard-conflict` × 0；
- SA2 F1 指控的决策义务违反（docs/AGENTS「更新所有陈述该契约的规范文档」不满足、C6 判据失败）在
  iteration 3 中已消除：第六处陈述入编辑面与 ALLOW LIST，且本复查以扩充模式组独立重跑确认穷尽清单
  恰六处、无第七处（含 docs/ 外全仓与英文措辞探针，均无遗漏规范陈述）；
- 两处触碰冻结/登记面（spec 文法面 + 指南护栏句编辑、D2 触发器解释）均有完整修订/论证计划且授权链
  完整（ADR 0020 决策 1/3/5/10 + v1-spec §8 演进条款 + docs/AGENTS.md 义务条款）；
- 设计自报的三项待复核点（§15）与本次独立复核结论一致；其两处补充（B15 三断言遗漏、B-补 2 契约
  锚位勘误）经核验成立，属完备性增益而非冲突。

## 10. requiresConflictRecheck

**`true`**。理由（对应 skill 触发条件「规范/冻结面尚待实现期核对」）：

1. **六处文档编辑（含 iteration 3 增补的指南 `:216`）尚未落地**——implementation 复查须确认文档与
   代码同变更集、六处目标文本逐句落地、扩充 grep 机检证据在案、机检脚本（`vfsl_spec_acceptance.py` /
   Suite D）全绿、指南 §7–§8 锚面零漂移；
2. D2 指纹触发器的解释性适用（保持 `sha256:v1:`）须经实现后复查确认未被静默扩大（前缀、域文档
   形态、基线指纹逐字节不动），且 owner 未在后续轮次翻案；
3. 已登记锚位变化（`-1e3`）与 4 处既有断言语义翻转（含设计补充的 3 处）须逐项核对实际 diff：
   锚位变化清单穷尽、载体替换不弱化 R-1 回归意图、无未登记的兼容性行为漂移。

— SA8 Conflict Gatekeeper · dispatch `sa-7ad76df3-7925-4b92-91da-b5bdae7d88ff` · iteration 1（原位取代 iteration 0）

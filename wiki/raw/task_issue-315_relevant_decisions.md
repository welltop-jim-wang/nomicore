# 相关决议（Relevant Decisions）— issue #315 前置冲突门禁

> 冲突门禁前置产出（SA8，dispatch `sa-39b4c9a0-e23b-4e47-8b0a-00ea48e26116`）。
> 只摘录相关决策、条款与关联点，不重写原义、不作业务设计；裁决见
> `wiki/raw/task_issue-315_conflict_report.md`。

## 任务标识

- 任务：Issue #315 — VFSL 三约束形态核心链：`number & Int` / `Int<min,max>` / `Range<min,max>`（ADR 0020）
- 简报：`wiki/raw/task_issue-315.md`（Issue body = 需求全集；REST comments snapshot 为空，无 Owner 追加要求）
- 被审对象补充输入：已批准的 SA6 验收契约 `wiki/raw/task_issue-315_sa6_contract.md`（本门禁据派工审「approved acceptance contract」）
- Worktree：`/home/wangjian/nomicore-fix-issue-315`（branch `mabf/issue-315`，HEAD `7b92af0`）
- 前置：#314 已合入（PR #326 = HEAD `7b92af0`）；#319/ADR 0021 已合入（`933f2e5`）；ADR 0020 及其决策 9 supersede 标注已入仓（`517e7cc` / `8c273e0`）

## 决策集合盘点

- `docs/adr/` 现存 **22 个文件**（0001–0014、0016–0023；**编号 0015 空缺**，全仓无引用），逐个核读状态行：全部 `状态：已接受`。
- 被标注 supersede 的条款（不计入约束）：ADR 0020 **决策 9**（「基线不动」初稿，被 ADR 0021 决策 1 supersede，ADR 0020 L161–168 显式标注）；ADR 0020 **决策 3 的 -0 句**（初稿「-0 合法」，被 ADR 0021 决策 2 修订，ADR 0020 L96–100 显式标注）；ADR 0007 open/read 编排条款（被 ADR 0008 部分取代，与本任务无交集）。
- 规范文档：`docs/vfsl/v1-spec.md`（v1 冻结方言规格）、`docs/vfsl/schema-authoring-guide.md`。
- 模块 AGENTS 明确收录的决策面：`packages/vfsl/AGENTS.md`（CONTEXT.md + v1-spec + ADR 0001/0003/0007/0016 为 normative；错误码/issue 顺序/路径上报/信封严格性/指纹输入 = 兼容性行为）、`packages/vfsl-codegen/AGENTS.md`（ADR 0005 纪律：输出确定、逐字节稳定、`generate --check` 必须检出陈旧生成物、生成器不得重推导 VFSL 语义）、`packages/namespace-runtime/AGENTS.md`（ADR 0008/0010；公共 API 只暴露 detached projection）。
- 源码仅作现状事实确认（`parser.ts` 保留名 16 名、`derived.ts` ValueSchema 9 kind、`fingerprint.ts` D2 契约标记、两处既有测试断言），不构成独立冲突基准。

## 核心 ADR 条款摘录

### ADR 0020 VFSL 数值约束（`docs/adr/0020-vfsl-number-constraints.md`，已接受，tracking #310）— 本票母法

- **决策 1（L45–61）演进路线**：不引入方言 v2；在 v1-spec §8 增补「保留名增补例外」窄条款——新增保留名属收窄，仅当 (a) 仓库内全部 schema 与已知生态使用无冲突、(b) 该名是某约束构造的语义必需组成、无等价纯拓宽写法、(c) ADR 附冲突排查证据与收窄影响面评估，且逐一经 ADR 显式裁决。`Int`/`Range` 为该条款首例（仓库唯一 schema `domains/vfs3-assets/schema.vfsl` 无该二名使用）。
- **决策 2（L63–86）三形态与白名单**：整数性 ∧ 区间两维正交；`number & Int`（无参）/ `number & Int<min,max>`（两端点**整数字面量**）/ `number & Range<min,max>`（字面量整数/小数皆可）；交叉白名单「仅允许 `string & Pattern<…>`」（E100）扩为四例，E100 文案更新；判定顺序、保留名误用规则、`[]` 后缀结合（`number & Int<0, 9>[]` = 约束整数的数组）全部镜像 Pattern 既有条款；`Int`/`Range` 进保留名集合；裸 `Int` 脱离 `number &` 语境、裸 `Range` 一律 E100（镜像裸 Pattern 判定）。
- **决策 3（L88–108）字面量拓宽（#314 已落地，本票不再动）**：`NumberLiteral = "-"? [0-9]+ ("." [0-9]+)?`，全局生效；`-0` 字面量（含 `-0.0` 等值为 -0 的形态）解析期 E100（ADR 0021 决策 2 修订句）；指数记号不做；超双精度沿 §7.3 既有路径 E100。
- **决策 4（L110–123）解析与判定规则**：arity 严格（`Int` 零参；`Int<min,max>`/`Range<min,max>` 恰两参；`Int<5>`、`Int<1,2,3>`、`Range<0>`、裸 `Range<>` → E100，「与 Pattern 实参错误同码同锚位风格，**锚定构造起点记号**」）；Int 端点整数限定（`Int<0.5, 1.5>` → E100，锚定该小数记号）；闭区间含双端点；空区间 `min > max`（f64 比较）解析期 E100（与 `Pattern<"[">` 延迟到 validate 不同——空区间不需要引擎）；**全部复用既有错误码，零新增**。
- **决策 5（L125–134）IR/derived**：新增 `{kind:'int'; min?: number; max?: number}`（裸 `Int` 两键皆缺席）与 `{kind:'range'; min: number; max: number}`，镜像 `pattern` 叶子先例；exactOptionalPropertyTypes 条件键纪律不变；`walkDocs`/索引行等消费方 switch 各加一个 case；新叶子只服务新文本——无 Int/Range 的 schema IR 逐字节不变，**既有语义指纹（sha256:v1:）全部不变**。
- **决策 6（L136–146）validate**：三形态进入标量叶子判定（与 pattern 同层）：`int` = `Number.isInteger(v)` 且 min/max 在场时 `min <= v && v <= max`；`range` = `typeof v === 'number'` 且区间比较；失配消息含期望区间/整数性描述与实际值，纳入全收集与工作预算计费；O(1) 比较、无引擎、无预算耗尽风险。
- **决策 7（L148–153）codegen**：`int`/`range` 叶子生成 `number` 原样；生成物形状不胀、`generate --check` 字节稳定基线不变；品牌类型留独立 ADR。
- **决策 8（L155–159）readData 投影**：number 不作键、无 keyPattern 对应物；`int`/`range` 在 resolve-schema-at-path 按标量叶子处理（终态/可下钻规则与 pattern 叶子同构），**不新增拒绝路径与失败码**；投影 TS 类型与决策 7 一致（`number`）。
- **决策 9（L161–177）**：已被 ADR 0021 supersede（见上），其「三形态自闭合排除非有限数」口径被吸收为全 number 家族统一基线。
- **决策 10（L179–187）spec 落地**：v1-spec §2（文法、字面量注记）、§3（保留名集合、判定顺序、交叉白名单）、§8（例外条款）修订与实现**同 PR**；authoring guide 同步增补数值约束章节（含 `>0` ≡ `Int<1, …>`、闭区间语义、Int 端点整数限定）。明确不做：开放/半开区间、指数记号、品牌类型 codegen、number 基线（另案已决）、十六进制等其它字面量形态。
- 测试矩阵要点（L242–255）：解析正例（整数/小数/负端点）；`Int<0.5,1.5>`/`Int<5>`/`Int<1,2,3>`/裸 `Range`/`Range<0>`/空区间各负例 E100 码与锚位；四值入三形态均拒绝、**入裸 number 同样拒绝**（ADR 0021 统一基线，初稿「基线不变锁定测试」翻转）；既有 fixture 指纹逐字节不变、新 fixture 指纹稳定；`generate --check` 零漂移、Int/Range 字段生成 `number`；`type Int = number;`/`type Range = number;` → E303。

### ADR 0021 number 值域收窄（`docs/adr/0021-vfsl-number-domain-narrowing.md`，已接受，tracking #312）— 统一基线

- **决策 1（L39–56）**：`number` 判定收窄为 `typeof === 'number' && Number.isFinite && !Object.is(v, -0)`；**全 number 家族统一基线**——裸 `number` 与 ADR 0020 的 `int`/`range` 叶子同一判定；supersede ADR 0020 决策 9。
- **决策 2（L58–63）**：`-0` 字面量（含 `-0.0` 等值为 -0 的形态）作为枚举成员或 `Int`/`Range` 端点 → E100，锚该字面量记号，消息引导写 `0`；`0`、`0.0` 不受影响。
- **决策 3（L65–73）**：四值细分消息（-0 须 `Object.is` 识别，不得显示为 "0"）；validate 与 validate-patch 同口径；**消息文案不进冻结面**。
- **决策 6（L94–97）**：纯运行时判定收窄——IR 形状、derived 两树、codegen 生成物、语义指纹（`sha256:v1:`）全部不变。
- 决策 7（L99–105）：合法写路径产出的 doc 结构性不含四值（changelog JCS 数值分支与 JSON 出口腐化对合法写入闭合）。

### v1-spec（`docs/vfsl/v1-spec.md`，v1 frozen，只增不改 §8）— 现状与既落条款

- §2 L33–34：现文「`string & Pattern<"正则">`（**唯一允许的交叉类型**）」——待本票四例化（决策 10 同 PR 义务）。
- §2 注记 7（L83–90）：数字字面量文法（负号 + 小数，#314 已落地）；`-0`（含下溢形态）E100；超双精度 E100；f64 归一语义。
- §3「number 值域」（L254–273，#319/#344 已落地）：四值拒绝判定式；**「家族基线」明文**：「裸 `number` 与后续数值约束形态（ADR 0020 的 `Int`/`Range`，进入方言后）同受此基线」；消息不冻结；种子/直构面不在覆盖面。
- §3 形状归类（L143–163）：「全部标量形（原始类型 / 字面量 / **含 Pattern 约束**）→ 原生叶子值」；标记成员归类 L157–163（`Pattern` → 标量形）；YLeaf 实参形状约束表 L189（标量形含 Pattern 约束）——int/range 需并入标量形家族（同 PR 修订面）。
- §3 ROOT 约定（L275–288）：ROOT 固定 Y.Map；非 map 形（标量形含 `Pattern`）→ E311 锚 ROOT 类型表达式起点。
- §4 错误模型（L292–317）：错误身份 = 码 + 消息 + 行列；message 冻结前缀格式 `VFSL-E<编号>: `，**正文措辞不冻结**；**错误码共 21 个**；单错误模型（issues 恰 1 条）；词法/语法相位即报、语义相位取最前。
- §4 判定顺序（L333–372）第 7 条：保留名记号出现在其对应产生式不适用的位置 → E100 锚该保留名记号；**声明名位保留名 → E303 锚声明名**；E301 仅适用于非保留名标识符；keyword 分类完备边界 = 保留名集合。
- §4 保留名集合（L407–415）：现 16 名（`type`、`Record`、`Pattern`、五原始名、`any`、`extends`、`interface`、六标记）——待本票 16→18（同 PR 修订面）；大小写 ASCII 冻结。
- §4 码表（L381–405）：E100 锚「构造起点记号」；E303 锚声明名；E306 锚键类型起点；E311 锚 ROOT 类型表达式起点。
- §8 方言演进（L530–545）：只增不改三规则；**两类例外条款已并列登记**（保留名增补例外首例 = ADR 0020 issue #310；语义收窄例外首例 = ADR 0021 issue #312）——本票不需新增例外类别。

### schema-authoring-guide（`docs/vfsl/schema-authoring-guide.md`）

- §6「表达值约束」（L131–153）：现有 Pattern 与 number 值域表述（L147：四值拒绝、写 `0` 不写 `-0`）；**无数值约束（Int/Range）章节**——待同 PR 增补（ADR 0020 决策 10）。
- 「v1 语法护栏」（L216–222，L220）：「交叉类型（Pattern 特例除外）」措辞——待四例化。

### 模块 AGENTS 收录的决策面

- `packages/vfsl/AGENTS.md` L5–14：CONTEXT.md/v1-spec/ADR 0001/0003/0007/0016 为 normative；parser/evaluator/validators 同步确定、公共畸形输入返回判别结果不抛；IR 与 derived 为环境无关、可 JSON 序列化纯数据；公共 API 只经 `src/index.ts`；**错误码、issue 顺序、路径上报、信封严格性、指纹输入是兼容性行为**。
- `packages/vfsl-codegen/AGENTS.md` L5–13（ADR 0005）：消费 evaluator 输出、不重推导语义；输出确定、逐字节稳定；`generate --check` 必须检出任何陈旧生成物；不支持形状响亮失败而非发射弱化类型。
- `packages/namespace-runtime/AGENTS.md` L5–15（ADR 0008/0010）：公共 API 只暴露 detached projection。

### 指纹契约（ADR 0007 L17 / ADR 0017 L114–132 / `packages/vfsl/src/fingerprint.ts` L7–24）

- ADR 0007 L17：指纹 = SHA-256 + UTF-8 + canonical JSON + 带版本 domain separation（`sha256:v1:<hex>`）；semantic 域覆盖 `lang + version +` 规范 IR。
- `fingerprint.ts` D2-CONTRACT-MARKER（L7–14）：第二生产者或跨实现指纹互认出现之前必须先升 v2 前缀；升级触发器清单（如 **v2 方言**放开数值字面量语法 ⇒ semantic 域文档重审并升 v2）；两构造函数名全仓仅许 fingerprint.ts 定义 + index.ts 调用。`FINGERPRINT_PREFIX = 'sha256:v1:'`（L24）。
- ADR 0017 L121–125：指纹字符串含版本化域前缀，消费方视为不透明。

### CONTEXT.md 术语（关联点）

- 「标记类型（marker types）」（L49–51）：`YMap`/`YArray`/`YPlainArray`/`YLeaf`/`YXmlFragment`/`Pattern` 六名——Int/Range 非 marker（无物化语义），不进该词条。
- 「值 schema（value schema）」（L60–61）：「值类型语义：封闭对象、判别联合、字面量联合、pattern 约束」——要点式列举（现版 ValueSchema 的 array/xml/scalar/optional/ref 亦不在列，见 `packages/vfsl/src/derived.ts` L44–53 现状）。
- 「语义指纹 / 信封指纹」（L79–84）、「方言」（L11–12，一经发布冻结、只增不改）。

## 现状事实（源码/测试佐证，非独立基准）

- `packages/vfsl/src/parser.ts` L79–84：`RESERVED_NAMES` 现 16 名（无 `Int`/`Range`）；L392/L480：交叉白名单 E100 文案「交叉类型仅允许 string & Pattern<…>」。
- `packages/vfsl/src/derived.ts` L44–53：`ValueSchema` 现 9 kind（object/array/xml/union/enum/pattern/scalar/optional/ref），无 `int`/`range`。
- `packages/vfsl/test/validate-number-domain-narrowing.test.ts` L419–425：`it.each(['int','Int','range','Range'])` 断言 E301「未知名引用」（描述「int/range 三形态不在本任务」）——保留名收窄后 `Int`/`Range` 语义翻转 E100、小写保持 E301。
- `packages/vfsl/test/parse-vfsl-containers-markers.test.ts` L287–293：交叉类型负例只断言 E100 码前缀（不断言文案）。
- `domains/vfs3-assets/schema.vfsl`：`\bInt\b`/`\bRange\b` 出现 0/0（本门禁独立复核；仓库内唯一 `.vfsl` schema）。
- 全仓无任何测试断言 E100 交叉白名单消息正文（grep「交叉类型仅允许」仅 `parser.ts` 两处生产文案）。

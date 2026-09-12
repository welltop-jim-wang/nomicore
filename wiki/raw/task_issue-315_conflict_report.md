# 冲突门禁报告 — issue #315（前置门禁：任务简报 + 已批准 SA6 验收契约）

## 1. Reviewed subject

**task**（前置门禁，SA1 派发前）。被审对象 = Issue #315 任务简报（`wiki/raw/task_issue-315.md`，Issue body 即需求全集——REST comments snapshot 为空，无 Owner 追加要求）+ **已批准的 SA6 验收契约**（`wiki/raw/task_issue-315_sa6_contract.md`，含 §12 契约 C1–C8、§3 约束 S1–S10、§10 实现面与回归红线、§12.11 边界钉值项）。本门禁只裁冲突，不判设计优劣、不判验收充分性。

## 2. Inputs and decision set

- 冲突基准：`docs/adr/` 全集 **22 文件**（0001–0014、0016–0023；编号 0015 空缺，全仓无引用）逐个核读 + 根 `CONTEXT.md` 全读 + 规范文档 `docs/vfsl/v1-spec.md`（v1 frozen）与 `docs/vfsl/schema-authoring-guide.md` + 模块 AGENTS 明确收录的决策面（`packages/vfsl/AGENTS.md`、`packages/vfsl-codegen/AGENTS.md`、`packages/namespace-runtime/AGENTS.md`、`docs/AGENTS.md`）。
- superseded 条款不计入约束：ADR 0020 决策 9（被 ADR 0021 决策 1 supersede，ADR 0020 L161–168 显式标注）；ADR 0020 决策 3 的 `-0` 初稿句（被 ADR 0021 决策 2 修订，L96–100 显式标注）；ADR 0007 open/read 条款（被 ADR 0008 部分取代，与本任务无交集）。
- 源码/测试仅作现状事实确认（保留名 16 名、ValueSchema 9 kind、D2 契约标记、两处既有断言、fixture grep 0 命中），不构成独立阻塞基准；`wiki/raw/` 历史工件按 `docs/AGENTS.md` 属证据非规范。
- 条款摘录与行号锚见 `wiki/raw/task_issue-315_relevant_decisions.md`。
- 前置事实：#314（PR #326 = HEAD `7b92af0`）与 #319/ADR 0021（`933f2e5`）已合入，`Blocked by #314` 前件成立。

## 3. Decision analysis

四级口径：no-conflict / implements-existing-decision / evolution-required / hard-conflict。

| # | Decision | Clause | Subject behavior | Classification | Evidence | Required action |
|---|---|---|---|---|---|---|
| 1 | ADR 0020 决策 1 + v1-spec §8 例外条款 | 「不引入方言 v2」；保留名增补例外 (a)(b)(c) 三条件，`Int`/`Range` 为首例 | `Int`/`Range` 进保留名集合（16→18），别名占用 → E303，收窄既有合法文本 | **implements-existing-decision** | ADR 0020 L45–61；v1-spec L538–541（例外条款已在仓，首例 = ADR 0020 已登记）；条件 (a) 冲突排查本门禁独立复核：仓库唯一 `.vfsl` schema `domains/vfs3-assets/schema.vfsl` 中 `\bInt\b`/`\bRange\b` = 0/0 | 无新增动作——例外已正式裁决登记，不需再走例外流程 |
| 2 | ADR 0020 决策 2 + v1-spec §4 | 交叉白名单 1 例扩 4 例、E100 文案更新、判定顺序/裸用/`[]` 结合镜像 Pattern | 三形态进白名单；裸 `Int`/`Range` 一律 E100；E100 文案更新 | **implements-existing-decision** | ADR 0020 L63–86；v1-spec L33–34（现「唯一允许」句为待修订面）、L306（message 正文措辞不冻结）；全仓无测试钉该文案（grep「交叉类型仅允许」仅 parser.ts 两处生产文案） | 无 |
| 3 | ADR 0020 决策 4 + v1-spec §4 码表/判定顺序 | arity 严格、Int 端点整数字面量、空区间（f64）解析期 E100；零新增错误码；arity 锚**构造起点记号**、浮点端点锚**该小数记号** | 契约 C2 负例族 A1–A12（E100）+ B10/B11（E303），全部复用 E100/E303 | **implements-existing-decision** | ADR 0020 L110–123（「全部复用既有错误码，零新增」；锚位规则原文）；v1-spec L299（21 码冻结）、L385（E100 锚构造起点）、§8 规则 3 | 设计必须显式冻结 ADR 未逐字钉死的边界（SA6 §12.11 B1–B4：`Int<1.0, 2>` 值/文本判定、空区间锚位、复合违规优先级、非数字实参锚位）；**arity 锚不得照搬 Pattern 的实参记号锚**（ADR 明文「锚定构造起点记号」） |
| 4 | ADR 0020 决策 5 + ADR 0021 决策 6 + ADR 0007 L17 + `fingerprint.ts` D2-CONTRACT-MARKER | IR/derived 新增 `int`/`range` 叶子（exactOptionalPropertyTypes 条件键）；无 Int/Range 的 schema IR 逐字节不变、既有语义指纹 `sha256:v1:` 全部不变 | 契约 C3/C5：条件键纪律（`Object.keys` 恰 `['kind']`）、既有 fixture 双指纹 + `generated.ts` 逐字节不变、新 fixture 指纹稳定不钉值、保持 v1 前缀 | **implements-existing-decision** | ADR 0020 L125–134；ADR 0021 L94–97；ADR 0007 L17（semantic 域 = 规范 IR 的 canonical 摘要）；`fingerprint.ts` L7–24（v2 触发器 = 第二生产者/跨实现互认；触发器例句以「v2 方言」为条件，而 ADR 0020 决策 1 明确不引入 v2 方言）；SA6 U2 裁定与 ADR 文本一致 | 实现者不得静默升 `sha256:v2:`；若 owner 另裁升版须另立 ADR 决策 |
| 5 | ADR 0020 决策 6 + ADR 0021 决策 1/3 + v1-spec §3「number 值域」 | 三形态进 validate 标量叶子判定（与 pattern 同层）、O(1)、全收集、预算计费；四值（NaN/±Infinity/-0，-0 经 `Object.is`）全 number 家族统一拒绝；validate-patch 同口径；消息含期望区间/实际值但文案不冻结 | 契约 C4（四值矩阵、C4d R2 的 -0 识别、C4e 全收集 101 条、C4f 写路径同口径）；AC3 明文采纳 ADR 0021 统一基线并标注旧「基线不变锁定测试」已被 supersede | **implements-existing-decision** | ADR 0020 L136–146；ADR 0021 L39–73；v1-spec L254–273（「后续数值约束形态（ADR 0020 的 `Int`/`Range`，进入方言后）同受此基线」原文即为本票预留）；`packages/vfsl/AGENTS.md` L9（validators 同步确定、判别结果不抛） | `validate-number-domain-narrowing.test.ts:419-425` 的翻转是**义务**（`Int`/`Range` 改断 E100、小写 `int`/`range` 保持 E301 负控），不得删除 describe 规避、不得弱化 AC1–AC6 四值负控 |
| 6 | ADR 0020 决策 7 + ADR 0005（经 `packages/vfsl-codegen/AGENTS.md` 收录） | codegen 对 `int`/`range` 生成 `number` 原样；生成物形状不胀；`generate --check` 字节稳定 | 契约 C6a（`int`/`range` → `number`、tsc 0 诊断）+ C8（`generate --check` exit 0） | **implements-existing-decision** | ADR 0020 L148–153；`packages/vfsl-codegen/AGENTS.md` L9–12（不重推导语义、逐字节稳定、`--check` 检出陈旧物） | 无 |
| 7 | ADR 0020 决策 8 + ADR 0016 | `int`/`range` 在 resolve-schema-at-path 按标量叶子处理（终态/下钻与 pattern 同构），不新增拒绝路径与失败码；投影 TS 类型 = `number` | 契约 C6b（透传深等 + `SCHEMA_PATH_NOT_FOUND` 既有码）+ C6c（`cloneValueSchema` 补 case，detached 投影纪律） | **implements-existing-decision** | ADR 0020 L155–159；ADR 0016 L51–65（结果联合两失败码冻结）、L69–70（每次读深拷贝 detached）；`packages/namespace-runtime/AGENTS.md` L14 | 无新失败码/新结果分支（C6b 已锚既有码） |
| 8 | ADR 0020 决策 10 + `docs/AGENTS.md` | v1-spec §2/§3/§8 与 authoring guide 修订与实现**同 PR** | 契约 C7：EBNF 新增 Int/Range 生产式、白名单句四例化、§3 形状表/YLeaf 行、§4 保留名 16→18、guide §6 数值约束章节 + 语法护栏四例化；spec 机检 22/22 保持 | **implements-existing-decision** | ADR 0020 L179–187；`docs/AGENTS.md`（「When code behavior changes, update every normative document whose stated contract changed」）；现状：v1-spec L33–34「唯一允许」、L407–415 十六名、guide L131–153 无数值约束章节 | 文档与实现必须同一变更集落地；§8 例外条款文字**不得改语义**（两类例外已并列登记，本票不新增例外类别） |
| 9 | v1-spec §4 判定顺序第 7 条 + §6 大小写契约 | 保留名记号在产生式不适用位置 → E100 锚该记号；声明名位保留名 → E303 锚声明名；E301 仅适用非保留名；大小写 ASCII 冻结 | 契约 C2 B1–B4（裸用 E100）、B10–B12（E303/字段名 E100）；负控：小写 `int`/`range` 保持 E301、`Integer`/`Range2` 保持合法 | **implements-existing-decision** | v1-spec L353–364、L395、L407–415；`parser.ts` L79–84 现状（16 名、既判 `Pattern` 字段名位 E100） | 保留面不得扩大到小写/近似名（SA6 负控 N-1/N-2 必须保持绿） |
| 10 | `packages/vfsl/AGENTS.md` + ADR 0003 | 错误码/issue 顺序/锚位/指纹输入 = 兼容性行为；IR/derived 环境无关、可 JSON 序列化纯数据；公共畸形输入判别结果不抛；单错误模型 | 契约 §12.0（断言只观察公共接缝运行时输出、负例钉码+锚）；C3 JSON 往返深度相等（杀 undefined 键）；C2 每例恰 1 条 issue | **implements-existing-decision** | `packages/vfsl/AGENTS.md` L9–14；ADR 0003 L48（派生物纯数据纪律）；v1-spec L302–317（issues 形状 `{message,line,column}` 冻结、恰 1 条） | 无 |
| 11 | v1-spec §8 规则 1/2（语法只增、语义不改） | 冻结演进基线 | 三形态与判定规则本身是纯拓宽（原 E100 文本变合法）；唯一收窄面（保留名）经 §8 已登记例外合法化（见 #1） | **no-conflict** | v1-spec L532–541；ADR 0020 L47–49（「纯拓宽」定性） | 无 |
| 12 | CONTEXT.md 术语（「标记类型」「值 schema」） | 标记类型六名（含 `Pattern`）；值 schema 词条为要点式列举 | `Int`/`Range` 为保留约束构造名、非 marker（无物化语义），不进标记类型词条；值 schema 语义概念不变 | **no-conflict** | CONTEXT.md L49–51、L60–61；`derived.ts` L44–53 证明该列举本非穷尽（array/xml/scalar/optional/ref 均不在列） | 非阻塞登记：设计可选择性把「值 schema」词条列举补全为「pattern / 整数 / 区间约束」（ADR 0016 更新 CONTEXT.md 之先例），非门禁义务 |
| 13 | 根 `AGENTS.md`（typed namespace writes）+ `domains/vfs3-assets/**` | 写路径必须走生成投影类型；fixture/生成物为钉死基线 | `domains/vfs3-assets/**` 与 `packages/vfsl-protocol/**` 零改动（契约 §10 回归红线明列） | **no-conflict** | 根 `AGENTS.md`；契约 §10「必须不变」清单；#314 先例（PR #326 未触碰该面） | 无 |
| 14 | ADR 0014（诊断日志）/ ADR 0021 决策 7 | 合法写入结构性不含四值；JCS 数值分支对合法写入闭合 | int/range 判定基线与四值拒绝使新叶子值域 JCS-safe | **no-conflict** | ADR 0021 L99–105；ADR 0014 全文与本任务无改写交集 | 无 |

**统计**：14 项对照——no-conflict 4 项、implements-existing-decision 10 项、evolution-required 0 项、hard-conflict 0 项。

## 4. Overrides

| Old decision | Override authority | Scope | New obligation |
|---|---|---|---|
| v1-spec §8「语法只增不改」（保留名集合 16 名冻结） | **spec 自身演进条款**：§8「保留名增补例外」（`docs/vfsl/v1-spec.md` L540；首例 = ADR 0020 决策 1，issue #310，已正式裁决登记）——属决策文本自身允许的演进路径，非事后 override | 恰 `Int`/`Range` 两名（大小写敏感，小写不涉） | 同 PR 修订 v1-spec §2/§3/§4（决策 10）；既有 `type Int = number;` 合法文本变 E303 属已裁决 breaking，发版说明显式告知（ADR 0020 负面代价节） |

无任何**非正式** override：被审对象未以「实现方便 / 测试通过 / 已有代码 / 其他 SA 同意」为由绕开决策；Issue 评论为空，亦无 Owner 评论级 override 声明（也无需——全部行为有已接受 ADR 直接授权）。

## 5. Frozen surfaces

| Surface | Must remain unchanged | Evidence | Actual result（被审对象承诺） |
|---|---|---|---|
| 错误码集合 | 21 码不新增；只复用 E100/E303 | v1-spec L299、§8 规则 3；ADR 0020 决策 4 | 一致（C2 全部 E100/E303） |
| message 前缀格式 | `VFSL-E<编号>: ` 前缀冻结；正文措辞不冻结（E100 文案更新合法） | v1-spec L302–309 | 一致（契约不断言文案，仅 C4d 内容不变量） |
| issues 形状与单错误模型 | `{message,line,column}`；恰 1 条 | v1-spec L302–317；PRD #3 接缝 | 一致（C2 每例 `issues.length===1`） |
| 既有错误码条件与锚位 | E303 @声明名、保留名误用 E100 @该记号、E301 仅非保留名、E311 @ROOT 类型表达式起点、E306 @键类型起点 | v1-spec §4 码表 L381–405、判定顺序 L353–372 | 一致（B10–B14 按既有锚风格；B13/B14 锚位移动仅因 parse 前进更深，非改锚规则） |
| 指纹域 | `FINGERPRINT_PREFIX = 'sha256:v1:'` 不升版；既有 fixture 双指纹与 `domains/vfs3-assets/generated.ts` 逐字节 | ADR 0020 决策 5、ADR 0021 决策 6、ADR 0007 L17、`fingerprint.ts` L7–24 | 一致（C5 钉字节；U2 登记保持 v1） |
| 信封形状 | 四键 `{lang,version,id,text}` | ADR 0007/0017、v1-spec §7 | 一致（不触碰） |
| `resolveSchemaAtPath` 结果联合 | 两失败码 `SCHEMA_PATH_NOT_FOUND`/`SCHEMA_PATH_INVALID` 不增不改 | ADR 0016 L51–58 | 一致（C6b 锚既有码） |
| tokenizer/字面量面 | #314 已裁定文法、`-0`/超双精度闸门、`.5`/`1.`/指数记号 E100 | v1-spec §2 注记 7、ADR 0020 决策 3 | 一致（契约明言不动 tokenizer/字面量面） |
| 生成物新鲜度门 | `pnpm generate --check` 检出任何陈旧物；生成器不重推导语义 | `packages/vfsl-codegen/AGENTS.md` L10–12 | 一致（C8 门禁清单含 `--check`） |
| §8 例外条款结构 | 两类例外并列、独立计数；不新增例外类别 | v1-spec L538–541 | 一致（C7 明言既有例外条款不改） |
| validate 既有四值基线 | 裸 `number` 四值拒绝/有限数放行（#319 落地）不回归 | v1-spec §3 L254–273 | 一致（C4c 负控保持 `validate-number-domain-narrowing` AC1–AC6） |
| 公共 API 面 | vfsl 公共 API 只经 `src/index.ts`；namespace-runtime 只暴露 detached 投影 | `packages/vfsl/AGENTS.md` L13、`packages/namespace-runtime/AGENTS.md` L14 | 一致（实现面全部为内部 switch 接线，无新公共入口） |

## 6. Evolution requirements

无 `evolution-required` 裁决项。说明：

- 被审对象所需的全部规范文档修订（v1-spec §2/§3/§4、guide §6/护栏）均由 **ADR 0020 决策 10 明文要求同 PR 落地**，属既有决策的兑现义务而非新的决策演进；§8 例外条款已在仓（#344 已落地），本票零例外类别增补。
- 唯一形式上的「冻结破例」（保留名收窄）已有正式裁决链（ADR 0020 决策 1 → spec §8 例外首例登记），见 §4 Overrides。
- 设计期边界钉值（SA6 §12.11 B1–B6：`Int<1.0, 2>` 值/文本判定、空区间锚位、复合违规优先级、非数字实参锚位、E100 文案、联合硬矛盾模型）是 **ADR 授权范围内的实现裁量冻结**，不是契约演进——设计必须显式冻结且与 ADR 0020 明文锚位规则（「锚定构造起点记号」）一致。

## 7. Hard conflicts

**无。** 未发现任何与 ADR 全集、CONTEXT.md、v1-spec/guide 或模块 AGENTS 收录决策不兼容且无合法 override 的要求。特别核对过的候选冲突面及其排除理由：

1. 「收窄既有合法文本（`type Int = number;` → E303）vs §8 只增不改」——经 §8 保留名增补例外（首例 = ADR 0020）合法化，冲突排查条件 (a) 本门禁独立复核成立（仓库唯一 schema 0 命中）。
2. 「空区间解析期 E100 vs Pattern 非法正则延迟到 validate（spec §9.1）」——ADR 0020 决策 4 显式推理区分（空区间无需引擎），非矛盾。
3. 「-0 端点 E100 vs ADR 0020 决策 3 初稿」——初稿已被 ADR 0021 决策 2 正式修订并在两份 ADR 双向标注，spec §2 注记 7 已载修订后条款。
4. 「IR 新叶子种类 vs 指纹 v2 升级触发器」——触发器以「第二生产者/跨实现互认」及「v2 方言」为条件；ADR 0020 决策 1 明确不引入 v2 方言、决策 5 冻结既有指纹，保持 `sha256:v1:` 与 D2 标记纪律一致。
5. 「新负例锚位 vs Pattern 实参锚风格」——ADR 0020 决策 4 对本票明文「锚定构造起点记号」；SA6 契约 H8/§12.3 注已正确识别该差异并按 ADR 执行，不构成对 spec §4 锚位冻结面的违反（E100 码表锚 = 构造起点记号，本就吻合）。

## 8. Required actions（移交设计/实现/复审，不阻塞放行）

1. **同变更集文档落地**：v1-spec §2（EBNF 生产式 + 白名单句四例化）、§3（标量形家族/YLeaf 行）、§4（保留名 16→18 + E100 码表示例）、authoring guide §6 + 语法护栏，必须与实现同一 PR（ADR 0020 决策 10）；spec 机检 22/22 与 `spec-docs-anchor` D2/D3/D5 保持绿。
2. **既有测试翻转为义务**：`validate-number-domain-narrowing.test.ts:419-425` 拆分（`Int`/`Range` → E100 @ 该记号；`int`/`range` 保持 E301 负控），描述文案同步；不得删除 describe 规避，AC1–AC6 四值负控零弱化。
3. **设计显式冻结 §12.11 边界值**：B1（Int 端点整数性的值/文本判定）、B2（空区间锚位）、B3（复合违规优先级）、B4（非数字实参锚位）、B6（联合硬矛盾模型）——冻结值必须与 ADR 0020 明文一致（arity 锚构造起点记号；不得照搬 Pattern 实参锚）。
4. **指纹纪律**：保持 `sha256:v1:`、既有 fixture 双指纹与 `generated.ts` 逐字节不变；`fingerprint.ts` 两构造函数静态守卫（全仓仅定义 + index.ts 调用）不被触碰。
5. **保留面精确性**：收窄恰为 `Int`/`Range` 两名（大小写敏感）；小写与近似名负控保持绿。
6. **实现后 SA8 复审**（见 §10）：核对文档与代码同变更集、锚位/错误码零漂移、override 未扩大、既有断言零弱化。

非阻塞登记（不构成冲突，供总控/下链知悉）：

- CONTEXT.md「值 schema」词条列举可选补全（「pattern / 整数 / 区间 约束」）——该列举本非穷尽（array/xml/scalar/optional/ref 亦不在列），非门禁义务；「标记类型」词条维持六名不变。
- `parse-vfsl-containers-markers.test.ts:287` describe 标题「唯一被接受的交叉形式」措辞将过时（断言只钉 E100 码，仍绿）——可选文案更新，非规范面。
- ADR 编号 0015 空缺（22 文件），与本任务引用无关。

## 9. Verdict

**clear**

- 14 项对照全部为 no-conflict（4）或 implements-existing-decision（10）；无 evolution-required、无 hard-conflict。
- 任务性质：ADR 0020（决策 2/4/5/6/7/8/10）+ ADR 0021（决策 1/2/3）已裁决能力的**端到端兑现**——从 parser 白名单/保留名一路落到 IR/derived/validate/codegen/投影/规范文档；唯一冻结破例（保留名收窄）走 spec §8 已登记例外，合法且证据成立。
- 信息充分性：ADR 22 文件、CONTEXT.md、v1-spec/guide、三份模块 AGENTS 全读；SA6 契约自带 HEAD 红灯证据与基线钉值；本门禁独立复核了保留名冲突排查（0 命中）、消息文案无测试钉死、ValueSchema 现状与前置合入事实。无信息不足。
- 放行：总控可按流程派发 SA1 设计；设计须兑现 §8 Required actions 1–3。

## 10. requiresConflictRecheck

**true**

理由：本任务触碰**方言文本面（schema 语言 surface）**、IR/derived schema 形状、validate 失败语义（新叶子四值/区间判定）与**正式冻结例外（保留名收窄）的落地**，且同 PR 规范文档修订、既有测试语义翻转（§8 Required actions 1–2）均尚待实现后核对——非「纯 no-conflict、无新决策面的既有决策兑现」。设计后复审与实现后复审应逐项核对：文档与代码同变更集、语义一致、override 未扩大、旧引用（「唯一允许的交叉类型」句、十六名保留名句、过时 describe 标题）已更新、既有断言零弱化。

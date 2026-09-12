# SA2 设计攻击评审 — issue #315：VFSL 三约束形态核心链（number & Int / Int<min,max> / Range<min,max>，ADR 0020）

- Reviewer：SA2（mabf-sa2 / attack-design / design-review / iteration 0）
- 被审对象：`wiki/raw/task_issue-315_design.md`（SA1，dispatch `sa-29e1b680…`）
- 基线：worktree `/home/wangjian/nomicore-fix-issue-315`，HEAD `7b92af0`（本评审全部源码核验在此 HEAD 上独立重做）
- 评审产物：本文件（首次评审，无前序 `task_issue-315_sa2_review.md` 需原位更新）

---

## 1. Reviewed inputs

| 输入 | 状态 |
| --- | --- |
| 任务简报 `wiki/raw/task_issue-315.md`（Issue body = 需求全集；Comments 节空） | 已读 |
| 设计 `wiki/raw/task_issue-315_design.md`（564 行全文） | 已读 |
| SA6 验收契约 `wiki/raw/task_issue-315_sa6_contract.md`（§3/§5/§8-§15 + Appendix） | 已读 |
| SA8 冲突报告 `wiki/raw/task_issue-315_conflict_report.md`（14 项对照 + 冻结面 + Required actions 1-6） | 已读 |
| SA8 决议摘录 `wiki/raw/task_issue-315_relevant_decisions.md` | 已读 |
| 源码独立核验：`parser.ts` / `tokenizer.ts` / `semantic.ts` / `shapes.ts` / `resolve.ts` / `evaluate.ts` / `validate.ts` / `validate-patch.ts` / `resolve-schema-at-path.ts` / `ir.ts` / `derived.ts` / `fingerprint.ts` / `index.ts`；`vfsl-codegen`（emitter/valuetype/collect/docs/protocol-surface/cli）；`namespace-runtime/read-schema-projection.ts`；`vfsl-protocol/index.ts` | 已读 |
| 测试面核验：全仓 grep `Int`/`Range`/`int`/`range`/`交叉类型仅允许`/`Int<`/`Range<`（packages/apps/domains/tests）；`validate-number-domain-narrowing.test.ts`、`parse-vfsl-containers-markers.test.ts`、`number-literals-fixture-drift.test.ts`、`spec-docs-anchor-m4-contract.test.ts`、`generate-number-literals.test.ts`（tsc-helper 装置）、`tests/acceptance/vfsl_spec_acceptance.py`（G4/G5/G6/G8/G9 机制） | 已读 |
| 规范文档核验：`docs/adr/0020-*.md`（决策 1/2/4/5/6/7/8/10 + 测试矩阵）、`docs/adr/0021-*.md`（决策 1/2/3/6/7）、`docs/vfsl/v1-spec.md`（L33-34/L254-273/L353-360/L381-415/L530-545）、`docs/vfsl/schema-authoring-guide.md`（§6/L216-222）、`CONTEXT.md`（L49-61）、模块 AGENTS（vfsl / vfsl-codegen / namespace-runtime / docs） | 已读 |
| fixture 核验：`domains/vfs3-assets/schema.vfsl`（`\bInt\b`/`\bRange\b` 0 命中独立复核）；`vitest.config.ts` include 面 | 已读 |

无缺失输入。Issue 评论快照为空（简报 §Comments 与派工单双确认），无 Owner 评论级要求需要映射。

---

## 2. Verdict

**approve**（无 BLOCKER、无 MAJOR；2 项 MINOR 与 4 项非阻断观察，见 §13/§14）。

独立攻击结论：设计的源码事实层（C-1~C-20）、全链接线清单、B1-B6 边界冻结、锚位算术、SA8 义务落实、文件范围与验收映射全部经本评审在 HEAD 上独立复核成立。两处非 switch 盲区（`isNoChildTerminal`、emitter 叶子闸门）被设计显式点名并有判别性测试封死；两条静默放行通道（`validateValue`/`contradictsInner` 未知 kind）被穷尽 switch + typecheck 双保险封死。发现的偏差均为文档级精度问题（不影响行为安全、失败方向为响亮红），列非阻断。

---

## 3. 需求覆盖

| Requirement（Issue body） | Design section | Assessment |
| --- | --- | --- |
| 三形态正例（整数/小数/负端点）解析→IR→derived→validate 全链贯通，边界含端点 | §1 目标 1；§8.1-§8.4；§12 C1/C3/C4a-C4b 映射 | 覆盖。parser 主层识别（镜像 string&Pattern 先例，`parser.ts:469-481` 结构核实）、IR/derived 条件键叶子、validate 级联含闭区间端点判定（`!(min<=v&&v<=max)`，单点区间 min==max 合法）；全局位置（别名 RHS/Record 值位/YLeaf 实参/数组/联合/可选字段）经 `parseTypeExpr` 递归自然可达，设计 G1-G4 映射成立 |
| 各负例（arity、Int 浮点端点、空区间、裸用、保留名占用 E303）错误码与锚位正确 | §8.1 锚位总表 + (c)/(d)/(f)；§7 B2-B4；§12 C2（A1-A12/B1-B14） | 覆盖。锚位算术本评审逐例独立重算一致（MODULE 脚手架 FORM (1,23)、`&` (1,30)、`Int`/`Range` (1,32)、A6 (1,36)、A7 (1,39)、A10 (1,36)、A11 (1,38)、A12 (1,36)、B9 (1,41)、B12 (1,20)、B13 (1,13)、B14 (1,30)、B10/B11 (1,6)）；E303/E100 自动覆盖点（`parser.ts:296-298`/`:622-626` 查 `RESERVED_NAMES`）源码核实 |
| NaN/±Infinity/-0 入三形态均拒绝，入裸 number 同样拒绝（ADR 0021 统一基线） | §8.4 判定级联第 2 步（复用 `isJsonFaithfulNumber` 否定式 + `renderNumberValue`）；§12 C4c + 负控 | 覆盖。级联 typeof→四值→整数性→区间与 `validate.ts:505-511` scalar 先例同构；-0 对偶关键性核实：纯 ADR 0020 决策 6 公式会放行 Range 内 -0（`-40 <= -0 && -0 <= 85` 为真），设计正确以 ADR 0021 决策 1 家族基线优先（AC3 明文要求）；消息域短语「期望 number（有限数且非 -0）」与既有 `scalarRejectMessage`（`validate.ts:199-204`）逐字同源 |
| 无 Int/Range 的既有 fixture 指纹逐字节不变；含 Int/Range 新 fixture 指纹稳定 | §8.2 条件键纪律；§9 指纹零漂移论证；§12 C5 | 覆盖。既有文本 AST 构造路径不变（parser 只新增 `number &` 前瞻分支）；钉值哨兵 `number-literals-fixture-drift.test.ts:23-25` 实测在仓（`sha256:v1:7b6c19cb…`/`sha256:v1:b71be76e…`/`342d8c1f…e6707`）；`fingerprint.ts` D2 标记与 v1 触发器条件（第二生产者/跨实现互认/v2 方言）核实，设计「不升版」论证与 SA8 #4、SA6 U2 一致 |
| 包测试、typecheck 全绿 | §12 C8（六件套 + 焦点红→绿 + 翻转用例绿） | 覆盖。C6c 的「穷尽 switch 由 typecheck 机械强制」主张经全仓 switch 盘点证实（见 §10 相似能力对照前置核验）；vitest include 面零配置核实 |

目标与非目标无静默扩大：非目标清单与 ADR 0020 决策 10「明确不做」逐项一致；CONTEXT.md 词条补全为 SA8 已登记的非阻塞项；describe 标题为可选项。

## 4. Owner评论覆盖

REST comments snapshot 为空（简报 §Comments、设计 §4、SA8 §1 三方一致）。无 Owner 评论级追加要求，无需映射表。设计 §4 明确「需求全集 = Issue body（5 条 AC）」并逐条落点——与派工单一致，无遗漏义务。

## 5. 上游事实与SA8约束

| Fact or constraint | Design response | Assessment |
| --- | --- | --- |
| SA8 #1（ADR 0020 决策 1 + spec §8 例外首例已登记）保留名 16→18 | §8.1(a) RESERVED_NAMES +2；E303/字段名 E100 经既有查询点自动覆盖 | 落实。`parser.ts:79-84` 现值 16 名核实；`:296-298`/`:622-626` 两查询点核实；不再走例外流程正确（例外已在仓，spec §8 L538-541 两类例外并列登记核实） |
| SA8 #2（决策 2：白名单四例、E100 文案更新、判定顺序/`[]` 结合镜像 Pattern） | §8.1(b)(d)(g) + B5 | 落实。镜像点 `:469-481`（string&Pattern 主层）与 `parsePostfixType :358-380` 不变性核实；「交叉类型仅允许」全仓仅 `parser.ts:392`/`:480` 两处生产文案、无测试钉死（grep 独立复核） |
| SA8 #3（决策 4：arity 锚构造起点记号，不得照搬 Pattern 实参锚；端点违规锚该记号） | §8.1 锚位总表 + B2-B4 + §7 | 落实。ADR 0020 L110-123 原文「锚定构造起点记号」「锚定该小数记号」核对一致；设计把 arity/空区间锚 `Int`/`Range` 记号、端点值违规锚该记号、非数字实参锚该实参记号（B4，镜像 Pattern 实参锚 `:554-558` 风格）三分清晰 |
| SA8 #4 + Required action 4（指纹纪律：v1 前缀、钉值逐字节、静态守卫不触碰） | §8.2 + §9 + DENY LIST | 落实。`fingerprint.ts` 零改动入 DENY；键序 kind→min→max 冻结；C5 双向断言（既有钉值 + 新 fixture 稳定不钉值） |
| SA8 #5（决策 6 + ADR 0021 1/3：标量叶子层判定、四值统一、-0 `Object.is`、消息不冻结、validate-patch 同口径） | §8.4 + B6 | 落实。`validate-patch.ts:35` 共享 `validateSubtree` 核实——零改动自动继承成立；`memoKey` -0 消歧哨兵（`validate.ts:67-69`）与 `renderNumberValue` 复用核实 |
| SA8 #6（决策 7 + ADR 0005：codegen 发射 number、字节稳定） | §8.5 | 落实。`emitter.ts:337` 闸门为 if 判定（非 switch）——设计显式点名手改；`valuetype.ts projectValue` 穷尽 switch typecheck 强制；`YPlainArray<number & Int<1,3>>` 经 `plain` 分支 `projectValue` → `number[]` 路径核实（emitter :319-323） |
| SA8 #7（决策 8 + ADR 0016：投影按标量叶子、零新增拒绝路径/失败码） | §8.6 | 落实。`resolve-schema-at-path.ts:289-290`/`:413-414` default 终态透传核实（两 switch 均有 default）；`cloneValueSchema`（`read-schema-projection.ts:121-181`）穷尽无 default——typecheck 强制补 case |
| SA8 #8 + Required action 1（文档与实现同一变更集；§8 例外条款不改语义） | §8.7（spec §2/§3/§4 + guide + CONTEXT.md；§8 零编辑） | 落实。spec L33-34「唯一允许」句、L407-415 十六名、guide §6/L220 现状核实均为待修订面；§8 两类例外已并列登记、零编辑正确；G4/G5/G6 机制核实（REQUIRED_LHS 为子集检查、`Y[A-Z` 坏名规则不匹配 `IntType`/`RangeType`、FORBIDDEN_KEYS 只扫「禁止」节表格——spec 编辑面不触及 G8/G9） |
| SA8 #9（判定顺序第 7 条 + 大小写契约：恰 `Int`/`Range` 两名） | §8.1(a) + §10 负控 N-1/N-2 | 落实。小写 `int`/`range` 保持 E301、`Integer`/`Range2` 保持合法 |
| SA8 Required action 2（`validate-number-domain-narrowing` 翻转为义务） | §10.2 必须翻转节 | 落实（拆分 + 零弱化；一处列号精度偏差见 N-1） |
| SA8 Required action 3（设计显式冻结 §12.11 B1-B6） | §7.2 B1-B6 全部冻结 | 落实。逐项与 ADR 明文锚位规则、SA6 建议值对照一致（B1 值判定：`-0` 闸门注释「文本判定漏下溢形态」先例核实于 `parser.ts:421-424`；B6 类型级：`validate.ts:375-376` pattern 先例核实） |
| SA6 §5/§8/§9 上游事实（13 例红因、E2-E6 手造链缺口、投影已 kind-agnostic） | §5 复现承接表 + §3 放大因素 | 落实。红因定位（`dispatchContinuation`/白名单闸门）与手造缺口（evaluate 丢键、validate 14/14 放行、codegen desync、投影透传）均与源码结构一致 |
| SA6 §7（`ISSUE_LIMIT=100`、charge 计费、截断标记） | §8.4「计费与全收集零新增」 | 落实。`validate.ts:54`/`:101-114`/`:649-655` 核实；int/range 判定为常数次比较，无新预算路径 |

上游事实与源码无矛盾；设计 §5 声称的锚位独立重算经本评审二次独立重算一致。

---

## 6. 设计内部一致性

| 检查点 | 结论 |
| --- | --- |
| 正文 ↔ 伪代码 ↔ 接口 | 一致。§8.1(d) 前瞻逻辑与 (e)/(f) 消费逻辑闭合（peek(2) `<` 判定与 `parseIntType` 内 `peekPunct('<')` 复核无状态分叉）；`parseConstraintArgs` 形状扫描逐行走查 A1-A5/B4 全部用例命中冻结锚（含 B3 的「计数判定先于种类判定」：`Int<1,2,"a">` 报 arity @ nameTok） |
| 锚位总表 ↔ B1-B4 ↔ SA6 C2 | 一致（§3 表逐列重算）；两套锚分工（parser E100 锚 `Int`/`Range` 记号 vs AST pos = `number` 记号供 E304/E306/E311 语义锚定）与 `nodePos`/`pattern` 先例（`parser.ts:564` pos = `string` 记号）镜像一致，E306/E311 锚点机制经 `shapes.ts:checkE306`（`nodePos(r.key)`）/`checkE311`（`nodePos(body)`）源码核实 |
| D1-D6 ↔ §8 各节 | 一致。D2 条件键（AST/IR/derived 三层）与 `toIRType`/`valueOf` 构造式对应；D3 级联与 `intRangeReject` 四步对应；D5 零行为改动与两处 default 注释更新对应 |
| B6 冻结 ↔ `validateUnion` 实际结构 | 一致。候选过滤（`contradicts`）/候选分支（`联合成员 i/N：` 下钻恰 1 条）/无候选分支（`不匹配任何联合成员` + 下钻 2 条）与 `validate.ts:438-482` 逐段对照：`{v:5}` → int 候选 → 1 条；`{v:true}` → 全矛盾 → 2 条。B6 选型与 SA6 §12.11 B6 建议值一致 |
| 消息不变量 R1/R2/R3 ↔ C4d | 一致。R2 的 -0 ≠ 0 对照（`Int<1,100>` 下 0 走 range 维渲染 `0`、-0 走 four-value 维渲染 `-0`）由级联顺序构造性保证；R3 上端点 `100` 由 `[${t.min}, ${t.max}]` 模板保证 |
| §9 指纹论证 ↔ fingerprint.ts 域文档 | 一致。semantic 域输入 `{domain, lang, version, module}`、module 为 IR、v2 触发器三条无一命中 |
| §13 风险表 ↔ 实际盲区 | 一致且诚实。两处非 switch 位点（`evaluate.ts:210-216` 布尔表达式、`emitter.ts:337` if 判定）确实是 typecheck 盲区——本评审另做全仓 switch 盘点未发现第三处（见 §10） |
| 死引用/旧 API | 未发现。`jsonTypeOf`/`renderNumberValue`/`isJsonFaithfulNumber`/`charge`/`ctx.emit`/`peekPunct`/`err()`（undefined anchor 回退 (1,1)）均实测在位 |
| 附录自查清单 ↔ 正文 | 一致（10 项均可回溯正文章节） |

发现的内部不一致（不阻断，见 §14）：N-1（§10.2 列号）、N-2（§8.1(d) 括注机制描述与伪代码实现路径不一致，观察等价）。

## 7. 状态机与并发攻击

本任务为同步纯函数链（parser→evaluate→validate/codegen/投影），无持久状态、无后台任务、无跨调用缓存（模块 AGENTS「同步确定、调用局部中间态」）。攻击面收敛为解析推进状态与判定顺序：

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
| --- | --- | --- | --- | --- | --- |
| S-1 | 解析 `number & Int<…` 中途 | EOF（`Int<` / `Int<1,` / `Int<1, 2` 后截断） | E100（EOF 锚回退 (1,1)） | 无——(f) 形状扫描首行覆盖三形态截断；`err()` 回退机制源码核实（`parser.ts:227-229`） | 无 |
| S-2 | `parseConstraintArgs` 循环中 | 分隔符畸形（`Int<1 2>`、`Int<1;2>`） | E100 锚该分隔记号 | 无——(f)「否则 → E100 锚 sep」覆盖 | 无 |
| S-3 | `number &` 后 p1 非 Int/Range/Pattern | 交叉残留（`number & string`、`number & int<1,2>` 小写） | E100 @ `&` | 无——(d) 尾抛 CROSS_WHITELIST_MSG；peek(1) undefined（EOF）同样落该锚 | 无 |
| S-4 | int 节点已返回 | 第二段 `&` / `[]` / `\|` / `>` 续位 | `[]` 包装数组；`\|` 入联合；`&` E100 @ 该 `&`；`>` 正常闭包 | 无——`parsePostfixType`/`dispatchContinuation` 零改动核实（`:358-397`） | 无 |
| S-5 | 嵌套泛型闭包（`Record<string, number & Int<1, 3>>`） | 内层 `>` 与外层 `>` 相邻 | 内层 `>` 恰好闭 Int 实参、外层留 Record | 无——(f) `sep 是 '>' 且 args.length === 2` 只消费一个 `>` | 无 |
| S-6 | 重复事件/重试/并发 | 同输入重跑 | 同输出（纯函数；SA6 E7 两轮 diff 为空先例） | 无 | 无 |
| S-7 | doc 记账中途（`number & /*doc*/ Int<…>`） | 夹缝 doc 挂靠 | 留 dangling → E305 既有语义（镜像 Pattern 不 claimDocs） | 无——`next()` 沉积/`docTotal` 不变量（`:282-287`）不因新分支改变；C3 断言 docs 空表 | 无 |

## 8. 错误与恢复攻击

| ID | Failure | Current design behavior | Risk | Required revision |
| --- | --- | --- | --- | --- |
| E-1 | 手造 int/range IR 绕过 parser（`validateValue`/`contradictsInner` 未知 kind） | 穷尽 switch 无 default → typecheck 编译期报缺；C4g 判别运行期 | 无（SA6 E3 的静默放行通道被封死） | 无 |
| E-2 | 手造 int 叶漏接 `isNoChildTerminal`（别名链字段位） | 结构树把 int 叶当 ref 终态 → 两树漂移 | 被 C3 结构断言 + 别名链用例捕获（设计 §13 首行显式登记） | 无 |
| E-3 | 手造 `Record<int叶, V>`（键位） | `keyPatternOf` else-throw InternalError（loud）→ E100 收编 | 无静默通道（`evaluate.ts:331-337` 核实） | 无 |
| E-4 | codegen 结构/值 desync（int 叶配非 leaf 结构） | `desync` 响亮抛错保留（闸门收窄只放行合法组合） | 无 | 无 |
| E-5 | 单键手造 int 叶（`{kind:'int',min:1}` 无 max） | 级联第 4 步 `value <= undefined` 恒假 → 全量拒绝（fail-closed 过拒）+ 消息渲染 `[1, undefined]` | 无伪 ok 路径；文本层构造性不可达（D2「解析层保证不出现单键」）；但与仓内手造 IR 的 loud-throw 先例（`put()`/`guardMemberDocs`/`keyPatternOf`）风格不一致 | 非阻断观察 O-1：建议 SA3/SA4 在实现或复核时补一行设计注记（fail-closed 声明或 evaluate 内联 loud 守卫） |
| E-6 | 预算/截断终态被 int 判定误触发 | 判定为常数次比较、走既有 `charge`/`emitIssue` 通道 | 无 | 无 |
| E-7 | 部分完成伪成功（parse ok 但语义相位失败） | 单错误模型 + 候选池 min-position 裁定继承（E306/E311 等语义相位码照常产出） | 无——B13/B14 即此路径的正例 | 无 |
| E-8 | 指纹意外漂移（键序扰动） | C5 钉值 + `generate --check` 双门禁；键序冻结于 §8.2 | 无 | 无 |

正常路径不变量未被 fallback 掩盖：四值拒绝复用既有判定助手而非重写；消息经 `renderNumberValue`；无任何「降级放行」。

## 9. 契约影响审查

| API or contract | Missing or weak caller handling | Evidence | Required revision |
| --- | --- | --- | --- |
| `parseVfsl` 结果联合（schemasource/envelope 编译链、schema-check-cli、测试） | 无——结果形状不变，行为变化即目标；`type Int = number;` → E303 属已裁决 breaking，仓内 0 命中（fixture + 全测试面 grep 独立复核：唯一命中即翻转目标文件本身） | `packages/vfsl/src/index.ts`；grep 结果 | 无 |
| `evaluate` → derived 两树（envelope、codegen collect、测试） | 无——穷尽 switch typecheck 强制；`terminalOf` 非 marker 回退自动覆盖 | `evaluate.ts:85-142`/`:276-325`/`:387-428`/`:219-226` | 无 |
| `validateLogicalSnapshot`/`validatePatch`（doc-runtime `mutation-local` 经 `applyMutationAtBoundary`、namespace-runtime 写路径） | 无——共享 `validateSubtree` 单源（`validate-patch.ts:35` import；两处调用点 `:563`/`:1013` 核实），C4f 单例锁定同口径 | 源码核实 | 无 |
| `generateProjection`（codegen CLI、`pnpm generate --check`、`domains/*/generated.ts`） | 无——两处 case 后既有生成物字节不变（vfs3-assets 无 int/range）；desync 保留 | `emitter.ts:335-348`/`valuetype.ts:26-57` | 无 |
| `resolveSchemaAtPath` + `readData` 投影（namespace-runtime 组合） | 无——default 透传 + `cloneValueSchema` 补 case；`SCHEMA_PATH_NOT_FOUND` 既有码 | `resolve-schema-at-path.ts:289`/`:414`；`read-schema-projection.ts:121-181` | 无 |
| `VfslKind`/PathSchema 协议消费（vfsl-protocol） | 无——五值不变，int/range 物化 `leaf` | `vfsl-protocol/src/index.ts:5-6` | 无 |
| 既有测试断言（全仓） | 无遗漏——全仓 grep 证实仅两文件相交：翻转目标（必达）+ containers-markers（只断码前缀，仍绿）；「交叉类型仅允许」文案无测试钉死 | grep 独立复核 | 无 |
| 公共类型面（`VfslType`/`ValueSchema` 经 index.ts 导出） | 联合成员 additive 扩展，无签名变化；`resolve-schema-at-path.test-d.ts` 的 `toEqualTypeOf<ValueSchema>` 为 kind 无关断言，不受影响 | `index.ts:65/:73`；test-d 核实 | 无 |

调用方矩阵（§10.1）与本评审独立盘点一致；「无未覆盖调用方」主张成立（盘点含 codegen `protocol-surface.ts`——经查为 `VfslTypedAccess` 子串误配，实为冻结导出名清单，零 kind 分派，无需改动）。

## 10. 架构一致性与惯例审查

### 责任归属

| Behavior | Expected owner | Design location | Assessment |
| --- | --- | --- | --- |
| 文本层闸门（arity/端点/空区间/裸用/保留名） | parser（事实 Owner：记号流与锚位） | §8.1 | 正确；镜像 Pattern 先例不另起闸门层 |
| 运行时逐值判定 | validate 标量叶子层（与 pattern 同层） | §8.4 | 正确；未在应用层复制判定 |
| IR/derived 承载 | ir/derived 纯数据 + semantic/evaluate 穷尽 switch | §8.2/§8.3 | 正确；JSON 纯数据与条件键纪律保持 |
| codegen 投影 | vfsl-codegen projectValue 单点 | §8.5 | 正确；不重推导语义（ADR 0005） |
| 投影克隆 | namespace-runtime cloneValueSchema（detached 纪律 Owner） | §8.6 | 正确 |

### 相似能力对照（含前置核验：全仓 kind-switch 盘点）

本评审以 `case 'pattern'` / `'pattern'` / `'scalar'` / `VfslType|ValueSchema` 四组 grep 对全仓 src 做了穷尽盘点：

| Similar capability | Existing implementation | Proposed design | Consistent or divergent | Reason |
| --- | --- | --- | --- | --- |
| 约束叠加类型（`string & Pattern<…>`） | 主层识别 + `parsePatternType` + pattern 叶子全链 | 镜像同构（主层识别/叶子/同层判定/同层投影） | 一致 | ADR 0020 决策 2 明文镜像要求 |
| kind 接线位点 | 穷尽 switch 8 处（toIRType/shapes.localCls/resolve.localCls/structureOf/valueOf/walkDocs/validateValue/contradictsInner/projectValue/cloneValueSchema）+ 非 switch 2 处（isNoChildTerminal/emitter 闸门）+ default 自动覆盖 6 处（strFormOf/clsOf/typeCls/walk 族/matchValueNode/collectAliasClosure/terminalOf 回退） | 设计逐一对应（typecheck 强制 8 + 显式手改 2 + 注释更新自动覆盖组） | 一致 | 盘点未见第三处盲区——设计清单穷尽 |
| number 家族四值基线 | `isJsonFaithfulNumber`/`renderNumberValue`/`scalarAccepts` 单一事实源 | `intRangeReject` 复用（否定式 + 渲染） | 一致 | 不制造第二套数值语义（B1 同理拒绝文本判定） |
| 共享解释器（validate-patch） | `validateSubtree` 单源 | 零改动继承 | 一致 | 旁路实现会红 C4f |
| 错误码复用 | E100/E303 既有码 + 既有锚风格 | 零新增码 | 一致 | ADR 0020 决策 4 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
| --- | --- | --- | --- |
| 端点数值语义 | tokenizer f64 `Token.num` | IR min/max、validate 比较 | 无（单源；B1 值判定封死第二语义） |
| 白名单文案 | `CROSS_WHITELIST_MSG` 模块常量（两生产点共用） | 无副本 | 无（提常量消除双文案漂移） |
| 指纹 | `fingerprint.ts` 单一生产者 | 钉值测试哨兵 | 无（D2 守卫 + DENY） |
| 判定口径 | `intRangeReject` + 既有四值助手 | 消息构造 | 无 |

### 生命周期对称性

无新增生命周期（纯函数链；无 register/dispose、无订阅、无后台任务、无持久化）——N/A，与 §9「无并发面」论证一致。

### 平行机制检查

| Candidate duplicate | Existing path | Proposed path | Disposition |
| --- | --- | --- | --- |
| 第二套数值判定 | `scalarAccepts`/`isJsonFaithfulNumber` | 复用 | 无平行 |
| 第二错误通道 | issues 单错误模型 | 复用 E100/E303 | 无平行 |
| 旁路 validate | `validateSubtree` 共享 | 零改动 | 无平行 |
| 新公共入口 | index.ts 公共面 | 无新增 | 无平行 |

## 11. 文件范围审查

| Path or scope issue | Evidence | Required revision |
| --- | --- | --- |
| ALLOW 18 项 ↔ §8/§10 触及面 | 逐节对照：§8.1-§8.7 每个改动点均有 ALLOW 条目；无 ALLOW 项无正文落点（CONTEXT.md 为 SA8 登记项、containers-markers 标注「可选」） | 无 |
| DENY 与正文冲突 | 无冲突——`read-schema-projection.ts` 在 ALLOW 且 DENY 侧明示「除 read-schema-projection.ts」；`validate-patch.ts`/`tokenizer.ts`/`fingerprint.ts`/`pattern.ts`/`index.ts`/`vfsl-protocol/**`/`domains/**`/doc-runtime/ADR/spec §5/§8/acceptance py/CI 配置零改动主张均与正文一致且经源码盘点佐证 | 无 |
| 无理由扩张 | 未发现——ALLOW 最小覆盖（注释级改动亦逐文件列出） | 无 |
| follow-up 掩盖必要项 | 无——§13 残余 4 项均为 ADR 明文不做或可选措辞，不属本票 AC | 无 |

## 12. 验收设计审查

| Requirement or risk | Proposed evidence | Gap | Required revision |
| --- | --- | --- | --- |
| AC1/C1 三形态 + 全局位置 | `parse-vfsl-int-range.test.ts`：IR `toEqual` + `Object.keys`/`hasOwn` 条件键断言 + trivia 形态 | 无——断言观察公共接缝运行时输出（§12.0 纪律）；trivia 无关由 tokenizer 无注释记号构造保证 | 无 |
| AC2/C2 负例码 + 锚 | 同文件 A1-A12/B1-B14 钉码 + line/column + 负控组 | 无——只断码/锚/条数，不断言文案（与冻结面一致） | 无 |
| AC1/C3 derived | 字段名序/值叶形状/structure leaf/index 引用同一性/docs 空表/JSON 往返深度相等 | 无——JSON 往返哨兵杀 undefined 键（E2 对偶） | 无 |
| AC3/C4 validate | C4a-g 合法/失配/四值/全收集/写路径/联合矩阵 | 无——C4g `{v:true}` 为 `contradictsInner` 漏 case 的判别性用例（本评审对两模型分支形态源码级复核成立）；C4e 101 = 100 + 截断标记与 `emitIssue`/overflow 机制核算一致 | 无 |
| AC4/C5 指纹 | 既有钉值逐字节 + 新 fixture 稳定不钉值 + `generate --check` | 无 | 无 |
| C6a/C6b/C6c codegen 与投影 | 生成文本 + tsc `preEmitDiagnostics` 0 诊断（装置实存在于 `generate-number-literals.test.ts:22/:88/:126`）；投影透传深等 + 既有失败码；`pnpm typecheck` 14 工程 | 无 | 无 |
| C7 文档同 PR | spec 机检 22/22 + D2/D3/D5 保持绿 + 人工评审四例化/保留名 18 | 无——G8/G9 只扫「禁止」节表格，spec 编辑面不触及（机制核实） | 无 |
| AC5/C8 门禁 | 六件套 + 焦点红→绿 + 翻转用例绿 | 无——焦点文件实现前红（红在 parse 步 E100 @ `&`）由 HEAD 现状构造保证 | 无 |
| 突变敏感性 | SA6 §12.10 矩阵（19 类弱实现） | 覆盖设计所述全部杀死路径 | 无 |
| 测试入口真实性 | 新文件落 `packages/*/test/**/*.test.ts` include 面；CI 分片按磁盘枚举 | 无——`vitest.config.ts` 与 `ci-test-shard.mjs` 机制核实 | 无 |

## 13. Required revisions

无 BLOCKER / MAJOR finding。以下 MINOR 不阻断 approve：

| Finding ID | Severity | Evidence | Problem | Required change | Acceptance |
| --- | --- | --- | --- | --- | --- |
| N-1 | MINOR | 设计 §10.2「`Int`/`Range` 断言 **E100 @ (1,23)**」 vs 翻转目标文件实际脚手架 `validate-number-domain-narrowing.test.ts:422-426` 的 `type ROOT = { n: ${name} };`（name 记号实际列 18；(1,23) 是 SA6 C2 MODULE(FORM) 脚手架的列） | 翻转映射把两个脚手架的列号混用。语义规则「锚该记号」正确且与 SA6 C2/SA8 Required action 2 一致；错误方向为响亮红（断 23 实际 18 必红），无伪绿风险 | SA3 按实际脚手架锚 (1,18)，或改用 MODULE 脚手架锚 (1,23)——二者取一并在翻转 commit 说明；无需改设计文档本体 | 翻转后用例绿且锚=实际记号列；`int`/`range` E301 负控保持 |
| N-2 | MINOR | 设计 §8.1(d) 括注「`number` 非交叉残留 `&` 仍走 `dispatchContinuation` E100 @ `&`」 vs 同节伪代码在 number 分支内联 `throw CROSS_WHITELIST_MSG`（不经过 dispatchContinuation） | 机制描述与伪代码不一致。两者观察等价（同码 E100、同锚 `&`、同消息常量——与 string 分支 `:480` 内联先例一致），无行为差异 | 实现按伪代码（内联抛）即可；SA1 下次修订时把括注改为「内联抛（镜像 string 分支 :480），其余 primitive 的残留 `&` 才走 dispatchContinuation」 | 无（观察等价；C2 B8 负控锁定行为） |

## 14. Non-blocking observations

1. **O-1（单键手造 int 叶的失败形态）**：`{kind:'int', min:1}`（无 max）经 §8.4 级联第 4 步会全量过拒并渲染 `[1, undefined]`——安全方向（fail-closed、无伪 ok），文本层构造性不可达，但与仓内手造 IR 的 loud-throw 先例（`put()`/`guardMemberDocs`/`keyPatternOf`）风格不一致。建议 SA3/SA4 实现或复核时补一行注记（声明 fail-closed 或加 evaluate 内联守卫）；C3/C5 的 JSON 往返哨兵已覆盖可达面。
2. **O-2（§8.4 合并 case 的消息模板）**：`case 'int': case 'range':` 合并块中 `t.min`/`t.max` 对裸 int 为 `number | undefined`；'range' 维模板若被触达会渲染 `undefined`——由解析层双键不变量构造性不可达（设计 D2 已声明）。实现时可按 kind 拆分消息构造或加断言，非义务。
3. **O-3（裸用与 A5 消息措辞差异）**：(c) 的「裸 ${v} 脱离 number & ${v}… 语境」与 (d) A5 的「Range 脱离 number & Range<min, max> 语境」措辞略异——消息正文不进冻结面（B5/ADR 0021 决策 3），无契约影响；SA3 可统一为单模板。
4. **O-4（验收口径冗余）**：设计 §12 与 SA6 §12 C1-C8 的映射存在适度重复（映射表 + 契约细则双层）——这是流程要求的双层结构，非缺陷；SA3 应以 SA6 契约为细则权威、设计 §12 为映射权威，两处已核实无冲突。

---

## 附：本评审独立核验方法记录

- 全部 C-1~C-20 源码锚点逐条读源核对（行号在 HEAD `7b92af0` 全部命中）；
- 锚位列算术逐例手算（MODULE/B 系列 14 例）；
- `parseConstraintArgs` 伪代码对 A1-A5/A6/A7/A8/A10/A11/A12/B4/EOF/分隔畸形/嵌套闭括号 13 类输入走查；
- B6 两模型对 `{v:5}`/`{v:true}` 的输出对照 `validateUnion` 源码逐段推演；
- kind 接线位点穷尽盘点（四组 grep + 逐文件排除误配：`protocol-surface.ts` 为 `VfslTypedAccess` 子串误配、`derived.ts:62` 为 index 行 match 词表）；
- 测试面相交性独立 grep（`Int`/`Range`/小写/文案四组，packages/apps/domains/tests 全域）；
- 文档面：ADR 0020 决策 1/2/4/5/6/7/8/10 原文、ADR 0021 决策 1/2/3/6 原文、v1-spec 六个锚区、guide 两锚区、CONTEXT.md 词条、spec 机检 G4-G9 机制；
- fingerprint D2 标记/前缀/钉值三文件交叉核对。

SA2 未修改任何生产代码、测试、设计文档或 SA8 产物；未运行测试/服务；唯一写产物为本文件。

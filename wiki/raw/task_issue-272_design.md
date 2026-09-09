# 设计 — Issue #272 `@nomicore/vfsl` 公开 `resolveSchemaAtPath`（ADR-0016 解析语义实施票）

- 角色：SA1（mabf-sa1）· 阶段 design · 迭代 1（SA2-F1 修订版）
- 设计产物：`wiki/raw/task_issue-272_design.md`（本文件）
- Worktree：`/home/wangjian/nomicore-fix-issue-272`（branch `mabf/issue-272`，HEAD `a6b2a79`）
- 输入：任务简报 `wiki/raw/task_issue-272.md`、SA6 契约 `wiki/raw/task_issue-272_sa6_contract.md`（approve）、SA8 冲突报告 `wiki/raw/task_issue-272_conflict_report.md`（clear）、SA8 设计后复审 `wiki/raw/task_issue-272_conflict_recheck.md`（clear，迭代 0 三条复查理由已消解）、SA2 评审 `wiki/raw/task_issue-272_sa2_review.md`（reject：1 MAJOR SA2-F1 —— 本迭代的修订输入，逐条落实见 §15）。`task_issue-272_relevant_decisions.md` 不存在——SA8 冲突报告已含 ADR 全集（14 文件）盘点结论，本文以之替代并按需直接引用 ADR 原文。

---

## 1. 任务类型、目标与非目标

**任务类型：feature（公共接缝能力缺口）**——`@nomicore/vfsl` 缺少 ADR-0016 指派的读路径语义 schema 解析函数；本票是该 ADR「解析语义」节的忠实实施票。

**目标**

1. 新增公开同步纯函数 `resolveSchemaAtPath(derived, path)`，经 `packages/vfsl/src/index.ts` 导出：给定派生 schema 与读路径，返回路径终点的语义 schema 投影四件套（值语义子树 + 传递闭包别名表 + docs/aliasDocs 切片）。
2. 解析语义与写侧路径守卫 `drillStep`（validate-patch.ts L114–178）同构：同一路径在写守卫合法 ⟺ 在读投影可解析（ADR-0016 明文命题）。
3. 结果联合两枚失败码（`SCHEMA_PATH_NOT_FOUND` / `SCHEMA_PATH_INVALID`）+ path 新鲜副本回显；keyPattern 失配与 keyPattern 引擎四类错误（B15/D7）同走内容级 fail-closed `SCHEMA_PATH_NOT_FOUND`；可信域畸形（ref 目标缺失、值树引用环、两树分歧、derived 形状无效——清单见 §8.1/§9）以 `InternalError` throw 逃逸公共面，不进结果联合。
4. 逐条落实 SA6 已批准契约（34 运行时断言 + 3 类型断言 + 11 负控）并保持既有 560 vfsl 测试与 14 包 typecheck 零回归（AC4）；SA2-F1 修订面另以新增 Pattern 错误家族测试锚定（§12）。

**非目标（显式排除，依据 ADR-0016 §分层与兼容面 + SA8 冲突点 11）**

- 不实现 namespace-runtime 的 readData 组合（成功读 = 值 + 投影**深拷贝**、`schema: null` 三情形、`NamespaceRuntimeReadDataResult` 重定型）——后续组合票。
- 不动 `@nomicore/doc-runtime`（读取保持 schema 无关，`readLogicalValueAtPath` 签名语义不变）。
- 不动 `@nomicore/namespace-registry`（仅类型别名跟随，属组合票）。
- 不改派生 schema 冻结形状（derived.ts）、求值器（evaluate.ts）、写侧校验（validate-patch.ts 既有行为）、受限正则引擎（pattern.ts）。
- 不引入缓存/记忆化（ADR-0016「纯函数、零 memo」；按 schema generation 缓存属将来 profiling 驱动的加法演进）。
- 不修改 SA6 契约测试四文件（实现以它们为验收锚，不得反改契约）。
- 不为 keyPattern 拒绝细分失败原因（失配/引擎不可判定在结果联合中同形，D7）——细分需新失败码或 detail 字段，属破坏性加法，超出本票。

---

## 2. 当前行为与证据锚点（源码事实）

| # | 事实 | 锚点 |
|---|---|---|
| B1 | 公共入口无任何读投影导出；`resolveSchemaAtPath`/`ReadDataSchemaProjection`/`SCHEMA_PATH_*` 全仓源码零命中（仅 SA6 四枚契约测试文件出现） | `packages/vfsl/src/index.ts` 全文；grep 实证（SA6 §4、SA2 §1 同载独立复现） |
| B2 | 写侧路径守卫 `drillStep`：节点集（`Set<StructureNode>`，对象身份去重）逐段游走——map 精确字段优先、未中则 `'<key>'` 槽（**不验 Pattern**，注释明示「键 Pattern 属值级」）、array 收非负整数、union 静态全成员展开、ref 经透镜查表（缺失 throw `InternalError`）、leaf/plain/xml-fragment/root 终态拒下钻 | `packages/vfsl/src/validate-patch.ts` L114–178（`'<key>'` 放行 L136–144） |
| B3 | 写侧拒绝消息取序 `KIND_ORDER = leaf > plain > xml-fragment > array > map`；「路径段类型错误」（对象位 number 段 / 数组位非整数段）与「路径不存在」（终态/未知字段）两类文案 | validate-patch.ts L180–202 |
| B4 | 写侧崩溃边界先例：一切内部异常经顶层 `run()` 收编为单条 `VFSL-E100` issue（公共面不抛错） | validate-patch.ts L567–575；index.ts parseVfsl/evaluate 同款 |
| B5 | `InternalError` 类（`name='InternalError'`）与共享 ref 链解析核心 `walkRefChain`（环/缺失 → lens 错误，loud） | `packages/vfsl/src/resolve.ts` L26–31、L87–107 |
| B6 | `DerivedSchema` 冻结形状：`aliases`(结构树)/`structure`(root 包裹)/`values`(值树)/`index`(语法路径键空间)/文档三表 `aliasDocs`/`fieldDocs`/`markerDocs` | `packages/vfsl/src/derived.ts` L68–84（ADR-0003 冻结） |
| B7 | `ValueSchema` 种类全集：object(+`keyPattern?` 仅 Record 物化位)/array/xml/union(+`discriminator?`)/enum/pattern/scalar/optional(仅字段值位包装)/ref(按名) | derived.ts L44–53 |
| B8 | 两树不对称：结构侧 Record 值位**已解析物化**（解析点③），值侧 Record 值位仍 ref 终态；ref 链终点为无子终态（plain/leaf/xml-fragment）时结构侧内联、值侧仍 ref | `packages/vfsl/src/evaluate.ts` 文件头「两树不对称」+ L102–114、L282 |
| B9 | 值树游标先例 `descendValues`：单游标（非候选集）、optional 仅字段值位解包、两树分歧 → `InternalError`（经 run() 收编 E100） | validate-patch.ts L472–509 |
| B10 | 文档三表键文法（求值器 `walkDocs`，权威）：每别名锚定 `a.name` 起步；object 字段 `${path}.${f.name}`；union 成员 `${path}.<member ${i}>`（**0 基**）；array 元素 `${path}.<item>`；record 合成 `${path}.<key>`（恒空数组行，key/value 子树继续锚于此）；marker 就地 `appendDocs`（YArray/YPlainArray 实参入 `<item>`，YMap/YXmlFragment/YLeaf 实参同路径透明）；**ref 终态不穿越**（被引别名内部锚定在它自己名下） | evaluate.ts L356–401 |
| B11 | Record keyPattern 判定引擎：受限 NFA 引擎 `compile`/`match`（pattern.ts），`validateLogicalSnapshot` 逐键 `match(compiled, key, charge)` 判「Record 键 … 不满足 Pattern 正则」；keyPattern 字符串为解码后正则原文（如 `^[A-Za-z0-9_\-]{1,64}$`） | validate.ts L270–280；evaluate.ts L328–334；`matchPattern` 公共薄包装 index.ts L89–95 |
| B12 | derived 不可变契约：派生物对消费者不可变（v1 以 JSDoc 承载，不 Object.freeze）；`getCompiled` 缓存条目经 `deepFreeze` 深冻结 | derived.ts L9–13；index.ts L276–279、L376–389 |
| B13 | 验证入口：根 vitest include `packages/*/test/**/*.test.ts` + typecheck `**/*.test-d.ts`；vfsl 包 tsconfig 覆盖 `src` + `test`；根 `pnpm typecheck`/`pnpm test` | SA6 契约 §14；`packages/vfsl/tsconfig.json`；根 `package.json` |
| B14 | 包边界：「公共 API 仅经 src/index.ts」；「parser/evaluator/validators 同步确定性」；「公共畸形输入路径返回判别结果而非抛错」；稳定错误码/issue 序/path 回报为兼容行为 | `packages/vfsl/AGENTS.md`（Contract/Boundaries/Verification） |
| B15 | **keyPattern 引擎异常通道事实链（SA2-F1 依据，本设计迭代 1 核验）**：① parser 不校验正则合法性——PatternType 只要求字符串字面量实参，`合法性不在方言层校验（§9.1）`；② semantic/evaluate 对 regex **原文透传、零编译**（semantic.ts L230–231 `case 'pattern': return {kind:'pattern', regex: t.regex}`；evaluate.ts `keyPatternOf` L328–334 只 `resolveChain` 取原文）⇒ **evaluate ok 的合法派生物可携带不可编译/子集外/超限 keyPattern**；③ 引擎错误恰四类（pattern.ts L26–56）：`PatternCompileError`（文档例 `Pattern<"[">`）、`PatternUnsupportedError`（反向引用等子集外构造）、`PatternTooLargeError`（{n,m} 展开超 10_000 指令）为**编译期**（由派生物携带、与输入段无关）；`PatternBudgetExceeded` 为**运行期**（budget = `min(4_000_000, max(8_192, 1_024·len + 512·len² + 16_384))`，`len` = 输入串长度，pattern.ts L761–763——二次项在 `len ≥ 89` 时被 4M 绝对护栏截断）；④ 写侧在案处理：`validateKeyPattern`/`emitPatternError` 把**四类全部收敛为值级 issue**（「Pattern 正则无法编译…」等，validate.ts L256–280），仅「意外异常」走 `throw err` → E100 顶层崩溃（L265–266）；⑤ 结构侧 drillStep 放行 `'<key>'` 槽不验 Pattern，注释明示「键 Pattern 属值级，§3.3 规则 2」（validate-patch.ts L136–144） | parser.ts L456–472；semantic.ts L230–231；evaluate.ts L328–334；pattern.ts L26–56、L761–763；validate.ts L245–280；validate-patch.ts L136–144 |

SA6 契约四文件（红 34 断言 + 类型 3 + 负控 11，全部现存在 `packages/vfsl/test/`）逐条给出了目标行为的运行时锚；其中夹具（`resolve-schema-at-path-fixture.ts`）与期望字面量已由负控 C2 与真实求值器输出逐字对账。keyPattern 引擎错误族为契约**未锚定**自由度（SA6 §15 Q7 只锚 ref 缺失），通道由本设计钉死（D7）并新增测试锚定（§12）。

---

## 3. 能力缺口（无缺陷根因——feature）

| 层 | 事实 | 证据 | 置信 |
|---|---|---|---|
| 症状 | readData 成功分支无法获得路径语义 schema（ADR-0016 动机） | ADR-0016 §背景 | 高 |
| 直接缺口 | vfsl 无读投影解析函数与类型导出 | B1 全仓零命中（SA6 §4、SA2 §1 同载，运行时 + TS2305 双重实证） | 高 |
| 上游依据 | ADR-0016 把该能力明文指派给 `@nomicore/vfsl` 公开 API，解析语义 6 条为已接受决策 | ADR-0016 §解析语义/§投影体；SA8 clear | 高 |
| 写侧对偶 | `drillStep` 已冻结实现，构成同构基准 | B2/B3；SA6 负控 C3 实测（写合法 7 条 / 路径不存在 4 条 / 段类型错误 3 条与读侧码逐条映射） | 高 |
| 实现前提 | 文档三表键文法、ValueSchema 种类、InternalError 通道、受限正则引擎（含四类错误与写侧值级处理先例）均已在案 | B7/B10/B11/B15 | 高 |

---

## 4. Owner 要求落实

Issue comments 经 GitHub REST 读取为**空响应**（Host 简报 §Comments、SA6 §2、SA8 报告与复审四处一致；dispatch 亦确认 none）——无 owner 评论、无 override、无范围收敛指令需要并入。本设计的唯一需求源为 Issue 正文（= 任务简报「What to build」+ AC1–AC4）+ ADR-0016 + SA8 红线 + SA2 评审修订要求（§15）。

| Comment ID | Updated at | Requirement | Design section |
|---|---|---|---|
| —（无评论） | — | — | — |

---

## 5. 复现和根因承接

| 上游事实 | 证据位置 | 设计响应 |
|---|---|---|
| 能力缺口 = 接缝缺失：34/34 红测试同因（`index.ts` 无 `resolveSchemaAtPath` 导出），红灯原因真实 | SA6 §13 证据 1；`resolve-schema-at-path.test.ts` L70–86 动态接缝 | §8.1 公共导出面（值导出 + 两枚类型名目）按 ADR-0016 签名块落地 |
| 期望字面量全部经真实求值器对账（负控 C2 11/11 绿）；写侧对偶矩阵 C3a–C3e 实测成立 | `resolve-schema-at-path-control.test.ts` L104–223 | §8.3–§8.6 算法逐条以契约为验收锚；同构基准 = 复用 `drillStep` 本体（§7-D1） |
| 畸形派生物（删 values/aliases 双表目标）两态（游走中 / 终点闭包）必须 throw `InternalError` 且不进结果联合 | 红测试 L373–396；SA8 红线 1 | §8.2/§8.5：无顶层 catch；值游走 ref 解析与闭包解析缺失 → throw |
| 既有基线：SA6 证据 3——契约加入后 vfsl 全套 31 文件（30 `.test.ts` + 1 test-d）中 29 passed（**560 测试，已含负控 11**）+ 2 failed（红契约文件 + test-d TS2305 ×3）；其余 13 包 typecheck 绿；翻绿路径经同形状模拟模块验证 | SA6 §13 证据 3/4/5；SA2 §6 计数核对 | §12 验证映射含零回归门（终点计数已按 SA2-N2 更正）；实现不得触碰 src 既有行为（§11 DENY） |
| SA6 §15 设计决策请求 Q1–Q7（不阻塞契约，留 SA1 裁决） | SA6 §15 | §7 逐条裁决并写入算法；Q7 的引擎异常子项按 SA2-F1 修订（D7） |
| keyPattern 引擎四类错误在合法派生物上可达，写侧已有值级处理先例 | SA2 §8-E1/§13-SA2-F1；B15 事实链 | D7 通道重分类（throw → 内容级 fail-closed NOT_FOUND）+ §12 新增 Pattern 错误家族测试锚 |

**上游事实与源码矛盾检查**：迭代 0 未发现矛盾。迭代 1 修正一处**设计自身**与源码的矛盾（SA2-F1：迭代 0 D7 把引擎 throw 定性「畸形派生物」与 parser.ts L470 推迟校验、validate.ts L256–280 值级处理直接冲突）——已按 B15 事实链更正，不涉及上游产物与源码的新矛盾。

---

## 6. SA8 约束落实

| 决议或义务 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|
| 红线 1：InternalError 通道——ref 缺失必须 throw 逃逸公共面，不得 E100 式顶层 catch 收编、不得降级 NOT_FOUND；JSDoc 明示 derived 属可信域入参 | §8.2、§8.1 JSDoc 要求、§11（index.ts 导出块注释） | 函数体**零顶层 catch**；`InternalError` 直接穿透；JSDoc 划清「敌意公共输入（path）走判别联合 / 可信域（derived）畸形走 throw」边界。注意：keyPattern 引擎四类错误**不是**可信域畸形（合法派生物可携带，B15），走内容级 NOT_FOUND（D7）——与红线 1 无涉（红线 1 管的是 ref 缺失不得降级） | 否（ADR-0016 明文 + SA8 已裁） |
| 红线 2：深拷贝边界归属——vfsl 层返回子树「引用 vs 深拷贝」由 SA1 钉死并写入 JSDoc | §7-D5（Q5 裁决）、§8.1 JSDoc | 裁决：vfsl 层返回 derived 内部**引用**（B12 不可变契约 + getCompiled 深冻结条目下引用即安全）；detached 深拷贝归 namespace-runtime 组合票（ADR-0016 §交付纪律明文指派）；SA8 复查点 2/3 no-conflict；**深拷贝义务不得从组合票裁撤**（follow-up #1 硬约束传承） | 已消解（SA8 复查点 2/3 no-conflict；SA2-N4 确认义务传承） |
| 红线 3：同构不许分叉——不得按值收窄/依赖判别式缓存 | §8.3（复用 drillStep 本体）、§8.4（合成 union 无判别式） | 结构侧游走**逐字复用** `drillStep`（单源，不分叉）；全程不读 `discriminator` 键；红测试剥光判别式断言全等 | 否 |
| 红线 4：引用精确性——「ADR 0003 §3.3 规则 1」实为 issue #53 设计 §3.3，母法为 ADR-0003 §3 any-of | §2 B2、§8.3 | 实现注释引用 drillStep/ADR-0003 §3 时带出处限定词（「issue #53 §3.3 规则 1，母法 ADR-0003 §3」）；B2/B15 引用「键 Pattern 属值级」注释时同款标注（validate-patch.ts L137） | 否 |
| 红线 5：`packages/vfsl/AGENTS.md` normative 清单补 ADR-0016（及 0008 D8 修订节指引） | §11 ALLOW LIST 第 4 项 | 随实现补 normative 清单一行 + 在 Boundaries 为「可信域 derived 畸形 → throw」加显式例外句（文案已按 D7 修订：throw 清单不含 keyPattern 引擎错误） | 否（文档跟进，非阻塞） |
| ADR-0016 全部明文决策（签名块、两码、union any-member、keyPattern fail-closed、optional 透明展开/返回保留、ref 缺失 InternalError、三表同构切片、同步纯函数零 memo） | §7/§8 全文 | 逐条落地（§8.6 表逐路径对照契约断言） | 已消解（SA8 复审 12 项增量裁决 no-conflict） |
| 分层纪律：本票不触 doc-runtime/namespace-runtime/registry | §1 非目标、§11 DENY LIST | 明确排除 | 否 |
| ~~SA8 复审第 7 项原表述：「引擎不可编译属畸形派生物（可信域通道）……设计钉死于授权通道内」~~（**本迭代更正**） | §7-D7、§2-B15、§15 | SA8 复审第 7 项裁决为 no-conflict 且注明「ADR 未规定、设计钉死」——其对「畸形派生物」的定性**继承迭代 0 设计的错误事实前提**（SA2 §5/§13 指认，B15 证伪：parser L470 推迟合法性、写侧 validate.ts L256–280 值级处理）。本设计更正为：引擎四类错误为**合法派生物携带的不可判定 Pattern**，该 Record 候选无法接纳任何段 → fail-closed `SCHEMA_PATH_NOT_FOUND`（D7）。属设计级通道分类更正，非 ADR 决策覆盖——更正方向是向 ADR-0016「keyPattern 实测、不匹配即拒绝（fail-closed）」明文与简报「NOT_FOUND = 无任何候选接纳该段」定义收敛 | 否（SA2 结论重述预先裁决：fail-closed 方向「落在 ADR-0016 既有明文延长线上，不新增 ADR 冲突面」；详见 §14） |

---

## 7. 设计决策（含 SA6 §15 Q1–Q7 裁决）与主要备选方案

### D1（Q1）游走基准：**双游标 = 结构树定合法性 + 值树产投影**，结构侧逐字复用 `drillStep`

- **结构侧游走**：候选节点集 `Set<StructureNode>`（身份去重），逐段调用既有 `drillStep`（validate-patch.ts L114–178，经模块内导出复用，不经 index 公共面）。它决定每段的**合法性与失败分类**（终态拒绝、union 静态扩展、数组位、Record 槽）——这是写守卫的判定本体，复用即保证「写合法 ⟺ 读可解析」同构命题不因重写而漂移（SA8 红线 3）。
- **值侧游走**：镜像的候选集游走（`ValueSchema` 域），每段在结构侧放行后推进，职责有三：①携带**语法路径**（docs 切片寻址，§8.6）；②实施 **keyPattern 正则实测**（keyPattern 只存在于值树 object 节点，B7/B11；引擎四类错误在此按内容级结算，D7）；③产出**终点值候选集**（§8.4）。optional 在此透明展开（游走穿透、终点原样保留——optional 只出现在字段值位，B7）。
- **两树必要性论证**：两树在可下钻性上唯一系统性分歧是 YPlainArray——值位是 `array<T>`（值树会接纳整数段）、结构位是 `plain` 终态（写守卫拒下钻，B8）。契约锚定 `['attachments']` 整位 ok / `['attachments',0]` NOT_FOUND——**纯值树游走无法表达该拒绝**，纯结构游走无法产出值子树与 keyPattern 判定。双游标是同时满足同构命题与投影体的唯一路线。
- **否决备选**：(a) *纯值树游走 + 标记终态*——值树无 plain 语境标记，需把结构信息搬进值树（改冻结形状）或猜测，均违反 B6/B8；(b) *结构游走 + `descendValues` 取值*——descendValues 是单游标、归一化（剥 ref/optional）、单命中（首匹配即止），无法表达候选集、终点 ref/optional 保留与 keyPattern 实测（B9），仍需新写值游走，徒增一层。

### D2（Q2）docs/aliasDocs 切片算法（精确化 ADR 类别级描述）

切片 = 三类键的并集，在 `fieldDocs ∪ markerDocs` / `aliasDocs` 表上选取，**键不发明、内容逐字**：

1. **脊柱键**（沿 P）：值游走中每段命中的候选所携带的语法路径（§8.3）。语法路径生成规则与求值器 `walkDocs` 逐字同构（B10）：字段命中 → `${anchor}.${field}`；Record 键命中 → `${anchor}.<key>`；数组元素位 → `${anchor}.<item>`；union 成员穿越 → `${anchor}.<member ${i}>`（0 基）；**ref 解析穿越时锚名切换为该 ref 的名**（被引别名内部键锚定在它自己名下）。同一段多候选命中 → 多枚脊柱键（如 `['u','x']` → `U.<member 0>.x` 与 `U.<member 1>.x`）。
2. **终点子树后代键**（P 之下）：对终点每个候选的语法路径 `p`，取表中满足 `k === p || k.startsWith(p + '.')` 的键（含终点位自身——与 `['notes']` 命中 `ROOT.notes`、`[]` 命中 `markerDocs['ROOT']` 位的语义一致）。
3. **闭包别名内部键**（别名名锚定）：对闭包（§8.5）中每个别名 `a`，取表中满足 `k === a || k.startsWith(a + '.')` 的键——被引用别名的整个身体即终点子树经 ref 可达的部分。

- **合并规则**：`docs[k] = [...(fieldDocs[k] ?? []), ...(markerDocs[k] ?? [])]`（field 在前 marker 在后——契约 ⊆ 不变量断言的拼接序，validate.ts 同键无双重声明下序不敏感）。
- **空条目过滤**：合并后内容为空（`length === 0`）的键**不进切片**。理由：投影目的是携带注释语义，空行是零信息噪声，且能把每次读的 docs 载荷从 O(全表键数) 收敛到 O(非空注释位)（ADR-0016 对每读成本有明文预算意识）；「哪些位置存在」由 valueSchema 本身表达。SA6 契约显式不锁此项（`nonEmpty` 过滤器 + fixture 注释），两种选择均绿。
- **aliasDocs 切片**：闭包别名 `a` → `aliasDocs[a]`（存在则浅拷贝 `[...arr]`）。
- **否决备选**：(a) *walkDocs 再生键空间*（在值游走中重造全部键）——重复实现 B10 文法、与表内容漂移风险更高；表扫描 + 前缀匹配以表为事实源，简单且键域有界。(b) *保留空条目*——见上，噪声与载荷成本，否决。

### D3（Q3）ROOT 别名级注释：**不含**（除非 ROOT 自身进入被引用闭包）

aliasDocs 切片仅含**闭包别名**。ROOT 是根命名空间而非被 valueSchema 引用到的别名——ADR-0016 三类别（脊柱/终点子树后代/闭包别名内部）中 ROOT 别名级行不属任何一类；ROOT 子树的字段级注释已由类别 1/2 覆盖。规则对「endpoint 为 `ref ROOT`」的（语法上可能的）派生同样统一适用（此时 ROOT 入闭包，其别名级注释随之入选）。夹具 ROOT 别名级无注释（负控 C2 锚定），本裁决在契约两种取向下均绿。

### D4（Q4）合成 union 成员顺序：**候选发现序**（确定性 DFS 声明序）

值游走候选按发现顺序收集：候选迭代按集合插入序，展开按字段声明序、union 成员声明序（0 基）；对象身份去重（镜像 `drillStep` 的 `Set` 语义；同身份多路径时首见路径胜出，但脊柱键仍全量收集——§8.6 类别 1）。纯函数 + 确定输入 ⇒ 同输入同序。契约以多集断言（`expectSameSchemaMembers`）不锁序，本裁决给出实现可依赖的确定序。

### D5（Q5）返回子树归属：**vfsl 层返回 derived 内部引用**；容器/合成节点/切片数组/失败 path 为每次调用新鲜对象

- `valueSchema`（单候选）与 `aliases[a]` 为 derived 节点**原样引用**（含其在场的 `discriminator` 缓存——见 D6）；合成 union 节点、投影容器（五键对象）、`docs`/`aliasDocs` 条目数组、失败分支 `path` 副本为逐调用新建。
- 依据：ADR-0016 §交付纪律把「公共面只暴露 detached 投影」明文指派给 **namespace-runtime 边界**（组合票）——vfsl 层纯解析器返回引用正是该分层的实施前提（SA8 冲突点 2 同载）；derived 不可变契约（B12）+ `getCompiled` 深冻结条目使引用安全；SA8 红线 2 建议的裁决依据（「derived 不可变契约 + 深冻结条目下引用即安全」）即此。
- JSDoc 必须写明：返回的 `valueSchema`/`aliases` 与调用方 `derived` 共享节点，消费者不得变异；detached 深拷贝由 namespace-runtime 组合层负责。
- **否决备选**：vfsl 层逐调用深拷贝子树——成本 O(schema 子树) 落在错误层（组合层读热路径反正要再拷一次或直接消费），且 ADR 已定层级归属；保留为「若 Host 裁决要求 belt-and-braces」的加法备选（契约内容相等断言下两种均绿，切换不改签名与码域）。

### D6（Q6）判别式缓存：**真实节点原样保留（含 discriminator）；合成 union 恒无**

终点单候选与闭包别名体为 derived 原样引用，其自带 `discriminator`（若在场）原样透传——「切片不发明、不删改」。仅 §8.4 的**合成** union 节点恒为 `{kind:'union', members}` 两键（红测试断言 `Object.keys(node) === ['kind','members']`——kind 在前 members 在后）。解析全程不读 `discriminator`（剥光断言锚定，ADR-0003 §3 透明性）。

### D7（Q7）可信域 throw 集 + keyPattern 引擎错误通道（SA2-F1 修订核心）

本决策分两部分：**(a)** 两树分歧仍 throw `InternalError`（触发面收窄）；**(b)** keyPattern 引擎四类错误**不属**可信域畸形，按内容级 fail-closed 收敛 `SCHEMA_PATH_NOT_FOUND`。

#### (a) 两树分歧（结构侧放行而值侧零候选且无任何 keyPattern 拒绝标记）：**throw `InternalError`**

- 求值器按同一 IR 同步产出两树（B8），分歧只可能来自手造/篡改派生物；`descendValues` 对同类情形的先例即 `InternalError`（B9），只是写侧经 E100 收编而本函数按 ADR-0016 直通 throw（红线 1 禁止收编）。
- **keyPattern 拒绝标记**（失配或引擎错误，见 (b)）在场的空候选**不算分歧**——它是值侧的合法内容级拒绝。因此 D7-throw 的触发面 = 结构侧经 `'<key>'` 槽或精确字段放行、值侧零候选、且**未经过任何 Record keyPattern 判定路径**——即真正的手造/篡改两树分歧（SA2 §8-E3 独立核对：合法派生物的系统性分歧均被双游标吸收）。
- 派生输入非对象（null/undefined 等，信任违约）→ `InternalError`（显式守卫，消息指明 derived 形状无效）；path 是敌意通道 → 判别联合（§8.2）。

#### (b) keyPattern 引擎四类错误：**内容级 fail-closed → `SCHEMA_PATH_NOT_FOUND`**（修订迭代 0 的「包装 InternalError」裁决）

**可达性事实（B15）**：parser 显式推迟正则合法性到使用时暴露（parser.ts L470「合法性不在方言层校验（§9.1）」），semantic/evaluate 原文透传零编译——**evaluate ok 的合法派生物可携带不可编译/子集外/超限 keyPattern**。迭代 0 把引擎 throw 定性「畸形派生物（可信域）」与该事实链直接矛盾（SA2-F1），本迭代更正。

**分类表（每类显式处置与可达性）**：

| 引擎错误类 | 相位 | 携带者/触发者 | 可达性事实 | 读侧通道 | 写侧对偶锚点 |
|---|---|---|---|---|---|
| `PatternCompileError`（例 `Pattern<"[">`） | 编译期 | 派生物携带（keyPattern 源文本），与输入段无关 | parser L461–465 只收字符串字面量；pattern.ts L26–32 文档例自证源文本可达 | **内容级拒绝 → NOT_FOUND** | validate.ts L257–258 值级 issue |
| `PatternUnsupportedError`（反向引用等子集外构造） | 编译期 | 同上 | pattern.ts L34–40 文档例（`\1`~`\9` 等）源文本可达 | 同上 | validate.ts L259–260 值级 issue |
| `PatternTooLargeError`（{n,m} 展开超 10_000 指令） | 编译期 | 同上 | pattern.ts L42–48 文档例源文本可达 | 同上 | validate.ts L261–262 值级 issue |
| `PatternBudgetExceeded`（步数预算耗尽） | 运行期 | 可编译程序 + **长输入段**（budget = f(len)，pattern.ts L761–763） | 见下述可达性论证——不可证不可达 | **内容级拒绝 → NOT_FOUND**（与失配同通道） | validate.ts L263–264 值级 issue |

**裁决理由（编译期三类）**：

1. **可信域前提**：该类派生物是 evaluate ok 的合法产物（B15①②），对它 throw 违反本函数自己的 JSDoc 可信域契约陈述（§8.1）。
2. **写读同构（⟺ 命题）**：写侧对同派生物同键写入经 `validateKeyPattern`→`emitPatternError` 收敛为**值级 issue 拒绝**（validate.ts L256–262，非 E100；负控 C3e 锚定的「Record 键不满足 Pattern 正则」家族）；读侧 throw 将使「写守卫按值级处理 ⟹ 读投影崩溃」破坏同构。结构侧 drillStep 放行 `'<key>'` 槽不验 Pattern 且注释明示「键 Pattern 属值级」（validate-patch.ts L136–144）——值级分类是写侧在案先例。
3. **语义归属**：编译失败与段内容无关 ⇒ 该 Record 候选**无法接纳任何段** ⇒ 恰是简报对 `SCHEMA_PATH_NOT_FOUND` 的定义（「无任何候选接纳该段」）——与 ADR-0016「keyPattern 实测、不匹配即拒绝（fail-closed）」同族（SA2 推荐裁决，落在该明文延长线上）。
4. **认识论一致性**：编译失败 = 「无法在既有引擎内确立该键被接纳」；缺失接纳证明 = fail-closed 拒绝该段，既不冒充「确定不匹配」、也不上升为可信域崩溃。

**裁决理由（`PatternBudgetExceeded` 同走 fail-closed，不保留 InternalError）**：SA2 允许保留 throw 的前提是给出「可编译程序 + 任意敌意段长不可触发」的依据（R3 形状对齐定理）；该依据**不可得**：

1. **R3 定理被 4M 绝对护栏截断**：budget = `min(4_000_000, max(8_192, 1_024·len + 512·len² + 16_384))`（pattern.ts L761–763）。二次项在 `len ≥ 89` 时已超 4M 被截断——「线性项覆盖 T1、二次项覆盖 T2」的形状对齐保证只在截断前成立，对任意长敌意段不闭合。
2. **模拟步数上界可达护栏量级**：宽度优先子集模拟单匹配步数为 O(len × |prog|)（每轮消费一个输入字符、活跃闭包 ≤ |prog|；`|prog| ≤ MAX_PROGRAM_SIZE = 10_000`）。数百字符段 × 近限程序即可逼近 4M 护栏 ⇒ 「可编译程序 + 敌意长段」原理上可触发。
3. **段长是敌意通道控制的**：path 是本函数申报的敌意输入（§8.2），`'a'.repeat(10_000)` 级别段无需特权；pattern 由 schema 作者控制。引擎文件头把预算定位为「规模护栏」、耗尽 → loud fail-closed（pattern.ts L13–15）——它被设计为**可达的护栏**，不是断言不可达的内部不变量。
4. **写侧对偶**：validate.ts `emitPatternError` 把 `PatternBudgetExceeded` 与编译期三类**并列**收敛为值级 issue（L263–264），并把「意外异常」另行 `throw` 进 E100（L265–266）——四类在写侧的被申报身份就是「预期内的值级失败」。读侧若对 BudgetExceeded throw，同派生物同段上 ⟺ 命题同样破坏。

**实现形态（§8.3 落点）**：值侧 object 匹配的 Record 槽判定以单层 try/catch 包裹 `compile`+`match`，`instanceof` 精确识别四类（镜像 emitPatternError 的分支形状）→ 一律记**本候选 keyPattern 拒绝（内容级，不入 out）**，与失配同标记、结果联合不细分拒绝原因；四类之外的意外异常包装 `new InternalError`（detail 透传）上抛——这是 validate.ts「意外异常 → 顶层崩溃通道」在本函数无顶层 catch 约束下的忠实翻译，保持「本函数 throw 的只有 `InternalError`」通道纯度。

**否决备选**：

- (a) *维持迭代 0 裁决（引擎 throw → 包装 InternalError）*——事实性错误（B15 证伪「畸形派生物」前提），三重违约（SA2-F1：违反自身 JSDoc 可信域陈述 / 破坏写读同构 / 向 ADR-0016 组合面 `schema:null` 两码吸收面塞入未申报异常通道）。否决。
- (b) *编译期三类 fail-closed、BudgetExceeded 保留 InternalError*——需援引 R3 论证不可触发，如上四点论证不可得（截断 + 步数上界 + 敌意段长 + 写侧值级先例）；且同函数内「同类引擎错误两通道」增加分类器复杂度与文档负担。否决。
- (c) *新增第三失败码（如 `SCHEMA_PATTERN_UNDECIDABLE`）细分不可判定家族*——超出简报两码联合与 ADR-0016 签名块（test-d 锁定两码判别联合），属破坏性公共面变更且无消费者需求；结果联合对失败细分的需求留待 profiling/消费者反馈（§13 残余）。否决。

### D8 失败分类规则：**形状级 vs 内容级**（对契约锚定例的统一泛化）

`out` 为空时（无任何候选接纳该段）：

- **`SCHEMA_PATH_INVALID`（野段形状）**：当且仅当每个被尝试的候选形态都在**形状层**拒绝该段——即候选形态集中**既无**「object/map 形态 + string 段」也**无**「array 形态 + 非负整数段」的可行组合，且无终态形态在场。对象位 number 段、数组位 string 段、数组位负数/非整数段属此类。
- **`SCHEMA_PATH_NOT_FOUND`（无候选接纳）**：任一候选属**内容级**拒绝——终态形态（leaf/plain/xml-fragment，含 optional 透明展开后的标量）、object+string 段未中字段、**Record keyPattern 失配或引擎不可判定（四类，D7）**、union 全体成员无该字段。

| 契约锚定例 | 形态集 | 段 | 分类 |
|---|---|---|---|
| `[0]` | {map} | number | INVALID ✓ |
| `['keywords','0']` / `['keywords',-1]` | {array} | string / 负数 | INVALID ✓ |
| `['nope']` | {map} | string 未中 | NOT_FOUND ✓ |
| `['u','z']` | {map,map} | string 全未中 | NOT_FOUND ✓ |
| `['notes','x']` | {leaf}（optional 展开后） | string | NOT_FOUND（终态）✓ |
| `['attachments',0]` | {plain} | 整数 | NOT_FOUND（YPlainArray 终态同构位）✓ |
| `['assets','bad key!']` | {map(Record)} | string，keyPattern 失配 | NOT_FOUND ✓ |
| `['assets',7]` | {map(Record)} | number | INVALID ✓ |
| （设计钉定，非契约锚）`['r','k']`，r 为 `Record<string & Pattern<"[">, T>` | {map(Record)} | string，keyPattern 编译失败 | NOT_FOUND（引擎错误内容级，D7）|
| （设计钉定，非契约锚）`['r',7]`，同上夹具 | {map(Record)} | number | INVALID（引擎错误不污染形状分类）|

- 引擎错误只可能产生于「object + string 段 + 精确字段未中 + `'<key>'` 槽在场」的内容级判定路径（§8.3），**不可能**把 INVALID 例翻成 NOT_FOUND——形状分类先于且独立于 keyPattern 判定。
- 与写侧关系：分类与写侧「路径段类型错误 / 路径不存在」两类文案在全部锚定例上同构（负控 C3b/C3c 实测映射）；**合法性**判定（⟺ 命题）由 drillStep 复用结构性保证，失败码只是合法性的两分类投影。
- **否决备选**：逐字镜像 `KIND_ORDER` 取序做分类（`{map,array}` 混合形态且 map 未中字段时按序会报「数组位需要 number 段」→ INVALID）。否决：混合形态下把「字段不存在」误报为「段形状错误」，与简报两码定义（「无任何候选接纳」vs「野段形状」）相悖；本规则在契约锚定的全部单形态例上与 KIND_ORDER 结果一致，仅在契约未锁的混合形态例上更诚实地归属（SA2-N1 复核维持）。

### D9 模块落位：新文件 + 既有文件最小内部导出

- 新模块 `packages/vfsl/src/resolve-schema-at-path.ts`：公共类型（`ReadDataSchemaProjection`、`ResolveSchemaAtPathResult`）+ `resolveSchemaAtPath` + 私有助手（值侧步进/语法路径候选、闭包收集器、docs 切片器、失败分类器）。
- `validate-patch.ts` 仅**新增模块级导出** `drillStep`/`DrillResult`/`structureLens` 供包内复用（不进 index.ts，非公共 API——沿 resolve.ts→validate-patch.ts、validate.ts→validate-patch.ts 的包内消费先例），零行为改动。
- 值侧 ref 解析不新造 while 链算法（resolve.ts「全仓 while 循环算法恰一份」纪律）：按 `drillStep.expand`（L164–174）先例，在候选展开内部逐跳解析（own 守卫查表 + 名字 in-flight 集合，环 → `InternalError`「值树引用环: …」文案对齐 valueLens），同时完成锚名切换（D2 类别 1）。in-flight 集合作用域 = **单次候选规范化**（候选展开内部逐跳）——合法递归别名深路径不误报环（SA8 复审观察 3、SA2-N6 实现纪律）。
- **否决备选**：把解析器并入 validate-patch.ts（千行文件继续膨胀、读写职责混杂）或 resolve.ts（该文件是求值期共享解析器，职责不符）——均否决。

---

## 8. 接口、算法与数据流

### 8.1 公共签名与类型（ADR-0016 签名块逐字锚定；test-d 三断言的锁定面）

```ts
// packages/vfsl/src/resolve-schema-at-path.ts

/** 读路径语义 schema 投影体（ADR-0016「投影体」四件套）。 */
export interface ReadDataSchemaProjection {
  /** 路径终点的值语义子树（ref 按名保留，不内联展开——ADR 0003 §4 同款纪律）。 */
  readonly valueSchema: ValueSchema;
  /** 传递闭包内被 valueSchema 引用到的别名（自包含、递归安全、JSON 可序列化）。 */
  readonly aliases: Record<string, ValueSchema>;
  /** fieldDocs/markerDocs 的相关切片：脊柱、终端子树后代、闭包别名内部的注释。 */
  readonly docs: Record<string, readonly string[]>;
  /** aliasDocs 的相关切片（按别名名）。 */
  readonly aliasDocs: Record<string, readonly string[]>;
}

export type ResolveSchemaAtPathResult =
  | ({ readonly ok: true } & ReadDataSchemaProjection)
  | {
      ok: false;
      code: 'SCHEMA_PATH_NOT_FOUND' | 'SCHEMA_PATH_INVALID';
      /** 调用方数组的新鲜副本（AC1）。 */
      path: Array<string | number>;
    };

export function resolveSchemaAtPath(
  derived: DerivedSchema,
  path: readonly (string | number)[],
): ResolveSchemaAtPathResult;
```

- 运行时 ok 分支**恰五键** `{ok, valueSchema, aliases, docs, aliasDocs}`（红测试 `Object.keys` 断言）；构造点以字面量五键组装。
- `path` 参数类型必须恰为 `readonly (string | number)[]`（test-d `parameter(1).toEqualTypeOf` 精确匹配）；失败回显 `path` 为可变数组（`toBeArray` + 新鲜副本）。
- **JSDoc（红线 1/2 落点，必写；SA2-F1 修订后口径）**：同步、纯函数、零 memo（无跨调用状态）；`derived` 属**可信域入参**（求值器 ok 产物契约）——**可信域 throw 清单**：ref 目标缺失（游走中/终点闭包）、值树引用环、结构/值两树分歧、derived 非对象或根缺失、引擎意外异常（keyPattern 判定中四类之外的异常，包装 `InternalError`）；上列情形沿 validate-patch 先例 **throw `InternalError`**，不进结果联合、不降级失败码，故本函数无顶层 catch（与包内「敌意公共输入走判别联合」边界并列的显式例外）。**keyPattern 引擎错误（`PatternCompileError`/`PatternUnsupportedError`/`PatternTooLargeError`/`PatternBudgetExceeded`）不属可信域 throw**——合法派生物可携带不可判定 Pattern（parser §9.1 推迟合法性校验），四类按内容级 fail-closed 收敛 `SCHEMA_PATH_NOT_FOUND`（与写侧 validate.ts L256–280 值级处理对偶）。`path` 属敌意通道，形状违约经结果联合 `SCHEMA_PATH_INVALID` 结算；返回 `valueSchema`/`aliases` 与 `derived` 共享节点（不可变契约），detached 深拷贝属 namespace-runtime 组合边界；解析与实际值/判别式缓存无关。

### 8.2 入口规整（顺序即语义）

1. **path 形状守卫**（先于一切 derived 访问——敌意通道优先结算）：`!Array.isArray(path)` → `{ok:false, code:'SCHEMA_PATH_INVALID', path: []}`（无调用方数组可拷，回显新鲜空数组）；任一段非 `string|number` → `{ok:false, code:'SCHEMA_PATH_INVALID', path: [...path]}`（新鲜副本，含野段原样）。
2. **derived 形状守卫**（可信域）：`derived` 非对象/null → `throw new InternalError('…derived 无效（可信域契约：须为 evaluate ok 产物）')`。
3. **结构树根守卫**：`derived.structure.kind !== 'root'` → `InternalError`（guardWalk L311–313 同款文案先例）。
4. **值树根守卫**：`!Object.hasOwn(values,'ROOT')` → `InternalError`（descendValues L475 同款）。
5. 初始化：结构候选集 `S = {walkRefChain(derived.structure.node, structureLens(derived.aliases))}`（guardWalk L316 同款，环/缺失 → InternalError）；值候选集 `V = [{node: values['ROOT'], path: 'ROOT'}]`（有序、身份去重）。

### 8.3 双游标逐段游走（对每段 i，顺序固定）

**第 1 步——结构侧（合法性 + 分类信息）**：`drill = drillStep(S, seg, structureLens(derived.aliases))`。

- `drill.out.size === 0` → 按第 i 段的尝试形态集分类（D8）返回 `SCHEMA_PATH_INVALID` 或 `SCHEMA_PATH_NOT_FOUND`（path = `[...path]` 全量新鲜副本——契约锚定例均回显完整路径）。
- 结构侧 expand 中 ref 缺失（`aliases` 表）→ `InternalError` 透传（drillStep L169 先例）。

**第 2 步——值侧（投影推进）**：对 `V` 中每个候选（按插入序）做**规范化**后匹配：

- 规范化（镜像 drillStep.expand 的逐跳式；in-flight 作用域 = 单次候选规范化，D9）：`optional` → 解包（语法路径不变，仅字段值位可能出现，B7）；`ref` → 查 `values` 表（`Object.hasOwn` 守卫）缺失 → `InternalError`「值树未声明别名: …」；名字 in-flight 集合防环 → 环 → `InternalError`「值树引用环: …」；**锚名切换**为该 ref 名（语法路径 ← 名字）后递归规范化。
- 匹配（镜像 drillStep.matchNode 的值域对应）：
  - `object`：段须 string（否则本候选形态记 {object}，拒绝）；先精确字段（声明序，命中即收其 `value` 为出候选，语法路径 `+ '.' + name`）；未中且存在 `'<key>'` 字段 → 若 `keyPattern !== undefined`：以单层 try/catch 包裹 `compile(keyPattern)` + `match(compiled, seg, () => {})`（charge 注入 no-op：本函数无全局工作预算；引擎内部步数预算独立于 charge，pattern.ts L761–773）——
    - `match` 返回 false → 本候选记 **keyPattern 拒绝**（不入 out）；
    - catch 到四类引擎错误之一（`instanceof PatternCompileError | PatternUnsupportedError | PatternTooLargeError | PatternBudgetExceeded`，镜像 validate.ts emitPatternError 的分支形状）→ 同记 **keyPattern 拒绝（内容级）**——与失配同标记、同通道（D7），不 throw、不细分原因；
    - catch 到四类之外的异常 → 包装 `new InternalError`（detail 透传）上抛（D7「意外异常」通道）；
    - `match` 返回 true → 收 `'<key>'` 槽值，语法路径 `+ '.<key>'`；
    - 无 `keyPattern` → 直接收 `'<key>'` 槽值。
    正则编译产物按正则串在**每调用局部** Map 缓存**成功产物**（镜像 validate.ts `compileOrCache` L247–254——失败不缓存，同调用内再次触达确定性重抛/重拒）。
  - `array`：段为 `number && Number.isInteger(seg) && seg >= 0` → 收 `element`，语法路径 `+ '.<item>'`（**无越界概念**——读侧无 base，负控 C3d 锚定）；否则记形态 {array} 拒绝。
  - `union`：全成员展开（成员 i 语法路径 `+ '.<member ' + i + '>'`，0 基，B10），「任一成员出现即存在」（ADR-0003 §3）。
  - `enum/pattern/scalar/xml`：终态，无匹配（记形态终态）。
- 出候选收集：有序列表 + `Set<ValueSchema>` 身份去重（D4）；**脊柱键**：每个命中候选的语法路径计入集合（多命中全收）。
- **出候选为空**：存在 keyPattern 拒绝标记（失配或引擎四类错误）→ `SCHEMA_PATH_NOT_FOUND`（fail-closed，path 新鲜副本）；否则 → 两树分歧 `InternalError`（D7(a)）。
- 推进 `S = drill.out`、`V = 值出候选`。

**循环结束（含空路径 `[]`）** → 终点合成（§8.4）→ 闭包（§8.5）→ 切片（§8.6）→ 返回五键投影。

### 8.4 终点合成

- `|V| === 1` → `valueSchema = V[0].node` **原样**（optional/ref/union 包装与在场 discriminator 全保留——`['notes']`→optional(scalar)、`['config']`→optional(object)、`['assets','img1']`→ref AssetEntity、`['u']`→ref U、`['assets']`→Record object（`'<key>'` 槽 + keyPattern 原文）、`['attachments']`→array<string>、`['keywords',2]`→scalar string（无越界））。
- `|V| > 1` → `valueSchema = {kind:'union', members: V.map(c => c.node)}`：**新建合成节点**，恰两键且 `kind` 在前（红测试 `Object.keys` 断言），**恒无 discriminator**（D6），成员序 = 发现序（D4）；身份去重仅按对象身份（两枚同内容不同对象的 ref 各占一席——镜像 drillStep Set 语义，确定性，边缘行为已记录 §13）。

### 8.5 别名传递闭包

- 输入：`valueSchema`（合成或原样）。深度优先遍历：`object`→各字段值；`array`→element；`union`→members；`optional`→value；`ref`→记名 `n`，`Object.hasOwn(values,n)` 为假 → `InternalError`（**终点 ref 缺失锚定**：`['audit']` 删 Audit 双表 → throw，红测试第二枚）；已访问名集合去重（递归别名 → 单名闭包、终止、JSON 可序列化，红测试锚定）；其余种类终止。
- 输出：`aliases[n] = values[n]` **原样引用**（含在场 discriminator，D5/D6），插入序 = 发现序（确定性；契约排序断言在测试侧排序后比较）。

### 8.6 docs/aliasDocs 切片（D2/D3 落地）

- 选键：脊柱键集合 ∪ {k ∈ 表：∃ 终点候选路径 p 使 `k === p || k.startsWith(p + '.')`} ∪ {k ∈ 表：∃ 闭包别名 a 使 `k === a || k.startsWith(a + '.')`}；`aliasDocs` 仅闭包别名。
- 内容：`docs[k] = [...(fieldDocs[k] ?? []), ...(markerDocs[k] ?? [])]`；合并为空则不入选（空条目过滤）；`aliasDocs[a] = [...derived.aliasDocs[a]]`（浅拷贝）。键序 = 表声明序扫描（`Object.keys(fieldDocs)` 后 `Object.keys(markerDocs)` 去重并入），逐调用确定。
- 前缀匹配安全性：语法段（标识符、`'<key>'`/`'<item>'`/`'<member N>'`）均不含 `.`，`p + '.'` 前缀无假阳（`'ROOT.a'` vs `'ROOT.abc'` 不串）。

**逐路径对照表**（契约断言 ↔ 本算法产出，全部人工推演核对；SA2 §6 独立推演复核全等）：

| 读路径 | valueSchema | aliases 闭包 | docs 非空切片 | aliasDocs 非空 |
|---|---|---|---|---|
| `[]` | VALUE_ROOT 整树（optional/Record 原样） | {AssetEntity, Audit, U} | ROOT.audit/notes/keywords/config + Audit.createdBy | {Audit, AssetEntity} |
| `['notes']` | optional(scalar string) | {} | {ROOT.notes} | {} |
| `['audit']` | ref Audit | {Audit} | {ROOT.audit, Audit.createdBy} | {Audit} |
| `['audit','createdBy']` | scalar string | {} | {ROOT.audit, Audit.createdBy} | {} |
| `['u','x']` | 合成 union{scalar string, array<number>}（两键） | {} | {} | {} |
| `['u','z']` | — NOT_FOUND | — | — | — |
| `['assets']` | Record object（`'<key>'`+keyPattern 原文） | {AssetEntity, Audit} | —（契约未锚定精确键集；按规则 = {Audit.createdBy}，脊柱键 ROOT.assets/ROOT.assets.\<key\> 均为空被过滤） | {Audit, AssetEntity} |
| `['assets','img1']` | ref AssetEntity | {AssetEntity, Audit} | —（仅 ⊆ 不变量锚定） | — |
| `['assets','img1','url']` | scalar string | {}（长度 0 锚定） | — | — |
| `['assets','bad key!']` | — NOT_FOUND（keyPattern fail-closed） | — | — | — |
| `['config']` | optional(object{retries}) | {} | — | — |
| `['config','retries']` | scalar number（透明展开） | {} | — | — |
| `['keywords',0]` / `['keywords',2]` | scalar string（无越界概念） | {} | — | — |
| `['keywords','0']` / `['keywords',-1]` | — INVALID（形状守卫） | — | — | — |
| `[0]` / `['assets',7]` | — INVALID | — | — | — |
| `['attachments']` | array<string> | {} | — | — |
| `['attachments',0]` | — NOT_FOUND（plain 终态同构位） | — | — | — |
| `['nope']` | — NOT_FOUND | — | — | — |
| 删双表 AssetEntity，读 `['assets','img1','url']` | **throw InternalError**（值侧解析点） | — | — | — |
| 删双表 Audit，读 `['audit']` | **throw InternalError**（闭包解析点） | — | — | — |
| （设计钉定，新增测试锚）`['r','k']`，r 为 `Record<string & Pattern<"[">, T>` 夹具 | — NOT_FOUND（编译失败内容级拒绝，D7；**不 throw**） | — | — | — |
| （设计钉定，新增测试锚）`['r',7]`，同上夹具 | — INVALID（形状层先行，不受 keyPattern 影响） | — | — | — |

### 8.7 数据流路线

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
|---|---|---|---|---|---|---|---|---|
| R1 解析主路径（纯内存，无持久化/网络） | 调用方传入 `derived`（不可变）+ `path` | 无任何写入（零突变：不修改 derived/path；无模块状态） | path 形状守卫 → 双游标逐段（结构合法性 → 值推进+语法路径+keyPattern 实测（失配与引擎四类错误同走内容级拒绝，D7））→ 终点合成 → 闭包 → 三表切片 | 无（进程内返回值） | 投影五键对象（valueSchema/aliases 为 derived 引用；docs/aliasDocs/容器/失败 path 为新鲜对象） | ok:true 投影 / 两码失败（引擎不可判定并入 NOT_FOUND）/ InternalError throw（仅 D7(a)+意外异常清单） | 无需清理（无资源分配）；失败即返回或 throw，无部分状态逃逸 | 红测试 34 断言逐条 + 新增 Pattern 错误家族测试（§12） |
| R2（未来组合，非本票）namespace-runtime readData | readData(path) 调用 | runtime 层新建 detached 深拷贝 | `readLogicalValueAtPath` 值 + `resolveSchemaAtPath` 投影深拷贝（ADR-0016 §分层） | NamespaceLease 公共面 | `schema: ReadDataSchemaProjection \| null` | 「读 = 值 + 语义」 | `schema:null` 三情形不分类（两码吸收面完整——本设计不产生两码之外的 throw 通道，SA2 §9 组合面担忧已随 D7 修订消除） | ADR-0016（组合票验收） |

本票不改变任何运行时数据创建/写入/存储/传输路径（R1 为新增纯读取投影；R2 属后续票）。

---

## 9. 错误、恢复、并发与幂等

- **错误通道三分**（互斥、全覆盖）：①path 敌意通道 + 值内容级拒绝 → 判别联合（INVALID / NOT_FOUND——后者含 keyPattern 失配**与引擎四类不可判定错误**，均 path 新鲜副本，AC1）；②derived 可信域畸形 + 引擎意外异常 → `InternalError` throw（ref 缺失/值树引用环、两树分歧、root/ROOT 缺失、derived 非对象、keyPattern 判定中四类之外的意外异常），**无顶层 catch**、不降级（红线 1）；③正常解析 → ok 投影。不存在静默 fallback：可选路径缺席不特殊化（schema 是路径键控，ADR-0016），null/undefined 段属①；引擎不可判定按「缺失接纳证明 = 拒绝」fail-closed，不冒充确定不匹配。
- **恢复/重试**：纯函数全失败可重试（无部分状态、无副作用）；同一输入重调用结果内容全等（红测试「确定性」断言）；keyPattern 编译失败不进 per-call 缓存，重复触达确定性重拒——结果恒同。
- **并发**：无可变共享状态（全部调用局部变量；per-call 正则编译缓存为局部 Map）——天然线程/重入安全（单线程 JS 语义下无需加锁论证）。
- **幂等**：零 memo、零缓存写入、零 derived 突变——调用幂等。
- **资源**：无分配型资源；递归深度受 `MAX_TYPE_NESTING=100`（求值期结构封顶）+ 闭包名集合去重（递归别名终止）双约束，无栈溢出新面（对齐 validate-patch 深嵌套 E100 先例的量级）。
- **成本**：O(路径长 × N)（双游走，身份去重每步 O(1)）+ O(闭包子树) + O(docs 键数)（表扫描）+ per-call 正则编译（局部缓存去重）——落在 ADR-0016 预算内（「O(path × N + schema 子树)」，缓存演进留 profiling）。敌意超长段成本由引擎步数预算封顶（pattern.ts L761–773，耗尽即内容级拒绝——不产生无界计算）。

---

## 10. 调用方影响矩阵

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| （现存直接调用方） | **无**——`resolveSchemaAtPath` 等符号全仓零命中 | 新公共接缝，无既有调用方可破坏 | 无 | B1 grep 实证；SA6 §4/SA8 §就绪度/SA2 §9 独立复现同载 |
| `packages/vfsl/src/index.ts` 消费者（doc-runtime 等，经包入口） | 既有导出面不变 | **纯加法**：新增 1 值导出 + 2 类型导出；既有导出逐字节不变 | 无 | index.ts 现状；validate-patch 增量导出先例（issue #237 additive） |
| `validate-patch.ts` 既有消费者（validatePatch/planMutationBoundary 等） | 既有函数不变 | `drillStep`/`DrillResult`/`structureLens` 新增**模块级**导出（非 index 公共面），既有函数零行为改动 | 无 | B2；包内消费先例（resolve.ts→validate-patch） |
| namespace-runtime（未来组合票） | readData 成功分支 `{ok:true,value}`（ADR-0008 修订后目标形状待组合票落地） | 消费本函数 + 深拷贝纪律（D5 边界归属）；**两码吸收面完整**——本函数不产生两码之外的 throw（引擎错误已并入 NOT_FOUND，D7），组合票无需为合法派生物新增 catch 通道 | 组合票内实现 | ADR-0016 §分层/§结果形状；SA8 冲突点 2/11；SA2 §9 组合面行「随 SA2-F1 修订消除」 |
| namespace-registry（未来） | lease 读结果类型 | 仅类型别名跟随（`NamespaceLeaseReadDataResult`），lease 行为零变化 | 组合票/跟随票 | ADR-0016 §分层 |
| typed-access 投影 / codegen 消费者 | 忽略未知字段 | 加法兼容（adapter 可忽略新字段） | 无 | ADR-0016 §分层与兼容面 |
| SA6 契约测试四文件 | 红 34 + 类型 3（接缝缺失同因）；负控 11 绿 | 实现后自动翻绿，**不修改测试** | 无（禁改，§11 DENY） | SA6 §13 |

---

## 11. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
|---|---|---|
| `packages/vfsl/src/resolve-schema-at-path.ts` | **新建**：`ReadDataSchemaProjection`/`ResolveSchemaAtPathResult` 类型 + `resolveSchemaAtPath` + 私有助手（值侧步进/闭包/切片/分类/引擎错误分类器） | D9 模块落位；§8 全部算法的唯一实现载体 |
| `packages/vfsl/src/index.ts` | 新增导出块：`export { resolveSchemaAtPath }` + `export type { ReadDataSchemaProjection, ResolveSchemaAtPathResult }`（自新模块），带 JSDoc（红线 1/2 + SA2-F1 修订后文案要求 §8.1） | AC1「经 vfsl 公共入口导出」；包边界「公共 API 仅经 src/index.ts」（B14）；test-d TS2305 翻绿点 |
| `packages/vfsl/src/validate-patch.ts` | 仅新增 `export` 关键字于 `drillStep`、`DrillResult`、`structureLens`（+ 一行注释说明包内复用意图）；**零行为改动** | D1 同构复用（红线 3 不许分叉）；最小 diff |
| `packages/vfsl/AGENTS.md` | normative 清单补 ADR-0016（含 0008 D8 修订节指引）一行；Boundaries 补一句「`resolveSchemaAtPath` 的 `derived` 为可信域入参，畸形派生物（ref 目标缺失、两树分歧等）throw `InternalError`（ADR-0016）——公共面不抛错纪律的显式例外；keyPattern 引擎四类错误不属畸形，按 ADR-0016 fail-closed 收敛 `SCHEMA_PATH_NOT_FOUND`（与写侧 validate.ts 值级处理对偶）」 | SA8 红线 5（文档跟进，非阻塞）；防后来者按旧惯例「修复」throw 通道或把引擎错误改回 throw |
| `packages/vfsl/test/resolve-schema-at-path-pattern-errors.test.ts` | **新建**（SA2-F1 验收锚，§12）：三枚确定性 Pattern 错误夹具（`Pattern<"[">` 编译失败 / 反向引用子集外 / {n,m} 展开超限）——各含 parse+evaluate ok 前置断言；断言 `['r','k']` → NOT_FOUND、`['r',7]` → INVALID、全程不 throw `InternalError`；可选附长敌意段探针（断言仅为「不 throw」） | SA2-F1 验收要求（「`Pattern<"[">` Record 夹具，断言不 throw InternalError」）；契约四文件未锚定该族，须新增独立锚（不改契约） |
| `wiki/raw/task_issue-272_design.md` | 本设计产物（迭代 1 修订） | SA1 交付物 |

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/vfsl/test/resolve-schema-at-path.test.ts` / `-fixture.ts` / `-control.test.ts` / `.test-d.ts` | SA6 已批准验收契约（红/负控/类型面） | 实现不得反改契约自证（SA6 §12 交付物纪律；改契约会证伪验收）；Pattern 错误族锚定走**新增**文件而非改契约 |
| `packages/vfsl/src/derived.ts` | 冻结形状（ADR-0003） | 本票零形状变更（B6/B7）；改冻结面即超范围 |
| `packages/vfsl/src/resolve.ts` | InternalError/walkRefChain 供给方 | 复用即可；「while 循环算法恰一份」纪律不容新增链算法（D9） |
| `packages/vfsl/src/evaluate.ts` / `validate.ts` / `pattern.ts` / `parser.ts` / `semantic.ts` / 其余 src 文件 | 求值器/解释器/正则引擎/文档三表生成 | 零行为需求（含：不得在 parser/evaluate 前移 keyPattern 合法性校验来「消除」引擎错误可达性——那是另一张票的语义变更）；触碰即引入回归面（AC4） |
| `packages/vfsl/README.md`、`packages/vfsl/package.json` | 公共说明/包清单 | README 为 stub 不枚举 API；无版本/导出映射变更（「.」入口不变） |
| `packages/doc-runtime/**`、`packages/namespace-runtime/**`、`packages/namespace-registry/**`、其余 packages | 组合层 | ADR-0016 §分层：深拷贝边界、readData 组合、registry 别名跟随均属后续票（SA8 冲突点 11） |
| `docs/adr/**`、`CONTEXT.md`、`docs/vfsl/**` | ADR-0016 及其配套已随母票 PR #271 落地（HEAD a6b2a79） | 决策文档已就位；本票为实施票，不改决策 |
| `domains/**`、`apps/**`、`tests/**`、根配置 | 无关 | 零交集 |

---

## 12. 验收与验证映射

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
|---|---|---|---|
| AC1 公共接缝导出 + 结果形状恰五键 + 同步非 Promise | SA6 红 4 断言（现红：接缝缺失） | `resolve-schema-at-path.test.ts` AC1 组 | 34 红全部翻绿；`typeof === 'function'`；五键断言过 |
| AC1 两码 + path 新鲜副本（改原数组不穿透、两次不共享） | 红 9 断言 | 同上失败码组 | INVALID/NOT_FOUND 各锚定例 `toEqual` 全等；`not.toBe` 引用断言过 |
| AC2 union any-member / 合成 union 两键无判别式 / 判别式无关（剥光全等） | 红 5 断言 + 负控 C2 判别式在场确认 | 同上 union 组（含 5 路径剥光比较） | `['u','x']` 多集断言过；`Object.keys(node)===['kind','members']` |
| AC2 Record keyPattern fail-closed + Record 终点原样 | 红 3 断言 + 负控 C3e 写侧值级同向 | 同上 Record 组 | `['assets','bad key!']` NOT_FOUND；`['assets']` 含 `'<key>'`+keyPattern 原文；`['assets',7]` INVALID |
| AC2 optional 透明展开 / 返回原样保留 | 红 5 断言 | 同上 optional 组（含 `[]` 整树保留） | `['notes']`/`['config']` optional 原样；`['config','retries']` scalar；`['notes','x']` NOT_FOUND |
| AC2 ref 缺失 InternalError（游走中 + 终点闭包两态，不进联合） | 红 2 断言 | 同上 InternalError 组 | `.toThrow(InternalError)` + 实例断言；无任何联合失败降级 |
| AC3 docs/aliasDocs 切片键同构（⊆ 表、内容逐字、不发明键） | 红 6 断言 + 负控 C2 全表非空对账 | 同上 docs 组（叶子/别名终点/别名内深读/整根四类键集 + 跨读集 ⊆ 不变量 + 递归别名单名闭包 JSON 往返） | §8.6 对照表逐行全等 |
| **SA2-F1：keyPattern 引擎四类错误不进 throw 通道（合法派生物不可判定 Pattern 家族）** | B15 事实链（parser/semantic/evaluate/pattern/validate 五点源码锚）；写侧值级对偶 = 负控 C3e 家族；SA2 §12 测试构想 | **新增 `resolve-schema-at-path-pattern-errors.test.ts`**：三枚确定性夹具——`type BadKey = string & Pattern<"[">`（编译失败）、反向引用 `Pattern<"\\1">` 形（子集外）、{n,m} 展开超 10_000 指令形（超限）——各先断言 `parseVfsl`+`evaluate` ok（合法派生物前提）且 derived 值树携带该 keyPattern；再断言 `resolveSchemaAtPath(derived, ['r','k'])` = `{ok:false, code:'SCHEMA_PATH_NOT_FOUND'}`（不 throw、不 INVALID）、`['r',7]` = INVALID（形状层先行）；可选长敌意段探针（`'a'.repeat(N)` 段，断言仅为「不 throw InternalError」——是否触发 BudgetExceeded 取决于引擎负载，不作必要条件） | 引擎错误家族零 `InternalError`；编译期三类与失配同码 NOT_FOUND；形状分类不受引擎错误污染；`PatternBudgetExceeded` 与前三类共用同一分类路径（D7 单点分类器） |
| AC4 vfsl 包测试 + typecheck 绿 | 基线 560 绿（**已含负控 11**，29 既有 `.test.ts` 文件）/ 仅新文件红（SA6 §13；SA2-N2 计数更正） | `pnpm --filter @nomicore/vfsl typecheck`；根 `npx vitest run packages/vfsl/test`（含 --typecheck） | 全部测试文件绿：**32 文件总计 = SA6 证据 3 的 31 文件（30 `.test.ts` + test-d）+ 新增 pattern-errors 1**；**运行时断言终点 = 594（560 基线已含负控 11 + 红 34）+ 新增 Pattern 家族断言 + 类型面 3**；零 skip/only |
| AC4 根仓无回归 | 根 typecheck 14 包仅新 test-d 红；根 test 基线绿 | 根 `pnpm typecheck`；根 `pnpm test` | TS2305 消失；全仓测试零回归 |
| 同构命题（写合法 ⟺ 读可解析）持续成立 | 负控 C3 矩阵（写侧实测前提） | C3 7+4+3 条与红契约对应断言联合阅读；pattern-errors 组与 C3e（写侧「Record 键不满足 Pattern 正则」值级家族）并列成「不可判定/失配 Pattern 家族」对偶锚 | 负控保持 11/11 绿（不改负控）；读侧对合法派生物永不因 keyPattern throw |
| 纯度/确定性/JSON 可序列化 | 红「两次调用内容全等 + JSON 往返」断言 | 同上 | 过；递归别名场景亦过 |

SA1 不编写/运行测试；上表「所需」列即 SA6 已交付契约 + 既有验证门 + SA2-F1 新增锚，实现方照单执行即可。

---

## 13. 风险、回滚和残余问题

**风险**

| # | 风险 | 等级 | 缓解 | 残余 |
|---|---|---|---|---|
| R1 | 值侧游走为全新代码（无写侧孪生可直接复用——descendValues 是单游标归一化形态） | 中 | 34 断言逐路径锚定 + §8.6 对照表作实现核对单；语法路径规则逐字对齐 B10 | 契约未覆盖路径（如 `['u']`、ref-ROOT、深 Record 链）行为由本设计的通用规则推出——**SA2 §7-C1–C6/§14-N7 已受邀抽查并全部通过** |
| R2 | D8 分类规则在契约未锁的**混合形态**（map∪array）下选择形状级/内容级归属，偏离 KIND_ORDER 字面镜像 | 低 | 全部契约锚定例两规则同结果；§7-D8 记录否决理由；SA2-N1 复核维持 | 若未来 Owner 裁决改回 KIND_ORDER 镜像，仅改分类器一处，签名/码域/其余行为不变 |
| R3 | D2 空条目过滤与 D3 ROOT 别名级排除为契约未锁自由度的钉死 | 低 | SA6 §15 显式不锁并移交 SA1；两种取向下契约均绿 | 裁决变更属局部常数改动 |
| R4 | 引用返回（D5）下消费者变异投影会交叉污染自有 derived | 中 | JSDoc 明示 + derived 不可变契约（B12）+ getCompiled 深冻结条目；组合层深拷贝为 ADR 指派（**硬约束随 follow-up #1 传承，不得从组合票裁撤**——SA2-N4） | runtime 组合落地前的空窗期依赖契约自觉；SA8 复查点 3 已裁边界归属 |
| R5 | 同名 ref 多候选终点（如 union 两成员字段同为 `ref A`）产出「双成员同内容合成 union」 | 低 | 确定性、内容忠实（镜像 drillStep 身份 Set 语义）；边缘行为已在 §8.4 记录（SA2-N5 复核维持） | 无消费者正确性影响（多集相等） |
| R6 | keyPattern 引擎四类错误通道钉死为内容级 fail-closed NOT_FOUND（SA2-F1 修订；契约四文件未锚定该族） | 低 | 新增 `resolve-schema-at-path-pattern-errors.test.ts` 锚定三枚确定性夹具 + 「不 throw InternalError」断言 + `['r',7]` INVALID 形状隔离；分类器单点实现（§8.3 单层 try/catch，D7） | ①结果联合不细分拒绝原因（失配/不可判定同形）——消费者无法区分，如未来需要须走 ADR 加法（新码或 detail 字段，非本票）；②`PatternBudgetExceeded` 无确定性行为级触发夹具（依赖引擎负载），测试仅锚「不 throw」不变量；③ SA8 复审第 7 项旧定性已被本设计更正（§6 末行），Host 流水线如存档了该表述以本设计 §7-D7 为准 |

**回滚**：单包纯加法变更——回滚 = 删除 `resolve-schema-at-path.ts` + `resolve-schema-at-path-pattern-errors.test.ts` + index.ts 导出块 + validate-patch.ts 三处 `export` 关键字 + AGENTS.md 两行；无数据迁移、无 wire、无持久化、无缓存失效。契约测试随之回到红（接缝缺失）基线。

**任务内必要条件**：无未解决项——SA2-F1 已逐条落实（§15），全部设计决策已钉死，无阻塞。

**明确的 follow-up（非本票）**

1. namespace-runtime 组合票：readData 成功分支 `schema: ReadDataSchemaProjection | null`、**每次读深拷贝投影（活引用不逃逸 readData 公共面——SA2-N4 建议组合票验收明含此断言）**、`schema:null` 三情形、`NamespaceRuntimeReadDataResult` 重定型。
2. namespace-registry 类型别名跟随（`NamespaceLeaseReadDataResult`）。
3. 若 profiling 证明解析/拷贝成本成瓶颈：按 schema generation 的缓存为加法演进（ADR-0016 §交付纪律预留）。
4. （远期，仅当消费者提出）keyPattern 拒绝原因细分（失配 vs 引擎不可判定）——需新失败码或 detail 字段，属公共面破坏性加法，须 ADR。

---

## 14. 是否需要设计后 ADR 冲突复查及理由

**结论：本迭代（迭代 1，SA2-F1 修订）不需要新的 ADR 冲突复查（`requiresConflictRecheck: false`）**，理由三条：

1. **迭代 0 的复查义务已消解**：迭代 0 以三条理由（公共 API 变更、首个「可信域入参 throw 逃逸公共面」的公开函数、D5 深拷贝边界归属）提交复查，SA8 已执行设计后复审（`task_issue-272_conflict_recheck.md`，clear，3 复查点 + 12 项增量裁决全部 no-conflict）。本修订**不改变**签名、结果联合码域、模块落位、导出面与 DENY 边界——公共契约面与已被复查的版本一致。
2. **唯一语义增量落在 ADR-0016 既有明文延长线上**：SA2-F1 修订（引擎四类错误从 throw 改道 fail-closed `SCHEMA_PATH_NOT_FOUND`）向 ADR-0016「Record 动态键带 keyPattern 时用正则实测该段，不匹配即拒绝（fail-closed）」与任务简报「`SCHEMA_PATH_NOT_FOUND` = 无任何候选接纳该段」的定义**收敛**而非偏离；未引入第三失败码、未新增 throw 形态（SA2 结论重述预先裁决：该方向「不新增 ADR 冲突面」，仅当「保留 throw 通道以外的第三形态（如新增失败码）」时才须重回 SA8——本修订未选择第三形态，D7 否决备选 (c) 记录在案）。
3. **SA8 复审第 7 项的定性更正属设计级修正、非 ADR 决策覆盖**：该复审项裁决为 no-conflict 且自注「ADR 未规定、设计钉死」——其对「引擎不可编译属畸形派生物」的表述继承迭代 0 设计的错误事实前提（B15 证伪）。本设计按源码事实链更正该定性并显式回写 §6（不静默），更正后与 ADR 全集无冲突；ADR-0016 本身对引擎错误通道无任何条款（正因「ADR 未规定」才由设计钉死）。

若 Host/Controller 判断第 7 项表述的存档一致性仍需 SA8 确认，可随实现票一并复核——但按 SA2 预先裁决与本节论证，非必要门禁。

---

## 15. 评审修订映射

评审输入：`wiki/raw/task_issue-272_sa2_review.md`（SA2 迭代 0 评审，verdict reject：1 MAJOR）。逐条落实如下：

| Finding | 修订位置 | 处理结果 |
|---|---|---|
| **SA2-F1（MAJOR）**：keyPattern 引擎异常通道事实性误分类——「引擎 throw = 畸形派生物」与 parser.ts L470（合法性不在方言层校验）、semantic/evaluate 原文透传、validate.ts L256–280 值级处理矛盾；合法 evaluate-ok 派生物会被送上 InternalError throw 公共通道 | §7-D7 整节重写（(a) 分歧 throw 触发面收窄 + (b) 四类引擎错误分类表、裁决理由、BudgetExceeded 可达性四点论证、否决备选 (a)(b)(c)）；§2-B15（新证据锚：五点事实链）；§8.1（JSDoc throw 清单收窄 + 引擎错误句）；§8.3（Record 槽单层 try/catch：四类 instanceof → 内容级拒绝标记；意外异常包装 InternalError；成功产物缓存策略）；§8.6（夹具两行）；§9（通道三分重排 + 敌意段成本封顶句）；§10（namespace-runtime 行：两码吸收面完整）；§11（ALLOW 增 `resolve-schema-at-path-pattern-errors.test.ts`；AGENTS.md 例外句文案；DENY 补 parser.ts/semantic.ts 及「不得前移校验」）；§12（新增引擎错误族测试行）；§13-R6（重写）；§6（SA8 复审第 7 项行更正）；§1 目标 3/非目标（拒绝原因细分排除） | **已落实**：采纳 SA2 推荐裁决——编译期三类（Compile/Unsupported/TooLarge）→「该 Record 候选无法接纳任何段」fail-closed `SCHEMA_PATH_NOT_FOUND`（与写侧值级键拒绝、ADR fail-closed 决策同族）；`PatternBudgetExceeded` 经可达性论证（R3 被 4M 截断于 len≥89 + O(len×\|prog\|) 模拟上界 + 敌意段长可控 + validate.ts L263–264 值级先例）**不满足**「可编译程序 + 任意敌意段长不可触发」的保留前提 → 同走 fail-closed NOT_FOUND；未选第三形态/新失败码（D7 否决备选 (c)）→ 按 SA2 结论重述的预先裁决不触发 SA8 复查（§14 论证） |
| N1（D8 混合形态不镜像 KIND_ORDER） | §7-D8 否决备选段 | 维持原裁决（SA2 复核确认契约锚定例两规则同结果）；回退路径已记录（R2） |
| N2（§12 AC4 终态计数重复计入负控 11） | §5 基线行、§12 AC4 行 | 已更正：560 基线**已含**负控 11；运行时断言终点 = 594（560 + 红 34）+ 新增 Pattern 家族 + 类型面 3 |
| N3（§8.3 union 成员语法路径模板缺 `>`） | §8.3 union 匹配分支 | 已更正：`+ '.<member ' + i + '>'`（与 D2/B10 文法统一） |
| N4（D5 引用安全前提链三项缺一不可；组合票深拷贝义务不可裁撤） | §7-D5、§6 红线 2 行、§13-R4、follow-up #1 | 维持并强化：follow-up #1 明含「活引用不逃逸 readData 公共面」验收断言建议 |
| N5（同名 ref 多候选双成员合成 union 边缘行为） | §8.4、§13-R5 | 维持（SA2 确认确定性成立、无正确性影响） |
| N6（in-flight 环检测作用域 = 单次候选规范化） | §7-D9、§8.3 规范化分支 | 维持（文本已在位，复述为实现纪律） |
| N7（契约未锚定路径 `['u']`、ref-ROOT、深 Record 链、混合形态推演） | §13-R1 残余列 | 维持（SA2 受邀抽查全部通过，风险降级记录在案） |

SA2 评审中无需设计响应的其余内容（§2 verdict、§3 需求覆盖表、§5 上游行确认、§7 状态机攻击、§10 惯例审查、§11 范围审查）均为对迭代 0 设计的**确认性**结论，其引用的设计事实未因本修订改变（修订面局部：D7 通道 + 文案/表格/JSDoc/测试锚跟随，签名、码域、D1–D6/D8/D9、模块落位、文件范围主体不变）。

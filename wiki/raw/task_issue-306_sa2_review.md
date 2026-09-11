# SA2 设计攻击评审 — issue #306（M4 联合成员文档注释：解析挂载 + IR/derived `memberDocs`）

- **Dispatch**: sa-32f0ab94-7d45-43b6-83fa-eb1d4e7c69db（mabf-sa2 / design-review / iteration 0）
- **评审对象**: SA1 设计 `wiki/raw/task_issue-306_design.md`（dispatch sa-aba44c9b…，iteration 0，HEAD `91c4add`）＋ SA6 契约 `wiki/raw/task_issue-306_sa6_contract.md`（dispatch sa-509beb7b…）
- **评审方式**: 全新视角独立攻击。本评审逐锚点复核了设计引用的全部源码行号（parser/tokenizer/semantic/ir/derived/evaluate/fingerprint/index），独立重推 D1 结算机制在 15+ 对抗场景下的行为，并核验契约测试文件的真实内容、金样本冻结状态与全仓 E305 断言面。

---

## 1. Reviewed inputs

| 输入 | 状态 |
| --- | --- |
| `wiki/raw/task_issue-306.md`（Host 简报，issue #306 正文 + AC1~AC6） | 已读 |
| `wiki/raw/task_issue-306_design.md`（SA1 设计） | 已读（全文 417 行） |
| `wiki/raw/task_issue-306_sa6_contract.md`（SA6 诊断与验收契约） | 已读（全文 260 行） |
| `.scratch/sa8-conflict-report-issue-306.md`（SA8 前置门禁，verdict clear，C-1~C-6 / E-1~E-6 出处） | 已读 |
| `wiki/raw/task_issue-306_design_conflict_report.md`（SA8 设计后冲突复查，verdict clear，`requiresConflictRecheck` 消解为 false） | 已读 |
| `docs/adr/0019-vfsl-union-member-docs.md`（规范权威） | 已读 |
| `packages/vfsl/src/{parser,tokenizer,semantic,ir,derived,evaluate,fingerprint,index,resolve,shapes,validate,validate-patch,resolve-schema-at-path}.ts` | 按设计锚点逐一复核 |
| `packages/vfsl/test/parse-vfsl-union-member-docs.test.ts`（13 用例）、`evaluate-derived-member-docs.test.ts`（6 用例）、`union-member-docs-fixture.ts` | 全文核读 |
| `packages/vfsl-codegen/src/emitter.ts`、`packages/doc-runtime/src/*`（DerivedSchema 消费面抽查） | 抽查核验盲读主张 |
| `docs/vfsl/v1-spec.md` §5（三锚位现行文）、`tsconfig.base.json`（`exactOptionalPropertyTypes`）、`vitest.config.ts`（收集面） | 核验 |
| `wiki/raw/task_issue-306_relevant_decisions.md` / `task_issue-306_conflict_report.md` | 不存在（设计 §6 已如实登记；等价产物为 `.scratch` 前置门禁 + 设计后复查报告，均已读） |
| Owner 评论 | 无（dispatch 明示 REST 评论空数组；SA6 §2 / SA8 两报告独立复核一致，本评审采信三方一致） |

## 2. Verdict

**approve**（无 BLOCKER、无 MAJOR；3 条 MINOR 观察见 §14，不阻断实施）。

核心结论：设计是 ADR 0019 决策 1–5/8/9/10 的忠实机制化；D1「记录位置 + 逆序终局同一性核对」机制经本评审独立重推在全部对抗场景（M3 竞争、嵌套联合、坍缩、夹缝、对象/Record/标记成员、EOF 沉积、错误路径、记账窗口交错）下行为正确且失败模式恒为 loud（假 E305 或 E100，无静默丢 doc 路径）；全部源码锚点引用准确；契约 19 用例真实存在且与设计映射一致；ALLOW/DENY 与 D7 冻结不变式互洽。

---

## 3. 需求覆盖

| Requirement（issue 正文 / AC） | Design section | Assessment |
| --- | --- | --- |
| doc 紧邻 `\|` 之前挂后继成员 | §7 D1 附着点 A | ✅ 覆盖；与 ADR 0019 决策 1 第 1 子句逐字对齐 |
| 首成员无前导 `\|` 挂成员起始记号 | §7 D1 附着点 B | ✅ 覆盖；决策 1 第 2 子句 |
| 连续多条 doc 按序同挂一成员 | §7 D1（pending 累积天然保序，tokenizer.ts:72-82 已核） | ✅ 覆盖；契约用例 4 逐字锚定 |
| IR 条件 `memberDocs` 键、与 members 等长 | §7 D2/D3 | ✅ 覆盖；AST 必填等长 + IR 条件附加双层 |
| derived 条件稀疏表、`<member N>` 键 | §7 D4 | ✅ 覆盖；复用 evaluate.ts:381 既有文法（已核） |
| 单成员坍缩维持 E305 | §7 D1（坍缩不结算）＋ §12 用例 8 | ✅ 覆盖；ADR 决策 2 |
| `\|` 夹缝：非标记 E305 / 标记按 M3 不双挂 | §7 D1（夹缝 doc 不入 A/B 记录）＋ D2（同一性核对） | ✅ 覆盖；ADR 决策 1 第 4 子句 + 决策 3 |
| E305 措辞补「联合成员」 | §7 D6 | ✅ 覆盖；前缀冻结核验（仅 semantic.ts:76 一处正文） |
| 纯文档性质，不进校验与物化 | §7 D5/D7（validate/物化零改动零读取） | ✅ 覆盖；契约用例 15 七路全等 |
| AC1（两布局 + 连续 doc） | §12 用例 1-4 | ✅ 契约文件实测用例在场 |
| AC2（坍缩/夹缝维持 + M3 不双挂） | §12 用例 7-11 | ✅ 在场 |
| AC3（derived 条件稀疏） | §12 用例 12-14 | ✅ 在场 |
| AC4（存量逐字节不变 + `sha256:v1:`） | §12 用例 18/19 + derived 金样本 | ✅ 在场，实现前录制（常量冻结于契约文件 33-36/26-27 行，已核） |
| AC5（手造 IR 畸形 → E100） | §12 用例 16/17 | ✅ 在场，4 类畸形 + 良性正控 |
| AC6（包测试 + typecheck 绿） | §12 验证命令 | ✅ 在场（数字口径见 §14 O-1） |

目标/非目标无静默扩大：#306 范围严格 = `packages/vfsl` 五文件；#307/#308/#309 出界依赖边显式编码（§1 非目标 + §11 DENY）。

## 4. Owner评论覆盖

issue #306 无适用 Owner 评论（Host dispatch：REST comment read returned an empty array；SA6 §2 与 SA8 前置/复查报告独立复核 `comments:0` 一致）。无映射义务。设计 §4 如实登记，无虚构评论约束。

## 5. 上游事实与SA8约束

| Fact or constraint | Design response | Assessment |
| --- | --- | --- |
| SA6 能力缺口链：`parseUnionType` 零回收、三锚位 `claimDocs`、IR/derived/守卫四面缺口 | §3/§5 承接表；§7 D1-D5 逐面落点 | ✅ 本评审独立复核全部行号：`parser.ts:141-144`（沉积）、`151-156`（claimDocs）、`209/522/434`（恰三调用点）、`255-269`（union 零回收）、`semantic.ts:222-223`、`evaluate.ts:338-342/380-382/344-354`——全部准确 |
| SA6 E-b：M3 优先是既有行为 | §5 引用 + §7 D2 机制化 | ✅ parser.ts:434 M3 回收紧跟标记名消费（parseIdentType 直通零 next()），设计论证成立 |
| SA6 E-d：手造 IR 畸形现 `ok:true` 静默忽略 | §7 D5 守卫族同族延伸 | ✅ `put/appendDocs` 守卫族（evaluate.ts:345-354）形态核讫，TypeError → 顶层 catch（74-77）→ E100 同构 |
| SA6 E-e：金样本实现前 3 次稳定 | §2.4/§12 冻结、SA4 不得重录 | ✅ 契约文件常量在场；fixture（SPEC_FIXTURE/FIXTURE_B）均无成员 doc（已核读），存量语义冻结有效 |
| C-1 规格同支同步（#309） | §1 非目标 + §11 DENY（docs/** 出界） | ✅ v1-spec §5 现行「三类锚位」文本已核（405-409 行）——#306 零规格改动，冲突由 ADR 0019 显式授权 + #309 排期承接 |
| C-2 指纹纪律 | §7 D3/D4 条件附加；fingerprint.ts DENY | ✅ 本评审独立重推：被 M4 新回收的 doc 只能来自「`\|` 记号或非 M3 成员起始记号的 leadDocs」，两类均不在三锚位内 → 新键只出现在原 E305 文本；`semanticFingerprintOf` 输入不变（fingerprint.ts:55-57 核讫）；D2-CONTRACT-MARKER 单一生产者不破 |
| C-3 E305 触发面只缩小 | §7 D1/D6 + 用例 8/9/10 | ✅ 坍缩两形态与夹缝（非标记）锚点取现行实测值（(2,10)/(2,16)/(4,5)，本评审按文本列位重算一致） |
| C-4 纯文档纪律 | §7 D7；validate*/物化 DENY | ✅ validate.ts:350/517、validate-patch.ts:160/247、resolve-schema-at-path.ts:279/394 union 分支逐点核讫：只读 `members` |
| C-5 中间态豁免 | §1/§10/§13 残余 4 | ✅ codegen emitter 显式挑五槽（emitter.ts:123-153 核讫）、`resolveSchemaAtPath` docs 切片两来源——对 memberDocs 盲读 |
| C-6 消息变更边界 | §7 D6 前缀冻结 | ✅ 全仓 E305 断言面本评审独立 grep：唯一消息断言 `parse-vfsl-jsdoc.test.ts:127`（前缀正则）；`parse-vfsl-root-convention.test.ts:193` 仅断言码+位置；`tests/acceptance/vfsl_spec_acceptance.py` 断言规格文本（#306 不改规格 → 保持绿） |
| E-1~E-6 证据项 | §6 表逐条映射 | ✅ 全部落在契约用例/验证命令；E-6 出界登记正确 |
| SA8 设计后复查（iteration 1，clear） | 设计 §14 自报 true → 已由 SA8 复查消解 | ✅ 本评审独立核验 SA8 矩阵 #5/#8/#10/#11 的关键代码主张，无发现新增 ADR 冲突风险 |

## 6. 设计内部一致性

- **锚点引用准确性**：设计 §2 引用的 30+ 源码行号经逐一复核全部准确（tokenizer.ts:72-82/175-177、parser.ts:41/118-123/134-146/141-144/148-156/209/220-223/255-269/434/522、semantic.ts:71-83/76/222-223、ir.ts:45、derived.ts:33/48/69-84、evaluate.ts:61/63-73/74-77/116-121/149-156/298-307/338-342/344-354/380-382、fingerprint.ts:7-14/24/55-57、index.ts:60-78）。
- **正文 ↔ 伪代码 ↔ 表格**：D1 附着点定义、伪代码（pendings/settleM4/坍缩分支）、机制正确性表、状态机图（§8.2）、数据流（§8.3）、调用方矩阵（§10）、ALLOW LIST（§11）、验收映射（§12）相互一致，无死引用、无旧 API、无前后相反描述。
- **D2 必填 AST 键 ↔ 坍缩路径**：坍缩返回 `members[0]`（parser.ts:265-268），不构造 union 节点 → 「恒携带必填 memberDocs」与「坍缩无携带者」自洽；`AstType` union 变体全仓唯一构造点是 parser.ts:268（本评审 grep 核讫：src 内无第二构造点；AstType 不导出，测试不构造 AST union）→ typecheck 面零波及主张成立。
- **D3 条件展开 ↔ `exactOptionalPropertyTypes`**：tsconfig.base.json 已开该旗标（核讫）——设计的条件展开构造（`...(some ? { memberDocs } : {})` 与 semantic.ts 三元返回）是必要且正确的纪律，与 derived.ts:13 既有注释同款。
- **D4 第八键居末 ↔ 金样本**：evaluate 返回字面量（62-73 行七键）末位条件追加 → 存量键集合/键序不变，与契约 `BASE_DERIVED_KEYS`/摘要断言一致。
- **D5 守卫 ↔ 顶层 catch 链**：守卫在 `collectDocs`（evaluate.ts:61，try 内）触发 → TypeError → 74-77 catch → E100；与 `put/appendDocs` 同族但「缺席=合法」的有意不对称有 ADR 决策 5 明文依据，且设计明示差异（不伪装成同构）。
- **§14 自报复查 ↔ SA8 iteration 1**：设计自报 `requiresConflictRecheck: true`（iteration 0 撰写时点正确），SA8 复查报告已将其消解为 false——设计正文未残留过期的「待复查」状态主张，无伪修订迹象。

## 7. 状态机与并发攻击

本评审独立构造并重推以下对抗场景（初始态 = tokenizer pending → 记号 leadDocs → next() 沉积 dangling）：

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
| --- | --- | --- | --- | --- | --- |
| S-1 | B 锚记录 `{start:s, leads:[d]}`，首成员起始记号 = 标记名 | M3 `claimDocs()`（parser.ts:434）在成员解析中整取尾部（claimDocs 取 depositedByLast 条 = 恰该记号全部沉积，无部分取走） | 结算 `dangling[s]` 非 d → 失配 → `memberDocs[0]=[]`；d 恰一次挂 marker，无 E305 | 无——机制正确；契约用例 7/10 锚定 | 无 |
| S-2 | 外层 union 已记录 pending_i，成员 i 内含嵌套 union | 内层在自身出口先行结算（调用栈纪律），splice 区间 > 外层已记录区间（沉积只追加 ⇒ 记录区间按记录时序单调） | 外层 start 不漂移；逆序结算先高后低，先结算者不触及更低下标 | 无——设计「为什么必须逆序」论证经独立重推成立 | 无 |
| S-3 | 嵌套 union 坍缩（如 `YArray</** e */ \| "x">` 作为成员） | 内层 `members.length===1` → 不结算 | e 留 dangling（索引高于外层 pending_i 区间、低于后续 pending）→ 外层结算不吞 e → E305 | 无；与现行行为一致 | 无 |
| S-4 | `type T = "a" \| /** d */ "b";` 夹缝非标记 | d 挂 `"b"` 记号 leadDocs，不入 A/B 任一记录 | d 留 dangling → E305 @(2,16)（单行）/@(4,5)（多行） | 无——锚点本评审按列位重算一致 | 无 |
| S-5 | 坍缩两形态（`/** d */ "a"` / `/** d */ \| "a"`） | `members.length===1` → 返回 `members[0]`，无 union 节点、无结算 | E305 @(2,10) 逐字节维持 | 无 | 无 |
| S-6 | 记账窗口交错：M1/M2/M3 回收点 vs M4 结算点 | 三锚位回收均为「紧跟锚记号 next()、零次 parseTypeExpr 间隔」（parser.ts:209/434/522 逐点核） | M4 结算（union 出口）永不落入任何 claimDocs 窗口；结算后首个 claimDocs 的 `depositedByLast` 尾部算术基于结算后新沉积，正确 | 无——设计 §7 D1「记账不变量保持」论证核验成立 | 无 |
| S-7 | 解析中途抛错（error 记号/E100/E301 等） | pendings 局部数组随 Parser 实例消亡 | 无需清理；顶层转判别结果；docTotal 核对只在成功路径运行（parser.ts:220 于循环后） | 无 | 无 |
| S-8 | EOF 记号携带 leadDocs（模块尾悬空 doc） | parseModule 显式沉积（parser.ts:198-203，不经 next()/depositedByLast） | 沉积发生在全部 union 结算之后，不与 pending 交互 → E305 | 无 | 无 |
| S-9 | 同一 DocLead 双挂风险 | 每 DocLead 恰挂一个记号的 leadDocs（tokenizer pending flush-on-emit，72-82 核讫）、每记号恰消费一次 → 各 pending leads 引用集构造性不相交 | 同一 doc 至多被一个 pending 结算；若实现算错，同一性核对封死跨 pending 假匹配 | 无 | 无 |
| S-10 | 重复解析/求值 | 纯函数、无共享可变状态（Parser 实例私有 dangling/claimed/depositedByLast） | 同输入逐字节同输出；无竞态面 | 无 | 无 |
| S-11 | `depositedByLast` 被 M4 结算污染 | 结算只 splice dangling 并 `claimed+=n`，不触 `depositedByLast`；后续锚位回收前必先经自身锚记号 next() 重置 | 窗口算术不受 M4 影响 | 无 | 无 |
| S-12 | B 锚 peek 为 undefined？ | tokens 数组恒以 eof 记号结尾，parseUnionType 入口时 peek() 至少为 eof 记号；若成员起始即 eof → parsePrimaryType 抛 E100 | 无 `peeked.leadDocs` 空引用路径 | 无（伪代码 `?? []` 亦防御） | 无 |
| S-13 | 深度预算 | M4 无新递归（pendings O(成员数) 随解析栈消亡）；`MAX_TYPE_NESTING` 计费口径零改动 | 资源界不变 | 无 | 无 |
| S-14 | `\| \|`（连续竖线）等病态输入 | 第二 `\|` 由 parsePrimaryType 在类型位置消费 → E100（现行） | 无 M4 交互；行为不变 | 无 | 无 |
| S-15 | 成员起始记号为 `Record`/`{`（非标记）携带 doc | B 锚记录、无人竞争 → 结算成功挂该成员 | 符合 ADR 决策 1「成员起始记号」文义 | 无 | 无 |

**并发/重启**：全链路同步纯函数、无 IO、无持久化中间态（唯一持久化语义 = 指纹，输入不变）；`compiledCache` 按文本内容键、失败不落缓存——无重启/迟到回调面。设计 §9 的判断成立。

## 8. 错误与恢复攻击

| ID | Failure | Current design behavior | Risk | Required revision |
| --- | --- | --- | --- | --- |
| E-1 | M4 结算算术缺陷（区间漂移/部分回收） | 丢失必破坏 `claimed + dangling.length === docTotal`（parser.ts:220-222）→ loud E100；假失配 → doc 留 dangling → E305（loud、可见） | 无静默丢失路径；失败模式均为 loud | 无 |
| E-2 | 手造 IR `memberDocs` 畸形 | D5 守卫 → TypeError → `{ok:false}` 恰一条 E100、无 derived 载荷；契约用例 17 对 4 类畸形逐类断言，mutation 表封死 `?? []` 静默规范化 | 已覆盖；错误分类与既有守卫族同族（不校验元素字符串性 = 与三槽守卫口径一致，不超面） | 无 |
| E-3 | 同一 IR 既有 E304 类内部错误又有畸形 memberDocs | 求值顺序确定（collectDocs 在 61 行、结构/值树之后）→ 先到者胜，单错误模型 | 行为确定、无伪成功 | 无 |
| E-4 | 部分完成伪成功 | `evaluate` 纯函数：成功原子返回、失败无 derived；契约 `expectE100` 显式断言 `'derived' in result === false` | 已封死 | 无 |
| E-5 | 回滚 | 单分支五文件；`git revert` 即回三锚位行为；契约红灯即能力缺口信号 | 无数据迁移/持久化兼容负担（§8.3 ③ 论证核验成立：新文本此前不可编译、无存量指纹可比） | 无 |
| E-6 | 契约交付即红（CI 门禁） | §13 风险 3 登记，仓库既有红灯交付先例 | 流程性风险已登记、非设计缺陷 | 无 |
| E-7 | E305 触发面扩大（回归） | 契约用例 8/9/10 绿用例冻结维持面 + 用例 11 措辞正则；不新增错误码 | 已封死 | 无 |

正常路径不变量（记账平衡、键序、条件在场）均有构造保证 + 金样本逐字节断言，无以 fallback 掩盖缺失的情形。

## 9. 契约影响审查

| API or contract | Missing or weak caller handling | Evidence | Required revision |
| --- | --- | --- | --- |
| `VfslType` union 变体 +`memberDocs?`（经 index.ts:60-66 既有导出） | 无——加性可选键；解构/switch/穷尽性零影响 | index.ts 导出面核讫；生产 IR union 唯一构造点 semantic.ts:223（grep 核讫） | 无 |
| `DerivedSchema` +`memberDocs?` | 无——emitter 显式挑五槽（emitter.ts:123-126/151-153）、doc-runtime 只读 `derived.structure/aliases` 等具名键（grep 抽查核讫）、`resolveSchemaAtPath` docs 切片只并 fieldDocs/markerDocs（#308 面外） | §2.3/§10 证据复核成立 | 无 |
| `evaluate` 失败语义扩展（手造 IR 畸形：ok:true → ok:false E100） | 无——生产链路 IR 恒为 parseVfsl 产物（构造性无畸形 memberDocs）；仓库内手造 IR 直调方仅测试 | index.ts:338-347 编排链核讫；ADR 决策 5 显式授权 | 无 |
| `parseVfsl`/`evaluate` 签名 | 不变（§8.1） | 核讫 | 无 |
| `compileSchemaEnvelope`/`getCompiled`（index.ts:330-368，含 deepFreeze） | 无——冻结覆盖新表为纯数据，无影响 | 核讫 | 无 |
| E305 消息文本消费方 | 无——全仓唯一消息断言为前缀正则；acceptance py 断言规格文本（#306 不动规格） | parse-vfsl-jsdoc.test.ts:127、root-convention.test.ts:193（码+位置）、vfsl_spec_acceptance.py | 无 |
| `StructureNode`/`ValueSchema`/`index`/判别式 | 不进 memberDocs（D4 明示）；`resolve-schema-at-path.test.ts:289` 断言合成 union 值节点恰 `['kind','members']` 保持成立 | 核讫 | 无 |
| 调用方矩阵完备性 | 弱（cosmetic）：doc-runtime 10 个文件的类型级消费由「类型消费者」通用行覆盖但未点名 | `grep -rln DerivedSchema packages/*/src` 结果 | 无（见 §14 O-2） |

## 10. 架构一致性与惯例审查

### 责任归属

| Behavior | Expected owner | Design location | Assessment |
| --- | --- | --- | --- |
| doc 记账与回收（第四类锚位） | parser（dangling/claimed/docTotal 事实与生命周期拥有者） | `parseUnionType` 内新增记录+结算，不动 `claimDocs` 与三锚位 | ✅ 行为落在事实 Owner；不复制底层状态机 |
| AST→IR 条件附加 | semantic.ts（既有转换层） | D3 | ✅ |
| derived 收集 + 手造 IR 守卫 | evaluate.ts（DocsTables/守卫族既有宿主） | D4/D5 | ✅ 复用 `put` 统一入口与顶层 catch |
| 消息正文 | semantic.ts:76（唯一生产点） | D6 | ✅ |
| 指纹 | fingerprint.ts 单一生产者（零改动） | DENY | ✅ |

### 相似能力对照

| Similar capability | Existing implementation | Proposed design | Consistent or divergent | Reason |
| --- | --- | --- | --- | --- |
| 挂载锚位回收 | M1/M2/M3 `claimDocs()` 同步回收 | M4 延迟回收（记录+终局核对） | 有依据的分歧 | ADR 0019 决策 4 明文要求延迟（坍缩判定需扫到末尾）；设计拒绝「急切回收+回滚」备选的论证（M3 竞争、放回顺序）经核验成立 |
| docs 三表收集 | `DocsTables` + `walkDocs` + `put` 守卫 | 第四表同构 + 条件稀疏差异常态化注 | 一致（差异明示） | ADR 决策 5 明文；与三表全量立行惯例的差异写进类型注 |
| 条件键纪律 | `exactOptionalPropertyTypes` + 条件展开（derived.ts:13 注释、evaluate.ts:201-204） | D3/D4 同款构造 | 一致 | 存量逐字节稳定的构造保证 |
| `<member N>` 路径文法 | evaluate.ts:381 既有合成段 | 零改动复用 | 一致 | 无平行文法 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
| --- | --- | --- | --- |
| doc 归属 | tokenizer leadDocs → parser dangling/claimed（记账不变量守护） | AST memberDocs / IR memberDocs / derived 表（逐层纯映射） | 无第二记账系统；`claimed + dangling.length === docTotal` 保持 |
| 指纹 | fingerprint.ts 单一生产者 | 条件键构造性不入场 | 无漂移（fingerprint.ts DENY） |

### 生命周期对称性

纯函数链路，无 register/dispose、acquire/release、后台任务面；pendings 随解析栈自然消亡；无不对称生命周期引入。✅

### 平行机制检查

| Candidate duplicate | Existing path | Proposed path | Disposition |
| --- | --- | --- | --- |
| 第二套 doc 记账 | dangling/claimed/docTotal | M4 并入同一记账（splice + claimed+=n） | 无平行 |
| 第二消息生产点 | semantic.ts:76 | D6 原位改 | 无平行 |
| 第二守卫入口 | put/appendDocs 族 | D5 同族延伸 | 无平行 |
| 新测试入口 | vitest `packages/*/test/**/*.test.ts` | 契约落在既有入口 | 无平行 |

无「行为落在错误 Owner / 绕过既有能力 / 双事实源 / 生命周期不对称 / 无迁移方案的相似能力异协议」阻断项。

## 11. 文件范围审查

| Path or scope issue | Evidence | Required revision |
| --- | --- | --- |
| ALLOW = parser.ts / ir.ts / semantic.ts / derived.ts / evaluate.ts | D1→parser、D2→parser、D3→ir+semantic、D4→derived+evaluate、D5→evaluate、D6→semantic——每项决策的落点均在 ALLOW，无遗漏（D6 消息在 semantic.ts✓）、无 ALLOW 项无决策对应 | 无 |
| DENY：tokenizer/fingerprint/validate*/resolve/shapes/resolve-schema-at-path/index/envelope/schemasource | 与 D7 冻结不变式逐条互洽；本评审核验这些文件的 union 分支确不需改动 | 无 |
| DENY：`packages/vfsl/test/**`（含 SA6 三件）冻结 | 契约先于实现录制（金样本常量在场）；「实现与断言冲突 = 实现错误」防止软化 | 无 |
| DENY：codegen/docs/tests/domains/其余 packages | #307/#308/#309 边界（C-1/C-5）；#306 验收面 = packages/vfsl（E-5） | 无 |
| 无理由扩张 / follow-up 掩盖必要项 | 未发现：非目标三票均有依赖边与承接票；「任务内必要条件均已具备」经本评审核验成立 | 无 |

## 12. 验收设计审查

| Requirement or risk | Proposed evidence | Gap | Required revision |
| --- | --- | --- | --- |
| AC1 两锚位 + 连续 doc | 契约用例 1-4（本评审核读实际断言：等长对齐、逐字 `toEqual`、JSON 往返、同排版负控） | 无 | 无 |
| AC2 坍缩/夹缝/M3 不双挂 | 用例 7-11（E305 锚点断言、marker docs 恰一次、成员表无「载体口径」、正则措辞） | 无 | 无 |
| AC3 条件稀疏 + 键文法 | 用例 12-14（键序精确 `toEqual`、member 2 不成键、嵌套 `X.k.<member 0>`/`V.<item>.<member 0>`、整键缺席 + 摘要） | 无 | 无 |
| AC4 存量逐字节 | 用例 18/19 + derived 金样本（IR/指纹/derived 三摘要精确值 + `sha256:v1:` 前缀 + JSON 不含 `memberDocs` 串） | 无 | 无 |
| AC5 手造 IR 守卫 | 用例 16/17（良性正控含全空数组、4 类畸形各 `expectE100`） | 无 | 无 |
| AC6 门禁 | 三条验证命令（契约 19/19 → 包全量 → tsc+pnpm typecheck） | 文件计数口径（见 §14 O-1） | 无（MINOR） |
| 观察行为而非源码文本 | 全部断言经 `parseVfsl`/`evaluate` 运行时返回值；无源码字符串断言、无 mock | 无 | 无 |
| 旧实现真红 | SA6 实测 12 红/7 绿、失败集合三次一致；红因逐条登记（§13） | 无 | 无 |
| 错误路径伪绿 | mutation 敏感性表 10 项（错误实现 → 必红用例）具体可执行；`?? []` 规范化被用例 17 封死 | 无 | 无 |
| 测试入口真实 | vitest include `packages/*/test/**/*.test.ts` 命中两文件；fixture（非 .test.ts）不被收集（配置核讫）；tsc include test/** 覆盖三新文件 | 无 | 无 |

## 13. Required revisions

无 BLOCKER、无 MAJOR finding。设计可安全进入实施（SA4）。

## 14. Non-blocking observations

| ID | Observation | Evidence | Suggestion（不阻断） |
| --- | --- | --- | --- |
| O-1 | 基线测试文件计数口径偏差：设计 §2.4/§12 转述 SA6 的「34 files / 619 tests」（32 存量 + 2 新），但 `packages/vfsl/test` 下 `.test.ts` 实数 33（31 存量 + 2 新；`find packages/vfsl -name "*.test.ts" \| wc -l` = 33，vitest include 面核讫、无子目录）。测试用例总数（607+12=619）无法静态复核、以 SA6 运行为准 | SA8 设计后复查 O-6 已预登记「SA7 复跑以实际输出为准」 | SA7 验收以 runner 实际输出为准；若文件计数读 33/619 或有出入，不构成缺陷（数字为转述口径，非契约断言） |
| O-2 | 调用方矩阵「未覆盖调用方：无」靠「类型消费者」通用行覆盖 doc-runtime（10 文件 import DerivedSchema 类型）；矩阵未点名。本评审抽查 doc-runtime 只读 `derived.structure/aliases` 等具名键，无整对象展开/摘要，行为零影响 | `grep -rln DerivedSchema packages/*/src`；doc-runtime 具名键访问抽查 | SA7 静态复核时可直接引用本评审该抽查结论；设计无需修订 |
| O-3 | §12 验证命令 1 带 `NODE_OPTIONS=--conditions=nomicore-source` 而命令 2/3 不带（沿袭 SA6 复审命令口径；SA6 实跑命令 2 未带旗标且成功） | SA6 §13/复审命令 | 无需修订；SA4/SA7 照抄命令时若遇模块解析差异，统一加旗标即可 |
| O-4 | SA8 复查 O-1/O-2（B 锚引用语义不得被「优化」掉；沉积只追加 + 逆序结算 + 先记录者下标更低三事实不得破坏）是 D1 正确性的实现前提，设计 §7 D1 正文已含等价论证但未显式列为「实现红线」 | SA8 设计后复查 §四 | 建议 SA4 实现时以注释形态将两条红线落进 `settleM4`/记录助手处（注释不是行为改动，不越 DENY——parser.ts 在 ALLOW） |
| O-5 | 契约用例 5（M3 优先叠写）断言 `JSON.stringify(first)` 中「载体口径」恰一次——依赖 marker docs 序列化；与用例 7 的 `memberDocs` 全序列化断言互补，二者合计封死双挂的两个方向 | 契约文件 163-175 行核读 | 无需动作（记录其充分性） |

---

## 附：评审方法与证据边界

- 本评审未运行测试、未启动服务、未 curl、未创建临时进程；全部结论基于源码/契约/ADR/规格的只读复核与机制独立重推。
- `requiresConflictRecheck`：本评审未发现需要重新执行 ADR 冲突检查的新风险（设计自报的四项复查理由已由 SA8 设计后复查 iteration 1 以 verdict clear 消解；本评审对该复查的关键代码主张做了独立抽查，无推翻）。故不提交冲突复查请求。
- `pass` 仅表示设计通过审查；实现与活链路验证仍属 SA4/SA7。

— SA2（Reviewer / Wallfacer），唯一产物为本文件。

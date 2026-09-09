# SA2 设计攻击评审 — Issue #272 `@nomicore/vfsl` `resolveSchemaAtPath`（ADR-0016 实施票）

- 角色：SA2（mabf-sa2）· 阶段 design-review · 迭代 1（SA2-F1 修订版复审）
- 被审对象：`wiki/raw/task_issue-272_design.md`（SA1 迭代 1「SA2-F1 修订版」，HEAD `a6b2a79`，branch `mabf/issue-272`——已实测核实）
- 评审产物：`wiki/raw/task_issue-272_sa2_review.md`（本文件，原位更新迭代 0 评审）
- Worktree：`/home/wangjian/nomicore-fix-issue-272`

---

## 1. Reviewed inputs

| 输入 | 状态 | 说明 |
|---|---|---|
| 任务简报 `wiki/raw/task_issue-272.md` | 已读 | Issue 正文快照（What to build 解析语义 6 条 + AC1–AC4）；Comments 空 |
| 设计 `wiki/raw/task_issue-272_design.md`（迭代 1） | 已读 | 482 行全文逐节攻击；重点复核 SA2-F1 修订面（§2-B15、§7-D7、§8.1/§8.3、§11、§12、§13-R6、§15 修订映射） |
| SA6 契约 `wiki/raw/task_issue-272_sa6_contract.md`（approve） | 已读 | 并对四枚契约测试文件本体逐行核读（红 34 + test-d 3 + 负控 11 实数核对成立——本次复核 `it` 块清点 4+9+5+3+5+2+6 = 34、负控 1+5+5 = 11，与 SA6 §12/§13 一致） |
| SA8 冲突报告 `wiki/raw/task_issue-272_conflict_report.md`（clear） | 已读 | 前置门禁（审简报），红线 1–5 |
| SA8 复审 `wiki/raw/task_issue-272_conflict_recheck.md`（clear，`requiresConflictRecheck:false`） | 已读 | 设计后复审：3 自报复查点 + 12 项增量裁决均 no-conflict；其第 7 项的「畸形派生物」定性继承迭代 0 错误前提——设计 §6 已显式更正（本评审 §5 核验更正合法性） |
| SA2 迭代 0 评审（本文件前一版，reject：1 MAJOR SA2-F1） | 已读 | 本迭代的修订输入；逐条验收其 Required change / Acceptance 清单（§13 修订台账） |
| `task_issue-272_relevant_decisions.md` | 不存在 | SA8 冲突报告已含 ADR 全集（14 文件）盘点；设计 §输入已声明以之替代——可继续 |
| 源码独立核验（迭代 1 新增深度） | 已做 | **B15 事实链五点全部独立复核**：parser.ts L456–472（parsePatternType 只收字符串字面量，L470 注释「合法性不在方言层校验（§9.1）」在案）；semantic.ts L230–231（`{kind:'pattern', regex: t.regex}` 原文透传零编译）；evaluate.ts L328–334（keyPatternOf 仅 resolveChain 取原文，E306 不变量对 `string & Pattern<...>` 键返回 regex——三类夹具 evaluate-ok 可达性成立）；pattern.ts（四类错误 L26–56、`MAX_PROGRAM_SIZE=10_000` L98、PatternTooLargeError 抛点 L607–610、`matchBudget` L761–763 = `min(4_000_000, max(8_192, 1_024·len+512·len²+16_384))`、`tick` L767–773 预算在 MatchCtx 内部强制、charge 仅为全局预算钩子、BFS 子集模拟 L776–921 每轮消费一字符/活闭包 ≤ |prog|）；validate.ts（compileOrCache L247–254 失败不入缓存、emitPatternError L256–268 四类 → 值级 issue + 意外异常 `throw err`、validateKeyPattern L271–280 单层 try/catch、WORK_LIMIT = 2×10⁸ L56）；validate-patch.ts（drillStep L114–178 未导出现状、`'<key>'` 槽 L136–144「键 Pattern 属值级，§3.3 规则 2」、KIND_ORDER L180–202、valueLens L74–82 文案 `值树引用环:/值树未声明别名:`、guardWalk root 守卫 L311–316、descendValues L472–509、run E100 L567–575）；resolve.ts（InternalError L26–31、walkRefChain L87–107）；derived.ts（ValueSchema L44–53 keyPattern 仅 Record 物化位、DerivedSchema L68–84）；evaluate.ts walkDocs L356–401（键文法逐字核对）；index.ts（matchPattern 双参薄包装 no-op charge 先例 L85–95，注释明示「引擎内部 matchBudget 封顶不依赖 charge」） |
| 全仓符号 grep（独立复现） | 已做 | `resolveSchemaAtPath` 在 `packages/vfsl/src/` 零命中（运行时缺口实证）；公共面仅契约四文件引用——设计 B1/B15 属实 |
| Git 状态实测 | 已做 | HEAD `a6b2a792`、branch `mabf/issue-272`、src/ 零改动；untracked = 契约四文件 + 六枚 wiki 工件——与 SA6 §16、设计 §输入一致 |

## 2. Verdict

**approve** —— 迭代 0 的唯一阻断项 SA2-F1（keyPattern 引擎异常通道的事实性误分类）**已完整解决**，且修订未引入新的 BLOCKER/MAJOR。核验要点：

1. **事实链证伪成立**：B15 五点（parser 推迟合法性 / semantic·evaluate 原文透传 / 四类引擎错误 / 写侧值级处理 / drillStep `'<key>'` 槽不验 Pattern）经本评审独立逐行复核全部属实——「evaluate ok 的合法派生物可携带不可判定 keyPattern」是源码事实，迭代 0 的「畸形派生物」定性确属误分类。
2. **修订通道正确且自洽**：四类引擎错误 → 内容级 fail-closed `SCHEMA_PATH_NOT_FOUND`（与失配同标记、同通道、不细分），四类之外意外异常 → 包装 `InternalError` 上抛；公共 throw 面收窄为纯可信域清单（ref 缺失/引用环/两树分歧/根缺失/derived 非对象/意外异常），与 §8.1 JSDoc 声明一致。
3. **BudgetExceeded 不保留 throw 的论证经数值复核成立**：budget 公式逐字核对；二次项 512·len² 在 len=89 时 = 4,055,552 > 4M（截断事实成立）；BFS 模拟步数 ≈ O(len × |prog|)、|prog| ≤ 10,000，数百字符敌意段 × 近限可编译程序即可逼近 4M 护栏——「可编译程序 + 任意敌意段长不可触发」不可证，fail-closed 是唯一与写侧对偶（validate.ts L263–264 值级先例）一致的选择。
4. **契约/ADR/证据合规保持**：修订不触碰 SA6 契约锁定的任何行为（引擎错误族为契约显式留白，SA6 §15-Q7）；失败码域、签名、模块落位、DENY 边界与已被 SA8 复审的版本一致；方向落在 ADR-0016「keyPattern 实测、不匹配即拒绝（fail-closed）」与简报「NOT_FOUND = 无任何候选接纳该段」的延长线上（§14 论证成立，无需冲突复查）。
5. 残余仅 3 枚新增非阻断观察（N8–N10：AGENTS.md 文案归属、§12 对偶锚措辞、敌意段最坏成本乘积）与 5 枚迭代 0 观察的延续（N1/N4–N7）；迭代 0 的 N2/N3 已在设计修订中更正，从观察表移除。

`pass`/`approve` 仅表示设计通过本阶段审查；实现正确性与活链路验证仍归 SA4/SA7。

## 3. 需求覆盖

| Requirement（Issue 正文/简报） | Design section | Assessment |
|---|---|---|
| 公开同步纯函数 `resolveSchemaAtPath(derived, path)` 经包 index 导出 | §1 目标 1、§8.1、§11 ALLOW（index.ts 导出块） | 覆盖；签名与 ADR-0016 签名块逐字一致（test-d 三断言相容，`parameter(1).toEqualTypeOf<readonly (string\|number)[]>` 已核）；B14「公共 API 仅经 src/index.ts」落实 |
| 返回路径终点语义 schema 投影（值子树 + 闭包别名表 + docs/aliasDocs 切片） | §8.1 `ReadDataSchemaProjection`、§8.4–§8.6 | 覆盖；四件套与 ADR-0016「投影体」逐键一致；ok 分支恰五键（红测试 L174–177 相容） |
| union 静态 any-member 扩展，与 drillStep 同构；多候选合成 union（无判别式缓存） | §7-D1、§8.3、§8.4 | 覆盖；结构侧逐字复用 `drillStep`（现行实现 L114–178 已核、三符号均未导出——「仅加 export 关键字」可达），合成节点恰两键 `['kind','members']` |
| Record keyPattern 正则实测、失配拒绝（fail-closed） | §8.3 值侧 object 匹配、D7(b) | 覆盖且**通道论证已更正**：失配与引擎四类不可判定错误同走内容级 NOT_FOUND——与写侧 validate.ts L256–280 值级处理、ADR-0016 L62 fail-closed 决策同族（本评审独立复核源码锚点全部属实） |
| optional 游走透明展开、返回子树原样保留 | §8.3 规范化、§8.4 | 覆盖；与红测试 5 断言逐条对齐（`['notes']`/`['config']` 原样、`['config','retries']` 展开、`[]` 整树保留） |
| ref 目标缺失抛 InternalError（可信域，不进结果联合） | §8.2 守卫、§8.3 值侧、§8.5 闭包 | 覆盖；两态（游走中/终点闭包）与红测试 L374–396 对齐；无顶层 catch（红线 1 落实）；值侧缺失/环文案与 valueLens（validate-patch.ts L79–80）逐字节对齐主张核验成立 |
| 预期失败两码结算、同步不抛错零 memo | §8.2、§9 | 覆盖；AC1 path 新鲜副本（`[...path]`、非数组回显 `[]`）落实；per-call 局部正则缓存（成功产物、失败不缓存）不构成跨调用 memo——与 index.ts matchPattern no-op charge 先例、validate.ts compileOrCache 缓存纪律同构 |
| docs/aliasDocs 键规约与三表同构；别名表只含传递闭包 | §7-D2/D3、§8.5、§8.6 | 覆盖；三类键与 walkDocs 键文法（evaluate.ts L356–401 本次逐字复核：字段/`<member N>` 0 基/`<item>`/`<key>` 恒空行/marker 就地/ref 终态不穿越）逐字同构；§8.6 对照表逐行与红契约断言及夹具字面量对账全等（含 `[]`、`['assets']` 规则推出的 {Audit.createdBy}、双删表 throw 两态） |
| AC4 vfsl 包测试/typecheck 绿 + 根仓无回归 | §12 | 覆盖；终点计数已按 N2 更正（560 基线含负控 11 + 红 34 = 594 运行时 + 类型面 3 + 新增 Pattern 家族；32 文件 = 31 + 1） |
| 非目标：不动 doc-runtime/namespace-runtime/registry、不实现 readData 组合 | §1 非目标、§11 DENY | 覆盖；与 ADR-0016 §分层与兼容面、SA8 冲突点 11 一致；新增「不为 keyPattern 拒绝细分失败原因」非目标有据（需新码/detail 字段，属破坏性加法） |

无目标扩员、无静默范围收缩。引擎错误通道为简报未明文、ADR 未规定位（SA6 §15-Q7 留白）——设计 D7(b) 钉死于授权通道内并新增独立测试锚（§11/§12），属合法设计裁量且方向向 ADR 明文收敛。

## 4. Owner评论覆盖

| Comment ID | Updated at | Design section | Assessment |
|---|---|---|---|
| —（无评论） | — | — | Issue comments 经 REST 读取为空响应（简报 §Comments、SA6 §2、SA8 报告与复审、dispatch 四处一致）——无 owner 要求需并入，设计 §4 的空表如实映射 |

## 5. 上游事实与SA8约束

| Fact or constraint | Design response | Assessment |
|---|---|---|
| 红线 1：ref 缺失必须 throw 逃逸公共面，不得 E100 收编/降级 NOT_FOUND；JSDoc 划清敌意/可信域边界 | §8.2（无顶层 catch）、§8.1 JSDoc（迭代 1 收窄后的可信域 throw 清单） | 落实且**更精准**：throw 清单现与实际可达集合一致（ref 缺失/值树引用环/两树分歧/derived 非对象或根缺失/引擎意外异常）；keyPattern 四类引擎错误明确排除出 throw——与红线 1 无涉（红线 1 管的是 ref 缺失不得降级，本次修订未触碰 ref 通道）。§8.3 的单层 try/catch 是局部通道翻译而非顶层 catch，红线 1 意图（InternalError 穿透）保持 |
| 红线 2：引用 vs 深拷贝由 SA1 钉死并写入 JSDoc | §7-D5：vfsl 层返回引用（B12 + getCompiled 深冻结），detached 深拷贝归 runtime 组合票 | 裁决有 ADR-0016 §交付纪律与 §分层公式双锚定；follow-up #1 硬约束传承（「活引用不逃逸 readData 公共面」验收断言建议在位）——义务不可裁撤（N4 延续） |
| 红线 3：同构不许分叉（不按值收窄/不读判别式） | §8.3 复用 drillStep 本体、§7-D6 全程不读 discriminator | 落实；剥光断言（红测试 L303–316）锚定 |
| 红线 4：引用「ADR 0003 §3.3 规则 1」须带出处限定词 | §2 B2/B15、§8.3 注释要求 | 落实（「issue #53 §3.3 规则 1，母法 ADR-0003 §3」） |
| 红线 5：AGENTS.md normative 清单补 ADR-0016 | §11 ALLOW 第 4 项（清单 + Boundaries 例外句，文案已按 D7 修订） | 落实；现行清单确为「CONTEXT + v1-spec + ADR 0001/0003/0007」（本次核验），补充正当。例外句把引擎错误 fail-closed 表述为「按 ADR-0016」——精度见 N8（非阻断措辞项） |
| SA8 复审第 7 项（迭代 0 口径：「引擎不可编译属畸形派生物（可信域通道）」） | §6 末行显式更正 + §7-D7(b) 重写 + §14 理由 3 | **更正合法且必要**：该 no-conflict 裁决自注「ADR 未规定、设计钉死」，其定性继承迭代 0 设计的错误事实前提（B15 证伪，本评审独立复核）。更正属设计级通道分类修正，非 ADR 决策覆盖；更正方向（fail-closed）向 ADR-0016 L62 与简报 NOT_FOUND 定义收敛，与 ADR 全集无冲突——§14「不需新冲突复查」论证成立（详见本文结论重述） |
| SA8 复审观察 3：in-flight 集合作用域 = 单次规范化 | §7-D9、§8.3 规范化 | 文本锚定在位（N6 延续为实现纪律） |
| SA6 §15 Q1–Q7 全部留白 | §7-D1–D7 逐条裁决 | 七项均在留白内；Q7 引擎异常子项经 D7(b) 修订后与契约锚定断言无冲突（契约未锁该族，负控 C3e 只锁失配家族） |
| 上游源码锚点（B1–B15） | §2 十五条 | **独立复核全部属实**：本次新增 B15 五点（parser L461–465/L470、semantic L230–231、evaluate L328–334、pattern L26–56/L607–610/L761–763、validate L245–280、validate-patch L136–144）逐一比对无漂移；budget 数值（512·89² = 4,055,552 > 4M）与「引擎内部预算独立于 charge」（tick L767–773 + index.ts L85–95 先例注释）核验成立 |

## 6. 设计内部一致性

| 检查 | 结果 |
|---|---|
| SA2-F1 修订面内部一致（§2-B15 ↔ §7-D7 ↔ §8.1 JSDoc ↔ §8.3 ↔ §8.6 两行 ↔ §9 ↔ §10 ↔ §11 ↔ §12 ↔ §13-R6 ↔ §6 更正行 ↔ §15 映射） | 一致：四类引擎错误在全部出现点均为「内容级 fail-closed NOT_FOUND、与失配同标记、不细分」；throw 清单各处枚举一致（ref 缺失/环/分歧/根缺失/非对象/意外异常）；无「附录承认、正文照旧」的伪修订 |
| D7(b) 分类表 ↔ 源码 | 逐行核验：四类的相位/携带者/写侧对偶锚（validate.ts L257–264）与 pattern.ts 现行实现一致；BudgetExceeded 预算公式与截断主张数值复核成立 |
| D8 ↔ §8.3 算法顺序 | 一致且经推演验证：失败分类只发生在结构侧 `drill.out.size === 0` 分支（形态集分类），keyPattern 判定只发生在结构侧放行后的值侧——「引擎错误不可能把 INVALID 例翻成 NOT_FOUND」的形状先行主张成立（`['r',7]` → forms={map}+number 段 → INVALID；`['r','k']` → 结构放行 + 值侧引擎拒绝 → NOT_FOUND） |
| §8.6 对照表 ↔ 红契约断言 + 夹具字面量 | 逐行对账全等（本次含 `['assets']` 行的规则推演 {Audit.createdBy} 与夹具 ALL_NONEMPTY_DOCS、`['u','x']` 空切片与 U 内无注释位、双删表两态与 L374–396）；`['keywords',0]` 读侧 ok 无直接红锚（写侧合法性由负控 C3a `writeOk(['keywords',0])` 锚定）——属 N7 类未锚定路径，行为由通用规则 + ⟺ 命题推出 |
| 计数一致性（迭代 0 N2） | 已更正：§5 基线行与 §12 AC4 行均为「560 已含负控 11；终点 = 594 + 新增 Pattern 家族 + 类型面 3；32 文件」——与 SA6 §13 证据 3 相容，幻影计数消除 |
| 语法路径模板笔误（迭代 0 N3） | 已更正：§8.3 union 分支 `+ '.<member ' + i + '>'` 与 D2/B10 统一 |
| 死引用/旧 API | 未发现：全部引用符号（drillStep/DrillResult/structureLens/InternalError/walkRefChain/compile/match/四枚 Pattern 错误类）在源码在案；drillStep/DrillResult/structureLens 现均未导出（L100/L114/L63），「仅加 export 关键字」的 ALLOW 声明可达 |
| 措辞级小瑕 | §12 SA2-F1 行与 D7 理由 2 把写侧对偶概括为「负控 C3e 家族」——C3e 实锚**失配**家族（「Record 键 … 不满足 Pattern 正则」），引擎四类的写侧对偶是 validate.ts L257–264（D7 分类表已正确引用）。概括不改变结论，见 N9 |

## 7. 状态机与并发攻击

纯函数设计，无跨调用状态机；按「以纯度承诺豁免的每类攻击逐一验证其承诺前提」执行（迭代 1 增补正则通道相关核验）：

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
|---|---|---|---|---|---|
| C1 | 任意调用中 | 同一 `derived` 并发/重入多次调用 | 无共享可变态；结果确定 | 无缺口：游走集/闭包集合/per-call 正则编译缓存全部调用局部（§8.3/§9）；缓存只存**成功产物**且键为正则串——失败不缓存、同调用内重触达确定性重拒（镜像 compileOrCache L247–254 语义，已核） | — |
| C2 | 值候选含 ref 链 | 合法递归别名（`Node = { next: YMap<Node\|null> }`）深路径逐段游走 | 每步规范化解析一层 ref，不误报环 | 无缺口：in-flight 集合以单次规范化为界（§7-D9/§8.3，镜像 drillStep.expand L164–174 逐跳式） | 实现纪律复述（N6），非设计缺口 |
| C3 | 值表带真环（手造 `A→ref B→ref A`） | 游走触达该链 | loud InternalError「值树引用环: …」（文案与 valueLens L79 逐字节一致——已核） | 无缺口（§8.3）；结构侧同输入经身份去重静默收敛，与写侧 guardWalk 同一代码路径，⟺ 命题保持 | — |
| C4 | 终点为 ref/optional/合成 union | 再下钻一段 / 直接返回 | 下钻按规范化推进；返回原样保留 | 无缺口（§8.3/§8.4）；optional 仅字段值位（B7/derived.ts L52 已核） | — |
| C5 | `path` 为非数组 / 含 null/undefined/boolean 段（敌意） | 入口（先于一切 derived 访问） | INVALID + 新鲜副本（非数组回显 `[]`） | 无缺口（§8.2 步 1）；NaN/Infinity 走 typeof number → 段匹配层确定拒绝（对象位非 string / 数组位非整数） | — |
| C5′ | 敌意超长段（`'a'.repeat(N)`）触达可编译重 Pattern | 值侧 Record 槽 match | 引擎步数预算耗尽 → `PatternBudgetExceeded` 被单层 try/catch 捕获 → 内容级拒绝（不 throw、不冒充失配之外的任何形态） | 无正确性缺口（§8.3/D7(b)）；成本量级见 N10（非阻断） | — |
| C6 | 递归深度 | 深嵌套派生物 + 深路径 | 无栈溢出新面 | 论证成立：`MAX_TYPE_NESTING=100` 求值期封顶 + 闭包名集去重（§9）；正则编译产物 ≤ 10_000 指令（pattern.ts L98/L607–610 已核）不引入新深递归面（BFS 模拟无回溯栈/无递归，pattern.ts 文件头自证） | — |

## 8. 错误与恢复攻击

| ID | Failure | Current design behavior（迭代 1） | Risk | Required revision |
|---|---|---|---|---|
| E1（原 SA2-F1，**已解决**） | keyPattern 引擎异常（编译期三类 + 运行期 BudgetExceeded）——合法 evaluate-ok 派生物携带不可判定 Pattern，读路径触达该 Record 段 | D7(b)：四类 `instanceof` 精确识别（镜像 emitPatternError 分支形状）→ 与失配同标记的内容级拒绝 → `SCHEMA_PATH_NOT_FOUND`；四类之外意外异常 → 包装 `InternalError` 上抛；per-call 缓存只存成功产物 | 无（修订后）：①与自身可信域 JSDoc 前提一致（合法派生物不 throw）；②写读同构恢复（写侧同族为值级 issue 拒绝，validate.ts L256–264 已核；结构侧 drillStep 放行 `'<key>'` 槽不验 Pattern 的在案注释与值级分类互证）；③ADR-0016 组合面 `schema:null` 两码吸收面完整（无未申报 throw 通道）。验收三条件（每类显式处置+正确可达性事实 / §12 测试构想 / JSDoc 清单一致）全部满足（§13 台账） | — |
| E2 | ref 缺失（值游走中 / 终点闭包） | throw InternalError，不进联合（§8.3/§8.5；文案对齐 valueLens） | 无（红线 1 逐字落实；红测试两态锚定） | — |
| E3 | 两树分歧（结构放行、值零候选、无 keyPattern 拒绝标记） | throw InternalError（D7(a)，触发面经迭代 1 收窄表述） | 低：合法派生物唯一系统性分歧（YPlainArray、Record 值位物化）均被双游标吸收；keyPattern 拒绝标记（含引擎四类）在场的空候选不算分歧——正确区分「内容级拒绝」与「手造/篡改」 | — |
| E4 | derived 非对象 / structure 非 root / values 无 ROOT | 显式守卫 → InternalError（§8.2 步 2–4；guardWalk L311–313、descendValues L475 先例已核） | 无 | — |
| E5 | 失败后重试 / 重复调用 | 纯函数零部分状态，重试安全、内容全等；keyPattern 编译失败不缓存 → 重复触达确定性重拒（§9） | 无 | — |
| E6 | 消费者变异返回的 valueSchema/aliases（引用共享） | JSDoc 明示 + derived 不可变契约（B12）+ 组合层深拷贝（D5/follow-up #1） | 中（R4 自登，与 derived 既有风险同级、非本票新增放大）；SA8 复查点 3 已裁边界归属 | 维持 D5 + N4（组合票义务不可裁撤），无需改设计结构 |

正常路径不变量检查：无静默 fallback、无伪成功；「引擎不可判定 = 缺失接纳证明 → 拒绝该候选」是 fail-closed 的诚实形态（不冒充「确定不匹配」、不上升可信域崩溃），且结果联合对失配/不可判定同形的不细分已作为非目标显式申报（§1）+ 残余记录（R6①）。

## 9. 契约影响审查

| API or contract | Missing or weak caller handling | Evidence | Required revision |
|---|---|---|---|
| 新公共导出 `resolveSchemaAtPath` + 2 类型（index.ts） | 无既有调用方可破坏——独立 grep 全仓 src 零命中（本次复现）；对既有导出为纯加法 | 本评审独立复现 grep；index.ts 现状 | — |
| `@nomicore/vfsl` 包入口既有消费者 | 无：全部经包入口导入，加法兼容 | doc-runtime 消费面（readLogicalValueAtPath 现无 keyPattern seam——其旧双参锚已在 doc-runtime 测试中标记「不移植的旧锚」，无第二读取侧引擎消费先例可冲突） | — |
| `validate-patch.ts` 模块级新增导出 drillStep/DrillResult/structureLens | 无：非 index 公共面；包内跨模块消费先例在案（resolve.ts→validate-patch、validate.ts 同款）；零行为改动（三符号现均未导出，已核 L63/L100/L114） | validate-patch.ts 现状 | — |
| SA6 契约四文件 | 实现禁改（§11 DENY）——引擎错误族锚定走**新增** `resolve-schema-at-path-pattern-errors.test.ts` 而非改契约，正确规避「实现反改契约自证」 | §11 ALLOW/DENY；四文件在仓（本次逐行核读） | — |
| test-d 类型面 | 设计 §8.1 类型形状与三断言逐项相容（`readonly (string\|number)[]` 参数、失败 path `toBeArray`、ok 分支无 code） | resolve-schema-at-path.test-d.ts L36–65（本次核读） | — |
| 未来组合票（namespace-runtime readData / registry 类型跟随） | 范围正确外移；**迭代 0 的组合面担忧已消除**：本函数对合法派生物不产生两码之外的 throw（引擎错误并入 NOT_FOUND），`schema:null` 两码吸收面完整 | §10 行、§8.7 R2 行；ADR-0016 §结果形状 L22 | — |

## 10. 架构一致性与惯例审查

### 责任归属

| Behavior | Expected owner | Design location | Assessment |
|---|---|---|---|
| 路径合法性判定（⟺ 命题的写侧半张脸） | validate-patch `drillStep`（既有事实 Owner） | §8.3 结构侧逐字复用（非重写） | 正确：单源复用是同构命题的最强形式（红线 3） |
| 值语义投影产出（值树域） | vfsl 包（ADR-0016 指派） | §8.3 值侧新算法于新模块 | 正确；无既有可复用值域候选集游走（descendValues 单游标归一化，B9 已核） |
| keyPattern 判定引擎与错误分类 | pattern.ts（唯一引擎）+ validate.ts（错误分类先例 Owner） | §8.3 经 compile+match 复用；四类分类镜像 emitPatternError 分支形状 | 正确复用 + 正确跟随先例 Owner——修订后读侧分类与写侧同源同形，无平行分类语义 |
| 深拷贝边界 | namespace-runtime（ADR-0016 §交付纪律明文） | D5 显式外移 + follow-up #1 | 正确 |

### 相似能力对照

| Similar capability | Existing implementation | Proposed design | Consistent or divergent | Reason |
|---|---|---|---|---|
| 结构侧逐段下钻 | drillStep | 复用本体 | 一致 | 模块级导出，零分叉 |
| 值域 ref 链解析 | walkRefChain + 透镜族（「while 循环算法恰一份」纪律，resolve.ts L16–19 已核） | D9：候选展开内逐跳 + 文案对齐 valueLens | 一致 | 无平行算法 |
| 引擎错误 → 值级/内容级收敛 | validate.ts emitPatternError（四类 instanceof 分支 + 意外异常 throw，L256–268） | §8.3 单层 try/catch 同形状（四类 → 拒绝标记；意外 → 包装 InternalError） | 一致 | 读侧因无顶层 catch 而把「意外异常 → E100」翻译为「包装 InternalError」——通道纯度（公共面只见 InternalError）保持，属忠实翻译而非分叉 |
| 正则编译缓存 | validate.ts compileOrCache（ctx 局部、失败不缓存） | §8.3 每调用局部 Map（成功产物） | 一致 | 不构成跨调用 memo（SA8 复审第 8 项同载） |
| no-op charge 消费 | index.ts matchPattern `() => {}`（L93–95，注释明示引擎内部预算独立于 charge） | §8.3 `match(compiled, seg, () => {})` | 一致 | 直接先例在案 |
| 失败码 + path 回显 | validate-patch `[...path]` path-reporting 兼容行为 | §8.2/§8.3 `[...path]` 全量新鲜副本 | 一致（加法严格化） | — |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| 路径合法性 | drillStep（单一实现） | 读侧零复制判定 | 无（复用本体） |
| 值语义/别名/文档 | derived.values/aliases/三表（冻结形状） | 投影为切片/引用，键不发明、内容逐字 | 无（D2 + 表扫描以表为源） |
| 语法路径文法 | walkDocs（求值器） | §8.3 脊柱键生成逐字镜像 | 低（文本镜像而非代码复用——R1 自登；契约 ⊆ 不变量 + 键集断言兜底） |
| 引擎错误身份/预算 | pattern.ts（四类 + matchBudget） | D7(b) 分类表逐类引锚 | 无（分类表行号经本次复核无漂移） |

无第二事实源、无镜像状态、无文件 marker、无标签反推。

### 生命周期对称性

纯函数、零资源分配（§8.7 R1/§9）：无 register/dispose、无订阅、无后台任务——对称性平凡满足；失败即返回或 throw，无部分状态逃逸、无需清理。评估：通过。

### 平行机制检查

| Candidate duplicate | Existing path | Proposed path | Disposition |
|---|---|---|---|
| 第二套 ref 解析循环 | walkRefChain 透镜族 | 候选内逐跳（expand 先例） | 非平行 |
| 第二套 docs 键空间生成 | walkDocs | 表扫描 + 前缀匹配（以表为事实源） | 非平行 |
| 第二套引擎错误分类语义 | validate.ts emitPatternError | 同形状 instanceof 分支（读侧通道翻译） | 非平行（语义同源，通道按 ADR-0016 差异化：值级 issue vs 内容级失败码——有 ADR/写读分层依据） |
| 跨调用缓存 | compiledCache（getCompiled 域） | 无（per-call 局部） | 非平行 |

## 11. 文件范围审查

| Path or scope issue | Evidence | Required revision |
|---|---|---|
| ALLOW：新模块 / index.ts 导出块 / validate-patch 三处 `export` / AGENTS.md 两行 / **新增 `resolve-schema-at-path-pattern-errors.test.ts`** / 设计文档 | 六项均有正文锚点（D9/AC1/D1/红线 5/§12 SA2-F1 锚/SA1 交付物）；新测试文件是引擎错误族的唯一合法锚定位（契约四文件在 DENY——「不改契约自证」纪律下只能新增文件），且落在 vitest include `packages/*/test/**/*.test.ts` 与包 tsconfig `test/**` 覆盖内（vitest.config.ts L15/L20 已核）；validate-patch 改动经核为「仅加 export 关键字」可达 | 无 |
| DENY：契约四文件 / derived.ts / resolve.ts / evaluate·validate·pattern·**parser·semantic** / README·package.json / doc-runtime·namespace-runtime·registry / docs·CONTEXT / domains·apps·tests·根配置 | 与 §1 非目标、ADR-0016 分层、ADR-0003 冻结逐条对应；迭代 1 新增 parser.ts/semantic.ts 入 DENY 并附「不得前移 keyPattern 合法性校验来消除引擎错误可达性——那是另一张票的语义变更」——正确的范围闭环（防实现方以语义变更消解设计前提） | 无 |
| follow-up（runtime 组合 / registry 跟随 / generation 缓存 / 拒绝原因细分） | 均为 ADR-0016 明文指派或显式申报的后续演进，非本票必要项被推迟 | 无（N4：组合票深拷贝义务不可裁撤） |

无 ALLOW 无理由扩张；DENY 与正文无冲突。

## 12. 验收设计审查

| Requirement or risk | Proposed evidence | Gap | Required revision |
|---|---|---|---|
| AC1–AC3 全部行为 | SA6 红 34 + 类型 3（动态接缝机制 L70–86 属实——红灯原因真实）+ 负控 11（期望字面量与真实求值器对账） | 无 | — |
| 测试观察行为而非源码文本 | 全部断言 toEqual/键集/多集/throw 实例；无 grep/skip/only/env | 无 | — |
| 同构命题持续成立 | 负控 C3 写侧矩阵（7+4+3）+ 剥光判别式断言 + drillStep 本体复用；pattern-errors 组与 C3e 并列成「不可判定/失配 Pattern 家族」对偶锚 | 无 | — |
| 纯度/确定性/JSON 往返/递归别名 | 红「两次调用内容全等 + JSON 往返」+ 单名闭包断言 | 无 | — |
| **SA2-F1：keyPattern 引擎四类错误不进 throw 通道** | **新增 `resolve-schema-at-path-pattern-errors.test.ts`**：三枚确定性夹具（`Pattern<"[">` 编译失败 / 反向引用子集外 / {n,m} 展开超限）各含 parse+evaluate ok 前置断言；断言 `['r','k']` → NOT_FOUND、`['r',7]` → INVALID、全程不 throw InternalError；可选长敌意段探针（仅锚「不 throw」） | 无（迭代 0 的「无任何验收锚定」缺口已补）。**夹具可行性经源码核验**：parser 对 `Pattern<"[">` 只收字符串字面量（L461–465）→ parse ok；keyPatternOf 对 `string & Pattern<…>` 键返回 regex 原文（evaluate.ts L331）→ evaluate ok 且值树携带 keyPattern；`[` 触发 PatternCompileError（pattern.ts L452/L505 家族）、`\1` 触发 PatternUnsupportedError（L427）、{n,m} 展开超 10_000 指令触发 PatternTooLargeError（L607–610）——三枚均确定性可达 | — |
| BudgetExceeded 行为锚定 | 探针仅断言「不 throw InternalError」，是否触发取决于引擎负载（不作必要条件）——诚实处理；确定性断言由「四类共用单点分类器（D7/§8.3）」+ 前三枚夹具覆盖分类路径 | 无（R6② 如实自登） | — |
| AC4 零回归门 | §12 映射 + SA6 §13 基线；终点计数已更正（594 + Pattern 家族 + 类型面 3；32 文件） | 无（N2 已解决） | — |

## 13. Required revisions

**无 BLOCKER / MAJOR / MINOR 级阻断项。** 迭代 0 的唯一 MAJOR 已解决，修订台账如下（稳定 Finding ID 保留用于映射，不再列为阻断）：

| Finding ID | 迭代 0 要求 | 修订验证（本评审独立核验） | 状态 |
|---|---|---|---|
| SA2-F1（MAJOR） | 区分编译期三类与运行期 BudgetExceeded；编译期三类推荐 fail-closed NOT_FOUND 或给出不依赖错误前提的强论证；BudgetExceeded 保留 InternalError 须证不可触发，否则同 fail-closed；同步更正 §7-D7/§8.3/§13-R6/§8.1 JSDoc/§6 SA8 行；测试构想入 §12 | ①每类显式处置 + 正确可达性事实：D7(b) 分类表四行（相位/携带者/可达性/通道/写侧对偶锚）逐一与 pattern.ts/validate.ts/parser.ts/semantic.ts/evaluate.ts 现行源码对账成立；②BudgetExceeded 论证数值复核：budget 公式逐字一致、512·89² = 4,055,552 > 4M、模拟步数 O(len×\|prog\|)（每轮消费一字符、活闭包 ≤ \|prog\| ≤ 10_000，pattern.ts L759–921 已核）、「可编译程序 + 敌意段长不可触发」确不可证——同走 fail-closed 的选择正确；③§12 新增测试行 + §11 新增测试文件（可行性核验见 §12）；④JSDoc throw 清单与实际可达集合一致（§8.1 ↔ D7(a)/(b) ↔ §9 三通道三分互检）；⑤§6 SA8 复审第 7 项定性显式更正（删除线 + 更正说明，非静默）；⑥未选第三形态/新失败码（否决备选 (c) 记录在案）→ 按 SA2 迭代 0 预先裁决不触发 SA8 复查 | **已解决（verified）** |
| N2（计数重复计入） | 改正 §12 终态计数 | §5/§12 均已更正为「560 含负控 11；终点 594 + Pattern 家族 + 类型面 3」 | 已解决 |
| N3（union 模板缺 `>`） | 统一文法 | §8.3 已更正为 `'.<member ' + i + '>'` | 已解决 |

## 14. Non-blocking observations

| ID | Observation |
|---|---|
| N1 | D8 混合形态（map∪array）下不镜像 KIND_ORDER 字面取序（R2 自登）：迭代 0 已推演确认全部契约锚定例两规则同结果；本次复核维持——偏差仅存于未锚定混合形态，D8 规则更忠于简报两码定义，回退路径已定位为分类器一处 |
| N4 | D5 引用返回的安全前提链（JSDoc 逐字落实 → AGENTS.md 例外句 → 组合票深拷贝义务）三项缺一不可；follow-up #1 已明含「活引用不逃逸 readData 公共面」验收断言建议——该义务不得从后续组合票裁撤（SA8 复查点 3 移交的硬约束） |
| N5 | 同名 ref 多候选 → 双成员同内容合成 union（R5）：确定性成立、无正确性影响；实现按 §8.4「身份去重仅按对象身份」执行即可 |
| N6 | 值侧规范化 in-flight 环检测作用域 = 单次候选规范化；实现照 drillStep.expand 逐跳式即可，合法递归别名深路径不得误报环 |
| N7 | 契约未锚定路径（`['u']`、ref-ROOT、深 Record 链、混合形态、`['keywords',0]` 读侧 ok——写侧合法性已由 C3a 锚定）经通用规则推演行为确定且与 ⟺ 命题、walkDocs 键文法一致；pattern-errors 夹具路径族（`['r','k']`/`['r',7]`）已由 §8.6 两行钉定并新增测试锚 |
| N8 | §11 AGENTS.md 例外句把引擎错误 fail-closed 表述为「按 ADR-0016 …收敛」：ADR-0016 L62 明文的是**失配** fail-closed，引擎错误通道属「ADR 未规定、设计钉死」（设计 §6/§14 自己已如此声明）。建议实现落笔时改为「按 ADR-0016 fail-closed 语义的延长线（设计 D7 钉死）」或括注 issue #272 设计 §7-D7，防后来者误读为 ADR 明文——纯措辞精度，不阻断 |
| N9 | §12 SA2-F1 行与 D7 理由 2 概括写侧对偶为「负控 C3e 家族」：C3e 实锚失配家族（「Record 键 … 不满足 Pattern 正则」），引擎四类的写侧对偶是 validate.ts L257–264（D7 分类表已正确逐行引用）。概括不改变结论；实现方照 D7 分类表行号执行即可 |
| N10 | 敌意段最坏成本为**乘积界**：§9「敌意超长段成本由引擎步数预算封顶」精确于**单次 match**（≤ 4M ticks + 编译 ≤ 10_000 指令，已核）；跨候选 × 路径段累计上界为 O(路径长 × 候选数 × 4M)。该量级与写侧全局 WORK_LIMIT = 2×10⁸（validate.ts L56，已核）所容忍的量级同阶，且需敌意 schema（近限 Pattern）× 敌意路径（超长段）合作才可达，无正确性影响——建议 §9 补一句乘积界说明即可；缓存/预算演进按 ADR-0016 交付纪律留 profiling 驱动 |

---

## 评审结论重述

- **Verdict：approve**。迭代 0 唯一 MAJOR（SA2-F1）经独立源码核验确认已完整解决：事实链（B15）属实、通道分类（D7(b)）正确、BudgetExceeded 可达性论证数值成立、JSDoc/AGENTS.md/测试锚/SA8 行更正全部到位；修订未引入新的阻断问题，设计主体（D1–D6、D8、D9、§8 算法、§11 范围、§12 映射）与迭代 0 已确认的裁决一致且未被修订扰动。
- `requiresConflictRecheck`：**false**——修订未改变签名/码域/模块落位/导出面/DENY 边界（SA8 已复审的契约面不变）；唯一语义增量（引擎四类错误 throw → fail-closed NOT_FOUND）落在 ADR-0016「keyPattern 实测、不匹配即拒绝（fail-closed）」与简报 NOT_FOUND 定义的延长线上，未引入第三失败码或新 throw 形态（D7 否决备选 (c)），按迭代 0 预先裁决不新增 ADR 冲突面；SA8 复审第 7 项的旧定性更正属设计级事实修正（其自注「ADR 未规定、设计钉死」），非 ADR 决策覆盖。若 Host 仍希望对第 7 项存档表述做一致性确认，可随实现票顺带复核，非必要门禁。
- `approve` 不替代 SA4（实现审查）与 SA7（活链路终验）的后续验证职责。

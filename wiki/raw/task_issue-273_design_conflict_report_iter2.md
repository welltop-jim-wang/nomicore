# 冲突门禁报告（设计后复审 · 第 2 轮，SA2 F-1 修订版）— Issue #273 namespace-runtime + namespace-registry：readData 成功分支返回语义 schema 投影（ADR 0016）

## 1. Reviewed subject

- 被审对象：**design（iteration 1，F-1 修订版）** — SA1 设计 `wiki/raw/task_issue-273_design.md`（469 行；主线 D1–D7 不变 + 新增 **D3b hardened path 规范化守卫**、D4 双域划界改写、D8 新验收测试文件、§14 评审修订映射、§15 窄域复查请求）
- 复审触发：SA1 自报 `requiresConflictRecheck: true`（设计 §15），范围自述收窄为一点辖域确认（SA8 iteration-1 复审 §10 清单第 1 条「组合层无 catch」字面措辞 vs D3b 内层 try）；本复审全量过修订面、以 **D3b 敌意 path 守卫 + null 收敛 + InternalError 边界保持** 为焦点深审
- 阶段：设计后冲突复审第 2 轮（SA2 reject F-1 → SA1 修订之后、实现之前）；上游链：前置门禁 clear（iteration 0）→ SA6 approve → SA1 iteration 0 → SA8 设计复审 clear（iteration 1）→ SA2 reject F-1 → SA1 iteration 1（本对象）
- Worktree：`/home/wangjian/nomicore-fix-issue-273`（branch `mabf/issue-273`，HEAD `1acd9e9`；`git status` 实测：生产实现零改动，仅 SA6 契约 5 文件 + wiki 快照未跟踪）
- 裁决人：SA8 Conflict Gatekeeper（mabf-sa8，iteration 2）

## 2. Inputs and decision set

- 冲突基准（逐个核读，与本任务两轮前置/复审同一基线）：`docs/adr/` 全集 **14 文件**（0001–0012、0014、0016；0013/0015 不存在）+ 根 `CONTEXT.md`（173 行）+ 模块 AGENTS 收录的决策句（`packages/vfsl/AGENTS.md` 可信域 throw 例外句；`packages/doc-runtime/AGENTS.md` schema 无关读取句；docs/AGENTS「wiki/raw 为证据非规范」）
- readData 语义发言者唯一性复核：`grep -l readData docs/adr/*.md docs/protocols/*.md` 仅命中 **ADR-0008 + ADR-0016**（实测）——F-1 修订未引入第三个决策文本
- 对照输入（证据，非基准）：任务简报 `wiki/raw/task_issue-273.md`（行为要点 6 + AC1–AC5）、SA6 契约 `wiki/raw/task_issue-273_sa6_contract.md`（approve）、SA2 评审 `wiki/raw/task_issue-273_sa2_review.md`（reject，F-1 MAJOR 唯一阻断）、SA8 前置门禁 `wiki/raw/task_issue-273_conflict_report.md`（clear，红线 7）、SA8 设计复审 iteration-1 `wiki/raw/task_issue-273_design_conflict_report.md`（clear，D4 no-conflict；§10 实现阶段复查清单已 armed）
- Issue comments：**空**（本迭代 dispatch 记 REST 当前读取 none）——无 owner 要求需并入、无 override 声明在案、无范围收敛指令
- 被 superseded 条款不计入约束：同 iteration-1 报告 §2（ADR-0007 open/read 编排、ADR-0008 原 D8 封口句与旧形状、ADR-0009 旧 Registry key）
- 源码事实核验（非独立基准， grounding F-1 证据链）：
  - `packages/vfsl/src/resolve-schema-at-path.ts` L94–101（path 形状守卫经 `for (const seg of path)` 迭代协议）+ L134（主循环同款）+ L99/L138/L158（失败回显 `[...path]` spread 同走迭代协议）+ 头注「本函数无顶层 catch」与「`path` 属敌意通道：非数组 → SCHEMA_PATH_INVALID；含非 string|number 段 → SCHEMA_PATH_INVALID」——设计 B14 属实（本轮亲核）
  - `packages/doc-runtime/src/read.ts` L60（G0 `Array.isArray`）→ L72–73（`for (let i…)` + `path[i]` 索引导航，零迭代协议）→ L79（缺席吸收「中间缺失立即结束」——`['absent-key', Symbol()]` 尾段从不被值通道检查）→ L128–134（E100 顶层 catch）→ L139–162（`safeSpreadPath` 内层 try + F1/P10 Proxy 威胁模型注释）——设计 B15 属实（本轮亲核）
  - `packages/vfsl/src/index.ts` grep：`InternalError` 仅注释提及（L121），类定义在 `resolve.ts` L26 未经 index 导出——设计 B16 / SA8 移交项 2 / SA2 N-2 属实（本轮亲核）
  - SA6 契约透明性：red 15 / control 6 / 2 test-d 锚 grep `Symbol|Proxy|defineProperty` **零命中**（实测）——契约全部使用同 realm 普通数组；夹具 `makeReadyRuntime` 导出在位（fixture L93，D8 import-only 可行）

## 3. Decision analysis

### 3.1 焦点一：D3b 敌意 path 规范化守卫与 null 收敛（F-1 修订核心）

**设计行为**（§7-D3b、§8.2 状态机、§8.3 R1）：`normalizeReadPath` 在 schema 通道内、调用 resolver 之前——仅以属性读（`length`/`[i]`/`Symbol.iterator` 同一性比较，**绝不调用迭代协议**）扫描并拷贝入普通数组，全程内层 try；任何异常、迭代器非标准、长度异型或非 string|number 段 → `schema:null`；通过校验后传副本给 resolver。敌意收敛走情形③既有 `null` 出口，不新增失败分支/稳定码/缺席原因子通道。

| # | Decision | Clause | Subject behavior | Classification | Evidence | Required action |
|---|---|---|---|---|---|---|
| A1 | ADR-0016 §结果形状 L22 | null 三情形之③「静态解析失败（见下）」——「见下」指向解析语义节；该节 L57 把 `SCHEMA_PATH_INVALID` 定义为「**非数组/野段形状守卫**」 | 敌意/异态 path（exotic 数组、Proxy、野段）在组合层收敛 `schema:null`，未触达 resolver | **implements-existing-decision** | 决策集自身的分类学把「非数组/野段形状」置于静态解析失败 → INVALID → null 通道内；#272 落地的 resolver 头注同文（「`path` 属敌意通道：非数组 → INVALID；含非 string\|number 段 → INVALID」）。D3b 只是把这类输入在**触发 resolver 的迭代协议消费**（对 exotic 数组会裸抛而非返回 INVALID——B14 亲核）之前收敛到决策文本已规定的同一出口：调用方可见结果（ok 恒真 + schema:null）与 ADR 文义逐字一致。**不是第 4 类 null 情形**：敌意形状本就栖于情形③的「野段形状守卫」辖域 | 无 |
| A2 | ADR-0008 §读取能力 L28 | 「预期路径、载体和 lifecycle 失败使用同步结果联合，**只有 internal bug 才抛异常**」 | 敌意输入触发的异常被 D3b 内层 try 收编 → null，绝不外抛 | **implements-existing-decision** | 敌意输入触发的 throw 不是 internal bug → L28 禁止其走 throw 通道 → 只能落结果联合 → ok:true + schema:null（值语义由 doc-runtime 决定，零影响）。iteration-0 无守卫直递 resolver 恰使敌意输入触发生产可达非 InternalError throw——**违背 L28**；SA2 F-1 正确识别，本版是修复而非新决策。L28 对两域同真：敌意域收敛（D3b）、可信域 throw（D4 保持 internal-bug 通道） | 无 |
| A3 | ADR-0008 修订节第 3 条 L177–178 | 「原规则保持：读取保持 schema 无关、不进 sequencer、失败通道……与读取保留不变量均不变」 | D3b 保持读同步、sequencer 外、零副作用；失败三分支原样；敌意 path 只做属性读（与值通道同阶触碰面） | **no-conflict** | 「读取保留不变量」的操作文本即 L18/L28 读面纪律（结果联合辖预期失败、internal bug 辖 throw）；F-1 被破坏点正是该不变量的敌意面子句，D3b 补齐而非修订。无生命周期所有权新增（不记 fatal）、无 sequencer 进入、无诊断事件（ADR-0016 L77 读面零诊断） | 无 |
| A4 | ADR-0016 §考虑的备选 L87 | 「schema 子通道结果联合（带稳定码区分三种缺席情形）……拒绝；`null` 的单义性」 | D3b 敌意收敛与三情形共用同一 null 出口，无 `schemaIssue`、无码透传、无细分 | **no-conflict** | 收敛**来源**扩至敌意域但 null **单义性**不变（对调用方仍是同一个「有就给，否则 null」承诺）；设计非目标明文「不新增失败分支/稳定码」；SA8 前置门禁红线 3 保持满足 | 无 |
| A5 | ADR-0016 §分层 L74–76 + doc-runtime/vfsl AGENTS | doc-runtime 不动；namespace-runtime 组合；registry 仅别名 | D3b 落位 `read-schema-projection.ts`（组合层新内部模块，不进公共面）；DENY doc-runtime/**、vfsl/**（resolver 的迭代协议消费是已知消费方式，防御在消费面做） | **no-conflict** | 消费敌意面的层对该敌意面负责——与 doc-runtime `safeSpreadPath`/E100 在值通道的先例同构（schema 面对偶）；分层归属与 ADR-0016 L75 组合公式一致；registry 侧 D3b 不可见（lease 直透传，结果面恒为联合成员） | 无 |
| A6 | SA6 契约（red 15 / control 6 / 锚 2 / 夹具） | 契约只锚可达路径的 schema 键/内容/隔离；§15 未锁敌意 path 处置 | D3b 对合法 path 逐元素透明（副本与原数组相等）；红 #1–#15、负控 6、类型锚 2 行为零变化；新 T1–T3 落新文件（ALLOW 增补），夹具 import-only | **no-conflict** | 契约文件 grep `Symbol\|Proxy\|defineProperty` 零命中（实测）——全部同 realm 普通数组，迭代器同一性校验必过；D8 新文件名匹配 vitest include；SA6 §15 的自由度清单与敌意面处置不锁相容 | 无 |
| A7 | 任务简报 行为要点 2 / 要点 6 / AC4 | 「`null` 不是读的失败，读恒成功」；失败分支与四 getter 不变；无新增公共方法/参数 | 敌意 path 读恒 ok（值语义零影响）+ schema:null；失败分支零触碰；`normalizeReadPath` 包内私有 | **no-conflict** | 要点 2 由 D3b 兑现（敌意输入下读不再抛）；normalizeReadPath 不进 index 公共面（沿 p0.ts/projection.ts 先例）；十二键/exports 键集零变化 | 无 |

### 3.2 焦点二：null 收敛细节与红契约相容性

| # | Check | Clause | Subject behavior | Classification | Evidence | Required action |
|---|---|---|---|---|---|---|
| B1 | T3（`['absent-key', Symbol()]` → ok + `value:undefined` + `schema:null`）vs 红 #7（`['nick']`/`['skus','cd']` 值缺席照常返 schema） | ADR-0016 L24「路径合法但值缺席时 schema 照常返回（路径键控）」 | 两断言辖**不相交的 path 类**：红 #7 = schema 合法路径的值缺席（schema 非 null）；T3 = 含非法段类型的野段路径（schema:null，情形③） | **no-conflict** | 「路径键控」承诺的载体是 schema-可解析路径；野段路径在 L57 分类学下本就 INVALID → null。doc-runtime 侧 `['absent-key', Symbol()]` 在 seg0 吸收返回 undefined（read.ts L79 亲核）——值语义与 schema 语义各自按其通道规则结算，无互斥 | 无 |
| B2 | 守卫次序（D3a 状态守卫先于 D3b path 守卫） | 无决策文本辖定次序 | 非 ready 态不触碰敌意对象（零敌意代码执行面）；红 #8–#10 锚定不变 | **no-conflict** | 实现自由度（SA6 §15.2 同类）；两守卫同一 null 出口，无子通道产生 | 无 |
| B3 | R7 跨 realm 普通数组 → null（迭代器同一性不等） | ADR-0016 L22（null 非失败）+ L24（路径键控） | 同 realm 合法路径透明；跨 realm 数组 fail-closed 收敛 null（值读不受影响） | **no-conflict**（附观察项） | 决策集对跨 realm 输入**零文本**（无承诺被破坏）；fail-closed 方向与仓内既有一致（keyPattern 失配 fail-closed NOT_FOUND、raw 复制偏移 null）；仓内全部调用方同 realm（进程内库；REST 层 JSON.parse 产物同 realm）。已登记 R7 + follow-up #5（加法放宽路径）——不构成 evolution-required | 无（观察项转 §8） |
| B4 | 敌意长 path 扫描成本（R8） | 无决策文本辖定读成本上界（ADR-0016 L93 如实登记 O 成本） | 扫描与 doc-runtime 导航同阶；值通道先行已支付或已短路 | **no-conflict** | 不引入值通道没有的新上限/新循环；F-1 修订无新渐近项 | 无 |

### 3.3 焦点三：InternalError 边界保持（D4 双域划界）

**设计行为**（§7-D4）：可信域处置逐字保持 iteration-0 裁定——组合层对 `resolveSchemaAtPath` **不加任何 try/catch**，`InternalError`（可信域畸形 derived）直接逃逸 `readData`；不收敛 null、不降级码、不记 fatal、不发诊断。F-1 修订仅改文档表述为双域陈述（敌意 → null；InternalError → throw 逃逸）。

| # | Decision | Clause | Subject behavior | Classification | Evidence | Required action |
|---|---|---|---|---|---|---|
| C1 | ADR-0016 §解析语义 L64 | 「ref 目标缺失（畸形派生物）……抛 `InternalError`：**可信域契约，不进结果联合**」 | 可信域 throw 逃逸读面（零 catch） | **no-conflict**（iteration-1 已裁定，本版逐字保持） | L64 明文把 InternalError 排除出结果联合——收敛 null 反而冲突（iteration-1 §6 反事实核验维持有效）；SA2 F-1 明示「D4 对可信域的裁定与 SA8 复审结论不变」 | 无 |
| C2 | ADR-0008 L28（对可信域半边） | 「只有 internal bug 才抛异常」 | `activeTools.derived` 恒为自身 P0/SCHEMA 写槽编译 ok 产物，畸形即 internal bug → throw | **no-conflict**（implements-existing-decision 成分已计入 iteration-1） | L28 的 internal-bug 半句由 D4 延续；敌意半句由 D3b 兑现——**同一句 L28 对两域同时为真**，双域划界是 L28+L64+L57 三条文本联立唯一相容解 | 无 |
| C3 | vfsl/AGENTS.md 可信域例外句 | 「malformed derived schemas … throw `InternalError` and **never enter the result union**」 | 下层刻意 loud 的通道在组合层保持 loud | **no-conflict** | 层次纪律（iteration-1 §3.1 第 7 行裁定维持）；内层 try 辖域仅敌意扫描，不包裹 resolver 调用——两域处置在代码结构上物理分离 | 无 |
| C4 | 双域不对称性 vs iteration-1 §6 反事实 | 反事实：「InternalError→null 需塞进三情形外的第 4 类缺席（缺乏母法正授权，与 L64 carve-out 相抵）」 | 敌意 path→null（D3b）与 InternalError→throw（D4）并存 | **no-conflict** | 反事实辖**InternalError**（有 L64 明文 carve-out「不进结果联合」）；敌意 path 形状**无 carve-out 且有 L57 明文纳入**（INVALID=非数组/野段形状守卫）——文本不对称决定处置不对称。表面相似（「新增 null 来源」）经 L57 分类学消解为情形③既有辖域成员，非第 4 类 | 无 |
| C5 | iteration-1 §10 清单第 1 条辖域（SA1 §15(3) 提请确认点） | 清单字面「组合层**无 catch**（不收敛 null、不降级码、不记 fatal、不发诊断），`InternalError` 逃逸」 | D3b 在组合层新增**一个内层 try**——只包裹 `normalizeReadPath` 敌意扫描，**不包裹** `resolveSchemaAtPath` 调用 | **no-conflict**（辖域正式确认） | 已裁定命题「组合层**对 `resolveSchemaAtPath` 不加任何 try/catch**」在修订版中**逐字为真**（D3 伪代码亲核：try 块边界 = normalizeReadPath 函数体；resolver 调用在其外）。清单第 1 条括注（不收敛 null/不降级码/不记 fatal/不发诊断）标明其辖域是 **InternalError/resolver 通道**；敌意输入收编的内层 try 是 doc-runtime `safeSpreadPath`（F1/P10）的 schema 面对偶，不属该条辖域。措辞歧义由本报告 §10 改写消除 | 无（清单措辞已改写，见 §10） |
| C6 | 纯度校验机制 vs SA2 F-1 验收 ①② | F-1 required-change 机制句「仅以索引访问扫描拷贝」；验收 ①② 字面断言敌意迭代器/Proxy 案例 `schema:null` | D3b 在索引扫描之上增加迭代器同一性纯度校验（备选否决①：无纯度校验则 exotic 输入得到扫描副本解析出的**非 null** schema，与验收 ①② 不符） | **no-conflict** | 验收 ①② 是 F-1 的可执行判据，机制句是其实现建议的最小字面读法——二者冲突时以验收为准（设计读法正确）；机制选择属设计自由（SA6 §15.2 同类，无 ADR/CONTEXT 文本辖定）；「绝不调用迭代协议」纪律由 T1 调用计数器锚定 | 无（实现义务转 §8） |
| C7 | D4 JSDoc 双域改写 | docs/AGENTS「documentation-only wording changes must not invent implementation behavior」 | JSDoc/模块头注改双域陈述（敌意 → null；InternalError → throw），注明内层 try 辖域 | **no-conflict** | 描述的是 L28+L57+L64 联立已授权的行为，非发明；iteration-0 的「internal-bug-only、生产不可达」单句对敌意面为**假**（F-1 (b)），改写是修复公共契约诚实性 | 无 |

### 3.4 其余修订面全量对照

| # | Design | Clause | Classification | Evidence | Required action |
|---|---|---|---|---|---|
| D1 | D1/D2/D5/D6/D7 主线不变（形状、组合顺序、深拷贝、registry 别名、测试改锚） | ADR-0016 结果形状/交付纪律/分层 + ADR-0008 修订节 | 维持 iteration-1 裁决（no-conflict / implements-existing-decision） | iteration-1 §3.2 表 1–7 行复核未被 F-1 修订触及（设计自述「不变」与修订 diff 一致：D3b 为新增层，未改 D2 判别顺序/gate 原序/恰三键构造） | 无 |
| D2 | D2 撤销「INVALID 结构上不可达」论断 + B14/B15 组合推论 | —（论断层非决策层；行为两码同收敛 null 无变化） | **no-conflict** | 撤销的是错误的设计内部分析（SA2 §6/SM-6 反例：缺席吸收跳过尾段），不触及任何对外契约；行为面（`['absent-key', Symbol()]` → null）与 L22③/L57 一致并由 T3 锚定 | 无 |
| D3 | §11 ALLOW 增补 `runtime-readdata-hostile-path-guard.test.ts`（D8）+ DENY 不变 | ADR-0016 Consequences（测试改锚自登记义务）+ SA6 契约冻结 | **no-conflict** | 新测试文件 = F-1 验收 ①②③ 的可执行锚（SA2 §11 建议）；SA6 契约 5 文件仍在 DENY；无未解释范围扩张 | 无 |
| D4 | §13 R7/R8 新风险 + follow-up #5（跨 realm 放宽） | —（风险登记层） | **no-conflict** | 均为防御性登记，不修改任何承诺；follow-up 是加法演进路径 | 无 |
| D5 | ADR-0001–0014 辖域（11 文件） | 各 ADR 正文 | **no-conflict** | F-1 修订零触及（SSOT/authority/投影体/codegen/持久化/复制/诊断/实例身份/日志格式）；readData 语义仍仅 0008+0016 两处规定（grep 实测） | 无 |

## 4. Overrides

| Old decision | Override authority | Scope | New obligation |
|---|---|---|---|
| — | — | — | — |

无 override 声明、无 override 需求：F-1 修订自述且经核验为「既有文义实施，非新决策」（SA2 结论行同）；设计 §11 DENY `docs/adr/**` + `CONTEXT.md` 与该结论自洽；Issue comments 为空（无 Owner 覆盖权威可来源）。

## 5. Frozen surfaces

| Surface | Must remain unchanged | Evidence | Actual result |
|---|---|---|---|
| read 失败分支（结果联合） | `PATH_NOT_ALLOWED` / `RUNTIME_READ_DISABLED` 码/形状 | ADR-0016 L23 + ADR-0008 修订节第 3 条 | D3b 不触碰（值读先行 + 失败短路零 schema 工作）——**通过** |
| null 单义性 | 三情形不区分、无缺席原因子通道、null 非失败 | ADR-0016 L22/L87 + CONTEXT「语义 schema 投影」 | 敌意收敛同走 null 出口（A4）——**通过** |
| InternalError 通道 | 不进结果联合（throw 逃逸） | ADR-0016 L64 + vfsl AGENTS | D4 逐字保持；内层 try 不包裹 resolver（C1/C3/C5）——**通过** |
| 公共面键集 | 十二键、exports 值键集、无新增公共方法/参数/稳定码 | ADR-0008 D2 + AC4 | normalizeReadPath/深拷贝器均包内私有；D3b 走既有 null 出口非新结果分支——**通过**（实现后按 §10 复核） |
| doc-runtime / vfsl 包边界 | 值读签名语义零触碰；resolver 零改动、不导出 InternalError | ADR-0016 L74 + 包 AGENTS + SA8 移交项 2 | DENY 全包在案（B16 复核：仍未导出）——**通过** |
| lease 行为与 Equal 锁 | 直透传、别名跟随、锁编译绿 | ADR-0016 L76 + ADR-0009 L38 | D6 不变；D3b 对 lease 不可见——**通过** |
| 四 getter / 诊断 / wire / 持久化 | 五字段身份、读面零诊断事件、零持久化变化 | ADR-0008 §读取能力 + ADR-0016 L77 | 设计零触碰——**通过** |

## 6. Evolution requirements

**无 evolution-required 项。**

- 敌意 path → 结果面收敛（`schema:null`）是 ADR-0016 L22③ + L57「非数组/野段形状守卫」+ ADR-0008 L28「预期失败走结果联合」的既有文义实施，不修订任何决策文本（SA2 结论行同判，本复审独立核验文义成立）。
- InternalError throw 逃逸维持 iteration-1 no-conflict 裁定，同样无文本修订负担。
- 反事实对称性核验（裁决边界）：若修订版选择「敌意 path → throw」（iteration-0 现状）→ 违 ADR-0008 L28（敌意输入 ≠ internal bug）；若选择「敌意 path → 新失败码」→ 违 ADR-0016 L87 被否备选（null 单义）；若选择「InternalError → 收敛 null」→ 违 L64 carve-out。**双域划界（D3b+D4）是三条文本联立的唯一无冲突组合**。
- JSDoc 双域改写属代码文档义务（描述已授权行为），不构成规范性文档变更需求。

## 7. Hard conflicts

**无。hard-conflict 0。**

全决策集无任何条款与 D3b 敌意收敛、null 出口复用或 InternalError 边界保持相抵；反向核验：无条款要求 readData 对敌意输入抛错、无条款要求区分 null 缺席原因、无条款禁止组合层对自身消费的敌意面做防御（doc-runtime safeSpreadPath 先例 + ADR-0008 L28 恰为正授权方向）。

## 8. Required actions（非阻塞，移交下游）

1. **[SA3/SA4 — 实现义务]** D3b 必须按设计规格实现**含迭代纯度校验**的完整版（备选①「仅索引扫描」不满足 SA2 F-1 验收 ①② 的 `schema:null` 断言，且属部分信任敌意对象姿势）——机制自由但验收面强制。
2. **[SA4 — 锚定义务]** T1 的 `iteratorCalls === 0` 调用计数器断言是「绝不调用迭代协议」纪律的载荷锚，必须以可执行断言落地（非注释性声明）；内层 try 边界 = `normalizeReadPath` 函数体，不得外扩至 `resolveSchemaAtPath` 调用（C5 辖域确认的实现面兑现）。
3. **[SA4/SA7 — 观察项]** R7 跨 realm：若未来出现真实跨 realm 调用方，按 follow-up #5 走加法放宽（先锚定后放宽），不得在实现中静默放宽同一性比较。
4. **[SA4]** D4 JSDoc/模块头注双域文案两处义务（含内层 try 辖域注明）随实现落地——防后续维护者把内层 try 误判为漏改或误扩大。

## 9. Verdict

**clear**。

- 冲突点数：**0**（hard-conflict 0 / override-declared 0 / evolution-required 0）。
- 裁决分布（对照行共 23）：**implements-existing-decision × 2**（A1 敌意形状→null 的 L22③+L57 既有辖域实施；A2 ADR-0008 L28 读面抛错政策敌意半边的组合面兑现）+ **no-conflict × 20**（3.1 表 A3–A7；3.2 表 B1–B4；3.3 表 C1–C7；3.4 表 D2–D5）+ **维持前裁 × 1**（3.4 表 D1——主线决策未被 F-1 修订触及，iteration-1 §3.2 对其的 no-conflict/implements-existing-decision 裁定原样有效）。
- 三焦点裁定：
  - **D3b hardened 敌意 path 守卫 = 无冲突且为决策集所要求**：敌意输入触发 throw 违 ADR-0008 L28；收敛 `schema:null` 是 L22③（经 L57「非数组/野段形状守卫」分类学）与 L28 联立的既有文义；防御落位组合层与 doc-runtime safeSpreadPath 先例及 ADR-0016 L75 分层一致。
  - **null 收敛 = 单义性保持**：敌意收敛是情形③辖域内的收敛**来源**扩展，非第 4 类情形、非子通道、非新稳定码；对 SA6 红契约/负控/类型锚逐元素透明（契约文件零敌意构造，实测）。
  - **InternalError 边界 = 逐字保持**：D4 可信域裁定维持 iteration-1 no-conflict；内层 try 辖域经正式确认（C5）——「组合层对 `resolveSchemaAtPath` 不加任何 try/catch」在修订版中逐字为真，iteration-1 §10 清单第 1 条措辞歧义由 §10 改写消除。
- SA2 F-1 修订落实核对（冲突门辖域）：required-change 四要素（守卫/论断撤销/双域文档/验收测试 ①–④）+ N-1/N-2/N-3/N-4/N-5 五观察项逐条映射在 §14，与 SA2 评审文本对照**无缺项、无方向偏差**。
- Issue comments 为空：无 owner 要求需并入（设计 §4 处理正确）。
- 信息充分性：ADR 全集 14 文件 + CONTEXT + 模块 AGENTS 决策句 + 全部上游产物（简报/SA6/SA2/两轮 SA8）+ F-1 证据链源码亲核（B14/B15/B16）+ SA6 契约文件敌意构造 grep——无信息不足。

## 10. requiresConflictRecheck

**true**（实现阶段复查维持 armed；设计面冲突问题已由本报告与 iteration-1 报告闭合）。

理由：本设计对公共 API（`readData` 结果形状破坏性演进）与失败语义（新增敌意域 null 收敛 + 可信域 throw 通道的可观测化）的改变尚待实现核对；实际 diff 将触碰 ADR-0016/ADR-0008 辖定的读结果公共面。下列为实现后复查清单（**第 1 条措辞已按本报告 C5 辖域确认改写，取代 iteration-1 清单第 1 条字面**；新增第 6 条 D3b 专项）：

1. D4 落地：**对 `resolveSchemaAtPath` 调用无任何 try/catch**（不收敛 null、不降级码、不记 fatal、不发诊断），`InternalError` 逃逸；JSDoc + 模块头注双域文档在场。允许且仅允许的内层 try：敌意 path 规范化扫描自身（D3b，`normalizeReadPath` 函数体辖域）。
2. ok 成员恰三键、`schema` 精确可空；失败成员 `Extract` 派生、`RuntimeReadDisabledResult` 逐字；resolver 两码单义收敛 null 且不泄漏进读联合。
3. 深拷贝落位 runtime 边界（活 derived 零出站、不冻结、零缓存、跨读零共享）；lease.ts 零改动、Equal 锁编译绿。
4. 冻结面逐项保持：失败三分支、released issue、四 getter、十二键/exports 键集、无新增公共方法/参数/稳定码。
5. p0.ts 改动仅注释行；SA6 契约 5 文件未被修改（DENY）。
6. **D3b 专项**：`normalizeReadPath` 仅属性读/索引读/迭代器同一性比较（T1 调用计数器 = 0 锚在场）；内层 try 不含 resolver 调用；通过校验后传普通数组副本；`runtime-readdata-hostile-path-guard.test.ts`（T1–T3 + 合法 path 对照）在 ALLOW 内、被 vitest 收集且绿；合法 path 对红契约透明（红 15/负控 6/锚 2 全绿不受影响）。

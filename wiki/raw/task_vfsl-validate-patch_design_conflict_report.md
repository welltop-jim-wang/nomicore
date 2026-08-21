# 冲突门禁报告 — task_vfsl-validate-patch（issue #53，Phase 2 设计后复审）

被审对象：`wiki/raw/task_vfsl-validate-patch_design.md`（SA1 R1 产出：validatePatch 路径级写入校验 + 数组三操作）
冲突基准：`docs/adr/` 全集 5 份（0001–0005，逐个全读，均 accepted、无 superseded）+ `CONTEXT.md`
上游参照：`wiki/raw/task_vfsl-validate-patch_relevant_decisions.md`（前置门禁约束清单）+ `wiki/raw/task_vfsl-validate-patch_conflict_report.md`（前置 verdict: clear，观察①②③）
事实核验（非约束）：`packages/vfsl/src/validate.ts`（ValidateIssue:41 / resolveValues:122 / validateSnapshot:600）、`resolve.ts`（resolveChain:67）、`index.ts`（:3 头注「第三公共导出 validateSnapshot」/ :57-58 导出）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（2026-08-19 修订） | 弱 | 无冲突——设计为纯运行时校验引擎件（§8 文件清单：仅 packages/vfsl 引擎文件 + SA6 测试），兑现「坏数据进不来」；不引入 schema 文本、不触及 codegen/机器标签/方言冻结条款 |
| 0002 | nomicore 是重写，authority 出范围 | accepted | **是（管线形状依据）** | 无冲突——§1「ADR 0002『结构 → 值』两步判定的运行时核心」+ 护栏表「不碰 yjs/server/WS/HTTP 400」「不引入任何 authority 式不变式（enum/range/conditional/state-machine）」逐条兑现；「单事务提交」第三步明确留 Phase 2 层 |
| 0003 | 求值器与派生 schema | accepted | **是（直接依据）** | 无冲突——§3 任一成员存在规则/判别式缓存透明/no-match 诊断逐字兑现 §3；§4 收敛形态（walkRefChain 一算法 + 三透镜）正是「解析动作由包内共享解析器完成」「一切遍历经包内共享解析器」的执行（详见对照 5）；§3.2 xml-fragment 终态行逐字兑现 §5（前置观察②落实）；derived 只读消费、零形状变更（前置观察③落实） |
| 0004 | vfsl-protocol 类型投影（D1–D5） | accepted | **是（D1/D2 词表）** | 无冲突——§3.2 越界拒绝即 D1「越界归运行时校验」；§3.5 三操作独立函数即 D1「序列编辑由专用 API 承载」（§1 护栏明禁「不把序列编辑塞进下标替换语义」）；plain 终态行 + 三操作对 plain 位拒绝即 D1「YPlainArray 只能整体替换」；§3.3 规则 1 + any-of 全拒即 D2「成员适配归运行时重建校验」；§3.1 顶段即 ROOT 字段即 D5 |
| 0005 | 投影生成管线 | accepted | 无关 | 无冲突——设计 §1 护栏 + §8 DENY LIST 明禁 `packages/vfsl-codegen/**`、`packages/vfsl-protocol/**`、`domains/**`、CI regen-diff 面；无关性裁定落实 |

CONTEXT.md 对照：「重建校验」（最近结构边界合并整值）由 §3.3 边界规则 1–5 兑现、§2.3 明确否决整快照重建（定义措辞 + 性能 + 职责三重依据）；「结构树（与值语义正交）」由 §3.1 两段正交落点（守卫只消费 structure+aliases、值段只消费 values）保持，且是结构树的第一个消费者；「路径索引」Avoid 项（resolveChild 三级前缀匹配）被 D12 显式排除（derived.index 零消费 + 结构树游走为 exact/`'<key>'`/array 段语义，无前缀匹配）；「零写入」由纯函数 + 不抛错 + 拷贝式重建兑现（400/通道层留 PRD）；「封闭对象」由拒绝矩阵行 1 兑现；「整文档校验单一入口」无损（validateSnapshot 行为零变化保留）。无冲突。

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | 无冲突点 | 全部对照项均为 no-conflict（明细如下） |

逐项对照记录（无冲突明细；标注★者为本轮设计后复审新增对照维度，前置门禁未覆盖）：

| # | 基准条款 | 设计决策 | 裁决 | 依据 |
|---|---|---|---|---|
| 1 | ADR-0002：「统一写入管线收敛为『结构 → 值 → 单事务提交』三步」；authority「完全排除在范围外，不保留接口」 | §1 两段判定（结构守卫 + 值校验）为运行时核心；护栏「不碰 yjs」「不引入 authority 式不变式」 | no-conflict | 判定面恰为前两步；第三步与 400/WS 通道语义留 Phase 2 PRD 层（与 phase-2-engine-gaps「不碰 yjs」纪律同向）；无任何 enum/range/conditional/state-machine 式规则 |
| 2 | ADR-0003 §3：「路径存在性为**任一成员出现即存在**」 | §3.2 union 行「任一成员放行即放行（任一成员出现即存在，ADR 0003 §3）」；节点集游穿 union | no-conflict | 逐字兑现 |
| 3 | ADR-0003 §3：判别式缓存「不得改变任何可观测行为（含错误输出）——映射未命中回流同一诊断生成器」 | §3.4「判别式缓存透明（AC3#6）：解释器段 0 仅加速静默接受……共享机器继承该性质，零新增代码」 | no-conflict | 值校验复用同一解释器/诊断生成器；守卫段不使用判别式（结构树域无判别式概念），无从引入可观测分叉 |
| 4 | ADR-0003 §3：no-match「报**失败距离最小**的成员（平局按声明序），消息标注『联合成员 i/N』」 | §3.4/§6 AC3 组：共享解释器继承 no-match 诊断（argmin 平局声明序、dive 字段级 issue） | no-conflict | 单一解释器继承，非重实现 |
| 5 ★ | ADR-0003 §4 + 后果：「解析动作由包内共享解析器完成（复用 shapes.ts 的 clsOf/memo 模式）」「一切遍历经包内共享解析器」 | §4.1「一算法 + 三透镜」：walkRefChain 泛型核心（恰一份 while 循环算法）+ IR/值树/结构树三个参数化透镜；结构树透镜为新增实例 | no-conflict | 新增结构树透镜是条款的**执行**（结构树此前无消费者），非第三份算法复制——算法体全仓恰一份，透镜为 isRef/nameOf/lookup/报错工厂的参数化实例，与 shapes.ts clsOf/memo 先例同构；弃案节明确否决「保留双份 + 写第三份循环」与「派生物内联展开 ref」（后者同时违反 §4 不内联条款 + 派生形状冻结）。「不复制第三份」（简报语）按算法体口径满足 |
| 6 ★ | ADR-0003 §5：「`xml-fragment` 是结构树的**终态节点**……路径下钻守卫到此为止……运行时校验仅要求良构 XML」 | §3.2 拒绝矩阵 xml-fragment 行（终态拒绝下钻，措辞明引 ADR 0003 §5）；§6 推演 `['assets','text1','body','deep']` 用例闭合 | no-conflict | 前置观察②落实：xml 位并入终态拒绝矩阵，验收缺口已补 |
| 7 ★ | ADR-0003 后果：「派生 schema 的形状变更须走设计修订流程（公共契约）」 | §1 护栏「不改 DerivedSchema/StructureNode/ValueSchema 公共形状」；§3.1 只读消费；§8 DENY `derived.ts` | no-conflict | 前置观察③落实：零形状变更、零形状变更需求（边界判定/节点集游走均在既有形状上工作） |
| 8 | ADR-0004 D1：「越界归运行时校验」 | §3.2 越界行「拒绝（D1 越界归运行时）」，消息冻结替换语义措辞 | no-conflict | 逐字对齐 |
| 9 | ADR-0004 D1：「序列编辑……由专用 API 承载：appendToArray / insertIntoArray / deleteFromArray（下标为显式参数）」 | §3.5 三操作为独立公共函数（validateAppendToArray / validateInsertIntoArray / validateDeleteFromArray），index 显式参数；§1 护栏「不把序列编辑塞进下标替换语义」 | no-conflict | 三操作是 D1 专用 API 的运行时判定面（简报定位语）；validate 前缀为判定函数语义命名，词表（append/insert/delete/IntoArray/FromArray）与 D1 一致；命名与 SA6 测试导出契约（转绿要求）逐字一致 |
| 10 | ADR-0004 D1：「`YPlainArray` 只能整体替换（普通 JSON 值，非 Y.Array）」 | §3.2 plain 终态行（只能整体替换）；§3.5 三操作对 plain 位显式拒绝（无序列编辑语义）；整值替换路径合法（规则 5） | no-conflict | 逐字兑现 |
| 11 | ADR-0004 D2：「当前成员是否允许该写入归运行时重建校验——类型层查键空间与值类型，运行时查成员适配」 | §3.3 规则 1（union 穿越边界 = 第一个被穿越的 union 位）+ 重建后 any-of 全拒（AC3） | no-conflict | 正是 D2 指派给运行时的职责；any-of 全拒语义与 ADR-0003 §3 匹配语义一致 |
| 12 | ADR-0004 D5：「`VfslPathMap` 顶层键 = ROOT 的字段」 | §3.1「path 段数组；顶段即 ROOT 字段（ADR 0004 D5，不含 ROOT 前缀）」 | no-conflict | 类型层与运行时层同向，路径键空间一致 |
| 13 ★ | ADR-0003 §1：「PRD #3『唯一公共测试接缝』措辞相应修订为两个公共观察点（`parseVfsl` 与 `evaluate` 的入参/出参）」 | §3.1/§8 index.ts 追加四函数公共导出（公共面第 4–7 个导出） | no-conflict | 该条款是 Phase 0b 求值器立项时对 PRD 测试接缝**措辞**的修订记录，非公共导出数量的冻结——公共面随后已按流程演进：index.ts:3 头注明示「issue #21：第三公共导出 validateSnapshot」，#31 落地 validateSnapshot 并确立「测试经 index.ts 公共面导入」先例；本设计沿用同一先例且有 SA6 测试契约（36 用例经公共面导入）与任务简报背书。属公共面的常规演进，非对条款的违反 |
| 14 ★ | CONTEXT「重建校验」：「单字段 patch 也在**最近结构边界**合并当前值后按完整子 schema 校验」 | §3.3 边界规则 1–5（union 穿越 → 第一个 union 位 / Record 位 / 数组位 / 目标数组位 / 目标位本身）；§2.3 否决整快照重建 | no-conflict | 「最近」按「Yjs 物化的结构容器位」解读（map/array/union 边界），规则 1–5 全部落在结构边界上；数组元素位/字段位非结构边界故边界上提至容器；union 穿越取第一个为「值树游标静态可达的最深重建点」（成员选择依赖运行时值）——语义自洽且部分由 SA6 测试锚定（AC6#2 整数组重建、AC3 union 交叉）。若 owner 对「最近」另有更窄解读属措辞澄清事务，不构成本门禁阻塞（见观察 3） |
| 15 ★ | CONTEXT「结构树」：「供路径下钻守卫；**与值语义正交**」 | §3.1 两段正交落点：守卫只消费 structure+aliases 与 base 的 presence/长度；值校验只消费 values（经共享解释器）；§2.1「守卫只查结构树、值校验只走值树」 | no-conflict | 正交纪律在结构树的第一个消费者处即结构化保持 |
| 16 ★ | CONTEXT「路径索引」：「路径 → 子 schema 的下钻索引，键匹配（exact / pattern）为标准能力」_Avoid_: resolveChild 三级前缀匹配 | D12「derived.index 零消费（语法路径键空间 ≠ 运行时路径）」+ 结构树节点集游走实现 exact 字段 / `'<key>'` pattern 段 / array 段 | no-conflict | 术语为定义性（「是什么」），不强制「必须查 index 表」；游走实现的键匹配语义与术语一致，Avoid 机制未被复活；derived.index 键空间差异（语法路径含合成段）为实读事实，属实现核对面（SA4） |
| 17 ★ | CONTEXT「零写入」：「校验失败 → 400 且文档不变；所有写入口走同一条管线」 | §3.1 四函数纯函数/同步/不抛错；§3.5 拷贝式重建零原地突变；§3.6 全部异常收编为 E100 结果 | no-conflict | 判定核心零写入；400/HTTP/WS 通道语义按 phase-2-gaps 纪律留 Phase 2 PRD 层（§1 护栏明禁触碰） |
| 18 | CONTEXT「封闭对象」：「未声明字段拒绝」 | §3.2 拒绝矩阵行 1（未知字段拒绝，含封闭语义措辞） | no-conflict | 逐字兑现；Record 位 `'<key>'` 动态键空间放行与封闭对象条款不冲突（Record 是声明了的动态键空间） |
| 19 ★ | CONTEXT「整文档校验（validateSnapshot）」：「……共用的单一入口」 | §4.2 validateSnapshot 公共入口与可观测行为逐字节零变化（interpret() 机械抽取）；validateSubtree 为内部导出不进公共面（唯一 caller = validate-patch.ts） | no-conflict | 既有单一入口无损；validatePatch 为路径级新入口，CONTEXT 另设「重建校验」术语即为此形态（前置门禁对照 10 已裁）；子树校验复用同一 interpret 主体，未产生第二台解释器 |
| 20 ★ | ADR-0005：SchemaSource/生成器/生成物/domains 面 | §1 护栏 + §8 DENY（vfsl-codegen/**、vfsl-protocol/**、domains/**、.github/**、CI regen-diff） | no-conflict | 无关性裁定逐项落实 |
| 21 ★ | ADR-0001：「纯引擎仓库：代码库不含 schema 文本（测试 fixture 除外）」；「坏数据进不来由运行时校验兑付」 | §8 ALLOW 仅引擎源文件 + SA6 测试；无 schema 文本、无新运行时依赖（护栏行） | no-conflict | 纯引擎增量，fixture 例外不触发 |
| 22 ★ | （简报 AC6，非 ADR 基准，记录性对照）「全收集 + 上限语义与 validateSnapshot 一致」 | D6「守卫拒绝恰 1 条；全收集语义只属于值校验段（共享解释器）」 | no-conflict | AC6 两条测试用例（多字段 2 issue、150 坏元素 101 条）均为值级——全收集+100 上限+截断标记由共享解释器继承即为「与 validateSnapshot 一致」；守卫为存在性判定单 issue 与 AC 无冲突（且 SA6 备注 3 的 path 锚定已按守卫单条设计） |
| 23 ★ | （前置门禁裁定：insert 下标边界无 ADR 冻结，属 SA1 设计自由） | D2 冻结闭区间 [0, len]（len = append 位），拒绝 index > len | no-conflict | 设计自由度行使，选择与 append 语义无缝、无「跳空插入」语义洞；无 ADR 条款被触碰 |

设计自由度冻结项总核查：D1（命名，SA6 契约）/ D2（insert 上界）/ D3（守卫 path=完整尝试路径）/ D4（Record 位边界）/ D5（值校验绝对路径）/ D6（守卫恰 1 issue）/ D7（段类型严格无 coerce）/ D8（穿越 Record 不复检存量键）/ D9（异常输入拒绝不抛错）/ D10（optional 字段合法写入）/ D11（无字段清除操作）/ D12（index 零消费）——逐项核查均落在「ADR/CONTEXT 未冻结」的空间内（前置门禁 relevant_decisions 第 0004 节约束含义 2 已明示 insert 边界属设计自由；其余各点无任何 ADR 条款覆盖），且无一与既有条款相反。§3.3 规则 2 的「O(条目数) 成本显式接受」、§3.6 E100 崩溃边界（与 validateSnapshot 同款）、原型污染防护等均为工程决策，无 ADR 基准可违。

## 结论

**Verdict: clear** —— SA1 设计文档与 ADR 全集（0001–0005）及 CONTEXT.md 无任何冲突点：0 hard-violation、0 evolution、0 override-declared。

设计是前置门禁约束清单的忠实执行：三个前置观察全部落实（①指针混写已纠正——设计头部明示以 ADR 0003 §3/§4/§5 + CONTEXT 为语义基准、v1-spec §7 不当写入管线读；②xml-fragment 终态位并入拒绝矩阵；③派生 schema 零形状变更）；resolve 收敛以「一算法 + 三透镜」形态满足 ADR-0003 §4「包内共享解析器」条款且不产生第三份循环；全部 12 项设计自由度冻结（D1–D12）均落在 ADR 未冻结空间。放行，进入 SA2 全维度攻击评审。

补充观察（非阻塞，供总控/SA2/SA4 知悉）：

1. **D6 与 AC6 的措辞张力已闭合但供 SA2 复核**：「全收集 + 上限语义与 validateSnapshot 一致」按 D6 限定于值校验段；与 SA6 测试锚定（AC6 两用例均值级）一致。若 SA2 从验收完备性角度认为守卫侧也需多 issue（如多段路径逐段报错），属设计评审领域，非门禁事项。
2. **数据事实断言属 SA4 核对面**：设计对 evaluate.ts 产物的实读断言（结构树叶 8 kind、Record 物化为 map + 单字段 `'<key>'`、全标量联合折叠为 leaf、derived.index 键空间含合成段、resolveChain 调用族 7 处）是 §3.2/§3.1/D12 的依据——本门禁已抽样核实 resolve 双份并存（validate.ts:122 / resolve.ts:67）与 index.ts 公共面先例（:3 头注、:57-58 导出），其余断言的实现期核实归 SA4/SA7。
3. **「最近结构边界」的解读宽度**：规则 1（第一个 union）与规则 3（数组位边界，元素写入重建整数组）是对 CONTEXT「最近结构边界」的具体化解读，均由 SA6 测试锚定且语义自洽；若 owner 认为应收窄（如数组元素位独立校验、union 内更深边界），属 CONTEXT 措辞澄清/设计修订事务，不影响本 verdict。
4. **公共面演进先例**：四函数新增使公共面达 7 个导出——index.ts 头注「第三公共导出」表述已滞后于实况，SA3 实现时同步头注描述属工程卫生，非门禁事项。

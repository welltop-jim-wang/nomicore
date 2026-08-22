# 冲突门禁报告（修订轮 rev1 前置门禁）

- 被审对象：`wiki/raw/task_doc-runtime-materialize-root-rev1.md`（PR #84 owner Review 修订轮任务简报——第 0 阶段前置冲突门禁）
- 冲突基准：`docs/adr/0001`–`0007` 全集（7 份，逐个全读，无抽样）+ `CONTEXT.md`
- 门禁：SA8（run_id: issue-74-1787396362-3288866）
- 任务类型：功能开发/验收强化混合（总控自判）；本轮含 API 契约语义裁决（RAC-1/RAC-3）+ 验收测试锚定（RAC-2~RAC-5）+ CI 门禁（RAC-6）
- 前序门禁记录：初轮前置门禁 verdict=clear（2026-08-22）、初轮设计后复审 verdict=clear；本轮为修订轮第 0 阶段

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19 目标态/阶段态修订、2026-08-21 `SCHEMA` 命名修订） | 中 | 一致：修订轮全部反馈项为契约语义裁决、测试强化与 CI 门禁，不引入 schema 文本/codegen，零触碰 `SCHEMA` 信封；具名条目命名契约未被触碰 |
| ADR 0002 | nomicore 是全新 yjs-server 重写，authority 完全出范围 | accepted | 中 | 一致：RAC-1 的 observer 偏离处置不得演化为 authority 式运行时不变式；三步管线纪律（失败 ⟹ 文档不变）是裁决 RAC-1 选项空间的上游依据，未被违反 |
| ADR 0003 | 求值器与派生 schema | accepted | **高** | 一致：「运行时校验仅要求良构 XML」是校验接受域**下限**条款，不冻结物化构造接受域——反馈 #3 的 validator/materializer 接受域差异落在两域之间的 ADR 未定义空间（详见重点裁决二）；ROOT=Y.Map、XML 终态节点、联合 any-of 均未被触碰 |
| ADR 0004 | vfsl-protocol 类型协议包 | accepted | 低 | 无涉：编译期类型投影轨道，与运行时物化修订无交集 |
| ADR 0005 | 投影生成管线 | accepted | 无 | 无涉：SchemaSource/生成器/CI 保鲜管线与 materialize 测试存在性门禁（RAC-6）无交集 |
| ADR 0006 | Cordis 持久化插件与 doc 三条目内容布局 | accepted（含 2026-08-21 createDoc/owner、2026-08-22 getStatus 修订节） | 中 | 一致：RAC-2/RAC-3 的「state 字节不变」断言面覆盖整个 Y.Doc，SCHEMA/META 兄弟条目一并不动；修订轮零触碰持久层；「事务原子性由 Y.transact（单 update 单元）保证」未被触碰 |
| ADR 0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted | **直接** | 一致（含两处重点裁决）：`materializeRoot` 条款未规定 observer 执行后的成功语义——RAC-1 要求裁决的是 ADR **未定义空间**的契约补全，两个候选出口均可在既有条款框架内落位（受边界条件 W1 约束）；RAC-2/RAC-4/RAC-5 是「零写入承诺」「extractYjsSnapshot 入口」「observer 抛错 fatal 不虚假回滚」条款的直接验收强化 |

无任何 ADR 处于 superseded 状态；ADR 0001/0006 的修订节均为 owner 裁决放行的内部演进，已按修订后文本对照（与初轮两份门禁报告同口径）。

## 冲突点

无（**0 条 hard-violation / 0 条 evolution / 0 条 override-declared**）。修订轮简报未声明推翻任何 ADR，未试图修订任何既有决策；全部反馈项是 ADR-0007/0003 既定条款的验收强化，加上两处 ADR 未定义空间的契约补全裁决（裁决权按简报规划交给 SA1，出口受本报告边界条件约束，SA8 设计后复审将按本报告条件复核）。

---

## 重点裁决一：反馈 #1（P1）——`ok:true` 成功语义 vs ADR-0007 observer 抛错边界条款

**问题**：简报要求 SA1 在两个出口间定谳——（A）检测 observer 重入偏离并响亮失败；（B）ADR/API 文档化「`ok:true` 仅表示本函数计划中的 set 已提交」。这与 ADR-0007（逻辑验证与 Yjs Runtime Bridge 分层，含 observer 抛错边界条款）是否冲突？

**裁决：no-conflict——这是 ADR 未定义空间的契约补全，不是对既有条款的违反或推翻。** 论证：

1. **ADR-0007 未冻结 observer 执行后的成功语义。** 该 ADR 对 `materializeRoot` 的承诺止于：「内部先执行 `validateLogicalSnapshot`，再构造未集成到任何 doc 的 detached Yjs 子树，确认目标 ROOT 为空后以一次 `Y.transact` 安装。验证或构造失败时目标 doc 零写入；不覆盖、不合并、不 fallback。」——冻结的是安装前的流程、单事务安装、失败零写入；全文没有任何条款承诺「返回 `ok:true` 时（observer 执行后）ROOT 与输入 snapshot 等价」。缺口真实存在（owner Review 指出得对），但**缺口 ≠ 冲突**。

2. **出口 B（文档化「仅承诺计划 set 已提交」）与既有条款完全相容。** 「以一次 `Y.transact` 安装」的安装对象本就是计划中的 set；ADR-0007 失败边界明文承认 observer 是事务生态的预期参与者并**另行治理**：「Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报」，且把 observer 纪律与写入串行化归属 Runtime 层（「NamespaceRuntime 将来按 namespace 串行化所有业务写入……业务调用方不得取得可写 Yjs 引用或绕过该入口」）。出口 B 是把 ADR 已隐含的分工写明，属澄清而非改判。若以修订 ADR-0007 文本的方式执行（owner 反馈原文即要求「ADR/API 必须明确」），应循仓内既有惯例——owner 裁决放行的带日期修订节（ADR-0001 2026-08-19/08-21、ADR-0006 2026-08-21/08-22 先例），增量澄清、不改写已冻结条款；仅改 API 文档（JSDoc/README）则零 ADR 触碰。

3. **出口 A（检测偏离响亮失败）可用，但形态受既有条款硬约束（见 W1）。** ADR-0007 唯一明文的 observer 越界处置是抛错情形：「事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback」。不抛错但偏离（delete/overwrite/insert extra key）的情形 ADR 未规定；把 fatal 语义按类比扩展到该情形是对未定义空间的**延伸**，不修订既有条款（抛错情形的 fatal 待遇不变）。但「响亮失败」的具体形态若取以下三种之一即落入违反面：
   - **事务提交后返回 `ok:false`/结构化失败** → 破坏「失败 ⟹ 文档不变」不变量（ADR-0007「验证或构造失败时目标 doc 零写入」；CONTEXT.md 零写入「校验失败 → 400 且文档不变」；ADR-0002 三步管线纪律），且恰是 ADR 禁止的误导性失败声明（同款纪律：「不虚假声称自动回滚」）；
   - **补偿修复/撤销写入** → 违反「不覆盖、不合并、不 fallback」与「不尝试 fallback」；
   - **声称已回滚** → 违反「不虚假声称自动回滚」。
   与既有条款相容的响亮失败只剩**throw 形态**（类比 internal/fatal，异常原样离开函数——与初轮设计 D1/INV-5 同款诠释）。

4. **简报本身不预选出口。** RAC-1 接受任一出口并配回归测试；要求在 ADR 未定义空间做裁决不构成与 ADR 的冲突。回归测试要求（断言返回结果与最终 ROOT 状态）与 ADR 无任何触碰。

## 重点裁决二：反馈 #3（High）——validator/materializer 接受域差异（属性值含 `"`）定谳 vs ADR

**问题**：`wellFormedXml()` 接受属性值含 `"`（如 `<p title='a"b'>x</p>`），materializer `xml-parse.ts` 构造期拒绝——owner 要求定谳「有意的 materialization 约束（测试锁定）」或「修正解析/序列化策略」，两个方向是否与 ADR 冲突？

**裁决：no-conflict——两个定谳方向均在 ADR 框架内可用。** 论证：

1. **ADR-0003 冻结的是校验下限，不是物化上限。**「`xml-fragment` 是结构树的**终态节点**……运行时校验仅要求良构 XML」——该条款规定**校验**必须接受什么（良构 XML 及以上），未规定**构造**必须接受校验通过的一切。校验域 ⊋ 构造域不违反任何条款。

2. **ADR-0007 明文预期「校验通过但构造失败」这一类。**「零写入承诺覆盖所有验证失败和 **detached 构造失败**」+「验证或构造失败时目标 doc 零写入」——detached 构造失败之所以是独立失败类，正因两域可以不同（初轮设计 D6/INV-9 的构造期六词域拒绝即同型模式，初轮设计后复审第 9 行已裁 no-conflict）。`ok:false + 恰 1 issue + 0 update + state 字节不变`正是该失败类的规定出口。

3. **方向一（宣告有意约束 + 测试锁定）**：即初轮设计 D7 既有决策（attr 值含 `"` 构造期拒绝），初轮设计后复审第 8 行 + 观察项 O3 已裁 no-conflict（「attr-`"` 拒绝与终态节点语义无涉，属构造失败预期面」）；本轮要求的是把它显性化并以测试锚定——是裁决的**强化**，非变更。

4. **方向二（修正解析/序列化策略、放宽构造域）**：没有任何 ADR 条款为 materializer 的接受域设上限；向校验域对齐不触碰「仅要求良构 XML」（校验侧不动）、不触碰 round-trip 承诺面（「XML string 与 Y.XmlFragment 只承诺语义等价 round-trip，不承诺字符串逐字相同」——语义等价承诺在两个方向下均不变）。

5. **两个方向共同的红线（W2）**：XML 测试断言不得把 round-trip 承诺收紧为字符串逐字相同（ADR-0007 明文只承诺语义等价）；失败场景保持单 issue + 零 update + state 不变（fail-fast 纪律）——与 RAC-3 自身措辞一致。

## 逐条对照明细（全部判 no-conflict，供复核）

| # | 被审对象条款 | ADR 依据（原文） | 裁决 | 依据 |
|---|---|---|---|---|
| 1 | RAC-1：observer 重入不抛错语义定谳（检测偏离响亮失败 **或** 文档化「仅承诺计划 set 已提交」）+ 回归测试 | ADR-0007 materializeRoot 条款 + 失败边界 + Runtime 编排边界（引文见重点裁决一） | no-conflict | ADR 未定义空间的契约补全；出口 B 与条款直接相容，出口 A 受 W1 形态约束；详见重点裁决一 |
| 2 | RAC-2：detached 构造失败（逻辑校验已通过）→ ok:false + 恰 1 issue + 0 update + state 字节不变；覆盖 unknown 字段承载 Date/bigint/NaN/Infinity/Yjs 类型/数组内 undefined + XML parser 构造期拒绝分支 | ADR-0007：「零写入承诺覆盖所有验证失败和 detached 构造失败」「验证或构造失败时目标 doc 零写入」；「只接受普通 JSON logical ROOT snapshot，不接受 Y.Doc/Y.Map/Y.Array」；ADR-0006：「事务原子性由 Y.transact（单 update 单元）保证」 | no-conflict | 构造失败类的直接验收强化；非 JSON 值经逻辑宽域后在构造期响亮拒绝 = 该失败类的预期内容（初轮设计后复审第 9 行同题已裁） |
| 3 | RAC-3：xml-parse 表驱动覆盖 + validator/materializer 接受域差异定谳并以测试锁定 | ADR-0003：「运行时校验仅要求良构 XML」；ADR-0007：「只承诺语义等价 round-trip，不承诺字符串逐字相同」+ 构造失败类条款 | no-conflict | 校验下限未被升降、构造失败出口为 ADR 预期面；详见重点裁决二 |
| 4 | RAC-4：materialize 后 `extractYjsSnapshot()` 提取与输入 snapshot 完整**语义**比较 + 嵌套 clone 隔离 | ADR-0007：「`extractYjsSnapshot(derived, doc)`：只读取固定 ROOT，严格验证实际 Yjs 载体并提取普通逻辑 ROOT」「XML string 与 Y.XmlFragment 只承诺语义等价 round-trip，不承诺字符串逐字相同」 | no-conflict | 用 ADR 既有入口做读回校验；简报自身措辞为「语义比较」，未把 XML 断言收紧为逐字（红线 W2/W3 转达 SA1/SA6） |
| 5 | RAC-5：observer 抛错测试收紧（toThrow('observer-boom')/exact Error identity + 调用次数 + 保留「update 已发生、值未回滚」断言） | ADR-0007：「事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback」 | no-conflict | 断言形态与 fatal 语义逐款对齐（初轮 U13 锚同向）；「值未回滚」断言恰是不虚假回滚承诺的测试化 |
| 6 | RAC-6：CI 增加 materialize-root 测试存在性门禁（`--passWithNoTests=false`） | （无 ADR 条款治理 CI 测试存在性门禁；ADR-0005 CI 条款属投影保鲜轨道，无交集） | no-conflict | 纯工程门禁增强，无 ADR 触碰面 |
| 7 | 附带核对：修订面收敛于 doc-runtime 实现/测试/CI + 契约文档化，SCHEMA/META/持久层零触碰 | ADR-0006 三条目布局 +「看不见 schema 语义」；ADR-0007「持久层继续不理解 VFSL」依赖面条款 | no-conflict | 简报反馈项无一要求越出 `@nomicore/doc-runtime` 边界 |
| 8 | 附带核对：简报建立在前轮设计基线（D1–D10/INV/U 锚）之上 | （wiki 档案与代码不构成冲突基准——门禁边界条款） | no-conflict | 基线的 ADR 合规已由初轮两份门禁报告裁决（均 clear）；本轮按 ADR 原文独立复核，未发现基线遗留冲突 |

## 边界条件（非冲突；SA1 设计约束 + SA8 设计后复审复核锚点）

- **W1（RAC-1 出口 A 的形态红线）**：若 SA1 选「检测偏离响亮失败」，唯一与 ADR-0007 相容的形态是 throw（类比 internal/fatal、异常原样离开函数）；**事务提交后返回 ok:false / 结构化失败、补偿修复写入、声称已回滚**三种形态分别落入「零写入承诺」「不覆盖、不合并、不 fallback / 不尝试 fallback」「不虚假声称自动回滚」的违反面——届时将升级为 hard-violation。「防止」类机制（抑制/延迟 observer 回调）无 ADR 条款依据亦无禁令，属设计评审面（SA2）。若以 ADR 文本修订执行出口 B，必须循 owner 裁决放行的带日期修订节惯例，增量澄清、不改写已冻结条款。
- **W2（RAC-3 红线）**：XML 断言不得收紧为字符串逐字相同（ADR-0007 只承诺语义等价 round-trip）；失败场景保持单 issue + 零 update + state 字节不变。
- **W3（RAC-4 红线）**：「完整语义比较」对 XML 叶子必须经语义归一化比较（初轮 U12 锚同款），不得退化为字节相等。

## 结论

**verdict = clear，放行进入 SA1 设计。**

- 冲突点数：**0**；裁决分布：no-conflict × 8（明细行 #1–#8，其中 #1/#3 含重点裁决展开）、override-declared × 0、evolution × 0、hard-violation × 0。
- 两项重点关注均裁 **no-conflict**：反馈 #1 的 `ok:true` 语义裁决是 ADR-0007 未定义空间的契约补全（出口 B 直接相容；出口 A 受 W1 约束，仅 throw 形态可用）；反馈 #3 的接受域差异是 ADR-0003 校验下限条款与 ADR-0007 构造失败类之间的合法空隙，两个定谳方向（锁定有意约束 / 放宽构造域）均无条款触碰。
- 无需任何 override；无条目需 Jim 裁决；W1–W3 为 SA1 设计红线与 SA8 设计后复审的复核锚点，相关决议文档已同步产出供全链复用。

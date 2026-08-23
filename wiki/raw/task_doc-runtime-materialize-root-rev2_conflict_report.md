# 冲突门禁报告（修订轮 rev2 前置门禁）

- 被审对象：`wiki/raw/task_doc-runtime-materialize-root-rev2.md`（PR #84 owner review 修订轮 rev2 任务简报——第 0 阶段前置冲突门禁；缺陷修复性质：运行时 guard 缺失导致假成功）
- 冲突基准：`docs/adr/0001`–`0007` 全集（7 份，逐个全读，无抽样）+ `CONTEXT.md`；已核对基线分支 `origin/docs/doc-runtime-validation`（8a42501，rebase 目标）上 ADR 全集与 CONTEXT.md 和本 worktree 逐字节一致——裁决对 rebase 前后均成立
- 门禁：SA8（run_id: issue-74-1787396362-3288866）
- 前序门禁记录：初轮前置门禁 clear（2026-08-22）、初轮设计后复审 clear、rev1 前置门禁 clear、rev1 设计后复审 clear；本轮为修订轮第 0 阶段，在 rev1 已实现基线（RD1–RD6 / INV-10 / F11）之上独立按 ADR 原文重新裁决（复用 rev1 结论但未直接沿用，三项修订要点逐条重裁）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19 目标态/阶段态修订、2026-08-21 `SCHEMA` 命名修订） | 低 | 一致：本轮全部修订项为运行时 guard、语义澄清、测试与文档，不引入 schema 文本/codegen，零触碰 `SCHEMA` 信封与具名条目命名契约 |
| ADR 0002 | nomicore 是全新 yjs-server 重写，authority 完全出范围 | accepted | 中 | 一致：P1 运行时 guard 是 API 前置条件检查（transaction 状态），非 authority 式数据值不变式体系；三步管线纪律（失败 ⟹ 文档不变）恰是 P1「拒绝 + 零写入」形态的上游依据，未被违反 |
| ADR 0003 | 求值器与派生 schema | accepted | **高** | 一致：Minor-1「CDATA/PI/comment 为 lexical-token round-trip 而非结构化 XML 节点语义」与「xml-fragment 终态节点 + 不定义实参字段与 XML 结构的映射」的 opaque 立场同向（明确**不**定义结构映射即维持该条款）；ROOT=Y.Map、联合 any-of 未触碰 |
| ADR 0004 | vfsl-protocol 类型协议包 | accepted | 低 | 无涉：编译期类型投影轨道，与运行时物化修订无交集 |
| ADR 0005 | 投影生成管线 | accepted | 无 | 无涉：SchemaSource/生成器/CI 保鲜管线与 materialize 专项测试门禁无交集 |
| ADR 0006 | Cordis 持久化插件与 doc 三条目内容布局 | accepted（含 2026-08-21 createDoc/owner、2026-08-22 getStatus 修订节） | 中 | 一致且被强化：P1 guard 防止 materializeRoot 内部事务并入外层 transaction，恰是「事务原子性由 Y.transact（单 update 单元）保证」前提的运行时兑付；三条目布局界定零写入断言面；修订轮零触碰持久层 |
| ADR 0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted | **直接** | 一致（含三处重点裁决）：P1 transaction guard 是 ADR 未定义空间的补全并强化「以一次 Y.transact 安装」条款；Medium 两出口均可在既有条款框架内落位（出口 2 若触碰 ADR 文本须走 owner 裁决带日期修订节惯例）；Minor 两项分别是 round-trip 承诺面与零写入承诺面的直接强化 |

无任何 ADR 处于 superseded 状态；ADR 0001/0006 的修订节均为 owner 裁决放行的内部演进，已按修订后文本对照（与初轮/rev1 两代门禁报告同口径）。

## 冲突点

**无**（0 条 hard-violation / 0 条 evolution / 0 条 override-declared）。rev2 简报未声明推翻任何 ADR；三项修订要点均为 ADR-0007/0003 既定条款的运行时兑付、验收强化或未定义空间的契约澄清（裁决权按简报规划交给 SA1，出口受本报告边界条件约束，SA8 设计后复审将按本报告条件复核）。

---

## 重点裁决一：P1——活动外层 transaction 内调用的运行时 loud fail + 零写入

**问题**：简报要求 materializeRoot 在任何写入前检测 doc 是否处于活动 transaction，处于则 loud fail、doc 零写入、不得返回 `{ok:true}`；检测机制可选 Yjs 私有字段或 Runtime 包装层 transaction context。这与 ADR-0007 materializeRoot 条款、失败边界、Runtime 编排边界是否冲突？

**裁决：no-conflict——ADR 未定义空间的运行时兑付，且方向是强化而非削弱既有条款。** 论证：

1. **ADR-0007 未授予「可在活动 transaction 内调用」的权利。** 该条款冻结的是：「内部先执行 `validateLogicalSnapshot`，再构造未集成到任何 doc 的 detached Yjs 子树，确认目标 ROOT 为空后以一次 `Y.transact` 安装。验证或构造失败时目标 doc 零写入；不覆盖、不合并、不 fallback。」——冻结安装前流程、单事务安装、失败零写入；全文没有任何条款要求本函数在嵌套 transaction 语境下仍须工作。调用语境前置条件属 ADR 未定义空间（现行实现仅以 JSDoc 声明该前置条件，`materialize.ts:54-57`）；把它升级为运行时 guard 是缺口补全，**缺口 ≠ 冲突**。

2. **guard 强化而非违反「以一次 `Y.transact` 安装」。** 若调用发生在未闭合的外层 `doc.transact` 内，内部事务将并入外层——安装不再构成 materializeRoot 自有的「一次 Y.transact」，其 update 成为外层事务单元的一部分，恰破坏 ADR-0006「事务原子性由 Y.transact（单 update 单元）保证」所预设的最外层语境。guard 在写入前拒绝，恢复的是两个条款成立的前提。

3. **loud fail + 零写入 + 不返回 ok:true 与零写入纪律相容。** 拒绝发生在任何写入之前，doc 保持不变——与 ADR-0007「验证或构造失败时目标 doc 零写入」、CONTEXT.md 零写入（「校验失败 → 400 且文档不变」）、ADR-0002 三步管线纪律（失败 ⟹ 文档不变）全部一致。「不得返回 `{ok:true}`」与成功语义条款同向（对照 mutation 条款「成功只返回 `{ ok:true }`」——被拒绝的调用不是成功，本就不在成功出口面内）。

4. **形态选择（W1 边界澄清，见下）**：rev1 W1 红线（唯一相容形态 = throw）约束的是**事务提交后**的偏离检测（DOCRT-E201 家族——写入已发生，返回 ok:false 会破坏「失败 ⟹ 文档不变」）。P1 guard 在**任何写入前**触发、doc 未变，故 throw 与 `{ok:false, issues}` 结构化失败两种形态均与零写入纪律相容；形态与错误身份/消息（是否沿用 DOCRT-E2xx 家族）归 SA1 裁决，测试断言（update === 0、state bytes 不变）在两种形态下都必须成立。

5. **两种检测机制均无条款障碍。**（a）Yjs 私有字段检测：没有任何 ADR 条款治理对 Yjs 内部状态的使用（耦合风险属 SA2 设计评审面）；（b）Runtime 包装层 transaction context：ADR-0007 Runtime 编排边界已确立 Runtime 的写入串行化职权（「NamespaceRuntime 将来按 namespace 串行化所有业务写入……业务调用方不得取得可写 Yjs 引用或绕过该入口」），transaction context 是该职权的自然延伸，属未定义空间的补全。**分层硬约束**：依赖面条款规定 `@nomicore/doc-runtime` 仅依赖 `@nomicore/vfsl + yjs`（实证 package.json 恰如此，且仓内尚无 NamespaceRuntime 包）——依赖方向是 Runtime → doc-runtime，doc-runtime 不得 import Runtime；若选（b），保证必须在 Runtime 层组合成立（由包装入口挡住活动 transaction 中的调用），doc-runtime 保持依赖洁净。此为设计边界条件（W4），非冲突。

6. **非 authority 复活**（ADR 0002）：guard 检测的是 API 调用语境（transaction 状态），不是数据值不变式体系（enum/range/conditional/state-machine）；不触碰 authority 出范围条款。

## 重点裁决二：Medium——verifyInstall 成功语义二选一

**问题**：出口 1（ok:true 保证完整 logical snapshot 返回时未被 observer 修改——增加 extract/fingerprint 完整语义校验 + 嵌套就地修改测试）或出口 2（仅保证 ROOT 顶层 keyset + identity——公共 API/ADR 明确有限保证 + 嵌套就地修改 characterization test + Runtime 禁止 observer/业务方取得可写子树引用）。与 ADR-0007 是否冲突？

**裁决：no-conflict——两个出口均落位 ADR 既有条款或其未定义空间；出口 2 若触碰 ADR 文本须走既有治理路径（W2'，见边界条件）。** 论证：

1. **成功语义的缺口是 rev1 已裁定的 ADR 未定义空间。** ADR-0007 对 materializeRoot 的承诺止于安装流程与失败零写入，无任何条款承诺「返回 ok:true 时 ROOT 与输入 snapshot 等价」；rev1 前置门禁重点裁决一已定谳「缺口 ≠ 冲突」。rev2 是在同一未定义空间内决定语义等级，不是修订任何冻结条款。

2. **出口 1（完整语义校验）是既有入口的正用 + 既有失败类的强化。** 校验载体 `extractYjsSnapshot` 是 ADR-0007 冻结的公共入口（「只读取固定 ROOT，严格验证实际 Yjs 载体并提取普通逻辑 ROOT」），rev1 RD4/W3 已用同款方式做读回比较；检测到偏离属**事务提交后**的写后检测面——形态受 rev1 W1 约束（唯一相容形态 = throw，DOCRT-E201 家族；不得返回 ok:false / 补偿修复 / 声称已回滚）。完整比较对 XML 叶子必须经语义归一化（W3），不得退化为字节相等。

3. **出口 2（有限保证）三件套全部有条款落位。**
   - 「Runtime 层禁止 observer/业务方取得可写子树引用」：直接落位 ADR-0007 Runtime 编排边界既有条款「业务调用方不得取得可写 Yjs 引用或绕过该入口」——是执行既定条款，不是新增决策；向 observer 侧的延伸与「Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报」的 observer 纪律归属同层（Runtime），属未定义空间的治理细化。
   - 「公共 API 明确有限保证」：JSDoc/公共契约文档化零 ADR 触碰。
   - 「在 ADR 中明确」：若以修订 ADR-0007 文本方式执行，**不是冲突而是治理路径问题**——澄清对象是未定义空间（无既有决策被改判，故不构成四级裁决中的 evolution），但必须循仓内既有惯例：owner 裁决放行的带日期修订节（ADR-0001 2026-08-19/08-21、ADR-0006 2026-08-21/08-22 先例），增量澄清、不改写已冻结条款，且修订节本身须经 owner（Jim）签认后方可入文（SA1 只能提案文本，不能自行落 ADR）。
   - 嵌套就地修改 characterization test：测试面，无 ADR 治理。

4. **两出口共同底线**：①②③ 验证/构造失败语义（ok:false + issues / E200）、零写入承诺、E201 throw 家族均不得削弱；顶层 keyset+identity 校验（rev1 RD1/INV-10 现行实现）在出口 2 下保留为契约、在出口 1 下成为完整校验的子集——方向只有收紧或持平，无条款回退。

## 重点裁决三：Minor——CDATA/PI/comment lexical-token 语义 + DOCRT-E200 零写入确定性覆盖

**问题**：明确 CDATA/PI/comment 按 raw Y.XmlText opaque span 承载是「lexical-token round-trip 而非结构化 XML 节点语义」并补混合内容测试；对 detached assembly 抛异常进入 DOCRT-E200 后零写入做确定性覆盖。与 ADR-0003/0007 是否冲突？

**裁决：no-conflict——前者与 ADR-0003 opaque 立场同向（受 W2 红线约束），后者是零写入承诺的直接验收强化。** 论证：

1. **lexical-token 定性与终态节点条款同向。** ADR-0003 冻结：「`xml-fragment` 是结构树的**终态节点**：无 children、路径下钻守卫到此为止；……运行时校验仅要求良构 XML。不定义实参字段与 XML 结构的映射——实参字段为文档性质。」简报要求明确 CDATA/PI/comment 是 lexical token 而非结构化节点——即明确**不**为其定义结构化 XML 节点语义，恰是「不定义映射 + opaque 承载」立场的显性化；载体细节（raw Y.XmlText opaque span、lexical-token round-trip）属 ADR 未定义的 carrier 细节空间。校验下限（「仅要求良构 XML」）不动。
2. **W2 红线（rev1 沿用）**：公共契约不得把 round-trip 承诺收紧为字符串逐字相同（ADR-0007「XML string 与 Y.XmlFragment 只承诺语义等价 round-trip，不承诺字符串逐字相同」）。lexical-token 保持可作为**载体特征**文档化并以 characterization 锁定，但不得升格为公共逐字 round-trip 承诺；混合内容测试的 XML 断言仍走语义归一化比较器纪律（W3）。元素内部混合内容测试：测试面，无 ADR 治理。
3. **DOCRT-E200 零写入确定性覆盖**：ADR-0007 明文「零写入承诺覆盖所有验证失败和 **detached 构造失败**」+「验证或构造失败时目标 doc 零写入」——对「detached XML/Yjs assembly 抛异常 → E200 → 仍零写入」做确定性触发（受控 seam 或极深树）是该承诺的直接验收强化；受控 seam 是否引入生产代码测试钩子属 SA2 设计评审面，无 ADR 条款障碍。

## 逐条对照明细（全部判 no-conflict，供复核）

| # | 被审对象条款 | ADR 依据（原文） | 裁决 | 依据 |
|---|---|---|---|---|
| 1 | 前置硬约束：rebase 到 origin/docs/doc-runtime-validation（8a42501）、逐冲突解决禁整文件 ours/theirs、策略记录、重跑 typecheck/test/materialize 专项门禁 | （无 ADR 条款治理 rebase/CI 流程；ADR-0005 CI 条款属投影保鲜轨道，无交集） | no-conflict | 纯工程流程；已核对基线分支 ADR 全集与 CONTEXT.md 和 worktree 逐字节一致，冲突基准在 rebase 后不变 |
| 2 | P1：任何写入前检测活动 transaction，外层 transaction 内调用 → loud fail + doc 零写入 + 不返回 ok:true；characterization 测试改拒绝测试（断言错误身份/消息、update === 0、state bytes 不变） | ADR-0007 materializeRoot 条款 + 失败边界 + Runtime 编排边界；ADR-0006「事务原子性由 Y.transact（单 update 单元）保证」；CONTEXT.md 零写入（引文见重点裁决一） | no-conflict | ADR 未定义空间的运行时兑付，强化「一次 Y.transact 安装」与单 update 原子性前提；拒绝发生在写入前，throw/{ok:false} 两形态均与零写入相容（W1 澄清）；详见重点裁决一 |
| 3 | P1 机制二选一：Yjs 私有字段检测 **或** Runtime 包装层维护 transaction context 保证该公共入口不可在活动 transaction 中调用（不能只靠 JSDoc） | ADR-0007 Runtime 编排边界（「NamespaceRuntime 将来按 namespace 串行化所有业务写入……」）+ 依赖面（「`@nomicore/doc-runtime` 依赖 `@nomicore/vfsl + yjs`」） | no-conflict | 两机制均无条款障碍；Runtime 选项是既定串行化职权的延伸，但受 W4 分层约束（doc-runtime 不得 import Runtime，依赖方向不可倒置）；「唯一公共物化入口」不受触碰（guard 不新增第二物化入口） |
| 4 | Medium 出口 1：ok:true 保证完整 logical snapshot 返回时未被 observer 修改——增加完整语义校验（extract/fingerprint）+ 嵌套 Y.Map/Y.Array/Y.XmlFragment 就地修改测试 | ADR-0007：「`extractYjsSnapshot(derived, doc)`：只读取固定 ROOT，严格验证实际 Yjs 载体并提取普通逻辑 ROOT」+ 失败边界（「不虚假声称自动回滚，也不尝试 fallback」）+ round-trip 条款 | no-conflict | ADR 既有入口的正用；写后偏离检测受 W1 约束（唯一 throw 形态）；完整比较受 W3 约束（XML 语义归一化）；方向只在 rev1 INV-10 之上收紧 |
| 5 | Medium 出口 2：仅保证 ROOT 顶层 keyset + identity——公共 API/ADR 明确有限保证 + 嵌套就地修改 characterization test + Runtime 禁止 observer/业务方取得可写子树引用 | ADR-0007 Runtime 编排边界：「业务调用方不得取得可写 Yjs 引用或绕过该入口」+「Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报」 | no-conflict | 引用禁止是既定条款的执行；有限保证是未定义空间的显性化——JSDoc 路线零 ADR 触碰，ADR 文本路线须走 owner 裁决带日期修订节惯例（W2'，非冲突、非 evolution：无既有决策被改判） |
| 6 | Minor-1：CDATA/PI/comment 为 lexical-token round-trip（非结构化 XML 节点语义）明确定义 + 元素内部混合内容测试 | ADR-0003：「`xml-fragment` 是结构树的**终态节点**……不定义实参字段与 XML 结构的映射」+「运行时校验仅要求良构 XML」；ADR-0007：「只承诺语义等价 round-trip，不承诺字符串逐字相同」 | no-conflict | 与 opaque 终态节点立场同向（明确不定义结构映射 = 维持条款）；受 W2 约束：lexical 保持是载体特征文档化/characterization，不得升格为公共逐字 round-trip 承诺 |
| 7 | Minor-2：detached XML/Yjs assembly 抛异常进入 DOCRT-E200 后零写入的确定性覆盖（受控 seam 或极深树） | ADR-0007：「零写入承诺覆盖所有验证失败和 detached 构造失败」「验证或构造失败时目标 doc 零写入」 | no-conflict | 零写入承诺的直接验收强化；受控 seam 的生产代码形态归 SA2 评审，无 ADR 障碍 |
| 8 | Review 结论与发布要求：rebase → 修复外层 transaction 假成功 → 明确嵌套 observer 成功语义；push --force-with-lease、更新 PR #84、严禁提交 `.mabf-bg/**` | （无 ADR 条款治理发布流程） | no-conflict | 纯流程条款；三项实质要求即 #2/#3/#4/#5 已裁 |
| 9 | 附带核对：rev2 建立在 rev1 基线（RD1–RD6 / INV-10 / F11 / verifyInstall + E201）之上 | （wiki 档案与代码不构成冲突基准——门禁边界条款） | no-conflict | 基线的 ADR 合规已由 rev1 两份门禁报告裁决（均 clear，含 W1/W2/W3 红线）；本轮按 ADR 原文独立复核 rev2 修改面（guard/语义等级/测试），未发现基线遗留冲突 |

## 边界条件（非冲突；SA1 设计约束 + SA8 设计后复审复核锚点）

- **W1（写后偏离唯一相容形态 = throw，rev1 沿用 + rev2 澄清）**：事务提交后检测到 observer 偏离（E201 家族），唯一相容形态是 throw——返回 ok:false / 结构化失败、补偿修复写入、声称已回滚分别落入「零写入承诺」「不覆盖、不合并、不 fallback / 不尝试 fallback」「不虚假声称自动回滚」违反面。rev2 澄清：该红线只约束**写后**检测面；**P1 guard 在写入前触发，throw 与 `{ok:false}` 均相容**（doc 未变，零写入纪律两形态都成立），形态与错误码家族归 SA1；但无论何种形态，不得静默 no-op、不得返回 `{ok:true}`，测试必须锚 update === 0 与 state bytes 不变。
- **W2'（ADR 文本触碰治理路径）**：Medium 出口 2 若需在 ADR-0007 中明确有限保证，必须循 owner 裁决放行的带日期修订节惯例（ADR-0001/0006 先例）——增量澄清、不改写已冻结条款；SA1 只能提案修订节文本，入文须经 owner（Jim）签认。仅改 JSDoc/公共 API 文档则零 ADR 触碰。若 SA1 实际产出出现「无 owner 签认自行改写 ADR 冻结条款」，届时升级为 hard-violation。
- **W2（XML 断言红线，rev1 沿用）**：CDATA/PI/comment 的 lexical-token 保持只能作为载体特征文档化与 characterization 锁定，公共契约不得收紧为字符串逐字 round-trip 承诺（ADR-0007 只承诺语义等价）；失败场景保持单 issue + 0 update + state 字节不变。
- **W3（语义比较红线，rev1 沿用）**：出口 1 的完整语义校验对 XML 叶子必须经语义归一化比较，不得退化为字节相等。
- **W4（分层红线，rev2 新增）**：P1 若选 Runtime 包装层选项，保证必须在 Runtime 层组合成立——`@nomicore/doc-runtime` 不得 import Runtime（依赖面条款：doc-runtime 恰依赖 `@nomicore/vfsl + yjs`，实证 package.json 如此），依赖方向 Runtime → doc-runtime 不可倒置；且 guard 不得新增第二物化入口（「唯一公共物化入口」条款不触碰）。Yjs 私有字段耦合与受控 seam 的生产代码形态属 SA2 设计评审面，SA8 不预裁。

## 结论

**verdict = clear，放行进入修订流水线（rebase → SA1 → SA8 设计后复审 → SA2 → SA3 → SA4 → SA7 → AC 门禁）。**

- 冲突点数：**0**；裁决分布：no-conflict × 9（明细行 #1–#9，其中 #2/#3/#4/#5/#6/#7 含三组重点裁决展开）、override-declared × 0、evolution × 0、hard-violation × 0。
- 三项修订重点关注均裁 **no-conflict**：P1 transaction guard 是 ADR-0007「一次 Y.transact 安装」+ ADR-0006「单 update 单元」前提的运行时兑付（未定义空间补全，方向强化）；Medium 两出口均落位既有条款或未定义空间（出口 2 的 ADR 文本路线受 W2' 治理路径约束）；Minor 两项分别是 ADR-0003 opaque 立场的显性化（受 W2 约束）与 ADR-0007 零写入承诺的验收强化。
- 无需任何 override；无条目需 Jim 裁决（唯一接近治理面的出口 2「ADR 中明确」已按仓内 owner 修订节惯例给出路径：SA1 提案、Jim 签认入文，属流程内动作而非冲突上报）。W1/W2'/W2/W3/W4 为 SA1 设计红线与 SA8 设计后复审的复核锚点；相关决议文档已同步产出（`task_doc-runtime-materialize-root-rev2_relevant_decisions.md`）供全链 SA 复用。

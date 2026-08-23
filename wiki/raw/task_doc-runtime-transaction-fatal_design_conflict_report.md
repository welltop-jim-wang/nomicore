# 冲突门禁报告（设计后复审 R1）

- 被审对象：`wiki/raw/task_doc-runtime-transaction-fatal_design.md`（SA1 设计 R1，595 行；总控移交四项设计输入 + 设计期新发现 §8）
- 冲突基准：`docs/adr/0001`–`0008` 全集 + `CONTEXT.md` + 前置门禁产出（`task_doc-runtime-transaction-fatal_relevant_decisions.md` 约束清单、`_conflict_report.md` 边界条件 W1–W5 与观察项 O1/O2）
- 复审性质：设计后复审（轻量）——按 ADR 决策集与前置门禁锚点对照设计决策；全维度攻击评审属 SA2，实现质量属 SA4/SA7，本文不越界
- 门禁：SA8（run_id: issue-87-1787469258-378585）；前置门禁 verdict=clear（0 冲突点）
- 实证核对：本复审对设计的关键事实主张做了代码级抽查（见「实证核对表」），全部成立

## Verdict

`clear`

## 实证核对表（设计事实主张 → 代码实证）

| # | 设计主张 | 核对结果 |
|---|---|---|
| V1 | `makeRefResolver` 双副本（`resolve.ts` materialize 供给链 / `extract.ts:233` extract·read 供给链） | ✓ `grep makeRefResolver src/`：materialize.ts:38 导入 resolve.js；extract.ts:62 与 read.ts:26（经 extract.js）用自有副本——副本隔离主张成立 |
| V2 | `DOCRT-E203/E204/E205` 码未被占用 | ✓ `git grep` 0 命中（exit 1） |
| V3 | U13 锚 = `toThrow('observer-boom')`（子串）+ observeCalls=1 + events.count=1 | ✓ `materialize-root.test.ts:595-600` 逐字核对；vitest `toThrow(string)` 子串包含语义为公开文档行为（P-1 另有 chai 实测） |
| V4 | ⑤⑥ E201 消息「逐字不变」可保持 | ✓ 现行四处 E201 消息（`materialize.ts:160/171/183/191`）经 read 核对，设计仅换类不换文；既有 E201 锚 37 处（13+24）全部消息子串/正则形态 |
| V5 | E200 既有锚仅 rev2 Minor-2（极深 XML RangeError = 类 C） | ✓ 全 test 目录 grep：唯一既有 E200 断言锚 = `materialize-root-rev2.test.ts:370/387`（RangeError → ok:false）；无「手造派生物→E200」遗留测试锚（仅 src 注释与 SA6 新红灯）——类 A 拆出无回归面 |
| V6 | E202 锚（17 处）零触碰 | ✓ §5 裁决零改动，5+12 处锚全部不动 |
| V7 | ES2022 target/lib（ErrorOptions.cause + 原生 class） | ✓ `tsconfig.base.json:3-4` |
| V8 | SA6 红灯文件存在且 §8 fixture 缺陷**已被对齐** | ✓ 两文件在（24_601/12_455 字节）；apply 文件用例 2/3 当前状态已是「seed → `expect(seed.ok)` → `root.observe`」正确时序，注释注明「SA1 设计 §8 对齐」（git 状态 AM）——§8 发现已被 SA6 采纳执行，R-1 风险在当前 worktree 已解 |
| V9 | mutation 参数形状与 SA6 锚一致 | ✓ `SET_TITLE_MUTATION = { op:'set', path:['title'], value:'t2' }`（apply 测试 :129） |

## 设计决策点逐条裁决（全部 no-conflict）

| # | 设计决策（出处） | ADR/红线依据 | 裁决 | 依据 |
|---|---|---|---|---|
| D1 | `DocRuntimeFatalError` 形状：`extends Error` + `committed` + `phase` + name/cause（§3.1） | ADR-0008：「`@nomicore/doc-runtime` 必须提供 branded `DocRuntimeFatalError`，至少包含 `committed` 与稳定 `phase`」（W2'） | no-conflict | ADR 原文最小面逐字兑付；cause/message 只携带事实（W4），无 Runtime 层动作 |
| D2 | phase 取值集 v1 冻结表：三值 + committed 恒定值随 phase 冻结 + 只增不改不删（§3.2） | ADR-0008「稳定 `phase`」；前置门禁重点裁决二（phase 取值集 = ADR 留白空间，归 SA1 定稿） | no-conflict | 落空白间的显性化定稿；AC-2 三相映射明确标注；命名诚实性说明（'observer-cleanup-throw' 命名逃逸点类别、message 不谎称已甄别来源）与 W3 诚实纪律同向；详见重点裁决一 |
| D3 | `transactGuarded`：④ 逃逸异常统一包装 branded `committed:true`（E203，cause=原值、message 含原文）（§3.3） | ADR-0007：「事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback」；ADR-0008：「`committed:true` 或未知异常保守视为可能已提交」（W1/W3） | no-conflict | 裸值→branded 是「视为 internal/fatal」条款的可识别化强化；形态仍 throw（W1）；D10 论证下事务体不可抛 ⇒ 逃逸即 cleanup 期（已提交）——committed:true 是事实而非仅保守；防御性 instanceof 透传杜绝双重包装 |
| D4 | ⑤⑥ E201 裸 Error → branded（消息逐字不变）（§3.4） | W1（写后唯一相容形态=throw）+ ADR-0007 失败边界 | no-conflict | 形态/消息/零补偿纪律零变化，仅类替换；V4 实证 37 处既有锚保持绿 |
| D5 | E200 崩溃边界拆分：类 A（派生物不变量破坏）→ E204 `committed:false` fatal；类 B/C 留守 E200（§4） | 前置门禁重点裁决三（「意外异常归类」= ADR 未枚举空间，归 SA1，受 W1/W3/W5 约束）；ADR-0008：「普通、可预期且零写入的读取或写入失败使用领域化结果联合」 | no-conflict | 判据（信任边界=损坏方）与两通道边界自洽：类 A 写前零触碰（零写入承诺成立，W3 锚 0 update/state 字节/ROOT 空置）；类 B（调用方数据敌对）留联合防 Runtime 因用户数据误关写；类 C（rev2 Minor-2 冻结形态）留守保既有绿灯；详见重点裁决二 |
| D6 | E202 不 fatal 化：保持裸 Error throw，三变体消息不变（§5） | 前置门禁 O2 裁决路径；ADR-0008 fatal 家族治理面 = internal fatal | no-conflict | O2 建议路径的落实；E202 是调用方契约破坏非引擎 internal failure；Runtime 判据 instanceof 登记为未来设计输入；详见重点裁决三 |
| D7 | U13「原样传播」演进为「原样事实携带」：测试字节零改动、message 含子串 + cause 原实例（§6） | ADR-0007 失败边界（fatal 定性/不谎称回滚/不尝试 fallback）；W1 | no-conflict | ADR 无任何「裸值原样」条款——「原样传播」措辞源自 rev1 wiki 契约（INV-5/F10），演进落在 wiki 档案自身治理面；ADR-0007 条款被强化而非修订；详见重点裁决四 |
| D8 | `applyValidatedMutation` set-only 最小落地：ADR-0007 冻结管线骨架逐句直译 + 仅 set + 未支持三操作响亮领域拒绝 + 移交清单（§7） | ADR-0007 applyValidatedMutation 条款（管线/set 语义/损坏 ROOT/成功返回/TOCTOU）；ADR-0008：「ROOT mutation 与 SCHEMA replacement 使用各自独立的窄 issue 类型」；前置门禁 O1 + 总控设计输入 #4 | no-conflict | 已实现面全部条款逐句兑付（见重点裁决五明细）；未实现面无任何 ADR 条款规定交付时序，响亮拒绝 + 显式移交清单满足 O1「不静默扩范围」；详见重点裁决五 |
| D9 | 导出面：五项新导出；不导出 RuntimeWriteFatalError / DerivedInvariantError / transactGuarded（§3.5） | W2'/W4；ADR-0007 依赖面 | no-conflict | 两层命名互不侵占；内部件不进公共面（makeRefResolver @internal 先例） |
| D10 | §8 fixture 时序缺陷登记（SA6 owned，~6 行位移） | （无 ADR 条款治理测试 fixture；流程登记面） | no-conflict | 设计不越权代改、显式移交总控/SA6；V8 实证当前 worktree 已对齐（R-1 已解），AC 门禁按对齐后时序复核 |
| D11 | 文件范围 ALLOW/DENY：read.ts/extract.ts/carrier/xml-parse/vfsl/persistence/ADR 零触碰（§15） | ADR-0008 演进条目 1/3 划分；ADR-0006（持久化失败不并入 fatal）；前置门禁 O1/W4 | no-conflict | 演进条目 1/3 显式推迟为独立任务；`docs/adr/**` 零触碰与本任务零 override 一致 |

无 override-declared、无 evolution、无 hard-violation。设计未触碰任何 ADR 文本（DENY LIST 明示 `docs/adr/**` 不动）。

---

## 重点裁决一：phase 取值集定稿（设计输入 #1）vs ADR-0008

**裁决：no-conflict——ADR-0008 留白空间的显性化冻结，方向与「稳定 phase」条款完全同向。**

1. ADR-0008 只冻结「至少包含 `committed` 与稳定 `phase`」，未枚举取值集——前置门禁重点裁决二已裁定该枚举属 SA1 设计空间；本设计以冻结表 + 「只增不改不删」纪律 + 「committed 恒定值随 phase 一并冻结」落定，恰是「稳定」要求的机制化。
2. 三相 ↔ AC-2 术语映射逐项对齐（`observer-cleanup-throw` ↔ observer cleanup throw；`post-commit-verification` ↔ post-transaction verification；`pre-commit-internal` ↔ 明确 pre-commit internal failure），命名取 committed 事实面（post-**commit**），无歧义残留。
3. committed 恒定值的三处赋值均有事实依据而非任意：E203（逃逸即 cleanup 期，事务已提交——D10 论证 + P-2 实证）；E201（⑤⑥ 在 ④ 返回后）；E204（prepare 内一切 doc 触碰之前）。W3「committed:true 不得降格」「未识别保守归 true」由此可机读校验。
4. phase 值是新公共契约事实（ADR 未定名）——冻结纪律一旦发布即约束后续任务（mutation 侧 post-commit 复用 `post-commit-verification`、未来新 phase 须显式立项），与 CONTEXT.md 方言「一经发布冻结，引擎只增不改」文化同源，登记于相关决议文档供全链引用。

## 重点裁决二：E200 拆分判据（信任边界）vs ADR-0007 零写入承诺与 W5

**裁决：no-conflict——前置门禁明文授权的归类定夺，判据自洽，零写入承诺与既有锚全部保住。**

1. **授权链**：前置门禁重点裁决三第 3 条明文「『意外异常』归类调整属 ADR 未枚举空间、归 SA1，但受 W1/W3/W5 约束」——本设计正是该授权的行使。
2. **零写入承诺（ADR-0007「零写入承诺覆盖所有验证失败和 detached 构造失败」）**：类 A 拆出后的 E204 全部发生在 prepare（一切 doc 触碰之前），零写入承诺以更强形态成立——从「ok:false 返回」升级为「committed:false branded fatal + 0 update/state 字节/ROOT 空置锚」（红灯 AC-2/AC-6 组直锚，测试文件 :348 describe 实证）。return→throw 形态变更无 ADR 条款障碍（ADR-0007 冻结的是验证失败 → 结果联合，手造派生物不是验证失败；E200 收编是 rev1 wiki 决策非 ADR 条款），且 V5 实证无遗留测试锚。
3. **W5（领域联合不吞并）**：拆分是**收窄**不是吞并——E200 保留类 B/C（敌对输入/资源极限，均为「普通、可预期且零写入」失败），消息逐字不变；rev2 Minor-2 冻结形态（V5）留守即绿。ADR-0008「领域化结果联合」条款面无损。
4. **判据自身的 ADR 落位**：类 A = 引擎内部链路损坏（evaluate 产物被手造）→ 正是 ADR-0008「任何 internal fatal……永久关闭该 Runtime 的全部写能力」处置正确的种群；类 B = 调用方数据 → ADR-0008 结果联合面（Runtime 不得因用户数据关写）；类 C = 输入比例资源极限 → 同 B。sentinel 仅 4 个「手造派生物」诊断点（§4.3 全枚举，V1/V5 辅证），Proxy/getter/RangeError 路径不经 sentinel——R-2 缓解成立。
5. **⑥ scratch 侧 sentinel → E201 变体 D（committed:true）**：同类异常按**管线位置**分相（prepare 侧零写入 → false；⑥ 侧事务已提交 → true）——committed 是位置事实的诚实披露，两处分类与 W3 一致。

## 重点裁决三：O2 落实——E202 不 fatal 化（设计输入 #2）

**裁决：no-conflict——前置门禁 O2 建议路径的忠实落实。**

1. O2 原文给出两路径：「保持独立拒绝形态（非 branded fatal）」或 fatal 化并接受语义重量；设计选前者并补强论证（E202 = 调用方契约破坏，确定性检测、写前零写入，不属「internal fatal」种群）。
2. ADR-0008 的 fatal 家族条款（「任何 internal fatal」）对 E202 无适用面——该 ADR 对 E202 沉默，不构成「必须 fatal 化」的约束；保持现状零 ADR 触碰。
3. W3 自检成立：E202 零写入与 committed:false fatal 同向；V6 实证 17 处既有 E202 锚零改动。
4. Runtime 判据（`instanceof DocRuntimeFatalError`，不按消息前缀）登记为未来 `@nomicore/namespace-runtime` 设计输入——属登记面，非本任务冲突。
5. 精度修正项（非冲突，见观察项 N1）：设计 §5.2 将「该 ADR 只约束 internal fatal 面」表述为「ADR-0008 明文豁免」——该句实为前置门禁冲突报告 O2 的措辞，ADR-0008 原文无此句。实质结论不变（ADR-0008 fatal 条款均以 internal fatal 为条件），建议 SA3/文档落文时按实际出处（SA8 门禁 O2 裁决）引用。

## 重点裁决四：U13 演进——toThrow 子串语义（设计输入 #3）

**裁决：no-conflict——被演进的措辞是 wiki 级契约，不是 ADR 条款；ADR-0007 失败边界被强化而非修订。**

1. **ADR 层零触碰**：ADR-0007 失败边界对 observer 抛错的要求是「视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback」——裸值传播并不满足「可视为 fatal」的可识别性，branded E203（committed:true + phase + cause 原实例 + message 原文）恰是该条款的兑现形态。演进方向 = 对 ADR 对齐强化。
2. **「原样传播（裸值）」的出处**：rev1 wiki 设计（RD5/RAC-5、INV-5/F10、U13 注释）——非 ADR、非 CONTEXT.md；按门禁边界，wiki 档案不构成冲突基准，其演进属档案自身治理（设计 §6.3 已作演进前后对照登记，供 AC 门禁复核）。
3. **机械锚保真**：U13 四断言（V3 实证）——`toThrow('observer-boom')` 子串命中（E203 message「原始异常原样携带：observer-boom」）✓；`observeCalls === 1`（包装在逃逸之后、无重入）✓；`events.count === 1` + `title='t'`（包装器零写入零补偿）✓；文件字节零改动 ✓。W1 四不（不吞并/不改写 E200·E201/不补偿/不谎称回滚）全部保持。
4. **事实保留强度提升**：cause 携带原始 thrown 值实例 ≥ 现行裸传播（同为原实例上抛，另加 branded 身份与 committed/phase 事实）——无信息损失。
5. U13 注释与可执行锚的固有落差（注释声称「精确匹配/非包装」、锚实为子串）由设计 §6.1 实证澄清并登记——注释性、非断言性，不构成门禁条件（AC 门禁复核项已移交）。

## 重点裁决五：O1 最小落地——applyValidatedMutation set-only 是否越界（设计输入 #4）

**裁决：no-conflict——不越界：已实现面逐句兑付 ADR-0007 冻结条款，未实现面无条款约束且以显式 fencing 移交。**

**已实现面对 ADR-0007 applyValidatedMutation 条款的逐句兑付**：

| ADR-0007 原文条款 | 设计落点 | 判定 |
|---|---|---|
| 「同步完成当前 ROOT 结构/逻辑检查、在普通 JSON 副本中模拟 mutation、完整 ROOT 逻辑校验、detached 子树构造和单次 Yjs transaction」 | §7.2 (C)-(H)：extract+validate → clone+placeSet → validate(proposed) → buildTopEntries → transactGuarded 单事务 | ✓ 五要素逐句直译（PRD §6 次序一致） |
| 「不公开可跨时间执行的 prepared mutation，避免 TOCTOU」 | 全同步、无跨时间状态 | ✓ |
| 「set 不自动创建中间容器；最终目标可为已有字段、缺失 optional 字段或新 Record 键」 | §7.3 中间段须已存在键；终段三形态（合法性由 (F)/(G) 仲裁） | ✓ |
| 「`set([])` 允许整体替换 ROOT；旧 Yjs 子类型引用失效，不做 identity-preserving diff」 | §7.3 空 path + (H) clear+install | ✓（全量重建正是 ADR-0007 后果条款「首版 mutation 为正确性执行完整 ROOT 提取与逻辑校验」的直译） |
| 「当前 ROOT 已损坏时普通 mutation 失败，不承担 recovery」 | (C) extract 失败 → ok:false + issues | ✓ |
| 「成功只返回 `{ ok:true }`，不返回 snapshot、Yjs update 或内部类型」 | §7.1 结果联合 | ✓ |
| 「底层能力各自保留领域化结果联合……」/ ADR-0008「ROOT mutation……各自独立的窄 issue 类型」 | `MutationIssue` 独立类型 | ✓ |

**未实现面（delete / array-insert / array-delete / mutation 侧 ⑥ / 参数具名类型）**：

1. ADR-0007「首版 mutation 仅支持 `set`、`delete`、`array-insert`、`array-delete`」是**能力语义契约**（冻结这四操作各自的行为边界），不是**交付时序契约**——无任何条款要求四操作同日面世。set-only 切片对已实现操作不违反任何条款，对未实现操作以「领域单 issue 响亮拒绝 + 精确消息」处理 = ADR-0008「普通、可预期且零写入的……使用领域化结果联合」的逐句情形（W5 同向），非静默降级、非 fallback。
2. **范围治理合规**：前置门禁 O1 禁止的是「静默实现完整 validated mutation 管线」；本设计（a）只落最小骨架、（b）总控已以设计输入 #4 显式授权该最小面（显式而非静默）、（c）§7.5 移交清单五项逐条登记防「静默半成品」——三重 fencing 满足 O1。
3. **不复用 ⑥ 与 W1**：W1 约束「检测到偏离 → 唯一相容形态 throw」，不强制检测面宽度；⑥ 对称重物化是 materializeRoot rev2 专属加固（INV-11），mutation 侧 (I) 复用 ⑤（branded E201 committed:true）已覆盖 AC-6 所需 fatal 面。检测面宽度差异属 SA2 评审面。
4. **登记条件（移交未来 validated-mutation 任务）**：三操作语义须按 ADR-0007 条款补全（「delete 禁止 ROOT、required 字段和数组下标；只允许 optional 字段与 Record 动态键」「array insert/delete 使用严格非负整数边界，不 clamp、不接受空 insert、count=0 或越界 no-op」）；mutation 参数具名联合类型冻结；R-4（full-replace 丢弃未声明键）——生产不可达论证成立（封闭对象纪律 + ADR-0007「业务调用方不得取得可写 Yjs 引用」），登记即可。
5. **E205 与 ⓪/E204/E203 同规**：mutation 侧崩溃边界与 materializeRoot 同构（类 B/C → ok:false；sentinel → E204；⓪ → E202；④ 逃逸 → E203）——同一 `transactGuarded`/sentinel 构件保证 exact identity（AC-6 结构性成立），通道分类与 §4/§5 判据单一真相。

## W1–W5 边界条件复核表

| 红线 | 设计落实点（本文核对） | 判定 |
|---|---|---|
| W1 写后 fatal 唯一形态 = throw/reject | E201/E203 全 branded throw、消息无回滚声称（ROLLBACK_CLAIM 正则自检 §3.3）；E204 写前 throw；无 ok:false 后门、无补偿写 | ✓ |
| W2' branded 形状与命名 | `DocRuntimeFatalError` + `committed` + `phase`（ADR-0008 原文）；不导出 `RuntimeWriteFatalError`（§3.5 模块级断言）；phase 冻结表 §3.2 | ✓ |
| W3 零写入锚 + 诚实 committed | E204 → 0 update/state 字节/ROOT 空置（红灯 :348 组）；committed:true 三处不降格；未识别 thrown 值保守 true（红灯 :366 组，AC-5） | ✓ |
| W4 分层红线 | fatal.ts 仅 import yjs；mutation.ts 仅 yjs+vfsl+包内；无 Runtime/持久层 import；fatal 只携带事实（无 notifyDirty/无写关闭动作） | ✓ |
| W5 领域联合不吞并 | E100/E200(类 B/C)/E202/E205 + AC-3 护栏留守联合；fatal 化仅类 A（收窄方向）；V5 实证既有 E200 锚留守 | ✓ |

前置门禁观察项处置：O1 → 设计输入 #4 落实（重点裁决五）；O2 → 设计输入 #2 落实（重点裁决三）。均闭环。

## 观察项（非冲突；移交 SA3/SA4/SA6/AC 门禁）

- **N1（引文出处精度）**：设计 §5.2「ADR-0008 明文豁免：「该 ADR 只约束 internal fatal 面」」——该句为前置门禁冲突报告 O2 的措辞，非 ADR-0008 原文（ADR-0008 对 E202 无条款、属沉默而非豁免）。实质结论不变；建议落文时改引「SA8 前置门禁 O2 裁决」。
- **N2（§8 状态更新）**：apply fixture 用例 2/3 的时序对齐**在当前 worktree 已执行**（V8：seed 先于 observer，注释注明「SA1 设计 §8 对齐」，git AM）——R-1 已解；AC 门禁按对齐后时序复核，SA7 勿再按设计原文的「未对齐」状态验收。
- **N3（mutation 参数形状 v1 事实）**：`{ op:'set', path, value }` 冻结为 doc-runtime 侧 v1 事实（对齐 SA6 锚，V9）——ADR 留白空间的新公共契约事实；未来 validated-mutation 任务定稿四操作联合类型时如需改形，属公共契约演进，须显式登记（相关决议文档已追加）。
- **N4（phase 冻结的下游约束）**：phase 取值集与 committed 恒定映射一经发布即约束后续任务（新 phase 须显式立项、不得改名/复用错位）——已追加至相关决议文档，供 SA2/SA3/SA4/SA7 与未来任务引用。

## 结论

**verdict = clear，设计放行进入 SA2 全维度评审。**

- 冲突点数：**0**；裁决分布：no-conflict × 11（D1–D11，其中五项为总控点名重点面展开）、override-declared × 0、evolution × 0、hard-violation × 0。
- 五个重点复核面全部 **no-conflict**：phase 取值集 = ADR-0008 留白的显性化冻结（方向强化「稳定 phase」）；E200 拆分 = 前置门禁明文授权的归类定夺（判据自洽、零写入承诺与既有锚全保）；E202 不 fatal 化 = O2 建议路径忠实落实；U13 演进 = wiki 级措辞演进 + ADR-0007 强化（ADR 层零触碰）；applyValidatedMutation set-only = 不越界（已实现面逐句兑付、未实现面显式 fencing 移交）。
- W1–W5 全部合规；前置门禁 O1/O2 双双闭环；设计实证主张抽查 9/9 成立（V1–V9）。
- 相关决议文档已同步追加「设计引入的新决策点」（phase 冻结表 / E203-E205 码面 / sentinel 判据 / E202 裁决 / U13 契约演进 / mutation 最小面与移交清单），供 SA2/SA3/SA4/SA6/SA7 全链复用。

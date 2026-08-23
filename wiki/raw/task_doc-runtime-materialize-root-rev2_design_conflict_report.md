# 冲突门禁报告（修订轮 rev2 设计后复审）

- 被审对象：`wiki/raw/task_doc-runtime-materialize-root-rev2_design.md`（SA1 设计，607 行，RD7–RD11 / INV-11 / E202 / E201 变体 C-D）
- 冲突基准：`docs/adr/0001`–`0007` 全集 + `CONTEXT.md`（与前置门禁同一基准，已核对 rebase 前后一致）
- 复审依据：前置门禁报告 `task_doc-runtime-materialize-root-rev2_conflict_report.md`（verdict=clear）及其边界红线 **W1 / W2' / W2 / W3 / W4**；按技能纪律不重复前置门禁的全量 ADR 盘点，只裁设计与 ADR 决策集 + 红线的一致性
- 门禁：SA8（run_id: issue-74-1787396362-3288866）
- 事实核验（SA8 本轮独立执行，非转抄设计自述）：yjs@13.6.32 `Doc.d.ts:49/53` 公开声明 `_transaction: Transaction | null` / `_transactionCleanups: Array<Transaction>`（PA-4 属实）；`xml-parse.ts` 头部规则 2（注释/CDATA/PI 逐字 XmlText）与规则 4（yjs 序列化投影、语义等价）在文；`extract.ts` INV-6（顶层 try/catch → E100 结构化返回，绝不外抛）在文；SA6 双测试文件已落盘且 T-1 已整块替换为拒绝测试（主断言「绝不为 ok:true」+ 占位形态断言 + 0 update/state 字节断言），Medium ×3 `/DOCRT-E201/`、Minor-2 极深树 `/DOCRT-E200/` 断言形态与设计 §7 对齐表一致；rev1 档案引用属实（rev1 设计 R-7 行 L232、rev1 SA2 #1「不建议」原文、T-1 预登记漂移条款）

## Verdict

`clear`

## 冲突点

**无**（0 条 hard-violation / 0 条 evolution / 0 条 override-declared）。设计未触碰任何 ADR 文本（DENY LIST 明文 `docs/adr/**`，出口 1 零 ADR 修订——W2' 不触发）；全部新决策落位于前置门禁已裁决的 ADR 条款框架或其未定义空间，五条边界红线逐条复核通过（见下表）。

## 边界红线逐条复核

| 红线 | 前置门禁定义（约束面） | 设计落点 | 复核结论 |
|---|---|---|---|
| **W1** | 写后偏离唯一相容形态 = throw（E201 家族）；写前 P1 guard throw/{ok:false} 两形态均相容，形态归 SA1；不得静默 no-op、不得返回 ok:true，测试锚 update===0 + state bytes 不变 | RD7 guard 写前 throw E202（§3.5 五点论证选 throw，两形态合规空间内）；RD8 ⑥ 写后检测变体 C/D 均 throw；⓪ 不在任何 try/catch 内（不被 E200 收敛成 ok:false）；SA6 T-1 主断言「绝不为 ok:true」+ 0 update + state/vector 字节不变 | ✅ 合规（写前选 throw 属 W1 明文授权的 SA1 裁决权；写后 C/D 均 throw，变体 D 消息明示「不代表已检测到偏离」——不虚假声称，与「不虚假声称自动回滚」同款诚实纪律） |
| **W2'** | 出口 2 若触碰 ADR-0007 文本须走 owner 带日期修订节（SA1 提案、Jim 签认） | 设计定稿出口 1（§4.1 六维对照），明文「零 ADR 触碰（无需 W2' owner 修订节流程）」；DENY LIST `docs/adr/**`；「SA1 无 ADR 写权」 | ✅ 合规（W2' 为条件性红线，条件不触发；出口 2 的「公共 API 明确」成分经 JSDoc 路线回收，零 ADR 触碰） |
| **W2** | CDATA/PI/comment lexical-token 只能载体特征文档化 + characterization 锁定，公共契约不得收紧为逐字 round-trip 承诺 | RD9（§5.1/§4.4 第 4 条）：措辞明示「载体特征」「不是结构化 XML 节点（ADR-0003 终态节点 + 不定义结构映射立场）」「公共承诺面仍为 ADR-0007 语义等价 round-trip，不承诺字符串逐字相同」；零行为改动；SA6 混合内容测试即 characterization 锚；§4.3 canonical 比较基准明文「内部比较基准，不构成公共逐字 round-trip 承诺」 | ✅ 合规（逐字字样仅出现于载体事实描述与内部比较基准，公共承诺面显式维持语义等价——恰为 W2 允许的形态） |
| **W3** | 完整语义比较对 XML 叶子必须经语义归一化，不得退化为字节相等 | RD8 比较器 xml-fragment 行（§4.2 表）：两侧同经 `canonicalXmlOf` 归一化（属性按名排序 + last-wins + 引号归一 + 自闭合/空元素同形）后比较，**「禁止字节直接比较」明文**；归一化件复用 xml-parse.ts 共享扫描器（单一事实源，不另造词法） | ✅ 合规（W3 直接落地件；span 级逐字保留是 canonical 内部基准的组成——注释/CDATA/PI 是逻辑值字符串的组成部分而非序列化 trivia，归一化只消除 yjs 投影 trivia，语义对象未收窄也未越界升格） |
| **W4** | doc-runtime 不得 import Runtime（依赖方向 Runtime → doc-runtime 不可倒置）；guard 不得新增第二物化入口；yjs 私有字段耦合属 SA2 评审面 | RD7 机制 (a)：guard 全部位于 materialize.ts 内，仅读 `doc._transaction`/`doc._transactionCleanups`（yjs 是既有直接依赖，实证 package.json 无新增依赖）；`assertOutermostTransactionContext` 等 4 个新函数均模块内部件不进公共导出面；「唯一公共物化入口」不触碰 | ✅ 合规（W4 的条件面——Runtime 选项——未被选择，其约束自动满足；机制 (a) 本身在前置门禁「两机制均无条款障碍」的许可空间内，私有字段耦合风险按前置门禁预留归 SA2） |

## 六项重点关注裁决（对应总控交办单）

### 裁决一：RD7 机制 (a) yjs 内部字段检测 vs W4 —— no-conflict，W4 合规

1. **W4 是条件性红线**：其约束对象是「若选 Runtime 包装层选项」的落位方式（保证必须在 Runtime 层组合、doc-runtime 不得 import Runtime、不新增第二物化入口）。设计选机制 (a)，条件不触发；且设计主动满足了 W4 的无条件部分——guard 位于 doc-runtime 包内、零新依赖（yjs 既有）、`assertOutermostTransactionContext` 为模块内部件、不进公共导出面、不新增第二物化入口。「唯一公共物化入口」条款（ADR-0007）完好。
2. **机制 (a) 在前置门禁许可空间内**：前置门禁重点裁决一第 5 点明文「（a）Yjs 私有字段检测：没有任何 ADR 条款治理对 Yjs 内部状态的使用（耦合风险属 SA2 设计评审面）」——选 (a) 无条款障碍；SA8 对私有字段耦合本身不预裁（设计已自携五点缓解 + 窗口 C fail-closed + R-1 登记回退，供 SA2 评审判定）。
3. **否决机制 (b) 不是冲突**：前置门禁裁定两机制均可落位，选择权在设计；设计的否决理由（裸 `Y.Doc` 入口使记账方案原理上无法闭环、NamespaceRuntime 尚不存在——与 SA8 前置门禁实证一致）属设计质量论证，SA2 领地。设计未借否决 (b) 修改任何 ADR 条款（ADR-0007 Runtime 编排边界的「将来」条款原样保留，设计 §4.1 明文登记「本轮零动作（无落地层；设计只登记归属，不造脚手架）」）。
4. **事实核验**：PA-4 属实（`Doc.d.ts:49/53` 公开类型声明，TS 可类型化访问，非 `any` 强转）；yjs 版本锚定 ^13.6.30（实测 13.6.32）与 package.json 一致。
5. **检测窗口扩展（window B/C）不越界**：简报 P1 要求「在任何写入前检测当前 doc 是否已经处于活动 transaction」——window B（cleanup/observer 派发窗口）与 window C（形态异常 fail-closed）同属「活动 transaction 语境」的完备化，检测、拒绝、零写入三要素与 window A 同款；fail-closed 方向（检测不到可靠状态即拒）与仓内 loud-fail 文化（CONTEXT.md 方言条目「未知方言 loud-fail 只读」同款精神）同向，属未定义空间的收紧，无条款触碰。

### 裁决二：RD7 形态定稿 throw DOCRT-E202 vs W1 澄清 —— no-conflict，W1 合规

1. **W1 澄清原文**：「P1 guard 在写入前触发，throw 与 `{ok:false}` 均相容（doc 未变，零写入纪律两形态都成立），形态与错误码家族归 SA1」。设计选 throw，属明文授权的 SA1 裁决权行使；§3.5 五点论证（错误类别归属 / E201 家族同构 / 可见性 / 测试占位两态相容 / ADR 一致性）是选择理由，非合规性问题。
2. **零写入承诺兑现**：⓪ 置于函数体第一句、prepare 之前、一切 try/catch 之外——先于 ①②③④ 一切 doc 触碰（含 probeRoot 惰性 getMap）；throw 时 doc 逐字节不变、0 update。SA6 T-1 断言面（0 update / state+vector 字节不变 / ROOT 空置 / observer 未触发）与 ADR-0007「验证或构造失败时目标 doc 零写入」、CONTEXT.md 零写入、ADR-0002 三步管线纪律全部相容。
3. **「不得返回 {ok:true}」兑现**：throw 形态天然满足；与 ADR-0007 mutation 条款「成功只返回 `{ ok:true }`」无涉（被拒调用不在成功出口面——前置门禁同款裁决）。
4. **错误码家族不冲突**：E202（写前语境拒绝）/ E201（写后偏离 fatal）/ E200（①②③ 崩溃边界）/ E100（extract 崩溃边界）语义互斥、编号单调；无 ADR 条款治理错误码。E202 与 E201 同走 throw 通道但写前/写后分立，W1 的两面（写前两形态可选、写后唯一 throw）均被正确映射。

### 裁决三：RD8 出口 1（extract 读回 + schema-parallel 比较 + E201 变体 C/D）—— no-conflict，零 ADR 触碰、W3 合规

1. **零 ADR 触碰属实**：出口 1 全部落件于 doc-runtime 既有文件（⑥ + 比较器 + xml-parse 内部导出），无需修订 ADR-0007 任何条款——与前置门禁裁决二第 2 点「出口 1……零 ADR 触碰」一致；W2' 条件不触发；DENY LIST `docs/adr/**` 与「SA1 无 ADR 写权」自锁。
2. **extractYjsSnapshot 是 ADR 既有入口的正用**（ADR-0007：「只读取固定 ROOT，严格验证实际 Yjs 载体并提取普通逻辑 ROOT」）；⑥ 只读 ROOT 子树、不触碰 SCHEMA/META（与该条款「不读取或验证 SCHEMA/META」及 ADR-0006 三条目布局一致）。
3. **W1 写后形态合规**：变体 C（检测到偏离）与变体 D（校验无法完成）均 throw；变体 D 消息明示「不代表已检测到偏离，仅代表校验防线未能运行」——fatal 声明不谎报原因，与「不虚假声称自动回滚，也不尝试 fallback」同款诚实纪律；「写入已提交，不回滚、不补偿，doc 保持 observer 留下的实际状态」措辞与变体 A/B 及 rev1 W1 论证逐款对齐。
4. **W3 合规**：xml-fragment 比较两侧经 `canonicalXmlOf` 归一化，明文禁止字节直接比较；归一化件复用 xml-parse.ts 共享扫描器（不另造词法——两套扫描器漂移风险由 SA2 评审，非 ADR 面）。span 逐字保留在 canonical 内部基准中是逻辑值保真（XML 叶子的逻辑值即字符串本身，span 是内容而非 yjs 投影 trivia——xml-parse 规则 4 所列投影 trivia 才被归一），公共承诺面未变。
5. **方向只收紧不回退**：⑤ 顶层身份校验保留为前置子集（变体 A/B 不变），⑥ 在其上叠加——前置门禁裁决二第 4 点「方向只有收紧或持平，无条款回退」明文允许。INV-11 的完整语义承诺强于 ADR-0007（ADR 对返回时快照无承诺），属未定义空间的收紧式补全。
6. **union 比较语义与 ADR-0003 一致**：any-of 声明序、首真摘要（对齐 R2-M2）——「不要求两侧命中同一成员」是 any-of 匹配语义（「至少一个成员接受即接受」）在双向比较上的正确投影；判别式缓存不读（「缓存的缺失/存在不得改变任何可观测行为」条款不受触碰——⑥ 根本不读 discriminator）。
7. **既有语义零削弱**：①②③ 失败语义（ok:false + issues / E200）、④ INV-5（observer 异常原样传播，⑥ 在 ④ 正常返回后才运行）、⑤ 契约与测试族全部保留；「成功只返回 `{ ok:true }`」不变（成功出口零新载荷）。

### 裁决四：RD9 lexical-token JSDoc 措辞 vs W2 —— no-conflict，W2 合规

1. **措辞恰为 W2 允许的形态**：§4.4 第 4 条明文三要素——「lexical-token（词法记号）round-trip 的**载体特征**」「**不是**结构化 XML 节点（ADR-0003 终态节点 + 不定义结构映射立场）」「公共承诺面仍为 ADR-0007 语义等价 round-trip，**不承诺字符串逐字相同**」。「逐字」字样仅出现在载体事实描述（raw `Y.XmlText` span）与 canonical 内部基准（§4.3 明文不构成公共承诺），无任何处升格为公共逐字承诺。
2. **与 ADR-0003 立场同向**：明确「不是结构化 XML 节点」= 维持「不定义实参字段与 XML 结构的映射」条款；校验下限「仅要求良构 XML」不动（DENY `packages/vfsl/**`——wellFormedXml 零触碰）。
3. **零行为改动 + characterization 锁定**：现行为（xml-parse 规则 2 已实现逐字 span，SA8 已实证规则原文）即 lexical-token 语义，SA6 混合内容 round-trip 绿测试即 characterization 锚——W2 允许的「载体特征文档化 + characterization 锁定」双件齐备。

### 裁决五：RD10 否决受控 seam vs ADR 纪律 —— no-conflict

1. **简报两选项任选**：Minor-2 原文「可通过受控 seam 或极深树测试补强」——设计选极深树（SA6 已落盘且绿：20_000 层确定性落在 ② 装配溢出 → E200 单 issue + 0 update + state 不变），完全满足简报要求。
2. **ADR-0007 零写入承诺直接兑现**：「零写入承诺覆盖所有验证失败和 detached 构造失败」获得确定性验收锚——比 seam 方案更直接（不引入生产代码测试面）。
3. **前置门禁口径**：SA8 明文「受控 seam 是否引入生产代码测试钩子属 SA2 设计评审面，无 ADR 障碍」——不引入 seam 同样无障碍；设计的显式裁决（不引入）在许可空间内。
4. **引用准确性小注（O3）**：设计以 ADR-0007「未来原始 Yjs update 必须另设受控验证通道」佐证「受控面最小化纪律」——该条款治理的是原始 update 通道而非测试 seam，属类比引用；但否决结论独立成立于「确定性已达成」之上，不依赖该引用，不影响裁决。

### 裁决六：§3.3 推翻 rev1 SA2「不采用 `_transaction` guard」定谳的路径 —— no-conflict，路径合规

1. **被推翻对象不是 ADR**：rev1 SA2 #1 原文是「**不建议**采用读 `doc._transaction` 的运行时 guard（私有 API 耦合，风险大于收益）；文档化前提 + 边界测试即 W1 相容的诚实形态」——评审建议（wiki 档案），非 ADR 条款。按 SA8 边界纪律，wiki 档案不构成冲突基准；推翻它不进入四级裁决（无 ADR 决策被修订——设计 §3.3 第 4 点自证且属实）。
2. **权威升级正当**：rev1 定谳是 SA2 在「owner 未表态」前提下的权衡；rev2 owner Review 明文「优先运行时响亮拒绝……不能只依赖 JSDoc」，且该要求已经 SA8 前置门禁裁为 no-conflict（P1 即简报要求本身）。owner 反馈对 SA2 评审权衡构成权威升级——设计据此推翻，是执行 owner 已裁决的需求，非自行改判。
3. **预登记更新路径被遵守**：rev1 T-1 characterization 自带漂移条款「若未来实现改为 loud-guard 或检测到该场景，本用例须随设计同步更新——边界变化必须走设计评审」（SA8 已在 rev1 SA2 报告验证表中实证该条款在文）。SA6 已按简报把 T-1 整块替换为拒绝测试；本轮变更正走完整设计评审链（SA8 前置门禁 → SA1 设计 → 本设计后复审 → SA2）——恰是该条款的兑现，非静默漂移。
4. **风险再定价有新证据**：rev1 定谳时「风险大于收益」的收益侧此后被 owner 显式定价（契约健壮性），风险侧有新缓解（类型化访问实证 PA-4 / fail-closed 窗口 C / 版本锚定 / 测试锁定）——权衡要素变化下的重裁，程序与依据均立得住；最终风险接受度仍归 SA2 评审确认（SA8 不预裁耦合风险本身）。

## 补充核对明细（六项之外的设计面，全部 no-conflict）

| # | 设计面 | ADR/红线依据 | 裁决 | 依据 |
|---|---|---|---|---|
| 1 | ⓪ 仅治理 materializeRoot（写路径）；extract/readLogicalValueAtPath 不加 guard | ADR-0007 两入口条款（只读入口无事务语境约束） | no-conflict | guard 是写路径前置条件检查；读入口在 observer 内调用是合法用法，不加 guard 不违反任何条款（scope 收敛不越简报） |
| 2 | ⓪ 语境违规 > 数据域失败的 precedence 定谳 | （无 ADR 条款治理检测顺序） | no-conflict | 纯设计裁量；SA6 P1 用例快照合法，两序在该用例无分歧 |
| 3 | subdoc 场景排除（只判传入 doc 自身事务状态） | （无 ADR 条款治理 subdoc） | no-conflict | 未定义空间；范围声明诚实 |
| 4 | ⑥ 自带收敛 try/catch（extract/比较异常 → E201-D），不改 INV-5 | ADR-0007 失败边界（observer 抛错 fatal 原样传播） | no-conflict | ⑥ 在 ④ 正常返回后运行，④ 的 observer 异常传播路径（F10）不受触碰；收敛方向仍是 loud throw |
| 5 | INV-10 时点前提升格（JSDoc 契约 → 运行时 guard 兑现；成立域从「诚实调用方」扩为「全部调用方」） | 前置门禁重点裁决一第 2 点（guard 强化「一次 Y.transact 安装」前提） | no-conflict | 条款语义保留、成立域扩大——收紧方向 |
| 6 | ⑤ 变体 A/B、E200、①②③ 失败语义、返回类型零变更；§10 caller 审计（仓内零生产 caller，grep 实证） | ADR-0007 既有条款面 | no-conflict | 「只增不改既有语义」；新 throw 路径零涟漪 |
| 7 | RD11 版本 bump 0.1.4→0.1.5（patch）+ index.ts 注释同步（导出面零变更） | （无 ADR 条款治理包版本） | no-conflict | 纯工程；「唯一公共物化入口」与公共导出面不动 |
| 8 | ALLOW 5 文件 / DENY（vfsl、persistence、codegen/protocol、adr、workflows、extract/read/carrier/resolve） | ADR-0007 依赖面（vfsl 无 Yjs 依赖、持久层不理解 VFSL）；ADR-0006 持久层边界；W2' | no-conflict | 修订面收敛于 doc-runtime 单包；依赖方向全部保持 |
| 9 | §9 协议假设 PA-1~PA-7（yjs 事务窗口/类型面/extract 不外抛/canonical 对齐/④ 闸门） | （事实证据，非 ADR 面） | no-conflict | SA8 抽验 PA-4/PA-5/PA-6 关键锚属实（Doc.d.ts、extract.ts INV-6、xml-parse 规则 4）；其余供 SA4/SA7 复跑 |

## 观察项（非冲突、不阻塞；登记供后续链路处置）

- **O1（前瞻交互，登记给未来 create 流程设计者）**：rev1 R-7 曾预警「未来 create 流程（ADR-0006 三条目 SCHEMA+META+ROOT 单 update 单元）若把 materializeRoot 包进一个外层事务即落入本边界」；rev2 设计未提及该交互。E202 guard 落地后，该形态将从「静默假成功」变为「响亮 E202 拒绝」——**方向安全**（fail-closed，强制未来设计者正面处理），且无当前 ADR 条款要求 create 流程必须单事务写三条目（ADR-0006「单 update 单元」是描述 Y.transact 机制对 store 的后果，非 create 流程原子性强制；ADR-0007 Runtime 编排亦未要求包裹调用）。但未来 create 流程设计时必须知道：不能把 materializeRoot 包进外层事务，三条目原子安装需要另行设计（或分事务、或另设受控通道——ADR-0007「未来原始 Yjs update 必须另设受控验证通道」预留了后者的治理面）。已同步登记进相关决议文档。
- **O2（移交 SA2）**：§3.1 窗口 B 表格谓词（`tx === null && cleanups > 0`）与 §3.4 伪代码（B 检查在 `tx === undefined && cleanups 非空` 时也先命中，报 B 而非 C）存在细微出入——两形态均为 E202 throw + 零写入，ADR 面零影响；一致性收敛归 SA2/SA3。
- **O3（引用准确性，已并入裁决五第 4 点）**：RD10 对 ADR-0007「受控验证通道」条款的类比引用不构成结论依据；结论独立成立。

## 结论

**verdict = clear，设计放行进入 SA2 全维度攻击评审。**

- 冲突点数：**0**；裁决分布：no-conflict × 15（六项重点裁决 + 补充明细 #1–#9）、override-declared × 0、evolution × 0、hard-violation × 0。
- 六项交办关注点全部裁 **no-conflict**：(1) 机制 (a) 天然满足 W4（条件不触发 + 无条件部分主动满足，零新依赖、零公共面新增）；(2) throw E202 在 W1 澄清的明文授权空间内（写前两形态可选、形态归 SA1）；(3) 出口 1 零 ADR 触碰属实、W2' 不触发、W3 经 canonical 归一化合规落地；(4) RD9 措辞恰为 W2 允许的「载体特征 + characterization」形态；(5) 否决 seam 在简报两选项与前置门禁许可空间内；(6) 推翻 rev1 SA2 定谳走的是 owner 权威升级 + 预登记更新路径 + 完整评审链，被推翻对象是 wiki 评审建议而非 ADR，程序合规。
- 私有字段耦合风险、比较器假阳性（R-2）、递归深栈（R-3）等按前置门禁预留归 SA2/SA4/SA7 评审验证，SA8 不越界预裁。
- 相关决议文档已追加「设计引入的新决策点（rev2）」节供全链复用；观察项 O1 已同步登记。

---
---

# R2 复审节（SA8 设计后复审第 2 轮——SA2 R1 reject 后的设计修订复审）

- 被审对象：`task_doc-runtime-materialize-root-rev2_design.md`（R2 修订版，843 行，原地更新；R2 修订点标注 + 文末 SA2 #1–#10 回应表）
- 复审方法：**diff 聚焦**——只裁 R2 修订面 vs ADR 决策集 + W 红线的一致性；R1 轮已裁且 R2 宣称零改动的面（RD7 架构/三窗口/throw 形态/E202 家族/RD9/RD10/RD11）按「宣称收敛核对」处理，不重复全量论证
- R2 修订面宣称收敛于：⑥ 比较器语义（投影 any-of）、§7.1 B/C 测试锚定规格、§3.1/§3.4 文本收敛、INV-11 投影等价定稿
- SA8 独立事实核验（本轮新增，非转抄）：① F7/D4 仲裁不对称在源码实证——`materialize.ts:253`（F7「快照含结构树未声明字段……拒绝静默丢键」）vs `extract.ts:7`（D4「缺失字段与未知键不报不进快照」）+ `extract.ts:185/214` trialMember 按声明字段走查——PA-8 属实，SA2 E4 发现的假阳性根因成立；② **独立复跑 §9.3 仿真脚本**（`.mabf/sa1/r2-union-probe.ts`）：C1 仲裁不对称复现（`extract={"a":"x"} input={"a":"x","k":"y"}`）、C1–C4 修订比较器 equal ×4、RT-1.4 嵌套负对照 diff——与设计 §9.3 内联输出逐行一致；脚本尾部 RT-1.4b 探针在现实现抛 ⑤ E201-B（未捕获致进程非零退出）——设计 §9.3 括注已如实披露该行为（顶层覆写属 ⑤ 身份面），证据结论不受影响（登记 O5）

## R2 Verdict

`clear`

## R2 修订面收敛核对（宣称 vs 实际）

| 宣称零改动面 | 核对结论 |
|---|---|
| RD7 guard 架构 / 机制 (a) / 触发点 | ✅ 零改动（§3.2 六维对照原样；伪代码结构不变） |
| 三窗口判定域 | ✅ 语义零改动——A 行谓词补 `!== undefined`（truthy 收敛）、B 行改事件枚举 + afterAllTransactions 例外、C 行改 fall-through，三者均为**向 R1 伪代码（唯一实现锚）收敛的文本统一**，非判定域变更：afterAllTransactions 时队列已重置 `[]`，B 谓词本就不命中（例外的登记+测试化，非谓词修改）；truthy 垃圾→A / undefined+非空队列→B 在 R1 伪代码中已是既定行为 |
| throw 形态 / E202 家族 | ✅ 三变体、throw、写前语义不变；R2/#5/#8 仅消息措辞（B 变体补 wedge 诊断分支、「doc 零写入」→「本函数零写入」——后者在窗口 A 语境下更精确：外层事务的挂起写入非本函数所为，「doc 状态不因本调用改变」逐字为真，简报零写入要求按调用粒度满足，RT-2/RT-3 的 stateBytes 断言锚定） |
| RD8 出口 1 方向 / RD9 / RD10 / RD11 | ✅ 零改动（出口 2 否决理由原样；RD9 措辞原样；RD10/RD11 原样） |

修订实际落点：⑥ 比较器（§4.2 三值 cmp + 逐 kind 谓词表 + §4.2.1 推演）、INV-11 投影等价、§4.4 契约措辞、§7.1 测试规格（RT-1~RT-6）、§3.1/§3.4 文本收敛、R-7/PA-8/PA-9/PA-10 登记——与宣称一致，无越界修订面。

## R2 重点裁决

### 裁决一：投影比较器 + INV-11 投影等价（R2/#1/#9，CRITICAL 修订）—— no-conflict，且较 R1 **更**贴合 ADR-0003

1. **R1 基准与 ADR-0003 实际相抵触，R2 修正之。** F7/D4 仲裁不对称（SA8 已源码实证）使 R1「原始输入 vs extract 读回」的键集相等比较，在**重叠联合**（ADR-0003 明文「至少一个成员接受即接受——**重叠成员不构成错误**」）的诚实路径上必然假阳性——等于对 ADR-0003 宣告合法的 schema 形态整体拒绝 create。R2 把比较基准改为按成员投影（封闭 map 只比声明字段——extract trialMember 走查的镜像；Record 全键；union any-of），消除假阳性。**方向上 R2 是向 ADR-0003 对齐，R1 才是需要修正的偏离。**
2. **any-of 判据与 ADR-0003 同构。** 等价判据 = ∃可走查成员 M（声明序）：project(M, 输入) ≡ project(M, P)——这是 any-of 匹配语义（「至少一个成员接受即接受」）在等价比较上的对偶；'diff' 记首诊断后继续下一成员，遍历毕无 'equal' 才 E201-C。设计的一般化论证成立：被 any-of 接受 ⟺ 读回 == 输入的某合法成员投影 ⟺ 无可观测偏离（投影内真偏离必破坏一切成员的等价而捕获——RT-1.4 负对照 SA8 复跑实证 diff）。比 SA2 方案 a（单成员定夺）假阳性面严格更小，与 ADR-0003 条款字面更贴。
3. **INV-11 投影等价定稿仍零 ADR 触碰。** ADR-0007 对 materializeRoot 返回时快照**无任何承诺**（前置门禁已裁定的未定义空间）——R2 的 INV-11 相对 ADR 基线仍是纯收紧（⑤ 顶层身份校验保留 + ⑥ 投影覆盖全部声明字段递归）。R1 版「完整逻辑快照语义等价」是被 E4 证伪的**不可实现表述**（对重叠联合诚实路径假阳性），R2 收窄为投影等价是修正不健全表述，不是跌破任何 ADR 或 W 红线基线；且与简报 Medium 出口 1 的示例载体（「如 extract/fingerprint」）忠实一致——简报点名的校验工具就是 extract，extract 的既定语义即投影语义（D4）。检测面边界（D4 未声明键/未选中成员独有键不在检测面）在 §4.4 JSDoc 明文 +「投影外修改由 ADR-0007 observer 纪律治理」——未定义空间的诚实文档化，W2' 不触发（DENY `docs/adr/**` 保留，SA1 无 ADR 写权）。
4. **W1/W3 保持满足。** 变体 C（投影偏离）/D（校验未能运行，R2/#7 补第三触发类：canonical 扫描失败）均 throw——写后唯一相容形态不变；RT-5 锁「不可扫描也绝不 ok:true」（loud 方向强化）。XML 比较仍经 canonicalXmlOf 归一化、禁字节比较明文（W3）；扫描失败归 D 不谎报偏离也不静默跳成员——比 R1 的处理更完备。
5. **owner Medium 洞仍然关闭。** Medium ×3 攻击（声明内容的嵌套就地修改）与 RT-1.4 负对照在投影基准下全部捕获（SA8 复跑实证）；不可检测面 = extract 自身不可见面（D4），以包自己的 logical snapshot 定义为界——任何以 extract 为锚的出口 1 实现都有同一边界，这是 exit-1 路线的固有属性而非 R2 引入的弱化。

### 裁决二：窗口语义收敛 + afterAllTransactions 例外（R2/#3/#4）—— no-conflict

1. 窗口 C fall-through 收敛解决了 R1 复审观察项 **O2**（§3.1 表格与 §3.4 伪代码的谓词出入）——采纳伪代码为唯一规范锚，删「Transaction 形态嗅探」表述；两个残余形态（truthy 垃圾→A、undefined+非空队列→B）定性明示且消息事实性宣称为真。文本收敛，无判定域变更。
2. afterAllTransactions 例外是**登记既有谓词行为**（Transaction.js 先重置 `[]` 再 emit——谓词本就不命中）+ 测试化（RT-2 对照组 ok:true，防 SA3 误拒），非放宽：该窗口新开 transact 自含完整生命周期（SA2 E2b 实证），⑤⑥ 检测面有效——放行与 guard 的立法目的（消灭假成功语境）一致，无 ADR 条款禁止在该回调内调用。
3. RT-3 三形态（`delete _transaction` / `cleanups={}` / truthy 垃圾）全部断言 stateBytes 不变——零写入锚补齐。

### 裁决三：wedge 登记 + E202-B 诊断分支（R2/#5，R-7/PA-10）—— no-conflict，与 ADR-0007 observer 纪律同向

监听者在 cleanup 派发期抛异常 → 队列永久卡死 → 之后一切顶层调用永吃 E202-B。处置为 fail-closed（拒绝写入 = 安全侧：派发机制已死、update 永不发 = 持久化黑洞）+ 消息诊断分支。ADR 角度：该场景正是 ADR-0007 失败边界「事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback」的邻接形态（抛错点在 cleanup 派发而非事务体内）——loud 拒绝、不虚假承诺，同款纪律方向；无任何条款要求恢复或放行 wedge doc。设计自登记与 ADR-0006 持久层 update 监听者的前瞻交互（见 O4）。

## W 红线 R2 增量复核

| 红线 | R2 增量 | 结论 |
|---|---|---|
| W1 | 变体 C/D 仍 throw（投影语义只改判据不改形态）；E202 仍写前 throw；RT-2/RT-3/RT-5 补齐零写入与「绝不假成功」测试锚 | ✅ 满足且锚定增强 |
| W2' | INV-11 投影边界落 JSDoc（§4.4 第 3 条）；DENY `docs/adr/**` 保留；无 ADR 文本触碰 | ✅ 不触发 |
| W2 | RD9 措辞原样（载体特征 + 不升格逐字承诺）；canonical span 逐字仍为内部基准（§4.3 声明原样） | ✅ 满足 |
| W3 | canonical 归一化基准不变、禁字节比较明文保留；R2/#7 扫描失败归 D（不静默、不谎报）——强化 | ✅ 满足 |
| W4 | RD7 机制零改动；extract.ts 仍在 DENY（「不动 extract——PA-8 的仲裁不对称是 extract 既定公共语义，按投影基准在 ⑥ 侧适配」）；无新依赖、无公共面变更 | ✅ 满足 |

## SA2 #1–#10 回应逐条 ADR 对照（全部 no-conflict）

| # | R2 回应摘要 | ADR/红线对照 | 裁决 |
|---|---|---|---|
| #1 CRITICAL | 比较基准改按成员投影 + any-of 精化 + §4.2.1 推演 + §9.3 仿真 | ADR-0003 any-of/重叠合法条款（R1 基准与之相抵触，R2 修正）；ADR-0007 extract 入口语义为锚；W1/W3 | no-conflict（详见 R2 裁决一） |
| #2 HIGH | RT-1/RT-2/RT-3 规格落 §7.1 + §7 表 + RT-6 收紧正则 | 测试面（SA6 owned，文件在 ALLOW LIST）；零写入断言锚 | no-conflict |
| #3 MEDIUM | 窗口 C 收敛 fall-through 单一口径 | 文本收敛（R1 复审 O2 兑现）；无判定域变更 | no-conflict |
| #4 MEDIUM | afterAllTransactions 例外登记 + 安全论证 + RT-2 对照组 | 无 ADR 条款面；guard 立法目的一致性论证成立 | no-conflict |
| #5 MEDIUM-LOW | E202-B 诊断分支 + R-7 + PA-10 + RT-4 | ADR-0007 observer fatal 纪律同向（邻接形态） | no-conflict |
| #6 MEDIUM-LOW | 逐 kind 可走查谓词表（trialMember 镜像） | 与 extract 语义镜像的一致性主张经 SA8 源码核验成立 | no-conflict |
| #7 LOW | 变体 D 第三触发类 + RT-5 | W3 强化（不可扫描绝不假成功） | no-conflict |
| #8 LOW | 「本函数零写入」措辞 + (b)(c) 登记 | 措辞更精确（窗口 A 语境下逐字为真）；简报零写入按调用粒度满足 | no-conflict |
| #9 LOW | INV-11 投影等价定稿 + 检测面边界明文 | 未定义空间诚实文档化（JSDoc 路线）；W2' 不触发 | no-conflict |
| #10 NIT | R-1 措辞如实化 + 耦合综述收口 | 登记级；无 ADR 面 | no-conflict |

## R2 观察项（非阻塞）

- **O2（R1 登记）——已解决**：窗口 B/C 表格与伪代码出入经 R2/#3 收敛为单一规范锚。
- **O1（R1 登记）——仍然有效**：未来 create 流程不能把 materializeRoot 包进外层事务（E202 拒绝）；前瞻登记不受 R2 影响。
- **O4（R2 新增，前瞻）**：R-7 wedge 与 ADR-0006 持久层的交互——持久层「看得见 update 事件」（ADR-0006），未来若 persistence 适配器的 update 监听者在 cleanup 派发期抛异常且未自捕获，将 wedge 该 doc 使后续 materializeRoot 永吃 E202-B。fail-closed 方向安全（持久化黑洞拒绝写入），设计已登记 R-7；Runtime/persistence 集成设计时须知悉并保证监听者自捕获（与 ADR-0007「Runtime 自有 observer 必须记录或异步上报」义务同源）。已同步相关决议文档。
- **O5（R2 新增，证据卫生 nit，移交 SA4/SA7）**：§9.3 脚本尾部 RT-1.4b 探针在现实现抛 ⑤ E201-B 未捕获、进程非零退出——设计括注已披露该行为且结论不受影响；SA4/SA7 复跑该脚本时应预期非零退出码（或建议 SA1 给该探针补 try/catch 收口，纯 scratch 卫生项）。

## R2 结论

**verdict = clear，R2 修订版设计放行（SA2 放行条件已满足：#1–#10 全部落实，修订面未越宣称范围）。**

- R2 冲突点数：**0**；裁决分布：no-conflict × 10（#1–#10 回应逐条）+ 3 项重点裁决展开；hard-violation / evolution / override-declared 均 0。
- 三项交办重点全部通过：**投影语义 + INV-11 定稿仍零 ADR 触碰**（未定义空间的诚实文档化，JSDoc 路线，W2' 不触发）；**W1/W2'/W2/W3/W4 全部仍满足**（多数经 R2 锚定增强）；**any-of 判据与 ADR-0003 一致**（且 R2 修正了 R1 与「重叠成员不构成错误」条款的事实性抵触——F7/D4 不对称经 SA8 源码实证、§9.3 仿真经 SA8 独立复跑逐行一致）。
- 全链放行条件：SA6 按 §7.1 落地 RT-1/RT-2/RT-3（±RT-4/RT-5）+ RT-6；SA3 实现按 §3.4 伪代码（唯一规范锚）；SA4/SA7 复跑含 §9.1–§9.3（注意 O5）。

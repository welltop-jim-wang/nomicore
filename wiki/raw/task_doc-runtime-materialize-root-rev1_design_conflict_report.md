# 冲突门禁报告（设计后复审 — rev1 SA1 设计 vs ADR 决策一致性）

- 被审对象：`wiki/raw/task_doc-runtime-materialize-root-rev1_design.md`（SA1 设计，744 行，PR #84 owner Review 修订轮 rev1，issue #74 / materializeRoot）
- 冲突基准：`docs/adr/0001`–`0007` 全集（7 份，逐个全读，无抽样）+ `CONTEXT.md` + `wiki/raw/task_doc-runtime-materialize-root-rev1_relevant_decisions.md`
- 门禁：SA8（修订轮第二阶段设计后复审；前置门禁 verdict=clear、红线 W1–W3 已随报告转达，见 `task_doc-runtime-materialize-root-rev1_conflict_report.md`）
- 复审范围：设计决策 RD1–RD6 与 ADR 决策集一致性，**重点复核红线 W1（RD1 出口 A 仅 throw 形态、零 ADR 修订是否成立）/ W2（XML 语义等价断言）/ W3（RAC-4 语义归一化比较）的落实情况**；设计优劣归 SA2，实现质量归 SA4/SA7，不在本报告评判

## Verdict

`clear`

## 红线复核（本轮核心复核项，逐条对照 ADR 原文）

### W1 — RD1 出口 A 仅 throw 形态、零 ADR 修订：**✅ 落实（no-conflict）**

W1 原文（前置门禁）：「若 SA1 选『检测偏离响亮失败』，唯一与 ADR-0007 相容的形态是 throw（类比 internal/fatal、异常原样离开函数）；**事务提交后返回 ok:false / 结构化失败、补偿修复写入、声称已回滚**三种形态分别落入……违反面——届时将升级为 hard-violation。」

**设计落位核对**（§2.2 伪代码 / §8 F11 / §2.4 JSDoc / §13 契约审计四处同口径）：

| W1 禁止形态 | 设计行为（原文锚） | 核对 |
|---|---|---|
| 事务提交后返回 ok:false / 结构化失败 | ⑤ 偏离 ⇒ `throw new Error('DOCRT-E201: …')`（§2.2）；`{ok:false}` 返回路径仅存在于事务前的 `ready.kind === 'fail'`（①②③ 阶段，INV-3/INV-4 不变）；F11 行明文「**不返回——throw**」（§8） | ✅ 无违反 |
| 补偿修复写入 | ⑤ 只读、无副作用、不在任何 try/catch 内（§2.2 注释）；message 明示「写入已提交，不回滚、不补偿」 | ✅ 无违反 |
| 声称已回滚 | message 明示「doc 保持 observer 留下的实际状态」；R1 测试断言最终 ROOT 保留 observer 的修改（delete → title undefined / overwrite → 'HACKED'，§10）——「值未回滚」的测试化 | ✅ 无违反 |
| 异常原样离开函数 | `DOCRT-E201` 直接 throw，不包装、不捕获、不改写（§2.2）；U13 收紧的 `toThrow('observer-boom')` 同时守卫「⑤ 未把 observer 错误改写成 E201」（§6） | ✅ 无违反 |
| 「防止」类机制（W1 归 SA2 评审面） | 显式不采用（yjs 无 observer 抑制/延迟 API，§2.1 第 6 维），未以无机制支撑的承诺入契约 | ✅ 未越界 |

**ADR 条款逐项对照**（throw-after-commit 形态的合法性）：

1. ADR-0007 `materializeRoot` 条款「验证或构造失败时目标 doc 零写入；不覆盖、不合并、不 fallback」——E201 偏离**既非验证失败亦非构造失败**（零写入承诺域不触发）；设计不返回 ok:false（不伪造零写入）、不补偿写（不触「不覆盖、不 fallback」）。①~④ 编排逐句原序保留，⑤ 是安装后的只读内部检查，不改写条款描述的流程。
2. ADR-0007 失败边界「事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback」——F10（observer 抛错）零改动原样传播（§2.3 R-2：observer 抛错时 ⑤ 不运行，错误优先级 observer 原始错误 > 完整性报告）；F11 与 F10 同族（fatal throw、不虚假回滚、不 fallback），正是前置门禁裁决一第 3 点明文授权的「对未定义空间的**延伸**，不修订既有条款」。引文核对：设计 §1.2/§2.4 对裁决一第 2/3 点的引用与前置门禁报告原文逐句一致，无改写。
3. ADR-0007「成功只返回 `{ ok:true }`，不返回 snapshot、Yjs update 或内部类型」——不变：E201 偏离时**不返回**（throw）；返回时仍只 `{ok:true}`（§13 契约审计：返回类型联合不变，仅新增一条 throw 路径）。
4. ADR-0002「结构 → 值 → 单事务提交」三步纪律 + authority 完全出范围——⑤ 是完整性**检测**（只报告不修复），非 authority 式运行时不变式执行器（设计 §1.2 第 3 点自限），无 `__authority__` 规则形态（enum/range/conditional/state-machine）复活。
5. CONTEXT.md「零写入（zero-write）：校验失败 → 400 且文档不变」——E201 非「校验失败」，且设计明文不声称文档不变（doc 保持 observer 留下的实际状态），无虚假零写入声明。

**「零 ADR 修订」是否成立：成立。** 四点依据：

1. owner 反馈 #1 的文档化要求是**条件式**：「如果 observer 修改属于允许的事务后续反应，则 ADR/API 必须明确 ok:true 仅表示……」——「ADR/API 必须明确」仅挂在出口 B 分支；出口 A 分支的要求是「防止或检测……并在偏离时响亮失败」。设计选检测 + 响亮失败，条件不触发。设计 §2.4 理由 1 的解读与 owner 原文语法结构一致。
2. 出口 A throw 形态是 ADR-0007 fatal 家族在未定义空间的延伸（前置门禁裁决一第 3 点原文授权），与既有冻结条款零触碰（上列 1–5 项逐款核对通过）。
3. INV-10 是对 `ok:true` 语义的**增强补充**（ADR 未定义面），未收窄或改写任何冻结条款的承诺面；W1 恰是「允许哪种增强形态」的门线，设计落在门线内。
4. DENY LIST 明文 `docs/adr/**` 零改动；契约载体为 JSDoc（§2.4）。「防止」类机制未被承诺、未被采用。带日期修订节惯例保留给出口 B 的假设情形——本轮不适用。

### W2 — XML 断言不得收紧为字符串逐字相同：**✅ 落实（no-conflict）**

W2 原文：「XML 断言不得收紧为字符串逐字相同（ADR-0007 只承诺语义等价 round-trip）；失败场景保持单 issue + 零 update + state 不变。」

- **成功行（X-1~X-17）**：断言模板为 `expectXmlSemanticallyEqual(extract 输出, input)`（§4.3）——测试侧 mini 扫描器解析两侧 → canonical 序列化（属性按名排序 / 一律双引号 / self-closing 统一显式闭合 / 重复属性 last-wins）→ canonical 串比较（§4.4）。已覆盖全部实测投影差异（X-2 引号重排 / X-4 字母序 / X-12 闭合展开 / X-14 last-wins），**不锁 yjs 序列化器投影形态**；设计明文禁止 `expect(out).toBe(input)` 式投影冻结。与 ADR-0007「只承诺语义等价 round-trip，不承诺字符串逐字相同」同向——恰为该条款的测试化。✅
- **构造失败行（X-F9 / C-8）**：preValidate ok:true → ok:false + **恰 1 issue**（F8）+ 0 update + state 字节不变——与 ADR-0007「零写入承诺覆盖所有验证失败和 detached 构造失败」+「Yjs 结构与路径/操作错误 fail-fast」逐款对齐。✅
- **逻辑失败行（X-F1~X-F8）**：断言 `result.issues` `toEqual(direct.issues)`（引用零损透传）+ 0 update + state 不变，不硬锁条数——依据 ADR-0007「**逻辑校验保留完整 issues**，Yjs 结构与路径/操作错误 fail-fast」：逻辑失败域是全收集语义，硬锁「恰 1」反而会把全收集误锁成 fail-fast。单违规 fixture 的 `direct.issues` 实测即 1 条，断言经透传等价传递锁定，实质满足 W2 的「单 issue」（形态注记见观察项 O3，非冲突）。✅

### W3 — RAC-4 XML 叶子必须经语义归一化比较：**✅ 落实（no-conflict）**

W3 原文：「『完整语义比较』对 XML 叶子必须经语义归一化比较（初轮 U12 锚同款），不得退化为字节相等。」

- §5.1 用例 A：三个 union variant 中唯一 XML 载体 `assets.doc1.body` 经 `expectXmlSemanticallyEqual(…, '<p>Hello <b>world</b></p>')`（表内显式标注 **W3**）；其余域（Record 键集 / audit / tags / attachments / keywords / leaf 标量）extract 产物为纯 JSON，`toEqual` 值比较即语义比较，无 XML 叶子混入。✅
- §5.1 用例 B：`body` XML 域经 §4.3 同款语义比较器；非 XML 域（含 `u` 嵌套深结构）toEqual 原值。✅
- 全设计无任何「XML 叶子用字节/字符串相等断言」的落位（§5 两用例 + §10 R4 断言模板逐一核对）；比较器与 §4.4 同源（初轮 U12 锚同款归一化：canonical 解析 + 属性排序无关 + 引号归一 + last-wins）。✅

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19 目标态/阶段态、2026-08-21 `SCHEMA` 命名修订节） | 中 | 一致：rev1 设计改动面收敛于 4 文件（materialize.ts / 测试 / ci.yml / doc-runtime package.json），`SCHEMA` 信封与命名契约零触碰；无 schema 文本/codegen 引入 |
| ADR 0002 | nomicore 是全新 yjs-server 重写，authority 完全出范围 | accepted | 中 | 一致：⑤ 是完整性检测不是修复器（只报告不修复，§1.2 第 3 点自限），无 authority 规则形态复活；「结构 → 值 → 单事务提交」三步纪律原序保留（①~④ 不变） |
| ADR 0003 | 求值器与派生 schema | accepted | 高 | 一致：RD3 attr-`"` 定谳取前置门禁裁决二方向一（锁定有意约束 + 测试锁定），「运行时校验仅要求良构 XML」校验下限未被升降（vfsl 侧 DENY 零改动，校验域 ⊋ 构造域不违反条款）；ROOT=Y.Map / 终态节点 / 联合 any-of 零触碰 |
| ADR 0004 | vfsl-protocol 类型协议包 | accepted | 低 | 无涉：编译期类型投影轨道，rev1 零触碰（维持初轮复审口径） |
| ADR 0005 | 投影生成管线 | accepted | 无 | 无涉：RD6 是 vitest 存在性门禁，与本 ADR 的投影 regen-diff CI 属不同 job，无交集 |
| ADR 0006 | Cordis 持久化插件与 doc 三条目内容布局 | accepted（含 2026-08-21 createDoc/owner、2026-08-22 getStatus 修订节） | 中 | 一致：RAC-2/RAC-3 的「state 字节不变」断言面覆盖整个 Y.Doc（SCHEMA/META 兄弟条目一并不动）；「事务原子性由 Y.transact（单 update 单元）保证」原样落实（INV-2 澄清 R-5「恰 1 指本函数发起的事务」与该条款相容——observer 重入写开启的是自己的事务单元）；持久层零触碰 |
| ADR 0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted | **直接** | 一致（W1/W2/W3 三红线全部落实，见上节）：RD1 以唯一相容的 throw 形态补全 `ok:true` 未定义语义；RD2/RD4/RD5 是「零写入承诺」「extractYjsSnapshot 入口」「observer 抛错 fatal 不虚假回滚」条款的直接验收强化；ADR 引文（materializeRoot 条款 / 失败边界 / 语义等价 round-trip / Runtime 编排边界）逐句核对无失真 |

无任何 ADR 处于 superseded 状态；ADR 0001/0006 的修订节均为 owner 裁决放行的内部演进，已按修订后文本对照（与两份前置门禁报告同口径）。设计对初轮设计后复审 #8/#9 行与 O3 的引用经核对属实（attr-`"` 构造拒绝同题前裁 no-conflict）。

## 冲突点

无（**0 条 hard-violation / 0 条 evolution / 0 条 override-declared**）。设计未声明推翻任何 ADR（DENY LIST 明文 `docs/adr/**` 零改动），未试图实质修订任何既有决策；RD1 是前置门禁已授权的 ADR-0007 未定义空间契约补全（W1 形态约束内），RD2–RD6 是既定条款的验收强化与纯工程门禁。

逐条对照明细（全部判 no-conflict，供复核；引文均为原文摘录）：

| # | 设计条款 | ADR 依据（原文） | 裁决 | 依据 |
|---|---|---|---|---|
| 1 | RD1/⑤/INV-10/F11：事务正常返回后、`return {ok:true}` 前做顶层完整性校验（size + 逐键 `===` 双断言），偏离 ⇒ throw `DOCRT-E201`，不回滚、不补偿、不返回 ok:false | ADR-0007：「事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback」；「验证或构造失败时目标 doc 零写入；不覆盖、不合并、不 fallback」 | no-conflict | W1 唯一相容形态（throw）严格执行，三禁全避（见红线复核 W1 表）；E201 偏离不在零写入承诺域（非验证/构造失败），不伪称文档不变；①~④ 编排与条款句序逐句不变 |
| 2 | RD1「零 ADR 修订」：契约载体仅 JSDoc（§2.4），`docs/adr/**` DENY | （owner 反馈 #1 条件式文档化要求仅挂出口 B 分支；前置门禁裁决一第 3 点：fatal 类比延伸属未定义空间延伸，「不修订既有条款」） | no-conflict | 出口 A 分支要求仅「防止或检测 + 响亮失败」，无 ADR/API 文档化前置；throw 形态与全部冻结条款零触碰（红线复核 W1 五项对照全过）；「零 ADR 修订」成立 |
| 3 | RD1 残余面登记（§2.3 R-1 嵌套就地修改 / R-2 observer 抛错 ⑤ 不运行 / R-3 异步修改，契约时点=「materializeRoot 返回时」） | ADR-0007：「Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报」；Runtime 编排边界「业务调用方不得取得可写 Yjs 引用或绕过该入口」 | no-conflict | 残余面治理归属与 ADR 条款指定的层一致（observer 纪律 + Runtime 编排），检测面边界在 JSDoc 明文登记，无夸大承诺（见观察项 O1，非冲突） |
| 4 | RD2 构造失败零写入矩阵（C-1~C-8：先证 `validateLogicalSnapshot ok:true`，再证 ok:false + 恰 1 issue + 0 update + state 字节不变） | ADR-0007：「零写入承诺覆盖所有验证失败和 **detached 构造失败**」「`validateLogicalSnapshot`……只接受普通 JSON logical ROOT snapshot」；ADR-0006：「事务原子性由 Y.transact（单 update 单元）保证」 | no-conflict | 「逻辑宽域通过 + 构造期响亮拒绝」落在 ADR 明文预期的 detached 构造失败面（初轮复审 #9 同题前裁）；零写入双证（update 事件 + state 字节）是零写入承诺的直接验收强化 |
| 5 | RD3 定谳：attr 值含 `"` 是有意的 materialization 约束（维持现状 + 双锚测试锁定 C-8/X-F9）；接受域差异恰一处（DOCTYPE 两侧同拒） | ADR-0003：「运行时校验仅要求良构 XML」；ADR-0007：「XML string 与 Y.XmlFragment 只承诺语义等价 round-trip，不承诺字符串逐字相同」 | no-conflict | 前置门禁裁决二方向一：校验下限条款不冻结构造接受域，校验域 ⊋ 构造域不违反任何条款；构造拒绝出口（恰 1 issue + 零写入）为 ADR 预期失败类；vfsl 校验侧 DENY 零改动 |
| 6 | RD3/W2 语义比较器：成功行 canonical 解析比较（属性排序无关 + 引号归一 + last-wins + 显式闭合归一），禁投影冻结断言 | ADR-0007：「XML string 与 Y.XmlFragment 只承诺语义等价 round-trip，不承诺字符串逐字相同」 | no-conflict | 断言面与承诺面同宽（语义等价），未收紧为逐字；比较器吸收全部已实测投影差异，yjs 改投影形态仍绿（红线复核 W2 详表） |
| 7 | RD4 用例 A/B：extractYjsSnapshot 全量语义比较（union 三 variant / Record 键集 / Y.Array 逐元素含顺序 / leaf 标量 / XML 经语义比较器 W3）+ 用例 C 嵌套 clone 隔离行为断言 | ADR-0007：「`extractYjsSnapshot(derived, doc)`：只读取固定 ROOT，严格验证实际 Yjs 载体并提取普通逻辑 ROOT」 | no-conflict | 读回校验走 ADR 既有公共入口的正用；XML 叶子全部经语义归一化比较（红线复核 W3 详表），无字节相等退化；clone 隔离是「按引用存储」语义的行为验证，无条款触碰 |
| 8 | RD5 U13 收紧：`toThrow('observer-boom')`（message 精确匹配）+ `observeCalls === 1` + 保留 updates===1 与「值未回滚」断言 | ADR-0007：「事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback」 | no-conflict | 断言与 fatal 语义逐款对齐：原始异常原样传播（非包装/E200/E201）+ 不虚假回滚（值已落盘）；调用次数断言锚定 yjs 批处理，无 ADR 触碰面 |
| 9 | RD6 CI 存在性门禁（`pnpm exec vitest run packages/doc-runtime/test/materialize-root.test.ts --typecheck --passWithNoTests=false`，置于存在性门禁聚簇） | （无 ADR 条款治理 CI 测试存在性门禁；ADR-0005 CI 条款属投影保鲜轨道） | no-conflict | 纯工程门禁增强，与 ADR-0005 regen-diff job 无交集（维持前置门禁第 6 行口径） |
| 10 | R-5 INV-2 语义澄清：「成功路径恰 1 次 update」指本函数发起的事务恰 1 次；RAC-1 测试断言 updates≥1 不锁总数 | ADR-0006：「事务原子性由 Y.transact（单 update 单元）保证」 | no-conflict | 条款约束的是事务-单元关系而非全 doc 事件计数；observer 重入写开启自己的事务单元，不属本函数契约面；U8 既有断言（无 observer 场景）不变 |
| 11 | F11 不入结果联合（throw 形态、无 issues 数组）；`DOCRT-E201` 前缀命名空间（与 vfsl 裸 E201 不同域） | ADR-0007：「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型……Yjs 结构与路径/操作错误 fail-fast」 | no-conflict | F11 与 F10 同族（fatal 以异常离开函数而非结构化 issue），未向 `MaterializeResult` 联合添加成员；错误码命名无 ADR 约束 |
| 12 | 文件面纪律：ALLOW 4 文件（materialize.ts / materialize-root.test.ts / ci.yml / doc-runtime package.json bump）；DENY 覆盖 `docs/adr/**`、`packages/vfsl/**`、xml-parse/carrier/resolve/extract、index.ts 导出面、persistence、vfsl-protocol/codegen | ADR-0007 依赖面：「`@nomicore/vfsl` 继续保持无 Yjs 依赖；持久层继续不理解 VFSL」；ADR-0001 `SCHEMA` 命名契约；ADR-0006 三条目布局 | no-conflict | 改动面收敛于 doc-runtime 单包 + CI；vfsl / 持久层 / 编译期轨道零触碰；E201 是 Error message 前缀非导出实体（公共导出面零变化，唯一公共物化入口不增设）；版本 bump 无 ADR 治理面 |
| 13 | §13 契约审计：`materializeRoot` 返回类型联合不变，新增一条 throw 路径；生产 caller = 0 | ADR-0007：「唯一公共物化入口」；（mutation 条款同款纪律）「成功只返回 `{ ok:true }`，不返回 snapshot、Yjs update 或内部类型」 | no-conflict | 未增设第二物化入口；throw 路径不构成返回值契约变化；未来消费者契约载体为 JSDoc（§2.4），与 Runtime 编排将来时一致 |

## 观察项（非冲突，不构成阻塞；转达 SA2 / SA6）

- **O1（检测面 vs owner 出口 A 措辞的覆盖差）**：INV-10 承诺「ROOT **顶层**与计划逐键同一」，而 owner 反馈出口 A 措辞为「返回时 ROOT 与输入物化结果一致」——嵌套就地修改（G6 实证）不在检测面，`ok:true` 下 ROOT 可与输入 snapshot 存在嵌套差异。ADR-0007 对 observer-后成功语义**未作任何规定**（前置门禁裁定的未定义空间），故不构成 ADR 冲突；设计已明文登记残余面（§2.3 R-1/R-3）并在 JSDoc 诚实划定检测面边界、论证全树比较的假阳性风险（§2.2 论证 5）。owner 验收是否接受「顶层同一性」作为出口 A 的充分落实，属 owner/SA2 评审面，非门禁事项。
- **O2（语义比较器的文本 run 逐字 + 实体不解码）**：§4.4 比较器对文本/不透明 token 逐字输出，镜像基线 D7 规则 1 的构造承诺（初轮设计后复审 #8 已裁 no-conflict）；「实体归一化（`&amp;` vs `&`）是否属于语义等价域」是比较器鲁棒性问题（yjs 未来若改实体投影，比较器可能假红），归 SA2 测试鲁棒性评审，无 ADR 条款触碰。
- **O3（W2 形态注记）**：X-F1~X-F8 逻辑失败行以 `toEqual(direct.issues)` 锚定条数而非字面锁「恰 1」，依据 ADR-0007「逻辑校验保留完整 issues」的全收集语义——比字面锁 1 更贴合 ADR；构造失败行（C-8/X-F9）按 fail-fast 锁「恰 1」。实质满足 W2「失败场景单 issue + 零 update + state 不变」（单违规 fixture 直调实测即 1 条）。SA6 落地时保持该两域断言形态区分即可，勿反向把逻辑失败行误锁成恰 1。

## 结论

**verdict = clear，放行进入 SA2 全维度攻击评审。**

- 冲突点数：**0**；裁决分布：no-conflict × 13（明细行 #1–#13，其中 #1/#2 即红线 W1 复核展开、#6 即 W2 展开、#7 即 W3 展开）、override-declared × 0、evolution × 0、hard-violation × 0。
- **三红线全部落实**：W1——RD1 出口 A 严格执行唯一相容的 throw 形态（三禁全避、异常原样离开、防止类机制未采用），「零 ADR 修订」经四点论证核对**成立**（owner 文档化要求条件式挂出口 B；throw 形态为前置门禁授权的未定义空间延伸；无冻结条款触碰；JSDoc 为契约载体）；W2——成功行 canonical 语义比较禁投影冻结，失败行单 issue + 零 update + state 不变（含逻辑/构造两域断言形态的正确区分）；W3——RAC-4 全部 XML 叶子经 §4.4 同款语义归一化比较器，无字节相等退化。
- 设计是 ADR-0007/0003 既定条款的验收强化 + 一处授权范围内的未定义空间契约补全；无任何条款被要求推翻或实质修订；无需任何 override，无条目需 Jim 裁决。
- 相关决议文档已按设计后复审流程追加「设计引入的新决策点（rev1）」节（RD1–RD6 / INV-10 / F11 摘录 + ADR 锚点），供 SA2/SA3/SA4/SA6 复用。

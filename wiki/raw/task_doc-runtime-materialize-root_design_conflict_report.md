# 冲突门禁报告（设计后复审 — SA1 设计 vs ADR 决策一致性）

- 被审对象：`wiki/raw/task_doc-runtime-materialize-root_design.md`（SA1 设计，907 行，materializeRoot 验证后安全物化，issue #74，feature）
- 冲突基准：`docs/adr/0001`–`0007` 全集（7 份，逐个全读，无抽样）+ `CONTEXT.md` + `wiki/raw/task_doc-runtime-materialize-root_relevant_decisions.md`
- 门禁：SA8（Phase 2 设计后复审；前置门禁 verdict=clear，见 `task_doc-runtime-materialize-root_conflict_report.md`）
- 复审范围：设计文档与 ADR 决策的一致性（轻量复审）；设计优劣归 SA2，实现质量归 SA4/SA7，不在本报告评判

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19 目标态/阶段态、2026-08-21 `SCHEMA` 命名修订节） | 中 | 一致：设计全程零触碰 `SCHEMA` 信封（INV-6「SCHEMA/META 零接触」、U11 锚点、§10 DENY LIST）；`SCHEMA`/`ROOT` 具名条目命名契约未被违反；无 schema 文本/codegen 引入 |
| ADR 0002 | nomicore 是全新 yjs-server 重写，authority 完全出范围 | accepted | 中 | 一致：「单事务提交」纪律落实（D10/INV-2 单 `doc.transact` 恰 1 update）；无 authority 规则以任何形式复活。设计 §1.1.3 把「结构 → 值 → 单事务提交」映射为「①校验（值）②构造（结构）④提交」——ADR-0007 对 materializeRoot 逐句规定「先执行 `validateLogicalSnapshot`，再构造……」，特殊条款优先，管线纪律未被违反（同前置门禁第 6 行裁决口径） |
| ADR 0003 | 求值器与派生 schema | accepted | 高 | 一致：ROOT 顶端固定 Y.Map 且异型一律拒绝（D3/F2、§4.2、§4.3 rootEntries 非 map 形 loud）；`xml-fragment` 终态节点 + XML 字符串投影（D7/§4.6）；联合 any-of + 判别式为非契约缓存（D5 判别式死数据——零读取即不依赖缓存，可观测行为不因缓存存在与否改变）；ref 按名引用不内联展开、解析由包内共享解析器完成（D8 同包纯移动，与条款同向强化） |
| ADR 0004 | vfsl-protocol 类型协议包 | accepted | 低 | 无涉：编译期类型投影轨道。仅共享「ROOT 挂载点知识收敛于绑定实现的 `doc.getMap('ROOT')` 一处」纪律——设计 probeRoot 单点触碰同款（INV-6） |
| ADR 0005 | 投影生成管线 | accepted | 无 | 无涉：SchemaSource/生成器/CI 管线与运行时物化无交集 |
| ADR 0006 | Cordis 持久化插件与 doc 三条目内容布局 | accepted（含 2026-08-21 createDoc/owner、2026-08-22 getStatus 修订节） | 中 | 一致：三条目布局界定写入面——物化只写 ROOT 子树，SCHEMA/META 兄弟条目零接触（INV-6/U11/DENY LIST 排除 persistence）；「事务原子性由 Y.transact（单 update 单元）保证」即 INV-2/U8 的直接依据；持久层行为零改动 |
| ADR 0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted | **直接** | 完全一致：`materializeRoot` 条款逐句落文（内部先 `validateLogicalSnapshot` → detached 构造 → 确认 ROOT 空 → 单 `Y.transact` 安装；验证/构造失败零写入；不覆盖、不合并、不 fallback）；失败边界（observer 事务异常 fatal、不虚假回滚）、结果联合域分离（不合并巨型 issue）、路径段数组纪律、依赖面（vfsl 无 Yjs 依赖、持久层不理解 VFSL、doc-runtime 依赖 vfsl+yjs）、TOCTOU 反 prepared 姿态全部遵守 |

无任何 ADR 处于 superseded 状态；ADR 0001/0006 的修订节均为 owner 裁决放行的内部演进，已按修订后文本对照（与前置门禁同口径）。

## 冲突点

无（**0 条 hard-violation / 0 条 evolution / 0 条 override-declared**）。设计未声明推翻任何 ADR，未试图修订任何既有决策——全部条款是 ADR-0007 `materializeRoot` 条款及其配套决策的实现落地与细化。

逐条对照明细（全部判 no-conflict，供复核；引文均为原文摘录）：

| # | 设计条款 | ADR 依据（原文） | 裁决 | 依据 |
|---|---|---|---|---|
| 1 | D1 四阶段编排顺序：①validateLogicalSnapshot → ②detached 构造 → ③ROOT 探针/空置判定 → ④单 doc.transact（§4.1「编排顺序即 ADR-0007 原文顺序」） | ADR-0007：「内部先执行 `validateLogicalSnapshot`，再构造未集成到任何 doc 的 detached Yjs 子树，确认目标 ROOT 为空后以一次 `Y.transact` 安装」 | no-conflict | 四阶段与 ADR 句序逐句对应；detached 子树未集成任何 doc（§4.3/§4.5 产物全 detached 或新克隆） |
| 2 | D1/INV-5/F10：④ 事务阶段排除在一切 try/catch 之外，observer 异常**原样抛出**，不吞并、不伪装返回值、不清理已写内容 | ADR-0007：「事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback」 | no-conflict | 「fatal 的唯一诚实表达是让异常原样离开函数」（§2.3）是对该条款的入口级诠释：不虚假回滚 ✓、不 fallback ✓、不吞并成结构化返回 ✓；ADR 未规定 fatal 的机制形态，诠释与条款同向且与 SA6 U13 冻结锚（toThrow + 值已落盘）一致 |
| 3 | INV-1 零写入：④ 开始前任何返回路径 doc state 逐字节不变 + 0 update（§4.1 结构性论证） | ADR-0007：「验证或构造失败时目标 doc 零写入」「零写入承诺覆盖所有验证失败和 detached 构造失败」 | no-conflict | ①只读 snapshot、②产物全 detached、③probeRoot 只读（惰性创建零 update），④是首条写路径——零写入由结构保证 |
| 4 | D2/F1：logical 失败 issues **引用零损透传**（含 100 条上限/截断/E100 形态原样，INV-4） | ADR-0007：「逻辑校验保留完整 issues，Yjs 结构与路径/操作错误 fail-fast」 | no-conflict | 全收集语义原样保留；同源引用直传（U1 `toEqual` 锚点） |
| 5 | §4.8 结果联合域分离：F1 数组元素为 `ValidateIssue` 引用，F2–F9 为 materialize 域自建单 issue，`MaterializeIssue` 独立类型 | ADR-0007：「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型」 | no-conflict | 两域各自保留领域化联合，无合并；materialization 恰 1 条 issue 是「fail-fast」的具体化（前置门禁第 3 行已裁决） |
| 6 | D3/F2：ROOT 载体非 Y.Map（Y.Array/Y.XmlFragment/Y.Text/标量）→ 单 issue 拒绝；F3 ROOT 非空 → 单 issue「不覆盖、不合并、不 fallback」 | ADR-0003：「ROOT 固定物化为 Y.Map，`YArray` / `YXmlFragment` 与标量形一律拒绝……Yjs 映射为 `doc.getMap('ROOT')`」；ADR-0007：「确认目标 ROOT 为空后……不覆盖、不合并、不 fallback」 | no-conflict | 异型拒绝与空置判定逐词对应；安装目标为 `doc.getMap('ROOT')` 本身（§4.3 rootEntries 论证），挂载点知识单点收敛（同 ADR-0004 D5 纪律） |
| 7 | INV-6/U11：全程只触碰 `'ROOT'` 名字空间，SCHEMA/META 兄弟条目物化前后不变 | ADR-0006：「META/SCHEMA 作为 ROOT 的兄弟条目，天然在 validateSnapshot/validatePatch 的校验面之外（校验只作用 ROOT 子树）」＋三条目布局；ADR-0001 `SCHEMA` 命名契约 | no-conflict | 写入面与校验面对称收敛于 ROOT 子树；SCHEMA 信封零接触 |
| 8 | D7/§4.6：XML 文本 span 逐字保留不解码实体、注释/CDATA/PI 逐字 XmlText、attr 值含 `"` 构造期拒绝、重复 attr last-wins；U12 断言锚 normalizeXml 语义等价 + 重校验 ok | ADR-0007：「XML string 与 Y.XmlFragment 只承诺语义等价 round-trip，不承诺字符串逐字相同」；ADR-0003：「`xml-fragment` 是结构树的**终态节点**……JSON 快照中其值为 XML 字符串……运行时校验仅要求良构 XML」 | no-conflict | 承诺面未收紧：逐字 span 是构造**手段**，AC/U12 断言仍为语义等价（未逐字断言，符合前置门禁注意事项 5）；attr-`"` 拒绝与终态节点语义无涉，属构造失败预期面（见 #9） |
| 9 | D4/D6/INV-9：构造期 JSON 域断言六词拒绝（bigint / non-finite number / undefined / non-plain object / function / symbol + 内嵌 Y 类型），单 issue、零写入 | ADR-0007：「`validateSnapshot`……更名为 `validateLogicalSnapshot`……只接受普通 JSON logical ROOT snapshot」；「零写入承诺覆盖所有验证失败和 **detached 构造失败**」；「不覆盖、不合并、不 fallback」 | no-conflict | 快照契约本就是普通 JSON；逻辑校验宽域（unknown 位）通过后的非 JSON 值在构造期响亮拒绝，落在 ADR 明文预期的「detached 构造失败」失败面（单 issue + 零写入），非契约收窄；§2.2 可达性实证属 SA2 攻坚面，门禁不判优劣 |
| 10 | D5：union 构造试验 = 递归构造尝试，首个成功成员胜（声明序）；判别式（discriminator）死数据、`byValue` 零读取 | ADR-0003：「匹配语义 **any-of**（至少一个成员接受即接受）」；「附非契约缓存 `discriminator`，O(1) 跳转；**缓存的缺失/存在不得改变任何可观测行为（含错误输出）**」 | no-conflict | 成员选择由结构试验 + 声明序裁决，不读缓存即「可观测行为不依赖缓存」的满足而非违反；any-of 语义（至少一成员可构造即接受、全拒单 issue F6）对齐 |
| 11 | D8：`makeRefResolver` 自 extract.ts **纯移动**至同包 resolve.ts（实现逐字不变），两侧共用 | ADR-0003：「引用**不内联展开**，解析动作由包内共享解析器完成」 | no-conflict | 同包共享化与「包内共享解析器」条款同向强化；48 用例回归锚防行为漂移 |
| 12 | D9：map 装配按快照键迭代（封闭形未声明键 = 单 issue 拒绝静默丢键）；INV-8 确定性（快照键枚举序/成员声明序/XML 源序） | （无 ADR 条款约束迭代序；确定性与不丢数据与 ADR-0007「不 fallback」/零损纪律同向） | no-conflict | 纯实现层决策，无 ADR 触碰面 |
| 13 | D10/INV-2：单 `doc.transact` 恰 1 update；空 entries（全 optional 空快照）= 合法零写入成功（0 update、ok:true） | ADR-0007：「以一次 `Y.transact` 安装」；ADR-0006：「事务原子性由 Y.transact（单 update 单元）保证」 | no-conflict | 单事务安装原样落实；ADR 未要求事务非空载荷，空快照成功由 U5 正向对照语义延伸，非条款违反 |
| 14 | §3.1 公共接缝：`materializeRoot(derived, snapshot, doc)` 唯一新公共入口；成功 `{ok:true}` 不携带 snapshot/Yjs update/内部类型；xml-parse/resolve 不进包公共面 | ADR-0007：「唯一公共物化入口」；（mutation 条款同款纪律）「成功只返回 `{ ok:true }`，不返回 snapshot、Yjs update 或内部类型」 | no-conflict | 未增设第二物化入口；内部件（buildValue/mapEntries/xml-parse/resolve）不扩公共面（§8 明文），类型导出不构成入口 |
| 15 | MaterializeIssue.path：段数组（map/object/Record 用 string，Y.Array 用 number；`[]` 即 ROOT 自身）；点号位置线只进 message 不进 path | ADR-0007：「路径统一为 `readonly (string | number)[]`：map/object/Record 使用 string，Y.Array 使用 number；禁止点号字符串与 JSON Pointer」 | no-conflict | 段数组语义逐款一致，无点号字符串/JSON Pointer；类型声明 `Array<string|number>` 与散文 `readonly` 修饰的 TS 层差异见观察项 O1（非语义冲突） |
| 16 | §4.1 TOCTOU：①②③④ 同一同步调用内完成，不公开任何跨时间 prepared 状态 | ADR-0007（applyValidatedMutation 条款同向纪律）：「不公开可跨时间执行的 prepared mutation，避免 TOCTOU」 | no-conflict | 无 prepared 物外泄；JS run-to-completion 封闭检查与事务之间的窗口 |
| 17 | §3.2/§10：落位 `@nomicore/doc-runtime`，零新依赖（仅既有 `@nomicore/vfsl + yjs`）；DENY LIST 排除 `packages/vfsl/**`、`packages/persistence/**`、`packages/dsh-persistence/**`；carrier.ts 零修改 | ADR-0007：「`@nomicore/vfsl` 继续保持无 Yjs 依赖；持久层继续不理解 VFSL。新包 `@nomicore/doc-runtime` 依赖 `@nomicore/vfsl + yjs`」 | no-conflict | 依赖面与包边界逐款落实；不向持久层引入 VFSL 语义 |
| 18 | §8：下游 `applyValidatedMutation` 复用内部件属未来同包工作；进程级 observer fatal 处置归调用方 NamespaceRuntime | ADR-0007 Runtime 编排边界：「NamespaceRuntime 将来按 namespace 串行化所有业务写入……」 | no-conflict | 设计不越界实现 Runtime 编排（ADR 标注为将来时）；fatal 处置职责与「Runtime 自有 observer 必须记录或异步上报」的归属一致 |

## 前置门禁 6 条非冲突注意事项落实核对

前置报告（`_conflict_report.md`）末尾转达的 6 条，逐条核对设计落位：

| # | 注意事项（前置门禁原文要义） | 设计落位条款 | 核对结论 |
|---|---|---|---|
| 1 | 实现落位 `@nomicore/doc-runtime`，依赖仅 vfsl + yjs；vfsl 无 Yjs 依赖、持久层不涉 | §3.2 模块布局（全部改动在 `packages/doc-runtime/src`，「零新增依赖……package.json 零改动」）+ §10 DENY LIST（vfsl/persistence/persistence-plugin 全排除） | ✅ 落实 |
| 2 | 入口名 `validateLogicalSnapshot`（无兼容 alias；Avoid: validateSnapshot） | §4.1 阶段① 直调 `validateLogicalSnapshot(derived, snapshot)`；全文零处使用旧名、零 alias（§1.1 引 ADR-0006 历史措辞处已按 relevant_decisions 注记为更名前措辞） | ✅ 落实 |
| 3 | ROOT 顶端固定 Y.Map（`doc.getMap('ROOT')`）、只写 ROOT 子树、不触碰 SCHEMA/META | §4.2（探针 Y.Map 判定 + F2 异型拒绝）+ §4.3 rootEntries（非 map 形 loud）+ INV-6（「全程只触碰 'ROOT' 名字空间」）+ U11 锚 SCHEMA/META 不变 | ✅ 落实 |
| 4 | 结果联合按域分离：logical 全收集 / materialization 单 issue，不合并巨型 issue 类型 | §4.8 失败分类总表：F1 完整透传（`ValidateIssue` 引用）与 F2–F9 materialize 域自建单 issue 分域，明文引「不合并成巨型 issue 类型」；`MaterializeIssue` 独立类型 | ✅ 落实 |
| 5 | XML 叶子终态，只承诺语义等价 round-trip（AC-5 不得收紧为逐字） | §4.6 策略层逐字 span（手段）；§5/U12 断言层 `normalizeXml` 语义等价 + 重校验 `ok:true`（承诺面未收紧为逐字断言） | ✅ 落实 |
| 6 | observer 边界：不虚假承诺事务回滚 | D1 + INV-5 + F10 + §4.7（异常原样抛出、不吞并、不清理已写内容）+ U13 锚（toThrow + 恰 1 update + 值已落盘不承诺回滚） | ✅ 落实 |

**6/6 全部落实。**

## 观察项（非冲突，不构成阻塞；转达 SA2 / SA3）

- **O1**：`MaterializeIssue.path` 类型为 `Array<string | number>`，ADR-0007 散文写作 `readonly (string | number)[]`——段数组语义逐款一致，仅 TS `readonly` 修饰差异；SA3 实现时可对齐 `readonly`，非门禁事项。
- **O2**：写侧六词域拒绝（#9）的可达性论证（unknown 位/NaN 通道，§2.2/P17 实证）与「逻辑宽域 ⊃ JSON 窄域」的域关系属设计论证强度问题，归 SA2 全维度评审；门禁仅确认其失败出口（单 issue + 零写入）落在 ADR 预期的「detached 构造失败」面。
- **O3**：attr 值含 `"` 的构造期拒绝（F8）意味着部分**良构** XML 字符串（① 通过）不可物化——同属构造失败预期面，策略取舍（拒绝 vs 有损转义）归 SA2。
- **O4**：空事务 = 合法零写入成功（B12/T14）是对「以一次 Y.transact 安装」的边界读法，已由 U5 正向对照锚定；如 SA2 认为需要 ADR 层面明文，属未来演进议题，非本设计违反。

## 结论

**verdict = clear，放行进入 SA2 全维度攻击评审。**

- 冲突点数：**0**；裁决分布：no-conflict × 18（明细行 #1–#18）、override-declared × 0、evolution × 0、hard-violation × 0。
- 设计是 ADR-0007 `materializeRoot` 条款的逐句实现落地：编排顺序、零写入承诺、不覆盖/不合并/不 fallback、失败边界（observer fatal 不虚假回滚）、结果联合域分离、路径纪律、依赖面与包边界全部与 ADR 全集一致；无任何条款被要求推翻或实质修订。
- 前置门禁 6 条非冲突注意事项全部落实（6/6）。
- 相关决议文档已按设计后复审流程追加「设计引入的新决策点」节（D1–D10 摘录 + ADR 锚点），供 SA2/SA3/SA4 复用。

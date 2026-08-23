# 相关决议 (Relevant Decisions) — 全链 SA 复用（修订轮 rev2）

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 被审对象：`wiki/raw/task_doc-runtime-materialize-root-rev2.md`（PR #84 owner review 修订轮 rev2，issue #74 / materializeRoot；缺陷修复性质——运行时 guard 缺失导致假成功）
> 冲突基准：`docs/adr/0001`–`0007` 共 7 份（全量读取，无抽样；无 superseded 条目）+ `CONTEXT.md`。
> 已核对：基线分支 `origin/docs/doc-runtime-validation`（8a42501）上 `docs/adr/` 与 `CONTEXT.md` 与本 worktree 逐字节一致（`git diff --stat` 为空）——rebase 后本清单仍然有效。
> ADR 状态一览：0001–0007 全部 accepted（0001、0006、0007 内含 owner 裁决放行的带日期修订节，修订节取代关系已在文内声明，以修订后文本为准；0006 最近修订节 2026-08-22 issue #79）。
> 修订轮语境：本轮在 rev1 已实现基线（RD1–RD6 / INV-10 / F11，verifyInstall + DOCRT-E201）之上继续闭环 owner review；三项修订要点（P1 运行时 transaction guard / Medium verifyInstall 成功语义 / Minor lexical-token 与 E200 覆盖）全部落位于 ADR-0007 与 ADR-0003 条款及其未定义空间（裁决见 `_conflict_report.md`，本文只列约束）。

## 相关 ADR

### ADR 0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted）——本轮直接上游（P1 / Medium / Minor 全部落位于此）

- 与本任务的关联点：P1 裁决 materializeRoot 在活动外层 transaction 内调用的运行时拒绝形态（guard 是本条款「一次 Y.transact 安装」前提的运行时兑付）；Medium 出口 1 用 `extractYjsSnapshot` 做物化后完整语义校验、出口 2 落位 Runtime 引用禁止条款；Minor-1 的 round-trip 承诺面与 Minor-2 的零写入承诺面均由本 ADR 冻结。
- 核心条款（原文摘录）：
  - 「`materializeRoot(derived, snapshot, doc)`：唯一公共物化入口；内部先执行 `validateLogicalSnapshot`，再构造未集成到任何 doc 的 detached Yjs 子树，确认目标 ROOT 为空后以一次 `Y.transact` 安装。验证或构造失败时目标 doc 零写入；不覆盖、不合并、不 fallback。」
  - 失败边界全文：「零写入承诺覆盖所有验证失败和 detached 构造失败。Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报。事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback。」
  - Runtime 编排边界（P1 Runtime 包装层选项与 Medium 出口 2 引用禁止的归属层）：「NamespaceRuntime 将来按 namespace 串行化所有业务写入：轮到 mutation 时先检查 writable gate，同步调用 `applyValidatedMutation`，成功后立即调用 persistence `saveDoc` 标脏。业务调用方不得取得可写 Yjs 引用或绕过该入口；未来原始 Yjs update 必须另设受控验证通道。」
  - 「`extractYjsSnapshot(derived, doc)`：只读取固定 ROOT，严格验证实际 Yjs 载体并提取普通逻辑 ROOT；首个结构错误立即停止，不读取或验证 SCHEMA/META。」
  - round-trip 承诺面（Minor-1 红线上游）：「XML string 与 Y.XmlFragment 只承诺语义等价 round-trip，不承诺字符串逐字相同。」
  - （mutation 条款，成功语义同款纪律——P1「不得返回 {ok:true}」的对照锚）「成功只返回 `{ ok:true }`，不返回 snapshot、Yjs update 或内部类型。」
  - 依赖面（P1 Runtime 包装层选项的分层约束）：「`@nomicore/vfsl` 继续保持无 Yjs 依赖；持久层继续不理解 VFSL。新包 `@nomicore/doc-runtime` 依赖 `@nomicore/vfsl + yjs`，提供：」（实证：`packages/doc-runtime/package.json` dependencies 恰为 `@nomicore/vfsl` + `yjs`；仓内尚无 NamespaceRuntime 包——该层是 ADR 预留的「将来」层）
  - 「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型；NamespaceRuntime/Registry 再映射成稳定的 create/open/mutation 上层错误。逻辑校验保留完整 issues，Yjs 结构与路径/操作错误 fail-fast。」
  - 「`validateSnapshot` 直接更名为 `validateLogicalSnapshot`，不保留兼容 alias；它只接受普通 JSON logical ROOT snapshot，不接受 Y.Doc/Y.Map/Y.Array。」

### ADR 0003 求值器与派生 schema（accepted）——Minor-1 直接依据 / P1 间接

- 与本任务的关联点：CDATA/PI/comment 的 lexical-token 定性落在「xml-fragment 终态节点 + 不定义结构映射」的 opaque 立场之内；ROOT=Y.Map 固定与联合 any-of 约束本轮不触碰。
- 核心条款（原文摘录）：
  - 「`xml-fragment` 是结构树的**终态节点**：无 children、路径下钻守卫到此为止；JSON 快照中其值为 XML 字符串（与 `Y.XmlFragment.toJSON()` 投影一致），运行时校验仅要求良构 XML。不定义实参字段与 XML 结构的映射——实参字段为文档性质。」
  - 「每个模块必须恰好声明一个名为 `ROOT` 的别名（大小写是契约，`root` / `Root` 不算），且必须 **map 形**（clsOf = map：裸对象 / `YMap` / `Record` / 全 map 形联合）——ROOT 固定物化为 Y.Map，`YArray` / `YXmlFragment` 与标量形一律拒绝。……Yjs 映射为 `doc.getMap('ROOT')`。」
  - 「基础表示：`{ kind: 'union'; members: StructureNode[] }`；匹配语义 **any-of**（至少一个成员接受即接受——重叠成员不构成错误）；路径存在性为**任一成员出现即存在**」

### ADR 0006 Cordis 持久化插件与 doc 三条目内容布局（accepted，含 2026-08-21 createDoc/owner、2026-08-22 getStatus 修订节）

- 与本任务的关联点：「单 update 单元」事务原子性是 P1 guard 的强化对象（嵌套 transaction 合并将破坏 materializeRoot 安装的自有事务边界）；三条目布局界定零写入断言面（SCHEMA/META 兄弟条目一并不动）；修订轮零触碰持久层。
- 核心条款（原文摘录）：
  - 「事务原子性由 Y.transact（单 update 单元）保证，store 无需多写事务。」
  - doc 内容布局（三条目）：`SCHEMA`（信封）/ `META`（元信息）/ `ROOT`（数据根）
  - 「META/SCHEMA 作为 ROOT 的兄弟条目，天然在 validateSnapshot/validatePatch 的校验面之外（校验只作用 ROOT 子树）。」（注：此处 `validateSnapshot/validatePatch` 为 ADR 0007 更名前的历史措辞，现对应 `validateLogicalSnapshot` 等）
  - 「**持久层 = Y.Doc 的存储引擎（store + cache 一体）**，看得见 Y.Doc（结构、update 事件、state vector），看不见 schema 语义（VFSL/校验规则属引擎领地）。」

### ADR 0002 nomicore 是全新 yjs-server 重写，authority 完全出范围（accepted）

- 与本任务的关联点：「结构 → 值 → 单事务提交」三步纪律是 P1 零写入拒绝（失败 ⟹ 文档不变）的上游管线依据；P1 运行时 guard 是 API 前置条件检查，不得演化为 authority 式数据值不变式体系复活。
- 核心条款（原文摘录）：
  - 「统一写入管线收敛为“结构 → 值 → 单事务提交”三步。」
  - 「旧系统既有的 authority 规则体系（`__authority__` manifest：enum / range / conditional / state-machine）**完全排除在范围外，不保留接口**」

### ADR 0001 VFSL 文本是 schema 的唯一真相源（accepted，含 2026-08-19 目标态/阶段态、2026-08-21 `SCHEMA` 命名修订节）

- 与本任务的关联点：`SCHEMA`/`ROOT` 具名条目命名契约；本轮全部改动是 guard/语义澄清/测试/文档，不引入 schema 文本与 codegen。
- 核心条款（原文摘录）：
  - 「VFSL 文本只作为运行时数据存在于文档的 `SCHEMA` 中」
  - 「信封在 doc 中的键名由 `__schema__` 改为 **`SCHEMA`**——与 `ROOT` 保持统一命名（doc 顶层两个具名条目：`SCHEMA` 信封 + `ROOT` 数据）。信封内部结构 `{lang, version, id, text}` 不变」

### ADR 0004 vfsl-protocol 类型协议包（accepted）——低相关

- 与本任务的关联点：编译期类型投影轨道，不约束运行时物化；唯一共享纪律是 ROOT 挂载点知识收敛位置。
- 核心条款（原文摘录）：
  - D5：「`VfslPathMap` 顶层键 = ROOT 的字段……ROOT 是 doc 级固定挂载点，挂载知识只出现在绑定实现的 `doc.getMap('ROOT')` 一处。」

### ADR 0005 投影生成管线（accepted）——无直接关联

- 与本任务的关联点：SchemaSource 接缝与生成器 CI 管线属编译期轨道，与运行时物化修订无交集；列出仅为 ADR 盘点完整。

## CONTEXT.md 相关术语与惯例

- `零写入（zero-write）`：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」——P1 拒绝形态与 Minor-2 E200 覆盖的纪律锚。
- `方言（dialect）`：「`lang + version` 决定的 VFSL 语法子集与语义规格；一经发布冻结，引擎只增不改，未知方言 loud-fail 只读。」——仓内 loud-fail 文化基线（P1「运行时响亮拒绝」的精神同源）。
- `逻辑快照校验（validateLogicalSnapshot）`：「对普通 JSON 逻辑 ROOT 快照运行完整值语义校验；不接收 Y.Doc / Y.Map / Y.Array，也不验证 Yjs 载体。创建前校验、迁移后体检、测试与管理端点共用该入口。」（_Avoid_: validateSnapshot）
- `ROOT`：「命名空间根别名的保留名（大小写是契约）：每个模块必须恰好声明一个 map 形的 `type ROOT = …`（裸对象 / `YMap` / `Record`），ROOT 固定物化为 Y.Map，Yjs 映射为 doc 根 `getMap('ROOT')`。」
- `标记类型（marker types）`：「`YMap` / `YArray` / `YPlainArray` / `YLeaf` / `YXmlFragment` / `Pattern`；tsc 视角恒等别名，引擎视角是 Yjs 物化语义标记。」
- `结构树（structure tree）`：「Yjs 物化语义（kind / storage / opaque），供路径下钻守卫；与值语义正交。」

## ADR 派生红线（rev1 前置门禁锚定、rev2 沿用；出处为上述 ADR 条款，非 wiki 自创）

> 以下三条由 rev1 前置门禁从 ADR 原文推出（`task_doc-runtime-materialize-root-rev1_conflict_report.md` W1–W3），rev2 简报的修订要点直接落在其管辖面上，全链 SA 必须继续遵守：

- **W1（写后偏离唯一相容形态 = throw）**：事务提交后检测到 observer 偏离（DOCRT-E201 家族），唯一与 ADR-0007 相容的响亮失败形态是 throw（异常原样离开函数）；「事务提交后返回 ok:false / 结构化失败」「补偿修复写入」「声称已回滚」三种形态分别落入「零写入承诺」「不覆盖、不合并、不 fallback / 不尝试 fallback」「不虚假声称自动回滚」的违反面。rev2 补充澄清（见冲突报告重点裁决一）：该红线约束**写后**检测面；P1 的 transaction guard 在**任何写入前**触发，throw 与 `{ok:false}` 结构化失败两种形态均与零写入纪律相容，形态选择归 SA1。
- **W2（XML 断言不得收紧为逐字相同）**：XML 测试断言不得把 round-trip 承诺收紧为字符串逐字相同（ADR-0007「只承诺语义等价 round-trip，不承诺字符串逐字相同」）；失败场景保持单 issue + 0 update + state 字节不变。rev2 Minor-1 的 CDATA/PI/comment lexical-token 定性受同一红线约束。
- **W3（语义比较不退化为字节相等）**：「完整语义比较」对 XML 叶子必须经语义归一化比较，不得退化为字节相等（Medium 出口 1 的完整语义校验同受此约束）。

## rev1 基线决策点（本轮直接修改对象；wiki 档案，非冲突基准，仅供落点检索）

- **RD1 / ⑤ verifyInstall / INV-10 / F11**（`materialize.ts:82-115` 现行实现）：`doc.transact` 返回后、`return {ok:true}` 前，顶层 `rootMap.size === entries.length` + 逐键 `get(key) === value` 双断言；偏离 → `throw DOCRT-E201`（不回滚、不补偿、不返回 ok:false）。rev2 Medium 即裁决该检测面的语义等级（顶层 keyset+identity vs 完整语义校验）。
- **JSDoc 前置条件段**（`materialize.ts:54-57` 现行实现，R2 修订增补）：「本函数的事务必须是该 Y.Doc 的最外层事务——调用方不得在未闭合的 doc.transact 内调用」——**纯文档声明、无运行时 guard**，rev2 P1 的修改对象（简报要求运行时 loud fail + 零写入，不能只靠 JSDoc）。
- **characterization 测试**（`materialize-root.test.ts:708-735`）：现行把「外层 transaction 内调用 → 先返回成功、后发生未检测偏离」固化为特征测试——rev2 P1 要求改为拒绝测试。
- **RD2 构造失败零写入矩阵（C-1~C-8）/ DOCRT-E200**（`materialize.ts:121-152` 现行实现）：①②③ 共享崩溃边界，意外异常 → `DOCRT-E200` 单 issue + ok:false；rev2 Minor-2 要求对该路径零写入做确定性覆盖（受控 seam 或极深树）。
- **rev1 设计/评审/门禁档案**：`task_doc-runtime-materialize-root-rev1_design.md`（RD1–RD6）、`-rev1_conflict_report.md`（前置门禁 clear，重点裁决一/二）、`-rev1_design_conflict_report.md`（设计后复审 clear）、`-rev1_sa2_review.md` / `-rev1_sa4_review.md` / `-rev1_sa7_report.md`（双清）。
- **初轮档案**：`task_doc-runtime-materialize-root_relevant_decisions.md` / `_conflict_report.md` / `_design_conflict_report.md` / `_design.md`（D1–D10 / INV-1~INV-9 / F1–F10 / U1–U13）。

> 边界提醒：wiki 档案与代码不构成冲突基准；冲突基准只有 ADR 全集 + CONTEXT.md。上节仅为修订落点与复用检索导航。

## 设计引入的新决策点（SA8 设计后复审追加，rev2）

> 摘自 SA1 设计 rev2（`task_doc-runtime-materialize-root-rev2_design.md`，决策总表 RD7–RD11 / 新增不变式 INV-11 / 新增错误码 E202 与 E201 变体 C-D）。
> 只登记与 ADR 条款/红线有落位关系的新决策点，供 SA2/SA3/SA4/SA6/SA7 复用；不裁决，裁决见
> `task_doc-runtime-materialize-root-rev2_design_conflict_report.md`（verdict=clear，W1/W2'/W2/W3/W4 五红线全部复核通过）。

- **RD7 / ⓪ 运行时 transaction guard（P1）**：机制 (a) yjs 内部字段检测（机制 (b) Runtime 包装层否决）；三窗口模型——A `doc._transaction !== null`（外层 transact 未闭合）/ B `doc._transaction === null && doc._transactionCleanups.length > 0`（cleanup/observer 派发中，设计期实测新发现的同构假成功窗口）/ C 形态异常 fail-closed；触发点 = `materializeRoot` 函数体第一句（prepare 前、一切 try/catch 之外）；形态 = **throw `DOCRT-E202`**（三变体消息设计 §3.4 逐字定稿）；precedence：语境违规 > 一切数据域失败；只治理 materializeRoot 写路径（extract/readLogicalValueAtPath 只读入口不加 guard）；subdoc 排除。落位：ADR-0007 materializeRoot 条款 + Runtime 编排边界 + 依赖面（W4 合规：零新依赖、模块内部件、不新增第二物化入口）；ADR-0006「单 update 单元」（guard 恢复其最外层语境前提）。rev1 SA2「不建议 `_transaction` guard」定谳经 owner 权威升级显式推翻（设计 §3.3，T-1 预登记更新路径兑现）。
- **RD8 / ⑥ verifySnapshotIntact（Medium 出口 1）/ INV-11**：⑤ 之后、`return {ok:true}` 前用 `extractYjsSnapshot` 读回整树 + schema-parallel 语义比较（map 键集 + Record 动态键集 / array 顺序敏感 / union any-of 声明序、不要求同成员 / leaf-plain 深度相等、undefined 视同缺席 / XML 经 `canonicalXmlOf` 归一化——复用 xml-parse.ts 共享扫描器，禁字节比较）；偏离 → throw E201 变体 C、校验无法完成 → throw E201 变体 D（消息明示「不代表已检测到偏离」）；⑤ 顶层身份校验保留为前置子集（变体 A/B 不变）；`ok:true` 语义升级 INV-11（完整逻辑快照语义等价，契约时点 = 返回时）。落位：ADR-0007 extractYjsSnapshot 入口正用 + 失败边界 throw 纪律（W1）+ round-trip 条款（W3）；出口 2 否决（零 ADR 触碰，W2' 不触发）；「Runtime 禁止取得可写引用」登记为未来 NamespaceRuntime 执行义务（本轮零动作）。
- **RD9 / lexical-token 措辞（Minor-1）**：CDATA/PI/comment 为 raw `Y.XmlText` 逐字 span 的 lexical-token **载体特征**（characterization 锁定），非结构化 XML 节点；公共承诺面维持 ADR-0007 语义等价 round-trip、不承诺逐字（W2）；零行为改动。
- **RD10 / 极深树定稿（Minor-2）**：确认 20_000 层极深树方案充分（② 装配溢出 → E200 单 issue + 0 update + state 不变），**不引入受控 seam**——ADR-0007「零写入承诺覆盖所有验证失败和 detached 构造失败」的确定性验收锚。
- **RD11 / 版本与发布面**：doc-runtime 0.1.4 → 0.1.5（patch）；ALLOW 5 文件（materialize.ts / xml-parse.ts（新增模块内部导出 `canonicalXmlOf`，不进公共面）/ index.ts 注释 / package.json / SA6 双测试）；DENY：`packages/vfsl/**`、persistence、codegen/protocol、`docs/adr/**`、workflows、extract/read/carrier/resolve。
- **错误码家族终态**：E100（extract 崩溃边界）/ E200（materialize ①②③ 崩溃边界，ok:false）/ E201（写后偏离 fatal 家族，throw，变体 A=size / B=identity / C=语义偏离 / D=校验无法完成）/ **E202（写前语境拒绝，throw，新增）**——写前/写后、throw/ok:false 通道分立与 W1 两面映射一致。
- **O1 前瞻登记（SA8 观察项，非设计内容）**：E202 guard 落地后，rev1 R-7 预警的「未来 create 流程把 materializeRoot 包进外层事务（ADR-0006 三条目单 update 单元）」将从静默假成功变为响亮 E202 拒绝——方向安全，但未来 create 流程设计时不能包裹调用，三条目原子安装需另行设计（分事务或另设受控通道——后者治理面 ADR-0007 已预留）；无当前 ADR 条款冲突，登记供未来设计者知悉。

### R2 修订增量（SA8 设计后复审 R2 轮追加；裁决见 design_conflict_report.md R2 节，verdict=clear）

> SA2 R1 reject（#1 CRITICAL 重叠联合假阳性 + #2–#10）后的设计 R2 修订；宣称收敛面（RD7 架构/三窗口判定域/throw 形态/E202 家族/RD9-RD11）经 SA8 核对为零改动。

- **⑥ 比较器改投影基准（R2/#1/#6）**：三值 `cmp(node,a,b) → equal|diff|incompatible`；封闭 map 成员只比声明字段（未声明键两侧忽略——extract trialMember/D4 投影镜像；F7/D4 仲裁不对称经源码实证 `materialize.ts:253` vs `extract.ts:7`）、Record 全键、union 声明序 any-of（'diff' 记首诊断后**继续**下一成员，∃成员使两侧可走查且投影相等即等价）；逐 kind 可走查谓词定稿（leaf/plain 恒可走查）；canonical 扫描失败 → 变体 D（不静默跳成员、不谎报偏离）。**依据：ADR-0003「重叠成员不构成错误」——R1「原始输入」基准与之相抵触（重叠联合诚实路径假阳性，SA2 E4 + SA1 §9.3 双复现），R2 为向 ADR 对齐的修正；§9.3 仿真经 SA8 独立复跑逐行一致（C1–C4 equal、RT-1.4 diff）。**
- **INV-11 定稿为投影等价（R2/#9）**：`ok:true` ⟹ 返回时 extract 读回投影与输入的对应成员投影语义等价；**检测面 = extract 投影（D4）**——结构树未声明键（含重叠联合未选中成员独有键）不入投影亦不入检测面，继承自 extract 既定语义（ADR-0007 冻结入口），非本轮弱化；投影外修改由 ADR-0007 observer 纪律治理；JSDoc 落文（§4.4 第 3 条），零 ADR 触碰（W2' 不触发）。
- **afterAllTransactions 安全例外（R2/#4/PA-9）**：该回调时 `_transactionCleanups` 已重置 `[]`（Transaction.js 先重置再 emit）——B 谓词本就不命中；窗口内新开 transact 自含完整生命周期（SA2 E2b 实证），⑤⑥ 有效，放行正确；RT-2 对照组断言 ok:true（防 SA3 误拒）。
- **窗口 C 收敛 fall-through（R2/#3）**：§3.4 伪代码为唯一规范锚（无 Transaction 形态嗅探）；truthy 垃圾 tx → A、`tx undefined + 非空队列` → B（真实 doc 上即真窗口 B）——R1 门禁 O2 出入已收敛。
- **wedge 登记（R2/#5/R-7/PA-10）**：监听者 cleanup 派发期抛异常 → 队列永久卡死 → 后续顶层调用永吃 E202-B；fail-closed 可辩护（派发机制已死 = 持久化黑洞，拒绝写入安全侧），E202-B 消息补诊断分支；与 ADR-0007 observer fatal 纪律同向。**O4 前瞻（SA8 观察项）**：未来 ADR-0006 persistence 的 update 监听者必须自捕获异常（与 ADR-0007「Runtime 自有 observer 必须记录或异步上报」义务同源），否则 wedge doc 后 materializeRoot 永拒。
- **E202 消息措辞（R2/#8）**：「本函数零写入（doc 状态不因本调用改变）」——窗口 A 语境下比「doc 零写入」更精确（外层事务挂起写入非本函数所为）；RT-2/RT-3 stateBytes 断言锚定。
- **§7.1 测试规格（R2/#2，SA6 落地）**：RT-1 重叠联合正/负四用例（RT-1.4 负对照须**嵌套**形态——顶层覆写属 ⑤ 身份面）/ RT-2 窗口 B 拒绝 + afterAllTransactions 对照 / RT-3 窗口 C fail-closed 三形态 / RT-4（可选）wedge characterization / RT-5（可选）不可扫描绝不假成功 / RT-6 收紧 T-1 正则 `/DOCRT-E202/`；文件均在 ALLOW LIST。

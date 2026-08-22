# 相关决议 (Relevant Decisions) — 全链 SA 复用（修订轮 rev1）

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 被审对象：`wiki/raw/task_doc-runtime-materialize-root-rev1.md`（PR #84 owner Review 修订轮 rev1，issue #74 / materializeRoot）
> 冲突基准：`docs/adr/0001`–`0007` 共 7 份（全量读取，无抽样；无 superseded 条目）+ `CONTEXT.md`
> ADR 状态一览：0001–0007 全部 accepted（0001、0006 含 owner 裁决放行的修订节，修订节取代关系已在文内声明，以修订后文本为准）。
> 修订轮语境：本任务在前轮已实现基线（SA1 设计 D1–D10 / SA3 实现）之上闭环 owner Review 反馈；RAC-1 与 RAC-3 涉 ADR-0007 / ADR-0003 契约语义，是本轮裁决焦点（裁决见 `_conflict_report.md`，本文只列约束）。

## 相关 ADR

### ADR 0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted）——本轮直接上游（RAC-1/RAC-2/RAC-4/RAC-5 全部落位于此）

- 与本任务的关联点：RAC-1 裁决 `materializeRoot` 的 `ok:true` 成功语义（observer 同步重入不抛错修改 ROOT）；RAC-2 补 detached 构造失败零写入证明；RAC-4 用 `extractYjsSnapshot` 做物化后完整语义比较；RAC-5 收紧 observer 抛错测试——四条全部落在本 ADR 冻结的入口条款与失败边界上。
- 核心条款（原文摘录）：
  - 「`materializeRoot(derived, snapshot, doc)`：唯一公共物化入口；内部先执行 `validateLogicalSnapshot`，再构造未集成到任何 doc 的 detached Yjs 子树，确认目标 ROOT 为空后以一次 `Y.transact` 安装。验证或构造失败时目标 doc 零写入；不覆盖、不合并、不 fallback。」
  - 失败边界全文：「零写入承诺覆盖所有验证失败和 detached 构造失败。Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报。事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback。」
  - 「路径统一为 `readonly (string | number)[]`：map/object/Record 使用 string，Y.Array 使用 number；禁止点号字符串与 JSON Pointer。leaf、plain、XML 是不可下钻终态。XML string 与 Y.XmlFragment 只承诺语义等价 round-trip，不承诺字符串逐字相同。」
  - （mutation 条款，同款结果纪律）「成功只返回 `{ ok:true }`，不返回 snapshot、Yjs update 或内部类型。」
  - 「`extractYjsSnapshot(derived, doc)`：只读取固定 ROOT，严格验证实际 Yjs 载体并提取普通逻辑 ROOT；首个结构错误立即停止，不读取或验证 SCHEMA/META。」
  - 「`readLogicalValueAtPath(derived, doc, path)`：同步按路径读取，只转换目标子树；依赖 create/open/update 已建立并维持的结构不变量，普通读取不重复验证。」
  - 「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型；NamespaceRuntime/Registry 再映射成稳定的 create/open/mutation 上层错误。逻辑校验保留完整 issues，Yjs 结构与路径/操作错误 fail-fast。」
  - Runtime 编排边界（observer 纪律的归属层）：「NamespaceRuntime 将来按 namespace 串行化所有业务写入：轮到 mutation 时先检查 writable gate，同步调用 `applyValidatedMutation`，成功后立即调用 persistence `saveDoc` 标脏。业务调用方不得取得可写 Yjs 引用或绕过该入口；未来原始 Yjs update 必须另设受控验证通道。」
  - 「普通 open 必须依次完成 schema 编译、META 身份检查、ROOT 载体提取和逻辑校验；任一失败都不注册 Runtime，并释放底层 DocHandle。Registry 中存在的 Runtime 因而始终满足完整不变量。」
  - 「`validateSnapshot` 直接更名为 `validateLogicalSnapshot`，不保留兼容 alias；它只接受普通 JSON logical ROOT snapshot，不接受 Y.Doc/Y.Map/Y.Array。」
  - 依赖面：「`@nomicore/vfsl` 继续保持无 Yjs 依赖；持久层继续不理解 VFSL。新包 `@nomicore/doc-runtime` 依赖 `@nomicore/vfsl + yjs`」

### ADR 0003 求值器与派生 schema（accepted）——RAC-3 直接依据

- 与本任务的关联点：XML 运行时校验的**接受域下限**由本文冻结（「仅要求良构 XML」）；ROOT 顶端 Y.Map 固定；联合 any-of 与判别式非契约缓存约束物化构造遍历。
- 核心条款（原文摘录）：
  - 「`xml-fragment` 是结构树的**终态节点**：无 children、路径下钻守卫到此为止；JSON 快照中其值为 XML 字符串（与 `Y.XmlFragment.toJSON()` 投影一致），运行时校验仅要求良构 XML。不定义实参字段与 XML 结构的映射——实参字段为文档性质。」
  - 「每个模块必须恰好声明一个名为 `ROOT` 的别名（大小写是契约，`root` / `Root` 不算），且必须 **map 形**（clsOf = map：裸对象 / `YMap` / `Record` / 全 map 形联合）——ROOT 固定物化为 Y.Map，`YArray` / `YXmlFragment` 与标量形一律拒绝。……Yjs 映射为 `doc.getMap('ROOT')`。」
  - 「基础表示：`{ kind: 'union'; members: StructureNode[] }`；匹配语义 **any-of**（至少一个成员接受即接受——重叠成员不构成错误）；路径存在性为**任一成员出现即存在**」
  - 「判别式检测（派生）：存在一字面量字段在全体成员中两两互异 → 附非契约缓存 `discriminator`，O(1) 跳转；**缓存的缺失/存在不得改变任何可观测行为（含错误输出）**」
  - 「派生 schema 照搬 IR 的模块形状：别名表 + ref 节点 `{ kind: 'ref'; name }`；引用**不内联展开**，解析动作由包内共享解析器完成」

### ADR 0002 nomicore 是全新 yjs-server 重写，authority 完全出范围（accepted）

- 与本任务的关联点：「单事务提交」三步纪律是 materializeRoot 失败语义（失败 ⟹ 文档不变）的上游管线依据；修订轮不得借 RAC-1 引入任何 authority 式不变式复活。
- 核心条款（原文摘录）：
  - 「统一写入管线收敛为“结构 → 值 → 单事务提交”三步。」
  - 「旧系统既有的 authority 规则体系（`__authority__` manifest：enum / range / conditional / state-machine）**完全排除在范围外，不保留接口**」

### ADR 0006 Cordis 持久化插件与 doc 三条目内容布局（accepted，含 2026-08-21 createDoc/owner、2026-08-22 getStatus 修订节）

- 与本任务的关联点：三条目布局界定物化写入面（只写 ROOT 子树）；RAC-2/RAC-3 的「state 字节不变」断言覆盖整个 Y.Doc（SCHEMA/META 兄弟条目一并不动）；修订轮不得触碰持久层。
- 核心条款（原文摘录）：
  - doc 内容布局（三条目）：`SCHEMA`（信封）/ `META`（元信息）/ `ROOT`（数据根）
  - 「META/SCHEMA 作为 ROOT 的兄弟条目，天然在 validateSnapshot/validatePatch 的校验面之外（校验只作用 ROOT 子树）。」（注：此处 `validateSnapshot/validatePatch` 为 ADR 0007 更名前的历史措辞，现对应 `validateLogicalSnapshot` 等）
  - 「事务原子性由 Y.transact（单 update 单元）保证，store 无需多写事务。」
  - 「**持久层 = Y.Doc 的存储引擎（store + cache 一体）**，看得见 Y.Doc（结构、update 事件、state vector），看不见 schema 语义（VFSL/校验规则属引擎领地）。」

### ADR 0001 VFSL 文本是 schema 的唯一真相源（accepted，含 2026-08-19 目标态/阶段态、2026-08-21 `SCHEMA` 命名修订节）

- 与本任务的关联点：`SCHEMA`/`ROOT` 具名条目命名契约；修订轮全部改动是测试/实现/CI 与契约文档化，不引入 schema 文本与 codegen。
- 核心条款（原文摘录）：
  - 「VFSL 文本只作为运行时数据存在于文档的 `SCHEMA` 中」
  - 「信封在 doc 中的键名由 `__schema__` 改为 **`SCHEMA`**——与 `ROOT` 保持统一命名（doc 顶层两个具名条目：`SCHEMA` 信封 + `ROOT` 数据）。信封内部结构 `{lang, version, id, text}` 不变」

### ADR 0004 vfsl-protocol 类型协议包（accepted）——低相关

- 与本任务的关联点：编译期类型投影轨道，不约束运行时物化；唯一共享纪律是 ROOT 挂载点知识收敛位置。
- 核心条款（原文摘录）：
  - D5：「`VfslPathMap` 顶层键 = ROOT 的字段……ROOT 是 doc 级固定挂载点，挂载知识只出现在绑定实现的 `doc.getMap('ROOT')` 一处。」

### ADR 0005 投影生成管线（accepted）——无直接关联

- 与本任务的关联点：SchemaSource 接缝与生成器 CI 管线属 Phase 1 编译期轨道，与运行时物化修订无交集；列出仅为 ADR 盘点完整。

## CONTEXT.md 相关术语与惯例

- `零写入（zero-write）`：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」
- `逻辑快照校验（validateLogicalSnapshot）`：「对普通 JSON 逻辑 ROOT 快照运行完整值语义校验；不接收 Y.Doc / Y.Map / Y.Array，也不验证 Yjs 载体。创建前校验、迁移后体检、测试与管理端点共用该入口。」（_Avoid_: validateSnapshot）
- `ROOT`：「命名空间根别名的保留名（大小写是契约）：每个模块必须恰好声明一个 map 形的 `type ROOT = …`（裸对象 / `YMap` / `Record`），ROOT 固定物化为 Y.Map，Yjs 映射为 doc 根 `getMap('ROOT')`。」
- `标记类型（marker types）`：「`YMap` / `YArray` / `YPlainArray` / `YLeaf` / `YXmlFragment` / `Pattern`；tsc 视角恒等别名，引擎视角是 Yjs 物化语义标记。」
- `结构树（structure tree）`：「Yjs 物化语义（kind / storage / opaque），供路径下钻守卫；与值语义正交。」
- `方言（dialect）`：「`lang + version` 决定的 VFSL 语法子集与语义规格；一经发布冻结，引擎只增不改，未知方言 loud-fail 只读。」
- `判别联合（discriminated union）`：「字面量联合字段（如 `kind`）区分的变体；引擎自动识别判别字段并按变体验证。」
- `封闭对象（closed object）`：「子集内对象类型默认封闭：未声明字段拒绝。」

## 前序档案对照（非冲突基准，仅供复用检索）

> 边界提醒：wiki 档案与代码**不构成冲突基准**；冲突基准只有 ADR 全集 + CONTEXT.md。以下仅为本轮复用检索的导航。

- 初轮相关决议（ADR 摘录 + 设计新决策点 D1–D10 摘录）：`wiki/raw/task_doc-runtime-materialize-root_relevant_decisions.md`
- 初轮前置门禁（verdict=clear，6 条非冲突注意事项）：`wiki/raw/task_doc-runtime-materialize-root_conflict_report.md`
- 初轮设计后复审（verdict=clear，18 行明细 + 观察项 O1–O4；其中 #8/O3 即本轮反馈 #3 的同题前裁）：`wiki/raw/task_doc-runtime-materialize-root_design_conflict_report.md`
- 初轮设计基线：`wiki/raw/task_doc-runtime-materialize-root_design.md`（D1–D10 / INV-1~INV-9 / F1–F10 / U1–U13）
- rev1 设计：`wiki/raw/task_doc-runtime-materialize-root-rev1_design.md`（RD1–RD6 / INV-10 / F11；裁决见 `task_doc-runtime-materialize-root-rev1_design_conflict_report.md`，verdict=clear，W1/W2/W3 三红线全部落实）

## 设计引入的新决策点（SA8 设计后复审追加，rev1）

> 摘自 SA1 设计 rev1（决策总表 RD1–RD6 / 新增不变式 INV-10 / 新增失败类 F11）。
> 只登记与 ADR 条款有落位关系的新决策点，供 SA2/SA3/SA4/SA6 复用；不裁决，裁决见
> `task_doc-runtime-materialize-root-rev1_design_conflict_report.md`（verdict=clear）。

- **RD1 / ⑤ verifyInstall / INV-10 / F11（RAC-1 出口 A）**：`doc.transact` 正常返回后、`return {ok:true}` 前执行顶层完整性校验（`rootMap.size === entries.length` + 逐键 `get(key) === value` 双断言），任何偏离 ⇒ `throw DOCRT-E201`（不回滚、不补偿、不返回 ok:false；doc 保持 observer 留下的实际状态）；`ok:true` 语义 = INV-2（单事务提交）+ INV-10（返回时 ROOT 顶层与计划逐键同一）；契约载体仅 JSDoc，**零 ADR 修订**——ADR-0007 失败边界条款（「事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback」）的未定义空间延伸（W1 唯一相容 throw 形态）。
- **RD1 残余面登记（§2.3）**：嵌套就地修改（R-1）归 ADR-0007 observer 纪律治理；observer 抛错时 ⑤ 不运行、原异常优先（R-2，F10 冻结）；异步修改不在契约时点（R-3，时点=「materializeRoot 返回时」）；INV-2 澄清「恰 1 次 update」指本函数发起的事务（R-5）——与 ADR-0006「事务原子性由 Y.transact（单 update 单元）保证」相容。
- **RD2 构造失败零写入矩阵（C-1~C-8）**：先证 `validateLogicalSnapshot ok:true`，再证 ok:false + 恰 1 issue + 0 update + state 字节不变——ADR-0007「零写入承诺覆盖所有验证失败和 detached 构造失败」的直接验收锚。
- **RD3 attr-`"` 定谳**：有意的 materialization 约束（维持现状 + C-8/X-F9 双锚锁定）；接受域差异恰一处（DOCTYPE 两侧同拒）——ADR-0003「运行时校验仅要求良构 XML」是校验下限，校验域 ⊋ 构造域不违反条款（前置门禁裁决二方向一）；vfsl 校验侧零改动。
- **RD3/W2 语义比较器（§4.4，测试局部件）**：成功行断言 canonical 解析比较（属性按名排序 + 引号归一 + last-wins + 显式闭合归一），禁投影冻结断言——ADR-0007「XML string 与 Y.XmlFragment 只承诺语义等价 round-trip，不承诺字符串逐字相同」的测试化；逻辑失败行 `toEqual(direct.issues)` 透传锚定（ADR-0007「逻辑校验保留完整 issues」），构造失败行锁恰 1 issue（fail-fast）。
- **RD4/W3 全量语义比较（RAC-4）**：materialize → `extractYjsSnapshot` → 与输入逐域比较（union 三 variant / Record 键集 / Y.Array 逐元素含顺序 / leaf 标量 / XML 叶子经语义归一化比较器）+ 嵌套 plain object/array clone 隔离行为断言——ADR-0007 `extractYjsSnapshot` 入口的正用。
- **RD5 U13 收紧**：`toThrow('observer-boom')` + `observeCalls === 1` + 保留 updates===1 与「值未回滚」断言——ADR-0007 observer 抛错 fatal 条款（原始异常原样传播、不虚假回滚）的断言强化。
- **RD6 CI 存在性门禁**：ci.yml test job 追加 materialize-root 专项步骤（`--typecheck --passWithNoTests=false`）——无 ADR 治理面的纯工程门禁（ADR-0005 CI 条款属投影保鲜轨道，无交集）。
- **落位与文件面纪律**：ALLOW 4 文件（materialize.ts 唯一生产变更 / materialize-root.test.ts / ci.yml / doc-runtime package.json bump 0.1.2→0.1.3）；DENY 覆盖 `docs/adr/**`（零 ADR 修订）、`packages/vfsl/**`、xml-parse/carrier/resolve/extract、index.ts 导出面、persistence、vfsl-protocol/codegen——ADR-0007 依赖面条款（vfsl 无 Yjs 依赖、持久层不理解 VFSL）与「唯一公共物化入口」（E201 是 throw message 前缀，非导出实体）。

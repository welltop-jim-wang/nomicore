# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 被审对象：`wiki/raw/task_doc-runtime-materialize-root.md`（issue #74，`materializeRoot` 前置门禁）
> 冲突基准：`docs/adr/0001`–`0007` 共 7 份（全量读取，无抽样；无 superseded 条目）+ `CONTEXT.md`
> ADR 状态一览：0001–0007 全部 accepted（0001、0006 含 owner 裁决放行的修订节，修订节取代关系已在文内声明，以修订后文本为准）。

## 相关 ADR

### ADR 0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted）——本任务直接上游

- 与本任务的关联点：本任务实现的 `materializeRoot` 即本 ADR 在 `@nomicore/doc-runtime` 冻结的四个公共入口之一；任务简报 What-to-build 与 AC-1~AC-6 逐条源自本 ADR。
- 核心条款（原文摘录）：
  - 「`validateSnapshot` 直接更名为 `validateLogicalSnapshot`，不保留兼容 alias；它只接受普通 JSON logical ROOT snapshot，不接受 Y.Doc/Y.Map/Y.Array。」
  - 「`@nomicore/vfsl` 继续保持无 Yjs 依赖；持久层继续不理解 VFSL。新包 `@nomicore/doc-runtime` 依赖 `@nomicore/vfsl + yjs`，提供：」
  - 「`extractYjsSnapshot(derived, doc)`：只读取固定 ROOT，严格验证实际 Yjs 载体并提取普通逻辑 ROOT；首个结构错误立即停止，不读取或验证 SCHEMA/META。」
  - 「`materializeRoot(derived, snapshot, doc)`：唯一公共物化入口；内部先执行 `validateLogicalSnapshot`，再构造未集成到任何 doc 的 detached Yjs 子树，确认目标 ROOT 为空后以一次 `Y.transact` 安装。验证或构造失败时目标 doc 零写入；不覆盖、不合并、不 fallback。」
  - 「`readLogicalValueAtPath(derived, doc, path)`：同步按路径读取，只转换目标子树；……」
  - 「`applyValidatedMutation(derived, doc, mutation)`：同步完成当前 ROOT 结构/逻辑检查、在普通 JSON 副本中模拟 mutation、完整 ROOT 逻辑校验、detached 子树构造和单次 Yjs transaction；不公开可跨时间执行的 prepared mutation，避免 TOCTOU。」
  - 「路径统一为 `readonly (string | number)[]`：map/object/Record 使用 string，Y.Array 使用 number；禁止点号字符串与 JSON Pointer。leaf、plain、XML 是不可下钻终态。XML string 与 Y.XmlFragment 只承诺语义等价 round-trip，不承诺字符串逐字相同。」
  - 「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型；NamespaceRuntime/Registry 再映射成稳定的 create/open/mutation 上层错误。逻辑校验保留完整 issues，Yjs 结构与路径/操作错误 fail-fast。」
  - 「零写入承诺覆盖所有验证失败和 detached 构造失败。Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报。事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback。」
  - 「module/derived 递归深冻结后才允许未来跨 namespace 共享；本阶段不实现编译缓存，缓存生命周期留给 NamespaceRuntime/Registry。」
  - 「NamespaceRuntime 将来按 namespace 串行化所有业务写入：轮到 mutation 时先检查 writable gate，同步调用 `applyValidatedMutation`，成功后立即调用 persistence `saveDoc` 标脏。业务调用方不得取得可写 Yjs 引用或绕过该入口；未来原始 Yjs update 必须另设受控验证通道。」
  - 「普通 open 必须依次完成 schema 编译、META 身份检查、ROOT 载体提取和逻辑校验；任一失败都不注册 Runtime，并释放底层 DocHandle。」

### ADR 0003 求值器与派生 schema（accepted）

- 与本任务的关联点：ROOT 根别名约定决定物化子树顶端形状；YXmlFragment 不透明语义决定 XML 叶子的构造与校验方式；联合/引用表示决定构造时的结构遍历语义。
- 核心条款（原文摘录）：
  - 「每个模块必须恰好声明一个名为 `ROOT` 的别名（大小写是契约，`root` / `Root` 不算），且必须 **map 形**（clsOf = map：裸对象 / `YMap` / `Record` / 全 map 形联合）——ROOT 固定物化为 Y.Map，`YArray` / `YXmlFragment` 与标量形一律拒绝。……Yjs 映射为 `doc.getMap('ROOT')`。」
  - 「`xml-fragment` 是结构树的**终态节点**：无 children、路径下钻守卫到此为止；JSON 快照中其值为 XML 字符串（与 `Y.XmlFragment.toJSON()` 投影一致），运行时校验仅要求良构 XML。不定义实参字段与 XML 结构的映射——实参字段为文档性质。」
  - 「基础表示：`{ kind: 'union'; members: StructureNode[] }`；匹配语义 **any-of**（至少一个成员接受即接受——重叠成员不构成错误）；路径存在性为**任一成员出现即存在**」
  - 「派生 schema 延续 IR 全部纪律：纯数据、可 JSON 序列化、可内容哈希、不携带行列位置。」
  - 「派生 schema 照搬 IR 的模块形状：别名表 + ref 节点 `{ kind: 'ref'; name }`；引用**不内联展开**，解析动作由包内共享解析器完成」

### ADR 0002 nomicore 是全新 yjs-server 重写，authority 完全出范围（accepted）

- 与本任务的关联点：「单事务提交」是 materializeRoot 单次 `Y.transact` 安装的上游管线纪律；authority 规则不得以任何形式复活。
- 核心条款（原文摘录）：
  - 「统一写入管线收敛为“结构 → 值 → 单事务提交”三步。」
  - 「旧系统既有的 authority 规则体系（`__authority__` manifest：enum / range / conditional / state-machine）**完全排除在范围外，不保留接口**」

### ADR 0006 Cordis 持久化插件与 doc 三条目内容布局（accepted，含 2026-08-21/22 修订节）

- 与本任务的关联点：doc 顶层三条目布局界定 materializeRoot 的写入边界（只写 ROOT，SCHEMA/META 是兄弟条目、不在校验/物化面内）；本任务不得向持久层引入 VFSL 语义。
- 核心条款（原文摘录）：
  - doc 内容布局（三条目）：

    ```
    Y.Doc
    ├── SCHEMA   信封（lang, version, id, text）——遵循哪个 schema
    ├── META     元信息（Y.Map：docId, createdAt）——我是谁
    └── ROOT     数据根——内容本体
    ```

  - 「META/SCHEMA 作为 ROOT 的兄弟条目，天然在 validateSnapshot/validatePatch 的校验面之外（校验只作用 ROOT 子树）。」（注：此处 `validateSnapshot/validatePatch` 为 ADR 0007 更名前的历史措辞，现对应 `validateLogicalSnapshot` 等）
  - 「**持久层 = Y.Doc 的存储引擎（store + cache 一体）**，看得见 Y.Doc（结构、update 事件、state vector），看不见 schema 语义（VFSL/校验规则属引擎领地）。」
  - 「事务原子性由 Y.transact（单 update 单元）保证，store 无需多写事务。」

### ADR 0001 VFSL 文本是 schema 的唯一真相源（accepted，含 2026-08-19/08-21 修订节）

- 与本任务的关联点：doc 顶层具名条目命名契约（`SCHEMA` + `ROOT`）；materializeRoot 只允许写 `ROOT` 子树，不得触碰 `SCHEMA` 信封。
- 核心条款（原文摘录）：
  - 「VFSL 文本只作为运行时数据存在于文档的 `SCHEMA` 中」
  - 「信封在 doc 中的键名由 `__schema__` 改为 **`SCHEMA`**——与 `ROOT` 保持统一命名（doc 顶层两个具名条目：`SCHEMA` 信封 + `ROOT` 数据）。信封内部结构 `{lang, version, id, text}` 不变」

### ADR 0004 vfsl-protocol 类型协议包（accepted）——低相关

- 与本任务的关联点：编译期类型投影，不约束运行时物化；唯一共享纪律是 ROOT 挂载点知识的收敛位置。
- 核心条款（原文摘录）：
  - D5：「`VfslPathMap` 顶层键 = ROOT 的字段（`['assets', id, 'name']`，不是 `['ROOT', 'assets', …]`）；ROOT 是 doc 级固定挂载点，挂载知识只出现在绑定实现的 `doc.getMap('ROOT')` 一处。」
  - D3：「全部内容为类型空间产物……编译后为空模块，零依赖、零运行时代码」

### ADR 0005 投影生成管线（accepted）——无直接关联

- 与本任务的关联点：SchemaSource 接缝与生成器管线属 Phase 1 编译期轨道，不构成 materializeRoot（运行时物化）的约束；列出仅为 ADR 盘点完整。

## CONTEXT.md 相关术语与惯例

- `ROOT`：「命名空间根别名的保留名（大小写是契约）：每个模块必须恰好声明一个 map 形的 `type ROOT = …`（裸对象 / `YMap` / `Record`），ROOT 固定物化为 Y.Map，Yjs 映射为 doc 根 `getMap('ROOT')`。其余无人引用的别名是惰性积木，不进数据面。」（_Avoid_: 隐式根、汇点推导）
- `标记类型（marker types）`：「`YMap` / `YArray` / `YPlainArray` / `YLeaf` / `YXmlFragment` / `Pattern`；tsc 视角恒等别名，引擎视角是 Yjs 物化语义标记。」（_Avoid_: `YLEaf`、`yleaf` 等变体拼写——大小写是契约的一部分）
- `结构树（structure tree）`：「Yjs 物化语义（kind / storage / opaque），供路径下钻守卫；与值语义正交。」
- `逻辑快照校验（validateLogicalSnapshot）`：「对普通 JSON 逻辑 ROOT 快照运行完整值语义校验；不接收 Y.Doc / Y.Map / Y.Array，也不验证 Yjs 载体。创建前校验、迁移后体检、测试与管理端点共用该入口。」（_Avoid_: validateSnapshot——容易误解为可校验 live Yjs 文档）
- `零写入（zero-write）`：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」
- `派生 schema（derived schema）`：「求值器的产出：结构树、值 schema、路径索引的打包；与 IR 同纪律——纯数据、可 JSON 序列化、可内容哈希；别名按名引用（`ref`）保留，不内联展开（ADR-0003 §4）。」
- `判别联合（discriminated union）`：「字面量联合字段（如 `kind`）区分的变体；引擎自动识别判别字段并按变体验证。」
- `封闭对象（closed object）`：「子集内对象类型默认封闭：未声明字段拒绝。」
- `方言（dialect）`：「`lang + version` 决定的 VFSL 语法子集与语义规格；一经发布冻结，引擎只增不改，未知方言 loud-fail 只读。」

## 设计引入的新决策点（SA8 设计后复审追加，2026-08-22）

> 摘自 SA1 设计 `wiki/raw/task_doc-runtime-materialize-root_design.md`（决策总表 D1–D10 / 不变式 INV-1~INV-9）。
> 只登记与 ADR 条款有落位关系的新决策点，供 SA2/SA3/SA4 复用；不裁决，裁决见
> `task_doc-runtime-materialize-root_design_conflict_report.md`。

- **D1 崩溃边界切分**：①②③（validate / detached 构造 / ROOT 探针）共享 `DOCRT-E200` 单 issue 结构化返回；④ 事务阶段排除在一切 try/catch 之外，异常**原样抛出**（INV-5：不吞并、不伪装返回值、不清理已写内容）——ADR-0007「事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback」的入口级诠释。
- **D2 logical 失败 issues 引用零损透传**：同源引用直传（含 100 条上限/截断标记/E100 形态，不重包装）——ADR-0007「逻辑校验保留完整 issues」。
- **D3 复用 `carrier.ts` 的 `probeRoot` 四级探针（零修改）**；ROOT 异型载体（非 Y.Map）与 ROOT 非空均为单 issue fail-fast（F2/F3）——ADR-0003「ROOT 固定物化为 Y.Map，`YArray` / `YXmlFragment` 与标量形一律拒绝」+ ADR-0007「确认目标 ROOT 为空后……不覆盖、不合并、不 fallback」。
- **D5 union 构造试验**：递归构造尝试、首个成功成员胜（声明序）；判别式（discriminator）零读取（死数据）——ADR-0003 any-of +「非契约缓存，缺失/存在不得改变任何可观测行为」。
- **D6 / INV-9 往返域对称**：写侧构造期六词域拒绝（`bigint` / `non-finite number` / `undefined` / `non-plain object` / `function` / `symbol` + 内嵌 Y 类型），与 extract 读侧 `copyPlainValue` 同表——「只接受普通 JSON logical ROOT snapshot」契约的写侧执行，失败属 ADR-0007「detached 构造失败」预期面（单 issue、零写入）。
- **D7 XML 解析策略**：文本 span 逐字保留不解码实体；注释/CDATA/PI 以逐字 XmlText 承载；attr 值含 `"` 构造期拒绝；重复 attr last-wins——承诺面仍为 ADR-0007「只承诺语义等价 round-trip，不承诺字符串逐字相同」。
- **D8 `makeRefResolver` 自 extract.ts 纯移动至同包 `resolve.ts`**（实现逐字不变）——ADR-0003 §4「解析动作由包内共享解析器完成」。
- **D9 map 装配按快照键迭代**（与 extract 按声明字段迭代方向相反的显式不对称；封闭形未声明键 = 单 issue 拒绝，不静默丢键）。
- **D10 / INV-2 恰一事务**：单 `doc.transact` 合并全部 set 为 1 个 update 单元（ADR-0006「事务原子性由 Y.transact（单 update 单元）保证」）；entries 为空 = 合法零写入成功（0 update、`ok:true`）。
- **落位与依赖纪律**：全部改动收敛于 `@nomicore/doc-runtime`（materialize.ts / xml-parse.ts / resolve.ts 新建 + index.ts / extract.ts 修改）；零新依赖（仅既有 `@nomicore/vfsl + yjs`）；vfsl / persistence 零触碰（§10 DENY LIST）——ADR-0007 依赖面条款。

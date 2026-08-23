# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 被审对象：`wiki/raw/task_doc-runtime-atomic-root-replace.md`（Issue #88，功能开发，Phase 0 前置门禁）
> 冲突基准：`docs/adr/0001`–`0008` 全集（8 份，逐个全读，无抽样）+ `CONTEXT.md`
> 本任务速览：将 materialization 的 detached 构造能力收敛为 `@nomicore/doc-runtime` 包内可复用 seam，并提供保留顶层 `doc.getMap('ROOT')` identity 的原子内容替换能力——即 ADR-0008「必要的底层演进」第 3 条的直接落实。

## 相关 ADR

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted，2026-08-23）

- 与本任务的关联点：**本任务的直接授权来源**。「必要的底层演进」第 2、3 条即本任务范围；SCHEMA write 第 3/4 步定义了替换能力的行为契约（identity 保留、单 transaction、零写入）。
- 核心条款（原文摘录）：

  底层演进（本文「必要的底层演进与实施顺序」节）：
  - 「Runtime 实现前先完成以下 `@nomicore/doc-runtime` 契约演进：」
  - 「1. `readLogicalValueAtPath(derived, doc, path)` 改为 schema-independent 的 `readLogicalValueAtPath(doc, path)`；」
  - 「2. transaction helper 提供 committed-aware branded fatal contract；」
  - 「3. SCHEMA replacement 可复用 detached builder 与原子 ROOT-content replacement helper，不复制 materialization 逻辑。」

  SCHEMA write 槽内步骤（本文「ROOT write 与 SCHEMA write」节）：
  - 「1. 编译 proposed SCHEMA 并构造新 tools；」
  - 「2. 未提供 `root` 时，按 proposed derived 严格提取并验证当前 ROOT，证明逻辑值与实际载体均已兼容；」
  - 「3. 提供 `root` 时，将其视为最终完整 logical ROOT snapshot，验证并 detached 构造完整新内容；」
  - 「4. 在一个 transaction 中原子替换 SCHEMA 与必要的 ROOT generation；」
  - 「5. transaction 返回后立即安装新 active tools，再 `await notifyDirty()`。」

  ROOT identity 与原子替换语义：
  - 「SCHEMA 是顶层具名 Y.Map。成功替换时在 transaction 内 `clear()` 后写入恰好 `lang/version/id/text` 四个字符串键。提供完整 ROOT 时保留顶层 `doc.getMap('ROOT')` identity，在同一 transaction 内清空并安装已 detached 构造的内容；其下旧 Yjs 子类型 identity 可失效。不提供 ROOT 时不修改 ROOT，也不破坏其 identity。」
  - 「新 SCHEMA 的编译、最终 ROOT 校验或 detached 构造失败均发生在 transaction 前，SCHEMA/ROOT 零写入，active tools 不变。读取在准备期间继续观察旧 committed generation；transaction 后才观察新 SCHEMA/ROOT，且 active identity同步切换。」

  ROOT write 管线（同一 detached 构造的另一消费方）：
  - 「ROOT write 依赖 active schema tools。没有可用 schema 时零写入失败；否则每笔写按 ADR 0007 的 validated mutation 管线检查当前 ROOT、模拟并校验完整 proposed ROOT、detached 构造并单事务提交。」

  sequencer 槽顺序（替换 helper 的调用语境）：
  - 「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务。」

  committed-aware no-rollback 契约（本文「Fatal 与失败通道」节）：
  - 「`@nomicore/doc-runtime` 必须提供 branded `DocRuntimeFatalError`，至少包含 `committed` 与稳定 `phase`。任何 internal fatal——无论 committed 与否——都永久关闭该 Runtime 的全部写能力并保留读取：」
  - 「- `committed:false` 不调用 dirty notifier；」
  - 「- `committed:true` 或未知异常保守视为可能已提交，在当前槽内 best-effort `notifyDirty()`，但始终 reject 原始 fatal；」
  - 「- 不补偿、不 fallback、不声称 rollback；」
  - 「- post-commit fatal 以带 `committed:true` 的稳定 `RuntimeWriteFatalError` reject，上层不得自动重试非幂等写；」

  封装边界（本任务 AC「不作为业务公共 API 暴露」的上游依据）：
  - 「Runtime 不公开 handle、Y.Doc、ROOT/SCHEMA/META live 引用或生产构造器。」

### ADR-0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted；Runtime/open/read 条款被 ADR-0008 部分取代）

- 与本任务的关联点：**本任务的核心行为基准**。其取代范围节明文划定：detached materialization、validated mutation、零写入与 observer no-rollback 的底层决策继续有效。materializeRoot 是 detached builder 的第一个消费方；替换能力是第二个，二者不得复制构造规则。
- 核心条款（原文摘录）：

  取代范围（本文「ADR 0008 取代范围」节）：
  - 「ADR 0008 取代本文 schema-aware `readLogicalValueAtPath(derived, doc, path)` 以及“普通 open 完成 schema 编译、META 检查、ROOT 提取和 logical validation 后才注册 Runtime”的 Runtime/open/read 条款。本文关于 logical validation、detached materialization、validated mutation、零写入与 observer no-rollback 的底层决策继续有效。」

  materializeRoot（Yjs bridge 节）：
  - 「`materializeRoot(derived, snapshot, doc)`：唯一公共物化入口；内部先执行 `validateLogicalSnapshot`，再构造未集成到任何 doc 的 detached Yjs 子树，确认目标 ROOT 为空后以一次 `Y.transact` 安装。验证或构造失败时目标 doc 零写入；不覆盖、不合并、不 fallback。」
  - （关联注记：materializeRoot 只安装到空 ROOT；清空并安装到非空 ROOT 是 ADR-0008 授权的替换 helper 的独立职责，二者共享底层构造规则。）

  applyValidatedMutation 与 prepared mutation 禁令：
  - 「`applyValidatedMutation(derived, doc, mutation)`：同步完成当前 ROOT 结构/逻辑检查、在普通 JSON 副本中模拟 mutation、完整 ROOT 逻辑校验、detached 子树构造和单次 Yjs transaction；不公开可跨时间执行的 prepared mutation，避免 TOCTOU。」

  mutation 整体替换语义（区分顶层与子类型 identity）：
  - 「- `set([])` 允许整体替换 ROOT；旧 Yjs 子类型引用失效，不做 identity-preserving diff。」
  - （关联注记：该条针对 mutation `set([])` 的子类型 identity；顶层 `getMap('ROOT')` identity 的保留要求由 ADR-0008 SCHEMA write 条款给出。）

  路径与载体：
  - 「路径统一为 `readonly (string | number)[]`：map/object/Record 使用 string，Y.Array 使用 number；禁止点号字符串与 JSON Pointer。leaf、plain、XML 是不可下钻终态。XML string 与 Y.XmlFragment 只承诺语义等价 round-trip，不承诺字符串逐字相同。」
  - 「- 当前 ROOT 已损坏时普通 mutation 失败，不承担 recovery。」

  失败边界（本文「失败边界」节，零写入 + observer no-rollback）：
  - 「零写入承诺覆盖所有验证失败和 detached 构造失败。Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报。事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback。」

### ADR-0006 Cordis 持久化插件与 doc 三条目布局（accepted；含 issue #64、#79 两节 owner 裁决演进修订）

- 与本任务的关联点：弱相关。确立 ROOT 在 doc 内容布局中的位置（数据根、SCHEMA/META 的兄弟条目）、Y.transact 单事务原子性、以及 save 失败不回滚的既定姿态——替换 helper 的单 transaction 语义与之一致。
- 核心条款（原文摘录）：
  - doc 内容布局（三条目）：「Y.Doc ├── SCHEMA 信封（lang, version, id, text）…… ├── META 元信息…… └── ROOT 数据根——内容本体」（示意原文见 ADR §「doc 内容布局（三条目）」代码块）
  - 「META/SCHEMA 作为 ROOT 的兄弟条目，天然在 validateSnapshot/validatePatch 的校验面之外（校验只作用 ROOT 子树）。」
  - 「- 事务原子性由 Y.transact（单 update 单元）保证，store 无需多写事务。」
  - 「**save 失败按 doc 只读降级，保留内存事务**：已校验并提交的事务立即进入 live Y.Doc 并正常同步；持久化是内部异步行为，失败不向触发该事务的客户端追溯报错、不通用回滚。」

### ADR-0004 vfsl-protocol 类型协议包（accepted）

- 与本任务的关联点：弱相关。D5 确立「ROOT 是 doc 级固定挂载点」——替换能力保留顶层 identity 与该心智模型同构。
- 核心条款（原文摘录，D5）：
  - 「`VfslPathMap` 顶层键 = ROOT 的字段（`['assets', id, 'name']`，不是 `['ROOT', 'assets', …]`）；ROOT 是 doc 级固定挂载点，挂载知识只出现在绑定实现的 `doc.getMap('ROOT')` 一处。」

### ADR-0003 求值器与派生 schema（accepted）

- 与本任务的关联点：detached builder 构造规则的上游依据——ROOT 固定物化 Y.Map、Yjs 映射 `doc.getMap('ROOT')`；YXmlFragment 终态不透明语义决定 XML 载体的构造/投影边界。
- 核心条款（原文摘录）：
  - 根指定：「每个模块必须恰好声明一个名为 `ROOT` 的别名（大小写是契约，`root` / `Root` 不算），且必须 **map 形**（clsOf = map：裸对象 / `YMap` / `Record` / 全 map 形联合）——ROOT 固定物化为 Y.Map，`YArray` / `YXmlFragment` 与标量形一律拒绝。……Yjs 映射为 `doc.getMap('ROOT')`。」
  - YXmlFragment：「`xml-fragment` 是结构树的**终态节点**：无 children、路径下钻守卫到此为止；JSON 快照中其值为 XML 字符串（与 `Y.XmlFragment.toJSON()` 投影一致），运行时校验仅要求良构 XML。」

### ADR-0001 VFSL 唯一真相源（accepted，含 2026-08-19 / 2026-08-21 修订）

- 与本任务的关联点：弱相关。命名修订确立 doc 顶层具名条目 `SCHEMA` + `ROOT` 的统一命名，替换能力只作用 ROOT 子树。
- 核心条款（原文摘录）：
  - 「信封在 doc 中的键名由 `__schema__` 改为 **`SCHEMA`**——与 `ROOT` 保持统一命名（doc 顶层两个具名条目：`SCHEMA` 信封 + `ROOT` 数据）。信封内部结构 `{lang, version, id, text}` 不变；设计文档（Feishu）中的 `__schema__` 表述以本修订为准。」
  - （注：doc 顶层条目全集以 ADR-0006 三条目布局为准，含 META。）

### ADR-0002 / ADR-0005

- ADR-0002（重写定位、authority 出范围）、ADR-0005（投影生成管线）：与本任务无直接条款交集，无约束摘录。

## CONTEXT.md 相关术语与惯例

- `ROOT`：「命名空间根别名的保留名（大小写是契约）：每个模块必须恰好声明一个 map 形的 `type ROOT = …`（裸对象 / `YMap` / `Record`），ROOT 固定物化为 Y.Map，Yjs 映射为 doc 根 `getMap('ROOT')`。其余无人引用的别名是惰性积木，不进数据面。」
- `信封（envelope）`：「顶层具名 `SCHEMA` Y.Map 中 `lang/version/id/text` 四个字符串键投影出的严格普通对象；兼容读取忽略额外键，规范写入以一次 transaction 清空并重写四键。信封可哈希、可 diff。」（SCHEMA 侧「一次 transaction 清空并重写」与 ROOT 侧原子替换能力同构，单 transaction 切换发生在同一事务内。）
- `命名空间（namespace）`：「一个 Y.Doc 连同自带的 `SCHEMA` 信封与数据；schema 随数据走，不依赖代码模块。」
- `逻辑快照校验（validateLogicalSnapshot）`：「对普通 JSON 逻辑 ROOT 快照运行完整值语义校验；不接收 Y.Doc / Y.Map / Y.Array，也不验证 Yjs 载体。创建前校验、写入前校验、迁移后体检、测试与管理端点共用该入口；普通 open/read 不重复校验已持久化 namespace。」
- `零写入（zero-write）`：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」
- `标记类型（marker types）`：「`YMap` / `YArray` / `YPlainArray` / `YLeaf` / `YXmlFragment` / `Pattern`；tsc 视角恒等别名，引擎视角是 Yjs 物化语义标记。」_Avoid_: 「`YLEaf`、`yleaf` 等变体拼写——大小写是契约的一部分」（测试覆盖「全部载体种类」时的拼写契约。）
- `结构树（structure tree）`：「Yjs 物化语义（kind / storage / opaque），供路径下钻守卫；与值语义正交。」
- `写序列器（write sequencer）`：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。」
- `active schema`：「NamespaceRuntime 当前安装、供 ROOT write 使用的已编译 schema tools 及身份；SCHEMA write 的 transaction 成功后同步切换，不等同于对 live SCHEMA 的即时读取。」
- `P0（schema preparation）`：「Runtime 发布前已进入写序列器队首的 schema 准备任务；只投影并编译 SCHEMA、构造 active schema tools，不读取或验证 ROOT。Runtime 发布后读取立即可用，早期写排在 P0 后。」
- `载体投影读取（readLogicalValueAtPath）`：「从 live Y.Doc 的固定 ROOT 按实际 Yjs/plain 载体和路径同步投影普通逻辑值；不依赖 VFSL/派生 schema，也不重复执行结构或逻辑校验。创建与受控写入负责建立并维持数据不变量……」

---

## 设计后复审追加：SA1 设计（D1–D11）引入的决策点（2026-08-23）

> Phase 2 复审时点追加。只登记设计与决议基准的锚定关系，裁决见
> `task_doc-runtime-atomic-root-replace_design_conflict_report.md`。
> 设计源：`wiki/raw/task_doc-runtime-atomic-root-replace_design.md`。

- **D1 公共接缝**：`replaceRootContent(derived, snapshot, doc)` → `{ok:true} | {ok:false; issues: ReplaceIssue[]}`，经 index.ts 导出；同步、可预期失败走结果联合（锚：ADR-0008「普通、可预期且零写入的读取或写入失败使用领域化结果联合」）；⓪/④/⑤/⑥ 的 throw（E202/E201）为唯一例外面（锚：ADR-0007 失败边界 + ADR-0008 no-rollback）。`ReplaceIssue.path` 为段数组（map/Record 用 string、Y.Array 用 number、`[]` 即 ROOT），锚 ADR-0007「路径统一为 `readonly (string | number)[]`……禁止点号字符串与 JSON Pointer」。
- **D2 builder 收敛为包内 seam**：新建 `detached-build.ts`/`tx-guard.ts`/`install-verify.ts`，自 materialize.ts 纯移动逐字不变；唯一导出 `buildTopEntries`；三模块不经 index.ts（锚：ADR-0008 演进第 3 条「可复用 detached builder……不复制 materialization 逻辑」；ADR-0007「不公开可跨时间执行的 prepared mutation」；materializeRoot 保持「唯一公共物化入口」的创建路径语义与公共契约零变化）。
- **D3 六阶段编排镜像**：⓪①②③④⑤⑥ 与 materializeRoot 同构；唯二差异 = ③ 无「ROOT 空置」判定、④ clear+install（锚：ADR-0008「清空并安装」的替换路径授权 vs ADR-0007 materializeRoot「确认目标 ROOT 为空后……不覆盖、不合并、不 fallback」的创建路径契约——职责二分）。
- **D4 单事务语义**：clear+install 在恰一个 doc.transact 内；对外 update 事件数 = 变更集非空 ? 1 : 0（锚：ADR-0008「在同一 transaction 内清空并安装」；ADR-0006「事务原子性由 Y.transact（单 update 单元）保证」）。
- **D5 顶层 identity 机制**：永不重建 ROOT 实例，原实例 clear 删键；旧子类型引用自然失效、无补偿性 diff（锚：ADR-0008「保留顶层 `doc.getMap('ROOT')` identity……其下旧 Yjs 子类型 identity 可失效」；ADR-0007「不做 identity-preserving diff」；CONTEXT.md ROOT「ROOT 固定物化为 Y.Map」）。
- **D6 嵌套调用裁决**：`replaceRootContent` 最外层事务语境专用，嵌套 → 写入前 throw DOCRT-E202 零写入；ADR-0008 SCHEMA write「同事务替换 SCHEMA 与 ROOT」由未来包内组合 seam 自开事务、消费 `buildTopEntries` 产物实现（不通过放开嵌套调用解决）；ADR-0008 演进第 2 条（committed-aware branded fatal contract）明确不在本任务建设（登记为后续前置项）。
- **D7/D8/D9 消息族与 issues 纪律**：E202 A/B 消息 `${api}` 插值（materializeRoot 侧渲染字节同一）；E201 沿用 generic 文案；逻辑失败 = `validateLogicalSnapshot` 完整 issues 引用透传、构造/载体失败恰 1 issue fail-fast（锚：ADR-0007「逻辑校验保留完整 issues，Yjs 结构与路径/操作错误 fail-fast」「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型」；CONTEXT.md 逻辑快照校验「写入前校验……共用该入口」）。
- **D10/D11 版本与依赖**：包版本 0.1.5 → 0.1.6（新增公共 seam）；零新第三方依赖，模块 DAG 无环（锚：ADR-0007「新包 `@nomicore/doc-runtime` 依赖 `@nomicore/vfsl` + `yjs`」的依赖边界不变）。
- **§12 边界纪律**：ALLOW 收敛于 `packages/doc-runtime`（三 seam + replace.ts + materialize.ts 瘦身 + index.ts + package.json + SA6 红灯测试）；DENY 覆盖 `docs/adr/**`（无 ADR 修订）、vfsl/persistence 等全部其余包（锚：ADR-0007 vfsl 无 Yjs 依赖、ADR-0006 持久层领地不触及）。

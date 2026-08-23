# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 被审任务：doc-runtime：schema-independent ROOT 载体投影读取（issue #86）。
> 冲突基准：`docs/adr/` 全部 8 份 ADR + `CONTEXT.md`（已全文逐一读取）。

## 相关 ADR

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted，2026-08-23；取代 ADR-0007 相应条款）

- 与本任务的关联点：本任务即落实其「读取能力」节与「必要的底层演进」第 1 条——AC 几乎逐条来自该节
- 核心条款（原文摘录）：

  读取签名与载体语义：
  - 「`readLogicalValueAtPath(doc, path)` 去掉 `derived` 参数，从固定 ROOT 按实际载体投影普通逻辑值」
  - 「`Y.Map` 使用 string segment，`Y.Array` 使用严格非负整数 segment；plain object/array 同理」
  - 「map/object 缺键或数组越界均成功返回 `undefined`，中间缺失立即结束」
  - 「plain object 仅读 own enumerable string data property，不走原型链、不执行 accessor」
  - 「plain subtree 仅允许 JSON-compatible plain value，禁止嵌套 Yjs shared type」
  - 「`Y.XmlFragment` 是不可下钻终态，返回语义字符串；未知 Yjs shared type响亮失败，不使用 `toJSON()` fallback」

  返回值与失败通道：
  - 「空 path 深拷贝完整 ROOT；非空 path 只转换目标子树；返回值是可变普通深拷贝，不做运行时冻结」
  - 「预期路径、载体和 lifecycle 失败使用同步结果联合，只有 internal bug 才抛异常」

  读取时机与编排（高频读取的依据）：
  - 「Runtime 获得并信任有效 `DocHandle` 后，在对外发布前把 P0 放入 write sequencer 队首，同时立即开放同步读取；读取不等待 P0 或任何写任务，也不进入 sequencer。普通 open 不执行 schema、ROOT 载体或 logical validation，持久化文件被其他程序错误修改不在本契约范围内。」
  - 「读取只观察调用瞬间已经提交的 live Y.Doc，不等待已接纳但尚未提交的写。调用方需要 read-your-write 时必须先等待对应写 Promise。」

  底层演进指令（本任务的直接来源）：
  - 「Runtime 实现前先完成以下 `@nomicore/doc-runtime` 契约演进：1. `readLogicalValueAtPath(derived, doc, path)` 改为 schema-independent 的 `readLogicalValueAtPath(doc, path)`」

  fatal 纪律（读取面关联：只有 internal bug 才抛）：
  - 「任何 internal fatal——无论 committed 与否——都永久关闭该 Runtime 的全部写能力并保留读取」

### ADR-0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted；Runtime/open/read 与 schema-aware 读取签名条款已被 ADR-0008 取代）

- 与本任务的关联点：`@nomicore/doc-runtime` 包的既有契约边界；本任务要修改的旧签名出自此处，其**未**被取代的路径纪律与终态条款继续约束读取实现
- 仍生效条款（原文摘录）：
  - 「`@nomicore/vfsl` 继续保持无 Yjs 依赖；持久层继续不理解 VFSL。新包 `@nomicore/doc-runtime` 依赖 `@nomicore/vfsl + yjs`，提供：」
  - 「路径统一为 `readonly (string | number)[]`：map/object/Record 使用 string，Y.Array 使用 number；禁止点号字符串与 JSON Pointer。leaf、plain、XML 是不可下钻终态。XML string 与 Y.XmlFragment 只承诺语义等价 round-trip，不承诺字符串逐字相同。」
  - 「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型」
  - 「普通读取成本与目标 path 子树规模相关」
  - 取代范围声明：「本文关于 logical validation、detached materialization、validated mutation、零写入与 observer no-rollback 的底层决策继续有效。」
- 已被取代的条款（不构成约束；本任务改掉的正是它）：
  - 「`readLogicalValueAtPath(derived, doc, path)`：本阶段冻结的 schema-aware 读取签名；已由 ADR 0008 取代为 schema-independent `readLogicalValueAtPath(doc, path)`。」

### ADR-0003 求值器与派生 schema（accepted）

- 与本任务的关联点：ROOT 物化与 YXmlFragment 终态语义是读取投影的地基——「固定 ROOT」「XML 终态」的出处
- 核心条款（原文摘录）：
  - 「每个模块必须恰好声明一个名为 `ROOT` 的别名（大小写是契约，`root` / `Root` 不算），且必须 **map 形**（clsOf = map：裸对象 / `YMap` / `Record` / 全 map 形联合）——ROOT 固定物化为 Y.Map，`YArray` / `YXmlFragment` 与标量形一律拒绝。检查位于 **parseVfsl 语义相位**……Yjs 映射为 `doc.getMap('ROOT')`。」
  - 「`xml-fragment` 是结构树的**终态节点**：无 children、路径下钻守卫到此为止；JSON 快照中其值为 XML 字符串（与 `Y.XmlFragment.toJSON()` 投影一致），运行时校验仅要求良构 XML。」

### ADR-0006 Cordis 持久化插件——DocPersistence 与 doc 三条目布局（accepted；含 issue #64 / #79 修订节）

- 与本任务的关联点：读取投影只作用于 ROOT 子树；SCHEMA/META 是兄弟条目，不在读取下钻范围内
- 核心条款（原文摘录）：
  - 「Y.Doc ├── SCHEMA 信封（lang, version, id, text）——遵循哪个 schema ├── META 元信息（Y.Map：docId, createdAt）——我是谁 └── ROOT 数据根——内容本体」
  - 「META/SCHEMA 作为 ROOT 的兄弟条目，天然在 validateSnapshot/validatePatch 的校验面之外（校验只作用 ROOT 子树）。」

### ADR-0004 vfsl-protocol 类型协议包（accepted）

- 与本任务的关联点：空路径语义的编译期镜像（概念一致；本任务不改动该包）
- 核心条款（原文摘录）：
  - 「`PathAt` 需含 `[]` 分支（空路径解析为根节点自身，`kindOf([])` → `'map'`）。」

### 不相关 ADR（已盘点，无约束条款触及本任务）

- **ADR-0001**（VFSL 唯一真相源）：约束 schema 文本来源、方言冻结与无机器标签；运行时读取不触及 schema 来源。其「运行时校验兑付『坏数据进不来』」条款作用于写入面，与「读取不重复校验」正交（ADR-0008 已定读侧契约）。
- **ADR-0002**（重写定位、authority 出范围）：统一写入管线「结构 → 值 → 单事务提交」属写入面；本任务为读取面。
- **ADR-0005**（投影生成管线）：编译期类型投影的生成与保鲜，非运行时读取。

## CONTEXT.md 相关术语与惯例

- 「**载体投影读取（readLogicalValueAtPath）**」（原文）：
  「从 live Y.Doc 的固定 ROOT 按实际 Yjs/plain 载体和路径同步投影普通逻辑值；不依赖 VFSL/派生 schema，也不重复执行结构或逻辑校验。创建与受控写入负责建立并维持数据不变量；持久化文件被其他程序错误修改不在运行时读取契约范围内。」
  _Avoid_: validated read、schema-aware read（会误解为读取时重新解释或校验 VFSL）
- 「**ROOT**」（原文摘录）：
  「命名空间根别名的保留名（大小写是契约）：每个模块必须恰好声明一个 map 形的 `type ROOT = …`（裸对象 / `YMap` / `Record`），ROOT 固定物化为 Y.Map，Yjs 映射为 doc 根 `getMap('ROOT')`。」
- 「**P0（schema preparation）**」（原文摘录）：
  「Runtime 发布前已进入写序列器队首的 schema 准备任务；只投影并编译 SCHEMA、构造 active schema tools，不读取或验证 ROOT。Runtime 发布后读取立即可用，早期写排在 P0 后。」
- 「**写序列器（write sequencer）**」（原文摘录）：
  「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。」
- 「**逻辑快照校验（validateLogicalSnapshot）**」（原文摘录）：
  「……创建前校验、写入前校验、迁移后体检、测试与管理端点共用该入口；普通 open/read 不重复校验已持久化 namespace。」
- 「**结构树（structure tree）**」（原文摘录）：
  「Yjs 物化语义（kind / storage / opaque），供路径下钻守卫；与值语义正交。」
- 「**标记类型（marker types）**」（原文摘录）：
  「`YMap` / `YArray` / `YPlainArray` / `YLeaf` / `YXmlFragment` / `Pattern`；tsc 视角恒等别名，引擎视角是 Yjs 物化语义标记。」

## 措辞对齐备注（中性观察，非裁决）

- 任务 AC3 写作「own enumerable data property」，ADR-0008 原文为「own enumerable **string** data property」——AC 少了「string」一词，语义方向一致（ADR 更严）。实现按 ADR 较严措辞执行即可（symbol key 等非 string 自有属性不读），不构成冲突。
- 任务标题「schema-independent」与 CONTEXT.md 该词条 Avoid 列表（validated read / schema-aware read）一致，命名合规。

---

## SA1 设计引入的新决策点（SA8 设计后复审追加，供 SA2/SA3/SA4/SA7 复用）

> 来源：`wiki/raw/task_doc-runtime-root-carrier-projection-read_design.md`（D1–D12 / E1–E18 / INV-R1~R12）。
> 以下均为 ADR 未明文的**边缘补充裁决**或**术语澄清**，非对 ADR 条款的改写；裁决一致性详见同目录 `_design_conflict_report.md`。

### 术语澄清（ADR-0007 × ADR-0008 的读法）

- ADR-0007「leaf、plain、XML 是不可下钻终态」中的 **plain** = 结构树 plain kind（`YPlainArray` 标记的整值语义，ADR-0004 D1「`YPlainArray` 只能整体替换（普通 JSON 值，非 Y.Array——标记语义边界）」），**不是** plain object 载体——同句前半「map/**object**/Record 使用 string」已确立 plain object 可下钻；ADR-0008「plain object/array 同理」延续该纪律。设计 D2 据此建模：plainObject/plainArray 为可下钻容器，scalar/xml/text/unknownShared 为终态。

### 设计补充裁决（ADR 沉默边缘）

- **E1/E2 undefined 吸收非对称**：Y.Map 显式 undefined 键与 plain object undefined 值键 → 吸收为缺席（ok:true undefined / 投影省略，与 yjs `toJSON()` 及 JSON 投影域一致）；**数组位置** undefined（含稀疏空洞）→ 响亮失败（位置语义不可省略）。
- **E4/E5/E6 键空间外 ≡ 缺席**：accessor 键、non-enumerable 键、原型链键导航命中均返回 ok:true undefined，零 accessor 执行（descriptor 读，INV-R4）；投影不产出（导航键空间 ≡ 投影键空间，INV-R11，同一 descriptor 助手 `readableOwnDataValue`）。
- **E7 导航借道**：AC4「plain 子树禁嵌 Yjs」作用于**投影期 plain 拷贝**，不限制导航期借道内嵌 Yjs 载体继续下钻——依据 ADR-0008「按实际载体」+「非空 path 只转换目标子树」。
- **E10/D10 循环引用**：plain 子图循环引用 → 无限递归 RangeError → 顶层 catch → E100 结构化返回；不增设 seen-set 预检（通道同形，message 非契约字段）。
- **D8/E100 崩溃边界**：一切异常（含 internal bug）顶层收编为 `{ok:false, code:'PATH_NOT_ALLOWED', message:'DOCRT-E100…'}`，同步零外抛（INV-R1）——ADR-0008「只有 internal bug 才抛异常」按**许可式**读法（该句划定「什么允许抛」，非「什么必须抛」）；与现网 read.ts 既有 E100 崩溃边界行为一致。
- **E8/E9 `__proto__` 键**：Y.Map 键与 plain object own enumerable `__proto__` 数据键正常读写，输出经 defineProperty 四真写入（防原型 setter 与事实冻结，INV-R7）。
- **E12 Y.XmlHook**（extends Y.Map）归 ymap 载体；**E15** 数字形 string 键（`'0'`）在 map/object 上按普通键直查，段从不解释（ADR-0007 路径纪律——「禁止点号字符串」禁的是路径编码形态，非含点号的键名）。
- **D9/INV-R9 ROOT 缺席**：`getMap` 惰性创建空 map，零 update 事件、幂等，视为空容器（空 doc `[]` → `{}`）。

### 范围与申报

- **D7 拷贝器分叉**：read.ts 新增独立 `copyPlainStrict`，不共享 extract.ts `copyPlainValue`——后者 plain object enumerable accessor 键经索引读**执行 getter**（设计探针 I 实测），与 ADR-0007「只读取固定 ROOT」的只读精神存在张力，设计将其申报为**已申报潜在缺陷**并 DENY extract.ts（修它改变已交付契约可观测行为，留独立任务）。
- **§6.2 测试退役**：7 个锚定被取代三参语义的遗留测试删除，通用守卫锚（非数组 path/零副作用幂等/-0/2^53）移植至新 guards 文件——AC7「调整调用面与行为测试」授权范围内。

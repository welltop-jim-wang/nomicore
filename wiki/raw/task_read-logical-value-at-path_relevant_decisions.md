# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 任务：`readLogicalValueAtPath(derived, doc, path)` 同步按路径读取 Yjs 子树逻辑值（Issue #75，feature）。
> 冲突基准：`docs/adr/` 全集（0001–0007，共 7 份，全部逐份读取）+ `CONTEXT.md`。

## 相关 ADR

### ADR-0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted，2026-08-22）

**与本任务的关联点**：本任务实现的能力 `readLogicalValueAtPath` 即本 ADR 在 `@nomicore/doc-runtime` 包中定义的四个公共能力之一——**直接治理 ADR**，任务简报全部验收条目均以其条款为依据。

核心条款（原文摘录）：

- 「`@nomicore/vfsl` 继续保持无 Yjs 依赖；持久层继续不理解 VFSL。新包 `@nomicore/doc-runtime` 依赖 `@nomicore/vfsl + yjs`，提供：」
- 「`readLogicalValueAtPath(derived, doc, path)`：同步按路径读取，只转换目标子树；依赖 create/open/update 已建立并维持的结构不变量，普通读取不重复验证。空路径表示显式读取整个 ROOT；合法 optional/Record/数组缺失返回 `undefined`。」
- 「路径统一为 `readonly (string | number)[]`：map/object/Record 使用 string，Y.Array 使用 number；禁止点号字符串与 JSON Pointer。leaf、plain、XML 是不可下钻终态。XML string 与 Y.XmlFragment 只承诺语义等价 round-trip，不承诺字符串逐字相同。」
- 「`extractYjsSnapshot(derived, doc)`：只读取固定 ROOT，严格验证实际 Yjs 载体并提取普通逻辑 ROOT；首个结构错误立即停止，不读取或验证 SCHEMA/META。」
- 「普通 open 必须依次完成 schema 编译、META 身份检查、ROOT 载体提取和逻辑校验；任一失败都不注册 Runtime，并释放底层 DocHandle。Registry 中存在的 Runtime 因而始终满足完整不变量。加载和更新负责验证，读取按 path 快速执行，不重复全树验证。」
- 「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型；NamespaceRuntime/Registry 再映射成稳定的 create/open/mutation 上层错误。逻辑校验保留完整 issues，Yjs 结构与路径/操作错误 fail-fast。」
- 「普通读取成本与目标 path 子树规模相关；首版 mutation 为正确性执行完整 ROOT 提取与逻辑校验，性能优化必须在行为等价测试下后续引入。」
- 「成功只返回 `{ ok:true }`，不返回 snapshot、Yjs update 或内部类型。」（注：此条约束 mutation；读取的返回形态以上方 readLogicalValueAtPath 条款为准）

### ADR-0003 求值器与派生 schema（accepted，2026-08-19）

**与本任务的关联点**：任务签名中的 `derived`（派生 schema）由本 ADR 冻结形状；路径下钻守卫、ROOT 物化、XML 终态语义均以其为地基。

核心条款（原文摘录）：

- 「每个模块必须恰好声明一个名为 `ROOT` 的别名（大小写是契约，`root` / `Root` 不算），且必须 **map 形**（clsOf = map：裸对象 / `YMap` / `Record` / 全 map 形联合）——ROOT 固定物化为 Y.Map，`YArray` / `YXmlFragment` 与标量形一律拒绝。……Yjs 映射为 `doc.getMap('ROOT')`。」
- 「`xml-fragment` 是结构树的**终态节点**：无 children、路径下钻守卫到此为止；JSON 快照中其值为 XML 字符串（与 `Y.XmlFragment.toJSON()` 投影一致），运行时校验仅要求良构 XML。」
- 「基础表示：`{ kind: 'union'; members: StructureNode[] }`；匹配语义 **any-of**（至少一个成员接受即接受——重叠成员不构成错误）；路径存在性为**任一成员出现即存在**；」
- 「派生 schema 照搬 IR 的模块形状：别名表 + ref 节点 `{ kind: 'ref'; name }`；引用**不内联展开**，解析动作由包内共享解析器完成」
- 「求值器的产出：……纯数据、可 JSON 序列化、可内容哈希、不携带行列位置」（派生 schema 纪律，见 §1「延续 IR 全部纪律」）

### ADR-0004 vfsl-protocol 类型投影（accepted，2026-08-19）

**与本任务的关联点**：编译期路径投影与运行时路径是**两个不同接缝**——本任务属运行时侧（ADR-0007），但 D5 的「路径不含 ROOT 前缀 / 空路径 = 根自身」与 D1 的 plain 数组边界为跨层一致性参照。

核心条款（原文摘录）：

- 「`VfslPathMap` 顶层键 = ROOT 的字段（`['assets', id, 'name']`，不是 `['ROOT', 'assets', …]`）；ROOT 是 doc 级固定挂载点，挂载知识只出现在绑定实现的 `doc.getMap('ROOT')` 一处。`PathAt` 需含 `[]` 分支（空路径解析为根节点自身，`kindOf([])` → `'map'`）。」（D5）
- 「`patch` 路径支持下标（`patch(['items','3','A','B','C'], v)`）：值类型经 `Record<\`${number}\`, 元素子树>` 精确投影；执行映射为 Yjs 粒度 set（保元素身份与协作光标）；越界归运行时校验」（D1——**类型层**下标为字符串，运行时（ADR-0007）Y.Array 用 number，两层各自独立）
- 「`YPlainArray` 只能整体替换（普通 JSON 值，非 Y.Array——标记语义边界）。」（D1）
- 「全部内容为类型空间产物……编译后为空模块，零依赖、零运行时代码」（D3——本 ADR 不含运行时约束）

### ADR-0006 Cordis 持久化插件与 doc 三条目布局（accepted，2026-08-21，含修订节）

**与本任务的关联点**：读取目标界定——`readLogicalValueAtPath` 空路径读取的是 ROOT 子树，不触 SCHEMA/META 兄弟条目。

核心条款（原文摘录）：

- doc 三条目布局：「`SCHEMA` 信封（lang, version, id, text）——遵循哪个 schema / `META` 元信息（Y.Map：docId, createdAt）——我是谁 / `ROOT` 数据根——内容本体」
- 「META/SCHEMA 作为 ROOT 的兄弟条目，天然在 validateSnapshot/validatePatch 的校验面之外（校验只作用 ROOT 子树）。」

### ADR-0001 VFSL 文本是 schema 的唯一真相源（accepted，2026-08-19 修订）

**与本任务的关联点**：背景约束——`derived` 的上游来源是 doc `SCHEMA` 信封的运行时编译产物，任务不触 schema 文本/脚手架纪律。

核心条款（原文摘录）：

- 「schema 用 VFSL（受限 TypeScript 子集 + 标记类型）+ JSDoc 语义标签描述，以信封 `{ lang, version, id, text }` 作为数据存进 doc 的 `SCHEMA`；解释行为由信封自述的方言版本决定，方言只增不改，未知方言 loud-fail 只读。」
- 「本仓库是纯引擎仓库：代码库不含 schema 文本（测试 fixture 除外）。」

### ADR-0002 / ADR-0005（accepted）

与本任务无直接关联（authority 出范围边界 / 投影生成管线），门禁盘点已覆盖，未摘录条款。ADR-0002 的「统一写入管线收敛为『结构 → 值 → 单事务提交』三步」属写入路径，与只读的 `readLogicalValueAtPath` 无交集。

## CONTEXT.md 相关术语与惯例

- **标记类型（marker types）**：「`YMap` / `YArray` / `YPlainArray` / `YLeaf` / `YXmlFragment` / `Pattern`；tsc 视角恒等别名，引擎视角是 Yjs 物化语义标记。」_Avoid_: 「`YLEaf`、`yleaf` 等变体拼写——大小写是契约的一部分」
- **结构树（structure tree）**：「Yjs 物化语义（kind / storage / opaque），供路径下钻守卫；与值语义正交。」
- **路径索引（path index）**：「路径 → 子 schema 的下钻索引，键匹配（exact / pattern）为标准能力。」_Avoid_: 「resolveChild 三级前缀匹配（被替换的旧机制）」
- **ROOT**：「命名空间根别名的保留名（大小写是契约）：每个模块必须恰好声明一个 map 形的 `type ROOT = …`（裸对象 / `YMap` / `Record`），ROOT 固定物化为 Y.Map，Yjs 映射为 doc 根 `getMap('ROOT')`。其余无人引用的别名是惰性积木，不进数据面。」_Avoid_: 「隐式根、汇点推导（被否决的根指定方案，ADR-0003）」
- **派生 schema（derived schema）**：「求值器的产出：结构树、值 schema、路径索引的打包；与 IR 同纪律——纯数据、可 JSON 序列化、可内容哈希；别名按名引用（`ref`）保留，不内联展开（ADR-0003 §4）。」_Avoid_: 「编译产物、DerivedSchema（英文代号）」
- **逻辑快照校验（validateLogicalSnapshot）**：「对普通 JSON 逻辑 ROOT 快照运行完整值语义校验；不接收 Y.Doc / Y.Map / Y.Array，也不验证 Yjs 载体。创建前校验、迁移后体检、测试与管理端点共用该入口。」_Avoid_: 「validateSnapshot（容易误解为可校验 live Yjs 文档）」
- **命名空间（namespace）**：「一个 Y.Doc 连同自带的 `SCHEMA` 信封与数据；schema 随数据走，不依赖代码模块。」
- **信封（envelope）**：「`SCHEMA` 键（doc 顶层具名条目，原 `__schema__`——与 ROOT 统一命名）里的 `{ lang, version, id, text }`；单字符串值，原子替换、可哈希、可 diff。」

---

## 设计引入的新决策点（2026-08-22 设计后复审追加）

> 摘自 `wiki/raw/task_read-logical-value-at-path_design.md`（SA1 设计，D1–D12）。只摘录，不裁决；一致性裁决见 `…_design_conflict_report.md`。以下决策点若被后续实现接受，即构成本任务族的既成约束。

### 新增跨包公共接缝（设计 D3 / §4.7）

- `packages/vfsl/src/index.ts` 追加公共导出：`compile as compilePattern` / `match as matchPattern` / `CompiledPattern`（源自 `pattern.ts`，行为零变化）——设计原文：「受限正则引擎公共接缝……doc-runtime readLogicalValueAtPath 的 Record 键许可判定与 validateLogicalSnapshot 同源消费」
- 设计理由摘录：「单一语义真相源……read 侧若用原生 RegExp，同一 Pattern 在两个接缝可以给出不同答案」「抗 ReDoS」「分层合法：ADR-0007 明文 `@nomicore/doc-runtime` 依赖 `@nomicore/vfsl`」
- 消费纪律：「per-call `Map` 缓存编译产物……编译失败与预算耗尽一律 throw → 崩溃边界 → C2 `PATH_NOT_ALLOWED` + message（fail-closed）」

### 包内复用接缝（设计 D7 / §4.6）

- `packages/doc-runtime/src/extract.ts` 的 `walk` / `makeRefResolver` 增加包内导出（≤8 行纯 export + JSDoc 注记：「包内复用接缝：read.ts 消费；不经 index.ts 公共入口」），逻辑零变化——doc-runtime 公共 API 面不扩大
- 理由摘录：「复制这 120 行闭环到 read.ts 必然产生第二转换实现，`extractYjsSnapshot` 与 `readLogicalValueAtPath([])` 对同一 doc 给出不同投影只是时间问题」

### 派生 schema 消费立场（设计 D2 / D3 / §4.2）

- 「导航权威 = 结构树 + makeRefResolver；`derived.index` 不参与路径导航」——依据：「索引在 union 成员与 ref 别名子树有结构性缺口（探针实证）」
- 「keyPattern 来源 = values 树锁步双游标；判定引擎 = vfsl pattern 引擎（公共导出）」——「结构树不携带 keyPattern、索引有缺口；values 树在每个 Record 物化位完整携带」
- DENY 约束：「`packages/vfsl/src/evaluate.ts` / `derived.ts` / `validate.ts` 及 `packages/vfsl` 其余源码——派生 schema 冻结形状与校验语义不动」

### 结果联合形态（设计 D5 / §3.1）

- `{ ok: true; value: unknown } | { ok: false; code: 'PATH_NOT_ALLOWED'; path: readonly (string | number)[]; message?: string }`
- 「`message?`：诊断增补字段（非契约字段，消费者不得依赖；C2/C3 类失败携带 DOCRT 前缀详情）」

### 失败单通道分类（设计 D6 / §3.2）

- C1「schema 不允许」（设计行为，契约内）／C2「不变量外活数据态」（防御性映射，ADR-0007 不变量前提下契约语境不可达）／C3「内部缺陷」（崩溃边界）——三类统一映射 `{ok:false, code:'PATH_NOT_ALLOWED', path, message}`；全函数体顶层 try/catch「绝不外抛」

### 缺键吸收式语义（设计 D8 / §4.4）

- 「路径中点缺 optional/Record 键、非负整数越界 → `value:undefined`，不再检验余下段（Phase A 已许可）」——前置门禁注记 A 的设计落地形态

### 两阶段模型（设计 D1 / §4.1）

- Phase A「纯 schema 许可判定，零 doc 访问」（presence-independent）／Phase B「活数据解析 + 定点转换」；两阶段各自重复段类型检查为既定成本

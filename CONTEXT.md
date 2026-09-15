# nomicore

全新 yjs-server 的重写仓库：以 VFSL（受限 TypeScript 子集 + JSDoc 语义标签）作为 namespace schema 的单一真相源，schema 作为数据存进 doc 的 `SCHEMA`，命名空间自包含、跨版本可解释。设计文档：[yjs-server Namespace Schema 自描述体系设计方案](https://welltop.feishu.cn/docx/MvtJdEr84ojlRTxbmsWcqHD8npg)。

## Language

**VFSL**:
受限 TypeScript 子集 + 标记类型构成的 schema 语言；同一段文本既是编译期类型源、又是运行期解释器输入。
_Avoid_: PathSchemaNode DSL、schema DSL

**方言（dialect）**:
`lang + version` 决定的 VFSL 语法子集与语义规格；一经发布冻结，引擎只增不改，未知方言 loud-fail 只读。

**信封（envelope）**:
顶层具名 `SCHEMA` Y.Map 中 `lang/version/id/text` 四个字符串键投影出的严格普通对象；兼容读取忽略额外键，规范写入以一次 transaction 清空并重写四键。信封可哈希、可 diff。

**原样封闭校验（provided-root as-is closed validation）**:
`replaceSchema` 提供 `root` 时，root 被视为完整最终 logical ROOT snapshot，**原样**送入封闭对象校验（validateLogicalSnapshot）与 detached 构造（buildTopEntries）——任何未声明键，无论顶层还是嵌套，一律响亮拒绝（`ok:false` + 指向该键的 issue，零写入）；不投影、不剥离、不合并。
_Avoid_: 顶层声明域投影（round 1 自创语义，已废止）、宽松合并（merge）、schema 演进迁移（migration 属上层语义，非本层职责）

**命名空间（namespace）**:
一个 Y.Doc 连同自带的 `SCHEMA` 信封与数据；schema 随数据走，不依赖代码模块。
_Avoid_: schema 注册表（`SCHEMA_REGISTRY` 是被替换的旧机制）

**空闲 Runtime（idle Runtime）**:
当前没有调用方租约、但仍由 NamespaceRegistry 暂时保留的 namespace Runtime；保留期内重新打开会复用同一 Runtime，保留期届满才关闭。fatal 或 persistence-degraded 只改变能力，不改变空闲保留语义。
_Avoid_: 已关闭 Runtime、无人引用即可立即销毁

**创建时间（createdAt）**:
namespace 创建提交时由生命周期层生成的 UTC ISO 8601 字符串，存于 `META.createdAt`；调用方不提供，Persistence 只保存而不解释或校验。
_Avoid_: Unix 时间戳、调用方自报创建时间

**schema 更新时间（schemaUpdatedAt）**:
当前 schema generation 成功安装的时间，UTC ISO 8601 字符串，存于嵌套 `META.schema` Y.Map 的 `updatedAt` 键（ADR-0017）：genesis 等于 `META.createdAt`（同一捕获时钟瞬间），此后每次成功的 `replaceSchema()` 在同一事务内推进（含语义等价/仅格式差异的替换——以事务提交为准，不据语义指纹推断）；经 `getActiveSchema().updatedAt` 公共投影暴露，legacy 命名空间（无 `META.schema` 载体）为 `null`（诚实缺席，不伪造派生）。它不是 namespace 创建时间，也不是 schema 内容的哈希。
_Avoid_: 复用 `META.createdAt` 充当 schema 安装时间、Unix 时间戳、本地接收时刻盖戳（peer 收敛的是 hub 起源值）

**Data**:
调用方在 namespace 中读写的、受 Schema 约束的业务事实。公共消费面以 `readData(path)` / `mutateData(mutation)` 表达最小、可合并且有语义的变更；`readData` 成功时同步返回值与其语义 schema 投影（ADR-0016）；Data 不包含 Schema 身份或 Metadata 生命周期事实。
_Avoid_: 把 Data 当成必须整体读写的 ROOT 快照、在业务代码中暴露 Y.Doc 载体

**语义 schema 投影（semantic schema projection）**:
路径键控的派生 schema 切片：路径终点的值 schema 子树（ref 按名保留）+ 传递闭包别名表 + 文档注释表的相关切片——`resolveSchemaAtPath` 的输出、投影文本渲染器的输入契约（ADR-0016；readData 交付形态由 ADR-0027 修订为投影文本，JSON 四件套退出公共读面）。它是路径键控而非值键控——值缺席时照常解析；无 active schema、路径偏离 schema 或静态无法解析时交付为 `null`，且 `null` 不是读的失败。预算下投影与值同 depth 裁剪：截断处的类型子树以投影层截断标记呈现（投影包装联合，不是 ValueSchema 语义联合的新 kind，也不是值域哨兵），标记携带成员级类型线索（ref 名优先，无 ref 名时容器 kind）；别名闭包随展开层收缩；注释切片按**可见性**收缩——docs 在场 ⟺ 位置在返回的预算类型树可见（已渲染宿主的槽位：字段 / `<item>` / `<member N>` / `<key>` 随宿主在场，字段级 docs 随物化的值同行），被截子树闭包内部（别名体成员注释、被截 ref 的 aliasDocs 与值域 docs）省略（ADR-0024 #359 amendment）；width 对投影无操作（投影是类型级，无实例键）。
_Avoid_: 把投影当作 live derived schema 的共享引用、把 `null` 当读失败、向载荷混入载体结构树词汇、预算读后期望全量类型口径（截断处成员口径须再访问）、期望被截 ref 的值域注释随行（闭包省略是刻意的——理解已交付枚举值的确切含义须再读一层）、把 JSON 四件套当 readData 交付物（交付形态是投影文本，ADR-0027）

**投影文本（projection text）**:
`readData` 成功分支 `schema` 位交付的、语义 schema 投影的确定性文本渲染（ADR-0027）：VFSL 风格文法——字段行 `名?: 类型 // 口径首行…`、标量域照源文法（`Int<…>` / `Pattern<"…">` / `"a" | "b"`）、别名块按闭包发现序、口径恒首行制；已渲染宿主的槽位注释全部在场（可见性切片），被截位以 `‡` 标记、容器线索无名时如实呈现；头行标注读路径与预算。截断事实（路径 / 裁因 / 省略计数）的唯一载体是文末 ✂ 段；`truncated` 布尔是"发生过裁剪"的机器信号。无 active schema、路径偏离 schema 或敌意 path 时为 `null`（单义沿用，非空串）。渲染器是 `@nomicore/vfsl` 的零选项纯函数，输出逐字节确定（快照锚定）。
_Avoid_: 把投影文本当可解析的结构化契约（它是呈现形态——程序化结构需求走仓内 resolver 直达）、期望全文注释随行（首行制是刻意权衡）、在 ✂ 段之外寻找截断事实（结构化清单键已退役）、`schema:null` × 预算读时在值内找键级裁剪辨析（该边界只剩 `truncated` 布尔——ADR-0027 已知限制）

**形状预算（shape budget）**:
`readData(path, options?)` 可选携带的读取形状约束：`depth`（自目标节点向下允许展开的容器层数，0 = 目标容器自身折叠为空容器）与 `maxChildrenPerNode`（每个被展开节点最多保留的子项数，超出部分省略）。预算在载体投影递归内生效——未展开分支零物化成本；不传预算 = 完整投影（既有行为，零截断）。预算只约束值的形状，不是 schema 通道开关：语义 schema 投影仍 always-on（交付形态为投影文本，ADR-0027）。预算护栏不是导航或分页手段（map 子项序为插入序，不承诺稳定）。预算的 width 是**护栏**而非选择器——有意义的 N 项选择（按序取前/后、按键或值属性排序）走窗口读（ADR-0028）。预算读的静态类型是 `DeepOptional<PathAt<…>>`（全字段可选形状）：必填字段的类型承诺只在无预算读成立。
_Avoid_: 把字节预算当形状预算的第三轴（字节是编码尺寸不是形状，见「字节预算」词条）、把预算读当分页 API、把预算参数误解为 schema opt-in（ADR-0016 拒绝的是后者）、对预算读的值使用非可选访问（必填承诺已不成立）

**字节预算（byte budget）**:
`readData`/`readArray`/`readMap` options 可选的交付总量上限：值通道（紧凑 JSON 规范度量）与投影文本字节的合计（✂ 段与头行自然计入）；超限零交付响亮拒绝（稳定码 `READ_BUDGET_EXCEEDED`，载荷含实测合计 `measuredBytes`），不裁剪、不降深度，成功交付物与无预算读逐字节相同。收/拒判定不塑形交付——控制形状与物化工作量用形状预算与窗口读；投影文本照常计量，缺席目标的读同样可能超限；跨三读面同码同文（ADR 0031）。
_Avoid_: 字节截断/字节裁剪（语义是拒绝不是修剪）、部分交付（可选裁剪模式是登记在案的演进位，非现行为）、把 maxBytes 当 depth/width 替身（总量闸与结构闸分工）、在 ✂ 段找字节事实（报错分支才是载体）、期望错误载荷拆分值/口径分项（现报合计）

**截断省略（truncation omission）**:
预算触发的值内截断形态按裁因分两种（ADR-0024 #359 amendment 对账）：**depth 耗尽**——被裁容器子项折叠为同形空容器、键在场（`{}` / `[]`），恒伴随一条截断事实（省略计数 = 被折容器直接子项数；真空容器折叠不记），终态子项（标量 / 语义字符串）不耗层、原样物化；**width 超限**——超出保留前缀的子项键省略（不出现在返回值中），父路径单条 width 事实。与缺席的消歧（ADR-0027 后以投影文本 ✂ 段为事实载体）：折叠壳在 ✂ 段 = 被裁（"这次没取"，可再访问补全，不是"数据为空"）；✂ 段无对应条目的空壳 = 真空数据；键缺席且不在 ✂ 段 = 真缺席。`schema:null` × 预算读时键级消歧不可用（只剩 `truncated` 布尔——ADR-0027 已知限制）。不引入"键在值 undefined"第三态（E1 吸收纪律不变）；无截断事实伴随的空壳占位仍禁止（与真空数据不可区分）。
_Avoid_: 无截断事实伴随的同形空壳占位（暗示"数据为空"且对必填字段类型撒谎）、魔法哨兵键（与合法数据不可区分）、把省略误读为数据被删除、把 depth 折叠壳当真空容器（✂ 段有对应 = 被裁）、期望结构化截断清单键（已退役，ADR-0027）

**截断事实段（truncation facts section，✂ 段）**:
投影文本文末的规范性段落，预算读截断事实的唯一载体（ADR-0027，取代 ADR-0024 的结构化截断清单通道）：逐条呈现被裁位置（path，与 readData 实参同基）、裁因（depth 耗尽 / width 超限）与省略计数（depth = 被折容器直接子项数，width = 超限子项数——不是后代总数，统计后代违背零物化承诺）。depth 条目尾段即被折叠容器的键名（该键在值内以空壳在场，条目是"空壳 = 被裁"的辨识）；width 只在父路径记一条，不逐键。✂ 段是"这次没取"的补全地图，不是数据删除记录；格式属投影文法规格（快照锚定）；无截断时 `truncated:false` 且段整体不出现。
_Avoid_: 条目携带被截容器内部的子键列表（职责归下一轮浅读）、把 ✂ 段当分页游标、以 ✂ 段缺席推断无截断（判读走 `truncated` 布尔）、在 ✂ 段之外寻找结构化截断键（已退役）

**窗口读（window read）**:
对 path 终点容器的确定性选窗读（ADR-0028），lease 公共面两个方法：`readArray`（序列容器：Y.Array 与 plain array，下标基）与 `readMap`（键容器：Y.Map 与 plain object，键基或值属性基）。`n` 必填且 ≥1（n=0 非法）。排序项（WindowTerm）= `by:'index'` / `by:'key'` / `field: 单段属性名` 携带 `dir`（asc 缺省）——方向永远挂在排序项上；readArray 缺省 `{by:'index'}`（asc = 自 [0] 取）、仅收 index 基，readMap 缺省 `{by:'key'}`、`'index'` 与多段 field 响亮拒绝。值 = **条目列表**（readArray 条目 `{index, value}`、readMap 条目 `{key, value}`，呈现序 = 有序基之序；身份随行可回溯原容器拼下一轮路径）。depth 为组合式：每个入选项等价于对该项路径的同预算 readData（标量原样、容器项 depth:0 折叠空壳、depth:1 第一层属性）；`maxChildrenPerNode` 只治理入选项内部——终点宽度由 n 治理。排序总序（**key/field 值基**的纪律）：number（数值序）→ string（码点序）→ 不可比组（缺失/null/布尔/容器）恒居序列尾（两方向窗口都先装可比项），平局按 key/下标 asc 恒定；index 基为**位置序**（排序键 = 下标本身，asc 自 [0]、desc 自尾部，元素值不参与选窗——issue #376）。schema 通道为元素口径投影文本（ADR-0027 形态）；窗口事实（kept/total + 基与方向）进 ✂ 段。目标缺席响亮失败（`WINDOW_TARGET_ABSENT`，不做缺席吸收）；载体不符 `WINDOW_CARRIER_MISMATCH`；规则非法 `WINDOW_OPTIONS_INVALID`。与形状预算的分工：预算的 width 是结构盲的护栏，窗口读是值感知的选择器；其谓词过滤词表演进（where）见「过滤窗口」。
_Avoid_: 把窗口读当分页 API（无 offset/cursor）、期望 insertion 基（不确定序不提供）、n=0 计数探针、readArray 传 field / readMap 传 by:'index'（v1 词表外响亮拒绝）、把 maxChildrenPerNode 当终点宽度（终点由 n 治理）、期望缺席吸收（窗口读对缺席报错）、期望容器壳出现在 value 里（窗口即结果）

**过滤窗口（filtered window read）**:
窗口读的词表演进（ADR 0029）：`readArray`/`readMap` options 可选 `where` 项——谓词项列表（v1 每项 `{field: 单段属性名, equals: 标量闭集 string|number|boolean|null}`，number 须 finite），**合取**语义（全部满足；空数组与超长数组响亮拒绝，同 field 重复合法），在选窗前过滤候选集（管线序 where → orderBy → n——"在匹配子集上选窗"，readArray 对称获得）。**匹配总数不承诺**（计数不可短路：位置序凑满 n 个即停 vs 计数须评估全部）：where 在场时结算 `total` 位为 undefined、✂ 段永不装配，`truncated` 退化为装满判定（`kept === n` = 可能还有；`kept < n` = 确定没有）；where 缺席时沿窗口读精确语义（total = 标识计数、truncated = kept < total、✂ 照旧）。field 缺席 / 值非标量 / non-finite / 不可下钻安静不匹配（脏项不挤掉正常项、不炸读）；谓词无领域语义——读侧选择机制，机制而非策略，不得援引为在 where 上生长规则引擎的先例。
_Avoid_: 查询 API / query / find 独立面（是窗口读词表，不是第四个方法）、期望匹配总数或计数探针（要计数给大 n；count 是独立演进位）、期望 ✂ 段或过滤槽呈现（where 在场永不装配）、把 where 当分页（after keyset 是备案演进位）、期望脏数据响亮失败（安静不匹配）、入参侧期望容忍 NaN/Infinity（响亮拒绝）、OR/NOT/in/范围/多段 field（v1 词表外响亮拒绝，均为备案演进位）

**变更订阅（change subscription）**:
NamespaceLease 上的键容器变更订阅（ADR 0030）：`watchMap(path, listener, { where? })` 建立订阅、返回幂等退订 handle，变更时收到**不含值的定位信号**——通知恒三 kind：`data`（`{path, key}` 定位符列表 + origin，同事务同 key 合并）、`invalidate-all`（溢出 / 父路径删除，订阅存活）、`watch-end`（schema 变更 / doc 替换，流末条）。谓词词表 `equals`/`in` 恒标量、缺失/null 恒不匹配；建立判定全部由 active schema 完成（无 active schema 整体不可用），**数据缺席合法**——订阅生命周期与数据在场性解耦，只与 lease 和 schema 耦合（读对缺席报错、订阅宽容等待）。判定纪律**宁多勿漏**（漏 = 消费方永久持有过时数据，不可接受；多 = 多拉一次）：通知条件 = 条目投影值真变（同值写的载体 delta 被语义比较过滤）∧ 无谓词或新旧匹配态任一成立或旧态不可判时保守通知；一事务一通知；挂点 = 写序列器事务提交后异步分发（本地写 / 复制 apply 全覆盖），回调 throw 静默隔离，有界队列溢出降级 `invalidate-all`（数值不进契约）。通知语义收窄为一句话承诺——「这个位置的条目状态可能与你所知不同」（不承诺方向——无 effect 分型；不承诺真变了——假通知容忍；不承诺序号——无 version / 基线对账）；v1 消费协议 = 建立后先全量拉一次、之后按 key 幂等拉终态自辨。`origin: 'local' | 'replication'`（self-echo 抑制）。
_Avoid_: observer（Registry 内部诊断 seam 撞词）、泛 watch / watchData / 订阅通知流（push / 推送 / 事件流——暗示含值或可靠投递，两者都不承诺）、把订阅当数据快照或增量日志（信号-only）、effect 分型 entered/left/changed（已否决——不承诺方向，消费方拉终态自辨）、version/rev 序号（已否决——丢失检测唯一信号是 invalidate-all）、把 watchMap 与 subscribeOwnedUpdates（raw Yjs bytes，可信 transport 专用）或诊断变更日志（离线观测）混用

**ROOT**:
Data 在 VFSL/Y.Doc 实现中的根载体保留名（大小写是契约）：每个模块必须恰好声明一个 map 形的 `type ROOT = …`（裸对象 / `YMap` / `Record`），并物化为 doc 根 `getMap('ROOT')`。ROOT 属于 schema、生成器和运行时实现词汇，不进入普通 namespace 消费接口。其余无人引用的别名是惰性积木，不进数据面。
_Avoid_: 隐式根、汇点推导（被否决的根指定方案，ADR-0003）、用 `mutateRoot` 暴露实现载体

**标记类型（marker types）**:
`YMap` / `YArray` / `YPlainArray` / `YLeaf` / `YXmlFragment` / `Pattern`；tsc 视角恒等别名，引擎视角是 Yjs 物化语义标记。
_Avoid_: `YLEaf`、`yleaf` 等变体拼写——大小写是契约的一部分

**挂载锚位（mount anchor）**:
文档注释（`/** */`）挂靠的声明性节点位置，共四类：类型别名（M1，声明处）、属性（M2，对象字段处）、标记类型（M3，记号处）、联合成员（M4，前导 `|` 记号或首成员起始记号；ADR 0019）。挂载是纯文档性质：doc 进 IR/派生表/生成物/投影切片（发射位与界线见 ADR 0019 决策 6——`YPlainArray` 纯值子树与 `YXmlFragment` 不透明实参内无发射位），但不进校验与物化语义（ADR 0001）。
_Avoid_: 把 M4 成员 doc 当校验或物化规则的输入（无机器标签）；把「锚位」误解为 tokenizer 实现细节（它是 v1-spec §5 的规范概念）

**结构树（structure tree）**:
Yjs 物化语义（kind / storage / opaque），供路径下钻守卫；与值语义正交。

**值 schema（value schema）**:
值类型语义：封闭对象、判别联合、字面量联合、pattern 约束、数值约束（整数性 `Int` / 闭区间 `Range<min, max>`）。

**路径索引（path index）**:
路径 → 子 schema 的下钻索引，键匹配（exact / pattern）为标准能力。
_Avoid_: resolveChild 三级前缀匹配（被替换的旧机制）

**求值器（evaluator）**:
把解析后的模块（IR）求解为派生 schema 的步骤；可失败（结果联合）——方言合法性与 ROOT 完整性在解析层已收口，求值期失败为资源预算等模式预留。
_Avoid_: 编译器（compiler）——该词留给「文本 → IR → 派生 schema」的组合入口（Phase 1 contract 包）

**派生 schema（derived schema）**:
求值器的产出：结构树、值 schema、路径索引的打包；与 IR 同纪律——纯数据、可 JSON 序列化、可内容哈希；别名按名引用（`ref`）保留，不内联展开（ADR-0003 §4）。
_Avoid_: 编译产物、DerivedSchema（英文代号）

**逻辑快照校验（validateLogicalSnapshot）**:
对普通 JSON 逻辑 ROOT 快照运行完整值语义校验；不接收 Y.Doc / Y.Map / Y.Array，也不验证 Yjs 载体。创建前校验、SCHEMA replacement/迁移后体检、管理端点（`set([])` 整体替换、replaceSchema provided-root 原样封闭校验）与测试共用该入口；普通 open/read 不重复校验已持久化 namespace；ordinary 非空路径写经路径级/边界级校验（ADR-0007 issue #237 修订节），不再为每次写执行完整 ROOT 校验。
_Avoid_: validateSnapshot（容易误解为可校验 live Yjs 文档）

**信封指纹（envelope fingerprint）**:
封闭四键 schema 信封 `{ lang, version, id, text }` 的身份；任一键变化都会改变，用于观察 namespace 当前信封是否变化。

**语义指纹（semantic fingerprint）**:
`lang + version +` 解析后规范 IR 的语义身份；忽略空白与普通注释，保留 JSDoc、声明顺序及其他 VFSL 语义，并排除仅作谱系标签的 `id`。用于共享编译语义产物。

**载体投影读取（readLogicalValueAtPath）**:
从 live Y.Doc 的固定 ROOT 按实际 Yjs/plain 载体和路径同步投影普通逻辑值；不依赖 VFSL/派生 schema，也不重复执行结构或逻辑校验。创建与受控写入负责建立并维持数据不变量——ordinary 写以 issue #237 phase-1 前置假设为条件归纳维持（mutation 前 committed ROOT 合法（logical values + carrier topology）+ 本次写保持其触达边界合法 ⇒ 写后全局合法；mutation 路径/边界之外的既存数据不被 ordinary 写扫描、复制或校验，见 ADR-0007 issue #237 修订节）；持久化文件被其他程序错误修改不在运行时读取契约范围内。
_Avoid_: validated read、schema-aware read（会误解为读取时重新解释或校验 VFSL）

**写序列器（write sequencer）**:
每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。
_Avoid_: mutation queue（范围过窄，容易让 SCHEMA/META 管理写建立旁路）

**P0（schema preparation）**:
Runtime 发布前已进入写序列器队首的 schema 准备任务；只投影并编译 SCHEMA、构造 active schema tools，不读取或验证 ROOT。Runtime 发布后读取立即可用，早期写排在 P0 后。

**active schema**:
NamespaceRuntime 当前安装、供 ROOT write 使用的已编译 schema tools 及身份；SCHEMA write 的 transaction 成功后（Hub）或复制 apply 槽的 schema re-arm 成功后（Peer）同步切换，不等同于对 live SCHEMA 的即时读取。

**schema re-arm（schema 热重装）**:
Peer 的复制 apply 槽在提交 SCHEMA 变化后同步执行的 schema 重装：编译新 SCHEMA、构造并原子安装 active schema tools，随后才 dirty/ACK；失败属 fatal 类（写永久禁用、读保留），Peer 主动关闭该 namespace channel。见 ADR 0018。
_Avoid_: hot reload、热更新（暗示不经写序列器的异步切换）、schema migration（本机制不变换数据）

**停接纳（stop-acceptance）**:
close 首次调用同步进入 `closing` 后，capability 槽立即停止接纳新调用：readData 同步结果联合返回 `RUNTIME_READ_DISABLED` 分支（lifecycle 失败不是路径缺陷，不借用路径失败码）；三个数据投影 getter（getSchema / getMetadata / getActiveSchema）与 readData 同属停接纳范围——同步 loud throw 稳定码 `RUNTIME_READ_DISABLED`（getter 返回类型非结果联合，拒绝通道为 throw；message 区分 getter 域与 lifecycle 值）；mutateData/replaceSchema 经 Promise settle 含 `RUNTIME_WRITE_DISABLED` 的零写入结果——该码与 fatal 后排队写、写前 writable gate（handle 非 ready：persistence-degraded / released / disposed）、notifyDirty 未绑定共用同一码族，message 文案区分域；close 前已接纳任务仍无条件排空。internal fatal 只永久禁写并保留读取，不触发 readData/getter 停接纳。getStatus 全生命周期可用（生命周期观测面，非数据投影），不在停接纳范围。
_Avoid_: 把 lifecycle 失败伪装成路径失败码、把停接纳误解为取消已接纳任务、把停接纳误读为 getStatus 不可用

**重建校验（rebuild validation）**:
单字段 patch 也在最近结构边界合并当前值后按完整子 schema 校验——判别联合只有看到判别字段才知道按哪个变体验。ordinary mutation 的最近必要语义边界（union 穿越位 / Record 位 / 数组位 / delete 父位 / set 目标位）与批量数组整体判定（values[]/count 一次重建，不逐元素）见 ADR-0007 issue #237 修订节。

**语义层（semantic layer）**:
JSDoc 首行自由文本 + `@tag` 半结构化标签；全部为文档性质，未识别仅 warn（无机器标签）。

**零写入（zero-write）**:
校验失败 → 400 且文档不变；所有写入口走同一条管线。

**原子变更（atomic mutation）**:
mutateData 的一次变更尝试可携带多个互不嵌套的操作（ADR 0026，批量信封 `ops`）：写序列器槽内逐操作预构建，任一失败整体零写入；全部成功则单事务按序提交——全有或全无。一个写槽对应一次变更尝试与一条诊断 update。各操作仍是最小 edit，原子性不以载体降级（整父替换）换取；单操作信封是现役契约形态，与批量形态互斥同拒。
_Avoid_: 事务（Yjs 事务是实现机制词汇，公共面词汇是原子变更）、多阶段命令拆写（无原子承诺的历史立场，已被批量信封替代）、整父替换换原子（破坏同步粒度与合并面）

**条件写（guarded mutation）**:
受控 ROOT mutation 信封的可选前置条件（ADR 0025；单操作与批量信封顶层均可携带，批内元素不得携带）：写序列器槽内、信封解析后、管线执行前，对指定路径的 committed 当前逻辑值断言——`equals`（结构深相等）或 `absent`（无值）；不满足则零写入拒绝（稳定码 `MUTATION_GUARD_MISMATCH`，可重试的竞争拒绝；guard 形状错误走无码信封校验拒绝，不可重试）。原子性来自写序列器 FIFO 独占，不来自 Yjs 事务。机制而非策略：引擎不含状态机/单调性等领域词表；复制 apply 与跨实例合并不受其约束。
_Avoid_: compare-and-swap 协议（这是本地受控写信封，不是 wire 协议）、规则引擎或 authority 复活（谓词无领域语义，策略在调用方）、事务内条件读（原子性归属写序列器）

**作用域绑定（DocScope）**:
每个命名空间绑定自己的方言解释器、规则集与编译缓存；多方言并存不需要进程级"当前版本"。

**判别联合（discriminated union）**:
字面量联合字段（如 `kind`）区分的变体；引擎自动识别判别字段并按变体验证。

**封闭对象（closed object）**:
子集内对象类型默认封闭：未声明字段拒绝。

**实例身份（Instance identity）**:
参与 Nomicore 复制拓扑的稳定、不可变实例身份，由安全文法 `instanceId` 与静态 `role`（Hub/Peer）组成；同一部署实例跨进程重启保持不变，是 Registry 与 transport 共同消费的单一身份事实。它不是 namespaceId、owner、SCHEMA id、connectionId、PID 或 hostname。
_Avoid_: 每次启动随机生成、Registry 与 transport 各自配置一份 role/instanceId、运行期切换身份

**服务表面（service surface）**:
经 `ctx.provide` 发布的 Cordis 服务对象（`nomicoreRegistry`/`nomicoreHubReplication`/`nomicorePeerReplication`/`clock`/`nomicoreInstance`/`nomicorePersistence` 等）。凡含函数成员的对象字面量形态服务，函数成员一律以访问器属性（getter 返回稳定闭包）构造并保留 `Object.freeze`，使消费方可以用返回包装闭包的 Proxy 合法包装（ECMA-262 `[[Get]]` 不变量只约束不可写不可配置数据属性，ADR 0023）；纯数据服务对象与 class 实例（原型方法）天然合规。服务方法返回的对象（lease/session 等）不是服务表面，不适用本纪律。
_Avoid_: 冻结对象字面量 + 数据属性方法（触发消费方 Proxy 不变量 TypeError）、为可包装性去掉 `Object.freeze`

**Hub（中心实例）**:
静态星型复制拓扑中接受 peer WebSocket 连接、转发 Yjs updates、管理 SCHEMA 与复制身份的完整 Nomicore 实例；Hub 也是可接受本地 ROOT 业务写的副本，不是 ROOT 唯一写者，也不表示自动选举的 leader。
_Avoid_: master、leader（会误示单写权威或选举语义）、只转发而不持有完整副本的中继

**Peer（边缘实例）**:
静态连接唯一 Hub 的完整 Nomicore 实例；使用独立 Persistence，断线时保持本地 ROOT 读写，重连后按 state vector/diff 与 Hub 双向合并。Peer 之间不直连，且不能本地修改 SCHEMA 或复制身份。
_Avoid_: slave、follower（会误示只读或被动复制）

**namespaceId**:
Registry entry 与实例复制 wire 的唯一 namespace 身份，普通 create 由受控 128-bit CSPRNG 生成 `ns-` + 32 位小写 hex；Registry 在当前进程内只以 namespaceId 排他索引。Persistence 仍用 owner.userId 分区，owner 是 open/create 的本地重要属性但不上 wire，也不参与复制身份；不同实例可为同一 namespaceId 使用不同 owner。
_Avoid_: 用户可读名称、由调用方任意指定的 ID、`(owner.userId, namespaceId)` Registry key、存储层严格全局唯一承诺

**复制谱系（replication lineage）**:
由 `META.replicationId` 标识的 namespace 复制身份；只有 namespaceId、replicationId 与 replication epoch 全部匹配的副本才允许直接执行 Yjs state-vector reconciliation。replicationId 是 128-bit 随机值的固定小写 hex，不等同于 namespaceId 或 SCHEMA 信封 `id`。
_Avoid_: 仅凭 namespaceId 判断同源、把 owner 纳入 wire identity、用 SCHEMA id 充当文档实例身份

**复制代际（replication epoch）**:
`META.replicationEpoch` 中从 1 开始、只由 Hub 显式提升的安全整数；相同复制谱系但 epoch 不同的副本进入冲突状态，必须显式 reset/bootstrap，不自动覆盖或合并。
_Avoid_: 连接次数、自动选主 term、可回绕版本号

**ReplicationSession**:
由 NamespaceLease 打开的受信任 duplex raw Yjs 复制会话；冻结本地角色、远端实例、复制谱系与 epoch，提供 state vector（`encodeStateVector`）、diff（`encodeDiff`）、owned update subscription（`subscribeOwnedUpdates`）和进入本地唯一 write sequencer 的 trusted apply（`applyRemoteUpdate`）、独立状态（`getStatus`）与幂等 close（`close`），但不暴露 live Y.Doc。每 Lease 至多一个活跃 session；`close` 或 epoch fence 后进入终态（closed/conflicted）并释放槽位；host 负责只把该高级能力交给可信 transport。fanout 投递有界队列溢出将 session 标记 `needs-resync`（sticky）——transport 须 reset/bootstrap。
_Avoid_: 裸 Y.Doc WS handler、绕过本地 write sequencer 的 apply、把网络状态塞进 Runtime capability status

**复制未校验（replication-unvalidated）**:
Trusted raw Yjs update 已在 sequencer 中提交并登记 dirty，但未执行完整 VFSL ROOT 预校验的复制状态；它可能留下文档路径/边界之外的非法数据——后续普通业务写按路径级/边界级校验工作：其导航路径与语义边界内的非法数据（不含被 set 整值替换的目标位旧值——该位由合法写入修复）仍会被响亮拒绝，触达面外的非法数据不再被普通写发现（ADR-0010 issue #237 修订节；合法性重建与 carrier 覆盖面审计已登记 follow-up）。不表示 transaction 可回滚或 raw update 享有 zero-write 保证。
_Avoid_: validated replication、apply 后校验失败自动 rollback

**分块复制传输（chunked replication transfer）**:
（ADR 0013 已接受；ADR 0022 扩展）超过单帧上限的复制载荷拆为多个自描述 `UPDATE_CHUNK` wire 帧的易失传输，kind 三态：live-update（ADR 0013，经 `CAP_CHUNKED_UPDATE` 协商）、snapshot（BOOTSTRAP_SNAPSHOT 基线）与 sync-diff（SYNC_STEP2 diff）（ADR 0022，同版本部署假设下的恒用机制、不新增协商面；发送端复用既有 `CAP_CHUNKED_UPDATE` 交集位做改道门，未协商组合保留既有终局码）；以 (连接, 方向, namespaceId, transferId) 为作用域，三种 kind 共用同一 transferId 计数器，接收端在有界 detached buffer 完整重组后执行一次 sequenced trusted apply（snapshot 为排他复制导入）并以单 ACK 结算。partial assembly 绝不写入 live Y.Doc，中断即丢弃并回退 state-vector reconciliation。
_Avoid_: 逐片 apply 到 live Y.Doc、跨重连保留 partial chunks、以提高单帧上限代替分块、把 transferId 当跨连接持久标识

**UPDATE_CHUNK**:
分块传输的单帧消息（wire 码 `0x42`），payload 自 ADR 0022 起恒为 kind 首字段单形态（kind 三态见「分块复制传输」；字段序与首 chunk 绑定块规则以协议 §10.3 为唯一权威，ADR 0013 的六字段旧形态随未发布分支作废）。codec 只做单帧无状态编解码与语义自洽校验，跨帧一致性/顺序/总量与重组属接收端 assembly 状态机——跨帧规则与 assembly 状态机为协议 §10.3 契约（issue #243–#245 落地、issue #246 收口），wire 权威见 `docs/protocols/instance-replication-v1.md`。
_Avoid_: 在 codec 层承载连接级 assembly 状态、把单个 chunk 当独立 UPDATE apply

**CAP_CHUNKED_UPDATE**:
HELLO 协商 capability bit `0x00000001`（uint32 BE bitset）；双方 optional 交集经 `selectedCapabilities` 生效。未协商端收到 UPDATE_CHUNK 必须按未知/未支持消息码规则以 connection fatal 拒绝——新旧实现互不破译（issue #242 / ADR 0013）。
_Avoid_: 把未协商的 0x42 帧当普通帧静默解码、未协商就发送分块

**同版本部署假设（same-version deployment）**:
Hub 与 Peer 按同版本部署运行、不承诺跨代际 wire 互通的部署前提（ADR 0022）；sync 段分块（kind=snapshot/sync-diff）因此不新增 capability 协商面即恒用启用（发送端复用既有 `CAP_CHUNKED_UPDATE` 交集位做改道门属纵深防御，非新协商面），跨版本混跑的非互破译由既有消息码/版本握手响亮拒绝承载。
_Avoid_: 为历史 wire 形态保留双形态切换或新增 capability、新旧互通矩阵测试

**实现代际（implementation generation）**:
端点的实现代际，与协议版本正交、**非 protocol 版本**语义——`envelopeVersion` 恒 1、HELLO `protocolVersions` 不因代际变化（协议 §3 两层版本独立）；代际差异仅在 HELLO capability 协商的 wire 位上可见。v1 代际 = 不含 `CAP_CHUNKED_UPDATE` 的旧实现（HELLO 恒发 `optionalCapabilities=0`，收到 `0x42` 帧按未知消息码 connection fatal 拒绝）；v2 代际 = 支持 `CAP_CHUNKED_UPDATE` 的现实现。协议 §22 互通矩阵按代际组合刻画回落行为（v1 peer ↔ v2 hub、v2 peer ↔ v1 hub、v2 ↔ v2 协商分块）。
_Avoid_: 把 v2 代际误读为协议版本 2 / 用代际推断 `envelopeVersion` 或 `protocolVersions` 变化

**实例角色（instance role）**:
实例身份中不可变的 hub/peer 拓扑角色；生产 composition root 配置一次，由 Instance service 同时提供给 Registry 与 transport。peer 实例的本地 replaceSchema/enableReplication/bumpReplicationEpoch 以稳定角色权限错误拒绝，session 的 localRole 必须等于实例角色。
_Avoid_: 运行期角色切换、Registry 与 transport 分别配置角色、peer 本地修改 SCHEMA 或复制身份
**namespace 诊断变更日志（namespace diagnostic change log）**:
从 namespace 创建开始尽力记录所有变更尝试及其结构化结局的可选 observability 流；连续的 committed Yjs updates 可用于诊断性重放，但日志不参与业务提交、不承诺完整性或恢复能力。
_Avoid_: 审计账本、WAL、event sourcing、可靠恢复日志

**变更尝试（change attempt）**:
一次可能修改 namespace 的请求及其结局；结局区分 committed、rejected 与 fatal，并标明 acceptance、capability gate、input snapshot、validation 等阶段。被拒请求也属于变更尝试，即使它从未读取输入或进入 transaction。
_Avoid_: 仅成功事务、统一 failed 事件

**诊断日志 stream generation**:
一个 namespace 的一代独立诊断日志，包含不可变 manifest、VFSL 校验的分段 JSONL records 与可选 framed binary sidecar；冻结格式或策略改变、旧 stream 损坏或无法安全续写时建立新 generation，各 generation 不自动拼接重放。
_Avoid_: Runtime generation、replication epoch、跨 generation 隐式连续日志

**语义 emission（semantic emission）**:
producer → 诊断日志 emitter 提交的 detached 语义结局——operation/stage/observedAt/source/context/result（update 以 owned bytes 表达），不含 streamId/sequence/segment/frameOffset/Base64/CRC 等物理表示（storage projection 归 adapter）。emit 同步、不 throw、不返回 durability promise、不留调用方可变引用（ADR-0011 interface 契约）；File adapter 首切片为每 record 至多一条 final JSONL record 的有界同步 append（携带 sidecar 时先一帧 BIN append）——可被文件系统延迟阻塞，任何接入 namespace 生命周期的调用点必须在 NamespaceRuntime write sequencer slot 之外或该 slot 释放之后；不维护 writer queue、不做 batch flush、无 fsync 开关、无常驻 fd（queue/batch/fsync/fd cache 为目标演进形态而非现行特性，ADR-0014-LOG 首切片 amendment 为权威）；快照与 updateBytes 所有权移交后不得再变异。update-omitted 稳定 reason 受控词表（v1）：`payload-too-large` / `update-capture-disabled` / `empty-update`——新增 reason 属词表演进，须过设计评审。
_Avoid_: 物理载体细节、append 后引用、durability promise

**storage projection**:
日志 adapter 独占的物理表示决策——先决定 inline/sidecar 并构造最终 record（segment/frameOffset/payloadLength/CRC32C/Base64），再运行 VFSL 校验；emitter 只做语义投影，不构造物理字段。
_Avoid_: 业务侧构造物理载体、emission 面物理键、VFSL 双 schema

**genesis baseline record**:
新 stream 的 genesis 基线——当时完整 Y.Doc 的 update，不是变更尝试（无 attemptId/operation/stage/result/input；顶层 `recordKind: 'genesis-baseline'` 判别）；v1 冻结的 emission/sink 公共面无构造路径，由 #152 adapter 内部构造（设计 §10-J1 备案）。
_Avoid_: attempt-started、result `'unknown'`、跨 stream genesis

**authority 规则**:
旧系统的 `__authority__` manifest（enum / range / conditional / state-machine 等不变式）。**本仓库范围外**（ADR-0002）。

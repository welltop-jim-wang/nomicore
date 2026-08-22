# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（task_issue-72，Issue #72：严格编译 SchemaEnvelope——双指纹与冻结产物）。
> 只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 摘录来源：`docs/adr/0001–0007`（共 7 份，全部 accepted，无 superseded）+ `CONTEXT.md`。

## 相关 ADR

### ADR-0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted）——本任务直接治理 ADR

- 与本任务的关联点：本任务实现的 `compileSchemaEnvelope` 正是该 ADR「逻辑层留在 `@nomicore/vfsl`」一节逐句定义的公共入口；验收标准几乎逐条对应其条款。
- 核心条款（原文摘录）：
  - 「新增纯函数 `compileSchemaEnvelope(input: unknown)`：输入必须是严格封闭且恰含 `lang/version/id/text` 的信封；按 envelope、dialect、parse、evaluate、internal 分阶段返回结果联合。」
  - 「编译成功产物包含冻结的 envelope、IR module、DerivedSchema、`envelopeFingerprint` 与 `semanticFingerprint`。」
  - 「指纹使用 SHA-256、UTF-8、canonical JSON 和带版本的 domain separation（`sha256:v1:<hex>`）。envelope fingerprint 覆盖四键；semantic fingerprint 覆盖 `lang + version +` 规范 IR，忽略空白和普通注释，保留 JSDoc、声明顺序及其他 VFSL 语义，并排除谱系标签 `id`。」
  - 「module/derived 递归深冻结后才允许未来跨 namespace 共享；本阶段不实现编译缓存，缓存生命周期留给 NamespaceRuntime/Registry。」
  - 「`@nomicore/vfsl` 继续保持无 Yjs 依赖；持久层继续不理解 VFSL。」
  - 「`validateSnapshot` 直接更名为 `validateLogicalSnapshot`，不保留兼容 alias；它只接受普通 JSON logical ROOT snapshot，不接受 Y.Doc/Y.Map/Y.Array。」（前置 #71 已合入 f07462d）
  - 「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型；NamespaceRuntime/Registry 再映射成稳定的 create/open/mutation 上层错误。逻辑校验保留完整 issues，Yjs 结构与路径/操作错误 fail-fast。」
  - 「普通 open 必须依次完成 schema 编译、META 身份检查、ROOT 载体提取和逻辑校验；任一失败都不注册 Runtime，并释放底层 DocHandle。」（下游消费方约束，本任务产物为其第一步）
- 实现注意（源自上述条款的推论，非新增决策）：
  - 五阶段顺序为 envelope → dialect → parse → evaluate → internal；
  - 「带版本的 domain separation」是对两种指纹共同的格式要求——`sha256:v1:<hex>` 中的 `v1` 即版本化前缀；envelope 与 semantic 两种指纹的域分离实现细节须在 SA1 设计中明确，不得只套任务简报的简化表述。

### ADR-0001 VFSL 文本是 schema 的唯一真相源（accepted，2026-08-19 修订 + 2026-08-21 命名修订）

- 与本任务的关联点：信封结构、方言冻结纪律、编译缓存的长期定位。
- 核心条款（原文摘录）：
  - 「解释行为由信封自述的方言版本决定，方言只增不改，未知方言 loud-fail 只读。」（dialect 阶段的裁决依据）
  - 「引擎必须在运行时解析任意合法方言文本，性能依赖按内容哈希的编译缓存。」（长期目标态；本票按 ADR-0007 阶段条款不实现缓存）
  - 「语义层**不设机器标签**……全部 JSDoc 标签（`@format` / `@role` / `@example` / `@values` / `@unit` / `@since` / `@deprecated` / `@entity` / `@key`）为文档性质，未识别仅 warn」（JSDoc 必须进入 IR 并影响语义指纹——「保留 JSDoc」条款的根基）
  - 命名修订：「信封在 doc 中的键名由 `__schema__` 改为 **`SCHEMA`**……信封内部结构 `{lang, version, id, text}` 不变」。

### ADR-0003 求值器与派生 schema（accepted）

- 与本任务的关联点：`compileSchemaEnvelope` 管线的 parse/evaluate 两段复用该 ADR 冻结的接缝与产物纪律；「保留原生 issues 数组」验收的依据。
- 核心条款（原文摘录）：
  - 「新增公共导出 `evaluate(module: VfslModule) → { ok: true; derived } | { ok: false; issues }`。派生 schema 延续 IR 全部纪律：纯数据、可 JSON 序列化、可内容哈希、不携带行列位置。」
  - 「检查位于 **parseVfsl 语义相位**——E310（缺 ROOT，锚模块起始）/ E311（ROOT 非 map 形，锚 ROOT 类型表达式起点）；行列锚定只有解析层做得到（IR 无行列是内容哈希纪律）。」
  - 「派生 schema 照搬 IR 的模块形状：别名表 + ref 节点 `{ kind: 'ref'; name }`；引用**不内联展开**」（深冻结时共享引用关系不得被复制破坏的结构根源——菱形引用链靠 ref 共享，深冻结不得内联复制）
  - 「evaluate 结果联合的 issues 形状复用 `VfslIssue`」
  - 「派生 schema 的形状变更须走设计修订流程（公共契约）」
  - 注：文中 `validateSnapshot` 字样已被 ADR-0007 更名为 `validateLogicalSnapshot`。

### ADR-0005 投影生成管线（accepted）

- 与本任务的关联点：方言身份 = `lang`/`version`；`id` 的语义定位（semantic fingerprint 排除 `id` 的依据）。
- 核心条款（原文摘录）：
  - 「**id 是标签不是键**：引擎正确性不依赖 id 唯一性（自包含设计消灭了注册表）；id 的用途是人读标签、管理端谱系追踪、工具链寻址。」
  - 「**返回完整信封**而非裸文本：`lang`/`version` 是方言身份；」
  - 「**消费方首动作 = 方言断言**（`lang==='vfsl' && version===1`，否则响亮失败）——方言冻结纪律焊进生成管线；」

### ADR-0006 Cordis 持久化插件（accepted，含 2026-08-21 修订节）

- 与本任务的关联点：弱相关——仅「DocScope 编译缓存」交会条款与 doc 三条目布局说明本任务产物的下游去处；本任务不触及持久层。
- 核心条款（原文摘录）：
  - 「与 DocScope（schema 编译产物缓存，H3）正交汇合：loadDoc → 读 SCHEMA → DocScope.getCompiled → 可校验」（本任务产物即 DocScope 未来缓存的 value；本票不做缓存）
  - doc 内容布局三条目：`SCHEMA` 信封（lang, version, id, text）/ `META` / `ROOT`。

### ADR-0002 nomicore 是全新重写、authority 出范围（accepted）

- 与本任务的关联点：边界确认——`compileSchemaEnvelope` 产物不得引入任何 authority 规则残留。
- 核心条款（原文摘录）：
  - 「旧系统既有的 authority 规则体系（`__authority__` manifest：enum / range / conditional / state-machine）**完全排除在范围外，不保留接口**」

### ADR-0004 vfsl-protocol 类型协议包（accepted）

- 与本任务的关联点：边界确认——编译期投影属协议包/生成器轨道，与本任务（运行时编译入口）生命周期分离。
- 核心条款（原文摘录）：
  - 「全部内容为类型空间产物……零依赖、零运行时代码」「不含生成器（票 F 职责）、不含工厂/默认值、不进引擎包。」

## CONTEXT.md 相关术语与惯例

- **方言（dialect）**：「`lang + version` 决定的 VFSL 语法子集与语义规格；一经发布冻结，引擎只增不改，未知方言 loud-fail 只读。」
- **信封（envelope）**：「`SCHEMA` 键……里的 `{ lang, version, id, text }`；单字符串值、原子替换、可哈希、可 diff。」
- **求值器（evaluator）**：「把解析后的模块（IR）求解为派生 schema 的步骤；可失败（结果联合）……」_Avoid_：「编译器（compiler）——该词留给『文本 → IR → 派生 schema』的组合入口（Phase 1 contract 包）」——`compileSchemaEnvelope` 即该组合入口，命名用 compile 合规；文档行文中不要把 parse/evaluate 各段称为「编译器」。
- **派生 schema（derived schema）**：「求值器的产出：结构树、值 schema、路径索引的打包；与 IR 同纪律——纯数据、可 JSON 序列化、可内容哈希；别名按名引用（`ref`）保留，不内联展开（ADR-0003 §4）。」_Avoid_：「编译产物、DerivedSchema（英文代号）」——散文用「派生 schema」；`DerivedSchema` 作为代码类型名沿 ADR-0007 原文使用。
- **逻辑快照校验（validateLogicalSnapshot）**：「对普通 JSON 逻辑 ROOT 快照运行完整值语义校验；不接收 Y.Doc / Y.Map / Y.Array……」_Avoid_: `validateSnapshot`。
- **信封指纹（envelope fingerprint）**：「封闭四键 schema 信封 `{ lang, version, id, text }` 的身份；任一键变化都会改变，用于观察 namespace 当前信封是否变化。」
- **语义指纹（semantic fingerprint）**：「`lang + version +` 解析后规范 IR 的语义身份；忽略空白与普通注释，保留 JSDoc、声明顺序及其他 VFSL 语义，并排除仅作谱系标签的 `id`。用于共享编译语义产物。」
- **作用域绑定（DocScope）**：「每个命名空间绑定自己的方言解释器、规则集与编译缓存；多方言并存不需要进程级『当前版本』。」——本任务「无模块级 cache」验收即为此预留：缓存归 DocScope/NamespaceRuntime，不进纯函数。
- **ROOT**：「命名空间根别名的保留名（大小写是契约）：每个模块必须恰好声明一个 map 形的 `type ROOT = …`……」（parse 阶段 E310/E311 的来源）
- **标记类型（marker types）**：「`YMap` / `YArray` / `YPlainArray` / `YLeaf` / `YXmlFragment` / `Pattern`……」_Avoid_:「`YLEaf`、`yleaf` 等变体拼写——大小写是契约的一部分」
- **零写入（zero-write）**：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」（本任务为纯函数，无写入面；列此备下游引用）

---

## 设计后复审追加（R1 设计引入的新决策点，SA2/SA3/SA4/SA7 复用）

> 来源：`wiki/raw/task_issue-72_design.md`（R1，2026-08-22）。以下均为设计在 ADR 自由度内作出的
> 冻结裁决，属设计契约；与 ADR 条款的对照结论见 `task_issue-72_design_conflict_report.md`。

### D1. 双指纹双域构造（N2 域分离的设计定式，§6.2 / §2.2）

- envelope 域文档 = 恰四键按 v1-spec §7 表序 `{lang, version, id, text}` 的紧凑 JSON（`envelopeFingerprintOf` 以字面量键序构造，不依赖传入对象键序）；
- semantic 域文档 = `{ domain: 'vfsl-semantic', lang, version, module }` 紧凑 JSON（module = 本次编译内 parseVfsl 刚产出的规范 IR 原样参与）；
- 域分离 = 构造性文档语言不相交：envelope 域首键恒 `"lang"`、semantic 域首键恒 `"domain"` ⇒ 两域哈希输入字符串恒不等，双指纹互异是构造性保证（非概率性）；
- 两指纹共用前缀 `sha256:v1:`（`FINGERPRINT_PREFIX`）；`v1` = 摘要算法 + 域文档形态的联合版本号，任一演进须升 `v2` 前缀；
- `SEMANTIC_DOMAIN_TAG`/`FINGERPRINT_PREFIX` 与两构造函数同址 `fingerprint.ts`（N2 单文件审计点）；**构造函数不上公共面**——指纹值（格式+摘要语义）是契约，构造函数不是接缝；
- 与 H3 `getCompiled` 缓存键（`sha256Hex(text)` 裸 hex 无前缀）三个哈希域两两不同源，互不冒用。

### D2. canonical JSON 的兑付范围声明（§6.1/§6.3/§6.5）

- 「canonical JSON」兑付为四层确定性：冻结键序（字面量构造）+ `JSON.stringify` 紧凑语义 + sha256 的 UTF-8 单射字节化（含 lone surrogate WTF-8 段）+ **单一生产者插入序不变式**（被摘要的 module 恒为本次编译内 parseVfsl 刚产出者，键序由构造点字面量固定）；
- **不引入 RFC 8785 排序序列化器**（多生产者键序归一收益被单一生产者不变式结构性排除）；
- 若未来出现第二生产者（如 IR 反序列化入指纹）或跨实现指纹互认需求，**必须先升域文档版本（v2 前缀）**——SA3/SA7 守卫点。
- **升级触发器清单（R2 登记，SA2 M2，2026-08-22，与设计 §6.3「D2 升级触发器」条同步）**：v2 方言若放开数值字面量语法（负号/小数点/指数任一），`JSON.stringify` 数值坍缩类（NaN/Infinity→`"null"`、`-0`→`"0"`）进入 IR 可达域、parser 归一化语义（如 `1e2`→`100`、`-0` 字面量）被 semantic 指纹层**静默继承** ⇒ **semantic 域文档必须重审并升 `v2` 前缀**，不得静默沿用 v1 摘要。v1 的安全性由两道既有闸门结构性保证：tokenizer 数字记号 `[0-9]+` 无符号十进制整数（`tokenizer.ts:200-214`）+ parser `Number.isFinite` 假值 E100 拒绝（`parser.ts:331-335`，超双精度不进 IR）。

### D3. envelope 阶段严格封闭定式（§3）

- 新错误码 **ENV-5（'5'）多余键**：`Object.getOwnPropertyNames` own 字符串键（含不可枚举）差集四键集非空即拒，单条、消息列全多余键；
- 编译入口 envelope 阶段**恒单条**：`validateEnvelopeShape` 聚合结果坍缩取首条，优先序 **ENV-2（缺键）> ENV-3（类型错）**；类内信息不丢（消息列全）；
- **symbol 键不计入 ENV-5**（JSON 数据面/指纹面/断言面均不可见；与 H1 容忍门同维度一致）；
- 阶段顺序冻结：形状（ENV-1/2/3）→ 封闭（ENV-5）→ 方言（ENV-4）→ parse → evaluate；
- **双门并存**：`envelopeTextGate`（H1 容忍门）零改动保留；语义判定共享底层单点（`validateEnvelopeShape` + `assertVfslDialect`），差异面（封闭性 + issue 条数）是两票测试各自冻结的契约；未来收敛须 ADR 层裁决，非实现层默认。

### D4. internal 阶段与失败联合形态（§5/§5.2）

- internal = 全函数体**顶层 catch**（横切兜底，非第五个串行判定）→ 单条 ENV-100，`await` 永不以 rejection 结算；
- 失败联合 = `SchemaParseIssue[]`，与 H1/H3 完全同型，**不新增第三种 issue 形状、不加 stage 字段**——阶段判别式 = `kind` + `code`（+ readOnly）：envelope ∈ {1,2,3,5}、dialect = 4（readOnly true）、internal = 100、parse/evaluate = `kind:'vfsl'` 原生数组；
- 失败产物不冻结、不摘要（失败无缓存无共享）。

### D5. 深冻结与实现约束（§7/§5.3）

- 一趟 `deepFreeze(result)`（WeakSet 防环）原地冻结容器 + envelope + module + derived；**禁止任何复制式冻结（clone-then-freeze）**——共享引用同一性（`index['ROOT'].node === structure` 等）与 ADR-0003 ref 按名引用纪律靠原地冻结保持；
- 编排内对求值的调用**必须走 index.ts 顶部 `import { evaluate } from './evaluate.js'` 既有绑定**（vi.mock 锚定的模块图边），不得另开调用路径；
- 编排不读不写 `compiledCache`；对既有公共面纯增量（envelope.ts/index.ts 既有函数逐字不动）。

### D1 附注（SA2 N1 登记，2026-08-22 总控录入）

- 两域（envelope/semantic）共用 `FINGERPRINT_PREFIX`（`sha256:v1:`）的运营后果：envelope 域文档形态单侧演进 ⇒ semantic 域指纹**全体失效**（miss-only 安全方向，非假共享）。D1 已作「任一演进须升 v2」的保守选择；未来缓存票做失效预算时需以此事实为输入。来源：SA2 R1 评审 N1（task_issue-72_sa2_review.md）。

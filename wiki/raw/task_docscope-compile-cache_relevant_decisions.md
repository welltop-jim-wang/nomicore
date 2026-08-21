# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
>
> - 被审对象：任务简报 `wiki/raw/task_docscope-compile-cache.md`（Issue #54，H3：DocScope 作用域绑定与编译缓存，功能开发）
> - 摘录基准：`docs/adr/0001–0005` 全集（5/5 逐篇全读）+ `CONTEXT.md`
> - 本文档只列与本任务相关的条款；裁决见同目录 `task_docscope-compile-cache_conflict_report.md`

## 相关 ADR

### ADR-0001 VFSL 文本是 schema 的唯一真相源，只存在于文档与测试中（accepted，含 2026-08-19 修订节与 2026-08-21 命名修订）

- 与本任务的关联点：**本任务的直接立项依据**——编译缓存是该 ADR 的显式条款；方言冻结与未知方言 loud-fail 是缓存入口纪律；纯引擎仓库边界约束实现位置。
- 核心条款（原文摘录）：
  - 「解释行为由信封自述的方言版本决定，方言只增不改，未知方言 loud-fail 只读。」
  - 「**本仓库是纯引擎仓库：代码库不含 schema 文本（测试 fixture 除外）。** VFSL 文本只作为运行时数据存在于文档的 `SCHEMA` 中」
  - 「引擎必须在运行时解析任意合法方言文本，性能依赖按内容哈希的编译缓存。」（Consequences）
  - 修订节：「**目标态不变**：nomicore 支持任意运行时 schema，不预设 schema——权威源永远是 doc 的 `SCHEMA`，引擎必须在运行时解析任意合法方言文本；」
  - 修订节：「本 ADR 的其余条款（无机器标签、方言冻结、编译缓存、演进为运行时管理操作）不变。」
  - 命名修订（2026-08-21）：「信封在 doc 中的键名由 `__schema__` 改为 **`SCHEMA`**……信封内部结构 `{lang, version, id, text}` 不变」

### ADR-0002 nomicore 是全新 yjs-server 重写，authority 完全出范围（accepted）

- 与本任务的关联点：边界性相关——DocScope 不得引入任何旧系统 authority 概念；编译缓存是读路径（解析/求值）设施，与统一写入管线三步无交集。
- 核心条款（原文摘录）：
  - 「旧系统既有的 authority 规则体系（`__authority__` manifest：enum / range / conditional / state-machine）**完全排除在范围外，不保留接口**」
  - 「统一写入管线收敛为“结构 → 值 → 单事务提交”三步。」

### ADR-0003 求值器与派生 schema——evaluate 接缝、ROOT 根别名约定、联合的分支列表表示（accepted）

- 与本任务的关联点：**getCompiled 的组合对象与缓存值形状由本 ADR 冻结**——parseVfsl / evaluate 是被冻结的公共接缝，可失败结果联合定义了「缓存只存 ok 分支」的语义；被否方案 B 的拒绝理由约束 getCompiled 的层定位。
- 核心条款（原文摘录）：
  - §1：「新增公共导出 `evaluate(module: VfslModule) → { ok: true; derived } | { ok: false; issues }`。」
  - §1：「派生 schema 延续 IR 全部纪律：纯数据、可 JSON 序列化、可内容哈希、不携带行列位置。」
  - §1：「可失败是前向兼容设计：调用方从第一天写 ok 检查，将来引入求值期失败模式（如展开资源预算）不构成破坏。」
  - §1：「`parseVfsl` / `evaluate` / `validateSnapshot` / `validatePatch` 及数组写入校验入口均以各自 Interface 作为公共观察点，不再使用易失效的序号描述。」
  - §1 被否方案：「接缝候选 B（`compile(text)` 单入口）：缓存层无法插在 parse 与 evaluate 之间」
  - §2：「检查位于 **parseVfsl 语义相位**——E310（缺 ROOT，锚模块起始）/ E311（ROOT 非 map 形，锚 ROOT 类型表达式起点）」（测试 fixture 中的合法文本须含 map 形 `ROOT` 别名）
  - §4：「别名引用表示：按名引用（不内联展开）」「派生物大小恒为 O（文本规模）」
  - 后果：「同语义、不同别名组织的文本产出不同派生物（别名结构保留——作者的命名存活到诊断与 AI card）。」

### ADR-0004 vfsl-protocol 类型协议包——编译期路径投影的五个设计决策（accepted）

- 与本任务的关联点：边界性相关——协议包与引擎包生命周期分离；本任务落在引擎侧（packages/vfsl），不得把缓存/工厂设施种进协议包；「零运行时」精神与任务「零新运行时依赖」一致。
- 核心条款（原文摘录）：
  - D3：「全部内容为类型空间产物……编译后为空模块，零依赖、零运行时代码」
  - D3：「不含生成器（票 F 职责）、不含工厂/默认值、不进引擎包。」

### ADR-0005 投影生成管线——SchemaSource 接缝、生成器输入契约、生成物入仓（accepted）

- 与本任务的关联点：**H1 断言通道的 ADR 依据**（方言断言是 SchemaSource 消费方首动作）；「id 是标签不是键」直接约束缓存键选择（内容哈希而非 id）；「async 从第一天起」是 SA1 裁定 getCompiled 同步/异步形态的权衡输入；生成器输入契约约束 `{ module, derived }` 双产出的消费方式。
- 核心条款（原文摘录）：
  - §1：「**async 从第一天起**：DocSchemaSource 终态走网络；接缝按终态设计，不按脚手架现状设计；」
  - §1：「**返回完整信封**而非裸文本：`lang`/`version` 是方言身份；」
  - §1：「**消费方首动作 = 方言断言**（`lang==='vfsl' && version===1`，否则响亮失败）——方言冻结纪律焊进生成管线；」
  - §1：「**id 是标签不是键**：引擎正确性不依赖 id 唯一性（自包含设计消灭了注册表）；id 的用途是人读标签、管理端谱系追踪、工具链寻址。」
  - §3：「**输入 = `evaluate` 的派生 schema**（不直接吃 IR）：物化折叠、联合三分类、判别式检测只计算一次（单一真相），生成器是纯发射器；」

## CONTEXT.md 相关术语与惯例

- `作用域绑定（DocScope）`：「每个命名空间绑定自己的方言解释器、规则集与编译缓存；多方言并存不需要进程级“当前版本”。」——**本任务即该术语的引擎侧落地，任务简报的隔离表述与之同文。**
- `方言（dialect）`：「`lang + version` 决定的 VFSL 语法子集与语义规格；一经发布冻结，引擎只增不改，未知方言 loud-fail 只读。」
- `信封（envelope）`：「`SCHEMA` 键（doc 顶层具名条目，原 `__schema__`——与 ROOT 统一命名）里的 `{ lang, version, id, text }`；单字符串值，原子替换、可哈希、可 diff。」
- `命名空间（namespace）`：「一个 Y.Doc 连同自带的 `SCHEMA` 信封与数据；schema 随数据走，不依赖代码模块。」_Avoid_：「schema 注册表（`SCHEMA_REGISTRY` 是被替换的旧机制）」
- `求值器（evaluator）`：「把解析后的模块（IR）求解为派生 schema 的步骤；可失败（结果联合）」_Avoid_：「编译器（compiler）——该词留给「文本 → IR → 派生 schema」的组合入口（Phase 1 contract 包）」
- `派生 schema（derived schema）`：「求值器的产出：结构树、值 schema、路径索引的打包；与 IR 同纪律——纯数据、可 JSON 序列化、可内容哈希；别名按名引用（`ref`）保留，不内联展开（ADR-0003 §4）。」_Avoid_：「编译产物、DerivedSchema（英文代号）」
- `ROOT`：「命名空间根别名的保留名（大小写是契约）：每个模块必须恰好声明一个 map 形的 `type ROOT = …`」（H3 测试 fixture 构造合法文本时的必要条件，E310/E311 在 parseVfsl 层收口）

## 设计引入的决策点（SA8 设计后复审追加，R1）

> 摘自 SA1 设计 `task_docscope-compile-cache_design.md`（R1，2026-08-21）。只摘录，不裁决；裁决见 `task_docscope-compile-cache_design_conflict_report.md`。下游 SA2/SA3/SA4/SA7 复核时以设计全文为准。

### 冻结接缝承诺（设计的硬约束自述）

- 设计头注：「冻结接缝（本设计不改其契约）：`parseVfsl` / `evaluate` / `validateSnapshot` / `validatePatch`（ADR-0003 §1）；`parseSchemaEnvelope`（H1 / issue #52，内部结构微重构、行为逐字节不变，见 D5）」
- DENY LIST：「`packages/vfsl/src/evaluate.ts` / `parser.ts` / `tokenizer.ts` / `semantic.ts` / `shapes.ts` / `resolve.ts` / `pattern.ts` / `xml.ts` / `errors.ts` — 冻结接缝与内部实现，本任务零改动（getCompiled 组合它们，不改它们）」

### D1 同步接缝（ADR-0005 async 辖域界定）

- 「组合的全链条（parseSchemaEnvelope / parseVfsl / evaluate）皆同步纯函数；ADR-0005『async 从第一天起』约束的是 SchemaSource（网络 I/O 上游），不是内存 CPU 编译本体」

### D2 缓存键 = sha256(纯文本内容)，不含 id/lang/载体

- 「简报与 AC1 锚定『键 = 文本内容哈希，非 id/载体』；ADR-0005『id 是标签不是键』」被否：「id 键控（复活 SCHEMA_REGISTRY 语义）；方言前缀域分离（v1 无收益，见 D2 注）」

### D3 包级单册（进程级模块 Map），per-DocScope 实例留 v2

- 「编译是文本的纯函数，内容寻址条目跨命名空间共享零污染；进程内命名空间数有界」；v2 演进：「届时引入 DocScope 实例工厂，本函数退化为默认实例薄壳，公共契约不变」

### D4 只存 ok 分支 + 入册前深冻结

- 「ADR-0003 结果联合的自然投影（AC5 可重试）；共享引用防变异（冲突报告提示 #4），ESM 严格模式下变异即 loud TypeError」

### D5 envelopeTextGate 共享前探门（H1 单点抽出）

- 「从 `parseSchemaEnvelope` 抽出『形状 → 方言』前缀为单点，两个公共入口共用。**既有函数零改动**」；「`parseSchemaEnvelope` 内部改用（**行为逐字节不变**，H1 既有 60+ 用例应原样绿）」；信封命中「免重复 parseVfsl（ADR-0001『性能依赖编译缓存』的忠实执行）」

### D6 文本路径：隐式 vfsl@1 直入 parseVfsl

- 「文本无自述方言，无可断言对象；parseVfsl 即 vfsl@1 解析器」；被否：「给文本包一层伪信封（造不存在的方言声明）」

### D8 sha-256 包内纯 TS 实现（零依赖）

- 「`lib:["ES2022"]` 无 DOM 且 @types/node 不声明全局 `TextEncoder`」「`node:crypto` 会造成第二个环境绑定面，违反 index.ts:24-26『唯一环境绑定面』既有不变量」；KAT 单元测试设计强制（§5.4）

### D9/D10 条目即返回值 + 编排落位

- 「命中返回缓存容器本体（`CompiledOk` 对象即缓存条目）」
- 「getCompiled 编排落位 index.ts（与 parseVfsl/parseSchemaEnvelope 同址），哈希独立叶子模块 `sha256.ts`」

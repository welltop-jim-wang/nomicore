# nomicore

全新 yjs-server 的重写仓库：以 VFSL（受限 TypeScript 子集 + JSDoc 语义标签）作为 namespace schema 的单一真相源，schema 作为数据存进 doc 的 `__schema__`，命名空间自包含、跨版本可解释。设计文档：[yjs-server Namespace Schema 自描述体系设计方案](https://welltop.feishu.cn/docx/MvtJdEr84ojlRTxbmsWcqHD8npg)。

## Language

**VFSL**:
受限 TypeScript 子集 + 标记类型构成的 schema 语言；同一段文本既是编译期类型源、又是运行期解释器输入。
_Avoid_: PathSchemaNode DSL、schema DSL

**方言（dialect）**:
`lang + version` 决定的 VFSL 语法子集与语义规格；一经发布冻结，引擎只增不改，未知方言 loud-fail 只读。

**信封（envelope）**:
`__schema__` 里的 `{ lang, version, id, text }`；单字符串值，原子替换、可哈希、可 diff。

**命名空间（namespace）**:
一个 Y.Doc 连同自带的 `__schema__` 与数据；schema 随数据走，不依赖代码模块。
_Avoid_: schema 注册表（`SCHEMA_REGISTRY` 是被替换的旧机制）

**标记类型（marker types）**:
`YMap` / `YArray` / `YPlainArray` / `YLeaf` / `YXmlFragment` / `Pattern`；tsc 视角恒等别名，引擎视角是 Yjs 物化语义标记。
_Avoid_: `YLEaf`、`yleaf` 等变体拼写——大小写是契约的一部分

**结构树（structure tree）**:
Yjs 物化语义（kind / storage / opaque），供路径下钻守卫；与值语义正交。

**值 schema（value schema）**:
值类型语义：封闭对象、判别联合、字面量联合、pattern 约束。

**路径索引（path index）**:
路径 → 子 schema 的下钻索引，键匹配（exact / pattern）为标准能力。
_Avoid_: resolveChild 三级前缀匹配（被替换的旧机制）

**求值器（evaluator）**:
把解析后的模块（IR）求解为派生 schema 的步骤；输入已是合法模块，解析层诊断在此前全部收口。
_Avoid_: 编译器（compiler）——该词留给「文本 → IR → 派生 schema」的组合入口（Phase 1 contract 包）

**派生 schema（derived schema）**:
求值器的产出：结构树、值 schema、路径索引的打包；与 IR 同纪律——纯数据、可 JSON 序列化、可内容哈希。
_Avoid_: 编译产物、DerivedSchema（英文代号）

**整文档校验（validateSnapshot）**:
对整份快照跑一次完整校验；快照加载、迁移后体检、测试、管理端点共用的单一入口。

**重建校验（rebuild validation）**:
单字段 patch 也在最近结构边界合并当前值后按完整子 schema 校验——判别联合只有看到判别字段才知道按哪个变体验。

**语义层（semantic layer）**:
JSDoc 首行自由文本 + `@tag` 半结构化标签；全部为文档性质，未识别仅 warn（无机器标签）。

**零写入（zero-write）**:
校验失败 → 400 且文档不变；所有写入口走同一条管线。

**作用域绑定（DocScope）**:
每个命名空间绑定自己的方言解释器、规则集与编译缓存；多方言并存不需要进程级"当前版本"。

**判别联合（discriminated union）**:
字面量联合字段（如 `kind`）区分的变体；引擎自动识别判别字段并按变体验证。

**封闭对象（closed object）**:
子集内对象类型默认封闭：未声明字段拒绝。

**authority 规则**:
旧系统的 `__authority__` manifest（enum / range / conditional / state-machine 等不变式）。**本仓库范围外**（ADR-0002）。

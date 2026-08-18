# CONTEXT

本仓库落地 yjs-server Namespace Schema 自描述体系（[设计文档](https://welltop.feishu.cn/docx/MvtJdEr84ojlRTxbmsWcqHD8npg)）。以下术语表是全仓库的统一词汇：issue 标题、代码命名、测试描述都从这里取词。

## 术语表

| 术语 | 英文 | 定义 |
|-|-|-|
| VFSL | VFSL | 受限 TypeScript 子集 + 标记类型构成的 schema 语言。一段 VFSL 文本是类型、结构树、校验器、AI 说明的唯一真相源；同一文本两个消费者（编译期 tsc、运行期解释器） |
| 方言 | dialect | `lang + version` 决定的语法子集与语义规格。一经发布冻结，引擎只增不改；未知方言 loud-fail 只读 |
| 信封 | envelope | `__schema__` 中的 `{ lang, version, id, text }`。整个信封是单字符串值：原子替换、可哈希、可 diff |
| 命名空间 | namespace | 一个 Y.Doc 连同自带的 `__schema__`、`__authority__` 与数据。schema 随数据走，不依赖代码模块 |
| 标记类型 | marker types | `YMap` / `YArray` / `YPlainArray` / `YLeaf` / `YXmlFragment` / `Pattern`。tsc 视角恒等别名，引擎视角是 Yjs 物化语义标记 |
| 结构树 | structure tree | Yjs 物化语义（kind / storage / opaque），供路径下钻守卫。与值语义正交 |
| 值 schema | value schema | 值类型语义：封闭对象、判别联合、字面量联合、pattern 约束 |
| 路径索引 | path index | 路径 → 子 schema 的下钻索引，键匹配（exact / pattern）是标准能力。取代旧 resolveChild 三级前缀匹配 |
| 整文档校验 | validateSnapshot | 对整份快照跑一次完整校验。快照加载、迁移后体检、测试、管理端点共用 |
| 重建校验 | rebuild validation | 单字段 patch 也要在最近结构边界合并当前值后按完整子 schema 校验——判别联合只有看到判别字段才知道按哪个变体验 |
| authority 规则 | authority rules | `__authority__` 里的 JSON manifest：enum / range / conditional / state-machine 等不变式 |
| 语义层 | semantic layer | JSDoc 首行自由文本 + `@tag` 半结构化标签（`@format` / `@role` / `@ref` / `@invariant` 等）。机器消费标签（`@invariant` / `@ref`）解析失败必须拒绝 schema |
| 投影镜像 | projection | `@nomicore/vfsl-protocol` 的编译期路径→值类型投影。文本的受检镜像，CI 校验、不承担权威 |
| 零写入 | zero-write | 校验失败 → 400 且文档不变。所有写入口（REST / WS / 内部 API）走同一条管线 |
| 作用域绑定 | DocScope | 每个 namespace 绑定自己的方言解释器、authority 规则集与编译缓存。多方言并存不需要进程级"当前版本" |
| 判别联合 | discriminated union | 字面量联合字段（如 `kind`）区分的变体。引擎自动识别判别字段，按变体验证 |
| 封闭对象 | closed object | 子集内对象类型默认封闭：未声明字段拒绝 |

## 避免使用的说法

- 不再称旧体系的 "PathSchemaNode DSL"——统一说 **VFSL 文本**。
- 不说 "schema 注册表"（`SCHEMA_REGISTRY` 是被替换的旧机制）——schema 的家在 doc 的 `__schema__`，代码里只有解释器。
- 不说 "当前 schema 版本"（进程级全局）——版本由每个 namespace 的信封自述，见 **作用域绑定**。

## 相关文档

- 设计文档：[yjs-server Namespace Schema 自描述体系设计方案](https://welltop.feishu.cn/docx/MvtJdEr84ojlRTxbmsWcqHD8npg)
- 架构决策：`docs/adr/`

## Problem Statement

设计文档《yjs-server Namespace Schema 自描述体系》的解药是一段 VFSL 文本作为 schema 的单一真相源——但今天这段文本无法被机器解释：方言 v1 只存在于散文里，没有可执行的语法定义，也没有任何代码能把 `__schema__` 信封里的文本变成机器可处理的结构。nomicore 作为全新重写的 yjs-server（ADR-0002），其引擎的第一块基石就是 parser：文本不可解释，后续的求值器、路径索引、`validateSnapshot` 与服务端全部无从谈起。

## Solution

交付 `@nomicore/vfsl` 的 parser：输入一段 VFSL 文本（按本 spec 冻结的 v1 方言子集书写），输出可序列化的 IR，或精确到行列的结构化错误。v1 方言随本 spec 一并冻结——语法子集、六个标记类型（大小写是契约）、禁止清单、禁递归、JSDoc 原文捕获。方言一经发布只增不改；对历史文本的解释永远以文本自述的方言版本为准。

## User Stories

1. 作为 schema 作者，我想用熟悉的 TypeScript 语法（类型别名、对象字面量、联合）书写 schema，这样零学习成本。
2. 作为 schema 作者，我想用 `YMap` / `YArray` / `YPlainArray` / `YLeaf` / `YXmlFragment` 标记 Yjs 物化语义，这样结构与值语义正交表达、互不污染。
3. 作为 schema 作者，我想用 `string & Pattern<"正则">` 表达字符串与键约束，这样旧体系里硬编码在 handler 的 name 禁 `.` / `|` 检查消失。
4. 作为 schema 作者，我想用字面量联合表达枚举与判别字段，这样 "profile 按 kind 判别" 成为内建能力而不是摊平妥协。
5. 作为 schema 作者，我想在 `/** */` 里写自由语义描述与 `@tag`，这样语义随 schema 文本走、校验错误信息将来可以回带语义。
6. 作为 schema 作者，我写了越界语法（`any`、自定义泛型、条件类型等）时想得到精确到行列的错误，这样能立即定位修复，而不是面对"差不多"的猜测。
7. 作为 schema 作者，我写出循环引用的类型别名时想被明确拒绝，这样我确信文档结构是非递归的。
8. 作为引擎开发者，我想消费稳定的 IR（`/** */` 原文已挂载到相应节点），这样求值器、路径索引、`validateSnapshot` 可以在纯数据上独立开发。
9. 作为引擎开发者，我想 parse 是纯函数（无副作用、确定性），这样编译产物可以按内容哈希缓存。
10. 作为服务端开发者（Phase 2），我想在创建 namespace 时调用 parser 拒绝不合法的 schema 文本，这样"schema + 初始 data 校验通过才建"的创建契约有第一道防线。
11. 作为 AI 消费者，我想从 IR 拿到字段的语义描述原文，这样我能解释数据而不是猜。
12. 作为引擎开发者，我想未识别的 `@tag` 只产生 warn 不失败，这样语义层词汇可以自由演进而不破坏解析。
13. 作为引擎开发者，我想 v1 方言冻结后引擎只增不改，这样一年前的旧 doc 永远可以用今天的代码解释。

## Implementation Decisions

- 模块：`@nomicore/vfsl`（`packages/vfsl`），零运行时依赖——不依赖 yjs、网络、存储。
- 唯一公共测试接缝：`parseVfsl(text)` → `{ ok: true, module }` 或 `{ ok: false, issues: [{ message, line, column }] }`。tokenizer 与 AST 内部形状不构成公共契约。
- v1 语法子集（冻结）：类型别名；封闭对象字面量类型（未声明字段拒绝的语义基础）；`?:` 可选属性；原始类型 `string` / `number` / `boolean` / `null` / `unknown`；字面量联合；`T[]`；`Record<K, V>`；`string & Pattern<"正则">`（唯一允许的交叉类型）；注释。
- 标记类型六个，大小写是契约：`YMap`、`YArray`、`YPlainArray`、`YLeaf`、`YXmlFragment`、`Pattern`。
- 注释处理：`//` 与 `/* */` 忽略；`/** */` 原文捕获并挂载到相邻 IR 节点（类型别名 / 属性 / 标记类型处）。标签的结构化解析延后到语义层任务——本方言无机器标签，全部文档性质（ADR-0001）。
- 禁止清单（越界即错误）：`any`、自定义泛型、条件类型、mapped type、interface 继承、递归 / 循环引用的类型别名（别名引用图成环 → 错误）。
- IR 必须可序列化、可哈希（编译缓存的前提）；具体形状由实现自定，通过公共接缝观察。
- 信封形状属于 v1 定义的一部分（`{ lang: "vfsl", version: 1, id, text }`），但 parser 只消费 `text`；信封解析与方言路由（未知方言只读）是后续引擎任务。
- 本仓库是纯引擎仓库：代码库不含 schema 文本，测试 fixture 除外（ADR-0001）。

## Testing Decisions

- 只测外部行为：全部测试经由 `parseVfsl` 公共入口断言输入→输出；不测 tokenizer / 内部 AST 的实现细节。
- 正例 fixture：设计文档 §4 的 `vfs3.assets` 文本全量解析为 IR。
- 覆盖矩阵：v1 每个语法特性至少一正一负；禁止清单逐项负例，断言结构化错误含行列信息。
- 环检测负例：自引用与互引用环都要拒绝。
- JSDoc 用例：`/** */` 原文挂载到正确的节点。
- 先例：仓库暂无测试基线，本任务以 vitest 建立。

## Out of Scope

- 求值器（结构树 / 值 schema 派生）、路径索引、`validateSnapshot`、编译缓存
- 信封解析与方言路由（未知方言 loud-fail 只读）
- JSDoc 标签的结构化解析（语义层任务；本方言无机器标签）
- yjs-server 服务端：WS / REST、存储、同步协议、namespace 生命周期与创建事务
- authority / 不变式体系（ADR-0002 完全出范围）
- 编译期类型投影（已随 `vfsl-protocol` 移除，ADR-0001）
- schema 升级 / 迁移（Phase 3，仅记路线）
- 开放问题（不阻塞本任务，Phase 2 前必须关闭）：写入强制等级（服务器唯一写入者 vs 允许原始 update）；API 面划分（REST 管理面 + WS 数据面 vs 全 WS）

## Further Notes

- 路线图：parser（本 spec）→ 求值器 → 路径索引 → `validateSnapshot` →（Phase 2）schema 数据面服务端 →（Phase 3）数据化与迁移 →（Phase 4）AI 友好层。
- 术语以仓库 `CONTEXT.md` 为准；架构决策见 `docs/adr/0001`（单一真相源、纯引擎仓库）、`docs/adr/0002`（全新重写、authority 出范围）。

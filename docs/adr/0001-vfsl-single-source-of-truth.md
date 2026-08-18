# 1. VFSL 作为 schema 的单一真相源

日期：2025-08-18
状态：提议中（待 grill-with-docs 讨论后随 PRD 定稿）

## 背景

旧 yjs-server 的 schema 体系（`apps/yjs-server/src/api.ts` 的 `PathSchemaNode` + 手写 `ValueShape` 校验器 + `SCHEMA_REGISTRY`）存在三个问题：

1. **表达力有限**：无 refine / regex / 数值范围 / union / discriminated union / strict；不变量（如 name 禁含 `.` 或 `|`）硬编码在 handler，同一契约三处真相；读回数据全是 `Record<string, unknown>`。
2. **校验困难**：值校验只在 REST PATCH 一个入口，WS 同步与 bootstrap 绕开；没有整文档校验函数；错误是单条拼接字符串。
3. **双份真相 + 不自包含**：手写 shape 与 contract 包 zod 定义并存；schema 是代码而非数据，旧 snapshot 无法用今天的代码解释，前端必须对齐 contract 包版本。

## 决策

采用 **VFSL**：一段受限 TypeScript 子集文本 + 5 个标记类型（`YMap` / `YArray` / `YPlainArray` / `YLeaf` / `YXmlFragment`，外加 `Pattern`）作为 schema 的单一真相源，语义层用标准化 JSDoc 标签写在文本里。

1. 该文本同时是合法 TypeScript（编译期类型源）与解释器输入（运行期结构/值语义源）——零 codegen、零双份真相；
2. schema 作为数据存进 doc 的 `__schema__` 信封（`{ lang, version, id, text }`），命名空间自包含；
3. 一切派生物从文本生成：TS 类型、结构树（Yjs 物化）、路径→子 schema 索引、整文档校验器 `validateSnapshot`、AI namespace card；
4. 稳定性由**方言冻结**保证：引擎对历史方言语义只增不改，未知方言 loud-fail 只读；多方言并存靠 namespace 作用域绑定（DocScope），不靠进程级全局变量；
5. 编译期路径投影（`@nomicore/vfsl-protocol`）是文本的**受检镜像**：由生成器产出、CI 校验，不参与运行时判定、不承担权威。

被否决的备选（详见设计文档 §14 对照表）：全 zod 代码模块（不自包含，恰是要解决的问题）、JSON Schema（书写体验差，留作可选导出格式）、Avro IDL（无 pattern/range）、CUE（引入 Go/WASM 运行时）。

## 后果

**正面**：单一真相消灭手写/生成漂移；旧 doc 永远可解释（方言 additive）；判别联合、键约束、封闭对象成为内建约束而非硬编码；错误结构化并回带语义，对人 debug 与 AI 修复都更友好。

**负面**：需要自维护一个 TS 子集 parser 与求值器（子集刻意收窄以控制成本）；运行期多一层文本解释（按内容哈希缓存缓解）；schema 作者须遵守子集边界（越界即报错，不做猜测）。

## 实施

首个落地模块是 `packages/vfsl`（Phase 0 POC → Phase 1 contract 包）：parser → 求值器 → 路径索引 → `validateSnapshot` → JSDoc 抽取。测试 fixture 取设计文档 §4 的 `vfs3.assets` 示例，负例取 §7 的三个拒绝用例。yjs-server 接入（统一写入管线、DocScope、迁移）在 Phase 2 落入 `apps/`。当前仓库仅保留包骨架，实现顺序与契约以 PRD 及其拆解的 issues 为准。

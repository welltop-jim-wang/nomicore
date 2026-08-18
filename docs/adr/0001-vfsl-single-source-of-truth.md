# 0001: VFSL 文本是 schema 的唯一真相源，只存在于文档与测试中

---
status: proposed（重写稿，2025-08-18 grill 轮次定稿方向，细节待确认）
---

旧体系的三问题（表达力有限、校验绕行、双份真相不自包含）根源是 schema 是代码而非数据。决策：schema 用 VFSL（受限 TypeScript 子集 + 标记类型）+ JSDoc 语义标签描述，以信封 `{ lang, version, id, text }` 作为数据存进 doc 的 `__schema__`；解释行为由信封自述的方言版本决定，方言只增不改，未知方言 loud-fail 只读。

**本仓库是纯引擎仓库：代码库不含 schema 文本（测试 fixture 除外）。** VFSL 文本只作为运行时数据存在于文档的 `__schema__` 中；设计文档中"前端/服务端 import 同一文本"的双消费者机制不采用——没有作为类型源的 schema 源文件，也没有任何形式的 codegen。schema 的创建与升级只能通过运行时管理操作完成。

语义层**不设机器标签**：`@ref` 与 `@invariant` 均移除（2025-08-18 决策）——`@invariant` 随 authority 一并移除（ADR-0002）；`@ref` 的注册时解析检查与运行时跨命名空间校验都不做。全部 JSDoc 标签（`@format` / `@role` / `@example` / `@values` / `@unit` / `@since` / `@deprecated` / `@entity` / `@key`）为文档性质，未识别仅 warn；语义层的价值收敛为 AI/人类可读说明与校验错误信息回带语义。

## Considered Options

- **双消费者机制**（schema 文本作为 .ts 源文件入仓，tsc 检查 + 部署期读取写入 `__schema__`）——被否决：代码库会出现与文档并存的 schema 副本，"schema 是数据、随文档走"的立论就破了。
- **字符串常量导出 / `.vfsl` 文件 + 生成 wrapper**——被否决：前者内容不受类型检查且仍是仓内文本，后者是 codegen。

## Consequences

- 设计文档 §8 的编译期类型投影整体出范围（2025-08-18 决策）：仓库没有 schema 文本可镜像，`vfsl-protocol` 包已移除。"坏数据进不来"由运行时校验兑付，"坏代码写不出来"不再作为目标。
- 命名空间之间的引用一致性（原 `@ref` 领地）没有任何静态检查——schema 互相指空只能在运行时或使用中暴露。
- 引擎必须在运行时解析任意合法方言文本，性能依赖按内容哈希的编译缓存。
- schema 演进是运行时管理操作（入口形式待定），仓库 git 历史不记录 schema 变更——变更历史在 Yjs update WAL 里，与数据同源。

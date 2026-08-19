# ADR 0004：求值器接缝——evaluate(module) 为第二公共导出，派生 schema 进入公共契约

日期：2026-08-19
状态：已接受（grill 决策，Phase 0b 前置）

## 背景

PRD #3 冻结「唯一公共测试接缝 `parseVfsl(text)`」。Phase 0b（求值器）需要把「IR → 派生产物」这一步暴露给三个形态不同的消费者：路径守卫（只要结构树）、AI namespace card（只要值 schema 与文档）、`validateSnapshot`（全要）。

## 决策

新增第二公共导出 `evaluate(module: VfslModule) → DerivedSchema`；`DerivedSchema` = 结构树 + 值 schema + 路径索引的打包（术语「派生 schema」），延续 IR 的全部纪律：纯数据、可 JSON 序列化、可内容哈希、**不携带行列位置**。PRD #3 的「唯一公共测试接缝」措辞相应修订为两个公共观察点（`parseVfsl` 与 `evaluate` 的入参/出参）。

## 理由

- **消费者形态不同**：三个消费者各取派生物的一部分；若求值器不导出（候选 C：藏进 `validateSnapshot` 内部），则派生 schema 永不成为公共类型，ADR 0003 冻结的联合节点形状等地基契约无处挂载；
- **缓存键的组合性**：IR 按文本哈希缓存、派生 schema 按 IR 哈希缓存——IR 不含行列、内容哈希对排版不敏感，是派生物的天然缓存键。若选候选 B（只加 `compile(text)` 组合入口），两层缓存之间无法插入；
- **契约粒度**：`DerivedSchema` 的形状本身需要冻结（公共契约），类型导出是冻结的载体。

## 排除项

- 候选 B（`compile(text)` 单入口）：把组合藏起来，缓存层无法插在 parse 与 evaluate 之间；
- 候选 C（不导出）：下游消费者被迫共享一个大函数，小接缝各自冻结的工程纪律破产。

## 后果

- 导出面从「一个函数」变为「函数 + 一组类型」；v1 生命周期内 `DerivedSchema` 形状变更须走设计修订流程；
- 派生 schema 的无行列纪律直接继承 IR 的理由（内容哈希对排版不敏感），不再单独论证。

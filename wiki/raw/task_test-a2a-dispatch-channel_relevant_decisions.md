# SA8 相关决议清单：test: A2A 派发通道验证（Issue #47）

来源：SA8 冲突门禁阶段产物，供本任务全链（SA3/SA4/SA7）复用。

## 任务性质

文档冒烟票：仅在 README.md 末尾追加一行 `MABF dispatch channel verified: 2026-08-21`；
无代码逻辑变更，不触碰 schema / parser / evaluator / 写入管线等任何引擎领地。

## 检索范围

- `CONTEXT.md`（术语与 Avoid 清单）
- `docs/adr/0001-vfsl-single-source-of-truth.md`（VFSL 单一真相源、纯引擎仓库、无机器标签、脚手架纪律）
- `docs/adr/0002-nomicore-is-a-rewrite-authority-out-of-scope.md`（全新重写、authority 出范围）
- `docs/adr/0003-evaluator-derived-schema.md`（evaluate 接缝、ROOT 约定、联合表示、按名引用、YXmlFragment）
- `wiki/raw/20260818-prd-vfsl-v1.md`（VFSL v1 PRD）
- `wiki/raw/20260819-bug-vfsl-derived-docs-typecls.md`
- `docs/vfsl/v1-spec.md`（规格，非决策记录）
- `docs/agents/`、`docs/mabf-poller.md`（流程文档，非架构决策）

## 相关决议

**无相关决议。**

理由逐条说明：

1. 既有 ADR 决策集（0001/0002/0003）全部作用于 VFSL 引擎的 schema 表达、解析、求值与
   数据面契约；本任务不新增/修改任何代码、schema 文本、fixture、规格或依赖，不落入任一
   ADR 的约束面。
2. 唯一被触碰的文件是 README.md（仓库说明文档，非代码库 schema 载体）。ADR-0001 的
   「代码库不含 schema 文本」条款约束的是 schema 源文件/codegen，README 追加一行
   冒烟标记不引入 schema 文本、不构成双消费者、不违反脚手架纪律（不经任何消费方）。
3. PRD 的排除项（authority、编译期类型投影等）与本任务零交集。
4. CONTEXT.md 的术语/Avoid 清单约束代码与规格用词，README 冒烟行不引入新术语。

## 全链提示

- 后续 SA 阶段无需引用任何 ADR 条款作为实现依据；仅需遵守任务边界：README.md 单行
  追加，无其他文件变更。

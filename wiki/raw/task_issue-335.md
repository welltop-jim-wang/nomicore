# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #335
Title: [shape-budget] T2: 投影通道形状预算——解析入口三参化与截断标记
State: open
Issue updated at: 2026-09-12T08:20:05Z

## Issue body

## Parent

PR #332（adr-0024-readdata-shape-budget）

## What to build

语义 schema 投影的解析入口加法三参化 `resolveSchemaAtPath(derived, path, options?)`(ADR-0024 决策 5):valueSchema 与值同 depth 截断——截断处放**投影层截断标记**(投影包装联合,不扩展 ValueSchema 语义联合;携带成员级类型线索:ref 名优先,无 ref 名时容器 kind);别名传递闭包与 docs/aliasDocs 注释切片在同一次遍历内随展开层收缩;计层规则——discriminated/literal union 透明、ref 为终态边界;width 对投影无操作。无 options 时行为逐字节不变。

## Acceptance criteria

- [ ] 同 depth 下 valueSchema 截断标记位置正确,标记携带 ref 名或容器 kind(vfsl 单元面)
- [ ] 别名闭包随展开层收缩;被裁路径的 docs/aliasDocs 切片省略
- [ ] union 透明 / ref 终态的计层规则符合 ADR;width 不影响投影(width 触发时投影与无预算读一致)
- [ ] 投影包装类型进入投影契约公共面;无 options 逐字节回归锚全绿
- [ ] 全套包门禁 + root typecheck/test


## Comments

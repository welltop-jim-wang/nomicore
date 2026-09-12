# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #334
Title: [shape-budget] T1: 值通道形状预算——载体投影读取三参化与截断省略
State: open
Issue updated at: 2026-09-12T07:20:04Z

## Issue body

## Parent

PR #332（adr-0024-readdata-shape-budget）

## What to build

载体投影读取公共面扩展为三参形态 `readLogicalValueAtPath(doc, path, options?)`(ADR-0024 决策 1/2/3):depth 与 maxChildrenPerNode 预算**在投影递归内生效**——未展开分支零物化;截断省略为值内唯一截断形态(depth 与 width 同形态,键省略);depth: 0 骨架读(目标折叠为空容器 + 单条截断项);终态目标预算 no-op;options 为封闭形状,非法值(负数/非整数/非有限数/非对象/未知键)响亮拒绝进新失败分支;omitted = 直接子项数(O(1),非后代总数)。无 options 时行为逐字节不变。

## Acceptance criteria

- [ ] 预算递归的截断省略结果正确:depth/width 各形态、depth: 0 骨架、终态 no-op(doc-runtime 单元面)
- [ ] 截断事实(位置/裁因/直接子项数计数)随结果返回,可供 runtime 组合消费
- [ ] 零物化行为哨兵:被截子树埋投影不可表示值(non-finite number / 稀疏数组空洞)时预算读 ok:true;全量物化退化实现会变红
- [ ] 缺席吸收语义与敌意 path 纪律不破(零 throw);非法 options 走新失败分支
- [ ] 无 options 逐字节回归锚全绿;全套包门禁 + root typecheck/test


## Comments

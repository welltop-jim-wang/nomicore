# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #307
Title: feat(vfsl-codegen): 联合成员 doc 四发射位（别名联合/枚举多行 + 内联行内前置）
State: open
Issue updated at: 2026-09-11T05:54:04Z

## Issue body

## Parent

PR #305（docs/issue-304-vfsl-union-member-docs）

## What to build

成员 doc 随生成物到达类型投影消费方（hover、AI 读码、生成文档），覆盖 ADR 0019 决策 6 的四个发射位：别名判别联合成员逐行 TSDoc；别名枚举（标量联合坍缩位）有成员 doc 时转多行逐成员布局；内联联合与内联枚举（字段类型位）行内前置。YPlainArray 纯值子树与 YXmlFragment 实参内的成员 doc 无发射位（与 fieldDocs/markerDocs 既有限界同族）。semicolonFree 模式同布局。

## Acceptance criteria

- [ ] 别名判别联合成员 doc 以 `  | ` 行为基准上一行发射；别名枚举有成员 doc 时转多行布局（默认与 semicolonFree 两种模式）
- [ ] 内联联合/枚举成员 doc 行内前置发射
- [ ] 无成员 doc 的生成物逐字节不变；存量 domains 的 `pnpm generate --check` 不报告过期
- [ ] codegen 包测试与 typecheck 绿，根 `pnpm typecheck` 绿

## Blocked by

- #306

## Comments

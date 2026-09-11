# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #308
Title: feat(vfsl): readData 语义投影 docs 切片并入 memberDocs
State: open
Issue updated at: 2026-09-11T06:53:35Z

## Issue body

## Parent

PR #305（docs/issue-304-vfsl-union-member-docs）

## What to build

readData 语义 schema 投影（ADR 0016）的 docs 切片并入 memberDocs 为第三来源，使读联合所在路径时逐成员口径随投影下发。选键规则不变（脊柱 ∪ 终点子树后代 ∪ 闭包别名内部，`<member N>` 路径天然落在既有规则内）；合并内容为 field → marker → member 末位，空条目过滤不变；投影返回四件套形状不变，detached 克隆零改动（ADR 0019 决策 7，修订 ADR 0016 切片条款）。

## Acceptance criteria

- [ ] 读联合/枚举所在路径时，投影 docs 携带 `<member N>` 键的逐字成员 doc；marker 成员同时有 M3 doc 时合并次序为 marker 在前、member 在后
- [ ] 不使用 M4 的 schema 投影输出逐字节不变
- [ ] `packages/vfsl` 相关测试（resolve-schema-at-path）与 typecheck 绿

## Blocked by

- #306

## Comments

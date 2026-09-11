# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #309
Title: docs(vfsl): v1-spec §5 与编写指南落地 M4 挂载锚位
State: open
Issue updated at: 2026-09-11T10:15:37Z

## Issue body

## Parent

PR #305（docs/issue-304-vfsl-union-member-docs）

## What to build

规范与指南落地 ADR 0019 的最终实现行为：v1-spec §5 挂载规则修订为四类锚位（M4 子规则：`|` 锚位、首成员起点锚位、连续 doc 同挂、坍缩维持 E305、`|` 夹缝与 M3 优先的不对称注明），挂载示例补联合成员样本；schema-authoring-guide 第 7/8 节补逐成员 doc 写法与示例、检查表同步；源码与测试注释中「三锚位」措辞清扫为四锚位。规格随实现同支累积，避免「规格已改、实现未跟」的中间态。

## Acceptance criteria

- [ ] v1-spec §5 的挂载规则、边界行为与实现逐条一致（含 E305 既有场景不变的明确表述）
- [ ] 编写指南的枚举/联合示例使用逐成员 doc，检查表覆盖 M4
- [ ] 全仓「三锚位」措辞无残留（dist 产物除外）
- [ ] `git diff --check` 干净

## Blocked by

- #306
- #307
- #308

## Comments

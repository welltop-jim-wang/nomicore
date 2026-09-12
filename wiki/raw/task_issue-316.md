# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #316
Title: codegen 与 readData 投影适配 int/range 叶子（ADR 0020）
State: open
Issue updated at: 2026-09-12T17:47:35Z

## Issue body

## Parent

PR #311（docs/issue-310-vfsl-number-constraints）

## What to build

含 Int/Range 约束的 schema 走完生成与投影：codegen 对 \`int\`/\`range\` 叶子生成 \`number\` 原样（品牌类型不做，ADR 0020 决策 7）；resolve-schema-at-path 将 \`int\`/\`range\` 按标量叶子处理，终态/下钻规则与 \`pattern\` 叶子同构，不新增拒绝路径与失败码（决策 8）。

## Acceptance criteria

- [ ] 含 Int/Range 字段的 schema 生成 TS 为 \`number\`，生成物可编译
- [ ] \`pnpm generate --check\` 既有生成物零漂移（字节稳定基线不变）
- [ ] 投影路径落在 int/range 叶子上的行为与 pattern 叶子同构（终态/拒绝分类一致）
- [ ] 包测试、typecheck 全绿

## Blocked by

- #315

## Comments

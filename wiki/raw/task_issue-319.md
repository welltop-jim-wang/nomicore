# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #319
Title: number 值域收窄核心：validate 与 validate-patch 统一判定（ADR 0021）
State: open
Issue updated at: 2026-09-12T04:49:01Z

## Issue body

## Parent

PR #318（docs/issue-312-vfsl-number-domain）

## What to build

number 家族运行时判定收窄为 JSON 可忠实表示数（\`Number.isFinite(v) && !Object.is(v, -0)\`）：裸 \`number\` 叶子拒绝 NaN / +Infinity / -Infinity / -0，写入路径与校验路径同口径。失配消息细分：typeof 非 number 维持现有「类型不匹配：期望 number，实际 X」；四值拒绝给「期望 number（有限数且非 -0），实际 NaN/Infinity/-Infinity/-0」，-0 经 \`Object.is\` 单独识别（不被显示为 \"0\"）。

## Acceptance criteria

- [ ] validate：NaN / +Infinity / -Infinity / -0 入裸 number 全拒（消息细分正确）；0、0.0、有限小数正常放行
- [ ] validate-patch：写路径同口径四值全拒
- [ ] changelog 结构性闭合锁定测试：合法写入的 doc 不再触发数值分支 capture:'unavailable'
- [ ] IR / derived / codegen / 既有 fixture 指纹逐字节不变（零改动锁定）
- [ ] 包测试、typecheck 全绿

## Blocked by

- None (can start immediately).

## Comments

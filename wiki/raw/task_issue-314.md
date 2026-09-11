# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #314
Title: VFSL 数字字面量拓宽：负号与小数（ADR 0020）
State: open
Issue updated at: 2026-09-11T13:17:38Z

## Issue body

## Parent

PR #311（docs/issue-310-vfsl-number-constraints）

## What to build

数字字面量从「无符号十进制整数」拓宽为 \`-? [0-9]+ ('.' [0-9]+)?\`，全局生效：\`type T = -1 | 0.5 | 2;\` 端到端可用——解析、IR、derived、validate（f64 严格相等枚举判定）、codegen 发射合法 TS。负号须与数字紧邻（作为 number 记号一部分扫描）；裸 \`-\` 维持未知字符 E100 路径；\`.5\` / \`1.\` / \`1e3\` 维持 E100；超双精度字面量（含负值）沿 §7.3 判 E100；`-0`（含 `-0.0` 等值为 -0 的字面量）解析期 E100 拒绝（ADR 0021 决策 2：运行时值域收窄排除 -0，文本侧 loud）。

## Acceptance criteria

- [ ] 负整数、小数字面量可作联合成员并通过 validate 枚举判定（f64 严格相等）
- [ ] \`.5\` / \`1.\` / \`1e3\` / 裸 \`-\` 各负例维持 E100 及正确锚位
- [ ] 超双精度字面量（含负值）E100
- [ ] 既有 fixture 语义指纹零漂移；codegen 对浮点/负字面量联合发射合法 TS
- [ ] 包测试、typecheck、\`git diff --check\` 全绿

## Blocked by

- None (can start immediately).


## Comments

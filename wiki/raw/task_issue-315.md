# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #315
Title: VFSL 三约束形态核心链：number & Int / Int<min,max> / Range<min,max>（ADR 0020）
State: open
Issue updated at: 2026-09-12T14:16:29Z

## Issue body

## Parent

PR #311（docs/issue-310-vfsl-number-constraints）

## What to build

schema 里写 \`number & Int<1, 100>\` 等三形态的字段，运行时越界值被 validate 真判定报错。全链：\`Int\`/\`Range\` 进保留名集合（别名占用 → E303；裸用/脱离 \`number &\` 语境 → E100，镜像裸 Pattern 判定）；交叉白名单 1 例扩 4 例（E100 文案更新）；arity 严格（\`Int<5>\` / \`Int<1,2,3>\` / 裸 \`Range\` → E100）；Int 端点限整数字面量（\`Int<0.5, 1.5>\` → E100）；空区间（min > max，f64 比较）解析期 E100；IR/derived 新增 \`int\`/\`range\` 叶子（exactOptionalPropertyTypes 条件键纪律，既有指纹零变更）；validate 三形态逐值判定（O(1) 比较，纳入全收集与工作预算计费）。

## Acceptance criteria

- [ ] 三形态正例（整数/小数/负端点）解析→IR→derived→validate 全链贯通，边界含端点
- [ ] 各负例（arity、Int 浮点端点、空区间、裸用、保留名占用 E303）错误码与锚位正确
- [ ] NaN/±Infinity/-0 入三形态均拒绝，入裸 number 同样拒绝（ADR 0021 统一基线：number 家族只接受 JSON 可忠实表示数；原「基线不变锁定测试」已被 ADR 0021 supersede）
- [ ] 无 Int/Range 的既有 fixture 指纹逐字节不变；含 Int/Range 新 fixture 指纹稳定
- [ ] 包测试、typecheck 全绿

## Blocked by

- #314


## Comments

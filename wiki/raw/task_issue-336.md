# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #336
Title: [shape-budget] T3: readData 五键组合——两通道同预算与截断清单
State: open
Issue updated at: 2026-09-12T13:26:56Z

## Issue body

## Parent

PR #332（adr-0024-readdata-shape-budget）

## What to build

runtime `readData(path, options?)` 组合值与投影两通道的同预算读取(ADR-0024 决策 3/4/5/6):成功分支恒五键 `{ ok, value, schema, truncated, truncations }`(恰三键 → 五键的破坏性修订,经 T0 的集中 helper 落地);截断清单恒在场空数组、条目三字段(path 与实参同基 / kind / omitted);`READ_OPTIONS_INVALID` 进入公共结果联合;registry lease 原样透传 options。

## Acceptance criteria

- [ ] 五键恒形:预算读与无预算读(空清单)都携带 truncated/truncations;失败分支形状不动(主接缝 runtime readData 契约测试,红绿 + 负控)
- [ ] 两通道截断位置对齐:同一预算下值截断位置与投影截断标记一一对应(主缝断言)
- [ ] width 触发时 schema 投影与同路径无预算读逐字节相等
- [ ] depth 条目 path 尾段即被裁键名(枚举语义);omitted 计数语义断言(直接子项数 ≠ 后代总数 fixture)
- [ ] READ_OPTIONS_INVALID(含未知键)公共失败分支;无 options 逐字节现行为回归锚
- [ ] T0 集中的形状断言 helper 处完成恰三键 → 五键修订;lease 透传断言(既有 registry 测试延伸)
- [ ] 全套包门禁 + root typecheck/test

## Blocked by

- #333
- #334
- #335

## Comments
